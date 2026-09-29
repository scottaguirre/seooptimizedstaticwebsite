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

  /**
   * The owner deleted this post from their WordPress.
   *
   * A DATE, AND DELIBERATELY NOT A STATUS — the same decision as removedAt on
   * the campaign below, for the same reason. `status` is the record of what
   * this slot DID: it was written, it was charged for, it published. All of
   * that stays true after the post is deleted, and overwriting it would
   * destroy the only evidence that the credits bought something.
   *
   * So the two facts are kept apart. status says what happened; deletedAt
   * says it is no longer on the site. "Published, then deleted" and "never
   * published" must never collapse into one value: the first was paid for and
   * the second was not.
   *
   * WHY THIS WAS MISSING UNTIL NOW, which is the part worth recording. The
   * plugin got deleted-post detection first, in 0.4.3, and it was entirely
   * local — it queried WordPress as the admin screen drew, greyed the row out
   * and told NOBODY. Meanwhile /api/blog/removed tracked a CAMPAIGN being
   * removed, a different event, so nothing on this side ever learned that a
   * post had gone. The blog report went on printing "Published", a credit
   * charge and a link for fourteen posts that answered 404.
   *
   * A report the customer cannot trust is worse than no report. It is the
   * document they would quote back when disputing a bill.
   */
  deletedAt: { type: Date },

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

  /**
   * When the customer removed this campaign from their WordPress.
   *
   * A DATE, NOT A STATUS. Removing is not a state a campaign is IN — it is
   * something that happened TO one, and it can happen to a campaign in any
   * state. Folding it into `status` would overwrite the only record of
   * whether the thing had completed, been paused or been cancelled first, and
   * "completed, then removed in October" is a different fact from "cancelled
   * halfway, then removed in October". The report shows both.
   *
   * WHY THE RECORD IS KEPT AT ALL. blogSitesRoute.js already refuses to
   * delete a BlogSite on revoke, for the reason it gives there: "campaigns
   * reference it, and their history — what was published, what was charged —
   * has to survive". The same argument applies one level down. A campaign
   * that charged 450 credits does not stop having charged them because
   * somebody later tidied up their WordPress.
   *
   * WORDPRESS CANNOT BE THE HOME FOR THIS. Removing the campaign there is
   * precisely the act being recorded, and a tombstone kept on the machine
   * that was just cleared out is not a record of anything.
   *
   * Unset for every campaign still on its site, which is most of them, so
   * `removedAt: { $exists: false }` is the live set.
   */
  removedAt: { type: Date, index: true },

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

/**
 * Record that the customer removed this campaign from their WordPress.
 *
 * ONLY EVER SETS THE DATE. Nothing about the campaign's own history is
 * touched — not the status, not the slots, not what was charged. The
 * removal is a new fact about an old record, not a correction to it.
 *
 * FIRST REMOVAL WINS. The plugin calls this before deleting its local copy,
 * and that call is best-effort: a site that is offline at the moment simply
 * does not report, and a customer who reinstalls and removes the campaign
 * again would otherwise overwrite the original date with a later one that
 * describes nothing. `removedAt: null` in the filter makes the write a
 * no-op the second time.
 *
 * @returns {Promise<boolean>} true when this call was the one that recorded it
 */
blogCampaignSchema.statics.markRemoved = async function (campaignId, when = new Date()) {
  const result = await this.updateOne(
    { _id: campaignId, removedAt: null },
    { $set: { removedAt: when } }
  );

  return (result.modifiedCount || result.nModified || 0) > 0;
};

/**
 * Record that some of this campaign's posts no longer exist in WordPress.
 *
 * IDEMPOTENT, AND THE FIRST TIME WINS. The plugin reports a deletion twice by
 * design: once from the hook that fires as the post goes, and again from the
 * hourly sweep that reconciles every slot against what is really on the site.
 * The sweep is not a belt-and-braces duplicate — it is the only thing that can
 * catch a post deleted while the site was offline, or deleted before this
 * feature existed at all. So a repeat is the normal case, not an error, and a
 * slot that already carries a date keeps it: the day the post went is a fact,
 * and the sweep that noticed weeks later must not overwrite it with today.
 *
 * Returns how many slots were NEWLY marked, which is what the caller logs.
 * That number is read before the write rather than inferred from it, because
 * modifiedCount counts modified DOCUMENTS — one, always, however many slots
 * inside it changed — and reporting "1 post deleted" for six would be a quiet
 * little lie in exactly the place this whole feature exists to stop one.
 */
blogCampaignSchema.statics.markSlotsDeleted = async function (
  campaignId, slotIndexes, when = new Date()
) {
  const wanted = new Set(
    (Array.isArray(slotIndexes) ? slotIndexes : [])
      .map(n => Number(n))
      .filter(n => Number.isInteger(n) && n >= 0)
  );

  if (!wanted.size) return 0;

  const campaign = await this.findById(campaignId)
    .select('slots.index slots.deletedAt')
    .lean();

  if (!campaign) return 0;

  const fresh = (campaign.slots || [])
    .filter(s => wanted.has(Number(s.index)) && !s.deletedAt)
    .map(s => Number(s.index));

  if (!fresh.length) return 0;

  await this.updateOne(
    { _id: campaignId },
    { $set: { 'slots.$[el].deletedAt': when } },
    { arrayFilters: [{ 'el.index': { $in: fresh } }] }
  );

  return fresh.length;
};

/**
 * The other half of a reconciliation: slots NOT named are on the site.
 *
 * Only ever called for a sweep, which reports the complete set of missing
 * slots for one campaign. Anything carrying a deletedAt that the site no
 * longer lists as missing has come back — restored from the trash, or put
 * back from a backup — and the mark has to come off.
 *
 * WITHOUT THIS, DELETION IS A ONE-WAY DOOR. Trashing a post by accident and
 * restoring it thirty seconds later would leave it marked Deleted for good,
 * in the one document a customer would reach for to check a bill. A record
 * that can only ever get worse is not a record of anything.
 *
 * Returns how many were restored.
 */
blogCampaignSchema.statics.clearSlotsDeleted = async function (campaignId, missingIndexes) {
  const missing = new Set(
    (Array.isArray(missingIndexes) ? missingIndexes : [])
      .map(n => Number(n))
      .filter(n => Number.isInteger(n) && n >= 0)
  );

  const campaign = await this.findById(campaignId)
    .select('slots.index slots.deletedAt')
    .lean();

  if (!campaign) return 0;

  const back = (campaign.slots || [])
    .filter(s => s.deletedAt && !missing.has(Number(s.index)))
    .map(s => Number(s.index));

  if (!back.length) return 0;

  await this.updateOne(
    { _id: campaignId },
    { $unset: { 'slots.$[el].deletedAt': '' } },
    { arrayFilters: [{ 'el.index': { $in: back } }] }
  );

  return back.length;
};

/**
 * Record that these slots are live on the site, whatever we thought before.
 *
 * WHY THIS IS NEEDED WHEN /published ALREADY EXISTS. That endpoint is an
 * EVENT: the plugin fires it once, as the post goes public, and nothing
 * retries it. One rejected call and this side believes a published post is
 * still waiting — permanently, because the event never comes again.
 *
 * On one real site a licence key was used on a second WordPress, which left
 * the first holding a stale secret. Every call it made was refused for eight
 * days, including twelve "this post went live" messages. Twelve posts sat on
 * the customer's blog, visible to anyone, recorded here as pending. No amount
 * of waiting would ever have corrected it.
 *
 * THE DATE COMES FROM WHAT WE ALREADY KNOW, not from the plugin. A WordPress
 * site reports its local time, in its own timezone, in a format that has to
 * be parsed and trusted; scheduledFor is what WordPress was actually told to
 * publish at, recorded here at scheduling time and already correct. Falling
 * back to publishAt costs at most a few hours of accuracy and cannot be wrong
 * by a timezone.
 *
 * A DELETED SLOT IS NEVER RESURRECTED. If the post is gone, "it published"
 * is stale news about something that no longer exists, and the deletion is
 * the more recent truth.
 *
 * Returns how many slots changed.
 */
blogCampaignSchema.statics.markSlotsLive = async function (campaignId, slotIndexes) {
  const wanted = new Set(
    (Array.isArray(slotIndexes) ? slotIndexes : [])
      .map(n => Number(n))
      .filter(n => Number.isInteger(n) && n >= 0)
  );

  if (!wanted.size) return 0;

  const campaign = await this.findById(campaignId);
  if (!campaign) return 0;

  let changed = 0;

  for (const slot of campaign.slots || []) {
    if (!wanted.has(Number(slot.index))) continue;
    if (slot.deletedAt) continue;
    if (slot.status === 'published' && slot.publishedAt) continue;

    // Only a slot that has been written and handed over can be live. A
    // 'pending' or 'generating' slot claiming to be published would mean the
    // two sides disagree about something more serious than a date.
    if (!['scheduled', 'published'].includes(slot.status)) continue;

    slot.status = 'published';
    slot.publishedAt = slot.publishedAt || slot.scheduledFor || slot.publishAt || new Date();
    changed++;
  }

  if (changed) await campaign.save();

  return changed;
};

/**
 * Mark every campaign for a site that the site no longer has.
 *
 * THE SAME TRICK AS markSlotsDeleted, ONE LEVEL UP. The plugin sends the ids
 * it still holds and anything else belonging to that site has been removed
 * from the WordPress.
 *
 * WHY IT IS NEEDED AT ALL, given /api/blog/removed exists. That callback only
 * arrived in plugin 0.4.4. Every campaign removed before then went unreported,
 * and the removal is not recoverable from anything else — the campaign simply
 * stops being mentioned. On one real site that left six campaigns and fourteen
 * published posts on the server that no longer existed anywhere, and no sweep
 * of slots could ever find them: the plugin reconciles the campaigns it HAS,
 * and these are exactly the ones it does not.
 *
 * TWO GUARDS, both against marking a campaign removed that is merely young or
 * unknown:
 *
 *   graceMs   A campaign is created here during /plan and stored by the
 *             plugin when it reads the response. Between those two moments it
 *             exists on this side and nowhere else, and a reconciliation
 *             landing in that window would delete a campaign being born.
 *
 *   present   An EMPTY list is refused by the caller, not here — see the
 *             route. A plugin that has lost its options looks exactly like a
 *             site that has removed everything.
 *
 * Returns how many were newly marked.
 */
/**
 * Take the campaign statuses a site reports, for the ones it is allowed to.
 *
 * THE SITE OWNS WHAT THE OWNER DID; THIS SIDE OWNS ITS OWN PIPELINE.
 *
 * Pausing and cancelling happen in wp-admin, so the site is the only place
 * that knows. 'draft' and 'writing' are the opposite: they describe a batch
 * running HERE, and a sweep landing mid-batch must not knock a campaign out
 * of it. So a narrow list is accepted, and only over a status that is not
 * mid-flight.
 *
 * 'completed' is deliberately NOT accepted. This side sets it from the one
 * moment the answer changes — the last slot reporting live — and a site that
 * merely thinks it is finished would be guessing.
 *
 * REMOVAL IS NOT A STATUS and is not touched here. It is a date, so that
 * "completed, then deleted" and "cancelled halfway, then deleted" stay
 * tellable apart.
 *
 * @param {*} siteId
 * @param {{id:string,status:string}[]} reported
 * @return {Promise<number>} how many campaigns actually changed
 */
/**
 * Mark finished any campaign whose slots have all landed.
 *
 * THE CHECK EXISTED IN ONE PLACE AND SLOTS ARRIVE BY TWO ROADS.
 *
 * /api/blog/published ends with "if nothing is outstanding and the campaign
 * is active, it is completed" — correct, and only reached when a publication
 * is reported as it happens. Slots ALSO become published through the live
 * reconciliation in /api/blog/posts-deleted, which is how every campaign
 * repaired after the orphaned-publish bug got there. That road had no such
 * check, so two campaigns sat at 'active' with six of six posts live: the
 * plugin's own screen called them Completed while the account page called
 * them In progress, and neither was lying.
 *
 * DECIDED FROM THIS SIDE'S OWN SLOTS, never from what a site claims. A site
 * cannot talk this side into calling a campaign finished — see the note on
 * applyReportedStatuses() — but it does not have to: the answer is already
 * here, in the slots, and only had to be looked at.
 *
 * 'failed' counts as landed. It is not coming, and a campaign held open for
 * ever by one failure is a campaign nobody can close.
 *
 * @return {Promise<number>} how many campaigns were marked completed
 */
/**
 * The same settle, for every campaign a USER owns.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE SWEEP. settleFinished() runs when a
 * site reports in — and a site with nothing new to say correctly stays quiet,
 * which means a campaign that is wrong on this side can stay wrong for ever
 * while both ends behave perfectly. Two campaigns with every post live sat at
 * "In progress" through four deploys and half a dozen presses of the button,
 * because nothing on the site had changed and so nothing called.
 *
 * A truth derived entirely from this side's own data should not wait on
 * anybody else's news. The report calls this as it builds, so the page
 * repairs itself the moment somebody looks at it — which is also the moment
 * a wrong answer would be seen.
 */
blogCampaignSchema.statics.settleFinishedForUser = function (userId) {
  return this.settleFinished({ user: userId });
};

blogCampaignSchema.statics.settleFinished = async function (siteId, ids) {
  /* NOT ONLY 'active', and that is not generosity — it is the repair.
   *
   * blogGenerator.js used to decide a finished batch's status from a STALE
   * in-memory copy of the campaign, so it read "nothing was written" and set
   * every campaign back to 'draft' straight after writing and charging for
   * the whole thing. Nothing ever reached 'active', so the completion check
   * that requires it never fired, and this sweep — which copied the same
   * condition — found nothing either.
   *
   * The generator is fixed, but every campaign written before that fix is
   * still sitting at 'draft' or 'writing' with all of its posts live, and no
   * batch is ever going to run on them again to correct it.
   *
   * A REAL DRAFT CANNOT MATCH. Its slots are 'pending' — nothing has been
   * written, so the outstanding count below is never zero. The only documents
   * this reaches are ones whose posts are all on the site, which is the
   * definition of finished whatever the bookkeeping says. */
  /* Scoped by site or by user. The sweep knows a site; the report knows a
   * user and every site under it. */
  const scope = (siteId && typeof siteId === 'object' && !siteId._bsontype && siteId.user)
    ? { user: siteId.user }
    : { site: siteId };

  const query = {
    ...scope,
    status: { $in: ['active', 'writing', 'draft'] },
    removedAt: null,
  };

  if (Array.isArray(ids) && ids.length) {
    query._id = { $in: ids };
  }

  const rows = await this.find(query).select('slots status').lean();

  let finished = 0;

  for (const row of rows) {
    const slots = row.slots || [];

    // A campaign with no slots at all has not finished; it has not started.
    if (!slots.length) continue;

    const outstanding = slots.filter(
      s => s.status !== 'published' && s.status !== 'failed'
    ).length;

    if (outstanding) continue;

    // Ownership and the status we read are both in the query, so a campaign
    // that changed underneath us loses rather than being overwritten.
    const result = await this.updateOne(
      { _id: row._id, ...scope, status: row.status },
      { $set: { status: 'completed' } }
    );

    finished += result.modifiedCount || 0;
  }

  return finished;
};

blogCampaignSchema.statics.applyReportedStatuses = async function (siteId, reported) {
  const ACCEPTED = new Set(['active', 'paused', 'cancelled']);

  // Mid-flight here. A sweep must not interrupt a batch this side is running.
  const PROTECTED = new Set(['draft', 'writing']);

  const wanted = new Map();

  for (const entry of Array.isArray(reported) ? reported : []) {
    const id = String((entry && entry.id) || '');
    const status = String((entry && entry.status) || '');

    if (!id || !ACCEPTED.has(status)) continue;

    wanted.set(id, status);
  }

  if (!wanted.size) return 0;

  const rows = await this.find({
    _id: { $in: [...wanted.keys()] },
    site: siteId,
  }).select('status').lean();

  let changed = 0;

  for (const row of rows) {
    const next = wanted.get(String(row._id));

    if (!next || next === row.status) continue;
    if (PROTECTED.has(row.status)) continue;

    // Ownership is in the query, not trusted from the loop above.
    const result = await this.updateOne(
      { _id: row._id, site: siteId, status: row.status },
      { $set: { status: next } }
    );

    changed += result.modifiedCount || 0;
  }

  return changed;
};

blogCampaignSchema.statics.markMissingRemoved = async function (
  siteId, presentIds, { when = new Date(), graceMs = 30 * 60 * 1000 } = {}
) {
  const present = new Set(
    (Array.isArray(presentIds) ? presentIds : []).map(id => String(id))
  );

  const candidates = await this.find({
    site: siteId,
    removedAt: null,
    createdAt: { $lt: new Date(Date.now() - graceMs) },
  }).select('_id').lean();

  const gone = candidates
    .map(c => String(c._id))
    .filter(id => !present.has(id));

  if (!gone.length) return 0;

  const result = await this.updateMany(
    { _id: { $in: gone }, removedAt: null },
    { $set: { removedAt: when } }
  );

  return result.modifiedCount || result.nModified || 0;
};

module.exports = mongoose.model('BlogCampaign', blogCampaignSchema);