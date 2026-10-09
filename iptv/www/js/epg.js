/* LiwaIPTV — دليل البرامج XMLTV (لقوائم M3U ولمن يريد الدليل الكامل).
   محلل خفيف بالتعابير النمطية يتحمل الملفات الكبيرة: يحتفظ فقط بالقنوات
   المطلوبة وبنافذة زمنية حول الآن. */
'use strict';

/** "20240115200000 +0300" → ميلي ثانية */
export function xmltvTime(s) {
  const m = String(s || '').match(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?\s*([+-]\d{4})?/);
  if (!m) return NaN;
  const [, y, mo, d, h, mi, se = '00', tz] = m;
  let t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
  if (tz) {
    const sign = tz[0] === '-' ? -1 : 1;
    t -= sign * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5))) * 60000;
  }
  return t;
}

const unxml = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&')
  .trim();

const keyOf = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');

/**
 * يحلل XMLTV ويعيد Map: معرّف القناة (مطبّع) → برامج مرتبة.
 * wanted: Set بمعرّفات القنوات المطبّعة (اختياري)، والنافذة بالساعات.
 */
export function parseXMLTV(xml, { wanted = null, now = Date.now(), pastHours = 24, futureHours = 36 } = {}) {
  const from = now - pastHours * 3600e3;
  const to = now + futureHours * 3600e3;
  const out = new Map();
  const names = new Map(); // اسم القناة المعروض → المعرّف (لمطابقة tvg-name)
  const chRe = /<channel\s+id="([^"]*)"[^>]*>([\s\S]*?)<\/channel>/g;
  let m;
  while ((m = chRe.exec(xml))) {
    const dn = m[2].match(/<display-name[^>]*>([\s\S]*?)<\/display-name>/);
    if (dn) names.set(keyOf(unxml(dn[1])), keyOf(m[1]));
  }
  const pRe = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
  while ((m = pRe.exec(xml))) {
    const attrs = m[1];
    const ch = keyOf((attrs.match(/channel="([^"]*)"/) || [])[1]);
    if (wanted && !wanted.has(ch)) continue;
    const start = xmltvTime((attrs.match(/start="([^"]*)"/) || [])[1]);
    const end = xmltvTime((attrs.match(/stop="([^"]*)"/) || [])[1]);
    if (!(end > from && start < to)) continue;
    const body = m[2];
    const title = unxml((body.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1]);
    const desc = unxml((body.match(/<desc[^>]*>([\s\S]*?)<\/desc>/) || [])[1]);
    let list = out.get(ch);
    if (!list) out.set(ch, (list = []));
    list.push({ title, desc, start, end });
  }
  for (const list of out.values()) list.sort((a, b) => a.start - b.start);
  return { programmes: out, names };
}

/** البرامج لقناة: يطابق tvg-id أولًا ثم الاسم المعروض. */
export function lookup(epg, item) {
  if (!epg) return [];
  const id = keyOf(item.epgId);
  if (id && epg.programmes.has(id)) return epg.programmes.get(id);
  const byName = epg.names.get(keyOf(item.epgId)) || epg.names.get(keyOf(item.name));
  return (byName && epg.programmes.get(byName)) || [];
}

/** البرنامج الحالي والتالي من قائمة مرتبة. */
export function nowNext(list, now = Date.now()) {
  const i = list.findIndex((p) => p.start <= now && p.end > now);
  if (i === -1) {
    const next = list.find((p) => p.start > now);
    return { now: null, next: next || null };
  }
  return { now: list[i], next: list[i + 1] || null };
}

/** نسبة تقدم البرنامج الحالي (0..1). */
export function progress(p, now = Date.now()) {
  if (!p) return 0;
  return Math.min(1, Math.max(0, (now - p.start) / (p.end - p.start)));
}
