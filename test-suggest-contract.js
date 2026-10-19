// test-suggest-contract.js
//
// What /api/blog/suggest promises, before any of it moves.
//
// WHY, AND WHY FIRST
//
// The Cloudflare screen needs topic suggestion, and it cannot call this
// route: requireSite refuses anything that is not a WordPress site before it
// looks at a signature. So the rules move into a function both callers can
// reach, exactly as createCampaign and approveCampaign did.
//
// This file pins them while the handler is still untouched. Everything here
// passed against the original and has to pass against the moved version.
//
// WHAT IS EASY TO LOSE IN A MOVE LIKE THIS
//
// Not the obvious things. The response keys are visible. What goes quietly
// is the arithmetic and the plumbing:
//
//   - the count clamp, which stops a request for 500 topics
//   - `avoid`, which is the only reason a second campaign on the same page
//     proposes anything new — drop it and the customer gets the same six
//     ideas back and assumes the product is broken
//   - the 60-item cap on it, which keeps the prompt from growing without end
//   - the timeout, whose absence shows up as a hung socket, not an error
//
// None of those appear in the answer, so none of them would be noticed by
// reading one.
//
//   node test-suggest-contract.js

const assert = require('assert');

/* A SHORT TIMEOUT, SET BEFORE THE ROUTE IS LOADED. CALL_TIMEOUT_MS is read
 * from the environment once, at require time — so this has to happen first
 * or the timeout test would sit here for ninety seconds. */
process.env.BLOG_TOPICS_TIMEOUT_MS = '120';

/* STUBS INSTALLED BEFORE THE ROUTE IS REQUIRED, and that order is the whole
 * trick. The route destructures its dependencies into consts at load time:
 *
 *     const { suggestTopics } = require('../utils/blog/suggestTopics');
 *
 * Replace the export afterwards and the route still holds the original. So
 * the module object is mutated first, and the route picks the stub up as it
 * loads. */
const suggestTopicsModule = require('./utils/blog/suggestTopics');
const qualityCheckModule = require('./utils/blog/qualityCheck');

const calls = { suggest: null, check: null };

suggestTopicsModule.suggestTopics = async (ctx, opts) => {
  calls.suggest = { ctx, opts };
  if (stub.throws) throw stub.throws;
  if (stub.hangs) return new Promise(() => {});   // never settles
  return stub.topics;
};

qualityCheckModule.checkTopicSet = (topics, targetPage, business) => {
  calls.check = { topics, targetPage, business };
  return { warnings: stub.warnings };
};

const router = require('./routes/blogTopicsRoute');
const BlogCampaign = require('./models/BlogCampaign');

let passed = 0, failed = 0;

const queue = [];
function test(name, fn) {
  queue.push(() => fn()
    .then(() => { console.log(`  ok    ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }));
}
function section(n) { queue.push(async () => console.log(`\n${n}\n`)); }

/* ------------------------------------------------------------------------
 * The real handler, off the real router
 * --------------------------------------------------------------------- */

function handlerFor(path) {
  const layer = router.stack.find(l => l.route && l.route.path === path);
  assert.ok(layer, `${path} is not on the router any more`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

const suggest = handlerFor('/api/blog/suggest');

/* ------------------------------------------------------------------------
 * Fixtures
 * --------------------------------------------------------------------- */

const SITE_ID = '507f1f77bcf86cd799439011';

let stub;

function install(over = {}) {
  stub = Object.assign({
    topics: [{ topic: 'How hard water wrecks a heater', targetQuery: 'hard water heater' }],
    warnings: [],
    used: [],          // topics returned by the already-used lookup
    throws: null,
    hangs: false,
    business: { name: 'Lone Star Plumbing', type: 'plumber', city: 'Leander', state: 'TX' },
  }, over);

  calls.suggest = null;
  calls.check = null;
  calls.campaignWhere = null;

  BlogCampaign.find = (where) => {
    calls.campaignWhere = where;
    return {
      select: () => ({
        lean: async () => stub.used.map(t => ({ slots: [{ topic: t }] })),
      }),
    };
  };
}

function req(body = {}) {
  return {
    id: 'req-suggest',
    site: { _id: SITE_ID, business: stub.business },
    body,
  };
}

async function run(body = {}) {
  const out = { status: 200, json: null };
  const res = {
    status(code) { out.status = code; return this; },
    json(payload) { out.json = payload; return this; },
  };
  await suggest(req(body), res);
  return out;
}

/** The body a well-formed request sends. */
function page(over = {}) {
  return Object.assign({
    url: 'https://lonestar.example/water-heater-repair',
    keyword: 'water heater repair',
    title: 'Water Heater Repair',
    intent: 'book a visit',
  }, over);
}

/* ======================================================================= */

section('IT REFUSES WHAT IT CANNOT WORK FROM');

test('no target page at all is a 400', async () => {
  install();
  const { status, json } = await run({});

  assert.strictEqual(status, 400);
  assert.ok(json.error, 'the refusal says nothing');
  assert.strictEqual(calls.suggest, null, 'the model was called with no target page');
});

test('AND A TARGET PAGE WITH NO KEYWORD IS THE SAME REFUSAL', async () => {
  /* The keyword is what the ideas are built from — buildContext puts it in
   * `services` and every prompt reads it. A url on its own produces six
   * topics about nothing. */
  install();
  const { status } = await run({ targetPage: { url: 'https://x.example/p' } });

  assert.strictEqual(status, 400);
  assert.strictEqual(calls.suggest, null, 'the model was called with no keyword');
});

test('but a keyword with no url is accepted', async () => {
  /* Current behaviour, and worth pinning rather than assuming: validTargetPage
   * requires the keyword and defaults the url to ''. A caller that wants
   * ideas before it has picked a page gets them. */
  install();
  const { status } = await run({ targetPage: { keyword: 'water heater repair' } });

  assert.strictEqual(status, 200);
  assert.ok(calls.suggest, 'the model was not called');
});

section('HOW MANY IT ASKS FOR');

test('six by default', async () => {
  /* What the prompt's angle spread is tuned for — it asks for at least four
   * distinct angles, which needs room. */
  install();
  await run({ targetPage: page() });

  assert.strictEqual(calls.suggest.opts.count, 6);
});

test('THREE IS THE FLOOR AND TWELVE IS THE CEILING', async () => {
  /* Past twelve the model repeats itself, so the customer is choosing from a
   * worse list rather than a longer one. And a request for 500 is a bill. */
  for (const [asked, expected] of [[1, 3], [0, 6], [-20, 3], [3, 3], [12, 12], [13, 12], [500, 12]]) {
    install();
    await run({ targetPage: page(), count: asked });

    assert.strictEqual(calls.suggest.opts.count, expected,
      `count ${asked} became ${calls.suggest.opts.count}, not ${expected}`);
  }
});

test('and junk falls back to six rather than NaN', async () => {
  install();
  await run({ targetPage: page(), count: 'lots' });

  assert.strictEqual(calls.suggest.opts.count, 6);
});

section('WHAT IT AVOIDS, WHICH IS THE PART NOBODY SEES');

test('TOPICS ALREADY USED ON THIS PAGE ARE PASSED AS avoid', async () => {
  /* The only reason a second campaign on the same page proposes anything
   * new. The model has no memory of the first run; this is its memory.
   * Lose it and the customer gets the same six ideas back and concludes the
   * product does not work. */
  install({ used: ['Signs your heater is dying', 'Tank vs tankless'] });

  await run({ targetPage: page() });

  assert.ok(calls.suggest.opts.avoid.includes('Signs your heater is dying'),
    'a topic already written is not being avoided');
  assert.ok(calls.suggest.opts.avoid.includes('Tank vs tankless'));
});

test('and they are looked up for THIS site and THIS page', async () => {
  install({ used: ['x'] });
  await run({ targetPage: page() });

  assert.strictEqual(String(calls.campaignWhere.site), SITE_ID,
    'the lookup is not scoped to this site');
  assert.strictEqual(calls.campaignWhere['targetPage.url'],
    'https://lonestar.example/water-heater-repair',
    'the lookup is not scoped to this page');
});

test('the caller can name more to avoid, and both lists are used', async () => {
  install({ used: ['from the database'] });

  await run({ targetPage: page(), avoid: ['from the caller'] });

  assert.ok(calls.suggest.opts.avoid.includes('from the caller'));
  assert.ok(calls.suggest.opts.avoid.includes('from the database'));
});

test('AND THE LIST IS CAPPED AT SIXTY', async () => {
  /* A prompt that grows with every campaign ever run eventually costs more
   * than the suggestion is worth, and then stops fitting. */
  install({ used: Array.from({ length: 200 }, (_, i) => `used ${i}`) });

  await run({ targetPage: page() });

  assert.strictEqual(calls.suggest.opts.avoid.length, 60,
    `the avoid list is ${calls.suggest.opts.avoid.length} long`);
});

test('with no page url there is nothing to look up, and no query is made', async () => {
  install({ used: ['x'] });

  await run({ targetPage: { keyword: 'water heater repair' } });

  assert.strictEqual(calls.campaignWhere, null,
    'the database was queried for topics used on a page that was never named');
  assert.deepStrictEqual(calls.suggest.opts.avoid, []);
});

section('WHAT THE MODEL IS GIVEN');

test('the context carries the business and the target page', async () => {
  install();
  await run({ targetPage: page() });

  const ctx = calls.suggest.ctx;

  assert.strictEqual(ctx.business.name, 'Lone Star Plumbing');
  assert.strictEqual(ctx.targetPage.keyword, 'water heater repair');
  assert.strictEqual(ctx.targetPage.url, 'https://lonestar.example/water-heater-repair');

  /* THE KEYWORD IS IN services, and that is what makes a thin business
   * usable. A Cloudflare blog has a name and nothing else — no trade, no
   * town — so the target page's keyword is the only real subject the
   * suggester gets. */
  assert.ok(ctx.business.services.includes('water heater repair'),
    'the keyword never reaches the services list the prompt is built from');
});

test('and the long fields are trimmed before they reach it', async () => {
  install();
  await run({ targetPage: page({ keyword: 'k'.repeat(500), intent: 'i'.repeat(900) }) });

  assert.strictEqual(calls.suggest.ctx.targetPage.keyword.length, 200);
  assert.strictEqual(calls.suggest.ctx.targetPage.intent.length, 500);
});

section('WHAT IT SENDS BACK');

test('the topics, the warnings and how many were avoided', async () => {
  install({
    topics: [{ topic: 'A' }, { topic: 'B' }],
    warnings: ['two titles start the same way'],
    used: ['one', 'two', 'three'],
  });

  const { status, json } = await run({ targetPage: page() });

  assert.strictEqual(status, 200);
  assert.deepStrictEqual(json.topics, [{ topic: 'A' }, { topic: 'B' }]);
  assert.deepStrictEqual(json.warnings, ['two titles start the same way']);

  /* So wp-admin can say "we avoided 3 topics you have already used" rather
   * than leaving the customer wondering why the list changed. */
  assert.strictEqual(json.avoided, 3);
});

test('THE QUALITY REVIEW IS REPORTED, NEVER ENFORCED', async () => {
  /* These are suggestions the customer edits. A warning that refused the
   * whole batch would throw away five good topics over one repeated
   * opening. */
  install({ warnings: ['every title starts with How'] });

  const { status, json } = await run({ targetPage: page() });

  assert.strictEqual(status, 200, 'a quality warning refused the whole batch');
  assert.strictEqual(json.topics.length, 1, 'the topics were withheld');
  assert.ok(calls.check, 'the batch was never reviewed at all');
});

section('WHEN IT GOES WRONG');

test('a model failure is a 502, and says nothing about the model', async () => {
  install({ throws: new Error('upstream 500 from the provider') });

  const { status, json } = await run({ targetPage: page() });

  assert.strictEqual(status, 502);
  assert.ok(json.error, 'the failure is silent');
  assert.ok(!/upstream|provider/i.test(json.error),
    `the provider's error reached the customer: ${json.error}`);
});

test('AND A CALL THAT NEVER RETURNS IS CUT OFF', async () => {
  /* Without this the plugin holds a socket open until something between us
   * gives up, and the customer sees a spinner that never stops — which is
   * worse than an error, because nothing tells them to try again. */
  install({ hangs: true });

  const started = Date.now();
  const { status } = await run({ targetPage: page() });

  assert.strictEqual(status, 502, 'a hung model call was not turned into an answer');
  assert.ok(Date.now() - started < 3000,
    'the request was not cut off by the timeout');
});

/* ======================================================================= */

(async () => {
  for (const run of queue) await run();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
