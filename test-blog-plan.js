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

/* ===================================================================== */

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);