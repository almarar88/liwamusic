/* LiwaTube — التحكم الرئيسي: الحالة، التوجيه، الشريط الجانبي، الإجراءات، القفل، المشغّل المصغّر. */
'use strict';
(function (LT) {
  const { $, h, t, toast, modal } = LT;
  const V = () => LT.views;

  LT.state = {
    lib: { folders: [], videos: {}, channels: [] }, user: null, settings: null, playlists: [], ai: { enabled: false, hasKey: false, models: [] },
    info: null, lockEnabled: false, route: { view: 'home', params: [] }, homeSeed: Math.floor(Math.random() * 1e6), forYou: null, upNext: [], queue: null,
  };
  const S = LT.state;

  // ---------- التوجيه
  const router = {
    parse() {
      const hash = location.hash || '#/home';
      const [pathPart, qs] = hash.slice(2).split('?');
      const parts = pathPart.split('/').filter(Boolean);
      const q = Object.fromEntries(new URLSearchParams(qs || ''));
      return { view: parts[0] || 'home', params: parts.slice(1), q };
    },
    go(hash) { if (location.hash === hash) this.refresh(); else location.hash = hash; },
    refresh() { render(); },
  };
  LT.router = router;
  window.addEventListener('hashchange', render);

  let currentEl = null;
  async function render() {
    const r = router.parse();
    S.route = r;
    if (currentEl && currentEl._cleanup) currentEl._cleanup();
    // مغادرة صفحة المشاهدة → المشغّل المصغّر
    if (r.view !== 'watch') toMini();
    const view = $('#view');
    const main = $('#main');
    let el;
    try {
      switch (r.view) {
        case 'home': el = await V().home(); break;
        case 'shorts': el = V().shorts(); LT.player.stop(); hideMini(); break;
        case 'subs': el = V().subs(); break;
        case 'channels': el = V().channels(); break;
        case 'channel': el = V().channel(r.params[0]); break;
        case 'all': el = V().all(); break;
        case 'search': el = await V().search(r.q.q); break;
        case 'history': el = V().history(); break;
        case 'later': el = V().later(); break;
        case 'liked': el = V().liked(); break;
        case 'playlists': el = V().playlists(); break;
        case 'playlist': el = V().playlist(r.params[0]); break;
        case 'watch': el = await V().watch(r.params[0]); hideMini(); break;
        case 'ai': el = V().ai(); break;
        case 'settings': el = V().settings(); break;
        case 'share': el = await V().share(); break;
        case 'studio': el = LT.studio ? await LT.studio.render(r.params, r.q) : await V().home(); break;
        default: el = await V().home();
      }
    } catch (err) { el = h('div.empty', h('h2', 'خطأ'), h('p', String(err.message || err))); console.error(err); }
    if (S.route !== r) return; // تغيّر المسار أثناء الانتظار
    view.innerHTML = '';
    view.append(el);
    currentEl = el;
    main.scrollTop = 0;
    renderSidebar();
    if (r.view !== 'watch' && r.view !== 'settings') window.liwa.settings.set({ lastView: r.view });
    $('#shell').classList.toggle('theater', r.view === 'watch' && LT.player.isTheater());
  }

  // ---------- الشريط الجانبي
  function renderSidebar() {
    const side = $('#sidebar');
    const r = S.route;
    const item = (hash, icon, label, cnt) => h('button.nav-item', { class: r.view === hash.slice(2).split('/')[0] && (hash !== '#/channel') ? 'on' : '', onclick: () => router.go(hash) }, LT.icon(icon), h('span.ellip', label), cnt != null ? h('span.cnt', String(cnt)) : null);
    const u = S.user || {};
    const subs = S.lib.channels.filter((c) => u.subscriptions && u.subscriptions[c.id]);
    side.innerHTML = '';
    side.append(...[
      item('#/home', 'home', t('home')), item('#/shorts', 'shorts', t('shorts')), item('#/subs', 'subs', t('subs')),
      h('div.nav-sep'), h('div.nav-head', t('library')),
      item('#/all', 'all', t('all'), Object.keys(S.lib.videos).length), item('#/history', 'history', t('history')),
      item('#/later', 'later', t('later'), (u.watchLater || []).length), item('#/liked', 'liked', t('liked')), item('#/playlists', 'playlists', t('playlists'), S.playlists.length),
      h('div.nav-sep'),
      subs.length ? h('div.nav-head', t('subs')) : null,
      subs.slice(0, 12).map((c) => h('button.nav-item.nav-ch', { class: r.view === 'channel' && r.params[0] === c.id ? 'on' : '', onclick: () => router.go(`#/channel/${c.id}`) }, V().avatar(c.name), h('span.ellip', c.name))),
      item('#/channels', 'channels', t('channels'), S.lib.channels.length),
      h('div.nav-sep'),
      LT.mode !== 'web' && window.liwa.share ? item('#/share', 'share', t('shareNav')) : null,
      LT.mode === 'web' && S.auth && S.auth.admin ? item('#/studio', 'folder', t('studio')) : null,
      LT.mode === 'web' && !(S.auth && S.auth.admin) ? h('button.nav-item', { onclick: () => LT.studio.login() }, LT.icon('channels'), h('span.ellip', t('adminLogin'))) : null,
      LT.mode === 'web' && !S.ai.enabled ? null : item('#/ai', 'ai', t('ai')), item('#/settings', 'settings', t('settings')),
      h('div.nav-foot', `LiwaTube ${S.info?.version || ''}`, h('br'), S.info?.creator || ''),
    ].flat().filter(Boolean));
  }

  // ---------- المشغّل المصغّر
  function toMini() {
    const cur = LT.player.current();
    const mini = $('#mini');
    if (!cur || LT.player.video().ended) { hideMini(); if (cur) LT.player.stop(); return; }
    if (!mini.hidden) return;
    mini.innerHTML = '';
    const box = h('div');
    LT.player.mount(box);
    LT.player.setTheater(false);
    const vi = V().info(cur.id);
    mini.append(box, h('div.m-bar',
      h('div.ttl.ellip', { onclick: () => router.go(`#/watch/${cur.id}`) }, vi ? vi.title : cur.title),
      h('button.icon-btn', { style: { width: '32px', height: '32px' }, onclick: () => router.go(`#/watch/${cur.id}`) }, LT.icon('expand', 18)),
      h('button.icon-btn', { style: { width: '32px', height: '32px' }, onclick: () => { LT.player.stop(); hideMini(); } }, LT.icon('close', 18))));
    mini.hidden = false;
  }
  function hideMini() { const m = $('#mini'); m.hidden = true; }

  // ---------- تشغيل
  LT.player.on('ended', (cur) => {
    if (!cur) return;
    S.user.progress[cur.id] = { pos: 1, dur: 1, at: Date.now() };
    if (S.settings.autoplay) playNext();
  });
  LT.player.on('next', () => playNext());
  LT.player.on('state', (kind, n) => {
    if (kind === 'played' && LT.player.current()) { const id = LT.player.current().id; S.user.playCount[id] = n; S.user.history = [{ id, at: Date.now() }, ...S.user.history.filter((x) => x.id !== id)]; }
  });
  LT.player.on('progress', (c, d) => {
    const cur = LT.player.current();
    if (cur && d) S.user.progress[cur.id] = { pos: c, dur: d, at: Date.now() };
    const box = currentEl && currentEl._chapterBox;
    if (box) { let on = null; for (const el of box.querySelectorAll('.ch')) { if (Number(el.dataset.t) <= c) on = el; el.classList.remove('on'); } if (on) on.classList.add('on'); }
  });
  document.addEventListener('lt:theater', (e) => {
    const w = $('.watch');
    if (w) w.classList.toggle('theater', e.detail);
    $('#shell').classList.toggle('theater', e.detail && S.route.view === 'watch');
  });
  function playNext() {
    const cur = LT.player.current();
    if (S.queue && S.queue.length) {
      const idx = cur ? S.queue.indexOf(cur.id) : -1;
      const next = S.queue[idx + 1];
      if (next) { router.go(`#/watch/${next}`); return; }
      S.queue = null;
    }
    const next = (S.upNext || []).find((id) => id !== (cur && cur.id));
    if (next) router.go(`#/watch/${next}`);
  }

  // ---------- الإجراءات
  const actions = {
    play(id) { router.go(`#/watch/${id}`); },
    playQueue(ids) { if (!ids.length) return; S.queue = [...ids]; router.go(`#/watch/${ids[0]}`); },
    async addFolder() { if (LT.mode === 'web') { if (S.auth && S.auth.admin) router.go('#/studio/upload'); else LT.studio.login(); return; } const lib = await window.liwa.library.addFolder(); setLib(lib); toast(t('folderAdded')); },
    async removeFolder(f) { const lib = await window.liwa.library.removeFolder(f); setLib(lib); router.refresh(); },
    async rescan() { await window.liwa.library.scan(); },
    async regenThumbs() {
      LT.thumbs.stopQueue();
      setLib(await window.liwa.library.resetThumbs());
      router.refresh();
      setTimeout(runThumbs, 600);
    },
    async like(id, val) { const n = await window.liwa.user.like(id, val); if (n) { S.user.likes[id] = n; S.user.likedAt[id] = Date.now(); } else delete S.user.likes[id]; return n; },
    async watchLater(id, on) { S.user.watchLater = await window.liwa.user.watchLater(id, on); toast(on ? t('later_add') : t('later_rm')); renderSidebar(); if (S.route.view === 'later') router.refresh(); },
    async subscribe(cid, on) { const r = await window.liwa.user.subscribe(cid, on); if (r) S.user.subscriptions[cid] = { at: Date.now() }; else delete S.user.subscriptions[cid]; renderSidebar(); return r; },
    ctxFor(id, x, y, { onRemove = null } = {}) {
      const v = V().info(id);
      if (!v) return;
      const web = LT.mode === 'web';
      const admin = web && S.auth && S.auth.admin;
      LT.ctxMenu(x, y, [
        { icon: 'play', label: t('play'), onClick: () => actions.play(id) },
        { icon: 'later', label: v.inLater ? t('later_rm') : t('later_add'), onClick: () => actions.watchLater(id, !v.inLater) },
        { icon: 'save', label: t('addToPl'), onClick: () => actions.addToPlaylist([id]) },
        { icon: 'check', label: v.watched ? t('unwatched') : t('markWatched'), onClick: async () => { await window.liwa.user.markWatched(id, !v.watched); S.user = await window.liwa.user.get(); router.refresh(); } },
        '-',
        v.canEdit ? { icon: 'ai', label: v.ai ? t('reanalyze') : t('analyze'), onClick: () => actions.analyze(id) } : null,
        v.canEdit ? { icon: 'edit', label: t('edit'), onClick: () => actions.editMeta(id) } : null,
        admin ? { icon: 'trash', label: t('delete'), onClick: () => LT.studio.remove(id) } : null,
        v.canEdit ? '-' : null,
        onRemove ? { icon: 'close', label: onRemove.label, onClick: onRemove.fn } : null,
        { icon: 'hide', label: t('hide'), onClick: async () => { await window.liwa.user.hide(id, true); S.user.hidden[id] = true; router.refresh(); toast(t('removed'), { action: '↶', onAction: async () => { await window.liwa.user.hide(id, false); delete S.user.hidden[id]; router.refresh(); } }); } },
        { icon: 'hide', label: t('notInterested'), onClick: async () => { await window.liwa.user.notInterested(v.channelId, true); S.user.notInterested[v.channelId] = true; router.refresh(); } },
        { icon: 'folder', label: web ? t('copyLink') : t('reveal'), onClick: () => window.liwa.app.reveal(id) },
      ]);
    },
    addToPlaylist(ids) {
      modal({
        title: t('addToPl'),
        body: (box) => {
          for (const p of S.playlists) {
            const cb = h('input', { type: 'checkbox', checked: ids.every((id) => p.videos.includes(id)) });
            cb.addEventListener('change', async () => {
              if (cb.checked) { const it = await window.liwa.playlists.add(p.id, ids); Object.assign(p, it); toast(t('added')); }
              else { for (const id of ids) { await window.liwa.playlists.removeVideo(p.id, id); } p.videos = p.videos.filter((x) => !ids.includes(x)); }
            });
            box.append(h('label.pl-opt', cb, h('span.grow', p.name), h('span.muted.xs', `${p.videos.length}`)));
          }
          box.append(h('button.btn.sm', { style: { marginTop: '8px' }, onclick: () => { LT.closeModal(); actions.newPlaylist(ids); } }, LT.icon('plus', 18), t('newPlaylist')));
        },
        actions: [{ label: t('cancel') }],
      });
    },
    newPlaylist(ids = []) {
      const name = h('input', { type: 'text', placeholder: t('plName') });
      const desc = h('textarea', { rows: 2, placeholder: t('plDesc') });
      modal({ title: t('newPlaylist'), body: (b) => b.append(h('div.field', h('label', t('plName')), name), h('div.field', h('label', t('plDesc')), desc)),
        actions: [{ label: t('cancel') }, { label: t('create'), cls: 'primary', onClick: async () => { if (!name.value.trim()) return false; const p = await window.liwa.playlists.create({ name: name.value, description: desc.value, videos: ids }); S.playlists.unshift(p); renderSidebar(); router.go(`#/playlist/${p.id}`); } }] });
      setTimeout(() => name.focus(), 50);
    },
    editPlaylist(p) {
      const name = h('input', { type: 'text', value: p.name }); const desc = h('textarea', { rows: 2, value: p.description });
      modal({ title: t('edit'), body: (b) => b.append(h('div.field', h('label', t('plName')), name), h('div.field', h('label', t('plDesc')), desc)),
        actions: [{ label: t('cancel') }, { label: t('save'), cls: 'primary', onClick: async () => { Object.assign(p, await window.liwa.playlists.update(p.id, { name: name.value, description: desc.value })); router.refresh(); } }] });
    },
    deletePlaylist(p) {
      modal({ title: `${t('delete')}: ${p.name}`, actions: [{ label: t('cancel') }, { label: t('delete'), cls: 'danger', onClick: async () => { await window.liwa.playlists.remove(p.id); S.playlists = S.playlists.filter((x) => x.id !== p.id); router.go('#/playlists'); } }] });
    },
    async smartPlaylist() {
      if (!aiReady()) return;
      const inp = h('input', { type: 'text', placeholder: LT.lang === 'ar' ? 'مثال: فيديوهات هادئة قصيرة قبل النوم' : 'e.g. calm short videos before bed' });
      modal({ title: t('smartPl'), body: (b) => b.append(h('div.field', inp)), actions: [{ label: t('cancel') }, { label: t('create'), cls: 'primary', onClick: async () => {
        const prompt = inp.value.trim(); if (!prompt) return false;
        toast(t('aiWorking'), { ms: 6000 });
        try { const p = await window.liwa.ai.smartPlaylist(prompt); S.playlists.unshift(p); renderSidebar(); router.go(`#/playlist/${p.id}`); }
        catch (err) { toast(actions.aiError(err), { err: true }); }
      } }] });
      setTimeout(() => inp.focus(), 50);
    },
    async refreshForYou() {
      if (!aiReady()) { S.homeChip = 'all'; router.refresh(); return; }
      S.forYou = null;
      try { S.forYou = await window.liwa.ai.forYou(); } catch (err) { toast(actions.aiError(err), { err: true }); S.homeChip = 'all'; }
      if (S.route.view === 'home') router.refresh();
    },
    async subtitleText(id) {
      try {
        const list = await window.liwa.subtitles.list(id);
        if (!list.length) return '';
        const txt = await (await fetch(list[0].url)).text();
        return txt.split('\n').filter((l) => l && !/-->/.test(l) && l !== 'WEBVTT' && !/^\d+$/.test(l)).join(' ').slice(0, 6000);
      } catch { return ''; }
    },
    async analyze(id, { silent = false } = {}) {
      if (!aiReady()) return null;
      const v = V().info(id);
      if (!v) return null;
      if (!silent) toast(`${t('aiWorking')} ${v.title}`, { ms: 5000 });
      try {
        const frames = await LT.thumbs.captureFrames(v.url, S.settings.aiFrames || 8);
        const subs = await actions.subtitleText(id);
        const res = await window.liwa.ai.analyze(id, frames, subs);
        S.user.ai[id] = res;
        // أفضل إطار كصورة مصغّرة
        if (res.bestFrameAt != null) {
          try {
            const cap = await LT.thumbs.capture(v.url, { at: res.bestFrameAt });
            const thumb = await window.liwa.library.saveThumb(id, await LT.thumbs.dataUrlToBuf(cap.dataUrl), cap.at);
            S.lib.videos[id].thumb = thumb;
          } catch { /* الصورة القديمة تبقى */ }
        }
        if (!silent) { toast(`${t('analyzed')}: ${res.title}`); router.refresh(); }
        return res;
      } catch (err) { if (!silent) toast(actions.aiError(err), { err: true }); return null; }
    },
    async analyzeAll(btn) {
      if (!aiReady()) return;
      const list = V().allInfo().filter((v) => !v.ai && v.native);
      if (!list.length) return;
      btn.disabled = true;
      let done = 0;
      for (const v of list) {
        btn.textContent = `${done}/${list.length}…`;
        await actions.analyze(v.id, { silent: true });
        done++;
      }
      btn.disabled = false; btn.textContent = t('analyzed');
      router.refresh();
    },
    editMeta(id) {
      const v = V().info(id);
      const title = h('input', { type: 'text', value: v.title });
      const desc = h('textarea', { rows: 4, value: v.description });
      const tags = h('input', { type: 'text', value: v.tags.join(', ') });
      const chan = h('input', { type: 'text', value: v.channel });
      modal({ title: t('edit'), body: (b) => b.append(
        h('div.field', h('label', LT.lang === 'ar' ? 'العنوان' : 'Title'), title),
        h('div.field', h('label', t('description')), desc),
        h('div.field', h('label', LT.lang === 'ar' ? 'الوسوم (مفصولة بفواصل)' : 'Tags (comma separated)'), tags),
        h('div.field', h('label', LT.lang === 'ar' ? 'اسم القناة (للعرض فقط)' : 'Channel name (display only)'), chan),
        h('div.muted.xs', v.file)),
      actions: [{ label: t('cancel') }, { label: t('save'), cls: 'primary', onClick: async () => {
        S.user.overrides[id] = await window.liwa.user.override(id, { title: title.value, description: desc.value, tags: tags.value.split(/[,،]/).map((x) => x.trim()).filter(Boolean), channel: chan.value });
        router.refresh();
      } }] });
    },
    setPin() {
      const cur = h('input', { type: 'password', placeholder: LT.lang === 'ar' ? 'الرمز الحالي' : 'Current PIN', inputmode: 'numeric' });
      const pin = h('input', { type: 'password', placeholder: LT.lang === 'ar' ? 'رمز جديد (4–8 أرقام)' : 'New PIN (4–8 digits)', inputmode: 'numeric' });
      modal({ title: '🔒 PIN', body: (b) => b.append(S.lockEnabled ? h('div.field', cur) : null, h('div.field', pin)),
        actions: [{ label: t('cancel') }, { label: t('save'), cls: 'primary', onClick: async () => {
          try { await window.liwa.lock.setPin(pin.value, cur.value); S.lockEnabled = true; toast(t('saved')); router.refresh(); }
          catch (err) { toast(err.message === 'WRONG_PIN' ? t('wrongPin') : (LT.lang === 'ar' ? 'الرمز يجب أن يكون 4–8 أرقام' : 'PIN must be 4–8 digits'), { err: true }); return false; }
        } }] });
    },
    clearPin() {
      const cur = h('input', { type: 'password', placeholder: LT.lang === 'ar' ? 'الرمز الحالي' : 'Current PIN', inputmode: 'numeric' });
      modal({ title: '🔓', body: (b) => b.append(h('div.field', cur)), actions: [{ label: t('cancel') }, { label: t('delete'), cls: 'danger', onClick: async () => {
        try { await window.liwa.lock.clearPin(cur.value); S.lockEnabled = false; router.refresh(); } catch { toast(t('wrongPin'), { err: true }); return false; }
      } }] });
    },
    aiError(err) {
      const code = err && (err.code || err.message);
      if (code === 'NO_API_KEY') return t('aiOff');
      if (code === 'REFUSAL') return LT.lang === 'ar' ? 'رفض النموذج هذا الطلب.' : 'The model declined this request.';
      if (/401|auth/i.test(String(err.message))) return LT.lang === 'ar' ? 'مفتاح API غير صالح.' : 'Invalid API key.';
      if (/429|rate/i.test(String(err.message))) return LT.lang === 'ar' ? 'تجاوزت حد الطلبات، حاول بعد قليل.' : 'Rate limited, try again shortly.';
      return `${LT.lang === 'ar' ? 'خطأ' : 'Error'}: ${err.message || err}`;
    },
  };
  LT.actions = actions;
  function aiReady() {
    if (S.ai.enabled && S.ai.hasKey) return true;
    toast(t('aiOff'), { err: true, action: t('settings'), onAction: () => router.go('#/settings') });
    return false;
  }

  // ---------- المكتبة والصور المصغّرة
  function setLib(lib) { S.lib = lib; renderSidebar(); }
  const scanBar = $('#scanBar');
  window.liwa.library.onProgress((p) => { scanBar.hidden = false; $('#scanText').textContent = `${t('scanning')} ${p.done}/${p.total}`; });
  window.liwa.library.onUpdated((lib) => {
    setLib({ folders: lib.folders, videos: lib.videos, channels: lib.channels });
    scanBar.hidden = true;
    if (lib.stats && (lib.stats.added || lib.stats.removed)) {
      if (S.route.view !== 'watch') router.refresh();
      runThumbs();
    }
  });
  LT.probeProgress = (p) => { scanBar.hidden = p.done >= p.total; $('#scanText').textContent = `${t('probing')} ${p.done}/${p.total}`; };
  let thumbTick = 0;
  function runThumbs() {
    LT.thumbs.runQueue((id, rec) => {
      if (rec && S.lib.videos[id]) Object.assign(S.lib.videos[id], rec);
      // تحديث البطاقة في مكانها بدل إعادة رسم الصفحة
      const cardEl = document.querySelector(`.card[data-id="${id}"] .thumb`);
      if (cardEl && rec && rec.thumb) {
        const ph = cardEl.querySelector('.ph');
        if (ph) ph.replaceWith(h('img', { src: LT.urls.thumb(S.lib.videos[id]) }));
        if (rec.duration && !cardEl.querySelector('.dur')) cardEl.append(h('span.dur', LT.fmtTime(rec.duration)));
      }
      if (++thumbTick % 20 === 0 && S.route.view !== 'watch') { S.lib.channels = S.lib.channels.map((c) => c); }
      if (S.settings.aiAutoAnalyze && S.ai.enabled && S.ai.hasKey && rec && rec.thumb && !S.user.ai[id]) actions.analyze(id, { silent: true });
    }, () => { scanBar.hidden = true; if (S.route.view !== 'watch') router.refresh(); });
  }

  // ---------- الإعدادات والمظهر
  LT.applySettings = () => {
    const s = S.settings;
    LT.setLang(s.lang);
    document.body.className = `theme-${s.theme} accent-${s.accent}${LT.mode === 'web' ? ' web' : ''}${s.tvMode === 'on' || (s.tvMode !== 'off' && LT.isTV) ? ' tv' : ''}`;
    $('#search').placeholder = t('search');
    $('#shell').classList.toggle('collapsed', Boolean(s.sidebarCollapsed));
    S.ai.enabled = s.aiEnabled; S.ai.model = s.aiModel;
    if (S.route && S.route.view === 'settings') { /* تُعاد الترجمة عند الانتقال */ }
  };

  // ---------- القفل
  let idleTimer = null;
  function showLock() {
    const lock = $('#lock'); const inp = $('#lockPin');
    lock.hidden = false; $('#lockMsg').textContent = t('lockTitle'); $('#lockBtn').textContent = t('unlock');
    inp.value = ''; setTimeout(() => inp.focus(), 50);
    LT.player.pause();
    const tryUnlock = async () => {
      if (await window.liwa.lock.verify(inp.value)) { lock.hidden = true; inp.value = ''; armIdle(); }
      else { inp.classList.add('shake'); $('#lockMsg').textContent = t('wrongPin'); setTimeout(() => inp.classList.remove('shake'), 500); inp.value = ''; }
    };
    $('#lockBtn').onclick = tryUnlock;
    inp.onkeydown = (e) => { if (e.key === 'Enter') tryUnlock(); };
  }
  function armIdle() {
    clearTimeout(idleTimer);
    const m = Number(S.settings.lockIdleMinutes) || 0;
    if (!S.lockEnabled || !m) return;
    idleTimer = setTimeout(showLock, m * 60000);
  }
  ['mousemove', 'keydown', 'click'].forEach((ev) => document.addEventListener(ev, () => { if (idleTimer) armIdle(); }, { passive: true }));

  // ---------- أحداث عامة
  function wireChrome() {
    $('#btnMenu').onclick = () => { S.settings.sidebarCollapsed = !S.settings.sidebarCollapsed; $('#shell').classList.toggle('collapsed', S.settings.sidebarCollapsed); window.liwa.settings.set({ sidebarCollapsed: S.settings.sidebarCollapsed }); };
    $('#btnMin').onclick = () => window.liwa.window.minimize();
    $('#btnMax').onclick = () => window.liwa.window.maximize();
    $('#btnClose').onclick = () => window.liwa.window.close();
    $('#btnAddFolder').onclick = () => actions.addFolder();
    if (LT.mode === 'web' && !(S.auth && S.auth.admin)) $('#btnAddFolder').hidden = true;
    $('#btnSettings').onclick = () => router.go('#/settings');
    $('#searchForm').onsubmit = (e) => { e.preventDefault(); const q = $('#search').value.trim(); if (q) router.go(`#/search?q=${encodeURIComponent(q)}`); };
    $('#btnAiSearch').onclick = () => { const q = $('#search').value.trim(); if (!q) { $('#search').focus(); return; } S.pendingAiSearch = q; router.go(`#/search?q=${encodeURIComponent(q)}`); };
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (e.key === '/' && tag !== 'input' && tag !== 'textarea') { e.preventDefault(); $('#search').focus(); $('#search').select(); }
      if (e.key === 'Escape' && tag === 'input') e.target.blur();
    });
    // سحب وإفلات المجلدات
    const hint = $('#dropHint');
    document.addEventListener('dragover', (e) => { e.preventDefault(); hint.hidden = false; });
    document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) hint.hidden = true; });
    document.addEventListener('drop', async (e) => {
      e.preventDefault(); hint.hidden = true;
      const paths = [...e.dataTransfer.files].map((f) => window.liwa.app.pathOf(f)).filter(Boolean);
      if (paths.length) { const lib = await window.liwa.library.addPaths(paths); setLib(lib); toast(t('folderAdded')); router.refresh(); }
    });
    window.liwa.window.onState(({ maximized }) => { $('#btnMax').title = maximized ? '⧉' : '☐'; });
    window.liwa.app.onOpen(({ id }) => router.go(`#/watch/${id}`));
  }

  // ---------- الإقلاع
  async function boot() {
    if (LT.beforeBoot && !(await LT.beforeBoot())) return;
    if (window.liwa.auth) { S.auth = await window.liwa.auth.status(); S.site = S.auth.site || null; }
    const [info, settings, lib, user, pls, ai, lockSt] = await Promise.all([
      window.liwa.app.info(), window.liwa.settings.get(), window.liwa.library.get(), window.liwa.user.get(), window.liwa.playlists.list(), window.liwa.ai.status(), window.liwa.lock.status(),
    ]);
    Object.assign(S, { info, settings, user, playlists: pls, ai: { ...ai, models: ai.models || [] }, lockEnabled: lockSt.enabled });
    S.lib = lib;
    LT.applySettings();
    LT.player.applyVolume(Number(settings.volume ?? 1), Boolean(settings.muted));
    wireChrome();
    if (S.lockEnabled) showLock();
    if (!location.hash) location.hash = `#/${settings.lastView && settings.lastView !== 'watch' ? settings.lastView : 'home'}`;
    await render();
    setTimeout(runThumbs, 800);
    armIdle();
  }
  /** شاشة خطأ واضحة بدل الشاشة السوداء عند فشل الإقلاع، مع زر إعادة محاولة. */
  function bootError(err) {
    console.error(err);
    const ar = (S.settings && S.settings.lang) !== 'en';
    const net = err && ['NETWORK', 'TIMEOUT'].includes(err.code);
    const wrap = document.getElementById('view') || document.body;
    wrap.innerHTML = '';
    wrap.append(h('div.empty',
      h('h2', net ? (ar ? 'تعذّر الوصول إلى الخادم' : 'Cannot reach the server') : (ar ? 'تعذّر تشغيل التطبيق' : 'Could not start')),
      h('p', net
        ? (ar ? 'تأكد من اتصالك بالإنترنت وأن الخادم يعمل. إن كان على استضافة مجانية فقد يحتاج دقيقة ليستيقظ.' : 'Check your connection and that the server is running. Free hosting may need a minute to wake up.')
        : String((err && err.message) || err)),
      h('div.row', { style: { justifyContent: 'center', gap: '8px', marginTop: '16px' } },
        h('button.btn.primary', { onclick: () => location.reload() }, ar ? 'إعادة المحاولة' : 'Retry'),
        LT.mode === 'web' && LT.changeServer ? h('button.btn', { onclick: () => LT.changeServer() }, ar ? 'تغيير الخادم' : 'Change server') : null)));
    const lock = document.getElementById('lock'); if (lock) lock.hidden = true;
    const conn = document.getElementById('connect'); if (conn) conn.hidden = true;
  }
  window.addEventListener('DOMContentLoaded', () => boot().catch(bootError));
})(window.LT);
