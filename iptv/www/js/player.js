/* LiwaIPTV — شاشة التشغيل: تحكم كامل باللمس والريموت، تقليب القنوات، دليل
   البرامج والأرشيف، الحلقات والتشغيل التلقائي للتالية، الترجمة (مضمّنة أو من
   ملف أو OpenSubtitles) مع ضبط التوقيت والمظهر، المسارات الصوتية والجودة،
   أوضاع العرض، السرعة، صورة داخل صورة، ومؤقت النوم. */
'use strict';

import { Engine } from './engine.js';
import { native, isNative } from './native.js';
import { $, icon, toast, art, moveFocus, KEYDIR } from './ui.js';
import { esc, fmtTime, clock, urlExt } from './util.js';
import { nowNext, progress } from './epg.js';
import { toCues, decodeSubtitle, searchOpenSubtitles, downloadOpenSubtitles } from './subs.js';
import { hostOf } from './library.js';

const ASPECTS = [
  { id: 'fit', label: 'ملاءمة' },
  { id: 'fill', label: 'ملء الشاشة' },
  { id: 'stretch', label: 'تمديد' },
  { id: '16:9', label: '16:9' },
  { id: '4:3', label: '4:3' },
  { id: 'zoom', label: 'تكبير' },
];
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export class Player {
  constructor({ lib, settings, saveSettings, onClose }) {
    this.lib = lib;
    this.settings = settings;
    this.saveSettings = saveSettings;
    this.onClose = onClose;
    this.root = $('#player');
    this.video = $('#video');
    this.ctx = null;
    this.uiTimer = null;
    this.saveTimer = null;
    this.epgTimer = null;
    this.digits = '';
    this.subs = { cues: [], offset: 0, track: null, label: '' };
    this.aspect = settings.aspect || 'fit';
    this.locked = false;
    this.sleepAt = 0;
    this.engine = new Engine(this.video, {
      onFatal: (msg) => this.showError(msg),
      onTracks: () => this.autoSubtitle(),
      onStatus: (t) => this.status(t),
    });
    this.bind();
    native.on('pip', (e) => this.root.classList.toggle('in-pip', !!(e && e.active)));
  }

  get isOpen() { return !this.root.hidden; }
  get live() { return this.ctx && this.ctx.kind === 'live' && !this.ctx.catchup; }

  // ———————————————————————————— فتح وإغلاق

  /** ctx: { item, kind, list?, index?, series?: {item, info, season, index}, start? } */
  async open(ctx) {
    if (this.settings.externalAlways && isNative) {
      const url = await this.urlFor(ctx);
      if (url) native.openExternal(url, this.titleOf(ctx).title, this.uaFor(ctx.item));
      return;
    }
    const wasOpen = this.isOpen;
    if (wasOpen) this.saveProgress();
    this.ctx = { ...ctx };
    this.root.hidden = false;
    this.root.classList.toggle('is-live', ctx.kind === 'live');
    this.root.classList.toggle('has-list', !!(ctx.list && ctx.list.length > 1));
    this.root.classList.toggle('has-eps', !!ctx.series);
    this.root.classList.toggle('has-archive', !!(ctx.kind === 'live' && ctx.item.catchup));
    document.body.classList.add('playing');
    if (!wasOpen) {
      native.immersive(true);
      native.keepAwake(true);
      if (this.settings.landscape !== false) native.orientation('landscape');
    }
    this.clearSubs();
    this.applyAspect();
    this.video.playbackRate = 1;
    $('#pSpeedLbl').textContent = '1×';
    this.hidePanel();
    $('#pNextUp').hidden = true;
    $('#pError').hidden = true;
    this.renderHeader();
    this.showUi();
    await this.start();
    if (ctx.kind === 'live') this.zapOsd();
  }

  titleOf(ctx) {
    const it = ctx.item;
    if (ctx.kind === 'live') {
      return { title: ctx.catchup ? ctx.catchup.title : it.name, sub: ctx.catchup ? `${it.name} · أرشيف ${clock(ctx.catchup.start)}` : (it.num ? `القناة ${it.num}` : '') };
    }
    if (ctx.kind === 'episode') {
      const s = ctx.series;
      const name = s ? (s.item.title || s.item.name) : '';
      return { title: name || it.title, sub: `الموسم ${it.season} · الحلقة ${it.episode}${it.title && !/^الحلقة/.test(it.title) ? ` — ${it.title}` : ''}` };
    }
    return { title: it.title || it.name, sub: [it.year, it.quality].filter(Boolean).join(' · ') };
  }

  renderHeader() {
    const { title, sub } = this.titleOf(this.ctx);
    $('#pTitle').textContent = title;
    $('#pSub').textContent = sub;
    const logo = $('#pLogo');
    if (this.ctx.kind === 'live' && this.ctx.item.logo) { logo.src = this.ctx.item.logo; logo.hidden = false; logo.onerror = () => { logo.hidden = true; }; } else logo.hidden = true;
    $('#pLiveBadge').hidden = !this.live;
    $('#pEpg').hidden = !this.live;
    $('#pSeek').hidden = this.live;
    this.updateFav();
  }

  uaFor(item) { const h = this.lib.headersFor(item); return h && h.ua; }

  async urlFor(ctx) {
    if (ctx.catchup) return ctx.catchup.url;
    return this.lib.streamUrl(ctx.item);
  }

  async start() {
    const ctx = this.ctx;
    this.status('جارٍ التحميل…');
    let url;
    try { url = await this.urlFor(ctx); } catch (e) { this.showError(e.message); return; }
    if (this.ctx !== ctx) return;
    ctx.url = url;
    // ترويسات خاصة (User-Agent/Referer) تُمرَّر لوسيط أندرويد حسب المضيف
    const h = this.lib.headersFor(ctx.item);
    if (h) native.setProxyRules([{ host: hostOf(url), ua: h.ua || '', referer: h.referer || '' }]);
    let startAt = ctx.start || 0;
    if (!startAt && ctx.kind !== 'live') {
      const prev = this.lib.progressOf(ctx.item.id);
      if (prev && !prev.done && prev.pos > 30) startAt = prev.pos;
    }
    this.resumeFrom = startAt;
    const kind = this.live ? 'live' : 'vod';
    this.engine.load(url, { kind, start: startAt, engine: this.settings.engine || 'auto' });
    if (startAt > 30) toast(`استئناف من ${fmtTime(startAt)} — اضغط ⟲ للبدء من الأول`, 3500);
    this.lib.record(this.historyEntry(0, 0));
    clearInterval(this.saveTimer);
    this.saveTimer = setInterval(() => this.saveProgress(), 10000);
    if (this.live) this.loadEpg(); else clearInterval(this.epgTimer);
    this.checkCodecsLater();
  }

  historyEntry(pos, dur) {
    const c = this.ctx;
    const it = c.item;
    const base = { id: it.id, kind: c.kind, name: it.title || it.name, logo: it.logo || it.img || '', pos, dur };
    if (c.kind === 'episode' && c.series) {
      const s = c.series.item;
      return { ...base, name: s.title || s.name, logo: s.logo || it.img || '', seriesId: s.id, ep: { ...it } };
    }
    return base;
  }

  saveProgress() {
    if (!this.ctx || this.ctx.kind === 'live' || this.ctx.catchup) return;
    const v = this.video;
    if (!(v.duration > 0) || !Number.isFinite(v.duration) || v.currentTime < 5) return;
    this.lib.record(this.historyEntry(Math.floor(v.currentTime), Math.floor(v.duration)));
  }

  close() {
    if (!this.isOpen) return;
    this.saveProgress();
    clearInterval(this.saveTimer);
    clearInterval(this.epgTimer);
    clearTimeout(this.uiTimer);
    clearTimeout(this.nextTimer);
    this.engine.destroy(false);
    this.root.hidden = true;
    this.root.classList.remove('ui', 'locked', 'in-pip');
    this.locked = false;
    document.body.classList.remove('playing');
    native.immersive(false);
    native.keepAwake(false);
    native.orientation('auto');
    native.brightness(-1);
    this.ctx = null;
    this.onClose && this.onClose();
  }

  // ———————————————————————————— الحالة والأخطاء

  status(text) {
    const s = $('#pStatus');
    if (!text) { s.hidden = true; return; }
    $('span', s).textContent = text;
    s.hidden = false;
  }

  showError(msg) {
    this.status(null);
    const e = $('#pError');
    $('p', e).textContent = msg || 'تعذّر تشغيل هذا البث';
    e.hidden = false;
    $('[data-p=retry]', e).focus();
  }

  /** بعد بدء التشغيل: هل الصوت أو الصورة غير مدعومين داخليًا؟ */
  checkCodecsLater() {
    clearTimeout(this.codecTimer);
    const ctx = this.ctx;
    this.codecTimer = setTimeout(() => {
      if (this.ctx !== ctx || this.video.paused) return;
      const v = this.video;
      if (v.webkitAudioDecodedByteCount === 0 && v.webkitVideoDecodedByteCount > 0) {
        this.status(null);
        toast('لا صوت؟ صيغة الصوت (AC3/DTS غالبًا) غير مدعومة داخليًا — افتح المشغل الخارجي من الزر ⧉', 7000);
      } else if (v.videoWidth === 0 && v.webkitAudioDecodedByteCount > 0) {
        toast('الصورة لا تظهر؟ صيغة الفيديو غير مدعومة على هذا الجهاز — جرّب المشغل الخارجي', 7000);
      }
    }, 6000);
  }

  // ———————————————————————————— عناصر التحكم

  showUi(sticky = false) {
    if (this.locked) { this.root.classList.add('ui-lock'); clearTimeout(this.uiTimer); this.uiTimer = setTimeout(() => this.root.classList.remove('ui-lock'), 2500); return; }
    this.root.classList.add('ui');
    clearTimeout(this.uiTimer);
    if (!sticky) this.uiTimer = setTimeout(() => this.hideUi(), 4500);
    this.updateSeek();
  }

  hideUi(force = false) {
    if (!$('#pPanel').hidden) return;
    if (!force && this.video.paused && !this.live && this.video.readyState > 2) return;
    this.root.classList.remove('ui');
    if (this.root.contains(document.activeElement)) document.activeElement.blur();
  }

  toggleUi() { if (this.root.classList.contains('ui')) this.hideUi(); else this.showUi(); }

  togglePlay() {
    const v = this.video;
    if (v.paused) v.play().catch(() => {}); else v.pause();
    this.showUi();
  }

  seekBy(d) {
    if (this.live) return;
    const v = this.video;
    if (!Number.isFinite(v.duration)) return;
    v.currentTime = Math.max(0, Math.min(v.duration - 1, v.currentTime + d));
    this.flashSeek(d > 0 ? `+${Math.abs(d)} ث` : `−${Math.abs(d)} ث`);
    this.updateSeek();
  }

  flashSeek(text) {
    const h = $('#pSeekHint');
    h.textContent = text;
    h.hidden = false;
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => { h.hidden = true; }, 700);
  }

  updateSeek() {
    const v = this.video;
    if (this.live) return;
    const d = Number.isFinite(v.duration) ? v.duration : 0;
    $('#pCur').textContent = fmtTime(v.currentTime);
    $('#pDur').textContent = d ? fmtTime(d) : '--:--';
    const pct = d ? (v.currentTime / d) * 100 : 0;
    let buf = 0;
    for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 1) buf = v.buffered.end(i);
    const t = $('#pTrack');
    t.style.setProperty('--p', `${pct}%`);
    t.style.setProperty('--b', `${d ? (buf / d) * 100 : 0}%`);
    t.setAttribute('aria-valuenow', Math.round(pct));
  }

  updatePlayIcon() {
    $('[data-p=toggle] use', this.root).setAttribute('href', this.video.paused ? '#i-play' : '#i-pause');
  }

  updateFav() {
    const id = this.ctx.kind === 'episode' && this.ctx.series ? this.ctx.series.item.id : this.ctx.item.id;
    const on = this.lib.isFav(id);
    const b = $('[data-p=fav]', this.root);
    b.classList.toggle('on', on);
    $('use', b).setAttribute('href', on ? '#i-heart-f' : '#i-heart');
  }

  applyAspect() {
    const v = this.video;
    v.style.objectFit = 'contain';
    v.style.transform = '';
    v.style.aspectRatio = '';
    v.style.width = v.style.height = '100%';
    switch (this.aspect) {
      case 'fill': v.style.objectFit = 'cover'; break;
      case 'stretch': v.style.objectFit = 'fill'; break;
      case '16:9': case '4:3': {
        const [w, h] = this.aspect.split(':').map(Number);
        const vw = innerWidth; const vh = innerHeight;
        if (vw / vh > w / h) { v.style.width = `${(vh * w) / h}px`; v.style.height = '100%'; } else { v.style.width = '100%'; v.style.height = `${(vw * h) / w}px`; }
        v.style.objectFit = 'fill';
        break;
      }
      case 'zoom': v.style.objectFit = 'cover'; v.style.transform = 'scale(1.18)'; break;
      default: break;
    }
    $('#pAspectLbl').textContent = ASPECTS.find((a) => a.id === this.aspect).label;
  }

  // ———————————————————————————— القنوات المباشرة

  zap(delta) {
    const c = this.ctx;
    if (!c || !c.list || c.list.length < 2) return;
    const n = c.list.length;
    const index = ((c.index ?? c.list.indexOf(c.item)) + delta + n) % n;
    this.open({ ...c, item: c.list[index], index, catchup: null, start: 0 });
  }

  zapTo(num) {
    const c = this.ctx;
    if (!c || !c.list) return;
    const index = c.list.findIndex((i) => i.num === num);
    if (index >= 0) this.open({ ...c, item: c.list[index], index, catchup: null });
    else toast(`لا توجد قناة برقم ${num} في هذه القائمة`);
  }

  zapOsd() {
    const it = this.ctx.item;
    const z = $('#pZap');
    z.innerHTML = `${art(it.logo, it.name, 'sm')}<div><b>${it.num ? `<span class="n">${it.num}</span>` : ''}${esc(it.name)}</b><span class="now muted"></span></div>`;
    z.hidden = false;
    clearTimeout(this.zapTimer);
    this.zapTimer = setTimeout(() => { z.hidden = true; }, 3500);
  }

  async loadEpg() {
    const ctx = this.ctx;
    const render = (list) => {
      if (this.ctx !== ctx) return;
      const { now, next } = nowNext(list);
      const box = $('#pEpg');
      $('.now b', box).textContent = now ? now.title : 'لا يتوفر دليل برامج';
      $('.now span', box).textContent = now ? `${clock(now.start)} – ${clock(now.end)}` : '';
      $('.prog i', box).style.width = `${progress(now) * 100}%`;
      $('.next', box).textContent = next ? `التالي ${clock(next.start)}: ${next.title}` : '';
      const zn = $('#pZap .now');
      if (zn) zn.textContent = now ? now.title : '';
      $('#pSub').textContent = now ? `${ctx.item.num ? `${ctx.item.num} · ` : ''}${now.title}` : this.titleOf(ctx).sub;
    };
    let list = [];
    try { list = await this.lib.programmes(ctx.item); } catch { /* بلا دليل */ }
    render(list);
    clearInterval(this.epgTimer);
    this.epgTimer = setInterval(() => render(list), 30000);
  }

  // ———————————————————————————— الحلقات

  episodeAt(delta) {
    const s = this.ctx && this.ctx.series;
    if (!s || !s.info) return null;
    const flat = s.info.seasons.flatMap((x) => x.episodes);
    const i = flat.findIndex((e) => e.id === this.ctx.item.id);
    return i >= 0 ? flat[i + delta] || null : null;
  }

  playEpisode(ep) {
    if (!ep) return;
    this.open({ ...this.ctx, item: ep, start: 0 });
  }

  onEnded() {
    if (this.ctx.kind === 'episode') {
      this.lib.record(this.historyEntry(Math.floor(this.video.duration || 0), Math.floor(this.video.duration || 0)));
      const next = this.episodeAt(1);
      if (next && this.settings.autoNext !== false) {
        const box = $('#pNextUp');
        const img = $('img', box);
        img.src = next.img || this.ctx.series.item.logo || '';
        img.onerror = () => { img.removeAttribute('src'); };
        $('.t', box).textContent = `الموسم ${next.season} · الحلقة ${next.episode}${next.title && !/^الحلقة/.test(next.title) ? ` — ${next.title}` : ''}`;
        box.hidden = false;
        $('[data-p=nextNow]', box).focus();
        let n = 10;
        $('span b', box).textContent = n;
        clearInterval(this.nextTimer);
        this.nextTimer = setInterval(() => {
          n--;
          $('span b', box).textContent = n;
          if (n <= 0) { clearInterval(this.nextTimer); box.hidden = true; this.playEpisode(next); }
        }, 1000);
        return;
      }
    }
    if (this.ctx.kind === 'movie') this.lib.record(this.historyEntry(Math.floor(this.video.duration || 0), Math.floor(this.video.duration || 0)));
    this.showUi(true);
  }

  // ———————————————————————————— اللوحة الجانبية

  panel(title, html, onMount) {
    const p = $('#pPanel');
    $('.p-panel-head b', p).textContent = title;
    const body = $('.p-panel-body', p);
    body.innerHTML = html;
    p.hidden = false;
    this.showUi(true);
    if (onMount) onMount(body);
    const f = body.querySelector('.on, button, input');
    if (f) setTimeout(() => { f.focus({ preventScroll: true }); f.scrollIntoView({ block: 'center' }); }, 30);
  }

  hidePanel() {
    const p = $('#pPanel');
    if (p.hidden) return false;
    p.hidden = true;
    this.showUi();
    return true;
  }

  opts(list, onPick) {
    return (body) => body.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => onPick(b.dataset.v, b)));
  }

  panelChannels() {
    const c = this.ctx;
    const html = `<input class="input" type="search" placeholder="ابحث في القنوات…" data-q />
      <div class="p-chlist">${c.list.map((it, i) => `<button class="p-ch ${it.id === c.item.id ? 'on' : ''}" data-v="${i}">
        <span class="n">${it.num || ''}</span>${art(it.logo, it.name, 'xs')}<span class="nm">${esc(it.name)}</span>${this.lib.isFav(it.id) ? icon('heart-f', 'fav') : ''}</button>`).join('')}</div>`;
    this.panel(`القنوات (${c.list.length})`, html, (body) => {
      this.opts(c.list, (v) => { this.hidePanel(); this.open({ ...c, item: c.list[+v], index: +v, catchup: null }); })(body);
      const q = $('[data-q]', body);
      q.addEventListener('input', () => {
        const s = q.value.trim().toLowerCase();
        body.querySelectorAll('.p-ch').forEach((b) => { b.hidden = !!s && !b.textContent.toLowerCase().includes(s); });
      });
    });
  }

  async panelArchive() {
    const c = this.ctx;
    this.panel('الأرشيف — برامج سابقة', '<div class="p-loading"><i class="spin"></i></div>');
    let list = [];
    try {
      const prov = this.lib.provider;
      list = prov.fullEpg ? await prov.fullEpg(this.lib.pl, c.item) : await this.lib.programmes(c.item);
    } catch { /* */ }
    const now = Date.now();
    const days = (c.item.catchup && c.item.catchup.days) || 1;
    const past = list.filter((p) => p.end < now && p.start > now - days * 864e5 && (p.archive !== false)).reverse();
    if (!past.length) { $('.p-panel-body').innerHTML = '<p class="muted pad">لا توجد برامج مؤرشفة متاحة لهذه القناة.</p>'; return; }
    let lastDay = '';
    const html = past.map((p, i) => {
      const day = new Date(p.start).toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long' });
      const head = day !== lastDay ? `<div class="p-day">${esc((lastDay = day))}</div>` : '';
      return `${head}<button class="p-prog" data-v="${i}"><span class="tm">${clock(p.start)}</span><span class="nm">${esc(p.title)}</span></button>`;
    }).join('');
    const body = $('.p-panel-body');
    body.innerHTML = html;
    this.opts(past, (v) => {
      const p = past[+v];
      const prov = this.lib.provider;
      if (!prov.catchup) { toast('الأرشيف غير مدعوم لهذا النوع من الاشتراكات'); return; }
      this.hidePanel();
      this.open({ ...c, catchup: { url: prov.catchup(this.lib.pl, c.item, p), title: p.title, start: p.start }, start: 0 });
    })(body);
  }

  panelEpisodes() {
    const s = this.ctx.series;
    if (!s || !s.info) return;
    const cur = this.ctx.item;
    const html = `<div class="seg sm">${s.info.seasons.map((x) => `<button data-season="${x.num}" class="${x.num === cur.season ? 'on' : ''}">${esc(x.name)}</button>`).join('')}</div><div class="p-eps"></div>`;
    this.panel('الحلقات', html, (body) => {
      const renderSeason = (n) => {
        const season = s.info.seasons.find((x) => x.num === n) || s.info.seasons[0];
        $('.p-eps', body).innerHTML = season.episodes.map((e) => {
          const prog = this.lib.progressOf(e.id);
          const pct = prog && prog.dur ? Math.min(100, (prog.pos / prog.dur) * 100) : 0;
          return `<button class="p-ep ${e.id === cur.id ? 'on' : ''}" data-ep="${esc(e.id)}"><span class="n">${e.episode}</span><span class="nm">${esc(e.title || `الحلقة ${e.episode}`)}</span>${pct ? `<i class="pb"><i style="width:${pct}%"></i></i>` : ''}</button>`;
        }).join('');
        body.querySelectorAll('[data-ep]').forEach((b) => b.addEventListener('click', () => {
          this.hidePanel();
          this.playEpisode(season.episodes.find((e) => e.id === b.dataset.ep));
        }));
        body.querySelectorAll('[data-season]').forEach((b) => b.classList.toggle('on', Number(b.dataset.season) === season.num));
      };
      body.querySelectorAll('[data-season]').forEach((b) => b.addEventListener('click', () => renderSeason(Number(b.dataset.season))));
      renderSeason(cur.season);
    });
  }

  panelAudio() {
    const e = this.engine;
    const audio = e.audioTracks();
    const levels = e.levels();
    const info = e.info();
    const engines = [['auto', 'تلقائي'], ['hls', 'HLS'], ['mpegts', 'MPEG-TS'], ['native', 'المشغل الأصلي']];
    const html = `
      <div class="p-sec">المسار الصوتي</div>
      ${audio.length ? audio.map((a) => `<button class="opt ${a.active ? 'on' : ''}" data-a="${a.id}">${esc(a.name)}${a.lang && a.lang !== a.name ? ` <small>${esc(a.lang)}</small>` : ''}</button>`).join('') : '<p class="muted sm pad">مسار صوتي واحد (أو أن المشغل الداخلي لا يتيح التبديل — جرّب المشغل الخارجي).</p>'}
      ${levels.length ? `<div class="p-sec">الجودة</div><button class="opt ${e.autoLevel() ? 'on' : ''}" data-l="-1">تلقائي</button>${levels.map((l) => `<button class="opt ${l.active ? 'on' : ''}" data-l="${l.id}">${esc(l.name)}</button>`).join('')}` : ''}
      <div class="p-sec">محرك التشغيل</div>
      <div class="seg sm wrap">${engines.map(([k, l]) => `<button data-e="${k}" class="${(this.settings.engine || 'auto') === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <p class="muted xs pad">إن تقطّع البث أو لم يعمل جرّب محركًا آخر.</p>
      <div class="p-sec">معلومات</div>
      <div class="kv"><span>الدقة</span><b dir="ltr">${info.width ? `${info.width}×${info.height}` : '—'}</b></div>
      <div class="kv"><span>المحرك الحالي</span><b>${esc(info.engine || '—')}</b></div>
      <div class="kv"><span>معدّل البث</span><b dir="ltr">${info.bitrate ? `${(info.bitrate / 1e6).toFixed(1)} Mbps` : '—'}</b></div>
      <div class="kv"><span>الصيغة</span><b dir="ltr">${esc(urlExt(this.ctx.url || '') || '—')}</b></div>`;
    this.panel('الصوت والجودة', html, (body) => {
      body.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => { e.setAudio(Number(b.dataset.a)); this.panelAudio(); }));
      body.querySelectorAll('[data-l]').forEach((b) => b.addEventListener('click', () => { e.setLevel(Number(b.dataset.l)); this.panelAudio(); }));
      body.querySelectorAll('[data-e]').forEach((b) => b.addEventListener('click', () => {
        this.settings.engine = b.dataset.e;
        this.saveSettings();
        this.hidePanel();
        this.ctx.start = this.live ? 0 : this.video.currentTime;
        this.start();
      }));
    });
  }

  // ———————————————————————————— الترجمة

  clearSubs() {
    this.subs = { cues: [], offset: 0, track: null, label: '' };
    for (const t of Array.from(this.video.textTracks || [])) t.mode = 'disabled';
    $('#pSubs').innerHTML = '';
  }

  /** يفعّل ترجمة مضمّنة باللغة المفضلة تلقائيًا إن وُجدت. */
  autoSubtitle() {
    if (this.subs.cues.length || this.subs.track) return;
    const pref = this.settings.subLang || 'ar';
    const t = this.engine.textTracks().find((x) => (x.lang || '').toLowerCase().startsWith(pref) || /arab|عرب/i.test(x.name));
    if (t) this.useTrack(t.track, t.name);
    else for (const x of this.engine.textTracks()) x.track.mode = 'disabled';
  }

  useTrack(track, label) {
    this.clearSubs();
    track.mode = 'hidden';
    this.subs.track = track;
    this.subs.label = label;
    track.oncuechange = () => this.renderCueList(Array.from(track.activeCues || []).map((c) => c.text));
  }

  loadSubText(text, label) {
    const cues = toCues(text, label);
    if (!cues.length) { toast('الملف لا يحتوي ترجمة مفهومة'); return false; }
    this.clearSubs();
    this.subs.cues = cues;
    this.subs.label = label;
    toast(`تم تحميل الترجمة (${cues.length} سطر)`);
    this.renderSubs();
    return true;
  }

  renderSubs() {
    const s = this.subs;
    if (!s.cues.length) return;
    const t = this.video.currentTime - s.offset;
    const active = [];
    for (const c of s.cues) { if (c.start > t) break; if (c.end >= t) active.push(c.text); }
    this.renderCueList(active);
  }

  renderCueList(texts) {
    const key = texts.join('\n');
    if (key === this.lastCue) return;
    this.lastCue = key;
    const safe = (x) => esc(x).replace(/&lt;(\/?)(i|b|u)&gt;/gi, '<$1$2>').replace(/&lt;[^&]*&gt;/g, '').replace(/\n/g, '<br>');
    $('#pSubs').innerHTML = texts.map((x) => `<span>${safe(x)}</span>`).join('');
  }

  applySubStyle() {
    const st = this.settings;
    const el = $('#pSubs');
    el.style.setProperty('--sub-scale', String((st.subSize || 100) / 100));
    el.style.setProperty('--sub-color', st.subColor || '#ffffff');
    el.dataset.bg = st.subBg || 'shadow';
    el.style.setProperty('--sub-pos', `${st.subPos ?? 8}%`);
  }

  panelSubs() {
    const tracks = this.engine.textTracks();
    const s = this.subs;
    const st = this.settings;
    const colors = ['#ffffff', '#ffe14d', '#7ef9ff', '#9dff7a'];
    const html = `
      <button class="opt ${!s.cues.length && !s.track ? 'on' : ''}" data-s="off">بلا ترجمة</button>
      ${tracks.map((t) => `<button class="opt ${s.track === t.track ? 'on' : ''}" data-s="t${t.id}">${esc(t.name)} <small>مضمّنة</small></button>`).join('')}
      ${s.cues.length ? `<button class="opt on" data-s="ext">${esc(s.label)} <small>ملف</small></button>` : ''}
      <div class="row wrap gap">
        <button class="btn ghost sm" data-s="file">${icon('plus')} ملف من الجهاز</button>
        <button class="btn ghost sm" data-s="os">${icon('search')} بحث أونلاين</button>
      </div>
      ${s.cues.length ? `<div class="p-sec">ضبط التوقيت</div>
      <div class="stepper"><button class="btn ghost sm" data-off="-0.5">−0.5ث</button><b id="subOff">${s.offset > 0 ? '+' : ''}${s.offset.toFixed(1)} ث</b><button class="btn ghost sm" data-off="0.5">+0.5ث</button></div>` : ''}
      <div class="p-sec">المظهر</div>
      <div class="stepper"><button class="btn ghost sm" data-size="-10">أ−</button><b>${st.subSize || 100}%</b><button class="btn ghost sm" data-size="10">أ+</button></div>
      <div class="row gap swatches">${colors.map((c) => `<button class="sw ${(st.subColor || '#ffffff') === c ? 'on' : ''}" data-color="${c}" style="--c:${c}" aria-label="${c}"></button>`).join('')}</div>
      <div class="seg sm">${[['shadow', 'ظل'], ['box', 'خلفية'], ['none', 'بلا']].map(([k, l]) => `<button data-bg="${k}" class="${(st.subBg || 'shadow') === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="stepper"><button class="btn ghost sm" data-pos="-4">${icon('down')}</button><b>الموضع</b><button class="btn ghost sm" data-pos="4">${icon('up')}</button></div>`;
    this.panel('الترجمة', html, (body) => {
      body.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => {
        const v = b.dataset.s;
        if (v === 'off') { this.clearSubs(); this.panelSubs(); } else if (v[0] === 't') {
          const t = tracks.find((x) => `t${x.id}` === v);
          this.useTrack(t.track, t.name); this.panelSubs();
        } else if (v === 'file') { $('#subFile').click(); } else if (v === 'os') this.panelOpenSubs();
      }));
      body.querySelectorAll('[data-off]').forEach((b) => b.addEventListener('click', () => {
        s.offset = Math.round((s.offset + Number(b.dataset.off)) * 10) / 10;
        $('#subOff', body).textContent = `${s.offset > 0 ? '+' : ''}${s.offset.toFixed(1)} ث`;
        this.lastCue = null; this.renderSubs();
      }));
      const save = () => { this.saveSettings(); this.applySubStyle(); this.panelSubs(); };
      body.querySelectorAll('[data-size]').forEach((b) => b.addEventListener('click', () => { st.subSize = Math.max(60, Math.min(220, (st.subSize || 100) + Number(b.dataset.size))); save(); }));
      body.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => { st.subColor = b.dataset.color; save(); }));
      body.querySelectorAll('[data-bg]').forEach((b) => b.addEventListener('click', () => { st.subBg = b.dataset.bg; save(); }));
      body.querySelectorAll('[data-pos]').forEach((b) => b.addEventListener('click', () => { st.subPos = Math.max(2, Math.min(40, (st.subPos ?? 8) + Number(b.dataset.pos))); save(); }));
    });
  }

  async panelOpenSubs() {
    const st = this.settings;
    if (!st.osKey) { toast('أضف مفتاح OpenSubtitles المجاني من الإعدادات ← الترجمة'); return; }
    const c = this.ctx;
    const isEp = c.kind === 'episode';
    const query = isEp ? (c.series.item.title || c.series.item.name) : (c.item.title || c.item.name);
    this.panel('بحث عن ترجمة', `<input class="input" type="search" value="${esc(query)}" data-q /><div class="p-os"><div class="p-loading"><i class="spin"></i></div></div>`, async (body) => {
      const run = async () => {
        const box = $('.p-os', body);
        box.innerHTML = '<div class="p-loading"><i class="spin"></i></div>';
        try {
          const list = await searchOpenSubtitles({
            apiKey: st.osKey, query: $('[data-q]', body).value, year: isEp ? null : c.item.year,
            season: isEp ? c.item.season : null, episode: isEp ? c.item.episode : null,
            languages: st.subLang === 'en' ? 'en,ar' : 'ar,en',
          });
          if (!list.length) { box.innerHTML = '<p class="muted pad">لا نتائج — عدّل العنوان وأعد البحث.</p>'; return; }
          box.innerHTML = list.slice(0, 40).map((x, i) => `<button class="opt" data-i="${i}"><span>${esc(x.name)}<small>${esc(x.lang.toUpperCase())} · ${x.downloads} تنزيل${x.hi ? ' · لضعاف السمع' : ''}</small></span></button>`).join('');
          box.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', async () => {
            const x = list[Number(b.dataset.i)];
            b.classList.add('busy');
            try {
              const text = await downloadOpenSubtitles({ apiKey: st.osKey, fileId: x.fileId });
              if (this.loadSubText(text, x.name)) this.hidePanel();
            } catch (e) { toast(e.message); }
            b.classList.remove('busy');
          }));
        } catch (e) { box.innerHTML = `<p class="muted pad">${esc(e.message)}</p>`; }
      };
      $('[data-q]', body).addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
      run();
    });
  }

  panelMore() {
    const sleepLeft = this.sleepAt ? Math.max(0, Math.round((this.sleepAt - Date.now()) / 60000)) : 0;
    const html = `
      <button class="opt" data-m="restart">${icon('refresh')} <span>${this.live ? 'إعادة تحميل البث' : 'التشغيل من البداية'}</span></button>
      <button class="opt" data-m="lock">${icon('lock')} <span>قفل الشاشة من اللمس</span></button>
      <button class="opt" data-m="external">${icon('ext')} <span>فتح في مشغل خارجي (VLC / MX)</span></button>
      <div class="p-sec">مؤقت النوم ${sleepLeft ? `— متبقٍ ${sleepLeft} د` : ''}</div>
      <div class="seg sm wrap">${[0, 15, 30, 60, 90, 120].map((m) => `<button data-sleep="${m}">${m ? `${m} د` : 'إيقاف'}</button>`).join('')}</div>`;
    this.panel('المزيد', html, (body) => {
      body.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
        const m = b.dataset.m;
        this.hidePanel();
        if (m === 'restart') { this.ctx.start = this.live ? 0 : 1; this.start(); }
        if (m === 'lock') { this.locked = true; this.root.classList.add('locked'); this.hideUi(); toast('الشاشة مقفلة — اضغط مطولًا على القفل لفتحها'); }
        if (m === 'external') this.external();
      }));
      body.querySelectorAll('[data-sleep]').forEach((b) => b.addEventListener('click', () => {
        const m = Number(b.dataset.sleep);
        clearTimeout(this.sleepTimer);
        this.sleepAt = m ? Date.now() + m * 60000 : 0;
        if (m) this.sleepTimer = setTimeout(() => { this.video.pause(); this.close(); }, m * 60000);
        toast(m ? `سيتوقف التشغيل بعد ${m} دقيقة` : 'أُلغي مؤقت النوم');
        this.hidePanel();
      }));
    });
  }

  async external() {
    const url = this.ctx.url || await this.urlFor(this.ctx).catch(() => '');
    if (!url) return;
    if (!isNative) { window.open(url, '_blank'); return; }
    this.video.pause();
    native.openExternal(url, this.titleOf(this.ctx).title, this.uaFor(this.ctx.item));
  }

  // ———————————————————————————— الأحداث

  bind() {
    const v = this.video;
    v.addEventListener('play', () => this.updatePlayIcon());
    v.addEventListener('pause', () => { this.updatePlayIcon(); this.saveProgress(); if (this.isOpen) this.showUi(true); });
    v.addEventListener('playing', () => { this.status(null); $('#pError').hidden = true; this.showResolution(); });
    v.addEventListener('waiting', () => this.status('تحميل مؤقت…'));
    v.addEventListener('timeupdate', () => { this.renderSubs(); if (this.root.classList.contains('ui')) this.updateSeek(); });
    v.addEventListener('ended', () => this.onEnded());
    v.addEventListener('resize', () => this.showResolution());

    this.applySubStyle();
    $('#subFile').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      const text = decodeSubtitle(new Uint8Array(await f.arrayBuffer()));
      if (this.loadSubText(text, f.name)) this.hidePanel();
    });

    this.root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]');
      if (!b) return;
      e.stopPropagation();
      const a = b.dataset.p;
      if (a !== 'panelClose') this.showUi();
      switch (a) {
        case 'close': this.close(); break;
        case 'toggle': this.togglePlay(); break;
        case 'rew': this.seekBy(-10); break;
        case 'fwd': this.seekBy(10); break;
        case 'prev': if (this.ctx.kind === 'live') this.zap(-1); else this.playEpisode(this.episodeAt(-1)); break;
        case 'next': if (this.ctx.kind === 'live') this.zap(1); else this.playEpisode(this.episodeAt(1)); break;
        case 'retry': $('#pError').hidden = true; this.start(); break;
        case 'external': this.external(); break;
        case 'pip': if (isNative) native.pip(this.video.videoWidth || 16, this.video.videoHeight || 9); else if (v.requestPictureInPicture) v.requestPictureInPicture().catch(() => {}); break;
        case 'fav': {
          const id = this.ctx.kind === 'episode' && this.ctx.series ? this.ctx.series.item.id : this.ctx.item.id;
          this.lib.toggleFav(id).then((on) => { this.updateFav(); toast(on ? 'أُضيف إلى المفضلة' : 'أُزيل من المفضلة'); });
          break;
        }
        case 'channels': this.panelChannels(); break;
        case 'episodes': this.panelEpisodes(); break;
        case 'archive': this.panelArchive(); break;
        case 'subs': this.panelSubs(); break;
        case 'audio': this.panelAudio(); break;
        case 'more': this.panelMore(); break;
        case 'aspect': {
          const i = ASPECTS.findIndex((x) => x.id === this.aspect);
          this.aspect = ASPECTS[(i + 1) % ASPECTS.length].id;
          this.settings.aspect = this.aspect; this.saveSettings();
          this.applyAspect();
          toast(`العرض: ${ASPECTS.find((x) => x.id === this.aspect).label}`, 1200);
          break;
        }
        case 'speed': {
          const i = SPEEDS.indexOf(v.playbackRate);
          v.playbackRate = SPEEDS[(i + 1) % SPEEDS.length];
          $('#pSpeedLbl').textContent = `${v.playbackRate}×`;
          break;
        }
        case 'panelClose': this.hidePanel(); break;
        case 'nextNow': clearInterval(this.nextTimer); $('#pNextUp').hidden = true; this.playEpisode(this.episodeAt(1)); break;
        case 'nextCancel': clearInterval(this.nextTimer); $('#pNextUp').hidden = true; this.showUi(true); break;
        default: break;
      }
    });

    this.bindSeekbar();
    this.bindGestures();
    window.addEventListener('resize', () => { if (this.isOpen) this.applyAspect(); });
  }

  showResolution() {
    const r = $('#pRes');
    const h = this.video.videoHeight;
    if (!h) { r.hidden = true; return; }
    r.textContent = h >= 2000 ? '4K' : h >= 1000 ? 'FHD' : h >= 700 ? 'HD' : 'SD';
    r.hidden = false;
  }

  bindSeekbar() {
    const t = $('#pTrack');
    const v = this.video;
    const at = (x) => {
      const r = t.getBoundingClientRect();
      return Math.max(0, Math.min(1, (x - r.left) / r.width));
    };
    let dragging = false;
    t.addEventListener('pointerdown', (e) => {
      if (!Number.isFinite(v.duration)) return;
      dragging = true; t.setPointerCapture(e.pointerId); t.classList.add('drag');
      this.showUi(true);
      t.style.setProperty('--p', `${at(e.clientX) * 100}%`);
    });
    t.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const p = at(e.clientX);
      t.style.setProperty('--p', `${p * 100}%`);
      $('.tip', t).textContent = fmtTime(p * v.duration);
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false; t.classList.remove('drag');
      v.currentTime = at(e.clientX) * v.duration;
      this.showUi();
    };
    t.addEventListener('pointerup', end);
    t.addEventListener('pointercancel', () => { dragging = false; t.classList.remove('drag'); });
    t.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { this.seekBy(-10); e.preventDefault(); e.stopPropagation(); }
      if (e.key === 'ArrowRight') { this.seekBy(10); e.preventDefault(); e.stopPropagation(); }
    });
  }

  /** لمسة: إظهار/إخفاء · لمستان: ±10ث · سحب عمودي يمين: الصوت، يسار: السطوع · سحب أفقي: تقديم. */
  bindGestures() {
    const g = $('#pGesture');
    const v = this.video;
    let start = null; let lastTap = 0; let tapTimer = null; let mode = null;
    let bright = 0.5; let vol = 1; let seekTo = 0;
    const hud = (iconId, val, label) => {
      const h = $('#pHud');
      $('use', h).setAttribute('href', `#i-${iconId}`);
      $('.bar i', h).style.height = `${Math.round(val * 100)}%`;
      $('b', h).textContent = label;
      h.hidden = false;
      clearTimeout(this.hudTimer);
      this.hudTimer = setTimeout(() => { h.hidden = true; }, 900);
    };
    g.addEventListener('pointerdown', async (e) => {
      if (this.locked) { this.showUi(); return; }
      start = { x: e.clientX, y: e.clientY, t: Date.now(), cur: v.currentTime };
      mode = null;
      if (isNative) { const r = await native.getVolume(); if (r && typeof r.value === 'number') vol = r.value; } else vol = v.volume;
    });
    g.addEventListener('pointermove', (e) => {
      if (!start || this.locked) return;
      const dx = e.clientX - start.x; const dy = e.clientY - start.y;
      if (!mode) {
        if (Math.abs(dy) > 18 && Math.abs(dy) > Math.abs(dx)) mode = start.x > innerWidth / 2 ? 'vol' : 'bright';
        else if (Math.abs(dx) > 24 && !this.live && Number.isFinite(v.duration)) mode = 'seek';
        else return;
      }
      if (mode === 'vol') {
        const nv = Math.max(0, Math.min(1, vol - dy / (innerHeight * 0.7)));
        if (isNative) native.setVolume(nv); else v.volume = nv;
        hud('audio', nv, `${Math.round(nv * 100)}%`);
      } else if (mode === 'bright') {
        const nb = Math.max(0.02, Math.min(1, bright - dy / (innerHeight * 0.7)));
        if (isNative) native.brightness(nb); else v.style.filter = `brightness(${0.4 + nb * 1.2})`;
        hud('sun', nb, `${Math.round(nb * 100)}%`);
        start.bright = nb;
      } else if (mode === 'seek') {
        seekTo = Math.max(0, Math.min(v.duration - 1, start.cur + (dx / innerWidth) * Math.min(600, v.duration)));
        const d = seekTo - start.cur;
        this.flashSeek(`${fmtTime(seekTo)}  (${d >= 0 ? '+' : '−'}${fmtTime(Math.abs(d))})`);
      }
    });
    g.addEventListener('pointerup', (e) => {
      if (!start || this.locked) { start = null; return; }
      if (mode === 'seek') v.currentTime = seekTo;
      if (mode === 'bright' && start.bright) bright = start.bright;
      const moved = mode !== null;
      start = null;
      if (moved) return;
      const now = Date.now();
      if (now - lastTap < 280 && !this.live) {
        clearTimeout(tapTimer);
        lastTap = 0;
        const third = innerWidth / 3;
        if (e.clientX < third) this.seekBy(-10);
        else if (e.clientX > 2 * third) this.seekBy(10);
        else this.togglePlay();
        return;
      }
      lastTap = now;
      tapTimer = setTimeout(() => this.toggleUi(), this.live ? 0 : 260);
    });
    // فتح القفل بضغطة مطوّلة
    let holdTimer = null;
    g.addEventListener('pointerdown', () => { if (this.locked) holdTimer = setTimeout(() => { this.locked = false; this.root.classList.remove('locked', 'ui-lock'); toast('فُتح القفل'); this.showUi(); }, 1200); });
    g.addEventListener('pointerup', () => clearTimeout(holdTimer));
  }

  /** مفاتيح الريموت ولوحة المفاتيح. يعيد true إن استُهلك المفتاح. */
  handleKey(e) {
    if (!this.isOpen) return false;
    const k = e.key;
    const uiOn = this.root.classList.contains('ui');
    const panelOn = !$('#pPanel').hidden;
    if (this.locked) { this.showUi(); return true; }
    if (/^[0-9]$/.test(k) && this.ctx.kind === 'live' && !panelOn && !(e.target instanceof HTMLInputElement)) {
      this.digits += k;
      const z = $('#pZap');
      z.innerHTML = `<b class="digits">${this.digits}</b>`; z.hidden = false;
      clearTimeout(this.digitTimer);
      this.digitTimer = setTimeout(() => { const n = Number(this.digits); this.digits = ''; z.hidden = true; this.zapTo(n); }, 1400);
      return true;
    }
    if (k === 'MediaPlayPause' || (k === ' ' && !(e.target instanceof HTMLInputElement))) { this.togglePlay(); return true; }
    if (k === 'MediaPlay') { v_play(this.video); return true; }
    if (k === 'MediaPause') { this.video.pause(); return true; }
    if (k === 'MediaFastForward') { this.seekBy(30); return true; }
    if (k === 'MediaRewind') { this.seekBy(-30); return true; }
    if (k === 'ChannelUp' || k === 'PageUp' || k === 'MediaTrackNext') { this.live ? this.zap(1) : this.playEpisode(this.episodeAt(1)); return true; }
    if (k === 'ChannelDown' || k === 'PageDown' || k === 'MediaTrackPrevious') { this.live ? this.zap(-1) : this.playEpisode(this.episodeAt(-1)); return true; }
    if (panelOn || !$('#pError').hidden || !$('#pNextUp').hidden) {
      if (KEYDIR[k]) { moveFocus(KEYDIR[k], panelOn ? $('#pPanel') : this.root); return true; }
      return false;
    }
    if (!uiOn) {
      if (k === 'Enter' || k === 'OK' || k === 'Select') { this.showUi(); setTimeout(() => $('[data-p=toggle]', this.root).focus(), 0); return true; }
      if (k === 'ArrowLeft') { if (this.live) this.showUi(); else this.seekBy(-10); return true; }
      if (k === 'ArrowRight') { if (this.live) this.showUi(); else this.seekBy(10); return true; }
      if (k === 'ArrowUp') { if (this.live) this.zap(1); else this.showUi(); return true; }
      if (k === 'ArrowDown') { if (this.live) this.zap(-1); else this.showUi(); return true; }
      return false;
    }
    if (KEYDIR[k]) {
      this.showUi();
      if (!this.root.contains(document.activeElement) || document.activeElement === document.body) $('[data-p=toggle]', this.root).focus();
      else moveFocus(KEYDIR[k], $('#pUi'));
      return true;
    }
    return false;
  }

  /** زر الرجوع: يغلق الطبقة الأعلى أولًا. */
  back() {
    if (!this.isOpen) return false;
    if (!$('#pNextUp').hidden) { clearInterval(this.nextTimer); $('#pNextUp').hidden = true; return true; }
    if (this.hidePanel()) return true;
    if (this.locked) { this.showUi(); return true; }
    if (this.root.classList.contains('ui')) { this.hideUi(true); return true; }
    this.close();
    return true;
  }
}

function v_play(v) { v.play().catch(() => {}); }

export { ASPECTS };
