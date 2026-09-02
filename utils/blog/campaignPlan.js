// utils/blog/campaignPlan.js
//
// Server-side wrapper around the proven planner.
//
// planCampaign.js is pure, tested, and produced the posts you judged
// publishable. It is not edited. This file supplies the two things it needs
// but cannot get on its own — an anchor pool and a set of already-used
// anchors — adds the scheduling it does not do, runs the conflict check it
// exposes separately, and maps the result onto the BlogCampaign slot schema.
//
// Everything specific to running as a service lives here, so the planner
// stays the same file the preview harness exercises.

const { planCampaign, queryConflicts } = require('./planCampaign');
const { buildAnchorPool, usedAnchorsFrom } = require('./anchorPool');
const { publishDates } = require('./schedule');

/**
 * @param {object} input
 * @param {object} input.targetPage       { url, keyword, title, intent }
 * @param {Array}  input.topics           [{ topic, targetQuery, linkPhrase, angle }]
 * @param {object} input.business         { name, type, location }
 * @param {object} input.schedule         { everyDays, publishTime, timezone, startAt }
 * @param {Array}  [input.priorCampaigns] earlier campaigns for the same URL
 * @param {object} [input.anchorOverrides]
 * @param {string} [input.linkMode]       'standalone' | 'extend'
 */
function planForCampaign(input) {
  const {
    targetPage,
    topics = [],
    business = {},
    schedule = {},
    priorCampaigns = [],
    anchorOverrides = {},
    linkMode = 'standalone',
  } = input;

  if (!topics.length) throw new Error('planForCampaign: no topics given');
  if (!targetPage || !targetPage.url) throw new Error('planForCampaign: targetPage.url is required');
  if (!targetPage.keyword) throw new Error('planForCampaign: targetPage.keyword is required');

  const { pool, shortfalls } = buildAnchorPool({
    targetPage,
    business,
    count: topics.length,
    overrides: anchorOverrides,
  });

  // Anchors that already point at this URL from earlier runs. A second
  // campaign reusing the first campaign's phrases adds volume without adding
  // variety, which is the thing the mix exists to produce.
  const usedAnchors = usedAnchorsFrom(priorCampaigns);

  const plan = planCampaign({
    topics,
    targetPage,
    business: {
      name: business.name || '',
      trade: business.type || '',
      town: String(business.location || '').replace(/,\s*[A-Z]{2}$/, ''),
    },
    anchorPool: pool,
    usedAnchors,
    // planCampaign's own date arithmetic is replaced below. Passing the
    // defaults keeps its slots well-formed; publishAt is overwritten with a
    // timezone-correct value.
    everyDays: schedule.everyDays || 7,
  });

  // The conflict check the planner exposes separately. Run here rather than
  // left to the caller, so no path reaches the database without it: a post
  // competing with the page it exists to promote is the one failure this
  // whole design is built to avoid.
  const conflicts = queryConflicts(plan).map(c => ({
    kind: c.kind,
    topic: c.a,
    other: c.b || null,
    detail: c.detail,
  }));

  // Real publish instants: calendar cadence, wall-clock time, DST-correct.
  const dates = publishDates({
    count: plan.slots.length,
    everyDays: schedule.everyDays || 7,
    publishTime: schedule.publishTime || '09:00',
    timezone: schedule.timezone || 'UTC',
    startAt: schedule.startAt ? new Date(schedule.startAt) : undefined,
  });

  // Onto the BlogCampaign slot schema. moneyAnchor and anchorType are stored
  // because buildLinkPlan reads them back at generation time — regenerating
  // an anchor then would unbalance the campaign's mix and, worse, could hand
  // the writer a different phrase from the one the checker verifies.
  const slots = plan.slots.map((s, i) => ({
    index: s.index,
    topic: s.topic,
    targetQuery: s.targetQuery || '',
    linkPhrase: s.linkPhrase || '',
    slug: s.slug,
    moneyAnchor: s.money.anchor,
    anchorType: s.money.anchorType,
    anchorReused: !!s.money.reusedAnchor,
    publishAt: dates[i],
    status: 'pending',
  }));

  const reused = slots.filter(s => s.anchorReused).length;

  return {
    slots,
    conflicts,
    linkMode,

    schedule: {
      everyDays: schedule.everyDays || 7,
      publishTime: schedule.publishTime || '09:00',
      timezone: schedule.timezone || 'UTC',
      startAt: dates[0] || null,
    },

    suggestedName: `${targetPage.keyword} — ${slots.length} posts`,

    // Surfaced rather than swallowed. Reused anchors mean several posts
    // linking with identical text, which is worth a line in the UI even
    // though it is not worth refusing the campaign over.
    anchorSummary: plan.anchorSummary,
    anchorWarnings: [
      ...shortfalls.map(s =>
        `only ${s.have} ${s.type} anchor(s) available for ${s.needed} needed`
      ),
      ...(reused ? [`${reused} post(s) reuse an anchor already pointing at this page`] : []),
    ],
  };
}

module.exports = { planForCampaign };