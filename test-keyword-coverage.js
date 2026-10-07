// test-keyword-coverage.js
//
// Is a post's own keyword where it has to be?
//
// WHAT THIS IS GUARDING
//
// Edwin's rule, 6 October: a post's "Main keyword of this post" must be
// INCLUDED in the title tag, the meta description, the H1 and at least one H2,
// and may appear in the body once.
//
// Included, not verbatim. Demanding the exact phrase four times produces copy
// that reads like 2012, so the test is that every CONTENT word of the keyword
// appears in that element, in any order, in any inflection.
//
// THE RISK THIS FILE EXISTS FOR
//
// Two things will read this function: the prompt that ASKS the writer for the
// keyword, and the check that REFUSES a post without it. A loose definition
// passes posts that miss the keyword; a strict one rejects good writing, and a
// checker that rejects good writing gets switched off. Both failures are
// invisible from the outside, so the boundary is pinned down here with real
// sentences rather than argued about.
//
//   node test-keyword-coverage.js

const assert = require('assert');
const {
  keywordCoverage, includes, phraseCount, contentWords, forms,
} = require('./utils/blog/keywordCoverage');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}
function section(name) { console.log(`\n${name}\n`); }

/* ===================================================================== */

section('What counts as a content word');

test('filler words are dropped', () => {
  /* Nobody searches for "for". Demanding it would fail "Business Loans TO
   * Women" for using a different preposition, which is a rejection on grounds
   * of grammar rather than meaning. */
  assert.deepStrictEqual(contentWords('business loans for women'),
    ['business', 'loans', 'woman']);

  /* REPORTED AS THE OWNER TYPED IT, not as a stem. "loans" stays "loans" and
   * only irregulars are normalised, because this list is what a failure
   * message shows a person: "title is missing: loans" is readable and
   * "missing: loan" invites them to check a word they did not write.
   * Matching is unaffected — forms() handles the inflection on both sides. */
});

test('WITHOUT, NO AND NOT ARE NOT FILLER — they invert the meaning', () => {
  /* The one place a "small word" carries the most meaning in the phrase. Treat
   * "without" as glue and "loans with credit check" satisfies "loans WITHOUT
   * credit check", which is the opposite page. */
  assert.ok(contentWords('loans without credit check').includes('without'),
    '"without" was dropped — the opposite meaning would now pass');
  assert.ok(contentWords('no credit check loans').includes('no'));
  assert.ok(contentWords('why a claim is not paid').includes('not'));
});

test('an empty keyword has no content words', () => {
  assert.deepStrictEqual(contentWords(''), []);
  assert.deepStrictEqual(contentWords('   '), []);
  assert.deepStrictEqual(contentWords(null), []);
});

/* ===================================================================== */

section('Inflections — the part that broke on the first run');

test('PLURALS AND TENSES MATCH BOTH WAYS', () => {
  /* THE BUG THE SMOKE TEST CAUGHT. The first design reduced each word to one
   * stem: "notices" became "notic" while "notice" stayed "notice", so a
   * heading saying "notices" did not satisfy a keyword saying "notice" — the
   * exact inflection the rule promises to allow.
   *
   * English drops a silent e before -ing and -ed and keeps it before -s, so no
   * single truncation lands both on the same string. Each word expands to a
   * SET of forms now, and two words match when their sets intersect. */
  const pairs = [
    ['notices', 'notice'], ['changing', 'change'], ['approved', 'approve'],
    ['loans', 'loan'], ['boxes', 'box'], ['policies', 'policy'],
    ['rates', 'rate'], ['churches', 'church'],
  ];

  for (const [a, b] of pairs) {
    assert.ok([...forms(a)].some(f => forms(b).has(f)), `${a} did not match ${b}`);
    assert.ok([...forms(b)].some(f => forms(a).has(f)), `${b} did not match ${a}`);
  }
});

test('irregular plurals match', () => {
  /* "How a Woman-Owned Business Gets a Loan Approved" covers "business loans
   * for women" by any honest reading, and fails on woman/women alone. A
   * checker that rejects good writing gets switched off. */
  assert.ok(includes('business loans for women',
    'How a Woman-Owned Business Gets a Loan Approved').ok);
  assert.ok(includes('children savings account',
    'What a Child Savings Account Actually Earns').ok);
});

test('DIFFERENT WORDS MUST NOT COLLIDE', () => {
  /* The dangerous direction. A collision makes the check pass on a word the
   * writer never used, which is worse than a miss because nothing looks wrong.
   * The -s rule refuses a double s for exactly this: strip it blindly and
   * "address" becomes "addres", one step from "adders". */
  const apart = [
    ['business', 'busy'], ['address', 'adders'], ['loan', 'loin'], ['rate', 'rat'],

    /* THE PAIR THAT CAUGHT A SURVIVING MUTATION. Strip -es from every word
     * that ends in it, rather than only after a sibilant, and "rates" offers
     * "rat" — so a post about rates would satisfy a keyword about rats, and
     * more usefully, "notices" offers "notic" and stops matching "notice".
     *
     * -es is the whole plural marker after s, x, z, ch and sh (boxes,
     * churches, buses) and nowhere else. Everywhere else the e belongs to the
     * word and only the s is the plural. */
    ['rates', 'rat'], ['notices', 'notic'],
  ];

  /* NOT ASSERTED APART: "cases" and "cas".
   *
   * -ses is genuinely ambiguous — "buses" is bus + es and "cases" is case + s,
   * and nothing in the string says which. So both candidates are offered and
   * "cases" does reach "cas". That is the rule working, not failing: the
   * alternative is losing bus/buses to keep a non-word apart from a word.
   *
   * Written down because it looks like a collision and is not, and the next
   * person to run a mutation here will see it and reach for the same fix I
   * did. */

  for (const [a, b] of apart) {
    assert.ok(![...forms(a)].some(f => forms(b).has(f)), `${a} collided with ${b}`);
  }
});

test('hyphens are the same as spaces', () => {
  /* "rate-change notice" and "rate change notice" are the same three words to
   * a reader and to Google. The hyphen is a typographic choice by whoever
   * wrote the headline. */
  assert.ok(includes('mortgage rate change notice',
    'Your mortgage rate-change notice, explained').ok);
});

/* ===================================================================== */

section('Included, not verbatim');

test('ANY ORDER, ANY WORDING BETWEEN', () => {
  /* The whole point of "included". The words must be there; the sentence
   * around them is free. */
  const kw = 'mortgage interest rate change notice';

  assert.ok(includes(kw, 'How to Read a Mortgage Interest Rate Change Notice Without Guessing').ok);
  assert.ok(includes(kw, 'What Your Mortgage Interest Rate Change Notice Must Tell You').ok);
  assert.ok(includes(kw, 'Notice of a change to your mortgage interest rate: what it means').ok);
});

test('a missing word fails, and the failure names it', () => {
  /* Edwin's live meta description. It reads well and never says what the page
   * is about — the exact post this rule was written after. */
  const r = includes('mortgage interest rate change notice',
    'Find the new rate, effective date, payment change, and loan type on your notice before your next home loan repayment is due.');

  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.missing.sort(), ['interest', 'mortgage']);
});

test('AN EMPTY KEYWORD INCLUDES NOTHING, rather than everything', () => {
  /* `[].every(...)` is true, so the naive version passes every post on a
   * campaign whose keyword went missing — the state this rule exists to catch,
   * reported as a clean pass. */
  assert.strictEqual(includes('', 'any text at all').ok, false);
  assert.strictEqual(includes(null, 'any text at all').ok, false);
});

/* ===================================================================== */

section('Counting body mentions');

test('the keyword is counted however it is inflected or re-ordered', () => {
  /* A substring count would miss every natural mention and pass a post that
   * used the phrase five times in five slightly different shapes. */
  const kw = 'business loans for women';

  assert.strictEqual(phraseCount(kw, 'Business loans for women are assessed the same way.'), 1);
  assert.strictEqual(phraseCount(kw, 'A business loan for a woman is assessed the same way.'), 1);
  assert.strictEqual(phraseCount(kw, 'Nothing about lending here at all.'), 0);
});

test('TWO MENTIONS ARE COUNTED AS TWO', () => {
  const kw = 'business loans for women';
  const body = 'Business loans for women start here. '
    + 'Lenders look at revenue. '
    + 'The rules for business loans for women are no different.';

  assert.strictEqual(phraseCount(kw, body), 2);
});

/* ===================================================================== */

section('The whole rule, on one post');

const LIVE = {
  title: 'How to Read a Mortgage Interest Rate Change Notice Without Guessing',
  metaDescription: 'Find the new rate, effective date, payment change, and loan type on your notice before your next home loan repayment is due.',
  headings: ['You Can Apply as Soon as Your Documents Match', 'What the numbers mean'],
  body: 'A mortgage interest rate change notice should tell you four things clearly.',
};

test('EDWIN\'S LIVE POST FAILS, on the two places nothing was checking', () => {
  /* Published 6 October on hilltophomeloans.net, before any of this existed.
   * The title carries the keyword by luck — nothing asked for it. The meta
   * description and the headings do not. */
  const r = keywordCoverage('mortgage interest rate change notice', LIVE);

  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.detail.title, true, 'the title does carry it');
  assert.strictEqual(r.detail.metaDescription, false);
  assert.strictEqual(r.detail.heading, null);
  assert.strictEqual(r.detail.bodyMentions, 1);
});

test('a post that satisfies all four passes', () => {
  const r = keywordCoverage('mortgage interest rate change notice', {
    ...LIVE,
    metaDescription: 'What a mortgage interest rate change notice tells you, and which number to check first.',
    headings: ['What Your Mortgage Interest Rate Change Notice Must Say', 'When the payment moves'],
  });

  assert.strictEqual(r.ok, true, r.failures.join(' | '));
});

test('THE H1 AND THE TITLE TAG ARE ONE STRING TODAY, and are reported apart', () => {
  /* IE_Publisher writes the WordPress post_title from written.title and IE_SEO
   * writes the <title> tag from the same value, so one check covers both.
   *
   * Reported separately anyway: the day a title-tag template arrives — "… |
   * Hilltop Home Loans", or a 60-character trim — these stop being one value,
   * and a check that had quietly conflated them would keep passing while one
   * of the two silently stopped carrying the keyword. */
  const r = keywordCoverage('mortgage interest rate change notice', LIVE);

  assert.strictEqual(r.detail.h1, r.detail.title,
    'h1 and title have diverged — the title-tag source must have changed');
});

test('ONE BODY MENTION IS ALLOWED, TWO IS NOT', () => {
  /* Edwin's rule in his own words: "You can include the main keyword in the
   * body only once." */
  const twice = {
    ...LIVE,
    metaDescription: 'What a mortgage interest rate change notice tells you.',
    headings: ['What Your Mortgage Interest Rate Change Notice Must Say'],
    body: 'A mortgage interest rate change notice should tell you four things. '
      + 'Lenders vary. '
      + 'Read the mortgage interest rate change notice beside your statement.',
  };

  const r = keywordCoverage('mortgage interest rate change notice', twice);

  assert.strictEqual(r.ok, false);
  assert.ok(r.failures.some(f => /appears 2 times in the body/.test(f)),
    `expected a body-count failure, got: ${r.failures.join(' | ')}`);
});

test('every failure says which element and which words', () => {
  /* The message is what a person reads when a post is refused. "Keyword
   * coverage failed" sends them to the code; naming the element and the
   * missing words sends them to the sentence. */
  const r = keywordCoverage('mortgage interest rate change notice', LIVE);

  assert.ok(r.failures.some(f => /meta description is missing: /.test(f)));
  assert.ok(r.failures.some(f => /interest/.test(f) && /mortgage/.test(f)));
  assert.ok(r.failures.some(f => /no subheading contains the keyword/.test(f)));
});

/* ===================================================================== */

section('Exactly once, not at most once');

/* A post that is clean everywhere EXCEPT the body, so a body failure cannot
 * ride in on one of the other three. */
const COVERED = {
  title: 'How to Read a Mortgage Interest Rate Change Notice Without Guessing',
  metaDescription: 'What a mortgage interest rate change notice tells you, and which number to check first.',
  headings: ['What Your Mortgage Interest Rate Change Notice Must Say', 'When the payment moves'],
  body: 'A mortgage interest rate change notice should tell you four things clearly.',
};

test('ZERO BODY MENTIONS FAILS — Edwin, 7 October', () => {
  /* He was given both readings of "only once" and chose this one: "a post that
   * never mentions it in the body fails and gets rewritten."
   *
   * THE MUTATION THIS KILLS is the whole of the bodyMin branch. Before it, a
   * body that never said the phrase returned ok:true, because `0 > 1` is
   * false and nothing else asked. */
  const r = keywordCoverage('mortgage interest rate change notice', {
    ...COVERED,
    body: 'The letter should tell you four things clearly, and the first is the new figure.',
  });

  assert.strictEqual(r.detail.bodyMentions, 0);
  assert.strictEqual(r.ok, false, 'zero body mentions must fail');
  assert.ok(r.failures.some(f => /never appears in the body/.test(f)),
    `expected a zero-mention failure, got: ${r.failures.join(' | ')}`);
});

test('exactly one body mention passes', () => {
  const r = keywordCoverage('mortgage interest rate change notice', COVERED);

  assert.strictEqual(r.detail.bodyMentions, 1);
  assert.strictEqual(r.ok, true, r.failures.join(' | '));
});

test('TOO MANY AND TOO FEW SHARE ONE CODE', () => {
  /* Both are "the body says it the wrong number of times" and both are fixed
   * by the same retry. A caller splitting them would be retrying one half of
   * one instruction. */
  const none = keywordCoverage('mortgage interest rate change notice',
    { ...COVERED, body: 'The letter should tell you four things clearly.' });

  const twice = keywordCoverage('mortgage interest rate change notice', {
    ...COVERED,
    body: 'A mortgage interest rate change notice tells you four things. '
      + 'Lenders vary. '
      + 'Read the mortgage interest rate change notice beside your statement.',
  });

  assert.deepStrictEqual(none.codes, ['keyword-body']);
  assert.deepStrictEqual(twice.codes, ['keyword-body']);
});

test('EACH ELEMENT CARRIES ITS OWN CODE, in step with its message', () => {
  /* A code swapped with its neighbour is the mutation that survives
   * everything else here. test-post-quality reads the code names out of this
   * file's source and would still find both spellings present; the failure
   * messages would still be correct; only the pairing would be wrong, and
   * qualityCheck forwards the pair verbatim. Nothing downstream can tell.
   *
   * It matters because the pair is what a person acts on. A retry set that
   * one day holds 'keyword-meta' and not 'keyword-title' would be retrying
   * the wrong half of the rule, silently. */
  const r = keywordCoverage('mortgage interest rate change notice', {
    ...COVERED,
    title: 'Reading the Letter Your Lender Sent',
    metaDescription: 'What it says and which number to look at first.',
    headings: ['When the payment moves'],
    body: 'The letter should tell you four things clearly.',
  });

  const pairs = r.codes.map((code, i) => [code, r.failures[i]]);

  for (const [code, message] of pairs) {
    const element = { 'keyword-title': 'title', 'keyword-meta': 'meta description',
      'keyword-heading': 'subheading', 'keyword-body': 'body' }[code];

    assert.ok(element, `unknown code ${code}`);
    assert.ok(message.includes(element),
      `code ${code} is paired with the wrong message: "${message}"`);
  }

  assert.deepStrictEqual(r.codes.slice().sort(),
    ['keyword-body', 'keyword-heading', 'keyword-meta', 'keyword-title']);
});

test('a bodyMin of 0 restores "at most once"', () => {
  /* The reading Edwin did NOT choose is still reachable, because the day a
   * target page wants it the alternative is editing this rule in place and
   * changing it for every post. */
  const r = keywordCoverage('mortgage interest rate change notice',
    { ...COVERED, body: 'The letter should tell you four things clearly.' },
    { bodyMin: 0 });

  assert.strictEqual(r.ok, true, r.failures.join(' | '));
});

test('A BARE NUMBER THROWS, because it used to mean bodyMax', () => {
  /* Silently destructuring a number would reset bodyMin to 1 and ignore the
   * ceiling the caller asked for, with nothing on screen to say so. This
   * project has lost a day to PHP quietly dropping an extra argument; the
   * same trap in reverse is worth a throw. */
  assert.throws(
    () => keywordCoverage('mortgage interest rate change notice', COVERED, 2),
    /bodyMin, bodyMax/
  );
});

/* ===================================================================== */

section('Link text does not count as the body mention');

test('A MANDATORY ANCHOR CONTAINING THE KEYWORD IS NOT THE MENTION', () => {
  /* The hazard this removes: anchorPool builds the link phrases out of the
   * target page's own words, so a post can be handed a VERBATIM anchor that
   * contains its own keyword — and then told to use that keyword exactly
   * once. Credit the anchor and the only way to pass is to leave the keyword
   * out of the prose entirely, which is the opposite of the rule.
   *
   * Here the anchor carries it and the prose does not, so the post FAILS. */
  const r = keywordCoverage('mortgage interest rate change notice', {
    ...COVERED,
    body: 'The first figure is the one that moves your payment. '
      + 'Lenders send {{money}}a mortgage interest rate change notice{{/money}} by post.',
  });

  assert.strictEqual(r.detail.bodyMentions, 0,
    'anchor text was counted as a body mention');
  assert.strictEqual(r.ok, false);
});

test('TWO ANCHORS CARRYING THE KEYWORD DO NOT MAKE A POST UNPASSABLE', () => {
  /* The reason the stripping exists rather than the reason it is tidy. Two
   * mandatory phrases each containing the keyword, plus a ceiling of one,
   * is a failure no rewrite can fix — and qualityCheck retries on a failure.
   * One prose mention alongside both anchors must pass. */
  const r = keywordCoverage('mortgage interest rate change notice', {
    ...COVERED,
    body: 'A mortgage interest rate change notice should tell you four things. '
      + 'Lenders send {{prev}}your mortgage interest rate change notice{{/prev}} by post, '
      + 'and {{next}}reading a mortgage interest rate change notice{{/next}} is the next step.',
  });

  assert.strictEqual(r.detail.bodyMentions, 1);
  assert.strictEqual(r.ok, true, r.failures.join(' | '));
});

test('the wrapper name itself cannot satisfy a word of the keyword', () => {
  /* words() strips punctuation, so an unstripped `{{money}}` arrives as the
   * word "money". Harmless against today's keywords and a false match the day
   * somebody targets a keyword containing one of the wrapper names. */
  const r = keywordCoverage('money transfer fees', {
    title: 'Money Transfer Fees, Explained Line by Line',
    metaDescription: 'Where money transfer fees come from and which ones you can avoid.',
    headings: ['Which Money Transfer Fees Are Negotiable'],
    body: 'Ask about {{money}}the full schedule{{/money}} before you sign anything. '
      + 'Transfer fees are listed separately.',
  });

  assert.strictEqual(r.detail.bodyMentions, 0,
    'the {{money}} wrapper satisfied the word "money"');
});

/* =====================================================================
 * TWO MUTATIONS SURVIVE ON PURPOSE, and no test should be written for them.
 *
 * 1. REMOVING THE DOUBLE-S GUARD from the -s rule. Without it "business"
 *    also offers "busines" and "address" also offers "addres". Neither is a
 *    word, so neither can collide with anything a writer would type — the
 *    guard is defence against a class of bug rather than a live one. I looked
 *    for an English pair where it bites and did not find one; inventing a
 *    fixture to kill the mutation would be testing the implementation rather
 *    than the behaviour.
 *
 * 2. REMOVING EITHER ONE of the two irregular lookups. forms() adds the
 *    singular when given a plural AND the plural when given a singular, and
 *    matching is set intersection, so either direction alone is enough:
 *    "woman" offering {woman, women} meets "women" offering {women}.
 *    Removing BOTH is caught — that case is in the run above as 6b — which
 *    is the honest statement of what the pair is worth.
 *
 * Written down because a later mutation run will surface both again, and the
 * instinct is to patch the test rather than read why it survived. A survivor
 * that cannot change behaviour is not a gap in the suite.
 * ================================================================== */

/* ===================================================================== */

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
