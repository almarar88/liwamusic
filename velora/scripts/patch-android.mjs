/** Velora — post `cap add android` tweaks: app name, theme colours, version, portrait lock. */
import fs from 'node:fs';
import path from 'node:path';

const A = process.argv[2] || 'android';
const edit = (p, fn) => { if (!fs.existsSync(p)) return; fs.writeFileSync(p, fn(fs.readFileSync(p, 'utf8'))); console.log('✓', p); };

edit(path.join(A, 'app/src/main/res/values/strings.xml'), (s) => s
  .replace(/<string name="app_name">[^<]*<\/string>/, '<string name="app_name">Velora</string>')
  .replace(/<string name="title_activity_main">[^<]*<\/string>/, '<string name="title_activity_main">Velora</string>'));
edit(path.join(A, 'app/src/main/res/values/colors.xml'), (s) => s
  .replace(/<color name="colorPrimary">[^<]*<\/color>/, '<color name="colorPrimary">#070b16</color>')
  .replace(/<color name="colorPrimaryDark">[^<]*<\/color>/, '<color name="colorPrimaryDark">#070b16</color>')
  .replace(/<color name="colorAccent">[^<]*<\/color>/, '<color name="colorAccent">#d9b26f</color>'));
edit(path.join(A, 'app/src/main/AndroidManifest.xml'), (s) => s.includes('screenOrientation')
  ? s : s.replace('android:name=".MainActivity"', 'android:name=".MainActivity"\n            android:screenOrientation="portrait"'));
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
edit(path.join(A, 'app/build.gradle'), (s) => s
  .replace(/versionCode \d+/, `versionCode ${Number(process.env.VERSION_CODE || 1)}`)
  .replace(/versionName "[^"]*"/, `versionName "${pkg.version}"`));
