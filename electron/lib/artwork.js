'use strict';
/**
 * LiwaMusic — إدارة أغلفة الأغاني: تعيين غلاف مخصّص لأغنية واحدة أو لمجموعة
 * دفعة واحدة، من ملف على الجهاز أو من رابط، مع تصغير الصورة وتوحيد صيغتها.
 */
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const MAGIC = [
  { ext: 'jpg', mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { ext: 'png', mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { ext: 'gif', mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { ext: 'bmp', mime: 'image/bmp', bytes: [0x42, 0x4d] },
];

/** يتعرّف على نوع الصورة من أول بايتاتها (لا نثق بالامتداد). */
function detectImage(buf) {
  if (!buf || buf.length < 12) return null;
  for (const sig of MAGIC) {
    if (sig.bytes.every((b, i) => buf[i] === b)) return sig;
  }
  // WEBP: "RIFF" .... "WEBP"
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}

class Artwork {
  /**
   * @param {object} opts { artDir, nativeImage } — nativeImage اختياري (من Electron) للتصغير
   */
  constructor({ artDir, nativeImage = null, maxSize = 640 }) {
    this.artDir = artDir;
    this.nativeImage = nativeImage;
    this.maxSize = maxSize;
  }

  /** يحوّل الصورة إلى JPEG مربّع الحجم المعقول ويحفظها، ويعيد اسم الملف. */
  async store(buffer, keyHint = '') {
    const kind = detectImage(buffer);
    if (!kind) throw new Error('NOT_AN_IMAGE');
    await fsp.mkdir(this.artDir, { recursive: true });

    let out = buffer;
    let ext = kind.ext;
    if (this.nativeImage) {
      try {
        let img = this.nativeImage.createFromBuffer(buffer);
        if (!img.isEmpty()) {
          const { width, height } = img.getSize();
          const longest = Math.max(width, height);
          if (longest > this.maxSize) {
            img = img.resize({
              width: Math.round((width / longest) * this.maxSize),
              height: Math.round((height / longest) * this.maxSize),
              quality: 'good',
            });
          }
          out = img.toJPEG(88);
          ext = 'jpg';
        }
      } catch { /* نُبقي الأصل كما هو */ }
    }

    const name = `custom_${crypto.createHash('sha1').update(out).update(String(keyHint)).digest('hex').slice(0, 24)}.${ext}`;
    await fsp.writeFile(path.join(this.artDir, name), out);
    return name;
  }

  async fromFile(filePath, keyHint = '') {
    const buf = await fsp.readFile(filePath);
    if (buf.length > 25 * 1024 * 1024) throw new Error('IMAGE_TOO_LARGE');
    return this.store(buf, keyHint);
  }

  async fromUrl(url, keyHint = '') {
    if (!/^https?:\/\//i.test(String(url))) throw new Error('BAD_URL');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'LiwaMusic/1.1.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return await this.store(buf, keyHint);
    } finally { clearTimeout(timer); }
  }

  /** يحذف ملف غلاف مخصّص لم يعد مستخدمًا. */
  async remove(name) {
    if (!name || !name.startsWith('custom_')) return false;
    await fsp.rm(path.join(this.artDir, path.basename(name)), { force: true }).catch(() => {});
    return true;
  }

  /**
   * يحدّد الأغاني المستهدفة بالتغيير الجماعي.
   * @param {object} opts { scope, track, tracks } — scope: track | album | artist | selection | filtered
   */
  static targets({ scope, track, tracks, selection = [], filtered = [] }) {
    const all = Object.values(tracks || {});
    switch (scope) {
      case 'album':
        if (!track) return [];
        return all.filter((t) => (t.album || '') === (track.album || '')
          && ((t.albumArtist || t.artist || '') === (track.albumArtist || track.artist || '')))
          .map((t) => t.id);
      case 'artist':
        if (!track) return [];
        return all.filter((t) => (t.artist || '') === (track.artist || '')
          || (t.albumArtist || '') === (track.albumArtist || '')).map((t) => t.id);
      case 'selection':
        return [...selection];
      case 'filtered':
        return [...filtered];
      case 'track':
      default:
        return track ? [track.id] : [];
    }
  }
}

module.exports = { Artwork, detectImage };
