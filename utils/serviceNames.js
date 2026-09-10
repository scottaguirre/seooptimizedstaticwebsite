// utils/serviceNames.js
//
// Two checks on the list of service pages someone is about to buy.
//
// WHY THESE TWO ARE DIFFERENT PROBLEMS
//
// The first is a bug that loses work. The second is advice.
//
//   1. COLLISION — two services that produce the same filename. The page is
//      written twice to one path and the first one is gone. The customer paid
//      100 credits for a page that does not exist, and nothing anywhere said
//      so. This is refused.
//
//   2. OVERLAP — two services that mean roughly the same thing. Both pages
//      get written, both get charged, and they compete with each other in
//      search: Google folds near-identical pages together and shows one, so
//      the second is money spent on a page that cannot rank. This is a
//      WARNING, not a refusal, because "Water Heater Repair" and "Tankless
//      Water Heater Repair" score as similar and are a perfectly reasonable
//      pair of pages to want.
//
// WHY THE OVERLAP CHECK IS THE BLOG ENGINE'S
//
// utils/blog/planCampaign.js already refuses to let two blog posts chase the
// same search term, and exports compareQueries for exactly this kind of
// reuse. Writing a second, slightly different similarity check here would
// mean two definitions of "too alike" that drift apart.
//
// It is worth being plain about what that comparator does and does not catch,
// because it is a token-overlap test, not a meaning test:
//
//   caught      Water Heater Repair / Water Heater Repairs        (1.00)
//               Water Heater Repair / Emergency Water Heater Repair (0.75)
//               Drain Cleaning / Drain Cleaning Services          (0.67)
//               Pipe Redesign Services / Pipe Replacement Services (0.60)
//
//   not caught  AC Repair / Air Conditioning Repair
//               Repiping / Pipe Replacement
//
//   correctly
//   left alone  Toilet Repair / Toilet Installation
//               Commercial Plumbing / Residential Plumbing
//
// So it catches restatements and misses synonyms. Catching synonyms needs
// embeddings or a trade vocabulary, which is a much larger thing; this net is
// worth having in the meantime, and it does not cry wolf.

const { slugify } = require('./slugify');
const { compareQueries } = require('./blog/planCampaign');

/**
 * Services whose names produce the same filename.
 *
 * The check that used to be here compared the lowercased text, which is not
 * the same thing at all: slugify strips commas and punctuation, so
 * "Drain Cleaning" and "Drain, Cleaning" are different strings and one file.
 *
 * @param {string[]} names
 * @returns {Array<{ slug: string, indexes: number[], names: string[] }>}
 */
function slugCollisions(names = []) {
  const bySlug = new Map();

  names.forEach((raw, index) => {
    const name = String(raw || '').trim();
    if (!name) return;

    const slug = slugify(name);
    if (!slug) return;

    if (!bySlug.has(slug)) bySlug.set(slug, []);
    bySlug.get(slug).push({ index, name });
  });

  const out = [];
  for (const [slug, entries] of bySlug) {
    if (entries.length > 1) {
      out.push({
        slug,
        indexes: entries.map(e => e.index),
        names: entries.map(e => e.name),
      });
    }
  }

  return out;
}

/**
 * Pairs of services that look like the same page.
 *
 * @param {string[]} names
 * @param {number} [threshold] token overlap at which two names are "alike"
 * @returns {Array<{ a: number, b: number, names: [string, string], detail: string }>}
 */
function similarServices(names = [], threshold = 0.6) {
  const items = names
    .map((raw, index) => ({ id: index, targetQuery: String(raw || '').trim() }))
    .filter(item => item.targetQuery);

  if (items.length < 2) return [];

  // No money keyword: 'cannibalises' is about a blog post competing with the
  // service page it promotes, which has no meaning between two service pages.
  // Only the pairwise 'duplicate' verdict applies here.
  return compareQueries(items, '', threshold)
    .filter(conflict => conflict.kind === 'duplicate' && conflict.b !== undefined && conflict.b !== null)
    .map(conflict => ({
      a: conflict.a,
      b: conflict.b,
      names: [names[conflict.a], names[conflict.b]],
      detail: conflict.detail,
    }));
}

/** A sentence a customer can act on, or '' when there is nothing to say. */
function collisionMessage(collisions = []) {
  if (!collisions.length) return '';

  const first = collisions[0];
  return `“${first.names[0]}” and “${first.names[1]}” would both become the same page `
       + `(${first.slug}.html), so one would overwrite the other. Please rename one of them.`;
}

/** The same, for the softer case. */
function overlapMessage(pairs = []) {
  if (!pairs.length) return '';

  const first = pairs[0];
  const more = pairs.length > 1
    ? ` (and ${pairs.length - 1} other ${pairs.length - 1 === 1 ? 'pair' : 'pairs'})`
    : '';

  return `“${first.names[0]}” and “${first.names[1]}” look like the same service${more}. `
       + `Two pages about one thing compete with each other in search, so usually only one `
       + `of them ranks — and you would be paying for both.`;
}

module.exports = {
  slugCollisions,
  similarServices,
  collisionMessage,
  overlapMessage,
};
