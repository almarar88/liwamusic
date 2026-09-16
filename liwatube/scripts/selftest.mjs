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

await fsp.rm(tmp, { recursive: true, force: true });
console.log(`\n${pass} نجح، ${fail} فشل`);
process.exit(fail ? 1 : 0);
