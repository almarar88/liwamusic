/** LiwaTube App — يتحقق من تجميع www بشكل سليم. يشغَّل بـ: npm test (بعد build:www). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const www = path.join(app, 'www');
let fail = 0;
const ok = (c, l) => { console.log(`${c ? '✓' : '✗'} ${l}`); if (!c) fail++; };
ok(fs.existsSync(path.join(www, 'index.html')), 'www/index.html');
const html = fs.existsSync(path.join(www, 'index.html')) ? fs.readFileSync(path.join(www, 'index.html'), 'utf8') : '';
for (const f of ['standalone.js', 'util.js', 'thumbs.js', 'player.js', 'views.js', 'recommend.js', 'bridge.js', 'studio.js', 'platform.js', 'app.js']) {
  ok(html.includes(`js/${f}`) && fs.existsSync(path.join(www, 'js', f)), `js/${f}`);
}
ok(fs.existsSync(path.join(www, 'css/app.css')) && fs.existsSync(path.join(www, 'css/web.css')), 'css');
ok(html.includes('id="connect"'), 'شاشة الاتصال بالخادم موجودة');
ok(fs.readFileSync(path.join(www, 'js/standalone.js'), 'utf8').includes('LT_STANDALONE = true'), 'علم التطبيق المستقل');
const cfg = JSON.parse(fs.readFileSync(path.join(app, 'capacitor.config.json'), 'utf8'));
ok(cfg.appId === 'com.liwamusic.liwatube' && cfg.server.cleartext === true, 'capacitor.config');
console.log(fail ? `\n${fail} فشل` : '\nكل شيء سليم');
process.exit(fail ? 1 : 0);
