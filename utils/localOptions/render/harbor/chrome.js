// utils/localOptions/render/harbor/chrome.js
//
// Harbor's furniture: rail, masthead, plate, offer, hours, map, foot.
//
// THE FIFTH STRUCTURE, AND THE FIRST THAT IS NOT A STACK OF BANDS.
//
// Ledger, Beacon, Anvil and Quarry are all one column: a header, then
// sections one under another, to a footer. They differ in what the sections
// look like. Harbor differs in where they are.
//
//     A PERSISTENT RAIL. On a wide screen a narrow left column carries the
//     business name, the phone number, the opening hours and the six
//     services, and stays put while the page scrolls past it. The content
//     runs in the right column.
//
// WHY THAT IS THE RIGHT FIFTH ANSWER AND NOT JUST A DIFFERENT ONE. Every
// page of a trade website exists to produce a phone call, and on all four
// existing layouts the number is at the top and then gone — a reader three
// screens into "what moves the price" has nothing to ring. Here it has not
// moved.
//
// ON A PHONE THE RAIL IS A BLOCK AT THE TOP, not a drawer and not a
// hamburger. These sites ship no JavaScript, and a 280px column beside a
// 360px screen is not a column. See the stylesheet: the rail is in the flow
// by default and becomes a rail at the wide breakpoint, which is the same
// mobile-first order Quarry established.
//
// WHAT IS ITS OWN AND WHAT IS SHARED
//
// Every class here begins `.harbor-` and every custom property `--hb-`.
// Ledger's `--lg-`, Beacon's `--bn-`, Anvil's `--av-` and Quarry's `--qy-`
// appear nowhere. All five are served as assets/site.css to different sites,
// so a shared name is not a clash inside one file — it is a rule written for
// one layout silently restyling another, on a site nobody is looking at.
//
// THE IDS ARE ITS OWN TOO — Edwin, 30 October: "different classes and prefix
// and css IDs". Quarry's MAIN_ID was Beacon's for an hour and nothing would
// have failed; see the note on MAIN_ID below.
//
// NO BACKTICKS IN ANY COMMENT INSIDE A TEMPLATE LITERAL. One ends the string
// early, and that has cost a syntax error in this project three times.

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

const { CSS_PATH, FAVICON_PATH } = require('../theme');
const { SOCIAL, initials, addressLine, addressQuery } = require('../common');

/* HARBOR'S OWN IDS.
 *
 * Taken already: main/services (Ledger), content/trades/whereabouts
 * (Beacon), page/work/findus (Anvil), read/index/visit (Quarry).
 *
 * TWO LAYOUTS SHARING AN ID STILL WORK. They just cannot be told apart by a
 * fragment in a URL, by a scraper, or by a test — which is how Quarry's
 * collision with Beacon went unnoticed until a test went looking for it. */
const MAIN_ID = 'here';
const TRADES_ID = 'offer';
const WHERE_ID = 'reach';

/**
 * The rail: everything a reader might want, kept on screen.
 *
 * ONE ELEMENT DOING FOUR JOBS, which is the whole structure. It is the
 * header, the navigation, the contact details and the hours — so a page has
 * no masthead bar above it at all, and that is why Harbor's content starts
 * at the top of the screen where the other four start below a band.
 *
 * THE PHONE NUMBER IS A BUTTON AND IT IS NEVER OFF SCREEN. On the other
 * four it scrolls away with the header. That is the one measurable thing
 * this layout is for.
 *
 * ALL SIX SERVICES, ALWAYS, with the current one marked. The ring caps what
 * the BODY passes on; navigation is not the ring, and a rail that showed
 * two of six would be a worse menu than the dropdown it replaces.
 *
 * NO <details> HERE, UNLIKE THE OTHER FOUR. They hide the services behind a
 * disclosure because a horizontal bar has no room for six. A column has
 * room for six. A disclosure in a rail would be a click to reveal something
 * that already fits.
 */
function rail({
  business = {}, logo = '', current = '', services = [], hours: rows = [], depth = 0,
} = {}) {
  /* RE-BASED FOR DEPTH, like every other asset. A relative path that is not
   * re-based is correct at the root and wrong everywhere else:
   * `assets/logo.png` from /drain-cleaning/ asks for
   * /drain-cleaning/assets/logo.png. Ledger shipped that for a day. An
   * already-absolute logo is left exactly as handed over. */
  const src = logo && !/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(logo) && !logo.startsWith('/')
    ? assetTo(logo, depth)
    : logo;

  /* NO PLATE BEHIND THE LOGO. The rail is sand, not navy — see the
   * stylesheet. Anvil needs a white plate because its rail is near-black
   * and a logo drawn in dark ink on transparency vanishes on it; on a light
   * rail that is the normal case and needs no help. */
  const mark = logo
    ? `<img class="harbor-mark__img" src="${esc(src)}" alt="${esc(business.name || '')}">`
    : `<span class="harbor-mark__glyph">${esc(initials(business.name))}</span>`;

  const here = slug => (current === slug ? ' aria-current="page"' : '');

  const work = services
    .map(s => `<li><a href="${linkTo(s.slug, depth)}"${here(s.slug)}>${esc(s.name)}</a></li>`)
    .join('');

  const open = (rows || []).filter(Boolean)
    .map(({ day, open: when }) => `
      <div class="harbor-open__row${when ? '' : ' harbor-open__row--shut'}">
        <dt>${esc(day)}</dt><dd>${esc(when || 'Closed')}</dd>
      </div>`).join('');

  return `
<a class="harbor-skip" href="#${MAIN_ID}">Skip to content</a>
<aside class="harbor-rail">
  <div class="harbor-rail__inner">

    <a class="harbor-mark" href="${linkTo('index', depth)}">
      ${mark}${logo ? '' : `
      <span class="harbor-mark__name">${esc(business.name || '')}</span>`}
    </a>

    ${/* THE CALL BUTTON, AND IT IS THE FIRST THING UNDER THE NAME. */''}
    <a class="harbor-call" href="tel:${esc(business.tel || '')}">
      <span>Call</span>${esc(business.phone || '')}
    </a>

    <nav class="harbor-menu" aria-label="Main">
      <p class="harbor-menu__title">What we do</p>
      <ul>${work}</ul>
      <ul class="harbor-menu__rest">
        <li><a href="${linkTo('index', depth)}"${here('index')}>Home</a></li>
        <li><a href="${linkTo('contact', depth)}"${here('contact')}>Contact</a></li>
      </ul>
    </nav>

    ${/* THE HOURS LIVE HERE AND NOWHERE ELSE — the fifth answer to the
         question all five were asked. Ledger puts a table beneath the
         prose, Beacon a slate beside it, Anvil a band across, Quarry a
         split box in the aside. Harbor does not put them on the page at
         all: they are furniture, on every page, in the rail. */''}
    ${open ? `
    <div class="harbor-open">
      <p class="harbor-open__title">When we are open</p>
      <dl>${open}</dl>
    </div>` : ''}

    <p class="harbor-rail__where">
      ${esc(business.street || '')}<br>
      ${esc([business.city, business.state].filter(Boolean).join(', '))} ${esc(business.zip || '')}
    </p>

  </div>
</aside>`;
}

/**
 * The masthead: the headline and the sub-line, at the top of the content
 * column.
 *
 * NO BUTTONS AND NO PHONE NUMBER, ALONE AMONG THE FIVE. They are in the
 * rail, two inches to the left, on every page and at every scroll
 * position. Repeating them here would be the same control twice on one
 * screen, which is the fault Quarry's seam caption was removed for.
 *
 * NO BAND EITHER. The other four open on a coloured or photographic block;
 * Harbor's content column starts with type on the page ground, because the
 * rail is already carrying the visual weight on that side.
 */
function masthead({ h1 = '', sub = '' } = {}) {
  const said = String(sub == null ? '' : sub).trim();

  return `
<header class="harbor-top">
  <h1>${esc(h1)}</h1>
  ${said ? `<p class="harbor-top__said">${esc(said)}</p>` : ''}
</header>`;
}

/**
 * The plate: the photograph, inset in the content column.
 *
 * INSET, NOT FULL BLEED, and that follows from the rail. A full-width band
 * on a page with a 280px column down one side is a band that starts in an
 * odd place and cannot be centred on anything; Quarry's seam works because
 * its page has two equal margins. So this one sits in the column like a
 * figure in a book, with the column's own margins either side.
 *
 * 16:9 AND SHORT, for the reason Quarry's note gives: the photograph is a
 * punctuation mark, not a hero. The hero is the headline.
 *
 * NOTHING AT ALL WITHOUT A PHOTOGRAPH. No H1 lives in here to strand — the
 * masthead above is independent — so a page outside the hero rotation goes
 * straight from the headline to the prose and nothing looks unfinished.
 *
 * loading="eager" AND fetchpriority="high". It is the largest element on
 * the page and the one the page is measured by; lazy-loading it is the
 * commonest way to lose that measurement.
 */
function plate({ order = [], slug = '', alt = {}, depth = 0 } = {}) {
  const n = heroFor(order, slug);

  if (!n) return '';

  return `
<figure class="harbor-plate">
  <img src="${assetTo(`assets/hero-${n}.webp`, depth)}"
       width="1600" height="900" alt="${esc(alt[n] || '')}"
       loading="eager" fetchpriority="high" decoding="async">
</figure>`;
}

/**
 * The offer: the six services, as a column of wide rows.
 *
 * NAME AND BLURB ON ONE LINE EACH, which is the fifth answer. Ledger
 * numbers two columns, Beacon lays out three-up tiles, Anvil stacks
 * full-width rungs, Quarry sticks an index beside the blurbs. This is a
 * definition list: the thing, then what it is, reading down.
 *
 * THE DECISION ABOUT WHAT IS LINKED IS NOT MADE HERE. homeRows() in
 * shape.js returns the flag and the suite counts it, which is deliberate:
 * it was broken twice inside a rendering function, where it was invisible.
 *
 * A ROW THAT LOOKS CLICKABLE AND IS NOT IS WORSE THAN ONE THAT PLAINLY IS
 * NOT, so the services past the body cap are shown unlinked and visibly
 * muted rather than quietly inert.
 */
function offer(rows = []) {
  return rows.map(({ service, linked, href }) => {
    const name = esc(service.name);
    const said = esc(service.blurb || '');

    return linked
      ? `<div class="harbor-offer__row">
           <dt><a href="${href}">${name}</a></dt><dd>${said}</dd>
         </div>`
      : `<div class="harbor-offer__row harbor-offer__row--flat">
           <dt>${name}</dt><dd>${said}</dd>
         </div>`;
  }).join('');
}

/**
 * The ring, as a sentence.
 *
 * LOWERCASING THE TITLE WORKS FOR A SERVICE AND NOT FOR A NAME. "or contact
 * leander plumbing gomanzo" is what Ledger's first version produced, because
 * contact's title is built from the business name. Contact gets its own
 * wording instead, and every structure since has inherited the lesson
 * rather than the bug.
 */
function onward({ order = [], slug = '', business = {}, services = [], depth = 0 } = {}) {
  const next = ringNext(order, slug);
  const home = `<a href="${linkTo('index', depth)}">the home page</a>`;

  if (!next) {
    return `<p class="harbor-onward">Or head back to ${home}.</p>`;
  }

  const label = 'contact' === next
    ? 'get in touch'
    : titleOf(next, { business, services }).toLowerCase();

  return `<p class="harbor-onward">Next: `
    + `<a href="${linkTo(next, depth)}">${esc(label)}</a>, or back to ${home}.</p>`;
}

/**
 * A divider: a rule across the content column with the line above it.
 *
 * THE FIFTH ANSWER, AND THE SHORTEST. Beacon's break is a deep band on a
 * near-white page, Anvil's a raised band on a dark one, Quarry's a hairline
 * with the sentence hanging beneath it. Harbor puts the sentence FIRST and
 * the rule under it, so it reads as the end of what came before rather than
 * the opening of what follows — which is what a breather is.
 *
 * NOT AN <h2>. Nothing sits under it and it introduces nothing; a heading
 * here would put an entry in the document outline that leads nowhere.
 *
 * EMPTY RENDERS NOTHING. Every site built before this structure existed has
 * no firstBreak in its stored source, and a re-render of one must produce a
 * page without a rule, not a rule without a line.
 */
function divider({ line = '' } = {}) {
  const text = String(line == null ? '' : line).trim();

  if (!text) return '';

  return `
<div class="harbor-break"><p>${esc(text)}</p></div>`;
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
<div class="harbor-map">
  <iframe title="Map showing ${esc(business.name || '')}" loading="lazy"
    referrerpolicy="no-referrer-when-downgrade"
    src="${esc(src)}"></iframe>
</div>`;
}

/**
 * The foot.
 *
 * SHORTER THAN THE OTHER FOUR, AND THE RAIL IS WHY. Theirs carry the
 * address, the phone, all six services and the legal links, because that is
 * the last chance to show them. Here the address, the phone and the six are
 * on screen already and have been the whole way down; repeating them is the
 * same list twice.
 *
 *     A FOOTER REPEATS WHAT SCROLLED AWAY. NOTHING SCROLLED AWAY.
 *
 * WHAT IS LEFT IS WHAT THE RAIL DOES NOT CARRY: the legal pages, the social
 * links and the copyright line. The three legal pages are here and only
 * here, which is what keeps them reachable from every page.
 *
 * `now` IS AN ARGUMENT. The copyright year is the only thing on the site
 * that changes without anybody editing it, and a renderer that reads the
 * clock produces different bytes for the same input — which breaks the
 * "unchanged file costs nothing to re-upload" property the deploy relies
 * on, once a year, at midnight, for everybody at once.
 */
function foot({ business = {}, areas = [], now = new Date(), depth = 0 } = {}) {
  const social = Object.entries(business.social || {})
    .filter(([key, href]) => SOCIAL[key] && href)
    .map(([key, href]) => {
      const { viewBox, path } = SOCIAL[key];
      const label = key[0].toUpperCase() + key.slice(1);

      return `<a href="${esc(href)}" rel="noopener" aria-label="${esc(label)}">`
        + `<svg viewBox="${viewBox}" aria-hidden="true"><path d="${path}"/></svg></a>`;
    }).join('');

  const legal = LEGAL_SLUGS
    .map(slug => `<a href="${linkTo(slug, depth)}">${esc(PAGE_TITLES[slug] || slug)}</a>`)
    .join('');

  const where = areas.filter(Boolean);

  return `
<footer class="harbor-foot">
  <p class="harbor-foot__legal">${legal}</p>
  ${social ? `<p class="harbor-marks">${social}</p>` : ''}
  <p class="harbor-foot__base">
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
 * bright scrollbar and a white flash on overscroll without it. Harbor is
 * light, so the browser's default is already right.
 */
function document({
  site = '', slug = '', title = '', description = '',
  body = '', jsonld = null, head = '', depth = 0, verification = [],
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
<link rel="stylesheet" href="${assetTo(CSS_PATH, depth)}">
<link rel="icon" href="${assetTo(FAVICON_PATH, depth)}" type="image/png">${verify}${head}${ld}
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
  masthead,
  plate,
  offer,
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
