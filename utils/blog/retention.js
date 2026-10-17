// utils/blog/retention.js
//
// When a stored article may be thrown away, and when it may not.
//
// WHY THERE IS A FILE FOR THIS
//
// models/BlogPost.js used to carry a note headed "Deliberately NOT deleted
// after publication". Edwin took that decision apart on 16 October and most of
// it did not survive:
//
//   - "a site restored from an old backup needs to be re-fed" — his answer:
//     if a customer trashes their own post that is their site and their
//     choice, not this app's problem. A product boundary, and his to set.
//   - "a customer could be moved to Cloudflare static hosting later" — the
//     Cloudflare blogs are a different product with its own target, not a
//     migration path for a WordPress site. The objection was built on a
//     hypothesis that is not on the roadmap.
//
// What DID survive was the third reason, which is the one nobody had argued:
// a support question about what was actually sent cannot be answered from a
// database that threw the evidence away. A customer who says "this is not
// what I paid 100 credits for" is asking about the article as delivered, and
// their live site is not that — they may have edited it since.
//
// So the article is kept for a window and then dropped. Fifteen days, Edwin's
// number. The model file's own suggestion pointed the same way: *prune by
// campaign age and completion, not by slot status*.
//
// WHY THE DECISION IS A STAMPED DATE AND NOT A QUERY
//
// The obvious sweep is "delete posts older than fifteen days whose site is a
// WordPress site". That needs the sweeper to join BlogPost to BlogSite and to
// hold the policy itself, and it fails in the dangerous direction: get the
// site filter wrong and it deletes articles it should have kept.
//
// Instead this runs ONCE, at the moment of confirmation, where every fact is
// already in hand — the site, its target, and what the plugin claimed. If the
// article may be deleted it is stamped with the date it becomes deletable. If
// it may not, it is not stamped at all.
//
// The sweeper then carries no policy whatsoever:
//
//     BlogPost.deleteMany({ deletableAt: { $lte: new Date() } })
//
// Nothing is deletable unless something deliberately said so. A Cloudflare
// post, an unverified confirmation, an article written before this code
// existed — none of them carry a stamp, so none of them can be swept. The
// failure mode of every bug in here is "an article was kept", which costs
// twelve kilobytes.

'use strict';

/** Edwin's number, 16 October 2026. */
const WINDOW_DAYS = 15;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Targets whose articles are the ONLY copy we hold.
 *
 * A static blog has no WordPress database. Every deploy is a fresh render
 * from Mongo, so deleting a published article there does not save space — it
 * destroys the blog's ability to be rebuilt.
 */
const KEEP_FOR_EVER = ['cloudflare'];

/**
 * Every target this file has an opinion about.
 *
 * Must match the enum on BlogSite.target. Anything outside it — a typo, a
 * target added to the model and not to this list — is kept rather than
 * guessed at. See isWordPress() for why that direction.
 */
const KNOWN_TARGETS = ['wordpress', ...KEEP_FOR_EVER];

/**
 * Did the plugin actually prove the article reached WordPress?
 *
 * THIS IS THE GUARD THE WHOLE FEATURE RESTS ON. routes/blogApiRoute.js
 * records a confirmation like this:
 *
 *     wpPostId: Number(item.wpPostId) || undefined,
 *     url: String(item.url || ''),
 *
 * so a confirmation carrying NEITHER still marks the slot scheduled and
 * answers ok. That is harmless while the article is kept regardless, and
 * destructive the moment deletion hangs off it: a plugin bug, a half-failed
 * insert, or a modified plugin would have us delete the only copy we hold on
 * a claim with nothing behind it.
 *
 * A post id is a positive integer because WordPress ids are. A URL is
 * required as well as the id: wp_insert_post can return an id for a post
 * whose permalink was never resolved, and the URL is the half the plugin
 * cannot invent — WordPress appends `-2` to a slug already taken, which is
 * the reason it is sent back at all rather than assumed.
 */
function proven(confirmation) {
  if (!confirmation || 'object' !== typeof confirmation) return false;

  const id = Number(confirmation.wpPostId);
  if (!Number.isInteger(id) || id <= 0) return false;

  return String(confirmation.url || '').trim().length > 0;
}

/**
 * Is this site's WordPress copy the second copy, or the only one?
 *
 * A MISSING `target` COUNTS AS WORDPRESS, deliberately, and this is the one
 * judgement call in the file:
 *
 *   - it matches the schema default, so a site saved by any version of this
 *     app has the field written for it
 *   - every BlogSite that exists today is a WordPress install; the Cloudflare
 *     product has no rows yet
 *   - the enum means a Cloudflare site CANNOT be saved without the field, so
 *     "missing" can never mean "cloudflare"
 *
 * Reading it the other way — unknown means keep — would be the safer-looking
 * choice and would quietly do nothing at all until every existing row was
 * backfilled, which is a feature that silently does not work.
 */
function isWordPress(site) {
  // Array.isArray because `typeof [] === 'object'`, and an array has no
  // .target, so without this an array would read as a WordPress site and
  // earn its articles a deletion date. Found by the junk test.
  if (!site || 'object' !== typeof site || Array.isArray(site)) return false;

  const target = String(site.target || 'wordpress');

  /* AN UNRECOGNISED TARGET IS KEPT, NOT ASSUMED.
   *
   * Written first as `return !KEEP_FOR_EVER.includes(target)`, which reads
   * fine and fails in the wrong direction: a third target added to the enum
   * tomorrow — netlify, s3, anything — would not be in the keep list, so its
   * articles would start being deleted the day it shipped, before anyone had
   * decided whether that was safe.
   *
   * Mutation testing found it: removing the `|| 'wordpress'` default changed
   * no behaviour at all, which is the signal that the default was decorative
   * rather than load-bearing. Now it is the thing that makes a site with no
   * target recognised, and an unknown one is refused. */
  if (!KNOWN_TARGETS.includes(target)) return false;

  return !KEEP_FOR_EVER.includes(target);
}

/**
 * The date this article becomes deletable, or null to keep it for ever.
 *
 * @param {object|null} site          the BlogSite the confirmation came from
 * @param {object|null} confirmation  one entry of /complete's `posts` array
 * @param {Date} [now]
 * @returns {Date|null}
 */
function deletableAt(site, confirmation, now = new Date()) {
  if (!isWordPress(site)) return null;
  if (!proven(confirmation)) return null;

  const from = now instanceof Date && !isNaN(now) ? now.getTime() : Date.now();

  return new Date(from + WINDOW_DAYS * DAY_MS);
}

/**
 * Why this article is being kept, in the words a log line wants. Empty when
 * it is deletable.
 *
 * Separate from deletableAt() rather than returned beside it, because the
 * route needs the date and the tests need the reason, and a function that
 * returns both invites a caller to check the wrong half. It is also the only
 * way to tell "kept because it is a Cloudflare blog" from "kept because the
 * plugin sent us nothing to verify" after the fact.
 */
function whyNot(site, confirmation) {
  if (!site || 'object' !== typeof site) return 'no site on the request';
  if (!isWordPress(site)) return `target is ${site.target} — Mongo is the only copy`;
  if (!confirmation || 'object' !== typeof confirmation) return 'no confirmation';

  const id = Number(confirmation.wpPostId);
  if (!Number.isInteger(id) || id <= 0) return 'no WordPress post id in the confirmation';
  if (!String(confirmation.url || '').trim()) return 'no URL in the confirmation';

  return '';
}

module.exports = {
  deletableAt,
  whyNot,
  proven,
  isWordPress,
  WINDOW_DAYS,
  KEEP_FOR_EVER,
  KNOWN_TARGETS,
};
