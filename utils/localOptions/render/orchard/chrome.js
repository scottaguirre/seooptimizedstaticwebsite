// utils/localOptions/render/orchard/chrome.js
//
// Orchard's furniture: bar, masthead, plate, row, grid, hours, foot.
//
// THE SEVENTH STRUCTURE, AND THE FIRST THAT DOES NOT RUN STRAIGHT DOWN THE
// MIDDLE.
//
// Ledger, Beacon, Anvil and Quarry stack full-width bands. Harbor and Atlas
// put a fixed column down one side and keep it there. Orchard offsets each
// section to ALTERNATING SIDES — a card flush left, then one flush right,
// then left again, like fruit on either side of a branch.
//
//     THE PAGE ZIGZAGS. Nothing else here does, and it is the shape most
//     small-business sites actually use.
//
// WHY IT IS AN OFFSET AND NOT A PHOTO BESIDE EVERY SECTION.
//
// The obvious reading of "alternating rows" is a picture on one side and
// text on the other, flipping down the page. It cannot be built: a set has
// FOUR photographs and heroFor() gives a page exactly one, so five sections
// would be four empty cells and a crop.
//
//     A LAYOUT THAT NEEDS MORE PICTURES THAN THE PRODUCT HAS
//     IS A LAYOUT THAT SHIPS WITH HOLES IN IT.
//
// So the photograph keeps a full-width row of its own and the ZIGZAG is
// carried by the cards. The rhythm survives on every page, including the
// nine that have no photograph at all.
//
// ON A PHONE EVERY CARD IS FULL WIDTH. An offset needs somewhere to offset
// into, and a 360px screen has none — so the base rules are the stack and
// the zigzag arrives at the width that can hold it. That is the order
// Quarry set, Harbor followed and Atlas followed.
//
// WHAT IS ITS OWN AND WHAT IS SHARED
//
// Every class here begins `.orchard-` and every custom property `--oc-`.
// Ledger's `--lg-`, Beacon's `--bn-`, Anvil's `--av-`, Quarry's `--qy-`,
// Harbor's `--hb-` and Atlas's `--at-` appear nowhere. All seven are served
// as assets/site.css to different sites, so a shared name is a rule written
// for one layout silently restyling another.
//
// NO BACKTICKS IN ANY COMMENT INSIDE A TEMPLATE LITERAL. One ends the
// string early, and that has cost a syntax error in this project four
// times — the last on 17 November, in this very file's theme block.

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

/* ORCHARD'S OWN IDS.
 *
 * Taken already: main/services/visit (Ledger), content/trades/whereabouts
 * (Beacon), page/work/findus (Anvil), read/index/yard (Quarry),
 * here/offer/reach (Harbor), text/list/place (Atlas).
 *
 * CHECKED AGAINST THE RENDERED HTML OF ALL SIX, not against what they
 * export — Ledger exports nothing and writes its ids inline, which is how
 * Quarry's WHERE_ID came to be Ledger's for three weeks. */
const MAIN_ID = 'story';
const TRADES_ID = 'grove';
const WHERE_ID = 'nearby';

/**
 * The bar: name, number, and the six services under it.
 *
 * SOFT EVERYWHERE, WHICH IS THE POINT OF THE WHOLE STRUCTURE. Quarry is
 * square on purpose and Atlas draws hard rules; this one rounds everything
 * it can. Two layouts that differ only in their content are two layouts
 * nobody can tell apart, and the corner radius is the cheapest honest
 * difference there is.
 *
 * NO <details>, LIKE ATLAS AND FOR THE SAME REASON. Four of the seven hide
 * six services behind a disclosure because a bar with a logo and a button
 * has no room. This bar puts them on their own line.
 */
function bar({ business = {}, logo = '', current = '', services = [], depth = 0 } = {}) {
  /* RE-BASED FOR DEPTH, like every other asset. A relative path that is not
   * re-based is correct at the root and wrong everywhere else:
   * `assets/logo.png` from /drain-cleaning/ asks for
   * /drain-cleaning/assets/logo.png. Ledger shipped that for a day. */
  const src = logo && !/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(logo) && !logo.startsWith('/')
    ? assetTo(logo, depth)
    : logo;

  /* NO PLATE BEHIND THE LOGO. The page is a warm cream and a wordmark drawn
   * in dark ink sits on it perfectly. Anvil and Harbor need one because
   * their bars are near-black. */
  const mark = logo
    ? `<img class="orchard-mark__img" src="${esc(src)}" alt="${esc(business.name || '')}">`
    : `<span class="orchard-mark__name">${esc(business.name || '')}</span>`;

  const here = slug => (current === slug ? ' aria-current="page"' : '');

  const work = services
    .map(s => `<li><a href="${linkTo(s.slug, depth)}"${here(s.slug)}>${esc(s.name)}</a></li>`)
    .join('');

  return `
<a class="orchard-skip" href="#${MAIN_ID}">Skip to content</a>
<header class="orchard-bar">
  <div class="orchard-hold orchard-bar__top">
    <a class="orchard-mark" href="${linkTo('index', depth)}">${mark}</a>
    <a class="orchard-dial" href="tel:${esc(business.tel || '')}">
      <span>Call</span>${esc(business.phone || '')}</a>
  </div>
  <nav class="orchard-nav" aria-label="Main"><div class="orchard-hold">
    <ul>
      <li><a href="${linkTo('index', depth)}"${here('index')}>Home</a></li>
      ${work}
      <li><a href="${linkTo('contact', depth)}"${here('contact')}>Contact</a></li>
    </ul>
  </div></nav>
</header>`;
}

/**
 * The masthead: centred, with the sub-line under it.
 *
 * CENTRED, WHICH NO OTHER STRUCTURE DOES. Six of them range their H1 left
 * because six of them are built on a column or a margin. This page has no
 * single edge to hang from — its sections lean left and right by turns — so
 * a centred title is the only one that does not pick a side before the
 * zigzag has started.
 */
function masthead({ h1 = '', sub = '' } = {}) {
  const said = String(sub == null ? '' : sub).trim();

  return `
<header class="orchard-top">
  <h1>${esc(h1)}</h1>
  ${said ? `<p class="orchard-top__said">${esc(said)}</p>` : ''}
</header>`;
}

/**
 * The plate: the photograph, in a full-width row of its own.
 *
 * FULL WIDTH AND NOT IN A CARD, which is what keeps the zigzag readable: a
 * picture that also leaned to one side would make the page look like it was
 * falling over rather than alternating.
 *
 * NOTHING AT ALL WITHOUT A PHOTOGRAPH. No H1 lives in here, so a page
 * outside the hero rotation goes from the title straight to the first card
 * and nothing looks unfinished.
 *
 * loading="eager" AND fetchpriority="high". It is the largest element on
 * the page and the one the page is measured by; lazy-loading it is the
 * commonest way to lose that measurement.
 */
function plate({ order = [], slug = '', alt = {}, depth = 0 } = {}) {
  const n = heroFor(order, slug);

  if (!n) return '';

  return `
<figure class="orchard-plate">
  <img src="${assetTo(`assets/hero-${n}.webp`, depth)}"
       width="1600" height="900" alt="${esc(alt[n] || '')}"
       loading="eager" fetchpriority="high" decoding="async">
</figure>`;
}

/**
 * A row: one section, as a card leaning to one side.
 *
 * THE WHOLE STRUCTURE IS THIS FUNCTION. `side` is 'left' or 'right' and the
 * caller alternates it; the stylesheet turns that into an offset at the
 * width that can hold one.
 *
 * THE SIDE IS DECIDED BY THE CALLER, NOT COUNTED HERE. pages.js knows how
 * many sections came before this one; a counter inside this function would
 * be state shared between two pages rendered in the same process, and the
 * second page would start wherever the first one stopped.
 *
 *     A RENDERER THAT REMEMBERS ANYTHING BETWEEN CALLS
 *     RENDERS A DIFFERENT SITE ON THE SECOND RUN.
 *
 * That is not hypothetical: renderSite() builds eleven pages in one pass,
 * and test-site-batch.js builds three whole sites in one process.
 */
function row({ label = '', id = '', body = '', side = 'left', tint = false } = {}) {
  const where = id ? ` id="${esc(id)}"` : '';
  const lean = 'right' === side ? ' orchard-row--right' : ' orchard-row--left';
  /* `orchard-card--tint`, NOT `orchard-row--tint`. The first version named
   * it after the row and put it on the CARD — a modifier whose name says it
   * belongs to one element while it sits on another is a selector somebody
   * writes correctly and watches miss. */
  const shade = tint ? ' orchard-card--tint' : '';

  return `
<section class="orchard-row${lean}"${where}>
  <div class="orchard-card${shade}">
    ${label ? `<h2>${esc(label)}</h2>` : ''}
    ${body}
  </div>
</section>`;
}

/**
 * The services, as a two-column grid with the number drawn large.
 *
 * THE SEVENTH ANSWER. Ledger numbers two columns, Beacon lays out three-up
 * tiles, Anvil stacks full-width rungs, Quarry sticks an index beside the
 * blurbs, Harbor runs a definition list, Atlas rules a table. Two-up with
 * an outlined numeral is the shape left, and the numeral is what stops it
 * being Beacon with one tile removed.
 *
 * THE NUMBER IS DECORATION AND IS HIDDEN FROM A SCREEN READER. It repeats
 * the order the list is already in, so reading it out loud is "oh one,
 * drain cleaning" — noise in front of every item.
 *
 * THE DECISION ABOUT WHAT IS LINKED IS NOT MADE HERE. homeRows() in
 * shape.js returns the flag and the suite counts it, which is deliberate:
 * it was broken twice inside a rendering function, where it was invisible.
 */
function grid(rows = []) {
  const items = rows.map(({ service, index: i, linked, href }) => {
    const name = esc(service.name);
    const said = esc(service.blurb || '');
    const num = String(i + 1).padStart(2, '0');

    return `
    <li class="orchard-fruit${linked ? '' : ' orchard-fruit--flat'}">
      <span class="orchard-fruit__num" aria-hidden="true">${num}</span>
      <h3>${linked ? `<a href="${href}">${name}</a>` : name}</h3>
      <p>${said}</p>
    </li>`;
  }).join('');

  return `<ul class="orchard-grove">${items}</ul>`;
}

/**
 * The hours, as a chip per day.
 *
 * THE SEVENTH ANSWER AND THE ONLY ONE THAT WRAPS. Ledger puts a table
 * beneath the prose, Beacon a slate beside it, Anvil a seven-column band,
 * Quarry a weekday/weekend split, Harbor the rail, Atlas one folded line of
 * type. Seven small chips flow like words and reflow at any width, which is
 * the one behaviour none of the other six has.
 *
 * A CLOSED DAY IS MARKED, NOT OMITTED. "Sunday closed" is an answer;
 * leaving Sunday out is a reader wondering whether it was forgotten.
 *
 * NOTHING AT ALL FOR NO HOURS. An empty strip under a heading is worse than
 * no strip.
 */
function hours({ hours: rows = [] } = {}) {
  const list = (rows || []).filter(Boolean);

  if (!list.length) return '';

  const chips = list.map((row) => {
    const shut = !row.open;

    return `
    <li class="orchard-chip${shut ? ' orchard-chip--shut' : ''}">
      <span class="orchard-chip__day">${esc(row.day || '')}</span>
      <span class="orchard-chip__when">${shut ? 'Closed' : esc(String(row.open))}</span>
    </li>`;
  }).join('');

  return `<ul class="orchard-week">${chips}</ul>`;
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
    return `<p class="orchard-onward">Or head back to ${home}.</p>`;
  }

  const label = 'contact' === next
    ? 'get in touch'
    : titleOf(next, { business, services }).toLowerCase();

  return `<p class="orchard-onward">Next: `
    + `<a href="${linkTo(next, depth)}">${esc(label)}</a>, or back to ${home}.</p>`;
}

/**
 * A divider: the line centred between two short rules.
 *
 * THE SEVENTH ANSWER. Beacon's break is a deep band, Anvil's a raised band,
 * Quarry's a hairline with the sentence under it, Harbor's a sentence with
 * the rule under that, Atlas's a sentence in the margin with no rule at all.
 * Centred between two rules is the shape left, and it is the only one that
 * sits in the middle — which is what the page needs between two cards that
 * lean opposite ways.
 *
 * NOT AN <h2>. Nothing sits under it and it introduces nothing; a heading
 * here would put an entry in the document outline that leads nowhere.
 *
 * EMPTY RENDERS NOTHING. Every site built before this structure existed has
 * no firstBreak in its stored source, and a re-render of one must produce a
 * page without a gap, not a gap without a line.
 */
function divider({ line = '' } = {}) {
  const text = String(line == null ? '' : line).trim();

  if (!text) return '';

  return `
<div class="orchard-break">
  <span class="orchard-break__rule" aria-hidden="true"></span>
  <p>${esc(text)}</p>
  <span class="orchard-break__rule" aria-hidden="true"></span>
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
<div class="orchard-map">
  <iframe title="Map showing ${esc(business.name || '')}" loading="lazy"
    referrerpolicy="no-referrer-when-downgrade"
    src="${esc(src)}"></iframe>
</div>`;
}

/**
 * The foot: centred, like the masthead, and for the same reason.
 *
 * ALL SIX SERVICES AND ALL THREE LEGAL PAGES. The ring shapes what the BODY
 * passes on; this is what makes sure nothing is unreachable.
 *
 * `now` IS AN ARGUMENT. The copyright year is the only thing on the site
 * that changes without anybody editing it, and a renderer that reads the
 * clock produces different bytes for the same input — which breaks the
 * "unchanged file costs nothing to re-upload" property the deploy relies
 * on, once a year, at midnight, for everybody at once.
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

  const work = services
    .map(s => `<a href="${linkTo(s.slug, depth)}">${esc(s.name)}</a>`).join('');

  const legal = LEGAL_SLUGS
    .map(slug => `<a href="${linkTo(slug, depth)}">${esc(PAGE_TITLES[slug] || slug)}</a>`)
    .join('');

  const where = areas.filter(Boolean);

  return `
<footer class="orchard-foot">
  <div class="orchard-hold">
    <p class="orchard-foot__name">${esc(business.name || '')}</p>
    <p class="orchard-foot__where">${esc(addressLine(business))}</p>
    <p><a class="orchard-foot__tel" href="tel:${esc(business.tel || '')}">${esc(business.phone || '')}</a></p>
    ${social ? `<p class="orchard-marks">${social}</p>` : ''}
    <p class="orchard-foot__links">
      <a href="${linkTo('index', depth)}">Home</a>${work}<a href="${linkTo('contact', depth)}">Contact</a>${legal}
    </p>
    <p class="orchard-foot__base">
      &copy; ${now.getFullYear()} ${esc(business.name || '')}${where.length
        ? ` &middot; ${esc(where.join(', '))}` : ''}
    </p>
  </div>
</footer>`;
}

/**
 * The page, head and all.
 *
 * THE CANONICAL IS ABSOLUTE AND BUILT FROM THE SITE'S OWN DOMAIN. Four
 * domains were migrated on 27 October and two of the pages on them carried
 * a canonical naming somebody else's — one of them `example.com`. A page
 * with the wrong canonical serves 200, looks perfect, and is invisible.
 */
function document({
  site = '', slug = '', title = '', description = '',
  body = '', jsonld = null, head: extra = '', depth = 0, verification = [],
} = {}) {
  const canonical = `${String(site).replace(/\/$/, '')}${urlFor(slug)}`;

  const ld = jsonld
    ? `\n<script type="application/ld+json">${JSON.stringify(jsonld)}</script>`
    : '';

  /* SEARCH CONSOLE, ON EVERY PAGE, WITH THE TOKEN ESCAPED — two defences
   * for one value. utils/blog/verificationTags.js already refused anything
   * that was not token-shaped before this was stored; this is the second,
   * because the parser is one validation somebody relaxes while tidying and
   * the result is customer-supplied text in an attribute on a public page. */
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
<link rel="stylesheet" href="${assetTo(CSS_PATH, depth)}">${verify}${extra}${ld}
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
  plate,
  row,
  grid,
  hours,
  onward,
  divider,
  mapFrame,
  foot,
  /* `document` IS IN THIS LIST, and Quarry's was not for an hour. The
   * function was written, syntax-checked and unreachable: node --check
   * reads a file, it does not ask whether anything can get at what is in
   * it. pages.js imports it as `wrap`, so the omission surfaced as
   * "wrap is not a function" on the first render. */
  document,
};
