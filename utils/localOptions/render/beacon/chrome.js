// utils/localOptions/render/beacon/chrome.js
//
// Beacon's furniture: masthead, strip, banner, colophon, and the document.
//
// WHAT BEACON IS. The second structure, asked for on 30 October: "I want a
// different html structure, diferent css and different classes and prefix and
// css IDs, Different prompts. Keep the same sections."
//
// So the eleven pages are the same eleven, the sections inside them are the
// same sections, and nothing below shares a class, an id or an element with
// Ledger. Where Ledger has a sticky bar and a hero card overlapping a band,
// Beacon has a masthead with a fact strip under it and a banner with the
// photograph beside the words. Where Ledger numbers its services 01..06 in a
// list, Beacon lays them out as tiles. Where Ledger puts hours in a table,
// Beacon puts them in a slate of rows.
//
// EVERY CLASS IS `beacon-`. That is not tidiness — see the note at the top of
// theme.js. Two stylesheets sharing a namespace cannot sit in one repository:
// a rule written for one silently restyles the other, and both are served as
// assets/site.css to different sites built by the same code.
//
// THE IDS DIFFER TOO, which matters more than it looks. `#main` is the skip
// link's target and `#services` is linked from the header on every page; a
// structure that reused them would work, and would mean the two layouts could
// never be told apart by a fragment in a URL somebody bookmarked.
//
// NO CLOCK, NO "OPEN NOW". The strip carries the address, the areas and the
// number — facts that are true whenever the page is read. The mock-up's
// open/shut state would have to be computed at BUILD time and baked into a
// static file, so a site built on a Tuesday morning would tell a Sunday
// visitor it was open.
//
// PURE. Values in, a string out.

'use strict';

const {
  esc,
  ringNext,
  heroFor,
  urlFor,
  linkTo,
  assetTo,
  titleOf,
  LEGAL_SLUGS,
  PAGE_TITLES,
} = require('../shape');

const { CSS_PATH } = require('../theme');
const { SOCIAL, initials, addressQuery } = require('../common');

/** Beacon's own ids, in one place so nothing collides with Ledger's. */
const MAIN_ID = 'content';
const TRADES_ID = 'trades';
const WHERE_ID = 'whereabouts';

/**
 * The masthead and the strip beneath it.
 *
 * TWO ROWS, WHICH IS THE STRUCTURAL DIFFERENCE FROM LEDGER. Ledger carries
 * the brand, the menu and the number on one sticky row. Beacon puts the brand
 * and the menu on a masthead that scrolls away, and a strip under it holding
 * the facts a visitor is actually hunting for — where you are, who you serve,
 * what to ring.
 *
 * THE NAV CARRIES ALL SIX SERVICES, as Ledger's does. It is navigation; the
 * three-link cap belongs to the body, where it shapes what each page passes
 * on. The rule is stated in shape.js and was broken once already by a file
 * whose comment said it was obeying it.
 *
 * `<details>`/`<summary>`, AND NOT A SCRIPT. These sites ship no JavaScript
 * at all. `details` gives a disclosure that opens on click, on tap and on
 * Enter or Space from the keyboard, in every browser, for nothing. A menu on
 * :hover would be unreachable on a phone and invisible to a keyboard.
 */
function header({
  business = {}, logo = '', current = '', services = [], areas = [], depth = 0,
} = {}) {
  /* THE LOGO IS RE-BASED FOR DEPTH, like every other asset. A relative path
   * that is not re-based is correct at the root and wrong everywhere else:
   * `assets/logo.png` from /drain-cleaning/ asks for
   * /drain-cleaning/assets/logo.png. Ledger shipped that bug for a day and
   * it was found in a python http.server log — 200 for the home page, 404
   * for the same file from all six service pages.
   *
   * An already-absolute logo is left exactly as it was handed over. */
  const src = logo && !/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(logo) && !logo.startsWith('/')
    ? assetTo(logo, depth)
    : logo;

  /* THE LOGO STANDS ALONE AND THE GLYPH DOES NOT. A logo is a wordmark;
   * setting it beside the words it contains prints the name twice. The name
   * moves into the alt text, which is what a screen reader announces and
   * what a search engine reads. A business with no logo gets initials and
   * the name, because two letters identify nobody on their own. */
  const mark = logo
    ? `<img class="beacon-brand__mark" src="${esc(src)}" alt="${esc(business.name || '')}">`
    : `<span class="beacon-brand__glyph">${esc(initials(business.name))}</span>`;

  const here = slug => (current === slug ? ' aria-current="page"' : '');

  const tradeItems = services
    .map(s => `<li><a href="${linkTo(s.slug, depth)}"${here(s.slug)}>${esc(s.name)}</a></li>`)
    .join('');

  /* SHUT ON EVERY PAGE. A disclosure that is open before anyone asked is not
   * a menu, it is a panel over the page — and on a phone it covers the H1.
   * aria-current still marks the page inside it, which is what a visitor who
   * opens the menu needs. */
  const menu = tradeItems
    ? `<details class="beacon-trades">
      <summary>What we do</summary>
      <ul class="beacon-trades__list">
        <li class="beacon-trades__all"><a href="${linkTo('index', depth)}#${TRADES_ID}">Everything we do</a></li>
        ${tradeItems}
      </ul>
    </details>`
    /* NO SERVICES MEANS NO PANEL. An empty `details` is a control that opens
     * onto nothing. Only a caller that passed none reaches this — the suite,
     * and any future structure built before its services exist. */
    : `<a href="${linkTo('index', depth)}#${TRADES_ID}">What we do</a>`;

  const where = areas.filter(Boolean);

  return `
<a class="beacon-flag" href="#${MAIN_ID}">Skip to content</a>
<header class="beacon-masthead">
  <div class="beacon-shell beacon-masthead__row">
    <a class="beacon-brand" href="${linkTo('index', depth)}">
      ${mark}${logo ? '' : `
      <span class="beacon-brand__name">${esc(business.name || '')}</span>`}
    </a>
    <nav class="beacon-menu" aria-label="Main">
      <a href="${linkTo('index', depth)}"${here('index')}>Home</a>
      ${menu}
      <a href="${linkTo('contact', depth)}"${here('contact')}>Contact</a>
    </nav>
  </div>
</header>
<div class="beacon-strip"><div class="beacon-shell beacon-strip__row">
  <p class="beacon-strip__where">${esc(addressQuery(business))}</p>
  ${where.length ? `<p class="beacon-strip__open">Serving ${esc(where.join(' · '))}</p>` : ''}
  <a class="beacon-ring" href="tel:${esc(business.tel || '')}">${esc(business.phone || '')}</a>
</div></div>`;
}

/**
 * The colophon.
 *
 * ALL SIX SERVICES AND ALL THREE LEGAL PAGES, on every page. The ring shapes
 * what the BODY passes on; this is what makes sure nothing is unreachable.
 *
 * `now` IS AN ARGUMENT. The copyright year is the only thing on the site that
 * changes without anybody editing it, and a renderer that reads the clock
 * produces different bytes for the same input — which breaks the "unchanged
 * file costs nothing to re-upload" property the deploy relies on, once a
 * year, at midnight, for everybody at once.
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

  const tradeLinks = services
    .map(s => `<li><a href="${linkTo(s.slug, depth)}">${esc(s.name)}</a></li>`).join('');

  const legalLinks = LEGAL_SLUGS
    .map(slug => `<li><a href="${linkTo(slug, depth)}">${esc(PAGE_TITLES[slug] || slug)}</a></li>`).join('');

  const where = areas.filter(Boolean);

  return `
<footer class="beacon-colophon"><div class="beacon-shell">
  <div class="beacon-colophon__spread">
    <div>
      <h2 class="beacon-colophon__title">${esc(business.name || '')}</h2>
      <p>${esc(business.street || '')}<br>${esc([business.city, business.state].filter(Boolean).join(', '))} ${esc(business.zip || '')}</p>
      <p><a href="tel:${esc(business.tel || '')}">${esc(business.phone || '')}</a></p>
      ${social ? `<p class="beacon-badges">${social}</p>` : ''}
    </div>
    <div><h2 class="beacon-colophon__title">What we do</h2><ul>${tradeLinks}</ul></div>
    <div><h2 class="beacon-colophon__title">This site</h2><ul>
      <li><a href="${linkTo('index', depth)}">Home</a></li><li><a href="${linkTo('contact', depth)}">Contact</a></li>${legalLinks}
    </ul></div>
  </div>
  <p class="beacon-colophon__foot">
    <span>&copy; ${now.getFullYear()} ${esc(business.name || '')}</span>
    ${where.length ? `<span>${esc(where.join(', '))}</span>` : ''}
  </p>
</div></footer>`;
}

/**
 * The banner: the photograph beside the words, not behind them.
 *
 * THE OTHER VISIBLE DIFFERENCE FROM LEDGER, whose hero is a full-width band
 * with a card overlapping its lower edge. Beacon sets the plate — headline,
 * line, two buttons — next to the picture, so the H1 is never over an image
 * and never needs a scrim to stay readable.
 *
 * THE CALL BUTTON IS STILL ABOVE THE FOLD, which is section 1 of the ratified
 * service-page shape. On a phone the two stack with the words first, so the
 * number is on screen without scrolling.
 *
 * loading="eager" AND fetchpriority="high". It is the largest element and the
 * one the page is measured by; lazy-loading the thing above the fold is the
 * commonest way to lose that measurement.
 */
function banner({ order = [], slug = '', h1 = '', sub = '', alt = {}, business = {}, depth = 0 } = {}) {
  const n = heroFor(order, slug);

  const plate = `
    <div class="beacon-banner__plate">
      <h1>${esc(h1)}</h1>
      <p class="beacon-banner__said">${esc(sub)}</p>
      <p class="beacon-banner__acts">
        <a class="beacon-act beacon-act--solid" href="tel:${esc(business.tel || '')}">Call ${esc(business.phone || '')}</a>
        <a class="beacon-act beacon-act--hollow" href="${linkTo('contact', depth)}">Ask a question</a>
      </p>
    </div>`;

  /* NO PHOTOGRAPH IS NOT NO BANNER. Ledger returns an empty string when a
   * page is outside the hero rotation, which leaves its H1 to the body. On
   * Beacon the plate IS the H1, so a page with no picture keeps the plate
   * and loses only the image column. */
  const picture = n
    ? `<div class="beacon-banner__plan">
      <img src="${assetTo(`assets/hero-${n}.webp`, depth)}" width="1200" height="800"
           alt="${esc(alt[n] || '')}" loading="eager" fetchpriority="high" decoding="async">
    </div>`
    : '';

  return `
<section class="beacon-banner${n ? '' : ' beacon-banner--bare'}"><div class="beacon-shell beacon-banner__row">
  ${plate}${picture}
</div></section>`;
}

/**
 * The ring, as a sentence.
 *
 * LOWERCASING THE TITLE WORKS FOR A SERVICE AND NOT FOR A NAME. "or contact
 * leander plumbing gomanzo" is what Ledger's first version produced, because
 * contact's title is built from the business name. Contact gets its own
 * wording instead, and Beacon inherits the lesson rather than the bug.
 */
function onward({ order = [], slug = '', business = {}, services = [], depth = 0 } = {}) {
  const next = ringNext(order, slug);
  const home = `<a href="${linkTo('index', depth)}">the home page</a>`;

  if (!next) {
    return `<p class="beacon-kicker">Or go back to ${home}.</p>`;
  }

  const label = 'contact' === next
    ? 'get in touch'
    : titleOf(next, { business, services }).toLowerCase();

  return `<p class="beacon-kicker">Looking for something else? Try `
    + `<a href="${linkTo(next, depth)}">${esc(label)}</a> or ${home}.</p>`;
}

/**
 * Name, address and phone, as a preamble of columns.
 *
 * LEDGER USES A `<dl>`. This uses sections with headings, because Beacon's
 * strip already carries the address once and the preamble's job here is to
 * be the machine-readable repetition rather than the first telling.
 *
 * IT SITS UNDER THE ABOUT SECTION, NOT UNDER THE BANNER — Edwin, 30 October,
 * looking at the built page: "move this section to After the first section."
 *
 * It was tucked against the banner's lower edge, overlapping it by a
 * negative margin, which put three lines of address between the headline and
 * the first thing the business actually says about itself. The facts are a
 * footnote to the introduction rather than the introduction's first
 * interruption.
 *
 * SO IT CARRIES ITS OWN SECTION. It used to be a bare `<div class="shell">`
 * relying on the banner's padding; between two blocks it needs spacing of
 * its own, or it inherits the bottom padding of one and the top padding of
 * the other and floats in eight rems of nothing.
 */
function preamble({ business = {} } = {}) {
  return `
<section class="beacon-facts"><div class="beacon-shell">
  <div class="beacon-preamble">
    <div class="beacon-preamble__col"><h2>Who</h2><p>${esc(business.name || '')}</p></div>
    <div class="beacon-preamble__col"><h2>Where</h2><p>${esc(addressQuery(business))}</p></div>
    <div class="beacon-preamble__col"><h2>Phone</h2>
      <p><a href="tel:${esc(business.tel || '')}">${esc(business.phone || '')}</a></p></div>
  </div>
</div></section>`;
}

/**
 * A divider: one line, alone, breaking the page in two.
 *
 * WHY — Edwin, 30 October: "can we add like a section divider that has a
 * generic heading." Beacon's home page runs banner, about, facts, tiles,
 * map — five bands of similar weight, and nothing between them to rest on.
 *
 * NOT AN <h2>. It is a breather, not a section heading: there is no section
 * under it and no content it introduces. An h2 here would put a heading in
 * the document outline that leads nowhere, which is a worse page for
 * anything reading the structure rather than looking at it.
 *
 * EMPTY RENDERS NOTHING, AND THAT MATTERS MORE THAN IT LOOKS. Every Beacon
 * site built before 30 October has no firstBreak in its stored source, and
 * every Ledger site never will. A re-render of one of those must produce a
 * page without a band, not a band without a line.
 */
function divider({ line = '' } = {}) {
  const text = String(line == null ? '' : line).trim();

  if (!text) return '';

  return `
<div class="beacon-divider"><div class="beacon-shell">
  <p>${esc(text)}</p>
</div></div>`;
}

/**
 * The hours, as a slate of rows rather than a table.
 *
 * A DAY WITH NO HOURS READS "Closed", not an empty row. An empty one is read
 * as "we forgot", and the owner typed the hours precisely so nobody has to
 * guess about Sunday.
 */
function hoursSlate({ hours = [] } = {}) {
  const rows = hours.map(({ day, open }) => (open
    ? `<div class="beacon-slate__row"><span>${esc(day)}</span><span>${esc(open)}</span></div>`
    : `<div class="beacon-slate__row beacon-slate--shut"><span>${esc(day)}</span><span>Closed</span></div>`
  )).join('');

  if (!rows) return '';

  return `
<div class="beacon-slate">
  <h2>When we are open</h2>
  ${rows}
  <p class="beacon-slate__note">Outside these hours, leave a message and we will call back.</p>
</div>`;
}

/**
 * The map.
 *
 * THE SAME EMBED AS THE MAIN GENERATOR — utils/googleMap.js — and no API key,
 * which is why it costs nothing and cannot be rate-limited. Built here rather
 * than imported for the reasons Ledger's copy records: googleMap() is async
 * for no reason a renderer can satisfy, and it requires a geocoder it never
 * calls. The URL is identical.
 */
function mapFrame({ business = {} } = {}) {
  const where = addressQuery(business);

  if (!where) return '';

  const src = `https://www.google.com/maps?q=${encodeURIComponent(where)}&z=15&output=embed`;

  return `
<div class="beacon-plan">
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
 *
 * THE STYLESHEET PATH IS THE SAME ONE LEDGER USES, and that is correct: a
 * site is built from ONE structure, so assets/site.css holds that structure's
 * CSS and nothing else. The prefixes exist so the two can live in one
 * repository, not in one file.
 */
function document({
  site = '', slug = '', title = '', description = '',
  body = '', jsonld = null, head = '', depth = 0, verification = [],
} = {}) {
  const canonical = `${String(site).replace(/\/$/, '')}${urlFor(slug)}`;

  const ld = jsonld
    ? `\n<script type="application/ld+json">${JSON.stringify(jsonld)}</script>`
    : '';

  /* SEARCH CONSOLE, ON EVERY PAGE, WITH THE TOKEN ESCAPED — two defences for
   * one value. utils/blog/verificationTags.js already refused anything that
   * was not token-shaped before this was stored; this is the second, because
   * the parser is one validation somebody relaxes while tidying and the
   * result is customer-supplied text in an attribute on a public page. */
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
  MAIN_ID,
  TRADES_ID,
  WHERE_ID,
  header,
  footer,
  banner,
  onward,
  preamble,
  divider,
  hoursSlate,
  mapFrame,
  document,
};
