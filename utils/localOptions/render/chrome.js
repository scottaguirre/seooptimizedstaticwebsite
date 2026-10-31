// utils/localOptions/render/chrome.js
//
// The parts of a Local Website Options page that are the same on every page:
// the header, the footer, the hero, the onward link, the NAP strip, the hours
// table, the map, and the document the body is wrapped in.
//
// PURE. Values in, a string out. Nothing here reads a file, a database or a
// clock it was not handed — see `now` on footer(), which exists so that two
// builds of the same site on either side of midnight on 31 December produce
// the same bytes rather than differing by a year.
//
// EVERYTHING COMES FROM THE BUSINESS. The mock-up hard-coded "Leander
// Plumbing", "Gomanzo" and the glyph "LP" into the header, and the areas
// served into the footer. Those are the client's, not the layout's.

'use strict';

const {
  esc,
  ring,
  ringNext,
  heroFor,
  urlFor,
  linkTo,
  assetTo,
  titleOf,
  LEGAL_SLUGS,
  PAGE_TITLES,
} = require('./shape');

const { CSS_PATH } = require('./theme');

/* SOCIAL, initials(), addressLine() and addressQuery() MOVED TO common.js on
 * 30 October. They are facts about the business, not about Ledger's markup,
 * and Beacon needs every one of them — importing them from this file would
 * have said something false about where they belong.
 *
 * STILL RE-EXPORTED BELOW, so nothing that imported them from here breaks. */
const {
  SOCIAL,
  initials,
  addressLine,
  addressQuery,
} = require('./common');

/**
 * The header.
 *
 * THE NAV IS NOT THE RING. It carries Home, Services and Contact on every
 * page — navigation, which every page gets, as against the BODY links the
 * ring caps at three. Conflating the two is what produced a home page
 * linking all six services.
 *
 * HOURS WAS THE FOURTH AND IS GONE — 28 October, Edwin: "remove the hours tab
 * from the nav menu as is the same as the front page."
 *
 * He is describing what the link did rather than what it was called. It
 * pointed at `index#visit`: from the home page a scroll, from anywhere else
 * a trip to the home page. A menu item that takes you to the page Home takes
 * you to is a second Home button wearing another word.
 *
 * NOTHING BECAME UNREACHABLE. The hours table is rendered on the home page,
 * on the contact page and on every service page that has hours, and the
 * schedule is in the JSON-LD besides. The link was a route to something
 * already in front of the reader.
 *
 * THE MOCK-UP BUILT A LIST OF THE FIRST THREE SERVICES HERE AND NEVER USED
 * IT. A `links` variable, computed from SERVICES[:3], dropped on the floor
 * two lines later — the same shape as the `first_three` that was computed
 * and ignored while the loop below it enumerated all six. Not transcribed.
 *
 * AND THE NAV DID NOT ACTUALLY CARRY THE SERVICES UNTIL 28 OCTOBER, which is
 * the rule shape.js states and this file broke. "Services" was an anchor to
 * #services on the home page, the home page BODY links only the first three
 * because the ring caps it there, and the footer was the only place the other
 * three appeared at all. Edwin, having looked at the menu on a built site:
 * "look at the menu."
 *
 *     A COMMENT DESCRIBING A RULE IS NOT THE RULE.
 *     THE ONLY PLACE THE NAV CARRIED SIX WAS THE COMMENT SAYING IT DID.
 *
 * `<details>`/`<summary>`, AND NOT A SCRIPT. These sites ship no JavaScript
 * at all — there is no bundle, no inline handler and nothing to break with
 * one — and `details` gives a disclosure that opens on click, on tap, and on
 * Enter or Space from the keyboard, in every browser, for free. A menu built
 * on :hover would have been unreachable on a phone and invisible to a
 * keyboard.
 *
 * THE #services ANCHOR SURVIVES AS THE FIRST ITEM in the panel, so the
 * summary replacing a link costs nothing.
 */
function header({ business = {}, logo = '', current = '', services = [], depth = 0 } = {}) {
  /* THE LOGO GOES THROUGH assetTo() LIKE EVERY OTHER ASSET, and it was the
   * last one that did not.
   *
   * The 27 October conversion to relative paths moved the stylesheet, the
   * heroes and every link. It did not move the logo, because the logo was
   * ALREADY relative — `assets/logo.png`, written that way from the start —
   * and the test that found the others only looks for paths beginning with
   * a slash. A relative path that is not re-based for depth is invisible to
   * a check for absolute ones.
   *
   *     `assets/logo.png` IS CORRECT AT THE ROOT AND WRONG EVERYWHERE ELSE.
   *     FROM /drain-cleaning/ IT ASKS FOR /drain-cleaning/assets/logo.png.
   *
   * Edwin found it in a python http.server log: 200 for the home page, 404
   * for the same file from all six service pages. In a browser it is a
   * missing image in the corner of a header that otherwise looks finished.
   *
   * A logo that is already absolute — a leading slash, or a full URL — is
   * left exactly as it was handed over. */
  const src = logo && !/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(logo) && !logo.startsWith('/')
    ? assetTo(logo, depth)
    : logo;

  /* THE LOGO STANDS ALONE. THE GLYPH DOES NOT — 28 October, Edwin, looking
   * at a built header: "The logo should not have the business name next to
   * it. It should be only the logo and right now it looks tiny but if we
   * remove the business name maybe the size gets fixed."
   *
   * Both halves of that are right, and the second is the cause of the first.
   * The mark was boxed at 42x42 with object-fit:contain, which is correct
   * for a square mark and ruinous for the wide lockup most trade logos
   * actually are: a 400x90 image letterboxed into a 42px square renders
   * about 42x9, and the name beside it was doing the work the logo was
   * hired for. theme.js now fixes the HEIGHT and lets the width follow the
   * logo's own proportions.
   *
   * THE NAME IS NOT LOST, IT MOVES INTO THE ALT TEXT — which is what a
   * screen reader announces and what a search engine reads, so the header
   * still says who this is to everything that cannot see it.
   *
   *     A LOGO IS A WORDMARK. SETTING IT BESIDE THE WORDS
   *     IT CONTAINS IS PRINTING THE NAME TWICE.
   *
   * THE SIZE ATTRIBUTES ARE GONE WITH IT. 42x42 on an image that is not
   * square tells the browser to reserve the wrong shape. Nothing shifts
   * vertically for want of them: .ledger-head__row has min-height 76px, so
   * the header's height is settled before the logo loads.
   *
   * A BUSINESS WITH NO LOGO IS UNCHANGED — initials in a tinted square, with
   * the name beside them, because two letters identify nobody on their own. */
  const mark = logo
    ? `<img class="ledger-brand__mark" src="${esc(src)}" alt="${esc(business.name || '')}">`
    : `<span class="ledger-brand__glyph">${esc(initials(business.name))}</span>`;

  const here = slug => (current === slug ? ' aria-current="page"' : '');

  /* ALL OF THEM, NOT THE FIRST THREE. This is navigation. The cap belongs to
   * the body, where it shapes what each page passes on. */
  const dropItems = services
    .map(s => `<li><a href="${linkTo(s.slug, depth)}"${here(s.slug)}>${esc(s.name)}</a></li>`)
    .join('');

  /* SHUT ON EVERY PAGE, INCLUDING THE SERVICE PAGES.
   *
   * It was written open on the page it contains — so a visitor could see
   * where they were without opening it — and the screenshot settled it: the
   * panel hangs over the hero, which is the largest element on the page and
   * the one the page is measured by. On a phone it covered the H1 outright.
   *
   *     A MENU THAT IS OPEN BEFORE ANYONE ASKED
   *     IS NOT A MENU, IT IS A PANEL OVER THE PAGE.
   *
   * aria-current still marks the page inside it, which is what a visitor who
   * opens the menu actually needs. */
  const menu = dropItems
    ? `<details class="ledger-drop">
      <summary>Services</summary>
      <ul class="ledger-drop__list">
        <li class="ledger-drop__all"><a href="${linkTo('index', depth)}#services">All services</a></li>
        ${dropItems}
      </ul>
    </details>`
    /* NO SERVICES MEANS NO PANEL, AND THE ANCHOR COMES BACK. An empty
     * `details` is a control that opens onto nothing. The legal pages and the
     * 404 are rendered with the same context as every other page, so this
     * branch is only reached by a caller that passed none — the suite, and
     * any future structure built before its services exist. */
    : `<a href="${linkTo('index', depth)}#services">Services</a>`;

  return `
<a class="ledger-skip" href="#main">Skip to content</a>
<header class="ledger-head"><div class="ledger-shell ledger-head__row">
  <a class="ledger-brand" href="${linkTo('index', depth)}">
    ${mark}${logo ? '' : `
    <span class="ledger-brand__name">${esc(business.short || business.name || '')}${
      business.short && business.name && business.short !== business.name
        ? `<small>${esc(business.name.replace(business.short, '').trim())}</small>`
        : ''
    }</span>`}
  </a>
  <nav class="ledger-menu" aria-label="Main">
    <a href="${linkTo('index', depth)}"${here('index')}>Home</a>
    ${menu}
    <a href="${linkTo('contact', depth)}"${here('contact')}>Contact</a>
  </nav>
  <a class="ledger-ring" href="tel:${esc(business.tel || '')}">${esc(business.phone || '')}</a>
</div></header>`;
}

/**
 * The footer.
 *
 * ALL SIX SERVICES AND ALL THREE LEGAL PAGES, as links, on every page. This
 * is the other half of the point above: the ring shapes what the BODY passes
 * on, and the footer makes sure nothing is unreachable.
 *
 * `now` IS AN ARGUMENT. The copyright year is the only thing on this site
 * that changes without anybody editing it, and a renderer that reads the
 * clock produces different bytes for the same input — which breaks the
 * "unchanged file costs nothing to re-upload" property the deploy relies on,
 * once a year, at midnight, for everybody at once.
 */
function footer({ business = {}, services = [], areas = [], now = new Date(), depth = 0 } = {}) {
  const social = Object.entries(business.social || {})
    .filter(([key, href]) => SOCIAL[key] && href)
    .map(([key, href]) => {
      const { viewBox, path } = SOCIAL[key];
      const label = key[0].toUpperCase() + key.slice(1);

      return `<a href="${esc(href)}" rel="noopener" aria-label="${esc(label)}">`
        + `<svg viewBox="${viewBox}" aria-hidden="true"><path d="${path}"/></svg></a>`;
    }).join('');

  const serviceLinks = services
    .map(s => `<li><a href="${linkTo(s.slug, depth)}">${esc(s.name)}</a></li>`).join('');

  const legalLinks = LEGAL_SLUGS
    .map(slug => `<li><a href="${linkTo(slug, depth)}">${esc(PAGE_TITLES[slug] || slug)}</a></li>`).join('');

  const where = areas.filter(Boolean);

  return `
<footer class="ledger-foot"><div class="ledger-shell">
  <div class="ledger-foot__spread">
    <div>
      <h2>${esc(business.name || '')}</h2>
      <p>${esc(business.street || '')}<br>${esc([business.city, business.state].filter(Boolean).join(', '))} ${esc(business.zip || '')}<br>
         <a href="tel:${esc(business.tel || '')}">${esc(business.phone || '')}</a></p>
      ${social ? `<p class="ledger-badges">${social}</p>` : ''}
    </div>
    <div><h2>Services</h2><ul>${serviceLinks}</ul></div>
    <div><h2>Company</h2><ul>
      <li><a href="${linkTo('index', depth)}">Home</a></li><li><a href="${linkTo('contact', depth)}">Contact</a></li>${legalLinks}
    </ul></div>
  </div>
  <p class="ledger-foot__base">
    <span>&copy; ${now.getFullYear()} ${esc(business.name || '')}</span>
    ${where.length ? `<span>Serving ${esc(where.join(', '))}</span>` : ''}
  </p>
</div></footer>`;
}

/**
 * The hero: one photograph, the H1, one line, and two buttons.
 *
 * THE CALL BUTTON IS ABOVE THE FOLD, which is section 1 of the ratified
 * service-page shape. On a phone the band is 280px and the card overlaps it,
 * so the number is on screen without scrolling.
 *
 * loading="eager" AND fetchpriority="high", on every page that has a hero.
 * It is the largest element and the one the page is measured by; lazy-loading
 * the thing above the fold is the most common way to lose that measurement.
 * The mock-up wrote `' fetchpriority="high"' if True else ''`, which is a
 * decision that was never made.
 */
function hero({ order = [], slug = '', h1 = '', sub = '', alt = {}, business = {}, depth = 0 } = {}) {
  const n = heroFor(order, slug);

  if (!n) return '';

  return `
<section class="ledger-hero">
  <div class="ledger-hero__band">
    <img src="${assetTo(`assets/hero-${n}.webp`, depth)}" width="1200" height="800" alt="${esc(alt[n] || '')}"
         loading="eager" fetchpriority="high" decoding="async">
  </div>
  <div class="ledger-shell">
    <div class="ledger-hero__card">
      <h1>${esc(h1)}</h1>
      <p>${esc(sub)}</p>
      <p class="ledger-acts">
        <a class="ledger-act ledger-act--fill" href="tel:${esc(business.tel || '')}">Call ${esc(business.phone || '')}</a>
        <a class="ledger-act ledger-act--line" href="${linkTo('contact', depth)}">Ask a question</a>
      </p>
    </div>
  </div>
</section>`;
}

/**
 * The ring, written as a sentence rather than a bare nav list.
 *
 * LOWERCASING THE TITLE WORKS FOR A SERVICE AND NOT FOR A NAME. "or contact
 * leander plumbing gomanzo" is what the first version produced, because
 * contact's title is built from the business name. Contact gets its own
 * wording instead.
 */
function onward({ order = [], slug = '', business = {}, services = [], depth = 0 } = {}) {
  const next = ringNext(order, slug);
  const home = `<a href="${linkTo('index', depth)}">back to the home page</a>`;

  if (!next) {
    return `<div class="ledger-onward"><p>Or go ${home}.</p></div>`;
  }

  const label = 'contact' === next
    ? 'get in touch'
    : titleOf(next, { business, services }).toLowerCase();

  return `<div class="ledger-onward"><p>Not what you were after? Go ${home}`
    + ` or <a href="${linkTo(next, depth)}">${esc(label)}</a>.</p></div>`;
}

/** Name, address and phone, on one strip, on the home and contact pages. */
function nap({ business = {} } = {}) {
  return `
<div class="ledger-shell">
  <dl class="ledger-nap">
    <div><dt>Business</dt><dd>${esc(business.name || '')}</dd></div>
    <div><dt>Address</dt><dd>${esc(addressQuery(business))}</dd></div>
    <div><dt>Phone</dt><dd><a href="tel:${esc(business.tel || '')}">${esc(business.phone || '')}</a></dd></div>
  </dl>
</div>`;
}

/**
 * The hours table.
 *
 * A DAY WITH NO HOURS READS "Closed", not an empty cell. An empty cell is
 * read as "we forgot", and the owner typed the hours precisely so that
 * nobody has to guess about Sunday.
 */
function hoursTable({ hours = [] } = {}) {
  const rows = hours.map(({ day, open }) => (open
    ? `<tr><td>${esc(day)}</td><td>${esc(open)}</td></tr>`
    : `<tr><td>${esc(day)}</td><td class="ledger-shut">Closed</td></tr>`)).join('');

  return `
<div class="ledger-hours">
  <h2>Hours of operation</h2>
  <table>${rows}</table>
</div>`;
}

/**
 * The map.
 *
 * THE SAME EMBED AS THE MAIN GENERATOR — utils/googleMap.js — and no API
 * key, which is why it costs nothing and cannot be rate-limited.
 *
 * BUILT HERE RATHER THAN IMPORTED, for two reasons worth writing down
 * instead of quietly diverging over: googleMap() is `async` for no reason a
 * renderer can satisfy, and it requires getCoordinatesFromAddress — a
 * geocoder it never calls, which carries the placeholder Nominatim
 * User-Agent still listed as open in CLAUDE.md. The URL is identical.
 */
function mapFrame({ business = {} } = {}) {
  const where = addressQuery(business);

  if (!where) return '';

  const src = `https://www.google.com/maps?q=${encodeURIComponent(where)}&z=15&output=embed`;

  return `
<div class="ledger-map">
  <iframe title="Map showing ${esc(business.name || '')}" loading="lazy"
    referrerpolicy="no-referrer-when-downgrade"
    src="${esc(src)}"></iframe>
</div>`;
}

/**
 * The page, head and all.
 *
 * THE CANONICAL IS ABSOLUTE AND BUILT FROM THE SITE'S OWN DOMAIN. Four
 * domains were migrated on 27 October and two of the pages on them carried a
 * canonical naming somebody else's — one of them `example.com`. A page with
 * the wrong canonical serves 200, looks perfect, and is invisible.
 */
function document({
  site = '', slug = '', title = '', description = '',
  body = '', jsonld = null, head = '', depth = 0, verification = [],
} = {}) {
  /* THE CANONICAL STAYS ABSOLUTE, and urlFor() is why both functions exist.
   * A canonical is a full URL by definition — a relative one would name a
   * different page from every directory it appeared in, which is the exact
   * opposite of what the tag is for. Same for og:url below. */
  const canonical = `${String(site).replace(/\/$/, '')}${urlFor(slug)}`;

  const ld = jsonld
    ? `\n<script type="application/ld+json">${JSON.stringify(jsonld)}</script>`
    : '';

  /* SEARCH CONSOLE, ON EVERY PAGE.
   *
   * THE TAG IS BUILT HERE AND THE TOKEN IS ESCAPED, which is two defences
   * for one value. utils/blog/verificationTags.js already refused anything
   * that was not token-shaped before this was stored — this is the second,
   * because the parser is one validation somebody relaxes while tidying and
   * the result is customer-supplied text in an attribute on a public page.
   *
   * EVERY PAGE, NOT ONLY THE HOME PAGE. Google checks the property's own
   * URL, which for a site at acme.com/quality-plumbing/ is that page — but
   * a client may also add the deeper pages as their own properties, and
   * Google re-checks periodically. A tag present everywhere cannot quietly
   * stop being where it was looked for. */
  const verify = (verification || [])
    .map(token => `\n<meta name="google-site-verification" content="${esc(token)}">`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<link rel="stylesheet" href="${assetTo(CSS_PATH, depth)}">${verify}${head}${ld}
</head>
<body>
${body}
</body>
</html>
`;
}

module.exports = {
  SOCIAL,
  initials,
  addressLine,
  addressQuery,
  header,
  footer,
  hero,
  onward,
  nap,
  hoursTable,
  mapFrame,
  document,
};
