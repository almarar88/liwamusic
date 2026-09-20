/* Here — تطبيق العملاء (بلا إطار عمل) */
const API = '';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('here.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('here.' + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem('here.' + k); } catch {} },
};

/* ───────── الترجمة */
const T = {
  ar: {
    navMenu: 'القائمة', navOrders: 'طلباتي', navMembership: 'العضوية', navAccount: 'حسابي', viewCart: 'عرض السلة',
    heroTitle: 'قهوتك جاهزة قبل ما توصل', heroSub: 'اطلب من التطبيق واستلم من الكوفي، أو من سيارتك، أو بالتوصيل.', openNow: 'مفتوح الآن', closedNow: 'مغلق الآن',
    all: 'الكل', popular: 'الأكثر طلبًا', search: 'ابحث عن مشروب أو حلى…', unavailable: 'غير متوفر', add: 'إضافة', addToCart: 'أضف للسلة', note: 'ملاحظة (اختياري)', notePh: 'مثال: بدون رغوة، حليب زيادة…',
    cart: 'السلة', emptyCart: 'سلتك فارغة', emptyCartSub: 'أضف مشروبك المفضل من القائمة.', browse: 'تصفح القائمة', subtotal: 'المجموع', checkout: 'إتمام الطلب', clear: 'تفريغ', remove: 'حذف',
    checkoutTitle: 'إتمام الطلب', branch: 'الفرع', how: 'طريقة الاستلام', pickup: 'استلام من الكوفي', car: 'من السيارة', delivery: 'توصيل', pickupHint: 'يوصلك إشعار لما يجهز طلبك، تعال للكاونتر وقل اسمك أو رقم الطلب.',
    carModel: 'نوع السيارة', carColor: 'اللون', carPlate: 'رقم اللوحة', carHint: 'قف بموقف الاستلام وسيصلك طلبك للسيارة.', address: 'العنوان', addressPh: 'المنطقة، الشارع، رقم الفيلا/البناية، علامة مميزة…', locate: 'تحديد موقعي الحالي', located: 'تم تحديد موقعك ✓', locating: 'جارٍ تحديد الموقع…', locateErr: 'تعذّر تحديد الموقع، اكتب العنوان.',
    deliveryFee: 'رسوم التوصيل', freeAbove: 'توصيل مجاني للطلبات فوق', minOrder: 'الحد الأدنى للتوصيل', points: 'النقاط', usePoints: 'استخدم نقاطك', pointsHint: '{step} نقطة = {val} درهم خصم', discount: 'الخصم', payment: 'الدفع', cash: 'نقدًا عند الاستلام', card: 'بطاقة عند الاستلام', total: 'الإجمالي', placeOrder: 'تأكيد الطلب', placing: 'جارٍ الإرسال…',
    loginTitle: 'سجّل دخولك لإتمام الطلب', loginSub: 'رقم هاتفك فقط — بلا كلمة مرور. تحصل على {bonus} نقطة ترحيبية.', phone: 'رقم الهاتف', name: 'الاسم', login: 'متابعة', welcome: 'أهلًا {name}! 🎉 أضفنا لك {bonus} نقطة', welcomeBack: 'أهلًا بعودتك {name}',
    orderPlaced: 'تم استلام طلبك ✓', orderNum: 'طلب رقم', eta: 'الوقت المتوقع', min: 'دقيقة', status: 'الحالة', items: 'الأصناف', earned: 'كسبت {n} نقطة من هذا الطلب', willEarn: 'ستكسب حوالي {n} نقطة عند اكتمال الطلب',
    s_new: 'تم الاستلام', s_accepted: 'تم القبول', s_preparing: 'قيد التحضير', s_ready: 'جاهز', s_completed: 'مكتمل', s_cancelled: 'ملغي',
    readyMsg: 'طلبك جاهز! 🎉', ordersTitle: 'طلباتي', noOrders: 'ما عندك طلبات بعد', noOrdersSub: 'أول طلب لك يبدأ من القائمة.', loginToSee: 'سجّل الدخول لعرض طلباتك', reorder: 'إعادة الطلب', back: 'رجوع',
    membership: 'عضوية Here', memberSince: 'عضو منذ', pointsBalance: 'رصيد النقاط', showAtCounter: 'أظهر هذا الرمز عند الكاونتر لتجمع نقاطك عند الشراء المباشر', toNext: 'باقي {n} نقطة للوصول إلى {tier}', topTier: 'أنت في أعلى مستوى ✦', howItWorks: 'كيف تعمل النقاط؟',
    rule1: 'تكسب {p} نقطة عن كل درهم تصرفه (بعد الخصم).', rule2: 'كل {step} نقطة = {val} درهم خصم على أي طلب.', rule3: 'كلما ارتفع مستواك زادت نقاطك: فضي ×1.25 وذهبي ×1.5.', rule4: 'تُضاف النقاط عند اكتمال الطلب.',
    history: 'سجل النقاط', r_welcome: 'هدية الترحيب', r_order: 'طلب', r_redeem: 'استبدال نقاط', r_refund: 'إرجاع نقاط', r_instore: 'شراء من الكوفي', r_manual: 'تعديل من الكوفي', joinTitle: 'انضم لعضوية Here', joinSub: 'اجمع نقاط مع كل طلب واستبدلها بخصومات. مجانًا.', join: 'انضم الآن',
    account: 'حسابي', language: 'اللغة', logout: 'تسجيل الخروج', branches: 'فروعنا', hours: 'ساعات العمل', map: 'الخريطة', install: 'أضف التطبيق لشاشتك الرئيسية', installHint: 'من قائمة المتصفح اختر «إضافة إلى الشاشة الرئيسية».', follow: 'تابعنا على انستقرام', guest: 'زائر', version: 'الإصدار',
    errNet: 'تعذّر الاتصال بالخادم', added: 'أُضيف للسلة', chooseBranch: 'اختر الفرع', required: 'مطلوب', optional: 'اختياري', choose: 'اختر', qty: 'الكمية', saveCar: 'تذكّر سيارتي', pts: 'نقطة', aed: 'درهم', noPointsYet: 'ما عندك نقاط كافية بعد — أول {step} نقطة تفتح الخصم.', maxRedeem: 'حتى {p}% من قيمة الطلب',
    installBtn: 'تثبيت التطبيق', open: 'مفتوح', closed: 'مغلق', tier_here: 'عضو', tier_silver: 'فضي', tier_gold: 'ذهبي',
  },
  en: {
    navMenu: 'Menu', navOrders: 'Orders', navMembership: 'Membership', navAccount: 'Account', viewCart: 'View cart',
    heroTitle: 'Your coffee, ready before you arrive', heroSub: 'Order in the app — pick up at the counter, from your car, or get it delivered.', openNow: 'Open now', closedNow: 'Closed now',
    all: 'All', popular: 'Popular', search: 'Search drinks or desserts…', unavailable: 'Unavailable', add: 'Add', addToCart: 'Add to cart', note: 'Note (optional)', notePh: 'e.g. no foam, extra milk…',
    cart: 'Cart', emptyCart: 'Your cart is empty', emptyCartSub: 'Add your favourite drink from the menu.', browse: 'Browse menu', subtotal: 'Subtotal', checkout: 'Checkout', clear: 'Clear', remove: 'Remove',
    checkoutTitle: 'Checkout', branch: 'Branch', how: 'How would you like it?', pickup: 'Pickup', car: 'Car', delivery: 'Delivery', pickupHint: "We'll notify you when it's ready — come to the counter and say your name or order number.",
    carModel: 'Car model', carColor: 'Colour', carPlate: 'Plate number', carHint: 'Park in the pickup spot and we will bring it to your car.', address: 'Address', addressPh: 'Area, street, villa/building number, landmark…', locate: 'Use my current location', located: 'Location captured ✓', locating: 'Locating…', locateErr: 'Could not get location — type the address.',
    deliveryFee: 'Delivery fee', freeAbove: 'Free delivery above', minOrder: 'Delivery minimum', points: 'Points', usePoints: 'Use your points', pointsHint: '{step} points = {val} AED off', discount: 'Discount', payment: 'Payment', cash: 'Cash on pickup', card: 'Card on pickup', total: 'Total', placeOrder: 'Place order', placing: 'Sending…',
    loginTitle: 'Sign in to place your order', loginSub: 'Just your phone number — no password. You get {bonus} welcome points.', phone: 'Phone number', name: 'Name', login: 'Continue', welcome: 'Welcome {name}! 🎉 {bonus} points added', welcomeBack: 'Welcome back {name}',
    orderPlaced: 'Order received ✓', orderNum: 'Order #', eta: 'Estimated time', min: 'min', status: 'Status', items: 'Items', earned: 'You earned {n} points from this order', willEarn: "You'll earn about {n} points when completed",
    s_new: 'Received', s_accepted: 'Accepted', s_preparing: 'Preparing', s_ready: 'Ready', s_completed: 'Completed', s_cancelled: 'Cancelled',
    readyMsg: 'Your order is ready! 🎉', ordersTitle: 'My orders', noOrders: 'No orders yet', noOrdersSub: 'Your first order starts from the menu.', loginToSee: 'Sign in to see your orders', reorder: 'Reorder', back: 'Back',
    membership: 'Here Membership', memberSince: 'Member since', pointsBalance: 'Points balance', showAtCounter: 'Show this code at the counter to collect points on in-store purchases', toNext: '{n} points to reach {tier}', topTier: "You're at the top tier ✦", howItWorks: 'How points work',
    rule1: 'Earn {p} point for every AED you spend (after discounts).', rule2: 'Every {step} points = {val} AED off any order.', rule3: 'Higher tiers earn faster: Silver ×1.25, Gold ×1.5.', rule4: 'Points are added when your order is completed.',
    history: 'Points history', r_welcome: 'Welcome gift', r_order: 'Order', r_redeem: 'Points redeemed', r_refund: 'Points returned', r_instore: 'In-store purchase', r_manual: 'Adjustment', joinTitle: 'Join Here Membership', joinSub: 'Collect points with every order and redeem them for discounts. Free.', join: 'Join now',
    account: 'Account', language: 'Language', logout: 'Sign out', branches: 'Our branches', hours: 'Hours', map: 'Map', install: 'Add to home screen', installHint: 'Open the browser menu and choose “Add to Home Screen”.', follow: 'Follow us on Instagram', guest: 'Guest', version: 'Version',
    errNet: 'Could not reach the server', added: 'Added to cart', chooseBranch: 'Choose branch', required: 'required', optional: 'optional', choose: 'Choose', qty: 'Qty', saveCar: 'Remember my car', pts: 'pts', aed: 'AED', noPointsYet: 'Not enough points yet — your first {step} points unlock a discount.', maxRedeem: 'up to {p}% of the order',
    installBtn: 'Install app', open: 'Open', closed: 'Closed', tier_here: 'Member', tier_silver: 'Silver', tier_gold: 'Gold',
  },
};
let lang = store.get('lang', 'ar');
const t = (k, vars = {}) => (T[lang][k] ?? T.ar[k] ?? k).replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');
const L = (obj) => (obj && typeof obj === 'object' ? obj[lang] || obj.ar || obj.en : obj);
const fmt = (n) => Number(n).toLocaleString(lang === 'ar' ? 'ar-AE' : 'en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const money = (n) => `<span class="num">${fmt(n)}</span> <small>${t('aed')}</small>`;

/* ───────── الحالة */
const S = {
  menu: null, cart: store.get('cart', []), token: store.get('token', null), customer: store.get('customer', null),
  branchId: store.get('branch', null), me: null, es: null,
};
const cartCount = () => S.cart.reduce((s, i) => s + i.qty, 0);
const cartSubtotal = () => S.cart.reduce((s, i) => s + i.unitPrice * i.qty, 0);
const product = (id) => S.menu?.products.find((p) => p.id === id);
const branch = () => S.menu?.branches.find((b) => b.id === S.branchId) || S.menu?.branches[0];
function saveCart() { store.set('cart', S.cart); renderCartBar(); }
function isOpen(b) {
  if (!b?.open || !b?.close) return true;
  const now = new Date(); const cur = now.getHours() * 60 + now.getMinutes();
  const [oh, om] = b.open.split(':').map(Number), [ch, cm] = b.close.split(':').map(Number);
  const o = oh * 60 + om, c = ch * 60 + cm;
  return c > o ? cur >= o && cur < c : cur >= o || cur < c;
}

/* ───────── الشبكة */
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (S.token) headers.Authorization = 'Bearer ' + S.token;
  let r;
  try { r = await fetch(API + path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined }); }
  catch { throw new Error(t('errNet')); }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && S.token && path !== '/api/auth/login') { logout(false); }
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}
async function loadMenu() {
  S.menu = await api('/api/menu');
  if (!S.branchId || !S.menu.branches.some((b) => b.id === S.branchId)) S.branchId = S.menu.branches[0].id;
  // تحقّق من أسعار السلة بعد تحديث القائمة
  S.cart = S.cart.filter((i) => product(i.productId));
  $('#branchLabel').textContent = L(branch().name);
}
async function refreshMe() {
  if (!S.token) { S.me = null; return; }
  try { S.me = await api('/api/me'); S.customer = S.me.customer; store.set('customer', S.customer); } catch { /* تجاهل */ }
}
function logout(navigate = true) {
  S.token = null; S.customer = null; S.me = null; store.del('token'); store.del('customer');
  if (S.es) { S.es.close(); S.es = null; }
  if (navigate) go('#/');
}
function connectStream() {
  if (!S.token || S.es || !('EventSource' in window)) return;
  const es = new EventSource(`${API}/api/me/stream?token=${encodeURIComponent(S.token)}`);
  es.addEventListener('status', (e) => {
    const d = JSON.parse(e.data);
    if (d.status === 'ready') { toast(t('readyMsg'), 'ok'); vibrate([80, 40, 80]); }
    if (d.points !== undefined && S.customer) { S.customer.points = d.points; store.set('customer', S.customer); }
    if (location.hash.startsWith('#/order/') || location.hash === '#/orders' || location.hash === '#/membership') render();
  });
  es.addEventListener('points', (e) => { const d = JSON.parse(e.data); if (S.customer) { S.customer.points = d.points; store.set('customer', S.customer); } if (location.hash === '#/membership') render(); });
  es.onerror = () => { es.close(); S.es = null; setTimeout(connectStream, 5000); };
  S.es = es;
}
const vibrate = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };

/* ───────── واجهة عامة */
function toast(msg, kind = '') {
  const el = $('#toast'); el.textContent = msg; el.className = 'toast ' + kind; clearTimeout(el._t); el._t = setTimeout(() => el.classList.add('hidden'), 2600);
}
function renderCartBar() {
  const n = cartCount(); const bar = $('#cartBar');
  bar.classList.toggle('hidden', n === 0 || ['#/cart', '#/checkout'].includes(location.hash));
  document.body.classList.toggle('has-cart', n > 0);
  $('#cartCount').textContent = fmt(n); $('#cartTotal').innerHTML = money(cartSubtotal());
}
function openSheet(html, onMount) {
  const sh = $('#sheet'); $('#sheetPanel').innerHTML = html; sh.classList.remove('hidden'); document.body.style.overflow = 'hidden';
  onMount && onMount($('#sheetPanel'));
}
function closeSheet() { $('#sheet').classList.add('hidden'); $('#sheetPanel').innerHTML = ''; document.body.style.overflow = ''; if (location.hash.startsWith('#/product/')) history.replaceState(null, '', '#/'); }
$('#sheetBackdrop').addEventListener('click', closeSheet);
$('#cartBar').addEventListener('click', () => go('#/cart'));
$('#langBtn').addEventListener('click', () => { lang = lang === 'ar' ? 'en' : 'ar'; store.set('lang', lang); applyLang(); render(); });
$('#branchBtn').addEventListener('click', () => pickBranch());
function applyLang() {
  document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  $('#langBtn').textContent = lang === 'ar' ? 'EN' : 'ع';
  document.querySelectorAll('[data-t]').forEach((el) => (el.textContent = t(el.dataset.t)));
  if (S.menu) $('#branchLabel').textContent = L(branch().name);
}
function pickBranch() {
  openSheet(`<h2>${t('chooseBranch')}</h2><div class="branch-pick">${S.menu.branches.map((b) => `
    <div class="branch-opt ${b.id === S.branchId ? 'on' : ''}" data-id="${b.id}"><div><b>${esc(L(b.name))}</b><span class="small muted">${esc(L(b.area))} · ${esc(b.hours)}</span></div><span class="status-pill ${isOpen(b) ? 'ready' : 'cancelled'}">${isOpen(b) ? t('open') : t('closed')}</span></div>`).join('')}</div>`,
    (p) => p.querySelectorAll('.branch-opt').forEach((el) => el.addEventListener('click', () => { S.branchId = el.dataset.id; store.set('branch', S.branchId); $('#branchLabel').textContent = L(branch().name); closeSheet(); render(); })));
}
const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

/* ───────── الشاشات */
function viewMenu() {
  const m = S.menu; const b = branch(); const q = (S.q || '').trim().toLowerCase();
  const cats = m.categories.filter((c) => m.products.some((p) => p.category === c.id));
  const filtered = m.products.filter((p) => !q || L(p.name).toLowerCase().includes(q) || p.name.en.toLowerCase().includes(q) || p.name.ar.includes(q));
  const popular = filtered.filter((p) => p.tags.includes('popular'));
  const card = (p) => `<a class="card ${p.available ? '' : 'off'}" href="#/product/${p.id}">
      ${p.tags.includes('new') ? `<span class="badge new">${lang === 'ar' ? 'جديد' : 'NEW'}</span>` : p.tags.includes('popular') ? `<span class="badge">★ ${t('popular')}</span>` : ''}
      <div class="img"><img src="${p.image}" alt="${esc(L(p.name))}" loading="lazy" width="800" height="600"></div>
      <div class="body"><div class="name">${esc(L(p.name))}</div><div class="desc">${esc(L(p.description))}</div>
      <div class="foot"><span class="price">${p.available ? money(p.price) : `<span class="muted small">${t('unavailable')}</span>`}</span><span class="add" aria-label="${t('add')}">+</span></div></div></a>`;
  return `
    <div class="hero"><img src="img/hero.jpg" alt=""><div class="overlay"></div>
      <span class="chip">${isOpen(b) ? '🟢 ' + t('openNow') : '🔴 ' + t('closedNow')} · ${esc(b.hours)}</span>
      <div class="text"><h1>${t('heroTitle')}</h1><p>${t('heroSub')}</p></div></div>
    <div class="search">🔍 <input id="q" placeholder="${t('search')}" value="${esc(S.q || '')}" autocomplete="off"></div>
    <div class="chips" id="chips"><button class="chip active" data-cat="top">${t('all')}</button>${popular.length ? `<button class="chip" data-cat="popular">★ ${t('popular')}</button>` : ''}${cats.map((c) => `<button class="chip" data-cat="${c.id}">${c.icon} ${esc(L(c.name))}</button>`).join('')}</div>
    ${!q && popular.length ? `<div class="section-title" id="sec-popular"><h2>★ ${t('popular')}</h2></div><div class="grid">${popular.slice(0, 6).map(card).join('')}</div>` : ''}
    ${cats.map((c) => { const ps = filtered.filter((p) => p.category === c.id); return ps.length ? `<div class="section-title" id="sec-${c.id}"><h2>${c.icon} ${esc(L(c.name))}</h2><span class="muted small">${ps.length}</span></div><div class="grid">${ps.map(card).join('')}</div>` : ''; }).join('')}
    ${!filtered.length ? `<div class="empty"><div class="big">🫗</div>${lang === 'ar' ? 'لا نتائج' : 'No results'}</div>` : ''}
    <p class="muted small" style="text-align:center;margin-top:28px">${lang === 'ar' ? 'الأسعار شاملة الضريبة' : 'Prices include VAT'} · <a href="${m.brand.instagram}" target="_blank" rel="noopener">@here_ae</a></p>`;
}
function mountMenu() {
  const chips = $('#chips');
  chips.addEventListener('click', (e) => {
    const c = e.target.closest('.chip'); if (!c) return;
    chips.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === c));
    const target = c.dataset.cat === 'top' ? $('#view') : $('#sec-' + c.dataset.cat);
    if (target) window.scrollTo({ top: c.dataset.cat === 'top' ? 0 : target.getBoundingClientRect().top + window.scrollY - 120, behavior: 'smooth' });
  });
  const q = $('#q'); let tm;
  q.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { S.q = q.value; const pos = q.selectionStart; render(); const nq = $('#q'); nq.focus(); nq.setSelectionRange(pos, pos); }, 250); });
}

function viewProduct(id) {
  const p = product(id); if (!p) return `<div class="empty">?</div>`;
  const groups = S.menu.optionGroups[p.optionGroup] || [];
  const sel = {}; for (const g of groups) sel[g.id] = g.multi ? [] : (g.required ? g.choices[0].id : null);
  let qty = 1;
  const unit = () => p.price + groups.reduce((s, g) => s + (g.multi ? g.choices.filter((c) => sel[g.id].includes(c.id)).reduce((a, c) => a + c.price, 0) : (g.choices.find((c) => c.id === sel[g.id])?.price || 0)), 0);
  openSheet(`
    <img class="hero-img" src="${p.image}" alt="">
    <h2>${esc(L(p.name))}</h2><div class="muted small">${lang === 'ar' ? esc(p.name.en) : esc(p.name.ar)}</div>
    <p class="muted" style="margin:8px 0 0">${esc(L(p.description))}</p>
    ${groups.map((g) => `<div class="opt-group"><h4>${esc(L(g.name))}<small>${g.required ? t('required') : t('optional')}</small></h4><div class="opts" data-g="${g.id}">${g.choices.map((c) => `<button class="opt ${g.multi ? '' : sel[g.id] === c.id ? 'on' : ''}" data-c="${c.id}">${esc(L(c.name))}${c.price ? `<span class="extra">+${fmt(c.price)}</span>` : ''}</button>`).join('')}</div></div>`).join('')}
    <div class="opt-group field"><label>${t('note')}</label><input id="pnote" placeholder="${t('notePh')}" maxlength="120"></div>
    <div class="sticky-cta row between"><div class="stepper"><button id="dec">−</button><span id="qty">1</span><button id="inc">+</button></div>
      <button class="btn" id="addBtn" style="flex:1" ${p.available ? '' : 'disabled'}>${p.available ? t('addToCart') : t('unavailable')} · <span id="ptotal">${money(unit())}</span></button></div>`,
    (panel) => {
      const upd = () => { $('#qty', panel).textContent = qty; $('#ptotal', panel).innerHTML = money(unit() * qty); };
      panel.querySelectorAll('.opts').forEach((box) => box.addEventListener('click', (e) => {
        const btn = e.target.closest('.opt'); if (!btn) return; const g = groups.find((x) => x.id === box.dataset.g);
        if (g.multi) { const i = sel[g.id].indexOf(btn.dataset.c); i >= 0 ? sel[g.id].splice(i, 1) : sel[g.id].push(btn.dataset.c); btn.classList.toggle('on'); }
        else { sel[g.id] = btn.dataset.c; box.querySelectorAll('.opt').forEach((x) => x.classList.toggle('on', x === btn)); }
        upd();
      }));
      $('#inc', panel).onclick = () => { qty = Math.min(20, qty + 1); upd(); };
      $('#dec', panel).onclick = () => { qty = Math.max(1, qty - 1); upd(); };
      $('#addBtn', panel).onclick = () => {
        const optionsText = groups.flatMap((g) => g.multi ? g.choices.filter((c) => sel[g.id].includes(c.id)).map((c) => L(c.name)) : (() => { const c = g.choices.find((c) => c.id === sel[g.id]); return c && (c.price || !g.required || g.id !== 'milk' || c.id !== 'fresh') ? [L(c.name)] : []; })());
        const key = p.id + JSON.stringify(sel) + ($('#pnote', panel).value || '');
        const ex = S.cart.find((i) => i.key === key);
        if (ex) ex.qty = Math.min(20, ex.qty + qty); else S.cart.push({ key, productId: p.id, qty, options: JSON.parse(JSON.stringify(sel)), unitPrice: unit(), optionsText: optionsText.join('، '), note: $('#pnote', panel).value.trim() });
        saveCart(); closeSheet(); vibrate(30); toast(`${t('added')} ✓`, 'ok'); history.replaceState(null, '', '#/');
      };
    });
  return null;
}

function viewCart() {
  if (!S.cart.length) return `<h1>${t('cart')}</h1><div class="empty"><div class="big">🛒</div><b>${t('emptyCart')}</b><br><span class="small">${t('emptyCartSub')}</span><br><br><a class="btn secondary" href="#/" style="width:auto">${t('browse')}</a></div>`;
  return `<div class="row between"><h1 style="margin:0">${t('cart')}</h1><button class="btn ghost" id="clearCart">${t('clear')}</button></div>
    <div class="stack" style="margin-top:14px">${S.cart.map((i, idx) => { const p = product(i.productId); return `<div class="list-row"><img class="thumb" src="${p.image}" alt=""><div style="flex:1;min-width:0"><b>${esc(L(p.name))}</b><div class="small muted">${esc(i.optionsText)}${i.note ? ' · ' + esc(i.note) : ''}</div><div class="price" style="margin-top:4px">${money(i.unitPrice * i.qty)}</div></div>
      <div class="stepper"><button data-i="${idx}" data-d="-1">−</button><span>${i.qty}</span><button data-i="${idx}" data-d="1">+</button></div></div>`; }).join('')}</div>
    <div class="panel" style="margin-top:14px"><div class="summary"><div><span>${t('subtotal')}</span><span>${money(cartSubtotal())}</span></div></div></div>
    <div style="margin-top:14px"><a class="btn" href="#/checkout">${t('checkout')} · ${money(cartSubtotal())}</a></div>`;
}
function mountCart() {
  $('#view').addEventListener('click', (e) => {
    const b = e.target.closest('.stepper button'); if (b) { const i = +b.dataset.i; S.cart[i].qty += +b.dataset.d; if (S.cart[i].qty <= 0) S.cart.splice(i, 1); saveCart(); render(); }
    if (e.target.id === 'clearCart') { S.cart = []; saveCart(); render(); }
  });
}

function viewCheckout() {
  if (!S.cart.length) return viewCart();
  const m = S.menu; const b = branch(); const ord = m.ordering; const ly = m.loyalty;
  const st = S.co || (S.co = { mode: store.get('mode', 'pickup'), car: store.get('car', { model: '', color: '', plate: '' }), address: store.get('address', { text: '', lat: null, lng: null }), note: '', redeem: 0, payment: 'cash', saveCar: true });
  if (!b.modes.includes(st.mode)) st.mode = b.modes[0];
  const sub = cartSubtotal();
  const pts = S.customer?.points || 0; const maxByPts = Math.floor(pts / ly.redeemStep) * ly.redeemStep;
  const maxByOrder = Math.floor((sub * ly.maxRedeemPercent / 100) / ly.redeemValueAed) * ly.redeemStep;
  const maxRedeem = Math.min(maxByPts, maxByOrder); st.redeem = Math.min(st.redeem, maxRedeem);
  const discount = st.redeem / ly.redeemStep * ly.redeemValueAed;
  const fee = st.mode === 'delivery' && sub < ord.freeDeliveryAbove ? ord.deliveryFee : 0;
  const total = Math.max(0, sub - discount + fee);
  const mult = S.customer?.multiplier || 1;
  return `<h1>${t('checkoutTitle')}</h1>
    <div class="panel"><h3>${t('branch')}</h3><div class="branch-pick">${m.branches.map((x) => `<div class="branch-opt ${x.id === b.id ? 'on' : ''}" data-branch="${x.id}"><div><b>${esc(L(x.name))}</b><span class="small muted">${esc(L(x.area))} · ${esc(x.hours)}</span></div><span class="status-pill ${isOpen(x) ? 'ready' : 'cancelled'}">${isOpen(x) ? t('open') : t('closed')}</span></div>`).join('')}</div></div>
    <div class="panel"><h3>${t('how')}</h3>
      <div class="tabs" id="modes">${b.modes.map((mo) => `<button class="${st.mode === mo ? 'on' : ''}" data-mode="${mo}">${{ pickup: '🏪', car: '🚗', delivery: '🛵' }[mo]} ${t(mo)}</button>`).join('')}</div>
      <div style="margin-top:12px">
      ${st.mode === 'pickup' ? `<div class="note-box">${t('pickupHint')} ⏱ ~${ord.prepMinutes.pickup} ${t('min')}</div>` : ''}
      ${st.mode === 'car' ? `<div class="stack"><div class="form-grid"><div class="field"><label>${t('carModel')} *</label><input id="carModel" value="${esc(st.car.model)}" placeholder="Land Cruiser"></div><div class="field"><label>${t('carColor')} *</label><input id="carColor" value="${esc(st.car.color)}" placeholder="${lang === 'ar' ? 'أبيض' : 'White'}"></div></div>
        <div class="field"><label>${t('carPlate')}</label><input id="carPlate" value="${esc(st.car.plate)}" dir="ltr" placeholder="AD 12345"></div><label class="row small"><input type="checkbox" id="saveCar" ${st.saveCar ? 'checked' : ''}> ${t('saveCar')}</label><div class="note-box">${t('carHint')} ⏱ ~${ord.prepMinutes.car} ${t('min')}</div></div>` : ''}
      ${st.mode === 'delivery' ? `<div class="stack"><div class="field"><label>${t('address')} *</label><textarea id="addr" placeholder="${t('addressPh')}">${esc(st.address.text)}</textarea></div>
        <button class="btn secondary" id="locate">📍 ${st.address.lat ? t('located') : t('locate')}</button>
        <div class="note-box">${t('deliveryFee')}: ${fmt(ord.deliveryFee)} ${t('aed')} · ${t('freeAbove')} ${fmt(ord.freeDeliveryAbove)} ${t('aed')} · ${t('minOrder')} ${fmt(ord.deliveryMinimum)} ${t('aed')} · ⏱ ~${ord.prepMinutes.delivery} ${t('min')}</div></div>` : ''}
      </div></div>
    <div class="panel"><h3>${t('items')} (${fmt(cartCount())})</h3><div class="stack">${S.cart.map((i) => { const p = product(i.productId); return `<div class="row between small"><span>${i.qty}× ${esc(L(p.name))} <span class="muted">${esc(i.optionsText)}</span></span><span class="num">${fmt(i.unitPrice * i.qty)}</span></div>`; }).join('')}</div>
      <div class="field" style="margin-top:10px"><label>${t('note')}</label><input id="onote" value="${esc(st.note)}" placeholder="${t('notePh')}" maxlength="200"></div></div>
    <div class="panel"><h3>✦ ${t('points')} ${S.customer ? `<span class="muted small">— ${fmt(pts)} ${t('pts')}</span>` : ''}</h3>
      ${!S.customer ? `<div class="small muted">${t('loginSub', { bonus: ly.welcomeBonus })}</div>` : maxByPts < ly.redeemStep ? `<div class="small muted">${t('noPointsYet', { step: ly.redeemStep })}</div>` :
        `<div class="row between"><span class="small">${t('usePoints')}<br><span class="muted">${t('pointsHint', { step: ly.redeemStep, val: ly.redeemValueAed })} · ${t('maxRedeem', { p: ly.maxRedeemPercent })}</span></span><div class="stepper"><button id="rdec">−</button><span>${fmt(st.redeem)}</span><button id="rinc">+</button></div></div>`}
      <div class="small muted" style="margin-top:8px">${t('willEarn', { n: Math.floor(total * ly.pointsPerAed * mult) })}</div></div>
    <div class="panel"><h3>${t('payment')}</h3><div class="tabs" id="pay"><button class="${st.payment === 'cash' ? 'on' : ''}" data-pay="cash">💵 ${t('cash')}</button><button class="${st.payment === 'card_on_pickup' ? 'on' : ''}" data-pay="card_on_pickup">💳 ${t('card')}</button></div></div>
    <div class="panel"><div class="summary"><div><span>${t('subtotal')}</span><span>${money(sub)}</span></div>${discount ? `<div style="color:var(--ok)"><span>${t('discount')} (${fmt(st.redeem)} ${t('pts')})</span><span>− ${money(discount)}</span></div>` : ''}${st.mode === 'delivery' ? `<div><span>${t('deliveryFee')}</span><span>${fee ? money(fee) : (lang === 'ar' ? 'مجاني' : 'Free')}</span></div>` : ''}<div class="total"><span>${t('total')}</span><span>${money(total)}</span></div></div></div>
    <div id="coErr" class="err-box hidden" style="margin-top:12px"></div>
    <div style="margin-top:14px"><button class="btn accent" id="place" ${isOpen(b) ? '' : ''}>${t('placeOrder')} · ${money(total)}</button>${!isOpen(b) ? `<div class="small muted" style="text-align:center;margin-top:8px">${t('closedNow')} · ${esc(b.hours)}</div>` : ''}</div>`;
}
function mountCheckout() {
  const st = S.co; const v = $('#view');
  const sync = () => { const g = (id) => $(id, v)?.value?.trim() ?? ''; if (st.mode === 'car') st.car = { model: g('#carModel'), color: g('#carColor'), plate: g('#carPlate') }; if (st.mode === 'delivery') st.address.text = g('#addr'); st.note = g('#onote'); st.saveCar = $('#saveCar', v)?.checked ?? st.saveCar; };
  v.addEventListener('click', async (e) => {
    const br = e.target.closest('[data-branch]'); if (br) { sync(); S.branchId = br.dataset.branch; store.set('branch', S.branchId); $('#branchLabel').textContent = L(branch().name); return render(); }
    const mo = e.target.closest('[data-mode]'); if (mo) { sync(); st.mode = mo.dataset.mode; store.set('mode', st.mode); return render(); }
    const py = e.target.closest('[data-pay]'); if (py) { sync(); st.payment = py.dataset.pay; return render(); }
    if (e.target.id === 'rinc' || e.target.id === 'rdec') { sync(); st.redeem += (e.target.id === 'rinc' ? 1 : -1) * S.menu.loyalty.redeemStep; if (st.redeem < 0) st.redeem = 0; return render(); }
    if (e.target.id === 'locate') {
      sync(); const btn = e.target; btn.textContent = '📍 ' + t('locating');
      navigator.geolocation?.getCurrentPosition((pos) => { st.address.lat = +pos.coords.latitude.toFixed(6); st.address.lng = +pos.coords.longitude.toFixed(6); toast(t('located'), 'ok'); render(); }, () => { toast(t('locateErr'), 'err'); render(); }, { enableHighAccuracy: true, timeout: 12000 });
      return;
    }
    if (e.target.id === 'place') {
      sync();
      if (!S.token) return loginSheet(() => render());
      const btn = e.target; btn.disabled = true; btn.textContent = t('placing'); $('#coErr').classList.add('hidden');
      try {
        const body = { lang, branchId: S.branchId, mode: st.mode, items: S.cart.map((i) => ({ productId: i.productId, qty: i.qty, options: i.options })), car: st.car, address: st.address, note: [st.note, ...S.cart.filter((i) => i.note).map((i) => `${L(product(i.productId).name)}: ${i.note}`)].filter(Boolean).join(' | '), redeemPoints: st.redeem, payment: st.payment };
        const r = await api('/api/orders', { method: 'POST', body });
        S.customer = r.customer; store.set('customer', S.customer);
        if (st.mode === 'car' && st.saveCar) store.set('car', st.car); if (st.mode === 'delivery') store.set('address', st.address);
        S.cart = []; saveCart(); S.co = null; vibrate([40, 30, 40]);
        go('#/order/' + r.order.id + '?new=1');
      } catch (err) { const eb = $('#coErr'); eb.textContent = err.message; eb.classList.remove('hidden'); btn.disabled = false; btn.textContent = t('placeOrder'); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }
    }
  });
}

function loginSheet(after) {
  const ly = S.menu.loyalty;
  openSheet(`<h2>${t('loginTitle')}</h2><p class="muted small">${t('loginSub', { bonus: ly.welcomeBonus })}</p>
    <div class="stack"><div class="field"><label>${t('phone')}</label><input id="lphone" type="tel" inputmode="tel" dir="ltr" placeholder="05x xxx xxxx" autocomplete="tel"></div>
    <div class="field"><label>${t('name')}</label><input id="lname" placeholder="${lang === 'ar' ? 'اسمك' : 'Your name'}" autocomplete="name"></div>
    <div id="lerr" class="err-box hidden"></div><button class="btn" id="lgo">${t('login')}</button></div>`,
    (p) => { $('#lphone', p).focus(); $('#lgo', p).onclick = async () => {
      const btn = $('#lgo', p); btn.disabled = true;
      try { const r = await api('/api/auth/login', { method: 'POST', body: { phone: $('#lphone', p).value, name: $('#lname', p).value } });
        S.token = r.token; S.customer = r.customer; store.set('token', S.token); store.set('customer', S.customer); closeSheet(); connectStream();
        toast(r.isNew ? t('welcome', { name: r.customer.name, bonus: ly.welcomeBonus }) : t('welcomeBack', { name: r.customer.name }), 'ok'); after && after();
      } catch (e) { const eb = $('#lerr', p); eb.textContent = e.message; eb.classList.remove('hidden'); btn.disabled = false; } };
      p.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#lgo', p).click(); }); });
}

async function viewOrder(id, isNew) {
  let o; try { o = (await api('/api/orders/' + id)).order; } catch (e) { return `<div class="empty">${esc(e.message)}</div>`; }
  const steps = ['new', 'accepted', 'preparing', 'ready', 'completed']; const idx = steps.indexOf(o.status);
  const modeIcon = { pickup: '🏪', car: '🚗', delivery: '🛵' }[o.mode];
  return `${isNew ? `<div class="ok-box" style="margin-bottom:12px;font-size:15px">✓ ${t('orderPlaced')}</div>` : ''}
    <div class="row between"><h1 style="margin:0">${t('orderNum')} <span class="num">${o.number}</span></h1><span class="status-pill ${o.status}">${t('s_' + o.status)}</span></div>
    <div class="muted small">${new Date(o.createdAt).toLocaleString(lang === 'ar' ? 'ar-AE' : 'en-AE')} · ${esc(lang === 'ar' ? o.branchName : o.branchNameEn)}</div>
    ${o.status !== 'cancelled' ? `<div class="timeline">${steps.map((s, i) => `<div class="step ${i < idx ? 'done' : ''} ${i === idx ? 'now done' : ''}"><div class="dot"></div>${t('s_' + s)}</div>`).join('')}</div>` : ''}
    ${o.status === 'ready' ? `<div class="ok-box" style="font-size:16px;text-align:center">${t('readyMsg')}</div>` : ['new', 'accepted', 'preparing'].includes(o.status) ? `<div class="note-box">⏱ ${t('eta')}: ~${o.etaMinutes} ${t('min')}</div>` : ''}
    <div class="panel" style="margin-top:12px"><h3>${modeIcon} ${t(o.mode)}</h3>
      ${o.mode === 'car' ? `<div class="small">${esc(o.car.model)} · ${esc(o.car.color)} ${o.car.plate ? '· <span dir="ltr">' + esc(o.car.plate) + '</span>' : ''}</div>` : ''}
      ${o.mode === 'delivery' ? `<div class="small">${esc(o.address.text)} ${o.address.mapsUrl ? `· <a href="${o.address.mapsUrl}" target="_blank" rel="noopener" style="text-decoration:underline">${t('map')}</a>` : ''}</div>` : ''}
      ${o.mode === 'pickup' ? `<div class="small muted">${t('pickupHint')}</div>` : ''}
      ${o.note ? `<div class="small muted" style="margin-top:6px">📝 ${esc(o.note)}</div>` : ''}</div>
    <div class="panel"><h3>${t('items')}</h3><div class="stack">${o.items.map((i) => `<div class="row between small"><span>${i.qty}× ${esc(lang === 'ar' ? i.nameAr : i.nameEn)} <span class="muted">${esc(i.optionsText)}</span></span><span class="num">${fmt(i.lineTotal)}</span></div>`).join('')}</div>
      <div class="summary" style="margin-top:10px"><div><span>${t('subtotal')}</span><span>${money(o.subtotal)}</span></div>${o.discount ? `<div style="color:var(--ok)"><span>${t('discount')}</span><span>− ${money(o.discount)}</span></div>` : ''}${o.deliveryFee ? `<div><span>${t('deliveryFee')}</span><span>${money(o.deliveryFee)}</span></div>` : ''}<div class="total"><span>${t('total')}</span><span>${money(o.total)}</span></div></div>
      <div class="small muted" style="margin-top:6px">${o.payment === 'cash' ? '💵 ' + t('cash') : '💳 ' + t('card')}</div></div>
    <div class="ok-box" style="margin-top:12px">✦ ${o.status === 'completed' ? t('earned', { n: o.pointsEarned }) : t('willEarn', { n: Math.floor(o.total * S.menu.loyalty.pointsPerAed * (S.customer?.multiplier || 1)) })}</div>
    <div class="row" style="margin-top:14px"><a class="btn secondary" href="#/orders">${t('ordersTitle')}</a><button class="btn" id="reorder">${t('reorder')}</button></div>`;
}
function mountOrder(id) {
  $('#reorder')?.addEventListener('click', async () => {
    const o = (await api('/api/orders/' + id)).order;
    for (const i of o.items) { const p = product(i.productId); if (!p || !p.available) continue; const key = p.id + JSON.stringify(i.options); const ex = S.cart.find((x) => x.key === key); if (ex) ex.qty += i.qty; else S.cart.push({ key, productId: p.id, qty: i.qty, options: i.options, unitPrice: i.unitPrice, optionsText: i.optionsText, note: '' }); }
    saveCart(); go('#/cart');
  });
  // تحديث دوري احتياطي إن لم يعمل البث الحي
  clearInterval(S.poll); S.poll = setInterval(() => { if (location.hash.startsWith('#/order/')) render(true); else clearInterval(S.poll); }, 20000);
}

async function viewOrders() {
  if (!S.token) return `<h1>${t('ordersTitle')}</h1><div class="empty"><div class="big">🧾</div><b>${t('loginToSee')}</b><br><br><button class="btn secondary" id="loginBtn" style="width:auto">${t('login')}</button></div>`;
  await refreshMe(); const list = S.me?.orders || [];
  if (!list.length) return `<h1>${t('ordersTitle')}</h1><div class="empty"><div class="big">☕</div><b>${t('noOrders')}</b><br><span class="small">${t('noOrdersSub')}</span><br><br><a class="btn secondary" href="#/" style="width:auto">${t('browse')}</a></div>`;
  return `<h1>${t('ordersTitle')}</h1><div class="stack">${list.map((o) => `<a class="order-row" href="#/order/${o.id}"><div><b>#${o.number}</b> <span class="muted small">${{ pickup: '🏪', car: '🚗', delivery: '🛵' }[o.mode]} · ${new Date(o.createdAt).toLocaleString(lang === 'ar' ? 'ar-AE' : 'en-AE', { dateStyle: 'medium', timeStyle: 'short' })}</span><div class="small muted">${o.items.map((i) => `${i.qty}× ${lang === 'ar' ? i.nameAr : i.nameEn}`).join('، ').slice(0, 70)}</div></div><div style="text-align:end"><span class="status-pill ${o.status}">${t('s_' + o.status)}</span><div class="price" style="margin-top:4px">${money(o.total)}</div></div></a>`).join('')}</div>`;
}

async function viewMembership() {
  const ly = S.menu.loyalty;
  const tiersHtml = (cur) => `<div class="tiers">${ly.tiers.map((x) => `<div class="tier-box ${x.id === cur ? 'on' : ''}"><b>${esc(L(x.name))}</b>${x.min ? `${fmt(x.min)}+ ${t('pts')}` : '0+'}<br>×${x.multiplier}</div>`).join('')}</div>`;
  const rules = `<div class="panel"><h3>${t('howItWorks')}</h3><ul class="perks"><li>${t('rule1', { p: ly.pointsPerAed })}</li><li>${t('rule2', { step: ly.redeemStep, val: ly.redeemValueAed })}</li><li>${t('rule3')}</li><li>${t('rule4')}</li></ul></div>`;
  if (!S.token) return `<h1>${t('membership')}</h1><div class="member-card"><span class="wordmark">here</span><span class="tier">✦ ${t('membership')}</span><div class="name">${t('joinTitle')}</div><div class="small" style="opacity:.85;margin-top:4px">${t('joinSub')}</div><div class="pts"><b>+${ly.welcomeBonus}</b><span>${t('pts')}</span></div></div>
    <div style="margin:14px 0"><button class="btn" id="loginBtn">${t('join')}</button></div>${tiersHtml(null)}<br>${rules}`;
  await refreshMe(); const c = S.customer; if (!c) return '';
  const tier = ly.tiers.find((x) => x.id === c.tier) || ly.tiers[0];
  const prog = c.nextTier ? Math.min(100, Math.round((c.lifetimePoints - tier.min) / (c.nextTier.min - tier.min) * 100)) : 100;
  return `<h1>${t('membership')}</h1>
    <div class="member-card ${c.tier}"><span class="wordmark">here</span><span class="tier">✦ ${esc(L(c.tierName))}</span><div class="name">${esc(c.name)}</div><div class="code">${esc(c.memberCode)}</div><div class="pts"><b>${fmt(c.points)}</b><span>${t('pts')}</span></div></div>
    <div class="qr-box"><div id="qr"></div><div class="small muted" style="text-align:center">${t('showAtCounter')}</div></div>
    <div class="panel" style="margin-top:12px">${c.nextTier ? `<div class="small" style="margin-bottom:6px">${t('toNext', { n: fmt(c.nextTier.remaining), tier: L(c.nextTier.name) })}</div>` : `<div class="small" style="margin-bottom:6px">${t('topTier')}</div>`}<div class="progress"><i style="width:${prog}%"></i></div>
      <ul class="perks">${(L(tier.perks) || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
    <div style="margin-top:12px">${tiersHtml(c.tier)}</div><br>${rules}
    <div class="panel"><h3>${t('history')}</h3>${(S.me?.pointsLog || []).length ? S.me.pointsLog.map((x) => `<div class="log-row"><span>${t('r_' + x.reason)}${x.ref ? ' #' + x.ref : ''}<br><span class="muted small">${new Date(x.at).toLocaleString(lang === 'ar' ? 'ar-AE' : 'en-AE', { dateStyle: 'medium', timeStyle: 'short' })}</span></span><span class="${x.points > 0 ? 'plus' : 'minus'}">${x.points > 0 ? '+' : ''}${fmt(x.points)}</span></div>`).join('') : `<div class="muted small">—</div>`}</div>`;
}
function mountMembership() {
  const box = $('#qr'); if (!box || !S.customer) return;
  try { const qr = window.qrcode(0, 'M'); qr.addData(S.customer.memberCode); qr.make(); box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); }
  catch { box.innerHTML = `<div class="code num" style="font-size:22px;letter-spacing:.15em">${esc(S.customer.memberCode)}</div>`; }
}

function viewAccount() {
  const m = S.menu; const c = S.customer;
  return `<h1>${t('account')}</h1>
    <div class="panel"><div class="row between"><div><b>${c ? esc(c.name) : t('guest')}</b><div class="small muted" dir="ltr" style="text-align:start">${c ? '+' + esc(c.phone) : ''}</div></div>${c ? `<button class="btn danger sm" id="logoutBtn">${t('logout')}</button>` : `<button class="btn sm" id="loginBtn">${t('login')}</button>`}</div></div>
    <div class="panel"><div class="row between"><span>${t('language')}</span><div class="tabs" style="width:160px"><button class="${lang === 'ar' ? 'on' : ''}" data-lang="ar">العربية</button><button class="${lang === 'en' ? 'on' : ''}" data-lang="en">English</button></div></div></div>
    <div class="panel"><h3>${t('branches')}</h3><div class="stack">${m.branches.map((b) => `<div class="row between"><div><b>${esc(L(b.name))}</b><div class="small muted">${esc(L(b.area))} · ${t('hours')}: ${esc(b.hours)}</div></div><a class="btn secondary sm" href="${b.maps}" target="_blank" rel="noopener">🗺 ${t('map')}</a></div>`).join('')}</div></div>
    <div class="panel"><h3>📲 ${t('install')}</h3><div class="small muted" id="installHint">${t('installHint')}</div><div id="installBox" class="hidden" style="margin-top:10px"><button class="btn secondary" id="installBtn">${t('installBtn')}</button></div></div>
    <div class="panel"><a class="row between" href="${m.brand.instagram}" target="_blank" rel="noopener"><span>📸 ${t('follow')}</span><span dir="ltr">@here_ae ↗</span></a></div>
    <p class="muted small" style="text-align:center;margin-top:20px"><span class="wordmark" style="font-size:16px">here</span><br>${t('version')} 0.1 · ${lang === 'ar' ? 'نسخة تجريبية' : 'Preview build'}</p>`;
}
function mountAccount() {
  const v = $('#view');
  v.addEventListener('click', (e) => {
    if (e.target.id === 'logoutBtn') { logout(); toast(t('logout'), ''); }
    const lb = e.target.closest('[data-lang]'); if (lb) { lang = lb.dataset.lang; store.set('lang', lang); applyLang(); render(); }
    if (e.target.id === 'installBtn' && S.installPrompt) { S.installPrompt.prompt(); }
  });
  if (S.installPrompt) $('#installBox').classList.remove('hidden');
}

/* ───────── التوجيه */
const routes = [
  [/^#\/?$/, () => viewMenu(), mountMenu, 'menu'],
  [/^#\/product\/([\w-]+)/, (m) => viewProduct(m[1]), null, 'menu'],
  [/^#\/cart$/, () => viewCart(), mountCart, 'menu'],
  [/^#\/checkout$/, () => viewCheckout(), mountCheckout, 'menu'],
  [/^#\/order\/([\w-]+)(\?new=1)?/, (m) => viewOrder(m[1], !!m[2]), (m) => mountOrder(m[1]), 'orders'],
  [/^#\/orders$/, () => viewOrders(), null, 'orders'],
  [/^#\/membership$/, () => viewMembership(), mountMembership, 'membership'],
  [/^#\/account$/, () => viewAccount(), mountAccount, 'account'],
];
let renderSeq = 0;
async function render(silent = false) {
  if (!S.menu) return;
  const hash = location.hash || '#/'; const seq = ++renderSeq;
  const route = routes.find((r) => r[0].test(hash)) || routes[0]; const m = hash.match(route[0]) || [];
  document.querySelectorAll('.bottom-nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === route[3]));
  let view = $('#view');
  if (route[1] !== routes[1][1]) { const fresh = view.cloneNode(false); view.replaceWith(fresh); view = fresh; }
  if (route[1] === routes[1][1]) { // منتج: شيت فوق القائمة
    if (!view.innerHTML || S.lastRoute !== 'menu') { view.innerHTML = viewMenu(); mountMenu(); S.lastRoute = 'menu'; }
    viewProduct(m[1]); renderCartBar(); return;
  }
  if (!silent && route[1].constructor.name === 'AsyncFunction') view.innerHTML = '<div class="skeleton"></div>';
  const html = await route[1](m);
  if (seq !== renderSeq) return;
  if (html !== null) { view.innerHTML = html; S.lastRoute = route[3] === 'menu' && hash === '#/' ? 'menu' : hash; route[2] && route[2](m); }
  if (!silent && !hash.startsWith('#/product')) window.scrollTo(0, 0);
  renderCartBar();
  view.querySelectorAll('#loginBtn').forEach((b) => b.addEventListener('click', () => loginSheet(() => render())));
}
window.addEventListener('hashchange', () => { if ($('#sheet').classList.contains('hidden') === false) closeSheet(); render(); });
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installPrompt = e; $('#installBox')?.classList.remove('hidden'); });

/* ───────── التشغيل */
(async () => {
  applyLang();
  try { await loadMenu(); } catch (e) { $('#view').innerHTML = `<div class="empty"><div class="big">⚠️</div>${esc(e.message)}<br><br><button class="btn secondary" style="width:auto" onclick="location.reload()">↻</button></div>`; return; }
  applyLang();
  if (S.token) { refreshMe().then(() => { if (!S.token) render(); }); connectStream(); }
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
