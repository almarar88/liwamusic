/* LiwaTube — المشغّل: تحكّم مخصّص بأسلوب يوتيوب، فصول، ترجمات، اختصارات، PiP، مسرح، مشغّل مصغّر. */
'use strict';
(function (LT) {
  const { $, h, fmtTime, t } = LT;
  const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

  const P = {
    root: null, video: null, el: {}, current: null, chapters: [], tracks: [], theater: false,
    hideTimer: null, progressTimer: null, dragging: false, menu: null,
    handlers: { ended: [], next: [], progress: [], state: [] },
    on(ev, fn) { this.handlers[ev].push(fn); },
    emit(ev, ...a) { for (const fn of this.handlers[ev]) fn(...a); },
  };

  function build() {
    if (P.root) return P.root;
    const tpl = $('#playerTpl');
    P.root = tpl.content.firstElementChild.cloneNode(true);
    const ids = ['video', 'pOverlay', 'pCenter', 'pFlash', 'pSpinner', 'pError', 'pControls', 'pBar', 'pBuffer', 'pPlayed', 'pChapters', 'pKnob', 'pTip',
      'pPlay', 'pNext', 'pMute', 'pVolume', 'pTime', 'pChapterName', 'pRate', 'pCC', 'pPip', 'pTheater', 'pFull'];
    for (const id of ids) P.el[id] = P.root.querySelector(`#${id}`);
    P.video = P.el.video;
    wire();
    return P.root;
  }

  const flash = (txt) => { const f = P.el.pFlash; f.textContent = txt; f.classList.add('show'); clearTimeout(f._t); f._t = setTimeout(() => f.classList.remove('show'), 600); };
  const showUi = () => {
    P.root.classList.add('show-ui'); P.root.classList.remove('hide-cursor');
    clearTimeout(P.hideTimer);
    P.hideTimer = setTimeout(() => { if (!P.video.paused && !P.menu) { P.root.classList.remove('show-ui'); P.root.classList.add('hide-cursor'); } }, 2600);
  };
  const setIcon = (btn, name) => { btn.innerHTML = ''; btn.append(LT.icon(name)); };

  function wire() {
    const v = P.video; const e = P.el;
    v.addEventListener('play', () => { P.root.classList.remove('paused'); setIcon(e.pPlay, 'pause'); P.emit('state', 'play'); });
    v.addEventListener('pause', () => { if (P.fixing) return; P.root.classList.add('paused'); setIcon(e.pPlay, 'play'); P.emit('state', 'pause'); saveProgress(); });
    v.addEventListener('waiting', () => { e.pSpinner.hidden = false; });
    v.addEventListener('playing', () => { e.pSpinner.hidden = true; });
    v.addEventListener('canplay', () => { e.pSpinner.hidden = true; });
    v.addEventListener('timeupdate', updateTime);
    v.addEventListener('progress', updateBuffer);
    v.addEventListener('durationchange', () => { updateTime(); renderChapters(); });
    v.addEventListener('loadedmetadata', async () => {
      P.root.classList.toggle('portrait', v.videoHeight > v.videoWidth); e.pError.hidden = true;
      if (!Number.isFinite(v.duration)) {
        // القفز إلى النهاية يطلق 'ended' زورًا — نتجاهله أثناء الإصلاح
        P.fixing = true;
        const wasPaused = v.paused; const want = P.pendingSeek || 0;
        await LT.thumbs.fixDuration(v);
        if (want) v.currentTime = want;
        if (!wasPaused) v.play().catch(() => {});
        P.fixing = false;
        renderChapters(); updateTime();
      }
    });
    v.addEventListener('ended', () => { if (P.fixing) return; saveProgress(true); P.emit('ended', P.current); });
    v.addEventListener('error', () => {
      e.pSpinner.hidden = true;
      e.pError.hidden = false;
      e.pError.textContent = t('unplayable');
    });
    v.addEventListener('volumechange', () => {
      e.pVolume.value = v.muted ? 0 : v.volume;
      setIcon(e.pMute, v.muted || v.volume === 0 ? 'M16.5 12A4.5 4.5 0 0014 8v2.2l2.45 2.45c.03-.2.05-.42.05-.65zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0021 12a9 9 0 00-7-8.77v2.06A7 7 0 0119 12zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25A6.9 6.9 0 0114 18.7v2.06a9 9 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z' : 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 8v8a4.5 4.5 0 002.5-4zM14 3.2v2.1a7 7 0 010 13.4v2.1a9 9 0 000-17.6z');
      window.liwa.settings.set({ volume: v.volume, muted: v.muted });
    });
    v.addEventListener('ratechange', () => { e.pRate.textContent = `${v.playbackRate}x`; });
    v.addEventListener('enterpictureinpicture', () => e.pPip.classList.add('on'));
    v.addEventListener('leavepictureinpicture', () => e.pPip.classList.remove('on'));

    e.pOverlay.addEventListener('click', () => { closeMenu(); toggle(); });
    e.pOverlay.addEventListener('dblclick', (ev) => { ev.preventDefault(); toggleFull(); });
    e.pPlay.addEventListener('click', toggle);
    e.pNext.addEventListener('click', () => P.emit('next'));
    e.pMute.addEventListener('click', () => { v.muted = !v.muted; flash(v.muted ? '🔇' : `${Math.round(v.volume * 100)}%`); });
    e.pVolume.addEventListener('input', () => { v.volume = Number(e.pVolume.value); v.muted = v.volume === 0; });
    e.pRate.addEventListener('click', () => menu(RATES.map((r) => ({ label: r === 1 ? t('normal') : `${r}x`, on: v.playbackRate === r, onClick: () => setRate(r) }))));
    e.pCC.addEventListener('click', () => menu([{ label: t('off'), on: !activeTrack(), onClick: () => selectTrack(-1) }, ...P.tracks.map((tr, i) => ({ label: tr.label, on: activeTrack() === i, onClick: () => selectTrack(i) }))]));
    e.pPip.addEventListener('click', togglePip);
    e.pTheater.addEventListener('click', () => setTheater(!P.theater));
    e.pFull.addEventListener('click', toggleFull);
    P.root.addEventListener('mousemove', showUi);
    P.root.addEventListener('mouseleave', () => { if (!v.paused) P.root.classList.remove('show-ui'); });
    P.root.addEventListener('contextmenu', (ev) => ev.preventDefault());

    // شريط التقدّم
    const posOf = (ev) => {
      const r = e.pBar.getBoundingClientRect();
      let x = (ev.clientX - r.left) / r.width;
      if (document.documentElement.dir === 'rtl') x = 1 - x;
      return Math.max(0, Math.min(1, x));
    };
    e.pBar.addEventListener('mousedown', (ev) => { P.dragging = true; seek(posOf(ev) * (v.duration || 0)); ev.preventDefault(); });
    window.addEventListener('mousemove', (ev) => { if (P.dragging) seek(posOf(ev) * (v.duration || 0)); });
    window.addEventListener('mouseup', () => { P.dragging = false; });
    e.pBar.addEventListener('mousemove', (ev) => {
      const p = posOf(ev); const tt = p * (v.duration || 0);
      e.pTip.hidden = false;
      const ch = chapterAt(tt);
      e.pTip.innerHTML = `${ch ? `<b>${LT.esc(ch.label)}</b>` : ''}${fmtTime(tt)}`;
      e.pTip.style.insetInlineStart = `${p * 100}%`;
    });
    e.pBar.addEventListener('mouseleave', () => { e.pTip.hidden = true; });
    document.addEventListener('fullscreenchange', () => { e.pFull.classList.toggle('on', Boolean(document.fullscreenElement)); });
  }

  function menu(items) {
    closeMenu();
    const m = h('div.p-menu', items.map((it) => h('button', { class: it.on ? 'on' : '', onclick: () => { closeMenu(); it.onClick(); } }, it.on ? LT.icon('check', 16) : h('span', { style: { width: '16px' } }), it.label)));
    P.root.append(m); P.menu = m;
    setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
  }
  function closeMenu() { if (P.menu) { P.menu.remove(); P.menu = null; } }

  function updateTime() {
    const v = P.video; const e = P.el;
    const d = Number.isFinite(v.duration) ? v.duration : 0; const c = v.currentTime || 0;
    const p = d ? (c / d) * 100 : 0;
    e.pPlayed.style.width = `${p}%`;
    e.pKnob.style.insetInlineStart = `${p}%`;
    e.pTime.textContent = `${fmtTime(c)} / ${fmtTime(d)}`;
    const ch = chapterAt(c);
    e.pChapterName.textContent = ch ? `• ${ch.label}` : '';
    P.emit('progress', c, d);
  }
  function updateBuffer() {
    const v = P.video; const d = Number.isFinite(v.duration) ? v.duration : 0;
    if (!d || !v.buffered.length) return;
    let end = 0;
    for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 0.5) end = Math.max(end, v.buffered.end(i));
    P.el.pBuffer.style.width = `${(end / d) * 100}%`;
  }
  const chapterAt = (tt) => { let cur = null; for (const c of P.chapters) if (c.t <= tt) cur = c; return cur; };
  function renderChapters() {
    const d = P.video.duration || 0; const box = P.el.pChapters;
    box.innerHTML = '';
    if (!d) return;
    for (const c of P.chapters) if (c.t > 0 && c.t < d) box.append(h('i', { style: { insetInlineStart: `${(c.t / d) * 100}%` } }));
  }

  let lastSave = 0;
  function saveProgress(force) {
    const v = P.video;
    if (!P.current || !v.duration) return;
    const now = Date.now();
    if (!force && now - lastSave < 5000) return;
    lastSave = now;
    window.liwa.user.progress(P.current.id, v.ended ? v.duration : v.currentTime, v.duration);
  }

  // ---------- واجهة عامة
  function load(video, { resumeAt = 0, autoplay = true, chapters = [], tracks = [] } = {}) {
    build();
    const v = P.video;
    if (P.current && P.current.id !== video.id) saveProgress(true);
    P.current = video;
    P.el.pError.hidden = true;
    P.chapters = chapters || [];
    v.src = video.url;
    setTracks(tracks);
    v.playbackRate = Number(LT.state?.settings?.rate) || 1;
    P.el.pRate.textContent = `${v.playbackRate}x`;
    P.pendingSeek = resumeAt > 3 ? resumeAt : 0;
    if (resumeAt > 3) {
      v.currentTime = resumeAt;
      LT.toast(`${t('resumeToast')} ${fmtTime(resumeAt)}`, { ms: 2500 });
    }
    renderChapters();
    if (autoplay) v.play().catch(() => {});
    window.liwa.user.played(video.id).then((n) => P.emit('state', 'played', n));
    showUi();
  }
  function setTracks(tracks) {
    const v = P.video;
    for (const tr of [...v.querySelectorAll('track')]) tr.remove();
    P.tracks = tracks || [];
    for (const tr of P.tracks) v.append(h('track', { kind: 'subtitles', label: tr.label, srclang: tr.lang, src: tr.url }));
    P.el.pCC.hidden = !P.tracks.length;
    const want = LT.state?.settings?.captions && P.tracks.length ? 0 : -1;
    setTimeout(() => selectTrack(want), 50);
  }
  function activeTrack() { const tt = P.video.textTracks; for (let i = 0; i < tt.length; i++) if (tt[i].mode === 'showing') return i; return null; }
  function selectTrack(i) {
    const tt = P.video.textTracks;
    for (let k = 0; k < tt.length; k++) tt[k].mode = k === i ? 'showing' : 'disabled';
    P.el.pCC.classList.toggle('on', i >= 0);
  }
  function setChapters(ch) { P.chapters = ch || []; renderChapters(); updateTime(); }
  const play = () => P.video.play().catch(() => {});
  const pause = () => P.video.pause();
  const toggle = () => { if (!P.current) return; if (P.video.paused) { play(); flash('▶'); } else { pause(); flash('❚❚'); } };
  const seek = (tt) => { const v = P.video; v.currentTime = Math.max(0, Math.min(tt, v.duration || tt)); updateTime(); };
  const seekBy = (d) => { seek(P.video.currentTime + d); flash(`${d > 0 ? '⏩' : '⏪'} ${Math.abs(d)}s`); };
  const setRate = (r) => { P.video.playbackRate = r; flash(`${r}x`); window.liwa.settings.set({ rate: r }); };
  const setVolume = (x) => { const v = P.video; v.volume = Math.max(0, Math.min(1, x)); v.muted = v.volume === 0; flash(`${Math.round(v.volume * 100)}%`); };
  async function togglePip() { try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await P.video.requestPictureInPicture(); } catch { /* غير مدعوم */ } }
  function toggleFull() {
    if (document.fullscreenElement) { document.exitFullscreen(); window.liwa.window.fullscreen(false); }
    else { P.root.requestFullscreen().catch(() => {}); window.liwa.window.fullscreen(true); }
  }
  function setTheater(on) {
    P.theater = Boolean(on);
    P.el.pTheater.classList.toggle('on', P.theater);
    document.dispatchEvent(new CustomEvent('lt:theater', { detail: P.theater }));
  }
  function stopPlayback() { saveProgress(true); P.video.pause(); P.video.removeAttribute('src'); P.video.load(); P.current = null; }

  /** ينقل عنصر المشغّل إلى حاوية أخرى (صفحة المشاهدة ↔ المشغّل المصغّر) دون إعادة التحميل. */
  function mount(container) { build(); if (P.root.parentElement !== container) container.append(P.root); return P.root; }

  // ---------- اختصارات لوحة المفاتيح
  document.addEventListener('keydown', (ev) => {
    if (!P.current) return;
    const tag = (ev.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || ev.target.isContentEditable) return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const v = P.video;
    const k = ev.key.toLowerCase();
    const handled = () => { ev.preventDefault(); showUi(); };
    if (ev.code === 'Space' || k === 'k') { toggle(); return handled(); }
    if (k === 'arrowleft') { seekBy(document.documentElement.dir === 'rtl' ? 5 : -5); return handled(); }
    if (k === 'arrowright') { seekBy(document.documentElement.dir === 'rtl' ? -5 : 5); return handled(); }
    if (k === 'j') { seekBy(-10); return handled(); }
    if (k === 'l') { seekBy(10); return handled(); }
    if (k === 'arrowup') { setVolume(v.volume + 0.05); return handled(); }
    if (k === 'arrowdown') { setVolume(v.volume - 0.05); return handled(); }
    if (k === 'm') { v.muted = !v.muted; flash(v.muted ? '🔇' : '🔊'); return handled(); }
    if (k === 'f') { toggleFull(); return handled(); }
    if (k === 't') { setTheater(!P.theater); return handled(); }
    if (k === 'i') { togglePip(); return handled(); }
    if (k === 'c' && P.tracks.length) { selectTrack(activeTrack() == null ? 0 : -1); return handled(); }
    if (k === 'n' && ev.shiftKey) { P.emit('next'); return handled(); }
    if (k === '.' && v.paused) { seek(v.currentTime + 1 / 30); return handled(); }
    if (k === ',' && v.paused) { seek(v.currentTime - 1 / 30); return handled(); }
    if (k === '>' || (k === '.' && ev.shiftKey)) { setRate(RATES[Math.min(RATES.length - 1, RATES.indexOf(v.playbackRate) + 1)] || 1); return handled(); }
    if (k === '<' || (k === ',' && ev.shiftKey)) { setRate(RATES[Math.max(0, RATES.indexOf(v.playbackRate) - 1)] || 1); return handled(); }
    if (/^[0-9]$/.test(k)) { seek((Number(k) / 10) * (v.duration || 0)); return handled(); }
    if (k === 'home') { seek(0); return handled(); }
    if (k === 'end') { seek(v.duration || 0); return handled(); }
    if (k === 'escape' && P.theater) { setTheater(false); return handled(); }
  });

  LT.player = {
    mount, load, play, pause, toggle, seek, seekBy, setRate, setChapters, setTracks, setTheater, stop: stopPlayback,
    on: (ev, fn) => P.on(ev, fn), current: () => P.current, video: () => P.video, isTheater: () => P.theater, root: () => build(),
    applyVolume: (vol, muted) => { build(); P.video.volume = vol; P.video.muted = muted; },
  };
})(window.LT);
