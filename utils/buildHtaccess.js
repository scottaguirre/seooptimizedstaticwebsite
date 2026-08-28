// utils/buildHtaccess.js
//
// Writes .htaccess into the generated site.
//
// WHAT IT IS FOR
//
// The site DECLARES one address — in the canonical tags, sitemap.xml,
// robots.txt and the LocalBusiness schema, all of them derived from
// siteBaseUrl(). Every other spelling of that address has to end up at the
// declared one, or the declaration is a lie:
//
//     http://           -> https://
//     the other host    -> the declared host
//
// Get this wrong and two things happen. Backlinks pointing at the other
// spelling land on a page Google treats as a different site, so their value
// is split across two hosts instead of pooled on one. And the canonical tag
// names a URL the server never actually serves, which Google will ignore.
//
// Both are avoided by one 301, and a 301 loses nothing — Google has said
// since 2016 that redirects pass full PageRank.
//
// THE DIRECTION IS DERIVED, NEVER CHOSEN
//
// Which way the host redirect points comes from normalizeDomain(), the same
// function siteBaseUrl() uses. If the customer typed a www domain, the apex
// redirects to www. If they typed the apex, www redirects to the apex. That
// is deliberate: the redirect and the canonical read from one source, so they
// cannot drift apart. Hard-coding "always strip www" here would have
// reintroduced exactly the guess that was just removed from normalizeDomain.
//
// WHAT THIS CANNOT DO
//
//  * .htaccess is Apache. Nginx, Caddy, IIS and most static hosts ignore the
//    file completely — harmless, but it does nothing there.
//  * It needs mod_rewrite. Standard on shared/cPanel hosting.
//  * It CANNOT fix a missing DNS record. A redirect only runs once a request
//    reaches the server, and with no A/CNAME record for the other hostname
//    nothing ever gets there — the visitor sees a DNS error and Googlebot
//    records a failed fetch. That part is settled at the registrar. cPanel
//    creates the www alias automatically and Cloudflare/Netlify/Vercel serve
//    both by default, but it is worth checking rather than assuming.
//  * Some Windows archive tools hide dotfiles, so a customer unzipping the
//    site may not see .htaccess in Explorer. It is in the archive and uploads
//    fine; it is just invisible unless hidden files are shown.

const fs = require('fs');
const path = require('path');
const { normalizeDomain } = require('./normalizeDomain');

/**
 * The redirect block, as text.
 *
 * Exported separately so it can be tested, and so the WordPress exporter can
 * reuse the reasoning if it ever needs to.
 *
 * @param {string} domain  raw domain field, same value siteBaseUrl() gets
 * @returns {string}       file contents, or '' when the domain is unusable
 */
function renderHtaccess(domain) {
  const host = normalizeDomain(domain);

  // Same shape check siteBaseUrl() applies. No host, no redirects — an
  // .htaccess built from junk would send every visitor to a broken address,
  // which is far worse than shipping no file at all.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return '';

  const usesWww = host.startsWith('www.');
  const apex = usesWww ? host.slice(4) : host;
  const other = usesWww ? apex : `www.${host}`;

  return `# Generated automatically. Do not hand-edit — regenerating the site
# overwrites this file.
#
# This site's one true address is:
#
#     https://${host}
#
# That exact string is what every canonical tag, sitemap.xml, robots.txt and
# the LocalBusiness schema declare. The rules below make the server agree with
# them, so links to any other spelling still land in one place and their
# ranking value pools on one host instead of splitting across two.

<IfModule mod_rewrite.c>
  RewriteEngine On

  # 1. http -> https, landing directly on the declared host.
  #
  # The host is written into the target rather than kept as %{HTTP_HOST}, so
  # http://${other}
  # reaches https://${host} in ONE hop
  # instead of two. Google follows chains, but each hop is a chance to lose
  # the thread and browsers cache them.
  #
  # The third condition is what keeps this rule from being greedy. Without it
  # ANY http request on this server — including a subdomain added later, like
  # shop. or staging. — would be redirected to the main site.
  RewriteCond %{HTTPS} !=on
  RewriteCond %{HTTP:X-Forwarded-Proto} !https
  RewriteCond %{HTTP_HOST} ^(www\\.)?${apex.replace(/\./g, '\\.')}$ [NC]
  RewriteRule ^ https://${host}%{REQUEST_URI} [L,R=301]

  # 2. Force the declared host on requests that are already https.
  #
  #     ${other}
  #        -> ${host}
  #
  # Condition one excludes the host we already want, so this cannot loop.
  # Condition two limits the rule to this site's two spellings, for the same
  # reason as above — a later subdomain must be left alone.
  # NC on both: hostnames are case-insensitive and clients do send mixed case.
  RewriteCond %{HTTP_HOST} !^${host.replace(/\./g, '\\.')}$ [NC]
  RewriteCond %{HTTP_HOST} ^(www\\.)?${apex.replace(/\./g, '\\.')}$ [NC]
  RewriteRule ^ https://${host}%{REQUEST_URI} [L,R=301]
</IfModule>

# Serve index.html for the site root.
DirectoryIndex index.html
`;
}

/**
 * Write .htaccess into distDir.
 *
 * Never throws: a missing redirect file is a quality problem, not a reason to
 * fail a generation that has already produced every page.
 *
 * @returns {{written: boolean, host: string}}
 */
function buildHtaccess(distDir, globalValues = {}) {
  try {
    const body = renderHtaccess(globalValues.domain);

    if (!body) {
      console.warn('   ⚠️ No usable domain — skipping .htaccess');
      return { written: false, host: '' };
    }

    fs.writeFileSync(path.join(distDir, '.htaccess'), body, 'utf8');

    const host = normalizeDomain(globalValues.domain);
    console.log(`🔁 .htaccess written → forces https and ${host}`);
    return { written: true, host };

  } catch (err) {
    console.warn('   ⚠️ Could not write .htaccess:', err.message);
    return { written: false, host: '' };
  }
}

module.exports = { buildHtaccess, renderHtaccess };