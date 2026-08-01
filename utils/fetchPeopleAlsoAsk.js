// utils/fetchPeopleAlsoAsk.js
//
// Pulls "People Also Ask" questions from Google via ValueSERP.
//
// Google's PAA block only ever exposes ~4 questions on the initial SERP.
// The extra questions you see in a browser appear when you CLICK one, which
// injects more into the same block — ValueSERP has no parameter for that, and
// pagination returns page-2 organic results rather than an expanded block.
//
// So to reach 6 we run two related queries and merge them. Each returns ~4,
// they overlap partially, and after de-duplication there are reliably enough.
//
// Cost: 1 credit per query. Do NOT enable include_ai_overview_paa — it adds
// 1 credit PER QUESTION for Google's own AI answers, which we discard because
// we write our own with GPT. That flag alone turned a 1-credit request into 6.

const axios = require('axios');
const crypto = require('crypto');

const ENDPOINT = 'https://api.valueserp.com/search';
const MAX_QUESTIONS = 6;
const REQUEST_TIMEOUT_MS = 15000;

// Optional Mongo cache. Loaded lazily so this module works without it.
let PaaCache = null;
try {
  PaaCache = require('../models/PaaCache');
} catch (err) {
  // No model available — run uncached.
}

/** Stable key for a query so the cache survives whitespace/case differences. */
function cacheKey(queries, location, device) {
  const raw = JSON.stringify({
    q: queries.map(q => q.toLowerCase().trim()).sort(),
    location: String(location || '').toLowerCase().trim(),
    device,
  });
  return crypto.createHash('sha1').update(raw).digest('hex');
}

/** Case- and punctuation-insensitive key, so near-identical questions collapse. */
function questionKey(question) {
  return String(question || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * One ValueSERP call. Returns [] on any failure — a missing FAQ must never
 * fail a site generation.
 */
async function fetchOne(query, { apiKey, location, device, gl, hl, googleDomain }) {
  try {
    const { data } = await axios.get(ENDPOINT, {
      params: {
        api_key: apiKey,
        q: query,
        location,
        device,
        gl,
        hl,
        google_domain: googleDomain,
        // include_ai_overview_paa deliberately omitted — see header note
      },
      timeout: REQUEST_TIMEOUT_MS,
    });

    const questions = (data && Array.isArray(data.related_questions))
      ? data.related_questions.map(r => String(r && r.question || '').trim()).filter(Boolean)
      : [];

    console.log(`   PAA "${query}" → ${questions.length} question(s)`);
    return questions;

  } catch (err) {
    const detail = err.response
      ? `${err.response.status} ${JSON.stringify(err.response.data || {}).slice(0, 120)}`
      : err.message;
    console.warn(`   ⚠️ PAA query failed for "${query}": ${detail}`);
    return [];
  }
}

/**
 * Up to six PAA questions for a business.
 *
 * @param {object} opts
 *   keyword       primary search term, e.g. "plumber near me"
 *   businessType  used to build the second query, e.g. "Plumbing"
 *   location      free text, e.g. "Leander, TX"
 *   apiKey        defaults to process.env.VALUESERP_API_KEY
 * @returns {Promise<string[]>} 0–6 questions; [] when unavailable
 */
async function fetchPeopleAlsoAsk({
  keyword,
  businessType,
  location,
  apiKey = process.env.VALUESERP_API_KEY,
  device = 'mobile',
  gl = 'us',
  hl = 'en',
  googleDomain = 'google.com',
  useCache = true,
  cacheDays = 30,
} = {}) {

  if (!apiKey) {
    console.warn('   ⚠️ VALUESERP_API_KEY not set — skipping FAQ questions');
    return [];
  }

  const primary = String(keyword || '').trim();
  if (!primary) return [];

  // Second query: same intent, different phrasing, so Google returns a
  // partly different PAA block.
  const secondary = [businessType, location].filter(Boolean).join(' ').trim();

  const queries = [primary];
  if (secondary && questionKey(secondary) !== questionKey(primary)) {
    queries.push(secondary);
  }

  const key = cacheKey(queries, location, device);

  // ---- cache read ----
  if (useCache && PaaCache) {
    try {
      const hit = await PaaCache.findOne({ key }).lean();
      if (hit && Array.isArray(hit.questions) && hit.questions.length) {
        console.log(`   PAA cache hit (${hit.questions.length} question(s)) — 0 credits used`);
        return hit.questions.slice(0, MAX_QUESTIONS);
      }
    } catch (err) {
      console.warn('   ⚠️ PAA cache read failed:', err.message);
    }
  }

  // ---- fetch ----
  const seen = new Set();
  const merged = [];

  for (const query of queries) {
    if (merged.length >= MAX_QUESTIONS) break;

    const questions = await fetchOne(query, { apiKey, location, device, gl, hl, googleDomain });

    for (const question of questions) {
      const qk = questionKey(question);
      if (!qk || seen.has(qk)) continue;
      seen.add(qk);
      merged.push(question);
      if (merged.length >= MAX_QUESTIONS) break;
    }
  }

  console.log(`   PAA total after merge: ${merged.length} question(s)`);

  // ---- cache write ----
  if (useCache && PaaCache && merged.length) {
    try {
      await PaaCache.findOneAndUpdate(
        { key },
        {
          key,
          queries,
          location: String(location || ''),
          device,
          questions: merged,
          expiresAt: new Date(Date.now() + cacheDays * 24 * 60 * 60 * 1000),
        },
        { upsert: true }
      );
    } catch (err) {
      console.warn('   ⚠️ PAA cache write failed:', err.message);
    }
  }

  return merged;
}

module.exports = { fetchPeopleAlsoAsk, questionKey, MAX_QUESTIONS };