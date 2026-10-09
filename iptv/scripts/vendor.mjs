/**
 * LiwaIPTV — نسخ مكتبات تشغيل البث (hls.js و mpegts.js) إلى www/vendor.
 * تُحفظ النسخ في المستودع حتى يعمل التطبيق بلا خطوة بناء؛ شغّل هذا بعد ترقيتها.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'www/vendor');
fs.mkdirSync(out, { recursive: true });
for (const [from, to] of [
  ['node_modules/hls.js/dist/hls.min.js', 'hls.min.js'],
  ['node_modules/mpegts.js/dist/mpegts.js', 'mpegts.js'],
]) {
  let src = fs.readFileSync(path.join(root, from), 'utf8');
  src = src.replace(/\n\/\/# sourceMappingURL=.*\s*$/, '\n');
  fs.writeFileSync(path.join(out, to), src);
  console.log('✓', to, `${(src.length / 1024).toFixed(0)} KB`);
}
