// utils/homeAnchorPool.js
//
// The phrases a generated site uses to link to its OWN HOME PAGE.
//
// WHY THIS IS NOT utils/blog/anchorPool.js
//
// That file builds anchors for a money page whose keyword is a SERVICE —
// "water heater repair". This one builds anchors for a Rank Fast home page,
// where the keyword is the BUSINESS NAME:
//
//     business name:  Emergency Plumber Round Rock
//     keyword:        Emergency Plumber Round Rock
//
// They are the same string, deliberately. That is what the mode is for.
//
// Handing that string to the service pool produces this — every line real
// output from utils/blog/anchorPool.js, not a hypothetical:
//
//     Emergency Plumber Round Rocks                 <- pluralised the town
//     Emergency Plumber Round Rock in Round Rock    <- town twice
//     Round Rock Emergency Plumber Round Rock       <- town twice
//     Emergency Plumber Round Rock near Round Rock  <- town twice
//     getting Emergency Plumber Round Rocks done properly
//
// Two distinct faults, and both are structural rather than bad luck:
//
//   1. pluralise() guards against a trailing MODIFIER ("plumber near me" ->
//      "plumber near mes") by looking for a preposition. A business name ending
//      in a place name has no preposition, so the guard never fires and the
//      town gets an s.
//
//   2. Every template that adds the town fires blind, because the town is
//      already inside the keyword.
//
// THE FIX: DECOMPOSE THE NAME
//
// Strip the town back out to recover the service core, then build from the
// core and the town separately:
//
//     "Emergency Plumber Round Rock"  ->  core "emergency plumber" + "Round Rock"
//
// which yields "emergency plumber in Round Rock", "Round Rock emergency
// plumbers", "local emergency plumber" — correct English, and the query
// variations the home page is actually trying to cover. None of them are
// reachable without the decomposition.
//
// THREE BUCKETS, NOT FOUR
//
// The service pool has a `branded` bucket because the business name is a
// DIFFERENT vocabulary from the keyword. Here it is the same vocabulary, so
// that bucket has no separate job: "the team at Emergency Plumber Round Rock"
// is not a different kind of anchor from "Emergency Plumber Round Rock", it is
// the same anchor with words around it. Merging it into `exact` is the honest
// accounting — the brand accounts for 40% of home anchors either way, and
// pretending otherwise would make "40% exact" stop meaning 40%.

const { pluralise } = require('./blog/anchorPool');

/**
 * The mix for home-page links.
 *
 * Not DEFAULT_MIX from blog/anchors.js, and the difference is not arbitrary:
 * there is no `branded` bucket here because the brand IS the keyword (see the
 * header). Its 10% is folded into `exact`, which is why exact reads 40 rather
 * than 30.
 *
 * Naked URLs are 0% by omission rather than by rule. They were the Rank Fast
 * default for every page after the first one or two; Google's own link
 * documentation names a naked URL as a bad anchor, and it spends a slot that
 * could have described the page.
 */
const HOME_MIX = {
  exact:       40,
  semantic:    40,
  descriptive: 20,
};

/** Escape a string for use inside a RegExp. */
function escapeRe(value) {
  return String(value || '').replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

/** Collapse whitespace and trim. Casing is left alone. */
function tidy(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/** Drop duplicates (case-insensitively) and empties, preserving order. */
function unique(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const value = tidy(item);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/**
 * Split "Round Rock, TX" into its parts.
 *
 * A location with no state — just "Leander" — is normal and returns an empty
 * state rather than guessing one.
 */
function splitLocation(location) {
  const text = tidy(location);
  if (!text) return { town: '', state: '' };

  const match = text.match(/^(.*?)[,\s]+([A-Za-z]{2})$/);
  if (match) return { town: tidy(match[1]), state: match[2].toUpperCase() };

  return { town: text, state: '' };
}

/**
 * The business name with the town (and state) removed, lowercased.
 *
 *   "Emergency Plumber Round Rock"      -> "emergency plumber"   decomposed
 *   "Round Rock Emergency Plumber"      -> "emergency plumber"   decomposed
 *   "Emergency Plumber of Round Rock"   -> "emergency plumber"   decomposed
 *   "Emergency Plumber Round Rock, TX"  -> "emergency plumber"   decomposed
 *   "Bob's Plumbing"                    -> "Bob's Plumbing"      NOT decomposed
 *
 * `decomposed` is the important half of the return value. It is false when the
 * town was not in the name — which means the Rank Fast premise does not hold
 * for this customer, and the caller must not treat what came back as a service
 * phrase. "Bob's Plumbing" decorated like one gives "local bob's plumbing":
 * a lowercased proper noun wearing an adjective that belongs to a trade.
 *
 * The core is lowercased only when it IS a service phrase, because it then sits
 * mid-sentence — "local emergency plumber" reads correctly where "local
 * Emergency Plumber" reads like a citation. An undecomposed name keeps its
 * casing, being a name.
 */
function serviceCore(businessName, location) {
  const name = tidy(businessName);
  if (!name) return { core: '', decomposed: false };

  const { town, state } = splitLocation(location);
  let core = name;

  if (town) {
    // The state only ever trails the town, so it goes first — otherwise
    // removing "Round Rock" from "...Round Rock, TX" strands ", TX".
    if (state) {
      core = core.replace(
        new RegExp(`[,\\s]+${escapeRe(town)}[,\\s]+${escapeRe(state)}\\b`, 'i'),
        ''
      );
    }

    // "of Round Rock", "in Round Rock", "serving Round Rock" — the connective
    // is part of what gets removed, or it is left dangling on the end.
    core = core.replace(
      new RegExp(`[,\\s]+(?:of|in|serving|near|around)\\s+${escapeRe(town)}\\b`, 'i'),
      ''
    );

    // Bare, at either end. Anchored so a town name that also appears mid-name
    // is left alone.
    core = core.replace(new RegExp(`^${escapeRe(town)}\\b[,\\s]*`, 'i'), '');
    core = core.replace(new RegExp(`[,\\s]*\\b${escapeRe(town)}$`, 'i'), '');
  }

  core = tidy(core).replace(/[,\s]+$/, '');

  // Nothing was removed, or everything was ("Round Rock" as a business name).
  // Either way there is no service phrase to build on.
  if (!core || core.toLowerCase() === name.toLowerCase()) {
    return { core: name, decomposed: false };
  }

  return { core: core.toLowerCase(), decomposed: true };
}

/**
 * Is this core a PERSON — a plumber, a roofer, a contractor — rather than a
 * job, like "water heater repair"?
 *
 * It matters because several natural-sounding templates are person-only:
 *
 *     experienced plumbers            experienced water heater repair
 *     plumbers serving Round Rock     water heater repairs serving Round Rock
 *     trusted roofers                 trusted roof replacements
 *
 * The right-hand column is what shipped before this check existed. This is the
 * same failure as "plumber near mes": a template that reads correctly for one
 * grammatical shape applied to every shape.
 *
 * Agent nouns are recognisable by their endings — -er, -or, -ist, -ian, -man,
 * -smith, -wright. The test is on the LAST word, which is the head noun in
 * every service name this app produces ("emergency plumber", "24 hour
 * electrician").
 */
function isAgentNoun(phrase) {
  const words = tidy(phrase).split(/\s+/);
  const last = (words[words.length - 1] || '').toLowerCase();
  return /(?:er|or|ist|ian|man|men|smith|wright)$/.test(last);
}

/**
 * Build the home-page anchor pool.
 *
 * @param {object} opts
 * @param {string} opts.businessName  the name, which in Rank Fast IS the keyword
 * @param {string} opts.location      "Round Rock, TX"
 * @returns {{pool: object, core: string}}
 */
function buildHomeAnchorPool({ businessName, location } = {}) {
  const name = tidy(businessName);

  if (!name) {
    throw new Error('buildHomeAnchorPool: businessName is required');
  }

  const { town, state } = splitLocation(location);
  const { core, decomposed } = serviceCore(name, location);

  // Only a decomposed core is a service phrase. An undecomposed one is the
  // business name itself, and pluralising or decorating a name is wrong:
  // "trusted Bob's Plumbings", "local bob's plumbing".
  const plural = decomposed ? pluralise(core) : core;
  const hasPlural = plural !== core;

  // Person or job? Several templates below read correctly for only one of them.
  const agent = decomposed && isAgentNoun(core);

  const pool = {
    /**
     * EXACT MEANS EXACT: the business name verbatim, one string.
     *
     * Not the name plus the state, not the name in title case, not "the team
     * at <name>". Those are all different strings, and a different string in
     * this bucket would inflate the exact share past its 40% while still being
     * counted as exact — the same mistake the plural made in the blog pool.
     *
     * One phrase for 40% of the links means it repeats, on purpose. Four pages
     * linking home with the identical text "Emergency Plumber Round Rock" IS
     * what 40% exact describes, and it is also what every real site on the
     * internet does with its home link.
     */
    exact: [name],

    /**
     * The query variations around the name. This is the bucket that does the
     * ranking work the exact bucket cannot: the site already wins its own
     * name, so what is left to teach Google is the vocabulary next to it.
     *
     * Every entry is built from `core` and `town` SEPARATELY. Nothing here
     * appends to the full business name — that is what produced "Emergency
     * Plumber Round Rock in Round Rock".
     */
    semantic: unique([
      // Locational. Safe for a service phrase AND for an undecomposed name —
      // "Bob's Plumbing in Round Rock" is perfectly good anchor text.
      town ? `${core} in ${town}` : null,
      town && state ? `${core} in ${town}, ${state}` : null,
      town && hasPlural ? `${plural} in ${town}` : null,

      // Everything below decorates the core, so it requires a real service
      // phrase. Applied to a business name these give "local bob's plumbing".
      decomposed && town ? `${town} ${core}` : null,
      decomposed && town && hasPlural ? `${town} ${plural}` : null,
      decomposed && town ? `${core} near ${town}` : null,
      decomposed ? `local ${core}` : null,
      decomposed ? `professional ${core}` : null,

      // Person-only. "experienced water heater repair" and "water heater
      // repairs serving Round Rock" are what these produce otherwise.
      agent ? `experienced ${core}` : null,
      agent && hasPlural ? `trusted ${plural}` : null,
      agent && hasPlural && town ? `${plural} serving ${town}` : null,
    ].filter(Boolean)),

    /**
     * What the reader gets by clicking, with no keyword at all.
     *
     * Deliberately NOT the blog pool's descriptive list. Those phrases
     * ("what the work involves", "what it costs to put right") describe a
     * single job, which is what a service page is. A home page is the company,
     * so these describe the company.
     *
     * EVERY ENTRY MUST BE A BARE VERB PHRASE that completes "You can also …",
     * because that is the sentence injectPagesInterlinks wraps a descriptive
     * anchor in, and a descriptive anchor almost always lands there — the
     * phrase contains no keyword, so it is never already in the page copy.
     *
     * "who we are and what we do" was here and had to go: it reads fine alone
     * and gives "You can also who we are and what we do." Test the sentence,
     * not the phrase.
     */
    descriptive: unique([
      'see everything we do',
      'find out more about the company',
      'learn more about us',
      'see the full range of services',
      'read more about who we are',
      'take a look at what we offer',
      'see how we work',
    ]),
  };

  // An empty bucket makes pickAnchors throw. semantic is the only one that can
  // realistically empty — a one-word business name identical to its town.
  if (!pool.semantic.length) pool.semantic = [...pool.descriptive];

  return { pool, core };
}

module.exports = {
  HOME_MIX,
  buildHomeAnchorPool,
  serviceCore,
  splitLocation,
  isAgentNoun,
};
