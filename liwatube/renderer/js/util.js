/* LiwaTube — أدوات مساعدة، ترجمة، تنبيهات، نوافذ، قوائم سياق. تم إنشاؤه عن طريق LiwaMusic. */
'use strict';
window.LT = window.LT || {};
(function (LT) {
  const DICT = {
    ar: {
      play: 'تشغيل', pause: 'إيقاف مؤقت', home: 'الرئيسية', shorts: 'Shorts', subs: 'الاشتراكات', channels: 'القنوات', library: 'المكتبة',
      history: 'السجل', later: 'شاهد لاحقًا', liked: 'الفيديوهات المعجب بها', playlists: 'قوائم التشغيل',
      all: 'كل الفيديوهات', ai: 'الذكاء الاصطناعي', settings: 'الإعدادات', search: 'ابحث',
      views: 'مشاهدة', view1: 'مشاهدة واحدة', noViews: 'لم يُشاهد', ago: 'قبل', justNow: 'الآن',
      subscribe: 'اشتراك', subscribed: 'مشترك', like: 'أعجبني', dislike: 'لم يعجبني', save: 'حفظ', share: 'المجلد',
      later_add: 'حفظ في «شاهد لاحقًا»', later_rm: 'إزالة من «شاهد لاحقًا»', addToPl: 'إضافة إلى قائمة', hide: 'إخفاء من التوصيات',
      notInterested: 'لا يهمّني هذه القناة', markWatched: 'تعليم كمُشاهَد', unwatched: 'تعليم كغير مُشاهَد', reveal: 'إظهار في المجلد',
      analyze: 'تحليل بالذكاء الاصطناعي', reanalyze: 'إعادة التحليل', edit: 'تعديل البيانات', removeHist: 'إزالة من السجل',
      empty: 'مكتبتك فارغة', emptyHint: 'أضف مجلد فيديوهاتك ليبدأ العرض — كل شيء يبقى على جهازك.', addFolder: 'إضافة مجلد',
      noResults: 'لا توجد نتائج', upNext: 'التالي', autoplay: 'تشغيل تلقائي', description: 'الوصف', showMore: '…المزيد', showLess: 'إظهار أقل',
      chapters: 'الفصول', askVideo: 'اسأل عن هذا الفيديو', askPh: 'ماذا يحدث في الدقيقة 3؟ لخّص الفيديو…', comments: 'ملاحظاتك',
      commentPh: 'أضف ملاحظة خاصة…', forYou: 'لك', continueW: 'تابع المشاهدة', recent: 'أُضيف حديثًا', fromSubs: 'من اشتراكاتك',
      shortsEmpty: 'لا توجد مقاطع قصيرة', shortsHint: 'أي فيديو أقصر من الحد المضبوط في الإعدادات يظهر هنا.',
      videos: 'فيديو', hours: 'ساعة', clearHistory: 'مسح السجل', today: 'اليوم', yesterday: 'أمس',
      newPlaylist: 'قائمة جديدة', smartPl: 'قائمة ذكية', plName: 'اسم القائمة', plDesc: 'الوصف', create: 'إنشاء', cancel: 'إلغاء', delete: 'حذف',
      aiOff: 'الذكاء الاصطناعي مغلق. فعّله من الإعدادات وأضف مفتاح Anthropic API.', aiWorking: 'يعمل…',
      analyzed: 'تم التحليل', aiSearch: 'بحث ذكي', interpretation: 'كيف فهمت الطلب',
      unplayable: 'قد لا يعمل هذا الملف في المشغّل المدمج (صيغة غير مدعومة). حوّله إلى MP4 (H.264) للتشغيل.',
      sortNew: 'الأحدث', sortOld: 'الأقدم', sortPop: 'الأكثر مشاهدة', sortLong: 'الأطول', sortName: 'الاسم',
      minutes: 'دقيقة', lockTitle: 'أدخل رمز PIN لفتح مكتبتك الخاصة', wrongPin: 'رمز غير صحيح', unlock: 'فتح',
      duration: 'المدة', any: 'الكل', short: 'قصير (< 4 د)', medium: 'متوسط (4–20 د)', long: 'طويل (> 20 د)',
      watched: 'مُشاهَد', unwatchedF: 'غير مُشاهَد', insights: 'تقرير رؤى', generate: 'توليد',
      keepGoing: 'أكمل من', rate: 'السرعة', normal: 'عادية', quality: 'الجودة', captions: 'الترجمة', off: 'إيقاف',
      resumeToast: 'استؤنف من', copied: 'تم النسخ', saved: 'تم الحفظ', removed: 'تمت الإزالة', added: 'تمت الإضافة',
      folderAdded: 'تمت إضافة المجلد وبدأت الفهرسة', scanning: 'جارٍ الفهرسة', probing: 'توليد الصور المصغّرة',
      why_channel: 'من قناة تتابعها', why_tags: 'يشبه ما تشاهده', why_resume: 'لم تكمله', why_new: 'لم تشاهده بعد', why_recent: 'جديد في مكتبتك', why_title: 'عنوان مشابه',
    },
    en: {
      play: 'Play', pause: 'Pause', home: 'Home', shorts: 'Shorts', subs: 'Subscriptions', channels: 'Channels', library: 'Library',
      history: 'History', later: 'Watch later', liked: 'Liked videos', playlists: 'Playlists',
      all: 'All videos', ai: 'AI', settings: 'Settings', search: 'Search',
      views: 'views', view1: '1 view', noViews: 'No views', ago: 'ago', justNow: 'just now',
      subscribe: 'Subscribe', subscribed: 'Subscribed', like: 'Like', dislike: 'Dislike', save: 'Save', share: 'Folder',
      later_add: 'Save to Watch later', later_rm: 'Remove from Watch later', addToPl: 'Add to playlist', hide: 'Hide from recommendations',
      notInterested: 'Not interested in this channel', markWatched: 'Mark as watched', unwatched: 'Mark as unwatched', reveal: 'Show in folder',
      analyze: 'Analyze with AI', reanalyze: 'Re-analyze', edit: 'Edit details', removeHist: 'Remove from history',
      empty: 'Your library is empty', emptyHint: 'Add a video folder to get started — everything stays on your machine.', addFolder: 'Add folder',
      noResults: 'No results', upNext: 'Up next', autoplay: 'Autoplay', description: 'Description', showMore: '…more', showLess: 'Show less',
      chapters: 'Chapters', askVideo: 'Ask about this video', askPh: 'What happens at minute 3? Summarize…', comments: 'Your notes',
      commentPh: 'Add a private note…', forYou: 'For you', continueW: 'Continue watching', recent: 'Recently added', fromSubs: 'From your subscriptions',
      shortsEmpty: 'No shorts yet', shortsHint: 'Any video shorter than the limit in Settings shows up here.',
      videos: 'videos', hours: 'hours', clearHistory: 'Clear history', today: 'Today', yesterday: 'Yesterday',
      newPlaylist: 'New playlist', smartPl: 'Smart playlist', plName: 'Playlist name', plDesc: 'Description', create: 'Create', cancel: 'Cancel', delete: 'Delete',
      aiOff: 'AI is off. Enable it in Settings and add your Anthropic API key.', aiWorking: 'Working…',
      analyzed: 'Analyzed', aiSearch: 'Smart search', interpretation: 'Interpretation',
      unplayable: 'This file may not play in the built-in player (unsupported format). Convert it to MP4 (H.264).',
      sortNew: 'Newest', sortOld: 'Oldest', sortPop: 'Most viewed', sortLong: 'Longest', sortName: 'Name',
      minutes: 'min', lockTitle: 'Enter your PIN to unlock your private library', wrongPin: 'Wrong PIN', unlock: 'Unlock',
      duration: 'Duration', any: 'Any', short: 'Short (< 4 min)', medium: 'Medium (4–20 min)', long: 'Long (> 20 min)',
      watched: 'Watched', unwatchedF: 'Unwatched', insights: 'Insights report', generate: 'Generate',
      keepGoing: 'Resume from', rate: 'Speed', normal: 'Normal', quality: 'Quality', captions: 'Captions', off: 'Off',
      resumeToast: 'Resumed from', copied: 'Copied', saved: 'Saved', removed: 'Removed', added: 'Added',
      folderAdded: 'Folder added, indexing started', scanning: 'Indexing', probing: 'Generating thumbnails',
      why_channel: 'From a channel you follow', why_tags: 'Similar to what you watch', why_resume: 'Unfinished', why_new: 'Not watched yet', why_recent: 'New in your library', why_title: 'Similar title',
    },
  };
  LT.lang = 'ar';
  const t = (k) => (DICT[LT.lang] && DICT[LT.lang][k]) || DICT.ar[k] || k;
  LT.t = t;
  LT.setLang = (l) => {
    LT.lang = DICT[l] ? l : 'ar';
    document.documentElement.lang = LT.lang;
    document.documentElement.dir = LT.lang === 'ar' ? 'rtl' : 'ltr';
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** منشئ عناصر مختصر: h('div.card', {onclick}, child, 'text') */
  function h(tag, attrs, ...children) {
    const [name, ...classes] = tag.split('.');
    const el = document.createElement(name || 'div');
    if (classes.length) el.className = classes.join(' ');
    if (attrs && typeof attrs === 'object' && !(attrs instanceof Node) && !Array.isArray(attrs)) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
        else if (k in el && k !== 'list' && k !== 'form') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
        else el.setAttribute(k, v === true ? '' : v);
      }
    } else if (attrs != null) children.unshift(attrs);
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const svg = (d, size = 22) => h('svg', { viewBox: '0 0 24 24', width: size, height: size, html: `<path d="${d}"/>` });
  // ملاحظة: h() ينشئ عناصر HTML لا SVG؛ نستخدم innerHTML للأيقونات
  const icon = (d, size = 22) => { const s = document.createElement('span'); s.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor"><path d="${d}"/></svg>`; return s.firstChild; };
  LT.icons = {
    home: 'M4 10v11h6v-6h4v6h6V10l-8-7z', shorts: 'M10 14.65v-5.3L15 12l-5 2.65zm7.77-4.33-1.2-.5L18 9.06c1.84-.96 2.53-3.23 1.56-5.06s-3.24-2.53-5.07-1.56L6 6.94c-1.29.68-2.07 2.04-2 3.49.07 1.42.93 2.67 2.22 3.25.03.01 1.2.5 1.2.5L6 14.93c-1.83.97-2.53 3.24-1.56 5.07.97 1.83 3.24 2.53 5.07 1.56l8.5-4.5c1.29-.68 2.06-2.04 1.99-3.49-.07-1.42-.94-2.68-2.23-3.25zM6.71 15.8l-1.05.55C4.75 16.85 3.63 16.5 3.14 15.6c-.48-.91-.13-2.04.78-2.52l4.17-2.2c-.05.07-.11.13-.16.2-.29.4-.51.85-.65 1.35-.14.5-.19 1.02-.14 1.55.05.53.2 1.05.44 1.53.11.22.23.42.38.61l-.31.16-.94.5zm11.15.2-8.5 4.5c-.91.48-2.04.13-2.52-.78-.48-.91-.13-2.04.78-2.52l8.5-4.5c.91-.48 2.04-.13 2.52.78.48.91.13 2.04-.78 2.52z',
    subs: 'M20 8H4V6h16v2zm-2-6H6v2h12V2zm4 10v8c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2v-8c0-1.1.9-2 2-2h16c1.1 0 2 .9 2 2zm-6 4-6-3.27v6.53L16 16z',
    history: 'M13 3a9 9 0 00-9 9H1l3.9 3.9L8.8 12H6a7 7 0 117 7 7 7 0 01-4.95-2.05l-1.42 1.42A9 9 0 1013 3zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8z',
    later: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 18a8 8 0 110-16 8 8 0 010 16zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
    liked: 'M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z',
    playlists: 'M22 7H2v1h20V7zm-9 5H2v-1h11v1zm0 4H2v-1h11v1zm2-3v8l7-4-7-4z',
    all: 'M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z',
    ai: 'M12 2l1.9 5.1L19 9l-5.1 1.9L12 16l-1.9-5.1L5 9l5.1-1.9L12 2zm6 12l.9 2.4L21 17l-2.1.6L18 20l-.9-2.4L15 17l2.1-.6L18 14z',
    settings: 'M19.4 13a7.6 7.6 0 000-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 00-1.7-1L15 3H9l-.4 2.9a7.4 7.4 0 00-1.7 1l-2.5-1-2 3.5L4.6 11a7.6 7.6 0 000 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 001.7 1L9 21h6l.4-2.9a7.4 7.4 0 001.7-1l2.5 1 2-3.5L19.4 13zM12 15.5A3.5 3.5 0 1112 8.5a3.5 3.5 0 010 7z',
    channels: 'M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-3.33 0-10 1.67-10 5v3h20v-3c0-3.33-6.67-5-10-5z',
    more: 'M12 16.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0-6a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0-6a1.5 1.5 0 110 3 1.5 1.5 0 010-3z',
    play: 'M8 5v14l11-7z', pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
    like: 'M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z',
    dislike: 'M23 3h-4v12h4V3zM1 14c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2z',
    save: 'M14 10H3v2h11v-2zm0-4H3v2h11V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM3 16h7v-2H3v2z',
    folder: 'M10 4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2h6z',
    edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
    hide: 'M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92A11.8 11.8 0 0023 12c-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 001 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55A2.8 2.8 0 009 12a3 3 0 003 3c.22 0 .44-.03.65-.08l1.55 1.55A4.97 4.97 0 017 12c0-.79.2-1.53.53-2.2z',
    check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z', trash: 'M6 19a2 2 0 002 2h8a2 2 0 002-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
    close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    expand: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
    plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z', film: 'M4 4h16v16H4zM2 6h2M2 10h2M2 14h2M2 18h2M20 6h2M20 10h2M20 14h2M20 18h2',
    send: 'M2 21l21-9L2 3v7l15 2-15 2z', insights: 'M5 9h3v11H5zm5.5-5h3v16h-3zM16 13h3v7h-3z',
  };
  LT.icon = (name, size) => icon(LT.icons[name] || name, size);

  const fmtTime = (s) => {
    s = Math.max(0, Math.floor(Number(s) || 0));
    const hh = Math.floor(s / 3600); const mm = Math.floor((s % 3600) / 60); const ss = s % 60;
    return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
  };
  const fmtHours = (s) => `${Math.round((s || 0) / 360) / 10}`;
  function timeAgo(ms) {
    if (!ms) return '';
    const d = Math.max(0, Date.now() - ms);
    const ar = LT.lang === 'ar';
    const units = [
      [31536000000, ['سنة', 'سنتين', 'سنوات'], 'year'], [2592000000, ['شهر', 'شهرين', 'أشهر'], 'month'], [604800000, ['أسبوع', 'أسبوعين', 'أسابيع'], 'week'],
      [86400000, ['يوم', 'يومين', 'أيام'], 'day'], [3600000, ['ساعة', 'ساعتين', 'ساعات'], 'hour'], [60000, ['دقيقة', 'دقيقتين', 'دقائق'], 'minute'],
    ];
    for (const [len, f, e] of units) {
      if (d >= len) {
        const n = Math.floor(d / len);
        if (ar) return `قبل ${n === 1 ? f[0] : n === 2 ? f[1] : n <= 10 ? `${n} ${f[2]}` : `${n} ${f[0]}`}`;
        return `${n} ${e}${n > 1 ? 's' : ''} ago`;
      }
    }
    return t('justNow');
  }
  function fmtViews(n) {
    n = n || 0;
    if (!n) return t('noViews');
    if (n === 1) return t('view1');
    const s = n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n);
    return `${s} ${t('views')}`;
  }
  const fmtBytes = (b) => { b = b || 0; if (b > 1e9) return `${(b / 1e9).toFixed(2)} GB`; if (b > 1e6) return `${(b / 1e6).toFixed(0)} MB`; return `${Math.round(b / 1e3)} KB`; };
  const debounce = (fn, ms) => { let tm; return (...a) => { clearTimeout(tm); tm = setTimeout(() => fn(...a), ms); }; };
  function colorFor(name) {
    let x = 0; for (const c of String(name || '')) x = (x * 31 + c.charCodeAt(0)) >>> 0;
    const hue = x % 360;
    return `hsl(${hue} 55% 42%)`;
  }
  const initial = (name) => { const s = String(name || '?').trim(); return s ? [...s][0] : '?'; };

  // ---------- Markdown بسيط وآمن
  function md(text) {
    const lines = esc(text).split('\n');
    let out = ''; let inList = false;
    for (const raw of lines) {
      const line = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
      const hm = /^(#{1,3})\s+(.*)/.exec(line);
      const lm = /^\s*[-*•]\s+(.*)/.exec(line) || /^\s*\d+[.)]\s+(.*)/.exec(line);
      if (lm) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${lm[1]}</li>`; continue; }
      if (inList) { out += '</ul>'; inList = false; }
      if (hm) out += `<h${hm[1].length + 1}>${hm[2]}</h${hm[1].length + 1}>`;
      else if (line.trim()) out += `<p>${line}</p>`;
    }
    if (inList) out += '</ul>';
    return out;
  }

  // ---------- تنبيهات
  function toast(msg, { action, onAction, err, ms = 3500 } = {}) {
    const box = $('#toasts');
    const el = h('div.toast', { class: err ? 'err' : '' }, h('span', msg));
    if (action) el.append(h('button.act', { onclick: () => { onAction && onAction(); el.remove(); } }, action));
    box.append(el);
    setTimeout(() => el.remove(), ms);
  }

  // ---------- نوافذ
  function modal({ title, body, actions = [], onClose }) {
    const wrap = $('#modal');
    wrap.innerHTML = '';
    const box = h('div.modal');
    if (title) box.append(h('h2', title));
    const content = h('div');
    if (typeof body === 'function') body(content); else if (body) content.append(body);
    box.append(content);
    const close = () => { wrap.hidden = true; wrap.innerHTML = ''; onClose && onClose(); };
    if (actions.length) {
      box.append(h('div.actions', actions.map((a) => h('button.btn', { class: a.cls || '', onclick: async () => { const r = await a.onClick?.(content); if (r !== false) close(); } }, a.label))));
    }
    wrap.append(box);
    wrap.hidden = false;
    wrap.onclick = (e) => { if (e.target === wrap) close(); };
    return { close, content };
  }
  const closeModal = () => { const w = $('#modal'); w.hidden = true; w.innerHTML = ''; };

  // ---------- قائمة سياق
  function ctxMenu(x, y, items) {
    const m = $('#ctx');
    m.innerHTML = '';
    for (const it of items) {
      if (!it) continue;
      if (it === '-') { m.append(h('div.sep')); continue; }
      m.append(h('button', { onclick: () => { hideCtx(); it.onClick && it.onClick(); } }, it.icon ? LT.icon(it.icon, 20) : null, it.label));
    }
    m.hidden = false;
    const r = m.getBoundingClientRect();
    const px = Math.min(x, window.innerWidth - r.width - 8);
    const py = Math.min(y, window.innerHeight - r.height - 8);
    m.style.left = `${Math.max(4, px)}px`; m.style.top = `${Math.max(4, py)}px`;
  }
  const hideCtx = () => { $('#ctx').hidden = true; };
  document.addEventListener('click', (e) => { if (!e.target.closest('#ctx')) hideCtx(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { hideCtx(); if (!$('#modal').hidden) closeModal(); } });
  window.addEventListener('blur', hideCtx);

  Object.assign(LT, { $, $$, h, esc, svg, fmtTime, fmtHours, timeAgo, fmtViews, fmtBytes, debounce, colorFor, initial, md, toast, modal, closeModal, ctxMenu, hideCtx });
})(window.LT);
