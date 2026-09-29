/**
 * test-post-quality.js
 *
 * How long a post is, and where its three links land.
 *
 * THE BUG THIS EXISTS TO STOP COMING BACK
 *
 * The writing prompt told the model each link phrase must appear "EXACTLY
 * ONCE, verbatim" and said NOTHING about where. So all three routinely landed
 * in the same paragraph — not the model misbehaving, because nobody had asked
 * for anything else. Three links stacked in one paragraph is the loudest
 * "this was written by a machine" signal on the page. A reader does not count
 * links; they feel the clump.
 *
 * Reported from a real session: "I'm trying to avoid smashing 3 links in a
 * single paragraph."
 *
 * AND THE CHECK IS THE POINT, NOT THE INSTRUCTION
 *
 * An instruction with no check behind it is a hope. This codebase has now
 * been bitten three times by exactly that shape — a "this post went live"
 * message with no retry, a deletion with no reconciliation, and a docblock
 * describing a siteUrl comparison that did not exist. So the prompt asks, and
 * checkPost() verifies, and blogGenerator retries when the answer is wrong.
 *
 * WHY A RETRY IS AFFORDABLE
 *
 * The verdict used to be computed AFTER the retry loop — which is after the
 * point of no return, so the comment there was right to say a failing post
 * ships rather than "charging twice". Moved inside the loop it runs before
 * markSlotReady() and chargeCredits(), so a second attempt costs one API call
 * and the customer nothing.
 *
 * Run:  node test-post-quality.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { checkPost, linkSpread } = require('./utils/blog/qualityCheck');

let passed = 0;
let failed = 0;
const DECLARED = 14;

function test(name, fn) {
  try {
    fn();
    console.log(`  ok    ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}\n        ${err.message}`);
    failed++;
  }
}

const read = p => fs.readFileSync(path.join(__dirname, p), 'utf8');

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const SLOT = {
  money: { anchor: 'quality plumbing leander' },
  prevAnchor: 'an earlier check',
  nextAnchor: 'a passing aside',
};

const MONEY = `{{money}}${SLOT.money.anchor}{{/money}}`;
const PREV = `{{prev}}${SLOT.prevAnchor}{{/prev}}`;
const NEXT = `{{next}}${SLOT.nextAnchor}{{/next}}`;

/** Filler prose with enough concrete detail to clear the vagueness check. */
function body(n, extra = '') {
  const sentence = 'A 40-gallon tank at 140 degrees loses about 3 psi an hour '
    + 'and a 10-year-old anode rod costs $30 to replace. ';
  return sentence.repeat(n) + extra;
}

function post({ sections, title = 'A Warm Floor Spot Is Worth Finding' } = {}) {
  return {
    title,
    metaDescription: 'What a warm patch on a slab floor usually means, and what to check first.',
    sections,
  };
}

/** Three links spread as the prompt asks: opening, middle, final. */
function wellSpread() {
  return post({
    sections: [
      { heading: null, paragraphs: [body(13) + `Call ${MONEY} before opening concrete.`] },
      { heading: 'What it costs', paragraphs: [body(13) + `This follows ${PREV}.`] },
      { heading: 'What comes next', paragraphs: [body(13) + `There is also ${NEXT}.`] },
      { heading: 'Before you call', paragraphs: [body(13)] },
    ],
  });
}

console.log('\nPost length and link placement\n');

/* ------------------------------------------------------------------ *
 * Placement
 * ------------------------------------------------------------------ */

test('THREE LINKS IN ONE PARAGRAPH IS A FAILURE', () => {
  const crowded = post({
    sections: [
      { heading: null, paragraphs: [body(8) + `Call ${MONEY}, see ${PREV}, and note ${NEXT}.`] },
      { heading: 'More', paragraphs: [body(8)] },
      { heading: 'Even more', paragraphs: [body(8)] },
      { heading: 'Last', paragraphs: [body(8)] },
    ],
  });

  const check = checkPost(crowded, SLOT);

  assert.ok(check.codes.includes('links-crowded'),
    `expected links-crowded, got ${JSON.stringify(check.codes)}`);
  assert.strictEqual(check.spread.sameParagraph, 3);
  assert.strictEqual(check.ok, false);
});

test('two links in one paragraph is also a failure', () => {
  // Two is already a clump. The rule is one per paragraph, not "fewer than
  // three".
  const crowded = post({
    sections: [
      { heading: null, paragraphs: [body(8) + `Call ${MONEY} and see ${PREV}.`] },
      { heading: 'More', paragraphs: [body(8)] },
      { heading: 'Last', paragraphs: [body(8) + `There is ${NEXT}.`] },
      { heading: 'End', paragraphs: [body(8)] },
    ],
  });

  const check = checkPost(crowded, SLOT);

  assert.ok(check.codes.includes('links-crowded'));
  assert.strictEqual(check.spread.sameParagraph, 2);
});

test('LINKS SPREAD ACROSS SECTIONS PASS', () => {
  const check = checkPost(wellSpread(), SLOT);

  assert.ok(!check.codes.includes('links-crowded'),
    `a well-spread post was marked crowded: ${JSON.stringify(check.failures)}`);
  assert.strictEqual(check.spread.sameParagraph, 0);
});

test('two paragraphs in the SAME section is a warning, not a failure', () => {
  /* The instruction is one per section, but a reader notices a clump inside a
   * paragraph and does not notice two links a few paragraphs apart under one
   * subheading. Failing it would spend an API call on something nobody sees. */
  const sameSection = post({
    sections: [
      { heading: null, paragraphs: [body(6) + `Call ${MONEY}.`] },
      {
        heading: 'Detail',
        paragraphs: [body(6) + `This follows ${PREV}.`, body(6) + `There is ${NEXT}.`],
      },
      { heading: 'Last', paragraphs: [body(6)] },
    ],
  });

  const check = checkPost(sameSection, SLOT);

  assert.strictEqual(check.spread.sameParagraph, 0);
  assert.strictEqual(check.spread.sameSection, 2);
  assert.ok(!check.codes.includes('links-crowded'), 'a shared section was treated as crowding');
  assert.ok(check.warnings.some(w => /share one section/.test(w)), 'nothing was said about it');
});

test('linkSpread records where each phrase landed', () => {
  const spread = linkSpread(wellSpread(), SLOT);

  assert.strictEqual(spread.placed.money.section, 0);
  assert.strictEqual(spread.placed.prev.section, 1);
  assert.strictEqual(spread.placed.next.section, 2);
  assert.strictEqual(spread.found, 3);
});

test('a money link outside the opening section is flagged', () => {
  const late = post({
    sections: [
      { heading: null, paragraphs: [body(6)] },
      { heading: 'Detail', paragraphs: [body(6) + `Call ${MONEY}.`] },
      { heading: 'Then', paragraphs: [body(6) + `This follows ${PREV}.`] },
      { heading: 'Last', paragraphs: [body(6) + `There is ${NEXT}.`] },
    ],
  });

  const check = checkPost(late, SLOT);

  assert.ok(check.warnings.some(w => /money-page link is not in the opening/.test(w)));
});

test('a post with no prev or next link is not called crowded', () => {
  // The first post in a ring has no previous. One link cannot clump.
  const first = post({
    sections: [
      { heading: null, paragraphs: [body(8) + `Call ${MONEY}.`] },
      { heading: 'More', paragraphs: [body(8)] },
      { heading: 'Last', paragraphs: [body(8)] },
    ],
  });

  const check = checkPost(first, { money: SLOT.money });

  assert.strictEqual(check.spread.sameParagraph, 0);
  assert.ok(!check.codes.includes('links-crowded'));
});

/* ------------------------------------------------------------------ *
 * Length
 * ------------------------------------------------------------------ */

test('THE FLOOR MOVED WITH THE PROMPT', () => {
  /* The prompt asks for 1000-1300 words. A floor of 550 against that is not a
   * floor, it is a formality: a post could come back at half the length asked
   * for and pass clean. */
  /* DELIBERATELY BETWEEN THE OLD FLOOR AND THE NEW ONE. A fixture under 550
   * words fails either way, so it cannot tell whether the floor moved — the
   * first version of this test did exactly that and passed with the old value
   * restored. */
  const short = post({
    sections: [
      { heading: null, paragraphs: [body(10) + `Call ${MONEY}.`] },
      { heading: 'More', paragraphs: [body(10) + `This follows ${PREV}.`] },
      { heading: 'Last', paragraphs: [body(10) + `There is ${NEXT}.`] },
    ],
  });

  const check = checkPost(short, SLOT);

  assert.ok(check.stats.words > 550,
    `fixture is ${check.stats.words} words — under the OLD floor too, so this proves nothing`);
  assert.ok(check.stats.words < 850,
    `fixture is ${check.stats.words} words — not short enough to test`);
  assert.ok(check.codes.includes('short'), `expected 'short', got ${JSON.stringify(check.codes)}`);
});

test('a post at the length asked for passes', () => {
  const check = checkPost(wellSpread(), SLOT);

  assert.ok(check.stats.words >= 850, `fixture is only ${check.stats.words} words`);
  assert.ok(!check.codes.includes('short'));
});

test('the prompt asks for the length the check enforces', () => {
  /* A prompt and a checker disagreeing about the target is how a post ends up
   * failing a rule nobody asked it to follow. */
  const prompt = read('utils/blog/writePost.js');

  assert.match(prompt, /1000-1300 words/, 'the prompt no longer asks for 1000-1300 words');
  assert.match(prompt, /4-6 sections/);
});

/* ------------------------------------------------------------------ *
 * The instruction that goes with the check
 * ------------------------------------------------------------------ */

test('THE PROMPT SAYS WHERE EACH LINK GOES', () => {
  /* Checking placement without asking for it would fail every post and
   * rewrite every one of them at twice the cost. */
  const prompt = read('utils/blog/writePost.js');

  assert.match(prompt, /PUT IT IN THE OPENING SECTION/);
  assert.match(prompt, /PUT IT IN A MIDDLE SECTION/);
  assert.match(prompt, /PUT IT IN THE FINAL SECTION/);
  assert.match(prompt, /NO TWO OF THOSE PHRASES MAY SHARE A PARAGRAPH/);
});

/* ------------------------------------------------------------------ *
 * The retry, and what it costs
 * ------------------------------------------------------------------ */

const generator = read('utils/blogGenerator.js');

test('THE VERDICT IS COMPUTED BEFORE THE CHARGE', () => {
  /* The whole reason a rewrite is affordable. If checkPost ever moves back
   * below markSlotReady/chargeCredits, a retry means charging twice and the
   * feature has to be turned off. */
  const check = generator.indexOf('quality = checkPost(candidate, planSlot)');
  const ready = generator.indexOf('markSlotReady(campaignId, index');
  const charge = generator.indexOf('chargeCredits(user, afford.cost)');

  assert.ok(check > -1, 'the quality check is no longer inside the write loop');
  assert.ok(check < ready, 'the post is marked ready before it is checked');
  assert.ok(check < charge, 'the customer is charged before the post is checked');
});

test('only faults a rewrite can fix are retried', () => {
  /* Asking the same model the same question again mostly buys another
   * identical answer. Retrying a "guide" title or filler phrasing spends a
   * second API call to be told the same thing. */
  assert.match(generator, /REWRITE_WORTHY/);

  for (const code of ['links-crowded', 'short', 'money-link']) {
    assert.ok(generator.includes(`'${code}'`), `${code} is not retried`);
  }

  for (const code of ['guide-title', 'howto-title', 'filler', 'vague']) {
    assert.ok(!generator.includes(`'${code}'`), `${code} should not trigger a rewrite`);
  }
});

test('the retry decides by CODE, not by message text', () => {
  /* Matching on the wording of a failure ties the rule to a sentence somebody
   * will reasonably reword one day, silently turning the retry off. */
  assert.match(generator, /quality\?\.codes \|\| \[\]/);
  assert.ok(!/failures.*includes\(['"]links/.test(generator),
    'the retry matches on failure text rather than a code');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);

if (passed + failed !== DECLARED) {
  console.log(`  MISCOUNT: ${passed + failed} ran, ${DECLARED} declared`);
  process.exit(1);
}

process.exit(failed === 0 ? 0 : 1);
