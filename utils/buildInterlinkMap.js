const { slugify } =  require('./slugify');

function buildInterlinkMap(pages) {
    
    // Add .slug to each page
    pages.forEach(page => {
      page.slug = slugify(page.filename.replace('.html', ''));
    });
  

    const contentSlugs = contentPages.map(p => p.slug);
  
    const interlinkMap = {};
  
    pages.forEach((page) => {
      const currentSlug = page.slug;
      const linksTo = [];
  
      if (currentSlug === 'index') {
        // Link to up to 5 content pages
        linksTo.push(...contentSlugs.slice(0, 5));
      } else {
        // Link to index
        linksTo.push('index');
  
        // Link to next 2 content pages circularly
        const currentIndex = contentSlugs.indexOf(currentSlug);
        if (currentIndex !== -1) {
          const next1 = contentSlugs[(currentIndex + 1) % contentSlugs.length];
          const next2 = contentSlugs[(currentIndex + 2) % contentSlugs.length];
          linksTo.push(next1, next2);
        }
      }
  
      interlinkMap[currentSlug] = linksTo;
    });
  
    return interlinkMap;
  }
  
  module.exports = { buildInterlinkMap };
  