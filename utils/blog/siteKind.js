// utils/blog/siteKind.js
//
// Is this a local service business, or a site about a subject?
//
// WHY ONE FUNCTION AND NOT FOUR CHECKS
//
// Five things behave differently: the business block in the writer's prompt,
// the business block in the topic prompt, the topic angles, the descriptive
// anchors and the semantic anchors. Each of them could ask the question for
// itself in one line, and that is exactly how the business-payload bug got in
// — three call sites, one with a correct mapping written inline and two
// without. Copies of a decision drift. There is one decision here and five
// readers of it.
//
// THE SIGNAL
//
// A site with no trade and no town cannot use any of the local machinery. It
// is not a guess about what the customer wants; it is a statement about what
// is available. "Leander small business loans for women" needs a Leander, and
// "what happens during the visit" needs someone to visit.
//
// NO SETTING, NO CHECKBOX. The plugin reads the business from the generated
// theme's settings, and a site that never had one has nothing to read. Asking
// the owner to tick a box to tell us what we can already see is a setup step
// that can be got wrong; this cannot.
//
// WHAT THIS DELIBERATELY DOES NOT DECIDE
//
// Whether the subject involves a "job". A general plumbing blog with no town
// is not local, but "what actually happens during the job" is still a good
// angle for it; on a climate blog it is not. Nothing here can tell those
// apart, so the angle stays for both. Only the town angle is dropped, because
// a town angle without a town is mechanically impossible rather than a matter
// of taste.
//
// THE TWO VOCABULARIES ARE BOTH ACCEPTED, and that is not laziness. The
// server stores `type`/`location`; buildContext hands the prompts
// `trade`/`town`. Both shapes reach this function from different callers, and
// a function that silently answered "not local" for one of them would be the
// business-payload bug again, in a place where the symptom is blander: good
// topics quietly becoming generic ones. Asserted in both shapes by the tests.

/**
 * The first of these fields that actually holds something.
 *
 * PLACEHOLDERS COUNT AS EMPTY. buildContext used to substitute the literal
 * strings 'trade' and 'the business' for missing values so prompts would not
 * read "undefined". Those placeholders are gone, but a BlogSite written
 * before they were removed can still hold one, and a stored business whose
 * trade is the word "trade" would otherwise read as a real trade forever.
 */
const PLACEHOLDERS = new Set(['trade', 'the business']);

function value(business, ...fields) {
  for (const field of fields) {
    const text = String(business[field] == null ? '' : business[field]).trim();
    if (text && !PLACEHOLDERS.has(text.toLowerCase())) return text;
  }
  return '';
}

/** The business's trade, under either name. '' when it has none. */
function tradeOf(business = {}) {
  return value(business, 'trade', 'type');
}

/**
 * The business's town, under either name, without a trailing state code.
 *
 * 'Leander, TX' -> 'Leander'. The prompts put this in sentences, where the
 * state code reads as an address rather than a place.
 */
function townOf(business = {}) {
  return value(business, 'town', 'location').replace(/,\s*[A-Z]{2}$/, '').trim();
}

/**
 * Does this site have a trade or a town to work with?
 *
 * THE NAME IS NOT PART OF THE TEST, and that is the whole point. Every site
 * has a name — `IE_Settings::business()` falls back to the WordPress site
 * title when nothing else is set, so a name is always present and tells us
 * nothing. A guard that included it would never fire, which is precisely what
 * happened to writePost's own `hasBusiness` check: written for this exact
 * case, defeated by a fallback added in another file.
 */
function isLocalBusiness(business = {}) {
  if (!business || typeof business !== 'object') return false;
  return !!(tradeOf(business) || townOf(business));
}

module.exports = { isLocalBusiness, tradeOf, townOf, PLACEHOLDERS };
