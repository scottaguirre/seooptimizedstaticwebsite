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
     * Folding it into campaignStatusOf() would throw that away. So it is
     * asked here instead: a separate question, from the same box, because
     * removal is where people look for it.
     *
     * THE STATUS OPTIONS ARE PRESENT TENSE, and for a while they were not.
     *
     * campaignStatusOf() ignores removedAt, so "In progress" used to mean
     * "its status WAS in-progress" — including campaigns deleted weeks ago.
     * Edwin filtered to In progress and got eight rows, seven of which the
     * page itself labelled "Was in progress", in red, in the next column.
     *
     * Seven of eight rows contradicting the filter that produced them is not
     * a composable design, it is a sentence nobody reads as intended. The
     * original reasoning — that Completed + "Campaign removed" composes into
     * a question no merged dropdown could ask — was true and required the
     * reader to know to compose it. The product's own author did not.
     *
     * So a status option now means "and it still exists". Removed campaigns
     * are found with the Removed option, already in the same dropdown, where
     * the STATUS column goes on saying what each one WAS. */
    if (f.campaignStatus === 'removed') {
      if (!row.removedAt) return false;
    } else if (row.removedAt) {
      return false;
    } else if (campaignStatusOf(row) !== f.campaignStatus) {
      return false;
    }
  }

  if (f.from || f.to) {
    const when = dateFilteredOn(row, f.view);
    if (!when) return false;

    const t = new Date(when).getTime();
    if (f.from && t < f.from.getTime()) return false;
    if (f.to && t > f.to.getTime()) return false;
  }

  return true;
}

/**
 * Which date the From/To boxes mean, for the tab being looked at.
 *
 * EACH TAB FILTERS THE THING IT LISTS. The boxes meant the post's publish
 * date on both tabs, and on the campaigns tab that answers a different
 * question from the one the table appears to be answering:
 *
 *     "campaigns with a post published between these dates"   ← what it did
 *     "campaigns from between these dates"                    ← what was asked
 *
 * Edwin filtered 1–5 October and got a campaign approved on 28 September. It
 * was the correct answer to the first question. Nothing on screen could tell
 * him which question had been answered, because the table shows Approved and
 * Removed and the filter was matching on neither — so a right answer was
 * indistinguishable from a broken filter.
 *
 * CREATED, NOT APPROVED, and that is a rule rather than a preference. Every
 * campaign has a created date; only an approved one has an approved date.
 * Filtering on approval would silently drop every campaign that was planned
 * and never run — a STATUS filter applied without being asked for, removing
 * rows the reader has no way to know are missing. In Edwin's screenshot two
 * of the nine campaigns show "—" under Approved; both would have vanished.
 *
 * His words when he chose it: *"any status unless I specify the status."*
 * Campaign status has its own control. A date filter may not quietly become
 * a second one.
 *
 * @param {object} row
 * @param {string} view  'campaigns' | 'posts'
 */
function dateFilteredOn(row, view) {
  if ('campaigns' === view) return row.campaignCreatedAt || null;

  // On the posts tab the date a reader means is the one in the Published
  // column: when it went out, or when it is due to.
  return row.publishedAt || row.publishAt || null;
}

/**
 * What the filter bar should say the dates do, on this tab.
 *
 * Exported rather than written into the template because the rule it
 * describes lives here. A label kept beside the markup is a second statement
 * of the same fact, and the two drift — which is how this file already lost
 * an argument once, when a comment went on describing a 15/50 anchor mix
 * weeks after the code had moved to 30/40.
 */
function dateFilterLabel(view) {
  return 'campaigns' === view
    ? 'Campaigns created between these dates'
    : 'Posts published, or due, between these dates';
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

  /* WRITTEN AND PAID FOR, WAITING FOR WORDPRESS TO TAKE IT.
   *
   * 'ready' had no word here and fell through to 'planned', which is the
   * state of a post that does not exist and has cost nothing. The two are
   * the opposite of each other on the only question an owner asks of this
   * screen: has this been charged for?
   *
   * FOUND BY PAUSING A BATCH. Edwin stopped a four-post campaign after the
   * first article; the server wrote it, charged 75 credits, and the campaign
   * paused before WordPress collected it. The report showed four posts, all
   * "Planned", total spend invisible — on a screen whose own footer argues
   * that a deleted post must stay listed "because the credits were spent and
   * that record has to survive". The same argument applies here and nobody
   * had made it, because until a batch could be stopped mid-run, 'ready' was
   * a state posts passed through in seconds rather than sat in.
   *
   * A NEW STATE RATHER THAN FOLDING IT INTO 'scheduled'. Scheduled means
   * WordPress has it and a date is set. This means the server has it and
   * nothing on the site knows about it yet — which is exactly the difference
   * somebody chasing a missing post needs to see. */
  if (row.slotStatus === 'ready') return 'written';

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

module.exports = {
  readFilters, keep, stateOf, campaignStatusOf,
  dateFilteredOn, dateFilterLabel,
};
