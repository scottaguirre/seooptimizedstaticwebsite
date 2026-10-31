// utils/localOptions/render/beacon/pages.js
//
// Beacon's eleven pages.
//
// THE SAME ELEVEN, AND THE SAME SECTIONS INSIDE THEM — Edwin, 30 October:
// "Keep the same sections." So this takes exactly what Ledger's pages.js
// takes, in exactly the same shape, and decides different markup for it.
// Nothing here knows how the words were written and nothing here writes any.
//
// WHAT IS GENUINELY DIFFERENT FROM LEDGER
//
//   home      the services are TILES, not a numbered two-column list, and
//             the preamble sits under the banner instead of a NAP `<dl>`
//   service   the hours slate sits beside the prose rather than under it
//   contact   the form and the facts are two columns in the other order
//   legal     the H1 is in a plain block, as Ledger's is — there is no
//             sensible second way to set a privacy policy
//   404       same
//
// WHAT IS DELIBERATELY IDENTICAL
//
// The ring, the three-link body cap, the hero rotation, the schema, the
// canonical, the Search Console tags and the legal copy. Every one of those
// is a rule about the SITE rather than about how it looks, and a second
// structure that re-decided them would be a second product.

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
  header,
  footer,
  banner,
  onward,
  preamble,
  divider,
  hoursSlate,
  mapFrame,
  document: wrap,
} = require('./chrome');

const { contextFor, telFor, homeHeading } = require('../common');
const { richText } = require('../richText');
const { localBusiness, serviceNode } = require('../schema');
const { legalSections } = require('../legalText');

/**
 * `{ heading, paragraphs }[]` -> HTML.
 *
 * THE FIRST PARAGRAPH OF THE FIRST SECTION IS THE LEAD, and only that one.
 * An empty heading opens the page without one, which is how every body here
 * starts: the H1 is in the banner, and an h2 immediately under it saying the
 * same thing twice is the commonest shape of generated page there is.
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
      const lead = 0 === i && 0 === j ? ' class="beacon-lede"' : '';

      out.push(`<p${lead}>${richText(text)}</p>`);
    });
  });

  return out.join('\n');
}

/**
 * header + main + footer, the same on all eleven.
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
  return `${header({
    business: ctx.business,
    logo: ctx.logo,
    current: slug,
    services: ctx.services,
    areas: ctx.areas,
    depth,
  })}
<main id="${MAIN_ID}">
${body}
</main>
${footer({ business: ctx.business, services: ctx.services, areas: ctx.areas, now: ctx.now, depth })}`;
}

/**
 * The home page.
 *
 * ALL SIX SERVICES ARE SHOWN. THE FIRST THREE ARE LINKS. The other three are
 * the same tile without an anchor and visibly muted — a tile that looks
 * clickable and is not is worse than one that plainly is not.
 *
 * THE DECISION IS NOT MADE HERE. homeRows() returns the flag and the suite
 * counts it, which is deliberate: it was broken twice inside a rendering
 * function, where it was invisible.
 */
/** See Ledger's pages.js: a default, not fixed text, and editable. */
function defaultServicesLede() {
  return 'What we are called out for most. Each of the '
    + `${inWords(SERVICE_COUNT)} has its own page — what the work involves, `
    + 'and what changes the price.';
}

function homePage(ctx, copy = {}) {
  const tiles = homeRows(ctx.services, 0).map(({ service, index, linked, href }) => {
    const inner = `<span class="beacon-trade__tally">${String(index + 1).padStart(2, '0')}</span>`
      + `<span class="beacon-trade__name">${esc(service.name)}</span>`
      + `<span class="beacon-trade__said">${esc(service.blurb || '')}</span>`;

    return linked
      ? `<li class="beacon-trade"><a href="${href}">${inner}</a></li>`
      : `<li class="beacon-trade beacon-trade--flat"><span>${inner}</span></li>`;
  }).join('');

  const about = (copy.about || []).map(p => `<p>${richText(p)}</p>`).join('\n      ');

  /* ABSENT IS NOT EMPTY — see Ledger's pages.js for the whole of it. */
  const lede = undefined === copy.servicesLede
    ? defaultServicesLede()
    : String(copy.servicesLede || '').trim();

  const ledeHtml = lede ? `<p>${richText(lede)}</p>` : '';

  const body = `
${banner({ order: ctx.order, slug: 'index', h1: homeHeading(ctx.business), sub: copy.sub || '', alt: ctx.alt, business: ctx.business, depth: 0 })}

<section class="beacon-block"><div class="beacon-shell">
  <div class="beacon-block__lede">
    <h2>${esc(copy.aboutHeading || '')}</h2>
  </div>
  <div class="beacon-prose">
      ${about}
  </div>
</div></section>

${/* THE FACTS COME AFTER THE INTRODUCTION, NOT BEFORE IT — Edwin, 30
    October: "move this section to After the first section."
    Under the banner it put three lines of address between the headline and
    the first thing the business says about itself. */''}
${preamble({ business: ctx.business })}

${divider({ line: copy.firstBreak })}

<section class="beacon-block" id="${TRADES_ID}"><div class="beacon-shell">
  <div class="beacon-block__lede">
    <h2>What we do</h2>
    ${/* FOR A CUSTOMER — see the note in Ledger's pages.js, including why
        this is a JS comment and not an HTML one. */''}
    ${ledeHtml}

  </div>
  <ul class="beacon-tiles">${tiles}</ul>
</div></section>

${divider({ line: copy.secondBreak })}

<section class="beacon-block" id="${WHERE_ID}"><div class="beacon-shell">
  <div class="beacon-whereabouts">
    ${mapFrame({ business: ctx.business })}
    ${hoursSlate({ hours: ctx.hours })}
  </div>
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
 * One service page.
 *
 * THE RATIFIED SHAPE, 27 October, unchanged: the call button above the fold,
 * the problem in their words, what the job involves, what affects the cost,
 * hours and the number again, then the ring sentence.
 *
 * THE HOURS ARE RENDERED, NOT WRITTEN. The prompt's fifth block used to be
 * "Hours, and the area we cover", and it produced the same address, the same
 * four towns and the same opening hours on all six pages — one duplicated
 * paragraph across a six-page site. The same facts in a slate read as
 * reference; in prose, six times, they read as copied.
 *
 * BESIDE THE PROSE RATHER THAN BENEATH IT, which is Beacon's difference. The
 * slate is reference material, and a visitor scanning for "are they open
 * Saturday" should not have to reach the end of the page to find out.
 */
function servicePage(ctx, service) {
  const slate = hoursSlate({ hours: ctx.hours });

  const body = `
${banner({ order: ctx.order, slug: service.slug, h1: service.h1 || service.name, sub: service.blurb || '', alt: ctx.alt, business: ctx.business, depth: depthOf(service.slug) })}
<section class="beacon-block"><div class="beacon-shell">
  <div class="beacon-spread${slate ? '' : ' beacon-spread--solo'}">
    <div class="beacon-prose">${prose(service.sections)}</div>
    ${slate ? `<aside class="beacon-aside">${slate}</aside>` : ''}
  </div>
  ${onward({ order: ctx.order, slug: service.slug, business: ctx.business, services: ctx.services, depth: depthOf(service.slug) })}
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
    depth: depthOf(service.slug),
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
 * THE FIELD IDS ARE BEACON'S OWN. Ledger uses n/p/e/m; a second structure
 * reusing them would be two layouts whose markup cannot be told apart by
 * anything that looks at ids.
 */
function contactPage(ctx, copy = {}) {
  const b = ctx.business;
  const tel = esc(b.tel || '');
  const phone = esc(b.phone || '');
  const email = b.email || (b.domain ? `hello@${b.domain}` : '');

  const ready = (copy.ready || [
    'Which fixture, and which room',
    'How long it has been doing it',
    'Whether anything is actively leaking right now',
    'Roughly how old the house is',
  ]).map(item => `<li>${esc(item)}</li>`).join('');

  const body = `
${banner({ order: ctx.order, slug: 'contact', h1: copy.h1 || `Contact ${b.name || ''}`.trim(), sub: copy.sub || '', alt: ctx.alt, business: b, depth: depthOf('contact') })}
<section class="beacon-block"><div class="beacon-shell">
  <div class="beacon-spread">
    <div>
      <form class="beacon-form" action="REPLACE_WITH_YOUR_FORM_ENDPOINT" method="post">
        <label for="bn">Your name</label><input id="bn" name="name" type="text" autocomplete="name">
        <label for="bp">Phone</label><input id="bp" name="phone" type="tel" autocomplete="tel">
        <label for="be">Email</label><input id="be" name="email" type="email" autocomplete="email">
        <label for="bm">What is happening?</label><textarea id="bm" name="message"></textarea>
        <button type="submit">Send</button>
        <p class="beacon-form__note">Prefer to talk? Call
          <a href="tel:${tel}">${phone}</a>${email ? ` or email
          <a href="mailto:${esc(email)}">${esc(email)}</a>` : ''}.</p>
      </form>
    </div>
    <div class="beacon-prose">
      <p class="beacon-lede">The quickest way to reach us is the phone —
        <a href="tel:${tel}">${phone}</a>. If it is easier to write, the form
        sends to the same place.</p>
      <h2>Where we are</h2>
      <p>${esc(b.street || '')}<br>${esc([b.city, b.state].filter(Boolean).join(', '))} ${esc(b.zip || '')}</p>
      <h2>What to have ready</h2>
      <ul>${ready}</ul>
      ${hoursSlate({ hours: ctx.hours })}
    </div>
  </div>
  ${onward({ order: ctx.order, slug: 'contact', business: b, services: ctx.services, depth: depthOf('contact') })}
</div></section>
<section class="beacon-block" id="${WHERE_ID}"><div class="beacon-shell">${mapFrame({ business: b })}</div></section>
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
    depth: depthOf('contact'),
  });
}

/**
 * One legal page.
 *
 * NO BANNER PICTURE, AND NO SCHEMA. It is outside the ring, it carries no
 * photograph, and a privacy policy marked up as a Service would be a lie told
 * in JSON.
 */
function legalPage(ctx, slug) {
  const sections = legalSections(ctx.business)[slug] || [];
  const title = PAGE_TITLES[slug] || slug;
  const where = [ctx.business.city, ctx.business.state].filter(Boolean).join(', ');

  const body = `
<section class="beacon-block"><div class="beacon-shell">
  <div class="beacon-block__lede"><h1>${esc(title)}</h1></div>
  <div class="beacon-prose">${prose(sections)}</div>
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
<section class="beacon-block"><div class="beacon-shell">
  <div class="beacon-block__lede">
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
