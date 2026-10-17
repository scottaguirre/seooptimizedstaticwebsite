// test-plan-contract.js
//
// What /api/blog/plan promises the WordPress plugin.
//
// WHY THIS EXISTS, AND WHY IT EXISTS *BEFORE* ANYTHING MOVES
//
// The handler behind /api/blog/plan is about 215 lines: it validates the
// request, looks up anchors used by earlier campaigns, refreshes the stored
// business details, plans the links, refuses cannibalising topics, creates
// the draft campaign and quotes the credits.
//
// A second caller is coming. The Cloudflare blogs have no WordPress and no
// plugin, so the screen that plans their campaigns will live on our own site
// — and it needs every one of those 215 lines. The choice is to copy them or
// to move them somewhere both callers can reach.
//
// Copying is how two versions of one decision end up disagreeing. So they
// move. And moving them is the dangerous part, because:
//
//   NOTHING TESTED THAT HANDLER. Checked rather than assumed, on 17 October.
//   test-blog-plan.js exercises planForCampaign — the planner this handler
//   calls — not the handler. test-blog-api.js covers only the signature
//   scheme, and is not even in deploy.sh. The 215 lines about to be moved had
//   no coverage at all.
//
// WHAT BREAKING IT WOULD LOOK LIKE
//
// Not an error. wp-admin reads about ten named fields out of the answer: the
// slot list it renders, the quote it prints on the approve button, the credit
// balance it compares against. Drop one in the move and the screen shows a
// wrong price, or an empty campaign, and says nothing. Seven live sites use
// this path today.
//
// So this file pins the CURRENT behaviour. It was written and made to pass
// against the handler as it stood, untouched. If the extraction changes
// anything the plugin can see, this fails before a deploy can happen.
//
// IT CALLS THE REAL HANDLER. Not a copy of it, not a description of it — the
// function Express would call, pulled off the router, with the authentication
// and the rate limiter skipped because neither is what is being pinned here.
//
//   node test-plan-contract.js

const assert = require('assert');

const router = require('./routes/blogApiRoute');
const BlogSite = require('./models/BlogSite');
const BlogCampaign = require('./models/BlogCampaign');
const User = require('./models/User');

let passed = 0, failed = 0;

/* Every test and every heading, collected and run in order at the end. */
const queue = [];

function testAsync(name, fn) {
  return fn()
    .then(() => { console.log(`  ok    ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}
/* Queued like the tests, not printed as the file is read.
 *
 * Everything here is async and runs at the end, so a section() that printed
 * immediately put every heading at the top of the output and every result
 * underneath, in one undifferentiated list. */
function section(n) { queue.push(async () => console.log(`\n${n}\n`)); }

/* Collected and run in order at the end.
 *
 * A sync runner given an async function calls it, receives a promise and
 * discards it — so the test prints "ok" without having asserted anything.
 * This project has shipped that mistake before. */
function test(name, fn) { queue.push(() => testAsync(name, fn)); }

/* ------------------------------------------------------------------------
 * The real handler, off the real router
 * --------------------------------------------------------------------- */

function handlerFor(path) {
  const layer = router.stack.find(l => l.route && l.route.path === path);
  assert.ok(layer, `${path} is not on the router any more`);

  /* The LAST handler in the chain. The ones before it are the rate limiter
   * and requireSite, and neither is what this file is about: the contract
   * being pinned is what the handler answers once a request has already been
   * accepted. */
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

const plan = handlerFor('/api/blog/plan');

/* ------------------------------------------------------------------------
 * Just enough database
 *
 * Every stub records what it was asked, because several of the things this
 * handler does leave no trace in the response — refreshing the business
 * name, looking up prior anchors — and those are exactly the steps a careless
 * move would drop without anything failing.
 * --------------------------------------------------------------------- */

const SITE_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f1f77bcf86cd799439022';

let calls;

function install({ credits = 10000 } = {}) {
  calls = { priorLookup: null, businessSaved: null, created: null };

  BlogCampaign.find = (where) => {
    calls.priorLookup = where;
    return { select: () => ({ lean: async () => [] }) };
  };

  BlogCampaign.create = async (doc) => {
    calls.created = doc;

    /* AN OBJECT WITH toString(), NOT A STRING. Mongo ids are objects, and a
     * fixture that hands back a string makes String(campaign._id) a no-op —
     * so a move that dropped the conversion would pass here and serialise as
     * {"buffer":{...}} in front of PHP. Found by mutation. */
    return Object.assign({ _id: { toString: () => '507f1f77bcf86cd799439033' } }, doc);
  };

  BlogSite.updateOne = async (where, update) => {
    calls.businessSaved = update;
    return { modifiedCount: 1 };
  };

  User.findById = () => ({ lean: async () => ({ _id: USER_ID, credits }) });
}

function site(over = {}) {
  return Object.assign({
    _id: SITE_ID,
    user: USER_ID,
    target: 'wordpress',
    siteUrl: 'leanderwaterheaters.com',
    business: { name: 'Leander Water Heaters', type: 'plumber', location: 'Leander, TX', phone: '512-555-0199' },
  }, over);
}

/** Four topics, far enough apart not to trip the cannibalisation check. */
function topics() {
  return [
    { topic: 'Signs your water heater is about to fail', targetQuery: 'water heater failing signs' },
    { topic: 'What water heater repair costs in Central Texas', targetQuery: 'water heater repair cost' },
    { topic: 'Tankless versus tank water heaters for a Texas home', targetQuery: 'tankless vs tank water heater' },
    { topic: 'Why hot water runs out faster than it used to', targetQuery: 'hot water runs out quickly' },
  ];
}

function body(over = {}) {
  return Object.assign({
    targetPage: { url: 'https://leanderwaterheaters.com/water-heater-repair/', keyword: 'water heater repair leander' },
    topics: topics(),
    schedule: { startDate: '2026-11-03', gapDays: 7, hour: 9 },
    name: 'Autumn water heaters',
  }, over);
}

/** Run the handler and hand back what it answered. */
async function run(reqOver = {}) {
  const captured = { status: 200, json: null };

  const req = Object.assign({
    id: 'req-contract',
    site: site(),
    body: body(),
  }, reqOver);

  const res = {
    status(code) { captured.status = code; return this; },
    json(payload) { captured.json = payload; return this; },
  };

  await plan(req, res);
  return captured;
}

/* ======================================================================= */

section('THE ANSWER THE PLUGIN READS');

test('THE KEY SET IS EXACTLY THIS', async () => {
  /* THE WHOLE POINT OF THE FILE. wp-admin reads these by name. An extra key
   * is harmless; a MISSING one is a blank screen with no error, and a
   * renamed one is the same thing.
   *
   * deepStrictEqual on the sorted list rather than a series of `in` checks,
   * so a key that disappears fails here instead of somewhere downstream in
   * three weeks. */
  install();
  const { status, json } = await run();

  assert.strictEqual(status, 200, `the handler refused the request: ${JSON.stringify(json)}`);

  assert.deepStrictEqual(Object.keys(json).sort(), [
    'anchorSummary',
    'campaignId',
    'creditsAvailable',
    'enoughCredits',
    'isPillar',
    'quote',
    'schedule',
    'slots',
    'status',
    'warnings',
  ]);
});

test('and each slot carries exactly these five fields', async () => {
  /* The slot list is what wp-admin renders as the campaign table. It is
   * deliberately NOT the whole stored slot — the anchors and the link plan
   * stay on the server — so a move that started returning the raw slot would
   * leak the plan into a screen that was never designed to show it. */
  install();
  const { json } = await run();

  assert.strictEqual(json.slots.length, 4);

  json.slots.forEach(slot => {
    assert.deepStrictEqual(Object.keys(slot).sort(),
      ['index', 'publishAt', 'status', 'targetQuery', 'topic']);
  });

  assert.strictEqual(json.slots[0].index, 0);
  assert.strictEqual(json.slots[0].topic, topics()[0].topic);
});

test('A STANDARD CAMPAIGN STORES ITS TARGET PAGE', async () => {
  /* FOUND BY MUTATION. Only the pillar case was checked — that the target
   * page is ABSENT — so deleting the branch that writes it passed every
   * assertion. The campaign would then have been planned against a money
   * page it did not record, and every later plan for the same page would
   * have found no prior anchors to avoid repeating. */
  install();
  await run();

  assert.deepStrictEqual(calls.created.targetPage, {
    url: body().targetPage.url,
    keyword: body().targetPage.keyword,
    intent: '',
  });
});

test('THE CAMPAIGN IS CREATED AS A DRAFT, NOT STARTED', async () => {
  /* Planning costs nothing; approving costs a lot. If a move ever made this
   * active on creation, the next step would charge without anyone saying
   * yes. */
  install();
  const { json } = await run();

  assert.strictEqual(json.status, 'draft');
  assert.strictEqual(calls.created.status, 'draft');
});

test('the quote is the whole campaign, priced before approval', async () => {
  install({ credits: 10000 });
  const { json } = await run();

  assert.strictEqual(typeof json.quote.total, 'number');
  assert.ok(json.quote.total > 0, 'the campaign was quoted at nothing');
  assert.strictEqual(json.creditsAvailable, 10000);
  assert.strictEqual(json.enoughCredits, true);
});

test('AND IT SAYS SO WHEN THE CREDITS ARE NOT THERE', async () => {
  /* wp-admin prints the whole cost before the button, rather than letting a
   * batch stop half way. Half a ring is worse than no ring. */
  install({ credits: 1 });
  const { json } = await run();

  assert.strictEqual(json.creditsAvailable, 1);
  assert.strictEqual(json.enoughCredits, false);
  assert.strictEqual(json.status, 'draft', 'a campaign nobody can afford was not still saved');
});

section('What it does that leaves no mark on the answer');

test('IT LOOKS UP ANCHORS USED BY EARLIER CAMPAIGNS', async () => {
  /* Passed to the planner so a second campaign does not repeat the first
   * one's phrases. Drop this in a move and nothing fails — the anchors just
   * quietly stop varying, months before anyone notices. */
  install();
  await run();

  assert.ok(calls.priorLookup, 'prior campaigns are no longer looked up');
  assert.strictEqual(String(calls.priorLookup.site), SITE_ID);
  assert.strictEqual(calls.priorLookup['targetPage.url'], body().targetPage.url);
});

test('AND IT SAVES A CHANGED BUSINESS NAME', async () => {
  /* The branded anchor phrases are built from it and frozen into the slots,
   * so this is the one moment the value matters. Silent if dropped. */
  install();

  await run({
    body: body({ business: { name: 'Leander Water Heaters & Plumbing', type: 'plumber', location: 'Leander, TX', phone: '512-555-0199' } }),
  });

  assert.ok(calls.businessSaved, 'a renamed business is no longer stored');
  assert.strictEqual(
    calls.businessSaved.$set.business.name,
    'Leander Water Heaters & Plumbing');
});

test('and leaves it alone when nothing changed', async () => {
  /* A write on every plan would be a write nobody asked for, and would make
   * the log line about a rename meaningless. */
  install();
  await run({ body: body({ business: site().business }) });

  assert.strictEqual(calls.businessSaved, null, 'an unchanged business was written anyway');
});

section('WHAT IT REFUSES, AND WITH WHICH STATUS');

test('no target page', async () => {
  install();
  const { status, json } = await run({ body: body({ targetPage: null }) });

  assert.strictEqual(status, 400);
  assert.ok(json.error, 'refused with no message');
  assert.strictEqual(calls.created, null, 'a campaign was created anyway');
});

test('no topics', async () => {
  install();
  const { status, json } = await run({ body: body({ topics: [] }) });

  assert.strictEqual(status, 400);
  assert.ok(json.error);
});

test('more than 52 topics', async () => {
  /* A year of weekly posts. Past that the ring stops being a ring. */
  install();

  const many = Array.from({ length: 53 }, (_, i) => ({
    topic: `Topic number ${i}`, targetQuery: `query number ${i}`,
  }));

  const { status } = await run({ body: body({ topics: many }) });
  assert.strictEqual(status, 400);
});

test('CANNIBALISING TOPICS, AND THE LIST COMES BACK WITH THE SENTENCE', async () => {
  /* FOUND BY MUTATION. Every other refusal here carries only a message, so
   * a route that answered `{ error }` and dropped everything else passed
   * every assertion — and this one case carries DATA as well.
   *
   * wp-admin uses `conflicts` to mark the offending rows. Without it the
   * customer is told some topics compete and left to work out which, on a
   * screen of fifty. */
  install();

  const clash = [
    { topic: 'Water heater repair in Leander', targetQuery: 'water heater repair leander' },
    { topic: 'Water heater repair, Leander TX', targetQuery: 'water heater repair leander' },
  ];

  const { status, json } = await run({ body: body({ topics: clash }) });

  assert.strictEqual(status, 400);
  assert.ok(json.error, 'refused with no sentence');
  assert.ok(Array.isArray(json.conflicts), 'the conflict list did not come back');
  assert.ok(json.conflicts.length, 'the conflict list is empty');
  assert.ok(json.conflicts[0].kind, 'a conflict carries no kind');
  assert.strictEqual(calls.created, null, 'a cannibalising campaign was saved anyway');
});

test('A PILLAR CAMPAIGN WITH ONE POST', async () => {
  /* With no money page and no sibling, a single pillar post has no outbound
   * links at all — and it passes every quality check, because each link
   * assertion is conditional on the link having been asked for. */
  install();

  const { status, json } = await run({
    body: body({ isPillar: true, targetPage: null, topics: [topics()[0]] }),
  });

  assert.strictEqual(status, 400);
  assert.match(json.error, /two posts/i);
});

test('and a pillar campaign with two is allowed, and carries no target page', async () => {
  /* The absence has to stay an absence all the way down: a sub-document of
   * empty strings would validate, and then the writer would be handed a
   * money link pointing nowhere. */
  install();

  const { status, json } = await run({
    body: body({ isPillar: true, targetPage: null, topics: topics().slice(0, 2) }),
  });

  assert.strictEqual(status, 200, `a valid pillar campaign was refused: ${JSON.stringify(json)}`);
  assert.strictEqual(json.isPillar, true);
  assert.ok(!('targetPage' in calls.created), 'an empty targetPage was written to the campaign');
});

test('THE isPillar IN THE ANSWER IS THE CAMPAIGN\'S, NOT THE FORM\'S', async () => {
  /* wp-admin posted the flag, so it already "knows" — which is the trap. Two
   * copies of one fact, written by two sides, disagree the first time a
   * request is retried or the server rejects the flag for a reason the
   * plugin did not model. IE_Campaigns::create_from_plan() reads it from
   * here, and test-pillar-plugin.php proves it prefers this copy. */
  install();

  /* THE FIXTURE HAS TO MAKE THE TWO DISAGREE, and the first version did not:
   * it sent no flag at all, so the form's value and the campaign's were both
   * falsy and echoing the wrong one changed nothing. Found by mutation.
   *
   * 1 is not `true` and not the string 'true', so the handler reads it as
   * "not a pillar" — while the form's own copy is still 1. */
  const { json } = await run({ body: body({ isPillar: 1 }) });

  assert.strictEqual(json.isPillar, false,
    `the form's own value was echoed back instead of the campaign's: ${JSON.stringify(json.isPillar)}`);
  assert.strictEqual(json.isPillar, calls.created.isPillar);
});

section('And the shape of the rest');

test('schedule and anchorSummary come back, and warnings is a list', async () => {
  install();
  const { json } = await run();

  assert.ok(json.schedule && 'object' === typeof json.schedule, 'the schedule is missing');
  assert.ok(json.anchorSummary, 'the anchor summary is missing');
  assert.ok(Array.isArray(json.warnings), 'warnings is not a list');
});

test('and the campaign id is a string, not an ObjectId', async () => {
  /* It goes into a JSON body that PHP parses. An ObjectId would serialise
   * differently depending on the driver version. */
  install();
  const { json } = await run();

  assert.strictEqual(typeof json.campaignId, 'string');
  assert.strictEqual(json.campaignId, '507f1f77bcf86cd799439033');
});

/* ======================================================================= */

(async () => {
  for (const run of queue) await run();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
