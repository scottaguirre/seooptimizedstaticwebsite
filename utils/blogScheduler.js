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
// It does not generate. A slot's content is produced by the job runner, after
// the plugin asks for it. Generating here would mean paying for posts a site
// may never collect — a site that has been offline for a month would run up a
// bill for content nobody receives.

const BlogSite = require('../models/BlogSite');
const BlogCampaign = require('../models/BlogCampaign');
const { sign } = require('../middleware/requireSite');
const { checkSiteUrl } = require('./blog/siteUrlGuard');
const { log } = require('./logger');

// How often to look for work. Slots are dated to the minute, so anything under
// a minute is wasted queries; anything over five makes "publish at 09:00" mean
// "some time after 09:00" by more than a customer would accept.
const TICK_MS = Number(process.env.BLOG_SCHEDULER_TICK_MS) || 120000;

// A site is not pinged more often than this, however many slots are due. The
// plugin works through them one at a time and does not need to be told twice.
const MIN_PING_GAP_MS = Number(process.env.BLOG_MIN_PING_GAP_MS) || 10 * 60 * 1000;

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
 * Campaigns with work waiting, grouped by site.
 *
 * Two kinds of work, and both need a ping:
 *
 *   pending + due   a post whose time has come and has not been generated
 *   ready           a post generated and PAID FOR that never got published,
 *                   because the site was down when it was collected
 *
 * The second is the one that would otherwise be forgotten. A customer has
 * already been charged for those posts; leaving them unpublished is taking
 * money for nothing.
 */
async function findWork(now = new Date()) {
  const campaigns = await BlogCampaign.find({
    status: 'active',
    slots: {
      $elemMatch: {
        $or: [
          { status: 'pending', publishAt: { $lte: now } },
          { status: 'ready' },
        ],
      },
    },
  }).select('site slots.status slots.publishAt').lean();

  const bySite = new Map();

  for (const campaign of campaigns) {
    const due = (campaign.slots || []).filter(s =>
      s.status === 'ready' || (s.status === 'pending' && s.publishAt && s.publishAt <= now)
    );

    if (!due.length) continue;

    const key = String(campaign.site);
    if (!bySite.has(key)) bySite.set(key, []);
    bySite.get(key).push(String(campaign._id));
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

    const cutoff = new Date(Date.now() - MIN_PING_GAP_MS);

    const sites = await BlogSite.find({
      _id: { $in: [...work.keys()] },
      status: 'active',
      siteUrl: { $ne: '' },
      pingFailures: { $lt: MAX_PING_FAILURES },
      $or: [
        { lastPingAt: { $lt: cutoff } },
        { lastPingAt: { $exists: false } },
      ],
    });

    for (const site of sites) {
      const campaignIds = work.get(String(site._id)) || [];
      if (!campaignIds.length) continue;

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