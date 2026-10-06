// test-suggest-prompt.js
//
// The prompt that proposes blog topics.
//
// IT HAD NO TESTS AT ALL UNTIL 5 OCTOBER. buildPrompt and ANGLES were both
// exported and nothing imported them. Every rule in that file — the banned
// queries, the angle spread, the town limit — was a sentence nobody checked,
// in the one place that decides what a whole campaign will be about.
//
// THE BUG THIS EXISTS TO STOP COMING BACK
//
// Edwin ran a real campaign against a page targeting "small business loans
// for women". Twelve topics came back and NOT ONE MENTIONED WOMEN. The rule
// that did it:
//
//     b) No query may be "${targetPage.keyword}" or a close variant.
//
// "for women" is the part that makes that phrase distinct, so the closest
// variant of all is anything mentioning women — and the model removed the one
// word that made the page worth building a silo for.
//
// The rule itself is right: a post chasing the page's own search competes
// with the page it exists to promote. What was wrong was that it could not
// separate the SUBJECT that must not be duplicated from the AUDIENCE that may
// freely appear. It says so now, with examples on both sides.
//
// Run:  node test-suggest-prompt.js

const assert = require('assert');
const { buildPrompt, ANGLES } = require('./utils/blog/suggestTopics');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

const CTX = {
  business: { name: 'Hilltop', trade: 'lender', town: 'Leander', services: ['business loans'] },
  targetPage: {
    title: 'Small Business Loans for Women',
    keyword: 'small business loans for women',
    intent: 'apply for a loan through this lender',
  },
  count: 12,
};

const prompt = buildPrompt(CTX);

test('the page keyword is still banned as a target query', () => {
  /* The rule that stops a silo post competing with the page it feeds. The
   * change loosened what counts as "close"; it did not remove the rule. */
  assert.match(prompt, /No query may be "small business loans for women" itself/);
  assert.match(prompt, /same search reworded/);
});

test('THE AUDIENCE IN THE KEYWORD IS EXPLICITLY NOT BANNED', () => {
  /* The fix. Without this the model reads "or a close variant" and removes
   * the qualifier from every topic — which is exactly what it did. */
  assert.match(prompt, /AUDIENCE OR QUALIFIER IN THAT PHRASE IS NOT\s+BANNED/);
});

test('it shows both sides, not just the rule', () => {
  /* A rule with only forbidden examples teaches avoidance. The model needs to
   * see a permitted one to know the qualifier may appear at all. */
  assert.ok(/banned\s+"small business loans for women"/.test(prompt),
    'no banned example');
  assert.ok(/fine\s+"women owned business certification requirements"/.test(prompt),
    'no permitted example — the model is only shown what to avoid');
});

test('the qualifier is not made compulsory either', () => {
  /* Requiring it in all twelve would be the opposite failure: a dozen posts
   * all chasing the same audience phrase, competing with each other and with
   * the page. */
  assert.match(prompt, /Most topics will not need the qualifier at all/);
});

test('THE OLD WORDING IS GONE', () => {
  /* The exact phrase that caused it. Asserted as absent because a revert, or
   * a merge that reinstates the old sentence, is silent: the prompt still
   * reads sensibly and the topics quietly lose the qualifier again. */
  assert.ok(!/or a close variant/.test(prompt),
    '"or a close variant" is back — the qualifier will be stripped again');
});

test('the campaign-level facts still reach the prompt', () => {
  /* Guarding the rest of the file while editing one rule in it.
   *
   * THE KEYWORD IS ASSERTED IN ITS OWN SENTENCE, not just somewhere in the
   * prompt. Found by mutation: deleting it from "the page the business wants
   * to rank for X" left the suite green, because the banned-query rule quotes
   * the same words a few lines below. A keyword that reaches the model only
   * as a prohibition tells it what to avoid and never what to support. */
  assert.match(prompt, /wants to rank for "small business loans for women"/);
  assert.match(prompt, /Small Business Loans for Women/);
  assert.match(prompt, /apply for a loan through this lender/);
  assert.match(prompt, /Propose 12 blog topics/);
});

test('every angle reaches the prompt', () => {
  assert.ok(ANGLES.length >= 4, `only ${ANGLES.length} angles defined`);
  for (const angle of ANGLES) {
    assert.ok(prompt.includes(angle.name), `the "${angle.name}" angle is missing`);
  }
});

test("A SITE WITH A TOWN STILL GETS THE LOCAL ANGLE", () => {
  /* WAS A RECORD OF AN UNFIXED PROBLEM — fixed 5 October, and now a guard in
   * the opposite direction.
   *
   * One angle is "Something true of this town specifically", and its example
   * names Central Texas. The prompt also asks for topics spread across most
   * of the angles on offer, so a location topic is close to compulsory.
   *
   * On a plumber with a van that is the single best angle in the list. On
   * Edwin's lending blog it produced "Central Texas Heat Can Turn Utility
   * Bills Into a Cash-Flow Gap" — a post whose reader wants a cheaper
   * electricity bill, not a loan. The town came from a deleted theme's
   * leftover settings row that the site had no other connection to.
   *
   * The angle is now dropped when a site has no town. test-site-kind.js
   * asserts that from the blog side; THIS asserts the side that is easier to
   * break and harder to notice — CTX is a lender WITH a town, and removing
   * the angle from everyone would read as a success over there while
   * quietly costing every real local business its best angle. */
  const local = ANGLES.find(a => /town specifically/i.test(a.name));

  assert.ok(local, 'the local angle is gone — if deliberate, delete this test and the note in CLAUDE.md');
  assert.ok(local.localOnly,
    'the angle is no longer flagged localOnly, so sites with no town will be offered it again');
  assert.match(local.example, /Central Texas/);

  assert.match(prompt, /town specifically/, 'a site WITH a town lost the local angle');
  assert.match(prompt, /spread the 12 topics across at least 4 of them/);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
