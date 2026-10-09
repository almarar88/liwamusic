/* LiwaIPTV — التطبيق: إضافة الاشتراكات، الرئيسية، القنوات المباشرة بدليلها،
   الأفلام والمسلسلات بأغلفتها وتصنيفها وفرزها، صفحة التفاصيل، البحث،
   والإعدادات (المشغل، الترجمة، الرقابة الأبوية، TMDB). */
'use strict';

import { Library, SORTS, filterItems, countByCat, sortItems, continueWatching, makePlaylist, providers } from './library.js';
import { Player } from './player.js';
import { store } from './store.js';
import { setDefaultHeaders } from './http.js';
import { native, onBack, exitApp, isNative } from './native.js';
import { enrich } from './tmdb.js';
import { nowNext, progress } from './epg.js';
import { esc, fmtDur, clock, norm, hash } from './util.js';
import { $, $$, icon, toast, art, choose, confirmBox, promptBox, openSheet, closeSheet, sheetOpen, renderChunks, lazyEach, moveFocus, KEYDIR } from './ui.js';

const lib = new Library();
const DEFAULTS = {
  liveFormat: 'auto', engine: 'auto', aspect: 'fit', autoNext: true, externalAlways: false, landscape: true,
  subLang: 'ar', subSize: 100, subColor: '#ffffff', subBg: 'shadow', subPos: 8, osKey: '',
  tmdbKey: '', tmdbLang: 'ar', pin: '', parental: true, liveView: 'list', userAgent: '',
};
let settings = { ...DEFAULTS };
const saveSettings = () => store.set('settings', settings);
let player = null;
let route = 'home';
let stopView = [];
let unlockedUntil = 0;
let detailRepaint = null;

/** بعد إغلاق المشغل: تحديث «متابعة المشاهدة» وزر الاستئناف وتقدم الحلقات. */
function afterPlayer() {
  if (!$('#detail').hidden && detailRepaint) detailRepaint();
  else if (route === 'home') render();
}

// حالة كل شاشة: القسم والفرز والبحث
const viewState = {
  live: { cat: 'all', sort: 'default', q: '' },
  movie: { cat: 'all', sort: 'added', q: '' },
  series: { cat: 'all', sort: 'added', q: '' },
  search: { q: '' },
};

const KIND_LABEL = { live: 'القنوات', movie: 'الأفلام', series: 'المسلسلات' };

// ———————————————————————————— الإقلاع

async function boot() {
  settings = { ...DEFAULTS, ...((await store.get('settings')) || {}) };
  showSplash('');
  await lib.init();
  applyUserAgent();
  player = new Player({ lib, settings, saveSettings, onClose: afterPlayer });
  bindChrome();
  bindAddForm();
  setInterval(() => { $('#clock').textContent = clock(Date.now()); }, 15000);
  $('#clock').textContent = clock(Date.now());
  if (new URLSearchParams(location.search).has('tv') || (isNative && await native.isTv())) document.body.classList.add('tv');
  watchFold();
  if (!lib.pl) { hideSplash(); showWelcome(); return; }
  if (lib.playlists.length > 1) { hideSplash(); showProfiles(); return; }
  await activate(lib.pl.id);
}

async function activate(id, { refresh = false } = {}) {
  $('#profiles').hidden = true;
  showSplash('تحميل المكتبة…');
  try {
    await lib.activate(id, { refresh, onProgress: (t) => { $('#splashText').textContent = t; } });
    // تحديث تلقائي في الخلفية إن مضى يوم على آخر تحميل
    if (!refresh && Date.now() - (lib.data.loadedAt || 0) > 24 * 3600e3) backgroundRefresh();
  } catch (e) {
    hideSplash();
    showWelcome();
    showAddError(e.message);
    $('#addCancel').hidden = lib.playlists.length < 2;
    return;
  }
  billboardPick = null;
  hideSplash();
  showApp();
}

async function backgroundRefresh() {
  const id = lib.pl.id;
  try {
    const data = await providers[lib.pl.type].load(lib.pl);
    data.loadedAt = Date.now();
    await store.set(`lib:${id}`, data);
    if (lib.pl && lib.pl.id === id) { lib.setData(data); if (!player.isOpen && !sheetOpen() && $('#detail').hidden) render(); }
  } catch { /* نبقى على النسخة المحفوظة */ }
}

function showSplash(text) {
  $('#splash').hidden = false;
  $('#splashText').textContent = text || '';
}
function hideSplash() { $('#splash').hidden = true; }

function showWelcome(loading = false) {
  $('#welcome').hidden = false;
  $('#profiles').hidden = true;
  $('#app').hidden = true;
  $('#detail').hidden = true;
  $('#addForm').classList.toggle('loading', loading);
  $('#addErr').hidden = true;
  if (!loading) setTimeout(() => $('#addForm input[name=server]').focus(), 50);
}

function showApp() {
  $('#welcome').hidden = true;
  $('#profiles').hidden = true;
  $('#app').hidden = false;
  $('#addForm').classList.remove('loading');
  paintAvatars();
  go(route || 'home');
}

function setProgress(text) {
  const p = $('#addProgress');
  if (!text) { p.hidden = true; return; }
  $('span', p).textContent = text;
  p.hidden = false;
}

function showAddError(msg) {
  const e = $('#addErr');
  e.textContent = msg;
  e.hidden = false;
  $('#addForm').classList.remove('loading');
}

// ———————————————————————————— الاشتراكات كملفات شخصية

const hueOf = (pl) => parseInt(hash(pl.id), 36) % 360;
const initialOf = (pl) => (String(pl.name || '?').trim().replace(/^ال(?=\p{L}{2})/u, '').match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();
const avatar = (pl, cls = '') => `<span class="avatar ${cls}" style="--h:${hueOf(pl)}">${esc(initialOf(pl))}</span>`;

function paintAvatars() {
  for (const el of $$('[data-avatar]')) {
    el.style.setProperty('--h', hueOf(lib.pl));
    el.textContent = initialOf(lib.pl);
  }
}

let profEdit = false;
function showProfiles() {
  const box = $('#profGrid');
  box.innerHTML = lib.playlists.map((p) => `<button class="prof" data-prof="${esc(p.id)}">${avatar(p)}<span>${esc(p.name)}</span><small>${providers[p.type].label}</small></button>`).join('')
    + `<button class="prof add" data-prof="+"><span class="avatar">${icon('plus')}</span><span>إضافة اشتراك</span></button>`;
  $('#profiles').hidden = false;
  $('#profManage').textContent = profEdit ? 'تم' : 'إدارة الاشتراكات';
  $('#profiles').classList.toggle('edit', profEdit);
  box.onclick = async (e) => {
    const b = e.target.closest('[data-prof]');
    if (!b) return;
    const id = b.dataset.prof;
    if (id === '+') { profEdit = false; openAdd(); return; }
    if (profEdit) {
      const p = lib.playlists.find((x) => x.id === id);
      if (!(await confirmBox(`حذف «${p.name}» وكل قائمته وسجلّه؟`, { ok: 'حذف', danger: true }))) return;
      await lib.removePlaylist(id);
      if (!lib.playlists.length) { profEdit = false; lib.data = null; showWelcome(); $('#addCancel').hidden = true; return; }
      showProfiles();
      return;
    }
    route = 'home';
    if (lib.data && lib.pl && lib.pl.id === id) { $('#profiles').hidden = true; showApp(); return; }
    await activate(id);
  };
  setTimeout(() => (box.querySelector(`[data-prof="${CSS.escape((lib.pl && lib.pl.id) || '')}"]`) || box.querySelector('.prof')).focus(), 60);
}

// ———————————————————————————— الهواتف القابلة للطي

/** وضعية الطي من Jetpack WindowManager: طاولة (مفصّل أفقي) أو كتاب (مفصّل عمودي). */
function applyFold(f) {
  const b = document.body;
  const half = f && (f.state === 'half' || f.separating);
  b.classList.toggle('tabletop', !!(half && f.orientation === 'h'));
  b.classList.toggle('book', !!(half && f.orientation === 'v'));
  if (half) {
    b.style.setProperty('--hinge-top', `${f.y}px`);
    b.style.setProperty('--hinge-h', `${f.h}px`);
    b.style.setProperty('--hinge-w', `${f.w}px`);
  }
  if (player && player.isOpen) player.applyAspect();
}

async function watchFold() {
  native.on('fold', applyFold);
  const f = await native.getFold();
  if (f) applyFold(f);
}

// ———————————————————————————— نموذج إضافة اشتراك

function bindAddForm() {
  const form = $('#addForm');
  let type = 'xtream';
  let file = null;
  $$('#addType button').forEach((b) => b.addEventListener('click', () => {
    type = b.dataset.type;
    $$('#addType button').forEach((x) => x.classList.toggle('on', x === b));
    $$('[data-for]', form).forEach((d) => { d.hidden = d.dataset.for !== type; });
    $('#addErr').hidden = true;
  }));
  $('input[name=file]', form).addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    file = { name: f.name, content: await f.text() };
    $('#fileName').textContent = `✓ ${f.name} (${Math.round(f.size / 1024)} KB)`;
  });
  $('#addCancel').addEventListener('click', () => { if (lib.data) showApp(); });
  $('#addSubmit').addEventListener('click', async () => {
    const v = (n) => ($(`[name=${n}]`, form).value || '').trim();
    $('#addErr').hidden = true;
    let pl;
    try {
      pl = makePlaylist({
        type, name: v('name'), server: type === 'stalker' ? v('portal') : v('server'), username: v('username'), password: v('password'),
        url: v('url'), content: !v('url') && file ? file.content : '', fileName: file && file.name, epgUrl: v('epgUrl'), mac: v('mac'),
      });
    } catch (e) { showAddError(e.message); return; }
    form.classList.add('loading');
    setProgress('الاتصال…');
    try {
      await lib.addPlaylist(pl);
      route = 'home';
      await lib.activate(pl.id, { refresh: true, onProgress: setProgress });
      setProgress(null);
      form.querySelectorAll('input').forEach((i) => { if (i.type !== 'file') i.value = ''; });
      file = null; $('#fileName').textContent = '';
      showApp();
      const d = lib.data;
      toast(`تم: ${d.items.filter((i) => i.kind === 'live').length} قناة · ${d.items.filter((i) => i.kind === 'movie').length} فيلم · ${d.items.filter((i) => i.kind === 'series').length} مسلسل`, 4000);
    } catch (e) {
      await lib.removePlaylist(pl.id);
      setProgress(null);
      showAddError(e.message);
    }
  });
}

// ———————————————————————————— التنقل

function bindChrome() {
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]');
    if (g) { go(g.dataset.go); }
  });
  $('#plSwitch').addEventListener('click', () => showProfiles());
  $('#profManage').addEventListener('click', () => { profEdit = !profEdit; showProfiles(); });
  $('#view').addEventListener('focusin', onHomeFocus);
  $('#view').addEventListener('scroll', () => { $('#app').classList.toggle('scrolled', $('#view').scrollTop > 30); }, { passive: true });
  onBack(handleBack);
  document.addEventListener('keydown', onKey);
}

function go(r) {
  route = r;
  $('#detail').hidden = true;
  $('#app').dataset.route = r;
  $('#app').classList.remove('scrolled');
  $$('#nav [data-go]').forEach((b) => b.classList.toggle('on', b.dataset.go === r));
  $$('#pills [data-go]').forEach((b) => b.classList.toggle('on', b.dataset.go === r));
  render();
  const v = $('#view');
  v.scrollTop = 0;
}

function render() {
  stopView.forEach((f) => f());
  stopView = [];
  const v = $('#view');
  v.dataset.route = route;
  if (!lib.data) { v.innerHTML = ''; return; }
  ({ home: renderHome, live: renderLive, movie: () => renderVod('movie'), series: () => renderVod('series'), search: renderSearch, settings: renderSettings })[route]();
}

let lastBack = 0;
function handleBack() {
  if (sheetOpen()) { closeSheet(); return; }
  if (player.back()) return;
  if (!$('#detail').hidden) { closeDetail(); return; }
  if (!$('#profiles').hidden && lib.data) { $('#profiles').hidden = true; showApp(); return; }
  if (!$('#welcome').hidden && lib.data) { showApp(); return; }
  if (route !== 'home') { go('home'); return; }
  if (Date.now() - lastBack < 2000) { exitApp(); return; }
  lastBack = Date.now();
  toast('اضغط رجوع مرة أخرى للخروج');
}

function onKey(e) {
  if (e.key === 'Escape' || e.key === 'GoBack' || e.key === 'BrowserBack') { if (!isNative) { handleBack(); e.preventDefault(); } return; }
  if (player.handleKey(e)) { e.preventDefault(); return; }
  if (KEYDIR[e.key]) {
    const t = e.target;
    if (t instanceof HTMLInputElement && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && t.value) return;
    const scope = sheetOpen() ? $('#sheet') : !$('#detail').hidden ? $('#detail') : !$('#profiles').hidden ? $('#profiles') : !$('#welcome').hidden ? $('#welcome') : $('#app');
    if (moveFocus(KEYDIR[e.key], scope)) e.preventDefault();
  }
}

function openAdd() {
  showWelcome();
  $('#addCancel').hidden = !lib.data;
}

function openExternal(url, title, ua) {
  if (isNative) native.openExternal(url, title, ua);
  else window.open(url, '_blank', 'noopener');
}

/** User-Agent مخصص لكل الطلبات (بعض الخوادم ترفض غير المشغلات المعروفة). */
function applyUserAgent() {
  setDefaultHeaders(settings.userAgent ? { 'User-Agent': settings.userAgent } : {});
  native.setProxyRules([{ host: '*', ua: settings.userAgent || '', referer: '' }]);
}

// ———————————————————————————— الرقابة الأبوية

function blocked(kind) {
  return lib.blocked(kind, settings.parental && Date.now() > unlockedUntil);
}

async function askPin() {
  if (!settings.pin) return true;
  const v = await promptBox('أدخل رمز القفل', { type: 'password' });
  if (v === null) return false;
  if (v === settings.pin) { unlockedUntil = Date.now() + 30 * 60000; return true; }
  toast('رمز غير صحيح');
  return false;
}

// ———————————————————————————— الرئيسية

const WEEK = 7 * 86400;
let top10 = new Set();
let billboardPick = null;

function card(item, { progressPct = 0 } = {}) {
  const name = item.title || item.name;
  if (item.kind === 'live') {
    return `<button class="card-item ch-tile" data-open="${esc(item.id)}">${art(item.logo, name, 'logo')}<span class="live-dot">مباشر</span>${lib.isFav(item.id) ? icon('heart-f', 'fav') : ''}<b>${esc(name)}</b></button>`;
  }
  const isNew = item.added && Date.now() / 1000 - item.added < WEEK;
  return `<button class="card-item poster" data-open="${esc(item.id)}" aria-label="${esc(name)}">
    ${art(item.logo, name, 'cover')}
    ${top10.has(item.id) ? '<span class="top10">TOP<b>10</b></span>' : item.quality ? `<span class="q">${esc(item.quality)}</span>` : ''}
    ${progressPct ? `<i class="pb"><i style="width:${progressPct}%"></i></i>` : isNew ? `<span class="new">${item.kind === 'series' ? 'حلقات جديدة' : 'أُضيف حديثًا'}</span>` : ''}
    <b>${esc(name)}</b></button>`;
}

function row(title, items, opts = {}) {
  if (!items.length) return '';
  return `<section class="row-sec ${opts.cls || ''}"><div class="row-head"><h2>${esc(title)}</h2>${opts.more ? `<button class="link" ${opts.more}>عرض الكل ${icon('chev')}</button>` : ''}</div>
    <div class="row-scroll">${items.map((i, n) => (opts.render ? opts.render(i, n) : card(i))).join('')}</div></section>`;
}

/** محتوى اللوحة الكبيرة لعنصر (فيلم/مسلسل). */
function billboardHtml(it) {
  const name = it.title || it.name;
  const img = it.backdrop || it.logo || '';
  const rank = [...top10].indexOf(it.id);
  const tags = [
    rank >= 0 ? `<span class="tag-red">#${rank + 1} اليوم</span>` : '',
    it.year ? `<span>${it.year}</span>` : '',
    it.rating ? `<span>★ ${Number(it.rating).toFixed(1)}</span>` : '',
    ...String(it.genre || lib.catById(it.kind, it.cat)?.name || '').split(/[,،|/]/).map((g) => g.trim()).filter(Boolean).slice(0, 3).map((g) => `<span>${esc(g)}</span>`),
  ].filter(Boolean).join('');
  const fav = lib.isFav(it.id);
  return `<div class="bb-glow" style="--img:url('${esc(img)}')"></div>
    <button class="bb-poster" data-bb="info" data-id="${esc(it.id)}" aria-label="التفاصيل">${art(it.logo, name, 'cover')}</button>
    <div class="bb-body">
      <span class="kicker"><span class="n">L</span>${it.kind === 'series' ? 'مسلسل' : 'فيلم'}</span>
      <h1 class="bb-title">${esc(name)}</h1>
      <div class="bb-tags">${tags}</div>
      ${it.plot ? `<p class="bb-plot">${esc(it.plot)}</p>` : ''}
      <div class="bb-actions">
        <button class="btn white" data-bb="play" data-id="${esc(it.id)}">${icon('play')} تشغيل</button>
        <button class="btn gray" data-bb="fav" data-id="${esc(it.id)}">${icon(fav ? 'check' : 'plus')} قائمتي</button>
        <button class="btn gray icon-only bb-info" data-bb="info" data-id="${esc(it.id)}" aria-label="التفاصيل">${icon('info')}</button>
      </div>
    </div>`;
}

function paintBillboard(it, animate = false) {
  const bb = $('#bb');
  if (!bb || !it) return;
  bb.className = `billboard ${it.backdrop ? '' : 'poster-only'} ${animate ? 'swap' : ''}`;
  bb.dataset.id = it.id;
  bb.innerHTML = billboardHtml(it);
}

function renderHome() {
  const v = $('#view');
  const items = lib.data.items;
  const blockedAll = new Set([...blocked('live'), ...blocked('movie'), ...blocked('series')]);
  const ok = (i) => !blockedAll.has(i.cat);
  const favs = lib.favSet();
  const movies = items.filter((i) => i.kind === 'movie' && ok(i));
  const series = items.filter((i) => i.kind === 'series' && ok(i));
  const live = items.filter((i) => i.kind === 'live' && ok(i));
  const latestMovies = sortItems(movies, 'added').slice(0, 20);
  const latestSeries = sortItems(series, 'added').slice(0, 20);
  const rated = sortItems(movies.filter((m) => m.rating), 'rating');
  const top = (rated.length >= 10 ? rated : latestMovies).slice(0, 10);
  top10 = new Set(top.map((i) => i.id));

  // اللوحة: عنصر حديث له صورة — يبقى ثابتًا خلال الجلسة
  if (!billboardPick || !lib.byId.has(billboardPick)) {
    const pool = [...latestSeries.filter((s) => s.backdrop), ...latestMovies, ...latestSeries].filter((i) => i.logo).slice(0, 8);
    billboardPick = pool.length ? pool[Math.floor(Math.random() * pool.length)].id : null;
  }
  const hero = billboardPick && lib.byId.get(billboardPick);

  // متابعة المشاهدة: آخر حلقة لكل مسلسل
  const seen = new Set();
  const cont = continueWatching(lib.user.history).filter((h) => {
    const k = h.seriesId || h.id;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 20);

  const myList = [...movies, ...series].filter((i) => favs.has(i.id)).sort((a, b) => lib.user.fav[b.id] - lib.user.fav[a.id]);
  const myLive = [...live.filter((i) => favs.has(i.id)), ...lib.recentIds('live').map((id) => lib.byId.get(id)).filter((i) => i && !favs.has(i.id))].slice(0, 20);
  const liveNow = myLive.length ? [] : live.slice(0, 16);

  // «لأنك شاهدت…»: من نفس قسم آخر فيلم/مسلسل شوهد
  const lastVod = lib.user.history.map((h) => lib.byId.get(h.seriesId || h.id)).find((i) => i && i.kind !== 'live');
  const because = lastVod ? sortItems(items.filter((i) => i.cat === lastVod.cat && i.id !== lastVod.id && ok(i)), 'rating').slice(0, 20) : [];

  // صفوف الأقسام الأكثر محتوى
  const catRows = (kind, list, n) => {
    const counts = countByCat(list, kind);
    return lib.cats(kind).filter((c) => !c.adult && counts.get(c.id) >= 4).sort((a, b) => counts.get(b.id) - counts.get(a.id)).slice(0, n)
      .map((c) => row(c.name, sortItems(list.filter((i) => i.cat === c.id), 'added').slice(0, 20), { more: `data-cat-go="${kind}|${esc(c.id)}"` })).join('');
  };

  const acc = lib.data.account;
  const days = acc && acc.expires ? Math.ceil((acc.expires - Date.now()) / 864e5) : null;

  v.innerHTML = `
    ${hero ? `<section class="billboard" id="bb"></section>` : '<div style="height:70px"></div>'}
    ${days !== null && days <= 7 ? `<div class="expiry ${days <= 0 ? 'over' : ''}">${icon('info')} ${days > 0 ? `ينتهي اشتراكك بعد ${days} ${days === 1 ? 'يوم' : 'أيام'}` : 'انتهى اشتراكك — جدّده لدى مزوّدك'}</div>` : ''}
    ${row(`متابعة المشاهدة`, cont, { render: cwCard })}
    ${row('أفضل 10 أفلام اليوم', top, { cls: 'top-row', render: (i, n) => `<div class="rank"><span class="num">${n + 1}</span>${card(i)}</div>` })}
    ${row('قائمتي', myList)}
    ${row('قنواتك', myLive, { more: 'data-go="live"' })}
    ${row('أُضيف حديثًا', latestMovies, { more: 'data-go="movie"' })}
    ${row('مسلسلات جديدة', latestSeries, { more: 'data-go="series"' })}
    ${lastVod ? row(`لأنك شاهدت ${lastVod.title || lastVod.name}`, because) : ''}
    ${row('بث مباشر الآن', liveNow, { more: 'data-go="live"' })}
    ${catRows('movie', movies, 4)}
    ${row('مسلسلات بتقييم عالٍ', sortItems(series.filter((s) => s.rating), 'rating').slice(0, 20), { more: 'data-go="series"' })}
    ${catRows('series', series, 3)}
    ${!live.length && !movies.length && !series.length ? '<p class="empty">لا يوجد محتوى في هذا الاشتراك.</p>' : ''}`;
  if (hero) paintBillboard(hero);
  if (document.body.classList.contains('tv')) setTimeout(() => { const f = $('#bb [data-bb=play]') || $('#view .card-item'); if (f && !player.isOpen && $('#detail').hidden) f.focus({ preventScroll: true }); }, 50);
  bindOpen(v);
  v.querySelectorAll('[data-resume]').forEach((b) => b.addEventListener('click', () => resume(b.dataset.resume)));
  v.querySelectorAll('[data-cwinfo]').forEach((b) => b.addEventListener('click', () => openDetail(lib.byId.get(b.dataset.cwinfo))));
  v.querySelectorAll('[data-cwmenu]').forEach((b) => b.addEventListener('click', () => cwMenu(b.dataset.cwmenu)));
  v.querySelectorAll('[data-cat-go]').forEach((b) => b.addEventListener('click', () => {
    const [kind, cat] = b.dataset.catGo.split('|');
    viewState[kind].cat = cat; viewState[kind].q = '';
    go(kind);
  }));
  v.onclick = (e) => {
    const b = e.target.closest('[data-bb]');
    if (!b) return;
    const it = lib.byId.get(b.dataset.id);
    if (!it) return;
    if (b.dataset.bb === 'play') openDetail(it, { autoplay: true });
    if (b.dataset.bb === 'info') openDetail(it);
    if (b.dataset.bb === 'fav') lib.toggleFav(it.id).then((on) => { toast(on ? 'أُضيف إلى قائمتي' : 'أُزيل من قائمتي'); b.innerHTML = `${icon(on ? 'check' : 'plus')} قائمتي`; });
  };
}

/** على التلفاز والشاشات العريضة: اللوحة تعرض العنصر المحدد بالريموت. */
let bbTimer = null;
function onHomeFocus(e) {
  if (route !== 'home') return;
  const c = e.target.closest && e.target.closest('.poster[data-open]');
  if (!c || !$('#bb') || !matchMedia('(min-width:600px)').matches || !c.matches(':focus-visible')) return;
  clearTimeout(bbTimer);
  bbTimer = setTimeout(() => {
    const it = lib.byId.get(c.dataset.open);
    if (it && $('#bb') && $('#bb').dataset.id !== it.id) paintBillboard(it, true);
  }, 350);
}

function cwCard(h) {
  const pct = h.dur ? Math.min(100, (h.pos / h.dur) * 100) : 0;
  const left = fmtDur((h.dur - h.pos) / 60);
  return `<div class="cw">
    <button class="card-item poster" data-resume="${esc(h.id)}" aria-label="متابعة ${esc(h.name)}">${art(h.logo, h.name, 'cover')}<span class="play">${icon('play')}</span></button>
    <i class="pb"><i style="width:${pct}%"></i></i>
    <div class="cw-bar"><button class="icon-btn" data-cwinfo="${esc(h.seriesId || h.id)}" aria-label="التفاصيل">${icon('info')}</button>
      <small>${h.ep ? `م${h.ep.season}:ح${h.ep.episode}` : left ? `${left}` : ''}</small>
      <button class="icon-btn" data-cwmenu="${esc(h.id)}" aria-label="خيارات">${icon('list')}</button></div></div>`;
}

async function cwMenu(id) {
  const h = lib.user.history.find((x) => x.id === id);
  if (!h) return;
  const v = await choose(h.name, [
    { label: 'متابعة المشاهدة', value: 'play', icon: 'play' },
    { label: 'التفاصيل', value: 'info', icon: 'info' },
    { label: 'إزالة من «متابعة المشاهدة»', value: 'rm', icon: 'trash', danger: true },
  ]);
  if (v === 'play') resume(id);
  if (v === 'info') openDetail(lib.byId.get(h.seriesId || h.id));
  if (v === 'rm') {
    lib.user.history = lib.user.history.filter((x) => (h.seriesId ? x.seriesId !== h.seriesId : x.id !== id));
    await lib.saveUser();
    render();
  }
}

async function resume(id) {
  const h = lib.user.history.find((x) => x.id === id);
  if (!h) return;
  if (h.ep && h.seriesId) {
    const s = lib.byId.get(h.seriesId);
    if (!s) return;
    const info = await seriesInfo(s).catch(() => null);
    const ep = (info && info.seasons.flatMap((x) => x.episodes).find((e) => e.id === h.ep.id)) || h.ep;
    player.open({ item: ep, kind: 'episode', series: { item: s, info } });
    return;
  }
  const it = lib.byId.get(id);
  if (it) player.open({ item: it, kind: it.kind });
}

function bindOpen(root) {
  root.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
    const it = lib.byId.get(b.dataset.open);
    if (!it) return;
    if (it.kind === 'live') playLive(it, null);
    else openDetail(it);
  }));
}

function playLive(item, list) {
  const l = list || filterItems(lib.data.items, { kind: 'live', cat: item.cat, sort: viewState.live.sort, blockedCats: blocked('live') });
  const index = l.findIndex((i) => i.id === item.id);
  player.open({ item, kind: 'live', list: l, index: index < 0 ? 0 : index });
}

// ———————————————————————————— الأقسام المشتركة (مباشر / أفلام / مسلسلات)

const PAGE_TITLE = { live: 'مباشر', movie: 'أفلام', series: 'مسلسلات' };

function catsFor(kind) {
  const counts = countByCat(lib.data.items, kind);
  const bl = blocked(kind);
  const total = [...counts.entries()].filter(([c]) => !bl.has(c)).reduce((a, [, n]) => a + n, 0);
  const favN = lib.data.items.filter((i) => i.kind === kind && lib.isFav(i.id)).length;
  const recN = recentFor(kind).length;
  return [
    { id: 'all', name: kind === 'live' ? 'كل القنوات' : 'كل الفئات', n: total },
    ...(favN ? [{ id: 'fav', name: kind === 'live' ? 'المفضلة' : 'قائمتي', n: favN, icon: 'heart-f' }] : []),
    ...(recN ? [{ id: 'recent', name: 'شوهد مؤخرًا', n: recN, icon: 'clock' }] : []),
    ...lib.cats(kind).map((c) => ({ ...c, n: counts.get(c.id) || 0, locked: bl.has(c.id) })).filter((c) => c.n || c.lazy),
  ];
}

function catList(kind, st) {
  return catsFor(kind).map((c) => `<button class="cat ${st.cat === c.id ? 'on' : ''} ${c.locked ? 'locked' : ''}" data-cat="${esc(c.id)}">
    ${c.icon ? icon(c.icon) : ''}${c.locked ? icon('lock') : ''}<span>${esc(c.name)}</span>${c.n ? `<small>${c.n.toLocaleString('ar')}</small>` : ''}</button>`).join('');
}

function pageHead(kind, st) {
  const cur = catsFor(kind).find((c) => c.id === st.cat) || catsFor(kind)[0];
  return `<div class="page-head"><h1>${PAGE_TITLE[kind]}</h1>
    <button class="cat-btn" data-catpick><span>${esc(cur.name)}</span>${icon('down')}</button></div>`;
}

function toolbar(kind, st) {
  return `<div class="toolbar">
    <label class="search-box">${icon('search')}<input type="search" placeholder="ابحث في ${KIND_LABEL[kind]}…" value="${esc(st.q)}" data-q /></label>
    <button class="btn glass sm" data-sort>${icon('list')}<span>${SORTS[st.sort].label}</span></button>
    ${kind === 'live' ? `<button class="icon-btn" data-viewmode aria-label="طريقة العرض">${icon(settings.liveView === 'grid' ? 'list' : 'grid')}</button>` : ''}
  </div>`;
}

function sortsFor(kind) { return kind === 'live' ? ['default', 'num', 'az', 'za'] : ['added', 'az', 'za', 'rating', 'year', 'default']; }

/** اختيار قسم (من القائمة الجانبية أو نافذة الفئات). */
async function selectCat(kind, st, catId, rerender) {
  const cat = catsFor(kind).find((c) => c.id === catId);
  if (cat && cat.locked && !(await askPin())) return;
  st.cat = catId;
  if (cat && cat.locked) { render(); return; }
  $$('#cats .cat').forEach((x) => x.classList.toggle('on', x.dataset.cat === catId));
  const btn = $('[data-catpick] span');
  if (btn && cat) btn.textContent = cat.name;
  if (kind !== 'live') {
    $('#list').innerHTML = '<div class="p-loading"><i class="spin"></i></div>';
    try { await lib.ensureCategory(kind, st.cat); } catch (err) { toast(err.message); }
  }
  rerender();
  $('#view').scrollTop = 0;
  $('.pane') && ($('.pane').scrollTop = 0);
}

/** نافذة الفئات بملء الشاشة على الهاتف (بأسلوب نتفليكس). */
function openCatsSheet(kind, st, rerender) {
  const cats = catsFor(kind);
  const card = openSheet(`<div class="opts">${cats.map((c, i) => `<button class="opt ${st.cat === c.id ? 'on' : ''}" data-i="${i}"><span>${c.locked ? '🔒 ' : ''}${esc(c.name)}</span></button>`).join('')}</div>
    <button class="cats-close" data-close aria-label="إغلاق">${icon('close')}</button>`, { cls: 'cats-sheet' });
  card.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => { closeSheet(); selectCat(kind, st, cats[Number(b.dataset.i)].id, rerender); }));
  card.querySelector('[data-close]').addEventListener('click', () => closeSheet());
  const on = card.querySelector('.opt.on');
  if (on) setTimeout(() => on.scrollIntoView({ block: 'center' }), 30);
}

function bindCats(kind, st, rerender) {
  const cats = $('#cats');
  cats.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (b) selectCat(kind, st, b.dataset.cat, rerender);
  });
  bindLongPress(cats, '[data-cat]', (b) => catMenu(kind, b.dataset.cat));
  $('[data-catpick]').addEventListener('click', () => openCatsSheet(kind, st, rerender));
  const q = $('[data-q]');
  let t = null;
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { st.q = q.value; rerender(); }, 220); });
  $('[data-sort]').addEventListener('click', async () => {
    const s = await choose('الترتيب', sortsFor(kind).map((k) => ({ label: SORTS[k].label, value: k, active: st.sort === k })));
    if (s) { st.sort = s; $('[data-sort] span').textContent = SORTS[s].label; rerender(); }
  });
  const vm = $('[data-viewmode]');
  if (vm) vm.addEventListener('click', () => { settings.liveView = settings.liveView === 'grid' ? 'list' : 'grid'; saveSettings(); render(); });
}

// ———————————————————————————— القنوات المباشرة

function renderLive() {
  const st = viewState.live;
  const v = $('#view');
  v.innerHTML = `${pageHead('live', st)}<div class="split">
    <aside class="cats" id="cats">${catList('live', st)}</aside>
    <section class="pane">${toolbar('live', st)}<div class="${settings.liveView === 'grid' ? 'grid tiles-grid' : 'ch-list'}" id="list"></div></section>
    <aside class="preview" id="preview"></aside></div>`;
  bindCats('live', st, renderLiveList);
  renderLiveList();
}

const epgCache = new Map();
async function epgFor(item) {
  const c = epgCache.get(item.id);
  if (c && Date.now() - c.at < 10 * 60000) return c.list;
  const list = await lib.programmes(item).catch(() => []);
  epgCache.set(item.id, { at: Date.now(), list });
  return list;
}

/** معرّفات «شوهد مؤخرًا» لنوع؛ الحلقات تُنسب إلى مسلسلها. */
function recentFor(kind) {
  if (kind !== 'series') return lib.recentIds(kind);
  return [...new Set(lib.user.history.filter((h) => h.seriesId).map((h) => h.seriesId))];
}

/** لوحة المعاينة: شعار القناة وجدول برامجها (للشاشات العريضة ووضع الكتاب). */
async function paintPreview(it) {
  const box = $('#preview');
  if (!box || !it || getComputedStyle(box).display === 'none') return;
  if (box.dataset.id === it.id) return;
  box.dataset.id = it.id;
  const cat = lib.catById('live', it.cat);
  box.innerHTML = `<div class="pv-logo">${art(it.logo, it.name, 'logo')}<span class="badge live-badge">مباشر</span></div>
    <div class="pv-name">${it.num ? `<span class="muted">${it.num} · </span>` : ''}${esc(it.name)}</div>
    <div class="pv-sub">${esc(cat ? cat.name : '')}${it.catchup ? ' · يدعم الأرشيف' : ''}</div>
    <div class="pv-list"><div class="p-loading"><i class="spin"></i></div></div>`;
  const list = await epgFor(it);
  if (box.dataset.id !== it.id) return;
  const now = Date.now();
  const upcoming = list.filter((p) => p.end > now).slice(0, 8);
  $('.pv-list', box).innerHTML = upcoming.length ? upcoming.map((p) => {
    const isNow = p.start <= now;
    return `<div class="pv-prog ${isNow ? 'now' : ''}"><span class="tm">${isNow ? 'الآن' : clock(p.start)}</span><b>${esc(p.title)}</b>
      ${isNow ? `<i class="pb"><i style="width:${progress(p) * 100}%"></i></i>` : ''}${p.desc ? `<p>${esc(p.desc)}</p>` : ''}</div>`;
  }).join('') : '<p class="muted sm">لا يتوفر دليل برامج لهذه القناة.</p>';
}

function renderLiveList() {
  const st = viewState.live;
  const list = filterItems(lib.data.items, { kind: 'live', cat: st.cat, query: st.q, sort: st.sort, favs: lib.favSet(), recent: recentFor('live'), blockedCats: blocked('live') });
  const box = $('#list');
  const grid = settings.liveView === 'grid';
  const one = grid
    ? (it) => `<button class="card-item ch-tile" data-ch="${esc(it.id)}">${art(it.logo, it.name, 'logo')}<span class="live-dot">${it.num || 'مباشر'}</span>${lib.isFav(it.id) ? icon('heart-f', 'fav') : ''}<b>${esc(it.name)}</b></button>`
    : (it) => `<button class="ch" data-ch="${esc(it.id)}">
      <span class="num">${it.num || ''}</span>${art(it.logo, it.name, 'logo')}
      <span class="meta"><b>${esc(it.name)}</b><span class="now"></span><i class="pb"><i></i></i></span>
      ${it.catchup ? `<span class="tag">${icon('archive')}</span>` : ''}${lib.isFav(it.id) ? icon('heart-f', 'fav') : ''}</button>`;
  stopView.push(renderChunks(box, list, one, { empty: `<p class="empty">${st.q ? 'لا نتائج مطابقة.' : 'لا توجد قنوات هنا.'}</p>` }));
  box.onclick = (e) => {
    const b = e.target.closest('[data-ch]');
    if (b) playLive(lib.byId.get(b.dataset.ch), list);
  };
  let pt = null;
  const preview = (e) => {
    const b = e.target.closest('[data-ch]');
    if (!b) return;
    clearTimeout(pt);
    pt = setTimeout(() => {
      $$('#list .ch.sel').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      paintPreview(lib.byId.get(b.dataset.ch));
    }, 180);
  };
  box.addEventListener('focusin', preview);
  box.addEventListener('pointerover', preview);
  if (list[0]) paintPreview(list[0]);
  bindLongPress(box, '[data-ch]', (b) => itemMenu(lib.byId.get(b.dataset.ch)));
  if (!grid) {
    stopView.push(lazyEach(box, '[data-ch]', async (el) => {
      const it = lib.byId.get(el.dataset.ch);
      const { now } = nowNext(await epgFor(it));
      if (!now || !el.isConnected) return;
      $('.now', el).textContent = `${clock(now.start)} ${now.title}`;
      $('.pb i', el).style.width = `${progress(now) * 100}%`;
      el.classList.add('has-epg');
    }, { concurrency: 4 }));
  }
}

function bindLongPress(root, sel, fn) {
  let timer = null; let fired = false;
  root.addEventListener('pointerdown', (e) => {
    const b = e.target.closest(sel);
    if (!b) return;
    fired = false;
    timer = setTimeout(() => { fired = true; fn(b); }, 550);
  });
  ['pointerup', 'pointercancel', 'pointerleave', 'scroll'].forEach((ev) => root.addEventListener(ev, () => clearTimeout(timer), true));
  root.addEventListener('click', (e) => { if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; } }, true);
  root.addEventListener('contextmenu', (e) => { const b = e.target.closest(sel); if (b) { e.preventDefault(); clearTimeout(timer); fn(b); } });
}

async function itemMenu(it) {
  if (!it) return;
  const fav = lib.isFav(it.id);
  const listName = it.kind === 'live' ? 'المفضلة' : 'قائمتي';
  const opts = [
    { label: it.kind === 'live' ? 'تشغيل' : 'التفاصيل', value: 'open', icon: 'play' },
    { label: fav ? `إزالة من ${listName}` : `إضافة إلى ${listName}`, value: 'fav', icon: fav ? 'check' : 'plus' },
    { label: 'فتح في مشغل خارجي', value: 'ext', icon: 'ext' },
    { label: 'قفل هذا القسم', value: 'lock', icon: 'lock' },
  ];
  const v = await choose(it.name, opts);
  if (v === 'open') { if (it.kind === 'live') playLive(it); else openDetail(it); }
  if (v === 'fav') { const on = await lib.toggleFav(it.id); toast(on ? `أُضيف إلى ${listName}` : `أُزيل من ${listName}`); render(); }
  if (v === 'ext') { const url = await lib.streamUrl(it).catch(() => ''); if (url) openExternal(url, it.name, (lib.headersFor(it) || {}).ua); }
  if (v === 'lock') toggleLock(it.cat);
}

async function catMenu(kind, catId) {
  if (['all', 'fav', 'recent'].includes(catId)) return;
  const locked = lib.user.lockedCats.includes(catId);
  const v = await choose(lib.catById(kind, catId)?.name || '', [{ label: locked ? 'إلغاء قفل القسم' : 'قفل القسم (يتطلب الرمز)', value: 'lock', icon: 'lock' }]);
  if (v === 'lock') toggleLock(catId);
}

async function toggleLock(catId) {
  const locked = lib.user.lockedCats.includes(catId);
  if (locked && !(await askPin())) return;
  if (!locked && !settings.pin) {
    const pin = await promptBox('عيّن رمز قفل (4 أرقام أو أكثر)', { type: 'password' });
    if (!pin || pin.length < 4) { if (pin !== null) toast('الرمز قصير'); return; }
    settings.pin = pin; saveSettings();
  }
  lib.user.lockedCats = locked ? lib.user.lockedCats.filter((c) => c !== catId) : [...lib.user.lockedCats, catId];
  await lib.saveUser();
  toast(locked ? 'أُلغي القفل' : 'قُفل القسم');
  render();
}

// ———————————————————————————— الأفلام والمسلسلات

function renderVod(kind) {
  const st = viewState[kind];
  const v = $('#view');
  v.innerHTML = `${pageHead(kind, st)}<div class="split vod">
    <aside class="cats" id="cats">${catList(kind, st)}</aside>
    <section class="pane">${toolbar(kind, st)}<div class="grid posters" id="list"></div></section></div>`;
  bindCats(kind, st, () => renderVodList(kind));
  renderVodList(kind);
}

function renderVodList(kind) {
  const st = viewState[kind];
  const list = filterItems(lib.data.items, { kind, cat: st.cat, query: st.q, sort: st.sort, favs: lib.favSet(), recent: recentFor(kind), blockedCats: blocked(kind) });
  const box = $('#list');
  const hist = new Map(lib.user.history.map((h) => [h.seriesId || h.id, h]));
  stopView.push(renderChunks(box, list, (it) => {
    const h = hist.get(it.id);
    const pct = h && h.dur && !h.done ? Math.min(100, (h.pos / h.dur) * 100) : 0;
    return card(it, { progressPct: pct });
  }, { empty: `<p class="empty">${st.q ? 'لا نتائج مطابقة.' : 'لا يوجد محتوى هنا.'}</p>`, chunk: 48 }));
  box.onclick = (e) => {
    const b = e.target.closest('[data-open]');
    if (b) openDetail(lib.byId.get(b.dataset.open));
  };
  bindLongPress(box, '[data-open]', (b) => itemMenu(lib.byId.get(b.dataset.open)));
  if (settings.tmdbKey) {
    stopView.push(lazyEach(box, '.poster', async (el) => {
      const it = lib.byId.get(el.dataset.open);
      if (!it || it.logo) return;
      const meta = await enrich(settings.tmdbKey, it.kind, it.title || it.name, it.year, settings.tmdbLang);
      if (!meta || !meta.poster || !el.isConnected) return;
      it.logo = meta.poster;
      el.querySelector('.art').insertAdjacentHTML('beforeend', `<img src="${esc(meta.poster)}" alt="" loading="lazy" onerror="this.remove()" />`);
    }, { concurrency: 2 }));
  }
}

// ———————————————————————————— صفحة التفاصيل

const infoCache = new Map();
async function seriesInfo(item) {
  if (infoCache.has(item.id)) return infoCache.get(item.id);
  const info = await lib.provider.seriesInfo(lib.pl, item);
  infoCache.set(item.id, info);
  return info;
}

function closeDetail() {
  detailRepaint = null;
  if (route === 'home') render();
  $('#detail').hidden = true;
  $('#detail').innerHTML = '';
  const last = $('#view [data-open].last-open');
  if (last) last.focus({ preventScroll: true });
}

async function openDetail(item, { autoplay = false } = {}) {
  if (!item) return;
  $$('#view .last-open').forEach((x) => x.classList.remove('last-open'));
  const src = $(`#view [data-open="${CSS.escape(item.id)}"]`);
  if (src) src.classList.add('last-open');
  const d = $('#detail');
  d.hidden = false;
  d.scrollTop = 0;
  const isSeries = item.kind === 'series';
  let tab = isSeries ? 'eps' : 'similar';
  const paint = (info = {}) => {
    const name = item.title || item.name;
    const poster = item.logo || info.poster || '';
    const backdrop = info.backdrop || item.backdrop || '';
    const year = item.year || info.year;
    const rating = Number(info.rating || item.rating || 0);
    const dur = info.duration;
    const prog = !isSeries && lib.progressOf(item.id);
    const resumeAt = prog && !prog.done && prog.pos > 30 ? prog.pos : 0;
    const last = isSeries && lib.user.history.find((h) => h.seriesId === item.id);
    const fav = lib.isFav(item.id);
    const nSeasons = info.seasons ? info.seasons.length : 0;
    const playLabel = isSeries
      ? (last && last.ep ? `متابعة م${last.ep.season}:ح${last.ep.episode}` : 'تشغيل')
      : (resumeAt ? 'استئناف' : 'تشغيل');
    const meta = [
      rating ? `<span class="match">${Math.round(rating * 10)}% تقييم</span>` : '',
      year ? `<span>${year}</span>` : '',
      isSeries && nSeasons ? `<span>${nSeasons} ${nSeasons === 1 ? 'موسم' : nSeasons === 2 ? 'موسمان' : 'مواسم'}</span>` : '',
      dur ? `<span>${fmtDur(dur)}</span>` : '',
      `<span class="box">${esc(item.quality || 'HD')}</span>`,
      rating ? `<span class="star">${icon('star')} ${rating.toFixed(1)}</span>` : '',
    ].join('');
    d.innerHTML = `
      <button class="icon-btn d-back" data-d="back" aria-label="رجوع">${icon('back')}</button>
      <div class="d-hero ${backdrop ? '' : 'no-backdrop'}">
        <div class="d-img" style="--img:url('${esc(backdrop || poster)}')"></div>
        ${backdrop ? '' : `<div class="d-mini">${art(poster, name, 'cover')}</div>`}
        <button class="d-playover" data-d="${isSeries ? 'playSeries' : 'play'}" aria-label="تشغيل">${icon('play')}</button>
      </div>
      <div class="d-body">
        <div class="d-poster">${art(poster, name, 'cover')}</div>
        <h1 class="d-title">${esc(name)}</h1>
        <div class="d-meta">${meta}</div>
        <div class="d-btns">
          <button class="btn white big" data-d="${isSeries ? 'playSeries' : 'play'}">${icon('play')} ${playLabel}</button>
          ${resumeAt ? `<button class="btn gray big" data-d="restart">${icon('refresh')} من البداية</button>` : ''}
        </div>
        ${resumeAt && prog.dur ? `<div class="d-resume"><i class="pb"><i style="width:${Math.min(100, (prog.pos / prog.dur) * 100)}%"></i></i><small>متبقٍ ${fmtDur((prog.dur - prog.pos) / 60)}</small></div>` : ''}
        ${info.plot || item.plot ? `<p class="d-plot">${esc(info.plot || item.plot)}</p>` : ''}
        ${info.cast || item.cast ? `<div class="d-cast"><span>بطولة:</span>${esc(info.cast || item.cast)}</div>` : ''}
        ${info.director ? `<div class="d-cast"><span>إخراج:</span>${esc(info.director)}</div>` : ''}
        ${info.genre || item.genre ? `<div class="d-cast"><span>النوع:</span>${esc(info.genre || item.genre)}</div>` : ''}
        <div class="d-acts">
          <button class="act ${fav ? 'on' : ''}" data-d="fav">${icon(fav ? 'check' : 'plus')}<span>قائمتي</span></button>
          ${info.trailer ? `<button class="act" data-d="trailer">${icon('yt')}<span>الإعلان</span></button>` : ''}
          ${!isSeries ? `<button class="act" data-d="ext">${icon('ext')}<span>مشغل خارجي</span></button>` : ''}
        </div>
      </div>
      <section class="d-panel">
        <div class="d-tabs">${isSeries ? `<button data-tab="eps" class="${tab === 'eps' ? 'on' : ''}">الحلقات</button>` : ''}<button data-tab="similar" class="${tab === 'similar' ? 'on' : ''}">أعمال مشابهة</button></div>
        <div id="dTab"></div>
      </section>`;
    d.querySelector('.d-btns .btn')?.focus({ preventScroll: true });
    d.onclick = async (e) => {
      const t = e.target.closest('[data-tab]');
      if (t) { tab = t.dataset.tab; d.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === t)); paintTab(item, info, tab); return; }
      const b = e.target.closest('[data-d]');
      if (!b) return;
      const a = b.dataset.d;
      if (a === 'back') closeDetail();
      if (a === 'play') player.open({ item: { ...item, ext: info.ext || item.ext }, kind: 'movie' });
      if (a === 'restart') player.open({ item: { ...item, ext: info.ext || item.ext }, kind: 'movie', start: 1 });
      if (a === 'fav') { const on = await lib.toggleFav(item.id); toast(on ? 'أُضيف إلى قائمتي' : 'أُزيل من قائمتي'); b.classList.toggle('on', on); b.innerHTML = `${icon(on ? 'check' : 'plus')}<span>قائمتي</span>`; }
      if (a === 'trailer') openExternal(`https://www.youtube.com/watch?v=${encodeURIComponent(info.trailer)}`, 'trailer');
      if (a === 'ext' && !isSeries) { const url = await lib.streamUrl({ ...item, ext: info.ext || item.ext }).catch(() => ''); if (url) openExternal(url, item.name, (lib.headersFor(item) || {}).ua); }
      if (a === 'playSeries') { if (info.seasons) playSeriesFrom(item, info); else toast('جارٍ تحميل الحلقات…'); }
    };
    paintTab(item, info, tab);
  };
  paint({});
  let info = {};
  try {
    info = isSeries ? await seriesInfo(item) : await lib.provider.movieInfo(lib.pl, item);
  } catch (e) { if (isSeries) info = { seasons: [], error: e.message }; }
  if (settings.tmdbKey && (!info.plot || !(item.logo || info.poster))) {
    const meta = await enrich(settings.tmdbKey, item.kind, item.title || item.name, item.year, settings.tmdbLang);
    if (meta) {
      info = { ...meta, ...Object.fromEntries(Object.entries(info).filter(([, v]) => v && (!Array.isArray(v) || v.length))) };
      if (!item.logo && meta.poster) item.logo = meta.poster;
    }
  }
  if ($('#detail').hidden) return;
  paint(info);
  detailRepaint = () => paint(info);
  if (autoplay) {
    if (isSeries) { if (info.seasons && info.seasons.length) playSeriesFrom(item, info); } else player.open({ item: { ...item, ext: info.ext || item.ext }, kind: 'movie' });
  }
}

function paintTab(item, info, tab) {
  const box = $('#dTab');
  if (!box) return;
  if (tab === 'similar') {
    const sim = sortItems(lib.data.items.filter((i) => i.kind === item.kind && i.cat === item.cat && i.id !== item.id && !blocked(item.kind).has(i.cat)), 'rating').slice(0, 18);
    box.innerHTML = sim.length ? `<div class="similar">${sim.map((i) => card(i)).join('')}</div>` : '<p class="empty">لا توجد أعمال مشابهة.</p>';
    box.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openDetail(lib.byId.get(b.dataset.open))));
    return;
  }
  if (!info.seasons) { box.innerHTML = '<div class="p-loading"><i class="spin"></i></div>'; return; }
  paintSeasons(item, info, box);
}

function playSeriesFrom(item, info) {
  if (!info.seasons || !info.seasons.length) { toast('لا توجد حلقات'); return; }
  const flat = info.seasons.flatMap((s) => s.episodes);
  const last = lib.user.history.find((h) => h.seriesId === item.id);
  let ep = flat[0];
  if (last) {
    const i = flat.findIndex((e) => e.id === last.id);
    if (i >= 0) ep = last.done && flat[i + 1] ? flat[i + 1] : flat[i];
  }
  player.open({ item: ep, kind: 'episode', series: { item, info } });
}

function paintSeasons(item, info, box) {
  if (!info.seasons.length) { box.innerHTML = `<p class="empty">${esc(info.error || 'لا توجد حلقات متاحة.')}</p>`; return; }
  const last = lib.user.history.find((h) => h.seriesId === item.id);
  let cur = (last && last.ep && last.ep.season) || info.seasons[0].num;
  const draw = () => {
    const season = info.seasons.find((s) => s.num === cur) || info.seasons[0];
    box.innerHTML = `<button class="season-btn" data-season-pick>${esc(season.name)} ${icon('down')}</button>
      <div class="eps">${season.episodes.map((e) => {
    const h = lib.progressOf(e.id);
    const pct = h && h.dur ? Math.min(100, (h.pos / h.dur) * 100) : 0;
    const title = e.title && !/^الحلقة\s*\d+$/.test(e.title) ? e.title : `الحلقة ${e.episode}`;
    return `<button class="ep ${h && h.done ? 'done' : ''}" data-ep="${esc(e.id)}">
          ${art(e.img || season.cover || item.logo, `${e.episode}`, 'thumb')}<span class="ep-play">${icon('play')}</span>
          <span class="ep-meta"><b>${e.episode}. ${esc(title)}</b>${e.duration ? `<small>${fmtDur(e.duration)}</small>` : ''}</span>
          ${h && h.done ? icon('check', 'seen') : '<span></span>'}
          ${e.plot ? `<p class="pl">${esc(e.plot)}</p>` : ''}
          ${pct ? `<i class="pb"><i style="width:${pct}%"></i></i>` : ''}</button>`;
  }).join('')}</div>`;
    box.querySelector('[data-season-pick]').addEventListener('click', async () => {
      if (info.seasons.length < 2) return;
      const v = await choose('المواسم', info.seasons.map((s) => ({ label: s.name, hint: `${s.episodes.length} حلقة`, value: String(s.num), active: s.num === season.num })));
      if (v) { cur = Number(v); draw(); }
    });
    box.querySelectorAll('[data-ep]').forEach((b) => b.addEventListener('click', () => {
      const ep = season.episodes.find((x) => x.id === b.dataset.ep);
      player.open({ item: ep, kind: 'episode', series: { item, info } });
    }));
  };
  draw();
}

// ———————————————————————————— البحث

function renderSearch() {
  const st = viewState.search;
  const v = $('#view');
  v.innerHTML = `<div class="search-page"><label class="search-box big">${icon('search')}<input type="search" placeholder="ابحث عن قناة أو فيلم أو مسلسل…" value="${esc(st.q)}" data-q autofocus /></label><div id="results"></div></div>`;
  const q = $('[data-q]');
  let t = null;
  const run = () => {
    st.q = q.value;
    const box = $('#results');
    const query = norm(st.q);
    if (query.length < 2) { box.innerHTML = '<p class="empty">اكتب حرفين على الأقل. البحث يتجاهل الهمزات والتشكيل.</p>'; return; }
    const sec = (kind) => {
      const list = filterItems(lib.data.items, { kind, query: st.q, sort: kind === 'live' ? 'default' : 'added', blockedCats: blocked(kind) });
      if (!list.length) return '';
      return `<section class="row-sec"><div class="row-head"><h2>${KIND_LABEL[kind]} <small>${list.length.toLocaleString('ar')}</small></h2>${list.length > 30 ? `<button class="link" data-all="${kind}">عرض الكل ${icon('chev')}</button>` : ''}</div>
        <div class="grid ${kind === 'live' ? 'tiles-grid' : 'posters'}">${list.slice(0, 30).map((i) => card(i)).join('')}</div></section>`;
    };
    box.innerHTML = (sec('live') + sec('movie') + sec('series')) || '<p class="empty">لا نتائج.</p>';
    bindOpen(box);
    box.querySelectorAll('[data-all]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.all;
      viewState[k].q = st.q; viewState[k].cat = 'all';
      go(k);
    }));
  };
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 250); });
  run();
  setTimeout(() => q.focus(), 50);
}

// ———————————————————————————— الإعدادات

function renderSettings() {
  const v = $('#view');
  const acc = lib.data.account;
  const d = lib.data;
  const n = (k) => d.items.filter((i) => i.kind === k).length.toLocaleString('ar');
  const opt = (key, val, label) => `<button data-set="${key}" data-val="${val}" class="${String(settings[key]) === String(val) ? 'on' : ''}">${label}</button>`;
  const tog = (key, label, hint = '') => `<button class="set-row toggle ${settings[key] ? 'on' : ''}" data-toggle="${key}"><span>${label}${hint ? `<small>${hint}</small>` : ''}</span><i class="sw"></i></button>`;
  v.innerHTML = `<div class="settings">
    <div class="me-head">${avatar(lib.pl)}<b>${esc(lib.pl.name)}</b><button class="btn outline sm" data-switch>تبديل الاشتراك</button></div>
    <section class="set-card">
      <h2>الاشتراكات</h2>
      ${lib.playlists.map((p) => `<div class="pl-row ${p.id === lib.pl.id ? 'on' : ''}">
        <div><b>${esc(p.name)}</b><small>${providers[p.type].label}${p.id === lib.pl.id ? ' · نشط' : ''}</small></div>
        ${p.id !== lib.pl.id ? `<button class="btn glass sm" data-pl="use" data-id="${p.id}">تفعيل</button>` : `<button class="btn glass sm" data-pl="refresh" data-id="${p.id}">${icon('refresh')} تحديث</button>`}
        <button class="icon-btn danger" data-pl="del" data-id="${p.id}" aria-label="حذف">${icon('trash')}</button></div>`).join('')}
      <button class="btn primary" data-pl="add">${icon('plus')} إضافة اشتراك</button>
    </section>

    <section class="set-card">
      <h2>الحساب</h2>
      ${acc && acc.expires ? `<div class="kv"><span>ينتهي في</span><b>${new Date(acc.expires).toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' })}</b></div>` : ''}
      ${acc && acc.status ? `<div class="kv"><span>الحالة</span><b>${esc(acc.status)}${acc.trial ? ' (تجريبي)' : ''}</b></div>` : ''}
      ${acc && acc.maxConnections ? `<div class="kv"><span>الاتصالات</span><b>${acc.activeConnections ?? 0} / ${acc.maxConnections}</b></div>` : ''}
      <div class="kv"><span>المحتوى</span><b>${n('live')} قناة · ${n('movie')} فيلم · ${n('series')} مسلسل</b></div>
      <div class="kv"><span>آخر تحديث</span><b>${d.loadedAt ? new Date(d.loadedAt).toLocaleString('ar') : '—'}</b></div>
    </section>

    <section class="set-card">
      <h2>المشغّل</h2>
      ${lib.pl.type === 'xtream' ? `<div class="set-label">صيغة بث القنوات</div><div class="seg sm wrap">${opt('liveFormat', 'auto', 'تلقائي')}${opt('liveFormat', 'm3u8', 'HLS (m3u8)')}${opt('liveFormat', 'ts', 'MPEG-TS')}</div>` : ''}
      <div class="set-label">محرك التشغيل</div><div class="seg sm wrap">${opt('engine', 'auto', 'تلقائي')}${opt('engine', 'hls', 'HLS')}${opt('engine', 'mpegts', 'MPEG-TS')}${opt('engine', 'native', 'الأصلي')}</div>
      ${tog('autoNext', 'تشغيل الحلقة التالية تلقائيًا')}
      ${tog('landscape', 'تدوير الشاشة أفقيًا عند التشغيل')}
      ${tog('externalAlways', 'التشغيل دائمًا بمشغل خارجي', 'VLC أو MX Player — لصيغ الصوت AC3/DTS ومسارات متعددة')}
      <button class="set-row" data-key="userAgent"><span>User-Agent مخصص<small>${settings.userAgent ? esc(settings.userAgent) : 'افتراضي — غيّره فقط إن رفض مزوّدك التشغيل (مثال: VLC/3.0.20 LibVLC/3.0.20)'}</small></span>${icon('chev')}</button>
    </section>

    <section class="set-card">
      <h2>الترجمة</h2>
      <div class="set-label">اللغة المفضلة</div><div class="seg sm">${opt('subLang', 'ar', 'العربية')}${opt('subLang', 'en', 'English')}</div>
      <button class="set-row" data-key="osKey"><span>مفتاح OpenSubtitles<small>${settings.osKey ? '✓ مضاف' : 'مجاني من opensubtitles.com ← API consumers — للبحث عن ترجمات'}</small></span>${icon('chev')}</button>
    </section>

    <section class="set-card">
      <h2>الصور والمعلومات</h2>
      <button class="set-row" data-key="tmdbKey"><span>مفتاح TMDB<small>${settings.tmdbKey ? '✓ مضاف — تُستكمل الأغلفة والقصص الناقصة' : 'اختياري ومجاني من themoviedb.org — يكمل الأغلفة والقصص لقوائم M3U'}</small></span>${icon('chev')}</button>
      <div class="set-label">لغة المعلومات</div><div class="seg sm">${opt('tmdbLang', 'ar', 'العربية')}${opt('tmdbLang', 'en', 'English')}</div>
    </section>

    <section class="set-card">
      <h2>الرقابة الأبوية</h2>
      ${tog('parental', 'إخفاء أقسام الكبار تلقائيًا', 'تظهر بعد إدخال الرمز لمدة 30 دقيقة')}
      <button class="set-row" data-pin><span>رمز القفل<small>${settings.pin ? '✓ معيَّن' : 'غير معيَّن'}</small></span>${icon('chev')}</button>
      <div class="muted xs">لقفل أي قسم: اضغط عليه مطولًا في قائمة الأقسام.</div>
      ${lib.user.lockedCats.length ? `<button class="set-row" data-unlockall><span>الأقسام المقفلة<small>${lib.user.lockedCats.length} قسم — اضغط لإلغاء قفلها كلها</small></span>${icon('lock')}</button>` : ''}
    </section>

    <section class="set-card">
      <h2>حول</h2>
      <div class="about"><span class="wordmark">LIWA</span><div><b>LiwaIPTV</b><small>الإصدار 1.1.0 · مشغّل فقط ولا يوفّر أي محتوى</small></div></div>
      <button class="set-row" data-clear><span>مسح ذاكرة الصور والأدلة المؤقتة</span>${icon('trash')}</button>
    </section>
  </div>`;

  $('[data-switch]', v).addEventListener('click', () => showProfiles());
  v.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => {
    settings[b.dataset.set] = b.dataset.val; saveSettings();
    if (b.dataset.set === 'liveFormat') { lib.pl.liveFormat = b.dataset.val; lib.savePlaylists(); }
    renderSettings();
  }));
  v.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    const k = b.dataset.toggle;
    if (k === 'parental' && settings.parental && !(await askPin())) return;
    settings[k] = !settings[k]; saveSettings(); renderSettings();
  }));
  v.querySelectorAll('[data-key]').forEach((b) => b.addEventListener('click', async () => {
    const k = b.dataset.key;
    const title = { tmdbKey: 'مفتاح TMDB (v3 أو رمز v4)', osKey: 'مفتاح OpenSubtitles API', userAgent: 'User-Agent (اتركه فارغًا للافتراضي)' }[k];
    const val = await promptBox(title, { value: settings[k], placeholder: k === 'userAgent' ? 'VLC/3.0.20 LibVLC/3.0.20' : 'ألصق المفتاح هنا' });
    if (val === null) return;
    settings[k] = val.trim(); saveSettings();
    if (k === 'userAgent') applyUserAgent();
    renderSettings();
  }));
  $('[data-pin]', v).addEventListener('click', async () => {
    if (settings.pin && !(await askPin())) return;
    const pin = await promptBox('رمز قفل جديد (اتركه فارغًا للإزالة)', { type: 'password' });
    if (pin === null) return;
    if (pin && pin.length < 4) { toast('الرمز قصير — 4 أرقام على الأقل'); return; }
    settings.pin = pin; saveSettings(); toast(pin ? 'عُيّن الرمز' : 'أُزيل الرمز'); renderSettings();
  });
  $('[data-unlockall]', v)?.addEventListener('click', async () => {
    if (!(await askPin())) return;
    lib.user.lockedCats = []; await lib.saveUser(); renderSettings();
  });
  $('[data-clear]', v).addEventListener('click', async () => {
    epgCache.clear(); infoCache.clear();
    await store.remove(`epg:${lib.pl.id}`);
    lib.epg = null;
    toast('تم المسح');
  });
  v.querySelectorAll('[data-pl]').forEach((b) => b.addEventListener('click', async () => {
    const a = b.dataset.pl; const id = b.dataset.id;
    if (a === 'add') openAdd();
    if (a === 'use') { route = 'home'; await activate(id); }
    if (a === 'refresh') { epgCache.clear(); infoCache.clear(); await activate(id, { refresh: true }); toast('تم تحديث المحتوى'); }
    if (a === 'del') {
      const p = lib.playlists.find((x) => x.id === id);
      if (!(await confirmBox(`حذف «${p.name}» وكل مفضلاته وسجلّه؟`, { ok: 'حذف', danger: true }))) return;
      await lib.removePlaylist(id);
      if (!lib.playlists.length) { lib.data = null; showWelcome(); $('#addCancel').hidden = true; return; }
      if (!lib.data) { await activate(lib.pl.id); return; }
      paintAvatars();
      renderSettings();
    }
  }));
}

boot().catch((e) => { console.error(e); hideSplash(); showWelcome(); showAddError(e.message); });
