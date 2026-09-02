// utils/blog/context.js
//
// The `ctx` object every engine file takes.
//
// writePost, suggestTopics and enrichTopics all read the same two things —
// ctx.business and ctx.targetPage — and each has its own expectations about
// the shape. Built in one place because they must agree: suggestTopics and
// enrichTopics both interpolate `business.services.join(', ')`, so an absent
// array is a TypeError rather than a missing sentence, and writePost's prompt
// says "a link to the ${targetPage.title} page", which reads as "the undefined
// page" when the title is missing.
//
// Derived from a BlogSite rather than passed around, so there is one mapping
// from what the plugin reported to what the prompts expect.

/**
 * @param {object} site        a BlogSite document (or its .business)
 * @param {object} targetPage  { url, keyword, title, intent }
 */
function buildContext(site = {}, targetPage = {}) {
    const business = site.business || site || {};
  
    // 'Leander, TX' -> 'Leander'. The prompts use this in sentences — "what
    // Central Texas hard water does" — where the state code reads as an address
    // rather than a place.
    const town = String(business.location || '').replace(/,\s*[A-Z]{2}$/, '').trim();
  
    return {
      business: {
        name: String(business.name || '').trim() || 'the business',
        trade: String(business.type || '').trim() || 'trade',
        town,
        // ALWAYS an array. suggestTopics and enrichTopics both call .join() on
        // it without checking, so undefined here is a crash inside a prompt
        // builder, several frames from anything that explains why.
        services: [targetPage.keyword, business.type]
          .map(s => String(s || '').trim())
          .filter(Boolean)
          .filter((s, i, all) => all.indexOf(s) === i),
      },
  
      targetPage: {
        url: String(targetPage.url || ''),
        keyword: String(targetPage.keyword || ''),
        // Falls back to the keyword. Every prompt interpolates this.
        title: String(targetPage.title || targetPage.keyword || ''),
        intent: String(targetPage.intent || ''),
      },
    };
  }
  
  module.exports = { buildContext };