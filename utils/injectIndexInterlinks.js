const { slugify } = require('./slugify');

function stripMarkdownLinks(paragraph) {
  return paragraph.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

function injectIndexInterlinks(globalValues, pages, indexInterlinks, sections) {
  const usedSlugs = new Set(); // ✅ Tracks which slugs we've already injected
  const usedAnchorTexts = new Set(); // ✅ Prevents duplicate exact match
  let totalLinksInjected = 0;
  const MAX_BACKLINKS = Math.min(5, pages.length);
  const uniqueInterlinks = Array.from(new Set(indexInterlinks));

  for (const key in sections) {
    const section = sections[key];

    section.paragraphs = section.paragraphs.map((paragraph, i) => {

      if (totalLinksInjected >= MAX_BACKLINKS) return stripMarkdownLinks(paragraph);
      paragraph = stripMarkdownLinks(paragraph);
      let originalParagraph = paragraph; // Keep copy in case we need to append

      if(i === 1){ // Only inject link in 2nd paragraph [1] as per prompt content
        
        for (const slug of uniqueInterlinks) {
          const normalizedSlug = slugify(slug);
          if (usedSlugs.has(normalizedSlug)) continue; // ✅ Already injected this slug
    
          const page = pages.find(p => slugify(p.filename.replace('.html', '')) === normalizedSlug);
          if (!page) continue;
    
          const baseAnchorText = page.filename.replace('.html', '').replace(/-/g, ' ');
    
          const lowerText = baseAnchorText.toLowerCase();
    
          if (usedAnchorTexts.has(lowerText)) continue;
    
          const escapedText = baseAnchorText.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          const regex = new RegExp(`(^|\\s)(${escapedText})(?=\\s|\\.|,|$)`, 'i');
          const href = `${normalizedSlug}-${slugify(globalValues.location)}.html`;
    a
          if (regex.test(paragraph)) {
            paragraph = paragraph.replace(
              regex,
              (match, leadingSpace, matchedText) => {
                return `${leadingSpace}<a href="${href}">${matchedText}</a>`;
              }
            );

    
            usedSlugs.add(normalizedSlug);      // ✅ Block further links to this slug
            usedAnchorTexts.add(lowerText);     // ✅ Block reusing the same anchor
            totalLinksInjected++;
            break;
                                   // ✅ Stop scanning this paragraph
          } else{
            // No match, but fallback allowed
            paragraph = `${originalParagraph}<p>Learn more about our <a href="${href}">${baseAnchorText}</a> services.</p>`;
            usedSlugs.add(normalizedSlug);
            usedAnchorTexts.add(lowerText);
            totalLinksInjected++;
            break;
          }
          
        }

      }   

      return paragraph;

    });

  }

  return sections;
}

module.exports = { injectIndexInterlinks };
