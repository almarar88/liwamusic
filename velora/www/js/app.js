/**
 * Velora — banking simulator UI. All balances, cards, transfers and trades
 * are simulated locally on the device; nothing touches a real bank or market.
 */
import {
  OPENING_BALANCE, USD_AED, fmt, round2, validateIban, formatIban, cleanIban, makeIban,
  CATEGORIES, seedTransactions, monthlySpend, spendByCategory, ASSETS, seedHistory, step,
  buy, sell, portfolioValue, txRef, rng,
} from './core.js';

const KEY = 'velora.v1';
const PIN = '1234';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ACCOUNT_IBAN = makeIban('AE', '999' + '1027048815390021');

const sv = (d, w = 22) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  send: sv('<path d="M7 17 17 7"/><path d="M8 7h9v9"/>'),
  bills: sv('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
  fx: sv('<path d="M4 8h13l-3-3"/><path d="M20 16H7l3 3"/>'),
  doc: sv('<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 13h6M9 17h4"/>'),
  eye: sv('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', 16),
  eyeOff: sv('<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>', 16),
  snow: sv('<path d="M12 2v20M4.9 6.5l14.2 11M4.9 17.5l14.2-11"/><path d="m9 4 3 2 3-2M9 20l3-2 3 2"/>'),
  key: sv('<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 9.2-9.2M17 6l3 3M14 9l2 2"/>'),
  sliders: sv('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  globe: sv('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  plane: sv('<path d="M10.5 13.5 3 11l1.5-1.5 8 1 4-4.5c1-1 2.5-1.5 3.5-.5s.5 2.5-.5 3.5l-4.5 4 1 8L14.5 22 12 14.5"/>'),
  wave: sv('<path d="M6 8a8 8 0 0 1 0 8M10 6a12 12 0 0 1 0 12M14 4a16 16 0 0 1 0 16"/>'),
  arrowR: sv('<path d="M5 12h14M13 6l6 6-6 6"/>', 24),
  swap: sv('<path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/>'),
  finger: sv('<path d="M12 11v4M8 14a4 4 0 0 1 8 0v1M5 10a7 7 0 0 1 14 0v4M17 18c-.5 1.5-1.5 3-2.5 3.5M9 20.5c-1-1-1.5-2.5-1.5-4M3 13a9 9 0 0 1 1-4M12 4c2 0 3.5.6 5 1.6"/>', 30),
  copy: sv('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>', 14),
  lock: sv('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  reset: sv('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  bell: sv('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
  spark: sv('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>'),
  plus: sv('<path d="M12 5v14M5 12h14"/>', 24),
  nfc: '<svg class="nfc" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 8.5a5 5 0 0 1 0 7M11.5 6a9 9 0 0 1 0 12M15 3.5a13 13 0 0 1 0 17"/></svg>',
};

function freshState() {
  return {
    v: 1,
    balance: OPENING_BALANCE,
    savings: 0,
    hide: false,
    txs: seedTransactions(),
    cards: {
      debit: { frozen: false, online: true, intl: true, contactless: true, limit: 50000 },
      credit: { frozen: false, online: true, intl: true, contactless: true, limit: 250000, used: 12430.5 },
    },
    holdings: {},
    benes: [
      { name: 'Omar Khalid', iban: makeIban('AE', '033' + '0000123456789012') },
      { name: 'Sara Ahmed', iban: makeIban('AE', '026' + '0000987654321098') },
      { name: 'London Rentals Ltd', iban: makeIban('GB', 'NWBK60161331926819') },
    ],
    notes: [
      { ts: Date.now() - 3600e3, t: 'Welcome to Velora', s: 'Your Private Banking account is ready. Opening balance AED 5,000,000.00' },
      { ts: Date.now() - 7200e3, t: 'Card ready', s: 'Your Velora Infinite credit card is active.' },
    ],
    unread: true,
  };
}

let S;
try { S = JSON.parse(localStorage.getItem(KEY)) || freshState(); } catch { S = freshState(); }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* storage unavailable */ } };
save();

// ---------- feel: haptics, ripple, stagger, count-up, confetti ----------
function haptic(kind = 'light') {
  try {
    const h = window.Capacitor?.Plugins?.Haptics;
    if (h) {
      if (kind === 'success' || kind === 'error') h.notification({ type: kind.toUpperCase() });
      else h.impact({ style: kind.toUpperCase() });
    } else navigator.vibrate?.(kind === 'error' ? [30, 40, 30] : kind === 'success' ? [12, 40, 18] : 8);
  } catch { /* no haptics */ }
}

document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.btn, .item, .chip, .rp, .spad button, .seg button, .qa span, .ctrl span, .keypad button');
  if (!el) return;
  el.classList.add('rp');
  const r = el.getBoundingClientRect(); const size = Math.max(r.width, r.height) * 2.2;
  const s = document.createElement('span');
  s.className = 'ripple';
  s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
  el.appendChild(s); setTimeout(() => s.remove(), 650);
}, { passive: true });

function stagger(root) { $$('.st', root).forEach((el, i) => el.style.setProperty('--i', Math.min(i, 14))); }

function splitMoney(n) { const s = fmt(n, ''); const [i, d] = s.split('.'); return [i, d || '00']; }
function countUp(el, to, from = 0, dur = 1200, draw) {
  const t0 = performance.now();
  const paint = draw || ((v) => { const [i, d] = splitMoney(v); el.innerHTML = `${i}<span class="dec">.${d}</span>`; });
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / dur); const e = 1 - Math.pow(1 - p, 4);
    paint(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(tick);
  };
  paint(from);
  requestAnimationFrame(tick);
}

const fx = $('#fx'); const fctx = fx.getContext('2d');
function confetti() {
  const dpr = window.devicePixelRatio || 1;
  fx.width = innerWidth * dpr; fx.height = innerHeight * dpr; fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cols = ['#ffe3ad', '#e3b96f', '#7c8cff', '#4fd1ff', '#2ee59d', '#ff8aa0', '#ffffff'];
  const P = Array.from({ length: 150 }, () => ({
    x: innerWidth / 2, y: innerHeight * 0.38, vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 15 - 4,
    w: 5 + Math.random() * 6, h: 8 + Math.random() * 8, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
    c: cols[Math.floor(Math.random() * cols.length)], o: 1,
  }));
  const t0 = performance.now();
  const loop = (t) => {
    fctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of P) {
      p.vy += 0.42; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      if (t - t0 > 1500) p.o = Math.max(0, p.o - 0.025);
      fctx.save(); fctx.globalAlpha = p.o; fctx.translate(p.x, p.y); fctx.rotate(p.r);
      fctx.fillStyle = p.c; fctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2))); fctx.restore();
    }
    if (t - t0 < 2800) requestAnimationFrame(loop); else fctx.clearRect(0, 0, innerWidth, innerHeight);
  };
  requestAnimationFrame(loop);
}

// ---------- market simulation ----------
const HUE = { AAPL: 215, NVDA: 95, MSFT: 195, TSLA: 355, AMZN: 30, GOOGL: 140, META: 225, BTC: 32, ETH: 245, SOL: 275, XRP: 200, BNB: 45, DOGE: 50 };
const prices = {};
const hist = {};
for (const a of ASSETS) { hist[a.sym] = seedHistory(a); prices[a.sym] = a.price; }
const lastPx = { ...prices };
setInterval(() => {
  for (const a of ASSETS) {
    lastPx[a.sym] = prices[a.sym];
    prices[a.sym] = step(prices[a.sym], a.vol / 3);
    hist[a.sym].push(prices[a.sym]);
    if (hist[a.sym].length > 120) hist[a.sym].shift();
  }
  liveUpdate();
}, 2500);
const chg = (sym) => { const h = hist[sym]; return (h[h.length - 1] - h[0]) / h[0] * 100; };
const usd = (n) => n >= 1000 ? '$' + fmt(n, '', 2) : n >= 1 ? '$' + n.toFixed(2) : '$' + n.toFixed(4);
const coin = (sym) => `<div class="coin" style="--h:${HUE[sym] ?? 220}">${sym}</div>`;

const RANGES = { LIVE: { pts: 0, vol: 0, span: 0 }, '1D': { pts: 80, vol: 1, span: 864e5 }, '1W': { pts: 80, vol: 2.2, span: 6048e5 }, '1M': { pts: 90, vol: 4, span: 2592e6 }, '1Y': { pts: 100, vol: 10, span: 31536e6 } };
const rangeCache = {};
function rangeHist(sym, r) {
  if (r === 'LIVE') return hist[sym];
  const k = sym + r;
  if (!rangeCache[k]) {
    const a = ASSETS.find((x) => x.sym === sym); const R = RANGES[r];
    const rnd = rng([...k].reduce((s, c) => s * 33 + c.charCodeAt(0), 7));
    const out = [prices[sym]];
    for (let i = 1; i < R.pts; i++) out.unshift(out[0] / (1 + (rnd() - 0.485) * a.vol * R.vol));
    rangeCache[k] = out;
  }
  return rangeCache[k];
}

// ---------- helpers ----------
let toastT;
function toast(msg, ic = '✓') {
  const t = $('#toast'); t.innerHTML = `<span>${ic}</span>${esc(msg)}`; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2300);
}
function money(n, cur = 'AED') { return S.hide ? `${cur} ••••••` : fmt(n, cur); }
function when(ts) {
  const d = new Date(ts); const now = new Date();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`;
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) + `, ${time}`;
}
function addTx(tx) { S.txs.unshift({ id: txRef(), ts: Date.now(), ...tx }); }
function note(t, s) { S.notes.unshift({ ts: Date.now(), t, s }); S.unread = true; $('#bellDot').classList.remove('hidden'); }
function txItem(t, st = false) {
  const c = CATEGORIES[t.cat] || CATEGORIES.transfer;
  const via = t.via === 'credit' ? 'Credit card' : t.via === 'debit' ? 'Debit card' : 'Account';
  return `<div class="item ${st ? 'st' : ''}"><div class="ico" style="--c:${c.color}">${c.icon}</div>
    <div class="sp"><div class="t">${esc(t.title)}</div><div class="s">${when(t.ts)} · ${via}</div></div>
    <div class="amt num ${t.amount > 0 ? 'up' : ''}">${t.amount > 0 ? '+' : ''}${S.hide ? '••••' : fmt(t.amount, '')}</div></div>`;
}
function linePts(arr, w, h, pad = 8) {
  const min = Math.min(...arr); const max = Math.max(...arr); const rg = max - min || 1;
  return arr.map((v, i) => [i / (arr.length - 1) * w, h - pad - (v - min) / rg * (h - pad * 2)]);
}
function smooth(pts) {
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]; const [x1, y1] = pts[i]; const mx = (x0 + x1) / 2;
    d += ` C${mx.toFixed(1)},${y0.toFixed(1)} ${mx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}
function spark(arr, w = 72, h = 32) {
  const pts = linePts(arr, w, h, 3);
  const col = arr[arr.length - 1] >= arr[0] ? 'var(--up)' : 'var(--down)';
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path fill="none" stroke="${col}" stroke-width="1.8" vector-effect="non-scaling-stroke" d="${smooth(pts)}"/></svg>`;
}

// ---------- sheet with drag-to-dismiss ----------
let sheetToken = 0;
function openSheet(html, onMount) {
  const sh = $('#sheet'); const body = $('#sheetBody');
  sheetToken++;
  const wasHidden = sh.classList.contains('hidden');
  sh.classList.remove('hidden', 'closing');
  body.style.transform = '';
  body.innerHTML = `<div class="grab" id="grab"></div>${html}`;
  body.scrollTop = 0;
  if (!wasHidden) { body.style.animation = 'none'; void body.offsetWidth; body.style.animation = ''; }
  stagger(body);
  bindGrab(body);
  onMount?.(body);
}
function closeSheet() {
  const sh = $('#sheet'); if (sh.classList.contains('hidden')) return;
  const tok = ++sheetToken; openAsset = null;
  sh.classList.add('closing');
  setTimeout(() => { if (tok !== sheetToken) return; sh.classList.add('hidden'); sh.classList.remove('closing'); $('#sheetBody').innerHTML = ''; }, 340);
}
function bindGrab(body) {
  const g = $('#grab', body); let y0 = null; let dy = 0;
  g.addEventListener('pointerdown', (e) => { y0 = e.clientY; dy = 0; g.setPointerCapture(e.pointerId); body.style.transition = 'none'; });
  g.addEventListener('pointermove', (e) => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); body.style.transform = `translateY(${dy}px)`; });
  const end = () => {
    if (y0 == null) return; y0 = null; body.style.transition = 'transform .4s cubic-bezier(.34,1.56,.64,1)';
    if (dy > 110) closeSheet(); else body.style.transform = '';
  };
  g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
}
$('#sheet').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });

/** Custom PIN pad confirmation, reused by every money movement. */
function confirmPin(title, rows, onOk) {
  openSheet(`<h3>${esc(title)}</h3>
    <div class="box st">${rows.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><span class="num" style="text-align:right;overflow-wrap:anywhere">${esc(v)}</span></div>`).join('')}</div>
    <div class="mut st" style="text-align:center;margin:20px 0 12px;font-size:13px">Enter your PIN to authorise · demo 1234</div>
    <div class="spin st" id="spin"><i></i><i></i><i></i><i></i></div>
    <div class="spad st">${['1', '2', '3', '4', '5', '6', '7', '8', '9', 'x', '0', '⌫'].map((k) => k === 'x' ? '<button data-close class="mut" style="font-size:14px">Cancel</button>' : `<button data-k="${k}">${k}</button>`).join('')}</div>`, (el) => {
    let v = '';
    const dots = $('#spin', el);
    const draw = () => [...dots.children].forEach((d, i) => d.classList.toggle('f', i < v.length));
    $$('[data-k]', el).forEach((b) => b.onclick = () => {
      haptic('light');
      const k = b.dataset.k;
      if (k === '⌫') v = v.slice(0, -1); else if (v.length < 4) v += k;
      draw();
      if (v.length === 4) {
        if (v === PIN) { [...dots.children].forEach((d) => { d.style.background = 'var(--up)'; d.style.borderColor = 'var(--up)'; }); setTimeout(onOk, 220); }
        else { haptic('error'); dots.classList.add('shake'); setTimeout(() => { dots.classList.remove('shake'); v = ''; draw(); }, 420); }
      }
    });
  });
}

function receipt({ title, amount, rows, ref }) {
  openSheet(`<div class="receipt">
      <div class="check"><svg viewBox="0 0 100 100"><circle class="circ" cx="50" cy="50" r="45" fill="rgba(46,229,157,.1)" stroke="#2ee59d" stroke-width="4"/>
        <path class="tick" d="M30 52l13 13 27-29" fill="none" stroke="#2ee59d" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <div class="mut">${esc(title)}</div>
      <div class="amt num" id="ramt">AED 0.00</div>
      <div class="box st" style="margin-top:18px">${rows.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><span class="num" style="text-align:right;max-width:62%;overflow-wrap:anywhere">${esc(v)}</span></div>`).join('')}
        <div class="kv"><span>Reference</span><span class="num">${ref}</span></div>
        <div class="kv"><span>Date</span><span>${new Date().toLocaleString('en-GB')}</span></div><div class="tear"></div></div>
      <div class="stamp st">SIMULATION · NO REAL FUNDS WERE MOVED</div>
      <button class="btn st" style="margin-top:18px" data-close>Done</button></div>`, (el) => {
    countUp($('#ramt', el), amount, 0, 900, (v) => { $('#ramt', el).textContent = fmt(v); });
  });
  haptic('success');
  setTimeout(confetti, 250);
}

// ---------- tabs ----------
let tab = 'home';
const views = { home, cards, pay, invest, insights };
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || b.dataset.tab === tab) return;
  haptic('light'); go(b.dataset.tab);
});
function moveInd() {
  const b = $(`#tabs [data-tab="${tab}"]`); const ind = $('#tabInd');
  if (!b) return;
  ind.style.opacity = tab === 'pay' ? 0 : 1;
  ind.style.width = `${b.offsetWidth - 10}px`;
  ind.style.transform = `translateX(${b.offsetLeft + 5}px)`;
}
addEventListener('resize', moveInd);
function go(t, opts) {
  tab = t;
  for (const b of $$('#tabs button')) b.classList.toggle('on', b.dataset.tab === t);
  moveInd();
  $('#view').scrollTop = 0;
  render(opts, true);
}
function render(opts, animate) {
  const v = $('#view');
  v.classList.remove('enter');
  if (animate) { void v.offsetWidth; v.classList.add('enter'); }
  v.innerHTML = '';
  views[tab](opts || {});
  if (animate) stagger(v); else $$('.st', v).forEach((el) => el.classList.remove('st'));
}

// ---------- HOME ----------
let shownBal = 0;
function balanceSeries(days = 30) {
  const now = Date.now(); let b = S.balance + S.savings; const pts = []; let j = 0;
  const txs = S.txs.filter((t) => t.via !== 'credit');
  for (let d = 0; d <= days; d++) {
    const cut = now - d * 864e5;
    while (j < txs.length && txs[j].ts > cut) { b -= txs[j].amount; j++; }
    pts.unshift(b);
  }
  return pts;
}
function home() {
  const pv = portfolioValue(S.holdings, prices);
  const cr = S.cards.credit;
  const net = S.balance + S.savings + pv.value - cr.used;
  const ms = new Date(); ms.setDate(1); ms.setHours(0, 0, 0, 0);
  const flow = S.txs.filter((t) => t.ts >= ms.getTime() && t.via !== 'credit').reduce((s, t) => s + t.amount, 0);
  const pts = linePts(balanceSeries(), 400, 58, 6);
  const v = $('#view');
  v.innerHTML = `
    <div class="hero gborder st">
      <div class="hero-lbl">Current Account · Private <span class="sp"></span><button class="eye" id="eye">${S.hide ? ICON.eyeOff : ICON.eye}</button></div>
      <div class="hero-bal num"><small>AED</small><span id="bal">${S.hide ? '••••••••' : ''}</span></div>
      <div class="row" style="gap:8px"><span class="delta" style="${flow < 0 ? 'background:rgba(255,92,122,.14);color:var(--down)' : ''}">${flow >= 0 ? '▲' : '▼'} ${S.hide ? '••••' : fmt(Math.abs(flow), '')}</span><span class="mut" style="font-size:12px">net flow this month</span></div>
      <div class="hero-spark"><svg viewBox="0 0 400 58" preserveAspectRatio="none">
        <defs><linearGradient id="hs" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ffe3ad" stop-opacity=".35"/><stop offset="1" stop-color="#ffe3ad" stop-opacity="0"/></linearGradient></defs>
        <path d="${smooth(pts)} L400,58 L0,58Z" fill="url(#hs)"/><path class="ln" d="${smooth(pts)}" fill="none" stroke="#ffe3ad" stroke-width="2" vector-effect="non-scaling-stroke"/></svg></div>
      <div class="hero-iban num">${formatIban(ACCOUNT_IBAN)} <button class="copy" id="cpy">${ICON.copy}</button></div>
    </div>
    <div class="qa st">
      <button data-a="send"><span>${ICON.send}</span>Send</button>
      <button data-a="bills"><span>${ICON.bills}</span>Pay bills</button>
      <button data-a="fx"><span>${ICON.fx}</span>Exchange</button>
      <button data-a="stmt"><span>${ICON.doc}</span>Statement</button>
    </div>
    <h2 class="st">Your cards <button class="link" data-a="cards">Manage</button></h2>
    <div class="mini-cards st">${cardHTML('debit')}${cardHTML('credit')}</div>
    <h2 class="st">Wealth</h2>
    <div class="accts">
      ${[['Savings Pocket', S.savings, '#4fd1ff'], ['Investments', pv.value, '#2ee59d'], ['Credit card due', cr.used, '#ff8aa0'], ['Net worth', net, '#ffe3ad']].map(([k, val, c]) =>
        `<div class="box acct st"><div class="k"><i style="background:${c};box-shadow:0 0 8px ${c}"></i>${k}</div><div class="v num">${money(val)}</div>
         <div class="bar"><b data-w="${net ? clamp(Math.abs(val) / net * 100, 2, 100) : 2}" style="background:${c}"></b></div></div>`).join('')}
    </div>
    <h2 class="st">Recent activity <button class="link" data-a="stmt">See all</button></h2>
    <div class="list">${S.txs.slice(0, 8).map((t) => txItem(t, true)).join('')}</div>
    <p class="disclaimer">Velora is a banking simulator for demonstration. Balances, cards, transfers and trades are not real.</p>`;
  if (!S.hide) { countUp($('#bal', v), S.balance, shownBal, shownBal ? 900 : 1600); shownBal = S.balance; }
  setTimeout(() => $$('.acct .bar b', v).forEach((b) => { b.style.width = b.dataset.w + '%'; }), 250);
  $('#eye', v).onclick = () => { haptic(); S.hide = !S.hide; shownBal = 0; save(); render(); };
  $('#cpy', v).onclick = async () => { try { await navigator.clipboard.writeText(ACCOUNT_IBAN); } catch { /* ignore */ } haptic(); toast('IBAN copied'); };
  $$('.mini-cards .bcard', v).forEach((c) => c.onclick = () => { cardSel = c.dataset.card; go('cards'); });
  $$('[data-a]', v).forEach((b) => b.onclick = () => ({
    send: () => go('pay', { mode: 'iban' }), bills: () => go('pay', { mode: 'bills' }), fx: fxSheet, stmt: statementSheet, cards: () => go('cards'),
  })[b.dataset.a]());
}

function statementSheet() {
  openSheet(`<h3>All transactions</h3>
    <div class="field"><input id="q" placeholder="Search merchant or category"></div>
    <div class="list" id="stl"></div>`, (el) => {
    const draw = () => {
      const q = $('#q', el).value.toLowerCase();
      const rows = S.txs.filter((t) => !q || t.title.toLowerCase().includes(q) || (CATEGORIES[t.cat]?.label || '').toLowerCase().includes(q));
      $('#stl', el).innerHTML = rows.slice(0, 200).map((t) => txItem(t)).join('') || '<div class="item mut">No results</div>';
    };
    $('#q', el).oninput = draw; draw();
  });
}

function fxSheet() {
  const R = { USD: 1 / USD_AED, EUR: 0.2338, GBP: 0.2031, SAR: 1.0211, INR: 24.17, PKR: 76.9, EGP: 13.18, JPY: 41.6 };
  const FL = { USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', SAR: '🇸🇦', INR: '🇮🇳', PKR: '🇵🇰', EGP: '🇪🇬', JPY: '🇯🇵' };
  openSheet(`<h3>Exchange rates</h3>
    <div class="box amount-wrap st"><div class="cur">AED 🇦🇪</div><input id="fxa" class="amount-in num" inputmode="decimal" value="1000"></div>
    <div class="list st" id="fxl" style="margin-top:12px"></div><p class="disclaimer">Indicative demo rates.</p>`, (el) => {
    const draw = () => {
      const a = Number($('#fxa', el).value.replace(/,/g, '')) || 0;
      $('#fxl', el).innerHTML = Object.entries(R).map(([c, r]) => `<div class="item"><div class="ico" style="font-size:22px">${FL[c]}</div>
        <div class="sp"><div class="t">${c}</div><div class="s">1 AED = ${r.toFixed(4)} ${c}</div></div><div class="amt num">${fmt(a * r, '')}</div></div>`).join('');
    };
    $('#fxa', el).oninput = draw; draw();
  });
}

// ---------- CARDS ----------
let cardSel = 'debit';
let reveal = false; let revealT;
const CARD_INFO = {
  debit: { name: 'Platinum Debit', pan: '4000 1234 5678 9010', exp: '09/30', cvv: '381', net: 'VISA' },
  credit: { name: 'Infinite Credit', pan: '5100 2345 6789 0127', exp: '11/31', cvv: '642', net: 'MC' },
};
function cardHTML(type) {
  const info = CARD_INFO[type]; const c = S.cards[type];
  const show = reveal && type === cardSel && tab === 'cards';
  const pan = show ? info.pan : '•••• •••• •••• ' + info.pan.slice(-4);
  const net = info.net === 'VISA' ? '<span class="visa">VISA</span>' : '<span class="mc"><i></i><i></i></span>';
  return `<div class="bcard ${type} ${c.frozen ? 'frozen' : ''}" data-card="${type}">
    <div class="face front"><div class="lines"></div>
      <div class="bk"><i>V</i>VELORA</div><div class="tp">${info.name.toUpperCase()}</div><div class="wm">DEMO CARD</div>
      <div class="chipi"></div>${ICON.nfc}
      <div class="pan">${pan}</div>
      <div class="meta"><div>CARD HOLDER<b>A. MARAR</b></div><div style="margin-left:18px">VALID THRU<b>${show ? info.exp : '••/••'}</b></div><div class="net">${net}</div></div>
      ${c.frozen ? '<div class="frz">❄ FROZEN</div>' : ''}
    </div>
    <div class="face back"><div class="strip"></div>
      <div class="sig"><div></div><div class="cvv">${show ? info.cvv : '•••'}</div></div>
      <div class="back-txt">This card is a simulation issued by the Velora demo app and cannot be used for real payments. 24/7 care via in-app chat.</div>
      <div class="meta"><div>${show ? info.pan : '•••• ' + info.pan.slice(-4)}</div><div class="net">${net}</div></div></div>
  </div>`;
}

/** Touch/pointer 3D tilt with holographic shine; tap flips the card. */
const tilts = [];
function attachTilt(card) {
  let flipped = false; let moved = false; let sx = 0; let sy = 0; let touching = false;
  const apply = (rx, ry, tr) => { card.style.transition = tr; card.style.transform = `rotateX(${rx}deg) rotateY(${ry + (flipped ? 180 : 0)}deg)`; };
  const shine = (px, py) => { card.style.setProperty('--mx', `${px * 100}%`); card.style.setProperty('--my', `${py * 100}%`); card.style.setProperty('--hx', `${px * 100}%`); };
  card.addEventListener('pointerdown', (e) => { touching = true; moved = false; sx = e.clientX; sy = e.clientY; });
  card.addEventListener('pointermove', (e) => {
    const r = card.getBoundingClientRect(); const px = clamp((e.clientX - r.left) / r.width, 0, 1); const py = clamp((e.clientY - r.top) / r.height, 0, 1);
    if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 10) moved = true;
    shine(px, py); apply((0.5 - py) * 18, (px - 0.5) * 22, 'transform .12s ease-out');
  });
  const leave = () => { touching = false; apply(0, 0, 'transform .8s cubic-bezier(.34,1.56,.64,1)'); };
  card.addEventListener('pointerleave', leave); card.addEventListener('pointercancel', leave);
  card.addEventListener('pointerup', () => { touching = false; });
  card.addEventListener('click', () => {
    if (moved) return; flipped = !flipped; haptic('medium');
    apply(0, 0, 'transform .85s cubic-bezier(.2,.8,.2,1)');
  });
  tilts.push({ card, gyro: (b, g) => { if (touching) return; shine(clamp(0.5 + g / 50, 0, 1), clamp(0.5 + b / 50, 0, 1)); apply(clamp(-b * 0.45, -12, 12), clamp(g * 0.55, -14, 14), 'transform .25s ease-out'); } });
}
let gyroBase = null; let gyroRaf = 0;
addEventListener('deviceorientation', (e) => {
  if (tab !== 'cards' || e.beta == null || gyroRaf) return;
  gyroRaf = requestAnimationFrame(() => {
    gyroRaf = 0;
    if (!gyroBase) gyroBase = { b: e.beta, g: e.gamma };
    gyroBase.b += (e.beta - gyroBase.b) * 0.01; gyroBase.g += (e.gamma - gyroBase.g) * 0.01;
    const t = tilts.find((x) => x.card.dataset.card === cardSel && x.card.isConnected);
    t?.gyro(e.beta - gyroBase.b, e.gamma - gyroBase.g);
  });
});

function cards() {
  tilts.length = 0;
  const v = $('#view');
  v.innerHTML = `
    <div class="card-car st" id="car"><div class="card-stage">${cardHTML('debit')}</div><div class="card-stage">${cardHTML('credit')}</div></div>
    <div class="dots st" id="cdots"><i class="${cardSel === 'debit' ? 'on' : ''}"></i><i class="${cardSel === 'credit' ? 'on' : ''}"></i></div>
    <div class="tap-hint st">Swipe to switch · tilt or touch to play · tap to flip</div>
    <div id="cardBody"></div>`;
  $$('.card-car .bcard', v).forEach(attachTilt);
  const car = $('#car', v);
  const step0 = () => car.firstElementChild.offsetWidth + 14;
  let cur = cardSel === 'debit' ? 0 : 1;
  requestAnimationFrame(() => { car.scrollLeft = cur * step0(); });
  car.addEventListener('scroll', () => {
    const i = Math.round(car.scrollLeft / step0());
    if (i !== cur && (i === 0 || i === 1)) {
      cur = i; cardSel = i ? 'credit' : 'debit'; reveal = false; haptic('light');
      $$('#cdots i', v).forEach((d, k) => d.classList.toggle('on', k === i));
      cardBody();
    }
  }, { passive: true });
  cardBody();
}

function cardBody() {
  const el = $('#cardBody'); if (!el) return;
  const c = S.cards[cardSel]; const info = CARD_INFO[cardSel];
  const txs = S.txs.filter((t) => t.via === cardSel).slice(0, 10);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const spentToday = S.txs.filter((t) => t.via === 'debit' && t.ts >= todayStart.getTime() && t.amount < 0).reduce((s, t) => s - t.amount, 0);
  const util = c.used ? c.used / c.limit : 0; const RC = 2 * Math.PI * 50;
  el.innerHTML = `
    <div class="ctrl st">
      <button data-k="frozen" class="${c.frozen ? 'on' : ''}"><span>${ICON.snow}</span>${c.frozen ? 'Unfreeze' : 'Freeze'}</button>
      <button data-k="reveal" class="${reveal ? 'on' : ''}"><span>${(reveal ? ICON.eyeOff : ICON.eye).replace(/"16"/g, '"22"')}</span>${reveal ? 'Hide' : 'Details'}</button>
      <button data-k="limits"><span>${ICON.sliders}</span>Limits</button>
      <button data-k="pin"><span>${ICON.key}</span>Card PIN</button>
    </div>
    ${cardSel === 'credit' ? `<h2 class="st">Credit overview</h2><div class="box st">
      <div class="row" style="gap:18px">
        <div class="ring"><svg viewBox="0 0 120 120"><defs><linearGradient id="rg" x1="0" x2="1"><stop offset="0" stop-color="#7c8cff"/><stop offset="1" stop-color="#ffe3ad"/></linearGradient></defs>
          <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="12"/>
          <circle class="v" id="ringv" cx="60" cy="60" r="50" fill="none" stroke="url(#rg)" stroke-width="12" stroke-linecap="round" stroke-dasharray="${RC.toFixed(1)}" stroke-dashoffset="${RC.toFixed(1)}"/></svg>
          <div class="c"><div><b class="num">${(util * 100).toFixed(1)}%</b>used</div></div></div>
        <div class="sp"><div class="mut" style="font-size:12px">Outstanding</div><div style="font-weight:800;font-size:21px" class="num">${money(c.used)}</div>
          <div class="mut" style="font-size:12px;margin-top:8px">Available</div><div style="font-weight:700" class="num up">${money(c.limit - c.used)}</div></div>
      </div>
      <div class="kv" style="margin-top:14px"><span>Credit limit</span><span class="num">${fmt(c.limit)}</span></div>
      <div class="kv"><span>Minimum due</span><span class="num">${fmt(round2(c.used ? Math.max(c.used * 0.05, 100) : 0))}</span></div>
      <div class="kv"><span>Due date</span><span>${new Date(Date.now() + 14 * 864e5).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span></div>
      <button class="btn" id="payCard" style="margin-top:16px" ${c.used ? '' : 'disabled'}>Pay card bill</button></div>` : `
      <h2 class="st">Daily spending</h2><div class="box st">
        <div class="row"><div><div class="mut" style="font-size:12px">Spent today</div><div style="font-weight:800;font-size:21px" class="num">${money(spentToday)}</div></div><span class="sp"></span>
        <div style="text-align:right"><div class="mut" style="font-size:12px">Daily limit</div><div style="font-weight:700" class="num">${fmt(c.limit)}</div></div></div>
        <div class="meter"><i data-w="${clamp(spentToday / c.limit * 100, 1.5, 100)}"></i></div>
        <div class="kv"><span>Linked account</span><span class="num">${money(S.balance)}</span></div></div>`}
    <h2 class="st">Card settings</h2>
    <div class="list st">
      ${[['online', 'Online payments', ICON.globe, '#4fd1ff'], ['intl', 'International usage', ICON.plane, '#a78bfa'], ['contactless', 'Contactless payments', ICON.wave, '#2ee59d']].map(([k, l, i, col]) =>
        `<button class="item" data-t="${k}"><div class="ico" style="--c:${col}">${i}</div><div class="sp t">${l}</div><div class="switch ${c[k] ? 'on' : ''}"></div></button>`).join('')}
    </div>
    <h2 class="st">Card transactions</h2><div class="list">${txs.map((t) => txItem(t, true)).join('') || '<div class="item mut">No transactions</div>'}</div>`;
  stagger(el);
  setTimeout(() => {
    const r = $('#ringv', el); if (r) r.style.strokeDashoffset = (RC * (1 - util)).toFixed(1);
    $$('.meter i[data-w]', el).forEach((m) => { m.style.width = m.dataset.w + '%'; });
  }, 250);

  $$('[data-t]', el).forEach((b) => b.onclick = () => {
    c[b.dataset.t] = !c[b.dataset.t]; save(); haptic();
    $('.switch', b).classList.toggle('on', c[b.dataset.t]); toast('Card setting updated');
  });
  $$('[data-k]', el).forEach((b) => b.onclick = () => {
    const k = b.dataset.k; haptic();
    if (k === 'frozen') { c.frozen = !c.frozen; save(); refreshCard(); cardBody(); toast(c.frozen ? 'Card frozen' : 'Card unfrozen', '❄'); }
    if (k === 'reveal') {
      if (reveal) { reveal = false; refreshCard(); cardBody(); return; }
      confirmPin('Show card details', [['Card', `${info.name} ••${info.pan.slice(-4)}`]], () => {
        closeSheet(); reveal = true; refreshCard(); cardBody();
        clearTimeout(revealT); revealT = setTimeout(() => { reveal = false; if (tab === 'cards') { refreshCard(); cardBody(); } }, 15000);
      });
    }
    if (k === 'limits') limitSheet(c);
    if (k === 'pin') confirmPin('View card PIN', [['Card', info.name]], () => {
      openSheet(`<h3>Card PIN</h3><div class="box st" style="text-align:center;font-size:42px;letter-spacing:16px;font-weight:800;padding:26px">${cardSel === 'debit' ? '4826' : '7319'}</div>
        <p class="disclaimer">Never share your PIN with anyone.</p><button class="btn st" style="margin-top:16px" data-close>Close</button>`);
    });
  });
  $('#payCard', el)?.addEventListener('click', () => payCardSheet(c));
}
/** Re-renders the visible card face without rebuilding the carousel. */
function refreshCard() {
  const old = $(`.card-car .bcard[data-card="${cardSel}"]`); if (!old) return;
  const tmp = document.createElement('div'); tmp.innerHTML = cardHTML(cardSel);
  const nu = tmp.firstElementChild; old.replaceWith(nu); attachTilt(nu);
}

function limitSheet(c) {
  const max = cardSel === 'credit' ? c.limit : 500000;
  const field = cardSel === 'credit' ? 'spend' : 'limit';
  const cur = cardSel === 'credit' ? (c.spend || c.limit) : c.limit;
  openSheet(`<h3>Daily spending limit</h3>
    <div class="box amount-wrap st"><div class="cur">AED</div><div class="amount-in num" id="limv">${fmt(cur, '')}</div></div>
    <div class="field st" style="margin-top:18px"><input id="lim" type="range" min="1000" max="${max}" step="1000" value="${cur}" style="width:100%;accent-color:#e3b96f;padding:0;border:0;background:none"></div>
    <button class="btn st" id="limOk">Save limit</button>`, (el) => {
    $('#lim', el).oninput = (e) => { $('#limv', el).textContent = fmt(Number(e.target.value), ''); haptic('light'); };
    $('#limOk', el).onclick = () => { c[field] = Number($('#lim', el).value); save(); closeSheet(); cardBody(); toast('Limit updated'); };
  });
}

function payCardSheet(c) {
  openSheet(`<h3>Pay credit card</h3>
    <div class="box amount-wrap st"><div class="cur">AED</div><input id="am" inputmode="decimal" class="amount-in num" value="${c.used.toLocaleString('en-US')}">
      <div class="quick"><button class="chip" data-v="${c.used}">Full balance</button><button class="chip" data-v="${round2(Math.max(c.used * 0.05, 100))}">Minimum</button></div>
      <div class="err" id="amE" style="color:var(--down);font-size:12px"></div></div>
    <div class="kv st" style="margin:14px 2px"><span>From</span><span>Current Account · ${money(S.balance)}</span></div>
    <div class="slide st" id="sl"></div>`, (el) => {
    const getAmt = bindAmount(el);
    $$('[data-v]', el).forEach((b) => b.onclick = () => { $('#am', el).value = Number(b.dataset.v).toLocaleString('en-US'); haptic(); });
    slider($('#sl', el), 'Slide to pay', () => {
      const a = getAmt();
      if (!(a > 0) || a > c.used) { fieldError(el, 'am', 'Enter an amount up to the outstanding balance'); return false; }
      if (a > S.balance) { fieldError(el, 'am', 'Insufficient balance'); return false; }
      confirmPin('Confirm card payment', [['Amount', fmt(a)], ['Card', 'Infinite Credit ••0127']], () => {
        S.balance = round2(S.balance - a); c.used = round2(c.used - a);
        addTx({ title: 'Credit card payment', cat: 'transfer', amount: -a, via: 'account' });
        note('Card payment received', `${fmt(a)} paid to your Infinite Credit card`);
        save(); render();
        receipt({ title: 'Card payment successful', amount: a, rows: [['To', 'Velora Infinite Credit ••0127'], ['From', 'Current Account']], ref: txRef() });
      });
      return true;
    });
  });
}

/** Slide-to-confirm control. `onDone` returns false to spring back. */
function slider(el, label, onDone) {
  el.innerHTML = `<div class="fill"></div><div class="lbl">${label}</div><div class="knob">${ICON.arrowR}</div>`;
  const knob = $('.knob', el); const fill = $('.fill', el); const lbl = $('.lbl', el);
  let x = 0; let start = 0; let drag = false; let max = 0; let buzzed = false;
  const set = (v) => { knob.style.transform = `translateX(${v}px)`; fill.style.width = `${v + 64}px`; lbl.style.opacity = String(1 - v / (max || 1)); };
  const springBack = () => { el.classList.add('back'); x = 0; set(0); setTimeout(() => el.classList.remove('back'), 460); };
  const reject = () => { springBack(); haptic('error'); el.animate([{ transform: 'translateX(-7px)' }, { transform: 'translateX(7px)' }, { transform: 'none' }], { duration: 320 }); };
  knob.addEventListener('pointerdown', (e) => { drag = true; buzzed = false; start = e.clientX - x; max = el.clientWidth - knob.offsetWidth - 8; knob.setPointerCapture(e.pointerId); el.classList.remove('back'); });
  knob.addEventListener('pointermove', (e) => {
    if (!drag) return; x = clamp(e.clientX - start, 0, max); set(x);
    if (x > max * 0.88 && !buzzed) { buzzed = true; haptic('medium'); }
  });
  const end = () => {
    if (!drag) return; drag = false;
    if (x >= max * 0.88) { set(max); if (onDone() === false) setTimeout(reject, 120); else setTimeout(springBack, 900); } else springBack();
  };
  knob.addEventListener('pointerup', end); knob.addEventListener('pointercancel', end);
}

// ---------- TRANSFER ----------
let payMode = 'iban';
const PURPOSES = ['Family support', 'Personal transfer', 'Rent', 'Business payment', 'Investment', 'Education', 'Medical', 'Gift', 'Other'];
const BILLERS = [
  ['💡', 'Electricity & Water', 'Account no.', '#facc15'], ['📱', 'Mobile Postpaid', 'Mobile number', '#4fd1ff'], ['🌐', 'Home Internet', 'Account no.', '#7c8cff'],
  ['🚗', 'Road Toll Top-up', 'Tag number', '#2ee59d'], ['❄️', 'District Cooling', 'Premise no.', '#38bdf8'], ['🎓', 'School Fees', 'Student ID', '#ff8aa0'],
];
const PAY_VIEWS = { iban: payIban, own: payOwn, bills: payBills };
function pay(opts = {}) {
  if (opts.mode) payMode = opts.mode;
  const v = $('#view');
  const modes = ['iban', 'own', 'bills'];
  v.innerHTML = `<div class="seg st" id="seg"><div class="ind"></div>
      <button data-m="iban" class="${payMode === 'iban' ? 'on' : ''}">To IBAN</button>
      <button data-m="own" class="${payMode === 'own' ? 'on' : ''}">My accounts</button>
      <button data-m="bills" class="${payMode === 'bills' ? 'on' : ''}">Bills</button></div><div id="pm"></div>`;
  const seg = $('#seg', v);
  const place = () => { const b = $(`[data-m="${payMode}"]`, seg); const ind = $('.ind', seg); ind.style.width = `${b.offsetWidth}px`; ind.style.transform = `translateX(${b.offsetLeft - 4}px)`; };
  requestAnimationFrame(place);
  $$('[data-m]', v).forEach((b) => b.onclick = () => {
    if (b.dataset.m === payMode) return;
    const dir = modes.indexOf(b.dataset.m) > modes.indexOf(payMode) ? 1 : -1;
    haptic(); payMode = b.dataset.m;
    $$('[data-m]', v).forEach((x) => x.classList.toggle('on', x === b)); place();
    const pm = $('#pm', v); pm.innerHTML = ''; PAY_VIEWS[payMode](pm, {}); stagger(pm);
    pm.animate([{ opacity: 0, transform: `translateX(${dir * 22}px)` }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
  });
  PAY_VIEWS[payMode]($('#pm', v), opts);
}

const hueOf = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 17);
function amountBlock(id = 'am') {
  return `<div class="box amount-wrap st"><div class="cur">AMOUNT · AED</div>
    <input id="${id}" class="amount-in num" inputmode="decimal" placeholder="0" autocomplete="off">
    <div class="quick">${[1000, 10000, 100000, 1000000].map((x) => `<button class="chip" data-q="${x}">${x >= 1e6 ? '1M' : x / 1000 + 'K'}</button>`).join('')}</div>
    <div class="mut" style="font-size:12px">Available <span class="num">${money(S.balance)}</span></div><div class="err" id="${id}E" style="color:var(--down);font-size:12px;margin-top:6px"></div></div>`;
}
/** Live thousands-separator formatting for an amount input; returns a getter. */
function bindAmount(el, id = 'am', onChange) {
  const inp = $('#' + id, el);
  const clearErr = () => { const e = $('#' + id + 'E', el); if (e) e.textContent = ''; };
  inp.addEventListener('input', () => {
    clearErr();
    const raw = inp.value.replace(/[^\d.]/g, ''); const [i, d] = raw.split('.');
    inp.value = (i ? Number(i).toLocaleString('en-US') : '') + (d != null ? '.' + d.slice(0, 2) : '');
    onChange?.();
  });
  $$('[data-q]', el).forEach((b) => b.onclick = () => {
    haptic(); clearErr(); inp.value = Number(b.dataset.q).toLocaleString('en-US');
    inp.animate([{ transform: 'scale(1.08)' }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.34,1.56,.64,1)' }); onChange?.();
  });
  return () => round2(Number(inp.value.replace(/,/g, '')));
}
function fieldError(el, id, msg) {
  const f = $('#' + id, el).closest('.field, .box'); f.classList.remove('bad'); void f.offsetWidth; f.classList.add('bad');
  const e = $('#' + id + 'E', el); if (e) { e.className = 'err'; e.textContent = msg; }
}

function payIban(el, opts) {
  el.innerHTML = `
    <div class="benes st">
      <button class="bene add" id="nb"><span>${ICON.plus}</span>New</button>
      ${S.benes.map((b, i) => `<button class="bene" data-b="${i}"><span style="--h:${hueOf(b.name)}">${esc(b.name.split(' ').map((w) => w[0]).slice(0, 2).join(''))}</span>${esc(b.name.split(' ')[0])}</button>`).join('')}</div>
    ${amountBlock()}
    <div class="box st" style="margin-top:12px">
      <div class="field"><label>Beneficiary full name</label><input id="nm" autocomplete="off" placeholder="e.g. Omar Khalid"><div class="err" id="nmE"></div></div>
      <div class="field"><label>IBAN</label><input id="ib" class="num" autocomplete="off" autocapitalize="characters" placeholder="AE07 0331 2345 6789 0123 456"><div class="err" id="ibE"></div></div>
      <div class="field"><label>Purpose of payment</label><select id="pu">${PURPOSES.map((p) => `<option>${p}</option>`).join('')}</select></div>
      <div class="field"><label>Note (optional)</label><input id="no" maxlength="60"></div>
      <button class="item" id="sv" style="padding:4px 2px;border:0"><div class="sp t" style="font-weight:500">Save as beneficiary</div><div class="switch on"></div></button>
    </div>
    <div class="box st" style="margin:12px 0 14px" id="sum"></div>
    <div class="slide st" id="sl"></div>`;
  let saveBene = true;
  const ib = $('#ib', el);
  const check = () => {
    const raw = cleanIban(ib.value);
    ib.value = formatIban(raw);
    const e = $('#ibE', el);
    if (raw.length < 15) { e.className = 'err'; e.textContent = ''; return null; }
    const r = validateIban(raw);
    e.className = r.ok ? 'okm' : 'err';
    e.textContent = r.ok ? `✓ Valid ${r.country} IBAN · ${r.country === 'AE' ? 'Local instant transfer' : 'International (SWIFT)'}` : r.reason;
    return r.ok ? r : null;
  };
  const summary = () => {
    const r = validateIban(ib.value); const a = getAmt() || 0; const fee = r.ok && r.country !== 'AE' ? 25 : 0;
    $('#sum', el).innerHTML = `<div class="kv" style="margin:0"><span>Transfer</span><span class="num">${fmt(a)}</span></div>
      <div class="kv"><span>Fee</span><span class="num">${fee ? fmt(fee) : 'Free'}</span></div>
      <div class="kv"><span>Arrives</span><span>${r.ok ? (r.country === 'AE' ? 'Instantly' : '1–2 business days') : '—'}</span></div>
      <div class="kv" style="font-weight:700"><span style="color:var(--txt)">Total</span><span class="num">${fmt(a + fee)}</span></div>`;
  };
  const getAmt = bindAmount(el, 'am', summary);
  ib.oninput = () => { check(); summary(); };
  $$('[data-b]', el).forEach((b) => b.onclick = () => {
    haptic(); $$('.bene', el).forEach((x) => x.classList.toggle('on', x === b));
    const x = S.benes[b.dataset.b]; $('#nm', el).value = x.name; ib.value = x.iban; check(); summary();
  });
  $('#nb', el).onclick = () => { $$('.bene', el).forEach((x) => x.classList.remove('on')); $('#nm', el).value = ''; ib.value = ''; check(); summary(); $('#nm', el).focus(); };
  $('#sv', el).onclick = () => { haptic(); saveBene = !saveBene; $('#sv .switch', el).classList.toggle('on', saveBene); };
  if (opts.prefill) { $('#nm', el).value = opts.prefill.name; ib.value = opts.prefill.iban; check(); }
  summary();

  slider($('#sl', el), 'Slide to send', () => {
    const name = $('#nm', el).value.trim();
    const r = check(); const amt = getAmt();
    ['amE', 'nmE'].forEach((k) => { $('#' + k, el).textContent = ''; });
    if (!(amt > 0)) { fieldError(el, 'am', 'Enter an amount'); return false; }
    if (!name) { fieldError(el, 'nm', 'Enter the beneficiary name'); return false; }
    if (!r) { fieldError(el, 'ib', $('#ibE', el).textContent || 'Enter a valid IBAN'); return false; }
    if (r.iban === ACCOUNT_IBAN) { fieldError(el, 'ib', 'You cannot transfer to your own account here'); return false; }
    const local = r.country === 'AE'; const fee = local ? 0 : 25;
    if (amt + fee > S.balance) { fieldError(el, 'am', 'Insufficient balance'); return false; }
    const purpose = $('#pu', el).value; const memo = $('#no', el).value.trim();
    confirmPin('Confirm transfer', [
      ['To', name], ['IBAN', formatIban(r.iban)], ['Type', local ? 'Local (UAEFTS)' : 'International (SWIFT)'],
      ['Purpose', purpose], ['Amount', fmt(amt)], ['Fee', fmt(fee)], ['Total', fmt(amt + fee)],
    ], () => {
      S.balance = round2(S.balance - amt - fee);
      addTx({ title: `Transfer to ${name}`, cat: 'transfer', amount: -amt, via: 'account' });
      if (fee) addTx({ title: 'International transfer fee', cat: 'bills', amount: -fee, via: 'account' });
      if (saveBene && !S.benes.some((b) => b.iban === r.iban)) S.benes.unshift({ name, iban: r.iban });
      note('Transfer sent', `${fmt(amt)} to ${name}`);
      save(); render();
      receipt({ title: `Sent to ${name}`, amount: amt, rows: [['IBAN', formatIban(r.iban)], ['Purpose', purpose], ...(memo ? [['Note', memo]] : []), ['Fee', fmt(fee)], ['New balance', fmt(S.balance)]], ref: txRef() });
    });
    return true;
  });
}

function payOwn(el) {
  let dir = 'cur';
  el.innerHTML = `${amountBlock()}
    <div class="box st" style="margin-top:12px;position:relative" id="accs"></div>
    <div class="slide st" id="sl" style="margin-top:14px"></div>`;
  const drawAccs = () => {
    const from = dir === 'cur' ? ['Current Account', S.balance] : ['Savings Pocket', S.savings];
    const to = dir === 'cur' ? ['Savings Pocket', S.savings] : ['Current Account', S.balance];
    $('#accs', el).innerHTML = `<div class="item" style="padding:6px 0;border:0"><div class="ico" style="--c:#7c8cff">↑</div><div class="sp"><div class="s">From</div><div class="t">${from[0]}</div></div><div class="amt num">${money(from[1])}</div></div>
      <button id="swap" style="position:absolute;right:50%;top:50%;transform:translate(50%,-50%);width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#fff1cf,#e3b96f);color:#1c1405;display:grid;place-items:center;box-shadow:0 6px 18px rgba(227,185,111,.45),0 0 0 4px rgba(14,18,34,.9);transition:transform .5s cubic-bezier(.34,1.56,.64,1);z-index:2">${ICON.swap}</button>
      <div style="height:1px;background:var(--line);margin:8px 0"></div>
      <div class="item" style="padding:6px 0;border:0"><div class="ico" style="--c:#2ee59d">↓</div><div class="sp"><div class="s">To</div><div class="t">${to[0]}</div></div><div class="amt num">${money(to[1])}</div></div>`;
    $('#swap', el).onclick = (e) => { haptic('medium'); dir = dir === 'cur' ? 'sav' : 'cur'; e.currentTarget.style.transform = 'translate(50%,-50%) rotate(180deg)'; setTimeout(drawAccs, 280); };
  };
  drawAccs();
  const getAmt = bindAmount(el);
  slider($('#sl', el), 'Slide to move money', () => {
    const a = getAmt();
    const src = dir === 'cur' ? 'balance' : 'savings'; const dst = src === 'balance' ? 'savings' : 'balance';
    if (!(a > 0)) { fieldError(el, 'am', 'Enter an amount'); return false; }
    if (a > S[src]) { fieldError(el, 'am', 'Insufficient balance'); return false; }
    S[src] = round2(S[src] - a); S[dst] = round2(S[dst] + a);
    addTx({ title: dst === 'savings' ? 'To Savings Pocket' : 'From Savings Pocket', cat: 'transfer', amount: dst === 'savings' ? -a : a, via: 'account' });
    save(); haptic('success'); toast(`${fmt(a)} moved`); confetti();
    setTimeout(() => render(), 700);
    return true;
  });
}

function payBills(el) {
  el.innerHTML = `<div class="list">${BILLERS.map(([i, n, f, c], k) => `<button class="item st" data-k="${k}"><div class="ico" style="--c:${c}">${i}</div><div class="sp"><div class="t">${n}</div><div class="s">${f}</div></div><span class="mut">›</span></button>`).join('')}</div>`;
  $$('[data-k]', el).forEach((b) => b.onclick = () => {
    const [ic, n, f] = BILLERS[b.dataset.k];
    openSheet(`<h3>${ic} ${n}</h3>
      <div class="field st"><label>${f}</label><input id="acc" inputmode="numeric"><div class="err" id="accE"></div></div>
      ${amountBlock()}
      <div class="slide st" id="sl" style="margin-top:14px"></div>`, (s) => {
      const getAmt = bindAmount(s);
      slider($('#sl', s), 'Slide to pay', () => {
        const acc = $('#acc', s).value.trim(); const a = getAmt();
        if (acc.length < 4) { fieldError(s, 'acc', `Enter a valid ${f.toLowerCase()}`); return false; }
        if (!(a > 0)) { fieldError(s, 'am', 'Enter an amount'); return false; }
        if (a > S.balance) { fieldError(s, 'am', 'Insufficient balance'); return false; }
        confirmPin('Confirm bill payment', [['Biller', n], [f, acc], ['Amount', fmt(a)]], () => {
          S.balance = round2(S.balance - a);
          addTx({ title: n, cat: 'bills', amount: -a, via: 'account' });
          note('Bill paid', `${fmt(a)} to ${n}`);
          save(); render();
          receipt({ title: `Paid ${n}`, amount: a, rows: [['Biller', n], [f, acc]], ref: txRef() });
        });
        return true;
      });
    });
  });
}

// ---------- INVEST ----------
let invFilter = 'all';
let shownPf = 0;
function invest() {
  const pv = portfolioValue(S.holdings, prices);
  const list = ASSETS.filter((a) => invFilter === 'all' || a.type === invFilter || (invFilter === 'mine' && S.holdings[a.sym]));
  let stockV = 0; let cryptoV = 0;
  for (const [sym, h] of Object.entries(S.holdings)) { const a = ASSETS.find((x) => x.sym === sym); const val = h.qty * prices[sym] * USD_AED; if (a?.type === 'crypto') cryptoV += val; else stockV += val; }
  const tot = stockV + cryptoV;
  const tk = ASSETS.map((a) => `<span><b>${a.sym}</b><em class="num" data-tk="${a.sym}" style="font-style:normal">${usd(prices[a.sym])}</em> <i data-tkc="${a.sym}" class="${chg(a.sym) >= 0 ? 'up' : 'down'}" style="font-style:normal">${chg(a.sym) >= 0 ? '▲' : '▼'}${Math.abs(chg(a.sym)).toFixed(2)}%</i></span>`).join('');
  const v = $('#view');
  v.innerHTML = `
    <div class="hero pf gborder st">
      <div class="hero-lbl">Portfolio value</div>
      <div class="hero-bal num"><small>AED</small><span id="pfv">${S.hide ? '••••••' : ''}</span></div>
      <div id="pfp" class="${pv.pnl >= 0 ? 'up' : 'down'} num" style="font-weight:700">${pv.cost ? `${pv.pnl >= 0 ? '▲' : '▼'} ${fmt(Math.abs(pv.pnl))} (${(pv.pnl / pv.cost * 100).toFixed(2)}%)` : 'Start building your portfolio'}</div>
      ${tot ? `<div style="display:flex;height:8px;border-radius:8px;overflow:hidden;margin:14px 0 8px;gap:3px"><i style="flex:${stockV};background:#7c8cff;border-radius:8px"></i><i style="flex:${cryptoV};background:#ffe3ad;border-radius:8px"></i></div>
        <div class="row" style="font-size:12px;color:#c3cbef;gap:14px"><span><span style="color:#7c8cff">●</span> Stocks ${(stockV / tot * 100).toFixed(0)}%</span><span><span style="color:#ffe3ad">●</span> Crypto ${(cryptoV / tot * 100).toFixed(0)}%</span></div>` : ''}
      <div class="kv" style="color:#c3cbef;margin-top:12px"><span>Cash available</span><span class="num">${money(S.balance)}</span></div>
    </div>
    <div class="ticker st"><div>${tk}${tk}</div></div>
    <div class="chips st" style="margin-top:16px">${[['all', 'All'], ['stock', 'Stocks'], ['crypto', 'Crypto'], ['mine', 'My holdings']].map(([k, l]) => `<button class="chip ${invFilter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
    <h2 class="st">${invFilter === 'crypto' ? 'Crypto market' : invFilter === 'stock' ? 'US stocks' : invFilter === 'mine' ? 'Your holdings' : 'Markets'}<span class="link" style="color:var(--up);display:flex;align-items:center;gap:6px"><i style="width:7px;height:7px;border-radius:50%;background:var(--up);box-shadow:0 0 8px var(--up)"></i>Live</span></h2>
    <div class="list">${list.map((a) => {
      const h = S.holdings[a.sym]; const c = chg(a.sym);
      return `<button class="item asset st" data-s="${a.sym}">${coin(a.sym)}
        <div class="sp"><div class="t">${a.name}</div><div class="s">${h ? `${h.qty.toPrecision(5)} ${a.sym}` : a.type === 'crypto' ? 'Crypto' : 'NASDAQ'}</div></div>
        <span data-sp="${a.sym}">${spark(hist[a.sym])}</span>
        <div class="px"><div class="s num" data-p="${a.sym}">${usd(prices[a.sym])}</div><div class="pill num ${c >= 0 ? 'up' : 'down'}" data-c="${a.sym}">${c >= 0 ? '+' : ''}${c.toFixed(2)}%</div></div></button>`;
    }).join('') || '<div class="item mut">You have no holdings yet</div>'}</div>
    <p class="disclaimer">Simulated market prices for demonstration. Not investment advice.</p>`;
  if (!S.hide) { countUp($('#pfv', v), pv.value, shownPf, 1100); shownPf = pv.value; }
  $$('[data-f]', v).forEach((b) => b.onclick = () => { haptic(); invFilter = b.dataset.f; render(null, true); });
  $$('[data-s]', v).forEach((b) => b.onclick = () => { haptic(); assetSheet(b.dataset.s); });
}

let openAsset = null; let assetRange = 'LIVE'; let scrubbing = false;
function chartSVG(arr, w = 360, h = 210) {
  const pts = linePts(arr, w, h, 14); const d = smooth(pts);
  const up = arr[arr.length - 1] >= arr[0]; const col = up ? '#2ee59d' : '#ff5c7a';
  return { pts, w, h, html: `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs><linearGradient id="cg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".38"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    ${[0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="${w}" y1="${h * f}" y2="${h * f}" stroke="rgba(255,255,255,.05)" vector-effect="non-scaling-stroke"/>`).join('')}
    <path d="${d} L${w},${h} L0,${h}Z" fill="url(#cg)"/>
    <path class="ln" d="${d}" fill="none" stroke="${col}" stroke-width="2.4" vector-effect="non-scaling-stroke" style="filter:drop-shadow(0 0 6px ${col}88)"/>
    <line class="cross" id="cx" x1="0" x2="0" y1="0" y2="${h}" stroke="rgba(255,255,255,.4)" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/></svg>
    <div class="cdot cross" style="background:${col};box-shadow:0 0 0 4px ${col}44,0 0 14px ${col}"></div><div class="tip"></div>` };
}
function mountChart(box, sym, animate) {
  const arr = rangeHist(sym, assetRange);
  const c = chartSVG(arr);
  box.innerHTML = c.html;
  box.classList.toggle('static', !animate);
  const n = arr.length;
  const label = (i) => {
    const span = assetRange === 'LIVE' ? (n - 1) * 2500 : RANGES[assetRange].span;
    const t = new Date(Date.now() - (n - 1 - i) / (n - 1) * span);
    if (assetRange === 'LIVE') return t.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (assetRange === '1D') return t.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    return t.toLocaleDateString('en-US', assetRange === '1Y' ? { day: 'numeric', month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' });
  };
  const move = (e) => {
    const r = box.getBoundingClientRect(); const px = clamp((e.clientX - r.left) / r.width, 0, 1);
    const i = Math.round(px * (n - 1)); const [x, y] = c.pts[i];
    box.classList.add('active'); scrubbing = true;
    $('#cx', box).setAttribute('x1', x); $('#cx', box).setAttribute('x2', x);
    const dot = $('.cdot', box); dot.style.left = `${x / c.w * 100}%`; dot.style.top = `${y / c.h * 100}%`;
    const tip = $('.tip', box); tip.textContent = label(i); tip.style.left = `${clamp(x / c.w * 100, 14, 86)}%`;
    const px$ = $('#apx'); if (px$) px$.textContent = usd(arr[i]);
    const d = (arr[i] - arr[0]) / arr[0] * 100; const ac = $('#apc');
    if (ac) { ac.className = `num ${d >= 0 ? 'up' : 'down'}`; ac.textContent = `${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(2)}% · ${label(i)}`; }
    if (box._last !== i) { box._last = i; if (e.pointerType !== 'mouse') haptic('light'); }
  };
  const end = () => { if (!box.classList.contains('active')) return; box.classList.remove('active'); scrubbing = false; updateAssetHead(sym); };
  box.onpointerdown = (e) => { box.setPointerCapture(e.pointerId); move(e); };
  box.onpointermove = (e) => { if (box.classList.contains('active') || e.pointerType === 'mouse') move(e); };
  box.onpointerup = (e) => { if (e.pointerType !== 'mouse') end(); };
  box.onpointercancel = end; box.onpointerleave = end;
}
function updateAssetHead(sym) {
  const arr = rangeHist(sym, assetRange); const d = (arr[arr.length - 1] - arr[0]) / arr[0] * 100;
  const px = $('#apx'); if (!px) return;
  px.textContent = usd(prices[sym]);
  const ac = $('#apc'); ac.className = `num ${d >= 0 ? 'up' : 'down'}`;
  ac.textContent = `${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(2)}% · ${assetRange === 'LIVE' ? 'live session' : assetRange} · ≈ ${fmt(prices[sym] * USD_AED)}`;
}
function assetSheet(sym) {
  const a = ASSETS.find((x) => x.sym === sym);
  assetRange = 'LIVE';
  const h = S.holdings[sym];
  const arr = hist[sym]; const hi = Math.max(...arr); const lo = Math.min(...arr);
  const val = h ? h.qty * prices[sym] * USD_AED : 0;
  openSheet(`<div class="row st">${coin(sym)}<div class="sp"><div style="font-weight:700;font-size:17px">${a.name}</div><div class="mut" style="font-size:12px">${sym} · ${a.type === 'crypto' ? 'Cryptocurrency' : 'NASDAQ · USD'}</div></div></div>
    <div class="big-px num st" id="apx">${usd(prices[sym])}</div>
    <div class="num st" id="apc"></div>
    <div class="ichart st" id="ich"></div>
    <div class="chips st" style="justify-content:center;margin-top:8px">${Object.keys(RANGES).map((r) => `<button class="chip ${r === 'LIVE' ? 'on' : ''}" data-r="${r}">${r}</button>`).join('')}</div>
    <div class="stat-grid st">
      <div class="box"><div class="k">Session high</div><div class="v num">${usd(hi)}</div></div>
      <div class="box"><div class="k">Session low</div><div class="v num">${usd(lo)}</div></div>
      ${h ? `<div class="box"><div class="k">Your units</div><div class="v num">${h.qty.toPrecision(6)}</div></div>
      <div class="box"><div class="k">Return</div><div class="v num ${val >= h.cost ? 'up' : 'down'}">${fmt(val - h.cost)}</div></div>` : `
      <div class="box"><div class="k">Price in AED</div><div class="v num">${fmt(prices[sym] * USD_AED)}</div></div>
      <div class="box"><div class="k">Trading fee</div><div class="v">0.10%</div></div>`}
    </div>
    <div class="btns st" style="margin-top:16px"><button class="btn ghost" id="sl" ${h ? '' : 'disabled'}>Sell</button><button class="btn" id="by">Buy ${sym}</button></div>`, (el) => {
    updateAssetHead(sym);
    mountChart($('#ich', el), sym, true);
    $$('[data-r]', el).forEach((b) => b.onclick = () => {
      haptic(); assetRange = b.dataset.r; $$('[data-r]', el).forEach((x) => x.classList.toggle('on', x === b));
      mountChart($('#ich', el), sym, true); updateAssetHead(sym);
    });
    $('#by', el).onclick = () => tradeSheet(sym, 'buy');
    $('#sl', el).onclick = () => tradeSheet(sym, 'sell');
  });
  openAsset = sym;
}

function tradeSheet(sym, side) {
  openAsset = null;
  const a = ASSETS.find((x) => x.sym === sym); const h = S.holdings[sym];
  openSheet(`<div class="row st">${coin(sym)}<div><div style="font-weight:700;font-size:18px">${side === 'buy' ? 'Buy' : 'Sell'} ${a.name}</div>
      <div class="mut" style="font-size:12px">${usd(prices[sym])} · 1 USD = ${USD_AED} AED · Fee 0.1%</div></div></div>
    <div class="box amount-wrap st" style="margin-top:16px">
      <div class="cur">${side === 'buy' ? 'INVEST · AED' : `SELL · UNITS OF ${sym}`}</div>
      <input id="am" inputmode="decimal" class="amount-in num" placeholder="0" autocomplete="off">
      <div class="quick">${side === 'buy' ? [1000, 10000, 100000, 1000000].map((x) => `<button class="chip" data-q="${x}">${x >= 1e6 ? '1M' : x / 1000 + 'K'}</button>`).join('')
        : [25, 50, 75, 100].map((p) => `<button class="chip" data-p="${p}">${p}%</button>`).join('')}</div>
      <div class="mut" style="font-size:12px">${side === 'buy' ? `Cash available ${money(S.balance)}` : `You hold ${h.qty.toPrecision(6)} ${sym}`}</div>
      <div class="err" id="amE" style="color:var(--down);font-size:12px;margin-top:6px"></div></div>
    <div class="box st" style="margin:12px 0 14px"><div class="kv" style="margin:0"><span>You ${side === 'buy' ? 'receive' : 'get'} (est.)</span><span class="num" id="est" style="font-weight:700">—</span></div></div>
    <div class="slide st" id="slb"></div>`, (el) => {
    const inp = $('#am', el);
    const num = () => Number(inp.value.replace(/,/g, '')) || 0;
    const est = () => {
      const n = num();
      $('#est', el).textContent = side === 'buy' ? `${((n * 0.999) / (prices[sym] * USD_AED)).toPrecision(6)} ${sym}` : fmt(n * prices[sym] * USD_AED * 0.999);
    };
    if (side === 'buy') bindAmount(el, 'am', est); else inp.oninput = est;
    $$('[data-p]', el).forEach((b) => b.onclick = () => { haptic(); inp.value = String(+(h.qty * Number(b.dataset.p) / 100).toPrecision(8)); est(); });
    slider($('#slb', el), side === 'buy' ? `Slide to buy ${sym}` : `Slide to sell ${sym}`, () => {
      const n = num();
      if (!(n > 0)) { fieldError(el, 'am', 'Enter an amount'); return false; }
      if (side === 'buy') {
        if (n > S.balance) { fieldError(el, 'am', 'Insufficient balance'); return false; }
        const r = buy(S.holdings[sym], prices[sym], round2(n));
        confirmPin(`Buy ${sym}`, [['Amount', fmt(n)], ['Fee', fmt(r.fee)], ['Units', r.qty.toPrecision(6)], ['Price', usd(prices[sym])]], () => {
          const r2 = buy(S.holdings[sym], prices[sym], round2(n));
          S.holdings[sym] = r2.holding; S.balance = round2(S.balance - r2.debit);
          addTx({ title: `Bought ${sym}`, cat: 'invest', amount: -r2.debit, via: 'account' });
          note('Order filled', `Bought ${r2.qty.toPrecision(5)} ${sym}`);
          save(); render();
          receipt({ title: `Bought ${a.name}`, amount: r2.debit, rows: [['Units', `${r2.qty.toPrecision(6)} ${sym}`], ['Price', usd(prices[sym])], ['Fee', fmt(r2.fee)]], ref: txRef() });
        });
      } else {
        if (n > h.qty * 1.0000001) { fieldError(el, 'am', 'You do not hold that many units'); return false; }
        const qty = Math.min(n, h.qty);
        confirmPin(`Sell ${sym}`, [['Units', qty.toPrecision(6)], ['Price', usd(prices[sym])], ['Estimate', fmt(qty * prices[sym] * USD_AED * 0.999)]], () => {
          const r = sell(S.holdings[sym], prices[sym], qty);
          if (r.holding) S.holdings[sym] = r.holding; else delete S.holdings[sym];
          S.balance = round2(S.balance + r.credit);
          addTx({ title: `Sold ${sym}`, cat: 'invest', amount: r.credit, via: 'account' });
          note('Order filled', `Sold ${qty.toPrecision(5)} ${sym}`);
          save(); render();
          receipt({ title: `Sold ${a.name}`, amount: r.credit, rows: [['Units', `${qty.toPrecision(6)} ${sym}`], ['Price', usd(prices[sym])], ['Fee', fmt(r.fee)]], ref: txRef() });
        });
      }
      return true;
    });
  });
}

/** Live price ticks update in place (with flash) so nothing jumps while scrolling. */
function liveUpdate() {
  if (tab === 'invest') {
    for (const a of ASSETS) {
      const up = prices[a.sym] >= lastPx[a.sym]; const c = chg(a.sym);
      for (const t of $$(`[data-tk="${a.sym}"]`)) t.textContent = usd(prices[a.sym]);
      for (const t of $$(`[data-tkc="${a.sym}"]`)) { t.className = c >= 0 ? 'up' : 'down'; t.textContent = `${c >= 0 ? '▲' : '▼'}${Math.abs(c).toFixed(2)}%`; }
      const p = $(`[data-p="${a.sym}"]`); if (!p) continue;
      p.textContent = usd(prices[a.sym]);
      p.classList.remove('flash-up', 'flash-down'); void p.offsetWidth; p.classList.add(up ? 'flash-up' : 'flash-down');
      const ce = $(`[data-c="${a.sym}"]`);
      ce.textContent = `${c >= 0 ? '+' : ''}${c.toFixed(2)}%`; ce.className = `pill num ${c >= 0 ? 'up' : 'down'}`;
      $(`[data-sp="${a.sym}"]`).innerHTML = spark(hist[a.sym]);
    }
    const pv = portfolioValue(S.holdings, prices);
    const v = $('#pfv'); if (v && !S.hide) { const [i, d] = splitMoney(pv.value); v.innerHTML = `${i}<span class="dec">.${d}</span>`; shownPf = pv.value; }
    const pp = $('#pfp');
    if (pp && pv.cost) { pp.className = `${pv.pnl >= 0 ? 'up' : 'down'} num`; pp.textContent = `${pv.pnl >= 0 ? '▲' : '▼'} ${fmt(Math.abs(pv.pnl))} (${(pv.pnl / pv.cost * 100).toFixed(2)}%)`; }
  }
  if (openAsset && !scrubbing && !$('#sheet').classList.contains('hidden')) {
    const box = $('#ich'); if (!box) return;
    if (assetRange === 'LIVE') mountChart(box, openAsset, false);
    updateAssetHead(openAsset);
  }
}

// ---------- INSIGHTS ----------
let insRange = 1;
function insights() {
  const now = Date.now();
  const months = monthlySpend(S.txs, now, 6);
  const maxM = Math.max(...months.map((m) => m.total), 1);
  const cur = months[months.length - 1].total;
  const d = new Date(now);
  // Month-to-date vs the same days of last month, so early-month numbers aren't misleading.
  const lmStart = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
  const lmSameDay = new Date(d.getFullYear(), d.getMonth() - 1, d.getDate(), d.getHours(), d.getMinutes()).getTime();
  const spendIn = (a, b) => S.txs.filter((t) => t.ts >= a && t.ts <= b && t.amount < 0 && !['transfer', 'invest'].includes(t.cat));
  const prev = spendIn(lmStart, lmSameDay).reduce((s, t) => s - t.amount, 0);
  const since = new Date(d.getFullYear(), d.getMonth() - (insRange - 1), 1).getTime();
  const cats = spendByCategory(S.txs, since);
  const total = cats.reduce((s, c) => s + c.total, 0) || 1;
  const budget = 40000;
  const merchants = {};
  for (const t of S.txs) if (t.ts >= since && t.amount < 0 && !['transfer', 'invest'].includes(t.cat)) merchants[t.title] = (merchants[t.title] || 0) - t.amount;
  const top = Object.entries(merchants).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const mName = (k) => new Date(k + '-01T00:00').toLocaleDateString('en-US', { month: 'short' });

  // Smart insight: biggest category change vs the same period last month.
  const byCat = (arr) => arr.reduce((m, t) => { m[t.cat] = (m[t.cat] || 0) - t.amount; return m; }, {});
  const curCat = byCat(spendIn(new Date(d.getFullYear(), d.getMonth(), 1).getTime(), now)); const prevCat = byCat(spendIn(lmStart, lmSameDay));
  let tip = null;
  for (const k of new Set([...Object.keys(curCat), ...Object.keys(prevCat)])) {
    const diff = (curCat[k] || 0) - (prevCat[k] || 0);
    if (!tip || Math.abs(diff) > Math.abs(tip.diff)) tip = { k, diff };
  }

  const R = 56; const C = 2 * Math.PI * R;
  const v = $('#view');
  v.innerHTML = `
    <div class="hero gborder st" style="background:linear-gradient(135deg,rgba(124,140,255,.3),rgba(30,36,80,.35) 50%,rgba(79,209,255,.2))">
      <div class="hero-lbl">Spent this month</div>
      <div class="hero-bal num"><small>AED</small><span id="spent"></span></div>
      <div class="row" style="gap:8px"><span class="delta" style="${cur > prev ? 'background:rgba(255,92,122,.14);color:var(--down)' : ''}">${prev ? `${cur <= prev ? '▼' : '▲'} ${Math.abs((cur - prev) / prev * 100).toFixed(1)}%` : '—'}</span><span class="mut" style="font-size:12px">vs same period last month</span></div>
      <div class="meter" style="margin-top:16px"><i data-w="${Math.min(100, cur / budget * 100).toFixed(1)}"></i></div>
      <div class="kv" style="color:#c3cbef"><span>Monthly budget</span><span class="num">${fmt(cur, '')} / ${fmt(budget, '')}</span></div>
    </div>
    ${tip ? `<div class="box st row" style="margin-top:12px;gap:14px"><div class="ico" style="--c:#ffe3ad">${ICON.spark}</div>
      <div class="sp" style="font-size:13.5px"><b>Smart insight</b><div class="mut">${CATEGORIES[tip.k]?.label || tip.k} spending is ${tip.diff <= 0 ? '<span class="up">down</span>' : '<span class="down">up</span>'} ${fmt(Math.abs(tip.diff))} vs the same period last month.</div></div></div>` : ''}
    <h2 class="st">Last 6 months <span class="link" id="barSel" style="color:var(--mut);font-weight:500">Tap a bar</span></h2>
    <div class="box st"><div class="bars" id="bars">${months.map((m, i) => `<div class="b ${i === months.length - 1 ? 'cur' : ''}" data-i="${i}"><em class="num">${(m.total / 1000).toFixed(1)}k</em><i data-h="${Math.max(4, m.total / maxM * 100)}"></i>${mName(m.key)}</div>`).join('')}</div></div>
    <h2 class="st">By category</h2>
    <div class="chips st" style="margin-bottom:12px">${[[1, 'This month'], [3, '3 months'], [6, '6 months']].map(([k, l]) => `<button class="chip ${insRange === k ? 'on' : ''}" data-r="${k}">${l}</button>`).join('')}</div>
    <div class="box donut-wrap st">
      <svg class="donut" id="donut" viewBox="0 0 150 150">
        <circle r="${R}" cx="75" cy="75" fill="none" stroke="rgba(255,255,255,.05)" stroke-width="18"/>
        ${cats.map((c) => `<circle class="seg" data-cat="${c.cat}" r="${R}" cx="75" cy="75" fill="none" stroke="${CATEGORIES[c.cat].color}" stroke-width="18" stroke-dasharray="0 ${C.toFixed(2)}" stroke-dashoffset="0" transform="rotate(-90 75 75)"/>`).join('')}
        <text x="75" y="70" text-anchor="middle" fill="#8d97b8" font-size="10.5" id="dl">Total</text>
        <text x="75" y="88" text-anchor="middle" fill="#f3f5ff" font-size="16" font-weight="800" id="dv">${(total / 1000).toFixed(1)}k</text></svg>
      <div class="legend" id="leg">${cats.slice(0, 7).map((c) => `<button data-cat="${c.cat}"><i style="background:${CATEGORIES[c.cat].color};box-shadow:0 0 8px ${CATEGORIES[c.cat].color}"></i>${CATEGORIES[c.cat].label}<b class="num">${(c.total / total * 100).toFixed(0)}%</b></button>`).join('')}</div>
    </div>
    <div class="list" style="margin-top:12px">${cats.map((c) => `<div class="item st"><div class="ico" style="--c:${CATEGORIES[c.cat].color}">${CATEGORIES[c.cat].icon}</div>
      <div class="sp"><div class="t">${CATEGORIES[c.cat].label}</div><div class="meter" style="margin:7px 0 0;height:6px"><i data-w="${(c.total / cats[0].total * 100).toFixed(1)}" style="background:${CATEGORIES[c.cat].color};box-shadow:0 0 10px ${CATEGORIES[c.cat].color}"></i></div></div>
      <div class="amt num">${money(c.total, '')}</div></div>`).join('')}</div>
    <h2 class="st">Top merchants</h2>
    <div class="list">${top.map(([n, a], i) => `<div class="item st"><div class="ico" style="--c:${['#ffe3ad', '#c0c7e0', '#e0a36f', '#7c8cff', '#7c8cff'][i]};font-weight:800;font-size:14px">${i + 1}</div><div class="sp t">${esc(n)}</div><div class="amt num">${money(a)}</div></div>`).join('')}</div>`;

  if (S.hide) $('#spent', v).textContent = '••••••'; else countUp($('#spent', v), cur, 0, 1200);
  setTimeout(() => {
    $$('#bars i', v).forEach((b) => { b.style.height = b.dataset.h + '%'; }); $('#bars', v).classList.add('in');
    $$('.meter i[data-w]', v).forEach((m) => { m.style.width = m.dataset.w + '%'; });
    let acc = 0;
    $$('#donut .seg', v).forEach((s) => {
      const c = cats.find((x) => x.cat === s.dataset.cat); const len = c.total / total * C;
      s.setAttribute('stroke-dasharray', `${Math.max(0, len - 1.5).toFixed(2)} ${(C - len + 1.5).toFixed(2)}`); s.setAttribute('stroke-dashoffset', (-acc).toFixed(2)); acc += len;
    });
  }, 220);

  $$('#bars .b', v).forEach((b) => b.onclick = () => {
    haptic(); $$('#bars .b', v).forEach((x) => x.classList.toggle('sel', x === b));
    const m = months[b.dataset.i]; $('#barSel', v).innerHTML = `<span style="color:var(--txt)">${mName(m.key)}: <b class="num">${fmt(m.total)}</b></span>`;
  });
  let focus = null;
  const setFocus = (cat) => {
    focus = focus === cat ? null : cat; haptic();
    $('#donut', v).classList.toggle('focus', !!focus); $('#leg', v).classList.toggle('focus', !!focus);
    $$('[data-cat]', v).forEach((x) => x.classList.toggle('on', x.dataset.cat === focus));
    const c = cats.find((x) => x.cat === focus);
    $('#dl', v).textContent = c ? CATEGORIES[c.cat].label : 'Total';
    $('#dv', v).textContent = `${((c ? c.total : total) / 1000).toFixed(1)}k`;
  };
  $$('[data-cat]', v).forEach((x) => x.onclick = () => setFocus(x.dataset.cat));
  $$('[data-r]', v).forEach((b) => b.onclick = () => { haptic(); insRange = Number(b.dataset.r); render(null, true); });
}

// ---------- profile & notifications ----------
$('#btnProfile').onclick = () => {
  haptic();
  openSheet(`<div class="row st" style="margin-bottom:18px"><div class="avatar" style="width:64px;height:64px;font-size:20px">AM</div>
      <div><div style="font-weight:800;font-size:20px">A. Marar</div><div class="mut" style="font-size:13px">Private Banking · Velora Demo</div></div></div>
    <div class="box st"><div class="kv" style="margin:0"><span>Account</span><span>Current Account</span></div>
      <div class="kv"><span>IBAN</span><span class="num" style="font-size:12px">${formatIban(ACCOUNT_IBAN)}</span></div>
      <div class="kv"><span>SWIFT</span><span class="num">VLRADEMO</span></div>
      <div class="kv"><span>Currency</span><span>AED 🇦🇪</span></div></div>
    <div class="list st" style="margin-top:14px">
      <button class="item" id="cp"><div class="ico" style="--c:#4fd1ff">${ICON.copy.replace(/"14"/g, '"20"')}</div><div class="sp t">Copy IBAN</div></button>
      <button class="item" id="hb"><div class="ico" style="--c:#a78bfa">${ICON.eyeOff.replace(/"16"/g, '"20"')}</div><div class="sp t">Hide balances</div><div class="switch ${S.hide ? 'on' : ''}"></div></button>
      <button class="item" id="lk"><div class="ico" style="--c:#ffe3ad">${ICON.lock}</div><div class="sp t">Lock app</div></button>
      <button class="item" id="rs"><div class="ico" style="--c:#ff8aa0">${ICON.reset}</div><div class="sp t">Reset demo (AED 5,000,000)</div></button>
    </div>
    <p class="disclaimer">Velora is a fictional banking simulator. It is not a bank, holds no money and cannot send real payments.</p>`, (el) => {
    $('#cp', el).onclick = async () => { try { await navigator.clipboard.writeText(ACCOUNT_IBAN); } catch { /* ignore */ } haptic(); toast('IBAN copied'); };
    $('#hb', el).onclick = () => { haptic(); S.hide = !S.hide; shownBal = 0; save(); $('#hb .switch', el).classList.toggle('on', S.hide); render(); };
    $('#lk', el).onclick = () => { closeSheet(); lock(); };
    $('#rs', el).onclick = () => {
      if (!confirm('Reset all demo data and restore the AED 5,000,000 balance?')) return;
      S = freshState(); shownBal = 0; shownPf = 0; save(); closeSheet(); go('home'); toast('Demo reset');
    };
  });
};
$('#btnBell').onclick = () => {
  haptic(); S.unread = false; save(); $('#bellDot').classList.add('hidden');
  openSheet(`<h3>Notifications</h3><div class="list">${S.notes.slice(0, 30).map((n) => `<div class="item st"><div class="ico" style="--c:#ffe3ad">${ICON.bell}</div><div class="sp"><div class="t">${esc(n.t)}</div><div class="s" style="white-space:normal">${esc(n.s)}</div><div class="s">${when(n.ts)}</div></div></div>`).join('')}</div>`);
};

// ---------- lock screen ----------
let entered = '';
function lock() {
  entered = ''; drawDots(); shownBal = 0;
  $('#lock').classList.remove('hidden', 'out'); $('#app').classList.add('hidden');
}
function unlock() {
  const d = $('#pinDots'); d.classList.add('ok'); haptic('success');
  setTimeout(() => {
    $('#lock').classList.add('out'); $('#app').classList.remove('hidden');
    tab = 'home'; for (const b of $$('#tabs button')) b.classList.toggle('on', b.dataset.tab === 'home');
    requestAnimationFrame(moveInd); render(null, true);
    setTimeout(() => { $('#lock').classList.add('hidden'); d.classList.remove('ok'); entered = ''; drawDots(); }, 600);
  }, 260);
}
function drawDots() { [...$('#pinDots').children].forEach((d, i) => d.classList.toggle('f', i < entered.length)); }
$('#keypad').innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'bio', '0', '⌫'].map((k) => k === 'bio' ? `<button data-k="bio" class="bio" aria-label="Fingerprint">${ICON.finger}</button>` : `<button data-k="${k}">${k}</button>`).join('');
$('#keypad').addEventListener('click', (e) => {
  const k = e.target.closest('button')?.dataset.k; if (!k) return;
  haptic('light');
  if (k === 'bio') {
    const s = document.createElement('div'); s.className = 'scan';
    s.innerHTML = `${ICON.finger}<div class="bar"></div>`; $('#lock').appendChild(s);
    setTimeout(() => { s.remove(); unlock(); }, 1300); return;
  }
  if (k === '⌫') entered = entered.slice(0, -1); else if (entered.length < 4) entered += k;
  drawDots();
  if (entered.length === 4) {
    if (entered === PIN) unlock();
    else {
      haptic('error'); const d = $('#pinDots'); d.classList.add('shake');
      setTimeout(() => { d.classList.remove('shake'); entered = ''; drawDots(); }, 420);
    }
  }
});

const hr = new Date().getHours();
const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
$('#hello').textContent = greet;
$('#lockHi').textContent = `${greet}, A. Marar`;
if (!S.unread) $('#bellDot').classList.add('hidden');

// Android back button closes sheets first
window.Capacitor?.Plugins?.App?.addListener?.('backButton', () => {
  if (!$('#sheet').classList.contains('hidden')) closeSheet();
  else if (tab !== 'home') go('home');
  else window.Capacitor.Plugins.App.exitApp();
});
