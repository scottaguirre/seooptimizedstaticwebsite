// blog-engine-preview/anchors.js
//
// Which KIND of anchor each post uses for its link to the money page, and
// which actual phrase.
//
// WHY ALLOCATE UP FRONT RATHER THAN PICK PER POST
//
// Picking a bucket at random per post is how you end up with four exact-match
// anchors in a four-post campaign. Random is not the same as varied. The whole
// campaign's allocation is computed once, from the target shares, and then
// SPREAD so the same bucket never lands twice in a row while another bucket
// waits its turn.
//
// The shares below are for INTERNAL links and are not the familiar off-site
// ratios. Google knows you authored every link on your own site, so there is
// no natural profile to imitate — the anchor's only job is to describe the
// page it points at. Generic anchors ("click here") and naked URLs are
// therefore 0%: Google's own link documentation names them as bad examples,
// and they spend a slot that could have said something.

/**
 * Target share of each anchor type, as percentages. Must total 100.
 */
const DEFAULT_MIX = {
  exact:       15,
  semantic:    50,
  descriptive: 25,
  branded:     10,
};

/**
 * Turn percentages into whole counts for n posts, using largest remainder.
 *
 * Plain rounding does not work: 15% of 4 rounds to 1, 50% rounds to 2, 25%
 * rounds to 1, 10% rounds to 0 — that totals 4 here but drifts on other
 * values, and a campaign with the wrong number of slots filled is a crash
 * waiting to happen. Largest remainder always totals exactly n.
 */
function bucketCounts(n, mix = DEFAULT_MIX) {
  const types = Object.keys(mix);
  const exact = types.map(t => ({ type: t, raw: (mix[t] / 100) * n }));

  const counts = {};
  let assigned = 0;
  for (const e of exact) {
    counts[e.type] = Math.floor(e.raw);
    assigned += counts[e.type];
  }

  // Hand out what's left to the largest fractional parts.
  const remainders = exact
    .map(e => ({ type: e.type, frac: e.raw - Math.floor(e.raw) }))
    .sort((a, b) => b.frac - a.frac || a.type.localeCompare(b.type));

  let i = 0;
  while (assigned < n) {
    counts[remainders[i % remainders.length].type] += 1;
    assigned += 1;
    i += 1;
  }

  return counts;
}

/**
 * Order the buckets so each type is spread evenly through the campaign.
 *
 * For a bucket with c items, its k-th item wants to sit at (k + 0.5) / c of
 * the way through. Sorting every item by that ideal position interleaves the
 * buckets — the classic way to avoid clumping — and is fully deterministic,
 * so the same campaign always produces the same plan.
 */
function allocateAnchorTypes(n, mix = DEFAULT_MIX) {
  if (!Number.isInteger(n) || n < 1) return [];

  const counts = bucketCounts(n, mix);
  const slots = [];

  for (const type of Object.keys(counts)) {
    const c = counts[type];
    for (let k = 0; k < c; k++) {
      slots.push({ type, pos: (k + 0.5) / c });
    }
  }

  slots.sort((a, b) => a.pos - b.pos || a.type.localeCompare(b.type));
  return slots.map(s => s.type);
}

/**
 * Choose the actual phrase for each slot from the pool, never repeating one
 * that has already pointed at this target page.
 *
 * `used` is deliberately a parameter rather than module state: the variety
 * that matters is the variety of anchors pointing at ONE URL, accumulated
 * across every campaign that has ever targeted it. In production this set
 * comes from stored post meta, not from this run.
 */
function pickAnchors(types, pool, used = new Set()) {
  const taken = new Set([...used].map(s => String(s).toLowerCase().trim()));
  const cursor = {};

  return types.map((type, i) => {
    const options = Array.isArray(pool[type]) ? pool[type] : [];

    if (!options.length) {
      throw new Error(
        `Anchor pool has nothing for "${type}" (slot ${i + 1}). ` +
        `Pool needs: ${Object.keys(DEFAULT_MIX).join(', ')}.`
      );
    }

    // Walk this bucket from wherever it left off, skipping anything used.
    let start = cursor[type] || 0;
    for (let step = 0; step < options.length; step++) {
      const idx = (start + step) % options.length;
      const phrase = options[idx];
      if (!taken.has(String(phrase).toLowerCase().trim())) {
        cursor[type] = idx + 1;
        taken.add(String(phrase).toLowerCase().trim());
        return { type, phrase };
      }
    }

    // Pool exhausted. Reusing is better than failing the campaign, but the
    // caller should know the pool needs widening.
    const phrase = options[start % options.length];
    cursor[type] = start + 1;
    return { type, phrase, reused: true };
  });
}

module.exports = { DEFAULT_MIX, bucketCounts, allocateAnchorTypes, pickAnchors };