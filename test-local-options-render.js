// test-local-options-render.js
//
// The whole site, built from one fixture.
//
// THE SUITE THAT ASSERTS THE PRODUCT RATHER THAN A FUNCTION. shape.js and
// chrome.js are tested piece by piece; this builds all fifteen files and
// asks the questions a person would ask of the finished thing:
//
//   is every page there                are the canonicals right
//   does the home page link three      does the rotation show
//   is the schema on the right pages   is the 404 refusing to be indexed
//   does it build the same twice       is the legal text still templated
//
//   node test-local-options-render.js

'use strict';

const assert = require('assert');

const { renderSite } = require('./utils/localOptions/render/renderSite');
const {
  allPaths, fileFor, LEGAL_SLUGS, ring, linkTo, assetTo, depthOf,
} = require('./utils/localOptions/render/shape');

/** The slug a built file belongs to: 'contact/index.html' -> 'contact'. */
function pathSlug(path) {
  return 'index.html' === path ? 'index' : path.replace(/\/index\.html$/, '');
}
const { pagesToBuild, MODES } = require('./utils/seoPresets');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

function section(name) { console.log(`\n${name}\n`); }

/* ------------------------------------------------------------- the fixture */

const SLUGS = [
  'water-heater-repair', 'drain-cleaning', 'leak-detection',
  'toilet-repair', 'sewer-line-repair', 'repiping',
];

const SERVICES = SLUGS.map(slug => ({
  slug,
  name: slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  blurb: `A short line about ${slug.replace(/-/g, ' ')}`,
  h1: `${slug.replace(/-/g, ' ')} in Leander, TX`,
  meta: `Meta description for ${slug}`,
  sections: [
    { heading: '', paragraphs: ['The opening paragraph, which is the lead.'] },
    { heading: 'What people call about', paragraphs: ['Symptoms in their words.'] },
    { heading: 'What affects the cost', paragraphs: ['Age, access, a seized shutoff.'] },
  ],
}));

const BUSINESS = {
  name: 'Leander Plumbing Gomanzo',
  short: 'Leander Plumbing',
  trade: 'plumbing',
  city: 'Leander',
  state: 'TX',
  street: '1804 S Bagdad Rd',
  zip: '78641',
  phone: '(512) 555-0164',
  tel: '+15125550164',
  domain: 'leander-plumbing.gomanzo.com',
  social: { facebook: 'https://www.facebook.com/example' },
};

const SITE = 'https://leander-plumbing.gomanzo.com';

const INPUT = {
  url: SITE,
  business: BUSINESS,
  services: SERVICES,
  areas: ['Leander', 'Cedar Park', 'Liberty Hill', 'Austin'],
  hours: [
    { day: 'Monday', open: '7:00 AM – 6:00 PM' },
    { day: 'Saturday', open: '8:00 AM – 1:00 PM' },
    { day: 'Sunday', open: null },
  ],
  alt: { 1: 'van outside', 2: 'under a sink', 3: 'bathroom pipework', 4: 'a wrench' },
  /* A LOGO, SINCE 28 OCTOBER, AND ITS ABSENCE IS WHY THE SUITE MISSED ONE.
   *
   * Every assertion in this file ran against a site with no logo, so the one
   * asset path that never went through assetTo() was never rendered here at
   * all. Forty-two tests, and the broken thing was not in the output. */
  logo: 'assets/logo.png',
  home: {
    h1: 'Plumbing repair and installation in Leander, TX',
    sub: 'Same-week appointments across Leander, Cedar Park and Liberty Hill.',
    title: 'Leander Plumbing Gomanzo | Plumbing in Leander, TX',
    meta: 'Plumbing repair and installation in Leander, TX.',
    aboutHeading: 'A local plumbing company in Leander, TX',
    about: ['First paragraph.', 'Second paragraph.'],
  },
  now: new Date('2026-10-28T09:00:00Z'),
};

const FILES = renderSite(INPUT);
const PAGES = Object.keys(FILES).filter(p => p.endsWith('.html') && '404.html' !== p);

const jsonLd = html => {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1]) : null;
};

const canonicalOf = html => (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];

/* ------------------------------------------------------------------------ */

section('WHAT GETS WRITTEN');

test('THE ELEVEN PAGES, AND NOTHING MISSING', () => {
  for (const path of allPaths(SERVICES)) {
    assert.ok(FILES[path], `${path} was not written`);
  }
  assert.strictEqual(PAGES.length, 11);
});

test('and the eleven agree with pagesToBuild()', () => {
  assert.strictEqual(PAGES.length, pagesToBuild(MODES.LOCAL_OPTIONS, {}));
});

test('plus the stylesheet, the sitemap, robots and a 404', () => {
  for (const path of ['assets/site.css', 'sitemap.xml', 'robots.txt', '404.html']) {
    assert.ok(FILES[path], `${path} was not written`);
  }
  assert.strictEqual(Object.keys(FILES).length, 15);
});

test('THE 404 IS NOT ONE OF THE ELEVEN', () => {
  /* It is infrastructure, like the stylesheet. Counting it would make the
   * progress bar's denominator disagree with the price. */
  assert.ok(!allPaths(SERVICES).includes('404.html'));
});

test('nothing is empty', () => {
  for (const [path, body] of Object.entries(FILES)) {
    assert.ok(String(body).trim().length > 40, `${path} is empty or near it`);
  }
});

/* ------------------------------------------------------------------------ */

section('EVERY PAGE IS A WHOLE PAGE');

test('one <h1>, no more and no fewer', () => {
  for (const path of PAGES) {
    const n = (FILES[path].match(/<h1[\s>]/g) || []).length;
    assert.strictEqual(n, 1, `${path} has ${n} h1 elements`);
  }
});

test('THE CANONICAL ON EVERY PAGE NAMES THAT PAGE, ON THIS DOMAIN', () => {
  /* Two of the four pages deployed on 27 October carried a canonical naming
   * another domain. Both served 200 and looked perfect. */
  for (const slug of [...ring(SERVICES), ...LEGAL_SLUGS]) {
    const html = FILES[fileFor(slug)];
    const want = 'index' === slug ? `${SITE}/` : `${SITE}/${slug}/`;

    assert.strictEqual(canonicalOf(html), want, `${slug} has the wrong canonical`);
  }
});

test('and no page mentions another one of our domains', () => {
  /* The South Bay page on xmlguild.org, caught by exactly this shape of
   * check and not by looking at it. */
  for (const path of PAGES) {
    assert.ok(!/example\.com|southbayhomeinspections|journalsres|uclatv|xmlguild/.test(FILES[path]),
      `${path} names a domain that is not this site`);
  }
});

test('every page carries the skip link and the main landmark', () => {
  /* The accessibility page says both of these are true. A statement
   * describing a site that does not behave that way is worse than none. */
  for (const path of PAGES) {
    assert.ok(FILES[path].includes('ledger-skip'), `${path} has no skip link`);
    assert.ok(FILES[path].includes('<main id="main">'), `${path} has no main landmark`);
  }
});

test('and the footer, so nothing is ever unreachable', () => {
  for (const path of PAGES) {
    for (const slug of LEGAL_SLUGS) {
      /* linkTo WITH THE PAGE'S OWN DEPTH, not a literal `/slug/`.
       *
       * Every page links every legal page, but the href is now written from
       * where the linking page SITS: `privacy-policy/` from the root,
       * `../privacy-policy/` from a service page, `/privacy-policy/` from
       * the 404. Asserting one literal across all eleven tested only that
       * they were all absolute, which is the thing that was wrong. */
      const depth = '404.html' === path ? null : depthOf(pathSlug(path));

      assert.ok(FILES[path].includes(`href="${linkTo(slug, depth)}"`),
        `${path} does not link ${slug}`);
    }
  }
});

test('AND THE MENU, ON EVERY ONE OF THE ELEVEN, CARRYING ALL SIX', () => {
  /* THE ONE EDWIN FOUND BY LOOKING AT THE MENU ON A BUILT SITE.
   *
   * shape.js has said "the nav and the footer are navigation and carry all
   * six" since it was written. The footer did. The nav had an anchor to
   * #services, the home page body links the first THREE because the ring
   * caps it there, and so three service pages were reachable from the footer
   * and from nothing else.
   *
   * COUNTED INSIDE THE <nav>, off the built HTML. Asserting the six slugs
   * appear SOMEWHERE on the page would have passed before the change too —
   * the footer was always right. */
  for (const path of PAGES.concat('404.html')) {
    const depth = '404.html' === path ? null : depthOf(pathSlug(path));

    const nav = FILES[path].match(/<nav class="ledger-menu"[\s\S]*?<\/nav>/);

    assert.ok(nav, `${path} has no menu`);

    for (const slug of SLUGS) {
      assert.ok(nav[0].includes(`href="${linkTo(slug, depth)}"`),
        `${path}: the menu does not link ${slug}`);
    }
  }
});

test('and it needs no JavaScript, because there is none on these sites', () => {
  /* A disclosure built on a click handler needs a bundle these sites do not
   * have; one built on :hover is unreachable on a phone. <details> is
   * neither. test-inline-handlers.js makes the same check across the main
   * generator's templates. */
  for (const path of PAGES.concat('404.html')) {
    assert.ok(FILES[path].includes('<details class="ledger-drop"'), `${path} has no disclosure`);
    assert.ok(!/<script(?![^>]*application\/ld\+json)/i.test(FILES[path]), `${path} ships a script`);
    assert.ok(!/\son(click|toggle|mouseover)=/i.test(FILES[path]), `${path} has an inline handler`);
  }
});

section('SEARCH CONSOLE, WHICH EACH CLIENT OWNS FOR THEIR OWN SITE');

test('THE TAG IS ON EVERY PAGE, NOT ONLY THE HOME PAGE', () => {
  /* Google checks the property's own URL — for a site at
   * acme.com/quality-plumbing/ that is the home page. But a client may add
   * deeper pages as properties of their own, and Google re-checks
   * periodically: a tag present everywhere cannot quietly stop being where
   * it was looked for. */
  const verified = renderSite({ ...INPUT, verification: ['dK3xP9mQ2vR7nL4tY8wZ'] });

  for (const path of Object.keys(verified).filter(p => p.endsWith('.html'))) {
    assert.ok(
      verified[path].includes('<meta name="google-site-verification" content="dK3xP9mQ2vR7nL4tY8wZ">'),
      `${path} has no verification tag`
    );
  }
});

test('and a site without one carries no empty tag', () => {
  /* An empty content attribute is a tag Google reads and rejects, which is
   * worse than no tag: the property fails verification with something on
   * the page that looks like it should have worked. */
  assert.ok(!FILES['index.html'].includes('google-site-verification'));
});

test('TWO PROPERTIES CAN OWN ONE SITE', () => {
  /* Google matches ANY of the verification tags on a page, so the client's
   * own property and Edwin's oversight property can both be verified. The
   * blog side has worked this way since the field was built. */
  const two = renderSite({
    ...INPUT,
    verification: ['dK3xP9mQ2vR7nL4tY8wZ', 'aB1cD2eF3gH4iJ5kL6mN'],
  });

  assert.ok(two['index.html'].includes('content="dK3xP9mQ2vR7nL4tY8wZ"'));
  assert.ok(two['index.html'].includes('content="aB1cD2eF3gH4iJ5kL6mN"'));
});

test('A TOKEN IS ESCAPED ON ITS WAY INTO THE ATTRIBUTE', () => {
  /* TWO DEFENCES, DELIBERATELY. verificationTags.js refuses anything that is
   * not token-shaped before this is ever stored — and that is one validation
   * somebody relaxes while tidying. This is a published page on a client's
   * own domain, so the renderer escapes whatever it is handed. */
  const nasty = renderSite({ ...INPUT, verification: ['x" onload="alert(1)'] });

  assert.ok(!nasty['index.html'].includes('onload="alert(1)"'),
    'a token broke out of the attribute');
  assert.ok(nasty['index.html'].includes('&quot;'));
});

/* ------------------------------------------------------------------------ */

section('THE HOME PAGE');

test('SIX SERVICES SHOWN, TWO LINKED, IN THE BODY', () => {
  /* Counted off the built HTML, not off the data. Wrong twice, and
   * invisible both times.
   *
   * TWO SINCE 30 OCTOBER — Edwin: "could you make only the home page to
   * link to only 2 services instead of 3?" Six are still shown. */
  const list = FILES['index.html'].match(/<ul class="ledger-list">([\s\S]*?)<\/ul>/)[1];

  assert.strictEqual((list.match(/<li>/g) || []).length, 6);
  assert.strictEqual((list.match(/<li><a href=/g) || []).length, 2);
  assert.strictEqual((list.match(/<li><span class="ledger-list__row">/g) || []).length, 4);
});

test('THE SITE RE-RENDERS FROM ITS STORED SOURCE, BYTE FOR BYTE', () => {
  /* THE CHECK THAT MAKES _src/localoptions.json WORTH HAVING.
   *
   * Seven model calls, three minutes and 800 credits produce the words.
   * Before this they survived only inside the finished HTML, so changing a
   * template meant buying the prose again — the relative-paths fix on 28
   * October cost exactly that.
   *
   * utils/runLocalOptions.js stores renderSite()'s OWN ARGUMENT OBJECT, so
   * a re-render is renderSite(stored). This asserts that round trip is
   * byte-identical, which is the only thing that catches the failure mode
   * that matters: a field added to renderSite and not to the stored object
   * would re-render a site that quietly differs from the one the customer
   * paid for.
   *
   * THROUGH JSON, not by passing the object back. The file is what will be
   * read, and JSON.parse does not give back a Date — if `now` were stored
   * as one, this is where that shows up. */
  /* INPUT is the object the whole suite renders from, so this tests the
   * round trip of the SAME build every other assertion here describes. */
  const first = FILES;

  const stored = JSON.parse(JSON.stringify({
    ...INPUT,
    now: INPUT.now instanceof Date ? INPUT.now.toISOString() : INPUT.now,
  }));

  /* renderSite reads `now` as a Date. JSON gives back a string, so the
   * re-render has to revive it — which is a real step a caller must take,
   * and therefore a real thing to assert rather than hide. */
  const again = renderSite({ ...stored, now: new Date(stored.now) });

  assert.deepStrictEqual(Object.keys(again).sort(), Object.keys(first).sort(),
    're-rendering produced a different set of files');

  for (const path of Object.keys(first)) {
    assert.strictEqual(again[path], first[path], `${path} differs after a re-render`);
  }
});

test('EVERY PATH IS RELATIVE TO THE PAGE THAT WRITES IT', () => {
  /* THE BUG THIS REPLACES, and it had three faces.
   *
   * Every href and src in the site used to be absolute — `/contact/`,
   * `/assets/site.css` — which is correct only when the site is served at a
   * domain root. It is wrong opened from the filesystem, wrong under the
   * app's own /dist/user_<id>/ preview, and wrong on GITHUB PAGES, where a
   * project site lives at /<repo>/ and models/Job.js says this mode is
   * published. Edwin met it three times in one afternoon as an unstyled
   * page with a broken hero and a logo that worked — the logo being the one
   * path that happened to be written relative.
   *
   * ASSERTED OVER EVERY RENDERED PAGE rather than on the function, because
   * the last absolute href left after the conversion was in homeRows() —
   * invisible in a diff, obvious the moment every path was listed. */
  for (const path of PAGES) {
    if ('404.html' === path) continue;

    const absolute = [...new Set(
      (FILES[path].match(/(?:href|src)="\/[^"]*"/g) || [])
    )];

    assert.deepStrictEqual(absolute, [], `${path} still has absolute paths`);
  }
});

test('AND EVERY RELATIVE ONE RESOLVES TO SOMETHING THAT IS ACTUALLY THERE', () => {
  /* THE TEST ABOVE CANNOT SEE THE BUG THIS ONE IS FOR, and that is the whole
   * reason it exists.
   *
   * The logo was written `assets/logo.png` on every page, home page and
   * service page alike. It has no leading slash, so the absolute-path check
   * passes it. It is correct at the root and asks for
   * /drain-cleaning/assets/logo.png from a service page — a 404 that shows
   * as a missing image in the corner of a header that otherwise looks
   * finished.
   *
   *     "NOT ABSOLUTE" IS NOT "CORRECT".
   *     A PATH IS ONLY RIGHT RELATIVE TO THE PAGE THAT WROTE IT.
   *
   * So this resolves each one the way a browser would, against the directory
   * the page is served from, and asks whether the file is in the site. That
   * catches too few `../` and too many, which no prefix check can. */
  const assets = ['assets/logo.png'].concat(
    [1, 2, 3, 4].map(n => `assets/hero-${n}.webp`)
  );

  /* WHAT THE SITE ACTUALLY SERVES: the files renderSite returns, plus the
   * pictures heroes.js copies in beside them — which are not in FILES
   * because they are bytes, not rendered. */
  const present = new Set(Object.keys(FILES).concat(assets));

  for (const path of PAGES) {
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';

    const refs = [...new Set(
      [...FILES[path].matchAll(/(?:href|src)="([^"]+)"/g)].map(m => m[1])
    )];

    for (const ref of refs) {
      /* Off-site, on-page and non-navigational: a scheme, a bare fragment,
       * tel:, mailto:. */
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(ref)) continue;

      const [bare] = ref.split('#');

      if (!bare) continue;

      /* A browser resolves `../drain-cleaning/` against the page's own
       * directory. URL does exactly that, and does it the same way. */
      const resolved = new URL(bare, `http://x/${dir}`).pathname.replace(/^\//, '');

      /* A directory URL is served by its index.html. */
      const file = resolved.endsWith('/') || '' === resolved
        ? `${resolved}index.html`
        : resolved;

      assert.ok(present.has(file),
        `${path}: "${ref}" resolves to ${file}, which the site does not have`);
    }
  }
});

test('except 404.html, which has no fixed place to be relative to', () => {
  /* The server returns it for whatever URL was missing, so the browser
   * resolves `../` from a directory nobody chose. Absolute is the only form
   * that works from an arbitrary depth. */
  const html = FILES['404.html'];

  assert.ok(html.includes(`href="${linkTo('index', null)}"`), 'the 404 home link is not absolute');
  assert.ok(html.includes(`href="${assetTo('assets/site.css', null)}"`),
    'the 404 stylesheet is not absolute');
});

test('a service page climbs one level, the home page climbs none', () => {
  /* The two depths this site has. A single prefix for both would make one
   * of them wrong, and the pages are generated from one renderer. */
  const home = FILES['index.html'];
  const service = FILES[fileFor(SLUGS[0])];

  assert.ok(home.includes('href="assets/site.css"'), 'the home page climbs when it should not');
  assert.ok(service.includes('href="../assets/site.css"'), 'a service page does not climb');

  assert.ok(home.includes('href="contact/"'));
  assert.ok(service.includes('href="../contact/"'));

  assert.ok(!home.includes('"../'), 'the home page climbs above the site root');
});

test('but the canonical, the sitemap and the schema stay absolute', () => {
  /* THE HALF THAT MUST NOT MOVE. A canonical is a full URL by definition —
   * a relative one names a different page from every directory it appears
   * in, which is the opposite of what the tag is for. Same for the sitemap
   * and for the LocalBusiness image. urlFor() still exists for exactly
   * these three, which is why it was kept rather than replaced. */
  const canonical = FILES[fileFor(SLUGS[0])]
    .match(/<link rel="canonical" href="([^"]*)"/)[1];

  assert.ok(canonical.startsWith(`${SITE}/`), `canonical is ${canonical}`);
  assert.ok(FILES['sitemap.xml'].includes(`<loc>${SITE}/</loc>`));
  assert.ok(jsonLd(FILES['index.html']).image.startsWith(`${SITE}/`));
});

test('and the two linked are the first two', () => {
  const list = FILES['index.html'].match(/<ul class="ledger-list">([\s\S]*?)<\/ul>/)[1];

  for (const slug of SLUGS.slice(0, 2)) {
    assert.ok(list.includes(`<li><a href="${linkTo(slug, 0)}">`), `${slug} is not linked`);
  }

  /* linkTo(), NOT A HAND-WRITTEN "/slug/".
   *
   * This loop used to look for `href="/${slug}/"` — the ABSOLUTE form —
   * while the page writes relative hrefs. It could not have failed: a
   * fourth linked service would have been written as `drain-cleaning/` and
   * gone straight past it. The same shape as the logo that was "not
   * absolute" and therefore invisible to a check for absolute paths. */
  for (const slug of SLUGS.slice(2)) {
    assert.ok(!list.includes(`<li><a href="${linkTo(slug, 0)}">`),
      `${slug} is linked in the body`);
  }
});

test('THE HOURS ARE ON EVERY SERVICE PAGE, AS A TABLE', () => {
  /* They used to be a paragraph the model wrote, and in the 28 October run
   * it wrote the same address, towns and hours on all six. The table is the
   * same component the home page uses: the same facts read as reference in
   * a table and as copied prose in six paragraphs.
   *
   * Cutting the paragraph without this would have removed the hours from
   * service pages entirely — the footer carries the address, the towns and
   * the number, but not the hours. */
  for (const slug of SLUGS) {
    const html = FILES[fileFor(slug)];

    assert.ok(html.includes('Hours of operation'), `${slug} has no hours`);
    assert.ok(html.includes('Closed'), `${slug} does not say which day is closed`);
  }
});

test('and a business with no hours gets no empty table', () => {
  const noHours = renderSite({ ...INPUT, hours: [] });

  assert.ok(!noHours[fileFor(SLUGS[0])].includes('Hours of operation'));
});

test('the map and the hours are both on it', () => {
  assert.ok(FILES['index.html'].includes('ledger-map'));
  assert.ok(FILES['index.html'].includes('Hours of operation'));
  assert.ok(FILES['index.html'].includes('Closed'));
});

/* ------------------------------------------------------------------------ */

section('THE HERO ROTATION, READ OUT OF THE BUILT HTML');

test('1,2,3,4,1,2,3,4 ACROSS THE RING', () => {
  /* Edwin reported this broken twice and it was correct both times. Read
   * out of the files rather than computed, so the assertion cannot share a
   * formula with the code. */
  const seen = ring(SERVICES).map(slug => {
    const m = FILES[fileFor(slug)].match(/\/assets\/hero-(\d)\.webp/);
    return m ? Number(m[1]) : 0;
  });

  assert.deepStrictEqual(seen, [1, 2, 3, 4, 1, 2, 3, 4]);
});

test('AND A LEGAL PAGE HAS NO HERO AT ALL', () => {
  for (const slug of LEGAL_SLUGS) {
    assert.ok(!FILES[fileFor(slug)].includes('/assets/hero-'), `${slug} has a hero`);
  }
});

/* ------------------------------------------------------------------------ */

section('STRUCTURED DATA, ON THE RIGHT PAGES ONLY');

test('ONE LocalBusiness, ON THE HOME PAGE', () => {
  /* Repeating it on all eleven does not make it more true and gives a
   * crawler eleven entities to reconcile. */
  const home = jsonLd(FILES['index.html']);

  assert.strictEqual(home['@type'], 'Plumber');
  assert.strictEqual(home.url, `${SITE}/`);

  for (const slug of SLUGS) {
    assert.notStrictEqual(jsonLd(FILES[fileFor(slug)])['@type'], 'Plumber');
  }
});

test('THE BUSINESS IMAGE IS THE ONE THE TRADE FOLDER NAMED', () => {
  /* The fixture declares cover: 4. Hardcoding hero-1 passed every test in
   * this file until 28 October, when the pictures were reordered and the
   * business's photograph silently became a close-up of a wrench. */
  const withCover = renderSite({ ...INPUT, cover: 4 });

  assert.strictEqual(jsonLd(withCover['index.html']).image, `${SITE}/assets/hero-4.webp`);
});

test('and it falls back to the first picture when none is named', () => {
  assert.strictEqual(jsonLd(FILES['index.html']).image, `${SITE}/assets/hero-1.webp`);
});

test('a Service on each service page, naming its own URL', () => {
  for (const slug of SLUGS) {
    const ld = jsonLd(FILES[fileFor(slug)]);

    assert.strictEqual(ld['@type'], 'Service');
    assert.strictEqual(ld.url, `${SITE}/${slug}/`);
    assert.strictEqual(ld.provider['@type'], 'Plumber');
  }
});

test('NO FAQPage ANYWHERE, which is why there is no DataForSEO call', () => {
  for (const path of PAGES) {
    assert.ok(!FILES[path].includes('FAQPage'), `${path} has FAQ schema`);
  }
});

test('the opening hours drop the closed day rather than faking it', () => {
  /* "opens 00:00, closes 00:00" is read by some consumers as open all day,
   * which is the opposite of what the owner typed. */
  const spec = jsonLd(FILES['index.html']).openingHoursSpecification;

  assert.strictEqual(spec.length, 2);
  assert.ok(!spec.some(d => 'Sunday' === d.dayOfWeek));
  assert.strictEqual(spec[0].opens, '07:00');
  assert.strictEqual(spec[0].closes, '18:00');
});

test('and no legal page carries any schema at all', () => {
  for (const slug of LEGAL_SLUGS) {
    assert.strictEqual(jsonLd(FILES[fileFor(slug)]), null, `${slug} has JSON-LD`);
  }
});

/* ------------------------------------------------------------------------ */

section('THE CONTACT PAGE AND ITS FORM');

test('THE FORM IS MARKUP ONLY, AND SAYS SO LOUDLY', () => {
  /* Edwin, 26 October: "don't worry about processing the contact form. Just
   * add it even if it doesnt work." The action is a placeholder named
   * loudly enough that nobody mistakes it for working. */
  const html = FILES['contact/index.html'];

  assert.ok(html.includes('action="REPLACE_WITH_YOUR_FORM_ENDPOINT"'));
});

test('AND THE PHONE NUMBER IS BESIDE IT, so nobody reaches a dead end', () => {
  const html = FILES['contact/index.html'];
  const calls = (html.match(/href="tel:\+15125550164"/g) || []).length;

  assert.ok(calls >= 3, `only ${calls} tel: links on the contact page`);
});

test('no other page carries the placeholder', () => {
  for (const path of PAGES.filter(p => 'contact/index.html' !== p)) {
    assert.ok(!FILES[path].includes('REPLACE_WITH'), `${path} has a form placeholder`);
  }
});

/* ------------------------------------------------------------------------ */

section('THE LEGAL PAGES');

test('ALL THREE SAY THEY ARE NOT LEGAL ADVICE', () => {
  /* Templated, not model-written. A model inventing a privacy policy
   * describes practices the site does not have, and the liability sits with
   * the client. */
  for (const slug of LEGAL_SLUGS) {
    assert.ok(/not legal advice/i.test(FILES[fileFor(slug)]), `${slug} does not say so`);
  }
});

test('and the privacy policy declares the map, the one third party', () => {
  const html = FILES['privacy-policy/index.html'];

  assert.ok(/Google Maps/.test(html));
  assert.ok(/whether or not you interact/.test(html));
});

/* ------------------------------------------------------------------------ */

section('SITEMAP, ROBOTS AND THE 404');

test('the sitemap lists all eleven, legal pages included', () => {
  const locs = (FILES['sitemap.xml'].match(/<loc>[^<]+<\/loc>/g) || []);

  assert.strictEqual(locs.length, 11);
  for (const slug of LEGAL_SLUGS) {
    assert.ok(FILES['sitemap.xml'].includes(`<loc>${SITE}/${slug}/</loc>`), `${slug} is missing`);
  }
});

test('its lastmod comes from `now`, not from the clock', () => {
  assert.ok(FILES['sitemap.xml'].includes('<lastmod>2026-10-28</lastmod>'));
});

test('robots names the sitemap absolutely', () => {
  assert.ok(FILES['robots.txt'].includes(`Sitemap: ${SITE}/sitemap.xml`));
});

test('THE 404 REFUSES TO BE INDEXED', () => {
  /* A 404 that declares itself canonical is a 404 asking to be indexed. */
  assert.ok(FILES['404.html'].includes('<meta name="robots" content="noindex">'));
  assert.strictEqual(canonicalOf(FILES['404.html']), `${SITE}/`);
});

/* ------------------------------------------------------------------------ */

section('IT BUILDS THE SAME TWICE');

test('BYTE-IDENTICAL ON A SECOND RENDER', () => {
  /* Direct Upload hashes each file and skips the ones it already has. A
   * renderer that reads the clock re-sends the whole site on every deploy,
   * and nothing says so — the deploy just costs more and takes longer. */
  const again = renderSite(INPUT);

  assert.deepStrictEqual(Object.keys(again).sort(), Object.keys(FILES).sort());

  for (const path of Object.keys(FILES)) {
    assert.strictEqual(again[path], FILES[path], `${path} differs between two renders`);
  }
});

test('and a different `now` changes only the sitemap and the footer year', () => {
  const later = renderSite({ ...INPUT, now: new Date('2031-01-01T00:00:00Z') });

  const changed = Object.keys(FILES).filter(p => later[p] !== FILES[p]);

  assert.ok(changed.includes('sitemap.xml'));
  assert.ok(!changed.includes('assets/site.css'));
  assert.ok(!changed.includes('robots.txt'));
});

/* ------------------------------------------------------------------------ */

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
