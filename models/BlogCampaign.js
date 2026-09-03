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
// post 2, which is not live yet; when post 2 publishes the placeholder in post
// 1 becomes a real link. The last post closes the ring back to the first.
// Placeholders are spans rather than anchors, so nothing is ever a live link
// to a 404 — which is what would happen if post 1 shipped with an <a href> to
// a URL three weeks in the future.
//
// WRITE-AHEAD: WRITING AND PUBLISHING ARE NO LONGER THE SAME MOMENT
//
// Every post in a campaign is written the day the campaign is approved, in one
// batch, and handed to WordPress as a future-dated post. WordPress publishes
// them on the schedule itself.
//
// That splits what used to be one event into two, which is why there are now
// six slot states rather than five. A post can be written, paid for, sitting in
// WordPress with a real permalink, and still not be public — a future-dated
// post returns 404 to anyone not logged in. `scheduled` is that state.
//
// It is also why the placeholders survive. Knowing post 5's permalink in week
// one does not make it linkable in week one; it goes live in week five, and
// until then a real <a> pointing at it is a broken link on a published page.

const mongoose = require('mongoose');

/**
 * One planned post.
 *
 * `status` is a state machine, and the transitions are the only way a slot
 * moves:
 *
 *   pending     planned, nothing spent
 *   generating  claimed by the batch job; no other request may claim it
 *   ready       written and paid for, stored as a BlogPost, not yet collected
 *   scheduled   created in WordPress as a future post. Has a wpPostId and a
 *               real permalink. NOT public — a future-dated post 404s to
 *               anyone not logged in until its date arrives.
 *   published   WordPress has flipped it live
 *   failed      generation failed; nothing charged, may be retried
 *
 * 'ready' exists precisely so a failed handover is recoverable. Without it
 * there would be no state meaning "paid for but not yet on the site", and the
 * only safe response to a retry would be to write it again.
 *
 * 'scheduled' exists because writing and publishing came apart. It is the
 * state a post spends most of its life in — twelve weeks of a twelve-week
 * campaign — and the one the scheduler watches: a slot stuck in 'scheduled'
 * past its date means WordPress never ran the cron that publishes it, which on
 * a zero-traffic site is the normal case rather than the exception.
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
    enum: ['pending', 'generating', 'ready', 'scheduled', 'published', 'failed'],
    default: 'pending',
    index: true,
  },

  // When this post should appear. Date AND time: the old theme-based
  // automation scheduled by date alone, so posts surfaced at whatever hour
  // cron happened to fire — typically the small hours, which looks automated
  // to anyone watching the site.
  //
  // It no longer has anything to do with WHEN THE POST IS WRITTEN. Everything
  // is written on approval day; this date is handed to WordPress as post_date
  // and WordPress does the publishing.
  publishAt: { type: Date, index: true },

  // What WordPress was actually told to publish it at, echoed back by the
  // plugin. Normally publishAt converted to site-local time — recorded rather
  // than assumed, because a site whose timezone setting disagrees with the one
  // reported at activation would otherwise publish at the wrong hour for weeks
  // with nothing in the data to show why.
  scheduledFor: { type: Date },

  // The batch job that wrote this slot. The post itself lives in the BlogPost
  // collection, keyed { campaign, slotIndex }; this is kept for tracing a bad
  // run back to its progress record, not for reading content.
  job: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },

  // Set when credits are actually taken, never before. Its presence is the
  // record that this slot has been paid for; a slot can only ever carry one.
  chargedAt: { type: Date },
  credits: { type: Number, default: 0 },

  // Filled in by the plugin at SCHEDULING time, not at publication — a future
  // post has its id and its permalink from the moment it is created. The slug
  // is recorded as WordPress actually created it, not as we asked for it:
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

  /**
   * Where the campaign is in its life.
   *
   *   draft      planned and priced, nothing spent. /plan leaves it here.
   *   writing    the batch is running. Nothing may publish yet.
   *   active     everything written and handed over; publishing on schedule
   *   paused     the owner stopped it
   *   completed  every slot published
   *   cancelled  abandoned
   *
   * 'draft' finally means something. Before write-ahead, /plan created
   * campaigns directly as 'active' because there was no separate approval
   * step — planning and starting were the same act. Now approval is what
   * triggers a large charge, so the two are properly distinct: a campaign sits
   * in 'draft' until someone with credits says yes.
   */
  status: {
    type: String,
    enum: ['draft', 'writing', 'active', 'paused', 'completed', 'cancelled'],
    default: 'draft',
    index: true,
  },

  /**
   * The write-ahead batch.
   *
   * One job writes every post in the campaign, so its state belongs to the
   * campaign rather than to any slot. /write polls this to answer "how far
   * along is it?" without loading twelve posts to count them.
   *
   * `written` and `failed` are recorded when the batch ends rather than
   * derived from the slots on every poll — a poll every two seconds against a
   * 52-slot campaign should not be counting array elements each time.
   */
  batch: {
    job: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
    startedAt: { type: Date },
    finishedAt: { type: Date },
    written: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    creditsCharged: { type: Number, default: 0 },
  },

  /**
   * crossCheck()'s report over the whole batch: repeated sentences and shared
   * openings across posts.
   *
   * This is the check that could never run before. Posts were written weeks
   * apart, so there was nothing to compare a post against — every quality
   * signal was per-post, and "all twelve of these open the same way" is not a
   * per-post fact. It belongs here rather than on any BlogPost for the same
   * reason: it is a property of the set.
   */
  crossCheck: { type: mongoose.Schema.Types.Mixed },

  createdAt: { type: Date, default: Date.now },
});

// "Which scheduled posts has WordPress failed to publish?" — the scheduler's
// only query, and the reason status and slots.status are both in the key: it
// asks for active campaigns holding scheduled slots, and neither half is
// selective enough alone.
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

/**
 * Record what WordPress created, as a future-dated post.
 *
 * This is the handover, and it is NOT publication. The post now exists on the
 * site with a real id and a real permalink, and will 404 for the public until
 * its date arrives. Both facts matter: the id is what lets the plugin edit the
 * post later to switch on its placeholders, and the 404 is why those
 * placeholders exist at all.
 *
 * Only from 'ready', so a duplicate confirmation — the plugin retrying a
 * request whose response was lost — matches nothing and changes nothing.
 */
blogCampaignSchema.statics.markSlotScheduled = function (campaignId, slotIndex, created) {
  return this.findOneAndUpdate(
    {
      _id: campaignId,
      slots: { $elemMatch: { index: slotIndex, status: 'ready' } },
    },
    {
      $set: {
        'slots.$.status': 'scheduled',
        'slots.$.wpPostId': created.wpPostId,
        'slots.$.publishedUrl': created.url || '',
        'slots.$.publishedTitle': created.title || '',
        'slots.$.scheduledFor': created.scheduledFor || null,
      },
    },
    { new: true }
  );
};

/**
 * WordPress has flipped a scheduled post live.
 *
 * Reported by the plugin from its future_to_publish hook. Nothing here needs
 * updating except the status and the date — the id, URL and title were all
 * settled when the post was created, and re-writing them would risk a stale
 * value overwriting a correct one if the owner edited the post in between.
 */
blogCampaignSchema.statics.markSlotLive = function (campaignId, slotIndex, publishedAt) {
  return this.findOneAndUpdate(
    {
      _id: campaignId,
      slots: { $elemMatch: { index: slotIndex, status: 'scheduled' } },
    },
    {
      $set: {
        'slots.$.status': 'published',
        'slots.$.publishedAt': publishedAt || new Date(),
      },
    },
    { new: true }
  );
};

// markSlotPublished() was here: the one-shot ready -> published transition.
// It was correct when the plugin collected a post and published it in the same
// breath, so there was no intermediate state to record. Deleted rather than
// kept as a convenience, because skipping 'scheduled' loses the distinction
// between a post that exists and a post the public can read — and that
// distinction is the entire reason the placeholder spans still exist.

/**
 * Put a failed slot back in play, so a later run can fill the gap.
 *
 * Deliberate and explicit, because under write-ahead nothing else moves a slot
 * back to 'pending'. The batch marks a slot that could not be written 'failed'
 * and leaves it there: there is no weekly run that would come round again, so
 * a slot sitting in 'pending' after the batch would be waiting for something
 * that is never going to happen.
 *
 * `attempts` is the cap, and it is why this filter checks it rather than
 * trusting the caller. Each claim increments it, so a topic the model keeps
 * refusing stops costing API calls after a few tries however many times
 * someone presses the button.
 */
blogCampaignSchema.statics.reopenSlot = function (campaignId, slotIndex, maxAttempts = 3) {
  return this.findOneAndUpdate(
    {
      _id: campaignId,
      slots: {
        $elemMatch: {
          index: slotIndex,
          status: 'failed',
          attempts: { $lt: maxAttempts },
        },
      },
    },
    {
      $set: {
        'slots.$.status': 'pending',
        'slots.$.error': '',
      },
    },
    { new: true }
  );
};

/**
 * Slots written and paid for that WordPress has not taken yet.
 *
 * The stranded ones. A site that was offline when the batch finished comes
 * back to find its posts waiting, already paid for — these are what the plugin
 * collects on its next run, and handing them over costs nothing.
 */
blogCampaignSchema.methods.uncollectedSlots = function () {
  return (this.slots || []).filter(s => s.status === 'ready');
};

/**
 * Scheduled posts whose date has passed and which WordPress has not published.
 *
 * This replaces dueSlots(), and the change of meaning is the whole redesign in
 * one function. It used to mean "a post that should be written by now". It now
 * means "a post that WordPress was supposed to publish and did not" — because
 * WordPress publishes future posts through WP-Cron, WP-Cron fires when someone
 * visits the site, and these sites have no visitors. That is precisely why the
 * customer is buying posts, and it makes the missed schedule the normal case
 * here rather than an edge one.
 *
 * A grace period, because the two clocks are not the same. WordPress fires its
 * cron on its own schedule and the site's timezone may be set differently from
 * the one reported at activation; treating a post as missed the instant our
 * clock passes the minute would ping every site on every campaign, every time.
 */
blogCampaignSchema.methods.missedSchedule = function (now = new Date(), graceMs = 15 * 60 * 1000) {
  const cutoff = new Date(now.getTime() - graceMs);

  return (this.slots || []).filter(
    s => s.status === 'scheduled' && s.publishAt && s.publishAt <= cutoff
  );
};

module.exports = mongoose.model('BlogCampaign', blogCampaignSchema);