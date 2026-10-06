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

const { isLocalBusiness, tradeOf, townOf } = require('./siteKind');

/**
 * @param {object} site        a BlogSite document (or its .business)
 * @param {object} targetPage  { url, keyword, title, intent }
 */
function buildContext(site = {}, targetPage = {}) {
    const business = site.business || site || {};

    /* THE DECISION IS MADE HERE, ONCE, AND CARRIED.
     *
     * Taken from the RAW business, before anything below can substitute a
     * value for a missing one, and passed down as `isLocal` so that no prompt
     * builder has to work it out again. Four of them would, and they would
     * eventually disagree. */
    const local = isLocalBusiness(business);

    // 'Leander, TX' -> 'Leander'. The prompts use this in sentences — "what
    // Central Texas hard water does" — where the state code reads as an address
    // rather than a place.
    const town = townOf(business);

    return {
      /* WHETHER THE LOCAL MACHINERY APPLIES AT ALL. Read by writePost and
       * suggestTopics; the anchor pool asks siteKind directly, because it is
       * built from the stored business and never sees a ctx. */
      isLocal: local,

      business: {
        /* EMPTY RATHER THAN A PLACEHOLDER, and this is the bug that made the
         * whole thing necessary.
         *
         * These used to read `|| 'the business'` and `|| 'trade'`. On a site
         * with no trade set, the writer's prompt was handed the line
         *
         *     Trade:    trade
         *
         * — the literal word, presented as a fact about the business. The
         * placeholders existed so a prompt would never read "undefined",
         * which is a real problem with a worse solution: an invented value is
         * harder to spot than a missing one, because it looks like data.
         *
         * Nothing interpolates these blindly any more. Both prompt builders
         * now print only the fields that hold something, so an empty string
         * produces no line at all rather than a labelled blank — and a
         * labelled blank is itself a claim that the value exists. */
        name: String(business.name || '').trim(),
        trade: tradeOf(business),
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