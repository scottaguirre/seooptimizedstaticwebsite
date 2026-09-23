// models/KeywordCache.js
//
// Caches search volumes so two plumbers in Austin cost one DataForSEO call.
//
// WHY THIS IS THE WHOLE ECONOMICS OF THE FEATURE
//
// A lookup costs $0.09 per task, and the metro-plus-city design is two tasks.
// That is cheap per call and ruinous per thousand if every customer pays it
// afresh — so the decision not to charge for the wizard's lookup (see
// CLAUDE.md) rests on this file doing its job.
//
// It works because of what the inputs ARE. The key is a trade and a town, not
// a person: every plumber in Austin asks the same question and deserves the
// same answer. The cardinality is low by nature, so the hit rate climbs on its
// own as customers cluster into the metros and trades they already cluster in.
//
// THIRTY DAYS, AND WHY THAT IS HONEST RATHER THAN LAZY
//
// The number Google returns is an average of the last twelve months. It moves
// when a month rolls off the back, which is monthly. Caching for thirty days
// serves the same figure Google would have served; caching for a year would
// not.
//
// Modelled on models/PaaCache.js, which solves the same problem for ValueSERP
// questions — including the TTL index, so Mongo expires these itself and there
// is no cron job to forget about.

const mongoose = require('mongoose');

const keywordCacheSchema = new mongoose.Schema({
  // SHA-1 of the keywords + location + language + month, lowercased and
  // sorted, so the same question in any order is one entry.
  key: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },

  // Kept for debugging and for answering "what are people looking up?" later.
  // Not used to find the entry — the key is.
  location: String,
  language: String,
  keywordCount: Number,

  // [{ keyword, volume, cpc, competition, low, high }]
  results: [{
    _id: false,
    keyword: String,
    volume: Number,
    cpc: Number,
    competition: String,
    low: Number,
    high: Number,
  }],

  // What this entry saved. Every hit avoids spending it again, which is the
  // number that says whether the cache is earning its keep.
  costUsd: Number,

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

module.exports = mongoose.models.KeywordCache
  || mongoose.model('KeywordCache', keywordCacheSchema);
