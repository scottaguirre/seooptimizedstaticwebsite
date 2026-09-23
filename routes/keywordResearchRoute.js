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
//            no brand test, no intent test, no minimum. If the answer is 10 a
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
  keywordIdeasFor, volumesFor, seedsFor, MAX_IDEAS, MAX_SEEDS,
} = require('../utils/keywordVolumes');
const { seedTermsFor } = require('../utils/keywordSeeds');
const { pairsFor, sortPairs, MAX_PAIRS } = require('../utils/keywordPairs');
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
function relatedTerms(value) {
  return String(value || '')
    .split(/[,\n]/)
    .map(term => term.trim().slice(0, MAX_RELATED_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_RELATED);
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

  if (!seed) {
    return res.status(400).json({
      error: mode === 'exact'
        ? 'Type the keyword you want the number for.'
        : 'Tell us the industry first — plumbing, roofing, web design, and so on.',
      mode,
    });
  }

  if (!location) {
    return res.status(400).json({
      error: 'We need the city as "City, ST" — for example "Austin, TX".',
    });
  }

  /* EXACT MODE: one term, one answer, nothing removed.
   *
   * The whole point of this mode is that the customer already knows the term
   * and wants the number. Running it through the brand filter, the intent
   * filter or a minimum would mean the tool silently declining to answer the
   * question it was asked — and a page that says nothing looks identical to
   * a lookup that failed. So: no filters, and a volume of 10 is reported as
   * 10 rather than rounded away. */
  if (mode === 'exact') {
    try {
      const { results, cached, costUsd } = await withTimeout(
        volumesFor([seed], { location, kind: 'volumes' }),
        CALL_TIMEOUT_MS,
        'keyword volume'
      );

      const rows = results.filter(r => r && r.keyword);

      log.info('keywords.exact', {
        requestId: req.id,
        userId: String((req.user && req.user._id) || ''),
        mode,
        seed,
        location,
        // null when Google will not report on the term at all, which is a
        // different answer from zero and worth telling apart in the log.
        volume: rows.length ? rows[0].volume : null,
        answered: rows.length,
        cached,
        costUsd,
      });

      return res.json({
        mode,
        rows,
        location,
        seeds: [seed],
        total: rows.length,
        buyerIntent: rows.length,
        aboveMinimum: rows.length,
        minVolume: 0,
        cached,
      });

    } catch (err) {
      log.error('keywords.exactFailed', err, {
        requestId: req.id,
        userId: String((req.user && req.user._id) || ''),
        seed,
        location,
      });

      return res.status(502).json({
        error: 'Could not look up that keyword just now. Please try again in a moment.',
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
      const byTerm = new Map(
        results.filter(r => r && r.keyword)
          .map(r => [r.keyword.toLowerCase(), r])
      );

      const rows = sortPairs(pairs.map(term => (
        byTerm.get(term.toLowerCase()) || { keyword: term, volume: null, cpc: null }
      )));

      const answered = rows.filter(r => r.volume != null).length;

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
      log.error('keywords.pairsFailed', err, {
        requestId: req.id,
        userId: String((req.user && req.user._id) || ''),
        seed,
        location,
      });

      return res.status(502).json({
        error: 'Could not look up those keywords just now. Please try again in a moment.',
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

    // Ticked off, so the box is "show everything" rather than "filter" — the
    // filter is the default because the unfiltered list is the one that made
    // the tool look broken.
    const intent = !(req.body && req.body.showAll);

    const {
      rows, cached, costUsd, total, buyerIntent, aboveMinimum, brandsHidden,
      removedByWords, removedByPrice, collapsed,
    } = await withTimeout(
      keywordIdeasFor(seeds, {
        location, minVolume, limit: MAX_IDEAS,
        intent, city, industry: seed,
      }),
      CALL_TIMEOUT_MS,
      'keyword ideas'
    );

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
      // How hungry each filter is. Watched rather than trusted: the brand one
      // has been wrong before, and the intent one is new. A week of these
      // says whether either needs loosening.
      brandsHidden,
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
    log.error('keywords.ideasFailed', err, {
      requestId: req.id,
      userId: String((req.user && req.user._id) || ''),
      seed,
      location,
    });

    res.status(502).json({
      error: 'Could not look up keywords just now. Please try again in a moment.',
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
module.exports.MAX_SEED = MAX_SEED;
module.exports.MAX_RELATED = MAX_RELATED;
module.exports.MAX_RELATED_LENGTH = MAX_RELATED_LENGTH;
