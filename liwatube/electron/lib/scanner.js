'use strict';
/**
 * LiwaTube — فهرسة مجلدات الفيديو: مسح متكرر، اشتقاق العنوان والقناة من الملف والمجلد،
 * والمسح التزايدي (يتخطى الملفات غير المتغيّرة). المدة والأبعاد والصورة المصغّرة
 * تُستخرج لاحقًا في الواجهة عبر عنصر <video> (بلا ffmpeg).
 */
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const VIDEO_EXT = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.ogv', '.avi', '.ts', '.3gp', '.wmv', '.flv']);
/** الصيغ التي يشغّلها Chromium مباشرة؛ الباقي قد لا يعمل ويُعلَّم في الواجهة. */
const NATIVE_EXT = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.ogv']);

const SKIP_DIRS = new Set(['node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information']);

const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');
const videoId = (filePath) => hash(path.resolve(filePath).toLowerCase());
const channelId = (name) => `ch_${hash(String(name || '').trim().toLowerCase()).slice(0, 12)}`;

/** يمشي على شجرة المجلد ويعيد قائمة ملفات الفيديو مع mtime/size. */
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
      if (!VIDEO_EXT.has(path.extname(entry.name).toLowerCase())) continue;
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

/** عنوان نظيف من اسم الملف: يزيل الأرقام التسلسلية والدقّة والوسوم التقنية. */
function titleFromFilename(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  let t = base
    .replace(/[_.]+/g, ' ')
    .replace(/\b(1080p|2160p|720p|480p|4k|8k|x264|x265|h264|h265|hevc|hdr|web-?dl|bluray|webrip|hdrip|dvdrip|aac|ac3|yify|rarbg)\b/gi, ' ')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/^\d{1,3}\s*[-–.]\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return t || base;
}

/** يستخرج سنة من اسم الملف إن وُجدت (1900-2099). */
function yearFromFilename(filePath) {
  const m = /\b(19\d{2}|20\d{2})\b/.exec(path.basename(filePath));
  return m ? Number(m[1]) : 0;
}

/** يحدد اسم القناة: المجلد الأب مباشرة، أو المجلد الجذر المضاف. */
function channelFor(filePath, rootFolder, mode = 'parent') {
  const parent = path.basename(path.dirname(filePath));
  if (mode === 'root' && rootFolder) return path.basename(rootFolder) || parent;
  if (rootFolder && path.resolve(path.dirname(filePath)) === path.resolve(rootFolder)) {
    return path.basename(rootFolder) || parent;
  }
  return parent || 'بدون قناة';
}

function buildRecord(file, rootFolder, mode) {
  const ext = path.extname(file.path).toLowerCase();
  const channel = channelFor(file.path, rootFolder, mode);
  return {
    id: videoId(file.path),
    path: file.path,
    root: rootFolder || path.dirname(file.path),
    folder: path.dirname(file.path),
    file: path.basename(file.path),
    ext: ext.slice(1),
    native: NATIVE_EXT.has(ext),
    size: file.size,
    mtimeMs: file.mtimeMs,
    createdMs: file.birth || file.mtimeMs,
    addedAt: Date.now(),
    title: titleFromFilename(file.path),
    year: yearFromFilename(file.path),
    channel,
    channelId: channelId(channel),
    duration: 0,
    width: 0,
    height: 0,
    thumb: null,     // اسم ملف الصورة المصغّرة في الكاش
    probed: false,   // هل استُخرجت المدة/الأبعاد؟
  };
}

/**
 * يفهرس المجلدات المعطاة ويعيد الفهرس المحدّث.
 * @param {object} opts { folders, existing, channelMode, onProgress }
 */
async function scan({ folders, existing = {}, channelMode = 'parent', onProgress }) {
  const videos = {};
  const seen = new Set();
  let done = 0;
  let total = 0;
  const found = [];
  for (const folder of folders) {
    const files = await walk(folder);
    for (const f of files) found.push({ f, folder });
  }
  total = found.length;
  let added = 0; let updated = 0;
  for (const { f, folder } of found) {
    const id = videoId(f.path);
    if (seen.has(id)) continue;
    seen.add(id);
    const prev = existing[id];
    if (prev && prev.mtimeMs === f.mtimeMs && prev.size === f.size) {
      // غير متغيّر — نبقي البيانات المستخرجة سابقًا، ونحدّث القناة إن تغيّر النمط
      const channel = channelFor(f.path, folder, channelMode);
      videos[id] = { ...prev, root: folder, channel, channelId: channelId(channel), native: NATIVE_EXT.has(path.extname(f.path).toLowerCase()) };
    } else {
      const rec = buildRecord(f, folder, channelMode);
      if (prev) { rec.addedAt = prev.addedAt; updated++; } else added++;
      videos[id] = rec;
    }
    done++;
    if (onProgress && (done % 25 === 0 || done === total)) onProgress({ done, total });
  }
  const removed = Object.keys(existing).filter((id) => !videos[id]).length;
  return { videos, stats: { total, added, updated, removed } };
}

/** يجمع القنوات من الفهرس مع عدد الفيديوهات وأحدث إضافة. */
function channelsOf(videos) {
  const map = new Map();
  for (const v of Object.values(videos)) {
    const c = map.get(v.channelId) || { id: v.channelId, name: v.channel, count: 0, latest: 0, folders: new Set(), duration: 0 };
    c.count++;
    c.duration += v.duration || 0;
    c.latest = Math.max(c.latest, v.addedAt || 0, v.mtimeMs || 0);
    c.folders.add(v.folder);
    map.set(v.channelId, c);
  }
  return [...map.values()].map((c) => ({ ...c, folders: [...c.folders] })).sort((a, b) => b.count - a.count);
}

module.exports = {
  VIDEO_EXT, NATIVE_EXT, walk, scan, buildRecord, titleFromFilename, yearFromFilename,
  channelFor, channelId, videoId, channelsOf, hash,
};
