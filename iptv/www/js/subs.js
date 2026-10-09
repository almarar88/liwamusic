/* LiwaIPTV — الترجمة: تحويل SRT/ASS إلى WebVTT، وضبط التوقيت، والبحث في
   OpenSubtitles (اختياري بمفتاح API مجاني من opensubtitles.com). */
'use strict';

import { http } from './http.js';

const ts = (h, m, s, ms) => (+h) * 3600 + (+m) * 60 + (+s) + (+ms) / 1000;

function vttTime(sec) {
  sec = Math.max(0, sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(h)}:${p(m)}:${p(s)}.${p(ms === 1000 ? 999 : ms, 3)}`;
}

/** يحلل SRT أو VTT إلى مقاطع { start, end, text }. */
export function parseCues(text) {
  const src = String(text || '').replace(/^﻿/, '').replace(/\r/g, '');
  const cues = [];
  const re = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})[^\n]*\n([\s\S]*?)(?=\n{2,}|\n*$)/g;
  let m;
  while ((m = re.exec(src))) {
    const body = m[9].trim();
    if (!body) continue;
    cues.push({
      start: ts(m[1], m[2], m[3], m[4].padEnd(3, '0')),
      end: ts(m[5], m[6], m[7], m[8].padEnd(3, '0')),
      text: body,
    });
  }
  // صيغة VTT المختصرة mm:ss.mmm
  if (!cues.length) {
    const re2 = /(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2})\.(\d{3})[^\n]*\n([\s\S]*?)(?=\n{2,}|\n*$)/g;
    while ((m = re2.exec(src))) cues.push({ start: ts(0, m[1], m[2], m[3]), end: ts(0, m[4], m[5], m[6]), text: m[7].trim() });
  }
  return cues;
}

/** ASS/SSA → مقاطع (نص الحوار فقط، بلا الأنماط). */
export function parseASS(text) {
  const cues = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^Dialogue:\s*[^,]*,(\d+):(\d\d):(\d\d)\.(\d\d),(\d+):(\d\d):(\d\d)\.(\d\d),(?:[^,]*,){6}(.*)$/);
    if (!m) continue;
    const body = m[9].replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').trim();
    if (body) cues.push({ start: ts(m[1], m[2], m[3], m[4] + '0'), end: ts(m[5], m[6], m[7], m[8] + '0'), text: body });
  }
  return cues;
}

export function toCues(text, name = '') {
  return /\.(ass|ssa)$/i.test(name) || /^\[Script Info\]/m.test(text) ? parseASS(text) : parseCues(text);
}

/** مقاطع → نص WebVTT، مع إزاحة زمنية (ثوانٍ). */
export function toVTT(cues, offset = 0) {
  const out = ['WEBVTT', ''];
  for (const c of cues) {
    out.push(`${vttTime(c.start + offset)} --> ${vttTime(c.end + offset)}`, c.text, '');
  }
  return out.join('\n');
}

/** يفك ترميز ملف ترجمة: UTF-8 أولًا، وإن ظهرت رموز تالفة جرّب Windows-1256 (العربية القديمة). */
export function decodeSubtitle(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const utf = new TextDecoder('utf-8').decode(bytes);
  if (!utf.includes('�')) return utf;
  try { return new TextDecoder('windows-1256').decode(bytes); } catch { return utf; }
}

// ———————————————————————————— OpenSubtitles.com (REST v1)

const OS_API = 'https://api.opensubtitles.com/api/v1';

/** بحث بالعنوان (أو معرّف TMDB) بلغة أو أكثر "ar,en". */
export async function searchOpenSubtitles({ apiKey, query, tmdbId, season, episode, year, languages = 'ar,en' }) {
  if (!apiKey) throw new Error('أضف مفتاح OpenSubtitles من الإعدادات أولًا');
  const q = new URLSearchParams({ languages });
  if (tmdbId) q.set('tmdb_id', tmdbId); else q.set('query', query);
  if (season) q.set('season_number', season);
  if (episode) q.set('episode_number', episode);
  if (year && !tmdbId) q.set('year', year);
  const headers = { 'Api-Key': apiKey, 'User-Agent': 'LiwaIPTV v1.0', Accept: 'application/json' };
  const d = await http.json(`${OS_API}/subtitles?${q}`, { headers });
  return ((d && d.data) || []).map((s) => {
    const a = s.attributes || {};
    const f = (a.files || [])[0] || {};
    return {
      fileId: f.file_id, name: f.file_name || a.release || '', lang: a.language,
      downloads: a.download_count || 0, rating: a.ratings || 0, hi: !!a.hearing_impaired,
    };
  }).filter((s) => s.fileId);
}

/** رابط تنزيل مؤقت لملف ترجمة ثم محتواه. */
export async function downloadOpenSubtitles({ apiKey, fileId }) {
  const C = typeof window !== 'undefined' && window.Capacitor;
  const headers = { 'Api-Key': apiKey, 'User-Agent': 'LiwaIPTV v1.0', 'Content-Type': 'application/json', Accept: 'application/json' };
  let link;
  if (C && C.isNativePlatform && C.isNativePlatform()) {
    const res = await C.Plugins.CapacitorHttp.request({ url: `${OS_API}/download`, method: 'POST', headers, data: { file_id: fileId } });
    if (res.status >= 400) throw new Error(res.status === 406 ? 'تجاوزت حد التنزيل اليومي في OpenSubtitles' : `فشل التنزيل (${res.status})`);
    const d = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    link = d && d.link;
  } else {
    const res = await fetch(`${OS_API}/download`, { method: 'POST', headers, body: JSON.stringify({ file_id: fileId }) });
    if (!res.ok) throw new Error(`فشل التنزيل (${res.status})`);
    link = (await res.json()).link;
  }
  if (!link) throw new Error('لم يُرجع OpenSubtitles رابط التنزيل');
  return http.text(link);
}
