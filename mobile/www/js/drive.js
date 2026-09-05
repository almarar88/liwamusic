/* LiwaMusic للهاتف — طبقة Google Drive: تسجيل الدخول (PKCE) والتصفّح والتنزيل.
   تم إنشاؤه عن طريق LiwaMusic. */
'use strict';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.appdata',
];
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const AUDIO_EXT = new Set([
  'mp3', 'm4a', 'm4b', 'aac', 'flac', 'wav', 'wave', 'ogg', 'oga',
  'opus', 'aiff', 'aif', 'wma', 'mpc', 'ape', 'wv',
]);

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function isAudio(file) {
  const mime = String(file.mimeType || '');
  if (mime.startsWith('audio/')) return true;
  if (mime === FOLDER_MIME) return false;
  const ext = String(file.fileExtension || (file.name || '').split('.').pop() || '').toLowerCase();
  return AUDIO_EXT.has(ext);
}

export function trackIdFor(fileId) {
  // معرّف قصير ثابت مشتق من معرّف درايف (يطابق منطق نسخة الكمبيوتر في الثبات)
  let h = 0x811c9dc5;
  const s = `drive:${fileId}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `d${h.toString(16)}${fileId.slice(-8)}`;
}

/**
 * يشتق مخطط الرابط العميق من معرّف العميل (الصيغة القياسية لتطبيقات جوجل المثبَّتة):
 * 123-abc.apps.googleusercontent.com  →  com.googleusercontent.apps.123-abc
 * يعمل مع عملاء Android وDesktop على السواء.
 */
export function reversedScheme(clientId) {
  const id = String(clientId || '').trim();
  const m = /^(.+)\.apps\.googleusercontent\.com$/.exec(id);
  return m ? `com.googleusercontent.apps.${m[1]}` : null;
}

/** رابط إعادة التوجيه المناسب لمعرّف العميل. */
export function redirectUriFor(clientId, fallbackScheme = 'com.liwamusic.app') {
  const rev = reversedScheme(clientId);
  return `${rev || fallbackScheme}:/oauth2redirect`;
}

export async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(digest) };
}

/** يبني رابط موافقة جوجل لعميل أندرويد (بلا سرّ، مع PKCE). */
export function buildAuthUrl({ clientId, redirectUri, challenge, state }) {
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

/** عميل درايف: يحمل الرموز ويجدّدها تلقائيًا. */
export class DriveClient {
  constructor(store) {
    this.store = store;                 // { get(k), set(k,v), remove(k) }
    this.access = null;                 // { token, expiresAt }
  }

  async clientId() { return (await this.store.get('drive.clientId')) || ''; }
  async setClientId(id) { await this.store.set('drive.clientId', String(id || '').trim()); }
  async clientSecret() { return (await this.store.get('drive.clientSecret')) || ''; }
  async setClientSecret(sec) { await this.store.set('drive.clientSecret', String(sec || '').trim()); }
  async refreshToken() { return (await this.store.get('drive.refresh')) || ''; }
  async isConnected() { return !!(await this.refreshToken()); }

  async disconnect() {
    await this.store.remove('drive.refresh');
    this.access = null;
  }

  /** يبادل رمز الموافقة برموز الوصول والتحديث. */
  async exchange({ code, verifier, redirectUri }) {
    const clientId = await this.clientId();
    const secret = await this.clientSecret();
    const body = new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
    if (secret) body.set('client_secret', secret);
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error_description || data.error || `HTTP ${res.status}`);
    if (!data.refresh_token) throw new Error('لم يصل رمز تحديث — تأكد من صحة المعرّف و«Client secret» إن كان العميل من نوع Desktop.');
    await this.store.set('drive.refresh', data.refresh_token);
    this.access = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return true;
  }

  async token() {
    if (this.access && this.access.expiresAt > Date.now()) return this.access.token;
    const refresh = await this.refreshToken();
    if (!refresh) throw new Error('NOT_CONNECTED');
    const body = new URLSearchParams({
      client_id: await this.clientId(),
      refresh_token: refresh,
      grant_type: 'refresh_token',
    });
    const secret = await this.clientSecret();
    if (secret) body.set('client_secret', secret);
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.error === 'invalid_grant') await this.disconnect();
      throw new Error(data.error_description || data.error || `HTTP ${res.status}`);
    }
    this.access = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return this.access.token;
  }

  async api(pathname, { params, headers = {}, method = 'GET', body, raw = false, base = API } = {}) {
    const token = await this.token();
    const url = new URL(base + pathname);
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, ...headers }, body });
    if (raw) return res;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async about() {
    const d = await this.api('/about', { params: { fields: 'user(displayName,emailAddress),storageQuota' } });
    return { name: (d.user || {}).displayName || '', email: (d.user || {}).emailAddress || '', quota: d.storageQuota || null };
  }

  async listFolder(folderId = 'root', pageToken = null) {
    const d = await this.api('/files', {
      params: {
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id,name,mimeType,size,modifiedTime,fileExtension,md5Checksum)',
        pageSize: 200,
        orderBy: 'folder,name',
        pageToken,
      },
    });
    const files = d.files || [];
    return {
      folders: files.filter((f) => f.mimeType === FOLDER_MIME).map((f) => ({ id: f.id, name: f.name })),
      audio: files.filter(isAudio),
      nextPageToken: d.nextPageToken || null,
    };
  }

  /** يمشي على شجرة المجلد ويجمع كل ملفات الصوت. */
  async walkAudio(folderId, onProgress = () => {}, depth = 0, seen = new Set()) {
    if (depth > 12 || seen.has(folderId)) return [];
    seen.add(folderId);
    const out = [];
    const subs = [];
    let pageToken = null;
    do {
      // eslint-disable-next-line no-await-in-loop
      const page = await this.listFolder(folderId, pageToken);
      out.push(...page.audio);
      subs.push(...page.folders);
      pageToken = page.nextPageToken;
      onProgress(out.length);
    } while (pageToken);
    for (const sub of subs) {
      // eslint-disable-next-line no-await-in-loop
      out.push(...await this.walkAudio(sub.id, onProgress, depth + 1, seen));
    }
    return out;
  }

  /** ينزّل الملف كاملًا (مع تقدّم) — أساس التشغيل والتخزين للاستماع دون إنترنت. */
  async downloadBlob(fileId, onProgress = () => {}) {
    const res = await this.api(`/files/${encodeURIComponent(fileId)}`, { params: { alt: 'media' }, raw: true });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    if (!res.body || !total) return res.blob();
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress(received, total);
    }
    return new Blob(chunks);
  }

  // ————— مزامنة مع نسخة الكمبيوتر عبر نفس الملف المخفي
  async findSyncFile(name = 'liwamusic-sync.json') {
    const d = await this.api('/files', {
      params: { spaces: 'appDataFolder', q: `name = '${name}' and trashed = false`, fields: 'files(id,name,modifiedTime)', pageSize: 5 },
    });
    return (d.files || [])[0] || null;
  }

  async downloadSync(name = 'liwamusic-sync.json') {
    const f = await this.findSyncFile(name);
    if (!f) return null;
    const res = await this.api(`/files/${f.id}`, { params: { alt: 'media' }, raw: true });
    if (!res.ok) return null;
    return res.json().catch(() => null);
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return true;
    }
    const boundary = `liwa${Math.random().toString(16).slice(2)}`;
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
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  }
}

/** يحوّل ملف درايف إلى سجل أغنية. */
export function toTrack(file, folderName = '') {
  const name = file.name || '';
  const ext = String(file.fileExtension || name.split('.').pop() || '').toLowerCase();
  const title = name.replace(/\.[^.]+$/, '').replace(/^\d{1,3}[\s._-]+/, '').replace(/_+/g, ' ').trim() || name;
  return {
    id: trackIdFor(file.id),
    driveId: file.id,
    source: 'drive',
    file: name,
    folder: folderName,
    ext,
    size: Number(file.size) || 0,
    title,
    artist: '',
    album: '',
    genre: '',
    year: 0,
    duration: 0,
    art: null,
    md5: file.md5Checksum || '',
    addedAt: Date.now(),
  };
}

export { SCOPES, FOLDER_MIME, AUDIO_EXT };
