/* LiwaMusic للهاتف — الواجهة والمشغّل. تم إنشاؤه عن طريق LiwaMusic. */
'use strict';
import { DriveClient, buildAuthUrl, pkce, toTrack, redirectUriFor } from './drive.js';
import {
  store, audioCache, mergeUserData, mergePlaylists, buildPayload, DEFAULT_USERDATA,
} from './store.js';
import { parseID3 } from './tags.js';

// رابط إعادة التوجيه يُشتق من معرّف العميل (مخطط جوجل المعكوس) مع بديل باسم الحزمة
const redirectUri = (clientId) => redirectUriFor(clientId, 'com.liwamusic.app');
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const cap = () => (window.Capacitor && window.Capacitor.Plugins) || {};

const fmtTime = (s) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60); const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};
const fmtSize = (b) => {
  const u = ['B', 'KB', 'MB', 'GB']; let v = b || 0; let i = 0;
  while (v >= 1024 && i < 3) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
};
const norm = (s) => String(s || '').toLowerCase()
  .replace(/[ً-ْـ]/g, '').replace(/[آأإٱ]/g, 'ا')
  .replace(/ى/g, 'ي').replace(/ة/g, 'ه').trim();

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : String(c));
  return n;
};

function toast(msg, kind = 'info', ms = 3200) {
  const t = el('div', { class: `toast ${kind}`, text: msg });
  $('#toasts').append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, ms);
}

function loading(text) {
  const box = $('#loading');
  if (!text) { box.hidden = true; return; }
  $('#loadingText').textContent = text;
  box.hidden = false;
}

function sheet({ title, items }) {
  const root = $('#sheetRoot');
  root.hidden = false;
  root.innerHTML = '';
  const close = () => { root.hidden = true; root.innerHTML = ''; };
  const card = el('div', { class: 'sheet' }, el('div', { class: 'sheet-grab' }),
    title ? el('h3', { text: title }) : null,
    ...items.filter(Boolean).map((it) => el('button', {
      class: `sheet-item${it.danger ? ' danger' : ''}`,
      onclick: () => { close(); it.onClick && it.onClick(); },
    }, it.icon ? el('span', { text: it.icon }) : null, el('span', { text: it.label }))));
  root.append(el('div', { class: 'sheet-back', onclick: close }), card);
  return close;
}

// ————————————————————————————————— الحالة

const state = {
  clientId: '',
  connected: false,
  account: null,
  folder: null,          // { id, name }
  tracks: [],
  byId: new Map(),
  userdata: JSON.parse(JSON.stringify(DEFAULT_USERDATA)),
  playlists: [],
  queue: [],
  index: -1,
  currentId: null,
  playing: false,
  shuffle: false,
  repeat: 'off',
  rate: 1,
  q: '',
  chip: 'all',
  tab: 'library',
  artUrls: new Map(),
  sleepTimer: null,
};

const drive = new DriveClient(store);
const audio = $('#audio');

// ————————————————————————————————— التخزين

async function saveLibrary() {
  await store.set('library', { tracks: state.tracks, folder: state.folder, at: Date.now() });
}
async function saveUser() { await store.set('userdata', state.userdata); }

async function loadAll() {
  state.clientId = await drive.clientId();
  state.connected = await drive.isConnected();
  const lib = await store.get('library');
  if (lib) {
    state.tracks = lib.tracks || [];
    state.folder = lib.folder || null;
    state.byId = new Map(state.tracks.map((t) => [t.id, t]));
  }
  const ud = await store.get('userdata');
  if (ud) state.userdata = { ...DEFAULT_USERDATA, ...ud };
  const pl = await store.get('playlists');
  if (pl) state.playlists = pl.items || [];
  const prefs = (await store.get('prefs')) || {};
  state.shuffle = !!prefs.shuffle;
  state.repeat = prefs.repeat || 'off';
  state.rate = prefs.rate || 1;
}
async function savePrefs() {
  await store.set('prefs', { shuffle: state.shuffle, repeat: state.repeat, rate: state.rate });
}

// ————————————————————————————————— تسجيل الدخول

async function startAuth() {
  if (!state.clientId) { toast('أدخل معرّف العميل أولًا', 'warn'); return; }
  const { verifier, challenge } = await pkce();
  const st = Math.random().toString(36).slice(2);
  const uri = redirectUri(state.clientId);
  await store.set('auth.pending', { verifier, state: st, uri });
  const url = buildAuthUrl({ clientId: state.clientId, redirectUri: uri, challenge, state: st });
  const { Browser } = cap();
  if (Browser) await Browser.open({ url, presentationStyle: 'popover' });
  else window.open(url, '_blank');
}

async function handleRedirect(rawUrl) {
  try {
    // نحوّل أي مخطط مخصّص إلى https كي يحلّله URL بشكل موحّد
    const u = new URL(String(rawUrl).replace(/^[^:]+:\/+/, 'https://liwamusic.local/'));
    const code = u.searchParams.get('code');
    const returnedState = u.searchParams.get('state');
    const err = u.searchParams.get('error');
    const { Browser } = cap();
    if (Browser) Browser.close().catch(() => {});
    if (err) { toast(`رُفضت الموافقة: ${err}`, 'err'); return; }
    if (!code) return;
    const pending = await store.get('auth.pending');
    if (!pending || pending.state !== returnedState) { toast('طلب غير مطابق', 'err'); return; }
    loading('جارٍ إتمام تسجيل الدخول…');
    await drive.exchange({ code, verifier: pending.verifier, redirectUri: pending.uri || redirectUri(state.clientId) });
    await store.remove('auth.pending');
    state.connected = true;
    state.account = await drive.about().catch(() => null);
    loading(null);
    toast('تم ربط حسابك ✓', 'ok');
    render();
  } catch (e) {
    loading(null);
    toast(`تعذّر تسجيل الدخول: ${e.message}`, 'err', 5000);
  }
}

// ————————————————————————————————— الفهرسة

async function scanFolder(folder) {
  loading('جارٍ قراءة مجلد درايف…');
  try {
    const files = await drive.walkAudio(folder.id, (n) => loading(`وُجد ${n} ملفًا…`));
    const prev = new Map(state.tracks.map((t) => [t.id, t]));
    state.tracks = files.map((f) => {
      const t = toTrack(f, folder.name);
      const old = prev.get(t.id);
      return old && old.md5 === t.md5 ? { ...old, folder: folder.name } : t;
    });
    state.byId = new Map(state.tracks.map((t) => [t.id, t]));
    state.folder = folder;
    await saveLibrary();
    loading(null);
    toast(`فُهرست ${state.tracks.length} أغنية.`, 'ok');
    render();
    readTagsInBackground();
  } catch (e) {
    loading(null);
    toast(`تعذّرت الفهرسة: ${e.message}`, 'err', 5000);
  }
}

/** يقرأ الوسوم والغلاف بتنزيل أول 512 كيلوبايت من كل ملف، تدريجيًا وبلا إزعاج. */
async function readTagsInBackground(limit = 0) {
  const pending = state.tracks.filter((t) => !t.tagged);
  const list = limit ? pending.slice(0, limit) : pending;
  if (!list.length) return;
  let done = 0;
  for (const t of list) {
    try {
      const res = await drive.api(`/files/${encodeURIComponent(t.driveId)}`, {
        params: { alt: 'media' }, headers: { Range: 'bytes=0-524287' }, raw: true,
      });
      if (res.ok || res.status === 206) {
        const buf = await res.arrayBuffer();
        const tags = parseID3(buf);
        if (tags) {
          if (tags.title) t.title = tags.title;
          if (tags.artist) t.artist = tags.artist;
          if (tags.album) t.album = tags.album;
          if (tags.genre) t.genre = tags.genre;
          if (tags.year) t.year = tags.year;
          if (tags.trackNo) t.trackNo = tags.trackNo;
          if (tags.picture) {
            const blob = new Blob([tags.picture.bytes], { type: tags.picture.mime });
            const cache = await caches.open('liwa-art-v1');
            await cache.put(`/art/${t.id}`, new Response(blob));
            t.art = true;
          }
        }
      }
    } catch { /* نكمل */ }
    t.tagged = true;
    done++;
    if (done % 8 === 0 || done === list.length) {
      await saveLibrary();
      if (state.tab === 'library' || state.tab === 'albums') render();
    }
  }
  await saveLibrary();
  render();
}

async function artUrl(track) {
  if (!track || !track.art) return null;
  if (state.artUrls.has(track.id)) return state.artUrls.get(track.id);
  try {
    const cache = await caches.open('liwa-art-v1');
    const res = await cache.match(`/art/${track.id}`);
    if (!res) return null;
    const url = URL.createObjectURL(await res.blob());
    state.artUrls.set(track.id, url);
    return url;
  } catch { return null; }
}

// ————————————————————————————————— التشغيل

async function playTrack(id, list) {
  const track = state.byId.get(id);
  if (!track) return;
  if (list && list.length) {
    state.queue = state.shuffle ? [id, ...shuffle(list.filter((x) => x !== id))] : [...list];
    state.index = Math.max(0, state.queue.indexOf(id));
  }
  state.currentId = id;
  renderPlayer();
  renderMini();

  try {
    let blob = await audioCache.get(track.driveId);
    if (!blob) {
      loading('جارٍ التحميل… 0%');
      blob = await drive.downloadBlob(track.driveId, (r, total) => {
        loading(`جارٍ التحميل… ${Math.round((r / total) * 100)}%`);
      });
      loading(null);
      if (blob.size < 40 * 1024 * 1024) await audioCache.put(track.driveId, blob);
    }
    if (audio.src && audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
    audio.src = URL.createObjectURL(blob);
    audio.playbackRate = state.rate;
    await audio.play();
    bumpPlayCount(id);
    prefetchNext();
  } catch (e) {
    loading(null);
    toast(`تعذّر التشغيل: ${e.message}`, 'err', 5000);
  }
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

async function prefetchNext() {
  const nextId = peekNext();
  if (!nextId) return;
  const t = state.byId.get(nextId);
  if (!t || await audioCache.has(t.driveId)) return;
  try {
    const blob = await drive.downloadBlob(t.driveId);
    if (blob.size < 40 * 1024 * 1024) await audioCache.put(t.driveId, blob);
  } catch { /* تجاهل */ }
}

function peekNext() {
  if (state.repeat === 'one') return state.currentId;
  if (state.index + 1 < state.queue.length) return state.queue[state.index + 1];
  return state.repeat === 'all' ? state.queue[0] : null;
}

function next(auto = false) {
  if (state.repeat === 'one' && auto) { audio.currentTime = 0; audio.play(); return; }
  if (state.index + 1 < state.queue.length) state.index++;
  else if (state.repeat === 'all' && state.queue.length) state.index = 0;
  else { audio.pause(); return; }
  playTrack(state.queue[state.index]);
}

function prev() {
  if (audio.currentTime > 4) { audio.currentTime = 0; return; }
  if (state.index > 0) state.index--;
  else if (state.repeat === 'all') state.index = state.queue.length - 1;
  else { audio.currentTime = 0; return; }
  playTrack(state.queue[state.index]);
}

async function bumpPlayCount(id) {
  const u = state.userdata;
  u.playCount[id] = (u.playCount[id] || 0) + 1;
  u.lastPlayed[id] = Date.now();
  u.history.unshift({ id, at: Date.now() });
  if (u.history.length > 500) u.history.length = 500;
  await saveUser();
}

async function toggleFav(id) {
  const u = state.userdata;
  if (u.favorites[id]) delete u.favorites[id]; else u.favorites[id] = true;
  u.favAt[id] = Date.now();
  await saveUser();
  render();
  renderPlayer();
}

async function rate(id, stars) {
  const u = state.userdata;
  if (stars) u.ratings[id] = stars; else delete u.ratings[id];
  u.ratedAt[id] = Date.now();
  await saveUser();
  renderPlayer();
}

// ————————————————————————————————— المزامنة

async function syncNow(silent = false) {
  if (!state.connected) return;
  try {
    if (!silent) loading('جارٍ المزامنة…');
    const remote = await drive.downloadSync();
    if (remote && remote.userdata) {
      state.userdata = mergeUserData(state.userdata, remote.userdata);
      const plm = mergePlaylists(state.playlists, remote.playlists || [], {}, remote.deletedPlaylists || {});
      state.playlists = plm.items;
      await saveUser();
      await store.set('playlists', { items: state.playlists });
    }
    await drive.uploadSync(buildPayload({
      userdata: state.userdata, playlists: state.playlists, deletedPlaylists: {}, deviceId: 'android',
    }));
    await store.set('lastSyncAt', Date.now());
    if (!silent) { loading(null); toast('تمت المزامنة مع الكمبيوتر ✓', 'ok'); }
    render();
  } catch (e) {
    if (!silent) { loading(null); toast(`تعذّرت المزامنة: ${e.message}`, 'warn'); }
  }
}

// ————————————————————————————————— العرض

function visibleTracks() {
  let list = state.tracks;
  const u = state.userdata;
  if (state.chip === 'fav') list = list.filter((t) => u.favorites[t.id]);
  else if (state.chip === 'offline') list = list.filter((t) => t.cached);
  else if (state.chip === 'recent') {
    list = [...list].sort((a, b) => (u.lastPlayed[b.id] || 0) - (u.lastPlayed[a.id] || 0))
      .filter((t) => u.lastPlayed[t.id]);
  } else if (state.chip === 'most') {
    list = [...list].sort((a, b) => (u.playCount[b.id] || 0) - (u.playCount[a.id] || 0))
      .filter((t) => u.playCount[t.id]);
  }
  if (state.q) {
    const words = norm(state.q).split(/\s+/).filter(Boolean);
    list = list.filter((t) => {
      const hay = norm(`${t.title} ${t.artist} ${t.album} ${t.file}`);
      return words.every((w) => hay.includes(w));
    });
  }
  return list;
}

async function trackRow(t, list) {
  const u = state.userdata;
  const art = el('div', { class: 'r-art', text: t.art ? '' : '♪' });
  if (t.art) artUrl(t).then((url) => { if (url) { art.textContent = ''; art.append(el('img', { src: url, alt: '' })); } });
  return el('div', {
    class: `row${state.currentId === t.id ? ' current' : ''}`,
    onclick: () => playTrack(t.id, list.map((x) => x.id)),
    oncontextmenu: (e) => { e.preventDefault(); trackSheet(t); },
  },
  art,
  el('div', { class: 'r-meta' },
    el('div', { class: 'r-title', text: t.title || t.file }),
    el('div', { class: 'r-sub', text: [t.artist, t.album].filter(Boolean).join(' — ') || 'غير معروف' })),
  el('div', { class: 'r-right' },
    u.favorites[t.id] ? el('span', { class: 'r-fav', text: '♥' }) : null,
    t.cached ? el('span', { class: 'r-badge', text: '⤓' }) : null,
    el('button', { class: 'icon', text: '⋯', onclick: (e) => { e.stopPropagation(); trackSheet(t); } })));
}

function trackSheet(t) {
  const u = state.userdata;
  sheet({
    title: t.title || t.file,
    items: [
      { icon: '▶', label: 'تشغيل', onClick: () => playTrack(t.id, visibleTracks().map((x) => x.id)) },
      { icon: '⏭', label: 'شغّل بعد الحالية', onClick: () => { state.queue.splice(state.index + 1, 0, t.id); toast('أُضيفت للطابور', 'ok'); } },
      { icon: u.favorites[t.id] ? '♥' : '♡', label: u.favorites[t.id] ? 'إزالة من المفضلة' : 'إضافة للمفضلة', onClick: () => toggleFav(t.id) },
      { icon: '⤓', label: t.cached ? 'إزالة من التخزين' : 'حفظ للاستماع دون إنترنت', onClick: () => toggleOffline(t) },
      { icon: '☰', label: 'تشغيل الألبوم', onClick: () => {
        const ids = state.tracks.filter((x) => x.album && x.album === t.album).map((x) => x.id);
        playTrack(ids[0] || t.id, ids.length ? ids : [t.id]);
      } },
    ],
  });
}

async function toggleOffline(t) {
  if (t.cached) {
    await audioCache.remove(t.driveId);
    t.cached = false;
    toast('أُزيلت من التخزين.', 'ok');
  } else {
    loading('جارٍ الحفظ…');
    try {
      const blob = await drive.downloadBlob(t.driveId, (r, total) => loading(`جارٍ الحفظ… ${Math.round((r / total) * 100)}%`));
      await audioCache.put(t.driveId, blob);
      t.cached = true;
      loading(null);
      toast('محفوظة — تعمل بلا إنترنت.', 'ok');
    } catch (e) { loading(null); toast(`تعذّر الحفظ: ${e.message}`, 'err'); }
  }
  await saveLibrary();
  render();
}

async function renderLibrary() {
  const list = visibleTracks();
  const box = $('#trackList');
  box.innerHTML = '';
  $('#libTitle').textContent = state.folder ? state.folder.name : 'المكتبة';

  const chips = $('#libChips');
  chips.innerHTML = '';
  for (const [key, label] of [['all', 'الكل'], ['recent', 'آخر ما شُغّل'], ['most', 'الأكثر تشغيلاً'], ['fav', 'المفضلة'], ['offline', 'دون إنترنت']]) {
    chips.append(el('button', {
      class: `chip${state.chip === key ? ' on' : ''}`,
      text: label,
      onclick: () => { state.chip = key; renderLibrary(); },
    }));
  }
  if (!list.length) {
    box.append(el('div', { class: 'empty', text: state.tracks.length ? 'لا توجد نتائج.' : 'لم تُفهرس أي أغنية بعد.' }));
    return;
  }
  const frag = document.createDocumentFragment();
  for (const t of list.slice(0, 400)) frag.append(await trackRow(t, list));
  box.append(frag);
  if (list.length > 400) box.append(el('div', { class: 'empty', text: `و${list.length - 400} أغنية أخرى — استخدم البحث.` }));
}

async function renderAlbums() {
  const grid = $('#albumGrid');
  grid.innerHTML = '';
  const groups = new Map();
  for (const t of state.tracks) {
    const key = t.album || 'بدون ألبوم';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  if (!groups.size) { grid.append(el('div', { class: 'empty', text: 'لا توجد ألبومات.' })); return; }
  for (const [album, tracks] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const cover = tracks.find((t) => t.art) || tracks[0];
    const artBox = el('div', { class: 'c-art', text: '♪' });
    if (cover.art) artUrl(cover).then((url) => { if (url) { artBox.textContent = ''; artBox.append(el('img', { src: url, alt: '' })); } });
    grid.append(el('div', {
      class: 'cardx',
      onclick: () => playTrack(tracks[0].id, tracks.map((t) => t.id)),
    }, artBox,
    el('div', { class: 'c-t', text: album }),
    el('div', { class: 'c-s', text: `${tracks[0].artist || '—'} · ${tracks.length}` })));
  }
}

async function renderFav() {
  const u = state.userdata;
  const list = state.tracks.filter((t) => u.favorites[t.id]);
  const box = $('#favList');
  box.innerHTML = '';
  if (!list.length) { box.append(el('div', { class: 'empty', text: 'لا توجد مفضلة بعد.' })); return; }
  for (const t of list) box.append(await trackRow(t, list));
}

async function renderSettings() {
  const box = $('#settingsBody');
  box.innerHTML = '';
  const cacheStats = await audioCache.stats();
  const lastSync = await store.get('lastSyncAt');
  const acc = state.account || {};

  box.append(
    el('div', { class: 'srow' },
      el('div', {}, el('div', { class: 's-t', text: acc.name || 'حساب Google Drive' }),
        el('div', { class: 's-d', text: acc.email || (state.connected ? 'مرتبط' : 'غير مرتبط') })),
      el('button', { class: 'btn danger', text: 'فصل', onclick: async () => {
        await drive.disconnect(); state.connected = false; render();
      } })),
    el('div', { class: 'srow' },
      el('div', {}, el('div', { class: 's-t', text: 'مجلد الأغاني' }),
        el('div', { class: 's-d', text: state.folder ? state.folder.name : 'لم يُختر' })),
      el('button', { class: 'btn', text: 'تغيير', onclick: () => browseDrive() })),
    el('div', { class: 'srow' },
      el('div', {}, el('div', { class: 's-t', text: 'تحديث الفهرس' }),
        el('div', { class: 's-d', text: `${state.tracks.length} أغنية · ${state.tracks.filter((t) => !t.tagged).length} بلا وسوم` })),
      el('button', { class: 'btn', text: 'تحديث', onclick: () => state.folder && scanFolder(state.folder) })),
    el('div', { class: 'srow' },
      el('div', {}, el('div', { class: 's-t', text: 'المزامنة مع الكمبيوتر' }),
        el('div', { class: 's-d', text: lastSync ? `آخر مزامنة: ${new Date(lastSync).toLocaleString('ar')}` : 'لم تتم بعد' })),
      el('button', { class: 'btn', text: 'مزامنة', onclick: () => syncNow() })),
    el('div', { class: 'srow' },
      el('div', {}, el('div', { class: 's-t', text: 'التخزين للاستماع دون إنترنت' }),
        el('div', { class: 's-d', text: `${cacheStats.count} ملف · ${fmtSize(cacheStats.bytes)}` })),
      el('button', { class: 'btn danger', text: 'تفريغ', onclick: async () => {
        await audioCache.clear();
        for (const t of state.tracks) t.cached = false;
        await saveLibrary(); render(); toast('فُرِّغ التخزين.', 'ok');
      } })),
    el('div', { class: 'srow' },
      el('div', {}, el('div', { class: 's-t', text: 'قراءة الوسوم والأغلفة' }),
        el('div', { class: 's-d', text: 'ينزّل 512 كيلوبايت من كل ملف لاستخراج الاسم والفنان والغلاف' })),
      el('button', { class: 'btn', text: 'ابدأ', onclick: () => { readTagsInBackground(); toast('بدأت القراءة في الخلفية.', 'ok'); } })),
    el('div', { class: 'srow' },
      el('div', {}, el('div', { class: 's-t', text: 'حفظ كل المكتبة للاستماع دون إنترنت' }),
        el('div', { class: 's-d', text: 'قد يستهلك مساحة كبيرة' })),
      el('button', { class: 'btn', text: 'حفظ الكل', onclick: () => cacheAll() })),
    el('div', { class: 'made', text: 'تم إنشاؤه عن طريق LiwaMusic · 1.1.0' }),
  );
}

async function cacheAll() {
  const list = state.tracks.filter((t) => !t.cached);
  if (!list.length) { toast('كل شيء محفوظ.', 'ok'); return; }
  let done = 0;
  for (const t of list) {
    loading(`حفظ ${done + 1}/${list.length}…`);
    try {
      const blob = await drive.downloadBlob(t.driveId);
      await audioCache.put(t.driveId, blob);
      t.cached = true;
    } catch { /* تجاهل */ }
    done++;
  }
  await saveLibrary();
  loading(null);
  toast(`حُفظت ${done} أغنية.`, 'ok');
  render();
}

// ————————————————————————————————— متصفّح درايف

async function browseDrive(startId = 'root', startName = 'ملفاتي (My Drive)') {
  const root = $('#sheetRoot');
  root.hidden = false;
  root.innerHTML = '';
  const close = () => { root.hidden = true; root.innerHTML = ''; };
  const crumbs = el('div', { class: 'crumbs' });
  const list = el('div', {});
  const card = el('div', { class: 'sheet' }, el('div', { class: 'sheet-grab' }),
    el('h3', { text: 'اختر مجلد الأغاني' }), crumbs, list);
  root.append(el('div', { class: 'sheet-back', onclick: close }), card);

  const stack = [{ id: startId, name: startName }];
  const draw = async () => {
    crumbs.innerHTML = '';
    stack.forEach((n, i) => {
      crumbs.append(el('button', {
        class: 'chip',
        onclick: async () => { stack.length = i + 1; await draw(); },
      }, i === stack.length - 1 ? el('b', { text: n.name }) : n.name));
    });
    list.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    try {
      const cur = stack[stack.length - 1];
      const page = await drive.listFolder(cur.id);
      list.innerHTML = '';
      list.append(el('button', {
        class: 'sheet-item',
        onclick: () => { close(); scanFolder(cur); },
      }, el('span', { text: '✓' }), el('span', { text: `اختر «${cur.name}» (${page.audio.length} ملفًا هنا)` })));
      for (const f of page.folders) {
        list.append(el('button', {
          class: 'sheet-item',
          onclick: async () => { stack.push(f); await draw(); },
        }, el('span', { text: '📁' }), el('span', { text: f.name })));
      }
      if (!page.folders.length && !page.audio.length) {
        list.append(el('div', { class: 'empty', text: 'المجلد فارغ.' }));
      }
    } catch (e) {
      list.innerHTML = '';
      list.append(el('div', { class: 'empty', text: `تعذّرت القراءة: ${e.message}` }));
    }
  };
  await draw();
}

// ————————————————————————————————— المشغّل (الواجهة)

async function renderMini() {
  const t = state.byId.get(state.currentId);
  const mini = $('#mini');
  if (!t) { mini.hidden = true; return; }
  mini.hidden = false;
  $('#miniTitle').textContent = t.title || t.file;
  $('#miniSub').textContent = t.artist || '—';
  $('#miniPlay').textContent = state.playing ? '⏸' : '▶';
  const art = $('#miniArt');
  const url = await artUrl(t);
  art.innerHTML = url ? '' : '♪';
  if (url) art.append(el('img', { src: url, alt: '' }));
}

async function renderPlayer() {
  const t = state.byId.get(state.currentId);
  if (!t) return;
  $('#pTitle').textContent = t.title || t.file;
  $('#pArtist').textContent = [t.artist, t.album].filter(Boolean).join(' — ') || 'غير معروف';
  $('#pFrom').textContent = t.cached ? 'محفوظة على الهاتف' : 'من Google Drive';
  $('#pPlay').textContent = state.playing ? '⏸' : '▶';
  $('#pFav').textContent = state.userdata.favorites[t.id] ? '♥' : '♡';
  $('#pFav').classList.toggle('on', !!state.userdata.favorites[t.id]);
  $('#pOffline').classList.toggle('on', !!t.cached);
  $('#pShuffle').classList.toggle('on', state.shuffle);
  $('#pRepeat').classList.toggle('on', state.repeat !== 'off');
  const repBadge = $('#pRepeat').querySelector('.rep-1');
  if (repBadge) repBadge.hidden = state.repeat !== 'one';
  $('#pSpeed').textContent = `${state.rate}×`;

  const stars = $('#pStars');
  stars.innerHTML = '';
  const value = state.userdata.ratings[t.id] || 0;
  for (let i = 1; i <= 5; i++) {
    stars.append(el('button', {
      class: i <= value ? 'on' : '', text: '★',
      onclick: () => rate(t.id, i === value ? 0 : i),
    }));
  }
  const art = $('#pArt');
  const url = await artUrl(t);
  art.innerHTML = url ? '' : '<span>♪</span>';
  if (url) art.append(el('img', { src: url, alt: '' }));

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title || t.file,
      artist: t.artist || '',
      album: t.album || '',
      artwork: url ? [{ src: url, sizes: '512x512', type: 'image/jpeg' }] : [],
    });
  }
}

function render() {
  const setup = !state.clientId || !state.connected || !state.folder;
  $('#scrSetup').hidden = !setup;
  $('#tabs').hidden = setup;
  $('#stepClient').hidden = !!state.clientId;
  $('#stepConnect').hidden = !state.clientId || state.connected;
  $('#stepFolder').hidden = !state.connected || !!state.folder;
  if (state.account) $('#accLine').textContent = `${state.account.name} · ${state.account.email}`;
  for (const [id, tab] of [['#scrLibrary', 'library'], ['#scrAlbums', 'albums'], ['#scrFav', 'fav'], ['#scrSettings', 'settings']]) {
    $(id).hidden = setup || state.tab !== tab;
  }
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  if (setup) { $('#mini').hidden = true; return; }
  if (state.tab === 'library') renderLibrary();
  else if (state.tab === 'albums') renderAlbums();
  else if (state.tab === 'fav') renderFav();
  else if (state.tab === 'settings') renderSettings();
  renderMini();
}

// ————————————————————————————————— الربط

function wire() {
  $('#saveClient').onclick = async () => {
    const v = $('#clientId').value.trim();
    if (!v) { toast('ألصق معرّف العميل', 'warn'); return; }
    await drive.setClientId(v);
    await drive.setClientSecret($('#clientSecret').value.trim());
    state.clientId = v;
    toast('حُفظ ✓', 'ok');
    render();
  };
  $('#btnChangeClient').onclick = async () => {
    await drive.setClientId('');
    await drive.setClientSecret('');
    state.clientId = '';
    render();
  };
  $('#btnConnect').onclick = () => startAuth();
  $('#btnPickFolder').onclick = () => browseDrive();
  $('#btnSync').onclick = () => syncNow();

  $('#q').addEventListener('input', (e) => {
    state.q = e.target.value.trim();
    clearTimeout(wire._t);
    wire._t = setTimeout(() => renderLibrary(), 200);
  });

  $$('#tabs button').forEach((b) => {
    b.onclick = () => { state.tab = b.dataset.tab; render(); };
  });

  $('#miniPlay').onclick = (e) => { e.stopPropagation(); togglePlay(); };
  $('#miniNext').onclick = (e) => { e.stopPropagation(); next(); };
  $('#mini').onclick = () => { $('#player').hidden = false; renderPlayer(); };
  $('#pClose').onclick = () => { $('#player').hidden = true; };
  $('#pPlay').onclick = () => togglePlay();
  $('#pNext').onclick = () => next();
  $('#pPrev').onclick = () => prev();
  $('#pFav').onclick = () => state.currentId && toggleFav(state.currentId);
  $('#pOffline').onclick = () => { const t = state.byId.get(state.currentId); if (t) toggleOffline(t); };
  $('#pShuffle').onclick = () => { state.shuffle = !state.shuffle; savePrefs(); renderPlayer(); toast(state.shuffle ? 'الخلط مفعّل' : 'الخلط متوقف'); };
  $('#pRepeat').onclick = () => {
    const order = ['off', 'all', 'one'];
    state.repeat = order[(order.indexOf(state.repeat) + 1) % 3];
    savePrefs(); renderPlayer();
  };
  $('#pSpeed').onclick = () => {
    const speeds = [1, 1.25, 1.5, 0.75];
    state.rate = speeds[(speeds.indexOf(state.rate) + 1) % speeds.length];
    audio.playbackRate = state.rate;
    savePrefs(); renderPlayer();
  };
  $('#pSleep').onclick = () => {
    sheet({
      title: 'مؤقت النوم',
      items: [0, 10, 15, 30, 45, 60].map((m) => ({
        label: m ? `${m} دقيقة` : 'إيقاف المؤقت',
        onClick: () => {
          clearTimeout(state.sleepTimer);
          if (m) {
            state.sleepTimer = setTimeout(() => { audio.pause(); toast('انتهى مؤقت النوم.'); }, m * 60000);
            toast(`سيتوقف بعد ${m} دقيقة`, 'ok');
          } else toast('أُلغي المؤقت');
        },
      })),
    });
  };
  $('#pMenu').onclick = () => { const t = state.byId.get(state.currentId); if (t) trackSheet(t); };

  const seek = $('#pSeek');
  seek.addEventListener('input', () => {
    if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration;
  });

  audio.addEventListener('timeupdate', () => {
    const d = audio.duration || 0;
    $('#pCur').textContent = fmtTime(audio.currentTime);
    $('#pDur').textContent = fmtTime(d);
    if (d) {
      seek.value = Math.round((audio.currentTime / d) * 1000);
      $('#miniBar').style.width = `${(audio.currentTime / d) * 100}%`;
    }
  });
  audio.addEventListener('play', () => { state.playing = true; renderMini(); renderPlayer(); });
  audio.addEventListener('pause', () => { state.playing = false; renderMini(); renderPlayer(); });
  audio.addEventListener('ended', () => next(true));

  if ('mediaSession' in navigator) {
    const acts = { play: () => audio.play(), pause: () => audio.pause(), nexttrack: () => next(), previoustrack: () => prev() };
    for (const [k, fn] of Object.entries(acts)) {
      try { navigator.mediaSession.setActionHandler(k, fn); } catch { /* غير مدعوم */ }
    }
  }

  const { App } = cap();
  if (App) {
    App.addListener('appUrlOpen', (data) => { if (data && data.url) handleRedirect(data.url); });
    App.addListener('backButton', () => {
      if (!$('#sheetRoot').hidden) { $('#sheetRoot').hidden = true; $('#sheetRoot').innerHTML = ''; return; }
      if (!$('#player').hidden) { $('#player').hidden = true; return; }
      if (state.tab !== 'library') { state.tab = 'library'; render(); return; }
      App.exitApp();
    });
  }
}

function togglePlay() {
  if (audio.paused) { if (audio.src) audio.play(); else if (state.tracks.length) playTrack(state.tracks[0].id, state.tracks.map((t) => t.id)); }
  else audio.pause();
}

// ————————————————————————————————— الإقلاع

(async function boot() {
  try {
    wire();
    await loadAll();
    if (state.connected) {
      drive.about().then((a) => { state.account = a; if (state.tab === 'settings') renderSettings(); }).catch(() => {});
      // تحديث حالة التخزين
      for (const t of state.tracks) {
        // eslint-disable-next-line no-await-in-loop
        t.cached = await audioCache.has(t.driveId);
      }
      syncNow(true);
    }
    render();
    const { StatusBar } = cap();
    if (StatusBar) StatusBar.setBackgroundColor({ color: '#0b0b12' }).catch(() => {});
  } catch (e) {
    document.body.innerHTML = `<div class="empty">تعذّر الإقلاع: ${e.message}</div>`;
  }
}());

window.LiwaMobile = { state, drive, playTrack, syncNow, render, scanFolder, readTagsInBackground };
