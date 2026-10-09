/* LiwaIPTV — بوابات Stalker / Ministra (اشتراكات MAC مثل أجهزة MAG):
   مصافحة، ملف الجهاز، القنوات وأقسامها، وأقسام الأفلام (تُحمَّل عند فتحها). */
'use strict';

import { http } from './http.js';
import { isAdult, parseTitle } from './util.js';

const UA = 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3';

export function normMac(mac) {
  const hex = String(mac || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  if (hex.length !== 12) return '';
  return hex.match(/../g).join(':');
}

/** مسارات واجهة البوابة المحتملة من رابطها ("http://host:8080/c/"). */
export function endpoints(portal) {
  let u = String(portal || '').trim();
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  const url = new URL(u);
  const base = `${url.protocol}//${url.host}`;
  const path = url.pathname.replace(/\/c\/?$/i, '').replace(/\/(?:portal|load)\.php$/i, '').replace(/\/+$/, '');
  const list = [];
  if (/\.php$/i.test(url.pathname)) list.push(`${base}${url.pathname}`);
  list.push(`${base}${path}/portal.php`, `${base}${path}/server/load.php`, `${base}/stalker_portal/server/load.php`);
  return { referer: `${base}${path || ''}/c/`, list: [...new Set(list)] };
}

function headers(pl, token) {
  const mac = normMac(pl.mac);
  const h = {
    'User-Agent': UA,
    'X-User-Agent': 'Model: MAG250; Link: WiFi',
    Cookie: `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')}`,
    Referer: endpoints(pl.server).referer,
    Accept: '*/*',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

// جلسة لكل بوابة: { api, token }
const sessions = new Map();

async function call(pl, params, token, api) {
  const q = new URLSearchParams({ ...params, JsHttpRequest: '1-xml' });
  const d = await http.json(`${api}?${q}`, { headers: headers(pl, token) });
  return d && d.js !== undefined ? d.js : d;
}

async function session(pl, fresh = false) {
  const key = `${pl.server}|${pl.mac}`;
  if (!fresh && sessions.has(key)) return sessions.get(key);
  if (!normMac(pl.mac)) throw new Error('عنوان MAC غير صالح (مثال 00:1A:79:12:34:56)');
  let lastErr = null;
  for (const api of endpoints(pl.server).list) {
    try {
      const hs = await call(pl, { type: 'stb', action: 'handshake', token: '' }, '', api);
      const token = hs && hs.token;
      if (!token) continue;
      const prof = await call(pl, {
        type: 'stb', action: 'get_profile', hd: '1', ver: 'ImageDescription: 0.2.18-r23-250; ImageDate: Thu Sep 13 11:31:16 EEST 2018; PORTAL version: 5.6.2; API Version: JS API version: 343; STB API version: 146; Player Engine version: 0x58c',
        num_banks: '2', sn: '', stb_type: 'MAG250', image_version: '218', video_out: 'hdmi', auth_second_step: '1', hw_version: '1.7-BD-00',
        not_valid_token: '0', api_signature: '262',
      }, token, api);
      if (prof && prof.status === 2) throw new Error('البوابة رفضت عنوان MAC هذا');
      const s = { api, token, profile: prof || {} };
      sessions.set(key, s);
      return s;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('تعذّر الاتصال بالبوابة — تحقق من الرابط');
}

async function sCall(pl, params) {
  let s = await session(pl);
  try { return await call(pl, params, s.token, s.api); } catch (e) {
    if (e.status === 401 || e.status === 403) { s = await session(pl, true); return call(pl, params, s.token, s.api); }
    throw e;
  }
}

export async function load(pl, onProgress = () => {}) {
  onProgress('الاتصال بالبوابة…');
  const s = await session(pl, true);
  onProgress('تحميل أقسام القنوات…');
  const genres = await sCall(pl, { type: 'itv', action: 'get_genres' }).catch(() => []);
  onProgress('تحميل القنوات…');
  const all = await sCall(pl, { type: 'itv', action: 'get_all_channels' });
  const chans = (all && all.data) || (Array.isArray(all) ? all : []);
  onProgress('تحميل أقسام الأفلام…');
  const vodCats = await sCall(pl, { type: 'vod', action: 'get_categories' }).catch(() => []);
  const seriesCats = await sCall(pl, { type: 'series', action: 'get_categories' }).catch(() => []);

  const cats = {
    live: (genres || []).filter((g) => g.id !== '*').map((g) => ({ id: `l:${g.id}`, name: g.title, adult: isAdult(g.title) || g.censored === '1' })),
    movie: (vodCats || []).filter((g) => g.id !== '*').map((g) => ({ id: `m:${g.id}`, name: g.title, adult: isAdult(g.title) || g.censored === '1', lazy: true })),
    series: (seriesCats || []).filter((g) => g.id !== '*').map((g) => ({ id: `s:${g.id}`, name: g.title, adult: isAdult(g.title) || g.censored === '1', lazy: true })),
  };
  const items = chans.map((c) => ({
    id: `l:${c.id}`, sid: c.id, kind: 'live', name: c.name, logo: logoUrl(pl, c.logo), cat: `l:${c.tv_genre_id}`,
    num: Number(c.number) || 0, epgId: c.xmltv_id || '', cmd: c.cmd,
    catchup: Number(c.tv_archive) ? { days: Number(c.tv_archive_duration) || 1, type: 'stalker' } : undefined,
  }));
  const exp = s.profile && (s.profile.expire_billing_date || s.profile.end_date);
  return { account: { status: 'Active', expires: exp ? Date.parse(exp) || null : null }, cats, items, epgUrl: '' };
}

function logoUrl(pl, logo) {
  if (!logo) return '';
  if (/^https?:/i.test(logo)) return logo;
  const { referer } = endpoints(pl.server);
  return new URL(`../misc/logos/320/${logo}`, referer).href;
}

/** تحميل عناصر قسم أفلام/مسلسلات (صفحات حتى maxPages). */
export async function loadCategory(pl, cat, maxPages = 15) {
  const [k, id] = cat.id.split(':');
  const type = k === 'm' ? 'vod' : 'series';
  const out = [];
  for (let p = 1; p <= maxPages; p++) {
    const d = await sCall(pl, { type, action: 'get_ordered_list', category: id, genre: '*', sortby: 'added', p: String(p) });
    const data = (d && d.data) || [];
    for (const v of data) {
      const t = parseTitle(v.name);
      const isSeries = type === 'series' || v.is_series === '1';
      out.push({
        id: `${isSeries ? 's' : 'm'}:${v.id}`, sid: v.id, kind: isSeries ? 'series' : 'movie', name: v.name,
        title: t.title, year: Number(v.year) || t.year, logo: v.screenshot_uri || '', cat: cat.id,
        rating: Number(v.rating_imdb) || 0, plot: v.description || '', cmd: v.cmd, added: Date.parse(v.added) / 1000 || 0,
        genre: v.genres_str || '', cast: v.actors || '', director: v.director || '',
      });
    }
    const total = Number(d && d.total_items) || 0;
    const per = Number(d && d.max_page_items) || data.length || 1;
    if (!data.length || p * per >= total) break;
  }
  return out;
}

/** مواسم مسلسل Stalker (القوائم تختلف بين البوابات؛ نجرّب الشكلين الشائعين). */
export async function seriesInfo(pl, item) {
  const d = await sCall(pl, { type: 'series', action: 'get_ordered_list', movie_id: item.sid, season_id: '0', episode_id: '0', p: '1' }).catch(() => null);
  const data = (d && d.data) || [];
  const seasons = data.map((s, i) => {
    const n = Number(String(s.name || '').match(/\d+/)) || i + 1;
    const eps = (s.series || []).map((ep) => ({
      id: `e:${s.id}:${ep}`, kind: 'episode', season: n, episode: Number(ep), title: `الحلقة ${ep}`, cmd: s.cmd, seriesNum: ep,
    }));
    return { num: n, name: s.name || `الموسم ${n}`, cover: s.screenshot_uri || '', episodes: eps };
  });
  return { plot: item.plot || '', cast: item.cast || '', genre: item.genre || '', poster: item.logo, seasons };
}

export async function movieInfo(pl, item) {
  return { plot: item.plot || '', cast: item.cast || '', genre: item.genre || '', director: item.director || '', year: item.year, rating: item.rating, poster: item.logo };
}

/** يطلب من البوابة رابط تشغيل مؤقتًا. */
export async function resolveUrl(pl, item) {
  const type = item.kind === 'live' ? 'itv' : 'vod';
  const params = { type, action: 'create_link', cmd: item.cmd, forced_storage: 'undefined', disable_ad: '0', download: '0', force_ch_link_check: '0' };
  if (item.seriesNum) params.series = String(item.seriesNum);
  const d = await sCall(pl, params);
  const cmd = String((d && d.cmd) || item.cmd || '');
  const m = cmd.match(/https?:\/\/\S+/);
  if (!m) throw new Error('لم تُرجع البوابة رابط تشغيل');
  return m[0];
}

export async function shortEpg(pl, item) {
  const d = await sCall(pl, { type: 'itv', action: 'get_short_epg', ch_id: item.sid, size: '6' }).catch(() => []);
  return (Array.isArray(d) ? d : []).map((e) => ({
    title: e.name, desc: e.descr || '', start: Number(e.start_timestamp) * 1000, end: Number(e.stop_timestamp) * 1000,
  }));
}

export const STALKER_UA = UA;
