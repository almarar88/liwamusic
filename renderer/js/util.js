/* LiwaMusic — أدوات مساعدة للواجهة. تم إنشاؤه عن طريق LiwaMusic. */
'use strict';
window.LM = window.LM || {};

(function (LM) {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  function fmtTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const s = Math.floor(sec % 60);
    const m = Math.floor((sec / 60) % 60);
    const h = Math.floor(sec / 3600);
    const mm = h ? String(m).padStart(2, '0') : String(m);
    return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
  }

  function fmtLong(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    if (h && m) return `${h} س ${m} د`;
    if (h) return `${h} ساعة`;
    return `${m} دقيقة`;
  }

  function fmtSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = Number(bytes) || 0; let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function fmtDate(ms) {
    if (!ms) return '—';
    try { return new Date(ms).toLocaleDateString('ar', { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return new Date(ms).toISOString().slice(0, 10); }
  }

  function debounce(fn, wait = 200) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  }

  function throttle(fn, wait = 100) {
    let last = 0; let timer = null;
    return (...args) => {
      const now = Date.now();
      const gap = now - last;
      if (gap >= wait) { last = now; fn(...args); }
      else if (!timer) {
        timer = setTimeout(() => { timer = null; last = Date.now(); fn(...args); }, wait - gap);
      }
    };
  }

  /** نص عربي/لاتيني مبسّط للبحث (إزالة التشكيل وتوحيد الألف والهمزات). */
  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[ً-ْٰـ]/g, '')
      .replace(/[آأإٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ————— إشعارات
  function toast(msg, kind = 'info', ms = 3600) {
    const root = $('#toasts');
    if (!root) return;
    const node = el('div', { class: `toast ${kind}` }, el('span', { text: msg }));
    root.append(node);
    requestAnimationFrame(() => node.classList.add('in'));
    setTimeout(() => {
      node.classList.remove('in');
      setTimeout(() => node.remove(), 300);
    }, ms);
  }

  // ————— نوافذ منبثقة
  function modal({ title, body, actions = [], wide = false, onClose }) {
    const root = $('#modalRoot');
    root.hidden = false;
    root.innerHTML = '';
    const close = () => {
      root.hidden = true;
      root.innerHTML = '';
      document.removeEventListener('keydown', onKey);
      if (onClose) onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey);

    const foot = el('div', { class: 'modal-foot' });
    for (const a of actions) {
      foot.append(el('button', {
        class: `btn ${a.kind || ''}`,
        onclick: async () => {
          const keep = await a.onClick?.(close);
          if (!keep && !a.keepOpen) close();
        },
      }, a.label));
    }

    const card = el('div', { class: `modal-card${wide ? ' wide' : ''}` },
      el('div', { class: 'modal-head' },
        el('h3', { text: title }),
        el('button', { class: 'icon-btn', onclick: close, title: 'إغلاق', html: '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.4"/></svg>' })),
      el('div', { class: 'modal-body' }, body),
      actions.length ? foot : null);

    root.append(el('div', { class: 'modal-backdrop', onclick: close }), card);
    const focusable = card.querySelector('.modal-body input, .modal-body textarea');
    if (focusable) setTimeout(() => focusable.focus(), 40);
    return { close, card };
  }

  function confirmDialog(title, message) {
    return new Promise((resolve) => {
      modal({
        title,
        body: el('p', { class: 'muted', text: message }),
        actions: [
          { label: 'إلغاء', onClick: () => resolve(false) },
          { label: 'تأكيد', kind: 'primary', onClick: () => resolve(true) },
        ],
        onClose: () => resolve(false),
      });
    });
  }

  function promptDialog(title, { label = '', value = '', placeholder = '', multiline = false } = {}) {
    return new Promise((resolve) => {
      const input = multiline
        ? el('textarea', { rows: 4, placeholder })
        : el('input', { type: 'text', placeholder });
      input.value = value;
      const body = el('div', { class: 'form' }, label ? el('label', { text: label }) : null, input);
      const { close } = modal({
        title,
        body,
        actions: [
          { label: 'إلغاء', onClick: () => resolve(null) },
          { label: 'حسنًا', kind: 'primary', onClick: () => resolve(input.value.trim() || null) },
        ],
        onClose: () => resolve(null),
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !multiline) { resolve(input.value.trim() || null); close(); }
      });
    });
  }

  // ————— قائمة سياق
  function contextMenu(x, y, items) {
    const root = $('#ctxRoot');
    root.hidden = false;
    root.innerHTML = '';
    const menu = el('div', { class: 'ctx' });
    for (const it of items) {
      if (it === '-') { menu.append(el('div', { class: 'ctx-sep' })); continue; }
      menu.append(el('button', {
        class: `ctx-item${it.danger ? ' danger' : ''}`,
        onclick: () => { hide(); it.onClick?.(); },
      }, it.icon ? el('span', { class: 'ctx-ico', html: it.icon }) : null, el('span', { text: it.label })));
    }
    root.append(menu);
    const rect = menu.getBoundingClientRect();
    const left = Math.min(Math.max(6, x - (document.dir === 'rtl' ? rect.width : 0)), window.innerWidth - rect.width - 6);
    const top = Math.min(y, window.innerHeight - rect.height - 6);
    menu.style.left = `${Math.max(6, left)}px`;
    menu.style.top = `${Math.max(6, top)}px`;

    const hide = () => {
      root.hidden = true; root.innerHTML = '';
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
    const onDown = (e) => { if (!menu.contains(e.target)) hide(); };
    const onKey = (e) => { if (e.key === 'Escape') hide(); };
    setTimeout(() => {
      document.addEventListener('mousedown', onDown, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
  }

  /**
   * قائمة افتراضية خفيفة: ترسم الصفوف المرئية فقط (تدعم عشرات الآلاف من الأغاني).
   */
  class VirtualList {
    constructor({ container, rowHeight, render, overscan = 8 }) {
      this.container = container;
      this.rowHeight = rowHeight;
      this.render = render;
      this.overscan = overscan;
      this.items = [];
      this.spacer = el('div', { class: 'vl-spacer' });
      this.canvas = el('div', { class: 'vl-canvas' });
      container.classList.add('vl-root');
      container.innerHTML = '';
      container.append(this.spacer, this.canvas);
      this.onScroll = throttle(() => this.draw(), 16);
      this.scroller = container.closest('.vl-scroll') || container.parentElement;
      this.scroller.addEventListener('scroll', this.onScroll, { passive: true });
      this._resize = throttle(() => this.draw(), 80);
      window.addEventListener('resize', this._resize);
    }

    setItems(items) {
      this.items = items || [];
      this.spacer.style.height = `${this.items.length * this.rowHeight}px`;
      this.scroller.scrollTop = 0;
      this.draw();
    }

    refresh() { this.draw(); }

    draw() {
      const top = this.scroller.scrollTop;
      const height = this.scroller.clientHeight || 600;
      const start = Math.max(0, Math.floor(top / this.rowHeight) - this.overscan);
      const end = Math.min(this.items.length, Math.ceil((top + height) / this.rowHeight) + this.overscan);
      const frag = document.createDocumentFragment();
      for (let i = start; i < end; i++) {
        const node = this.render(this.items[i], i);
        if (!node) continue;
        node.style.transform = `translateY(${i * this.rowHeight}px)`;
        node.style.height = `${this.rowHeight}px`;
        frag.append(node);
      }
      this.canvas.innerHTML = '';
      this.canvas.append(frag);
    }

    destroy() {
      this.scroller.removeEventListener('scroll', this.onScroll);
      window.removeEventListener('resize', this._resize);
    }
  }

  /** يستخرج لونًا مهيمنًا من صورة الغلاف لتلوين الواجهة ديناميكيًا. */
  function dominantColor(imgUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const size = 24;
          const cv = document.createElement('canvas');
          cv.width = size; cv.height = size;
          const ctx = cv.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, size, size);
          const { data } = ctx.getImageData(0, 0, size, size);
          let best = null;
          const buckets = new Map();
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
            const max = Math.max(r, g, b); const min = Math.min(r, g, b);
            const lum = (max + min) / 2;
            if (lum < 26 || lum > 236) continue;
            const sat = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255) || 1);
            const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
            const cur = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0, w: 0 };
            cur.r += r; cur.g += g; cur.b += b; cur.n++; cur.w += 1 + sat * 3;
            buckets.set(key, cur);
          }
          for (const v of buckets.values()) if (!best || v.w > best.w) best = v;
          if (!best) return resolve(null);
          resolve([Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)]);
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = imgUrl;
    });
  }

  const artUrl = (name) => (name ? `liwa://art/${encodeURIComponent(name)}` : null);

  Object.assign(LM, {
    $, $$, el, esc, fmtTime, fmtLong, fmtSize, fmtDate, debounce, throttle, norm,
    toast, modal, confirmDialog, promptDialog, contextMenu, VirtualList, dominantColor, artUrl,
  });
}(window.LM));
