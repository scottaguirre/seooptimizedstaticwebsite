// utils/keywordIntent.js
//
// Which of these keywords belongs to somebody about to hire a plumber, and
// which to somebody reading about water heaters.
//
// WHY THIS EXISTS
//
// On 23 September the Austin plumbing lookup returned 7,030 keywords and the
// top twenty by volume were almost all useless:
//
//   american league detection   27,100   $1.66   <- Google's fuzzy expansion
//                                                  of "leak detection".
//                                                  Baseball.
//   tankless water heater          880   $8.99   <- somebody shopping
//   instant water heater           880   $8.99   <- the same somebody
//   instantaneous water heater     880   $8.99   <- still them
//   ...seven more spellings of it...
//   water heater repair            480  $82.33   <- somebody whose water
//                                                  heater is broken
//
// Ten of the twenty rows were ONE product term written ten ways, and the one
// row worth having was near the bottom. Sorting by volume put the worst row
// first and buried the best.
//
// THE SIGNAL WAS ALREADY ON THE SCREEN
//
// An advertiser pays $82 a click for "water heater repair" because it turns
// into a job worth a thousand dollars. Nobody pays $82 to reach a man reading
// about tankless heaters — that click is $8.99, and the baseball one is
// $1.66. CPC is the market's own verdict on buyer intent, priced by thousands
// of advertisers who lose money when they get it wrong. It costs nothing
// extra: it is in every row DataForSEO returns.
//
// WHY NOT CPC ALONE, AND WHY NOT WORDS ALONE
//
// Neither works by itself, and the two failures are instructive.
//
// WORDS ALONE: "american league detection" contains "detection", which is a
// real plumbing service ("leak detection"). Any word list generous enough to
// keep leak detection keeps the baseball.
//
// CPC ALONE: a brand-new service page for a term nobody has bid on yet has no
// CPC at all. Absence of a bid is absence of evidence, not evidence of
// absence — and "plumber cedar park" in a small town may have no bid while
// being the single best page the customer could build.
//
// So: a word test decides what QUALIFIES, and CPC gets a VETO over it. A term
// must look like a hiring query AND not be priced like noise.
//
// WHY THE CPC FLOOR IS RELATIVE AND NOT A DOLLAR FIGURE
//
// $10 is a cheap click in plumbing and an unreachable one in web design;
// lemon law runs past $200. Any fixed floor is correct for exactly one trade.
// The floor here is a fraction of the median CPC of the qualifying rows —
// so the trade sets its own scale and a new industry needs no configuration.

/**
 * The work itself. A term carrying one of these is about getting something
 * done, not about reading.
 *
 * DELIBERATELY NARROWER THAN keywordVolumes.SERVICE_WORDS, which is a
 * different question with a different answer. That list includes the fixture
 * nouns — water, heater, pipe, toilet — because it is deciding "is this a
 * service or a company's name", where "toilet plumber" must come out a
 * service. Reused here it would keep every one of the ten tankless rows,
 * since "water" and "heater" are both on it. Same words, different job.
 */
const ACTION_WORDS = new Set([
  'repair', 'repairs', 'repairing', 'repaired',
  'replace', 'replacement', 'replacing', 'replaced',
  'install', 'installation', 'installing', 'installed', 'installer',
  'service', 'services', 'servicing', 'serviced',
  'fix', 'fixing', 'fixed',
  'clean', 'cleaning', 'cleaner', 'cleanout',
  'unclog', 'unclogging', 'clogged', 'blocked', 'blockage', 'backed',
  'maintenance', 'inspection', 'inspect', 'detection', 'detect',
  'remodel', 'remodeling', 'renovation', 'rebuild',
  'flush', 'flushing', 'reline', 'relining', 'rooter', 'snake', 'snaking',
  'hookup', 'hook', 'tune',
  'leaking', 'burst', 'broken', 'clog', 'overflow', 'overflowing',
]);

/**
 * Somebody looking for a business rather than for information.
 *
 * "plumbing company near me" has no verb in it at all and is one of the
 * highest-intent queries there is.
 */
const HIRE_WORDS = new Set([
  'company', 'companies', 'contractor', 'contractors',
  'specialist', 'specialists', 'technician', 'technicians',
  'pro', 'pros', 'professional', 'professionals',
  'expert', 'experts', 'business', 'shop',
  'hire', 'call', 'book', 'booking', 'appointment',
]);

/** Somebody who needs it now, which is the highest intent of all. */
const URGENCY_WORDS = new Set([
  'emergency', 'urgent', '24', '24/7', 'hour', 'hours', 'hr',
  'same', 'day', 'today', 'tonight', 'weekend', 'overnight', 'afterhours',
]);

/** Somebody asking what it costs is somebody about to buy. */
const COMMERCE_WORDS = new Set([
  'cost', 'costs', 'price', 'prices', 'pricing', 'quote', 'quotes',
  'estimate', 'estimates', 'rates', 'fee', 'fees',
  'cheap', 'cheapest', 'affordable', 'best', 'top',
]);

/** Which kind of customer. Both are hiring. */
const SEGMENT_WORDS = new Set([
  'commercial', 'residential', 'industrial', 'local', 'licensed',
  'certified', 'insured', 'bonded',
]);

/**
 * Reading, studying, or working in the trade — not buying from it.
 *
 * SHORT ON PURPOSE. Every entry is a phrase that cannot plausibly mean
 * anything else, because a generous list here does the damage the whole
 * module exists to prevent: a false positive HIDES a page the customer should
 * have been offered, and they never find out it was hidden. The CPC veto does
 * the rest of this work, and does it without a list.
 */
const INFORMATIONAL = [
  /^how to\b/, /^what is\b/, /^what are\b/, /^why (is|are|does|do)\b/,
  /\bdiy\b/, /\bdo it yourself\b/,
  /\bvs\b/, /\bversus\b/,
  /\bsalary\b/, /\bsalaries\b/, /\bjobs?\b/, /\bcareers?\b/, /\bhiring\b/,
  /\bapprentice/, /\btraining\b/, /\bschools?\b/, /\bcourses?\b/,
  /\bexam\b/, /\bcertification test\b/,
  /\bmeaning\b/, /\bdefinition\b/, /\bwikipedia\b/, /\byoutube\b/,
  /\bhistory of\b/, /\bsymptoms?\b/,
];

/**
 * How far below the trade's own median a click can be priced before the term
 * is treated as noise.
 *
 * A TENTH, and the honest account of why is that A FIFTH WAS NEARLY WRONG
 * RATHER THAN DEMONSTRABLY WRONG.
 *
 * The first draft used a fifth. Checked against a working set that included
 * two extra high-priced rows, the median came out $54.33, the floor $10.87,
 * and "drain cleaning" at $10.42 was vetoed — a real plumbing job thrown away
 * for being cheap to advertise against. On the twenty rows exactly as they
 * appeared on screen the median is $36.67 instead, the floor $7.33, and drain
 * cleaning survives. So the fifth did not actually break the screenshot; it
 * broke a set one row wider.
 *
 * That is the argument for a tenth, not against it. The median moves several
 * dollars with a couple of rows either way, so a floor that sits just under a
 * real term today sits just over it tomorrow, and the failure is invisible
 * when it comes: a customer cannot see a page they were never offered. A
 * tenth says "an order of magnitude below what this trade pays", which is a
 * claim that survives the median wandering.
 *
 * The word test does the heavy lifting. This only catches what passes it and
 * is still priced like nothing — on the real run, one row out of twenty.
 */
const CPC_FLOOR_FRACTION = 0.1;

/**
 * Below this many priced rows, no median is computed and no row is vetoed.
 *
 * A median of two numbers is not a description of a market, and a small town
 * can easily return three priced rows. Vetoing against it would throw away
 * real terms on the strength of a coincidence.
 */
const MIN_ROWS_FOR_MEDIAN = 4;

/* ------------------------------------------------------------------ *
 * The word test
 * ------------------------------------------------------------------ */

function words(keyword) {
  return String(keyword || '')
    .toLowerCase()
    .replace(/[^a-z0-9/\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Is this term modified by a place?
 *
 * A geo modifier is intent on its own, with no verb anywhere in sight.
 * "plumber cedar park" is somebody looking for a plumber in Cedar Park; the
 * whole query is the intent. This is the rule Edwin's own example list made
 * obvious and that a verb-only test would have missed.
 */
function hasGeo(keyword, city = '') {
  const text = String(keyword || '').toLowerCase();

  if (/\bnear me\b|\bnearby\b|\bnear by\b|\bin my area\b|\baround me\b/.test(text)) {
    return true;
  }

  const town = String(city || '').trim().toLowerCase();
  if (!town) return false;

  return text.includes(town);
}

/** Reading about the trade, or training for it. Never buying. */
function looksInformational(keyword) {
  const text = String(keyword || '').toLowerCase().trim();
  return INFORMATIONAL.some(pattern => pattern.test(text));
}

/**
 * Does this term look like somebody about to spend money?
 *
 * The word half of the test. CPC has the veto; see buyerIntentRows.
 *
 * @param {string} keyword
 * @param {object} opts
 * @param {string} [opts.city]      the bare town, for the geo test
 * @param {string} [opts.industry]  the trade, so the bare category counts
 */
function hasBuyerIntent(keyword, opts = {}) {
  const text = String(keyword || '').trim();
  if (!text) return false;

  if (looksInformational(text)) return false;

  const list = words(text);
  if (!list.length) return false;

  // The bare category is the head term — "plumbing", "roofing". It is the one
  // page every site in the trade has, so it is never filtered out however
  // few of these words it contains.
  const industry = String(opts.industry || '').trim().toLowerCase();
  if (industry && text.toLowerCase() === industry) return true;

  if (hasGeo(text, opts.city)) return true;

  return list.some(w =>
    ACTION_WORDS.has(w)
    || HIRE_WORDS.has(w)
    || URGENCY_WORDS.has(w)
    || COMMERCE_WORDS.has(w)
    || SEGMENT_WORDS.has(w)
  );
}

/* ------------------------------------------------------------------ *
 * The CPC veto
 * ------------------------------------------------------------------ */

/**
 * The number the price veto judges a row by.
 *
 * THE HIGHEST TOP-OF-PAGE BID, not the average cost per click — and the
 * difference is not small. From the live Austin run, with the bid columns on
 * screen for the first time:
 *
 *                               CPC    highest bid
 *   american league detection   $1.66        $2.14
 *   drain cleaning             $10.42       $54.45
 *   garbage disposal repair    $11.32       $89.69
 *   water heater repair        $82.33      $148.26
 *   emergency plumber near me $103.61      $177.93
 *
 * On CPC the junk sits six times below the cheapest real job, and the median
 * moved enough between the twenty-row fixture and the live 7,030 that the
 * floor dropped under $1.66 and the baseball survived in production. On the
 * highest bid it sits twenty-five times below, with every real plumbing term
 * between $54 and $178.
 *
 * The reason is what the two numbers mean. An average is dragged down by
 * every half-hearted advertiser in the auction; the top-of-page high bid is
 * what the most committed bidder will pay, and nobody is committed about
 * baseball in a plumbing auction.
 *
 * Falls back to CPC where there is no bid range, since a row can carry one
 * and not the other. A row carrying neither is not judged at all.
 */
function priceOf(row) {
  if (!row) return null;
  if (typeof row.high === 'number' && row.high > 0) return row.high;
  if (typeof row.cpc === 'number' && row.cpc > 0) return row.cpc;
  return null;
}

/** The middle price, ignoring rows nobody has bid on. */
function medianCpc(rows) {
  const priced = (rows || [])
    .map(priceOf)
    .filter(v => v != null && v > 0)
    .sort((a, b) => a - b);

  if (!priced.length) return null;

  const middle = Math.floor(priced.length / 2);

  return priced.length % 2
    ? priced[middle]
    : (priced[middle - 1] + priced[middle]) / 2;
}

/**
 * The rows somebody about to hire would have typed.
 *
 * @param {object[]} rows
 * @param {object} opts
 * @param {string} [opts.city]
 * @param {string} [opts.industry]
 *
 * @returns {{ rows, removedByWords, removedByPrice, floor, median }}
 *   The counts come back rather than being swallowed, for the same reason
 *   brandsHidden does: a filter whose appetite nobody can see is a filter
 *   nobody can tell is broken.
 */
function buyerIntentRows(rows, opts = {}) {
  const all = Array.isArray(rows) ? rows : [];

  const qualified = all.filter(r => r && hasBuyerIntent(r.keyword, opts));
  const removedByWords = all.length - qualified.length;

  // THE MEDIAN IS TAKEN FROM THE QUALIFYING ROWS, not from everything.
  //
  // Taken from everything, the tankless cluster and the baseball drag it
  // down and the floor lands low enough to veto nothing — the junk setting
  // the standard by which junk is judged.
  const priced = qualified.filter(r => priceOf(r) != null);

  if (priced.length < MIN_ROWS_FOR_MEDIAN) {
    return {
      rows: qualified, removedByWords, removedByPrice: 0,
      floor: null, median: null,
    };
  }

  const median = medianCpc(qualified);
  const floor = median * CPC_FLOOR_FRACTION;

  // A row with NO price at all is kept. Nobody having bid on a term is not
  // evidence against it — in a small town it is the normal state of the best
  // page available.
  const kept = qualified.filter(r => {
    const price = priceOf(r);
    return price == null || price >= floor;
  });

  return {
    rows: kept,
    removedByWords,
    removedByPrice: qualified.length - kept.length,
    floor,
    median,
  };
}

/* ------------------------------------------------------------------ *
 * Collapsing Google's synonym clusters
 * ------------------------------------------------------------------ */

/**
 * Terms Google is treating as one keyword, shown once.
 *
 * Ten rows of the Austin twenty were tankless water heater spelled ten ways,
 * every one of them 880 searches at $8.99. Identical volume AND identical
 * cost per click, to the cent, is Google saying these are one keyword — the
 * numbers are the same number, reported repeatedly.
 *
 * A SHARED WORD IS REQUIRED as well, because two unrelated terms could in
 * principle collide on both figures, and merging them would be a lie told
 * confidently. In practice the shared word is always there when the match is
 * real; requiring it costs nothing and removes the failure mode.
 *
 * WHICH SPELLING SURVIVES, AND THIS TOOK THREE GOES
 *
 * First attempt: the shortest. It picked "near me plumber" over "plumbers
 * near me" by one character — a phrase no English speaker types. Fixed by
 * ranking a term that OPENS with a locative last.
 *
 * Second attempt, same rule, worse symptom: shortest also picked
 * "garburator repair" over "garbage disposal repair" (17 characters against
 * 23), "hot water installation" over "water heater installation", and "soft
 * water" over "water softener". A garburator is a garbage disposal — in
 * CANADA. Google's keyword data carries every regional and foreign name for a
 * thing, and the foreign one is reliably the shorter one, so shortest-wins
 * systematically hands an Austin plumber the Canadian word.
 *
 * Third attempt, which is what this does: DECIDE FROM THE DATA, not from a
 * list of regionalisms nobody could finish writing. Two signals, both free:
 *
 *   THE SEEDS. The seed list is the trade's own vocabulary — the model
 *   proposed "garbage disposal repair" and "water softener installation" by
 *   name, and the customer typed their own terms in as well. A wording that
 *   matches a seed is a wording this trade actually uses.
 *
 *   THE CORPUS. Across all 7,030 rows, "garbage" and "disposal" appear
 *   constantly and "garburator" appears in a handful. So a candidate is
 *   scored by how common its RAREST word is: one oddity anywhere in the
 *   phrase sinks it, which is exactly the shape of the problem.
 *
 * Neither signal needs to know anything about Canada.
 */

/**
 * Openings that mean the words have been shuffled rather than typed.
 *
 * Google's keyword data contains every permutation it has matched, so the
 * cluster routinely holds the sentence backwards.
 */
const AWKWARD_OPENINGS = [
  /^near me\b/, /^nearby\b/, /^near by\b/,
  /^in\b/, /^at\b/, /^for\b/, /^with\b/, /^to\b/, /^of\b/, /^on\b/,
  /^and\b/, /^or\b/, /^the\b/, /^a\b/,
];

/** Lower sorts first: a natural opening beats an awkward one. */
function phrasingRank(keyword) {
  const text = String(keyword || '').toLowerCase().trim();
  return AWKWARD_OPENINGS.some(p => p.test(text)) ? 1 : 0;
}

/** How often each word appears across the whole answer. */
function wordFrequency(rows) {
  const counts = new Map();

  for (const row of (rows || [])) {
    if (!row || !row.keyword) continue;
    // Once per row, not once per occurrence: a keyword that repeats a word
    // should not vote twice.
    for (const w of new Set(words(row.keyword))) {
      counts.set(w, (counts.get(w) || 0) + 1);
    }
  }

  return counts;
}

/**
 * How ordinary this phrase's least ordinary word is.
 *
 * The MINIMUM rather than the average, because one oddity is the whole
 * problem: "garburator repair" is a common word and a rare one, and averaging
 * would let "repair" carry it.
 */
function commonness(keyword, counts) {
  const list = words(keyword);
  if (!list.length) return 0;

  let lowest = Infinity;
  for (const w of list) lowest = Math.min(lowest, counts.get(w) || 0);

  return lowest === Infinity ? 0 : lowest;
}

/**
 * How much of this phrase the trade's own seed vocabulary accounts for.
 *
 * An exact seed match is the strongest signal there is — somebody, model or
 * customer, wrote that exact phrase down as a thing this trade sells.
 */
function seedScore(keyword, seedWords, seedPhrases) {
  const text = String(keyword || '').toLowerCase().trim();

  if (seedPhrases.has(text)) return 2;

  const list = words(text);
  if (!list.length) return 0;

  const shared = list.filter(w => seedWords.has(w)).length;

  return shared / list.length;
}

/**
 * Words that could identify WHICH keyword this is.
 *
 * Everything a hiring query carries by default is struck out — the verbs, the
 * "near me", the "emergency", the "cost". Half the answer has those, so they
 * prove nothing about two rows being the same search.
 *
 * WHAT STAYS IN is the nouns, including the fixture nouns. "disposal",
 * "heater", "softener" are precisely the words that say which page this is,
 * and a rule that struck them out would have nothing left to match on.
 *
 * Only used where there is no CPC to lean on. See collapseClusters.
 */
const CLUSTER_STOPWORDS = new Set([
  ...ACTION_WORDS, ...HIRE_WORDS, ...URGENCY_WORDS,
  ...COMMERCE_WORDS, ...SEGMENT_WORDS,
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'by',
  'with', 'from', 'near', 'nearby', 'me', 'my', 'you', 'your', 'i', 'it',
  'is', 'are', 'do', 'does', 'how', 'what', 'who', 'where', 'when', 'why',
]);

/**
 * A word in this share of the answer names nothing in particular.
 *
 * "water" is in the water heater rows, the water softener rows, the water
 * line rows, the water pressure rows and the hot water rows. Matching on it
 * would put a softener and a heater in one cluster — two different
 * appliances, two different pages, one row.
 *
 * A fifth is a judgement, not a measurement, and it is the kind of number
 * this codebase has been wrong about before. Two things make it safer here
 * than the brand threshold that failed: the question is one frequency can
 * actually answer — "is this word everywhere?" — and being wrong only groups
 * two rows that were already identical in volume, which the "+N wordings"
 * label shows on the page rather than hiding.
 */
const GENERIC_SHARE = 0.2;

/**
 * @param {string} keyword
 * @param {Map<string,number>} [counts]  corpus word frequencies
 * @param {number} [rowCount]  how many rows those counts came from
 */
function distinctiveWords(keyword, counts = null, rowCount = 0) {
  const out = new Set();
  const generic = counts && rowCount ? rowCount * GENERIC_SHARE : Infinity;

  for (const w of words(keyword)) {
    // A single character is never the name of anything.
    if (w.length <= 1 || CLUSTER_STOPWORDS.has(w)) continue;
    if ((counts ? counts.get(w) || 0 : 0) >= generic) continue;

    out.add(w);
  }

  return out;
}

/**
 * @param {object[]} rows   the rows to collapse
 * @param {object} [opts]
 * @param {object[]} [opts.corpus]  EVERY row the lookup answered, not just
 *   these. The word counts have to come from the whole answer: inside a
 *   single cluster "garburator" and "garbage" both appear a handful of times,
 *   and it is only against the other seven thousand rows that one of them is
 *   obviously the word this trade uses.
 * @param {string[]} [opts.seeds]   what was asked about, as the trade's own
 *   vocabulary.
 */
function collapseClusters(rows, opts = {}) {
  const all = Array.isArray(rows) ? rows : [];
  const groups = new Map();
  const out = [];

  const corpus = Array.isArray(opts.corpus) && opts.corpus.length ? opts.corpus : all;
  const counts = wordFrequency(corpus);

  /* "IS THIS WORD EVERYWHERE?" IS A QUESTION ABOUT THE WHOLE ANSWER, and it
   * cannot be asked of the shortlist. Counted against the ten rows being
   * clustered, "disposal" is in eight of them and looks ubiquitous — so the
   * rule would strike out the one word that identifies them and nothing
   * would cluster at all.
   *
   * Zero switches the test off. The caller that matters passes the whole
   * 4,671-row answer; a caller that passes nothing gets the old, looser
   * behaviour rather than a wrong answer computed confidently. */
  const corpusRows = corpus.length > all.length ? corpus.length : 0;

  const seedPhrases = new Set(
    (opts.seeds || []).map(s => String(s || '').toLowerCase().trim()).filter(Boolean)
  );

  const seedWords = new Set();
  for (const phrase of seedPhrases) for (const w of words(phrase)) seedWords.add(w);

  for (const row of all) {
    if (!row || !row.volume) {
      out.push(row);
      continue;
    }

    /* A ROW WITH NO PRICE IS STILL CLUSTERED, AND IT USED NOT TO BE.
     *
     * This began `if (row.cpc == null) { out.push(row); continue; }` — no
     * price, no clustering — on the reasoning that volume alone is too weak
     * a key when a town's keywords all sit at the same rounded figure.
     *
     * What that missed is that in a SMALL TOWN almost nothing has a price.
     * Leander, Texas, "plumbing", 23 September: ten of the thirty rows shown
     * were one keyword.
     *
     *   garbage disposal repair · fix garbage disposal · sink disposal repair
     *   garburator repair · sink disposal fix · dish disposal repair
     *   fix garburator · fix waste disposal · garbage disposal unit repair
     *   repair waste disposal unit
     *
     * All 40 a month, all unpriced, all the same page. The only two rows on
     * that table that DID collapse — "water softener installation +3
     * wordings", "water heater installation +2 wordings" — were the only two
     * with a CPC. So the de-duplicator was switched off in exactly the towns
     * that need it, and a third of the customer's list went to one appliance.
     *
     * Unpriced rows go in their own buckets, keyed on volume alone, and are
     * clustered by a stricter rule than the priced ones below. */
    const key = row.cpc == null
      ? `${row.volume}|unpriced`
      : `${row.volume}|${row.cpc.toFixed(2)}`;

    if (!groups.has(key)) groups.set(key, { priced: row.cpc != null, rows: [] });
    groups.get(key).rows.push(row);
  }

  for (const { priced, rows: group } of groups.values()) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }

    // Split the group into clusters that actually share vocabulary, so a
    // coincidence rides alone rather than being absorbed.
    const clusters = [];

    for (const row of group) {
      /* WHICH WORDS COUNT AS SHARING depends on how much the key proved.
       *
       * A priced group matched volume AND CPC to the cent, which is nearly
       * the whole argument; any shared word will do. An unpriced group
       * matched a rounded volume and nothing else, so "repair" or "near me"
       * — words half the answer carries — cannot be the evidence. Only a
       * word that names something counts there.
       *
       * The fixture nouns stay in: "disposal" and "heater" are exactly the
       * words that identify which keyword this is. */
      const mine = priced
        ? new Set(words(row.keyword))
        : distinctiveWords(row.keyword, counts, corpusRows);

      // A row with nothing but verbs in it — "repair near me" — has an empty
      // set here, matches no cluster, and so rides alone. That falls out of
      // the search below rather than needing its own branch.
      const home = clusters.find(c => [...c.shared].some(w => mine.has(w)));

      if (home) {
        home.rows.push(row);

        if (priced) {
          // UNION, not intersection, and the difference is the whole ten-row
          // cluster. Intersecting narrowed the shared vocabulary each time a
          // row joined: by the fourth tankless spelling it was down to
          // {heater}, so "tankless hot water tank" — no "heater" in it —
          // started a second cluster and the ten rows came out as two.
          //
          // Union makes membership transitive, which is what "Google is
          // treating these as one keyword" actually means. Over-merging is
          // not the risk it looks like: identical volume AND identical CPC
          // to the cent is already doing nearly all the work, and the shared
          // word is only here to stop a coincidence being absorbed.
          for (const w of mine) home.shared.add(w);
        } else {
          /* INTERSECTION when there is no price, because union's safety net
           * is the CPC and there isn't one.
           *
           * Every member must share one word with every other, so a cluster
           * is "these are all about X" rather than a chain. On the Leander
           * list that is the difference between two rows and one wrong one:
           *
           *   garbage disposal repair ∩ fix garbage disposal = {garbage, disposal}
           *   ∩ sink disposal repair                         = {disposal}
           *   ∩ garburator repair                            = {}  -> its own
           *
           * so the eight disposal wordings become one row, the two
           * garburator wordings become another, and nothing chains past
           * them. */
          for (const w of [...home.shared]) if (!mine.has(w)) home.shared.delete(w);
        }
      } else {
        clusters.push({ rows: [row], shared: mine });
      }
    }

    for (const cluster of clusters) {
      // Best first. Every comparison is "lower sorts earlier", so the two
      // scores where higher is better are negated.
      const sorted = cluster.rows.slice().sort((a, b) =>
        // A phrase nobody would say, last.
        phrasingRank(a.keyword) - phrasingRank(b.keyword)
        // The trade's own words, first.
        || seedScore(b.keyword, seedWords, seedPhrases)
           - seedScore(a.keyword, seedWords, seedPhrases)
        // No oddity in it — this is what removes the garburator.
        || commonness(b.keyword, counts) - commonness(a.keyword, counts)
        // Only now does brevity get a vote.
        || a.keyword.length - b.keyword.length
        || a.keyword.localeCompare(b.keyword)
      );

      out.push(
        sorted.length === 1
          ? sorted[0]
          : { ...sorted[0], variants: sorted.length - 1 }
      );
    }
  }

  return out;
}

module.exports = {
  hasBuyerIntent,
  buyerIntentRows,
  collapseClusters,
  medianCpc,
  priceOf,
  phrasingRank,
  wordFrequency,
  commonness,
  seedScore,
  hasGeo,
  looksInformational,
  words,
  distinctiveWords,
  CLUSTER_STOPWORDS,
  GENERIC_SHARE,
  ACTION_WORDS,
  HIRE_WORDS,
  URGENCY_WORDS,
  COMMERCE_WORDS,
  SEGMENT_WORDS,
  INFORMATIONAL,
  CPC_FLOOR_FRACTION,
  MIN_ROWS_FOR_MEDIAN,
};
