// utils/localOptions/chooseServices.js
//
// Which six of the suggested services this business gets.
//
// WHY THIS EXISTS — Edwin, 17 November, looking at two finished sites:
// *"the problem i see now is that all websites get the same services."*
//
// He was right, and nothing was broken. There is no services step in this
// wizard — he removed it on 28 October, *"the service pages option should
// not be there as the model will suggest"* — so generate.js calls
// suggestServices() with the trade and the town and nothing else, and that
// prompt says:
//
//     ORDER THEM BY HOW COMMONLY THIS KIND OF BUSINESS IS ACTUALLY HIRED
//     FOR THEM. The first is the one they are called about most.
//
// ASKING FOR THE SIX MOST COMMON PLUMBING JOBS HAS ONE RIGHT ANSWER. Two
// plumbers differ by their name, their address and their town; none of
// those changes what a plumber sells. So every plumbing site came back with
// the same six names in the same order, and it was the instruction working,
// not failing.
//
//     THE INPUT DID NOT VARY, SO THE OUTPUT COULD NOT.
//     THE FIX IS NOT A BETTER PROMPT. IT IS A WIDER LIST AND A CHOICE.
//
// SO: ASK FOR TWELVE, KEEP THE BEST TWO, CHOOSE THE OTHER FOUR.
//
// The first two are kept for every business because they are the two the
// trade is genuinely hired for most, and a plumber whose site leads on
// "Hose Bib Replacement" has a worse site than one that leads on "Drain
// Cleaning". Variety is not worth the two best pages.
//
//     THE ANCHORS ARE WHAT STOPS THIS BEING RANDOMISATION.
//     A DIFFERENT SIX IS ONLY BETTER IF IT IS STILL A GOOD SIX.
//
// And it matters more than it looks: HOME_BODY_LINKS is two, so the first
// two rows of the home page are the LINKED ones. The anchors are exactly
// the services the home page points at.
//
// DETERMINISTIC, NOT RANDOM, AND THAT IS THE WHOLE MECHANISM.
//
// The business name is hashed. The same business rebuilt gets the same six;
// two businesses get different sixes. It is the trick pickSet() in
// heroes.js already uses to decide which folder of photographs a site gets,
// for the same reason — *"the business name decides the set, so the same
// business rebuilt gets the same photographs and its stored alt text still
// describes them."*
//
// THE NAME IS HASHED WITH THE SERVICE, NOT WITH ITS POSITION. A rebuild
// asks the model again, and a model handed the same question twice can
// return the same twelve in a slightly different order. Hashing the
// position would then deal a different six for no reason anybody could see.
// Hashing the name means a service that was chosen stays chosen as long as
// it is still on the list.
//
//   node test-local-options-services.js

'use strict';

const crypto = require('crypto');

const { SERVICE_COUNT } = require('./render/shape');

/**
 * How many names the model is asked for.
 *
 * ⚠ EIGHTEEN, AND IT WAS TWELVE FOR ABOUT AN HOUR. Edwin, on the first
 * site built after the change: *"i thought you fixed the same 6 services
 * always repeating."*
 *
 * He was right, and so was the code. Measured across ten business names,
 * twelve-and-two left **3.4 of 6 services shared** between any two sites
 * and **2.8 of 6 in the same position** — more than half the list, with
 * the first two identical by design, and the start of the list is where
 * the eye goes.
 *
 *     A CHANGE THAT CANNOT BE SEEN IS NOT A CHANGE.
 *     I PICKED THE SAFE NUMBERS AND SHIPPED SOMETHING INVISIBLE.
 *
 * Eighteen and one gives 2.4 shared and 1.6 in the same position, which
 * reads as two different businesses.
 *
 * NOT TWENTY. suggestServices caps there and says why in its own header:
 * past roughly twenty a model stops producing distinct services and starts
 * producing restatements. Eighteen leaves the cleaner room to throw two
 * away without the pool collapsing to the six we started with.
 */
const SERVICE_POOL = 18;

/**
 * How many of the top names every business keeps.
 *
 * ONE, AND IT WAS TWO. Two was chosen because HOME_BODY_LINKS is two, so
 * the first two rows of the home page are the LINKED ones and both wanted
 * to be services the trade is genuinely hired for. That reasoning was
 * sound and the result was six lists that looked alike.
 *
 * THE SECOND LINKED ROW IS STILL SAFE, AND THAT IS MEASURED RATHER THAN
 * HOPED. Because the chosen four keep their order, the second row is the
 * EARLIEST of the four in the suggested list — not a free draw. Across 320
 * business names it lands at position 3 on median, 7 at the 90th
 * percentile, 11 at worst, and outside the top eight for 4% of sites.
 *
 *     THE ORDER BEING PRESERVED IS WHAT MAKES ONE ANCHOR SAFE.
 *     DROP THE ORDER AND THE SECOND LINKED ROW BECOMES A COIN TOSS.
 *
 * So anything that stops preserving the order has to revisit this number
 * at the same time. The suite checks the second row's position for exactly
 * that reason.
 */
const ANCHORS = 1;

/**
 * A stable number for a (business, service) pair.
 *
 * sha1 BECAUSE IT IS NOT A SECURITY DECISION. Nothing here resists an
 * attacker; it needs an even spread and the same answer every time, which
 * is what pickSet() uses it for four files away.
 *
 * LOWERCASED AND TRIMMED ON BOTH SIDES, so "Leander Plumbing " and
 * "leander plumbing" are one business rather than two. A form that gains a
 * trailing space would otherwise re-deal every service on the site.
 */
function scoreOf(key, name) {
  const left = String(key == null ? '' : key).trim().toLowerCase();
  const right = String(name == null ? '' : name).trim().toLowerCase();

  return crypto.createHash('sha1')
    .update(`${left}\u0000${right}`)
    .digest()
    .readUInt32BE(0);
}

/**
 * Narrow a suggested list to the six this business will have.
 *
 * @param {string[]} names            what the model returned, best first
 * @param {object}   [opts]
 * @param {string}   [opts.key]       the business name; decides the draw
 * @param {number}   [opts.count]     how many to end up with
 * @param {number}   [opts.anchors]   how many of the top to keep for everyone
 * @returns {string[]}
 *
 * THE ORDER THAT COMES OUT IS THE ORDER THAT WENT IN. The anchors are
 * first because they were first, and the four chosen ones keep their
 * places relative to each other — so the list still runs roughly
 * most-common-first, which is what the home page numbers 01 to 06 and what
 * the ring walks. A site whose services were shuffled into hash order
 * would read as a list nobody arranged.
 *
 * SHORTER THAN count IS RETURNED UNTOUCHED, not padded and not refused.
 * generate.js is the one place that decides whether a short list is a
 * failed build, and it already does, with a message naming what survived.
 * Throwing here would move that decision somewhere it cannot explain
 * itself.
 */
function chooseServices(names, { key = '', count = SERVICE_COUNT, anchors = ANCHORS } = {}) {
  const list = (Array.isArray(names) ? names : [])
    .map(name => String(name == null ? '' : name))
    .filter(name => name.trim());

  /* NOTHING TO CHOOSE FROM IS NOT AN ERROR. A trade with exactly six
   * distinct services — which is most of the narrow ones — gets its six,
   * the same six every time, and that is the correct answer rather than a
   * degraded one. */
  if (list.length <= count) return list;

  const keep = Math.max(0, Math.min(anchors, count));
  const head = list.slice(0, keep);
  const rest = list.slice(keep);
  const need = count - keep;

  if (rest.length <= need) return head.concat(rest);

  /* SCORED, SORTED, THEN PUT BACK IN ORDER. The sort decides WHICH; the
   * second sort decides WHERE, and they are not the same question.
   *
   * THE INDEX IS THE TIE-BREAK. Two names that hash to the same uint32 is
   * vanishingly unlikely and would otherwise make the result depend on
   * Array.prototype.sort's stability, which is guaranteed in modern V8 and
   * is not a thing to rely on for a value that ends up in a URL. */
  const chosen = rest
    .map((name, i) => ({ name, i, score: scoreOf(key, name) }))
    .sort((a, b) => (a.score - b.score) || (a.i - b.i))
    .slice(0, need)
    .sort((a, b) => a.i - b.i)
    .map(row => row.name);

  return head.concat(chosen);
}

module.exports = { chooseServices, scoreOf, SERVICE_POOL, ANCHORS };
