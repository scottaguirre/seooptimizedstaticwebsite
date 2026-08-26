// utils/injectPagesInterlinks.js
const { slugify } = require('./slugify');

function stripMarkdownLinks(paragraph) {
  return paragraph.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

/** Escape a string for use inside a RegExp. */
function escapeRe(value) {
  return String(value || '').replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

// Build a regex that matches either the hyphenated slug or the spaced form
function makeLooseSlugRegex(slug) {
  // Escape all regex meta-chars, then make '-' match hyphen or space
  const escaped = slug
    .replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
    .replace(/\\-/g, '[-\\s]');
  return new RegExp(`(^|\\s)(${escaped})(?=\\s|\\.|,|$)`, 'i');
}

/**
 * Targets arrive in one of two shapes.
 *
 *   'water-heater-repair'                       the classic ring
 *   { slug, href?, anchor? }                    the Rank Fast ring
 *
 * The classic ring lets this file work out the anchor and href from the slug,
 * which is right when every link of a given type looks the same. Rank Fast
 * needs the SAME target rendered differently depending on where it sits — the
 * home link is the business name on the first page and a naked URL on the
 * rest — so those entries carry their own.
 *
 * A string is normalised to { slug } and behaves exactly as it always has.
 * De-duplicated by slug, first occurrence wins.
 */
function normaliseTargets(list = []) {
  const seen = new Set();
  const out = [];

  for (const item of (list || [])) {
    const entry = (item && typeof item === 'object')
      ? { slug: String(item.slug || ''), href: item.href, anchor: item.anchor }
      : { slug: String(item || '') };

    if (!entry.slug || seen.has(entry.slug)) continue;
    seen.add(entry.slug);
    out.push(entry);
  }

  return out;
}

/** True when the anchor text is itself a URL, which reads differently in prose. */
function isUrlAnchor(text) {
  return /^https?:\/\//i.test(String(text || ''));
}

/**
 * The sentence appended when a link's anchor phrase is not already in the copy.
 *
 * A naked URL never appears in AI-written prose, so the home link on a Rank
 * Fast page ALWAYS lands here rather than being woven in. That makes the
 * wording worth caring about — it is what a visitor actually reads.
 */
function homeFallbackSentence(href, anchorText) {
  const link = `<a href="${href}">${anchorText}</a>`;

  return isUrlAnchor(anchorText)
    ? `Visit ${link} to see everything we do.`
    : `Learn more about our company ${link}.`;
}

/**
 * @param {object} [options]
 * @param {string} [options.homeAnchor]  text to link to the home page instead
 *        of the business name. The contact page uses "our plumbing company",
 *        because repeating the business name there and linking it competes
 *        with the page's actual job. An anchor carried on the target itself
 *        outranks this.
 */
function injectPagesInterlinks(
   globalValues,
   pages,
   page,
   pagesInterlinks,
   sections,
   mainLocation,
   options = {}
){

  const usedSlugs = new Set();
  const usedAnchorTexts = new Set();
  let totalLinksInjected = 0;

  const uniqueInterlinks = normaliseTargets(pagesInterlinks);
  const MAX_BACKLINKS = Math.min(3, uniqueInterlinks.length);

  // Determine current page identity (service or location)
  const currentServiceSlug = page && page.filename ? slugify(page.filename).replace(/\.html$/i, '') : null;
  const currentLocationSlug = page && page.slug ? slugify(page.slug) : null;


  for (const key in sections) {
    const section = sections[key];

    section.paragraphs = section.paragraphs.map((paragraph, i) => {
      if (totalLinksInjected >= MAX_BACKLINKS) return stripMarkdownLinks(paragraph);

      paragraph = stripMarkdownLinks(paragraph);
      const originalParagraph = paragraph;

      // Only inject into paragraph 0 of each section (your prompt constraint)
      if (i === 0) {
        for (const entry of uniqueInterlinks) {
          const slug = entry.slug;
          const normalizedSlug = slugify(slug);
          if (usedSlugs.has(normalizedSlug)) continue;

          // ----- Special case: index (About/Home) -----
          if (slug === 'index') {
            // Precedence: the anchor carried on the target, then the caller's
            // override, then the business name. Rank Fast sets the first;
            // the contact page sets the second; everything else falls through
            // to the third, as before.
            const homeAnchorText = entry.anchor || options.homeAnchor || globalValues.businessName;

            // href likewise: Rank Fast links home by absolute URL, everything
            // else by './' as it always has.
            const homeHref = entry.href || './';

            // Escape it: a business name can contain regex metacharacters —
            // "A+ Plumbing" would otherwise build a broken pattern.
            const regex = new RegExp(`(^|\\s)(${escapeRe(homeAnchorText)})(?=\\s|\\.|,|$)`, 'i');

            if (regex.test(paragraph)) {
              paragraph = paragraph.replace(regex, (match, leadingSpace, matchedText) => {
                return `${leadingSpace}<a href="${homeHref}">${matchedText}</a>`;
              });
            } else {
              // Fallback: append a short line carrying the link
              paragraph = `${originalParagraph}<p>${homeFallbackSentence(homeHref, homeAnchorText)}</p>`;
            }

            usedSlugs.add(normalizedSlug);
            usedAnchorTexts.add(String(homeAnchorText).toLowerCase());
            totalLinksInjected++;
            break;
          }

          // ----- Special case: contact -----
          //
          // Contact is neither a service page nor a location. Without this it
          // falls through to the location branch below and produces
          // location-contact.html, which does not exist.
          if (slug === 'contact') {
            const contactHref = entry.href || 'contact.html';

            if (entry.anchor) {
              // An exact anchor was specified — Rank Fast requires "Contact
              // Us" rather than whichever turn of phrase the model happened
              // to write. Link that phrase if the copy already contains it,
              // otherwise add it.
              const exact = new RegExp(`(^|\\s)(${escapeRe(entry.anchor)})(?=\\s|\\.|,|$)`, 'i');

              if (exact.test(paragraph)) {
                paragraph = paragraph.replace(
                  exact,
                  (match, leadingSpace, matchedText) =>
                    `${leadingSpace}<a href="${contactHref}">${matchedText}</a>`
                );
              } else {
                paragraph = `${originalParagraph}<p><a href="${contactHref}">${entry.anchor}</a> for a free, no-obligation quote.</p>`;
              }

            } else {
              // Prefer linking a natural phrase already in the copy.
              const contactRegex = /(^|\s)(contact us|get in touch|contact our team|contact)(?=\s|\.|,|$)/i;

              if (contactRegex.test(paragraph)) {
                paragraph = paragraph.replace(
                  contactRegex,
                  (match, leadingSpace, matchedText) =>
                    `${leadingSpace}<a href="${contactHref}">${matchedText}</a>`
                );
              } else {
                paragraph = `${originalParagraph}<p><a href="${contactHref}">Contact us</a> to talk through your project.</p>`;
              }
            }

            usedSlugs.add(normalizedSlug);
            usedAnchorTexts.add('contact');
            totalLinksInjected++;
            break;
          }

          // ----- Service vs Location detection -----
          const isService = !!pages.find(p => slugify(p.filename).replace(/\.html$/i, '') === normalizedSlug);
          const isSelfService = currentServiceSlug && currentServiceSlug === normalizedSlug;
          const isSelfLocation = currentLocationSlug && currentLocationSlug === normalizedSlug;

          if (isSelfService || isSelfLocation) continue; // no self-link

          // Anchor text de-dupe key (use spaced version for readability)
          const anchorKey = slug.replace(/-/g, ' ').toLowerCase();
          if (usedAnchorTexts.has(anchorKey)) continue;

          // Build href depending on type
          const href = entry.href || (isService
            ? `${normalizedSlug}-${slugify(mainLocation)}.html`
            : `location-${normalizedSlug}.html`);


          // Try to link natural occurrence (allow hyphen or space)
          const regex = makeLooseSlugRegex(slug);
          if (regex.test(paragraph)) {
            paragraph = paragraph.replace(
              regex,
              (match, leadingSpace, matchedText) => `${leadingSpace}<a href="${href}">${matchedText}</a>`
            );
          } else {
            // No natural match — append a small sentence
            const visible = entry.anchor || slug.replace(/-/g, ' ');
            const noun = isService ? 'services' : 'location';
            paragraph = `${originalParagraph}<p>Learn more about our ${isService ? 'expert ' : ''}<a href="${href}">${visible}</a> ${noun}.</p>`;
          }

          usedSlugs.add(normalizedSlug);
          usedAnchorTexts.add(anchorKey);
          totalLinksInjected++;
          break; // inject at most one link into this paragraph pass
        }
      }

      return paragraph;
    });
  }

  return sections;
}

module.exports = { injectPagesInterlinks };