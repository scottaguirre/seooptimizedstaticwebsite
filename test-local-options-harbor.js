// test-local-options-harbor.js
//
// The fifth structure, and the first that is not a stack of bands.
//
// WHAT THIS SUITE IS GUARDING. All five are served as assets/site.css to
// different sites built by the same code. The failure it exists for is not a
// crash — it is a page that renders perfectly with a stylesheet written for
// one of the other four, where every selector misses, nothing throws, and
// the site goes out as unstyled text.
//
//     A STYLESHEET AND ITS MARKUP ARE ONE CHOICE, NOT TWO.
//
// Five structures collide twenty ways. The isolation tests are a loop over
// every ordered pair, which is why this file did not have to add eight more
// assertions by hand.
//
// AND WHAT IS NEW WITH THE FIFTH: THE RAIL.
//
// Ledger, Beacon, Anvil and Quarry are one column — header, sections,
// footer. Harbor puts the name, the phone, the hours, the address and all
// six services in a narrow column down the left that stays put while the
// content scrolls past it.
//
//   the phone    On every other layout the number is at the top and then
//                gone. A reader three screens into "what moves the price"
//                has nothing to ring. That is the one measurable thing
//                this layout is for, and it is asserted on all eleven
//                pages rather than on the home page.
//   the absences The rail takes four things OFF the page: the facts block,
//                the hours, the menu and most of the footer. Those
//                absences ARE the design, so they are tested as absences —
//                which is the kind of test that passes on an empty string,
//                so each one is paired with the presence it moved to.
//
//   node test-local-options-harbor.js

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
    aboutHeading: 'Your pipework in Chicago', about: ['First.', 'Second.'],
  },
  now: new Date('2026-11-17T00:00:00Z'),
  ...over,
});

const harbor = renderSite(SITE({ structure: 'harbor' }));
const quarry = renderSite(SITE({ structure: 'quarry' }));
const anvil = renderSite(SITE({ structure: 'anvil' }));
const beacon = renderSite(SITE({ structure: 'beacon' }));
const ledger = renderSite(SITE({ structure: 'ledger' }));

const BUILT = { ledger, beacon, anvil, quarry, harbor };

const allOf = files => Object.entries(files)
  .filter(([path]) => path.endsWith('.html') || path.endsWith('.css'))
  .map(([, body]) => String(body)).join('\n');

const CSS = String(harbor['assets/site.css']);
const HOME = String(harbor['index.html']);
const SERVICE = String(harbor['drain-cleaning/index.html']);
const CONTACT = String(harbor['contact/index.html']);

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

/** Every structure's class prefix and custom-property prefix, from the source. */
const MARKS = {
  ledger: { cls: /ledger-/, prop: /--lg-/ },
  beacon: { cls: /beacon-/, prop: /--bn-/ },
  anvil: { cls: /anvil-/, prop: /--av-/ },
  quarry: { cls: /quarry-/, prop: /--qy-/ },
  harbor: { cls: /harbor-/, prop: /--hb-/ },
};

/* ======================================================================= */

section('FIVE STRUCTURES, TWENTY WAYS TO COLLIDE');

test('NO STRUCTURE\'S NAMES REACH ANY OTHER STRUCTURE\'S SITE', () => {
  /* Written as a loop over ordered pairs rather than by hand: two
   * structures were two directions, three were six, four were twelve, five
   * are twenty. A hand-written list is a list that is short by eight the
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

test('THE IDS DIFFER ACROSS ALL FIVE', () => {
  /* Edwin, 30 October: "different classes and prefix and css IDs".
   *
   * QUARRY'S MAIN_ID WAS BEACON'S FOR AN HOUR and nothing would have
   * failed: the skip link and the <main> it points at are both inside one
   * page, so the duplicate lives in two sites that never meet.
   *
   *     TWO LAYOUTS SHARING AN ID STILL WORK. THEY JUST CANNOT BE TOLD
   *     APART BY A FRAGMENT IN A URL, BY A SCRAPER, OR BY A TEST. */
  assert.ok(HOME.includes('<main id="here"'));
  assert.ok(HOME.includes('id="offer"'));

  for (const theirs of ['main', 'content', 'page', 'read',
    'services', 'trades', 'work', 'index']) {
    assert.ok(!HOME.includes(`id="${theirs}"`), `Harbor reuses the id "${theirs}"`);
  }
});

test('and the skip link points at the id this structure actually used', () => {
  /* A skip link whose target does not exist is a keyboard user pressing
   * Tab, Enter, and landing nowhere — and it is exactly what a renamed
   * MAIN_ID leaves behind if the two are not read from one constant. */
  const target = (HOME.match(/harbor-skip" href="#([^"]+)"/) || [])[1];

  assert.strictEqual(target, 'here');

  for (const path of htmlPaths(harbor)) {
    assert.ok(harbor[path].includes(`<main id="${target}"`),
      `${path} has a skip link pointing at nothing`);
  }
});

test('and so do the contact form field ids', () => {
  /* Ledger n/p/e/m, Beacon bn/bp/be/bm, Anvil an/ap/ae/am, Quarry
   * qn/qp/qe/qm, Harbor hn/hp/he/hm. Five layouts whose markup cannot be
   * told apart by anything that looks at ids are one layout as far as a
   * scraper, a test or a stylesheet is concerned. */
  assert.ok(CONTACT.includes('id="hn"') && CONTACT.includes('id="hm"'));

  assert.ok(!/id="(?:qn|qp|qe|qm)"/.test(CONTACT), 'Harbor reuses a Quarry field id');
  assert.ok(!/id="(?:an|ap|ae|am)"/.test(CONTACT), 'Harbor reuses an Anvil field id');
  assert.ok(!/id="(?:bn|bp|be|bm)"/.test(CONTACT), 'Harbor reuses a Beacon field id');
  assert.ok(!/id="[npem]"/.test(CONTACT), 'Harbor reuses a Ledger field id');
});

test('A STYLESHEET NEVER ARRIVES WITHOUT ITS OWN MARKUP', () => {
  for (const key of Object.keys(STRUCTURES)) {
    const s = structureFor(key);

    assert.strictEqual(s.key, key, `${key} resolved to ${s.key}`);
    assert.ok(s.pages && s.pages.homePage, `${key} has no page builders`);
    assert.ok(s.prompt && s.prompt.servicePagePrompt, `${key} has no prompts`);
  }

  assert.deepStrictEqual(structureKeys(),
    ['ledger', 'beacon', 'anvil', 'quarry', 'harbor', 'atlas', 'orchard']);
});

test('AND A TYPO FALLS BACK TO ALL FIVE HALVES OF ONE', () => {
  /* structureFor() resolves the theme by the incoming string and the PARTS
   * by the RESOLVED key, which is what stops "harbour" producing Ledger's
   * stylesheet with Harbor's markup.
   *
   * NOTE THE SPELLING. "harbour" is the natural typo and it is the one that
   * would hurt, because it is what half the English-speaking world writes
   * without thinking. */
  assert.strictEqual(structureFor('harbor').prompt, harborPrompt);
  assert.strictEqual(structureFor('harbour').prompt, ledgerPrompt);
  assert.strictEqual(structureFor('harbour').key, 'ledger');
  assert.strictEqual(structureFor('HARBOR').key, 'harbor');
  assert.strictEqual(structureFor('  harbor  ').key, 'harbor');
});

test('and every class the markup emits has a rule, both ways round', () => {
  /* THE REAL SHAPE OF THE "UNSTYLED TEXT" FAILURE, caught inside one
   * structure rather than between two. A class in the markup with no rule
   * is an unstyled block; a rule naming a class the markup never emits is a
   * rule renamed in one file and not the other. Both are silent.
   *
   * COMMENTS STRIPPED, NOT class="" SCANNED. Quarry's version read class
   * attributes, which breaks here: one of them carries a template
   * interpolation, so the scan found `harbor-open__row${when` and missed
   * both real names.
   *
   *     A SCANNER THAT CANNOT READ THE MARKUP REPORTS THE MARKUP IS WRONG.
   *
   * Reading every harbor- token out of comment-free code is cruder and
   * right: the only harbor- strings left in it are ones that reach a page. */
  const fs = require('fs');
  const dir = './utils/localOptions/render/harbor/';
  const code = codeOnly(fs.readFileSync(dir + 'chrome.js', 'utf8')
    + '\n' + fs.readFileSync(dir + 'pages.js', 'utf8'));

  const emitted = new Set(code.match(/harbor-[A-Za-z0-9_-]+/g) || []);
  const styled = new Set((CSS.match(/\.harbor-[A-Za-z0-9_-]+/g) || []).map(s => s.slice(1)));

  assert.ok(emitted.size > 30, `only ${emitted.size} classes found — the scan is broken`);

  const noRule = [...emitted].filter(c => !styled.has(c)).sort();
  const noMarkup = [...styled].filter(c => !emitted.has(c)).sort();

  assert.deepStrictEqual(noRule, [], `classes with no rule: ${noRule.join(', ')}`);
  assert.deepStrictEqual(noMarkup, [], `rules with no markup: ${noMarkup.join(', ')}`);
});

/* ======================================================================= */

section('THE RAIL, WHICH IS THE WHOLE STRUCTURE');

test('THE PHONE NUMBER IS ON EVERY PAGE AND NEVER SCROLLS AWAY', () => {
  /* THE ONE MEASURABLE THING THIS LAYOUT IS FOR. On the other four the
   * number is in a header at the top and then gone; a reader three screens
   * into "what moves the price" has nothing to ring.
   *
   * ASSERTED ON ALL ELEVEN, not on the home page. A rail that appears on
   * the page it was designed against and nowhere else is a header. */
  for (const path of htmlPaths(harbor)) {
    const page = String(harbor[path]);

    assert.ok(page.includes('harbor-rail'), `${path} has no rail`);
    assert.ok(/<a class="harbor-call" href="tel:/.test(page),
      `${path} has no call button in the rail`);
  }

  /* AND IT IS FIXED ONCE THERE IS ROOM. Without this the rail is a block
   * that scrolls away like any other, which is the thing it replaces. */
  const wide = CSS.slice(CSS.indexOf('@media (min-width:960px)'));

  assert.match(wide, /\.harbor-rail\{[^}]*position:fixed/,
    'the rail scrolls away with the page');
});

test('AND IT IS A BLOCK IN THE FLOW ON A PHONE, NOT A PANEL OVER THE PAGE', () => {
  /* A 17rem column beside a 360px screen is not a column, and these sites
   * ship no JavaScript to put it in a drawer. So the base rule leaves it in
   * the document and the fixed rule arrives with the room for it.
   *
   * position:fixed IN THE BASE would put the rail over the content with no
   * way to dismiss it. */
  const base = CSS.split('@media')[0];
  const rule = (base.match(/\.harbor-rail\{[^}]*\}/) || [''])[0];

  assert.ok(rule, 'the rail has no base rule at all');
  assert.ok(!/position:fixed/.test(rule), 'the rail is fixed over the page on a phone');

  assert.ok(!/\.harbor-main\{[^}]*margin-left/.test(base),
    'the content is indented for a rail that is not beside it yet');
});

test('EVERY MEDIA QUERY IS min-width, SO THE PHONE IS THE BASE', () => {
  /* Edwin's standing rule, and the second of the five stylesheets to
   * follow it. Ledger, Beacon and Anvil are one wide layout with max-width
   * queries subtracting from it, so each DESCRIBES the phone as an
   * exception — and the phone is where these sites are read. */
  const queries = CSS.match(/@media[^{]+/g) || [];

  assert.ok(queries.length >= 2, `only ${queries.length} media queries`);

  for (const q of queries) {
    assert.ok(/min-width/.test(q), `a max-width query survives: ${q.trim()}`);
    assert.ok(!/max-width/.test(q), `a max-width query survives: ${q.trim()}`);
  }

  assert.ok(/@media \(max-width/.test(String(anvil['assets/site.css'])),
    'Anvil was rewritten and this test no longer proves anything');
});

test('THE RAIL CARRIES ALL SIX SERVICES, AND MARKS THE ONE YOU ARE READING', () => {
  /* The ring caps what the BODY passes on; navigation is not the ring. And
   * a rail that lists six services on all six service pages without saying
   * which one you are on is six identical menus. */
  const menu = between(HOME, 'harbor-menu', '</nav>');

  for (const slug of SLUGS) {
    assert.ok(menu.includes(`${slug}/`), `${slug} is not in the rail`);
  }

  const onPage = between(SERVICE, 'harbor-menu', '</nav>');

  assert.ok(/aria-current="page"/.test(onPage), 'the rail does not mark the current page');
});

test('AND NO DISCLOSURE, UNLIKE ALL FOUR OTHERS', () => {
  /* They hide the services behind a <details> because a horizontal bar has
   * no room for six. A column has room for six. A disclosure in a rail
   * would be a click to reveal something that already fits. */
  assert.ok(!/<details/.test(HOME), 'the rail hides its services behind a disclosure');
  assert.ok(/<details/.test(String(quarry['index.html'])),
    'Quarry dropped its disclosure and this test no longer contrasts');
});

/* ======================================================================= */

section('WHAT THE RAIL TAKES OFF THE PAGE');

test('THE HOURS ARE IN THE RAIL AND NOWHERE ELSE', () => {
  /* The fifth answer to the question all five were asked. Ledger puts a
   * table beneath the prose, Beacon a slate beside it, Anvil a band across,
   * Quarry a split box in the aside. Harbor does not put them on the page.
   *
   * PAIRED WITH THE PRESENCE, because "the hours are not in the content
   * column" passes on a site with no hours at all. */
  for (const path of htmlPaths(harbor)) {
    const page = String(harbor[path]);

    assert.ok(page.includes('harbor-open'), `${path} lost the hours entirely`);

    const main = between(page, '<main id="here"', '</main>');

    assert.ok(!main.includes('harbor-open'),
      `${path} repeats the hours in the content column`);
    assert.ok(!/Sunday/.test(main), `${path} has a day of the week in the body`);
  }
});

test('AND SO ARE THE ADDRESS AND THE NAME — NO FACTS BLOCK ON THE PAGE', () => {
  /* Ledger has a <dl>, Beacon a card of three columns, Anvil an inline
   * rule, Quarry a stacked kerb. Each of those exists because that layout
   * had nowhere else to put them. Harbor has somewhere else. */
  const main = between(HOME, '<main id="here"', '</main>');

  assert.ok(HOME.includes('harbor-rail__where'), 'the address is nowhere at all');
  assert.ok(!main.includes('12 W Elm St'), 'the address is repeated in the content column');
  assert.ok(!main.includes('(312) 555-0164'),
    'the phone number is repeated in the content column');
});

test('AND THE FOOTER IS SHORT, BECAUSE NOTHING SCROLLED AWAY', () => {
  /* A footer repeats what scrolled away. Nothing scrolled away. What is
   * left is what the rail does not carry: the three legal pages, the social
   * links and the copyright line. */
  const foot = between(HOME, 'harbor-foot', '</footer>');

  for (const slug of ['privacy-policy', 'terms-of-use', 'accessibility']) {
    assert.ok(foot.includes(`${slug}/`), `${slug} is not in the footer`);
  }

  for (const slug of SLUGS) {
    assert.ok(!foot.includes(`${slug}/`),
      'the footer repeats the six services the rail is already showing');
  }
});

test('and the legal pages are reachable from every page, since only the foot has them', () => {
  /* The rail does not carry them, so the footer is the only route. If it is
   * ever trimmed further, three pages become unreachable and nothing else
   * in this suite would notice. */
  for (const path of htmlPaths(harbor)) {
    for (const slug of ['privacy-policy', 'terms-of-use', 'accessibility']) {
      assert.ok(String(harbor[path]).includes(`${slug}/`),
        `${slug} is unreachable from ${path}`);
    }
  }
});

/* ======================================================================= */

section('THE SAME SITE, DIFFERENTLY DRESSED');

test('THE SAME ELEVEN PAGES, plus the stylesheet, sitemap, robots and 404', () => {
  for (const [name, files] of Object.entries(BUILT)) {
    assert.deepStrictEqual(Object.keys(harbor).sort(), Object.keys(files).sort(),
      `Harbor and ${name} do not build the same files`);
  }
});

test('and every service page carries the same sections', () => {
  for (const slug of SLUGS) {
    const page = String(harbor[`${slug}/index.html`] || '');

    assert.ok(page, `${slug} was not built`);
    assert.ok(page.includes('harbor-top'), `${slug} has no masthead`);
    assert.ok(page.includes('harbor-prose'), `${slug} has no prose`);
    assert.ok(page.includes('harbor-onward'), `${slug} does not pass the reader on`);
  }
});

test('THE RING STILL CAPS THE BODY AT TWO LINKED SERVICES', () => {
  /* HOME_BODY_LINKS is a rule about the SITE, not about the layout. A fifth
   * structure that re-decided it would be a fifth product. */
  const list = between(HOME, 'harbor-offer', '</dl>');

  const linked = (list.match(/<dt><a href="/g) || []).length;
  const flat = (list.match(/harbor-offer__row--flat/g) || []).length;

  assert.strictEqual(linked, 2, `the list links ${linked} services`);
  assert.strictEqual(flat, 4, `the list shows ${flat} unlinked services`);
});

test('and an unlinked row is visibly muted, not quietly inert', () => {
  assert.match(CSS, /\.harbor-offer__row--flat\{opacity:\./,
    'the unlinked rows look exactly like the linked ones');
});

test('the Search Console tag is on every page', () => {
  for (const path of htmlPaths(harbor)) {
    assert.ok(harbor[path].includes('dK3xP9mQ2vR7nL4tY8wZ'), `${path} has no tag`);
  }
});

test('AND THE LOGO, STYLESHEET AND PHOTOGRAPH ARE RE-BASED FOR DEPTH', () => {
  /* `assets/logo.png` from /drain-cleaning/ asks for
   * /drain-cleaning/assets/logo.png. Ledger shipped that for a day and it
   * was found in a python http.server log — 200 for the home page, 404 for
   * the same file from all six service pages. */
  assert.ok(HOME.includes('src="assets/logo.png"'));
  assert.ok(HOME.includes('href="assets/site.css"'));
  assert.ok(/src="assets\/hero-\d\.webp"/.test(HOME));

  assert.ok(SERVICE.includes('src="../assets/logo.png"'));
  assert.ok(SERVICE.includes('href="../assets/site.css"'));
  assert.ok(/src="\.\.\/assets\/hero-\d\.webp"/.test(SERVICE));
});

test('the hero is eager and high priority, because it is what the page is measured by', () => {
  assert.ok(/loading="eager"/.test(HOME), 'the largest element is lazy-loaded');
  assert.ok(/fetchpriority="high"/.test(HOME));
});

test('A PAGE WITH NO PHOTOGRAPH STILL HAS ITS HEADING', () => {
  /* The masthead is independent of the plate — no H1 lives inside the
   * figure — so a page outside the hero rotation goes straight from the
   * headline to the prose. */
  const legal = String(harbor['privacy-policy/index.html']);

  assert.ok(/<h1>/.test(legal), 'a legal page has no H1');
  assert.ok(!legal.includes('harbor-plate'), 'a legal page drew an empty figure');

  const noAlt = renderSite(SITE({ structure: 'harbor', alt: {} }));

  assert.ok(/<h1>/.test(noAlt['index.html']), 'the home page lost its H1');
});

test('the schema and the canonical are untouched by the layout', () => {
  const h = JSON.parse(between(HOME, 'application/ld+json">', '</script>')
    .replace('application/ld+json">', ''));
  const a = JSON.parse(between(String(anvil['index.html']), 'application/ld+json">', '</script>')
    .replace('application/ld+json">', ''));

  assert.deepStrictEqual(h, a, 'the layout changed the structured data');

  assert.ok(SERVICE.includes(
    '<link rel="canonical" href="https://the-chicago-plumber.9-x.org/drain-cleaning/">'));
});

test('AND THE 404 IS NOINDEX, WITH ITS CANONICAL ON THE HOME PAGE', () => {
  const four = String(harbor['404.html']);

  assert.ok(four.includes('<meta name="robots" content="noindex">'));
  assert.ok(four.includes('<link rel="canonical" href="https://the-chicago-plumber.9-x.org/">'));
  assert.ok(/href="\/"/.test(four), 'the 404 links relatively');
  assert.ok(!/href="\.\.\//.test(four), 'the 404 climbs from a path nobody chose');
});

test('a build is reproducible — the same input gives the same bytes', () => {
  assert.deepStrictEqual(renderSite(SITE({ structure: 'harbor' })), harbor);
});

test('NO PAGE CARRIES AN HTML COMMENT AT ALL', () => {
  /* An HTML comment inside a template ships into the published page. One
   * did, on a live client domain, carrying a quoted old draft and Edwin's
   * name. The stylesheet's CSS comments are page content too, which is how
   * the word "lost" in one of Quarry's broke test-static-blogs.js. */
  for (const path of htmlPaths(harbor)) {
    assert.ok(!/<!--/.test(harbor[path]), `${path} ships an HTML comment`);
  }
});

test('AND THE MENU WORKS WITH NO JAVASCRIPT, BECAUSE THESE SITES SHIP NONE', () => {
  for (const path of htmlPaths(harbor)) {
    assert.ok(!/<script(?![^>]*application\/ld\+json)/.test(harbor[path]),
      `${path} ships a script`);
  }
});

test('THE SENTENCE ABOVE THE SERVICES IS WRITTEN FOR A CUSTOMER', () => {
  /* Edwin struck this exact sentence out on 30 October — "All six have a
   * page of their own" — with "this should be for a customer." */
  assert.ok(!/have a page of their own/i.test(HOME), 'the lede talks to the owner');
  assert.ok(!/All six/i.test(HOME), 'the lede counts the pages at the reader');
  assert.ok(HOME.includes('what moves the price'),
    'the lede says nothing about what is on the pages');
});

test('and it counts the services from the constant, never in typed prose', () => {
  /* The lede said "three" for a day after the body-link cap became two,
   * because the number was written out rather than built from
   * SERVICE_COUNT. The output cannot be asked this question — the word
   * "six" typed out satisfies it — so this reads the function's own code. */
  const { defaultServicesLede } = require('./utils/localOptions/render/harbor/pages');
  const { SERVICE_COUNT, inWords } = require('./utils/localOptions/render/shape');

  assert.ok(defaultServicesLede().includes(inWords(SERVICE_COUNT)),
    'the lede does not name the count at all');

  const code = codeOnly(String(defaultServicesLede));

  assert.ok(code.includes('inWords(SERVICE_COUNT)'),
    'the lede does not build the count from the constant');

  const typed = code.replace(/inWords\(SERVICE_COUNT\)/g, '');

  assert.ok(!new RegExp(`\\b${inWords(SERVICE_COUNT)}\\b`, 'i').test(typed),
    `the lede types "${inWords(SERVICE_COUNT)}" out beside the constant`);
});

test('AND THE OWNER CAN REPLACE IT, OR TAKE IT AWAY', () => {
  /* ABSENT IS NOT EMPTY. `undefined` means nobody has edited the field and
   * the default stands; `''` means the owner cleared it on purpose. */
  const mine = renderSite(SITE({
    structure: 'harbor',
    home: { ...SITE().home, servicesLede: 'We fix these every week.' },
  }));

  assert.ok(mine['index.html'].includes('We fix these every week.'));
  assert.ok(!mine['index.html'].includes('what moves the price'));

  const none = renderSite(SITE({
    structure: 'harbor',
    home: { ...SITE().home, servicesLede: '' },
  }));

  assert.ok(!none['index.html'].includes('what moves the price'), 'a cleared lede came back');
  assert.ok(none['index.html'].includes('harbor-offer'), 'clearing it broke the section');
});

test('THE HOME HEADING IS THE BUSINESS NAME, A HYPHEN, THE TOWN AND THE STATE', () => {
  /* Edwin, 31 October: "next time I don't want a slash, I want a hyphen."
   * Shared by all five — homeHeading() lives in common.js precisely so a
   * fifth layout cannot quietly disagree about it. */
  const h1 = between(HOME, '<h1>', '</h1>').replace('<h1>', '');

  assert.strictEqual(h1, 'The Chicago Plumber - Chicago, IL');
  assert.ok(!h1.includes('/'), 'the separator is a slash again');
});

test('AND THE FIRST MENTION OF THE BUSINESS ON A SERVICE PAGE LINKS HOME', () => {
  /* 2 November. Nothing is written for it: the copy already names the
   * business somewhere, in its own words, in a different place on each
   * page, and this marks one of them up. */
  assert.ok(/<a href="\.\.\/">The Chicago Plumber<\/a>/.test(SERVICE),
    'the first mention is not linked home');

  assert.strictEqual(
    (SERVICE.match(/<a href="\.\.\/">The Chicago Plumber<\/a>/g) || []).length, 1,
    'every mention of the name is a link');
});

test('the contact form is markup only, and says so in its action', () => {
  /* Edwin, 26 October: "don't worry about processing the contact form. Just
   * add it even if it doesnt work. They can add a third party service." */
  assert.ok(CONTACT.includes('action="REPLACE_WITH_YOUR_FORM_ENDPOINT"'));
});

test('AND THE NUMBER IS STILL BESIDE IT, BECAUSE THE FORM GOES NOWHERE', () => {
  /* A visitor who fills it in and presses Send on an unwired action has
   * reached a dead end; one who can see the number has not. The rail is
   * beside the form rather than inside it, so the form names it once in its
   * own note as well. */
  const form = between(CONTACT, '<form class="harbor-form"', '</form>');

  assert.ok(form, 'there is no form on the contact page');
  assert.ok(/href="tel:/.test(form), 'the form offers no way to reach anybody');
});

test('and the form is the whole page — nothing is set beside it', () => {
  /* Ledger and Anvil put facts beneath it, Beacon beside it on the right,
   * Quarry beside it on the left. Harbor puts nothing beside it: the facts
   * are in the rail. */
  assert.ok(!CONTACT.includes('harbor-beside'), 'a two-column row appeared');

  const main = between(CONTACT, '<main id="here"', '</main>');

  assert.ok(!main.includes('12 W Elm St'),
    'the address is repeated beside the form');
});

/* ======================================================================= */

section('THE TWO DIVIDERS');

const broken = renderSite(SITE({
  structure: 'harbor',
  home: {
    ...SITE().home,
    firstBreak: 'The same person answers every time.',
    secondBreak: 'We do not charge for a look.',
  },
}));

test('BOTH APPEAR, AND BOTH CARRY THE LINE THEY WERE GIVEN', () => {
  const home = String(broken['index.html']);

  assert.ok(home.includes('The same person answers every time.'));
  assert.ok(home.includes('We do not charge for a look.'));
  assert.strictEqual((home.match(/harbor-break/g) || []).length, 2);
});

test('A DIVIDER IS NOT A HEADING', () => {
  /* It is a breather: nothing sits under it and it introduces nothing. An
   * h2 here would put a heading in the document outline that leads
   * nowhere. */
  const band = between(String(broken['index.html']), 'harbor-break', '</div>');

  assert.ok(band, 'there is no divider at all');
  assert.ok(!/<h[1-6]/.test(band), 'the divider is marked up as a heading');
  assert.ok(/<p>/.test(band), 'the divider carries no paragraph');
});

test('THE SENTENCE COMES FIRST AND THE RULE UNDER IT', () => {
  /* The fifth answer. Beacon's break is a deep band on a near-white page,
   * Anvil's a raised band on a dark one, Quarry's a hairline with the
   * sentence hanging beneath it. Harbor's reads as the END of what came
   * before rather than the opening of what follows. */
  const rule = (CSS.match(/\.harbor-break::after\{[^}]*\}/) || [''])[0];

  assert.ok(rule, 'the rule under the line is gone');
  assert.match(rule, /border-top:2px solid/, 'there is no rule at all');

  const para = (CSS.match(/\.harbor-break p\{[^}]*\}/) || [''])[0];

  assert.match(para, /max-width:30ch/, 'the line is not held to a short measure');
  assert.ok(!/text-align:center/.test(para), 'the line is centred, which is Anvil\'s');
});

test('AND A SITE BUILT BEFORE THEY EXISTED RENDERS NO EMPTY RULE', () => {
  assert.ok(!HOME.includes('harbor-break'));

  const blank = renderSite(SITE({
    structure: 'harbor',
    home: { ...SITE().home, firstBreak: '   ', secondBreak: '' },
  }));

  assert.ok(!blank['index.html'].includes('harbor-break'), 'a blank line drew a rule');
});

/* ======================================================================= */

section('THE VOICE');

test('HARBOR IS A VOICE, NOT A FIFTH COPY OF THE RULES', () => {
  assert.strictEqual(harborPrompt.SECTIONS, ledgerPrompt.SECTIONS);
  assert.strictEqual(harborPrompt.STANCES, ledgerPrompt.STANCES);
  assert.strictEqual(harborPrompt.stanceFor, ledgerPrompt.stanceFor);
  assert.strictEqual(harborPrompt.spellingFor, ledgerPrompt.spellingFor);
  assert.strictEqual(harborPrompt.placeOf, ledgerPrompt.placeOf);
});

test('it writes at its own length, and no two voices share a budget', () => {
  const all = [ledgerPrompt, beaconPrompt, anvilPrompt, quarryPrompt, harborPrompt]
    .map(p => p.WORDS || { min: 780, max: 1000 })
    .map(w => `${w.min}-${w.max}`);

  assert.strictEqual(new Set(all).size, 5, `two voices share a budget: ${all.join(' ')}`);
  assert.ok(harborPrompt.WORDS.min < harborPrompt.WORDS.max);
});

test('AND ITS WORD BUDGET REACHES THE HOME PAGE, NOT JUST THE SERVICE PAGES', () => {
  /* THE BUG BEACON SHIPPED. Its first version set only the service-page
   * budget, so its home page came out exactly as long as Ledger's — caught
   * by putting two built pages side by side, not by any test.
   *
   *     A SETTING READ IN TWO PLACES HAS TO BE PASSED TO BOTH. */
  const home = harborPrompt.homePagePrompt({
    business: { name: 'X', trade: 'plumbing', city: 'Chicago', state: 'IL' },
    services: SLUGS.map(s => ({ slug: s, name: s })),
    areas: ['Chicago'],
  });

  const text = `${home.system}\n${home.user}`;

  assert.ok(text.includes(String(harborPrompt.HOME.about[0])),
    'the home page was not given Harbor\'s paragraph budget');

  for (const other of [beaconPrompt, anvilPrompt, quarryPrompt]) {
    assert.notDeepStrictEqual(harborPrompt.HOME, other.HOME);
  }
});

test('the service page prompt carries Harbor\'s lines and its length', () => {
  const out = harborPrompt.servicePagePrompt({
    business: { name: 'X', trade: 'plumbing', city: 'Chicago', state: 'IL' },
    service: { slug: 'drain-cleaning', name: 'drain cleaning' },
    services: SLUGS.map(s => ({ slug: s, name: s })),
    areas: ['Chicago'],
  });

  const text = `${out.system}\n${out.user}`;

  assert.ok(text.includes('ANSWER FIRST'), 'the voice lines are missing');
  assert.ok(text.includes(String(harborPrompt.WORDS.min)), 'the length is missing');
});

test('AND THE RUN-UP IS BANNED, WHICH THE ANSWER-FIRST RULE MAKES NECESSARY', () => {
  /* A brief that says "be direct" and nothing else produces a page that
   * opens every paragraph with the same four words. Banning the run-up is
   * what gets a varied first sentence rather than a formula.
   *
   *     A RULE THAT INVITES A SHAPE HAS TO REFUSE THAT SHAPE IN THE SAME
   *     BREATH, OR THE SHAPE IS WHAT COMES BACK. */
  const lines = harborPrompt.LINES.join('\n');

  assert.match(lines, /No run-up/, 'nothing refuses the preamble');
  assert.match(lines, /ANSWER FIRST/);
  assert.match(lines, /Do not begin two paragraphs on this page with the same word/,
    'nothing stops the formula the answer-first rule invites');
});

test('THE THREE HOME PARAGRAPHS ARE ABOUT DIFFERENT THINGS FROM ALL FOUR OTHERS', () => {
  /* Ledger and Beacon were given the same three subjects, and both came
   * back opening paragraph three with "A visit starts with" — because
   * Ledger's brief says "How a visit starts".
   *
   *     A BRIEF THAT DESCRIBES THE PARAGRAPH IN WORDS GETS THOSE WORDS
   *     BACK. */
  const mine = harborPrompt.HOME_JOBS;

  assert.strictEqual(mine.length, 3);

  for (const other of [ledgerPrompt, beaconPrompt, anvilPrompt, quarryPrompt]) {
    const theirs = (other.HOME_JOBS || []).map(String);

    for (const job of mine) {
      assert.ok(!theirs.includes(job), 'Harbor shares a home-page brief with another voice');
    }
  }
});

test('AND EXACTLY ONE OF THEM ALLOWS A LIST', () => {
  /* Anvil and Quarry allow none; Beacon allows one, for symptoms. The
   * limits paragraph is the one subject on this page where a reader is
   * scanning for whether their own job is in or out, and prose makes that
   * harder to answer than a short run of named things.
   *
   *     THREE BRIEFS THAT ASK FOR A LIST PRODUCE A LIST OF LISTS.
   *     ONE DOES NOT. */
  const allowed = harborPrompt.HOME_JOBS
    .filter(j => /A short run of named things is allowed/.test(j));

  assert.strictEqual(allowed.length, 1,
    `${allowed.length} briefs allow a list; exactly one should`);

  assert.match(allowed[0], /here and nowhere else on the page/,
    'the one that allows it does not say it is the only one');
});

test('AND NONE ASKS FOR A JOB THAT HAPPENED, OR FOR A FIGURE', () => {
  /* Nothing in the rules forbids a story in so many words, because they
   * forbid invented FIGURES — a fabricated case study slips between them.
   *
   *     THE RULE SAYS DO NOT INVENT A NUMBER.
   *     A NARRATED JOB IS AN INVENTED EVENT, WHICH IS WORSE. */
  const who = harborPrompt.HOME_JOBS[0];

  assert.match(who, /IN THE GENERAL/, 'the customers brief does not refuse a case study');
  assert.match(who, /never a particular customer/i);

  /* THE REFUSALS ARE TAKEN OUT BEFORE LOOKING, and the first version of
   * this test did not do that. Harbor's second brief ends "do not say how
   * many jobs are done in a day or a week" — a REFUSAL of a figure, which
   * the pattern read as a request for one.
   *
   *     A TEST THAT CANNOT TELL "ASK FOR X" FROM "DO NOT ASK FOR X" WILL
   *     FAIL HARDEST ON THE BRIEF THAT GUARDS ITSELF BEST.
   *
   * Quarry's copy of this has the same hole and passes only because none of
   * its refusals happens to use these words. */
  const asked = job => String(job)
    .split(/(?<=\.)\s+/)
    .filter(sentence => !/^\s*do not\b/i.test(sentence))
    .join(' ');

  for (const job of harborPrompt.HOME_JOBS) {
    assert.ok(!/how many|years|since \d|team of|number of (?:vans|staff)/i.test(asked(job)),
      `a brief asks for a figure: ${asked(job).slice(0, 70)}`);
  }

  /* AND THE STRIPPING IS NOT HIDING EVERYTHING — the refusals are still
   * there to be found, which is what the next test asserts directly. */
  assert.ok(/do not/i.test(harborPrompt.HOME_JOBS.join(' ')),
    'the briefs refuse nothing at all, so the filter above removes nothing');
});

test('AND THE TWO BRIEFS THAT COULD GO WRONG SAY SO THEMSELVES', () => {
  /* "How the week runs" is one sentence from a response-time promise, and
   * "what we do not take on" is one sentence from naming somebody who does
   * it badly. A trade site that runs down other trades reads as a
   * complaint rather than as a limit. */
  const [, week, limits] = harborPrompt.HOME_JOBS;

  assert.match(week, /Do not promise a response time/i, 'the week brief may promise');
  assert.match(week, /same-day or next-day/i, 'the week brief may promise a day');

  assert.match(limits, /Do not criticise any other trade or company/i,
    'the limits brief may run down another trade');
  assert.match(limits, /do not say anyone does anything badly/i);
});

test('THE TITLE AND THE DESCRIPTION HAVE A FIFTH ANGLE', () => {
  /* Ledger leads with the business name, Beacon with the kind of work,
   * Anvil with the place, Quarry with the problem, Harbor with the OUTCOME. */
  const mine = harborPrompt.HARBOR_VOICE;

  for (const other of [beaconPrompt.BEACON_VOICE, anvilPrompt.ANVIL_VOICE,
    quarryPrompt.QUARRY_VOICE]) {
    assert.notStrictEqual(mine.title, other.title);
    assert.notStrictEqual(mine.meta, other.meta);
  }

  assert.match(mine.title, /Lead with the result/i, 'Harbor does not lead with the outcome');
  assert.match(mine.meta, /as ONE sentence/, 'the description is not one sentence');

  /* AND AN OUTCOME IS NOT A PROMISE. This is the one title angle that could
   * become a claim, so it refuses one by name. */
  assert.match(mine.title, /Do not put a time, a speed, a price or a guarantee in it/i,
    'the outcome angle may turn into a promise');
});

test('THE BUSINESS NAME IS IN BOTH, AND IS NEVER SHORTENED OR DROPPED', () => {
  /* Edwin, 30 October: "it should always appear in the title and meta
   * description." "The Austin Plumber" is the case that proves the rule
   * needs both halves — told only not to lead with the name, a model
   * satisfies it by writing "Austin Plumber". */
  const mine = harborPrompt.HARBOR_VOICE;

  for (const field of ['title', 'meta']) {
    assert.match(mine[field], /business name/i, `the ${field} brief never mentions the name`);
    assert.match(mine[field], /exactly as it was given/i, `the ${field} may reword the name`);
  }

  assert.match(mine.title, /town/i, 'the title brief drops the town');
});

test('THE DIVIDER EXEMPTION IS STATED, OR THE TWO RULES CANCEL', () => {
  /*     AN EXCEPTION THAT IS NOT STATED IS NOT AN EXCEPTION.
   *     IT IS TWO RULES AND A COIN TOSS. */
  const home = harborPrompt.homePagePrompt({
    business: { name: 'X', trade: 'plumbing', city: 'Chicago', state: 'IL' },
    services: SLUGS.map(s => ({ slug: s, name: s })),
    areas: ['Chicago'],
  });

  const text = `${home.system}\n${home.user}`;

  assert.ok(text.includes('EXEMPT FROM THE NO-MARKETING-REGISTER RULE'));
  assert.ok(/firstBreak/.test(text) && /secondBreak/.test(text));
});

test('BUT THE FLOOR HOLDS, AND THIS VOICE NEEDS ONE MORE OF IT', () => {
  /* The second divider names something the business does not do, which is
   * one word away from naming somebody who does it badly. */
  const note = harborPrompt.HARBOR_VOICE.extrasNote;

  assert.match(note, /no superlative/i);
  assert.match(note, /guarantee/i);
  assert.match(note, /no number/i);
  assert.match(note, /may mention another company or trade/i,
    'a divider may run down another trade');
});

test('AND HARBOR\'S TWO DIVIDER BRIEFS ARE NOBODY ELSE\'S', () => {
  const mine = harborPrompt.HARBOR_VOICE.extras.map(e => e.brief);

  for (const voice of [beaconPrompt.BEACON_VOICE, anvilPrompt.ANVIL_VOICE,
    quarryPrompt.QUARRY_VOICE]) {
    for (const brief of voice.extras.map(e => e.brief)) {
      assert.ok(!mine.includes(brief), 'Harbor shares a divider brief');
    }
  }

  assert.deepStrictEqual(
    harborPrompt.HARBOR_VOICE.extras.map(e => e.key),
    ['firstBreak', 'secondBreak'],
    'the stored field names changed, which would orphan every built site');
});

test('AND NO BRIEF CARRIES A DOUBLE QUOTE INTO THE JSON TEMPLATE', () => {
  /* The home page prompt builds a JSON template the model fills in. A
   * double quote inside a brief closes a string early and the reply comes
   * back unparseable.
   *
   * LINES IS NOT IN THIS LIST, and that is not an oversight: the voice
   * lines go into the system prompt as prose, not into the template. */
  const all = [
    ...harborPrompt.HOME_JOBS,
    harborPrompt.ABOUT_HEADING,
    harborPrompt.HARBOR_VOICE.title,
    harborPrompt.HARBOR_VOICE.meta,
    harborPrompt.HARBOR_VOICE.extrasNote,
    ...harborPrompt.HARBOR_VOICE.extras.map(e => e.brief),
  ];

  for (const brief of all) {
    assert.ok(!brief.includes('"'), `a brief carries a double quote: ${brief.slice(0, 40)}`);
  }
});

test('AND THE ABOUT HEADING DEMANDS THE WORD TWO OTHERS FORBID', () => {
  /* Beacon and Anvil both ban "Your"; this one requires it. A heading
   * addressed to the reader is the fifth available shape, and told anything
   * vaguer the five structures produce the same heading with the nouns
   * shuffled. */
  const h = harborPrompt.ABOUT_HEADING;

  assert.match(h, /MUST address the reader directly, using the word your/i,
    'the heading brief has no testable property');
  assert.match(h, /must not be a question/i, 'the heading may be a question');

  assert.match(beaconPrompt.ABOUT_HEADING, /Your/,
    'Beacon stopped mentioning Your and these two no longer contrast');

  for (const other of [beaconPrompt.ABOUT_HEADING, anvilPrompt.ABOUT_HEADING,
    quarryPrompt.ABOUT_HEADING]) {
    assert.notStrictEqual(h, other);
  }

  assert.ok(!/["']/.test(h), 'the heading brief carries an example to echo');
});

test('AND THE SIX ARE NOT RECITED, BECAUSE THE RAIL IS SHOWING THEM', () => {
  /* The strongest version of Beacon's reason. The six names are on screen,
   * down the left, on every page, at every scroll position — so a sentence
   * listing them in the body is the same list twice on the one screen where
   * the reader can see both at once. */
  assert.strictEqual(harborPrompt.HARBOR_VOICE.namesServices, false);
});

/* ======================================================================= */

section('WHAT DESIGN 5 MEANS ON THE FORM');

test('DESIGN 5 IS THE WHOLE PACKAGE, NOT JUST THE PHOTOGRAPHS', () => {
  const five = designFor('5');

  assert.ok(five, 'there is no Design 5');
  assert.strictEqual(five.structure, 'harbor');
  assert.strictEqual(five.imageSet, 'set-5');
  assert.deepStrictEqual(five.modes, [CF_MODE]);
});

test('AND IT IS OFFERED BESIDE QUARRY AND ATLAS, ON THE CLOUDFLARE DOOR ONLY', () => {
  /* ALL SEVEN AT THAT DOOR SINCE 18 NOVEMBER — Ledger, Beacon and Anvil
   * are offered there too. Harbor itself is still Cloudflare-only. */
  assert.deepStrictEqual(designsFor(CF_MODE).map(d => d.id),
    ['1', '2', '3', '4', '5', '6', '7']);
  assert.deepStrictEqual(designsFor('localoptions').map(d => d.id), ['1', '2', '3']);
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

test('AND A TRADE WITHOUT set-5 FALLS BACK RATHER THAN PUBLISHING FOUR GAPS', () => {
  /* Design 5 hard-names set-5, and the dropdown is the same for every
   * trade while the folders are not. available() in generate.js has
   * refused a set the chosen trade does not have since 30 October, written
   * for "Design 2 chosen alongside roofing".
   *
   * ⚠ THIS TEST NAMED plumbing FOR AN HOUR AND THEN TOLD ME SO. It asserted
   * that no trade had a set-5 yet; Edwin added plumbing's the same
   * afternoon and it failed with "plumbing has a set-5 now, so this test is
   * about the wrong thing".
   *
   *     A TEST PINNED TO A FACT THAT IS ABOUT TO CHANGE SHOULD SAY WHAT
   *     WOULD MAKE IT WRONG. That one did, so it reported instead of
   *     quietly passing against a world it no longer described.
   *
   * It now takes a trade that HAS a set-5 and one that does not, so neither
   * half can rot: filling the second trade's set-5 fails the first
   * assertion, which is the same warning one step later. */
  const { completeSets } = require('./utils/localOptions/render/heroes');
  const src = require('fs').readFileSync('./utils/localOptions/generate.js', 'utf8');

  const want = designFor('5').imageSet;

  assert.ok(completeSets('plumbing').includes(want),
    `plumbing has no ${want}, so the Design 5 path cannot be exercised at all`);

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

/* ---------------------------------------------------------------------- */

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
