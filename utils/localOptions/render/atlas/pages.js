// utils/localOptions/render/atlas/pages.js
//
// Atlas's eleven pages.
//
// THE SAME ELEVEN, AND THE SAME SECTIONS INSIDE THEM — the rule that has
// held since Beacon, and the one thing a new structure may not re-decide.
// So this takes exactly what the other five take, in exactly the same
// shape, and decides different markup for it. Nothing here knows how the
// words were written and nothing here writes any.
//
// THE DIFFERENCE IS WHERE THE HEADINGS GO, AND IT REACHES EVERY PAGE.
//
// prose() does not return headings followed by paragraphs. It returns one
// LEAF per section — a label in the left margin, the paragraphs beside it —
// so a service page is five labelled blocks rather than five headings with
// text under them, and the whole page can be read down one edge.
//
//     THAT IS THE STRUCTURE, NOT A STYLE ON TOP OF IT. A stylesheet cannot
//     move an <h2> out of the flow and into a margin beside the paragraphs
//     that follow it; the markup has to put them in two columns.
//
// WHAT IS GENUINELY DIFFERENT, PAGE BY PAGE
//
//   every page  the margin. Each section's heading is beside its prose.
//   home        the services are a TABLE — two columns, ruled, the name
//               against the line. Ledger numbers two columns, Beacon
//               tiles, Anvil rungs, Quarry a sticky index, Harbor a
//               definition list.
//   service     the hours are one folded line of type, not a grid of
//               seven. The sixth answer, and the only one that is not a
//               grid.
//   contact     the form is in the text column with "Contact" in the
//               margin, exactly like every other block. No layout of its
//               own at all, which is the point of a reference page.
//   legal       the same leaves as everything else, which is the first
//               time a legal page has looked like the rest of its site.
//   404         a title block and one leaf.
//
// WHAT IS DELIBERATELY IDENTICAL
//
// The ring, the body-link cap, the hero rotation, the schema, the
// canonical, the Search Console tags and the legal copy. Every one is a
// rule about the SITE rather than about how it looks.
//
//   node test-local-options-atlas.js

'use strict';

const {
  esc,
  urlFor,
  linkTo,
  depthOf,
  homeRows,
  inWords,
  ring,
  SERVICE_COUNT,
  HOME_BODY_LINKS,
  LEGAL_SLUGS,
  PAGE_TITLES,
} = require('../shape');

const {
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
  document: wrap,
} = require('./chrome');

const { contextFor, telFor, homeHeading } = require('../common');
const { richText } = require('../richText');
const { linkHome } = require('../linkHome');
const { localBusiness, serviceNode } = require('../schema');
const { legalSections } = require('../legalText');

/**
 * `{ heading, paragraphs }[]` -> one leaf per section.
 *
 * THIS IS THE STRUCTURE. On the other five this function returns an <h2>
 * followed by its paragraphs; here each section becomes a labelled block,
 * because a heading cannot be moved into a margin by a stylesheet.
 *
 * THE FIRST PARAGRAPH OF THE FIRST SECTION IS THE LEAD, and only that one.
 * An empty heading opens the page without one, which is how every body
 * here starts: the H1 is in the title block, and an h2 immediately under it
 * saying the same thing twice is the commonest shape of generated page
 * there is. leaf() renders the empty label cell anyway, so the text column
 * starts in the same place whether or not a block is labelled.
 *
 * richText, NOT esc — and richText escapes first. An owner editing a live
 * site can put a link in a sentence; see that file for why the order is
 * escape-then-convert rather than allow-some-HTML.
 */
function prose(sections = []) {
  return sections.map((section, i) => {
    const body = (section.paragraphs || []).map((text, j) => {
      const lead = 0 === i && 0 === j ? ' class="atlas-lede"' : '';

      return `<p${lead}>${richText(text)}</p>`;
    }).join('\n');

    return leaf({ label: section.heading || '', body });
  }).join('\n');
}

/**
 * head + main + foot, the same on all eleven.
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
  return `${head({
    business: ctx.business,
    logo: ctx.logo,
    current: slug,
    services: ctx.services,
    depth,
  })}
<main id="${MAIN_ID}" class="atlas-wrap">
${body}
${foot({
    business: ctx.business, services: ctx.services, areas: ctx.areas,
    now: ctx.now, depth,
  })}
</main>`;
}

/**
 * The numeral for a page's margin, or '' for a page outside the ring.
 *
 * THE RING'S OWN ORDER, NOT THE SERVICE LIST'S. They are the same today and
 * the ring is what decides which page follows which, so reading it from
 * anywhere else would be a second opinion about the same sequence.
 *
 * ABSENT RATHER THAN ZERO on the legal pages and the 404. A figure in the
 * margin of a page that is not in the sequence is a number belonging to
 * nothing, and "00" looks like a bug.
 */
function markFor(ctx, slug) {
  const at = ring(ctx.services).indexOf(slug);

  return at < 0 ? '' : String(at + 1).padStart(2, '0');
}

/**
 * A default, not fixed text, and editable — see Ledger's pages.js.
 *
 * WRITTEN TO THE READER, NOT ABOUT THE SITE. The first draft of Anvil's
 * said "All six have a page of their own", which is the exact sentence
 * Edwin struck out on 30 October: "this should be for a customer." It is a
 * note about what was BUILT, not a reason to read on.
 *
 * AND IT READS LIKE THE OPENING OF A REFERENCE, because that is what this
 * page is. Ledger counts the jobs, Beacon names what it is called out for,
 * Anvil tells the reader what to do, Quarry starts from what is wrong,
 * Harbor points at the rail. This one says what the table below it is.
 *
 * `SERVICE_COUNT` THROUGH inWords(), NEVER THE WORD "six" TYPED OUT. The
 * services lede said "three" for a day after the body-link cap became two,
 * because the number was prose rather than the constant.
 */
function defaultServicesLede() {
  return `The ${inWords(SERVICE_COUNT)} jobs this trade is called out for, `
    + 'with what each one involves, how long it usually takes, and what '
    + 'moves the price.';
}

/**
 * The home page.
 *
 * THE TABLE IS THE DIFFERENCE. Six services as two ruled columns — the
 * name against the line — which is the one shape the other five have not
 * used and the one that belongs on a page of this kind.
 */
function homePage(ctx, copy = {}) {
  const rows = homeRows(ctx.services, 0);

  const about = (copy.about || []).map(p => `<p>${richText(p)}</p>`).join('\n      ');

  /* ABSENT IS NOT EMPTY — see Ledger's pages.js for the whole of it.
   * `undefined` means nobody has edited this field and the default stands;
   * an empty string means the owner cleared it on purpose. */
  const lede = undefined === copy.servicesLede
    ? defaultServicesLede()
    : String(copy.servicesLede || '').trim();

  const body = `
${masthead({ h1: homeHeading(ctx.business), sub: copy.sub || '', mark: '01' })}

${plate({ order: ctx.order, slug: 'index', alt: ctx.alt, depth: 0 })}

${/* NO WRAPPER AROUND THE PARAGRAPHS. The body of a leaf is where the
     prose spacing lives on this structure — see the note in theme.js. An
     extra div repeating it is the same rule in two places, and the service
     page proved which way that fails: its sections ARE leaves, and the
     first version wrapped the leaves in the prose class. */''}
${leaf({ label: copy.aboutHeading || '', body: about })}

${divider({ line: copy.firstBreak })}

${leaf({
    label: 'What we do',
    id: TRADES_ID,
    /* FOR A CUSTOMER — see the note in Ledger's pages.js, including why
     * this is a JS comment and not an HTML one: an HTML comment inside a
     * template ships into the published page, which happened once, on a
     * live domain, complete with a quoted old draft. */
    body: `${lede ? `<p class="atlas-said">${richText(lede)}</p>` : ''}
      ${index(rows)}`,
  })}

${divider({ line: copy.secondBreak })}

${leaf({
    label: 'When we are open',
    body: hours({ hours: ctx.hours }),
  })}

${leaf({
    label: 'Where to find us',
    id: WHERE_ID,
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
 * six pages — one duplicated paragraph across a six-page site. The same
 * facts in a band read as reference; in prose, six times, they read as
 * copied.
 */
function servicePage(ctx, service) {
  const depth = depthOf(service.slug);

  const body = `
${masthead({
    h1: service.h1 || service.name,
    sub: service.blurb || '',
    mark: markFor(ctx, service.slug),
  })}
${plate({ order: ctx.order, slug: service.slug, alt: ctx.alt, depth })}

${/* THE SECTIONS GO IN BARE, AND THAT IS THE WHOLE DIFFERENCE. On the other
     five, prose() returns headings and paragraphs that need a wrapper to be
     a column; here it returns one LEAF per section, so the sections are
     already the page's own blocks. Wrapping them in anything is a column
     inside the grid they are part of.

     THE FIRST MENTION OF THE BUSINESS LINKS HOME — 2 November. Nothing is
     written for it: the copy already names the business somewhere, in its
     own words, in a different place on each page, and this marks one of
     them up. Asking the model for a link instead would be the dictated
     sentence again, six times over. See linkHome.js. */''}
${homeward(prose(service.sections), ctx, depth)}

${leaf({ label: 'When we are open', body: hours({ hours: ctx.hours }) })}

${leaf({
    label: 'Next',
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
 * THE FIELD IDS ARE ATLAS'S OWN. Ledger uses n/p/e/m, Beacon bn/bp/be/bm,
 * Anvil an/ap/ae/am, Quarry qn/qp/qe/qm, Harbor hn/hp/he/hm; a sixth
 * structure reusing any of them would be two layouts whose markup cannot be
 * told apart by anything that looks at ids.
 *
 * NO LAYOUT OF ITS OWN, WHICH IS THE SIXTH ANSWER. Ledger and Anvil put
 * facts beneath the form, Beacon beside it on the right, Quarry on the
 * left, Harbor nothing beside it. Atlas gives it exactly the treatment
 * every other block on the site gets: a label in the margin and the thing
 * in the text column. A reference page does not make an exception for its
 * last page.
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
${masthead({
    h1: copy.h1 || `Contact ${b.name || ''}`.trim(),
    sub: copy.sub || '',
    mark: markFor(ctx, 'contact'),
  })}
${plate({ order: ctx.order, slug: 'contact', alt: ctx.alt, depth })}

${leaf({
    label: 'Send a message',
    body: `
      <form class="atlas-form" action="REPLACE_WITH_YOUR_FORM_ENDPOINT" method="post">
        <div class="atlas-form__pair">
          <div><label for="mn">Your name</label><input id="mn" name="name" type="text" autocomplete="name"></div>
          <div><label for="mp">Phone</label><input id="mp" name="phone" type="tel" autocomplete="tel"></div>
        </div>
        <label for="me">Email</label><input id="me" name="email" type="email" autocomplete="email">
        <label for="mm">What is happening?</label><textarea id="mm" name="message"></textarea>
        <button type="submit">Send</button>
        <p class="atlas-form__note">Prefer to talk? Call
          <a href="tel:${tel}">${phone}</a>${email ? ` or email
          <a href="mailto:${esc(email)}">${esc(email)}</a>` : ''}.</p>
      </form>`,
  })}

${leaf({
    label: 'What to have ready',
    body: `<ul>${ready}</ul>`,
  })}

${leaf({ label: 'When we are open', body: hours({ hours: ctx.hours }) })}

${leaf({
    label: 'Where to find us',
    id: WHERE_ID,
    body: `<p>${esc(b.street || '')}<br>${esc([b.city, b.state].filter(Boolean).join(', '))} ${esc(b.zip || '')}</p>
      ${mapFrame({ business: b })}`,
  })}

${leaf({
    label: 'Next',
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
 * NO PHOTOGRAPH, NO SCHEMA AND NO NUMERAL. It is outside the ring, it
 * carries no picture, and a privacy policy marked up as a Service would be
 * a lie told in JSON.
 *
 * THE SAME LEAVES AS EVERY OTHER PAGE, which is new. On the other five a
 * legal page is a heading and a wall of prose — the one page of the site
 * that does not look like the site. Here its sections are labelled in the
 * margin like everything else, and a privacy policy is exactly the kind of
 * document that is read by finding one heading in it.
 */
function legalPage(ctx, slug) {
  const sections = legalSections(ctx.business)[slug] || [];
  const title = PAGE_TITLES[slug] || slug;
  const where = [ctx.business.city, ctx.business.state].filter(Boolean).join(', ');

  const body = `
${masthead({ h1: title, mark: '' })}

${prose(sections)}`;

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
${masthead({ h1: 'That page is not here', mark: '' })}

${leaf({
    label: 'Try',
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
  markFor,
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
