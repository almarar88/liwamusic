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
  'www/js/store.js', 'www/js/tags.js', 'capacitor.config.json', 'package.json',
  'scripts/patch-android.mjs', 'scripts/make-icons.py', 'signing/liwamusic.jks']) {
  ok(fs.existsSync(path.join(root, rel)), `موجود: ${rel}`);
}
const html = fs.readFileSync(path.join(root, 'www/index.html'), 'utf8');
ok(html.includes('js/app.js') && html.includes('css/m.css'), 'الواجهة مربوطة بملفاتها');
ok(html.includes('viewport-fit=cover') && html.includes('user-scalable=no'), 'إعدادات العرض للهاتف');
ok(html.includes('LiwaMusic'), 'توقيع LiwaMusic في الواجهة');
const conf = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
ok(conf.appId === 'com.liwamusic.app', 'اسم الحزمة يطابق الرابط العميق');

console.log(`\nالنتيجة: ${pass} ناجح، ${fail} فاشل`);
process.exit(fail ? 1 : 0);
