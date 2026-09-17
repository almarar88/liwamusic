/**
 * LiwaTube — اختبار ذاتي للوحدات التي لا تحتاج واجهة Electron.
 * يشغَّل بـ: npm test
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const scanner = require(path.join(root, 'electron/lib/scanner.js'));
const recommend = require(path.join(root, 'electron/lib/recommend.js'));
const subtitles = require(path.join(root, 'electron/lib/subtitles.js'));
const lock = require(path.join(root, 'electron/lib/lock.js'));
const filestream = require(path.join(root, 'electron/lib/filestream.js'));
const playlists = require(path.join(root, 'electron/lib/playlists.js'));
const { Store, DEFAULTS } = require(path.join(root, 'electron/lib/store.js'));
const { AI, MODELS, DEFAULT_MODEL, fmtTime } = require(path.join(root, 'electron/lib/ai.js'));

let pass = 0; let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  \u2713 ${label}`); } else { fail++; console.log(`  \u2717 ${label}${extra ? ` — ${extra}` : ''}`); }
};
const section = (t) => console.log(`\n${t}`);

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'liwatube-'));
const lib = path.join(tmp, 'Videos');
await fsp.mkdir(path.join(lib, 'Cooking Channel'), { recursive: true });
await fsp.mkdir(path.join(lib, 'Travel', 'Japan 2024'), { recursive: true });
await fsp.mkdir(path.join(lib, '.hidden'), { recursive: true });
const fake = (p, size = 2048) => fsp.writeFile(p, Buffer.alloc(size, 1));
await fake(path.join(lib, 'Cooking Channel', '01 - Pasta.Carbonara.1080p.x264.mp4'));
await fake(path.join(lib, 'Cooking Channel', 'Bread [tutorial] (2023).mkv'));
await fake(path.join(lib, 'Travel', 'Japan 2024', 'Tokyo_Day_1.webm'));
await fake(path.join(lib, 'Travel', 'Japan 2024', 'Tokyo_Day_1.ar.srt'), 10);
await fake(path.join(lib, 'root video.mov'));
await fake(path.join(lib, 'notes.txt'));
await fake(path.join(lib, '.hidden', 'secret.mp4'));

// ————————————————————————————————— الفهرسة
section('الفهرسة (scanner)');
{
  const files = await scanner.walk(lib);
  ok(files.length === 4, 'يجد ملفات الفيديو فقط ويتخطى المجلدات المخفية', `وجد ${files.length}`);
  ok(scanner.titleFromFilename('01 - Pasta.Carbonara.1080p.x264.mp4') === 'Pasta Carbonara', 'ينظّف العنوان من الترقيم والوسوم التقنية', scanner.titleFromFilename('01 - Pasta.Carbonara.1080p.x264.mp4'));
  ok(scanner.titleFromFilename('Bread [tutorial] (2023).mkv') === 'Bread', 'يزيل الأقواس', scanner.titleFromFilename('Bread [tutorial] (2023).mkv'));
  ok(scanner.yearFromFilename('Bread (2023).mkv') === 2023, 'يستخرج السنة');
  ok(scanner.channelFor(path.join(lib, 'Travel', 'Japan 2024', 'a.mp4'), lib, 'parent') === 'Japan 2024', 'القناة = المجلد الأب');
  ok(scanner.channelFor(path.join(lib, 'Travel', 'Japan 2024', 'a.mp4'), lib, 'root') === 'Videos', 'القناة = الجذر عند اختيار root');
  ok(scanner.channelFor(path.join(lib, 'root video.mov'), lib, 'parent') === 'Videos', 'فيديو في الجذر يأخذ اسم الجذر');
  ok(scanner.channelId('Abc') === scanner.channelId('abc '), 'معرّف القناة لا يتأثر بحالة الأحرف والمسافات');

  const progress = [];
  const r1 = await scanner.scan({ folders: [lib], existing: {}, onProgress: (p) => progress.push(p) });
  ok(Object.keys(r1.videos).length === 4 && r1.stats.added === 4, 'المسح الأول يضيف 4 فيديوهات', JSON.stringify(r1.stats));
  const v = Object.values(r1.videos).find((x) => x.file.startsWith('01 - Pasta'));
  ok(v && v.channel === 'Cooking Channel' && v.ext === 'mp4' && v.native === true && v.probed === false, 'سجل الفيديو مكتمل');
  const mkv = Object.values(r1.videos).find((x) => x.ext === 'mkv');
  ok(mkv && mkv.native === true, 'MKV يُعدّ قابلاً للتشغيل');
  // مسح تزايدي: لا تغيير
  const r2 = await scanner.scan({ folders: [lib], existing: r1.videos });
  ok(r2.stats.added === 0 && r2.stats.updated === 0 && r2.stats.removed === 0, 'المسح التزايدي لا يعيد فهرسة غير المتغيّر', JSON.stringify(r2.stats));
  // تعديل ملف وحذف آخر
  r1.videos[v.id].probed = true; r1.videos[v.id].duration = 42; r1.videos[v.id].thumb = 'x.jpg';
  const r3 = await scanner.scan({ folders: [lib], existing: r1.videos });
  ok(r3.videos[v.id].duration === 42 && r3.videos[v.id].thumb === 'x.jpg', 'يحتفظ بالبيانات المستخرجة للملف غير المتغيّر');
  await fsp.unlink(path.join(lib, 'root video.mov'));
  await fsp.writeFile(path.join(lib, 'Cooking Channel', 'Bread [tutorial] (2023).mkv'), Buffer.alloc(4096, 2));
  const r4 = await scanner.scan({ folders: [lib], existing: r3.videos });
  ok(r4.stats.removed === 1 && r4.stats.updated === 1 && Object.keys(r4.videos).length === 3, 'يكتشف الحذف والتعديل', JSON.stringify(r4.stats));
  const chans = scanner.channelsOf(r4.videos);
  ok(chans.length === 2 && chans[0].name === 'Cooking Channel' && chans[0].count === 2, 'يجمع القنوات مرتّبة بالعدد', JSON.stringify(chans.map((c) => [c.name, c.count])));
}

// ————————————————————————————————— التوصيات
section('التوصيات (recommend)');
{
  const mk = (id, channel, title, extra = {}) => ({ id, channelId: `ch_${channel}`, channel, title, folder: `/v/${channel}`, duration: 600, addedAt: Date.now() - 10 * 86400000, file: `${id}.mp4`, ...extra });
  const videos = {};
  for (let i = 0; i < 12; i++) videos[`a${i}`] = mk(`a${i}`, 'cook', `Cooking ${i}`);
  for (let i = 0; i < 12; i++) videos[`b${i}`] = mk(`b${i}`, 'travel', `Travel ${i}`);
  for (let i = 0; i < 6; i++) videos[`c${i}`] = mk(`c${i}`, 'games', `Game ${i}`);
  videos.n1 = mk('n1', 'news', 'Fresh news', { addedAt: Date.now() - 3600000 });
  const user = {
    history: [{ id: 'a1', at: Date.now() - 1000 }, { id: 'a2', at: Date.now() - 2000 }, { id: 'a3', at: Date.now() - 3000 }],
    likes: { a1: 1, c0: -1 }, subscriptions: { ch_cook: { at: 1 } }, playCount: { a1: 3, a2: 1, a3: 1 },
    lastPlayed: { a1: Date.now() - 1000 }, progress: { b0: { pos: 300, dur: 600, at: Date.now() } }, hidden: { b11: true }, notInterested: { ch_games: true },
    ai: { a5: { tags: ['pasta', 'italian'], category: 'طبخ' }, b5: { tags: ['pasta'], category: 'سفر' } }, overrides: {},
  };
  const feed = recommend.homeFeed(videos, user, { limit: 40, seed: 7 });
  const ids = feed.map((f) => f.id);
  ok(!ids.includes('b11'), 'المخفي لا يظهر');
  ok(!ids.some((id) => id.startsWith('c')), 'قناة «لا يهمّني» مستبعدة');
  ok(ids.indexOf('b0') < 8 && feed.find((f) => f.id === 'b0').reasons.includes('resume'), 'غير المكتمل في المقدمة مع سبب resume', `idx=${ids.indexOf('b0')}`);
  ok(!ids.slice(0, 10).includes('a1'), 'ما شوهد للتو يُدفع للأسفل');
  const first7 = ids.slice(0, 7).map((id) => videos[id].channelId);
  ok(first7.filter((c) => c === 'ch_cook').length === 3 && first7.filter((c) => c === 'ch_travel').length === 3, 'تنويع القنوات: 3 لكل قناة في الدفعة الأولى', first7.join(','));
  ok(ids.slice(7, 10).every((id) => videos[id].channelId === 'ch_cook' || videos[id].channelId === 'ch_travel'), 'الدفعة الثانية تكمل بالقنوات المتبقية');
  ok(feed.find((f) => f.id === 'n1').reasons.includes('recent'), 'الجديد يحمل سبب recent');
  const feed2 = recommend.homeFeed(videos, user, { limit: 40, seed: 7 });
  ok(JSON.stringify(feed2.map((f) => f.id)) === JSON.stringify(ids), 'نفس البذرة → نفس الترتيب');

  const rel = recommend.related(videos.a5, videos, user, { limit: 10 });
  ok(rel.length === 10 && rel[0].id !== 'a5', 'التالي لا يتضمن الفيديو نفسه');
  ok(rel.find((r) => r.id === 'b5') && rel.find((r) => r.id === 'b5').reasons.includes('tags'), 'تطابق الوسوم يظهر في التالي');
  ok(rel.slice(0, 5).every((r) => videos[r.id].channelId === 'ch_cook' || r.id === 'b5'), 'نفس القناة تتقدّم');

  const s = recommend.search('cooking 3', videos, user);
  ok(s.length && s[0].id === 'a3', 'البحث النصي يرتّب بالملاءمة', s.slice(0, 3).map((x) => x.id).join(','));
  ok(recommend.search('pasta', videos, user).map((x) => x.id).sort().join() === 'a5,b5', 'البحث يشمل وسوم الذكاء الاصطناعي');
  ok(recommend.search('', videos, user).length === 0, 'استعلام فارغ → لا نتائج');
  ok(recommend.tokens('Hello, World! مرحبا-بكم 42').join('|') === 'hello|world|مرحبا|بكم', 'ترميز النص يدعم العربية');
}

// ————————————————————————————————— الترجمات
section('الترجمات (subtitles)');
{
  const srt = '\uFEFF1\r\n00:00:01,000 --> 00:00:03,500\r\nمرحبا\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\nسطر أول\r\nسطر ثانٍ\r\n';
  const vtt = subtitles.srtToVtt(srt);
  ok(vtt.startsWith('WEBVTT\n\n'), 'رأس WEBVTT');
  ok(vtt.includes('00:00:01.000 --> 00:00:03.500\nمرحبا'), 'الفاصلة تصبح نقطة');
  ok(vtt.includes('سطر أول\nسطر ثانٍ'), 'يحافظ على الأسطر المتعددة');
  ok(!/^\d+$/m.test(vtt), 'يزيل أرقام المقاطع');
  const side = await subtitles.findSidecars(path.join(lib, 'Travel', 'Japan 2024', 'Tokyo_Day_1.webm'));
  ok(side.length === 1 && side[0].lang === 'ar' && side[0].label === 'AR', 'يجد ملف SRT المجاور مع اللغة', JSON.stringify(side));
  const none = await subtitles.findSidecars(path.join(lib, 'Cooking Channel', 'Bread [tutorial] (2023).mkv'));
  ok(none.length === 0, 'لا ترجمات → قائمة فارغة');
}

// ————————————————————————————————— القفل
section('القفل (lock)');
{
  const rec = lock.hashPin('1234');
  ok(rec.salt.length === 32 && rec.hash.length === 64, 'يخزّن ملحًا ومشتقًا لا الرمز');
  ok(lock.verifyPin('1234', rec) === true, 'الرمز الصحيح يمرّ');
  ok(lock.verifyPin('1235', rec) === false, 'الرمز الخاطئ يُرفض');
  ok(lock.verifyPin('1234', null) === false, 'لا سجل → رفض');
  ok(lock.validPin('0000') && lock.validPin('12345678') && !lock.validPin('123') && !lock.validPin('12ab'), 'التحقق من صيغة الرمز 4–8 أرقام');
}

// ————————————————————————————————— خدمة الملفات
section('خدمة الملفات (filestream)');
{
  ok(filestream.decodePath(filestream.encodePath('C:\\فيديو\\a b.mp4')) === 'C:\\فيديو\\a b.mp4', 'ترميز المسار ذهابًا وإيابًا');
  ok(JSON.stringify(filestream.parseRange('bytes=0-99', 1000)) === '{"start":0,"end":99}', 'Range بداية-نهاية');
  ok(JSON.stringify(filestream.parseRange('bytes=900-', 1000)) === '{"start":900,"end":999}', 'Range مفتوح');
  ok(JSON.stringify(filestream.parseRange('bytes=-100', 1000)) === '{"start":900,"end":999}', 'Range لاحقة');
  ok(filestream.parseRange('bytes=2000-', 1000) === 'invalid', 'Range خارج الحجم');
  ok(filestream.parseRange(null, 1000) === null, 'بلا Range');
  ok(filestream.MIME['.mkv'] === 'video/x-matroska' && filestream.MIME['.vtt'] === 'text/vtt', 'أنواع MIME للفيديو والترجمة');
  const f = path.join(lib, 'Cooking Channel', '01 - Pasta.Carbonara.1080p.x264.mp4');
  const full = await filestream.serveFile(f, null);
  ok(full.status === 200 && full.headers.get('Content-Length') === '2048' && full.headers.get('Content-Type') === 'video/mp4', 'استجابة كاملة');
  const part = await filestream.serveFile(f, 'bytes=100-199');
  ok(part.status === 206 && part.headers.get('Content-Range') === 'bytes 100-199/2048' && (await part.arrayBuffer()).byteLength === 100, 'استجابة جزئية 206');
  const bad = await filestream.serveFile(f, 'bytes=5000-');
  ok(bad.status === 416, 'Range غير صالح → 416');
  const missing = await filestream.serveFile(path.join(lib, 'nope.mp4'), null);
  ok(missing.status === 404, 'ملف مفقود → 404');
}

// ————————————————————————————————— التخزين
section('التخزين (store)');
{
  const dir = path.join(tmp, 'data');
  const st = new Store(dir);
  const s = st.read('settings.json');
  ok(s.lang === 'ar' && s.aiEnabled === false && s.autoplay === true, 'الافتراضيات: عربي، الذكاء مغلق، تشغيل تلقائي');
  s.lang = 'en'; st.write('settings.json');
  await st.flush('settings.json');
  const st2 = new Store(dir);
  ok(st2.read('settings.json').lang === 'en' && st2.read('settings.json').autoplay === true, 'يحفظ ويدمج مع الافتراضيات');
  ok(Array.isArray(st2.read('userdata.json').watchLater) && typeof st2.read('userdata.json').comments === 'object', 'بنية userdata');
  ok(DEFAULTS['playlists.json'].items.length === 0, 'قوائم افتراضية فارغة');
  const p = playlists.create({ name: 'x', videos: ['a', 'a', 'b'] });
  ok(p.id.startsWith('pl_') && p.videos.length === 2, 'إنشاء قائمة بلا تكرار');
}

// ————————————————————————————————— الذكاء الاصطناعي (بلا شبكة)
section('الذكاء الاصطناعي (ai) — أدوات محلية');
{
  ok(MODELS.some((m) => m.id === DEFAULT_MODEL), 'النموذج الافتراضي ضمن القائمة');
  ok(AI.extractJSON('نص قبل ```json\n{"a":[1,2],"b":"x}"}\n``` بعد').b === 'x}', 'استخراج JSON من داخل سياج');
  ok(Array.isArray(AI.extractJSON('[{"i":0},{"i":1}] extra')), 'استخراج مصفوفة');
  ok(AI.extractJSON('لا شيء هنا') === null, 'لا JSON → null');
  ok(fmtTime(3725) === '1:02:05' && fmtTime(65) === '1:05', 'تنسيق الوقت');
  const videos = { a: { id: 'a', title: 'A', channel: 'C', duration: 60, file: 'a.mp4' }, b: { id: 'b', title: 'B', channel: 'C', duration: 120, file: 'b.mp4' } };
  const cat = AI.buildCatalog(videos, { ai: { b: { tags: ['x'], category: 'y', summary: 'z' } }, playCount: { b: 2 }, likes: { b: 1 } }, 10);
  ok(cat.map[0] === 'b' && cat.text.split('\n').length === 2 && cat.text.includes('liked'), 'الفهرس يقدّم المفضل ويحمل الوسوم');
  const blocks = AI.frameBlocks([{ t: 1.5, data: 'AAA' }, { t: 10, data: 'BBB' }]);
  ok(blocks.length === 4 && blocks[1].type === 'image' && blocks[1].source.media_type === 'image/jpeg' && blocks[2].text.includes('0:10'), 'كتل الإطارات صور base64 مع طوابع زمنية');
  const dir = path.join(tmp, 'aidata');
  await fsp.mkdir(dir, { recursive: true });
  const ai = new AI({ dir, safeStorage: { isEncryptionAvailable: () => false } });
  ok(ai.hasKey() === false, 'لا مفتاح افتراضيًا');
  ai.setKey('sk-test');
  ok(ai.hasKey() && ai._readKey() === 'sk-test', 'حفظ المفتاح واسترجاعه (وضع plain عند غياب التشفير)');
  ai.clearKey();
  ok(!ai.hasKey(), 'حذف المفتاح');
  let threw = null;
  try { await ai.ask({ messages: [] }); } catch (e) { threw = e.code; }
  ok(threw === 'NO_API_KEY', 'الاستدعاء بلا مفتاح يرمي NO_API_KEY');
}

// ————————————————————————————————— الواجهة: ملفات موجودة وسليمة
section('الواجهة');
{
  const html = fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8');
  ok(html.includes('Content-Security-Policy') && html.includes("media-src liwa:"), 'CSP يسمح بالفيديو المحلي فقط');
  for (const f of ['util.js', 'thumbs.js', 'player.js', 'views.js', 'app.js']) ok(html.includes(`js/${f}`) && fs.existsSync(path.join(root, 'renderer/js', f)), `يحمّل ${f}`);
  const pre = fs.readFileSync(path.join(root, 'electron/preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
  const channels = [...pre.matchAll(/call\('([a-z]+:[A-Za-z]+)'/g)].map((m) => m[1]);
  const missing = channels.filter((c) => !main.includes(`'${c}'`));
  ok(channels.length > 40 && missing.length === 0, `كل قنوات preload (${channels.length}) لها معالج في main`, missing.join(','));
}

// ————————————————————————————————— الخادم (HTTP API)
section('الخادم (server)');
{
  const { LiwaTubeServer } = require(path.join(root, 'server/server.js'));
  const dataDir = path.join(tmp, 'server-data');
  const srv = new LiwaTubeServer({ dataDir, port: 0, host: '127.0.0.1', log: () => {} });
  await srv.listen();
  const base = `http://127.0.0.1:${srv.port}`;
  let token = '';
  const api = async (method, url, body, { raw = false, headers = {}, dev = 'dev-a' } = {}) => {
    const h = { 'X-Device': dev, ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    let b = body;
    if (body !== undefined && !raw) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    const r = await fetch(`${base}${url}`, { method, headers: h, body: b });
    let data = null; try { data = await r.json(); } catch { /* */ }
    return { status: r.status, data, res: r };
  };
  let r = await api('GET', '/api/site');
  ok(r.status === 200 && r.data.ok && r.data.data.hasAdmin === false && r.data.data.videos === 0, 'معلومات الموقع قبل الإعداد');
  ok((await api('GET', '/api/admin/stats')).status === 401, 'مسارات المشرف مرفوضة بلا دخول');
  ok((await api('POST', '/api/setup', { password: '12' })).status === 400, 'كلمة مرور قصيرة مرفوضة');
  r = await api('POST', '/api/setup', { password: 'secret1' });
  ok(r.status === 200 && r.data.data.token, 'إعداد كلمة مرور المشرف يعيد رمزًا');
  ok((await api('POST', '/api/setup', { password: 'x' })).status === 409, 'لا يمكن إعادة الإعداد');
  ok((await api('POST', '/api/login', { password: 'wrong' })).status === 401, 'كلمة مرور خاطئة');
  r = await api('POST', '/api/login', { password: 'secret1' });
  ok(r.status === 200 && r.data.data.token, 'تسجيل الدخول');
  token = r.data.data.token;
  ok((await api('GET', '/api/me')).data.data.admin === true, 'الرمز يمنح صلاحية المشرف');
  // رفع
  const bytes = Buffer.alloc(150000, 7);
  r = await api('POST', `/api/admin/upload?name=${encodeURIComponent('My.Great.Video.1080p.mp4')}&channel=${encodeURIComponent('قناتي')}`, bytes, { raw: true, headers: { 'Content-Type': 'application/octet-stream' } });
  ok(r.status === 200 && r.data.data.title === 'My Great Video' && r.data.data.channel === 'قناتي' && r.data.data.size === 150000, 'رفع مقطع وتسمية تلقائية', JSON.stringify(r.data));
  const vid = r.data.data.id;
  ok((await api('POST', '/api/admin/upload?name=x.exe', bytes, { raw: true })).status === 415, 'رفض الصيغ غير المدعومة');
  ok((await api('POST', '/api/admin/upload?name=y.mp4', Buffer.alloc(0), { raw: true })).status === 400, 'رفض الملف الفارغ');
  // البث مع Range
  let s = await fetch(`${base}/api/video/${vid}`, { headers: { Range: 'bytes=100-199' } });
  ok(s.status === 206 && s.headers.get('content-range') === 'bytes 100-199/150000' && (await s.arrayBuffer()).byteLength === 100, 'بث الفيديو بـ Range');
  s = await fetch(`${base}/api/video/${vid}`, { method: 'HEAD' });
  ok(s.status === 200 && s.headers.get('content-length') === '150000' && s.headers.get('accept-ranges') === 'bytes', 'HEAD يعيد الحجم');
  // صورة مصغّرة وترجمة وتعديل
  r = await api('POST', `/api/admin/thumb/${vid}?at=3.5`, PNG_1PX_JPEG(), { raw: true, headers: { 'Content-Type': 'image/jpeg' } });
  ok(r.status === 200 && String(r.data.data).startsWith(`${vid}.jpg?v=`), 'رفع الصورة المصغّرة');
  s = await fetch(`${base}/api/thumb/${vid}.jpg`);
  ok(s.status === 200 && s.headers.get('content-type') === 'image/jpeg', 'تقديم الصورة المصغّرة');
  r = await api('POST', `/api/admin/sub/${vid}?lang=ar`, '1\n00:00:01,000 --> 00:00:02,000\nمرحبا\n', { raw: true, headers: { 'Content-Type': 'text/plain' } });
  ok(r.status === 200 && r.data.data.subs.length === 1 && r.data.data.subs[0].lang === 'ar', 'رفع ترجمة SRT');
  s = await fetch(`${base}/api/sub/${vid}/0`);
  ok(s.status === 200 && (await s.text()).startsWith('WEBVTT'), 'الترجمة تُقدَّم كـ VTT');
  r = await api('PATCH', `/api/admin/video/${vid}`, { title: 'عنوان جديد', tags: ['a', 'b'], duration: 42.5, probed: true, hidden: true });
  ok(r.status === 200 && r.data.data.title === 'عنوان جديد' && r.data.data.duration === 42.5 && r.data.data.hidden === true, 'تعديل البيانات');
  const saved = token; token = '';
  r = await api('GET', '/api/library');
  ok(Object.keys(r.data.data.videos).length === 0, 'المخفي لا يظهر للزوار');
  ok((await fetch(`${base}/api/video/${vid}`)).status === 404, 'بث المخفي مرفوض للزوار');
  token = saved;
  ok(Object.keys((await api('GET', '/api/library?all=1')).data.data.videos).length === 1, 'المشرف يرى المخفي');
  await api('PATCH', `/api/admin/video/${vid}`, { hidden: false });
  token = '';
  r = await api('GET', '/api/library');
  const pub = r.data.data.videos[vid];
  ok(pub && pub.path === undefined && pub.thumb && pub.folder === 'قناتي' && r.data.data.channels[0].name === 'قناتي', 'المكتبة العامة بلا مسارات ومع القنوات');
  // مشاهدات وإعجابات وتعليقات
  await api('POST', `/api/view/${vid}`); await api('POST', `/api/view/${vid}`);
  await api('POST', `/api/view/${vid}`, undefined, { dev: 'dev-b' });
  r = await api('GET', '/api/library');
  ok(r.data.data.videos[vid].views === 2, 'المشاهدات تُعدّ مرة لكل جهاز خلال 30 دقيقة', String(r.data.data.videos[vid].views));
  r = await api('POST', `/api/like/${vid}`, { val: 1 });
  await api('POST', `/api/like/${vid}`, { val: -1 }, { dev: 'dev-b' });
  r = await api('POST', `/api/like/${vid}`, { val: 1 });
  ok(r.data.data.likes === 1 && r.data.data.dislikes === 1 && r.data.data.mine === 1, 'الإعجابات لكل جهاز');
  r = await api('POST', `/api/comments/${vid}`, { name: 'زائر', text: 'رائع' });
  ok(r.status === 200 && r.data.data.length === 1 && r.data.data[0].mine === true, 'إضافة تعليق');
  const cid = r.data.data[0].id;
  ok((await api('DELETE', `/api/comments/${vid}/${cid}`, undefined, { dev: 'dev-b' })).status === 403, 'لا يحذف تعليق غيره');
  ok((await api('DELETE', `/api/comments/${vid}/${cid}`)).data.data.length === 0, 'يحذف تعليقه');
  ok((await api('POST', `/api/ai/search`, { query: 'x' })).status === 403, 'الذكاء مغلق افتراضيًا');
  // الإعدادات
  token = saved;
  r = await api('POST', '/api/admin/settings', { siteName: 'قناة ليوا', allowComments: false, aiEnabled: true });
  ok(r.status === 200 && r.data.data.siteName === 'قناة ليوا' && r.data.data.aiKeySet === false, 'حفظ إعدادات الموقع');
  token = '';
  ok((await api('POST', `/api/comments/${vid}`, { name: 'x', text: 'y' })).status === 403, 'تعطيل التعليقات للزوار');
  ok((await api('GET', '/api/site')).data.data.name === 'قناة ليوا' && (await api('GET', '/api/site')).data.data.aiEnabled === false, 'الذكاء لا يُعلن مفعّلًا بلا مفتاح');
  token = saved;
  ok((await api('POST', '/api/admin/settings', { currentPassword: 'nope', newPassword: 'abcd' })).status === 401, 'تغيير كلمة المرور يتطلب الحالية');
  r = await api('POST', '/api/admin/settings', { currentPassword: 'secret1', newPassword: 'abcd1234' });
  ok(r.status === 200 && (await api('GET', '/api/me')).data.data.admin === false, 'تغيير كلمة المرور يبطل الرموز القديمة');
  token = (await api('POST', '/api/login', { password: 'abcd1234' })).data.data.token;
  // الملفات الثابتة
  s = await fetch(`${base}/`);
  const html = await s.text();
  ok(s.status === 200 && html.includes('js/bridge.js') && html.includes('id="connect"'), 'الواجهة تُقدَّم من الجذر');
  ok((await fetch(`${base}/js/recommend.js`)).status === 200 && (await fetch(`${base}/js/views.js`)).status === 200 && (await fetch(`${base}/css/web.css`)).status === 200, 'ملفات JS/CSS');
  ok((await fetch(`${base}/js/../server/server.js`)).status === 404 && (await fetch(`${base}/api/../package.json`)).status === 404, 'لا تسريب لملفات خارج الواجهة');
  ok((await fetch(`${base}/watch/abc`)).status === 200, 'المسارات غير المعروفة تعيد الواجهة (SPA)');
  // حذف
  r = await api('DELETE', `/api/admin/video/${vid}`);
  ok(r.status === 200 && !fs.existsSync(path.join(dataDir, 'videos', `${vid}.mp4`)) && !fs.existsSync(path.join(dataDir, 'thumbs', `${vid}.jpg`)), 'الحذف يزيل الملفات');
  await srv.close();
  const srv2 = new LiwaTubeServer({ dataDir, port: 0, host: '127.0.0.1', log: () => {} });
  ok(srv2.db.data.admin && srv2.db.data.settings.siteName === 'قناة ليوا' && Object.keys(srv2.db.data.videos).length === 0, 'قاعدة البيانات تُحفظ على القرص');
}
// ————————————————————————————————— المكتبة الخارجية (مشاركة مكتبة سطح المكتب) + المشاركة
section('الخادم فوق مكتبة سطح المكتب (external) والمشاركة (share)');
{
  const { LiwaTubeServer } = require(path.join(root, 'server/server.js'));
  const shareLib = require(path.join(root, 'electron/lib/share.js'));
  ok(shareLib.parseTunnelUrl('2026 INF |  https://abc-def-123.trycloudflare.com   |') === 'https://abc-def-123.trycloudflare.com', 'استخراج رابط النفق');
  ok(shareLib.parseTunnelUrl('no url here') === null, 'لا رابط → null');
  ok(Array.isArray(shareLib.lanAddresses()), 'عناوين الشبكة المحلية قائمة');
  const extDir = path.join(tmp, 'ext'); await fsp.mkdir(extDir, { recursive: true });
  const vidFile = path.join(extDir, 'My Clip.mp4'); await fsp.writeFile(vidFile, Buffer.alloc(5000, 3));
  await fsp.writeFile(path.join(extDir, 'My Clip.ar.srt'), '1\n00:00:01,000 --> 00:00:02,000\nأهلا\n');
  const thumb = path.join(extDir, 'thumb.jpg'); await fsp.writeFile(thumb, PNG_1PX_JPEG());
  const updates = [];
  const ext = {
    videos: () => ({ ext1: { id: 'ext1', path: vidFile, ext: 'mp4', size: 5000, title: 'مقطعي', channel: 'مكتبتي', channelId: 'ch_x', duration: 12, width: 320, height: 180, thumbPath: thumb, thumbAt: 3, addedAt: 1 } }),
    update: async (id, patch) => updates.push([id, patch]),
    subtitlesFor: async () => require(path.join(root, 'electron/lib/subtitles.js')).findSidecars(vidFile),
  };
  const srv = new LiwaTubeServer({ dataDir: path.join(tmp, 'share-data'), port: 0, host: '127.0.0.1', log: () => {}, external: ext, adminPassword: 'pw1234' });
  await srv.listen();
  const base = `http://127.0.0.1:${srv.port}`;
  const tok = (await (await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'pw1234' }) })).json()).data.token;
  const lib = (await (await fetch(`${base}/api/library`)).json()).data;
  ok(lib.videos.ext1 && lib.videos.ext1.title === 'مقطعي' && lib.videos.ext1.path === undefined && lib.videos.ext1.thumb && lib.channels[0].name === 'مكتبتي', 'مكتبة سطح المكتب تظهر للمشاهدين بلا مسارات');
  let r = await fetch(`${base}/api/video/ext1`, { headers: { Range: 'bytes=0-9' } });
  ok(r.status === 206 && (await r.arrayBuffer()).byteLength === 10, 'بث ملف المكتبة المحلية بـ Range');
  ok((await fetch(`${base}/api/thumb/ext1.jpg`)).status === 200, 'الصورة المصغّرة من كاش سطح المكتب');
  const subs = (await (await fetch(`${base}/api/subs/ext1`)).json()).data;
  ok(subs.length === 1 && subs[0].lang === 'ar', 'الترجمات المجاورة تُدرج');
  ok((await (await fetch(`${base}/api/sub/ext1/0`)).text()).startsWith('WEBVTT'), 'الترجمة المجاورة تُحوَّل إلى VTT');
  await fetch(`${base}/api/view/ext1`, { method: 'POST', headers: { 'X-Device': 'd1' } });
  ok((await (await fetch(`${base}/api/library`)).json()).data.videos.ext1.views === 1, 'مشاهدات المقاطع الخارجية تُحفظ');
  r = await fetch(`${base}/api/admin/video/ext1`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify({ title: 'جديد', hidden: true }) });
  ok(r.status === 200 && updates.length === 1 && updates[0][1].title === 'جديد', 'تعديل العنوان يمرّ إلى سطح المكتب');
  ok(Object.keys((await (await fetch(`${base}/api/library`)).json()).data.videos).length === 0, 'الإخفاء يمنع ظهوره للزوار');
  r = await fetch(`${base}/api/admin/thumb/ext1`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: PNG_1PX_JPEG() });
  ok(r.status === 409, 'لا رفع صورة لمقطع خارجي');
  ok((await (await fetch(`${base}/api/admin/stats`, { headers: { Authorization: `Bearer ${tok}` } })).json()).data.videos === 1, 'الإحصاءات تشمل المكتبة الخارجية');
  await srv.close();
  // مدير المشاركة
  const share = new shareLib.Share({ dataDir: path.join(tmp, 'share-mgr'), createServer: (o) => new LiwaTubeServer({ ...o, dataDir: path.join(tmp, 'share-mgr', 'share'), external: ext }) });
  const st0 = share.status();
  ok(st0.running === false && st0.tunnel.running === false, 'حالة المشاركة الابتدائية');
  const st1 = await share.start({ port: 0, password: 'abcd' });
  ok(st1.running && st1.port > 0 && st1.lan.every((u) => u.endsWith(`:${st1.port}`)), 'تشغيل خادم المشاركة على منفذ');
  ok((await (await fetch(`http://127.0.0.1:${st1.port}/api/site`)).json()).data.hasAdmin === true, 'كلمة مرور المشرف مضبوطة في الخادم المضمَّن');
  const qr = await share.qr(`http://127.0.0.1:${st1.port}`);
  ok(qr.startsWith('data:image/png;base64,'), 'توليد QR');
  const st2 = await share.stop();
  ok(st2.running === false, 'إيقاف المشاركة');
}
// ————————————————————————————————— بقاء الجلسة عبر إعادة التشغيل (استضافة بلا قرص دائم)
section('جلسة المشرف عبر إعادة التشغيل');
{
  const { LiwaTubeServer } = require(path.join(root, 'server/server.js'));
  const PW = 'pw-env-123';
  const call = async (srv, method, url, body, tok) => {
    const h = { 'X-Device': 'dev' };
    if (tok) h.Authorization = `Bearer ${tok}`;
    let b = body;
    if (body !== undefined && !(body instanceof Uint8Array)) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    const r = await fetch(`http://127.0.0.1:${srv.port}${url}`, { method, headers: h, body: b });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  const dirA = path.join(tmp, 'sess-a');
  const dirB = path.join(tmp, 'sess-b');
  let srv = new LiwaTubeServer({ dataDir: dirA, port: 0, host: '127.0.0.1', log: () => {}, adminPassword: PW });
  await srv.listen();
  const tok = (await call(srv, 'POST', '/api/login', { password: PW })).data.data.token;
  ok(Boolean(tok), 'تسجيل الدخول بكلمة مرور البيئة');
  ok((await call(srv, 'POST', '/api/admin/upload?name=a.mp4&channel=c', new Uint8Array(500), tok)).status === 200, 'الرفع يعمل بعد الدخول');
  ok((await call(srv, 'POST', '/api/admin/settings', { currentPassword: PW, newPassword: 'other1' }, tok)).status === 409, 'تغيير كلمة المرور مرفوض عندما تأتي من البيئة');
  await srv.close();
  // إعادة تشغيل بمجلد بيانات جديد تمامًا = القرص غير دائم
  srv = new LiwaTubeServer({ dataDir: dirB, port: 0, host: '127.0.0.1', log: () => {}, adminPassword: PW });
  await srv.listen();
  ok((await call(srv, 'GET', '/api/me', undefined, tok)).data.data.admin === true, 'الرمز يبقى صالحًا بعد إعادة التشغيل');
  ok((await call(srv, 'POST', '/api/admin/upload?name=b.mp4&channel=c', new Uint8Array(500), tok)).status === 200, 'الرفع يعمل بعد إعادة التشغيل');
  ok((await call(srv, 'POST', '/api/admin/upload?name=c.mp4', new Uint8Array(500), `${tok}x`)).status === 401, 'رمز مزوّر مرفوض');
  await srv.close();
  // كلمة مرور مختلفة في البيئة تُبطل الرموز القديمة
  srv = new LiwaTubeServer({ dataDir: dirB, port: 0, host: '127.0.0.1', log: () => {}, adminPassword: 'changed-99' });
  await srv.listen();
  ok((await call(srv, 'GET', '/api/me', undefined, tok)).data.data.admin === false, 'تغيير كلمة مرور البيئة يُبطل الرموز');
  ok((await call(srv, 'POST', '/api/login', { password: 'changed-99' })).status === 200, 'الدخول بكلمة مرور البيئة الجديدة');
  ok((await call(srv, 'POST', '/api/login', { password: PW })).status === 401, 'الدخول بالقديمة مرفوض');
  await srv.close();
}
// ————————————————————————————————— التخزين الدائم على R2
section('التخزين الدائم (R2)');
{
  const { LiwaTubeServer } = require(path.join(root, 'server/server.js'));
  const { R2 } = require(path.join(root, 'server/r2.js'));
  const { createMockS3 } = await import(new URL('./mock-s3.mjs', import.meta.url).href);
  const mock = createMockS3();
  const endpoint = await mock.listen();
  const env = { R2_ENDPOINT: endpoint, R2_BUCKET: 'liwatube', R2_ACCESS_KEY_ID: 'key', R2_SECRET_ACCESS_KEY: 'secret' };

  const r2 = new R2(env);
  ok(r2.configured && r2.missing().length === 0, 'الإعداد مكتمل يُعدّ مضبوطًا');
  ok(await r2.selfTest(), 'فحص الكتابة والقراءة والحذف');
  const signed = await r2.presign('videos/x.mp4', { method: 'GET', expires: 900 });
  ok(signed.includes('X-Amz-Signature=') && signed.includes('X-Amz-Expires=900'), 'رابط موقّع للقراءة');
  ok(await r2.ensureCors(['*']) && String(mock.cors).includes('<AllowedMethod>PUT</AllowedMethod>'), 'ضبط CORS على الحاوية');

  const call = async (srv, method, url, body, tok) => {
    const h = { 'X-Device': 'dev' };
    if (tok) h.Authorization = `Bearer ${tok}`;
    let b = body;
    if (body !== undefined && !(body instanceof Uint8Array)) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    const res = await fetch(`http://127.0.0.1:${srv.port}${url}`, { method, headers: h, body: b, redirect: 'manual' });
    let data = null; try { data = await res.clone().json(); } catch { /* ليس JSON */ }
    return { status: res.status, data, location: res.headers.get('location') };
  };

  const dataDir = path.join(tmp, 'r2-a');
  let srv = new LiwaTubeServer({ dataDir, port: 0, host: '127.0.0.1', log: () => {}, adminPassword: 'pw1234', storage: new R2(env) });
  await srv.listen();
  ok(srv.remote !== null, 'الخادم يستخدم R2');
  ok((await call(srv, 'GET', '/api/site')).data.data.storage === 'r2', 'معلومات الموقع تعلن التخزين r2');
  const tok = (await call(srv, 'POST', '/api/login', { password: 'pw1234' })).data.data.token;

  // رفع مباشر من المتصفح إلى R2
  const init = await call(srv, 'POST', '/api/admin/upload/init', { name: 'My Trip.2024.mp4', channel: 'رحلاتي', size: 1234 }, tok);
  ok(init.status === 200 && init.data.data.url.includes('X-Amz-Signature='), 'الخادم يوقّع رابط رفع مباشر');
  const putUrl = init.data.data.url; const vid = init.data.data.id;
  ok((await call(srv, 'POST', '/api/admin/upload/finish', { id: vid }, tok)).status === 409, 'لا يُسجَّل المقطع قبل اكتمال الرفع');
  const put = await fetch(putUrl, { method: 'PUT', body: Buffer.alloc(4096, 9), headers: { 'Content-Type': 'video/mp4' } });
  ok(put.ok, 'المتصفح يرفع إلى R2 مباشرة بالرابط الموقّع');
  const fin = await call(srv, 'POST', '/api/admin/upload/finish', { id: vid }, tok);
  ok(fin.status === 200 && fin.data.data.title === 'My Trip 2024' && fin.data.data.year === 2024 && fin.data.data.size === 4096, 'تسجيل المقطع بعد الرفع', JSON.stringify(fin.data));
  ok(mock.objects.has(`videos/${vid}.mp4`), 'الملف موجود في التخزين');

  // الصورة المصغّرة والترجمة في R2
  ok((await call(srv, 'POST', `/api/admin/thumb/${vid}?at=2`, PNG_1PX_JPEG(), tok)).status === 200 && mock.objects.has(`thumbs/${vid}.jpg`), 'الصورة المصغّرة في R2');
  ok((await call(srv, 'POST', `/api/admin/sub/${vid}?lang=ar`, Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nمرحبا\n'), tok)).status === 200 && mock.objects.has(`subs/${vid}.0.vtt`), 'الترجمة في R2');

  // المشاهدة: إعادة توجيه إلى رابط موقّع من R2 لا مرور بالخادم
  const play = await call(srv, 'GET', `/api/video/${vid}`);
  ok(play.status === 302 && play.location.includes('X-Amz-Signature='), 'تشغيل المقطع عبر رابط R2 موقّع');
  const direct = await fetch(play.location);
  ok(direct.ok && (await direct.arrayBuffer()).byteLength === 4096, 'المشاهد يجلب الملف من R2 مباشرة');
  ok((await call(srv, 'GET', `/api/thumb/${vid}.jpg`)).status === 302, 'الصورة المصغّرة عبر R2');
  await srv.close();

  // ★ الاختبار الأهم: خادم جديد بمجلد بيانات فارغ — المقاطع يجب أن تبقى
  srv = new LiwaTubeServer({ dataDir: path.join(tmp, 'r2-b'), port: 0, host: '127.0.0.1', log: () => {}, adminPassword: 'pw1234', storage: new R2(env) });
  await srv.listen();
  const after = (await call(srv, 'GET', '/api/library')).data.data;
  ok(Object.keys(after.videos).length === 1 && after.videos[vid].title === 'My Trip 2024', 'المقاطع باقية بعد إعادة نشر الخادم بقرص فارغ');
  ok((await call(srv, 'GET', `/api/video/${vid}`)).status === 302, 'ولا تزال قابلة للتشغيل');
  ok(after.channels[0].name === 'رحلاتي', 'القنوات والبيانات الوصفية باقية');

  // الحذف يمسح من R2 فعليًا
  const tok2 = (await call(srv, 'POST', '/api/login', { password: 'pw1234' })).data.data.token;
  ok((await call(srv, 'DELETE', `/api/admin/video/${vid}`, undefined, tok2)).status === 200, 'حذف المقطع');
  ok(!mock.objects.has(`videos/${vid}.mp4`) && !mock.objects.has(`thumbs/${vid}.jpg`), 'الحذف يزيل الملفات من R2');
  await srv.close();

  // تعذّر الوصول إلى R2 → يعود إلى التخزين المحلي بدل أن يتعطّل
  await mock.close();
  const fallback = new LiwaTubeServer({ dataDir: path.join(tmp, 'r2-c'), port: 0, host: '127.0.0.1', log: () => {}, storage: new R2(env) });
  await fallback.listen();
  ok(fallback.remote === null, 'عند فشل R2 يعمل الخادم محليًا بدل التوقف');
  await fallback.close();
}
function PNG_1PX_JPEG() { return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(200, 1), Buffer.from([0xff, 0xd9])]); }

await fsp.rm(tmp, { recursive: true, force: true });
console.log(`\n${pass} نجح، ${fail} فشل`);
process.exit(fail ? 1 : 0);
