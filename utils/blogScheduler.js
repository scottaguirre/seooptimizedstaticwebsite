// utils/blogScheduler.js
//
// Makes posts actually appear.
//
// WHY THE SERVER DRIVES THIS
//
// WP-Cron is not cron. It fires when someone visits the site, and these sites
// have no visitors — that is the whole reason the customer is buying posts. A
// campaign relying on WP-Cron on a brand new site would publish nothing, for
// weeks, silently. So the schedule lives here, where there is a real timer, and
// the plugin is woken by an HTTP request.
//
// WHAT THE PING IS
//
// A signed POST to <site>/wp-json/interlink/v1/run carrying nothing but a
// campaign id. It is a doorbell, not an instruction: the plugin decides what to
// do, calls /api/blog/generate, polls, publishes, and confirms with
// /api/blog/complete. Nothing about a post travels in this direction.
//
// That matters for safety. Pinging twice is harmless — the slot claim is
// atomic, so the second call finds the slot already taken. There is no state
// here that can be corrupted by a retry, a duplicate, or a crash mid-loop.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// It does not write and it does not publish. Both happen on the far side of
// the ping — writing in the job runner once the plugin approves a campaign,
// publishing in WordPress. This end only ever decides WHEN to knock.
//
// WHAT THE KNOCKING IS FOR NOW, WHICH HAS CHANGED
//
// It used to mean "a post is due — come and collect it", because a post was
// written on the day it was meant to appear. Nothing works that way any more:
// every post in a campaign is written when the campaign is approved, and
// WordPress publishes them from its own schedule.
//
// So there are three reasons to knock, and the third is the one that makes
// this component necessary rather than merely useful:
//
//   1. a batch is being written and the site needs to come and collect it
//   2. posts are written and paid for but the site has not taken them yet
//   3. A SCHEDULED POST'S DATE HAS PASSED AND IT IS STILL NOT PUBLIC
//
// The third is not an error case. WordPress publishes future posts through
// WP-Cron, WP-Cron fires when somebody visits the site, and these sites have
// no visitors — that is the entire reason the owner is buying posts. Left to
// itself a twelve-week campaign would publish nothing at all. The ping is what
// makes the site's clock tick.

const BlogSite = require('../models/BlogSite');
const BlogCampaign = require('../models/BlogCampaign');
const { sign } = require('../middleware/requireSite');
const { checkSiteUrl } = require('./blog/siteUrlGuard');
const { log } = require('./logger');

// How often to look for work.
//
// The old reasoning for this number was that a late tick made "publish at
// 09:00" mean "some time after 09:00". That is no longer this loop's problem:
// WordPress holds the publish date and the missed-schedule sweep has a
// fifteen-minute grace period anyway.
//
// What sets it now is collection. A ping gap is only ever as precise as the
// tick that enforces it, so the tick has to be shorter than the shortest gap
// or an "every two minutes" site is really pinged every four. One indexed
// query a minute is cheap; a customer watching a progress bar is not patient.
const TICK_MS = Number(process.env.BLOG_SCHEDULER_TICK_MS) || 60000;

// How often a site may be pinged, and there are two answers because there are
// two kinds of waiting.
//
// SOMEONE IS PROBABLY WATCHING. A campaign being written, or written and not
// yet collected, was approved by a person who is very likely still looking at
// the screen. A batch takes about eight minutes; a ten-minute gap would mean
// they sit in front of "still writing" long after it finished.
const COLLECT_GAP_MS = Number(process.env.BLOG_COLLECT_GAP_MS) || 2 * 60 * 1000;

// NOBODY IS WATCHING. A scheduled post that WP-Cron missed is hours or days
// late already; another few minutes changes nothing, and knocking gently keeps
// the loop cheap for the great majority of sites that have nothing to do.
const PUBLISH_GAP_MS = Number(process.env.BLOG_PUBLISH_GAP_MS) || 10 * 60 * 1000;

// How late a scheduled post must be before it counts as missed.
//
// Not zero, because the two clocks are not the same one. WordPress runs its
// cron on its own rhythm, and the site's timezone setting may not match what
// it reported at activation. Without a grace period every site with a campaign
// would be pinged in the minute after every scheduled post, whether or not
// anything was actually wrong.
const MISSED_GRACE_MS = Number(process.env.BLOG_MISSED_GRACE_MS) || 15 * 60 * 1000;

// A site that has not answered this many times in a row is treated as gone.
// Its campaigns stay planned and nothing is charged; it simply stops being
// contacted until it checks in of its own accord, which clears the counter.
const MAX_PING_FAILURES = Number(process.env.BLOG_MAX_PING_FAILURES) || 12;

// Enough for WordPress to accept the request and return. The plugin must
// answer immediately and do its work afterwards — this is a doorbell, and
// waiting for the whole errand would hold the loop open for a minute a site.
const PING_TIMEOUT_MS = Number(process.env.BLOG_PING_TIMEOUT_MS) || 10000;

let timer = null;
let running = false;
let ticking = false;

/**
 * Sign and send one wake-up.
 *
 * The signature is over the same canonical string the plugin verifies, using
 * the same secret — this is requireSite's scheme run in the opposite
 * direction, so there is one format to get right rather than two.
 */
async function pingSite(site, campaignIds) {
  const target = `https://${site.siteUrl}`;

  // Checked on EVERY ping, not once at activation. A hostname's addresses can
  // change after we first saw them, and a site that was public last month can
  // be pointed at an internal address today.
  const safe = await checkSiteUrl(target);
  if (!safe.ok) {
    log.security('blog.scheduler.unsafeUrl', {
      siteId: String(site._id),
      siteUrl: site.siteUrl,
      reason: safe.reason,
    });
    return { ok: false, reason: `unsafe url: ${safe.reason}` };
  }

  const path = '/wp-json/interlink/v1/run';
  const body = JSON.stringify({ campaigns: campaignIds });
  const timestamp = String(Math.floor(Date.now() / 1000));

  const signature = sign(site.secret, {
    timestamp,
    method: 'POST',
    path,
    rawBody: Buffer.from(body, 'utf8'),
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

  try {
    const response = await fetch(`${safe.url.origin}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-IL-Site': String(site._id),
        'X-IL-Timestamp': timestamp,
        'X-IL-Signature': signature,
        'User-Agent': 'InterlinkEngine-Scheduler/1',
      },
      body,
      signal: controller.signal,

      // The guard above validated ONE url. A redirect to an internal address
      // would bypass it entirely, and that is the standard way an SSRF check
      // is defeated. A WordPress REST endpoint has no business redirecting.
      redirect: 'manual',
    });

    if (response.status >= 300 && response.status < 400) {
      return { ok: false, reason: `redirected (${response.status})` };
    }

    if (!response.ok) {
      return { ok: false, reason: `HTTP ${response.status}` };
    }

    return { ok: true };

  } catch (err) {
    return {
      ok: false,
      reason: err.name === 'AbortError' ? 'timed out' : err.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Campaigns needing a knock, grouped by site.
 *
 * Three reasons, and they do not all deserve the same urgency:
 *
 *   writing     a batch is running. The person who approved it is probably
 *               still watching, and the site has to come and collect.
 *   ready       posts written and PAID FOR that the site has not taken. A
 *               site that was down when its batch finished comes back to find
 *               them waiting; leaving them there is taking money for nothing.
 *   scheduled   a post whose date has passed that is still not public. This
 *               is WP-Cron not running, which on a site with no visitors is
 *               the normal state of affairs rather than a fault.
 *
 * The first two are marked urgent, which buys a shorter ping gap. The third is
 * a backstop and can wait.
 *
 * @returns {Map<string, { campaigns: string[], urgent: boolean }>} keyed by site id
 */
async function findWork(now = new Date(), graceMs = MISSED_GRACE_MS) {
  const cutoff = new Date(now.getTime() - graceMs);

  const campaigns = await BlogCampaign.find({
    status: { $in: ['writing', 'active'] },
    $or: [
      // Being written. There are no interesting slots yet — the campaign's own
      // status is the whole signal.
      { status: 'writing' },
      // Written and waiting to be taken.
      { 'slots.status': 'ready' },
      // On the site, past its date, still invisible. $elemMatch because both
      // conditions have to hold for the SAME slot: without it, a campaign with
      // any scheduled slot and any old slot would match.
      { slots: { $elemMatch: { status: 'scheduled', publishAt: { $lte: cutoff } } } },
    ],
  }).select('site status slots.status slots.publishAt').lean();

  const bySite = new Map();

  for (const campaign of campaigns) {
    const slots = campaign.slots || [];

    const urgent = campaign.status === 'writing' || slots.some(s => s.status === 'ready');

    const missed = slots.some(
      s => s.status === 'scheduled' && s.publishAt && s.publishAt <= cutoff
    );

    // The database query is broader than the real test — a campaign matches on
    // 'slots.status': 'ready' without anything being late, and the $elemMatch
    // branch cannot express the grace period as precisely as this can. Re-check
    // rather than trust it.
    if (!urgent && !missed) continue;

    const key = String(campaign.site);

    if (!bySite.has(key)) {
      bySite.set(key, { campaigns: [], urgent: false });
    }

    const entry = bySite.get(key);
    entry.campaigns.push(String(campaign._id));
    entry.urgent = entry.urgent || urgent;
  }

  return bySite;
}

async function tick() {
  // A slow site must not cause two ticks to overlap and double-ping everyone.
  if (ticking) return;
  ticking = true;

  try {
    const work = await findWork();
    if (!work.size) return;

    // The LOOSER of the two gaps, so a site whose only work is urgent is not
    // filtered out here by the ten-minute rule. Each site's own gap is checked
    // below, once we know whether its work is urgent.
    const loosest = new Date(Date.now() - Math.min(COLLECT_GAP_MS, PUBLISH_GAP_MS));

    const sites = await BlogSite.find({
      _id: { $in: [...work.keys()] },
      status: 'active',
      siteUrl: { $ne: '' },
      pingFailures: { $lt: MAX_PING_FAILURES },
      $or: [
        { lastPingAt: { $lt: loosest } },
        { lastPingAt: { $exists: false } },
      ],
    });

    for (const site of sites) {
      const entry = work.get(String(site._id));
      const campaignIds = entry ? entry.campaigns : [];
      if (!campaignIds.length) continue;

      // Now the real gap for THIS site. A site with only a missed schedule
      // waiting is held to the slower cadence; one with a batch in flight is
      // not.
      const gap = entry.urgent ? COLLECT_GAP_MS : PUBLISH_GAP_MS;

      if (site.lastPingAt && Date.now() - site.lastPingAt.getTime() < gap) {
        continue;
      }

      // Recorded BEFORE the request, not after. A ping that hangs for the full
      // timeout would otherwise leave lastPingAt untouched, and the next tick
      // two minutes later would ping the same site again while the first is
      // still in flight.
      await BlogSite.updateOne({ _id: site._id }, { $set: { lastPingAt: new Date() } });

      const result = await pingSite(site, campaignIds);

      if (result.ok) {
        await BlogSite.updateOne(
          { _id: site._id },
          { $set: { pingFailures: 0, lastPingError: '' } }
        );

        log.info('blog.scheduler.pinged', {
          siteId: String(site._id),
          siteUrl: site.siteUrl,
          campaigns: campaignIds.length,
          urgent: entry.urgent,
        });

      } else {
        const updated = await BlogSite.findOneAndUpdate(
          { _id: site._id },
          {
            $inc: { pingFailures: 1 },
            $set: { lastPingError: String(result.reason).slice(0, 300) },
          },
          { new: true }
        );

        // One line per failure would fill the log with a site that has been
        // offline for a week. The first few, and then the moment it is given
        // up on, are the two things worth knowing.
        if (updated.pingFailures <= 3 || updated.pingFailures >= MAX_PING_FAILURES) {
          log.external('wordpress', 'pingFailed', {
            siteId: String(site._id),
            siteUrl: site.siteUrl,
            reason: result.reason,
            failures: updated.pingFailures,
            givingUp: updated.pingFailures >= MAX_PING_FAILURES,
          });
        }
      }
    }

  } catch (err) {
    log.error('blog.scheduler.tickFailed', err);
  } finally {
    ticking = false;
  }
}

function start() {
  if (running) return;
  running = true;

  timer = setInterval(tick, TICK_MS);

  // Do not run immediately. Mongo has only just connected, and a tick during
  // startup competes with everything else the process is doing.
  setTimeout(tick, 30000);

  log.info('blog.scheduler.started', { tickMs: TICK_MS });
  console.log(`📅 Blog scheduler active: checking every ${Math.round(TICK_MS / 1000)}s`);
}

function stop() {
  running = false;
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick, findWork, pingSite };