/* LiwaMusic — عروض المكتبة: الأغاني، الألبومات، الفنانون، الأنواع، القوائم، السجل، الإحصاءات. */
'use strict';
(function (LM) {
  const { el, fmtTime, fmtLong, fmtDate, artUrl, VirtualList } = LM;

  const SORTS = [
    { key: 'title', label: 'العنوان' },
    { key: 'artist', label: 'الفنان' },
    { key: 'album', label: 'الألبوم' },
    { key: 'year', label: 'السنة' },
    { key: 'duration', label: 'المدة' },
    { key: 'addedAt', label: 'تاريخ الإضافة' },
    { key: 'playCount', label: 'مرات التشغيل' },
    { key: 'rating', label: 'التقييم' },
    { key: 'lastPlayed', label: 'آخر تشغيل' },
  ];

  function artThumb(track, size = 'sm') {
    const url = artUrl(track && track.art);
    const box = el('div', { class: `thumb ${size}` });
    if (url) box.append(el('img', { src: url, alt: '', loading: 'lazy' }));
    else box.append(el('span', { class: 'thumb-ph', text: '♪' }));
    return box;
  }

  function starsWidget(id, value, onRate) {
    const wrap = el('div', { class: 'stars sm', title: 'التقييم' });
    for (let i = 1; i <= 5; i++) {
      wrap.append(el('button', {
        class: `star${i <= value ? ' on' : ''}`,
        onclick: (e) => { e.stopPropagation(); onRate(i === value ? 0 : i); },
        title: `${i}/5`,
      }, '★'));
    }
    return wrap;
  }

  /** رأس صفحة موحّد */
  function pageHead(title, subtitle, actions = []) {
    return el('div', { class: 'page-head' },
      el('div', {},
        el('h1', { text: title }),
        subtitle ? el('p', { class: 'muted', text: subtitle }) : null),
      el('div', { class: 'page-actions' }, actions));
  }

  function btn(label, opts = {}) {
    return el('button', { class: `btn ${opts.kind || ''}`, onclick: opts.onClick, title: opts.title || '' },
      opts.icon ? el('span', { class: 'b-ico', html: opts.icon }) : null, label);
  }

  const ICONS = {
    play: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M7 4l13 8-13 8z" fill="currentColor"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7M16 21h5v-5M21 21l-7-7M3 3h5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    ai: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 2l1.9 5.1L19 9l-5.1 1.9L12 16l-1.9-5.1L5 9l5.1-1.9L12 2z" fill="currentColor"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2"/></svg>',
    radio: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 8a4 4 0 100 8 4 4 0 000-8zM5 5a10 10 0 000 14M19 5a10 10 0 010 14" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
    cloud: '<svg viewBox="0 0 24 24" width="11" height="11"><path d="M7 18a4 4 0 010-8 5 5 0 019.6-1.5A3.5 3.5 0 0117.5 18z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    image: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 5h16v14H4zM4 16l4-4 3 3 4-5 5 6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  };

  // ————————————————————————————— قائمة الأغاني الافتراضية

  function trackList(app, items, { showIndex = true, source = 'list' } = {}) {
    const wrap = el('div', { class: 'tracklist' });
    const header = el('div', { class: 'tl-head' },
      showIndex ? el('span', { class: 'c-idx', text: '#' }) : null,
      el('span', { class: 'c-title', text: 'العنوان' }),
      el('span', { class: 'c-album', text: 'الألبوم' }),
      el('span', { class: 'c-genre', text: 'النوع' }),
      el('span', { class: 'c-plays', text: '▶' }),
      el('span', { class: 'c-rate', text: 'التقييم' }),
      el('span', { class: 'c-dur', text: 'المدة' }),
      el('span', { class: 'c-menu' }));
    const body = el('div', { class: 'tl-body' });
    wrap.append(header, body);

    const ids = items.map((t) => t.id);
    const vl = new VirtualList({
      container: body,
      rowHeight: 52,
      render: (track, i) => {
        const ud = app.state.userdata;
        const isCur = app.state.currentId === track.id;
        const selected = app.state.selection.has(track.id);
        const row = el('div', {
          class: `tl-row${isCur ? ' current' : ''}${selected ? ' selected' : ''}`,
          ondblclick: () => app.playTrack(track.id, ids, { source }),
          oncontextmenu: (e) => {
            e.preventDefault();
            if (!app.state.selection.has(track.id)) app.selectTrack(track.id, {});
            app.trackMenu(e, track, ids);
          },
          onclick: (e) => app.selectTrack(track.id, e),
        });
        if (showIndex) {
          row.append(el('span', { class: 'c-idx' },
            el('span', { class: 'idx-n', text: String(i + 1) }),
            el('button', {
              class: 'idx-play', title: 'تشغيل', html: ICONS.play,
              onclick: (e) => { e.stopPropagation(); app.playTrack(track.id, ids, { source }); },
            })));
        }
        row.append(el('span', { class: 'c-title' },
          artThumb(track),
          el('span', { class: 'tt' },
            el('span', { class: 'tt-line' },
              track.source === 'drive'
                ? el('span', { class: 'src-badge', title: 'من Google Drive', html: ICONS.cloud })
                : null,
              el('span', { class: 'tt-name', text: track.title || track.file, title: track.path })),
            el('span', { class: 'tt-artist', text: track.artist || 'فنان غير معروف' }))));
        row.append(el('span', { class: 'c-album', text: track.album || '—', title: track.album || '' }));
        row.append(el('span', { class: 'c-genre' },
          track.genre ? el('span', { class: 'chip xs', text: track.genre }) : null,
          (ud.ai[track.id] && ud.ai[track.id].mood)
            ? el('span', { class: 'chip xs ai', text: ud.ai[track.id].mood }) : null));
        row.append(el('span', { class: 'c-plays', text: String(ud.playCount[track.id] || 0) }));
        row.append(el('span', { class: 'c-rate' }, starsWidget(track.id, ud.ratings[track.id] || 0, (n) => app.rate(track.id, n))));
        row.append(el('span', { class: 'c-dur' },
          el('button', {
            class: `mini-heart${ud.favorites[track.id] ? ' on' : ''}`,
            title: 'مفضلة',
            onclick: (e) => { e.stopPropagation(); app.toggleFavorite(track.id); },
            html: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 21s-7-4.5-9.3-8.4C.7 9.3 2.4 5.5 6 5.5c2 0 3.3 1.1 4 2.2.7-1.1 2-2.2 4-2.2 3.6 0 5.3 3.8 3.3 7.1C19 16.5 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
          }),
          el('span', { text: fmtTime(track.duration) })));
        row.append(el('span', { class: 'c-menu' },
          el('button', {
            class: 'icon-btn xs', title: 'خيارات', text: '⋯',
            onclick: (e) => { e.stopPropagation(); app.trackMenu(e, track, ids); },
          })));
        return row;
      },
    });
    vl.setItems(items);
    app._vl = vl;
    return wrap;
  }

  function toolbar(app, items, { onSort = true } = {}) {
    const total = items.reduce((a, t) => a + (t.duration || 0), 0);
    const sortSel = el('select', {
      class: 'select sm',
      onchange: (e) => { app.state.sort.key = e.target.value; app.render(); },
    }, SORTS.map((s) => el('option', { value: s.key, selected: app.state.sort.key === s.key }, s.label)));
    return el('div', { class: 'toolbar' },
      el('div', { class: 'tb-info' },
        el('b', { text: `${items.length}` }), ' أغنية · ', fmtLong(total)),
      el('div', { class: 'tb-actions' },
        btn('تشغيل الكل', { kind: 'primary', icon: ICONS.play, onClick: () => app.playList(items.map((t) => t.id)) }),
        btn('خلط', { icon: ICONS.shuffle, onClick: () => app.playList(items.map((t) => t.id), { shuffle: true }) }),
        btn('إضافة للطابور', { icon: ICONS.plus, onClick: () => app.enqueue(items.map((t) => t.id)) }),
        btn('جلب الأغلفة الناقصة', { icon: ICONS.image, onClick: () => app.fetchMissingArt(items.map((t) => t.id)) }),
        btn('تحديد الكل', { onClick: () => app.selectAll() }),
        onSort ? el('div', { class: 'sort-wrap' },
          el('span', { class: 'muted sm', text: 'ترتيب' }),
          sortSel,
          el('button', {
            class: 'icon-btn sm',
            title: 'اتجاه الترتيب',
            text: app.state.sort.dir > 0 ? '↑' : '↓',
            onclick: () => { app.state.sort.dir *= -1; app.render(); },
          })) : null));
  }

  // ————————————————————————————— الصفحات

  function home(app) {
    const s = app.state;
    const tracks = s.tracks;
    const ud = s.userdata;
    const wrap = el('div', { class: 'page' });

    if (!tracks.length) {
      wrap.append(el('div', { class: 'empty-hero' },
        el('div', { class: 'eh-mark', text: '♫' }),
        el('h1', { text: 'مرحبًا بك في LiwaMusic' }),
        el('p', { class: 'muted', text: 'أضف مجلد أغانيك ليبدأ الفهرسة تلقائيًا: قراءة الوسوم، استخراج الأغلفة، وجلب الكلمات والأغلفة الناقصة من الإنترنت.' }),
        el('div', { class: 'row gap' },
          btn('إضافة مجلد أغاني', { kind: 'primary', onClick: () => app.addFolder() }),
          btn('استيراد مكتبة', { onClick: () => app.importLibrary() })),
        el('p', { class: 'muted xs', text: 'أو اسحب المجلد وأفلته داخل النافذة.' })));
      return wrap;
    }

    const stats = app.libraryStats();
    const recent = [...tracks].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 12);
    const most = [...tracks].sort((a, b) => (ud.playCount[b.id] || 0) - (ud.playCount[a.id] || 0))
      .filter((t) => ud.playCount[t.id]).slice(0, 12);
    const favs = tracks.filter((t) => ud.favorites[t.id]).slice(0, 12);
    const unplayed = tracks.filter((t) => !ud.playCount[t.id]);
    const discover = app.shuffleArray(unplayed).slice(0, 12);

    wrap.append(pageHead('الرئيسية', `${stats.tracks} أغنية · ${stats.artists} فنان · ${stats.albums} ألبوم · ${fmtLong(stats.duration)}`, [
      btn('تشغيل عشوائي', { kind: 'primary', icon: ICONS.shuffle, onClick: () => app.playList(tracks.map((t) => t.id), { shuffle: true }) }),
      app.aiOn() ? btn('قائمة ذكية', { icon: ICONS.ai, onClick: () => app.askSmartPlaylist() }) : null,
    ]));

    wrap.append(el('div', { class: 'tiles' },
      tile('الأغاني', stats.tracks, 'إجمالي المسارات المفهرسة'),
      tile('الفنانون', stats.artists, 'أسماء مختلفة'),
      tile('الألبومات', stats.albums, 'ألبوم مكتمل أو جزئي'),
      tile('زمن المكتبة', fmtLong(stats.duration), `${LM.fmtSize(stats.size)} على القرص`)));

    if (recent.length) wrap.append(shelf(app, 'أُضيف حديثًا', recent));
    if (most.length) wrap.append(shelf(app, 'الأكثر تشغيلاً', most));
    if (favs.length) wrap.append(shelf(app, 'مفضلتك', favs));
    if (discover.length) wrap.append(shelf(app, 'اكتشف: لم تُشغَّل بعد', discover));
    return wrap;
  }

  function tile(label, value, hint) {
    return el('div', { class: 'tile' },
      el('div', { class: 'tile-v', text: String(value) }),
      el('div', { class: 'tile-l', text: label }),
      el('div', { class: 'tile-h muted xs', text: hint }));
  }

  function shelf(app, title, tracks) {
    const row = el('div', { class: 'shelf-row' });
    for (const t of tracks) {
      row.append(el('div', {
        class: 'card',
        ondblclick: () => app.playTrack(t.id, tracks.map((x) => x.id)),
        oncontextmenu: (e) => { e.preventDefault(); app.trackMenu(e, t, tracks.map((x) => x.id)); },
      },
      el('div', { class: 'card-art' },
        artThumb(t, 'lg'),
        el('button', {
          class: 'card-play', html: ICONS.play, title: 'تشغيل',
          onclick: (e) => { e.stopPropagation(); app.playTrack(t.id, tracks.map((x) => x.id)); },
        })),
      el('div', { class: 'card-t', text: t.title || t.file }),
      el('div', { class: 'card-s muted', text: t.artist || '—' })));
    }
    return el('section', { class: 'shelf' }, el('h2', { text: title }), row);
  }

  function tracksView(app) {
    const items = app.visibleTracks();
    const wrap = el('div', { class: 'page' });
    wrap.append(pageHead('كل الأغاني', app.state.filter.q ? `نتائج البحث عن «${app.state.filter.q}»` : 'مكتبتك المحلية بالكامل', [
      btn('إعادة الفهرسة', { onClick: () => app.rescan() }),
      btn('إضافة مجلد', { kind: 'primary', onClick: () => app.addFolder() }),
    ]));
    wrap.append(toolbar(app, items));
    if (!items.length) wrap.append(el('div', { class: 'empty', text: 'لا توجد نتائج مطابقة.' }));
    else wrap.append(trackList(app, items));
    return wrap;
  }

  function groupBy(tracks, keyFn) {
    const map = new Map();
    for (const t of tracks) {
      const key = keyFn(t) || '—';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(t);
    }
    return map;
  }

  function albumsView(app) {
    const items = app.visibleTracks();
    const groups = groupBy(items, (t) => `${t.album || 'بدون ألبوم'}||${t.albumArtist || t.artist || '—'}`);
    const wrap = el('div', { class: 'page' });
    wrap.append(pageHead('الألبومات', `${groups.size} ألبوم`, []));
    const grid = el('div', { class: 'grid' });
    for (const [key, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ar'))) {
      const [album, artist] = key.split('||');
      const cover = list.find((t) => t.art) || list[0];
      const ids = list.sort((a, b) => (a.discNo - b.discNo) || (a.trackNo - b.trackNo)).map((t) => t.id);
      grid.append(el('div', {
        class: 'card',
        ondblclick: () => app.playList(ids),
        onclick: () => app.openAlbum(album, artist),
      },
      el('div', { class: 'card-art' }, artThumb(cover, 'lg'),
        el('button', { class: 'card-play', html: ICONS.play, title: 'تشغيل الألبوم', onclick: (e) => { e.stopPropagation(); app.playList(ids); } })),
      el('div', { class: 'card-t', text: album }),
      el('div', { class: 'card-s muted', text: `${artist} · ${list.length} مقطع` })));
    }
    wrap.append(grid);
    return wrap;
  }

  function artistsView(app) {
    const items = app.visibleTracks();
    const groups = groupBy(items, (t) => t.albumArtist || t.artist || 'فنان غير معروف');
    const wrap = el('div', { class: 'page' });
    wrap.append(pageHead('الفنانون', `${groups.size} فنان`, []));
    const grid = el('div', { class: 'grid artists' });
    for (const [artist, list] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const cover = list.find((t) => t.art) || list[0];
      grid.append(el('div', {
        class: 'card round',
        onclick: () => app.openArtist(artist),
        ondblclick: () => app.playList(list.map((t) => t.id), { shuffle: true }),
      },
      el('div', { class: 'card-art' }, artThumb(cover, 'lg')),
      el('div', { class: 'card-t', text: artist }),
      el('div', { class: 'card-s muted', text: `${list.length} أغنية` })));
    }
    wrap.append(grid);
    return wrap;
  }

  function genresView(app) {
    const items = app.state.tracks;
    const ud = app.state.userdata;
    const groups = groupBy(items, (t) => t.genre || (ud.ai[t.id] && ud.ai[t.id].genres && ud.ai[t.id].genres[0]) || 'غير مصنّف');
    const wrap = el('div', { class: 'page' });
    wrap.append(pageHead('الأنواع', `${groups.size} نوع`, [
      app.aiOn() ? btn('تصنيف ذكي للمكتبة', { icon: ICONS.ai, onClick: () => app.aiTagLibrary() }) : null,
    ]));
    const chips = el('div', { class: 'chips' });
    for (const [genre, list] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
      chips.append(el('button', {
        class: 'chip big',
        onclick: () => { app.state.filter.genre = genre; app.go('tracks'); },
      }, el('b', { text: genre }), el('span', { class: 'muted', text: ` ${list.length}` })));
    }
    wrap.append(chips);

    const moods = groupBy(items.filter((t) => ud.ai[t.id] && ud.ai[t.id].mood), (t) => ud.ai[t.id].mood);
    if (moods.size) {
      wrap.append(el('h2', { class: 'sec', text: 'حسب المزاج (تصنيف الذكاء الاصطناعي)' }));
      const mchips = el('div', { class: 'chips' });
      for (const [mood, list] of [...moods.entries()].sort((a, b) => b[1].length - a[1].length)) {
        mchips.append(el('button', {
          class: 'chip big ai',
          onclick: () => app.playList(list.map((t) => t.id), { shuffle: true }),
        }, el('b', { text: mood }), el('span', { class: 'muted', text: ` ${list.length}` })));
      }
      wrap.append(mchips);
    }
    return wrap;
  }

  function playlistsView(app) {
    const wrap = el('div', { class: 'page' });
    wrap.append(pageHead('قوائم التشغيل', `${app.state.playlists.length} قائمة`, [
      btn('قائمة جديدة', { onClick: () => app.newPlaylist() }),
      btn('استيراد M3U', { onClick: () => app.importM3U() }),
      app.aiOn() ? btn('قائمة ذكية', { kind: 'primary', icon: ICONS.ai, onClick: () => app.askSmartPlaylist() }) : null,
    ]));
    if (!app.state.playlists.length) {
      wrap.append(el('div', { class: 'empty', text: 'لا توجد قوائم بعد. أنشئ واحدة أو اطلب من الذكاء الاصطناعي بناءها.' }));
      return wrap;
    }
    const grid = el('div', { class: 'grid' });
    for (const pl of app.state.playlists) {
      const tracks = pl.tracks.map((id) => app.state.byId.get(id)).filter(Boolean);
      const cover = tracks.find((t) => t.art) || tracks[0];
      grid.append(el('div', {
        class: 'card',
        onclick: () => app.openPlaylist(pl.id),
        oncontextmenu: (e) => { e.preventDefault(); app.playlistMenu(e, pl); },
      },
      el('div', { class: 'card-art' }, artThumb(cover, 'lg'),
        pl.ai ? el('span', { class: 'card-badge', text: 'AI' }) : null,
        el('button', { class: 'card-play', html: ICONS.play, onclick: (e) => { e.stopPropagation(); app.playList(pl.tracks); } })),
      el('div', { class: 'card-t', text: pl.name }),
      el('div', { class: 'card-s muted', text: `${tracks.length} أغنية · ${fmtDate(pl.updatedAt)}` })));
    }
    wrap.append(grid);
    return wrap;
  }

  function playlistDetail(app) {
    const pl = app.state.playlists.find((p) => p.id === app.state.filter.playlist);
    const wrap = el('div', { class: 'page' });
    if (!pl) { wrap.append(el('div', { class: 'empty', text: 'القائمة غير موجودة.' })); return wrap; }
    const tracks = pl.tracks.map((id) => app.state.byId.get(id)).filter(Boolean);
    wrap.append(pageHead(pl.name, pl.description || `${tracks.length} أغنية`, [
      btn('تشغيل', { kind: 'primary', icon: ICONS.play, onClick: () => app.playList(pl.tracks) }),
      btn('خلط', { icon: ICONS.shuffle, onClick: () => app.playList(pl.tracks, { shuffle: true }) }),
      btn('تصدير M3U', { onClick: () => app.exportM3U(pl.id) }),
      btn('حذف', { kind: 'danger', onClick: () => app.deletePlaylist(pl.id) }),
    ]));
    if (pl.ai && pl.ai.reason) {
      wrap.append(el('div', { class: 'ai-note' },
        el('span', { class: 'ai-tag', text: 'شرح الذكاء الاصطناعي' }),
        el('p', { text: pl.ai.reason })));
    }
    if (!tracks.length) wrap.append(el('div', { class: 'empty', text: 'القائمة فارغة.' }));
    else wrap.append(trackList(app, tracks, { source: `playlist:${pl.id}` }));
    return wrap;
  }

  function favoritesView(app) {
    const items = app.state.tracks.filter((t) => app.state.userdata.favorites[t.id]);
    const wrap = el('div', { class: 'page' });
    wrap.append(pageHead('المفضلة', `${items.length} أغنية`, [
      btn('تشغيل', { kind: 'primary', icon: ICONS.play, onClick: () => app.playList(items.map((t) => t.id)) }),
      app.aiOn() ? btn('راديو مشابه', { icon: ICONS.radio, onClick: () => items[0] && app.aiRadio(items[0].id) }) : null,
    ]));
    if (!items.length) wrap.append(el('div', { class: 'empty', text: 'لم تضف أي أغنية للمفضلة بعد (اضغط ♥ بجانب الأغنية).' }));
    else wrap.append(trackList(app, items, { source: 'favorites' }));
    return wrap;
  }

  function historyView(app) {
    const ud = app.state.userdata;
    const seen = new Set();
    const items = [];
    for (const h of ud.history) {
      if (seen.has(h.id)) continue;
      const t = app.state.byId.get(h.id);
      if (!t) continue;
      seen.add(h.id);
      items.push({ ...t, _at: h.at });
      if (items.length >= 300) break;
    }
    const wrap = el('div', { class: 'page' });
    wrap.append(pageHead('سجل الاستماع', `${items.length} أغنية حديثة`, [
      btn('مسح السجل', { kind: 'danger', onClick: () => app.clearHistory() }),
    ]));
    if (!items.length) wrap.append(el('div', { class: 'empty', text: 'لا يوجد سجل بعد.' }));
    else wrap.append(trackList(app, items, { source: 'history' }));
    return wrap;
  }

  function statsView(app) {
    const s = app.libraryStats();
    const ud = app.state.userdata;
    const tracks = app.state.tracks;
    const wrap = el('div', { class: 'page' });
    wrap.append(pageHead('الإحصاءات', 'نظرة على مكتبتك وعاداتك', [
      app.aiOn() ? btn('رؤى بالذكاء الاصطناعي', { kind: 'primary', icon: ICONS.ai, onClick: () => app.aiInsights() }) : null,
      btn('كشف المكرر', { onClick: () => app.showDuplicates() }),
    ]));
    wrap.append(el('div', { class: 'tiles' },
      tile('الأغاني', s.tracks, 'مفهرسة'),
      tile('ساعات', Math.round(s.duration / 360) / 10, 'إجمالي زمن المكتبة'),
      tile('مرات التشغيل', Object.values(ud.playCount).reduce((a, b) => a + b, 0), 'منذ التثبيت'),
      tile('المفضلة', Object.keys(ud.favorites).length, 'أغنية'),
      tile('بلا غلاف', tracks.filter((t) => !t.art).length, 'يمكن جلبها من الإنترنت'),
      app.aiOn() ? tile('موسومة بالذكاء', Object.keys(ud.ai).length, 'أغنية') : null));

    const byArtist = groupBy(tracks, (t) => t.artist || '—');
    const topArtists = [...byArtist.entries()]
      .map(([name, list]) => ({ name, count: list.length, plays: list.reduce((a, t) => a + (ud.playCount[t.id] || 0), 0) }))
      .sort((a, b) => b.plays - a.plays || b.count - a.count).slice(0, 12);
    wrap.append(el('h2', { class: 'sec', text: 'أكثر الفنانين استماعًا' }));
    const bars = el('div', { class: 'bars' });
    const max = Math.max(1, ...topArtists.map((a) => a.plays || a.count));
    for (const a of topArtists) {
      const v = a.plays || a.count;
      bars.append(el('div', { class: 'bar-row', onclick: () => app.openArtist(a.name) },
        el('span', { class: 'bar-l', text: a.name }),
        el('span', { class: 'bar-t' }, el('span', { class: 'bar-f', style: `width:${(v / max) * 100}%` })),
        el('span', { class: 'bar-v muted', text: `${a.plays} تشغيل · ${a.count} مقطع` })));
    }
    wrap.append(bars);

    const decades = groupBy(tracks.filter((t) => t.year), (t) => `${Math.floor(t.year / 10) * 10}s`);
    if (decades.size) {
      wrap.append(el('h2', { class: 'sec', text: 'التوزّع الزمني' }));
      const chips = el('div', { class: 'chips' });
      for (const [dec, list] of [...decades.entries()].sort()) {
        chips.append(el('button', {
          class: 'chip big',
          onclick: () => app.playList(list.map((t) => t.id), { shuffle: true }),
        }, el('b', { text: dec }), el('span', { class: 'muted', text: ` ${list.length}` })));
      }
      wrap.append(chips);
    }
    return wrap;
  }

  LM.Views = {
    home, tracksView, albumsView, artistsView, genresView, playlistsView,
    playlistDetail, favoritesView, historyView, statsView,
    trackList, toolbar, pageHead, artThumb, btn, ICONS, SORTS, starsWidget, tile, shelf, groupBy,
  };
}(window.LM));
