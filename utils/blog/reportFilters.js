// utils/blog/reportFilters.js
//
// The blog report's pure logic: what state a row is in, what the query string
// asked for, and whether a row survives it.
//
// SPLIT OUT OF routes/blogReportRoute.js, and for a reason worth keeping. The
// route requires express and two mongoose models, so anything living beside
// it can only be tested with the whole stubbing dance — and one of these
// functions had a timezone bug that is INVISIBLE on a UTC machine. Catching
// that needs a child process with TZ forced, and a child cannot cheaply
// reconstruct that dance.
//
// So the parts with decisions in them take plain values and return plain
// values, and can be asked a question by anything that can run node.

/**
 * Read the filters off a query string.
 *
 * Separated so the page and the CSV cannot read them differently — the same
 * reason they share rowsFor(). A filter applied to one and not the other is
 * an export that quietly stops matching the screen it came from, which is
 * exactly the drift the shared function exists to prevent.
 *
 * Everything is optional and anything unrecognised is ignored rather than
 * refused: this arrives in a URL somebody may have edited by hand or kept in
 * a bookmark, and an error page helps nobody.
 */
function readFilters(query = {}) {
  const text = v => String(v == null ? '' : v).trim();

  /* EVERYTHING IN UTC, BOTH ENDS, AND THAT IS THE WHOLE POINT.
   *
   * A date-only string parses as UTC midnight — that is what the spec says
   * and what `new Date('2026-09-12')` does everywhere. setHours(), though,
   * works in the SERVER'S LOCAL TIME. Mixing the two is a bug that is
   * invisible on a UTC box and silently wrong anywhere else:
   *
   *   to = new Date('2026-09-12')   ->  2026-09-12T00:00:00Z
   *   to.setHours(23,59,59,999)     ->  2026-09-12T04:59:59Z  in Chicago
   *
   * A post published at 09:00Z that day then falls OUTSIDE its own date and
   * vanishes from the report, with nothing to say it was dropped.
   *
   * It shipped past a test that passed on a UTC machine and failed the moment
   * it ran on a laptop in Texas. Parsed explicitly here rather than leaning on
   * the spec's quirk, so the intent is readable rather than inferred. */
  const day = v => {
    const raw = text(v);
    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);

    if (ymd) {
      return new Date(Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])));
    }

    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const from = day(query.from);
  const to = day(query.to);

  // The END of the chosen day, not its midnight. "to=2026-09-28" meaning "up
  // to 00:00 on the 28th" silently drops everything published that day, which
  // is the day somebody filtering to today cares about most.
  if (to) to.setUTCHours(23, 59, 59, 999);

  /* Which tab, and it lives with the filters on purpose: the tab is part of
   * the view, so it rides in the URL with everything else and a bookmarked
   * link opens on the page it was sent from. Anything unrecognised falls back
   * to campaigns rather than erroring — this arrives in a URL somebody may
   * have edited.
   *
   * A POST STATE ASKED FROM THE CAMPAIGNS TAB MEANS "SHOW ME THOSE POSTS".
   *
   * The filter bar carries both questions at once: Campaign status is about
   * campaigns, Post state is about articles. Choosing "Deleted from site" and
   * pressing Filter while the campaigns tab was open changed the counts in
   * the table and nothing else — so it looked, reasonably, like the button
   * had done nothing at all.
   *
   * Nobody picks a post state wanting a list of campaigns. The intent is
   * unambiguous, so it is honoured rather than second-guessed. Every link
   * this page generates sets `view` explicitly, so this only ever fires on a
   * form the reader filled in themselves. */
  const asked = text(query.view);
  const view = asked === 'posts' ? 'posts'
    : (asked === 'campaigns' && !text(query.state)) ? 'campaigns'
    : text(query.state) ? 'posts'
    : 'campaigns';

  return {
    view,
    /* THE ID, ALONGSIDE THE NAME, AND THEY ARE NOT THE SAME FILTER.
     *
     * The Campaign dropdown is a browse: pick a name, see everything that
     * ever ran under it. Drilling in from a campaign LINE is the opposite —
     * that one row, and only that one. Two campaigns can share a name on one
     * site (re-planning a money page does it), so a drill-through that
     * filtered by name showed both and there was no way to tell which posts
     * belonged to which. */
    campaignId: text(query.campaignId),
    campaign: text(query.campaign),
    campaignStatus: text(query.campaignStatus),
    site: text(query.site),
    state: text(query.state),
    from,
    to,
  };
}

/**
 * Does this row survive the filters?
 *
 * MATCHED ON THE ROW, NOT IN THE DATABASE QUERY. A slot's state is computed
 * from three fields — status, deletedAt and the campaign's removedAt — and
 * "under a removed campaign" is not a value stored anywhere. Pushing that
 * into Mongo would mean either a query nobody can read or a second definition
 * of each state that drifts from the one the pills use.
 */
function keep(row, f) {
  if (f.campaignId && row.campaignId !== f.campaignId) return false;
  if (f.campaign && row.campaign !== f.campaign) return false;
  if (f.site && row.site !== f.site) return false;

  if (f.state && stateOf(row) !== f.state) return false;
  if (f.campaignStatus) {
    /* 'removed' IS NOT A STATUS, and it is offered here anyway.
     *
     * Removal is a date, deliberately, so that "completed, then deleted from
     * WordPress" and "cancelled halfway, then deleted" stay tellable apart.
     * Folding it into campaignStatusOf() would throw that away — asking for
     * Completed would silently drop every completed campaign that had since
     * been removed.
     *
     * So it is handled here instead: a separate question, asked from the
     * same box. Removal is where people look for it, three times over, and
     * an architecture argument that makes somebody hunt is a bad trade.
     * Completed + Post state "Campaign removed" still composes exactly as
     * before. */
    if (f.campaignStatus === 'removed') {
      if (!row.removedAt) return false;
    } else if (campaignStatusOf(row) !== f.campaignStatus) {
      return false;
    }
  }

  if (f.from || f.to) {
    // The date a reader means is the one in the Published column: when it
    // went out, or when it is due to.
    const when = row.publishedAt || row.publishAt;
    if (!when) return false;

    const t = new Date(when).getTime();
    if (f.from && t < f.from.getTime()) return false;
    if (f.to && t > f.to.getTime()) return false;
  }

  return true;
}

/**
 * One word for what a row IS, used by the pill, the filter and the counts.
 *
 * ONE DEFINITION, because three would disagree. The screen already learned
 * this the hard way in the plugin, where the same post was "waiting to
 * collect" in one table and "not written yet" in another.
 *
 * ORDER MATTERS. A deleted post under a removed campaign is reported deleted:
 * that is the more specific fact and the one that explains the missing link.
 */
function stateOf(row) {
  if (row.deletedAt) return 'deleted';
  if (row.removedAt) return 'removed';
  if (row.slotStatus === 'published') return 'published';
  if (row.slotStatus === 'scheduled') return 'scheduled';
  if (row.slotStatus === 'failed') return 'failed';
  return 'planned';
}

/**
 * What the CAMPAIGN is doing — a different question from what the POST is.
 *
 * DELIBERATELY BLIND TO removedAt, which is the whole point.
 *
 * Removal is stored as a date rather than a status precisely so that
 * "completed, then removed in October" and "cancelled halfway, then removed
 * in October" stay tellable apart — the note at the top of blogReportRoute.js
 * spells that out. Folding 'removed' into this list would throw that away and
 * make a campaign's history unrecoverable from the report that exists to keep
 * it.
 *
 * So the two filters are independent and compose: campaign status
 * "Completed" together with post state "Under a removed campaign" asks for
 * the campaigns that finished their run and were then deleted from WordPress,
 * which no single merged dropdown could express.
 *
 * draft, writing and active collapse into one bucket. They are stages of the
 * same thing — a campaign that has not finished — and a customer asking "what
 * is still going?" does not distinguish them.
 */
function campaignStatusOf(row) {
  const status = row.campaignStatus;

  if (status === 'completed') return 'completed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'paused') return 'paused';

  return 'running';
}

module.exports = { readFilters, keep, stateOf, campaignStatusOf };
