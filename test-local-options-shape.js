// test-local-options-shape.js
//
// The ring, the rotation and the page list for Local Website Options.
//
// WHY THIS IS ITS OWN SUITE. Three of the four things shape.js answers were
// got wrong in the mock-up, and every one of them was wrong in a way that
// LOOKED RIGHT IN A BROWSER:
//
//   the home page linked all six services   the page rendered perfectly
//   the home page linked only three         the page rendered perfectly
//   the hero rotation was reported broken   it was correct; the pictures
//                                           were four versions of one shot
//
// None of those is visible without counting. So they are counted here.
//
//   node test-local-options-shape.js

'use strict';

const assert = require('assert');

const {
  SERVICE_COUNT,
  HOME_BODY_LINKS,
  HERO_COUNT,
  CONTACT_SLUG,
  LEGAL_SLUGS,
  PAGE_TITLES,
  esc,
  ring,
  ringNext,
  heroFor,
  urlFor,
  fileFor,
  titleOf,
  allPaths,
  homeRows,
} = require('./utils/localOptions/render/shape');

const { FIXED_PAGES, pagesToBuild, MODES } = require('./utils/seoPresets');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

function section(name) { console.log(`\n${name}\n`); }

/* Six services, named the way suggestServices returns them. */
const SERVICES = [
  { slug: 'water-heater-repair', name: 'Water Heater Repair and Replacement' },
  { slug: 'drain-cleaning', name: 'Drain Cleaning' },
  { slug: 'leak-detection', name: 'Leak Detection' },
  { slug: 'toilet-repair', name: 'Toilet Repair' },
  { slug: 'sewer-line-repair', name: 'Sewer Line Repair' },
  { slug: 'repiping', name: 'Whole House Repiping' },
];

const BUSINESS = { name: 'Leander Plumbing Gomanzo', city: 'Leander', state: 'TX' };
const ORDER = ring(SERVICES);

/* ------------------------------------------------------------------------ */

section('THE PAGE LIST');

test('ELEVEN FILES: home, six services, contact, three legal', () => {
  assert.strictEqual(allPaths(SERVICES).length, 11);
});

test('AND IT AGREES WITH pagesToBuild(), WHICH IS THE PROGRESS BAR', () => {
  /* Two numbers computed in two files, watched by one person. If they ever
   * disagree by one, the bar stops short of 100% on every build or claims
   * to be finished while pages are still being written. Asserted against
   * the function rather than against 11, so changing the service count
   * moves both or fails here. */
  assert.strictEqual(allPaths(SERVICES).length, pagesToBuild(MODES.LOCAL_OPTIONS, {}));
});

test('every path is a directory index, never a bare .html', () => {
  /* /drain-cleaning/ is served from drain-cleaning/index.html on both
   * Cloudflare Pages and GitHub Pages. A file at drain-cleaning.html is
   * served at a different URL from the one the canonical, the sitemap and
   * every internal link name. */
  for (const path of allPaths(SERVICES)) {
    assert.ok(path === 'index.html' || /^[a-z0-9-]+\/index\.html$/.test(path),
      `${path} is not a directory index`);
  }
});

test('THE LEGAL PAGES ARE THERE, AND THEY COME FROM seoPresets', () => {
  /* Not re-typed here. FIXED_PAGES owns the list; shape.js splits contact
   * off the front because contact is in the ring and the legal pages are
   * not. */
  for (const slug of LEGAL_SLUGS) {
    assert.ok(allPaths(SERVICES).includes(`${slug}/index.html`), `${slug} is missing`);
  }
  assert.deepStrictEqual([CONTACT_SLUG, ...LEGAL_SLUGS], FIXED_PAGES);
});

test('and every fixed page has a name a person can read', () => {
  /* A fifth fixed page added to seoPresets with no entry here would render
   * a tab called "terms-of-sale". */
  for (const slug of FIXED_PAGES) {
    assert.ok(PAGE_TITLES[slug], `${slug} has no title`);
  }
});

/* ------------------------------------------------------------------------ */

section('THE RING');

test('index, then the six in order, then contact', () => {
  assert.deepStrictEqual(ORDER, [
    'index',
    'water-heater-repair', 'drain-cleaning', 'leak-detection',
    'toilet-repair', 'sewer-line-repair', 'repiping',
    'contact',
  ]);
});

test('NO LEGAL PAGE IS IN IT', () => {
  /* They sit in the footer, reachable from everywhere, linking onward to
   * nothing. A privacy policy in the ring puts a page nobody reads between
   * two that people do. */
  for (const slug of LEGAL_SLUGS) {
    assert.ok(!ORDER.includes(slug), `${slug} is in the ring`);
  }
});

test('each page points at the next one', () => {
  assert.strictEqual(ringNext(ORDER, 'index'), 'water-heater-repair');
  assert.strictEqual(ringNext(ORDER, 'drain-cleaning'), 'leak-detection');
  assert.strictEqual(ringNext(ORDER, 'repiping'), 'contact');
});

test('AND CONTACT POINTS AT NOTHING, rather than back at index', () => {
  /* Contact closes the circle by linking home in its own markup. Returning
   * 'index' here would render "onward" and "home" as the same link, twice,
   * on the last page of the site. */
  assert.strictEqual(ringNext(ORDER, 'contact'), null);
});

test('a slug that is not in the ring gets null, not the first page', () => {
  assert.strictEqual(ringNext(ORDER, 'privacy-policy'), null);
  assert.strictEqual(ringNext(ORDER, 'nonsense'), null);
});

/* ------------------------------------------------------------------------ */

section('THE HERO ROTATION');

test('THE WHOLE SEQUENCE, WRITTEN OUT', () => {
  /* Edwin, on being shown the rotation a second time: "It should be hero1
   * for homepage, hero2 for the next service page, hero 3 for the next,
   * hero 4 for the next and then start over with hero1."
   *
   * Asserted as the complete list rather than a formula, because a formula
   * in the test is the same formula as in the code and would agree with it
   * while both were wrong. */
  assert.deepStrictEqual(ORDER.map(slug => heroFor(ORDER, slug)),
    [1, 2, 3, 4, 1, 2, 3, 4]);
});

test('it starts at 1 and never exceeds HERO_COUNT', () => {
  const used = ORDER.map(slug => heroFor(ORDER, slug));

  assert.strictEqual(Math.min(...used), 1);
  assert.strictEqual(Math.max(...used), HERO_COUNT);
});

test('ALL FOUR PICTURES ARE USED, not three of them', () => {
  /* An off-by-one in the modulo gives 0..3 or reuses one image twice as
   * often as the others, and either renders perfectly. */
  const used = new Set(ORDER.map(slug => heroFor(ORDER, slug)));

  assert.strictEqual(used.size, HERO_COUNT);
});

test('a page outside the ring has no hero', () => {
  assert.strictEqual(heroFor(ORDER, 'privacy-policy'), 0);
});

/* ------------------------------------------------------------------------ */

section('WHAT THE HOME PAGE SHOWS, AND WHAT IT LINKS');

test('ALL SIX ARE SHOWN', () => {
  /* Literal again, for the same reason, with SERVICE_COUNT checked beside it. */
  assert.strictEqual(homeRows(SERVICES).length, 6);
  assert.strictEqual(SERVICE_COUNT, 6);
});

test('AND EXACTLY TWO ARE LINKS', () => {
  /* Wrong twice: six linked, then three shown. This is the assertion that
   * tells those two apart, and neither is visible in a browser.
   *
   * TWO SINCE 30 OCTOBER, on Edwin's "could you make only the home page to
   * link to only 2 services instead of 3?" Six rows are still SHOWN; four
   * of them are muted rather than linked. */
  const rows = homeRows(SERVICES);

  /* THE LITERAL, NOT HOME_BODY_LINKS.
   *
   * Asserting against the constant is the formula-in-the-test problem: move
   * the constant to 6 and this assertion moves with it and still passes,
   * which is the first wrong draft going green. The constant is checked on
   * its own line below, so a deliberate change to it fails here and has to
   * be made on purpose — as this one was. */
  assert.strictEqual(rows.filter(r => r.linked).length, 2);
  assert.strictEqual(rows.filter(r => !r.linked).length, 4);
  assert.strictEqual(HOME_BODY_LINKS, 2);
});

test('and they are the FIRST two, in order', () => {
  const linked = homeRows(SERVICES).filter(r => r.linked).map(r => r.service.slug);

  assert.deepStrictEqual(linked, SERVICES.slice(0, HOME_BODY_LINKS).map(s => s.slug));
});

test('the cap is lower than the number shown, or it caps nothing', () => {
  /* HOME_BODY_LINKS >= SERVICE_COUNT would make the rule inert while every
   * test above still passed. */
  assert.ok(HOME_BODY_LINKS < SERVICE_COUNT);
});

/* ------------------------------------------------------------------------ */

section('URLS AND NAMES');

test('home is /, everything else is a directory', () => {
  assert.strictEqual(urlFor('index'), '/');
  assert.strictEqual(urlFor('drain-cleaning'), '/drain-cleaning/');
  assert.strictEqual(fileFor('index'), 'index.html');
  assert.strictEqual(fileFor('drain-cleaning'), 'drain-cleaning/index.html');
});

test('a service page is named by its service, not by its heading', () => {
  /* The H1 carries the town — "Drain cleaning in Leander, TX" — and
   * repeating that in a nav menu reads as a mistake. */
  assert.strictEqual(titleOf('drain-cleaning', { business: BUSINESS, services: SERVICES }),
    'Drain Cleaning');
});

test('home is the business, contact says so, legal pages say what they are', () => {
  const ctx = { business: BUSINESS, services: SERVICES };

  assert.strictEqual(titleOf('index', ctx), BUSINESS.name);
  assert.strictEqual(titleOf('contact', ctx), `Contact ${BUSINESS.name}`);
  assert.strictEqual(titleOf('privacy-policy', ctx), 'Privacy Policy');
});

test('esc() closes an attribute nobody opened', () => {
  /* A town or business name with a quote in it would end the attribute
   * early and put the rest of the name into the markup as tags. */
  assert.strictEqual(esc(`A"B<C>D&E'F`), 'A&quot;B&lt;C&gt;D&amp;E&#39;F');
});

/* ------------------------------------------------------------------------ */

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
