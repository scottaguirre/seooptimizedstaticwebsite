// test-local-options-beacon.js
//
// The second structure, and the seam that keeps it apart from the first.
//
// WHAT THIS IS GUARDING. Beacon and Ledger are both served as
// assets/site.css to different sites built by the same code. The failure
// this suite exists for is not a crash — it is a page that renders perfectly
// with a stylesheet written for the other layout, where every selector
// misses, nothing throws, and the site goes out as unstyled text.
//
//     A STYLESHEET AND ITS MARKUP ARE ONE CHOICE, NOT TWO.
//
//   node test-local-options-beacon.js

'use strict';

const assert = require('assert');

const { renderSite } = require('./utils/localOptions/render/renderSite');
const { structureFor, structureKeys } = require('./utils/localOptions/render/structures');
const { STRUCTURES } = require('./utils/localOptions/render/theme');
const { DESIGNS, designFor, buildOptionsFor } = require('./utils/localOptions/designs');

const ledgerPrompt = require('./utils/localOptions/prompt');
const beaconPrompt = require('./utils/localOptions/prompt-beacon');

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
  url: 'https://7-y.xyz/the-chicago-plumber',
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
    h1: 'Plumbing in Chicago, IL', sub: 'Same-week appointments.',
    title: 'The Chicago Plumber', meta: 'A description.',
    aboutHeading: 'A local plumbing company', about: ['First.', 'Second.'],
  },
  now: new Date('2026-10-30T00:00:00Z'),
  ...over,
});

const beacon = renderSite(SITE({ structure: 'beacon' }));
const ledger = renderSite(SITE({ structure: 'ledger' }));

const allOf = files => Object.entries(files)
  .filter(([path]) => path.endsWith('.html') || path.endsWith('.css'))
  .map(([, body]) => String(body)).join('\n');

/* ======================================================================= */

section('THE TWO DO NOT TOUCH');

test('NO LEDGER CLASS, PREFIX OR CUSTOM PROPERTY REACHES A BEACON SITE', () => {
  /* THE FAILURE THIS WHOLE FILE EXISTS FOR. Both are served as
   * assets/site.css to different sites. A shared name is not a clash inside
   * one file — it is a rule written for one layout silently restyling the
   * other, on a site nobody happens to be looking at. */
  const text = allOf(beacon);

  assert.ok(!/ledger-/.test(text), 'a ledger- name is in a Beacon site');
  assert.ok(!/--lg-/.test(text), 'a --lg- custom property is in a Beacon site');
});

test('and no Beacon name reaches a Ledger site', () => {
  const text = allOf(ledger);

  assert.ok(!/beacon-/.test(text), 'a beacon- name is in a Ledger site');
  assert.ok(!/--bn-/.test(text), 'a --bn- custom property is in a Ledger site');
});

test('THE IDS DIFFER TOO, WHICH IS WHAT WAS ASKED FOR', () => {
  /* Edwin, 30 October: "different classes and prefix and css IDs". `#main`
   * is the skip link's target and `#services` is linked from the header on
   * every page; a structure that reused them would work, and would mean the
   * two layouts could never be told apart by a fragment in a URL. */
  assert.ok(beacon['index.html'].includes('<main id="content">'));
  assert.ok(ledger['index.html'].includes('<main id="main">'));

  assert.ok(beacon['index.html'].includes('id="trades"'));
  assert.ok(ledger['index.html'].includes('id="services"'));

  assert.ok(!beacon['index.html'].includes('id="main"'));
  assert.ok(!ledger['index.html'].includes('id="content"'));
});

test('and so do the contact form field ids', () => {
  /* Ledger uses n/p/e/m. A second structure reusing them would be two
   * layouts whose markup cannot be told apart by anything reading ids. */
  assert.ok(beacon['contact/index.html'].includes('id="bn"'));
  assert.ok(!beacon['contact/index.html'].includes('id="n"'));
});

test('A STYLESHEET NEVER ARRIVES WITHOUT ITS OWN MARKUP', () => {
  /* The bug the structures.js seam was built to make impossible. Before it,
   * renderSite() took the CSS from a structure object and imported Ledger's
   * pages.js directly — so `structure: 'beacon'` produced Beacon's
   * stylesheet over Ledger's elements. Every selector misses, nothing
   * throws, and the site goes out as unstyled text. */
  assert.ok(beacon['assets/site.css'].includes('.beacon-shell'));
  assert.ok(beacon['index.html'].includes('class="beacon-shell'));

  assert.ok(ledger['assets/site.css'].includes('.ledger-shell'));
  assert.ok(ledger['index.html'].includes('class="ledger-shell'));
});

test('AND A TYPO IN THE STRUCTURE NAME FALLS BACK TO BOTH HALVES OF ONE', () => {
  /* structureFor('beocn') returns Ledger, and it has to return LEDGER's
   * pages with it. Resolving the stylesheet by the raw string and the
   * markup by the resolved key is the same mismatch by another route. */
  const typo = renderSite(SITE({ structure: 'beocn' }));

  assert.ok(typo['assets/site.css'].includes('.ledger-shell'));
  assert.ok(typo['index.html'].includes('class="ledger-shell'));
  assert.ok(!/beacon-/.test(allOf(typo)));
});

test('THE HEADER ROW IS ALWAYS TALLER THAN THE LOGO IN IT', () => {
  /* THE INVARIANT, NOT THE NUMBER. The mark carries no width or height
   * attributes — a 42x42 box on a wide lockup was the original bug — so the
   * row's height has to be settled by CSS before the image arrives. A row
   * shorter than its logo means the header grows as the logo loads, and
   * everything below it jumps.
   *
   * Checked rather than pinned, because the sizes move: 46px became 55px on
   * 30 October when Edwin said the logo looked too small, and raising one
   * of the pair without the other is exactly what this catches. */
  const { LEDGER, BEACON } = require('./utils/localOptions/render/theme');

  const pairs = [
    [LEDGER, 'ledger-head__row', 'ledger-brand__mark'],
    [BEACON, 'beacon-masthead__row', 'beacon-brand__mark'],
  ];

  for (const [structure, row, mark] of pairs) {
    /* EVERY BLOCK FOR THE SELECTOR, so the narrow-screen override is
     * measured against the narrow-screen row too. */
    const heights = [...structure.css.matchAll(new RegExp(`\\.${mark}\\{[^}]*height:(\\d+)px`, 'g'))]
      .map(m => Number(m[1]));

    const rows = [...structure.css.matchAll(new RegExp(`\\.${row}\\{[^}]*min-height:(\\d+)px`, 'g'))]
      .map(m => Number(m[1]));

    assert.ok(heights.length, `${mark} sets no height`);
    assert.ok(rows.length, `${row} sets no min-height`);

    assert.ok(Math.max(...heights) < Math.max(...rows),
      `${mark} is ${Math.max(...heights)}px in a ${Math.max(...rows)}px row`);
  }
});

test('and a wide logo is capped by width, not by height', () => {
  /* RAISING THE HEIGHT ALONE MAKES A WIDE LOCKUP SMALLER, NOT LARGER: the
   * max-width caps it sooner, and object-fit:contain then shrinks it to
   * fit. The pair has to move together, which is the trap in "make the logo
   * 20% bigger". */
  const { LEDGER, BEACON } = require('./utils/localOptions/render/theme');

  for (const s of [LEDGER, BEACON]) {
    const rule = s.css.match(/brand__mark\{height:(\d+)px;width:auto;max-width:min\((\d+)px/);

    assert.ok(rule, 'the logo rule is not the shape this test reads');

    const [, height, maxWidth] = rule.map(Number);

    /* A TRADE LOCKUP IS WIDER THAN IT IS TALL — 400x90 is typical, about
     * 4.4:1. The cap has to clear that ratio or it bites on every logo. */
    assert.ok(maxWidth / height >= 4.4,
      `a 4.4:1 logo is capped: ${maxWidth}px wide at ${height}px tall`);
  }
});

/* ======================================================================= */

section('THE SAME SITE, DIFFERENTLY DRESSED');

test('THE SAME ELEVEN PAGES, plus the stylesheet, sitemap, robots and 404', () => {
  /* "Keep the same sections" is about what is inside a page; this is the
   * same rule one level up. A second structure that dropped or added a page
   * would be a second product. */
  assert.deepStrictEqual(Object.keys(beacon).sort(), Object.keys(ledger).sort());
});

test('and every service page carries the same sections', () => {
  for (const slug of SLUGS) {
    const page = beacon[`${slug}/index.html`];

    assert.ok(page.includes('Opening one.'), `${slug} lost its opening`);
    assert.ok(page.includes('<h2>A heading</h2>'), `${slug} lost its heading`);
  }
});

test('THE RING STILL CAPS THE BODY AT TWO LINKED SERVICES', () => {
  /* A rule about the SITE, not about how it looks. The home page shows all
   * six and links the first three; the other three are the same tile
   * without an anchor and visibly muted. */
  /* MATCHED ON THE WHOLE ATTRIBUTE, NOT ON A PREFIX. `beacon-trade[^"]*`
   * also catches beacon-trades, beacon-trade__tally, __name and __said —
   * 27 of them — and the first version of this test reported the code
   * broken on its own loose pattern. */
  const tiles = beacon['index.html'].match(/class="beacon-trade(?: beacon-trade--flat)?"/g) || [];
  const flat = tiles.filter(c => c.includes('--flat'));

  assert.strictEqual(tiles.length, 6, 'not six tiles');
  assert.strictEqual(flat.length, 4, 'not four muted tiles');
});

test('the nav carries ALL SIX, because navigation is not the ring', () => {
  /* The rule shape.js states and chrome.js broke once, in a file whose
   * comment said it was obeying it. */
  const head = beacon['index.html'].split('</header>')[0];

  for (const slug of SLUGS) {
    assert.ok(head.includes(`${slug}/`), `the Beacon menu is missing ${slug}`);
  }
});

test('the Search Console tag is on every page', () => {
  for (const [path, body] of Object.entries(beacon)) {
    if (!path.endsWith('.html')) continue;

    assert.ok(String(body).includes('dK3xP9mQ2vR7nL4tY8wZ'), `${path} has no verification tag`);
  }
});

test('AND THE LOGO IS RE-BASED FOR DEPTH ON EVERY PAGE', () => {
  /* The bug Ledger shipped for a day: `assets/logo.png` is correct at the
   * root and asks for /drain-cleaning/assets/logo.png from a service page.
   * A relative path that is not re-based is invisible to a check for
   * absolute ones. */
  assert.ok(beacon['index.html'].includes('src="assets/logo.png"'));
  assert.ok(beacon['drain-cleaning/index.html'].includes('src="../assets/logo.png"'));
});

test('the schema and the canonical are untouched by the layout', () => {
  const b = JSON.parse(beacon['index.html'].match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
  const l = JSON.parse(ledger['index.html'].match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);

  assert.deepStrictEqual(b, l);

  for (const slug of SLUGS) {
    assert.ok(beacon[`${slug}/index.html`]
      .includes(`<link rel="canonical" href="https://7-y.xyz/the-chicago-plumber/${slug}/">`));
  }
});

test('a build is reproducible — the same input gives the same bytes', () => {
  /* The deploy skips a file whose hash it already has, which only works if
   * nothing reads the clock. */
  assert.deepStrictEqual(renderSite(SITE({ structure: 'beacon' })), beacon);
});

test('THE SENTENCE ABOVE THE TILES IS WRITTEN FOR A CUSTOMER', () => {
  /* It read "All six have a page of their own. The first two are linked
   * here; the rest follow on from them, and every one is in the menu
   * above" — a description of the site's own internal linking, on the
   * front page of a plumbing company. Edwin: "this should be for a
   * customer."
   *
   * A homeowner does not care which rows are anchors.
   *
   * AND THE COUNT STILL COMES FROM THE CONSTANT. This very sentence said
   * three while the cap said two for part of 30 October, because it was
   * typed out six lines from the number that decides it. */
  for (const files of [beacon, ledger]) {
    const text = files['index.html'].replace(/\s+/g, ' ');

    assert.ok(/called out for most/.test(text), 'the lede was not rewritten');
    assert.ok(/\bsix\b/.test(text), 'the lede lost the service count');

    assert.ok(!/linked here/.test(text), 'the lede still explains the linking');
    assert.ok(!/menu above/.test(text), 'the lede still gives navigation directions');
    assert.ok(!/first (two|three)/.test(text), 'the lede still names the cap');
  }
});

test('AND THE OWNER CAN REPLACE IT, OR TAKE IT AWAY', () => {
  /* undefined is the structure's default; '' is no line. Both structures,
   * because the default is per-structure and the field is not. */
  for (const key of ['beacon', 'ledger']) {
    const own = renderSite(SITE({
      structure: key,
      home: { sub: 's', title: 't', meta: 'm', aboutHeading: 'A', about: ['x'],
        servicesLede: 'Call us and a person answers.' },
    }))['index.html'];

    assert.ok(own.includes('Call us and a person answers.'), `${key} ignored the owner's line`);
    assert.ok(!/called out for most/.test(own), `${key} printed the default as well`);

    const none = renderSite(SITE({
      structure: key,
      home: { sub: 's', title: 't', meta: 'm', aboutHeading: 'A', about: ['x'], servicesLede: '' },
    }))['index.html'];

    assert.ok(!/called out for most/.test(none), `${key} brought the default back on an empty string`);
  }
});

test('AND NO PAGE CARRIES AN HTML COMMENT AT ALL', () => {
  /* The note explaining the rewrite above was first written as <!-- -->
   * INSIDE the template, which shipped every word of it — the quoted old
   * copy, and Edwin by name — into the source of every published page, on
   * a client's own domain. The assertion above found it by noticing the
   * phrase it was banning was still in the output.
   *
   *     A COMMENT ABOUT THE PAGE IS NOT PART OF THE PAGE.
   *
   * Asserted across all eleven of both structures, because the next one
   * will be written in whichever file nobody is looking at. */
  for (const files of [beacon, ledger]) {
    for (const [path, body] of Object.entries(files)) {
      if (!path.endsWith('.html')) continue;

      assert.ok(!String(body).includes('<!--'),
        `${path} ships an HTML comment`);
    }
  }
});

/* ======================================================================= */

section('THE HOME PAGE HEADING');

test('IT IS THE BUSINESS NAME, A HYPHEN, THE TOWN AND THE STATE', () => {
  /* Edwin, 30 October: "the H1 should be the name of the business followed
   * by a slash and then The city + State."
   *
   * BUILT, NOT ASKED FOR. The model used to write it from a brief saying
   * "what you do, and where, naming the town and the state" and produced
   * "Plumbing in Chicago, IL" — correct, and not what was wanted. A fixed
   * shape requested in words is a shape that drifts. */
  for (const files of [beacon, ledger]) {
    const h1 = files['index.html'].match(/<h1>([^<]*)<\/h1>/)[1];

    assert.strictEqual(h1, 'The Chicago Plumber - Chicago, IL');
  }
});

test('and no trade word is invented for a business whose name lacks one', () => {
  /* A plumber called Gomanzo gets "Gomanzo / Chicago, IL", which says
   * nothing about plumbing. That is the choice: the line under the H1 says
   * what they do, and the alternative is an H1 that is not the business's
   * actual name. */
  const { homeHeading } = require('./utils/localOptions/render/common');

  assert.strictEqual(
    homeHeading({ name: 'Gomanzo', trade: 'plumbing', city: 'Chicago', state: 'IL' }),
    'Gomanzo - Chicago, IL'
  );
});

test('IT DEGRADES RATHER THAN PRINTING A STRAY SEPARATOR', () => {
  /* A separator is only a separator when there is something on both sides
   * of it. "Gomanzo - " and " - Chicago, IL" are both worse than the half
   * that is true. */
  const { homeHeading } = require('./utils/localOptions/render/common');

  assert.strictEqual(homeHeading({ name: 'Gomanzo' }), 'Gomanzo');
  assert.strictEqual(homeHeading({ city: 'Austin', state: 'TX' }), 'Austin, TX');
  assert.strictEqual(homeHeading({ name: 'X', city: 'Austin' }), 'X - Austin');
  assert.strictEqual(homeHeading({}), '');
  assert.strictEqual(homeHeading(), '');
});

test('AND THE MODEL IS NO LONGER ASKED FOR A HEADING NOTHING READS', () => {
  /* A field the renderer ignores is worse than no field: the model spends
   * tokens on it, the stored source carries it, and the editor grew a
   * Headline box bound to it that saved and changed nothing. */
  for (const prompt of [ledgerPrompt, beaconPrompt]) {
    const { system } = prompt.homePagePrompt({ business: { name: 'X', city: 'Chicago', state: 'IL' } });

    const template = system.slice(system.indexOf('{'), system.lastIndexOf('}') + 1);

    assert.ok(!/"h1"/.test(template), 'the home template still asks for an h1');
  }
});

/* ======================================================================= */

section('THE TWO DIVIDERS');

/* A source carrying the lines, and one built before they existed. */
const WITH_BREAKS = SITE({
  structure: 'beacon',
  home: {
    h1: 'h', sub: 's', title: 't', meta: 'm',
    aboutHeading: 'A heading', about: ['One.'],
    firstBreak: 'Two vans out of South Michigan Avenue each morning',
    secondBreak: 'The number on this page rings a phone in Chicago',
  },
});

const broken = renderSite(WITH_BREAKS);

test('BOTH APPEAR, AND BOTH CARRY THE LINE THEY WERE GIVEN', () => {
  const home = broken['index.html'];

  assert.strictEqual((home.match(/class="beacon-divider"/g) || []).length, 2);
  assert.ok(home.includes('Two vans out of South Michigan Avenue each morning'));
  assert.ok(home.includes('The number on this page rings a phone in Chicago'));
});

test('they sit between the bands, not inside them', () => {
  /* One after the facts card and before the services, one after the
   * services and before the map — which is what makes them breathers
   * rather than section headings. */
  const home = broken['index.html'];

  const first = home.indexOf('beacon-divider');
  const tiles = home.indexOf('beacon-tiles');
  const second = home.indexOf('beacon-divider', first + 1);
  const map = home.indexOf('beacon-whereabouts');

  assert.ok(first < tiles, 'the first divider is not above the services');
  assert.ok(tiles < second, 'the second divider is not below the services');
  assert.ok(second < map, 'the second divider is not above the map');
});

test('A DIVIDER IS NOT A HEADING', () => {
  /* It is a breather: there is no section under it and nothing it
   * introduces. An h2 here would put an entry in the document outline that
   * leads nowhere — a worse page for anything reading the structure rather
   * than looking at it, and invisible to anything that only looks. */
  const band = broken['index.html']
    .match(/<div class="beacon-divider">[\s\S]*?<\/div><\/div>/)[0];

  assert.ok(!/<h[1-6]/.test(band), 'the divider is marked up as a heading');
  assert.ok(/<p>/.test(band));
});

test('AND A SITE BUILT BEFORE THEY EXISTED RENDERS NO EMPTY BAND', () => {
  /* Every Beacon site published before 30 October has no firstBreak in its
   * stored source. A re-render of one must produce a page WITHOUT a band,
   * not a band without a line — which is the difference between an edit
   * that changes nothing and an edit that puts two navy stripes through
   * somebody's live home page. */
  const home = renderSite(SITE({ structure: 'beacon' }))['index.html'];

  assert.strictEqual((home.match(/beacon-divider/g) || []).length, 0);
});

test('and a blank line is the same as no line', () => {
  const home = renderSite(SITE({
    structure: 'beacon',
    home: { h1: 'h', sub: 's', title: 't', meta: 'm', aboutHeading: 'A', about: ['x'], firstBreak: '   ', secondBreak: '' },
  }))['index.html'];

  assert.strictEqual((home.match(/beacon-divider/g) || []).length, 0);
});

test('LEDGER NEVER RENDERS ONE, EVEN IF ITS SOURCE CARRIES THE FIELDS', () => {
  /* A site moved between designs, or a source hand-edited, must not grow a
   * band Ledger has no stylesheet for. */
  const home = renderSite({ ...WITH_BREAKS, structure: 'ledger' })['index.html'];

  assert.ok(!/divider/.test(home));
});

test('and Ledger is never ASKED for them either', () => {
  const l = ledgerPrompt.homePagePrompt({ business: { name: 'X', city: 'Chicago', state: 'IL' } });
  const b = beaconPrompt.homePagePrompt({ business: { name: 'X', city: 'Chicago', state: 'IL' } });

  assert.strictEqual(ledgerPrompt.LEDGER_VOICE.extras.length, 0);
  assert.ok(!/firstBreak/.test(l.system));
  assert.ok(/firstBreak/.test(b.system) && /secondBreak/.test(b.system));
});

test('THEY ARE PLEASANTRIES, AND THE EXEMPTION THAT ALLOWS THEM IS STATED', () => {
  /* Edwin, 30 October: "forget about trade. Just say something nice coming
   * from a local business to a customer such as: We are here to serve you."
   *
   * He had already been told the cost — that register is banned by name in
   * the rules, and a fixed pleasantry repeats across every site on the
   * domain — and chose it anyway. It is his product.
   *
   * WHAT THIS GUARDS IS THAT THE EXEMPTION IS SAID OUT LOUD. Brief the
   * dividers for warmth and leave "No marketing register" standing above
   * them, and the two instructions pull opposite ways — which is how a
   * page ends up with neither, as the brief-versus-rules test below says
   * in so many words. */
  const sys = beaconPrompt.homePagePrompt({
    business: { name: 'X', city: 'Chicago', state: 'IL', trade: 'plumbing' },
  }).system;

  assert.ok(/EXEMPT FROM THE NO-MARKETING-REGISTER RULE/.test(sys),
    'the dividers are briefed for warmth with nothing lifting the rule');

  /* AND IT IS IN THE RULES, NOT BURIED IN THE FIELD. The spelling line
   * learned that: an instruction competing with twenty others loses. */
  assert.ok(sys.indexOf('EXEMPT FROM') < sys.indexOf('OUTPUT:'),
    'the exemption is below the template, where rules are not read');
});

test('and Ledger, which adds no fields, carries no exemption', () => {
  const sys = ledgerPrompt.homePagePrompt({ business: { name: 'X', city: 'Chicago', state: 'IL' } }).system;

  assert.ok(!/EXEMPT/.test(sys));
  assert.strictEqual(ledgerPrompt.LEDGER_VOICE.extrasNote, '');
});

test('BUT THE FLOOR HOLDS: NO SUPERLATIVE, NO GUARANTEE, NO NUMBER', () => {
  /* The exemption is about REGISTER. "We strive to provide quality
   * service" is a pleasantry; "the best plumbers in Chicago" is a claim
   * nobody checked, and the no-invented-facts rule is not about taste.
   *
   * Asserted in both places, because either one going quiet leaves the
   * other arguing with itself. */
  const sys = beaconPrompt.homePagePrompt({
    business: { name: 'X', city: 'Chicago', state: 'IL', trade: 'plumbing' },
  }).system;

  assert.ok(/no superlative, no best or fastest or cheapest, no \s*guarantee, no number/.test(sys.replace(/\n/g, ' ')),
    'the exemption does not restate the floor');

  for (const field of beaconPrompt.BEACON_VOICE.extras) {
    assert.ok(/No exclamation mark, no superlative/.test(field.brief),
      `${field.key} allows a superlative`);

    assert.ok(/best, fastest, cheapest or guaranteed/.test(field.brief),
      `${field.key} allows a claim`);
  }
});

/* ======================================================================= */

section('THE VOICE');

test('BEACON IS A VOICE, NOT A SECOND COPY OF THE RULES', () => {
  /* Everything in prompt.js that is not voice was paid for in measured
   * runs — the no-invented-figures rule, the concrete-noun rule, the
   * spelling rule that had to be stated rather than derived, the heading
   * brief that had to stop describing the heading it wanted. A copy drifts:
   * the next fix lands in one of the two and nobody finds out from the one
   * that missed it. */
  assert.strictEqual(beaconPrompt.SECTIONS, ledgerPrompt.SECTIONS);
  assert.strictEqual(beaconPrompt.STANCES, ledgerPrompt.STANCES);
});

test('it writes shorter, and says so in words the model can check', () => {
  const b = beaconPrompt.servicePagePrompt({
    business: { name: 'X', city: 'Chicago', state: 'IL' },
    service: { name: 'Drain Cleaning', slug: 'drain-cleaning' },
  });

  const l = ledgerPrompt.servicePagePrompt({
    business: { name: 'X', city: 'Chicago', state: 'IL' },
    service: { name: 'Drain Cleaning', slug: 'drain-cleaning' },
  });

  assert.ok(b.system.includes('520 to 700'));
  assert.ok(l.system.includes('780 to 1000'));
  assert.ok(b.system.includes('SHORT SENTENCES'));
  assert.ok(!l.system.includes('SHORT SENTENCES'));
});

test('AND IT KEEPS EVERY RULE THAT DOES NOT BEND', () => {
  const b = beaconPrompt.servicePagePrompt({
    business: { name: 'X', city: 'Chicago', state: 'IL' },
    service: { name: 'Drain Cleaning', slug: 'drain-cleaning' },
  });

  assert.ok(b.system.includes('NEVER invent a price'));
  assert.ok(b.system.includes('concrete noun'));
  assert.ok(b.system.includes('SPELLING: American'));
  assert.ok(b.system.includes('No marketing register'));
});

test('the home page prompt takes the voice too', () => {
  const b = beaconPrompt.homePagePrompt({ business: { name: 'X', city: 'Chicago', state: 'IL' } });
  const l = ledgerPrompt.homePagePrompt({ business: { name: 'X', city: 'Chicago', state: 'IL' } });

  assert.ok(b.system.includes('SHORT SENTENCES'));
  assert.ok(!l.system.includes('SHORT SENTENCES'));
});

test('AND ITS WORD BUDGET, WHICH THE FIRST VERSION LEFT BEHIND', () => {
  /* `words` is the SERVICE page's and is stated as a LENGTH line. The home
   * page's lengths live in its JSON template instead, so wiring the voice
   * into one and not the other produced a Beacon home page exactly as long
   * as Ledger's — caught by putting two built pages side by side, not by
   * anything here.
   *
   *     A SETTING READ IN TWO PLACES HAS TO BE PASSED TO BOTH.
   *     ONE OF THEM GOING QUIET LOOKS EXACTLY LIKE IT WORKING. */
  const b = beaconPrompt.homePagePrompt({ business: { name: 'X', city: 'Chicago', state: 'IL' } });
  const l = ledgerPrompt.homePagePrompt({ business: { name: 'X', city: 'Chicago', state: 'IL' } });

  assert.ok(b.system.includes('25-40 words each'), 'Beacon kept the long about budget');
  assert.ok(b.system.includes('14-22 words'), 'Beacon kept the long sub budget');

  assert.ok(l.system.includes('35-60 words each'));
  assert.ok(l.system.includes('20-30 words'));
});

test('AND THE STRUCTURE CARRIES ITS OWN PROMPTS, so a typo cannot split them', () => {
  /* An unknown key falls back to Ledger for markup, stylesheet AND prompts
   * at once — rather than writing Beacon-length copy into Ledger's layout. */
  assert.strictEqual(structureFor('beacon').prompt, beaconPrompt);
  assert.strictEqual(structureFor('ledger').prompt, ledgerPrompt);
  assert.strictEqual(structureFor('beocn').prompt, ledgerPrompt);
});

test('every structure with a stylesheet has markup and prompts to go with it', () => {
  /* A stylesheet with no page builders is a file that looks finished and is
   * not — which is exactly what the comment in theme.js claimed Beacon was
   * for a week. */
  for (const key of Object.keys(STRUCTURES)) {
    const s = structureFor(key);

    assert.strictEqual(s.key, key, `${key} resolved to ${s.key}`);
    assert.ok(s.pages && s.pages.homePage, `${key} has no page builders`);
    assert.ok(s.prompt && s.prompt.servicePagePrompt, `${key} has no prompts`);
  }

  assert.deepStrictEqual(structureKeys(), ['ledger', 'beacon']);
});

test('THE THREE HOME PARAGRAPHS ARE ABOUT DIFFERENT THINGS, NOT REWORDED', () => {
  /* THE BUG THIS EXISTS FOR. Both structures were given the same three
   * subjects, and both came back opening paragraph three with "A visit
   * starts with" — because Ledger's brief says "How a visit starts". The
   * style rules could not move it: they govern how a sentence is built, not
   * what it is about.
   *
   *     A BRIEF THAT DESCRIBES THE PARAGRAPH IN WORDS
   *     GETS THOSE WORDS BACK.
   *
   * Asserted as "no job is shared", not as the text of either — the point is
   * that they differ, and pinning the wording here would make every future
   * edit to a brief a test failure for no reason. */
  const l = ledgerPrompt.LEDGER_VOICE.homeJobs;
  const b = beaconPrompt.HOME_JOBS;

  assert.strictEqual(l.length, 3);
  assert.strictEqual(b.length, 3);

  for (const job of b) {
    assert.ok(!l.includes(job), `Beacon reuses a Ledger brief: ${job.slice(0, 40)}…`);
  }
});

test('and neither brief dictates a sentence the page can echo back', () => {
  /* "How a visit starts" came back as "A visit starts with". A brief is
   * safer when it asks for a PROPERTY than when it describes a sentence —
   * the rewrite the service-page headings needed after five cost headings
   * came back as five restatements of the brief that asked for them. */
  assert.ok(!/^How /.test(beaconPrompt.HOME_JOBS[2]));
  assert.ok(/MUST/.test(beaconPrompt.ABOUT_HEADING), 'the heading brief states no rule');
});

test('AND NO BRIEF ASKS FOR SOMETHING THE RULES FORBID', () => {
  /* A brief that asks for a team size, a year founded or a number of vans
   * produces a worse paragraph than one that never asked: the model is told
   * elsewhere, in capitals, never to invent them. Two instructions pulling
   * opposite ways is how a page ends up with neither. */
  const forbidden = /\b(years? in business|founded|team of|vans?|customers served|certif)/i;

  for (const job of [...beaconPrompt.HOME_JOBS, ...ledgerPrompt.LEDGER_VOICE.homeJobs]) {
    assert.ok(!forbidden.test(job), `a brief asks for an invented fact: ${job.slice(0, 50)}…`);
  }
});

test('AND NONE ASKS FOR A JOB THAT HAPPENED', () => {
  /* A DIFFERENT KIND OF INVENTION, AND THE RULES DO NOT COVER IT. They
   * forbid invented FIGURES — a price, a year, a number of customers. A
   * narrated visit is an invented EVENT: no number in it, nothing for the
   * no-invented-figures rule to catch, and it reads as a reference a
   * customer could check and cannot.
   *
   * Beacon's second brief was drafted as "where in a building it was, what
   * was found, and what happened next" and rewritten before it ever ran. */
  const narrated = /\b(what was found|what happened next|a customer who|told us|came to us|we were called)\b/i;

  for (const job of [...beaconPrompt.HOME_JOBS, ...ledgerPrompt.LEDGER_VOICE.homeJobs]) {
    assert.ok(!narrated.test(job), `a brief asks for a story: ${job.slice(0, 60)}…`);
  }
});

test('AND TWO OF BEACON\'S THREE EXPLICITLY REFUSE A LIST', () => {
  /* Three briefs that ask for enumeration produce three lists in a row:
   * different subjects, identical shape, a page that reads as a
   * specification rather than as a company talking. Symptoms are the one
   * place a list earns its keep — a reader scanning for their own problem
   * wants to find it.
   *
   * ASSERTED ON THE REFUSAL, NOT ON "DOES THIS ASK FOR A LIST".
   *
   * The first version of this test tried the latter with a regex and
   * flagged brief two, whose words are "rather than as a LIST" — it matched
   * the negation. A pattern cannot judge the shape of a sentence; it can
   * check that the instruction to avoid one is present. */
  const refuses = job => /\b(rather than as a list|not several named in a row)\b/i.test(job);

  const refusing = beaconPrompt.HOME_JOBS.filter(refuses);

  assert.strictEqual(refusing.length, 2,
    `${refusing.length} of three briefs tell the page not to make a list`);

  /* AND THE ONE THAT DOES NOT IS THE FIRST. */
  assert.ok(!refuses(beaconPrompt.HOME_JOBS[0]));
});

test('THE TITLE AND THE DESCRIPTION HAVE THEIR OWN ANGLE PER VOICE', () => {
  /* They used to say only a length and a required word, and nothing about
   * what the sentence should be about. Two sites built the same evening
   * came out as "<name> | Chicago, IL Plumbing" and "<name> | Chicago, IL
   * Plumbers", with two descriptions that were both the six services
   * comma-listed and then the four towns.
   *
   *     A BRIEF THAT GIVES A LENGTH AND NO SUBJECT
   *     GETS THE MOST OBVIOUS SUBJECT, EVERY TIME. */
  assert.notStrictEqual(beaconPrompt.BEACON_VOICE.title, ledgerPrompt.LEDGER_VOICE.title);
  assert.notStrictEqual(beaconPrompt.BEACON_VOICE.meta, ledgerPrompt.LEDGER_VOICE.meta);

  assert.ok(/business name/.test(ledgerPrompt.LEDGER_VOICE.title));
  assert.ok(/rather than the business name/.test(beaconPrompt.BEACON_VOICE.title));
});

test('and only Beacon caps the services in its description', () => {
  /* Edwin asked for the cap on the second site only — Ledger keeps its
   * list. 160 characters of comma-separated services is keyword stuffing
   * that gets truncated in a result anyway, but it is a deliberate choice
   * on one of the two, not a bug on both. */
  assert.ok(/AT MOST TWO/.test(beaconPrompt.BEACON_VOICE.meta));
  assert.ok(!/AT MOST/.test(ledgerPrompt.LEDGER_VOICE.meta));
});

test('THE BUSINESS NAME IS NEVER SHORTENED, REWORDED OR DROPPED', () => {
  /* Edwin, 30 October: "it should always appear in the title and meta
   * description." It overruled an older rule that let the name give way to
   * the place at 60 characters.
   *
   * "The Austin Plumber" IS THE CASE THAT NEEDS BOTH HALVES OF THE RULE.
   * Beacon's title is told not to begin with the word The; told only that,
   * a model satisfies it by writing "Austin Plumber" — which is a different
   * company's name, on that company's own page, where its owner will see
   * it and nobody will think to explain it. */
  for (const prompt of [ledgerPrompt, beaconPrompt]) {
    for (const build of ['homePagePrompt', 'servicePagePrompt']) {
      const { system } = prompt[build]({
        business: { name: 'The Austin Plumber', city: 'Austin', state: 'TX', trade: 'plumbing' },
        service: { name: 'Drain Cleaning', slug: 'drain-cleaning' },
      });

      assert.ok(/AND THE BUSINESS NAME/.test(system),
        `${build} does not require the name`);

      /* CASE-INSENSITIVE: one of the two prompts starts the sentence with
       * it and the other has it mid-sentence. The first version of this
       * test read only the lower-case form and reported the service page
       * broken over its own capital letter. */
      assert.ok(/never shortened, never reworded, never dropped/i.test(system),
        `${build} still allows the name to be cut`);

      assert.ok(!/leave it out altogether/.test(system),
        `${build} still tells the model it may drop the name`);
    }
  }
});

test('and Beacon still keeps the name when it may not lead with it', () => {
  /* The two instructions are not in tension: the name goes after the work,
   * which is where a title with a pipe in it puts a brand anyway. */
  const t = beaconPrompt.BEACON_VOICE.title;

  assert.ok(/do not begin with the word The/.test(t));
  assert.ok(/business name still appears/.test(t));
});

test('AND NO BRIEF CARRIES A DOUBLE QUOTE INTO THE JSON TEMPLATE', () => {
  /* placeRule() once wrapped a town in double quotes inside a JSON string
   * value and broke the template for every site with a city in its
   * address. Every brief in a voice lands in the same place. */
  const briefs = [
    ledgerPrompt.LEDGER_VOICE, beaconPrompt.BEACON_VOICE,
  ].flatMap(v => [v.title, v.meta, v.aboutHeading, ...v.homeJobs]);

  for (const brief of briefs) {
    assert.ok(!brief.includes('"'), `a brief carries a quote: ${brief.slice(0, 40)}…`);
  }
});

test('the home prompt still produces a readable JSON template', () => {
  /* placeRule() once wrapped a town in double quotes inside a JSON string
   * value and broke the template for every site with a city. A brief is
   * free text that lands in the same place. */
  const sys = beaconPrompt.homePagePrompt({
    business: { name: 'X', city: 'Chicago', state: 'IL', trade: 'plumbing' },
  }).system;

  const body = sys.slice(sys.indexOf('{'), sys.lastIndexOf('}') + 1);

  assert.doesNotThrow(() => JSON.parse(body), 'the JSON template no longer parses');
});

/* ======================================================================= */

section('WHAT A DESIGN MEANS ON THE FORM');

test('DESIGN 2 IS THE WHOLE PACKAGE, NOT JUST THE PHOTOGRAPHS', () => {
  /* It began as a photographs-only picker, and Edwin asked the right
   * question of it: "if I choose Design 2, will it use a different html
   * structure and different services?" It did not. */
  assert.deepStrictEqual(buildOptionsFor('2'), {
    design: '2', structure: 'beacon', imageSet: 'set-2',
  });

  assert.deepStrictEqual(buildOptionsFor('1'), {
    design: '1', structure: 'ledger', imageSet: 'set-1',
  });
});

test('and nothing chosen is Ledger with an automatic photo set', () => {
  /* Empty imageSet means heroSet() picks from the business name, which is
   * right for the six trades that have one set of pictures. */
  assert.deepStrictEqual(buildOptionsFor(''), {
    design: '', structure: 'ledger', imageSet: '',
  });

  assert.deepStrictEqual(buildOptionsFor(undefined), buildOptionsFor(''));
});

test('AN UNKNOWN DESIGN IS THE DEFAULT, NOT A FAILED BUILD', () => {
  /* A stale form, an old job payload or a typed URL must not fail a build
   * that is otherwise fine. */
  assert.strictEqual(designFor('7'), null);
  assert.deepStrictEqual(buildOptionsFor('7'), buildOptionsFor(''));
});

test('every design names a structure that exists', () => {
  for (const design of DESIGNS) {
    assert.ok(STRUCTURES[design.structure], `${design.label} names ${design.structure}, which does not exist`);
    assert.ok(/^set-\d+$/.test(design.imageSet), `${design.label} has an odd photo set`);
  }
});

test('AND NO TWO DESIGNS ARE THE SAME SITE', () => {
  /* The entire point. If two designs ever resolved to the same structure
   * AND the same photographs, the dropdown would be a lie. */
  const seen = new Set(DESIGNS.map(d => `${d.structure}|${d.imageSet}`));

  assert.strictEqual(seen.size, DESIGNS.length);
});

/* ---------------------------------------------------------------------- */

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('');
process.exit(failed ? 1 : 0);
