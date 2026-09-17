'use strict';
/**
 * LiwaTube — تخزين محلي بسيط (JSON) مع كتابة مؤجّلة وآمنة.
 * تم إنشاؤه عن طريق LiwaMusic.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const DEFAULTS = {
  'library.json': { version: 1, folders: [], videos: {} },
  'userdata.json': {
    version: 1,
    likes: {},         // id -> 1 (إعجاب) | -1 (عدم إعجاب)
    likedAt: {},       // id -> ms
    watchLater: [],    // [id] الأحدث أولاً
    progress: {},      // id -> { pos, dur, at }
    playCount: {},     // id -> number
    lastPlayed: {},    // id -> ms
    history: [],       // [{ id, at }] الأحدث أولاً
    subscriptions: {}, // channelId -> { at }
    hidden: {},        // id -> true (لا يظهر في التوصيات)
    ai: {},            // id -> تحليل الذكاء الاصطناعي
    overrides: {},     // id -> { title, description, tags[], channel, at }
    thumbAt: {},       // id -> ms (وقت الإطار المختار للصورة المصغّرة)
    comments: {},      // id -> [{ id, text, at }] ملاحظات/تعليقات خاصة
    notInterested: {}, // channelId -> true
  },
  'playlists.json': { version: 1, items: [] }, // [{id,name,description,videos[],createdAt,updatedAt,ai}]
  'settings.json': {
    version: 1,
    lang: 'ar',
    theme: 'dark',
    accent: 'red',
    autoplay: true,
    rate: 1,
    volume: 1,
    muted: false,
    hoverPreview: true,
    captions: true,
    resume: true,
    channelMode: 'parent',   // parent | root — من أي مجلد يُشتق اسم القناة
    shortsMax: 60,           // ثوانٍ — أقصى مدة لاعتبار الفيديو «Short»
    watchFolders: true,
    aiEnabled: false,        // مغلق افتراضيًا — يتطلب مفتاح API مدفوعًا
    aiModel: 'claude-opus-5',
    aiAutoAnalyze: false,    // تحليل الفيديوهات الجديدة تلقائيًا
    aiFrames: 8,             // عدد الإطارات المرسلة للتحليل
    aiKeySet: false,
    lockEnabled: false,
    lockIdleMinutes: 0,      // 0 = لا يقفل عند الخمول
    shareAutoStart: false,   // تشغيل خادم المشاركة عند فتح التطبيق
    sharePort: 8787,
    sharePassword: '',       // كلمة مرور المشرف في خادم المشاركة (تُولَّد تلقائيًا)
    shareTunnelAuto: false,  // فتح نفق الإنترنت تلقائيًا مع المشاركة
    lastView: 'home',
    lastVideoId: null,
    sidebarCollapsed: false,
  },
};

class Store {
  constructor(dir) {
    this.dir = dir;
    this.cache = new Map();
    this.timers = new Map();
    fs.mkdirSync(dir, { recursive: true });
  }

  _file(name) { return path.join(this.dir, name); }

  read(name) {
    if (this.cache.has(name)) return this.cache.get(name);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(this._file(name), 'utf8'));
    } catch {
      data = null;
    }
    const base = DEFAULTS[name] ? JSON.parse(JSON.stringify(DEFAULTS[name])) : {};
    const merged = data && typeof data === 'object' ? Object.assign(base, data) : base;
    this.cache.set(name, merged);
    return merged;
  }

  write(name, data) {
    if (data) this.cache.set(name, data);
    if (this.timers.has(name)) clearTimeout(this.timers.get(name));
    this.timers.set(name, setTimeout(() => this.flush(name), 250));
  }

  async flush(name) {
    if (this.timers.has(name)) { clearTimeout(this.timers.get(name)); this.timers.delete(name); }
    const data = this.cache.get(name);
    if (!data) return;
    const target = this._file(name);
    const tmp = `${target}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(data), 'utf8');
    await fsp.rename(tmp, target);
  }

  async flushAll() {
    for (const name of this.cache.keys()) await this.flush(name);
  }
}

module.exports = { Store, DEFAULTS };
