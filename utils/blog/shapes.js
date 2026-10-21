// utils/blog/shapes.js
//
// HOW LONG a post is, and in how many sections.
//
// THE OTHER HALF OF THE SAMENESS PROBLEM, and the half a machine can see
// most cheaply. angles.js varies how a post is written; this varies what it
// measures. Until 21 October 2026 writePost.js said this to every post ever
// written, as a constant:
//
//     LENGTH
//       1000-1300 words, in 4-6 sections.
//
// So 171 articles on one domain shared a word count, a section count, an
// unheaded opening and a missing conclusion. A human blog that size has a
// 600-word answer and a 2,000-word walkthrough in it. Google's scaled
// content abuse policy names the pattern as repeated structure across many
// URLs, and there is no page-count threshold — the measurements are the
// thing, not the number of them.
//
// THE CHECKER READS THE SAME BAND, AND THAT IS THE WHOLE DESIGN
//
// qualityCheck.js fails a post under 850 words with the code `short`.
// `short` is in REWRITE_WORTHY, and blogGenerator retries a rewrite-worthy
// failure. So asking a slot for 700 words without moving the floor means:
// written at 700, failed as short, rewritten at 700, failed again, shipped
// red — two model calls for one post, on every short post in every campaign.
//
// The band is therefore STORED ON THE SLOT and read by the writer and the
// checker both, for the same reason moneyAnchor is stored rather than
// recomputed: two halves deriving the same value separately is how they come
// to disagree.
//
// WHY NOT LET THE MODEL CHOOSE ITS OWN LENGTH
//
// It was considered and it is worse. "Write as long as the topic needs"
// produces a tight distribution around whatever the model's habit is, which
// is a fingerprint arrived at by a longer route — and it leaves the checker
// with nothing to check against.

/**
 * The length bands, in rotation order.
 *
 * `floor` and `longAt` BELONG TO THE BAND, not to the checker. They were a
 * pair of constants in qualityCheck.js tuned to the single old band, and a
 * floor that does not move with the target is not a floor — the comment
 * above the old one said exactly that about the 550 it replaced.
 *
 * `id` is stored on BlogCampaign slots, so it must be stable: renaming one
 * orphans every post already planned under it. Add to the end freely.
 */
const SHAPES = [
  {
    id: 'standard',
    words: { min: 1000, max: 1300 },
    sections: { min: 4, max: 6 },
    floor: 850,
    longAt: 1800,
  },
  {
    id: 'short',
    /* A DIRECT ANSWER, not a thin version of a long post. Plenty of real
     * questions are exhausted in 800 words, and padding one to 1,200 is how
     * the filler phrases got into this codebase's forbidden list. */
    words: { min: 700, max: 950 },
    sections: { min: 3, max: 4 },
    floor: 600,
    longAt: 1300,
  },
  {
    id: 'long',
    words: { min: 1500, max: 1900 },
    sections: { min: 6, max: 8 },
    floor: 1300,
    longAt: 2400,
  },
];

/**
 * What an unshaped slot gets.
 *
 * EVERY CAMPAIGN PLANNED BEFORE 21 OCTOBER 2026 — 552 posts were scheduled
 * and unwritten on the day this shipped. Nothing backfills them, they will
 * be written by this build, and they must come out exactly as they would
 * have the day before: the old prompt line and the old checker constants,
 * to the word.
 *
 * It is `standard` by value rather than by reference to SHAPES[0], so
 * reordering or retuning that list cannot silently change what a four-month-
 * old campaign produces.
 */
const LEGACY = {
  id: '',
  words: { min: 1000, max: 1300 },
  sections: { min: 4, max: 6 },
  floor: 850,
  longAt: 1800,
};

/**
 * The band for a slot, by its position in the campaign.
 *
 * THE CYCLE LENGTH IS COPRIME WITH angles.js's ON PURPOSE. Seven angles and
 * three shapes give thirty-five distinct pairings before anything repeats.
 * Rotate both on seven and every "mistake" post is the same length as every
 * other "mistake" post for ever — which is not a fix, it is a slightly
 * larger fingerprint. test-blog-plan.js asserts the property rather than the
 * arithmetic.
 *
 * DETERMINISTIC, NOT RANDOM, like angleFor: a campaign can be replanned
 * after an edit, and a post already written must not disagree with the slot
 * it came from.
 */
function shapeFor(index) {
  const n = Number(index);
  const i = Number.isFinite(n) ? Math.abs(Math.trunc(n)) : 0;

  return SHAPES[i % SHAPES.length].id;
}

/**
 * The bounds a stored shape id means — for the prompt and for the checker,
 * from one place.
 *
 * AN UNKNOWN ID FALLS BACK TO LEGACY rather than throwing. A campaign
 * planned by a newer build, or a band retired from the list, must still
 * produce a post: the old numbers are a worse fit than the right band and
 * enormously better than a crash inside the write loop.
 */
function boundsFor(shapeId) {
  return SHAPES.find(s => s.id === shapeId) || LEGACY;
}

module.exports = { SHAPES, LEGACY, shapeFor, boundsFor };
