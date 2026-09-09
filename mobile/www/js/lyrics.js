/* كلمات الأغاني: قراءة ملفات LRC المتزامنة والنصّية العادية. */

/**
 * يحلّل نصّ LRC إلى أسطر مرتّبة زمنيًا.
 * يدعم [mm:ss.xx] و[mm:ss] وطوابع متعدّدة للسطر الواحد ووسوم [ar:] [ti:] [offset:].
 * يعيد { lines: [{ t, text }], meta, synced }.
 */
export function parseLRC(text) {
  const src = String(text || '');
  if (!src.trim()) return { lines: [], meta: {}, synced: false };
  const meta = {};
  const lines = [];
  let offset = 0;
  let sawStamp = false;

  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const tagOnly = /^\[(ar|ti|al|by|offset|length|re|ve):([^\]]*)\]$/i.exec(line);
    if (tagOnly) {
      const k = tagOnly[1].toLowerCase();
      const v = tagOnly[2].trim();
      meta[k] = v;
      if (k === 'offset') offset = (parseInt(v, 10) || 0) / 1000;
      continue;
    }

    const stamps = [];
    let rest = line;
    for (;;) {
      const m = /^\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/.exec(rest);
      if (!m) break;
      sawStamp = true;
      stamps.push(Number(m[1]) * 60 + parseFloat(String(m[2]).replace(':', '.')));
      rest = rest.slice(m[0].length);
    }
    const text2 = rest.trim();
    if (!stamps.length) {
      if (text2 && !/^\[.*\]$/.test(text2)) lines.push({ t: null, text: text2 });
      continue;
    }
    if (!text2) continue;
    for (const t of stamps) lines.push({ t: Math.max(0, t + offset), text: text2 });
  }

  const synced = sawStamp && lines.some((l) => l.t != null);
  const out = synced
    ? lines.filter((l) => l.t != null).sort((a, b) => a.t - b.t)
    : lines.map((l) => ({ t: null, text: l.text }));
  return { lines: out, meta, synced };
}

/** فهرس السطر الفعّال عند الثانية المعطاة، أو ‎-1‎ قبل أول سطر. */
export function activeLine(lines, seconds) {
  if (!Array.isArray(lines) || !lines.length || lines[0].t == null) return -1;
  let lo = 0; let hi = lines.length - 1; let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= seconds + 0.06) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** الاسم المتوقّع لملف الكلمات المجاور للأغنية في درايف. */
export function lrcNameFor(fileName) {
  const base = String(fileName || '').replace(/\.[a-z0-9]{1,5}$/i, '');
  return base ? `${base}.lrc` : '';
}
