// blog-engine-preview/planCampaign.js
//
// The whole link graph, computed before a single word is written.
//
// THE SHAPE
//
//                     money page          <- every post links here
//                    ^  ^   ^  ^
//     post 1 <-> post 2 <-> post 3 <-> post 4
//        ^                               |
//        +-------------------------------+       last closes the ring
//
// Every link that points BACKWARDS in time is live the moment it is written,
// because its target already exists. Only the forward link waits, and it waits
// as marked plain text rather than as a broken URL.
//
// A PILLAR CAMPAIGN IS THE SAME SHAPE WITH THE TOP ROW REMOVED:
//
//     post 1 <-> post 2 <-> post 3 <-> post 4
//        ^                               |
//        +-------------------------------+       last closes the ring
//
// It writes the hub articles a later campaign will point AT, so there is no
// money page to point at yet. The ring is untouched — it was never built from
// targetPage — and because pillars never link down to their children, every
// link in both diagrams is written once and never revisited.
//
// This file is pure: same input, same plan, no I/O, no model calls. It is the
// piece that moves to production unchanged.

const { allocateAnchorTypes, pickAnchors, DEFAULT_MIX } = require('./anchors');

/**
 * WordPress-compatible slug.
 *
 * Apostrophes are DELETED, not turned into separators. Without this,
 * "Leander's Hard Water" becomes "leander-s-hard-water" — the stray "s"
 * reads as a typo in the URL, and it is the kind of detail that makes a site
 * look automated. Same for the curly apostrophe a model actually emits.
 *
 * AND THE LENGTH CUT STOPS AT A WORD BOUNDARY — fixed 4 October, found by
 * reading a live pillar post rather than by any test. `.slice(0, 70)` alone
 * cut the 70th character wherever it fell, and on a real post it fell inside
 * a word:
 *
 *   /what-information-do-you-need-for-a-loan-application-a-complete-prepara/
 *
 * "preparation" became "prepara". Exactly 70 characters, so it was that line
 * and nothing else. The same reasoning as the apostrophe rule three lines
 * above: a URL ending mid-word reads as machine output, and the URL is one of
 * the few parts of a page a person reads before clicking it.
 */
const SLUG_MAX = 70;

function slugify(text) {
  const clean = String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’ʼ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  /* UNDER THE LIMIT IS RETURNED UNTOUCHED, and that branch is the whole
   * reason this is not a one-line regex. Trimming to the last dash
   * unconditionally would delete the final word of every short slug. */
  if (clean.length <= SLUG_MAX) {
    return clean;
  }

  const cut = clean.slice(0, SLUG_MAX);

  /* THE CUT MAY ALREADY BE ON A BOUNDARY, AND BACKING UP THEN THROWS AWAY A
   * WHOLE WORD FOR NOTHING. Found on 4 October by reading a slug this very
   * function had just produced on the live site:
   *
   *   title  Benefits of Paying Off a Loan Early—and When It May Not Make
   *          Financial Sense
   *   clean  …-may-not-make-financial-sense            (76)
   *   cut    …-may-not-make-financial                  (70, and clean[70] is '-')
   *   got    …-may-not-make                            (60)
   *
   * "financial" fitted exactly. The character after the cut was the
   * separator, so nothing was broken — and the trim ran anyway and deleted
   * it, because the first version of this could not tell "the cut landed
   * mid-word" from "the cut landed on the join".
   *
   * One character of lookahead settles it. THE TEST THAT MISSED THIS asserted
   * the slug was a maximal prefix, and it was: no word could be ADDED. It
   * never asked whether a word had been removed that did not need removing. */
  if ('-' === clean.charAt(SLUG_MAX)) {
    return cut;
  }

  const lastDash = cut.lastIndexOf('-');

  /* A SINGLE WORD LONGER THAN THE LIMIT KEEPS THE HARD CUT — lastIndexOf
   * answers -1 and a truncated word beats no slug at all, because WordPress
   * handed '' invents one from the post id.
   *
   * `> 0` RATHER THAN `>= 0` GUARDS NOTHING REACHABLE, and saying so is the
   * point. Position 0 cannot hold a dash: leading separators are stripped
   * four lines up. Mutating this to `>= 0` changes no behaviour and survives
   * the suite, correctly. It stays as `> 0` because it costs nothing and the
   * day somebody removes the leading-dash strip, returning '' would be the
   * silent failure. Written down because an unexplained guard invites the
   * next reader to write a test for a case that cannot happen. */
  return lastDash > 0 ? cut.slice(0, lastDash) : cut;
}

/** Make slugs unique within the campaign without silently colliding. */
function uniqueSlugs(topics) {
  const seen = new Map();
  return topics.map(t => {
    const base = slugify(t.slug || t.title || t.topic);
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n + 1}`;
  });
}

/**
 * @param {object}   input
 * @param {Array}    input.topics        [{ topic, title? }] in publish order
 * @param {object}   input.targetPage    { url, keyword, title }
 * @param {object}   input.business      { name, town, service }
 * @param {object}  [input.anchorPool]   { exact:[], semantic:[], descriptive:[], branded:[] }
 * @param {Set}     [input.usedAnchors]  anchors already pointing at targetPage
 * @param {object}  [input.mix]          override the anchor shares
 * @param {Date}    [input.startDate]
 * @param {number}  [input.everyDays]    cadence; 7 = weekly
 * @param {boolean} [input.isPillar]     no money page: the ring, and nothing else
 */
function planCampaign(input) {
  const {
    topics = [],
    targetPage,
    business,
    anchorPool,
    usedAnchors = new Set(),
    mix = DEFAULT_MIX,
    startDate = new Date(),
    everyDays = 7,
  } = input;

  if (!topics.length) throw new Error('planCampaign: no topics given');

  /* NO TARGET PAGE IS A SHAPE, NOT AN OMISSION — but only when the caller
   * says so, which is why this is a flag and not `if (!targetPage)`.
   *
   * A pillar campaign writes the hub articles a later campaign points at.
   * There is no money page yet, so its posts carry only the ring. Inferring
   * that from a missing argument would make every caller's typo into a valid
   * campaign with a third of its links quietly absent. */
  const isPillar = !!input.isPillar;

  if (!isPillar && (!targetPage || !targetPage.url)) {
    throw new Error('planCampaign: targetPage.url is required unless isPillar');
  }

  /* TWO POSTS IS THE FLOOR FOR A PILLAR CAMPAIGN, and nothing downstream
   * would have caught one post.
   *
   * ringNeighbours() returns { prev: null, next: null } for n < 2, the money
   * link is absent by design, and every link assertion in qualityCheck.js is
   * conditional on the link having been asked for. So a single pillar post
   * has no outbound links at all AND PASSES EVERY CHECK CLEAN: there is
   * nothing left to assert. An ordinary single-post campaign is fine, because
   * it still carries its money link.
   *
   * EVERY ASSERTION BEING CONDITIONAL IS RIGHT PER LINK AND WRONG IN
   * AGGREGATE. Nothing anywhere asked whether the post had any links. */
  if (isPillar && topics.length < 2) {
    throw new Error('planCampaign: a pillar campaign needs at least two posts — one would have no links at all');
  }

  const n = topics.length;
  const slugs = uniqueSlugs(topics);

  // Skipped entirely for a pillar campaign. These allocate and balance MONEY
  // anchors; with no money page there is nothing to allocate, and
  // buildAnchorPool() upstream throws without a keyword rather than returning
  // an empty pool.
  const types = isPillar ? [] : allocateAnchorTypes(n, mix);
  const anchors = isPillar ? [] : pickAnchors(types, anchorPool, usedAnchors);

  const slots = topics.map((t, i) => {
    const id = `topic-${i + 1}`;
    const publishAt = new Date(startDate.getTime() + i * everyDays * 86400000);

    return {
      index: i,
      id,
      topic: t.topic || t.title,
      title: t.title || null,          // filled in by the writer

      // How other posts refer to this one in a sentence. Distinct from the
      // title on purpose — see campaign.example.js.
      linkPhrase: t.linkPhrase || null,

      // The ONE search this post is meant to win. Two posts chasing the same
      // query split their strength; a post chasing the service page's query
      // competes with the page it exists to promote. queryConflicts() checks
      // both.
      targetQuery: t.targetQuery || null,
      slug: slugs[i],
      url: null,                       // the REAL url, known only once published
      publishAt,

      // --- the links this post carries ---

      // Live when it exists: the target predates the campaign. NULL on a
      // pillar campaign, which has no money page — and null rather than an
      // empty object, so every downstream `if (slot.money)` is a real test
      // rather than one that passes on a shape with no anchor in it.
      money: isPillar ? null : {
        url: targetPage.url,
        anchor: anchors[i].phrase,
        anchorType: anchors[i].type,
        reusedAnchor: !!anchors[i].reused,
      },

      // Live: points backwards in time. Slot 0 has no earlier sibling.
      prev: i > 0 ? { slotIndex: i - 1, id: `topic-${i}` } : null,

      // Pending: points forwards. Written as a marked phrase, switched on
      // when that post publishes. The LAST slot instead closes the ring to
      // slot 0, which already exists — so it is live, not pending.
      next: i < n - 1
        ? { slotIndex: i + 1, id: `topic-${i + 2}`, pending: true }
        : (n > 1 ? { slotIndex: 0, id: 'topic-1', pending: false, closesRing: true } : null),
    };
  });

  return {
    business,
    targetPage: isPillar ? null : targetPage,
    isPillar,
    cadenceDays: everyDays,
    slots,
    anchorSummary: summariseAnchors(slots),
  };
}

/**
 * How the campaign's money anchors break down by type.
 *
 * EMPTY, NOT ZEROED, for a pillar campaign. There are no money anchors, so
 * there is no mix — and `{ exact: 0, semantic: 0, … }` would be a mix that
 * happens to be empty, which is a different claim and the one the UI would
 * draw a chart of.
 */
function summariseAnchors(slots) {
  const out = {};
  for (const s of slots) {
    if (!s.money) continue;
    out[s.money.anchorType] = (out[s.money.anchorType] || 0) + 1;
  }
  return out;
}

/**
 * Re-point the placeholders when a topic is dropped.
 *
 * Without this, cancelling one topic kills two edges at once: the previous
 * post's pending link never activates, and the following post loses its
 * inbound link. Re-planning the chain around the gap keeps the ring closed.
 */
function dropSlot(plan, slotId) {
  const slots = plan.slots.filter(s => s.id !== slotId);
  if (slots.length === plan.slots.length) return plan;

  const n = slots.length;
  slots.forEach((s, i) => {
    s.index = i;
    s.prev = i > 0 ? { slotIndex: i - 1, id: slots[i - 1].id } : null;
    s.next = i < n - 1
      ? { slotIndex: i + 1, id: slots[i + 1].id, pending: true }
      : (n > 1 ? { slotIndex: 0, id: slots[0].id, pending: false, closesRing: true } : null);
  });

  return { ...plan, slots, anchorSummary: summariseAnchors(slots) };
}

/**
 * Every post must have at least one inbound link from another post.
 * A ring guarantees it by construction — this proves it rather than trusting
 * it, and catches a plan mangled by edits or drops.
 */
function findOrphans(plan) {
  const inbound = new Map(plan.slots.map(s => [s.id, 0]));

  for (const s of plan.slots) {
    if (s.prev) inbound.set(s.prev.id, (inbound.get(s.prev.id) || 0) + 1);
    if (s.next) inbound.set(s.next.id, (inbound.get(s.next.id) || 0) + 1);
  }

  return plan.slots.filter(s => (inbound.get(s.id) || 0) === 0).map(s => s.id);
}

module.exports = { planCampaign, dropSlot, findOrphans, slugify, uniqueSlugs };

/* -------------------------------------------------------------------------
 * Query conflicts
 * -------------------------------------------------------------------------
 * Two failure modes, both invisible until months later:
 *
 *   1. Two posts in the campaign chasing the same search. They split their
 *      strength, Google picks one, and the other slot was wasted.
 *
 *   2. A post chasing the SERVICE PAGE's search. That is the cannibalisation
 *      the whole design exists to avoid — the post competes with the page it
 *      was written to promote.
 *
 * Comparison is deliberately crude: stopwords out, rough plural stripping,
 * then set overlap. It is meant to catch "water heater making noise" against
 * "water heater noise", not to be a search engine.
 * ---------------------------------------------------------------------- */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'my', 'your', 'our', 'is', 'are', 'was', 'be', 'to', 'for',
  'of', 'in', 'on', 'at', 'and', 'or', 'do', 'does', 'did', 'why', 'how',
  'what', 'when', 'where', 'should', 'it', 'that', 'this', 'with', 'from',
  'you', 'i', 'me', 'can', 'will', 'get', 'got', 'so', 'if', 'vs',
]);

function queryTokens(query) {
  return new Set(
    String(query || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map(w => w.replace(/(ies)$/, 'y').replace(/(es|s)$/, ''))
      .filter(w => w && !STOPWORDS.has(w))
  );
}

function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  const union = new Set([...a, ...b]).size;
  return shared / union;
}

function isSubset(small, big) {
  if (!small.size) return false;
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

/**
 * The comparison itself, over anything with an id and a query.
 *
 * Split out from queryConflicts() because the same test is needed at TWO
 * moments: on the planning screen, where the owner is still choosing topics
 * and a fix is free, and again on the built plan. A check that only runs at
 * the second moment is a check that fires after the decision was made.
 *
 * @param {Array}  items        [{ id, targetQuery }]
 * @param {string} moneyKeyword the service page's own search
 * @param {number} threshold    set overlap above which two queries are "the same"
 */
/**
 * Words that, added to a keyword, do not make a new search — they make the
 * same search with a qualifier. "water heater repair" and "best water heater
 * repair near me" are the same commercial intent competing for the same page.
 *
 * Compare "how long does water heater repair take", which adds "long" and
 * "take" and IS a different question. That is the distinction this list draws.
 */
const COMMERCIAL_MODIFIERS = new Set([
  'best', 'top', 'good', 'great', 'cheap', 'cheapest', 'affordable', 'budget',
  'local', 'near', 'nearby', 'emergency', 'fast', 'same', 'day', '24', 'hour',
  'company', 'companies', 'contractor', 'contractors', 'plumber', 'plumbers',
  'service', 'services', 'pro', 'pros', 'expert', 'experts', 'specialist',
  'cost', 'costs', 'price', 'prices', 'pricing', 'quote', 'quotes', 'rate',
  'tip', 'tips', 'guide', 'help', 'need', 'find', 'hire', 'call',
]);

function normaliseForPhrase(text) {
  return ` ${String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

/**
 * Is this query the money keyword with nothing but qualifiers bolted on?
 *
 * Two conditions:
 *   1. the keyword appears CONTIGUOUSLY, in order, inside the query
 *   2. every extra word is a commercial modifier or a place name
 *
 * Contiguity is what saves "repair or replace water heater" — it contains all
 * three keyword words but not as a phrase, and "or replace" changes the
 * question entirely.
 */
function isKeywordWithQualifiers(query, moneyKeyword, extraTokens = new Set()) {
  const q = normaliseForPhrase(query);
  const k = normaliseForPhrase(moneyKeyword);
  if (!k.trim() || !q.includes(k)) return false;

  const extras = [...queryTokens(q.replace(k, ' '))];
  if (!extras.length) return true;   // exactly the keyword

  return extras.every(w => COMMERCIAL_MODIFIERS.has(w) || extraTokens.has(w));
}

function compareQueries(items = [], moneyKeyword = '', threshold = 0.6, extraTokens = new Set()) {
  const conflicts = [];
  const withQuery = items.filter(s => s.targetQuery);

  // Missing queries are worth knowing about too — an unassigned slot is one
  // nobody decided the purpose of.
  for (const s of items) {
    if (!s.targetQuery) {
      conflicts.push({ kind: 'missing', a: s.id, detail: 'no target query assigned' });
    }
  }

  const moneyTokens = queryTokens(moneyKeyword);

  for (const s of withQuery) {
    const t = queryTokens(s.targetQuery);

    if (moneyTokens.size && isKeywordWithQualifiers(s.targetQuery, moneyKeyword, extraTokens)) {
      conflicts.push({
        kind: 'cannibalises',
        a: s.id,
        detail: `"${s.targetQuery}" contains the service page's own search ("${moneyKeyword}")`,
      });
    }
  }

  for (let i = 0; i < withQuery.length; i++) {
    for (let j = i + 1; j < withQuery.length; j++) {
      const A = withQuery[i];
      const B = withQuery[j];
      const ta = queryTokens(A.targetQuery);
      const tb = queryTokens(B.targetQuery);

      const score = overlap(ta, tb);
      const nested = isSubset(ta, tb) || isSubset(tb, ta);

      if (nested || score >= threshold) {
        conflicts.push({
          kind: 'duplicate',
          a: A.id,
          b: B.id,
          detail: `"${A.targetQuery}" vs "${B.targetQuery}" (overlap ${score.toFixed(2)}${nested ? ', one contains the other' : ''})`,
        });
      }
    }
  }

  return conflicts;
}

/**
 * @param {object} plan        from planCampaign()
 * @param {number} threshold   set overlap above which two queries are "the same"
 * @returns {Array<{kind:string, a:string, b?:string, detail:string}>}
 */
function queryConflicts(plan, threshold = 0.6) {
  return compareQueries(
    plan.slots.map(s => ({ id: s.id, targetQuery: s.targetQuery })),
    plan.targetPage && plan.targetPage.keyword,
    threshold,
    queryTokens(plan.business && plan.business.town)
  );
}

module.exports.queryConflicts = queryConflicts;
module.exports.compareQueries = compareQueries;
module.exports.isKeywordWithQualifiers = isKeywordWithQualifiers;
module.exports.queryTokens = queryTokens;