/* LiwaTube Web — جسر window.liwa عبر HTTP: نفس واجهة Electron لكن مع خادم LiwaTube.
   بيانات المشاهد (السجل، الإعجابات، شاهد لاحقًا، القوائم) تبقى على جهازه (localStorage)،
   والمقاطع والعدّادات والتعليقات على الخادم. */
'use strict';
(function (LT) {
  const STANDALONE = Boolean(window.LT_STANDALONE);
  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ممتلئ */ } },
  };
  let API = STANDALONE ? (store.get('lt.server', '') || '') : '';
  API = API.replace(/\/+$/, '');
  let token = store.get('lt.token', '');
  const device = store.get('lt.device', '') || (() => { const d = Array.from(crypto.getRandomValues(new Uint8Array(12))).map((b) => b.toString(16).padStart(2, '0')).join(''); store.set('lt.device', d); return d; })();
  let SITE = null;
  let LIB = { folders: [], videos: {}, channels: [] };
  const listeners = { askDelta: [], updated: [], progress: [] };

  LT.mode = 'web';
  LT.urls = {
    video: (v) => `${API}/api/video/${v.id}`,
    thumb: (v) => `${API}/api/thumb/${v.thumb || `${v.id}.jpg`}`,
  };
  LT.api = { base: () => API, device };

  const headers = (extra = {}) => ({ 'X-Device': device, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra });
  async function req(method, url, body, { raw = false, extra = {} } = {}) {
    const opts = { method, headers: headers(extra) };
    if (body !== undefined) {
      if (raw) { opts.body = body; }
      else { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
    }
    let res;
    try { res = await fetch(`${API}${url}`, opts); } catch { const e = new Error('NETWORK'); e.code = 'NETWORK'; throw e; }
    let data = null;
    try { data = await res.json(); } catch { /* ليس JSON */ }
    if (!data || !data.ok) { const e = new Error((data && data.error) || `HTTP_${res.status}`); e.code = (data && data.code) || e.message; e.status = res.status; throw e; }
    return data.data;
  }

  // ---------- الافتراضيات المحلية
  const SETTINGS = {
    lang: 'ar', theme: 'dark', accent: 'red', autoplay: true, rate: 1, volume: 1, muted: false, hoverPreview: !('ontouchstart' in window), captions: true, resume: true,
    shortsMax: 60, aiFrames: 6, aiAutoAnalyze: false, sidebarCollapsed: false, lastView: 'home', nickname: '', tvMode: 'auto', channelMode: 'parent', watchFolders: false, lockIdleMinutes: 0,
  };
  const USER = { likes: {}, likedAt: {}, watchLater: [], progress: {}, playCount: {}, lastPlayed: {}, history: [], subscriptions: {}, hidden: {}, ai: {}, overrides: {}, thumbAt: {}, comments: {}, notInterested: {} };
  const settings = Object.assign({}, SETTINGS, store.get('lt.settings', {}));
  const user = Object.assign({}, USER, store.get('lt.user', {}));
  const playlists = store.get('lt.playlists', []);
  const saveSettings = () => store.set('lt.settings', settings);
  const saveUser = () => store.set('lt.user', user);
  const savePl = () => store.set('lt.playlists', playlists);
  const isAdmin = () => Boolean(LT.state && LT.state.auth && LT.state.auth.admin);

  /** يهيّئ سجل الفيديو القادم من الخادم ليطابق ما تتوقعه الواجهة. */
  function normalize(v) {
    v.probed = Boolean(v.probed || v.duration);
    v.native = true;
    v.mtimeMs = v.addedAt;
    v.file = v.originalName || `${v.title}.${v.ext}`;
    if (v.ai) user.ai[v.id] = v.ai; // تحليل الخادم يظهر للجميع
    return v;
  }
  async function loadLibrary() {
    const lib = await req('GET', `/api/library${isAdmin() ? '?all=1' : ''}`);
    for (const v of Object.values(lib.videos)) normalize(v);
    LIB = lib;
    return LIB;
  }

  const R = () => window.LTRecommend;
  const noop = async () => null;

  // ---------- شاشة الاتصال (التطبيق المستقل)
  async function connectScreen() {
    const box = document.getElementById('connect');
    const inp = document.getElementById('connectUrl'); const btn = document.getElementById('connectBtn'); const errEl = document.getElementById('connectErr');
    box.hidden = false; inp.value = API || '';
    return new Promise((resolve) => {
      const go = async () => {
        let url = inp.value.trim().replace(/\/+$/, '');
        if (url && !/^https?:\/\//i.test(url)) url = `http://${url}`;
        if (!url) return;
        errEl.textContent = '…';
        try {
          const r = await fetch(`${url}/api/site`, { headers: { 'X-Device': device } });
          const d = await r.json();
          if (!d || !d.ok) throw new Error('bad');
          API = url; store.set('lt.server', url); box.hidden = true; resolve(true);
        } catch { errEl.textContent = 'تعذّر الوصول إلى الخادم — تأكد من العنوان والشبكة'; }
      };
      btn.onclick = go; inp.onkeydown = (e) => { if (e.key === 'Enter') go(); };
      setTimeout(() => inp.focus(), 50);
    });
  }
  LT.beforeBoot = async () => {
    if (STANDALONE && !API) await connectScreen();
    try { SITE = await req('GET', '/api/site'); }
    catch { if (STANDALONE) { API = ''; store.set('lt.server', ''); await connectScreen(); SITE = await req('GET', '/api/site'); } else { document.body.innerHTML = '<div class="empty"><h2>تعذّر الوصول إلى خادم LiwaTube</h2></div>'; return false; } }
    document.title = SITE.name || 'LiwaTube';
    return true;
  };
  LT.changeServer = async () => { API = ''; store.set('lt.server', ''); location.reload(); };

  // ---------- window.liwa
  window.liwa = {
    app: {
      info: async () => ({ name: SITE ? SITE.name : 'LiwaTube', version: SITE ? SITE.version : '', creator: SITE ? SITE.creator : '', platform: 'web', server: API || location.origin }),
      openExternal: async (url) => { window.open(url, '_blank', 'noopener'); },
      reveal: async (id) => {
        const link = `${API || location.origin}${location.pathname.replace(/[^/]*$/, '')}#/watch/${id}`.replace(/\/\/#/, '/#');
        try { await navigator.clipboard.writeText(link); LT.toast(LT.t('copied')); } catch { LT.modal({ title: LT.t('copyLink'), body: (b) => b.append(LT.h('input', { type: 'text', value: link, readonly: true })), actions: [{ label: LT.t('cancel') }] }); }
      },
      onOpen: () => () => {},
      pathOf: () => null,
    },
    window: {
      minimize: noop, maximize: noop, close: noop, onState: () => () => {},
      fullscreen: async () => {},
    },
    settings: {
      get: async () => ({ ...settings, aiEnabled: Boolean(SITE && SITE.aiEnabled && (isAdmin() || SITE.aiPublic)), aiModel: SITE ? SITE.aiModel : '', aiKeySet: Boolean(SITE && SITE.aiEnabled), lockEnabled: false }),
      set: async (patch) => { Object.assign(settings, patch || {}); delete settings.aiEnabled; saveSettings(); return settings; },
    },
    library: {
      get: loadLibrary,
      addFolder: async () => LIB, addPaths: async () => LIB, removeFolder: async () => LIB, scan: noop,
      pending: async () => (isAdmin() ? Object.values(LIB.videos).filter((v) => !v.probed || !v.thumb).map((v) => ({ id: v.id, url: LT.urls.video(v) })) : []),
      probe: async (id, info) => {
        if (!isAdmin() || !LIB.videos[id]) return null;
        const v = await req('PATCH', `/api/admin/video/${id}`, { duration: info.duration || 0, width: info.width || 0, height: info.height || 0, probed: true });
        LIB.videos[id] = normalize(v);
        return LIB.videos[id];
      },
      saveThumb: async (id, buf, at) => {
        const thumb = await req('POST', `/api/admin/thumb/${id}?at=${encodeURIComponent(at || 0)}`, buf, { raw: true, extra: { 'Content-Type': 'image/jpeg' } });
        if (LIB.videos[id]) LIB.videos[id].thumb = thumb;
        return thumb;
      },
      resetThumbs: async () => { for (const v of Object.values(LIB.videos)) { v.thumb = null; v.probed = false; } return LIB; },
      onProgress: (fn) => { listeners.progress.push(fn); return () => {}; },
      onUpdated: (fn) => { listeners.updated.push(fn); return () => {}; },
    },
    user: {
      get: async () => user,
      like: async (id, val) => {
        const n = Number(val) || 0;
        if (!n) { delete user.likes[id]; delete user.likedAt[id]; } else { user.likes[id] = n > 0 ? 1 : -1; user.likedAt[id] = Date.now(); }
        saveUser();
        req('POST', `/api/like/${id}`, { val: n }).then((r) => { if (LIB.videos[id]) Object.assign(LIB.videos[id], { likes: r.likes, dislikes: r.dislikes }); }).catch(() => {});
        return user.likes[id] || 0;
      },
      watchLater: async (id, on) => { user.watchLater = user.watchLater.filter((x) => x !== id); if (on) user.watchLater.unshift(id); saveUser(); return user.watchLater; },
      progress: async (id, pos, dur) => { user.progress[id] = { pos, dur, at: Date.now() }; saveUser(); },
      played: async (id) => {
        user.playCount[id] = (user.playCount[id] || 0) + 1;
        user.history = [{ id, at: Date.now() }, ...user.history.filter((h) => h.id !== id)].slice(0, 1000);
        user.lastPlayed[id] = Date.now(); saveUser();
        req('POST', `/api/view/${id}`).then((r) => { if (LIB.videos[id]) LIB.videos[id].views = r.views; }).catch(() => {});
        return user.playCount[id];
      },
      markWatched: async (id, on) => { const v = LIB.videos[id]; if (on) { user.progress[id] = { pos: v?.duration || 1, dur: v?.duration || 1, at: Date.now() }; if (!user.playCount[id]) user.playCount[id] = 1; } else delete user.progress[id]; saveUser(); },
      override: async (id, patch) => {
        if (isAdmin()) { const v = await req('PATCH', `/api/admin/video/${id}`, patch); LIB.videos[id] = normalize(v); delete user.overrides[id]; return {}; }
        user.overrides[id] = { ...(user.overrides[id] || {}), ...patch, at: Date.now() }; saveUser(); return user.overrides[id];
      },
      subscribe: async (cid, on) => { if (on) user.subscriptions[cid] = { at: Date.now() }; else delete user.subscriptions[cid]; saveUser(); return Boolean(user.subscriptions[cid]); },
      hide: async (id, on) => { if (on) user.hidden[id] = true; else delete user.hidden[id]; saveUser(); },
      notInterested: async (cid, on) => { if (on) user.notInterested[cid] = true; else delete user.notInterested[cid]; saveUser(); },
      clearHistory: async () => { user.history = []; saveUser(); },
      removeHistory: async (id) => { user.history = user.history.filter((h) => h.id !== id); saveUser(); },
      comments: async (id) => req('GET', `/api/comments/${id}`),
      comment: async (id, text) => req('POST', `/api/comments/${id}`, { name: settings.nickname || (isAdmin() ? 'المشرف' : 'مشاهد'), text }),
      deleteComment: async (id, cid) => req('DELETE', `/api/comments/${id}/${cid}`),
    },
    playlists: {
      list: async () => playlists,
      create: async (data) => { const now = Date.now(); const p = { id: `pl_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: String(data.name || 'قائمة جديدة').slice(0, 80), description: String(data.description || '').slice(0, 400), videos: [...new Set(data.videos || [])], ai: data.ai || null, createdAt: now, updatedAt: now }; playlists.unshift(p); savePl(); return p; },
      update: async (id, patch) => { const p = playlists.find((x) => x.id === id); if (!p) throw new Error('NOT_FOUND'); if (patch.name != null) p.name = String(patch.name).slice(0, 80); if (patch.description != null) p.description = String(patch.description).slice(0, 400); if (Array.isArray(patch.videos)) p.videos = [...new Set(patch.videos)]; p.updatedAt = Date.now(); savePl(); return p; },
      remove: async (id) => { const i = playlists.findIndex((x) => x.id === id); if (i >= 0) playlists.splice(i, 1); savePl(); },
      add: async (id, ids) => { const p = playlists.find((x) => x.id === id); if (!p) throw new Error('NOT_FOUND'); for (const v of ids) if (!p.videos.includes(v)) p.videos.push(v); p.updatedAt = Date.now(); savePl(); return p; },
      removeVideo: async (id, vid) => { const p = playlists.find((x) => x.id === id); if (!p) throw new Error('NOT_FOUND'); p.videos = p.videos.filter((x) => x !== vid); savePl(); return p; },
    },
    feed: {
      home: async (opts) => R().homeFeed(LIB.videos, user, opts || {}),
      related: async (id) => R().related(LIB.videos[id], LIB.videos, user),
      search: async (q) => R().search(q, LIB.videos, user),
    },
    subtitles: { list: async (id) => ((LIB.videos[id] && LIB.videos[id].subs) || []).map((s) => ({ ...s, url: `${API}/api/sub/${id}/${s.i}` })) },
    ai: {
      status: async () => ({ enabled: Boolean(SITE && SITE.aiEnabled && (isAdmin() || SITE.aiPublic)), hasKey: Boolean(SITE && SITE.aiEnabled), model: SITE ? SITE.aiModel : '', models: [] }),
      setKey: noop, clearKey: noop,
      analyze: async (id, frames, subs) => { const r = await req('POST', `/api/ai/analyze/${id}`, { frames, subtitles: subs, lang: settings.lang }); user.ai[id] = r; if (LIB.videos[id]) LIB.videos[id].ai = r; return r; },
      clearAnalysis: async (id) => { await req('POST', `/api/ai/clearAnalysis/${id}`); delete user.ai[id]; },
      search: async (query) => req('POST', '/api/ai/search', { query, userdata: slimUser(), prefilter: R().search(query, LIB.videos, user, { limit: 60 }).map((r) => r.id) }),
      forYou: async () => req('POST', '/api/ai/forYou', { userdata: slimUser(), candidates: R().homeFeed(LIB.videos, user, { limit: 150, seed: Date.now() }).map((x) => x.id) }),
      smartPlaylist: async (prompt) => { const r = await req('POST', '/api/ai/smartPlaylist', { prompt, userdata: slimUser() }); return window.liwa.playlists.create({ name: r.name, description: r.description, videos: r.picks.map((p) => p.id), ai: { prompt, picks: r.picks, at: Date.now() } }); },
      ask: async (id, question, history, frames, subs) => {
        const res = await fetch(`${API}/api/ai/ask/${id}`, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ question, history, frames, subtitles: subs, lang: settings.lang }) });
        if (!res.ok) { let d = null; try { d = await res.json(); } catch { /* */ } const e = new Error((d && d.error) || `HTTP_${res.status}`); e.code = d && d.code; throw e; }
        const reader = res.body.getReader(); const dec = new TextDecoder(); let text = '';
        for (;;) { const { value, done } = await reader.read(); if (done) break; const delta = dec.decode(value, { stream: true }); text += delta; for (const fn of listeners.askDelta) fn({ id, delta }); }
        return text;
      },
      onAskDelta: (fn) => { listeners.askDelta.push(fn); return () => { const i = listeners.askDelta.indexOf(fn); if (i >= 0) listeners.askDelta.splice(i, 1); }; },
      insights: async () => req('POST', '/api/ai/insights', { userdata: slimUser(), lang: settings.lang }),
    },
    lock: { status: async () => ({ enabled: false }), setPin: noop, clearPin: noop, verify: async () => true },
    auth: {
      status: async () => {
        let admin = false;
        if (token) { try { const me = await req('GET', '/api/me'); admin = me.admin; SITE = me.site; if (!admin) { token = ''; store.set('lt.token', ''); } } catch (e) { if (e.status === 401) { token = ''; store.set('lt.token', ''); } } }
        return { admin, site: SITE };
      },
      login: async (password) => { const r = await req('POST', '/api/login', { password }); token = r.token; store.set('lt.token', token); return true; },
      setup: async (password) => { const r = await req('POST', '/api/setup', { password }); token = r.token; store.set('lt.token', token); SITE = await req('GET', '/api/site'); return true; },
      logout: async () => { token = ''; store.set('lt.token', ''); },
    },
    studio: {
      list: async () => { const lib = await req('GET', '/api/admin/videos'); for (const v of Object.values(lib.videos)) normalize(v); LIB = lib; return lib; },
      stats: async () => req('GET', '/api/admin/stats'),
      update: async (id, patch) => { const v = await req('PATCH', `/api/admin/video/${id}`, patch); LIB.videos[id] = normalize(v); return v; },
      remove: async (id) => { await req('DELETE', `/api/admin/video/${id}`); delete LIB.videos[id]; LIB.channels = R() ? LIB.channels.filter(() => true) : LIB.channels; },
      settings: async (patch) => req(patch ? 'POST' : 'GET', '/api/admin/settings', patch),
      uploadSub: async (id, file, lang) => { const v = await req('POST', `/api/admin/sub/${id}?lang=${encodeURIComponent(lang || 'ar')}`, file, { raw: true, extra: { 'Content-Type': 'text/plain' } }); LIB.videos[id] = normalize(v); return v; },
      /** رفع ملف مع تقدّم عبر XHR. */
      upload: (file, { channel = '', title = '' } = {}, onProgress) => new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const q = new URLSearchParams({ name: file.name, channel, title });
        xhr.open('POST', `${API}/api/admin/upload?${q}`);
        for (const [k, v] of Object.entries(headers({ 'Content-Type': 'application/octet-stream' }))) xhr.setRequestHeader(k, v);
        xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
        xhr.onload = () => { try { const d = JSON.parse(xhr.responseText); if (d.ok) { LIB.videos[d.data.id] = normalize(d.data); resolve(d.data); } else reject(new Error(d.error || 'UPLOAD_FAILED')); } catch { reject(new Error('UPLOAD_FAILED')); } };
        xhr.onerror = () => reject(new Error('NETWORK'));
        xhr.send(file);
      }),
      refresh: loadLibrary,
    },
  };
  function slimUser() { return { history: user.history.slice(0, 60), likes: user.likes, subscriptions: user.subscriptions, playCount: user.playCount, notInterested: user.notInterested, progress: user.progress }; }
})(window.LT = window.LT || {});
