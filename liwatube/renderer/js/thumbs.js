/* LiwaTube — استخراج المدة والأبعاد والصور المصغّرة والإطارات عبر <video> (بلا ffmpeg). */
'use strict';
(function (LT) {
  const THUMB_W = 480;
  const FRAME_W = 640;
  const NAT_TIMEOUT = 15000;

  function makeVideo(url) {
    const v = document.createElement('video');
    v.muted = true; v.preload = 'metadata'; v.playsInline = true; v.crossOrigin = 'anonymous';
    v.src = url;
    return v;
  }
  const once = (el, ev, timeout) => new Promise((res, rej) => {
    const tm = setTimeout(() => { cleanup(); rej(new Error('TIMEOUT')); }, timeout);
    const okf = () => { cleanup(); res(); };
    const bad = () => { cleanup(); rej(new Error('MEDIA_ERROR')); };
    const cleanup = () => { clearTimeout(tm); el.removeEventListener(ev, okf); el.removeEventListener('error', bad); };
    el.addEventListener(ev, okf, { once: true });
    el.addEventListener('error', bad, { once: true });
  });

  /** بعض ملفات WebM (المسجّلة/المبثوثة) لا تحمل المدة؛ القفز إلى ما بعد النهاية يجبر المتصفح على حسابها. */
  async function fixDuration(v) {
    if (Number.isFinite(v.duration)) return v.duration;
    try {
      v.currentTime = 1e101;
      await once(v, 'durationchange', 8000);
      await new Promise((r) => setTimeout(r, 50));
      v.currentTime = 0;
      await once(v, 'seeked', 8000).catch(() => {});
    } catch { /* نبقي 0 */ }
    return Number.isFinite(v.duration) ? v.duration : 0;
  }

  /** يقرأ المدة والأبعاد. */
  async function probe(url) {
    const v = makeVideo(url);
    try {
      await once(v, 'loadedmetadata', NAT_TIMEOUT);
      const duration = await fixDuration(v);
      return { duration, width: v.videoWidth, height: v.videoHeight };
    } finally { v.removeAttribute('src'); v.load(); }
  }

  async function seekTo(v, t) {
    v.currentTime = Math.max(0, Math.min(t, (v.duration || t) - 0.1));
    await once(v, 'seeked', NAT_TIMEOUT);
  }
  function draw(v, width, quality = 0.82) {
    const scale = Math.min(1, width / (v.videoWidth || width));
    const c = document.createElement('canvas');
    c.width = Math.round((v.videoWidth || width) * scale);
    c.height = Math.round((v.videoHeight || width * 9 / 16) * scale);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  }
  const dataUrlToBuf = async (d) => {
    const bin = atob(d.slice(d.indexOf(',') + 1));
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr.buffer;
  };
  const dataUrlToB64 = (d) => d.slice(d.indexOf(',') + 1);
  /** يتحقق أن الإطار ليس أسود بالكامل (إن أمكن). */
  function isDark(v) {
    try {
      const c = document.createElement('canvas'); c.width = 32; c.height = 18;
      const ctx = c.getContext('2d'); ctx.drawImage(v, 0, 0, 32, 18);
      const d = ctx.getImageData(0, 0, 32, 18).data; let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
      return sum / (d.length / 4 * 3) < 18;
    } catch { return false; }
  }

  /** يلتقط صورة مصغّرة عند وقت معيّن (أو وقت ذكي: 20% من المدة بحد 10 ثوانٍ مع تجنّب الإطارات السوداء). */
  async function capture(url, { at = null, duration = 0, width = THUMB_W } = {}) {
    const v = makeVideo(url);
    try {
      await once(v, 'loadedmetadata', NAT_TIMEOUT);
      const dur = (await fixDuration(v)) || duration;
      let t = at != null ? at : Math.min(10, dur * 0.2);
      await seekTo(v, t);
      let tries = 0;
      while (at == null && isDark(v) && tries < 4 && dur > 2) { tries++; t = Math.min(dur - 0.5, t + Math.max(2, dur * 0.15)); await seekTo(v, t); }
      return { at: v.currentTime, dataUrl: draw(v, width), width: v.videoWidth, height: v.videoHeight, duration: dur };
    } finally { v.removeAttribute('src'); v.load(); }
  }

  /** يلتقط n إطارات موزّعة على المدة لإرسالها إلى الذكاء الاصطناعي. */
  async function captureFrames(url, n = 8, { width = FRAME_W, onProgress } = {}) {
    const v = makeVideo(url);
    const out = [];
    try {
      await once(v, 'loadedmetadata', NAT_TIMEOUT);
      const dur = await fixDuration(v);
      const count = Math.max(1, Math.min(n, Math.ceil(dur / 2) || 1));
      for (let i = 0; i < count; i++) {
        const t = dur ? ((i + 0.5) / count) * dur : 0;
        await seekTo(v, t);
        out.push({ t: Math.round(v.currentTime * 10) / 10, data: dataUrlToB64(draw(v, width, 0.7)) });
        onProgress && onProgress({ done: i + 1, total: count });
      }
      return out;
    } finally { v.removeAttribute('src'); v.load(); }
  }

  // ---------- طابور الفهرسة الخلفية
  let running = false; let stop = false;
  async function runQueue(onEach, onDone) {
    if (running) return;
    running = true; stop = false;
    try {
      let list = await window.liwa.library.pending();
      let done = 0;
      for (const item of list) {
        if (stop) break;
        try {
          const cap = await capture(item.url);
          const rec = await window.liwa.library.probe(item.id, { duration: cap.duration, width: cap.width, height: cap.height });
          const buf = await dataUrlToBuf(cap.dataUrl);
          const thumb = await window.liwa.library.saveThumb(item.id, buf, cap.at);
          onEach && onEach(item.id, { ...rec, thumb });
        } catch (err) {
          const rec = await window.liwa.library.probe(item.id, { duration: 0, error: String(err.message || err) }).catch(() => null);
          onEach && onEach(item.id, rec);
        }
        done++;
        LT.probeProgress && LT.probeProgress({ done, total: list.length });
      }
    } finally { running = false; onDone && onDone(); }
  }
  const stopQueue = () => { stop = true; };

  LT.thumbs = { fixDuration, probe, capture, captureFrames, runQueue, stopQueue, dataUrlToBuf, dataUrlToB64, isRunning: () => running };
})(window.LT);
