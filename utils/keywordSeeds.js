// utils/keywordSeeds.js
//
// Extra seed terms for the keyword research page, proposed by a model.
//
// WHY THE MODEL IS ALLOWED ANYWHERE NEAR THIS
//
// It is not allowed near the ANSWERS. It proposes words to ask Google about;
// DataForSEO says whether anyone searches them. If the model invents
// "hydro-jet lateral scoping", the lookup comes back with no volume and the
// row is filtered out before anybody sees it. A hallucination here costs
// nothing and shows nothing — which is the only arrangement under which a
// model belongs in a tool whose entire value is that its numbers are real.
//
// WHAT IT IS FOR
//
// keywordVolumes.seedsFor() builds the mechanical seeds: the trade, and the
// trade paired with the town. Those are free and deterministic, and they are
// also narrow. "Plumbing" will never lead Google to "water heater
// installation" or "sewer line repair" on its own; a plumber knows those, and
// so does a model. Edwin's own Keyword Planner query was three hand-typed
// seeds for exactly this reason.
//
// The alternative was a hand-written list per industry. It covers plumbing
// and roofing well, covers lemon law and web design not at all, and goes
// stale in a drawer where nobody notices. A model covers every industry the
// app will ever sell to, including ones added after this file stops being
// read.
//
// WHY IT IS CACHED BY INDUSTRY AND NOT BY INDUSTRY + TOWN
//
// THIS IS THE PART THAT PROTECTS THE BILL, and it is easy to get wrong.
//
// The DataForSEO cache key is the sorted seed list. If this function returns
// [drain cleaning, water heater repair] today and [water heater repair, drain
// cleaning, leak detection] tomorrow, that is a different key — a cache miss,
// and another $0.09 for a question already paid for. A model is not
// deterministic, so left to itself it would quietly defeat the cache it sits
// in front of.
//
// Caching by industry ALONE fixes it, and is also just true: water heater
// installation is related to plumbing in Cedar Park and in Austin equally.
// One model call per industry, thirty days, and every town after the first
// reuses the same seeds and so hits the DataForSEO cache normally.
//
// The town is still passed to the model — a trade's vocabulary shifts a
// little by region — but only as flavour, never as part of the key. See
// buildPrompt.

const crypto = require('crypto');

// Lazily required, for the reason suggestServices.js gives at its own
// imports: utils/openaiClient pulls in the `openai` package, and a top-level
// require would mean cleanSeeds() — which touches no network — could not be
// tested without it installed.

/** How many the model is asked for, and the hard ceiling on what it returns. */
const MAX_SEED_TERMS = 14;

/** Thirty days, matching models/KeywordCache. */
const CACHE_DAYS = 30;

/**
 * Longer than this is not a search term, it is a sentence.
 *
 * Google's own limit for a keyword is 80 characters; anything approaching it
 * is a model that has misunderstood the question, and sending it wastes one
 * of twenty seed slots.
 */
const MAX_TERM_LENGTH = 60;

/** The logger, fetched only when something needs logging. Same reasoning. */
function log() {
  return require('./logger').log;
}

/* ------------------------------------------------------------------ *
 * Tidying what comes back
 * ------------------------------------------------------------------ */

/**
 * Turn whatever the model said into seeds worth spending a slot on.
 *
 * Deliberately strict. A bad seed is not free: it occupies one of twenty
 * slots that a good seed could have had, and unlike a bad SERVICE name — which
 * a customer sees and unticks — a bad seed is invisible. Nobody ever finds out
 * that the list would have been better.
 *
 * @param {*} terms       whatever came back, which may not be an array
 * @param {object} opts
 * @param {string} [opts.industry]  dropped, because seedsFor() adds it first
 * @param {string} [opts.city]      dropped, because seedsFor() pairs it itself
 * @param {number} [opts.limit]
 */
function cleanSeeds(terms, opts = {}) {
  if (!Array.isArray(terms)) return [];

  const limit = Math.max(1, Math.min(Number(opts.limit) || MAX_SEED_TERMS, MAX_SEED_TERMS));

  const industry = String(opts.industry || '').trim().toLowerCase();
  const city = String(opts.city || '').trim().toLowerCase();

  const seen = new Set();
  const out = [];

  for (const raw of terms) {
    // A model asked for an array of strings occasionally returns an array of
    // objects. Taking .keyword or .term costs one line and saves the whole
    // reply from being thrown away.
    const value = typeof raw === 'string'
      ? raw
      : (raw && (raw.keyword || raw.term || raw.name)) || '';

    const term = String(value)
      .toLowerCase()
      // A list marker at the FRONT only: "- drain cleaning", "2. sewer line".
      // A model told to return JSON sometimes returns JSON containing the
      // bullets it would have written in prose.
      //
      // Leading hyphens are worth their own rule rather than a blanket strip,
      // because a hyphen INSIDE a term is real — "24-hour plumber" — while a
      // hyphen in front of one is a minus operator to Google's matcher, which
      // would quietly exclude the very thing being asked about.
      .replace(/^[\s\-–—*•]+/, '')
      .replace(/^\d+[.)]\s*/, '')
      // Quotes and backticks survive a JSON parse and mean nothing to the
      // matcher either.
      .replace(/["'`*•]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!term) continue;
    if (term.length > MAX_TERM_LENGTH) continue;

    // Nothing but punctuation, or a bare number.
    if (!/[a-z]/.test(term)) continue;

    // The industry itself is seedsFor()'s first entry already, and the town
    // pairings are its second and third. A model repeating them would spend
    // slots on questions already being asked.
    if (term === industry) continue;
    if (city && term.includes(city)) continue;

    if (seen.has(term)) continue;

    seen.add(term);
    out.push(term);

    if (out.length >= limit) break;
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * The prompt
 * ------------------------------------------------------------------ */

function buildPrompt({ industry, location = '', count = MAX_SEED_TERMS }) {
  // Region as flavour only — "sprinkler repair" is a Texas plumbing search
  // and a rarity in Maine. It is NOT in the cache key; see the header.
  const where = location
    ? `The business is in ${location}, so favour the vocabulary used there.\n`
    : '';

  return `You are listing SEED TERMS for a Google Keyword Planner lookup for the
${industry} industry.
${where}
A seed term is a short phrase that a Google keyword tool can expand into
hundreds of related searches. It is NOT a finished keyword and NOT a page
name — it is the doorway into a part of the trade.

Return exactly ${count} of them, covering DIFFERENT parts of what this
industry sells. If two terms would expand into the same searches, one of them
is wasted.

Each term must be:
- Two to four words, lower case, no punctuation.
- Something a member of the public would type, not an industry term.
  Good: "water heater installation". Bad: "potable water system commissioning".
- A distinct area of work, not a restatement.
  If you list "drain cleaning", do not also list "drain cleaner" or
  "cleaning drains". They open the same door.

Do NOT include:
- The word "${industry}" on its own.
- Any town, city or state name. The tool pairs those itself.
- "near me", "best", "cheap", "affordable", "emergency" as the whole point of
  the term. The expansion adds those; a seed spent on one is a seed wasted.

Return JSON only:
{"terms": ["first term", "second term", ...]}`;
}

/* ------------------------------------------------------------------ *
 * The cache key
 * ------------------------------------------------------------------ */

/**
 * Industry and month. Deliberately NOT the town — see the header.
 *
 * The month is in it for the same reason keywordVolumes.cacheKey has one: an
 * entry should not outlive its own accuracy even if the TTL index somehow is
 * not doing its job.
 */
function seedCacheKey(industry, { month }) {
  const parts = ['seeds', String(industry || '').trim().toLowerCase(), String(month || '')];
  return crypto.createHash('sha1').update(parts.join('\u0000')).digest('hex');
}

/** "2026-09". Matches keywordVolumes.currentMonth. */
function currentMonth(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ *
 * The call
 * ------------------------------------------------------------------ */

/**
 * Seed terms for an industry, cached.
 *
 * NEVER THROWS. This is a widener, not a requirement: the research page works
 * without it — less well, on the mechanical seeds alone — and a model outage
 * must not take down a lookup the customer could still have had. Every
 * failure path returns an empty list and logs.
 *
 * @param {string} industry
 * @param {object} opts
 * @param {string} [opts.location]  "Cedar Park, TX", flavour only
 * @param {string} [opts.city]      dropped from the reply, not sent to it
 * @param {number} [opts.limit]
 * @param {object} [opts.Model]     injected cache model, for tests
 * @param {object} [opts.client]    injected model client, for tests
 * @param {function} [opts.now]
 *
 * @returns {{ terms: string[], cached: boolean, usage: object|null }}
 */
async function seedTermsFor(industry, opts = {}) {
  const trade = String(industry || '').trim();
  if (!trade) return { terms: [], cached: false, usage: null };

  const limit = Math.max(1, Math.min(Number(opts.limit) || MAX_SEED_TERMS, MAX_SEED_TERMS));
  const now = opts.now ? opts.now() : new Date();
  const key = seedCacheKey(trade, { month: currentMonth(now) });

  const Model = opts.Model || require('../models/KeywordCache');

  try {
    const hit = await Model.findOne({ key }).lean();
    if (hit) {
      return {
        // Stored in the same `results` array the volume entries use, one
        // `keyword` per term — so no schema change, and the TTL index that
        // expires those expires these.
        terms: cleanSeeds(
          (hit.results || []).map(r => r && r.keyword),
          { industry: trade, city: opts.city, limit }
        ),
        cached: true,
        usage: null,
      };
    }
  } catch (err) {
    // A cache that cannot be read is a slow path, not a broken one.
    log().error('keywords.seedCacheReadFailed', err, { industry: trade });
  }

  let terms = [];
  let usage = null;

  try {
    const { parseModelJson } = require('./parseModelJson');
    const client = opts.client || require('./openaiClient').getOpenAI();

    const response = await client.responses.create({
      model: opts.model || process.env.SUGGEST_MODEL || 'gpt-5.6-terra',
      input: buildPrompt({ industry: trade, location: opts.location, count: limit }),
      // Recall, like suggestServices — listing the parts of a trade, not
      // reasoning about them.
      reasoning: { effort: opts.effort || 'low' },
      text: { verbosity: 'low' },
    });

    const parsed = parseModelJson(response.output_text, { label: 'keyword seeds' });

    terms = cleanSeeds(
      parsed.ok && parsed.data ? parsed.data.terms : [],
      { industry: trade, city: opts.city, limit }
    );

    usage = readUsage(response);

  } catch (err) {
    log().error('keywords.seedsFailed', err, { industry: trade });
    return { terms: [], cached: false, usage: null };
  }

  // NOT CACHED WHEN EMPTY. An empty list stored for thirty days is thirty
  // days of narrow lookups caused by one bad minute from the model.
  if (terms.length) {
    try {
      await Model.updateOne(
        { key },
        {
          $set: {
            key,
            location: '',
            language: 'English',
            keywordCount: terms.length,
            results: terms.map(keyword => ({ keyword })),
            costUsd: 0,
            fetchedAt: now,
            expiresAt: new Date(now.getTime() + CACHE_DAYS * 24 * 60 * 60 * 1000),
          },
        },
        { upsert: true }
      );
    } catch (err) {
      log().error('keywords.seedCacheWriteFailed', err, { industry: trade });
    }
  }

  return { terms, cached: false, usage };
}

/** Token counts for the log, when the client reports them. */
function readUsage(response) {
  const usage = response && response.usage;
  if (!usage) return null;

  const input = Number(usage.input_tokens ?? usage.prompt_tokens);
  const output = Number(usage.output_tokens ?? usage.completion_tokens);
  const total = Number(usage.total_tokens);

  return {
    input: Number.isFinite(input) ? input : null,
    output: Number.isFinite(output) ? output : null,
    total: Number.isFinite(total)
      ? total
      : (Number.isFinite(input) && Number.isFinite(output) ? input + output : null),
  };
}

module.exports = {
  seedTermsFor,
  cleanSeeds,
  buildPrompt,
  seedCacheKey,
  currentMonth,
  readUsage,
  MAX_SEED_TERMS,
  MAX_TERM_LENGTH,
  CACHE_DAYS,
};
