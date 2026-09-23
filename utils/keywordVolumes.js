// utils/keywordVolumes.js
//
// What people actually search for, and how often, in a given town.
//
// WHY THIS EXISTS
//
// utils/suggestServices.js names the pages a trade could have. It has no idea
// which of them anyone searches for. A customer with credits for eight pages
// picks the first eight on a list ordered by a model's sense of what plumbers
// usually sell — which is a reasonable guess and nothing more.
//
// This turns the guess into a number. "Water heater replacement, 390 a month
// in Austin" is an argument for a page; "Water heater replacement" is a name.
//
// WHERE THE NUMBERS COME FROM, AND WHY NOT GOOGLE DIRECTLY
//
// DataForSEO's keywords_data/google_ads endpoints are a passthrough to the
// Google Ads API — they hold the developer token and the Standard access that
// KeywordPlanIdeaService requires and that Basic access cannot get.
//
// This was verified rather than assumed. On 23 September, 1,773 keywords from
// Edwin's own Keyword Planner were compared against this endpoint across two
// towns: every single one matched, and every top-of-page bid matched to the
// cent. See tools/keyword-compare.js and the table in CLAUDE.md.
//
// THE REPORTING FLOOR, WHICH IS THIS MODULE'S HARDEST PROBLEM
//
// Google will not report below about 10 searches a month; it rounds to tens
// and then gives up. In Cedar Park that swallowed 774 of 780 keywords. In
// AUSTIN — a city of a million — it still swallowed 930 of 993.
//
// So a single-city lookup returns almost nothing but zeros, and a screen full
// of zeros tells a contractor his website is pointless. That is why
// `volumesFor` takes a metro as well as a town: the metro orders the list and
// the town says how it looks locally. Neither number alone is usable.

const crypto = require('crypto');

/**
 * The logger, fetched when something actually needs logging.
 *
 * NOT a top-level require, for the reason suggestServices.js gives about
 * openaiClient: utils/logger.js pulls in pino, and pino in development pulls
 * in pino-pretty. A top-level require would mean the cache key, the brand
 * filter and readResult — none of which log anything or touch a network —
 * could not be tested without the whole logging stack installed.
 *
 * Only the two cache error paths call this, and both are exercised by the
 * suite with a stub.
 */
function log() {
  return require('./logger').log;
}

const ENDPOINT =
  'https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live';

/** DataForSEO's own cap per task. Sending more is an error, not a truncation. */
const MAX_KEYWORDS = 1000;

/** What one task costs, live mode, for the cost log. */
const COST_PER_TASK_USD = 0.09;

/** Thirty days. See the header of models/KeywordCache.js for why. */
const CACHE_DAYS = 30;

/**
 * Below this, Google is rounding to tens and a 10 means the same as a 0.
 *
 * Measured, not chosen: 930 of 993 Austin keywords sit at or under it. Callers
 * use it to decide what is worth showing, never to decide what is true.
 */
const NOISE_FLOOR = 40;

/**
 * Keywords that are somebody's business, not a service.
 *
 * Roughly a third of Austin's above-floor keywords were competitors — goettl,
 * fergusons, roto rooter, reliance, rogers, wilson's, pecks, crows. They carry
 * real volume and are worthless as pages: nobody wants a service page called
 * "Goettl Plumbing", and one built anyway would rank for a competitor's name
 * and convert nobody.
 *
 * They cannot be listed, because the list is every plumbing company in
 * America. They can be RECOGNISED: a brand query is a proper noun plus the
 * trade, with none of the words that describe work. That is what this tests.
 */
const SERVICE_WORDS = new Set([
  'repair', 'repairs', 'replacement', 'replace', 'install', 'installation',
  'service', 'services', 'cleaning', 'clean', 'maintenance', 'inspection',
  'emergency', 'cost', 'near', 'me', 'my', 'best', 'cheap', 'affordable',
  'local', 'licensed', 'certified', 'commercial', 'residential', '24',
  'hour', 'hr', 'same', 'day', 'leak', 'detection', 'unclog', 'clogged',
  'blocked', 'broken', 'new', 'free', 'quote', 'estimate', 'prices',
  'pricing', 'rates', 'company', 'companies', 'contractor', 'contractors',
]);

/* ------------------------------------------------------------------ *
 * The cache key
 * ------------------------------------------------------------------ */

/**
 * One key for one question, however it was phrased.
 *
 * Lowercased and SORTED, so asking for the same twenty services in a different
 * order is a hit rather than a second $0.09. The month is in the key because
 * the answer changes when a month rolls off Google's twelve-month average —
 * which also means an entry cannot outlive its own accuracy even if the TTL
 * index were somehow not doing its job.
 */
function cacheKey(keywords, { location, language, month }) {
  const parts = [
    String(location || '').trim().toLowerCase(),
    String(language || '').trim().toLowerCase(),
    String(month || ''),
    ...[...keywords].map(k => String(k).trim().toLowerCase()).sort(),
  ];

  return crypto.createHash('sha1').update(parts.join('\u0000')).digest('hex');
}

/** "2026-09" — the month Google's twelve-month window currently ends in. */
function currentMonth(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ *
 * Reading the answer
 * ------------------------------------------------------------------ */

/**
 * Is this keyword a company's name rather than a job?
 *
 * The test is what the words DO, not what they are. A service query contains
 * at least one word about the work — repair, install, near me, emergency. A
 * brand query is a name plus the trade and nothing else.
 *
 * Deliberately conservative. A false positive hides a real service from the
 * customer, which is worse than letting one competitor name through: they can
 * see a bad suggestion and ignore it, but they cannot see one that was never
 * shown.
 */
function looksLikeBrand(keyword, businessType = '') {
  const words = String(keyword || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) return false;

  // The trade's own words are not evidence either way — "plumbing" appears in
  // "plumbing repair" and in "Smith Plumbing" alike.
  const tradeWords = new Set(
    String(businessType || '').toLowerCase().split(/\s+/).filter(Boolean)
  );

  const rest = words.filter(w => !tradeWords.has(w) && !isTradeish(w));

  // Nothing but the trade: "plumbing", "plumber". Generic, not a brand.
  if (!rest.length) return false;

  // Any word that describes work makes it a service query.
  const hasServiceWord = rest.some(w => SERVICE_WORDS.has(w));

  return !hasServiceWord;
}

/**
 * The trade's own vocabulary, beyond the business type string.
 *
 * "plumber" and "plumbing" are the same trade; a businessType of "Plumbing"
 * would not otherwise match "plumber". Cheap stemming, deliberately — a real
 * stemmer is a dependency for a job that a suffix strip does.
 */
function isTradeish(word) {
  return /^(plumb|roof|electric|hvac|plumbing|rooter|drain|sewer)/.test(word);
}

/** One row of DataForSEO's answer, in the shape the rest of the app wants. */
function readResult(item) {
  const num = v => (v == null || Number.isNaN(Number(v)) ? null : Number(v));

  return {
    keyword: String(item.keyword || '').trim(),
    volume: item.search_volume == null ? null : Number(item.search_volume),
    cpc: num(item.cpc),
    competition: item.competition == null ? '' : String(item.competition),
    low: num(item.low_top_of_page_bid),
    high: num(item.high_top_of_page_bid),
  };
}

/* ------------------------------------------------------------------ *
 * The call
 * ------------------------------------------------------------------ */

/**
 * Ask DataForSEO. No cache, no fallback — `volumesFor` wraps this.
 *
 * Exported so the cache and the network call can be tested apart from each
 * other: this one needs a stubbed fetch, and everything above it does not.
 */
async function fetchVolumes(keywords, opts = {}) {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;

  if (!login || !password) {
    throw new Error('keyword volumes: DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD are not set');
  }

  const list = [...keywords].slice(0, MAX_KEYWORDS);
  if (!list.length) return { results: [], costUsd: 0 };

  const task = {
    keywords: list,
    language_name: opts.language || 'English',
    location_name: opts.location,
    search_partners: false,
  };

  const auth = Buffer.from(`${login}:${password}`).toString('base64');

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([task]),
  });

  const body = await res.json();

  if (!res.ok) {
    throw new Error(`keyword volumes: HTTP ${res.status} from DataForSEO`);
  }

  // Their transport is always 200 at the top level; the real status is inside,
  // so a naive `res.ok` check would treat a failed task as an empty answer.
  const t = (body.tasks || [])[0];
  if (!t) throw new Error('keyword volumes: DataForSEO returned no task');

  if (t.status_code !== 20000) {
    throw new Error(`keyword volumes: DataForSEO task ${t.status_code}: ${t.status_message}`);
  }

  return {
    results: (t.result || []).filter(r => r && r.keyword).map(readResult),
    // Their reported cost when they give one; our own constant otherwise, so
    // the log is never silently zero.
    costUsd: typeof t.cost === 'number' ? t.cost : COST_PER_TASK_USD,
  };
}

/* ------------------------------------------------------------------ *
 * The cached call
 * ------------------------------------------------------------------ */

/**
 * Volumes for a list of keywords in one place, cached.
 *
 * @param {string[]} keywords
 * @param {object} opts
 * @param {string} opts.location   "Austin,Texas,United States"
 * @param {string} [opts.language] default English
 * @param {object} [opts.Model]    the cache model; injectable for tests
 * @param {function} [opts.now]    injectable clock, for the month and the TTL
 *
 * @returns {{ results: Array, cached: boolean, costUsd: number }}
 *   `cached` is what the rate limiter reads: a hit cost nothing and must not
 *   be charged against anybody's budget.
 */
/**
 * The list actually sent, deduped case-insensitively to agree with the key.
 *
 * cacheKey() lowercases before hashing, so it considers "Plumber" and
 * "plumber" the same question. If the list sent did not, the two spellings
 * would occupy two of the thousand slots, come back as two identical rows,
 * and — because the key is built from the list — land in a DIFFERENT cache
 * entry from the same question asked in one case. A test caught this.
 *
 * The first spelling wins, because it is the one the caller chose to show.
 */
function keywordList(keywords) {
  const seen = new Set();
  const list = [];

  for (const raw of (Array.isArray(keywords) ? keywords : [])) {
    const keyword = String(raw || '').trim();
    if (!keyword) continue;

    const lower = keyword.toLowerCase();
    if (seen.has(lower)) continue;

    seen.add(lower);
    list.push(keyword);

    if (list.length >= MAX_KEYWORDS) break;
  }

  return list;
}

/**
 * What the cache already holds for this question, without fetching anything.
 *
 * Exported because the ROUTE needs to know before it decides whether to spend
 * the caller's rate-limit budget: a hit costs nothing, so it must not count.
 * Answering that by calling volumesFor and looking at `cached` afterwards
 * would be too late — the limiter runs first.
 *
 * @returns {Array|null} the rows, or null for a miss. A cache ERROR is a miss:
 *   Mongo being down is a reason to pay $0.09, not a reason to fail.
 */
async function cachedVolumesFor(keywords, opts = {}) {
  const Model = opts.Model || require('../models/KeywordCache');
  const now = opts.now ? opts.now() : new Date();

  const location = opts.location;
  const language = opts.language || 'English';

  if (!location) throw new Error('keyword volumes: a location is required');

  const list = keywordList(keywords);
  if (!list.length) return null;

  const key = cacheKey(list, { location, language, month: currentMonth(now) });

  try {
    const hit = await Model.findOne({ key }).lean();
    return hit ? (hit.results || []) : null;
  } catch (err) {
    log().error('keywords.cacheReadFailed', err, { location });
    return null;
  }
}

async function volumesFor(keywords, opts = {}) {
  const Model = opts.Model || require('../models/KeywordCache');
  const now = opts.now ? opts.now() : new Date();

  const location = opts.location;
  const language = opts.language || 'English';

  if (!location) throw new Error('keyword volumes: a location is required');

  const list = keywordList(keywords);

  if (!list.length) return { results: [], cached: false, costUsd: 0 };

  const key = cacheKey(list, { location, language, month: currentMonth(now) });

  const hit = await cachedVolumesFor(list, opts);

  if (hit) {
    return { results: hit, cached: true, costUsd: 0 };
  }

  const { results, costUsd } = await fetchVolumes(list, { location, language });

  const expiresAt = new Date(now.getTime() + CACHE_DAYS * 24 * 60 * 60 * 1000);

  try {
    // upsert, not create: two customers can ask the same question at the same
    // moment, and the second one losing a race should not throw a duplicate
    // key error at somebody filling in a form.
    await Model.updateOne(
      { key },
      {
        $set: {
          key, location, language,
          keywordCount: list.length,
          results, costUsd,
          fetchedAt: now,
          expiresAt,
        },
      },
      { upsert: true }
    );
  } catch (err) {
    log().error('keywords.cacheWriteFailed', err, { location });
  }

  return { results, cached: false, costUsd };
}

/**
 * The pair the wizard actually shows: ordered by the metro, labelled by town.
 *
 * NEITHER NUMBER WORKS ALONE. The town's numbers are almost all under the
 * floor, so they cannot order anything; the metro's numbers are real but
 * describe somewhere the customer does not live. Shown together — "390 a month
 * in Austin, 10 in Cedar Park" — they say both what to build and why.
 *
 * Two tasks, so $0.18, and both halves cache independently: a second plumber
 * in Cedar Park pays nothing for either.
 */
async function volumesForArea(keywords, opts = {}) {
  const { metro, city } = opts;

  if (!metro) throw new Error('keyword volumes: a metro is required');

  const metroCall = await volumesFor(keywords, { ...opts, location: metro });

  // The city is optional: somebody IN the metro has no second place to ask
  // about, and asking twice for one answer would be a wasted task.
  const cityCall = city && city !== metro
    ? await volumesFor(keywords, { ...opts, location: city })
    : { results: [], cached: true, costUsd: 0 };

  const cityBy = new Map(
    cityCall.results.map(r => [r.keyword.toLowerCase(), r])
  );

  const rows = metroCall.results
    .map(r => ({
      keyword: r.keyword,
      metroVolume: r.volume,
      cityVolume: (cityBy.get(r.keyword.toLowerCase()) || {}).volume ?? null,
      cpc: r.cpc,
      competition: r.competition,
      low: r.low,
      high: r.high,
      brand: looksLikeBrand(r.keyword, opts.businessType),
    }))
    // Ordered by the metro, because that is the number with signal in it.
    .sort((a, b) => (b.metroVolume || 0) - (a.metroVolume || 0));

  return {
    rows,
    metro,
    city: city || null,
    cached: metroCall.cached && cityCall.cached,
    costUsd: metroCall.costUsd + cityCall.costUsd,
  };
}

module.exports = {
  volumesFor,
  cachedVolumesFor,
  keywordList,
  volumesForArea,
  fetchVolumes,
  cacheKey,
  currentMonth,
  looksLikeBrand,
  readResult,
  MAX_KEYWORDS,
  COST_PER_TASK_USD,
  CACHE_DAYS,
  NOISE_FLOOR,
  SERVICE_WORDS,
};
