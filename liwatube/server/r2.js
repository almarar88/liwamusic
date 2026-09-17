'use strict';
/**
 * LiwaTube — تخزين دائم على Cloudflare R2 (متوافق مع S3).
 * الغرض: المقاطع تبقى محفوظة للأبد خارج الخادم، فلا تتأثر بإعادة النشر أو نوم الاستضافة
 * أو حتى حذف الخادم وإنشاء غيره. النقل من R2 مجاني، لذا تُبَث المقاطع من R2 مباشرة
 * إلى المشاهد عبر روابط موقّعة مؤقتة، بلا مرور بالخادم.
 *
 * الإعداد بمتغيّرات البيئة:
 *   R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 *   (اختياري) R2_ENDPOINT لتجاوز العنوان، R2_PUBLIC_URL لنطاق عام بلا توقيع.
 */

const XML_ESC = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

class R2 {
  /** @param {object} env متغيّرات البيئة (process.env افتراضيًا) */
  constructor(env = process.env) {
    this.accountId = env.R2_ACCOUNT_ID || '';
    this.bucket = env.R2_BUCKET || '';
    this.accessKeyId = env.R2_ACCESS_KEY_ID || '';
    this.secretAccessKey = env.R2_SECRET_ACCESS_KEY || '';
    this.endpoint = (env.R2_ENDPOINT || (this.accountId ? `https://${this.accountId}.r2.cloudflarestorage.com` : '')).replace(/\/+$/, '');
    this.publicUrl = (env.R2_PUBLIC_URL || '').replace(/\/+$/, '');
    this._client = null;
  }

  get configured() { return Boolean(this.endpoint && this.bucket && this.accessKeyId && this.secretAccessKey); }
  /** يشرح ما ينقص من الإعداد (لرسائل واضحة في السجل). */
  missing() {
    return [
      !this.endpoint && 'R2_ACCOUNT_ID',
      !this.bucket && 'R2_BUCKET',
      !this.accessKeyId && 'R2_ACCESS_KEY_ID',
      !this.secretAccessKey && 'R2_SECRET_ACCESS_KEY',
    ].filter(Boolean);
  }

  async client() {
    if (this._client) return this._client;
    const { AwsClient } = await import('aws4fetch');
    this._client = new AwsClient({
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      service: 's3',
      region: 'auto',
    });
    return this._client;
  }

  url(key = '') { return `${this.endpoint}/${this.bucket}${key ? `/${encodeURI(key)}` : ''}`; }

  async fetch(key, init = {}) {
    const c = await this.client();
    return c.fetch(this.url(key), init);
  }

  /** رابط موقّت موقّع للقراءة أو الكتابة مباشرة من المتصفح إلى R2. */
  async presign(key, { method = 'GET', expires = 21600 } = {}) {
    if (this.publicUrl && method === 'GET') return `${this.publicUrl}/${encodeURI(key)}`;
    const c = await this.client();
    const signed = await c.sign(`${this.url(key)}?X-Amz-Expires=${expires}`, { method, aws: { signQuery: true } });
    return signed.url;
  }

  async put(key, body, contentType = 'application/octet-stream') {
    const res = await this.fetch(key, { method: 'PUT', body, headers: { 'Content-Type': contentType } });
    if (!res.ok) throw new Error(`R2_PUT_${res.status}: ${(await res.text()).slice(0, 200)}`);
    return true;
  }

  async get(key) {
    const res = await this.fetch(key, { method: 'GET' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2_GET_${res.status}`);
    return res;
  }

  /** يعيد { size, contentType } أو null إن لم يوجد. */
  async head(key) {
    const res = await this.fetch(key, { method: 'HEAD' });
    if (!res.ok) return null;
    return { size: Number(res.headers.get('content-length')) || 0, contentType: res.headers.get('content-type') || '' };
  }

  async del(key) {
    const res = await this.fetch(key, { method: 'DELETE' });
    return res.ok || res.status === 404;
  }

  async getJSON(key) {
    const res = await this.get(key);
    if (!res) return null;
    try { return JSON.parse(await res.text()); } catch { return null; }
  }
  async putJSON(key, obj) { return this.put(key, JSON.stringify(obj), 'application/json'); }

  /** يضبط CORS على الحاوية ليتمكّن المتصفح من الرفع والتشغيل مباشرة. */
  async ensureCors(origins = ['*']) {
    const rule = [
      '<CORSConfiguration><CORSRule>',
      origins.map((o) => `<AllowedOrigin>${XML_ESC(o)}</AllowedOrigin>`).join(''),
      '<AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedMethod>HEAD</AllowedMethod>',
      '<AllowedHeader>*</AllowedHeader>',
      '<ExposeHeader>ETag</ExposeHeader><ExposeHeader>Content-Length</ExposeHeader><ExposeHeader>Content-Range</ExposeHeader><ExposeHeader>Accept-Ranges</ExposeHeader>',
      '<MaxAgeSeconds>3600</MaxAgeSeconds>',
      '</CORSRule></CORSConfiguration>',
    ].join('');
    const c = await this.client();
    const res = await c.fetch(`${this.url()}?cors`, { method: 'PUT', body: rule, headers: { 'Content-Type': 'application/xml' } });
    if (!res.ok) throw new Error(`R2_CORS_${res.status}: ${(await res.text()).slice(0, 200)}`);
    return true;
  }

  /** فحص سريع للاتصال والصلاحيات: يكتب ثم يقرأ ثم يحذف كائنًا صغيرًا. */
  async selfTest() {
    const key = `_check/${Date.now()}.txt`;
    const token = `liwatube-${Math.random().toString(36).slice(2)}`;
    await this.put(key, token, 'text/plain');
    const res = await this.get(key);
    const back = res ? await res.text() : null;
    await this.del(key);
    if (back !== token) throw new Error('R2_ROUNDTRIP_MISMATCH');
    return true;
  }
}

module.exports = { R2 };
