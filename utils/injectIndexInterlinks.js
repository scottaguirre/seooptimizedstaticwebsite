const { slugify } = require('./slugify');

function stripMarkdownLinks(paragraph) {
  return paragraph.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

/**
 * Tidy a paragraph so another sentence can follow it.
 *
 * Trailing whitespace goes, and a full stop is added when the paragraph does
 * not already end in terminating punctuation — otherwise the appended sentence
 * runs straight on from the last word.
 */
function appendSentence(paragraph) {
  const text = String(paragraph || '').trim();
  if (!text) return '';
  return /[.!?:;]$/.test(text) ? text : `${text}.`;
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
          // A design sample has no service pages, so interlinks return to
          // the sample rather than pointing at files that were never built.
          const href = globalValues.siteMode === 'sample'
            ? './'
            : `${normalizedSlug}-${slugify(globalValues.location)}.html`;
  
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
            // No match, so the link is appended as a SENTENCE, not a new
            // paragraph.
            //
            // This used to append `<p>Learn more...</p>`. Every consumer of
            // these strings already wraps them — the template writes
            // <p>{{SECTION2_P2}}</p> — so the result was
            // <p>text<p>Learn more...</p></p>: a block element nested inside a
            // paragraph, which is invalid HTML. Browsers "repair" it by
            // closing the outer <p> early, so the markup a validator sees, the
            // DOM a browser builds and the tree the WordPress exporter walks
            // are three different shapes.
            paragraph = `${appendSentence(originalParagraph)} Learn more about our <a href="${href}">${baseAnchorText}</a> services.`;
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

module.exports = { injectIndexInterlinks, appendSentence };