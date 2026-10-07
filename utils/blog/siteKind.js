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

/**
 * What the reader of these posts should end up wanting.
 *
 * ONE FUNCTION BECAUSE IT WAS TWO, AND THE PAIR HAS ALREADY DRIFTED ONCE.
 * suggestTopics.js and enrichTopic.js each wrote this out, and for months
 * enrich had only the local branch — so a blog whose owner left the intent
 * blank was told its readers must end up wanting to use a service that does
 * not exist. Nobody noticed, because the plugin's dropdown never submitted an
 * empty value and neither fallback had ever run. The 0.33.0 work made the
 * empty option real, and the gap with it. The sentences are identical; there
 * was never a reason for two copies.
 *
 * THE SUBJECT IS THE KEYWORD, NOT THE TITLE — 7 October, Edwin.
 *
 * It read `targetPage.title`, and a title is a headline. On his bankruptcy
 * pillar the hard constraint came out as "read more about How to Qualify for
 * a Business Loan After Bankruptcy on this site" — fourteen words of headline
 * doing the work of one instruction. Weak steering, and it makes the box feel
 * like something the owner has to fill in by hand, which is how a campaign
 * ended up aimed at a different subject entirely.
 *
 * The keyword is the same page in a searcher's words, and it is the one field
 * on that form the owner cannot leave vague — the help text under it reads
 * "No post will be allowed to compete with this term". Reading it here is what
 * makes LEAVING THE INTENT EMPTY the correct answer on a blog rather than a
 * merely tolerated one, and it lets the dropdown go back to being a refinement
 * for trades instead of a question every owner must answer.
 *
 * STILL FALLS BACK TO THE TITLE, for a target page stored before the keyword
 * box existed. Weaker steering beats none.
 *
 * @param {object}  targetPage  { intent, keyword, title }
 * @param {object}  business    for the local/blog branch
 * @param {boolean} [isLocal]   overrides the business, for a caller that has
 *                              already decided — a missing value must not read
 *                              as `false`, so this is checked by type.
 */
function readerIntent(targetPage, business, isLocal) {
  const page = targetPage || {};

  const typed = String(page.intent || '').trim();
  if (typed) return typed;

  const subject = String(page.keyword || '').trim() || String(page.title || '').trim();
  const local = 'boolean' === typeof isLocal ? isLocal : isLocalBusiness(business || {});

  /* THE BLOG SENTENCE IS AN ACTION NOW — Edwin, 7 October, option A.
   *
   * It read "read more about X on this site", and READING MORE IS NOT A WANT.
   * The topic prompt calls this line "the hard constraint" and asks that every
   * reader finish each post CLOSER to it — but nobody is moved toward reading
   * more, so there was nothing to steer against, and the clause beside it did
   * the steering instead: "something a person with that problem would
   * plausibly search, WITHOUT being the same subject as that page." That
   * clause exists to push topics away from the pillar, and with no counter-
   * weight it pushed them all the way out.
   *
   * MEASURED, NOT ARGUED. With the old sentence, eleven suggested topics for
   * a pillar on "business loan with bankruptcy record" came back with three
   * mentioning bankruptcy at all; the rest — NSF fees, chargebacks, switching
   * bank accounts — would have suited any lending pillar on the site.
   *
   * THE COUNTERWEIGHT HAS ITS OWN LIMIT. Tighten this far enough and topics
   * start competing with the pillar, which is the one failure the whole silo
   * design exists to prevent. "decide what to do next" is deliberately about
   * the READER'S decision rather than about the subject: it pulls toward the
   * pillar's problem without naming the pillar's own ground. */
  return local
    ? `use the business's ${subject} service`
    : `understand ${subject} well enough to decide what to do next`;
}

module.exports = { isLocalBusiness, tradeOf, townOf, readerIntent, PLACEHOLDERS };
