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
function pluralise(phrase) {
  const words = String(phrase).trim().split(/\s+/);
  const last = words[words.length - 1];

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

  // Overrides come FIRST in each bucket, so a customer who supplies their own
  // phrases gets them used before any generated one.
  const pool = {
    exact: unique([
      ...(overrides.exact || []),
      keyword,
      plural,
    ]),

    semantic: unique([
      ...(overrides.semantic || []),
      town ? `${keyword} in ${town}` : null,
      town ? `${plural} in ${town}` : null,
      `professional ${keyword}`,
      `local ${keyword}`,
      `${keyword} services`,
      `getting ${plural} done properly`,
      `having ${keyword} carried out`,
      town ? `${keyword} for ${town} homes` : null,
      `booking ${keyword}`,
      `arranging ${keyword}`,
      `scheduling ${keyword}`,
      `${keyword} work`,
      `experienced ${keyword}`,
      town ? `${keyword} near ${town}` : null,
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

    branded: unique([
      ...(overrides.branded || []),
      name || null,
      name && town ? `${name} in ${town}` : null,
      name ? `${name}'s ${keyword}` : null,
      name ? `the team at ${name}` : null,
    ].filter(Boolean)),
  };

  // A pool short of what a bucket needs is not an error — pickAnchors reuses
  // and flags `reused: true` — but it IS worth knowing about, because reuse
  // means several posts linking with identical text. Reported rather than
  // thrown, since a small campaign legitimately has only one exact phrase.
  const shortfalls = [];
  for (const [type, share] of Object.entries(DEFAULT_MIX)) {
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