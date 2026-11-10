// utils/leadScout/findEmail.js
//
// Does this page show an email address?
//
//   const { hasEmail } = require('./findEmail');
//   hasEmail(html)   // -> { found: true, how: 'mailto' }
//
// PRESENCE, NOT COLLECTION, AND THAT IS THE WHOLE DESIGN.
//
// The lead list this feeds is a list of BUSINESSES, not a list of addresses.
// This module has to pattern-match to answer the question, but it returns a
// boolean and the way it found one — never the address itself. Edwin reads
// the address off the page himself when he writes to them.
//
// That is not a cosmetic distinction. A tool that accumulates addresses is a
// mailing list: it can leak, it can be sold, it can be pointed at a sending
// script by somebody who has not read the law. A tool that answers "is there
// one?" cannot become any of those things by accident.
//
//     IF YOU ADD A FIELD HERE THAT CARRIES THE ADDRESS, YOU HAVE BUILT A
//     DIFFERENT PRODUCT. test-lead-scout.js asserts that none of the
//     returned values contains an "@".
//
//
// WHAT COUNTS, AND THE FALSE POSITIVES THAT SHAPED IT
//
// A naive /\S+@\S+\.\S+/ matches a great deal that is not a contact address.
// Every exclusion below is a thing that actually appears on small-business
// sites:
//
//   logo@2x.png, hero@3x.jpg       retina image filenames
//   @media, @font-face, @keyframes CSS at-rules in inline <style>
//   you@example.com                placeholder text in a form
//   sentry.io / wixpress keys      vendor junk in inline <script>
//   @font-face src urls            as above
//
// A false positive here is worse than a miss: it puts a business on the list
// that cannot actually be contacted the way the list promises.

'use strict';

/** Local part is deliberately strict — no spaces, no quotes, no slashes. */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** mailto: is the only unambiguous signal, so it is checked separately. */
const MAILTO = /<a[^>]+href\s*=\s*["']\s*mailto:([^"'?\s>]+)/i;

/**
 * Addresses nobody can be contacted at. Matched against the WHOLE address,
 * lowercased.
 */
const NOT_A_CONTACT = [
  /@(example|test|domain|yourdomain|email|mysite|yoursite)\.(com|net|org)$/,
  /^(you|your|name|email|user|someone|firstname|john\.?doe|jane\.?doe)@/,
  /@(sentry|wixpress|squarespace|godaddy|cloudflare|gstatic|googleapis|w3)\./,
  /@(sentry\.io|localhost)$/,
  /\.(png|jpe?g|gif|svg|webp|css|js)$/,
];

/**
 * Regions of the markup whose contents are not shown to a visitor. Blanked
 * rather than cut, so nothing shifts: this module reports WHERE it looked,
 * and callers slice the original html for context.
 */
const INVISIBLE = [
  /<script\b[\s\S]*?<\/script>/gi,
  /<style\b[\s\S]*?<\/style>/gi,
  /<!--[\s\S]*?-->/g,
];

function visibleOnly(html) {
  let out = String(html || '');
  for (const re of INVISIBLE) {
    out = out.replace(re, block => block.replace(/[^\n]/g, ' '));
  }
  return out;
}

function isContactable(address) {
  const a = address.toLowerCase();

  // "logo@2x.png" survives the regex because 2x.png looks like a domain.
  if (/^[a-z0-9._%+-]+@\d+x\./.test(a)) return false;

  return !NOT_A_CONTACT.some(re => re.test(a));
}

/**
 * @param {string} html  one page's markup
 * @returns {{found: boolean, how: 'mailto'|'text'|null}}
 *
 * `how` exists so a run can be judged: a list where everything was found as
 * 'text' is a list worth spot-checking by hand.
 *
 * THE ADDRESS IS NOT RETURNED. See the note at the top.
 */
function hasEmail(html) {
  const source = String(html || '');

  // mailto: first. It survives inside a <script> only in templating junk, so
  // it is checked against the visible markup like everything else.
  const visible = visibleOnly(source);

  const link = visible.match(MAILTO);
  if (link && isContactable(decodeURIComponent(link[1]))) {
    return { found: true, how: 'mailto' };
  }

  EMAIL.lastIndex = 0;
  let m;
  while ((m = EMAIL.exec(visible))) {
    if (isContactable(m[0])) return { found: true, how: 'text' };
  }

  return { found: false, how: null };
}

module.exports = { hasEmail, isContactable, visibleOnly };
