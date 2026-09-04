/* LiwaMusic — محرّك الصوت: Web Audio، معادل 10 نطاقات، تلاشٍ متقاطع، تطبيع، ومؤثر بصري. */
'use strict';
(function (LM) {
  const BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

  const PRESETS = {
    flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    pop: [-1, 0, 2, 4, 5, 3, 0, -1, -1, -1],
    rock: [5, 4, 2, -1, -2, 0, 3, 4, 5, 5],
    jazz: [3, 2, 1, 2, -1, -1, 0, 1, 3, 4],
    classical: [4, 3, 2, 0, -1, -1, 0, 2, 3, 4],
    bass: [7, 6, 5, 3, 1, 0, 0, 0, 0, 0],
    treble: [0, 0, 0, 0, 0, 1, 3, 5, 6, 7],
    vocal: [-2, -1, 0, 2, 5, 5, 3, 1, 0, -1],
    electronic: [6, 5, 2, 0, -2, 1, 2, 3, 5, 6],
    oriental: [4, 3, 1, 2, 3, 4, 3, 2, 3, 4],
    night: [3, 2, 1, 1, 2, 2, 1, -1, -2, -3],
  };

  class Engine {
    constructor(handlers = {}) {
      this.h = handlers;
      this.ctx = null;
      this.ready = false;
      this.decks = [];
      this.active = 0;
      this.track = null;
      this.nextTrack = null;
      this.state = 'idle';       // idle | playing | paused | loading
      this.volume = 0.9;
      this.muted = false;
      this.rate = 1;
      this.crossfade = 0;
      this.normalize = false;
      this.eqEnabled = false;
      this.eqGains = [...PRESETS.flat];
      this.preamp = 0;
      this._fading = false;
      this._sleepTimer = null;
      this.sleepEndsAt = 0;
    }

    // ————— بناء سلسلة الصوت
    _build() {
      if (this.ready) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'playback' });

      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.78;

      this.preampNode = this.ctx.createGain();
      this.preampNode.gain.value = 1;

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -18;
      this.compressor.knee.value = 24;
      this.compressor.ratio.value = 3.2;
      this.compressor.attack.value = 0.006;
      this.compressor.release.value = 0.26;

      this.filters = BANDS.map((freq, i) => {
        const f = this.ctx.createBiquadFilter();
        f.type = i === 0 ? 'lowshelf' : (i === BANDS.length - 1 ? 'highshelf' : 'peaking');
        f.frequency.value = freq;
        f.Q.value = 1.1;
        f.gain.value = 0;
        return f;
      });

      // مدخل → مرشحات متسلسلة → preamp → (ضاغط اختياري) → master → analyser → الخرج
      this.input = this.ctx.createGain();
      let node = this.input;
      for (const f of this.filters) { node.connect(f); node = f; }
      node.connect(this.preampNode);
      this._routeTail();
      this.master.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);

      for (const id of ['deckA', 'deckB']) {
        const audio = document.getElementById(id);
        audio.volume = 1;
        audio.preservesPitch = true;
        const src = this.ctx.createMediaElementSource(audio);
        const gain = this.ctx.createGain();
        gain.gain.value = 0;
        src.connect(gain);
        gain.connect(this.input);
        const deck = { audio, src, gain, track: null };
        this.decks.push(deck);
        this._wireDeck(deck);
      }
      this.decks[0].gain.gain.value = 1;
      this.ready = true;
      this.applyEQ();
    }

    _routeTail() {
      try { this.preampNode.disconnect(); } catch { /* غير موصول */ }
      try { this.compressor.disconnect(); } catch { /* غير موصول */ }
      if (this.normalize) {
        this.preampNode.connect(this.compressor);
        this.compressor.connect(this.master);
      } else {
        this.preampNode.connect(this.master);
      }
    }

    _wireDeck(deck) {
      const { audio } = deck;
      audio.addEventListener('timeupdate', () => {
        if (deck !== this.decks[this.active]) return;
        this.h.onTime?.(audio.currentTime, audio.duration || this.track?.duration || 0);
        this._maybeCrossfade();
      });
      audio.addEventListener('ended', () => {
        if (deck !== this.decks[this.active]) return;
        if (this._fading) return;
        this.h.onEnded?.();
      });
      audio.addEventListener('playing', () => {
        if (deck !== this.decks[this.active]) return;
        this.state = 'playing';
        this.h.onState?.(this.state);
      });
      audio.addEventListener('pause', () => {
        if (deck !== this.decks[this.active]) return;
        if (this.state !== 'idle') { this.state = 'paused'; this.h.onState?.(this.state); }
      });
      audio.addEventListener('waiting', () => {
        if (deck === this.decks[this.active]) this.h.onState?.('loading');
      });
      audio.addEventListener('error', () => {
        if (deck !== this.decks[this.active]) return;
        this.h.onError?.(deck.track, audio.error);
      });
    }

    get current() { return this.decks[this.active]; }
    get other() { return this.decks[1 - this.active]; }

    async _ensure() {
      this._build();
      if (this.ctx.state === 'suspended') { try { await this.ctx.resume(); } catch { /* تجاهل */ } }
    }

    // ————— التشغيل
    async load(track, url, { autoplay = true, position = 0 } = {}) {
      await this._ensure();
      this._fading = false;
      const deck = this.current;
      const other = this.other;
      try { other.audio.pause(); } catch { /* لا شيء */ }
      other.gain.gain.cancelScheduledValues(this.ctx.currentTime);
      other.gain.gain.value = 0;
      deck.gain.gain.cancelScheduledValues(this.ctx.currentTime);
      deck.gain.gain.value = 1;

      deck.track = track;
      this.track = track;
      deck.audio.src = url;
      deck.audio.playbackRate = this.rate;
      deck.audio.preservesPitch = true;
      this.state = 'loading';
      this.h.onTrack?.(track);
      if (position > 0) {
        const seekOnce = () => { try { deck.audio.currentTime = position; } catch { /* غير جاهز */ } deck.audio.removeEventListener('loadedmetadata', seekOnce); };
        deck.audio.addEventListener('loadedmetadata', seekOnce);
      }
      if (autoplay) {
        try { await deck.audio.play(); } catch (err) { this.h.onError?.(track, err); }
      } else {
        deck.audio.load();
        this.state = 'paused';
        this.h.onState?.(this.state);
      }
    }

    /** يحمّل الأغنية التالية مسبقًا على الديك الآخر (تشغيل شبه متواصل). */
    preload(track, url) {
      if (!this.ready || !url) return;
      const other = this.other;
      if (other.track && other.track.id === track.id && other.audio.src) return;
      other.track = track;
      other.audio.src = url;
      other.audio.playbackRate = this.rate;
      try { other.audio.load(); } catch { /* تجاهل */ }
      this.nextTrack = track;
    }

    /** انتقال متلاشٍ إلى الديك الآخر (يُستخدم للتلاشي المتقاطع). */
    async crossTo(track, url, seconds) {
      await this._ensure();
      const from = this.current;
      const to = this.other;
      if (!to.audio.src || !to.track || to.track.id !== track.id) {
        to.track = track;
        to.audio.src = url;
      }
      to.audio.playbackRate = this.rate;
      const now = this.ctx.currentTime;
      const dur = Math.max(0.4, seconds);
      this._fading = true;
      try { await to.audio.play(); } catch (err) { this._fading = false; this.h.onError?.(track, err); return; }
      to.gain.gain.cancelScheduledValues(now);
      to.gain.gain.setValueAtTime(0.0001, now);
      to.gain.gain.linearRampToValueAtTime(1, now + dur);
      from.gain.gain.cancelScheduledValues(now);
      from.gain.gain.setValueAtTime(from.gain.gain.value, now);
      from.gain.gain.linearRampToValueAtTime(0.0001, now + dur);
      this.active = 1 - this.active;
      this.track = track;
      this.h.onTrack?.(track);
      setTimeout(() => {
        try { from.audio.pause(); from.audio.currentTime = 0; } catch { /* تجاهل */ }
        this._fading = false;
      }, dur * 1000 + 120);
    }

    _maybeCrossfade() {
      if (!this.crossfade || this._fading || this.state !== 'playing') return;
      const a = this.current.audio;
      const remaining = (a.duration || 0) - a.currentTime;
      if (!Number.isFinite(remaining)) return;
      if (remaining <= this.crossfade + 0.05 && remaining > 0.2) {
        this.h.onCrossfade?.(this.crossfade);
      }
    }

    async play() {
      await this._ensure();
      if (!this.current.audio.src) return;
      try { await this.current.audio.play(); } catch (err) { this.h.onError?.(this.track, err); }
    }

    pause() { try { this.current.audio.pause(); } catch { /* تجاهل */ } }

    toggle() {
      if (this.state === 'playing') this.pause(); else this.play();
    }

    stop() {
      for (const d of this.decks) {
        try { d.audio.pause(); d.audio.removeAttribute('src'); d.audio.load(); } catch { /* تجاهل */ }
        d.track = null;
      }
      this.track = null;
      this.state = 'idle';
      this.h.onState?.(this.state);
    }

    seek(sec) {
      const a = this.current.audio;
      if (!a.duration) return;
      a.currentTime = Math.max(0, Math.min(a.duration - 0.15, sec));
    }

    seekBy(delta) { this.seek((this.current?.audio.currentTime || 0) + delta); }

    get position() { return this.ready ? this.current.audio.currentTime : 0; }
    get duration() { return this.ready ? (this.current.audio.duration || this.track?.duration || 0) : 0; }

    setVolume(v) {
      this.volume = Math.max(0, Math.min(1, v));
      if (this.ready) {
        const target = this.muted ? 0.0001 : Math.max(0.0001, this.volume);
        this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02);
      }
    }

    setMuted(on) {
      this.muted = !!on;
      this.setVolume(this.volume);
      return this.muted;
    }

    setRate(rate) {
      this.rate = Math.max(0.25, Math.min(2.5, Number(rate) || 1));
      for (const d of this.decks) {
        d.audio.playbackRate = this.rate;
        d.audio.preservesPitch = true;
      }
      return this.rate;
    }

    setCrossfade(sec) { this.crossfade = Math.max(0, Math.min(12, Number(sec) || 0)); }

    setNormalize(on) {
      this.normalize = !!on;
      if (this.ready) this._routeTail();
      return this.normalize;
    }

    setEQEnabled(on) {
      this.eqEnabled = !!on;
      this.applyEQ();
      return this.eqEnabled;
    }

    setEQGains(gains) {
      this.eqGains = BANDS.map((_, i) => Number(gains?.[i]) || 0);
      this.applyEQ();
      return this.eqGains;
    }

    setPreamp(db) {
      this.preamp = Math.max(-12, Math.min(12, Number(db) || 0));
      this.applyEQ();
      return this.preamp;
    }

    applyPreset(name) {
      const preset = PRESETS[name] || PRESETS.flat;
      this.setEQGains(preset);
      return [...preset];
    }

    applyEQ() {
      if (!this.ready) return;
      const t = this.ctx.currentTime;
      this.filters.forEach((f, i) => {
        f.gain.setTargetAtTime(this.eqEnabled ? this.eqGains[i] : 0, t, 0.05);
      });
      const preampDb = this.eqEnabled ? this.preamp : 0;
      this.preampNode.gain.setTargetAtTime(10 ** (preampDb / 20), t, 0.05);
    }

    /** مؤقّت النوم: يخفض الصوت تدريجيًا ثم يوقف التشغيل. */
    setSleep(minutes) {
      clearTimeout(this._sleepTimer);
      this._sleepTimer = null;
      this.sleepEndsAt = 0;
      const mins = Number(minutes) || 0;
      if (mins <= 0) return 0;
      this.sleepEndsAt = Date.now() + mins * 60000;
      this._sleepTimer = setTimeout(() => {
        const startVol = this.volume;
        const steps = 20;
        let i = 0;
        const fade = setInterval(() => {
          i++;
          this.setVolume(startVol * (1 - i / steps));
          if (i >= steps) {
            clearInterval(fade);
            this.pause();
            this.setVolume(startVol);
            this.sleepEndsAt = 0;
            this.h.onSleep?.();
          }
        }, 500);
      }, mins * 60000);
      return mins;
    }

    getAnalyser() { return this.analyser || null; }
  }

  LM.Engine = Engine;
  LM.EQ_BANDS = BANDS;
  LM.EQ_PRESETS = PRESETS;
}(window.LM));
