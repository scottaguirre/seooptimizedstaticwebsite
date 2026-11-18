// test-build-progress.js
//
// Does a build in progress report a number a person can act on?
//
// WHAT THIS IS GUARDING
//
// Edwin submitted a sixty-page build and watched it from the job page. Half
// an hour in, the folder on the server held fifty-seven .html files and the
// page said:
//
//     40%
//     Writing location pages
//
// He asked why the bar still said 40% when fifty-seven pages were built.
//
// NOTHING WAS STUCK, AND THE BAR WAS NOT LYING ABOUT ITS OWN NUMBER. The
// generator writes service pages one at a time and reports each one, then
// hands the whole list of towns to buildLocationPages — which is a BATCH. It
// reported `done` once before the call and once after it returned, with
// forty towns and twenty minutes in between. The percentage was a true
// reading of a counter that had stopped being updated.
//
// Two things were wrong, and they are different bugs:
//
//   1. the counter did not move through the longest phase of the build
//   2. the COUNT — the only figure that would have told him it was fine —
//      was drawn only when progress.current was non-empty, and the generator
//      clears that field for exactly those phases. So the page fell back to
//      a bare percentage at the moment the percentage was least use.
//
// WHAT IS WORTH ASSERTING
//
//   - the count appears whether or not a page name is in flight
//   - "37 of 60", not "37", so a number has a size
//   - each town is counted once, and only once — the batch total that used
//     to be added after the call is gone, and leaving both in would have
//     taken the bar past 100%
//   - a town that could not be generated is not counted as written
//   - a progress update that fails does not take the build down with it
//
//   node test-build-progress.js

const fs = require('fs');
const assert = require('assert');
const { siteCardState } = require('./utils/dashboardSite');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

/* THE ASYNC ONE, AND IT IS NOT A CONVENIENCE — 17 November.
 *
 * test() above calls fn() and never awaits it. Hand it an async function
 * and the promise comes straight back, the try/catch sees nothing thrown,
 * and it prints `ok` and counts a pass. Whatever the test actually asserts
 * happens later, in a rejection nobody is holding.
 *
 * Two tests written that way sat in this file passing unconditionally —
 * including the one whose whole job was to catch the broken page. The
 * Cloudflare suite lost its last test to the same shape of hole the day
 * before, from the other end: a non-awaited call after the tally.
 *
 *     A RUNNER THAT DOES NOT AWAIT TURNS EVERY ASYNC TEST INTO A TEST
 *     THAT CANNOT FAIL.
 *
 * Kept as a SECOND function rather than making test() async, because then
 * every one of the forty synchronous calls in this file would have to be
 * awaited to keep the tally honest, and one missed would be this bug
 * again. */
async function asyncTest(name, fn) {
  try { await fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

/* Async tests are collected and run at the end, where they can be awaited
 * before the tally is printed. */
const deferred = [];

function laterTest(name, fn) { deferred.push([name, fn]); }
function section(n) { console.log(`\n${n}\n`); }

/* Source with comments stripped.
 *
 * Four times this project has had a source check match the comment that was
 * EXPLAINING the bug, and once that refused a deploy on correct code. The
 * comments in the three files below describe the old behaviour at length. */
const code = file => fs.readFileSync(require.resolve(file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------------------
section('The job page, driven for real');
// ---------------------------------------------------------------------------

/* THE DETAIL LINE IS LIFTED OUT OF THE PAGE AND RUN.
 *
 * It lives inside a template literal in the route, so no unit test can reach
 * it in place — and a regex asserting "the source mentions total" would have
 * passed before the fix as happily as after it. The two statements are
 * extracted and evaluated instead, so what is tested is what the browser
 * actually computes. */
/* -------------------------------------------------------------------------
 * THE PAGE'S OWN SCRIPT HAS TO PARSE
 *
 * EVERY OTHER CHECK IN THIS SUITE LIFTS A FUNCTION OUT OF THE SOURCE AND
 * RUNS IT. That is useful, and it is blind to the one failure that takes the
 * whole page down: this page is a TEMPLATE LITERAL, so the text in the file
 * and the text the browser receives are not the same text.
 *
 * It happened on 17 November. finishedLine() tested the scheme with a
 * regular expression, backslash before each slash — correct JavaScript in
 * the file. Inside a template literal a backslash is an ESCAPE, so each pair
 * collapsed and the browser got a short regex followed by what it read as a
 * line comment. A syntax error is refused WHOLE, so nothing on the page ran:
 * no polling, no progress, no finish.
 *
 *     The bar sat at nought per cent and the stage said "Starting..."
 *     while the build ran, finished and published behind it.
 *
 * Edwin: *"i tried to build a githun site and it got stuck and never even
 * started"*. It had not. It was already done — the page simply never asked.
 *
 *     node --check READS THE FILE. ONLY RENDERING THE PAGE READS WHAT THE
 *     BROWSER READS.
 *
 * A backtick in a comment had taken the same file down four days earlier,
 * in the same way, for the same reason. That one at least failed loudly at
 * startup; this one shipped.
 * ---------------------------------------------------------------------- */

const vm = require('vm');
const Job = require('./models/Job');

/** The page as a browser gets it, with the model stubbed out. */
async function renderJobPage(job = {}) {
  const REAL = Job.findById;

  Job.findById = () => ({
    lean: async () => Object.assign({
      _id: 'a'.repeat(24),
      user: 'u1',
      status: 'running',
      kind: 'site',
      progress: { done: 0, total: 0 },
    }, job),
  });

  try {
    const router = require('./routes/jobRoute');
    const layer = router.stack.find(l =>
      l.route && l.route.path === '/jobs/:id' && l.route.methods.get);

    assert.ok(layer, 'GET /jobs/:id is not on the router');

    const handle = layer.route.stack[layer.route.stack.length - 1].handle;

    let html = '';
    const res = {
      locals: { csrfField: '' },
      set() { return this; },
      status() { return this; },
      send(body) { html = String(body); return this; },
    };

    await handle({
      user: { _id: 'u1' },
      session: { userId: 'u1' },
      params: { id: 'a'.repeat(24) },
      query: {},
      id: 'r1',
    }, res);

    return html;
  } finally {
    Job.findById = REAL;
  }
}

/** The inline poller, as emitted — not as written. */
function emittedScript(html) {
  const blocks = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]);

  return blocks.find(b => b.includes('const jobId'));
}

laterTest('THE SCRIPT THE BROWSER RECEIVES IS VALID JAVASCRIPT', async function () {
  const html = await renderJobPage();
  const script = emittedScript(html);

  assert.ok(script, 'the polling script is not in the rendered page at all');

  /* COMPILED, NOT RUN. new vm.Script() parses and throws on a syntax error
   * without executing a line — which is what the browser does first and
   * what it refused to get past. Running it would need a DOM. */
  assert.doesNotThrow(
    () => new vm.Script(script, { filename: 'jobs-page-inline.js' }),
    'the progress page ships broken JavaScript, so nothing on it runs'
  );
});

laterTest('and it still polls, which is the thing that broke', async function () {
  /* A script that parses and does not poll would pass the test above and
   * leave the page just as dead. */
  const script = emittedScript(await renderJobPage());

  assert.match(script, /fetch\(/, 'the page never asks the server anything');
  assert.match(script, /setTimeout\(poll/, 'the page asks once and never again');
});

test('AND NO ESCAPE SURVIVES THE TEMPLATE LITERAL INTO THE SCRIPT', function () {
  /* THE RULE, STATED WHERE IT CAN FAIL. The test above catches a backslash
   * that breaks the syntax; this catches one that does not — a regex that
   * still parses but matches something else is the quieter half of the same
   * bug, and no amount of rendering would show it.
   *
   * Read off the SOURCE, inside the page literal only: a backslash there is
   * either an intended escape of the literal or a mistake, and this file has
   * no legitimate use for one. */
  const src = code('./routes/jobRoute.js');

  const open = src.indexOf('res.send(`<!DOCTYPE html>');
  assert.ok(open > -1, 'the page literal has moved; this test cannot find it');

  const literal = src.slice(open);
  const offenders = literal.split('\n')
    .map((line, i) => ({ line, n: i }))
    .filter(({ line }) => /\\[^\\]/.test(line));

  assert.deepStrictEqual(offenders.map(o => o.line.trim()), [],
    'a backslash inside the page template is an escape the browser never sees');
});

const routeSrc = code('./routes/jobRoute.js');
const from = routeSrc.indexOf('const count =');
const to = routeSrc.indexOf(';', routeSrc.indexOf('.join(', from));

assert.ok(from > -1 && to > from, 'could not find the detail line in routes/jobRoute.js');

const detailLine = new Function(
  'job', 'done', 'total',
  `const detail = {}; ${routeSrc.slice(from, to + 1)} return detail.textContent;`
);

const line = (current, done, total) => detailLine({ progress: { current } }, done, total);

/* THE FINISHED LINE IS LIFTED OUT AND RUN TOO.
 *
 * Same reason as the detail line above: it lives inside a template literal
 * in the route, so nothing can reach it in place, and a regex over the
 * source would pass on the comment explaining it. This one was written as a
 * PURE FUNCTION returning pieces rather than markup precisely so it could
 * be run here — the DOM beside it is built from these by hand. */
const finishedFrom = routeSrc.indexOf('function finishedLine');
assert.ok(finishedFrom > -1, 'finishedLine has been renamed or removed from routes/jobRoute.js');

const finishedTo = routeSrc.indexOf('\n      }', finishedFrom) + '\n      }'.length;

const finishedLine = new Function(
  `${routeSrc.slice(finishedFrom, finishedTo)} return finishedLine;`
)();

test('A FINISHED BUILD SAYS WHERE IT WENT', function () {
  /* EDWIN, 17 November. A Cloudflare build finishes on a hostname nobody
   * has seen — typed on the review step, several minutes and a whole build
   * earlier — and this page said only "Your website is ready" over a
   * button. The one fact wanted at that moment, WHERE IS IT, was a click
   * away.
   *
   * The old two-step flow did not have this problem: you had typed the
   * address on the previous screen. Shortening the errand is what moved it
   * out of sight. */
  const out = finishedLine({
    creditsCharged: 400,
    published: { ok: true, url: 'https://leander-chiropractor.1-1o.com' },
  });

  assert.strictEqual(out.url, 'https://leander-chiropractor.1-1o.com');
  assert.strictEqual(out.host, 'leander-chiropractor.1-1o.com',
    'the address is shown with its scheme, which is noise in a hostname');
  assert.strictEqual(out.credits, '400 credits were used.',
    'the credits line was lost when the address was added beside it');
});

test('and a build that published nowhere still reports its credits', function () {
  /* Most builds. The line must not go blank for them — it was the only
   * thing there before the address existed. */
  const out = finishedLine({ creditsCharged: 400, published: null });

  assert.strictEqual(out.url, '');
  assert.strictEqual(out.credits, '400 credits were used.');
});

test('and a FAILED publish is not announced as an address', function () {
  /* `published` is present and carries a url on the GitHub path even when
   * ok is false. Reading the url without the flag would print "Live at"
   * over a site that is not live — under an amber bar saying it is not. */
  const out = finishedLine({
    creditsCharged: 400,
    published: { ok: false, error: 'no room', url: 'https://hvac.1-1o.com' },
  });

  assert.strictEqual(out.url, '',
    'a build that did not publish is reported as live');
});

test('AND ONLY https REACHES THE href', function () {
  /* The value comes from our own database by way of jobGenerator, so this
   * is belt. It is one line against a class of bug that would be somebody
   * else's mistake three files away, in a value that ends up in an href. */
  for (const url of ['javascript:alert(1)', 'http://hvac.1-1o.com', '//evil.test', 42, null]) {
    assert.strictEqual(finishedLine({ published: { ok: true, url: url } }).url, '',
      `${String(url)} was accepted as a published address`);
  }
});

test('a page in flight is named, with the count beside it', function () {
  assert.strictEqual(line('Leander, TX', 37, 60), 'Leander, TX  —  37 of 60 pages');
});

test('THE COUNT SURVIVES AN EMPTY PAGE NAME', function () {
  /* The whole of the second bug. `current` is cleared when the generator
   * enters the location batch, when it leaves it, and while it writes the
   * sitemap — and the count used to be inside the branch that needed a page
   * name, so it vanished for the longest stretch of the build. */
  assert.strictEqual(line('', 37, 60), '37 of 60 pages');
});

test('and there is no stray dash when there is nothing to put in front of it', function () {
  assert.ok(!/^\s*—/.test(line('', 37, 60)), `the line starts with a separator: "${line('', 37, 60)}"`);
  assert.ok(!/—\s*$/.test(line('Leander, TX', 0, 0)), 'the line ends with a separator');
});

test('nothing known yet shows nothing', function () {
  /* The first seconds, before the job has reported. An empty line is
   * correct; "0 of 0 pages" is not. */
  assert.strictEqual(line('', 0, 0), '');
});

test('a job with no total still shows what it has', function () {
  /* Blog posts and ZIP builds run with total 0 — one unit of work with no
   * meaningful fraction. The page name alone is all there is to say. */
  assert.strictEqual(line('Writing the post', 0, 0), 'Writing the post');
});

test('the last page reads as the last page', function () {
  assert.strictEqual(line('sitemap.xml', 60, 60), 'sitemap.xml  —  60 of 60 pages');
});

// ---------------------------------------------------------------------------
section('The dashboard card says the same thing');
// ---------------------------------------------------------------------------

const SITE = { pageCount: 41, location: 'Leander, TX', generatedAgo: '4 minutes ago' };
const running = progress => ({ _id: 'job-1', status: 'running', progress });

test('a build in flight is "37 of 60 pages so far"', function () {
  assert.match(
    siteCardState(SITE, running({ done: 37, total: 60 })).subtitle,
    /37 of 60 pages so far/
  );
});

test('THE PAIR IS COUNTED FROM THE JOB, NOT FROM THE FOLDER', function () {
  /* The two count different things. The job's total is services + towns +
   * the home page; the folder also holds contact, privacy, terms and
   * accessibility, so late in a build the file count OVERTAKES the total.
   *
   * SITE.pageCount is 41 here against a total of 60 and 37 reported done —
   * a card reading "41 of 60" would be mixing the two, and at the end of the
   * same build it would read "63 of 60". */
  const subtitle = siteCardState(SITE, running({ done: 37, total: 60 })).subtitle;

  assert.ok(!/41/.test(subtitle), `the card is counting files on disk: "${subtitle}"`);
});

test('a job that has not reported yet falls back to the files on disk', function () {
  /* The gap at the start: the job row exists, progress is still zero, and
   * pages are already being written. Without the fallback the card would say
   * "just started" for the first page or two of every build. */
  const subtitle = siteCardState(SITE, running({ done: 0, total: 60 })).subtitle;

  assert.match(subtitle, /41 pages so far/);
  assert.ok(!/of 60/.test(subtitle),
    'a disk count is being presented as a fraction of the job total');
});

test('and a total below the count is not shown as a fraction', function () {
  /* "63 of 60 pages" reads as a bug in the page rather than a nearly
   * finished build. */
  const subtitle = siteCardState({ ...SITE, pageCount: 63 }, running({ done: 63, total: 60 })).subtitle;

  assert.ok(!/of 60/.test(subtitle), `the card reads "${subtitle}"`);
  assert.match(subtitle, /63 pages so far/);
});

test('no progress at all still says it has just started', function () {
  assert.match(siteCardState(null, { _id: 'j', status: 'queued' }).subtitle, /just started/i);
  assert.match(siteCardState(null, running({ done: 0, total: 60 })).subtitle, /just started/i);
});

test('and junk in progress does not throw', function () {
  /* This is the page people land on after logging in. A fatal here is the
   * whole dashboard, not one card. */
  for (const progress of [undefined, null, 'soon', 7, { done: 'x', total: 'y' }]) {
    assert.strictEqual(siteCardState(SITE, running(progress)).state, 'building');
  }
});

test('one page of one reads as a page', function () {
  assert.match(siteCardState(SITE, running({ done: 1, total: 1 })).subtitle, /\b1 of 1 page\b/);
  assert.match(siteCardState(SITE, running({ done: 1, total: 60 })).subtitle, /\b1 of 60 pages\b/);
});

// ---------------------------------------------------------------------------
section('The generator counts each town as it lands');
// ---------------------------------------------------------------------------

/* WHY THESE ARE STRUCTURAL AND NOT BEHAVIOURAL.
 *
 * Driving buildLocationPages means a page template, an image library, a
 * Google Maps embed and one OpenAI call per town. The assertions below are
 * about WHERE the report happens, which is the thing that was wrong: the
 * reporting itself is one line. So the positions are compared rather than
 * grepped for — a callback that exists but sits outside the loop, or before
 * the page is written, fails here. */
const builder = code('./utils/buildLocationPages.js');

const at = (haystack, needle, label) => {
  const i = haystack.indexOf(needle);
  assert.ok(i > -1, label || `not found: ${needle}`);
  return i;
};

test('the builder takes a progress callback, and it is optional', function () {
  /* Optional and LAST. Seven positional arguments are already being passed
   * by runGeneration; a new one anywhere else would silently shift them. */
  const signature = builder.slice(
    at(builder, 'const buildLocationPages'),
    at(builder, 'if (!(globalValues.wantsLocationPages')
  );

  assert.match(signature, /onPageWritten\s*=\s*null/,
    'the callback has no default, so every existing caller breaks');
  assert.ok(
    signature.indexOf('usedFaqQuestions') < signature.indexOf('onPageWritten'),
    'the callback was inserted before an existing parameter'
  );
});

/* The span of the per-town loop's BODY, by matching its braces.
 *
 * "After the `for` and before the `return`" is not the same thing as "inside
 * the loop", and the difference is the entire bug — a report that runs once
 * after forty towns satisfies the first and fails the second. Found by
 * mutation: moving the call below the loop's closing brace left the cheaper
 * version of this test passing.
 *
 * Counting braces is safe here only because comments are already stripped;
 * a lone brace in a comment would throw the match off. */
function loopBody(src) {
  const open = src.indexOf('{', at(src, 'for (const [index, locationPage]'));
  let depth = 0;

  for (let i = open; i < src.length; i++) {
    if ('{' === src[i]) depth++;
    else if ('}' === src[i] && 0 === --depth) return [open, i];
  }

  throw new Error('the per-town loop has no closing brace');
}

test('IT IS CALLED INSIDE THE LOOP, ONCE THE PAGE IS ON DISK', function () {
  /* The bug this whole file is about was a report OUTSIDE the loop. A
   * callback called after the loop would be the same bug with more code. */
  const [open, close] = loopBody(builder);
  const write = at(builder, 'fs.writeFileSync(path.join(distDir, `location-');
  const call = at(builder, 'onPageWritten(', 'the callback is never called');

  assert.ok(call > open && call < close,
    'the callback is called outside the per-town loop — once for the batch, which is the bug it fixes');
  assert.ok(write < call, 'the callback is called before the page is written to disk');
});

test('a town that could not be generated is not counted', function () {
  /* The content generator returns null when the model JSON cannot be
   * parsed; that town is skipped and the build carries on. Counting it
   * would promise a page that does not exist — and the model list the
   * builder returns would then disagree with the count. */
  const skip = at(builder, 'skipped.push(');
  const call = at(builder, 'onPageWritten(');

  assert.ok(skip < call, 'the skip guard no longer runs before the progress report');
  assert.match(
    builder.slice(skip, call),
    /continue;/,
    'a skipped town falls through to the progress report instead of continuing'
  );
});

test('AND A FAILED PROGRESS UPDATE DOES NOT KILL THE BUILD', function () {
  /* The callback writes to Mongo. A dropped connection during an update
   * must not throw away a page already written to disk and abandon the
   * towns after it: a stalled bar is cosmetic, a lost build is not. */
  const call = at(builder, 'onPageWritten(');
  const guarded = builder.slice(Math.max(0, call - 400), call + 300);

  assert.match(guarded, /try\s*\{/, 'the progress report is not guarded');
  assert.match(guarded, /catch/, 'the progress report has no catch');
  assert.match(guarded, /typeof\s+onPageWritten/,
    'the callback is called without checking there is one');
});

// ---------------------------------------------------------------------------
section('And it counts each town exactly once');
// ---------------------------------------------------------------------------

const gen = code('./utils/runGeneration.js');

test('the callback is passed, and it reports', function () {
  const call = at(gen, 'buildLocationPages(');
  const block = gen.slice(call, at(gen, 'buildSitemap(distDir'));

  assert.match(block, /pagesDone \+= 1/, 'the callback does not advance the counter');
  assert.match(block, /report\(/, 'the callback does not report anything');

  /* AND IT NAMES THE TOWN. Found by mutation: reporting the count with an
   * empty `current` left every assertion above passing, and the line under
   * the bar would read "37 of 60 pages" for twenty minutes without ever
   * saying which of the forty towns was being written. The service-page loop
   * names its page; this is the same promise. */
  assert.match(block, /current:\s*written\.\w+/,
    'the progress report does not name the town that was just written');
});

test('THE BATCH TOTAL IS NO LONGER ADDED AFTERWARDS', function () {
  /* Found by asking what the old line does once the new one exists: the
   * towns would be counted twice — forty towns reported one at a time and
   * then forty added in a lump — and the bar would sail past 100% while the
   * card claimed more pages than the site has.
   *
   * This is the one assertion in the file that guards against a correct
   * change being made twice. */
  assert.ok(
    !/pagesDone \+= builtLocations\.length/.test(gen),
    'locations are counted both one at a time and as a batch'
  );
  assert.ok(
    !/pagesDone \+= [a-zA-Z]*[Ll]ocations?[a-zA-Z]*\.length/.test(gen),
    'the batch count is still being added under another name'
  );
});

test('THE FIXED PAGES ARE COUNTED, FROM THE SAME LIST THE TOTAL USES', function () {
  /* The total includes contact and the three legal pages — Edwin asked for
   * it to match what is in the folder. That means the counter has to include
   * them too, and the two are computed in different files: the route sets
   * the total from pagesToBuild() when the job is created, the generator
   * advances the counter twenty minutes later.
   *
   * MISS THEM AND EVERY BUILD ENDS AT FOUR PAGES SHORT OF 100%, which
   * nothing reports and nobody sees until a long run finishes.
   *
   * The length of the shared list, not a 4: a fifth fixed page would
   * otherwise move the total and leave the counter behind. */
  assert.match(gen, /FIXED_PAGES/,
    'the generator does not count the contact and legal pages at all');
  assert.match(gen, /pagesDone \+= FIXED_PAGES\.length/,
    'the generator counts the fixed pages with its own number instead of the shared list');
  assert.match(gen, /require\('\.\/seoPresets'\)/,
    'FIXED_PAGES is not imported from where pagesToBuild reads it');

  /* And not for a design sample, which writes one page and no legal pages
   * at all — pagesToBuild returns 1 for it, so counting four here would
   * finish a one-page sample at 500%. */
  const block = gen.slice(at(gen, 'pagesDone += FIXED_PAGES.length') - 200,
                          at(gen, 'pagesDone += FIXED_PAGES.length'));

  assert.match(block, /if \(!isSample\)/,
    'a one-page design sample counts four pages it never writes');
});

test('and the counter reaches the total for a real site', function () {
  /* The arithmetic both halves have to agree on, done once here so a change
   * to either side shows up as a failure rather than as a bar that stops at
   * 94%.
   *
   * 3 services + 2 towns + home + 4 fixed = 10, and the generator counts:
   * 3 (one per service page) + 1 (home) + 4 (fixed) + 2 (one per town). */
  const { pagesToBuild, FIXED_PAGES } = require('./utils/seoPresets');

  const services = 3, towns = 2;
  const total = pagesToBuild('lead', { 0: {}, 1: {}, 2: {} }, towns);
  const counted = services + 1 + FIXED_PAGES.length + towns;

  assert.strictEqual(counted, total,
    `the generator counts ${counted} pages on a build whose total is ${total}`);
});

test('a design sample still finishes at exactly one page', function () {
  const { pagesToBuild } = require('./utils/seoPresets');

  /* It writes the home page and nothing else, whatever the wizard collected
   * on the steps before. */
  assert.strictEqual(pagesToBuild('sample', { 0: {}, 1: {} }, 5), 1);
});

test('and the stage line is still cleared when the batch finishes', function () {
  /* The last report in that phase exists for one reason: `current` names a
   * town while the batch runs, and leaving it set would have the page
   * naming a town that finished ten minutes ago. */
  const after = gen.slice(
    at(gen, 'const builtLocations ='),
    at(gen, 'CM.addPages(contentModel, builtLocations)')
  );

  assert.match(after, /report\(\s*\{[^}]*current:\s*''/,
    'nothing clears the page name after the location batch');
});

// ---------------------------------------------------------------------------
section('Every job kind the runner can produce has a page to land on');
// ---------------------------------------------------------------------------

test('the progress page knows every kind the Job model accepts', function () {
  /* A KIND IS ADDED IN FOUR PLACES AND FORGOTTEN IN ONE. The Job model's
   * enum, the route that enqueues it, the generator registered with the
   * runner, and the wording on this page. Miss the last and the job runs
   * perfectly while the person watching it is told their WEBSITE IS BEING
   * BUILT and sent to the dashboard when it finishes — the COPY table falls
   * back to `site` for anything it does not recognise, so nothing breaks and
   * nothing is right.
   *
   * Read off the model rather than listed here, so adding a kind without
   * giving it wording fails at this line instead of in front of a
   * customer. */
  const Job = require('./models/Job');
  const kinds = Job.schema.path('kind').enumValues;

  const table = routeSrc.slice(routeSrc.indexOf('const COPY = {'),
                               routeSrc.indexOf('const copy = COPY['));

  assert.ok(table, 'could not find the wording table in routes/jobRoute.js');

  for (const kind of kinds) {
    assert.ok(new RegExp(`\\b${kind}\\s*:`).test(table),
      `job kind '${kind}' has no wording on the progress page, so it would be `
      + 'described as a website build');
  }
});

test('a publish that failed is told to the person, not only to the log', function () {
  /* 11 NOVEMBER, TWICE. Two Local Website Options builds published nothing
   * — one hit "Reference already exists", one "Git Repository is empty." —
   * and both jobs reported `completed` with 800 credits charged. The page
   * said "Your website is ready" over a repository holding one file.
   *
   * runLocalOptions is right not to fail the build: the pages exist and the
   * writing is paid for. But the job has to SAY so, and the value that knew
   * was being dropped between the builder and the runner. */
  assert.match(routeSrc, /published:\s*\(job\.result && job\.result\.published\)/,
    'the API does not expose whether the site went live');

  /* SEARCHED FORWARD FROM THE COMPLETED BRANCH, because "job.status ===
   * 'failed'" also appears earlier, in the API handler's error field — and
   * slicing to the first match gave a backwards range that matched nothing
   * and passed for the wrong reason. */
  const from = routeSrc.indexOf("job.status === 'completed'");
  const done = routeSrc.slice(from, routeSrc.indexOf("job.status === 'failed'", from));

  assert.ok(done.length > 100, 'could not find the completed branch in routes/jobRoute.js');

  /* THE CONDITION, NOT JUST THE MENTION. Asserting that "job.published"
   * appears somewhere in the branch passed even with the guard replaced by
   * `if (false)` — the message body still names it. What matters is that
   * something BRANCHES on it. */
  const guard = done.match(/if \(([^)]*job\.published[^)]*)\)/);

  assert.ok(guard, 'nothing in the completed state branches on the publish outcome');
  assert.match(guard[1], /\.ok\b/,
    'the guard names job.published but does not test whether it succeeded');
  assert.match(done, /bg-warning/,
    'a build that published nothing still shows a green bar');
});

test('and the builder hands that outcome to the runner', function () {
  /* The runner persists `result.result` and nothing else, so a builder that
   * returns `published` at the top level is returning it to no one. This is
   * the join the bug fell through. */
  const gen = code('./utils/jobGenerator.js');

  assert.match(gen, /result\.published !== undefined/,
    'jobGenerator does not carry the publish outcome');
  assert.match(gen, /published:/,
    'it does not put it where the runner will persist it');
});

test('and every kind has a generator registered for it', function () {
  /* WORSE THAN FAILING: NEVER RUNNING. claimNextJob only claims kinds this
   * process has a generator for — a guard that exists so a half-deployed
   * instance does not grab work it cannot do. A kind in the model with
   * nothing registered therefore queues jobs that are never claimed, never
   * fail, never time out and never appear anywhere. The person watches a
   * progress page that will say "queued" until they give up.
   *
   * Read off the model again, so the two halves cannot drift. */
  const Job = require('./models/Job');
  const serverSrc = code('./server.js');

  for (const kind of Job.schema.path('kind').enumValues) {
    assert.match(serverSrc, new RegExp(`registerGenerator\\(\\s*'${kind}'`),
      `job kind '${kind}' has no generator registered in server.js, so a job of `
      + 'that kind would sit queued for ever without being claimed');
  }
});

test('and a re-render shows no progress bar, because it can count nothing', function () {
  /* A re-render writes its pages from a stored recipe in one pass. A bar
   * claiming a total it cannot measure stalls at a number and looks stuck,
   * which is worse than no bar at all. */
  const line = routeSrc.slice(routeSrc.indexOf('const indeterminate ='));

  assert.match(line.slice(0, 200), /cfedit/,
    'a re-render is given a progress bar it cannot fill');
});

(async () => {
  for (const [name, fn] of deferred) await asyncTest(name, fn);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
