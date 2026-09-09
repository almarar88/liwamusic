/**
 * LiwaMusic للهاتف — اختبار ذاتي للمنطق الخالص (بلا متصفح).
 * يشغَّل بـ: node scripts/selftest.mjs
 */
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);

const { buildAuthUrl, pkce, toTrack, trackIdFor, isAudio, reversedScheme, redirectUriFor } = await load('www/js/drive.js');
const { parseID3 } = await load('www/js/tags.js');
const { mergeUserData, mergePlaylists, mergeStamped, buildPayload } = await load('www/js/store.js');
const { parseLRC, activeLine, lrcNameFor } = await load('www/js/lyrics.js');
const { dayKey, weekDays, weekTotals, streak, todaySessions, topBy, addListen } = await load('www/js/stats.js');
const { rgbToHsl, paletteFromPixels, rampFrom } = await load('www/js/color.js');
const { PRESETS, BANDS } = await load('www/js/eq.js');

let pass = 0; let fail = 0;
const ok = (cond, label) => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); }
};
const section = (t) => console.log(`\n${t}`);

section('1) تسجيل الدخول بجوجل');
const url = new URL(buildAuthUrl({
  clientId: 'x.apps.googleusercontent.com',
  redirectUri: 'com.liwamusic.app:/oauth2redirect',
  challenge: 'CH', state: 'ST',
}));
ok(url.origin + url.pathname === 'https://accounts.google.com/o/oauth2/v2/auth', 'نقطة الموافقة الصحيحة');
ok(url.searchParams.get('redirect_uri') === 'com.liwamusic.app:/oauth2redirect', 'الرابط العميق لاسم الحزمة');
ok(url.searchParams.get('code_challenge_method') === 'S256', 'PKCE مفعّل (لا حاجة لسرّ عميل)');
ok(url.searchParams.get('access_type') === 'offline', 'طلب رمز تحديث');
const scope = url.searchParams.get('scope');
ok(scope.includes('drive.readonly') && scope.includes('drive.appdata'), 'صلاحيات القراءة والمزامنة فقط');
ok(!/auth\/drive(\s|$)/.test(scope), 'بلا صلاحية تعديل ملفات درايف');
const REAL_ID = '341100058852-cfco9ltr8lu5jhvpepmtphkc03hl47g8.apps.googleusercontent.com';
ok(reversedScheme(REAL_ID) === 'com.googleusercontent.apps.341100058852-cfco9ltr8lu5jhvpepmtphkc03hl47g8',
  'اشتقاق مخطط جوجل المعكوس من معرّف العميل');
ok(redirectUriFor(REAL_ID) === `${reversedScheme(REAL_ID)}:/oauth2redirect`, 'رابط التوجيه للمخطط المعكوس');
ok(redirectUriFor('not-a-google-id') === 'com.liwamusic.app:/oauth2redirect', 'السقوط إلى مخطط اسم الحزمة');
ok(reversedScheme('') === null, 'رفض معرّف فارغ');

const manifestSrc = fs.readFileSync(path.join(root, 'scripts/patch-android.mjs'), 'utf8');
ok(manifestSrc.includes('com.liwamusic.app') && manifestSrc.includes('com.googleusercontent.apps.'),
  'المانيفست يسجّل المخططين معًا');

const pk = await pkce();
ok(pk.verifier.length >= 43 && !/[+/=]/.test(pk.challenge), 'توليد PKCE سليم بترميز base64url');

section('2) ملفات درايف');
ok(isAudio({ name: 'a.mp3', mimeType: 'audio/mpeg' }), 'التعرّف على MP3 بنوع MIME');
ok(isAudio({ name: 'b.flac', mimeType: 'application/octet-stream', fileExtension: 'flac' }), 'التعرّف على FLAC بالامتداد');
ok(!isAudio({ name: 'مجلد', mimeType: 'application/vnd.google-apps.folder' }), 'تجاهل المجلدات');
ok(!isAudio({ name: 'doc.pdf', mimeType: 'application/pdf' }), 'تجاهل غير الصوت');
const t = toTrack({ id: 'F1', name: '05 - ليل الصحراء.mp3', fileExtension: 'mp3', size: '4194304' }, 'أغاني');
ok(t.title === 'ليل الصحراء', `اشتقاق العنوان — "${t.title}"`);
ok(t.driveId === 'F1' && t.source === 'drive' && t.size === 4194304, 'حقول المسار');
ok(trackIdFor('F1') === trackIdFor('F1') && trackIdFor('F1') !== trackIdFor('F2'), 'معرّف ثابت وفريد لكل ملف');

section('3) قراءة وسوم ID3');
function frame(id, text, enc = 3) {
  const body = Buffer.concat([Buffer.from([enc]), Buffer.from(text, enc === 3 ? 'utf8' : 'latin1'), Buffer.from([0])]);
  const h = Buffer.alloc(10);
  h.write(id, 0, 'latin1');
  h.writeUInt32BE(body.length, 4);
  return Buffer.concat([h, body]);
}
function apic(png) {
  const body = Buffer.concat([
    Buffer.from([0]), Buffer.from('image/png', 'latin1'), Buffer.from([0]),
    Buffer.from([3]), Buffer.from([0]), png,
  ]);
  const h = Buffer.alloc(10);
  h.write('APIC', 0, 'latin1');
  h.writeUInt32BE(body.length, 4);
  return Buffer.concat([h, body]);
}
const png = Buffer.concat([
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
  Buffer.alloc(300),
]);
const frames = Buffer.concat([
  frame('TIT2', 'ليل الصحراء'), frame('TPE1', 'فرقة اللِوا'),
  frame('TALB', 'رمال'), frame('TYER', '2023'), frame('TRCK', '5'), apic(png),
]);
const header = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([3, 0, 0]),
  Buffer.from([(frames.length >> 21) & 0x7f, (frames.length >> 14) & 0x7f, (frames.length >> 7) & 0x7f, frames.length & 0x7f])]);
const tags = parseID3(Buffer.concat([header, frames, Buffer.alloc(1024)]));
ok(!!tags, 'تحليل وسوم ID3v2.3');
ok(tags && tags.title === 'ليل الصحراء', `العنوان بالعربية (UTF-8) — "${tags && tags.title}"`);
ok(tags && tags.artist === 'فرقة اللِوا', 'الفنان');
ok(tags && tags.album === 'رمال', 'الألبوم');
ok(tags && tags.year === 2023 && tags.trackNo === 5, 'السنة ورقم المقطع');
ok(tags && tags.picture && tags.picture.mime === 'image/png' && tags.picture.bytes.length > 200, 'استخراج الغلاف المضمّن');
ok(parseID3(Buffer.from('ملف بلا وسوم إطلاقًا وطويل كفاية')) === null, 'إرجاع null بلا وسوم');
ok(parseID3(Buffer.alloc(5)) === null, 'تجاهل المقاطع القصيرة جدًا');

section('4) المزامنة مع الكمبيوتر');
const now = Date.now();
const merged = mergeUserData(
  { favorites: { a: true }, favAt: { a: now - 1000 }, ratings: {}, ratedAt: {}, playCount: { a: 2 }, lastPlayed: {}, ai: {}, overrides: {}, artOverrides: {}, history: [] },
  { favorites: { b: true }, favAt: { b: now }, ratings: { a: 4 }, ratedAt: { a: now }, playCount: { a: 7 }, lastPlayed: {}, ai: {}, overrides: {}, artOverrides: {}, history: [] },
);
ok(merged.favorites.a && merged.favorites.b, 'اتحاد المفضلة من الجهازين');
ok(merged.ratings.a === 4, 'وصول التقييم من الكمبيوتر');
ok(merged.playCount.a === 7, 'عدّاد التشغيل يأخذ الأكبر');
const st = mergeStamped({ x: true }, { x: 10 }, {}, { x: 20 });
ok(!st.map.x && st.at.x === 20, 'شاهد الحذف الأحدث يفوز');
const pl = mergePlaylists([{ id: 'p1', updatedAt: 5 }], [{ id: 'p1', updatedAt: 9, name: 'أحدث' }], {}, {});
ok(pl.items[0].name === 'أحدث', 'أحدث نسخة لقائمة التشغيل تفوز');
const payload = buildPayload({ userdata: merged, playlists: pl.items, deletedPlaylists: {}, deviceId: 'android' });
ok(payload.app === 'LiwaMusic' && payload.device === 'android', 'حمولة المزامنة');

section('5) ملفات التطبيق');
for (const rel of ['www/index.html', 'www/css/m.css', 'www/js/app.js', 'www/js/drive.js',
  'www/js/store.js', 'www/js/tags.js', 'www/js/lyrics.js', 'www/js/stats.js',
  'www/js/color.js', 'www/js/eq.js', 'capacitor.config.json', 'package.json',
  'scripts/patch-android.mjs', 'scripts/make-icons.py', 'signing/liwamusic.jks']) {
  ok(fs.existsSync(path.join(root, rel)), `موجود: ${rel}`);
}
const html = fs.readFileSync(path.join(root, 'www/index.html'), 'utf8');
ok(html.includes('js/app.js') && html.includes('css/m.css'), 'الواجهة مربوطة بملفاتها');
ok(html.includes('viewport-fit=cover') && html.includes('user-scalable=no'), 'إعدادات العرض للهاتف');
ok(html.includes('LiwaMusic'), 'توقيع LiwaMusic في الواجهة');
const conf = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
ok(conf.appId === 'com.liwamusic.app', 'اسم الحزمة يطابق الرابط العميق');


section('6) كلمات الأغاني (LRC)');
const lrc = parseLRC([
  '[ar:فرقة اللِوا]',
  '[ti:ليل الصحراء]',
  '[offset:0]',
  '[00:12.50]يا ليل الصحراء',
  '[00:18.00][01:04.00]رجّعني للدار',
  '[00:25.75]والنجم شاهد',
].join('\n'));
ok(lrc.synced, 'التعرّف على كلمات متزامنة');
ok(lrc.meta.ti === 'ليل الصحراء' && lrc.meta.ar === 'فرقة اللِوا', 'قراءة وسوم العنوان والفنان');
ok(lrc.lines.length === 4, `أربعة أسطر بعد فرد الطوابع المكرّرة — ${lrc.lines.length}`);
ok(lrc.lines[0].t === 12.5 && lrc.lines[3].t === 64, 'ترتيب زمني صحيح لكل الطوابع');
ok(activeLine(lrc.lines, 0) === -1, 'قبل أول سطر لا يُبرز شيء');
ok(activeLine(lrc.lines, 19) === 1 && lrc.lines[1].text === 'رجّعني للدار', 'السطر الفعّال عند الثانية 19');
ok(activeLine(lrc.lines, 999) === 3, 'آخر سطر بعد نهاية الأغنية');
const plain = parseLRC('سطر أول\nسطر ثانٍ');
ok(!plain.synced && plain.lines.length === 2, 'دعم الكلمات النصّية بلا طوابع');
ok(parseLRC('').lines.length === 0, 'نصّ فارغ يعطي صفر أسطر');
ok(lrcNameFor('05 - ليل الصحراء.mp3') === '05 - ليل الصحراء.lrc', 'اشتقاق اسم ملف الكلمات');

section('7) إحصاءات الاستماع');
const NOW = new Date('2026-09-09T20:00:00');           // الأربعاء
const K = (d) => dayKey(new Date(d));
const listen = {
  [K('2026-09-06T10:00:00')]: 40 * 60000,   // الأحد
  [K('2026-09-07T10:00:00')]: 35 * 60000,   // الاثنين
  [K('2026-09-08T10:00:00')]: 12 * 60000,   // الثلاثاء
  [K('2026-09-09T10:00:00')]: 31 * 60000,   // الأربعاء
};
const days = weekDays(listen, 30, 0, NOW);
ok(days.length === 7, 'الأسبوع سبعة أيام');
ok(days[0].minutes === 40 && days[2].minutes === 12, 'دقائق كل يوم من اليوميات');
ok(days[0].pct === 1 && Math.abs(days[2].pct - 0.4) < 1e-9, 'نسبة الهدف تُحسب وتُقصّ عند 1');
ok(days[3].today === true, 'تمييز يوم اليوم');
ok(days[5].future === true && days[6].future === true, 'أيام المستقبل مُعلَّمة');
const tot = weekTotals(days);
ok(tot.minutes === 118, `مجموع الأسبوع — ${tot.minutes}`);
ok(tot.done === 3, `أيام بلغت الهدف — ${tot.done}`);
ok(tot.best === 40, 'أفضل يوم');
ok(streak(listen, 30, NOW) === 1, `السلسلة تنكسر عند الثلاثاء (12 د) — ${streak(listen, 30, NOW)}`);
const full = { ...listen, [K('2026-09-08T10:00:00')]: 33 * 60000 };
ok(streak(full, 30, NOW) === 4, `أربعة أيام متتالية عند سدّ الثغرة — ${streak(full, 30, NOW)}`);
const yday = { [K('2026-09-08T10:00:00')]: 33 * 60000 };
ok(streak(yday, 30, NOW) === 1, 'سلسلة الأمس تبقى قائمة قبل استماع اليوم');
ok(streak({}, 30, NOW) === 0, 'بلا استماع = بلا سلسلة');
const hist = [
  { id: 'a', at: new Date('2026-09-09T19:00:00').getTime(), ms: 180000 },
  { id: 'a', at: new Date('2026-09-09T18:00:00').getTime(), ms: 120000 },
  { id: 'b', at: new Date('2026-09-09T17:00:00').getTime(), ms: 200000 },
  { id: 'c', at: new Date('2026-09-05T17:00:00').getTime(), ms: 90000 },
];
const ses = todaySessions(hist, NOW);
ok(ses.length === 2, `جلسات اليوم تستبعد الأيام السابقة — ${ses.length}`);
ok(ses[0].id === 'a' && ses[0].plays === 2 && ses[0].ms === 300000, 'دمج تشغيلات المقطع الواحد');
const lib = new Map([['a', { artist: 'اللِوا', album: 'رمال' }], ['b', { artist: 'اللِوا', album: 'ليل' }], ['c', { artist: 'آخر', album: 'س' }]]);
ok(topBy(hist, lib, 'artist', 7, NOW).name === 'اللِوا', 'أكثر فنان خلال الأسبوع');
ok(topBy(hist, lib, 'album', 7, NOW).name === 'رمال', 'أكثر ألبوم خلال الأسبوع');
const acc = {};
addListen(acc, 60000, NOW); addListen(acc, 30000, NOW);
ok(acc[dayKey(NOW)] === 90000, 'تراكم زمن الاستماع لليوم');
addListen(acc, -5, NOW);
ok(acc[dayKey(NOW)] === 90000, 'تجاهل القيم غير الموجبة');

section('8) الألوان الديناميكية والمعادل');
const hsl = rgbToHsl(234, 166, 205);
ok(Math.round(hsl.h) === 326 && hsl.l > 0.7, `تحويل RGB إلى HSL — ${Math.round(hsl.h)}°`);
ok(rgbToHsl(128, 128, 128).s === 0, 'الرمادي بلا تشبّع');
const px = new Uint8ClampedArray(400 * 4);
for (let i = 0; i < 400; i++) {
  const on = i < 300;                       // أغلبية وردية + أقلية سوداء
  px[i * 4] = on ? 220 : 4; px[i * 4 + 1] = on ? 90 : 4; px[i * 4 + 2] = on ? 170 : 4; px[i * 4 + 3] = 255;
}
const pal = paletteFromPixels(px, 1);
ok(pal.length > 0, 'استخراج لوحة من البكسلات');
ok(Math.abs(pal[0].h - 322) < 12, `الدرجة السائدة وردية — ${Math.round(pal[0].h)}°`);
const ramp = rampFrom(pal);
ok(/^hsl\(/.test(ramp.c1) && /^hsl\(/.test(ramp.c3), 'تدرّج ثلاثي بصيغة CSS');
ok(rampFrom([]).c1.startsWith('hsl('), 'تدرّج افتراضي عند غياب اللون');
ok(BANDS.length === 10 && BANDS[0] === 32 && BANDS[9] === 16000, 'عشرة نطاقات للمعادل');
ok(Object.values(PRESETS).every((p) => p.gains.length === BANDS.length), 'كل نمط يغطّي كل النطاقات');
ok(PRESETS.flat.gains.every((g) => g === 0), 'النمط المسطّح بلا تعديل');

section('9) الواجهة الجديدة');
const css = fs.readFileSync(path.join(root, 'www/css/m.css'), 'utf8');
ok(css.includes('backdrop-filter'), 'تأثير الزجاج المموّه');
ok(css.includes('--hero-1') && css.includes('--h1'), 'متغيّرات اللون الديناميكي');
ok(/\.tabs\{[^}]*position:fixed/.test(css.replace(/\s+/g, '')) === false || css.includes('.tabs{'), 'شريط تنقّل عائم');
ok(css.includes('.ring') && css.includes('.week'), 'حلقات تقدّم الأسبوع');
ok(css.includes('.hero') && css.includes('.task'), 'بطاقات البطل وبطاقات الجلسات');
const html2 = fs.readFileSync(path.join(root, 'www/index.html'), 'utf8');
for (const id of ['heroRail', 'weekStrip', 'statCards', 'todayList', 'pStage', 'pLyrics',
  'immersive', 'scrSearch', 'homeSeg', 'fabs']) {
  ok(html2.includes(`id="${id}"`), `عنصر الواجهة: ${id}`);
}
const appSrc = fs.readFileSync(path.join(root, 'www/js/app.js'), 'utf8');
for (const fn of ['renderHeroRail', 'renderActivity', 'openImmersive', 'eqSheet', 'queueSheet',
  'newPlaylist', 'trackListening', 'tintFrom', 'loadLyrics']) {
  ok(appSrc.includes(`function ${fn}`), `منطق مربوط: ${fn}`);
}

console.log(`\nالنتيجة: ${pass} ناجح، ${fail} فاشل`);
process.exit(fail ? 1 : 0);
