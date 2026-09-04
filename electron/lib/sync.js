'use strict';
/**
 * LiwaMusic — دمج ومزامنة بيانات المستخدم عبر ملف واحد في مجلد التطبيق الخاص بدرايف.
 *
 * الدمج خالٍ من الآثار الجانبية وقابل للاختبار: يعتمد على طوابع زمنية لكل عنصر
 * بدل «آخر جهاز يكتب يفوز»، حتى لا تضيع تعديلات جهاز إذا زامن الآخر بعده.
 */

const SYNC_VERSION = 1;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** يدمج خريطتين مفتاح→طابع زمني، الأحدث يفوز. */
function mergeStamped(localMap = {}, localAt = {}, remoteMap = {}, remoteAt = {}) {
  const map = {};
  const at = {};
  for (const key of new Set([...Object.keys(localMap), ...Object.keys(remoteMap)])) {
    const lt = num(localAt[key]);
    const rt = num(remoteAt[key]);
    const useRemote = rt > lt;
    const value = useRemote ? remoteMap[key] : localMap[key];
    const stamp = Math.max(lt, rt);
    if (value === undefined || value === null || value === false) {
      if (stamp) at[key] = stamp;   // نُبقي الطابع كشاهد حذف (tombstone)
      continue;
    }
    map[key] = value;
    if (stamp) at[key] = stamp;
  }
  return { map, at };
}

/** يدمج خرائط كائنات تحمل حقل at داخلها (التعديلات، الأغلفة، وسوم الذكاء). */
function mergeObjects(local = {}, remote = {}) {
  const out = {};
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const l = local[key];
    const r = remote[key];
    if (!l) { out[key] = r; continue; }
    if (!r) { out[key] = l; continue; }
    out[key] = num(r.at) > num(l.at) ? r : l;
  }
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return out;
}

/** يدمج قوائم التشغيل بالمعرّف مع احترام شواهد الحذف. */
function mergePlaylists(localItems = [], remoteItems = [], localDeleted = {}, remoteDeleted = {}) {
  const deleted = {};
  for (const key of new Set([...Object.keys(localDeleted), ...Object.keys(remoteDeleted)])) {
    deleted[key] = Math.max(num(localDeleted[key]), num(remoteDeleted[key]));
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

/** يدمج سجل الاستماع ويزيل التكرار ويقصّه. */
function mergeHistory(local = [], remote = [], limit = 1000) {
  const seen = new Set();
  const all = [...local, ...remote]
    .filter((h) => h && h.id)
    .sort((a, b) => num(b.at) - num(a.at));
  const out = [];
  for (const h of all) {
    const key = `${h.id}|${Math.round(num(h.at) / 1000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: h.id, at: num(h.at) });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * الدمج الكامل لبيانات المستخدم.
 * @param {object} local بيانات هذا الجهاز
 * @param {object} remote بيانات درايف (أو null)
 */
function mergeUserData(local = {}, remote = null) {
  if (!remote) return { ...local };
  const fav = mergeStamped(local.favorites, local.favAt, remote.favorites, remote.favAt);
  const rate = mergeStamped(local.ratings, local.ratedAt, remote.ratings, remote.ratedAt);

  const playCount = {};
  for (const key of new Set([...Object.keys(local.playCount || {}), ...Object.keys(remote.playCount || {})])) {
    playCount[key] = Math.max(num((local.playCount || {})[key]), num((remote.playCount || {})[key]));
  }
  const lastPlayed = {};
  for (const key of new Set([...Object.keys(local.lastPlayed || {}), ...Object.keys(remote.lastPlayed || {})])) {
    lastPlayed[key] = Math.max(num((local.lastPlayed || {})[key]), num((remote.lastPlayed || {})[key]));
  }

  return {
    ...local,
    version: local.version || 1,
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

/** يبني الحمولة المرسلة إلى درايف. */
function buildPayload({ userdata, playlists, deletedPlaylists, deviceId }) {
  return {
    app: 'LiwaMusic',
    syncVersion: SYNC_VERSION,
    device: deviceId,
    updatedAt: Date.now(),
    userdata,
    playlists,
    deletedPlaylists: deletedPlaylists || {},
  };
}

module.exports = {
  SYNC_VERSION, mergeUserData, mergeStamped, mergeObjects, mergePlaylists, mergeHistory, buildPayload,
};
