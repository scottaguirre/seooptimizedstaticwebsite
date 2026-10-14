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
const routeSrc = code('./routes/jobRoute.js');
const from = routeSrc.indexOf('const count =');
const to = routeSrc.indexOf(';', routeSrc.indexOf('.join(', from));

assert.ok(from > -1 && to > from, 'could not find the detail line in routes/jobRoute.js');

const detailLine = new Function(
  'job', 'done', 'total',
  `const detail = {}; ${routeSrc.slice(from, to + 1)} return detail.textContent;`
);

const line = (current, done, total) => detailLine({ progress: { current } }, done, total);

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
