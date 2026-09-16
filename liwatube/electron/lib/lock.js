'use strict';
/**
 * LiwaTube — قفل التطبيق برمز PIN (خصوصية). يُخزَّن مشتقّ scrypt فقط، لا الرمز نفسه.
 */
const crypto = require('crypto');

const N = 16384; const r = 8; const p = 1; const KEYLEN = 32;

function hashPin(pin, salt = crypto.randomBytes(16)) {
  const s = Buffer.isBuffer(salt) ? salt : Buffer.from(salt, 'hex');
  const key = crypto.scryptSync(String(pin), s, KEYLEN, { N, r, p });
  return { salt: s.toString('hex'), hash: key.toString('hex') };
}

function verifyPin(pin, record) {
  if (!record || !record.salt || !record.hash) return false;
  const { hash } = hashPin(pin, record.salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(record.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validPin(pin) {
  return /^\d{4,8}$/.test(String(pin || ''));
}

module.exports = { hashPin, verifyPin, validPin };
