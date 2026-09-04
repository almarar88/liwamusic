'use strict';
/**
 * LiwaMusic — قوائم التشغيل واستيراد/تصدير M3U8.
 */
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const newId = () => `pl_${crypto.randomBytes(6).toString('hex')}`;

function create({ name, description = '', tracks = [], ai = null }) {
  const now = Date.now();
  return {
    id: newId(),
    name: String(name || 'قائمة جديدة').slice(0, 80),
    description: String(description || '').slice(0, 400),
    tracks: [...tracks],
    ai,
    createdAt: now,
    updatedAt: now,
  };
}

/** يبني نص M3U8 من قائمة مسارات. */
function toM3U(tracks) {
  const lines = ['#EXTM3U', '# Created by LiwaMusic'];
  for (const t of tracks) {
    const secs = Math.round(t.duration || 0);
    const label = [t.artist, t.title].filter(Boolean).join(' - ') || t.file;
    lines.push(`#EXTINF:${secs},${label}`);
    lines.push(t.path);
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** يقرأ ملف M3U/M3U8 ويعيد مسارات مطلقة موجودة فعلًا. */
async function fromM3U(file) {
  const raw = await fsp.readFile(file, 'utf8');
  const base = path.dirname(file);
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const entry = line.trim();
    if (!entry || entry.startsWith('#')) continue;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(entry)) continue; // روابط بث غير مدعومة في الفهرس المحلي
    const abs = path.isAbsolute(entry) ? entry : path.resolve(base, entry);
    try {
      const st = await fsp.stat(abs);
      if (st.isFile()) out.push(abs);
    } catch { /* ملف مفقود */ }
  }
  return out;
}

module.exports = { create, toM3U, fromM3U, newId };
