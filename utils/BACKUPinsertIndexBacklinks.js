const { slugify } = require('./slugify');

function stripMarkdownLinks(paragraph) {
  return paragraph.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

function insertIndexBacklinks(paragraphs, indexInterlinks, pages, synonymMap, location) {
  const usedSlugs = new Set(); // ✅ Tracks which slugs we've already injected
  const usedAnchorTexts = new Set(); // ✅ Prevents duplicate exact match
  const MAX_BACKLINKS = Math.min(5, pages.length);
  let totalLinksInjected = 0;

  const uniqueInterlinks = Array.from(new Set(indexInterlinks));

  return paragraphs.map(paragraph => {
    if (totalLinksInjected >= MAX_BACKLINKS) return stripMarkdownLinks(paragraph);
    paragraph = stripMarkdownLinks(paragraph);

    outerLoop:
    for (const slug of uniqueInterlinks) {
      const normalizedSlug = slugify(slug);
      if (usedSlugs.has(normalizedSlug)) continue; // ✅ Already injected this slug

      const page = pages.find(p => slugify(p.filename.replace('.html', '')) === normalizedSlug);
      if (!page) continue;

      const baseAnchorText = page.filename.replace('.html', '').replace(/-/g, ' ');
      const synonyms = synonymMap[slug] || [];
      const anchorTexts = [baseAnchorText, ...synonyms];

      for (const text of anchorTexts) {
        const lowerText = text.toLowerCase();
        if (usedAnchorTexts.has(lowerText)) continue;

        const escapedText = text.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp(`(^|\\s)(${escapedText})(?=\\s|\\.|,|$)`, 'i');

        if (regex.test(paragraph)) {
          const href = `${normalizedSlug}-${slugify(location)}.html`;
          paragraph = paragraph.replace(regex, `$1<a href="${href}">$2</a>`);

          usedSlugs.add(normalizedSlug);      // ✅ Block further links to this slug
          usedAnchorTexts.add(lowerText);     // ✅ Block reusing the same anchor
          totalLinksInjected++;
          break;                    // ✅ Stop scanning this paragraph
        }
      }
    }

    return paragraph;
  });
}

module.exports = { insertIndexBacklinks };
