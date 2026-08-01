// models/PaaCache.js
//
// Caches "People Also Ask" questions so regenerating a site doesn't re-charge
// ValueSERP credits. Each lookup costs 2 credits; a cache hit costs nothing.
//
// Expiry is handled by MongoDB itself via a TTL index on expiresAt — no cron
// job, no cleanup code. Mongo's background sweeper removes expired documents
// roughly once a minute.

const mongoose = require('mongoose');

const paaCacheSchema = new mongoose.Schema({
  // SHA-1 of the queries + location + device, lowercased and sorted, so
  // "Plumber Near Me" and "plumber near me" share one entry.
  key: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },

  // Kept for debugging: shows which searches produced these questions.
  queries: [String],
  location: String,
  device: String,

  questions: [String],

  fetchedAt: {
    type: Date,
    default: Date.now,
  },

  // TTL index. `expires: 0` means "delete once this date has passed".
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 },
  },
});

module.exports = mongoose.models.PaaCache
  || mongoose.model('PaaCache', paaCacheSchema);