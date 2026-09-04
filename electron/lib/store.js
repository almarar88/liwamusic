'use strict';
/**
 * LiwaMusic — تخزين محلي بسيط (JSON) مع كتابة مؤجّلة وآمنة.
 * تم إنشاؤه عن طريق LiwaMusic.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const DEFAULTS = {
  'library.json': { version: 1, folders: [], tracks: {} },
  'userdata.json': {
    version: 1,
    favorites: {},   // id -> true
    ratings: {},     // id -> 0..5
    playCount: {},   // id -> number
    lastPlayed: {},  // id -> ms
    ai: {},          // id -> { mood, energy, genres[], tags[], summary, at }
    overrides: {},   // id -> { title, artist, album, genre, year, at }
    artOverrides: {},// id -> { art, at }  غلاف مخصّص يتقدّم على المضمّن
    favAt: {},       // id -> ms  (طوابع للمزامنة)
    ratedAt: {},     // id -> ms
    history: [],     // [{ id, at }] الأحدث أولاً
  },
  'playlists.json': { version: 1, items: [], deleted: {} }, // [{id,name,description,tracks[],createdAt,updatedAt,ai}]
  'settings.json': {
    version: 1,
    lang: 'ar',
    theme: 'dark',
    accent: 'violet',
    dynamicColor: true,
    volume: 0.9,
    muted: false,
    shuffle: false,
    repeat: 'off',           // off | all | one
    crossfade: 0,            // ثوانٍ 0..12
    normalize: false,
    rate: 1,
    eqEnabled: false,
    eqPreamp: 0,
    eqPreset: 'flat',
    eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    visualizer: 'bars',      // bars | wave | off
    onlineArt: true,
    onlineLyrics: true,
    onlineMeta: false,
    watchFolders: true,
    sleepMinutes: 0,
    // Google Drive
    driveFolders: [],        // [{id, name}]
    driveSync: true,         // مزامنة المكتبة والتقييمات عبر ملف مخفي في درايف
    syncMinutes: 15,
    lastSyncAt: 0,
    drivePrefetch: true,     // تحميل الأغنية التالية مسبقًا عند التشغيل من درايف
    aiEnabled: false,        // مغلق افتراضيًا — يتطلب مفتاح API مدفوع
    aiModel: 'claude-opus-5',
    aiKeySet: false,
    lastTrackId: null,
    lastPosition: 0,
    lastView: 'tracks',
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
