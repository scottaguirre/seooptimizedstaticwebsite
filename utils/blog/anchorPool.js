// utils/blog/anchorPool.js
//
// The phrases posts use to link to the money page.
//
// WHY THIS FILE HAD TO EXIST
//
// anchors.js pickAnchors() THROWS when a bucket is empty:
//
//     Anchor pool has nothing for "semantic" (slot 3).
//
// and with no pool at all it throws a TypeError before that. The preview
// harness supplied the pool by hand in campaign.example.js. The server has
// nobody to hand it one, so it builds its own.
//
// WHY IT IS DETERMINISTIC AND NOT A MODEL CALL
//
// Anchor text is formulaic — the four buckets are the keyword, a variation on
// it, a description of the page, and the business name. A model would produce
// the same shapes less predictably, cost a call per campaign, and could not be
// tested. This can, and the same campaign always plans identically.
//
// The four buckets, and what each is FOR:
//
//   exact        the keyword itself. Strongest signal, most obviously
//                manipulated, so it is only 15% of the mix.
//   semantic     the keyword said differently. The workhorse at 50% — it
//                describes the page without repeating one string.
//   descriptive  describes what the reader gets by clicking, without
//                necessarily containing the keyword at all.
//   branded      the business name. Natural on any real site, and the one
//                bucket a competitor cannot imitate.

const { DEFAULT_MIX } = require('./anchors');

/** 'Water Heater Repair' -> 'water heater repair' */
function normalise(text) {
  return String(text || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Does `haystack` already contain `needle` as whole words?
 *
 * Used to stop a template adding something the business name already says.
 * Word-boundary rather than substring, so "Rock" does not match "Rockwall".
 */
function containsPhrase(haystack, needle) {
  const target = normalise(needle);
  if (!target) return false;

  const escaped = target.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(String(haystack || ''));
}

/** Drop duplicates and empties, preserving order. */
function unique(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = normalise(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(String(item).trim());
  }
  return out;
}

/**
 * A rough plural. Good enough for anchor text, which is all it is for —
 * "water heater repair" -> "water heater repairs".
 */
/**
 * Words after which the last word is NOT the head noun.
 *
 * "plumber near me" pluralised to "plumber near mes" and shipped on a live
 * post. The head noun is "plumber"; everything after the preposition is a
 * modifier, and appending an s to the end of a modifier is never right.
 */
const PREPOSITIONS = new Set([
  'near', 'in', 'at', 'for', 'on', 'to', 'with', 'by', 'from', 'around', 'of',
]);

/** Last words that are not nouns at all. */
const NOT_A_NOUN = new Set([
  'me', 'you', 'us', 'them', 'it', 'here', 'there', 'now', 'today', 'nearby',
]);

/**
 * The plural of a keyword phrase, or the phrase unchanged when pluralising it
 * would produce nonsense.
 *
 * Returning the input unchanged is deliberate: every caller puts the result in
 * a list that runs through unique(), so an unchanged value simply disappears
 * rather than becoming a second, broken anchor.
 */
function pluralise(phrase) {
  const words = String(phrase).trim().split(/\s+/);
  const last = words[words.length - 1];

  if (!last) return phrase;

  // A preposition anywhere means the head noun is not at the end.
  if (words.some(w => PREPOSITIONS.has(w.toLowerCase()))) return phrase;

  if (NOT_A_NOUN.has(last.toLowerCase())) return phrase;

  // Gerunds and mass nouns: plumbing, roofing, heating, cleaning. "plumbings"
  // is not a word, and the ones that are ("cleanings") read like a dentist.
  if (/ing$/i.test(last)) return phrase;

  if (/(s|x|z|ch|sh)$/i.test(last)) return phrase;          // already plural-ish
  if (/[^aeiou]y$/i.test(last)) {
    words[words.length - 1] = last.replace(/y$/i, 'ies');
    return words.join(' ');
  }

  words[words.length - 1] = `${last}s`;
  return words.join(' ');
}

/**
 * Build a pool big enough for `count` posts.
 *
 * @param {object} opts
 * @param {object} opts.targetPage  { keyword, title }
 * @param {object} opts.business    { name, type, location }
 * @param {number} opts.count       how many posts the campaign has
 * @param {object} [opts.overrides] caller-supplied phrases, merged in first
 */
function buildAnchorPool({ targetPage = {}, business = {}, count = 1, overrides = {} }) {
  const keyword = String(targetPage.keyword || '').trim();

  if (!keyword) {
    throw new Error('buildAnchorPool: targetPage.keyword is required');
  }

  const town = String(business.location || '').trim().replace(/,\s*[A-Z]{2}$/, '');
  const name = String(business.name || '').trim();
  const plural = pluralise(keyword);

  /**
   * Can anything be appended after this keyword and still read as English?
   *
   * Only if it is a service NAME. A keyword that is really a search QUERY —
   * "plumber near me", "plumber in Leander" — already ends in a modifier, so
   * "plumber near me services", "booking plumber near me" and "plumber near me
   * near Leander" all came out of the templates below before this guard.
   *
   * Adjectives in FRONT still work ("local plumber near me"), so only the
   * suffix forms are dropped.
   */
  const suffixable = !keyword.split(/\s+/).some(w => PREPOSITIONS.has(w.toLowerCase()));

  // Overrides come FIRST in each bucket, so a customer who supplies their own
  // phrases gets them used before any generated one.
  const pool = {
    /**
     * EXACT MEANS EXACT: the target page's keyword, verbatim. One string.
     * Nothing else belongs here — not the plural, not the town, not a
     * qualifier. If it is not character-for-character the phrase the page is
     * trying to rank for, it is not an exact-match anchor.
     *
     * This bucket was briefly widened with `${town} ${keyword}`,
     * `${keyword} company` and similar, to stop it running dry once
     * DEFAULT_MIX went to 30%. That was wrong twice over. Those are PHRASE
     * match, not exact — so "30% exact" silently stopped meaning what it
     * says — and the problem it solved was not a problem. The plural survived
     * that clean-up by being small enough not to look like the same mistake.
     * It was.
     *
     * Four of twelve posts linking with the identical text "water heater
     * repair" IS what 30% exact match means. Repetition is the point. The
     * no-duplicates instinct comes from backlink profiles, where an anchor
     * distribution is evidence about who built the links; internal anchors
     * carry no such evidence, because Google knows you wrote all of them.
     *
     * So this bucket is allowed to be small and is allowed to repeat. See the
     * shortfall check below, which deliberately does not complain about it.
     */
    exact: unique([
      ...(overrides.exact || []),
      keyword,
    ]),

    semantic: unique([
      ...(overrides.semantic || []),
      // The plural lived in `exact` until 19 September. It is a different
      // string from the keyword, so it was never an exact match — the same
      // error as the phrase-match forms below, one word smaller.
      //
      // Null when pluralise() declined: it returns the phrase unchanged for
      // anything it cannot pluralise safely, and the keyword verbatim sitting
      // in the SEMANTIC bucket is an exact-match anchor wearing the wrong
      // label — it would quietly inflate the exact share past its 30%.
      plural !== keyword ? plural : null,
      town && suffixable ? `${keyword} in ${town}` : null,
      town && suffixable ? `${plural} in ${town}` : null,
      `professional ${keyword}`,
      `local ${keyword}`,
      // Skipped when the keyword already ends in service/services, which
      // otherwise produced "residential plumbing services services".
      ( suffixable && ! /(service|services)$/i.test(keyword) ) ? `${keyword} services` : null,
      // Phrase match: the keyword plus a qualifier. Moved here on
      // 19 September after being wrongly filed under `exact`.
      suffixable ? `${keyword} company` : null,
      suffixable ? `${keyword} specialists` : null,
      town ? `${town} ${keyword}` : null,
      suffixable ? `getting ${plural} done properly` : null,
      suffixable ? `having ${keyword} carried out` : null,
      town && suffixable ? `${keyword} for ${town} homes` : null,
      suffixable ? `booking ${keyword}` : null,
      suffixable ? `arranging ${keyword}` : null,
      suffixable ? `scheduling ${keyword}` : null,
      suffixable ? `${keyword} work` : null,
      `experienced ${keyword}`,
      town && suffixable ? `${keyword} near ${town}` : null,
    ].filter(Boolean)),

    descriptive: unique([
      ...(overrides.descriptive || []),
      'what the work involves',
      'how the job is usually handled',
      'what it costs to put right',
      'have someone look at it',
      'get it looked at properly',
      'what happens on the visit',
      'talk it through with someone',
      'find out what is involved',
      'see how the job is done',
      'have it assessed',
    ]),

    /**
     * The business name. The one bucket a competitor cannot imitate, and the
     * only one here that is a DIFFERENT vocabulary from the keyword.
     *
     * TWO TEMPLATES HAVE TO CHECK THE NAME FIRST, because a business name is
     * not a neutral string — it frequently already contains the town, the
     * service, or both. Rank Fast customers are named that way ON PURPOSE:
     *
     *     "Emergency Plumber Round Rock"   in Round Rock
     *     "Water Heater Repair Leander"    targeting "water heater repair"
     *
     * Without the guards those produced, as live anchor text:
     *
     *     Emergency Plumber Round Rock in Round Rock
     *     Water Heater Repair Leander's water heater repair
     *
     * Neither showed on a 12-post campaign, because 10% of 12 rounds to one
     * branded anchor and `name` alone is first in the list. From 15 posts up
     * the second phrase is reached and it ships. That is why this was invisible
     * for so long — it is not rare, it is just second.
     */
    branded: unique([
      ...(overrides.branded || []),
      name || null,
      // Skipped when the name already names the town.
      name && town && !containsPhrase(name, town) ? `${name} in ${town}` : null,
      // Skipped when the name already contains the service.
      name && !containsPhrase(name, keyword) ? `${name}'s ${keyword}` : null,
      name ? `the team at ${name}` : null,
    ].filter(Boolean)
      // A business named exactly after the target keyword would put an
      // exact-match anchor in the branded bucket, inflating the exact share
      // past its 30% while it was counted as branded.
      .filter(phrase => normalise(phrase) !== normalise(keyword))),
  };

  // A pool short of what a bucket needs is not an error — pickAnchors reuses
  // and flags `reused: true` — but it IS worth knowing about, because reuse
  // means several posts linking with identical text. Reported rather than
  // thrown, since a small campaign legitimately has only one exact phrase.
  const shortfalls = [];
  for (const [type, share] of Object.entries(DEFAULT_MIX)) {
    // 'exact' is exempt, and not as a convenience. There are only so many ways
    // to write a keyword verbatim, so this bucket is meant to run out and be
    // reused — that is what an exact-match share above a couple of posts
    // describes. Reporting it would train the owner to ignore the warnings
    // that do matter.
    if ('exact' === type) continue;

    const needed = Math.ceil((share / 100) * count);
    if (pool[type].length < needed) {
      shortfalls.push({ type, have: pool[type].length, needed });
    }
  }

  // The one case that IS fatal: an empty bucket makes pickAnchors throw.
  // 'branded' is the realistic one — a site activated without a business name.
  for (const type of Object.keys(DEFAULT_MIX)) {
    if (!pool[type].length) {
      // Fall back to the semantic bucket rather than failing the campaign. A
      // branded anchor that says the keyword is worse than one saying the
      // business name, and better than no campaign at all.
      pool[type] = pool.semantic.length ? [...pool.semantic] : [keyword];
    }
  }

  return { pool, shortfalls };
}

/**
 * Anchors already pointing at this URL, across every earlier campaign.
 *
 * anchors.js takes `used` as a parameter precisely so this can be supplied
 * from storage: the variety that matters is the variety of anchors pointing
 * at ONE page, accumulated over time. A second campaign that reuses the first
 * campaign's phrases has added volume without adding variety.
 *
 * @param {Array} campaigns  earlier BlogCampaign documents for the same URL
 * @returns {Set<string>}
 */
function usedAnchorsFrom(campaigns = []) {
  const used = new Set();

  for (const campaign of campaigns) {
    for (const slot of campaign.slots || []) {
      if (slot.moneyAnchor) used.add(String(slot.moneyAnchor).toLowerCase().trim());
    }
  }

  return used;
}

module.exports = { buildAnchorPool, usedAnchorsFrom, pluralise };