/**
 * Here — تجهيز غلاف الأندرويد:
 *  - يضع رابط الخادم (HERE_SERVER_URL) في capacitor.config.json
 *  - ينشئ www/ بصفحة احتياطية بسيطة (التطبيق نفسه يُحمَّل من الخادم)
 *  - يُطبّق اسم التطبيق والأيقونات والإصدار على مشروع أندرويد إن وُجد
 */
import fs from 'node:fs';
import path from 'node:path';

const url = (process.env.HERE_SERVER_URL || '').trim().replace(/\/+$/, '');
if (!url || !/^https:\/\//.test(url)) { console.error('✗ عرّف HERE_SERVER_URL برابط https للخادم (مثال: https://order.here-cafe.ae)'); process.exit(1); }

const cfgPath = 'capacitor.config.json';
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
cfg.server.url = url; fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2)); console.log('✓ رابط الخادم:', url);

fs.mkdirSync('www', { recursive: true });
fs.writeFileSync('www/index.html', `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Here</title>
<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#f6f1ea;font-family:sans-serif;color:#151412;text-align:center">
<div><div style="font-family:'Courier New',monospace;letter-spacing:.3em;font-size:32px">here</div><p>يتعذّر الاتصال بالخادم حاليًا.<br>تأكد من الإنترنت ثم أعد فتح التطبيق.</p><button onclick="location.href='${url}'" style="padding:10px 18px;border-radius:12px;border:0;background:#151412;color:#fff;font-size:15px">إعادة المحاولة</button></div></body></html>`);
console.log('✓ www/index.html (صفحة احتياطية)');

const ANDROID = process.argv[2] || 'android';
if (fs.existsSync(ANDROID)) {
  const strings = path.join(ANDROID, 'app/src/main/res/values/strings.xml');
  if (fs.existsSync(strings)) fs.writeFileSync(strings, fs.readFileSync(strings, 'utf8').replace(/<string name="app_name">[^<]*<\/string>/, '<string name="app_name">Here</string>').replace(/<string name="title_activity_main">[^<]*<\/string>/, '<string name="title_activity_main">Here</string>'));
  const colors = path.join(ANDROID, 'app/src/main/res/values/colors.xml');
  if (fs.existsSync(colors)) fs.writeFileSync(colors, fs.readFileSync(colors, 'utf8').replace(/<color name="colorPrimary">[^<]*<\/color>/, '<color name="colorPrimary">#151412</color>').replace(/<color name="colorPrimaryDark">[^<]*<\/color>/, '<color name="colorPrimaryDark">#151412</color>').replace(/<color name="colorAccent">[^<]*<\/color>/, '<color name="colorAccent">#b07a4a</color>'));
  const gradle = path.join(ANDROID, 'app/build.gradle');
  if (fs.existsSync(gradle)) { const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')); fs.writeFileSync(gradle, fs.readFileSync(gradle, 'utf8').replace(/versionCode \d+/, `versionCode ${Number(process.env.VERSION_CODE || 1)}`).replace(/versionName "[^"]*"/, `versionName "${pkg.version}"`)); }
  // الأيقونات: نفس صورة 512 تُصغَّر عبر أداة الأندرويد؛ نضع الأصل في كل mipmap (Android يقبل الأحجام الأكبر)
  const icon = path.resolve('../public/icons/icon-512.png');
  for (const d of ['mipmap-mdpi', 'mipmap-hdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi']) {
    const dir = path.join(ANDROID, 'app/src/main/res', d); if (!fs.existsSync(dir)) continue;
    for (const n of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) fs.copyFileSync(icon, path.join(dir, n));
  }
  const anydpi = path.join(ANDROID, 'app/src/main/res/mipmap-anydpi-v26'); if (fs.existsSync(anydpi)) fs.rmSync(anydpi, { recursive: true, force: true });
  console.log('✓ اسم التطبيق والألوان والأيقونات والإصدار');
}
