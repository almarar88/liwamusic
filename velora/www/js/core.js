/**
 * Velora — pure logic (no DOM): money, IBAN, ledger, portfolio.
 * Everything here is simulated; no real funds or market orders exist.
 */

export const USD_AED = 3.6725;
export const OPENING_BALANCE = 5_000_000;

export function fmt(n, cur = 'AED', dp = 2) {
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return `${n < 0 ? '-' : ''}${cur ? cur + ' ' : ''}${s}`;
}

export function round2(n) { return Math.round(n * 100) / 100; }

/** ISO 13616 IBAN lengths for common countries. */
const IBAN_LEN = {
  AE: 23, SA: 24, QA: 29, KW: 30, BH: 22, OM: 23, JO: 30, EG: 29, LB: 28, TR: 26,
  GB: 22, DE: 22, FR: 27, ES: 24, IT: 27, NL: 18, BE: 16, CH: 21, AT: 20, IE: 22,
  PT: 25, SE: 24, NO: 15, DK: 18, FI: 18, PL: 28, PK: 24, LU: 20, GR: 27, CY: 28,
};

export function cleanIban(s) { return String(s || '').replace(/\s+/g, '').toUpperCase(); }

export function formatIban(s) { return cleanIban(s).replace(/(.{4})/g, '$1 ').trim(); }

/** Validates structure, country length and the mod-97 checksum. */
export function validateIban(input) {
  const iban = cleanIban(input);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(iban)) return { ok: false, reason: 'Invalid IBAN format' };
  const cc = iban.slice(0, 2);
  if (IBAN_LEN[cc] && iban.length !== IBAN_LEN[cc]) {
    return { ok: false, reason: `${cc} IBANs must be ${IBAN_LEN[cc]} characters` };
  }
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  if (rem !== 1) return { ok: false, reason: 'IBAN checksum failed' };
  return { ok: true, iban, country: cc };
}

/** Builds a valid IBAN for a country + BBAN (used for the demo's own accounts). */
export function makeIban(cc, bban) {
  const moved = bban + cc + '00';
  let rem = 0;
  for (const ch of moved) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  const check = String(98 - rem).padStart(2, '0');
  return cc + check + bban;
}

export const CATEGORIES = {
  groceries: { label: 'Groceries', color: '#34d399', icon: '🛒' },
  dining: { label: 'Dining', color: '#f59e0b', icon: '🍽️' },
  shopping: { label: 'Shopping', color: '#ec4899', icon: '🛍️' },
  travel: { label: 'Travel', color: '#38bdf8', icon: '✈️' },
  transport: { label: 'Transport', color: '#a78bfa', icon: '🚗' },
  bills: { label: 'Bills & Utilities', color: '#f87171', icon: '💡' },
  entertainment: { label: 'Entertainment', color: '#facc15', icon: '🎬' },
  health: { label: 'Health', color: '#2dd4bf', icon: '⚕️' },
  transfer: { label: 'Transfers', color: '#94a3b8', icon: '↗' },
  invest: { label: 'Investments', color: '#60a5fa', icon: '📈' },
  income: { label: 'Income', color: '#22c55e', icon: '↙' },
};

const MERCHANTS = {
  groceries: ['Fresh Market', 'Green Basket', 'Daily Mart', 'Organic Corner'],
  dining: ['Saffron Grill', 'Café Lumière', 'Marina Sushi', 'Burger Lab', 'Karak House'],
  shopping: ['Mall Boutique', 'TechZone', 'Luxe Atelier', 'Home Studio'],
  travel: ['SkyWings Airlines', 'Palm Resort', 'Desert Safari Co.', 'Grand Hotel'],
  transport: ['City Taxi', 'Fuel Station', 'Metro Card', 'Ride Share'],
  bills: ['Electricity & Water', 'Mobile Postpaid', 'Home Internet', 'District Cooling'],
  entertainment: ['Cinema City', 'StreamPlus', 'Music Box', 'Theme Park'],
  health: ['Wellness Clinic', 'City Pharmacy', 'Fitness Club'],
};

/** Deterministic PRNG so seeded history looks the same on every install. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ~6 months of card/account activity for the insights screen. */
export function seedTransactions(now = Date.now(), seed = 7) {
  const r = rng(seed);
  const out = [];
  const day = 86400000;
  const cats = Object.keys(MERCHANTS);
  const weights = { groceries: 5, dining: 6, shopping: 3, travel: 1, transport: 5, bills: 2, entertainment: 2, health: 1 };
  const bag = cats.flatMap((c) => Array(weights[c]).fill(c));
  for (let d = 180; d >= 1; d--) {
    const n = Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const cat = bag[Math.floor(r() * bag.length)];
      const base = { groceries: 260, dining: 180, shopping: 1400, travel: 5200, transport: 90, bills: 750, entertainment: 220, health: 380 }[cat];
      const amount = round2(base * (0.3 + r() * 1.4));
      const m = MERCHANTS[cat];
      out.push({
        id: `s${d}-${i}`,
        ts: now - d * day + Math.floor(r() * day * 0.9),
        title: m[Math.floor(r() * m.length)],
        cat,
        amount: -amount,
        via: r() < 0.55 ? 'credit' : 'debit',
      });
    }
    if (d % 30 === 25) {
      out.push({ id: `inc${d}`, ts: now - d * day, title: 'Dividend & Interest', cat: 'income', amount: round2(18000 + r() * 4000), via: 'account' });
    }
  }
  return out.sort((a, b) => b.ts - a.ts);
}

export function monthKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Spending (positive numbers) per month for the last `n` months. */
export function monthlySpend(txs, now = Date.now(), n = 6) {
  const keys = [];
  const d = new Date(now);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    keys.push(monthKey(x.getTime()));
  }
  const totals = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const t of txs) {
    if (t.amount >= 0 || t.cat === 'transfer' || t.cat === 'invest') continue;
    const k = monthKey(t.ts);
    if (k in totals) totals[k] = round2(totals[k] - t.amount);
  }
  return keys.map((k) => ({ key: k, total: totals[k] }));
}

export function spendByCategory(txs, sinceTs) {
  const m = {};
  for (const t of txs) {
    if (t.ts < sinceTs || t.amount >= 0 || t.cat === 'transfer' || t.cat === 'invest') continue;
    m[t.cat] = round2((m[t.cat] || 0) - t.amount);
  }
  return Object.entries(m).map(([cat, total]) => ({ cat, total })).sort((a, b) => b.total - a.total);
}

/** Assets: price in USD. Stocks and crypto share one model. */
export const ASSETS = [
  { sym: 'AAPL', name: 'Apple Inc.', type: 'stock', price: 248.3, vol: 0.004 },
  { sym: 'NVDA', name: 'NVIDIA Corp.', type: 'stock', price: 182.6, vol: 0.007 },
  { sym: 'MSFT', name: 'Microsoft Corp.', type: 'stock', price: 512.4, vol: 0.004 },
  { sym: 'TSLA', name: 'Tesla Inc.', type: 'stock', price: 431.2, vol: 0.009 },
  { sym: 'AMZN', name: 'Amazon.com Inc.', type: 'stock', price: 226.9, vol: 0.005 },
  { sym: 'GOOGL', name: 'Alphabet Inc.', type: 'stock', price: 241.7, vol: 0.005 },
  { sym: 'META', name: 'Meta Platforms', type: 'stock', price: 712.5, vol: 0.006 },
  { sym: 'BTC', name: 'Bitcoin', type: 'crypto', price: 118400, vol: 0.006 },
  { sym: 'ETH', name: 'Ethereum', type: 'crypto', price: 4380, vol: 0.008 },
  { sym: 'SOL', name: 'Solana', type: 'crypto', price: 214.5, vol: 0.011 },
  { sym: 'XRP', name: 'XRP', type: 'crypto', price: 2.84, vol: 0.01 },
  { sym: 'BNB', name: 'BNB', type: 'crypto', price: 1012, vol: 0.007 },
  { sym: 'DOGE', name: 'Dogecoin', type: 'crypto', price: 0.247, vol: 0.013 },
];

/** Builds a 60-point history ending at `price` via a seeded random walk. */
export function seedHistory(asset, points = 60) {
  const r = rng(asset.sym.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 3));
  const h = [asset.price];
  for (let i = 1; i < points; i++) {
    const prev = h[0];
    h.unshift(prev / (1 + (r() - 0.48) * asset.vol * 4));
  }
  return h;
}

export function step(price, vol, r = Math.random) {
  const shock = (r() + r() + r() - 1.5) * vol;
  return Math.max(price * (1 + shock), 0.0001);
}

/** Buy `aed` worth of an asset. Returns new holding and cost; fee 0.1%. */
export function buy(holding, priceUsd, aed) {
  const fee = round2(aed * 0.001);
  const qty = (aed - fee) / (priceUsd * USD_AED);
  const h = holding || { qty: 0, cost: 0 };
  return { holding: { qty: h.qty + qty, cost: round2(h.cost + aed) }, qty, fee, debit: aed };
}

/** Sell `qty` units; cost basis is reduced proportionally. */
export function sell(holding, priceUsd, qty) {
  if (!holding || qty <= 0 || qty > holding.qty + 1e-12) throw new Error('Not enough units');
  const gross = qty * priceUsd * USD_AED;
  const fee = round2(gross * 0.001);
  const ratio = qty / holding.qty;
  const left = holding.qty - qty;
  return {
    holding: left < 1e-10 ? null : { qty: left, cost: round2(holding.cost * (1 - ratio)) },
    credit: round2(gross - fee),
    fee,
  };
}

export function portfolioValue(holdings, prices) {
  let value = 0; let cost = 0;
  for (const [sym, h] of Object.entries(holdings)) {
    if (!h || prices[sym] == null) continue;
    value += h.qty * prices[sym] * USD_AED;
    cost += h.cost;
  }
  return { value: round2(value), cost: round2(cost), pnl: round2(value - cost) };
}

export function txRef() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = 'VLR';
  for (let i = 0; i < 10; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}
