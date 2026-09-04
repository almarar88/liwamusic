/**
 * LiwaMusic — اختبار ذاتي للوحدات التي لا تحتاج واجهة Electron.
 * يشغَّل بـ: npm test
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const scanner = require(path.join(root, 'electron/lib/scanner.js'));
const { Store } = require(path.join(root, 'electron/lib/store.js'));
const playlists = require(path.join(root, 'electron/lib/playlists.js'));
const filestream = require(path.join(root, 'electron/lib/filestream.js'));
const online = require(path.join(root, 'electron/lib/online.js'));
const { AI } = require(path.join(root, 'electron/lib/ai.js'));

let pass = 0; let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  \u2713 ${label}`); } else { fail++; console.log(`  \u2717 ${label}${extra ? ` — ${extra}` : ''}`); }
};
const section = (t) => console.log(`\n${t}`);

// ————————————————————————————————— توليد ملفات اختبار

function wavFile(seconds = 1, sampleRate = 44100) {
  const samples = Math.round(seconds * sampleRate);
  const dataSize = samples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);          // PCM
  buf.writeUInt16LE(1, 22);          // قناة واحدة
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(Math.round(Math.sin((i / sampleRate) * 2 * Math.PI * 440) * 1200), 44 + i * 2);
  }
  return buf;
}

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function id3TextFrame(id, text) {
  const body = Buffer.concat([Buffer.from([0x00]), Buffer.from(text, 'latin1'), Buffer.from([0x00])]);
  const head = Buffer.alloc(10);
  head.write(id, 0, 'latin1');
  head.writeUInt32BE(body.length, 4);
  return Buffer.concat([head, body]);
}

function id3PictureFrame(png) {
  const body = Buffer.concat([
    Buffer.from([0x00]),                 // ترميز
    Buffer.from('image/png\u0000', 'latin1'),
    Buffer.from([0x03]),                 // غلاف أمامي
    Buffer.from('\u0000', 'latin1'),     // وصف فارغ
    png,
  ]);
  const head = Buffer.alloc(10);
  head.write('APIC', 0, 'latin1');
  head.writeUInt32BE(body.length, 4);
  return Buffer.concat([head, body]);
}

function syncsafe(n) {
  return Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
}

function mp3File(tags) {
  const frames = Buffer.concat([
    id3TextFrame('TIT2', tags.title),
    id3TextFrame('TPE1', tags.artist),
    id3TextFrame('TALB', tags.album),
    id3TextFrame('TCON', tags.genre),
    id3TextFrame('TYER', String(tags.year)),
    id3TextFrame('TRCK', String(tags.track)),
    id3PictureFrame(PNG_1PX),
  ]);
  const header = Buffer.concat([
    Buffer.from('ID3', 'latin1'), Buffer.from([0x03, 0x00, 0x00]), syncsafe(frames.length),
  ]);
  // إطارات MPEG-1 Layer III صامتة: 128kbps / 44.1kHz → 417 بايت للإطار
  const frameCount = 40;
  const mpeg = Buffer.alloc(417 * frameCount);
  for (let i = 0; i < frameCount; i++) {
    const off = i * 417;
    mpeg[off] = 0xff; mpeg[off + 1] = 0xfb; mpeg[off + 2] = 0x90; mpeg[off + 3] = 0x64;
  }
  return Buffer.concat([header, frames, mpeg]);
}

// ————————————————————————————————— تشغيل الاختبارات

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'liwamusic-test-'));
const musicDir = path.join(tmp, 'Music');
const subDir = path.join(musicDir, 'Album One');
const artDir = path.join(tmp, 'artwork');
const dataDir = path.join(tmp, 'data');
await fsp.mkdir(subDir, { recursive: true });

const MP3_TAGS = { title: 'Liwa Test Track', artist: 'Liwa Artist', album: 'Liwa Album', genre: 'Ambient', year: 2021, track: 3 };
await fsp.writeFile(path.join(subDir, 'tagged.mp3'), mp3File(MP3_TAGS));
await fsp.writeFile(path.join(subDir, '01 - silent song.wav'), wavFile(1.5));
await fsp.writeFile(path.join(musicDir, 'loose.wav'), wavFile(0.7));
await fsp.writeFile(path.join(musicDir, 'notes.txt'), 'ليس ملف صوت');
await fsp.mkdir(path.join(musicDir, '.hidden'), { recursive: true });
await fsp.writeFile(path.join(musicDir, '.hidden', 'skip.wav'), wavFile(0.5));

section('1) الفهرسة');
const scan1 = await scanner.scanFolders({ folders: [musicDir], existing: {}, artDir });
const tracks1 = Object.values(scan1.tracks);
ok(tracks1.length === 3, `فهرسة 3 ملفات صوتية (وتجاهل النصوص والمجلدات المخفية) — وُجد ${tracks1.length}`);
const mp3 = tracks1.find((t) => t.ext === 'mp3');
ok(!!mp3, 'تم العثور على ملف MP3');
ok(mp3 && mp3.title === MP3_TAGS.title, `قراءة العنوان من الوسوم — "${mp3 && mp3.title}"`);
ok(mp3 && mp3.artist === MP3_TAGS.artist, `قراءة الفنان — "${mp3 && mp3.artist}"`);
ok(mp3 && mp3.album === MP3_TAGS.album, `قراءة الألبوم — "${mp3 && mp3.album}"`);
ok(mp3 && mp3.year === 2021, `قراءة السنة — ${mp3 && mp3.year}`);
ok(mp3 && mp3.trackNo === 3, `قراءة رقم المقطع — ${mp3 && mp3.trackNo}`);
ok(!!(mp3 && mp3.art) && fs.existsSync(path.join(artDir, mp3.art)), 'استخراج الغلاف المضمّن وحفظه في الكاش');
const wav = tracks1.find((t) => t.file === 'loose.wav');
ok(wav && Math.abs(wav.duration - 0.7) < 0.05, `حساب مدة WAV — ${wav && wav.duration}s`);
ok(wav && wav.title === 'loose', `اشتقاق العنوان من اسم الملف — "${wav && wav.title}"`);
ok(tracks1.every((t) => !t.error), 'لا أخطاء في قراءة أي ملف');

section('2) المسح التزايدي');
const scan2 = await scanner.scanFolders({ folders: [musicDir], existing: scan1.tracks, artDir });
ok(scan2.stats.skipped === 3 && scan2.stats.added === 0, `تخطّي الملفات غير المتغيّرة — skipped=${scan2.stats.skipped} added=${scan2.stats.added}`);
await fsp.writeFile(path.join(musicDir, 'new-one.wav'), wavFile(0.4));
const scan3 = await scanner.scanFolders({ folders: [musicDir], existing: scan2.tracks, artDir });
ok(scan3.stats.added === 1 && Object.keys(scan3.tracks).length === 4, `التقاط الملف الجديد — added=${scan3.stats.added}`);
const scan4 = await scanner.scanFolders({ folders: [musicDir], existing: scan3.tracks, artDir, force: true });
ok(scan4.stats.updated === 4 && scan4.stats.skipped === 0, `الفهرسة الكاملة تعيد قراءة كل شيء — updated=${scan4.stats.updated}`);
await fsp.rm(path.join(musicDir, 'new-one.wav'));
const scan5 = await scanner.scanFolders({ folders: [musicDir], existing: scan4.tracks, artDir });
ok(scan5.stats.removed === 1, `حذف المفقود من الفهرس — removed=${scan5.stats.removed}`);

section('3) كشف التكرار');
await fsp.copyFile(path.join(subDir, 'tagged.mp3'), path.join(musicDir, 'tagged-copy.mp3'));
const scan6 = await scanner.scanFolders({ folders: [musicDir], existing: {}, artDir });
const dups = scanner.findDuplicates(scan6.tracks);
ok(dups.length === 1 && dups[0].length === 2, `مجموعة مكررة واحدة من ملفين — ${JSON.stringify(dups.map((d) => d.length))}`);

section('4) التخزين المحلي');
const store = new Store(dataDir);
const settings = store.read('settings.json');
ok(settings.eqGains.length === 10 && settings.lang === 'ar', 'القيم الافتراضية للإعدادات');
settings.volume = 0.42;
store.write('settings.json', settings);
await store.flushAll();
const store2 = new Store(dataDir);
ok(store2.read('settings.json').volume === 0.42, 'حفظ واسترجاع الإعدادات من القرص');
ok(store2.read('settings.json').crossfade === 0, 'دمج المفاتيح الناقصة مع الافتراضيات');
const lib = store2.read('library.json');
lib.tracks = scan6.tracks;
lib.folders = [musicDir];
store2.write('library.json', lib);
await store2.flushAll();
ok(Object.keys(new Store(dataDir).read('library.json').tracks).length === 4, 'حفظ فهرس المكتبة');

section('5) قوائم التشغيل و M3U');
const list = Object.values(scan6.tracks).slice(0, 3);
const m3uPath = path.join(tmp, 'test.m3u8');
await fsp.writeFile(m3uPath, playlists.toM3U(list), 'utf8');
const back = await playlists.fromM3U(m3uPath);
ok(back.length === 3, `دورة تصدير/استيراد M3U كاملة — ${back.length}/3`);
ok(back.every((p) => fs.existsSync(p)), 'كل المسارات المستوردة موجودة فعلًا');
const m3uText = await fsp.readFile(m3uPath, 'utf8');
ok(m3uText.startsWith('#EXTM3U') && m3uText.includes('Created by LiwaMusic'), 'ترويسة M3U صحيحة وتحمل توقيع LiwaMusic');
const pl = playlists.create({ name: 'قائمة', tracks: list.map((t) => t.id) });
ok(pl.id.startsWith('pl_') && pl.tracks.length === 3, 'إنشاء قائمة تشغيل');

section('6) بروتوكول الملفات (Range)');
ok(JSON.stringify(filestream.parseRange('bytes=0-99', 1000)) === '{"start":0,"end":99}', 'تحليل bytes=0-99');
ok(JSON.stringify(filestream.parseRange('bytes=500-', 1000)) === '{"start":500,"end":999}', 'تحليل bytes=500-');
ok(JSON.stringify(filestream.parseRange('bytes=-200', 1000)) === '{"start":800,"end":999}', 'تحليل bytes=-200 (اللاحقة)');
ok(filestream.parseRange('bytes=2000-3000', 1000) === 'invalid', 'رفض نطاق خارج حدود الملف');
ok(filestream.parseRange(null, 1000) === null, 'بدون ترويسة Range');

const audioPath = path.join(subDir, 'tagged.mp3');
const size = (await fsp.stat(audioPath)).size;
const full = await filestream.serveFile(audioPath, null);
ok(full.status === 200 && full.headers.get('content-type') === 'audio/mpeg', `استجابة كاملة 200 — ${full.status} ${full.headers.get('content-type')}`);
ok(full.headers.get('accept-ranges') === 'bytes', 'إعلان دعم Range');
const partial = await filestream.serveFile(audioPath, 'bytes=10-19');
const bytes = Buffer.from(await partial.arrayBuffer());
const expected = (await fsp.readFile(audioPath)).subarray(10, 20);
ok(partial.status === 206 && bytes.equals(expected), `استجابة جزئية 206 بالبايتات الصحيحة — ${partial.status}`);
ok(partial.headers.get('content-range') === `bytes 10-19/${size}`, `ترويسة Content-Range — ${partial.headers.get('content-range')}`);
const bad = await filestream.serveFile(audioPath, 'bytes=999999999-');
ok(bad.status === 416, `رفض النطاق غير الصالح بـ416 — ${bad.status}`);
const missing = await filestream.serveFile(path.join(tmp, 'nope.mp3'), null);
ok(missing.status === 404, 'ملف غير موجود → 404');
const roundTrip = filestream.decodePath(filestream.encodePath('C:\\Users\\علي\\موسيقى\\أغنية.mp3'));
ok(roundTrip === 'C:\\Users\\علي\\موسيقى\\أغنية.mp3', 'ترميز/فك ترميز مسار ويندوز بالعربية');

section('7) كلمات LRC');
const lrc = online.parseLRC('[00:12.50]السطر الأول\n[01:05.20]السطر الثاني\n[بدون وقت]تجاهل');
ok(lrc.length === 2, `استخراج سطرين موقّتين — ${lrc.length}`);
ok(Math.abs(lrc[0].time - 12.5) < 0.001 && lrc[0].text === 'السطر الأول', `توقيت السطر الأول — ${lrc[0] && lrc[0].time}`);
ok(Math.abs(lrc[1].time - 65.2) < 0.001, `توقيت السطر الثاني — ${lrc[1] && lrc[1].time}`);
ok(online.parseLRC('').length === 0, 'نص فارغ يعيد قائمة فارغة');

section('8) مساعدات الذكاء الاصطناعي');
ok(AI.extractJSON('نص قبل {"a":1,"b":[2,3]} نص بعد').a === 1, 'استخراج JSON من نص محيط');
ok(AI.extractJSON('```json\n{"x":"}"}\n```').x === '}', 'تجاهل الأقواس داخل السلاسل النصية');
ok(Array.isArray(AI.extractJSON('[{"i":0}]')), 'استخراج مصفوفة JSON');
ok(AI.extractJSON('لا يوجد JSON هنا') === null, 'إرجاع null عند غياب JSON');
const catalog = AI.buildCatalog(scan6.tracks, { favorites: {}, playCount: {}, ai: {} }, 10);
ok(catalog.map.length === 4 && catalog.text.split('\n').length === 4, `بناء فهرس مضغوط للنموذج — ${catalog.map.length} صفوف`);
ok(/^0 \| /.test(catalog.text), 'ترقيم الصفوف يبدأ من صفر (لتوفير الرموز)');
ok(catalog.map.every((id) => !!scan6.tracks[id]), 'كل معرّف في الفهرس يقابل أغنية حقيقية');

section('9) سلامة الملفات');
for (const rel of ['electron/main.js', 'electron/preload.js', 'renderer/index.html', 'renderer/css/app.css',
  'renderer/js/app.js', 'renderer/js/player.js', 'renderer/js/views.js', 'renderer/js/panels.js',
  'renderer/js/util.js', 'renderer/js/i18n.js']) {
  ok(fs.existsSync(path.join(root, rel)), `موجود: ${rel}`);
}
const html = await fsp.readFile(path.join(root, 'renderer/index.html'), 'utf8');
for (const src of ['js/util.js', 'js/i18n.js', 'js/player.js', 'js/views.js', 'js/panels.js', 'js/app.js', 'css/app.css']) {
  ok(html.includes(src), `مربوط في index.html: ${src}`);
}
ok(html.includes('LiwaMusic'), 'توقيع LiwaMusic موجود في الواجهة');

await fsp.rm(tmp, { recursive: true, force: true });
console.log(`\nالنتيجة: ${pass} ناجح، ${fail} فاشل`);
process.exit(fail ? 1 : 0);
