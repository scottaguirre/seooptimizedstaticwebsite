// utils/dashboardSite.js
//
// What the dashboard's website card should say, given what is on disk and
// what the job queue is doing.
//
// WHY THIS IS A FUNCTION AND NOT THREE LINES OF TEMPLATE
//
// Edwin submitted a sixty-page build, closed the tab, came back, and the
// dashboard said "22 pages · generated 2 minutes ago" with a Preview button
// on it. Pressing it gave him:
//
//     Cannot GET /dist/user_6a85431b3180a38c78b5f40c/
//
// Nothing was broken. getCurrentSite() counts the .html files currently on
// disk, and twenty-two of them existed — but index.html is written near the
// END of a build, with the About Us page, and express.static has nothing to
// serve for a directory without one.
//
// So the card was telling the truth about the files and lying about the
// state. "Generated 2 minutes ago" describes a finished thing. His first
// question was whether he had crashed the server by closing the tab.
//
// THE RULE IT GETS WRONG IS NOT THE PAGE COUNT — it is which question the
// card is answering. A count of files cannot distinguish "finished" from
// "half way", and the job queue can. So the state comes from the JOB, and the
// count stays as the honest detail underneath it.
//
// Pulled out of the route because a template literal inside a route handler
// cannot be called by a test without stubbing Express, a session, a database
// and the CSRF field — and this project has learned twice in two days that
// what cannot be tested directly ends up guarded by a source grep instead.

'use strict';

/** Jobs that mean "a website is being built right now". */
const ACTIVE = ['queued', 'running'];

/**
 * @param {object|null} site      getCurrentSite()'s output
 * @param {object|null} activeJob a Job with status queued or running, if any
 * @returns {{state: string, subtitle: string, jobId: string}}
 *
 *   building  a build is in flight. Whatever is on disk is a half-written
 *             site, and the buttons must not be offered.
 *   ready     a finished site, nothing running.
 *   none      nothing to show.
 */
function siteCardState(site, activeJob) {
  const job = activeJob && ACTIVE.includes(String(activeJob.status || ''))
    ? activeJob
    : null;

  if (job) {
    /* THE COUNT IS STILL WORTH SHOWING, and it is the one number here that
     * is honestly known. What changes is the verb: "37 pages so far" invites
     * waiting, "37 pages generated" invites pressing a button that 404s.
     *
     * WITH A TOTAL NEXT TO IT, COUNTED FROM THE JOB AND NOT FROM THE FOLDER.
     * "37 pages so far" does not say whether that is nearly done or barely
     * started. The job knows: it was created with a total.
     *
     * Both numbers have to come from the SAME source, which is why this no
     * longer reads site.pageCount first. The folder and the job count
     * different things — the job's total is services + towns + the home
     * page, while the folder also holds contact, privacy, terms and
     * accessibility — so late in a build the file count OVERTAKES the total,
     * and "63 of 60 pages" is worse than no total at all.
     *
     * The file count stays as the fallback for the gap at the start, where a
     * job exists and has not reported anything yet. */
    const progress = job.progress && 'object' === typeof job.progress ? job.progress : {};
    const total = Number(progress.total) || 0;
    const done = Number(progress.done) || 0;
    const built = done || (site ? Number(site.pageCount) || 0 : 0);

    /* THE FRACTION IS ONLY DRAWN WHEN BOTH HALVES CAME FROM THE JOB —
     * `done > 0`, not `built > 0`. Written the loose way first, and the test
     * caught it: a job that had not reported yet fell back to the 41 files on
     * disk and then put them over the job's total of 60, which is the very
     * mixing the paragraph above exists to prevent.
     *
     * A total below the count means a job whose total was never set. Either
     * way the pair would read as an error, so the bare count is shown. */
    const fraction = done > 0 && total >= done;
    const last = fraction ? total : built;

    const so_far = built
      ? `${fraction ? `${built} of ${total}` : built} page${1 === last ? '' : 's'} so far`
      : 'just started';

    return {
      state: 'building',
      subtitle: `Still generating — ${so_far}`,
      jobId: String(job._id || job.id || ''),
    };
  }

  if (!site) {
    return { state: 'none', subtitle: '', jobId: '' };
  }

  return {
    state: 'ready',
    subtitle: [
      site.location ? site.location : '',
      `${site.pageCount} page${1 === site.pageCount ? '' : 's'}`,
      `generated ${site.generatedAgo}`,
    ].filter(Boolean).join(' · '),
    jobId: '',
  };
}

module.exports = { siteCardState, ACTIVE };
