#!/usr/bin/env node
/**
 * Here — خادم تطبيق الطلبات والعضويات لكوفي Here.
 * بلا اعتماديات خارجية: Node 22+ فقط.
 *
 * يقدّم:
 *   /            تطبيق العملاء (PWA)
 *   /admin/      شاشة الكوفي (الطلبات الحية، المنتجات، النقاط)
 *   /api/...     واجهة البرمجة (انظر README.md)
 *
 * متغيرات البيئة:
 *   PORT                 المنفذ (افتراضي 3000)
 *   ADMIN_PIN            رمز دخول شاشة الكوفي (افتراضي 1234 — غيّره!)
 *   DATA_DIR             مجلد البيانات (افتراضي ./data)
 *   TELEGRAM_BOT_TOKEN   اختياري: إرسال كل طلب جديد إلى تيليجرام
 *   TELEGRAM_CHAT_ID     اختياري: معرّف المحادثة/المجموعة
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PIN = String(process.env.ADMIN_PIN || '1234');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const MENU_FILE = path.join(__dirname, 'data', 'menu.json');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// ───────────────────────── القائمة (ثابتة من menu.json + تعديلات الإدارة)
const MENU = JSON.parse(fs.readFileSync(MENU_FILE, 'utf8'));
const productById = new Map(MENU.products.map((p) => [p.id, p]));

// ───────────────────────── قاعدة بيانات JSON بسيطة مع حفظ ذري
const db = loadDb();
function loadDb() {
  const empty = { customers: {}, orders: [], seq: 1000, productOverrides: {}, pointsLog: [], settings: {} };
  try {
    if (fs.existsSync(DB_FILE)) return { ...empty, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
  } catch (e) { console.error('تعذّر قراءة قاعدة البيانات، سيُبدأ من جديد:', e.message); }
  return empty;
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, DB_FILE);
  }, 150);
}
process.on('SIGINT', () => { clearTimeout(saveTimer); fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 1)); process.exit(0); });

// ───────────────────────── أدوات
const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};
const err = (res, status, message, extra = {}) => json(res, status, { error: message, ...extra });
const now = () => new Date().toISOString();
const round2 = (n) => Math.round(n * 100) / 100;
const normPhone = (p) => {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '971' + d.slice(1);
  if (d.length === 9 && d.startsWith('5')) d = '971' + d;
  return d;
};
const validPhone = (d) => /^971(5\d{8})$/.test(d) || /^\d{9,15}$/.test(d);
const memberCode = () => 'HERE-' + crypto.randomBytes(3).toString('hex').toUpperCase();
const token = () => crypto.randomBytes(24).toString('base64url');

async function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('invalid json')); } });
    req.on('error', reject);
  });
}

// حد بسيط للطلبات لكل IP (حماية من الإغراق)
const hits = new Map();
function rateLimited(ip, key, max, windowMs) {
  const k = ip + '|' + key; const t = Date.now();
  const arr = (hits.get(k) || []).filter((x) => t - x < windowMs);
  arr.push(t); hits.set(k, arr);
  return arr.length > max;
}
setInterval(() => { const t = Date.now(); for (const [k, arr] of hits) if (!arr.some((x) => t - x < 3600e3)) hits.delete(k); }, 600e3).unref();

// ───────────────────────── العضويات والنقاط
const L = MENU.loyalty;
function tierFor(lifetime) {
  let t = L.tiers[0];
  for (const tier of L.tiers) if (lifetime >= tier.min) t = tier;
  return t;
}
function nextTier(lifetime) {
  return L.tiers.find((t) => t.min > lifetime) || null;
}
function publicCustomer(c) {
  const tier = tierFor(c.lifetimePoints);
  const next = nextTier(c.lifetimePoints);
  return {
    id: c.id, name: c.name, phone: c.phone, memberCode: c.memberCode, createdAt: c.createdAt,
    points: c.points, lifetimePoints: c.lifetimePoints, tier: tier.id, tierName: tier.name, multiplier: tier.multiplier,
    nextTier: next ? { id: next.id, name: next.name, min: next.min, remaining: next.min - c.lifetimePoints } : null,
    ordersCount: c.ordersCount || 0, totalSpent: round2(c.totalSpent || 0),
  };
}
function addPoints(c, pts, reason, ref) {
  pts = Math.round(pts);
  if (!pts) return;
  c.points = Math.max(0, (c.points || 0) + pts);
  if (pts > 0) c.lifetimePoints = (c.lifetimePoints || 0) + pts;
  db.pointsLog.push({ at: now(), customerId: c.id, points: pts, reason, ref: ref || null });
  if (db.pointsLog.length > 20000) db.pointsLog.splice(0, db.pointsLog.length - 20000);
}
function earnFor(c, amountAed) {
  return Math.floor(amountAed * L.pointsPerAed * tierFor(c.lifetimePoints).multiplier);
}

// ───────────────────────── المصادقة (تجريبية: هاتف + اسم، بلا OTP)
const sessions = new Map(); // token -> customerId (تُحفظ أيضًا داخل العميل)
for (const c of Object.values(db.customers)) for (const t of c.tokens || []) sessions.set(t, c.id);
function customerFromReq(req) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  const id = t && sessions.get(t);
  return id ? db.customers[id] : null;
}
function isAdmin(req, url) {
  const pin = req.headers['x-admin-pin'] || url.searchParams.get('pin');
  return pin && crypto.timingSafeEqual(Buffer.from(String(pin)), Buffer.from(ADMIN_PIN)) ;
}
function safeEqual(a, b) { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); }

// ───────────────────────── بث حي (SSE) لشاشة الكوفي والعملاء
const adminClients = new Set();
const customerClients = new Map(); // customerId -> Set(res)
function broadcastAdmin(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of adminClients) res.write(msg);
}
function notifyCustomer(customerId, event, data) {
  const set = customerClients.get(customerId); if (!set) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) res.write(msg);
}
function openStream(req, res, set, onClose) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(`event: hello\ndata: ${JSON.stringify({ at: now() })}\n\n`);
  set.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); set.delete(res); onClose && onClose(); });
}

// ───────────────────────── تيليجرام (اختياري)
async function telegramNotify(order) {
  const tok = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!tok || !chat) return;
  const lines = [
    `☕ *طلب جديد #${order.number}* — ${order.branchName}`,
    `${modeLabel(order.mode)}`,
    ...order.items.map((i) => `• ${i.qty}× ${i.name}${i.optionsText ? ' (' + i.optionsText + ')' : ''}`),
    `الإجمالي: *${order.total} AED* — ${order.payment === 'cash' ? 'نقدًا' : 'بطاقة عند الاستلام'}`,
    `العميل: ${order.customer.name} — ${order.customer.phone}`,
  ];
  if (order.mode === 'car') lines.push(`🚗 ${order.car.model} — ${order.car.color} — ${order.car.plate}`);
  if (order.mode === 'delivery') lines.push(`📍 ${order.address.text}${order.address.mapsUrl ? '\n' + order.address.mapsUrl : ''}`);
  if (order.note) lines.push(`📝 ${order.note}`);
  try {
    await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: lines.join('\n'), parse_mode: 'Markdown' }),
    });
  } catch (e) { console.error('تيليجرام:', e.message); }
}
const modeLabel = (m) => ({ pickup: '🏪 استلام من الكوفي', car: '🚗 توصيل للسيارة', delivery: '🛵 توصيل للعنوان' })[m] || m;

// ───────────────────────── تسعير الطلب من جهة الخادم (لا نثق بأسعار العميل)
function effectiveProduct(id) {
  const p = productById.get(id); if (!p) return null;
  const o = db.productOverrides[id] || {};
  return { ...p, price: o.price ?? p.price, available: o.available ?? p.available };
}
function priceItems(items, lang) {
  if (!Array.isArray(items) || !items.length) throw new Error('السلة فارغة');
  if (items.length > 30) throw new Error('عدد الأصناف كبير');
  const out = [];
  for (const it of items) {
    const p = effectiveProduct(String(it.productId || ''));
    if (!p) throw new Error('صنف غير معروف');
    if (!p.available) throw new Error(`الصنف غير متوفر حاليًا: ${p.name.ar}`);
    const qty = Math.min(20, Math.max(1, parseInt(it.qty, 10) || 1));
    const groups = MENU.optionGroups[p.optionGroup] || [];
    const chosen = it.options && typeof it.options === 'object' ? it.options : {};
    let extra = 0; const optionsText = []; const options = {};
    for (const g of groups) {
      let sel = chosen[g.id];
      if (g.multi) {
        sel = Array.isArray(sel) ? sel : [];
        const picked = g.choices.filter((c) => sel.includes(c.id));
        for (const c of picked) { extra += c.price; optionsText.push(c.name[lang] || c.name.ar); }
        options[g.id] = picked.map((c) => c.id);
      } else {
        const c = g.choices.find((c) => c.id === sel) || (g.required ? g.choices[0] : null);
        if (c) { extra += c.price; options[g.id] = c.id; if (c.price || g.id === 'size' || g.id === 'milk' && c.id !== 'fresh' || g.id === 'sugar' || g.id === 'ice') optionsText.push(c.name[lang] || c.name.ar); }
      }
    }
    const unit = round2(p.price + extra);
    out.push({ productId: p.id, name: p.name[lang] || p.name.ar, nameEn: p.name.en, nameAr: p.name.ar, qty, unitPrice: unit, lineTotal: round2(unit * qty), options, optionsText: optionsText.join('، '), image: p.image });
  }
  return out;
}

// ───────────────────────── الطلبات
const STATUS_FLOW = ['new', 'accepted', 'preparing', 'ready', 'completed'];
const STATUS_AR = { new: 'جديد', accepted: 'تم القبول', preparing: 'قيد التحضير', ready: 'جاهز', completed: 'مكتمل', cancelled: 'ملغي' };

function createOrder(customer, body) {
  const lang = body.lang === 'en' ? 'en' : 'ar';
  const branch = MENU.branches.find((b) => b.id === body.branchId);
  if (!branch) throw new Error('اختر الفرع');
  const mode = ['pickup', 'car', 'delivery'].includes(body.mode) ? body.mode : null;
  if (!mode) throw new Error('اختر طريقة الاستلام');
  if (!branch.modes.includes(mode)) throw new Error('هذه الطريقة غير متاحة في هذا الفرع');

  const items = priceItems(body.items, lang);
  const subtotal = round2(items.reduce((s, i) => s + i.lineTotal, 0));

  let car = null, address = null;
  if (mode === 'car') {
    car = { model: String(body.car?.model || '').trim().slice(0, 60), color: String(body.car?.color || '').trim().slice(0, 30), plate: String(body.car?.plate || '').trim().slice(0, 20) };
    if (!car.model || !car.color) throw new Error('أدخل نوع السيارة ولونها');
  }
  if (mode === 'delivery') {
    address = {
      text: String(body.address?.text || '').trim().slice(0, 300),
      lat: Number(body.address?.lat) || null, lng: Number(body.address?.lng) || null,
    };
    if (!address.text && !address.lat) throw new Error('أدخل العنوان أو حدد موقعك');
    if (address.lat && address.lng) address.mapsUrl = `https://maps.google.com/?q=${address.lat},${address.lng}`;
    if (subtotal < MENU.ordering.deliveryMinimum) throw new Error(`الحد الأدنى للتوصيل ${MENU.ordering.deliveryMinimum} درهم`);
  }
  const deliveryFee = mode === 'delivery' && subtotal < MENU.ordering.freeDeliveryAbove ? MENU.ordering.deliveryFee : 0;

  // استبدال النقاط
  let redeemPoints = Math.max(0, parseInt(body.redeemPoints, 10) || 0);
  redeemPoints = Math.floor(redeemPoints / L.redeemStep) * L.redeemStep;
  redeemPoints = Math.min(redeemPoints, Math.floor((customer.points || 0) / L.redeemStep) * L.redeemStep);
  let discount = (redeemPoints / L.redeemStep) * L.redeemValueAed;
  const maxDiscount = round2(subtotal * L.maxRedeemPercent / 100);
  if (discount > maxDiscount) { redeemPoints = Math.floor(maxDiscount / L.redeemValueAed) * L.redeemStep; discount = (redeemPoints / L.redeemStep) * L.redeemValueAed; }
  const total = round2(Math.max(0, subtotal - discount + deliveryFee));
  const payment = ['cash', 'card_on_pickup'].includes(body.payment) ? body.payment : 'cash';

  const order = {
    id: crypto.randomUUID(), number: ++db.seq, createdAt: now(), updatedAt: now(), status: 'new', lang,
    branchId: branch.id, branchName: branch.name.ar, branchNameEn: branch.name.en,
    mode, car, address, note: String(body.note || '').trim().slice(0, 300),
    items, subtotal, discount: round2(discount), redeemPoints, deliveryFee, total, payment,
    customer: { id: customer.id, name: customer.name, phone: customer.phone, memberCode: customer.memberCode, tier: tierFor(customer.lifetimePoints).id },
    pointsEarned: 0, etaMinutes: MENU.ordering.prepMinutes[mode] || 15,
    history: [{ status: 'new', at: now() }],
  };
  if (redeemPoints) addPoints(customer, -redeemPoints, 'redeem', order.number);
  db.orders.push(order);
  if (db.orders.length > 5000) db.orders.splice(0, db.orders.length - 5000);
  customer.ordersCount = (customer.ordersCount || 0) + 1;
  save();
  broadcastAdmin('order', order);
  telegramNotify(order);
  return order;
}

function setStatus(order, status) {
  if (!STATUS_FLOW.includes(status) && status !== 'cancelled') throw new Error('حالة غير صالحة');
  if (order.status === 'completed' || order.status === 'cancelled') throw new Error('الطلب منتهٍ');
  order.status = status; order.updatedAt = now(); order.history.push({ status, at: now() });
  const c = db.customers[order.customer.id];
  if (status === 'completed' && c) {
    const pts = earnFor(c, order.total);
    order.pointsEarned = pts; addPoints(c, pts, 'order', order.number);
    c.totalSpent = round2((c.totalSpent || 0) + order.total);
  }
  if (status === 'cancelled' && c && order.redeemPoints) addPoints(c, order.redeemPoints, 'refund', order.number);
  save();
  broadcastAdmin('status', { id: order.id, number: order.number, status });
  notifyCustomer(order.customer.id, 'status', { id: order.id, number: order.number, status, pointsEarned: order.pointsEarned, points: c ? c.points : undefined });
}

// ───────────────────────── الملفات الثابتة
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg' };
function serveStatic(req, res, pathname) {
  let p = decodeURIComponent(pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR)) return err(res, 403, 'forbidden');
  fs.stat(file, (e, st) => {
    if (e || !st.isFile()) {
      if (!path.extname(p)) return serveStatic(req, res, '/index.html'); // SPA fallback
      return err(res, 404, 'not found');
    }
    const ext = path.extname(file).toLowerCase();
    const immutable = /^\/(img|icons)\//.test(p);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': immutable ? 'public, max-age=604800' : 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// ───────────────────────── الموجّه
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = req.socket.remoteAddress || '';
  const p = url.pathname;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (!p.startsWith('/api/')) return serveStatic(req, res, p);

    // ── عام
    if (p === '/api/menu' && req.method === 'GET') {
      const products = MENU.products.map((x) => effectiveProduct(x.id));
      return json(res, 200, { brand: MENU.brand, branches: MENU.branches, ordering: MENU.ordering, loyalty: MENU.loyalty, categories: MENU.categories, optionGroups: MENU.optionGroups, products, serverTime: now() });
    }
    if (p === '/api/health') return json(res, 200, { ok: true, orders: db.orders.length, customers: Object.keys(db.customers).length });

    // ── تسجيل الدخول (تجريبي)
    if (p === '/api/auth/login' && req.method === 'POST') {
      if (rateLimited(ip, 'login', 20, 600e3)) return err(res, 429, 'محاولات كثيرة، حاول لاحقًا');
      const b = await readBody(req);
      const phone = normPhone(b.phone); const name = String(b.name || '').trim().slice(0, 60);
      if (!validPhone(phone)) return err(res, 400, 'رقم الهاتف غير صحيح');
      let c = Object.values(db.customers).find((x) => x.phone === phone);
      let isNew = false;
      if (!c) {
        if (!name) return err(res, 400, 'أدخل اسمك');
        c = { id: crypto.randomUUID(), phone, name, memberCode: memberCode(), createdAt: now(), points: 0, lifetimePoints: 0, tokens: [], ordersCount: 0, totalSpent: 0 };
        db.customers[c.id] = c; isNew = true;
        addPoints(c, L.welcomeBonus, 'welcome');
      } else if (name && name !== c.name) c.name = name;
      const t = token(); c.tokens = [...(c.tokens || []).slice(-4), t]; sessions.set(t, c.id);
      save();
      return json(res, 200, { token: t, customer: publicCustomer(c), isNew });
    }

    // ── العميل
    const me = customerFromReq(req);
    if (p === '/api/me' && req.method === 'GET') {
      if (!me) return err(res, 401, 'سجّل الدخول');
      const orders = db.orders.filter((o) => o.customer.id === me.id).slice(-30).reverse();
      const log = db.pointsLog.filter((x) => x.customerId === me.id).slice(-30).reverse();
      return json(res, 200, { customer: publicCustomer(me), orders, pointsLog: log });
    }
    if (p === '/api/me/stream' && req.method === 'GET') {
      const t = url.searchParams.get('token'); const id = t && sessions.get(t);
      if (!id) return err(res, 401, 'سجّل الدخول');
      if (!customerClients.has(id)) customerClients.set(id, new Set());
      return openStream(req, res, customerClients.get(id), () => { if (!customerClients.get(id)?.size) customerClients.delete(id); });
    }
    if (p === '/api/orders' && req.method === 'POST') {
      if (!me) return err(res, 401, 'سجّل الدخول أولًا');
      if (rateLimited(ip, 'order', 10, 600e3)) return err(res, 429, 'طلبات كثيرة، انتظر قليلًا');
      const b = await readBody(req);
      try { const order = createOrder(me, b); return json(res, 201, { order, customer: publicCustomer(me) }); }
      catch (e) { return err(res, 400, e.message); }
    }
    let m;
    if ((m = p.match(/^\/api\/orders\/([\w-]+)$/)) && req.method === 'GET') {
      const o = db.orders.find((x) => x.id === m[1]);
      if (!o) return err(res, 404, 'الطلب غير موجود');
      if (!(me && o.customer.id === me.id) && !isAdmin(req, url)) return err(res, 403, 'غير مصرّح');
      return json(res, 200, { order: o });
    }

    // ── الإدارة
    if (p.startsWith('/api/admin/')) {
      if (p === '/api/admin/login' && req.method === 'POST') {
        if (rateLimited(ip, 'admin', 10, 600e3)) return err(res, 429, 'محاولات كثيرة');
        const b = await readBody(req);
        return safeEqual(b.pin || '', ADMIN_PIN) ? json(res, 200, { ok: true }) : err(res, 401, 'رمز غير صحيح');
      }
      if (!isAdmin(req, url)) return err(res, 401, 'رمز الإدارة مطلوب');
      if (p === '/api/admin/stream') return openStream(req, res, adminClients);
      if (p === '/api/admin/orders' && req.method === 'GET') {
        const status = url.searchParams.get('status');
        const since = url.searchParams.get('since');
        let list = db.orders;
        if (status) { const set = status.split(','); list = list.filter((o) => set.includes(o.status)); }
        if (since) list = list.filter((o) => o.createdAt >= since);
        return json(res, 200, { orders: list.slice(-300).reverse() });
      }
      if ((m = p.match(/^\/api\/admin\/orders\/([\w-]+)\/status$/)) && req.method === 'POST') {
        const o = db.orders.find((x) => x.id === m[1]); if (!o) return err(res, 404, 'الطلب غير موجود');
        const b = await readBody(req);
        try { setStatus(o, b.status); return json(res, 200, { order: o }); } catch (e) { return err(res, 400, e.message); }
      }
      if (p === '/api/admin/products' && req.method === 'GET') return json(res, 200, { products: MENU.products.map((x) => effectiveProduct(x.id)) });
      if ((m = p.match(/^\/api\/admin\/products\/([\w-]+)$/)) && req.method === 'PATCH') {
        if (!productById.has(m[1])) return err(res, 404, 'صنف غير موجود');
        const b = await readBody(req); const o = db.productOverrides[m[1]] || {};
        if (typeof b.available === 'boolean') o.available = b.available;
        if (b.price !== undefined) { const pr = Number(b.price); if (!(pr >= 0 && pr < 10000)) return err(res, 400, 'سعر غير صالح'); o.price = round2(pr); }
        if (b.reset) delete db.productOverrides[m[1]]; else db.productOverrides[m[1]] = o;
        save(); return json(res, 200, { product: effectiveProduct(m[1]) });
      }
      if (p === '/api/admin/customers' && req.method === 'GET') {
        const q = (url.searchParams.get('q') || '').toLowerCase();
        let list = Object.values(db.customers).map(publicCustomer);
        if (q) list = list.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q.replace(/\D/g, '')) || c.memberCode.toLowerCase().includes(q));
        list.sort((a, b) => b.lifetimePoints - a.lifetimePoints);
        return json(res, 200, { customers: list.slice(0, 200) });
      }
      if (p === '/api/admin/points' && req.method === 'POST') {
        // إضافة نقاط لمشتريات داخل الكوفي (بمسح رمز العضوية أو بالهاتف)
        const b = await readBody(req);
        const key = String(b.memberCode || '').toUpperCase().trim(); const phone = normPhone(b.phone);
        const c = Object.values(db.customers).find((x) => (key && x.memberCode === key) || (phone && x.phone === phone));
        if (!c) return err(res, 404, 'العضو غير موجود');
        const amount = Number(b.amountAed); const pts = b.points !== undefined ? Math.round(Number(b.points)) : earnFor(c, amount);
        if (!Number.isFinite(pts) || Math.abs(pts) > 100000) return err(res, 400, 'قيمة غير صالحة');
        addPoints(c, pts, b.points !== undefined ? 'manual' : 'instore', amount || null);
        save(); notifyCustomer(c.id, 'points', { points: c.points });
        return json(res, 200, { customer: publicCustomer(c), added: pts });
      }
      if (p === '/api/admin/stats' && req.method === 'GET') {
        const today = new Date().toISOString().slice(0, 10);
        const t = db.orders.filter((o) => o.createdAt.startsWith(today) && o.status !== 'cancelled');
        const top = {};
        for (const o of db.orders.filter((o) => o.status === 'completed')) for (const i of o.items) top[i.nameAr] = (top[i.nameAr] || 0) + i.qty;
        return json(res, 200, {
          today: { orders: t.length, revenue: round2(t.reduce((s, o) => s + o.total, 0)), byMode: t.reduce((a, o) => ((a[o.mode] = (a[o.mode] || 0) + 1), a), {}) },
          open: db.orders.filter((o) => !['completed', 'cancelled'].includes(o.status)).length,
          customers: Object.keys(db.customers).length,
          pointsOutstanding: Object.values(db.customers).reduce((s, c) => s + (c.points || 0), 0),
          topItems: Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, qty]) => ({ name, qty })),
        });
      }
      return err(res, 404, 'not found');
    }
    return err(res, 404, 'not found');
  } catch (e) {
    console.error(e);
    return err(res, 500, e.message || 'server error');
  }
});

server.listen(PORT, () => {
  console.log(`Here ☕  http://localhost:${PORT}   (شاشة الكوفي: /admin/  — الرمز: ${ADMIN_PIN === '1234' ? '1234 ⚠️ غيّره عبر ADMIN_PIN' : '••••'})`);
});
export { STATUS_AR };
