// test-page-meta.js
//
// The <title> and <meta name="description"> for every page of a generated site.
//
// WHY THIS EXISTS
//
// Until 20 September NOTHING in the test suite asserted on a page title. The
// formats live in utils/pageMeta.js and utils/seoPresets.js, they are the
// first thing a searcher reads in a result, and they were free to drift.
//
// The header of pageMeta.js says these were once written in four different
// places that "had already drifted apart". Centralising them fixed that.
// Testing them is what stops it happening again inside the one place.
//
//   node test-page-meta.js

const assert = require('assert');
const {
  indexMeta,
  serviceMeta,
  contactMeta,
  locationMeta,
  businessNoun,
} = require('./utils/pageMeta');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

const BASE = {
  businessName: 'Emergency Plumber Round Rock',
  businessType: 'Plumbing',
  location: 'Round Rock, TX',
  phone: '(512) 894-6167',
};

const home = (overrides = {}, siteMode = 'rankfast') =>
  indexMeta({ ...BASE, ...overrides, siteMode });

console.log('\nPage meta\n');

/* -------------------------------------------------------------------------
 * The Rank Fast home page
 * ---------------------------------------------------------------------- */

test('the Rank Fast home title is name + in + city, state + phone', () => {
  assert.strictEqual(
    home().title,
    'Emergency Plumber Round Rock in Round Rock, TX | Call (512) 894-6167'
  );
});

test('the town IS repeated when the business name already contains it', () => {
  // DELIBERATE, and the reason this test is here rather than the behaviour
  // just being left to speak for itself.
  //
  // The previous version detected the city in the name and appended only the
  // state, to avoid "Emergency Plumber Round Rock, Round Rock, TX". The real
  // fault there was the COMMA — a third list item — not the repetition. With
  // "in" it is a phrase, and a Rank Fast name is a service phrase that happens
  // to contain a town, so "in Round Rock, TX" is the first part of the title
  // that says where the business operates rather than what it is called.
  //
  // Without this test, that looks like a bug and gets "fixed" back.
  const title = home().title;
  assert.strictEqual(
    (title.match(/Round Rock/g) || []).length, 2,
    `expected the town twice: ${title}`
  );
  assert.ok(/ in Round Rock, TX/.test(title), title);
});

test('a name without the town reads the same way', () => {
  assert.strictEqual(
    home({ businessName: 'Acme Plumbing' }).title,
    'Acme Plumbing in Round Rock, TX | Call (512) 894-6167'
  );
});

test('the separator is a pipe, matching the service pages', () => {
  assert.ok(home().title.includes(' | Call '), home().title);
  assert.ok(!/\. Call /.test(home().title), 'the old ". Call" separator is back');
});

test('no phone means no dangling separator', () => {
  const { title } = home({ phone: '' });
  assert.strictEqual(title, 'Emergency Plumber Round Rock in Round Rock, TX');
  assert.ok(!/[|.]\s*$/.test(title), `trailing punctuation: ${title}`);
});

test('a location with no state gives the city alone', () => {
  assert.strictEqual(
    home({ businessName: 'Emergency Plumber Austin', location: 'Austin' }).title,
    'Emergency Plumber Austin in Austin | Call (512) 894-6167'
  );
});

test('no location at all falls back to the name', () => {
  // Never "Acme Plumbing in " with nothing after it.
  const { title } = home({ businessName: 'Acme Plumbing', location: '', phone: '' });
  assert.strictEqual(title, 'Acme Plumbing');
});

/* -------------------------------------------------------------------------
 * The other modes must not have moved
 * ---------------------------------------------------------------------- */

test('Rank GBPs keeps its own format', () => {
  assert.strictEqual(
    home({}, 'lead').title,
    'Contact 24/7 Emergency Plumber Round Rock in Round Rock, TX - Call (512) 894-6167'
  );
});

test('One-Page Design shares the Rank GBPs format', () => {
  // SAMPLE is Object.assign({}, LEAD, ...) — it deliberately has no third copy
  // of these formats to drift.
  assert.deepStrictEqual(home({}, 'sample'), home({}, 'lead'));
});

test('an unknown site mode does not crash or produce an empty title', () => {
  const { title } = home({}, 'not-a-mode');
  assert.ok(title && title.length > 10, `got "${title}"`);
});

test('the 24/7 prefix appears only when the name says emergency', () => {
  assert.ok(/24\/7/.test(home({}, 'lead').title));
  assert.ok(!/24\/7/.test(home({ businessName: 'Acme Plumbing' }, 'lead').title));
});

/* -------------------------------------------------------------------------
 * The pages that do not vary by mode
 * ---------------------------------------------------------------------- */

test('a service page is service + town + phone, with no business name', () => {
  // No business name, deliberately: on these sites the name contains the
  // primary keyword, so putting it here would aim every service page at the
  // home page's term instead of its own.
  const { title } = serviceMeta('Water Heater Repair', BASE);
  assert.strictEqual(title, 'Water Heater Repair in Round Rock, TX | Call us at (512) 894-6167');
  assert.ok(!title.includes(BASE.businessName), 'the business name leaked onto a service page');
});

test('a location page names the business and THAT location', () => {
  // Not the site's main location — the one the page covers.
  assert.strictEqual(
    locationMeta('Austin, TX', BASE).title,
    'Emergency Plumber Round Rock in Austin, TX'
  );
});

test('the contact page is the trade and the place', () => {
  assert.strictEqual(contactMeta(BASE).title, 'Plumbing in Round Rock, TX');
});

/* -------------------------------------------------------------------------
 * Invariants that hold for every page
 * ---------------------------------------------------------------------- */

const everyPage = (globalValues = BASE) => [
  ['rankfast home', indexMeta({ ...globalValues, siteMode: 'rankfast' })],
  ['lead home',     indexMeta({ ...globalValues, siteMode: 'lead' })],
  ['service',       serviceMeta('Water Heater Repair', globalValues)],
  ['location',      locationMeta('Austin, TX', globalValues)],
  ['contact',       contactMeta(globalValues)],
];

test('no title or description is ever empty', () => {
  for (const [label, meta] of everyPage()) {
    assert.ok(meta.title && meta.title.trim(), `${label} title is empty`);
    assert.ok(meta.description && meta.description.trim(), `${label} description is empty`);
  }
});

test('nothing that would break the HTML survives into a title', () => {
  // clean() strips " < > — these go straight into <title> and
  // <meta content="...">, so a business name with a quote in it would end the
  // attribute early.
  const nasty = {
    ...BASE,
    businessName: 'Bob\'s "Best" <Plumbing>',
    businessType: 'Plumb<ing>',
  };
  for (const [label, meta] of everyPage(nasty)) {
    for (const [field, value] of Object.entries(meta)) {
      assert.ok(!/["<>]/.test(value), `${label} ${field} carries markup: ${value}`);
    }
  }
});

test('no title collapses whitespace badly or has stray punctuation', () => {
  for (const [label, meta] of everyPage({ ...BASE, phone: '', location: 'Austin' })) {
    assert.ok(!/\s{2,}/.test(meta.title), `${label}: double space in "${meta.title}"`);
    assert.ok(!/(^[\s,|-]|[\s,|]$)/.test(meta.title), `${label}: stray edge char in "${meta.title}"`);
  }
});

test('title and description never disagree about the business name', () => {
  // They are built from one shared `subject` precisely so they cannot.
  for (const mode of ['rankfast', 'lead']) {
    const meta = home({}, mode);
    assert.ok(meta.description.includes(BASE.businessName), `${mode}: ${meta.description}`);
    assert.ok(meta.title.includes(BASE.businessName), `${mode}: ${meta.title}`);
  }
});

test('a description is longer than its title, on the pages that bother', () => {
  // Location and contact deliberately reuse the title; the rest should not,
  // because an identical description wastes most of a ~155-character budget.
  for (const [label, meta] of everyPage()) {
    if (label === 'location' || label === 'contact') continue;
    assert.ok(
      meta.description.length > meta.title.length,
      `${label}: description is not longer than the title`
    );
  }
});

test('businessNoun picks a noun that is not "company" for professionals', () => {
  assert.strictEqual(businessNoun('Lemon Law Firm'), 'law firm');
  assert.strictEqual(businessNoun('Dentist'), 'dental practice');
  assert.strictEqual(businessNoun('Plumbing'), 'plumbing company');
  assert.strictEqual(businessNoun('HVAC'), 'HVAC company');   // acronyms keep caps
});

test('businessNoun strips markup on its unmatched branch', () => {
  // businessNoun() feeds PROSE ("our plumbing company"), not meta, so the
  // everyPage invariant above never reaches it and the four fixtures in the
  // previous test are all clean strings — a mutation reverting its clean() to
  // String() survived until this existed.
  //
  // The unmatched branch returns the business type verbatim, and that lands in
  // page body text, where "<ing>" is parsed as a tag.
  assert.strictEqual(businessNoun('Plumb<ing>'), 'plumbing company');
  for (const nasty of ['Plumb<ing>', 'Roof"ing', 'A<script>b']) {
    assert.ok(!/["<>]/.test(businessNoun(nasty)), `"${nasty}" -> ${businessNoun(nasty)}`);
  }
});

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('');
process.exit(failed === 0 ? 0 : 1);
