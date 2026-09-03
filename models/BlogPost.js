// models/BlogPost.js
//
// One written post, waiting to be collected.
//
// WHY THIS IS NOT job.result
//
// It used to be. One post was one job, so the post lived on the job that made
// it and /generate dug it back out. Under write-ahead campaigns one job writes
// twelve posts, and stuffing twelve articles into a single Mixed field would
// mean every read of that job drags all twelve across the wire to find one.
//
// It is not a field on the slot either, for the same reason pointed the other
// way: the campaign document is read constantly — by the scheduler, by the
// admin screen listing campaigns, by /plan looking up prior anchors — and a
// 52-slot campaign carrying 52 articles is half a megabyte fetched every time
// anyone asks a question that has nothing to do with the prose.
//
// So the post lives on its own, keyed by the slot it belongs to, and is
// fetched only when someone actually wants the words.
//
// THE UNIQUE INDEX IS THE POINT
//
// { campaign, slotIndex } is unique. That is not tidiness — it is the same
// principle as claimSlot(): the database, not the application, enforces "one
// post per slot". A retry, a duplicated job, two workers racing during a
// rolling deploy — none of them can produce a second post for slot 7, because
// the index will not allow it.

const mongoose = require('mongoose');

/**
 * One section of the post.
 *
 * Declared rather than Mixed because this shape is fixed: writePost() returns
 * it, checkPost() validates it, and IE_Links::render() iterates it. Compare
 * Job.uploads, which IS Mixed — that one carries multer's field names, which
 * change as the wizard changes, and a strict sub-schema silently dropped them.
 * Here the shape is the contract, so declaring it catches a writer that drifts.
 */
const sectionSchema = new mongoose.Schema({
  // null on the first section — it is the opening, before any subheading.
  // Explicitly nullable rather than defaulted to '', because the writer's
  // prompt says "the first section's heading must be null" and an empty string
  // arriving instead is a signal worth being able to see.
  heading: { type: String, default: null },

  // Plain text, with the {{money}}…{{/money}} wrappers still in it. NOT HTML.
  // The tokens survive esc_html on the plugin side, which is the entire reason
  // the writer emits them instead of anchors — see the note in blogGenerator.
  paragraphs: [{ type: String }],
}, { _id: false });

const blogPostSchema = new mongoose.Schema({
  campaign: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BlogCampaign',
    required: true,
    index: true,
  },

  /**
   * Denormalised from the campaign, on purpose.
   *
   * /collect has to prove the calling site owns this post before handing over
   * a word of it. With the site id here that is one indexed query; without it,
   * every collect loads the campaign first purely to read one field. The value
   * never changes — a campaign cannot move between sites — so there is no
   * staleness to manage.
   */
  site: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BlogSite',
    required: true,
    index: true,
  },

  slotIndex: { type: Number, required: true },

  // The batch job that wrote it. Kept for tracing a bad run back to its
  // progress record and its logs, not used in any read path.
  job: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },

  /* ------------------------------------------------------ the post itself */

  title: { type: String, default: '' },
  metaDescription: { type: String, default: '' },

  // The slug we ASK for. WordPress may append -2; what it actually assigned
  // comes back on the slot, never here. Anything building a URL reads the
  // slot's publishedUrl, not this.
  slug: { type: String, default: '' },

  sections: [sectionSchema],

  /**
   * Where each link token points, in the shape IE_Links::render() reads.
   *
   * Mixed, and this one has to be. The keys are money/prev/next but the values
   * are either { url } or { pending_id } depending on whether the target is
   * live yet, and pending_id is snake_case because PHP consumes it while every
   * other field on this document is camelCase because JavaScript does. A
   * declared sub-schema would drop whichever half it was not told about, and
   * it would do so silently — which is exactly how the theme importer lost
   * keys for weeks.
   */
  targets: { type: mongoose.Schema.Types.Mixed, default: {} },

  /* ----------------------------------------------------------- assessment */

  // checkPost()'s verdict: { ok, failures, warnings, stats }. Mixed because it
  // is a report, not a record — its shape belongs to qualityCheck.js and will
  // grow as checks are added. Nothing reads individual fields out of it except
  // the admin screen, which renders whatever it finds.
  quality: { type: mongoose.Schema.Types.Mixed, default: {} },

  // Lifted out of quality.stats so a listing can show it with .select() and
  // without pulling the whole report. A post well under the 700-word floor is
  // the single most useful number for spotting a bad run at a glance.
  words: { type: Number, default: 0 },

  // Tokens the writer was told to emit and did not. checkPost reports these as
  // failures; recorded separately so the plugin can log which links a
  // published post is actually missing without re-parsing anything.
  missingLinks: [{ type: String }],

  /**
   * The placeholder spans this post carries: [{ token, slotIndex, id }].
   *
   * Under write-ahead every inter-post link starts as a placeholder, because
   * at the moment the batch is written nothing is live yet. This list is what
   * lets the plugin know what it is holding without re-parsing post_content —
   * and it is why the spans survive the redesign: a future-dated post returns
   * 404 to the public until it publishes, so a real <a> written today would be
   * a broken link for as long as the schedule runs.
   */
  pending: [{ type: mongoose.Schema.Types.Mixed }],

  createdAt: { type: Date, default: Date.now },
});

/**
 * One post per slot, enforced by the database.
 *
 * unique, not just compound. See the note at the top of this file: this index
 * is the reason a retry cannot produce a duplicate, and it holds even when two
 * processes race during a deploy.
 */
blogPostSchema.index({ campaign: 1, slotIndex: 1 }, { unique: true });

/**
 * Store the post for a slot, replacing any earlier attempt.
 *
 * upsert rather than create, because a slot released after a failed write can
 * legitimately be written again — releaseSlot() puts it back to 'pending'
 * precisely so a transient OpenAI error does not cost the customer a post. The
 * second attempt should overwrite the wreckage of the first, not collide with
 * it.
 *
 * Note what this does NOT do: it does not charge, and it does not move the
 * slot's status. Both of those happen in markSlotReady(), in one conditional
 * update, after this returns. Keeping them apart is what makes it safe to
 * write the post twice and charge once.
 */
blogPostSchema.statics.storeForSlot = function (campaign, slotIndex, payload) {
  const quality = payload.quality || {};

  return this.findOneAndUpdate(
    { campaign: campaign._id, slotIndex: Number(slotIndex) },
    {
      $set: {
        site: campaign.site._id || campaign.site,
        job: payload.jobId || null,
        title: String(payload.title || ''),
        metaDescription: String(payload.metaDescription || ''),
        slug: String(payload.slug || ''),
        sections: payload.sections || [],
        targets: payload.targets || {},
        quality,
        words: Number(quality?.stats?.words) || 0,
        missingLinks: payload.missingLinks || [],
        pending: payload.pending || [],
        createdAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

/** The read /collect does. */
blogPostSchema.statics.forSlot = function (campaignId, slotIndex) {
  return this.findOne({ campaign: campaignId, slotIndex: Number(slotIndex) });
};

/**
 * Every post in a campaign, in slot order.
 *
 * Two callers, and they want the same thing for different reasons: crossCheck()
 * needs the whole set to find sentences that repeat across posts, and the
 * plugin's batch collect takes them all in one request rather than twelve.
 */
blogPostSchema.statics.forCampaign = function (campaignId) {
  return this.find({ campaign: campaignId }).sort({ slotIndex: 1 });
};

/**
 * Deliberately NOT deleted after publication.
 *
 * The obvious economy is to drop the stored copy once WordPress has the post —
 * it is duplicated on the customer's site at that point, and this collection
 * grows without bound. It is kept anyway, for two reasons that have both
 * already happened elsewhere in this app: a site restored from an old backup
 * needs to be re-fed, and a support question about what was actually sent
 * cannot be answered from a database that threw the evidence away.
 *
 * If it does need pruning later, prune by campaign age and completion, not by
 * slot status — a campaign that ended six months ago is safe to lose; a
 * published post in a campaign still running is not.
 */

module.exports = mongoose.model('BlogPost', blogPostSchema);