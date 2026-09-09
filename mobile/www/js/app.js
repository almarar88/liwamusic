/* LiwaMusic للهاتف — الواجهة والمشغّل. تم إنشاؤه عن طريق LiwaMusic. */
'use strict';
import { DriveClient, buildAuthUrl, pkce, toTrack, redirectUriFor } from './drive.js';
import {
  store, audioCache, mergeUserData, mergePlaylists, buildPayload, DEFAULT_USERDATA,
} from './store.js';
import { parseID3 } from './tags.js';
import { parseLRC, activeLine } from './lyrics.js';
import { rampFromImage, applyRamp } from './color.js';
import {
  dayKey, weekDays, weekTotals, streak, todaySessions, topBy, addListen, DAY_NAMES,
} from './stats.js';
import { Equalizer, PRESETS, BANDS } from './eq.js';

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
const fmtDur = (s) => {
  if (!Number.isFinite(s) || s <= 0) return '—';
  const h = Math.floor(s / 3600); const m = Math.round((s % 3600) / 60);
  return h ? `${h}س ${m}د` : `${m || 1}د`;
};
const fmtSize = (b) => {
  const u = ['B', 'KB', 'MB', 'GB']; let v = b || 0; let i = 0;
  while (v >= 1024 && i < 3) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
};
const fmtClock = (ms) => new Date(ms).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
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
    else if (k === 'style') n.setAttribute('style', v);
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

function closeSheet() {
  const root = $('#sheetRoot');
  root.hidden = true;
  root.innerHTML = '';
}

function sheet({ title, items, body }) {
  const root = $('#sheetRoot');
  root.hidden = false;
  root.innerHTML = '';
  const card = el('div', { class: 'sheet' }, el('div', { class: 'sheet-grab' }),
    title ? el('h3', { text: title }) : null,
    body || null,
    ...(items || []).filter(Boolean).map((it) => el('button', {
      class: `sheet-item${it.danger ? ' danger' : ''}`,
      onclick: () => { closeSheet(); it.onClick && it.onClick(); },
    }, it.icon ? el('span', { text: it.icon }) : null, el('span', { text: it.label }))));
  root.append(el('div', { class: 'sheet-back', onclick: closeSheet }), card);
  return closeSheet;
}

// ————————————————————————————————— الحالة

const state = {
  clientId: '',
  connected: false,
  account: null,
  folder: null,
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
  favChip: 'fav',
  browseMode: 'albums',
  tab: 'home',
  seg: 'library',
  weekShift: 0,
  goalMin: 30,
  artUrls: new Map(),
  sleepTimer: null,
  stopAfter: false,
  lyrics: { id: null, lines: [], synced: false, at: -1 },
  notes: [],
  eqPreset: 'flat',
  eqGains: BANDS.map(() => 0),
  eqBoost: false,
  crossfade: 0,
  listenTick: 0,
  sessionMs: 0,
};

const drive = new DriveClient(store);
const audio = $('#audio');
const eq = new Equalizer(audio);

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
  if (ud) state.userdata = { ...DEFAULT_USERDATA, ...ud, listen: ud.listen || {} };
  const pl = await store.get('playlists');
  if (pl) state.playlists = pl.items || [];
  const prefs = (await store.get('prefs')) || {};
  state.shuffle = !!prefs.shuffle;
  state.repeat = prefs.repeat || 'off';
  state.rate = prefs.rate || 1;
  state.goalMin = prefs.goalMin || 30;
  state.eqPreset = prefs.eqPreset || 'flat';
  state.eqGains = prefs.eqGains || (PRESETS[state.eqPreset] || PRESETS.flat).gains.slice();
  state.eqBoost = !!prefs.eqBoost;
  state.crossfade = prefs.crossfade || 0;
  state.notes = (await store.get('notes')) || [];
}
async function savePrefs() {
  await store.set('prefs', {
    shuffle: state.shuffle, repeat: state.repeat, rate: state.rate, goalMin: state.goalMin,
    eqPreset: state.eqPreset, eqGains: state.eqGains, eqBoost: state.eqBoost, crossfade: state.crossfade,
  });
}
async function savePlaylists() { await store.set('playlists', { items: state.playlists }); }

function note(text, icon = '♪') {
  state.notes.unshift({ text, icon, at: Date.now() });
  if (state.notes.length > 40) state.notes.length = 40;
  store.set('notes', state.notes);
  const dot = $('#bellDot');
  if (dot) dot.hidden = false;
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
    note('تم ربط حساب Google Drive', '✓');
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
    note(`فُهرس مجلد «${folder.name}» — ${state.tracks.length} أغنية`, '☰');
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
      if (state.tab === 'home' || state.tab === 'albums') render();
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

/** يضع الغلاف داخل عنصر، أو يترك الرمز البديل. */
async function fillArt(node, track, symbol = '♪') {
  const url = await artUrl(track);
  node.innerHTML = '';
  if (url) node.append(el('img', { src: url, alt: '' }));
  else node.textContent = symbol;
  return url;
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
  state.sessionMs = 0;
  state.lyrics = { id: null, lines: [], synced: false, at: -1 };
  renderPlayer();
  renderMini();
  tintFrom(track);
  loadLyrics(track);

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
    eq.resume();
    await audio.play();
    bumpPlayCount(id);
    prefetchNext();
  } catch (e) {
    loading(null);
    toast(`تعذّر التشغيل: ${e.message}`, 'err', 5000);
  }
}

/** يلوّن الواجهة بألوان غلاف المقطع. */
async function tintFrom(track) {
  const url = await artUrl(track);
  if (!url) { applyRamp(null); return; }
  const ramp = await rampFromImage(url);
  applyRamp(ramp);
}

async function loadLyrics(track) {
  if (!track) return;
  try {
    const cached = await store.get(`lrc.${track.id}`);
    let text = cached === undefined ? null : cached;
    if (text == null) {
      text = await drive.findLyrics(track.file);
      await store.set(`lrc.${track.id}`, text || '');
    }
    if (state.currentId !== track.id) return;
    const parsed = parseLRC(text || '');
    state.lyrics = { id: track.id, lines: parsed.lines, synced: parsed.synced, at: -1 };
    renderLyrics();
  } catch { /* بلا كلمات */ }
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
  if (state.stopAfter && auto) {
    state.stopAfter = false;
    audio.pause();
    toast('توقّف بعد نهاية المقطع.');
    return;
  }
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
  u.history.unshift({ id, at: Date.now(), ms: 0 });
  if (u.history.length > 500) u.history.length = 500;
  await saveUser();
}

/** يسجّل زمن الاستماع الفعلي في يوميات اليوم وفي آخر مدخل بالسجلّ. */
function trackListening(ms) {
  if (!(ms > 0) || ms > 20000) return;
  const u = state.userdata;
  u.listen = u.listen || {};
  const before = Math.floor((u.listen[dayKey()] || 0) / 60000);
  addListen(u.listen, ms);
  const after = Math.floor((u.listen[dayKey()] || 0) / 60000);
  const cur = u.history[0];
  if (cur && cur.id === state.currentId) cur.ms = (cur.ms || 0) + ms;
  state.sessionMs += ms;
  if (before < state.goalMin && after >= state.goalMin) {
    toast(`بلغت هدف اليوم — ${state.goalMin} دقيقة ✓`, 'ok');
    note(`بلغت هدف الاستماع اليومي (${state.goalMin} دقيقة)`, '★');
  }
  if (state.listenTick++ % 10 === 0) saveUser();
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
      state.userdata.listen = { ...(remote.userdata.listen || {}), ...(state.userdata.listen || {}) };
      const plm = mergePlaylists(state.playlists, remote.playlists || [], {}, remote.deletedPlaylists || {});
      state.playlists = plm.items;
      await saveUser();
      await savePlaylists();
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

// ————————————————————————————————— الاختيار والتصفية

function filterBy(key) {
  const u = state.userdata;
  const list = state.tracks;
  if (key === 'fav') return list.filter((t) => u.favorites[t.id]);
  if (key === 'offline') return list.filter((t) => t.cached);
  if (key === 'rated') return list.filter((t) => u.ratings[t.id]);
  if (key === 'recent') {
    return [...list].filter((t) => u.lastPlayed[t.id])
      .sort((a, b) => (u.lastPlayed[b.id] || 0) - (u.lastPlayed[a.id] || 0));
  }
  if (key === 'most') {
    return [...list].filter((t) => u.playCount[t.id])
      .sort((a, b) => (u.playCount[b.id] || 0) - (u.playCount[a.id] || 0));
  }
  if (key === 'new') return [...list].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  if (key === 'unplayed') return list.filter((t) => !u.playCount[t.id]);
  return list;
}

function searchIn(list, q) {
  if (!q) return list;
  const words = norm(q).split(/\s+/).filter(Boolean);
  return list.filter((t) => {
    const hay = norm(`${t.title} ${t.artist} ${t.album} ${t.file}`);
    return words.every((w) => hay.includes(w));
  });
}

function albumTracks(t) {
  if (!t || !t.album) return t ? [t] : [];
  return state.tracks.filter((x) => x.album === t.album)
    .sort((a, b) => (a.trackNo || 0) - (b.trackNo || 0));
}

// عدّادات تمنع تداخل عمليتَي عرض غير متزامنتين على الحاوية نفسها
const gen = {};
const bump = (k) => { gen[k] = (gen[k] || 0) + 1; return gen[k]; };
const stale = (k, n) => gen[k] !== n;

// ————————————————————————————————— قطع الواجهة

async function trackRow(t, list, opts = {}) {
  const u = state.userdata;
  const art = el('div', { class: 'r-art' });
  fillArt(art, t);
  const playing = state.currentId === t.id && state.playing;
  return el('div', {
    class: `row${state.currentId === t.id ? ' current' : ''}`,
    onclick: () => playTrack(t.id, list.map((x) => x.id)),
    oncontextmenu: (e) => { e.preventDefault(); trackSheet(t); },
  },
  art,
  el('div', { class: 'r-meta' },
    el('div', { class: 'r-title', text: t.title || t.file }),
    el('div', { class: 'r-sub', text: opts.sub || [t.artist, t.album].filter(Boolean).join(' — ') || 'غير معروف' })),
  el('div', { class: 'r-right' },
    playing ? el('div', { class: 'eqbars' }, el('i'), el('i'), el('i')) : null,
    u.favorites[t.id] ? el('span', { class: 'r-fav', text: '♥' }) : null,
    t.cached ? el('span', { class: 'r-badge', text: '⤓' }) : null,
    opts.right || null,
    el('button', { class: 'round sm', text: '⋯', onclick: (e) => { e.stopPropagation(); trackSheet(t); } })));
}

function trackSheet(t) {
  const u = state.userdata;
  sheet({
    title: t.title || t.file,
    items: [
      { icon: '▶', label: 'تشغيل الآن', onClick: () => playTrack(t.id, [t.id, ...state.tracks.filter((x) => x.id !== t.id).map((x) => x.id)]) },
      { icon: '⏭', label: 'شغّل بعد الحالية', onClick: () => {
        state.queue.splice(state.index + 1, 0, t.id); toast('أُضيفت للطابور', 'ok');
      } },
      { icon: '☰', label: 'أضف لآخر الطابور', onClick: () => { state.queue.push(t.id); toast('أُضيفت لآخر الطابور', 'ok'); } },
      { icon: u.favorites[t.id] ? '♥' : '♡', label: u.favorites[t.id] ? 'إزالة من المفضلة' : 'إضافة للمفضلة', onClick: () => toggleFav(t.id) },
      { icon: '＋', label: 'أضف إلى قائمة تشغيل', onClick: () => addToPlaylistSheet(t) },
      { icon: '⤓', label: t.cached ? 'إزالة من التخزين' : 'حفظ للاستماع دون إنترنت', onClick: () => toggleOffline(t) },
      { icon: '💿', label: 'تشغيل الألبوم كاملًا', onClick: () => {
        const ids = albumTracks(t).map((x) => x.id);
        playTrack(ids[0] || t.id, ids.length ? ids : [t.id]);
      } },
      { icon: '🎤', label: 'كل أغاني الفنان', onClick: () => {
        const ids = state.tracks.filter((x) => x.artist && x.artist === t.artist).map((x) => x.id);
        if (!ids.length) { toast('لا يوجد فنان محدَّد لهذا المقطع', 'warn'); return; }
        playTrack(ids[0], ids);
      } },
      { icon: 'ℹ', label: 'تفاصيل الملف', onClick: () => sheet({
        title: t.title || t.file,
        body: el('div', { class: 'settings' },
          ...[['الملف', t.file], ['الفنان', t.artist || '—'], ['الألبوم', t.album || '—'],
            ['النوع', t.genre || '—'], ['السنة', t.year || '—'], ['المدة', fmtTime(t.duration || 0)],
            ['الحجم', fmtSize(t.size)], ['المجلد', t.folder || '—'],
            ['مرات التشغيل', u.playCount[t.id] || 0]].map(([k, v]) => el('div', { class: 'srow' },
            el('div', {}, el('div', { class: 's-t', text: k }), el('div', { class: 's-d', text: String(v) })))),
        ),
      }) },
    ],
  });
}

function addToPlaylistSheet(t) {
  sheet({
    title: 'أضف إلى قائمة',
    items: [
      { icon: '＋', label: 'قائمة جديدة…', onClick: () => newPlaylist([t.id]) },
      ...state.playlists.map((p) => ({
        icon: '☰',
        label: `${p.name} (${(p.tracks || []).length})`,
        onClick: async () => {
          p.tracks = [...new Set([...(p.tracks || []), t.id])];
          p.updatedAt = Date.now();
          await savePlaylists();
          toast(`أُضيفت إلى «${p.name}»`, 'ok');
          render();
        },
      })),
    ],
  });
}

function newPlaylist(initial = []) {
  const input = el('input', { type: 'text', placeholder: 'اسم القائمة…' });
  const body = el('div', { class: 'card', style: 'background:transparent;border:0;padding:0' }, input,
    el('button', {
      class: 'btn primary big',
      text: 'إنشاء',
      onclick: async () => {
        const name = input.value.trim();
        if (!name) { toast('اكتب اسمًا', 'warn'); return; }
        state.playlists.push({ id: `pl${Date.now()}`, name, tracks: [...initial], updatedAt: Date.now() });
        await savePlaylists();
        closeSheet();
        toast(`أُنشئت «${name}»`, 'ok');
        note(`قائمة تشغيل جديدة: ${name}`, '＋');
        render();
      },
    }));
  sheet({ title: 'قائمة تشغيل جديدة', body, items: [] });
  setTimeout(() => input.focus(), 120);
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
      note(`حُفظت «${t.title || t.file}» للاستماع دون إنترنت`, '⤓');
    } catch (e) { loading(null); toast(`تعذّر الحفظ: ${e.message}`, 'err'); }
  }
  await saveLibrary();
  render();
}

// ————————————————————————————————— الرئيسية: بطاقات البطل

async function heroCard({ track, label, title, facts, cta, progress, list, stackOf }) {
  const card = el('div', { class: 'hero', onclick: () => list && list.length && playTrack(list[0], list) });
  const bg = el('img', { class: 'bgart', alt: '' });
  const url = track ? await artUrl(track) : null;
  if (url) { bg.src = url; card.append(bg); }
  card.append(el('div', { class: 'shade' }));

  const stack = el('div', { class: 'stack' });
  for (const t of (stackOf || []).slice(0, 3)) {
    const i = el('i');
    artUrl(t).then((u) => { if (u) i.append(el('img', { src: u, alt: '' })); });
    stack.append(i);
  }
  if (stackOf && stackOf.length) stack.append(el('b', { text: `+${stackOf.length}` }));

  card.append(el('div', { class: 'hero-top' },
    stackOf && stackOf.length ? stack : el('span'),
    el('span', { class: 'pill', text: label })));

  const bottom = el('div', {});
  bottom.append(el('h3', { text: title }));
  if (facts && facts.filter(Boolean).length) {
    bottom.append(el('div', { class: 'facts' },
      ...facts.filter(Boolean).map((f) => el('span', {}, el('b', { text: f[0] }), ' ', f[1]))));
  }
  if (progress != null) {
    bottom.append(el('div', { class: 'track-line' }, el('i', { style: `width:${Math.round(progress * 100)}%` })));
  }
  bottom.append(el('div', { class: 'hero-foot' },
    el('span', { text: cta[0] }),
    el('span', { class: 'go' }, cta[1], ' ›')));
  card.append(bottom);
  return card;
}

async function renderHeroRail() {
  const my = bump('hero');
  const rail = $('#heroRail');
  const u = state.userdata;
  if (!state.tracks.length) { rail.innerHTML = ''; return; }

  const recent = filterBy('recent');
  const cur = state.byId.get(state.currentId) || recent[0];
  const cards = [];

  if (cur) {
    const album = albumTracks(cur);
    const idx = Math.max(0, album.findIndex((x) => x.id === cur.id));
    cards.push(await heroCard({
      track: cur,
      label: state.playing ? 'قيد التشغيل' : 'تابع الاستماع',
      title: cur.album || cur.title || cur.file,
      facts: [
        album.some((t) => t.duration) ? ['⏱', fmtDur(album.reduce((s, t) => s + (t.duration || 0), 0))] : null,
        u.ratings[cur.id] ? ['★', String(u.ratings[cur.id])] : null,
        ['♪', `${album.length} مقطع`],
      ].filter(Boolean),
      progress: album.length ? (idx + 1) / album.length : null,
      cta: [`${idx + 1} من ${album.length}`, 'تابع'],
      list: album.map((x) => x.id),
      stackOf: album.filter((t) => t.art).slice(0, 3),
    }));
  }

  const most = filterBy('most').slice(0, 12);
  if (most.length) {
    cards.push(await heroCard({
      track: most[0],
      label: 'الأكثر تشغيلًا',
      title: most[0].artist || most[0].title || 'أغانيك المفضّلة',
      facts: [['▶', `${u.playCount[most[0].id] || 0} مرة`], ['♪', `${most.length}`]],
      cta: ['قائمة مبنية على سماعك', 'شغّل'],
      list: most.map((x) => x.id),
      stackOf: most.filter((t) => t.art).slice(0, 3),
    }));
  }

  const fresh = filterBy('unplayed').slice(0, 20);
  if (fresh.length) {
    cards.push(await heroCard({
      track: fresh[0],
      label: 'لم تسمعها بعد',
      title: 'اكتشف من مكتبتك',
      facts: [['♪', `${fresh.length} مقطع`]],
      cta: ['جديد عليك', 'ابدأ'],
      list: shuffle(fresh.map((x) => x.id)),
      stackOf: fresh.filter((t) => t.art).slice(0, 3),
    }));
  }

  if (stale('hero', my)) return;
  rail.innerHTML = '';
  rail.append(...cards);
  rail.scrollTo({ left: 0 });
}

async function renderHomeLibrary() {
  const chips = $('#libChips');
  chips.innerHTML = '';
  const defs = [
    ['all', 'الكل'], ['recent', 'الأخيرة'], ['most', 'الأكثر'],
    ['fav', 'المفضلة'], ['rated', 'المقيَّمة'], ['offline', 'دون إنترنت'], ['unplayed', 'جديدة'],
  ];
  for (const [key, label] of defs) {
    const n = filterBy(key).length;
    chips.append(el('button', {
      class: `chip${state.chip === key ? ' on' : ''}`,
      onclick: () => { state.chip = key; renderHomeLibrary(); },
    }, label, el('sup', { text: String(n) })));
  }

  const my = bump('lib');
  const body = $('#libBody');
  const frag = document.createDocumentFragment();
  const list = filterBy(state.chip);
  if (!list.length) {
    body.innerHTML = '';
    body.append(el('div', { class: 'empty', text: state.tracks.length ? 'لا شيء في هذا الفلتر بعد.' : 'لم تُفهرس أي أغنية بعد.' }));
    return;
  }

  // بطاقة عريضة لأبرز ألبوم في هذا الفلتر
  const albums = new Map();
  for (const t of list) {
    const k = t.album || '';
    if (!k) continue;
    if (!albums.has(k)) albums.set(k, []);
    albums.get(k).push(t);
  }
  const top = [...albums.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (top && top[1].length > 1) {
    const [name, tracks] = top;
    const cover = tracks.find((t) => t.art) || tracks[0];
    const artBox = el('div', { class: 'w-art' });
    fillArt(artBox, cover);
    frag.append(el('div', {
      class: 'wide light',
      onclick: () => playTrack(tracks[0].id, tracks.map((t) => t.id)),
    }, artBox,
    el('div', { class: 'w-body' },
      el('div', {},
        el('div', { class: 'w-title', text: name }),
        el('div', { class: 'w-sub', text: `${tracks[0].artist || 'فنان غير معروف'} · ${tracks.length} مقطع` })),
      el('div', { class: 'w-foot' },
        el('span', { class: 'pill glassy', text: '▶ تشغيل' }),
        tracks.some((t) => t.duration)
          ? el('span', { class: 'muted sm', text: fmtDur(tracks.reduce((s, t) => s + (t.duration || 0), 0)) })
          : null))));
  }

  const wrap = el('div', { class: 'list' });
  for (const t of list.slice(0, 300)) wrap.append(await trackRow(t, list));
  frag.append(wrap);
  if (list.length > 300) frag.append(el('div', { class: 'empty', text: `و${list.length - 300} مقطعًا آخر — استخدم البحث.` }));
  if (stale('lib', my)) return;
  body.innerHTML = '';
  body.append(frag);
}

// ————————————————————————————————— الرئيسية: النشاط

function ringSvg(pct, size = 38) {
  const r = (size - 5) / 2;
  const c = 2 * Math.PI * r;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  const mk = (cls, dash) => {
    const ci = document.createElementNS(ns, 'circle');
    ci.setAttribute('cx', size / 2); ci.setAttribute('cy', size / 2); ci.setAttribute('r', r);
    ci.setAttribute('fill', 'none'); ci.setAttribute('stroke-width', '3');
    ci.setAttribute('class', cls);
    if (dash) ci.setAttribute('stroke-dasharray', dash);
    return ci;
  };
  svg.append(mk('bgc'));
  if (pct > 0.01) svg.append(mk('fgc', `${(c * Math.min(1, pct)).toFixed(1)} ${c.toFixed(1)}`));
  return svg;
}

function renderActivity() {
  const u = state.userdata;
  const listen = u.listen || {};
  const days = weekDays(listen, state.goalMin, state.weekShift);
  const totals = weekTotals(days);

  const first = days[0].date; const last = days[6].date;
  const month = first.toLocaleDateString('ar', { month: 'long' });
  $('#weekTitle').innerHTML = '';
  $('#weekTitle').append(month, ' ', el('b', { text: `${first.getDate()}–${last.getDate()}` }));

  const strip = $('#weekStrip');
  strip.innerHTML = '';
  for (const d of days) {
    const ring = el('div', { class: 'ring' });
    ring.append(ringSvg(d.pct));
    ring.append(el('b', { text: d.minutes ? String(d.minutes) : '' }));
    strip.append(el('div', {
      class: `day${d.today ? ' on' : ''}${d.future ? ' future' : ''}`,
      onclick: () => toast(d.minutes ? `${DAY_NAMES[d.dow]}: ${d.minutes} دقيقة` : `${DAY_NAMES[d.dow]}: بلا استماع`),
    }, el('span', { class: 'dn', text: d.name }), ring));
  }

  const st = streak(listen, state.goalMin);
  const topArtist = topBy(u.history, state.byId, 'artist', 7);
  const topAlbum = topBy(u.history, state.byId, 'album', 7);
  const cards = $('#statCards');
  cards.innerHTML = '';
  cards.append(
    el('div', { class: 'stat' }, el('div', { class: 'v' }, String(totals.minutes), el('small', { text: 'دقيقة' })), el('div', { class: 'k', text: 'مجموع الأسبوع' })),
    el('div', { class: 'stat' }, el('div', { class: 'v' }, String(st), el('small', { text: 'يوم' })), el('div', { class: 'k', text: 'سلسلة بلوغ الهدف' })),
    el('div', { class: 'stat' }, el('div', { class: 'v', text: topArtist ? topArtist.name : '—' }), el('div', { class: 'k', text: 'أكثر فنان هذا الأسبوع' })),
    el('div', { class: 'stat' }, el('div', { class: 'v', text: topAlbum ? topAlbum.name : '—' }), el('div', { class: 'k', text: 'أكثر ألبوم هذا الأسبوع' })),
  );

  const todayMin = Math.round((listen[dayKey()] || 0) / 60000);
  $('#todayLabel').textContent = `${todayMin} من ${state.goalMin} دقيقة`;

  const box = $('#todayList');
  box.innerHTML = '';
  const sessions = todaySessions(u.history);
  if (!sessions.length) {
    box.append(el('div', { class: 'empty', text: 'لم تسمع شيئًا اليوم بعد — ابدأ من الرئيسية.' }));
    return;
  }
  sessions.slice(0, 12).forEach((s, i) => {
    const t = state.byId.get(s.id);
    if (!t) return;
    const secs = Math.round(s.ms / 1000);
    const pct = t.duration > 0
      ? Math.min(1, s.ms / (t.duration * 1000 * Math.max(1, s.plays)))
      : Math.min(1, s.ms / Math.max(1, listen[dayKey()] || 1));
    const ic = el('div', { class: `task-ic${i ? ' dim' : ''}` });
    if (t.art) fillArt(ic, t, '♪'); else ic.textContent = '♪';
    box.append(el('div', {
      class: `task${i === 0 ? ' hot' : ''}`,
      onclick: () => playTrack(t.id, sessions.map((x) => x.id)),
    },
    el('div', { class: 'task-top' }, ic,
      el('div', { class: 'task-meta' },
        el('div', { class: 't', text: t.title || t.file }),
        el('div', { class: 's', text: `${fmtTime(secs)} استماع · ${t.artist || 'غير معروف'}` })),
      el('div', { class: 'task-pct' }, el('i', { text: '✓' }), `${Math.round(pct * 100)}%`)),
    el('div', { class: 'task-foot' },
      el('span', { class: 'when', text: fmtClock(s.first) }),
      el('span', { class: 'more' }, `${s.plays} تشغيل`, ' ›'))));
  });
}

// ————————————————————————————————— التصفّح والمفضلة والبحث

async function renderAlbums() {
  const chips = $('#browseChips');
  chips.innerHTML = '';
  for (const [key, label] of [['albums', 'الألبومات'], ['artists', 'الفنانون'], ['genres', 'الأنواع'], ['folders', 'المجلدات']]) {
    chips.append(el('button', {
      class: `chip${state.browseMode === key ? ' on' : ''}`,
      text: label,
      onclick: () => { state.browseMode = key; renderAlbums(); },
    }));
  }
  const field = { albums: 'album', artists: 'artist', genres: 'genre', folders: 'folder' }[state.browseMode];
  const my = bump('grid');
  const grid = $('#albumGrid');
  const frag = document.createDocumentFragment();
  const groups = new Map();
  for (const t of state.tracks) {
    const key = t[field] || 'غير مصنّف';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  if (!groups.size) { grid.innerHTML = ''; grid.append(el('div', { class: 'empty', text: 'لا توجد عناصر.' })); return; }
  for (const [name, tracks] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const cover = tracks.find((t) => t.art) || tracks[0];
    const artBox = el('div', { class: 'c-art' });
    fillArt(artBox, cover);
    frag.append(el('div', {
      class: 'cardx',
      onclick: () => playTrack(tracks[0].id, tracks.map((t) => t.id)),
      oncontextmenu: (e) => { e.preventDefault(); trackSheet(tracks[0]); },
    }, artBox,
    el('div', { class: 'c-t', text: name }),
    el('div', { class: 'c-s', text: `${tracks.length} مقطع${tracks.some((t) => t.duration) ? ` · ${fmtDur(tracks.reduce((s, t) => s + (t.duration || 0), 0))}` : ''}` })));
  }
  if (stale('grid', my)) return;
  grid.innerHTML = '';
  grid.append(frag);
}

async function renderFav() {
  const chips = $('#favChips');
  chips.innerHTML = '';
  const defs = [['fav', `المفضلة (${filterBy('fav').length})`], ['rated', `المقيَّمة (${filterBy('rated').length})`],
    ['offline', `دون إنترنت (${filterBy('offline').length})`], ['lists', `قوائمي (${state.playlists.length})`]];
  for (const [key, label] of defs) {
    chips.append(el('button', {
      class: `chip${state.favChip === key ? ' on' : ''}`,
      text: label,
      onclick: () => { state.favChip = key; renderFav(); },
    }));
  }
  const box = $('#favBody');
  box.innerHTML = '';

  if (state.favChip === 'lists') {
    if (!state.playlists.length) {
      box.append(el('div', { class: 'empty', text: 'لا توجد قوائم — أنشئ واحدة بزرّ ＋.' }));
      return;
    }
    for (const p of state.playlists) {
      const tracks = (p.tracks || []).map((id) => state.byId.get(id)).filter(Boolean);
      const cover = tracks.find((t) => t.art) || tracks[0];
      const artBox = el('div', { class: 'w-art' });
      if (cover) fillArt(artBox, cover); else artBox.textContent = '☰';
      box.append(el('div', {
        class: 'wide',
        onclick: () => tracks.length && playTrack(tracks[0].id, tracks.map((t) => t.id)),
        oncontextmenu: (e) => { e.preventDefault(); playlistSheet(p); },
      }, artBox,
      el('div', { class: 'w-body' },
        el('div', {}, el('div', { class: 'w-title', text: p.name }),
          el('div', { class: 'w-sub', text: `${tracks.length} مقطع` })),
        el('div', { class: 'w-foot' },
          el('span', { class: 'pill glassy', text: '▶ تشغيل' }),
          el('button', { class: 'round sm', text: '⋯', onclick: (e) => { e.stopPropagation(); playlistSheet(p); } })))));
    }
    return;
  }

  const list = filterBy(state.favChip);
  if (!list.length) { box.append(el('div', { class: 'empty', text: 'لا شيء هنا بعد.' })); return; }
  const wrap = el('div', { class: 'list' });
  for (const t of list) wrap.append(await trackRow(t, list));
  box.append(wrap);
}

function playlistSheet(p) {
  sheet({
    title: p.name,
    items: [
      { icon: '▶', label: 'تشغيل', onClick: () => {
        const ids = (p.tracks || []).filter((id) => state.byId.has(id));
        if (ids.length) playTrack(ids[0], ids); else toast('القائمة فارغة', 'warn');
      } },
      { icon: '🔀', label: 'تشغيل عشوائي', onClick: () => {
        const ids = shuffle((p.tracks || []).filter((id) => state.byId.has(id)));
        if (ids.length) playTrack(ids[0], ids);
      } },
      { icon: '⤓', label: 'حفظ القائمة دون إنترنت', onClick: async () => {
        for (const id of p.tracks || []) {
          const t = state.byId.get(id);
          if (t && !t.cached) await toggleOffline(t);
        }
      } },
      { icon: '🗑', label: 'حذف القائمة', danger: true, onClick: async () => {
        state.playlists = state.playlists.filter((x) => x.id !== p.id);
        await savePlaylists();
        toast('حُذفت القائمة.', 'ok');
        render();
      } },
    ],
  });
}

async function renderSearch() {
  const chips = $('#searchChips');
  chips.innerHTML = '';
  for (const [key, label] of [['all', 'الكل'], ['fav', 'المفضلة'], ['offline', 'دون إنترنت'], ['recent', 'الأخيرة'], ['new', 'الأحدث إضافة']]) {
    chips.append(el('button', {
      class: `chip${state.chip === key ? ' on' : ''}`,
      text: label,
      onclick: () => { state.chip = key; renderSearch(); },
    }));
  }
  const box = $('#searchBody');
  box.innerHTML = '';
  const list = searchIn(filterBy(state.chip), state.q);
  if (!state.q && state.chip === 'all') {
    const recent = filterBy('recent').slice(0, 8);
    if (!recent.length) { box.append(el('div', { class: 'empty', text: 'اكتب للبحث في مكتبتك.' })); return; }
    box.append(el('div', { class: 'sec-head' }, el('h3', { text: 'آخر ما سمعت' })));
    const wrap = el('div', { class: 'list' });
    for (const t of recent) wrap.append(await trackRow(t, recent));
    box.append(wrap);
    return;
  }
  if (!list.length) { box.append(el('div', { class: 'empty', text: 'لا نتائج.' })); return; }
  box.append(el('div', { class: 'sec-head' }, el('h3', { text: `${list.length} نتيجة` })));
  const wrap = el('div', { class: 'list' });
  for (const t of list.slice(0, 200)) wrap.append(await trackRow(t, list));
  box.append(wrap);
}

// ————————————————————————————————— الإعدادات

function switchEl(on, onChange) {
  const s = el('div', { class: `switch${on ? ' on' : ''}`, onclick: () => onChange(!on) }, el('i'));
  return s;
}

async function renderSettings() {
  const box = $('#settingsBody');
  box.innerHTML = '';
  const cacheStats = await audioCache.stats();
  const lastSync = await store.get('lastSyncAt');
  const acc = state.account || {};
  const untagged = state.tracks.filter((t) => !t.tagged).length;

  const row = (title, desc, control) => el('div', { class: 'srow' },
    el('div', {}, el('div', { class: 's-t', text: title }), el('div', { class: 's-d', text: desc })), control);

  box.append(
    row(acc.name || 'حساب Google Drive', acc.email || (state.connected ? 'مرتبط' : 'غير مرتبط'),
      el('button', { class: 'btn danger', text: 'فصل', onclick: async () => { await drive.disconnect(); state.connected = false; render(); } })),
    row('مجلد الأغاني', state.folder ? state.folder.name : 'لم يُختر',
      el('button', { class: 'btn', text: 'تغيير', onclick: () => browseDrive() })),
    row('تحديث الفهرس', `${state.tracks.length} أغنية · ${untagged} بلا وسوم`,
      el('button', { class: 'btn', text: 'تحديث', onclick: () => state.folder && scanFolder(state.folder) })),
    row('قراءة الوسوم والأغلفة', 'ينزّل 512 كيلوبايت من كل ملف لاستخراج الاسم والفنان والغلاف',
      el('button', { class: 'btn', text: 'ابدأ', onclick: () => { readTagsInBackground(); toast('بدأت القراءة في الخلفية.', 'ok'); } })),
    row('المزامنة مع الكمبيوتر', lastSync ? `آخر مزامنة: ${new Date(lastSync).toLocaleString('ar')}` : 'لم تتم بعد',
      el('button', { class: 'btn', text: 'مزامنة', onclick: () => syncNow() })),
    row('هدف الاستماع اليومي', `${state.goalMin} دقيقة في اليوم`,
      el('button', { class: 'btn', text: 'تغيير', onclick: () => goalSheet() })),
    row('المعادل الصوتي', `${(PRESETS[state.eqPreset] || PRESETS.flat).label}${state.eqBoost ? ' · تسوية الصوت' : ''}`,
      el('button', { class: 'btn', text: 'ضبط', onclick: () => eqSheet() })),
    row('تلاشٍ بين المقاطع', state.crossfade ? `${state.crossfade} ثانية` : 'متوقف',
      el('button', { class: 'btn', text: 'تغيير', onclick: () => crossfadeSheet() })),
    row('التخزين للاستماع دون إنترنت', `${cacheStats.count} ملف · ${fmtSize(cacheStats.bytes)}`,
      el('button', { class: 'btn danger', text: 'تفريغ', onclick: async () => {
        await audioCache.clear();
        for (const t of state.tracks) t.cached = false;
        await saveLibrary(); render(); toast('فُرِّغ التخزين.', 'ok');
      } })),
    row('حفظ كل المكتبة دون إنترنت', 'قد يستهلك مساحة كبيرة',
      el('button', { class: 'btn', text: 'حفظ الكل', onclick: () => cacheAll() })),
    row('إعادة ضبط الإحصاءات', 'يمسح يوميات الاستماع والسجلّ فقط',
      el('button', { class: 'btn danger', text: 'مسح', onclick: async () => {
        state.userdata.listen = {}; state.userdata.history = [];
        await saveUser(); render(); toast('مُسحت الإحصاءات.', 'ok');
      } })),
    el('div', { class: 'made', text: 'تم إنشاؤه عن طريق LiwaMusic · 1.2.0' }),
  );
}

function goalSheet() {
  sheet({
    title: 'هدف الاستماع اليومي',
    items: [10, 15, 20, 30, 45, 60, 90, 120].map((m) => ({
      icon: state.goalMin === m ? '●' : '○',
      label: `${m} دقيقة`,
      onClick: async () => { state.goalMin = m; await savePrefs(); toast(`الهدف: ${m} دقيقة`, 'ok'); render(); },
    })),
  });
}

function crossfadeSheet() {
  sheet({
    title: 'تلاشٍ بين المقاطع',
    items: [0, 2, 4, 6, 10].map((s) => ({
      icon: state.crossfade === s ? '●' : '○',
      label: s ? `${s} ثوانٍ` : 'متوقف',
      onClick: async () => { state.crossfade = s; await savePrefs(); render(); },
    })),
  });
}

function eqSheet() {
  const ok = eq.init();
  const body = el('div', { class: 'settings' });
  const chips = el('div', { class: 'chips' });
  const sliders = el('div', {});

  const drawSliders = () => {
    sliders.innerHTML = '';
    BANDS.forEach((f, i) => {
      const val = el('span', { class: 's-d', text: `${state.eqGains[i] > 0 ? '+' : ''}${state.eqGains[i]} dB` });
      const input = el('input', {
        class: 'slider', type: 'range', min: '-12', max: '12', step: '1', value: String(state.eqGains[i]),
        oninput: (e) => {
          state.eqGains[i] = Number(e.target.value);
          state.eqPreset = 'custom';
          val.textContent = `${state.eqGains[i] > 0 ? '+' : ''}${state.eqGains[i]} dB`;
          eq.setGains(state.eqGains);
          savePrefs();
        },
      });
      sliders.append(el('div', { class: 'srow' },
        el('div', {}, el('div', { class: 's-t', text: f >= 1000 ? `${f / 1000} كيلو‑هرتز` : `${f} هرتز` }), val),
        el('div', { style: 'flex:1.2' }, input)));
    });
  };

  for (const [key, p] of Object.entries(PRESETS)) {
    chips.append(el('button', {
      class: `chip${state.eqPreset === key ? ' on' : ''}`,
      text: p.label,
      onclick: async () => {
        state.eqPreset = key;
        state.eqGains = p.gains.slice();
        eq.setGains(state.eqGains);
        await savePrefs();
        closeSheet();
        eqSheet();
      },
    }));
  }

  drawSliders();
  body.append(
    el('div', { class: 's-d', text: ok ? 'يعمل على المقطع الجاري مباشرة.' : 'المعادل غير مدعوم على هذا الجهاز.' }),
    chips,
    el('div', { class: 'srow' },
      el('div', {}, el('div', { class: 's-t', text: 'تسوية مستوى الصوت' }),
        el('div', { class: 's-d', text: 'يقارب مستويات المقاطع المختلفة' })),
      switchEl(state.eqBoost, async (on) => {
        state.eqBoost = on; eq.setBoost(on); await savePrefs(); closeSheet(); eqSheet();
      })),
    sliders,
  );
  sheet({ title: 'المعادل الصوتي', body, items: [] });
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
  note(`حُفظت ${done} أغنية للاستماع دون إنترنت`, '⤓');
  render();
}

// ————————————————————————————————— متصفّح درايف

async function browseDrive(startId = 'root', startName = 'ملفاتي (My Drive)') {
  const root = $('#sheetRoot');
  root.hidden = false;
  root.innerHTML = '';
  const crumbs = el('div', { class: 'crumbs' });
  const list = el('div', {});
  const card = el('div', { class: 'sheet' }, el('div', { class: 'sheet-grab' }),
    el('h3', { text: 'اختر مجلد الأغاني' }), crumbs, list);
  root.append(el('div', { class: 'sheet-back', onclick: closeSheet }), card);

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
        onclick: () => { closeSheet(); scanFolder(cur); },
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

// ————————————————————————————————— المشغّل

async function renderMini() {
  const t = state.byId.get(state.currentId);
  const mini = $('#mini');
  if (!t) { mini.hidden = true; document.body.classList.remove('has-mini'); return; }
  mini.hidden = false;
  document.body.classList.add('has-mini');
  $('#miniTitle').textContent = t.title || t.file;
  $('#miniSub').textContent = t.artist || '—';
  $('#miniPlay').textContent = state.playing ? '⏸' : '▶';
  fillArt($('#miniArt'), t);
}

async function renderPlayer() {
  const t = state.byId.get(state.currentId);
  if (!t) return;
  $('#pTitle').textContent = t.title || t.file;
  $('#pDesc').textContent = [t.album && `من ألبوم «${t.album}»`, t.genre, t.year || null,
    `${state.userdata.playCount[t.id] || 0} تشغيل`].filter(Boolean).join(' · ');
  $('#pArtist').textContent = t.artist || 'فنان غير معروف';
  $('#pFrom').textContent = t.cached ? 'محفوظة على الهاتف' : 'من Google Drive';
  $('#pPlay').textContent = state.playing ? '⏸' : '▶';
  $('#pFav').textContent = state.userdata.favorites[t.id] ? '♥' : '♡';
  $('#pFav').classList.toggle('on', !!state.userdata.favorites[t.id]);
  $('#pOffline').classList.toggle('on', !!t.cached);
  $('#pShuffle').classList.toggle('on', state.shuffle);
  $('#pRepeat').classList.toggle('on', state.repeat !== 'off');
  const repBadge = $('#pRepeat').querySelector('.rep-1');
  if (repBadge) repBadge.hidden = state.repeat !== 'one';
  $('#pSpeed').textContent = `${state.rate}x`;

  const stars = $('#pStars');
  stars.innerHTML = '';
  const value = state.userdata.ratings[t.id] || 0;
  for (let i = 1; i <= 5; i++) {
    stars.append(el('button', {
      class: i <= value ? 'on' : '', text: '★',
      onclick: () => rate(t.id, i === value ? 0 : i),
    }));
  }

  const stage = $('#pStage');
  const old = stage.querySelector('img');
  if (old) old.remove();
  const url = await artUrl(t);
  if (url) stage.prepend(el('img', { src: url, alt: '' }));
  stage.querySelector('.sym').hidden = !!url;
  fillArt($('#pByArt'), t, '♪');

  // مقاطع الألبوم أسفل المشغّل
  const album = albumTracks(t);
  $('#pListTitle').textContent = t.album ? 'من الألبوم' : 'التالي في الطابور';
  const list = t.album ? album : state.queue.slice(state.index + 1, state.index + 21).map((id) => state.byId.get(id)).filter(Boolean);
  $('#pListCount').textContent = `${list.length}`;
  const my = bump('plist');
  const box = $('#pList');
  const frag = document.createDocumentFragment();
  for (const x of list.slice(0, 30)) {
    frag.append(await trackRow(x, list, { sub: `${fmtTime(x.duration || 0)} · ${x.artist || '—'}` }));
  }
  if (stale('plist', my)) return;
  box.innerHTML = '';
  box.append(frag);

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title || t.file,
      artist: t.artist || '',
      album: t.album || '',
      artwork: url ? [{ src: url, sizes: '512x512', type: 'image/jpeg' }] : [],
    });
  }
}

function renderLyrics() {
  const has = state.lyrics.lines.length > 0;
  $('#pLyricsWrap').hidden = !has;
  $('#pLyricsNote').textContent = has ? (state.lyrics.synced ? 'متزامنة' : 'نصّية') : '';
  for (const id of ['#pLyrics', '#imLyrics']) {
    const box = $(id);
    if (!box) continue;
    box.innerHTML = '';
    if (!has) { box.append(el('p', { text: 'لا توجد كلمات — ضع ملف ‎.lrc‎ بنفس اسم الأغنية في درايف.' })); continue; }
    state.lyrics.lines.forEach((l, i) => box.append(el('p', {
      'data-i': i,
      text: l.text,
      onclick: () => { if (l.t != null) audio.currentTime = l.t; },
    })));
  }
  state.lyrics.at = -1;
  syncLyrics();
}

function syncLyrics() {
  if (!state.lyrics.synced || !state.lyrics.lines.length) return;
  const i = activeLine(state.lyrics.lines, audio.currentTime);
  if (i === state.lyrics.at) return;
  state.lyrics.at = i;
  for (const id of ['#pLyrics', '#imLyrics']) {
    const box = $(id);
    if (!box || box.closest('[hidden]')) continue;
    box.querySelectorAll('p.on').forEach((p) => p.classList.remove('on'));
    const cur = box.querySelector(`p[data-i="${i}"]`);
    if (cur) {
      cur.classList.add('on');
      const top = cur.offsetTop - box.clientHeight / 2 + cur.clientHeight / 2;
      box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }
}

async function openImmersive() {
  const t = state.byId.get(state.currentId);
  if (!t) return;
  const im = $('#immersive');
  im.hidden = false;
  $('#imTitle').textContent = t.title || t.file;
  $('#imArtist').textContent = [t.artist, t.album].filter(Boolean).join(' — ') || '—';
  $('#imPlay').textContent = state.playing ? '⏸' : '▶';
  const oldBg = im.querySelector('img.bg');
  if (oldBg) oldBg.remove();
  const url = await artUrl(t);
  if (url) im.prepend(el('img', { class: 'bg', src: url, alt: '' }));
  await fillArt($('#imArt'), t, '♪');
  renderLyrics();
}

function queueSheet() {
  const body = el('div', { class: 'list' });
  const ids = state.queue.slice(Math.max(0, state.index), state.index + 40);
  if (!ids.length) body.append(el('div', { class: 'empty', text: 'الطابور فارغ.' }));
  ids.forEach((id, i) => {
    const t = state.byId.get(id);
    if (!t) return;
    const art = el('div', { class: 'r-art' });
    fillArt(art, t);
    body.append(el('div', {
      class: `row${i === 0 ? ' current' : ''}`,
      onclick: () => { closeSheet(); state.index = state.queue.indexOf(id); playTrack(id); },
    }, art,
    el('div', { class: 'r-meta' },
      el('div', { class: 'r-title', text: t.title || t.file }),
      el('div', { class: 'r-sub', text: i === 0 ? 'قيد التشغيل' : `التالي ${i}` })),
    el('button', {
      class: 'round sm',
      text: '✕',
      onclick: (e) => {
        e.stopPropagation();
        const at = state.queue.indexOf(id);
        if (at > state.index) { state.queue.splice(at, 1); closeSheet(); queueSheet(); }
      },
    })));
  });
  sheet({ title: `قائمة الانتظار (${Math.max(0, state.queue.length - state.index - 1)} تالية)`, body, items: [] });
}

function notesSheet() {
  $('#bellDot').hidden = true;
  sheet({
    title: 'التنبيهات',
    body: state.notes.length
      ? el('div', { class: 'list' }, ...state.notes.slice(0, 20).map((n) => el('div', { class: 'row' },
        el('div', { class: 'r-art', text: n.icon }),
        el('div', { class: 'r-meta' },
          el('div', { class: 'r-title', text: n.text }),
          el('div', { class: 'r-sub', text: new Date(n.at).toLocaleString('ar') })))))
      : el('div', { class: 'empty', text: 'لا تنبيهات.' }),
    items: [],
  });
}

// ————————————————————————————————— التوزيع

function render() {
  const setup = !state.clientId || !state.connected || !state.folder;
  $('#scrSetup').hidden = !setup;
  $('#tabs').hidden = setup;
  $('#stepClient').hidden = !!state.clientId;
  $('#stepConnect').hidden = !state.clientId || state.connected;
  $('#stepFolder').hidden = !state.connected || !!state.folder;
  if (state.account) $('#accLine').textContent = `${state.account.name} · ${state.account.email}`;

  const screens = [['#scrHome', 'home'], ['#scrAlbums', 'albums'], ['#scrFav', 'fav'],
    ['#scrSettings', 'settings'], ['#scrSearch', 'search']];
  for (const [id, tab] of screens) $(id).hidden = setup || state.tab !== tab;
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  $('#fabs').hidden = setup || state.tab !== 'home' || state.seg !== 'activity';

  if (setup) { $('#mini').hidden = true; return; }

  if (state.account) {
    $('#homeName').textContent = state.folder ? state.folder.name : 'مكتبتك';
    $('#homeHi').textContent = `أهلًا ${String(state.account.name || '').split(' ')[0] || 'بك'}`;
  }
  $('#bellDot').hidden = !state.notes.length;

  if (state.tab === 'home') {
    $$('#homeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.seg === state.seg));
    $('#segLibrary').hidden = state.seg !== 'library';
    $('#segActivity').hidden = state.seg !== 'activity';
    if (state.seg === 'library') { renderHeroRail(); renderHomeLibrary(); } else renderActivity();
  } else if (state.tab === 'albums') renderAlbums();
  else if (state.tab === 'fav') renderFav();
  else if (state.tab === 'search') renderSearch();
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
  $('#btnBell').onclick = () => notesSheet();
  $('#homeAvatar').onclick = () => { state.tab = 'settings'; render(); };
  $('#btnNewPlaylist').onclick = () => newPlaylist();
  $('#albumsMode').onclick = () => {
    const order = ['albums', 'artists', 'genres', 'folders'];
    state.browseMode = order[(order.indexOf(state.browseMode) + 1) % order.length];
    renderAlbums();
  };

  $$('#homeSeg button').forEach((b) => {
    b.onclick = () => { state.seg = b.dataset.seg; render(); };
  });
  $('#weekPrev').onclick = () => { state.weekShift--; renderActivity(); };
  $('#weekNext').onclick = () => { if (state.weekShift < 0) { state.weekShift++; renderActivity(); } };
  $('#fabGoal').onclick = () => goalSheet();
  $('#fabPlay').onclick = () => {
    const pool = filterBy('unplayed').length ? filterBy('unplayed') : state.tracks;
    if (!pool.length) { toast('المكتبة فارغة', 'warn'); return; }
    const ids = shuffle(pool.map((t) => t.id));
    playTrack(ids[0], ids);
  };

  $('#q').addEventListener('input', (e) => {
    state.q = e.target.value.trim();
    clearTimeout(wire._t);
    wire._t = setTimeout(() => renderSearch(), 180);
  });

  $$('#tabs button').forEach((b) => {
    b.onclick = () => { state.tab = b.dataset.tab; render(); };
  });

  $('#miniPlay').onclick = (e) => { e.stopPropagation(); togglePlay(); };
  $('#miniNext').onclick = (e) => { e.stopPropagation(); next(); };
  $('#mini').onclick = () => { $('#player').hidden = false; renderPlayer(); renderLyrics(); };
  $('#pClose').onclick = () => { $('#player').hidden = true; };
  $('#pBack').onclick = () => { $('#player').hidden = true; };
  $('#pPlay').onclick = () => togglePlay();
  $('#pNext').onclick = () => next();
  $('#pPrev').onclick = () => prev();
  $('#pFav').onclick = () => state.currentId && toggleFav(state.currentId);
  $('#pOffline').onclick = () => { const t = state.byId.get(state.currentId); if (t) toggleOffline(t); };
  $('#pQueue').onclick = () => queueSheet();
  $('#pEq').onclick = () => eqSheet();
  $('#pLyricsBtn').onclick = () => {
    const w = $('#pLyricsWrap');
    if (!state.lyrics.lines.length) { toast('لا توجد كلمات لهذا المقطع', 'warn'); return; }
    w.hidden = !w.hidden;
    if (!w.hidden) w.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  $('#pFull').onclick = () => openImmersive();
  $('#imClose').onclick = () => { $('#immersive').hidden = true; };
  $('#imPlay').onclick = () => togglePlay();
  $('#pShuffle').onclick = () => {
    state.shuffle = !state.shuffle; savePrefs(); renderPlayer();
    toast(state.shuffle ? 'الخلط مفعّل' : 'الخلط متوقف');
  };
  $('#pRepeat').onclick = () => {
    const order = ['off', 'all', 'one'];
    state.repeat = order[(order.indexOf(state.repeat) + 1) % 3];
    savePrefs(); renderPlayer();
  };
  $('#pSpeed').onclick = () => {
    const speeds = [1, 1.25, 1.5, 1.75, 0.75];
    state.rate = speeds[(speeds.indexOf(state.rate) + 1) % speeds.length];
    audio.playbackRate = state.rate;
    savePrefs(); renderPlayer();
  };
  $('#pSleep').onclick = () => {
    sheet({
      title: 'مؤقت النوم',
      items: [
        { icon: '⏹', label: 'توقّف بعد نهاية المقطع', onClick: () => { state.stopAfter = true; toast('سيتوقف بعد هذا المقطع', 'ok'); } },
        ...[10, 15, 30, 45, 60, 90].map((m) => ({
          icon: '☾',
          label: `${m} دقيقة`,
          onClick: () => {
            clearTimeout(state.sleepTimer);
            state.sleepTimer = setTimeout(() => { audio.pause(); toast('انتهى مؤقت النوم.'); }, m * 60000);
            toast(`سيتوقف بعد ${m} دقيقة`, 'ok');
          },
        })),
        { icon: '✕', label: 'إلغاء المؤقت', onClick: () => { clearTimeout(state.sleepTimer); state.stopAfter = false; toast('أُلغي المؤقت'); } },
      ],
    });
  };
  $('#pMenu').onclick = () => { const t = state.byId.get(state.currentId); if (t) trackSheet(t); };

  const seek = $('#pSeek');
  seek.addEventListener('input', () => {
    if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration;
  });

  let lastAt = 0;
  audio.addEventListener('timeupdate', () => {
    const d = audio.duration || 0;
    const now = performance.now();
    if (state.playing && lastAt) trackListening((now - lastAt) * state.rate);
    lastAt = now;
    $('#pTimes').textContent = `${fmtTime(audio.currentTime)} / ${fmtTime(d)}`;
    if (d) {
      const p = audio.currentTime / d;
      seek.value = Math.round(p * 1000);
      $('#pFill').style.width = `${p * 100}%`;
      $('#miniBar').style.width = `${p * 100}%`;
      // تلاشٍ تدريجي قبل النهاية
      if (state.crossfade && d - audio.currentTime < state.crossfade) {
        audio.volume = Math.max(0.05, (d - audio.currentTime) / state.crossfade);
      } else if (audio.volume < 1) audio.volume = 1;
    }
    syncLyrics();
  });
  audio.addEventListener('loadedmetadata', () => {
    const t = state.byId.get(state.currentId);
    if (t && audio.duration && !t.duration) { t.duration = Math.round(audio.duration); saveLibrary(); }
  });
  audio.addEventListener('play', () => {
    lastAt = performance.now();
    state.playing = true;
    renderMini(); renderPlayer();
    $('#imPlay').textContent = '⏸';
    // تحديث الرِفّ والقائمة كي تظهر بطاقة «تابع الاستماع» وتُبرَز الأغنية الجارية
    if (state.tab === 'home' && state.seg === 'library') { renderHeroRail(); renderHomeLibrary(); }
  });
  audio.addEventListener('pause', () => { lastAt = 0; state.playing = false; saveUser(); renderMini(); renderPlayer(); $('#imPlay').textContent = '▶'; });
  audio.addEventListener('ended', () => { audio.volume = 1; next(true); });

  if ('mediaSession' in navigator) {
    const acts = { play: () => audio.play(), pause: () => audio.pause(), nexttrack: () => next(), previoustrack: () => prev() };
    for (const [k, fn] of Object.entries(acts)) {
      try { navigator.mediaSession.setActionHandler(k, fn); } catch { /* غير مدعوم */ }
    }
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden) saveUser(); });

  const { App } = cap();
  if (App) {
    App.addListener('appUrlOpen', (data) => { if (data && data.url) handleRedirect(data.url); });
    App.addListener('backButton', () => {
      if (!$('#sheetRoot').hidden) { closeSheet(); return; }
      if (!$('#immersive').hidden) { $('#immersive').hidden = true; return; }
      if (!$('#player').hidden) { $('#player').hidden = true; return; }
      if (state.tab !== 'home') { state.tab = 'home'; render(); return; }
      if (state.seg !== 'library') { state.seg = 'library'; render(); return; }
      App.exitApp();
    });
  }
}

function togglePlay() {
  if (audio.paused) {
    eq.resume();
    if (audio.src) audio.play();
    else if (state.tracks.length) playTrack(state.tracks[0].id, state.tracks.map((t) => t.id));
  } else audio.pause();
}

// ————————————————————————————————— الإقلاع

(async function boot() {
  try {
    wire();
    await loadAll();
    if (state.connected) {
      drive.about().then((a) => { state.account = a; render(); }).catch(() => {});
      for (const t of state.tracks) {
        // eslint-disable-next-line no-await-in-loop
        t.cached = await audioCache.has(t.driveId);
      }
      syncNow(true);
    }
    render();
    const { StatusBar } = cap();
    if (StatusBar) StatusBar.setBackgroundColor({ color: '#584a5f' }).catch(() => {});
  } catch (e) {
    document.body.innerHTML = `<div class="empty">تعذّر الإقلاع: ${e.message}</div>`;
  }
}());

window.LiwaMobile = {
  state, drive, eq, playTrack, syncNow, render, scanFolder, readTagsInBackground,
  renderActivity, openImmersive, eqSheet, queueSheet,
};
