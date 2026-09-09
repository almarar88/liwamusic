/* معادل صوتي من عشرة نطاقات فوق عنصر <audio> عبر Web Audio. */

export const BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const PRESETS = {
  flat: { label: 'مسطّح', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  bass: { label: 'باص قوي', gains: [7, 6, 4.5, 2, 0, -1, -1, 0, 1, 1.5] },
  vocal: { label: 'صوت واضح', gains: [-2, -1.5, 0, 2, 4, 4.5, 3, 1.5, 0, -1] },
  arabic: { label: 'طرب شرقي', gains: [3, 2.5, 1, 0, 1.5, 3, 3.5, 2, 1, 0] },
  night: { label: 'ليلي هادئ', gains: [-1, -1, 0, 1, 1.5, 1, 0, -1, -2, -3] },
  loud: { label: 'صاخب', gains: [5, 4, 2, 0, -1, 0, 2, 4, 5, 5] },
};

export class Equalizer {
  constructor(audioEl) {
    this.el = audioEl;
    this.ready = false;
    this.filters = [];
    this.gains = BANDS.map(() => 0);
    this.preampDb = 0;
    this.boost = false;
  }

  /** يُبنى عند أول استخدام فعلي (يتطلّب تفاعل المستخدم في بعض المتصفّحات). */
  init() {
    if (this.ready) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      this.ctx = new AC();
      this.src = this.ctx.createMediaElementSource(this.el);
      this.preamp = this.ctx.createGain();
      this.filters = BANDS.map((f, i) => {
        const b = this.ctx.createBiquadFilter();
        b.type = i === 0 ? 'lowshelf' : (i === BANDS.length - 1 ? 'highshelf' : 'peaking');
        b.frequency.value = f;
        b.Q.value = 1.1;
        b.gain.value = 0;
        return b;
      });
      this.comp = this.ctx.createDynamicsCompressor();
      this.comp.threshold.value = -22;
      this.comp.ratio.value = 4;
      this.out = this.ctx.createGain();

      let node = this.src;
      node.connect(this.preamp); node = this.preamp;
      for (const f of this.filters) { node.connect(f); node = f; }
      node.connect(this.out);
      this.out.connect(this.ctx.destination);
      this.ready = true;
      return true;
    } catch { return false; }
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); }

  setGains(list) {
    this.gains = BANDS.map((_, i) => Number(list[i]) || 0);
    if (!this.ready) return;
    this.filters.forEach((f, i) => { f.gain.value = this.gains[i]; });
    // نخفض التمهيد بقدر أعلى تعزيز كي لا يحدث تشويه
    const peak = Math.max(0, ...this.gains);
    this.preamp.gain.value = 10 ** ((this.preampDb - peak * 0.5) / 20);
  }

  setPreset(name) {
    const p = PRESETS[name] || PRESETS.flat;
    this.setGains(p.gains);
    return p;
  }

  /** تسوية الصوت: يُدخل ضاغط المدى بين الفلاتر والمخرج. */
  setBoost(on) {
    this.boost = !!on;
    if (!this.ready) return;
    try {
      this.filters[this.filters.length - 1].disconnect();
      this.out.disconnect();
      if (this.boost) {
        this.filters[this.filters.length - 1].connect(this.comp);
        this.comp.connect(this.out);
      } else {
        this.filters[this.filters.length - 1].connect(this.out);
      }
      this.out.connect(this.ctx.destination);
    } catch { /* تجاهل */ }
  }
}
