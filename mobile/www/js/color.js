/* استخراج لوحة ألوان من غلاف الأغنية لتلوين الواجهة ديناميكيًا. */

/** يحوّل RGB إلى HSL (قيم 0..1 عدا الدرجة 0..360). */
export function rgbToHsl(r, g, b) {
  const R = r / 255; const G = g / 255; const B = b / 255;
  const mx = Math.max(R, G, B); const mn = Math.min(R, G, B);
  const l = (mx + mn) / 2;
  let h = 0; let s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === R) h = ((G - B) / d + (G < B ? 6 : 0));
    else if (mx === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

export function hslCss({ h, s, l }) {
  return `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}

/**
 * يجمع البكسلات في صناديق لونية ويعيد أبرز الدرجات.
 * يتجاهل الرمادي شبه المحايد والأطراف شديدة الظلمة أو الإضاءة.
 */
export function paletteFromPixels(data, step = 4) {
  const bins = new Map();
  for (let i = 0; i < data.length; i += 4 * step) {
    const a = data[i + 3];
    if (a < 200) continue;
    const { h, s, l } = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    if (l < 0.12 || l > 0.94) continue;
    if (s < 0.14) continue;
    const key = `${Math.round(h / 24)}|${Math.round(s * 3)}|${Math.round(l * 3)}`;
    const cur = bins.get(key) || { n: 0, h: 0, s: 0, l: 0 };
    cur.n++; cur.h += h; cur.s += s; cur.l += l;
    bins.set(key, cur);
  }
  const out = [...bins.values()]
    .map((b) => ({ n: b.n, h: b.h / b.n, s: b.s / b.n, l: b.l / b.n }))
    // نرجّح التكرار مع دفعة للألوان المشبعة كي لا يفوز رمادي باهت بحكم العدد
    .sort((a, b) => (b.n * (0.55 + b.s)) - (a.n * (0.55 + a.s)));
  return out.slice(0, 5);
}

/** ثلاثة ألوان متدرّجة (فاتح ← متوسط ← غامق) صالحة للخلفية والبطاقات. */
export function rampFrom(palette) {
  const base = palette[0] || { h: 288, s: 0.34, l: 0.55 };
  const alt = palette[1] || { h: (base.h + 34) % 360, s: base.s, l: base.l };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  return {
    c1: hslCss({ h: base.h, s: clamp(base.s + 0.14, 0.34, 0.80), l: clamp(base.l + 0.22, 0.62, 0.80) }),
    c2: hslCss({ h: alt.h, s: clamp(alt.s + 0.06, 0.26, 0.66), l: clamp(alt.l - 0.04, 0.38, 0.56) }),
    c3: hslCss({ h: (base.h + 350) % 360, s: clamp(base.s, 0.22, 0.52), l: clamp(base.l - 0.26, 0.18, 0.34) }),
  };
}

/** يقرأ صورة (blob URL) ويعيد التدرّج الثلاثي، أو null عند التعذّر. */
export async function rampFromImage(url, size = 40) {
  try {
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = url;
    });
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0, size, size);
    const { data } = cx.getImageData(0, 0, size, size);
    return rampFrom(paletteFromPixels(data, 1));
  } catch { return null; }
}

/** يطبّق التدرّج على متغيّرات CSS في جذر الصفحة. */
export function applyRamp(ramp) {
  const root = document.documentElement.style;
  if (!ramp) {
    root.removeProperty('--hero-1'); root.removeProperty('--hero-2'); root.removeProperty('--hero-3');
    root.removeProperty('--h1'); root.removeProperty('--h2'); root.removeProperty('--h3');
    return;
  }
  root.setProperty('--hero-1', ramp.c1);
  root.setProperty('--hero-2', ramp.c2);
  root.setProperty('--hero-3', ramp.c3);
  root.setProperty('--h1', ramp.c1);
  root.setProperty('--h2', ramp.c2);
  root.setProperty('--h3', ramp.c3);
}
