/* LiwaIPTV — تخزين محلي مفتاح/قيمة في IndexedDB (يتسع لقوائم بعشرات آلاف
   العناصر، بخلاف localStorage). */
'use strict';

const DB_NAME = 'liwaiptv';
const DB_STORE = 'kv';

let dbPromise = null;
function db() {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('no-idb'));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(DB_STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function idb(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(DB_STORE, mode);
    const req = fn(tx.objectStore(DB_STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const memory = new Map(); // بديل عند غياب IndexedDB (الاختبارات)

export const store = {
  get: (key) => idb('readonly', (s) => s.get(key)).then((v) => (v === undefined ? null : v)).catch(() => (memory.has(key) ? memory.get(key) : null)),
  set: (key, value) => idb('readwrite', (s) => s.put(value, key)).then(() => true).catch(() => { memory.set(key, value); return true; }),
  remove: (key) => idb('readwrite', (s) => s.delete(key)).then(() => true).catch(() => { memory.delete(key); return true; }),
};
