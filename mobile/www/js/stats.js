/* إحصاءات الاستماع: الهدف اليومي، السلسلة، وتجميع الأسبوع. */

export const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const DAY_SHORT = ['أحد', 'إثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'];

/** مفتاح اليوم بصيغة YYYY-MM-DD بالتوقيت المحلي. */
export function dayKey(d = new Date()) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

/** بداية أسبوع التاريخ (الأحد) بعد إزاحة أسابيع. */
export function weekStart(date = new Date(), shiftWeeks = 0) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay() + shiftWeeks * 7);
  return d;
}

/** الأيام السبعة للأسبوع مع الدقائق المسموعة ونسبة الهدف. */
export function weekDays(listen = {}, goalMin = 30, shiftWeeks = 0, now = new Date()) {
  const start = weekStart(now, shiftWeeks);
  const todayK = dayKey(now);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = dayKey(d);
    const minutes = Math.round((listen[key] || 0) / 60000);
    out.push({
      date: d,
      key,
      dow: i,
      name: DAY_SHORT[i],
      minutes,
      pct: goalMin > 0 ? Math.min(1, minutes / goalMin) : 0,
      today: key === todayK,
      future: d > now && key !== todayK,
    });
  }
  return out;
}

/** عدد الأيام المتتالية (حتى اليوم أو أمس) التي بلغت الهدف. */
export function streak(listen = {}, goalMin = 30, now = new Date()) {
  const goalMs = goalMin * 60000;
  const cur = new Date(now);
  cur.setHours(0, 0, 0, 0);
  if ((listen[dayKey(cur)] || 0) < goalMs) cur.setDate(cur.getDate() - 1);
  let n = 0;
  for (;;) {
    if ((listen[dayKey(cur)] || 0) < goalMs) break;
    n++;
    cur.setDate(cur.getDate() - 1);
    if (n > 3650) break;
  }
  return n;
}

/** مجاميع الأسبوع: الدقائق، المتوسّط، الأيام المكتملة. */
export function weekTotals(days = []) {
  const past = days.filter((d) => !d.future);
  const minutes = past.reduce((s, d) => s + d.minutes, 0);
  return {
    minutes,
    avg: past.length ? Math.round(minutes / past.length) : 0,
    done: past.filter((d) => d.pct >= 1).length,
    best: past.reduce((m, d) => Math.max(m, d.minutes), 0),
  };
}

/** جلسات اليوم من السجلّ: يجمع التشغيلات المتقاربة لكل مقطع. */
export function todaySessions(history = [], now = new Date()) {
  const key = dayKey(now);
  const items = history.filter((h) => h && h.at && dayKey(new Date(h.at)) === key);
  const byId = new Map();
  for (const h of items) {
    const cur = byId.get(h.id) || { id: h.id, plays: 0, first: h.at, last: h.at, ms: 0 };
    cur.plays++;
    cur.first = Math.min(cur.first, h.at);
    cur.last = Math.max(cur.last, h.at);
    cur.ms += h.ms || 0;
    byId.set(h.id, cur);
  }
  return [...byId.values()].sort((a, b) => b.last - a.last);
}

/** الفنان/الألبوم الأكثر استماعًا خلال آخر N يومًا. */
export function topBy(history = [], byId = new Map(), field = 'artist', days = 7, now = new Date()) {
  const since = now.getTime() - days * 86400000;
  const tally = new Map();
  for (const h of history) {
    if (!h || h.at < since) continue;
    const t = byId.get ? byId.get(h.id) : null;
    const v = t && t[field];
    if (!v) continue;
    tally.set(v, (tally.get(v) || 0) + 1);
  }
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? { name: top[0], count: top[1] } : null;
}

/** يضيف مدّة استماع لليوم الحالي داخل خريطة الأيام (تُعدَّل موضعيًا). */
export function addListen(listen, ms, now = new Date()) {
  if (!(ms > 0)) return listen;
  const k = dayKey(now);
  listen[k] = (listen[k] || 0) + ms;
  // نحتفظ بسنة واحدة فقط كي لا ينتفخ التخزين
  const keys = Object.keys(listen).sort();
  while (keys.length > 400) delete listen[keys.shift()];
  return listen;
}
