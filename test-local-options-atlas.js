// test-local-options-atlas.js
//
// The sixth structure, and the first whose headings are not above anything.
//
// WHAT THIS SUITE IS GUARDING. All six are served as assets/site.css to
// different sites built by the same code. The failure it exists for is not a
// crash — it is a page that renders perfectly with a stylesheet written for
// one of the other five, where every selector misses, nothing throws, and
// the site goes out as unstyled text.
//
//     A STYLESHEET AND ITS MARKUP ARE ONE CHOICE, NOT TWO.
//
// Six structures collide thirty ways. The isolation tests are a loop over
// every ordered pair, which is why this file did not have to add ten more
// assertions by hand.
//
// AND WHAT IS NEW WITH THE SIXTH: THE MARGIN.
//
// Ledger, Beacon, Anvil, Quarry and Harbor all put a heading on top of the
// thing it introduces; they differ in what sits underneath. Atlas puts the
// heading in the LEFT MARGIN, beside its own prose, so the page can be read
// down one edge.
//
//   the two cells  Every section is a label cell and a body cell. A
//                  stylesheet cannot move an <h2> out of the flow and into
//                  a margin beside the paragraphs that follow it, so this
//                  is markup rather than CSS — and that makes it testable
//                  in the HTML rather than only in the stylesheet.
//   the empty one  A section with no heading still renders the label cell,
//                  so the text column starts in the same place on every
//                  block. That is the kind of detail that is invisible in a
//                  diff and obvious in a render, so it is pinned here.
//   the phone      The margin arrives at 900px and nowhere below it. Every
//                  rule above that breakpoint is the enhancement; the base
//                  is the small screen, which is Edwin's standing rule.
//   the folding    The hours are one line of type with consecutive
//                  identical days folded into runs. That is real logic, not
//                  formatting, so it gets its own section.
//
//   node test-local-options-atlas.js

'use strict';

const assert = require('assert');

const { renderSite } = require('./utils/localOptions/render/renderSite');
const { structureFor, structureKeys } = require('./utils/localOptions/render/structures');
const { STRUCTURES } = require('./utils/localOptions/render/theme');
const { DESIGNS, designFor, designsFor, CF_MODE } = require('./utils/localOptions/designs');

const ledgerPrompt = require('./utils/localOptions/prompt');
const beaconPrompt = require('./utils/localOptions/prompt-beacon');
const anvilPrompt = require('./utils/localOptions/prompt-anvil');
const quarryPrompt = require('./utils/localOptions/prompt-quarry');
const harborPrompt = require('./utils/localOptions/prompt-harbor');
const atlasPrompt = require('./utils/localOptions/prompt-atlas');

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
    /* THE FIRST PARAGRAPH NAMES THE BUSINESS, DELIBERATELY. linkHome()
     * marks up the first mention and writes nothing of its own, so a
     * fixture whose prose never names the business would make that test
     * pass against a page with no link in it. */
    sections: [
      { heading: '', paragraphs: ['Opening one at The Chicago Plumber.', 'Opening two.'] },
      { heading: 'A heading', paragraphs: ['A paragraph.'] },
    ],
  })),
  home: {
    h1: 'ignored', sub: 'Same-week appointments.',
    title: 'The Chicago Plumber', meta: 'A description.',
    aboutHeading: 'Chicago plumbing', about: ['First.', 'Second.'],
    firstBreak: 'Water where it should not be',
    secondBreak: 'A dated note on the valve',
  },
  now: new Date('2026-11-17T00:00:00Z'),
  ...over,
});

const atlas = renderSite(SITE({ structure: 'atlas' }));
const harbor = renderSite(SITE({ structure: 'harbor' }));
const quarry = renderSite(SITE({ structure: 'quarry' }));
const anvil = renderSite(SITE({ structure: 'anvil' }));
const beacon = renderSite(SITE({ structure: 'beacon' }));
const ledger = renderSite(SITE({ structure: 'ledger' }));

const BUILT = { ledger, beacon, anvil, quarry, harbor, atlas };

const allOf = files => Object.entries(files)
  .filter(([path]) => path.endsWith('.html') || path.endsWith('.css'))
  .map(([, body]) => String(body)).join('\n');

const CSS = String(atlas['assets/site.css']);
const HOME = String(atlas['index.html']);
const SERVICE = String(atlas['drain-cleaning/index.html']);
const CONTACT = String(atlas['contact/index.html']);
const LEGAL = String(atlas['privacy-policy/index.html']);
const NOTFOUND = String(atlas['404.html']);

const htmlPaths = files => Object.keys(files).filter(p => p.endsWith('.html'));

/**
 * The text between two markers, by index.
 *
 * NOT `split(marker)[1]`, WHICH IS WHAT QUARRY'S SUITE DID FIRST AND WHY
 * THREE TESTS FAILED AGAINST CORRECT MARKUP. A class name is a prefix of its
 * own modifiers, so splitting on one cuts at the first of them.
 */
function between(html, from, to) {
  const start = html.indexOf(from);

  if (start < 0) return '';

  const end = html.indexOf(to, start + from.length);

  return end < 0 ? html.slice(start) : html.slice(start, end);
}

/** Source with its comments stripped, so a mutant cannot match an explanation. */
function codeOnly(src) {
  return String(src).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** A stylesheet with its comments stripped, for the same reason. */
function cssOnly(src) {
  return String(src).replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The body of one @media block, by its condition. */
function mediaBlock(css, condition) {
  const at = css.indexOf(`@media ${condition}`);

  if (at < 0) return '';

  const open = css.indexOf('{', at);
  let depth = 0;

  for (let i = open; i < css.length; i += 1) {
    if ('{' === css[i]) depth += 1;
    else if ('}' === css[i]) {
      depth -= 1;
      if (0 === depth) return css.slice(open + 1, i);
    }
  }

  return '';
}

/**
 * The rules that apply at every width — the stylesheet with every @media
 * block cut out of it.
 *
 * ⚠ NOT `css.slice(0, css.indexOf('@media'))`, WHICH IS WHAT THIS WAS AND
 * WHY A MUTANT SURVIVED. That reads "everything before the FIRST media
 * query", and Atlas has two: a rule written between the 620px block and the
 * 900px one is unconditional and invisible to it. The mutant put the margin
 * grid exactly there — a two-column page on a 360px screen — and the suite
 * passed.
 *
 *     "BEFORE THE FIRST MEDIA QUERY" IS NOT "AT EVERY WIDTH".
 *     IT IS ONLY THE SAME FILE WHILE THERE IS ONE QUERY.
 */
function baseRules(css) {
  let out = '';
  let depth = 0;
  let inMedia = false;

  for (let i = 0; i < css.length; i += 1) {
    const c = css[i];

    if (!inMedia && 0 === depth && css.startsWith('@media', i)) {
      inMedia = true;
      /* Skip to the opening brace so the condition itself is dropped too. */
      while (i < css.length && '{' !== css[i]) i += 1;
      depth = 1;
      continue;
    }

    if (inMedia) {
      if ('{' === c) depth += 1;
      else if ('}' === c) {
        depth -= 1;
        if (0 === depth) inMedia = false;
      }
      continue;
    }

    out += c;
  }

  return out;
}

/** Every structure's class prefix and custom-property prefix. */
const MARKS = {
  ledger: { cls: /ledger-/, prop: /--lg-/ },
  beacon: { cls: /beacon-/, prop: /--bn-/ },
  anvil: { cls: /anvil-/, prop: /--av-/ },
  quarry: { cls: /quarry-/, prop: /--qy-/ },
  harbor: { cls: /harbor-/, prop: /--hb-/ },
  atlas: { cls: /atlas-/, prop: /--at-/ },
};

const chromeSrc = require('fs')
  .readFileSync('./utils/localOptions/render/atlas/chrome.js', 'utf8');
const pagesSrc = require('fs')
  .readFileSync('./utils/localOptions/render/atlas/pages.js', 'utf8');

/* ======================================================================= */

section('SIX STRUCTURES, THIRTY WAYS TO COLLIDE');

test('NO STRUCTURE\'S NAMES REACH ANY OTHER STRUCTURE\'S SITE', () => {
  /* Written as a loop over ordered pairs rather than by hand: two
   * structures were two directions, three were six, four were twelve, five
   * were twenty, six are thirty. A hand-written list is a list that is
   * short by ten the next time this grows. */
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

test('THE IDS DIFFER ACROSS ALL SIX', () => {
  /* Edwin, 30 October: "different classes and prefix and css IDs".
   *
   * QUARRY'S MAIN_ID WAS BEACON'S FOR AN HOUR and nothing would have
   * failed: the skip link and the <main> it points at are both inside one
   * page, so the duplicate lives in two sites that never meet.
   *
   *     TWO LAYOUTS SHARING AN ID STILL WORK. THEY JUST CANNOT BE TOLD
   *     APART BY A FRAGMENT, BY A SCRAPER, OR BY A TEST.
   *
   * ⚠ READ OUT OF THE RENDERED HTML, NOT OUT OF THE EXPORTS, AND THAT IS
   * THE WHOLE POINT OF REWRITING IT. Quarry's and Harbor's suites compared
   * the three constants each structure exports — and Ledger exports none:
   * its ids are string literals in its own markup. So the check could not
   * see the oldest structure in the set, and it found nothing when Quarry's
   * WHERE_ID was 'visit', which is the id sitting in Ledger's pages.js.
   *
   *     A UNIQUENESS CHECK THAT READS WHAT THE STRUCTURES DECLARE
   *     CANNOT SEE THE STRUCTURE THAT DECLARES NOTHING.
   *
   * Reading the built pages covers every id on every page of all six,
   * including the form fields, and cannot be fooled by a structure that
   * writes its ids inline. */
  const owner = new Map();

  for (const [key, files] of Object.entries(BUILT)) {
    const ids = new Set();

    for (const path of htmlPaths(files)) {
      for (const m of String(files[path]).match(/ id="[^"]+"/g) || []) {
        ids.add(m.slice(5, -1));
      }
    }

    assert.ok(ids.size >= 7, `${key} emits only ${ids.size} ids`);

    for (const id of ids) {
      assert.ok(!owner.has(id),
        `${key} and ${owner.get(id)} both use id="${id}"`);
      owner.set(id, key);
    }
  }

  assert.ok(owner.size >= 42, `only ${owner.size} distinct ids across six structures`);
});

test('and the skip link points at the id this structure actually used', () => {
  const { MAIN_ID } = require('./utils/localOptions/render/atlas/chrome');

  assert.strictEqual(MAIN_ID, 'text');

  for (const path of htmlPaths(atlas)) {
    const html = String(atlas[path]);

    assert.ok(html.includes(`<a class="atlas-skip" href="#${MAIN_ID}">`),
      `${path} has no skip link to #${MAIN_ID}`);
    assert.ok(html.includes(`<main id="${MAIN_ID}"`),
      `${path} has no main carrying id ${MAIN_ID}`);
  }
});

test('and so do the contact form field ids', () => {
  /* Ledger n/p/e/m, Beacon bn/bp/be/bm, Anvil an/ap/ae/am, Quarry
   * qn/qp/qe/qm, Harbor hn/hp/he/hm, Atlas mn/mp/me/mm. */
  for (const id of ['mn', 'mp', 'me', 'mm']) {
    assert.ok(CONTACT.includes(`id="${id}"`), `the contact form has no #${id}`);
    assert.ok(CONTACT.includes(`for="${id}"`), `nothing labels #${id}`);
  }

  for (const taken of ['hn', 'qn', 'an', 'bn']) {
    assert.ok(!CONTACT.includes(`id="${taken}"`),
      `Atlas's contact form carries ${taken}, which is another structure's`);
  }
});

test('A STYLESHEET NEVER ARRIVES WITHOUT ITS OWN MARKUP', () => {
  /* structureFor() resolves both halves from one key. The failure it is
   * written against is a theme object carrying one structure's CSS and
   * another's page builders — every selector misses and nothing throws. */
  for (const key of structureKeys()) {
    const s = structureFor(key);

    assert.strictEqual(s.key, key);
    assert.ok(s.css.includes(`.${s.prefix}`), `${key}'s css has no ${s.prefix} rule`);
    assert.ok(s.pages && s.prompt, `${key} is missing a half`);
  }
});

test('AND A TYPO FALLS BACK TO ALL SIX HALVES OF ONE', () => {
  /* structureFor() looks the PARTS up by the RESOLVED key, not by the
   * string that came in. structureFor('atals') returns Ledger, and it has
   * to return Ledger's pages with it. */
  const typo = structureFor('atals');

  assert.strictEqual(typo.key, 'ledger');
  assert.strictEqual(typo.pages, structureFor('ledger').pages);
  assert.strictEqual(typo.prompt, structureFor('ledger').prompt);
  assert.ok(!typo.css.includes('.atlas-'), 'a typo got Atlas\'s stylesheet');
});

test('and every class the markup emits has a rule, both ways round', () => {
  /* SCANNED AS TOKENS, NOT AS class="..." ATTRIBUTES. Harbor's first
   * version of this read the attributes and broke on a template
   * interpolation inside one of them, reporting a class that does not
   * exist. Comments are stripped from both sides first, so a rule that is
   * only MENTIONED in an explanation does not count as written. */
  const markup = new Set(
    `${codeOnly(chromeSrc)}${codeOnly(pagesSrc)}`.match(/atlas-[a-z0-9_-]+/g) || [],
  );
  const styled = new Set(
    (cssOnly(CSS).match(/\.atlas-[a-z0-9_-]+/g) || []).map(s => s.slice(1)),
  );

  assert.ok(markup.size > 25, `only ${markup.size} atlas- classes in the markup`);

  for (const cls of markup) {
    assert.ok(styled.has(cls), `.${cls} is emitted and has no rule`);
  }

  for (const cls of styled) {
    assert.ok(markup.has(cls), `.${cls} has a rule and is emitted by nothing`);
  }
});

/* ======================================================================= */

section('THE MARGIN, WHICH IS THE WHOLE STRUCTURE');

test('EVERY SECTION IS TWO CELLS: A LABEL AND A BODY', () => {
  /* THIS IS MARKUP AND NOT CSS, WHICH IS THE POINT. No stylesheet can lift
   * an <h2> out of the flow and set it beside the paragraphs that come
   * after it; the two have to be in two boxes. So the structure is
   * assertable in the HTML. */
  for (const path of htmlPaths(atlas)) {
    const html = String(atlas[path]);
    const leaves = html.split('<section class="atlas-leaf"').length - 1
      + (html.split('<div class="atlas-leaf">').length - 1);

    assert.ok(leaves > 0, `${path} has no leaf at all`);

    const labels = html.split('class="atlas-leaf__label"').length - 1;
    const bodies = html.split('class="atlas-leaf__body"').length - 1;

    assert.strictEqual(labels, leaves, `${path} has ${leaves} leaves and ${labels} labels`);
    assert.strictEqual(bodies, leaves, `${path} has ${leaves} leaves and ${bodies} bodies`);
  }
});

test('AND AN UNLABELLED SECTION STILL RENDERS ITS LABEL CELL', () => {
  /* A block that shifted left because it had no heading would make the
   * margin look accidental rather than designed. The service page's first
   * section is the lede and has no heading, so the empty cell is on every
   * service page in the site. */
  assert.ok(SERVICE.includes('<div class="atlas-leaf__label"></div>'),
    'the lede section dropped its empty label cell');

  /* AND THE SAME FUNCTION STILL RENDERS A REAL ONE, so the assertion above
   * is not passing against a page with no labels in it. */
  assert.ok(SERVICE.includes('<div class="atlas-leaf__label"><h2>'),
    'no section on a service page carries a heading at all');
});

test('THE HEADINGS ARE REAL h2s, SO THE OUTLINE SURVIVES THE LAYOUT', () => {
  /* A margin label drawn as a styled <div> would read as a heading and be
   * invisible to everything that reads the document rather than looking at
   * it — which on this structure is EVERY heading on the page, not one. */
  const label = between(HOME, '<div class="atlas-leaf__label">', '</div>');

  assert.match(label, /<h2>/, 'the label cell is not a heading');
  assert.ok(!CSS.includes('.atlas-leaf__label div'),
    'a div inside the label cell is being styled as a heading');

  /* ONE h1 PER PAGE, AND IT IS IN THE TITLE BLOCK, not in a margin. */
  for (const path of htmlPaths(atlas)) {
    const html = String(atlas[path]);

    assert.strictEqual(html.split('<h1>').length - 1, 1, `${path} has more than one h1`);
    assert.ok(between(html, '<div class="atlas-top__words">', '</header>').includes('<h1>'),
      `${path} has its h1 outside the title block`);
  }
});

test('THE MARGIN ARRIVES AT 900px AND NOWHERE BELOW IT', () => {
  /* Edwin's standing rule: mobile first. The base rules are the phone, in
   * which a label is simply above its block like every other structure;
   * the two-column grid is the enhancement.
   *
   *     A 11.5rem MARGIN BESIDE A 360px SCREEN IS NOT A MARGIN. */
  const bare = cssOnly(CSS);
  const wide = mediaBlock(bare, '(min-width:900px)');

  assert.ok(wide, 'there is no 900px block');
  assert.match(wide, /grid-template-columns:var\(--at-label\) 1fr/,
    'the two-column grid is not in the 900px block');

  /* AND IT REACHES ALL THREE KINDS OF BLOCK. A mutant that dropped
   * `.atlas-top` from the selector list survived the first version of this
   * test: the grid was still there, the leaves still had it, and the title
   * block quietly lost its margin — so the numeral sat above the headline
   * on exactly one block of the page.
   *
   *     ASSERTING THAT A RULE EXISTS IS NOT ASSERTING WHAT IT APPLIES TO. */
  const selector = between(wide, '.atlas-leaf,', '{');

  for (const part of ['.atlas-leaf,', '.atlas-top', '.atlas-break']) {
    assert.ok(`.atlas-leaf,${selector}`.includes(part),
      `${part} is not given the two-column grid, so one block loses the margin`);
  }

  /* THE NUMERAL AND THE LABELS GO IN COLUMN ONE, the words in column two. */
  assert.match(wide, /\.atlas-top__mark\{[^}]*grid-column:1/,
    'the numeral is not in the margin');
  assert.match(wide, /\.atlas-top__words\{grid-column:2/,
    'the headline is not in the text column');
  assert.match(wide, /\.atlas-leaf__label,\.atlas-top__mark\{text-align:right/,
    'the labels and the numeral are not ranged right against the text');

  /* AND NOT ANYWHERE THAT APPLIES AT EVERY WIDTH — which is not the same
   * as "before the first @media". See baseRules(). */
  const base = baseRules(bare);

  assert.ok(!base.includes('grid-template-columns:var(--at-label)'),
    'the margin grid applies at every width, so a phone gets a two-column page');
  assert.ok(!base.includes('text-align:right'),
    'the labels are ranged right on a phone, where they sit above their own text');

  /* AND THE HELPER ITSELF IS NOT VACUOUS: it must still be returning the
   * phone's rules, or both assertions above pass on an empty string. */
  assert.ok(base.includes('.atlas-leaf{padding:'), 'baseRules() dropped the base rules');
  assert.ok(!base.includes('@media'), 'baseRules() left a media query in');
});

test('AND EVERY MEDIA QUERY IS min-width, SO THE PHONE IS THE BASE', () => {
  /* One max-width rule would make the desktop the base and the phone the
   * exception, which is the thing Edwin has asked for the other way round
   * on every layout. */
  const queries = cssOnly(CSS).match(/@media[^{]+/g) || [];

  assert.ok(queries.length >= 2, `only ${queries.length} media queries`);

  for (const q of queries) {
    assert.ok(q.includes('min-width'), `a query is not min-width: ${q.trim()}`);
    assert.ok(!q.includes('max-width'), `a query is max-width: ${q.trim()}`);
  }
});

test('THE PHOTOGRAPH IS THE ONE THING THAT CROSSES THE MARGIN', () => {
  /* Every other block is a label and a column of text. A photograph
   * spanning both is the page drawing breath; a photograph cropped into an
   * 11.5rem column is a letterbox of somebody's elbow. */
  assert.ok(HOME.includes('<figure class="atlas-plate">'), 'there is no plate');

  const plate = between(HOME, '<figure class="atlas-plate">', '</figure>');

  assert.ok(!plate.includes('atlas-leaf'), 'the plate is inside a leaf');
  assert.ok(!cssOnly(CSS).includes('.atlas-plate{display:grid'),
    'the plate is laid out in the label grid');

  /* AND IT IS NOT IN THE LIST OF THINGS THAT GET THE GRID. */
  const wide = mediaBlock(cssOnly(CSS), '(min-width:900px)');
  const gridded = between(wide, '.atlas-leaf,', 'display:grid');

  assert.ok(!gridded.includes('atlas-plate'), 'the plate was given the two-column grid');
});

test('AND A PAGE WITH NO PHOTOGRAPH STILL HAS ITS HEADING', () => {
  /* No h1 lives inside plate(), so a page outside the hero rotation goes
   * from the title block to the first section and nothing looks
   * unfinished. */
  assert.ok(!LEGAL.includes('atlas-plate'), 'a legal page carries a photograph');
  assert.match(LEGAL, /<h1>Privacy Policy<\/h1>/, 'the legal page lost its heading');
  assert.ok(!NOTFOUND.includes('atlas-plate'), 'the 404 carries a photograph');
  assert.match(NOTFOUND, /<h1>That page is not here<\/h1>/, 'the 404 lost its heading');
});

test('THE NUMERAL IS THE RING\'S PLACE, AND IS ABSENT OFF THE RING', () => {
  /* A figure in the margin of a page that is not in the sequence is a
   * number belonging to nothing, and "00" looks like a bug. */
  const { markFor } = require('./utils/localOptions/render/atlas/pages');
  const ctx = { services: SITE().services };

  assert.strictEqual(markFor(ctx, 'index'), '01');
  assert.strictEqual(markFor(ctx, 'drain-cleaning'), '02');
  assert.strictEqual(markFor(ctx, 'privacy-policy'), '');
  assert.strictEqual(markFor(ctx, '404'), '');

  assert.ok(HOME.includes('<div class="atlas-top__mark">01</div>'),
    'the home page has no numeral');
  assert.ok(LEGAL.includes('<div class="atlas-top__mark"></div>'),
    'a legal page carries a numeral for a sequence it is not in');
});

test('AND THE FOOTER KEEPS THE MARGIN, RIGHT TO THE BOTTOM', () => {
  /* A footer breaking into three equal columns — which is what the other
   * five do — would be the one block on the page that abandoned the grid,
   * directly under the block that proves it. */
  const foot = between(HOME, '<footer class="atlas-foot">', '</footer>');

  assert.ok(foot.includes('class="atlas-leaf"'), 'the footer does not use leaves');
  assert.strictEqual(foot.split('class="atlas-leaf__label"').length - 1, 2,
    'the footer has the wrong number of labelled blocks');
  assert.ok(!cssOnly(CSS).includes('.atlas-foot{display:grid'),
    'the footer has a grid of its own instead of the page\'s');
});

/* ======================================================================= */

section('THE SERVICES, AS A TABLE');

test('IT IS A REAL TABLE, WHICH IS THE SIXTH ANSWER', () => {
  /* Ledger numbers two columns, Beacon lays out tiles, Anvil stacks rungs,
   * Quarry sticks an index beside the blurbs, Harbor runs a definition
   * list. It is tabular data — a name and a description, repeated — so
   * anything reading the page without looking at it gets the pairing. */
  assert.ok(HOME.includes('<table class="atlas-index">'), 'the services are not a table');
  assert.ok(HOME.includes('<tbody>'), 'the table has no tbody');

  const table = between(HOME, '<table class="atlas-index">', '</table>');

  assert.strictEqual(table.split('<tr').length - 1, 6, 'the table does not have six rows');

  for (let i = 1; i <= 6; i += 1) {
    assert.ok(table.includes(`<td class="atlas-index__num">${String(i).padStart(2, '0')}</td>`),
      `row ${i} is not numbered`);
  }

  /* AND NOBODY ELSE'S ANSWER IS ALSO ON THE PAGE. */
  assert.ok(!HOME.includes('<dl class="atlas-'), 'the services are also a definition list');
});

test('AND THE CELLS STACK ON A PHONE AND BECOME COLUMNS AT 620px', () => {
  /* A number, a name and a sentence across a 360px screen gives the
   * sentence about nine characters a line. */
  const bare = cssOnly(CSS);

  assert.match(baseRules(bare), /\.atlas-index td\{display:block/,
    'the cells do not stack on a phone');

  const mid = mediaBlock(bare, '(min-width:620px)');

  assert.ok(mid, 'there is no 620px block');
  assert.match(mid, /display:table-cell/, 'the cells never become columns again');

  /* AND THE COLUMN WIDTHS CAN ACTUALLY WIN. The phone rules reach a cell
   * through the table class, a row and a first-child pseudo-class; a bare
   * column name is one class and loses to that, so the widths would have
   * been set and thrown away. */
  assert.match(mid, /\.atlas-index tr td\.atlas-index__num\{width:/,
    'the column width is written with a selector that cannot win');
});

test('THE RING STILL CAPS THE BODY AT TWO LINKED SERVICES', () => {
  /* HOME_BODY_LINKS, shared by all six. The decision is made in
   * homeRows() in shape.js and not inside a rendering function, because it
   * was broken twice inside one and was invisible both times. */
  const { HOME_BODY_LINKS } = require('./utils/localOptions/render/shape');
  const table = between(HOME, '<table class="atlas-index">', '</table>');
  const links = table.split('<td class="atlas-index__name"><a href=').length - 1;

  assert.strictEqual(links, HOME_BODY_LINKS,
    `${links} linked rows against a cap of ${HOME_BODY_LINKS}`);
});

test('and an unlinked row is visibly muted, not quietly inert', () => {
  /* A row that looks clickable and is not is worse than one that plainly
   * is not. */
  const table = between(HOME, '<table class="atlas-index">', '</table>');

  assert.strictEqual(table.split('atlas-index__row--flat').length - 1, 4,
    'the four unlinked rows are not marked');
  assert.match(cssOnly(CSS), /\.atlas-index__row--flat \.atlas-index__name\{color:/,
    'the muted row has no rule, so it looks the same as a linked one');
});

/* ======================================================================= */

section('THE HOURS, FOLDED');

const { hours } = require('./utils/localOptions/render/atlas/chrome');

test('CONSECUTIVE IDENTICAL DAYS FOLD INTO A RANGE', () => {
  /* THE FOLDING IS THE POINT AND IT IS REAL LOGIC. Four identical rows
   * printed four times is a table with the formatting taken off; folding
   * them is what makes the line shorter than the grid rather than just
   * flatter. */
  const html = hours({ hours: SITE().hours });

  assert.match(html, /Mon&ndash;Thu 7:00 AM – 6:00 PM/, 'the four weekdays did not fold');
  assert.match(html, /Friday 7:00 AM – 5:00 PM/, 'Friday lost its own line');
  assert.match(html, /Sunday closed/, 'a closed day does not say closed');
  assert.strictEqual(html.split('atlas-hours__run').length - 1, 4,
    'the seven days did not fold to four runs');
});

test('A SINGLE DAY KEEPS ITS FULL NAME, AND A RANGE IS SHORTENED AT BOTH ENDS', () => {
  /* "Sunday closed" reads better than "Sun closed" on its own, and a range
   * wants the short form at both ends so the dash sits between two things
   * of the same size. */
  const one = hours({ hours: [{ day: 'Monday', open: '9-5' }] });

  assert.match(one, />Monday 9-5</, 'a lone day was shortened');
  assert.ok(!one.includes('&ndash;'), 'a lone day was given a range dash');

  const three = hours({
    hours: [
      { day: 'Monday', open: '9-5' },
      { day: 'Tuesday', open: '9-5' },
      { day: 'Wednesday', open: '9-5' },
    ],
  });

  assert.match(three, />Mon&ndash;Wed 9-5</, 'three identical days did not fold to a range');
});

test('A GAP IN THE MIDDLE IS NOT FOLDED OVER', () => {
  /* CONSECUTIVE ONLY, NEVER SORTED. Grouping every matching day wherever
   * it fell would print "Mon, Wed-Thu" for a business shut on Tuesday,
   * which is true and unreadable. */
  const html = hours({
    hours: [
      { day: 'Monday', open: '9-5' },
      { day: 'Tuesday', open: null },
      { day: 'Wednesday', open: '9-5' },
    ],
  });

  assert.strictEqual(html.split('atlas-hours__run').length - 1, 3,
    'a closed day in the middle was folded over');
  assert.match(html, />Monday 9-5</);
  assert.match(html, />Tuesday closed</);
  assert.match(html, />Wednesday 9-5</);
  assert.ok(!html.includes('Mon&ndash;Wed'), 'Monday and Wednesday were joined across Tuesday');
});

test('AND NO HOURS AT ALL RENDERS NOTHING', () => {
  /* An empty band with a label beside it is worse than no band. */
  assert.strictEqual(hours({ hours: [] }), '');
  assert.strictEqual(hours({}), '');
  assert.strictEqual(hours({ hours: [null, undefined] }), '');
});

test('IT IS A LINE OF TYPE, NOT A GRID OF SEVEN', () => {
  /* The sixth answer, and the only one that is not a grid. Ledger puts a
   * table beneath the prose, Beacon a slate beside it, Anvil a
   * seven-column band, Quarry a weekday/weekend split, Harbor the rail. */
  const html = hours({ hours: SITE().hours });

  assert.match(html, /^<p class="atlas-hours">/, 'the hours are not one paragraph');
  assert.ok(!html.includes('<table'), 'the hours are a table');
  assert.ok(!html.includes('<dl'), 'the hours are a definition list');
  assert.ok(!cssOnly(CSS).includes('.atlas-hours{display:grid'),
    'the hours line is laid out as a grid');

  /* AND A RUN NEVER BREAKS ACROSS LINES. "Mon-Thu 7:00 AM - 6:00" with
   * "PM" alone underneath is the failure this shape exists to avoid, and
   * it is the one Harbor's rail actually shipped. */
  assert.match(cssOnly(CSS), /\.atlas-hours__run\{white-space:nowrap/,
    'a folded run can break mid-range');
});

test('AND THE HOURS ARE RENDERED, NOT WRITTEN, ON EVERY SERVICE PAGE', () => {
  /* The prompt's fifth block used to be "Hours, and the area we cover", and
   * it produced the same address, the same four towns and the same opening
   * hours on all six pages — one duplicated paragraph across a six-page
   * site. */
  for (const slug of SLUGS) {
    const html = String(atlas[`${slug}/index.html`]);

    assert.ok(html.includes('class="atlas-hours"'), `${slug} has no hours`);
    assert.ok(html.includes('<h2>When we are open</h2>'), `${slug} has no hours label`);
  }
});

/* ======================================================================= */

section('THE DIVIDER, WHICH HAS NO RULE AT ALL');

const { divider } = require('./utils/localOptions/render/atlas/chrome');

test('BOTH APPEAR, AND BOTH CARRY THE LINE THEY WERE GIVEN', () => {
  assert.strictEqual(HOME.split('class="atlas-break"').length - 1, 2,
    'the home page does not have two dividers');
  assert.ok(HOME.includes('Water where it should not be'), 'the first line is missing');
  assert.ok(HOME.includes('A dated note on the valve'), 'the second line is missing');
});

test('THE LINE SITS IN THE MARGIN AND THE TEXT COLUMN IS LEFT EMPTY', () => {
  /* THE SIXTH ANSWER AND THE ONLY ONE WITH NO RULE. Beacon's break is a
   * deep band, Anvil's a raised band, Quarry's a hairline with the
   * sentence under it, Harbor's a sentence with the rule under that. This
   * is a gap in the page's own grid. */
  const wide = mediaBlock(cssOnly(CSS), '(min-width:900px)');

  assert.match(wide, /\.atlas-break p\{grid-column:1/,
    'the divider line is not in the label column');

  const bare = cssOnly(CSS);

  assert.ok(!bare.includes('.atlas-break::after'), 'the divider grew a rule');
  assert.ok(!bare.includes('.atlas-break::before'), 'the divider grew a rule');
  assert.ok(!/\.atlas-break[^}]*border/.test(bare), 'the divider has a border');
  assert.ok(!/\.atlas-break p\{[^}]*border/.test(bare), 'the divider line has a border');
});

test('A DIVIDER IS NOT A HEADING', () => {
  /* Nothing sits under it and it introduces nothing; a heading here would
   * put an entry in the outline that leads nowhere — which matters more on
   * this structure than the others, because every real heading on the page
   * is in that same margin. */
  const first = between(HOME, '<div class="atlas-break">', '</div>');

  assert.match(first, /<p>/, 'the divider line is not a paragraph');
  assert.ok(!/<h[1-6]/.test(first), 'the divider is a heading');
});

test('AND A SITE BUILT BEFORE THEY EXISTED RENDERS NO EMPTY GAP', () => {
  /* Every site built before this structure existed has no firstBreak in
   * its stored source, and a re-render of one must produce a page without
   * a gap, not a gap without a line. */
  assert.strictEqual(divider({}), '');
  assert.strictEqual(divider({ line: '' }), '');
  assert.strictEqual(divider({ line: '   ' }), '');
  assert.strictEqual(divider({ line: null }), '');

  const bare = renderSite(SITE({
    structure: 'atlas',
    home: { ...SITE().home, firstBreak: '', secondBreak: '' },
  }));

  assert.ok(!String(bare['index.html']).includes('atlas-break'),
    'a site with no divider lines still renders the blocks');
});

/* ======================================================================= */

section('THE SAME SITE, DIFFERENTLY DRESSED');

test('ALL SIX BUILD THE SAME FILES, DOWN TO THE PATHS', () => {
  /* THE SAME ELEVEN, AND THE SAME SECTIONS INSIDE THEM — the rule that has
   * held since Beacon, and the one thing a new structure may not
   * re-decide. Compared as a list rather than as a count, because two
   * structures can agree on sixteen files and disagree about which. */
  for (const [key, files] of Object.entries(BUILT)) {
    assert.deepStrictEqual(Object.keys(files).sort(), Object.keys(atlas).sort(),
      `${key} and Atlas do not build the same files`);
  }

  /* The eleven pages, the 404, the stylesheet, the sitemap, robots and the
   * CNAME. 404.html is a page AND an html path, which is why the count
   * here is twelve rather than eleven. */
  assert.strictEqual(htmlPaths(atlas).length, 12);
  assert.strictEqual(Object.keys(atlas).length, 16);
});

test('and every service page carries the same sections', () => {
  for (const slug of SLUGS) {
    const page = String(atlas[`${slug}/index.html`] || '');

    assert.ok(page, `${slug} was not built`);
    assert.ok(page.includes('atlas-top'), `${slug} has no title block`);
    assert.ok(page.includes('atlas-leaf'), `${slug} has no sections`);
    assert.ok(page.includes('atlas-onward'), `${slug} does not pass the reader on`);
  }
});

test('the Search Console tag is on every page', () => {
  for (const path of htmlPaths(atlas)) {
    assert.ok(String(atlas[path]).includes('google-site-verification'),
      `${path} has no verification tag`);
  }
});

test('AND THE LOGO, STYLESHEET AND PHOTOGRAPH ARE RE-BASED FOR DEPTH', () => {
  /* A relative path that is not re-based is correct at the root and wrong
   * everywhere else: assets/logo.png from /drain-cleaning/ asks for
   * /drain-cleaning/assets/logo.png. Ledger shipped that for a day. */
  assert.ok(HOME.includes('href="assets/site.css"'), 'the home page css is not relative');
  assert.ok(SERVICE.includes('href="../assets/site.css"'), 'the service page css is not re-based');
  assert.ok(SERVICE.includes('src="../assets/logo.png"'), 'the logo is not re-based');
  assert.ok(SERVICE.includes('src="../assets/hero-2.webp"'), 'the hero is not re-based');

  /* AND THE 404 IS ABSOLUTE, ALONE AMONG THE ELEVEN. The server returns it
   * for whatever URL was missing, so a relative path would climb from
   * somewhere nobody chose. */
  assert.ok(NOTFOUND.includes('href="/assets/site.css"'), 'the 404 css is not absolute');
  assert.ok(NOTFOUND.includes('href="/drain-cleaning/"'), 'the 404 links are not absolute');
});

test('the hero is eager and high priority, because it is what the page is measured by', () => {
  assert.match(HOME, /loading="eager" fetchpriority="high"/);
  assert.ok(!HOME.includes('loading="lazy" fetchpriority'), 'the hero is lazy-loaded');
});

test('the schema and the canonical are untouched by the layout', () => {
  /* THE HOME PAGE'S @type IS THE TRADE'S OWN — "Plumber" here, not
   * "LocalBusiness". localBusiness() maps the trade to the narrowest
   * schema.org type it can, so this reads the type out rather than naming
   * one: a fixture on a different trade would fail an assertion that typed
   * "Plumber" in, which is a test about the fixture and not about Atlas. */
  const ld = JSON.parse(between(HOME, '<script type="application/ld+json">', '</script>')
    .replace('<script type="application/ld+json">', ''));

  assert.strictEqual(ld['@context'], 'https://schema.org');
  assert.ok(ld['@type'] && 'string' === typeof ld['@type'], 'the home page lost its schema type');
  assert.strictEqual(ld.name, 'The Chicago Plumber');

  /* AND IT IS THE SAME OBJECT ON ALL SIX, because the schema is a rule
   * about the SITE and not about the layout. */
  for (const [key, files] of Object.entries(BUILT)) {
    const theirs = between(String(files['index.html']),
      '<script type="application/ld+json">', '</script>')
      .replace('<script type="application/ld+json">', '');

    assert.deepStrictEqual(JSON.parse(theirs), ld, `${key}'s schema differs from Atlas's`);
  }

  assert.ok(SERVICE.includes('"@type":"Service"'), 'a service page lost its schema');
  assert.ok(HOME.includes('rel="canonical" href="https://the-chicago-plumber.9-x.org/"'),
    'the home canonical is wrong');
  assert.ok(!LEGAL.includes('application/ld+json'), 'a legal page carries schema');
});

test('AND THE 404 IS NOINDEX, WITH ITS CANONICAL ON THE HOME PAGE', () => {
  /* A 404 that declares itself canonical is a 404 asking to be indexed. */
  assert.ok(NOTFOUND.includes('<meta name="robots" content="noindex">'),
    'the 404 is indexable');
  assert.ok(NOTFOUND.includes('rel="canonical" href="https://the-chicago-plumber.9-x.org/"'),
    'the 404 canonical does not point at the home page');
});

test('a build is reproducible — the same input gives the same bytes', () => {
  /* `now` is an argument for this reason: a renderer that reads the clock
   * produces different bytes for the same input, once a year, at midnight,
   * for everybody at once. */
  const again = renderSite(SITE({ structure: 'atlas' }));

  for (const path of Object.keys(atlas)) {
    assert.strictEqual(String(again[path]), String(atlas[path]), `${path} differs`);
  }
});

test('NO PAGE CARRIES AN HTML COMMENT AT ALL', () => {
  /* One shipped into a live page once, complete with a quoted old draft.
   * Every explanation in these files is a JS comment for that reason. */
  for (const path of htmlPaths(atlas)) {
    assert.ok(!String(atlas[path]).includes('<!--'),
      `${path} carries an HTML comment`);
  }
});

test('AND THE MENU WORKS WITH NO JAVASCRIPT, BECAUSE THESE SITES SHIP NONE', () => {
  for (const path of htmlPaths(atlas)) {
    assert.ok(!String(atlas[path]).includes('<script src'), `${path} loads a script`);
    assert.ok(!/<script(?![^>]*application\/ld\+json)/.test(String(atlas[path])),
      `${path} carries a script that is not schema`);
  }
});

test('AND NO DISCLOSURE, UNLIKE FOUR OF THE FIVE', () => {
  /* Four of them hide six services behind a <details> because a bar with a
   * logo and a button has no room. This bar has nothing else in it, so the
   * six fit on their own line. */
  assert.ok(!HOME.includes('<details'), 'the bar has a disclosure');

  const nav = between(HOME, '<nav class="atlas-nav"', '</nav>');

  for (const slug of SLUGS) {
    assert.ok(nav.includes(`href="${slug}/"`), `the bar does not link ${slug}`);
  }
});

test('and the page you are on is marked in the bar', () => {
  /* Six services listed on all six service pages with nothing saying which
   * one you are reading is six identical menus. */
  assert.ok(between(SERVICE, '<nav class="atlas-nav"', '</nav>')
    .includes('href="../drain-cleaning/" aria-current="page"'),
  'the service page is not marked in its own menu');
  assert.match(cssOnly(CSS), /\.atlas-nav a\[aria-current\]/,
    'the marked link has no rule, so it looks like the others');
});

test('THE SENTENCE ABOVE THE SERVICES IS WRITTEN FOR A CUSTOMER', () => {
  /* Edwin, 30 October: "this should be for a customer." Anvil's first
   * draft said "All six have a page of their own", which is a note about
   * what was built. */
  const { defaultServicesLede } = require('./utils/localOptions/render/atlas/pages');
  const lede = defaultServicesLede();

  assert.ok(!/\bpage\b/i.test(lede), 'the lede talks about pages');
  assert.ok(!/\bsite\b/i.test(lede), 'the lede talks about the site');
  assert.ok(HOME.includes(lede), 'the lede is not on the page');
});

test('and it counts the services from the constant, never in typed prose', () => {
  /* The services lede said "three" for a day after the body-link cap
   * became two, because the number was prose rather than the constant.
   *
   * READING THE FUNCTION'S SOURCE, NOT ITS OUTPUT. A mutant that typed the
   * word out would produce exactly the right string, which is how one
   * survived Quarry's suite. */
  const { SERVICE_COUNT, inWords } = require('./utils/localOptions/render/shape');
  const { defaultServicesLede } = require('./utils/localOptions/render/atlas/pages');
  const src = codeOnly(defaultServicesLede.toString());

  assert.ok(src.includes('inWords(SERVICE_COUNT)'),
    'the lede does not read the count from the constant');
  assert.ok(!src.includes(`'${inWords(SERVICE_COUNT)}'`),
    'the count is also typed out beside the constant');
  assert.ok(defaultServicesLede().includes(inWords(SERVICE_COUNT)),
    'the count does not reach the sentence');
});

test('AND THE OWNER CAN REPLACE IT, OR TAKE IT AWAY', () => {
  /* ABSENT IS NOT EMPTY. `undefined` means nobody has edited the field and
   * the default stands; an empty string means the owner cleared it. */
  const { defaultServicesLede } = require('./utils/localOptions/render/atlas/pages');

  const edited = renderSite(SITE({
    structure: 'atlas',
    home: { ...SITE().home, servicesLede: 'Our own words.' },
  }));

  assert.ok(String(edited['index.html']).includes('Our own words.'));
  assert.ok(!String(edited['index.html']).includes(defaultServicesLede()));

  const cleared = renderSite(SITE({
    structure: 'atlas',
    home: { ...SITE().home, servicesLede: '' },
  }));

  assert.ok(!String(cleared['index.html']).includes('atlas-said'),
    'a cleared lede still renders its paragraph');
  assert.ok(String(cleared['index.html']).includes('<table class="atlas-index">'),
    'clearing the lede took the services with it');
});

test('AND THE FIRST MENTION OF THE BUSINESS ON A SERVICE PAGE LINKS HOME', () => {
  /* Nothing is written for it: the copy already names the business
   * somewhere, in its own words, and this marks one of them up. */
  assert.ok(SERVICE.includes('<a href="../">The Chicago Plumber</a>'),
    'the first mention is not linked home');
  assert.strictEqual(SERVICE.split('<a href="../">The Chicago Plumber</a>').length - 1, 1,
    'more than the first mention was linked');
});

test('AND THE SECTIONS GO IN BARE, BECAUSE THEY ARE ALREADY THE PAGE\'S BLOCKS', () => {
  /* On the other five, prose() returns headings and paragraphs that need a
   * wrapper to be a column; here it returns one leaf per section. The
   * first version wrapped the leaves in a prose div, which put a column
   * inside the grid they are part of. */
  const { prose } = require('./utils/localOptions/render/atlas/pages');
  const out = prose([{ heading: 'A', paragraphs: ['one'] }]);

  assert.match(out, /^\s*<section class="atlas-leaf">/, 'prose() does not return leaves');
  assert.ok(!out.includes('<h2>A</h2>\n<p>'), 'prose() still puts the heading above the text');
  assert.ok(between(out, '<section class="atlas-leaf">', '</section>').includes('<h2>A</h2>'),
    'the heading is not inside the leaf');

  /* AND THE LEDE IS THE FIRST PARAGRAPH OF THE FIRST SECTION, ONLY. */
  const two = prose([
    { heading: '', paragraphs: ['lead', 'second'] },
    { heading: 'B', paragraphs: ['third'] },
  ]);

  assert.strictEqual(two.split('atlas-lede').length - 1, 1, 'more than one lede paragraph');
  assert.match(two, /class="atlas-lede">lead</, 'the lede is not the first paragraph');
});

test('the contact form is markup only, and says so in its action', () => {
  /* A static site has no server to receive a submission, and Edwin decided
   * on 26 October not to build one. */
  assert.ok(CONTACT.includes('action="REPLACE_WITH_YOUR_FORM_ENDPOINT"'),
    'the form action does not announce itself as a placeholder');
});

test('AND THE NUMBER IS STILL BESIDE IT, BECAUSE THE FORM GOES NOWHERE', () => {
  /* A visitor who fills the form in and presses Send on an unwired action
   * has reached a dead end; one who sees the number has not. */
  const form = between(CONTACT, '<form class="atlas-form"', '</form>');

  assert.ok(form.includes('href="tel:+13125550164"'), 'the form has no phone number beside it');
});

test('AND THE FORM IS A LEAF LIKE EVERYTHING ELSE, WHICH IS THE SIXTH ANSWER', () => {
  /* Ledger and Anvil put facts beneath the form, Beacon beside it on the
   * right, Quarry on the left, Harbor nothing beside it. A reference page
   * does not make an exception for its last page, so the form gets a label
   * in the margin and nothing else. */
  const block = between(CONTACT, '<h2>Send a message</h2>', '</section>');

  assert.ok(block.includes('<form class="atlas-form"'), 'the form is not in a labelled leaf');
  assert.ok(!cssOnly(CSS).includes('.atlas-form{display:grid'),
    'the form has a layout of its own');
  assert.ok(!cssOnly(CSS).includes('.atlas-form{background'),
    'the form is on a card, which is a thing lifted off a reference page');
});

test('and the fields are 16px, or the phone zooms and does not zoom back', () => {
  /* Safari on iOS scales the whole page up when a focused field's text is
   * under 16px, and it does not scale back out.
   *
   * ⚠ THE FIRST VERSION OF THIS MATCHED font-size:16px ANYWHERE IN THE
   * BLOCK AND A MUTANT WALKED PAST IT. Appending a second declaration left
   * the 16px in place and made the effective value 14px: in CSS the LAST
   * declaration wins, so finding the right one proves nothing about what
   * the browser uses.
   *
   *     A DECLARATION THAT IS PRESENT IS NOT A DECLARATION THAT APPLIES.
   *
   * So this reads every font-size in the rule and checks the last. The same
   * reasoning applies anywhere a block is searched for one value. */
  const bare = cssOnly(CSS);
  const rule = between(bare, '.atlas-form input,.atlas-form textarea{', '}');
  const sizes = rule.match(/font-size:[^;}]+/g) || [];

  assert.ok(sizes.length, 'the form fields have no font-size at all');
  assert.strictEqual(sizes[sizes.length - 1], 'font-size:16px',
    `the field's effective font-size is ${sizes[sizes.length - 1]}, under which iOS zooms`);

  /* AND NOTHING LATER IN THE STYLESHEET SETS A SMALLER ONE on the same
   * fields, which is the other way the same bug arrives. */
  const after = bare.slice(bare.indexOf('.atlas-form input,.atlas-form textarea{'));

  assert.ok(!/\.atlas-form (?:input|textarea)[^{]*\{[^}]*font-size:1[0-5]px/.test(after),
    'a later rule drops the field font-size below 16px');
});

/* ======================================================================= */

section('THE VOICE');

const VOICES = {
  ledger: ledgerPrompt,
  beacon: beaconPrompt,
  anvil: anvilPrompt,
  quarry: quarryPrompt,
  harbor: harborPrompt,
  atlas: atlasPrompt,
};

test('ATLAS IS A VOICE, NOT A SIXTH COPY OF THE RULES', () => {
  /* Everything in prompt.js which is not voice was paid for in measured
   * runs. A sixth copy of it drifts, and the next fix lands in one of the
   * six. */
  const src = require('fs').readFileSync('./utils/localOptions/prompt-atlas.js', 'utf8');

  assert.ok(src.includes("require('./prompt')"), 'the voice does not build on the shared rules');
  assert.ok(!src.includes('spellingFor('), 'the voice redefines the spelling rule');
  assert.strictEqual(atlasPrompt.SECTIONS, ledgerPrompt.SECTIONS,
    'Atlas exports a different section list, which is a different product');
  assert.strictEqual(atlasPrompt.STANCES, ledgerPrompt.STANCES);
});

test('it writes at its own length, and no two voices share a budget', () => {
  const seen = new Map();

  for (const [key, mod] of Object.entries(VOICES)) {
    const w = mod.WORDS;
    const sig = `${w.min}-${w.max}`;

    assert.ok(!seen.has(sig), `${key} and ${seen.get(sig)} have the same budget (${sig})`);
    seen.set(sig, key);
  }

  assert.deepStrictEqual(atlasPrompt.WORDS, { min: 700, max: 860 });
});

test('AND ITS WORD BUDGET REACHES THE HOME PAGE, NOT JUST THE SERVICE PAGES', () => {
  /* THIS WAS THE BUG BEACON SHIPPED. Its first version set only the
   * service-page budget, so its home page came out exactly as long as
   * Ledger's — caught by putting the two built pages side by side. */
  const seen = new Map();

  for (const [key, mod] of Object.entries(VOICES)) {
    const h = mod.HOME || (mod.LEDGER_VOICE && mod.LEDGER_VOICE.home);

    assert.ok(h, `${key} has no home-page lengths`);

    const sig = `${h.sub.join('-')}/${h.about.join('-')}`;

    assert.ok(!seen.has(sig), `${key} and ${seen.get(sig)} share home lengths (${sig})`);
    seen.set(sig, key);
  }

  const built = atlasPrompt.homePagePrompt({
    business: SITE().business, services: SITE().services, areas: SITE().areas,
  });
  const text = `${built.system}\n${built.user}`;

  for (const n of [...atlasPrompt.HOME.sub, ...atlasPrompt.HOME.about]) {
    assert.ok(text.includes(String(n)), `the home prompt never mentions ${n}`);
  }
});

test('the service page prompt carries Atlas\'s lines and its length', () => {
  const built = atlasPrompt.servicePagePrompt({
    business: SITE().business, service: SITE().services[0], areas: SITE().areas,
  });

  for (const line of atlasPrompt.LINES) {
    if (!line) continue;

    assert.ok(built.system.includes(line), `a voice line is missing: ${line.slice(0, 40)}`);
  }

  assert.ok(built.system.includes('700'), 'the minimum is not in the prompt');
  assert.ok(built.system.includes('860'), 'the maximum is not in the prompt');
});

test('AND THE SELF-CONTAINED RULE NAMES THE WORDS IT FORBIDS', () => {
  /* A brief that says "each section should stand alone" and nothing else
   * produces a page that still opens its third paragraph with "These
   * problems". Naming the openings is what moves it, and it is what makes
   * the rule checkable at all. */
  const text = atlasPrompt.LINES.join('\n');

  assert.match(text, /EVERY SECTION STANDS ALONE/, 'the rule is not stated');
  assert.match(text, /Do not refer to another section/, 'the rule has no teeth');

  for (const word of ['This', 'That', 'These', 'Those', 'It', 'They', 'Such', 'Here']) {
    assert.ok(text.includes(word), `the forbidden openings do not name ${word}`);
  }

  /* AND THE GUARD AGAINST THE OBVIOUS FAILURE OF THAT RULE. Five
   * self-contained sections written carelessly each begin by restating the
   * same subject in the same words. */
  assert.match(text, /Do not open two sections with the same noun/,
    'nothing stops the five sections opening identically');
});

test('and no two voices ship the same lines', () => {
  const seen = new Map();

  for (const [key, mod] of Object.entries(VOICES)) {
    const lines = mod.LINES;

    if (!lines) continue;

    const sig = lines.join('|');

    assert.ok(!seen.has(sig), `${key} and ${seen.get(sig)} ship identical style lines`);
    seen.set(sig, key);
  }
});

test('THE THREE HOME PARAGRAPHS ARE ABOUT DIFFERENT THINGS FROM ALL FIVE OTHERS', () => {
  /* Edwin built one site in each of the first two structures and set the
   * home pages beside each other: same three subjects, same order, and
   * both third paragraphs opened "A visit starts with". */
  const seen = new Map();

  for (const [key, mod] of Object.entries(VOICES)) {
    const jobs = mod.HOME_JOBS || (mod.LEDGER_VOICE && mod.LEDGER_VOICE.homeJobs);

    assert.ok(jobs && 3 === jobs.length, `${key} does not have three home briefs`);

    for (const job of jobs) {
      const sig = job.slice(0, 60);

      assert.ok(!seen.has(sig), `${key} and ${seen.get(sig)} open a brief identically`);
      seen.set(sig, key);
    }
  }
});

test('AND NONE OF THEM ALLOWS A LIST, WHICH IS A DECISION', () => {
  /* Beacon allows exactly one, for symptoms; Harbor exactly one, for
   * limits; Anvil and Quarry none.
   *
   *     THIS PAGE IS ALREADY A LIST. Six labelled blocks down a margin and
   *     a ruled table of six services. A run of bullets inside one of
   *     those blocks is a list inside a list. */
  for (const job of atlasPrompt.HOME_JOBS) {
    assert.ok(!/run of named things is allowed/i.test(job),
      'an Atlas brief allows a list');
    assert.ok(!/\bbullet/i.test(job), 'an Atlas brief asks for bullets');
  }

  /* AND THE TWO THAT DO ARE STILL THERE, so this is a difference rather
   * than a drift. */
  assert.ok(harborPrompt.HOME_JOBS.some(j => /run of named things is allowed/i.test(j)),
    'Harbor lost the one brief that allows a list');
});

test('AND NONE ASKS FOR A JOB THAT HAPPENED, OR FOR A FIGURE', () => {
  /* The model is given the business name, the trade, the address, the
   * towns and six service names — nothing else. A brief that asks for
   * something the rules forbid produces a worse paragraph than one that
   * never asked. */
  for (const job of atlasPrompt.HOME_JOBS) {
    assert.ok(!/\bhow many\b(?!\s+jobs are done)/i.test(job.replace(/Do not[^.]*\./g, '')),
      `a brief asks for a count: ${job.slice(0, 50)}`);
  }

  /* EACH ONE CARRIES ITS OWN REFUSAL, which is the half that matters: the
   * shared rules forbid invented figures, and a brief whose subject invites
   * one says so where the model is reading. */
  const [words, year, check] = atlasPrompt.HOME_JOBS;

  assert.match(words, /TRANSLATION ONLY/, 'the glossary brief does not fence itself');
  assert.match(words, /never what is done about it/i,
    'the glossary brief does not stop short of explaining a service');
  assert.match(year, /Do not name a temperature/,
    'the seasons brief invites a climate it was not given');
  assert.match(year, /Work only from the town and state you were given/,
    'the seasons brief does not say where the facts come from');
  assert.match(check, /SAFE AND TOOL-FREE ONLY/, 'the check-first brief has no floor');
});

test('AND THE CHECK-FIRST BRIEF IS THE ONE THAT COULD HURT SOMEBODY', () => {
  /* It is the only brief of the eighteen that could. So the floor is
   * absolute and spelled out rather than implied: a brief that said "safe
   * things" and left it there would get a paragraph about resetting a
   * breaker. */
  const check = atlasPrompt.HOME_JOBS[2];

  for (const forbidden of ['tool', 'electrical', 'gas', 'ground level', 'taken apart']) {
    assert.ok(check.toLowerCase().includes(forbidden),
      `the floor does not mention ${forbidden}`);
  }

  assert.match(check, /Do not tell anybody to attempt a repair/,
    'nothing stops the paragraph telling a reader to fix it themselves');
});

test('THE TITLE AND THE DESCRIPTION HAVE A SIXTH ANGLE', () => {
  /* Two structures leading with the same slot produce two titles of the
   * same shape with a different noun in it. Ledger leads with the business
   * name, Beacon the kind of work, Anvil the place, Quarry the problem,
   * Harbor the outcome, Atlas the thing worked on. */
  const seen = new Map();

  for (const [key, mod] of Object.entries(VOICES)) {
    const v = mod[`${key.toUpperCase()}_VOICE`] || mod.LEDGER_VOICE;

    assert.ok(v, `${key} has no voice object`);

    for (const field of ['title', 'meta']) {
      const sig = String(v[field] || '').slice(0, 70);

      assert.ok(!seen.has(sig), `${key} and ${seen.get(sig)} share a ${field} brief`);
      seen.set(sig, key);
    }
  }

  const { ATLAS_VOICE } = atlasPrompt;

  assert.match(ATLAS_VOICE.title, /Lead with the thing the work is done to/,
    'the title does not lead with the object');
  assert.match(ATLAS_VOICE.title, /do not begin with the name of the service/i,
    'the title brief does not fence off Beacon\'s angle');
  assert.match(ATLAS_VOICE.title, /Do not begin with the business name/,
    'the title brief does not fence off Ledger\'s angle');
  assert.match(ATLAS_VOICE.meta, /Say what this page covers/,
    'the description does not describe the page');
});

test('THE BUSINESS NAME IS IN BOTH, AND IS NEVER SHORTENED OR DROPPED', () => {
  /* Edwin, 30 October: "it should always appear in the title and meta
   * description." "The Austin Plumber" is the case that proves the second
   * half: told only to lead with something else, a model will happily
   * write "Austin Plumber" at the end, which is a different company. */
  const { ATLAS_VOICE } = atlasPrompt;

  for (const field of ['title', 'meta']) {
    assert.match(ATLAS_VOICE[field], /business name/,
      `the ${field} brief does not require the business name`);
    assert.match(ATLAS_VOICE[field], /exactly as it was given/,
      `the ${field} brief lets the name be rewritten`);
  }
});

test('THE DIVIDER EXEMPTION IS STATED, OR THE TWO RULES CANCEL', () => {
  /* The system prompt refuses the marketing register by name, and the
   * dividers are the one thing on the page that is MEANT to be a
   * pleasantry. Two instructions in opposite directions is how a page ends
   * up with neither. */
  const { ATLAS_VOICE } = atlasPrompt;

  assert.match(ATLAS_VOICE.extrasNote, /EXEMPT FROM THE NO-MARKETING-REGISTER RULE/);
  assert.match(ATLAS_VOICE.extrasNote, /firstBreak and secondBreak/,
    'the exemption does not name which fields it covers');
});

test('BUT THE FLOOR HOLDS, AND THIS VOICE NEEDS ONE MORE OF IT', () => {
  /* No superlative and no guarantee, on every voice. And one more here:
   * both Atlas lines name a concrete thing, and a concrete thing is where
   * an invented measurement hides most easily. */
  const { ATLAS_VOICE } = atlasPrompt;

  assert.match(ATLAS_VOICE.extrasNote, /no superlative/i);
  assert.match(ATLAS_VOICE.extrasNote, /no guarantee/i);
  assert.match(ATLAS_VOICE.extrasNote, /measurement/i,
    'the floor does not refuse an invented reading');

  for (const extra of ATLAS_VOICE.extras) {
    assert.match(extra.brief, /No exclamation mark/);
    assert.match(extra.brief, /best, fastest, cheapest or guaranteed/);
  }
});

test('AND ATLAS\'S TWO DIVIDER BRIEFS ARE NOBODY ELSE\'S', () => {
  /* Beacon's both ask for "a short, warm line"; Anvil's for a verb and
   * then for nearness; Quarry's for a place and then a time; Harbor's for
   * a person and then a thing that is not done. These ask for something
   * SENSED and then something RECORDED. */
  const seen = new Map();

  for (const [key, mod] of Object.entries(VOICES)) {
    const v = mod[`${key.toUpperCase()}_VOICE`] || mod.LEDGER_VOICE;

    for (const extra of v.extras || []) {
      const sig = extra.brief.slice(0, 60);

      assert.ok(!seen.has(sig), `${key} and ${seen.get(sig)} share a divider brief`);
      seen.set(sig, key);
    }
  }

  const [first, second] = atlasPrompt.ATLAS_VOICE.extras;

  assert.match(first.brief, /a sound or a smell/, 'the first line is not something sensed');
  assert.match(second.brief, /writes down, labels or leaves behind in writing/,
    'the second line is not something recorded');

  /* AND BOTH ARE SHORTER THAN THE OTHER VOICES ASK FOR, because this line
   * is set in a 26-character measure in the margin rather than in the
   * content column. */
  for (const extra of atlasPrompt.ATLAS_VOICE.extras) {
    assert.match(extra.brief, /four to seven words/,
      'an Atlas divider brief asks for a line too long for the margin');
  }

  assert.ok(harborPrompt.HARBOR_VOICE.extras.every(e => /six to nine words/.test(e.brief)),
    'Harbor no longer asks for six to nine, so the contrast above is stale');
});

test('AND NO BRIEF CARRIES A DOUBLE QUOTE INTO THE JSON TEMPLATE', () => {
  /* The home page's briefs are interpolated into a JSON template the model
   * is asked to fill. A double quote inside one is a broken template.
   *
   * LINES IS NOT CHECKED HERE, and Quarry's suite had to learn that:
   * those go to the system prompt as prose and legitimately quote
   * phrases. */
  const { ATLAS_VOICE } = atlasPrompt;
  const inTemplate = [
    ...ATLAS_VOICE.homeJobs,
    ATLAS_VOICE.aboutHeading,
    ATLAS_VOICE.title,
    ATLAS_VOICE.meta,
    ...ATLAS_VOICE.extras.map(e => e.brief),
  ];

  for (const text of inTemplate) {
    assert.ok(!text.includes('"'), `a brief carries a double quote: ${text.slice(0, 40)}`);
  }
});

test('AND THE ABOUT HEADING FIXES THE FIRST WORD, WHICH NOBODY ELSE DOES', () => {
  /* ⚠ THE FIRST VERSION OF THIS BRIEF WAS "a noun phrase with no verb in
   * it", WHICH IS QUARRY'S RULE. The table in prompt-atlas.js claimed a
   * sixth shape before the fourth one had been read, and the only
   * differences left were a word cap and a demand for the trade — which is
   * not a different heading, it is Quarry's with a smaller cap.
   *
   *     SIX BRIEFS THAT RHYME ARE ONE BRIEF.
   *
   * So the pairwise check below is the test that matters, and it is the one
   * that would have caught it. */
  const seen = new Map();

  for (const [key, mod] of Object.entries(VOICES)) {
    const v = mod[`${key.toUpperCase()}_VOICE`] || mod.LEDGER_VOICE;
    const sig = String(v.aboutHeading || '').slice(0, 70);

    assert.ok(!seen.has(sig), `${key} and ${seen.get(sig)} share an About heading brief`);
    seen.set(sig, key);
  }

  assert.match(atlasPrompt.ABOUT_HEADING, /MUST BEGIN with the name of the town/,
    'the heading does not begin with the town');

  /* AND IT IS NOT QUARRY'S. Quarry forbids a verb and caps the length;
   * this one says where the town goes and says nothing about either, so a
   * heading can satisfy both. */
  assert.ok(!/MUST NOT contain a verb/.test(atlasPrompt.ABOUT_HEADING),
    'Atlas\'s About heading is Quarry\'s rule again');
  assert.match(quarryPrompt.ABOUT_HEADING, /MUST NOT contain a verb/,
    'Quarry no longer forbids a verb, so the contrast above is stale');
});

test('AND THE SIX ARE NOT RECITED, BECAUSE THE TABLE IS SHOWING THEM', () => {
  /* The six names are a ruled table in the very next block, numbered, each
   * with its own line — the most explicit listing any of the structures
   * makes. A sentence naming them above it is the same list twice. */
  assert.strictEqual(atlasPrompt.ATLAS_VOICE.namesServices, false);

  const built = atlasPrompt.homePagePrompt({
    business: SITE().business, services: SITE().services, areas: SITE().areas,
  });

  assert.ok(!built.system.includes('Name the kinds of work in a sentence'),
    'Atlas is still asked to recite the six');

  /* BUT THE SIX ARE STILL GIVEN, or the page could contradict them. */
  assert.ok(`${built.system}${built.user}`.includes('drain cleaning'),
    'the six services are not given to the model at all');
});

test('AND THE LEMON-LAW PROFILE HAS AN ATLAS OF ITS OWN', () => {
  /* The profile supplies a set of home briefs PER VOICE, not one set. A
   * voice the industry has not re-aimed falls back to the trade version,
   * which on a law firm's site would ask for frozen pipes. */
  const { industryFor } = require('./utils/localOptions/industries');
  const law = industryFor('lemon law');

  assert.ok(law.homeJobs.atlas, 'lemon law has no Atlas briefs');
  assert.strictEqual(law.homeJobs.atlas.length, 3);
  assert.ok(law.aboutHeading.atlas, 'lemon law has no Atlas About heading');

  /* AND THE RE-AIM DROPPED THE WEATHER, obviously, and kept the fences. */
  const [words, when, gather] = law.homeJobs.atlas;

  assert.ok(!/weather|temperature|rainfall/i.test(when.replace(/Do not[^.]*\./g, '')),
    'the lemon-law seasons brief still asks about the weather');
  assert.match(words, /TRANSLATION ONLY/, 'the glossary brief lost its fence');
  assert.match(words, /do not name a deadline, a time limit or a cut-off/i,
    'a glossary on a law firm\'s site is naming thresholds');
  assert.match(when, /never when they must/i,
    'the timing brief does not refuse to state a deadline');
  assert.match(gather, /Do not tell anybody to stop having the vehicle repaired/,
    'the gather brief could tell an owner to stop repairs');

  /* AND NO TRADE BRIEF LEAKED IN. */
  for (const job of law.homeJobs.atlas) {
    assert.ok(!/shut-off or switch usually is in a house/.test(job),
      'a trade brief reached the lemon-law profile');
  }
});

/* ======================================================================= */

section('WHAT DESIGN 6 MEANS ON THE FORM');

test('DESIGN 6 IS THE WHOLE PACKAGE, NOT JUST THE PHOTOGRAPHS', () => {
  const six = designFor('6', CF_MODE);

  assert.ok(six, 'there is no Design 6');
  assert.strictEqual(six.structure, 'atlas');
  assert.strictEqual(six.imageSet, 'set-6');
  assert.deepStrictEqual(six.modes, [CF_MODE]);
});

test('AND IT IS OFFERED BESIDE QUARRY AND HARBOR, ON THE CLOUDFLARE DOOR ONLY', () => {
  /* SEVEN AT THAT DOOR SINCE 18 NOVEMBER — Ledger, Beacon and Anvil are
   * offered there too now. Atlas itself is still Cloudflare-only, which is
   * what the rest of this test is about. */
  assert.deepStrictEqual(designsFor(CF_MODE).map(d => d.id),
    ['1', '2', '3', '4', '5', '6', '7']);
  assert.deepStrictEqual(designsFor('localoptions').map(d => d.id), ['1', '2', '3']);

  /* A DESIGN FROM ANOTHER MODE IS AN UNKNOWN DESIGN. This is the guard
   * that was missing when Design 4 built Design 1: the door offered the
   * Cloudflare rows and the build resolved the design against the GitHub
   * mode, so it fell through to the default. */
  assert.strictEqual(designFor('6', 'localoptions'), null,
    'Design 6 resolves in the GitHub wizard, where it is not offered');
  assert.ok(designFor('6', CF_MODE), 'Design 6 does not resolve in its own mode');
});

test('every design names a structure that exists, with its own photographs', () => {
  const keys = structureKeys();
  const seen = new Set();

  for (const d of DESIGNS) {
    assert.ok(keys.includes(d.structure), `${d.label} names ${d.structure}, which does not exist`);
    assert.ok(Array.isArray(d.modes) && d.modes.length,
      `${d.label} belongs to no door`);

    const pair = `${d.structure}/${d.imageSet}`;

    assert.ok(!seen.has(pair), `two designs are both ${pair}`);
    seen.add(pair);
  }
});

test('AND A TRADE WITHOUT set-6 FALLS BACK RATHER THAN PUBLISHING FOUR GAPS', () => {
  /* Design 6 hard-names set-6, and the dropdown is the same for every
   * trade while the folders are not. available() in generate.js has
   * refused a set the chosen trade does not have since 30 October.
   *
   * ⚠ WRITTEN WHEN NO TRADE HAD A set-6, AND IT REPORTED THE SAME DAY.
   * The first version could only test the fallback half, so it asserted
   * that plumbing had no set-6 and said in the message what to do when it
   * did. Edwin added the photographs that afternoon and it failed with
   * "plumbing has a set-6 now — rewrite this the way Harbor's is".
   *
   *     A TEST PINNED TO A FACT THAT IS ABOUT TO CHANGE SHOULD SAY WHAT
   *     WOULD MAKE IT WRONG. That is twice now: Harbor's did the same
   *     thing the afternoon set-5 arrived.
   *
   * It now takes a trade that HAS a set-6 and one that does not, so
   * neither half can rot: filling lemon-law's set-6 fails the second
   * assertion, which is the same warning one step later. */
  const { completeSets } = require('./utils/localOptions/render/heroes');
  const src = require('fs').readFileSync('./utils/localOptions/generate.js', 'utf8');

  const want = designFor('6', CF_MODE).imageSet;

  assert.ok(completeSets('plumbing').includes(want),
    `plumbing has no ${want}, so the Design 6 path cannot be exercised at all`);

  assert.ok(!completeSets('lemon-law').includes(want),
    `lemon-law has a ${want} now — point this at a trade that does not`);

  assert.match(src, /function available\(trade, set, root\)/,
    'the set-availability guard is gone');
  assert.match(src, /set: available\(trade, imageSet, imagesRoot\)/,
    'the build no longer passes the requested set through the guard');

  /* AND THE GUARD'S ANSWER, not just its presence: the trade with the set
   * keeps it, the trade without falls back to the automatic pick. */
  const available = (trade, set) => (completeSets(trade).includes(set) ? set : '');

  assert.strictEqual(available('plumbing', want), want);
  assert.strictEqual(available('lemon-law', want), '',
    'a trade without the named set would publish four broken images');
});

test('AND set-6 IS A COMPLETE SET — four photographs AND their words', () => {
  /* completeSets() returns a set only when every hero is there AND
   * alt.json describes them, which is why roofing and electrician have
   * photographs and no usable set at all. A set that is in the draw with
   * no alt text publishes four pictures that say nothing to a screen
   * reader and nothing to a crawler.
   *
   * THE COVER IS AN INDEX INTO THESE FOUR, and it is what goes into the
   * LocalBusiness schema as the business's own image. A folder whose
   * pictures are reordered without its cover being moved hands the wrong
   * photograph to a search result, and nothing fails. */
  const { heroSet, HERO_COUNT } = require('./utils/localOptions/render/heroes');
  const { HERO_COUNT: SHAPE_HEROES } = require('./utils/localOptions/render/shape');
  const want = designFor('6', CF_MODE).imageSet;
  const got = heroSet('plumbing', { set: want });
  const count = HERO_COUNT || SHAPE_HEROES;

  assert.strictEqual(got.set, want);
  assert.deepStrictEqual(got.missing, [], `${want} is missing a photograph`);
  assert.strictEqual(got.found.length, HERO_COUNT || SHAPE_HEROES);

  for (let n = 1; n <= (HERO_COUNT || SHAPE_HEROES); n += 1) {
    const text = String(got.alt[n] || '');

    assert.ok(text.length > 20, `hero-${n} has no alt text worth the name`);
    /* ⚠ THE FIRST VERSION OF THIS MATCHED ONLY A BARE "photo of", and a
     * mutant reading "A photo of a plumber…" walked straight past it.
     * Nobody writes alt text starting "Photo of" without the article. */
    assert.ok(!/^(?:an?\s+)?(?:image|photo|photograph|picture)\s+of\b/i.test(text),
      `hero-${n}'s alt text opens by announcing that it is a picture`);
  }

  /* THE FOUR DESCRIPTIONS ARE OF FOUR DIFFERENT PHOTOGRAPHS. The failure
   * this is written against is a copied alt.json: four plausible sentences
   * that describe the set next door. */
  assert.strictEqual(new Set(Object.values(got.alt)).size, got.found.length,
    'two of the four descriptions are the same sentence');

  /* ⚠ READ FROM alt.json, NOT FROM heroSet(). coverFor() CLAMPS a cover it
   * does not like to 1, so `got.cover` is in range whatever the file says —
   * a mutant setting "cover": 9 survived against the resolved value. A
   * folder that states a cover nobody honours is a folder whose author
   * believes a different photograph is going into the search result. */
  const manifest = JSON.parse(require('fs').readFileSync(
    `./src/predefined-images/local-website-options/plumbing/${want}/alt.json`, 'utf8'));

  assert.ok(Number.isInteger(manifest.cover)
    && manifest.cover >= 1 && manifest.cover <= count,
  `set-6 states a cover of ${manifest.cover}, which is not one of the four`);
  assert.strictEqual(got.cover, manifest.cover,
    'the cover that was asked for is not the cover that was used');
});

test('AND THE WORDMARK HAS ATLAS\'S OWN INK, ON ATLAS\'S OWN BACKDROP', () => {
  /* ANVIL'S MISTAKE RAN ONE WAY AND QUARRY'S THE OTHER. Reading this
   * backdrop as #ffffff is the quiet version: ink mixed for white on a
   * warm off-white is not obviously wrong, merely slightly dirty. The bar
   * on this structure has no background of its own at all, so the backdrop
   * is the page. */
  const { paletteFor } = require('./utils/wordmarkLogo');
  const mine = paletteFor({ structure: 'atlas' });

  assert.strictEqual(mine.backdrop, '#faf8f3', 'the backdrop is not Atlas\'s page colour');
  assert.ok(CSS.includes('--at-page:#faf8f3'), 'the page colour changed and the palette did not');
  assert.ok(CSS.includes(`--at-ink:${mine.ink}`), 'the ink is not Atlas\'s own');
  assert.ok(CSS.includes(`--at-mark:${mine.tile}`), 'the tile is not Atlas\'s accent');

  /* AND NO TWO STRUCTURES SHARE A PALETTE, or two layouts ship one logo. */
  const seen = new Map();

  for (const key of structureKeys()) {
    const p = paletteFor({ structure: key });
    const sig = `${p.ink}/${p.tile}/${p.backdrop}`;

    assert.ok(!seen.has(sig), `${key} and ${seen.get(sig)} share a wordmark palette`);
    seen.set(sig, key);
  }
});

/* ---------------------------------------------------------------------- */

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
