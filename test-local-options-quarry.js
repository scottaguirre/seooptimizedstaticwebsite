// test-local-options-quarry.js
//
// The fourth structure, and the first one nothing can select.
//
// WHAT THIS SUITE IS GUARDING. Ledger, Beacon, Anvil and Quarry are all
// served as assets/site.css to different sites built by the same code. The
// failure it exists for is not a crash — it is a page that renders perfectly
// with a stylesheet written for one of the other three, where every selector
// misses, nothing throws, and the site goes out as unstyled text.
//
//     A STYLESHEET AND ITS MARKUP ARE ONE CHOICE, NOT TWO.
//
// AND WHAT IS NEW WITH THE FOURTH. Three structures could collide six ways
// and four can collide twelve, so the isolation tests are a loop over every
// ordered pair rather than a hand-written list — Anvil's suite made that
// change for the same reason, and the loop is why this file did not have to
// add three more assertions by hand.
//
// THE TWO FAILURES ONLY THIS STRUCTURE CAN HAVE
//
//   the order    Quarry is the only one of the four whose H1 comes BEFORE
//                the photograph. A refactor that moved the picture back up
//                would still render, still pass every shared test, and
//                quietly make this Anvil in a light palette — which is the
//                one thing Edwin asked for it not to be.
//   the offer    It is registered in structures.js and offered by no
//                wizard. Nothing fails if that leaks: a Cloudflare layout
//                picked on the GitHub form builds a site, with photographs
//                that do not exist, and the only sign is that it looks
//                unfamiliar. That hole was real until 17 November.
//
// MOBILE FIRST, AND TESTED AS SUCH. This is the first of the four written
// with min-width queries, which means the BASE rules are the phone and the
// desktop is the exception. A test that only read the media blocks would be
// reading the exception.
//
//   node test-local-options-quarry.js

'use strict';

const assert = require('assert');

const { renderSite } = require('./utils/localOptions/render/renderSite');
const { structureFor, structureKeys } = require('./utils/localOptions/render/structures');
const { STRUCTURES } = require('./utils/localOptions/render/theme');
const {
  DESIGNS, designFor, designsFor, buildOptionsFor, CF_MODE,
} = require('./utils/localOptions/designs');

const ledgerPrompt = require('./utils/localOptions/prompt');
const beaconPrompt = require('./utils/localOptions/prompt-beacon');
const anvilPrompt = require('./utils/localOptions/prompt-anvil');
const quarryPrompt = require('./utils/localOptions/prompt-quarry');

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
  url: 'https://the-chicago-plumber.9-x.org',
  business: {
    name: 'The Chicago Plumber', trade: 'plumbing', phone: '(312) 555-0164',
    street: '12 W Elm St', city: 'Chicago', state: 'IL', zip: '60610',
    social: { facebook: 'https://facebook.com/x' },
  },
  areas: ['Chicago', 'Oak Park'],
  /* SEVEN DAYS, BECAUSE THE SPLIT IS THE POINT. Quarry is the only structure
   * that divides the week, and a fixture with two days in it would never
   * reach the branch. */
  hours: [
    { day: 'Monday', open: '7:00 AM – 6:00 PM' },
    { day: 'Tuesday', open: '7:00 AM – 6:00 PM' },
    { day: 'Wednesday', open: '7:00 AM – 6:00 PM' },
    { day: 'Thursday', open: '7:00 AM – 6:00 PM' },
    { day: 'Friday', open: '7:00 AM – 5:00 PM' },
    { day: 'Saturday', open: '9:00 AM – 2:00 PM' },
    { day: 'Sunday', open: null },
  ],
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
    /* THE FIRST PARAGRAPH NAMES THE BUSINESS, DELIBERATELY. linkHome() marks
     * up the first mention and writes nothing of its own, so a fixture whose
     * prose never names the business would make that test pass against a
     * page with no link in it — a test about absence, dressed as a test
     * about presence. */
    sections: [
      { heading: '', paragraphs: ['Opening one at The Chicago Plumber.', 'Opening two.'] },
      { heading: 'A heading', paragraphs: ['A paragraph.'] },
    ],
  })),
  home: {
    h1: 'ignored', sub: 'Same-week appointments.',
    title: 'The Chicago Plumber', meta: 'A description.',
    aboutHeading: 'Pipework across Chicago', about: ['First.', 'Second.'],
  },
  now: new Date('2026-11-17T00:00:00Z'),
  ...over,
});

const quarry = renderSite(SITE({ structure: 'quarry' }));
const anvil = renderSite(SITE({ structure: 'anvil' }));
const beacon = renderSite(SITE({ structure: 'beacon' }));
const ledger = renderSite(SITE({ structure: 'ledger' }));

const BUILT = { ledger, beacon, anvil, quarry };

const allOf = files => Object.entries(files)
  .filter(([path]) => path.endsWith('.html') || path.endsWith('.css'))
  .map(([, body]) => String(body)).join('\n');

const CSS = String(quarry['assets/site.css']);
const HOME = String(quarry['index.html']);
const SERVICE = String(quarry['drain-cleaning/index.html']);
const CONTACT = String(quarry['contact/index.html']);

const htmlPaths = files => Object.keys(files).filter(p => p.endsWith('.html'));

/**
 * The text between two markers, by index.
 *
 * NOT `split(marker)[1]`, WHICH IS WHAT THIS FILE DID FIRST AND WHY THREE
 * TESTS FAILED AGAINST CORRECT MARKUP. `split('quarry-form')` also splits on
 * `quarry-form__pair` and `quarry-form__note`, so [1] ended at the next
 * modifier rather than at the end of the form; `split('</div>')[0]` on the
 * hours ended at the first day cell rather than at the end of the column.
 *
 *     A CLASS NAME IS A PREFIX OF ITS OWN MODIFIERS.
 *     SPLITTING ON ONE CUTS AT THE FIRST OF THEM.
 */
function between(html, from, to) {
  const start = html.indexOf(from);

  if (start < 0) return '';

  const end = html.indexOf(to, start + from.length);

  return end < 0 ? html.slice(start) : html.slice(start, end);
}

/** Every structure's class prefix and custom-property prefix, from the source. */
const MARKS = {
  ledger: { cls: /ledger-/, prop: /--lg-/ },
  beacon: { cls: /beacon-/, prop: /--bn-/ },
  anvil: { cls: /anvil-/, prop: /--av-/ },
  quarry: { cls: /quarry-/, prop: /--qy-/ },
};

/* ======================================================================= */

section('FOUR STRUCTURES, TWELVE WAYS TO COLLIDE');

test('NO STRUCTURE\'S NAMES REACH ANY OTHER STRUCTURE\'S SITE', () => {
  /* THE FAILURE THIS WHOLE FILE EXISTS FOR, now that there are four.
   *
   * Written as a loop over ordered pairs rather than by hand: with two
   * structures there were two directions and somebody could hold both in
   * their head. Three made six, four make twelve, and a hand-written list
   * is a list that is short by three the next time this grows.
   *
   * `quarry-` IS CHECKED AGAINST `ledger-` LIKE EVERY OTHER PAIR, which is
   * worth saying because one Quarry part was called `ledgerline` for an
   * hour. `/ledger-/` happens not to match `quarry-ledgerline` — no hyphen
   * after the word — so this loop would have passed. It was renamed to
   * `kerb` anyway, for the next person to tighten the regex and for the one
   * before them reading a Quarry file. */
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

test('THE IDS DIFFER ACROSS ALL FOUR', () => {
  /* Edwin, 30 October: "different classes and prefix and css IDs".
   *
   * THIS CAUGHT A REAL COLLISION. Quarry's MAIN_ID was 'content' — Beacon's
   * — for the first hour it existed, and nothing would have failed: the skip
   * link and the <main> it points at are both inside one page, so the
   * duplicate lives in two sites that never meet.
   *
   *     TWO LAYOUTS SHARING AN ID STILL WORK. THEY JUST CANNOT BE TOLD
   *     APART BY A FRAGMENT IN A URL, BY A SCRAPER, OR BY A TEST. */
  assert.ok(ledger['index.html'].includes('<main id="main">'));
  assert.ok(beacon['index.html'].includes('<main id="content">'));
  assert.ok(anvil['index.html'].includes('<main id="page">'));
  assert.ok(HOME.includes('<main id="read">'));

  assert.ok(ledger['index.html'].includes('id="services"'));
  assert.ok(beacon['index.html'].includes('id="trades"'));
  assert.ok(anvil['index.html'].includes('id="work"'));
  assert.ok(HOME.includes('id="index"'));

  for (const theirs of ['main', 'content', 'page', 'services', 'trades', 'work']) {
    assert.ok(!HOME.includes(`id="${theirs}"`), `Quarry reuses the id "${theirs}"`);
  }
});

test('and the skip link points at the id this structure actually used', () => {
  /* A skip link whose target does not exist is a keyboard user pressing Tab,
   * Enter, and landing nowhere — and it is exactly what a renamed MAIN_ID
   * leaves behind if the two are not read from one constant. */
  const target = (HOME.match(/quarry-skip" href="#([^"]+)"/) || [])[1];

  assert.strictEqual(target, 'read');

  for (const path of htmlPaths(quarry)) {
    assert.ok(quarry[path].includes(`<main id="${target}">`),
      `${path} has a skip link pointing at nothing`);
  }
});

test('and so do the contact form field ids', () => {
  /* Ledger uses n/p/e/m, Beacon bn/bp/be/bm, Anvil an/ap/ae/am, Quarry
   * qn/qp/qe/qm. Four layouts whose markup cannot be told apart by anything
   * that looks at ids are one layout as far as a scraper, a test or a
   * stylesheet is concerned. */
  assert.ok(CONTACT.includes('id="qn"') && CONTACT.includes('id="qm"'));

  assert.ok(!/id="(?:an|ap|ae|am)"/.test(CONTACT), 'Quarry reuses an Anvil field id');
  assert.ok(!/id="(?:bn|bp|be|bm)"/.test(CONTACT), 'Quarry reuses a Beacon field id');
  assert.ok(!/id="[npem]"/.test(CONTACT), 'Quarry reuses a Ledger field id');
});

test('A STYLESHEET NEVER ARRIVES WITHOUT ITS OWN MARKUP', () => {
  /* The seam structures.js exists for. */
  for (const key of Object.keys(STRUCTURES)) {
    const s = structureFor(key);

    assert.strictEqual(s.key, key, `${key} resolved to ${s.key}`);
    assert.ok(s.pages && s.pages.homePage, `${key} has no page builders`);
    assert.ok(s.prompt && s.prompt.servicePagePrompt, `${key} has no prompts`);
  }

  assert.deepStrictEqual(structureKeys(),
    ['ledger', 'beacon', 'anvil', 'quarry', 'harbor', 'atlas', 'orchard']);
});

test('AND A TYPO IN THE STRUCTURE NAME FALLS BACK TO ALL FOUR HALVES OF ONE', () => {
  /* structureFor() resolves the theme by the incoming string and the PARTS by
   * the RESOLVED key, which is what stops "quary" producing Ledger's
   * stylesheet with Quarry's markup.
   *
   * IT FALLS BACK RATHER THAN THROWING, deliberately — refusing to build a
   * paid-for site over a typo in a layout name is the worse failure. That is
   * also exactly why the mode tag on Design 4 matters: a wrong design would
   * not fail, it would quietly build something else. */
  assert.strictEqual(structureFor('quarry').prompt, quarryPrompt);
  assert.strictEqual(structureFor('quary').prompt, ledgerPrompt);
  assert.strictEqual(structureFor('quary').key, 'ledger');
  assert.strictEqual(structureFor('QUARRY').key, 'quarry');
  assert.strictEqual(structureFor('  quarry  ').key, 'quarry');
});

test('and every class the markup emits has a rule, both ways round', () => {
  /* THE REAL SHAPE OF THE "UNSTYLED TEXT" FAILURE, caught inside one
   * structure rather than between two. A class in the markup with no rule is
   * an unstyled block; a rule naming a class the markup never emits is a
   * rule that was renamed in one file and not the other. Both are silent.
   *
   * CLASSES ONLY FROM class="..." ATTRIBUTES. Reading every `quarry-` in the
   * source would also match the ones inside the comments explaining them —
   * the mutant that survived three times in test-build-progress.js. */
  const chrome = require('fs').readFileSync(
    './utils/localOptions/render/quarry/chrome.js', 'utf8');
  const pages = require('fs').readFileSync(
    './utils/localOptions/render/quarry/pages.js', 'utf8');

  const emitted = new Set();

  for (const m of `${chrome}\n${pages}`.matchAll(/class="([^"]+)"/g)) {
    for (const token of m[1].split(/\s+/)) {
      if (token.startsWith('quarry-')) emitted.add(token);
    }
  }

  const styled = new Set((CSS.match(/\.quarry-[A-Za-z0-9_-]+/g) || []).map(s => s.slice(1)));

  assert.ok(emitted.size > 40, `only ${emitted.size} classes found — the scan is broken`);

  const noRule = [...emitted].filter(c => !styled.has(c));
  const noMarkup = [...styled].filter(c => !emitted.has(c));

  assert.deepStrictEqual(noRule, [], `classes with no rule: ${noRule.join(', ')}`);
  assert.deepStrictEqual(noMarkup, [], `rules with no markup: ${noMarkup.join(', ')}`);
});

/* ======================================================================= */

section('THE INVERSION THE WHOLE STRUCTURE IS BUILT ON');

test('THE HEADLINE COMES BEFORE THE PHOTOGRAPH, WHICH NO OTHER STRUCTURE DOES', () => {
  /* Edwin, 16 November: the five new layouts are to be "different from all
   * layouts including github layouts". Ledger, Beacon and Anvil all put a
   * picture at or above the H1; this puts type there and the photograph
   * under it.
   *
   * ASSERTED BY POSITION, not by the presence of either. A refactor that
   * moved the picture back above the headline would still render, still pass
   * every shared test, and quietly make this Anvil in a light palette. */
  const h1 = HOME.indexOf('<h1');
  const shot = HOME.indexOf('quarry-seam__shot');

  assert.ok(h1 > -1, 'there is no H1');
  assert.ok(shot > -1, 'there is no photograph');
  assert.ok(h1 < shot, 'the photograph comes before the headline');

  /* AND THE H1 IS NOT INSIDE THE PICTURE EITHER, which is the other way to
   * end up with Anvil: a figure wrapping both would satisfy the order test
   * above by accident. */
  assert.ok(!/quarry-seam[\s\S]*?<h1/.test(HOME), 'the headline is inside the seam');
});

test('and the picture is a band the page passes through, not a hero', () => {
  /* A tall seam is Anvil's stage with the words moved off it. The height is
   * capped in the stylesheet rather than left to the image. */
  const rule = (CSS.match(/\.quarry-seam__shot\{[^}]*\}/) || [''])[0];

  assert.ok(/object-fit:cover/.test(rule), 'the photograph is not cropped to the band');
  assert.ok(/height:clamp\(/.test(rule), 'the band has no height of its own');
  assert.ok(!/min-height:clamp\(2[0-9]rem/.test(CSS), 'the seam is as tall as a hero');
});

test('AND THE SEAM CARRIES NO CAPTION, BECAUSE THE PAGE ALREADY SAID IT', () => {
  /* IT HAD ONE FOR AN HOUR AND A SCREENSHOT KILLED IT. The caption was the
   * owner's own sub-line, so on the home page the same sentence appeared
   * under the H1 and again two inches below it; on a service page the
   * service's blurb did the same.
   *
   *     A CAPTION THAT RESTATES THE LINE ABOVE IT IS NOT A CAPTION.
   *
   * The alt text was the other candidate and is worse: it is already on the
   * img, where it belongs. */
  for (const path of htmlPaths(quarry)) {
    assert.ok(!/<figcaption/.test(quarry[path]), `${path} captions its photograph`);
  }

  /* AND THE SENTENCE APPEARS ONCE ON THE PAGE, which is the thing that was
   * actually wrong — a figcaption could come back under another name. */
  assert.strictEqual(
    (HOME.match(/Same-week appointments\./g) || []).length, 1,
    'the sub-line is printed twice on the home page');
});

test('AND THE CROP SITS ABOVE CENTRE, OR EVERY SUBJECT LOSES THEIR HEAD', () => {
  /* FOUND BY POINTING tools/preview-structure.js AT A REAL SET, not by any
   * assertion. The band shows about half the frame; trade photography puts
   * the person in the top third and their hands in the bottom third, so a
   * centred crop takes the strip between the two. All four of plumbing's
   * set-4 came out cut off at the jaw, on every page of the site.
   *
   *     A DEFAULT IS NOT A DECISION. object-position's default is 50% 50%,
   *     and nothing about a layout is wrong until somebody looks at it
   *     with a photograph in it.
   *
   * Edwin chose the faces over the wrench on 17 November. Asserted as ABOVE
   * centre rather than as the exact figure, so the number can be tuned
   * without the test having an opinion about taste — what it refuses is a
   * return to the default. */
  const rule = (CSS.match(/\.quarry-seam__shot\{[^}]*\}/) || [''])[0];

  assert.ok(rule, 'the photograph has no rule at all');

  const pos = (rule.match(/object-position:\s*50%\s*([\d.]+)%/) || [])[1];

  assert.ok(undefined !== pos, 'the crop is back to the default, which is centred');
  assert.ok(Number(pos) < 50, `the crop is at ${pos}%, which is centre or below`);
});

test('A PAGE WITH NO PHOTOGRAPH RENDERS NO SEAM AT ALL, AND KEEPS ITS HEADING', () => {
  /* THE OPPOSITE OF ANVIL'S RULE, AND RIGHT FOR THE OPPOSITE REASON. Anvil's
   * stage IS its H1, so it renders bare rather than returning nothing. There
   * is no heading inside Quarry's seam to strand, so a page outside the hero
   * rotation goes masthead straight to the kerb and nothing looks
   * unfinished. */
  const legal = String(quarry['privacy-policy/index.html']);

  assert.ok(/<h1>/.test(legal), 'a legal page has no H1');
  assert.ok(!legal.includes('quarry-seam'), 'a legal page drew an empty seam');

  const noAlt = renderSite(SITE({ structure: 'quarry', alt: {} }));

  assert.ok(/<h1/.test(noAlt['index.html']), 'the home page lost its H1');
});

test('AND THE SERVICES ARE AN INDEX, WHICH IS A DIFFERENT QUESTION FROM THE OTHER THREE', () => {
  /* Ledger numbers two columns, Beacon lays out three-up tiles, Anvil
   * stacks full-width rungs. All three are answers to "how should six
   * services be listed". A sticky column of names beside the blurbs is not
   * another answer to that; it is the one piece of layout here that no other
   * structure has anything like. */
  assert.ok(HOME.includes('quarry-index__col'), 'there is no index column');
  assert.ok(HOME.includes('quarry-index__told'), 'there are no blurbs beside it');

  const rule = (CSS.match(/\.quarry-index__col\{[^}]*position:sticky[^}]*\}/) || [''])[0];

  assert.ok(rule, 'the index column is not sticky anywhere');
});

/* ======================================================================= */

section('MOBILE FIRST, WHICH MEANS THE PHONE IS THE BASE AND NOT THE EXCEPTION');

test('EVERY MEDIA QUERY IS min-width, AND THERE ARE NO max-width RULES', () => {
  /* Edwin's standing rule, and the first of the four stylesheets to follow
   * it. The other three are one wide layout with max-width queries
   * subtracting from it, which means each DESCRIBES the phone as an
   * exception — and the phone is where these sites are read.
   *
   * THIS IS WHY THE REST OF THIS SECTION READS THE BASE RULES. A test that
   * went looking inside the media blocks would be reading the exception. */
  const queries = CSS.match(/@media[^{]+/g) || [];

  assert.ok(queries.length >= 2, `only ${queries.length} media queries`);

  for (const q of queries) {
    assert.ok(/min-width/.test(q), `a max-width query survives: ${q.trim()}`);
    assert.ok(!/max-width/.test(q), `a max-width query survives: ${q.trim()}`);
  }

  /* AND THE OTHER THREE ARE STILL THE OTHER WAY ROUND, so this is a real
   * difference rather than a line that happens to be true of everything. */
  assert.ok(/@media \(max-width/.test(String(anvil['assets/site.css'])),
    'Anvil was rewritten and this test no longer proves anything');
});

test('the index is ONE COLUMN until there is room, not a sticky list in 360px', () => {
  /* A sticky column of names beside a scrolling column of blurbs is two
   * things fighting for the same 360px. The base rule hides the names and
   * the blurbs carry their own numbers; the second column arrives with the
   * room for it. */
  const base = CSS.split('@media')[0];

  assert.ok(/\.quarry-index__col\{display:none\}/.test(base),
    'the index column is shown on a phone');
  assert.ok(/\.quarry-told__tally\{/.test(base),
    'the blurbs carry no number of their own on a phone');

  const wide = CSS.slice(CSS.indexOf('@media (min-width:960px)'));

  assert.ok(/\.quarry-index__col\{display:block/.test(wide),
    'the index column never appears');
  assert.ok(/\.quarry-told__tally\{display:none\}/.test(wide),
    'the numbers are shown twice on one screen');
});

test('AND THE DISCLOSURE IS IN THE FLOW ON A PHONE, NOT A PANEL OFF THE SCREEN', () => {
  /* An absolutely-positioned 250px panel hanging off a 360px column is a
   * panel with its right half past the edge. Below the wide breakpoint it
   * simply pushes the row down, which is what a <details> is for. */
  const base = CSS.split('@media')[0];
  const rule = (base.match(/\.quarry-menu__list\{[^}]*\}/) || [''])[0];

  assert.ok(rule, 'the menu list has no base rule at all');
  assert.ok(!/position:absolute/.test(rule), 'the menu is a floating panel on a phone');

  const wide = CSS.slice(CSS.indexOf('@media (min-width:960px)'));

  assert.ok(/\.quarry-menu__list\{[^}]*position:absolute/.test(wide),
    'the menu never becomes a dropped panel');
});

test('THE HOURS SPLIT ON THE BOX\'S WIDTH, NOT THE WINDOW\'S', () => {
  /* THE SCREENSHOT THAT FOUND THIS. The box is full-shell-wide on the home
   * page and sits in a ~22rem aside beside the prose on a service page. A
   * viewport rule cannot tell those apart, so at 1440px the service page
   * split a 22rem box into two columns and every row read
   *
   *     Wednesday            7:00 AM
   *                           - 6:00
   *                               PM
   *
   *     THE BOX IS NOT THE PAGE. The question the rule has to ask is how
   *     wide THIS box is, which is the one thing a media query cannot
   *     answer. */
  assert.ok(/\.quarry-hours\{[^}]*container-type:inline-size/.test(CSS),
    'the hours box is not a container, so nothing can measure it');

  assert.ok(/@container \(min-width:[^)]+\)\{\s*\.quarry-hours__split\{[^}]*grid-template-columns:1fr 1fr/.test(CSS),
    'the split is not keyed to the box');

  /* AND NO MEDIA QUERY SPLITS IT, which is what was there before. */
  for (const block of CSS.split('@media').slice(1)) {
    assert.ok(!/\.quarry-hours__split\{[^}]*grid-template-columns/.test(block),
      'a viewport rule still splits the hours');
  }

  /* THE MARKUP STILL OFFERS TWO COLUMNS WHEREVER IT IS. The renderer decides
   * what goes in each; only the stylesheet decides whether they sit side by
   * side, and a browser without container queries gets the single column,
   * which is the phone layout and is correct. */
  assert.strictEqual(
    (between(SERVICE, 'quarry-hours__split', 'quarry-hours__note')
      .match(/quarry-hours__col/g) || []).length, 2);
});

test('and the form fields are 16px, or the phone zooms and does not zoom back', () => {
  /* Safari on iOS scales the whole page up when a focused field's text is
   * under 16px, and it does not scale back out. */
  assert.ok(/\.quarry-form input,\.quarry-form textarea\{[^}]*font-size:16px/.test(CSS),
    'the contact fields are under 16px');
});

test('AND THE MENU WORKS WITH NO JAVASCRIPT, BECAUSE THESE SITES SHIP NONE', () => {
  assert.ok(HOME.includes('<details class="quarry-menu">'));

  for (const path of htmlPaths(quarry)) {
    assert.ok(!/<script(?![^>]*application\/ld\+json)/.test(quarry[path]),
      `${path} ships a script`);
  }
});

test('and the disclosure is shut on every page, so it never covers the H1', () => {
  for (const path of htmlPaths(quarry)) {
    assert.ok(!/<details class="quarry-menu" open/.test(quarry[path]),
      `${path} opens the menu over the page`);
  }
});

/* ======================================================================= */

section('WHAT A LIGHT PAGE DOES NOT NEED');

test('THERE IS NO PLATE BEHIND THE LOGO, AND THAT IS A DECISION', () => {
  /* Anvil wraps every logo in a white plate because an owner's logo is dark
   * ink on transparency as often as not, and on a near-black rail that is an
   * invisible header. On a light bar it is the normal case.
   *
   * THE HEIGHT STILL MATCHES THE OTHER THREE at the wide breakpoint, so the
   * same upload looks the same size whichever layout it lands in. */
  assert.ok(!HOME.includes('quarry-brand__plate'), 'a light page grew a plate');
  assert.ok(HOME.includes('quarry-brand__mark'), 'there is no logo at all');

  assert.ok(/\.quarry-brand__mark\{height:70px/.test(
    CSS.slice(CSS.indexOf('@media (min-width:640px)'))),
    'the logo is not the same height as the other three on a wide screen');
});

test('and a business with no logo gets a glyph, in this structure\'s own colours', () => {
  const bare = renderSite(SITE({ structure: 'quarry', logo: '' }));

  assert.ok(bare['index.html'].includes('quarry-brand__glyph'));
  assert.ok(!bare['index.html'].includes('quarry-brand__mark'));
});

test('AND NO color-scheme LINE, WHICH ONLY THE DARK ONE NEEDS', () => {
  /* Anvil declares itself dark or it gets a bright scrollbar and a white
   * flash on overscroll. Three structures out of four would be declaring
   * something the browser already assumes. */
  for (const path of htmlPaths(quarry)) {
    assert.ok(!quarry[path].includes('color-scheme'),
      `${path} declares a colour scheme it does not need`);
  }

  assert.ok(anvil['index.html'].includes('name="color-scheme" content="dark"'),
    'Anvil stopped declaring itself dark and this test no longer contrasts');
});

test('and the page states its own ground, so a dark-mode browser invents none', () => {
  assert.ok(/body\{[^}]*background:var\(--qy-ground\)/.test(CSS),
    'the body has no background of its own');
  assert.ok(/--qy-ground:#[0-9a-f]{6}/i.test(CSS), 'the ground is not a declared colour');
});

test('NOTHING IS ROUNDED, AND THERE IS NO RADIUS TO SET', () => {
  /* Beacon is built on its radius and Anvil carries 6px everywhere. Square
   * corners are a third answer, and a --qy-round appearing later is how it
   * would stop being one. */
  assert.ok(!/--qy-round/.test(CSS), 'Quarry grew a radius variable');
  assert.ok(!/border-radius/.test(CSS), 'something is rounded');
});

/* ======================================================================= */

section('THE SAME SITE, DIFFERENTLY DRESSED');

test('THE SAME ELEVEN PAGES, plus the stylesheet, sitemap, robots and 404', () => {
  assert.deepStrictEqual(Object.keys(quarry).sort(), Object.keys(anvil).sort());
  assert.deepStrictEqual(Object.keys(quarry).sort(), Object.keys(beacon).sort());
  assert.deepStrictEqual(Object.keys(quarry).sort(), Object.keys(ledger).sort());
});

test('and every service page carries the same sections', () => {
  for (const slug of SLUGS) {
    const page = String(quarry[`${slug}/index.html`] || '');

    assert.ok(page, `${slug} was not built`);
    assert.ok(page.includes('quarry-masthead'), `${slug} has no masthead`);
    assert.ok(page.includes('quarry-prose'), `${slug} has no prose`);
    assert.ok(page.includes('quarry-hours'), `${slug} has no hours`);
    assert.ok(page.includes('quarry-onward'), `${slug} does not pass the reader on`);
  }
});

test('THE HOURS SIT BESIDE THE PROSE, WHICH IS THE FOURTH ANSWER', () => {
  /* Ledger puts a table beneath, Beacon an aside, Anvil a full-width band.
   * Quarry puts them in the second column of the same grid and lets them
   * fall underneath when there is no room — so on a phone they are below the
   * words, and on a desktop they are not. */
  assert.ok(SERVICE.includes('quarry-beside'), 'the service page has no two-column row');

  const row = between(SERVICE, 'class="quarry-beside"', '</section>');

  assert.ok(row, 'the service page has no beside row');
  assert.ok(row.indexOf('quarry-prose') < row.indexOf('quarry-aside'),
    'the hours come before the prose in the source, so they are first on a phone');

  const base = CSS.split('@media')[0];

  assert.ok(/\.quarry-beside\{display:grid;gap:/.test(base),
    'the row is not one column by default');
  assert.ok(!/\.quarry-beside\{[^}]*grid-template-columns/.test(base),
    'the row has two columns on a phone');
});

test('THE HOURS SPLIT THE WEEK WHERE PEOPLE SPLIT IT', () => {
  /* Monday to Friday in one column, the weekend in the other, so the
   * question most visitors are asking is answered without reading seven
   * rows. */
  const block = between(SERVICE, 'quarry-hours__split', 'quarry-hours__note');
  const cols = (block.match(/quarry-hours__col/g) || []).length;

  assert.strictEqual(cols, 2, `the week is in ${cols} columns`);
  assert.ok(block.indexOf('Saturday') > block.indexOf('Friday'));
});

test('and the split is by POSITION, not by the English word for a day', () => {
  /* The days arrive already ordered and already localised by whoever built
   * the list. Matching on "Saturday" would be a second place that decides
   * what a week is, and the first one is not in this file. */
  const chrome = require('fs').readFileSync(
    './utils/localOptions/render/quarry/chrome.js', 'utf8');
  const code = chrome.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  assert.ok(!/Saturday|Sunday|weekend/i.test(code),
    'the hours split on the name of a day');
  assert.ok(/slice\(0, 5\)|slice\(0,5\)/.test(code), 'the split is not at five');
});

test('AND A SHORT WEEK IS NOT SPLIT AT ALL', () => {
  /* A site whose owner entered three days gets three rows, not two columns
   * of uneven nonsense. */
  const three = renderSite(SITE({
    structure: 'quarry',
    hours: [{ day: 'Mon', open: '9-5' }, { day: 'Tue', open: '9-5' }, { day: 'Wed', open: '9-5' }],
  }));

  const block = between(
    String(three['drain-cleaning/index.html']),
    'quarry-hours__split', 'quarry-hours__note');

  assert.strictEqual((block.match(/quarry-hours__col/g) || []).length, 1,
    'three days were spread over two columns');
});

test('and a day with no hours reads Closed rather than nothing', () => {
  /* An empty cell is read as "we forgot", and the owner typed the hours
   * precisely so nobody has to guess about Sunday. */
  assert.ok(SERVICE.includes('Closed'), 'a closed day is blank');
  assert.ok(SERVICE.includes('quarry-hours--shut'), 'a closed day is not marked');
});

test('AND NO HOURS AT ALL RENDERS NOTHING, NOT AN EMPTY BOX', () => {
  const none = renderSite(SITE({ structure: 'quarry', hours: [] }));

  assert.ok(!none['drain-cleaning/index.html'].includes('quarry-hours'),
    'an empty hours box was drawn');
  assert.ok(none['drain-cleaning/index.html'].includes('quarry-prose'),
    'removing the hours broke the page');
});

test('THE RING STILL CAPS THE BODY AT TWO LINKED SERVICES', () => {
  /* HOME_BODY_LINKS is a rule about the SITE, not about the layout. A fourth
   * structure that re-decided it would be a fourth product. */
  const list = between(HOME, 'quarry-index__list', '</ol>');

  const linked = (list.match(/<li class="quarry-index__row"><a /g) || []).length;
  const flat = (list.match(/quarry-index__row--flat/g) || []).length;

  assert.strictEqual(linked, 2, `the index links ${linked} services`);
  assert.strictEqual(flat, 4, `the index shows ${flat} unlinked services`);
});

test('and an unlinked row is visibly muted, not quietly inert', () => {
  /* A row that looks clickable and is not is worse than one that plainly is
   * not. */
  assert.ok(/\.quarry-index__row--flat>span\{opacity:\./.test(CSS),
    'the unlinked rows look exactly like the linked ones');
});

test('the nav carries ALL SIX, because navigation is not the ring', () => {
  const nav = between(HOME, 'quarry-menu__list', '</ul>');

  for (const slug of SLUGS) {
    assert.ok(nav.includes(`${slug}/`), `${slug} is not in the menu`);
  }
});

test('and so does the footer, so nothing on the site is unreachable', () => {
  const foot = between(HOME, 'quarry-foot__spread', '</footer>');

  for (const slug of SLUGS) {
    assert.ok(foot.includes(`${slug}/`), `${slug} is not in the footer`);
  }

  for (const slug of ['privacy-policy', 'terms-of-use', 'accessibility']) {
    assert.ok(foot.includes(`${slug}/`), `${slug} is not in the footer`);
  }
});

test('the Search Console tag is on every page', () => {
  for (const path of htmlPaths(quarry)) {
    assert.ok(quarry[path].includes('dK3xP9mQ2vR7nL4tY8wZ'), `${path} has no tag`);
  }
});

test('AND THE LOGO AND THE STYLESHEET ARE RE-BASED FOR DEPTH ON EVERY PAGE', () => {
  /* `assets/logo.png` from /drain-cleaning/ asks for
   * /drain-cleaning/assets/logo.png. Ledger shipped that for a day and it
   * was found in a python http.server log — 200 for the home page, 404 for
   * the same file from all six service pages. */
  assert.ok(HOME.includes('src="assets/logo.png"'));
  assert.ok(HOME.includes('href="assets/site.css"'));

  assert.ok(SERVICE.includes('src="../assets/logo.png"'));
  assert.ok(SERVICE.includes('href="../assets/site.css"'));
  assert.ok(CONTACT.includes('src="../assets/logo.png"'));
});

test('AND THE MASTHEAD SHIPS NO EMPTY PARAGRAPH WHEN THERE IS NO SUB-LINE', () => {
  /* The contact page has none. An empty <p> there is a node that says
   * nothing — harmless to look at, one more thing for a screen reader to
   * walk past, and a heading margin arguing with a paragraph margin that has
   * nothing between them. */
  const bare = renderSite(SITE({
    structure: 'quarry',
    home: { ...SITE().home, sub: '' },
  }));

  assert.ok(!/<p class="quarry-masthead__said"><\/p>/.test(bare['index.html']),
    'an empty sub-line paragraph was rendered');
  assert.ok(!bare['index.html'].includes('quarry-masthead__said'),
    'the sub-line element is there with nothing in it');

  /* AND IT IS STILL THERE WHEN THERE IS ONE, so this is not a test that
   * passes by the element never existing. */
  assert.ok(HOME.includes('quarry-masthead__said'), 'the sub-line never renders at all');
});

test('and the hero image is re-based too, which is the file that is actually big', () => {
  assert.ok(/src="assets\/hero-\d\.webp"/.test(HOME));
  assert.ok(/src="\.\.\/assets\/hero-\d\.webp"/.test(SERVICE));
});

test('the hero is eager and high priority, because it is what the page is measured by', () => {
  assert.ok(/loading="eager"/.test(HOME), 'the largest element is lazy-loaded');
  assert.ok(/fetchpriority="high"/.test(HOME));
});

test('the schema and the canonical are untouched by the layout', () => {
  const q = JSON.parse(HOME.split('application/ld+json">')[1].split('</script>')[0]);
  const a = JSON.parse(anvil['index.html'].split('application/ld+json">')[1].split('</script>')[0]);

  assert.deepStrictEqual(q, a, 'the layout changed the structured data');

  assert.ok(SERVICE.includes(
    '<link rel="canonical" href="https://the-chicago-plumber.9-x.org/drain-cleaning/">'));
});

test('AND THE 404 IS NOINDEX, WITH ITS CANONICAL ON THE HOME PAGE', () => {
  /* A 404 that declares itself canonical is a 404 asking to be indexed, and
   * its links are absolute because the server returns it for whatever URL
   * was missing — `../` would climb from somewhere nobody chose. */
  const four = String(quarry['404.html']);

  assert.ok(four.includes('<meta name="robots" content="noindex">'));
  assert.ok(four.includes('<link rel="canonical" href="https://the-chicago-plumber.9-x.org/">'));
  assert.ok(/href="\/"/.test(four), 'the 404 links relatively');
  assert.ok(!/href="\.\.\//.test(four), 'the 404 climbs from a path nobody chose');
});

test('a build is reproducible — the same input gives the same bytes', () => {
  /* The deploy relies on an unchanged file costing nothing to re-upload. A
   * renderer that read the clock would break that once a year, at midnight,
   * for everybody at once — which is why `now` is an argument. */
  assert.deepStrictEqual(renderSite(SITE({ structure: 'quarry' })), quarry);
});

test('NO PAGE CARRIES AN HTML COMMENT AT ALL', () => {
  /* An HTML comment inside a template ships into the published page. One
   * did, on a live client domain, carrying a quoted old draft and Edwin's
   * name. Every explanation in these templates is a JS comment inside an
   * interpolation for that reason — and the stylesheet's CSS comments are
   * page content too, which is how the word "lost" in one of mine broke
   * test-static-blogs.js. */
  for (const path of htmlPaths(quarry)) {
    assert.ok(!/<!--/.test(quarry[path]), `${path} ships an HTML comment`);
  }
});

test('THE SENTENCE ABOVE THE INDEX IS WRITTEN FOR A CUSTOMER', () => {
  /* Edwin struck this exact sentence out on 30 October — "All six have a
   * page of their own" — with "this should be for a customer." It is a note
   * about what was BUILT, not a reason to read on. Anvil's first draft said
   * precisely that, having been written from Beacon's without re-reading why
   * Beacon's had changed. */
  assert.ok(!/have a page of their own/i.test(HOME), 'the lede talks to the owner');
  assert.ok(!/All six/i.test(HOME), 'the lede counts the pages at the reader');
  assert.ok(HOME.includes('what moves the price'),
    'the lede says nothing about what is on the pages');
});

test('and it counts the services from the constant, never in typed prose', () => {
  /* The lede said "three" for a day after the body-link cap became two,
   * because the number was written out rather than built from
   * SERVICE_COUNT.
   *
   *     A SENTENCE DESCRIBING A RULE IS NOT THE RULE.
   *
   * THE OUTPUT CANNOT BE ASKED THIS QUESTION, and the first version of this
   * test asked it anyway. `includes(inWords(SERVICE_COUNT))` is satisfied by
   * the word "six" typed out, which is the mutant it exists to catch — and
   * it survived. The constant cannot be moved at runtime either: pages.js
   * destructures it at require, so there is no value to stub.
   *
   *     IF THE OUTPUT IS THE SAME EITHER WAY, THE OUTPUT IS NOT THE
   *     EVIDENCE. THE SOURCE IS.
   *
   * So this reads the function's own code. The same hole is open in Ledger's,
   * Beacon's and Anvil's suites, which all assert the output. */
  const { defaultServicesLede } = require('./utils/localOptions/render/quarry/pages');
  const { SERVICE_COUNT, inWords } = require('./utils/localOptions/render/shape');

  assert.ok(defaultServicesLede().includes(inWords(SERVICE_COUNT)),
    'the lede does not name the count at all');

  /* COMMENTS STRIPPED FIRST. The note above this function names the constant
   * in prose, and three mutants in test-build-progress.js survived by
   * matching the comments that explained them. */
  const code = String(defaultServicesLede)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  assert.ok(code.includes('inWords(SERVICE_COUNT)'),
    'the lede does not build the count from the constant');

  /* AND THE COUNT'S OWN WORD IS NOT TYPED ANYWHERE ELSE IN IT.
   *
   * NOT "no number word at all", which was the version before this one and
   * failed against the correct file: the lede opens "it is probably one of
   * these", where "one" is English rather than a count. The thing that must
   * not appear is the word for SERVICE_COUNT, with the call that builds it
   * taken out first. */
  const typed = code.replace(/inWords\(SERVICE_COUNT\)/g, '');
  const word = new RegExp(`\\b${inWords(SERVICE_COUNT)}\\b`, 'i');

  assert.ok(!word.test(typed),
    `the lede types "${inWords(SERVICE_COUNT)}" out beside the constant`);
});

test('AND THE OWNER CAN REPLACE IT, OR TAKE IT AWAY', () => {
  /* ABSENT IS NOT EMPTY. `undefined` means nobody has edited the field and
   * the default stands; `''` means the owner cleared it on purpose, and a
   * renderer that treated the two the same would put the default back every
   * time somebody emptied the box. */
  const mine = renderSite(SITE({
    structure: 'quarry',
    home: { ...SITE().home, servicesLede: 'We fix these every week.' },
  }));

  assert.ok(mine['index.html'].includes('We fix these every week.'));
  assert.ok(!mine['index.html'].includes('what moves the price'));

  const none = renderSite(SITE({
    structure: 'quarry',
    home: { ...SITE().home, servicesLede: '' },
  }));

  assert.ok(!none['index.html'].includes('what moves the price'), 'a cleared lede came back');
  assert.ok(none['index.html'].includes('quarry-index__list'), 'clearing it broke the section');
});

test('THE HOME HEADING IS THE BUSINESS NAME, A HYPHEN, THE TOWN AND THE STATE', () => {
  /* Edwin, 31 October: "next time I don't want a slash, I want a hyphen."
   * Shared by all four — homeHeading() lives in common.js precisely so a
   * fourth layout cannot quietly disagree about it. */
  const h1 = between(HOME, '<h1 class="quarry-masthead__line">', '</h1>')
    .replace('<h1 class="quarry-masthead__line">', '');

  assert.strictEqual(h1, 'The Chicago Plumber - Chicago, IL');
  assert.ok(!h1.includes('/'), 'the separator is a slash again');
});

test('AND THE FIRST MENTION OF THE BUSINESS ON A SERVICE PAGE LINKS HOME', () => {
  /* 2 November. Nothing is written for it: the copy already names the
   * business somewhere, in its own words, in a different place on each page,
   * and this marks one of them up. Asking the model for a link would be a
   * dictated sentence, six times over. */
  assert.ok(/<a href="\.\.\/">The Chicago Plumber<\/a>/.test(SERVICE),
    'the first mention is not linked home');

  /* ONCE, NOT EVERY TIME. */
  assert.strictEqual(
    (SERVICE.match(/<a href="\.\.\/">The Chicago Plumber<\/a>/g) || []).length, 1,
    'every mention of the name is a link');
});

test('the contact form is markup only, and says so in its action', () => {
  /* Edwin, 26 October: "don't worry about processing the contact form. Just
   * add it even if it doesnt work. They can add a third party service." So
   * the placeholder is named loudly enough that nobody mistakes it for
   * working. */
  assert.ok(CONTACT.includes('action="REPLACE_WITH_YOUR_FORM_ENDPOINT"'));
});

test('AND THE PHONE NUMBER IS BESIDE IT, BECAUSE THE FORM GOES NOWHERE', () => {
  /* A visitor who fills it in and presses Send on an unwired action has
   * reached a dead end; one who sees the number has not. */
  const form = between(CONTACT, '<form class="quarry-form"', '</form>');

  assert.ok(form, 'there is no form on the contact page');
  assert.ok(/href="tel:/.test(form), 'the form offers no way to reach anybody');
  assert.ok((CONTACT.match(/href="tel:/g) || []).length >= 3,
    'the number appears fewer than three times on the page that needs it most');
});

test('and the form is in the first column, which is the mirror of Beacon', () => {
  const row = between(CONTACT, 'class="quarry-beside"', '</section>');

  assert.ok(row, 'the contact page has no beside row');
  assert.ok(row.indexOf('quarry-form') < row.indexOf('quarry-aside'),
    'the facts come before the form');
});

/* ======================================================================= */

section('THE TWO DIVIDERS');

const broken = renderSite(SITE({
  structure: 'quarry',
  home: {
    ...SITE().home,
    firstBreak: 'Under the sink, behind the panel.',
    secondBreak: 'We pick up before eight.',
  },
}));

test('BOTH APPEAR, AND BOTH CARRY THE LINE THEY WERE GIVEN', () => {
  const home = String(broken['index.html']);

  assert.ok(home.includes('Under the sink, behind the panel.'));
  assert.ok(home.includes('We pick up before eight.'));
  assert.strictEqual((home.match(/quarry-break/g) || []).length, 2);
});

test('A DIVIDER IS NOT A HEADING', () => {
  /* It is a breather: nothing sits under it and it introduces nothing. An h2
   * here would put a heading in the document outline that leads nowhere,
   * which is a worse page for anything reading the structure rather than
   * looking at it. */
  const band = between(String(broken['index.html']), 'quarry-break', '</div></div>');

  assert.ok(band, 'there is no divider at all');
  assert.ok(!/<h[1-6]/.test(band), 'the divider is marked up as a heading');
  assert.ok(/<p>/.test(band), 'the divider carries no paragraph');
});

test('IT IS A RULE AND A HANGING LINE, WITH NO BAND AT ALL', () => {
  /* Beacon's break is a deep band on a near-white page and Anvil's a raised
   * band on a dark one. The fourth answer is the page's own grid doing the
   * work: a hairline across, the sentence under it in the left column, and
   * no change of background anywhere. */
  const outer = (CSS.match(/\.quarry-break\{[^}]*\}/) || [''])[0];
  const line = (CSS.match(/\.quarry-break p\{[^}]*\}/) || [''])[0];

  assert.ok(!/background/.test(outer), 'the break is a band after all');
  assert.ok(/border-top:2px solid/.test(line), 'there is no rule above the line');
  assert.ok(!/text-align:center/.test(line), 'the line is centred, which is Anvil\'s');
  assert.ok(/max-width:28ch/.test(line), 'the line is not held to the left column');
});

test('AND A SITE BUILT BEFORE THEY EXISTED RENDERS NO EMPTY RULE', () => {
  /* Every site stored before this structure existed has no firstBreak in its
   * source. A re-render must produce a page without a rule, not a rule
   * without a line. */
  assert.ok(!HOME.includes('quarry-break'));

  const blank = renderSite(SITE({
    structure: 'quarry',
    home: { ...SITE().home, firstBreak: '   ', secondBreak: '' },
  }));

  assert.ok(!blank['index.html'].includes('quarry-break'), 'a blank line drew a rule');
});

/* ======================================================================= */

section('THE VOICE');

test('QUARRY IS A VOICE, NOT A FOURTH COPY OF THE RULES', () => {
  /* Everything in prompt.js which is not voice was paid for in measured
   * runs. A fourth prompt file that copied it would drift: the next fix
   * lands in one of the four, and nobody ever finds out from the three that
   * missed it. */
  assert.strictEqual(quarryPrompt.SECTIONS, ledgerPrompt.SECTIONS);
  assert.strictEqual(quarryPrompt.STANCES, ledgerPrompt.STANCES);
  assert.strictEqual(quarryPrompt.stanceFor, ledgerPrompt.stanceFor);
  assert.strictEqual(quarryPrompt.spellingFor, ledgerPrompt.spellingFor);
  assert.strictEqual(quarryPrompt.placeOf, ledgerPrompt.placeOf);
});

test('it writes at its own length, and no two lengths are the same pair', () => {
  /* NOT "ALL FOUR NUMBERS DIFFER", which is what Anvil's suite asserts and
   * is the wrong rule for a fourth: four non-overlapping budgets inside a
   * sane range would be four numbers chosen to differ rather than to fit a
   * measure. What must hold is that no two voices are the same BUDGET. */
  const all = [ledgerPrompt, beaconPrompt, anvilPrompt, quarryPrompt]
    .map(p => p.WORDS || { min: 780, max: 1000 })
    .map(w => `${w.min}-${w.max}`);

  assert.strictEqual(new Set(all).size, 4, `two voices share a budget: ${all.join(' ')}`);
  assert.ok(quarryPrompt.WORDS.min < quarryPrompt.WORDS.max);
});

test('AND ITS WORD BUDGET REACHES THE HOME PAGE, NOT JUST THE SERVICE PAGES', () => {
  /* THE BUG BEACON SHIPPED. Its first version set only the service-page
   * budget, so its home page came out exactly as long as Ledger's — caught
   * by putting the two built pages side by side, not by any test.
   *
   *     A SETTING READ IN TWO PLACES HAS TO BE PASSED TO BOTH. */
  const home = quarryPrompt.homePagePrompt({
    business: { name: 'X', trade: 'plumbing', city: 'Chicago', state: 'IL' },
    services: SLUGS.map(s => ({ slug: s, name: s })),
    areas: ['Chicago'],
  });

  const text = `${home.system}\n${home.user}`;

  assert.ok(text.includes(String(quarryPrompt.HOME.about[0])),
    'the home page was not given Quarry\'s paragraph budget');

  assert.notDeepStrictEqual(quarryPrompt.HOME, beaconPrompt.HOME);
  assert.notDeepStrictEqual(quarryPrompt.HOME, anvilPrompt.HOME);
});

test('the service page prompt carries Quarry\'s lines and its length', () => {
  const out = quarryPrompt.servicePagePrompt({
    business: { name: 'X', trade: 'plumbing', city: 'Chicago', state: 'IL' },
    service: { slug: 'drain-cleaning', name: 'drain cleaning' },
    services: SLUGS.map(s => ({ slug: s, name: s })),
    areas: ['Chicago'],
  });

  const text = `${out.system}\n${out.user}`;

  assert.ok(text.includes('OPEN ON WHAT THE READER CAN ALREADY NOTICE'),
    'the voice lines are missing');
  assert.ok(text.includes(String(quarryPrompt.WORDS.min)), 'the length is missing');
});

test('AND THE RHETORICAL QUESTION IS BANNED, WHICH THE SYMPTOM RULE MAKES NECESSARY', () => {
  /* A brief that says "open on the symptom" and nothing else produces "Is
   * your drain blocked? Look no further." every time: the rhetorical
   * question is the default way to write about a problem.
   *
   *     A RULE THAT INVITES A SHAPE HAS TO REFUSE THAT SHAPE IN THE SAME
   *     BREATH, OR THE SHAPE IS WHAT COMES BACK.
   *
   * ON THE FIRST SENTENCE OF A PARAGRAPH, not on the page: one question in
   * the middle is fine, and a blanket ban would read as a rule about
   * punctuation. */
  const lines = quarryPrompt.LINES.join('\n');

  assert.ok(/No paragraph begins with a question/.test(lines),
    'nothing refuses the rhetorical opening');
  assert.ok(/OPEN ON WHAT THE READER CAN ALREADY NOTICE/.test(lines));
});

test('THE THREE HOME PARAGRAPHS ARE ABOUT DIFFERENT THINGS FROM ALL THREE OTHERS', () => {
  /* THE BUG THIS EXISTS FOR. Ledger and Beacon were given the same three
   * subjects, and both came back opening paragraph three with "A visit
   * starts with", because Ledger's brief says "How a visit starts".
   *
   *     A BRIEF THAT DESCRIBES THE PARAGRAPH IN WORDS
   *     GETS THOSE WORDS BACK.
   *
   * Asserted as "no brief is shared", not as the text of any of them — the
   * point is that they are not the same brief, not what any one says. */
  const mine = quarryPrompt.HOME_JOBS;

  assert.strictEqual(mine.length, 3);

  for (const other of [ledgerPrompt, beaconPrompt, anvilPrompt]) {
    const theirs = (other.HOME_JOBS || []).map(String);

    for (const job of mine) {
      assert.ok(!theirs.includes(job), 'Quarry shares a home-page brief with another voice');
    }
  }
});

test('AND NONE OF THE THREE ASKS FOR A LIST', () => {
  /* All three of Quarry's subjects are about trouble, which is the subject
   * that most wants to be enumerated — and a home page listing faults is six
   * service pages' worth of keywords on the one page that should not be
   * competing with them.
   *
   *     THREE BRIEFS THAT ASK FOR A LIST PRODUCE A LIST OF LISTS.
   *     THE SUBJECT WAS NEVER THE PROBLEM; THE SHAPE WAS. */
  for (const job of quarryPrompt.HOME_JOBS) {
    assert.ok(!/\blist\b/i.test(job) || /not a list|rather than a list/i.test(job),
      `a brief invites a list: ${job.slice(0, 60)}`);
  }
});

test('AND NONE ASKS FOR A JOB THAT HAPPENED, OR FOR A FIGURE', () => {
  /* Nothing in the rules forbids a story in so many words, because they
   * forbid invented FIGURES — a fabricated case study slips between them and
   * reads as a reference nobody can check.
   *
   *     THE RULE SAYS DO NOT INVENT A NUMBER.
   *     A NARRATED JOB IS AN INVENTED EVENT, WHICH IS WORSE. */
  const conditions = quarryPrompt.HOME_JOBS[0];

  assert.ok(/IN THE GENERAL/.test(conditions),
    'the conditions brief does not refuse a case study');
  assert.ok(/named customer|particular address/i.test(conditions));

  for (const job of quarryPrompt.HOME_JOBS) {
    assert.ok(!/how many|years|since \d|team of|number of (?:vans|staff)/i.test(job),
      `a brief asks for a figure: ${job.slice(0, 60)}`);
  }
});

test('AND THE WHOLE SET CARRIES A FLOOR THE OTHER THREE DO NOT NEED', () => {
  /* Three paragraphs about what goes wrong is one bad draft away from
   * fear-selling, and the third is one sentence away from advice. A static
   * page telling somebody their gas smell can wait is not a dull paragraph,
   * it is a hazard. */
  const [, leaving, urgency] = quarryPrompt.HOME_JOBS;

  assert.ok(/Do not predict a disaster/i.test(leaving), 'the second brief may frighten');
  assert.ok(/do not tell the reader to do anything to the fault/i.test(leaving),
    'the second brief may hand out instructions');

  assert.ok(/Do not promise a response time/i.test(urgency));
  assert.ok(/do not say that any situation is safe to leave/i.test(urgency),
    'the urgency brief may tell somebody a fault can wait');
  assert.ok(/isolate, switch off, drain, open or touch/i.test(urgency),
    'the urgency brief may hand out a safety instruction');
});

test('THE TITLE AND THE DESCRIPTION HAVE A FOURTH ANGLE', () => {
  /* Ledger leads with the business name, Beacon with the kind of work, Anvil
   * with the place, Quarry with the problem — the only slot left that a
   * customer actually types. Two structures leading with the same slot
   * produce two titles of the same shape with a different noun in it. */
  const mine = quarryPrompt.QUARRY_VOICE;
  const others = [
    beaconPrompt.BEACON_VOICE,
    anvilPrompt.ANVIL_VOICE,
  ];

  for (const other of others) {
    assert.notStrictEqual(mine.title, other.title);
    assert.notStrictEqual(mine.meta, other.meta);
  }

  assert.ok(/Lead with the problem/i.test(mine.title), 'Quarry does not lead with the problem');
  assert.ok(/Open with what the reader has noticed/i.test(mine.meta),
    'the description does not open on the symptom');
  assert.ok(/Do not name any service/i.test(mine.meta),
    'the description still lists what is sold');
});

test('THE BUSINESS NAME IS IN BOTH, AND IS NEVER SHORTENED OR DROPPED', () => {
  /* Edwin, 30 October: "it should always appear in the title and meta
   * description." "The Austin Plumber" is the case that proves the rule
   * needs both halves — told only not to lead with the name, a model
   * satisfies it by writing "Austin Plumber", which is a different company's
   * name. */
  const mine = quarryPrompt.QUARRY_VOICE;

  for (const field of ['title', 'meta']) {
    assert.ok(/business name/i.test(mine[field]), `the ${field} brief never mentions the name`);
    assert.ok(/exactly as it was given/i.test(mine[field]), `the ${field} may reword the name`);
  }

  /* AND THE TOWN IS STILL REQUIRED. A local title without the town is a
   * worse title however well it reads. */
  assert.ok(/town/i.test(mine.title), 'the title brief drops the town');
});

test('THE DIVIDER EXEMPTION IS STATED, OR THE TWO RULES CANCEL', () => {
  /* The system prompt refuses the marketing register by name, and the
   * dividers are the one thing on the page MEANT to be a pleasantry.
   *
   *     AN EXCEPTION THAT IS NOT STATED IS NOT AN EXCEPTION.
   *     IT IS TWO RULES AND A COIN TOSS. */
  const home = quarryPrompt.homePagePrompt({
    business: { name: 'X', trade: 'plumbing', city: 'Chicago', state: 'IL' },
    services: SLUGS.map(s => ({ slug: s, name: s })),
    areas: ['Chicago'],
  });

  const text = `${home.system}\n${home.user}`;

  assert.ok(text.includes('EXEMPT FROM THE NO-MARKETING-REGISTER RULE'));
  assert.ok(/firstBreak/.test(text) && /secondBreak/.test(text));
});

test('BUT THE FLOOR HOLDS, AND THIS VOICE NEEDS ONE MORE OF IT', () => {
  /* Every other brief on a Quarry page is about something going wrong, so a
   * divider is the obvious place for the draft to put the scare line the
   * home-page briefs refused. */
  const note = quarryPrompt.QUARRY_VOICE.extrasNote;

  assert.ok(/no superlative/i.test(note));
  assert.ok(/guarantee/i.test(note));
  assert.ok(/no number/i.test(note));

  assert.ok(/may name a fault, a leak, a breakdown or an emergency/i.test(note),
    'a divider may carry the scare line the other briefs refused');
});

test('AND QUARRY\'S TWO DIVIDER BRIEFS ARE NOBODY ELSE\'S', () => {
  /* Identical briefs on two structures produce identical lines, and these
   * appear on the home page — where two sites are most likely to be set side
   * by side, which is exactly how the paragraph-three collision was found. */
  const mine = quarryPrompt.QUARRY_VOICE.extras.map(e => e.brief);

  for (const voice of [beaconPrompt.BEACON_VOICE, anvilPrompt.ANVIL_VOICE]) {
    const theirs = voice.extras.map(e => e.brief);

    for (const brief of mine) {
      assert.ok(!theirs.includes(brief), 'Quarry shares a divider brief');
    }
  }

  assert.deepStrictEqual(
    quarryPrompt.QUARRY_VOICE.extras.map(e => e.key),
    ['firstBreak', 'secondBreak'],
    'the stored field names changed, which would orphan every built site');
});

test('and they are the shortest of the four, because the measure is 28ch', () => {
  /* At ten words the line wraps to three and stops being a break; at six it
   * is the rule doing the work with a line attached. The brief and the
   * stylesheet have to agree about that, and they are in different files. */
  for (const { brief } of quarryPrompt.QUARRY_VOICE.extras) {
    assert.ok(/four to eight words/.test(brief), 'a divider brief asks for a longer line');
  }

  assert.ok(/max-width:28ch/.test(CSS), 'the stylesheet no longer holds the line short');
});

test('AND NO BRIEF CARRIES A DOUBLE QUOTE INTO THE JSON TEMPLATE', () => {
  /* The home page prompt builds a JSON template the model fills in. A double
   * quote inside a brief closes a string early and the reply comes back
   * unparseable. */
  const all = [
    ...quarryPrompt.HOME_JOBS,
    quarryPrompt.ABOUT_HEADING,
    quarryPrompt.QUARRY_VOICE.title,
    quarryPrompt.QUARRY_VOICE.meta,
    quarryPrompt.QUARRY_VOICE.extrasNote,
    ...quarryPrompt.QUARRY_VOICE.extras.map(e => e.brief),
  ];

  /* LINES IS NOT IN THAT LIST, AND IS NOT AN OVERSIGHT. The voice lines go
   * into the SYSTEM prompt as prose, not into the JSON template the model
   * fills in, so a double quote in one is a quoted phrase rather than a
   * string closed early — Anvil's lines quote four phrases for the same
   * reason. Including LINES here failed this test against a correct file,
   * which is the most expensive kind of assertion to leave in. */
  assert.ok(quarryPrompt.LINES.some(l => l.includes('"')),
    'the voice lines no longer quote anything, so the exemption above is moot');

  for (const brief of all) {
    assert.ok(!brief.includes('"'), `a brief carries a double quote: ${brief.slice(0, 40)}`);
  }
});

test('AND THE ABOUT HEADING ASKS FOR A PROPERTY, AND THE OPPOSITE OF ANVIL\'S', () => {
  /* Ledger says "a heading that says you are a local <trade> company in
   * <city, state>", and gets back "We Are a Local Plumbing Company in
   * Chicago, IL" — the brief, with capitals. Dictation.
   *
   * ANVIL'S MUST CONTAIN A VERB AND THIS ONE MUST NOT, which is the point:
   * told anything vaguer, four layouts produce the same heading with the
   * nouns shuffled. */
  const h = quarryPrompt.ABOUT_HEADING;

  assert.ok(/MUST NOT contain a verb/i.test(h), 'the heading brief has no testable property');
  assert.ok(/five words or fewer/i.test(h), 'the heading has no length rule');

  assert.ok(/MUST contain a verb/i.test(anvilPrompt.ABOUT_HEADING),
    'Anvil stopped demanding a verb and these two no longer contrast');

  assert.ok(h !== beaconPrompt.ABOUT_HEADING);
  assert.ok(h !== anvilPrompt.ABOUT_HEADING);
  assert.ok(!/["']/.test(h), 'the heading brief carries an example to echo');
});

test('AND THE SIX SERVICES ARE NOT RECITED, BECAUSE THE INDEX ALREADY NAMES THEM', () => {
  /* The shared instruction "Name the kinds of work in a sentence" is
   * Ledger's second brief said twice. Here the six names are already set in
   * a sticky column down the side of the services band, in 01..06 order, in
   * the reader's eyeline for the whole of it. */
  assert.strictEqual(quarryPrompt.QUARRY_VOICE.namesServices, false);
});

/* ======================================================================= */

section('WHAT DESIGN 4 MEANS ON THE FORM, WHICH IS NOTHING YET');

test('DESIGN 4 IS THE WHOLE PACKAGE, NOT JUST THE PHOTOGRAPHS', () => {
  /* Edwin, 30 October, having been told a second design would change "the
   * photographs, and nothing else": "I want a different html structure,
   * diferent css and different classes and prefix and css IDs, Different
   * prompts." */
  const four = designFor('4');

  assert.ok(four, 'there is no Design 4');
  assert.strictEqual(four.structure, 'quarry');
  assert.strictEqual(four.imageSet, 'set-4');

  /* ⚠ IT BELONGS TO CF_MODE AND MUST STAY THERE. It was lent to
   * `localoptions` for one hour on 17 November so Quarry could be built
   * through the only wizard that existed, and Edwin took it straight back
   * out: *"but remember I do not want that for github it's for
   * clouldflare"*.
   *
   *     QUARRY IS NOT A GITHUB LAYOUT. Putting it in that wizard to see it
   *     working is not a shortcut to testing it. */
  assert.deepStrictEqual(four.modes, [CF_MODE],
    'Design 4 is in the GitHub wizard\'s mode again — Quarry is a Cloudflare '
    + 'layout and is previewed with tools/preview-structure.js, not by '
    + 'putting it on the GitHub form');
});

test('AND NO WIZARD OFFERS IT, WHICH IS THE WHOLE POINT', () => {
  /* Edwin, 17 November: *"can we just show each group of designs mapped out
   * to either github/cloudflare so the user never has to worry about mixing
   * them up?"* The five new layouts are for a mode that does not exist yet,
   * so the list the GitHub wizard draws must not contain this row.
   *
   * THIS TEST WAS INVERTED FOR AN HOUR AND PUT BACK. Design 4 was moved into
   * `localoptions` so Quarry could be built end to end, and Edwin's answer
   * was *"but remember I do not want that for github it's for clouldflare"*.
   *
   *     THE SHORTEST ROUTE TO TESTING SOMETHING IS NOT A REASON TO SHIP IT
   *     SOMEWHERE IT DOES NOT BELONG. */
  const github = designsFor('localoptions').map(d => d.id);

  assert.deepStrictEqual(github, ['1', '2', '3'],
    'the GitHub wizard offers a Cloudflare layout');

  /* ALL SEVEN NOW — 18 November. Edwin: *"how about if we use the same
   * images and html structure of the sites generated with github, that way
   * cloudflare sites will have 7 html structure and 7 set of images"*. So
   * Ledger, Beacon and Anvil are offered at BOTH doors, and the Cloudflare
   * list runs 1 to 7 while the GitHub list above is unchanged.
   *
   * THE LIST IS WRITTEN OUT RATHER THAN COUNTED, so an eighth layout has to
   * be acknowledged here rather than slipping in. It has now reported three
   * times, which is the whole value of writing it out. */
  assert.deepStrictEqual(designsFor(CF_MODE).map(d => d.id),
    ['1', '2', '3', '4', '5', '6', '7']);

  /* AND THE SHARED ROWS ARE THE SAME ROWS, not copies of them. A second
   * Ledger row under a new id would pass the list check above and then
   * drift: one copy's imageSet changes and a site gets the other's
   * photographs, with nothing failing. */
  for (const id of ['1', '2', '3']) {
    assert.strictEqual(designFor(id, 'localoptions'), designFor(id, CF_MODE),
      `Design ${id} is a different object at each door`);
  }

  /* AN UNKNOWN MODE GETS NOTHING, not everything — a stale page or a typed
   * URL must not be handed a list belonging to some other product. */
  assert.deepStrictEqual(designsFor('nonesuch'), []);
  assert.deepStrictEqual(designsFor(''), []);
});

test('AND THE MODE IS CHECKED AT THE BUILD, NOT ONLY AT THE DROPDOWN', () => {
  /* 17 November, found while registering Quarry.
   *
   *     FILTERING A DROPDOWN IS NOT VALIDATING A FIELD.
   *     THE LIST THE FORM DREW IS NOT THE LIST THE SERVER WAS SENT.
   *
   * `design=4` typed into the request built a Quarry site in localoptions
   * mode with a photo set that does not exist, and runLocalOptions.js would
   * not have refused it: its own guard is about the siteMode, which was
   * perfectly valid. structureFor() falls back rather than throwing, so
   * nothing downstream would have complained either. */
  /* ASSERTED BOTH WAYS WITH THE TWO REAL MODES, and also against each row's
   * own mode and a bogus neighbour of it. The second half is what keeps this
   * honest if every row ever lands in one mode again — which happened for an
   * hour on 17 November, and is the state the design-mapping work warned
   * about:
   *
   *     WHILE ONE MODE OWNS EVERYTHING, "FILTERED" AND "NOT FILTERED" ARE
   *     THE SAME OUTPUT. Two mutants survived that way once already. */
  assert.strictEqual(designFor('4', 'localoptions'), null);

  assert.deepStrictEqual(buildOptionsFor('4', 'localoptions'), {
    design: '', structure: 'ledger', imageSet: '',
  });

  assert.deepStrictEqual(buildOptionsFor('4', CF_MODE), {
    design: '4', structure: 'quarry', imageSet: 'set-4',
  });

  /* AND THE OTHER WAY ROUND, so the guard is not simply refusing the new
   * row. ⚠ THIS ASSERTION WAS `designFor('1', CF_MODE) === null` UNTIL
   * 18 NOVEMBER and it fired the day Ledger was offered at both doors,
   * which is exactly what it was for. Design 1 is now a Cloudflare layout
   * as well — but Orchard is still NOT a GitHub one, and that is the
   * direction the guard actually protects. */
  assert.ok(designFor('1', CF_MODE), 'Design 1 is refused at the Cloudflare door');
  assert.strictEqual(designFor('1', CF_MODE).structure, 'ledger');
  assert.strictEqual(designFor('7', 'localoptions'), null,
    'the GitHub door accepts a Cloudflare-only layout');

  for (const d of DESIGNS) {
    for (const mode of d.modes) {
      assert.ok(designFor(d.id, mode),
        `${d.label} is refused by a door it is listed at`);
      assert.strictEqual(designFor(d.id, mode).structure, d.structure);

      assert.strictEqual(designFor(d.id, `${mode}-nonesuch`), null,
        `${d.label} is accepted by a mode that is not its own`);
    }
  }
});

test('AND A TRADE WITHOUT set-4 FALLS BACK RATHER THAN PUBLISHING FOUR GAPS', () => {
  /* THE TRAP I WARNED EDWIN ABOUT AND WAS WRONG ABOUT. Design 4 hard-names
   * set-4 and only plumbing has one, so picking it with roofing looked like
   * a site with four broken images — nothing failing, nothing warning.
   *
   * available() in generate.js has refused that since 30 October, written
   * for "Design 2 chosen alongside roofing". Asserted here because the
   * warning was wrong in conversation and the next person reading designs.js
   * deserves to find the answer rather than the worry.
   *
   *     READ THE CODE BEFORE DESCRIBING WHAT IT DOES.
   *
   * completeSets(), not setsIn(), so a folder with four pictures and no
   * alt.json falls back too — which is roofing and electrician today. */
  const { completeSets } = require('./utils/localOptions/render/heroes');
  const want = designFor('4').imageSet;

  assert.ok(completeSets('plumbing').includes(want),
    `plumbing has no ${want}, so this test proves nothing`);

  const src = require('fs').readFileSync('./utils/localOptions/generate.js', 'utf8');

  assert.ok(/function available\(trade, set, root\)/.test(src),
    'the set-availability guard is gone');
  assert.ok(/set: available\(trade, imageSet, imagesRoot\)/.test(src),
    'the build no longer passes the requested set through the guard');
});

test('and the build actually passes a key, which is the half that matters', () => {
  /* A mode-aware designFor() nothing calls with a mode is a mode-aware
   * designFor() that changed nothing. Read from the source, because the
   * alternative is running a build.
   *
   * ⚠ IT WAS `siteMode` HERE FOR AN HOUR AND THAT SHIPPED A BUG. Cloudflare
   * Local Automation runs this builder with siteMode `localoptions` and
   * offers the CF_MODE layouts, so looking a picked design up by the
   * siteMode found nothing and fell back to Ledger — Design 4 built Design
   * 1. designsKeyFor() answers it from the mode AND the destination, and
   * routes/formRoute.js asks the same function. See
   * test-local-automation.js. */
  const src = require('fs').readFileSync('./utils/runLocalOptions.js', 'utf8');

  assert.ok(src.includes('...buildOptionsFor(global.design, designsKey),'),
    'the build resolves a design without a key');
  assert.ok(src.includes('buildOptionsFor(global.design, designsKey).structure'),
    'the logo colour resolves a design without a key');

  assert.ok(src.includes('const designsKey = designsKeyFor({ siteMode, siteTarget });'),
    'the key is derived somewhere other than designsKeyFor');
});

test('every design names a structure that exists, with its own photographs', () => {
  const keys = structureKeys();
  const seen = new Set();

  for (const d of DESIGNS) {
    assert.ok(keys.includes(d.structure), `${d.label} names ${d.structure}, which does not exist`);

    /* A ROW WITH NO DOOR IS OFFERED NOWHERE, and nothing would say so —
     * designsFor() would simply never return it and the layout would look
     * like it had been forgotten rather than mis-tagged. */
    assert.ok(Array.isArray(d.modes) && d.modes.length,
      `${d.label} belongs to no door`);

    /* NO TWO DESIGNS ARE THE SAME SITE. Two that shared a structure AND a
     * photo set would be one design offered twice. */
    const pair = `${d.structure}/${d.imageSet}`;

    assert.ok(!seen.has(pair), `two designs are both ${pair}`);
    seen.add(pair);
  }
});

test('AND THE IDS COUNT THROUGH BOTH MODES', () => {
  /* They are what a form posts and what a stored job payload carries, so
   * they have to be unique across the whole file rather than per mode. An id
   * meaning Ledger on one wizard and Quarry on another is a stored source
   * nobody can read back. */
  assert.deepStrictEqual(DESIGNS.map(d => d.id), ['1', '2', '3', '4', '5', '6', '7']);
  assert.strictEqual(new Set(DESIGNS.map(d => d.id)).size, DESIGNS.length);
});

test('AND THE CLOUDFLARE MODE IS NOT IN seoPresets YET, ON PURPOSE', () => {
  /* normalizeSiteMode() resolves anything it does not know to 'lead'. The
   * moment CF_MODE is in that table it becomes a siteMode a job can carry,
   * and it would be let through pricing.js, contentModel.js and
   * jobGenerator — none of which have a branch for it.
   *
   *     A MODE THAT EXISTS IN THE TABLE AND NOWHERE ELSE IS NOT A
   *     HALF-FINISHED MODE. IT IS A JOB THAT BUILDS THE WRONG PRODUCT.
   *
   * This test is here to be DELETED, by whoever makes the mode real. */
  const { MODES, normalizeSiteMode } = require('./utils/seoPresets');

  assert.ok(!Object.values(MODES).includes(CF_MODE),
    'the Cloudflare mode is in MODES — pricing and jobGenerator need branches first');
  assert.strictEqual(normalizeSiteMode(CF_MODE), MODES.LEAD);
});

/* ---------------------------------------------------------------------- */

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
