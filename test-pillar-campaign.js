// test-pillar-campaign.js
//
//   node test-pillar-campaign.js
//
// A campaign with NO MONEY PAGE.
//
// WHAT A PILLAR CAMPAIGN IS FOR. It writes the hub articles a later campaign
// will point at. On Edwin's own content blogs there is no business and nothing
// to sell, so the first run has nothing to link to — the posts have to link to
// each other, and then ordinary campaigns point at them afterwards.
//
//     campaign 1 (pillars)   post 1 <-> post 2 <-> post 3 <-> post 4
//                               ^                              |
//                               +------------------------------+
//
//     campaign 2 (a silo)    ten posts, every one -> post 1
//     campaign 3 (a silo)    ten posts, every one -> post 2
//
// PILLARS LINK SIDEWAYS; CHILDREN LINK UP; NOTHING LINKS DOWN. That is the
// whole reason this shape is cheap: a hub that listed its children would have
// to be rewritten every time a later campaign added more, because the list
// lives inside post_content as frozen HTML. Here every link is written once,
// when its own post is written, and is correct for ever.
//
// WHAT THIS SUITE IS REALLY GUARDING. The ring never consulted targetPage —
// buildLinkPlan builds prev/next from neighbouring slots — so the two halves
// were already independent and almost nothing had to be invented. What had to
// be found was every place that read the money page WITHOUT ASKING WHETHER
// THERE WAS ONE. There were three, all of them pushing or spreading a value
// while the prev and next beside them were behind an `if`:
//
//   writePost.js buildPrompt   throws before the model is called
//   writePost.js stubPost      throws in the offline harness and the tests
//   blogGenerator renderPayload  throws AFTER the post is written and charged
//
// The checker was already guarded. linkPlan.js's own comment says checkPost
// verifies the anchor "verbatim", which made the strict file look like the
// fragile one — A COMMENT DESCRIBING A STRICTNESS IS NOT THE SAME AS THE CODE
// BEING STRICT, and the files that said nothing on the subject were the ones
// that would have crashed. So every test below CALLS the function rather than
// reading it: source greps have missed four real bugs in this project.

const assert = require('assert');

const { planCampaign, findOrphans } = require('./utils/blog/planCampaign');
const { planForCampaign } = require('./utils/blog/campaignPlan');
const { buildLinkPlan } = require('./utils/blog/linkPlan');
const { buildPrompt, writePost, SYSTEM, SYSTEM_BLOG, systemFor } = require('./utils/blog/writePost');
const { checkPost } = require('./utils/blog/qualityCheck');
const { applyLinks, pendingIds } = require('./utils/blog/links');

/* THE RUNNER QUEUES AND AWAITS, AND THE FIRST VERSION DID NEITHER.
 *
 * writePost() is async even in stub mode, so the test that builds the stub
 * post was an `async` function. The runner called fn() without awaiting it:
 * the test printed "ok" the instant it was reached, every assertion inside it
 * resolved into a dropped promise, and the next test found the post it was
 * supposed to use still undefined.
 *
 * So the suite reported a pass for a test whose body had not run. A TEST THAT
 * CANNOT FAIL IS WORSE THAN NO TEST — it occupies the place where a real one
 * would go, and the suite's own count vouches for it.
 *
 * Sections are queued alongside the tests rather than printed at require
 * time, which they would otherwise all do before the first test ran. */
let passed = 0, failed = 0;
const queue = [];

function section(title) { queue.push({ title }); }
function test(name, fn) { queue.push({ name, fn }); }

async function run() {
  for (const item of queue) {
    if (item.title) { console.log(`\n${item.title}`); continue; }
    try {
      await item.fn();
      console.log(`  ok    ${item.name}`);
      passed++;
    } catch (err) {
      console.log(`  FAIL  ${item.name}\n        ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

/* The four pillars of a dog-training blog. No business, no town, no service —
 * which is the point: a content blog has none of them, and every one of those
 * absences used to be interpolated into a prompt as an empty string. */
const PILLARS = [
  { topic: 'Puppy Training: The First Eight Weeks', targetQuery: 'puppy training first weeks', linkPhrase: 'training a puppy in its first eight weeks' },
  { topic: 'Leash Pulling and Walking Problems', targetQuery: 'how to stop a dog pulling on the leash', linkPhrase: 'fixing leash and walking problems' },
  { topic: 'Barking, Biting and Chewing', targetQuery: 'why does my dog bark at everything', linkPhrase: 'common behaviour problems' },
  { topic: 'Training an Older or Rescue Dog', targetQuery: 'training an older rescue dog', linkPhrase: 'training an older or rescue dog' },
];

/* An ordinary campaign, carried through the whole suite as the control. Every
 * pillar assertion below has a twin proving the normal path is untouched —
 * because the cheapest way to "support" a pillar campaign would have been to
 * make the money link optional everywhere, and an optional money link on a
 * local business site is a post that quietly stops selling anything. */
const TARGET = {
  url: 'https://example.com/water-heater-repair-leander-tx.html',
  keyword: 'water heater repair',
  title: 'Water Heater Repair',
  intent: 'Someone whose water heater has stopped working and wants it fixed.',
};

const BUSINESS = { name: 'Hill Country Plumbing', type: 'plumber', location: 'Leander, TX' };

const SERVICE_TOPICS = [
  { topic: 'Why a pilot light keeps going out', targetQuery: 'water heater pilot light keeps going out', linkPhrase: 'a pilot light that will not stay lit' },
  { topic: 'The noise a tank makes before it fails', targetQuery: 'water heater making popping noise', linkPhrase: 'that popping sound from the tank' },
  { topic: 'What happens during a diagnosis visit', targetQuery: 'what happens water heater service call', linkPhrase: 'what a diagnosis visit involves' },
];

/* ===================================================================== */

section('Planning without a target page');

let pillarPlan;

test('A PILLAR CAMPAIGN PLANS WITH NO TARGET PAGE AT ALL', () => {
  // Not an empty object, not a URL of ''. Nothing. This is the call that
  // threw on three separate lines before today.
  pillarPlan = planForCampaign({
    topics: PILLARS,
    isPillar: true,
    schedule: { everyDays: 7, publishTime: '09:00', timezone: 'America/Chicago' },
  });

  assert.strictEqual(pillarPlan.slots.length, 4);
  assert.strictEqual(pillarPlan.isPillar, true);
});

test('its slots carry no money anchor, and the empty value is an empty STRING', () => {
  /* The schema defaults moneyAnchor to '' and buildLinkPlan reads it back at
   * generation time. Anything stored here that is not a real anchor is a
   * string that would be handed to the writer as one — so the absence has to
   * be the schema's own empty, not a placeholder phrase. */
  for (const s of pillarPlan.slots) {
    assert.strictEqual(s.moneyAnchor, '', `slot ${s.index} invented an anchor: ${s.moneyAnchor}`);
    assert.strictEqual(s.anchorReused, false);
    assert.ok(s.publishAt instanceof Date, `slot ${s.index} has no publishAt`);
  }
});

test('the anchor mix is EMPTY rather than zeroed', () => {
  /* { exact: 0, semantic: 0, … } is a mix that happens to be empty, which is
   * a different claim from "there is no mix" — and the one the UI would draw
   * a chart of. */
  assert.deepStrictEqual(pillarPlan.anchorSummary, {});
});

test('no cannibalisation is possible, so none is reported', () => {
  // There is no money keyword for a topic to compete with. compareQueries
  // skips the check when moneyTokens is empty rather than comparing against ''
  // and matching everything.
  assert.ok(
    !pillarPlan.conflicts.some(c => c.kind === 'cannibalises'),
    JSON.stringify(pillarPlan.conflicts)
  );
});

test('it is named after its first topic, not after a page it does not have', () => {
  // "Pillars — 4 posts" is indistinguishable from the next one in a list of
  // fifty.
  assert.ok(/Puppy Training/.test(pillarPlan.suggestedName), pillarPlan.suggestedName);
});

test('AN ORDINARY CAMPAIGN IS COMPLETELY UNCHANGED', () => {
  const normal = planForCampaign({
    targetPage: TARGET, topics: SERVICE_TOPICS, business: BUSINESS, schedule: {},
  });

  assert.strictEqual(normal.isPillar, false);
  assert.ok(/water heater repair/.test(normal.suggestedName), normal.suggestedName);

  for (const s of normal.slots) {
    assert.ok(s.moneyAnchor, `slot ${s.index} lost its money anchor`);
  }
  assert.ok(Object.keys(normal.anchorSummary).length > 0, 'the anchor mix went missing');
});

test('a campaign with no target page and no flag is still REFUSED', () => {
  /* THE FLAG IS THE WHOLE SAFEGUARD. Inferring "pillar" from a missing
   * targetPage would turn a client's forgotten field into a valid campaign
   * quietly missing a third of its links — a failure that surfaces months
   * later, as posts that never fed anything. */
  assert.throws(
    () => planForCampaign({ topics: SERVICE_TOPICS, business: BUSINESS, schedule: {} }),
    /targetPage\.url is required/
  );
});

test('A ONE-POST PILLAR CAMPAIGN IS REFUSED', () => {
  /* With no money page and no sibling it would have NO outbound links — and
   * it would pass every check, because each link assertion in qualityCheck is
   * conditional on the link having been asked for. Refused at planning time,
   * where it is free; the warning in checkPost is only a backstop. */
  assert.throws(
    () => planForCampaign({ topics: [PILLARS[0]], isPillar: true, schedule: {} }),
    /at least two posts/
  );
});

test('a one-post ORDINARY campaign is still allowed', () => {
  // It keeps its money link, so it is not linkless. The floor is specific to
  // the pillar shape and must not leak into the normal one.
  const one = planForCampaign({
    targetPage: TARGET, topics: [SERVICE_TOPICS[0]], business: BUSINESS, schedule: {},
  });
  assert.strictEqual(one.slots.length, 1);
  assert.ok(one.slots[0].moneyAnchor);
});

/* ===================================================================== */

section('The ring, which is all a pillar campaign has');

function pillarCampaign(plan, published = {}) {
  return {
    isPillar: true,
    // Deliberately absent, not {}. The live document will not have the
    // sub-document at all.
    site: { business: {} },
    slots: plan.slots.map(s => ({
      ...s,
      status: published[s.index] ? 'published' : 'pending',
      publishedUrl: published[s.index] || '',
      publishedTitle: published[s.index] ? `Post ${s.index}` : '',
    })),
  };
}

function serviceCampaign(plan) {
  return {
    targetPage: TARGET,
    site: { business: BUSINESS },
    slots: plan.slots.map(s => ({ ...s, status: 'pending', publishedUrl: '', publishedTitle: '' })),
  };
}

test('slot.money IS ABSENT, not an object with empty fields', () => {
  /* `if (slot.money)` is the guard in writePost and in qualityCheck. An
   * object of empty strings passes it and produces a link to ''. */
  const { slot } = buildLinkPlan(pillarCampaign(pillarPlan), 1);
  assert.strictEqual('money' in slot, false, 'the money key is still there');
});

test('targets.money is absent too, so no URL exists without an anchor', () => {
  // applyLinks pairs the two. A target with no anchor is a URL nothing points
  // at; an anchor with no target is a {{token}} left in the published text.
  const { targets } = buildLinkPlan(pillarCampaign(pillarPlan), 1);
  assert.strictEqual('money' in targets, false);
});

test('the ring itself is untouched — prev and next are both there', () => {
  const { slot } = buildLinkPlan(pillarCampaign(pillarPlan), 1);
  assert.strictEqual(slot.prevAnchor, 'training a puppy in its first eight weeks');
  assert.strictEqual(slot.nextAnchor, 'common behaviour problems');
});

test('the anchor is the linkPhrase, not the headline', () => {
  /* "...which is why Puppy Training: The First Eight Weeks matters so much"
   * reads like a table of contents fell into the paragraph. linkPhrase exists
   * precisely so it does not. */
  const { slot } = buildLinkPlan(pillarCampaign(pillarPlan), 1);
  assert.ok(!/Puppy Training:/.test(slot.prevAnchor), `got the headline: ${slot.prevAnchor}`);
});

test('pillar 1 has a forward link and no backward one', () => {
  const { slot } = buildLinkPlan(pillarCampaign(pillarPlan), 0);
  assert.strictEqual(slot.prevAnchor, undefined);
  assert.ok(slot.nextAnchor);
});

test('THE LAST PILLAR CLOSES THE RING BACK TO THE FIRST', () => {
  const { slot } = buildLinkPlan(pillarCampaign(pillarPlan), 3);
  assert.ok(slot.prevAnchor, 'no backward anchor');
  assert.strictEqual(slot.nextAnchor, 'training a puppy in its first eight weeks');
});

test('every pillar has at least one inbound link from a sibling', () => {
  // The ring guarantees it by construction; this proves it, and catches a
  // plan mangled by edits or drops.
  const raw = planCampaign({ topics: PILLARS, isPillar: true });
  assert.deepStrictEqual(findOrphans(raw), []);
});

test('a forward link to an unpublished pillar is still a placeholder', () => {
  // Removing the money link must not change how the OTHER two resolve.
  const { targets } = buildLinkPlan(pillarCampaign(pillarPlan), 0);
  assert.ok(targets.next.pendingId, 'expected a pendingId');
  assert.ok(!targets.next.url);
});

test('a forward link to an already-published pillar is live', () => {
  const c = pillarCampaign(pillarPlan, { 1: 'https://blog.example.com/leash-pulling/' });
  const { targets } = buildLinkPlan(c, 0);
  assert.strictEqual(targets.next.url, 'https://blog.example.com/leash-pulling/');
});

test('ctx.targetPage is NULL, not an object of empty strings', () => {
  /* buildPrompt reads targetPage.title into "It becomes a link to the X
   * page". Handing it '' would make that read succeed and produce "the page",
   * and would make every `if (ctx.targetPage)` downstream always pass. AN
   * EMPTY VALUE IS A CLAIM THAT THE VALUE EXISTS. */
  const { ctx } = buildLinkPlan(pillarCampaign(pillarPlan), 1);
  assert.strictEqual(ctx.targetPage, null);
  assert.deepStrictEqual(ctx.business.services, []);
});

test('AN ORDINARY SLOT STILL GETS ITS MONEY LINK', () => {
  const normal = planForCampaign({
    targetPage: TARGET, topics: SERVICE_TOPICS, business: BUSINESS, schedule: {},
  });
  const { slot, targets, ctx } = buildLinkPlan(serviceCampaign(normal), 1);

  assert.ok(slot.money && slot.money.anchor, 'the money anchor went missing');
  assert.strictEqual(slot.money.url, TARGET.url);
  assert.strictEqual(targets.money.url, TARGET.url);
  assert.strictEqual(ctx.targetPage.keyword, 'water heater repair');
});

/* ===================================================================== */

section('The writer, which is where it used to throw');

test('BUILDPROMPT DOES NOT THROW WITHOUT A MONEY PAGE', () => {
  /* The failure this whole suite exists for: the money instruction was pushed
   * unconditionally while prev and next below it were guarded, so this was
   * `TypeError: Cannot read properties of undefined (reading 'anchor')` —
   * thrown before the model is called, for every slot. */
  const { slot, ctx } = buildLinkPlan(pillarCampaign(pillarPlan), 1);
  const prompt = buildPrompt(slot, ctx);
  assert.ok(prompt.length > 500);
});

test('the prompt asks for no money link, and still asks for both ring links', () => {
  const { slot, ctx } = buildLinkPlan(pillarCampaign(pillarPlan), 1);
  const prompt = buildPrompt(slot, ctx);

  assert.ok(!/\{\{money\}\}/.test(prompt), 'it still asks for a money link');
  assert.ok(/\{\{prev\}\}fixing|\{\{prev\}\}training/.test(prompt), 'the backward link is missing');
  assert.ok(/\{\{next\}\}common behaviour problems/.test(prompt), 'the forward link is missing');
});

test('THE FIRST LINK OPENS THE POST; THE SECOND SITS IN THE MIDDLE', () => {
  /* Edwin's report, 3 October: both links were landing at the bottom, crowded.
   *
   * The three placement instructions were written when every post carried
   * three links — money opened, prev sat in the middle, next closed. Remove
   * the money link and the two that remain still asked for "a middle section"
   * and "the final section", so on a four-section post BOTH were in sections
   * 3 and 4 and the opening had nothing.
   *
   * Placement is now assigned by ORDER for a pillar post. */
  const { slot, ctx } = buildLinkPlan(pillarCampaign(pillarPlan), 1);
  const prompt = buildPrompt(slot, ctx);

  assert.ok(/PUT IT IN THE OPENING SECTION/.test(prompt),
    'no link is asked for in the opening section');
  assert.ok(/PUT IT AROUND THE THIRD PARAGRAPH/.test(prompt),
    'the second link is not placed in the middle');
  assert.ok(!/PUT IT IN THE FINAL SECTION/.test(prompt),
    'a pillar post is still being told to put a link in the final section');
});

test('the OPENING instruction attaches to the first link, not to a token name', () => {
  /* Slot 1 has both prev and next, so prev leads. The instruction must be on
   * prev's bullet and the middle one on next's — checked by slicing at the
   * {{next}} bullet rather than by searching the whole prompt, which would
   * pass with the two instructions swapped. */
  const { slot, ctx } = buildLinkPlan(pillarCampaign(pillarPlan), 1);
  const prompt = buildPrompt(slot, ctx);

  const atNext = prompt.indexOf('{{next}}');
  assert.ok(atNext > 0, 'the forward link is missing from the prompt');

  const before = prompt.slice(0, atNext);
  const after = prompt.slice(atNext);

  assert.ok(/PUT IT IN THE OPENING SECTION/.test(before),
    'the opening instruction is not on the backward link');
  assert.ok(/PUT IT AROUND THE THIRD PARAGRAPH/.test(after),
    'the middle instruction is not on the forward link');
});

test('A PILLAR POST WITH ONLY ONE LINK PUTS IT AT THE TOP', () => {
  /* Slot 0 has no backward link — the ring starts there. Its single forward
   * link must open the post rather than inherit the middle instruction, which
   * is what a rule keyed on the token name would have given it. */
  const { slot, ctx } = buildLinkPlan(pillarCampaign(pillarPlan), 0);
  assert.strictEqual(slot.prevAnchor, undefined, 'the fixture changed — slot 0 now has a prev');

  const prompt = buildPrompt(slot, ctx);

  assert.ok(/PUT IT IN THE OPENING SECTION/.test(prompt), 'the only link is not in the opening');
  assert.ok(!/PUT IT AROUND THE THIRD PARAGRAPH/.test(prompt),
    'a single link was given the middle instruction');
});

test('AN ORDINARY POST KEEPS ALL THREE POSITIONS, BYTE FOR BYTE', () => {
  /* The guard that matters. The cheap fix would have been to re-position every
   * campaign's links, and the three-link layout is correct, shipping, and what
   * every customer's posts use. */
  const normal = planForCampaign({
    targetPage: TARGET, topics: SERVICE_TOPICS, business: BUSINESS, schedule: {},
  });
  const { slot, ctx } = buildLinkPlan(serviceCampaign(normal), 1);
  const prompt = buildPrompt(slot, ctx);

  assert.ok(/PUT IT IN THE OPENING SECTION — the one before any subheading\./.test(prompt),
    'the money link lost its opening instruction');
  assert.ok(/PUT IT IN A MIDDLE SECTION — not the opening, not the last one\./.test(prompt),
    'the backward link lost its middle instruction');
  assert.ok(/PUT IT IN THE FINAL SECTION\./.test(prompt),
    'the forward link lost its closing instruction');
  assert.ok(!/PUT IT AROUND THE THIRD PARAGRAPH/.test(prompt),
    'the pillar instruction leaked into an ordinary post');
});

test('A POST WITH EVERY LINK BELOW THE FOLD IS WARNED ABOUT', () => {
  /* The check that did not exist. The only placement assertion asked where the
   * MONEY link went, and a pillar post has none — so the one post that needed
   * the check was the one it could not see. The crowding checks were blind
   * too: two links sitting politely in sections 3 and 4 share nothing. */
  const { slot } = buildLinkPlan(pillarCampaign(pillarPlan), 1);

  const bottomHeavy = {
    title: 'Everything at the bottom',
    metaDescription: 'Both links in the back half.',
    sections: [
      { heading: null, paragraphs: ['An opening with nothing to click.'] },
      { heading: 'Second', paragraphs: ['Still nothing here.'] },
      { heading: 'Third', paragraphs: [`Groundwork from {{prev}}${slot.prevAnchor}{{/prev}}.`] },
      { heading: 'Fourth', paragraphs: [`And then {{next}}${slot.nextAnchor}{{/next}}.`] },
    ],
  };

  const result = checkPost(bottomHeavy, slot);

  assert.ok(result.warnings.some(w => /below the fold/.test(w)),
    `no warning: ${JSON.stringify(result.warnings)}`);

  /* NOT a failure. blogGenerator retries on failure, a retry may land the
   * phrase somewhere just as reasonable, and a second model call to move a
   * phrase up two paragraphs is not worth the credit. */
  assert.ok(!result.codes.includes('links-crowded'),
    'nothing shares a paragraph here — crowding must not fire');
});

test('a post with a link in the opening raises no such warning', () => {
  const { slot } = buildLinkPlan(pillarCampaign(pillarPlan), 1);

  const wellPlaced = {
    title: 'A link up top',
    metaDescription: 'One opens, one in the middle.',
    sections: [
      { heading: null, paragraphs: [`Building on {{prev}}${slot.prevAnchor}{{/prev}}, here is the point.`] },
      { heading: 'Second', paragraphs: ['Some detail.'] },
      { heading: 'Third', paragraphs: [`Which leads to {{next}}${slot.nextAnchor}{{/next}}.`] },
    ],
  };

  const result = checkPost(wellPlaced, slot);

  assert.ok(!result.warnings.some(w => /below the fold/.test(w)),
    `warned about a well-placed post: ${JSON.stringify(result.warnings)}`);
});

test('THE BUSINESS BLOCK IS OMITTED, NOT RENDERED EMPTY', () => {
  /* Four labels with nothing after them is worse than no block: the model
   * reads it as a business whose name and town it is supposed to know and
   * cannot see, and invents one. */
  const { slot, ctx } = buildLinkPlan(pillarCampaign(pillarPlan), 1);
  const prompt = buildPrompt(slot, ctx);

  assert.ok(!/BUSINESS/.test(prompt), 'the empty business block is still there');
  assert.ok(!/Name: *\n/.test(prompt), 'an empty Name label survived');
});

test('A PILLAR POST IS WRITTEN TO THE BLOG BRIEF, NOT THE TRADE ONE', () => {
  /* The trade prompt opens "You are a working tradesperson writing for your
   * own customers." A pillar campaign has no business and no business block to
   * contradict it, so the model invents one: "in fifteen years on the job",
   * "every client who walks through the door". None of it is true, and none of
   * it is visible in the finished post — a trade article and a blog article
   * both come back as title, meta and sections. The only way to catch the
   * wrong voice is to check which brief was used. */
  const { slot, ctx } = buildLinkPlan(pillarCampaign(pillarPlan), 1);
  const prompt = buildPrompt(slot, ctx);

  assert.ok(!/working tradesperson/.test(prompt), 'the pillar post is being written as a tradesperson');
  assert.ok(/blog about a single subject/.test(prompt), 'the blog brief was not used');
});

test('the trade brief still refuses to invent experience — and the blog one goes further', () => {
  /* Removing the business removed what was keeping the model honest, so the
   * blog list is LONGER than the trade list, not shorter. These three are the
   * ones the trade prompt never needed. */
  assert.ok(/EXPERIENCE OF YOUR OWN/.test(SYSTEM_BLOG), 'nothing forbids invented experience');
  /* The prompt is a wrapped template literal, so this sentence spans a line
   * break. Matching it on one line failed against a prompt that says exactly
   * what it is supposed to say — the test's fault, not the prompt's. */
  assert.ok(/there is no "I"/.test(SYSTEM_BLOG), 'the no-first-person rule is gone');
  assert.ok(/A PLACE\./.test(SYSTEM_BLOG), 'nothing forbids inventing a town');
});

test('THE LOCALITY RULE IS NOT IN THE BLOG BRIEF', () => {
  /* "A paragraph that would still be true for a different trade in a different
   * town is a paragraph that should not exist" is right for a Leander plumber
   * and backwards here: a good article about training a dog SHOULD be true in
   * every town. Left in, it tells the model to delete its best paragraphs or
   * to fake a region. */
  assert.ok(/different town/.test(SYSTEM), 'the trade brief lost its locality rule');
  assert.ok(!/different town/.test(SYSTEM_BLOG), 'the locality rule leaked into the blog brief');
});

test('the blog brief never names a trade', () => {
  /* The trade version says, in as many words, "your plumber will tell you
   * whether this needs a permit".
   *
   * "customers" IS NOT ON THIS LIST, and the first version of the test banned
   * it. The blog brief says "You have no clients, no customers" — the word is
   * there precisely to forbid the thing, and a check that cannot tell an
   * assertion from its negation would have forced the rule out of the prompt
   * to keep itself green. Only words that can appear for one reason are
   * listed. */
  for (const word of ['plumber', 'tradesperson', 'kitchen']) {
    assert.ok(
      !new RegExp(`\\b${word}\\b`, 'i').test(SYSTEM_BLOG),
      `the blog brief says "${word}"`
    );
  }
});

test('AN ORDINARY POST IS UNTOUCHED — same trade brief as before', () => {
  /* The guard that matters most. The cheap way to support a blog voice would
   * have been to soften the one prompt every customer's posts come out of. */
  const normal = planForCampaign({
    targetPage: TARGET, topics: SERVICE_TOPICS, business: BUSINESS, schedule: {},
  });
  const { slot, ctx } = buildLinkPlan(serviceCampaign(normal), 1);
  const prompt = buildPrompt(slot, ctx);

  assert.ok(/working tradesperson/.test(prompt), 'an ordinary post lost the trade brief');
  assert.ok(!/blog about a single subject/.test(prompt), 'the blog brief leaked into a normal campaign');
});

test('the choice reads the FLAG, not the absent target page', () => {
  /* "There is no money page" and "there is no business behind this" are
   * different claims that coincide today. Inferring the voice from
   * targetPage === null would work right up until they stop coinciding, and
   * then every post would get the wrong voice with nothing to say so. */
  assert.strictEqual(systemFor({ isPillar: true, targetPage: null }), SYSTEM_BLOG);
  assert.strictEqual(systemFor({ isPillar: false, targetPage: null }), SYSTEM,
    'the voice was chosen from the missing page rather than the flag');
  assert.strictEqual(systemFor({}), SYSTEM, 'an unflagged campaign did not get the trade brief');
  assert.strictEqual(systemFor(undefined), SYSTEM, 'no ctx at all threw or chose the blog brief');
});

test('buildLinkPlan puts the flag on ctx at all', () => {
  // The link between the two files. Without it systemFor() reads undefined on
  // every call and silently always answers "trade".
  const { ctx } = buildLinkPlan(pillarCampaign(pillarPlan), 1);
  assert.strictEqual(ctx.isPillar, true);

  const normal = planForCampaign({
    targetPage: TARGET, topics: SERVICE_TOPICS, business: BUSINESS, schedule: {},
  });
  assert.strictEqual(buildLinkPlan(serviceCampaign(normal), 1).ctx.isPillar, false);
});

test('an ordinary prompt keeps its money link AND its business block', () => {
  const normal = planForCampaign({
    targetPage: TARGET, topics: SERVICE_TOPICS, business: BUSINESS, schedule: {},
  });
  const { slot, ctx } = buildLinkPlan(serviceCampaign(normal), 1);
  const prompt = buildPrompt(slot, ctx);

  assert.ok(/\{\{money\}\}/.test(prompt), 'the money link vanished from a normal campaign');
  assert.ok(/BUSINESS/.test(prompt), 'the business block vanished');
  assert.ok(/Hill Country Plumbing/.test(prompt));
  assert.ok(/Water Heater Repair/.test(prompt), 'the target page title is not in the prompt');
});

/* ===================================================================== */

section('The offline stub, and the tokens that reach WordPress');

let pillarPost;

test('THE STUB DOES NOT THROW EITHER, and names no town it does not have', async () => {
  const { slot, ctx } = buildLinkPlan(pillarCampaign(pillarPlan), 1);
  pillarPost = await writePost(slot, ctx, { stub: true });

  const text = pillarPost.sections.flatMap(s => s.paragraphs).join('\n');

  assert.ok(!/\{\{money\}\}/.test(text), 'the stub emitted a money token');
  assert.ok(/\{\{prev\}\}/.test(text), 'the stub lost the backward token');
  assert.ok(/\{\{next\}\}/.test(text), 'the stub lost the forward token');

  // "Most homeowners in  only think about this" reads as a bug in the stub,
  // and the whole point of the stub is that a failure in it is unmistakably
  // about the plumbing.
  assert.ok(!/ in {2,}/.test(text), `an empty town was interpolated: ${text}`);
  assert.ok(!/undefined/.test(text), 'something undefined reached the text');
  assert.ok(!/undefined/.test(pillarPost.metaDescription), pillarPost.metaDescription);
});

test('substitution leaves no stray token and no empty href', () => {
  const { targets } = buildLinkPlan(pillarCampaign(pillarPlan), 1);
  const source = pillarPost.sections.flatMap(s => s.paragraphs).join('\n');
  const { html, missing } = applyLinks(source, targets);

  assert.ok(!/\{\{/.test(html), `a token survived: ${html}`);
  assert.ok(!/href=""/.test(html), 'an empty href was written');
  assert.ok(/data-il-link="slot-2"/.test(html), 'the forward placeholder is missing');
  assert.deepStrictEqual(missing, [], 'a target had no anchor to attach to');

  /* BOTH ring links are placeholders here, and I expected one. Nothing in
   * this fixture is published, and buildLinkPlan re-checks that at generation
   * time rather than trusting the plan — so the BACKWARD link is pending too,
   * exactly as its comment says happens when a slot is generated out of
   * order. The assertion was wrong, not the code. */
  assert.deepStrictEqual(pendingIds(html), ['slot-0', 'slot-2']);
});

test('once the earlier pillar is published, its link is live and only the forward one waits', () => {
  // The same slot against a published predecessor — which is the normal case,
  // and the one the assertion above was carelessly written for.
  const c = pillarCampaign(pillarPlan, { 0: 'https://blog.example.com/puppy-training/' });
  const { targets } = buildLinkPlan(c, 1);
  const source = pillarPost.sections.flatMap(s => s.paragraphs).join('\n');
  const { html } = applyLinks(source, targets);

  assert.ok(/href="https:\/\/blog\.example\.com\/puppy-training\/"/.test(html),
    'the backward link did not become real');
  assert.deepStrictEqual(pendingIds(html), ['slot-2']);
});

test('A STRAY MONEY TOKEN WOULD BE UNWRAPPED, NOT LEFT ON THE PAGE', () => {
  /* The last line of defence, and it was already there: applyLinks unwraps a
   * token it has no target for rather than passing it through. So if a pillar
   * prompt ever drifted and the model emitted {{money}} anyway, the reader
   * sees the words and not the braces.
   *
   * Asserted because this is the behaviour that makes removing the money
   * TARGET safe on its own — without it, every change above would need the
   * prompt to be perfect to avoid shipping literal braces to a live site. */
  const { targets } = buildLinkPlan(pillarCampaign(pillarPlan), 1);
  const { html } = applyLinks(
    'Past a certain point a {{money}}water heater repair{{/money}} is the next step.',
    targets
  );

  assert.ok(!/\{\{/.test(html), `braces reached the page: ${html}`);
  assert.ok(/water heater repair/.test(html), 'the words were dropped as well as the token');
  assert.ok(!/<a /.test(html), 'it invented a link with no target');
});

test('CHECKPOST PASSES A PILLAR POST — it does not demand a money anchor', () => {
  /* The checker was ALREADY guarded, which is the thing I got wrong out loud
   * before reading it: I predicted every pillar post would fail here. The
   * assertion is kept because "already correct" is a fact that can stop being
   * true in one careless edit. */
  const { slot } = buildLinkPlan(pillarCampaign(pillarPlan), 1);

  /* The tokens are written in by hand from the slot's OWN anchors, rather
   * than search-and-replaced into finished prose. The first version of this
   * test did the latter and failed for its own reasons — String.replace with
   * a string pattern hits the first occurrence only, and reassembling the
   * paragraphs afterwards put the token in a different one. A TEST THAT HAS
   * TO MANIPULATE ITS OWN FIXTURE IS TESTING THE MANIPULATION. */
  const post = {
    title: 'Leash pulling, and the fortnight it takes to fix',
    metaDescription: 'What pulling actually is, and the order to fix it in.',
    sections: [
      { heading: null, paragraphs: [
        'A dog pulls because pulling works. Six feet of lead, forty pounds of dog, and the handler follows — that is the whole lesson, usually learned within three walks of bringing the dog home.',
        'The fix takes about two weeks of ten-minute sessions, and the first week looks like no progress at all. A front-clip harness costs twenty to thirty dollars and makes the fortnight survivable.',
      ] },
      { heading: 'Start in the hallway', paragraphs: [
        'Six feet of indoor floor is enough. Lead on, one step, stop the moment the line goes tight, wait for the dog to put slack back in it, step again. Twenty repetitions is a session.',
        `Most of this is deciding, before you open the door, that you are willing to stand still for four minutes. Half of it is groundwork from {{prev}}${slot.prevAnchor}{{/prev}}, and the same checks apply here.`,
        'Puppies learn it in days; an adult dog with three years of practice takes nearer a month. The mechanism is identical and the timescale is the only thing that moves.',
      ] },
      { heading: 'When it is not the lead', paragraphs: [
        'A dog that lunges at other dogs is not pulling, it is reacting, and the two look the same from behind. Distance is the tell: a reactive dog pulls hardest at thirty feet and settles at a hundred.',
        `This is often where people start weighing up {{next}}${slot.nextAnchor}{{/next}} instead of another month of lead work.`,
      ] },
      { heading: 'What to expect by week three', paragraphs: [
        'Slack line for the first two hundred yards, tightening near the park. That is normal, and it is the last part to go.',
        'Ten minutes a day beats an hour on Sunday. The dog is learning a habit, and habits are built out of repetitions rather than hours.',
      ] },
    ],
  };

  const result = checkPost(post, slot);

  assert.ok(!result.codes.includes('money-link'),
    `it demanded a money link: ${result.failures.join(' · ')}`);
  assert.ok(!result.codes.includes('prev-link'), 'the backward anchor was not found');
  assert.ok(!result.codes.includes('next-link'), 'the forward anchor was not found');
});

test('A POST ASKED FOR NO LINKS AT ALL IS WARNED ABOUT, not failed', () => {
  /* Every link assertion is conditional, which is right per link and wrong in
   * aggregate: not one of them asks whether anything was promised.
   *
   * A WARNING AND NOT A FAILURE, DELIBERATELY. blogGenerator retries on a
   * failure, and no rewrite can add a link the slot never asked for — a
   * failure code a retry cannot fix turns one wasted model call into three. */
  const result = checkPost({
    title: 'A post with nothing pointing out of it',
    metaDescription: 'Short, and deliberately linkless.',
    sections: [{ heading: null, paragraphs: ['Nothing here links anywhere.'] }],
  }, {});

  assert.ok(
    result.warnings.some(w => /no links at all/.test(w)),
    `no warning was raised: ${JSON.stringify(result.warnings)}`
  );
  assert.ok(!result.codes.includes('no-links'), 'it was raised as a failure, which a retry cannot fix');
});

test('a slot WITH links raises no such warning', () => {
  const { slot } = buildLinkPlan(pillarCampaign(pillarPlan), 1);
  const result = checkPost({
    title: 'Something',
    metaDescription: 'Something else.',
    sections: [{ heading: null, paragraphs: ['Text.'] }],
  }, slot);

  assert.ok(!result.warnings.some(w => /no links at all/.test(w)),
    'warned about a slot that asked for two links');
});

/* ===================================================================== */

section('The payload WordPress receives');

/* blogGenerator requires the mongoose models, so these two run where mongoose
 * is installed and are SAID OUT LOUD where it is not. A check that did not
 * happen must never be mistaken for one that passed — the same reason
 * deploy.sh announces a missing php rather than skipping quietly. */
let generator = null;
try {
  generator = require('./utils/blogGenerator');
} catch (err) {
  generator = null;
}

if (!generator) {
  section('  SKIPPED — mongoose is not installed here, so renderPayload was NOT exercised.');
} else {
  test('RENDERPAYLOAD OMITS targets.money — the read that would have thrown AFTER paying', () => {
    /* The third unconditional money read, and the worst placed: the slot is
     * written, the credits are taken, and then the payload that carries it to
     * WordPress cannot be built. The two in writePost at least fail before
     * spending anything. */
    const { slot, targets } = buildLinkPlan(pillarCampaign(pillarPlan), 1);
    const payload = generator.renderPayload(pillarPost, slot, targets);

    assert.strictEqual('money' in payload.targets, false, 'a money target was sent');
    assert.ok(payload.targets.prev, 'the backward target went missing');
    assert.ok(payload.targets.next, 'the forward target went missing');
    assert.ok(payload.targets.next.pending_id, 'the forward target lost its pending_id');
  });

  test('an ordinary payload still carries its money target', () => {
    const normal = planForCampaign({
      targetPage: TARGET, topics: SERVICE_TOPICS, business: BUSINESS, schedule: {},
    });
    const { slot, ctx, targets } = buildLinkPlan(serviceCampaign(normal), 1);
    const post = require('./utils/blog/writePost');
    const stub = post.writePost(slot, ctx, { stub: true });

    return Promise.resolve(stub).then(p => {
      const payload = generator.renderPayload(p, slot, targets);
      assert.strictEqual(payload.targets.money.url, TARGET.url);
    });
  });

  test('THE SLUG COMES FROM THE PUBLISHED TITLE, NOT THE TOPIC', () => {
    /* Found on a live post of Edwin's, 7 October:
     *
     *   topic  Conditional Approval Can Still Leave a Business Loan Unfunded
     *   title  Conditional Approval for a Business Loan: What the Meaning Is
     *          Before Funding
     *   url    /conditional-approval-can-still-leave-a-business-loan-unfunded/
     *
     * Two headlines for one post, and the URL — the part a reader sees before
     * clicking, and the part that cannot be changed afterwards — recorded the
     * one nobody published. The slot's slug is cut at PLAN time from the topic
     * the owner ticked; the title is written hours later, by the model.
     *
     * BOTH HALVES ARE ASSERTED. A check that only looked for the title's words
     * would also pass on a slug that had merely grown longer.
     *
     * THE SLOT IS THE CAMPAIGN'S OWN, NOT buildLinkPlan's. My first version of
     * this test passed the one buildLinkPlan returns, and that object has no
     * `slug` AT ALL — it is reshaped down to ten fields for the writer. So the
     * assertion that the new slug differs from the old one compared against
     * `undefined` and could never have failed, and the fallback test below
     * reported the fixture as broken, which is how this was found.
     *
     * writeOneSlot({ campaign, slot }) receives the stored slot, which is the
     * one carrying the plan-time slug — and that is why the live URLs were
     * topic-shaped rather than empty. */
    const campaign = pillarCampaign(pillarPlan);
    const { targets } = buildLinkPlan(campaign, 1);
    const slot = campaign.slots[1];

    assert.ok(slot.slug, 'the stored slot has no slug — this fixture proves nothing');

    const payload = generator.renderPayload({
      ...pillarPost,
      title: 'Conditional Approval for a Business Loan: What the Meaning Is Before Funding',
    }, slot, targets);

    assert.match(payload.slug, /^conditional-approval-for-a-business-loan-what-the-meaning/);
    assert.notStrictEqual(payload.slug, slot.slug,
      'the payload still carries the plan-time slug');
  });

  test('a title that slugifies to nothing keeps the plan slug', () => {
    /* An empty post_name makes WordPress invent one from the post id, which is
     * the worst URL on offer. Unlikely, and the fallback costs one `||`. */
    const campaign = pillarCampaign(pillarPlan);
    const { targets } = buildLinkPlan(campaign, 1);
    const slot = campaign.slots[1];

    const payload = generator.renderPayload({ ...pillarPost, title: '—  ―' }, slot, targets);

    assert.ok(slot.slug, 'the stored slot has no slug — this fixture proves nothing');
    assert.strictEqual(payload.slug, slot.slug);
  });
}

/* ===================================================================== */

section('The model');

let BlogCampaign = null;
try {
  BlogCampaign = require('./models/BlogCampaign');
} catch (err) {
  BlogCampaign = null;
}

if (!BlogCampaign) {
  section('  SKIPPED — mongoose is not installed here, so the schema was NOT exercised.');
} else {
  const { Types } = require('mongoose');

  function campaignDoc(extra) {
    return new BlogCampaign({
      user: new Types.ObjectId(),
      site: new Types.ObjectId(),
      slots: [{ index: 0, topic: 'A topic' }, { index: 1, topic: 'Another' }],
      ...extra,
    });
  }

  test('A PILLAR CAMPAIGN VALIDATES WITH NO targetPage', () => {
    // `required: true` is what used to make the absence unsayable — the model
    // refused the document before any route could decide whether it was a
    // mistake.
    const err = campaignDoc({ isPillar: true }).validateSync();
    assert.strictEqual(err, undefined, err && err.message);
  });

  test('AN ORDINARY CAMPAIGN WITHOUT A targetPage IS STILL REFUSED', () => {
    // The guard that must survive making the field optional.
    const err = campaignDoc({}).validateSync();
    assert.ok(err, 'a campaign with no target page validated');
    assert.ok(err.errors['targetPage.url'], 'targetPage.url is no longer required');
    assert.ok(err.errors['targetPage.keyword'], 'targetPage.keyword is no longer required');
  });

  test('isPillar defaults to false, so every existing campaign keeps its money link', () => {
    /* ABSENT MEANS ORDINARY. Every campaign in the database predates this
     * field, and a default of true would silently strip the money link from
     * all of them. */
    const doc = campaignDoc({ targetPage: { url: 'https://x.test/p', keyword: 'k' } });
    assert.strictEqual(doc.isPillar, false);
    assert.strictEqual(doc.validateSync(), undefined);
  });
}

/* =====================================================================
 * A ring of two — 6 October
 *
 * The ring rule is "link to the one behind you, and the last closes back to
 * the first". Right for three or more. At exactly two it hands post 1 a prev
 * of slot 0 AND a next of slot 0, because the post behind it and the post it
 * closes the ring to are the same post — two links, one destination, both in
 * the same article.
 *
 * Edwin planned two pillars and found the second one linking back to the
 * first twice. Nothing caught it because the fixtures all have three or four
 * slots, and a rule that is right everywhere except its smallest case passes
 * every test written against the normal case.
 * ================================================================== */

section('A ring of two is a pair');

const PAIR = [
  { topic: 'Can You Apply for a Loan Without Being a Citizen',
    targetQuery: 'loan without us citizenship',
    linkPhrase: 'applying for a loan as a non-citizen' },
  { topic: 'How Soon Can You Apply After Becoming a Citizen',
    targetQuery: 'loan after becoming a us citizen',
    linkPhrase: 'a new citizen loan application' },
];

let pairPlan;

test('a two-post pillar campaign plans', () => {
  pairPlan = planForCampaign({
    topics: PAIR,
    isPillar: true,
    schedule: { everyDays: 1, publishTime: '09:00', timezone: 'America/Chicago' },
  });

  assert.strictEqual(pairPlan.slots.length, 2);
});

test('THE SECOND POST LINKS BACK ONCE, NOT TWICE', () => {
  /* THE BUG, as Edwin found it live. Both anchors pointed at post 0 and the
   * article carried two links to the same URL. */
  const { slot } = buildLinkPlan(pillarCampaign(pairPlan, { 0: 'https://x/one/' }), 1);

  assert.strictEqual(slot.prevAnchor, 'applying for a loan as a non-citizen',
    'the backward link to the first post is gone');
  /* ABSENT, not null — the same rule slot.money follows a few cases up.
   * writePost and qualityCheck both ask `if (slot.nextAnchor)`, and an absent
   * key is what makes that guard mean something. */
  assert.strictEqual('nextAnchor' in slot, false,
    'the second post still links forward as well as back — two links, one destination');
});

test('THE FIRST POST LINKS FORWARD ONCE', () => {
  /* The other half of the pair. Post 0 is written before post 1 exists, so it
   * takes the FORWARD link — the one allowed to be a placeholder until its
   * target publishes. Give it the backward link instead and it points at
   * nothing. */
  const { slot } = buildLinkPlan(pillarCampaign(pairPlan), 0);

  assert.strictEqual(slot.nextAnchor, 'a new citizen loan application',
    'the first post has no link to its partner at all');
  assert.strictEqual('prevAnchor' in slot, false,
    'the first post links backward to something that does not exist');
});

test('the pair points at each other, and at nothing else', () => {
  /* Stated as the whole shape rather than two separate facts, because "one
   * link each" is the thing being asked for and either assertion alone can
   * hold while the pair is still wrong. */
  const campaign = pillarCampaign(pairPlan, { 0: 'https://x/one/', 1: 'https://x/two/' });

  const first  = buildLinkPlan(campaign, 0).slot;
  const second = buildLinkPlan(campaign, 1).slot;

  const linksOf = s => [s.prevAnchor, s.nextAnchor].filter(Boolean);

  assert.strictEqual(linksOf(first).length, 1, `post 0 has ${linksOf(first).length} ring links`);
  assert.strictEqual(linksOf(second).length, 1, `post 1 has ${linksOf(second).length} ring links`);
  assert.strictEqual('money' in first, false, 'a pillar grew a money link');
});

test('THREE OR MORE IS UNCHANGED — the last still closes the ring', () => {
  /* The fix must not be a special case that leaked. In a ring of four, post 3
   * links back to post 2 and forward to post 0, and those are different
   * posts — so it keeps both, exactly as before. */
  const { slot } = buildLinkPlan(pillarCampaign(pillarPlan), 3);

  assert.strictEqual(slot.prevAnchor, 'common behaviour problems');
  assert.strictEqual(slot.nextAnchor, 'training a puppy in its first eight weeks',
    'the last post no longer closes the ring back to the first');
});

test('a one-post campaign still has no ring at all', () => {
  /* The n < 2 branch, which the pair case sits directly above and could
   * plausibly have swallowed.
   *
   * A SILO campaign, not a pillar one: planCampaign refuses a single-post
   * pillar outright ("one would have no links at all"), which is the right
   * rule and means the only way to reach this branch is an ordinary campaign
   * with one post. It still has its money link; it just has no ring. */
  const solo = planForCampaign({
    topics: [SERVICE_TOPICS[0]],
    targetPage: TARGET,
    business: BUSINESS,
    schedule: { everyDays: 1, publishTime: '09:00', timezone: 'America/Chicago' },
  });

  const { slot } = buildLinkPlan(serviceCampaign(solo), 0);

  assert.strictEqual('prevAnchor' in slot, false);
  assert.strictEqual('nextAnchor' in slot, false);
  assert.ok(slot.money, 'a single-post campaign lost its money link too');
});

/* ===================================================================== */

run();
