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
import { esc, fmtDur, fmtTime, clock, norm } from './util.js';
import { $, $$, icon, toast, art, choose, confirmBox, promptBox, closeSheet, sheetOpen, renderChunks, lazyEach, moveFocus, KEYDIR } from './ui.js';

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
  await lib.init();
  applyUserAgent();
  player = new Player({ lib, settings, saveSettings, onClose: afterPlayer });
  bindChrome();
  bindAddForm();
  setInterval(() => { $('#clock').textContent = clock(Date.now()); }, 15000);
  $('#clock').textContent = clock(Date.now());
  if (isNative && await native.isTv()) document.body.classList.add('tv');
  if (!lib.pl) { showWelcome(); return; }
  await activate(lib.pl.id);
}

async function activate(id, { refresh = false } = {}) {
  showWelcome(true);
  setProgress('تحميل المكتبة…');
  try {
    await lib.activate(id, { refresh, onProgress: setProgress });
    // الحد الأدنى لتحديث القائمة: 24 ساعة — يحدَّث في الخلفية دون إيقاف المستخدم
    if (!refresh && Date.now() - (lib.data.loadedAt || 0) > 24 * 3600e3) backgroundRefresh();
  } catch (e) {
    setProgress(null);
    showAddError(e.message);
    $('#addCancel').hidden = lib.playlists.length < 2;
    return;
  }
  setProgress(null);
  showApp();
}

async function backgroundRefresh() {
  const id = lib.pl.id;
  try {
    const data = await providers[lib.pl.type].load(lib.pl);
    data.loadedAt = Date.now();
    await store.set(`lib:${id}`, data);
    if (lib.pl && lib.pl.id === id) { lib.setData(data); if (!player.isOpen && !sheetOpen()) render(); }
  } catch { /* نبقى على النسخة المحفوظة */ }
}

function showWelcome(loading = false) {
  $('#welcome').hidden = false;
  $('#app').hidden = true;
  $('#detail').hidden = true;
  $('#addForm').classList.toggle('loading', loading);
  $('#addErr').hidden = true;
  if (!loading) setTimeout(() => $('#addForm input[name=server]').focus(), 50);
}

function showApp() {
  $('#welcome').hidden = true;
  $('#app').hidden = false;
  $('#addForm').classList.remove('loading');
  $('#plName').textContent = lib.pl.name;
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
  $('#plSwitch').addEventListener('click', switchPlaylist);
  onBack(handleBack);
  document.addEventListener('keydown', onKey);
}

function go(r) {
  route = r;
  $('#detail').hidden = true;
  $$('#nav [data-go]').forEach((b) => b.classList.toggle('on', b.dataset.go === r));
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
    const scope = sheetOpen() ? $('#sheet') : !$('#detail').hidden ? $('#detail') : !$('#welcome').hidden ? $('#welcome') : $('#app');
    if (moveFocus(KEYDIR[e.key], scope)) e.preventDefault();
  }
}

async function switchPlaylist() {
  const opts = lib.playlists.map((p) => ({ label: p.name, hint: providers[p.type].label, value: p.id, active: p.id === lib.pl.id, icon: 'live' }));
  opts.push({ label: 'إضافة اشتراك جديد', value: '+', icon: 'plus' });
  const v = await choose('الاشتراكات', opts);
  if (!v) return;
  if (v === '+') { openAdd(); return; }
  if (v !== lib.pl.id) { route = 'home'; await activate(v); }
}

function openAdd() {
  showWelcome();
  $('#addCancel').hidden = false;
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

function card(item, { progressPct = 0, sub = '' } = {}) {
  const isLive = item.kind === 'live';
  const meta = sub || (isLive ? '' : [item.year, item.rating ? `★ ${Number(item.rating).toFixed(1)}` : ''].filter(Boolean).join(' · '));
  return `<button class="card-item ${isLive ? 'ch-tile' : 'poster'}" data-open="${esc(item.id)}">
    ${art(item.logo, item.title || item.name, isLive ? 'logo' : 'cover')}
    ${item.quality && !isLive ? `<span class="q">${esc(item.quality)}</span>` : ''}
    ${progressPct ? `<i class="pb"><i style="width:${progressPct}%"></i></i>` : ''}
    <b>${esc(item.title || item.name)}</b>${meta ? `<small>${esc(meta)}</small>` : ''}</button>`;
}

function row(title, items, opts = {}) {
  if (!items.length) return '';
  return `<section class="row-sec"><div class="row-head"><h2>${esc(title)}</h2>${opts.more ? `<button class="link" data-go="${opts.more}">عرض الكل ${icon('chev')}</button>` : ''}</div>
    <div class="row-scroll ${opts.cls || ''}">${items.map((i) => (opts.render ? opts.render(i) : card(i))).join('')}</div></section>`;
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
  const latestMovies = sortItems(movies, 'added').slice(0, 24);
  const latestSeries = sortItems(series, 'added').slice(0, 24);
  const topRated = sortItems(movies.filter((m) => m.rating), 'rating').slice(0, 24);
  const hero = [...latestMovies, ...latestSeries].find((i) => i.logo) || null;

  // متابعة المشاهدة: آخر حلقة لكل مسلسل
  const seen = new Set();
  const cont = continueWatching(lib.user.history).filter((h) => {
    const k = h.seriesId || h.id;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 20);

  const favLive = live.filter((i) => favs.has(i.id));
  const recentLive = lib.recentIds('live').map((id) => lib.byId.get(id)).filter(Boolean).slice(0, 20);
  const favVod = [...movies, ...series].filter((i) => favs.has(i.id));
  const acc = lib.data.account;
  const days = acc && acc.expires ? Math.ceil((acc.expires - Date.now()) / 864e5) : null;

  v.innerHTML = `
    ${hero ? `<section class="hero" style="--img:url('${esc(hero.backdrop || hero.logo)}')">
      <div class="hero-in">
        <span class="kicker">${hero.kind === 'movie' ? 'أحدث الأفلام' : 'أحدث المسلسلات'}</span>
        <h1>${esc(hero.title || hero.name)}</h1>
        <div class="meta">${[hero.year, hero.rating ? `★ ${Number(hero.rating).toFixed(1)}` : '', hero.genre].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="row gap"><button class="btn primary" data-open="${esc(hero.id)}">${icon('play')} مشاهدة</button><button class="btn glass" data-open="${esc(hero.id)}" data-info="1">${icon('info')} التفاصيل</button></div>
      </div></section>` : ''}
    <div class="stats">
      <button data-go="live"><b>${live.length.toLocaleString('ar')}</b><span>قناة</span></button>
      <button data-go="movie"><b>${movies.length.toLocaleString('ar')}</b><span>فيلم</span></button>
      <button data-go="series"><b>${series.length.toLocaleString('ar')}</b><span>مسلسل</span></button>
      ${days !== null ? `<button data-go="settings" class="${days < 7 ? 'warn' : ''}"><b>${days > 0 ? days.toLocaleString('ar') : 'منتهٍ'}</b><span>${days > 0 ? 'يوم متبقٍ' : 'الاشتراك'}</span></button>` : ''}
    </div>
    ${row('متابعة المشاهدة', cont, {
    render: (h) => {
      const pct = h.dur ? Math.min(100, (h.pos / h.dur) * 100) : 0;
      return `<button class="card-item wide-card" data-resume="${esc(h.id)}">${art(h.logo, h.name, 'cover')}<i class="pb"><i style="width:${pct}%"></i></i>
        <b>${esc(h.name)}</b><small>${h.ep ? `م${h.ep.season} · ح${h.ep.episode} — ` : ''}متبقٍ ${fmtDur((h.dur - h.pos) / 60)}</small></button>`;
    },
  })}
    ${row('قنواتك المفضلة', favLive, { cls: 'tiles' })}
    ${row('شاهدتها مؤخرًا', recentLive, { cls: 'tiles' })}
    ${row('مفضلتك', favVod)}
    ${row('أفلام أضيفت حديثًا', latestMovies, { more: 'movie' })}
    ${row('مسلسلات أضيفت حديثًا', latestSeries, { more: 'series' })}
    ${row('الأعلى تقييمًا', topRated, { more: 'movie' })}
    ${!live.length && !movies.length && !series.length ? '<p class="empty">لا يوجد محتوى في هذا الاشتراك.</p>' : ''}`;
  bindOpen(v);
  v.querySelectorAll('[data-resume]').forEach((b) => b.addEventListener('click', () => resume(b.dataset.resume)));
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
    else if (it.kind === 'movie' && !b.dataset.info && b.closest('.hero')) openDetail(it, { autoplay: true });
    else openDetail(it);
  }));
}

function playLive(item, list) {
  const l = list || filterItems(lib.data.items, { kind: 'live', cat: item.cat, sort: viewState.live.sort, blockedCats: blocked('live') });
  const index = l.findIndex((i) => i.id === item.id);
  player.open({ item, kind: 'live', list: l, index: index < 0 ? 0 : index });
}

// ———————————————————————————— القنوات المباشرة

function catList(kind, st) {
  const counts = countByCat(lib.data.items, kind);
  const bl = blocked(kind);
  const total = [...counts.entries()].filter(([c]) => !bl.has(c)).reduce((a, [, n]) => a + n, 0);
  const favN = lib.data.items.filter((i) => i.kind === kind && lib.isFav(i.id)).length;
  const recN = recentFor(kind).length;
  const cats = [
    { id: 'all', name: 'الكل', n: total },
    ...(favN ? [{ id: 'fav', name: 'المفضلة', n: favN, icon: 'heart-f' }] : []),
    ...(recN ? [{ id: 'recent', name: 'شوهد مؤخرًا', n: recN, icon: 'clock' }] : []),
    ...lib.cats(kind).map((c) => ({ ...c, n: counts.get(c.id) || 0, locked: bl.has(c.id) })).filter((c) => c.n || c.lazy),
  ];
  return cats.map((c) => `<button class="cat ${st.cat === c.id ? 'on' : ''} ${c.locked ? 'locked' : ''}" data-cat="${esc(c.id)}">
    ${c.icon ? icon(c.icon) : ''}${c.locked ? icon('lock') : ''}<span>${esc(c.name)}</span>${c.n ? `<small>${c.n.toLocaleString('ar')}</small>` : ''}</button>`).join('');
}

function toolbar(kind, st) {
  return `<div class="toolbar">
    <label class="search-box">${icon('search')}<input type="search" placeholder="ابحث في ${KIND_LABEL[kind]}…" value="${esc(st.q)}" data-q /></label>
    <button class="btn glass sm" data-sort>${icon('list')}<span>${SORTS[st.sort].label}</span></button>
    ${kind === 'live' ? `<button class="icon-btn" data-viewmode aria-label="طريقة العرض">${icon(settings.liveView === 'grid' ? 'list' : 'grid')}</button>` : ''}
  </div>`;
}

function sortsFor(kind) { return kind === 'live' ? ['default', 'num', 'az', 'za'] : ['added', 'az', 'za', 'rating', 'year', 'default']; }

function renderLive() {
  const st = viewState.live;
  const v = $('#view');
  v.innerHTML = `<div class="split">
    <aside class="cats" id="cats">${catList('live', st)}</aside>
    <section class="pane">${toolbar('live', st)}<div class="${settings.liveView === 'grid' ? 'grid tiles-grid' : 'ch-list'}" id="list"></div></section></div>`;
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

function renderLiveList() {
  const st = viewState.live;
  const list = filterItems(lib.data.items, { kind: 'live', cat: st.cat, query: st.q, sort: st.sort, favs: lib.favSet(), recent: recentFor('live'), blockedCats: blocked('live') });
  const box = $('#list');
  const grid = settings.liveView === 'grid';
  const one = grid
    ? (it) => `<button class="card-item ch-tile" data-ch="${esc(it.id)}">${art(it.logo, it.name, 'logo')}<b>${esc(it.name)}</b>${lib.isFav(it.id) ? icon('heart-f', 'fav') : ''}</button>`
    : (it) => `<button class="ch" data-ch="${esc(it.id)}">
      <span class="num">${it.num || ''}</span>${art(it.logo, it.name, 'logo')}
      <span class="meta"><b>${esc(it.name)}</b><span class="now"></span><i class="pb"><i></i></i></span>
      ${it.catchup ? `<span class="tag">${icon('archive')}</span>` : ''}${lib.isFav(it.id) ? icon('heart-f', 'fav') : ''}</button>`;
  stopView.push(renderChunks(box, list, one, { empty: `<p class="empty">${st.q ? 'لا نتائج مطابقة.' : 'لا توجد قنوات هنا.'}</p>` }));
  box.onclick = (e) => {
    const b = e.target.closest('[data-ch]');
    if (b) playLive(lib.byId.get(b.dataset.ch), list);
  };
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

function bindCats(kind, st, rerender) {
  const cats = $('#cats');
  cats.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    if (b.classList.contains('locked') && !(await askPin())) return;
    st.cat = b.dataset.cat;
    cats.querySelectorAll('.cat').forEach((x) => x.classList.toggle('on', x === b));
    if (b.classList.contains('locked')) { render(); return; }
    if (kind !== 'live') {
      $('#list').innerHTML = '<div class="p-loading"><i class="spin"></i></div>';
      try { await lib.ensureCategory(kind, st.cat); } catch (err) { toast(err.message); }
    }
    rerender();
    $('#view').scrollTop = 0;
    $('#list').scrollTop = 0;
  });
  bindLongPress(cats, '[data-cat]', (b) => catMenu(kind, b.dataset.cat));
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
  const opts = [
    { label: it.kind === 'live' ? 'تشغيل' : 'التفاصيل', value: 'open', icon: 'play' },
    { label: fav ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة', value: 'fav', icon: fav ? 'heart-f' : 'heart' },
    { label: 'فتح في مشغل خارجي', value: 'ext', icon: 'ext' },
    { label: 'قفل هذا القسم', value: 'lock', icon: 'lock' },
  ];
  const v = await choose(it.name, opts);
  if (v === 'open') { if (it.kind === 'live') playLive(it); else openDetail(it); }
  if (v === 'fav') { const on = await lib.toggleFav(it.id); toast(on ? 'أُضيف إلى المفضلة' : 'أُزيل من المفضلة'); render(); }
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
  v.innerHTML = `<div class="split vod">
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
  const paint = (info = {}) => {
    const poster = item.logo || info.poster || '';
    const backdrop = info.backdrop || item.backdrop || poster;
    const year = item.year || info.year;
    const rating = Number(info.rating || item.rating || 0);
    const dur = info.duration;
    const prog = !isSeries && lib.progressOf(item.id);
    const resumeAt = prog && !prog.done && prog.pos > 30 ? prog.pos : 0;
    const fav = lib.isFav(item.id);
    d.innerHTML = `
      <div class="d-bg" style="--img:url('${esc(backdrop)}')"></div>
      <button class="icon-btn d-back" data-d="back" aria-label="رجوع">${icon('back')}</button>
      <div class="d-main">
        <div class="d-poster">${art(poster, item.title || item.name, 'cover')}</div>
        <div class="d-info">
          <h1>${esc(item.title || item.name)}</h1>
          <div class="d-meta">${[year, dur ? fmtDur(dur) : '', rating ? `<span class="star">${icon('star')} ${rating.toFixed(1)}</span>` : '', item.quality].filter(Boolean).map((x) => `<span>${typeof x === 'number' ? x : x}</span>`).join('')}</div>
          ${info.genre || item.genre ? `<div class="d-genre">${esc(info.genre || item.genre)}</div>` : ''}
          <div class="row gap wrap d-actions">
            ${isSeries ? '<button class="btn primary big" data-d="playSeries">' + icon('play') + ' <span>تشغيل</span></button>'
    : `<button class="btn primary big" data-d="play">${icon('play')} ${resumeAt ? `استئناف من ${fmtTime(resumeAt)}` : 'تشغيل'}</button>
               ${resumeAt ? `<button class="btn glass" data-d="restart">${icon('refresh')} من البداية</button>` : ''}`}
            <button class="btn glass icon-only ${fav ? 'on' : ''}" data-d="fav" aria-label="مفضلة">${icon(fav ? 'heart-f' : 'heart')}</button>
            ${info.trailer ? `<button class="btn glass" data-d="trailer">${icon('yt')} الإعلان</button>` : ''}
            <button class="btn glass icon-only" data-d="ext" aria-label="مشغل خارجي">${icon('ext')}</button>
          </div>
          ${info.plot || item.plot ? `<p class="d-plot">${esc(info.plot || item.plot)}</p>` : ''}
          ${info.director ? `<div class="d-cast"><span>الإخراج</span> ${esc(info.director)}</div>` : ''}
          ${info.cast || item.cast ? `<div class="d-cast"><span>بطولة</span> ${esc(info.cast || item.cast)}</div>` : ''}
        </div>
      </div>
      ${isSeries ? '<section class="d-seasons" id="dSeasons"><div class="p-loading"><i class="spin"></i></div></section>' : ''}`;
    d.querySelector('[data-d=play], [data-d=playSeries]')?.focus({ preventScroll: true });
    d.onclick = async (e) => {
      const b = e.target.closest('[data-d]');
      if (!b) return;
      const a = b.dataset.d;
      if (a === 'back') closeDetail();
      if (a === 'play') player.open({ item: { ...item, ext: info.ext || item.ext }, kind: 'movie' });
      if (a === 'restart') player.open({ item: { ...item, ext: info.ext || item.ext }, kind: 'movie', start: 1 });
      if (a === 'fav') { const on = await lib.toggleFav(item.id); toast(on ? 'أُضيف إلى المفضلة' : 'أُزيل من المفضلة'); b.classList.toggle('on', on); b.innerHTML = icon(on ? 'heart-f' : 'heart'); }
      if (a === 'trailer') openExternal(`https://www.youtube.com/watch?v=${encodeURIComponent(info.trailer)}`, 'trailer');
      if (a === 'ext' && !isSeries) { const url = await lib.streamUrl({ ...item, ext: info.ext || item.ext }).catch(() => ''); if (url) openExternal(url, item.name, (lib.headersFor(item) || {}).ua); }
      if (a === 'playSeries') playSeriesFrom(item, info);
    };
    if (isSeries && info.seasons) paintSeasons(item, info);
  };
  paint({});
  let info = {};
  try {
    info = isSeries ? await seriesInfo(item) : await lib.provider.movieInfo(lib.pl, item);
  } catch (e) { if (isSeries) { $('#dSeasons').innerHTML = `<p class="empty">${esc(e.message)}</p>`; } }
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
  if (autoplay && !isSeries) player.open({ item: { ...item, ext: info.ext || item.ext }, kind: 'movie' });
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

function paintSeasons(item, info) {
  const box = $('#dSeasons');
  if (!box) return;
  if (!info.seasons.length) { box.innerHTML = '<p class="empty">لا توجد حلقات متاحة.</p>'; return; }
  const last = lib.user.history.find((h) => h.seriesId === item.id);
  let cur = (last && last.ep && last.ep.season) || info.seasons[0].num;
  const playBtn = $('[data-d=playSeries] span');
  if (last && last.ep && playBtn) playBtn.textContent = `متابعة م${last.ep.season} · ح${last.ep.episode}`;
  const draw = () => {
    const season = info.seasons.find((s) => s.num === cur) || info.seasons[0];
    box.innerHTML = `<div class="seg tabs">${info.seasons.map((s) => `<button data-season="${s.num}" class="${s.num === season.num ? 'on' : ''}">${esc(s.name)} <small>${s.episodes.length}</small></button>`).join('')}</div>
      <div class="eps">${season.episodes.map((e) => {
    const h = lib.progressOf(e.id);
    const pct = h && h.dur ? Math.min(100, (h.pos / h.dur) * 100) : 0;
    return `<button class="ep ${h && h.done ? 'done' : ''}" data-ep="${esc(e.id)}">
          ${art(e.img || season.cover || item.logo, `${e.episode}`, 'thumb')}
          <span class="ep-n">${e.episode}</span>
          <span class="ep-meta"><b>${esc(e.title || `الحلقة ${e.episode}`)}</b>${e.duration ? `<small>${fmtDur(e.duration)}</small>` : ''}${e.plot ? `<small class="pl">${esc(e.plot)}</small>` : ''}</span>
          ${pct ? `<i class="pb"><i style="width:${pct}%"></i></i>` : ''}${h && h.done ? icon('check', 'seen') : ''}</button>`;
  }).join('')}</div>`;
    box.querySelectorAll('[data-season]').forEach((b) => b.addEventListener('click', () => { cur = Number(b.dataset.season); draw(); box.querySelector(`[data-season="${cur}"]`).focus(); }));
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
      <div class="about"><svg><use href="#i-logo"/></svg><div><b>LiwaIPTV</b><small>الإصدار 1.0.0 · مشغّل فقط ولا يوفّر أي محتوى</small></div></div>
      <button class="set-row" data-clear><span>مسح ذاكرة الصور والأدلة المؤقتة</span>${icon('trash')}</button>
    </section>
  </div>`;

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
      renderSettings();
    }
  }));
}

boot().catch((e) => { console.error(e); showWelcome(); showAddError(e.message); });
