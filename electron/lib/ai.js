'use strict';
/**
 * LiwaMusic — طبقة الذكاء الاصطناعي (Claude).
 * المفتاح يوفّره المستخدم ويُخزَّن مشفّرًا عبر safeStorage من ويندوز.
 * كل الاستدعاءات تتم في العملية الرئيسية — لا يصل المفتاح إلى الواجهة أبدًا.
 */
const fs = require('fs');
const path = require('path');

const MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5 — الأدق' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — متوازن' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — الأسرع' },
];
const DEFAULT_MODEL = 'claude-opus-5';

class AI {
  /**
   * @param {object} opts { dir, safeStorage }
   */
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
  static buildCatalog(tracks, userdata = {}, limit = 600) {
    const ai = userdata.ai || {};
    const fav = userdata.favorites || {};
    const plays = userdata.playCount || {};
    const list = Object.values(tracks);
    // أولوية: المفضلة، الأكثر تشغيلاً، ثم عيّنة موزّعة من الباقي
    const scored = list.map((t) => ({
      t,
      score: (fav[t.id] ? 1000 : 0) + Math.min(500, (plays[t.id] || 0) * 20),
    }));
    scored.sort((a, b) => b.score - a.score);
    const head = scored.slice(0, Math.min(limit, scored.length)).map((s) => s.t);
    let chosen = head;
    if (list.length > limit) {
      const keep = new Set(head.slice(0, Math.floor(limit / 2)).map((t) => t.id));
      const rest = list.filter((t) => !keep.has(t.id));
      const step = Math.max(1, Math.floor(rest.length / Math.max(1, limit - keep.size)));
      const sample = [];
      for (let i = 0; i < rest.length && sample.length < limit - keep.size; i += step) sample.push(rest[i]);
      chosen = [...head.slice(0, Math.floor(limit / 2)), ...sample];
    }
    const map = [];
    const lines = chosen.map((t, i) => {
      map.push(t.id);
      const meta = ai[t.id] || {};
      const bits = [
        `${i}`,
        t.title || t.file,
        t.artist || '—',
        t.album || '—',
        t.genre || meta.genres?.[0] || '—',
        t.year || '—',
        `${Math.round(t.duration || 0)}s`,
      ];
      if (meta.mood) bits.push(`mood:${meta.mood}`);
      if (meta.energy != null) bits.push(`energy:${meta.energy}`);
      return bits.join(' | ');
    });
    return { text: lines.join('\n'), map };
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

  /** وسم ذكي للمزاج والطاقة والأنواع لمجموعة أغانٍ. */
  async tagTracks({ tracks, model }) {
    const rows = tracks.map((t, i) => `${i} | ${t.title} | ${t.artist || '—'} | ${t.album || '—'} | ${t.genre || '—'} | ${t.year || '—'}`);
    const system = [
      'أنت محلل موسيقي خبير داخل تطبيق LiwaMusic.',
      'تستقبل قائمة أغانٍ ببياناتها الوصفية وتستنتج لكل أغنية: المزاج، الطاقة، الأنواع، وكلمات مفتاحية.',
      'اعتمد على معرفتك بالفنان والألبوم والنوع. إن كنت غير متأكد ضع "unknown" في mood واجعل confidence منخفضة.',
      'أعد JSON فقط بلا أي شرح.',
    ].join(' ');
    const prompt = [
      'الأغاني (index | title | artist | album | genre | year):',
      rows.join('\n'),
      '',
      'أعد مصفوفة JSON بهذا الشكل بالضبط:',
      '[{"i":0,"mood":"هادئ","energy":0.3,"genres":["pop"],"tags":["مذاكرة","ليلي"],"summary":"جملة قصيرة بالعربية","confidence":0.7}]',
      'القيم: mood كلمة عربية واحدة، energy رقم بين 0 و1، genres وtags بحد أقصى 4 عناصر.',
    ].join('\n');
    const text = await this.ask({
      model,
      system,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 8000,
      effort: 'low',
    });
    const data = AI.extractJSON(text);
    if (!Array.isArray(data)) throw new Error('BAD_AI_RESPONSE');
    const out = {};
    for (const row of data) {
      const t = tracks[Number(row.i)];
      if (!t) continue;
      out[t.id] = {
        mood: String(row.mood || '').slice(0, 24),
        energy: Math.max(0, Math.min(1, Number(row.energy) || 0)),
        genres: (row.genres || []).slice(0, 4).map(String),
        tags: (row.tags || []).slice(0, 4).map(String),
        summary: String(row.summary || '').slice(0, 240),
        confidence: Math.max(0, Math.min(1, Number(row.confidence) || 0)),
        at: Date.now(),
      };
    }
    return out;
  }

  /** قائمة تشغيل ذكية من وصف بلغة طبيعية. */
  async smartPlaylist({ prompt, tracks, userdata, model, size = 25 }) {
    const catalog = AI.buildCatalog(tracks, userdata);
    const system = [
      {
        type: 'text',
        text: [
          'أنت منسّق موسيقي (DJ) داخل تطبيق LiwaMusic.',
          'تختار من مكتبة المستخدم المحلية فقط — ممنوع اختراع أغانٍ غير موجودة في الفهرس.',
          'الفهرس (index | title | artist | album | genre | year | duration):',
          catalog.text,
        ].join('\n'),
        cache_control: { type: 'ephemeral' },
      },
    ];
    const user = [
      `طلب المستخدم: ${prompt}`,
      `اختر حتى ${size} أغنية مناسبة، ورتّبها ترتيبًا يبني تدرّجًا موسيقيًا منطقيًا.`,
      'أعد JSON فقط:',
      '{"name":"اسم القائمة","description":"سطر يشرح الفكرة","reason":"لماذا هذا الترتيب","picks":[{"i":12,"why":"سبب مختصر"}]}',
    ].join('\n');
    const text = await this.ask({
      model, system, messages: [{ role: 'user', content: user }], maxTokens: 8000,
    });
    const data = AI.extractJSON(text);
    if (!data || !Array.isArray(data.picks)) throw new Error('BAD_AI_RESPONSE');
    const picks = data.picks
      .map((p) => ({ id: catalog.map[Number(p.i)], why: String(p.why || '') }))
      .filter((p) => p.id && tracks[p.id]);
    return {
      name: String(data.name || 'قائمة ذكية').slice(0, 80),
      description: String(data.description || '').slice(0, 300),
      reason: String(data.reason || '').slice(0, 600),
      picks,
    };
  }

  /** بحث دلالي بلغة طبيعية داخل المكتبة. */
  async semanticSearch({ query, tracks, userdata, model }) {
    const catalog = AI.buildCatalog(tracks, userdata);
    const system = [
      {
        type: 'text',
        text: `أنت محرّك بحث دلالي لمكتبة موسيقى محلية داخل LiwaMusic.\nالفهرس:\n${catalog.text}`,
        cache_control: { type: 'ephemeral' },
      },
    ];
    const user = [
      `استعلام المستخدم: ${query}`,
      'أعد أفضل 30 نتيجة مرتّبة حسب الملاءمة. JSON فقط:',
      '{"results":[{"i":3,"why":"سبب"}],"interpretation":"كيف فهمت الطلب"}',
    ].join('\n');
    const text = await this.ask({
      model, system, messages: [{ role: 'user', content: user }], maxTokens: 4000, effort: 'medium',
    });
    const data = AI.extractJSON(text) || {};
    const results = (data.results || [])
      .map((r) => ({ id: catalog.map[Number(r.i)], why: String(r.why || '') }))
      .filter((r) => r.id && tracks[r.id]);
    return { results, interpretation: String(data.interpretation || '') };
  }

  /** راديو مشابه: يبني قائمة تشبه أغنية معيّنة. */
  async similarRadio({ seed, tracks, userdata, model, size = 20 }) {
    const catalog = AI.buildCatalog(tracks, userdata);
    const system = [
      {
        type: 'text',
        text: `أنت منسّق موسيقي داخل LiwaMusic. الفهرس المتاح:\n${catalog.text}`,
        cache_control: { type: 'ephemeral' },
      },
    ];
    const user = [
      `الأغنية المرجعية: ${seed.title} — ${seed.artist || 'غير معروف'} (${seed.album || '—'}, ${seed.genre || '—'}, ${seed.year || '—'})`,
      `اختر ${size} أغنية من الفهرس تشبهها في الأجواء والطاقة والنوع، مع تنويع الفنانين.`,
      'JSON فقط: {"picks":[{"i":5,"why":"سبب"}]}',
    ].join('\n');
    const text = await this.ask({
      model, system, messages: [{ role: 'user', content: user }], maxTokens: 4000, effort: 'medium',
    });
    const data = AI.extractJSON(text) || {};
    return (data.picks || [])
      .map((p) => ({ id: catalog.map[Number(p.i)], why: String(p.why || '') }))
      .filter((p) => p.id && tracks[p.id] && p.id !== seed.id);
  }

  /** تقرير رؤى عن المكتبة. */
  async insights({ tracks, userdata, model }) {
    const catalog = AI.buildCatalog(tracks, userdata, 400);
    const all = Object.values(tracks);
    const stats = {
      عدد_الأغاني: all.length,
      عدد_الفنانين: new Set(all.map((t) => t.artist).filter(Boolean)).size,
      عدد_الألبومات: new Set(all.map((t) => t.album).filter(Boolean)).size,
      ساعات: Math.round(all.reduce((a, t) => a + (t.duration || 0), 0) / 360) / 10,
    };
    const system = 'أنت محلل ذوق موسيقي داخل تطبيق LiwaMusic. تكتب بالعربية بإيجاز وبلا مجاملات.';
    const user = [
      `إحصاءات: ${JSON.stringify(stats)}`,
      `عيّنة من المكتبة:\n${catalog.text}`,
      '',
      'اكتب تقريرًا قصيرًا (Markdown) يشمل: ملامح الذوق، الأنواع الغالبة، الفجوات في المكتبة،',
      'و5 اقتراحات عملية لتنظيم أفضل أو اكتشافات مقترحة. لا تخترع أغانٍ غير موجودة عند الحديث عن المكتبة.',
    ].join('\n');
    return this.ask({ model, system, messages: [{ role: 'user', content: user }], maxTokens: 4000 });
  }

  /**
   * مقدّمة «مذيع» متدفقة بين الأغاني.
   * @param {function} onDelta يستقبل كل مقطع نصي فور وصوله
   */
  async djIntro({ track, previous, lang = 'ar', model, onDelta }) {
    const client = await this._getClient();
    const system = lang === 'ar'
      ? 'أنت مذيع راديو عربي داخل تطبيق LiwaMusic. جملتان كحد أقصى، بأسلوب دافئ وبلا مبالغة. لا تخترع حقائق عن الفنان؛ إن لم تعرفه تحدّث عن الأجواء فقط.'
      : 'You are a radio host inside LiwaMusic. Two sentences max, warm and understated. Never invent facts about the artist.';
    const user = [
      previous ? `الأغنية السابقة: ${previous.title} — ${previous.artist || '—'}` : 'بداية الجلسة.',
      `الأغنية القادمة: ${track.title} — ${track.artist || '—'} (${track.album || '—'}, ${track.year || '—'}, ${track.genre || '—'})`,
      'قدّم الانتقال.',
    ].join('\n');
    const stream = client.messages.stream({
      model: model || DEFAULT_MODEL,
      max_tokens: 400,
      output_config: { effort: 'low' },
      system,
      messages: [{ role: 'user', content: user }],
    });
    if (typeof onDelta === 'function') {
      stream.on('text', (delta) => onDelta(delta));
    }
    const final = await stream.finalMessage();
    return AI.textOf(final);
  }
}

module.exports = { AI, MODELS, DEFAULT_MODEL };
