// utils/localOptions/render/quarry/pages.js
//
// Quarry's eleven pages.
//
// THE SAME ELEVEN, AND THE SAME SECTIONS INSIDE THEM — the rule that has
// held since Beacon, and the one thing a new structure may not re-decide. So
// this takes exactly what Ledger's, Beacon's and Anvil's pages.js take, in
// exactly the same shape, and decides different markup for it. Nothing here
// knows how the words were written and nothing here writes any.
//
// WHAT IS GENUINELY DIFFERENT
//
//   home      the words come FIRST — an oversized headline alone, then the
//             photograph as a full-bleed seam beneath it. The other three
//             all put a picture at or above the H1.
//   home      the services are an INDEX: a sticky column of names on the
//             left, the blurbs running past it on the right. Not a numbered
//             list, not tiles, not rungs.
//   service   the hours sit in the right-hand column BESIDE the prose on a
//             wide screen and fall under it on a narrow one — Ledger puts a
//             table beneath, Beacon an aside, Anvil a full-width band.
//   contact   the form is in the left column with the facts stacked in the
//             right, which is the mirror of Beacon and neither of the other
//             two.
//   legal     the H1 is in a plain block, as in all three others — there is
//             no sensible fourth way to set a privacy policy.
//   404       same.
//
// WHAT IS DELIBERATELY IDENTICAL
//
// The ring, the body-link cap, the hero rotation, the schema, the canonical,
// the Search Console tags and the legal copy. Every one is a rule about the
// SITE rather than about how it looks.
//
//   node test-local-options-quarry.js

'use strict';

const {
  esc,
  urlFor,
  linkTo,
  depthOf,
  homeRows,
  inWords,
  SERVICE_COUNT,
  HOME_BODY_LINKS,
  LEGAL_SLUGS,
  PAGE_TITLES,
} = require('../shape');

const {
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
  document: wrap,
} = require('./chrome');

const { contextFor, telFor, homeHeading } = require('../common');
const { richText } = require('../richText');
const { linkHome } = require('../linkHome');
const { localBusiness, serviceNode } = require('../schema');
const { legalSections } = require('../legalText');

/**
 * `{ heading, paragraphs }[]` -> HTML.
 *
 * THE FIRST PARAGRAPH OF THE FIRST SECTION IS THE LEAD, and only that one.
 * An empty heading opens the page without one, which is how every body here
 * starts: the H1 is in the masthead, and an h2 immediately under it saying
 * the same thing twice is the commonest shape of generated page there is.
 *
 * richText, NOT esc — and richText escapes first. An owner editing a live
 * site can put a link in a sentence; see that file for why the order is
 * escape-then-convert rather than allow-some-HTML.
 */
function prose(sections = []) {
  const out = [];

  sections.forEach((section, i) => {
    if (section.heading) out.push(`<h2>${esc(section.heading)}</h2>`);

    (section.paragraphs || []).forEach((text, j) => {
      const lead = 0 === i && 0 === j ? ' class="quarry-lede"' : '';

      out.push(`<p${lead}>${richText(text)}</p>`);
    });
  });

  return out.join('\n');
}

/**
 * bar + main + foot, the same on all eleven.
 *
 * `depth` DEFAULTS TO THE SLUG'S OWN and is passed explicitly only by
 * 404.html, which needs absolute links — see linkTo() in shape.js.
 *
 * THE SERVICES GO TO BOTH ENDS, from one argument object. A header given a
 * different list from the footer is a site whose menu and footer disagree
 * about what it sells; Ledger's menu reached three of the six for a day
 * because the two were built separately.
 */
function shell(ctx, slug, body, depth = depthOf(slug)) {
  return `${bar({
    business: ctx.business,
    logo: ctx.logo,
    current: slug,
    services: ctx.services,
    depth,
  })}
<main id="${MAIN_ID}">
${body}
</main>
${foot({ business: ctx.business, services: ctx.services, areas: ctx.areas, now: ctx.now, depth })}`;
}

/**
 * A default, not fixed text, and editable — see Ledger's pages.js.
 *
 * WRITTEN TO THE READER, NOT ABOUT THE SITE. The first draft of Anvil's said
 * "All six have a page of their own", which is the exact sentence Edwin
 * struck out on 30 October: "this should be for a customer." It is a note
 * about what was BUILT, not a reason to read on.
 *
 * AND IT OPENS ON THE READER'S PROBLEM, because Quarry's voice does. Ledger
 * counts the jobs, Beacon names what it is called out for, Anvil tells the
 * reader what to do. This one starts from what is wrong. Four ledes about
 * the same six services.
 *
 * `SERVICE_COUNT` THROUGH inWords(), NEVER THE WORD "six" TYPED OUT. The
 * services lede said "three" for a day after the body-link cap became two,
 * because the number was prose rather than the constant.
 */
function defaultServicesLede() {
  return 'Whatever is wrong, it is probably one of these '
    + `${inWords(SERVICE_COUNT)}. Each opens onto what the work involves, `
    + 'how long it usually takes, and what moves the price.';
}

/**
 * The home page.
 *
 * THE INDEX IS THE DIFFERENCE. All six services are listed as an index — a
 * column of names that stays put while the blurbs scroll past it. The first
 * two names are links; the rest are the same row without an anchor and
 * visibly muted, because a row that looks clickable and is not is worse than
 * one that plainly is not.
 *
 * THE DECISION IS NOT MADE HERE. homeRows() returns the flag and the suite
 * counts it, which is deliberate: it was broken twice inside a rendering
 * function, where it was invisible.
 */
function homePage(ctx, copy = {}) {
  const rows = homeRows(ctx.services, 0);

  const names = rows.map(({ service, index, linked, href }) => {
    const label = `<span class="quarry-index__tally">${String(index + 1).padStart(2, '0')}</span>`
      + `<span class="quarry-index__name">${esc(service.name)}</span>`;

    return linked
      ? `<li class="quarry-index__row"><a href="${href}">${label}</a></li>`
      : `<li class="quarry-index__row quarry-index__row--flat"><span>${label}</span></li>`;
  }).join('');

  const blurbs = rows.map(({ service, index }) => `
    <div class="quarry-told">
      <h3 class="quarry-told__name">
        <span class="quarry-told__tally">${String(index + 1).padStart(2, '0')}</span>
        ${esc(service.name)}
      </h3>
      <p>${esc(service.blurb || '')}</p>
    </div>`).join('');

  const about = (copy.about || []).map(p => `<p>${richText(p)}</p>`).join('\n      ');

  /* ABSENT IS NOT EMPTY — see Ledger's pages.js for the whole of it.
   * `undefined` means nobody has edited this field and the default stands;
   * an empty string means the owner cleared it on purpose. */
  const lede = undefined === copy.servicesLede
    ? defaultServicesLede()
    : String(copy.servicesLede || '').trim();

  const ledeHtml = lede ? `<p>${richText(lede)}</p>` : '';

  const body = `
${masthead({ h1: homeHeading(ctx.business), sub: copy.sub || '', business: ctx.business, depth: 0 })}

${/* THE PICTURE COMES AFTER THE HEADLINE. The whole structure turns on this
    one inversion — see the note at the top of chrome.js. It carries no
    caption: the first version captioned it with the owner's sub-line, which
    is the sentence printed two inches above it. */''}
${seam({ order: ctx.order, slug: 'index', alt: ctx.alt, depth: 0 })}

${/* THE FACTS COME AFTER THE INTRODUCTION, NOT BEFORE IT. Beacon learned
    this on 30 October: under the hero it puts three lines of address
    between the headline and the first thing the business says about
    itself. Every structure since is built with the lesson. */''}
<section class="quarry-band"><div class="quarry-shell">
  <div class="quarry-band__lede">
    <h2>${esc(copy.aboutHeading || '')}</h2>
  </div>
  <div class="quarry-prose">
      ${about}
  </div>
</div></section>

${kerb({ business: ctx.business })}

${divider({ line: copy.firstBreak })}

<section class="quarry-band" id="${TRADES_ID}"><div class="quarry-shell">
  <div class="quarry-band__lede">
    <h2>What we do</h2>
    ${/* FOR A CUSTOMER — see the note in Ledger's pages.js, including why
        this is a JS comment and not an HTML one: an HTML comment inside a
        template ships into the published page, which happened once, on a
        live domain, complete with a quoted old draft. */''}
    ${ledeHtml}
  </div>
  <div class="quarry-index">
    <nav class="quarry-index__col" aria-label="What we do">
      <ol class="quarry-index__list">${names}</ol>
    </nav>
    <div class="quarry-index__told">${blurbs}</div>
  </div>
</div></section>

${divider({ line: copy.secondBreak })}

<section class="quarry-band" id="${WHERE_ID}"><div class="quarry-shell">
  ${mapFrame({ business: ctx.business })}
  ${hours({ hours: ctx.hours })}
</div></section>
`;

  return wrap({
    site: ctx.site,
    slug: 'index',
    title: copy.title || '',
    description: copy.meta || '',
    body: shell(ctx, 'index', body),
    verification: ctx.verification,
    depth: 0,
    jsonld: localBusiness({
      business: ctx.business, site: ctx.site, areas: ctx.areas, hours: ctx.hours,
      cover: ctx.cover,
    }),
  });
}

/**
 * The service page's prose, with the first mention of the business linked
 * home.
 *
 * A WRAPPER PER STRUCTURE AND ONE RULE BEHIND THEM. The pages.js files each
 * render prose differently and each call this with their own slug and depth;
 * what "the first mention" means, and what must not be matched inside, lives
 * in linkHome.js alone.
 */
function homeward(html, ctx, depth) {
  return linkHome(html, (ctx.business || {}).name, linkTo('index', depth));
}

/**
 * One service page.
 *
 * THE RATIFIED SHAPE, 27 October, unchanged: the call button above the fold,
 * the problem in their words, what the job involves, what affects the cost,
 * hours and the number again, then the ring sentence.
 *
 * THE HOURS ARE RENDERED, NOT WRITTEN. The prompt's fifth block used to be
 * "Hours, and the area we cover", and it produced the same address, the same
 * four towns and the same opening hours on all six pages — one duplicated
 * paragraph across a six-page site. The same facts in a band read as
 * reference; in prose, six times, they read as copied.
 *
 * THE HOURS SIT BESIDE THE PROSE, in the second column of the same grid, and
 * fall beneath it when there is no room. That is Quarry's answer to a
 * question the other three have each answered differently.
 */
function servicePage(ctx, service) {
  const depth = depthOf(service.slug);

  const body = `
${masthead({ h1: service.h1 || service.name, sub: service.blurb || '', business: ctx.business, depth })}
${seam({ order: ctx.order, slug: service.slug, alt: ctx.alt, depth })}
<section class="quarry-band"><div class="quarry-shell">
  <div class="quarry-beside">
    ${/* THE FIRST MENTION OF THE BUSINESS LINKS HOME — 2 November.
        Nothing is written for it: the copy already names the business
        somewhere, in its own words, in a different place on each page, and
        this marks one of them up. Asking the model for a link instead would
        be the dictated sentence again, six times over. See linkHome.js. */''}
    <div class="quarry-prose">${homeward(prose(service.sections), ctx, depth)}</div>
    <aside class="quarry-aside">${hours({ hours: ctx.hours })}</aside>
  </div>
  ${onward({ order: ctx.order, slug: service.slug, business: ctx.business, services: ctx.services, depth })}
</div></section>
`;

  const where = [ctx.business.city, ctx.business.state].filter(Boolean).join(', ');

  return wrap({
    site: ctx.site,
    slug: service.slug,
    title: service.title || `${service.name}${where ? ` in ${where}` : ''} | ${ctx.business.name || ''}`,
    description: service.meta || '',
    body: shell(ctx, service.slug, body),
    verification: ctx.verification,
    depth,
    jsonld: serviceNode({ service, business: ctx.business, site: ctx.site }),
  });
}

/**
 * The contact page.
 *
 * THE FORM IS MARKUP ONLY, DELIBERATELY. A static site has no server to
 * receive a submission, and Edwin decided on 26 October not to build one:
 * "don't worry about processing the contact form. Just add it even if it
 * doesnt work. They can add a third party service."
 *
 * SO THE PHONE NUMBER IS BESIDE IT, TWICE. A visitor who fills the form in
 * and presses Send on an unwired action has reached a dead end; one who sees
 * the number has not. The action is a placeholder the owner replaces, and it
 * is named loudly enough that nobody mistakes it for working.
 *
 * THE FIELD IDS ARE QUARRY'S OWN. Ledger uses n/p/e/m, Beacon bn/bp/be/bm
 * and Anvil an/ap/ae/am; a fourth structure reusing any of them would be two
 * layouts whose markup cannot be told apart by anything that looks at ids.
 *
 * FORM LEFT, FACTS STACKED RIGHT — the mirror of Beacon, and neither of the
 * other two.
 */
function contactPage(ctx, copy = {}) {
  const b = ctx.business;
  const tel = esc(b.tel || '');
  const phone = esc(b.phone || '');
  const email = b.email || (b.domain ? `hello@${b.domain}` : '');
  const depth = depthOf('contact');

  const ready = (copy.ready || [
    'Which fixture, and which room',
    'How long it has been doing it',
    'Whether anything is actively leaking right now',
    'Roughly how old the house is',
  ]).map(item => `<li>${esc(item)}</li>`).join('');

  const body = `
${masthead({ h1: copy.h1 || `Contact ${b.name || ''}`.trim(), sub: copy.sub || '', business: b, depth })}
${seam({ order: ctx.order, slug: 'contact', alt: ctx.alt, depth })}
<section class="quarry-band"><div class="quarry-shell">
  <div class="quarry-beside">
    <form class="quarry-form" action="REPLACE_WITH_YOUR_FORM_ENDPOINT" method="post">
      <div class="quarry-form__pair">
        <div><label for="qn">Your name</label><input id="qn" name="name" type="text" autocomplete="name"></div>
        <div><label for="qp">Phone</label><input id="qp" name="phone" type="tel" autocomplete="tel"></div>
      </div>
      <label for="qe">Email</label><input id="qe" name="email" type="email" autocomplete="email">
      <label for="qm">What is happening?</label><textarea id="qm" name="message"></textarea>
      <button type="submit">Send</button>
      <p class="quarry-form__note">Prefer to talk? Call
        <a href="tel:${tel}">${phone}</a>${email ? ` or email
        <a href="mailto:${esc(email)}">${esc(email)}</a>` : ''}.</p>
    </form>

    <aside class="quarry-aside">
      <div class="quarry-prose">
        <h2>Where we are</h2>
        <p>${esc(b.street || '')}<br>${esc([b.city, b.state].filter(Boolean).join(', '))} ${esc(b.zip || '')}</p>
      </div>
      <div class="quarry-prose">
        <h2>What to have ready</h2>
        <ul>${ready}</ul>
      </div>
      <div class="quarry-prose">
        <h2>The quickest way</h2>
        <p>The phone — <a href="tel:${tel}">${phone}</a>. If it is easier to
          write, the form sends to the same place.</p>
      </div>
    </aside>
  </div>

  ${hours({ hours: ctx.hours })}
  ${onward({ order: ctx.order, slug: 'contact', business: b, services: ctx.services, depth })}
</div></section>
<section class="quarry-band" id="${WHERE_ID}"><div class="quarry-shell">${mapFrame({ business: b })}</div></section>
`;

  const where = [b.city, b.state].filter(Boolean).join(', ');

  return wrap({
    site: ctx.site,
    slug: 'contact',
    title: copy.title || `Contact ${b.name || ''}${where ? ` | ${where}` : ''}`,
    description: copy.meta
      || `Contact ${b.name || ''}${where ? ` in ${where}` : ''}.${phone ? ` Call ${b.phone},` : ''} or send a message and we will come back to you.`,
    body: shell(ctx, 'contact', body),
    verification: ctx.verification,
    depth,
  });
}

/**
 * One legal page.
 *
 * NO SEAM, AND NO SCHEMA. It is outside the ring, it carries no photograph,
 * and a privacy policy marked up as a Service would be a lie told in JSON.
 */
function legalPage(ctx, slug) {
  const sections = legalSections(ctx.business)[slug] || [];
  const title = PAGE_TITLES[slug] || slug;
  const where = [ctx.business.city, ctx.business.state].filter(Boolean).join(', ');

  const body = `
<section class="quarry-band"><div class="quarry-shell">
  <div class="quarry-band__lede"><h1>${esc(title)}</h1></div>
  <div class="quarry-prose">${prose(sections)}</div>
</div></section>`;

  return wrap({
    site: ctx.site,
    slug,
    title: `${title} | ${ctx.business.name || ''}`,
    description: `${title} for ${ctx.business.name || ''}${where ? ` in ${where}` : ''}.`,
    body: shell(ctx, slug, body),
    verification: ctx.verification,
    depth: depthOf(slug),
  });
}

/**
 * The 404.
 *
 * CANONICAL POINTS AT THE HOME PAGE, not at the missing URL. A 404 that
 * declares itself canonical is a 404 asking to be indexed.
 */
function notFoundPage(ctx) {
  const body = `
<section class="quarry-band"><div class="quarry-shell">
  <div class="quarry-band__lede">
    <h1>That page is not here</h1>
    <p>Try the <a href="${linkTo('index', null)}">home page</a>${ctx.business.phone ? ', or call us' : ''}.</p>
  </div>
</div></section>`;

  return wrap({
    site: ctx.site,
    slug: 'index',
    title: `Page not found | ${ctx.business.name || ''}`,
    description: 'That page is not here.',
    /* ABSOLUTE LINKS, ALONE AMONG THE ELEVEN. The server returns this page
     * for whatever URL was missing, so the browser's idea of "where this
     * page is" is the URL that did not exist — `../` would climb from
     * somewhere nobody chose. linkTo()/assetTo() take null to mean that. */
    body: shell(ctx, '404', body, null),
    verification: ctx.verification,
    depth: null,
    head: '\n<meta name="robots" content="noindex">',
  });
}

module.exports = {
  prose,
  defaultServicesLede,
  contextFor,
  telFor,
  homePage,
  servicePage,
  contactPage,
  legalPage,
  notFoundPage,
  LEGAL_SLUGS,
  urlFor,
};
