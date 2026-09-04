'use strict';
/**
 * LiwaMusic — تكامل Google Drive.
 * تسجيل دخول OAuth 2.0 (تدفّق التطبيقات المثبَّتة + PKCE على منفذ محلي)،
 * تصفّح المجلدات، فهرسة ملفات الصوت، بثّ التشغيل مع دعم Range، وكاش على القرص.
 *
 * كل الطلبات تتم في العملية الرئيسية. الرمز المميّز (refresh token) يُخزَّن
 * مشفّرًا عبر safeStorage من ويندوز ولا يصل إلى الواجهة أبدًا.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { Readable } = require('stream');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

// أقل الصلاحيات اللازمة: قراءة ملفاتك + مجلد بيانات خاص بالتطبيق للمزامنة
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.appdata',
];

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const AUDIO_EXT = new Set([
  'mp3', 'm4a', 'm4b', 'aac', 'flac', 'wav', 'wave', 'ogg', 'oga',
  'opus', 'aiff', 'aif', 'wma', 'mpc', 'ape', 'wv',
]);

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const driveTrackId = (fileId) => crypto.createHash('sha1').update(`drive:${fileId}`).digest('hex');

/** هل الملف صوتي؟ نعتمد على نوع MIME ثم الامتداد (درايف يخطئ أحيانًا). */
function isAudio(file) {
  const mime = String(file.mimeType || '');
  if (mime.startsWith('audio/')) return true;
  if (mime === FOLDER_MIME) return false;
  const ext = String(file.fileExtension || path.extname(file.name || '').slice(1)).toLowerCase();
  return AUDIO_EXT.has(ext);
}

class DriveError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || 'DRIVE_ERROR';
  }
}

class Drive {
  /** @param {object} opts { dir, cacheDir, safeStorage, onAuthUrl } */
  constructor({ dir, cacheDir, safeStorage, openExternal }) {
    this.credFile = path.join(dir, 'drive-client.json');   // معرّف العميل (غير سرّي فعليًا لتطبيقات سطح المكتب)
    this.tokenFile = path.join(dir, 'drive-token.bin');    // رمز التحديث مشفّرًا
    this.cacheDir = cacheDir;
    this.safeStorage = safeStorage;
    this.openExternal = openExternal;
    this.access = null;         // { token, expiresAt }
    this._server = null;
  }

  // ————————————————————————————— إعداد العميل

  setClient({ clientId, clientSecret }) {
    const id = String(clientId || '').trim();
    if (!id) throw new DriveError('CLIENT_ID_REQUIRED', 'CLIENT_ID_REQUIRED');
    fs.writeFileSync(
      this.credFile,
      JSON.stringify({ clientId: id, clientSecret: String(clientSecret || '').trim() }),
      { mode: 0o600 },
    );
    return { ok: true };
  }

  getClient() {
    try { return JSON.parse(fs.readFileSync(this.credFile, 'utf8')); } catch { return null; }
  }

  hasClient() { return !!(this.getClient() || {}).clientId; }

  // ————————————————————————————— الرموز المميّزة

  _saveRefresh(token) {
    const buf = this.safeStorage && this.safeStorage.isEncryptionAvailable()
      ? this.safeStorage.encryptString(token)
      : Buffer.from(`plain:${token}`, 'utf8');
    fs.writeFileSync(this.tokenFile, buf, { mode: 0o600 });
  }

  _readRefresh() {
    let buf;
    try { buf = fs.readFileSync(this.tokenFile); } catch { return null; }
    const asText = buf.toString('utf8');
    if (asText.startsWith('plain:')) return asText.slice(6);
    try { return this.safeStorage.decryptString(buf); } catch { return null; }
  }

  isConnected() { return !!this._readRefresh(); }

  disconnect() {
    try { fs.unlinkSync(this.tokenFile); } catch { /* غير موجود */ }
    this.access = null;
    return true;
  }

  /** يبني رابط موافقة جوجل. مفصول ليكون قابلًا للاختبار. */
  static buildAuthUrl({ clientId, redirectUri, challenge, state }) {
    const qs = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `${AUTH_URL}?${qs.toString()}`;
  }

  static pkce() {
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    return { verifier, challenge };
  }

  /**
   * تسجيل الدخول: يفتح المتصفح، ويستقبل الرد على منفذ محلي عشوائي.
   * يعيد وعدًا ينتهي عند الموافقة أو الرفض أو انتهاء المهلة.
   */
  connect({ timeoutMs = 300000 } = {}) {
    const cred = this.getClient();
    if (!cred || !cred.clientId) throw new DriveError('CLIENT_ID_REQUIRED', 'CLIENT_ID_REQUIRED');
    if (this._server) throw new DriveError('AUTH_IN_PROGRESS', 'AUTH_IN_PROGRESS');

    const { verifier, challenge } = Drive.pkce();
    const state = b64url(crypto.randomBytes(16));

    return new Promise((resolve, reject) => {
      const done = (fn, arg) => {
        clearTimeout(timer);
        try { server.close(); } catch { /* مغلق */ }
        this._server = null;
        fn(arg);
      };

      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname !== '/' && url.pathname !== '/callback') { res.writeHead(404).end(); return; }
        const err = url.searchParams.get('error');
        const code = url.searchParams.get('code');
        const gotState = url.searchParams.get('state');

        const page = (title, body, ok) => `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>${title}</title><style>body{font:16px "Segoe UI",Tahoma,sans-serif;background:#0b0b12;color:#f2f2f7;
display:grid;place-items:center;height:100vh;margin:0}.c{text-align:center;max-width:420px;padding:32px;
background:rgba(255,255,255,.05);border-radius:18px;border:1px solid rgba(255,255,255,.1)}
h1{font-size:20px;margin:0 0 8px;color:${ok ? '#7c5cff' : '#f45c5c'}}p{color:#9a9ab0;margin:0;line-height:1.8}
</style></head><body><div class="c"><h1>${title}</h1><p>${body}</p></div></body></html>`;

        if (err) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(page('تعذّر الربط', 'رُفضت الموافقة. أغلق هذه الصفحة وحاول مجددًا من التطبيق.', false));
          done(reject, new DriveError(`AUTH_DENIED: ${err}`, 'AUTH_DENIED'));
          return;
        }
        if (!code || gotState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(page('طلب غير صالح', 'لم يصل رمز الموافقة بشكل صحيح.', false));
          return;
        }

        try {
          const redirectUri = `http://127.0.0.1:${server.address().port}`;
          const token = await this._exchange({ code, verifier, redirectUri, cred });
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(page('تم ربط Google Drive ✓', 'يمكنك إغلاق هذه الصفحة والعودة إلى LiwaMusic.', true));
          done(resolve, token);
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(page('فشل تبادل الرمز', String(e.message || e), false));
          done(reject, e);
        }
      });

      const timer = setTimeout(() => done(reject, new DriveError('AUTH_TIMEOUT', 'AUTH_TIMEOUT')), timeoutMs);

      server.on('error', (e) => done(reject, e));
      server.listen(0, '127.0.0.1', () => {
        this._server = server;
        const redirectUri = `http://127.0.0.1:${server.address().port}`;
        const authUrl = Drive.buildAuthUrl({ clientId: cred.clientId, redirectUri, challenge, state });
        this.openExternal(authUrl);
      });
    });
  }

  async _exchange({ code, verifier, redirectUri, cred }) {
    const body = new URLSearchParams({
      client_id: cred.clientId,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
    if (cred.clientSecret) body.set('client_secret', cred.clientSecret);
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new DriveError(data.error_description || data.error || `HTTP ${res.status}`, 'TOKEN_EXCHANGE_FAILED');
    if (!data.refresh_token) throw new DriveError('NO_REFRESH_TOKEN', 'NO_REFRESH_TOKEN');
    this._saveRefresh(data.refresh_token);
    this.access = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return { connected: true };
  }

  /** يعيد رمز وصول صالحًا، مجدِّدًا إياه عند الحاجة. */
  async token() {
    if (this.access && this.access.expiresAt > Date.now()) return this.access.token;
    const refresh = this._readRefresh();
    if (!refresh) throw new DriveError('NOT_CONNECTED', 'NOT_CONNECTED');
    const cred = this.getClient();
    if (!cred) throw new DriveError('CLIENT_ID_REQUIRED', 'CLIENT_ID_REQUIRED');
    const body = new URLSearchParams({
      client_id: cred.clientId,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    });
    if (cred.clientSecret) body.set('client_secret', cred.clientSecret);
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.error === 'invalid_grant') this.disconnect();
      throw new DriveError(data.error_description || data.error || `HTTP ${res.status}`, 'REFRESH_FAILED');
    }
    this.access = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return this.access.token;
  }

  // ————————————————————————————— نداءات الواجهة البرمجية

  async api(pathname, { method = 'GET', params, headers = {}, body, raw = false, base = API } = {}) {
    const token = await this.token();
    const url = new URL(base + pathname);
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...headers },
      body,
    });
    if (raw) return res;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new DriveError(`HTTP ${res.status}: ${text.slice(0, 200)}`, `HTTP_${res.status}`);
    }
    return res.json();
  }

  /** معلومات الحساب المرتبط. */
  async about() {
    const data = await this.api('/about', { params: { fields: 'user(displayName,emailAddress,photoLink),storageQuota' } });
    return {
      name: (data.user || {}).displayName || '',
      email: (data.user || {}).emailAddress || '',
      quota: data.storageQuota || null,
    };
  }

  /** يسرد محتويات مجلد (مجلدات وملفات صوت فقط). */
  async listFolder(folderId = 'root', { pageToken } = {}) {
    const data = await this.api('/files', {
      params: {
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id,name,mimeType,size,modifiedTime,fileExtension,md5Checksum)',
        pageSize: 200,
        orderBy: 'folder,name',
        pageToken,
      },
    });
    const files = data.files || [];
    return {
      folders: files.filter((f) => f.mimeType === FOLDER_MIME).map((f) => ({ id: f.id, name: f.name })),
      audio: files.filter(isAudio),
      nextPageToken: data.nextPageToken || null,
    };
  }

  /** اسم مجلد بمعرّفه (للعرض في الواجهة). */
  async folderName(folderId) {
    if (folderId === 'root') return 'ملفاتي (My Drive)';
    const f = await this.api(`/files/${encodeURIComponent(folderId)}`, { params: { fields: 'name' } });
    return f.name || folderId;
  }

  /**
   * يمشي على شجرة مجلد ويعيد كل ملفات الصوت.
   * @param {function} onProgress ({ found, folder })
   */
  async walkAudio(folderId, onProgress = () => {}, depth = 0, seen = new Set()) {
    if (depth > 12 || seen.has(folderId)) return [];
    seen.add(folderId);
    const out = [];
    let pageToken = null;
    const subfolders = [];
    do {
      // eslint-disable-next-line no-await-in-loop
      const page = await this.listFolder(folderId, { pageToken });
      out.push(...page.audio);
      subfolders.push(...page.folders);
      pageToken = page.nextPageToken;
      onProgress({ found: out.length, folder: folderId });
    } while (pageToken);

    for (const sub of subfolders) {
      // eslint-disable-next-line no-await-in-loop
      const nested = await this.walkAudio(sub.id, onProgress, depth + 1, seen);
      out.push(...nested);
    }
    return out;
  }

  /** يحوّل ملف درايف إلى سجل مسار في مكتبة LiwaMusic. */
  static toTrack(file, folderPath = '') {
    const name = file.name || '';
    const ext = String(file.fileExtension || path.extname(name).slice(1)).toLowerCase();
    const title = name.replace(/\.[^.]+$/, '').replace(/^\d{1,3}[\s._-]+/, '').replace(/_+/g, ' ').trim() || name;
    return {
      id: driveTrackId(file.id),
      source: 'drive',
      driveId: file.id,
      path: `drive://${file.id}`,
      folder: folderPath || 'Google Drive',
      file: name,
      ext,
      size: Number(file.size) || 0,
      mtimeMs: Date.parse(file.modifiedTime || '') || 0,
      addedAt: Date.now(),
      title,
      artist: '',
      albumArtist: '',
      album: '',
      genre: '',
      year: 0,
      trackNo: 0,
      discNo: 0,
      duration: 0,
      bitrate: 0,
      sampleRate: 0,
      channels: 0,
      codec: ext.toUpperCase(),
      lossless: ['flac', 'wav', 'wave', 'aiff', 'aif', 'ape', 'wv'].includes(ext),
      art: null,
      comment: '',
      md5: file.md5Checksum || '',
    };
  }

  // ————————————————————————————— التنزيل والبثّ

  cachePath(fileId, ext) {
    return path.join(this.cacheDir, `${fileId}.${ext || 'bin'}`);
  }

  async isCached(fileId, ext) {
    try {
      const st = await fsp.stat(this.cachePath(fileId, ext));
      return st.size > 0;
    } catch { return false; }
  }

  /** ينزّل مقطعًا من الملف (يُستخدم لقراءة الوسوم بلا تنزيل الملف كاملًا). */
  async readRange(fileId, start, end) {
    const res = await this.api(`/files/${encodeURIComponent(fileId)}`, {
      params: { alt: 'media' },
      headers: { Range: `bytes=${start}-${end}` },
      raw: true,
    });
    if (!res.ok && res.status !== 206) {
      throw new DriveError(`HTTP ${res.status}`, `HTTP_${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  /** ينزّل الملف كاملًا إلى الكاش (للاستماع بلا إنترنت). */
  async download(fileId, ext, onProgress = () => {}) {
    await fsp.mkdir(this.cacheDir, { recursive: true });
    const dest = this.cachePath(fileId, ext);
    if (await this.isCached(fileId, ext)) return dest;
    const tmp = `${dest}.part`;
    const res = await this.api(`/files/${encodeURIComponent(fileId)}`, { params: { alt: 'media' }, raw: true });
    if (!res.ok) throw new DriveError(`HTTP ${res.status}`, `HTTP_${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    let received = 0;
    const out = fs.createWriteStream(tmp);
    const reader = res.body.getReader();
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (!out.write(Buffer.from(value))) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => out.once('drain', r));
      }
      onProgress({ received, total });
    }
    await new Promise((r) => out.end(r));
    await fsp.rename(tmp, dest);
    return dest;
  }

  /**
   * يخدم ملف درايف للمشغّل: من الكاش إن وُجد، وإلا بثًّا مباشرًا مع تمرير Range.
   * @returns {Response}
   */
  async serve(fileId, ext, rangeHeader, mime) {
    const cached = this.cachePath(fileId, ext);
    try {
      const st = await fsp.stat(cached);
      if (st.size > 0) return this._serveLocal(cached, st.size, rangeHeader, mime);
    } catch { /* لا يوجد كاش — نبثّ */ }

    const headers = {};
    if (rangeHeader) headers.Range = rangeHeader;
    const res = await this.api(`/files/${encodeURIComponent(fileId)}`, {
      params: { alt: 'media' }, headers, raw: true,
    });
    if (!res.ok && res.status !== 206) {
      return new Response(`Drive error ${res.status}`, { status: res.status });
    }
    const out = new Headers({
      'Content-Type': mime || res.headers.get('content-type') || 'audio/mpeg',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    });
    for (const h of ['content-length', 'content-range']) {
      const v = res.headers.get(h);
      if (v) out.set(h, v);
    }
    return new Response(res.body, { status: res.status, headers: out });
  }

  _serveLocal(filePath, size, rangeHeader, mime) {
    const headers = {
      'Content-Type': mime || 'audio/mpeg',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
      'X-Liwa-Cache': 'hit',
    };
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader || '').trim());
    if (m && (m[1] || m[2])) {
      const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      const end = m[1] ? (m[2] ? Math.min(Number(m[2]), size - 1) : size - 1) : size - 1;
      if (start > end || start >= size) {
        return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
      }
      return new Response(Readable.toWeb(fs.createReadStream(filePath, { start, end })), {
        status: 206,
        headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
      });
    }
    return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
      status: 200,
      headers: { ...headers, 'Content-Length': String(size) },
    });
  }

  /** إحصاءات الكاش وتنظيفه. */
  async cacheStats() {
    try {
      const names = await fsp.readdir(this.cacheDir);
      let bytes = 0; let count = 0;
      for (const n of names) {
        if (n.endsWith('.part')) continue;
        // eslint-disable-next-line no-await-in-loop
        const st = await fsp.stat(path.join(this.cacheDir, n)).catch(() => null);
        if (st && st.isFile()) { bytes += st.size; count++; }
      }
      return { count, bytes };
    } catch { return { count: 0, bytes: 0 }; }
  }

  async clearCache() {
    try {
      const names = await fsp.readdir(this.cacheDir);
      for (const n of names) await fsp.rm(path.join(this.cacheDir, n), { force: true });
    } catch { /* لا يوجد كاش */ }
    return true;
  }

  async removeFromCache(fileId, ext) {
    await fsp.rm(this.cachePath(fileId, ext), { force: true }).catch(() => {});
    return true;
  }

  // ————————————————————————————— مزامنة بيانات المستخدم (مجلد التطبيق الخاص)

  async findSyncFile(name = 'liwamusic-sync.json') {
    const data = await this.api('/files', {
      params: {
        spaces: 'appDataFolder',
        q: `name = '${name}' and trashed = false`,
        fields: 'files(id,name,modifiedTime,size)',
        pageSize: 10,
      },
    });
    return (data.files || [])[0] || null;
  }

  async downloadSync(name = 'liwamusic-sync.json') {
    const file = await this.findSyncFile(name);
    if (!file) return null;
    const res = await this.api(`/files/${file.id}`, { params: { alt: 'media' }, raw: true });
    if (!res.ok) throw new DriveError(`HTTP ${res.status}`, `HTTP_${res.status}`);
    const json = await res.json().catch(() => null);
    return json ? { data: json, modifiedTime: file.modifiedTime, id: file.id } : null;
  }

  async uploadSync(payload, name = 'liwamusic-sync.json') {
    const token = await this.token();
    const existing = await this.findSyncFile(name);
    const body = JSON.stringify(payload);
    if (existing) {
      const res = await fetch(`${UPLOAD_API}/files/${existing.id}?uploadType=media`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body,
      });
      if (!res.ok) throw new DriveError(`HTTP ${res.status}`, `HTTP_${res.status}`);
      return { id: existing.id, updated: true };
    }
    const boundary = `liwa${crypto.randomBytes(8).toString('hex')}`;
    const meta = JSON.stringify({ name, parents: ['appDataFolder'], mimeType: 'application/json' });
    const multipart = [
      `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', meta,
      `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', body,
      `--${boundary}--`, '',
    ].join('\r\n');
    const res = await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipart,
    });
    if (!res.ok) throw new DriveError(`HTTP ${res.status}`, `HTTP_${res.status}`);
    const data = await res.json();
    return { id: data.id, created: true };
  }
}

module.exports = { Drive, DriveError, SCOPES, isAudio, driveTrackId, AUDIO_EXT, FOLDER_MIME };
