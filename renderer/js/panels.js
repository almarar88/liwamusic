/* LiwaMusic — اللوحة الجانبية (الآن/الكلمات/الطابور/معلومات) وصفحات الإعدادات والذكاء الاصطناعي. */
'use strict';
(function (LM) {
  const { el, fmtTime, fmtDate, fmtSize, artUrl } = LM;
  const V = () => LM.Views;

  // ————————————————————————————— اللوحة اليمنى

  function nowPanel(app) {
    const t = app.currentTrack();
    if (!t) {
      return el('div', { class: 'rp-empty' },
        el('div', { class: 'rp-ph', text: '♪' }),
        el('p', { class: 'muted', text: 'اختر أغنية لبدء التشغيل.' }));
    }
    const ud = app.state.userdata;
    const meta = ud.ai[t.id];
    const wrap = el('div', { class: 'rp-now' });
    const art = el('div', { class: 'rp-art' });
    if (t.art) art.append(el('img', { src: artUrl(t.art), alt: '' }));
    else art.append(el('span', { class: 'thumb-ph big', text: '♪' }));
    wrap.append(art);
    wrap.append(el('h3', { class: 'rp-title', text: t.title || t.file }));
    wrap.append(el('div', { class: 'rp-sub muted', text: [t.artist, t.album].filter(Boolean).join(' — ') || '—' }));

    const tags = el('div', { class: 'rp-tags' });
    if (t.genre) tags.append(el('span', { class: 'chip xs', text: t.genre }));
    if (t.year) tags.append(el('span', { class: 'chip xs', text: String(t.year) }));
    if (t.lossless) tags.append(el('span', { class: 'chip xs gold', text: 'بلا فقد' }));
    tags.append(el('span', { class: 'chip xs', text: `${t.bitrate || '—'} kbps` }));
    if (meta && meta.mood) tags.append(el('span', { class: 'chip xs ai', text: meta.mood }));
    wrap.append(tags);

    wrap.append(el('div', { class: 'rp-actions' },
      app.aiOn() ? V().btn('راديو مشابه', { icon: V().ICONS.radio, onClick: () => app.aiRadio(t.id) }) : null,
      app.aiOn() ? V().btn('مقدّمة المذيع', { icon: V().ICONS.ai, onClick: () => app.aiDj(t.id) }) : null,
      V().btn('جلب الغلاف', { onClick: () => app.fetchArt(t.id) })));

    if (meta && meta.summary) {
      wrap.append(el('div', { class: 'ai-note sm' },
        el('span', { class: 'ai-tag', text: 'وصف ذكي' }), el('p', { text: meta.summary })));
    }
    if (app.state.dj && app.state.dj.id === t.id && app.state.dj.text) {
      wrap.append(el('div', { class: 'ai-note sm dj' },
        el('span', { class: 'ai-tag', text: 'المذيع' }),
        el('p', { id: 'djText', text: app.state.dj.text })));
    }

    const info = el('div', { class: 'kv' });
    const rows = [
      ['الملف', t.file], ['الصيغة', (t.codec || t.ext || '').toUpperCase()],
      ['التردد', t.sampleRate ? `${(t.sampleRate / 1000).toFixed(1)} kHz` : '—'],
      ['الحجم', fmtSize(t.size)], ['مرات التشغيل', String(ud.playCount[t.id] || 0)],
      ['آخر تشغيل', ud.lastPlayed[t.id] ? fmtDate(ud.lastPlayed[t.id]) : '—'],
    ];
    for (const [k, v] of rows) info.append(el('span', { class: 'k', text: k }), el('span', { class: 'v', text: String(v || '—') }));
    wrap.append(info);
    return wrap;
  }

  function lyricsPanel(app) {
    const t = app.currentTrack();
    const wrap = el('div', { class: 'rp-lyrics', id: 'lyricsBox' });
    if (!t) return el('div', { class: 'rp-empty' }, el('p', { class: 'muted', text: 'لا توجد أغنية قيد التشغيل.' }));
    const data = app.state.lyrics;
    if (!data || data.id !== t.id) {
      wrap.append(el('div', { class: 'rp-empty' },
        el('p', { class: 'muted', text: 'لم تُجلب الكلمات بعد.' }),
        V().btn('جلب الكلمات من الإنترنت', { kind: 'primary', onClick: () => app.fetchLyrics(t.id) })));
      return wrap;
    }
    if (data.synced && data.synced.length) {
      wrap.classList.add('synced');
      data.synced.forEach((line, i) => {
        wrap.append(el('p', {
          class: 'ly', dataset: { i: String(i), time: String(line.time) },
          onclick: () => app.seek(line.time),
          text: line.text || '♪',
        }));
      });
      wrap.append(el('div', { class: 'ly-src muted xs', text: `المصدر: ${data.source || 'LRCLIB'} · اضغط أي سطر للانتقال` }));
    } else if (data.plain) {
      wrap.append(el('pre', { class: 'ly-plain', text: data.plain }));
      wrap.append(el('div', { class: 'ly-src muted xs', text: `المصدر: ${data.source || 'LRCLIB'}` }));
    } else {
      wrap.append(el('div', { class: 'rp-empty' }, el('p', { class: 'muted', text: 'لا توجد كلمات متاحة لهذه الأغنية.' })));
    }
    return wrap;
  }

  function queuePanel(app) {
    const wrap = el('div', { class: 'rp-queue' });
    const q = app.state.queue;
    wrap.append(el('div', { class: 'rp-head' },
      el('span', { text: `${q.length} في الطابور` }),
      el('button', { class: 'btn xs', text: 'تفريغ', onclick: () => app.clearQueue() })));
    if (!q.length) { wrap.append(el('p', { class: 'muted pad', text: 'الطابور فارغ.' })); return wrap; }
    const list = el('div', { class: 'q-list' });
    q.forEach((id, i) => {
      const t = app.state.byId.get(id);
      if (!t) return;
      const row = el('div', {
        class: `q-row${i === app.state.queueIndex ? ' current' : ''}`,
        draggable: 'true',
        dataset: { i: String(i) },
        ondblclick: () => app.jumpQueue(i),
        ondragstart: (e) => { e.dataTransfer.setData('text/plain', String(i)); row.classList.add('dragging'); },
        ondragend: () => row.classList.remove('dragging'),
        ondragover: (e) => { e.preventDefault(); row.classList.add('over'); },
        ondragleave: () => row.classList.remove('over'),
        ondrop: (e) => {
          e.preventDefault(); row.classList.remove('over');
          app.moveQueue(Number(e.dataTransfer.getData('text/plain')), i);
        },
      },
      el('span', { class: 'q-i', text: String(i + 1) }),
      V().artThumb(t),
      el('span', { class: 'q-t' },
        el('span', { class: 'q-n', text: t.title || t.file }),
        el('span', { class: 'q-a muted', text: t.artist || '—' })),
      el('button', { class: 'icon-btn xs', text: '✕', title: 'إزالة', onclick: (e) => { e.stopPropagation(); app.removeFromQueue(i); } }));
      list.append(row);
    });
    wrap.append(list);
    return wrap;
  }

  function infoPanel(app) {
    const t = app.currentTrack();
    const wrap = el('div', { class: 'rp-info' });
    if (!t) return el('div', { class: 'rp-empty' }, el('p', { class: 'muted', text: 'لا توجد أغنية محددة.' }));
    const bio = app.state.artistInfo;
    wrap.append(el('div', { class: 'rp-head' }, el('span', { text: t.artist || 'فنان غير معروف' })));
    if (!bio || bio.artist !== (t.artist || '')) {
      wrap.append(el('div', { class: 'pad' },
        V().btn('جلب نبذة عن الفنان', { kind: 'primary', onClick: () => app.fetchArtistInfo(t.artist) })));
    } else if (bio.data) {
      if (bio.data.thumb) wrap.append(el('div', { class: 'bio-thumb muted xs', text: 'الصورة متاحة على ويكيبيديا' }));
      wrap.append(el('p', { class: 'bio', text: bio.data.extract }));
      if (bio.data.url) {
        wrap.append(el('button', {
          class: 'btn xs', text: 'فتح في ويكيبيديا', onclick: () => app.openExternal(bio.data.url),
        }));
      }
    } else {
      wrap.append(el('p', { class: 'muted pad', text: 'لم يُعثر على نبذة.' }));
    }

    wrap.append(el('h4', { class: 'sec sm', text: 'بيانات إضافية من الإنترنت' }));
    const mb = app.state.onlineMeta;
    if (mb && mb.id === t.id && mb.data) {
      const kv = el('div', { class: 'kv' });
      for (const [k, v] of [['MBID', mb.data.mbid], ['الفنان', mb.data.artist], ['الألبوم', mb.data.album], ['السنة', mb.data.year || '—'], ['وسوم', (mb.data.tags || []).join('، ') || '—']]) {
        kv.append(el('span', { class: 'k', text: k }), el('span', { class: 'v', text: String(v || '—') }));
      }
      wrap.append(kv);
      wrap.append(V().btn('تطبيق على الأغنية', { onClick: () => app.applyOnlineMeta(t.id, mb.data) }));
    } else {
      wrap.append(el('div', { class: 'pad' }, V().btn('بحث في MusicBrainz', { onClick: () => app.fetchMeta(t.id) })));
    }
    wrap.append(el('h4', { class: 'sec sm', text: 'تعديل البيانات محليًا' }));
    wrap.append(V().btn('تحرير الوسوم', { onClick: () => editTags(app, t) }));
    return wrap;
  }

  function render(app, tab) {
    const body = LM.$('#rpBody');
    if (!body) return;
    body.innerHTML = '';
    const map = { now: nowPanel, lyrics: lyricsPanel, queue: queuePanel, info: infoPanel };
    body.append((map[tab] || nowPanel)(app));
    if (tab === 'lyrics') updateLyrics(app, app.engine.position, true);
  }

  /** يبرز السطر الحالي في الكلمات المتزامنة. */
  function updateLyrics(app, position, force = false) {
    const box = document.getElementById('lyricsBox');
    if (!box || !box.classList.contains('synced')) return;
    const data = app.state.lyrics;
    if (!data || !data.synced) return;
    let idx = -1;
    for (let i = 0; i < data.synced.length; i++) {
      if (data.synced[i].time <= position + 0.15) idx = i; else break;
    }
    if (idx === app._lyIdx && !force) return;
    app._lyIdx = idx;
    const lines = box.querySelectorAll('.ly');
    lines.forEach((n, i) => n.classList.toggle('on', i === idx));
    const active = lines[idx];
    if (active) {
      const target = active.offsetTop - box.clientHeight / 2 + active.clientHeight / 2;
      box.scrollTo({ top: Math.max(0, target), behavior: force ? 'auto' : 'smooth' });
    }
  }

  // ————————————————————————————— نوافذ

  function eqModal(app) {
    const eng = app.engine;
    const wrap = el('div', { class: 'eq' });
    const head = el('div', { class: 'eq-head' },
      el('label', { class: 'switch' },
        el('input', {
          type: 'checkbox', checked: eng.eqEnabled,
          onchange: (e) => { app.setSetting({ eqEnabled: eng.setEQEnabled(e.target.checked) }); },
        }), el('span', { text: 'تفعيل المعادل' })),
      el('select', {
        class: 'select',
        onchange: (e) => {
          const gains = eng.applyPreset(e.target.value);
          app.setSetting({ eqPreset: e.target.value, eqGains: gains });
          wrap.querySelectorAll('.eq-band input').forEach((inp, i) => {
            inp.value = gains[i];
            inp.parentElement.querySelector('.eq-v').textContent = `${gains[i] > 0 ? '+' : ''}${gains[i]}`;
          });
        },
      }, Object.keys(LM.EQ_PRESETS).map((k) => el('option', {
        value: k, selected: app.state.settings.eqPreset === k,
      }, {
        flat: 'مسطّح', pop: 'بوب', rock: 'روك', jazz: 'جاز', classical: 'كلاسيكي',
        bass: 'تعزيز الجهير', treble: 'تعزيز الحدّة', vocal: 'الصوت البشري',
        electronic: 'إلكتروني', oriental: 'شرقي', night: 'وضع ليلي',
      }[k] || k))));
    wrap.append(head);

    const bands = el('div', { class: 'eq-bands' });
    LM.EQ_BANDS.forEach((freq, i) => {
      const val = eng.eqGains[i] || 0;
      const band = el('div', { class: 'eq-band' },
        el('span', { class: 'eq-v', text: `${val > 0 ? '+' : ''}${val}` }),
        el('input', {
          type: 'range', min: -12, max: 12, step: 1, value: val, orient: 'vertical',
          oninput: (e) => {
            const gains = [...eng.eqGains];
            gains[i] = Number(e.target.value);
            eng.setEQGains(gains);
            band.querySelector('.eq-v').textContent = `${gains[i] > 0 ? '+' : ''}${gains[i]}`;
            app.setSetting({ eqGains: gains, eqPreset: 'custom' });
          },
        }),
        el('span', { class: 'eq-f', text: freq >= 1000 ? `${freq / 1000}k` : String(freq) }));
      bands.append(band);
    });
    wrap.append(bands);

    wrap.append(el('div', { class: 'eq-extra' },
      sliderRow('التضخيم المسبق', -12, 12, 1, eng.preamp, (v) => {
        eng.setPreamp(v); app.setSetting({ eqPreamp: v });
      }, (v) => `${v > 0 ? '+' : ''}${v} dB`),
      sliderRow('التلاشي المتقاطع', 0, 12, 1, eng.crossfade, (v) => {
        eng.setCrossfade(v); app.setSetting({ crossfade: v });
      }, (v) => (v ? `${v} ثانية` : 'معطّل')),
      sliderRow('سرعة التشغيل', 0.5, 2, 0.05, eng.rate, (v) => {
        eng.setRate(v); app.setSetting({ rate: v });
      }, (v) => `${v.toFixed(2)}×`),
      el('label', { class: 'switch' },
        el('input', {
          type: 'checkbox', checked: eng.normalize,
          onchange: (e) => app.setSetting({ normalize: eng.setNormalize(e.target.checked) }),
        }), el('span', { text: 'تطبيع الصوت (تقليل فروق الجهارة)' }))));

    LM.modal({ title: 'المعادل الصوتي والمؤثرات', body: wrap, wide: true });
  }

  function sliderRow(label, min, max, step, value, onInput, fmt = String) {
    const out = el('span', { class: 'sr-v', text: fmt(value) });
    return el('div', { class: 'sr' },
      el('span', { class: 'sr-l', text: label }),
      el('input', {
        type: 'range', min, max, step, value,
        oninput: (e) => { const v = Number(e.target.value); out.textContent = fmt(v); onInput(v); },
      }), out);
  }

  function sleepModal(app) {
    const opts = [0, 10, 15, 30, 45, 60, 90, 120];
    const wrap = el('div', { class: 'sleep' });
    wrap.append(el('p', { class: 'muted', text: 'يخفت الصوت تدريجيًا ثم يتوقف التشغيل.' }));
    const row = el('div', { class: 'chips' });
    for (const m of opts) {
      row.append(el('button', {
        class: `chip big${app.state.settings.sleepMinutes === m ? ' on' : ''}`,
        onclick: () => {
          app.engine.setSleep(m);
          app.setSetting({ sleepMinutes: m });
          LM.toast(m ? `سيتوقف التشغيل بعد ${m} دقيقة` : 'أُلغي مؤقت النوم', 'ok');
          row.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
          if (m) row.children[opts.indexOf(m)].classList.add('on');
        },
      }, m ? `${m} دقيقة` : 'إيقاف'));
    }
    wrap.append(row);
    LM.modal({ title: 'مؤقت النوم', body: wrap });
  }

  function editTags(app, track) {
    const ud = app.state.userdata.overrides[track.id] || {};
    const fields = [
      ['title', 'العنوان'], ['artist', 'الفنان'], ['album', 'الألبوم'],
      ['genre', 'النوع'], ['year', 'السنة'],
    ];
    const inputs = {};
    const form = el('div', { class: 'form grid2' });
    for (const [key, label] of fields) {
      const input = el('input', { type: key === 'year' ? 'number' : 'text', value: ud[key] ?? track[key] ?? '' });
      inputs[key] = input;
      form.append(el('label', {}, el('span', { text: label }), input));
    }
    form.append(el('p', { class: 'muted xs', text: 'التعديل يُحفظ داخل LiwaMusic فقط ولا يغيّر ملفاتك الأصلية.' }));
    LM.modal({
      title: 'تحرير البيانات',
      body: form,
      actions: [
        { label: 'إلغاء' },
        {
          label: 'حفظ',
          kind: 'primary',
          onClick: async () => {
            const patch = {};
            for (const [key] of fields) {
              const v = inputs[key].value.trim();
              patch[key] = key === 'year' ? (Number(v) || '') : v;
            }
            await app.saveOverride(track.id, patch);
          },
        },
      ],
    });
  }

  // ————————————————————————————— صفحة الذكاء الاصطناعي

  function aiPage(app) {
    const wrap = el('div', { class: 'page' });
    const st = app.state.aiStatus || {};
    wrap.append(V().pageHead('الذكاء الاصطناعي', 'يعمل عبر Claude بمفتاحك الخاص — يُخزَّن مشفّرًا على جهازك ولا يُرسل لأي جهة أخرى.', []));

    if (!app.aiOn()) {
      wrap.append(el('div', { class: 'panel' },
        el('h3', { text: 'الميزات الذكية مغلقة' }),
        el('p', { class: 'muted', text: 'كل ميزات LiwaMusic الأخرى — الفهرسة والتشغيل والأغلفة والكلمات — تعمل بلا أي تكلفة. الميزات الذكية وحدها تحتاج مفتاح Anthropic API مدفوعًا بالاستخدام.' }),
        V().btn('تفعيل الميزات الذكية', { kind: 'primary', onClick: () => app.setAiEnabled(true) })));
      return wrap;
    }

    if (!st.hasKey) {
      const input = el('input', { type: 'password', placeholder: 'sk-ant-…', autocomplete: 'off' });
      wrap.append(el('div', { class: 'panel' },
        el('h3', { text: 'تفعيل الميزات الذكية' }),
        el('p', { class: 'muted', text: 'أدخل مفتاح Anthropic API لتفعيل: التصنيف الذكي، القوائم بالوصف، البحث الدلالي، الراديو المشابه، ومقدّمات المذيع.' }),
        el('div', { class: 'row gap' }, input,
          V().btn('حفظ المفتاح', { kind: 'primary', onClick: () => app.saveAiKey(input.value) })),
        el('p', { class: 'muted xs', text: 'احصل على المفتاح من console.anthropic.com — التشفير يتم عبر نظام ويندوز (safeStorage).' })));
      return wrap;
    }

    const modelSel = el('select', {
      class: 'select',
      onchange: (e) => app.setSetting({ aiModel: e.target.value }),
    }, (st.models || []).map((m) => el('option', { value: m.id, selected: (app.state.settings.aiModel || st.model) === m.id }, m.label)));

    wrap.append(el('div', { class: 'panel row between' },
      el('div', {}, el('b', { text: 'النموذج' }), el('p', { class: 'muted xs', text: 'الأدق أبطأ وأغلى؛ الأسرع مناسب للتصنيف الجماعي.' })),
      el('div', { class: 'row gap' }, modelSel,
        V().btn('إزالة المفتاح', { kind: 'danger', onClick: () => app.clearAiKey() }))));

    const promptBox = el('textarea', {
      rows: 3,
      placeholder: 'مثال: قائمة هادئة للمذاكرة الليلية، عربية وأجنبية، بلا إيقاع سريع…',
    });
    wrap.append(el('div', { class: 'panel' },
      el('h3', { text: 'قائمة تشغيل بالوصف' }),
      promptBox,
      el('div', { class: 'row gap' },
        V().btn('أنشئ القائمة', { kind: 'primary', icon: V().ICONS.ai, onClick: () => app.buildSmartPlaylist(promptBox.value) }),
        el('span', { class: 'muted xs', text: 'يختار من مكتبتك فقط — لا يخترع أغانٍ.' }))));

    const untagged = app.state.tracks.filter((t) => !app.state.userdata.ai[t.id]).length;
    wrap.append(el('div', { class: 'panel' },
      el('h3', { text: 'التصنيف الذكي (مزاج/طاقة/أنواع)' }),
      el('p', { class: 'muted', text: `${untagged} أغنية بلا تصنيف ذكي بعد.` }),
      el('div', { class: 'row gap' },
        V().btn('صنّف 40 أغنية', { onClick: () => app.aiTagLibrary(40) }),
        V().btn('صنّف المكتبة كاملة', { kind: 'primary', onClick: () => app.aiTagLibrary(0) })),
      el('div', { class: 'progress', id: 'aiProgress', hidden: true }, el('div', { class: 'progress-f' }))));

    wrap.append(el('div', { class: 'panel' },
      el('h3', { text: 'رؤى عن مكتبتك' }),
      el('div', { class: 'row gap' },
        V().btn('توليد التقرير', { kind: 'primary', onClick: () => app.aiInsights() })),
      app.state.insights ? el('div', { class: 'md', html: mdToHtml(app.state.insights) }) : null));

    return wrap;
  }

  /** تحويل Markdown مبسّط (عناوين/قوائم/عريض) إلى HTML آمن. */
  function mdToHtml(md) {
    const escaped = LM.esc(md);
    return escaped
      .replace(/^### (.*)$/gm, '<h4>$1</h4>')
      .replace(/^## (.*)$/gm, '<h3>$1</h3>')
      .replace(/^# (.*)$/gm, '<h2>$1</h2>')
      .replace(/^\s*[-*] (.*)$/gm, '<li>$1</li>')
      .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n{2,}/g, '</p><p>')
      .replace(/^(?!<[hul])/gm, '');
  }

  // ————————————————————————————— صفحة Google Drive

  function fmtBytes(n) { return LM.fmtSize(n || 0); }

  function drivePage(app) {
    const st = app.state.driveStatus || {};
    const wrap = el('div', { class: 'page' });
    wrap.append(V().pageHead('Google Drive',
      'شغّل أغانيك من درايف مباشرة بلا تنزيلها، وزامن تقييماتك وقوائمك بين أجهزتك.', []));

    // 1) معرّف العميل
    if (!st.hasClient) {
      const idInput = el('input', { type: 'text', placeholder: '…apps.googleusercontent.com' });
      const secInput = el('input', { type: 'password', placeholder: 'Client secret (اختياري لتطبيقات سطح المكتب)' });
      wrap.append(el('div', { class: 'panel' },
        el('h3', { text: 'الخطوة 1 — معرّف عميل جوجل (مرة واحدة)' }),
        el('p', { class: 'muted', text: 'الوصول إلى ملفاتك يتطلب موافقتك عبر حسابك أنت، لذا تُنشئ معرّفًا مجانيًا من Google Cloud Console وتلصقه هنا. لا يغادر جهازك.' }),
        el('ol', { class: 'steps' },
          el('li', {}, 'افتح ', el('a', { class: 'lnk', text: 'console.cloud.google.com', onclick: () => app.openExternal('https://console.cloud.google.com/projectcreate') }), ' وأنشئ مشروعًا جديدًا (أي اسم).'),
          el('li', {}, 'من ', el('b', { text: 'APIs & Services ← Library' }), ' فعّل ', el('b', { text: 'Google Drive API' }), '.'),
          el('li', {}, 'من ', el('b', { text: 'OAuth consent screen' }), ' اختر ', el('b', { text: 'External' }), '، واملأ الاسم والبريد، ثم أضف بريدك في ', el('b', { text: 'Test users' }), '.'),
          el('li', {}, 'من ', el('b', { text: 'Credentials ← Create credentials ← OAuth client ID' }), ' اختر نوع ', el('b', { text: 'Desktop app' }), '.'),
          el('li', {}, 'انسخ ', el('b', { text: 'Client ID' }), ' (و Client secret إن ظهر) وألصقهما هنا.')),
        el('div', { class: 'form' }, el('label', {}, el('span', { text: 'Client ID' }), idInput),
          el('label', {}, el('span', { text: 'Client secret' }), secInput)),
        el('div', { class: 'note' },
          el('b', { text: 'عندك معرّف من نوع Web application؟' }),
          el('p', { text: 'يعمل أيضًا، لكن أضف هذا الرابط في «Authorized redirect URIs» داخل إعدادات العميل، وألصق Client secret أعلاه:' }),
          el('code', { class: 'copyable', text: st.redirectUri || 'http://127.0.0.1:8765' })),
        el('div', { class: 'row gap' },
          V().btn('حفظ ومتابعة', { kind: 'primary', onClick: () => app.driveSetClient(idInput.value, secInput.value) }),
          V().btn('فتح دليل جوجل', { onClick: () => app.openExternal('https://developers.google.com/workspace/guides/create-credentials#desktop-app') }))));
      return wrap;
    }

    // 2) الربط
    if (!st.connected) {
      wrap.append(el('div', { class: 'panel' },
        el('h3', { text: 'الخطوة 2 — اربط حسابك' }),
        el('p', { class: 'muted', text: 'سيفتح متصفحك صفحة موافقة جوجل. الصلاحيات المطلوبة: قراءة ملفاتك فقط + مجلد صغير خاص بالتطبيق للمزامنة. لا صلاحية تعديل أو حذف.' }),
        el('p', { class: 'muted xs', text: 'إن ظهرت شاشة «Google hasn\'t verified this app» فهذا طبيعي لأن التطبيق خاص بك: اضغط Advanced ثم Go to … (unsafe).' }),
        el('div', { class: 'note' },
          el('p', { text: 'إن ظهر خطأ redirect_uri_mismatch فمعرّفك من نوع Web application — أضف هذا الرابط في «Authorized redirect URIs»:' }),
          el('code', { class: 'copyable', text: st.redirectUri || 'http://127.0.0.1:8765' })),
        el('div', { class: 'row gap' },
          V().btn('ربط الحساب', { kind: 'primary', onClick: () => app.driveConnect() }),
          V().btn('تغيير معرّف العميل', { onClick: () => app.driveChangeClient() }))));
      return wrap;
    }

    // 3) متصل
    const acc = st.account || {};
    const quota = acc.quota || {};
    wrap.append(el('div', { class: 'panel row between' },
      el('div', {},
        el('b', { text: acc.name || 'حساب مرتبط' }),
        el('p', { class: 'muted xs', text: acc.email || '' }),
        quota.limit ? el('p', { class: 'muted xs', text: `المستخدَم ${fmtBytes(quota.usage)} من ${fmtBytes(quota.limit)}` }) : null),
      el('div', { class: 'row gap' },
        V().btn('تحديث الفهرس', { onClick: () => app.driveScan() }),
        V().btn('فصل الحساب', { kind: 'danger', onClick: () => app.driveDisconnect() }))));

    wrap.append(el('div', { class: 'tiles' },
      V().tile('أغاني درايف', st.tracks || 0, 'مفهرسة في مكتبتك'),
      V().tile('بلا وسوم بعد', st.untagged || 0, 'تُقرأ تلقائيًا في الخلفية'),
      V().tile('محفوظة للتشغيل دون إنترنت', (st.cache || {}).count || 0, fmtBytes((st.cache || {}).bytes)),
      V().tile('آخر مزامنة', st.sync && st.sync.lastAt ? fmtDate(st.sync.lastAt) : '—', st.sync && st.sync.enabled ? `كل ${st.sync.minutes} دقيقة` : 'المزامنة متوقفة')));

    // المجلدات
    const folders = el('div', { class: 'folders' });
    for (const f of st.folders || []) {
      folders.append(el('div', { class: 'folder-row' },
        el('span', { class: 'f-path', text: `📁 ${f.name}`, title: f.id }),
        el('button', { class: 'btn xs danger', text: 'إزالة', onclick: () => app.driveRemoveFolder(f.id, f.name) })));
    }
    if (!(st.folders || []).length) folders.append(el('p', { class: 'muted xs pad', text: 'لم تختر مجلدًا بعد.' }));
    wrap.append(el('div', { class: 'panel' },
      el('h3', { text: 'مجلدات الأغاني في درايف' }),
      folders,
      el('div', { class: 'row gap' },
        V().btn('تصفّح واختيار مجلد', { kind: 'primary', onClick: () => app.driveBrowse() }),
        st.untagged ? V().btn(`قراءة وسوم ${st.untagged} أغنية الآن`, { onClick: () => app.driveEnrich() }) : null)));

    // المزامنة
    wrap.append(el('div', { class: 'panel' },
      el('h3', { text: 'المزامنة بين أجهزتك' }),
      el('p', { class: 'muted', text: 'التقييمات والمفضلة وقوائم التشغيل وتعديلات البيانات والأغلفة المخصّصة تُحفظ في ملف صغير مخفي داخل مجلد خاص بالتطبيق في درايف — لا يظهر بين ملفاتك ولا يمكن للتطبيق قراءة أي شيء آخر.' }),
      toggleRow('تفعيل المزامنة التلقائية', st.sync && st.sync.enabled, (v) => app.setSync(v)),
      el('div', { class: 'row gap' },
        V().btn('مزامنة الآن', { kind: 'primary', onClick: () => app.syncNow() }))));

    // الكاش
    wrap.append(el('div', { class: 'panel' },
      el('h3', { text: 'التخزين المؤقت' }),
      el('p', { class: 'muted', text: `${(st.cache || {}).count || 0} ملف · ${fmtBytes((st.cache || {}).bytes)} على القرص. الأغاني المشغّلة تُبثّ مباشرة، والمحفوظة منها تعمل بلا إنترنت.` }),
      el('div', { class: 'row gap' },
        V().btn('تفريغ التخزين المؤقت', { kind: 'danger', onClick: () => app.clearDriveCache() }))));

    return wrap;
  }

  // ————————————————————————————— صفحة الإعدادات

  function settingsPage(app) {
    const s = app.state.settings;
    const wrap = el('div', { class: 'page' });
    wrap.append(V().pageHead('الإعدادات', 'المظهر، الفهرسة، الإنترنت، والاختصارات', []));

    // المظهر
    const accents = ['violet', 'emerald', 'amber', 'rose', 'sky', 'lime'];
    wrap.append(el('div', { class: 'panel' },
      el('h3', { text: 'المظهر' }),
      el('div', { class: 'row gap wrap' },
        el('label', { class: 'switch' },
          el('input', {
            type: 'checkbox', checked: s.theme === 'light',
            onchange: (e) => app.setTheme(e.target.checked ? 'light' : 'dark'),
          }), el('span', { text: 'الوضع الفاتح' })),
        el('label', { class: 'switch' },
          el('input', {
            type: 'checkbox', checked: s.dynamicColor,
            onchange: (e) => { app.setSetting({ dynamicColor: e.target.checked }); app.applyAccentFromArt(); },
          }), el('span', { text: 'تلوين الواجهة من غلاف الأغنية' })),
        el('label', { class: 'switch' },
          el('input', {
            type: 'checkbox', checked: s.lang === 'en',
            onchange: (e) => app.setLang(e.target.checked ? 'en' : 'ar'),
          }), el('span', { text: 'English interface' }))),
      el('div', { class: 'swatches' }, accents.map((a) => el('button', {
        class: `swatch ${a}${s.accent === a ? ' on' : ''}`,
        title: a,
        onclick: () => app.setAccent(a),
      })))));

    // المؤثر البصري
    wrap.append(el('div', { class: 'panel' },
      el('h3', { text: 'المؤثر البصري' }),
      el('div', { class: 'row gap' }, ['bars', 'wave', 'off'].map((v) => el('button', {
        class: `chip big${s.visualizer === v ? ' on' : ''}`,
        onclick: (e) => {
          app.setSetting({ visualizer: v });
          e.target.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
          e.target.classList.add('on');
        },
      }, { bars: 'أعمدة', wave: 'موجة', off: 'إيقاف' }[v])))));

    // الإنترنت
    wrap.append(el('div', { class: 'panel' },
      el('h3', { text: 'الإنترنت' }),
      toggleRow('جلب الأغلفة الناقصة تلقائيًا (iTunes)', s.onlineArt, (v) => app.setSetting({ onlineArt: v })),
      toggleRow('جلب كلمات الأغاني تلقائيًا (LRCLIB)', s.onlineLyrics, (v) => app.setSetting({ onlineLyrics: v })),
      toggleRow('إثراء البيانات من MusicBrainz عند الطلب', s.onlineMeta, (v) => app.setSetting({ onlineMeta: v })),
      el('p', { class: 'muted xs', text: 'كل الطلبات تتم من جهازك مباشرة إلى الخدمات المذكورة، ولا يُرسل أي شيء لخوادم LiwaMusic (لا يوجد خادم أصلًا).' })));

    // الميزات الذكية
    wrap.append(el('div', { class: 'panel' },
      el('h3', { text: 'الميزات الذكية (اختيارية ومغلقة افتراضيًا)' }),
      el('p', { class: 'muted', text: 'القوائم بالوصف، البحث الدلالي، الراديو المشابه، التصنيف، ومقدّمات المذيع. تحتاج مفتاح Anthropic API مدفوعًا بالاستخدام — لا شيء يُرسل ولا يُحسب عليك ما دامت مغلقة.' }),
      toggleRow('تفعيل ميزات الذكاء الاصطناعي', s.aiEnabled, (v) => app.setAiEnabled(v))));

    // المكتبة
    const folders = el('div', { class: 'folders' });
    for (const f of app.state.folders) {
      folders.append(el('div', { class: 'folder-row' },
        el('span', { class: 'f-path', text: f, title: f }),
        el('button', { class: 'btn xs danger', text: 'إزالة', onclick: () => app.removeFolder(f) })));
    }
    wrap.append(el('div', { class: 'panel' },
      el('h3', { text: 'المكتبة والفهرسة' }),
      folders,
      toggleRow('مراقبة المجلدات وإضافة الجديد تلقائيًا', s.watchFolders, (v) => app.setSetting({ watchFolders: v })),
      el('div', { class: 'row gap wrap' },
        V().btn('إضافة مجلد', { kind: 'primary', onClick: () => app.addFolder() }),
        V().btn('إعادة فهرسة سريعة', { onClick: () => app.rescan(false) }),
        V().btn('إعادة فهرسة كاملة', { onClick: () => app.rescan(true) }),
        V().btn('تصدير المكتبة', { onClick: () => app.exportLibrary() }),
        V().btn('استيراد المكتبة', { onClick: () => app.importLibrary() }))));

    // الاختصارات
    const keys = [
      ['مسافة', 'تشغيل/إيقاف'], ['Ctrl + →', 'التالي'], ['Ctrl + ←', 'السابق'],
      ['→ / ←', 'تقديم/تأخير 5 ثوانٍ'], ['↑ / ↓', 'رفع/خفض الصوت'], ['S', 'الخلط'],
      ['R', 'التكرار'], ['M', 'كتم الصوت'], ['F', 'مفضلة'], ['E', 'المعادل'],
      ['L', 'الكلمات'], ['Q', 'الطابور'], ['Ctrl + F', 'البحث'], ['Ctrl + M', 'المشغل المصغّر'],
      ['1..5', 'التقييم بالنجوم'],
    ];
    const kv = el('div', { class: 'kv keys' });
    for (const [k, v] of keys) kv.append(el('span', { class: 'k', text: k }), el('span', { class: 'v', text: v }));
    wrap.append(el('div', { class: 'panel' }, el('h3', { text: 'اختصارات لوحة المفاتيح' }), kv,
      el('p', { class: 'muted xs', text: 'مفاتيح الوسائط في لوحة المفاتيح (تشغيل/التالي/السابق) تعمل حتى خارج التطبيق.' })));

    // عن التطبيق
    const info = app.state.appInfo || {};
    wrap.append(el('div', { class: 'panel about' },
      el('h3', { text: 'عن LiwaMusic' }),
      el('p', {}, el('b', { text: 'LiwaMusic' }), ` — الإصدار ${info.version || '1.0.0'}`),
      el('p', { class: 'muted', text: 'مشغل وفهرس موسيقى لويندوز: فهرسة محلية سريعة، إثراء من الإنترنت، وميزات ذكاء اصطناعي.' }),
      el('p', { class: 'made-by big', html: 'تم إنشاؤه عن طريق <b>LiwaMusic</b>' }),
      el('p', { class: 'muted xs', text: `Electron ${info.electron || '—'} · Chromium ${info.chrome || '—'} · Node ${info.node || '—'}` })));

    return wrap;
  }

  function toggleRow(label, value, onChange) {
    return el('label', { class: 'switch row-block' },
      el('input', { type: 'checkbox', checked: !!value, onchange: (e) => onChange(e.target.checked) }),
      el('span', { text: label }));
  }

  LM.Panels = {
    render, updateLyrics, eqModal, sleepModal, aiPage, settingsPage, drivePage, editTags, mdToHtml, sliderRow,
  };
}(window.LM));
