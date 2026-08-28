// utils/normalizeDomain.js
//
// Reduce whatever the customer typed into a bare hostname.
//
//     https://Example.com/contact/   ->  example.com
//     www.Example.com                ->  www.example.com
//
// WHAT CHANGED, AND WHY IT MATTERS
//
// This used to prepend "www." when it was missing. That was a guess about
// someone else's DNS, made at generation time, on a site that usually is not
// live yet — and it is the one guess that cannot be checked.
//
// It matters because this function is the single source of truth for the
// site's absolute address. siteBaseUrl() wraps it, and the canonical tags,
// sitemap.xml, robots.txt, the LocalBusiness schema and the Rank Fast naked
// URLs all read from that. Prepending "www." meant every one of those
// declared a hostname the customer never mentioned. If their DNS has no www
// record, the sitemap lists URLs that do not resolve and the canonical points
// at nothing.
//
// The domain the customer typed is the only evidence available about which
// hostname is real, so that is what is used. No www is added, and an existing
// www is kept.
//
// This does NOT decide the www-vs-apex question for the live site — nothing
// here can. That is settled by a DNS record for the other form plus a 301
// between them. What this guarantees is that the site never DECLARES a
// hostname nobody asked for.

/**
 * @param {string} input  anything from a domain field
 * @returns {string}      bare lowercase hostname, or '' if unusable
 */
function normalizeDomain(input) {
  if (!input) return '';

  let host = String(input).trim().toLowerCase();

  // Scheme — any scheme, not just http/https, and tolerant of the one-slash
  // typo "https:/example.com".
  //
  // The trailing \/+ is REQUIRED, not optional. Written as :\/{0,2} this also
  // matches "example.com:" and turns "example.com:8080" into "8080" — the
  // hostname itself is a valid scheme shape, so with no slash demanded the
  // pattern happily eats it.
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/+/, '');

  // userinfo, e.g. user:pass@host
  host = host.replace(/^[^/@]*@/, '');

  // Path, query string and fragment.
  //
  // THE IMPORTANT ONE. Without it, someone pasting the URL of their contact
  // page gives every page on the site a canonical of
  //     https://example.com/contact/water-heater-repair.html
  // and the whole set is silently wrong. Nothing downstream would catch it,
  // because the string still looks like a domain.
  host = host.replace(/[/?#].*$/, '');

  // port
  host = host.replace(/:\d+$/, '');

  // trailing dot — "example.com." is a valid FQDN and resolves fine, but it
  // is a different string, so canonical and sitemap would disagree with
  // whatever Google actually crawled.
  host = host.replace(/\.+$/, '');

  return host;
}

module.exports = { normalizeDomain };