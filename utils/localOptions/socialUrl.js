// utils/localOptions/socialUrl.js
//
// What a customer typed in a social box, turned into a link or into nothing.
//
// WHY IT MOVED HERE — 1 November, when the My Sites editor learned to change
// these. The rule already existed inside socialFrom() in runLocalOptions.js,
// whose own comment says it is a copy of usableUrl() in
// utils/buildSocialLinks.js and explains why the duplication was accepted:
//
//     "Duplicated rather than imported, deliberately... It is four lines
//      and this comment names its twin."
//
// Two copies with a comment pointing at each other is a defensible trade.
// THREE is not, and the editor would have been the third. A customer could
// then type `facebook.com/acme` into the wizard and get a working link, type
// the same thing into the editor and get one that resolves relative to the
// page, and nothing anywhere would look wrong.
//
//     THE SECOND COPY IS A TRADE. THE THIRD IS A BUG WITH A ROTA.
//
// So the rule is one function now and both callers use it. buildSocialLinks
// keeps its own, because it returns rendered HTML for different markup and
// pulling this out of it is the smaller half of a refactor nobody asked for.
//
//   node test-my-sites.js

'use strict';

/**
 * '' for anything that is not a link, otherwise a URL with a scheme.
 *
 * TWO THINGS CUSTOMERS ACTUALLY TYPE, AND BOTH ARE HANDLED HERE:
 *
 *   a placeholder   '#', 'n/a', '-', 'none'. These are what somebody writes
 *                   in a box they do not want to fill in, and rendering an
 *                   icon that links to '#' is worse than rendering none:
 *                   it looks like a working link until it is clicked.
 *   no scheme       'facebook.com/acme' without https:// resolves RELATIVE
 *                   to the page it is on, so the footer link on a service
 *                   page would point at /drain-cleaning/facebook.com/acme.
 *                   A 404 on somebody's own social link.
 *
 * NOT A VALIDATOR. It does not check the host, the path, or that the account
 * exists — a customer may have a Facebook page under any URL Facebook has
 * ever used, and a rule tight enough to be useful would reject some of them.
 * Refusing a link the owner typed on purpose is worse than carrying one that
 * is wrong, because only one of those is visible to them.
 */
function socialUrl(raw) {
  const text = String(raw == null ? '' : raw).trim();

  if (!text) return '';

  /* THE PLACEHOLDERS, CASE-INSENSITIVELY. '#' is the one the generator's
   * own templates have always had to cope with; the words are what people
   * type into a form that will not let them leave a box empty. */
  if (['#', 'n/a', 'na', '-', 'none', 'null'].includes(text.toLowerCase())) return '';

  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

module.exports = { socialUrl };
