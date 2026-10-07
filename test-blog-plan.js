// test-blog-plan.js
//
// Exercises the planning and link machinery against the REAL engine files —
// planCampaign.js, anchors.js, links.js and qualityCheck.js as they are, not
// stubs of them. Only writePost is stubbed, because it is the one part that
// calls a model.
//
// What it proves:
//   1. The anchor pool satisfies pickAnchors, which throws on an empty bucket
//   2. Publish times hold their wall clock across daylight saving
//   3. buildLinkPlan produces the exact slot shape writePost and checkPost
//      both read — including the anchors checkPost verifies verbatim
//   4. Forward links become placeholder spans, and become real anchors once
//      their target publishes
//
//   node test-blog-plan.js

const assert = require('assert');

const { planForCampaign } = require('./utils/blog/campaignPlan');
const { buildAnchorPool } = require('./utils/blog/anchorPool');
const { publishDates } = require('./utils/blog/schedule');
const { buildLinkPlan } = require('./utils/blog/linkPlan');
const { applyLinks, activate, pendingIds } = require('./utils/blog/links');
const { checkPost } = require('./utils/blog/qualityCheck');
const { slugify, uniqueSlugs } = require('./utils/blog/planCampaign');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

const TARGET = {
  url: 'https://example.com/water-heater-repair-leander-tx.html',
  keyword: 'water heater repair',
  title: 'Water Heater Repair',
  intent: 'Someone whose water heater has stopped working and wants it fixed.',
};

const BUSINESS = { name: 'Hill Country Plumbing', type: 'plumber', location: 'Leander, TX' };

const TOPICS = [
  { topic: 'Why a pilot light keeps going out', targetQuery: 'water heater pilot light keeps going out', linkPhrase: 'a pilot light that will not stay lit', angle: 'symptom' },
  { topic: 'The noise a tank makes before it fails', targetQuery: 'water heater making popping noise', linkPhrase: 'that popping sound from the tank', angle: 'symptom' },
  { topic: 'What happens during a diagnosis visit', targetQuery: 'what happens water heater service call', linkPhrase: 'what a diagnosis visit involves', angle: 'process' },
  { topic: 'At ten years, many problems are still fixable', targetQuery: 'is a 10 year old water heater worth fixing', linkPhrase: 'whether an older tank is worth keeping', angle: 'decision' },
];

/* ===================================================================== */

console.log('\nAnchor pool');

test('a pool is built with every bucket populated', () => {
  const { pool } = buildAnchorPool({ targetPage: TARGET, business: BUSINESS, count: 4 });
  for (const type of ['exact', 'semantic', 'descriptive', 'branded']) {
    assert.ok(pool[type].length > 0, `${type} bucket is empty — pickAnchors would throw`);
  }
});

test('a missing business name does not leave the branded bucket empty', () => {
  // The realistic failure: a site activated before business details were set.
  // An empty bucket makes anchors.js throw and the whole campaign fail.
  const { pool } = buildAnchorPool({
    targetPage: TARGET, business: { location: 'Leander, TX' }, count: 4,
  });
  assert.ok(pool.branded.length > 0);
});

test('a keyword with no business details at all still yields a usable pool', () => {
  const { pool } = buildAnchorPool({ targetPage: { keyword: 'drain cleaning' }, business: {}, count: 4 });
  for (const type of ['exact', 'semantic', 'descriptive', 'branded']) {
    assert.ok(pool[type].length > 0, `${type} empty`);
  }
});

test('a missing keyword throws rather than producing silent nonsense', () => {
  assert.throws(() => buildAnchorPool({ targetPage: {}, business: BUSINESS, count: 4 }));
});

/* ===================================================================== */

console.log('\nScheduling');

const fmtChicago = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Chicago', dateStyle: 'short', timeStyle: 'short', hour12: false,
});

test('posts hold 09:00 local across both DST boundaries', () => {
  const dates = publishDates({
    count: 40, everyDays: 7, publishTime: '09:00', timezone: 'America/Chicago',
    startAt: new Date(Date.UTC(2027, 0, 4)),
  });
  const times = new Set(dates.map(d => fmtChicago.format(d).split(', ')[1]));
  assert.deepStrictEqual([...times], ['09:00'], `drifted to: ${[...times].join(', ')}`);
});

test('naive millisecond arithmetic DOES drift — this is why schedule.js exists', () => {
  const start = publishDates({
    count: 1, everyDays: 7, publishTime: '09:00', timezone: 'America/Chicago',
    startAt: new Date(Date.UTC(2027, 0, 4)),
  })[0];

  const naive = [];
  for (let i = 0; i < 40; i++) naive.push(new Date(start.getTime() + i * 7 * 86400000));

  const times = new Set(naive.map(d => fmtChicago.format(d).split(', ')[1]));
  assert.ok(times.size > 1, 'expected the naive version to drift, proving the point');
});

test('the cadence is respected', () => {
  const dates = publishDates({ count: 5, everyDays: 14, publishTime: '09:00', timezone: 'UTC' });
  for (let i = 1; i < dates.length; i++) {
    const days = Math.round((dates[i] - dates[i - 1]) / 86400000);
    assert.strictEqual(days, 14);
  }
});

test('an unknown timezone falls back to UTC instead of throwing', () => {
  const dates = publishDates({ count: 2, everyDays: 7, publishTime: '09:00', timezone: 'Mars/Olympus' });
  assert.strictEqual(dates.length, 2);
});

test('the first post is never already overdue', () => {
  // A campaign created at 2pm for 9am posting must not fire within the minute.
  const dates = publishDates({ count: 3, everyDays: 7, publishTime: '00:01', timezone: 'UTC' });
  assert.ok(dates[0].getTime() > Date.now());
});

test('a daily cadence in a zone behind UTC does not blow the stack', () => {
  // The bug this guards: shifting past an already-passed first slot used to
  // recurse with a UTC-MIDNIGHT anchor, and the next call read that instant
  // back in the site's zone. Anywhere behind UTC that is still the PREVIOUS
  // calendar day, so a one-day cadence advanced by nothing and recursed until
  // "Maximum call stack size exceeded" surfaced as "Could not create the
  // campaign". Weekly hid it — it crept forward six days a time and stopped.
  //
  // Every hour of the day is tried, because whether the shift runs at all
  // depends on the clock at the moment the campaign is planned; the original
  // report only reproduced after 09:00 local.
  for (const tz of ['America/Chicago', 'America/New_York', 'America/Los_Angeles']) {
    for (let h = 0; h < 24; h++) {
      const at = `${String(h).padStart(2, '0')}:00`;
      const dates = publishDates({ count: 3, everyDays: 1, publishTime: at, timezone: tz });

      assert.strictEqual(dates.length, 3, `${tz} ${at}`);
      assert.ok(dates[0].getTime() > Date.now(), `${tz} ${at} first slot already overdue`);
      for (let i = 1; i < dates.length; i++) {
        assert.ok(dates[i] > dates[i - 1], `${tz} ${at} slot ${i} is not after slot ${i - 1}`);
      }
    }
  }
});

/* ===================================================================== */

console.log('\nPlanning');

let plan;

test('a campaign plans without throwing', () => {
  plan = planForCampaign({
    targetPage: TARGET, topics: TOPICS, business: BUSINESS,
    schedule: { everyDays: 7, publishTime: '09:00', timezone: 'America/Chicago' },
  });
  assert.strictEqual(plan.slots.length, 4);
});

test('every slot carries an anchor and a publish time', () => {
  for (const s of plan.slots) {
    assert.ok(s.moneyAnchor, `slot ${s.index} has no anchor`);
    assert.ok(s.publishAt instanceof Date, `slot ${s.index} has no publishAt`);
  }
});

test('these topics raise no cannibalisation conflict', () => {
  assert.deepStrictEqual(plan.conflicts, [], JSON.stringify(plan.conflicts));
});

test('a topic chasing the money keyword IS caught', () => {
  const bad = planForCampaign({
    targetPage: TARGET, business: BUSINESS,
    topics: [...TOPICS, {
      topic: 'Best water heater repair near me',
      targetQuery: 'best water heater repair near me',
      linkPhrase: 'finding someone local',
    }],
    schedule: {},
  });
  assert.ok(bad.conflicts.some(c => c.kind === 'cannibalises'), 'should have flagged it');
});

/* ------------------------------------------------------------------ *
 * The silo's own subject is not evidence of duplication
 * ------------------------------------------------------------------ */

const { compareQueries, queryTokens } = require('./utils/blog/planCampaign');

/** compareQueries with no town, keeping only the duplicate half. */
function pairs(queries, keyword) {
  return compareQueries(
    queries.map(q => ({ id: q, targetQuery: q })),
    keyword,
    0.6,
    queryTokens('')
  ).filter(c => c.kind === 'duplicate');
}

test('A STOPWORD THAT STEMS TO SOMETHING ELSE IS STILL REMOVED', () => {
  /* FOUR DEAD ENTRIES IN THAT LIST, found while fixing the same word in
   * keywordCoverage.js. queryTokens stemmed before filtering, and the stemmer
   * runs on glue too, so any stopword whose stem is not itself a stopword
   * survived the filter and was counted as a content word:
   *
   *     vs -> v     was -> wa     this -> thi     does -> doe
   *
   * "thi" and "wa" shared between two queries inflated every overlap score a
   * little, and `vs` — listed deliberately — could never once have fired.
   *
   * A list entry that cannot match is the shape this project keeps paying
   * for: the cancel flag read after the request, the intent fallback behind a
   * `||` that could not be reached. */
  assert.deepStrictEqual([...queryTokens('business bankruptcy vs personal bankruptcy')],
    ['busines', 'bankruptcy', 'personal']);

  assert.deepStrictEqual([...queryTokens('what was this does it matter')], ['matter']);
});

test('and a word that BECOMES a stopword is removed too', () => {
  /* Filtered on both sides, not just moved. Stemming can PRODUCE a stopword —
   * "its" is not in the list, "it" is — so a single filter in either position
   * misses one of the two cases. */
  assert.deepStrictEqual([...queryTokens('its repair cost')], ['repair', 'cost']);
});

test('TWO TOPICS SHARING ONLY THE SUBJECT ARE NOT DUPLICATES', () => {
  /* The plan this function refused on Edwin's screen, 7 October:
   *
   *     "business loan proof of ownership" vs "business loan ownership change"
   *     (overlap 0.60)
   *
   * Shared: business, loan, ownership — three of five, exactly the threshold,
   * so a twelve-post campaign was refused outright. TWO OF THOSE THREE ARE THE
   * SILO'S SUBJECT. Every post feeding a "business loan with bankruptcy
   * record" pillar says "business loan", by construction and on purpose, so
   * the metric was reading the one thing these posts are REQUIRED to share as
   * proof they were the same post.
   *
   * Strip the subject and the real overlap is "ownership" alone: 1 of 3. */
  assert.deepStrictEqual(
    pairs(['business loan proof of ownership', 'business loan ownership change'],
      'business loan with bankruptcy record'),
    []);
});

test('a genuine twin is still caught, subject or no subject', () => {
  /* The exemption must not become a way through for everything. These two
   * differ by a plural and nothing else. */
  const found = pairs(['business loan ucc lien', 'business loan ucc liens'],
    'business loan with bankruptcy record');

  assert.strictEqual(found.length, 1, JSON.stringify(found));
});

test('WITHOUT A SHARED SUBJECT THE SAME PAIR IS REFUSED', () => {
  /* The same two queries against a keyword sharing nothing with them. Nothing
   * is stripped, the raw overlap stands, and the pair is flagged — which is
   * what Edwin saw, and what proves the shared subject was the entire reason.
   * A test that only showed the pair passing could not tell this fix from a
   * loosened threshold. */
  const found = pairs(['business loan proof of ownership', 'business loan ownership change'],
    'kitchen tap replacement');

  assert.strictEqual(found.length, 1, JSON.stringify(found));
});

test('a query that is nothing but the subject falls back to the full sets', () => {
  /* Stripping would empty both, and overlap() answers 0 for an empty set —
   * two near-identical queries comparing as unrelated, the worst answer for
   * the worst pair. The guard is `out.size ? out : tokens` in distinctive(). */
  const found = pairs(['business loan bankruptcy record', 'bankruptcy record business loan'],
    'business loan with bankruptcy record');

  assert.strictEqual(found.length, 1, JSON.stringify(found));
});

test('BOTH SIDES ARE STRIPPED, NOT JUST ONE', () => {
  /* FOUND BY A SURVIVING MUTATION. Stripping only `ta` left every earlier test
   * green: the asymmetric score is LOWER, so the pair that should pass still
   * passed, and the genuine twin was caught by isSubset rather than by its
   * score. Under-reporting duplicates is the quiet direction, and no test
   * pointed at it.
   *
   * This pair needs the score itself. Four distinctive tokens each, three
   * shared — 3 of 5, exactly the threshold — and neither set contains the
   * other, so isSubset cannot rescue it:
   *
   *   both sides stripped   {ucc,lien,filing,fee} vs {ucc,lien,filing,cost}
   *                         3 / 5 = 0.60  flagged
   *   one side stripped     {ucc,lien,filing,fee} vs {busines,loan,ucc,lien,
   *                         filing,cost} = 3 / 7 = 0.43  missed */
  const found = pairs(
    ['business loan ucc lien filing fee', 'business loan ucc lien filing cost'],
    'business loan with bankruptcy record');

  assert.strictEqual(found.length, 1, JSON.stringify(found));
});

test('no target keyword at all leaves the comparison untouched', () => {
  /* A pillar campaign has no money page, so there is no subject to strip and
   * the pair must compare exactly as it did before this existed. */
  const found = pairs(['business loan proof of ownership', 'business loan ownership change'], '');

  assert.strictEqual(found.length, 1, JSON.stringify(found));
});

/* ------------------------------------------------------------------ *
 * The refusal says which conflict actually fired
 * ------------------------------------------------------------------ */

const { conflictMessage } = require('./utils/blog/planCampaign');

test('A DUPLICATE PAIR IS NOT DESCRIBED AS COMPETING WITH THE PILLAR', () => {
  /* What Edwin read, 7 October: "Some topics would compete with the target
   * page." The conflict was two of HIS OWN topics overlapping each other, and
   * the panel above the sentence already said "duplicate:" — so the screen
   * disagreed with itself and the sentence sent him to the wrong place.
   *
   * ASSERTING THE OLD WORDING ABSENT IS THE HALF THAT MATTERS. A check that
   * only looked for the new sentence would pass on a message that printed
   * both. */
  const message = conflictMessage([{ kind: 'duplicate', a: 'x', b: 'y' }]);

  assert.ok(/same search as each other/.test(message), message);
  assert.ok(!/target page/.test(message), message);
});

test('cannibalisation keeps the sentence it always had', () => {
  assert.strictEqual(conflictMessage([{ kind: 'cannibalises', a: 'x' }]),
    'Some topics would compete with the target page.');
});

test('a missing keyword says so', () => {
  assert.ok(/no main keyword/.test(conflictMessage([{ kind: 'missing', a: 'x' }])));
});

test('CANNIBALISATION IS NAMED FIRST WHEN BOTH ARE PRESENT', () => {
  /* Ranked, not concatenated. A post competing with the pillar is the fault
   * the whole design exists to prevent, so it wins the one sentence on
   * offer — and the order must not depend on which conflict happens to come
   * first in the array, which is why the duplicate leads here. */
  const message = conflictMessage([
    { kind: 'duplicate', a: 'x', b: 'y' },
    { kind: 'cannibalises', a: 'z' },
  ]);

  assert.strictEqual(message, 'Some topics would compete with the target page.');
});

test('an unknown kind still produces a sentence, not undefined', () => {
  /* The route puts this straight into a 400 body. A new kind added to
   * compareQueries without a sentence here must not reach a customer as
   * "undefined", and an empty list must not either. */
  assert.ok(conflictMessage([{ kind: 'something-new' }]).length > 10);
  assert.ok(conflictMessage([]).length > 10);
  assert.ok(conflictMessage().length > 10);
});

test('THE ROUTE USES IT RATHER THAN ITS OWN COPY', () => {
  /* The sentences live with the kinds because a copy at the call site is a
   * second definition of a decision made in planCampaign.js. Asserted by
   * reading the route, since it cannot be required here — models/Job is not
   * present in every checkout. */
  const route = require('fs').readFileSync(
    require('path').join(__dirname, 'routes/blogApiRoute.js'), 'utf8');

  assert.ok(/conflictMessage\(plan\.conflicts\)/.test(route),
    'the route no longer calls conflictMessage');
  assert.ok(!/error: 'Some topics would compete with the target page\.'/.test(route),
    'the route still carries its own copy of the sentence');
});

test('the anchor mix is spread, not clumped', () => {
  const types = plan.slots.map(s => s.anchorType);
  assert.ok(new Set(types).size > 1, `all anchors are ${types[0]}`);
});

test('a second campaign does not reuse the first campaign\'s anchors', () => {
  const second = planForCampaign({
    targetPage: TARGET, topics: TOPICS, business: BUSINESS, schedule: {},
    priorCampaigns: [{ slots: plan.slots }],
  });

  const first = new Set(plan.slots.map(s => s.moneyAnchor.toLowerCase()));
  const overlap = second.slots.filter(s => first.has(s.moneyAnchor.toLowerCase()));

  // Some reuse is legitimate once a bucket is exhausted, and anchors.js flags
  // it. What must not happen is every anchor repeating.
  assert.ok(overlap.length < second.slots.length, 'every anchor was reused');
});

/* ===================================================================== */

console.log('\nLink plan and token substitution');

function campaignFrom(plan, published = {}) {
  return {
    targetPage: TARGET,
    site: { business: BUSINESS },
    slots: plan.slots.map(s => ({
      ...s,
      status: published[s.index] ? 'published' : 'pending',
      publishedUrl: published[s.index] || '',
      publishedTitle: published[s.index] ? `Post ${s.index}` : '',
    })),
  };
}

test('slot 0 gets a money anchor and a forward anchor, no backward one', () => {
  const { slot } = buildLinkPlan(campaignFrom(plan), 0);
  assert.ok(slot.money.anchor, 'no money anchor');
  assert.ok(slot.nextAnchor, 'no forward anchor');
  assert.strictEqual(slot.prevAnchor, undefined, 'slot 0 should have no backward anchor');
});

test('the last slot closes the ring back to slot 0', () => {
  const { slot } = buildLinkPlan(campaignFrom(plan), 3);
  assert.ok(slot.prevAnchor, 'no backward anchor');
  assert.ok(slot.nextAnchor, 'the ring should close forward to slot 0');
});

test('a forward link to an unpublished post becomes a placeholder', () => {
  const { targets } = buildLinkPlan(campaignFrom(plan), 0);
  assert.ok(targets.next.pendingId, 'expected a pendingId, got a live URL');
  assert.ok(!targets.next.url);
});

test('a forward link to an already-published post is live', () => {
  // Slots can be generated out of order; a link that can be real should be.
  const c = campaignFrom(plan, { 1: 'https://example.com/blog/post-1/' });
  const { targets } = buildLinkPlan(c, 0);
  assert.strictEqual(targets.next.url, 'https://example.com/blog/post-1/');
  assert.ok(!targets.next.pendingId);
});

test('the slot shape satisfies checkPost\'s verbatim token check', () => {
  // The check that silently skipped under the wrong signature.
  const { slot } = buildLinkPlan(campaignFrom(plan), 1);

  const good = {
    title: 'The noise a tank makes before it fails',
    metaDescription: 'A popping sound usually means sediment, and it is fixable up to a point.',
    sections: [
      { heading: null, paragraphs: [
        `A popping sound from a 40 gallon tank almost always means sediment. ` +
        `It collects over 3 to 5 years, and at 140 degrees F it traps steam under the layer. ` +
        `Past a certain point a {{money}}${slot.money.anchor}{{/money}} is the practical next step, ` +
        `often $150 to $400 depending on what is found.`,
      ] },
      { heading: 'What you can check today', paragraphs: [
        `Run the hot tap for 30 seconds and listen at the tank. ` +
        `We covered {{prev}}${slot.prevAnchor}{{/prev}} earlier and the same checks apply. ` +
        `If the noise is loudest in the first 2 minutes, sediment is the likely cause. ` +
        `Most tanks last 8 to 12 years before this becomes terminal.`,
      ] },
      { heading: 'When it stops being worth it', paragraphs: [
        `At that age people start weighing up {{next}}${slot.nextAnchor}{{/next}} instead. ` +
        `A 50 gallon replacement runs $1,200 to $2,400 installed, against $300 for a flush. ` +
        `The tank's age is on the label, usually the first 4 digits of the serial number.`,
      ] },
    ],
  };

  const result = checkPost(good, slot);
  const linkFailures = result.failures.filter(f => f.includes('anchor'));
  assert.deepStrictEqual(linkFailures, [], `link checks failed: ${linkFailures.join('; ')}`);
});

test('checkPost CATCHES a post that dropped its money link', () => {
  // Under the old wrong signature this passed as clean, which is the bug.
  const { slot } = buildLinkPlan(campaignFrom(plan), 1);

  const bad = {
    title: 'A title',
    metaDescription: 'A description of reasonable length that says something.',
    sections: [{ heading: null, paragraphs: ['No tokens here at all.'] }],
  };

  const result = checkPost(bad, slot);
  assert.ok(
    result.failures.some(f => f.includes('money-page anchor')),
    `expected a money-anchor failure, got: ${result.failures.join('; ')}`
  );
});

test('tokens render to markup, placeholders to spans', () => {
  const { slot, targets } = buildLinkPlan(campaignFrom(plan), 0);

  const prose =
    `Some opening text. Past a point a {{money}}${slot.money.anchor}{{/money}} is the answer. ` +
    `People weigh up {{next}}${slot.nextAnchor}{{/next}} instead.`;

  const { html } = applyLinks(prose, targets);

  assert.ok(html.includes(`<a href="${TARGET.url}">`), 'money link not rendered');
  assert.ok(/<span data-il-link="slot-1">/.test(html), 'forward link is not a placeholder span');
  assert.ok(!html.includes('{{'), `unsubstituted token left in: ${html}`);
});

test('a placeholder becomes a real link once its target publishes', () => {
  const { slot, targets } = buildLinkPlan(campaignFrom(plan), 0);
  const prose = `People weigh up {{next}}${slot.nextAnchor}{{/next}} instead.`;
  const { html } = applyLinks(prose, targets);

  assert.deepStrictEqual(pendingIds(html), ['slot-1']);

  const live = activate(html, 'slot-1', 'https://example.com/blog/post-1/');
  assert.strictEqual(live.count, 1);
  assert.ok(live.html.includes('<a href="https://example.com/blog/post-1/">'));
  assert.ok(!live.html.includes('data-il-link'));
});

test('activating a topic the post does not reference changes nothing', () => {
  const { slot, targets } = buildLinkPlan(campaignFrom(plan), 0);
  const { html } = applyLinks(`Weighing up {{next}}${slot.nextAnchor}{{/next}}.`, targets);

  const result = activate(html, 'slot-99', 'https://example.com/other/');
  assert.strictEqual(result.count, 0, 'should not have touched anything');
  assert.strictEqual(result.html, html);
});

/* =====================================================================
 * slugify() — the URL a person reads before clicking it
 *
 * UNTESTED UNTIL 4 OCTOBER. `planCampaign.slugify` had no test of any kind;
 * the two `slugify` hits in the suite belong to `utils/slugify.js`, a
 * different function. The mid-word truncation below was live on a real post
 * and was found by reading the page, not by running anything.
 * ===================================================================== */

const REAL_TITLE =
  'What Information Do You Need for a Loan Application: A Complete Preparation Guide';

test('A LONG SLUG IS CUT AT A WORD BOUNDARY, NOT MID-WORD', () => {
  /* THE BUG, FROM THE LIVE SITE:
   *
   *   /what-information-do-you-need-for-a-loan-application-a-complete-prepara/
   *
   * "preparation" became "prepara" because .slice(0, 70) cut the 70th
   * character wherever it happened to fall. */
  const slug = slugify(REAL_TITLE);

  assert.ok(slug.length <= 70, `slug is ${slug.length} chars`);
  assert.ok(!slug.endsWith('-'), 'slug ends in a separator');
  assert.ok(!/prepara$/.test(slug), `still cutting mid-word: ${slug}`);

  const words = REAL_TITLE.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ');

  // Every segment must be a whole word from the title.
  const inTitle = new Set(words);
  for (const part of slug.split('-')) {
    assert.ok(inTitle.has(part), `"${part}" is not a whole word from the title`);
  }

  /* AND IT MUST BE THE LONGEST SUCH SLUG THAT FITS — the assertion the first
   * version of this test was missing, found by mutation.
   *
   * Replacing lastIndexOf('-') with indexOf('-') cuts at the FIRST dash, so
   * the whole slug becomes "what". That is under 70 characters, ends in no
   * separator, is not "prepara", and is a whole word from the title — it
   * satisfied every check above. A rule that only forbids cutting badly is
   * happy with cutting almost everything.
   *
   * The property is maximality: putting the next word back must overflow. */
  const kept = slug.split('-').length;
  assert.ok(kept > 1, `slug collapsed to a single word: ${slug}`);
  assert.ok(kept < words.length, 'nothing was trimmed — this title is meant to be too long');

  const withOneMore = `${slug}-${words[kept]}`;
  assert.ok(withOneMore.length > 70,
    `slug is shorter than it needed to be: "${slug}" (${slug.length}), and `
    + `"${withOneMore}" (${withOneMore.length}) would still have fitted`);
});

test('A CUT THAT LANDS ON THE JOIN KEEPS THE WHOLE WORD', () => {
  /* FOUND ON THE LIVE SITE, NOT HERE — and the test above is why it got out.
   *
   * That one asserts the slug is a MAXIMAL prefix: putting the next word back
   * must overflow. This title satisfies it and was still wrong, because the
   * question "could a word be added?" and the question "was a word removed
   * that did not need removing?" are not the same question.
   *
   * The 70th character of this title's slug is the separator itself, so
   * "financial" fitted exactly and nothing was broken. The trim ran anyway
   * and deleted it:
   *
   *   wanted  …-may-not-make-financial   (70)
   *   got     …-may-not-make             (60)
   *
   * Ten characters of a real title thrown away by an off-by-one. */
  const title = 'Benefits of Paying Off a Loan Early—and When It May Not Make Financial Sense';
  const slug = slugify(title);

  assert.strictEqual(slug, 'benefits-of-paying-off-a-loan-early-and-when-it-may-not-make-financial');
  assert.strictEqual(slug.length, 70, `dropped a word that fitted: ${slug}`);
});

test('a slug inside the limit keeps its last word', () => {
  /* THE MUTATION THIS EXISTS FOR. Trimming to the last dash unconditionally
   * passes the test above and silently deletes the final word of every short
   * slug — far more damaging than the bug being fixed, and invisible without
   * this case. */
  assert.strictEqual(slugify('Loan Terms Explained'), 'loan-terms-explained');
  assert.strictEqual(slugify('Hard Water'), 'hard-water');
  assert.strictEqual(slugify('Fees'), 'fees');

  // Exactly at the limit: 70 characters, nothing to trim.
  const exact = 'a'.repeat(35) + ' ' + 'b'.repeat(34);   // 35 + 1 + 34 = 70
  assert.strictEqual(slugify(exact).length, 70);
  assert.strictEqual(slugify(exact), 'a'.repeat(35) + '-' + 'b'.repeat(34));
});

test('one word longer than the limit keeps the hard cut', () => {
  /* No dash to back up to. A truncated slug beats an empty one — WordPress
   * given '' invents a slug from the post id. */
  const slug = slugify('x'.repeat(90));
  assert.strictEqual(slug.length, 70);
  assert.strictEqual(slug, 'x'.repeat(70));
});

test('the apostrophe rule still holds, and so does the rest', () => {
  /* Guarding the behaviour the docblock describes, which had no test either.
   * "leander-s-hard-water" is the fault it was written to stop. */
  assert.strictEqual(slugify("Leander's Hard Water"), 'leanders-hard-water');
  assert.strictEqual(slugify('Leander’s Hard Water'), 'leanders-hard-water');
  assert.strictEqual(slugify('  Spaced  Out  '), 'spaced-out');
  assert.strictEqual(slugify('APR, Fees & Interest'), 'apr-fees-interest');
  assert.strictEqual(slugify(''), '');
  assert.strictEqual(slugify(null), '');
  assert.strictEqual(slugify(undefined), '');
});

test('shortening a slug cannot silently collide', () => {
  /* TRIMMING TO A WORD BOUNDARY MAKES COLLISIONS MORE LIKELY, because two
   * titles that differed only in their truncated tail now produce the same
   * base. uniqueSlugs() already suffixes duplicates; this asserts the two
   * changes work together rather than assuming it. */
  const long = 'What Information Do You Need for a Loan Application A Complete';
  const slugs = uniqueSlugs([
    { title: long + ' Preparation Guide' },
    { title: long + ' Preparation Checklist' },
  ]);

  assert.strictEqual(slugs.length, 2);
  assert.notStrictEqual(slugs[0], slugs[1], 'two posts were given the same slug');
  assert.match(slugs[1], /-2$/);
});

/* ===================================================================== */

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);