// utils/buildRegistry.js
const crypto = require('crypto');

const registry = new Map(); // id -> { outputDir, meta, createdAt }

function createBuildRecord(outputDir, meta = {}) {
  const id = crypto.randomBytes(6).toString('hex');
  registry.set(id, { outputDir, meta, createdAt: Date.now() });
  return id;
}

function getBuildRecord(id) {
  return registry.get(id) || null;
}

function prune(maxAgeMs = 60 * 60 * 1000) { // 1 hour
  const now = Date.now();
  for (const [id, rec] of registry) {
    if (now - rec.createdAt > maxAgeMs) registry.delete(id);
  }
}

module.exports = { createBuildRecord, getBuildRecord, prune };
