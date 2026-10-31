// utils/localOptions/render/anvil/chrome.js
//
// Anvil's furniture: rail, stage, plate, rungs, watch, colophon, document.
//
// WHAT ANVIL IS. The third structure, asked for on 31 October: a darker
// version, with its own html structure, its own css, its own classes and
// prefix and ids, and its own prompts. The same eleven pages and the same
// sections inside them — the rule that has held since Beacon.
//
// THE THIRD SHAPE HAD TO BE A THIRD SHAPE, not a darker Beacon. Two layouts
// that differ only in colour are one layout, and a customer choosing between
// Design 2 and Design 3 would be choosing between two renderings of the same
// page. So:
//
//   hero       Ledger overlaps a card below a band. Beacon sets the picture
//              BESIDE the words. Anvil puts the words ON the photograph,
//              behind a scrim — which only reads well on a dark page, and is
//              the one of the three that could not be borrowed.
//   services   Ledger numbers them in two columns. Beacon lays them out as
//              three-up tiles. Anvil stacks them as full-width RUNGS: number,
//              name, blurb, all on one line of a ladder.
//   hours      Ledger uses a table under the prose. Beacon puts a slate
//              beside it. Anvil runs a seven-column band of days UNDER the
//              prose, full width.
//   facts      Ledger uses a <dl>. Beacon uses three columns in a card.
//              Anvil runs them inline on one rule, divided by hairlines.
//
// EVERY CLASS IS `anvil-` AND EVERY ID IS ANVIL'S OWN. See the note at the
// top of theme.js: two stylesheets sharing a namespace cannot live in one
// repository, because both are served as assets/site.css to different sites
// built by the same code, and a rule written for one silently restyles the
// other on a site nobody happens to be looking at.
//
// THE TWO THINGS A DARK PAGE BREAKS THAT A LIGHT ONE DOES NOT
//
//   the logo   An owner's logo was drawn for a white page — dark ink on
//              transparency. On a dark rail it disappears, and the first
//              anybody knows is a customer asking why their header is empty.
//              So the mark sits on a light plate of its own. Always, not
//              conditionally: nothing here can see inside a PNG, and a rule
//              that guessed would be wrong silently.
//   the photo  A bright photograph on a dark page is a lightbox, and words
//              over one are unreadable. The stage carries a scrim — a
//              gradient in CSS, not a change to the image, because the same
//              four files are shared with the two light structures.
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

/** Anvil's own ids, in one place so nothing collides with Ledger or Beacon. */
const MAIN_ID = 'page';
const TRADES_ID = 'work';
const WHERE_ID = 'findus';

/**
 * The rail: brand, nav and the number, on one dark row.
 *
 * ONE ROW, WHICH IS WHAT SEPARATES IT FROM BEACON. Beacon has a masthead and
 * a fact strip beneath it, two bands before the page starts. Anvil puts the
 * number IN the rail as a solid button and carries the address nowhere in the
 * header at all — the plate under the stage does that job, once.
 *
 * NOT STICKY. Ledger's bar is. A sticky dark rail over a dark page is a strip
 * that never quite separates from what scrolls under it, and on a phone it
 * eats the top of every screen on a layout that already has a full-height
 * stage.
 *
 * THE NAV CARRIES ALL SIX SERVICES. It is navigation; the body cap belongs to
 * the body, where it shapes what each page passes on. Stated in shape.js, and
 * broken once already by a file whose comment said it was obeying it.
 *
 * `<details>`/`<summary>`, AND NOT A SCRIPT. These sites ship no JavaScript.
 * `details` gives a disclosure that opens on click, on tap and from the
 * keyboard, in every browser, for nothing.
 */
function rail({
  business = {}, logo = '', current = '', services = [], depth = 0,
} = {}) {
  /* RE-BASED FOR DEPTH, like every other asset. A relative path that is not
   * re-based is correct at the root and wrong everywhere else:
   * `assets/logo.png` from /drain-cleaning/ asks for
   * /drain-cleaning/assets/logo.png. Ledger shipped that for a day. An
   * already-absolute logo is left exactly as handed over. */
  const src = logo && !/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(logo) && !logo.startsWith('/')
    ? assetTo(logo, depth)
    : logo;

  /* THE LIGHT PLATE IS NOT DECORATION — see the header note. A logo drawn in
   * dark ink on transparency vanishes on this rail, and nothing here can look
   * inside the file to find out whether this one will. The plate makes every
   * logo legible at the cost of a white rectangle behind the ones that did
   * not need it, which is the right way round: a visible logo that could have
   * been prettier beats an invisible one.
   *
   * THE GLYPH DOES NOT GET A PLATE. It is drawn by this file, in colours
   * chosen for this background, so it cannot disappear. */
  const mark = logo
    ? `<span class="anvil-brand__plate"><img class="anvil-brand__mark" src="${esc(src)}" alt="${esc(business.name || '')}"></span>`
    : `<span class="anvil-brand__glyph">${esc(initials(business.name))}</span>`;

  const here = slug => (current === slug ? ' aria-current="page"' : '');

  const workItems = services
    .map(s => `<li><a href="${linkTo(s.slug, depth)}"${here(s.slug)}>${esc(s.name)}</a></li>`)
    .join('');

  /* SHUT ON EVERY PAGE. A disclosure open before anyone asked is a panel over
   * the page, and on a phone it covers the H1. aria-current still marks the
   * page inside it, which is what somebody who opens the menu needs. */
  const menu = workItems
    ? `<details class="anvil-work">
      <summary>Our work</summary>
      <ul class="anvil-work__list">
        <li class="anvil-work__all"><a href="${linkTo('index', depth)}#${TRADES_ID}">All of it</a></li>
        ${workItems}
      </ul>
    </details>`
    /* NO SERVICES MEANS NO PANEL. An empty `details` is a control that opens
     * onto nothing. Only a caller that passed none reaches this. */
    : `<a href="${linkTo('index', depth)}#${TRADES_ID}">Our work</a>`;

  return `
<a class="anvil-skip" href="#${MAIN_ID}">Skip to content</a>
<header class="anvil-rail">
  <div class="anvil-shell anvil-rail__row">
    <a class="anvil-brand" href="${linkTo('index', depth)}">
      ${mark}${logo ? '' : `
      <span class="anvil-brand__name">${esc(business.name || '')}</span>`}
    </a>
    <nav class="anvil-nav" aria-label="Main">
      <a href="${linkTo('index', depth)}"${here('index')}>Home</a>
      ${menu}
      <a href="${linkTo('contact', depth)}"${here('contact')}>Contact</a>
    </nav>
    <a class="anvil-dial" href="tel:${esc(business.tel || '')}">${esc(business.phone || '')}</a>
  </div>
</header>`;
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
function colophon({ business = {}, services = [], areas = [], now = new Date(), depth = 0 } = {}) {
  const social = Object.entries(business.social || {})
    .filter(([key, href]) => SOCIAL[key] && href)
    .map(([key, href]) => {
      const { viewBox, path } = SOCIAL[key];
      const label = key[0].toUpperCase() + key.slice(1);

      return `<a href="${esc(href)}" rel="noopener" aria-label="${esc(label)}">`
        + `<svg viewBox="${viewBox}" aria-hidden="true"><path d="${path}"/></svg></a>`;
    }).join('');

  const workLinks = services
    .map(s => `<li><a href="${linkTo(s.slug, depth)}">${esc(s.name)}</a></li>`).join('');

  const legalLinks = LEGAL_SLUGS
    .map(slug => `<li><a href="${linkTo(slug, depth)}">${esc(PAGE_TITLES[slug] || slug)}</a></li>`).join('');

  const where = areas.filter(Boolean);

  return `
<footer class="anvil-colophon"><div class="anvil-shell">
  <div class="anvil-colophon__spread">
    <div>
      <h2 class="anvil-colophon__title">${esc(business.name || '')}</h2>
      <p>${esc(business.street || '')}<br>${esc([business.city, business.state].filter(Boolean).join(', '))} ${esc(business.zip || '')}</p>
      <p><a href="tel:${esc(business.tel || '')}">${esc(business.phone || '')}</a></p>
      ${social ? `<p class="anvil-marks">${social}</p>` : ''}
    </div>
    <div><h2 class="anvil-colophon__title">Our work</h2><ul>${workLinks}</ul></div>
    <div><h2 class="anvil-colophon__title">This site</h2><ul>
      <li><a href="${linkTo('index', depth)}">Home</a></li><li><a href="${linkTo('contact', depth)}">Contact</a></li>${legalLinks}
    </ul></div>
  </div>
  <p class="anvil-colophon__foot">
    <span>&copy; ${now.getFullYear()} ${esc(business.name || '')}</span>
    ${where.length ? `<span>${esc(where.join(', '))}</span>` : ''}
  </p>
</div></footer>`;
}

/**
 * The stage: the words ON the photograph, behind a scrim.
 *
 * THE ONE SHAPE THAT ONLY WORKS DARK, which is why Anvil gets it and the
 * other two do not. Ledger's hero is a band with a card overlapping its lower
 * edge; Beacon's is a picture beside a plate. Both keep the H1 off the image
 * because both pages are light, and dark text over a photograph is a gamble
 * on what the photograph happens to contain.
 *
 * THE SCRIM IS CSS, NOT A DIFFERENT IMAGE. The same four files serve all
 * three structures — set-1 for Ledger, set-2 for Beacon, set-3 for Anvil, but
 * the same pipeline and the same sizes. Darkening the file would mean a
 * fourth variant of every photograph and a build step to make it.
 *
 * THE CALL BUTTON IS ABOVE THE FOLD, which is section 1 of the ratified
 * service-page shape, and it is inside the stage rather than under it.
 *
 * loading="eager" AND fetchpriority="high". It is the largest element and the
 * one the page is measured by; lazy-loading the thing above the fold is the
 * commonest way to lose that measurement.
 *
 * NO PHOTOGRAPH IS NOT NO STAGE. A page outside the hero rotation keeps the
 * words and loses the picture — on Anvil the stage IS the H1, so returning
 * nothing would return a page with no heading at all.
 */
function stage({ order = [], slug = '', h1 = '', sub = '', alt = {}, business = {}, depth = 0 } = {}) {
  const n = heroFor(order, slug);

  const picture = n
    ? `<img class="anvil-stage__shot" src="${assetTo(`assets/hero-${n}.webp`, depth)}"
         width="1600" height="900" alt="${esc(alt[n] || '')}"
         loading="eager" fetchpriority="high" decoding="async">`
    : '';

  return `
<section class="anvil-stage${n ? '' : ' anvil-stage--bare'}">
  ${picture}
  <div class="anvil-shell anvil-stage__words">
    <h1>${esc(h1)}</h1>
    <p class="anvil-stage__said">${esc(sub)}</p>
    <p class="anvil-stage__acts">
      <a class="anvil-act anvil-act--solid" href="tel:${esc(business.tel || '')}">Call ${esc(business.phone || '')}</a>
      <a class="anvil-act anvil-act--ghost" href="${linkTo('contact', depth)}">Ask a question</a>
    </p>
  </div>
</section>`;
}

/**
 * The plate: name, address and phone inline on one rule.
 *
 * LEDGER USES A `<dl>`; BEACON USES THREE COLUMNS IN A CARD. This runs them
 * along a single line divided by hairlines, directly under the stage, which
 * is the one place on a dark page where a thin bright rule reads as structure
 * rather than as a stray border.
 *
 * IT CARRIES ITS OWN BAND. Beacon learned this the hard way: a bare shell
 * between two blocks inherits the bottom padding of one and the top padding
 * of the other and floats in eight rems of nothing.
 */
function plate({ business = {} } = {}) {
  return `
<section class="anvil-facts"><div class="anvil-shell">
  <div class="anvil-plate">
    <div class="anvil-plate__cell"><span>Who</span><p>${esc(business.name || '')}</p></div>
    <div class="anvil-plate__cell"><span>Where</span><p>${esc(addressQuery(business))}</p></div>
    <div class="anvil-plate__cell"><span>Phone</span>
      <p><a href="tel:${esc(business.tel || '')}">${esc(business.phone || '')}</a></p></div>
  </div>
</div></section>`;
}

/**
 * The ring, as a sentence.
 *
 * LOWERCASING THE TITLE WORKS FOR A SERVICE AND NOT FOR A NAME. "or contact
 * leander plumbing gomanzo" is what Ledger's first version produced, because
 * contact's title is built from the business name. Contact gets its own
 * wording instead, and Anvil inherits the lesson rather than the bug.
 */
function onward({ order = [], slug = '', business = {}, services = [], depth = 0 } = {}) {
  const next = ringNext(order, slug);
  const home = `<a href="${linkTo('index', depth)}">the home page</a>`;

  if (!next) {
    return `<p class="anvil-onward">Or head back to ${home}.</p>`;
  }

  const label = 'contact' === next
    ? 'get in touch'
    : titleOf(next, { business, services }).toLowerCase();

  return `<p class="anvil-onward">Next: `
    + `<a href="${linkTo(next, depth)}">${esc(label)}</a>, or back to ${home}.</p>`;
}

/**
 * A divider: one line, alone, breaking the page in two.
 *
 * INVERTED FROM BEACON'S, AND THAT IS THE WHOLE DIFFERENCE. Beacon's page is
 * near-white, so its divider is a deep band — the dark thing among light
 * ones. Anvil's page is dark throughout, so the same trick needs the opposite
 * move: a RAISED band, lighter than its surroundings, with a hairline above
 * and below. A dark band on a dark page is not a break, it is a gap.
 *
 * NOT AN <h2>. It is a breather, not a section heading: nothing sits under it
 * and it introduces nothing. An h2 here would put a heading in the document
 * outline that leads nowhere.
 *
 * EMPTY RENDERS NOTHING. Every site built before this structure existed has
 * no firstBreak in its stored source, and a re-render of one must produce a
 * page without a band, not a band without a line.
 */
function divider({ line = '' } = {}) {
  const text = String(line == null ? '' : line).trim();

  if (!text) return '';

  return `
<div class="anvil-break"><div class="anvil-shell">
  <p>${esc(text)}</p>
</div></div>`;
}

/**
 * The hours, as a band of seven days across.
 *
 * UNDER THE PROSE AND FULL WIDTH, which is the third answer to a question the
 * other two have already answered differently: Ledger puts a table beneath,
 * Beacon puts a slate beside. A band across the page is legible at a glance —
 * a visitor scanning for Saturday finds the column rather than the row.
 *
 * A DAY WITH NO HOURS READS "Closed", not an empty cell. An empty one is read
 * as "we forgot", and the owner typed the hours precisely so nobody has to
 * guess about Sunday.
 */
function watch({ hours = [] } = {}) {
  const cells = hours.map(({ day, open }) => (open
    ? `<div class="anvil-watch__day"><span>${esc(day)}</span><strong>${esc(open)}</strong></div>`
    : `<div class="anvil-watch__day anvil-watch--shut"><span>${esc(day)}</span><strong>Closed</strong></div>`
  )).join('');

  if (!cells) return '';

  return `
<div class="anvil-watch">
  <h2>When we are open</h2>
  <div class="anvil-watch__row">${cells}</div>
  <p class="anvil-watch__note">Outside these hours, leave a message and we will call back.</p>
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
<div class="anvil-map">
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
 * `color-scheme: dark` IS NOT DECORATION ON THIS ONE. It tells the browser to
 * draw the scrollbar, the form controls it styles itself and the overscroll
 * gutter in dark — without it a dark page gets a bright white scrollbar down
 * its right edge and a white flash at the top of every rubber-band scroll on
 * iOS. Neither of the light structures needs the line and both would be
 * wrong to carry it.
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
<meta name="color-scheme" content="dark">
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
  rail,
  colophon,
  stage,
  plate,
  onward,
  divider,
  watch,
  mapFrame,
  document,
};
