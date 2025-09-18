// utils/injectPagesInterlinks.js
const { slugify } = require('./slugify');

function stripMarkdownLinks(paragraph) {
  return paragraph.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

// Build a regex that matches either the hyphenated slug or the spaced form
function makeLooseSlugRegex(slug) {
  // Escape all regex meta-chars, then make '-' match hyphen or space
  const escaped = slug
    .replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
    .replace(/\\-/g, '[-\\s]');
  return new RegExp(`(^|\\s)(${escaped})(?=\\s|\\.|,|$)`, 'i');
}

function injectPagesInterlinks(
   globalValues,
   pages,
   page,
   pagesInterlinks,
   sections,
   mainLocation
){

  const usedSlugs = new Set();
  const usedAnchorTexts = new Set();
  let totalLinksInjected = 0;

  const uniqueInterlinks = Array.from(new Set(pagesInterlinks));
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
        for (const slug of uniqueInterlinks) {
          const normalizedSlug = slugify(slug);
          if (usedSlugs.has(normalizedSlug)) continue;

          // ----- Special case: index (About/Home) -----
          if (slug === 'index') {
            const aboutAnchor = `<a href="index.html">${globalValues.businessName}</a>`;
            const regex = new RegExp(`(^|\\s)(${globalValues.businessName})(?=\\s|\\.|,|$)`, 'i');

            if (regex.test(paragraph)) {
              paragraph = paragraph.replace(regex, (match, leadingSpace, matchedText) => {
                return `${leadingSpace}<a href="index.html">${matchedText}</a>`;
              });
            } else {
              // Fallback: append small line with link
              paragraph = `${originalParagraph}<p>Learn more about our company ${aboutAnchor}.</p>`;
            }

            usedSlugs.add(normalizedSlug);
            usedAnchorTexts.add(globalValues.businessName.toLowerCase());
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
          const href = isService
            ? `${normalizedSlug}-${slugify(mainLocation)}.html`
            : `location-${normalizedSlug}.html`;
        

          // Try to link natural occurrence (allow hyphen or space)
          const regex = makeLooseSlugRegex(slug);
          if (regex.test(paragraph)) {
            paragraph = paragraph.replace(
              regex,
              (match, leadingSpace, matchedText) => `${leadingSpace}<a href="${href}">${matchedText}</a>`
            );
          } else {
            // No natural match — append a small sentence
            const visible = slug.replace(/-/g, ' ');
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
