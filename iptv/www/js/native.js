/* LiwaIPTV — جسر ميزات أندرويد الأصلية (إضافة LiwaNative المولّدة في
   scripts/patch-android.mjs). كل دالة آمنة في المتصفح: تعود بلا أثر. */
'use strict';

const C = typeof window !== 'undefined' ? window.Capacitor : null;
export const isNative = !!(C && C.isNativePlatform && C.isNativePlatform());
const P = () => (isNative && C.Plugins && C.Plugins.LiwaNative) || null;

async function call(method, args = {}) {
  const p = P();
  if (!p || typeof p[method] !== 'function') return null;
  try { return await p[method](args); } catch (e) { console.warn('LiwaNative', method, e); return null; }
}

export const native = {
  /** قواعد الوسيط: لكل مضيف ترويسات User-Agent/Referer، ويضيف ترويسات CORS. */
  setProxyRules: (rules) => call('setProxyRules', { rules }),
  keepAwake: (on) => call('keepAwake', { on: !!on }),
  immersive: (on) => call('setImmersive', { on: !!on }),
  orientation: (mode) => call('setOrientation', { mode }), // landscape | portrait | auto
  brightness: (value) => call('setBrightness', { value }), // 0..1 أو -1 للافتراضي
  getVolume: () => call('getVolume'),
  setVolume: (value) => call('setVolume', { value }), // 0..1
  pip: (w = 16, h = 9) => call('enterPip', { w, h }),
  openExternal: (url, title, ua) => call('openExternal', { url, title, ua }),
  isTv: async () => !!((await call('deviceInfo')) || {}).tv,
  on(event, cb) {
    const p = P();
    if (p && p.addListener) p.addListener(event, cb);
  },
};

/** زر الرجوع في أندرويد (في المتصفح يتولى app.js مفتاح Escape). */
export function onBack(cb) {
  const App = isNative && C.Plugins && C.Plugins.App;
  if (App) App.addListener('backButton', cb);
}

export function exitApp() {
  const App = isNative && C.Plugins && C.Plugins.App;
  if (App) App.exitApp();
}
