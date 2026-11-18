// test-site-batch.js
//
// Several websites from one submission, built one after another.
//
// WHAT THIS SUITE IS GUARDING — Edwin, 18 November: *"after one is deployed
// the app starts the second build and so on"*.
//
// The dangerous word is SEQUENTIALLY, and it is dangerous because the thing
// that goes wrong when it is not sequential does not throw.
//
//     EVERY LOCAL WEBSITE OPTIONS BUILD WIPES AND REFILLS dist/user_<id>.
//     TWO AT ONCE FOR ONE USER MEANS THE SECOND WIPES THE FIRST'S FOLDER
//     HALF WAY THROUGH, AND BOTH SITES PUBLISH SOMETHING.
//
// So the first section proves the second build does not start until the
// first has finished — not by reading the code, but by holding site one
// open and checking nothing else moved.
//
// THE OTHER FOUR THINGS WORTH BREAKING
//
//   carry on       Edwin chose it over stopping: sites one and three deploy
//                  and site two is reported. A batch that stops throws away
//                  builds that would have worked.
//   the resume     a restart must not rebuild a site that is already live.
//                  It costs the credits again and republishes over a good
//                  site, and nothing anywhere would say so.
//   the counters   the inner build reports eleven pages and the batch
//                  reports three sites. Forwarded straight through, the bar
//                  jumps to 7 of 11 and back — and worse, a page name lands
//                  in the list the resume reads.
//   the addresses  two sites in one batch asking for the same hostname
//                  would both build, and the second would publish over the
//                  first. checkWant() cannot see it: neither is taken yet.
//
//   node test-site-batch.js

'use strict';

const assert = require('assert');

const { generateForBatch, tagFor, oneSite } = require('./utils/batchGenerator');

let passed = 0, failed = 0;

async function test(name, fn) {
  try { await fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

function section(n) { console.log(`\n${n}\n`); }

/** One site's posted body, in the shape the wizard really sends. */
const site = (prefix, over = {}) => ({
  global: {
    siteMode: 'localoptions',
    siteTarget: 'cloudflare',
    businessName: `${prefix} Plumbing`,
    cloudflare: { name: `${prefix} Plumbing`, prefix, domain: 'acmesites.com' },
    ...over,
  },
});

const batchJob = (prefixes, over = {}) => ({
  _id: 'job-1',
  user: 'user-1',
  kind: 'sitebatch',
  payload: { sites: prefixes.map(p => site(p)) },
  completedPages: [],
  skippedPages: [],
  ...over,
});

/** A builder that succeeds, recording the order it was called in. */
const okBuilder = (log = []) => async (one) => {
  log.push(tagFor(one.payload, 0));

  return {
    creditsCharged: 800,
    result: { published: { ok: true, url: `https://${tagFor(one.payload, 0)}` } },
  };
};

/** Collects every onProgress call. */
const recorder = () => {
  const seen = [];

  return { seen, onProgress: async (p) => { seen.push(p); } };
};

(async () => {

/* ===================================================================== */

section('ONE AT A TIME, WHICH IS THE WHOLE REASON IT IS ONE JOB');

await test('THE SECOND BUILD DOES NOT START UNTIL THE FIRST HAS FINISHED', async () => {
  /* Proved by holding site one open rather than by reading the code: if the
   * loop ever stopped awaiting, site two would start while site one is
   * still inside its builder and `open` would be 2.
   *
   * THIS IS THE TEST THAT IS WORTH THE WHOLE FILE. A parallel batch does
   * not throw — it wipes a build folder out from under a build that is
   * still writing into it, and both sites publish something. */
  let open = 0;
  let worst = 0;
  const order = [];

  const build = async (one) => {
    open += 1;
    worst = Math.max(worst, open);
    order.push(tagFor(one.payload, 0));

    await new Promise(r => setTimeout(r, 5));

    open -= 1;

    return { creditsCharged: 800, result: { published: { ok: true } } };
  };

  const { onProgress } = recorder();

  await generateForBatch(batchJob(['a', 'b', 'c']), { onProgress, build });

  assert.strictEqual(worst, 1, `${worst} builds were running at once`);
  assert.deepStrictEqual(order, ['a.acmesites.com', 'b.acmesites.com', 'c.acmesites.com'],
    'the sites were not built in the order they were submitted');
});

await test('and the batch reports every site it built', async () => {
  const log = [];
  const { onProgress } = recorder();

  const out = await generateForBatch(batchJob(['a', 'b', 'c']),
    { onProgress, build: okBuilder(log) });

  assert.strictEqual(out.result.batch.total, 3);
  assert.strictEqual(out.result.batch.live, 3);
  assert.strictEqual(out.result.batch.failed, 0);
  assert.deepStrictEqual(out.result.batch.sites.map(s => s.site),
    ['a.acmesites.com', 'b.acmesites.com', 'c.acmesites.com']);
});

await test('AND THE CREDITS ARE THE SUM, NOT THE LAST ONE', async () => {
  /* `creditsCharged` is what jobRunner writes onto the job, and it is what
   * the owner is shown. Taking the last build's figure rather than the
   * total would report 800 for three sites that cost 2400. */
  const { onProgress } = recorder();

  const out = await generateForBatch(batchJob(['a', 'b', 'c']),
    { onProgress, build: okBuilder() });

  assert.strictEqual(out.creditsCharged, 2400);
});

await test('an empty batch is refused rather than completing with nothing', async () => {
  /* A job that completes having done nothing looks like a success on the
   * progress page. */
  const { onProgress } = recorder();

  await assert.rejects(
    () => generateForBatch(batchJob([]), { onProgress, build: okBuilder() }),
    /no sites/i);
});

/* ===================================================================== */

section('ONE SITE FAILING DOES NOT STOP THE OTHERS');

await test('SITES ONE AND THREE STILL DEPLOY WHEN SITE TWO THROWS', async () => {
  /* Edwin, 18 November, choosing this over stopping the batch. A batch that
   * stops on the first problem throws away the builds that would have
   * worked, and the owner is sitting in front of neither. */
  const built = [];

  const build = async (one) => {
    const tag = tagFor(one.payload, 0);

    if (tag.startsWith('b.')) throw new Error('Cloudflare said no');

    built.push(tag);

    return { creditsCharged: 800, result: { published: { ok: true } } };
  };

  const { onProgress } = recorder();
  const out = await generateForBatch(batchJob(['a', 'b', 'c']), { onProgress, build });

  assert.deepStrictEqual(built, ['a.acmesites.com', 'c.acmesites.com'],
    'the batch stopped at the failure');
  assert.strictEqual(out.result.batch.live, 2);
  assert.strictEqual(out.result.batch.failed, 1);

  const bad = out.result.batch.sites.find(s => s.site.startsWith('b.'));

  assert.strictEqual(bad.ok, false);
  assert.match(bad.error, /Cloudflare said no/, 'the reason was not carried into the report');
});

await test('AND THE JOB STILL COMPLETES WHEN EVERY SITE FAILED', async () => {
  /* `failed` on a job means the BATCH could not run. Three sites that each
   * failed for their own reason is a batch that ran perfectly and has three
   * things to tell you — and a failed job shows an error page instead of
   * the report, which is the one thing worth reading. */
  const build = async () => { throw new Error('nope'); };
  const { onProgress } = recorder();

  const out = await generateForBatch(batchJob(['a', 'b']), { onProgress, build });

  assert.strictEqual(out.result.batch.live, 0);
  assert.strictEqual(out.result.batch.failed, 2);
  assert.strictEqual(out.creditsCharged, 0, 'a batch that built nothing charged something');
});

await test('A BUILD THAT SUCCEEDS AND A PUBLISH THAT FAILS IS NOT A SUCCESS', async () => {
  /* generateForJob reports this through `result.published` precisely so it
   * is not lost — see the note there about two builds that said `completed`
   * with 800 credits charged and nothing live.
   *
   *     A SITE THAT WAS PAID FOR AND DID NOT GO LIVE IS NOT A SITE THAT
   *     SUCCEEDED, AND A REPORT THAT SAYS IT DID IS WORSE THAN NO REPORT. */
  const build = async (one) => ({
    creditsCharged: 800,
    result: {
      published: tagFor(one.payload, 0).startsWith('b.')
        ? { ok: false, error: 'the deploy was rejected' }
        : { ok: true, url: 'https://a.acmesites.com' },
    },
  });

  const { onProgress } = recorder();
  const out = await generateForBatch(batchJob(['a', 'b']), { onProgress, build });

  assert.strictEqual(out.result.batch.live, 1);

  const bad = out.result.batch.sites.find(s => s.site.startsWith('b.'));

  assert.strictEqual(bad.ok, false);
  assert.match(bad.error, /deploy was rejected/);

  /* AND THE CREDITS WERE STILL SPENT, because the build happened. The
   * report is what tells the owner; pretending it was free would be a
   * second untruth. */
  assert.strictEqual(out.creditsCharged, 1600);
});

await test('but a GitHub build that published nothing is not a failure', async () => {
  /* `published` is null for an account with no GitHub installation. That is
   * not a failed publish, it is a build nobody asked to publish. Only an
   * explicit ok:false is one. */
  const build = async () => ({ creditsCharged: 800, result: { published: null } });
  const { onProgress } = recorder();

  const out = await generateForBatch(batchJob(['a']), { onProgress, build });

  assert.strictEqual(out.result.batch.live, 1);
  assert.strictEqual(out.result.batch.sites[0].ok, true);
});

/* ===================================================================== */

section('A RESTART MUST NOT REBUILD A SITE THAT IS ALREADY LIVE');

await test('A SITE IN completedPages IS SKIPPED, NOT BUILT AGAIN', async () => {
  /* It costs the credits a second time and republishes over a good site. */
  const log = [];
  const { onProgress } = recorder();

  const job = batchJob(['a', 'b', 'c'], { completedPages: ['a.acmesites.com'] });
  const out = await generateForBatch(job, { onProgress, build: okBuilder(log) });

  assert.deepStrictEqual(log, ['b.acmesites.com', 'c.acmesites.com'],
    'a site that was already live was built again');

  /* AND IT IS STILL IN THE REPORT, marked as carried over. A resume that
   * reported only what it personally built would say "2 sites" for a batch
   * of three. */
  assert.strictEqual(out.result.batch.total, 3);
  assert.strictEqual(out.result.batch.live, 3);
  assert.strictEqual(out.result.batch.sites[0].resumed, true);

  /* AND IT IS NOT CHARGED FOR TWICE. */
  assert.strictEqual(out.creditsCharged, 1600);
});

await test('AND A SITE THAT ALREADY FAILED IS NOT RETRIED EITHER', async () => {
  /* skippedPages holds { page, reason } for a site that was decided. Only a
   * site the process died in the middle of has neither tag, and that is
   * precisely the one worth retrying. */
  const log = [];
  const { onProgress } = recorder();

  const job = batchJob(['a', 'b', 'c'], {
    completedPages: ['a.acmesites.com'],
    skippedPages: [{ page: 'b.acmesites.com', reason: 'it was taken' }],
  });

  const out = await generateForBatch(job, { onProgress, build: okBuilder(log) });

  assert.deepStrictEqual(log, ['c.acmesites.com'], 'a decided site was retried');
  assert.strictEqual(out.result.batch.failed, 1);
  assert.match(out.result.batch.sites[1].error, /it was taken/,
    'the earlier reason was lost on resume');
});

await test('and an interrupted site IS retried, because nothing decided it', async () => {
  const log = [];
  const { onProgress } = recorder();

  const job = batchJob(['a', 'b', 'c'], { completedPages: ['a.acmesites.com'] });

  await generateForBatch(job, { onProgress, build: okBuilder(log) });

  assert.ok(log.includes('b.acmesites.com'),
    'the site the process died in the middle of was never rebuilt');
});

/* ===================================================================== */

section('THE COUNTERS BELONG TO THE BATCH, NOT TO THE SITE INSIDE IT');

await test('THE INNER BUILD\'S PAGE PROGRESS NEVER BECOMES THE BATCH\'S', async () => {
  /* The inner build reports eleven pages; the batch reports three sites.
   * Forwarded straight through, `done: 7, total: 11` overwrites the batch's
   * counters and the bar jumps to 7 of 11 and then back. */
  const { seen, onProgress } = recorder();

  const build = async (one, handlers) => {
    await handlers.onProgress({ done: 7, total: 11, current: 'Water Heater Repair' });

    return { creditsCharged: 800, result: { published: { ok: true } } };
  };

  await generateForBatch(batchJob(['a', 'b', 'c']), { onProgress, build });

  for (const p of seen) {
    if (typeof p.total === 'number') {
      assert.strictEqual(p.total, 3, `the batch reported a total of ${p.total}`);
    }
    if (typeof p.done === 'number') {
      assert.ok(p.done <= 3, `the batch reported ${p.done} done out of 3`);
    }
  }

  /* AND THE INNER DETAIL IS STILL SHOWN, as text. Dropping it would leave
   * the owner watching "Site 2 of 3" for four minutes with nothing moving. */
  assert.ok(seen.some(p => /Water Heater Repair/.test(p.current || '')),
    'the page being written is never shown');
  assert.ok(seen.some(p => /Site 2 of 3/.test(p.current || '')),
    'the site being built is never named');
});

await test('AND A PAGE NAME NEVER REACHES THE LIST THE RESUME READS', async () => {
  /* completedPages on this job is the list of finished SITES. One leaked
   * page slug in there and a restart skips a site that was never built —
   * which is the quietest possible way to charge somebody for two sites and
   * give them one. */
  const { seen, onProgress } = recorder();

  const build = async (one, handlers) => {
    await handlers.onProgress({ completedPage: 'water-heater-repair', current: 'x' });
    await handlers.onProgress({ skippedPage: { page: 'toilet-repair', reason: 'rate limit' } });

    return { creditsCharged: 800, result: { published: { ok: true } } };
  };

  await generateForBatch(batchJob(['a', 'b']), { onProgress, build });

  const tags = seen.filter(p => p.completedPage).map(p => p.completedPage);
  const skips = seen.filter(p => p.skippedPage).map(p => p.skippedPage.page);

  assert.deepStrictEqual(tags, ['a.acmesites.com', 'b.acmesites.com'],
    'a page slug reached the batch\'s completed list');
  assert.deepStrictEqual(skips, [], 'a page slug reached the batch\'s skipped list');
});

await test('a failed site is recorded so the next attempt knows', async () => {
  const { seen, onProgress } = recorder();
  const build = async () => { throw new Error('it broke'); };

  await generateForBatch(batchJob(['a']), { onProgress, build });

  const skipped = seen.filter(p => p.skippedPage).map(p => p.skippedPage);

  assert.strictEqual(skipped.length, 1);
  assert.strictEqual(skipped[0].page, 'a.acmesites.com');
  assert.match(skipped[0].reason, /it broke/);
});

/* ===================================================================== */

section('WHAT ONE SITE IS HANDED');

await test('IT IS GIVEN AN EMPTY completedPages, NOT THE BATCH\'S SITE TAGS', async () => {
  /* The batch's list holds hostnames; a builder expects page slugs. Handing
   * one to the other would have it skip a page whose name happened to match
   * — a short list of strings either way, which is exactly the kind of
   * confusion that does not announce itself. */
  const job = batchJob(['a'], { completedPages: ['something.acmesites.com'] });
  const one = oneSite(job, job.payload.sites[0]);

  assert.deepStrictEqual(one.completedPages, []);
  assert.deepStrictEqual(one.uploads, {}, 'a batch site was handed an upload folder');
  assert.strictEqual(one.user, 'user-1');
  assert.strictEqual(one._id, 'job-1');
  assert.strictEqual(one.payload, job.payload.sites[0]);
});

await test('and the tag is the address, falling back to the position', async () => {
  assert.strictEqual(
    tagFor({ global: { cloudflare: { prefix: 'hvac', domain: 'acmesites.com' } } }, 0),
    'hvac.acmesites.com');

  /* THE FLAT SHAPE TOO. A replayed or urlencoded body leaves the fields as
   * `global[cloudflare][prefix]`, and wantedAddress() reads both — which is
   * why the tag is taken from it rather than from body.global directly. */
  assert.strictEqual(
    tagFor({ 'global[cloudflare][prefix]': 'plumb', 'global[cloudflare][domain]': 'acmesites.com' }, 1),
    'plumb.acmesites.com');

  /* A BATCH ENTRY WITH NO ADDRESS STILL NEEDS A NAME. An empty tag would
   * collide with every other empty tag and make the resume skip the wrong
   * site. */
  assert.strictEqual(tagFor({}, 2), 'site-3');
  assert.notStrictEqual(tagFor({}, 0), tagFor({}, 1));
});

/* ===================================================================== */

section('THE ROUTE REFUSES WHAT THE BUILDER CANNOT BUILD');

const { vetOne, MAX_SITES, globalOf } = require('./routes/generateBatchRoute');

const user = { _id: 'user-1' };

await test('THE BODY ARRIVES FLAT, AND IT IS READ AS IF IT WERE NESTED', async () => {
  /* ⚠ THIS IS THE BUG THAT MADE EVERY BATCH FAIL ON THE FIRST REAL TRY.
   *
   * A normal submission is multipart and Express expands `global[city]`
   * into `body.global.city`. A batch entry is captured in the browser with
   * FormData and posted as JSON — and JSON.parse expands nothing, so the
   * key stays the literal string `global[city]`.
   *
   * `body.global` was undefined, so localAddress() saw no address and
   * refused the batch over four fields that were filled in on screen.
   *
   *     THE SAME SUBMISSION ARRIVES IN TWO SHAPES, AND HALF THIS CODEBASE
   *     ALREADY KNOWS IT. siteTargetOf() and wantedAddress() read both,
   *     which is why the mode and destination checks passed and this did
   *     not — the failure was three checks downstream of the cause. */
  const flat = {
    'global[siteMode]': 'localoptions',
    'global[city]': 'Richardson',
    'global[cloudflare][prefix]': 'the-plumber',
    'global[locationPages][]': 'Plano',
    'global[hours][monday][open]': '09:00',
  };

  const out = globalOf(flat);

  assert.strictEqual(out.city, 'Richardson');
  assert.strictEqual(out.cloudflare.prefix, 'the-plumber');
  assert.deepStrictEqual(out.locationPages, ['Plano']);

  /* ⚠ THREE LEVELS DEEP, WHICH THE FIRST EXPANDER DROPPED. It matched
   * `global[a]` and `global[a][b]` and skipped anything further — which is
   * every opening time the wizard posts. The address came through, the
   * hours silently did not, and the refusal named seven days of business
   * hours that had been typed in.
   *
   *     A PARSER THAT HANDLES THE DEPTHS YOU THOUGHT OF
   *     DROPS THE ONES YOU DID NOT, QUIETLY. */
  assert.deepStrictEqual(out.hours.monday, { open: '09:00' });
});

await test('AND THE FLAT KEYS ARE REMOVED, NOT LEFT BESIDE THE NESTED ONES', async () => {
  /* setGlobalDomain() rewrites the domain after checkWant() approves it. A
   * reader preferring the flat copy would get the pool domain the form
   * posted rather than the hostname the site will live at — which is the
   * bug that put the wrong canonical on every page of four sites.
   *
   *     ONE DECISION MUST NOT BE READABLE UNDER TWO DIFFERENT KEYS. */
  const flat = { 'global[city]': 'Richardson', 'pages[0][filename]': 'kept' };

  globalOf(flat);

  assert.ok(!('global[city]' in flat), 'the flat copy survived the expansion');
  assert.ok('pages[0][filename]' in flat, 'a key that is not global was eaten');
});

await test('and a body that is already nested is left exactly as it is', async () => {
  /* A caller that posts the real shape — or a replayed job payload — must
   * not be re-parsed into something subtly different. */
  const nested = { global: { city: 'Richardson', cloudflare: { prefix: 'a' } } };

  assert.strictEqual(globalOf(nested), nested.global, 'a nested body was rebuilt');
});

await test('and a flat body now passes the checks it used to fail', async () => {
  /* The end-to-end version of the first test: the same entry the browser
   * sends, run through the real vetOne, must get past the address and the
   * hours and fall over at checkWant() — which needs a database and is the
   * first thing in the chain that does. */
  const flat = {
    'global[siteMode]': 'localoptions',
    'global[siteTarget]': 'cloudflare',
    'global[businessName]': 'The Richardson Plumber',
    'global[businessType]': 'plumbing',
    'global[street]': '1 Main St',
    'global[city]': 'Richardson',
    'global[state]': 'TX',
    'global[zip]': '75080',
    'global[phone]': '(214) 555-0100',
    'global[email]': 'a@b.com',
    'global[logoSource]': 'wordmark',
    'global[cloudflare][name]': 'The Richardson Plumber',
    'global[cloudflare][prefix]': 'the-richardson-plumber',
    'global[cloudflare][domain]': 'my-sites.net',
  };

  for (const d of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
    flat[`global[hours][${d}][open]`] = '09:00';
    flat[`global[hours][${d}][close]`] = '17:00';
  }

  let refusal = null;

  /* checkWant() opens Mongo, which this suite does not have — so reaching
   * it IS the assertion. Anything earlier returns {ok:false} with a message
   * about a field, and that is the failure being guarded against. */
  await vetOne(flat, { user, index: 0 })
    .then((out) => { refusal = out.ok ? null : out.message; })
    .catch(() => { refusal = null; });

  assert.strictEqual(refusal, null,
    `a filled-in submission was refused: ${refusal}`);
  assert.strictEqual(flat.global.city, 'Richardson', 'the body was not normalised');
});

await test('A BATCH IS FOR THE CLOUDFLARE DOOR, AND SAYS SO', async () => {
  /* Rank Fast and Rank GBPs carry a logo, service rows and location pages,
   * none of which this route handles.
   *
   *     A ROUTE THAT ACCEPTS A MODE IT CANNOT BUILD IS A ROUTE THAT FAILS
   *     LATER AND FOR A WORSE REASON. */
  const wrongMode = site('a');
  wrongMode.global.siteMode = 'rankfast';

  const out = await vetOne(wrongMode, { user, index: 0 });

  assert.strictEqual(out.ok, false);
  assert.match(out.message, /Local Website Options/);

  const wrongTarget = site('a');
  wrongTarget.global.siteTarget = 'github';

  const two = await vetOne(wrongTarget, { user, index: 1 });

  assert.strictEqual(two.ok, false);
  assert.match(two.message, /Cloudflare/);
  assert.match(two.message, /^Site 2/, 'the refusal does not say which site');
});

await test('AND IT REFUSES AN UPLOADED LOGO, BECAUSE UPLOADS ARE KEYED BY JOB', async () => {
  /* Three sites inside one job would share one upload folder, and the first
   * site's cleanup would take the third site's logo with it. */
  const wants = site('a');
  wants.global.logoSource = 'upload';

  const out = await vetOne(wants, { user, index: 0 });

  assert.strictEqual(out.ok, false);
  assert.match(out.message, /wordmark/);
  assert.strictEqual(out.field, 'global[logoSource]');
});

await test('and a submission that is not an object is refused by name', async () => {
  for (const bad of [null, 'a string', 42, []]) {
    const out = await vetOne(bad, { user, index: 0 });

    assert.strictEqual(out.ok, false, `${JSON.stringify(bad)} was accepted`);
    assert.match(out.message, /^Site 1/);
  }
});

await test('THE CAP EXISTS, OR ONE POST QUEUES A THOUSAND BUILDS', async () => {
  /* A batch runs inside a single job, so forty sites is a job that holds
   * the build folder for two hours. Without a cap a hand-crafted POST
   * queues a thousand against one credit check. */
  assert.ok(Number.isInteger(MAX_SITES) && MAX_SITES > 3 && MAX_SITES <= 25,
    `MAX_SITES is ${MAX_SITES}`);
});

await test('AND THE ROUTE RUNS THE SAME CHECKS IN THE SAME ORDER', async () => {
  /* The ORDER is the only part repeated from generateRoute.js, and it is
   * the part that has bitten: checkWant must run AFTER validateGlobalFields,
   * and setGlobalDomain must run AFTER checkWant — the first because the
   * address is composed from four boxes before anything validates it, the
   * second because checkWant is what proves the posted domain is in the
   * pool. Either pair the wrong way round refuses every submission.
   *
   * Read out of the source rather than exercised, because exercising it
   * needs a Mongo and a Cloudflare account. A test that cannot run is worth
   * less than one that reads the order and says so. */
  const src = require('fs').readFileSync('./routes/generateBatchRoute.js', 'utf8');
  const body = src.slice(src.indexOf('async function vetOne'));

  const at = s => body.indexOf(s);

  assert.ok(at('localAddress(') > 0, 'the four address boxes are never composed');
  assert.ok(at('localAddress(') < at('validateGlobalFields('),
    'validateGlobalFields runs before the address is composed');
  assert.ok(at('validateGlobalFields(') < at('checkWant('),
    'checkWant runs before the fields are validated');
  assert.ok(at('checkWant(') < at('setGlobalDomain('),
    'setGlobalDomain runs before checkWant has proved the domain');
});

/* ===================================================================== */

section('THE WIZARD HOOK, WHICH ONLY BREAKS IN A BROWSER');

const WIZARD = require('fs').readFileSync('./public/js/generateDinamycForm.js', 'utf8');

await test('THE BATCH LISTENER IS REGISTERED AFTER THE SUBMIT HANDLER', async () => {
  /* Listeners on one element run in the order they were added, and that
   * ordering is the whole mechanism: the handler above injects every hidden
   * mirror, and only afterwards is `new FormData(form)` the body that was
   * about to be posted.
   *
   *     CAPTURE IT ONE LISTENER EARLIER AND YOU CAPTURE A FORM
   *     THAT IS MISSING HALF ITS FIELDS.
   *
   * Nothing throws if they are swapped. The batch simply stores entries
   * with no siteMode, no styleKey and no hours, and the server refuses them
   * one at a time with a message about a field the owner did fill in.
   *
   * Asserted by position in the source, which is the only thing a Node
   * suite can see. The behaviour itself was checked in a real browser:
   * ordinary submit leaves the batch alone, an armed one captures the
   * injected mirror, and a refused one captures nothing. */
  const main = WIZARD.indexOf("form.addEventListener('submit'");
  const hook = WIZARD.indexOf('const action = pendingBatch;');

  assert.ok(main > 0, 'the main submit handler is gone');
  assert.ok(hook > 0, 'the batch hook is gone');
  assert.ok(main < hook,
    'the batch hook runs before the hidden mirrors are injected, so it '
    + 'captures a half-built form');

  /* ⚠ AND THAT IT IS A submit LISTENER AT ALL, which the first version of
   * this test did not check — a mutant that renamed the event survived it.
   * Position proves the ordering only if both are listening to the same
   * thing; a hook on an event nothing fires is in the right place and
   * never runs, and the batch silently never collects anything.
   *
   *     BEING AFTER THE RIGHT LISTENER IS NOT THE SAME AS BEING
   *     A LISTENER FOR THE RIGHT EVENT. */
  const attach = WIZARD.slice(Math.max(0, hook - 140), hook);

  assert.match(attach, /addEventListener\('submit'/,
    'the batch hook is not listening for a submit, so it never runs');
});

await test('AND THE FLAG CLEARS ITSELF WHEN A GUARD REFUSES THE SUBMIT', async () => {
  /* A guard in the main handler — a duplicate service, a missing location —
   * calls stopImmediatePropagation(), so the batch hook never runs and
   * never clears the flag. Left set, the NEXT submit would be swallowed
   * into the batch, and that next submit could be an ordinary Generate.
   *
   *     A ONE-SHOT FLAG THAT IS ONLY CLEARED ON THE HAPPY PATH
   *     IS A FLAG THAT IS STILL SET WHEN IT MATTERS.
   *
   * Checked in a browser: refuse once, then submit normally, and the hook
   * stays idle. */
  const arm = WIZARD.slice(WIZARD.indexOf('function armBatch'), WIZARD.indexOf('function armBatch') + 220);

  assert.match(arm, /setTimeout/,
    'armBatch does not clear itself, so a refused submit leaves it armed');
  assert.match(WIZARD, /const action = pendingBatch;\s*\n\s*pendingBatch = '';/,
    'the hook does not clear the flag as it reads it');
  assert.match(WIZARD, /if \(!action\) return;/,
    'the hook does not stand aside for an ordinary build');
});

await test('THE BATCH POST CARRIES THE CSRF TOKEN', async () => {
  /* ⚠ WITHOUT IT THIS IS A 403 AND AN HTML PAGE, which is what Edwin got
   * on the second real attempt.
   *
   * middleware/csrf.js guards every unsafe method and reads the token from
   * `req.body._csrf`, the `x-csrf-token` header or the query. An ordinary
   * wizard submit carries the hidden field the page renders; a fetch
   * carries nothing unless it is told to, so the batch was refused before
   * it reached the route at all.
   *
   *     EVERY POST IN THIS APP NEEDS THE TOKEN. A NEW ENDPOINT IS NOT AN
   *     EXCEPTION TO THAT, IT IS JUST A PLACE THAT HAS NOT BEEN TOLD YET.
   *
   * Read off the same meta tag spinner.js reads, which routes/formRoute.js
   * puts on the page — not a second route to the same value. */
  const post = WIZARD.slice(WIZARD.indexOf("fetch('/api/generate-batch'"),
    WIZARD.indexOf("fetch('/api/generate-batch'") + 500);

  assert.match(post, /'X-CSRF-Token': csrf/, 'the batch post sends no CSRF token');
  assert.match(WIZARD, /querySelector\('meta\[name="csrf-token"\]'\)/,
    'the token is not read from the page');

  /* AND Accept: application/json, WHICH IS WHY THE REFUSAL SAID NOTHING.
   * rejectCsrf() replies in JSON only when the request asked for JSON;
   * otherwise it renders an error PAGE, and the one sentence that explains
   * it — "Your session expired" — never reaches the person. */
  assert.match(post, /'Accept': 'application\/json'/,
    'a refusal will come back as HTML instead of a readable message');
});

await test('A REPLY THAT IS NOT JSON IS NOT AN EMPTY REPLY', async () => {
  /* ⚠ `res.json().catch(() => ({}))` TURNED AN HTML ERROR PAGE INTO AN
   * EMPTY OBJECT, so `data.error` was undefined and the alert fell through
   * to the same sentence the route says on a 500. Edwin saw "The batch
   * could not be queued." and there was no way to tell which had happened.
   *
   *     A CATCH-ALL MESSAGE THAT MATCHES A REAL ONE
   *     MAKES THE REAL ONE UNREADABLE.
   *
   * Express renders HTML for everything that never reaches a handler — a
   * body over the parser's limit, a route that is not mounted, a throw
   * before the route — which are exactly the cases that said nothing. */
  assert.match(WIZARD, /catch \(_\) \{ data = null; \}/,
    'an unreadable reply is still being turned into an empty object');
  assert.match(WIZARD, /did not say why/,
    'nothing reports the status of a reply that could not be read');

  /* AND A 200 THAT IS NOT JSON IS NOT AN ACCEPTANCE. Clearing the batch on
   * one would throw away every site typed, on the word of a reply nobody
   * could read. */
  const ok = WIZARD.indexOf('if (!data || !data.ok) {');

  assert.ok(ok > 0, 'a success is taken on trust');
  assert.ok(ok < WIZARD.indexOf('batchClear();\n          clearDraft();'),
    'the batch is cleared before the reply is confirmed');
});

await test('AND THE BATCH BODY GETS A PARSER BIG ENOUGH, MOUNTED EARLY ENOUGH', async () => {
  /* The global express.json() names no limit, so it takes the default 100
   * KB. One submission fits; ten in a `sites` array is a different size of
   * thing, and the failure is body-parser throwing before any handler runs
   * — an HTML page, not a message.
   *
   *     A LIMIT SET ON THE ROUTE IS DEAD CODE. By the time the router is
   *     reached the body has been read and the error already thrown.
   *
   * So the ordering is the assertion, not the presence. */
  const SERVER = require('fs').readFileSync('./server.js', 'utf8');
  const mine = SERVER.indexOf("app.use('/api/generate-batch', express.json(");
  const global = SERVER.indexOf('app.use(express.json({');

  assert.ok(mine > 0, 'the batch body has no parser of its own');
  assert.ok(global > 0, 'the global json parser is gone');
  assert.ok(mine < global,
    'the batch parser is mounted after the global one, so it never runs');
});

await test('AND THE TWO CAPS AGREE', async () => {
  /* The wizard refuses before somebody fills in the eleventh site; the
   * server refuses a hand-crafted POST. Two numbers that disagree means one
   * of them is wrong, and the one the owner meets is the wizard's. */
  const found = /const MAX_BATCH = (\d+);/.exec(WIZARD);

  assert.ok(found, 'the wizard has no cap at all');
  assert.strictEqual(Number(found[1]), MAX_SITES,
    `the wizard allows ${found[1]} and the server allows ${MAX_SITES}`);
});

await test('A BATCH ADD DOES NOT COME BACK AS A REFUSED SUBMIT', async () => {
  /* ⚠ THE FIRST VERSION DID, AND EDWIN HIT IT ON THE FIRST TRY. "Add
   * another site" saves the draft and reloads, which landed in the ordinary
   * draft-restore path — written for a submit that was REFUSED. He pressed
   * the button and got "Your details were kept ... we have brought you back
   * to the logo step, because choosing the file again is the one thing we
   * cannot do for you."
   *
   *   - it reads like something went wrong; nothing had
   *   - it is about a FILE FIELD, and a batch cannot contain an uploaded
   *     logo at all
   *   - NOTHING SAID THE FIRST SITE HAD BEEN SAVED: the queued list only
   *     renders on the review step, and the restore drops you on the logo
   *     step, three steps away
   *
   *     A BUTTON WHOSE ONLY VISIBLE EFFECT IS A WARNING ABOUT SOMETHING
   *     ELSE HAS NOT TOLD THE PERSON ANYTHING.
   *
   * So the reload leaves a one-shot note and the page reads it. */
  assert.match(WIZARD, /const BATCH_ADDED_KEY = /, 'the reload is not marked as ours');
  assert.match(WIZARD, /batchMarkAdded\(batchAddressOf\(entry\)\)/,
    'the reload does not record which site was added');

  /* READ ONCE. A second refresh must come back as an ordinary restore, or
   * the wizard keeps congratulating somebody for a site they added a
   * quarter of an hour ago. */
  const take = WIZARD.slice(WIZARD.indexOf('function batchTakeAdded'),
    WIZARD.indexOf('function batchTakeAdded') + 320);

  assert.match(take, /removeItem\(BATCH_ADDED_KEY\)/,
    'the note is never cleared, so every refresh repeats it');

  assert.match(WIZARD, /resumeAt = justAdded \? STEP\.MAIN : draftResumeStep\(draft\)/,
    'a batch add still lands on the logo step');
  assert.match(WIZARD, /if \(justAdded\) showBatchAddedNotice\(/,
    'a batch add still shows the refused-submit notice');
});

await test('AND THE NOTICE ESCAPES WHAT THE OWNER TYPED', async () => {
  /* The addresses come out of the form, and the notice builds HTML with
   * them. Checked in a browser too: a prefix of <img src=x onerror=...>
   * renders as text and creates no element. */
  const fn = WIZARD.slice(WIZARD.indexOf('function showBatchAddedNotice'),
    WIZARD.indexOf('function showBatchAddedNotice') + 2200);

  assert.ok(!/\$\{address\}/.test(fn), 'the address goes into HTML unescaped');
  assert.ok(!/\$\{names\}/.test(fn), 'the address list goes into HTML unescaped');
  assert.match(fn, /escapeHtml\(address\)/);
  assert.match(fn, /escapeHtml\(names\)/);

  /* escapeHtml, NOT escapeAttr — which is a SERVER helper and does not
   * exist in this file. The first version called it and would have thrown
   * a ReferenceError the moment the notice rendered. */
  assert.ok(!/escapeAttr/.test(WIZARD),
    'the wizard calls escapeAttr, which only exists on the server');
});

await test('and "start this one blank" empties the form, not the batch', async () => {
  /* Keeping the details is right for three layouts of one business and
   * wrong for three different ones, so both are offered. The batch lives
   * under its own key precisely so one can be cleared without the other. */
  const btn = WIZARD.indexOf('id="batchBlank"');

  assert.ok(btn > 0, 'there is no way to start the next site blank');

  const handler = WIZARD.slice(btn, btn + 1400);

  assert.match(handler, /clearDraft\(\)/, 'the blank button does not clear the draft');
  assert.ok(!/batchClear\(\)/.test(handler),
    'the blank button throws away the sites already put by');
});

await test('and a batch is only offered on the Cloudflare door', async () => {
  /* The other wizards carry an uploaded logo, service rows and location
   * pages. A batch cannot hold them — uploads alone are keyed by job id —
   * so the button is not there to be pressed. */
  const btn = WIZARD.indexOf("id: 'addSiteBtn'");

  assert.ok(btn > 0, 'the Add another site button is gone');

  const before = WIZARD.slice(Math.max(0, btn - 700), btn);

  assert.match(before, /'cloudflare' === LOCKED_TARGET/,
    'the button is rendered for wizards that cannot batch');
});

/* --------------------------------------------------------------------- */

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

})();
