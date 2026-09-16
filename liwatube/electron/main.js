'use strict';
/**
 * LiwaTube — العملية الرئيسية.
 * يوتيوبك الخاص: مكتبة فيديو محلية بواجهة يوتيوب ومدعومة بالذكاء الاصطناعي.
 * تم إنشاؤه عن طريق LiwaMusic.
 */
const {
  app, BrowserWindow, ipcMain, dialog, protocol, shell, safeStorage, nativeTheme, Menu,
} = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const { serveFile, encodePath, decodePath } = require('./lib/filestream');
const { Store } = require('./lib/store');
const scanner = require('./lib/scanner');
const recommend = require('./lib/recommend');
const playlists = require('./lib/playlists');
const subtitles = require('./lib/subtitles');
const lock = require('./lib/lock');
const { AI, MODELS, DEFAULT_MODEL } = require('./lib/ai');

const APP_NAME = 'LiwaTube';
const CREATOR = 'تم إنشاؤه عن طريق LiwaMusic';

let win = null;
let store = null;
let ai = null;
let dataDir = null;
let thumbDir = null;
let scanning = false;
let watchers = [];
let watchTimer = null;
let pendingOpen = [];

// ————————————————————————————————— البروتوكول الآمن للملفات المحلية

protocol.registerSchemesAsPrivileged([
  { scheme: 'liwa', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

function registerProtocol() {
  protocol.handle('liwa', async (request) => {
    try {
      const url = new URL(request.url);
      const host = url.hostname;
      const key = decodeURIComponent(url.pathname.replace(/^\//, ''));
      if (!key) return new Response('Bad request', { status: 400 });

      if (host === 'video') {
        const filePath = decodePath(key);
        const known = store.read('library.json').videos[scanner.videoId(filePath)];
        if (!known || path.resolve(known.path) !== path.resolve(filePath)) return new Response('Forbidden', { status: 403 });
        return serveFile(filePath, request.headers.get('range'));
      }
      if (host === 'thumb') {
        const name = path.basename(key);
        return serveFile(path.join(thumbDir, name), null);
      }
      if (host === 'sub') {
        const filePath = decodePath(key);
        const ext = path.extname(filePath).toLowerCase();
        if (!subtitles.SUB_EXT.includes(ext)) return new Response('Forbidden', { status: 403 });
        // يجب أن يكون الملف مجاورًا لفيديو معروف
        const dir = path.resolve(path.dirname(filePath));
        const ok = Object.values(store.read('library.json').videos).some((v) => path.resolve(v.folder) === dir);
        if (!ok) return new Response('Forbidden', { status: 403 });
        const vtt = await subtitles.readAsVtt(filePath);
        return new Response(vtt, { status: 200, headers: { 'Content-Type': 'text/vtt; charset=utf-8', 'Access-Control-Allow-Origin': '*' } });
      }
      return new Response('Not found', { status: 404 });
    } catch (err) {
      return new Response(`Error: ${err.message}`, { status: 500 });
    }
  });
}

// ————————————————————————————————— أدوات

const ok = (data) => ({ ok: true, data });
const fail = (err) => ({ ok: false, error: err && err.message ? err.message : String(err), code: err && err.code });
const handle = (channel, fn) => ipcMain.handle(channel, async (_e, ...args) => {
  try { return ok(await fn(...args)); } catch (err) { return fail(err); }
});
const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

const lib = () => store.read('library.json');
const user = () => store.read('userdata.json');
const settings = () => store.read('settings.json');
const saveLib = () => store.write('library.json');
const saveUser = () => store.write('userdata.json');

function publicLibrary() {
  const l = lib();
  return { folders: l.folders, videos: l.videos, channels: scanner.channelsOf(l.videos) };
}

function videoUrl(v) { return `liwa://video/${encodePath(v.path)}`; }

// ————————————————————————————————— الفهرسة والمراقبة

async function runScan() {
  if (scanning) return null;
  scanning = true;
  try {
    const l = lib();
    const { videos, stats } = await scanner.scan({
      folders: l.folders,
      existing: l.videos,
      channelMode: settings().channelMode,
      onProgress: (p) => send('library:progress', p),
    });
    l.videos = videos;
    saveLib();
    // حذف الصور المصغّرة اليتيمة
    const keep = new Set(Object.values(videos).map((v) => v.thumb).filter(Boolean));
    try {
      for (const name of await fsp.readdir(thumbDir)) if (!keep.has(name)) await fsp.unlink(path.join(thumbDir, name)).catch(() => {});
    } catch { /* لا مجلد بعد */ }
    send('library:updated', { ...publicLibrary(), stats });
    return stats;
  } finally {
    scanning = false;
  }
}

function setupWatchers() {
  for (const w of watchers) { try { w.close(); } catch { /* مغلق */ } }
  watchers = [];
  if (!settings().watchFolders) return;
  for (const folder of lib().folders) {
    try {
      const w = fs.watch(folder, { recursive: true }, (_ev, name) => {
        if (!name) return;
        const ext = path.extname(String(name)).toLowerCase();
        if (!scanner.VIDEO_EXT.has(ext)) return;
        clearTimeout(watchTimer);
        watchTimer = setTimeout(() => runScan().catch(() => {}), 2500);
      });
      w.on('error', () => {});
      watchers.push(w);
    } catch { /* مجلد غير متاح */ }
  }
}

async function addFolders(folders) {
  const l = lib();
  let changed = false;
  for (const f of folders) {
    const abs = path.resolve(f);
    if (!l.folders.some((x) => path.resolve(x) === abs)) { l.folders.push(abs); changed = true; }
  }
  if (changed) saveLib();
  await runScan();
  setupWatchers();
  return publicLibrary();
}

/** يفتح ملف فيديو منفرد (من سطر الأوامر أو ارتباط الملفات): يضيف مجلده ويشغّله. */
async function openVideoFiles(files) {
  const vids = files.filter((f) => scanner.VIDEO_EXT.has(path.extname(f).toLowerCase()));
  if (!vids.length) return;
  const folders = [...new Set(vids.map((f) => path.dirname(path.resolve(f))))];
  const l = lib();
  const covered = (dir) => l.folders.some((root) => path.resolve(dir).startsWith(path.resolve(root)));
  const missing = folders.filter((d) => !covered(d));
  if (missing.length) await addFolders(missing);
  const id = scanner.videoId(vids[0]);
  if (lib().videos[id]) send('app:open', { id });
}

function argvFiles(argv) {
  return argv.slice(1).filter((a) => !a.startsWith('-') && scanner.VIDEO_EXT.has(path.extname(a).toLowerCase()) && fs.existsSync(a));
}

// ————————————————————————————————— سجل المستخدم

function touchHistory(id) {
  const u = user();
  u.history = [{ id, at: Date.now() }, ...u.history.filter((h) => h.id !== id)].slice(0, 2000);
  u.lastPlayed[id] = Date.now();
  saveUser();
}

// ————————————————————————————————— IPC

function registerIpc() {
  handle('app:info', () => ({
    name: APP_NAME, version: app.getVersion(), creator: CREATOR, dataDir, platform: process.platform,
    dark: nativeTheme.shouldUseDarkColors,
  }));
  handle('shell:open', (url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); });
  handle('shell:reveal', (id) => { const v = lib().videos[id]; if (v) shell.showItemInFolder(v.path); });

  handle('window:minimize', () => win.minimize());
  handle('window:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
  handle('window:close', () => win.close());
  handle('window:fullscreen', (on) => win.setFullScreen(Boolean(on)));

  handle('settings:get', () => ({ ...settings(), aiKeySet: ai.hasKey(), lockEnabled: fs.existsSync(path.join(dataDir, 'lock.json')) }));
  handle('settings:set', (patch) => {
    const s = settings();
    const before = { channelMode: s.channelMode, watchFolders: s.watchFolders };
    Object.assign(s, patch || {});
    store.write('settings.json');
    if (before.watchFolders !== s.watchFolders) setupWatchers();
    if (before.channelMode !== s.channelMode) runScan().catch(() => {});
    return s;
  });

  handle('library:get', () => publicLibrary());
  handle('library:addFolder', async () => {
    const res = await dialog.showOpenDialog(win, { title: 'اختر مجلد الفيديوهات', properties: ['openDirectory', 'multiSelections'] });
    if (res.canceled || !res.filePaths.length) return publicLibrary();
    return addFolders(res.filePaths);
  });
  handle('library:addPaths', async (paths) => {
    const list = Array.isArray(paths) ? paths : [];
    const dirs = []; const files = [];
    for (const p of list) {
      try { (fs.statSync(p).isDirectory() ? dirs : files).push(p); } catch { /* تجاهل */ }
    }
    if (files.length) dirs.push(...new Set(files.map((f) => path.dirname(f))));
    if (dirs.length) await addFolders(dirs);
    return publicLibrary();
  });
  handle('library:removeFolder', async (folder) => {
    const l = lib();
    l.folders = l.folders.filter((f) => path.resolve(f) !== path.resolve(folder));
    saveLib();
    await runScan();
    setupWatchers();
    return publicLibrary();
  });
  handle('library:scan', () => runScan());
  handle('library:pending', () => Object.values(lib().videos)
    .filter((v) => !v.probed || (!v.thumb && v.playable !== false))
    .map((v) => ({ id: v.id, url: videoUrl(v) })));
  handle('library:resetThumbs', async () => {
    for (const v of Object.values(lib().videos)) { v.thumb = null; v.probed = false; v.playable = undefined; }
    saveLib();
    try { for (const name of await fsp.readdir(thumbDir)) await fsp.unlink(path.join(thumbDir, name)).catch(() => {}); } catch { /* لا مجلد */ }
    return publicLibrary();
  });
  handle('library:probe', (id, info) => {
    const v = lib().videos[id];
    if (!v) return null;
    v.duration = Math.max(0, Number(info?.duration) || 0);
    v.width = Number(info?.width) || 0;
    v.height = Number(info?.height) || 0;
    v.probed = true;
    if (info && info.error) v.playable = false; else v.playable = true;
    saveLib();
    return v;
  });
  handle('library:saveThumb', async (id, buf, at) => {
    const v = lib().videos[id];
    if (!v || !buf) return null;
    const name = `${v.id}.jpg`;
    await fsp.writeFile(path.join(thumbDir, name), Buffer.from(buf));
    v.thumb = `${name}?v=${Date.now()}`;
    if (at != null) { user().thumbAt[id] = Number(at) || 0; saveUser(); }
    saveLib();
    return v.thumb;
  });

  handle('user:get', () => user());
  handle('user:like', (id, val) => {
    const u = user();
    const n = Number(val) || 0;
    if (!n) { delete u.likes[id]; delete u.likedAt[id]; } else { u.likes[id] = n > 0 ? 1 : -1; u.likedAt[id] = Date.now(); }
    saveUser();
    return u.likes[id] || 0;
  });
  handle('user:watchLater', (id, on) => {
    const u = user();
    u.watchLater = u.watchLater.filter((x) => x !== id);
    if (on) u.watchLater.unshift(id);
    saveUser();
    return u.watchLater;
  });
  handle('user:progress', (id, pos, dur) => {
    const u = user();
    u.progress[id] = { pos: Number(pos) || 0, dur: Number(dur) || 0, at: Date.now() };
    saveUser();
  });
  handle('user:played', (id) => {
    const u = user();
    u.playCount[id] = (u.playCount[id] || 0) + 1;
    touchHistory(id);
    return u.playCount[id];
  });
  handle('user:markWatched', (id, on) => {
    const u = user();
    const v = lib().videos[id];
    if (on) {
      u.progress[id] = { pos: v?.duration || 1, dur: v?.duration || 1, at: Date.now() };
      if (!u.playCount[id]) u.playCount[id] = 1;
    } else {
      delete u.progress[id];
    }
    saveUser();
  });
  handle('user:override', (id, patch) => {
    const u = user();
    const cur = u.overrides[id] || {};
    const next = { ...cur };
    if (patch && typeof patch === 'object') {
      if ('title' in patch) next.title = String(patch.title || '').slice(0, 200);
      if ('description' in patch) next.description = String(patch.description || '').slice(0, 4000);
      if ('tags' in patch) next.tags = (Array.isArray(patch.tags) ? patch.tags : []).map((t) => String(t).trim()).filter(Boolean).slice(0, 20);
      if ('channel' in patch) next.channel = String(patch.channel || '').slice(0, 80);
    }
    next.at = Date.now();
    u.overrides[id] = next;
    saveUser();
    return next;
  });
  handle('user:subscribe', (channelId, on) => {
    const u = user();
    if (on) u.subscriptions[channelId] = { at: Date.now() }; else delete u.subscriptions[channelId];
    saveUser();
    return Boolean(u.subscriptions[channelId]);
  });
  handle('user:hide', (id, on) => { const u = user(); if (on) u.hidden[id] = true; else delete u.hidden[id]; saveUser(); });
  handle('user:notInterested', (cid, on) => { const u = user(); if (on) u.notInterested[cid] = true; else delete u.notInterested[cid]; saveUser(); });
  handle('user:clearHistory', () => { const u = user(); u.history = []; saveUser(); });
  handle('user:removeHistory', (id) => { const u = user(); u.history = u.history.filter((h) => h.id !== id); saveUser(); });
  handle('user:comment', (id, text) => {
    const u = user();
    const t = String(text || '').trim().slice(0, 2000);
    if (!t) return u.comments[id] || [];
    u.comments[id] = [{ id: crypto.randomBytes(5).toString('hex'), text: t, at: Date.now() }, ...(u.comments[id] || [])];
    saveUser();
    return u.comments[id];
  });
  handle('user:deleteComment', (id, cid) => {
    const u = user();
    u.comments[id] = (u.comments[id] || []).filter((c) => c.id !== cid);
    saveUser();
    return u.comments[id];
  });

  handle('playlist:list', () => store.read('playlists.json').items);
  handle('playlist:create', (data) => {
    const p = store.read('playlists.json');
    const item = playlists.create(data || {});
    p.items.unshift(item);
    store.write('playlists.json');
    return item;
  });
  handle('playlist:update', (id, patch) => {
    const p = store.read('playlists.json');
    const item = p.items.find((x) => x.id === id);
    if (!item) throw new Error('NOT_FOUND');
    if (patch.name != null) item.name = String(patch.name).slice(0, 80);
    if (patch.description != null) item.description = String(patch.description).slice(0, 400);
    if (Array.isArray(patch.videos)) item.videos = [...new Set(patch.videos)];
    item.updatedAt = Date.now();
    store.write('playlists.json');
    return item;
  });
  handle('playlist:delete', (id) => {
    const p = store.read('playlists.json');
    p.items = p.items.filter((x) => x.id !== id);
    store.write('playlists.json');
  });
  handle('playlist:add', (id, ids) => {
    const p = store.read('playlists.json');
    const item = p.items.find((x) => x.id === id);
    if (!item) throw new Error('NOT_FOUND');
    for (const vid of ids || []) if (!item.videos.includes(vid)) item.videos.push(vid);
    item.updatedAt = Date.now();
    store.write('playlists.json');
    return item;
  });
  handle('playlist:removeVideo', (id, vid) => {
    const p = store.read('playlists.json');
    const item = p.items.find((x) => x.id === id);
    if (!item) throw new Error('NOT_FOUND');
    item.videos = item.videos.filter((x) => x !== vid);
    item.updatedAt = Date.now();
    store.write('playlists.json');
    return item;
  });

  handle('feed:home', (opts) => recommend.homeFeed(lib().videos, user(), opts || {}));
  handle('feed:related', (id) => recommend.related(lib().videos[id], lib().videos, user()));
  handle('feed:search', (q) => recommend.search(q, lib().videos, user()));

  handle('subtitles:list', async (id) => {
    const v = lib().videos[id];
    if (!v) return [];
    const list = await subtitles.findSidecars(v.path);
    return list.map((s) => ({ ...s, url: `liwa://sub/${encodePath(s.path)}` }));
  });

  // ---- الذكاء الاصطناعي
  handle('ai:status', () => ({ enabled: settings().aiEnabled, hasKey: ai.hasKey(), model: settings().aiModel || DEFAULT_MODEL, models: MODELS }));
  handle('ai:setKey', (key) => { const r = ai.setKey(key); settings().aiKeySet = r.hasKey; store.write('settings.json'); return r; });
  handle('ai:clearKey', () => { ai.clearKey(); settings().aiKeySet = false; store.write('settings.json'); return { hasKey: false }; });
  handle('ai:analyze', async (id, frames, subs) => {
    const v = lib().videos[id];
    if (!v) throw new Error('NOT_FOUND');
    const s = settings();
    const result = await ai.analyzeVideo({ video: v, frames, subtitles: subs || '', model: s.aiModel, lang: s.lang });
    const u = user();
    u.ai[id] = result;
    saveUser();
    return result;
  });
  handle('ai:clearAnalysis', (id) => { const u = user(); delete u.ai[id]; saveUser(); });
  handle('ai:search', async (query) => {
    const s = settings();
    const pre = recommend.search(query, lib().videos, user(), { limit: 60 }).map((r) => r.id);
    return ai.semanticSearch({ query, videos: lib().videos, userdata: user(), model: s.aiModel, prefilter: pre });
  });
  handle('ai:forYou', async () => {
    const s = settings();
    const cand = recommend.homeFeed(lib().videos, user(), { limit: 150, seed: Date.now() }).map((x) => x.id);
    return ai.forYou({ videos: lib().videos, userdata: user(), candidates: cand, model: s.aiModel });
  });
  handle('ai:smartPlaylist', async (prompt) => {
    const s = settings();
    const r = await ai.smartPlaylist({ prompt, videos: lib().videos, userdata: user(), model: s.aiModel });
    const p = store.read('playlists.json');
    const item = playlists.create({ name: r.name, description: r.description, videos: r.picks.map((x) => x.id), ai: { prompt, picks: r.picks, at: Date.now() } });
    p.items.unshift(item);
    store.write('playlists.json');
    return item;
  });
  handle('ai:ask', async (id, question, history, frames, subs) => {
    const v = lib().videos[id];
    if (!v) throw new Error('NOT_FOUND');
    const s = settings();
    const text = await ai.askVideo({
      video: v, analysis: user().ai[id], frames, subtitles: subs || '', history: history || [], question, lang: s.lang, model: s.aiModel,
      onDelta: (delta) => send('ai:askDelta', { id, delta }),
    });
    return text;
  });
  handle('ai:insights', () => ai.insights({ videos: lib().videos, userdata: user(), model: settings().aiModel, lang: settings().lang }));

  // ---- القفل
  const lockFile = () => path.join(dataDir, 'lock.json');
  const readLock = () => { try { return JSON.parse(fs.readFileSync(lockFile(), 'utf8')); } catch { return null; } };
  handle('lock:status', () => ({ enabled: Boolean(readLock()) }));
  handle('lock:verify', (pin) => lock.verifyPin(pin, readLock()));
  handle('lock:setPin', (pin, current) => {
    const cur = readLock();
    if (cur && !lock.verifyPin(current, cur)) throw new Error('WRONG_PIN');
    if (!lock.validPin(pin)) throw new Error('INVALID_PIN');
    fs.writeFileSync(lockFile(), JSON.stringify(lock.hashPin(pin)), { mode: 0o600 });
    settings().lockEnabled = true; store.write('settings.json');
    return { enabled: true };
  });
  handle('lock:clearPin', (pin) => {
    const cur = readLock();
    if (cur && !lock.verifyPin(pin, cur)) throw new Error('WRONG_PIN');
    try { fs.unlinkSync(lockFile()); } catch { /* غير موجود */ }
    settings().lockEnabled = false; store.write('settings.json');
    return { enabled: false };
  });
}

// ————————————————————————————————— النافذة

function createWindow() {
  win = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0f0f0f',
    title: APP_NAME,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  const state = () => send('window:state', { maximized: win.isMaximized(), fullscreen: win.isFullScreen() });
  win.on('maximize', state); win.on('unmaximize', state);
  win.on('enter-full-screen', state); win.on('leave-full-screen', state);
  win.webContents.on('did-finish-load', () => {
    state();
    if (pendingOpen.length) { const files = pendingOpen; pendingOpen = []; openVideoFiles(files).catch(() => {}); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.on('closed', () => { win = null; });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    const files = argvFiles(argv);
    if (files.length) openVideoFiles(files).catch(() => {});
  });

  app.whenReady().then(async () => {
    dataDir = path.join(app.getPath('userData'), 'data');
    thumbDir = path.join(dataDir, 'thumbs');
    fs.mkdirSync(thumbDir, { recursive: true });
    store = new Store(dataDir);
    ai = new AI({ dir: dataDir, safeStorage });
    registerProtocol();
    registerIpc();
    createWindow();
    setupWatchers();
    pendingOpen = argvFiles(process.argv);
    // مسح تزايدي هادئ عند البدء
    setTimeout(() => runScan().catch(() => {}), 1200);
  });

  app.on('window-all-closed', async () => {
    try { await store.flushAll(); } catch { /* تجاهل */ }
    app.quit();
  });
  app.on('before-quit', async () => { try { await store.flushAll(); } catch { /* تجاهل */ } });
}
