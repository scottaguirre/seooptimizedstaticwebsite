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

/* ---------------------------------------------------------------------
 * The intent fallbacks, which had never run — 6 October
 *
 * Both prompts fall back to a sentence when no intent is given, and
 * suggestTopics.js splits that fallback by site kind: a trade is told the
 * reader should "use the business's X service", a blog "understand X well
 * enough to decide what to do next".
 *
 * NEITHER BRANCH HAD EVER EXECUTED. The plugin's intent dropdown is a
 * <select>, a <select> always submits something, and its first option carried
 * the sentence "get in touch about this service" — so targetPage.intent was
 * never empty and the `||` could not reach its right-hand side.
 *
 * Every campaign on a content blog was therefore told its readers must end up
 * wanting to get in touch about a service that does not exist. The prompt
 * calls that line "the hard constraint" and rejects topics against it.
 *
 * Plugin 0.33.0 made the first option empty. These cases are what makes that
 * mean something.
 * ------------------------------------------------------------------ */

const { buildPrompt: enrichPrompt } = require('./utils/blog/enrichTopic');
const { buildContext } = require('./utils/blog/context');

/* BUILT THROUGH buildContext, not hand-written.
 *
 * My first attempt passed a bare { name } and enrichTopic died on
 * `business.services.join(', ')`. That was the FIXTURE being wrong, not the
 * code — context.js guarantees services is always an array, and says so in a
 * comment naming this exact crash. A hand-made fixture that cannot occur in
 * production proves nothing about production, which is the lesson
 * seed_campaign() taught in test-ie-pause.js the same week. */
/* THE TITLE AND THE KEYWORD MUST NOT BE THE SAME WORDS — changed 7 October.
 *
 * This fixture read `title: 'Fixed vs Variable Loan Terms'` beside
 * `keyword: 'fixed vs variable loan terms'` — identical but for capitals. So
 * every assertion below passed whichever of the two the fallback had actually
 * read, and the suite could not have told you which. A fixture whose two
 * fields carry one value cannot test which field is used.
 *
 * These are Edwin's real pillar and its real keyword. They share only the
 * words "business loan". */
const PAGE = {
  title: 'How to Qualify for a Business Loan After Bankruptcy',
  keyword: 'business loan with bankruptcy record',
  url: 'https://x/',
};

function ctxFor(business, intent = '', page = PAGE) {
  return buildContext(business, { ...page, intent });
}

const BLOG = { name: 'Hilltop Home Loans' };
const TRADE = { name: 'Hill Country Plumbing', type: 'plumber', location: 'Leander, TX' };

test('A BLOG WITH NO INTENT IS NOT TOLD TO SELL A SERVICE', () => {
  /* THE BUG, as it reached Edwin. "use the business's X service" on a lending
   * blog with no service and no phone number. */
  const prompt = buildPrompt({ ...ctxFor(BLOG), count: 5 });

  assert.match(prompt, /understand business loan with bankruptcy record well enough to decide what to do next/,
    'the blog fallback still does not fire');
  assert.doesNotMatch(prompt, /use the business's/,
    'a blog is still told its readers must use a service');
});

test('THE FALLBACK IS BUILT FROM THE KEYWORD, NOT THE HEADLINE', () => {
  /* Edwin, 7 October. It used to read targetPage.title, so the hard
   * constraint came out as "understand How to Qualify for a Business Loan
   * After Bankruptcy well enough to…" — fourteen words of headline doing the
   * work of one instruction.
   *
   * The keyword is the same page in a searcher's words, and it is the field
   * the owner cannot leave vague. Asserting the headline ABSENT is the half
   * that matters: a check that only looked for the keyword would pass while
   * the title was still being pasted in beside it. */
  const prompt = buildPrompt({ ...ctxFor(BLOG), count: 5 });
  const constraint = prompt.split('THE READER MUST END UP WANTING THIS')[1].slice(0, 200);

  assert.match(constraint, /business loan with bankruptcy record/,
    'the keyword is not in the constraint');
  assert.doesNotMatch(constraint, /How to Qualify for a Business Loan After Bankruptcy/,
    'the constraint is still built from the page headline');
});

test('a trade with no intent still gets the service sentence', () => {
  /* The other branch, which must not be lost to the fix for the first. */
  const prompt = buildPrompt({ ...ctxFor(TRADE), count: 5 });

  assert.match(prompt, /use the business's business loan with bankruptcy record service/,
    'the trade fallback was traded away for the blog one');
});

test('NO KEYWORD FALLS BACK TO THE TITLE, for a page stored before the box existed', () => {
  /* Weaker steering beats none. Every target page planned since 0.31.0 carries
   * a keyword; the ones planned before it do not, and they must not produce
   * "understand  well enough to decide…" with a hole where the subject
   * goes. */
  const older = { title: 'How to Qualify for a Business Loan After Bankruptcy', url: 'https://x/' };
  const prompt = buildPrompt({ ...ctxFor(BLOG, '', older), count: 5 });

  assert.match(prompt, /understand How to Qualify for a Business Loan After Bankruptcy well enough to decide/,
    'a page with no keyword lost its subject entirely');
});

test('AN EXPLICIT isLocal OVERRIDES THE BUSINESS, in both directions', () => {
  /* FOUND BY A SURVIVING MUTATION, not by reading. Dropping the override from
   * readerIntent and always re-deriving from the business passed every test
   * above, because not one of them passed an isLocal that DISAGREED with the
   * business it sat beside. A parameter whose whole purpose is to disagree
   * cannot be tested by callers who agree with it.
   *
   * It is checked by TYPE, not for truthiness: a caller that omits it must
   * fall through to the business, and `undefined` read as `false` would put
   * every plumber on the blog sentence. Both directions are asserted, because
   * a one-way test passes on a function that ignores the value and answers
   * the same thing twice. */
  const blogAsLocal = buildPrompt({ ...ctxFor(BLOG), count: 5, isLocal: true });
  const tradeAsBlog = buildPrompt({ ...ctxFor(TRADE), count: 5, isLocal: false });

  assert.match(blogAsLocal, /use the business's business loan with bankruptcy record service/,
    'isLocal: true was ignored on a site with no trade');
  assert.match(tradeAsBlog, /understand business loan with bankruptcy record well enough to decide what to do next/,
    'isLocal: false was ignored on a site with a trade');
});

test('A TYPED INTENT STILL WINS OVER BOTH', () => {
  /* The owner's own words are the whole point of the free-text box. A fallback
   * that overrode them would be worse than the dead one it replaces.
   *
   * THE ABSENCE ASSERTION NAMES THE CURRENT SENTENCE, and that is not a
   * detail. It used to read /read more about/ — the wording the blog fallback
   * had on 6 October. Changing that sentence on 7 October left this line
   * looking for a string nothing emits any more, so it would have passed
   * while the fallback fired straight over a typed intent. An absence
   * assertion decays the moment the thing it names is renamed, silently, in
   * the direction of passing. */
  const prompt = buildPrompt({ ...ctxFor(BLOG, 'book a call with an adviser'), count: 5 });

  assert.match(prompt, /book a call with an adviser/, 'the typed intent was ignored');
  assert.doesNotMatch(prompt, /well enough to decide what to do next/,
    'a fallback fired over a real answer');
});

test('ENRICH BRANCHES THE SAME WAY — it did not until today', () => {
  /* TWO FUNCTIONS ANSWERING ONE QUESTION, and only one had been corrected.
   * suggestTopics.js grew the non-local branch when blog mode shipped;
   * enrichTopic.js kept the trade-only line, and nobody noticed because
   * neither fallback could run.
   *
   * Reached on a silo campaign with TYPED topics, which is exactly how Edwin
   * plans them. */
  const blog = enrichPrompt({
    ...ctxFor(BLOG),
    topics: ['What a rate change notice tells you'],
  });

  assert.match(blog, /understand business loan with bankruptcy record well enough to decide what to do next/,
    'enrich still tells a blog to sell a service');

  const trade = enrichPrompt({
    ...ctxFor(TRADE),
    topics: ['What a rate change notice tells you'],
  });

  assert.match(trade, /use the business's business loan with bankruptcy record service/,
    'enrich lost the trade branch');
});

test('ONE FUNCTION, SO THE TWO PROMPTS CANNOT DIFFER BY A WORD', () => {
  /* The pair drifted once already: enrich carried only the local branch for
   * months while suggestTopics had both, and nothing could see it because
   * neither fallback could run.
   *
   * ASKED OF THE SENTENCE, NOT OF THE IMPORT. A test that grepped for
   * `require('./siteKind')` would pass on a file that imported the function
   * and then went on using its own copy. This asks readerIntent what the
   * sentence is and then requires BOTH prompts to contain that exact string.
   *
   * THE WRAPPERS AROUND IT ARE ALLOWED TO DIFFER, and they do — enrich says
   * "The reader should end up wanting to: X" while suggestTopics prints X
   * under a heading. My first version of this test compared the whole line
   * and went red on that difference, which would have been a test demanding
   * the two prompts be the same prompt. What has to match is X. */
  const { readerIntent } = require('./utils/blog/siteKind');

  for (const business of [BLOG, TRADE]) {
    const expected = readerIntent(PAGE, business);

    const fromSuggest = buildPrompt({ ...ctxFor(business), count: 5 });
    const fromEnrich = enrichPrompt({
      ...ctxFor(business),
      topics: ['What a rate change notice tells you'],
    });

    assert.ok(expected.includes('bankruptcy record'),
      'the fixture stopped exercising the keyword path');
    assert.ok(fromSuggest.includes(expected),
      `suggestTopics does not carry the shared sentence for ${business.name}`);
    assert.ok(fromEnrich.includes(expected),
      `enrichTopic does not carry the shared sentence for ${business.name}`);
  }
});

test('AND ENRICH STILL LETS A TYPED INTENT WIN', () => {
  /* THE MUTATION THAT SURVIVED THE FIRST RUN. Dropping `targetPage.intent ||`
   * from enrich makes the fallback fire over the owner's own words, and the
   * three cases above all still passed — because every one of them left the
   * intent blank, which is exactly the state the fallback is for.
   *
   * A test that only exercises the branch it is about cannot see a change that
   * removes the branching. */
  const prompt = enrichPrompt({
    ...ctxFor(BLOG, 'book a call with an adviser'),
    topics: ['What a rate change notice tells you'],
  });

  assert.match(prompt, /book a call with an adviser/, 'enrich ignored the typed intent');
  assert.doesNotMatch(prompt, /well enough to decide what to do next/,
    'a fallback fired over a real answer');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
