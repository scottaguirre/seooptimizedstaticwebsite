// utils/dnsLabel.js
//
// The one word a customer types in front of a pool domain.
//
//   normalisePrefix(' HVAC ')   -> 'hvac'
//   normalisePrefix('my.site')  -> ''      (a dot is not a label)
//   normalisePrefix('www')      -> ''
//
// LIFTED OUT OF staticBlogsRoute.js ON 7 NOVEMBER, when Cloudflare Websites
// needed the identical rule. The alternative was a second copy, and a second
// copy of a validator is the kind of duplicate that does not announce itself
// when it drifts: one of the two screens quietly starts accepting a prefix
// the other refuses, and the symptom turns up as a wrangler error at deploy
// time on one page and not the other.
//
// RETURNS '' FOR "NO", NOT false. The callers all do `if (!prefix)` and then
// build `${prefix}.${domain}`, so a falsy value that is still a string
// cannot become the text "false" in a hostname if somebody forgets the
// check. There is no error message here on purpose: the two screens word
// the refusal differently because they are refusing it to different people.

'use strict';

/**
 * @param {*} raw  whatever the form posted
 * @returns {string} the normalised label, or '' if it is not usable
 */
function normalisePrefix(raw) {
  const text = String(raw == null ? '' : raw).trim().toLowerCase();

  /* 63 IS THE DNS LIMIT FOR ONE LABEL, and it is checked before the pattern
   * so a 300-character paste is refused by length rather than by a regex
   * walking all of it. */
  if (!text || text.length > 63) return '';

  /* `www` IS REFUSED, AND IT IS THE ONLY RESERVED WORD HERE.
   *
   * It is the one prefix a customer reaches for by habit, and on a pool
   * domain it is the one that cannot be had: the apex site, when there is
   * one, is served from it. Taking it would hand one customer the address
   * everybody else's clients type by accident. */
  if ('www' === text) return '';

  /* A DNS LABEL: letters, digits and inner hyphens. No dots, no leading or
   * trailing hyphen — the last of which Cloudflare ACCEPTS in a project
   * name and REFUSES in a hostname, so it would fail halfway through
   * creating the thing rather than before it started. */
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(text)) return '';

  return text;
}

module.exports = { normalisePrefix };
