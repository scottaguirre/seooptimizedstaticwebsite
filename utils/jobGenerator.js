// utils/jobGenerator.js
//
// The bridge between a Job record and whichever builder its mode needs.
//
// Kept separate from both so neither has to know about the other: the runner
// deals in jobs and knows nothing about site building, and the builders take
// a plain context and know nothing about queues. This is the only file that
// understands both.
//
// AND IT IS THE ONLY FILE THAT CHOOSES BETWEEN THE TWO BUILDERS.
// Rank Fast, Rank GBPs and One-Page Design go through runGeneration();
// Local Website Options goes through runLocalOptions(). The reason they are
// separate files rather than a branch inside the big one is written at the
// top of utils/runLocalOptions.js. The reason the choice is made HERE is
// that both take the identical context and return the identical result, so
// this is the one place where that fact is worth anything.

const User = require('../models/User');
const { runGeneration } = require('./runGeneration');
const { runLocalOptions } = require('./runLocalOptions');
const { cleanupJobUploads, filesFromJob } = require('./jobUploads');
const { clearForUsers } = require('./jobPayloads');
const { MODES, normalizeSiteMode } = require('./seoPresets');
const { log } = require('./logger');
/* The destination the submission carried, read out of either body shape —
 * the payload IS the posted body, so both shapes reach here too. */
const { siteTargetOf, wantedAddress } = require('./cloudflareSites/wanted');

/**
 * Which builder this job needs.
 *
 * READ OUT OF THE PAYLOAD, NOT OFF job.siteMode.
 *
 * Both are written by the route and they agree — but the payload is what
 * every builder actually reads, and runGeneration resolves the mode from it
 * again on its own. Taking the decision from the same place keeps the two
 * from ever disagreeing about one job. The `siteMode` column exists so lists
 * and support queries can filter without opening the payload; that is a
 * different job from this one.
 *
 * normalizeSiteMode() falls back to 'lead', so a job with no mode at all —
 * every row written before the field existed — builds the way it always did.
 */
function builderFor(job) {
  const siteMode = normalizeSiteMode(
    job.payload?.global?.siteMode ?? job.payload?.['global[siteMode]']
  );

  return siteMode === MODES.LOCAL_OPTIONS
    ? { siteMode, build: runLocalOptions }
    : { siteMode, build: runGeneration };
}

/**
 * @param {object} job                 the Job document
 * @param {object} handlers
 * @param {Function} handlers.onProgress
 */
/**
 * A sentence for a refusal code from createAndPublish().
 *
 * THE CODES ARE FOR THE SCREEN THAT HAS PAGES FOR THEM. That route turns
 * each one into a titled page with a Back button; a job has one line on a
 * progress page, so it needs the same meanings in one sentence each.
 *
 * NOT RE-EXPORTED FROM THE ROUTE, because the two audiences differ: the
 * form's reader is looking at the field they just filled in, this one is
 * looking at a build that finished and did not go up.
 */
function refusalText(out) {
  switch (out.code) {
    case 'badName':   return 'The website needs a name and a subdomain.';
    case 'badDomain': return 'That domain is not available for websites.';
    case 'taken':     return `${out.domain || 'That address'} is already in use.`;
    case 'raced':     return 'That address was taken a moment before this finished.';
    case 'tooMany':   return `You have reached the limit of ${out.limit} websites.`;
    case 'full':      return `${out.domain || 'That domain'} has no room left on its Cloudflare account.`;
    case 'noBuild':   return out.error || 'There was no build to publish.';
    default:          return 'The website was built but could not be published.';
  }
}

async function generateForJob(job, { onProgress }) {
  // Loaded fresh rather than taken from the job: the balance may have
  // changed since it was queued, and charging is based on the live value.
  const user = await User.findById(job.user);
  if (!user) {
    throw new Error('The user who queued this job no longer exists');
  }

  /* THE PREVIOUS SITE IS ABOUT TO BE DELETED, SO ITS FORM CAN GO TOO.
   *
   * runGeneration's step 2 calls resetUserDirs(), which rmSyncs
   * dist/user_<id>. There is one folder per USER, not one per site, so
   * starting this build destroys whatever was there — the 48-hour sweep is
   * not the only way a site disappears, and it is not even the common one.
   *
   * Their payloads describe a website that is seconds from not existing, and
   * a swept or overwritten site is gone for good rather than rebuildable, so
   * nothing will read them again.
   *
   * `except` is belt and braces: this job is 'running', and clearForUsers
   * only touches 'completed' ones, so it could not be hit. Naming it anyway
   * means a future change to either rule cannot quietly empty the form of
   * the build currently using it.
   *
   * BEFORE runGeneration rather than after, and the window that opens is
   * harmless: if this build fails before step 2 the old site survives with
   * its payload cleared, and that payload was only ever going to be read by
   * a resume of the OLD job, which has already completed. Doing it
   * afterwards would miss every build that crashes half way — exactly the
   * ones that leave the most behind. */
  await clearForUsers([job.user], {
    except: job._id,
    reason: 'replaced by a new build',
  });

  const { siteMode, build } = builderFor(job);

  log.info('jobs.builderChosen', {
    jobId: String(job._id),
    siteMode,
    builder: build === runLocalOptions ? 'runLocalOptions' : 'runGeneration',
  });

  try {
    const result = await build({
      body: job.payload,
      files: filesFromJob(job.uploads || {}),
      user,
      requestId: `job:${job._id}`,

      // Forwarded straight through. The builder calls this as each page
      // completes; the runner persists it, which is what makes a restart
      // resume rather than start over.
      onProgress,

      /* Pages already written by an earlier attempt. runGeneration skips
       * them rather than paying to regenerate content the user has.
       *
       * runLocalOptions IGNORES THIS, on purpose. Its build is seven model
       * calls and about nineteen cents, and a half-written eleven-page site
       * is worth nothing to hand back — so a restart starts over. Passed
       * anyway rather than conditionally, because a context that changes
       * shape by mode is a context where the next field gets forgotten for
       * one of them. */
      alreadyCompleted: job.completedPages || [],
    });

    /* THE PUBLISH OUTCOME TRAVELS WITH THE JOB, OR NOBODY EVER SEES IT.
     *
     * runLocalOptions hands back `published` — null for an account with no
     * GitHub installation, `{ok:false, error}` when the push failed, the
     * push result when it worked. Three states, deliberately distinct.
     *
     * The runner only persists `result.result`, so `published` was being
     * dropped on the floor. On 11 November two builds published nothing and
     * both jobs said `completed` with 800 credits charged, because the one
     * value that knew otherwise never left this function.
     *
     *     A BUILD THAT WAS PAID FOR AND DID NOT GO LIVE IS NOT A COMPLETED
     *     BUILD WITH NOTHING TO SAY. It is the one case the customer most
     *     needs told about, and it was the quietest thing the job did.
     *
     * NOT THE WHOLE OBJECT. A successful publish carries file counts and
     * shas; the progress page needs to know whether it worked and, if not,
     * why. Everything else is noise in a Mongo document. */
    /* THE DESTINATION IS ASKED FIRST, AND IT USED TO BE ASKED LAST.
     *
     * The GitHub branch below returns as soon as the builder reports
     * `published` — which runLocalOptions always does, even as `null` for an
     * account with no installation. So a Local Website Options build bound
     * for Cloudflare returned here and never reached the publish step at the
     * bottom of this function: eleven pages built, paid for, and left on
     * disk with the job saying `completed`.
     *
     *     A FUNCTION THAT CHECKS WHERE IT HAS BEEN BEFORE IT CHECKS WHERE
     *     IT IS GOING ONLY EVER WORKS FOR ONE DESTINATION.
     *
     * Reading the target first makes the two builders agree: whoever built
     * it, a site addressed to Cloudflare is published to Cloudflare. The
     * runGeneration path reached the block below already, because it reports
     * no `published` at all — so this changes nothing for it. */
    const target = siteTargetOf(job.payload);

    if (result && result.published !== undefined && 'cloudflare' !== target) {
      const p = result.published;

      return Object.assign({}, result, {
        result: {
          published: p ? {
            /* `ok` is absent on success — publishSite returns commit data,
             * and only the catch in runLocalOptions sets `ok: false`. So
             * the test is for the failure, not for the success. */
            ok: false !== p.ok,
            error: p.error || '',
            owner: p.owner || '',
            repo: p.repo || '',
          } : null,
        },
      });
    }

    /* THE CLOUDFLARE DESTINATION — 16 November.
     *
     * A Cloudflare website used to be made in two visits: build here, then
     * go to /cloudflare-sites and publish the last build. The wizard now
     * carries a DESTINATION alongside its mode, and this is where the two
     * halves join.
     *
     * AFTER THE BUILD, NOT INSTEAD OF IT. Everything above has already run
     * and the credits are already spent; this step only decides whether the
     * finished site goes up.
     *
     * createAndPublish() RATHER THAN A SECOND IMPLEMENTATION. The seven
     * checks it runs — name, domain in the website pool, hostname clash
     * across both products, the per-user guard, Cloudflare's 100-project
     * ceiling, a build on disk, then the publish — are the ones the form on
     * that screen runs. Writing them again here is how the two paths start
     * disagreeing about what is allowed, which is exactly what
     * utils/domainPool.js was written after.
     *
     * REQUIRED HERE, NOT AT THE TOP. The route pulls in express and a dozen
     * models; this module is loaded by the job runner in every process,
     * including ones that never build a site. The rebuild job requires it
     * the same way and for the same reason.
     *
     * IT REPORTS LIKE THE GITHUB PATH ABOVE, through `published`, because
     * the note there is the lesson: a build that was paid for and did not
     * go live is the one case the customer most needs told about, and it
     * was the quietest thing this function did. */
    if ('cloudflare' === target) {
      const { createAndPublish } = require('../routes/cloudflareSitesRoute');

      const out = await createAndPublish({
        userId: job.user,
        requestId: `job:${job._id}`,
        want: wantedAddress(job.payload),
      });

      log.info('jobs.cloudflarePublish', {
        jobId: String(job._id),
        ok: Boolean(out.ok),
        code: out.code || '',
        siteId: out.site ? String(out.site._id) : '',
      });

      /* THE ROW EXISTS EITHER WAY WHEN THE PUBLISH ITSELF FAILED, so the
       * message can say where to go. createAndPublish writes it before
       * attempting the deploy for exactly this reason — see the note on
       * the first-publish failure in that route. */
      return Object.assign({}, result, {
        result: {
          published: {
            ok: Boolean(out.ok),
            error: out.ok ? '' : (out.error || refusalText(out)),
            url: out.site ? `https://${out.site.siteUrl}` : '',
            siteId: out.site ? String(out.site._id) : '',
          },
        },
      });
    }

    return result;

  } finally {
    // The logo and favicon are no longer needed once the site is built —
    // they have been copied into the user's assets folder.
    await cleanupJobUploads(job._id).catch(err =>
      log.error('jobs.uploadCleanupFailed', err, { jobId: String(job._id) })
    );
  }
}

module.exports = {
  generateForJob,

  /* Exported for test-local-options-wiring.js. Which builder a job gets is
   * the whole decision this file makes, and the only honest way to test it
   * is to ask — generateForJob() would have to load a User out of Mongo and
   * run a build to tell you the same thing. */
  builderFor,
};