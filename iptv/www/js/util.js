/* LiwaIPTV — أدوات نصية مشتركة: تطبيع البحث العربي، وتنظيف عناوين الأفلام
   والحلقات، وتنسيق الوقت. منطق خالص يعمل في المتصفح وفي Node للاختبار. */
'use strict';

/** تطبيع للبحث: يوحّد الألف والياء والتاء المربوطة ويحذف التشكيل والتطويل. */
export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** مطابقة كل كلمات الاستعلام (بأي ترتيب) داخل نص مُطبَّع مسبقًا. */
export function matches(normText, normQuery) {
  if (!normQuery) return true;
  for (const w of normQuery.split(' ')) if (w && !normText.includes(w)) return false;
  return true;
}

// بادئات يضعها المزوّدون قبل الاسم: "AR | ", "|AR| ", "[FHD] ", "VIP - "...
const PREFIX = /^\s*(?:[|[(【]?\s*(?:[A-Z]{2,3}|4K|UHD|FHD|HD|SD|VIP|MULTI|NF|OSN|SHAHID|AR|EN)\s*[|\])】:]\s*[-–:|]?\s*)+/i;

/**
 * يستخرج من اسم فيلم: العنوان النظيف والسنة والجودة.
 * "AR | The Batman (2022) [4K]" → { title: "The Batman", year: 2022, quality: "4K" }
 */
export function parseTitle(raw) {
  let s = String(raw || '').trim();
  let quality = '';
  const q = s.match(/\b(4K|UHD|2160p|1080p|720p|FHD|HD|SD|HEVC|H\.?265)\b/i);
  if (q) quality = q[1].toUpperCase().replace('2160P', '4K').replace('UHD', '4K');
  s = s.replace(PREFIX, '');
  let year = null;
  const y = s.match(/[([]?\b(19[3-9]\d|20[0-4]\d)\b[)\]]?/);
  if (y) {
    year = Number(y[1]);
    // السنة تُحذف فقط إن لم تكن هي العنوان كله ("1917")
    const without = s.replace(y[0], ' ').trim();
    if (without.replace(/[^\p{L}\p{N}]/gu, '')) s = without;
  }
  s = s
    .replace(/[[(](?:4K|UHD|FHD|HD|SD|HEVC|H\.?265|\d{3,4}p|MULTI[^\])]*|SUB[^\])]*|مترجم|مدبلج)[\])]/gi, ' ')
    .replace(/\b(?:4K|UHD|2160p|1080p|720p|FHD|HEVC|H\.?265)\b/gi, ' ')
    .replace(/\s*[-–|:]\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { title: s || String(raw || '').trim(), year, quality };
}

/**
 * يتعرّف على حلقة مسلسل من اسمها: "Breaking Bad S02E05" أو "المؤسس عثمان الموسم 3 الحلقة 12"
 * أو "Dark 1x04". يعيد null إن لم يكن الاسم لحلقة.
 */
export function parseEpisode(raw) {
  const s = String(raw || '').replace(PREFIX, '').trim();
  const pats = [
    /^(.*?)[\s._-]*S(\d{1,2})[\s._-]*E(\d{1,4})\b(.*)$/i,
    /^(.*?)[\s._-]+(\d{1,2})x(\d{1,3})\b(.*)$/i,
    /^(.*?)[\s._-]*(?:الموسم|موسم)\s*(\d{1,2})[\s._-]*(?:الحلقة|حلقة|ح)\s*(\d{1,4})(.*)$/,
    /^(.*?)[\s._-]*Season\s*(\d{1,2})[\s._-]*Episode\s*(\d{1,4})(.*)$/i,
  ];
  for (const re of pats) {
    const m = s.match(re);
    if (m && m[1].trim()) {
      return {
        series: m[1].replace(/[\s._-]+$/, '').trim(),
        season: Number(m[2]),
        episode: Number(m[3]),
        title: m[4].replace(/^[\s._:|-]+/, '').trim(),
      };
    }
  }
  // "المسلسل الحلقة 12" بلا موسم → الموسم 1
  const m = s.match(/^(.*?)[\s._-]*(?:الحلقة|حلقة|Episode|EP)\s*(\d{1,4})\b(.*)$/i);
  if (m && m[1].trim()) {
    return { series: m[1].replace(/[\s._-]+$/, '').trim(), season: 1, episode: Number(m[2]), title: m[3].replace(/^[\s._:|-]+/, '').trim() };
  }
  return null;
}

/** اسم المجموعة يدل على محتوى للكبار؟ (للقفل الأبوي) */
export function isAdult(name) {
  return /\b(xxx|adult|18\s*\+|\+\s*18|porn|for adults)\b|للكبار|بالغين/i.test(String(name || ''));
}

/** "1:02:05" أو "12:05" */
export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? h + ':' : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** "21:30" بتوقيت الجهاز */
export function clock(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "1 س 42 د" */
export function fmtDur(min) {
  min = Math.round(Number(min) || 0);
  if (!min) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} س ${m ? m + ' د' : ''}`.trim() : `${m} د`;
}

/** قراءة base64 بأمان (EPG في Xtream مرمَّز بـ base64 وبـ UTF-8). */
export function b64(s) {
  if (!s) return '';
  try {
    const bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary');
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch { return String(s); }
}

/** امتداد الرابط بلا معاملات الاستعلام: ".m3u8" / ".ts" / ".mp4" */
export function urlExt(url) {
  const m = String(url || '').split(/[?#]/)[0].match(/\.([a-z0-9]{2,5})$/i);
  return m ? m[1].toLowerCase() : '';
}

/** تجزئة سريعة ثابتة لنص (لمعرّفات عناصر M3U). */
export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
