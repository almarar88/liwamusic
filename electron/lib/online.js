'use strict';
/**
 * LiwaMusic — خدمات الإنترنت: أغلفة الألبومات، كلمات الأغاني (مع التزامن)،
 * إثراء البيانات من MusicBrainz، ونبذة عن الفنان من ويكيبيديا.
 * كل الطلبات تتم في العملية الرئيسية فقط، والنتائج تُخزَّن محليًا في الكاش.
 */
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const UA = 'LiwaMusic/1.0.0 ( https://github.com/almarar88/mbzuh )';
const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');

/** طابور بسيط لاحترام حدود المعدل (MusicBrainz: طلب واحد بالثانية). */
function rateLimiter(minGapMs) {
  let last = 0;
  let chain = Promise.resolve();
  return (fn) => {
    chain = chain.then(async () => {
      const wait = Math.max(0, minGapMs - (Date.now() - last));
      if (wait) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      return fn();
    }, async () => fn());
    return chain;
  };
}
const mbLimit = rateLimiter(1100);

async function httpJSON(url, { timeout = 12000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function httpBuffer(url, { timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } finally {
    clearTimeout(timer);
  }
}

/** هل يوجد اتصال بالإنترنت فعليًا؟ */
async function isOnline() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch('https://itunes.apple.com/search?term=a&limit=1', {
      signal: ctrl.signal, headers: { 'User-Agent': UA },
    });
    clearTimeout(timer);
    return res.ok;
  } catch { return false; }
}

/**
 * البحث عن غلاف ألبوم عبر iTunes Search API ثم تنزيله إلى كاش الأغلفة.
 * يعيد اسم ملف الغلاف داخل مجلد الكاش أو null.
 */
async function fetchArtwork({ artist, album, title, artDir, size = 600 }) {
  const term = [artist, album || title].filter(Boolean).join(' ').trim();
  if (!term) return null;
  const key = `${(artist || '').toLowerCase()}|${(album || title || '').toLowerCase()}`;
  const name = `net_${hash(key)}.jpg`;
  const dest = path.join(artDir, name);
  try { await fsp.access(dest); return name; } catch { /* ننزّل */ }

  const entity = album ? 'album' : 'musicTrack';
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=${entity}&limit=5`;
  const data = await httpJSON(url);
  const hit = (data.results || []).find((r) => r.artworkUrl100);
  if (!hit) return null;
  const big = String(hit.artworkUrl100).replace(/\/\d+x\d+bb\./, `/${size}x${size}bb.`);
  const buf = await httpBuffer(big);
  if (!buf || buf.length < 1024) return null;
  await fsp.mkdir(artDir, { recursive: true });
  await fsp.writeFile(dest, buf);
  return name;
}

/** يحوّل نص LRC إلى أسطر مُوقّتة. */
function parseLRC(text) {
  if (!text) return [];
  const lines = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const content = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) {
      const ms = Number(m[3] || 0);
      const frac = m[3] ? (m[3].length === 3 ? ms / 1000 : ms / 100) : 0;
      lines.push({ time: Number(m[1]) * 60 + Number(m[2]) + frac, text: content });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

/**
 * كلمات الأغنية من LRCLIB (مجانية وبدون مفتاح). تعيد { synced[], plain, source }.
 */
async function fetchLyrics({ artist, title, album, duration }) {
  if (!title) return null;
  const qs = new URLSearchParams({
    artist_name: artist || '',
    track_name: title,
  });
  if (album) qs.set('album_name', album);
  if (duration) qs.set('duration', String(Math.round(duration)));

  let hit = null;
  try {
    hit = await httpJSON(`https://lrclib.net/api/get?${qs.toString()}`);
  } catch {
    try {
      const search = await httpJSON(
        `https://lrclib.net/api/search?q=${encodeURIComponent([artist, title].filter(Boolean).join(' '))}`,
      );
      hit = Array.isArray(search) ? search[0] : null;
    } catch { hit = null; }
  }
  if (!hit) return null;
  const synced = parseLRC(hit.syncedLyrics);
  const plain = (hit.plainLyrics || '').trim();
  if (!synced.length && !plain) return null;
  return { synced, plain, source: 'LRCLIB', instrumental: !!hit.instrumental };
}

/** إثراء البيانات من MusicBrainz: السنة، النوع، معرّفات التسجيل. */
async function fetchMeta({ artist, title, album }) {
  if (!title) return null;
  const parts = [`recording:"${title.replace(/"/g, '')}"`];
  if (artist) parts.push(`artist:"${artist.replace(/"/g, '')}"`);
  if (album) parts.push(`release:"${album.replace(/"/g, '')}"`);
  const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(parts.join(' AND '))}&fmt=json&limit=3`;
  const data = await mbLimit(() => httpJSON(url));
  const rec = (data.recordings || [])[0];
  if (!rec) return null;
  const release = (rec.releases || [])[0];
  const tags = (rec.tags || []).sort((a, b) => (b.count || 0) - (a.count || 0)).map((t) => t.name);
  const date = release && (release.date || (release['release-group'] || {})['first-release-date']);
  return {
    mbid: rec.id,
    artist: ((rec['artist-credit'] || [])[0] || {}).name || '',
    album: release ? release.title : '',
    year: date ? Number(String(date).slice(0, 4)) || 0 : 0,
    genre: tags[0] || '',
    tags: tags.slice(0, 6),
    source: 'MusicBrainz',
  };
}

/** نبذة عن الفنان من ويكيبيديا (عربي ثم إنجليزي). */
async function fetchArtistInfo(artist, lang = 'ar') {
  if (!artist) return null;
  const order = lang === 'ar' ? ['ar', 'en'] : ['en', 'ar'];
  for (const code of order) {
    try {
      const url = `https://${code}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(artist)}`;
      const data = await httpJSON(url);
      if (data && data.extract) {
        return {
          title: data.title,
          extract: data.extract,
          url: (data.content_urls && data.content_urls.desktop && data.content_urls.desktop.page) || '',
          thumb: (data.thumbnail && data.thumbnail.source) || '',
          lang: code,
        };
      }
    } catch { /* نجرّب اللغة التالية */ }
  }
  return null;
}

module.exports = {
  isOnline, fetchArtwork, fetchLyrics, fetchMeta, fetchArtistInfo, parseLRC, httpJSON,
};
