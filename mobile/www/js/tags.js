/* LiwaMusic للهاتف — قارئ وسوم ID3v2 مصغّر يعمل على مقطع من أول الملف.
   يكفي لاستخراج العنوان والفنان والألبوم والغلاف من ملفات MP3 بلا تنزيلها كاملة.
   تم إنشاؤه عن طريق LiwaMusic. */
'use strict';

const dec = (bytes, enc) => {
  try {
    if (enc === 0) return new TextDecoder('windows-1256').decode(bytes); // يدعم العربية في الوسوم القديمة
    if (enc === 1) return new TextDecoder('utf-16').decode(bytes);
    if (enc === 2) return new TextDecoder('utf-16be').decode(bytes);
    return new TextDecoder('utf-8').decode(bytes);
  } catch { return ''; }
};

const clean = (s) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();

function syncsafe(b, o) { return (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3]; }
function uint32(b, o) { return (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]; }

/**
 * يحلّل وسوم ID3v2 من بداية الملف.
 * @param {ArrayBuffer|Uint8Array} buffer أول مقطع من الملف (512KB يكفي عادة)
 * @returns {object|null} { title, artist, album, genre, year, trackNo, picture: {blob, mime} }
 */
export function parseID3(buffer) {
  const b = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (b.length < 20) return null;
  if (b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return null; // "ID3"
  const major = b[3];
  if (major < 2 || major > 4) return null;
  const flags = b[5];
  const size = syncsafe(b, 6);
  let off = 10;
  if (flags & 0x40) {                       // ترويسة ممتدة
    const extSize = major === 4 ? syncsafe(b, off) : uint32(b, off) + 4;
    off += Math.max(6, extSize);
  }
  const end = Math.min(b.length, 10 + size);
  const out = {};
  const headerLen = major === 2 ? 6 : 10;

  while (off + headerLen <= end) {
    const id = String.fromCharCode(...b.slice(off, off + (major === 2 ? 3 : 4)));
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    let frameSize;
    if (major === 2) frameSize = (b[off + 3] << 16) | (b[off + 4] << 8) | b[off + 5];
    else if (major === 4) frameSize = syncsafe(b, off + 4);
    else frameSize = uint32(b, off + 4);
    const dataStart = off + headerLen;
    if (frameSize <= 0 || dataStart + frameSize > b.length) break;
    const data = b.slice(dataStart, dataStart + frameSize);

    const textFrame = { TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TALB: 'album', TAL: 'album', TCON: 'genre', TCO: 'genre', TYER: 'year', TYE: 'year', TDRC: 'year', TRCK: 'trackNo', TRK: 'trackNo', TPE2: 'albumArtist' }[id];
    if (textFrame) {
      const value = clean(dec(data.slice(1), data[0]));
      if (value) {
        if (textFrame === 'year') out.year = parseInt(value.slice(0, 4), 10) || 0;
        else if (textFrame === 'trackNo') out.trackNo = parseInt(value, 10) || 0;
        else out[textFrame] = value;
      }
    } else if ((id === 'APIC' || id === 'PIC') && !out.picture) {
      try {
        let p = 1;                                    // بعد بايت الترميز
        let mime = 'image/jpeg';
        if (id === 'APIC') {
          let e = p;
          while (e < data.length && data[e] !== 0) e++;
          mime = String.fromCharCode(...data.slice(p, e)) || 'image/jpeg';
          p = e + 1;
        } else {
          p = 1 + 3;                                  // ID3v2.2: نوع الصورة بثلاثة محارف
        }
        p += 1;                                       // نوع الصورة (غلاف أمامي…)
        // تخطّي الوصف حسب الترميز
        if (data[0] === 1 || data[0] === 2) {
          while (p + 1 < data.length && !(data[p] === 0 && data[p + 1] === 0)) p += 2;
          p += 2;
        } else {
          while (p < data.length && data[p] !== 0) p++;
          p += 1;
        }
        const bytes = data.slice(p);
        if (bytes.length > 200) out.picture = { bytes, mime };
      } catch { /* غلاف تالف — نتجاهله */ }
    }
    off = dataStart + frameSize;
  }
  return Object.keys(out).length ? out : null;
}
