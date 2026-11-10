// utils/domainPool.js
//
// Which rows of the shared domain pool belong to which product.
//
//   Domain.find(blogDomains())    the /static-blogs dropdown
//   Domain.find(siteDomains())    the /cloudflare-sites dropdown
//   Domain.find(githubDomains())  Local Website Options
//
// ONE FILE, BECAUSE THE POOL IS ONE COLLECTION WITH THREE KINDS IN IT
//
// models/Domain.js explains why that is the right shape. The cost of it is
// that every reader has to say which kind it wants, and the failure mode of
// forgetting is not an error — it is a dropdown quietly offering somebody
// else's domains.
//
// THAT ALREADY HAPPENED. /static-blogs asked `Domain.find({ enabled: true })`
// and nothing more, which was correct on the day it was written because
// every row was a blog row. On 29 October `target: 'github'` arrived, and
// from that moment the blog dropdown offered GitHub website domains — rows
// with no Cloudflare account at all, which would have created a blog whose
// publish throws in credsFor(). Nothing announced it. It was found on 7
// November while adding a THIRD kind, by reading the query.
//
//     AN UNFILTERED QUERY IS NOT A QUERY FOR THE ORIGINAL KIND.
//     IT IS A QUERY FOR THE ORIGINAL KIND AND WHATEVER IS
//     ADDED AFTER IT — and it adopts the new thing silently.
//
// So the filters are named, exported, tested, and the only copies.
//
//
// THE MISSING-FIELD TRAP, WHICH IS THE WHOLE REASON blogDomains() IS NOT
// JUST `{ target: 'cloudflare' }`
//
// Mongoose applies a schema `default` when a document is SAVED, not to
// documents already stored. `target` did not exist before 29 October, so
// every row written before then has no `target` key at all — and in
// MongoDB, `{ target: 'cloudflare' }` does not match a document that lacks
// the field. Spelled the obvious way, this filter would hide every domain
// Edwin added in the first week from the dropdown that needs them most.
//
// `{ $in: ['cloudflare', null] }` matches both, because null matches a
// missing field. This is the one query in the three that cannot be written
// the simple way, and it is the one that would have broken silently.

'use strict';

/**
 * Blog domains: the /static-blogs pool.
 *
 * @param {boolean} [enabledOnly=true]  false for an admin view that shows
 *        the rows taken off the list as well as the live ones.
 */
function blogDomains(enabledOnly = true) {
  const filter = { target: { $in: ['cloudflare', null] } };
  if (enabledOnly) filter.enabled = true;
  return filter;
}

/**
 * Cloudflare Websites domains: the /cloudflare-sites pool.
 *
 * NO null HERE, AND THAT ASYMMETRY IS CORRECT. There is no such thing as a
 * stored row that means 'cfsite' without saying so — the value is newer
 * than every document in the collection. Writing `$in: ['cfsite', null]`
 * would hand every pre-29-October blog domain to the websites dropdown,
 * which is precisely the separation Edwin asked for, undone.
 */
function siteDomains(enabledOnly = true) {
  const filter = { target: 'cfsite' };
  if (enabledOnly) filter.enabled = true;
  return filter;
}

/** GitHub Pages domains: Local Website Options. Same reasoning as above. */
function githubDomains(enabledOnly = true) {
  const filter = { target: 'github' };
  if (enabledOnly) filter.enabled = true;
  return filter;
}

/**
 * Does this row belong to that product? The in-memory twin of the filters.
 *
 * FOR THE ROW YOU ALREADY HAVE. A route that has loaded a Domain by its
 * `domain` string still has to check what kind it is before using it, and
 * re-querying with a filter to find out would be a second round trip to
 * answer a question about a document in hand.
 *
 * THE DEFAULT IS APPLIED HERE TOO, for the same reason as above: a row with
 * no `target` is a blog row, and a comparison written as
 * `'cloudflare' === row.target` reads as if it says so while returning
 * false for every row stored before the field existed.
 */
function targetOf(row) {
  const value = row && row.target;
  return value ? String(value) : 'cloudflare';
}

/** @returns {boolean} */
function isTarget(row, target) {
  return targetOf(row) === String(target);
}

module.exports = {
  blogDomains, siteDomains, githubDomains, targetOf, isTarget,
};
