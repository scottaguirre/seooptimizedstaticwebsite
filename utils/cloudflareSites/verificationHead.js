// utils/cloudflareSites/verificationHead.js
//
// Put a website's Search Console verification tags into the pages that are
// about to be published.
//
//   const files = injectVerification(read.files, site.verificationTags);
//
//
// WHY HERE AND NOT IN A TEMPLATE
//
// The blogs half of this product renders its own <head> in
// utils/blog/render/postPage.js, so its verification is one line in the
// renderer. Websites are different: they are built by runGeneration from
// src/template.html and six sibling builders, and {{CANONICAL}} — the one
// optional <head> tag that already exists — is filled in SEVEN places. A
// {{VERIFICATION}} placeholder would mean four templates and seven builders
// agreeing, and utils/checkPlaceholders.js fails the build if any one of
// them forgets, so the cost of the obvious approach is seven chances to
// break every other product.
//
//     THE NARROW CHANGE IS THE ONE THAT CANNOT REACH THE OTHER PRODUCTS.
//
// publishNow() in routes/cloudflareSitesRoute.js already holds every file as
// a { path: Buffer } map, immediately before the deploy, and it is the ONE
// path both the first publish and the edit rebuild go through. So the tags
// go in there. Nothing in the generator changes, and a site of any other
// kind is untouched because nothing else calls this.
//
//
// BUILT HERE, NEVER ECHOED
//
// The same rule postPage.js states: what the customer pasted was a whole
// <meta> element, verificationTags.js reduced it to a token and refused
// anything that was not token-shaped, and this writes a fresh element around
// that value and escapes it on the way. Two independent defences, because
// the parser is one validation somebody relaxes later and this is a
// published page on somebody else's domain.
//
//
// ON EVERY PAGE, NOT JUST THE FRONT ONE
//
// Google checks the property URL, which is usually the front page — but a
// property can be registered for any URL, people verify sub-paths, and
// Google re-checks periodically. A tag on index.html alone would verify and
// then quietly stop verifying the day somebody pointed the property
// somewhere else. Every page costs one line of HTML.

'use strict';

const fs = require('fs');
const path = require('path');

/** For an attribute value. The token is already shape-checked; this is belt. */
function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * The markup for one site's tags.
 *
 * @param {string[]} tags  tokens, already through parseVerificationTags
 * @returns {string} zero or more <meta> elements, newline separated
 */
function verificationMeta(tags = []) {
  return (Array.isArray(tags) ? tags : [])
    .filter(t => t && String(t).trim())
    .map(token => `<meta name="google-site-verification" content="${esc(String(token).trim())}">`)
    .join('\n  ');
}

/**
 * Is this a page we should write into?
 *
 * EXTENSION, NOT CONTENT SNIFFING. readSite() hands back css, js, images and
 * a sitemap alongside the pages, and a .xml file with a <head> in it is not
 * a thing, but a .js file containing the string "<head>" very much is.
 */
function isHtml(p) {
  return /\.html?$/i.test(String(p || ''));
}

/**
 * Insert the tags into one page's HTML.
 *
 * AFTER <head>, NOT BEFORE </head>. Both work, and the opening tag is the
 * one that cannot be missing from a document that has a head at all —
 * several of these pages are assembled by `.replace('</body>', …)` already,
 * and a second rewrite keyed to a closing tag is a second thing to get out
 * of order.
 *
 * A PAGE WITH NO <head> IS LEFT ALONE rather than repaired. If one ever
 * appears it is a generator bug, and silently growing a head here would
 * hide it.
 */
function injectInto(html, meta) {
  if (!meta) return html;

  // Already carries exactly these tags — a no-op rather than a duplicate.
  if (html.includes(meta)) return html;

  const m = /<head[^>]*>/i.exec(html);
  if (!m) return html;

  const at = m.index + m[0].length;

  return `${html.slice(0, at)}\n  ${meta}${html.slice(at)}`;
}

/**
 * Every HTML file in the map, with the verification tags added.
 *
 * RETURNS A NEW MAP AND MUTATES NOTHING. publishNow() reads the site once
 * and hands the same object to the deploy; a function that edited it in
 * place would make "did we publish the tags" depend on call order.
 *
 * THE SAME OBJECT BACK WHEN THERE IS NOTHING TO DO, so a site with no tags
 * — which is almost all of them — costs one array check and no copying.
 *
 * @param {Object} files  { 'index.html': Buffer, 'css/index.css': Buffer, … }
 * @param {string[]} tags
 * @returns {Object} the same shape, Buffers in and Buffers out
 */
function injectVerification(files, tags = []) {
  const meta = verificationMeta(tags);
  if (!meta || !files) return files;

  /* NOTE — 17 November. This still returns `files` untouched when there are
   * no tags, which is right for THIS caller: it is handed a freshly read
   * build whose pages have never carried one. The folder version below
   * cannot assume that, because the build folder is written into and read
   * back, so it strips unconditionally. The difference is in the callers,
   * not in the rule. */

  const out = {};

  for (const [p, buf] of Object.entries(files)) {
    if (!isHtml(p)) {
      out[p] = buf;
      continue;
    }

    /* BUFFER IN, BUFFER OUT. siteFiles.js reads these as Buffers on purpose
     * — an image round-tripped through a string is a corrupt image — and
     * the deploy writes whatever it is given. Decoding a page to add a line
     * and encoding it again is safe for HTML and must not leak to the rest
     * of the map, which is why the branch above returns early. */
    const html = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);

    /* STRIPPED FIRST. A build folder that has been through the Rank Fast
     * edit screen already carries ITS tags, and a Cloudflare site publishing
     * from that folder would otherwise ship both — which Search Console
     * reads as a property verified by somebody else's code. The same reason
     * injectIntoDir() strips, arrived at from the other direction. */
    out[p] = Buffer.from(injectInto(stripVerification(html), meta), 'utf8');
  }

  return out;
}

/**
 * The same tags, written into a FOLDER of built pages.
 *
 * WHY A SECOND ENTRY POINT AND NOT A SECOND FILE — 17 November, Edwin: *"I
 * also need a way to add the verification for google search console"*, about
 * Rank Fast builds rather than Cloudflare ones.
 *
 * A Cloudflare site is published from a { path: Buffer } map, which is what
 * injectVerification() above takes. A Rank Fast build is a FOLDER —
 * dist/user_<id> — that is previewed where it stands and copied by
 * runProductionBuild into the ZIP. Different shape, identical rule, and the
 * rule is the fiddly part: which files count as pages, where in the <head>
 * the element goes, that a page already carrying the tags is left alone, and
 * that a page with no <head> is reported rather than repaired.
 *
 *     TWO CALLERS, ONE RULE. A second copy of injectInto() somewhere else
 *     is how the two products start disagreeing about what a verified page
 *     looks like — which is the mistake utils/domainPool.js exists after.
 *
 * WRITES IN PLACE, AND ONLY WHERE SOMETHING CHANGED. The build folder is
 * served directly as the preview, so rewriting a file whose content is
 * identical would churn its mtime for nothing — and currentSite.js reads an
 * mtime to tell the customer when their site was generated.
 *
 * _src/ IS SKIPPED. It holds content.json and build.json, which are not
 * pages and must never be treated as any — siteFiles.js refuses to publish
 * that folder for the same reason.
 *
 * @param {string} distDir  a built site's folder
 * @param {string[]} tags   tokens, already through parseVerificationTags
 * @returns {{written: string[], skipped: string[], headless: string[]}}
 */
function injectIntoDir(distDir, tags = []) {
  const out = { written: [], skipped: [], headless: [] };

  const meta = verificationMeta(tags);

  const walk = (dir) => {
    let entries = [];

    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }

    for (const entry of entries) {
      if (entry.name === '_src') continue;

      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) { walk(full); continue; }
      if (!isHtml(entry.name)) continue;

      let html = '';
      try { html = fs.readFileSync(full, 'utf8'); } catch (_) { continue; }

      /* STRIPPED FIRST, ALWAYS. Without this, clearing the box would leave
       * yesterday's tag in the pages — and changing the token would leave
       * BOTH, which Search Console reads as a property verified by somebody
       * else's code. Removing then adding is one path for all three cases:
       * set, change, clear. */
      const bare = stripVerification(html);

      let next = bare;

      if (meta) {
        next = injectInto(bare, meta);

        /* NO <head>, SO NOTHING WAS INSERTED — and this is checked BEFORE
         * "did anything change", which is the order the first draft had
         * backwards. A headless page with no tag comes out of injectInto
         * byte-identical, so the no-change test caught it first and filed
         * it under `skipped`: a generator bug reported as a page that did
         * not need anything.
         *
         * The strip above cannot have put a tag back, so `next === bare`
         * here means exactly one thing. */
        if (next === bare) { out.headless.push(full); continue; }
      }

      if (next === html) { out.skipped.push(full); continue; }

      try {
        fs.writeFileSync(full, next, 'utf8');
        out.written.push(full);
      } catch (_) {
        out.skipped.push(full);
      }
    }
  };

  walk(distDir);

  return out;
}

/**
 * Remove any google-site-verification elements this app wrote.
 *
 * NARROW BY NAME, NOT BY A BLANKET <meta> SWEEP. A page's head carries the
 * charset, the viewport, the description and the canonical; a regex loose
 * enough to catch "our" tag and careless enough to catch those would quietly
 * strip a site's SEO on every save.
 */
function stripVerification(html) {
  return String(html == null ? '' : html)
    .replace(/[ \t]*<meta\s+name=["']google-site-verification["'][^>]*>\n?/gi, '');
}

module.exports = {
  injectVerification, injectIntoDir, stripVerification,
  verificationMeta, injectInto, isHtml,
};
