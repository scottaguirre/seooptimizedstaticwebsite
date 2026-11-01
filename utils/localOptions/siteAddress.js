// utils/localOptions/siteAddress.js
//
// Where a published site lives, worked out in ONE place.
//
// WHY THIS FILE EXISTS — 1 November, and it exists because a comment was
// wrong. Moving sites from `domain.com/business/` to `business.domain.com`
// was described, in the code and to Edwin, as a one-line change:
//
//     "THE URL IS BUILT HERE AND NOWHERE ELSE. The canonical, the sitemap,
//      the robots line, every internal link and the My Sites row all derive
//      from this string — which is why a change this wide is one line."
//
// The first four were true. The last was not. My Sites does not store a URL;
// it stores the domain and the repository and rebuilds the address itself,
// in SEVEN places. So the sites moved, every page inside them was correct,
// and the list went on printing the old shape next to a link that no longer
// resolved — which is exactly how Edwin found it, by reading his own screen.
//
//     A COMMENT THAT SAYS A THING IS IN ONE PLACE IS NOT A TEST.
//     THE SEVENTH COPY DOES NOT KNOW IT IS A COPY.
//
// SO THE ADDRESS IS A FUNCTION NOW, and both halves call it: the builder,
// which writes the URL into every canonical, and the list, which links to
// it. A ninth caller gets it right by default, and the day this shape
// changes again it changes here.
//
// STORED AS PARTS, NOT AS A STRING, AND THAT IS DELIBERATE. GeneratedSite
// keeps `domainName` and `repo`. A stored URL would be a snapshot of the
// shape at publish time, so every site built before today would still print
// a subdirectory for ever; parts re-render into whatever the current shape
// is. The cost is this file, and the cost of NOT having it was seven copies.
//
// WHERE THIS IS TESTED: test-my-sites.js, under "WHERE A SITE LIVES" — with
// the list, because the list is what was wrong. One of those tests reads
// mySitesRoute.js and fails if it concatenates a domain and a repository
// itself again; an eighth copy is the way this comes back.
//
//   node test-my-sites.js

'use strict';

/**
 * The hostname a site is served from.
 *
 * `chicago-plumber` + `7-y.xyz` -> `chicago-plumber.7-y.xyz`
 *
 * EMPTY IN, EMPTY OUT. A site record that lost its domain — the pool row was
 * removed, an old row predates the field — must not produce `https://.undefined/`
 * on somebody's screen. My Sites already has a branch for a site whose domain
 * has left the pool; this returns '' so that branch is reachable rather than
 * being papered over with a broken link.
 */
function siteHostFor({ repo = '', domain = '' } = {}) {
  const name = String(repo == null ? '' : repo).trim().toLowerCase();
  const apex = String(domain == null ? '' : domain).trim().toLowerCase();

  if (!name || !apex) return '';

  return `${name}.${apex}`;
}

/**
 * The full address, with the scheme and a trailing slash.
 *
 * THE TRAILING SLASH IS NOT COSMETIC. This is the base every canonical is
 * built from by appending a path, and `https://host` + `/drain-cleaning/`
 * and `https://host/` + `drain-cleaning/` are two different habits that
 * produce the same string until one of them is wrong. renderSite() strips a
 * trailing slash before appending, so giving it one here is safe; giving a
 * LINK one is what stops a browser making a second request for the redirect.
 */
function siteUrlFor({ repo = '', domain = '' } = {}) {
  const host = siteHostFor({ repo, domain });

  return host ? `https://${host}/` : '';
}

/**
 * The address of one page inside a site.
 *
 * `slug` IS A SLUG, NOT A PATH. It is the directory a service page was
 * written into — the same string fileFor() used — so it never carries a
 * scheme, a host or a leading slash, and this does not try to cope with one.
 */
function pageUrlFor({ repo = '', domain = '', slug = '' } = {}) {
  const base = siteUrlFor({ repo, domain });

  if (!base) return '';

  const page = String(slug == null ? '' : slug).trim().replace(/^\/+|\/+$/g, '');

  return page ? `${base}${page}/` : base;
}

/**
 * What to SHOW, which is the address without the scheme.
 *
 * A LIST OF SITES IS READ, NOT CLICKED THROUGH ONE BY ONE. `https://` in
 * front of every row is eleven characters of nothing, repeated down the
 * page; the link still carries it.
 */
function siteLabelFor({ repo = '', domain = '' } = {}) {
  return siteHostFor({ repo, domain });
}

module.exports = { siteHostFor, siteUrlFor, pageUrlFor, siteLabelFor };
