/* LiwaMusic للهاتف — التخزين المحلي (IndexedDB + Cache API) ودمج المزامنة.
   تم إنشاؤه عن طريق LiwaMusic. */
'use strict';

const DB_NAME = 'liwamusic';
const DB_STORE = 'kv';
const AUDIO_CACHE = 'liwa-audio-v1';

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(DB_STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function idb(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(DB_STORE, mode);
    const req = fn(tx.objectStore(DB_STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** مخزن مفتاح/قيمة يعمل بلا حدود حجم عمليًا (بخلاف localStorage). */
export const store = {
  get: (key) => idb('readonly', (s) => s.get(key)).catch(() => null),
  set: (key, value) => idb('readwrite', (s) => s.put(value, key)).then(() => true).catch(() => false),
  remove: (key) => idb('readwrite', (s) => s.delete(key)).then(() => true).catch(() => false),
};

/** تخزين ملفات الصوت للاستماع دون إنترنت. */
export const audioCache = {
  async has(fileId) {
    try {
      const cache = await caches.open(AUDIO_CACHE);
      return !!(await cache.match(`/audio/${fileId}`));
    } catch { return false; }
  },
  async put(fileId, blob) {
    try {
      const cache = await caches.open(AUDIO_CACHE);
      await cache.put(`/audio/${fileId}`, new Response(blob));
      return true;
    } catch { return false; }
  },
  async get(fileId) {
    try {
      const cache = await caches.open(AUDIO_CACHE);
      const res = await cache.match(`/audio/${fileId}`);
      return res ? res.blob() : null;
    } catch { return null; }
  },
  async remove(fileId) {
    try {
      const cache = await caches.open(AUDIO_CACHE);
      return cache.delete(`/audio/${fileId}`);
    } catch { return false; }
  },
  async stats() {
    try {
      const cache = await caches.open(AUDIO_CACHE);
      const keys = await cache.keys();
      let bytes = 0;
      for (const k of keys) {
        // eslint-disable-next-line no-await-in-loop
        const res = await cache.match(k);
        // eslint-disable-next-line no-await-in-loop
        if (res) bytes += (await res.clone().blob()).size;
      }
      return { count: keys.length, bytes };
    } catch { return { count: 0, bytes: 0 }; }
  },
  async clear() {
    try { await caches.delete(AUDIO_CACHE); return true; } catch { return false; }
  },
};

// ————————————————————————————— دمج المزامنة (مطابق لمنطق نسخة الكمبيوتر)

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function mergeStamped(localMap = {}, localAt = {}, remoteMap = {}, remoteAt = {}) {
  const map = {}; const at = {};
  for (const key of new Set([...Object.keys(localMap), ...Object.keys(remoteMap)])) {
    const lt = num(localAt[key]); const rt = num(remoteAt[key]);
    const value = rt > lt ? remoteMap[key] : localMap[key];
    const stamp = Math.max(lt, rt);
    if (value === undefined || value === null || value === false) {
      if (stamp) at[key] = stamp;
      continue;
    }
    map[key] = value;
    if (stamp) at[key] = stamp;
  }
  return { map, at };
}

export function mergeObjects(local = {}, remote = {}) {
  const out = {};
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const l = local[key]; const r = remote[key];
    if (!l) { out[key] = r; continue; }
    if (!r) { out[key] = l; continue; }
    out[key] = num(r.at) > num(l.at) ? r : l;
  }
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return out;
}

export function mergeHistory(local = [], remote = [], limit = 500) {
  const seen = new Set();
  const out = [];
  for (const h of [...local, ...remote].filter((x) => x && x.id).sort((a, b) => num(b.at) - num(a.at))) {
    const key = `${h.id}|${Math.round(num(h.at) / 1000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: h.id, at: num(h.at) });
    if (out.length >= limit) break;
  }
  return out;
}

export function mergeUserData(local = {}, remote = null) {
  if (!remote) return { ...local };
  const fav = mergeStamped(local.favorites, local.favAt, remote.favorites, remote.favAt);
  const rate = mergeStamped(local.ratings, local.ratedAt, remote.ratings, remote.ratedAt);
  const playCount = {};
  for (const k of new Set([...Object.keys(local.playCount || {}), ...Object.keys(remote.playCount || {})])) {
    playCount[k] = Math.max(num((local.playCount || {})[k]), num((remote.playCount || {})[k]));
  }
  const lastPlayed = {};
  for (const k of new Set([...Object.keys(local.lastPlayed || {}), ...Object.keys(remote.lastPlayed || {})])) {
    lastPlayed[k] = Math.max(num((local.lastPlayed || {})[k]), num((remote.lastPlayed || {})[k]));
  }
  return {
    ...local,
    favorites: fav.map,
    favAt: fav.at,
    ratings: rate.map,
    ratedAt: rate.at,
    playCount,
    lastPlayed,
    ai: mergeObjects(local.ai, remote.ai),
    overrides: mergeObjects(local.overrides, remote.overrides),
    artOverrides: mergeObjects(local.artOverrides, remote.artOverrides),
    history: mergeHistory(local.history, remote.history),
  };
}

export function mergePlaylists(localItems = [], remoteItems = [], localDeleted = {}, remoteDeleted = {}) {
  const deleted = {};
  for (const k of new Set([...Object.keys(localDeleted), ...Object.keys(remoteDeleted)])) {
    deleted[k] = Math.max(num(localDeleted[k]), num(remoteDeleted[k]));
  }
  const byId = new Map();
  for (const pl of [...localItems, ...remoteItems]) {
    if (!pl || !pl.id) continue;
    const prev = byId.get(pl.id);
    if (!prev || num(pl.updatedAt) > num(prev.updatedAt)) byId.set(pl.id, pl);
  }
  const items = [...byId.values()]
    .filter((pl) => !(deleted[pl.id] && deleted[pl.id] >= num(pl.updatedAt)))
    .sort((a, b) => num(b.updatedAt) - num(a.updatedAt));
  return { items, deleted };
}

export function buildPayload({ userdata, playlists, deletedPlaylists, deviceId }) {
  return {
    app: 'LiwaMusic',
    syncVersion: 1,
    device: deviceId || 'android',
    updatedAt: Date.now(),
    userdata,
    playlists: playlists || [],
    deletedPlaylists: deletedPlaylists || {},
  };
}

export const DEFAULT_USERDATA = {
  version: 1,
  favorites: {}, favAt: {}, ratings: {}, ratedAt: {},
  playCount: {}, lastPlayed: {}, ai: {}, overrides: {}, artOverrides: {}, history: [],
};
