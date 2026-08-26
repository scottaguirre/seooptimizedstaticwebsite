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
// THE SECOND QUERY IS OPTIONAL
//
// The home page wants six questions, so it needs both queries. secondQuery
// and maxQuestions exist for any caller that wants one cheap query instead.
//
// NOTE: nothing currently passes them. They were added for per-town location
// page lookups, which have since been removed — Google returns the STATE's
// PAA block for a small-town query, so every town got the same questions.
// See utils/generateLocationFaq.js. The options are kept because they are
// tested and a single-credit lookup is a reasonable thing to want; the header
// says so rather than implying a caller that does not exist.
//
// Cost: 1 credit per query. Do NOT enable include_ai_overview_paa — it adds
// 1 credit PER QUESTION for Google's own AI answers, which we discard because
// we write our own with GPT. That flag alone turned a 1-credit request into 6.

const axios = require('axios');
const { log } = require('./logger');
const crypto = require('crypto');

const ENDPOINT = 'https://api.valueserp.com/search';
const MAX_QUESTIONS = 6;
// ValueSERP normally answers in a few seconds, but it scrapes a live SERP,
// so a slow upstream can push well past that. 15s was too tight and produced
// timeouts on both queries; 45s with one retry is far more forgiving.
const REQUEST_TIMEOUT_MS = 45000;
const RETRY_ATTEMPTS = 2;

// === QUOTA CIRCUIT BREAKER ===
//
// When the ValueSERP account runs out of credits every request returns 402.
// Without this, a site with five location pages sends five doomed requests
// and waits out the full round trip on each one — a real build spent close to
// two minutes discovering the same thing three times:
//
//   ⚠️ PAA query failed for "Plumbing Cedar Park, TX": 402 … used all of your…
//   ⚠️ PAA query failed for "Plumbing Round Rock, TX": 402 … used all of your…
//   ⚠️ PAA query failed for "Plumbing Georgetown, TX": 402 … used all of your…
//
// The first 402 (or 401/403 — a dead or wrong key behaves the same way) opens
// the breaker and the rest of the build skips the network entirely.
//
// TIME-BOXED, not permanent. The server is long-running: a permanent flag
// would keep every later generation FAQ-less until someone restarted the
// process, even after the account was topped up. Ten minutes is long enough
// to cover the build that hit the wall and short enough that a top-up is
// picked up on its own.
//
// The CACHE IS CHECKED FIRST and is unaffected — a cached town still gets its
// FAQ while the breaker is open, because that costs nothing.
const QUOTA_COOLDOWN_MS = 10 * 60 * 1000;
let quotaBlockedUntil = 0;

/** True while the breaker is open. */
function quotaBlocked() {
  return Date.now() < quotaBlockedUntil;
}

/** Open the breaker. Called on the first 401/402/403. */
function blockQuota(status) {
  if (quotaBlocked()) return;
  quotaBlockedUntil = Date.now() + QUOTA_COOLDOWN_MS;
  const minutes = Math.round(QUOTA_COOLDOWN_MS / 60000);
  console.warn(`   ⚠️ ValueSERP returned ${status} — skipping all further FAQ lookups for ${minutes} minutes. Pages build without an FAQ.`);
  log.external('valueserp', 'quotaBlocked', { status, cooldownMs: QUOTA_COOLDOWN_MS });
}

/** Close the breaker by hand — for tests, or after topping up credits. */
function resetQuotaBlock() {
  quotaBlockedUntil = 0;
}

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
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
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
      const isLast = attempt === RETRY_ATTEMPTS;

      // A 4xx means the request itself is wrong (bad key, bad params) — no
      // point retrying, and each attempt may still cost a credit.
      const status = err.response && err.response.status;
      const worthRetrying = !status || status >= 500;

      // Out of credits, bad key, or key rejected. Nothing later in this build
      // will fare any better, so stop the rest of them reaching the network.
      if (status === 401 || status === 402 || status === 403) blockQuota(status);

      const detail = err.response
        ? `${status} ${JSON.stringify(err.response.data || {}).slice(0, 120)}`
        : err.message;

      if (!worthRetrying || isLast) {
        console.warn(`   ⚠️ PAA query failed for "${query}": ${detail}`);
        log.external('valueserp', 'failed', {
          query,
          status: status || null,
          detail,
          attempts: attempt,
        });
        return [];
      }

      console.warn(`   ⚠️ PAA attempt ${attempt} failed for "${query}" (${detail}) — retrying`);
    }
  }

  return [];
}

/**
 * Up to six PAA questions for a business.
 *
 * @param {object} opts
 *   keyword       primary search term, e.g. "plumber near me"
 *   businessType  used to build the second query, e.g. "Plumbing"
 *   location      free text, e.g. "Leander, TX"
 *   apiKey        defaults to process.env.VALUESERP_API_KEY
 *   secondQuery   run the "<businessType> <location>" query too. Default true
 *                 (the home page needs six questions). Pass false for a page
 *                 whose primary query is already local — one credit, ~4
 *                 questions.
 *   maxQuestions  cap on the merged list. Default 6.
 * @returns {Promise<string[]>} 0–maxQuestions questions; [] when unavailable
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
  secondQuery = true,
  maxQuestions = MAX_QUESTIONS,
} = {}) {

  // A caller asking for four questions must not be handed a six-question
  // cache entry, and vice versa — but the cache key is built from the QUERY
  // list, and the query list already differs when secondQuery is off. Single
  // and double query runs therefore never share a cache row.
  const limit = Math.max(1, Number(maxQuestions) || MAX_QUESTIONS);

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
  if (secondQuery && secondary && questionKey(secondary) !== questionKey(primary)) {
    queries.push(secondary);
  }

  const key = cacheKey(queries, location, device);

  // ---- cache read ----
  if (useCache && PaaCache) {
    try {
      const hit = await PaaCache.findOne({ key }).lean();
      if (hit && Array.isArray(hit.questions) && hit.questions.length) {
        console.log(`   PAA cache hit (${hit.questions.length} question(s)) — 0 credits used`);
        return hit.questions.slice(0, limit);
      }
    } catch (err) {
      console.warn('   ⚠️ PAA cache read failed:', err.message);
    }
  }

  // ---- circuit breaker ----
  // AFTER the cache read, BEFORE the network. A cached town still gets its
  // FAQ while the breaker is open; an uncached one skips the doomed request
  // instead of waiting out a 45-second round trip to be told again that the
  // account has no credits.
  if (quotaBlocked()) {
    console.warn(`   ⚠️ Skipping PAA for "${primary}" — ValueSERP quota block still in effect`);
    return [];
  }

  // ---- fetch ----
  // Both queries run at once when there are two. Google returns ~4 questions
  // per query and the home page wants 6, so the second call is effectively
  // always needed there — running them sequentially just doubled the wait for
  // no saving. With secondQuery:false this is a single request.
  const results = await Promise.all(
    queries.map(query => fetchOne(query, { apiKey, location, device, gl, hl, googleDomain }))
  );

  const seen = new Set();
  const merged = [];

  for (const questions of results) {
    for (const question of questions) {
      const qk = questionKey(question);
      if (!qk || seen.has(qk)) continue;
      seen.add(qk);
      merged.push(question);
      if (merged.length >= limit) break;
    }
    if (merged.length >= limit) break;
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

module.exports = {
  fetchPeopleAlsoAsk,
  questionKey,
  MAX_QUESTIONS,
  quotaBlocked,
  resetQuotaBlock,
};