/* LiwaIPTV — طلبات الشبكة لواجهات الخوادم (JSON و M3U و XMLTV).
   داخل التطبيق تمرّ عبر CapacitorHttp (طبقة أندرويد الأصلية) فلا تعيقها قيود
   CORS، وتقبل ترويسات ممنوعة في المتصفح مثل User-Agent و Cookie (لبوابات Stalker).
   أما البث نفسه فيمرّ عبر وسيط أندرويد في LiwaWebViewClient (انظر native.js). */
'use strict';

const DEFAULT_TIMEOUT = 45000;
let defaultHeaders = {};

/** ترويسات تُضاف لكل طلب (User-Agent مخصص مثلًا). */
export function setDefaultHeaders(h) { defaultHeaders = { ...h }; }

function nativeHttp() {
  const C = typeof window !== 'undefined' && window.Capacitor;
  return C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.CapacitorHttp;
}

function statusError(status) {
  const err = new Error(status === 401 || status === 403
    ? 'رفض الخادم الدخول (تحقق من بيانات الاشتراك)'
    : status === 404 ? 'الرابط غير موجود على الخادم (404)'
      : status === 512 || status === 884 ? 'الخادم يرفض هذا الجهاز أو العنوان' : `خطأ من الخادم (${status})`);
  err.status = status;
  return err;
}

/** يعيد نص الاستجابة. */
async function requestText(url, { timeout = DEFAULT_TIMEOUT, headers: extra = {} } = {}) {
  const headers = { ...defaultHeaders, ...extra };
  const native = nativeHttp();
  if (native) {
    let res;
    try {
      res = await native.request({
        url, method: 'GET', headers, responseType: 'text',
        connectTimeout: timeout, readTimeout: timeout,
      });
    } catch (e) {
      throw new Error(/timeout/i.test(String(e && e.message)) ? 'انتهت مهلة الاتصال بالخادم' : 'تعذّر الاتصال بالخادم — تحقق من الرابط والإنترنت');
    }
    if (res.status >= 400) throw statusError(res.status);
    return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  }
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
  try {
    const { 'User-Agent': _ua, Cookie: _c, Referer: _r, ...safe } = headers;
    const res = await fetch(url, { headers: safe, signal: ctrl && ctrl.signal });
    if (!res.ok) throw statusError(res.status);
    return await res.text();
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('انتهت مهلة الاتصال بالخادم');
    if (e instanceof TypeError) throw new Error('تعذّر الاتصال بالخادم — تحقق من الرابط والإنترنت');
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function parseJsonLoose(t) {
  if (!t) return null;
  try { return JSON.parse(t); } catch {
    // بعض الخوادم تسبق JSON بمسافات أو BOM أو تحذيرات PHP
    const i = t.search(/[[{]/);
    if (i >= 0) { try { return JSON.parse(t.slice(i)); } catch { /* يسقط إلى الخطأ */ } }
    throw new Error('استجابة غير مفهومة من الخادم');
  }
}

export const http = {
  text: (url, opts) => requestText(url, opts),
  json: async (url, opts) => parseJsonLoose(await requestText(url, opts)),
};
