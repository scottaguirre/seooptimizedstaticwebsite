// utils/blog/angles.js
//
// HOW a post is written, as distinct from what it is about.
//
// THE PROBLEM THIS EXISTS FOR
//
// Every post on every blog comes out of one brief in writePost.js:
// 1000-1300 words, 4-6 sections, open on an unheaded section, no conclusion,
// paragraphs of two to four sentences, and a list of twenty-five forbidden
// phrases. Each of those instructions is good — they are why the posts are
// publishable — but run across 171 articles on one domain they stop being
// style and start being a fingerprint.
//
// Google's scaled content abuse policy names the pattern almost exactly:
// repeated structure across many URLs. There is no page-count threshold; the
// test is whether the pages look manufactured. A human blog of 171 posts has
// a 400-word post and a 3,000-word one, a list, a walkthrough and a rant.
// Ours had 171 posts built to one spec.
//
// WHY AN ANGLE IS ASSIGNED HERE RATHER THAN READ OFF THE TOPIC
//
// suggestTopics.js has asked the model for an `angle` since it was written —
// symptom, decision, process, expectation, cost, local, mistake — and it is
// in the prompt, the schema and the worked examples.
//
// IT REACHED NOTHING. Traced end to end on 21 October: the Cloudflare screen
// flattens a suggestion to "topic | keyword" and writes it into a textarea,
// and the plugin's topics table carries the same three columns. The angle
// died at the UI on both products, before planning, every time. And most
// topics never passed the suggester at all — they were typed or uploaded by
// CSV, and those never had an angle to lose.
//
// Carrying it through would have meant a fourth column in two UIs, a plugin
// release, and a value that drifts from its topic the moment somebody edits
// the line. It would also have done nothing for the blogs that already
// exist. Assigning by slot index covers typed, CSV and suggested topics
// identically, and covers WordPress and Cloudflare in one change because
// both go through planCampaign().
//
// THE PRECEDENT IS IN THIS CODEBASE ALREADY. createLocationPagesPrompt.js
// rotates six angles and four heading styles by location index, under a
// comment reading "Vary the heading style too, so every page's H1 isn't the
// same formula." Location pages solved this; the blog writer never got it.
//
// TREATMENTS, NOT SUBJECTS — the one way this differs from the location
// pages. Their angles are about content ("emergency response times") and that
// works because every town page covers the same service. Blog topics are
// heterogeneous: a rotated "cost" angle lands on a topic with nothing to do
// with cost, and the model either ignores it or writes something false.
//
// So these describe SHAPE — where a post starts and how it is organised —
// which fits almost any topic. And each one is offered rather than imposed:
// buildPrompt tells the model to take the nearest fitting treatment if this
// one genuinely does not suit the topic. An instruction a writer cannot
// follow honestly is worse than no instruction.

/**
 * The treatments, in rotation order.
 *
 * ORDERED SO NEIGHBOURS DIFFER AS MUCH AS POSSIBLE, because consecutive
 * slots are consecutive posts on the blog and on the front page. Two
 * walkthroughs in a row is the sameness this is here to break, in miniature.
 *
 * `id` is stored on the slot and must be stable: it is written into
 * BlogCampaign documents, and renaming one orphans every post already
 * planned under it. Add to the end of this list freely; do not rename.
 */
const TREATMENTS = [
  {
    id: 'symptom',
    brief:
      'Open on what the reader has actually noticed — the sound, the smell, '
      + 'the mark on the ceiling, the number on the bill. Name it in the '
      + 'first sentence, before any explanation. Work outwards from the thing '
      + 'in front of them to the cause.',
  },
  {
    id: 'decision',
    brief:
      'Open on the choice the reader is stuck between, stated as two real '
      + 'options rather than a question. Spend the post on what actually '
      + 'separates them, and say plainly which way the answer usually goes '
      + 'and what would change it.',
  },
  {
    id: 'walkthrough',
    brief:
      'Take it in order, start to finish — what happens first, what happens '
      + 'next, how long each part takes. Use the order of events as the '
      + "post's structure rather than grouping by theme.",
  },
  {
    id: 'mistake',
    brief:
      'Open on the thing people get wrong, and be specific about who gets it '
      + 'wrong and why it is an easy mistake to make. Correct it early rather '
      + 'than saving it, then spend the rest of the post on what to do '
      + 'instead.',
  },
  {
    id: 'question',
    brief:
      'Answer it the way you would answer it out loud, asked across a '
      + 'kitchen table. Give the short answer in the first two sentences, '
      + 'then earn it. Expect the follow-up questions and take them in the '
      + 'order a person would actually ask them.',
  },
  {
    id: 'comparison',
    brief:
      'Set two approaches, materials or methods side by side. Be concrete '
      + 'about where each one wins, and name the conditions that decide it. '
      + 'Do not end even-handed if one of them is usually right.',
  },
  {
    id: 'cost',
    brief:
      'Lead with what it comes down to in money or time, and be specific '
      + 'about what moves the number. Ranges only, and only ranges you were '
      + 'given. If you were given none, write about what DRIVES the cost '
      + 'rather than inventing a figure.',
  },
];

/**
 * The treatment for a slot, by its position in the campaign.
 *
 * DETERMINISTIC, NOT RANDOM, and that is load-bearing. A campaign can be
 * replanned after an edit; random assignment would hand every post a
 * different treatment on each replan, and a post already written would
 * disagree with the slot it came from. Same reasoning as moneyAnchor being
 * stored rather than recomputed.
 *
 * @param {number} index  the slot's index within its campaign
 * @returns {object} the treatment
 */
function treatmentFor(index) {
  const n = Number(index);
  const i = Number.isFinite(n) ? Math.abs(Math.trunc(n)) : 0;

  return TREATMENTS[i % TREATMENTS.length];
}

/** Just the id, which is what a slot stores. */
function angleFor(index) {
  return treatmentFor(index).id;
}

/**
 * The brief for a stored angle id, or null.
 *
 * NULL RATHER THAN A DEFAULT for an id nothing recognises. A campaign
 * planned before this existed has no angle at all, and a post written from
 * some other campaign's treatment is worse than one written from the plain
 * brief — which is exactly what an unknown id should fall back to.
 */
function briefFor(angleId) {
  const found = TREATMENTS.find(t => t.id === angleId);
  return found ? found.brief : null;
}

module.exports = { TREATMENTS, treatmentFor, angleFor, briefFor };
