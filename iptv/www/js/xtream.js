/* LiwaIPTV — عميل Xtream Codes API (player_api.php): الحساب، الأقسام، القنوات،
   الأفلام، المسلسلات، دليل البرامج، والأرشيف (Catch-up). */
'use strict';

import { http } from './http.js';
import { b64, isAdult, parseTitle } from './util.js';

/** يوحّد عنوان الخادم: يضيف http:// ويحذف get.php/player_api.php والشرطة الأخيرة. */
export function normServer(s) {
  let u = String(s || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  u = u.replace(/\/(?:player_api|get|xmltv)\.php.*$/i, '').replace(/\/c\/?$/i, '').replace(/\/+$/, '');
  return u;
}

const api = (pl, params = {}) => {
  const q = new URLSearchParams({ username: pl.username, password: pl.password, ...params });
  return `${normServer(pl.server)}/player_api.php?${q}`;
};

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const arr = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);

/** التحقق من الحساب. يرمي خطأً واضحًا بالعربية إن رُفض. */
export async function login(pl) {
  const data = await http.json(api(pl));
  const u = data && data.user_info;
  if (!u || Number(u.auth) === 0) throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة');
  if (u.status && !/active/i.test(u.status)) throw new Error(`الاشتراك غير فعّال (${u.status})`);
  return {
    status: u.status,
    expires: u.exp_date ? Number(u.exp_date) * 1000 : null,
    maxConnections: num(u.max_connections),
    activeConnections: num(u.active_cons),
    trial: String(u.is_trial) === '1',
    formats: arr(u.allowed_output_formats),
    timezone: data.server_info && data.server_info.timezone,
  };
}

function mapCats(list, kind) {
  return arr(list).map((c) => ({
    id: `${kind[0]}:${c.category_id}`, name: String(c.category_name || '').trim() || '—', adult: isAdult(c.category_name),
  }));
}

/** تحميل المكتبة كاملة؛ onProgress(نص) لإظهار التقدم. */
export async function load(pl, onProgress = () => {}) {
  onProgress('التحقق من الحساب…');
  const account = await login(pl);
  onProgress('تحميل الأقسام…');
  const [lc, vc, sc] = await Promise.all([
    http.json(api(pl, { action: 'get_live_categories' })).catch(() => []),
    http.json(api(pl, { action: 'get_vod_categories' })).catch(() => []),
    http.json(api(pl, { action: 'get_series_categories' })).catch(() => []),
  ]);
  onProgress('تحميل القنوات…');
  const live = await http.json(api(pl, { action: 'get_live_streams' })).catch(() => []);
  onProgress('تحميل الأفلام…');
  const vod = await http.json(api(pl, { action: 'get_vod_streams' })).catch(() => []);
  onProgress('تحميل المسلسلات…');
  const series = await http.json(api(pl, { action: 'get_series' })).catch(() => []);

  const items = [];
  for (const s of arr(live)) {
    items.push({
      id: `l:${s.stream_id}`, sid: s.stream_id, kind: 'live', name: String(s.name || '').trim(),
      logo: s.stream_icon || '', cat: `l:${s.category_id}`, num: num(s.num), epgId: s.epg_channel_id || '',
      added: num(s.added),
      catchup: Number(s.tv_archive) ? { days: num(s.tv_archive_duration), type: 'xtream' } : undefined,
    });
  }
  for (const s of arr(vod)) {
    const t = parseTitle(s.name);
    items.push({
      id: `m:${s.stream_id}`, sid: s.stream_id, kind: 'movie', name: String(s.name || '').trim(),
      title: t.title, year: t.year || (s.year ? num(s.year) : null), quality: t.quality,
      logo: s.stream_icon || '', cat: `m:${s.category_id}`, added: num(s.added),
      rating: num(s.rating) || num(s.rating_5based) * 2, ext: s.container_extension || 'mp4',
    });
  }
  for (const s of arr(series)) {
    const t = parseTitle(s.name);
    items.push({
      id: `s:${s.series_id}`, sid: s.series_id, kind: 'series', name: String(s.name || '').trim(),
      title: t.title, year: t.year || (s.releaseDate ? Number(String(s.releaseDate).slice(0, 4)) || null : null),
      logo: s.cover || '', backdrop: arr(s.backdrop_path)[0] || '', cat: `s:${s.category_id}`,
      added: num(s.last_modified), rating: num(s.rating) || num(s.rating_5based) * 2,
      plot: s.plot || '', genre: s.genre || '', cast: s.cast || '',
    });
  }
  return {
    account,
    cats: { live: mapCats(lc, 'live'), movie: mapCats(vc, 'movie'), series: mapCats(sc, 'series') },
    items,
    epgUrl: `${normServer(pl.server)}/xmltv.php?username=${encodeURIComponent(pl.username)}&password=${encodeURIComponent(pl.password)}`,
  };
}

/** صيغة البث المفضّلة للقنوات: m3u8 إن سمح بها الخادم (أثبت على الشبكات الضعيفة) وإلا ts. */
export function liveExt(pl, account) {
  const pref = pl.liveFormat || 'auto';
  if (pref !== 'auto') return pref;
  const f = (account && account.formats) || [];
  if (!f.length || f.includes('m3u8')) return 'm3u8';
  return 'ts';
}

export function streamUrl(pl, item, account) {
  const base = normServer(pl.server);
  const u = encodeURIComponent(pl.username);
  const p = encodeURIComponent(pl.password);
  if (item.kind === 'live') return `${base}/live/${u}/${p}/${item.sid}.${liveExt(pl, account)}`;
  if (item.kind === 'movie') return `${base}/movie/${u}/${p}/${item.sid}.${item.ext || 'mp4'}`;
  if (item.kind === 'episode') return `${base}/series/${u}/${p}/${item.sid}.${item.ext || 'mp4'}`;
  return '';
}

/** رابط الأرشيف لبرنامج سابق. start نص بتوقيت الخادم "YYYY-MM-DD HH:MM:SS". */
export function catchupUrl(pl, item, start, durationMin) {
  const base = normServer(pl.server);
  const s = String(start).slice(0, 16).replace(' ', ':').replace(/:(\d\d)$/, '-$1');
  return `${base}/timeshift/${encodeURIComponent(pl.username)}/${encodeURIComponent(pl.password)}/${Math.max(1, Math.round(durationMin))}/${s}/${item.sid}.ts`;
}

/** تفاصيل فيلم: القصة، الممثلون، الخلفية، المدة، الإعلان. */
export async function movieInfo(pl, item) {
  const d = await http.json(api(pl, { action: 'get_vod_info', vod_id: item.sid }));
  const i = (d && d.info) || {};
  return {
    plot: i.plot || i.description || '',
    cast: i.cast || i.actors || '',
    director: i.director || '',
    genre: i.genre || '',
    year: i.releasedate ? Number(String(i.releasedate).slice(0, 4)) || null : null,
    duration: i.duration_secs ? Math.round(num(i.duration_secs) / 60) : 0,
    rating: num(i.rating),
    poster: i.movie_image || i.cover_big || '',
    backdrop: arr(i.backdrop_path)[0] || '',
    trailer: i.youtube_trailer || '',
    tmdb: i.tmdb_id || '',
    ext: (d && d.movie_data && d.movie_data.container_extension) || item.ext,
  };
}

/** مواسم وحلقات مسلسل. */
export async function seriesInfo(pl, item) {
  const d = await http.json(api(pl, { action: 'get_series_info', series_id: item.sid }));
  const info = (d && d.info) || {};
  const seasonMeta = new Map(arr(d && d.seasons).map((s) => [num(s.season_number), s]));
  const seasons = [];
  const eps = (d && d.episodes) || {};
  for (const key of Object.keys(eps).sort((a, b) => num(a) - num(b))) {
    const n = num(key);
    const meta = seasonMeta.get(n) || {};
    seasons.push({
      num: n,
      name: meta.name || `الموسم ${n}`,
      cover: meta.cover || meta.cover_big || '',
      episodes: arr(eps[key]).map((e) => ({
        id: `e:${e.id}`, sid: e.id, kind: 'episode', season: n, episode: num(e.episode_num),
        title: String(e.title || '').trim(), ext: e.container_extension || 'mp4',
        img: (e.info && e.info.movie_image) || '', plot: (e.info && e.info.plot) || '',
        duration: e.info && e.info.duration_secs ? Math.round(num(e.info.duration_secs) / 60) : 0,
      })).sort((a, b) => a.episode - b.episode),
    });
  }
  return {
    plot: info.plot || '', cast: info.cast || '', genre: info.genre || '', director: info.director || '',
    backdrop: arr(info.backdrop_path)[0] || '', poster: info.cover || '', rating: num(info.rating),
    trailer: info.youtube_trailer || '', seasons,
  };
}

/** البرنامج الحالي والقادم لقناة. */
export async function shortEpg(pl, item, limit = 6) {
  const d = await http.json(api(pl, { action: 'get_short_epg', stream_id: item.sid, limit }));
  return arr(d && d.epg_listings).map((e) => ({
    title: b64(e.title), desc: b64(e.description),
    start: num(e.start_timestamp) * 1000, end: num(e.stop_timestamp) * 1000,
    startRaw: e.start, archive: Number(e.has_archive) === 1,
  }));
}

/** جدول اليوم الكامل (للأرشيف). */
export async function fullEpg(pl, item) {
  const d = await http.json(api(pl, { action: 'get_simple_data_table', stream_id: item.sid }));
  return arr(d && d.epg_listings).map((e) => ({
    title: b64(e.title), desc: b64(e.description),
    start: num(e.start_timestamp) * 1000, end: num(e.stop_timestamp) * 1000,
    startRaw: e.start, archive: Number(e.has_archive) === 1,
  }));
}
