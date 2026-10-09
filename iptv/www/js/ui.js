/* LiwaIPTV — أدوات الواجهة: إشعارات، نوافذ اختيار وتأكيد، صور بغطاء احتياطي،
   عرض القوائم الطويلة على دفعات، والتنقل بالأسهم لريموت أندرويد TV. */
'use strict';

import { esc, hash } from './util.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export const icon = (id, cls = '') => `<svg class="${cls}"><use href="#i-${id}"/></svg>`;

// ———————————————————————————— إشعار عابر

let toastTimer = null;
export function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ———————————————————————————— صورة مع بديل بالأحرف الأولى

/** غلاف/شعار: الأحرف الأولى بلون ثابت تحت الصورة؛ إن فشلت الصورة تختفي فيظهر البديل. */
export function art(src, name, cls = '') {
  const hue = parseInt(hash(String(name || '?')), 36) % 360;
  const initials = /\bcover\b/.test(cls) ? String(name || '?') : String(name || '?').replace(/^[^\p{L}\p{N}]+/u, '').split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
  const img = src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()" />` : '';
  return `<div class="art ${cls}" style="--h:${hue}"><span>${esc(initials)}</span>${img}</div>`;
}

// ———————————————————————————— نافذة سفلية / حوار

const sheet = { resolve: null };

export function openSheet(html, { onMount, wide = false, cls = '' } = {}) {
  const root = $('#sheet');
  const card = $('.sheet-card', root);
  card.className = `sheet-card ${wide ? 'wide' : ''} ${cls}`;
  card.innerHTML = html;
  root.hidden = false;
  requestAnimationFrame(() => root.classList.add('show'));
  if (onMount) onMount(card);
  const first = card.querySelector('[autofocus], .opt.on, .opt, input, button');
  if (first) setTimeout(() => first.focus(), 60);
  return card;
}

export function closeSheet(value = null) {
  const root = $('#sheet');
  if (root.hidden) return false;
  root.classList.remove('show');
  root.hidden = true;
  const r = sheet.resolve; sheet.resolve = null;
  if (r) r(value);
  return true;
}

export const sheetOpen = () => !$('#sheet').hidden;

document.addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });

/** قائمة خيارات؛ تعيد قيمة الخيار أو null. */
export function choose(title, options, { sub = '' } = {}) {
  return new Promise((resolve) => {
    sheet.resolve && sheet.resolve(null);
    const html = `<div class="sheet-head"><b>${esc(title)}</b>${sub ? `<span class="muted sm">${esc(sub)}</span>` : ''}</div>
      <div class="opts">${options.map((o, i) => `<button class="opt ${o.active ? 'on' : ''} ${o.danger ? 'danger' : ''}" data-i="${i}">
        ${o.icon ? icon(o.icon) : ''}<span>${esc(o.label)}${o.hint ? `<small>${esc(o.hint)}</small>` : ''}</span>${o.active ? icon('check', 'tick') : ''}</button>`).join('')}</div>`;
    openSheet(html, {
      onMount(card) {
        card.querySelectorAll('.opt').forEach((b) => b.addEventListener('click', () => closeSheet(options[Number(b.dataset.i)].value)));
      },
    });
    sheet.resolve = resolve;
  });
}

export function confirmBox(text, { ok = 'تأكيد', danger = false } = {}) {
  return new Promise((resolve) => {
    sheet.resolve && sheet.resolve(null);
    openSheet(`<p class="confirm-text">${esc(text)}</p><div class="row end"><button class="btn ghost" data-a="no">إلغاء</button><button class="btn ${danger ? 'danger' : 'primary'}" data-a="yes" autofocus>${esc(ok)}</button></div>`, {
      onMount(card) {
        card.querySelector('[data-a=no]').onclick = () => closeSheet(false);
        card.querySelector('[data-a=yes]').onclick = () => closeSheet(true);
      },
    });
    sheet.resolve = (v) => resolve(!!v);
  });
}

export function promptBox(title, { type = 'text', placeholder = '', value = '', hint = '' } = {}) {
  return new Promise((resolve) => {
    sheet.resolve && sheet.resolve(null);
    openSheet(`<div class="sheet-head"><b>${esc(title)}</b>${hint ? `<span class="muted sm">${esc(hint)}</span>` : ''}</div>
      <input class="input" type="${type}" placeholder="${esc(placeholder)}" value="${esc(value)}" ${type === 'password' || type === 'tel' ? 'inputmode="numeric"' : ''} dir="auto" autofocus />
      <div class="row end"><button class="btn ghost" data-a="no">إلغاء</button><button class="btn primary" data-a="yes">حفظ</button></div>`, {
      onMount(card) {
        const inp = card.querySelector('input');
        const done = () => closeSheet(inp.value);
        card.querySelector('[data-a=no]').onclick = () => closeSheet(null);
        card.querySelector('[data-a=yes]').onclick = done;
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); });
      },
    });
    sheet.resolve = resolve;
  });
}

// ———————————————————————————— عرض القوائم الطويلة على دفعات

/**
 * يعرض عناصر كثيرة دون تجميد الواجهة: دفعة أولى ثم المزيد كلما اقترب التمرير من النهاية.
 * يعيد دالة إيقاف.
 */
export function renderChunks(container, items, renderOne, { chunk = 60, empty = '' } = {}) {
  container.innerHTML = '';
  if (!items.length) { container.innerHTML = empty; return () => {}; }
  let i = 0;
  const sentinel = document.createElement('div');
  sentinel.className = 'sentinel';
  const more = () => {
    const end = Math.min(items.length, i + chunk);
    let html = '';
    for (; i < end; i++) html += renderOne(items[i], i);
    sentinel.insertAdjacentHTML('beforebegin', html);
    if (i >= items.length) { io.disconnect(); sentinel.remove(); }
  };
  container.appendChild(sentinel);
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) more(); }, { rootMargin: '900px' });
  more();
  io.observe(sentinel);
  return () => io.disconnect();
}

/** مراقبة ظهور عناصر لتحميل بيانات إضافية (دليل البرامج، أغلفة TMDB) بتوازٍ محدود. */
export function lazyEach(root, selector, fn, { concurrency = 3 } = {}) {
  const queue = [];
  let active = 0;
  const pump = () => {
    while (active < concurrency && queue.length) {
      const el = queue.shift();
      if (!el.isConnected) continue;
      active++;
      Promise.resolve(fn(el)).catch(() => {}).finally(() => { active--; pump(); });
    }
  };
  const io = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); queue.push(e.target); }
    pump();
  }, { rootMargin: '200px' });
  const scan = () => root.querySelectorAll(`${selector}:not([data-lz])`).forEach((el) => { el.dataset.lz = '1'; io.observe(el); });
  scan();
  const mo = new MutationObserver(scan);
  mo.observe(root, { childList: true, subtree: true });
  return () => { io.disconnect(); mo.disconnect(); queue.length = 0; };
}

// ———————————————————————————— التنقل بالأسهم (ريموت التلفاز)

const FOCUSABLE = 'button:not([disabled]), [href], input:not([type=hidden]):not([type=file]), select, [tabindex]:not([tabindex="-1"])';

/** قابل للتركيز فعلًا: ظاهر وله مساحة (قد يكون خارج الشاشة فيُمرَّر إليه). */
function visible(el) {
  if (el.closest('[hidden]')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

/** يختار أقرب عنصر في اتجاه السهم داخل الطبقة الظاهرة الأعلى. */
export function moveFocus(dir, scope) {
  const cur = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  const all = $$(FOCUSABLE, scope).filter((el) => el !== cur && visible(el));
  if (!cur || !scope.contains(cur)) { (all[0] || null)?.focus(); return !!all[0]; }
  const a = cur.getBoundingClientRect();
  const ac = { x: a.left + a.width / 2, y: a.top + a.height / 2 };
  let best = null; let bestScore = Infinity;
  for (const el of all) {
    const b = el.getBoundingClientRect();
    const bc = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    const dx = bc.x - ac.x; const dy = bc.y - ac.y;
    let main; let cross;
    if (dir === 'left') { if (b.right > a.left + 4 && dx >= -2) continue; main = -dx; cross = Math.abs(dy); }
    if (dir === 'right') { if (b.left < a.right - 4 && dx <= 2) continue; main = dx; cross = Math.abs(dy); }
    if (dir === 'up') { if (b.bottom > a.top + 4 && dy >= -2) continue; main = -dy; cross = Math.abs(dx); }
    if (dir === 'down') { if (b.top < a.bottom - 4 && dy <= 2) continue; main = dy; cross = Math.abs(dx); }
    if (main <= 0) continue;
    const score = main + cross * 2.2;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) {
    best.focus({ preventScroll: true });
    const sec = (dir === 'up' || dir === 'down') && document.body.classList.contains('tv') && best.closest('.row-sec');
    if (sec) {
      // التلفاز: الصف المحدد يصعد كاملًا تحت اللوحة الثابتة
      best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } else {
      best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
    return true;
  }
  return false;
}

export const KEYDIR = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
