/* LiwaTube — صفحات الواجهة: الرئيسية، Shorts، القنوات، البحث، المكتبة، المشاهدة، الإعدادات، الذكاء الاصطناعي. */
'use strict';
(function (LT) {
  const { $, h, t, fmtTime, timeAgo, fmtViews, colorFor, initial, esc } = LT;
  const S = () => LT.state;
  const A = () => LT.actions;

  /** معلومات فيديو مدمجة: التجاوزات اليدوية > تحليل الذكاء الاصطناعي > اسم الملف. */
  function info(id) {
    const v = S().lib.videos[id];
    if (!v) return null;
    const u = S().user;
    const ov = u.overrides[id] || {};
    const ai = u.ai[id] || null;
    const prog = u.progress[id];
    const ratio = prog && prog.dur ? Math.min(1, prog.pos / prog.dur) : 0;
    return {
      ...v,
      title: ov.title || (ai && ai.title) || v.title,
      description: ov.description || (ai && ai.description) || '',
      tags: ov.tags || (ai && ai.tags) || [],
      channel: ov.channel || v.channel,
      ai,
      url: LT.urls.video(v),
      thumbUrl: v.thumb ? LT.urls.thumb(v) : null,
      plays: v.views != null ? v.views : (u.playCount[id] || 0),
      canEdit: LT.mode !== 'web' || Boolean(S().auth && S().auth.admin),
      ratio,
      resumeAt: ratio > 0.03 && ratio < 0.95 ? prog.pos : 0,
      watched: ratio >= 0.95,
      liked: u.likes[id] || 0,
      inLater: u.watchLater.includes(id),
      isShort: (v.duration > 0 && v.duration <= (S().settings.shortsMax || 60)) || (v.height > v.width && v.duration <= 180 && v.duration > 0),
    };
  }
  const allInfo = () => Object.keys(S().lib.videos).map(info).filter(Boolean);
  const channelName = (cid) => (S().lib.channels.find((c) => c.id === cid) || {}).name || '';

  function avatar(name, cls = '') {
    return h('div.avatar', { class: cls, style: { background: colorFor(name) } }, initial(name));
  }

  // ---------- بطاقة فيديو
  function card(v, { mode = 'grid', why = null, showChannel = true, index = null, onRemove = null } = {}) {
    if (!v) return null;
    const thumb = h('div.thumb',
      v.thumbUrl ? h('img', { src: v.thumbUrl, loading: 'lazy', alt: '' }) : h('div.ph', LT.icon('all', 40)),
      v.duration ? h('span.dur', fmtTime(v.duration)) : null,
      v.ai ? h('span.badge.ai', LT.icon('ai', 12), 'AI') : null,
      v.watched ? h('span.badge', { style: { insetInlineStart: 'auto', insetInlineEnd: '6px' } }, t('watched')) : null,
      v.ratio > 0.01 ? h('div.prog', h('i', { style: { width: `${v.ratio * 100}%` } })) : null,
    );
    const sub = [v.channel, fmtViews(v.plays), timeAgo(v.addedAt || v.mtimeMs)].filter(Boolean).join(' • ');
    const more = h('button.more', { title: '⋮', onclick: (e) => { e.stopPropagation(); A().ctxFor(v.id, e.clientX, e.clientY, { onRemove }); } }, LT.icon('more', 20));
    const meta = h('div.meta',
      mode === 'grid' && showChannel ? avatar(v.channel) : null,
      h('div.grow',
        h('div.ttl.two', v.title),
        h('div.sub', mode === 'grid' ? sub : [v.channel, fmtViews(v.plays), timeAgo(v.addedAt || v.mtimeMs)].filter(Boolean).join(' • ')),
        why ? h('div.why', why) : null,
        mode === 'list' && (v.description || (v.ai && v.ai.summary)) ? h('div.desc.two', v.ai?.summary || v.description) : null,
      ),
      more,
    );
    const el = h('div.card', { class: mode === 'list' ? 'list' : mode === 'mini' ? 'mini-card' : '', dataset: { id: v.id }, tabindex: 0, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); A().play(v.id); } }, onclick: () => A().play(v.id), oncontextmenu: (e) => { e.preventDefault(); A().ctxFor(v.id, e.clientX, e.clientY, { onRemove }); } },
      index != null ? h('div.idx', String(index)) : null, thumb, meta);
    // معاينة عند التمرير
    if (S().settings.hoverPreview && v.native) {
      let vid = null; let tm = null;
      el.addEventListener('mouseenter', () => {
        tm = setTimeout(() => {
          vid = h('video.hover', { muted: true, src: v.url, preload: 'metadata' });
          vid.currentTime = Math.min(v.duration * 0.15 || 0, 30);
          vid.addEventListener('loadeddata', () => { vid.classList.add('show'); vid.play().catch(() => {}); });
          thumb.append(vid);
        }, 700);
      });
      el.addEventListener('mouseleave', () => { clearTimeout(tm); if (vid) { vid.pause(); vid.removeAttribute('src'); vid.remove(); vid = null; } });
    }
    return el;
  }

  const empty = (title, hint, withAdd = true) => {
    if (LT.mode === 'web') {
      const admin = Boolean(S().auth && S().auth.admin);
      return h('div.empty', h('h2', t('emptyWeb')), h('p', t('emptyWebHint')), admin ? h('button.btn.primary', { onclick: () => A().addFolder() }, LT.icon('folder'), t('upload')) : h('button.btn', { onclick: () => LT.studio.login() }, t('adminLogin')));
    }
    return h('div.empty', h('h2', title), h('p', hint), withAdd ? h('button.btn.primary', { onclick: () => A().addFolder() }, LT.icon('folder'), t('addFolder')) : null);
  };
  const grid = (list, opts) => h('div.grid', list.map((v) => card(v, opts)));

  // ---------- الرئيسية
  async function home() {
    const st = S();
    const videos = allInfo();
    if (!videos.length) return empty(t('empty'), t('emptyHint'));
    const chipState = st.homeChip || 'all';
    const cats = [...new Set(Object.values(st.user.ai).map((a) => a.category).filter(Boolean))].slice(0, 12);
    const subs = st.lib.channels.filter((c) => st.user.subscriptions[c.id]).slice(0, 8);
    const chips = h('div.chips',
      chip('all', t('all')),
      st.ai.enabled ? chip('forYou', `✨ ${t('forYou')}`) : null,
      chip('continue', t('continueW')),
      chip('recent', t('recent')),
      subs.length ? chip('subs', t('fromSubs')) : null,
      cats.map((c) => chip(`cat:${c}`, c)),
    );
    function chip(key, label) {
      return h('button.chip', { class: chipState === key ? 'on' : '', onclick: () => { st.homeChip = key; LT.router.refresh(); } }, label);
    }
    const root = h('div', chips);
    const byId = (x) => info(x.id || x);
    if (chipState === 'forYou') {
      root.append(h('div.ai-note', st.forYou ? LT.icon('ai') : h('span.spin'), h('span.grow', st.forYou ? st.forYou.note : t('aiWorking')), h('button.btn.sm', { onclick: () => A().refreshForYou() }, '↻')));
      if (!st.forYou) A().refreshForYou();
      else root.append(h('div.grid', st.forYou.picks.map((p) => card(byId(p.id), { why: p.why }))));
      return root;
    }
    if (chipState === 'continue') {
      const list = videos.filter((v) => v.resumeAt > 0).sort((a, b) => (st.user.progress[b.id]?.at || 0) - (st.user.progress[a.id]?.at || 0));
      root.append(list.length ? grid(list) : h('div.empty', h('p', t('noResults'))));
      return root;
    }
    if (chipState === 'recent') { root.append(grid(videos.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 80))); return root; }
    if (chipState === 'subs') { root.append(grid(videos.filter((v) => st.user.subscriptions[v.channelId]).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)))); return root; }
    if (chipState.startsWith('cat:')) { const c = chipState.slice(4); root.append(grid(videos.filter((v) => v.ai && v.ai.category === c))); return root; }

    // «الكل»: تابع المشاهدة (صف) ثم التوصيات المحلية
    const cont = videos.filter((v) => v.resumeAt > 0).sort((a, b) => (st.user.progress[b.id]?.at || 0) - (st.user.progress[a.id]?.at || 0)).slice(0, 4);
    if (cont.length) {
      root.append(h('div.section-h', t('continueW')), h('div.grid.dense', cont.map((v) => card(v))), h('div', { style: { height: '24px' } }));
    }
    const feed = await window.liwa.feed.home({ seed: st.homeSeed, limit: 80 });
    const why = (r) => { const k = r.find((x) => ['channel', 'tags', 'resume'].includes(x)); return k ? t(`why_${k}`) : null; };
    root.append(h('div.grid', feed.map((f) => card(byId(f.id), { why: why(f.reasons) })).filter(Boolean)));
    return root;
  }

  // ---------- Shorts
  function shorts() {
    const list = allInfo().filter((v) => v.isShort && v.native).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    if (!list.length) return empty(t('shortsEmpty'), t('shortsHint'), false);
    const root = h('div.shorts');
    let active = null;
    const items = list.map((v) => {
      const vid = h('video', { src: v.url, loop: true, playsInline: true, preload: 'metadata' });
      const prog = h('i');
      vid.addEventListener('timeupdate', () => { prog.style.width = `${(vid.currentTime / (vid.duration || 1)) * 100}%`; });
      const frame = h('div.s-frame', { onclick: () => { if (vid.paused) vid.play(); else vid.pause(); } }, vid,
        h('div.s-meta', h('div.ttl', v.title), h('div.sm', v.channel)), h('div.s-prog', prog));
      const likeBtn = h('button.icon-btn', { class: v.liked > 0 ? 'on' : '', onclick: async () => { await A().like(v.id, v.liked > 0 ? 0 : 1); likeBtn.classList.toggle('on'); } }, LT.icon('like'));
      const acts = h('div.s-acts',
        h('div', likeBtn, h('span', t('like'))),
        h('div', h('button.icon-btn', { onclick: () => A().addToPlaylist([v.id]) }, LT.icon('save')), h('span', t('save'))),
        h('div', h('button.icon-btn', { onclick: () => A().play(v.id) }, LT.icon('expand')), h('span', t('play'))),
        h('div', h('button.icon-btn', { onclick: (e) => A().ctxFor(v.id, e.clientX, e.clientY) }, LT.icon('more')), h('span', '')),
      );
      const el = h('div.short', frame, acts);
      el._vid = vid;
      return el;
    });
    root.append(...items);
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const vid = en.target._vid;
        if (en.intersectionRatio > 0.6) {
          if (active && active !== vid) active.pause();
          active = vid; vid.muted = S().settings.muted; vid.play().catch(() => {});
          const id = list[items.indexOf(en.target)].id; window.liwa.user.played(id).then(() => { S().user.playCount[id] = (S().user.playCount[id] || 0) + 1; });
        } else vid.pause();
      }
    }, { root: $('#main'), threshold: [0, 0.6, 1] });
    items.forEach((el) => io.observe(el));
    root._cleanup = () => { io.disconnect(); items.forEach((el) => { el._vid.pause(); el._vid.removeAttribute('src'); }); };
    return root;
  }

  // ---------- القنوات والاشتراكات
  function channels() {
    const st = S();
    const list = st.lib.channels;
    if (!list.length) return empty(t('empty'), t('emptyHint'));
    return h('div', h('div.section-h', t('channels'), h('span.muted', `${list.length}`)),
      h('div.ch-grid', list.map((c) => h('div.ch-card', { onclick: () => LT.router.go(`#/channel/${c.id}`) },
        avatar(c.name), h('div', h('div.ttl', { style: { fontWeight: 600 } }, c.name), h('div.sub.muted.sm', `${c.count} ${t('videos')}${st.user.subscriptions[c.id] ? ` • ${t('subscribed')}` : ''}`))))));
  }
  function subs() {
    const st = S();
    const subsList = st.lib.channels.filter((c) => st.user.subscriptions[c.id]);
    if (!subsList.length) return h('div.empty', h('h2', t('subs')), h('p', LT.lang === 'ar' ? 'اشترك في قناة (مجلد) لتظهر فيديوهاتها الجديدة هنا.' : 'Subscribe to a channel (folder) to see its new videos here.'), h('button.btn', { onclick: () => LT.router.go('#/channels') }, t('channels')));
    const list = allInfo().filter((v) => st.user.subscriptions[v.channelId]).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    return h('div', h('div.chips', subsList.map((c) => h('button.chip', { onclick: () => LT.router.go(`#/channel/${c.id}`) }, c.name))), grid(list));
  }
  function channel(id) {
    const st = S();
    const c = st.lib.channels.find((x) => x.id === id);
    if (!c) return h('div.empty', h('p', t('noResults')));
    const sort = st.chSort || 'new';
    let list = allInfo().filter((v) => v.channelId === id);
    list = sortList(list, sort);
    const subOn = Boolean(st.user.subscriptions[id]);
    const subBtn = h('button.btn', { class: subOn ? 'on' : 'primary', onclick: async () => { const on = await A().subscribe(id, !subOn); LT.router.refresh(); } }, subOn ? t('subscribed') : t('subscribe'));
    const sorts = [['new', 'sortNew'], ['old', 'sortOld'], ['pop', 'sortPop'], ['long', 'sortLong'], ['name', 'sortName']];
    return h('div',
      h('div.ch-banner'),
      h('div.ch-head', avatar(c.name), h('div.grow', h('h1', c.name), h('div.muted.sm', `${c.count} ${t('videos')} • ${LT.fmtHours(c.duration)} ${t('hours')}`), h('div.muted.xs.ellip', { style: { direction: 'ltr', textAlign: 'start' } }, c.folders.join(' • '))), subBtn),
      h('div.chips', sorts.map(([k, l]) => h('button.chip', { class: sort === k ? 'on' : '', onclick: () => { st.chSort = k; LT.router.refresh(); } }, t(l)))),
      grid(list, { showChannel: false }));
  }
  function sortList(list, sort) {
    const s = [...list];
    if (sort === 'new') s.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    if (sort === 'old') s.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
    if (sort === 'pop') s.sort((a, b) => b.plays - a.plays);
    if (sort === 'long') s.sort((a, b) => b.duration - a.duration);
    if (sort === 'name') s.sort((a, b) => a.title.localeCompare(b.title, LT.lang));
    return s;
  }

  // ---------- كل الفيديوهات
  function all() {
    const st = S();
    const f = st.allFilter || { sort: 'new', dur: 'any', watched: 'any' };
    let list = allInfo();
    if (f.dur === 'short') list = list.filter((v) => v.duration < 240);
    if (f.dur === 'medium') list = list.filter((v) => v.duration >= 240 && v.duration <= 1200);
    if (f.dur === 'long') list = list.filter((v) => v.duration > 1200);
    if (f.watched === 'yes') list = list.filter((v) => v.watched);
    if (f.watched === 'no') list = list.filter((v) => !v.watched && !v.plays);
    list = sortList(list, f.sort);
    if (!allInfo().length) return empty(t('empty'), t('emptyHint'));
    const set = (k, v) => { st.allFilter = { ...f, [k]: v }; LT.router.refresh(); };
    return h('div',
      h('div.chips',
        [['new', 'sortNew'], ['old', 'sortOld'], ['pop', 'sortPop'], ['long', 'sortLong'], ['name', 'sortName']].map(([k, l]) => h('button.chip', { class: f.sort === k ? 'on' : '', onclick: () => set('sort', k) }, t(l))),
        h('span', { style: { width: '12px' } }),
        [['any', 'any'], ['short', 'short'], ['medium', 'medium'], ['long', 'long']].map(([k, l]) => h('button.chip', { class: f.dur === k ? 'on' : '', onclick: () => set('dur', k) }, `${t('duration')}: ${t(l)}`)),
        h('span', { style: { width: '12px' } }),
        [['any', 'any'], ['yes', 'watched'], ['no', 'unwatchedF']].map(([k, l]) => h('button.chip', { class: f.watched === k ? 'on' : '', onclick: () => set('watched', k) }, t(l))),
      ),
      h('div.h-note', `${list.length} ${t('videos')}`),
      grid(list));
  }

  // ---------- البحث
  async function search(q) {
    const st = S();
    const root = h('div');
    const query = String(q || '').trim();
    if (!query) return h('div.empty', h('p', t('search')));
    const res = await window.liwa.feed.search(query);
    const list = res.map((r) => info(r.id)).filter(Boolean);
    const aiBox = h('div');
    root.append(h('div.section-h', `${t('search')}: ${query}`, h('span.muted', `${list.length}`), h('span.spacer'),
      h('button.btn.sm', { onclick: () => aiSearch(query, aiBox), title: st.ai.enabled ? '' : t('aiOff') }, LT.icon('ai', 18), t('aiSearch'))), aiBox);
    if (st.pendingAiSearch === query) { st.pendingAiSearch = null; aiSearch(query, aiBox); }
    root.append(list.length ? h('div.stack', list.map((v) => card(v, { mode: 'list' }))) : h('div.empty', h('p', t('noResults'))));
    return root;
  }
  async function aiSearch(query, box) {
    if (!S().ai.enabled || !S().ai.hasKey) { LT.toast(t('aiOff'), { err: true, action: t('settings'), onAction: () => LT.router.go('#/settings') }); return; }
    box.innerHTML = ''; box.append(h('div.ai-note', h('span.spin'), t('aiWorking')));
    try {
      const r = await window.liwa.ai.search(query);
      box.innerHTML = '';
      box.append(h('div.ai-note', LT.icon('ai'), h('span', h('b', `${t('interpretation')}: `), r.interpretation)));
      box.append(h('div.stack', r.results.map((x) => card(info(x.id), { mode: 'list', why: x.why }))), h('div.nav-sep'));
    } catch (err) { box.innerHTML = ''; LT.toast(A().aiError(err), { err: true }); }
  }

  // ---------- المكتبة
  function history() {
    const st = S();
    const hist = st.user.history.map((x) => ({ ...x, v: info(x.id) })).filter((x) => x.v);
    if (!hist.length) return h('div.empty', h('h2', t('history')), h('p', t('noResults')));
    const root = h('div', h('div.section-h', t('history'), h('span.spacer'), h('button.btn.sm', { onclick: async () => { await window.liwa.user.clearHistory(); st.user.history = []; LT.router.refresh(); } }, LT.icon('trash', 18), t('clearHistory'))));
    let lastDay = '';
    const dayLabel = (ms) => {
      const d = new Date(ms); const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1);
      if (d.toDateString() === today.toDateString()) return t('today');
      if (d.toDateString() === y.toDateString()) return t('yesterday');
      return d.toLocaleDateString(LT.lang === 'ar' ? 'ar-SA' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' });
    };
    const stack = h('div.stack');
    for (const x of hist) {
      const dl = dayLabel(x.at);
      if (dl !== lastDay) { lastDay = dl; stack.append(h('div.day-h', dl)); }
      stack.append(card(x.v, { mode: 'list', onRemove: { label: t('removeHist'), fn: async () => { await window.liwa.user.removeHistory(x.id); st.user.history = st.user.history.filter((hh) => hh.id !== x.id); LT.router.refresh(); } } }));
    }
    root.append(stack);
    return root;
  }
  function later() {
    const st = S();
    const list = st.user.watchLater.map(info).filter(Boolean);
    return listPage(t('later'), list, { playAll: true, onRemove: (id) => ({ label: t('later_rm'), fn: () => A().watchLater(id, false) }) });
  }
  function liked() {
    const st = S();
    const list = Object.keys(st.user.likes).filter((id) => st.user.likes[id] > 0).sort((a, b) => (st.user.likedAt[b] || 0) - (st.user.likedAt[a] || 0)).map(info).filter(Boolean);
    return listPage(t('liked'), list, { playAll: true });
  }
  function listPage(title, list, { playAll = false, onRemove = null, desc = '', extra = null } = {}) {
    const first = list[0];
    const total = list.reduce((a, v) => a + (v.duration || 0), 0);
    return h('div',
      h('div.pl-head',
        first ? h('div.thumb', first.thumbUrl ? h('img', { src: first.thumbUrl }) : h('div.ph', LT.icon('all', 40))) : null,
        h('div.grow', h('h1', title), desc ? h('p.muted', desc) : null, h('div.muted.sm', `${list.length} ${t('videos')} • ${fmtTime(total)}`),
          h('div.row', { style: { marginTop: '12px' } }, playAll && list.length ? h('button.btn.primary', { onclick: () => A().playQueue(list.map((v) => v.id)) }, LT.icon('play'), t('play')) : null, extra))),
      list.length ? h('div.stack.pl-list', list.map((v, i) => card(v, { mode: 'list', index: i + 1, onRemove: onRemove ? onRemove(v.id) : null }))) : h('div.empty', h('p', t('noResults'))));
  }
  function playlists() {
    const st = S();
    const root = h('div', h('div.section-h', t('playlists'), h('span.spacer'),
      h('button.btn.sm', { onclick: () => A().newPlaylist() }, LT.icon('plus', 18), t('newPlaylist')),
      h('button.btn.sm', { onclick: () => A().smartPlaylist() }, LT.icon('ai', 18), t('smartPl'))));
    if (!st.playlists.length) { root.append(h('div.empty', h('p', t('noResults')))); return root; }
    root.append(h('div.grid', st.playlists.map((p) => {
      const first = info(p.videos[0]);
      return h('div.card', { onclick: () => LT.router.go(`#/playlist/${p.id}`) },
        h('div.thumb', first && first.thumbUrl ? h('img', { src: first.thumbUrl }) : h('div.ph', LT.icon('playlists', 40)), h('span.dur', `${p.videos.length} ${t('videos')}`), p.ai ? h('span.badge.ai', 'AI') : null),
        h('div.meta', h('div.grow', h('div.ttl', p.name), h('div.sub', p.description || timeAgo(p.updatedAt)))));
    })));
    return root;
  }
  function playlist(id) {
    const st = S();
    const p = st.playlists.find((x) => x.id === id);
    if (!p) return h('div.empty', h('p', t('noResults')));
    const list = p.videos.map(info).filter(Boolean);
    const extra = h('div.row',
      h('button.btn.sm', { onclick: () => A().editPlaylist(p) }, LT.icon('edit', 18), t('edit')),
      h('button.btn.sm.danger', { onclick: () => A().deletePlaylist(p) }, LT.icon('trash', 18), t('delete')));
    return listPage(p.name, list, { playAll: true, desc: p.description, extra, onRemove: (vid) => ({ label: t('removed'), fn: async () => { await window.liwa.playlists.removeVideo(p.id, vid); p.videos = p.videos.filter((x) => x !== vid); LT.router.refresh(); } }) });
  }

  // ---------- صفحة المشاهدة
  async function watch(id) {
    const st = S();
    const v = info(id);
    if (!v) return h('div.empty', h('p', t('noResults')));
    const playerBox = h('div.w-player');
    const theater = LT.player.isTheater();
    const root = h('div.watch', { class: theater ? 'theater' : '' });
    const main = h('div.w-main', playerBox);
    // شريط المعلومات
    const title = h('h1.w-title', v.title);
    const subOn = Boolean(st.user.subscriptions[v.channelId]);
    const subBtn = h('button.btn', { class: subOn ? 'on' : 'primary', onclick: async () => { const on = await A().subscribe(v.channelId, !st.user.subscriptions[v.channelId]); subBtn.className = `btn ${on ? 'on' : 'primary'}`; subBtn.textContent = on ? t('subscribed') : t('subscribe'); } }, subOn ? t('subscribed') : t('subscribe'));
    const chanCount = (st.lib.channels.find((c) => c.id === v.channelId) || {}).count || 0;
    const likeBtn = h('button.btn', { class: v.liked > 0 ? 'on' : '', onclick: async () => { const n = await A().like(v.id, v.liked > 0 ? 0 : 1); v.liked = n; likeBtn.classList.toggle('on', n > 0); dislikeBtn.classList.toggle('on', n < 0); } }, LT.icon('like'), t('like'));
    const dislikeBtn = h('button.btn', { class: v.liked < 0 ? 'on' : '', onclick: async () => { const n = await A().like(v.id, v.liked < 0 ? 0 : -1); v.liked = n; likeBtn.classList.toggle('on', n > 0); dislikeBtn.classList.toggle('on', n < 0); } }, LT.icon('dislike'));
    const laterBtn = h('button.btn', { class: v.inLater ? 'on' : '', onclick: async () => { v.inLater = !v.inLater; await A().watchLater(v.id, v.inLater); laterBtn.classList.toggle('on', v.inLater); } }, LT.icon('later'), t('later'));
    const actions = h('div.w-actions',
      h('div.btn-group', likeBtn, dislikeBtn),
      laterBtn,
      h('button.btn', { onclick: () => A().addToPlaylist([v.id]) }, LT.icon('save'), t('save')),
      h('button.btn', { onclick: () => window.liwa.app.reveal(v.id) }, LT.icon('folder'), LT.mode === 'web' ? t('copyLink') : t('share')),
      h('button.btn', { onclick: (e) => A().ctxFor(v.id, e.clientX, e.clientY) }, LT.icon('more')),
    );
    const chRow = h('div.w-row', h('div.w-ch', { style: { cursor: 'pointer' }, onclick: () => LT.router.go(`#/channel/${v.channelId}`) }, avatar(v.channel), h('div', h('div.name', v.channel), h('div.muted.xs', `${chanCount} ${t('videos')}`))), subBtn, actions);
    // الوصف
    const descText = v.description || (LT.lang === 'ar' ? 'لا يوجد وصف. شغّل التحليل بالذكاء الاصطناعي لتوليد عنوان ووصف ووسوم وفصول، أو حرّر البيانات يدويًا.' : 'No description yet. Run AI analysis to generate a title, description, tags and chapters, or edit manually.');
    const descBox = h('div.desc-box', { onclick: (e) => { if (!e.target.closest('button, .tag, textarea')) descBox.classList.toggle('open'); } },
      h('div.d-head', [fmtViews(v.plays), timeAgo(v.addedAt || v.mtimeMs), fmtTime(v.duration), LT.fmtBytes(v.size), v.width ? `${v.width}×${v.height}` : null, v.ext.toUpperCase()].filter(Boolean).flatMap((x, i) => [i ? ' • ' : null, h('bdi', x)])),
      h('div.d-body', descText),
      v.tags.length ? h('div.tags', v.tags.map((tg) => h('span.tag', { onclick: () => LT.router.go(`#/search?q=${encodeURIComponent(tg)}`) }, `#${tg}`))) : null,
      v.canEdit ? h('div.row', { style: { marginTop: '10px' } },
        h('button.btn.sm', { onclick: () => A().analyze(v.id) }, LT.icon('ai', 18), v.ai ? t('reanalyze') : t('analyze')),
        h('button.btn.sm', { onclick: () => A().editMeta(v.id) }, LT.icon('edit', 18), t('edit')),
        h('span.muted.xs', v.ai ? `${t('analyzed')} • ${v.ai.category || ''} • ${Math.round((v.ai.confidence || 0) * 100)}%` : ''),
      ) : null,
      !v.native ? h('div.warn-native', t('unplayable')) : null,
    );
    main.append(title, chRow, descBox);
    // الفصول
    const chapters = v.ai?.chapters || [];
    let chapterBox = null;
    if (chapters.length) {
      chapterBox = h('div.chapters', h('div.section-h', { style: { fontSize: '16px', margin: '16px 0 6px' } }, t('chapters')),
        chapters.map((c) => h('div.ch', { dataset: { t: c.t }, onclick: () => LT.player.seek(c.t) }, h('span.t', fmtTime(c.t)), h('span', c.label))));
      main.append(chapterBox);
    }
    // لوحة الذكاء الاصطناعي: اسأل عن الفيديو (في الويب تظهر فقط إن كان الذكاء متاحًا للمستخدم)
    if (LT.mode !== 'web' || st.ai.enabled) main.append(askPanel(v));
    // الملاحظات / التعليقات
    if (window.liwa.user.comments) { try { st.user.comments[id] = await window.liwa.user.comments(id); } catch { /* غير متاح */ } }
    main.append(commentsPanel(v));
    // الجانب: التالي
    const side = h('div.w-side');
    const autoplaySw = h('span.switch', { class: st.settings.autoplay ? 'on' : '', onclick: () => { st.settings.autoplay = !st.settings.autoplay; autoplaySw.classList.toggle('on', st.settings.autoplay); window.liwa.settings.set({ autoplay: st.settings.autoplay }); } });
    side.append(h('div.section-h', t('upNext'), h('span.spacer'), h('div.autoplay', t('autoplay'), autoplaySw)));
    const rel = await window.liwa.feed.related(id);
    const why = (r) => { const k = r.find((x) => ['channel', 'tags', 'title'].includes(x)); return k ? t(`why_${k}`) : null; };
    const relList = rel.map((r) => info(r.id)).filter(Boolean);
    st.upNext = relList.map((x) => x.id);
    side.append(h('div.stack', rel.map((r) => card(info(r.id), { mode: 'mini', why: why(r.reasons) })).filter(Boolean)));
    root.append(main, side);
    // تركيب المشغّل
    const tracks = await window.liwa.subtitles.list(id).catch(() => []);
    LT.player.mount(playerBox);
    const current = LT.player.current();
    if (!current || current.id !== id) {
      LT.player.load({ id: v.id, url: v.url, title: v.title }, { resumeAt: st.settings.resume ? v.resumeAt : 0, autoplay: true, chapters, tracks });
    } else LT.player.setChapters(chapters);
    root._chapterBox = chapterBox;
    return root;
  }

  function askPanel(v) {
    const st = S();
    const chat = h('div.chat');
    const hist = st.chat && st.chat.id === v.id ? st.chat.messages : [];
    for (const m of hist) chat.append(h('div.msg', { class: m.role === 'user' ? 'user' : 'ai' }, m.content));
    const input = h('input', { type: 'text', placeholder: t('askPh') });
    const sendBtn = h('button.btn.primary', { onclick: send }, LT.icon('send', 18));
    async function send() {
      const q = input.value.trim();
      if (!q) return;
      if (!st.ai.enabled || !st.ai.hasKey) { LT.toast(t('aiOff'), { err: true, action: t('settings'), onAction: () => LT.router.go('#/settings') }); return; }
      input.value = '';
      const prev = st.chat && st.chat.id === v.id ? st.chat.messages : [];
      chat.append(h('div.msg.user', q));
      const ans = h('div.msg.ai', h('span.spin'));
      chat.append(ans); chat.scrollTop = chat.scrollHeight;
      sendBtn.disabled = true;
      let text = '';
      const off = window.liwa.ai.onAskDelta(({ id, delta }) => { if (id !== v.id) return; text += delta; ans.textContent = text; chat.scrollTop = chat.scrollHeight; });
      try {
        let frames = null;
        if (!prev.length) {
          ans.textContent = LT.lang === 'ar' ? 'أقرأ الإطارات…' : 'Reading frames…';
          frames = await LT.thumbs.captureFrames(v.url, Math.min(6, st.settings.aiFrames || 6), { width: 512 }).catch(() => null);
          if (frames) st.chatFrames = { id: v.id, frames };
        } else frames = st.chatFrames && st.chatFrames.id === v.id ? st.chatFrames.frames : null;
        const subs = await A().subtitleText(v.id);
        const full = await window.liwa.ai.ask(v.id, q, prev, frames, subs);
        ans.textContent = full;
        st.chat = { id: v.id, messages: [...prev, { role: 'user', content: q }, { role: 'assistant', content: full }] };
        linkTimestamps(ans);
      } catch (err) { ans.textContent = A().aiError(err); }
      finally { off(); sendBtn.disabled = false; }
    }
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    return h('div.ai-panel', h('div.ai-head', LT.icon('ai'), t('askVideo'), h('span.spacer'), h('span.muted.xs', st.ai.enabled ? (st.ai.model || '') : t('aiOff'))),
      h('div.ai-body', chat, h('div.chat-in', input, sendBtn)));
  }
  /** يحوّل الطوابع الزمنية في النص إلى روابط تقفز للمشغّل. */
  function linkTimestamps(el) {
    const html = esc(el.textContent).replace(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/g, (m) => `<a class="ts" data-t="${m}" style="color:#3ea6ff;cursor:pointer">${m}</a>`);
    el.innerHTML = html;
    el.querySelectorAll('a.ts').forEach((a) => a.addEventListener('click', () => {
      const p = a.dataset.t.split(':').map(Number);
      const secs = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
      LT.player.seek(secs); LT.player.play();
    }));
  }
  function commentsPanel(v) {
    const st = S();
    const list = h('div');
    const render = () => {
      list.innerHTML = '';
      for (const c of (st.user.comments[v.id] || [])) {
        const who = c.name || (LT.lang === 'ar' ? 'أنا' : 'Me');
        const canDel = LT.mode !== 'web' || c.mine || (st.auth && st.auth.admin);
        list.append(h('div.comment', avatar(who, ''), h('div.grow', h('div.sm', h('b', who), h('span.muted.xs', ` • ${timeAgo(c.at)}`)), h('div.body', c.text)),
          canDel ? h('button.icon-btn.del', { onclick: async () => { st.user.comments[v.id] = await window.liwa.user.deleteComment(v.id, c.id); render(); } }, LT.icon('trash', 18)) : null));
      }
    };
    render();
    const ta = h('textarea', { placeholder: t('commentPh'), rows: 1 });
    ta.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const txt = ta.value.trim(); if (!txt) return; st.user.comments[v.id] = await window.liwa.user.comment(v.id, txt); ta.value = ''; render(); }
    });
    const me = LT.mode === 'web' ? (st.settings.nickname || (LT.lang === 'ar' ? 'مشاهد' : 'Viewer')) : (LT.lang === 'ar' ? 'أنا' : 'Me');
    const allowed = LT.mode !== 'web' || st.site == null || st.site.allowComments !== false;
    return h('div.comments', h('div.section-h', { style: { fontSize: '16px' } }, LT.mode === 'web' ? (LT.lang === 'ar' ? 'التعليقات' : 'Comments') : t('comments'), h('span.muted', `${(st.user.comments[v.id] || []).length}`)), allowed ? h('div.c-in', avatar(me), ta) : null, list);
  }

  // ---------- الذكاء الاصطناعي
  function ai() {
    const st = S();
    const videos = allInfo();
    const analyzed = videos.filter((v) => v.ai).length;
    const stats = h('div.stats-grid',
      stat(videos.length, t('videos')), stat(st.lib.channels.length, t('channels')), stat(LT.fmtHours(videos.reduce((a, v) => a + v.duration, 0)), t('hours')),
      stat(Object.values(st.user.playCount).reduce((a, b) => a + b, 0), t('views')), stat(analyzed, t('analyzed')));
    const report = h('div.md');
    const batchBtn = h('button.btn', { onclick: () => A().analyzeAll(batchBtn) }, LT.icon('ai', 18), LT.lang === 'ar' ? `تحليل غير المحلَّل (${videos.length - analyzed})` : `Analyze remaining (${videos.length - analyzed})`);
    const root = h('div',
      h('div.section-h', LT.icon('ai'), t('ai')),
      st.ai.enabled && st.ai.hasKey ? null : h('div.ai-note', LT.icon('ai'), h('span.grow', t('aiOff')), h('button.btn.sm', { onclick: () => LT.router.go('#/settings') }, t('settings'))),
      stats,
      h('div.row', { style: { flexWrap: 'wrap', marginBottom: '16px' } },
        h('button.btn.primary', { onclick: async () => { report.innerHTML = ''; report.append(h('span.spin')); try { report.innerHTML = LT.md(await window.liwa.ai.insights()); } catch (err) { report.textContent = A().aiError(err); } } }, LT.icon('insights', 18), t('insights')),
        h('button.btn', { onclick: () => A().smartPlaylist() }, LT.icon('playlists', 18), t('smartPl')),
        h('button.btn', { onclick: () => { st.homeChip = 'forYou'; st.forYou = null; LT.router.go('#/home'); } }, '✨ ', t('forYou')),
        LT.mode === 'web' && !(st.auth && st.auth.admin) ? null : batchBtn),
      h('div.set-group', h('h3', LT.lang === 'ar' ? 'ماذا يفعل الذكاء الاصطناعي هنا؟' : 'What does AI do here?'),
        h('div.shortcuts', [
          ['🎬', LT.lang === 'ar' ? 'يشاهد إطارات من الفيديو ويكتب عنوانًا ووصفًا ووسومًا وفصولًا ويختار أفضل صورة مصغّرة.' : 'Watches frames from the video and writes a title, description, tags, chapters, and picks the best thumbnail.'],
          ['🔎', LT.lang === 'ar' ? 'بحث بلغة طبيعية: «فيديوهات الطبخ اللي فيها بحر».' : 'Natural-language search: "cooking videos by the sea".'],
          ['✨', LT.lang === 'ar' ? 'صفحة «لك»: توصيات شخصية مع سبب لكل اقتراح.' : '"For you": personal picks with a reason for each.'],
          ['💬', LT.lang === 'ar' ? 'اسأل عن أي فيديو أثناء المشاهدة مع طوابع زمنية قابلة للنقر.' : 'Ask about any video while watching, with clickable timestamps.'],
          ['📋', LT.lang === 'ar' ? 'قوائم ذكية من وصف: «مقاطع قصيرة تحفيزية لصباح الأحد».' : 'Smart playlists from a prompt.'],
          ['🔒', LT.lang === 'ar' ? 'كل شيء اختياري ومحلي: تُرسل الإطارات والعناوين فقط عند طلبك، والمفتاح مشفّر على جهازك.' : 'All optional and private: frames and titles are sent only when you ask; the key is encrypted on your machine.'],
        ].map(([i, s]) => h('div', h('span', { style: { marginInlineEnd: '8px' } }, i), s)))),
      report);
    return root;
  }
  const stat = (n, label) => h('div.stat', h('b', String(n)), h('span', label));

  // ---------- الإعدادات
  function settings() {
    if (LT.mode === 'web' && LT.studio) return LT.studio.settings();
    const st = S(); const s = st.settings;
    const set = async (patch) => { Object.assign(s, patch); await window.liwa.settings.set(patch); LT.applySettings(); };
    const row = (label, small, control) => h('div.set-row', h('div.lbl', label, small ? h('small', small) : null), control);
    const select = (key, opts) => { const el = h('select', { onchange: () => set({ [key]: el.value }) }, opts.map(([v, l]) => h('option', { value: v, selected: s[key] === v }, l))); return el; };
    const sw = (key, extra) => { const el = h('span.switch', { class: s[key] ? 'on' : '', onclick: async () => { await set({ [key]: !s[key] }); el.classList.toggle('on', s[key]); extra && extra(); } }); return el; };
    const num = (key, min, max) => { const el = h('input', { type: 'number', min, max, value: s[key], onchange: () => set({ [key]: Number(el.value) }) }); return el; };
    const ar = LT.lang === 'ar';
    const keyInput = h('input', { type: 'password', placeholder: st.ai.hasKey ? '••••••••••••• (محفوظ)' : 'sk-ant-…', style: { direction: 'ltr' } });
    const keyRow = h('div.row', keyInput,
      h('button.btn.sm', { onclick: async () => { const k = keyInput.value.trim(); if (!k) return; await window.liwa.ai.setKey(k); st.ai.hasKey = true; keyInput.value = ''; keyInput.placeholder = '••••••••••••• (محفوظ)'; LT.toast(t('saved')); } }, t('save')),
      st.ai.hasKey ? h('button.btn.sm.danger', { onclick: async () => { await window.liwa.ai.clearKey(); st.ai.hasKey = false; LT.router.refresh(); } }, t('delete')) : null);
    const folders = h('div.folders', st.lib.folders.map((f) => h('div.folder', LT.icon('folder', 18), h('span', f), h('button.icon-btn', { style: { width: '28px', height: '28px' }, onclick: async () => { await A().removeFolder(f); } }, LT.icon('close', 16)))),
      h('div.row', h('button.btn.sm', { onclick: () => A().addFolder() }, LT.icon('plus', 18), t('addFolder')), h('button.btn.sm', { onclick: () => A().rescan() }, '↻ ', ar ? 'إعادة الفهرسة' : 'Rescan'), h('button.btn.sm', { onclick: () => A().regenThumbs() }, ar ? 'إعادة توليد الصور المصغّرة' : 'Regenerate thumbnails')));
    const pinRow = h('div.row',
      h('button.btn.sm', { onclick: () => A().setPin() }, st.lockEnabled ? (ar ? 'تغيير الرمز' : 'Change PIN') : (ar ? 'تفعيل القفل' : 'Enable lock')),
      st.lockEnabled ? h('button.btn.sm.danger', { onclick: () => A().clearPin() }, ar ? 'إزالة القفل' : 'Remove lock') : null);
    const kb = (k) => h('span.kbd', k);
    return h('div.settings',
      h('div.section-h', LT.icon('settings'), t('settings')),
      h('div.set-group', h('h3', LT.icon('folder', 18), ar ? 'المكتبة' : 'Library'),
        row(ar ? 'مجلدات الفيديو' : 'Video folders', ar ? 'تُفهرس تلقائيًا وتُراقب التغييرات' : 'Indexed automatically and watched for changes', null), h('div.set-row', folders),
        row(ar ? 'اسم القناة من' : 'Channel name from', ar ? 'المجلد الأب المباشر أو المجلد الجذر المضاف' : 'Immediate parent folder or the added root folder', select('channelMode', [['parent', ar ? 'المجلد الأب' : 'Parent folder'], ['root', ar ? 'المجلد الجذر' : 'Root folder']])),
        row(ar ? 'مراقبة المجلدات' : 'Watch folders', ar ? 'إعادة الفهرسة عند إضافة ملفات جديدة' : 'Re-index when new files appear', sw('watchFolders')),
        row(ar ? 'حد Shorts (ثوانٍ)' : 'Shorts limit (seconds)', ar ? 'الفيديوهات الأقصر تظهر في Shorts' : 'Shorter videos appear in Shorts', num('shortsMax', 15, 600))),
      h('div.set-group', h('h3', LT.icon('play', 18), ar ? 'التشغيل' : 'Playback'),
        row(t('autoplay'), ar ? 'تشغيل الفيديو التالي تلقائيًا' : 'Play the next video automatically', sw('autoplay')),
        row(ar ? 'استئناف المشاهدة' : 'Resume playback', ar ? 'العودة إلى آخر موضع توقفت عنده' : 'Continue from where you left off', sw('resume')),
        row(ar ? 'معاينة عند التمرير' : 'Hover preview', ar ? 'تشغيل صامت عند الوقوف على البطاقة' : 'Muted preview when hovering a card', sw('hoverPreview')),
        row(t('captions'), ar ? 'إظهار ملفات SRT/VTT المجاورة تلقائيًا' : 'Show sidecar SRT/VTT automatically', sw('captions'))),
      h('div.set-group', h('h3', LT.icon('ai', 18), t('ai')),
        row(ar ? 'تفعيل الذكاء الاصطناعي' : 'Enable AI', ar ? 'مغلق افتراضيًا — يتطلب مفتاح Anthropic API مدفوعًا' : 'Off by default — requires a paid Anthropic API key', sw('aiEnabled', () => { st.ai.enabled = s.aiEnabled; })),
        row('Anthropic API key', ar ? 'يُخزَّن مشفّرًا على جهازك ولا يغادر العملية الرئيسية' : 'Stored encrypted on your machine, never leaves the main process', keyRow),
        row(ar ? 'النموذج' : 'Model', null, select('aiModel', st.ai.models.map((m) => [m.id, m.label]))),
        row(ar ? 'عدد الإطارات للتحليل' : 'Frames per analysis', ar ? 'أكثر = فهم أدق وتكلفة أعلى' : 'More = better understanding, higher cost', num('aiFrames', 3, 16)),
        row(ar ? 'تحليل الفيديوهات الجديدة تلقائيًا' : 'Auto-analyze new videos', ar ? 'يستهلك رصيد API مع كل فيديو جديد' : 'Spends API credit on every new video', sw('aiAutoAnalyze'))),
      h('div.set-group', h('h3', '🔒 ', ar ? 'الخصوصية' : 'Privacy'),
        row(ar ? 'قفل التطبيق برمز PIN' : 'Lock the app with a PIN', ar ? 'يُطلب الرمز عند فتح التطبيق' : 'Asked on launch', pinRow),
        row(ar ? 'قفل عند الخمول (دقائق)' : 'Lock when idle (minutes)', ar ? '0 = لا يقفل' : '0 = never', num('lockIdleMinutes', 0, 240))),
      h('div.set-group', h('h3', '🎨 ', ar ? 'المظهر' : 'Appearance'),
        row(ar ? 'اللغة' : 'Language', null, select('lang', [['ar', 'العربية'], ['en', 'English']])),
        row(ar ? 'السمة' : 'Theme', null, select('theme', [['dark', ar ? 'داكن' : 'Dark'], ['light', ar ? 'فاتح' : 'Light']])),
        row(ar ? 'اللون' : 'Accent', null, select('accent', [['red', ar ? 'أحمر' : 'Red'], ['violet', ar ? 'بنفسجي' : 'Violet'], ['sky', ar ? 'سماوي' : 'Sky'], ['emerald', ar ? 'زمردي' : 'Emerald'], ['amber', ar ? 'كهرماني' : 'Amber']]))),
      h('div.set-group', h('h3', '⌨️ ', ar ? 'اختصارات لوحة المفاتيح' : 'Keyboard shortcuts'),
        h('div.shortcuts', [[kb('Space'), '/', kb('K'), ar ? ' تشغيل/إيقاف' : ' Play/Pause'], [kb('J'), '/', kb('L'), ' ±10s'], [kb('←'), '/', kb('→'), ' ±5s'], [kb('↑'), '/', kb('↓'), ar ? ' الصوت' : ' Volume'],
          [kb('M'), ar ? ' كتم' : ' Mute'], [kb('F'), ar ? ' ملء الشاشة' : ' Fullscreen'], [kb('T'), ar ? ' المسرح' : ' Theater'], [kb('I'), ' PiP'], [kb('C'), ar ? ' الترجمة' : ' Captions'],
          [kb('0'), '–', kb('9'), ar ? ' قفز بالنسبة' : ' Jump %'], [kb('Shift+N'), ar ? ' التالي' : ' Next'], [kb('<'), '/', kb('>'), ar ? ' السرعة' : ' Speed'], [kb(','), '/', kb('.'), ar ? ' إطار (متوقف)' : ' Frame step (paused)'], [kb('/'), ar ? ' البحث' : ' Search']].map((x) => h('div', x)))),
      h('div.nav-foot', `LiwaTube ${st.info?.version || ''} • ${st.info?.creator || ''}`));
  }

  // ---------- مشاركة (خادم مضمَّن)
  async function share() {
    const ar = LT.lang === 'ar';
    const T = (a, e) => (ar ? a : e);
    let st = await window.liwa.share.status();
    const root = h('div.settings');
    const box = h('div');
    const copy = async (txt) => { try { await navigator.clipboard.writeText(txt); LT.toast(t('copied')); } catch { /* */ } };
    const qrBox = async (url) => { const img = h('img', { src: await window.liwa.share.qr(url), width: 200, height: 200, style: { borderRadius: '10px', background: '#fff', padding: '6px' } }); return img; };
    async function render() {
      box.innerHTML = '';
      const running = st.running;
      const toggle = h('button.btn', { class: running ? 'on' : 'accent', onclick: async () => { toggle.disabled = true; try { st = running ? await window.liwa.share.stop() : await window.liwa.share.start(); } catch (e) { LT.toast(e.message, { err: true }); } st = await window.liwa.share.status(); render(); } }, LT.icon('share'), running ? T('إيقاف المشاركة', 'Stop sharing') : T('تشغيل المشاركة', 'Start sharing'));
      box.append(
        h('div.ai-note', LT.icon('share'), h('span', T('عند تشغيل المشاركة يصبح هذا الكمبيوتر «خادم LiwaTube»: كل مقاطع مكتبتك تظهر فورًا لمن يفتح الرابط من الهاتف أو التلفاز أو المتصفح، بلا رفع وبلا حسابات. الكمبيوتر يجب أن يبقى مفتوحًا أثناء المشاهدة.', 'When sharing is on, this computer becomes your LiwaTube server: everyone who opens the link on a phone, TV or browser sees your library instantly. Keep the computer on while they watch.'))),
        h('div.set-group', h('h3', LT.icon('wifi', 18), T('داخل البيت (نفس الواي‑فاي)', 'At home (same Wi‑Fi)')),
          h('div.set-row', h('div.lbl', T('الحالة', 'Status'), h('small', running ? T(`يعمل على المنفذ ${st.port}`, `Running on port ${st.port}`) : T('متوقف', 'Stopped'))), toggle),
        ),
      );
      if (running) {
        const lanUrl = st.lan[0] || `http://localhost:${st.port}`;
        const g = box.lastChild;
        g.append(h('div.set-row', h('div.lbl', T('الرابط', 'Link'), h('small', T('اكتبه في تطبيق الهاتف أو افتحه في أي متصفح على نفس الشبكة', 'Type it in the phone app or open it in any browser on the same network'))),
          h('div.row', { style: { flexWrap: 'wrap' } }, st.lan.map((u) => h('code', { style: { direction: 'ltr', background: 'var(--bg2)', padding: '6px 10px', borderRadius: '8px', fontSize: '15px' } }, u)), h('button.btn.sm', { onclick: () => copy(lanUrl) }, t('copyLink')))));
        g.append(h('div.set-row', h('div.lbl', T('امسح بكاميرا الهاتف', 'Scan with the phone camera'), h('small', T('يفتح الرابط في المتصفح، ومن هناك زر «فتح في تطبيق LiwaTube»', 'Opens in the browser, with an "Open in LiwaTube app" button'))), await qrBox(lanUrl)));
        g.append(h('div.set-row', h('div.lbl', T('كلمة مرور المشرف (لك فقط)', 'Admin password (you only)'), h('small', T('تحتاجها فقط إن أردت لوحة التحكم من الهاتف أو المتصفح؛ المشاهدون لا يحتاجون شيئًا', 'Only needed for the Studio from a phone or browser; viewers need nothing'))),
          h('div.row', h('code', { style: { direction: 'ltr', background: 'var(--bg2)', padding: '6px 10px', borderRadius: '8px', fontSize: '15px' } }, st.password), h('button.btn.sm', { onclick: () => {
            const inp = h('input', { type: 'text', value: st.password });
            LT.modal({ title: T('تغيير كلمة المرور', 'Change password'), body: (b) => b.append(h('div.field', inp)), actions: [{ label: t('cancel') }, { label: t('save'), cls: 'primary', onClick: async () => { try { await window.liwa.share.setPassword(inp.value); st = await window.liwa.share.status(); render(); } catch { LT.toast(T('4 أحرف على الأقل', 'At least 4 characters'), { err: true }); return false; } } }] });
          } }, t('edit')))));
        // الإنترنت
        const tn = st.tunnel || {};
        const tBtn = h('button.btn', { class: tn.running ? 'on' : 'accent', disabled: tn.starting, onclick: async () => { tBtn.disabled = true; try { st = tn.running ? await window.liwa.share.tunnelStop() : await window.liwa.share.tunnelStart(); } catch (e) { LT.toast(`${T('تعذّر فتح النفق', 'Tunnel failed')}: ${e.message}`, { err: true }); } st = await window.liwa.share.status(); render(); } }, LT.icon('globe'), tn.running ? T('إيقاف مشاركة الإنترنت', 'Stop internet sharing') : tn.starting ? T('جارٍ الفتح…', 'Opening…') : T('مشاركة على الإنترنت', 'Share on the internet'));
        const ig = h('div.set-group', h('h3', LT.icon('globe', 18), T('من أي مكان (الإنترنت)', 'From anywhere (internet)')),
          h('div.set-row', h('div.lbl', T('نفق مجاني بلا حساب', 'Free tunnel, no account'), h('small', tn.progress != null ? T(`جارٍ تنزيل الأداة ${Math.round(tn.progress * 100)}%…`, `Downloading tool ${Math.round(tn.progress * 100)}%…`) : T('يعطيك رابط https يعمل من أي شبكة ما دام هذا الكمبيوتر مفتوحًا. الرابط يتغيّر عند كل تشغيل، فأرسله من جديد.', 'Gives an https link that works from any network while this computer is on. The link changes on each start.'))), tBtn));
        if (tn.running && tn.url) {
          ig.append(h('div.set-row', h('div.lbl', T('رابط الإنترنت', 'Internet link')), h('div.row', h('code', { style: { direction: 'ltr', background: 'var(--bg2)', padding: '6px 10px', borderRadius: '8px', fontSize: '14px' } }, tn.url), h('button.btn.sm', { onclick: () => copy(tn.url) }, t('copyLink')))));
          ig.append(h('div.set-row', h('div.lbl', 'QR'), await qrBox(tn.url)));
        }
        if (tn.error && !tn.running) ig.append(h('div.set-row', h('div.lbl', { style: { color: '#ff6b6b' } }, `${T('خطأ', 'Error')}: ${tn.error}`)));
        box.append(ig);
      }
      const s = S().settings;
      const sw = (key) => { const el = h('span.switch', { class: s[key] ? 'on' : '', onclick: async () => { s[key] = !s[key]; await window.liwa.settings.set({ [key]: s[key] }); el.classList.toggle('on', s[key]); } }); return el; };
      box.append(h('div.set-group', h('h3', LT.icon('settings', 18), t('settings')),
        h('div.set-row', h('div.lbl', T('تشغيل المشاركة تلقائيًا عند فتح التطبيق', 'Start sharing when the app opens')), sw('shareAutoStart')),
        h('div.set-row', h('div.lbl', T('فتح مشاركة الإنترنت تلقائيًا معها', 'Also open internet sharing automatically')), sw('shareTunnelAuto')),
        h('div.set-row', h('div.lbl', T('تطبيق الهاتف والتلفاز', 'Phone & TV app'), h('small', T('ثبّته على الهاتف أو تلفاز أندرويد ثم امسح الرمز أو اكتب الرابط', 'Install on a phone or Android TV, then scan the code or type the link'))),
          h('button.btn.sm', { onclick: () => window.liwa.app.openExternal('https://github.com/almarar88/liwamusic/releases/latest/download/LiwaTube.apk') }, '⬇ LiwaTube.apk'))));
    }
    await render();
    if (!LT._shareBound) { LT._shareBound = true; window.liwa.share.onState((s2) => { if (S().route.view === 'share') { window.liwa.share.status().then((x) => { st = x; render(); }); } }); }
    root.append(h('div.section-h', LT.icon('share'), t('shareNav')), box);
    return root;
  }

  LT.views = { share, info, allInfo, card, avatar, home, shorts, channels, subs, channel, all, search, history, later, liked, playlists, playlist, watch, ai, settings, channelName };
})(window.LT);
