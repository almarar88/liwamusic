'use strict';
/**
 * LiwaMusic — العملية الرئيسية.
 * مشغّل وفهرس موسيقى لويندوز يعمل بالإنترنت والذكاء الاصطناعي.
 * تم إنشاؤه عن طريق LiwaMusic.
 */
const {
  app, BrowserWindow, ipcMain, dialog, protocol, shell,
  globalShortcut, safeStorage, nativeTheme, Menu, nativeImage,
} = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');

const { serveFile, encodePath, decodePath, MIME } = require('./lib/filestream');

const { Store } = require('./lib/store');
const scanner = require('./lib/scanner');
const online = require('./lib/online');
const playlists = require('./lib/playlists');
const { AI, MODELS, DEFAULT_MODEL } = require('./lib/ai');
const { Drive } = require('./lib/drive');
const { Artwork } = require('./lib/artwork');
const sync = require('./lib/sync');

const APP_NAME = 'LiwaMusic';
const CREATOR = 'تم إنشاؤه عن طريق LiwaMusic';

let win = null;
let store = null;
let ai = null;
let drive = null;
let artwork = null;
let dataDir = null;
let artDir = null;
let lyricsDir = null;
let driveCacheDir = null;
let scanning = false;
let driveScanning = false;
let watchers = [];
let miniMode = false;
let normalBounds = null;
let syncTimer = null;

// ————————————————————————————————— البروتوكول الآمن للملفات المحلية

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'liwa',
    privileges: {
      standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true,
    },
  },
]);

function registerProtocol() {
  protocol.handle('liwa', async (request) => {
    try {
      const url = new URL(request.url);
      const host = url.hostname;
      const key = decodeURIComponent(url.pathname.replace(/^\//, ''));
      if (!key) return new Response('Bad request', { status: 400 });

      if (host === 'audio') {
        const filePath = decodePath(key);
        const known = store.read('library.json').tracks[scanner.trackId(filePath)];
        if (!known) return new Response('Forbidden', { status: 403 });
        return await serveFile(filePath, request.headers.get('range'));
      }
      if (host === 'drive') {
        const [fileId, ext] = key.split('.');
        const t = Object.values(store.read('library.json').tracks)
          .find((x) => x.source === 'drive' && x.driveId === fileId);
        if (!t) return new Response('Forbidden', { status: 403 });
        const mime = MIME[`.${ext || t.ext}`] || 'audio/mpeg';
        return await drive.serve(fileId, ext || t.ext, request.headers.get('range'), mime);
      }
      if (host === 'art') {
        const safe = path.basename(key);
        return await serveFile(path.join(artDir, safe), null);
      }
      return new Response('Not found', { status: 404 });
    } catch (err) {
      return new Response(`Error: ${err.message}`, { status: 500 });
    }
  });
}

// ————————————————————————————————— النافذة

function createWindow() {
  const settings = store.read('settings.json');
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 380,
    minHeight: 120,
    show: false,
    frame: false,
    backgroundColor: settings.theme === 'light' ? '#f4f4f7' : '#0b0b12',
    title: APP_NAME,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
  win.on('maximize', () => send('window:state', { maximized: true }));
  win.on('unmaximize', () => send('window:state', { maximized: false }));

  // فتح الروابط الخارجية في المتصفح لا داخل التطبيق
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  Menu.setApplicationMenu(null);
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ————————————————————————————————— مساعدات المكتبة

function libraryPayload() {
  const lib = store.read('library.json');
  return {
    folders: lib.folders,
    tracks: Object.values(lib.tracks),
    userdata: store.read('userdata.json'),
    playlists: store.read('playlists.json').items,
  };
}

async function runScan({ force = false } = {}) {
  if (scanning) return { ok: false, error: 'BUSY' };
  scanning = true;
  const lib = store.read('library.json');
  try {
    const started = Date.now();
    const { tracks, stats } = await scanner.scanFolders({
      folders: lib.folders,
      existing: lib.tracks,
      artDir,
      force,
      onProgress: (p) => send('library:progress', p),
    });
    lib.tracks = tracks;
    store.write('library.json', lib);
    await store.flush('library.json');
    send('library:updated', libraryPayload());
    send('library:progress', { phase: 'done', ...stats, ms: Date.now() - started });
    return { ok: true, stats };
  } catch (err) {
    send('library:progress', { phase: 'error', error: String(err.message || err) });
    return { ok: false, error: String(err.message || err) };
  } finally {
    scanning = false;
    setupWatchers();
  }
}

/** مراقبة المجلدات لالتقاط الملفات الجديدة تلقائيًا. */
function setupWatchers() {
  for (const w of watchers) { try { w.close(); } catch { /* مغلق */ } }
  watchers = [];
  const settings = store.read('settings.json');
  if (!settings.watchFolders) return;
  let timer = null;
  for (const folder of store.read('library.json').folders) {
    try {
      const w = fs.watch(folder, { recursive: true, persistent: false }, (_e, file) => {
        if (!file) return;
        if (!scanner.AUDIO_EXT.has(path.extname(String(file)).toLowerCase())) return;
        clearTimeout(timer);
        timer = setTimeout(() => { if (!scanning) runScan({ force: false }); }, 4000);
      });
      watchers.push(w);
    } catch { /* بعض أنظمة الملفات لا تدعم المراقبة المتكررة */ }
  }
}

/** فهرسة مجلدات Google Drive المختارة. */
async function runDriveScan({ enrich = true } = {}) {
  if (driveScanning) return { ok: false, error: 'BUSY' };
  if (!drive.isConnected()) return { ok: false, error: 'NOT_CONNECTED' };
  driveScanning = true;
  const settings = store.read('settings.json');
  const lib = store.read('library.json');
  const folders = settings.driveFolders || [];
  try {
    const seen = new Map();
    for (const folder of folders) {
      send('library:progress', { phase: 'drive-walk', folder: folder.name, found: seen.size });
      // eslint-disable-next-line no-await-in-loop
      const files = await drive.walkAudio(folder.id, (p) => {
        send('library:progress', { phase: 'drive-walk', folder: folder.name, found: seen.size + p.found });
      });
      for (const f of files) if (!seen.has(f.id)) seen.set(f.id, { file: f, folderName: folder.name });
    }

    const previous = lib.tracks;
    let added = 0; let kept = 0;
    const driveIds = new Set();
    for (const [fileId, { file, folderName }] of seen) {
      const track = Drive.toTrack(file, folderName);
      driveIds.add(track.id);
      const prev = previous[track.id];
      if (prev && prev.md5 === track.md5 && prev.size === track.size) {
        previous[track.id] = { ...prev, folder: folderName };
        kept++;
      } else {
        previous[track.id] = prev ? { ...track, addedAt: prev.addedAt } : track;
        added++;
      }
    }
    // إزالة ملفات درايف التي لم تعد موجودة
    let removed = 0;
    for (const [id, t] of Object.entries(previous)) {
      if (t.source === 'drive' && !driveIds.has(id)) { delete previous[id]; removed++; }
    }
    lib.tracks = previous;
    store.write('library.json', lib);
    await store.flush('library.json');
    send('library:updated', libraryPayload());
    send('library:progress', { phase: 'done', total: seen.size, added, skipped: kept, updated: 0, failed: 0, removed });

    if (enrich) enrichDriveTags().catch(() => {});
    return { ok: true, stats: { total: seen.size, added, skipped: kept, removed } };
  } catch (err) {
    send('library:progress', { phase: 'error', error: String(err.message || err) });
    return { ok: false, error: String(err.message || err) };
  } finally {
    driveScanning = false;
  }
}

/** يقرأ وسوم ملفات درايف تدريجيًا عبر تنزيل مقطع صغير من كل ملف. */
async function enrichDriveTags(limit = 0) {
  const lib = store.read('library.json');
  const pending = Object.values(lib.tracks)
    .filter((t) => t.source === 'drive' && !t.tagged)
    .slice(0, limit || undefined);
  if (!pending.length) return { enriched: 0 };
  let done = 0;
  for (const t of pending) {
    try {
      // 512KB تكفي لوسوم ID3 وغلافها في الغالبية العظمى من الملفات
      // eslint-disable-next-line no-await-in-loop
      const head = await drive.readRange(t.driveId, 0, 512 * 1024 - 1);
      // eslint-disable-next-line no-await-in-loop
      const tags = await scanner.readTagsFromBuffer(head, {
        mimeType: MIME[`.${t.ext}`], size: t.size, artDir, keyHint: t.driveId,
      });
      const fresh = store.read('library.json');
      if (fresh.tracks[t.id]) {
        Object.assign(fresh.tracks[t.id], tags, { tagged: true });
        store.write('library.json', fresh);
      }
      done++;
    } catch {
      const fresh = store.read('library.json');
      if (fresh.tracks[t.id]) { fresh.tracks[t.id].tagged = true; store.write('library.json', fresh); }
    }
    if (done % 10 === 0 || done === pending.length) {
      send('drive:enrich', { done, total: pending.length });
      send('library:updated', libraryPayload());
    }
  }
  await store.flush('library.json');
  send('library:updated', libraryPayload());
  return { enriched: done };
}

/** مزامنة بيانات المستخدم والقوائم مع ملف مخفي في Google Drive. */
async function runSync({ upload = true } = {}) {
  if (!drive.isConnected()) return { ok: false, error: 'NOT_CONNECTED' };
  const settings = store.read('settings.json');
  if (!settings.driveSync) return { ok: false, error: 'SYNC_DISABLED' };
  try {
    const remote = await drive.downloadSync();
    const localUser = store.read('userdata.json');
    const localPl = store.read('playlists.json');

    if (remote && remote.data && remote.data.userdata) {
      const merged = sync.mergeUserData(localUser, remote.data.userdata);
      Object.assign(localUser, merged);
      store.write('userdata.json', localUser);

      const plMerge = sync.mergePlaylists(
        localPl.items, remote.data.playlists || [],
        localPl.deleted || {}, remote.data.deletedPlaylists || {},
      );
      localPl.items = plMerge.items;
      localPl.deleted = plMerge.deleted;
      store.write('playlists.json', localPl);
      await store.flushAll();
      send('library:updated', libraryPayload());
    }

    if (upload) {
      await drive.uploadSync(sync.buildPayload({
        userdata: store.read('userdata.json'),
        playlists: store.read('playlists.json').items,
        deletedPlaylists: store.read('playlists.json').deleted || {},
        deviceId: `${process.platform}-${app.getVersion()}`,
      }));
    }
    const s = store.read('settings.json');
    s.lastSyncAt = Date.now();
    store.write('settings.json', s);
    send('sync:done', { at: s.lastSyncAt });
    return { ok: true, at: s.lastSyncAt };
  } catch (err) {
    send('sync:error', { error: String(err.message || err) });
    return { ok: false, error: String(err.message || err) };
  }
}

function scheduleSync() {
  clearInterval(syncTimer);
  const settings = store.read('settings.json');
  if (!settings.driveSync || !drive.isConnected()) return;
  const minutes = Math.max(5, Number(settings.syncMinutes) || 15);
  syncTimer = setInterval(() => { runSync({ upload: true }).catch(() => {}); }, minutes * 60000);
}

/** يضع طابعًا زمنيًا لتغييرات المستخدم كي تُدمج المزامنة بشكل صحيح. */
function stamp(map, id) {
  const m = map || {};
  m[id] = Date.now();
  return m;
}

async function addFolders(folders) {
  const lib = store.read('library.json');
  let changed = false;
  for (const folder of folders) {
    const resolved = path.resolve(folder);
    if (!lib.folders.some((f) => path.resolve(f) === resolved)) {
      lib.folders.push(resolved);
      changed = true;
    }
  }
  if (changed) { store.write('library.json', lib); await store.flush('library.json'); }
  return runScan({ force: false });
}

const getTrack = (id) => store.read('library.json').tracks[id] || null;

function trackWithOverrides(id) {
  const t = getTrack(id);
  if (!t) return null;
  const ov = (store.read('userdata.json').overrides || {})[id];
  return ov ? { ...t, ...ov } : t;
}

// ————————————————————————————————— IPC

function registerIPC() {
  const handle = (channel, fn) => ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; } catch (err) {
      return { ok: false, error: String((err && err.message) || err), code: err && err.code };
    }
  });

  // — التطبيق والنافذة
  handle('app:info', () => ({
    name: APP_NAME,
    creator: CREATOR,
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    dataDir,
    models: MODELS,
    defaultModel: DEFAULT_MODEL,
  }));
  handle('window:minimize', () => { win.minimize(); return true; });
  handle('window:maximize', () => {
    if (win.isMaximized()) win.unmaximize(); else win.maximize();
    return win.isMaximized();
  });
  handle('window:close', () => { win.close(); return true; });
  handle('window:mini', (on) => {
    miniMode = on === undefined ? !miniMode : !!on;
    if (miniMode) {
      normalBounds = win.getBounds();
      if (win.isMaximized()) win.unmaximize();
      win.setBounds({ ...win.getBounds(), width: 420, height: 148 });
      win.setAlwaysOnTop(true, 'floating');
    } else {
      win.setAlwaysOnTop(false);
      if (normalBounds) win.setBounds(normalBounds);
    }
    return miniMode;
  });
  handle('window:progress', (value) => {
    if (win) win.setProgressBar(value > 0 && value < 1 ? value : -1);
    return true;
  });
  handle('shell:reveal', (id) => {
    const t = getTrack(id);
    if (!t) throw new Error('NOT_FOUND');
    shell.showItemInFolder(t.path);
    return true;
  });
  handle('shell:open', (url) => {
    if (!/^https?:\/\//i.test(String(url))) throw new Error('BAD_URL');
    shell.openExternal(url);
    return true;
  });

  // — الإعدادات
  handle('settings:get', () => store.read('settings.json'));
  handle('settings:set', async (patch) => {
    const s = Object.assign(store.read('settings.json'), patch || {});
    store.write('settings.json', s);
    if (patch && 'watchFolders' in patch) setupWatchers();
    if (patch && 'theme' in patch) nativeTheme.themeSource = patch.theme === 'light' ? 'light' : 'dark';
    return s;
  });

  // — المكتبة
  handle('library:get', () => libraryPayload());
  handle('library:addFolder', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'اختر مجلد الأغاني',
      properties: ['openDirectory', 'multiSelections'],
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    return addFolders(res.filePaths);
  });
  handle('library:addPaths', async (paths) => {
    const folders = [];
    for (const p of paths || []) {
      try {
        const st = await fsp.stat(p);
        folders.push(st.isDirectory() ? p : path.dirname(p));
      } catch { /* تجاهل */ }
    }
    if (!folders.length) throw new Error('NO_FOLDERS');
    return addFolders(folders);
  });
  handle('library:removeFolder', async (folder) => {
    const lib = store.read('library.json');
    lib.folders = lib.folders.filter((f) => path.resolve(f) !== path.resolve(folder));
    for (const [id, t] of Object.entries(lib.tracks)) {
      if (path.resolve(t.path).startsWith(path.resolve(folder) + path.sep)) delete lib.tracks[id];
    }
    store.write('library.json', lib);
    await store.flush('library.json');
    setupWatchers();
    send('library:updated', libraryPayload());
    return true;
  });
  handle('library:scan', (opts) => runScan(opts || {}));
  handle('library:duplicates', () => {
    const lib = store.read('library.json');
    return scanner.findDuplicates(lib.tracks).map((ids) => ids.map((id) => lib.tracks[id]));
  });
  handle('library:export', async () => {
    const res = await dialog.showSaveDialog(win, {
      title: 'تصدير المكتبة',
      defaultPath: `LiwaMusic-library-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled) return { canceled: true };
    const payload = {
      app: APP_NAME,
      creator: CREATOR,
      exportedAt: new Date().toISOString(),
      library: store.read('library.json'),
      userdata: store.read('userdata.json'),
      playlists: store.read('playlists.json'),
    };
    await fsp.writeFile(res.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { path: res.filePath };
  });
  handle('library:import', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'استيراد مكتبة',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePaths[0]) return { canceled: true };
    const data = JSON.parse(await fsp.readFile(res.filePaths[0], 'utf8'));
    if (data.library) { store.write('library.json', data.library); await store.flush('library.json'); }
    if (data.userdata) { store.write('userdata.json', data.userdata); await store.flush('userdata.json'); }
    if (data.playlists) { store.write('playlists.json', data.playlists); await store.flush('playlists.json'); }
    store.cache.clear();
    send('library:updated', libraryPayload());
    return { imported: true };
  });

  // — بيانات المستخدم (مفضلة، تقييم، إحصاءات)
  handle('user:get', () => store.read('userdata.json'));
  handle('user:favorite', (id, on) => {
    const u = store.read('userdata.json');
    if (on) u.favorites[id] = true; else delete u.favorites[id];
    u.favAt = stamp(u.favAt, id);
    store.write('userdata.json', u);
    return !!u.favorites[id];
  });
  handle('user:rate', (id, stars) => {
    const u = store.read('userdata.json');
    const n = Math.max(0, Math.min(5, Number(stars) || 0));
    if (n) u.ratings[id] = n; else delete u.ratings[id];
    u.ratedAt = stamp(u.ratedAt, id);
    store.write('userdata.json', u);
    return n;
  });
  handle('user:played', (id) => {
    const u = store.read('userdata.json');
    u.playCount[id] = (u.playCount[id] || 0) + 1;
    u.lastPlayed[id] = Date.now();
    u.history.unshift({ id, at: Date.now() });
    if (u.history.length > 1000) u.history.length = 1000;
    store.write('userdata.json', u);
    return u.playCount[id];
  });
  handle('user:override', (id, patch) => {
    const u = store.read('userdata.json');
    const cur = u.overrides[id] || {};
    const next = { ...cur, ...(patch || {}) };
    for (const k of Object.keys(next)) {
      if (k === 'at') continue;
      if (next[k] === '' || next[k] == null) delete next[k];
    }
    const keys = Object.keys(next).filter((k) => k !== 'at');
    if (keys.length) { next.at = Date.now(); u.overrides[id] = next; } else delete u.overrides[id];
    store.write('userdata.json', u);
    return u.overrides[id] || null;
  });

  /** تعديل جماعي للوسوم على مجموعة أغانٍ. */
  handle('user:bulkOverride', (ids, patch) => {
    const u = store.read('userdata.json');
    const clean = {};
    for (const [k, v] of Object.entries(patch || {})) {
      if (v === '' || v == null) continue;
      clean[k] = k === 'year' ? Number(v) || 0 : v;
    }
    if (!Object.keys(clean).length) throw new Error('EMPTY_PATCH');
    let n = 0;
    for (const id of ids || []) {
      u.overrides[id] = { ...(u.overrides[id] || {}), ...clean, at: Date.now() };
      n++;
    }
    store.write('userdata.json', u);
    return { updated: n };
  });
  handle('user:clearHistory', () => {
    const u = store.read('userdata.json');
    u.history = [];
    store.write('userdata.json', u);
    return true;
  });

  // — قوائم التشغيل
  handle('playlist:list', () => store.read('playlists.json').items);
  handle('playlist:create', (data) => {
    const db = store.read('playlists.json');
    const pl = playlists.create(data || {});
    db.items.unshift(pl);
    store.write('playlists.json', db);
    return pl;
  });
  handle('playlist:update', (id, patch) => {
    const db = store.read('playlists.json');
    const pl = db.items.find((p) => p.id === id);
    if (!pl) throw new Error('NOT_FOUND');
    Object.assign(pl, patch || {}, { updatedAt: Date.now() });
    store.write('playlists.json', db);
    return pl;
  });
  handle('playlist:delete', (id) => {
    const db = store.read('playlists.json');
    db.items = db.items.filter((p) => p.id !== id);
    db.deleted = db.deleted || {};
    db.deleted[id] = Date.now();      // شاهد حذف كي لا تعود القائمة من المزامنة
    store.write('playlists.json', db);
    return true;
  });
  handle('playlist:addTracks', (id, ids) => {
    const db = store.read('playlists.json');
    const pl = db.items.find((p) => p.id === id);
    if (!pl) throw new Error('NOT_FOUND');
    for (const tid of ids || []) if (!pl.tracks.includes(tid)) pl.tracks.push(tid);
    pl.updatedAt = Date.now();
    store.write('playlists.json', db);
    return pl;
  });
  handle('playlist:exportM3U', async (id) => {
    const db = store.read('playlists.json');
    const pl = db.items.find((p) => p.id === id);
    if (!pl) throw new Error('NOT_FOUND');
    const lib = store.read('library.json');
    const tracks = pl.tracks.map((tid) => lib.tracks[tid]).filter(Boolean);
    const res = await dialog.showSaveDialog(win, {
      title: 'تصدير قائمة التشغيل',
      defaultPath: `${pl.name}.m3u8`,
      filters: [{ name: 'M3U8', extensions: ['m3u8', 'm3u'] }],
    });
    if (res.canceled) return { canceled: true };
    await fsp.writeFile(res.filePath, playlists.toM3U(tracks), 'utf8');
    return { path: res.filePath, count: tracks.length };
  });
  handle('playlist:importM3U', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'استيراد قائمة تشغيل',
      properties: ['openFile'],
      filters: [{ name: 'قوائم التشغيل', extensions: ['m3u', 'm3u8'] }],
    });
    if (res.canceled || !res.filePaths[0]) return { canceled: true };
    const paths = await playlists.fromM3U(res.filePaths[0]);
    const lib = store.read('library.json');
    const ids = [];
    const missing = [];
    for (const p of paths) {
      const id = scanner.trackId(p);
      if (lib.tracks[id]) ids.push(id); else missing.push(p);
    }
    const db = store.read('playlists.json');
    const pl = playlists.create({
      name: path.basename(res.filePaths[0]).replace(/\.[^.]+$/, ''),
      description: `مستوردة من ${path.basename(res.filePaths[0])}`,
      tracks: ids,
    });
    db.items.unshift(pl);
    store.write('playlists.json', db);
    return { playlist: pl, imported: ids.length, missing: missing.length };
  });

  // — الإنترنت
  handle('online:status', () => online.isOnline());
  handle('online:art', async (id) => {
    const t = trackWithOverrides(id);
    if (!t) throw new Error('NOT_FOUND');
    const name = await online.fetchArtwork({
      artist: t.albumArtist || t.artist, album: t.album, title: t.title, artDir,
    });
    if (!name) return null;
    const lib = store.read('library.json');
    if (lib.tracks[id]) {
      // نطبّق الغلاف على كل أغاني الألبوم نفسه
      for (const tr of Object.values(lib.tracks)) {
        if (!tr.art && tr.album && tr.album === t.album && (tr.albumArtist || tr.artist) === (t.albumArtist || t.artist)) {
          tr.art = name;
        }
      }
      lib.tracks[id].art = name;
      store.write('library.json', lib);
      send('library:updated', libraryPayload());
    }
    return name;
  });
  handle('online:lyrics', async (id) => {
    const t = trackWithOverrides(id);
    if (!t) throw new Error('NOT_FOUND');
    const cacheFile = path.join(lyricsDir, `${id}.json`);
    try { return JSON.parse(await fsp.readFile(cacheFile, 'utf8')); } catch { /* لا يوجد كاش */ }
    const data = await online.fetchLyrics({
      artist: t.artist, title: t.title, album: t.album, duration: t.duration,
    });
    if (!data) return null;
    await fsp.mkdir(lyricsDir, { recursive: true });
    await fsp.writeFile(cacheFile, JSON.stringify(data), 'utf8');
    return data;
  });
  handle('online:meta', async (id) => {
    const t = trackWithOverrides(id);
    if (!t) throw new Error('NOT_FOUND');
    return online.fetchMeta({ artist: t.artist, title: t.title, album: t.album });
  });
  handle('online:artist', (name, lang) => online.fetchArtistInfo(name, lang));

  // — الذكاء الاصطناعي
  handle('ai:status', () => ({
    hasKey: ai.hasKey() || !!process.env.ANTHROPIC_API_KEY,
    models: MODELS,
    model: store.read('settings.json').aiModel || DEFAULT_MODEL,
    encrypted: safeStorage.isEncryptionAvailable(),
  }));
  handle('ai:setKey', (key) => {
    const r = ai.setKey(key);
    const s = store.read('settings.json');
    s.aiKeySet = r.hasKey;
    store.write('settings.json', s);
    return r;
  });
  handle('ai:clearKey', () => {
    ai.clearKey();
    const s = store.read('settings.json');
    s.aiKeySet = false;
    store.write('settings.json', s);
    return true;
  });
  handle('ai:tag', async (ids) => {
    const lib = store.read('library.json');
    const model = store.read('settings.json').aiModel;
    const targets = (ids || []).map((id) => lib.tracks[id]).filter(Boolean);
    if (!targets.length) throw new Error('NO_TRACKS');
    const u = store.read('userdata.json');
    const CHUNK = 40;
    let done = 0;
    for (let i = 0; i < targets.length; i += CHUNK) {
      const batch = targets.slice(i, i + CHUNK);
      const res = await ai.tagTracks({ tracks: batch, model });
      Object.assign(u.ai, res);
      done += batch.length;
      send('ai:progress', { done, total: targets.length });
    }
    store.write('userdata.json', u);
    await store.flush('userdata.json');
    return { tagged: done };
  });
  handle('ai:playlist', async (prompt, size) => {
    const lib = store.read('library.json');
    const settings = store.read('settings.json');
    const res = await ai.smartPlaylist({
      prompt,
      tracks: lib.tracks,
      userdata: store.read('userdata.json'),
      model: settings.aiModel,
      size: size || 25,
    });
    const db = store.read('playlists.json');
    const pl = playlists.create({
      name: res.name,
      description: res.description,
      tracks: res.picks.map((p) => p.id),
      ai: { prompt, reason: res.reason, why: Object.fromEntries(res.picks.map((p) => [p.id, p.why])) },
    });
    db.items.unshift(pl);
    store.write('playlists.json', db);
    return pl;
  });
  handle('ai:search', (query) => {
    const lib = store.read('library.json');
    return ai.semanticSearch({
      query,
      tracks: lib.tracks,
      userdata: store.read('userdata.json'),
      model: store.read('settings.json').aiModel,
    });
  });
  handle('ai:radio', async (id, size) => {
    const lib = store.read('library.json');
    const seed = lib.tracks[id];
    if (!seed) throw new Error('NOT_FOUND');
    return ai.similarRadio({
      seed,
      tracks: lib.tracks,
      userdata: store.read('userdata.json'),
      model: store.read('settings.json').aiModel,
      size: size || 20,
    });
  });
  handle('ai:insights', () => ai.insights({
    tracks: store.read('library.json').tracks,
    userdata: store.read('userdata.json'),
    model: store.read('settings.json').aiModel,
  }));
  handle('ai:dj', async (id, prevId) => {
    const lib = store.read('library.json');
    const track = lib.tracks[id];
    if (!track) throw new Error('NOT_FOUND');
    const settings = store.read('settings.json');
    const text = await ai.djIntro({
      track,
      previous: prevId ? lib.tracks[prevId] : null,
      lang: settings.lang,
      model: settings.aiModel,
      onDelta: (delta) => send('ai:djDelta', { id, delta }),
    });
    send('ai:djDone', { id, text });
    return text;
  });

  // — Google Drive
  handle('drive:status', async () => {
    const settings = store.read('settings.json');
    const connected = drive.isConnected();
    let account = null;
    if (connected) { try { account = await drive.about(); } catch { account = null; } }
    const lib = store.read('library.json');
    const driveTracks = Object.values(lib.tracks).filter((t) => t.source === 'drive');
    return {
      hasClient: drive.hasClient(),
      redirectUri: Drive.redirectUriFor(Drive.PREFERRED_PORT),
      connected,
      account,
      folders: settings.driveFolders || [],
      tracks: driveTracks.length,
      untagged: driveTracks.filter((t) => !t.tagged).length,
      cache: await drive.cacheStats(),
      sync: { enabled: !!settings.driveSync, lastAt: settings.lastSyncAt || 0, minutes: settings.syncMinutes || 15 },
    };
  });
  handle('drive:setClient', (clientId, clientSecret) => drive.setClient({ clientId, clientSecret }));
  handle('drive:connect', async () => {
    const res = await drive.connect();
    scheduleSync();
    return res;
  });
  handle('drive:disconnect', () => {
    drive.disconnect();
    clearInterval(syncTimer);
    return true;
  });
  handle('drive:listFolder', (folderId) => drive.listFolder(folderId || 'root'));
  handle('drive:addFolder', async (folderId, name) => {
    const settings = store.read('settings.json');
    settings.driveFolders = settings.driveFolders || [];
    if (!settings.driveFolders.some((f) => f.id === folderId)) {
      settings.driveFolders.push({ id: folderId, name: name || await drive.folderName(folderId) });
      store.write('settings.json', settings);
      await store.flush('settings.json');
    }
    return runDriveScan();
  });
  handle('drive:removeFolder', async (folderId) => {
    const settings = store.read('settings.json');
    settings.driveFolders = (settings.driveFolders || []).filter((f) => f.id !== folderId);
    store.write('settings.json', settings);
    await store.flush('settings.json');
    return runDriveScan();
  });
  handle('drive:scan', () => runDriveScan());
  handle('drive:enrich', (limit) => enrichDriveTags(limit || 0));
  handle('drive:cacheStats', () => drive.cacheStats());
  handle('drive:clearCache', () => drive.clearCache());
  handle('drive:pin', async (ids) => {
    const lib = store.read('library.json');
    const targets = (ids || []).map((id) => lib.tracks[id]).filter((t) => t && t.source === 'drive');
    let done = 0;
    for (const t of targets) {
      // eslint-disable-next-line no-await-in-loop
      await drive.download(t.driveId, t.ext, ({ received, total }) => {
        send('drive:pinProgress', { id: t.id, received, total, done, count: targets.length });
      });
      done++;
      send('drive:pinProgress', { id: t.id, done, count: targets.length, finished: true });
    }
    return { pinned: done };
  });
  handle('drive:unpin', async (ids) => {
    const lib = store.read('library.json');
    for (const id of ids || []) {
      const t = lib.tracks[id];
      if (t && t.source === 'drive') await drive.removeFromCache(t.driveId, t.ext);
    }
    return true;
  });

  // — المزامنة
  handle('sync:now', () => runSync({ upload: true }));
  handle('sync:set', async (enabled, minutes) => {
    const settings = store.read('settings.json');
    settings.driveSync = !!enabled;
    if (minutes) settings.syncMinutes = Math.max(5, Number(minutes) || 15);
    store.write('settings.json', settings);
    await store.flush('settings.json');
    scheduleSync();
    return { enabled: settings.driveSync, minutes: settings.syncMinutes };
  });

  // — الأغلفة (مفردة وجماعية)
  handle('art:pickFile', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'اختر صورة الغلاف',
      properties: ['openFile'],
      filters: [{ name: 'صور', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }],
    });
    if (res.canceled || !res.filePaths[0]) return { canceled: true };
    return { path: res.filePaths[0] };
  });
  handle('art:setFromFile', async (ids, filePath) => {
    if (!ids || !ids.length) throw new Error('NO_TRACKS');
    const name = await artwork.fromFile(filePath, ids[0]);
    const u = store.read('userdata.json');
    u.artOverrides = u.artOverrides || {};
    for (const id of ids) u.artOverrides[id] = { art: name, at: Date.now() };
    store.write('userdata.json', u);
    await store.flush('userdata.json');
    send('library:updated', libraryPayload());
    return { art: name, count: ids.length };
  });
  handle('art:setFromUrl', async (ids, url) => {
    if (!ids || !ids.length) throw new Error('NO_TRACKS');
    const name = await artwork.fromUrl(url, ids[0]);
    const u = store.read('userdata.json');
    u.artOverrides = u.artOverrides || {};
    for (const id of ids) u.artOverrides[id] = { art: name, at: Date.now() };
    store.write('userdata.json', u);
    await store.flush('userdata.json');
    send('library:updated', libraryPayload());
    return { art: name, count: ids.length };
  });
  handle('art:clear', async (ids) => {
    const u = store.read('userdata.json');
    u.artOverrides = u.artOverrides || {};
    for (const id of ids || []) delete u.artOverrides[id];
    store.write('userdata.json', u);
    await store.flush('userdata.json');
    send('library:updated', libraryPayload());
    return true;
  });
  /** جلب الأغلفة الناقصة من الإنترنت لمجموعة أغانٍ، مع تقدّم مباشر. */
  handle('art:fetchMissing', async (ids) => {
    const lib = store.read('library.json');
    const u = store.read('userdata.json');
    const targets = (ids || []).map((id) => lib.tracks[id])
      .filter((t) => t && !t.art && !(u.artOverrides || {})[t.id]);
    let found = 0; let done = 0;
    for (const t of targets) {
      try {
        const ov = (u.overrides || {})[t.id] || {};
        // eslint-disable-next-line no-await-in-loop
        const name = await online.fetchArtwork({
          artist: ov.artist || t.albumArtist || t.artist,
          album: ov.album || t.album,
          title: ov.title || t.title,
          artDir,
        });
        if (name) {
          const fresh = store.read('library.json');
          const albumKey = `${t.albumArtist || t.artist}|${t.album}`;
          for (const other of Object.values(fresh.tracks)) {
            if (!other.art && other.album && `${other.albumArtist || other.artist}|${other.album}` === albumKey) {
              other.art = name;
            }
          }
          if (fresh.tracks[t.id]) fresh.tracks[t.id].art = name;
          store.write('library.json', fresh);
          found++;
        }
      } catch { /* نكمل على البقية */ }
      done++;
      send('art:progress', { done, total: targets.length, found });
    }
    await store.flush('library.json');
    send('library:updated', libraryPayload());
    return { found, checked: done };
  });

  // — أدوات مساعدة للواجهة
  handle('util:audioUrl', (id) => {
    const t = getTrack(id);
    if (!t) throw new Error('NOT_FOUND');
    if (t.source === 'drive') return `liwa://drive/${t.driveId}.${t.ext || 'mp3'}`;
    return `liwa://audio/${encodePath(t.path)}`;
  });
  handle('util:fileUrl', (p) => pathToFileURL(p).href);
}

// ————————————————————————————————— اختصارات الوسائط

function registerMediaKeys() {
  const map = {
    MediaPlayPause: 'toggle',
    MediaNextTrack: 'next',
    MediaPreviousTrack: 'prev',
    MediaStop: 'stop',
  };
  for (const [key, action] of Object.entries(map)) {
    try { globalShortcut.register(key, () => send('media:key', action)); } catch { /* مفتاح غير متاح */ }
  }
}

// ————————————————————————————————— الإقلاع

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(async () => {
    app.setName(APP_NAME);
    dataDir = path.join(app.getPath('userData'), 'data');
    artDir = path.join(app.getPath('userData'), 'artwork');
    lyricsDir = path.join(app.getPath('userData'), 'lyrics');
    driveCacheDir = path.join(app.getPath('userData'), 'drive-cache');
    await fsp.mkdir(artDir, { recursive: true });
    await fsp.mkdir(lyricsDir, { recursive: true });
    await fsp.mkdir(driveCacheDir, { recursive: true });

    store = new Store(dataDir);
    ai = new AI({ dir: dataDir, safeStorage });
    drive = new Drive({
      dir: dataDir,
      cacheDir: driveCacheDir,
      safeStorage,
      openExternal: (url) => shell.openExternal(url),
    });
    artwork = new Artwork({ artDir, nativeImage });
    nativeTheme.themeSource = store.read('settings.json').theme === 'light' ? 'light' : 'dark';

    registerProtocol();
    registerIPC();
    createWindow();
    registerMediaKeys();
    setupWatchers();

    // مزامنة أولى بعد ثوانٍ من الإقلاع ثم على فترات
    if (drive.isConnected() && store.read('settings.json').driveSync) {
      setTimeout(() => { runSync({ upload: true }).catch(() => {}); }, 6000);
      scheduleSync();
    }
  });

  app.on('window-all-closed', async () => {
    await store?.flushAll();
    globalShortcut.unregisterAll();
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  app.on('before-quit', async () => {
    clearInterval(syncTimer);
    await store?.flushAll();
    if (drive && drive.isConnected() && store.read('settings.json').driveSync) {
      await runSync({ upload: true }).catch(() => {});
    }
  });
}

