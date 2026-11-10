// utils/reuseModel.js
//
// A stored content.json, turned back into the shapes the generators return.
//
//   const reuse = reuseFrom(model);
//   reuse.pageContent('ac-repair-leander-tx')  ->  { section1: {...}, ... }
//   reuse.faqs()                               ->  [ { question, answer } ]
//
// WHAT THIS IS FOR
//
// Editing a published site. Today the only way to change one word is to
// generate the whole site again — which calls the model eleven ways, comes
// back with DIFFERENT copy, and charges for it. The blog side solved this
// years-equivalent ago and its own comment says why:
//
//     THE WORDS WERE PAID FOR ONCE.
//     FIXING A SENTENCE IS NOT NEW WORDS.
//
// A blog can do that because Mongo holds the article. A website cannot,
// because the only record of its words is `_src/content.json` inside
// dist/user_<id>, which the next build wipes.
//
//
// WHY THE INVERSE LIVES HERE AND NOT BESIDE EACH GENERATOR
//
// contentModel.js knows how to turn generator output INTO a model section.
// This file is the other direction, and the two have to agree exactly — so
// they are tested as a round trip rather than as two independent readings of
// the same shape. test-reuse-model.js builds a model with contentModel's own
// functions and asserts this gets back what went in. A field added to one
// side and not the other fails there rather than on a customer's page.
//
//
// WHAT IT DELIBERATELY DOES NOT COVER: generateReview
//
// That one makes a model call per service page and returns an invented
// reviewer with a fabricated five-star rating, which goes into the page's
// JSON-LD. Nothing records it in content.json, so there is nothing here to
// return — and a re-render therefore still calls it.
//
//     SO A RE-RENDER IS NOT FREE. It is one model call per service page,
//     not eleven kinds across the site. Anything that tells a customer
//     "nothing is charged" is wrong by that much, and the screens that
//     say so should say this instead.
//
// Edwin, 7 November, asked for it to be left as it is for now. It is named
// here so the next person reading this file knows the gap is known rather
// than missed.
//
//
// INTERLINKS ARE ALREADY IN THE TEXT
//
// The paragraphs stored in content.json are POST-injection: they carry the
// <a href> tags injectPagesInterlinks() put there, because the model is
// built from `sectionsWithLinks` rather than from the raw generator output.
//
// So a caller using this must NOT run the injector again — it would strip
// nothing, find the phrases already linked, and nest anchors. The injector's
// other job, stripMarkdownLinks(), is also already done. See the note at its
// call site in runGeneration.js for why it normally runs in every mode.

'use strict';

/**
 * The model shapes this file can read.
 *
 * CHECKED RATHER THAN ASSUMED. contentModel.js stamps a version precisely so
 * that something reading an old file knows which shape it is holding, and the
 * cost of guessing wrong is a re-render that quietly drops whatever moved.
 * An unknown version means "generate normally", not "try anyway".
 */
const SUPPORTED_VERSIONS = [1];

/**
 * Model section key -> the name the generator uses for it.
 *
 * ALMOST ALL OF THEM ARE IDENTICAL, and the one that is not is the reason
 * this map exists. The About page's "Near Me" block is `section5` coming out
 * of the generator and `nearMe` in the model — renamed on the way in, because
 * `nearMe` is what a WordPress admin panel has to be labelled. Read back
 * without this, section5 comes out undefined and the block silently vanishes
 * from an edited page.
 */
const SECTION_ALIASES = {
  nearMe: 'section5',
};

/** `{heading, subheading, paragraphs}`, the shape every generator returns. */
function sourceOf(section) {
  const out = {
    heading: String((section && section.heading) || ''),
    paragraphs: Array.isArray(section && section.paragraphs)
      ? section.paragraphs.map(String)
      : [],
  };

  /* ONLY WHEN THERE IS ONE. contentModel.js omits `subheading` rather than
   * storing an empty string, and a generator shape carrying `subheading: ''`
   * renders an empty element where the original rendered nothing. */
  if (section && section.subheading) out.subheading = String(section.subheading);

  /* THE TRUST POINTS COME BACK TOO, AND LEAVING THEM OUT WAS A REAL BUG.
   *
   * The About page's ticked list is stored on section1 — buildAboutUsPage
   * attaches it with an Object.assign over CM.section() so the WordPress
   * export keeps it — but this function returned only heading, subheading
   * and paragraphs. A re-render therefore handed buildTrustList()
   * `undefined`, which answers '' for an empty list, and {{SECTION1_LIST}}
   * was replaced with nothing.
   *
   *     THE EIGHT BULLETS DISAPPEARED AND NOTHING SAID SO. No throw, no log
   *     line; the page simply came back one block shorter.
   *
   * Measured against a real content.json on 8 November — 8 points stored, 0
   * after the round trip — rather than reasoned about. The header of this
   * file already says the two directions "have to agree exactly". This is
   * what it costs when they quietly do not.
   *
   * Guarded on `.length` for the same reason subheading is guarded above:
   * contentModel attaches the key only when there is something in it, and a
   * generator shape carrying `trustPoints: []` is not one any generator
   * returns. */
  if (Array.isArray(section && section.trustPoints) && section.trustPoints.length) {
    out.trustPoints = section.trustPoints.map(String);
  }

  return out;
}

/**
 * @param {object} model  a parsed content.json
 * @returns {object|null} null when the model is missing, empty or a version
 *          this file does not understand — in which case the caller must
 *          generate normally rather than render half a site.
 */
function reuseFrom(model) {
  /* ONE CHECK, NOT TWO, AND THE SECOND ONE WAS DELETED ON PURPOSE.
   *
   * This read `if (!model || 'object' !== typeof model) return null;` first.
   * Mutation testing killed it: removing that line changed no test, because
   * anything that is not a model — a string, an array, a number — has no
   * `.version`, so `Number(undefined)` is NaN and the version check below
   * refuses it anyway.
   *
   * Same reasoning as the existsSync that was taken out of wranglerEntry():
   * a line no test can protect is a line that reads as safety and is not. */
  if (!model || !SUPPORTED_VERSIONS.includes(Number(model.version))) return null;

  const pages = Array.isArray(model.pages) ? model.pages : [];
  if (!pages.length) return null;

  const bySlug = new Map();
  for (const page of pages) {
    if (page && page.slug) bySlug.set(String(page.slug), page);
  }

  const byType = (type) => pages.filter(p => p && p.type === type);

  /** Every section of one page, keyed the way the model keyed it. */
  function sectionsOf(slug) {
    const page = bySlug.get(String(slug));
    if (!page) return null;

    const out = new Map();
    for (const s of page.sections || []) {
      if (s && s.key) out.set(String(s.key), s);
    }
    return out;
  }

  /** One named section of one page, or null. */
  function sectionOf(slug, key) {
    const all = sectionsOf(slug);
    return all ? (all.get(key) || null) : null;
  }

  /**
   * The `{ section1: {...}, section2: {...} }` object the page-content
   * generators return.
   *
   * NULL WHEN section1 IS MISSING, which is the same guard runGeneration
   * applies to the live generator's output: a page without it is a page
   * whose content did not come back, and rendering it produces a shell.
   */
  function pageContent(slug) {
    const all = sectionsOf(slug);
    if (!all) return null;

    const out = {};

    for (const [key, section] of all) {
      const name = SECTION_ALIASES[key] || key;
      if (!/^section[1-9]$/.test(name)) continue;

      out[name] = sourceOf(section);
    }

    return out.section1 && out.section1.paragraphs.length ? out : null;
  }

  /** The first page of a type, for the ones there is only ever one of. */
  function firstOfType(type) {
    const found = byType(type)[0];
    return found && found.slug ? String(found.slug) : null;
  }

  /**
   * One page's FAQ, in the shape its generator returned.
   *
   * SHARED BY THE HOME PAGE AND EVERY TOWN, because contentModel stores both
   * as a `faq` section with the same `faqs: [{question, answer}]` array. Two
   * readers would be two chances to disagree about one shape.
   */
  function faqsOf(slug) {
    const section = slug && sectionOf(slug, 'faq');

    return section && Array.isArray(section.faqs) && section.faqs.length
      ? section.faqs.map(f => ({ question: String(f.question), answer: String(f.answer) }))
      : null;
  }

  return {
    version: Number(model.version),
    global: model.global || {},

    /** Slugs, by type, so a caller can ask what this model actually holds. */
    slugs: (type) => (type ? byType(type) : pages).map(p => String(p.slug || '')).filter(Boolean),

    has: (slug) => bySlug.has(String(slug)),
    page: (slug) => bySlug.get(String(slug)) || null,
    section: sectionOf,
    pageContent,

    /** generateAboutUsContent's shape, from the stored About page. */
    aboutContent() {
      const slug = firstOfType('about');
      return slug ? pageContent(slug) : null;
    },

    /** generateContactContent's `{heading, paragraphs}`. */
    contactIntro() {
      const slug = firstOfType('contact');
      if (!slug) return null;

      const section = sectionOf(slug, 'contactIntro');
      if (!section) return null;

      const out = sourceOf(section);
      return out.paragraphs.length ? out : null;
    },

    /** generateLocationPagesContent's shape, for one location page. */
    locationContent: (slug) => pageContent(slug),

    /* ---- the About page's five generated blocks ---- */

    /** generateFaqAnswers: [{question, answer}] — the About page's. */
    faqs() {
      return faqsOf(firstOfType('about'));
    },

    /**
     * generateLocationFaq: [{question, answer}] — one town's.
     *
     * SAME SHAPE, DIFFERENT GENERATOR AND A DIFFERENT PAGE. The home page's
     * questions come from a People Also Ask lookup; a town's are written from
     * that page's angle, because Google has no question data for a small town
     * and returns the state's block. Both land in a `faq` section, so one
     * reader serves both.
     *
     * THE SLUG IS THE MODEL'S, NOT THE TOWN'S. buildLocationPages stores
     * `location-<slug>` while the loop's own key is the bare slug, so a
     * caller passing the wrong one gets null and silently regenerates — the
     * expensive kind of quiet.
     */
    locationFaqs: (slug) => faqsOf(slug),

    /** generateServiceCards: [{name, line}] */
    serviceCards() {
      const slug = firstOfType('about');
      const section = slug && sectionOf(slug, 'serviceCards');

      return section && Array.isArray(section.cards) && section.cards.length
        ? section.cards.map(c => ({ name: String(c.name), line: String(c.line || '') }))
        : null;
    },

    /** generatePricing: [{name, low, high, unit, note}] */
    pricing() {
      const slug = firstOfType('about');
      const section = slug && sectionOf(slug, 'pricing');

      return section && Array.isArray(section.pricing) && section.pricing.length
        ? section.pricing.map(r => ({
            name: String(r.name),
            low: Number(r.low),
            high: Number(r.high),
            unit: String(r.unit || 'per job'),
            note: String(r.note || ''),
          }))
        : null;
    },

    /** generateCaseStudy: {heading, paragraphs} — a plain TEXT section. */
    caseStudy() {
      const slug = firstOfType('about');
      const section = slug && sectionOf(slug, 'caseStudy');
      if (!section) return null;

      const out = sourceOf(section);
      return out.heading && out.paragraphs.length ? out : null;
    },

    /** generateSampleReviews: {heading, note, reviews:[{name, stars, text}]} */
    sampleReviews() {
      const slug = firstOfType('about');
      const section = slug && sectionOf(slug, 'reviews');
      if (!section || !Array.isArray(section.reviews) || !section.reviews.length) return null;

      return {
        heading: String(section.heading || ''),
        /* `note` IS THE LINE THAT SAYS THESE ARE SAMPLES. contentModel.js
         * carries it deliberately — "a section that loses it on export is
         * four unlabelled five-star reviews with a real business's name on
         * them" — and a re-render that dropped it would do exactly that. */
        note: String(section.note || ''),
        reviews: section.reviews.map(r => ({
          name: String(r.name || ''),
          stars: Number(r.stars) || 0,
          text: String(r.text || ''),
        })),
      };
    },
  };
}

module.exports = { reuseFrom, sourceOf, SECTION_ALIASES, SUPPORTED_VERSIONS };
