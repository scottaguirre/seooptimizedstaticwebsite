// utils/localOptions/render/common.js
//
// The parts of a site that are the same whatever it looks like.
//
// WHY THIS FILE EXISTS — 30 October, building Beacon as a second structure.
// Six social logos, a business's initials, an address on one line and the
// dialable form of a phone number are facts about the BUSINESS. They were in
// chrome.js, which is Ledger's markup, and Beacon importing them from there
// would have said something false about where they belong.
//
//     A LAYOUT OWNS ITS MARKUP. IT DOES NOT OWN THE BUSINESS.
//
// Everything here is prefix-free and class-free: no `ledger-`, no `beacon-`,
// nothing that renders. chrome.js and pages.js re-export their old names from
// this file, so every caller written before today is untouched.

'use strict';

const { ring } = require('./shape');

/* The marks, as paths. Inline SVG rather than an icon font or a sprite: six
 * paths cost less than a request, and a font that fails to load leaves six
 * empty squares in the footer.
 *
 * SIX, AND IT WAS THREE UNTIL 28 OCTOBER — facebook, instagram, youtube.
 *
 * The wizard collects SIX social URLs, and a footer renders only the keys
 * that appear in this object. So with three here, a customer who filled in
 * Twitter, Pinterest or LinkedIn had those dropped: no error, no empty link,
 * just an icon that never appeared. utils/buildSocialLinks.js has the same
 * six for the generator's own templates, and these paths are COPIED from it
 * rather than redrawn, so the two cannot disagree about a logo.
 *
 * THE KEYS ARE THE SHORT NAMES, not the form's `facebookUrl` spelling. The
 * adapter in utils/runLocalOptions.js strips that suffix, because a renderer
 * should not have to know what the form calls its boxes. */
const SOCIAL = {
  facebook: {
    viewBox: '0 0 24 24',
    path: 'M22.675 0H1.325C.593 0 0 .593 0 1.326v21.348C0 23.407.593 24 1.325 24h11.495v-9.294H9.691v-3.622h3.129V8.413c0-3.1 1.894-4.788 4.659-4.788 1.325 0 2.466.099 2.798.143v3.24l-1.922.001c-1.504 0-1.796.715-1.796 1.763v2.31h3.587l-.467 3.622h-3.12V24h6.116C23.406 24 24 23.407 24 22.674V1.326C24 .593 23.407 0 22.675 0z',
  },
  instagram: {
    viewBox: '0 0 24 24',
    path: 'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z',
  },
  youtube: {
    viewBox: '0 0 576 512',
    path: 'M549.7 124.1c-6.3-23.7-24.9-42.3-48.6-48.6C456.9 64 288 64 288 64S119.1 64 74.9 75.5c-23.7 6.3-42.3 24.9-48.6 48.6C15.8 168.3 15.8 256 15.8 256s0 87.7 10.5 131.9c6.3 23.7 24.9 42.3 48.6 48.6C119.1 448 288 448 288 448s168.9 0 213.1-11.5c23.7-6.3 42.3-24.9 48.6-48.6C560.2 343.7 560.2 256 560.2 256s0-87.7-10.5-131.9zM232 336V176l142 80-142 80z',
  },
  twitter: {
    viewBox: '0 0 24 24',
    path: 'M2.25 2h5.64l4.61 6.49L17.11 2h4.64l-7.57 9.35L22 22h-5.7l-5.01-7.03L5.61 22H1l8.08-9.97L2.25 2zm6.38 1.49H5.61l12.15 17.02h3.02L8.63 3.49z',
  },
  pinterest: {
    viewBox: '0 0 24 24',
    path: 'M12 0C5.37 0 0 5.37 0 12c0 4.87 3.09 9.03 7.44 10.64-.1-.9-.19-2.28.04-3.26.21-.9 1.38-5.71 1.38-5.71s-.35-.7-.35-1.72c0-1.61.94-2.81 2.11-2.81.99 0 1.46.74 1.46 1.63 0 1-.63 2.49-.96 3.87-.27 1.14.57 2.07 1.69 2.07 2.03 0 3.6-2.14 3.6-5.24 0-2.74-1.97-4.66-4.78-4.66-3.26 0-5.17 2.45-5.17 4.98 0 .99.38 2.06.86 2.64.1.12.11.23.08.36-.09.4-.28 1.27-.32 1.45-.05.21-.17.26-.4.16-1.49-.62-2.42-2.56-2.42-4.11 0-3.35 2.44-6.42 7.05-6.42 3.7 0 6.57 2.64 6.57 6.17 0 3.68-2.31 6.64-5.52 6.64-1.08 0-2.09-.56-2.44-1.22l-.66 2.5c-.24.91-.88 2.05-1.3 2.75.98.3 2.02.46 3.1.46 6.63 0 12-5.37 12-12S18.63 0 12 0z',
  },
  linkedin: {
    viewBox: '0 0 24 24',
    path: 'M20.447 20.452H17.21V14.85c0-1.336-.027-3.058-1.864-3.058-1.865 0-2.15 1.454-2.15 2.957v5.703h-3.24V9h3.111v1.561h.045c.433-.82 1.493-1.683 3.073-1.683 3.287 0 3.893 2.164 3.893 4.978v6.596zM5.337 7.433a1.875 1.875 0 1 1 0-3.751 1.875 1.875 0 0 1 0 3.751zM6.766 20.452H3.91V9h2.856v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z',
  },
};

/**
 * The two letters in the corner, when there is no logo.
 *
 * FROM THE BUSINESS NAME, not typed in. The mock-up had "LP" written into
 * the header, which is right for exactly one client. Two initials from the
 * first two words, one if there is only one word.
 */
function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);

  return words.slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

/** "1804 S Bagdad Rd, Leander, TX 78641" — one line, no empty commas. */
function addressLine(business = {}) {
  const tail = [business.city, business.state].filter(Boolean).join(', ');

  return [business.street, tail, business.zip].filter(Boolean).join(' ').replace(/\s+,/g, ',')
    || '';
}

/** The same, comma-separated, for a map query and for schema. */
function addressQuery(business = {}) {
  return [
    business.street,
    business.city,
    [business.state, business.zip].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ');
}

/**
 * The dialable form of a phone number, for href="tel:…".
 *
 * DERIVED HERE, BECAUSE NOBODY WAS SUPPLYING IT. The templates write
 * `href="tel:${business.tel || ''}"` in four places. The 28 October --site
 * run rendered all four as `href="tel:"` — a Call button that does nothing
 * on a phone — because the fixture set `phone` and not `tel`, and `|| ''`
 * made that a silent blank rather than an error. The first real customer
 * site would have shipped the same way.
 *
 * NOT utils/formatPhoneForHref.js, which looks like the right import and is
 * not: it returns the "tel:" scheme as part of the string, and every
 * template already writes that itself, so importing it would produce
 * `tel:tel:+1…`. It also prefixes +1 unconditionally, which turns an
 * 11-digit "1 512 555 0164" into +11512555.... Both are fine where it is
 * used; neither is fine here.
 */
function telFor(phone) {
  const digits = String(phone || '').replace(/\D/g, '');

  if (!digits) return '';
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;

  /* ANYTHING ELSE GOES THROUGH AS DIGITS, WITH NO COUNTRY CODE INVENTED.
   * The route rejects a non-dialable number before a job is ever queued, so
   * this branch means something unexpected reached the renderer — and a
   * number a phone can at least attempt beats a guessed +1. */
  return digits;
}

/**
 * The home page's H1 — the business name, a hyphen, the town and the state.
 *
 * BUILT HERE RATHER THAN ASKED FOR — Edwin, 30 October: "the H1 should be
 * the name of the business followed by a slash and then The city + State",
 * then, on seeing it built: "next time I don't want a slash, I want a
 * hyphen."
 *
 * The model used to write it, from a brief that said "what you do, and
 * where, naming the town and the state", and produced "Plumbing in Chicago,
 * IL" — correct, and not what was wanted. A FIXED SHAPE ASKED FOR IN WORDS
 * IS A SHAPE THAT DRIFTS; constructed, it cannot.
 *
 * NO TRADE WORD IS ADDED WHEN THE NAME LACKS ONE. A plumber called Gomanzo
 * gets "Gomanzo / Chicago, IL", which says nothing about plumbing — and
 * that is the choice, made deliberately. The line under the H1 says what
 * they do, the title tag says it, and the alternative is an H1 that is not
 * the business's actual name.
 *
 * IT DEGRADES RATHER THAN PRINTING A STRAY SEPARATOR. A business with no city
 * gets its name alone; a context with neither gets an empty string, which
 * the renderers already handle — the home page has had an empty H1 since
 * before any of this, whenever the model's reply came back short.
 */
function homeHeading(business = {}) {
  const name = String(business.name || '').trim();

  const place = [business.city, business.state]
    .map(v => String(v == null ? '' : v).trim())
    .filter(Boolean)
    .join(', ');

  if (!name) return place;
  if (!place) return name;

  /* A PLAIN HYPHEN, NOT AN EN DASH. The prose on these sites uses em
   * dashes and this is the one place that does not — because it was asked
   * for in that word, and a separator somebody reads as the wrong
   * character every time they look at their own front page is worse than a
   * typographically tidy one. */
  return `${name} - ${place}`;
}

/**
 * Everything the page builders need, assembled once.
 *
 * THE SAME CONTEXT FOR EVERY STRUCTURE. What a page is ABOUT does not change
 * with how it looks — the business, the six services, the ring order, the
 * hours, the alt text, the Search Console tokens. Only the markup does.
 */
function contextFor(site) {
  const order = ring(site.services || []);

  const business = site.business || {};

  return {
    site: site.url || '',

    /* `tel` FILLED IN IF IT WAS NOT SUPPLIED, and never overwritten if it
     * was — a caller with an international number has already done the work
     * telFor() would only approximate. */
    business: business.tel ? business : { ...business, tel: telFor(business.phone) },
    services: site.services || [],
    areas: site.areas || [],
    hours: site.hours || [],
    alt: site.alt || {},
    logo: site.logo || '',

    /* THE CLIENT'S OWN SEARCH CONSOLE TOKENS, already reduced to tokens by
     * utils/blog/verificationTags.js before they were stored. Each site at
     * acme.com/<name>/ is its own URL-prefix property, owned by the business
     * it belongs to — which is why this is per site and not per domain: a
     * DNS record would verify the whole domain, and the domain holds other
     * people's sites. */
    verification: site.verification || [],

    /* WHICH PICTURE REPRESENTS THE BUSINESS. Declared in the trade folder's
     * alt.json rather than fixed at 1 — see coverFor() in heroes.js and the
     * comment on node.image in schema.js for what fixing it at 1 cost. */
    cover: site.cover || 1,
    order,
    now: site.now || new Date(),
  };
}

module.exports = {
  SOCIAL,
  homeHeading,
  initials,
  addressLine,
  addressQuery,
  telFor,
  contextFor,
};
