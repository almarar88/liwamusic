/**
 * Velora — banking simulator UI. All balances, cards, transfers and trades
 * are simulated locally on the device; nothing touches a real bank or market.
 */
import {
  OPENING_BALANCE, USD_AED, fmt, round2, validateIban, formatIban, cleanIban, makeIban,
  CATEGORIES, seedTransactions, monthlySpend, spendByCategory, ASSETS, seedHistory, step,
  buy, sell, portfolioValue, txRef,
} from './core.js';

const KEY = 'velora.v1';
const PIN = '1234';
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ACCOUNT_IBAN = makeIban('AE', '999' + '1027048815390021');

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

// ---------- market simulation ----------
const prices = {};
const hist = {};
for (const a of ASSETS) { hist[a.sym] = seedHistory(a); prices[a.sym] = a.price; }
setInterval(() => {
  for (const a of ASSETS) {
    prices[a.sym] = step(prices[a.sym], a.vol / 3);
    hist[a.sym].push(prices[a.sym]);
    if (hist[a.sym].length > 120) hist[a.sym].shift();
  }
  liveUpdate();
}, 2500);
const chg = (sym) => { const h = hist[sym]; return (h[h.length - 1] - h[0]) / h[0] * 100; };
const usd = (n) => n >= 1000 ? fmt(n, '$', 2).replace('$ ', '$') : n >= 1 ? '$' + n.toFixed(2) : '$' + n.toFixed(4);

// ---------- helpers ----------
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200);
}
function money(n, cur = 'AED') { return S.hide ? `${cur} ••••••` : fmt(n, cur); }
function when(ts) {
  const d = new Date(ts); const now = new Date();
  const same = d.toDateString() === now.toDateString();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  if (same) return `Today, ${time}`;
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`;
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) + `, ${time}`;
}
function addTx(tx) { S.txs.unshift({ id: txRef(), ts: Date.now(), ...tx }); }
function note(t, s) { S.notes.unshift({ ts: Date.now(), t, s }); S.unread = true; $('#bellDot').classList.remove('hidden'); }
function txItem(t) {
  const c = CATEGORIES[t.cat] || CATEGORIES.transfer;
  const via = t.via === 'credit' ? 'Credit card' : t.via === 'debit' ? 'Debit card' : 'Account';
  return `<div class="item"><div class="ico" style="color:${c.color}">${c.icon}</div>
    <div class="sp"><div class="t">${esc(t.title)}</div><div class="s">${when(t.ts)} · ${via}</div></div>
    <div class="amt num ${t.amount > 0 ? 'up' : ''}">${t.amount > 0 ? '+' : ''}${S.hide ? '••••' : fmt(t.amount, '')}</div></div>`;
}
function spark(arr, w = 70, h = 30, color) {
  const min = Math.min(...arr); const max = Math.max(...arr); const rg = max - min || 1;
  const pts = arr.map((v, i) => `${(i / (arr.length - 1) * w).toFixed(1)},${(h - 2 - (v - min) / rg * (h - 4)).toFixed(1)}`).join(' ');
  const col = color || (arr[arr.length - 1] >= arr[0] ? 'var(--up)' : 'var(--down)');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline fill="none" stroke="${col}" stroke-width="1.8" points="${pts}"/></svg>`;
}
function area(arr, w = 340, h = 190) {
  const min = Math.min(...arr); const max = Math.max(...arr); const rg = max - min || 1;
  const xy = arr.map((v, i) => [i / (arr.length - 1) * w, h - 10 - (v - min) / rg * (h - 30)]);
  const line = xy.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ');
  const up = arr[arr.length - 1] >= arr[0];
  const col = up ? '#22c55e' : '#f43f5e';
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs><linearGradient id="ga" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".35"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    <polygon fill="url(#ga)" points="0,${h} ${line} ${w},${h}"/>
    <polyline fill="none" stroke="${col}" stroke-width="2" points="${line}"/></svg>`;
}

// ---------- sheet ----------
function openSheet(html, onMount) {
  $('#sheetBody').innerHTML = html;
  $('#sheet').classList.remove('hidden');
  onMount?.($('#sheetBody'));
}
function closeSheet() { $('#sheet').classList.add('hidden'); $('#sheetBody').innerHTML = ''; }
$('#sheet').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });

/** PIN confirmation step reused by transfers, trades and card payments. */
function confirmPin(title, rows, onOk) {
  openSheet(`<h3>${esc(title)}</h3>
    <div class="box">${rows.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><span class="num">${esc(v)}</span></div>`).join('')}</div>
    <div class="field" style="margin-top:16px"><label>Enter your 4-digit PIN to authorise (demo: 1234)</label>
      <input id="pin" type="password" inputmode="numeric" maxlength="4" class="big-input" autocomplete="off"><div class="err" id="pinErr"></div></div>
    <div class="btns"><button class="btn ghost" data-close>Cancel</button><button class="btn" id="pinOk">Confirm</button></div>`, (el) => {
    const inp = $('#pin', el); inp.focus();
    const go = () => {
      if (inp.value !== PIN) { $('#pinErr', el).textContent = 'Incorrect PIN'; inp.value = ''; return; }
      onOk();
    };
    $('#pinOk', el).onclick = go;
    inp.addEventListener('keyup', (e) => { if (inp.value.length === 4 || e.key === 'Enter') go(); });
  });
}

function receipt({ title, amount, rows, ref }) {
  openSheet(`<div class="receipt">
      <div class="ok">✓</div>
      <div class="mut">${esc(title)}</div>
      <div class="amt num">${fmt(amount)}</div>
      <div class="box" style="margin-top:16px">${rows.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><span class="num" style="text-align:right;max-width:62%;overflow-wrap:anywhere">${esc(v)}</span></div>`).join('')}
        <div class="kv"><span>Reference</span><span class="num">${ref}</span></div>
        <div class="kv"><span>Date</span><span>${new Date().toLocaleString('en-GB')}</span></div></div>
      <div class="stamp">SIMULATION · NO REAL FUNDS WERE MOVED</div>
      <button class="btn" style="margin-top:16px" data-close>Done</button></div>`);
}

// ---------- tabs ----------
let tab = 'home';
const views = { home, cards, pay, invest, insights };
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  go(b.dataset.tab);
});
function go(t, opts) {
  tab = t;
  for (const b of $('#tabs').children) b.classList.toggle('on', b.dataset.tab === t);
  $('#view').scrollTop = 0;
  render(opts);
}
function render(opts) { $('#view').innerHTML = ''; views[tab](opts); }

// ---------- HOME ----------
function home() {
  const pv = portfolioValue(S.holdings, prices);
  const cr = S.cards.credit;
  const v = $('#view');
  v.innerHTML = `
    <div class="hero">
      <div class="hero-lbl">Current Account · Private Banking <button class="eye" id="eye">${S.hide ? '🙈' : '👁'}</button></div>
      <div class="hero-bal num"><small>AED</small>${S.hide ? '••••••••' : fmt(S.balance, '')}</div>
      <div class="hero-iban">${formatIban(ACCOUNT_IBAN)}</div>
      <div class="row" style="margin-top:14px;font-size:12.5px;color:#b7c1e3">
        <span>Available</span><span class="sp"></span><span class="num">${money(S.balance)}</span></div>
    </div>
    <div class="qa">
      <button data-a="send"><span>↗</span>Send</button>
      <button data-a="bills"><span>💡</span>Pay bills</button>
      <button data-a="fx"><span>💱</span>Exchange</button>
      <button data-a="stmt"><span>📄</span>Statement</button>
    </div>
    <h2>My accounts</h2>
    <div class="accts">
      <div class="box acct"><div class="k">Savings Pocket</div><div class="v num">${money(S.savings)}</div></div>
      <div class="box acct"><div class="k">Investments</div><div class="v num">${money(pv.value)}</div>
        <div class="k ${pv.pnl >= 0 ? 'up' : 'down'}" style="margin-top:2px">${pv.cost ? (pv.pnl >= 0 ? '+' : '') + fmt(pv.pnl, '') : 'Start investing'}</div></div>
      <div class="box acct"><div class="k">Credit card due</div><div class="v num">${money(cr.used)}</div></div>
    </div>
    <h2>Recent activity <button class="link" data-a="stmt">See all</button></h2>
    <div class="list">${S.txs.slice(0, 8).map(txItem).join('')}</div>
    <p class="disclaimer">Velora is a banking simulator for demonstration. Balances, cards, transfers and trades are not real.</p>`;
  $('#eye', v).onclick = () => { S.hide = !S.hide; save(); render(); };
  v.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => ({
    send: () => go('pay', { mode: 'iban' }), bills: () => go('pay', { mode: 'bills' }), fx: fxSheet, stmt: statementSheet,
  })[b.dataset.a]());
}

function statementSheet() {
  openSheet(`<h3>All transactions</h3>
    <div class="field"><input id="q" placeholder="Search merchant or category"></div>
    <div class="list" id="stl"></div>`, (el) => {
    const draw = () => {
      const q = $('#q', el).value.toLowerCase();
      const rows = S.txs.filter((t) => !q || t.title.toLowerCase().includes(q) || (CATEGORIES[t.cat]?.label || '').toLowerCase().includes(q));
      $('#stl', el).innerHTML = rows.slice(0, 200).map(txItem).join('') || '<div class="item mut">No results</div>';
    };
    $('#q', el).oninput = draw; draw();
  });
}

function fxSheet() {
  const R = { USD: 1 / USD_AED, EUR: 0.2338, GBP: 0.2031, SAR: 1.0211, INR: 24.17, PKR: 76.9, EGP: 13.18, JPY: 41.6 };
  openSheet(`<h3>Exchange rates</h3>
    <div class="field"><label>Amount in AED</label><input id="fxa" inputmode="decimal" value="1000"></div>
    <div class="list" id="fxl"></div><p class="disclaimer">Indicative demo rates.</p>`, (el) => {
    const draw = () => {
      const a = Number($('#fxa', el).value) || 0;
      $('#fxl', el).innerHTML = Object.entries(R).map(([c, r]) => `<div class="item"><div class="ico">${c}</div>
        <div class="sp"><div class="t">${c}</div><div class="s">1 AED = ${r.toFixed(4)} ${c}</div></div><div class="amt num">${fmt(a * r, c)}</div></div>`).join('');
    };
    $('#fxa', el).oninput = draw; draw();
  });
}

// ---------- CARDS ----------
let cardSel = 'debit';
let reveal = false; let revealT;
const CARD_INFO = {
  debit: { name: 'Platinum Debit', pan: '4000 1234 5678 9010', exp: '09/30', cvv: '381', net: 'VISA' },
  credit: { name: 'Infinite Credit', pan: '5100 2345 6789 0127', exp: '11/31', cvv: '642', net: 'mastercard' },
};
function cards() {
  const c = S.cards[cardSel]; const info = CARD_INFO[cardSel];
  const pan = reveal ? info.pan : '•••• •••• •••• ' + info.pan.slice(-4);
  const txs = S.txs.filter((t) => t.via === cardSel).slice(0, 10);
  const v = $('#view');
  v.innerHTML = `
    <div class="card-tabs"><button class="chip ${cardSel === 'debit' ? 'on' : ''}" data-c="debit">Debit card</button>
      <button class="chip ${cardSel === 'credit' ? 'on' : ''}" data-c="credit">Credit card</button></div>
    <div class="bcard ${cardSel} ${c.frozen ? 'frozen' : ''}">
      <div class="bk">Velora</div><div class="tp">${info.name.toUpperCase()}</div><div class="wm">DEMO CARD</div>
      <div class="chipi"></div>
      <div class="pan">${pan}</div>
      <div class="meta"><div>CARD HOLDER<b>A. MARAR</b></div><div style="margin-left:22px">EXPIRES<b>${reveal ? info.exp : '••/••'}</b></div>
        <div style="margin-left:22px">CVV<b>${reveal ? info.cvv : '•••'}</b></div><div class="net">${info.net}</div></div>
      ${c.frozen ? '<div class="frz">❄ FROZEN</div>' : ''}
    </div>
    <div class="ctrl">
      <button data-k="frozen" class="${c.frozen ? 'on' : ''}"><span>❄</span>${c.frozen ? 'Unfreeze' : 'Freeze'}</button>
      <button data-k="reveal" class="${reveal ? 'on' : ''}"><span>👁</span>Details</button>
      <button data-k="limits"><span>⚙</span>Limits</button>
      <button data-k="pin"><span>🔑</span>Card PIN</button>
    </div>
    ${cardSel === 'credit' ? `<h2>Credit limit</h2><div class="box">
      <div class="row"><div><div class="mut" style="font-size:12px">Outstanding</div><div style="font-weight:700;font-size:20px" class="num">${money(c.used)}</div></div>
      <span class="sp"></span><div style="text-align:right"><div class="mut" style="font-size:12px">Available</div><div style="font-weight:700" class="num">${money(c.limit - c.used)}</div></div></div>
      <div class="meter"><i style="width:${Math.min(100, c.used / c.limit * 100).toFixed(1)}%"></i></div>
      <div class="kv"><span>Credit limit</span><span class="num">${fmt(c.limit)}</span></div>
      <div class="kv"><span>Minimum due</span><span class="num">${fmt(round2(Math.max(c.used * 0.05, c.used ? 100 : 0)))}</span></div>
      <div class="kv"><span>Due date</span><span>${new Date(Date.now() + 14 * 864e5).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span></div>
      <button class="btn" id="payCard" style="margin-top:14px" ${c.used ? '' : 'disabled'}>Pay card bill</button></div>` : `
      <h2>Linked account</h2><div class="box"><div class="kv"><span>Current Account</span><span class="num">${money(S.balance)}</span></div>
      <div class="kv"><span>Daily spending limit</span><span class="num">${fmt(c.limit)}</span></div></div>`}
    <h2>Card settings</h2>
    <div class="list">
      ${[['online', 'Online payments', '🌐'], ['intl', 'International usage', '✈️'], ['contactless', 'Contactless payments', '📶']].map(([k, l, i]) =>
        `<button class="item" data-t="${k}"><div class="ico">${i}</div><div class="sp t">${l}</div><div class="switch ${c[k] ? 'on' : ''}"></div></button>`).join('')}
    </div>
    <h2>Card transactions</h2><div class="list">${txs.map(txItem).join('') || '<div class="item mut">No transactions</div>'}</div>`;

  v.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { cardSel = b.dataset.c; reveal = false; render(); });
  v.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { c[b.dataset.t] = !c[b.dataset.t]; save(); render(); toast('Card setting updated'); });
  v.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => {
    const k = b.dataset.k;
    if (k === 'frozen') { c.frozen = !c.frozen; save(); render(); toast(c.frozen ? 'Card frozen' : 'Card unfrozen'); }
    if (k === 'reveal') {
      if (reveal) { reveal = false; render(); return; }
      confirmPin('Show card details', [['Card', info.name]], () => {
        closeSheet(); reveal = true; render();
        clearTimeout(revealT); revealT = setTimeout(() => { reveal = false; if (tab === 'cards') render(); }, 15000);
      });
    }
    if (k === 'limits') limitSheet(c);
    if (k === 'pin') confirmPin('View card PIN', [['Card', info.name]], () => {
      openSheet(`<h3>Card PIN</h3><div class="box" style="text-align:center;font-size:38px;letter-spacing:12px;font-weight:800">${cardSel === 'debit' ? '4826' : '7319'}</div>
        <button class="btn" style="margin-top:16px" data-close>Close</button>`);
    });
  });
  $('#payCard', v)?.addEventListener('click', () => payCardSheet(c));
}

function limitSheet(c) {
  const max = cardSel === 'credit' ? c.limit : 500000;
  const field = cardSel === 'credit' ? 'spend' : 'limit';
  const cur = cardSel === 'credit' ? (c.spend || c.limit) : c.limit;
  openSheet(`<h3>Spending limit</h3>
    <div class="field"><label>Daily limit (AED)</label><input id="lim" type="range" min="1000" max="${max}" step="1000" value="${cur}" style="width:100%"></div>
    <div class="box" style="text-align:center;font-size:24px;font-weight:700" id="limv">${fmt(cur)}</div>
    <button class="btn" id="limOk" style="margin-top:16px">Save</button>`, (el) => {
    $('#lim', el).oninput = (e) => { $('#limv', el).textContent = fmt(Number(e.target.value)); };
    $('#limOk', el).onclick = () => { c[field] = Number($('#lim', el).value); save(); closeSheet(); render(); toast('Limit updated'); };
  });
}

function payCardSheet(c) {
  openSheet(`<h3>Pay credit card</h3>
    <div class="chips" style="margin-bottom:14px"><button class="chip" data-v="${c.used}">Full ${fmt(c.used)}</button>
      <button class="chip" data-v="${round2(Math.max(c.used * 0.05, 100))}">Minimum</button></div>
    <div class="field"><label>Amount (AED)</label><input id="amt" inputmode="decimal" class="big-input" value="${c.used}"><div class="err" id="e"></div></div>
    <div class="kv"><span>From</span><span>Current Account · ${money(S.balance)}</span></div>
    <button class="btn" id="go" style="margin-top:16px">Continue</button>`, (el) => {
    el.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => { $('#amt', el).value = b.dataset.v; });
    $('#go', el).onclick = () => {
      const a = round2(Number($('#amt', el).value));
      if (!(a > 0) || a > c.used) { $('#e', el).textContent = 'Enter an amount up to the outstanding balance'; return; }
      if (a > S.balance) { $('#e', el).textContent = 'Insufficient balance'; return; }
      confirmPin('Confirm card payment', [['Amount', fmt(a)], ['Card', 'Infinite Credit ••0127']], () => {
        S.balance = round2(S.balance - a); c.used = round2(c.used - a);
        addTx({ title: 'Credit card payment', cat: 'transfer', amount: -a, via: 'account' });
        note('Card payment received', `${fmt(a)} paid to your Infinite Credit card`);
        save(); render();
        receipt({ title: 'Card payment successful', amount: a, rows: [['To', 'Velora Infinite Credit ••0127'], ['From', 'Current Account']], ref: txRef() });
      });
    };
  });
}

// ---------- TRANSFER ----------
let payMode = 'iban';
const PURPOSES = ['Family support', 'Personal transfer', 'Rent', 'Business payment', 'Investment', 'Education', 'Medical', 'Gift', 'Other'];
const BILLERS = [
  ['💡', 'Electricity & Water', 'Account no.'], ['📱', 'Mobile Postpaid', 'Mobile number'], ['🌐', 'Home Internet', 'Account no.'],
  ['🚗', 'Road Toll Top-up', 'Tag number'], ['❄️', 'District Cooling', 'Premise no.'], ['🎓', 'School Fees', 'Student ID'],
];
function pay(opts = {}) {
  if (opts.mode) payMode = opts.mode;
  const v = $('#view');
  v.innerHTML = `<div class="seg">
      <button data-m="iban" class="${payMode === 'iban' ? 'on' : ''}">To IBAN</button>
      <button data-m="own" class="${payMode === 'own' ? 'on' : ''}">My accounts</button>
      <button data-m="bills" class="${payMode === 'bills' ? 'on' : ''}">Bills</button></div><div id="pm"></div>`;
  v.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { payMode = b.dataset.m; render(); });
  ({ iban: payIban, own: payOwn, bills: payBills })[payMode]($('#pm', v), opts);
}

function payIban(el, opts) {
  el.innerHTML = `
    <h2 style="margin-top:4px">Saved beneficiaries</h2>
    <div class="benes">${S.benes.map((b, i) => `<button class="bene" data-b="${i}"><span>${esc(b.name.split(' ').map((w) => w[0]).slice(0, 2).join(''))}</span>${esc(b.name.split(' ')[0])}</button>`).join('')}</div>
    <div class="box" style="margin-top:8px">
      <div class="field"><label>Beneficiary full name</label><input id="nm" autocomplete="off" placeholder="e.g. Omar Khalid"></div>
      <div class="field"><label>IBAN</label><input id="ib" autocomplete="off" autocapitalize="characters" placeholder="AE07 0331 2345 6789 0123 456"><div class="err" id="ibE"></div></div>
      <div class="field"><label>Amount (AED)</label><input id="am" inputmode="decimal" placeholder="0.00"><div class="err" id="amE"></div></div>
      <div class="field"><label>Purpose of payment</label><select id="pu">${PURPOSES.map((p) => `<option>${p}</option>`).join('')}</select></div>
      <div class="field"><label>Note (optional)</label><input id="no" maxlength="60"></div>
      <button class="item" id="sv" style="padding:4px 2px"><div class="sp t" style="font-weight:500">Save as beneficiary</div><div class="switch on"></div></button>
      <div class="kv" style="margin-top:10px"><span>Available</span><span class="num">${money(S.balance)}</span></div>
      <button class="btn" id="go" style="margin-top:14px">Continue</button>
    </div>`;
  let saveBene = true;
  const ib = $('#ib', el);
  const check = () => {
    const raw = cleanIban(ib.value);
    ib.value = formatIban(raw);
    const e = $('#ibE', el);
    if (raw.length < 15) { e.className = 'err'; e.textContent = ''; return null; }
    const r = validateIban(raw);
    e.className = r.ok ? 'okm' : 'err';
    e.textContent = r.ok ? `✓ Valid ${r.country} IBAN${r.country === 'AE' ? ' · Local transfer' : ' · International (SWIFT)'}` : r.reason;
    return r.ok ? r : null;
  };
  ib.oninput = check;
  el.querySelectorAll('[data-b]').forEach((b) => b.onclick = () => {
    const x = S.benes[b.dataset.b]; $('#nm', el).value = x.name; ib.value = x.iban; check(); $('#am', el).focus();
  });
  $('#sv', el).onclick = () => { saveBene = !saveBene; $('#sv .switch', el).classList.toggle('on', saveBene); };
  if (opts.prefill) { $('#nm', el).value = opts.prefill.name; ib.value = opts.prefill.iban; check(); }

  $('#go', el).onclick = () => {
    const name = $('#nm', el).value.trim();
    const r = check();
    const amt = round2(Number(String($('#am', el).value).replace(/,/g, '')));
    $('#amE', el).textContent = '';
    if (!name) { toast('Enter the beneficiary name'); return; }
    if (!r) { $('#ibE', el).className = 'err'; $('#ibE', el).textContent = $('#ibE', el).textContent || 'Enter a valid IBAN'; return; }
    if (r.iban === ACCOUNT_IBAN) { $('#ibE', el).textContent = 'You cannot transfer to your own account here'; return; }
    if (!(amt > 0)) { $('#amE', el).textContent = 'Enter an amount'; return; }
    const local = r.country === 'AE';
    const fee = local ? 0 : 25;
    if (amt + fee > S.balance) { $('#amE', el).textContent = 'Insufficient balance'; return; }
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
      receipt({ title: 'Transfer sent', amount: amt, rows: [['To', name], ['IBAN', formatIban(r.iban)], ['Purpose', purpose], ...(memo ? [['Note', memo]] : []), ['Fee', fmt(fee)], ['New balance', fmt(S.balance)]], ref: txRef() });
    });
  };
}

function payOwn(el) {
  el.innerHTML = `<div class="box">
    <div class="field"><label>From</label><select id="fr"><option value="cur">Current Account — ${money(S.balance)}</option><option value="sav">Savings Pocket — ${money(S.savings)}</option></select></div>
    <div class="field"><label>To</label><input id="to" disabled value="Savings Pocket"></div>
    <div class="field"><label>Amount (AED)</label><input id="am" inputmode="decimal" class="big-input" placeholder="0.00"><div class="err" id="e"></div></div>
    <button class="btn" id="go">Transfer</button></div>`;
  const fr = $('#fr', el);
  fr.onchange = () => { $('#to', el).value = fr.value === 'cur' ? 'Savings Pocket' : 'Current Account'; };
  $('#go', el).onclick = () => {
    const a = round2(Number($('#am', el).value));
    const src = fr.value === 'cur' ? 'balance' : 'savings'; const dst = src === 'balance' ? 'savings' : 'balance';
    if (!(a > 0)) { $('#e', el).textContent = 'Enter an amount'; return; }
    if (a > S[src]) { $('#e', el).textContent = 'Insufficient balance'; return; }
    S[src] = round2(S[src] - a); S[dst] = round2(S[dst] + a);
    addTx({ title: dst === 'savings' ? 'To Savings Pocket' : 'From Savings Pocket', cat: 'transfer', amount: dst === 'savings' ? -a : a, via: 'account' });
    save(); render(); toast(`${fmt(a)} moved`);
  };
}

function payBills(el) {
  el.innerHTML = `<div class="list">${BILLERS.map(([i, n, f], k) => `<button class="item" data-k="${k}"><div class="ico">${i}</div><div class="sp"><div class="t">${n}</div><div class="s">${f}</div></div><span class="mut">›</span></button>`).join('')}</div>`;
  el.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => {
    const [ic, n, f] = BILLERS[b.dataset.k];
    openSheet(`<h3>${ic} ${n}</h3>
      <div class="field"><label>${f}</label><input id="acc" inputmode="numeric"></div>
      <div class="field"><label>Amount (AED)</label><input id="am" inputmode="decimal" class="big-input" placeholder="0.00"><div class="err" id="e"></div></div>
      <button class="btn" id="go">Pay</button>`, (s) => {
      $('#go', s).onclick = () => {
        const acc = $('#acc', s).value.trim(); const a = round2(Number($('#am', s).value));
        if (acc.length < 4) { $('#e', s).textContent = `Enter a valid ${f.toLowerCase()}`; return; }
        if (!(a > 0)) { $('#e', s).textContent = 'Enter an amount'; return; }
        if (a > S.balance) { $('#e', s).textContent = 'Insufficient balance'; return; }
        confirmPin('Confirm bill payment', [['Biller', n], [f, acc], ['Amount', fmt(a)]], () => {
          S.balance = round2(S.balance - a);
          addTx({ title: n, cat: 'bills', amount: -a, via: 'account' });
          note('Bill paid', `${fmt(a)} to ${n}`);
          save(); render();
          receipt({ title: 'Bill paid', amount: a, rows: [['Biller', n], [f, acc]], ref: txRef() });
        });
      };
    });
  });
}

// ---------- INVEST ----------
let invFilter = 'all';
function invest() {
  const pv = portfolioValue(S.holdings, prices);
  const list = ASSETS.filter((a) => invFilter === 'all' || a.type === invFilter || (invFilter === 'mine' && S.holdings[a.sym]));
  const v = $('#view');
  v.innerHTML = `
    <div class="hero pf">
      <div class="hero-lbl">Portfolio value</div>
      <div class="hero-bal num" id="pfv"><small>AED</small>${S.hide ? '••••••' : fmt(pv.value, '')}</div>
      <div id="pfp" class="${pv.pnl >= 0 ? 'up' : 'down'} num" style="font-weight:600">${pv.cost ? `${pv.pnl >= 0 ? '▲' : '▼'} ${fmt(Math.abs(pv.pnl))} (${(pv.pnl / pv.cost * 100).toFixed(2)}%)` : 'No holdings yet'}</div>
      <div class="kv" style="color:#b7c1e3"><span>Cash available</span><span class="num">${money(S.balance)}</span></div>
    </div>
    <div class="chips" style="margin-top:16px">${[['all', 'All'], ['stock', 'Stocks'], ['crypto', 'Crypto'], ['mine', 'My holdings']].map(([k, l]) => `<button class="chip ${invFilter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
    <h2>${invFilter === 'crypto' ? 'Crypto market' : invFilter === 'stock' ? 'US stocks' : invFilter === 'mine' ? 'Your holdings' : 'Markets'}</h2>
    <div class="list">${list.map((a) => {
      const h = S.holdings[a.sym]; const c = chg(a.sym);
      return `<button class="item asset" data-s="${a.sym}"><div class="ico" style="font-weight:800;font-size:11px">${a.sym}</div>
        <div class="sp"><div class="t">${a.name}</div><div class="s">${h ? `${h.qty.toPrecision(5)} ${a.sym}` : a.type === 'crypto' ? 'Crypto' : 'NASDAQ'}</div></div>
        <span data-sp="${a.sym}">${spark(hist[a.sym])}</span>
        <div class="px"><div class="s num" data-p="${a.sym}">${usd(prices[a.sym])}</div><div class="num ${c >= 0 ? 'up' : 'down'}" style="font-size:12px" data-c="${a.sym}">${c >= 0 ? '+' : ''}${c.toFixed(2)}%</div></div></button>`;
    }).join('') || '<div class="item mut">You have no holdings yet</div>'}</div>
    <p class="disclaimer">Simulated market prices for demonstration. Not investment advice.</p>`;
  v.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { invFilter = b.dataset.f; render(); });
  v.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => assetSheet(b.dataset.s));
}

let openAsset = null;
function assetSheet(sym) {
  const a = ASSETS.find((x) => x.sym === sym);
  openAsset = sym;
  const drawBody = () => {
    const h = S.holdings[sym]; const c = chg(sym);
    const val = h ? h.qty * prices[sym] * USD_AED : 0;
    return `<div class="row"><div class="ico" style="font-weight:800;font-size:11px">${sym}</div><div><div style="font-weight:700">${a.name}</div><div class="mut" style="font-size:12px">${a.type === 'crypto' ? 'Cryptocurrency' : 'NASDAQ · USD'}</div></div></div>
      <div style="font-size:28px;font-weight:800;margin-top:12px" class="num" id="apx">${usd(prices[sym])}</div>
      <div class="num ${c >= 0 ? 'up' : 'down'}" id="apc">${c >= 0 ? '▲' : '▼'} ${Math.abs(c).toFixed(2)}% · ≈ ${fmt(prices[sym] * USD_AED)}</div>
      <div id="ach">${area(hist[sym])}</div>
      ${h ? `<div class="box"><div class="kv"><span>Your units</span><span class="num">${h.qty.toPrecision(6)}</span></div>
        <div class="kv"><span>Market value</span><span class="num">${fmt(val)}</span></div>
        <div class="kv"><span>Invested</span><span class="num">${fmt(h.cost)}</span></div>
        <div class="kv"><span>Return</span><span class="num ${val >= h.cost ? 'up' : 'down'}">${fmt(val - h.cost)}</span></div></div>` : ''}
      <div class="btns" style="margin-top:16px"><button class="btn ghost" id="sl" ${h ? '' : 'disabled'}>Sell</button><button class="btn" id="by">Buy</button></div>`;
  };
  openSheet(`<div id="ab">${drawBody()}</div>`, (el) => {
    const bind = () => {
      $('#by', el).onclick = () => tradeSheet(sym, 'buy');
      $('#sl', el).onclick = () => tradeSheet(sym, 'sell');
    };
    bind();
  });
}

function tradeSheet(sym, side) {
  openAsset = null;
  const a = ASSETS.find((x) => x.sym === sym); const h = S.holdings[sym];
  openSheet(`<h3>${side === 'buy' ? 'Buy' : 'Sell'} ${a.name}</h3>
    <div class="mut" style="margin-bottom:12px">Price ${usd(prices[sym])} · 1 USD = ${USD_AED} AED · Fee 0.1%</div>
    ${side === 'buy' ? `<div class="chips" style="margin-bottom:12px">${[1000, 10000, 50000, 100000, 500000].map((x) => `<button class="chip" data-v="${x}">${x.toLocaleString()}</button>`).join('')}</div>
      <div class="field"><label>Amount to invest (AED)</label><input id="am" inputmode="decimal" class="big-input" placeholder="0.00"><div class="err" id="e"></div></div>
      <div class="kv"><span>Cash available</span><span class="num">${money(S.balance)}</span></div>`
    : `<div class="chips" style="margin-bottom:12px">${[25, 50, 75, 100].map((p) => `<button class="chip" data-p="${p}">${p}%</button>`).join('')}</div>
      <div class="field"><label>Units to sell (you hold ${h.qty.toPrecision(6)})</label><input id="am" inputmode="decimal" class="big-input"><div class="err" id="e"></div></div>`}
    <div class="kv"><span>Estimate</span><span class="num" id="est">—</span></div>
    <button class="btn" id="go" style="margin-top:16px">Review order</button>`, (el) => {
    const inp = $('#am', el);
    const est = () => {
      const n = Number(inp.value) || 0;
      $('#est', el).textContent = side === 'buy'
        ? `${((n * 0.999) / (prices[sym] * USD_AED)).toPrecision(6)} ${sym}`
        : fmt(n * prices[sym] * USD_AED * 0.999);
    };
    inp.oninput = est;
    el.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => { inp.value = b.dataset.v; est(); });
    el.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { inp.value = String(h.qty * Number(b.dataset.p) / 100); est(); });
    $('#go', el).onclick = () => {
      const n = Number(inp.value);
      if (!(n > 0)) { $('#e', el).textContent = 'Enter an amount'; return; }
      if (side === 'buy') {
        if (n > S.balance) { $('#e', el).textContent = 'Insufficient balance'; return; }
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
    };
  });
}

/** Updates live prices in place so the list doesn't jump while scrolling. */
function liveUpdate() {
  if (tab === 'invest') {
    for (const a of ASSETS) {
      const p = document.querySelector(`[data-p="${a.sym}"]`); if (!p) continue;
      p.textContent = usd(prices[a.sym]);
      const c = chg(a.sym); const ce = document.querySelector(`[data-c="${a.sym}"]`);
      ce.textContent = `${c >= 0 ? '+' : ''}${c.toFixed(2)}%`; ce.className = `num ${c >= 0 ? 'up' : 'down'}`;
      document.querySelector(`[data-sp="${a.sym}"]`).innerHTML = spark(hist[a.sym]);
    }
    const pv = portfolioValue(S.holdings, prices);
    const v = $('#pfv'); if (v) v.innerHTML = `<small>AED</small>${S.hide ? '••••••' : fmt(pv.value, '')}`;
    const pp = $('#pfp');
    if (pp && pv.cost) { pp.className = `${pv.pnl >= 0 ? 'up' : 'down'} num`; pp.textContent = `${pv.pnl >= 0 ? '▲' : '▼'} ${fmt(Math.abs(pv.pnl))} (${(pv.pnl / pv.cost * 100).toFixed(2)}%)`; }
  }
  if (openAsset && !$('#sheet').classList.contains('hidden')) {
    const sym = openAsset; const c = chg(sym);
    const px = $('#apx'); if (!px) return;
    px.textContent = usd(prices[sym]);
    const ac = $('#apc'); ac.className = `num ${c >= 0 ? 'up' : 'down'}`; ac.textContent = `${c >= 0 ? '▲' : '▼'} ${Math.abs(c).toFixed(2)}% · ≈ ${fmt(prices[sym] * USD_AED)}`;
    $('#ach').innerHTML = area(hist[sym]);
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
  const prev = S.txs.reduce((s, t) => (t.ts >= lmStart && t.ts <= lmSameDay && t.amount < 0 && !['transfer', 'invest'].includes(t.cat) ? s - t.amount : s), 0);
  const since = new Date(d.getFullYear(), d.getMonth() - (insRange - 1), 1).getTime();
  const cats = spendByCategory(S.txs, since);
  const total = cats.reduce((s, c) => s + c.total, 0) || 1;
  const budget = 40000;
  const merchants = {};
  for (const t of S.txs) if (t.ts >= since && t.amount < 0 && !['transfer', 'invest'].includes(t.cat)) merchants[t.title] = (merchants[t.title] || 0) - t.amount;
  const top = Object.entries(merchants).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const mName = (k) => new Date(k + '-01T00:00').toLocaleDateString('en-US', { month: 'short' });

  let acc = 0; const R = 54; const C = 2 * Math.PI * R;
  const arcs = cats.map((c) => {
    const len = c.total / total * C;
    const s = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${CATEGORIES[c.cat].color}" stroke-width="20" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 70 70)"/>`;
    acc += len; return s;
  }).join('');

  const v = $('#view');
  v.innerHTML = `
    <div class="box">
      <div class="mut" style="font-size:12.5px">Spent this month</div>
      <div style="font-size:28px;font-weight:800" class="num">${money(cur)}</div>
      <div class="${cur <= prev ? 'up' : 'down'}" style="font-size:13px">${prev ? `${cur <= prev ? '▼' : '▲'} ${Math.abs((cur - prev) / prev * 100).toFixed(1)}% vs same period last month` : ''}</div>
      <div class="meter"><i style="width:${Math.min(100, cur / budget * 100).toFixed(1)}%"></i></div>
      <div class="kv"><span>Monthly budget</span><span class="num">${fmt(cur, '')} / ${fmt(budget, '')}</span></div>
    </div>
    <h2>Last 6 months</h2>
    <div class="box"><div class="bars">${months.map((m, i) => `<div class="b ${i === months.length - 1 ? 'cur' : ''}"><em>${(m.total / 1000).toFixed(1)}k</em><i style="height:${Math.max(4, m.total / maxM * 100)}%"></i>${mName(m.key)}</div>`).join('')}</div></div>
    <h2>By category</h2>
    <div class="chips" style="margin-bottom:10px">${[[1, 'This month'], [3, '3 months'], [6, '6 months']].map(([k, l]) => `<button class="chip ${insRange === k ? 'on' : ''}" data-r="${k}">${l}</button>`).join('')}</div>
    <div class="box donut-wrap">
      <svg class="donut" viewBox="0 0 140 140">${arcs}<text x="70" y="66" text-anchor="middle" fill="#8b95b3" font-size="10">Total</text>
        <text x="70" y="82" text-anchor="middle" fill="#eef2ff" font-size="13" font-weight="700">${(total / 1000).toFixed(1)}k</text></svg>
      <div class="legend">${cats.slice(0, 7).map((c) => `<div><i style="background:${CATEGORIES[c.cat].color}"></i>${CATEGORIES[c.cat].label}<b class="num">${(c.total / total * 100).toFixed(0)}%</b></div>`).join('')}</div>
    </div>
    <div class="list" style="margin-top:12px">${cats.map((c) => `<div class="item"><div class="ico" style="color:${CATEGORIES[c.cat].color}">${CATEGORIES[c.cat].icon}</div>
      <div class="sp"><div class="t">${CATEGORIES[c.cat].label}</div><div class="meter" style="margin:6px 0 0"><i style="width:${(c.total / cats[0].total * 100).toFixed(1)}%;background:${CATEGORIES[c.cat].color}"></i></div></div>
      <div class="amt num">${money(c.total, '')}</div></div>`).join('')}</div>
    <h2>Top merchants</h2>
    <div class="list">${top.map(([n, a], i) => `<div class="item"><div class="ico">${i + 1}</div><div class="sp t">${esc(n)}</div><div class="amt num">${money(a)}</div></div>`).join('')}</div>`;
  v.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => { insRange = Number(b.dataset.r); render(); });
}

// ---------- profile & notifications ----------
$('#btnProfile').onclick = () => {
  openSheet(`<div class="row" style="margin-bottom:16px"><div class="avatar" style="width:56px;height:56px;display:grid;place-items:center">AM</div>
      <div><div style="font-weight:700;font-size:18px">A. Marar</div><div class="mut" style="font-size:13px">Private Banking · Velora Demo</div></div></div>
    <div class="box"><div class="kv"><span>Account</span><span>Current Account</span></div>
      <div class="kv"><span>IBAN</span><span class="num" style="font-size:12px">${formatIban(ACCOUNT_IBAN)}</span></div>
      <div class="kv"><span>SWIFT</span><span class="num">VLRADEMO</span></div>
      <div class="kv"><span>Currency</span><span>AED</span></div></div>
    <div class="list" style="margin-top:14px">
      <button class="item" id="cp"><div class="ico">📋</div><div class="sp t">Copy IBAN</div></button>
      <button class="item" id="hb"><div class="ico">🙈</div><div class="sp t">Hide balances</div><div class="switch ${S.hide ? 'on' : ''}"></div></button>
      <button class="item" id="lk"><div class="ico">🔒</div><div class="sp t">Lock app</div></button>
      <button class="item" id="rs"><div class="ico">↺</div><div class="sp t">Reset demo (AED 5,000,000)</div></button>
    </div>
    <p class="disclaimer">Velora is a fictional banking simulator. It is not a bank, holds no money and cannot send real payments.</p>`, (el) => {
    $('#cp', el).onclick = async () => { try { await navigator.clipboard.writeText(ACCOUNT_IBAN); } catch { /* ignore */ } toast('IBAN copied'); };
    $('#hb', el).onclick = () => { S.hide = !S.hide; save(); $('#hb .switch', el).classList.toggle('on', S.hide); render(); };
    $('#lk', el).onclick = () => { closeSheet(); lock(); };
    $('#rs', el).onclick = () => {
      if (!confirm('Reset all demo data and restore the AED 5,000,000 balance?')) return;
      S = freshState(); save(); closeSheet(); go('home'); toast('Demo reset');
    };
  });
};
$('#btnBell').onclick = () => {
  S.unread = false; save(); $('#bellDot').classList.add('hidden');
  openSheet(`<h3>Notifications</h3><div class="list">${S.notes.slice(0, 30).map((n) => `<div class="item"><div class="ico">🔔</div><div class="sp"><div class="t">${esc(n.t)}</div><div class="s">${esc(n.s)}</div><div class="s">${when(n.ts)}</div></div></div>`).join('')}</div>`);
};

// ---------- lock screen ----------
let entered = '';
function lock() {
  entered = ''; drawDots();
  $('#lock').classList.remove('hidden'); $('#app').classList.add('hidden');
}
function drawDots() { [...$('#pinDots').children].forEach((d, i) => d.classList.toggle('f', i < entered.length)); }
$('#keypad').innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k) => k ? `<button data-k="${k}">${k}</button>` : '<span></span>').join('');
$('#keypad').addEventListener('click', (e) => {
  const k = e.target.closest('button')?.dataset.k; if (!k) return;
  if (k === '⌫') entered = entered.slice(0, -1); else if (entered.length < 4) entered += k;
  drawDots();
  if (entered.length === 4) {
    if (entered === PIN) {
      setTimeout(() => { $('#lock').classList.add('hidden'); $('#app').classList.remove('hidden'); render(); }, 120);
    } else {
      const d = $('#pinDots'); d.classList.add('shake');
      setTimeout(() => { d.classList.remove('shake'); entered = ''; drawDots(); }, 380);
    }
  }
});

const hr = new Date().getHours();
$('#hello').textContent = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
if (!S.unread) $('#bellDot').classList.add('hidden');

// Android back button closes sheets first
document.addEventListener('backbutton', () => { if (!$('#sheet').classList.contains('hidden')) closeSheet(); });
window.Capacitor?.Plugins?.App?.addListener?.('backButton', () => {
  if (!$('#sheet').classList.contains('hidden')) closeSheet();
  else if (tab !== 'home') go('home');
  else window.Capacitor.Plugins.App.exitApp();
});
