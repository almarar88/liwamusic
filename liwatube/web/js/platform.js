/* LiwaTube Web — الهاتف والتلفاز: شريط سفلي للهاتف، وتنقّل مكاني بالريموت/الأسهم للتلفاز، ومفاتيح الوسائط. */
'use strict';
(function (LT) {
  const { $, h } = LT;
  const UA = navigator.userAgent || '';
  LT.isTV = /\b(TV|AFT[A-Z]|BRAVIA|SHIELD|MiBOX|MIBOX|Chromecast|Roku|CrKey|GoogleTV|Android TV)\b/i.test(UA) || (/Android/i.test(UA) && !('ontouchstart' in window));
  const tvOn = () => document.body.classList.contains('tv');

  // ---------- الشريط السفلي (هاتف)
  function renderBottomNav() {
    const nav = $('#bottomNav'); if (!nav || LT.mode !== 'web') return;
    const r = LT.state.route || { view: 'home' };
    const items = [['home', 'home', LT.t('home')], ['shorts', 'shorts', LT.t('shorts')], ['subs', 'subs', LT.t('subs')], ['history', 'history', LT.t('library')]];
    const admin = LT.state.auth && LT.state.auth.admin;
    items.push(admin ? ['studio', 'folder', LT.t('studio')] : ['settings', 'settings', LT.t('settings')]);
    nav.innerHTML = '';
    nav.append(...items.map(([v, ic, l]) => h('button', { class: r.view === v ? 'on' : '', onclick: () => LT.router.go(`#/${v}`) }, LT.icon(ic), h('span', l))));
    nav.hidden = false;
  }
  window.addEventListener('hashchange', () => setTimeout(renderBottomNav, 50));
  document.addEventListener('DOMContentLoaded', () => setTimeout(renderBottomNav, 800));
  const origRenderSidebar = null; // يُستدعى من app عبر LT.renderSidebar إن وُجد
  LT.onSidebar = renderBottomNav;

  // ---------- التنقّل المكاني (تلفاز / لوحة مفاتيح)
  const FOCUSABLE = '.card, .chip, .nav-item, button:not([disabled]), a[href], input, select, textarea, [tabindex="0"], .player';
  function candidates() {
    return [...document.querySelectorAll(FOCUSABLE)].filter((el) => {
      if (el.closest('[hidden]') || el.hidden) return false;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      const modalOpen = !$('#modal').hidden; if (modalOpen && !el.closest('#modal')) return false;
      const ctxOpen = !$('#ctx').hidden; if (ctxOpen && !el.closest('#ctx')) return false;
      return true;
    });
  }
  function move(dir) {
    const cur = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    const list = candidates().filter((el) => el !== cur && !(cur && cur.contains(el)) && !(cur && el.contains(cur)));
    if (!cur) { const first = list.find((el) => el.classList.contains('card')) || list[0]; if (first) focus(first); return true; }
    const a = cur.getBoundingClientRect(); const ax = a.left + a.width / 2; const ay = a.top + a.height / 2;
    let best = null; let bestScore = Infinity;
    for (const el of list) {
      const b = el.getBoundingClientRect(); const bx = b.left + b.width / 2; const by = b.top + b.height / 2;
      const dx = bx - ax; const dy = by - ay;
      let primary; let secondary;
      if (dir === 'ArrowDown') { primary = dy; secondary = dx; if (b.top < a.bottom - 4) continue; }
      else if (dir === 'ArrowUp') { primary = -dy; secondary = dx; if (b.bottom > a.top + 4) continue; }
      else if (dir === 'ArrowRight') { primary = dx; secondary = dy; if (b.left < a.right - 4) continue; }
      else { primary = -dx; secondary = dy; if (b.right > a.left + 4) continue; }
      if (primary <= 0) continue;
      const score = primary + Math.abs(secondary) * 2.2;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) { focus(best); return true; }
    return false;
  }
  function focus(el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }); }
  const inField = (el) => ['input', 'textarea', 'select'].includes((el.tagName || '').toLowerCase()) || el.isContentEditable;

  window.addEventListener('keydown', (e) => {
    const k = e.key;
    const act = document.activeElement || document.body;
    // مفاتيح الوسائط والرجوع تعمل دائمًا
    if (k === 'MediaPlayPause' || k === 'MediaPlay' || k === 'MediaPause') { LT.player.toggle(); e.preventDefault(); return; }
    if (k === 'MediaFastForward' || k === 'MediaTrackNext') { LT.player.seekBy(10); e.preventDefault(); return; }
    if (k === 'MediaRewind' || k === 'MediaTrackPrevious') { LT.player.seekBy(-10); e.preventDefault(); return; }
    if ((k === 'GoBack' || k === 'BrowserBack' || (k === 'Backspace' && !inField(act)) || (k === 'Escape' && tvOn())) && $('#modal').hidden && $('#ctx').hidden) {
      if (document.fullscreenElement) return; // يترك المشغّل يعالجه
      if (LT.player.isTheater && LT.player.isTheater()) return;
      if (location.hash && location.hash !== '#/home') { e.preventDefault(); history.back(); }
      return;
    }
    if (!tvOn() && !document.body.classList.contains('web')) return;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(k)) return;
    if (inField(act) && k !== 'ArrowUp' && k !== 'ArrowDown') return;
    if (inField(act) && act.tagName.toLowerCase() === 'select') return;
    const inPlayer = act.classList && act.classList.contains('player');
    if (k === 'Enter') {
      if (inPlayer) { LT.player.toggle(); e.preventDefault(); }
      else if (act.classList && (act.classList.contains('card') || act.classList.contains('switch') || act.classList.contains('ch') || act.classList.contains('tag') || act.classList.contains('ch-card'))) { act.click(); e.preventDefault(); }
      return;
    }
    // داخل المشغّل: يمين/يسار تقديم وتأخير (يعالجها المشغّل)، أعلى/أسفل تخرج منه
    if (inPlayer && (k === 'ArrowLeft' || k === 'ArrowRight')) return;
    if (!tvOn() && !inPlayer && !act.classList.contains('card') && !act.classList.contains('chip') && !act.classList.contains('nav-item')) return; // على سطح المكتب نتدخل فقط بين البطاقات
    if (move(k)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  // في وضع التلفاز: ركّز أول بطاقة بعد كل تنقّل، وركّز المشغّل في صفحة المشاهدة
  window.addEventListener('hashchange', () => { if (!tvOn()) return; setTimeout(() => { const p = $('.watch .player'); if (p) p.focus(); else { const c = $('#view .card') || $('#view .chip'); if (c) c.focus({ preventScroll: true }); } }, 700); });
  // اللمس: إلغاء المعاينة عند التمرير
  if ('ontouchstart' in window) document.body.classList.add('touch');
})(window.LT = window.LT || {});
