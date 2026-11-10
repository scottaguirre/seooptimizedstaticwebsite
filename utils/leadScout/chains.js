// utils/leadScout/chains.js
//
// Is this website somebody Edwin could actually sell a one-page site to?
//
//   siteKey('https://www.h2health.com/austin')   -> 'h2health.com'
//   isChain('local.targetoptical.com')           -> true
//
// WHY THIS EXISTS. The first real run searched three trades in Austin and
// came back with 112 websites — of which about twenty were the same handful
// of domains over and over:
//
//     www.bswphysicaltherapy.com   5 times
//     locations.myeyedr.com        5 times
//     www.thejoint.com             4 times
//     www.resultspt.com            4 times
//     www.h2health.com             3 times, and a LEAD all three
//
// Nothing was broken: those are genuinely different BUSINESSES, each with
// its own Google place_id, which is what the run deduped on. They share one
// WEBSITE, and the website is the thing being sold.
//
//     DEDUPE ON THE THING YOU ARE SELLING, NOT ON THE THING THE DATA
//     HAPPENS TO BE KEYED BY.
//
// Two separate problems came out of that and they need separate answers:
//
//   the same site listed many times  -> siteKey(), and dedupe on it
//   CVS, LensCrafters, Warby Parker  -> isChain(), and drop them
//
// A multi-location LOCAL practice is a good lead, not a chain — three
// clinics in one city is exactly the customer who can afford a rebuild. So
// repetition alone is NOT treated as disqualifying: the run collapses them
// to one lead and reports how many listings shared it. Only the named
// nationals below are dropped.

'use strict';

/**
 * National and regional groups nobody is pitching a one-page site to.
 *
 * MATCHED ON THE REGISTRABLE DOMAIN, so a franchise's local subdomain is
 * caught with it. Every entry came out of the Austin run or is a household
 * name in these three trades.
 *
 * THIS LIST IS MEANT TO BE EDITED. It is a judgement about who is worth
 * writing to, not a fact about the world — add to it the first time a run
 * surfaces somebody obviously too big.
 */
const CHAINS = new Set([
  // optical
  'lenscrafters.com', 'targetoptical.com', 'visionworks.com', 'warbyparker.com',
  'americasbest.com', 'myeyedr.com', 'pearlevision.com', 'eyemart.com',
  'lasikplus.com', 'forevereyes.com', 'stantonoptical.com', 'eyeglassworld.com',
  // chiropractic / PT groups
  'thejoint.com', 'airrosti.com', 'resultspt.com', 'atipt.com', 'h2health.com',
  'bswphysicaltherapy.com', 'selectphysicaltherapy.com', 'athletico.com',
  'ivyrehab.com', 'pivotphysicaltherapy.com', 'crossoverhealth.com',
  '100percentchiropractic.com', 'thebackspacechiro.com',
  // hospital systems and pharmacy
  'cvs.com', 'walgreens.com', 'stdavids.com', 'ascension.org', 'baylorscottandwhite.com',
  'kaiserpermanente.org', 'onemedical.com',
]);

/**
 * Subdomains a multi-location group uses for its store finder. A page at
 * locations.something.com is a branch page inside a corporate site, not a
 * practice's own website, so it is never a lead even when the parent domain
 * is not on the list above.
 */
const LOCATOR_SUBDOMAINS = /^(locations?|local|stores?|find|branches|offices)\./i;

/**
 * The website, as a key. www. and the path go; the host does not.
 *
 * NOT A FULL PUBLIC-SUFFIX PARSE. "clinic.co.uk" would reduce to "co.uk"
 * under a naive last-two-labels rule, so the host is kept whole apart from
 * a leading www. That is the conservative direction: it may keep two
 * spellings of one site apart, which costs a duplicate row, where the other
 * mistake silently merges two unrelated practices into one lead.
 */
function siteKey(url) {
  if (!url) return '';

  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    host = String(url).toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  }

  return host.replace(/^www\./, '');
}

/** The last two labels, for matching against CHAINS. */
function registrable(host) {
  const parts = String(host || '').split('.');
  return parts.length <= 2 ? host : parts.slice(-2).join('.');
}

/**
 * @param {string} url  a site URL or hostname
 * @returns {boolean}
 */
function isChain(url) {
  const host = siteKey(url);
  if (!host) return false;

  if (LOCATOR_SUBDOMAINS.test(host)) return true;

  return CHAINS.has(host) || CHAINS.has(registrable(host));
}

module.exports = { siteKey, isChain, registrable, CHAINS, LOCATOR_SUBDOMAINS };
