// utils/localOptions/render/harbor/pages.js
//
// Harbor's eleven pages.
//
// THE SAME ELEVEN, AND THE SAME SECTIONS INSIDE THEM — the rule that has
// held since Beacon, and the one thing a new structure may not re-decide.
// So this takes exactly what the other four take, in exactly the same
// shape, and decides different markup for it. Nothing here knows how the
// words were written and nothing here writes any.
//
// WHAT IS GENUINELY DIFFERENT
//
//   every page  the rail. The name, the phone, the hours, the address and
//               all six services are beside the content at every scroll
//               position — so none of them appears in the content column
//               at all, on any of the eleven.
//   home        no facts block. Ledger has a <dl>, Beacon a card of three
//               columns, Anvil an inline rule, Quarry a stacked kerb. The
//               rail is Harbor's, and putting one on the page as well
//               would be the same three facts twice on one screen.
//   service     the hours are not here either, for the same reason. The
//               other four each answer "where do the hours go" and this
//               one answers "not on the page".
//   contact     the form is the page. No facts beside it, no hours under
//               it — both are two inches to the left.
//   legal       a plain block, as in all four others. There is no sensible
//               fifth way to set a privacy policy.
//   404         same.
//
// WHAT IS DELIBERATELY IDENTICAL
//
// The ring, the body-link cap, the hero rotation, the schema, the
// canonical, the Search Console tags and the legal copy. Every one is a
// rule about the SITE rather than about how it looks.
//
//   node test-local-options-harbor.js

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
  rail,
  masthead,
  plate,
  offer,
  onward,
  divider,
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
      const lead = 0 === i && 0 === j ? ' class="harbor-lede"' : '';

      out.push(`<p${lead}>${richText(text)}</p>`);
    });
  });

  return out.join('\n');
}

/**
 * rail + main + foot, the same on all eleven.
 *
 * THE RAIL TAKES THE HOURS, which no other structure's chrome does. They
 * are furniture here rather than a section, so they are passed in beside
 * the services and the logo and never reach the content column.
 *
 * `depth` DEFAULTS TO THE SLUG'S OWN and is passed explicitly only by
 * 404.html, which needs absolute links — see linkTo() in shape.js.
 *
 * THE SERVICES GO TO THE RAIL FROM ONE ARGUMENT OBJECT. A rail given a
 * different list from the body is a site whose menu and pages disagree
 * about what it sells; Ledger's menu reached three of the six for a day
 * because its header and footer were built separately.
 */
function shell(ctx, slug, body, depth = depthOf(slug)) {
  return `${rail({
    business: ctx.business,
    logo: ctx.logo,
    current: slug,
    services: ctx.services,
    hours: ctx.hours,
    depth,
  })}
<main id="${MAIN_ID}" class="harbor-main">
<div class="harbor-column">
${body}
${foot({ business: ctx.business, areas: ctx.areas, now: ctx.now, depth })}
</div>
</main>`;
}

/**
 * A default, not fixed text, and editable — see Ledger's pages.js.
 *
 * WRITTEN TO THE READER, NOT ABOUT THE SITE. The first draft of Anvil's
 * said "All six have a page of their own", which is the exact sentence
 * Edwin struck out on 30 October: "this should be for a customer." It is a
 * note about what was BUILT, not a reason to read on.
 *
 * AND IT POINTS AT THE RAIL, because that is what is different about
 * reading this site. Ledger counts the jobs, Beacon names what it is called
 * out for, Anvil tells the reader what to do, Quarry starts from what is
 * wrong. This one tells them the list is beside them and stays there.
 *
 * `SERVICE_COUNT` THROUGH inWords(), NEVER THE WORD "six" TYPED OUT. The
 * services lede said "three" for a day after the body-link cap became two,
 * because the number was prose rather than the constant.
 */
function defaultServicesLede() {
  return `These ${inWords(SERVICE_COUNT)} are what we are called out for. `
    + 'Each one opens onto what the work involves, how long it usually '
    + 'takes, and what moves the price.';
}

/**
 * The home page.
 *
 * NO FACTS BLOCK, WHICH IS THE DIFFERENCE. The name, the address, the
 * phone and the hours are in the rail on this page and on the other ten.
 * Ledger, Beacon, Anvil and Quarry each put them somewhere on the home
 * page because they had nowhere else; putting them here as well would be
 * the same three facts twice on one screen.
 */
function homePage(ctx, copy = {}) {
  const rows = homeRows(ctx.services, 0);

  const about = (copy.about || []).map(p => `<p>${richText(p)}</p>`).join('\n    ');

  /* ABSENT IS NOT EMPTY — see Ledger's pages.js for the whole of it.
   * `undefined` means nobody has edited this field and the default stands;
   * an empty string means the owner cleared it on purpose. */
  const lede = undefined === copy.servicesLede
    ? defaultServicesLede()
    : String(copy.servicesLede || '').trim();

  const ledeHtml = lede ? `<p class="harbor-said">${richText(lede)}</p>` : '';

  const body = `
${masthead({ h1: homeHeading(ctx.business), sub: copy.sub || '' })}

${plate({ order: ctx.order, slug: 'index', alt: ctx.alt, depth: 0 })}

<section class="harbor-block">
  <h2>${esc(copy.aboutHeading || '')}</h2>
  <div class="harbor-prose">
    ${about}
  </div>
</section>

${divider({ line: copy.firstBreak })}

<section class="harbor-block" id="${TRADES_ID}">
  <h2>What we do</h2>
  ${/* FOR A CUSTOMER — see the note in Ledger's pages.js, including why
      this is a JS comment and not an HTML one: an HTML comment inside a
      template ships into the published page, which happened once, on a
      live domain, complete with a quoted old draft. */''}
  ${ledeHtml}
  <dl class="harbor-offer">${offer(rows)}</dl>
</section>

${divider({ line: copy.secondBreak })}

<section class="harbor-block" id="${WHERE_ID}">
  <h2>Where to find us</h2>
  ${mapFrame({ business: ctx.business })}
</section>
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
 * render prose differently and each call this with their own slug and
 * depth; what "the first mention" means, and what must not be matched
 * inside, lives in linkHome.js alone.
 */
function homeward(html, ctx, depth) {
  return linkHome(html, (ctx.business || {}).name, linkTo('index', depth));
}

/**
 * One service page.
 *
 * THE RATIFIED SHAPE, 27 October, unchanged: the call button above the
 * fold, the problem in their words, what the job involves, what affects the
 * cost, hours and the number again, then the ring sentence.
 *
 * AND TWO OF THOSE ARE THE RAIL'S. The call button and the hours are on
 * screen the whole way down rather than at one point in the page — which
 * is a stronger version of what the shape asked for, not a weaker one.
 * They are the two items the shape names twice.
 *
 * THE HOURS ARE NOT WRITTEN, ON ANY STRUCTURE. The prompt's fifth block
 * used to be "Hours, and the area we cover", and it produced the same
 * address, the same four towns and the same opening hours on all six pages
 * — one duplicated paragraph across a six-page site.
 */
function servicePage(ctx, service) {
  const depth = depthOf(service.slug);

  const body = `
${masthead({ h1: service.h1 || service.name, sub: service.blurb || '' })}
${plate({ order: ctx.order, slug: service.slug, alt: ctx.alt, depth })}

<section class="harbor-block">
  ${/* THE FIRST MENTION OF THE BUSINESS LINKS HOME — 2 November.
      Nothing is written for it: the copy already names the business
      somewhere, in its own words, in a different place on each page, and
      this marks one of them up. Asking the model for a link instead would
      be the dictated sentence again, six times over. See linkHome.js. */''}
  <div class="harbor-prose">${homeward(prose(service.sections), ctx, depth)}</div>
  ${onward({ order: ctx.order, slug: service.slug, business: ctx.business, services: ctx.services, depth })}
</section>
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
 * SO THE PHONE NUMBER IS BESIDE IT — and here that costs nothing, because
 * it is in the rail on this page as on every other. A visitor who fills the
 * form in and presses Send on an unwired action has reached a dead end; one
 * who can see the number has not. The form still names it once in its own
 * note, because the rail is to the left of the form rather than inside it.
 *
 * THE FIELD IDS ARE HARBOR'S OWN. Ledger uses n/p/e/m, Beacon bn/bp/be/bm,
 * Anvil an/ap/ae/am, Quarry qn/qp/qe/qm; a fifth structure reusing any of
 * them would be two layouts whose markup cannot be told apart by anything
 * that looks at ids.
 *
 * THE FORM IS THE WHOLE PAGE, which is the fifth answer. Ledger and Anvil
 * put facts beneath it, Beacon beside it on the right, Quarry beside it on
 * the left. Harbor puts nothing beside it at all.
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
${masthead({ h1: copy.h1 || `Contact ${b.name || ''}`.trim(), sub: copy.sub || '' })}
${plate({ order: ctx.order, slug: 'contact', alt: ctx.alt, depth })}

<section class="harbor-block">
  <form class="harbor-form" action="REPLACE_WITH_YOUR_FORM_ENDPOINT" method="post">
    <div class="harbor-form__pair">
      <div><label for="hn">Your name</label><input id="hn" name="name" type="text" autocomplete="name"></div>
      <div><label for="hp">Phone</label><input id="hp" name="phone" type="tel" autocomplete="tel"></div>
    </div>
    <label for="he">Email</label><input id="he" name="email" type="email" autocomplete="email">
    <label for="hm">What is happening?</label><textarea id="hm" name="message"></textarea>
    <button type="submit">Send</button>
    <p class="harbor-form__note">Prefer to talk? Call
      <a href="tel:${tel}">${phone}</a>${email ? ` or email
      <a href="mailto:${esc(email)}">${esc(email)}</a>` : ''}.</p>
  </form>
</section>

<section class="harbor-block">
  <h2>What to have ready</h2>
  <div class="harbor-prose"><ul>${ready}</ul></div>
</section>

<section class="harbor-block" id="${WHERE_ID}">
  <h2>Where to find us</h2>
  ${mapFrame({ business: b })}
  ${onward({ order: ctx.order, slug: 'contact', business: b, services: ctx.services, depth })}
</section>
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
 * NO PHOTOGRAPH AND NO SCHEMA. It is outside the hero rotation, and a
 * privacy policy marked up as a Service would be a lie told in JSON.
 */
function legalPage(ctx, slug) {
  const sections = legalSections(ctx.business)[slug] || [];
  const title = PAGE_TITLES[slug] || slug;
  const where = [ctx.business.city, ctx.business.state].filter(Boolean).join(', ');

  const body = `
<header class="harbor-top"><h1>${esc(title)}</h1></header>

<section class="harbor-block">
  <div class="harbor-prose">${prose(sections)}</div>
</section>`;

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
<header class="harbor-top"><h1>That page is not here</h1></header>

<section class="harbor-block">
  <div class="harbor-prose">
    <p>Try the <a href="${linkTo('index', null)}">home page</a>${
      ctx.business.phone ? ', or call us on the number beside you' : ''}.</p>
  </div>
</section>`;

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
