'use strict';
/**
 * LiwaTube — قوائم التشغيل.
 */
const crypto = require('crypto');

const newId = () => `pl_${crypto.randomBytes(6).toString('hex')}`;

function create({ name, description = '', videos = [], ai = null }) {
  const now = Date.now();
  return {
    id: newId(),
    name: String(name || 'قائمة جديدة').slice(0, 80),
    description: String(description || '').slice(0, 400),
    videos: [...new Set(videos)],
    ai,
    createdAt: now,
    updatedAt: now,
  };
}

module.exports = { create, newId };
