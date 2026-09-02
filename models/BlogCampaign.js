// models/BlogCampaign.js
//
// A run of interlinked posts feeding one money page.
//
// THE SLOT IS THE UNIT OF EVERYTHING
// Scheduling, generation, publishing and billing all key on a slot. A slot is
// one planned post: its topic, when it should appear, what it links to, and
// whether it has been paid for.
//
// WHY THAT MATTERS FOR BILLING
// The customer is charged per post GENERATED, and the plugin runs on hardware
// we do not control. A site that dies between fetching a post and publishing
// it will ask again. If "ask again" meant "generate again", one slot would
// cost two OpenAI calls and two charges.
//
// So claiming a slot is an atomic state change — see claimSlot() below — and
// the generated post is stored on the Job. A retry finds the slot already
// claimed, returns the stored post, and charges nothing. The slot's own status
// is the lock; there is no separate flag that could disagree with it.
//
// THE LINK GRAPH
// Every post links to the target page. Post 1 also leaves a placeholder for
// post 2, which does not exist yet; when post 2 is published the placeholder
// in post 1 becomes a real link. The last post closes the ring back to the
// first. Placeholders are spans rather than anchors, so nothing is ever a
// live link to a 404 — which is what would happen if post 1 shipped with an
// <a href> to a URL three weeks in the future.

const mongoose = require('mongoose');

/**
 * One planned post.
 *
 * `status` is a state machine, and the transitions are the only way a slot
 * moves:
 *
 *   pending     planned, nothing spent
 *   generating  claimed by a job; no other request may claim it
 *   ready       content exists on the job, credits charged, awaiting publish
 *   published   live on the site, WordPress has given it a URL
 *   failed      generation failed; nothing charged, may be retried
 *
 * 'ready' exists precisely so a failed publish is recoverable. Without it
 * there would be no state meaning "paid for but not yet live", and the only
 * safe response to a retry would be to generate again.
 */
const slotSchema = new mongoose.Schema({
  index: { type: Number, required: true },

  // What the post is about. `topic` is the working title; the model rewrites
  // it into a real headline, and the published title is recorded separately.
  topic: { type: String, required: true },

  // The search query this post is meant to answer. Checked against the target
  // page's keyword when the campaign is planned — a post competing with the
  // page it is supposed to feed is worse than no post at all.
  targetQuery: { type: String, default: '' },

  // The phrase later posts use as anchor text when they link back here. Fixed
  // at planning time so post 3 can link to post 5 using wording that will
  // still make sense when post 5 finally exists.
  linkPhrase: { type: String, default: '' },

  // The requested slug. NOT the published one — WordPress appends -2 to a
  // slug already in use, and publishedUrl below records what it actually did.
  slug: { type: String, default: '' },

  /**
   * This post's anchor text for the link to the money page, chosen once when
   * the campaign is planned.
   *
   * Stored rather than recomputed, for two reasons. anchors.js balances the
   * whole campaign's mix in one pass — picking one anchor in isolation later
   * would break that balance. And qualityCheck verifies the model emitted
   * `{{money}}<anchor>{{/money}}` verbatim, so the phrase given to the writer
   * and the phrase given to the checker must be the same string; deriving it
   * twice is how they would come to differ.
   */
  moneyAnchor: { type: String, default: '' },
  anchorType: {
    type: String,
    enum: ['exact', 'semantic', 'descriptive', 'branded'],
    default: 'semantic',
  },
  // The pool ran out and a phrase already pointing at this page was used
  // again. Not an error, but worth showing the customer.
  anchorReused: { type: Boolean, default: false },

  status: {
    type: String,
    enum: ['pending', 'generating', 'ready', 'published', 'failed'],
    default: 'pending',
    index: true,
  },

  // When this post should appear. Date AND time: the old theme-based
  // automation scheduled by date alone, so posts surfaced at whatever hour
  // cron happened to fire — typically the small hours, which looks automated
  // to anyone watching the site.
  publishAt: { type: Date, index: true },

  // The job that generated (or is generating) this slot. Holds the post
  // itself in job.result, which is what a retry reads instead of paying for
  // a second generation.
  job: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },

  // Set when credits are actually taken, never before. Its presence is the
  // record that this slot has been paid for; a slot can only ever carry one.
  chargedAt: { type: Date },
  credits: { type: Number, default: 0 },

  // Filled in by the plugin once WordPress has assigned them. The slug is
  // recorded as WordPress actually created it, not as we asked for it —
  // WordPress silently appends -2 when a slug is taken, and every link
  // pointing at the requested slug would 404.
  wpPostId: { type: Number },
  publishedUrl: { type: String, default: '' },
  publishedTitle: { type: String, default: '' },
  publishedAt: { type: Date },

  error: { type: String, default: '' },
  attempts: { type: Number, default: 0 },
}, { _id: false });

const blogCampaignSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  site: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BlogSite',
    required: true,
    index: true,
  },

  name: { type: String, default: '' },

  // The money page every post in this campaign links to.
  targetPage: {
    url: { type: String, required: true },
    keyword: { type: String, required: true },
    // One sentence on what someone searching this actually wants. Steers the
    // model away from posts that are technically on-topic and commercially
    // useless.
    intent: { type: String, default: '' },
  },

  /**
   * How this campaign relates to an earlier one for the same page.
   *
   *   'standalone'  its own ring, closed by its own last post
   *   'extend'      continues an existing ring: the earlier campaign's
   *                 closing link is repointed at this campaign's first post,
   *                 and this campaign's last post closes back to the earlier
   *                 campaign's first
   *
   * Extending concentrates authority on one page; standalone keeps the two
   * runs independent, which is what you want when the second campaign targets
   * a different angle.
   */
  linkMode: {
    type: String,
    enum: ['standalone', 'extend'],
    default: 'standalone',
  },

  extendsCampaign: { type: mongoose.Schema.Types.ObjectId, ref: 'BlogCampaign' },

  schedule: {
    // Gap between posts. 7 = weekly, 14 = fortnightly, 30 = roughly monthly.
    everyDays: { type: Number, default: 7, min: 1, max: 90 },

    // Local time of day, 'HH:MM' on a 24-hour clock.
    publishTime: { type: String, default: '09:00' },

    // IANA zone reported by the WordPress install, e.g. 'America/Chicago'.
    // Stored rather than assumed: 09:00 has to mean nine in the morning where
    // the business is, not wherever this server happens to run.
    timezone: { type: String, default: 'UTC' },

    startAt: { type: Date },
  },

  slots: [slotSchema],

  status: {
    type: String,
    enum: ['draft', 'active', 'paused', 'completed', 'cancelled'],
    default: 'draft',
    index: true,
  },

  createdAt: { type: Date, default: Date.now },
});

// "Which slots are due?" — the scheduler's only query.
blogCampaignSchema.index({ status: 1, 'slots.status': 1, 'slots.publishAt': 1 });

/* -------------------------------------------------------------------------
 * Slot transitions
 *
 * Every one is a conditional update rather than a read-modify-write. Two
 * requests arriving together — a scheduled run and a manual one, or a plugin
 * retrying while the first attempt is still in flight — would otherwise both
 * read 'pending', both proceed, and both charge.
 * ---------------------------------------------------------------------- */

/**
 * Take exclusive ownership of a pending slot.
 *
 * The filter requires the slot to still be 'pending', so of two concurrent
 * callers exactly one gets a document back and the other gets null. The
 * caller that gets null must NOT generate: it should read the slot and
 * return whatever is already there.
 *
 * @returns {Promise<object|null>} the updated campaign, or null if not claimed
 */
blogCampaignSchema.statics.claimSlot = function (campaignId, slotIndex, jobId) {
  return this.findOneAndUpdate(
    {
      _id: campaignId,
      slots: { $elemMatch: { index: slotIndex, status: 'pending' } },
    },
    {
      $set: {
        'slots.$.status': 'generating',
        'slots.$.job': jobId || null,
      },
      $inc: { 'slots.$.attempts': 1 },
    },
    { new: true }
  );
};

/**
 * Mark a slot generated and paid for.
 *
 * chargedAt is written in the SAME update that moves the status, and only
 * from 'generating'. A repeat of this call finds no matching slot and changes
 * nothing, so the charge cannot be recorded twice even if the caller retries.
 */
blogCampaignSchema.statics.markSlotReady = function (campaignId, slotIndex, { credits, jobId }) {
  return this.findOneAndUpdate(
    {
      _id: campaignId,
      slots: { $elemMatch: { index: slotIndex, status: 'generating' } },
    },
    {
      $set: {
        'slots.$.status': 'ready',
        'slots.$.chargedAt': new Date(),
        'slots.$.credits': Number(credits) || 0,
        'slots.$.job': jobId || null,
      },
    },
    { new: true }
  );
};

/**
 * Release a slot whose generation failed.
 *
 * Back to 'pending', not 'failed', when it is worth retrying — nothing was
 * charged, so a transient OpenAI error should not cost the customer a post.
 * `attempts` is what stops that looping forever; the caller decides the cap.
 */
blogCampaignSchema.statics.releaseSlot = function (campaignId, slotIndex, { message, giveUp }) {
  return this.findOneAndUpdate(
    {
      _id: campaignId,
      slots: { $elemMatch: { index: slotIndex, status: 'generating' } },
    },
    {
      $set: {
        'slots.$.status': giveUp ? 'failed' : 'pending',
        'slots.$.error': String(message || '').slice(0, 500),
      },
    },
    { new: true }
  );
};

/** Record what WordPress actually created. */
blogCampaignSchema.statics.markSlotPublished = function (campaignId, slotIndex, published) {
  return this.findOneAndUpdate(
    {
      _id: campaignId,
      slots: { $elemMatch: { index: slotIndex, status: 'ready' } },
    },
    {
      $set: {
        'slots.$.status': 'published',
        'slots.$.publishedAt': new Date(),
        'slots.$.wpPostId': published.wpPostId,
        'slots.$.publishedUrl': published.url || '',
        'slots.$.publishedTitle': published.title || '',
      },
    },
    { new: true }
  );
};

/** Slots whose time has come and which have not been generated yet. */
blogCampaignSchema.methods.dueSlots = function (now = new Date()) {
  return (this.slots || []).filter(
    s => s.status === 'pending' && s.publishAt && s.publishAt <= now
  );
};

/**
 * Slots generated and paid for but never confirmed published.
 *
 * These are the ones a retry should hand straight back rather than
 * regenerate. A site that was down for a day comes back to find its posts
 * waiting, already paid for.
 */
blogCampaignSchema.methods.unpublishedReadySlots = function () {
  return (this.slots || []).filter(s => s.status === 'ready');
};

module.exports = mongoose.model('BlogCampaign', blogCampaignSchema);