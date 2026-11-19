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
  serviceList,
} = require('./utils/pageMeta');

/** n service pages, in the shape buildLocationPages passes them. */
const SERVICE_PAGES = n =>
  ['water-heater-repair', 'drain-cleaning', 'slab-leak-repair', 'emergency-plumbing']
    .slice(0, n)
    .map(f => ({ filename: `${f}.html` }));

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

/* -------------------------------------------------------------------------
 * The location description — 21 September
 *
 * It used to be `description: title`: 42 characters of a ~155 budget, on a
 * page whose whole job is to rank for a town with no service page of its own.
 * ---------------------------------------------------------------------- */

test('a location description names the trade, the town and real services', () => {
  const { description } = locationMeta('Austin, TX', BASE, SERVICE_PAGES(4));
  assert.strictEqual(
    description,
    'Plumbing services in Austin, TX — water heater repair, drain cleaning and slab leak repair. Call (512) 894-6167.'
  );
});

test('a location description is no longer a copy of the title', () => {
  const meta = locationMeta('Austin, TX', BASE, SERVICE_PAGES(3));
  assert.notStrictEqual(meta.description, meta.title);
  assert.ok(meta.description.length > meta.title.length * 2, meta.description);
});

test('the location description does NOT contain the business name', () => {
  // Same reasoning as serviceMeta: on these sites the name carries the primary
  // keyword, so repeating it everywhere aims every page at the home page's
  // term instead of its own. It is also already the whole title, one line up
  // in the same search result.
  const { description } = locationMeta('Austin, TX', BASE, SERVICE_PAGES(3));
  assert.ok(!description.includes(BASE.businessName), description);
});

test('at most three services are named', () => {
  const { description } = locationMeta('Austin, TX', BASE, SERVICE_PAGES(4));
  assert.ok(!/emergency plumbing/.test(description), `a fourth service got in: ${description}`);
});

test('fewer than three services degrades cleanly', () => {
  const desc = n => locationMeta('Austin, TX', BASE, SERVICE_PAGES(n)).description;

  assert.strictEqual(desc(2),
    'Plumbing services in Austin, TX — water heater repair and drain cleaning. Call (512) 894-6167.');
  assert.strictEqual(desc(1),
    'Plumbing services in Austin, TX — water heater repair. Call (512) 894-6167.');
});

test('no service pages drops the clause rather than dangling a dash', () => {
  // One-Page Design sites have no service pages at all, and an older caller
  // passes no `pages` argument. Neither may produce "… in Austin, TX — . Call".
  for (const pages of [[], undefined]) {
    const { description } = locationMeta('Austin, TX', BASE, pages);
    assert.strictEqual(description, 'Plumbing services in Austin, TX. Call (512) 894-6167.');
    assert.ok(!/—/.test(description), description);
  }
});

test('no phone leaves no dangling "Call"', () => {
  const { description } = locationMeta('Austin, TX', { ...BASE, phone: '' }, SERVICE_PAGES(3));
  assert.ok(!/Call/.test(description), description);
  assert.ok(description.endsWith('.'), description);
});

test('the trade noun is the shared one, so awkward types stay correct', () => {
  // "Law firm services" is the mistake serviceNoun() exists to prevent, and
  // the home page and service pages already use it. All three must agree.
  const { description } = locationMeta(
    'Austin, TX',
    { ...BASE, businessType: 'Lemon Law Firm' },
    [{ filename: 'wrongful-termination.html' }]
  );
  assert.ok(description.startsWith('Legal services in Austin, TX'), description);
});

test('every location description fits a search result', () => {
  // ~155 characters is what Google shows. Three services plus the longest
  // realistic town must still fit.
  const { description } = locationMeta('Dripping Springs, TX', BASE, SERVICE_PAGES(3));
  assert.ok(description.length <= 155, `${description.length}: ${description}`);
});

test('serviceList joins without a serial comma and lower-cases', () => {
  assert.strictEqual(serviceList(SERVICE_PAGES(3)),
    'water heater repair, drain cleaning and slab leak repair');
  assert.strictEqual(serviceList(SERVICE_PAGES(2)), 'water heater repair and drain cleaning');
  assert.strictEqual(serviceList(SERVICE_PAGES(1)), 'water heater repair');
  assert.strictEqual(serviceList([]), '');
  assert.strictEqual(serviceList(), '');
  assert.strictEqual(serviceList([{ filename: 'Water-Heater-Repair.html' }]), 'water heater repair');
});

test('serviceList survives junk in the page list', () => {
  // These come from user-supplied filenames.
  assert.strictEqual(serviceList([null, undefined, {}, { filename: '' }]), '');
  assert.strictEqual(
    serviceList([{ filename: '' }, { filename: 'drain-cleaning.html' }]),
    'drain cleaning'
  );
});

test('buildLocationPages actually passes the service pages', () => {
  // Everything above tests locationMeta DIRECTLY, so all of it stays green
  // while the caller quietly stops handing over `pages` — the function would
  // be perfect and the feature a no-op on every real site, falling back to
  // "Plumbing services in Austin, TX. Call …" with no services named.
  //
  // A mutation dropping the argument survived until this test existed. It is
  // the same failure as anchorType being dropped in normaliseTargets: the unit
  // is right, the wiring is not, and only the wiring ships.
  const fs = require('fs');
  const path = require('path');

  const src = fs.readFileSync(path.join(__dirname, 'utils/buildLocationPages.js'), 'utf8');
  const call = src.match(/locationMeta\(([^)]*)\)/);

  assert.ok(call, 'buildLocationPages no longer calls locationMeta');
  const args = call[1].split(',').map(s => s.trim());
  assert.strictEqual(args.length, 3,
    `locationMeta is called with ${args.length} arguments: ${call[1]}`);
  assert.strictEqual(args[2], 'pages', `third argument is "${args[2]}", not the service pages`);
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
  ['location',      locationMeta('Austin, TX', globalValues, SERVICE_PAGES(3))],
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
  // Only CONTACT still reuses its title. Location stopped on 21 September —
  // if it is ever excluded from this loop again, that has regressed.
  for (const [label, meta] of everyPage()) {
    if (label === 'contact') continue;
    assert.ok(
      meta.description.length > meta.title.length,
      `${label}: description is not longer than the title`
    );
  }
});

test('the contact page is the last one still reusing its title', () => {
  // Recorded rather than asserted as correct: it is the remaining instance of
  // the thing this file exists to stop, and it is on the list to fix.
  const meta = contactMeta(BASE);
  assert.strictEqual(meta.description, meta.title);
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

/* -------------------------------------------------------------------------
 * The "near me" term — 19 November
 * ---------------------------------------------------------------------- */

test('the near-me tick puts the term in the title, BEFORE the phone', () => {
  // Edwin: "if I press the tick for the term near me it should add it to the
  // meta description and at the end of the seo title", then, a few hours
  // later: "the term near me goes first and then the phone number ...
  // | plumber near me | call 789900088".
  //
  // ⚠ IT NEVER DID ANY OF THIS BEFORE TODAY, AND THAT WAS NOT A REGRESSION.
  // `useNearMe` had four readers — the About-page prompt, the About-page
  // builder, the People Also Ask keyword and the content model — and none of
  // them was the meta. The term DID reach the image filenames and every alt
  // attribute on the page, which is why it looked as though it had once been
  // here.
  //
  //     THE ORDER OF A TITLE IS THE ORDER THINGS GET CUT IN. A title is
  //     truncated from the right at about sixty characters, so whatever
  //     sits last is what the search result drops. The phone loses least
  //     by being dropped — it is on every page and in the schema.
  const expected = {
    rankfast: 'Emergency Plumber Round Rock in Round Rock, TX | Plumber near me'
      + ' | Call (512) 894-6167',
    // "24/7 " is emergencyPrefix(), which fires on a name containing
    // "Emergency" — part of this fixture since long before the term existed.
    lead: 'Contact 24/7 Emergency Plumber Round Rock in Round Rock, TX'
      + ' | Plumber near me - Call (512) 894-6167',
  };

  for (const mode of ['rankfast', 'lead']) {
    const on = home({ useNearMe: 'true' }, mode);

    assert.strictEqual(on.title, expected[mode], `${mode} title`);
    assert.ok(on.description.includes('Plumber near me'), `${mode}: ${on.description}`);

    // AND THE PHONE IS STILL LAST, asserted separately so a reordering that
    // happens to match the string above by accident cannot pass.
    assert.ok(on.title.indexOf('Plumber near me') < on.title.indexOf('(512)'),
      `${mode}: the phone comes before the term`);
  }
});

test('and the term keeps its place when there is no phone to follow it', () => {
  // The phone is optional on both presets, and a term written as "term then
  // phone" is easy to write in a way that leaves a dangling separator when
  // the phone is absent.
  for (const mode of ['rankfast', 'lead']) {
    const on = home({ useNearMe: 'true', phone: '' }, mode);

    assert.ok(on.title.endsWith('| Plumber near me'), `${mode}: ${on.title}`);
    assert.ok(!/[|-]\s*$/.test(on.title), `${mode}: dangling separator in "${on.title}"`);
  }
});

test('and the description is composed before the term is appended', () => {
  // Both presets build the description out of the title. Appending the term
  // first gives "...Call (512) 894-6167 | Plumber near me to get a free
  // quote" — the term wedged into the middle of a sentence.
  for (const mode of ['rankfast', 'lead']) {
    const on = home({ useNearMe: 'true' }, mode);

    assert.ok(!/near me (to|at|-) /.test(on.description), `${mode}: ${on.description}`);
    assert.ok(on.description.trim().endsWith('Plumber near me.'), `${mode}: ${on.description}`);
  }
});

test('and an unticked box leaves the meta byte for byte as it was', () => {
  // Every site built before this change was built with the box off, and a
  // stray pipe or space would redraw all of their meta on the next rebuild.
  for (const mode of ['rankfast', 'lead']) {
    const none = home({}, mode);

    assert.deepStrictEqual(home({ useNearMe: 'false' }, mode), none);
    assert.deepStrictEqual(home({ useNearMe: '' }, mode), none);
    assert.deepStrictEqual(home({ useNearMe: 'yes' }, mode), none);
  }
});

test('and a STORED BOOLEAN ticks it, because that is what gets stored', () => {
  // ⚠ THIS TEST WAS FIRST WRITTEN THE OTHER WAY ROUND and the code was right.
  // The form posts the string "true", so asserting that only a string counts
  // looked like tightening — but contentModel.js stores
  // `useNearMe: String(...) === 'true'`, a BOOLEAN, so a site rebuilt from its
  // stored model comes back with `true`. Refusing it would have quietly
  // dropped the term from every edited site.
  //
  //     `String(x) === 'true'` IS NOT SLOPPINESS HERE. It is the one test that
  //     accepts both the form's string and the model's boolean, and three
  //     other files already depend on it.
  for (const mode of ['rankfast', 'lead']) {
    assert.deepStrictEqual(home({ useNearMe: true }, mode), home({ useNearMe: 'true' }, mode));
  }

  const fs = require('fs');
  const path = require('path');

  for (const file of ['utils/buildAboutUsPage.js', 'utils/contentModel.js']) {
    assert.ok(/String\((globalValues\.)?useNearMe\) === 'true'/
      .test(fs.readFileSync(path.join(__dirname, file), 'utf8')),
    `${file} no longer reads useNearMe the same way`);
  }
});

test('the noun is the practitioner, not the business type', () => {
  // The form posts "Plumbing" and the search is for a PLUMBER.
  // businessShape.js already keeps that mapping for headings and prompts, so
  // it is read rather than copied — a second table would be a second answer
  // to "what is one of these people called".
  const { nearMeTermFor } = require('./utils/seoPresets');
  const { titleFor } = require('./utils/businessShape');

  assert.strictEqual(nearMeTermFor({ useNearMe: 'true', businessType: 'Plumbing' }),
    'Plumber near me');

  // ASSERTED AGAINST businessShape RATHER THAN AGAINST A WORD, so renaming a
  // type there cannot split the term from the headings on the same page.
  for (const type of ['Roofing', 'HVAC', 'Concrete Contractor', 'Lemon Law']) {
    assert.strictEqual(nearMeTermFor({ useNearMe: 'true', businessType: type }),
      `${titleFor(type)} near me`, type);
  }
});

test('and a site with no business type gets no term at all', () => {
  // ⚠ FOUND BY THIS TEST, NOT BY A SITE. titleFor() falls back to "Local
  // Business" for anything it does not recognise — right for a heading, and
  // "Local Business near me" is a search term nobody has ever typed. A
  // replayed payload from before the business-type field existed is the way
  // in, and the title would have shipped reading almost plausibly.
  const { nearMeTermFor } = require('./utils/seoPresets');

  assert.strictEqual(nearMeTermFor({ useNearMe: 'true', businessType: '' }), '');
  assert.strictEqual(nearMeTermFor({ useNearMe: 'true' }), '');

  const bare = home({ businessType: '', useNearMe: 'true' });

  assert.ok(!bare.title.includes('near me'), bare.title);
});

test('and only the home page carries the term', () => {
  // The box says "near me", singular, and the home page is the page that
  // competes for it. A service page is aimed at its own service, a location
  // page at its town. Stamping one phrase on all eleven is how a site reads
  // as written for a search engine rather than for a person.
  const on = { ...BASE, useNearMe: 'true' };

  const others = [
    ['service', serviceMeta('Water Heater Repair', on)],
    ['location', locationMeta('Austin, TX', on, SERVICE_PAGES(3))],
    ['contact', contactMeta(on)],
  ];

  for (const [label, meta] of others) {
    assert.ok(!/near me/i.test(meta.title), `${label} title: ${meta.title}`);
    assert.ok(!/near me/i.test(meta.description), `${label} description`);
  }
});

test('and the About page reads the same helper rather than building its own', () => {
  // ⚠ IT DID BUILD ITS OWN UNTIL TODAY. The string was composed inside
  // buildAboutUsPage.js and used for the image filenames, the alt attributes
  // and the fifth section. Now that the title carries it too, two builders
  // would be two answers — and the wrong one is the one nobody looks at,
  // because an alt attribute is invisible.
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, 'utils', 'buildAboutUsPage.js'), 'utf8');

  assert.ok(/nearMeTerm = nearMeTermFor\(globalValues\)/.test(src),
    'the About page no longer takes the term from seoPresets');
  assert.ok(!/nearMeTerm = `\$\{category\} near me`/.test(src),
    'the About page is building the term itself again');
});

test('and the term survives the markup invariants like everything else', () => {
  // clean() runs on the noun, so a business type with a quote in it cannot
  // end the <title> attribute early through this new path either.
  const meta = home({ businessType: 'Plumb<ing>"', useNearMe: 'true' });

  assert.ok(!/["<>]/.test(meta.title), meta.title);
  assert.ok(!/["<>]/.test(meta.description), meta.description);
});

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('');
process.exit(failed === 0 ? 0 : 1);
