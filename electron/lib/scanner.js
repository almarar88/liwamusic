'use strict';
/**
 * LiwaMusic — فهرسة مجلدات الموسيقى: مسح متكرر، قراءة الوسوم، استخراج الأغلفة،
 * كشف التكرار، والمسح التزايدي (يتخطى الملفات غير المتغيّرة).
 */
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const AUDIO_EXT = new Set([
  '.mp3', '.m4a', '.m4b', '.mp4', '.aac', '.flac', '.wav', '.wave',
  '.ogg', '.oga', '.opus', '.aiff', '.aif', '.wma', '.mpc', '.ape', '.wv',
]);

const SKIP_DIRS = new Set(['node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information']);

const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');
const trackId = (filePath) => hash(path.resolve(filePath).toLowerCase());

let mmPromise = null;
function loadMM() {
  if (!mmPromise) mmPromise = import('music-metadata');
  return mmPromise;
}

/** يمشي على شجرة المجلد ويعيد قائمة ملفات الصوت مع mtime/size. */
async function walk(root, out = [], depth = 0) {
  if (depth > 24) return out;
  let entries;
  try { entries = await fsp.readdir(root, { withFileTypes: true }); }
  catch { return out; }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      await walk(full, out, depth + 1);
    } else if (entry.isFile()) {
      if (!AUDIO_EXT.has(path.extname(entry.name).toLowerCase())) continue;
      try {
        const st = await fsp.stat(full);
        out.push({
          path: full,
          size: st.size,
          mtimeMs: Math.round(st.mtimeMs),
          birth: Math.round(st.birthtimeMs || st.mtimeMs),
        });
      } catch { /* ملف غير قابل للقراءة */ }
    }
  }
  return out;
}

function cleanString(v) {
  if (v == null) return '';
  // إزالة محارف التحكم المتسلّلة من الوسوم التالفة
  return String(v).replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

function titleFromFilename(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  return base.replace(/^\d{1,3}[\s._-]+/, '').replace(/_+/g, ' ').trim() || base;
}

/** يستخرج الغلاف المضمّن ويحفظه في الكاش، ويعيد اسم ملف الغلاف. */
async function saveArtwork(picture, artDir, key) {
  if (!picture || !picture.data) return null;
  const ext = String(picture.format || '').includes('png') ? '.png' : '.jpg';
  const name = `${hash(key)}${ext}`;
  const dest = path.join(artDir, name);
  try {
    await fsp.access(dest);
    return name;
  } catch { /* غير موجود بعد */ }
  try {
    const buf = Buffer.isBuffer(picture.data) ? picture.data : Buffer.from(picture.data);
    await fsp.writeFile(dest, buf);
    return name;
  } catch { return null; }
}

async function readTags(file, artDir) {
  const mm = await loadMM();
  const id = trackId(file.path);
  const fallbackTitle = titleFromFilename(file.path);
  const track = {
    id,
    path: file.path,
    folder: path.dirname(file.path),
    file: path.basename(file.path),
    ext: path.extname(file.path).toLowerCase().slice(1),
    size: file.size,
    mtimeMs: file.mtimeMs,
    addedAt: Date.now(),
    title: fallbackTitle,
    artist: '',
    albumArtist: '',
    album: '',
    genre: '',
    year: 0,
    trackNo: 0,
    discNo: 0,
    duration: 0,
    bitrate: 0,
    sampleRate: 0,
    channels: 0,
    codec: '',
    lossless: false,
    art: null,
    comment: '',
  };
  try {
    const meta = await mm.parseFile(file.path, { duration: true, skipCovers: false });
    const c = meta.common || {};
    const f = meta.format || {};
    track.title = cleanString(c.title) || fallbackTitle;
    track.artist = cleanString(c.artist) || cleanString((c.artists || [])[0]);
    track.albumArtist = cleanString(c.albumartist) || track.artist;
    track.album = cleanString(c.album);
    track.genre = cleanString((c.genre || [])[0]);
    track.year = Number(c.year) || 0;
    track.trackNo = Number(c.track && c.track.no) || 0;
    track.discNo = Number(c.disk && c.disk.no) || 0;
    const rawComment = Array.isArray(c.comment)
      ? ((c.comment[0] && c.comment[0].text) || c.comment[0])
      : c.comment;
    track.comment = cleanString(rawComment);
    track.duration = Math.round((f.duration || 0) * 1000) / 1000;
    track.bitrate = Math.round((f.bitrate || 0) / 1000);
    track.sampleRate = f.sampleRate || 0;
    track.channels = f.numberOfChannels || 0;
    track.codec = cleanString(f.codec || f.container);
    track.lossless = !!f.lossless;
    const pic = (c.picture || [])[0];
    if (pic) {
      const key = track.album ? `${track.albumArtist || track.artist}|${track.album}` : track.path;
      track.art = await saveArtwork(pic, artDir, key);
    }
  } catch (err) {
    track.error = String((err && err.message) || err).slice(0, 200);
  }
  return track;
}

/**
 * فهرسة مجموعة مجلدات.
 * @param {object} opts { folders, existing, artDir, onProgress, force }
 */
async function scanFolders(opts) {
  const { folders = [], existing = {}, artDir, onProgress = () => {}, force = false } = opts;
  await fsp.mkdir(artDir, { recursive: true });

  const seenPaths = new Set();
  const files = [];
  for (const folder of folders) {
    onProgress({ phase: 'walk', folder, found: files.length });
    const found = await walk(folder);
    for (const f of found) {
      const key = path.resolve(f.path).toLowerCase();
      if (seenPaths.has(key)) continue;
      seenPaths.add(key);
      files.push(f);
    }
  }

  const tracks = {};
  let added = 0; let updated = 0; let skipped = 0; let failed = 0;
  const total = files.length;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const id = trackId(f.path);
    const prev = existing[id];
    if (!force && prev && prev.mtimeMs === f.mtimeMs && prev.size === f.size) {
      tracks[id] = prev;
      skipped++;
    } else {
      const t = await readTags(f, artDir);
      if (prev) { t.addedAt = prev.addedAt || t.addedAt; updated++; } else { added++; }
      if (t.error) failed++;
      tracks[id] = t;
    }
    if (i % 15 === 0 || i === total - 1) {
      onProgress({ phase: 'index', done: i + 1, total, added, updated, skipped, failed, current: f.path });
    }
  }

  const removed = Object.keys(existing).filter((id) => !tracks[id]).length;
  return { tracks, stats: { total, added, updated, skipped, failed, removed } };
}

/** يجمع الأغاني المكررة (نفس العنوان + الفنان + مدة متقاربة). */
function findDuplicates(tracks) {
  const buckets = new Map();
  for (const t of Object.values(tracks)) {
    const title = (t.title || '').toLowerCase().trim();
    const artist = (t.artist || '').toLowerCase().trim();
    if (!title) continue;
    const key = `${title}|${artist}|${Math.round(t.duration || 0)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(t.id);
  }
  return [...buckets.values()].filter((ids) => ids.length > 1);
}

module.exports = { scanFolders, walk, readTags, trackId, findDuplicates, AUDIO_EXT, hash };
