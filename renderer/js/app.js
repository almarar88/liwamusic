/* LiwaMusic — الواجهة الرئيسية: الحالة، التنقّل، التشغيل، الإنترنت، والذكاء الاصطناعي.
   تم إنشاؤه عن طريق LiwaMusic. */
'use strict';
(function (LM) {
  const { $, el, fmtTime, artUrl, toast } = LM;
  const api = window.liwa;

  const NAV = [
    { id: 'home', label: 'الرئيسية', icon: 'M4 11l8-7 8 7v9H4z' },
    { id: 'tracks', label: 'كل الأغاني', icon: 'M9 18V6l10-2v12M9 18a3 3 0 11-2 2.8M19 16a3 3 0 11-2 2.8' },
    { id: 'albums', label: 'الألبومات', icon: 'M12 3a9 9 0 100 18 9 9 0 000-18zm0 7a2 2 0 110 4 2 2 0 010-4z' },
    { id: 'artists', label: 'الفنانون', icon: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0' },
    { id: 'genres', label: 'الأنواع', icon: 'M4 6h16M4 12h16M4 18h10' },
    { id: 'playlists', label: 'قوائم التشغيل', icon: 'M4 6h11M4 12h11M4 18h7M17 10v8M17 10l4-1v8' },
    { id: 'favorites', label: 'المفضلة', icon: 'M12 21s-7-4.5-9.3-8.4C.7 9.3 2.4 5.5 6 5.5c2 0 3.3 1.1 4 2.2.7-1.1 2-2.2 4-2.2 3.6 0 5.3 3.8 3.3 7.1C19 16.5 12 21 12 21z' },
    { id: 'history', label: 'السجل', icon: 'M12 7v5l3 2M3 12a9 9 0 109-9 9 9 0 00-8 5' },
    { id: 'stats', label: 'الإحصاءات', icon: 'M5 20V10M12 20V4M19 20v-6' },
    { id: 'ai', label: 'الذكاء الاصطناعي', icon: 'M12 2l1.9 5.1L19 9l-5.1 1.9L12 16l-1.9-5.1L5 9l5.1-1.9L12 2z' },
    { id: 'settings', label: 'الإعدادات', icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM4 12l-1.5 2 2 3.4 2.4-.4 1.7 1.7.4 2.4h4l.4-2.4 1.7-1.7 2.4.4 2-3.4L20 12l1.5-2-2-3.4-2.4.4-1.7-1.7L15 3h-4l-.4 2.4-1.7 1.7L6.5 6.6l-2 3.4z' },
  ];

  const state = {
    appInfo: null,
    settings: {},
    tracks: [],
    byId: new Map(),
    folders: [],
    playlists: [],
    userdata: { favorites: {}, ratings: {}, playCount: {}, lastPlayed: {}, ai: {}, overrides: {}, history: [] },
    view: 'home',
    filter: { q: '', genre: null, artist: null, album: null, playlist: null, ids: null, label: '' },
    sort: { key: 'title', dir: 1 },
    queue: [],
    queueIndex: -1,
    currentId: null,
    lyrics: null,
    artistInfo: null,
    onlineMeta: null,
    insights: '',
    dj: null,
    aiStatus: {},
    rpTab: 'now',
    scanning: false,
  };

  const app = {
    state,
    engine: null,
    _vl: null,
    _crossPending: false,
    _lyIdx: -1,

    // ————————————————————————————— الإقلاع
    async init() {
      this.engine = new LM.Engine({
        onState: (s) => this.onPlayState(s),
        onTime: (pos, dur) => this.onTime(pos, dur),
        onEnded: () => this.next(true),
        onTrack: (t) => this.onTrackChanged(t),
        onCrossfade: (sec) => this.doCrossfade(sec),
        onError: (t, err) => this.onPlayError(t, err),
        onSleep: () => toast('انتهى مؤقت النوم — تم إيقاف التشغيل.', 'info'),
      });

      state.appInfo = await api.app.info();
      state.settings = await api.settings.get();
      LM.i18n.setLang(state.settings.lang || 'ar');
      this.applyTheme();
      this.applyEngineSettings();

      const lib = await api.library.get();
      this.ingestLibrary(lib);

      try { state.aiStatus = await api.ai.status(); } catch { state.aiStatus = { hasKey: false }; }

      this.buildNav();
      this.applyAiVisibility();
      this.wireChrome();
      this.wirePlayerControls();
      this.wireKeyboard();
      this.wireDragDrop();
      this.wireIpc();
      this.startVisualizer();

      this.go(state.settings.lastView || 'home');
      this.renderRight();
      this.restoreSession();
      this.checkOnline();
      setInterval(() => this.persistPosition(), 5000);
    },

    ingestLibrary(lib) {
      state.folders = lib.folders || [];
      state.userdata = Object.assign(state.userdata, lib.userdata || {});
      state.playlists = lib.playlists || [];
      const overrides = state.userdata.overrides || {};
      state.tracks = (lib.tracks || []).map((t) => (overrides[t.id] ? { ...t, ...overrides[t.id] } : t));
      state.byId = new Map(state.tracks.map((t) => [t.id, t]));
    },

    // ————————————————————————————— الواجهة العامة
    /** هل ميزات الذكاء الاصطناعي مفعّلة؟ (مغلقة افتراضيًا — تتطلب مفتاحًا مدفوعًا) */
    aiOn() { return !!state.settings.aiEnabled; },

    /** يُظهر أو يخفي كل مداخل الذكاء الاصطناعي في الواجهة. */
    applyAiVisibility() {
      const on = this.aiOn();
      const searchBtn = $('#aiSearchBtn');
      const plBtn = $('#btnAiPlaylist');
      if (searchBtn) searchBtn.hidden = !on;
      if (plBtn) plBtn.hidden = !on;
      this.buildNav();
    },

    async setAiEnabled(on) {
      await this.setSetting({ aiEnabled: !!on });
      this.applyAiVisibility();
      if (!on && state.view === 'ai') this.go('settings'); else this.render();
      LM.toast(on ? 'فُعّلت ميزات الذكاء الاصطناعي.' : 'أُغلقت ميزات الذكاء الاصطناعي.', 'ok');
    },

    buildNav() {
      const nav = $('#nav');
      nav.innerHTML = '';
      for (const item of NAV) {
        if (item.id === 'ai' && !this.aiOn()) continue;
        nav.append(el('button', {
          class: `nav-item${state.view === item.id ? ' active' : ''}`,
          dataset: { view: item.id },
          onclick: () => this.go(item.id),
        },
        el('span', { class: 'nav-ico', html: `<svg viewBox="0 0 24 24" width="17" height="17"><path d="${item.icon}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>` }),
        el('span', { class: 'nav-l', text: item.label })));
      }
    },

    go(view) {
      if (view === 'ai' && !this.aiOn()) view = 'settings';
      if (view !== 'tracks') state.filter.ids = null;
      state.view = view;
      $('#nav').querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
      api.settings.set({ lastView: view }).catch(() => {});
      this.render();
      $('#content').scrollTop = 0;
    },

    render() {
      const host = $('#view');
      if (this._vl) { this._vl.destroy(); this._vl = null; }
      host.innerHTML = '';
      const V = LM.Views;
      const map = {
        home: V.home, tracks: V.tracksView, albums: V.albumsView, artists: V.artistsView,
        genres: V.genresView, playlists: state.filter.playlist ? V.playlistDetail : V.playlistsView,
        favorites: V.favoritesView, history: V.historyView, stats: V.statsView,
        ai: LM.Panels.aiPage, settings: LM.Panels.settingsPage,
      };
      host.append((map[state.view] || V.home)(this));
      this.renderSidebar();
      this.renderCrumb();
    },

    renderCrumb() {
      const f = state.filter;
      const bits = [];
      if (f.label) bits.push(f.label);
      if (f.genre) bits.push(`النوع: ${f.genre}`);
      if (f.q) bits.push(`بحث: ${f.q}`);
      const crumb = $('#tbCrumb');
      crumb.innerHTML = '';
      if (bits.length) {
        crumb.append(el('span', { class: 'crumb', text: bits.join(' · ') }));
        crumb.append(el('button', { class: 'crumb-x', text: '✕', title: 'إزالة الفلاتر', onclick: () => this.clearFilters() }));
      }
    },

    clearFilters() {
      state.filter = { q: '', genre: null, artist: null, album: null, playlist: null, ids: null, label: '' };
      $('#search').value = '';
      this.render();
    },

    renderSidebar() {
      const pl = $('#playlistList');
      pl.innerHTML = '';
      for (const p of state.playlists.slice(0, 30)) {
        pl.append(el('button', {
          class: `side-item${state.filter.playlist === p.id ? ' active' : ''}`,
          onclick: () => this.openPlaylist(p.id),
          oncontextmenu: (e) => { e.preventDefault(); this.playlistMenu(e, p); },
        }, el('span', { class: 'si-t', text: p.name }), el('span', { class: 'si-c muted', text: String(p.tracks.length) })));
      }
      if (!state.playlists.length) pl.append(el('p', { class: 'muted xs pad', text: 'لا توجد قوائم بعد.' }));

      const fl = $('#folderList');
      fl.innerHTML = '';
      for (const f of state.folders) {
        const name = f.split(/[\\/]/).filter(Boolean).pop() || f;
        fl.append(el('button', {
          class: 'side-item', title: f,
          onclick: () => { state.filter.ids = state.tracks.filter((t) => t.path.startsWith(f)).map((t) => t.id); state.filter.label = name; this.go('tracks'); },
        }, el('span', { class: 'si-t', text: name })));
      }
      if (!state.folders.length) fl.append(el('p', { class: 'muted xs pad', text: 'لم تُضف مجلدات.' }));
    },

    renderRight() { LM.Panels.render(this, state.rpTab); },

    // ————————————————————————————— الفلترة والترتيب
    visibleTracks() {
      const f = state.filter;
      const ud = state.userdata;
      let items = state.tracks;
      if (f.ids) {
        const set = new Set(f.ids);
        items = items.filter((t) => set.has(t.id));
      }
      if (f.genre) items = items.filter((t) => (t.genre || '') === f.genre || (ud.ai[t.id]?.genres || []).includes(f.genre));
      if (f.artist) items = items.filter((t) => (t.artist === f.artist || t.albumArtist === f.artist));
      if (f.album) items = items.filter((t) => t.album === f.album);
      if (f.q) {
        const q = LM.norm(f.q);
        const words = q.split(' ').filter(Boolean);
        items = items.filter((t) => {
          const hay = LM.norm([t.title, t.artist, t.album, t.genre, t.file, ud.ai[t.id]?.mood].join(' '));
          return words.every((w) => hay.includes(w));
        });
      }
      const { key, dir } = state.sort;
      const val = (t) => {
        switch (key) {
          case 'playCount': return ud.playCount[t.id] || 0;
          case 'rating': return ud.ratings[t.id] || 0;
          case 'lastPlayed': return ud.lastPlayed[t.id] || 0;
          case 'duration': return t.duration || 0;
          case 'year': return t.year || 0;
          case 'addedAt': return t.addedAt || 0;
          default: return String(t[key] || '').toLowerCase();
        }
      };
      return [...items].sort((a, b) => {
        const va = val(a); const vb = val(b);
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
        return String(va).localeCompare(String(vb), 'ar') * dir;
      });
    },

    libraryStats() {
      const t = state.tracks;
      return {
        tracks: t.length,
        artists: new Set(t.map((x) => x.artist).filter(Boolean)).size,
        albums: new Set(t.map((x) => x.album).filter(Boolean)).size,
        duration: t.reduce((a, x) => a + (x.duration || 0), 0),
        size: t.reduce((a, x) => a + (x.size || 0), 0),
      };
    },

    shuffleArray(arr) {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },

    currentTrack() { return state.currentId ? state.byId.get(state.currentId) : null; },

    // ————————————————————————————— التشغيل
    async playTrack(id, ids = null, opts = {}) {
      const list = ids && ids.length ? ids : [id];
      state.queue = state.settings.shuffle && list.length > 1
        ? [id, ...this.shuffleArray(list.filter((x) => x !== id))]
        : [...list];
      state.queueIndex = Math.max(0, state.queue.indexOf(id));
      await this.loadCurrent(opts);
    },

    async playList(ids, { shuffle = false } = {}) {
      if (!ids || !ids.length) return;
      const order = (shuffle || state.settings.shuffle) ? this.shuffleArray(ids) : [...ids];
      state.queue = order;
      state.queueIndex = 0;
      await this.loadCurrent();
    },

    async loadCurrent({ position = 0, autoplay = true } = {}) {
      const id = state.queue[state.queueIndex];
      const track = state.byId.get(id);
      if (!track) return;
      try {
        const url = await api.media.audioUrl(id);
        await this.engine.load(track, url, { autoplay, position });
        state.currentId = id;
        if (autoplay) api.user.played(id).then((n) => { state.userdata.playCount[id] = n; state.userdata.lastPlayed[id] = Date.now(); });
        this.preloadNext();
      } catch (err) {
        toast(`تعذّر تشغيل الملف: ${err.message}`, 'err');
      }
    },

    async preloadNext() {
      const nextId = this.peekNextId();
      if (!nextId) return;
      const t = state.byId.get(nextId);
      if (!t) return;
      try { this.engine.preload(t, await api.media.audioUrl(nextId)); } catch { /* تجاهل */ }
    },

    peekNextId() {
      if (state.settings.repeat === 'one') return state.queue[state.queueIndex];
      const i = state.queueIndex + 1;
      if (i < state.queue.length) return state.queue[i];
      return state.settings.repeat === 'all' ? state.queue[0] : null;
    },

    async next(auto = false) {
      if (state.settings.repeat === 'one' && auto) {
        this.engine.seek(0); this.engine.play(); return;
      }
      if (state.queueIndex + 1 < state.queue.length) {
        state.queueIndex++;
      } else if (state.settings.repeat === 'all' && state.queue.length) {
        state.queueIndex = 0;
      } else {
        this.engine.pause();
        return;
      }
      await this.loadCurrent();
      if (state.rpTab === 'queue') this.renderRight();
    },

    async prev() {
      if (this.engine.position > 4) { this.engine.seek(0); return; }
      if (state.queueIndex > 0) state.queueIndex--;
      else if (state.settings.repeat === 'all') state.queueIndex = state.queue.length - 1;
      else { this.engine.seek(0); return; }
      await this.loadCurrent();
      if (state.rpTab === 'queue') this.renderRight();
    },

    /** يبدأ التلاشي المتقاطع نحو الأغنية التالية. */
    async doCrossfade(sec) {
      if (this._crossPending) return;
      const nextId = this.peekNextId();
      if (!nextId || nextId === state.currentId) return;
      this._crossPending = true;
      try {
        const t = state.byId.get(nextId);
        const url = await api.media.audioUrl(nextId);
        await this.engine.crossTo(t, url, sec);
        state.queueIndex = state.queue.indexOf(nextId) >= 0
          ? state.queue.indexOf(nextId) : Math.min(state.queueIndex + 1, state.queue.length - 1);
        state.currentId = nextId;
        api.user.played(nextId).catch(() => {});
        this.preloadNext();
      } catch { /* نتجاهل ونكمل عاديًا */ } finally {
        setTimeout(() => { this._crossPending = false; }, sec * 1000 + 400);
      }
    },

    enqueue(ids) {
      const add = ids.filter((id) => state.byId.has(id));
      state.queue.push(...add);
      toast(`أُضيفت ${add.length} أغنية إلى الطابور`, 'ok');
      if (state.rpTab === 'queue') this.renderRight();
      if (state.queueIndex === -1 && state.queue.length) { state.queueIndex = 0; this.loadCurrent(); }
    },

    playNext(id) {
      state.queue.splice(state.queueIndex + 1, 0, id);
      toast('ستُشغَّل بعد الأغنية الحالية', 'ok');
      if (state.rpTab === 'queue') this.renderRight();
      this.preloadNext();
    },

    clearQueue() {
      state.queue = state.currentId ? [state.currentId] : [];
      state.queueIndex = state.queue.length ? 0 : -1;
      this.renderRight();
    },

    removeFromQueue(i) {
      state.queue.splice(i, 1);
      if (i < state.queueIndex) state.queueIndex--;
      this.renderRight();
    },

    moveQueue(from, to) {
      if (from === to) return;
      const [item] = state.queue.splice(from, 1);
      state.queue.splice(to, 0, item);
      const cur = state.currentId;
      state.queueIndex = state.queue.indexOf(cur);
      this.renderRight();
    },

    async jumpQueue(i) {
      state.queueIndex = i;
      await this.loadCurrent();
      this.renderRight();
    },

    seek(sec) { this.engine.seek(sec); },

    // ————————————————————————————— أحداث المشغل
    onPlayState(s) {
      const icon = $('#playIcon');
      const playing = s === 'playing';
      icon.innerHTML = playing
        ? '<path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/>'
        : '<path d="M7 4l13 8-13 8z" fill="currentColor"/>';
      $('#btnPlay').classList.toggle('playing', playing);
      document.body.classList.toggle('is-playing', playing);
      if (navigator.mediaSession) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    },

    onTime(pos, dur) {
      const pct = dur ? (pos / dur) * 100 : 0;
      $('#seekFill').style.width = `${pct}%`;
      $('#seekKnob').style.insetInlineStart = `${pct}%`;
      $('#timeCur').textContent = fmtTime(pos);
      $('#timeDur').textContent = fmtTime(dur || 0);
      if (state.rpTab === 'lyrics') LM.Panels.updateLyrics(this, pos);
      if (!this._lastProgress || Date.now() - this._lastProgress > 2000) {
        this._lastProgress = Date.now();
        api.window.progress(dur ? pos / dur : 0).catch(() => {});
      }
    },

    onTrackChanged(track) {
      state.currentId = track.id;
      state.lyrics = null;
      this._lyIdx = -1;
      $('#npTitle').textContent = track.title || track.file;
      $('#npArtist').textContent = [track.artist, track.album].filter(Boolean).join(' — ') || '—';
      const art = $('#npArt');
      art.innerHTML = '';
      if (track.art) art.append(el('img', { src: artUrl(track.art), alt: '' }));
      else art.append(el('div', { class: 'np-art-ph', text: '♪' }));
      this.renderFav();
      this.renderStars();
      this.applyAccentFromArt();
      this.updateMediaSession(track);
      if (this._vl) this._vl.refresh();
      this.renderRight();
      if (state.settings.onlineArt && !track.art) this.fetchArt(track.id, true);
      if (state.settings.onlineLyrics) this.fetchLyrics(track.id, true);
      state.dj = null;
    },

    onPlayError(track, err) {
      toast(`تعذّر فك ترميز «${track ? track.title : ''}» — ${err && err.message ? err.message : 'صيغة غير مدعومة'}`, 'err', 5000);
    },

    updateMediaSession(track) {
      if (!navigator.mediaSession) return;
      const artwork = track.art ? [{ src: artUrl(track.art), sizes: '512x512', type: 'image/jpeg' }] : [];
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: track.title || track.file,
        artist: track.artist || '',
        album: track.album || '',
        artwork,
      });
      const acts = {
        play: () => this.engine.play(),
        pause: () => this.engine.pause(),
        nexttrack: () => this.next(),
        previoustrack: () => this.prev(),
        seekbackward: () => this.engine.seekBy(-10),
        seekforward: () => this.engine.seekBy(10),
      };
      for (const [k, fn] of Object.entries(acts)) {
        try { navigator.mediaSession.setActionHandler(k, fn); } catch { /* غير مدعوم */ }
      }
    },

    persistPosition() {
      if (!state.currentId || this.engine.state !== 'playing') return;
      api.settings.set({ lastTrackId: state.currentId, lastPosition: Math.floor(this.engine.position) }).catch(() => {});
    },

    async restoreSession() {
      const { lastTrackId, lastPosition } = state.settings;
      if (!lastTrackId || !state.byId.has(lastTrackId)) return;
      state.queue = [lastTrackId];
      state.queueIndex = 0;
      await this.loadCurrent({ position: lastPosition || 0, autoplay: false });
      toast('استُعيدت آخر جلسة استماع.', 'info', 2600);
    },

    // ————————————————————————————— المفضلة والتقييم
    renderFav() {
      const on = !!state.userdata.favorites[state.currentId];
      $('#btnFav').classList.toggle('on', on);
    },

    renderStars() {
      const box = $('#stars');
      box.innerHTML = '';
      const value = state.userdata.ratings[state.currentId] || 0;
      for (let i = 1; i <= 5; i++) {
        box.append(el('button', {
          class: `star${i <= value ? ' on' : ''}`,
          text: '★',
          title: `${i}/5`,
          onclick: () => this.rate(state.currentId, i === value ? 0 : i),
        }));
      }
    },

    async toggleFavorite(id) {
      if (!id) return;
      const on = await api.user.favorite(id, !state.userdata.favorites[id]);
      if (on) state.userdata.favorites[id] = true; else delete state.userdata.favorites[id];
      if (id === state.currentId) this.renderFav();
      if (this._vl) this._vl.refresh();
      if (state.view === 'favorites') this.render();
    },

    async rate(id, stars) {
      if (!id) return;
      const n = await api.user.rate(id, stars);
      if (n) state.userdata.ratings[id] = n; else delete state.userdata.ratings[id];
      if (id === state.currentId) this.renderStars();
      if (this._vl) this._vl.refresh();
    },

    selectTrack(id) { state.selectedId = id; },

    async saveOverride(id, patch) {
      await api.user.override(id, patch);
      const base = state.byId.get(id);
      const merged = { ...base, ...patch };
      state.userdata.overrides[id] = patch;
      state.byId.set(id, merged);
      state.tracks = state.tracks.map((t) => (t.id === id ? merged : t));
      toast('حُفظت التعديلات محليًا.', 'ok');
      this.render();
      this.renderRight();
    },

    // ————————————————————————————— المكتبة
    async addFolder() {
      toast('اختر مجلد الأغاني…', 'info', 1800);
      const res = await api.library.addFolder();
      if (res && res.canceled) return;
      if (res && res.stats) toast(`اكتملت الفهرسة: ${res.stats.added} جديدة، ${res.stats.total} إجمالاً.`, 'ok', 5000);
    },

    async removeFolder(folder) {
      if (!await LM.confirmDialog('إزالة المجلد', `ستُزال أغاني «${folder}» من الفهرس (لن تُحذف من القرص).`)) return;
      await api.library.removeFolder(folder);
      toast('أُزيل المجلد من الفهرس.', 'ok');
    },

    async rescan(force = false) {
      toast(force ? 'إعادة فهرسة كاملة…' : 'تحديث الفهرس…', 'info');
      const res = await api.library.scan({ force });
      if (res && res.stats) toast(`تمت الفهرسة: ${res.stats.added} جديدة · ${res.stats.updated} محدّثة · ${res.stats.total} إجمالاً`, 'ok', 5000);
    },

    async exportLibrary() {
      const res = await api.library.export();
      if (res && res.path) toast('صُدّرت المكتبة بنجاح.', 'ok');
    },

    async importLibrary() {
      const res = await api.library.import();
      if (res && res.imported) toast('استُوردت المكتبة.', 'ok');
    },

    async showDuplicates() {
      const groups = await api.library.duplicates();
      if (!groups.length) { toast('لا توجد أغانٍ مكررة.', 'ok'); return; }
      const body = el('div', { class: 'dups' });
      for (const g of groups.slice(0, 60)) {
        body.append(el('div', { class: 'dup-g' },
          el('b', { text: `${g[0].title} — ${g[0].artist || '—'}` }),
          ...g.map((t) => el('div', { class: 'dup-p muted xs', text: t.path }))));
      }
      LM.modal({ title: `أغانٍ مكررة (${groups.length} مجموعة)`, body, wide: true });
    },

    openAlbum(album, artist) {
      state.filter = { ...state.filter, album, artist: null, ids: null, label: `${album} — ${artist}` };
      this.go('tracks');
    },

    openArtist(artist) {
      state.filter = { ...state.filter, artist, album: null, ids: null, label: artist };
      this.go('tracks');
    },

    openPlaylist(id) {
      state.filter.playlist = id;
      this.go('playlists');
    },

    // ————————————————————————————— قوائم التشغيل
    async newPlaylist() {
      const name = await LM.promptDialog('قائمة تشغيل جديدة', { label: 'الاسم', placeholder: 'مثلاً: سهرة الجمعة' });
      if (!name) return;
      const pl = await api.playlists.create({ name });
      state.playlists.unshift(pl);
      this.render();
      toast('أُنشئت القائمة.', 'ok');
    },

    async deletePlaylist(id) {
      if (!await LM.confirmDialog('حذف القائمة', 'سيُحذف السجل نهائيًا (لن تُحذف ملفات الأغاني).')) return;
      await api.playlists.remove(id);
      state.playlists = state.playlists.filter((p) => p.id !== id);
      state.filter.playlist = null;
      this.render();
    },

    async addToPlaylist(ids) {
      if (!state.playlists.length) {
        const name = await LM.promptDialog('قائمة جديدة', { label: 'الاسم' });
        if (!name) return;
        const pl = await api.playlists.create({ name, tracks: ids });
        state.playlists.unshift(pl);
        toast('أُضيفت إلى القائمة الجديدة.', 'ok');
        this.render();
        return;
      }
      const body = el('div', { class: 'pl-pick' });
      const { close } = LM.modal({ title: 'إضافة إلى قائمة', body });
      for (const p of state.playlists) {
        body.append(el('button', {
          class: 'pl-pick-row',
          onclick: async () => {
            const updated = await api.playlists.addTracks(p.id, ids);
            const i = state.playlists.findIndex((x) => x.id === p.id);
            state.playlists[i] = updated;
            toast(`أُضيفت ${ids.length} أغنية إلى «${p.name}»`, 'ok');
            close();
            this.renderSidebar();
          },
        }, el('b', { text: p.name }), el('span', { class: 'muted', text: `${p.tracks.length} أغنية` })));
      }
      body.append(el('button', {
        class: 'pl-pick-row new',
        onclick: async () => {
          close();
          const name = await LM.promptDialog('قائمة جديدة', { label: 'الاسم' });
          if (!name) return;
          const pl = await api.playlists.create({ name, tracks: ids });
          state.playlists.unshift(pl);
          this.render();
        },
      }, el('b', { text: '＋ قائمة جديدة' })));
    },

    async exportM3U(id) {
      const res = await api.playlists.exportM3U(id);
      if (res && res.path) toast(`صُدّرت ${res.count} أغنية.`, 'ok');
    },

    async importM3U() {
      const res = await api.playlists.importM3U();
      if (!res || res.canceled) return;
      state.playlists.unshift(res.playlist);
      this.render();
      toast(`استُوردت ${res.imported} أغنية${res.missing ? ` · ${res.missing} غير موجودة في الفهرس` : ''}.`, 'ok', 5000);
    },

    playlistMenu(e, pl) {
      LM.contextMenu(e.clientX, e.clientY, [
        { label: 'تشغيل', onClick: () => this.playList(pl.tracks) },
        { label: 'خلط', onClick: () => this.playList(pl.tracks, { shuffle: true }) },
        { label: 'إضافة للطابور', onClick: () => this.enqueue(pl.tracks) },
        '-',
        { label: 'إعادة تسمية', onClick: async () => {
          const name = await LM.promptDialog('إعادة تسمية', { value: pl.name });
          if (!name) return;
          const updated = await api.playlists.update(pl.id, { name });
          const i = state.playlists.findIndex((x) => x.id === pl.id);
          state.playlists[i] = updated;
          this.render();
        } },
        { label: 'تصدير M3U', onClick: () => this.exportM3U(pl.id) },
        '-',
        { label: 'حذف القائمة', danger: true, onClick: () => this.deletePlaylist(pl.id) },
      ]);
    },

    trackMenu(e, track, ids) {
      const ud = state.userdata;
      LM.contextMenu(e.clientX, e.clientY, [
        { label: 'تشغيل', onClick: () => this.playTrack(track.id, ids) },
        { label: 'تشغيل التالي', onClick: () => this.playNext(track.id) },
        { label: 'إضافة للطابور', onClick: () => this.enqueue([track.id]) },
        '-',
        { label: ud.favorites[track.id] ? 'إزالة من المفضلة' : 'إضافة للمفضلة', onClick: () => this.toggleFavorite(track.id) },
        { label: 'إضافة إلى قائمة…', onClick: () => this.addToPlaylist([track.id]) },
        ...(this.aiOn() ? [{ label: 'راديو مشابه (ذكاء اصطناعي)', onClick: () => this.aiRadio(track.id) }] : []),
        '-',
        { label: 'جلب الغلاف من الإنترنت', onClick: () => this.fetchArt(track.id) },
        { label: 'جلب الكلمات', onClick: () => { state.rpTab = 'lyrics'; this.setRpTab('lyrics'); this.fetchLyrics(track.id); } },
        { label: 'تحرير البيانات', onClick: () => LM.Panels.editTags(this, track) },
        '-',
        { label: 'عرض الألبوم', onClick: () => this.openAlbum(track.album || '—', track.albumArtist || track.artist || '—') },
        { label: 'عرض الفنان', onClick: () => this.openArtist(track.artist || '—') },
        { label: 'فتح موقع الملف', onClick: () => api.app.reveal(track.id) },
      ]);
    },

    // ————————————————————————————— الإنترنت
    async checkOnline() {
      const dot = $('#netDot');
      try {
        const on = await api.online.status();
        dot.classList.toggle('on', !!on);
        dot.title = on ? 'متصل بالإنترنت — الميزات الشبكية متاحة' : 'غير متصل — الفهرسة والتشغيل يعملان محليًا';
      } catch { dot.classList.remove('on'); }
    },

    async fetchArt(id, silent = false) {
      try {
        const name = await api.online.art(id);
        if (!name) { if (!silent) toast('لم يُعثر على غلاف مطابق.', 'warn'); return; }
        const t = state.byId.get(id);
        if (t) t.art = name;
        if (id === state.currentId) this.onTrackChanged(state.byId.get(id));
        if (!silent) toast('جُلب الغلاف من الإنترنت.', 'ok');
        if (this._vl) this._vl.refresh();
      } catch (err) { if (!silent) toast(`تعذّر جلب الغلاف: ${err.message}`, 'err'); }
    },

    async fetchLyrics(id, silent = false) {
      try {
        const data = await api.online.lyrics(id);
        if (!data) { if (!silent) toast('لا توجد كلمات لهذه الأغنية.', 'warn'); return; }
        state.lyrics = { id, ...data };
        if (state.rpTab === 'lyrics') this.renderRight();
        if (!silent) toast(data.synced && data.synced.length ? 'جُلبت الكلمات المتزامنة.' : 'جُلبت الكلمات.', 'ok');
      } catch (err) { if (!silent) toast(`تعذّر جلب الكلمات: ${err.message}`, 'err'); }
    },

    async fetchMeta(id) {
      toast('البحث في MusicBrainz…', 'info', 1600);
      try {
        const data = await api.online.meta(id);
        state.onlineMeta = { id, data };
        this.renderRight();
        if (!data) toast('لم يُعثر على تطابق.', 'warn');
      } catch (err) { toast(`فشل البحث: ${err.message}`, 'err'); }
    },

    async applyOnlineMeta(id, data) {
      const patch = {};
      if (data.year) patch.year = data.year;
      if (data.genre) patch.genre = data.genre;
      if (data.album) patch.album = data.album;
      await this.saveOverride(id, patch);
    },

    async fetchArtistInfo(artist) {
      if (!artist) { toast('لا يوجد اسم فنان.', 'warn'); return; }
      toast('جلب النبذة…', 'info', 1500);
      try {
        const data = await api.online.artist(artist, state.settings.lang);
        state.artistInfo = { artist, data };
        this.renderRight();
      } catch (err) { toast(`تعذّر الجلب: ${err.message}`, 'err'); }
    },

    openExternal(url) { api.app.openExternal(url).catch(() => {}); },

    // ————————————————————————————— الذكاء الاصطناعي
    async requireAi() {
      if (!this.aiOn()) {
        toast('ميزات الذكاء الاصطناعي مغلقة. فعّلها من الإعدادات (تتطلب مفتاح API مدفوعًا).', 'warn', 5000);
        this.go('settings');
        return false;
      }
      if (state.aiStatus && state.aiStatus.hasKey) return true;
      toast('فعّل الذكاء الاصطناعي أولًا من صفحة «الذكاء الاصطناعي».', 'warn', 4200);
      this.go('ai');
      return false;
    },

    async saveAiKey(key) {
      if (!key || !key.trim()) { toast('أدخل مفتاحًا صالحًا.', 'warn'); return; }
      await api.ai.setKey(key.trim());
      state.aiStatus = await api.ai.status();
      toast('حُفظ المفتاح مشفّرًا على جهازك.', 'ok');
      this.render();
    },

    async clearAiKey() {
      await api.ai.clearKey();
      state.aiStatus = await api.ai.status();
      this.render();
    },

    async askSmartPlaylist() {
      if (!await this.requireAi()) return;
      const prompt = await LM.promptDialog('قائمة تشغيل ذكية', {
        label: 'صف ما تريد سماعه',
        placeholder: 'مثال: أغانٍ هادئة للقراءة، عربية، بلا طبول قوية',
        multiline: true,
      });
      if (prompt) this.buildSmartPlaylist(prompt);
    },

    async buildSmartPlaylist(prompt) {
      if (!prompt || !prompt.trim()) { toast('اكتب وصفًا أولًا.', 'warn'); return; }
      if (!await this.requireAi()) return;
      toast('يبني الذكاء الاصطناعي قائمتك…', 'info', 4000);
      try {
        const pl = await api.ai.playlist(prompt.trim(), 25);
        state.playlists.unshift(pl);
        state.filter.playlist = pl.id;
        this.go('playlists');
        toast(`جاهزة: «${pl.name}» — ${pl.tracks.length} أغنية`, 'ok', 5000);
      } catch (err) { this.aiError(err); }
    },

    async aiSearch() {
      if (!await this.requireAi()) return;
      const q = $('#search').value.trim();
      if (!q) { toast('اكتب ما تبحث عنه أولًا.', 'warn'); return; }
      toast('بحث دلالي…', 'info', 2500);
      try {
        const res = await api.ai.search(q);
        if (!res.results.length) { toast('لم يجد الذكاء الاصطناعي نتائج.', 'warn'); return; }
        state.filter = { ...state.filter, q: '', ids: res.results.map((r) => r.id), label: `بحث ذكي: ${q}` };
        this.go('tracks');
        toast(res.interpretation || `${res.results.length} نتيجة`, 'ok', 5000);
      } catch (err) { this.aiError(err); }
    },

    async aiRadio(id) {
      if (!await this.requireAi()) return;
      const seed = state.byId.get(id);
      toast(`يبني راديو يشبه «${seed ? seed.title : ''}»…`, 'info', 3000);
      try {
        const picks = await api.ai.radio(id, 20);
        if (!picks.length) { toast('لم يجد أغانٍ مشابهة.', 'warn'); return; }
        await this.playList([id, ...picks.map((p) => p.id)]);
        state.filter = { ...state.filter, ids: [id, ...picks.map((p) => p.id)], label: 'راديو مشابه' };
        this.go('tracks');
      } catch (err) { this.aiError(err); }
    },

    async aiTagLibrary(limit = 40) {
      if (!await this.requireAi()) return;
      const pending = state.tracks.filter((t) => !state.userdata.ai[t.id]);
      const targets = (limit ? pending.slice(0, limit) : pending).map((t) => t.id);
      if (!targets.length) { toast('كل الأغاني مصنّفة بالفعل.', 'ok'); return; }
      toast(`جارٍ تصنيف ${targets.length} أغنية…`, 'info', 4000);
      try {
        const res = await api.ai.tag(targets);
        state.userdata = await api.user.get();
        toast(`صُنِّفت ${res.tagged} أغنية.`, 'ok');
        this.render();
      } catch (err) { this.aiError(err); }
    },

    async aiInsights() {
      if (!await this.requireAi()) return;
      toast('يحلّل الذكاء الاصطناعي مكتبتك…', 'info', 4000);
      try {
        state.insights = await api.ai.insights();
        this.go('ai');
      } catch (err) { this.aiError(err); }
    },

    async aiDj(id) {
      if (!await this.requireAi()) return;
      state.dj = { id, text: '' };
      state.rpTab = 'now';
      this.setRpTab('now');
      try { await api.ai.dj(id, state.prevId || null); } catch (err) { this.aiError(err); }
    },

    aiError(err) {
      if (err.code === 'NO_API_KEY') { toast('لم يُضبط مفتاح API.', 'warn'); this.go('ai'); return; }
      toast(`فشل طلب الذكاء الاصطناعي: ${err.message}`, 'err', 6000);
    },

    // ————————————————————————————— الإعدادات
    async setSetting(patch) {
      Object.assign(state.settings, patch);
      await api.settings.set(patch).catch(() => {});
    },

    applyEngineSettings() {
      const s = state.settings;
      this.engine.setVolume(s.volume ?? 0.9);
      this.engine.setMuted(!!s.muted);
      this.engine.setRate(s.rate || 1);
      this.engine.setCrossfade(s.crossfade || 0);
      this.engine.normalize = !!s.normalize;
      this.engine.eqEnabled = !!s.eqEnabled;
      this.engine.eqGains = s.eqGains || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      this.engine.preamp = s.eqPreamp || 0;
      $('#volume').value = s.volume ?? 0.9;
      $('#btnShuffle').classList.toggle('on', !!s.shuffle);
      $('#btnRepeat').classList.toggle('on', s.repeat !== 'off');
      $('#repeatBadge').textContent = s.repeat === 'one' ? '1' : '';
      if (s.sleepMinutes) this.engine.setSleep(s.sleepMinutes);
    },

    applyTheme() {
      const s = state.settings;
      const body = document.body;
      for (const c of [...body.classList]) {
        if (c.startsWith('theme-') || c.startsWith('accent-')) body.classList.remove(c);
      }
      body.classList.add(`theme-${s.theme === 'light' ? 'light' : 'dark'}`);
      body.classList.add(`accent-${s.accent || 'violet'}`);
    },

    setTheme(theme) { this.setSetting({ theme }); this.applyTheme(); },

    setAccent(accent) {
      this.setSetting({ accent });
      document.documentElement.style.removeProperty('--dyn');
      document.body.classList.remove('dyn');
      this.applyTheme();
      this.render();
    },

    setLang(lang) {
      this.setSetting({ lang });
      LM.i18n.setLang(lang);
      this.render();
      this.renderRight();
    },

    async applyAccentFromArt() {
      const t = this.currentTrack();
      if (!state.settings.dynamicColor || !t || !t.art) {
        document.documentElement.style.removeProperty('--dyn');
        document.body.classList.remove('dyn');
        return;
      }
      const rgb = await LM.dominantColor(artUrl(t.art));
      if (!rgb) return;
      const [r, g, b] = rgb;
      document.documentElement.style.setProperty('--dyn', `${r} ${g} ${b}`);
      document.body.classList.add('dyn');
    },

    // ————————————————————————————— الربط
    wireChrome() {
      $('#btnMin').onclick = () => api.window.minimize();
      $('#btnMax').onclick = () => api.window.maximize();
      $('#btnClose').onclick = () => api.window.close();
      $('#btnMini').onclick = async () => {
        const on = await api.window.mini();
        document.body.classList.toggle('mini', on);
      };
      $('#btnAddFolder').onclick = () => this.addFolder();
      $('#btnNewPlaylist').onclick = () => this.newPlaylist();
      $('#btnAiPlaylist').onclick = () => this.askSmartPlaylist();
      $('#aiSearchBtn').onclick = () => this.aiSearch();
      $('#btnPanel').onclick = () => document.body.classList.toggle('no-panel');

      const search = $('#search');
      search.addEventListener('input', LM.debounce(() => {
        state.filter.q = search.value.trim();
        state.filter.ids = null;
        if (state.view !== 'tracks') this.go('tracks'); else this.render();
      }, 220));
      search.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.ctrlKey) this.aiSearch();
      });

      $('#rpTabs').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (b) this.setRpTab(b.dataset.rp);
      });
    },

    setRpTab(tab) {
      state.rpTab = tab;
      $('#rpTabs').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.rp === tab));
      this.renderRight();
    },

    wirePlayerControls() {
      $('#btnPlay').onclick = () => this.engine.toggle();
      $('#btnNext').onclick = () => this.next();
      $('#btnPrev').onclick = () => this.prev();
      $('#btnFav').onclick = () => this.toggleFavorite(state.currentId);
      $('#btnEq').onclick = () => LM.Panels.eqModal(this);
      $('#btnSleep').onclick = () => LM.Panels.sleepModal(this);

      $('#btnShuffle').onclick = () => {
        const on = !state.settings.shuffle;
        this.setSetting({ shuffle: on });
        $('#btnShuffle').classList.toggle('on', on);
        if (on && state.queue.length > 1) {
          const cur = state.currentId;
          state.queue = [cur, ...this.shuffleArray(state.queue.filter((x) => x !== cur))];
          state.queueIndex = 0;
          this.preloadNext();
        }
        toast(on ? 'الخلط مفعّل' : 'الخلط متوقف', 'info', 1500);
      };

      $('#btnRepeat').onclick = () => {
        const order = ['off', 'all', 'one'];
        const next = order[(order.indexOf(state.settings.repeat) + 1) % 3];
        this.setSetting({ repeat: next });
        $('#btnRepeat').classList.toggle('on', next !== 'off');
        $('#repeatBadge').textContent = next === 'one' ? '1' : '';
        toast({ off: 'التكرار متوقف', all: 'تكرار الكل', one: 'تكرار الأغنية' }[next], 'info', 1500);
      };

      const vol = $('#volume');
      vol.oninput = () => {
        this.engine.setVolume(Number(vol.value));
        this.setSetting({ volume: Number(vol.value), muted: false });
        $('#btnMute').classList.remove('on');
      };
      $('#btnMute').onclick = () => {
        const m = this.engine.setMuted(!this.engine.muted);
        this.setSetting({ muted: m });
        $('#btnMute').classList.toggle('on', m);
      };

      const seek = $('#seek');
      const seekTo = (clientX) => {
        const r = seek.getBoundingClientRect();
        let ratio = (clientX - r.left) / r.width;
        if (document.dir === 'rtl') ratio = 1 - ratio;
        this.engine.seek(Math.max(0, Math.min(1, ratio)) * (this.engine.duration || 0));
      };
      seek.addEventListener('mousedown', (e) => {
        seekTo(e.clientX);
        const move = (ev) => seekTo(ev.clientX);
        const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      });
      $('#npArt').onclick = () => this.setRpTab('now');
    },

    wireKeyboard() {
      document.addEventListener('keydown', (e) => {
        const tag = (e.target.tagName || '').toLowerCase();
        const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
        if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#search').focus(); return; }
        if (e.ctrlKey && e.key.toLowerCase() === 'm') { e.preventDefault(); $('#btnMini').click(); return; }
        if (typing) return;
        const k = e.key.toLowerCase();
        if (e.key === ' ') { e.preventDefault(); this.engine.toggle(); }
        else if (e.ctrlKey && e.key === 'ArrowRight') this.next();
        else if (e.ctrlKey && e.key === 'ArrowLeft') this.prev();
        else if (e.key === 'ArrowRight') this.engine.seekBy(5);
        else if (e.key === 'ArrowLeft') this.engine.seekBy(-5);
        else if (e.key === 'ArrowUp') { e.preventDefault(); const v = Math.min(1, this.engine.volume + 0.05); this.engine.setVolume(v); $('#volume').value = v; this.setSetting({ volume: v }); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); const v = Math.max(0, this.engine.volume - 0.05); this.engine.setVolume(v); $('#volume').value = v; this.setSetting({ volume: v }); }
        else if (k === 's') $('#btnShuffle').click();
        else if (k === 'r') $('#btnRepeat').click();
        else if (k === 'm') $('#btnMute').click();
        else if (k === 'f') this.toggleFavorite(state.currentId);
        else if (k === 'e') LM.Panels.eqModal(this);
        else if (k === 'l') this.setRpTab('lyrics');
        else if (k === 'q') this.setRpTab('queue');
        else if (/^[1-5]$/.test(e.key)) this.rate(state.currentId, Number(e.key));
      });
    },

    wireDragDrop() {
      const veil = $('#dropVeil');
      let depth = 0;
      window.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; veil.hidden = false; });
      window.addEventListener('dragover', (e) => e.preventDefault());
      window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) veil.hidden = true; });
      window.addEventListener('drop', async (e) => {
        e.preventDefault();
        depth = 0; veil.hidden = true;
        const paths = api.pathsFor(e.dataTransfer.files);
        if (!paths.length) return;
        toast('جارٍ فهرسة ما أفلته…', 'info');
        try {
          const res = await api.library.addPaths(paths);
          if (res && res.stats) toast(`تمت الفهرسة: ${res.stats.added} أغنية جديدة.`, 'ok', 5000);
        } catch (err) { toast(`تعذّرت الفهرسة: ${err.message}`, 'err'); }
      });
    },

    wireIpc() {
      api.library.onUpdated((lib) => {
        const curScroll = $('#content').scrollTop;
        this.ingestLibrary(lib);
        this.render();
        $('#content').scrollTop = curScroll;
      });

      api.library.onProgress((p) => {
        if (p.phase === 'index') {
          state.scanning = true;
          this.showScanBar(`فهرسة… ${p.done}/${p.total}`, p.done / Math.max(1, p.total));
        } else if (p.phase === 'walk') {
          this.showScanBar('البحث عن ملفات الصوت…', 0);
        } else if (p.phase === 'done') {
          state.scanning = false;
          this.showScanBar(null);
        } else if (p.phase === 'error') {
          state.scanning = false;
          this.showScanBar(null);
          toast(`خطأ في الفهرسة: ${p.error}`, 'err');
        }
      });

      api.ai.onProgress((p) => {
        const bar = document.getElementById('aiProgress');
        if (!bar) return;
        bar.hidden = false;
        bar.querySelector('.progress-f').style.width = `${(p.done / p.total) * 100}%`;
      });

      api.ai.onDjDelta(({ id, delta }) => {
        if (!state.dj || state.dj.id !== id) state.dj = { id, text: '' };
        state.dj.text += delta;
        const node = document.getElementById('djText');
        if (node) node.textContent = state.dj.text;
        else if (state.rpTab === 'now') this.renderRight();
      });

      api.media.onKey((action) => {
        if (action === 'toggle') this.engine.toggle();
        else if (action === 'next') this.next();
        else if (action === 'prev') this.prev();
        else if (action === 'stop') this.engine.pause();
      });

      api.window.onState(({ maximized }) => document.body.classList.toggle('maximized', maximized));
      setInterval(() => this.checkOnline(), 60000);
    },

    showScanBar(text, ratio = 0) {
      let bar = document.getElementById('scanBar');
      if (!text) { if (bar) bar.remove(); return; }
      if (!bar) {
        bar = el('div', { class: 'scan-bar', id: 'scanBar' },
          el('span', { class: 'sb-t' }), el('span', { class: 'sb-track' }, el('span', { class: 'sb-f' })));
        document.body.append(bar);
      }
      bar.querySelector('.sb-t').textContent = text;
      bar.querySelector('.sb-f').style.width = `${Math.round(ratio * 100)}%`;
    },

    // ————————————————————————————— المؤثر البصري
    startVisualizer() {
      const canvas = $('#viz');
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const resize = () => {
        canvas.width = canvas.clientWidth * dpr;
        canvas.height = canvas.clientHeight * dpr;
      };
      resize();
      window.addEventListener('resize', resize);

      const draw = () => {
        requestAnimationFrame(draw);
        const mode = state.settings.visualizer || 'bars';
        const analyser = this.engine.getAnalyser();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (mode === 'off' || !analyser || this.engine.state !== 'playing') return;
        const style = getComputedStyle(document.body);
        const accent = style.getPropertyValue('--accent').trim() || '124 92 255';
        const w = canvas.width; const h = canvas.height;
        if (mode === 'bars') {
          const data = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteFrequencyData(data);
          const bars = 40;
          const step = Math.floor(data.length / bars);
          const bw = w / bars;
          for (let i = 0; i < bars; i++) {
            let sum = 0;
            for (let j = 0; j < step; j++) sum += data[i * step + j];
            const v = (sum / step) / 255;
            const bh = Math.max(2 * dpr, v * h);
            ctx.fillStyle = `rgba(${accent} / ${0.35 + v * 0.65})`;
            ctx.fillRect(i * bw + bw * 0.18, h - bh, bw * 0.64, bh);
          }
        } else {
          const data = new Uint8Array(analyser.fftSize);
          analyser.getByteTimeDomainData(data);
          ctx.beginPath();
          ctx.lineWidth = 1.6 * dpr;
          ctx.strokeStyle = `rgb(${accent})`;
          for (let i = 0; i < data.length; i++) {
            const x = (i / data.length) * w;
            const y = (data[i] / 255) * h;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      };
      draw();
    },
  };

  LM.app = app;
  window.addEventListener('DOMContentLoaded', () => {
    app.init().catch((err) => {
      document.body.append(el('div', { class: 'fatal' },
        el('h2', { text: 'تعذّر تشغيل LiwaMusic' }),
        el('pre', { text: String(err && err.stack || err) })));
    });
  });
}(window.LM));
