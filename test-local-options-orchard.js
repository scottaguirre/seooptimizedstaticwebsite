// test-local-options-orchard.js
//
// The seventh structure, and the first that does not run straight down the
// middle.
//
// WHAT THIS SUITE IS GUARDING. All seven are served as assets/site.css to
// different sites built by the same code. The failure it exists for is not a
// crash — it is a page that renders perfectly with a stylesheet written for
// one of the other six, where every selector misses, nothing throws, and the
// site goes out as unstyled text.
//
//     A STYLESHEET AND ITS MARKUP ARE ONE CHOICE, NOT TWO.
//
// Seven structures collide forty-two ways. The isolation tests are a loop
// over every ordered pair, which is why this file did not have to add twelve
// more assertions by hand.
//
// AND WHAT IS NEW WITH THE SEVENTH: THE PAGE LEANS, AND IT IS COUNTED.
//
// Every section is a card offset to one side, alternating down the page. The
// side depends on how many sections came before it, so pages.js COUNTS — and
// that counter is the one thing in the structure that can go wrong in a way
// nothing throws over.
//
//   the alternation  Two cards leaning the same way is not a crash. It is a
//                    page that reads as a mistake, on a site nobody is
//                    looking at yet.
//   the reset        renderSite() builds eleven pages in one pass and
//                    test-site-batch.js builds three whole sites in one
//                    process. A counter that outlived a page would have page
//                    two start wherever page one stopped — and the bug would
//                    be invisible on page one, which is the one anybody
//                    checks.
//   the phone        An offset needs somewhere to offset INTO. The lean has
//                    to be the enhancement and the stack has to be the base,
//                    which is Edwin's standing rule and the order Quarry,
//                    Harbor and Atlas all follow.
//
//   node test-local-options-orchard.js

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
const orchardPrompt = require('./utils/localOptions/prompt-orchard');

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
      { heading: 'Another heading', paragraphs: ['More.'] },
    ],
  })),
  home: {
    h1: 'ignored', sub: 'Same-week appointments.',
    title: 'The Chicago Plumber', meta: 'A description.',
    aboutHeading: 'We look after pipes in Chicago', about: ['First.', 'Second.'],
    firstBreak: 'A drain camera on a reel',
    secondBreak: 'The old parts go with us',
  },
  now: new Date('2026-11-17T00:00:00Z'),
  ...over,
});

const orchard = renderSite(SITE({ structure: 'orchard' }));
const atlas = renderSite(SITE({ structure: 'atlas' }));
const harbor = renderSite(SITE({ structure: 'harbor' }));
const quarry = renderSite(SITE({ structure: 'quarry' }));
const anvil = renderSite(SITE({ structure: 'anvil' }));
const beacon = renderSite(SITE({ structure: 'beacon' }));
const ledger = renderSite(SITE({ structure: 'ledger' }));

const BUILT = { ledger, beacon, anvil, quarry, harbor, atlas, orchard };

const allOf = files => Object.entries(files)
  .filter(([path]) => path.endsWith('.html') || path.endsWith('.css'))
  .map(([, body]) => String(body)).join('\n');

const CSS = String(orchard['assets/site.css']);
const HOME = String(orchard['index.html']);
const SERVICE = String(orchard['drain-cleaning/index.html']);
const CONTACT = String(orchard['contact/index.html']);
const LEGAL = String(orchard['privacy-policy/index.html']);
const NOTFOUND = String(orchard['404.html']);

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
 * block cut out.
 *
 * NOT `css.slice(0, css.indexOf('@media'))`. That reads "everything before
 * the FIRST media query", and a rule written between two of them is
 * unconditional and invisible to it — which is how a mutant that moved
 * Atlas's margin grid into the base rules survived its first suite.
 */
function baseRules(css) {
  let out = '';
  let depth = 0;
  let inMedia = false;

  for (let i = 0; i < css.length; i += 1) {
    const c = css[i];

    if (!inMedia && 0 === depth && css.startsWith('@media', i)) {
      inMedia = true;
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

/** The lean of every row on a page, in order. */
function leansOf(html) {
  return (html.match(/orchard-row--(left|right)/g) || []).map(s => s.split('--')[1]);
}

/** Every structure's class prefix and custom-property prefix. */
const MARKS = {
  ledger: { cls: /ledger-/, prop: /--lg-/ },
  beacon: { cls: /beacon-/, prop: /--bn-/ },
  anvil: { cls: /anvil-/, prop: /--av-/ },
  quarry: { cls: /quarry-/, prop: /--qy-/ },
  harbor: { cls: /harbor-/, prop: /--hb-/ },
  atlas: { cls: /atlas-/, prop: /--at-/ },
  orchard: { cls: /orchard-/, prop: /--oc-/ },
};

const chromeSrc = require('fs')
  .readFileSync('./utils/localOptions/render/orchard/chrome.js', 'utf8');
const pagesSrc = require('fs')
  .readFileSync('./utils/localOptions/render/orchard/pages.js', 'utf8');

/* ======================================================================= */

section('SEVEN STRUCTURES, FORTY-TWO WAYS TO COLLIDE');

test('NO STRUCTURE\'S NAMES REACH ANY OTHER STRUCTURE\'S SITE', () => {
  /* Written as a loop over ordered pairs rather than by hand: two were two
   * directions, three were six, four twelve, five twenty, six thirty, seven
   * are forty-two. A hand-written list is a list that is short by twelve the
   * next time this grows. */
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

test('THE IDS DIFFER ACROSS ALL SEVEN', () => {
  /* READ OUT OF THE RENDERED HTML, NOT OUT OF THE EXPORTS. Quarry's and
   * Harbor's suites compared the three constants each structure exports —
   * and Ledger exports none; its ids are string literals in its own markup.
   * So the check could not see the oldest structure in the set, and found
   * nothing when Quarry's WHERE_ID was 'visit', which is the id sitting in
   * Ledger's pages.js.
   *
   *     A UNIQUENESS CHECK THAT READS WHAT THE STRUCTURES DECLARE
   *     CANNOT SEE THE STRUCTURE THAT DECLARES NOTHING. */
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
      assert.ok(!owner.has(id), `${key} and ${owner.get(id)} both use id="${id}"`);
      owner.set(id, key);
    }
  }

  assert.ok(owner.size >= 49, `only ${owner.size} distinct ids across seven structures`);
});

test('and the skip link points at the id this structure actually used', () => {
  const { MAIN_ID } = require('./utils/localOptions/render/orchard/chrome');

  assert.strictEqual(MAIN_ID, 'story');

  for (const path of htmlPaths(orchard)) {
    const html = String(orchard[path]);

    assert.ok(html.includes(`<a class="orchard-skip" href="#${MAIN_ID}">`),
      `${path} has no skip link to #${MAIN_ID}`);
    assert.ok(html.includes(`<main id="${MAIN_ID}"`),
      `${path} has no main carrying id ${MAIN_ID}`);
  }
});

test('and so do the contact form field ids', () => {
  /* Ledger n/p/e/m, Beacon bn/bp/be/bm, Anvil an/ap/ae/am, Quarry
   * qn/qp/qe/qm, Harbor hn/hp/he/hm, Atlas mn/mp/me/mm, Orchard on/op/oe/om. */
  for (const id of ['on', 'op', 'oe', 'om']) {
    assert.ok(CONTACT.includes(`id="${id}"`), `the contact form has no #${id}`);
    assert.ok(CONTACT.includes(`for="${id}"`), `nothing labels #${id}`);
  }

  for (const taken of ['mn', 'hn', 'qn', 'an', 'bn']) {
    assert.ok(!CONTACT.includes(`id="${taken}"`),
      `Orchard's contact form carries ${taken}, which is another structure's`);
  }
});

test('A STYLESHEET NEVER ARRIVES WITHOUT ITS OWN MARKUP', () => {
  for (const key of structureKeys()) {
    const s = structureFor(key);

    assert.strictEqual(s.key, key);
    assert.ok(s.css.includes(`.${s.prefix}`), `${key}'s css has no ${s.prefix} rule`);
    assert.ok(s.pages && s.prompt, `${key} is missing a half`);
  }

  assert.deepStrictEqual(structureKeys(),
    ['ledger', 'beacon', 'anvil', 'quarry', 'harbor', 'atlas', 'orchard']);
});

test('AND A TYPO FALLS BACK TO ALL SEVEN HALVES OF ONE', () => {
  /* structureFor() looks the PARTS up by the RESOLVED key, not by the string
   * that came in. structureFor('orchrd') returns Ledger, and it has to
   * return Ledger's pages with it — a stylesheet from one structure and
   * markup from another renders a page where every selector misses and
   * nothing throws. */
  const typo = structureFor('orchrd');

  assert.strictEqual(typo.key, 'ledger');
  assert.strictEqual(typo.pages, structureFor('ledger').pages);
  assert.strictEqual(typo.prompt, structureFor('ledger').prompt);
  assert.ok(!typo.css.includes('.orchard-'), 'a typo got Orchard\'s stylesheet');
});

test('and every class the markup emits has a rule, both ways round', () => {
  /* SCANNED AS TOKENS, NOT AS class="..." ATTRIBUTES. Harbor's first version
   * read the attributes and broke on a template interpolation inside one of
   * them. Comments are stripped from both sides, so a rule only MENTIONED in
   * an explanation does not count as written. */
  const markup = new Set(
    `${codeOnly(chromeSrc)}${codeOnly(pagesSrc)}`.match(/orchard-[a-z0-9_-]+/g) || [],
  );
  const styled = new Set(
    (cssOnly(CSS).match(/\.orchard-[a-z0-9_-]+/g) || []).map(s => s.slice(1)),
  );

  assert.ok(markup.size > 30, `only ${markup.size} orchard- classes in the markup`);

  for (const cls of markup) {
    assert.ok(styled.has(cls), `.${cls} is emitted and has no rule`);
  }

  for (const cls of styled) {
    assert.ok(markup.has(cls), `.${cls} has a rule and is emitted by nothing`);
  }
});

/* ======================================================================= */

section('THE PAGE LEANS, AND THE COUNT IS THE WHOLE STRUCTURE');

test('EVERY ROW ALTERNATES, ON EVERY PAGE', () => {
  /* Two cards leaning the same way is not a crash. It is a page that reads
   * as a mistake, on a site nobody is looking at yet. */
  for (const path of htmlPaths(orchard)) {
    const leans = leansOf(String(orchard[path]));

    assert.ok(leans.length, `${path} has no leaning rows at all`);

    for (let i = 1; i < leans.length; i += 1) {
      assert.notStrictEqual(leans[i], leans[i - 1],
        `${path} leans ${leans[i]} twice in a row, at position ${i + 1}`);
    }
  }
});

test('AND EVERY PAGE STARTS FROM THE SAME SIDE', () => {
  /* ⚠ THE COUNTER IS PER PAGE, AND THIS IS THE TEST THAT SAYS SO.
   *
   * renderSite() builds eleven pages in one pass and test-site-batch.js
   * builds three whole sites in one process. A module-level counter would
   * have page two start wherever page one stopped — and page one would look
   * perfect, which is the page anybody checks.
   *
   *     A RENDERER THAT REMEMBERS ANYTHING BETWEEN CALLS
   *     RENDERS A DIFFERENT SITE ON THE SECOND RUN. */
  for (const path of htmlPaths(orchard)) {
    assert.strictEqual(leansOf(String(orchard[path]))[0], 'left',
      `${path} starts leaning the wrong way, so a counter outlived a page`);
  }
});

test('AND A SECOND RENDER IS IDENTICAL TO THE FIRST', () => {
  /* The same thing from the other side: if the count leaked, building the
   * site twice in one process would produce two different sites. */
  const again = renderSite(SITE({ structure: 'orchard' }));

  for (const path of Object.keys(orchard)) {
    assert.strictEqual(String(again[path]), String(orchard[path]), `${path} differs`);
  }
});

test('and the side is decided by the caller, not counted inside row()', () => {
  /* row() takes `side` as an argument. A counter inside it would be state
   * shared between every page in a render — the bug the two tests above are
   * written against, at its source. */
  const { row } = require('./utils/localOptions/render/orchard/chrome');

  assert.ok(row({ side: 'left' }).includes('orchard-row--left'));
  assert.ok(row({ side: 'right' }).includes('orchard-row--right'));

  /* CALLED TWICE WITH THE SAME ARGUMENT, THE SAME ANSWER. */
  assert.strictEqual(row({ side: 'left', body: 'x' }), row({ side: 'left', body: 'x' }));

  /* AND ANYTHING THAT IS NOT 'right' LEANS LEFT, rather than emitting a
   * class with no rule behind it. */
  assert.ok(row({}).includes('orchard-row--left'));
  assert.ok(row({ side: 'sideways' }).includes('orchard-row--left'));
});

test('leaning() hands out left, right, left — and a new one starts over', () => {
  const { leaning } = require('./utils/localOptions/render/orchard/pages');
  const a = leaning();

  assert.deepStrictEqual([a(), a(), a(), a()], ['left', 'right', 'left', 'right']);

  const b = leaning();

  assert.strictEqual(b(), 'left', 'a fresh counter did not start from the left');
});

test('THE LEAN ARRIVES AT 900px AND NOWHERE BELOW IT', () => {
  /* Edwin's standing rule: mobile first. An offset needs somewhere to offset
   * INTO, and a 360px screen has none — a card squeezed to 86% of it is not
   * a design, it is a margin somebody forgot to remove. */
  const bare = cssOnly(CSS);
  const wide = mediaBlock(bare, '(min-width:900px)');

  assert.ok(wide, 'there is no 900px block');
  assert.match(wide, /\.orchard-row--left \.orchard-card\{margin-right:var\(--oc-lean\)/,
    'the left lean is not in the 900px block');
  assert.match(wide, /\.orchard-row--right \.orchard-card\{margin-left:var\(--oc-lean\)/,
    'the right lean is not in the 900px block');

  const base = baseRules(bare);

  assert.ok(!base.includes('var(--oc-lean)'),
    'the lean applies at every width, so a phone gets an offset card');

  /* AND THE HELPER IS NOT VACUOUS: it must still be returning the phone's
   * rules, or the assertion above passes on an empty string. */
  assert.ok(base.includes('.orchard-card{background:'), 'baseRules() dropped the base rules');
  assert.ok(!base.includes('@media'), 'baseRules() left a media query in');
});

test('AND EVERY MEDIA QUERY IS min-width, SO THE PHONE IS THE BASE', () => {
  const queries = cssOnly(CSS).match(/@media[^{]+/g) || [];

  assert.ok(queries.length >= 2, `only ${queries.length} media queries`);

  for (const q of queries) {
    assert.ok(q.includes('min-width'), `a query is not min-width: ${q.trim()}`);
    assert.ok(!q.includes('max-width'), `a query is max-width: ${q.trim()}`);
  }
});

test('THE PHOTOGRAPH DOES NOT LEAN', () => {
  /* A picture that also leaned would make the page look like it was falling
   * over rather than alternating. */
  assert.ok(HOME.includes('<figure class="orchard-plate">'), 'there is no plate');

  const plate = between(HOME, '<figure class="orchard-plate">', '</figure>');

  assert.ok(!plate.includes('orchard-row'), 'the plate is inside a leaning row');
  assert.ok(!cssOnly(CSS).includes('.orchard-plate{margin-right'),
    'the plate was given a lean');
});

test('AND THE TITLE IS CENTRED, WHICH NO OTHER STRUCTURE DOES', () => {
  /* The sections lean left and right by turns, so there is no single edge
   * for a title to hang from — ranging it left would pick a side before the
   * zigzag has started. */
  assert.match(cssOnly(CSS), /\.orchard-top\{[^}]*text-align:center/,
    'the masthead is not centred');

  for (const path of htmlPaths(orchard)) {
    assert.strictEqual(String(orchard[path]).split('<h1>').length - 1, 1,
      `${path} has more than one h1`);
  }
});

/* ======================================================================= */

section('THE SERVICES, THE HOURS AND THE BREAK');

test('THE SERVICES ARE TWO UP WITH THE NUMBER DRAWN LARGE', () => {
  /* Ledger numbers two columns, Beacon lays out three-up tiles, Anvil stacks
   * rungs, Quarry sticks an index beside the blurbs, Harbor runs a
   * definition list, Atlas rules a table. Two-up with an outlined numeral is
   * the shape left, and the numeral is what stops it being Beacon with one
   * tile removed. */
  assert.ok(HOME.includes('<ul class="orchard-grove">'), 'the services are not a grove');

  const grove = between(HOME, '<ul class="orchard-grove">', '</ul>');

  assert.strictEqual(grove.split('orchard-fruit"').length - 1
    + grove.split('orchard-fruit orchard-fruit--flat').length - 1, 6,
  'there are not six services');

  for (let i = 1; i <= 6; i += 1) {
    assert.ok(grove.includes(`>${String(i).padStart(2, '0')}</span>`),
      `service ${i} is not numbered`);
  }

  const mid = mediaBlock(cssOnly(CSS), '(min-width:620px)');

  assert.match(mid, /\.orchard-grove\{grid-template-columns:1fr 1fr/,
    'the grid is never two columns');
});

test('AND THE NUMBER IS HIDDEN FROM A SCREEN READER', () => {
  /* It repeats the order the list is already in, so reading it out loud is
   * "oh one, drain cleaning" — noise in front of every item. */
  const grove = between(HOME, '<ul class="orchard-grove">', '</ul>');

  assert.ok(!/class="orchard-fruit__num">/.test(grove.replace(/aria-hidden="true"/g, '')),
    'the decorative number is announced');
  assert.strictEqual(grove.split('aria-hidden="true"').length - 1, 6,
    'not every number is hidden');
});

test('THE RING STILL CAPS THE BODY AT TWO LINKED SERVICES', () => {
  const { HOME_BODY_LINKS } = require('./utils/localOptions/render/shape');
  const grove = between(HOME, '<ul class="orchard-grove">', '</ul>');
  const links = grove.split('<h3><a href=').length - 1;

  assert.strictEqual(links, HOME_BODY_LINKS,
    `${links} linked services against a cap of ${HOME_BODY_LINKS}`);

  assert.strictEqual(grove.split('orchard-fruit--flat').length - 1, 4,
    'the four unlinked services are not marked');
  assert.match(cssOnly(CSS), /\.orchard-fruit--flat h3\{color:/,
    'the muted service has no rule, so it looks the same as a linked one');
});

test('THE HOURS ARE A CHIP A DAY, AND A CLOSED DAY SAYS SO', () => {
  /* The seventh answer and the only one that reflows: seven chips wrap like
   * words at any width, where a band or a table has to be told what to do at
   * every breakpoint. */
  const { hours } = require('./utils/localOptions/render/orchard/chrome');
  const html = hours({ hours: SITE().hours });

  assert.match(html, /^<ul class="orchard-week">/, 'the hours are not a chip list');
  assert.strictEqual(html.split('orchard-chip"').length - 1
    + html.split('orchard-chip orchard-chip--shut').length - 1, 7,
  'there are not seven chips');

  assert.match(html, /Monday<\/span>\s*<span class="orchard-chip__when">7:00 AM – 6:00 PM/);
  assert.match(html, /orchard-chip--shut[\s\S]*?Sunday[\s\S]*?Closed/,
    'a closed day is not marked closed');

  assert.ok(!html.includes('<table'), 'the hours are a table');
  assert.match(cssOnly(CSS), /\.orchard-week\{[^}]*flex-wrap:wrap/,
    'the chips cannot reflow, which is the whole reason they are chips');
});

test('and on the phone every chip takes the whole row', () => {
  /* LEFT TO WRAP ON ITS OWN THE LIST CAME OUT RAGGED. Measured in a browser
   * at 360 and 390: a chip holding "7:00 AM - 6:00 PM" wants about 166px and
   * the list has 287, so five days sat alone and then Saturday paired with
   * Sunday — because "Closed" is short, not because anybody chose it. Two
   * only fit if the time drops to 12px, and the time is what the page is
   * being read for. So the phone gets a full-width chip seven times, which
   * is a decision, and the width where two genuinely fit gets the wrapping
   * pills back. */
  assert.match(baseRules(cssOnly(CSS)), /\.orchard-chip\{[^}]*flex:1 1 100%/,
    'a chip does not fill the row on the phone, so the week wraps ragged');
  assert.match(mediaBlock(cssOnly(CSS), '(min-width:620px)'),
    /\.orchard-chip\{[^}]*flex:0 1 auto/,
    'the chips are never let go, so they are full-width bars at every width');
});

test('and no hours at all renders nothing', () => {
  /* An empty strip under a heading is worse than no strip. */
  const { hours } = require('./utils/localOptions/render/orchard/chrome');

  assert.strictEqual(hours({ hours: [] }), '');
  assert.strictEqual(hours({}), '');
  assert.strictEqual(hours({ hours: [null, undefined] }), '');
});

test('THE BREAK SITS IN THE MIDDLE, BETWEEN TWO RULES', () => {
  /* Beacon's break is a deep band, Anvil's a raised band, Quarry's a
   * hairline with the sentence under it, Harbor's a sentence with the rule
   * under that, Atlas's a sentence in the margin with no rule. Centred
   * between two rules is the shape left, and the only one that does not pick
   * a side between two cards leaning opposite ways. */
  assert.strictEqual(HOME.split('class="orchard-break"').length - 1, 2,
    'the home page does not have two dividers');
  assert.ok(HOME.includes('A drain camera on a reel'), 'the first line is missing');
  assert.ok(HOME.includes('The old parts go with us'), 'the second line is missing');

  const first = between(HOME, '<div class="orchard-break">', '</div>');

  assert.strictEqual(first.split('orchard-break__rule').length - 1, 2,
    'the break does not have a rule on each side');
  assert.match(first, /<p>/, 'the divider line is not a paragraph');
  assert.ok(!/<h[1-6]/.test(first), 'the divider is a heading');

  assert.match(cssOnly(CSS), /\.orchard-break\{[^}]*justify-content:center/,
    'the break is not centred');
});

test('AND A SITE BUILT BEFORE THEY EXISTED RENDERS NO EMPTY BREAK', () => {
  const { divider } = require('./utils/localOptions/render/orchard/chrome');

  assert.strictEqual(divider({}), '');
  assert.strictEqual(divider({ line: '' }), '');
  assert.strictEqual(divider({ line: '   ' }), '');
  assert.strictEqual(divider({ line: null }), '');

  const bare = renderSite(SITE({
    structure: 'orchard',
    home: { ...SITE().home, firstBreak: '', secondBreak: '' },
  }));

  assert.ok(!String(bare['index.html']).includes('orchard-break'),
    'a site with no divider lines still renders the blocks');

  /* AND THE ZIGZAG SURVIVES LOSING THEM. The dividers sit between cards, so
   * removing them must not leave two cards leaning the same way. */
  const leans = leansOf(String(bare['index.html']));

  for (let i = 1; i < leans.length; i += 1) {
    assert.notStrictEqual(leans[i], leans[i - 1],
      'removing the dividers broke the alternation');
  }
});

/* ======================================================================= */

section('THE SAME SITE, DIFFERENTLY DRESSED');

test('ALL SEVEN BUILD THE SAME FILES, DOWN TO THE PATHS', () => {
  for (const [key, files] of Object.entries(BUILT)) {
    assert.deepStrictEqual(Object.keys(files).sort(), Object.keys(orchard).sort(),
      `${key} and Orchard do not build the same files`);
  }

  assert.strictEqual(htmlPaths(orchard).length, 12);
  assert.strictEqual(Object.keys(orchard).length, 16);
});

test('and every service page carries the same sections', () => {
  for (const slug of SLUGS) {
    const page = String(orchard[`${slug}/index.html`] || '');

    assert.ok(page, `${slug} was not built`);
    assert.ok(page.includes('orchard-top'), `${slug} has no title block`);
    assert.ok(page.includes('orchard-row'), `${slug} has no sections`);
    assert.ok(page.includes('orchard-onward'), `${slug} does not pass the reader on`);
    assert.ok(page.includes('orchard-week'), `${slug} has no hours`);
  }
});

test('the Search Console tag is on every page', () => {
  for (const path of htmlPaths(orchard)) {
    assert.ok(String(orchard[path]).includes('google-site-verification'),
      `${path} has no verification tag`);
  }
});

test('AND THE LOGO, STYLESHEET AND PHOTOGRAPH ARE RE-BASED FOR DEPTH', () => {
  assert.ok(HOME.includes('href="assets/site.css"'), 'the home page css is not relative');
  assert.ok(SERVICE.includes('href="../assets/site.css"'), 'the service page css is not re-based');
  assert.ok(SERVICE.includes('src="../assets/logo.png"'), 'the logo is not re-based');
  assert.ok(SERVICE.includes('src="../assets/hero-2.webp"'), 'the hero is not re-based');

  assert.ok(NOTFOUND.includes('href="/assets/site.css"'), 'the 404 css is not absolute');
  assert.ok(NOTFOUND.includes('href="/drain-cleaning/"'), 'the 404 links are not absolute');
});

test('the hero is eager and high priority', () => {
  assert.match(HOME, /loading="eager" fetchpriority="high"/);
});

test('A PAGE WITH NO PHOTOGRAPH STILL HAS ITS HEADING', () => {
  assert.ok(!LEGAL.includes('orchard-plate'), 'a legal page carries a photograph');
  assert.match(LEGAL, /<h1>Privacy Policy<\/h1>/, 'the legal page lost its heading');
  assert.ok(!NOTFOUND.includes('orchard-plate'), 'the 404 carries a photograph');
});

test('AND A LEGAL PAGE LEANS LIKE THE REST OF THE SITE', () => {
  /* On five of the seven a legal page is a heading and a wall of prose — the
   * one page of the site that does not look like the site. */
  assert.ok(leansOf(LEGAL).length >= 2, 'the legal page does not use the page\'s own rhythm');
});

test('the schema and the canonical are untouched by the layout', () => {
  const ld = JSON.parse(between(HOME, '<script type="application/ld+json">', '</script>')
    .replace('<script type="application/ld+json">', ''));

  assert.strictEqual(ld['@context'], 'https://schema.org');
  assert.strictEqual(ld.name, 'The Chicago Plumber');

  for (const [key, files] of Object.entries(BUILT)) {
    const theirs = between(String(files['index.html']),
      '<script type="application/ld+json">', '</script>')
      .replace('<script type="application/ld+json">', '');

    assert.deepStrictEqual(JSON.parse(theirs), ld, `${key}'s schema differs from Orchard's`);
  }

  assert.ok(SERVICE.includes('"@type":"Service"'), 'a service page lost its schema');
  assert.ok(!LEGAL.includes('application/ld+json'), 'a legal page carries schema');
});

test('AND THE 404 IS NOINDEX, WITH ITS CANONICAL ON THE HOME PAGE', () => {
  assert.ok(NOTFOUND.includes('<meta name="robots" content="noindex">'), 'the 404 is indexable');
  assert.ok(NOTFOUND.includes('rel="canonical" href="https://the-chicago-plumber.9-x.org/"'),
    'the 404 canonical does not point at the home page');
});

test('NO PAGE CARRIES AN HTML COMMENT AT ALL', () => {
  for (const path of htmlPaths(orchard)) {
    assert.ok(!String(orchard[path]).includes('<!--'), `${path} carries an HTML comment`);
  }
});

test('AND THE MENU WORKS WITH NO JAVASCRIPT', () => {
  for (const path of htmlPaths(orchard)) {
    assert.ok(!/<script(?![^>]*application\/ld\+json)/.test(String(orchard[path])),
      `${path} carries a script that is not schema`);
  }

  assert.ok(!HOME.includes('<details'), 'the bar has a disclosure');

  const nav = between(HOME, '<nav class="orchard-nav"', '</nav>');

  for (const slug of SLUGS) {
    assert.ok(nav.includes(`href="${slug}/"`), `the bar does not link ${slug}`);
  }
});

test('and the page you are on is marked in the bar', () => {
  assert.ok(between(SERVICE, '<nav class="orchard-nav"', '</nav>')
    .includes('href="../drain-cleaning/" aria-current="page"'),
  'the service page is not marked in its own menu');
  assert.match(cssOnly(CSS), /\.orchard-nav a\[aria-current\]/,
    'the marked link has no rule');
});

test('THE SENTENCE ABOVE THE SERVICES IS WRITTEN FOR A CUSTOMER', () => {
  const { defaultServicesLede } = require('./utils/localOptions/render/orchard/pages');
  const lede = defaultServicesLede();

  assert.ok(!/\bpage\b/i.test(lede), 'the lede talks about pages');
  assert.ok(!/\bsite\b/i.test(lede), 'the lede talks about the site');
  assert.ok(HOME.includes(lede), 'the lede is not on the page');
});

test('and it counts the services from the constant, never in typed prose', () => {
  /* READING THE FUNCTION'S SOURCE, NOT ITS OUTPUT. A mutant that typed the
   * word out would produce exactly the right string, which is how one
   * survived Quarry's suite. */
  const { SERVICE_COUNT, inWords } = require('./utils/localOptions/render/shape');
  const { defaultServicesLede } = require('./utils/localOptions/render/orchard/pages');
  const src = codeOnly(defaultServicesLede.toString());

  assert.ok(src.includes('inWords(SERVICE_COUNT)'),
    'the lede does not read the count from the constant');
  assert.ok(!src.includes(`'${inWords(SERVICE_COUNT)}'`),
    'the count is also typed out beside the constant');
  assert.ok(defaultServicesLede().includes(inWords(SERVICE_COUNT)),
    'the count does not reach the sentence');
});

test('AND THE OWNER CAN REPLACE IT, OR TAKE IT AWAY', () => {
  const { defaultServicesLede } = require('./utils/localOptions/render/orchard/pages');

  const edited = renderSite(SITE({
    structure: 'orchard',
    home: { ...SITE().home, servicesLede: 'Our own words.' },
  }));

  assert.ok(String(edited['index.html']).includes('Our own words.'));
  assert.ok(!String(edited['index.html']).includes(defaultServicesLede()));

  const cleared = renderSite(SITE({
    structure: 'orchard',
    home: { ...SITE().home, servicesLede: '' },
  }));

  assert.ok(!String(cleared['index.html']).includes('orchard-said'),
    'a cleared lede still renders its paragraph');
  assert.ok(String(cleared['index.html']).includes('<ul class="orchard-grove">'),
    'clearing the lede took the services with it');
});

test('AND THE FIRST MENTION OF THE BUSINESS ON A SERVICE PAGE LINKS HOME', () => {
  assert.ok(SERVICE.includes('<a href="../">The Chicago Plumber</a>'),
    'the first mention is not linked home');
  assert.strictEqual(SERVICE.split('<a href="../">The Chicago Plumber</a>').length - 1, 1,
    'more than the first mention was linked');
});

test('the contact form is markup only, and the number is beside it', () => {
  assert.ok(CONTACT.includes('action="REPLACE_WITH_YOUR_FORM_ENDPOINT"'),
    'the form action does not announce itself as a placeholder');

  const form = between(CONTACT, '<form class="orchard-form"', '</form>');

  assert.ok(form.includes('href="tel:+13125550164"'), 'the form has no phone number beside it');
});

test('THE FOOTER MODIFIERS OUTRANK THE SHORTHAND ABOVE THEM', () => {
  /* ⚠ FOUR RULES WERE BEING SILENTLY UNDONE, AND A SCREENSHOT FOUND IT.
   *
   * `.orchard-foot p { margin: 0 0 .5rem }` is a class and a type together
   * — specificity (0,1,1) — and each modifier under it was one class,
   * (0,1,0). So the shorthand won and set all four sides: the address lost
   * its auto margins and sat left of centre in a centred footer, and the
   * icons, the page links and the copyright all lost their margin-top.
   *
   *     ONE SHORTHAND ON A MORE SPECIFIC SELECTOR SILENTLY UNDID
   *     FOUR RULES WRITTEN UNDERNEATH IT.
   *
   * The same trap as the bar at the top of the block in a different coat:
   * there it was source order, here specificity, and both times the
   * property nobody mentioned is the one that moved.
   *
   * ASSERTED AS "EACH ONE CARRIES THE BLOCK NAME", which is what makes them
   * win. Checking the declarations would pass against the broken version —
   * they were all there, they just lost. */
  const bare = cssOnly(CSS);

  for (const name of ['orchard-foot__name', 'orchard-foot__where',
    'orchard-foot__links', 'orchard-marks', 'orchard-foot__base']) {
    assert.ok(bare.includes(`.orchard-foot .${name}{`),
      `.${name} is not qualified, so .orchard-foot p overrides its margins`);
  }

  /* AND THE SHORTHAND IS STILL THERE, so this is not passing because the
   * rule it has to beat was deleted instead. */
  assert.match(bare, /\.orchard-foot p\{margin:/,
    'the base paragraph margin is gone, so the qualifying above is pointless');
});

test('and the fields are 16px, or the phone zooms and does not zoom back', () => {
  const bare = cssOnly(CSS);
  const rule = between(bare, '.orchard-form input,.orchard-form textarea{', '}');
  const sizes = rule.match(/font-size:[^;}]+/g) || [];

  assert.ok(sizes.length, 'the form fields have no font-size at all');
  assert.strictEqual(sizes[sizes.length - 1], 'font-size:16px',
    `the field's effective font-size is ${sizes[sizes.length - 1]}`);
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
  orchard: orchardPrompt,
};

/** The voice object a module exports, whatever it is called. */
function voiceOf(key, mod) {
  return mod[`${key.toUpperCase()}_VOICE`] || mod.LEDGER_VOICE;
}

test('ORCHARD IS A VOICE, NOT A SEVENTH COPY OF THE RULES', () => {
  const src = require('fs').readFileSync('./utils/localOptions/prompt-orchard.js', 'utf8');

  assert.ok(src.includes("require('./prompt')"), 'the voice does not build on the shared rules');
  assert.ok(!src.includes('spellingFor('), 'the voice redefines the spelling rule');
  assert.strictEqual(orchardPrompt.SECTIONS, ledgerPrompt.SECTIONS,
    'Orchard exports a different section list, which is a different product');
});

test('NO TWO OF THE SEVEN SHARE ANY BRIEF', () => {
  /* ⚠ THE CHECK ATLAS'S FIRST VERSION DID NOT HAVE, and it shipped an About
   * heading that was Quarry's rule with a different cap on it — claimed as a
   * new shape in its own comment for a fortnight.
   *
   *     SEVEN BRIEFS THAT RHYME ARE ONE BRIEF.
   *
   * Every axis, pairwise, in one loop — so an eighth structure cannot add a
   * near-copy of any of the seven without this saying which. */
  const bags = {
    'word budget': new Map(),
    'home lengths': new Map(),
    title: new Map(),
    meta: new Map(),
    'about heading': new Map(),
    'first divider': new Map(),
    'second divider': new Map(),
    'style lines': new Map(),
  };

  const add = (bag, sig, key) => {
    assert.ok(!bags[bag].has(sig),
      `${key} and ${bags[bag].get(sig)} share a ${bag}`);
    bags[bag].set(sig, key);
  };

  for (const [key, mod] of Object.entries(VOICES)) {
    const v = voiceOf(key, mod);
    const w = mod.WORDS || v.words;
    const h = mod.HOME || v.home;

    add('word budget', `${w.min}-${w.max}`, key);
    add('home lengths', `${h.sub.join('-')}/${h.about.join('-')}`, key);
    add('title', String(v.title).slice(0, 70), key);
    add('meta', String(v.meta).slice(0, 70), key);
    add('about heading', String(v.aboutHeading).slice(0, 70), key);

    if (mod.LINES) add('style lines', mod.LINES.join('|'), key);

    const ex = v.extras || [];

    if (ex[0]) add('first divider', String(ex[0].brief).slice(0, 60), key);
    if (ex[1]) add('second divider', String(ex[1].brief).slice(0, 60), key);
  }
});

test('AND THE TWENTY-ONE HOME BRIEFS ARE TWENTY-ONE DIFFERENT SUBJECTS', () => {
  /* Edwin built one site in each of the first two structures and set the
   * home pages beside each other: same three subjects, same order, and both
   * third paragraphs opened "A visit starts with". */
  const seen = new Map();

  for (const [key, mod] of Object.entries(VOICES)) {
    const jobs = mod.HOME_JOBS || voiceOf(key, mod).homeJobs;

    assert.ok(jobs && 3 === jobs.length, `${key} does not have three home briefs`);

    for (const job of jobs) {
      const sig = job.slice(0, 55);

      assert.ok(!seen.has(sig), `${key} and ${seen.get(sig)} open a brief identically`);
      seen.set(sig, key);
    }
  }

  assert.strictEqual(seen.size, 21);
});

test('its word budget reaches the home page, not just the service pages', () => {
  /* THIS WAS THE BUG BEACON SHIPPED. Its first version set only the
   * service-page budget, so its home page came out exactly as long as
   * Ledger's — caught by putting the two built pages side by side. */
  const built = orchardPrompt.homePagePrompt({
    business: SITE().business, services: SITE().services, areas: SITE().areas,
  });
  const text = `${built.system}\n${built.user}`;

  for (const n of [...orchardPrompt.HOME.sub, ...orchardPrompt.HOME.about]) {
    assert.ok(text.includes(String(n)), `the home prompt never mentions ${n}`);
  }
});

test('the service page prompt carries Orchard\'s lines and its length', () => {
  const built = orchardPrompt.servicePagePrompt({
    business: SITE().business, service: SITE().services[0], areas: SITE().areas,
  });

  for (const line of orchardPrompt.LINES) {
    if (!line) continue;

    assert.ok(built.system.includes(line), `a voice line is missing: ${line.slice(0, 40)}`);
  }

  assert.ok(built.system.includes('560'), 'the minimum is not in the prompt');
  assert.ok(built.system.includes('690'), 'the maximum is not in the prompt');
});

test('THE SPOKEN RULE NAMES THE WORDS IT FORBIDS', () => {
  /* "Be conversational" produces prose that is merely shorter. Naming the
   * register words that may not appear is what actually moves it, because
   * those words are how a model writes a trade page when nobody has said
   * otherwise. */
  const text = orchardPrompt.LINES.join('\n');

  assert.match(text, /SAY IT, DO NOT WRITE IT/, 'the rule is not stated');

  for (const word of ['utilise', 'leverage', 'ensure', 'facilitate', 'comprehensive',
    'seamless', 'bespoke', 'robust', 'holistic']) {
    assert.ok(text.includes(word), `the banned list does not name ${word}`);
  }

  assert.match(text, /contractions/, 'nothing asks for the register it wants');
  assert.match(text, /twenty-five words/, 'there is no cap on a sentence');
});

test('THE TITLE IS A QUESTION, AND THE DESCRIPTION ANSWERS IT', () => {
  /* Ledger leads with the business name, Beacon the kind of work, Anvil the
   * place, Quarry the problem, Harbor the outcome, Atlas the thing worked
   * on. A question is not another slot — it is a different sentence, which
   * is why it is still available after six. */
  const { ORCHARD_VOICE } = orchardPrompt;

  assert.match(ORCHARD_VOICE.title, /MUST be a question/, 'the title is not a question');
  assert.match(ORCHARD_VOICE.title, /end with a question mark/,
    'nothing makes the question a question');
  assert.match(ORCHARD_VOICE.meta, /MUST answer the question asked in the title/,
    'the description does not answer the title');

  /* AND THE QUESTION MAY NOT BE ABOUT PRICE. It is the question most often
   * typed and the one this site cannot answer — a page that asks it and
   * then does not say is worse than one that never asked. */
  assert.match(ORCHARD_VOICE.title, /NOT be about price/, 'the title may ask about price');
  assert.match(ORCHARD_VOICE.meta, /do not mention price/, 'the description may discuss price');
  assert.match(ORCHARD_VOICE.meta, /do not ask another question/,
    'the description may ask instead of answer');
});

test('THE BUSINESS NAME IS IN BOTH, AND IS NEVER SHORTENED OR DROPPED', () => {
  /* Edwin, 30 October: "it should always appear in the title and meta
   * description." "The Austin Plumber" is the case that proves the second
   * half: told only to lead with something else, a model will happily write
   * "Austin Plumber" at the end, which is a different company. */
  const { ORCHARD_VOICE } = orchardPrompt;

  for (const field of ['title', 'meta']) {
    assert.match(ORCHARD_VOICE[field], /business name/,
      `the ${field} brief does not require the business name`);
    assert.match(ORCHARD_VOICE[field], /exactly as it was given/,
      `the ${field} brief lets the name be rewritten`);
  }
});

test('THE ABOUT HEADING DEMANDS THE FIRST PERSON, WHICH THREE OTHERS FORBID', () => {
  const { ABOUT_HEADING } = orchardPrompt;

  assert.match(ABOUT_HEADING, /using the word we or us/, 'it does not demand the first person');
  assert.match(ABOUT_HEADING, /NOT begin with the words We are/,
    'Ledger\'s known-bad output is not banned');

  /* AND THE THREE THAT FORBID IT STILL DO, so the contrast is not stale. */
  for (const key of ['beacon', 'anvil', 'atlas']) {
    assert.match(voiceOf(key, VOICES[key]).aboutHeading, /\bWe\b/,
      `${key} no longer mentions We, so the inversion above means nothing`);
  }
});

test('AND NO BRIEF CARRIES A DOUBLE QUOTE INTO THE JSON TEMPLATE', () => {
  /* The home page's briefs are interpolated into a JSON template the model
   * is asked to fill. A double quote inside one is a broken template.
   *
   * LINES IS NOT CHECKED HERE, and Quarry's suite had to learn that: those
   * go to the system prompt as prose and legitimately quote phrases. */
  const { ORCHARD_VOICE } = orchardPrompt;
  const inTemplate = [
    ...ORCHARD_VOICE.homeJobs,
    ORCHARD_VOICE.aboutHeading,
    ORCHARD_VOICE.title,
    ORCHARD_VOICE.meta,
    ...ORCHARD_VOICE.extras.map(e => e.brief),
  ];

  for (const text of inTemplate) {
    assert.ok(!text.includes('"'), `a brief carries a double quote: ${text.slice(0, 40)}`);
  }
});

test('THE DIVIDER EXEMPTION IS STATED, AND THE FLOOR HOLDS', () => {
  const { ORCHARD_VOICE } = orchardPrompt;

  assert.match(ORCHARD_VOICE.extrasNote, /EXEMPT FROM THE NO-MARKETING-REGISTER RULE/);
  assert.match(ORCHARD_VOICE.extrasNote, /firstBreak and secondBreak/,
    'the exemption does not name which fields it covers');
  assert.match(ORCHARD_VOICE.extrasNote, /no superlative/i);
  assert.match(ORCHARD_VOICE.extrasNote, /no guarantee/i);

  /* AND ONE MORE FLOOR THIS VOICE NEEDS: the second line is about clearing
   * up, which is one word from claiming the business always leaves a place
   * spotless — a promise on behalf of every future visit. */
  assert.match(ORCHARD_VOICE.extrasNote, /promise what will happen on a future visit/,
    'nothing stops the clearing-up line becoming a promise');
});

test('AND THE PRICE BRIEF REFUSES EVERY SHAPE OF A NUMBER', () => {
  /* The second home brief explains why two jobs differ, which is the
   * question behind every "how much is it" call. Explaining the variables
   * is useful; naming a figure is quoting, from a page that cannot. */
  const why = orchardPrompt.HOME_JOBS[1];

  for (const banned of ['no price', 'no range', 'no hourly rate', 'no minimum']) {
    assert.ok(why.includes(banned), `the price fence does not say "${banned}"`);
  }

  assert.match(why, /costs more or less than another/,
    'one service may still be called dearer than another');

  const after = orchardPrompt.HOME_JOBS[2];

  assert.match(after, /do not claim this business always does any of it/,
    'the quality brief can become a boast');
  assert.match(after, /guarantee or a warranty/, 'the quality brief may promise a guarantee');
});

test('AND THE SIX ARE NOT RECITED, BECAUSE THE GRID IS SHOWING THEM', () => {
  assert.strictEqual(orchardPrompt.ORCHARD_VOICE.namesServices, false);

  const built = orchardPrompt.homePagePrompt({
    business: SITE().business, services: SITE().services, areas: SITE().areas,
  });

  assert.ok(!built.system.includes('Name the kinds of work in a sentence'),
    'Orchard is still asked to recite the six');
  assert.ok(`${built.system}${built.user}`.includes('drain cleaning'),
    'the six services are not given to the model at all');
});

test('AND THE LEMON-LAW PROFILE HAS AN ORCHARD OF ITS OWN', () => {
  /* The profile supplies a set of home briefs PER VOICE. A voice the
   * industry has not re-aimed falls back to the trade version, which on a
   * law firm's site would ask about the water being off. */
  const { industryFor } = require('./utils/localOptions/industries');
  const law = industryFor('lemon law');

  assert.ok(law.homeJobs.orchard, 'lemon law has no Orchard briefs');
  assert.strictEqual(law.homeJobs.orchard.length, 3);
  assert.ok(law.aboutHeading.orchard, 'lemon law has no Orchard About heading');

  const [living, differ, judge] = law.homeJobs.orchard;

  assert.ok(!/water or the power|mess, the noise/.test(living),
    'a trade brief reached the lemon-law profile');
  assert.match(differ, /do not predict, estimate or hint at any outcome/i,
    'the why-files-differ brief may predict an outcome');
  assert.match(judge, /do not criticise any other firm or lawyer/,
    'the what-to-look-for brief may run down another lawyer');
});

/* ======================================================================= */

section('WHAT DESIGN 7 MEANS ON THE FORM');

test('DESIGN 7 IS THE WHOLE PACKAGE, NOT JUST THE PHOTOGRAPHS', () => {
  const seven = designFor('7', CF_MODE);

  assert.ok(seven, 'there is no Design 7');
  assert.strictEqual(seven.structure, 'orchard');
  assert.strictEqual(seven.imageSet, 'set-7');
  assert.deepStrictEqual(seven.modes, [CF_MODE]);
});

test('AND IT IS OFFERED ON THE CLOUDFLARE DOOR ONLY', () => {
  assert.deepStrictEqual(designsFor(CF_MODE).map(d => d.id),
    ['1', '2', '3', '4', '5', '6', '7']);
  assert.deepStrictEqual(designsFor('localoptions').map(d => d.id), ['1', '2', '3']);

  /* A DESIGN FROM ANOTHER MODE IS AN UNKNOWN DESIGN. This is the guard that
   * was missing when Design 4 built Design 1: the door offered the Cloudflare
   * rows and the build resolved the design against the GitHub mode. */
  assert.strictEqual(designFor('7', 'localoptions'), null,
    'Design 7 resolves in the GitHub wizard, where it is not offered');
  assert.ok(designFor('7', CF_MODE), 'Design 7 does not resolve in its own mode');
});

test('AND THE CLOUDFLARE DOOR NOW OFFERS ALL SEVEN LAYOUTS', () => {
  /* 18 November. Edwin: *"how about if we use the same images and html
   * structure of the sites generated with github, that way cloudflare sites
   * will have 7 html structure and 7 set of images"* — and, on the
   * duplication that allows: *"dont worry about cloudflare duplicating a
   * site from github."*
   *
   * SEVEN STRUCTURES EXIST AND SEVEN ARE OFFERED THERE. Counting the rows
   * is not the same claim: three rows could name the same structure and the
   * count would still be seven. This asserts the SET of structures, so a
   * layout that is built, registered and then offered at neither door is
   * caught — which is the state Quarry sat in for a day. */
  const offered = designsFor(CF_MODE);

  assert.deepStrictEqual(offered.map(d => d.structure).sort(), structureKeys().sort(),
    'a structure exists that the Cloudflare door does not offer');

  /* AND EACH ONE BRINGS ITS OWN PHOTOGRAPHS. Seven layouts sharing four
   * image sets is not what was asked for. */
  assert.strictEqual(new Set(offered.map(d => d.imageSet)).size, offered.length,
    'two Cloudflare designs hand out the same photographs');

  /* THE GITHUB DOOR IS UNCHANGED, which is the half Edwin asked for
   * explicitly: *"right now I dont want you to delete the github options"*. */
  assert.deepStrictEqual(designsFor('localoptions').map(d => d.structure),
    ['ledger', 'beacon', 'anvil']);
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

  assert.deepStrictEqual(DESIGNS.map(d => d.id), ['1', '2', '3', '4', '5', '6', '7']);
});

test('AND A TRADE WITHOUT set-7 FALLS BACK RATHER THAN PUBLISHING FOUR GAPS', () => {
  /* Design 7 hard-names set-7, and the dropdown is the same for every trade
   * while the folders are not.
   *
   * ⚠ IT REPORTED THE DAY AFTER IT WAS WRITTEN, which is three for three.
   * The first version could only test the fallback half, because no trade
   * had a set-7: it asserted that plumbing had none and said in the message
   * what to do when it did. Edwin added the photographs the next morning
   * and it failed with "plumbing has a set-7 now — rewrite this the way
   * Atlas's is". set-5 and set-6 each did the same thing on the afternoon
   * their folders were filled.
   *
   *     A TEST PINNED TO A FACT THAT IS ABOUT TO CHANGE SHOULD SAY WHAT
   *     WOULD MAKE IT WRONG. Three times now it has been the only thing
   *     that noticed the world had moved.
   *
   * It now takes a trade that HAS a set-7 and one that does not, so neither
   * half can rot: filling lemon-law's set-7 fails the second assertion,
   * which is the same warning one step later. */
  const { completeSets } = require('./utils/localOptions/render/heroes');
  const src = require('fs').readFileSync('./utils/localOptions/generate.js', 'utf8');

  const want = designFor('7', CF_MODE).imageSet;

  assert.ok(completeSets('plumbing').includes(want),
    `plumbing has no ${want}, so the Design 7 path cannot be exercised at all`);

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

test('AND set-7 IS A COMPLETE SET — four photographs AND their words', () => {
  /* completeSets() returns a set only when every hero is there AND alt.json
   * describes them, which is why roofing and electrician have photographs
   * and no usable set at all. A set in the draw with no alt text publishes
   * four pictures that say nothing to a screen reader and nothing to a
   * crawler.
   *
   * THE COVER IS AN INDEX INTO THESE FOUR, and it is what goes into the
   * LocalBusiness schema as the business's own image. A folder whose
   * pictures are reordered without its cover being moved hands the wrong
   * photograph to a search result, and nothing fails. */
  const { heroSet, HERO_COUNT } = require('./utils/localOptions/render/heroes');
  const { HERO_COUNT: SHAPE_HEROES } = require('./utils/localOptions/render/shape');
  const want = designFor('7', CF_MODE).imageSet;
  const got = heroSet('plumbing', { set: want });
  const count = HERO_COUNT || SHAPE_HEROES;

  assert.strictEqual(got.set, want);
  assert.deepStrictEqual(got.missing, [], `${want} is missing a photograph`);
  assert.strictEqual(got.found.length, count);

  for (let n = 1; n <= count; n += 1) {
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

  /* AND THEY ARE NOT set-6's SENTENCES. Copying the neighbouring folder's
   * file is the one mistake that leaves every other assertion here green. */
  const six = heroSet('plumbing', { set: 'set-6' });

  assert.strictEqual(
    Object.values(got.alt).filter(t => Object.values(six.alt).includes(t)).length, 0,
    'set-7 is describing set-6\'s photographs');

  /* ⚠ READ FROM alt.json, NOT FROM heroSet(). coverFor() CLAMPS a cover it
   * does not like to 1, so `got.cover` is in range whatever the file says —
   * a mutant setting "cover": 9 survived against the resolved value. A
   * folder that states a cover nobody honours is a folder whose author
   * believes a different photograph is going into the search result. */
  const manifest = JSON.parse(require('fs').readFileSync(
    `./src/predefined-images/local-website-options/plumbing/${want}/alt.json`, 'utf8'));

  assert.ok(Number.isInteger(manifest.cover)
    && manifest.cover >= 1 && manifest.cover <= count,
  `set-7 states a cover of ${manifest.cover}, which is not one of the four`);
  assert.strictEqual(got.cover, manifest.cover,
    'the cover that was asked for is not the cover that was used');
});

test('AND THE WORDMARK SITS ON WHAT THE BAR IS, NOT ON WHAT THE PAGE IS', () => {
  /* Anvil and Harbor draw on a dark rail, Quarry and Atlas on the page
   * itself. Orchard's bar is WHITE on a warm cream page, so reading the
   * backdrop as the page colour would mix the ink against #fbfaf6 and then
   * paint it on #ffffff — Quarry's mistake, one shade smaller. */
  const { paletteFor } = require('./utils/wordmarkLogo');
  const mine = paletteFor({ structure: 'orchard' });

  assert.strictEqual(mine.backdrop, '#ffffff', 'the backdrop is not the bar colour');
  assert.ok(CSS.includes('--oc-card:#fff'), 'the bar colour changed and the palette did not');
  assert.ok(CSS.includes(`--oc-ink:${mine.ink}`), 'the ink is not Orchard\'s own');
  assert.ok(CSS.includes(`--oc-leaf:${mine.tile}`), 'the tile is not Orchard\'s leaf green');

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
