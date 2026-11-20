// utils/cloudflareSites/releasedHostname.js
//
// Handing a hostname back when the site that held it is gone.
//
//   isFreed(site)        nothing of this site is left at Cloudflare
//   hostnameOf(site)     the hostname to SHOW, freed or not
//   freeHostname(site)   take the hostname off a dead row (mutates)
//   sweep(Model)         the same, once, for rows released before this
//
//
// THE BUG THIS FILE IS THE ANSWER TO — 20 November, site 4 of a batch of 7
//
// Edwin deleted seven test sites and built seven more. Six went live. The
// one that failed was the only one whose FULL address — subdomain and
// domain together — repeated an address he had just deleted:
//
//     pt-air-conditioning-austin.2-r2.com    released 01:16:18
//     pt-air-conditioning-austin.2-r2.com    refused   02:01:41
//
// Forty-five minutes apart, and the row said all three parts had been taken
// down at Cloudflare cleanly.
//
//
// WHY THE CHECK SAID YES AND THE DATABASE SAID NO
//
// Two different things guard a hostname, and on 17 November only one of
// them was taught the rule:
//
//     checkWant()   findOne({ siteUrl, $nor: [RELEASED] })   → nothing, free
//     create()      unique index on siteUrl                  → E11000
//
// An index cannot be told that some rows do not count. It holds every row
// with that value, released or not. So the refusal arrived as a DUPLICATE
// KEY, which createAndPublish() reads as `raced` — a word that means two
// requests collided, reported about a batch that builds one site at a time.
//
//     THE CODE ALREADY SAID SO, in createAndPublish(), nine lines above
//     the create: "The unique index on siteUrl means that claim cannot be
//     given back without deleting the row."
//
// One half of the file knew. The other half was fixed without it.
//
//
// SO THE ROW GIVES THE NAME BACK INSTEAD OF ARGUING FOR IT
//
// When a teardown releases all three, `siteUrl` becomes `released:<id>` —
// a value that is not a hostname and cannot be one — and the real hostname
// moves to `releasedUrl`. The index then has nothing to hold.
//
// NOT A DELETE, and that is the whole reason this file exists rather than a
// one-line `deleteOne`. The row is the only record that the site was ever
// there: its name, its publish count, its dates. Three result pages print
// its hostname AFTER the teardown has run, and they read `releasedUrl`.
//
// AND NOT A PARTIAL INDEX, which was the other way. Expressing "unique
// unless all three of these booleans are true" as a partialFilterExpression
// is awkward, and it is a migration on a live unique index — a window in
// which two rows can take the same hostname. This needs no index change at
// all.
//
//
// checkWant() KEEPS ITS `$nor` CLAUSE
//
// It is no longer the thing that frees a name — a freed row cannot match a
// hostname query, because its siteUrl is not a hostname any more. It still
// covers the rows this file deliberately does NOT touch: a delete that left
// a project behind releases nothing, holds its name, and should.
//
//     THE TWO RULES NOW AGREE INSTEAD OF OVERLAPPING. One decides whether
//     the site is done with the name; the other is what the name is.

'use strict';

/* NOT A HOSTNAME, AND IT CANNOT ACCIDENTALLY BECOME ONE. A colon is
 * illegal in a hostname and `normalisePrefix` would never produce one, so
 * no posted address can ever collide with a marker — which matters,
 * because the unique index is the only thing stopping two rows sharing a
 * value and these markers live in the same column as real hostnames. */
const MARKER = 'released:';

/**
 * Is there anything of this site left at Cloudflare?
 *
 * THE SAME THREE FACTS checkWant() EXCLUDES ON, read from the document
 * rather than written as a query a second time. A fourth place deciding
 * what "released" means is how the first three start disagreeing.
 */
function isFreed(site) {
  const r = (site && site.released) || {};

  return Boolean(r.domain && r.dns && r.project);
}

/** What a row's `siteUrl` becomes once it has handed the name back. */
function markerFor(site) {
  return `${MARKER}${String((site || {})._id || '')}`;
}

/**
 * Is this value a marker rather than an address?
 *
 * USED AS THE "ALREADY DONE" TEST, so freeing is idempotent: the sweep can
 * run on every boot and a second teardown on the same row changes nothing.
 */
function isMarker(value) {
  return String(value || '').startsWith(MARKER);
}

/**
 * The hostname to show for a row, whether or not it still holds one.
 *
 * EVERY SCREEN THAT CAN SEE A REMOVED ROW NEEDS THIS. The delete result,
 * the finish-removing result and the republish refusal all print the
 * hostname after the teardown has run — and after this file has run, the
 * field they used to read holds `released:6aff…` instead.
 *
 *     A FIX THAT MAKES THREE PAGES PRINT A DATABASE ID IS NOT A FIX.
 */
function hostnameOf(site) {
  if (!site) return '';

  return String(site.releasedUrl || '') || String(site.siteUrl || '');
}

/**
 * Hand the hostname back, if this row is finished with it.
 *
 * MUTATES AND DOES NOT SAVE, exactly like removeFromCloudflare() which
 * calls it — the caller decides when the document is written, because the
 * delete path and the retry path save at different points and one of them
 * also changes `status`.
 *
 * @param {object} site  a CloudflareSite document
 * @returns {boolean} whether anything changed
 */
function freeHostname(site) {
  if (!site || !isFreed(site)) return false;

  /* ALREADY DONE. Not an error and not worth a second write — the retry
   * button can be pressed on a row the first delete finished cleanly. */
  if (isMarker(site.siteUrl)) return false;

  site.releasedUrl = site.siteUrl;
  site.siteUrl = markerFor(site);

  return true;
}

/**
 * The same thing, once, for every row released before this shipped.
 *
 * WITHOUT THIS THE FIX ONLY HELPS SITES DELETED FROM NOW ON. Edwin had six
 * more addresses held by rows torn down cleanly on 19 November; each one
 * fails the same way, mid-batch, after the credits are spent — and the
 * failure is invisible until the CSV happens to pair that business with
 * that domain again.
 *
 * SAFE TO RUN ON EVERY BOOT. The query cannot match a row this has already
 * freed, so the second run finds nothing. It is written as a startup sweep
 * rather than a script somebody has to remember, for the reason
 * cleanupScheduler.js carries in its header: a maintenance job nobody runs
 * and a maintenance job with nothing to do look identical from outside.
 *
 * ONE DOCUMENT AT A TIME, because the new value depends on the row's own
 * `_id` and `updateMany` cannot write one. The set is tiny — it is every
 * site ever deleted cleanly — and it shrinks to nothing after the first
 * pass.
 *
 * IT DOES NOT THROW. A sweep that takes the server down on boot is worse
 * than a hostname that stays reserved; the caller gets the count and the
 * log has the reason.
 *
 * @param {object} Model  the CloudflareSite model
 * @param {object} [deps.log]
 * @returns {Promise<{freed: number, failed: number, error: string}>}
 */
async function sweep(Model, { log } = {}) {
  const out = { freed: 0, failed: 0, error: '' };

  try {
    const rows = await Model.find({
      'released.domain': true,
      'released.dns': true,
      'released.project': true,

      /* NOT ALREADY DONE. Anchored, so a site whose owner managed to call
       * their business "released:something" is not skipped — the anchor is
       * the test, not the substring. */
      siteUrl: { $not: new RegExp(`^${MARKER}`) },
    });

    for (const site of rows) {
      if (!freeHostname(site)) continue;

      try {
        await site.save();
        out.freed += 1;
      } catch (err) {
        /* ONE ROW'S PROBLEM IS NOT THE OTHERS'. A duplicate here would mean
         * two rows already share a marker, which cannot happen from an
         * ObjectId — but a save can fail for reasons that have nothing to
         * do with this field, and the next row deserves its turn. */
        out.failed += 1;

        if (log) {
          log.error('cfSites.freeHostname.failed', err, {
            siteId: String(site._id),
          });
        }
      }
    }
  } catch (err) {
    out.error = err.message;

    if (log) log.error('cfSites.freeHostname.sweepFailed', err, {});
  }

  return out;
}

module.exports = {
  MARKER,
  isFreed,
  isMarker,
  markerFor,
  hostnameOf,
  freeHostname,
  sweep,
};
