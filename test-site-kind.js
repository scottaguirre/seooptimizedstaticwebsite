// test-site-kind.js
//
// One decision, five readers.
//
//   node test-site-kind.js
//
// WHAT THIS IS FOR
//
// The engine was written for a local trade business and nothing in it ever
// asked whether it was looking at one. A site with an external theme, no
// trade and no town — a blog about plumbing in general, about business loans,
// about climate change — ran the whole local machine anyway:
//
//   - the writer's prompt was handed `Trade:    trade`, the literal word,
//     because buildContext substituted a placeholder for the missing value;
//   - the topic prompt offered "Something true of this town specifically" as
//     one of six angles AND demanded topics spread across at least four of
//     them, so the model answered an impossible angle rather than skipping
//     it — which is how a lending blog got "Central Texas Heat Can Turn
//     Utility Bills Into a Cash-Flow Gap";
//   - anchors read "local carbon offset programs", "what the work involves"
//     and "what happens on the visit", on a site where no work is done and
//     nobody visits;
//   - and a keyword containing a preposition collapsed the semantic bucket to
//     3 phrases for the 5 the mix wanted, so anchors repeated.
//
// THE SHAPE OF THE FIX, AND WHY IT IS TESTED THIS WAY
//
// Five behaviours change. Each could have asked "is there a town?" in one
// line at its own call site. That is exactly how the business-payload bug got
// in — three senders, one with the right mapping written inline and two
// without — and the symptom here would be blander and therefore worse: not a
// crash, just topics quietly going generic on sites that should have had the
// local angle.
//
// So the question is answered once, in siteKind.js, and the assertions below
// are mostly about AGREEMENT rather than about any single behaviour. The
// interesting failure is not "the blog got a town angle", it is "four files
// disagreed about what kind of site this is".

const assert = require('assert');

const { isLocalBusiness, tradeOf, townOf } = require('./utils/blog/siteKind');
const { businessBlock } = require('./utils/blog/businessBlock');
const { buildContext } = require('./utils/blog/context');
const { buildPrompt: topicPrompt, ANGLES } = require('./utils/blog/suggestTopics');
const { buildPrompt: writerPrompt } = require('./utils/blog/writePost');
const { buildAnchorPool, takesPluralVerb, LOCAL_DESCRIPTIVE, GENERAL_DESCRIPTIVE } = require('./utils/blog/anchorPool');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

/* The server's stored shape: type / location. */
const LOCAL_SITE = { business: { name: 'Hilltop Plumbing', type: 'Plumber', location: 'Leander, TX' } };
const BLOG_SITE  = { business: { name: 'Climate Desk', type: '', location: '' } };

const LOCAL_PAGE = { url: 'https://x/p/', keyword: 'water heater repair', title: 'Water Heater Repair', intent: 'book a repair' };
const BLOG_PAGE  = { url: 'https://y/p/', keyword: 'carbon offset programs', title: 'Carbon Offset Programs' };

const localCtx = buildContext(LOCAL_SITE, LOCAL_PAGE);
const blogCtx  = buildContext(BLOG_SITE,  BLOG_PAGE);

const localTopics = topicPrompt({ ...localCtx, count: 12 });
const blogTopics  = topicPrompt({ ...blogCtx,  count: 12 });

const SLOT = { topic: 'A topic', money: null };
const localWrite = writerPrompt(SLOT, localCtx);
const blogWrite  = writerPrompt(SLOT, blogCtx);

const localPool = buildAnchorPool({ targetPage: LOCAL_PAGE, business: LOCAL_SITE.business, count: 11 });
const blogPool  = buildAnchorPool({ targetPage: BLOG_PAGE,  business: BLOG_SITE.business,  count: 11 });

console.log('\nIs this a local business?\n');

/* ------------------------------------------------------------------ *
 * The decision
 * ------------------------------------------------------------------ */

test('A TRADE OR A TOWN MAKES IT LOCAL; NEITHER DOES NOT', () => {
  assert.strictEqual(isLocalBusiness({ type: 'Plumber', location: 'Leander, TX' }), true);
  assert.strictEqual(isLocalBusiness({ type: 'Plumber' }), true, 'a trade alone is enough');
  assert.strictEqual(isLocalBusiness({ location: 'Leander, TX' }), true, 'a town alone is enough');
  assert.strictEqual(isLocalBusiness({}), false);
  assert.strictEqual(isLocalBusiness(), false);
});

test('THE NAME IS NOT PART OF THE TEST', () => {
  /* The whole reason the old guard never fired. `IE_Settings::business()`
   * falls back to the WordPress site title, so every site has a name and a
   * condition including it is always true. writePost's own `hasBusiness`
   * check was `name || trade || town` and was therefore unreachable for the
   * exact case its comment described. */
  assert.strictEqual(isLocalBusiness({ name: 'Climate Desk' }), false,
    'a site title is making this site look like a local business again');
});

test('BOTH VOCABULARIES ANSWER THE SAME', () => {
  /* The server stores type/location; buildContext hands the prompts
   * trade/town. Both shapes reach this function from different callers. A
   * function that understood only one would answer "not local" for every
   * caller holding the other — silently, since there is no error to raise. */
  assert.strictEqual(isLocalBusiness({ type: 'Plumber', location: 'Leander, TX' }), true);
  assert.strictEqual(isLocalBusiness({ trade: 'Plumber', town: 'Leander' }), true);

  assert.strictEqual(tradeOf({ type: 'Plumber' }), 'Plumber');
  assert.strictEqual(tradeOf({ trade: 'Plumber' }), 'Plumber');
  assert.strictEqual(townOf({ location: 'Leander, TX' }), 'Leander', 'the state code is dropped');
  assert.strictEqual(townOf({ town: 'Leander' }), 'Leander');
});

test("the old placeholders do not count as values", () => {
  /* buildContext used to write the literal strings 'trade' and 'the business'
   * over missing values. A BlogSite stored before they were removed can still
   * hold one, and without this it would read as a real trade forever. */
  assert.strictEqual(isLocalBusiness({ trade: 'trade' }), false);
  assert.strictEqual(isLocalBusiness({ name: 'the business', trade: 'trade' }), false);
  assert.strictEqual(isLocalBusiness({ trade: 'Trade' }), false, 'case should not rescue it');
  assert.strictEqual(isLocalBusiness({ trade: 'Trade Services Ltd' }), true,
    'a real trade that merely contains the word must survive');
});

/* ------------------------------------------------------------------ *
 * The five readers agree
 * ------------------------------------------------------------------ */

test('ALL FIVE READERS AGREE WITH THE DECISION', () => {
  /* THE ASSERTION THIS FILE EXISTS FOR.
   *
   * Not "the blog prompt has no town angle" — that is one symptom. This says
   * every behaviour that depends on the question gives the answer the one
   * function gives, for both kinds of site, so a caller that starts deciding
   * for itself fails here rather than in a customer's campaign. */
  assert.strictEqual(localCtx.isLocal, true,  'buildContext disagrees');
  assert.strictEqual(blogCtx.isLocal,  false, 'buildContext disagrees');

  const reads = [
    ['the topic prompt angle',  /town specifically/,        localTopics, blogTopics],
    ['the topic prompt framing', /a local trade business/,  localTopics, blogTopics],
    ['the writer business block', /Trade:/,                 localWrite,  blogWrite],
  ];

  for (const [what, pattern, local, blog] of reads) {
    assert.ok(pattern.test(local), `${what} is missing on a LOCAL site`);
    assert.ok(!pattern.test(blog), `${what} is present on a BLOG`);
  }

  assert.ok(localPool.pool.descriptive.includes('what the work involves'),
    'the anchor pool disagrees on a LOCAL site');
  assert.ok(!blogPool.pool.descriptive.includes('what the work involves'),
    'the anchor pool disagrees on a BLOG');
});

/* ------------------------------------------------------------------ *
 * The business block
 * ------------------------------------------------------------------ */

test('AN EMPTY FIELD PRODUCES NO LINE', () => {
  /* The rule, stated directly. A labelled blank is a claim that the value
   * exists, which the model answers by inventing one. */
  const block = businessBlock({ name: 'Climate Desk', trade: '', town: '', services: [] });

  assert.match(block, /Name: +Climate Desk/);
  assert.ok(!/Trade:/.test(block), 'an empty trade still prints its label');
  assert.ok(!/Town:/.test(block), 'an empty town still prints its label');
  assert.ok(!/Services:/.test(block), 'an empty services list still prints its label');
});

test('a block with nothing in it is no block at all', () => {
  /* What a pillar campaign has always needed, and the one case the old guard
   * did catch. */
  assert.strictEqual(businessBlock({}), '');
  assert.strictEqual(businessBlock({ name: '', trade: '', town: '' }), '');
  assert.strictEqual(businessBlock(), '');
});

test('a local business still prints all four', () => {
  const block = businessBlock({ name: 'Hilltop Plumbing', trade: 'Plumber', town: 'Leander', services: ['water heater repair'] });
  for (const label of ['Name:', 'Trade:', 'Town:', 'Services:']) {
    assert.ok(block.includes(label), `${label} is missing from a complete business`);
  }
});

test('BOTH PROMPT BUILDERS USE THE SHARED BLOCK', () => {
  /* They had identical copies of the template, so they had identical copies
   * of the bug. Asserted through behaviour: whatever renders the block, an
   * empty field must not reach either prompt as a label. */
  for (const [what, prompt] of [['the writer', blogWrite], ['the topic suggester', blogTopics]]) {
    assert.ok(/Name: +Climate Desk/.test(prompt), `${what} lost the business name`);
    assert.ok(!/Trade: *$/m.test(prompt), `${what} prints an empty Trade label`);
    assert.ok(!/Town: *$/m.test(prompt), `${what} prints an empty Town label`);
    assert.ok(!/Trade: +trade/.test(prompt), `${what} prints the placeholder word "trade" as a fact`);
  }
});

test('CONTEXT NO LONGER INVENTS A TRADE OR A NAME', () => {
  /* The placeholders are the reason the block mattered. In production the
   * prompt did not say `Trade:` followed by nothing — it said `Trade: trade`,
   * which is worse, because an invented value looks like data. */
  assert.strictEqual(blogCtx.business.trade, '');
  assert.strictEqual(blogCtx.business.town, '');
  assert.strictEqual(blogCtx.business.name, 'Climate Desk');

  const nameless = buildContext({ business: { name: '', type: '', location: '' } }, BLOG_PAGE);
  assert.strictEqual(nameless.business.name, '', 'still substituting "the business"');
});

test('services is still always an array', () => {
  /* suggestTopics and enrichTopics both call .join() on it without checking,
   * so undefined is a crash inside a prompt builder several frames from
   * anything that explains why. Unchanged by this work, asserted because the
   * line that builds it was edited. */
  assert.ok(Array.isArray(blogCtx.business.services));
  assert.ok(Array.isArray(buildContext({}, {}).business.services));
});

/* ------------------------------------------------------------------ *
 * The angles
 * ------------------------------------------------------------------ */

test('THE TOWN ANGLE IS DROPPED WHEN THERE IS NO TOWN', () => {
  assert.ok(/town specifically/.test(localTopics), 'a plumber lost its best angle');
  assert.ok(!/town specifically/.test(blogTopics), 'a blog is still asked for a town angle');
  assert.ok(!/Central Texas/.test(blogTopics), 'the example still names a place');
});

test('EXACTLY ONE ANGLE IS LOCAL-ONLY', () => {
  /* A record of a judgement call, so the next person meets it deliberately.
   *
   * "What actually happens during the job" was the close one. It assumes
   * somebody turns up — wrong on a climate blog, right on a general plumbing
   * blog, and both have no town. Nothing available can tell those apart, so
   * it stays for both: a town angle with no town is impossible, which is a
   * different kind of claim from a guess about subject matter. */
  const flagged = ANGLES.filter(a => a.localOnly).map(a => a.key);
  assert.deepStrictEqual(flagged, ['local'],
    'the set of local-only angles changed — if deliberate, update this test and CLAUDE.md');
});

test('the spread requirement shrinks with the angle list', () => {
  /* "at least four" of six is two-thirds and leaves room to choose. Of five
   * it is four-fifths, which is nearly compulsory — the pressure that made
   * the model answer the impossible angle in the first place. */
  assert.match(localTopics, /across at least 4 of them/);
  assert.match(blogTopics, /across at least 3 of them/);
});

test('every surviving angle still reaches the prompt', () => {
  for (const angle of ANGLES) {
    if (!angle.localOnly) {
      assert.ok(blogTopics.includes(angle.name), `the "${angle.name}" angle is missing from a blog`);
    }
    assert.ok(localTopics.includes(angle.name), `the "${angle.name}" angle is missing from a local site`);
  }
});

test('the phone-call framing is replaced, not just removed', () => {
  /* "the hour before they picked up the phone" is the test a topic has to
   * pass, and on a blog nobody phones. Dropping it would leave the prompt
   * with no test at all. */
  assert.match(localTopics, /picked up the phone/);
  assert.ok(!/picked up the phone/.test(blogTopics));
  assert.match(blogTopics, /before they typed the search/);
});

test('the town-in-titles rule goes with the town', () => {
  assert.match(localTopics, /THE TOWN NAME BELONGS IN AT MOST TWO TITLES/);
  assert.ok(!/TOWN NAME BELONGS/.test(blogTopics));
  assert.ok(!/Appending "in "/.test(blogTopics), 'the rule survived with an empty town in it');
  assert.match(blogTopics, /Mix the constructions/, 'the rest of the paragraph was lost with it');
});

test('THE KEYWORD RULES SURVIVED THE EDIT', () => {
  /* Guarding the rest of a heavily-edited prompt. These are the assertions
   * from test-suggest-prompt.js that the restructuring could have broken. */
  for (const prompt of [localTopics, blogTopics]) {
    assert.match(prompt, /No query may be "[^"]+" itself/);
    assert.match(prompt, /AUDIENCE OR QUALIFIER IN THAT PHRASE IS NOT\s+BANNED/);
    assert.ok(!/or a close variant/.test(prompt), 'the wording that stripped the qualifier is back');
  }
  assert.match(blogTopics, /wants to rank for "carbon offset programs"/);
});

/* ------------------------------------------------------------------ *
 * The anchors
 * ------------------------------------------------------------------ */

test('NO ANCHOR ON A BLOG CLAIMS SOMEBODY DOES A JOB', () => {
  const all = [].concat(blogPool.pool.semantic, blogPool.pool.descriptive, blogPool.pool.branded);

  /* NOT EVERY ANCHOR CONTAINING "work" IS WRONG, and the first version of
   * this test said so and failed on "how carbon offset programs actually
   * work" — which is correct English about how a thing functions, not a
   * claim that someone performs labour. A test that fails on correct code
   * gets deleted, and then nothing is checking.
   *
   * So the ban is on the service SENSE: "the work", "the job", a visit,
   * something being booked, scheduled, carried out, assessed or put right. */
  for (const phrase of all) {
    assert.ok(!/\b(the work|job|visit|visits|booking|scheduling|arranging|assessed|carried out|put right)\b/i.test(phrase),
      `"${phrase}" describes a service being performed`);
    assert.ok(!/\b(local|professional|experienced|company|specialists)\b/i.test(phrase),
      `"${phrase}" describes a business being hired`);
  }

  /* And the exact check, which no wording rule can get wrong: not one phrase
   * written for a local business may appear on a blog. */
  for (const phrase of LOCAL_DESCRIPTIVE) {
    assert.ok(!blogPool.pool.descriptive.includes(phrase),
      `the local phrase "${phrase}" is in a blog's pool`);
  }
});

test('the local phrasing is untouched on a local site', () => {
  assert.ok(localPool.pool.descriptive.includes('what happens on the visit'));
  assert.ok(localPool.pool.semantic.includes('local water heater repair'));
  assert.ok(localPool.pool.semantic.includes('Leander water heater repair'));
  assert.ok(localPool.pool.semantic.length >= 15,
    `the local bucket shrank to ${localPool.pool.semantic.length}`);
});

test('THE TWO DESCRIPTIVE SETS ARE THE SAME SIZE', () => {
  /* The shortfall check compares bucket length against the mix. A shorter
   * general set would start warning on every blog campaign, and a warning
   * that fires every time trains the owner to ignore the ones that matter. */
  assert.strictEqual(GENERAL_DESCRIPTIVE.length, LOCAL_DESCRIPTIVE.length);
});

test('NO TEMPLATE REPEATS A WORD THE KEYWORD ALREADY ENDS WITH', () => {
  /* "loan terms explained explained" — mine, shipped the day after I wrote
   * the template.
   *
   * THE GUARD EXISTED FOUR LINES AWAY. `${keyword} services` is skipped when
   * the keyword already ends in service or services, with a comment saying
   * exactly why ("residential plumbing services services"). I added the blog
   * branch a day later and did not carry the lesson across the if/else.
   *
   * A RULE LEARNED ON ONE BRANCH DOES NOT CROSS TO THE OTHER ON ITS OWN. */
  const { pool } = buildAnchorPool({
    targetPage: { keyword: 'loan terms explained' },
    business: { name: 'Hilltop Home Loans', type: '', location: '' },
    count: 4,
  });

  assert.ok(!pool.semantic.some(p => /explained explained/i.test(p)),
    `a doubled word shipped: ${pool.semantic.find(p => /explained explained/i.test(p))}`);

  /* And the local branch's own guard still holds — the test that proves this
   * one is a pair, not a replacement. */
  const { pool: local } = buildAnchorPool({
    targetPage: { keyword: 'residential plumbing services' },
    business: { name: 'Hilltop Plumbing', type: 'Plumber', location: 'Leander, TX' },
    count: 4,
  });
  assert.ok(!local.semantic.some(p => /services services/i.test(p)));
});

test('A VERB TEMPLATE STEPS ASIDE WHEN THE KEYWORD IS NOT A NOUN PHRASE', () => {
  /* "how loan terms explained actually works" agrees with "explained" rather
   * than with "terms", and no verb form rescues it: the keyword is a TITLE,
   * not the name of a thing.
   *
   * So the one template carrying a verb drops out, and the prefix wrappers
   * carry the bucket — they put words in FRONT of the keyword and cannot be
   * tripped by how it ends.
   *
   * A pillar campaign's keyword comes from its post title, which is the
   * underlying problem and is logged in CLAUDE.md rather than patched here. */
  const title = buildAnchorPool({
    targetPage: { keyword: 'loan terms explained' },
    business: { name: 'Hilltop Home Loans' }, count: 4,
  }).pool.semantic;

  assert.ok(!title.some(p => /actually works?$/.test(p)),
    `a verb was bolted onto a title: ${title.find(p => /actually works?$/.test(p))}`);
  assert.ok(title.length >= 3, `only ${title.length} semantic phrases left`);

  /* AND IT IS STILL THERE FOR A REAL NOUN PHRASE. Dropping it everywhere
   * would pass the assertion above and quietly cost every ordinary blog a
   * phrase. */
  const noun = buildAnchorPool({
    targetPage: { keyword: 'carbon offset programs' },
    business: { name: 'Climate Desk' }, count: 4,
  }).pool.semantic;

  assert.ok(noun.includes('how carbon offset programs actually work'),
    'the verb template was dropped for every keyword, not just the ones it breaks on');
});

test('A PREPOSITION IN THE KEYWORD NO LONGER EMPTIES THE BUCKET', () => {
  /* The shortfall Edwin's campaign hit. "small business loans for women"
   * cannot take a suffix, which killed 14 of the 17 local templates and left
   * 3 phrases for 5 slots. The general templates wrap the keyword rather than
   * extending it, so the preposition is harmless. */
  const { pool, shortfalls } = buildAnchorPool({
    targetPage: { keyword: 'small business loans for women' },
    business: { name: 'Loan Notes', type: '', location: '' },
    count: 11,
  });

  assert.ok(pool.semantic.length >= 5,
    `only ${pool.semantic.length} semantic phrases: ${pool.semantic.join(' | ')}`);
  assert.deepStrictEqual(shortfalls, [], 'the campaign would still warn about reuse');
  assert.ok(pool.semantic.includes('small business loans for women explained'));
  assert.ok(pool.semantic.includes('understanding small business loans for women'));
});

test('A VERB AFTER THE KEYWORD AGREES WITH THE HEAD NOUN', () => {
  /* "how small business loans for women actually works" came out of the
   * template before this. The head noun is "loans"; "women" is a modifier
   * sitting after a preposition, and agreeing with it is how the sentence
   * went wrong. pluralise() already knew this rule for a different question. */
  assert.strictEqual(takesPluralVerb('small business loans for women'), true);
  assert.strictEqual(takesPluralVerb('carbon offset programs'), true);
  assert.strictEqual(takesPluralVerb('solar panels for homes'), true);
  assert.strictEqual(takesPluralVerb('water heater repair'), false);
  assert.strictEqual(takesPluralVerb('climate change'), false);
  assert.strictEqual(takesPluralVerb('business analysis'), false, 'a singular noun ending in s');

  const { pool } = buildAnchorPool({
    targetPage: { keyword: 'small business loans for women' },
    business: { name: 'Loan Notes' }, count: 11,
  });
  assert.ok(pool.semantic.includes('how small business loans for women actually work'));
  assert.ok(!pool.semantic.some(p => /actually works$/.test(p)));
});

test('the exact bucket is still exactly the keyword', () => {
  /* Untouched by all of this, and the easiest thing to break while editing
   * the bucket beside it. 30% of a campaign links with this string. */
  assert.deepStrictEqual(blogPool.pool.exact, ['carbon offset programs']);
  assert.deepStrictEqual(localPool.pool.exact, ['water heater repair']);
});

test('the branded bucket still works on a blog', () => {
  /* A site title makes a perfectly good publisher name — "Climate Desk" reads
   * correctly as a branded anchor. This is the one bucket that needed no
   * change, asserted so that a later tidy-up does not take it. */
  assert.ok(blogPool.pool.branded.includes('Climate Desk'));
  assert.ok(!blogPool.pool.branded.some(p => /in\s*$/.test(p)), 'an empty town leaked into a branded phrase');
});

/* ------------------------------------------------------------------ *
 * Pillars
 * ------------------------------------------------------------------ */

test('A PILLAR CAMPAIGN IS UNAFFECTED', () => {
  /* It passes no business at all and skips the anchor pool entirely. The
   * block was already omitted for it by the old guard — the one case that
   * guard did catch — so this is the behaviour most at risk of being lost
   * while replacing it. */
  const pillar = writerPrompt({ topic: 'A hub post', money: null }, { isPillar: true, business: {}, targetPage: { title: 'x', keyword: 'x' } });

  assert.ok(!/BUSINESS/.test(pillar), 'a pillar campaign is being told about a business');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
