/* Here — اختبار ذاتي: يشغّل الخادم على منفذ مؤقت ويمرّ بالسيناريو الكامل (دخول، طلب، حالة، نقاط). */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

const PORT = 3900 + Math.floor(Math.random() * 100);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'here-test-'));
const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT, DATA_DIR, ADMIN_PIN: '9999' }, stdio: ['ignore', 'pipe', 'inherit'] });
const base = `http://127.0.0.1:${PORT}`;
const j = async (p, o = {}) => { const r = await fetch(base + p, { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) }, body: o.body ? JSON.stringify(o.body) : undefined }); return { status: r.status, data: await r.json() }; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0; const step = (name) => { ok++; console.log('  ✓', name); };
try {
  for (let i = 0; i < 40; i++) { try { await fetch(base + '/api/health'); break; } catch { await wait(150); } }
  const menu = (await j('/api/menu')).data;
  assert.ok(menu.products.length > 50 && menu.branches.length === 2 && menu.loyalty.redeemStep); step(`القائمة: ${menu.products.length} صنف، ${menu.categories.length} تصنيف`);
  for (const p of menu.products) assert.ok(fs.existsSync(path.join('public', p.image)), 'صورة مفقودة: ' + p.id); step('كل صور المنتجات موجودة');

  // دخول عميل
  let r = await j('/api/auth/login', { method: 'POST', body: { phone: '0501234567', name: 'محمد' } });
  assert.equal(r.status, 200); assert.equal(r.data.customer.points, menu.loyalty.welcomeBonus); step('تسجيل عميل جديد + نقاط الترحيب');
  const auth = { Authorization: 'Bearer ' + r.data.token };
  r = await j('/api/auth/login', { method: 'POST', body: { phone: '+971 50 123 4567' } }); assert.equal(r.data.isNew, false); step('نفس الرقم بصيغة مختلفة = نفس العميل');
  r = await j('/api/auth/login', { method: 'POST', body: { phone: '123', name: 'x' } }); assert.equal(r.status, 400); step('رفض رقم غير صالح');

  // طلب سيارة
  const latte = menu.products.find((p) => p.id === 'spanish-latte'), bottle = menu.products.find((p) => p.id === 'hibiscus-bottle');
  r = await j('/api/orders', { method: 'POST', headers: auth, body: { branchId: 'park', mode: 'car', car: { model: 'Patrol', color: 'أبيض', plate: 'AD 1234' }, items: [{ productId: latte.id, qty: 2, options: { milk: 'oat', sugar: 'light', extras: ['extra-shot'] } }, { productId: bottle.id, qty: 1, options: { size: 'large' } }], payment: 'cash' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const o = r.data.order; assert.equal(o.items[0].unitPrice, latte.price + 5 + 6); assert.equal(o.items[1].unitPrice, 160); assert.equal(o.total, (latte.price + 11) * 2 + 160); step(`طلب سيارة #${o.number}: التسعير من الخادم صحيح (${o.total} AED)`);
  r = await j('/api/orders', { method: 'POST', headers: auth, body: { branchId: 'park', mode: 'car', items: [{ productId: latte.id, qty: 1 }] } }); assert.equal(r.status, 400); step('رفض طلب سيارة بلا بيانات السيارة');
  r = await j('/api/orders', { method: 'POST', headers: auth, body: { branchId: 'park', mode: 'delivery', address: { text: 'x' }, items: [{ productId: 'still-water', qty: 1 }] } }); assert.equal(r.status, 400); step('رفض توصيل تحت الحد الأدنى');
  r = await j('/api/orders', { method: 'POST', body: { branchId: 'park', mode: 'pickup', items: [{ productId: latte.id, qty: 1 }] } }); assert.equal(r.status, 401); step('رفض طلب بلا تسجيل دخول');

  // الإدارة
  r = await j('/api/admin/orders'); assert.equal(r.status, 401); step('واجهة الإدارة محمية');
  const adm = { 'X-Admin-Pin': '9999' };
  r = await j('/api/admin/orders?status=new', { headers: adm }); assert.equal(r.data.orders.length, 1); assert.equal(r.data.orders[0].car.plate, 'AD 1234'); step('الطلب ظاهر في شاشة الكوفي مع بيانات السيارة');
  for (const s of ['accepted', 'preparing', 'ready', 'completed']) { r = await j(`/api/admin/orders/${o.id}/status`, { method: 'POST', headers: adm, body: { status: s } }); assert.equal(r.status, 200, s); }
  step('تدرّج الحالة حتى الاكتمال');
  r = await j('/api/me', { headers: auth }); const c = r.data.customer;
  assert.equal(c.points, menu.loyalty.welcomeBonus + Math.floor(o.total)); step(`النقاط أُضيفت بعد الاكتمال: الرصيد ${c.points}`);

  // استبدال نقاط في طلب توصيل
  r = await j('/api/orders', { method: 'POST', headers: auth, body: { branchId: 'mezairaa', mode: 'delivery', address: { text: 'ليوا، مزيرعة، فيلا 12', lat: 23.13, lng: 53.78 }, items: [{ productId: 'acai-bowl', qty: 1 }, { productId: 'iced-latte', qty: 1 }], redeemPoints: 100, payment: 'card_on_pickup' } });
  assert.equal(r.status, 201, JSON.stringify(r.data)); const o2 = r.data.order;
  assert.equal(o2.discount, menu.loyalty.redeemValueAed); assert.equal(o2.redeemPoints, 100); assert.ok(o2.address.mapsUrl.includes('23.13')); assert.equal(o2.deliveryFee, menu.ordering.deliveryFee); step(`طلب توصيل #${o2.number} مع خصم نقاط ${o2.discount} AED ورابط خريطة`);
  assert.equal(r.data.customer.points, c.points - 100); step('خُصمت النقاط المستبدلة فورًا');
  r = await j(`/api/admin/orders/${o2.id}/status`, { method: 'POST', headers: adm, body: { status: 'cancelled' } });
  r = await j('/api/me', { headers: auth }); assert.equal(r.data.customer.points, c.points); step('إلغاء الطلب يُعيد النقاط');

  // نقاط داخل الكوفي + إيقاف صنف
  r = await j('/api/admin/points', { method: 'POST', headers: adm, body: { memberCode: c.memberCode, amountAed: 40 } }); assert.equal(r.data.added, 40); step('إضافة نقاط لشراء مباشر عبر رمز العضوية');
  r = await j('/api/admin/products/latte', { method: 'PATCH', headers: adm, body: { available: false, price: 29 } }); assert.equal(r.data.product.available, false); assert.equal(r.data.product.price, 29);
  r = await j('/api/orders', { method: 'POST', headers: auth, body: { branchId: 'park', mode: 'pickup', items: [{ productId: 'latte', qty: 1 }] } }); assert.equal(r.status, 400); step('إيقاف صنف وتعديل سعره يمنع طلبه');
  r = await j('/api/admin/stats', { headers: adm }); assert.equal(r.data.customers, 1); step('الإحصائيات تعمل');

  // ثبات البيانات على القرص
  await wait(400); const db = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'db.json'), 'utf8')); assert.equal(db.orders.length, 2); step('البيانات محفوظة في db.json');
  // الملفات الثابتة
  for (const p of ['/', '/admin/', '/manifest.webmanifest', '/sw.js', '/img/logo.svg']) { const rr = await fetch(base + p); assert.equal(rr.status, 200, p); } step('الواجهات والملفات الثابتة تُقدَّم');
  console.log(`\n✅ نجحت ${ok} خطوات`);
} catch (e) { console.error('\n❌ فشل:', e); process.exitCode = 1; }
finally { srv.kill(); fs.rmSync(DATA_DIR, { recursive: true, force: true }); }
