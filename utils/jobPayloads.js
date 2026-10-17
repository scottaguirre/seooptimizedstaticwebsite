// utils/jobPayloads.js
//
// Throwing away the recipe once the cake is gone.
//
// WHAT A PAYLOAD IS FOR
//
// Job.payload holds the entire wizard submission — business details, every
// service, every town, hours, social links. It exists because generation is a
// BACKGROUND JOB: the request stores the form, and a worker picks it up later
// and runs runGeneration({ body: job.payload, … }). It is also what makes a
// crashed build resumable, alongside completedPages.
//
// Those are its only two readers. Nothing in the app looks at it once the job
// is completed — checked by grep, not assumed.
//
// WHY IT IS CLEARED WHEN THE SITE GOES, AND NOT ON A CLOCK OF ITS OWN
//
// Edwin, 17 October: *"can we delete the payload once a site is deleted
// either because another site was built or because the 48 hours went by?"*
//
// That is a better rule than the one it replaced. A payload is the recipe for
// a particular site; the moment that site stops existing the recipe describes
// nothing. Tying its life to the site's means there is no second number to
// keep in step with BUILD_TTL_HOURS, and no window during which we hold a
// form for a website nobody can reach.
//
// It follows from his other decision the same day: a deleted site is gone for
// good, no rebuild. Without that, the payload would be the one thing standing
// between a swept site and getting it back.
//
// THE ROW IS KEPT. Only `payload` and `uploads` are emptied.
//
// The Job record is what the dashboard's expired card reads — kind 'site',
// status 'completed', finishedAt — to tell "your website was removed" from
// "you have never made one". Deleting the row would take the card with it and
// put back the exact message the card was built to replace. It is also the
// credits-charged history.
//
// So: the heavy fields go, the record stays.

'use strict';

const Job = require('../models/Job');
const { log } = require('./logger');

/** What is emptied. Everything else on the Job is small and still read. */
const EMPTY = { payload: {}, uploads: {} };

/**
 * Clear the stored form for completed site jobs belonging to these users.
 *
 * @param {Array<string>} userIds  owners whose site folder has just gone
 * @param {object} [opts]
 * @param {string} [opts.except]   a job id to leave alone
 * @param {string} [opts.reason]   for the log line
 * @returns {Promise<number>} how many were cleared
 *
 * ONLY 'completed' JOBS. A queued or running job is about to be handed its
 * payload by the worker — clearing one would hand runGeneration an empty form
 * and build a site out of nothing. A failed job keeps its payload too: it is
 * the only record of what was attempted, and it is what a retry would read.
 *
 * ALREADY-EMPTY ONES ARE SKIPPED by the query rather than rewritten, so a
 * sweep over a user who has been here for months costs one indexed lookup and
 * no writes.
 */
async function clearForUsers(userIds, opts = {}) {
  /* FILTERED BEFORE STRINGIFYING, and the order is the bug that was.
   *
   * It read `.map(String).filter(Boolean)` — and String(null) is the
   * four-character string 'null', which is perfectly truthy. A list
   * containing a null arrived at Mongo as a user id, matching nothing but
   * costing a query, and `[null]` was not the empty list the guard below
   * thought it was. Caught by the junk test. */
  const users = [...new Set(
    (userIds || []).filter(Boolean).map(String).filter(Boolean)
  )];
  if (!users.length) return 0;

  const where = {
    user: { $in: users },
    kind: 'site',
    status: 'completed',
    payload: { $nin: [null, {}] },
  };

  if (opts.except) where._id = { $ne: opts.except };

  try {
    const result = await Job.updateMany(where, { $set: EMPTY });
    const cleared = result.modifiedCount || 0;

    /* Logged even at zero, for the same reason the sweepers are. A line
     * reading 0 is what tells "nothing was due" from "this never runs", and
     * from outside the process those look identical. */
    log.info('jobs.payloadsCleared', {
      cleared,
      users: users.length,
      reason: opts.reason || 'site removed',
    });

    return cleared;

  } catch (err) {
    /* Swallowed. This is housekeeping that runs after the real work: a
     * failed clear leaves a few kilobytes behind and will be tried again the
     * next time that user's site goes. Throwing would take down either the
     * hourly sweep or the generation that called it, and both matter more
     * than the kilobytes. */
    log.error('jobs.payloadClearFailed', err, { users: users.length });
    return 0;
  }
}

/**
 * The user ids inside a list of swept folder names.
 *
 * cleanupScheduler deletes entries called `user_<id>` from dist/ and
 * builds/work/, and `user_<id>.zip` from builds/zips/. This turns those names
 * back into ids so the payloads can follow the files.
 *
 * Anything that does not match is dropped rather than guessed at — the
 * sweeper's patterns and this one would otherwise be two places that have to
 * agree about a filename format.
 */
function usersFromSwept(names = []) {
  const out = new Set();

  for (const name of names) {
    const match = /^user_([A-Za-z0-9]+)(?:\.zip)?$/.exec(String(name || ''));
    if (match) out.add(match[1]);
  }

  return [...out];
}

module.exports = { clearForUsers, usersFromSwept, EMPTY };
