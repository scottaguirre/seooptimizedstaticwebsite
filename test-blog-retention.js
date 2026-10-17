// test-blog-retention.js
//
// When a stored article may be thrown away.
//
// WHAT THIS IS GUARDING
//
// Until 16 October, every article this app ever wrote stayed in Mongo for
// ever. Edwin asked why, given WordPress already has a copy, and the answer
// turned out to be two reasons that did not survive his questions and one
// that did: a customer saying "this is not what I paid 100 credits for" is
// asking about the article AS DELIVERED, and their live site is not that.
//
// So the article is kept fifteen days past a confirmed insert, then dropped.
//
// THE ONE THING THAT MAKES THIS DANGEROUS, and the reason most of this file
// exists: /api/blog/complete records a confirmation like this —
//
//     wpPostId: Number(item.wpPostId) || undefined,
//     url: String(item.url || ''),
//
// so a confirmation carrying NEITHER still marks the slot scheduled and
// answers ok. Harmless while the article is kept regardless. Destructive the
// moment deletion hangs off it: a plugin bug, a half-failed insert or a
// modified plugin would have us delete the only copy we hold on a claim with
// nothing behind it.
//
// WHAT IS WORTH ASSERTING
//
//   - a static blog's article is NEVER deletable, whatever it is confirmed with
//   - an unproven confirmation is never deletable either
//   - the window is fifteen days, measured from the confirmation
//   - the sweeper carries no policy — it cannot widen its own query
//   - a re-confirmation cannot push the window forward for ever
//
//   node test-blog-retention.js

const fs = require('fs');
const assert = require('assert');
const retention = require('./utils/blog/retention');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}
function section(n) { console.log(`\n${n}\n`); }

/* Tests that have to await something.
 *
 * NOT A STYLE CHOICE. test() above calls fn() and throws the return value
 * away, so an async test resolves after the summary has already printed and
 * its assertions are never seen — it reports "ok" whatever it would have
 * found, and a rejection becomes an unhandled promise warning nobody reads.
 * The throttle test below is the first in this project that needs to drive a
 * real async function, and it would have passed vacuously.
 */
const deferred = [];

function testAsync(name, fn) {
  deferred.push(async () => {
    try { await fn(); console.log(`  ok    ${name}`); passed++; }
    catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
  });
}

/* Source with comments stripped.
 *
 * Five times now this project has had a source check match the comment that
 * was EXPLAINING the thing it forbade, and once that refused a deploy on
 * correct code. The files below quote the exact two lines that make this
 * feature risky, because that is what a useful comment does. */
const code = file => fs.readFileSync(require.resolve(file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const WP = { target: 'wordpress' };
const STATIC = { target: 'cloudflare' };

/** What the plugin sends when the insert really happened. */
const PROVEN = { slotIndex: 3, wpPostId: 412, url: 'https://example.test/a-post/' };

const NOW = new Date('2026-10-16T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
section('A WordPress site: fifteen days from the confirmation');
// ---------------------------------------------------------------------------

test('a proven confirmation earns a date', function () {
  const when = retention.deletableAt(WP, PROVEN, NOW);

  assert.ok(when instanceof Date, 'no date was returned for a proven insert');
  assert.strictEqual(when.getTime(), NOW.getTime() + 15 * DAY);
});

test('fifteen days, and the number is shared rather than typed twice', function () {
  /* The route computes the same window to stamp every slot in one update. A
   * literal in either place would drift from the other and the stamp would
   * disagree with the rule that produced it. */
  assert.strictEqual(retention.WINDOW_DAYS, 15);

  const when = retention.deletableAt(WP, PROVEN, NOW);
  assert.strictEqual(when.getTime() - NOW.getTime(), retention.WINDOW_DAYS * DAY);
});

test('and nothing is reported as deletable', function () {
  assert.strictEqual(retention.whyNot(WP, PROVEN), '');
});

test('a site with no target at all counts as WordPress', function () {
  /* The judgement call in retention.js, and it has to go this way. Every
   * BlogSite that exists today predates the field; reading "missing" as
   * "unknown, keep it" would be the safer-looking choice and would make the
   * feature silently do nothing until every row was backfilled.
   *
   * It is safe because the enum means a Cloudflare site CANNOT be saved
   * without the field — so missing can never mean cloudflare. */
  assert.ok(retention.deletableAt({}, PROVEN, NOW) instanceof Date);
  assert.ok(retention.deletableAt({ target: '' }, PROVEN, NOW) instanceof Date);
});

// ---------------------------------------------------------------------------
section('A STATIC BLOG IS NEVER DELETABLE');
// ---------------------------------------------------------------------------

test('a cloudflare site keeps its article, whatever it is confirmed with', function () {
  /* There is no WordPress database behind a static blog. Every deploy is a
   * fresh render from Mongo, so deleting a published article does not save a
   * duplicate — it destroys the blog's ability to be rebuilt. */
  assert.strictEqual(retention.deletableAt(STATIC, PROVEN, NOW), null);
  assert.match(retention.whyNot(STATIC, PROVEN), /only copy/i);
});

test('and the reason names the target, so a log line can be read later', function () {
  assert.match(retention.whyNot(STATIC, PROVEN), /cloudflare/);
});

test('AND AN UNRECOGNISED TARGET IS KEPT, NOT GUESSED AT', function () {
  /* Found by mutation. The first version read
   *
   *     return !KEEP_FOR_EVER.includes(target)
   *
   * which fails in the wrong direction: a third target added to the enum
   * tomorrow is not in the keep list, so its articles would start being
   * deleted the day it shipped, before anyone decided that was safe. */
  for (const unknown of ['netlify', 's3', 'wordpres', 'WORDPRESS ', 'undefined']) {
    assert.strictEqual(
      retention.deletableAt({ target: unknown }, PROVEN, NOW), null,
      `target "${unknown}" was treated as a WordPress site`
    );
  }
});

test('and the list of targets it knows about matches the model', function () {
  /* Two lists in two files, and the direction they would disagree in is
   * "delete the articles of a target nobody has thought about yet". */
  assert.deepStrictEqual(retention.KNOWN_TARGETS, ['wordpress', 'cloudflare']);

  const site = fs.readFileSync(require.resolve('./models/BlogSite.js'), 'utf8');
  for (const target of retention.KNOWN_TARGETS) {
    assert.ok(site.includes(`'${target}'`),
      `retention.js knows about "${target}" and BlogSite's enum does not`);
  }
});

test('the keep-for-ever list is exported, not inlined', function () {
  /* A second static target added here must be added in ONE place. A list
   * that is a literal inside a condition is a list the next target is left
   * out of. */
  assert.deepStrictEqual(retention.KEEP_FOR_EVER, ['cloudflare']);
});

// ---------------------------------------------------------------------------
section('AN UNPROVEN CONFIRMATION IS NEVER DELETABLE');
// ---------------------------------------------------------------------------

test('no WordPress post id means keep it', function () {
  /* The exact hole. The route accepts this confirmation today and answers
   * ok — so without this rule the article would be deleted on a claim that
   * carried no evidence at all. */
  for (const bad of [undefined, null, 0, -1, '', 'abc', NaN, 1.5, {}, []]) {
    const confirmation = { ...PROVEN, wpPostId: bad };

    assert.strictEqual(
      retention.deletableAt(WP, confirmation, NOW), null,
      `wpPostId ${JSON.stringify(bad)} was accepted as proof`
    );
  }

  assert.match(retention.whyNot(WP, { ...PROVEN, wpPostId: 0 }), /post id/i);
});

test('AND NO URL MEANS KEEP IT EITHER', function () {
  /* The id alone is not enough. wp_insert_post can return an id for a post
   * whose permalink was never resolved, and the URL is the half the plugin
   * cannot invent — WordPress appends -2 to a slug already taken, which is
   * why it is sent back rather than assumed. */
  for (const bad of [undefined, null, '', '   ', 0]) {
    assert.strictEqual(
      retention.deletableAt(WP, { ...PROVEN, url: bad }, NOW), null,
      `url ${JSON.stringify(bad)} was accepted as proof`
    );
  }

  assert.match(retention.whyNot(WP, { ...PROVEN, url: '' }), /URL/i);
});

test('junk does not throw, and does not earn a date', function () {
  /* This runs inside a route a customer's site calls. A fatal here is a 500
   * on a confirmation, and a site that got a 500 offers all twelve posts
   * again — which is a duplicate post on their blog.
   *
   * TWO LISTS, NOT ONE, and the first version of this test used one and
   * contradicted the "a site with no target counts as WordPress" test two
   * sections up: `{}` is junk as a CONFIRMATION and perfectly valid as a
   * SITE. Writing them together asserted both that it should and should not
   * earn a date. */
  for (const junk of [undefined, null, 'yes', 7, [], {}, { wpPostId: {} }]) {
    assert.strictEqual(
      retention.deletableAt(WP, junk, NOW), null,
      `${JSON.stringify(junk)} was accepted as a confirmation`
    );
  }

  /* A site has to be an object with a target, or absent. Note `[]` —
   * `typeof [] === 'object'` and an array has no .target, so an array read as
   * a WordPress site until isWordPress() was taught to reject it. Found
   * here. */
  for (const junk of [undefined, null, 'yes', 7, [], true]) {
    assert.strictEqual(
      retention.deletableAt(junk, PROVEN, NOW), null,
      `${JSON.stringify(junk)} was accepted as a site`
    );
  }

  for (const junk of [undefined, null, 'yes', 7, [], {}]) {
    assert.ok('string' === typeof retention.whyNot(junk, junk));
  }
});

test('a bad clock does not produce an invalid date', function () {
  for (const bad of [undefined, null, 'today', new Date('nope')]) {
    const when = retention.deletableAt(WP, PROVEN, bad);

    assert.ok(when instanceof Date, `${String(bad)} produced ${String(when)}`);
    assert.ok(!isNaN(when.getTime()), `${String(bad)} produced an invalid date`);
    assert.ok(when.getTime() > Date.now(), 'the window is already closed');
  }
});

// ---------------------------------------------------------------------------
section('The sweeper holds no policy of its own');
// ---------------------------------------------------------------------------

const post = code('./models/BlogPost.js');

test('it deletes by the stamp and by nothing else', function () {
  /* The whole design. The decision was made at confirmation time, where the
   * site and the evidence were in hand; this is only the broom. A site
   * filter, a status check or an age calculation in here would be a second
   * copy of the policy, and the direction it would eventually disagree in is
   * "delete the only copy of a static blog's article". */
  const sweep = post.slice(
    post.indexOf('sweepDeletable'),
    post.indexOf('module.exports')
  );

  assert.match(sweep, /deletableAt/, 'the sweep does not read the stamp');
  assert.ok(!/target|status|site:|createdAt/.test(sweep),
    'the sweep has grown a filter of its own, which is a second copy of the policy');
});

test('AND NULL CANNOT BE SWEPT', function () {
  /* `{ $lte: now }` alone would be enough in Mongo — null is not less than a
   * date — but relying on that means the query is correct by accident. The
   * explicit $ne is what makes "nothing is deletable unless something said
   * so" a property of the code rather than of a coercion rule. */
  const sweep = post.slice(post.indexOf('sweepDeletable'), post.indexOf('module.exports'));

  assert.match(sweep, /\$ne:\s*null/,
    'the sweep relies on null not comparing less than a date');
});

test('the default is null, so nothing written before today is deletable', function () {
  assert.match(post, /deletableAt:\s*\{[^}]*default:\s*null/,
    'deletableAt has no null default — every old article becomes deletable');
  assert.match(post, /deletableAt:\s*\{[^}]*index:\s*true/,
    'the sweep has no index to use');
});

test('and the file no longer argues against the code in it', function () {
  /* models/BlogPost.js carried a note headed "Deliberately NOT deleted after
   * publication", with reasons. Leaving it above a method that deletes posts
   * would send the next reader looking for a bug. */
  const raw = fs.readFileSync(require.resolve('./models/BlogPost.js'), 'utf8');

  /* ANCHORED TO THE START OF A COMMENT LINE, which is the whole subtlety.
   * The replacement note QUOTES the old heading while explaining why it went
   * — and the first version of this assertion matched that quotation and
   * failed on a correct file. Sixth time this project has done this.
   *
   * The old text was a note heading: `* Deliberately NOT deleted...` at the
   * start of its line. The quotation sits mid-sentence behind a quote mark.
   * The anchor tells them apart. */
  assert.ok(!/^\s*\*\s*Deliberately NOT deleted/m.test(raw),
    'the old "never deleted" note is still the heading, above the code that deletes');

  assert.match(raw, /fifteen days/i, 'nothing in the file says how long the window is');
});

// ---------------------------------------------------------------------------
section('The route stamps it, and only where it should');
// ---------------------------------------------------------------------------

const route = code('./routes/blogApiRoute.js');
const complete = route.slice(
  route.indexOf("router.post('/api/blog/complete'"),
  route.indexOf("router.post('/api/blog/published'")
);

test('/complete asks retention.js rather than deciding for itself', function () {
  assert.ok(complete.length > 0, 'the /complete handler could not be found');
  assert.match(complete, /retention\.deletableAt\(req\.site,/,
    'the route does not consult the retention rules');
  assert.ok(!/wpPostId.*&&.*url|15|fifteen/.test(complete),
    'the route has its own copy of the rule or the window');
});

test('THE STAMP GOES ON THE SLOT THAT WAS JUST RECORDED, NOT ON A DUPLICATE', function () {
  /* The branch below the one that stamps handles a re-confirmation: a slot
   * already 'scheduled' or 'published', reported again because the plugin
   * lost our answer. That slot already carries its date. Re-stamping it would
   * push the window forward on every re-confirmation, and a site that
   * re-confirms on every run would keep its articles for ever — the bug this
   * feature exists to fix, reintroduced through the back door. */
  const stampAt = complete.indexOf('retention.deletableAt');
  assert.ok(stampAt > -1, 'nothing stamps a retention date');

  /* INSIDE `if (updated)`, not merely before the duplicate branch.
   *
   * The first version compared positions — stamp before `status ===
   * 'scheduled'` — and a mutation that moved the stamp out of the if-block
   * and above that check passed it, while stamping every slot that was NOT
   * freshly recorded: duplicates and rejections alike. The span is what
   * matters, not the order. */
  const fresh = complete.slice(
    complete.indexOf('if (updated) {'),
    complete.indexOf('const slot = (campaign.slots')
  );

  assert.ok(fresh.includes('retention.deletableAt'),
    'the stamp is outside the branch that handles a freshly recorded slot');
  assert.ok(fresh.includes('droppable.push'),
    'the slot is never added to the list the update reads');
});

test('it is written in ONE update, not one per slot', function () {
  assert.match(complete, /BlogPost\.updateMany\(/,
    'the route stamps each slot with its own round trip');
  assert.match(complete, /slotIndex:\s*\{\s*\$in:/,
    'the update does not target the slots it collected');
});

test('AND A FAILED STAMP DOES NOT FAIL THE CONFIRMATION', function () {
  /* The confirmation is what the plugin is waiting on. A site that inserted
   * twelve posts and got a 500 back offers all twelve again, which is twelve
   * duplicate posts on a customer's blog. Failing to write a retention date
   * costs twelve kilobytes per post. */
  const stamp = complete.slice(complete.indexOf('BlogPost.updateMany') - 300,
                               complete.indexOf('BlogPost.updateMany') + 500);

  assert.match(stamp, /try\s*\{/, 'the stamp is not guarded');
  assert.match(stamp, /catch/, 'the stamp has no catch');
});

test('and the log can tell "working as intended" from "the plugin is broken"', function () {
  /* Zero droppable on a Cloudflare site is correct. Zero on a WordPress site
   * means the plugin is confirming without post ids, which is a bug nobody
   * would otherwise see. The count alone cannot distinguish them. */
  assert.match(complete, /droppable:/, 'the log does not say how many were marked');
  assert.match(complete, /retention\.whyNot\(/,
    'the log says nothing about why an article was kept');
});

// ---------------------------------------------------------------------------
section('The sweep runs on a loop that is known to run');
// ---------------------------------------------------------------------------

const sched = code('./utils/blogScheduler.js');

test('IT IS CALLED FROM THE TICK, NOT FROM A SCHEDULER OF ITS OWN', function () {
  /* utils/cleanupScheduler.js is why. It exports startCleanupScheduler(),
   * nothing in the app calls it, so it has never run — and nobody noticed for
   * months, because a sweeper that does nothing looks exactly like a sweeper
   * with nothing to do. This loop is already started from server.js. */
  assert.match(sched, /async function sweepArticles\(/, 'there is no sweep');
  assert.match(sched, /await sweepArticles\(\)/, 'the sweep is defined and never called');
});

test('and it runs BEFORE the early return, so a quiet minute still sweeps', function () {
  /* tick() returns early when no site has work, which is most minutes. A
   * sweep after that line would only run on the minutes something else
   * happened to be due. */
  const tick = sched.slice(sched.indexOf('async function tick()'));

  const call = tick.indexOf('sweepArticles()');
  const earlyReturn = tick.indexOf('if (!work.size) return;');

  assert.ok(call > -1 && earlyReturn > -1, 'tick() has changed shape');
  assert.ok(call < earlyReturn,
    'the sweep sits after the early return and runs only on busy minutes');
});

testAsync('IT IS THROTTLED, AND THAT IS DRIVEN RATHER THAN READ', async function () {
  /* The source check this replaced — "does SWEEP_GAP_MS appear" — passed
   * happily when the guard that uses it was deleted, because the constant was
   * still declared. Found by mutation.
   *
   * So the real function is run three times against a stubbed model. The tick
   * fires every sixty seconds and the window is measured in days; a sweep on
   * every tick is sixty indexed deletes an hour to remove things that became
   * deletable at some point in the last fifteen days. */
  const postPath = require.resolve('./models/BlogPost');
  const schedPath = require.resolve('./utils/blogScheduler');
  const saved = require.cache[postPath];

  let sweeps = 0;

  require.cache[postPath] = {
    id: postPath,
    filename: postPath,
    loaded: true,
    exports: { sweepDeletable: async () => { sweeps++; return 0; } },
  };

  try {
    delete require.cache[schedPath];
    const scheduler = require('./utils/blogScheduler');

    assert.strictEqual(typeof scheduler.sweepArticles, 'function',
      'sweepArticles is not exported, so the throttle cannot be driven at all');

    const t0 = Date.now();

    await scheduler.sweepArticles(t0);
    await scheduler.sweepArticles(t0 + 60 * 1000);

    assert.strictEqual(sweeps, 1,
      `the sweep ran ${sweeps} times inside one minute — the throttle is gone`);

    await scheduler.sweepArticles(t0 + 2 * 60 * 60 * 1000);

    assert.strictEqual(sweeps, 2, 'the sweep never ran again — the throttle never opens');

  } finally {
    if (saved) require.cache[postPath] = saved;
    else delete require.cache[postPath];
    delete require.cache[schedPath];
  }
});

test('AND IT LOGS EVERY RUN, INCLUDING THE ZEROS', function () {
  /* The other half of the cleanupScheduler lesson. "0 removed" is the only
   * thing that distinguishes "nothing was due" from "it is not running", and
   * from outside the process those look identical. */
  const sweep = sched.slice(
    sched.indexOf('async function sweepArticles('),
    sched.indexOf('async function tick()')
  );

  assert.match(sweep, /log\.info\(/, 'a successful sweep says nothing at all');
  assert.ok(!/if \(removed\)|removed > 0|removed \?/.test(sweep),
    'the log line is conditional on having removed something');
});

test('a failed sweep does not take the tick down with it', function () {
  const sweep = sched.slice(
    sched.indexOf('async function sweepArticles('),
    sched.indexOf('async function tick()')
  );

  assert.match(sweep, /catch/, 'a Mongo error during the sweep would stop collection and publishing');
  assert.match(sweep, /log\.error\(/, 'a failed sweep fails silently');
});

// ---------------------------------------------------------------------------
section('The target field');
// ---------------------------------------------------------------------------

const site = code('./models/BlogSite.js');

test('it exists, defaults to wordpress, and is indexed', function () {
  /* Defaults to wordpress because every site that exists today is one, and
   * the sweep has to be able to find them. Indexed because the Cloudflare
   * publishing path will query on it. */
  assert.match(site, /target:\s*\{/, 'BlogSite has no target field');
  assert.match(site, /enum:\s*\['wordpress',\s*'cloudflare'\]/,
    'the two targets are not spelled out, so a typo becomes a third one');
  assert.match(site, /target:\s*\{[\s\S]{0,200}?default:\s*'wordpress'/,
    'target has no default — existing sites would have none');
});

(async function () {
  if (deferred.length) section('Driven, not read');
  for (const run of deferred) await run();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
