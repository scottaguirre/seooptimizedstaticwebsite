// utils/localOptions/render/atlas/chrome.js
//
// Atlas's furniture: head, masthead, plate, leaf, index, hours, foot.
//
// THE SIXTH STRUCTURE, AND THE FIRST WHOSE HEADINGS ARE NOT ABOVE ANYTHING.
//
// Ledger, Beacon, Anvil, Quarry and Harbor all put a heading on top of the
// thing it introduces. They differ in what sits underneath. Atlas puts the
// heading in the LEFT MARGIN, beside its prose, so the whole page can be
// read down one edge without reading the page.
//
//     A REFERENCE PAGE. The labels are a column of their own; the text is
//     a column of its own; neither interrupts the other.
//
// ON A PHONE THE LABEL GOES BACK ON TOP, because a 12rem margin beside a
// 360px screen is not a margin. That is the same mobile-first order Quarry
// established and Harbor followed: the base rules are the phone and the
// margin arrives at the breakpoint that can hold it.
//
// AND THE TYPE IS INVERTED FROM LEDGER'S. Ledger sets its headings in
// Georgia and its body in a sans. Atlas sets its body in a serif and its
// margin labels in a small tracked sans — which is the other way round, and
// is what makes a page of this shape read as a reference rather than as a
// brochure.
//
// WHAT IS ITS OWN AND WHAT IS SHARED
//
// Every class here begins `.atlas-` and every custom property `--at-`.
// Ledger's `--lg-`, Beacon's `--bn-`, Anvil's `--av-`, Quarry's `--qy-` and
// Harbor's `--hb-` appear nowhere. All six are served as assets/site.css to
// different sites, so a shared name is not a clash inside one file — it is
// a rule written for one layout silently restyling another, on a site
// nobody is looking at.
//
// NO BACKTICKS IN ANY COMMENT INSIDE A TEMPLATE LITERAL. One ends the
// string early, and that has cost a syntax error in this project three
// times.

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

/* ATLAS'S OWN IDS.
 *
 * Taken already: main/services (Ledger), content/trades/whereabouts
 * (Beacon), page/work/findus (Anvil), read/index/visit (Quarry),
 * here/offer/reach (Harbor).
 *
 * TWO LAYOUTS SHARING AN ID STILL WORK. They just cannot be told apart by a
 * fragment in a URL, by a scraper, or by a test — which is how Quarry's
 * collision with Beacon went unnoticed until a test went looking. */
const MAIN_ID = 'text';
const TRADES_ID = 'list';
const WHERE_ID = 'place';

/**
 * The head: one line, and a double rule under it.
 *
 * THE SMALLEST OF THE SIX, deliberately. Harbor's rail carries everything;
 * Ledger, Beacon, Anvil and Quarry all have a bar with a logo, a menu and a
 * call button. This has the name on the left, the number on the right, and
 * the services in a second line of small links beneath — because on a
 * reference page the furniture should not out-weigh the first heading.
 *
 * THE DOUBLE RULE IS THE SIGNATURE. A thick line and a hairline under it,
 * which is what the top of a printed reference page looks like and what
 * nothing else here has.
 *
 * NO <details>, UNLIKE FOUR OF THE FIVE. They hide six services behind a
 * disclosure because a bar with a logo and a button has no room. This bar
 * has nothing else in it, so the six fit on their own line.
 */
function head({ business = {}, logo = '', current = '', services = [], depth = 0 } = {}) {
  /* RE-BASED FOR DEPTH, like every other asset. A relative path that is not
   * re-based is correct at the root and wrong everywhere else:
   * `assets/logo.png` from /drain-cleaning/ asks for
   * /drain-cleaning/assets/logo.png. Ledger shipped that for a day. */
  const src = logo && !/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(logo) && !logo.startsWith('/')
    ? assetTo(logo, depth)
    : logo;

  /* NO PLATE BEHIND THE LOGO. The page is warm white; Anvil's plate exists
   * because its rail is near-black and a logo drawn in dark ink on
   * transparency vanishes on it. Here that is the normal case. */
  const mark = logo
    ? `<img class="atlas-mark__img" src="${esc(src)}" alt="${esc(business.name || '')}">`
    : `<span class="atlas-mark__name">${esc(business.name || '')}</span>`;

  const here = slug => (current === slug ? ' aria-current="page"' : '');

  const work = services
    .map(s => `<li><a href="${linkTo(s.slug, depth)}"${here(s.slug)}>${esc(s.name)}</a></li>`)
    .join('');

  return `
<a class="atlas-skip" href="#${MAIN_ID}">Skip to content</a>
<header class="atlas-head">
  <div class="atlas-wrap atlas-head__top">
    <a class="atlas-mark" href="${linkTo('index', depth)}">${mark}</a>
    <a class="atlas-dial" href="tel:${esc(business.tel || '')}">${esc(business.phone || '')}</a>
  </div>
  <nav class="atlas-nav" aria-label="Main"><div class="atlas-wrap">
    <ul>
      <li><a href="${linkTo('index', depth)}"${here('index')}>Home</a></li>
      ${work}
      <li><a href="${linkTo('contact', depth)}"${here('contact')}>Contact</a></li>
    </ul>
  </div></nav>
</header>`;
}

/**
 * The masthead: a numeral in the margin, the headline in the text column.
 *
 * THE FIRST THING THAT USES THE MARGIN, so a reader learns the page's shape
 * from the title block before any section needs it.
 *
 * THE NUMERAL IS NOT A COUNT OF ANYTHING. It is the page's place in the
 * ring, which the reader never has to care about — it is there because a
 * reference page carries a figure in its margin and an empty margin beside
 * the biggest type on the page looks like a mistake rather than a design.
 * Absent on pages outside the ring, where it would be a number with no
 * sequence to belong to.
 */
function masthead({ h1 = '', sub = '', mark = '' } = {}) {
  const said = String(sub == null ? '' : sub).trim();

  return `
<header class="atlas-top">
  <div class="atlas-top__mark">${esc(mark)}</div>
  <div class="atlas-top__words">
    <h1>${esc(h1)}</h1>
    ${said ? `<p class="atlas-top__said">${esc(said)}</p>` : ''}
  </div>
</header>`;
}

/**
 * The plate: the photograph, across the whole width including the margin.
 *
 * THE ONE THING THAT CROSSES THE MARGIN, and that is why it works: on every
 * other block the left column is a label and the right is text, so a
 * photograph spanning both is the page drawing breath.
 *
 * NOT IN THE MARGIN ITSELF. A 2:1 photograph cropped into a 12rem column is
 * a letterbox of somebody's elbow. The margin is for labels.
 *
 * NOTHING AT ALL WITHOUT A PHOTOGRAPH. No H1 lives in here, so a page
 * outside the hero rotation goes from the title block to the first section
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
<figure class="atlas-plate">
  <img src="${assetTo(`assets/hero-${n}.webp`, depth)}"
       width="1600" height="900" alt="${esc(alt[n] || '')}"
       loading="eager" fetchpriority="high" decoding="async">
</figure>`;
}

/**
 * A leaf: one labelled block. The heading goes in the margin.
 *
 * THE WHOLE STRUCTURE IS THIS FUNCTION. Every section of every page is a
 * label on the left and a column of something on the right, which is what
 * lets the page be skimmed down one edge.
 *
 * AN EMPTY LABEL STILL RENDERS THE CELL, so the text column starts at the
 * same place whether or not a block is labelled. A section that shifted
 * left because it had no heading would make the margin look accidental.
 */
function leaf({ label = '', id = '', body = '' } = {}) {
  const where = id ? ` id="${esc(id)}"` : '';

  return `
<section class="atlas-leaf"${where}>
  <div class="atlas-leaf__label">${label ? `<h2>${esc(label)}</h2>` : ''}</div>
  <div class="atlas-leaf__body">${body}</div>
</section>`;
}

/**
 * The services, as a two-column table.
 *
 * THE SIXTH ANSWER. Ledger numbers two columns, Beacon lays out three-up
 * tiles, Anvil stacks full-width rungs, Quarry sticks an index beside the
 * blurbs, Harbor runs a definition list. A table is the one shape left and
 * the one that belongs on a page of this kind: two columns, ruled, the name
 * against the line.
 *
 * A REAL <table>, NOT A GRID OF DIVS. It is tabular data — a name and a
 * description, repeated — so anything reading the page without looking at
 * it gets the pairing for free.
 *
 * THE DECISION ABOUT WHAT IS LINKED IS NOT MADE HERE. homeRows() in
 * shape.js returns the flag and the suite counts it, which is deliberate:
 * it was broken twice inside a rendering function, where it was invisible.
 */
function index(rows = []) {
  const body = rows.map(({ service, index: i, linked, href }) => {
    const name = esc(service.name);
    const said = esc(service.blurb || '');
    const num = String(i + 1).padStart(2, '0');

    return `
      <tr${linked ? '' : ' class="atlas-index__row--flat"'}>
        <td class="atlas-index__num">${num}</td>
        <td class="atlas-index__name">${linked ? `<a href="${href}">${name}</a>` : name}</td>
        <td class="atlas-index__said">${said}</td>
      </tr>`;
  }).join('');

  return `
<table class="atlas-index">
  <tbody>${body}</tbody>
</table>`;
}

/**
 * The hours, as one run-in line with consecutive days folded together.
 *
 * THE SIXTH ANSWER, AND THE ONLY ONE THAT IS NOT A GRID OF SEVEN. Ledger
 * puts a table beneath the prose, Beacon a slate beside it, Anvil a
 * seven-column band, Quarry a weekday/weekend split, Harbor the rail. This
 * reads as a line of type, which is what a reference page does with a
 * timetable:
 *
 *     Mon-Thu 7:00 AM - 6:00 PM. Fri 7:00 AM - 5:00 PM. Sun closed.
 *
 * THE FOLDING IS THE POINT AND IT IS REAL LOGIC. Four identical rows
 * printed four times is a table with the formatting taken off; folding them
 * into a range is what makes the line shorter than the grid rather than
 * just flatter.
 *
 * CONSECUTIVE ONLY, NEVER SORTED. The days arrive in the order whoever
 * built the list meant, already localised. Grouping every matching day
 * wherever it fell would print "Mon, Wed-Thu" for a business that is shut
 * on Tuesday, which is true and unreadable; a run is a run.
 *
 * AND IT COMPARES THE PRINTED STRING, not a parsed time. Two days are the
 * same when they SAY the same thing — which is the only comparison that
 * cannot disagree with what the reader sees.
 */
function hours({ hours: rows = [] } = {}) {
  const list = (rows || []).filter(Boolean);

  if (!list.length) return '';

  /* SHORTENED ONLY WHERE A RUN IS SHORTENED. A single day keeps its full
   * name — "Sunday closed" reads better than "Sun closed" on its own — and
   * a range uses the short form at both ends so the dash has something
   * even to sit between. */
  const short = day => String(day || '').slice(0, 3);

  const runs = [];

  for (const row of list) {
    const when = row.open ? String(row.open) : '';
    const last = runs[runs.length - 1];

    if (last && last.when === when) last.days.push(row.day);
    else runs.push({ when, days: [row.day] });
  }

  const parts = runs.map(({ when, days }) => {
    const span = 1 === days.length
      ? esc(days[0])
      : `${esc(short(days[0]))}&ndash;${esc(short(days[days.length - 1]))}`;

    return `<span class="atlas-hours__run">${span} ${when ? esc(when) : 'closed'}</span>`;
  });

  return `<p class="atlas-hours">${parts.join(' ')}</p>`;
}

/**
 * The ring, as a sentence.
 *
 * LOWERCASING THE TITLE WORKS FOR A SERVICE AND NOT FOR A NAME. "or contact
 * leander plumbing gomanzo" is what Ledger's first version produced,
 * because contact's title is built from the business name. Contact gets its
 * own wording instead, and every structure since has inherited the lesson
 * rather than the bug.
 */
function onward({ order = [], slug = '', business = {}, services = [], depth = 0 } = {}) {
  const next = ringNext(order, slug);
  const home = `<a href="${linkTo('index', depth)}">the home page</a>`;

  if (!next) {
    return `<p class="atlas-onward">Or head back to ${home}.</p>`;
  }

  const label = 'contact' === next
    ? 'get in touch'
    : titleOf(next, { business, services }).toLowerCase();

  return `<p class="atlas-onward">Next: `
    + `<a href="${linkTo(next, depth)}">${esc(label)}</a>, or back to ${home}.</p>`;
}

/**
 * A divider: the line set in the MARGIN, with nothing in the text column.
 *
 * THE SIXTH ANSWER AND THE ONLY ONE WITH NO RULE AT ALL. Beacon's break is
 * a deep band, Anvil's a raised band, Quarry's a hairline with the sentence
 * under it, Harbor's a sentence with the rule under that. Atlas puts the
 * sentence where the labels go and leaves the text column empty, so the
 * break is a gap in the page's own grid.
 *
 * NOT AN <h2>. Nothing sits under it and it introduces nothing; a heading
 * here would put an entry in the document outline that leads nowhere —
 * which matters more on this structure than the others, because every real
 * heading on the page is in that same margin.
 *
 * EMPTY RENDERS NOTHING. Every site built before this structure existed has
 * no firstBreak in its stored source, and a re-render of one must produce a
 * page without a gap, not a gap without a line.
 */
function divider({ line = '' } = {}) {
  const text = String(line == null ? '' : line).trim();

  if (!text) return '';

  return `
<div class="atlas-break">
  <p>${esc(text)}</p>
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
<div class="atlas-map">
  <iframe title="Map showing ${esc(business.name || '')}" loading="lazy"
    referrerpolicy="no-referrer-when-downgrade"
    src="${esc(src)}"></iframe>
</div>`;
}

/**
 * The foot, in the same two columns as everything above it.
 *
 * THE LABELS STAY IN THE MARGIN RIGHT TO THE BOTTOM. A footer that broke
 * into three equal columns — which is what the other five do — would be the
 * one block on the page that abandoned the grid, directly under the block
 * that proves it.
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
<footer class="atlas-foot">
  <div class="atlas-leaf">
    <div class="atlas-leaf__label"><h2>Where</h2></div>
    <div class="atlas-leaf__body">
      <p>${esc(business.name || '')}<br>${esc(addressLine(business))}</p>
      <p><a href="tel:${esc(business.tel || '')}">${esc(business.phone || '')}</a></p>
      ${social ? `<p class="atlas-marks">${social}</p>` : ''}
    </div>
  </div>

  <div class="atlas-leaf">
    <div class="atlas-leaf__label"><h2>Pages</h2></div>
    <div class="atlas-leaf__body">
      <p class="atlas-foot__links">
        <a href="${linkTo('index', depth)}">Home</a>${work}<a href="${linkTo('contact', depth)}">Contact</a>${legal}
      </p>
    </div>
  </div>

  <p class="atlas-foot__base">
    &copy; ${now.getFullYear()} ${esc(business.name || '')}${where.length
      ? ` &middot; ${esc(where.join(', '))}` : ''}
  </p>
</footer>`;
}

/**
 * The page, head and all.
 *
 * THE CANONICAL IS ABSOLUTE AND BUILT FROM THE SITE'S OWN DOMAIN. Four
 * domains were migrated on 27 October and two of the pages on them carried
 * a canonical naming somebody else's — one of them `example.com`. A page
 * with the wrong canonical serves 200, looks perfect, and is invisible.
 *
 * NO `color-scheme` LINE. Anvil carries one because a dark page gets a
 * bright scrollbar and a white flash on overscroll without it. Atlas is a
 * warm white page, so the browser's default is already right.
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
  head,
  masthead,
  plate,
  leaf,
  index,
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
