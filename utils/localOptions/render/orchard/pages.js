// utils/localOptions/render/orchard/pages.js
//
// Orchard's eleven pages.
//
// THE SAME ELEVEN, AND THE SAME SECTIONS INSIDE THEM — the rule that has
// held since Beacon, and the one thing a new structure may not re-decide.
// So this takes exactly what the other six take, in exactly the same shape,
// and decides different markup for it.
//
// THE DIFFERENCE IS THAT THE PAGE LEANS, AND IT HAS TO BE COUNTED.
//
// Every section is a card offset to one side, alternating down the page.
// Which side a card takes depends on how many came before it, so this file
// counts — and that counter is the one thing in the structure that can go
// wrong in a way nothing throws over.
//
//     A MISCOUNT DOES NOT BREAK A PAGE. IT PRODUCES TWO CARDS LEANING
//     THE SAME WAY, WHICH READS AS A MISTAKE AND NOT AS A DESIGN.
//
// THE COUNTER IS PER PAGE AND NEVER SHARED. renderSite() builds eleven
// pages in one pass and test-site-batch.js builds three whole sites in one
// process; a counter outside a function would have page two start wherever
// page one stopped.
//
// WHAT IS GENUINELY DIFFERENT, PAGE BY PAGE
//
//   every page  the zigzag, and a centred masthead — the only one of the
//               seven that does not range its title left
//   home        services as a two-column grid with the number drawn large
//   service     the hours as seven chips that reflow
//   contact     the form in a leaning card like every other section
//   legal       the sections lean too, so a privacy policy still looks
//               like the site it is on
//   404         a title and one card
//
// WHAT IS DELIBERATELY IDENTICAL
//
// The ring, the body-link cap, the hero rotation, the schema, the
// canonical, the Search Console tags and the legal copy. Every one is a
// rule about the SITE rather than about how it looks.
//
//   node test-local-options-orchard.js

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
  plate,
  row,
  grid,
  hours,
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
 * Hands out 'left', 'right', 'left', … one page at a time.
 *
 * A FUNCTION THAT RETURNS A FUNCTION, SO THE COUNT CANNOT ESCAPE THE PAGE.
 * A module-level `let n = 0` would be shared by every page in a render and
 * by every site in a batch: page one ends on an odd count and page two
 * starts leaning the wrong way, for the rest of the site.
 *
 *     THE ONLY SAFE PLACE FOR A COUNTER IS INSIDE THE THING IT COUNTS.
 */
function leaning() {
  let n = 0;

  return () => (n++ % 2 ? 'right' : 'left');
}

/**
 * `{ heading, paragraphs }[]` -> one leaning card per section.
 *
 * ONE CARD PER SECTION, which is what makes a service page zigzag rather
 * than a wall of prose with a heading every so often. The other six return
 * headings and paragraphs into a single column; this returns the page's own
 * blocks, the way Atlas's does — and for the same reason, a stylesheet
 * cannot offset alternate parts of one flow.
 *
 * THE FIRST PARAGRAPH OF THE FIRST SECTION IS THE LEAD, and only that one.
 * An empty heading opens the page without one, which is how every body here
 * starts: the H1 is in the title block, and an h2 immediately under it
 * saying the same thing twice is the commonest shape of generated page
 * there is.
 *
 * richText, NOT esc — and richText escapes first. An owner editing a live
 * site can put a link in a sentence; see that file for why the order is
 * escape-then-convert rather than allow-some-HTML.
 *
 * `side` IS PASSED IN, so the prose shares one rhythm with the blocks
 * around it. A prose block that started its own count would reset the
 * zigzag half way down the page.
 */
function prose(sections = [], side = () => 'left') {
  return sections.map((section, i) => {
    const body = (section.paragraphs || []).map((text, j) => {
      const lead = 0 === i && 0 === j ? ' class="orchard-lede"' : '';

      return `<p${lead}>${richText(text)}</p>`;
    }).join('\n');

    return row({ label: section.heading || '', body, side: side() });
  }).join('\n');
}

/**
 * bar + main + foot, the same on all eleven.
 *
 * `depth` DEFAULTS TO THE SLUG'S OWN and is passed explicitly only by
 * 404.html, which needs absolute links — see linkTo() in shape.js.
 *
 * THE SERVICES GO TO BOTH ENDS, from one argument object. A menu given a
 * different list from the footer is a site whose two lists disagree about
 * what it sells; Ledger's menu reached three of the six for a day because
 * the two were built separately.
 */
function shell(ctx, slug, body, depth = depthOf(slug)) {
  return `${bar({
    business: ctx.business,
    logo: ctx.logo,
    current: slug,
    services: ctx.services,
    depth,
  })}
<main id="${MAIN_ID}" class="orchard-main">
${body}
</main>
${foot({
    business: ctx.business, services: ctx.services, areas: ctx.areas,
    now: ctx.now, depth,
  })}`;
}

/**
 * A default, not fixed text, and editable — see Ledger's pages.js.
 *
 * WRITTEN TO THE READER, NOT ABOUT THE SITE. The first draft of Anvil's
 * said "All six have a page of their own", which is the exact sentence
 * Edwin struck out on 30 October: "this should be for a customer." It is a
 * note about what was BUILT, not a reason to read on.
 *
 * `SERVICE_COUNT` THROUGH inWords(), NEVER THE WORD "six" TYPED OUT. The
 * services lede said "three" for a day after the body-link cap became two,
 * because the number was prose rather than the constant.
 */
function defaultServicesLede() {
  return `The ${inWords(SERVICE_COUNT)} jobs this trade is called out for `
    + 'most, and what each one usually involves.';
}

/**
 * The home page.
 *
 * THE ZIGZAG STARTS AT THE ABOUT BLOCK, not at the title. A centred
 * masthead and a full-width photograph come first, so the first thing that
 * leans is the first thing a reader reads.
 */
function homePage(ctx, copy = {}) {
  const side = leaning();
  const rows = homeRows(ctx.services, 0);

  const about = (copy.about || []).map(p => `<p>${richText(p)}</p>`).join('\n');

  /* ABSENT IS NOT EMPTY — see Ledger's pages.js for the whole of it.
   * `undefined` means nobody has edited this field and the default stands;
   * an empty string means the owner cleared it on purpose. */
  const lede = undefined === copy.servicesLede
    ? defaultServicesLede()
    : String(copy.servicesLede || '').trim();

  const body = `
${masthead({ h1: homeHeading(ctx.business), sub: copy.sub || '' })}

${plate({ order: ctx.order, slug: 'index', alt: ctx.alt, depth: 0 })}

${row({ label: copy.aboutHeading || '', body: about, side: side() })}

${divider({ line: copy.firstBreak })}

${row({
    label: 'What we do',
    id: TRADES_ID,
    side: side(),
    tint: true,
    /* FOR A CUSTOMER — see the note in Ledger's pages.js, including why
     * this is a JS comment and not an HTML one: an HTML comment inside a
     * template ships into the published page, which happened once, on a
     * live domain, complete with a quoted old draft. */
    body: `${lede ? `<p class="orchard-said">${richText(lede)}</p>` : ''}
      ${grid(rows)}`,
  })}

${divider({ line: copy.secondBreak })}

${row({ label: 'When we are open', side: side(), body: hours({ hours: ctx.hours }) })}

${row({
    label: 'Where to find us',
    id: WHERE_ID,
    side: side(),
    body: mapFrame({ business: ctx.business }),
  })}
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
 * THE HOURS ARE RENDERED, NOT WRITTEN, on every structure. The prompt's
 * fifth block used to be "Hours, and the area we cover", and it produced
 * the same address, the same four towns and the same opening hours on all
 * six pages — one duplicated paragraph across a six-page site.
 */
function servicePage(ctx, service) {
  const depth = depthOf(service.slug);
  const side = leaning();

  const body = `
${masthead({ h1: service.h1 || service.name, sub: service.blurb || '' })}
${plate({ order: ctx.order, slug: service.slug, alt: ctx.alt, depth })}

${/* THE FIRST MENTION OF THE BUSINESS LINKS HOME — 2 November. Nothing is
     written for it: the copy already names the business somewhere, in its
     own words, in a different place on each page, and this marks one of
     them up. Asking the model for a link instead would be the dictated
     sentence again, six times over. See linkHome.js.

     THE SIDE FUNCTION IS SHARED WITH THE BLOCKS BELOW, so the hours and
     the ring carry on the rhythm the prose started rather than beginning a
     second one. */''}
${homeward(prose(service.sections, side), ctx, depth)}

${row({ label: 'When we are open', side: side(), tint: true, body: hours({ hours: ctx.hours }) })}

${row({
    label: 'Next',
    side: side(),
    body: onward({
      order: ctx.order, slug: service.slug,
      business: ctx.business, services: ctx.services, depth,
    }),
  })}
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
 * SO THE PHONE NUMBER IS BESIDE IT. A visitor who fills the form in and
 * presses Send on an unwired action has reached a dead end; one who sees
 * the number has not. The action is a placeholder the owner replaces, and
 * it is named loudly enough that nobody mistakes it for working.
 *
 * THE FIELD IDS ARE ORCHARD'S OWN. Ledger uses n/p/e/m, Beacon bn/bp/be/bm,
 * Anvil an/ap/ae/am, Quarry qn/qp/qe/qm, Harbor hn/hp/he/hm, Atlas
 * mn/mp/me/mm; a seventh structure reusing any of them would be two layouts
 * whose markup cannot be told apart by anything that looks at ids.
 *
 * THE FORM LEANS LIKE EVERYTHING ELSE, WHICH IS THE SEVENTH ANSWER. Ledger
 * and Anvil put facts beneath it, Beacon beside it on the right, Quarry on
 * the left, Harbor nothing beside it, Atlas a label in the margin. Here it
 * is simply the next card in the rhythm — a page that broke its own pattern
 * on the one screen where somebody is deciding to get in touch would be
 * the page looking unfinished at the worst moment.
 */
function contactPage(ctx, copy = {}) {
  const b = ctx.business;
  const side = leaning();
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

${row({
    label: 'Send a message',
    side: side(),
    body: `
      <form class="orchard-form" action="REPLACE_WITH_YOUR_FORM_ENDPOINT" method="post">
        <div class="orchard-form__pair">
          <div><label for="on">Your name</label><input id="on" name="name" type="text" autocomplete="name"></div>
          <div><label for="op">Phone</label><input id="op" name="phone" type="tel" autocomplete="tel"></div>
        </div>
        <label for="oe">Email</label><input id="oe" name="email" type="email" autocomplete="email">
        <label for="om">What is happening?</label><textarea id="om" name="message"></textarea>
        <button type="submit">Send</button>
        <p class="orchard-form__note">Prefer to talk? Call
          <a href="tel:${tel}">${phone}</a>${email ? ` or email
          <a href="mailto:${esc(email)}">${esc(email)}</a>` : ''}.</p>
      </form>`,
  })}

${row({ label: 'What to have ready', side: side(), tint: true, body: `<ul>${ready}</ul>` })}

${row({ label: 'When we are open', side: side(), body: hours({ hours: ctx.hours }) })}

${row({
    label: 'Where to find us',
    id: WHERE_ID,
    side: side(),
    body: `<p>${esc(b.street || '')}<br>${esc([b.city, b.state].filter(Boolean).join(', '))} ${esc(b.zip || '')}</p>
      ${mapFrame({ business: b })}`,
  })}

${row({
    label: 'Next',
    side: side(),
    body: onward({
      order: ctx.order, slug: 'contact',
      business: b, services: ctx.services, depth,
    }),
  })}
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
 * NO PHOTOGRAPH AND NO SCHEMA. It is outside the ring, it carries no
 * picture, and a privacy policy marked up as a Service would be a lie told
 * in JSON.
 *
 * THE SECTIONS LEAN LIKE EVERY OTHER PAGE, so a privacy policy still looks
 * like the site it is on — which on five of the seven it does not.
 */
function legalPage(ctx, slug) {
  const sections = legalSections(ctx.business)[slug] || [];
  const title = PAGE_TITLES[slug] || slug;
  const where = [ctx.business.city, ctx.business.state].filter(Boolean).join(', ');

  const body = `
${masthead({ h1: title })}

${prose(sections, leaning())}`;

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
${masthead({ h1: 'That page is not here' })}

${row({
    label: 'Try',
    side: 'left',
    body: `<p>The <a href="${linkTo('index', null)}">home page</a>${
  ctx.business.phone ? ', or the number at the top' : ''}.</p>`,
  })}`;

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
  leaning,
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
