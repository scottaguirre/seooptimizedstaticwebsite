const { slugify } = require('./slugify');

function stripMarkdownLinks(paragraph) {
  return paragraph.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

function injectPagesInterlinks(globalValues, pages, page, pagesInterlinks, sections) {
  const usedSlugs = new Set();
  const usedAnchorTexts = new Set();
  let totalLinksInjected = 0;
  const uniqueInterlinks = Array.from(new Set(pagesInterlinks));
  const MAX_BACKLINKS = Math.min(3, uniqueInterlinks.length);

  for (const key in sections) {
    const section = sections[key];

    section.paragraphs = section.paragraphs.map((paragraph, i) => {

      if (totalLinksInjected >= MAX_BACKLINKS) return stripMarkdownLinks(paragraph);
        paragraph = stripMarkdownLinks(paragraph);
        let originalParagraph = paragraph; // Keep copy in case we need to append

      if(i === 0){ // Only inject link in 1st paragraph [0] because of the prompt content
        
        for (const slug of uniqueInterlinks) {
          const normalizedSlug = slugify(slug);
          if (usedSlugs.has(normalizedSlug)) continue;
            
          if (slug === 'index') {
            const aboutAnchor = `<a href="index.html">${globalValues.businessName}</a>`;
            const regex = new RegExp(`(^|\\s)(${globalValues.businessName})(?=\\s|\\.|,|$)`, 'i');
       
            if (regex.test(paragraph)) {
              paragraph = paragraph.replace(regex, (match, leadingSpace, matchedText) => {
                return `${leadingSpace}<a href="index.html">${matchedText}</a>`;
              });

              usedSlugs.add(normalizedSlug);
              usedAnchorTexts.add(globalValues.businessName.toLowerCase());
              totalLinksInjected++;
              break;
    
            }else{
              // No match, but fallback allowed
              paragraph = `${originalParagraph}<p>Learn more about our company ${aboutAnchor}.</p>`;
              usedSlugs.add(normalizedSlug);
              usedAnchorTexts.add(globalValues.businessName.toLowerCase());
              totalLinksInjected++;
              break;
    
            }
    
          } else {
            const pageExist = pages.find(p => slugify(p.filename) === normalizedSlug);
            if (!pageExist) continue;
            if (slugify(page.filename) === normalizedSlug) continue; // Current page cannot interlink itself
    
            const baseAnchorText = slug; 
            const lowerText = baseAnchorText.toLowerCase();
            const href = `${normalizedSlug}-${slugify(globalValues.location)}.html`;
    
            if (usedAnchorTexts.has(lowerText)) continue;
    
            const escapedText = baseAnchorText.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const regex = new RegExp(`(^|\\s)(${escapedText})(?=\\s|\\.|,|$)`, 'i');
    
            if (regex.test(paragraph)) {
              paragraph = paragraph.replace(
                regex,
                (match, leadingSpace, matchedText) => `${leadingSpace}<a href="${href}">${matchedText}</a>`
              );
              
              usedSlugs.add(normalizedSlug);
              usedAnchorTexts.add(lowerText);
              totalLinksInjected++;
              break;
            } else {
              // No match, but fallback allowed
              paragraph = `${originalParagraph}<p>Learn more about our expert <a href="${href}">${baseAnchorText}</a> services.</p>`;
              usedSlugs.add(normalizedSlug);
              usedAnchorTexts.add(lowerText);
              totalLinksInjected++;
              break;
            }
          }
        }
  
      }  
  
      return paragraph;

    });
   
  }

  return sections;
}


module.exports = { injectPagesInterlinks };
