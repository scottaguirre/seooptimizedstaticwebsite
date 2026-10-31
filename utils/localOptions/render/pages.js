// utils/localOptions/render/pages.js
//
// The eleven pages, as HTML.
//
// ONE PROSE RENDERER FOR ALL OF THEM. A service page, a legal page and the
// contact page all render the same `{ heading, paragraphs }` sections with
// the same function. Three copies of "wrap paragraphs in <p>, first one gets
// the lead class" is three places for the first paragraph to stop being the
// lead.
//
// THE PROSE COMES FROM OUTSIDE. Service copy is written by the model
// (package 4) and handed in; legal copy is templated in legalText.js. This
// file decides STRUCTURE — what is an h2, what order things appear in, where
// the ring sentence goes — and nothing about words.

'use strict';

const {
  esc,
  ring,
  urlFor,
  linkTo,
  depthOf,
  homeRows,
  inWords,
  SERVICE_COUNT,
  HOME_BODY_LINKS,
  LEGAL_SLUGS,
  PAGE_TITLES,
} = require('./shape');

const {
  header,
  footer,
  hero,
  onward,
  nap,
  hoursTable,
  mapFrame,
  document: wrap,
} = require('./chrome');

/* telFor() AND contextFor() MOVED TO common.js on 30 October — see the note
 * in chrome.js. Both are about the business rather than about Ledger, and
 * Beacon's pages need the same two. Re-exported below unchanged. */
const { telFor, contextFor, homeHeading } = require('./common');

const { richText } = require('./richText');
const { localBusiness, serviceNode } = require('./schema');
const { legalSections } = require('./legalText');

/**
 * `{ heading, paragraphs }[]` -> HTML.
 *
 * THE FIRST PARAGRAPH OF THE FIRST SECTION IS THE LEAD, and only that one.
 * An empty heading opens the page without one, which is how every body here
 * starts: the H1 is in the hero, and an h2 immediately under it saying the
 * same thing twice is the commonest shape of generated page there is.
 */
function prose(sections = []) {
  const out = [];

  sections.forEach((section, i) => {
    if (section.heading) out.push(`<h2>${esc(section.heading)}</h2>`);

    (section.paragraphs || []).forEach((text, j) => {
      const lead = 0 === i && 0 === j ? ' class="ledger-lead"' : '';

      /* richText, NOT esc — and richText escapes first. An owner editing a
       * live site can put a link in a sentence; see that file for why the
       * order is escape-then-convert rather than allow-some-HTML. */
      out.push(`<p${lead}>${richText(text)}</p>`);
    });
  });

  return out.join('\n');
}

/** header + main + footer, the same on all eleven. */
/**
 * header + main + footer, the same on all eleven.
 *
 * `depth` DEFAULTS TO THE SLUG'S OWN and is passed explicitly only by
 * 404.html, which needs absolute links — see linkTo() in shape.js.
 *
 * THE SERVICES GO TO BOTH ENDS. The footer has always had them; the header
 * only got them on 28 October, when the menu turned out to reach three of
 * the six. One argument object, both calls — a header given a different list
 * from the footer is a site whose menu and footer disagree about what it
 * sells.
 */
function shell(ctx, slug, body, depth = depthOf(slug)) {
  return `${header({ business: ctx.business, logo: ctx.logo, current: slug, services: ctx.services, depth })}
<main id="main">
${body}
</main>
${footer({ business: ctx.business, services: ctx.services, areas: ctx.areas, now: ctx.now, depth })}`;
}

/**
 * The home page.
 *
 * ALL SIX SERVICES ARE SHOWN. THE FIRST THREE ARE LINKS. The other three are
 * the same row without an anchor and visibly muted — a row that looks
 * clickable and is not is worse than a row that plainly is not.
 *
 * The decision is not made here: homeRows() returns the flag, and the suite
 * counts it. That is deliberate. It was broken twice inside a rendering
 * function, where it was invisible.
 */
/**
 * The line above the services, when the owner has not written their own.
 *
 * EDITABLE SINCE 30 OCTOBER, and a default rather than fixed text. Edwin,
 * on the sentence that used to be here: "this should be for a customer",
 * then "yes" to making it a field on the Edit screen.
 *
 * THE COUNT COMES FROM THE CONSTANT. This very sentence said three while
 * the cap said two for part of the same day, because it was typed out six
 * lines from the number that decides it.
 */
function defaultServicesLede() {
  return `The ${inWords(SERVICE_COUNT)} jobs we are called out for most. `
    + 'Each has a page of its own, with what the work involves and what '
    + 'changes the price.';
}

function homePage(ctx, copy = {}) {
  const rows = homeRows(ctx.services, 0).map(({ service, index, linked, href }) => {
    const inner = `<span class="ledger-list__n">${String(index + 1).padStart(2, '0')}</span><span>`
      + `<span class="ledger-list__name">${esc(service.name)}</span>`
      + `<span class="ledger-list__sub">${esc(service.blurb || '')}</span></span>`;

    return linked
      ? `<li><a href="${href}">${inner}</a></li>`
      : `<li><span class="ledger-list__row">${inner}</span></li>`;
  }).join('');

  const about = (copy.about || []).map(p => `<p>${richText(p)}</p>`).join('\n      ');

  /* ABSENT IS NOT EMPTY, ONE MORE TIME.
   *
   *   never set        a site built before the field existed   -> the default
   *   set to ''        the owner cleared the box on purpose    -> no line
   *
   * Falling back to the default on an empty string would make the Edit
   * screen's box a control that saves and changes nothing — the same lie
   * the old Headline box told before it was removed. */
  const lede = undefined === copy.servicesLede
    ? defaultServicesLede()
    : String(copy.servicesLede || '').trim();

  const ledeHtml = lede ? `<p>${richText(lede)}</p>` : '';

  const body = `
${hero({ order: ctx.order, slug: 'index', h1: homeHeading(ctx.business), sub: copy.sub || '', alt: ctx.alt, business: ctx.business, depth: 0 })}
${nap({ business: ctx.business })}

<section class="ledger-block"><div class="ledger-shell">
  <div class="ledger-about">
    <h2>${esc(copy.aboutHeading || '')}</h2>
    <div class="ledger-about__text">
      ${about}
    </div>
  </div>
</div></section>

<section class="ledger-block" id="services" style="padding-top:0"><div class="ledger-shell">
  <div class="ledger-block__lede">
    <h2>Services we offer</h2>
    ${ledeHtml}
    ${/* WRITTEN FOR A CUSTOMER, NOT FOR WHOEVER BUILT THE SITE — 30
        October. It read "All six have a page of their own. The first two
        are linked here; the rest follow on from them, and every one is in
        the menu above": a description of the site's internal linking, on
        the front page of a plumbing company. Edwin: "this should be for a
        customer." A homeowner does not care which rows are anchors.

        AND IT IS A JS COMMENT, NOT AN HTML ONE. The first version of this
        note was written as <!-- --> inside the template, which shipped
        every word of it — the quoted old copy included — into the source
        of every published page, on a client's own domain. The suite
        caught it by finding "linked here" still in the output.

            A COMMENT ABOUT THE PAGE IS NOT PART OF THE PAGE.

        THE COUNT COMES FROM THE CONSTANT, because this very sentence said
        three while the cap said two for part of the same day. */''}

  </div>
  <ul class="ledger-list">${rows}</ul>
</div></section>

<section class="ledger-block" id="visit" style="padding-top:0"><div class="ledger-shell">
  <div class="ledger-visit">${mapFrame({ business: ctx.business })}${hoursTable({ hours: ctx.hours })}</div>
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
 * THE RATIFIED SHAPE, 27 October: hero with the call button above the fold,
 * the problem in their words, what the job involves, what affects the cost,
 * hours and the number again, then the ring sentence. Sections 3 and 4 are
 * where the page earns the density floor qualityCheck.js enforces — and they
 * are the model's job, not this file's. All this does is lay them out.
 */
function servicePage(ctx, service) {
  /* THE HOURS ARE RENDERED HERE, NOT WRITTEN.
   *
   * The prompt's fifth block used to be "Hours, and the area we cover", and
   * in the 28 October run it produced the same address, the same four towns
   * and the same opening hours on all six pages — one duplicated paragraph
   * across a six-page site, which is the footprint problem this app fights
   * everywhere else.
   *
   * Cutting it outright would have taken the hours off the service pages
   * altogether: the footer carries the address, the towns and the number on
   * every page, but NOT the hours, and a service page has no NAP strip.
   *
   *     THE SAME FACTS IN A TABLE READ AS REFERENCE.
   *     IN PROSE, SIX TIMES, THEY READ AS COPIED.
   *
   * So the hours come from the same component the home page uses, and the
   * prose slot got a job that differs on every page — what to have ready
   * before you call about THIS service. */
  const body = `
${hero({ order: ctx.order, slug: service.slug, h1: service.h1 || service.name, sub: service.blurb || '', alt: ctx.alt, business: ctx.business, depth: depthOf(service.slug) })}
<section class="ledger-block"><div class="ledger-shell">
  <div class="ledger-prose">${prose(service.sections)}</div>
  ${ctx.hours.length ? `<div class="ledger-visit" style="margin-top:2.4rem">${hoursTable({ hours: ctx.hours })}</div>` : ''}
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
 * SO THE PHONE NUMBER IS BESIDE IT, TWICE — in the hero and under the form.
 * A visitor who fills the form in and presses Send on an unwired action has
 * reached a dead end; a visitor who sees the number has not. The action is a
 * placeholder the owner replaces, and it is named loudly enough that nobody
 * mistakes it for working.
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
${hero({ order: ctx.order, slug: 'contact', h1: copy.h1 || `Contact ${b.name || ''}`.trim(), sub: copy.sub || '', alt: ctx.alt, business: b, depth: depthOf('contact') })}
<section class="ledger-block"><div class="ledger-shell">
  <div class="ledger-contact">
    <div class="ledger-prose">
      <p class="ledger-lead">The quickest way to reach us is the phone —
        <a href="tel:${tel}">${phone}</a>. If it is easier to write, the form
        sends to the same place.</p>
      <h2>Where we are</h2>
      <p>${esc(b.street || '')}<br>${esc([b.city, b.state].filter(Boolean).join(', '))} ${esc(b.zip || '')}</p>
      <h2>What to have ready</h2>
      <ul>${ready}</ul>
      ${hoursTable({ hours: ctx.hours })}
    </div>
    <div>
      <form class="ledger-form" action="REPLACE_WITH_YOUR_FORM_ENDPOINT" method="post">
        <label for="n">Your name</label><input id="n" name="name" type="text" autocomplete="name">
        <label for="p">Phone</label><input id="p" name="phone" type="tel" autocomplete="tel">
        <label for="e">Email</label><input id="e" name="email" type="email" autocomplete="email">
        <label for="m">What is happening?</label><textarea id="m" name="message"></textarea>
        <button type="submit">Send</button>
        <p class="ledger-form__note">Prefer to talk? Call
          <a href="tel:${tel}">${phone}</a>${email ? ` or email
          <a href="mailto:${esc(email)}">${esc(email)}</a>` : ''}.</p>
      </form>
    </div>
  </div>
  ${onward({ order: ctx.order, slug: 'contact', business: b, services: ctx.services, depth: depthOf('contact') })}
</div></section>
<section class="ledger-block" style="padding-top:0"><div class="ledger-shell">${mapFrame({ business: b })}</div></section>
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
 * NO HERO, AND NO SCHEMA. It is outside the ring, it carries no photograph,
 * and a privacy policy marked up as a Service would be a lie told in JSON.
 * The H1 is in the page rather than in a hero card, which is the only place
 * in the site where that is true.
 */
function legalPage(ctx, slug) {
  const sections = legalSections(ctx.business)[slug] || [];
  const title = PAGE_TITLES[slug] || slug;
  const where = [ctx.business.city, ctx.business.state].filter(Boolean).join(', ');

  const body = `
<section class="ledger-block"><div class="ledger-shell">
  <div class="ledger-block__lede"><h1>${esc(title)}</h1></div>
  <div class="ledger-prose">${prose(sections)}</div>
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
<section class="ledger-block"><div class="ledger-shell">
  <div class="ledger-block__lede">
    <h1>That page is not here</h1>
    <p>Try the <a href="${linkTo('index', null)}">home page</a>${ctx.business.phone ? ', or call us' : ''}.</p>
  </div>
</div></section>`;

  return wrap({
    site: ctx.site,
    slug: 'index',
    title: `Page not found | ${ctx.business.name || ''}`,
    description: 'That page is not here.',
    /* ABSOLUTE LINKS, ALONE AMONG THE ELEVEN. The server returns this
     * page for whatever URL was missing, so the browser's idea of "where
     * this page is" is the URL that did not exist — `../` would climb from
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
