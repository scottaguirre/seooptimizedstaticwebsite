// test-local-options-anvil.js
//
// The third structure, and the two things a dark page breaks that a light
// one does not.
//
// WHAT THIS IS GUARDING. Ledger, Beacon and Anvil are all served as
// assets/site.css to different sites built by the same code. The failure
// this suite exists for is not a crash — it is a page that renders perfectly
// with a stylesheet written for one of the other two, where every selector
// misses, nothing throws, and the site goes out as unstyled text.
//
//     A STYLESHEET AND ITS MARKUP ARE ONE CHOICE, NOT TWO.
//
// AND WHAT IS NEW WITH THE THIRD ONE. Two structures could only collide one
// way round. Three can collide six, and "no Ledger name in a Beacon site"
// said twice does not cover a Ledger name in an Anvil site. The isolation
// tests below are written as a loop over every ordered pair, so a fourth
// structure is covered the day it is registered rather than the day somebody
// remembers to add three more assertions.
//
// THE DARK-SPECIFIC FAILURES, WHICH NEITHER OF THE OTHER SUITES CAN SEE
//
//   the logo   An owner's logo is dark ink on transparency as often as not.
//              On Anvil's rail that is an invisible header, and the only
//              sign is a customer asking where their logo went.
//   the words  Anvil's H1 sits ON the photograph. Without a scrim the
//              headline is white text on whatever the picture happens to
//              contain, which is unreadable on exactly the bright,
//              well-lit photographs a trade site wants.
//
//   node test-local-options-anvil.js

'use strict';

const assert = require('assert');

const { renderSite } = require('./utils/localOptions/render/renderSite');
const { structureFor, structureKeys } = require('./utils/localOptions/render/structures');
const { STRUCTURES } = require('./utils/localOptions/render/theme');
const { DESIGNS, designFor, buildOptionsFor } = require('./utils/localOptions/designs');

const ledgerPrompt = require('./utils/localOptions/prompt');
const beaconPrompt = require('./utils/localOptions/prompt-beacon');
const anvilPrompt = require('./utils/localOptions/prompt-anvil');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

function section(n) { console.log(`\n${n}\n`); }

const SLUGS = [
  'drain-cleaning', 'toilet-repair', 'faucet-repair',
  'pipe-leak-repair', 'water-heater-repair', 'garbage-disposal-repair',
];

const SITE = (over = {}) => ({
  url: 'https://9-x.org/the-chicago-plumber',
  business: {
    name: 'The Chicago Plumber', trade: 'plumbing', phone: '(312) 555-0164',
    street: '12 W Elm St', city: 'Chicago', state: 'IL', zip: '60610',
    social: { facebook: 'https://facebook.com/x' },
  },
  areas: ['Chicago', 'Oak Park'],
  hours: [{ day: 'Monday', open: '7:00 AM – 6:00 PM' }, { day: 'Sunday', open: null }],
  alt: { 1: 'one', 2: 'two', 3: 'three', 4: 'four' },
  cover: 2,
  logo: 'assets/logo.png',
  verification: ['dK3xP9mQ2vR7nL4tY8wZ'],
  services: SLUGS.map(slug => ({
    slug,
    name: slug.replace(/-/g, ' '),
    blurb: 'A line about it.',
    h1: 'A heading',
    title: 'A title',
    meta: 'A description.',
    sections: [
      { heading: '', paragraphs: ['Opening one.', 'Opening two.'] },
      { heading: 'A heading', paragraphs: ['A paragraph.'] },
    ],
  })),
  home: {
    h1: 'ignored', sub: 'Same-week appointments.',
    title: 'The Chicago Plumber', meta: 'A description.',
    aboutHeading: 'Fixing pipes across Chicago', about: ['First.', 'Second.'],
  },
  now: new Date('2026-10-31T00:00:00Z'),
  ...over,
});

const anvil = renderSite(SITE({ structure: 'anvil' }));
const beacon = renderSite(SITE({ structure: 'beacon' }));
const ledger = renderSite(SITE({ structure: 'ledger' }));

const BUILT = { ledger, beacon, anvil };

const allOf = files => Object.entries(files)
  .filter(([path]) => path.endsWith('.html') || path.endsWith('.css'))
  .map(([, body]) => String(body)).join('\n');

/** Every structure's class prefix and custom-property prefix, from the source. */
const MARKS = {
  ledger: { cls: /ledger-/, prop: /--lg-/ },
  beacon: { cls: /beacon-/, prop: /--bn-/ },
  anvil: { cls: /anvil-/, prop: /--av-/ },
};

/* ======================================================================= */

section('THREE STRUCTURES, SIX WAYS TO COLLIDE');

test('NO STRUCTURE\'S NAMES REACH ANY OTHER STRUCTURE\'S SITE', () => {
  /* THE FAILURE THIS WHOLE FILE EXISTS FOR, now that there are three.
   * Written as a loop over ordered pairs rather than as three hand-written
   * assertions: with two structures there were two directions to check and
   * somebody could hold both in their head. With three there are six, with
   * four there are twelve, and a hand-written list is a list that will be
   * short by three the next time this grows. */
  for (const [mine, files] of Object.entries(BUILT)) {
    const text = allOf(files);

    for (const [theirs, { cls, prop }] of Object.entries(MARKS)) {
      if (theirs === mine) continue;

      assert.ok(!cls.test(text), `a ${theirs}- class name is in a ${mine} site`);
      assert.ok(!prop.test(text), `a ${theirs} custom property is in a ${mine} site`);
    }
  }
});

test('and each site does carry its own, so the loop above is not vacuous', () => {
  /* A test that only asserts absence passes on an empty string. */
  for (const [mine, files] of Object.entries(BUILT)) {
    const text = allOf(files);

    assert.ok(MARKS[mine].cls.test(text), `a ${mine} site has no ${mine}- class at all`);
    assert.ok(MARKS[mine].prop.test(text), `a ${mine} site has no ${mine} custom property`);
  }
});

test('THE IDS DIFFER ACROSS ALL THREE', () => {
  /* Edwin, 30 October: "different classes and prefix and css IDs". The skip
   * link's target and the services anchor are linked from the header on
   * every page; structures that reused them would work, and would mean the
   * layouts could never be told apart by a fragment in a URL somebody
   * bookmarked. */
  assert.ok(ledger['index.html'].includes('<main id="main">'));
  assert.ok(beacon['index.html'].includes('<main id="content">'));
  assert.ok(anvil['index.html'].includes('<main id="page">'));

  assert.ok(ledger['index.html'].includes('id="services"'));
  assert.ok(beacon['index.html'].includes('id="trades"'));
  assert.ok(anvil['index.html'].includes('id="work"'));

  assert.ok(!anvil['index.html'].includes('id="main"'));
  assert.ok(!anvil['index.html'].includes('id="content"'));
  assert.ok(!anvil['index.html'].includes('id="trades"'));
  assert.ok(!anvil['index.html'].includes('id="services"'));
});

test('and so do the contact form field ids', () => {
  /* Ledger uses n/p/e/m, Beacon bn/bp/be/bm, Anvil an/ap/ae/am. Three
   * layouts whose markup cannot be told apart by anything that looks at ids
   * are one layout as far as a scraper, a test or a stylesheet is
   * concerned. */
  const c = anvil['contact/index.html'];

  assert.ok(c.includes('id="an"') && c.includes('id="am"'));
  assert.ok(!c.includes('id="bn"'), 'Anvil reuses a Beacon field id');
  assert.ok(!/id="[npem]"/.test(c), 'Anvil reuses a Ledger field id');
});

test('A STYLESHEET NEVER ARRIVES WITHOUT ITS OWN MARKUP', () => {
  /* The seam structures.js exists for. A stylesheet from one structure and
   * markup from another renders a page where every selector misses and
   * nothing throws. */
  for (const key of Object.keys(STRUCTURES)) {
    const s = structureFor(key);

    assert.strictEqual(s.key, key, `${key} resolved to ${s.key}`);
    assert.ok(s.pages && s.pages.homePage, `${key} has no page builders`);
    assert.ok(s.prompt && s.prompt.servicePagePrompt, `${key} has no prompts`);
  }

  assert.deepStrictEqual(structureKeys(), ['ledger', 'beacon', 'anvil']);
});

test('AND A TYPO IN THE STRUCTURE NAME FALLS BACK TO ALL THREE HALVES OF ONE', () => {
  /* structureFor() resolves the theme by the incoming string and the PARTS
   * by the RESOLVED key, which is what stops "anvl" producing Ledger's
   * stylesheet with Anvil's markup. */
  assert.strictEqual(structureFor('anvil').prompt, anvilPrompt);
  assert.strictEqual(structureFor('anvl').prompt, ledgerPrompt);
  assert.strictEqual(structureFor('anvl').key, 'ledger');
  assert.strictEqual(structureFor('ANVIL').key, 'anvil');
  assert.strictEqual(structureFor('beacon').prompt, beaconPrompt);
});

/* ======================================================================= */

section('WHAT A DARK PAGE BREAKS');

test('THE LOGO SITS ON A LIGHT PLATE, ALWAYS AND NOT CONDITIONALLY', () => {
  /* An owner's logo was drawn for a white page — dark ink on transparency.
   * On Anvil's rail it disappears, and the first anybody knows is a
   * customer asking why their header is empty.
   *
   *     NOTHING HERE CAN SEE INSIDE A PNG.
   *     A RULE THAT GUESSED WOULD BE WRONG SILENTLY.
   *
   * So every logo gets the plate: a visible logo that could have been
   * prettier beats an invisible one. */
  const css = String(anvil['assets/site.css']);

  for (const path of Object.keys(anvil).filter(p => p.endsWith('.html'))) {
    assert.ok(
      anvil[path].includes('anvil-brand__plate'),
      `${path} puts the logo on the dark rail with nothing behind it`);
  }

  assert.ok(/\.anvil-brand__plate\{[^}]*background:#fff/.test(css),
    'the plate is not actually light');
});

test('and a business with no logo gets a glyph, which cannot disappear', () => {
  /* The glyph is drawn by chrome.js in colours chosen for this background,
   * so it needs no plate — and giving it one would put a white rectangle
   * round a mark that was already legible. */
  const bare = renderSite(SITE({ structure: 'anvil', logo: '' }));

  assert.ok(bare['index.html'].includes('anvil-brand__glyph'));
  assert.ok(!bare['index.html'].includes('anvil-brand__plate'));
  assert.ok(bare['index.html'].includes('>TCP<') || /anvil-brand__glyph">[A-Z]{2,3}</.test(bare['index.html']));
});

test('THE HEADLINE SITS ON THE PHOTOGRAPH, AND THE PHOTOGRAPH IS SCRIMMED', () => {
  /* Anvil is the only one of the three that puts the H1 over an image, and
   * it is the only one that can — the other two are light pages, where dark
   * text over a photograph is a gamble on what the photograph contains.
   *
   * WITHOUT THE SCRIM THE GAMBLE IS JUST MOVED, not taken off the table:
   * white text over a bright, well-lit trade photograph is unreadable. */
  const css = String(anvil['assets/site.css']);
  const home = anvil['index.html'];

  assert.ok(/<section class="anvil-stage"/.test(home), 'there is no stage');
  assert.ok(/anvil-stage__shot/.test(home), 'the stage carries no photograph');
  assert.ok(/<h1>/.test(home.split('anvil-stage__words')[1] || ''),
    'the H1 is not inside the stage');

  assert.ok(/\.anvil-stage::after\{[^}]*linear-gradient/.test(css),
    'the photograph has no scrim under the words');
});

test('and the scrim is CSS, not a fourth copy of every photograph', () => {
  /* The same four files serve all three structures. Darkening them would
   * mean a fourth variant of every image and a build step to make it. */
  const home = anvil['index.html'];

  assert.ok(/assets\/hero-\d\.webp/.test(home));
  assert.ok(!/hero-\d-dark/.test(home), 'Anvil asks for a darkened image file');
});

test('A PAGE WITH NO PHOTOGRAPH STILL HAS ITS HEADING', () => {
  /* On Ledger and Beacon the H1 can live in the body; on Anvil the stage IS
   * the H1, so a page outside the hero rotation that returned no stage
   * would return a page with no heading at all. */
  const legal = anvil['privacy-policy/index.html'];

  assert.ok(/<h1>/.test(legal), 'a legal page has no H1');

  const bareStage = renderSite(SITE({ structure: 'anvil', alt: {} }));

  assert.ok(/<h1>/.test(bareStage['index.html']), 'the home page lost its H1');
});

test('AND THE BROWSER IS TOLD THE PAGE IS DARK', () => {
  /* Without it a dark page gets a bright white scrollbar down its right
   * edge and a white flash at the top of every rubber-band scroll on iOS.
   * Neither light structure carries the line and both would be wrong to. */
  for (const path of Object.keys(anvil).filter(p => p.endsWith('.html'))) {
    assert.ok(anvil[path].includes('name="color-scheme" content="dark"'),
      `${path} does not declare itself dark`);
  }

  assert.ok(!ledger['index.html'].includes('color-scheme'));
  assert.ok(!beacon['index.html'].includes('color-scheme'));
});

test('THE BODY TEXT IS NOT PURE WHITE ON PURE BLACK', () => {
  /* The pairing that makes long text shimmer. Both ends are pulled in —
   * which is a decision worth a test, because "make it darker" is exactly
   * the edit that would push them back out. */
  const css = String(anvil['assets/site.css']);

  assert.ok(!/--av-ink:\s*#fff\b/i.test(css), 'the body text is pure white');
  assert.ok(!/--av-ground:\s*#000\b/i.test(css), 'the page ground is pure black');
});

/* ======================================================================= */

section('THE SAME SITE, DIFFERENTLY DRESSED');

test('THE SAME ELEVEN PAGES, plus the stylesheet, sitemap, robots and 404', () => {
  assert.deepStrictEqual(Object.keys(anvil).sort(), Object.keys(beacon).sort());
  assert.deepStrictEqual(Object.keys(anvil).sort(), Object.keys(ledger).sort());
});

test('and every service page carries the same sections', () => {
  for (const slug of SLUGS) {
    const page = anvil[`${slug}/index.html`];

    assert.ok(page, `${slug} was not built`);
    assert.ok(page.includes('anvil-stage'), `${slug} has no stage`);
    assert.ok(page.includes('anvil-prose'), `${slug} has no prose`);
    assert.ok(page.includes('anvil-watch'), `${slug} has no hours`);
    assert.ok(page.includes('anvil-onward'), `${slug} does not pass the reader on`);
  }
});

test('THE RING STILL CAPS THE BODY AT TWO LINKED SERVICES', () => {
  /* HOME_BODY_LINKS is a rule about the SITE, not about the layout. A third
   * structure that re-decided it would be a third product. */
  const home = anvil['index.html'];
  const ladder = home.split('anvil-ladder')[1].split('</ul>')[0];

  const linked = (ladder.match(/<li class="anvil-rung"><a /g) || []).length;
  const flat = (ladder.match(/anvil-rung--flat/g) || []).length;

  assert.strictEqual(linked, 2, `the ladder links ${linked} services`);
  assert.strictEqual(flat, 4, `the ladder shows ${flat} unlinked services`);
});

test('the nav carries ALL SIX, because navigation is not the ring', () => {
  const nav = anvil['index.html'].split('anvil-work__list')[1].split('</ul>')[0];

  for (const slug of SLUGS) {
    assert.ok(nav.includes(`${slug}/`), `${slug} is not in the menu`);
  }
});

test('the Search Console tag is on every page', () => {
  for (const path of Object.keys(anvil).filter(p => p.endsWith('.html'))) {
    assert.ok(anvil[path].includes('dK3xP9mQ2vR7nL4tY8wZ'), `${path} has no tag`);
  }
});

test('AND THE LOGO IS RE-BASED FOR DEPTH ON EVERY PAGE', () => {
  /* `assets/logo.png` from /drain-cleaning/ asks for
   * /drain-cleaning/assets/logo.png. Ledger shipped that for a day and it
   * was found in a python http.server log — 200 for the home page, 404 for
   * the same file from all six service pages. */
  assert.ok(anvil['index.html'].includes('src="assets/logo.png"'));
  assert.ok(anvil['drain-cleaning/index.html'].includes('src="../assets/logo.png"'));
  assert.ok(anvil['contact/index.html'].includes('src="../assets/logo.png"'));
});

test('the schema and the canonical are untouched by the layout', () => {
  const a = JSON.parse(anvil['index.html'].split('application/ld+json">')[1].split('</script>')[0]);
  const b = JSON.parse(beacon['index.html'].split('application/ld+json">')[1].split('</script>')[0]);

  assert.deepStrictEqual(a, b, 'the layout changed the structured data');

  assert.ok(anvil['drain-cleaning/index.html']
    .includes('<link rel="canonical" href="https://9-x.org/the-chicago-plumber/drain-cleaning/">'));
});

test('a build is reproducible — the same input gives the same bytes', () => {
  /* The deploy relies on an unchanged file costing nothing to re-upload. A
   * renderer that read the clock would break that once a year, at midnight,
   * for everybody at once — which is why `now` is an argument. */
  assert.deepStrictEqual(renderSite(SITE({ structure: 'anvil' })), anvil);
});

test('NO PAGE CARRIES AN HTML COMMENT AT ALL', () => {
  /* An HTML comment inside a template ships into the published page. One
   * did, on a live client domain, carrying a quoted old draft and Edwin's
   * name. Every explanation in these templates is a JS comment inside
   * `${/* ... *\/''}` for that reason. */
  for (const path of Object.keys(anvil).filter(p => p.endsWith('.html'))) {
    assert.ok(!/<!--/.test(anvil[path]), `${path} ships an HTML comment`);
  }
});

test('THE SENTENCE ABOVE THE LADDER IS WRITTEN FOR A CUSTOMER', () => {
  /* Edwin struck this exact sentence out on 30 October — "All six have a
   * page of their own" — with "this should be for a customer." It is a note
   * about what was BUILT, not a reason to read on.
   *
   * THIS TEST EARNED ITS KEEP THE HOUR IT WAS WRITTEN. Anvil's first draft
   * of the lede said precisely that, having been written from Beacon's
   * without re-reading why Beacon's had changed. */
  const home = anvil['index.html'];

  assert.ok(!/have a page of their own/i.test(home), 'the lede talks to the owner');
  assert.ok(!/All six/i.test(home), 'the lede counts the pages at the reader');

  assert.ok(home.includes('what moves the price'),
    'the lede says nothing about what is on the pages');
});

test('and it counts the services from the constant, never in typed prose', () => {
  /* The lede said "three" for a day after the body-link cap became two,
   * because the number was written out rather than built from
   * SERVICE_COUNT.
   *
   *     A SENTENCE DESCRIBING A RULE IS NOT THE RULE. */
  const { defaultServicesLede } = require('./utils/localOptions/render/anvil/pages');
  const { SERVICE_COUNT, inWords } = require('./utils/localOptions/render/shape');

  assert.ok(defaultServicesLede().includes(inWords(SERVICE_COUNT)));
});

test('AND THE OWNER CAN REPLACE IT, OR TAKE IT AWAY', () => {
  /* ABSENT IS NOT EMPTY. `undefined` means nobody has edited the field and
   * the default stands; `''` means the owner cleared it on purpose, and a
   * renderer that treated the two the same would put the default back every
   * time somebody emptied the box. */
  const mine = renderSite(SITE({
    structure: 'anvil',
    home: { ...SITE().home, servicesLede: 'We fix these every week.' },
  }));

  assert.ok(mine['index.html'].includes('We fix these every week.'));
  assert.ok(!mine['index.html'].includes('page of their own'));

  const none = renderSite(SITE({
    structure: 'anvil',
    home: { ...SITE().home, servicesLede: '' },
  }));

  assert.ok(!none['index.html'].includes('page of their own'),
    'a cleared lede came back');
  assert.ok(none['index.html'].includes('anvil-ladder'), 'clearing it broke the section');
});

test('THE HOME HEADING IS THE BUSINESS NAME, A HYPHEN, THE TOWN AND THE STATE', () => {
  /* Edwin, 31 October: "next time I don't want a slash, I want a hyphen."
   * It is shared by all three structures — homeHeading() lives in common.js
   * precisely so a third layout cannot quietly disagree about it. */
  const h1 = anvil['index.html'].split('<h1>')[1].split('</h1>')[0];

  assert.strictEqual(h1, 'The Chicago Plumber - Chicago, IL');
  assert.ok(!h1.includes('/'), 'the separator is a slash again');
});

/* ======================================================================= */

section('THE TWO DIVIDERS');

const broken = renderSite(SITE({
  structure: 'anvil',
  home: {
    ...SITE().home,
    firstBreak: 'We answer the phone ourselves.',
    secondBreak: 'Ten minutes from most of Chicago.',
  },
}));

test('BOTH APPEAR, AND BOTH CARRY THE LINE THEY WERE GIVEN', () => {
  const home = broken['index.html'];

  assert.ok(home.includes('We answer the phone ourselves.'));
  assert.ok(home.includes('Ten minutes from most of Chicago.'));
  assert.strictEqual((home.match(/anvil-break/g) || []).length, 2);
});

test('A DIVIDER IS NOT A HEADING', () => {
  /* It is a breather: nothing sits under it and it introduces nothing. An
   * h2 here would put a heading in the document outline that leads
   * nowhere, which is a worse page for anything reading the structure
   * rather than looking at it. */
  const band = broken['index.html'].split('anvil-break')[1].split('</div>')[0];

  assert.ok(!/<h[1-6]/.test(band), 'the divider is marked up as a heading');
  assert.ok(/<p>/.test(broken['index.html'].split('anvil-break')[1]));
});

test('IT IS RAISED, NOT DEEP — THE OPPOSITE OF BEACON\'S', () => {
  /* Beacon's page is near-white, so its divider is a deep band: the dark
   * thing among light ones. Anvil's page is dark throughout, so the same
   * job needs the opposite move.
   *
   *     A DARK BAND ON A DARK PAGE IS NOT A BREAK, IT IS A GAP. */
  const css = String(anvil['assets/site.css']);
  const rule = (css.match(/\.anvil-break\{[^}]*\}/) || [''])[0];

  assert.ok(rule.includes('--av-raise'), 'the break is not raised off the ground');
  assert.ok(/border-top:1px solid/.test(rule), 'the break has no edge to separate it');
});

test('AND A SITE BUILT BEFORE THEY EXISTED RENDERS NO EMPTY BAND', () => {
  /* Every site stored before this structure existed has no firstBreak in
   * its source. A re-render must produce a page without a band, not a band
   * without a line. */
  assert.ok(!anvil['index.html'].includes('anvil-break'));

  const blank = renderSite(SITE({
    structure: 'anvil',
    home: { ...SITE().home, firstBreak: '   ', secondBreak: '' },
  }));

  assert.ok(!blank['index.html'].includes('anvil-break'), 'a blank line drew a band');
});

/* ======================================================================= */

section('THE VOICE');

test('ANVIL IS A VOICE, NOT A THIRD COPY OF THE RULES', () => {
  /* Everything in prompt.js which is not voice was paid for in measured
   * runs. A third prompt file that copied it would drift: the next fix
   * lands in one of the three, and nobody ever finds out from the two that
   * missed it. */
  assert.strictEqual(anvilPrompt.SECTIONS, ledgerPrompt.SECTIONS);
  assert.strictEqual(anvilPrompt.STANCES, ledgerPrompt.STANCES);
  assert.strictEqual(anvilPrompt.stanceFor, ledgerPrompt.stanceFor);
  assert.strictEqual(anvilPrompt.spellingFor, ledgerPrompt.spellingFor);
});

test('it writes at its own length, and all three lengths differ', () => {
  const l = ledgerPrompt.WORDS || { min: 780, max: 1000 };

  assert.ok(anvilPrompt.WORDS.min !== beaconPrompt.WORDS.min);
  assert.ok(anvilPrompt.WORDS.min !== l.min);
  assert.ok(anvilPrompt.WORDS.max !== beaconPrompt.WORDS.max);
  assert.ok(anvilPrompt.WORDS.max !== l.max);
});

test('AND ITS WORD BUDGET REACHES THE HOME PAGE, NOT JUST THE SERVICE PAGES', () => {
  /* THE BUG BEACON SHIPPED. Its first version set only the service-page
   * budget, so its home page came out exactly as long as Ledger's — caught
   * by putting two built pages side by side, not by any test.
   *
   *     A SETTING READ IN TWO PLACES HAS TO BE PASSED TO BOTH. */
  const home = anvilPrompt.homePagePrompt({
    business: { name: 'X', trade: 'plumbing', city: 'Chicago', state: 'IL' },
    services: SLUGS.map(s => ({ slug: s, name: s })),
    areas: ['Chicago'],
  });

  const text = `${home.system}\n${home.user}`;

  assert.ok(text.includes(String(anvilPrompt.HOME.about[0])),
    'the home page was not given Anvil\'s paragraph budget');

  assert.notDeepStrictEqual(anvilPrompt.HOME, beaconPrompt.HOME);
});

test('the service page prompt carries Anvil\'s lines and its length', () => {
  const out = anvilPrompt.servicePagePrompt({
    business: { name: 'X', trade: 'plumbing', city: 'Chicago', state: 'IL' },
    service: { slug: 'drain-cleaning', name: 'drain cleaning' },
    services: SLUGS.map(s => ({ slug: s, name: s })),
    areas: ['Chicago'],
  });

  const text = `${out.system}\n${out.user}`;

  assert.ok(text.includes('PREFER A VERB TO AN ADJECTIVE'), 'the voice lines are missing');
  assert.ok(text.includes(String(anvilPrompt.WORDS.min)), 'the length is missing');
});

test('THE THREE HOME PARAGRAPHS ARE ABOUT DIFFERENT THINGS FROM BOTH OTHERS', () => {
  /* THE BUG THIS EXISTS FOR. Ledger and Beacon were given the same three
   * subjects, and both came back opening paragraph three with "A visit
   * starts with", because Ledger's brief says "How a visit starts".
   *
   *     A BRIEF THAT DESCRIBES THE PARAGRAPH IN WORDS
   *     GETS THOSE WORDS BACK.
   *
   * Asserted as "no job is shared", not as the text of any of them — the
   * point is that they are not the same brief, not what any one says. */
  const mine = anvilPrompt.HOME_JOBS;

  assert.strictEqual(mine.length, 3);

  for (const job of mine) {
    assert.ok(!beaconPrompt.HOME_JOBS.includes(job), 'Anvil shares a brief with Beacon');
  }

  const ledgerJobs = (ledgerPrompt.HOME_JOBS || []).map(String);

  for (const job of mine) {
    assert.ok(!ledgerJobs.includes(job), 'Anvil shares a brief with Ledger');
  }
});

test('AND NONE OF THE THREE ASKS FOR A LIST', () => {
  /* Beacon allows exactly one, for symptoms. All three of Anvil's subjects
   * are sequences or judgements, and a list of either reads as a
   * specification.
   *
   *     THREE BRIEFS THAT ASK FOR A LIST PRODUCE A LIST OF LISTS.
   *     THE SUBJECT WAS NEVER THE PROBLEM; THE SHAPE WAS. */
  for (const job of anvilPrompt.HOME_JOBS) {
    assert.ok(!/\bname the\b.*\bsymptoms\b/i.test(job), 'a brief asks for an enumeration');
    assert.ok(!/\blist\b/i.test(job) || /not a list|rather than a list/i.test(job),
      `a brief invites a list: ${job.slice(0, 60)}`);
  }
});

test('AND NONE ASKS FOR A JOB THAT HAPPENED', () => {
  /* Beacon's second brief once said "what was found, and what happened
   * next" — past tense, which is an invitation to invent a visit, a
   * customer and an outcome. Nothing in the rules forbids a story in so
   * many words, because they forbid invented FIGURES.
   *
   *     THE RULE SAYS DO NOT INVENT A NUMBER.
   *     A NARRATED JOB IS AN INVENTED EVENT, WHICH IS WORSE. */
  const buildings = anvilPrompt.HOME_JOBS[1];

  assert.ok(/IN THE GENERAL/.test(buildings), 'the buildings brief does not refuse a case study');
  assert.ok(/never a particular address|named customer/i.test(buildings));
});

test('AND NO BRIEF ASKS FOR SOMETHING THE RULES FORBID', () => {
  /* The model is given the name, the trade, the address, the towns and six
   * service names — nothing else. A brief that asks for a team size or a
   * year founded asks for something the no-invented-figures rule will
   * refuse, and produces a worse paragraph than one that never asked. */
  for (const job of anvilPrompt.HOME_JOBS) {
    assert.ok(!/how many|years|since \d|team of|number of (?:vans|staff)/i.test(job),
      `a brief asks for a figure: ${job.slice(0, 60)}`);
  }

  /* AND THE ONE THAT COMES CLOSEST SAYS SO OUT LOUD. "What finished looks
   * like" is one word away from a warranty. */
  assert.ok(/guarantee/i.test(anvilPrompt.HOME_JOBS[2]),
    'the finished-job brief does not rule out a guarantee');
});

test('THE TITLE AND THE DESCRIPTION HAVE A THIRD ANGLE', () => {
  /* Ledger leads with the business name, Beacon with the kind of work,
   * Anvil with the place. Two structures leading with the same slot
   * produce two titles of the same shape with a different noun in it. */
  const mine = anvilPrompt.ANVIL_VOICE;

  assert.notStrictEqual(mine.title, beaconPrompt.BEACON_VOICE.title);
  assert.notStrictEqual(mine.meta, beaconPrompt.BEACON_VOICE.meta);

  assert.ok(/town and state/i.test(mine.title), 'Anvil does not lead with the place');
  assert.ok(/End with what to do next/i.test(mine.meta), 'the description has no action');
});

test('THE BUSINESS NAME IS IN BOTH, AND IS NEVER SHORTENED OR DROPPED', () => {
  /* Edwin, 30 October: "it should always appear in the title and meta
   * description." "The Austin Plumber" is the case that proves the rule
   * needs both halves — told only not to lead with the name, a model
   * satisfies it by writing "Austin Plumber", which is a different
   * company's name. */
  const mine = anvilPrompt.ANVIL_VOICE;

  assert.ok(/business name/i.test(mine.title), 'the title brief never mentions the name');
  assert.ok(/exactly as it was given/i.test(mine.title), 'the title may reword the name');

  assert.ok(/business name/i.test(mine.meta), 'the description brief never mentions the name');
  assert.ok(/exactly as it was given/i.test(mine.meta), 'the description may reword the name');
});

test('THE DIVIDER EXEMPTION IS STATED, OR THE TWO RULES CANCEL', () => {
  /* The system prompt refuses the marketing register by name, and the
   * dividers are the one thing on the page MEANT to be a pleasantry.
   *
   *     AN EXCEPTION THAT IS NOT STATED IS NOT AN EXCEPTION.
   *     IT IS TWO RULES AND A COIN TOSS. */
  const home = anvilPrompt.homePagePrompt({
    business: { name: 'X', trade: 'plumbing', city: 'Chicago', state: 'IL' },
    services: SLUGS.map(s => ({ slug: s, name: s })),
    areas: ['Chicago'],
  });

  const text = `${home.system}\n${home.user}`;

  assert.ok(text.includes('EXEMPT FROM THE NO-MARKETING-REGISTER RULE'));
  assert.ok(/firstBreak/.test(text) && /secondBreak/.test(text));
});

test('BUT THE FLOOR HOLDS: NO SUPERLATIVE, NO GUARANTEE, NO NUMBER', () => {
  /* "We strive to provide quality service" is a pleasantry; "the best
   * plumbers in Chicago" is a claim nobody checked, and the
   * no-invented-facts rule is not about taste. */
  const note = anvilPrompt.ANVIL_VOICE.extrasNote;

  assert.ok(/no superlative/i.test(note));
  assert.ok(/guarantee/i.test(note));
  assert.ok(/no number/i.test(note));
});

test('AND ANVIL\'S TWO DIVIDER BRIEFS ARE NOT BEACON\'S', () => {
  /* Identical briefs on two structures produce identical lines, and these
   * appear on the home page — where two sites are most likely to be set
   * side by side, which is exactly how the paragraph-three collision was
   * found. */
  const mine = anvilPrompt.ANVIL_VOICE.extras.map(e => e.brief);
  const theirs = beaconPrompt.BEACON_VOICE.extras.map(e => e.brief);

  for (const brief of mine) {
    assert.ok(!theirs.includes(brief), 'Anvil shares a divider brief with Beacon');
  }

  assert.deepStrictEqual(
    anvilPrompt.ANVIL_VOICE.extras.map(e => e.key),
    ['firstBreak', 'secondBreak'],
    'the stored field names changed, which would orphan every built site');
});

test('AND NO BRIEF CARRIES A DOUBLE QUOTE INTO THE JSON TEMPLATE', () => {
  /* The home page prompt builds a JSON template the model fills in. A
   * double quote inside a brief closes a string early and the reply comes
   * back unparseable. */
  const all = [
    ...anvilPrompt.HOME_JOBS,
    anvilPrompt.ABOUT_HEADING,
    anvilPrompt.ANVIL_VOICE.title,
    anvilPrompt.ANVIL_VOICE.meta,
    ...anvilPrompt.ANVIL_VOICE.extras.map(e => e.brief),
  ];

  for (const brief of all) {
    assert.ok(!brief.includes('"'), `a brief carries a double quote: ${brief.slice(0, 40)}`);
  }
});

test('AND THE ABOUT HEADING ASKS FOR A PROPERTY, NOT A SENTENCE TO ECHO', () => {
  /* Ledger says "a heading that says you are a local <trade> company in
   * <city, state>", and gets back "We Are a Local Plumbing Company in
   * Chicago, IL" — the brief, with capitals. Dictation. */
  const h = anvilPrompt.ABOUT_HEADING;

  assert.ok(/MUST contain a verb/i.test(h), 'the heading brief has no testable property');
  assert.ok(h !== beaconPrompt.ABOUT_HEADING, 'Anvil shares Beacon\'s heading brief');
  assert.ok(!/["']/.test(h), 'the heading brief carries an example to echo');
});

/* ======================================================================= */

section('WHAT DESIGN 3 MEANS ON THE FORM');

test('DESIGN 3 IS THE WHOLE PACKAGE, NOT JUST THE PHOTOGRAPHS', () => {
  /* Edwin, 30 October, having been told a second design would change "the
   * photographs, and nothing else": "I want a different html structure,
   * diferent css and different classes and prefix and css IDs, Different
   * prompts." */
  const three = designFor('3');

  assert.ok(three, 'there is no Design 3');
  assert.strictEqual(three.structure, 'anvil');
  assert.strictEqual(three.imageSet, 'set-3');

  assert.deepStrictEqual(buildOptionsFor('3'), {
    design: '3', structure: 'anvil', imageSet: 'set-3',
  });
});

test('every design names a structure that exists, with its own photographs', () => {
  const keys = structureKeys();
  const seen = new Set();

  for (const d of DESIGNS) {
    assert.ok(keys.includes(d.structure), `${d.label} names ${d.structure}, which does not exist`);

    /* NO TWO DESIGNS ARE THE SAME SITE. Two that shared a structure AND a
     * photo set would be one design offered twice. */
    const pair = `${d.structure}/${d.imageSet}`;

    assert.ok(!seen.has(pair), `two designs are both ${pair}`);
    seen.add(pair);
  }
});

test('AND THE IDS ARE STRINGS THAT ARE NOT THE INDEX', () => {
  /* '1', '2' and '3' are what a form posts and what an old job payload may
   * already carry. Renumbering them because a design was removed would
   * re-point every stored site. */
  assert.deepStrictEqual(DESIGNS.map(d => d.id), ['1', '2', '3']);
  assert.ok(DESIGNS.every(d => 'string' === typeof d.id));
});

test('AN UNKNOWN DESIGN IS THE DEFAULT, NOT A FAILED BUILD', () => {
  /* A stale form, an old job payload or a typed URL must not fail a build
   * that is otherwise fine. */
  assert.strictEqual(designFor('4'), null);
  assert.strictEqual(designFor(''), null);

  assert.deepStrictEqual(buildOptionsFor('4'), {
    design: '', structure: 'ledger', imageSet: '',
  });
});

/* ---------------------------------------------------------------------- */

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
