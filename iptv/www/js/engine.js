/* LiwaIPTV — محرك التشغيل: يختار hls.js أو mpegts.js أو مشغل المتصفح الأصلي
   حسب نوع البث، ويتعافى من الانقطاع، ويوحّد المسارات الصوتية والجودات
   والترجمات المضمّنة خلف واجهة واحدة. */
'use strict';

import { urlExt } from './util.js';

const NATIVE_EXT = new Set(['mp4', 'm4v', 'mkv', 'webm', 'mov', 'mp3', 'aac', 'm4a', 'ogg', 'avi']);

/** hls | mpegts | native */
export function pickEngine(url, kind) {
  const ext = urlExt(url);
  if (ext === 'm3u8' || ext === 'm3u' || /[?&](?:type|format|output)=(?:m3u8|hls)\b/i.test(url)) return 'hls';
  if (ext === 'ts' || ext === 'flv' || ext === 'mpegts') return 'mpegts';
  if (NATIVE_EXT.has(ext)) return 'native';
  return kind === 'live' ? 'mpegts' : 'native';
}

const ORDER = { hls: ['hls', 'native', 'mpegts'], mpegts: ['mpegts', 'hls', 'native'], native: ['native', 'hls', 'mpegts'] };

export class Engine {
  /**
   * cb: { onFatal(msg), onTracks(), onStatus(text|null), onLive(isLive) }
   */
  constructor(video, cb = {}) {
    this.video = video;
    this.cb = cb;
    this.hls = null;
    this.ts = null;
    this.kind = null;
    this.name = null;
    this.url = null;
    this.retries = 0;
    this.tried = [];
    this.stallTimer = null;
    this.onVideoError = () => this.fail('native', this.mediaErrorText());
    this.onPlaying = () => { this.retries = 0; this.cb.onStatus && this.cb.onStatus(null); };
    video.addEventListener('playing', this.onPlaying);
  }

  get available() {
    return {
      hls: typeof window !== 'undefined' && window.Hls && window.Hls.isSupported(),
      mpegts: typeof window !== 'undefined' && window.mpegts && window.mpegts.getFeatureList().mseLivePlayback,
      native: true,
    };
  }

  /** يبدأ تشغيل رابط. opts: { kind, start, engine } */
  load(url, opts = {}) {
    this.destroy(false);
    this.url = url;
    this.kind = opts.kind || 'live';
    this.start = opts.start || 0;
    this.tried = [];
    this.retries = 0;
    const first = opts.engine && opts.engine !== 'auto' ? opts.engine : pickEngine(url, this.kind);
    this.chain = ORDER[first].filter((n) => this.available[n]);
    this.next();
  }

  next() {
    const name = this.chain.find((n) => !this.tried.includes(n));
    if (!name) {
      this.cb.onFatal && this.cb.onFatal(this.lastError || 'تعذّر تشغيل هذا البث');
      return;
    }
    this.tried.push(name);
    this.attach(name);
  }

  attach(name) {
    this.teardown();
    this.name = name;
    const v = this.video;
    const url = this.url;
    if (name === 'hls') {
      const Hls = window.Hls;
      const hls = new Hls({
        enableWorker: true,
        startPosition: this.kind === 'live' ? -1 : this.start,
        maxBufferLength: this.kind === 'live' ? 20 : 45,
        backBufferLength: 30,
        liveSyncDurationCount: 3,
        manifestLoadingMaxRetry: 2,
        levelLoadingMaxRetry: 4,
        fragLoadingMaxRetry: 6,
        renderTextTracksNatively: true,
      });
      this.hls = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, () => { this.cb.onTracks && this.cb.onTracks(); v.play().catch(() => {}); });
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => this.cb.onTracks && this.cb.onTracks());
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => this.cb.onTracks && this.cb.onTracks());
      hls.on(Hls.Events.LEVEL_SWITCHED, () => this.cb.onTracks && this.cb.onTracks());
      hls.on(Hls.Events.ERROR, (_, d) => {
        if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR && this.retries < 2) { this.retries++; hls.recoverMediaError(); return; }
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR && this.retries < 3 && d.details !== 'manifestParsingError') {
          this.retries++;
          this.cb.onStatus && this.cb.onStatus('إعادة الاتصال…');
          setTimeout(() => this.hls === hls && hls.startLoad(), 1500 * this.retries);
          return;
        }
        this.fail('hls', d.details === 'manifestLoadError' ? 'الخادم لم يرسل البث (ربما الاشتراك منتهٍ أو القناة متوقفة)' : `خطأ في البث (${d.details})`);
      });
      hls.loadSource(url);
      hls.attachMedia(v);
    } else if (name === 'mpegts') {
      const m = window.mpegts;
      const p = m.createPlayer({ type: urlExt(url) === 'flv' ? 'flv' : 'mpegts', isLive: this.kind === 'live', url }, {
        enableWorker: true,
        enableStashBuffer: this.kind !== 'live',
        stashInitialSize: 256 * 1024,
        liveBufferLatencyChasing: this.kind === 'live',
        liveBufferLatencyMaxLatency: 6,
        liveBufferLatencyMinRemain: 1.5,
        autoCleanupSourceBuffer: true,
        lazyLoad: false,
        fixAudioTimestampGap: true,
      });
      this.ts = p;
      p.on(m.Events.ERROR, (type, detail) => {
        // القنوات المباشرة تنقطع أحيانًا من الخادم؛ نعيد الاتصال بصمت
        if (this.kind === 'live' && this.retries < 5) {
          this.retries++;
          this.cb.onStatus && this.cb.onStatus('إعادة الاتصال…');
          setTimeout(() => { if (this.ts === p) this.attach('mpegts'); }, 1000 * this.retries);
          return;
        }
        this.fail('mpegts', type === m.ErrorTypes.NETWORK_ERROR ? 'انقطع الاتصال بالخادم' : `تعذّر فك ترميز البث (${detail})`);
      });
      p.on(m.Events.LOADING_COMPLETE, () => {
        if (this.kind === 'live' && this.ts === p) { this.retries++; setTimeout(() => this.ts === p && this.attach('mpegts'), 800); }
      });
      p.attachMediaElement(v);
      p.load();
      if (this.kind !== 'live' && this.start) v.currentTime = this.start;
      Promise.resolve(p.play()).catch(() => {});
      setTimeout(() => this.cb.onTracks && this.cb.onTracks(), 1500);
    } else {
      v.addEventListener('error', this.onVideoError);
      v.src = url;
      if (this.start) {
        const seek = () => { v.removeEventListener('loadedmetadata', seek); try { v.currentTime = this.start; } catch { /* */ } };
        v.addEventListener('loadedmetadata', seek);
      }
      v.play().catch(() => {});
      v.addEventListener('loadedmetadata', () => this.cb.onTracks && this.cb.onTracks(), { once: true });
    }
    this.watchStall();
  }

  /** لو بقي التحميل بلا تقدّم 20 ثانية نجرّب المحرك التالي. */
  watchStall() {
    clearTimeout(this.stallTimer);
    const v = this.video;
    const started = performance.now();
    const check = () => {
      if (v.readyState >= 3 || v.currentTime > 0.2) return;
      if (performance.now() - started > 20000) { this.fail(this.name, 'لم يبدأ البث خلال 20 ثانية'); return; }
      this.stallTimer = setTimeout(check, 1000);
    };
    this.stallTimer = setTimeout(check, 1000);
  }

  fail(name, msg) {
    if (name !== this.name) return;
    this.lastError = msg;
    const resumeAt = this.video.currentTime > 1 ? this.video.currentTime : this.start;
    this.start = resumeAt;
    this.next();
  }

  mediaErrorText() {
    const e = this.video.error;
    if (!e) return 'خطأ في التشغيل';
    return ({
      1: 'أُلغي التحميل',
      2: 'انقطع الاتصال أثناء التحميل',
      3: 'صيغة الفيديو أو الصوت غير مدعومة في المشغل الداخلي',
      4: 'الرابط لا يعمل أو الصيغة غير مدعومة',
    })[e.code] || 'خطأ في التشغيل';
  }

  teardown() {
    clearTimeout(this.stallTimer);
    const v = this.video;
    v.removeEventListener('error', this.onVideoError);
    if (this.hls) { try { this.hls.destroy(); } catch { /* */ } this.hls = null; }
    if (this.ts) {
      const p = this.ts; this.ts = null;
      try { p.pause(); p.unload(); p.detachMediaElement(); p.destroy(); } catch { /* */ }
    }
    if (v.getAttribute('src')) { v.removeAttribute('src'); try { v.load(); } catch { /* */ } }
  }

  destroy(full = true) {
    this.teardown();
    this.name = null;
    if (full) this.video.removeEventListener('playing', this.onPlaying);
  }

  // ———————————————— المسارات

  audioTracks() {
    if (this.hls && this.hls.audioTracks.length > 1) {
      return this.hls.audioTracks.map((t, i) => ({ id: i, name: t.name || t.lang || `مسار ${i + 1}`, lang: t.lang, active: i === this.hls.audioTrack }));
    }
    const at = this.video.audioTracks;
    if (at && at.length > 1) {
      return Array.from(at).map((t, i) => ({ id: i, name: t.label || t.language || `مسار ${i + 1}`, lang: t.language, active: t.enabled }));
    }
    return [];
  }

  setAudio(id) {
    if (this.hls && this.hls.audioTracks.length > 1) { this.hls.audioTrack = id; return; }
    const at = this.video.audioTracks;
    if (at) Array.from(at).forEach((t, i) => { t.enabled = i === id; });
  }

  levels() {
    if (!this.hls || this.hls.levels.length < 2) return [];
    return this.hls.levels.map((l, i) => ({ id: i, name: l.height ? `${l.height}p` : `${Math.round(l.bitrate / 1000)} kbps`, active: this.hls.autoLevelEnabled ? false : i === this.hls.currentLevel }));
  }

  setLevel(id) { if (this.hls) this.hls.currentLevel = id; }
  autoLevel() { return !this.hls || this.hls.autoLevelEnabled; }

  /** الترجمات المضمّنة (HLS أو ملفات mp4/mkv) كمسارات نصية في الفيديو. */
  textTracks() {
    return Array.from(this.video.textTracks || []).map((t, i) => ({ id: i, name: t.label || t.language || `ترجمة ${i + 1}`, lang: t.language, track: t }))
      .filter((t) => t.track.kind === 'subtitles' || t.track.kind === 'captions');
  }

  /** معلومات تقنية للعرض. */
  info() {
    const v = this.video;
    let bitrate = 0;
    if (this.hls && this.hls.levels[this.hls.currentLevel]) bitrate = this.hls.levels[this.hls.currentLevel].bitrate;
    if (this.ts && this.ts.statisticsInfo) bitrate = (this.ts.statisticsInfo.speed || 0) * 8 * 1024;
    let buffer = 0;
    for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime && v.buffered.end(i) >= v.currentTime) buffer = v.buffered.end(i) - v.currentTime;
    return { engine: this.name, width: v.videoWidth, height: v.videoHeight, bitrate, buffer };
  }
}
