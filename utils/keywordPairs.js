// utils/keywordPairs.js
//
// Every service this trade sells, paired with the town, so the volumes can be
// looked up directly.
//
// WHY THIS EXISTS — AND IT IS NOT THE REASON I FIRST GAVE
//
// The research page's category mode never returns a term with the town in it.
// "plumber cedar park" simply never appeared, however wide the seed net got.
//
// My first explanation was that such terms sit under Google's reporting floor
// in a town Cedar Park's size. I guessed ten to twenty searches a month.
//
// Then Edwin looked it up in the exact-term mode:
//
//   plumber cedar park    170/month    $44.64    top of page $61.41–$177.49
//
// So the volume is not the problem, and was never the problem. 170 a month
// would sit comfortably inside a top-thirty list. The real reason is the one
// his own Keyword Planner screenshots had been showing all along:
//
//   GOOGLE TREATS THE CITY AS A TARGETING SETTING, NOT AS TEXT.
//
// Target Cedar Park and seed "plumbing" and the ideas come back generic —
// "plumbers near me", "emergency plumber near me", "water heater repair near
// me". The VOLUMES are Cedar Park's; the WORDS are not. Google assumes the
// location is handled by targeting, so it never proposes putting the town in
// the query. No amount of seeding fixes that, because it is not a seeding
// problem.
//
// So the discovery endpoint structurally cannot answer this. The LOOKUP
// endpoint can, because it answers about exactly the words it is given — and
// it takes a thousand keywords in one $0.09 task, where this builds under two
// hundred. One task, and it is the cheaper of the two, not the dearer.
//
// WHAT THIS IS FOR
//
// These are the terms the app's location pages are built to rank for. A
// customer deciding whether "Water Heater Repair in Cedar Park" is worth a
// page wants the number for that exact phrase, not for "water heater repair
// near me" — which is a different page with different words on it.
//
// WHY IT ASKS ABOUT FORMS IT KNOWS MAY BE NONSENSE
//
// "plumbing" -> "plumber" is easy. "web design" -> "web designer" is fine.
// "lemon law" -> "lemon lawer" is gibberish.
//
// It is generated anyway, on purpose. Guessing English morphology correctly
// for every trade the app will ever sell to is not a solvable problem, and a
// wrong guess is not expensive here: a term nobody searches comes back with
// no figure and is shown as a dash. The alternative — a hand-maintained map
// of trade nouns — covers the trades somebody remembered and silently fails
// for the rest.
//
// Put plainly: DO NOT GUESS WHICH FORM IS RIGHT, ASK ABOUT BOTH AND LET
// GOOGLE ANSWER. There are a thousand slots in the task and this uses a
// fraction of them.

/**
 * How customers qualify a tradesperson.
 *
 * Ordered by how much intent each carries, because the list is capped and the
 * top of it is the part worth having. "emergency" is somebody with water
 * coming through the ceiling; "affordable" is somebody shopping around.
 */
const QUALIFIERS = [
  'emergency',
  'commercial',
  'residential',
  '24 hour',
  'local',
  'best',
  'licensed',
  'affordable',
  'cheap',
];

/** What a business is called, so "plumbing company cedar park" is asked about. */
const BUSINESS_WORDS = ['company', 'companies', 'contractor', 'services'];

/**
 * The most pairings one task will carry.
 *
 * Far below DataForSEO's thousand — the cap is here to keep the TABLE
 * readable, not to stay inside the endpoint. A typical trade produces forty
 * to sixty.
 */
const MAX_PAIRS = 200;

/**
 * "plumbing" -> ["plumber", "plumbers"]. Cheap and deliberately fallible.
 *
 * See the header: a wrong form costs one slot in a task with a thousand of
 * them and shows as a dash. A missing form costs the customer the best page
 * on their site.
 */
function practitionerForms(industry) {
  const trade = String(industry || '').trim().toLowerCase();
  if (!trade) return [];

  const parts = trade.split(/\s+/);
  const last = parts[parts.length - 1];
  const head = parts.slice(0, -1).join(' ');

  // plumbing -> plumb, roofing -> roof, landscaping -> landscap
  const stem = /ing$/.test(last) ? last.replace(/ing$/, '') : last;

  const forms = new Set();

  for (const suffix of ['er', 'ers']) {
    // landscap + er -> landscaper; design + er -> designer. A stem ending in
    // e takes the suffix without doubling it: "plumbe" + "r" is wrong, but
    // no trade word stems that way in practice, so the simple rule stands.
    const word = /e$/.test(stem) ? `${stem}r${suffix === 'ers' ? 's' : ''}` : stem + suffix;
    forms.add(head ? `${head} ${word}` : word);
  }

  return [...forms];
}

/**
 * Every term worth asking Google about, for this trade in this town.
 *
 * ORDER IS PRIORITY, because the list is capped and the table is read from the
 * top. The bare pairings first — they are the ones with real volume, as
 * "plumber cedar park" at 170 a month showed. Then the qualified ones, then
 * the individual services.
 *
 * @param {string} industry
 * @param {object} opts
 * @param {string} opts.city          the bare town, "Cedar Park"
 * @param {string[]} [opts.services]  the trade's vocabulary, from
 *   utils/keywordSeeds — already cached per industry, so this costs nothing
 * @param {string[]} [opts.qualifiers]
 * @param {number} [opts.limit]
 */
function pairsFor(industry, opts = {}) {
  const trade = String(industry || '').trim().toLowerCase();
  const city = String(opts.city || '').trim().toLowerCase();

  if (!trade || !city) return [];

  const limit = Math.max(1, Math.min(Number(opts.limit) || MAX_PAIRS, MAX_PAIRS));
  const qualifiers = opts.qualifiers || QUALIFIERS;
  const people = practitionerForms(trade);

  const out = [];

  // 1. The trade and the town, both ways round. Google's idea engine treats
  //    these as different queries and so does its volume data.
  out.push(`${trade} ${city}`, `${city} ${trade}`);

  // 2. The person, which is what somebody hiring actually types.
  for (const person of people) out.push(`${person} ${city}`, `${city} ${person}`);

  // 3. The business, for "plumbing company cedar park".
  for (const word of BUSINESS_WORDS) out.push(`${trade} ${word} ${city}`);

  // 4. Qualified. Singular only — "emergency plumbers cedar park" is the same
  //    page as "emergency plumber cedar park" and would spend a second row
  //    saying so.
  const singular = people[0];
  for (const qualifier of qualifiers) {
    out.push(`${qualifier} ${trade} ${city}`);
    if (singular) out.push(`${qualifier} ${singular} ${city}`);
  }

  // 5. Each individual service in the town. These are the location pages.
  for (const service of (opts.services || [])) {
    const name = String(service || '').trim().toLowerCase();
    if (name) out.push(`${name} ${city}`);
  }

  // Deduped case-insensitively, matching keywordVolumes.keywordList, so a
  // repeat does not spend a slot AND miss the cache.
  const seen = new Set();
  const list = [];

  for (const term of out) {
    const clean = term.replace(/\s+/g, ' ').trim();
    if (!clean || seen.has(clean)) continue;

    seen.add(clean);
    list.push(clean);

    if (list.length >= limit) break;
  }

  return list;
}

/**
 * Sort the answers for display: biggest first, unanswered last.
 *
 * UNANSWERED ROWS ARE KEPT, not dropped. "Google has no figure for
 * 'commercial plumber cedar park'" is a real finding and the reason to write
 * that page differently — or not at all. Dropping them would leave the
 * customer thinking the term was never checked.
 */
function sortPairs(rows) {
  return (rows || []).slice().sort((a, b) => {
    const left = a && a.volume != null ? a.volume : -1;
    const right = b && b.volume != null ? b.volume : -1;

    return right - left
      || String((a && a.keyword) || '').localeCompare(String((b && b.keyword) || ''));
  });
}

module.exports = {
  pairsFor,
  practitionerForms,
  sortPairs,
  QUALIFIERS,
  BUSINESS_WORDS,
  MAX_PAIRS,
};
