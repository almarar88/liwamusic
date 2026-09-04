'use strict';
/**
 * LiwaMusic — خدمة الملفات المحلية عبر بروتوكول liwa:// مع دعم Range.
 * مفصولة عن main.js لتكون قابلة للاختبار خارج Electron.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Readable } = require('stream');

const MIME = {
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.m4b': 'audio/mp4', '.mp4': 'audio/mp4',
  '.aac': 'audio/aac', '.flac': 'audio/flac', '.wav': 'audio/wav', '.wave': 'audio/wav',
  '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff', '.wma': 'audio/x-ms-wma', '.mpc': 'audio/musepack', '.ape': 'audio/x-ape',
  '.wv': 'audio/wavpack', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif',
};

const encodePath = (p) => Buffer.from(p, 'utf8').toString('base64url');
const decodePath = (s) => Buffer.from(String(s), 'base64url').toString('utf8');

/** يحلّل ترويسة Range ويعيد {start,end} أو null، أو 'invalid'. */
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m) return null;
  if (!m[1] && !m[2]) return 'invalid';
  let start; let end;
  if (!m[1]) {
    const len = Number(m[2]);
    if (!len) return 'invalid';
    start = Math.max(0, size - len);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return 'invalid';
  return { start, end };
}

/**
 * يبني استجابة Response لملف محلي.
 * @param {string} filePath المسار المطلق
 * @param {string|null} rangeHeader قيمة ترويسة Range إن وُجدت
 */
async function serveFile(filePath, rangeHeader) {
  let st;
  try { st = await fsp.stat(filePath); } catch { return new Response('Not found', { status: 404 }); }
  if (!st.isFile()) return new Response('Not found', { status: 404 });

  const headers = {
    'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
  };

  const range = parseRange(rangeHeader, st.size);
  if (range === 'invalid') {
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${st.size}` } });
  }
  if (range) {
    const stream = fs.createReadStream(filePath, { start: range.start, end: range.end });
    return new Response(Readable.toWeb(stream), {
      status: 206,
      headers: {
        ...headers,
        'Content-Range': `bytes ${range.start}-${range.end}/${st.size}`,
        'Content-Length': String(range.end - range.start + 1),
      },
    });
  }
  const stream = fs.createReadStream(filePath);
  return new Response(Readable.toWeb(stream), {
    status: 200,
    headers: { ...headers, 'Content-Length': String(st.size) },
  });
}

module.exports = { serveFile, parseRange, encodePath, decodePath, MIME };
