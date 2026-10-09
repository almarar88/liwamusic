/* LiwaIPTV — المكتبة: قوائم الاشتراكات، تحميلها وتخزينها، الفرز والتصفية
   والبحث، المفضلة، والمتابعة من حيث توقفت. */
'use strict';

import { store } from './store.js';
import { http } from './http.js';
import { norm, matches, hash } from './util.js';
import * as xtream from './xtream.js';
import * as stalker from './stalker.js';
import { buildLibrary, xtreamFromM3UUrl } from './m3u.js';
import { parseXMLTV, lookup } from './epg.js';

// ———————————————————————————— دوال خالصة (مُختبرة)

export const SORTS = {
  default: { label: 'الترتيب الأصلي' },
  added: { label: 'الأحدث إضافة' },
  az: { label: 'الاسم أ ← ي' },
  za: { label: 'الاسم ي ← أ' },
  rating: { label: 'الأعلى تقييمًا' },
  year: { label: 'الأحدث إصدارًا' },
  num: { label: 'رقم القناة' },
};

const collator = typeof Intl !== 'undefined' ? new Intl.Collator(['ar', 'en'], { numeric: true, sensitivity: 'base' }) : null;
const cmpName = (a, b) => (collator ? collator.compare(a.title || a.name, b.title || b.name) : String(a.name).localeCompare(b.name));

export function sortItems(list, mode = 'default') {
  const out = list.slice();
  switch (mode) {
    case 'az': return out.sort(cmpName);
    case 'za': return out.sort((a, b) => cmpName(b, a));
    case 'added': return out.sort((a, b) => (b.added || 0) - (a.added || 0));
    case 'rating': return out.sort((a, b) => (b.rating || 0) - (a.rating || 0) || cmpName(a, b));
    case 'year': return out.sort((a, b) => (b.year || 0) - (a.year || 0) || (b.added || 0) - (a.added || 0));
    case 'num': return out.sort((a, b) => (a.num || 1e9) - (b.num || 1e9));
    default: return out;
  }
}

/** نص البحث المطبّع لعنصر (يُحسب مرة). */
export function searchText(item) {
  if (item._n === undefined) {
    Object.defineProperty(item, '_n', { value: norm(`${item.name} ${item.title || ''} ${item.num || ''}`), enumerable: false, writable: true });
  }
  return item._n;
}

/**
 * يصفّي عناصر نوع معيّن.
 * opts: { kind, cat ('all'|'fav'|'recent'|id), query, sort, favs: Set, recent: [ids], blockedCats: Set }
 */
export function filterItems(items, opts) {
  const { kind, cat = 'all', query = '', sort = 'default', favs = new Set(), recent = [], blockedCats = new Set() } = opts;
  const q = norm(query);
  let list;
  if (cat === 'recent') {
    const byId = new Map(items.map((i) => [i.id, i]));
    list = recent.map((id) => byId.get(id)).filter((i) => i && i.kind === kind);
  } else {
    list = items.filter((i) => i.kind === kind
      && (cat === 'all' || (cat === 'fav' ? favs.has(i.id) : i.cat === cat))
      && !blockedCats.has(i.cat));
  }
  if (q) list = list.filter((i) => matches(searchText(i), q));
  return cat === 'recent' ? list : sortItems(list, sort);
}

/** عدد العناصر لكل قسم. */
export function countByCat(items, kind) {
  const m = new Map();
  for (const i of items) if (i.kind === kind) m.set(i.cat, (m.get(i.cat) || 0) + 1);
  return m;
}

/** يسجّل موضع المشاهدة؛ يحذف المكتمل (>95%) من «متابعة المشاهدة». */
export function updateHistory(history, entry, max = 200) {
  const rest = history.filter((h) => h.id !== entry.id);
  const done = entry.dur > 0 && entry.pos / entry.dur > 0.95;
  const next = [{ ...entry, at: Date.now(), done }, ...rest];
  return next.slice(0, max);
}

export function continueWatching(history) {
  return history.filter((h) => h.kind !== 'live' && !h.done && h.pos > 30);
}

// ———————————————————————————— المزوّدون

export const providers = {
  xtream: {
    label: 'Xtream Codes',
    load: (pl, p) => xtream.load(pl, p),
    url: async (pl, item, lib) => xtream.streamUrl(pl, item, lib && lib.account),
    movieInfo: (pl, item) => xtream.movieInfo(pl, item),
    seriesInfo: (pl, item) => xtream.seriesInfo(pl, item),
    shortEpg: (pl, item) => xtream.shortEpg(pl, item),
    fullEpg: (pl, item) => xtream.fullEpg(pl, item),
    catchup: (pl, item, prog) => xtream.catchupUrl(pl, item, prog.startRaw, (prog.end - prog.start) / 60000),
    hosts: (pl) => [hostOf(xtream.normServer(pl.server))],
  },
  m3u: {
    label: 'M3U',
    async load(pl, onProgress = () => {}) {
      onProgress('تنزيل القائمة…');
      const text = pl.url ? await http.text(pl.url, { timeout: 120000 }) : await store.get(`m3ufile:${pl.id}`);
      if (!text) throw new Error('ملف القائمة غير موجود — أضفه من جديد');
      onProgress('تحليل القائمة وتصنيفها…');
      if (!/#EXTINF/i.test(text)) throw new Error('الملف ليس قائمة M3U صالحة');
      const lib = buildLibrary(text);
      return { account: null, ...lib };
    },
    url: async (pl, item) => item.url,
    async seriesInfo(pl, item) {
      const seasons = Object.keys(item.seasons || {}).map(Number).sort((a, b) => a - b).map((n) => ({
        num: n, name: `الموسم ${n}`,
        episodes: item.seasons[n].map((e) => ({ ...e, kind: 'episode' })),
      }));
      return { plot: item.plot || '', seasons };
    },
    movieInfo: async (pl, item) => ({ plot: item.plot || '' }),
    hosts: (pl) => (pl.url ? [hostOf(pl.url)] : []),
  },
  stalker: {
    label: 'Stalker / MAC',
    load: (pl, p) => stalker.load(pl, p),
    url: (pl, item) => stalker.resolveUrl(pl, item),
    loadCategory: (pl, cat) => stalker.loadCategory(pl, cat),
    movieInfo: (pl, item) => stalker.movieInfo(pl, item),
    seriesInfo: (pl, item) => stalker.seriesInfo(pl, item),
    shortEpg: (pl, item) => stalker.shortEpg(pl, item),
    hosts: (pl) => [hostOf(stalker.endpoints(pl.server).referer)],
    ua: stalker.STALKER_UA,
  },
};

export function hostOf(url) {
  try { return new URL(/^https?:/i.test(url) ? url : `http://${url}`).host; } catch { return ''; }
}

/** يجهّز تعريف قائمة جديدة من نموذج الإضافة، ويحوّل روابط get.php إلى Xtream تلقائيًا. */
export function makePlaylist(form) {
  const name = String(form.name || '').trim();
  if (form.type === 'm3u' && form.url) {
    const x = xtreamFromM3UUrl(form.url);
    if (x) return { id: hash(`${x.server}|${x.username}`), type: 'xtream', name: name || hostOf(x.server), ...x, addedAt: Date.now() };
  }
  if (form.type === 'xtream') {
    const server = xtream.normServer(form.server);
    if (!server || !form.username || !form.password) throw new Error('أكمل رابط الخادم واسم المستخدم وكلمة المرور');
    return { id: hash(`${server}|${form.username}`), type: 'xtream', name: name || hostOf(server), server, username: String(form.username).trim(), password: String(form.password).trim(), addedAt: Date.now() };
  }
  if (form.type === 'stalker') {
    const mac = stalker.normMac(form.mac);
    if (!form.server || !mac) throw new Error('أكمل رابط البوابة وعنوان MAC');
    return { id: hash(`${form.server}|${mac}`), type: 'stalker', name: name || hostOf(form.server), server: String(form.server).trim(), mac, addedAt: Date.now() };
  }
  if (form.type === 'm3u') {
    if (!form.url && !form.content) throw new Error('أدخل رابط القائمة أو اختر ملفًا');
    const key = form.url || `file:${form.fileName}:${form.content.length}`;
    return { id: hash(key), type: 'm3u', name: name || (form.url ? hostOf(form.url) : form.fileName), url: form.url || '', content: form.content || '', epgUrl: form.epgUrl || '', addedAt: Date.now() };
  }
  throw new Error('نوع غير معروف');
}

// ———————————————————————————— حالة المكتبة النشطة

export class Library {
  constructor() {
    this.playlists = [];
    this.pl = null;
    this.data = null; // { account, cats, items, epgUrl, loadedAt }
    this.user = { fav: {}, history: [], lockedCats: [] };
    this.epg = null;
    this.byId = new Map();
  }

  async init() {
    this.playlists = (await store.get('playlists')) || [];
    const activeId = await store.get('active');
    this.pl = this.playlists.find((p) => p.id === activeId) || this.playlists[0] || null;
  }

  get provider() { return this.pl ? providers[this.pl.type] : null; }

  async savePlaylists() { await store.set('playlists', this.playlists); }

  async addPlaylist(pl) {
    // محتوى ملف M3U المحلي يُخزَّن منفصلًا (قد يبلغ عشرات الميجابايت)
    if (pl.content) { await store.set(`m3ufile:${pl.id}`, pl.content); pl = { ...pl }; delete pl.content; }
    this.playlists = [pl, ...this.playlists.filter((p) => p.id !== pl.id)];
    await this.savePlaylists();
  }

  async removePlaylist(id) {
    this.playlists = this.playlists.filter((p) => p.id !== id);
    await this.savePlaylists();
    await store.remove(`lib:${id}`);
    await store.remove(`user:${id}`);
    await store.remove(`m3ufile:${id}`);
    await store.remove(`epg:${id}`);
    if (this.pl && this.pl.id === id) { this.pl = this.playlists[0] || null; this.data = null; }
  }

  /** يفعّل قائمة: من الذاكرة المحلية إن وُجدت (سريع)، وإلا يحمّلها من الخادم. */
  async activate(id, { refresh = false, onProgress } = {}) {
    const pl = this.playlists.find((p) => p.id === id);
    if (!pl) throw new Error('القائمة غير موجودة');
    this.pl = pl;
    await store.set('active', id);
    this.user = { fav: {}, history: [], lockedCats: [], ...((await store.get(`user:${id}`)) || {}) };
    let data = refresh ? null : await store.get(`lib:${id}`);
    if (!data) {
      data = await this.provider.load(pl, onProgress);
      data.loadedAt = Date.now();
      await store.set(`lib:${id}`, data);
    }
    this.setData(data);
    return data;
  }

  setData(data) {
    this.data = data;
    this.byId = new Map(data.items.map((i) => [i.id, i]));
    this.epg = null;
    this.epgPromise = null;
  }

  async saveUser() { if (this.pl) await store.set(`user:${this.pl.id}`, this.user); }

  isFav(id) { return !!this.user.fav[id]; }
  async toggleFav(id) {
    if (this.user.fav[id]) delete this.user.fav[id]; else this.user.fav[id] = Date.now();
    await this.saveUser();
    return !!this.user.fav[id];
  }
  favSet() { return new Set(Object.keys(this.user.fav)); }

  async record(entry) {
    this.user.history = updateHistory(this.user.history, entry);
    await this.saveUser();
  }
  progressOf(id) { return this.user.history.find((h) => h.id === id) || null; }
  recentIds(kind) { return this.user.history.filter((h) => h.kind === kind).map((h) => h.id); }

  cats(kind) { return (this.data && this.data.cats[kind]) || []; }
  catById(kind, id) { return this.cats(kind).find((c) => c.id === id); }

  /** الأقسام المحجوبة: المقفلة يدويًا + أقسام الكبار حين يكون القفل مفعّلًا. */
  blocked(kind, parentalOn) {
    const s = new Set(this.user.lockedCats);
    if (parentalOn) for (const c of this.cats(kind)) if (c.adult) s.add(c.id);
    return s;
  }

  /** يحمّل عناصر قسم كسول (Stalker) مرة واحدة. */
  async ensureCategory(kind, catId) {
    const cat = this.catById(kind, catId);
    if (!cat || !cat.lazy || cat.loaded || !this.provider.loadCategory) return;
    const items = await this.provider.loadCategory(this.pl, cat);
    for (const it of items) if (!this.byId.has(it.id)) { this.data.items.push(it); this.byId.set(it.id, it); }
    cat.loaded = true;
    store.set(`lib:${this.pl.id}`, this.data);
  }

  async streamUrl(item) { return this.provider.url(this.pl, item, this.data); }

  /** ترويسات الطلب الخاصة بعنصر (User-Agent/Referer) لتمريرها للوسيط. */
  headersFor(item) {
    if (item.headers) return item.headers;
    if (this.pl && this.pl.type === 'stalker') return { ua: providers.stalker.ua };
    return null;
  }

  /** دليل XMLTV كامل (للقوائم M3U) — يُحمَّل عند الحاجة ويُخزَّن 6 ساعات. */
  loadXmltv() {
    if (this.epg) return Promise.resolve(this.epg);
    if (!this.epgPromise) this.epgPromise = this.fetchXmltv().finally(() => { this.epgPromise = null; });
    return this.epgPromise;
  }

  async fetchXmltv() {
    const url = (this.pl && this.pl.epgUrl) || (this.data && this.pl.type === 'm3u' && this.data.epgUrl);
    if (!url) return null;
    const cacheKey = `epg:${this.pl.id}`;
    const cached = await store.get(cacheKey);
    if (cached && Date.now() - cached.at < 6 * 3600e3) {
      this.epg = { programmes: new Map(cached.p), names: new Map(cached.n) };
      return this.epg;
    }
    const xml = await http.text(url, { timeout: 120000 });
    const wanted = new Set();
    for (const i of this.data.items) if (i.kind === 'live' && i.epgId) wanted.add(i.epgId.toLowerCase().replace(/\s+/g, ''));
    this.epg = parseXMLTV(xml, { wanted: wanted.size ? wanted : null });
    store.set(cacheKey, { at: Date.now(), p: [...this.epg.programmes], n: [...this.epg.names] });
    return this.epg;
  }

  /** برامج قناة: من الخادم (Xtream/Stalker) أو من XMLTV. */
  async programmes(item) {
    if (this.provider.shortEpg && this.pl.type !== 'm3u') {
      try { const l = await this.provider.shortEpg(this.pl, item); if (l.length) return l; } catch { /* نجرب XMLTV */ }
    }
    try { return lookup(await this.loadXmltv(), item); } catch { return []; }
  }
}
