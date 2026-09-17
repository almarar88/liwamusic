'use strict';
/**
 * LiwaTube — محرك توصيات محلي (بلا إنترنت وبلا API):
 * يبني «الرئيسية» و«التالي» من سلوك المشاهدة: القنوات المفضّلة، الوسوم،
 * الفيديوهات غير المكتملة، الجديد، والتنويع. تُستخدم نتائجه أيضًا كمرشّح أولي للذكاء الاصطناعي.
 */

const DAY = 86400000;

function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/** يجمع ملف الاهتمامات: أوزان القنوات والوسوم من السجل والإعجابات والاشتراكات. */
function profile(videos, user) {
  const ch = new Map();
  const tag = new Map();
  const bump = (m, k, w) => { if (k) m.set(k, (m.get(k) || 0) + w); };
  const now = Date.now();
  const tagsOf = (v) => {
    const ai = (user.ai || {})[v.id] || {};
    const ov = (user.overrides || {})[v.id] || {};
    return [...(ov.tags || ai.tags || []), ai.category].filter(Boolean).map((t) => String(t).toLowerCase());
  };
  for (const h of (user.history || []).slice(0, 200)) {
    const v = videos[h.id];
    if (!v) continue;
    const age = (now - (h.at || now)) / DAY;
    const w = Math.max(0.2, 1 - age / 60); // يخفت خلال شهرين
    bump(ch, v.channelId, w);
    for (const t of tagsOf(v)) bump(tag, t, w * 0.6);
  }
  for (const [id, val] of Object.entries(user.likes || {})) {
    const v = videos[id];
    if (!v) continue;
    bump(ch, v.channelId, val > 0 ? 2 : -3);
    for (const t of tagsOf(v)) bump(tag, t, val > 0 ? 1 : -1.5);
  }
  for (const id of Object.keys(user.subscriptions || {})) bump(ch, id, 3);
  for (const id of Object.keys(user.notInterested || {})) bump(ch, id, -50);
  return { channels: ch, tags: tag, tagsOf };
}

/** درجة فيديو واحد وفق ملف الاهتمامات. */
function score(v, user, prof, now = Date.now()) {
  if ((user.hidden || {})[v.id]) return -Infinity;
  const plays = (user.playCount || {})[v.id] || 0;
  const prog = (user.progress || {})[v.id];
  let s = 0;
  const reasons = [];
  const cw = prof.channels.get(v.channelId) || 0;
  if (cw > 0) { s += Math.min(6, cw); reasons.push('channel'); }
  else if (cw < -10) return -Infinity;
  let tw = 0;
  for (const t of prof.tagsOf(v)) tw += prof.tags.get(t) || 0;
  if (tw > 0) { s += Math.min(5, tw); reasons.push('tags'); }
  if (prog && prog.dur > 0) {
    const ratio = prog.pos / prog.dur;
    if (ratio > 0.05 && ratio < 0.92) { s += 4; reasons.push('resume'); }
    else if (ratio >= 0.92) s -= 3;
  }
  if (plays === 0) { s += 2; reasons.push('new'); }
  else s -= Math.min(4, plays * 0.8);
  const ageDays = (now - (v.addedAt || v.mtimeMs || now)) / DAY;
  if (ageDays < 7) { s += 2.5 - ageDays * 0.3; reasons.push('recent'); }
  const last = (user.lastPlayed || {})[v.id] || 0;
  if (last && now - last < DAY) s -= 5;
  return { s, reasons };
}

/** تنويع النتائج: يوزّع القنوات على دفعات (لا أكثر من N من القناة ذاتها في كل دفعة). */
function diversify(list, perChannel = 3) {
  const out = [];
  let rest = list;
  while (rest.length) {
    const count = new Map();
    const head = []; const tail = [];
    for (const item of rest) {
      const c = count.get(item.v.channelId) || 0;
      if (c < perChannel) { head.push(item); count.set(item.v.channelId, c + 1); } else tail.push(item);
    }
    out.push(...head);
    if (!head.length) { out.push(...tail); break; }
    rest = tail;
  }
  return out;
}

/** خلط مستقر بمولّد بذرة (حتى لا تتغيّر الصفحة عند كل إعادة رسم). */
function seededJitter(seed) {
  let x = (seed >>> 0) || 1;
  return () => {
    x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0;
    return (x % 1000) / 1000;
  };
}

/** يعيد قائمة فيديوهات الصفحة الرئيسية مرتّبة: [{id, reasons}]. */
function homeFeed(videos, user, { limit = 60, seed = 1 } = {}) {
  const prof = profile(videos, user);
  const rnd = seededJitter(seed);
  const now = Date.now();
  const scored = [];
  for (const v of Object.values(videos)) {
    const r = score(v, user, prof, now);
    if (r === -Infinity) continue;
    scored.push({ v, s: r.s + rnd() * 1.5, reasons: r.reasons });
  }
  scored.sort((a, b) => b.s - a.s);
  return diversify(scored, 3).slice(0, limit).map((x) => ({ id: x.v.id, reasons: x.reasons, score: Math.round(x.s * 10) / 10 }));
}

/** فيديوهات «التالي» المشابهة لفيديو معيّن. */
function related(seedVideo, videos, user, { limit = 20 } = {}) {
  if (!seedVideo) return [];
  const prof = profile(videos, user);
  const seedTags = new Set(prof.tagsOf(seedVideo));
  const seedWords = new Set(tokens(seedVideo.title));
  const out = [];
  for (const v of Object.values(videos)) {
    if (v.id === seedVideo.id || (user.hidden || {})[v.id]) continue;
    let s = 0;
    const reasons = [];
    if (v.channelId === seedVideo.channelId) { s += 4; reasons.push('channel'); }
    if (v.folder === seedVideo.folder) s += 1.5;
    let overlap = 0;
    for (const t of prof.tagsOf(v)) if (seedTags.has(t)) overlap++;
    if (overlap) { s += Math.min(5, overlap * 1.7); reasons.push('tags'); }
    let words = 0;
    for (const w of tokens(v.title)) if (seedWords.has(w)) words++;
    if (words) { s += Math.min(3, words); reasons.push('title'); }
    if (seedVideo.duration && v.duration) {
      const ratio = Math.min(v.duration, seedVideo.duration) / Math.max(v.duration, seedVideo.duration);
      s += ratio * 1.2;
    }
    if (!(user.playCount || {})[v.id]) s += 1;
    s += (prof.channels.get(v.channelId) || 0) * 0.3;
    out.push({ v, s, reasons });
  }
  out.sort((a, b) => b.s - a.s);
  return diversify(out, 4).slice(0, limit).map((x) => ({ id: x.v.id, reasons: x.reasons }));
}

/** بحث نصي محلي مع ترتيب بالملاءمة: العنوان، القناة، الوسوم، الوصف. */
function search(query, videos, user, { limit = 200 } = {}) {
  const q = tokens(query);
  if (!q.length) return [];
  const prof = profile(videos, user);
  const out = [];
  const raw = String(query || '').toLowerCase().trim();
  for (const v of Object.values(videos)) {
    const ai = (user.ai || {})[v.id] || {};
    const ov = (user.overrides || {})[v.id] || {};
    const title = (ov.title || v.title || '').toLowerCase();
    const desc = (ov.description || ai.description || ai.summary || '').toLowerCase();
    const chan = (v.channel || '').toLowerCase();
    const tags = prof.tagsOf(v).join(' ');
    let s = 0;
    if (title.includes(raw)) s += 10;
    if (chan.includes(raw)) s += 6;
    for (const w of q) {
      if (title.includes(w)) s += 4;
      if (chan.includes(w)) s += 2.5;
      if (tags.includes(w)) s += 2;
      if (desc.includes(w)) s += 1;
      if (v.file.toLowerCase().includes(w)) s += 0.5;
    }
    if (s > 0) out.push({ id: v.id, s });
  }
  out.sort((a, b) => b.s - a.s);
  return out.slice(0, limit);
}

const API = { homeFeed, related, search, profile, score, tokens, diversify };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else if (typeof window !== 'undefined') window.LTRecommend = API;
