'use strict';
/**
 * LiwaTube — الترجمات: البحث عن ملفات SRT/VTT المجاورة وتحويل SRT إلى WebVTT.
 */
const fsp = require('fs/promises');
const path = require('path');

const SUB_EXT = ['.vtt', '.srt'];

/** يحوّل نص SRT إلى WebVTT (وقت بفاصلة ← نقطة، مع رأس الملف). */
function srtToVtt(srt) {
  const text = String(srt || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const out = ['WEBVTT', ''];
  for (const block of blocks) {
    const lines = block.split('\n');
    if (/^\d+$/.test(lines[0] || '')) lines.shift();
    if (!lines.length) continue;
    const timing = lines[0].replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    if (!/-->/.test(timing)) continue;
    out.push(timing);
    out.push(...lines.slice(1));
    out.push('');
  }
  return `${out.join('\n')}\n`;
}

/** يعيد قائمة ملفات الترجمة المجاورة للفيديو: [{path, lang, label}]. */
async function findSidecars(videoPath) {
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath)).toLowerCase();
  let entries;
  try { entries = await fsp.readdir(dir); } catch { return []; }
  const out = [];
  for (const name of entries) {
    const ext = path.extname(name).toLowerCase();
    if (!SUB_EXT.includes(ext)) continue;
    const stem = path.basename(name, ext).toLowerCase();
    if (stem !== base && !stem.startsWith(`${base}.`)) continue;
    const langPart = stem.slice(base.length + 1);
    const lang = (langPart.split('.')[0] || '').slice(0, 8);
    out.push({
      path: path.join(dir, name),
      lang: lang || 'und',
      label: lang ? lang.toUpperCase() : (ext === '.vtt' ? 'VTT' : 'SRT'),
    });
  }
  return out;
}

/** يقرأ ملف ترجمة ويعيده كنص WebVTT دائمًا. */
async function readAsVtt(file) {
  const raw = await fsp.readFile(file, 'utf8');
  if (path.extname(file).toLowerCase() === '.vtt') return raw.replace(/^﻿/, '');
  return srtToVtt(raw);
}

module.exports = { srtToVtt, findSidecars, readAsVtt, SUB_EXT };
