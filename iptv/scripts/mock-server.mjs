/**
 * LiwaIPTV — خادم تجريبي يحاكي مزوّد Xtream Codes ويقدّم واجهة التطبيق، لمعاينتها
 * في المتصفح بلا اشتراك حقيقي. يشغَّل بـ: node scripts/mock-server.mjs [المنفذ] [مجلد الوسائط]
 * بيانات الدخول: الخادم http://localhost:8787 · المستخدم demo · كلمة المرور demo
 * إن وُجد مجلد وسائط فيه live.m3u8 و live.ts و movie.mp4 تُستخدم كبث فعلي.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'www');
const PORT = Number(process.argv[2] || 8787);
const MEDIA = process.argv[3] ? path.resolve(process.argv[3]) : null;
const now = Math.floor(Date.now() / 1000);

const COLORS = ['#7c5cff', '#2ee6d6', '#ff5c8a', '#ffb547', '#3ddc97', '#4aa3ff', '#c45cff'];
const svg = (text, w, h, c) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="#111522"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="52%" font-family="sans-serif" font-size="${Math.round(w / 9)}" font-weight="700" fill="#fff" text-anchor="middle" dominant-baseline="middle">${text}</text></svg>`;

const liveCats = ['أخبار', 'رياضة', 'أفلام', 'أطفال', 'وثائقي', 'دينية', 'منوعات', 'XXX | Adult'];
const chanNames = ['الجزيرة', 'العربية', 'سكاي نيوز عربية', 'beIN Sports 1', 'beIN Sports 2', 'SSC 1', 'MBC 1', 'MBC 2', 'MBC Action', 'روتانا سينما', 'سبيستون', 'كرتون نتورك', 'ناشونال جيوغرافيك أبوظبي', 'الوثائقية', 'القرآن الكريم', 'السنة النبوية', 'دبي', 'أبوظبي', 'LBC', 'Al Hayah'];
const vodCats = ['أفلام عربية', 'أفلام أجنبية', 'أكشن', 'كوميديا', 'رعب', 'أنمي'];
const movieNames = ['The Batman (2022)', 'Dune Part Two (2024)', 'Inception (2010)', 'الفيل الأزرق 2 (2019)', 'كيرة والجن (2022)', 'Oppenheimer (2023)', 'Interstellar (2014)', 'ولاد رزق 3 (2024)', 'Spider-Man: Across the Spider-Verse (2023)', 'Your Name (2016)', 'The Conjuring (2013)', 'Top Gun Maverick (2022)'];
const serCats = ['مسلسلات عربية', 'مسلسلات تركية', 'Netflix', 'رمضان 2025'];
const serNames = ['الحشاشين', 'المؤسس عثمان', 'Breaking Bad', 'Dark', 'La Casa de Papel', 'جعفر العمدة', 'Stranger Things', 'نيوتن'];

const live = []; const vod = []; const series = [];
let id = 1;
liveCats.forEach((c, ci) => {
  for (let i = 0; i < (ci === 7 ? 3 : 14); i++) {
    const name = ci === 7 ? `Adult ${i + 1}` : `${chanNames[(ci * 5 + i) % chanNames.length]}${i > 9 ? ` ${i}` : ''} HD`;
    live.push({ num: id, name, stream_type: 'live', stream_id: id, stream_icon: i % 5 === 4 ? '' : `/img/logo/${id}.svg`, epg_channel_id: `ch${id}`, added: String(now - id * 3600), category_id: String(ci + 1), tv_archive: i % 3 === 0 ? 1 : 0, tv_archive_duration: 3 });
    id++;
  }
});
vodCats.forEach((c, ci) => {
  for (let i = 0; i < 16; i++) {
    const name = `${ci === 1 ? 'EN | ' : ''}${movieNames[(ci * 3 + i) % movieNames.length]}${i >= movieNames.length ? ` ${i}` : ''}`;
    vod.push({ num: id, name, stream_type: 'movie', stream_id: id, stream_icon: i % 7 === 6 ? '' : `/img/poster/${id}.svg`, rating: ((i * 7) % 40) / 5 + 2, added: String(now - (ci * 16 + i) * 7200), category_id: String(ci + 1), container_extension: 'mp4' });
    id++;
  }
});
serCats.forEach((c, ci) => {
  for (let i = 0; i < 8; i++) {
    series.push({ num: id, name: `${serNames[(ci * 2 + i) % serNames.length]}${i >= serNames.length ? ` ${i}` : ''}`, series_id: id, cover: `/img/poster/${id}.svg`, plot: 'قصة تجريبية لمسلسل في خادم المعاينة.', cast: 'ممثل أول، ممثلة ثانية', genre: 'دراما', releaseDate: `20${10 + i}-01-01`, last_modified: String(now - (ci * 8 + i) * 5000), rating: String(6 + (i % 4)), backdrop_path: [`/img/backdrop/${id}.svg`], category_id: String(ci + 1) });
    id++;
  }
});

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
function epg(sid, n = 6, back = 0) {
  const out = [];
  const base = Math.floor(Date.now() / 3600e3) * 3600e3 - back * 3600e3;
  const titles = ['نشرة الأخبار', 'برنامج حواري', 'وثائقي', 'مباراة مباشرة', 'فيلم السهرة', 'تقرير خاص'];
  for (let i = 0; i < n; i++) {
    const s = new Date(base + i * 3600e3);
    out.push({ title: b64(`${titles[(sid + i) % titles.length]}`), description: b64('وصف البرنامج'), start: fmt(s), end: fmt(new Date(s.getTime() + 3600e3)), start_timestamp: String(s.getTime() / 1000), stop_timestamp: String(s.getTime() / 1000 + 3600), has_archive: s.getTime() + 3600e3 < Date.now() ? 1 : 0 });
  }
  return out;
}

function api(q) {
  if (q.get('username') !== 'demo' || q.get('password') !== 'demo') return { user_info: { auth: 0 } };
  switch (q.get('action')) {
    case null: case '':
      return { user_info: { auth: 1, status: 'Active', exp_date: String(now + 45 * 86400), max_connections: '2', active_cons: '0', is_trial: '0', allowed_output_formats: ['m3u8', 'ts'] }, server_info: { timezone: 'Asia/Riyadh' } };
    case 'get_live_categories': return liveCats.map((n, i) => ({ category_id: String(i + 1), category_name: n, parent_id: 0 }));
    case 'get_vod_categories': return vodCats.map((n, i) => ({ category_id: String(i + 1), category_name: n, parent_id: 0 }));
    case 'get_series_categories': return serCats.map((n, i) => ({ category_id: String(i + 1), category_name: n, parent_id: 0 }));
    case 'get_live_streams': return live;
    case 'get_vod_streams': return vod;
    case 'get_series': return series;
    case 'get_vod_info': {
      const v = vod.find((x) => String(x.stream_id) === q.get('vod_id'));
      return { info: { plot: `قصة الفيلم «${v.name}» — نص تجريبي يعرض كيف تظهر القصة والممثلون في صفحة التفاصيل.`, cast: 'ممثل أ، ممثلة ب، ممثل ج', director: 'مخرج تجريبي', genre: 'دراما، إثارة', releasedate: '2022-03-04', duration_secs: '7380', rating: String(v.rating), backdrop_path: [`/img/backdrop/${v.stream_id}.svg`], youtube_trailer: 'dQw4w9WgXcQ' }, movie_data: { stream_id: v.stream_id, container_extension: 'mp4' } };
    }
    case 'get_series_info': {
      const sid = Number(q.get('series_id'));
      const episodes = {};
      for (let s = 1; s <= 3; s++) {
        episodes[s] = Array.from({ length: s === 3 ? 4 : 8 }, (_, e) => ({ id: String(sid * 1000 + s * 100 + e + 1), episode_num: e + 1, title: `الحلقة ${e + 1}`, container_extension: 'mp4', info: { movie_image: `/img/thumb/${sid}-${s}-${e + 1}.svg`, plot: 'ملخص الحلقة.', duration_secs: 2700 }, season: s }));
      }
      return { seasons: [1, 2, 3].map((s) => ({ season_number: s, name: `الموسم ${s}` })), info: { plot: 'قصة المسلسل التجريبي.', cast: 'بطل، بطلة', genre: 'دراما', backdrop_path: [`/img/backdrop/${sid}.svg`] }, episodes };
    }
    case 'get_short_epg': return { epg_listings: epg(Number(q.get('stream_id')), Number(q.get('limit') || 4)) };
    case 'get_simple_data_table': return { epg_listings: epg(Number(q.get('stream_id')), 30, 26) };
    default: return [];
  }
}

const TYPES = { '.m4s': 'video/iso.segment', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.mp4': 'video/mp4', '.vtt': 'text/vtt', '.srt': 'text/plain; charset=utf-8' };

function sendFile(req, res, file) {
  const stat = fs.statSync(file);
  const type = TYPES[path.extname(file)] || 'application/octet-stream';
  const range = req.headers.range && req.headers.range.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = Number(range[1] || 0);
    const end = range[2] ? Number(range[2]) : stat.size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
  fs.createReadStream(file).pipe(res);
}

http.createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (u.pathname === '/player_api.php') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(api(u.searchParams)));
    return;
  }
  if (u.pathname === '/list.m3u') {
    const host = `http://localhost:${PORT}`;
    const lines = ['#EXTM3U'];
    for (const c of live.slice(0, 40)) lines.push(`#EXTINF:-1 tvg-id="ch${c.stream_id}" tvg-logo="${c.stream_icon ? host + c.stream_icon : ''}" group-title="${liveCats[c.category_id - 1]}",${c.name}`, `${host}/live/demo/demo/${c.stream_id}.m3u8`);
    for (const v of vod.slice(0, 30)) lines.push(`#EXTINF:-1 tvg-logo="${v.stream_icon ? host + v.stream_icon : ''}" group-title="${vodCats[v.category_id - 1]}",${v.name}`, `${host}/movie/demo/demo/${v.stream_id}.mp4`);
    for (const s of series.slice(0, 4)) for (let e = 1; e <= 3; e++) lines.push(`#EXTINF:-1 tvg-logo="${host}${s.cover}" group-title="${serCats[s.category_id - 1]}",${s.name} S01E0${e}`, `${host}/series/demo/demo/${s.series_id}0${e}.mp4`);
    res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl; charset=utf-8' });
    res.end(lines.join('\n'));
    return;
  }
  const img = u.pathname.match(/^\/img\/(logo|poster|backdrop|thumb)\/([\w-]+)\.svg$/);
  if (img) {
    const n = parseInt(img[2], 10) || 1;
    const [w, h] = { logo: [200, 200], poster: [300, 450], backdrop: [1280, 720], thumb: [320, 180] }[img[1]];
    const item = [...live, ...vod].find((x) => x.stream_id === n) || series.find((x) => x.series_id === n);
    const label = img[1] === 'thumb' ? `ح ${img[2].split('-').pop()}` : (item ? item.name.replace(/\(.*\)|EN \| /g, '').slice(0, 14) : img[2]);
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    res.end(svg(label, w, h, COLORS[n % COLORS.length]));
    return;
  }
  // البث: /live/u/p/ID.ext · /movie/u/p/ID.ext · /series/u/p/ID.ext · /timeshift/...
  const st = u.pathname.match(/^\/(live|movie|series|timeshift)\/.*\.(m3u8|ts|mp4|mkv)$/);
  if (st && MEDIA) {
    const ext = st[2];
    const name = ext === 'm3u8' ? 'live.m3u8' : ext === 'ts' ? 'live.ts' : 'movie.mp4';
    const f = path.join(MEDIA, name);
    if (fs.existsSync(f)) {
      if (ext === 'm3u8') {
        // روابط المقاطع نسبية لمجلد /media/
        const body = fs.readFileSync(f, 'utf8').replace(/^(?!#)(\S+)$/gm, '/media/$1').replace(/URI="([^"/]+)"/g, 'URI="/media/$1"');
        res.writeHead(200, { 'Content-Type': TYPES['.m3u8'] });
        res.end(body);
        return;
      }
      sendFile(req, res, f);
      return;
    }
  }
  if (u.pathname.startsWith('/media/') && MEDIA) {
    const f = path.join(MEDIA, path.basename(u.pathname));
    if (fs.existsSync(f)) { sendFile(req, res, f); return; }
  }
  let file = path.join(root, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  sendFile(req, res, file);
}).listen(PORT, () => console.log(`LiwaIPTV تجريبي: http://localhost:${PORT}  (المستخدم demo / demo)`));
