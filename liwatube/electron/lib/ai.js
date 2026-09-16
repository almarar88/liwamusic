'use strict';
/**
 * LiwaTube — طبقة الذكاء الاصطناعي (Claude).
 * المفتاح يوفّره المستخدم ويُخزَّن مشفّرًا عبر safeStorage من ويندوز.
 * كل الاستدعاءات تتم في العملية الرئيسية — لا يصل المفتاح إلى الواجهة أبدًا.
 *
 * الميزات: فهم الفيديو من إطاراته (عنوان/وصف/وسوم/فصول/ملخص)، اختيار أفضل إطار كصورة مصغّرة،
 * بحث دلالي، توصيات شخصية مع أسباب، قوائم ذكية، محادثة عن الفيديو، وتقرير رؤى.
 */
const fs = require('fs');
const path = require('path');

const MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5 — الأدق' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — متوازن' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — الأسرع' },
];
const DEFAULT_MODEL = 'claude-opus-5';

const fmtTime = (s) => {
  s = Math.max(0, Math.round(Number(s) || 0));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

class AI {
  constructor({ dir, safeStorage }) {
    this.keyFile = path.join(dir, 'ai-key.bin');
    this.safeStorage = safeStorage;
    this._client = null;
    this._clientKey = null;
  }

  // ---------- إدارة المفتاح ----------

  hasKey() {
    try { return fs.statSync(this.keyFile).size > 0; } catch { return false; }
  }

  setKey(key) {
    const value = String(key || '').trim();
    if (!value) { this.clearKey(); return { ok: true, hasKey: false }; }
    let buf;
    if (this.safeStorage && this.safeStorage.isEncryptionAvailable()) {
      buf = this.safeStorage.encryptString(value);
    } else {
      buf = Buffer.from(`plain:${value}`, 'utf8');
    }
    fs.writeFileSync(this.keyFile, buf, { mode: 0o600 });
    this._client = null;
    return { ok: true, hasKey: true };
  }

  clearKey() {
    try { fs.unlinkSync(this.keyFile); } catch { /* غير موجود */ }
    this._client = null;
    this._clientKey = null;
  }

  _readKey() {
    if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
    if (!this.hasKey()) return null;
    const buf = fs.readFileSync(this.keyFile);
    const asText = buf.toString('utf8');
    if (asText.startsWith('plain:')) return asText.slice(6);
    try { return this.safeStorage.decryptString(buf); } catch { return null; }
  }

  async _getClient() {
    const key = this._readKey();
    if (!key) {
      const err = new Error('NO_API_KEY');
      err.code = 'NO_API_KEY';
      throw err;
    }
    if (this._client && this._clientKey === key) return this._client;
    const mod = await import('@anthropic-ai/sdk');
    const Anthropic = mod.default || mod.Anthropic;
    this._client = new Anthropic({ apiKey: key });
    this._clientKey = key;
    return this._client;
  }

  // ---------- أدوات مساعدة ----------

  /** يبني فهرسًا مختصرًا للمكتبة برموز رقمية لتوفير الرموز (tokens). */
  static buildCatalog(videos, userdata = {}, limit = 500, preferIds = null) {
    const ai = userdata.ai || {};
    const ov = userdata.overrides || {};
    const plays = userdata.playCount || {};
    const likes = userdata.likes || {};
    const list = Object.values(videos).filter((v) => !(userdata.hidden || {})[v.id]);
    const pref = new Set(preferIds || []);
    const scored = list.map((v) => ({
      v,
      score: (pref.has(v.id) ? 2000 : 0) + (likes[v.id] > 0 ? 1000 : 0) + Math.min(500, (plays[v.id] || 0) * 20) + (ai[v.id] ? 50 : 0),
    }));
    scored.sort((a, b) => b.score - a.score);
    let chosen = scored.slice(0, limit).map((s) => s.v);
    if (list.length > limit) {
      const half = Math.floor(limit / 2);
      const keep = new Set(chosen.slice(0, half).map((v) => v.id));
      const rest = list.filter((v) => !keep.has(v.id));
      const step = Math.max(1, Math.floor(rest.length / Math.max(1, limit - keep.size)));
      const sample = [];
      for (let i = 0; i < rest.length && sample.length < limit - keep.size; i += step) sample.push(rest[i]);
      chosen = [...chosen.slice(0, half), ...sample];
    }
    const map = [];
    const lines = chosen.map((v, i) => {
      map.push(v.id);
      const a = ai[v.id] || {};
      const o = ov[v.id] || {};
      const bits = [
        `${i}`,
        o.title || a.title || v.title,
        v.channel || '—',
        fmtTime(v.duration),
        (o.tags || a.tags || []).slice(0, 5).join(',') || '—',
        a.category || '—',
      ];
      if (a.summary) bits.push((a.summary || '').slice(0, 90));
      if (plays[v.id]) bits.push(`plays:${plays[v.id]}`);
      if (likes[v.id]) bits.push(likes[v.id] > 0 ? 'liked' : 'disliked');
      return bits.join(' | ');
    });
    return { text: lines.join('\n'), map };
  }

  /** ملخص سلوك المشاهدة لتخصيص التوصيات. */
  static buildTasteSummary(videos, userdata) {
    const hist = (userdata.history || []).slice(0, 40).map((h) => videos[h.id]).filter(Boolean);
    const ai = userdata.ai || {};
    const lines = hist.map((v) => `${v.title} (${v.channel})${ai[v.id]?.category ? ` [${ai[v.id].category}]` : ''}`);
    const subs = Object.keys(userdata.subscriptions || {})
      .map((id) => Object.values(videos).find((v) => v.channelId === id)?.channel)
      .filter(Boolean);
    return [
      subs.length ? `قنوات مشترك بها: ${subs.join('، ')}` : 'لا اشتراكات بعد.',
      lines.length ? `آخر المشاهدات (الأحدث أولاً):\n${lines.join('\n')}` : 'لا سجل مشاهدة بعد.',
    ].join('\n');
  }

  static extractJSON(text) {
    if (!text) return null;
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = fenced ? fenced[1] : text;
    const start = body.search(/[[{]/);
    if (start === -1) return null;
    const opener = body[start];
    const closer = opener === '[' ? ']' : '}';
    let depth = 0; let inStr = false; let esc = false;
    for (let i = start; i < body.length; i++) {
      const ch = body[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === opener) depth++;
      else if (ch === closer) {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(body.slice(start, i + 1)); } catch { return null; }
        }
      }
    }
    return null;
  }

  static textOf(message) {
    return (message.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
  }

  /** يحوّل إطارات (base64 JPEG) إلى كتل صور للرسالة مع تسمية زمنية لكل إطار. */
  static frameBlocks(frames) {
    const blocks = [];
    (frames || []).forEach((f, i) => {
      blocks.push({ type: 'text', text: `إطار ${i} عند ${fmtTime(f.t)}:` });
      blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: f.data } });
    });
    return blocks;
  }

  /** استدعاء عام غير متدفق. */
  async ask({ model, system, messages, maxTokens = 8000, effort = 'high' }) {
    const client = await this._getClient();
    const res = await client.messages.create({
      model: model || DEFAULT_MODEL,
      max_tokens: maxTokens,
      output_config: { effort },
      system,
      messages,
    });
    if (res.stop_reason === 'refusal') {
      const err = new Error('REFUSAL');
      err.code = 'REFUSAL';
      throw err;
    }
    return AI.textOf(res);
  }

  // ---------- الميزات ----------

  /**
   * فهم فيديو من إطاراته: عنوان، وصف، ملخص، وسوم، تصنيف، فصول، أفضل إطار للصورة المصغّرة.
   * @param {object} p { video, frames:[{t,data}], subtitles?, model, lang }
   */
  async analyzeVideo({ video, frames, subtitles = '', model, lang = 'ar' }) {
    const system = [
      'أنت محلل فيديو داخل تطبيق LiwaTube (يوتيوب خاص محلي).',
      'تستقبل إطارات مأخوذة من فيديو بطوابع زمنية، مع اسم الملف والمجلد وربما نص ترجمة، وتستنتج محتواه.',
      'لا تخترع تفاصيل لا تدعمها الإطارات أو النص؛ إن كنت غير متأكد قل ذلك في confidence منخفضة.',
      `اكتب النصوص بـ${lang === 'ar' ? 'العربية' : 'English'}.`,
      'أعد JSON فقط بلا أي شرح.',
    ].join(' ');
    const meta = [
      `اسم الملف: ${video.file}`,
      `المجلد/القناة: ${video.channel}`,
      `المدة: ${fmtTime(video.duration)}`,
      video.width ? `الأبعاد: ${video.width}x${video.height}` : '',
      video.year ? `سنة محتملة من الاسم: ${video.year}` : '',
      subtitles ? `مقتطف من الترجمة:\n${String(subtitles).slice(0, 4000)}` : '',
    ].filter(Boolean).join('\n');
    const content = [
      { type: 'text', text: `بيانات الفيديو:\n${meta}\n\nالإطارات:` },
      ...AI.frameBlocks(frames),
      {
        type: 'text',
        text: [
          'أعد كائن JSON بهذا الشكل بالضبط:',
          '{"title":"عنوان جذّاب دقيق (حتى 80 حرفًا)","description":"وصف من 2-4 جمل","summary":"جملة واحدة","tags":["وسم1","وسم2"],"category":"تصنيف واحد مثل: تعليم/ترفيه/رياضة/ألعاب/تقنية/طبخ/سفر/موسيقى/وثائقي/عائلة/عمل/أخرى","language":"ar|en|mixed|none","mood":"كلمة","audience":"general|kids|mature","chapters":[{"t":0,"label":"مقدمة"}],"bestFrame":0,"confidence":0.7}',
          `القيود: tags بين 3 و8 عناصر. chapters تبدأ بطوابع زمنية بالثواني مأخوذة من أوقات الإطارات فقط (بحد أقصى ${Math.max(2, Math.min(8, (frames || []).length))} فصول). bestFrame رقم إطار يصلح كصورة مصغّرة (واضح، غير أسود، غير مشوّش).`,
        ].join('\n'),
      },
    ];
    const text = await this.ask({
      model, system, messages: [{ role: 'user', content }], maxTokens: 4000, effort: 'medium',
    });
    const data = AI.extractJSON(text);
    if (!data || typeof data !== 'object') throw new Error('BAD_AI_RESPONSE');
    const frameTimes = (frames || []).map((f) => Number(f.t) || 0);
    const chapters = (Array.isArray(data.chapters) ? data.chapters : [])
      .map((c) => ({ t: Math.max(0, Number(c.t) || 0), label: String(c.label || '').slice(0, 60) }))
      .filter((c) => c.label)
      .sort((a, b) => a.t - b.t)
      .filter((c, i, arr) => i === 0 || c.t > arr[i - 1].t + 1)
      .slice(0, 12);
    if (chapters.length && chapters[0].t > 0) chapters.unshift({ t: 0, label: lang === 'ar' ? 'البداية' : 'Start' });
    const best = Number(data.bestFrame);
    return {
      title: String(data.title || '').slice(0, 120),
      description: String(data.description || '').slice(0, 1200),
      summary: String(data.summary || '').slice(0, 300),
      tags: (Array.isArray(data.tags) ? data.tags : []).slice(0, 8).map((t) => String(t).slice(0, 30)),
      category: String(data.category || '').slice(0, 30),
      language: String(data.language || '').slice(0, 8),
      mood: String(data.mood || '').slice(0, 24),
      audience: ['general', 'kids', 'mature'].includes(data.audience) ? data.audience : 'general',
      chapters,
      bestFrame: Number.isInteger(best) && best >= 0 && best < frameTimes.length ? best : 0,
      bestFrameAt: Number.isInteger(best) && frameTimes[best] != null ? frameTimes[best] : (frameTimes[0] || 0),
      confidence: Math.max(0, Math.min(1, Number(data.confidence) || 0)),
      frames: frameTimes.length,
      model: model || DEFAULT_MODEL,
      at: Date.now(),
    };
  }

  /** بحث دلالي بلغة طبيعية داخل المكتبة. */
  async semanticSearch({ query, videos, userdata, model, prefilter = null }) {
    const catalog = AI.buildCatalog(videos, userdata, 500, prefilter);
    const system = [
      {
        type: 'text',
        text: `أنت محرّك بحث دلالي لمكتبة فيديو محلية داخل LiwaTube.\nالفهرس (index | title | channel | duration | tags | category | summary):\n${catalog.text}`,
        cache_control: { type: 'ephemeral' },
      },
    ];
    const user = [
      `استعلام المستخدم: ${query}`,
      'أعد أفضل 30 نتيجة مرتّبة حسب الملاءمة (فقط ما يطابق فعلًا؛ يمكن أن تكون القائمة قصيرة). JSON فقط:',
      '{"results":[{"i":3,"why":"سبب قصير"}],"interpretation":"كيف فهمت الطلب"}',
    ].join('\n');
    const text = await this.ask({
      model, system, messages: [{ role: 'user', content: user }], maxTokens: 4000, effort: 'medium',
    });
    const data = AI.extractJSON(text) || {};
    const results = (data.results || [])
      .map((r) => ({ id: catalog.map[Number(r.i)], why: String(r.why || '') }))
      .filter((r) => r.id && videos[r.id]);
    return { results, interpretation: String(data.interpretation || '') };
  }

  /** توصيات شخصية «لك» مع سبب لكل اقتراح. */
  async forYou({ videos, userdata, candidates, model, size = 24 }) {
    const catalog = AI.buildCatalog(videos, userdata, 300, candidates);
    const taste = AI.buildTasteSummary(videos, userdata);
    const system = [
      {
        type: 'text',
        text: `أنت محرك توصيات داخل LiwaTube (يوتيوب خاص). تختار من مكتبة المستخدم المحلية فقط — ممنوع اختراع فيديوهات.\nالفهرس (index | title | channel | duration | tags | category | summary | plays | liked):\n${catalog.text}`,
        cache_control: { type: 'ephemeral' },
      },
    ];
    const user = [
      `ملف الذوق:\n${taste}`,
      '',
      `اختر ${size} فيديو لصفحة «لك»: وازن بين ما يشبه ما يحبه، وما لم يشاهده بعد، وشيء مفاجئ واحد أو اثنين. نوّع القنوات.`,
      'JSON فقط: {"picks":[{"i":12,"why":"سبب قصير بصيغة المخاطب"}],"note":"جملة عن ذوقه اليوم"}',
    ].join('\n');
    const text = await this.ask({ model, system, messages: [{ role: 'user', content: user }], maxTokens: 6000, effort: 'medium' });
    const data = AI.extractJSON(text) || {};
    const picks = (data.picks || [])
      .map((p) => ({ id: catalog.map[Number(p.i)], why: String(p.why || '').slice(0, 160) }))
      .filter((p) => p.id && videos[p.id]);
    return { picks, note: String(data.note || '').slice(0, 300) };
  }

  /** قائمة تشغيل ذكية من وصف بلغة طبيعية. */
  async smartPlaylist({ prompt, videos, userdata, model, size = 20 }) {
    const catalog = AI.buildCatalog(videos, userdata);
    const system = [
      {
        type: 'text',
        text: `أنت منسّق محتوى داخل LiwaTube. تختار من مكتبة المستخدم المحلية فقط — ممنوع اختراع فيديوهات.\nالفهرس:\n${catalog.text}`,
        cache_control: { type: 'ephemeral' },
      },
    ];
    const user = [
      `طلب المستخدم: ${prompt}`,
      `اختر حتى ${size} فيديو مناسبًا ورتّبها ترتيبًا منطقيًا للمشاهدة.`,
      'JSON فقط: {"name":"اسم القائمة","description":"سطر يشرح الفكرة","picks":[{"i":12,"why":"سبب"}]}',
    ].join('\n');
    const text = await this.ask({ model, system, messages: [{ role: 'user', content: user }], maxTokens: 6000 });
    const data = AI.extractJSON(text);
    if (!data || !Array.isArray(data.picks)) throw new Error('BAD_AI_RESPONSE');
    const picks = data.picks
      .map((p) => ({ id: catalog.map[Number(p.i)], why: String(p.why || '') }))
      .filter((p) => p.id && videos[p.id]);
    return {
      name: String(data.name || 'قائمة ذكية').slice(0, 80),
      description: String(data.description || '').slice(0, 300),
      picks,
    };
  }

  /**
   * محادثة عن فيديو معيّن (متدفقة). تستخدم التحليل السابق والإطارات إن وُجدت.
   * @param {function} onDelta يستقبل كل مقطع نصي فور وصوله
   */
  async askVideo({ video, analysis, frames, subtitles = '', history = [], question, lang = 'ar', model, onDelta }) {
    const client = await this._getClient();
    const ctx = [
      `العنوان: ${analysis?.title || video.title}`,
      `القناة/المجلد: ${video.channel}`,
      `المدة: ${fmtTime(video.duration)}`,
      analysis?.description ? `الوصف: ${analysis.description}` : '',
      analysis?.chapters?.length ? `الفصول: ${analysis.chapters.map((c) => `${fmtTime(c.t)} ${c.label}`).join(' • ')}` : '',
      analysis?.tags?.length ? `الوسوم: ${analysis.tags.join('، ')}` : '',
      subtitles ? `مقتطف من الترجمة:\n${String(subtitles).slice(0, 6000)}` : '',
    ].filter(Boolean).join('\n');
    const system = [
      {
        type: 'text',
        text: [
          lang === 'ar'
            ? 'أنت مساعد مشاهدة داخل LiwaTube. تجيب عن أسئلة المستخدم حول فيديو من مكتبته بإيجاز ودقة، وتذكر الطابع الزمني (م:ث) عندما تشير إلى لحظة معيّنة.'
            : 'You are a watch assistant inside LiwaTube. Answer questions about a video from the user\'s library concisely and precisely; cite timestamps (m:ss) when referring to moments.',
          'لا تخترع ما لا تراه في الإطارات أو النص. إن كان السؤال خارج الفيديو فقل ذلك.',
          `سياق الفيديو:\n${ctx}`,
        ].join('\n'),
        cache_control: { type: 'ephemeral' },
      },
    ];
    const messages = [];
    const first = [];
    if (frames && frames.length) first.push({ type: 'text', text: 'إطارات من الفيديو:' }, ...AI.frameBlocks(frames));
    const past = (history || []).slice(-10);
    if (past.length) {
      // أول رسالة مستخدم تحمل الإطارات، ثم بقية المحادثة
      const [h0, ...rest] = past;
      messages.push({ role: 'user', content: [...first, { type: 'text', text: h0.content }] });
      for (const h of rest) messages.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content });
      messages.push({ role: 'user', content: question });
    } else {
      messages.push({ role: 'user', content: [...first, { type: 'text', text: question }] });
    }
    const stream = client.messages.stream({
      model: model || DEFAULT_MODEL,
      max_tokens: 2000,
      output_config: { effort: 'medium' },
      system,
      messages,
    });
    if (typeof onDelta === 'function') stream.on('text', (delta) => onDelta(delta));
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      const err = new Error('REFUSAL');
      err.code = 'REFUSAL';
      throw err;
    }
    return AI.textOf(final);
  }

  /** تقرير رؤى عن المكتبة وعادات المشاهدة. */
  async insights({ videos, userdata, model, lang = 'ar' }) {
    const catalog = AI.buildCatalog(videos, userdata, 300);
    const all = Object.values(videos);
    const stats = {
      عدد_الفيديوهات: all.length,
      عدد_القنوات: new Set(all.map((v) => v.channelId)).size,
      ساعات: Math.round(all.reduce((a, v) => a + (v.duration || 0), 0) / 360) / 10,
      مشاهدات: Object.values(userdata.playCount || {}).reduce((a, b) => a + b, 0),
      محلّلة_بالذكاء: Object.keys(userdata.ai || {}).length,
    };
    const system = lang === 'ar'
      ? 'أنت محلل عادات مشاهدة داخل LiwaTube. تكتب بالعربية بإيجاز وبلا مجاملات.'
      : 'You analyze viewing habits inside LiwaTube. Write concisely in English, no flattery.';
    const user = [
      `إحصاءات: ${JSON.stringify(stats)}`,
      AI.buildTasteSummary(videos, userdata),
      `عيّنة من المكتبة:\n${catalog.text}`,
      '',
      'اكتب تقريرًا قصيرًا (Markdown) يشمل: ملامح الذوق، القنوات والتصنيفات الغالبة، ما لم يُشاهد بعد ويستحق،',
      'و5 اقتراحات عملية (قوائم مقترحة، تنظيم، أو ما يمكن حذفه). لا تخترع فيديوهات غير موجودة.',
    ].join('\n');
    return this.ask({ model, system, messages: [{ role: 'user', content: user }], maxTokens: 4000 });
  }
}

module.exports = { AI, MODELS, DEFAULT_MODEL, fmtTime };
