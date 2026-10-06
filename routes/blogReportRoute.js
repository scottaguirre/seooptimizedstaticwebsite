// routes/blogReportRoute.js
//
// Every blog post this app has ever published, across every site, with the
// money page it points at — and a CSV of the same.
//
//
// WHY IT LIVES HERE AND NOT IN THE PLUGIN
//
// The plugin's Campaigns screen shows one site's campaigns, one card at a
// time, and it is the right place for that. It cannot be the place for this,
// for two reasons.
//
// The first is scope: an agency with nine sites wants one table, not nine
// tabs. The second is survival. A campaign removed in WordPress takes its
// local record with it, so a history kept there is a history that disappears
// exactly when somebody tidies up. blogSitesRoute.js already made this call
// one level up — it refuses to delete a BlogSite on revoke because "their
// history — what was published, what was charged — has to survive".
//
//
// THE REPORT IS BUILT FROM CAMPAIGNS, NOT FROM POSTS
//
// Every fact it needs is already on a slot: the topic, the keyword it targets,
// the anchor it used, the URL WordPress gave it, when it went live and what it
// cost. Nothing new is stored to make this page work.
//
//
// WHAT "REMOVED" MEANS HERE
//
// `removedAt` is set when the customer presses "Remove campaign" in wp-admin —
// see /api/blog/removed. The posts usually stay up; it is the campaign that
// was thrown away. So a removed campaign's posts are still listed, and still
// counted, because they are still on the customer's site earning their keep.
// The row simply says where they came from.
//
// A campaign can be removed in any state, which is why removal is a date on
// the record rather than a value in `status`. "Completed, removed in October"
// and "cancelled halfway, removed in October" are different stories and the
// report tells them apart.

const express = require('express');
const router = express.Router();

const BlogSite = require('../models/BlogSite');
const BlogCampaign = require('../models/BlogCampaign');
const requireAuth = require('../middleware/requireAuth');
const { log } = require('../utils/logger');
const {
  readFilters, keep, stateOf, campaignStatusOf, dateFilterLabel,
} = require('../utils/blog/reportFilters');
const { withAppHeader } = require('../utils/appHeader');
const { pageTitle } = require('../utils/pageTitle');

/** The shell every other logged-in page uses. */
function page({ title, body, status = 200 }) {
  return {
    status,
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${pageTitle(title)}</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
{{HEADER_ASSETS}}
  <style>
    /* Lifted from the keyword research table so the two read as one app. */
    table.table {
      --bs-table-bg: transparent;
      --bs-table-color: #fff;
      --bs-table-striped-bg: rgba(255,255,255,.07);
      --bs-table-striped-color: #fff;
      --bs-table-hover-bg: rgba(255,255,255,.13);
      --bs-table-hover-color: #fff;
      --bs-table-border-color: rgba(255,255,255,.12);
      color: #fff;
    }
    thead th {
      border-bottom: 2px solid rgba(255,255,255,.35) !important;
      font-size: .8rem; letter-spacing: .03em; text-transform: uppercase;
      color: rgba(255,255,255,.7); white-space: nowrap;
    }
    td, th { vertical-align: top; }
    .muted { color: rgba(255,255,255,.55); }
    .num { text-align: right; font-variant-numeric: tabular-nums; }

    /* A DATE IS ONE WORD. Without this the column squeezes and "09-29-2026"
       breaks across two lines mid-date, which is both ugly and briefly
       unreadable — the eye has to reassemble it. */
    .date { white-space: nowrap; }

    /* Dimmer than .muted, because this date is the weakest claim on the
       page: not what happened, only what is meant to. */
    .due { color: rgba(255,255,255,.38); font-style: italic; }

    /* WHITE-SPACE RESET, because it sits inside .date, which is nowrap so a
       date never breaks across two lines mid-date. Without this the note
       inherits it and drags the column to the width of the whole sentence. */
    .note {
      white-space: normal;
      color: rgba(255,255,255,.38);
      font-size: .72rem;
      line-height: 1.25;
      margin-top: .2rem;
    }

    /* THE ROW NUMBER. Right-aligned and tabular so 9 and 10 put their last
       digit in the same column — a ragged number column drags the eye down
       the wrong edge of the table. Muted, because it labels the row rather
       than saying anything about it, and narrow so it takes width from
       nothing that carries information. */
    .rownum {
      text-align: right;
      font-variant-numeric: tabular-nums;
      color: rgba(255,255,255,.45);
      width: 3.2rem;
      padding-right: .9rem;
    }
    a { color: #7fb8ff; }
    .pill {
      display:inline-block; padding:.1rem .5rem; border-radius:1rem;
      font-size:.75rem; white-space:nowrap;
    }
    .pill-live { background: rgba(40,167,69,.25); }
    .pill-gone { background: rgba(255,255,255,.14); }
    .pill-wait { background: rgba(255,193,7,.22); }

    /* AMBER, NOT GREY. A post under a removed campaign is not a neutral
       footnote — the site stopped tracking it and nobody can say whether it
       is still live. Grey reads as "fine, just old". */
    .pill-warn { background: rgba(255,193,7,.32); color: #ffe69c; }

    /* THE TABS, AND THEY HAVE TO LOOK LIKE TABS.
       The first version carried its state in an underline and nothing else —
       quiet, tidy, and invisible: the reader never saw them at all and went
       looking for the posts list in the filter bar. A control nobody notices
       is not a subtle control, it is a missing one. So: real tab shapes, a
       border, and an active tab that joins the content below it. */
    .report-tabs {
      display: flex; gap: .35rem; padding-left: .15rem;
      border-bottom: 2px solid rgba(255,255,255,.28);
      /* Clear of the title. The tabs sat directly under it and the two read
         as one block, which is part of why nobody saw them. */
      margin-top: 1.4rem;
    }
    .report-tab {
      display: inline-block; padding: .5rem 1.15rem; margin-bottom: -2px;
      color: rgba(255,255,255,.72); text-decoration: none; font-weight: 500;
      background: rgba(255,255,255,.05);
      border: 1px solid rgba(255,255,255,.18);
      border-radius: .45rem .45rem 0 0;
    }
    .report-tab:hover { color: #fff; background: rgba(255,255,255,.13); }

    /* Lighter than the page, and its bottom edge is painted in its own
       colour so the tab reads as continuous with the table beneath it. */
    .report-tab-on {
      color: #fff; background: #0f3f78;
      border-color: rgba(255,255,255,.3);
      border-bottom: 2px solid #0f3f78;
    }
    .report-tab .muted { font-size: .85em; margin-left: .15rem; }

    /* The campaign name is a filter, so it has to look clickable without
       becoming another blue link in a table that already has two. */
    .report-link { color: inherit; text-decoration: underline dotted; }

    /* Small, quiet, and beside the name rather than in a column of its own:
       it is a way in, not a decision. */
    .report-check {
      margin-left: .6rem; padding: .05rem .5rem; font-size: .75rem;
      vertical-align: baseline; white-space: nowrap;
    }
    .report-link:hover { color: #9ec5fe; }
  </style>
</head>
<body style="background:#082d5b;" class="text-white">
{{HEADER}}
{{SIDEBAR}}
  <div class="container py-5" style="max-width: 1200px;">
    ${body}
  </div>
{{HEADER_SCRIPTS}}
</body>
</html>`,
  };
}

function send(res, spec) {
  return res.status(spec.status).send(withAppHeader(spec.html, res));
}

/**
 * Escape anything that came from a customer's WordPress.
 *
 * Post titles and URLs are reported BY THE PLUGIN, which makes them
 * attacker-controlled if somebody points a hostile install at us. Exactly the
 * reasoning blogSitesRoute.js gives for escaping siteUrl.
 */
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A byte-order mark, written as an ESCAPE rather than as the character.
 *
 * Excel on Windows reads a BOM-less CSV as the system codepage and mangles
 * every accented character in a post title — and these are local business
 * names. The first draft of this file carried the raw U+FEFF inside a string
 * literal, where it is invisible: any editor, linter or copy-paste could have
 * dropped it and nothing would have looked different in the diff.
 */
const EXCEL_BOM = '\uFEFF';

/**
 * A date as a MACHINE reads it: yyyy-mm-dd.
 *
 * DO NOT "TIDY" THIS INTO THE DISPLAY FORMAT. It has three callers and two of
 * them are not text on a screen:
 *
 *   - the value of <input type="date">, which the HTML spec requires to be
 *     yyyy-mm-dd. Anything else is rejected silently by the browser: the box
 *     renders EMPTY, so the filter you just applied looks like it was never
 *     applied at all.
 *   - the from= and to= in the query string this page builds, which
 *     readFilters() parses back with a /^(\d{4})-(\d{2})-(\d{2})$/ test.
 *   - the CSV and its filename, where ISO sorts correctly as plain text and
 *     is the one format a spreadsheet cannot read as the wrong day. 09-10
 *     is the 9th of October to most of the world and the 10th of September
 *     to the US, and the file gives no clue which was meant.
 *
 * Use shownDay() for anything a person reads.
 */
function day(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/**
 * A date as Edwin reads it: mm-dd-yyyy.
 *
 * SCREEN ONLY, and built on day() so the two can never disagree about which
 * day they mean — this reorders the parts and does no date arithmetic of its
 * own, which is where a second implementation would drift.
 */
function shownDay(value) {
  const iso = day(value);
  if (!iso) return '';

  const [y, m, d] = iso.split('-');
  return `${m}-${d}-${y}`;
}

/**
 * The name a campaign goes by on this page.
 *
 * ONE DEFINITION, because the filter's dropdown and the rows it filters have
 * to agree on the string exactly. They were derived separately for one build
 * and a campaign with no `name` — offered in the dropdown from its money page
 * title, matched on the row against '' — could be selected and would return
 * nothing, every time, with no way to tell that from a genuinely empty result.
 */
function campaignName(campaign) {
  return campaign.name
    || pageName(campaign.targetPage)
    || '';
}

/**
 * What to call the page a campaign feeds.
 *
 * THERE IS NO `title`, AND THERE NEVER WAS. This read targetPage.title,
 * which is not in the schema — /plan stores url, keyword and intent, and
 * nothing else. So the report's "Links to" column and the CSV's
 * links_to_page have been blank on every row since the page was written,
 * showing an anchor phrase under an empty heading and a bare link.
 *
 * The keyword is stored, and it is what the page is actually about, so it
 * names the page rather than leaving a hole. A title, if one is ever stored,
 * wins — it is the more human answer.
 */
function pageName(targetPage) {
  if (!targetPage) return '';

  return targetPage.title || targetPage.keyword || '';
}

/** Is any filter actually set? Decides which of the two empty pages is right. */
function anyFilter(f) {
  return Boolean(f.campaignId || f.campaign || f.campaignStatus || f.site || f.state || f.from || f.to);
}

/**
 * One row per SLOT, flattened across every campaign and site.
 *
 * Shared by the page and the CSV so the two can never drift — a report and
 * its export disagreeing is the kind of thing nobody notices until a customer
 * quotes one at you.
 */
async function rowsFor(userId, filters = {}) {
  const f = filters.campaign !== undefined ? filters : readFilters(filters);

  const sites = await BlogSite.find({ user: userId }).lean();
  const byId = new Map(sites.map(s => [String(s._id), s]));

  const campaigns = await BlogCampaign.find({ user: userId })
    .sort({ createdAt: -1 })
    .lean();

  const rows = [];

  for (const campaign of campaigns) {
    const site = byId.get(String(campaign.site));

    for (const slot of campaign.slots || []) {
      rows.push({
        site: site ? (site.siteUrl || '') : '',
        siteStatus: site ? site.status : '',
        /* THE ID, NOT JUST THE NAME. Two campaigns on one site can share a
         * name — re-planning the same money page produces exactly that — and
         * grouping the campaigns tab by name merged them into one line. Six
         * removed campaigns showed as four, on a page whose own headline said
         * six, in the same sentence. */
        campaignId: String(campaign._id),
        campaign: campaignName(campaign),
        campaignStatus: campaign.status,
        /* THREE DIFFERENT DAYS, AND THEY ARE ROUTINELY WEEKS APART.
         *
         * createdAt is when the campaign was PLANNED. It is a draft at that
         * point: nothing written, nothing charged, and it may never be
         * approved at all.
         *
         * batch.startedAt is when somebody APPROVED it — the moment the
         * writing is enqueued, the status becomes 'writing', and the credits
         * start being spent. That is the day a customer means by "when did
         * this campaign start", and the one the report shows.
         *
         * publishedAt on a slot is a third thing again: a campaign approved
         * on the 3rd with a fortnightly schedule puts nothing on the site
         * until the 17th.
         *
         * Both are carried. The screen shows approval because that is the
         * question; the CSV keeps the planning date too, because a campaign
         * that sat unapproved for three weeks is a fact about the customer
         * that only those two dates together can tell. */
        campaignCreatedAt: campaign.createdAt || null,
        campaignApprovedAt: (campaign.batch && campaign.batch.startedAt) || null,
        removedAt: campaign.removedAt || null,
        moneyPage: pageName(campaign.targetPage),
        moneyPageUrl: (campaign.targetPage && campaign.targetPage.url) || '',
        topic: slot.topic || '',
        keyword: slot.targetQuery || '',
        anchor: slot.moneyAnchor || '',
        slotStatus: slot.status,
        // The post is no longer on the site. Carried SEPARATELY from
        // slotStatus, which still says 'published' and always will — see the
        // note on deletedAt in models/BlogCampaign.js for why the two facts
        // are kept apart rather than folded into one value.
        deletedAt: slot.deletedAt || null,
        publishAt: slot.publishAt || null,
        publishedAt: slot.publishedAt || null,
        url: slot.publishedUrl || '',
        title: slot.publishedTitle || '',
        credits: Number(slot.credits) || 0,
      });
    }
  }

  rows.forEach(row => { row.state = stateOf(row); });

  // Newest publication first; anything unpublished sorts after, by its
  // planned date. An agency reading this wants "what went out lately".
  rows.sort(byNewest);

  const filtered = rows.filter(row => keep(row, f));

  /* A ROW COUNTER, AND NOTHING MORE.
   *
   * This started life as a stable identifier: numbered before filtering, so
   * a row kept its number whatever was hidden and a filtered report read
   * 2, 6, 17. That answers a question nobody asked. What Edwin wanted was
   * the ordinary thing a numbered list does — count the rows in front of
   * you, 1..n, starting at 1 — so that "row 7" means the seventh line on
   * the screen.
   *
   * Numbered AFTER the filter for that reason, and in rowsFor() rather than
   * in the template so the page and the CSV cannot disagree about what row
   * seven is.
   *
   * The consequence, stated so nobody 'fixes' it later: the same post has a
   * different number under a different filter. That is correct here. The
   * number describes a position in a list, not a post.
   */
  filtered.forEach((row, i) => { row.n = i + 1; });

  /* The campaigns tab counts its own rows, from its own order — it sorts
   * removed-first, so it cannot borrow the post list's numbering. Built from
   * the filtered rows, exactly like the table it labels. */
  const campaignNumbers = new Map();
  campaignsFrom(filtered).forEach((c, i) => { campaignNumbers.set(campaignKey(c), i + 1); });
  filtered.forEach(row => { row.campaignN = campaignNumbers.get(campaignKey(row)) || 0; });

  return filtered;
}

function byNewest(a, b) {
  const at = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
  const bt = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
  if (at !== bt) return bt - at;

  const ap = a.publishAt ? new Date(a.publishAt).getTime() : 0;
  const bp = b.publishAt ? new Date(b.publishAt).getTime() : 0;
  return bp - ap;
}

/* ONE KEY, USED BY BOTH SIDES OF THE NUMBERING. campaignsFrom() groups on
 * this and rowsFor() looks numbers up with it; two spellings of "which
 * campaign is this" would hand rows a number belonging to another campaign,
 * silently, and only on the accounts where a name is reused. */
function campaignKey(row) {
  return row.campaignId || `${row.campaign}\u0000${row.site}`;
}

/**
 * The same rows, gathered into one line per campaign.
 *
 * A DIFFERENT QUESTION FROM THE POSTS TABLE, which is why it is a tab rather
 * than a filter. "How many campaigns did I remove, when, and how big were
 * they" cannot be answered by any amount of filtering a list of posts: the
 * removal date sits on thirty-six rows and you would have to read all of them
 * and deduplicate by eye.
 *
 * Built from the SAME filtered rows the posts tab shows, so the two can never
 * disagree — the counts on a campaign line are of the posts you would see if
 * you clicked through to it.
 */
function campaignsFrom(rows) {
  const byName = new Map();

  for (const row of rows) {
    const key = campaignKey(row);

    if (!byName.has(key)) {
      byName.set(key, {
        campaignId: row.campaignId,
        campaign: row.campaign,
        site: row.site,
        /* Carried rather than counted here, because this function is called
         * twice: once to hand out the numbers and once to build the table.
         * Counting inside it would number the campaigns twice and the second
         * count would be the one on screen. */
        n: row.campaignN || 0,
        createdAt: row.campaignCreatedAt,
        approvedAt: row.campaignApprovedAt,
        campaignStatus: row.campaignStatus,
        removedAt: row.removedAt,
        posts: 0,
        published: 0,
        deleted: 0,
        scheduled: 0,
        credits: 0,
        // The most recent publication, which is what "last active" means to
        // somebody scanning for the campaign they were just looking at.
        lastAt: null,
      });
    }

    const c = byName.get(key);

    c.posts++;
    c.credits += row.credits;

    if (row.state === 'published') c.published++;
    if (row.state === 'deleted') c.deleted++;
    if (row.state === 'scheduled') c.scheduled++;

    const when = row.publishedAt || row.publishAt;
    if (when && (!c.lastAt || new Date(when) > new Date(c.lastAt))) {
      c.lastAt = when;
    }
  }

  const out = [...byName.values()];

  // Removed campaigns first, newest removal at the top — this tab exists
  // mostly to answer questions about them. Everything else by last activity.
  out.sort((a, b) => {
    const ar = a.removedAt ? new Date(a.removedAt).getTime() : 0;
    const br = b.removedAt ? new Date(b.removedAt).getTime() : 0;
    if (ar !== br) return br - ar;

    const at = a.lastAt ? new Date(a.lastAt).getTime() : 0;
    const bt = b.lastAt ? new Date(b.lastAt).getTime() : 0;
    return bt - at;
  });

  return out;
}

/**
 * What a campaign line says it is doing — or was doing, once it is gone.
 *
 * PRESENT TENSE IS A LIE ON A REMOVED CAMPAIGN. Its status is frozen at the
 * moment it was deleted from WordPress and nothing will ever change it again:
 * the hourly sweep reports the campaigns a site still HAS, so a removed one
 * is never mentioned again by anybody. The table read "In progress" beside a
 * removal date for seven campaigns that do not exist anywhere.
 *
 * The status is still worth showing — "finished, then deleted" and "deleted
 * halfway" are different stories, which is the whole reason removal is a date
 * rather than a status. It just has to be said in the past, and qualified,
 * because "at removal" is the most this side can honestly claim to know.
 */
function campaignLabel(c) {
  const now = c.campaignStatus === 'completed' ? 'Completed'
    : c.campaignStatus === 'cancelled' ? 'Cancelled'
    : c.campaignStatus === 'paused' ? 'Paused'
    : 'In progress';

  if (!c.removedAt) return now;

  /* PAST TENSE, AND IT READS AS ONE PHRASE. "In progress at removal" is
   * accurate and parses badly — the eye takes "In progress" and stops, which
   * is the exact wrong reading for a campaign that no longer exists. Opening
   * with "Was" settles the tense before the status is read at all. */
  return `Was ${now.charAt(0).toLowerCase()}${now.slice(1)}`;
}

const PILLS = {
  deleted: ['pill-gone', 'Deleted',
    'This post was published and then removed from the site. The credits were spent; the post is gone.'],
  removed: ['pill-warn', 'Campaign removed',
    'The campaign this post belonged to was deleted from its WordPress, so the site no longer tracks it. Whether the post itself survives cannot be checked from here.'],
  published: ['pill-live', 'Published', ''],
  scheduled: ['pill-wait', 'Scheduled', ''],
  failed: ['pill-gone', 'Failed', ''],
  /* PAID FOR, AND NOT ON THE SITE YET. The tooltip says the credits part
   * because that is the whole reason this state exists separately: it used to
   * read "Planned", which is what an unwritten post says. */
  written: ['pill-wait', 'Written, waiting',
    'The post is written and the credits for it were spent. WordPress has not collected it yet — a paused campaign holds its posts here until it is resumed.'],
  planned: ['pill-wait', 'Planned', ''],
};

/* ONE DEFINITION OF EACH STATE, read by the pill, the filter and the counts.
 *
 * DELETED IS CHECKED FIRST — in stateOf(), not here — because the stored
 * status is precisely what stops being true once the post is gone. It says
 * 'published' and it will say 'published' forever. The plugin learned that in
 * 0.4.3 and the same mistake was sitting untouched in this file: it printed
 * "Published", a live link and a 75-credit charge for fourteen posts deleted
 * weeks earlier. */
function slotPill(row) {
  const [cls, label, title] = PILLS[row.state || stateOf(row)] || PILLS.planned;

  return `<span class="pill ${cls}"${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</span>`;
}


/**
 * The filter bar.
 *
 * A PLAIN GET FORM, so every filtered view is a URL. That is the whole design:
 * it can be bookmarked, sent to somebody, and — the part that matters — the
 * CSV link below carries the same query string, so what you export is what you
 * are looking at. A JavaScript filter over the rendered table would be quicker
 * to write and would silently break that.
 *
 * THE LISTS COME FROM EVERYTHING THE USER HAS, NOT FROM THE ROWS ON SCREEN.
 *
 * An earlier version built the campaign list out of the filtered rows, on the
 * reasoning that it should never offer a choice returning nothing. That
 * reasoning does not survive contact with a second filter — "campaign X" plus
 * "state: failed" is empty whichever list you build from — and it fails hard
 * in the case that matters: filter down to nothing and the dropdowns empty
 * themselves, so the one screen where you most need to change your mind is
 * the one screen that has forgotten every other option.
 */
function filterBar(f, campaigns, siteNames) {
  const option = (value, label, selected) =>
    `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;

  /* TWO LISTS, NOT ONE, and they are asking different questions.
   *
   * POST STATE is what happened to the article. CAMPAIGN STATUS is what the
   * campaign that produced it is doing. A single merged dropdown would put
   * "Completed" beside "Published" as though they were alternatives, and
   * would make "the campaigns that finished and were then deleted from
   * WordPress" — two facts at once — impossible to ask for. */
  const STATES = [
    ['', 'Any state'],
    ['published', 'Published'],
    ['scheduled', 'Scheduled'],
    /* ONE WORD, MATCHING THE PILL. The dropdown said "Deleted from site"
       while the pill on the row said "Deleted" — one state under two names on
       the same screen, which leaves somebody wondering whether they are two
       different things. The pill has no room for the longer phrase, so the
       dropdown is the one that gives up the extra words. */
    ['deleted', 'Deleted'],
    // WORD FOR WORD WHAT THE PILL IN THE TABLE SAYS. It read "Under a removed
    // campaign" while the State column said "Campaign removed" — the same fact
    // under two names, one of them in a box labelled "Post state" with the
    // word *campaign* in it. Somebody looking for the removal filter matched
    // the pill text, went to the Campaign status box, and did not find it.
    // Twice. The filter belongs here, but it has to be called what the reader
    // has already been shown.
    ['removed', 'Campaign removed'],
    ['failed', 'Failed'],
    /* WORD FOR WORD WHAT THE PILL SAYS, like every other entry here. Two
     * names for one state on the same screen is the mistake the two comments
     * above this one both record. */
    ['written', 'Written, waiting'],
    ['planned', 'Not written yet'],
  ];

  /* ONLY THE STATUSES SOMETHING ACTUALLY WRITES.
   *
   * The schema's enum is not the list of values that occur. 'cancelled' is in
   * the enum and is read in two places, but NOTHING anywhere — no route, no
   * plugin action — ever sets it. Offering it here meant a filter guaranteed
   * to return nothing, every time, for everybody: the same dead end the empty
   * page above exists to prevent, built straight into the control that causes
   * it. It came from reading the enum and assuming the values were live
   * without checking who writes them.
   *
   * BOTH ARE REAL NOW, and neither was. 'cancelled' sat in the enum unset by
   * anything, and 'paused' was only ever written by blogSitesRoute.js when a
   * licence was revoked — so a campaign the owner paused in wp-admin still
   * read "In progress" here, and this box could not honestly offer the word.
   *
   * What changed is that the plugin's hourly reconciliation now carries each
   * campaign's status, so pausing and cancelling reach this side on their own.
   * Every option below is a value something actually writes.
   *
   * campaignStatusOf() still maps 'cancelled' rather than letting it fall
   * through to 'running': if something ever does set it, a campaign that was
   * abandoned must not quietly read as under way. */
  const CAMPAIGN_STATUSES = [
    ['', 'Any status'],
    ['running', 'In progress'],
    ['paused', 'Paused'],
    ['completed', 'Completed'],
    ['cancelled', 'Cancelled'],
    ['removed', 'Removed'],
  ];

  const active = anyFilter(f);

  return `
    <form method="GET" action="/blog-report" class="row g-2 align-items-end mb-4">
      ${/* The tab rides through the form, or filtering would silently throw
            you back to the other one. */ ''}
      <input type="hidden" name="view" value="${esc(f.view || 'campaigns')}">
      <div class="col-auto">
        <label class="form-label small muted mb-1">Campaign</label>
        <select name="campaign" class="form-select form-select-sm">
          ${option('', 'All campaigns', f.campaign)}
          ${campaigns.map(c => option(c, c, f.campaign)).join('')}
        </select>
      </div>
      <div class="col-auto">
        <label class="form-label small muted mb-1">Site</label>
        <select name="site" class="form-select form-select-sm">
          ${option('', 'All sites', f.site)}
          ${siteNames.map(n => option(n, n, f.site)).join('')}
        </select>
      </div>
      <div class="col-auto">
        <label class="form-label small muted mb-1">Campaign status</label>
        <select name="campaignStatus" class="form-select form-select-sm">
          ${CAMPAIGN_STATUSES.map(([v, l]) => option(v, l, f.campaignStatus)).join('')}
        </select>
      </div>
      <div class="col-auto">
        <label class="form-label small muted mb-1">Post state</label>
        <select name="state" class="form-select form-select-sm">
          ${STATES.map(([v, l]) => option(v, l, f.state)).join('')}
        </select>
      </div>
      <div class="col-auto">
        <label class="form-label small muted mb-1">From</label>
        <input type="date" name="from" class="form-control form-control-sm"
               value="${esc(f.from ? day(f.from) : '')}">
      </div>
      <div class="col-auto">
        <label class="form-label small muted mb-1">To</label>
        <input type="date" name="to" class="form-control form-control-sm"
               value="${esc(f.to ? day(f.to) : '')}">
      </div>
      <div class="col-auto">
        <button type="submit" class="btn btn-sm btn-primary">Filter</button>
      </div>
      ${active ? `<div class="col-auto"><a class="btn btn-sm btn-outline-light" href="/blog-report">Clear</a></div>` : ''}
      ${/* SAYS WHICH DATE, because it is not the same one on both tabs.
            Campaigns filter on when the campaign was created; posts filter
            on when the post went out or is due. Both are reasonable defaults
            for the thing being listed and neither is guessable from two
            boxes marked From and To — which is exactly how a correct result
            came to look like a broken filter.

            The sentence comes from dateFilterLabel() rather than being
            written here, so the rule and its description cannot drift. This
            file has lost that argument before. */ ''}
      <div class="col-12 small muted mt-1">${esc(dateFilterLabel(f.view || 'campaigns'))}</div>
    </form>`;
}

/** The current filters as a query string, for the CSV link. */
function queryString(f) {
  const parts = [];

  if (f.view && f.view !== 'campaigns') parts.push(`view=${encodeURIComponent(f.view)}`);
  if (f.campaignId) parts.push(`campaignId=${encodeURIComponent(f.campaignId)}`);
  if (f.campaign) parts.push(`campaign=${encodeURIComponent(f.campaign)}`);
  if (f.campaignStatus) parts.push(`campaignStatus=${encodeURIComponent(f.campaignStatus)}`);
  if (f.site) parts.push(`site=${encodeURIComponent(f.site)}`);
  if (f.state) parts.push(`state=${encodeURIComponent(f.state)}`);
  if (f.from) parts.push(`from=${day(f.from)}`);
  if (f.to) parts.push(`to=${day(f.to)}`);

  return parts.length ? `?${parts.join('&')}` : '';
}

router.get('/blog-report', requireAuth, async (req, res) => {
  try {
    const f = readFilters(req.query);

    /* REPAIR ON READ, because waiting for news that never comes is not a plan.
     *
     * A campaign whose posts have all gone live is finished, and this side can
     * see that from its own slots without asking anybody. It used to be
     * decided only when a site reported in — and a site with nothing new to
     * say correctly stays quiet, so two campaigns with every post live sat at
     * "In progress" through four deploys and a dozen presses of the button,
     * with both ends behaving perfectly.
     *
     * Cheap: one indexed query, and it writes only when something was
     * genuinely wrong. Run here because this is the page where a stale status
     * would be read, so the answer cannot be stale by the time it is shown. */
    await BlogCampaign.settleFinishedForUser(req.user._id);

    const rows = await rowsFor(req.user._id, f);
    const sites = await BlogSite.find({ user: req.user._id }).lean();

    /* The dropdown contents, read WITHOUT the filters.
     *
     * A light projection rather than reusing rowsFor's full fetch: this needs
     * two fields per campaign and none of the slots. It has to run even when
     * nothing matched, because that is precisely when the reader needs the
     * other options in front of them. */
    const allCampaigns = await BlogCampaign.find({ user: req.user._id })
      .select('name targetPage.title')
      .lean();

    const campaignNames = [...new Set(
      allCampaigns.map(campaignName).filter(Boolean)
    )].sort();

    const siteNames = [...new Set(sites.map(s => s.siteUrl).filter(Boolean))].sort();

    /* THREE NUMBERS, BECAUSE ONE WAS DESCRIBING THREE DIFFERENT THINGS.
     *
     * This line said "26 published of 48 planned" for a site carrying twelve
     * posts. Twenty-six had reached 'published' at some point; most belonged
     * to campaigns since deleted from the WordPress, and their links 404.
     *
     * "Published" now means what a reader assumes it means: on the site, now,
     * verifiable. The rest do not vanish — the credits were spent and a number
     * that quietly drops is its own kind of lie — they get their own figure
     * saying what is actually known about them, which for a removed campaign
     * is "the site stopped tracking this and we cannot check". */
    const counted = state => rows.filter(r => r.state === state).length;

    const published = counted('published');
    const deleted = counted('deleted');
    const removed = counted('removed');
    const scheduled = counted('scheduled');
    const written = counted('written');
    /* NO CREDIT TOTAL IN THE HEADLINE, for the same reason the per-row credits
     * column went: every post costs the same, so the figure is the post count
     * times 75 and carries no information the line does not already give. It
     * also put a money number in front of somebody reading the page to find
     * out what is live, which is a different question.
     *
     * The per-row figure stays in the CSV. A spreadsheet is where anybody
     * actually adds them up. */

    /* ONE SOURCE FOR THE NUMBER, because two disagreed in public.
     *
     * This line counted DISTINCT NAMES among removed rows while the tab
     * counted grouped campaigns, and the headline read "7 campaigns · 4
     * removed ... 36 under 6 removed campaigns". Both numbers were computed
     * honestly and one of them was wrong; a reader cannot tell which, so
     * neither is trusted again. */
    const campaignRows = campaignsFrom(rows);
    const removedCampaigns = campaignRows.filter(c => c.removedAt).length;

    /* TWO TABS, BECAUSE THEY ANSWER TWO QUESTIONS.
     *
     * "How many campaigns did I remove, when, and how big were they" cannot
     * be answered by filtering a list of posts. The removal date sits on
     * every one of a campaign's rows, so counting campaigns meant reading
     * thirty-six lines and deduplicating by eye. That is not a filter
     * problem and no filter was ever going to fix it. */
    const tab = (label, view, count) => {
      const on = (f.view || 'campaigns') === view;
      const href = `/blog-report${queryString({ ...f, view })}`;

      return `<a href="${href}" class="report-tab${on ? ' report-tab-on' : ''}">${esc(label)}`
        + ` <span class="muted">${count}</span></a>`;
    };

    /* TWO DIFFERENT EMPTY PAGES, BECAUSE THEY ARE TWO DIFFERENT FACTS.
     *
     * One page used to serve both. Pick "Deleted from site" on an account
     * whose posts are all live and the answer — correctly, zero rows — came
     * back as "Nothing yet. Once a campaign publishes its first post...":
     * a brand-new-account message shown to someone with forty-eight posts,
     * with the filter bar gone, so there was no Clear button and no way back
     * that did not involve the browser's Back arrow.
     *
     * An empty result is not the same as an empty account, and a filtered
     * page must never drop the controls that produced it. */
    if (!rows.length && !anyFilter(f)) {
      return send(res, page({
        title: 'Blog Report',
        body: `
          <h1 class="h3">Blog Report</h1>
          <p class="muted">Nothing yet. Once a campaign publishes its first post, every post shows
          up here with the page it links to.</p>
          <a class="btn btn-outline-light" href="/blog-sites">Blog Automation</a>`,
      }));
    }

    if (!rows.length) {
      return send(res, page({
        title: 'Blog Report',
        body: `
          <h1 class="h3">Blog Report</h1>

          ${/* THE TABS SURVIVE AN EMPTY RESULT, for the same reason the
                filter bar does. Filtering to nothing used to strip them off,
                so the one screen where a reader most wants to go and look
                somewhere else was the one screen with no way to move. Both
                counts read zero here, which is the honest answer: nothing
                matches on either tab. */ ''}
          <div class="report-tabs mb-3">
            ${tab('Campaigns', 'campaigns', 0)}
            ${tab('Posts', 'posts', 0)}
          </div>

          <p class="muted mb-4">No posts match those filters.</p>
          ${filterBar(f, campaignNames, siteNames)}
          <p class="muted" style="font-size:.85rem">
            Change a box above and press Filter, or
            <a href="/blog-report">show every post</a>.
          </p>`,
      }));
    }

    const campaigns = campaignRows;
    const removedNow = removedCampaigns;

    const body = `
      <div class="d-flex flex-wrap align-items-center gap-3 mb-1">
        <h1 class="h3 m-0">Blog Report</h1>
        <a class="btn btn-sm btn-outline-light ms-auto" href="/blog-report.csv${queryString(f)}">Download CSV</a>
      </div>

      <div class="report-tabs mb-3">
        ${tab('Campaigns', 'campaigns', campaigns.length)}
        ${tab('Posts', 'posts', rows.length)}
      </div>

      ${/* THE TOTAL LEADS, NOT THE CONFIRMED COUNT.
            This line used to open "0 published of 36" on an account holding
            thirty-six real articles. Every one of them HAD published; their
            campaigns were later deleted from WordPress, so the site stopped
            tracking them and nothing here can confirm they are still up.
            Cautious, and correct — but a bare 0 in front of thirty-six rows
            of published work reads as "your campaigns produced nothing",
            which is a worse lie than the one the caution was guarding
            against. The count of posts is a fact; how many are verifiable is
            a second fact, and it goes second. */ ''}
      <p class="muted mb-4">
        ${f.view === 'posts' ? '' : `<strong class="text-white">${campaigns.length}</strong> campaign${campaigns.length === 1 ? '' : 's'}
        ${removedNow ? `&middot; <span class="text-warning">${removedNow} removed</span>` : ''}
        &middot; `}
        <strong class="text-white">${rows.length}</strong> post${rows.length === 1 ? '' : 's'}
        &middot; ${published} confirmed live
        ${scheduled ? `&middot; ${scheduled} scheduled` : ''}
        ${/* SHOWN ONLY WHEN THERE ARE ANY, like scheduled and deleted beside
              it. On a healthy account this is always zero — 'ready' is a
              state posts pass through in seconds — so printing a nought
              would add a number that never moves and means nothing.
              It stops being zero exactly when something is holding posts
              back, which is when the owner needs to see it. */ ''}
        ${written ? `&middot; ${written} written, waiting` : ''}
        ${deleted ? `&middot; <span class="text-warning">${deleted} deleted</span>` : ''}
        ${removed ? `&middot; <span class="text-warning">${removed} under ${removedCampaigns} removed campaign${removedCampaigns === 1 ? '' : 's'}</span>` : ''}
      </p>

      ${filterBar(f, campaignNames, siteNames)}

      ${f.view === 'posts' ? '' : `
      <div class="table-responsive">
        <table class="table table-striped table-hover align-middle">
          <thead>
            <tr>
              <th class="rownum">#</th>
              <th>Campaign</th>
              <th>Site</th>
              <th>Status</th>
              ${/* THE THREE DATES SIT TOGETHER — created, approved, removed —
                    so a campaign's whole life is read left to right in one
                    place rather than at opposite ends of the row.

                    CREATED WAS ADDED 6 OCTOBER, AND NOT FOR COMPLETENESS.
                    The From/To boxes now filter THIS tab on the created
                    date, and a filter whose column is not on screen cannot
                    be checked by the person using it. Edwin filtered 1–5
                    October, got back a campaign approved on 28 September,
                    and had no way to tell a correct answer from a broken
                    one — the only dates shown were two the filter does not
                    look at.

                    The note that stood here argued approval, not creation,
                    is what "when did this start" means. Still true, and
                    Approved is still the column that answers it. It was
                    never the whole answer. */ ''}
              <th>Created</th>
              <th>Approved</th>
              <th>Removed</th>
              <th class="num">Posts</th>
              <th class="num">Live</th>
              <th class="num">Deleted</th>
            </tr>
          </thead>
          <tbody>
            ${campaigns.map(c => `
              <tr>
                <td class="rownum">${c.n}</td>
                ${/* BY ID, NOT BY NAME. Two campaigns can share a name on
                      one site — re-planning a money page does it, and this
                      account has three such pairs — so a drill-through
                      filtered by name showed both campaigns' posts with no
                      way to tell which was which. */ ''}
                <td>
                  <a href="/blog-report${queryString({ view: 'posts', campaignId: c.campaignId })}"
                     class="report-link">${esc(c.campaign)}</a>
                  <a href="/blog-report${queryString({ view: 'posts', campaignId: c.campaignId })}"
                     class="btn btn-sm btn-outline-success report-check">Check posts</a>
                </td>
                <td class="muted">${esc(c.site)}</td>
                ${/* RED, LIKE THE REMOVAL DATE BESIDE IT. Muted grey read as
                      "less important"; this is the opposite — it is the word
                      that tells you the campaign is gone. The two cells now
                      carry the same signal and are read together. */ ''}
                <td class="${c.removedAt ? 'text-danger' : ''}"
                    ${c.removedAt ? 'title="What the campaign was doing on the day it was deleted from WordPress. Nothing has changed it since, and nothing can: the site no longer reports on it."' : ''}>${esc(campaignLabel(c))}</td>
                ${/* A DASH MEANS NOT APPROVED YET, and it is a real answer
                      rather than missing data: the campaign is planned, the
                      credits are still yours, and nothing has been written.
                      A blank cell would read as a rendering fault.

                      Worth the column because several campaigns on this
                      account share a name — "quality plumbing leander"
                      twice, "Unclogging Sewer Line Services" twice — and the
                      approval date is what tells them apart at a glance. */ ''}
                ${/* ALWAYS A DATE, never a dash — which is the property that
                      made it the one the filter uses. See dateFilteredOn()
                      in reportFilters.js: filtering on Approved would have
                      hidden every unapproved campaign without saying so. */ ''}
                <td class="muted date">${esc(shownDay(c.createdAt)) || '&mdash;'}</td>
                <td class="muted date">${esc(shownDay(c.approvedAt)) || '&mdash;'}</td>
                <td class="date ${c.removedAt ? 'text-danger' : 'muted'}">${esc(shownDay(c.removedAt)) || '&mdash;'}</td>
                <td class="num">${c.posts}</td>
                ${/* A DASH, NOT A ZERO, once the campaign is gone.
                      Its posts are almost certainly still on the site — that
                      is what the note under this table says — but the site
                      stopped tracking them, so nothing here can confirm it.
                      "0" beside "12 posts" reads as "this campaign produced
                      nothing", which is the same lie the headline used to
                      tell with "0 published of 36". Unknown is not zero. */ ''}
                <td class="num ${c.removedAt ? 'muted' : ''}"
                    ${c.removedAt ? 'title="The campaign was deleted from WordPress, so the site no longer reports on these posts. Most are probably still up."' : ''}>
                  ${c.removedAt ? '&mdash;' : c.published}
                </td>
                <td class="num ${c.deleted ? 'text-warning' : 'muted'}">${c.deleted || '&mdash;'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <p class="muted mt-4" style="font-size:.85rem">
        One line per campaign. <strong>Removed</strong> is the day the campaign was
        deleted from its WordPress &mdash; its posts usually stay on the site, which is
        why they are still counted here. Click a campaign to see its articles.
      </p>`}

      ${f.view !== 'posts' ? '' : `
      <div class="table-responsive">
        <table class="table table-striped table-hover align-middle">
          <thead>
            <tr>
              <th class="rownum">#</th>
              ${/* NOT "Published", because the column holds two different
                    facts: when a post went out, and when one is due to. */ ''}
              <th>Date</th>
              <th>Post</th>
              <th>Links to</th>
              ${/* NOT "Keyword", which never said WHOSE. The money page has a
                    keyword too, and the two are deliberately different — a
                    post aiming at the same query as the page it links to
                    competes with it. This column is the search the POST was
                    written to answer. Matches `this_post_main_topic` in the
                    CSV. */ ''}
              <th>Main topic</th>
              <th>Campaign</th>
              <th>Site</th>
              <th>State</th>
              ${/* NO PER-ROW CREDITS COLUMN. Every row costs the same, so a
                    column repeating "75" forty-eight times carried no
                    information and took width from the columns that do. The
                    total is still in the line above the table, and the CSV
                    still carries the per-row figure, because a spreadsheet is
                    where somebody actually adds them up. */ ''}
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td class="rownum">${r.n}</td>
                ${/* A DATE UNDER "PUBLISHED" FOR A POST THAT NEVER PUBLISHED.
                      This cell fell back to publishAt with nothing to mark
                      the difference, so eight scheduled posts showed eight
                      dates in a column headed PUBLISHED — directly under a
                      headline reading "0 confirmed live". The CSV was honest
                      the whole time, carrying published_date empty and
                      planned_date filled; only the screen conflated them.

                      Same fault as the plugin's "6 of 6 scheduled, 1 live"
                      on a campaign whose posts were all deleted: a value
                      that cannot be true is worse than no value. The STATE
                      pill already says which a row is; the date was
                      contradicting it.

                      "due" rather than a second column, because one of the
                      two would be empty on every row. */ ''}
                <td class="muted date">${r.publishedAt
                  ? esc(shownDay(r.publishedAt))
                  : (r.publishAt ? `<span class="due">due ${esc(shownDay(r.publishAt))}</span>` : '')}
                  ${/* PUBLISHED, AND THEN THE CAMPAIGN WENT. Two facts that
                        contradict each other at a glance: a real publication
                        date beside a pill reading "Campaign removed". Both
                        are true and the order is what reconciles them — it
                        went out, and the campaign was deleted afterwards.
                        The pill cannot say that; it has one word.

                        Only when BOTH are true. A row that never published
                        already says "due", and a note under it would be
                        explaining something that did not happen. */ ''}
                  ${r.publishedAt && r.removedAt
                    ? `<div class="note">published, but the campaign was removed</div>`
                    : ''}</td>
                <td>
                  ${/* NOT A LINK ONCE THE POST IS GONE — the same guard the
                        plugin's tables carry. The URL is still stored and
                        still looks perfectly good; following it gets a 404.
                        A link that fails teaches the reader to distrust the
                        whole report, so the title is shown as plain text and
                        the pill says why. */ ''}
                  ${r.url && r.state === 'published'
                    ? `<a href="${esc(r.url)}" target="_blank" rel="noreferrer">${esc(r.title || r.topic)}</a>`
                    : esc(r.title || r.topic)}
                  ${r.deletedAt
                    ? `<div class="text-warning" style="font-size:.78rem">deleted ${esc(shownDay(r.deletedAt))}</div>`
                    : ''}
                </td>
                <td>
                  ${r.moneyPageUrl
                    ? `<a href="${esc(r.moneyPageUrl)}" target="_blank" rel="noreferrer">${esc(r.moneyPage)}</a>`
                    : esc(r.moneyPage)}
                  ${/* NAMED, because quotation marks alone do not say what
                        the phrase IS. A grey quoted fragment under a page
                        name reads as a subtitle, a tagline, or the start of
                        the post — and the one thing it actually is, the
                        clickable words carrying the link, is the thing
                        anybody auditing this page came to see.

                        "TO MONEY PAGE" spelled out even though the money page
                        name is directly above it, so this label and the CSV
                        column `anchor_text_to_money_page` are the SAME words.
                        Somebody checking a spreadsheet row against the screen
                        should not have to translate between two names for one
                        value — and a post has other anchors, pointing at its
                        sibling posts, which this is not. */ ''}
                  ${r.anchor ? `<div class="muted" style="font-size:.78rem">Anchor text to money page: &ldquo;${esc(r.anchor)}&rdquo;</div>` : ''}
                </td>
                <td class="muted">${esc(r.keyword)}</td>
                <td>
                  ${/* The fastest way to "show me just this campaign" is the
                        name already on the row. */ ''}
                  <a href="/blog-report?campaign=${encodeURIComponent(r.campaign)}"
                     class="report-link">${esc(r.campaign)}</a>
                  ${r.removedAt
                    ? `<div class="text-danger" style="font-size:.78rem">removed ${esc(shownDay(r.removedAt))}</div>`
                    : ''}
                </td>
                <td class="muted">${esc(r.site)}</td>
                <td>${slotPill(r)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <p class="muted mt-4" style="font-size:.85rem">
        <strong>Published</strong> means the post is on the site now.
        <strong>Deleted</strong> means it was published and then removed from the site;
        it is kept here because the credits were spent and that record has to survive.
        <strong>Campaign removed</strong> means the campaign was deleted from its
        WordPress, so the site no longer tracks those posts &mdash; some may still be
        live and some may not, and nothing here can tell which.
        Neither is counted as published, and neither is linked, because a link that
        404s makes the whole page harder to trust.
      </p>`}`;

    send(res, page({ title: 'Blog Report', body }));

  } catch (err) {
    log.error('blogReport.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Blog Report',
      body: '<h1 class="h3">Blog Report</h1><p>Could not build the report just now.</p>',
    }));
  }
});


/**
 * The same rows as a spreadsheet.
 *
 * ONE ROW PER POST, and every column flat. A report someone opens in Excel to
 * send a client should not need them to unpick nested campaigns.
 */
router.get('/blog-report.csv', requireAuth, async (req, res) => {
  try {
    const rows = await rowsFor(req.user._id, readFilters(req.query));

    /* post_number AND campaign_number, matching the two tabs on screen.
     *
     * The export exists so somebody can quote a row back at you, and a row
     * number that only exists on the web page is the one thing they cannot
     * quote. They are the SAME numbers: assigned before any filter, so an
     * export of a filtered report carries the numbers those rows have on the
     * full report rather than 1..n of whatever survived the filter. */
    /* TWO COLUMNS NAMED FOR WHAT THEY ARE, not for what an SEO calls them.
     *
     * `anchor_text` was not merely vague, it was AMBIGUOUS. A post contains
     * several anchors: the one pointing at the money page, and one for every
     * link to a sibling post in the same campaign (slot.linkPhrase, frozen at
     * planning time). A column called `anchor_text` claims all of them and
     * holds one. On screen the phrase sits inside the "Links to" column,
     * directly beneath the money page name, so its neighbours say what it is;
     * lifted into a spreadsheet it becomes a lone header with nothing around
     * it. The name now carries the destination itself.
     *
     * `keyword` said whose keyword nowhere. The money page has one too, and
     * the two must differ — a post competing with the page it feeds is worse
     * than no post. This column is slot.targetQuery: the search THIS POST was
     * written to answer.
     *
     * ALL UNDERSCORES, no hyphens. `this_post_main-topic` parses as
     * `this_post_main` MINUS `topic` in pandas, SQL and Sheets QUERY(), so a
     * header that reads fine in Excel would break every formula pointed at
     * it. Renaming these breaks spreadsheets built on the old names — which
     * is why the header is asserted in test-blog-report.js from now on. */
    const header = [
      'post_number', 'published_date', 'planned_date', 'post_title', 'post_url',
      'links_to_page', 'links_to_url', 'anchor_text_to_money_page', 'this_post_main_topic',
      'campaign_number', 'campaign', 'campaign_status',
      'campaign_created_date', 'campaign_approved_date', 'campaign_removed_date',
      'site', 'site_status', 'post_state', 'post_deleted_date', 'credits',
    ];

    /**
     * CSV escaping, and the leading-quote guard.
     *
     * A field starting with = + - or @ is executed as a formula when the file
     * is opened in Excel or Sheets. These fields come from a customer's
     * WordPress, so a post title beginning with "=" is somebody else's input
     * reaching a spreadsheet on this customer's machine. Prefixing a single
     * quote stops it being read as a formula and is invisible in the cell.
     */
    const cell = value => {
      let s = String(value == null ? '' : value);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };

    const lines = [header.join(',')];

    /*
     * post_state stays the STORED status, unchanged, and the deletion arrives
     * as its own column beside it. A spreadsheet gets filtered and pivoted;
     * collapsing the two facts into one cell would make "how many did we
     * publish, and how many of those survive" unanswerable from the export.
     *
     * Kept OUT of the array below on purpose — the column-count check in
     * test-blog-report.js reads this source and splits on commas, so prose
     * inside the array is counted as columns.
     */
    for (const r of rows) {
      lines.push([
        r.n, day(r.publishedAt), day(r.publishAt), r.title || r.topic, r.url,
        r.moneyPage, r.moneyPageUrl, r.anchor, r.keyword,
        r.campaignN, r.campaign, r.campaignStatus,
        day(r.campaignCreatedAt), day(r.campaignApprovedAt), day(r.removedAt),
        r.site, r.siteStatus, r.slotStatus, day(r.deletedAt), r.credits,
      ].map(cell).join(','));
    }

    const filename = `blog-report-${day(new Date())}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // A BOM, so Excel on Windows reads it as UTF-8 rather than mangling every
    // accented character in a post title.
    res.send(EXCEL_BOM + lines.join('\r\n') + '\r\n');

  } catch (err) {
    log.error('blogReport.csv.failed', err, { requestId: req.id });
    res.status(500).send('Could not build the report just now.');
  }
});

// The router itself, as every other route file exports — server.js does
// `app.use('/', requireAuth, blogReportRoute)` and an object would break that.
// The helpers ride along as properties so the tests can reach them without a
// second module.
module.exports = router;
module.exports.rowsFor = rowsFor;
module.exports.stateOf = stateOf;
module.exports.readFilters = readFilters;
module.exports.keep = keep;
module.exports.esc = esc;
module.exports.day = day;
module.exports.shownDay = shownDay;
module.exports.filterBar = filterBar;
module.exports.campaignName = campaignName;
module.exports.anyFilter = anyFilter;
module.exports.campaignStatusOf = campaignStatusOf;
