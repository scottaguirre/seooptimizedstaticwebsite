// test-local-options.js
//
// Local Website Options — the mode itself.
//
// A FIXED SITE: home, six service pages, contact and the three legal pages.
// Eleven files, every time, whatever the wizard collected. Its own renderer,
// its own prompt, its own interlink ring, published to GitHub Pages.
//
// WHY THIS FILE EXISTS BEFORE THE RENDERER DOES
//
// Because the mode is a STRING in four places that must agree, and three of
// those four are silent when they do not:
//
//   utils/seoPresets.js   normalizeSiteMode() falls back to 'lead' for
//                         anything not in PRESETS. Not an error — a lead
//                         site, built and charged for
//   models/Job.js         an enum. THIS one throws, at Job.create(), after
//                         the credit check has passed and the customer has
//                         been told the build is starting
//   utils/pricing.js      an unknown mode falls through to the lead branch
//                         and prices whatever was posted
//   the wizard            still to come
//
// 'rankfast' was added to three of those and not to Job.js, and every Rank
// Fast generation died on the fourth. The comment in models/Job.js says it
// outright: "Whatever normalizeSiteMode() accepts, this must accept. They
// are two halves of one list." This file asserts that they are.
//
//   node test-local-options.js

'use strict';

const assert = require('assert');

const {
  MODES,
  PRESETS,
  getPreset,
  normalizeSiteMode,
  pagesToBuild,
  FIXED_PAGES,
  LOCAL_OPTIONS_SERVICE_PAGES,
} = require('./utils/seoPresets');

const { PRICING, quote, affordableServicePages, affordableLocationPages } =
  require('./utils/pricing');

const Job = require('./models/Job');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

function section(name) { console.log(`\n${name}\n`); }

const MODE = 'localoptions';

/* ------------------------------------------------------------------------ */

section('THE MODE IS ONE STRING, AND EVERY LIST HOLDS THE SAME ONE');

test('MODES names it, spelled one word', () => {
  /* ONE WORD, NO SEPARATOR. This string is written into Mongo, read back by
   * normalizeSiteMode(), compared in templates and posted by a form.
   * 'local-options' and 'local_options' would each work on their own; the
   * day one of them is typed in one of those four places is the day a job
   * quietly builds a lead site. */
  assert.strictEqual(MODES.LOCAL_OPTIONS, MODE);
});

test('normalizeSiteMode() KEEPS IT, rather than falling back to lead', () => {
  /* THE SILENT FAILURE THIS WHOLE FILE IS ABOUT. normalizeSiteMode does not
   * refuse an unknown mode — it returns 'lead'. A mode missing from PRESETS
   * is not an error anybody sees; it is a full lead site, built and billed. */
  assert.strictEqual(normalizeSiteMode(MODE), MODE);
});

test('and it is case- and space-tolerant like the others', () => {
  assert.strictEqual(normalizeSiteMode('  LocalOptions '), MODE);
});

test('models/Job.js ACCEPTS IT TOO — the half that throws', () => {
  /* The enum is the one place that fails loudly, and it fails LATE: at
   * Job.create(), after the credit check has passed and the customer has
   * been told the build is starting. Read off the schema rather than
   * trusting the source to say what it compiles to. */
  const values = Job.schema.path('siteMode').enumValues;

  assert.ok(values.includes(MODE),
    `models/Job.js enum is ${JSON.stringify(values)} — it will refuse this mode`);
});

test('EVERY MODE normalizeSiteMode ACCEPTS IS IN THE Job ENUM', () => {
  /* THE RULE, NOT THE INSTANCE. Asserting 'localoptions' in both lists only
   * catches today's omission. This catches the next one, whatever it is
   * called — which is the test 'rankfast' did not have. */
  const accepted = Object.keys(PRESETS);
  const enumValues = Job.schema.path('siteMode').enumValues;

  const missing = accepted.filter(m => !enumValues.includes(m));

  assert.deepStrictEqual(missing, [],
    `normalizeSiteMode accepts modes models/Job.js will refuse: ${missing.join(', ')}`);
});

/* ------------------------------------------------------------------------ */

section('THE PRESET');

test('there is one, and getPreset() returns it rather than the lead preset', () => {
  const preset = getPreset(MODE);

  assert.ok(preset, 'no preset');
  assert.strictEqual(preset.key, MODE, 'getPreset fell through to another mode');
});

test('it has a label a person can read on a screen', () => {
  assert.strictEqual(getPreset(MODE).label, 'Local Website Options');
});

test('NO FAQPage SCHEMA, which is also why it makes no DataForSEO call', () => {
  /* The FAQ section is what pulls in the People Also Ask fetch. This mode
   * has no FAQ, so it has no PAA call, so it has no DataForSEO cost at all.
   * Edwin, 27 October: "will these new site use dataforseo?" — no, and none
   * is to be designed in. */
  assert.strictEqual(getPreset(MODE).schema.faqPage, false);
});

test('but LocalBusiness stays, because it is a local business site', () => {
  assert.strictEqual(getPreset(MODE).schema.localBusiness, true);
});

test('ITS OWN RING, not classic and not rankfast', () => {
  /* Home shows six services and links the first three; every other page
   * links on to the next until contact closes the circle back to home.
   * Neither existing ring describes that, and pointing at one of them would
   * be one edit away from changing a ring nobody asked to change. */
  const ring = getPreset(MODE).links.ring;

  assert.strictEqual(ring, MODE);
  assert.notStrictEqual(ring, 'classic');
  assert.notStrictEqual(ring, 'rankfast');
});

/* ------------------------------------------------------------------------ */

section('HOW MANY PAGES IT BUILDS');

test('ELEVEN: home, six service pages, contact and the three legal pages', () => {
  const expected = 1 + LOCAL_OPTIONS_SERVICE_PAGES + FIXED_PAGES.length;

  assert.strictEqual(expected, 11, 'the arithmetic above no longer makes eleven');
  assert.strictEqual(pagesToBuild(MODE, {}), 11);
});

test('AND IT IGNORES WHAT THE WIZARD POSTED', () => {
  /* THE SAMPLE'S "0 of 2" BUG, IN A NEW MODE. The wizard still collects
   * service pages and still posts them; this mode does not read them — its
   * six service names come from suggestServices. A denominator computed
   * from a field the mode ignores is a progress bar that cannot reach the
   * end, which is exactly what a design sample did. */
  const posted = { 'water-heater-repair': {}, 'drain-cleaning': {}, 'leak-detection': {} };

  assert.strictEqual(pagesToBuild(MODE, posted, 9), 11,
    'the total moved with fields this mode does not build from');
});

test('and the other three modes are untouched by it', () => {
  assert.strictEqual(pagesToBuild(MODES.SAMPLE, { a: {} }), 1);
  assert.strictEqual(pagesToBuild(MODES.LEAD, { a: {}, b: {} }, 1),
    2 + 1 + 1 + FIXED_PAGES.length);
});

/* ------------------------------------------------------------------------ */

section('WHAT IT COSTS — the same as the lead site, and DERIVED');

test('800 CREDITS, which is $8.00', () => {
  assert.strictEqual(quote({ siteMode: MODE }).total, 800);
});

test('AND IT IS COMPUTED FROM THE LEAD SITE, NOT FROZEN AT 800', () => {
  /* THE RULE IS PARITY, AND THIS IS THE TEST OF THE RULE RATHER THAN OF
   * TODAY'S ANSWER TO IT.
   *
   * Edwin, 28 October, choosing between a flat LOCAL_OPTIONS: 800 and a
   * derivation: "derive it." A frozen constant diverges the first time
   * SERVICE_PAGE changes and NOTHING FAILS, because 800 is still a
   * perfectly valid number. A wrong price does not throw — so the only
   * thing that can catch it is an assertion about where the number comes
   * from. */
  const expected = PRICING.LEAD_BASE
    + (PRICING.LOCAL_OPTIONS_PAGES * PRICING.SERVICE_PAGE);

  assert.strictEqual(quote({ siteMode: MODE }).total, expected);
});

test('IT MATCHES A LEAD SITE WITH THE SAME SIX SERVICE PAGES, EXACTLY', () => {
  /* The plainest statement of the rule: the same pages cost the same money,
   * whichever generator writes them. */
  const lead = quote({ siteMode: 'lead', servicePages: PRICING.LOCAL_OPTIONS_PAGES });

  assert.strictEqual(quote({ siteMode: MODE }).total, lead.total);
});

test('the page count it is priced on is the page count it builds', () => {
  /* Two copies of "six" is a site that builds eight pages and bills for
   * six. pricing.js re-exports seoPresets' constant rather than declaring
   * its own. */
  assert.strictEqual(PRICING.LOCAL_OPTIONS_PAGES, LOCAL_OPTIONS_SERVICE_PAGES);
});

test('THE BREAKDOWN SAYS WHAT IS BEING PAID FOR, not just a total', () => {
  /* quote() returns lines so the review step can show the customer what
   * they are buying rather than a bare number. */
  const { lines } = quote({ siteMode: MODE });

  assert.strictEqual(lines.length, 2);
  assert.strictEqual(lines[0].label, 'Website');
  assert.strictEqual(lines[1].qty, PRICING.LOCAL_OPTIONS_PAGES);
  assert.strictEqual(lines.reduce((sum, l) => sum + l.cost, 0), 800);
});

test('AND WHAT WAS POSTED CANNOT CHANGE THE PRICE', () => {
  /* The page set is fixed, so a form field must not move the total — in
   * either direction. A mode whose price depends on something it does not
   * build is a mode that can be underbilled by leaving a box empty. */
  const padded = quote({ siteMode: MODE, servicePages: 40, locationPages: 25 });

  assert.strictEqual(padded.total, 800);
  assert.strictEqual(padded.lines.length, 2);
});

/* ------------------------------------------------------------------------ */

section('NO EXTRA PAGES ARE OFFERED');

test('NO SERVICE PAGE BOXES ARE PRE-TICKED, however large the balance', () => {
  /* Same guard a design sample already has, different cause: a sample
   * generates no service pages at all, this one generates exactly six
   * whatever the balance allows. Offering a seventh pre-ticks a box against
   * credits already committed, for a page the renderer will never write. */
  assert.strictEqual(affordableServicePages({ credits: 100000, siteMode: MODE }), 0);
});

test('and none for location pages either — this mode has none', () => {
  /* Edwin, 26 October, on the page set: "Only service pages not location
   * pages." */
  assert.strictEqual(affordableLocationPages({ credits: 100000, siteMode: MODE }), 0);
});

test('while a lead site still offers them, so the guard is not blanket', () => {
  /* A guard that returns 0 for everything passes both tests above for ever. */
  assert.ok(affordableServicePages({ credits: 100000, siteMode: 'lead' }) > 0);
});

/* ------------------------------------------------------------------------ */

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
