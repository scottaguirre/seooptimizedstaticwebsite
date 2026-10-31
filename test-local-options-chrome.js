// test-local-options-chrome.js
//
// The parts of a Local Website Options page that repeat: header, footer,
// hero, the onward sentence, the NAP strip, the hours table, the map, and
// the document wrapper.
//
// WHAT THIS SUITE IS ACTUALLY FOR. Every assertion below is something that
// renders perfectly in a browser when it is wrong:
//
//   a canonical naming another domain          200, looks right, invisible
//   a hero that lazy-loads above the fold      looks right, measures badly
//   a year read from the clock                 right until 1 January
//   "or contact leander plumbing gomanzo"      right unless you read it
//   a footer missing a legal page              nothing says so
//
//   node test-local-options-chrome.js

'use strict';

const assert = require('assert');

const {
  initials,
  addressQuery,
  header,
  footer,
  hero,
  onward,
  nap,
  hoursTable,
  mapFrame,
  document: docOf,
} = require('./utils/localOptions/render/chrome');

const { ring, LEGAL_SLUGS, urlFor, linkTo, assetTo } = require('./utils/localOptions/render/shape');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

function section(name) { console.log(`\n${name}\n`); }

const BUSINESS = {
  name: 'Leander Plumbing Gomanzo',
  short: 'Leander Plumbing',
  trade: 'plumbing',
  city: 'Leander',
  state: 'TX',
  street: '1804 S Bagdad Rd, Suite 120',
  zip: '78641',
  phone: '(512) 555-0164',
  tel: '+15125550164',
  social: {
    facebook: 'https://www.facebook.com/example',
    instagram: 'https://www.instagram.com/example',
    youtube: 'https://www.youtube.com/@example',
  },
};

const SERVICES = [
  { slug: 'water-heater-repair', name: 'Water Heater Repair and Replacement' },
  { slug: 'drain-cleaning', name: 'Drain Cleaning' },
  { slug: 'leak-detection', name: 'Leak Detection' },
  { slug: 'toilet-repair', name: 'Toilet Repair' },
  { slug: 'sewer-line-repair', name: 'Sewer Line Repair' },
  { slug: 'repiping', name: 'Whole House Repiping' },
];

const ORDER = ring(SERVICES);
const SITE = 'https://leander-plumbing.gomanzo.com';
const ALT = { 1: 'van outside', 2: 'under a sink', 3: 'bathroom pipework', 4: 'a wrench on supply lines' };

/* ------------------------------------------------------------------------ */

section('THE HEADER');

test('THE GLYPH COMES FROM THE BUSINESS NAME, not from a layout', () => {
  /* The mock-up had "LP" written into the header, which is correct for
   * exactly one client. */
  assert.strictEqual(initials('Leander Plumbing Gomanzo'), 'LP');
  assert.strictEqual(initials('Gomanzo'), 'G');
  assert.strictEqual(initials(''), '');
});

test('a logo replaces the glyph rather than sitting beside it', () => {
  /* 'assets/logo.png', WITH NO LEADING SLASH, because that is what
   * logoPathFor() in runLocalOptions.js actually produces. The fixture used
   * to carry a slash it never has, which is a fixture testing a value that
   * does not exist. */
  const withLogo = header({ business: BUSINESS, logo: 'assets/logo.png' });

  assert.ok(withLogo.includes('ledger-brand__mark'));
  assert.ok(!withLogo.includes('ledger-brand__glyph'));
});

test('AND IT CLIMBS OUT OF A SERVICE DIRECTORY LIKE EVERY OTHER ASSET', () => {
  /* THE ONE THE RELATIVE-PATHS CONVERSION MISSED. The logo was already
   * written relative — `assets/logo.png` — so it was never converted and
   * the suite's check for ABSOLUTE paths could not see it. From
   * /drain-cleaning/ it asked for /drain-cleaning/assets/logo.png: a 404 on
   * every service page, and a missing image in the corner of a header that
   * otherwise looks finished. */
  assert.ok(header({ business: BUSINESS, logo: 'assets/logo.png', depth: 1 })
    .includes('src="../assets/logo.png"'));

  assert.ok(header({ business: BUSINESS, logo: 'assets/logo.png', depth: 0 })
    .includes('src="assets/logo.png"'));
});

test('but one handed over absolute is left exactly as it was', () => {
  /* A full URL or a rooted path is somebody's deliberate choice, and
   * prefixing `../` onto it would break what works. */
  for (const given of ['/assets/logo.png', 'https://cdn.example.com/logo.png']) {
    assert.ok(header({ business: BUSINESS, logo: given, depth: 1 })
      .includes(`src="${given}"`), `${given} was rewritten`);
  }
});

test('THE NAV IS NAVIGATION, NOT THE RING', () => {
  /* Home, Services, Contact — on every page. The ring caps BODY links at
   * three; conflating the two is what made a home page link all six
   * services. */
  const html = header({ business: BUSINESS, current: 'index' });

  for (const label of ['Home', 'Services', 'Contact']) {
    assert.ok(html.includes(`>${label}<`), `the nav has no ${label}`);
  }
});

test('AND HOURS IS NOT ONE OF THEM', () => {
  /* It pointed at index#visit — a scroll from the home page, a trip to the
   * home page from anywhere else. Edwin, 28 October: "remove the hours tab
   * from the nav menu as is the same as the front page."
   *
   * ASSERTED ON THE <nav> ALONE, not on the whole header, because the word
   * belongs elsewhere on these pages: "Hours of operation" heads the table
   * that this link used to point at, and a check across the whole document
   * would fail for the right reason on the wrong element. */
  const nav = header({ business: BUSINESS, services: SERVICES })
    .match(/<nav class="ledger-menu"[\s\S]*?<\/nav>/)[0];

  assert.ok(!nav.includes('>Hours<'), 'Hours is still in the menu');
  assert.ok(!nav.includes('#visit'), 'the menu still links the hours section');
});

test('and it marks the page you are on', () => {
  assert.ok(header({ business: BUSINESS, current: 'contact' })
    .includes(`href="${linkTo('contact', 0)}" aria-current="page"`));
  assert.ok(!header({ business: BUSINESS, current: 'index' })
    .includes(`href="${linkTo('contact', 0)}" aria-current="page"`));
});

test('the phone number in the corner is a tel: link', () => {
  const html = header({ business: BUSINESS });

  assert.ok(html.includes('href="tel:+15125550164"'));
  assert.ok(html.includes('(512) 555-0164'));
});

test('ALL SIX SERVICES ARE IN THE MENU, which is what the nav is for', () => {
  /* THE BUG EDWIN FOUND BY LOOKING AT IT. "Services" was an anchor to
   * #services; the home page body links the first THREE because the ring
   * caps it there; so three of the six were reachable from the footer and
   * nowhere else. shape.js has stated "the nav and the footer carry all six"
   * since the day it was written — this is the assertion that makes the
   * sentence true. */
  const html = header({ business: BUSINESS, services: SERVICES, current: 'index' });

  for (const s of SERVICES) {
    assert.ok(html.includes(`>${s.name}<`), `${s.slug} is not in the menu`);
    assert.ok(html.includes(`href="${linkTo(s.slug, 0)}"`), `${s.slug} has no link in the menu`);
  }
});

test('and the #services anchor survives as the first item', () => {
  /* The summary is not a link, so without this the home page's own services
   * section lost its only menu entry. */
  const html = header({ business: BUSINESS, services: SERVICES });

  assert.ok(html.includes('ledger-drop__all'));
  assert.ok(html.includes(`href="${linkTo('index', 0)}#services">All services<`));
});

test('IT OPENS WITHOUT JAVASCRIPT, which is the whole reason it is a <details>', () => {
  /* These sites ship no script of any kind. A menu on :hover is unreachable
   * on a phone; a menu on a click handler needs a bundle that does not
   * exist. `details` opens on click, on tap and on Enter from the keyboard,
   * in every browser, for nothing. */
  const html = header({ business: BUSINESS, services: SERVICES });

  assert.ok(html.includes('<details class="ledger-drop"'));
  assert.ok(html.includes('<summary>Services</summary>'));

  assert.ok(!/<script/i.test(html), 'the header shipped a script');
  assert.ok(!/\son(click|mouseover|toggle)=/i.test(html), 'the header shipped an inline handler');
});

test('IT IS SHUT ON EVERY PAGE, the service pages included', () => {
  /* It was written `open` on the page it contains, which read well in the
   * markup and hung a white panel over the hero in the screenshot — over the
   * H1 itself on a phone. The hero is the largest element on the page and
   * the one the page is measured by. */
  for (const current of ['index', 'contact', 'drain-cleaning']) {
    const html = header({ business: BUSINESS, services: SERVICES, current, depth: 1 });

    assert.ok(html.includes('<details class="ledger-drop">'), `${current} opens the menu for you`);
    assert.ok(!/<details[^>]*\sopen/.test(html), `${current} opens the menu for you`);
  }
});

test('but it still marks the service page you are reading', () => {
  /* depth 1, because that is where a service page sits — pages.js passes
   * depthOf(slug), and a service page's own link to itself climbs out and
   * back in like every other link on it. */
  const html = header({ business: BUSINESS, services: SERVICES, current: 'drain-cleaning', depth: 1 });

  assert.ok(html.includes('href="../drain-cleaning/" aria-current="page"'));
});

test('a caller with no services gets the anchor back, not an empty panel', () => {
  /* An empty <details> is a control that opens onto nothing. */
  const html = header({ business: BUSINESS, services: [] });

  assert.ok(!html.includes('ledger-drop'));
  assert.ok(html.includes(`href="${linkTo('index', 0)}#services">Services<`));
});

test('the menu links climb out of a service directory, like everything else', () => {
  /* LITERAL, NOT COMPUTED. The render suite caught a mutation back to
   * absolute paths that this suite missed, because this one built its
   * expectations from linkTo() — the function under test. */
  const html = header({ business: BUSINESS, services: SERVICES, depth: 1 });

  assert.ok(html.includes('href="../drain-cleaning/"'), 'a menu link does not climb');
  assert.ok(!html.includes('href="/drain-cleaning/"'), 'a menu link is absolute');
});

/* ------------------------------------------------------------------------ */

section('THE FOOTER');

test('ALL SIX SERVICES ARE LINKED, which is the other half of the ring', () => {
  /* The ring shapes what the body passes on; the footer makes sure nothing
   * is unreachable. */
  const html = footer({ business: BUSINESS, services: SERVICES });

  for (const s of SERVICES) {
    assert.ok(html.includes(`href="${linkTo(s.slug, 0)}"`), `${s.slug} is not in the footer`);
  }
});

test('AND ALL THREE LEGAL PAGES', () => {
  const html = footer({ business: BUSINESS, services: SERVICES });

  for (const slug of LEGAL_SLUGS) {
    assert.ok(html.includes(`href="${linkTo(slug, 0)}"`), `${slug} is not in the footer`);
  }
});

test('THE YEAR IS AN ARGUMENT, NOT THE CLOCK', () => {
  /* The only thing on this site that changes without anybody editing it. A
   * renderer that reads the clock produces different bytes for the same
   * input, once a year, at midnight, for every site at once — which breaks
   * the "unchanged file costs nothing to re-upload" property. */
  const html = footer({
    business: BUSINESS, services: SERVICES, now: new Date('2031-06-02T00:00:00Z'),
  });

  assert.ok(html.includes('2031'), 'the year did not come from `now`');
});

test('a social link with no URL renders no icon', () => {
  const bare = footer({ business: { ...BUSINESS, social: {} }, services: SERVICES });

  assert.ok(!bare.includes('ledger-badges'));
});

test('and an unknown network is ignored rather than rendered empty', () => {
  const odd = footer({
    business: { ...BUSINESS, social: { tiktok: 'https://example.com/' } },
    services: SERVICES,
  });

  assert.ok(!odd.includes('tiktok'));
});

/* ------------------------------------------------------------------------ */

section('THE HERO');

test('it shows the photograph the rotation chose', () => {
  assert.ok(hero({ order: ORDER, slug: 'index', alt: ALT, business: BUSINESS })
    .includes(assetTo('assets/hero-1.webp', 0)));
  assert.ok(hero({ order: ORDER, slug: 'drain-cleaning', alt: ALT, business: BUSINESS })
    .includes(assetTo('assets/hero-3.webp', 0)));
});

test('with the alt text written for that photograph', () => {
  assert.ok(hero({ order: ORDER, slug: 'index', alt: ALT, business: BUSINESS })
    .includes('alt="van outside"'));
});

test('EAGER AND HIGH PRIORITY, because it is above the fold', () => {
  /* The largest element on the page and the one the page is measured by.
   * The mock-up wrote `fetchpriority if True else ''` — a decision that was
   * never actually made. */
  const html = hero({ order: ORDER, slug: 'index', alt: ALT, business: BUSINESS });

  assert.ok(html.includes('loading="eager"'));
  assert.ok(html.includes('fetchpriority="high"'));
  assert.ok(!html.includes('loading="lazy"'));
});

test('THE CALL BUTTON IS IN IT, which is section 1 of the ratified shape', () => {
  const html = hero({ order: ORDER, slug: 'water-heater-repair', alt: ALT, business: BUSINESS });

  assert.ok(html.includes('href="tel:+15125550164"'));
});

test('a page outside the ring gets no hero at all', () => {
  assert.strictEqual(hero({ order: ORDER, slug: 'privacy-policy', alt: ALT, business: BUSINESS }), '');
});

/* ------------------------------------------------------------------------ */

section('THE ONWARD SENTENCE');

test('it links home and on to the next page', () => {
  const html = onward({ order: ORDER, slug: 'drain-cleaning', business: BUSINESS, services: SERVICES });

  assert.ok(html.includes(`href="${linkTo('index', 0)}"`));
  assert.ok(html.includes(`href="${linkTo('leak-detection', 0)}"`));
  assert.ok(html.includes('leak detection'));
});

test('CONTACT IS NOT LOWERCASED INTO A SENTENCE', () => {
  /* titleOf('contact') is built from the business name, so lowercasing it
   * produced "or contact leander plumbing gomanzo". Contact gets its own
   * wording. */
  const html = onward({ order: ORDER, slug: 'repiping', business: BUSINESS, services: SERVICES });

  assert.ok(html.includes('get in touch'));
  assert.ok(!html.toLowerCase().includes('leander plumbing gomanzo'));
});

test('and the last page in the ring offers only home', () => {
  const html = onward({ order: ORDER, slug: 'contact', business: BUSINESS, services: SERVICES });

  assert.ok(html.includes(`href="${linkTo('index', 0)}"`));
  assert.ok(!html.includes(`href="${linkTo('contact', 0)}"`));
});

/* ------------------------------------------------------------------------ */

section('NAP, HOURS AND THE MAP');

test('the address reads as one line with no stray commas', () => {
  assert.strictEqual(addressQuery(BUSINESS),
    '1804 S Bagdad Rd, Suite 120, Leander, TX 78641');
});

test('a missing field does not leave a comma behind', () => {
  assert.strictEqual(addressQuery({ city: 'Leander', state: 'TX' }), 'Leander, TX');
});

test('the NAP phone is a tel: link, because it is on a phone', () => {
  assert.ok(nap({ business: BUSINESS }).includes('href="tel:+15125550164"'));
});

test('A DAY WITH NO HOURS SAYS "Closed", not nothing', () => {
  /* An empty cell is read as "we forgot". The owner typed the hours
   * precisely so nobody has to guess about Sunday. */
  const html = hoursTable({ hours: [
    { day: 'Saturday', open: '8:00 AM – 1:00 PM' },
    { day: 'Sunday', open: null },
  ] });

  assert.ok(html.includes('8:00 AM – 1:00 PM'));
  assert.ok(html.includes('Closed'));
});

test('THE MAP NEEDS NO API KEY, same embed as the main generator', () => {
  const html = mapFrame({ business: BUSINESS });

  assert.ok(html.includes('https://www.google.com/maps?q='));
  assert.ok(html.includes('output=embed'));
  assert.ok(!/key=/.test(html), 'an API key crept into the map URL');
});

test('and no address means no empty iframe', () => {
  assert.strictEqual(mapFrame({ business: {} }), '');
});

/* ------------------------------------------------------------------------ */

section('THE DOCUMENT');

test('THE CANONICAL IS ABSOLUTE AND NAMES THIS SITE', () => {
  /* Two of the four pages deployed on 27 October carried a canonical naming
   * somebody else's domain — one of them example.com. The page serves 200,
   * looks perfect, and tells Google to index something else. */
  const html = docOf({ site: SITE, slug: 'drain-cleaning', title: 'T', description: 'D', body: '' });

  assert.ok(html.includes(`<link rel="canonical" href="${SITE}/drain-cleaning/">`));
});

test('and og:url agrees with it, character for character', () => {
  const html = docOf({ site: SITE, slug: 'index', title: 'T', description: 'D', body: '' });

  const canonical = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
  const ogUrl = (html.match(/<meta property="og:url" content="([^"]+)"/) || [])[1];

  assert.strictEqual(canonical, `${SITE}/`);
  assert.strictEqual(ogUrl, canonical);
});

test('a trailing slash on the site does not produce a double one', () => {
  const html = docOf({ site: `${SITE}/`, slug: 'contact', title: 'T', description: 'D', body: '' });

  assert.ok(html.includes(`href="${SITE}/contact/"`));
  assert.ok(!html.includes('//contact'));
});

test('the stylesheet is linked, not inlined', () => {
  const html = docOf({ site: SITE, slug: 'index', title: 'T', description: 'D', body: '' });

  assert.ok(html.includes(`<link rel="stylesheet" href="${assetTo('assets/site.css', 0)}">`));
  assert.ok(!html.includes('<style'));
});

test('JSON-LD is emitted only when there is some', () => {
  const without = docOf({ site: SITE, slug: 'index', title: 'T', description: 'D', body: '' });
  const with_ = docOf({
    site: SITE, slug: 'index', title: 'T', description: 'D', body: '',
    jsonld: { '@type': 'Plumber' },
  });

  assert.ok(!without.includes('application/ld+json'));
  assert.ok(with_.includes('"@type":"Plumber"'));
});

test('A QUOTE IN THE TITLE CANNOT CLOSE THE ATTRIBUTE', () => {
  /* A business name with an apostrophe or a quote in it would end the meta
   * tag early and put the rest of the name into the markup as tags. */
  const html = docOf({
    site: SITE, slug: 'index', body: '',
    title: 'Bob\'s "Best" Plumbing', description: 'x',
  });

  assert.ok(html.includes('&#39;'));
  assert.ok(html.includes('&quot;'));
  assert.ok(!/content="[^"]*"[A-Za-z]/.test(html), 'an attribute was closed early');
});

/* ------------------------------------------------------------------------ */

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
