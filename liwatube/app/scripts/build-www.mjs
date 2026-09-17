/**
 * LiwaTube App — يجمّع واجهة الويب في www/ للتغليف بـ Capacitor:
 * نفس ملفات الواجهة التي يقدّمها الخادم، مع علم LT_STANDALONE ليطلب التطبيق عنوان الخادم.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, '..');
const root = path.resolve(app, '..');
const www = path.join(app, 'www');

fs.rmSync(www, { recursive: true, force: true });
for (const d of ['css', 'js']) fs.mkdirSync(path.join(www, d), { recursive: true });
const copy = (from, to) => { fs.copyFileSync(path.join(root, from), path.join(www, to)); console.log('✓', to); };

copy('renderer/css/app.css', 'css/app.css');
copy('web/css/web.css', 'css/web.css');
for (const f of fs.readdirSync(path.join(root, 'renderer/js'))) copy(`renderer/js/${f}`, `js/${f}`);
for (const f of fs.readdirSync(path.join(root, 'web/js'))) copy(`web/js/${f}`, `js/${f}`);
copy('electron/lib/recommend.js', 'js/recommend.js');
copy('build/icon.png', 'icon.png');
copy('web/manifest.webmanifest', 'manifest.webmanifest');

let html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
html = html.replace('<script src="js/util.js"></script>', '<script src="js/standalone.js"></script>\n<script src="js/util.js"></script>');
fs.writeFileSync(path.join(www, 'index.html'), html, 'utf8');
// الخادم الافتراضي: متغيّر البيئة، وإلا ملف app/default-server.txt (حرّره لتغيير خادمك)
let def = String(process.env.LIWATUBE_SERVER || '').trim();
if (!def) {
  const file = path.join(app, 'default-server.txt');
  if (fs.existsSync(file)) def = fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))[0] || '';
}
def = def.replace(/\/+$/, '');
fs.writeFileSync(path.join(www, 'js/standalone.js'), `window.LT_STANDALONE = true;\nwindow.LT_DEFAULT_SERVER = ${JSON.stringify(def)};\n`, 'utf8');
if (def) console.log('✓ الخادم الافتراضي المضمَّن:', def);
console.log('✓ index.html (standalone)');
console.log(`www جاهز: ${www}`);
