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

/**
 * The OTHER endpoint: discovery rather than lookup.
 *
 * search_volume answers "how often is this searched". This one answers "what
 * else do people search around this" — you give it a seed and it hands back
 * the terms Google associates with it, with the same metrics attached. It is
 * what the keyword research page needs, because its customer has a trade and
 * a town, not a list of keywords.
 *
 * Same price, same task shape, same reply shape.
 */
const IDEAS_ENDPOINT =
  'https://api.dataforseo.com/v3/keywords_data/google_ads/keywords_for_keywords/live';

/** DataForSEO's own cap per task. Sending more is an error, not a truncation. */
const MAX_KEYWORDS = 1000;

/**
 * The one HTTP status that is not a glitch.
 *
 * 402 Payment Required. DataForSEO's own wording: "We had a problem billing
 * your account. Please, check your account's balance."
 *
 * THIS COST A DEBUGGING SESSION AND IT SHOULD NOT HAVE. The research page
 * went down, the customer-facing message said "please try again in a moment",
 * and the log line was `keywords.ideasFailed` sitting in the same bucket as
 * every network blip. Trying again was never going to work — the account was
 * empty — and nothing anywhere said so. I sent Edwin to `pm2 logs` twice
 * before remembering this app logs to files.
 *
 * So 402 gets its own error, its own log event and its own wording. Every
 * other status stays generic, because every other status really is worth
 * retrying.
 */
const PAYMENT_REQUIRED = 402;

/**
 * Marks an error as "the account is empty", so callers can say something true
 * without string-matching a message.
 *
 * A property rather than a subclass: it survives being caught and rethrown,
 * and it needs no `instanceof` across module boundaries.
 */
function accountError(label, detail = '402 Payment Required') {
  const err = new Error(
    `${label}: DataForSEO returned ${detail} — the account balance is spent`
  );
  err.dataForSeoBilling = true;
  return err;
}

/**
 * The same problem, reported inside a 200.
 *
 * DataForSEO's transport is frequently 200 with the real verdict in the
 * task's own status_code, so checking the HTTP status alone would catch this
 * on some calls and miss it on others — which is worse than not checking at
 * all, because the behaviour would look random.
 *
 *   40200  Payment Required — the account is flagged for billing
 *   40210  Insufficient Funds — the balance will not cover this request
 *
 * Both mean "top up the account"; neither is worth retrying.
 */
const BILLING_TASK_CODES = new Set([40200, 40210]);

/**
 * Is this failure the empty account rather than a glitch?
 *
 * Exported so the routes ask this question rather than matching on the
 * message text — a message is wording and wording gets edited.
 */
function isBillingError(err) {
  return !!(err && err.dataForSeoBilling);
}

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

  // THE THINGS THE TRADE WORKS ON, and they are here because of a real miss.
  //
  // "toilet plumber" and "goettl plumbing" are the same shape: one word plus
  // the trade, no verb. The filter called both brands and dropped a service
  // page somebody should have been offered. The difference is that a toilet
  // is a thing a plumber works on and Goettl is a surname — which no rule
  // about word SHAPE can see.
  //
  // So the nouns are listed. It is a list, which the brand check was written
  // to avoid, but it is a short and stable one: the fixtures and parts of a
  // building do not change, where the set of plumbing companies in America
  // changes weekly.
  'toilet', 'sink', 'shower', 'bath', 'bathtub', 'tub', 'faucet', 'tap',
  'pipe', 'pipes', 'water', 'heater', 'boiler', 'furnace', 'ac', 'duct',
  'garbage', 'disposal', 'septic', 'sump', 'pump', 'valve', 'line', 'lines',
  'main', 'tank', 'well', 'gas', 'kitchen', 'bathroom', 'basement',
  'roof', 'shingle', 'shingles', 'gutter', 'gutters', 'siding', 'window',
  'windows', 'door', 'doors', 'floor', 'flooring', 'tile', 'wall',
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
function cacheKey(keywords, { location, language, month, kind = 'volumes' }) {
  const parts = [
    // NAMESPACED, because two different questions can carry the same words.
    // "plumbing" asked as a VOLUME lookup means "how often is the word
    // 'plumbing' searched"; asked as an IDEAS lookup it means "what else do
    // people search around plumbing". Same seed, same town, same month, two
    // entirely different answers — and without this they would share a key
    // and serve each other's.
    String(kind || 'volumes'),
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
 * A word reduced to the part its other forms share.
 *
 *   builder, builders, building  -> build
 *   plumber, plumbers, plumbing  -> plumb
 *   deck, decks                  -> deck
 *   company, companies           -> company
 *
 * Crude on purpose. A real stemmer is a dependency for a job a suffix strip
 * does, and the only question being asked is "are these two words the same
 * trade word?" — not "what is the root of this English word?".
 *
 * The three-character floor stops it eating short words: "gas" must not
 * become "ga", or every trade dealing in gas loses the word.
 */
function stem(word) {
  const w = String(word || '').toLowerCase();

  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;

  // Longest first, so "builders" loses "ers" rather than "s".
  for (const suffix of ['ers', 'ing', 'er', 's']) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 3) {
      return w.slice(0, -suffix.length);
    }
  }

  return w;
}

/**
 * The stems of the trade's own name.
 *
 * WHY STEMS AND NOT THE WORDS THEMSELVES, which is what this did until the
 * log showed otherwise on 23 September:
 *
 *   seed: "deck builder"   total: 1754   brandsHidden: 2917
 *
 * More hidden than kept. The business type contains "builder", so "deck
 * builders" had "builders" left over after the trade words were removed —
 * a word describing no work, next to a trade. Structurally a company name.
 * The filter was deleting "deck builders", the single best term a deck
 * builder could rank for, along with "deck building" and "deck builders
 * austin".
 *
 * PLUMBING HID THIS FROM US FOR A WEEK. isTradeish below is a hard-coded
 * regex that happens to know plumb/roof/electric/hvac/rooter/drain/sewer, so
 * plumbers and roofers got singular and plural handled by accident and every
 * other trade quietly lost its head terms. The same fault produced the
 * "lemon law firm" lookup that hid 342 and kept 76.
 *
 * isTradeish is kept: it also covers trade vocabulary that is NOT in the
 * business type — "rooter" and "sewer" for a business calling itself
 * "plumbing" — which stemming the name alone would never reach.
 */
function tradeStems(businessType) {
  const out = new Set();

  for (const word of String(businessType || '').toLowerCase().split(/\s+/)) {
    if (word) out.add(stem(word));
  }

  return out;
}

/**
 * The words of the place being researched.
 *
 * "Cedar Park,Texas,United States" -> { cedar, park, texas, united, states }
 *
 * Needed because a PLACE NAME IS NOT A SURNAME and the brand filter could not
 * tell the difference. See looksLikeBrand.
 */
function geoWords(location) {
  const out = new Set();

  for (const word of String(location || '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (word) out.add(word);
  }

  // Never evidence of anything, and they arrive on the end of every
  // location_name DataForSEO is given.
  out.delete('united');
  out.delete('states');

  return out;
}

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
 *
 * A PLACE NAME IS NOT A SURNAME, AND THIS DID NOT KNOW THAT
 *
 * Found in production, in the log, on 23 September. The rule asks "once the
 * trade's own words are gone, is there a word about the work?" — and for
 * "plumber cedar park" the leftover is `cedar park`, which describes no work.
 * So it read as a proper noun plus a trade: structurally identical to "Goettl
 * Plumbing", and hidden.
 *
 * That is the 170-a-month keyword the whole pairs mode was built around, and
 * the filter was deleting it. The damage scaled with how little the trade's
 * own name says: for `lemon law firm` in Dallas it hid 342 terms and kept 76.
 *
 * So the caller passes the geography, and a leftover word that is part of the
 * place is no longer evidence of a brand. It is not evidence AGAINST one
 * either — "goettl plumbing austin" still has `goettl` left over and is still
 * hidden, which is right.
 *
 * @param {string} keyword
 * @param {string} [businessType]
 * @param {object} [opts]
 * @param {Set<string>|string[]} [opts.geo]  words belonging to the place
 */
function looksLikeBrand(keyword, businessType = '', opts = {}) {
  const words = String(keyword || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) return false;

  // The trade's own words are not evidence either way — "plumbing" appears in
  // "plumbing repair" and in "Smith Plumbing" alike. MATCHED BY STEM, not
  // literally; see tradeStems for the day that cost.
  const stems = tradeStems(businessType);

  const geo = opts.geo instanceof Set
    ? opts.geo
    : new Set(Array.isArray(opts.geo) ? opts.geo : []);

  const rest = words.filter(w =>
    !stems.has(stem(w)) && !isTradeish(w) && !geo.has(w));

  // Nothing but the trade and the town: "plumbing", "plumber cedar park".
  // Generic, not a brand.
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

/**
 * Line the answers up against the questions, keeping the unanswered ones.
 *
 * DataForSEO omits keywords it has no figure for rather than returning them
 * empty, so a caller that just renders `results` silently loses the terms it
 * asked about. That is the wrong shape for both places this is used:
 *
 *   - the exact lookup, where "we checked and Google will not report on this"
 *     is the answer somebody asked for;
 *   - the town pairings, where a blank row tells a customer to build that
 *     page around different words.
 *
 * Matched case-insensitively, because the echoed keyword's casing is not
 * guaranteed and a case-sensitive match would show an answered term as a
 * dash.
 */
function mergeAnswers(asked, results) {
  const byTerm = new Map(
    (results || [])
      .filter(r => r && r.keyword)
      .map(r => [r.keyword.toLowerCase(), r])
  );

  return (asked || []).map(term => (
    byTerm.get(String(term).toLowerCase())
    || { keyword: term, volume: null, cpc: null }
  ));
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

  if (res.status === PAYMENT_REQUIRED) throw accountError('keyword volumes');

  if (!res.ok) {
    throw new Error(`keyword volumes: HTTP ${res.status} from DataForSEO`);
  }

  // Their transport is always 200 at the top level; the real status is inside,
  // so a naive `res.ok` check would treat a failed task as an empty answer.
  const t = (body.tasks || [])[0];
  if (!t) throw new Error('keyword volumes: DataForSEO returned no task');

  if (BILLING_TASK_CODES.has(t.status_code)) {
    throw accountError('keyword volumes', `task ${t.status_code}`);
  }

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

  const key = cacheKey(list, {
    location, language, month: currentMonth(now), kind: opts.kind,
  });

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

  const key = cacheKey(list, {
    location, language, month: currentMonth(now), kind: opts.kind,
  });

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
      // Both towns' words, because this call spans a metro and a city and a
      // term naming either of them is a place query, not a brand.
      brand: looksLikeBrand(r.keyword, opts.businessType, {
        geo: new Set([...geoWords(metro), ...geoWords(city)]),
      }),
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

/* ------------------------------------------------------------------ *
 * Discovery: what else do people search around this
 * ------------------------------------------------------------------ */

/**
 * The most a research page will show. Thirty — twenty first, then
 * twenty-five once the buyer-intent filter stopped the list being padded
 * with ten spellings of one product, then thirty because the filtered rows
 * are all worth reading.
 *
 * DataForSEO returns thousands; the cut happens here rather than at the
 * network, because the whole set is cached and a later request with a lower
 * minimum can be served from it without paying again.
 */
const MAX_IDEAS = 30;

/**
 * The most seeds one discovery task may carry.
 *
 * DataForSEO's own cap for keywords_for_keywords is 20, and — this is the
 * part that matters — the task is priced PER TASK, not per seed. One seed and
 * twenty seeds cost the same $0.09. Sending one was leaving nineteen free
 * questions on the table.
 *
 * Measured on 23 September: "plumbing" alone in Cedar Park returned 500
 * ideas, three of them above 200 searches a month. Keyword Planner, given
 * three seeds by hand, offered 1,678. The gap was the seed list, not the
 * endpoint.
 */
const MAX_SEEDS = 20;

/**
 * The seeds to ask about, built from what the customer typed.
 *
 * ORDER IS PRIORITY, because the list is capped. The trade itself first — the
 * one seed guaranteed to be relevant. Then the town pairings, which is where
 * local intent lives. Then the customer's own words, AHEAD of the model's:
 * somebody who types "slab leak detection" knows their trade better than a
 * model guessing at it. Model suggestions fill whatever is left.
 *
 * Deduped case-insensitively, matching cacheKey — otherwise "Plumbing" and
 * "plumbing" take two of the twenty slots and miss the cache as a bonus.
 *
 * @param {string} industry   "plumbing"
 * @param {object} opts
 * @param {string} [opts.city]       "Cedar Park" — the bare town, no state
 * @param {string[]} [opts.related]  what the customer typed in Related terms
 * @param {string[]} [opts.extra]    model suggestions, lowest priority
 * @param {number} [opts.limit]
 */
function seedsFor(industry, opts = {}) {
  const trade = String(industry || '').trim();
  if (!trade) return [];

  const city = String(opts.city || '').trim();
  const limit = Math.max(1, Math.min(Number(opts.limit) || MAX_SEEDS, MAX_SEEDS));

  const candidates = [trade];

  // "plumbing cedar park" and "cedar park plumbing" are genuinely different
  // questions to Google's idea engine, not one question written twice — which
  // is why both go in rather than whichever reads better.
  if (city) candidates.push(`${trade} ${city}`, `${city} ${trade}`);

  for (const term of (opts.related || [])) candidates.push(term);
  for (const term of (opts.extra || [])) candidates.push(term);

  const seen = new Set();
  const out = [];

  for (const raw of candidates) {
    const term = String(raw || '').trim();
    if (!term) continue;

    const fingerprint = term.toLowerCase();
    if (seen.has(fingerprint)) continue;

    seen.add(fingerprint);
    out.push(term);

    if (out.length >= limit) break;
  }

  return out;
}

/**
 * Terms Google associates with a seed, in one town, with their volumes.
 *
 * @param {string|string[]} seed  "plumbing", or the whole seed list
 * @param {object} opts
 * @param {string} opts.location  "Austin,Texas,United States"
 * @param {number} [opts.minVolume]  hide anything under this
 * @param {number} [opts.limit]      how many to hand back
 * @param {boolean} [opts.includeBrands]  keep competitor names, default false
 *
 * @returns {{ rows, seeds, cached, costUsd, total, aboveMinimum, brandsHidden }}
 *   `total` and `aboveMinimum` are what the page needs to say "20 of 340" and
 *   to tell the difference between "nothing matched your minimum" and
 *   "nothing came back at all" — which read the same in an empty table and
 *   mean completely different things.
 *
 *   `brandsHidden` is how many rows looksLikeBrand removed. It is reported
 *   rather than merely applied because a filter nobody can see the effect of
 *   is a filter nobody can tell is broken — and this one has been wrong
 *   before, on "toilet plumber".
 */
async function keywordIdeasFor(seed, opts = {}) {
  const Model = opts.Model || require('../models/KeywordCache');
  const now = opts.now ? opts.now() : new Date();

  // A string is still accepted, so a caller with one seed — the volumes
  // route, the tests — need not wrap it.
  const seeds = (Array.isArray(seed) ? seed : [seed])
    .map(s => String(s || '').trim())
    .filter(Boolean)
    .slice(0, MAX_SEEDS);

  const term = seeds[0] || '';
  const location = opts.location;
  const language = opts.language || 'English';

  if (!term) throw new Error('keyword ideas: a seed term is required');
  if (!location) throw new Error('keyword ideas: a location is required');

  const key = cacheKey(seeds, {
    location, language, month: currentMonth(now), kind: 'ideas',
  });

  let all = null;
  let cached = false;
  let costUsd = 0;

  try {
    const hit = await Model.findOne({ key }).lean();
    if (hit) { all = hit.results || []; cached = true; }
  } catch (err) {
    log().error('keywords.ideasCacheReadFailed', err, { location });
  }

  if (!all) {
    const fetched = await fetchIdeas(seeds, { location, language });
    all = fetched.results;
    costUsd = fetched.costUsd;

    const expiresAt = new Date(now.getTime() + CACHE_DAYS * 24 * 60 * 60 * 1000);

    try {
      await Model.updateOne(
        { key },
        {
          $set: {
            key, location, language,
            keywordCount: all.length,
            results: all, costUsd,
            fetchedAt: now,
            expiresAt,
          },
        },
        { upsert: true }
      );
    } catch (err) {
      log().error('keywords.ideasCacheWriteFailed', err, { location });
    }
  }

  // FILTERED AFTER THE CACHE, never before. The whole set is what was paid
  // for, so a customer who lowers the minimum gets a wider list for free.
  const minVolume = Math.max(0, Number(opts.minVolume) || 0);
  const limit = Math.max(1, Math.min(Number(opts.limit) || MAX_IDEAS, 200));

  const answered = all.filter(r => r.volume != null);

  // Counted, not just applied. `brandsHidden` goes into the log line so the
  // filter's appetite is a number somebody can look at after a week, instead
  // of a guess. A day where it eats half the list is the signal to loosen it.
  // The town being researched, so "plumber cedar park" is not mistaken for a
  // plumbing company called Cedar Park. Built from the full location_name
  // rather than opts.city, so the state counts too — "plumbing texas" is a
  // place query as much as "plumbing austin" is.
  const geo = new Set([...geoWords(location), ...geoWords(opts.city)]);

  const branded = opts.includeBrands
    ? []
    : answered.filter(r => looksLikeBrand(r.keyword, term, { geo }));

  const usable = opts.includeBrands
    ? answered
    : answered.filter(r => !looksLikeBrand(r.keyword, term, { geo }));

  /* THE BUYER-INTENT PASS, and it runs here rather than at the network for
   * the same reason every other filter does: the whole answer is what was
   * paid for, so somebody who unticks the box gets the wider list free.
   *
   * See utils/keywordIntent.js for why a word test and a price test are both
   * needed and neither is enough. In short: the Austin lookup returned 7,030
   * keywords whose top twenty by volume were ten spellings of "tankless water
   * heater", a shopping query for garbage disposals, and a baseball term. */
  let shortlist = usable;
  let removedByWords = 0;
  let removedByPrice = 0;
  let collapsed = 0;

  if (opts.intent) {
    const { buyerIntentRows, collapseClusters } = require('./keywordIntent');

    const judged = buyerIntentRows(usable, {
      city: opts.city,
      industry: opts.industry || term,
    });

    removedByWords = judged.removedByWords;
    removedByPrice = judged.removedByPrice;

    const before = judged.rows.length;

    // THE CORPUS IS EVERY ANSWERED ROW, not the shortlist. Inside one cluster
    // "garburator" and "garbage" each appear a handful of times and neither
    // looks odd; it is only against the other seven thousand rows that one of
    // them is obviously the word the trade uses.
    shortlist = collapseClusters(judged.rows, { corpus: answered, seeds });
    collapsed = before - shortlist.length;
  }

  const matching = shortlist.filter(r => (r.volume || 0) >= minVolume);

  const rows = matching
    .slice()
    .sort((a, b) => (b.volume || 0) - (a.volume || 0))
    .slice(0, limit);

  return {
    rows,
    seeds,
    cached,
    costUsd,
    // Everything Google answered, once competitor names are out. The big
    // number: "7,030 found".
    total: usable.length,
    // The pool the rows were actually chosen from. Equal to `total` when the
    // intent filter is off, which is what makes the page's wording honest in
    // both states without a special case.
    buyerIntent: shortlist.length,
    aboveMinimum: matching.length,
    brandsHidden: branded.length,
    removedByWords,
    removedByPrice,
    collapsed,
  };
}

/**
 * The discovery call. Separate from fetchVolumes because the URL differs.
 *
 * @param {string|string[]} seed  one seed or up to MAX_SEEDS of them. They
 *   ride in ONE task, which is what makes them free: the price is per task.
 */
async function fetchIdeas(seed, opts = {}) {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;

  if (!login || !password) {
    throw new Error('keyword ideas: DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD are not set');
  }

  const list = (Array.isArray(seed) ? seed : [seed])
    .map(s => String(s || '').trim())
    .filter(Boolean)
    .slice(0, MAX_SEEDS);

  if (!list.length) return { results: [], costUsd: 0 };

  const task = {
    keywords: list,
    language_name: opts.language || 'English',
    location_name: opts.location,
    search_partners: false,
    // Biggest first from their side too, so the truncation that happens if
    // they ever cap the reply keeps the rows worth having.
    sort_by: 'search_volume',
  };

  const auth = Buffer.from(`${login}:${password}`).toString('base64');

  const res = await fetch(IDEAS_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([task]),
  });

  const body = await res.json();

  if (res.status === PAYMENT_REQUIRED) throw accountError('keyword ideas');

  if (!res.ok) throw new Error(`keyword ideas: HTTP ${res.status} from DataForSEO`);

  const t = (body.tasks || [])[0];
  if (!t) throw new Error('keyword ideas: DataForSEO returned no task');

  if (BILLING_TASK_CODES.has(t.status_code)) {
    throw accountError('keyword ideas', `task ${t.status_code}`);
  }

  if (t.status_code !== 20000) {
    throw new Error(`keyword ideas: DataForSEO task ${t.status_code}: ${t.status_message}`);
  }

  // DEDUPED, which single-seed calls never needed. Twenty seeds around one
  // trade overlap heavily — "plumbing" and "plumbing cedar park" both surface
  // "plumbers near me" — and without this the same term fills several of the
  // twenty rows the customer gets to see.
  //
  // First wins, and the task is sorted by volume, so the survivor is the
  // better-answered copy rather than an arbitrary one.
  const seen = new Set();
  const results = [];

  for (const item of (t.result || [])) {
    if (!item || !item.keyword) continue;

    const row = readResult(item);
    const fingerprint = row.keyword.toLowerCase();

    if (seen.has(fingerprint)) continue;

    seen.add(fingerprint);
    results.push(row);
  }

  return {
    results,
    costUsd: typeof t.cost === 'number' ? t.cost : COST_PER_TASK_USD,
  };
}

module.exports = {
  keywordIdeasFor,
  fetchIdeas,
  seedsFor,
  MAX_SEEDS,
  MAX_IDEAS,
  IDEAS_ENDPOINT,
  volumesFor,
  cachedVolumesFor,
  keywordList,
  volumesForArea,
  fetchVolumes,
  cacheKey,
  accountError,
  isBillingError,
  PAYMENT_REQUIRED,
  BILLING_TASK_CODES,
  currentMonth,
  looksLikeBrand,
  geoWords,
  stem,
  tradeStems,
  mergeAnswers,
  readResult,
  MAX_KEYWORDS,
  COST_PER_TASK_USD,
  CACHE_DAYS,
  NOISE_FLOOR,
  SERVICE_WORDS,
};
