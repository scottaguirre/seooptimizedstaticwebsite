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
const { worthRewriting, REWRITE_WORTHY } = require('./utils/blog/qualityCheck');
const { checkTopicSet, withoutOuterArticles } = require('./utils/blog/qualityCheck');

let passed = 0;
let failed = 0;
const DECLARED = 31;

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

/* Comments stripped, because this project has four times written a check that
 * read prose as code — a test for a fix that passed on the comment explaining
 * the fix. Everything below that searches source searches THIS. */
const generatorCode = generator
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

test('THE WRITE LOOP ACTUALLY CONSULTS THE RULE', () => {
  /* THE MUTATION THAT SURVIVED EVERY OTHER TEST IN THIS FILE. Replacing
   * `!worthRewriting(quality)` with `false` in the loop's break condition
   * turns the retry off completely — the loop always breaks after one attempt
   * — and all eighteen other tests here still pass, because every one of them
   * asks what the rule ANSWERS and none asks whether anybody calls it.
   *
   * This file's own note on the exports says it: a condition can be written
   * correctly and reached never.
   *
   * Asserted against comment-stripped source, and the position matters as
   * much as the presence — moved above the `for`, the rule would be consulted
   * once on a verdict that does not exist yet. */
  const loop = generatorCode.indexOf('for (let attempt = 1');
  const call = generatorCode.indexOf('worthRewriting(');

  assert.ok(loop > -1, 'the retry loop is gone');
  assert.ok(call > -1, 'nothing calls worthRewriting — the retry rule is dead code');
  assert.ok(call > loop, 'worthRewriting is consulted outside the retry loop');

  // And it gates a break rather than being called and thrown away.
  const after = generatorCode.slice(call, call + 300);
  assert.match(after, /break;/, 'the rule is consulted but does not decide anything');
});

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

/* THESE FOUR USED TO BE ONE TEST THAT READ blogGenerator.js AS A STRING.
 *
 * It asserted that 'links-crowded' appeared somewhere in the file and that
 * 'guide-title' did not — a check that cannot tell a member of the set from a
 * word in a comment. Fourth time this project has written one of those. It
 * went green on the real gap this release fixes, because 'no-meta' was absent
 * from the file in exactly the way the test wanted every excluded code to be,
 * and nothing distinguished "deliberately excluded" from "never considered".
 *
 * And it was one edit away from going red for no reason: the comment above
 * REWRITE_WORTHY now names 'guide-title' as an example of an exclusion, which
 * the old negative assertion would have read as the code being in the set.
 *
 * worthRewriting() is exported now, so these call it. */

test('only faults a rewrite can fix are retried', () => {
  for (const code of ['links-crowded', 'short', 'money-link', 'next-link', 'prev-link']) {
    assert.ok(worthRewriting({ codes: [code] }), `${code} is not retried`);
  }
});

test('a fault the model would just repeat is NOT retried', () => {
  /* Asking the same model the same question again mostly buys another
   * identical answer. Retrying a "guide" title or filler phrasing spends a
   * second API call to be told the same thing. */
  for (const code of ['guide-title', 'howto-title', 'filler', 'vague']) {
    assert.ok(!worthRewriting({ codes: [code] }), `${code} should not trigger a rewrite`);
  }
});

test('A MISSING TITLE OR DESCRIPTION IS RETRIED', () => {
  /* The gap found on 4 October. Both fields are named in the JSON shape the
   * prompt demands, so a post arriving without one is the model dropping a
   * key — a different roll of the dice away from being right — and not the
   * model disagreeing about the answer.
   *
   * Left out, a post shipped with no <meta name="description"> on the live
   * site, which from 0.19.0 onwards is indistinguishable from the bug 0.19.0
   * exists to fix. */
  assert.ok(worthRewriting({ codes: ['no-meta'] }), 'no description is not retried');
  assert.ok(worthRewriting({ codes: ['no-title'] }), 'no title is not retried');
});

test('a clean post is not retried, and neither is a shapeless verdict', () => {
  assert.ok(!worthRewriting({ codes: [] }));
  assert.ok(!worthRewriting({}));
  assert.ok(!worthRewriting(null));
  assert.ok(!worthRewriting(undefined));
});

test('EVERY RETRIED CODE IS ONE checkPost CAN ACTUALLY EMIT', () => {
  /* THE TYPO THAT TURNS THE RETRY OFF IN SILENCE. 'no_meta' for 'no-meta', or
   * a code renamed in qualityCheck.js and not here, leaves a set member that
   * can never match. Nothing fails: the post simply ships unretried, which is
   * the state this release just finished fixing.
   *
   * Reads the VOCABULARY out of qualityCheck.js rather than asserting
   * behaviour from its text — every code it can raise is a fail('<code>' or a
   * warn-side literal, and the question here is only whether the two files
   * use the same spellings.
   *
   * TWO FILES SINCE 7 OCTOBER. The keyword rule raises its own codes inside
   * keywordCoverage.js, because that is where the rule is and a code invented
   * at the call site would be a second copy of a decision made there.
   * checkPost passes them through verbatim, so they are codes it can emit and
   * this scan has to look where they are written. It went red on the first
   * run after the wiring, which is the whole reason this test exists. */
  const quality = read('utils/blog/qualityCheck.js')
    + read('utils/blog/keywordCoverage.js');

  const emitted = new Set(
    [...quality.matchAll(/fail\(\s*'([a-z0-9-]+)'/g)].map(m => m[1])
  );

  assert.ok(emitted.size >= 12, `only found ${emitted.size} codes — the pattern stopped matching`);

  for (const code of REWRITE_WORTHY) {
    assert.ok(emitted.has(code), `'${code}' is retried but checkPost never raises it`);
  }
});

test('the retry decides by CODE, not by message text', () => {
  /* Matching on the wording of a failure ties the rule to a sentence somebody
   * will reasonably reword one day, silently turning the retry off.
   *
   * ASKED BY CALLING IT, NOT BY SEARCHING FOR THE EXPRESSION. This assertion
   * used to be `assert.match(generator, /quality\?\.codes \|\| \[\]/)` — it
   * pinned the rule to one spelling of one line, and it went red the moment
   * that line moved to another file without its behaviour changing at all.
   *
   * A verdict whose MESSAGES describe retried faults, carrying codes that are
   * not retried, must not be retried. Nothing about the wording can reach the
   * decision. */
  const wordyButNotWorthIt = {
    codes: ['guide-title', 'filler'],
    failures: [
      'three links crowded into one paragraph',
      'only 300 words — short',
      'the money-link was dropped',
      'no meta description',
      'no title',
    ],
  };
  assert.ok(!worthRewriting(wordyButNotWorthIt),
    'the retry read the failure text rather than the codes');

  /* And the converse: a retried code with no message text at all still
   * retries. A rule that needed the prose would answer false here. */
  assert.ok(worthRewriting({ codes: ['no-meta'], failures: [] }));
});

/* ------------------------------------------------------------------ *
 * The post's own keyword
 * ------------------------------------------------------------------
 * Edwin's rule, 6-7 October: the keyword INCLUDED in the title tag, the meta
 * description, the H1 and at least one H2, and in the body exactly once.
 *
 * The rule itself is proved in test-keyword-coverage.js. What is proved here
 * is only the WIRING — that checkPost runs it, on the right strings, for the
 * right posts, and that a failure reaches the retry. The rule was finished
 * and tested a day before anything called it, and a file nothing calls is a
 * file that cannot be wrong.
 * ------------------------------------------------------------------ */

console.log('\nThe post\'s own keyword\n');

const KW = 'slab leak detection';
const KW_SLOT = { ...SLOT, targetQuery: KW };

/** A post that satisfies the rule in all four places. */
function covered({ bodyKeyword = true } = {}) {
  const mention = bodyKeyword
    ? 'Slab leak detection starts with the water meter. '
    : 'The work starts with the water meter. ';

  return post({
    title: 'What Slab Leak Detection Actually Involves',
    sections: [
      { heading: null, paragraphs: [body(13) + mention + `Call ${MONEY} before opening concrete.`] },
      { heading: 'How Slab Leak Detection Is Priced', paragraphs: [body(13) + `This follows ${PREV}.`] },
      { heading: 'What comes next', paragraphs: [body(13) + `There is also ${NEXT}.`] },
      { heading: 'Before you call', paragraphs: [body(13)] },
    ],
  });
}

/** …and the matching description, since post() hard-codes a slab-floor one. */
function withMeta(p, metaDescription = 'How slab leak detection works, what it costs, and when it is worth doing.') {
  return { ...p, metaDescription };
}

test('A POST THAT COVERS THE KEYWORD PASSES', () => {
  const check = checkPost(withMeta(covered()), KW_SLOT);

  assert.strictEqual(check.ok, true, check.failures.join(' | '));
});

test('a post missing the keyword from its description is refused', () => {
  /* The exact fault on Edwin's live 6 October post: the title carried the
   * keyword by luck and the description did not, because nothing asked. */
  const check = checkPost(covered(), KW_SLOT);   // post()'s slab-floor meta

  assert.strictEqual(check.ok, false);
  assert.ok(check.codes.includes('keyword-meta'), check.codes.join(', '));
  assert.ok(check.failures.some(f => f.includes(`keyword "${KW}"`)),
    `the failure does not name the keyword: ${check.failures.join(' | ')}`);
});

test('ZERO BODY MENTIONS IS REFUSED — Edwin, 7 October', () => {
  const check = checkPost(withMeta(covered({ bodyKeyword: false })), KW_SLOT);

  assert.strictEqual(check.ok, false);
  assert.ok(check.codes.includes('keyword-body'), check.codes.join(', '));
  assert.ok(check.failures.some(f => /never appears in the body/.test(f)));
});

test('A HEADING MENTION IS NOT COUNTED AS THE BODY MENTION', () => {
  /* THE BUG THIS STOPS, and it would have failed every obedient post. The
   * rule REQUIRES the keyword in a subheading and allows it ONCE in the body.
   * qualityCheck's own textOf() joins headings and paragraphs into one string,
   * so handing that to the counter means the heading the rule demanded is
   * read as a body mention — and a post doing exactly as it was told comes
   * back "appears 2 times in the body, limit is 1".
   *
   * covered() has the keyword in its H1, in one H2 and once in the prose,
   * which is the compliant shape. Exactly one mention is the assertion. */
  const check = checkPost(withMeta(covered()), KW_SLOT);

  assert.strictEqual(check.ok, true, check.failures.join(' | '));
  assert.ok(!check.codes.includes('keyword-body'),
    'the subheading was counted as a body mention');
});

test('NO TARGET QUERY, NO KEYWORD CHECK', () => {
  /* buildPrompt omits the whole keyword block for a slot with no
   * targetQuery, so such a post was never told any of this. Refusing it
   * would punish it for a question nobody put to it — and would fail every
   * campaign planned before 0.31.0.
   *
   * wellSpread() carries none of the keyword and SLOT carries no query. */
  const check = checkPost(wellSpread(), SLOT);

  assert.ok(!check.codes.some(c => c.startsWith('keyword-')),
    `keyword codes raised with no targetQuery: ${check.codes.join(', ')}`);
});

test('a keyword failure is one the writer is retried for', () => {
  /* Edwin's words: "fails and gets rewritten." A failure code outside
   * REWRITE_WORTHY ships the post as-is with a red mark beside it. */
  const check = checkPost(withMeta(covered({ bodyKeyword: false })), KW_SLOT);

  assert.ok(worthRewriting(check), 'a keyword failure does not trigger a rewrite');
});

test('THE PROMPT ASKS FOR WHAT THIS CHECK MEASURES', () => {
  /* The failure this project has hit more than any other: a prompt whose rule
   * differs by a word from the check enforcing it. Both sides now read
   * contentWords() from keywordCoverage.js, and that shared call is the
   * assertion — not the wording around it, which will be reworded.
   *
   * The old sentence is asserted ABSENT. A presence-only check passes a
   * half-done replacement, which is how a rename has twice been left
   * part-finished in this codebase. */
  const writer = read('utils/blog/writePost.js');

  assert.ok(/require\('\.\/keywordCoverage'\)/.test(writer),
    'writePost no longer reads the rule from keywordCoverage');
  assert.ok(/contentWords\(slot\.targetQuery\)/.test(writer),
    'the prompt no longer names the words the checker measures');
  assert.ok(/EXACTLY ONCE/.test(writer),
    'the prompt does not state the body rule');
  assert.ok(!/repeat the phrase mechanically/.test(writer),
    'the old vague sentence is still in the prompt');
});

/* ------------------------------------------------------------------ *
 * The topic set, before anything is written
 * ------------------------------------------------------------------
 * checkTopicSet HAD NO TESTS AT ALL until 7 October, and it is the function
 * whose warnings appear at the top of the campaign form — the only quality
 * signal an owner reads before spending anything. The one below was found by
 * Edwin reading it on screen, which is the whole reason it has tests now.
 * ------------------------------------------------------------------ */

console.log('\nThe topic set\n');

/** Only the title-monotony warnings; the rest of checkTopicSet is not in scope. */
function templateWarnings(topics, targetPage) {
  const set = checkTopicSet(
    topics.map((t, i) => ({ topic: t, targetQuery: `q${i} distinct thing`, linkPhrase: 'a phrase' })),
    targetPage,
    { name: 'Hilltop Home Loans' }
  );

  return set.warnings.filter(w => /reads as a template/.test(w));
}

/* The twelve Edwin had on screen, verbatim. */
const BANKRUPTCY_TITLES = [
  'Bank balances that can weaken a business loan request after bankruptcy',
  'Recent late payments that weaken a business loan request after bankruptcy',
  'An IRS payment plan can change a business loan decision',
  'UCC liens can limit a new business loan',
  'Factoring contracts that complicate a new business loan request',
  'Origination fees that reduce the cash a business actually receives',
  'Refinancing business debt after a bankruptcy filing',
  'What happens while a business loan stays in underwriting',
  'A voided business check can delay a business loan deposit',
  'Debt service coverage can outweigh a past bankruptcy record',
  'Low personal credit scores can still affect business loan decisions',
  'Why a business loan application remains pending',
];

test('AN ARTICLE NO LONGER BREAKS THE SUBJECT EXEMPTION', () => {
  /* What Edwin read on screen, 7 October:
   *
   *     "a business" appears in 7 of 12 titles — it reads as a template
   *
   * against a target keyword of "business loan with bankruptcy record". The
   * phrase is the subject with "a" stuck to the front, and the exemption is a
   * raw substring match — so the keyword does not contain "a business" and the
   * check reported the subject as a template. "business loan" alone was exempt
   * the whole time, which is what makes it a bug rather than a judgement call.
   *
   * Reproduced against the old code before the fix: same sentence, same 7 of
   * 12. */
  const warnings = templateWarnings(BANKRUPTCY_TITLES,
    { keyword: 'business loan with bankruptcy record' });

  assert.deepStrictEqual(warnings, [],
    `the subject is still reported as a template: ${warnings.join(' | ')}`);
});

test('THE TOWN TEMPLATE IS STILL CAUGHT — the case this check was written for', () => {
  /* A model told the business is in Leander appends "in Leander" to every
   * headline. Each title looks fine alone; twelve in a row look generated.
   *
   * THIS IS WHY ONLY ARTICLES COME OFF. Stripping leading prepositions too was
   * the obvious generalisation — and "in leander" minus the "in" is "leander",
   * which a keyword of "water heater repair" also does not contain, so that
   * one would have gone quiet along with the real fix. The narrow rule is
   * narrow on purpose. */
  const titles = [
    'What a water heater actually costs in Leander',
    'How long a tank lasts in Leander',
    'Hard water and your heater in Leander',
    'When to replace rather than repair in Leander',
    'Why pressure drops in Leander',
    'The noise a failing heater makes in Leander',
  ];

  const warnings = templateWarnings(titles, { keyword: 'water heater repair' });

  assert.ok(warnings.some(w => /in leander/.test(w)),
    `the town template went unreported: ${warnings.join(' | ') || '(nothing)'}`);
});

test('a repeated phrase that is NOT the subject is still a template', () => {
  /* The exemption must not become a way through for everything. "can delay"
   * is nobody's subject. */
  const titles = [
    'Why an IRS plan can delay a decision',
    'How a lien can delay a decision',
    'When a factoring contract can delay a decision',
    'Where a voided check can delay a decision',
    'What a late payment can delay a decision',
    'Who else can delay a decision',
  ];

  const warnings = templateWarnings(titles, { keyword: 'business loan with bankruptcy record' });

  assert.ok(warnings.length, 'a genuine template went unreported');
});

test('withoutOuterArticles takes only the OUTER a / an / the', () => {
  assert.strictEqual(withoutOuterArticles('a business'), 'business');
  assert.strictEqual(withoutOuterArticles('the business loan'), 'business loan');
  assert.strictEqual(withoutOuterArticles('business loan a'), 'business loan');

  /* Inside the phrase they stay — "cost of a loan" is not "cost of loan", and
   * a phrase that is nothing but articles reduces to nothing rather than to
   * the empty string matching every keyword. */
  assert.strictEqual(withoutOuterArticles('cost of a loan'), 'cost of a loan');
  assert.strictEqual(withoutOuterArticles('in leander'), 'in leander');
  assert.strictEqual(withoutOuterArticles('the a an'), '');
});

test('AN EMPTY KEYWORD EXEMPTS NOTHING', () => {
  /* `''.includes('')` is true, so a phrase reducing to nothing would be read
   * as the subject of every campaign. The guard is the `!!bare` in isSubject.
   *
   * REMOVING THAT GUARD SURVIVES THIS SUITE, ON PURPOSE AND DOCUMENTED. Only
   * two- and three-word phrases are counted, so reaching it needs a repeated
   * n-gram made entirely of articles — "the a", "an a" — in half the titles of
   * one campaign. I could write that fixture; it would be a sentence no model
   * has ever produced, and it would be testing the implementation rather than
   * the behaviour. The guard stays because it costs one `&&` and because the
   * day a one-word phrase is counted it becomes reachable in silence.
   *
   * What IS asserted is the half that can happen: a campaign whose keyword
   * never arrived must not have every template waved through. */
  assert.strictEqual(withoutOuterArticles('a'), '');
  assert.strictEqual(withoutOuterArticles(''), '');

  const warnings = templateWarnings(BANKRUPTCY_TITLES, { keyword: '' });
  assert.ok(warnings.length, 'with no keyword at all, nothing should be exempt');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);

if (passed + failed !== DECLARED) {
  console.log(`  MISCOUNT: ${passed + failed} ran, ${DECLARED} declared`);
  process.exit(1);
}

process.exit(failed === 0 ? 0 : 1);
