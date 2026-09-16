/**
 * LiwaTube App — تهيئة مشروع أندرويد بعد `cap add android`:
 * دعم Android TV (Leanback + لا يشترط شاشة لمس + لافتة)، الاسم، الألوان، الإصدار، والسماح بـ http للخوادم المحلية.
 * مُتسامح: لا يفشل إن كان التعديل مطبَّقًا.
 */
import fs from 'node:fs';
import path from 'node:path';

const ANDROID = process.argv[2] || 'android';
const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => { fs.writeFileSync(p, s, 'utf8'); console.log('✓', path.relative('.', p)); };

// 1) AndroidManifest: تلفاز + هاتف في APK واحد
const manifestPath = path.join(ANDROID, 'app/src/main/AndroidManifest.xml');
let m = read(manifestPath);
if (!m.includes('android.software.leanback')) {
  m = m.replace('<application', `<uses-feature android:name="android.software.leanback" android:required="false" />
    <uses-feature android:name="android.hardware.touchscreen" android:required="false" />
    <uses-permission android:name="android.permission.INTERNET" />

    <application`);
}
if (!m.includes('android:banner=')) m = m.replace('<application', '<application\n        android:banner="@drawable/banner"');
if (!m.includes('android:usesCleartextTraffic')) m = m.replace('<application', '<application\n        android:usesCleartextTraffic="true"');
if (!m.includes('LEANBACK_LAUNCHER')) {
  m = m.replace('<category android:name="android.intent.category.LAUNCHER" />', '<category android:name="android.intent.category.LAUNCHER" />\n                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />');
}
// شاشة أفقية ثابتة على التلفاز لا تضر الهاتف (يبقى المستشعر يعمل حيث يوجد)
if (!m.includes('android:screenOrientation')) m = m.replace(/<activity([^>]*?)android:name="\.MainActivity"/, '<activity$1android:name=".MainActivity"\n            android:screenOrientation="fullUser"');
write(manifestPath, m);

// 2) اسم التطبيق
const stringsPath = path.join(ANDROID, 'app/src/main/res/values/strings.xml');
if (fs.existsSync(stringsPath)) {
  write(stringsPath, read(stringsPath)
    .replace(/<string name="app_name">[^<]*<\/string>/, '<string name="app_name">LiwaTube</string>')
    .replace(/<string name="title_activity_main">[^<]*<\/string>/, '<string name="title_activity_main">LiwaTube</string>'));
}

// 3) الألوان
const colorsPath = path.join(ANDROID, 'app/src/main/res/values/colors.xml');
if (fs.existsSync(colorsPath)) {
  write(colorsPath, read(colorsPath)
    .replace(/<color name="colorPrimary">[^<]*<\/color>/, '<color name="colorPrimary">#0f0f0f</color>')
    .replace(/<color name="colorPrimaryDark">[^<]*<\/color>/, '<color name="colorPrimaryDark">#0f0f0f</color>')
    .replace(/<color name="colorAccent">[^<]*<\/color>/, '<color name="colorAccent">#ff0033</color>'));
}

// 4) الإصدار
const pkg = JSON.parse(read('package.json'));
const gradlePath = path.join(ANDROID, 'app/build.gradle');
if (fs.existsSync(gradlePath)) {
  write(gradlePath, read(gradlePath)
    .replace(/versionCode \d+/, `versionCode ${Number(process.env.VERSION_CODE || 1)}`)
    .replace(/versionName "[^"]*"/, `versionName "${pkg.version}"`));
}
console.log('تمت تهيئة مشروع أندرويد لـ LiwaTube (هاتف + تلفاز)');
