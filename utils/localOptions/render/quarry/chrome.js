// utils/localOptions/render/quarry/chrome.js
//
// Quarry's furniture: bar, masthead, seam, kerb, index, hours, foot.
//
// WHAT QUARRY IS. The fourth structure, and the first of five asked for on
// 17 November for the automated Cloudflare mode: *"I want these 5 new
// layouts to be different from all layouts including github layouts"*. So it
// has to be a fourth SHAPE, not a fourth palette — the rule Anvil was held
// to on 31 October and for the same reason. Two layouts that differ only in
// colour are one layout, and a customer choosing between them is choosing
// between two renderings of the same page.
//
// THE ONE MOVE NOBODY ELSE MAKES: THE WORDS COME FIRST.
//
//   Ledger  a band with a card overlapping its lower edge
//   Beacon  the picture BESIDE the words, on a plate
//   Anvil   the words ON the picture, behind a scrim
//   Quarry  an oversized headline alone at the top, and the photograph
//           BELOW it as a full-bleed band with the facts captioned on it
//
// Every one of the first three puts a photograph at or above the headline.
// Quarry inverts the order, so the page opens on type and the picture is
// what you fall into. That is visible in one glance at a thumbnail, which is
// the test a design has to pass to be worth offering.
//
// AND THE SERVICES ARE AN INDEX, NOT A LIST OF THINGS.
//
//   Ledger  numbered, two columns
//   Beacon  three-up tiles
//   Anvil   full-width rungs on a ladder
//   Quarry  a sticky index down the left, the blurbs scrolling past it on
//           the right — the shape of a contents page, not of a catalogue
//
// EVERY CLASS IS `quarry-` AND EVERY ID IS QUARRY'S OWN. See the note at the
// top of theme.js: two stylesheets sharing a namespace cannot live in one
// repository, because both are served as assets/site.css to different sites
// built by the same code, and a rule written for one silently restyles the
// other on a site nobody happens to be looking at.
//
// WHAT IS DELIBERATELY IDENTICAL TO THE OTHER THREE
//
// The ring, the body-link cap, the hero rotation, the schema, the canonical,
// the Search Console tags and the legal copy. Every one is a rule about the
// SITE rather than about how it looks, and a fourth structure that
// re-decided any of them would be a fourth product wearing the first one's
// wizard.
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
const { SOCIAL, initials, addressLine, addressQuery } = require('../common');

/** Quarry's own ids, in one place so nothing collides with the other three. */
/* 'read', NOT 'content', AND THAT WAS A COLLISION FOR AN HOUR.
 *
 * Ledger uses 'main', Beacon 'content', Anvil 'page'. The first draft of
 * this file wrote 'content' — Beacon's — and nothing would have failed: the
 * skip link and the <main> it points at are both inside one page, so the
 * duplicate lives in two different sites that never meet.
 *
 *     TWO LAYOUTS SHARING AN ID STILL WORK. THEY JUST CANNOT BE TOLD
 *     APART BY A FRAGMENT IN A URL, BY A SCRAPER, OR BY A TEST.
 *
 * Edwin asked for "different classes and prefix and css IDs" on 30 October,
 * and this is the half of it that no stylesheet would have caught. */
const MAIN_ID = 'read';
const TRADES_ID = 'index';

/* ⚠ 'yard', AND IT WAS 'visit' UNTIL 17 NOVEMBER, WHICH WAS LEDGER'S.
 *
 * The comment above fixed MAIN_ID and missed this one, because the check
 * that found the first collision compared the three CONSTANTS that each
 * structure exports — and Ledger exports none. Its ids are string literals
 * in its markup: `id="visit"` sits in pages.js, where nothing comparing
 * exports can see it.
 *
 *     A UNIQUENESS CHECK THAT READS WHAT THE STRUCTURES DECLARE
 *     CANNOT SEE THE STRUCTURE THAT DECLARES NOTHING.
 *
 * Found by Atlas's suite, which reads the ids out of the RENDERED HTML of
 * all six sites instead, and which reported exactly one collision in the
 * whole set. Ledger's is the older and the one with sites built on it, so
 * this is the one that moved. Nothing links to either fragment, so the
 * rename costs nothing beyond the rename. */
const WHERE_ID = 'yard';

/**
 * The bar: brand and number, and nothing else.
 *
 * THE THINNEST HEADER OF THE FOUR, ON PURPOSE. The masthead below it carries
 * an oversized H1, and two heavy bands stacked would bury it. Ledger's bar
 * is sticky, Beacon has a masthead plus a fact strip, Anvil puts the number
 * in the rail as a solid button. Quarry keeps the top of the page quiet so
 * the headline is the first thing with weight.
 *
 * THE NAV IS UNDER THE BRAND, NOT BESIDE IT, which is what lets the bar stay
 * short on a phone without a menu button: two short rows read better than
 * one row that wraps badly.
 *
 * `<details>`/`<summary>`, AND NOT A SCRIPT. These sites ship no JavaScript.
 * `details` gives a disclosure that opens on click, on tap and from the
 * keyboard, in every browser, for nothing.
 */
function bar({
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

  /* NO PLATE BEHIND THE LOGO, UNLIKE ANVIL, and that is a consequence of the
   * page being light rather than an oversight. Anvil's note explains the
   * plate: a logo drawn in dark ink on transparency vanishes on a dark rail.
   * On this bar it is the normal case and needs no help. */
  const mark = logo
    ? `<img class="quarry-brand__mark" src="${esc(src)}" alt="${esc(business.name || '')}">`
    : `<span class="quarry-brand__glyph">${esc(initials(business.name))}</span>`;

  const here = slug => (current === slug ? ' aria-current="page"' : '');

  const workItems = services
    .map(s => `<li><a href="${linkTo(s.slug, depth)}"${here(s.slug)}>${esc(s.name)}</a></li>`)
    .join('');

  /* SHUT ON EVERY PAGE. A disclosure open before anyone asked is a panel
   * over the page, and on a phone it covers the H1. aria-current still marks
   * the page inside it, which is what somebody who opens the menu needs. */
  const menu = workItems
    ? `<details class="quarry-menu">
      <summary>What we do</summary>
      <ul class="quarry-menu__list">
        <li class="quarry-menu__all"><a href="${linkTo('index', depth)}#${TRADES_ID}">Everything</a></li>
        ${workItems}
      </ul>
    </details>`
    /* NO SERVICES MEANS NO PANEL. An empty `details` is a control that opens
     * onto nothing. Only a caller that passed none reaches this. */
    : `<a href="${linkTo('index', depth)}#${TRADES_ID}">What we do</a>`;

  return `
<a class="quarry-skip" href="#${MAIN_ID}">Skip to content</a>
<header class="quarry-bar">
  <div class="quarry-shell quarry-bar__row">
    <a class="quarry-brand" href="${linkTo('index', depth)}">
      ${mark}${logo ? '' : `
      <span class="quarry-brand__name">${esc(business.name || '')}</span>`}
    </a>
    <a class="quarry-dial" href="tel:${esc(business.tel || '')}">${esc(business.phone || '')}</a>
  </div>
  <nav class="quarry-nav" aria-label="Main"><div class="quarry-shell quarry-nav__row">
    <a href="${linkTo('index', depth)}"${here('index')}>Home</a>
    ${menu}
    <a href="${linkTo('contact', depth)}"${here('contact')}>Contact</a>
  </div></nav>
</header>`;
}

/**
 * The masthead: the headline, alone, with no photograph.
 *
 * THE INVERSION THIS WHOLE STRUCTURE IS BUILT ON. See the header note — the
 * other three all put a picture at or above the H1, and this one puts type
 * there instead. The photograph follows in seam(), below the fold of the
 * headline rather than behind it.
 *
 * WHY THAT IS SAFE HERE AND WOULD NOT BE ON ANVIL. Anvil's words sit on the
 * image, so an absent photograph would leave its H1 on nothing; its stage
 * therefore renders bare rather than returning ''. Quarry's headline never
 * depended on an image in the first place, so the two blocks are genuinely
 * independent and seam() may return nothing at all.
 *
 * THE CALL BUTTON IS ABOVE THE FOLD, which is section 1 of the ratified
 * service-page shape, and it is in the masthead rather than under the
 * picture — otherwise a visitor on a phone scrolls past a full-bleed band
 * before being offered the phone.
 */
function masthead({ h1 = '', sub = '', business = {}, depth = 0 } = {}) {
  /* NO EMPTY PARAGRAPH WHEN THERE IS NO SUB-LINE. The contact page has none,
   * and an empty <p> there is a node in the document that says nothing —
   * harmless to look at, and one more thing for a screen reader to walk
   * past. It also leaves the heading's bottom margin arguing with a
   * paragraph margin that has nothing between them. */
  const said = String(sub == null ? '' : sub).trim();

  return `
<section class="quarry-masthead"><div class="quarry-shell">
  <h1 class="quarry-masthead__line">${esc(h1)}</h1>
  ${said ? `<p class="quarry-masthead__said">${esc(said)}</p>` : ''}
  <p class="quarry-masthead__acts">
    <a class="quarry-act quarry-act--solid" href="tel:${esc(business.tel || '')}">Call ${esc(business.phone || '')}</a>
    <a class="quarry-act quarry-act--plain" href="${linkTo('contact', depth)}">Ask a question</a>
  </p>
</div></section>`;
}

/**
 * The seam: the photograph, full bleed, and nothing written on it.
 *
 * IT CARRIED A CAPTION FOR AN HOUR, AND THE SCREENSHOT KILLED IT. The
 * caption was the owner's own sub-line — so on the home page the same
 * sentence appeared under the H1 and again two inches below it, and on a
 * service page the service's blurb did the same. A figure whose caption
 * repeats the paragraph above it is a figure with no caption and an extra
 * band of furniture.
 *
 *     A CAPTION THAT RESTATES THE LINE ABOVE IT IS NOT A CAPTION.
 *
 * The alt text was the other candidate and is worse: it is already on the
 * img, where it belongs, and printing it underneath says the same thing
 * twice to the one reader who was already told.
 *
 * FULL BLEED AND SHORT. It is a band the page passes through, not a hero —
 * the hero was the headline. A tall one would turn this back into Anvil's
 * stage with the words moved off it.
 *
 * NOTHING AT ALL WITHOUT A PHOTOGRAPH, which is the opposite of Anvil's
 * rule and right for the opposite reason: there is no H1 in here to strand.
 * A page outside the hero rotation simply goes masthead straight to
 * kerb, and nothing about it looks unfinished.
 *
 * loading="eager" AND fetchpriority="high". It is the largest element on
 * the page and the one the page is measured by; lazy-loading it is the
 * commonest way to lose that measurement.
 */
function seam({ order = [], slug = '', alt = {}, depth = 0 } = {}) {
  const n = heroFor(order, slug);

  if (!n) return '';

  return `
<figure class="quarry-seam">
  <img class="quarry-seam__shot" src="${assetTo(`assets/hero-${n}.webp`, depth)}"
       width="1600" height="900" alt="${esc(alt[n] || '')}"
       loading="eager" fetchpriority="high" decoding="async">
</figure>`;
}

/**
 * The kerb: name, address and phone, stacked under the seam.
 *
 * STACKED, NOT SPREAD. Ledger uses a `<dl>`, Beacon three columns in a card,
 * Anvil one inline rule. Quarry runs them as three short stacked rows with
 * the label above the value, which is the one of the four that survives a
 * narrow column without reflowing into something else.
 *
 * IT CARRIES ITS OWN BAND. Beacon learned this the hard way and Anvil
 * repeats the note: a bare shell between two blocks inherits the bottom
 * padding of one and the top padding of the other and floats in eight rems
 * of nothing.
 *
 * IT WAS CALLED `ledgerline` FOR AN HOUR, which was a name with another
 * structure's in it. `/ledger-/` happens not to match `quarry-ledgerline`,
 * so the isolation loop in the suite would have passed — the problem was the
 * next person to tighten that regex to `/ledger/`, and the one before them
 * reading a Quarry file and wondering which layout it belonged to.
 *
 * addressLine, NOT addressQuery. The query form is comma-separated for a
 * maps URL and for schema; this is the one a person reads.
 */
function kerb({ business = {} } = {}) {
  return `
<section class="quarry-facts"><div class="quarry-shell">
  <dl class="quarry-kerb">
    <div><dt>Who</dt><dd>${esc(business.name || '')}</dd></div>
    <div><dt>Where</dt><dd>${esc(addressLine(business))}</dd></div>
    <div><dt>Phone</dt>
      <dd><a href="tel:${esc(business.tel || '')}">${esc(business.phone || '')}</a></dd></div>
  </dl>
</div></section>`;
}

/**
 * The ring, as a sentence.
 *
 * LOWERCASING THE TITLE WORKS FOR A SERVICE AND NOT FOR A NAME. "or contact
 * leander plumbing gomanzo" is what Ledger's first version produced, because
 * contact's title is built from the business name. Contact gets its own
 * wording instead, and every structure since has inherited the lesson rather
 * than the bug.
 */
function onward({ order = [], slug = '', business = {}, services = [], depth = 0 } = {}) {
  const next = ringNext(order, slug);
  const home = `<a href="${linkTo('index', depth)}">the home page</a>`;

  if (!next) {
    return `<p class="quarry-onward">Or head back to ${home}.</p>`;
  }

  const label = 'contact' === next
    ? 'get in touch'
    : titleOf(next, { business, services }).toLowerCase();

  return `<p class="quarry-onward">Next: `
    + `<a href="${linkTo(next, depth)}">${esc(label)}</a>, or back to ${home}.</p>`;
}

/**
 * A divider: one line, alone, breaking the page in two.
 *
 * A RULE AND A HANGING LINE, which is the fourth answer. Beacon's is a deep
 * band on a near-white page; Anvil's is a raised band on a dark one. Quarry
 * draws a full-width hairline and sets the sentence beneath it in the left
 * column only — the page's own grid doing the work, with no band at all.
 *
 * NOT AN <h2>. It is a breather, not a section heading: nothing sits under
 * it and it introduces nothing. An h2 here would put a heading in the
 * document outline that leads nowhere.
 *
 * EMPTY RENDERS NOTHING. Every site built before this structure existed has
 * no firstBreak in its stored source, and a re-render of one must produce a
 * page without a rule, not a rule without a line.
 */
function divider({ line = '' } = {}) {
  const text = String(line == null ? '' : line).trim();

  if (!text) return '';

  return `
<div class="quarry-break"><div class="quarry-shell">
  <p>${esc(text)}</p>
</div></div>`;
}

/**
 * The hours, in two columns: weekdays, then the weekend.
 *
 * THE FOURTH ANSWER TO THE SAME QUESTION. Ledger puts a table beneath the
 * prose, Beacon a slate beside it, Anvil a seven-column band across. Quarry
 * splits the week where people actually split it — Monday to Friday in one
 * column, Saturday and Sunday in the other — so the question most visitors
 * are asking is answered without reading seven rows.
 *
 * THE SPLIT IS BY POSITION, NOT BY NAME. The days arrive already ordered and
 * already localised by whoever built the list; matching on the English word
 * "Saturday" would be a second place that decides what a week is, and the
 * first one is not here.
 *
 * A DAY WITH NO HOURS READS "Closed", not an empty cell. An empty one is
 * read as "we forgot", and the owner typed the hours precisely so nobody has
 * to guess about Sunday.
 */
function hours({ hours: rows = [] } = {}) {
  const list = (rows || []).filter(Boolean);

  if (!list.length) return '';

  const cell = ({ day, open }) => (open
    ? `<div class="quarry-hours__day"><dt>${esc(day)}</dt><dd>${esc(open)}</dd></div>`
    : `<div class="quarry-hours__day quarry-hours--shut"><dt>${esc(day)}</dt><dd>Closed</dd></div>`);

  /* FIVE AND THE REST. A list shorter than five is not split at all rather
   * than split at a point that would leave one column empty — a site whose
   * owner entered three days gets three rows, not two columns of uneven
   * nonsense. */
  const week = list.length > 5 ? list.slice(0, 5) : list;
  const rest = list.length > 5 ? list.slice(5) : [];

  return `
<div class="quarry-hours">
  <h2>When we are open</h2>
  <div class="quarry-hours__split">
    <dl class="quarry-hours__col">${week.map(cell).join('')}</dl>
    ${rest.length ? `<dl class="quarry-hours__col">${rest.map(cell).join('')}</dl>` : ''}
  </div>
  <p class="quarry-hours__note">Outside these hours, leave a message and we will call back.</p>
</div>`;
}

/**
 * The map.
 *
 * THE SAME EMBED AS THE MAIN GENERATOR — utils/googleMap.js — and no API
 * key, which is why it costs nothing and cannot be rate-limited. Built here
 * rather than imported for the reasons Ledger's copy records: googleMap() is
 * async for no reason a renderer can satisfy, and it requires a geocoder it
 * never calls. The URL is identical.
 */
function mapFrame({ business = {} } = {}) {
  const where = addressQuery(business);

  if (!where) return '';

  const src = `https://www.google.com/maps?q=${encodeURIComponent(where)}&z=15&output=embed`;

  return `
<div class="quarry-map">
  <iframe title="Map showing ${esc(business.name || '')}" loading="lazy"
    referrerpolicy="no-referrer-when-downgrade"
    src="${esc(src)}"></iframe>
</div>`;
}

/**
 * The foot.
 *
 * ALL SIX SERVICES AND ALL THREE LEGAL PAGES, on every page. The ring shapes
 * what the BODY passes on; this is what makes sure nothing is unreachable.
 *
 * `now` IS AN ARGUMENT. The copyright year is the only thing on the site
 * that changes without anybody editing it, and a renderer that reads the
 * clock produces different bytes for the same input — which breaks the
 * "unchanged file costs nothing to re-upload" property the deploy relies on,
 * once a year, at midnight, for everybody at once.
 */
function foot({ business = {}, services = [], areas = [], now = new Date(), depth = 0 } = {}) {
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
<footer class="quarry-foot"><div class="quarry-shell">
  <div class="quarry-foot__spread">
    <div>
      <h2 class="quarry-foot__title">${esc(business.name || '')}</h2>
      <p>${esc(business.street || '')}<br>${esc([business.city, business.state].filter(Boolean).join(', '))} ${esc(business.zip || '')}</p>
      <p><a href="tel:${esc(business.tel || '')}">${esc(business.phone || '')}</a></p>
      ${social ? `<p class="quarry-marks">${social}</p>` : ''}
    </div>
    <div><h2 class="quarry-foot__title">What we do</h2><ul>${workLinks}</ul></div>
    <div><h2 class="quarry-foot__title">This site</h2><ul>
      <li><a href="${linkTo('index', depth)}">Home</a></li><li><a href="${linkTo('contact', depth)}">Contact</a></li>${legalLinks}
    </ul></div>
  </div>
  <p class="quarry-foot__base">
    <span>&copy; ${now.getFullYear()} ${esc(business.name || '')}</span>
    ${where.length ? `<span>${esc(where.join(', '))}</span>` : ''}
  </p>
</div></footer>`;
}

/**
 * The page, head and all.
 *
 * THE CANONICAL IS ABSOLUTE AND BUILT FROM THE SITE'S OWN DOMAIN. Four
 * domains were migrated on 27 October and two of the pages on them carried a
 * canonical naming somebody else's — one of them `example.com`. A page with
 * the wrong canonical serves 200, looks perfect, and is invisible.
 *
 * NO `color-scheme` LINE. Anvil carries one because a dark page gets a
 * bright scrollbar and a white flash on overscroll without it. Quarry is
 * light, so the browser's default is already right, and declaring it would
 * be a line that does nothing on three structures out of four.
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
  bar,
  masthead,
  seam,
  kerb,
  onward,
  divider,
  hours,
  mapFrame,
  foot,
  /* `document` WAS MISSING FROM THIS LIST and the function above it was
   * written, syntax-checked and unreachable. `node --check` reads a file; it
   * does not ask whether anything can get at what is in it. pages.js
   * destructures it as `wrap`, so the omission would have surfaced as
   * `wrap is not a function` on the first render, not here. */
  document,
};
