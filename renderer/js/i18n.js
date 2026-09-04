/* LiwaMusic — الترجمة (عربي/إنجليزي) مع دعم RTL/LTR. */
'use strict';
(function (LM) {
  const DICT = {
    ar: {
      home: 'الرئيسية', tracks: 'كل الأغاني', albums: 'الألبومات', artists: 'الفنانون',
      genres: 'الأنواع', playlists: 'قوائم التشغيل', favorites: 'المفضلة', history: 'السجل',
      ai: 'الذكاء الاصطناعي', settings: 'الإعدادات', stats: 'الإحصاءات',
      search: 'ابحث في المكتبة…', aiSearch: 'بحث ذكي بلغة طبيعية',
      sidePlaylists: 'قوائم التشغيل', sideFolders: 'المجلدات', smartPlaylist: 'قائمة ذكية',
      now: 'الآن', lyrics: 'الكلمات', queue: 'الطابور', info: 'معلومات',
      nothingPlaying: 'لا يوجد تشغيل', addFolderHint: 'أضف مجلد أغانيك للبدء',
      madeBy: 'تم إنشاؤه عن طريق', play: 'تشغيل', pause: 'إيقاف مؤقت',
      title: 'العنوان', artist: 'الفنان', album: 'الألبوم', genre: 'النوع', year: 'السنة',
      duration: 'المدة', plays: 'مرات التشغيل', rating: 'التقييم', added: 'أُضيفت',
      noResults: 'لا توجد نتائج', tracksCount: 'أغنية', addFolder: 'إضافة مجلد',
      rescan: 'إعادة الفهرسة', empty: 'المكتبة فارغة',
    },
    en: {
      home: 'Home', tracks: 'All tracks', albums: 'Albums', artists: 'Artists',
      genres: 'Genres', playlists: 'Playlists', favorites: 'Favorites', history: 'History',
      ai: 'AI', settings: 'Settings', stats: 'Statistics',
      search: 'Search your library…', aiSearch: 'Natural-language smart search',
      sidePlaylists: 'Playlists', sideFolders: 'Folders', smartPlaylist: 'Smart playlist',
      now: 'Now', lyrics: 'Lyrics', queue: 'Queue', info: 'Info',
      nothingPlaying: 'Nothing playing', addFolderHint: 'Add your music folder to start',
      madeBy: 'Created by', play: 'Play', pause: 'Pause',
      title: 'Title', artist: 'Artist', album: 'Album', genre: 'Genre', year: 'Year',
      duration: 'Duration', plays: 'Plays', rating: 'Rating', added: 'Added',
      noResults: 'No results', tracksCount: 'tracks', addFolder: 'Add folder',
      rescan: 'Rescan', empty: 'Your library is empty',
    },
  };

  let lang = 'ar';

  const t = (key) => (DICT[lang] && DICT[lang][key]) || (DICT.ar[key] || key);

  function setLang(next) {
    lang = DICT[next] ? next : 'ar';
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    applyStatic();
    return lang;
  }

  function applyStatic() {
    const set = (sel, prop, key) => {
      const node = document.querySelector(sel);
      if (!node) return;
      if (prop === 'text') node.textContent = t(key);
      else node.setAttribute(prop, t(key));
    };
    set('#search', 'placeholder', 'search');
    set('#aiSearchBtn', 'title', 'aiSearch');
    set('#btnAiPlaylist span', 'text', 'smartPlaylist');
    const heads = document.querySelectorAll('.side-head > span');
    if (heads[0]) heads[0].textContent = t('sidePlaylists');
    if (heads[1]) heads[1].textContent = t('sideFolders');
    document.querySelectorAll('#rpTabs button').forEach((b) => {
      const key = b.dataset.rp;
      if (DICT[lang][key]) b.textContent = t(key);
    });
    const made = document.querySelector('.made-by');
    if (made) made.innerHTML = `${t('madeBy')} <b>LiwaMusic</b>`;
  }

  LM.i18n = { t, setLang, applyStatic, get lang() { return lang; } };
  LM.t = t;
}(window.LM));
