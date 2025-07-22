const { OpenAI } = require('openai');
const openai = new OpenAI(); // assumes API key is in .env


async function buildInterlinksMap(pages) {
  // pages = ONLY the pages submitted by the user via form

  // Add slug to each page
  pages.forEach(p => {
    p.slug = p.filename.replace('.html', '');
  });

  const interlinkMap = {};
  const contentSlugs = pages.map(p => p.slug);

  // === Build index.html backlinking ===
  interlinkMap['index'] = Array.from(new Set(contentSlugs)).slice(0, 5); // About Us backlinks to first 5 user pages

  // === For each user page ===
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const currentSlug = page.slug;
    const linksTo = ['index'];

    const next1 = contentSlugs[(i + 1) % contentSlugs.length];
    const next2 = contentSlugs[(i + 2) % contentSlugs.length];
  
    linksTo.push(next1, next2);
    interlinkMap[currentSlug] = linksTo;
  }

  // === Generate synonym map for all target pages ===
  const seenKeywords = new Set();

  for (const targetSlugList of Object.values(interlinkMap)) {
    for (const slug of targetSlugList) {
      if (slug === 'index') continue;
      const page = pages.find(p => p.slug === slug);


      if (!page || !page.filename) continue;

      const keyword = page.filename.replace('.html', '').replace(/-/g, ' ').toLowerCase();

      if (seenKeywords.has(keyword)) continue;

      seenKeywords.add(keyword);

    }
  }

  return { interlinkMap };
}

module.exports = { buildInterlinksMap };
