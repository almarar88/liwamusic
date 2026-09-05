/**
 * LiwaMusic — تهيئة مشروع أندرويد بعد `cap add android`:
 * إضافة مخطط الرابط العميق لتسجيل الدخول بجوجل، واسم التطبيق، والأيقونة.
 * يُشغَّل في سير العمل الآلي، وهو مُتسامح: لا يفشل إن كان التعديل مطبَّقًا.
 */
import fs from 'node:fs';
import path from 'node:path';

const ANDROID = process.argv[2] || 'android';
// مخططان: اسم الحزمة (لعملاء Android)، ومخطط جوجل المعكوس (لعملاء Desktop).
// الثاني يُشتق من معرّف العميل ويمكن ضبطه عبر GOOGLE_REVERSED_SCHEME عند البناء.
const SCHEMES = [
  'com.liwamusic.app',
  process.env.GOOGLE_REVERSED_SCHEME
    || 'com.googleusercontent.apps.341100058852-cfco9ltr8lu5jhvpepmtphkc03hl47g8',
].filter(Boolean);

function read(p) { return fs.readFileSync(p, 'utf8'); }
function write(p, s) { fs.writeFileSync(p, s, 'utf8'); console.log('✓', path.relative('.', p)); }

// 1) الروابط العميقة لاستقبال رد جوجل بعد الموافقة
const manifestPath = path.join(ANDROID, 'app/src/main/AndroidManifest.xml');
let manifest = read(manifestPath);
let added = 0;
for (const scheme of SCHEMES) {
  if (manifest.includes(`android:scheme="${scheme}"`)) continue;
  const filter = `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="${scheme}" />
            </intent-filter>
`;
  const at = manifest.indexOf('</activity>');
  if (at === -1) throw new Error('لم يُعثر على وسم </activity> في AndroidManifest');
  manifest = manifest.slice(0, at) + filter + '        ' + manifest.slice(at);
  added++;
}
if (added) write(manifestPath, manifest);
console.log(`• مخططات الروابط العميقة: ${SCHEMES.join(' , ')}`);

// 2) اسم التطبيق كما يظهر تحت الأيقونة
const stringsPath = path.join(ANDROID, 'app/src/main/res/values/strings.xml');
if (fs.existsSync(stringsPath)) {
  let strings = read(stringsPath);
  strings = strings
    .replace(/<string name="app_name">[^<]*<\/string>/, '<string name="app_name">LiwaMusic</string>')
    .replace(/<string name="title_activity_main">[^<]*<\/string>/, '<string name="title_activity_main">LiwaMusic</string>');
  write(stringsPath, strings);
}

// 3) لون الخلفية والحالة ليطابق التصميم الداكن
const colorsPath = path.join(ANDROID, 'app/src/main/res/values/colors.xml');
if (fs.existsSync(colorsPath)) {
  let colors = read(colorsPath);
  colors = colors
    .replace(/<color name="colorPrimary">[^<]*<\/color>/, '<color name="colorPrimary">#0b0b12</color>')
    .replace(/<color name="colorPrimaryDark">[^<]*<\/color>/, '<color name="colorPrimaryDark">#08080e</color>')
    .replace(/<color name="colorAccent">[^<]*<\/color>/, '<color name="colorAccent">#7c5cff</color>');
  write(colorsPath, colors);
}

// 4) رقم الإصدار من package.json
const pkg = JSON.parse(read('package.json'));
const gradlePath = path.join(ANDROID, 'app/build.gradle');
if (fs.existsSync(gradlePath)) {
  let gradle = read(gradlePath);
  gradle = gradle
    .replace(/versionCode \d+/, `versionCode ${Number(process.env.VERSION_CODE || 2)}`)
    .replace(/versionName "[^"]*"/, `versionName "${pkg.version}"`);
  write(gradlePath, gradle);
}

console.log('تمت تهيئة مشروع أندرويد لـ LiwaMusic');
