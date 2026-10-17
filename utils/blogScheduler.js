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
const BlogPost = require('../models/BlogPost');
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

// How much of a refusing site's reply to keep.
//
// Enough for a WordPress REST error — {"code":"…","message":"…"} — or the
// first line of a PHP fatal, and not so much that one broken site fills the
// log with its own HTML error page.
const PING_DETAIL_CHARS = 300;

/**
 * How often to sweep articles whose retention window has closed.
 *
 * Hourly, on a loop that ticks every minute, because the window is measured
 * in days. Sweeping on every tick would be sixty indexed deletes an hour to
 * remove things that became deletable at some point in the last fifteen days.
 */
const SWEEP_GAP_MS = Number(process.env.BLOG_SWEEP_GAP_MS) || 60 * 60 * 1000;

let timer = null;
let running = false;
let ticking = false;
let lastSweepAt = 0;

/**
 * What a site said when it refused, in one short line.
 *
 * WHY THIS EXISTS, WHICH IS NOT "MORE LOGGING IS NICE"
 *
 * `HTTP 500` was the whole of what we recorded, and it is almost no
 * information: it says the site answered and the answer was bad. Edwin's site
 * returned 500 to every ping for most of a day while collection by hand worked
 * perfectly, and six rounds of screenshots could not narrow it down — because
 * the reason was in the reply body every time, and we read the status line and
 * threw the rest away.
 *
 * THE SITE IS NOT TRUSTED. This string is written to our log and shown on our
 * admin screen, so it is treated as hostile input: bounded hard, tags removed,
 * control characters and runs of whitespace collapsed to single spaces.
 *
 * NEVER THROWS. It runs inside the failure path of a ping; a site that sends
 * a malformed body or hangs up mid-read must not turn a recorded failure into
 * an unrecorded one. The read is also already covered by the caller's abort
 * signal, so a site that dribbles bytes cannot hold the loop open.
 */
async function whatItSaid(response) {
  try {
    const text = await response.text();

    const flat = String(text)
      .replace(/<[^>]*>/g, ' ')
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!flat) return 'empty response';

    return flat.length > PING_DETAIL_CHARS
      ? `${flat.slice(0, PING_DETAIL_CHARS)}…`
      : flat;

  } catch (err) {
    return `unreadable response (${err.message})`;
  }
}

/**
 * Where to knock, given the site's verified url and the REST route.
 *
 * ONE STRING CONCATENATION, and it was wrong for every WordPress that is not
 * at the root of its domain — see the note inside pingSite() for what that
 * cost. Pulled out here only so a test can call it: reaching it through
 * pingSite() means resolving a hostname first.
 *
 * `url` is the URL object checkSiteUrl() returned, so it has already been
 * through the SSRF guard. This does not re-check anything and must not be
 * called with a url that has not.
 *
 * @param {URL} url     the verified site url, which may carry a subfolder
 * @param {string} path the REST route, rooted: '/wp-json/interlink/v1/run'
 */
function pingTarget(url, path) {
  /* Trailing slashes go, so '/blog/' and '/blog' cannot produce
   * '/blog//wp-json/…' — which some servers 404 and others redirect, and a
   * redirect is refused by the caller, correctly, as an SSRF risk.
   *
   * A url with no path at all has pathname '/', which this reduces to '' —
   * the behaviour every site working today depends on. */
  const base = String( ( url && url.pathname ) || '' ).replace(/\/+$/, '');

  return `${url.origin}${base}${path}`;
}

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

  /* WORDPRESS IS NOT ALWAYS AT THE ROOT, and until 11 October this assumed it
   * was. The request was built from `safe.url.origin`, which is scheme, host
   * and port and NOTHING ELSE — so a site living in a subfolder was knocked on
   * at the wrong address, every time.
   *
   * Edwin's staging site is hyi.xlr.temporary.site/website_3ef45ace. The pings
   * went to hyi.xlr.temporary.site/wp-json/… — the ROOT of a shared preview
   * host, where some other WordPress answered, with a different secret. The
   * recorded failure was:
   *
   *     HTTP 401: {"code":"ie_bad_signature","message":"Signature did not match."}
   *
   * which reads as a broken secret and is nothing of the kind. It is also not
   * a staging-only problem: example.com/blog is an ordinary way to run a
   * marketing blog under a main site, and every one of those installs has been
   * silently uncollectable — posts written, charged for, and arriving only if
   * the owner finds the Check now button.
   *
   * THE SIGNATURE DOES NOT GET THE PREFIX, and that asymmetry is the whole
   * subtlety. The plugin verifies against '/wp-json/' . $request->get_route(),
   * and WordPress reports a route WITHOUT the subfolder — '/interlink/v1/run'
   * whether the install is at the root or ten directories down. So the string
   * being signed stays `path`, exactly as it was, and every site working today
   * goes on working. Adding `base` to the signature would break all of them.
   *
   * Built by pingTarget() rather than inline, so a test can call it: the whole
   * fault was one string concatenation, and reaching it through pingSite()
   * needs working DNS. */
  const endpoint = pingTarget(safe.url, path);

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
    const response = await fetch(endpoint, {
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
      return { ok: false, reason: `HTTP ${response.status}: ${await whatItSaid(response)}` };
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

/**
 * Delete articles whose fifteen-day window has closed.
 *
 * WHY IT RIDES THIS LOOP INSTEAD OF HAVING ITS OWN.
 *
 * utils/cleanupScheduler.js is the reason. It was written to delete expired
 * build folders, it exports startCleanupScheduler(), and NOTHING IN THE APP
 * EVER CALLED IT — the only other mention in the tree is a comment. So it has
 * never run, dist/ has grown since launch, and nobody noticed for months
 * because a sweeper that does nothing looks exactly like a sweeper with
 * nothing to do.
 *
 * This loop is already started from server.js and already proven to run every
 * minute in production. Hanging the sweep off it means there is no second
 * thing to remember to wire up.
 *
 * AND IT LOGS EVERY RUN, INCLUDING THE ZEROS. That is the other half of the
 * same lesson: "0 removed" in the log is the difference between "nothing was
 * due" and "it is not running at all", and those are indistinguishable from
 * the outside otherwise.
 *
 * It holds no policy. Everything deletable was marked deletable at
 * confirmation time by utils/blog/retention.js.
 */
async function sweepArticles(now = Date.now()) {
  if (now - lastSweepAt < SWEEP_GAP_MS) return 0;
  lastSweepAt = now;

  try {
    const removed = await BlogPost.sweepDeletable(new Date(now));

    log.info('blog.articles.swept', { removed });
    return removed;

  } catch (err) {
    /* Swallowed on purpose. A failed sweep leaves articles in place, which is
     * the harmless direction, and it must not stop the tick that collects and
     * publishes for every site. The retry is in an hour either way. */
    log.error('blog.articles.sweepFailed', err);
    return 0;
  }
}

async function tick() {
  // A slow site must not cause two ticks to overlap and double-ping everyone.
  if (ticking) return;
  ticking = true;

  try {
    /* BEFORE findWork(), and that is not cosmetic: the next line returns
     * early when no site has work, which is the normal state most minutes.
     * Putting the sweep after it would mean it ran only on the minutes
     * something else happened to be due. */
    await sweepArticles();

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
        /* lastPingOkAt IS THE ONLY STAMP THAT MEANS "IT WORKED".
         *
         * lastPingAt is written before the request goes out, by design, so it
         * cannot answer the question support actually asks — when did we last
         * get through? Without this, a site refusing every ping for a week
         * still showed a lastPingAt from one minute ago. */
        await BlogSite.updateOne(
          { _id: site._id },
          { $set: { pingFailures: 0, lastPingError: '', lastPingOkAt: new Date() } }
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
            /* 400, not 300, and the extra hundred is not slack. The reason now
             * carries the site's own words after an "HTTP 500: " prefix, and
             * whatItSaid() already bounds those at 300 — cutting the pair at
             * 300 would throw away the end of every message that mattered. */
            $set: { lastPingError: String(result.reason).slice(0, 400) },
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

/* whatItSaid is exported for its tests, and that is worth a line rather than a
 * shrug. The honest test would drive pingSite() with a stubbed fetch — but
 * pingSite resolves the site's hostname through the SSRF guard before it gets
 * anywhere near a reply, so that test needs working DNS and cannot run in a
 * sandbox or on a laptop in a hotel. The sanitising is the part with the rules
 * in it; test-ping-detail.js checks it directly, and checks separately that
 * the failure branch still calls it. */
module.exports = { start, stop, tick, findWork, pingSite, whatItSaid, pingTarget, sweepArticles };