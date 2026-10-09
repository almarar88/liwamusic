/**
 * LiwaIPTV — اختبار ذاتي للمنطق الخالص (بلا متصفح ولا خادم).
 * يشغَّل بـ: node scripts/selftest.mjs
 */
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);

const { norm, matches, parseTitle, parseEpisode, isAdult, fmtTime, b64, urlExt } = await load('www/js/util.js');
const { parseM3U, classify, buildLibrary, xtreamFromM3UUrl } = await load('www/js/m3u.js');
const { normServer, streamUrl, catchupUrl, liveExt } = await load('www/js/xtream.js');
const { normMac, endpoints } = await load('www/js/stalker.js');
const { xmltvTime, parseXMLTV, lookup, nowNext, progress } = await load('www/js/epg.js');
const { parseCues, parseASS, toVTT, decodeSubtitle } = await load('www/js/subs.js');
const { sortItems, filterItems, updateHistory, continueWatching, makePlaylist, countByCat } = await load('www/js/library.js');
const { pickEngine } = await load('www/js/engine.js');

let pass = 0; let fail = 0;
const ok = (cond, label) => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); }
};
const eq = (a, b, label) => ok(JSON.stringify(a) === JSON.stringify(b), `${label} — ${JSON.stringify(a)}`);
const section = (t) => console.log(`\n${t}`);

section('1) البحث العربي');
eq(norm('أفلامٌ إسلاميّة'), 'افلام اسلاميه', 'توحيد الألف والتاء المربوطة وحذف التشكيل');
ok(matches(norm('قناة الجزيرة الإخبارية HD'), norm('الجزيره اخبار')), 'مطابقة كلمات بأي ترتيب وبلا همزات');
ok(!matches(norm('MBC 1'), norm('mbc 2')), 'عدم مطابقة رقم مختلف');

section('2) تنظيف العناوين');
eq(parseTitle('AR | The Batman (2022) [4K]'), { title: 'The Batman', year: 2022, quality: '4K' }, 'بادئة + سنة + جودة');
eq(parseTitle('1917').title, '1917', 'سنة هي العنوان كله تبقى');
eq(parseTitle('|EN| Dune Part Two 2024 1080p').title, 'Dune Part Two', 'صيغة |EN| ودقة');
eq(parseEpisode('Breaking Bad S02E05 Phoenix'), { series: 'Breaking Bad', season: 2, episode: 5, title: 'Phoenix' }, 'S02E05');
eq(parseEpisode('المؤسس عثمان الموسم 3 الحلقة 12'), { series: 'المؤسس عثمان', season: 3, episode: 12, title: '' }, 'الموسم/الحلقة بالعربية');
eq(parseEpisode('Dark 1x04'), { series: 'Dark', season: 1, episode: 4, title: '' }, 'صيغة 1x04');
eq(parseEpisode('الحفرة الحلقة 7').season, 1, 'حلقة بلا موسم → الموسم 1');
ok(parseEpisode('beIN Sports 1 HD') === null, 'اسم قناة ليس حلقة');
ok(isAdult('XXX | Adult') && isAdult('للكبار فقط') && !isAdult('Kids'), 'كشف أقسام الكبار');
eq(fmtTime(3725), '1:02:05', 'تنسيق الوقت');
eq(b64('2KfZhNij2K7YqNin2LE='), 'الأخبار', 'فك base64 بـ UTF-8 (دليل Xtream)');
eq(urlExt('http://a/b/c.m3u8?token=1'), 'm3u8', 'امتداد الرابط بلا الاستعلام');

section('3) قوائم M3U');
const M3U = fs.readFileSync(path.join(here, 'fixtures/sample.m3u'), 'utf8');
const parsed = parseM3U(M3U);
eq(parsed.header['url-tvg'], 'http://epg.example/guide.xml', 'رابط الدليل من الرأس');
eq(parsed.entries.length, 9, 'عدد الإدخالات');
const jaz = parsed.entries[0];
eq(jaz.attrs['tvg-logo'], 'http://logo.example/jazeera.png', 'شعار القناة');
eq(jaz.name, 'Al Jazeera, Arabic', 'اسم يحوي فاصلة داخل الاقتباس');
const ua = parsed.entries.find((e) => e.opts.ua);
ok(ua && ua.opts.ua === 'LiwaTest/1.0' && ua.opts.referer === 'http://ref.example/', 'EXTVLCOPT: User-Agent و Referer');
const piped = parsed.entries.find((e) => e.url.includes('piped'));
ok(piped && piped.opts.ua === 'KodiUA' && !piped.url.includes('|'), 'خيارات بعد | في الرابط');
eq(classify({ url: 'http://x/movie/u/p/1.mkv', attrs: {}, name: 'x' }), 'movie', 'مسار /movie/ = فيلم');
eq(classify({ url: 'http://x/series/u/p/1.mp4', attrs: {}, name: 'x' }), 'episode', 'مسار /series/ = حلقة');
eq(classify({ url: 'http://x/live/u/p/1.ts', attrs: {}, name: 'x' }), 'live', 'مسار /live/ = قناة');
const lib = buildLibrary(M3U);
const kinds = lib.items.reduce((m, i) => ((m[i.kind] = (m[i.kind] || 0) + 1), m), {});
eq(kinds, { live: 4, movie: 2, series: 1 }, 'التصنيف: 4 قنوات، فيلمان، مسلسل واحد');
const ser = lib.items.find((i) => i.kind === 'series');
eq([ser.name, Object.keys(ser.seasons), ser.seasons[1].map((e) => e.episode)], ['Dark', ['1', '2'], [1, 2]], 'تجميع الحلقات في مواسم ومرتبة');
const mov = lib.items.find((i) => i.kind === 'movie' && i.year);
eq([mov.title, mov.year], ['Inception', 2010], 'عنوان الفيلم وسنته');
const live1 = lib.items.find((i) => i.kind === 'live' && i.catchup);
ok(live1 && live1.catchup.days === 3, 'أيام الأرشيف (catchup-days)');
eq(lib.cats.live.map((c) => c.name), ['أخبار', 'رياضة'], 'أقسام القنوات من group-title');
eq(xtreamFromM3UUrl('http://srv.example:8080/get.php?username=u1&password=p1&type=m3u_plus'),
  { server: 'http://srv.example:8080', username: 'u1', password: 'p1' }, 'رابط get.php يتحول إلى Xtream');

section('4) Xtream');
eq(normServer('srv.example:8080/player_api.php?x=1'), 'http://srv.example:8080', 'توحيد عنوان الخادم');
eq(normServer('https://a.b/'), 'https://a.b', 'حذف الشرطة الأخيرة');
const pl = { server: 'http://s:80', username: 'u', password: 'p@1' };
eq(streamUrl(pl, { kind: 'live', sid: 5 }, { formats: ['ts'] }), 'http://s:80/live/u/p%401/5.ts', 'رابط قناة (ts فقط مسموح)');
eq(streamUrl(pl, { kind: 'live', sid: 5 }, { formats: ['m3u8', 'ts'] }), 'http://s:80/live/u/p%401/5.m3u8', 'رابط قناة (m3u8 مفضّل)');
eq(streamUrl(pl, { kind: 'movie', sid: 9, ext: 'mkv' }), 'http://s:80/movie/u/p%401/9.mkv', 'رابط فيلم بامتداده');
eq(streamUrl(pl, { kind: 'episode', sid: 77, ext: 'mp4' }), 'http://s:80/series/u/p%401/77.mp4', 'رابط حلقة');
eq(liveExt({ liveFormat: 'ts' }, { formats: ['m3u8'] }), 'ts', 'تفضيل المستخدم يغلب');
eq(catchupUrl(pl, { sid: 5 }, '2024-01-15 20:00:00', 60), 'http://s:80/timeshift/u/p%401/60/2024-01-15:20-00/5.ts', 'رابط الأرشيف');

section('5) Stalker');
eq(normMac('00-1a-79-ab-cd-ef'), '00:1A:79:AB:CD:EF', 'توحيد MAC');
eq(normMac('123'), '', 'رفض MAC ناقص');
const ep = endpoints('portal.example:8080/c/');
eq(ep.list[0], 'http://portal.example:8080/portal.php', 'مسار portal.php');
ok(ep.list.includes('http://portal.example:8080/server/load.php'), 'مسار load.php احتياطي');

section('6) دليل البرامج XMLTV');
eq(new Date(xmltvTime('20240115200000 +0300')).toISOString(), '2024-01-15T17:00:00.000Z', 'تحويل المنطقة الزمنية');
const NOW = Date.UTC(2024, 0, 15, 17, 30);
const XML = `<tv><channel id="AlJazeera.qa"><display-name>Al Jazeera</display-name></channel>
<programme start="20240115200000 +0300" stop="20240115210000 +0300" channel="AlJazeera.qa"><title lang="ar">الحصاد &amp; الأخبار</title><desc>ملخص</desc></programme>
<programme start="20240115210000 +0300" stop="20240115220000 +0300" channel="AlJazeera.qa"><title><![CDATA[ما وراء الخبر]]></title></programme>
<programme start="20240115200000 +0000" stop="20240115210000 +0000" channel="Other"><title>x</title></programme></tv>`;
const epg = parseXMLTV(XML, { now: NOW, wanted: new Set(['aljazeera.qa']) });
const progs = lookup(epg, { epgId: 'AlJazeera.qa', name: 'x' });
eq(progs.map((p) => p.title), ['الحصاد & الأخبار', 'ما وراء الخبر'], 'برامج القناة مع فك الكيانات و CDATA');
ok(!epg.programmes.has('other'), 'تجاهل القنوات غير المطلوبة');
eq(lookup(epg, { epgId: '', name: 'Al Jazeera' }).length, 2, 'مطابقة بالاسم المعروض');
const nn = nowNext(progs, NOW);
eq([nn.now.title, nn.next.title], ['الحصاد & الأخبار', 'ما وراء الخبر'], 'الحالي والتالي');
eq(progress(nn.now, NOW), 0.5, 'نسبة التقدم');

section('7) الترجمة');
const SRT = '1\r\n00:00:01,500 --> 00:00:03,000\r\nمرحبا\r\n\r\n2\r\n00:01:00,000 --> 00:01:02,250\r\nسطر\r\nثانٍ\r\n';
const cues = parseCues(SRT);
eq(cues.map((c) => [c.start, c.end]), [[1.5, 3], [60, 62.25]], 'توقيتات SRT');
eq(cues[1].text, 'سطر\nثانٍ', 'نص متعدد الأسطر');
const vtt = toVTT(cues, 0.5);
ok(vtt.startsWith('WEBVTT') && vtt.includes('00:00:02.000 --> 00:00:03.500'), 'تحويل إلى VTT مع إزاحة +0.5ث');
const ass = parseASS('[Script Info]\nDialogue: 0,0:00:05.10,0:00:07.00,Default,,0,0,0,,{\\i1}Hello\\Nworld');
eq(ass[0], { start: 5.1, end: 7, text: 'Hello\nworld' }, 'ASS: حذف الأنماط وتحويل \\N');
const cp1256 = new Uint8Array([0xE3, 0xD1, 0xCD, 0xC8, 0xC7]); // "مرحبا" بترميز ويندوز العربي
eq(decodeSubtitle(cp1256), 'مرحبا', 'فك ترجمة بترميز Windows-1256');

section('8) الفرز والتصفية والسجل');
const items = [
  { id: 'a', kind: 'movie', name: 'Zorro', cat: 'm:1', added: 10, rating: 6, year: 1998 },
  { id: 'b', kind: 'movie', name: 'أفاتار', cat: 'm:1', added: 30, rating: 8, year: 2009 },
  { id: 'c', kind: 'movie', name: 'Batman', cat: 'm:2', added: 20, rating: 9, year: 2022 },
  { id: 'd', kind: 'live', name: 'MBC 1', cat: 'l:1', num: 2 },
];
eq(sortItems(items.filter((i) => i.kind === 'movie'), 'added').map((i) => i.id), ['b', 'c', 'a'], 'الأحدث إضافة');
eq(sortItems(items.filter((i) => i.kind === 'movie'), 'rating').map((i) => i.id), ['c', 'b', 'a'], 'الأعلى تقييمًا');
eq(sortItems(items.filter((i) => i.kind === 'movie'), 'year').map((i) => i.id), ['c', 'b', 'a'], 'الأحدث إصدارًا');
eq(filterItems(items, { kind: 'movie', cat: 'm:1', sort: 'az' }).map((i) => i.id), ['b', 'a'], 'قسم + أبجدي (العربي قبل اللاتيني)');
eq(filterItems(items, { kind: 'movie', query: 'افاتار' }).map((i) => i.id), ['b'], 'بحث بلا همزة');
eq(filterItems(items, { kind: 'movie', cat: 'fav', favs: new Set(['c']) }).map((i) => i.id), ['c'], 'المفضلة');
eq(filterItems(items, { kind: 'movie', blockedCats: new Set(['m:1']) }).map((i) => i.id), ['c'], 'حجب قسم مقفل');
eq(filterItems(items, { kind: 'movie', cat: 'recent', recent: ['c', 'a', 'd'] }).map((i) => i.id), ['c', 'a'], 'شوهد مؤخرًا بترتيبه');
eq([...countByCat(items, 'movie')], [['m:1', 2], ['m:2', 1]], 'عدد العناصر لكل قسم');
let h = updateHistory([], { id: 'a', kind: 'movie', pos: 600, dur: 6000 });
h = updateHistory(h, { id: 'c', kind: 'movie', pos: 5900, dur: 6000 });
h = updateHistory(h, { id: 'a', kind: 'movie', pos: 700, dur: 6000 });
eq(h.map((x) => x.id), ['a', 'c'], 'السجل بلا تكرار والأحدث أولًا');
eq(continueWatching(h).map((x) => x.id), ['a'], 'المكتمل (>95%) لا يظهر في المتابعة');

section('9) إضافة الاشتراكات');
const xp = makePlaylist({ type: 'm3u', url: 'http://srv:8080/get.php?username=a&password=b&type=m3u_plus' });
eq([xp.type, xp.server, xp.username], ['xtream', 'http://srv:8080', 'a'], 'رابط get.php يُضاف كـ Xtream تلقائيًا');
eq(makePlaylist({ type: 'stalker', server: 'http://p/c/', mac: '001a79000001' }).mac, '00:1A:79:00:00:01', 'Stalker بتوحيد MAC');
let threw = false; try { makePlaylist({ type: 'xtream', server: 'x' }); } catch { threw = true; }
ok(threw, 'رفض Xtream ناقص البيانات');

section('10) اختيار محرك التشغيل');
eq(pickEngine('http://a/live/1.m3u8', 'live'), 'hls', 'm3u8 → hls.js');
eq(pickEngine('http://a/live/u/p/1.ts', 'live'), 'mpegts', 'ts مباشر → mpegts.js');
eq(pickEngine('http://a/movie/1.mp4', 'movie'), 'native', 'mp4 → المشغل الأصلي');
eq(pickEngine('http://a/movie/1.mkv', 'movie'), 'native', 'mkv → المشغل الأصلي');
eq(pickEngine('http://a/play?id=4', 'live'), 'mpegts', 'رابط قناة بلا امتداد → mpegts');
eq(pickEngine('http://a/timeshift/u/p/60/2024/5.ts', 'movie'), 'mpegts', 'أرشيف ts → mpegts');

section('11) ملفات المشروع');
const html = fs.readFileSync(path.join(root, 'www/index.html'), 'utf8');
for (const f of [...html.matchAll(/(?:src|href)="((?:js|css|vendor|img)\/[^"]+)"/g)].map((m) => m[1])) {
  ok(fs.existsSync(path.join(root, 'www', f)), `موجود: ${f}`);
}
const patch = fs.readFileSync(path.join(root, 'scripts/patch-android.mjs'), 'utf8');
ok(patch.includes('usesCleartextTraffic') && patch.includes('LiwaWebViewClient') && patch.includes('LEANBACK_LAUNCHER'), 'تهيئة أندرويد: HTTP + الوسيط + أندرويد TV');

console.log(`\n${pass} نجح · ${fail} فشل`);
process.exit(fail ? 1 : 0);
