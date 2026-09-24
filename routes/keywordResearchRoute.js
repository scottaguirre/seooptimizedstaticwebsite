// routes/keywordResearchRoute.js
//
//   GET  /keyword-research    the page
//   POST /api/keyword-ideas   a trade and a town -> the terms people search
//
// WHY THIS IS A PAGE OF ITS OWN AND NOT PART OF THE WIZARD
//
// Because the question is asked at a different time. Somebody deciding
// whether a market is worth entering, or what a site should cover, is not
// halfway through building one — and the wizard was already crowded enough
// that its badges were reading as buttons.
//
// TWO MODES, TWO ENDPOINTS, AND THEY ARE NOT INTERCHANGEABLE
//
// The page asks one of two genuinely different questions, so it calls one of
// two genuinely different DataForSEO endpoints.
//
//   EXACT  — "how often is THIS searched in this town?"
//            keywords_data/google_ads/search_volume/live, the LOOKUP
//            endpoint. It answers about exactly the words given, with no
//            expansion and no opinion. Nothing is filtered on the way back:
//            no intent test, no minimum. If the answer is 10 a
//            month, the answer is 10 a month, and that is a real and useful
//            thing to know about a term somebody was going to build a page
//            around.
//
//   PAIRS  — "what does this trade get searched for WITH the town in it?"
//            Also search_volume/live, and it exists because the discovery
//            endpoint structurally cannot answer this. Target Cedar Park and
//            seed "plumbing" and Google returns "plumbers near me" — the
//            volume is Cedar Park's, the words are not, because Google treats
//            the city as targeting rather than as text.
//
//            It is not a volume problem, which is what I first assumed.
//            "plumber cedar park" is 170 searches a month at $44.64 a click.
//            It never appeared because Google never proposes it, so the only
//            way to get it is to ask about it by name. See utils/keywordPairs.
//
//   CATEGORY — "what do people search around this trade here?"
//            keywords_data/google_ads/keywords_for_keywords/live, the
//            DISCOVERY endpoint. Give it "plumbing", get back thousands of
//            terms Google associates with it — which then need the buyer
//            intent filter, because raw volume put a baseball keyword first
//            and ten spellings of "tankless water heater" second through
//            eleventh. See utils/keywordIntent.js.
//
// Same price either way: $0.09 a task.
//
// WHY IT IS FREE
//
// Same reason as the service suggester, written at the top of
// suggestServicesRoute: somebody working out how big a site to buy should not
// be charged to find out. Free for now is also a decision that can be
// reversed in an afternoon once the cost log has a month of numbers in it —
// which is why the log line below carries `costUsd` and `cached`.
//
// The cache does most of the protecting: a trade and a town, not a person, so
// every plumber asking about Austin shares one answer. The rate limit covers
// the rest, and is skipped entirely on a cache hit.

const fs = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();

const { keywordVolumesLimiter } = require('../middleware/rateLimits');
const {
  keywordIdeasFor, volumesFor, seedsFor, mergeAnswers, isBillingError,
  MAX_IDEAS, MAX_SEEDS,
} = require('../utils/keywordVolumes');
const { seedTermsFor } = require('../utils/keywordSeeds');
const { pairsFor, sortPairs, MAX_PAIRS } = require('../utils/keywordPairs');
const { checkBudget, recordSpend, limitMessage } = require('../utils/keywordBudget');
const {
  appHeader, appHeaderAssets, appHeaderScripts, appSidebar, appSidebarAssets,
} = require('../utils/appHeader');
const { log } = require('../utils/logger');

const PAGE_PATH = path.join(__dirname, '../src/views/keyword-research.html');

/** Read once at startup; the file does not change while the server runs. */
let pageHtml = null;

/** The seed is one trade, not an essay. */
const MAX_SEED = 60;

/**
 * The Related terms box, capped.
 *
 * Generous per term because a real one can be "tankless water heater
 * installation"; capped in count because only MAX_SEEDS slots exist and the
 * trade plus the two town pairings have already taken three of them.
 */
const MAX_RELATED = MAX_SEEDS - 3;
const MAX_RELATED_LENGTH = 60;

/**
 * How many keywords one exact lookup may carry.
 *
 * IT USED TO BE ONE, AND THAT WAS THE WHOLE COST OF THIS FEATURE. From the
 * log of 23 September: five lookups in 68 seconds — "lemon law lawyer",
 * "lemon law lawyer austin", "lemon law lawyer near me", "lemon law attorney
 * near me", "lemon law attorney" — five separate tasks, $0.45. That is not
 * somebody abusing the tool; that is the only sensible way to use it.
 *
 * The lookup endpoint takes a THOUSAND keywords per task at the same $0.09,
 * so those five should always have been one. Fifty is far below the
 * endpoint's cap and is set by what a person can read in a table, not by what
 * the API will bear.
 */
const MAX_EXACT_TERMS = 50;

/**
 * A local sort plus one HTTP call — and now, on the first lookup for an
 * industry, a model call in front of it.
 *
 * Raised from 30s to 45s to match suggestServicesRoute, because that model
 * call is the slow part. It only happens once per industry per month; every
 * lookup after it is served from the seed cache and is as quick as before.
 */
const CALL_TIMEOUT_MS = Number(process.env.KEYWORD_IDEAS_TIMEOUT_MS) || 45000;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Two-letter codes to the names Google's geo targets use.
 *
 * DataForSEO matches location_name against Google's own list, where the state
 * is written out. "Cedar Park,TX,United States" matches nothing and comes back
 * an error, so the conversion is not cosmetic.
 */
const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

/** "Cedar Park, TX" -> "Cedar Park,Texas,United States", or '' if unusable. */
function toLocationName(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  if (/united states/i.test(text)) return text;

  const [city, state] = text.split(',').map(p => String(p || '').trim());
  if (!city) return '';

  const full = STATES[String(state || '').toUpperCase()];

  // REFUSED rather than guessed. An unresolvable state would be sent as-is,
  // match no geo target, and spend $0.09 to be told no.
  return full ? `${city},${full},United States` : '';
}

/**
 * Which question is being asked.
 *
 * Defaults to discovery, because that is what every request sent before this
 * mode existed. An old page cached in somebody's browser keeps working
 * instead of silently switching to a lookup that expands nothing.
 */
function modeOf(body) {
  const asked = String((body && body.mode) || '').trim().toLowerCase();

  if (asked === 'exact') return 'exact';
  if (asked === 'pairs') return 'pairs';

  return 'category';
}

/**
 * Report a failed lookup, telling the truth about which kind it was.
 *
 * AN EMPTY ACCOUNT IS NOT A GLITCH, and the old code said it was. The page
 * told customers "please try again in a moment" while the DataForSEO balance
 * sat at zero, which no amount of trying would fix, and the failure went into
 * the same log bucket as a dropped connection. It took reading a stack trace
 * to find out the feature was down for a billing reason.
 *
 * So the billing case gets its own event name — `keywords.accountEmpty`,
 * greppable, unambiguous — and a message that does not invite a pointless
 * retry. Everything else keeps the old wording, because everything else
 * really is worth trying again.
 *
 * The customer is not told whose account it is or that money is involved:
 * that is the operator's problem, and "unavailable, we are on it" is both
 * honest and all they can act on.
 */
function reportLookupFailure(res, err, { event, req, seed, location }) {
  const billing = isBillingError(err);

  log.error(billing ? 'keywords.accountEmpty' : event, err, {
    requestId: req.id,
    userId: String((req.user && req.user._id) || ''),
    seed,
    location,
    // Spelled out for whoever reads the log at 2am, so the fix does not need
    // this file open beside it.
    ...(billing ? { action: 'top up the DataForSEO balance at app.dataforseo.com' } : {}),
  });

  return res.status(billing ? 503 : 502).json({
    error: billing
      ? 'Keyword data is unavailable at the moment. We have been notified — '
        + 'please check back later today.'
      : 'Could not look up keywords just now. Please try again in a moment.',
  });
}

/** "Cedar Park,Texas,United States" -> "Cedar Park". The bare town. */
function cityOf(locationName) {
  return String(locationName || '').split(',')[0].trim();
}

/**
 * The Related terms box: "water heater installation, drain cleaning".
 *
 * Split on commas AND newlines, because somebody pasting a list from Keyword
 * Planner gets newlines and would otherwise send one 200-character seed that
 * matches nothing.
 */
function termList(value, max, maxLength = MAX_RELATED_LENGTH) {
  const seen = new Set();
  const out = [];

  for (const raw of String(value || '').split(/[,\n]/)) {
    const term = raw.trim().replace(/\s+/g, ' ').slice(0, maxLength);
    if (!term) continue;

    // Deduped case-insensitively, matching keywordVolumes.keywordList.
    // Otherwise a pasted list with a repeat in it spends a slot twice AND
    // shows the customer the same row twice.
    const fingerprint = term.toLowerCase();
    if (seen.has(fingerprint)) continue;

    seen.add(fingerprint);
    out.push(term);

    if (out.length >= max) break;
  }

  return out;
}

function relatedTerms(value) {
  return termList(value, MAX_RELATED);
}

/**
 * The keywords an exact lookup was asked about.
 *
 * `terms` is what the page sends now; `category` is the fallback, because a
 * page cached in somebody's browser from before the textarea existed still
 * puts its single keyword there. Costs one line and keeps them working.
 */
function exactTerms(body) {
  const typed = (body && body.terms) || (body && body.category) || '';
  return termList(typed, MAX_EXACT_TERMS, MAX_SEED);
}

/**
 * Run the limiter only when the answer will actually cost something.
 *
 * A limiter runs before the handler, so by the time the lookup could report
 * `cached: true` the slot is already spent — and charging an hourly budget
 * for a free answer locks out the customers the cache exists to serve.
 *
 * Unlike the volumes route this cannot peek without duplicating the cache key
 * logic, so it takes the simpler correct path: the limiter always runs, and
 * the window is generous enough that a cache-served page never hits it. If
 * the logs ever show otherwise, the peek is the fix.
 */
router.post('/api/keyword-ideas', keywordVolumesLimiter, async (req, res) => {
  const mode = modeOf(req.body);

  const seed = String((req.body && req.body.category) || '').trim().slice(0, MAX_SEED);
  const typed = String((req.body && req.body.location) || '').trim();
  const location = toLocationName(typed);

  const minVolume = Math.max(0, Math.min(Number(req.body && req.body.minVolume) || 0, 1000000));
  const related = relatedTerms(req.body && req.body.related);

  // Exact mode has its own field and its own emptiness: a textarea with only
  // whitespace in it is not a seed, and `seed` would be empty for a different
  // reason than a missing industry.
  const terms = mode === 'exact' ? exactTerms(req.body) : [];

  if (mode === 'exact' ? !terms.length : !seed) {
    return res.status(400).json({
      error: mode === 'exact'
        ? 'Type the keywords you want the numbers for, one per line.'
        : 'Tell us the industry first — plumbing, roofing, web design, and so on.',
      mode,
    });
  }

  if (!location) {
    return res.status(400).json({
      error: 'We need the city as "City, ST" — for example "Austin, TX".',
    });
  }

  /* THE DAY'S ALLOWANCE, checked once for every mode.
   *
   * Above the mode branches because all three spend from the same balance,
   * and below the validation because a malformed request should be told what
   * is wrong with it rather than that it is out of lookups.
   *
   * A cache hit still gets served after the cap is reached — the check is
   * here, but recordSpend below only fires on a lookup that cost money, so a
   * customer who has run out can still re-run anything already answered.
   * That is deliberate and the message says so. */
  const budget = await checkBudget(req.user);

  if (!budget.allowed) {
    log.security('keywords.dailyLimit', {
      requestId: req.id,
      userId: String((req.user && req.user._id) || ''),
      used: budget.used,
      limit: budget.limit,
      mode,
      seed,
    });

    return res.status(429).json({ error: limitMessage(budget), mode });
  }

  /* EXACT MODE: the words you give it, the numbers back, nothing removed.
   *
   * The whole point of this mode is that the customer already knows the terms
   * and wants the figures. Running them through the intent filter or a
   * minimum would mean the tool silently declining to answer the
   * question it was asked — and a page that says nothing looks identical to
   * a lookup that failed. So: no filters, and a volume of 10 is reported as
   * 10 rather than rounded away.
   *
   * ALL OF THEM IN ONE TASK. See MAX_EXACT_TERMS for why that matters. */
  if (mode === 'exact') {
    try {
      const { results, cached, costUsd } = await withTimeout(
        volumesFor(terms, { location, kind: 'volumes' }),
        CALL_TIMEOUT_MS,
        'keyword volume'
      );

      // Asked, not answered — a term Google will not report on is kept as a
      // blank row. "We checked and there is no figure" is the answer, and
      // dropping it would leave the customer thinking it was never looked up.
      const rows = mergeAnswers(terms, results);
      const answered = rows.filter(r => r.volume != null).length;

      // Only a lookup that reached DataForSEO spends anything; a cache hit
      // reports costUsd 0 and recordSpend ignores it.
      await recordSpend(req.user, { costUsd });

      log.info('keywords.exact', {
        requestId: req.id,
        userId: String((req.user && req.user._id) || ''),
        mode,
        seed: terms[0],
        location,
        asked: terms.length,
        answered,
        // Kept for the single-term case, which is most of them, so the old
        // log lines and the new ones still read the same way.
        volume: rows.length === 1 ? rows[0].volume : null,
        cached,
        costUsd,
      });

      return res.json({
        mode,
        rows,
        location,
        seeds: terms,
        total: rows.length,
        buyerIntent: rows.length,
        aboveMinimum: rows.length,
        answered,
        minVolume: 0,
        cached,
      });

    } catch (err) {
      return reportLookupFailure(res, err, {
        event: 'keywords.exactFailed', req, seed: terms[0], location,
      });
    }
  }

  /* PAIRS MODE: the trade crossed with the town, looked up by name.
   *
   * Nothing is filtered here either, and for a sharper reason than in exact
   * mode: a pairing with NO figure is one of the most useful rows on the
   * page. "Google has no number for 'commercial plumber cedar park'" tells a
   * customer to write that page around "commercial plumber near me" instead,
   * or not to write it at all. Hide it and they think it was never checked. */
  if (mode === 'pairs') {
    try {
      const city = cityOf(location);

      // Cached per industry, so this is one model call per trade per month
      // and free for every town after the first.
      const seedTerms = await seedTermsFor(seed, { location: typed, city });

      const pairs = pairsFor(seed, {
        city,
        services: seedTerms.terms,
        limit: MAX_PAIRS,
      });

      const { results, cached, costUsd } = await withTimeout(
        volumesFor(pairs, { location, kind: 'volumes' }),
        CALL_TIMEOUT_MS,
        'keyword pairs'
      );

      // ASKED FOR, NOT ANSWERED, is the shape of this table. A term
      // DataForSEO omits entirely is shown with a dash rather than dropped,
      // because "we checked and Google has no figure" is the finding.
      // Same helper the exact lookup uses; see keywordVolumes.mergeAnswers.
      const rows = sortPairs(mergeAnswers(pairs, results));

      const answered = rows.filter(r => r.volume != null).length;

      await recordSpend(req.user, { costUsd });

      log.info('keywords.pairs', {
        requestId: req.id,
        userId: String((req.user && req.user._id) || ''),
        mode,
        seed,
        location,
        asked: pairs.length,
        // The ratio worth watching. If most towns answer on only a handful,
        // the qualifier list is producing phrases nobody types.
        answered,
        modelSeeds: seedTerms.terms.length,
        seedsCached: seedTerms.cached,
        cached,
        costUsd,
      });

      return res.json({
        mode,
        rows,
        location,
        seeds: pairs,
        total: rows.length,
        buyerIntent: rows.length,
        aboveMinimum: rows.length,
        answered,
        minVolume: 0,
        cached,
      });

    } catch (err) {
      return reportLookupFailure(res, err, {
        event: 'keywords.pairsFailed', req, seed, location,
      });
    }
  }

  try {
    const city = cityOf(location);

    // Model seeds first, because seedsFor() needs them to build the list.
    //
    // seedTermsFor NEVER THROWS — a model outage returns an empty list and
    // this lookup carries on with the mechanical seeds, narrower but working.
    // That is why it is not inside the withTimeout below: its own failure is
    // already handled, and wrapping it would let a slow model turn a
    // recoverable narrowing into a 502.
    //
    // The TYPED location goes to the model — "Cedar Park, TX" — because the
    // state is the part that carries regional vocabulary: sprinkler repair is
    // a Texas plumbing search and a rarity in Maine. The bare town goes
    // separately, only so the reply can be checked for town names it was
    // asked not to include.
    const seedTerms = await seedTermsFor(seed, { location: typed, city });

    const seeds = seedsFor(seed, { city, related, extra: seedTerms.terms });

    // ALWAYS ON. This read `!(req.body && req.body.showAll)` for as long as
    // the page had a "Show everything" checkbox on it.
    //
    // Edwin asked what showing the unfiltered list was for, and there is no
    // good answer: it is a baseball keyword, ten spellings of "tankless water
    // heater" and a page of people reading rather than hiring. The box is
    // gone from the form, and the body field is no longer read either — an
    // option the page has stopped offering should not survive as an
    // undocumented one that can still be posted.
    //
    // Named rather than inlined, because the response and the log still
    // report which filters ran and the page's empty-state wording turns on
    // it.
    const intent = true;

    const {
      rows, cached, costUsd, total, buyerIntent, aboveMinimum,
      removedByWords, removedByPrice, collapsed,
    } = await withTimeout(
      keywordIdeasFor(seeds, {
        location, minVolume, limit: MAX_IDEAS,
        intent, city, industry: seed,
      }),
      CALL_TIMEOUT_MS,
      'keyword ideas'
    );

    await recordSpend(req.user, { costUsd });

    log.info('keywords.ideas', {
      requestId: req.id,
      userId: String((req.user && req.user._id) || ''),
      mode,
      seed,
      location,
      minVolume,
      intent,
      seedCount: seeds.length,
      relatedCount: related.length,
      modelSeeds: seedTerms.terms.length,
      seedsCached: seedTerms.cached,
      total,
      buyerIntent,
      aboveMinimum,
      // How hungry each filter is. There used to be a brandsHidden here too,
      // and watching it is what got the brand filter deleted: it sat at half
      // the answer across two rewrites, and the rows it was eating turned out
      // to be "deck installer austin" rather than anybody's company name.
      removedByWords,
      removedByPrice,
      collapsed,
      shown: rows.length,
      cached,
      costUsd,
    });

    res.json({
      mode,
      rows,
      location,
      // AN EMPTY TABLE MEANS SEVERAL DIFFERENT THINGS and the page has to
      // tell them apart: "your minimum is too high" and "the intent filter
      // took everything" are knobs the customer can turn, "this town has
      // nothing" is not.
      total,
      buyerIntent,
      aboveMinimum,
      minVolume,
      intent,
      // Shown on the card, so a thin result is visibly a narrow net or
      // visibly a small town, without anyone reading a log.
      seeds,
      cached,
    });

  } catch (err) {
    reportLookupFailure(res, err, {
      event: 'keywords.ideasFailed', req, seed, location,
    });
  }
});

router.get('/keyword-research', (req, res) => {
  try {
    if (pageHtml === null) pageHtml = fs.readFileSync(PAGE_PATH, 'utf8');

    // A meta tag rather than a hidden field, matching formRoute: the page
    // posts with fetch(), and reads the token back as X-CSRF-Token.
    const meta = `<meta name="csrf-token" content="${res.locals.csrfToken || ''}">`;
    const csrfField = res.locals.csrfField || '';

    res.send(
      pageHtml
        .replace('</head>', `  ${meta}\n</head>`)
        .replace(/{{HEADER_ASSETS}}/g, appHeaderAssets() + appSidebarAssets())
        .replace(/{{HEADER_SCRIPTS}}/g, appHeaderScripts())
        .replace(/{{HEADER}}/g, appHeader(csrfField))
        .replace(/{{SIDEBAR}}/g, appSidebar('/keyword-research'))
        .replace(/{{CSRF}}/g, csrfField)
    );

  } catch (err) {
    log.error('keywordResearch.renderFailed', err, { requestId: req.id });
    res.status(500).send('Something went wrong. Please try again.');
  }
});

module.exports = router;
module.exports.toLocationName = toLocationName;
module.exports.modeOf = modeOf;
module.exports.MAX_PAIRS = MAX_PAIRS;
module.exports.cityOf = cityOf;
module.exports.relatedTerms = relatedTerms;
module.exports.exactTerms = exactTerms;
module.exports.termList = termList;
module.exports.MAX_EXACT_TERMS = MAX_EXACT_TERMS;
module.exports.MAX_SEED = MAX_SEED;
module.exports.MAX_RELATED = MAX_RELATED;
module.exports.MAX_RELATED_LENGTH = MAX_RELATED_LENGTH;
