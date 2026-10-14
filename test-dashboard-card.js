// test-dashboard-card.js
//
// What the dashboard says about a website that is still being built.
//
// WHAT THIS IS GUARDING
//
// Edwin submitted a sixty-page build, closed the tab, came back to the
// dashboard, and read:
//
//     Your current website
//     22 pages · generated 2 minutes ago     [Preview] [Download] [Convert]
//
// He pressed Preview and got `Cannot GET /dist/user_6a85…/`. His first
// question was whether closing the tab had crashed the server.
//
// Nothing was broken. getCurrentSite() counts the .html files on disk, and
// twenty-two existed — but index.html is written near the END of a build,
// with the About Us page, and express.static has nothing to serve for a
// directory that has not got one.
//
// THE COUNT WAS HONEST AND THE VERB WAS NOT. "Generated 2 minutes ago"
// describes a finished thing. A file count cannot tell finished from half
// way; the job queue can. So the STATE comes from the job and the count stays
// underneath it as detail.
//
// WHAT IS WORTH ASSERTING, which is not "the subtitle has the right words"
//
//   - a running build is never described as generated
//   - and never offers a button that 404s
//   - a finished site is unaffected — this is the common case and it shipped
//     for months
//   - a job that is neither queued nor running is not a build in flight
//
//   node test-dashboard-card.js

const assert = require('assert');
const { siteCardState, ACTIVE } = require('./utils/dashboardSite');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}
function section(n) { console.log(`\n${n}\n`); }

/** What getCurrentSite() hands back for a directory with pages in it. */
const SITE = {
  pageCount: 37,
  location: 'Leander, TX',
  generatedAgo: '4 minutes ago',
  businessName: 'Quality Plumbing',
};

const RUNNING = { _id: 'job-1', status: 'running' };

section('While a build is in flight');

test('the card says it is still generating', function () {
  const card = siteCardState(SITE, RUNNING);

  assert.strictEqual(card.state, 'building');
  assert.match(card.subtitle, /still generating/i);
});

test('AND NEVER SAYS "GENERATED"', function () {
  /* The word that cost the morning. It describes a finished thing, and the
   * thing was half written. */
  const card = siteCardState(SITE, RUNNING);

  assert.ok(
    !/generated/i.test(card.subtitle),
    `a build in flight is described as "${card.subtitle}"`
  );
});

test('it carries the job, so the card can link to the progress page', function () {
  assert.strictEqual(siteCardState(SITE, RUNNING).jobId, 'job-1');
});

test('and the page count is still shown, because it is honestly known', function () {
  /* Those files really are on disk. What changes is the verb: "37 pages so
   * far" invites waiting, "37 pages generated" invites pressing a button
   * that 404s. */
  assert.match(siteCardState(SITE, RUNNING).subtitle, /37 pages so far/);
});

test('A BUILD WITH NOTHING ON DISK YET SAYS SO', function () {
  /* The first minute, before any page is written. "0 pages so far" reads as
   * a stall on something that has been running for ten seconds. */
  const card = siteCardState(null, RUNNING);

  assert.strictEqual(card.state, 'building');
  assert.match(card.subtitle, /just started/i);
  assert.ok(!/\b0 pages\b/.test(card.subtitle), 'it reports zero pages instead of saying it has just started');
});

test('a queued job counts as building too', function () {
  /* Queued means the work is accepted and waiting its turn. From the owner's
   * side that is indistinguishable from running, and the buttons would 404
   * either way. */
  assert.strictEqual(siteCardState(SITE, { _id: 'j', status: 'queued' }).state, 'building');
});

section('When nothing is running');

test('a finished site is unaffected', function () {
  const card = siteCardState(SITE, null);

  assert.strictEqual(card.state, 'ready');
  assert.match(card.subtitle, /37 pages/);
  assert.match(card.subtitle, /generated 4 minutes ago/);
  assert.match(card.subtitle, /Leander, TX/);
});

test('AND A FINISHED JOB DOES NOT MAKE IT LOOK BUSY', function () {
  /* The job record outlives the build. Reading "is there a job" rather than
   * "is there a RUNNING job" would leave the card saying "still generating"
   * for ever after the first successful build. */
  for (const status of ['completed', 'failed', 'cancelled', '']) {
    const card = siteCardState(SITE, { _id: 'j', status });

    assert.strictEqual(
      card.state, 'ready',
      `a ${status || 'blank'} job is being treated as a build in flight`
    );
  }
});

test('no site and no job shows nothing at all', function () {
  assert.strictEqual(siteCardState(null, null).state, 'none');
});

test('and junk does not throw', function () {
  /* This runs on the page people land on after logging in. A fatal here is
   * the whole dashboard, not one card. */
  assert.strictEqual(siteCardState(undefined, undefined).state, 'none');
  assert.strictEqual(siteCardState(null, {}).state, 'none');
  assert.strictEqual(siteCardState(SITE, {}).state, 'ready');
});

section('One page reads as one page');

test('the plural is right at both ends', function () {
  assert.match(siteCardState({ ...SITE, pageCount: 1 }, null).subtitle, /\b1 page\b/);
  assert.match(siteCardState({ ...SITE, pageCount: 1 }, RUNNING).subtitle, /\b1 page so far\b/);
});

section('The list of statuses that mean "in flight"');

test('is exported, so the dashboard query and this rule cannot drift', function () {
  /* The route asks the database for jobs with these statuses; this file
   * decides what to say about one. Two separate lists would disagree the
   * first time a status was added — the card would describe a build the
   * query never found, or the query would find one the card calls finished. */
  assert.deepStrictEqual(ACTIVE, ['queued', 'running']);
});

section('The two route changes, which no unit test reaches');

/* These are three lines of wiring inside route handlers. Driving them would
 * mean stubbing Express, a session, Mongo and the CSRF field — so they are
 * read, with comments stripped first. This project has been bitten four times
 * by source checks matching a comment that was EXPLAINING the bug, and once
 * this week that refused a deploy on correct code. */
const fs = require('fs');

const code = file => fs.readFileSync(require.resolve(file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('THE DASHBOARD ASKS THE JOB QUEUE, NOT ONLY THE FILESYSTEM', function () {
  /* The whole fix. Without this lookup the card has nothing to decide with,
   * and siteCardState() above is never handed a job to notice. */
  const src = code('./routes/authRoute.js');

  assert.ok(/siteCardState\(/.test(src), 'the dashboard no longer asks what state the card is in');
  assert.ok(/Job\.findOne\(/.test(src), 'the dashboard no longer looks for a running build');
  assert.ok(/status:\s*\{\s*\$in:\s*ACTIVE\s*\}/.test(src),
    'the query spells the statuses out instead of sharing the exported list');
});

test('and a building card offers the progress link INSTEAD of the buttons', function () {
  const src = code('./routes/authRoute.js');

  const card = src.slice(src.indexOf('buildingCard'), src.indexOf('const siteCard'));

  assert.ok(/\/jobs\/\$\{cardState\.jobId\}/.test(card), 'there is no link to the progress page');
  assert.ok(!/dlStatic|export-wp-theme|previewUrl/.test(card),
    'the building card still offers a download, convert or preview button');

  /* AND IT IS ACTUALLY CHOSEN — found by mutation. Deleting the branch that
   * selects it left this passing, because the card was still DEFINED a few
   * lines above and the slice above still found its markup. A card nothing
   * renders is dead code that reads as a feature. */
  assert.ok(
    /'building'\s*===\s*cardState\.state\s*\?\s*buildingCard/.test(src),
    'the building card is defined and never rendered'
  );
});

test('THE PROGRESS PAGE REFUSES TO BE SERVED FROM THE BACK BUTTON', function () {
  /* Pressing Back hands you a frozen copy of the page — markup and paused
   * JavaScript. Edwin saw "40% — Writing location pages" from the moment he
   * left, on a build that had moved on, and asked whether it was stuck.
   *
   * The polling does not save it: the snapshot's timers are frozen too, so
   * the page never resumes and corrects itself. no-store is what disables
   * that cache. */
  const src = code('./routes/jobRoute.js');

  assert.ok(/Cache-Control/i.test(src), 'the progress page sets no cache headers at all');
  assert.ok(/no-store/.test(src), 'the progress page can still be served from the back-button cache');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
