/** Velora — logic self-test (no browser). Run: node scripts/selftest.mjs */
import { validateIban, makeIban, formatIban, buy, sell, portfolioValue, seedTransactions, monthlySpend, spendByCategory, fmt, USD_AED } from '../www/js/core.js';

let pass = 0; let fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ✓', l); } else { fail++; console.log('  ✗', l); } };

console.log('IBAN');
ok(validateIban('GB82 WEST 1234 5698 7654 32').ok, 'known-good GB IBAN passes');
ok(validateIban('AE070331234567890123456').ok, 'known-good AE IBAN passes');
ok(!validateIban('AE070331234567890123457').ok, 'bad checksum fails');
ok(!validateIban('AE07033123456789012345').ok, 'wrong AE length fails');
ok(!validateIban('hello').ok, 'garbage fails');
const mine = makeIban('AE', '9991027048815390021');
ok(mine.length === 23 && validateIban(mine).ok, `generated IBAN valid (${formatIban(mine)})`);

console.log('Trading');
const b = buy(null, 100, 3672.5);
ok(Math.abs(b.qty - 9.99) < 1e-4 && b.fee === 3.67, 'buy applies 0.1% fee');
const s = sell(b.holding, 100, b.qty / 2);
ok(s.holding && Math.abs(s.holding.qty - b.qty / 2) < 1e-9 && Math.abs(s.holding.cost - 1836.25) < 0.01, 'half sell halves cost basis');
ok(sell(b.holding, 100, b.qty).holding === null, 'full sell clears holding');
let threw = false; try { sell(b.holding, 100, b.qty * 2); } catch { threw = true; }
ok(threw, 'overselling is rejected');
const pv = portfolioValue({ X: { qty: 1, cost: 300 } }, { X: 100 });
ok(pv.value === Math.round(100 * USD_AED * 100) / 100 && pv.pnl === Math.round((100 * USD_AED - 300) * 100) / 100, 'portfolio value & pnl');

console.log('Insights');
const now = Date.UTC(2026, 9, 9);
const txs = seedTransactions(now);
ok(txs.length > 100 && txs[0].ts >= txs[txs.length - 1].ts, `seeded history sorted (${txs.length} tx)`);
ok(JSON.stringify(seedTransactions(now)) === JSON.stringify(txs), 'seed is deterministic');
const m = monthlySpend(txs, now, 6);
ok(m.length === 6 && m.every((x) => x.total >= 0), 'six monthly totals');
ok(spendByCategory(txs, 0).every((c, i, a) => i === 0 || a[i - 1].total >= c.total), 'categories sorted desc');
ok(fmt(5000000) === 'AED 5,000,000.00', 'money format');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
