/* Here — شاشة الكوفي */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n).toLocaleString('en-AE', { maximumFractionDigits: 2 });
const STATUS = { new: 'جديد', accepted: 'مقبول', preparing: 'قيد التحضير', ready: 'جاهز', completed: 'مكتمل', cancelled: 'ملغي' };
const MODE = { pickup: '🏪 استلام', car: '🚗 سيارة', delivery: '🛵 توصيل' };
const PAY = { cash: '💵 نقدًا', card_on_pickup: '💳 بطاقة' };
let pin = sessionStorage.getItem('here.pin') || '';
let tab = 'orders';
const S = { orders: [], products: [], es: null, sound: false, menu: null };

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', 'X-Admin-Pin': pin, ...(opts.headers || {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) { doLogout(); throw new Error(d.error || 'غير مصرّح'); }
  if (!r.ok) throw new Error(d.error || r.statusText);
  return d;
}
function toast(msg, kind = '') { const el = $('#toast'); el.textContent = msg; el.className = 'toast ' + kind; clearTimeout(el._t); el._t = setTimeout(() => el.classList.add('hidden'), 2500); }

/* ── الدخول */
async function doLogin() {
  const v = $('#pin').value.trim(); if (!v) return;
  try { pin = v; await api('/api/admin/login', { method: 'POST', body: { pin: v } }); sessionStorage.setItem('here.pin', v); start(); }
  catch (e) { pin = ''; const eb = $('#pinErr'); eb.textContent = e.message; eb.classList.remove('hidden'); }
}
function doLogout() { pin = ''; sessionStorage.removeItem('here.pin'); S.es?.close(); S.es = null; $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); }
$('#pinBtn').onclick = doLogin; $('#pin').addEventListener('keydown', (e) => e.key === 'Enter' && doLogin());
$('#logoutBtn').onclick = doLogout;
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (!b) return; tab = b.dataset.tab; $('#tabs').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); render(); });

/* ── الصوت والإشعارات */
let audioCtx;
function beep(times = 3) {
  if (!S.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.connect(g); g.connect(audioCtx.destination);
      o.type = 'sine'; o.frequency.value = i % 2 ? 1046 : 880; const t0 = audioCtx.currentTime + i * 0.28;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);
      o.start(t0); o.stop(t0 + 0.25);
    }
  } catch {}
}
$('#soundBtn').onclick = async () => {
  S.sound = !S.sound; $('#soundBtn').textContent = S.sound ? '🔔 الصوت مفعّل' : '🔕';
  if (S.sound) { beep(1); if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); }
};
function notify(o) {
  beep(3);
  if ('Notification' in window && Notification.permission === 'granted') try { new Notification(`طلب جديد #${o.number} — ${MODE[o.mode]}`, { body: o.items.map((i) => `${i.qty}× ${i.nameAr}`).join('، ') + ` — ${fmt(o.total)} AED`, icon: '../icons/icon-192.png', tag: o.id }); } catch {}
  flashTitle();
}
let flashT; function flashTitle() { let on = false; clearInterval(flashT); flashT = setInterval(() => { document.title = (on = !on) ? '🔴 طلب جديد!' : 'Here — شاشة الكوفي'; }, 900); setTimeout(() => { clearInterval(flashT); document.title = 'Here — شاشة الكوفي'; }, 15000); }
document.addEventListener('visibilitychange', () => { if (!document.hidden) { clearInterval(flashT); document.title = 'Here — شاشة الكوفي'; } });

/* ── البث الحي */
function connect() {
  if (S.es) S.es.close();
  const es = new EventSource('/api/admin/stream?pin=' + encodeURIComponent(pin));
  es.onopen = () => $('#conn').classList.remove('off');
  es.addEventListener('order', (e) => { const o = JSON.parse(e.data); if (!S.orders.some((x) => x.id === o.id)) S.orders.unshift(o); notify(o); render(); });
  es.addEventListener('status', (e) => { const d = JSON.parse(e.data); const o = S.orders.find((x) => x.id === d.id); if (o) o.status = d.status; else loadOrders(); render(); });
  es.onerror = () => { $('#conn').classList.add('off'); es.close(); S.es = null; setTimeout(connect, 4000); };
  S.es = es;
}
async function loadOrders() { const d = await api('/api/admin/orders'); S.orders = d.orders; }
async function start() {
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  try { await loadOrders(); S.menu = await fetch('/api/menu').then((r) => r.json()); } catch (e) { toast(e.message, 'err'); return; }
  connect(); render();
  setInterval(async () => { if (!S.es) { try { await loadOrders(); render(); } catch {} } else if (tab === 'orders') updateAges(); }, 15000);
}

/* ── الطلبات */
const ago = (iso) => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'الآن' : m < 60 ? `منذ ${m} د` : `منذ ${Math.floor(m / 60)} س ${m % 60} د`; };
function updateAges() { document.querySelectorAll('[data-ago]').forEach((el) => { const m = (Date.now() - new Date(el.dataset.ago)) / 60000; el.textContent = ago(el.dataset.ago); el.classList.toggle('late', m > 20); }); }
function orderCard(o, compact = false) {
  const next = { new: ['accepted', 'قبول الطلب', 'ok'], accepted: ['preparing', 'بدء التحضير', 'warn'], preparing: ['ready', 'جاهز ✓', 'ok'], ready: ['completed', o.mode === 'delivery' ? 'تم التوصيل' : 'تم التسليم', ''] }[o.status];
  return `<div class="card ${o.status}" data-id="${o.id}">
    <div class="head"><div><b>#${o.number}</b> <span class="mode ${o.mode}">${MODE[o.mode]}</span></div><span class="ago" data-ago="${o.createdAt}">${ago(o.createdAt)}</span></div>
    <div class="small muted">${esc(o.branchName)} · ${new Date(o.createdAt).toLocaleTimeString('ar-AE', { hour: '2-digit', minute: '2-digit' })} · ${PAY[o.payment] || o.payment}</div>
    <div class="detail">👤 <b>${esc(o.customer.name)}</b> · <a class="tel" href="tel:+${esc(o.customer.phone)}">+${esc(o.customer.phone)}</a> ${o.customer.tier && o.customer.tier !== 'here' ? `<span class="tier ${o.customer.tier}">${o.customer.tier === 'gold' ? 'ذهبي' : 'فضي'}</span>` : ''}</div>
    ${o.mode === 'car' ? `<div class="detail car">🚗 <b>${esc(o.car.model)}</b> · ${esc(o.car.color)} ${o.car.plate ? `· <span class="num" dir="ltr">${esc(o.car.plate)}</span>` : ''}</div>` : ''}
    ${o.mode === 'delivery' ? `<div class="detail delivery">📍 ${esc(o.address.text) || '—'} ${o.address.mapsUrl ? `<br><a href="${o.address.mapsUrl}" target="_blank" rel="noopener">🗺 فتح الموقع في الخرائط ↗</a>` : ''}</div>` : ''}
    <ul class="items">${o.items.map((i) => `<li><span><b>${i.qty}×</b> ${esc(i.nameAr)} <span class="small muted">${esc(i.nameEn)}</span>${i.optionsText ? `<span class="opts">${esc(i.optionsText)}</span>` : ''}</span><span class="num">${fmt(i.lineTotal)}</span></li>`).join('')}</ul>
    ${o.note ? `<div class="note">📝 ${esc(o.note)}</div>` : ''}
    <div class="total"><span>الإجمالي ${o.discount ? `<span class="small muted">(خصم نقاط ${fmt(o.discount)})</span>` : ''}${o.deliveryFee ? `<span class="small muted">(+توصيل ${fmt(o.deliveryFee)})</span>` : ''}</span><span class="num">${fmt(o.total)} AED</span></div>
    ${compact ? `<div style="margin-top:6px"><span class="status ${o.status}">${STATUS[o.status]}</span> ${o.pointsEarned ? `<span class="small muted">✦ +${o.pointsEarned} نقطة</span>` : ''}</div>` : `<div class="actions">${next ? `<button class="btn ${next[2]}" data-status="${next[0]}">${next[1]}</button>` : ''}${o.status !== 'ready' ? `<button class="btn light" data-status="ready" style="flex:0">جاهز</button>` : ''}<button class="btn danger" data-status="cancelled" style="flex:0">إلغاء</button></div>`}
  </div>`;
}
function viewOrders() {
  const open = S.orders.filter((o) => !['completed', 'cancelled'].includes(o.status));
  const col = (title, list, cls) => `<div class="col"><h2>${title} <span class="pill ${list.length ? '' : 'zero'}">${list.length}</span></h2>${list.map((o) => orderCard(o)).join('') || `<div class="empty">لا شيء هنا</div>`}</div>`;
  $('#openCount').textContent = open.length; $('#openCount').classList.toggle('zero', !open.length);
  return `<div class="board">${col('🟡 جديد', open.filter((o) => o.status === 'new'))}${col('🟠 قيد التحضير', open.filter((o) => ['accepted', 'preparing'].includes(o.status)))}${col('🟢 جاهز للتسليم', open.filter((o) => o.status === 'ready'))}</div>`;
}
function viewHistory() {
  const done = S.orders.filter((o) => ['completed', 'cancelled'].includes(o.status));
  const q = (S.hq || '').toLowerCase();
  const list = done.filter((o) => !q || String(o.number).includes(q) || o.customer.name.toLowerCase().includes(q) || o.customer.phone.includes(q));
  return `<div class="toolbar"><input id="hq" placeholder="بحث برقم الطلب أو الاسم أو الهاتف" value="${esc(S.hq || '')}"><span class="muted small">${list.length} طلب</span></div>
    <div class="board">${list.slice(0, 60).map((o) => orderCard(o, true)).join('') || '<div class="empty">لا طلبات مكتملة بعد</div>'}</div>`;
}
async function setStatus(id, status) {
  if (status === 'cancelled' && !confirm('إلغاء الطلب؟ ستُعاد نقاط العميل إن استُخدمت.')) return;
  try { const d = await api(`/api/admin/orders/${id}/status`, { method: 'POST', body: { status } }); const i = S.orders.findIndex((x) => x.id === id); if (i >= 0) S.orders[i] = d.order; render(); toast(`#${d.order.number} → ${STATUS[status]}`, 'ok'); }
  catch (e) { toast(e.message, 'err'); }
}

/* ── المنتجات */
async function viewProducts() {
  if (!S.products.length) S.products = (await api('/api/admin/products')).products;
  const cats = S.menu.categories; const q = (S.pq || '').toLowerCase();
  const rows = S.products.filter((p) => !q || p.name.ar.includes(q) || p.name.en.toLowerCase().includes(q));
  return `<div class="toolbar"><input id="pq" placeholder="بحث عن صنف" value="${esc(S.pq || '')}"><span class="muted small">${S.products.filter((p) => !p.available).length} صنف موقوف</span></div>
    <table><thead><tr><th></th><th>الصنف</th><th>التصنيف</th><th>السعر (AED)</th><th>متوفر</th></tr></thead><tbody>
    ${rows.map((p) => `<tr data-pid="${p.id}"><td><img src="../${p.image}" alt=""></td><td><b>${esc(p.name.ar)}</b><br><span class="small muted">${esc(p.name.en)}</span></td><td class="small">${esc(cats.find((c) => c.id === p.category)?.name.ar || p.category)}</td><td><input type="number" step="0.5" min="0" value="${p.price}" data-price></td><td><button class="switch ${p.available ? 'on' : ''}" data-avail aria-label="متوفر"></button></td></tr>`).join('')}
    </tbody></table>`;
}
async function patchProduct(id, body) {
  try { const d = await api('/api/admin/products/' + id, { method: 'PATCH', body }); const i = S.products.findIndex((p) => p.id === id); S.products[i] = d.product; toast('تم الحفظ ✓', 'ok'); } catch (e) { toast(e.message, 'err'); }
}

/* ── العضويات */
async function viewMembers() {
  const d = await api('/api/admin/customers?q=' + encodeURIComponent(S.mq || ''));
  const ly = S.menu.loyalty;
  return `<div class="panel"><h3>✦ إضافة نقاط لشراء داخل الكوفي</h3><div class="form">
      <label>رمز العضوية أو رقم الهاتف<input id="mcode" placeholder="HERE-XXXXXX أو 05xxxxxxxx" dir="ltr" style="min-width:220px"></label>
      <label>قيمة الفاتورة (AED)<input id="mamount" type="number" min="0" step="0.5" style="width:120px"></label>
      <button class="btn accent" id="maddBtn">إضافة النقاط</button>
      <span class="small muted">تُحسب تلقائيًا: ${ly.pointsPerAed} نقطة لكل درهم × مضاعف المستوى. امسح رمز QR من بطاقة العميل بأي قارئ ثم ألصقه هنا.</span></div>
      <div id="mres" style="margin-top:8px"></div></div>
    <div class="panel"><h3>الأعضاء (${d.customers.length})</h3><div class="toolbar"><input id="mq" placeholder="بحث بالاسم أو الهاتف أو الرمز" value="${esc(S.mq || '')}"></div>
    <table><thead><tr><th>الاسم</th><th>الهاتف</th><th>الرمز</th><th>المستوى</th><th>الرصيد</th><th>إجمالي النقاط</th><th>الطلبات</th><th>الإنفاق</th><th>انضم</th></tr></thead><tbody>
    ${d.customers.map((c) => `<tr><td><b>${esc(c.name)}</b></td><td><a class="tel" href="tel:+${esc(c.phone)}">+${esc(c.phone)}</a></td><td class="num small" dir="ltr">${esc(c.memberCode)}</td><td><span class="tier ${c.tier}">${esc(c.tierName.ar)}</span></td><td class="num"><b>${fmt(c.points)}</b></td><td class="num">${fmt(c.lifetimePoints)}</td><td class="num">${c.ordersCount}</td><td class="num">${fmt(c.totalSpent)}</td><td class="small muted">${new Date(c.createdAt).toLocaleDateString('ar-AE')}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">لا أعضاء بعد</td></tr>'}
    </tbody></table></div>`;
}

/* ── الإحصائيات */
async function viewStats() {
  const s = await api('/api/admin/stats');
  return `<div class="stats"><div class="stat"><b>${s.today.orders}</b><span>طلبات اليوم</span></div><div class="stat"><b>${fmt(s.today.revenue)}</b><span>مبيعات اليوم (AED)</span></div><div class="stat"><b>${s.open}</b><span>طلبات مفتوحة</span></div><div class="stat"><b>${s.customers}</b><span>أعضاء</span></div><div class="stat"><b>${fmt(s.pointsOutstanding)}</b><span>نقاط قائمة (≈ ${fmt(s.pointsOutstanding / S.menu.loyalty.redeemStep * S.menu.loyalty.redeemValueAed)} AED)</span></div></div>
    <div class="panel"><h3>اليوم حسب طريقة الاستلام</h3>${Object.entries(s.today.byMode).map(([m, n]) => `<div>${MODE[m]}: <b class="num">${n}</b></div>`).join('') || '<span class="muted">—</span>'}</div>
    <div class="panel"><h3>الأكثر مبيعًا (الطلبات المكتملة)</h3>${s.topItems.map((x, i) => `<div>${i + 1}. ${esc(x.name)} — <b class="num">${x.qty}</b></div>`).join('') || '<span class="muted">—</span>'}</div>`;
}

/* ── العرض */
let seq = 0;
async function render() {
  const my = ++seq; const main = $('#main');
  try {
    const html = await ({ orders: viewOrders, history: viewHistory, products: viewProducts, members: viewMembers, stats: viewStats }[tab])();
    if (my !== seq) return; main.innerHTML = html;
  } catch (e) { main.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
$('#main').addEventListener('click', (e) => {
  const st = e.target.closest('[data-status]'); if (st) return setStatus(st.closest('[data-id]').dataset.id, st.dataset.status);
  const av = e.target.closest('[data-avail]'); if (av) { const id = av.closest('[data-pid]').dataset.pid; const p = S.products.find((x) => x.id === id); av.classList.toggle('on'); return patchProduct(id, { available: !p.available }); }
  if (e.target.id === 'maddBtn') {
    const code = $('#mcode').value.trim(); const amount = $('#mamount').value;
    const body = /^\+?\d[\d\s-]{7,}$/.test(code) ? { phone: code, amountAed: amount } : { memberCode: code, amountAed: amount };
    api('/api/admin/points', { method: 'POST', body }).then((d) => { $('#mres').innerHTML = `<div class="status completed">✓ أُضيفت ${d.added} نقطة لـ ${esc(d.customer.name)} — الرصيد الآن ${fmt(d.customer.points)}</div>`; $('#mcode').value = ''; $('#mamount').value = ''; render().then(() => { $('#mres').innerHTML = `<div class="status completed">✓ أُضيفت ${d.added} نقطة لـ ${esc(d.customer.name)} — الرصيد الآن ${fmt(d.customer.points)}</div>`; }); }).catch((err) => { $('#mres').innerHTML = `<span class="err">${esc(err.message)}</span>`; });
  }
});
$('#main').addEventListener('change', (e) => { const pr = e.target.closest('[data-price]'); if (pr) patchProduct(pr.closest('[data-pid]').dataset.pid, { price: pr.value }); });
let inputTm;
$('#main').addEventListener('input', (e) => {
  if (e.target.id === 'pq') { S.pq = e.target.value; clearTimeout(inputTm); inputTm = setTimeout(() => { const pos = e.target.selectionStart; render().then(() => { const n = $('#pq'); n?.focus(); n?.setSelectionRange(pos, pos); }); }, 250); }
  if (e.target.id === 'hq') { S.hq = e.target.value; clearTimeout(inputTm); inputTm = setTimeout(() => { const pos = e.target.selectionStart; render().then(() => { const n = $('#hq'); n?.focus(); n?.setSelectionRange(pos, pos); }); }, 250); }
  if (e.target.id === 'mq') { S.mq = e.target.value; clearTimeout(inputTm); inputTm = setTimeout(() => { const pos = e.target.selectionStart; render().then(() => { const n = $('#mq'); n?.focus(); n?.setSelectionRange(pos, pos); }); }, 350); }
});
if (pin) start();
