/* LiwaTube Web — لوحة التحكم (Studio): رفع المقاطع، إدارتها، الإعدادات، ودخول المشرف. */
'use strict';
(function (LT) {
  const { $, h, fmtTime, fmtBytes, timeAgo, toast, modal } = LT;
  const S = () => LT.state;
  const D = {
    ar: {
      studio: 'لوحة التحكم', dash: 'نظرة عامة', upload: 'رفع', videos: 'المقاطع', settings: 'الإعدادات', login: 'دخول المشرف', setup: 'إنشاء كلمة مرور المشرف', password: 'كلمة المرور', enter: 'دخول', logout: 'تسجيل الخروج',
      dropHint: 'اسحب المقاطع هنا أو اضغط للاختيار', dropSub: 'MP4 / WebM / MKV / MOV — بأي حجم، تُرفع مباشرة إلى خادمك', channel: 'القناة', newChannel: 'قناة جديدة…', titleOpt: 'العنوان (اختياري، يُشتق من اسم الملف)',
      uploading: 'جارٍ الرفع', processing: 'توليد الصورة المصغّرة…', done: 'تم', failed: 'فشل', queued: 'بالانتظار',
      expired: 'انتهت جلسة المشرف — سجّل الدخول ثم أعد الرفع', envPw: 'كلمة المرور مضبوطة من متغيّر LIWATUBE_ADMIN_PASSWORD في إعدادات الاستضافة — غيّرها من هناك',
      netErr: 'انقطع الاتصال بالخادم', tooBig: 'الملف كبير جدًا على الخادم', badType: 'صيغة غير مدعومة',
      views: 'المشاهدات', likes: 'الإعجابات', comments: 'التعليقات', size: 'الحجم', hours: 'ساعات', analyzed: 'محلَّل بالذكاء',
      title: 'العنوان', duration: 'المدة', added: 'أُضيف', visible: 'ظاهر', hidden: 'مخفي', edit: 'تعديل', del: 'حذف', sub: 'ترجمة', ai: 'تحليل', thumb: 'صورة مصغّرة',
      confirmDel: 'حذف المقطع نهائيًا من الخادم؟', siteName: 'اسم الموقع', welcome: 'رسالة ترحيب (تظهر في الرئيسية)', allowComments: 'السماح بالتعليقات للزوار',
      aiEnabled: 'تفعيل الذكاء الاصطناعي', aiPublic: 'السماح للزوار باستخدام البحث الذكي والمحادثة (يستهلك رصيدك)', aiKey: 'مفتاح Anthropic API', aiModel: 'النموذج', saveKey: 'حفظ المفتاح', keySet: 'محفوظ', keyNone: 'غير مضبوط',
      changePw: 'تغيير كلمة المرور', currentPw: 'الحالية', newPw: 'الجديدة', save: 'حفظ', saved: 'تم الحفظ', wrongPw: 'كلمة المرور غير صحيحة', weakPw: 'كلمة المرور قصيرة (4 أحرف على الأقل)',
      viewer: 'إعدادات المشاهدة', nickname: 'اسمك في التعليقات', tvMode: 'وضع التلفاز (خطوط أكبر وتنقّل بالريموت)', auto: 'تلقائي', on: 'مفعّل', off: 'معطّل', server: 'عنوان الخادم', change: 'تغيير', lang: 'اللغة', theme: 'السمة', dark: 'داكن', light: 'فاتح', accent: 'اللون', autoplay: 'تشغيل تلقائي', hover: 'معاينة عند التمرير', captions: 'الترجمة تلقائيًا',
      noVideos: 'لا مقاطع بعد — ارفع أول مقطع', serverInfo: 'الخادم', storage: 'التخزين',
      storR2: 'دائم على Cloudflare R2 — المقاطع محفوظة خارج الخادم ولا تُحذف عند إعادة النشر',
      storLocal: 'قرص الخادم — إن كانت الاستضافة بلا قرص دائم فستُمسح المقاطع عند كل إعادة تشغيل', tabHint: 'كل ما ترفعه هنا يظهر فورًا لكل من يفتح الموقع أو التطبيق.', gen: 'إعادة توليد الصور المصغّرة الناقصة',
    },
    en: {
      studio: 'Studio', dash: 'Overview', upload: 'Upload', videos: 'Videos', settings: 'Settings', login: 'Admin login', setup: 'Create admin password', password: 'Password', enter: 'Sign in', logout: 'Sign out',
      dropHint: 'Drop videos here or click to choose', dropSub: 'MP4 / WebM / MKV / MOV — any size, uploaded straight to your server', channel: 'Channel', newChannel: 'New channel…', titleOpt: 'Title (optional, derived from file name)',
      uploading: 'Uploading', processing: 'Generating thumbnail…', done: 'Done', failed: 'Failed', queued: 'Queued',
      expired: 'Admin session expired — sign in and upload again', envPw: 'The password comes from LIWATUBE_ADMIN_PASSWORD in your hosting settings — change it there',
      netErr: 'Lost connection to the server', tooBig: 'File too large for the server', badType: 'Unsupported format',
      views: 'Views', likes: 'Likes', comments: 'Comments', size: 'Size', hours: 'hours', analyzed: 'AI analyzed',
      title: 'Title', duration: 'Duration', added: 'Added', visible: 'Visible', hidden: 'Hidden', edit: 'Edit', del: 'Delete', sub: 'Subtitle', ai: 'Analyze', thumb: 'Thumbnail',
      confirmDel: 'Permanently delete this video from the server?', siteName: 'Site name', welcome: 'Welcome message (shown on Home)', allowComments: 'Allow viewer comments',
      aiEnabled: 'Enable AI', aiPublic: 'Let viewers use smart search & chat (spends your credit)', aiKey: 'Anthropic API key', aiModel: 'Model', saveKey: 'Save key', keySet: 'Set', keyNone: 'Not set',
      changePw: 'Change password', currentPw: 'Current', newPw: 'New', save: 'Save', saved: 'Saved', wrongPw: 'Wrong password', weakPw: 'Password too short (min 4)',
      viewer: 'Viewer settings', nickname: 'Your name in comments', tvMode: 'TV mode (bigger text, remote navigation)', auto: 'Auto', on: 'On', off: 'Off', server: 'Server address', change: 'Change', lang: 'Language', theme: 'Theme', dark: 'Dark', light: 'Light', accent: 'Accent', autoplay: 'Autoplay', hover: 'Hover preview', captions: 'Captions by default',
      noVideos: 'No videos yet — upload your first one', serverInfo: 'Server', storage: 'Storage',
      storR2: 'Permanent on Cloudflare R2 — files live outside the server and survive redeploys',
      storLocal: 'Server disk — without a persistent disk, files are wiped on every restart', tabHint: 'Everything you upload here shows up instantly for everyone who opens the site or the app.', gen: 'Regenerate missing thumbnails',
    },
  };
  const t = (k) => (D[LT.lang] || D.ar)[k] || D.ar[k] || k;
  const admin = () => Boolean(S().auth && S().auth.admin);

  // ---------- الدخول
  function login() {
    const site = S().site || {};
    const pw = h('input', { type: 'password', placeholder: t('password'), autocomplete: 'current-password' });
    const isSetup = !site.hasAdmin;
    modal({
      title: isSetup ? t('setup') : t('login'),
      body: (b) => { b.append(h('div.field', pw)); if (isSetup) b.append(h('p.muted.sm', LT.lang === 'ar' ? 'هذا الخادم بلا مشرف بعد. أول كلمة مرور تُعيَّن هنا تصبح كلمة مرور المشرف.' : 'This server has no admin yet. The first password set here becomes the admin password.')); },
      actions: [{ label: LT.t('cancel') }, { label: t('enter'), cls: 'primary', onClick: async () => {
        try {
          if (isSetup) await window.liwa.auth.setup(pw.value); else await window.liwa.auth.login(pw.value);
          S().auth = await window.liwa.auth.status(); S().site = S().auth.site;
          S().settings = await window.liwa.settings.get(); S().ai = await window.liwa.ai.status();
          S().lib = await window.liwa.library.get();
          LT.applySettings();
          toast(t('done')); $('#btnAddFolder').hidden = false;
          LT.router.go('#/studio');
        } catch (e) { toast(e.code === 'WEAK_PASSWORD' ? t('weakPw') : e.code === 'WRONG_PASSWORD' ? t('wrongPw') : `${e.message}`, { err: true }); return false; }
      } }],
    });
    setTimeout(() => pw.focus(), 50);
  }
  async function logout() { await window.liwa.auth.logout(); S().auth = { admin: false, site: S().site }; $('#btnAddFolder').hidden = true; S().lib = await window.liwa.library.get(); LT.router.go('#/home'); }

  // ---------- الصفحة الرئيسية للوحة
  async function render(params) {
    if (!admin()) { login(); return h('div.empty', h('h2', t('studio')), h('button.btn.primary', { onclick: login }, t('login'))); }
    const tab = params[0] || 'dash';
    const tabs = [['dash', 'insights'], ['upload', 'folder'], ['videos', 'all'], ['settings', 'settings']];
    const root = h('div.studio',
      h('div.section-h', LT.icon('folder'), t('studio'), h('span.spacer'), h('button.btn.sm', { onclick: logout }, t('logout'))),
      h('div.studio-tabs', tabs.map(([k, ic]) => h('button.chip', { class: tab === k ? 'on' : '', onclick: () => LT.router.go(`#/studio/${k}`) }, LT.icon(ic, 16), ' ', t(k)))));
    if (tab === 'upload') root.append(uploadTab());
    else if (tab === 'videos') root.append(await videosTab());
    else if (tab === 'settings') root.append(await settingsTab());
    else root.append(await dashTab());
    return root;
  }

  async function dashTab() {
    const st = await window.liwa.studio.stats();
    const stat = (n, l) => h('div.stat', h('b', String(n)), h('span', l));
    const recent = Object.values(S().lib.videos).sort((a, b) => b.addedAt - a.addedAt).slice(0, 8).map((v) => LT.views.info(v.id)).filter(Boolean);
    const r2 = (S().site || {}).storage === 'r2';
    return h('div',
      h('div.ai-note', LT.icon('ai'), h('span', t('tabHint'))),
      h('div.ai-note', { style: r2 ? {} : { background: 'rgba(240,170,55,.15)', borderColor: 'rgba(240,170,55,.45)' } },
        h('span', r2 ? '🗄️' : '⚠️'), h('span.grow', h('b', `${t('storage')}: `), r2 ? t('storR2') : t('storLocal'))),
      h('div.stats-grid', stat(st.videos, t('videos')), stat(st.views, t('views')), stat(st.likes, t('likes')), stat(st.comments, t('comments')), stat(fmtBytes(st.size), t('size')), stat(LT.fmtHours(st.duration), t('hours')), stat(st.analyzed, t('analyzed'))),
      h('div.row', { style: { marginBottom: '16px' } }, h('button.btn.primary', { onclick: () => LT.router.go('#/studio/upload') }, LT.icon('plus'), t('upload')), h('span.muted.xs', `${t('serverInfo')}: ${LT.api.base() || location.origin}`)),
      recent.length ? h('div.grid.dense', recent.map((v) => LT.views.card(v, { showChannel: false }))) : h('div.empty', h('p', t('noVideos'))));
  }

  // ---------- الرفع
  function uploadTab() {
    const channels = S().lib.channels.map((c) => c.name);
    const chanSel = h('select', channels.map((c) => h('option', { value: c }, c)), h('option', { value: '__new' }, t('newChannel')));
    const chanNew = h('input', { type: 'text', placeholder: t('channel'), hidden: channels.length > 0 });
    chanSel.onchange = () => { chanNew.hidden = chanSel.value !== '__new'; if (!chanNew.hidden) chanNew.focus(); };
    if (!channels.length) chanSel.value = '__new';
    const titleIn = h('input', { type: 'text', placeholder: t('titleOpt') });
    const fileIn = h('input', { type: 'file', accept: 'video/*,.mkv,.webm,.mp4,.mov,.m4v', multiple: true, hidden: true });
    const list = h('div.up-list');
    const zone = h('div.dropzone', { onclick: () => fileIn.click() }, h('b', t('dropHint')), h('span', t('dropSub')));
    zone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.remove('over'); enqueue([...e.dataTransfer.files]); });
    fileIn.onchange = () => { enqueue([...fileIn.files]); fileIn.value = ''; };
    const queue = []; let busy = false;
    function enqueue(files) {
      for (const f of files) {
        if (!/\.(mp4|m4v|mov|webm|mkv|ogv)$/i.test(f.name)) { toast(`${f.name}: ${LT.t('unplayable')}`, { err: true }); continue; }
        const item = { f, el: null, bar: null, st: null };
        item.st = h('span.st', t('queued')); item.bar = h('i');
        item.el = h('div.up-item', h('span.ellip', f.name), item.st, h('div.bar', item.bar));
        list.prepend(item.el); queue.push(item);
      }
      pump();
    }
    async function pump() {
      if (busy) return; busy = true;
      while (queue.length) {
        const it = queue.shift();
        const channel = (chanSel.value === '__new' ? chanNew.value : chanSel.value).trim();
        try {
          it.st.textContent = `${t('uploading')} 0%`;
          const rec = await window.liwa.studio.upload(it.f, { channel, title: queue.length === 0 && titleIn.value.trim() ? titleIn.value.trim() : '' }, (p) => { it.bar.style.width = `${Math.round(p * 100)}%`; it.st.textContent = `${t('uploading')} ${Math.round(p * 100)}%`; });
          it.st.textContent = t('processing');
          await makeThumb(rec.id);
          it.el.classList.add('done'); it.st.textContent = t('done');
          S().lib = await window.liwa.studio.refresh();
          if (channel && !channels.includes(channel)) { channels.push(channel); chanSel.insertBefore(h('option', { value: channel, selected: true }, channel), chanSel.lastChild); chanNew.hidden = true; }
          if (S().settings.aiAutoAnalyze && S().ai.enabled) LT.actions.analyze(rec.id, { silent: true });
        } catch (e) {
          it.el.classList.add('err');
          it.st.textContent = `${t('failed')}: ${msgFor(e)}`;
          if (isExpired(e)) { queue.length = 0; toast(t('expired'), { err: true }); S().auth = { admin: false, site: S().site }; login(); break; }
        }
      }
      busy = false;
      LT.renderSidebar && LT.renderSidebar();
    }
    return h('div', h('div.up-meta', h('div', h('label', t('channel')), chanSel, chanNew), h('div', h('label', t('titleOpt')), titleIn)), zone, fileIn, list);
  }
  const isExpired = (e) => e && (e.status === 401 || ['SESSION_EXPIRED', 'UNAUTHORIZED'].includes(e.code));
  /** يترجم أخطاء الخادم إلى رسالة مفهومة. */
  function msgFor(e) {
    const c = e && (e.code || e.message);
    if (isExpired(e)) return t('expired');
    if (c === 'PASSWORD_MANAGED_BY_ENV') return t('envPw');
    if (c === 'NETWORK' || c === 'TIMEOUT') return t('netErr');
    if (c === 'PAYLOAD_TOO_LARGE' || e.status === 413) return t('tooBig');
    if (c === 'UNSUPPORTED_TYPE' || e.status === 415) return t('badType');
    return String(c || 'error');
  }
  LT.studioMsg = msgFor;

  /** يولّد الصورة المصغّرة والمدة في متصفح المشرف ويرفعها. */
  async function makeThumb(id) {
    const v = S().lib.videos[id] || (await window.liwa.studio.refresh()).videos[id];
    if (!v) return;
    try {
      const cap = await LT.thumbs.capture(LT.urls.video(v));
      await window.liwa.library.probe(id, { duration: cap.duration, width: cap.width, height: cap.height });
      await window.liwa.library.saveThumb(id, await LT.thumbs.dataUrlToBuf(cap.dataUrl), cap.at);
    } catch { await window.liwa.library.probe(id, { duration: 0 }).catch(() => {}); }
  }

  // ---------- المقاطع
  async function videosTab() {
    const lib = await window.liwa.studio.list(); S().lib = lib;
    const vids = Object.values(lib.videos).sort((a, b) => b.addedAt - a.addedAt);
    if (!vids.length) return h('div.empty', h('p', t('noVideos')), h('button.btn.primary', { onclick: () => LT.router.go('#/studio/upload') }, t('upload')));
    const rows = vids.map((v) => {
      const tr = h('tr', { class: v.hidden ? 'hidden-row' : '' },
        h('td', v.thumb ? h('img.t', { src: LT.urls.thumb(v) }) : h('div.t')),
        h('td', h('div', { style: { fontWeight: 600 } }, v.title), h('div.muted.xs', `${v.channel} • ${timeAgo(v.addedAt)}${v.ai ? ' • AI' : ''}`)),
        h('td', fmtTime(v.duration)), h('td', String(v.views || 0)), h('td', `${v.likes || 0} 👍`),
        h('td', h('span.switch', { class: v.hidden ? '' : 'on', title: v.hidden ? t('hidden') : t('visible'), tabindex: 0, onclick: async (e) => { const on = !e.target.classList.contains('on'); await window.liwa.studio.update(v.id, { hidden: !on }); e.target.classList.toggle('on', on); tr.classList.toggle('hidden-row', !on); } })),
        h('td.acts',
          h('button.icon-btn', { title: LT.t('play'), onclick: () => LT.router.go(`#/watch/${v.id}`) }, LT.icon('play', 18)),
          h('button.icon-btn', { title: t('edit'), onclick: () => LT.actions.editMeta(v.id) }, LT.icon('edit', 18)),
          h('button.icon-btn', { title: t('ai'), onclick: () => LT.actions.analyze(v.id) }, LT.icon('ai', 18)),
          h('button.icon-btn', { title: t('sub'), onclick: () => uploadSub(v.id) }, LT.icon('all', 18)),
          h('button.icon-btn', { title: t('thumb'), onclick: async () => { await makeThumb(v.id); LT.router.refresh(); } }, LT.icon('film', 18)),
          h('button.icon-btn', { title: t('del'), onclick: () => remove(v.id) }, LT.icon('trash', 18))));
      return tr;
    });
    return h('div', h('div.row', { style: { marginBottom: '10px' } }, h('span.muted.sm', `${vids.length}`), h('span.spacer'), h('button.btn.sm', { onclick: async () => { for (const v of vids.filter((x) => !x.thumb)) await makeThumb(v.id); LT.router.refresh(); } }, t('gen'))),
      h('table.vtable', h('thead', h('tr', h('th', ''), h('th', t('title')), h('th', t('duration')), h('th', t('views')), h('th', t('likes')), h('th', t('visible')), h('th', ''))), h('tbody', rows)));
  }
  function uploadSub(id) {
    const inp = h('input', { type: 'file', accept: '.vtt,.srt' });
    const lang = h('input', { type: 'text', value: 'ar', placeholder: 'ar' });
    modal({ title: t('sub'), body: (b) => b.append(h('div.field', h('label', 'VTT / SRT'), inp), h('div.field', h('label', LT.lang === 'ar' ? 'رمز اللغة' : 'Language code'), lang)),
      actions: [{ label: LT.t('cancel') }, { label: t('save'), cls: 'primary', onClick: async () => { if (!inp.files[0]) return false; await window.liwa.studio.uploadSub(id, inp.files[0], lang.value.trim() || 'ar'); toast(t('saved')); LT.router.refresh(); } }] });
  }
  function remove(id) {
    const v = S().lib.videos[id];
    modal({ title: `${t('del')}: ${v ? v.title : ''}`, body: (b) => b.append(h('p', t('confirmDel'))), actions: [{ label: LT.t('cancel') }, { label: t('del'), cls: 'danger', onClick: async () => { await window.liwa.studio.remove(id); S().lib = await window.liwa.studio.refresh(); toast(LT.t('removed')); if (location.hash.includes(id)) LT.router.go('#/studio/videos'); else LT.router.refresh(); } }] });
  }

  // ---------- الإعدادات
  const row = (label, small, control) => h('div.set-row', h('div.lbl', label, small ? h('small', small) : null), control);
  function viewerSettings() {
    const st = S(); const s = st.settings;
    const set = async (patch) => { Object.assign(s, patch); await window.liwa.settings.set(patch); LT.applySettings(); };
    const select = (key, opts) => { const el = h('select', { onchange: () => set({ [key]: el.value }) }, opts.map(([v, l]) => h('option', { value: v, selected: s[key] === v }, l))); return el; };
    const sw = (key) => { const el = h('span.switch', { class: s[key] ? 'on' : '', tabindex: 0, onclick: async () => { await set({ [key]: !s[key] }); el.classList.toggle('on', s[key]); } }); return el; };
    const nick = h('input', { type: 'text', value: s.nickname || '', onchange: () => set({ nickname: nick.value.trim().slice(0, 40) }) });
    return h('div.set-group', h('h3', LT.icon('settings', 18), t('viewer')),
      row(t('lang'), null, select('lang', [['ar', 'العربية'], ['en', 'English']])),
      row(t('theme'), null, select('theme', [['dark', t('dark')], ['light', t('light')]])),
      row(t('accent'), null, select('accent', [['red', '●'], ['violet', '●'], ['sky', '●'], ['emerald', '●'], ['amber', '●']])),
      row(t('autoplay'), null, sw('autoplay')), row(t('hover'), null, sw('hoverPreview')), row(t('captions'), null, sw('captions')),
      row(t('nickname'), null, nick),
      row(t('tvMode'), null, select('tvMode', [['auto', t('auto')], ['on', t('on')], ['off', t('off')]])),
      window.LT_STANDALONE ? row(t('server'), LT.api.base(), h('button.btn.sm', { onclick: () => LT.changeServer() }, t('change'))) : null);
  }
  function settings() {
    const st = S();
    return h('div.settings', h('div.section-h', LT.icon('settings'), LT.t('settings')), viewerSettings(),
      admin() ? h('div.row', h('button.btn.primary', { onclick: () => LT.router.go('#/studio/settings') }, LT.icon('folder'), t('studio'))) : h('div.row', h('button.btn', { onclick: login }, t('login'))),
      h('div.nav-foot', `LiwaTube ${st.info?.version || ''} • ${st.info?.creator || ''}`));
  }
  async function settingsTab() {
    const cfg = await window.liwa.studio.settings();
    const save = async (patch) => {
      try { Object.assign(cfg, await window.liwa.studio.settings(patch)); S().site = await window.liwa.auth.status().then((a) => a.site); S().ai = await window.liwa.ai.status(); toast(t('saved')); }
      catch (e) {
        toast(e.code === 'WRONG_PASSWORD' ? t('wrongPw') : e.code === 'WEAK_PASSWORD' ? t('weakPw') : msgFor(e), { err: true });
        if (isExpired(e)) { S().auth = { admin: false, site: S().site }; login(); }
      }
    };
    const sw = (key) => { const el = h('span.switch', { class: cfg[key] ? 'on' : '', tabindex: 0, onclick: async () => { await save({ [key]: !cfg[key] }); el.classList.toggle('on', cfg[key]); } }); return el; };
    const name = h('input', { type: 'text', value: cfg.siteName, onchange: () => save({ siteName: name.value }) });
    const welcome = h('input', { type: 'text', value: cfg.welcome || '', onchange: () => save({ welcome: welcome.value }) });
    const key = h('input', { type: 'password', placeholder: cfg.aiKeySet ? '•••••••• (' + t('keySet') + ')' : 'sk-ant-…', style: { direction: 'ltr' } });
    const model = h('select', { onchange: () => save({ aiModel: model.value }) }, (cfg.models || []).map((m) => h('option', { value: m.id, selected: cfg.aiModel === m.id }, m.label)));
    const cur = h('input', { type: 'password', placeholder: t('currentPw') }); const nw = h('input', { type: 'password', placeholder: t('newPw') });
    return h('div',
      h('div.set-group', h('h3', '🌐 ', t('siteName')), row(t('siteName'), null, name), row(t('welcome'), null, welcome), row(t('allowComments'), null, sw('allowComments'))),
      h('div.set-group', h('h3', LT.icon('ai', 18), LT.t('ai')),
        row(t('aiEnabled'), null, sw('aiEnabled')),
        row(t('aiKey'), cfg.aiKeySet ? t('keySet') : t('keyNone'), h('div.row', key, h('button.btn.sm', { onclick: async () => { if (!key.value.trim()) return; await save({ aiKey: key.value.trim() }); key.value = ''; LT.router.refresh(); } }, t('saveKey')))),
        row(t('aiModel'), null, model),
        row(t('aiPublic'), null, sw('aiPublic'))),
      h('div.set-group', h('h3', '🔑 ', t('changePw')), row(t('changePw'), null, h('div.row', cur, nw, h('button.btn.sm', { onclick: async () => { await save({ currentPassword: cur.value, newPassword: nw.value }); cur.value = nw.value = ''; } }, t('save'))))),
      viewerSettings());
  }

  LT.studio = { render, login, logout, settings, remove, edit: (id) => LT.actions.editMeta(id), goUpload: () => LT.router.go('#/studio/upload'), t };
})(window.LT = window.LT || {});
