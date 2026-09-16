#!/usr/bin/env node
'use strict';
/**
 * LiwaTube Server — خادم «يوتيوبك الخاص»: المشرف يرفع المقاطع من لوحة التحكم،
 * والجميع يشاهد عبر المتصفح أو تطبيق الهاتف/التلفاز (APK).
 * بلا اعتماديات خارجية سوى SDK الذكاء الاصطناعي الاختياري. تم إنشاؤه عن طريق LiwaMusic.
 *
 * التشغيل:  node server/server.js   (PORT=8787  LIWATUBE_DATA=./server-data  LIWATUBE_ADMIN_PASSWORD=...)
 */
const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');

const scanner = require('../electron/lib/scanner');
const subtitles = require('../electron/lib/subtitles');
const lock = require('../electron/lib/lock');
const { parseRange, MIME } = require('../electron/lib/filestream');
const { AI, MODELS, DEFAULT_MODEL } = require('../electron/lib/ai');

const ROOT = path.resolve(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const CREATOR = 'تم إنشاؤه عن طريق LiwaMusic';
const VIDEO_EXT = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.ogv']);
const MAX_JSON = 40 * 1024 * 1024;

// ————————————————————————————————— قاعدة البيانات (JSON)

class DB {
  constructor(dataDir) {
    this.dir = dataDir;
    this.file = path.join(dataDir, 'db.json');
    for (const d of ['videos', 'thumbs', 'subs', 'tmp']) fs.mkdirSync(path.join(dataDir, d), { recursive: true });
    let data = null;
    try { data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* أول تشغيل */ }
    this.data = Object.assign({
      version: 1,
      videos: {},
      comments: {},
      likes: {},     // id -> { device: 1|-1 }
      views: {},     // id -> { device: lastAt }
      settings: { siteName: 'LiwaTube', aiEnabled: false, aiPublic: false, aiModel: DEFAULT_MODEL, allowComments: true, welcome: '' },
      admin: null,   // { salt, hash }
      secret: crypto.randomBytes(32).toString('hex'),
    }, data || {});
    if (!this.data.settings.aiModel) this.data.settings.aiModel = DEFAULT_MODEL;
    this.timer = null;
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush().catch(() => {}), 200);
  }

  async flush() {
    clearTimeout(this.timer);
    const tmp = `${this.file}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(this.data), 'utf8');
    await fsp.rename(tmp, this.file);
  }

  videoPath(v) { return path.join(this.dir, 'videos', `${v.id}.${v.ext}`); }
  thumbPath(v) { return path.join(this.dir, 'thumbs', `${v.id}.jpg`); }
  subPath(v, i) { return path.join(this.dir, 'subs', `${v.id}.${i}.vtt`); }
}

// ————————————————————————————————— أدوات

const newId = () => crypto.randomBytes(10).toString('hex');
const b64u = (s) => Buffer.from(s).toString('base64url');
const json = (res, status, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
};
const err = (res, status, message, code) => json(res, status, { ok: false, error: message, code: code || message });
const ok = (res, data) => json(res, 200, { ok: true, data: data === undefined ? null : data });

function readBody(req, limit = MAX_JSON) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('PAYLOAD_TOO_LARGE')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJSON(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new Error('BAD_JSON'); }
}

/** يبث ملفًا مع دعم Range (ضروري للتقديم والتأخير في الفيديو). */
async function streamFile(req, res, filePath, mime) {
  let st;
  try { st = await fsp.stat(filePath); } catch { return err(res, 404, 'NOT_FOUND'); }
  if (!st.isFile()) return err(res, 404, 'NOT_FOUND');
  const headers = {
    'Content-Type': mime || MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': mime === 'image/jpeg' ? 'public, max-age=86400' : 'no-cache',
    'Last-Modified': st.mtime.toUTCString(),
  };
  const range = parseRange(req.headers.range, st.size);
  if (range === 'invalid') { res.writeHead(416, { ...headers, 'Content-Range': `bytes */${st.size}` }); return res.end(); }
  if (req.method === 'HEAD') { res.writeHead(200, { ...headers, 'Content-Length': String(st.size) }); return res.end(); }
  if (range) {
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${range.start}-${range.end}/${st.size}`, 'Content-Length': String(range.end - range.start + 1) });
    return pipeline(fs.createReadStream(filePath, { start: range.start, end: range.end }), res).catch(() => {});
  }
  res.writeHead(200, { ...headers, 'Content-Length': String(st.size) });
  return pipeline(fs.createReadStream(filePath), res).catch(() => {});
}

// ————————————————————————————————— الخادم

class LiwaTubeServer {
  /**
   * @param {object} opts
   *  external: مزوّد اختياري لمكتبة خارجية (مثل مكتبة LiwaTube Desktop) بلا رفع:
   *    { videos: () => ({ id: { id, path, title, channel, channelId, description, tags, duration, width, height, thumbPath, addedAt, size, ext, ai } }),
   *      update: async (id, patch) => void, subtitlesFor: async (id) => [{ path, lang, label }] }
   */
  constructor({ dataDir, port = 8787, host = '0.0.0.0', adminPassword = null, log = console.log, external = null } = {}) {
    this.dataDir = path.resolve(dataDir || process.env.LIWATUBE_DATA || path.join(ROOT, 'server-data'));
    this.port = port; this.host = host; this.log = log; this.external = external;
    this.db = new DB(this.dataDir);
    if (!this.db.data.extMeta) this.db.data.extMeta = {}; // id -> { views, hidden } للمكتبة الخارجية
    if (adminPassword && !this.db.data.admin) { this.db.data.admin = lock.hashPin(adminPassword); this.db.save(); }
    this.ai = new AI({ dir: this.dataDir, safeStorage: null });
    this.loginAttempts = new Map();
    this.server = http.createServer((req, res) => this.handle(req, res).catch((e) => {
      if (!res.headersSent) err(res, e.message === 'PAYLOAD_TOO_LARGE' ? 413 : e.message === 'BAD_JSON' ? 400 : 500, e.message || 'ERROR', e.code);
      else res.end();
    }));
  }

  /** يضبط كلمة مرور المشرف مباشرة (يستخدمه التطبيق المضمِّن). */
  setAdminPassword(password) {
    if (!password) return false;
    this.db.data.admin = lock.hashPin(String(password));
    this.db.save();
    return true;
  }

  listen() {
    return new Promise((resolve) => this.server.listen(this.port, this.host, () => { this.port = this.server.address().port; this.log(`LiwaTube server: http://localhost:${this.port}  (data: ${this.dataDir})`); resolve(this); }));
  }
  async close() { await this.db.flush(); await new Promise((r) => this.server.close(r)); }

  // ---------- المصادقة
  sign(payload) {
    const body = b64u(JSON.stringify(payload));
    const sig = crypto.createHmac('sha256', this.db.data.secret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }
  verify(token) {
    if (!token || !token.includes('.')) return null;
    const [body, sig] = token.split('.');
    const want = crypto.createHmac('sha256', this.db.data.secret).update(body).digest('base64url');
    if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
    try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  }
  isAdmin(req) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : (new URL(req.url, 'http://x').searchParams.get('token') || '');
    const p = this.verify(token);
    return Boolean(p && p.admin && p.v === (this.db.data.admin && this.db.data.admin.hash.slice(0, 8)));
  }
  device(req) { return String(req.headers['x-device'] || '').slice(0, 64) || 'anon'; }

  // ---------- المكتبة (مرفوعة + خارجية)
  externalVideos() {
    if (!this.external || typeof this.external.videos !== 'function') return {};
    const out = {};
    let src = {};
    try { src = this.external.videos() || {}; } catch { return out; }
    for (const e of Object.values(src)) {
      if (!e || !e.id || !e.path) continue;
      const meta = this.db.data.extMeta[e.id] || {};
      out[e.id] = {
        id: e.id, external: true, path: e.path, ext: String(e.ext || path.extname(e.path).slice(1)).toLowerCase(), size: e.size || 0,
        originalName: path.basename(e.path), title: e.title || path.basename(e.path), channel: e.channel || 'مكتبتي', channelId: e.channelId || scanner.channelId(e.channel || 'مكتبتي'),
        description: e.description || '', tags: e.tags || [], duration: e.duration || 0, width: e.width || 0, height: e.height || 0,
        thumb: e.thumbPath ? (e.thumbAt || 1) : null, thumbPath: e.thumbPath || null, probed: Boolean(e.duration), views: meta.views || 0, hidden: Boolean(meta.hidden),
        addedAt: e.addedAt || 0, updatedAt: e.updatedAt || e.addedAt || 0, subs: [], ai: e.ai || null, year: e.year || 0,
      };
    }
    return out;
  }
  allVideos() { return { ...this.externalVideos(), ...this.db.data.videos }; }
  getVideo(id) { return this.db.data.videos[id] || this.externalVideos()[id] || null; }
  filePath(v) { return v.external ? v.path : this.db.videoPath(v); }
  thumbFile(v) { return v.external ? v.thumbPath : this.db.thumbPath(v); }

  // ---------- البيانات العامة
  publicVideo(v, req) {
    const likes = this.db.data.likes[v.id] || {};
    const vals = Object.values(likes);
    const dev = this.device(req);
    return {
      ...v,
      path: undefined, thumbPath: undefined,
      folder: v.channel,
      native: true,
      likes: vals.filter((x) => x > 0).length,
      dislikes: vals.filter((x) => x < 0).length,
      myLike: likes[dev] || 0,
      thumb: v.thumb ? `${v.id}.jpg?v=${v.thumb}` : null,
      subs: (v.subs || []).map((s, i) => ({ lang: s.lang, label: s.label, i })),
    };
  }
  publicLibrary(req, admin = false) {
    const videos = {};
    for (const v of Object.values(this.allVideos())) if (admin || !v.hidden) videos[v.id] = this.publicVideo(v, req);
    return { folders: [], videos, channels: scanner.channelsOf(videos) };
  }
  siteInfo() {
    const s = this.db.data.settings;
    return { name: s.siteName, version: PKG.version, creator: CREATOR, hasAdmin: Boolean(this.db.data.admin), aiEnabled: s.aiEnabled && (this.ai.hasKey()), aiPublic: s.aiPublic, aiModel: s.aiModel, allowComments: s.allowComments !== false, welcome: s.welcome || '', videos: Object.values(this.allVideos()).filter((v) => !v.hidden).length };
  }

  // ---------- التوجيه
  async handle(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Device, X-File-Name, X-Channel, X-Lang, Range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname;
    const m = req.method;
    const seg = p.split('/').filter(Boolean);

    if (seg[0] !== 'api') return this.serveStatic(req, res, p);
    const admin = this.isAdmin(req);
    const route = seg.slice(1);
    const [a, b, c] = route;

    // — عام
    if (a === 'site' && m === 'GET') return ok(res, this.siteInfo());
    if (a === 'setup' && m === 'POST') {
      if (this.db.data.admin) return err(res, 409, 'ALREADY_SETUP');
      const { password } = await readJSON(req);
      if (!password || String(password).length < 4) return err(res, 400, 'WEAK_PASSWORD');
      this.db.data.admin = lock.hashPin(String(password)); this.db.save();
      return ok(res, { token: this.sign({ admin: true, iat: Date.now(), v: this.db.data.admin.hash.slice(0, 8) }) });
    }
    if (a === 'login' && m === 'POST') {
      const ip = req.socket.remoteAddress || 'x';
      const att = this.loginAttempts.get(ip) || { n: 0, at: Date.now() };
      if (Date.now() - att.at > 60000) { att.n = 0; att.at = Date.now(); }
      if (att.n >= 8) return err(res, 429, 'TOO_MANY_ATTEMPTS');
      const { password } = await readJSON(req);
      if (!this.db.data.admin || !lock.verifyPin(String(password || ''), this.db.data.admin)) { att.n++; this.loginAttempts.set(ip, att); return err(res, 401, 'WRONG_PASSWORD'); }
      this.loginAttempts.delete(ip);
      return ok(res, { token: this.sign({ admin: true, iat: Date.now(), v: this.db.data.admin.hash.slice(0, 8) }) });
    }
    if (a === 'me' && m === 'GET') return ok(res, { admin, site: this.siteInfo() });
    if (a === 'library' && m === 'GET') return ok(res, this.publicLibrary(req, admin && url.searchParams.get('all') === '1'));
    if (a === 'video' && b) {
      const v = this.getVideo(b);
      if (!v || (v.hidden && !admin)) return err(res, 404, 'NOT_FOUND');
      return streamFile(req, res, this.filePath(v));
    }
    if (a === 'thumb' && b) {
      const id = b.replace(/\.jpg$/, '');
      const v = this.getVideo(id);
      if (!v || !v.thumb) return err(res, 404, 'NOT_FOUND');
      return streamFile(req, res, this.thumbFile(v), 'image/jpeg');
    }
    if (a === 'sub' && b && c != null) {
      const v = this.getVideo(b);
      if (!v) return err(res, 404, 'NOT_FOUND');
      if (v.external) {
        const list = this.external.subtitlesFor ? await this.external.subtitlesFor(b) : [];
        const item = list[Number(c)];
        if (!item) return err(res, 404, 'NOT_FOUND');
        const vtt = await subtitles.readAsVtt(item.path);
        res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(vtt);
      }
      if (!(v.subs || [])[Number(c)]) return err(res, 404, 'NOT_FOUND');
      return streamFile(req, res, this.db.subPath(v, Number(c)), 'text/vtt; charset=utf-8');
    }
    if (a === 'subs' && b && m === 'GET') {
      const v = this.getVideo(b);
      if (!v) return err(res, 404, 'NOT_FOUND');
      if (v.external && this.external.subtitlesFor) return ok(res, (await this.external.subtitlesFor(b)).map((x, i) => ({ lang: x.lang, label: x.label, i })));
      return ok(res, (v.subs || []).map((x, i) => ({ lang: x.lang, label: x.label, i })));
    }
    if (a === 'view' && b && m === 'POST') {
      const v = this.getVideo(b);
      if (!v) return err(res, 404, 'NOT_FOUND');
      const dev = this.device(req);
      const views = this.db.data.views[b] = this.db.data.views[b] || {};
      let count = v.views || 0;
      if (!views[dev] || Date.now() - views[dev] > 30 * 60000) {
        count += 1;
        if (v.external) { const meta = this.db.data.extMeta[b] = this.db.data.extMeta[b] || {}; meta.views = count; } else v.views = count;
      }
      views[dev] = Date.now();
      this.db.save();
      return ok(res, { views: count });
    }
    if (a === 'like' && b && m === 'POST') {
      const v = this.getVideo(b);
      if (!v) return err(res, 404, 'NOT_FOUND');
      const { val } = await readJSON(req);
      const likes = this.db.data.likes[b] = this.db.data.likes[b] || {};
      const dev = this.device(req);
      const n = Number(val) || 0;
      if (!n) delete likes[dev]; else likes[dev] = n > 0 ? 1 : -1;
      this.db.save();
      const vals = Object.values(likes);
      return ok(res, { likes: vals.filter((x) => x > 0).length, dislikes: vals.filter((x) => x < 0).length, mine: likes[dev] || 0 });
    }
    if (a === 'comments' && b) {
      const v = this.getVideo(b);
      if (!v) return err(res, 404, 'NOT_FOUND');
      const dev = this.device(req);
      const list = () => (this.db.data.comments[b] || []).map((x) => ({ id: x.id, name: x.name, text: x.text, at: x.at, mine: x.device === dev }));
      if (m === 'GET') return ok(res, list());
      if (m === 'POST') {
        if (this.db.data.settings.allowComments === false && !admin) return err(res, 403, 'COMMENTS_DISABLED');
        const { name, text } = await readJSON(req);
        const t = String(text || '').trim().slice(0, 2000);
        if (!t) return err(res, 400, 'EMPTY');
        const arr = this.db.data.comments[b] = this.db.data.comments[b] || [];
        arr.unshift({ id: newId(), name: String(name || 'مشاهد').trim().slice(0, 40) || 'مشاهد', text: t, at: Date.now(), device: dev, admin });
        if (arr.length > 500) arr.length = 500;
        this.db.save();
        return ok(res, list());
      }
      if (m === 'DELETE' && c) {
        const arr = this.db.data.comments[b] || [];
        const target = arr.find((x) => x.id === c);
        if (!target) return err(res, 404, 'NOT_FOUND');
        if (!admin && target.device !== dev) return err(res, 403, 'FORBIDDEN');
        this.db.data.comments[b] = arr.filter((x) => x.id !== c);
        this.db.save();
        return ok(res, list());
      }
    }

    // — الذكاء الاصطناعي (المشرف دائمًا، والزوار إن سمح المشرف)
    if (a === 'ai') {
      const s = this.db.data.settings;
      if (!s.aiEnabled || !this.ai.hasKey()) return err(res, 403, 'NO_API_KEY');
      if (!admin && !s.aiPublic) return err(res, 403, 'FORBIDDEN');
      if (b === 'analyze' && c && m === 'POST') {
        if (!admin) return err(res, 403, 'FORBIDDEN');
        const v = this.getVideo(c);
        if (!v) return err(res, 404, 'NOT_FOUND');
        const { frames, subtitles: subs, lang } = await readJSON(req);
        const result = await this.ai.analyzeVideo({ video: { ...v, file: v.originalName || v.title }, frames, subtitles: subs || '', model: s.aiModel, lang: lang || 'ar' });
        if (v.external) { if (this.external.update) await this.external.update(c, { ai: result }); return ok(res, result); }
        v.ai = result;
        if (!v.description) v.description = result.description;
        if (!v.tags || !v.tags.length) v.tags = result.tags;
        v.updatedAt = Date.now();
        this.db.save();
        return ok(res, result);
      }
      if (b === 'clearAnalysis' && c && m === 'POST') {
        if (!admin) return err(res, 403, 'FORBIDDEN');
        const v = this.getVideo(c);
        if (v && v.external) { if (this.external.update) await this.external.update(c, { ai: null }); }
        else if (v) { delete v.ai; this.db.save(); }
        return ok(res);
      }
      const videos = this.publicLibrary(req, admin).videos;
      if (b === 'search' && m === 'POST') {
        const { query, userdata, prefilter } = await readJSON(req);
        return ok(res, await this.ai.semanticSearch({ query: String(query || '').slice(0, 500), videos, userdata: this.safeUser(userdata), model: s.aiModel, prefilter }));
      }
      if (b === 'forYou' && m === 'POST') {
        const { userdata, candidates } = await readJSON(req);
        return ok(res, await this.ai.forYou({ videos, userdata: this.safeUser(userdata), candidates, model: s.aiModel }));
      }
      if (b === 'smartPlaylist' && m === 'POST') {
        const { prompt, userdata } = await readJSON(req);
        return ok(res, await this.ai.smartPlaylist({ prompt: String(prompt || '').slice(0, 500), videos, userdata: this.safeUser(userdata), model: s.aiModel }));
      }
      if (b === 'insights' && m === 'POST') {
        const { userdata, lang } = await readJSON(req);
        return ok(res, await this.ai.insights({ videos, userdata: this.safeUser(userdata), model: s.aiModel, lang: lang || 'ar' }));
      }
      if (b === 'ask' && c && m === 'POST') {
        const v = this.getVideo(c);
        if (!v) return err(res, 404, 'NOT_FOUND');
        const { question, history, frames, subtitles: subs, lang } = await readJSON(req);
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
        try {
          await this.ai.askVideo({ video: v, analysis: v.ai, frames, subtitles: subs || '', history: (history || []).slice(-10), question: String(question || '').slice(0, 2000), lang: lang || 'ar', model: s.aiModel, onDelta: (d) => res.write(d) });
        } catch (e) { res.write(`\n[${e.code || e.message}]`); }
        return res.end();
      }
      return err(res, 404, 'NOT_FOUND');
    }

    // — المشرف
    if (a === 'admin') {
      if (!admin) return err(res, 401, 'UNAUTHORIZED');
      if (b === 'videos' && m === 'GET') return ok(res, this.publicLibrary(req, true));
      if (b === 'stats' && m === 'GET') {
        const vids = Object.values(this.allVideos());
        let size = 0; for (const v of vids) size += v.size || 0;
        return ok(res, { videos: vids.length, hidden: vids.filter((v) => v.hidden).length, views: vids.reduce((x, v) => x + (v.views || 0), 0), likes: Object.values(this.db.data.likes).reduce((x, l) => x + Object.values(l).filter((z) => z > 0).length, 0), comments: Object.values(this.db.data.comments).reduce((x, l) => x + l.length, 0), size, duration: vids.reduce((x, v) => x + (v.duration || 0), 0), analyzed: vids.filter((v) => v.ai).length, dataDir: this.dataDir });
      }
      if (b === 'upload' && (m === 'POST' || m === 'PUT')) return this.upload(req, res, url);
      if (b === 'video' && c) {
        const v = this.getVideo(c);
        if (!v) return err(res, 404, 'NOT_FOUND');
        if (v.external) {
          // مقاطع مكتبة سطح المكتب: التعديل يمرّ إلى التطبيق، والحذف = إخفاء عن المشاهدين فقط
          const meta = this.db.data.extMeta[c] = this.db.data.extMeta[c] || {};
          if (m === 'PATCH') {
            const patch = await readJSON(req);
            if ('hidden' in patch) meta.hidden = Boolean(patch.hidden);
            const fwd = {};
            for (const k of ['title', 'description', 'tags', 'channel']) if (k in patch) fwd[k] = patch[k];
            if (Object.keys(fwd).length && this.external.update) await this.external.update(c, fwd);
            this.db.save();
            return ok(res, this.publicVideo(this.getVideo(c), req));
          }
          if (m === 'DELETE') { meta.hidden = true; this.db.save(); return ok(res); }
        }
        if (m === 'PATCH') {
          const patch = await readJSON(req);
          if ('title' in patch) v.title = String(patch.title || '').trim().slice(0, 200) || v.title;
          if ('description' in patch) v.description = String(patch.description || '').slice(0, 4000);
          if ('tags' in patch) v.tags = (Array.isArray(patch.tags) ? patch.tags : []).map((t) => String(t).trim()).filter(Boolean).slice(0, 20);
          if ('channel' in patch) { v.channel = String(patch.channel || '').trim().slice(0, 80) || v.channel; v.channelId = scanner.channelId(v.channel); }
          if ('hidden' in patch) v.hidden = Boolean(patch.hidden);
          if ('duration' in patch) v.duration = Math.max(0, Number(patch.duration) || 0);
          if ('width' in patch) v.width = Number(patch.width) || 0;
          if ('height' in patch) v.height = Number(patch.height) || 0;
          if ('probed' in patch) v.probed = Boolean(patch.probed);
          v.updatedAt = Date.now();
          this.db.save();
          return ok(res, this.publicVideo(v, req));
        }
        if (m === 'DELETE') {
          delete this.db.data.videos[c]; delete this.db.data.comments[c]; delete this.db.data.likes[c]; delete this.db.data.views[c];
          for (const f of [this.db.videoPath(v), this.db.thumbPath(v), ...(v.subs || []).map((_, i) => this.db.subPath(v, i))]) await fsp.unlink(f).catch(() => {});
          this.db.save();
          return ok(res);
        }
      }
      if (b === 'thumb' && c && (m === 'POST' || m === 'PUT')) {
        const v = this.db.data.videos[c];
        if (!v) return err(res, this.getVideo(c) ? 409 : 404, this.getVideo(c) ? 'EXTERNAL_VIDEO' : 'NOT_FOUND');
        const buf = await readBody(req, 8 * 1024 * 1024);
        if (buf.length < 100) return err(res, 400, 'EMPTY');
        await fsp.writeFile(this.db.thumbPath(v), buf);
        v.thumb = Date.now();
        const at = Number(url.searchParams.get('at'));
        if (Number.isFinite(at)) v.thumbAt = at;
        this.db.save();
        return ok(res, `${v.id}.jpg?v=${v.thumb}`);
      }
      if (b === 'sub' && c && (m === 'POST' || m === 'PUT')) {
        const v = this.db.data.videos[c];
        if (!v) return err(res, this.getVideo(c) ? 409 : 404, this.getVideo(c) ? 'EXTERNAL_VIDEO' : 'NOT_FOUND');
        const buf = await readBody(req, 8 * 1024 * 1024);
        const raw = buf.toString('utf8');
        const vtt = /^﻿?WEBVTT/.test(raw) ? raw.replace(/^﻿/, '') : subtitles.srtToVtt(raw);
        const lang = String(url.searchParams.get('lang') || req.headers['x-lang'] || 'ar').slice(0, 8);
        v.subs = (v.subs || []).filter((s) => s.lang !== lang);
        const i = v.subs.length;
        v.subs.push({ lang, label: lang.toUpperCase() });
        // إعادة ترقيم الملفات لتطابق الفهارس
        await fsp.writeFile(this.db.subPath(v, i), vtt, 'utf8');
        this.db.save();
        return ok(res, this.publicVideo(v, req));
      }
      if (b === 'settings') {
        const s = this.db.data.settings;
        const view = () => ({ ...s, aiKeySet: this.ai.hasKey(), models: MODELS });
        if (m === 'GET') return ok(res, view());
        if (m === 'POST') {
          const patch = await readJSON(req);
          if ('siteName' in patch) s.siteName = String(patch.siteName || 'LiwaTube').trim().slice(0, 60) || 'LiwaTube';
          if ('aiEnabled' in patch) s.aiEnabled = Boolean(patch.aiEnabled);
          if ('aiPublic' in patch) s.aiPublic = Boolean(patch.aiPublic);
          if ('allowComments' in patch) s.allowComments = Boolean(patch.allowComments);
          if ('welcome' in patch) s.welcome = String(patch.welcome || '').slice(0, 300);
          if ('aiModel' in patch && MODELS.some((x) => x.id === patch.aiModel)) s.aiModel = patch.aiModel;
          if ('aiKey' in patch) { if (patch.aiKey) this.ai.setKey(patch.aiKey); else this.ai.clearKey(); }
          if (patch.newPassword) {
            if (!lock.verifyPin(String(patch.currentPassword || ''), this.db.data.admin)) return err(res, 401, 'WRONG_PASSWORD');
            if (String(patch.newPassword).length < 4) return err(res, 400, 'WEAK_PASSWORD');
            this.db.data.admin = lock.hashPin(String(patch.newPassword));
          }
          this.db.save();
          return ok(res, view());
        }
      }
      return err(res, 404, 'NOT_FOUND');
    }
    return err(res, 404, 'NOT_FOUND');
  }

  safeUser(u) {
    u = u && typeof u === 'object' ? u : {};
    return { history: (u.history || []).slice(0, 60), likes: u.likes || {}, subscriptions: u.subscriptions || {}, playCount: u.playCount || {}, ai: {}, overrides: {}, hidden: {}, notInterested: u.notInterested || {}, progress: u.progress || {} };
  }

  /** رفع مقطع: الجسم الخام للملف، والاسم/القناة في الترويسات أو الاستعلام. */
  async upload(req, res, url) {
    const name = decodeURIComponent(String(url.searchParams.get('name') || req.headers['x-file-name'] || 'video.mp4'));
    const ext = path.extname(name).toLowerCase();
    if (!VIDEO_EXT.has(ext)) return err(res, 415, 'UNSUPPORTED_TYPE');
    const channel = decodeURIComponent(String(url.searchParams.get('channel') || req.headers['x-channel'] || '')).trim().slice(0, 80) || this.db.data.settings.siteName;
    const id = newId();
    const tmp = path.join(this.dataDir, 'tmp', `${id}${ext}`);
    let size = 0;
    const counter = new (require('stream').Transform)({ transform(chunk, _e, cb) { size += chunk.length; cb(null, chunk); } });
    try {
      await pipeline(req, counter, fs.createWriteStream(tmp));
    } catch (e) { await fsp.unlink(tmp).catch(() => {}); return err(res, 400, 'UPLOAD_FAILED'); }
    if (!size) { await fsp.unlink(tmp).catch(() => {}); return err(res, 400, 'EMPTY'); }
    const rec = {
      id, ext: ext.slice(1), originalName: path.basename(name), file: `${id}${ext}`, size, addedAt: Date.now(), updatedAt: Date.now(),
      title: String(url.searchParams.get('title') || '').trim().slice(0, 200) || scanner.titleFromFilename(name),
      year: scanner.yearFromFilename(name),
      channel, channelId: scanner.channelId(channel),
      description: '', tags: [], duration: 0, width: 0, height: 0, thumb: null, probed: false, views: 0, hidden: false, subs: [],
    };
    await fsp.rename(tmp, this.db.videoPath(rec));
    this.db.data.videos[id] = rec;
    this.db.save();
    this.log(`+ upload ${rec.originalName} (${Math.round(size / 1e6)} MB) → ${channel}`);
    return ok(res, this.publicVideo(rec, req));
  }

  // ---------- الملفات الثابتة (واجهة الويب)
  async serveStatic(req, res, p) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return err(res, 405, 'METHOD_NOT_ALLOWED');
    const clean = path.posix.normalize(p).replace(/^\/+/, '');
    const map = {
      '': 'web/index.html', 'index.html': 'web/index.html', 'icon.png': 'build/icon.png', 'manifest.webmanifest': 'web/manifest.webmanifest',
      'css/app.css': 'renderer/css/app.css', 'css/web.css': 'web/css/web.css', 'js/recommend.js': 'electron/lib/recommend.js',
    };
    let rel = map[clean];
    if (!rel && /^js\/[a-z0-9_-]+\.js$/i.test(clean)) {
      const name = clean.slice(3);
      rel = fs.existsSync(path.join(ROOT, 'web/js', name)) ? `web/js/${name}` : `renderer/js/${name}`;
    }
    if (!rel) { if (!clean.includes('.')) rel = 'web/index.html'; else return err(res, 404, 'NOT_FOUND'); }
    const file = path.join(ROOT, rel);
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
    return streamFile(req, res, file, types[path.extname(file)] || 'application/octet-stream');
  }
}

module.exports = { LiwaTubeServer, DB };

if (require.main === module) {
  const srv = new LiwaTubeServer({ port: Number(process.env.PORT || 8787), host: process.env.HOST || '0.0.0.0', adminPassword: process.env.LIWATUBE_ADMIN_PASSWORD || null });
  srv.listen().then(() => {
    if (!srv.db.data.admin) console.log('لا توجد كلمة مرور للمشرف بعد — افتح الموقع واضغط «دخول المشرف» لتعيينها (أو مرّر LIWATUBE_ADMIN_PASSWORD).');
  });
  const stop = () => srv.close().then(() => process.exit(0));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
