// utils/blog/restoreBlog.js
//
// A blog, back from its own backup.
//
// WHY THIS EXISTS
//
// A WordPress article lives twice — in Mongo and in `wp_posts`. A CLOUDFLARE
// ARTICLE LIVES ONCE. Cloudflare stores a rendered page, not an article, and
// the Pages API has no endpoint that hands a deployed file's contents back.
// So `_data/blog.json` ships inside every deploy as the second copy.
//
// It was written and never read, by anybody, ever. A backup nothing has ever
// restored from is a belief, not a backup — the same shape as
// utils/cleanupScheduler.js, which was correct, complete, and never once ran.
// This is the thing that turns the belief into a fact.
//
// PURE PLANNING, SEPARATE WRITING
//
// planRestore() takes the parsed JSON and returns the documents it WOULD
// write, plus every warning about what it cannot bring back. It touches no
// database, so the whole of the interesting logic is testable in memory.
// writeRestore() is the thin part that saves them.
//
// WHAT IT CANNOT BRING BACK, AND SAYS SO RATHER THAN INVENTING
//
//   user          required on BlogSite and BlogCampaign, and deliberately
//                 not in the backup — that file is served at a public URL.
//                 It has to be supplied by whoever runs the restore.
//   topic         required on a slot. The backup has the article's TITLE,
//                 which is close but is not the same thing: a topic is the
//                 brief, a title is what the writer made of it. Used as a
//                 stand-in and warned about, never passed off as the real
//                 value.
//   the schedule  everyDays, publishTime, the campaign's targetPage and the
//                 anchor mix are nowhere in the file. The articles come back
//                 whole and the campaign's FUTURE has to be set again.
//
// A V1 FILE IS READ, AND ITS LIMITS ARE NAMED. Version 1 carried no date, no
// campaign, no slotIndex and no link overrides. Those blogs can still be
// restored — the prose is all there — but every article comes back undated
// and in one synthetic campaign, and the caller is told so in as many words
// rather than finding out from a sitemap.

'use strict';

/** The shape version this file was written against. */
const EXPECTED_VERSION = 3;

/** Trim to a string, whatever arrived. */
function text(value) {
  return 'string' === typeof value ? value : (null === value || undefined === value ? '' : String(value));
}

/**
 * Group the backup's articles by the campaign they belonged to.
 *
 * A V1 FILE HAS NO CAMPAIGN ON ANY ARTICLE, so every one of them falls into
 * a single synthetic campaign rather than into a hundred campaigns of one.
 * The ring is wrong either way — it cannot be otherwise, the information is
 * gone — but one campaign of twelve is a blog somebody can fix by hand and
 * twelve campaigns of one is not.
 */
function byCampaign(posts) {
  const groups = new Map();

  for (const post of posts) {
    const key = text(post && post.campaign) || 'restored';

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(post);
  }

  return groups;
}

/** The campaign the backup recorded for this key, if it recorded any. */
function recordedFor(backup, key) {
  const all = Array.isArray(backup && backup.campaigns) ? backup.campaigns : [];
  return all.find(c => c && text(c.id) === text(key)) || null;
}

/**
 * What a restore would create.
 *
 * @param {object} backup  the parsed _data/blog.json
 * @param {object} opts
 * @param {string} opts.user  the account to attach it to. Required.
 *
 * @returns {{ ok, site?, campaigns?, posts?, warnings, error? }}
 */
function planRestore(backup, { user } = {}) {
  const warnings = [];

  if (!backup || 'object' !== typeof backup) {
    return { ok: false, error: 'That is not a backup file.', warnings };
  }

  if (!text(user)) {
    /* REFUSED RATHER THAN DEFAULTED. `user` is required on both BlogSite and
     * BlogCampaign; guessing it would attach somebody's blog to the wrong
     * account, which is worse in every direction than stopping. */
    return { ok: false, error: 'A user id is required: the backup does not contain one, by design.', warnings };
  }

  const version = Number(backup.version) || 0;

  if (version > EXPECTED_VERSION) {
    return {
      ok: false,
      warnings,
      error: `This backup is version ${version} and this restore understands ${EXPECTED_VERSION}. `
        + 'Use a newer restore rather than dropping whatever it added.',
    };
  }

  if (version < EXPECTED_VERSION) {
    warnings.push(
      `Version ${version} backup. It has no publication dates, no campaign or slot numbers, `
      + 'and none of the per-article link overrides — those articles will come back undated '
      + 'and in one campaign.'
    );
  }

  const blog = backup.blog || {};
  const domain = text(blog.domain);

  if (!domain) return { ok: false, error: 'The backup names no domain.', warnings };

  const articles = Array.isArray(backup.posts) ? backup.posts : [];

  if (!articles.length) warnings.push('The backup contains no articles.');

  /* THE SITE. `secret` is NOT restored and must not be: it is the HMAC key a
   * WordPress install signs with, it was never in the backup, and a restored
   * blog is a Cloudflare blog which has no use for one. A new one is minted
   * if the blog is ever pointed at WordPress. */
  const site = {
    user: text(user),
    siteUrl: domain,
    target: 'cloudflare',
    status: 'active',
    timezone: text(blog.timezone) || 'UTC',
    business: { name: text(blog.name) },
  };

  if (!text(blog.timezone)) {
    warnings.push('The backup names no timezone, so dates will be restored as UTC.');
  }

  const groups = byCampaign(articles);
  const campaigns = [];
  const posts = [];

  for (const [key, group] of groups) {
    /* ORDERED BY THE SLOT NUMBER WHERE THERE IS ONE, and by the order the
     * file lists them where there is not. blogJson.js sorts by createdAt
     * before writing, so a v1 file's order is still publication order — the
     * one piece of the ring that survived. */
    const ordered = group.slice().sort((a, b) => {
      const ai = Number.isInteger(a.slotIndex) ? a.slotIndex : Number.MAX_SAFE_INTEGER;
      const bi = Number.isInteger(b.slotIndex) ? b.slotIndex : Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });

    const slots = ordered.map((article, i) => {
      /* Number.isInteger, NOT `Number(x) || i`, AND THE DIFFERENCE IS
       * UNREACHABLE HERE — worth writing down rather than leaving for
       * somebody to rediscover.
       *
       * `|| i` treats slot 0 as missing, which is normally the bug that
       * loses the front page of every blog. It cannot bite on this line:
       * the articles were just sorted by slotIndex, so a slot 0 is already
       * at position 0 and `0 || 0` is 0 either way. Mutation testing put
       * `|| i` back and nothing failed, correctly.
       *
       * Kept anyway. It says what is meant — a slot number of zero is a
       * slot number — and it stops being equivalent the moment anybody
       * changes the sort above it, which is exactly the sort of change
       * that arrives without anyone thinking about this line. */
      const index = Number.isInteger(article.slotIndex) ? article.slotIndex : i;

      return {
        index,

        /* THE TITLE STANDING IN FOR THE TOPIC, which is required and is not
         * in the backup. A topic is the brief the writer was given; a title
         * is what it made of it. Close enough to restore with, not close
         * enough to pretend about — hence the warning below. */
        topic: text(article.title) || text(article.slug),

        slug: text(article.slug),
        publishAt: article.publishAt ? new Date(article.publishAt) : null,

        /* `published`, because it WAS. Everything in a backup was on the
         * site when the file was written — blogJson is built from the render
         * plan, which is the live articles and nothing else. */
        status: 'published',
        publishedUrl: `https://${domain}/${text(article.slug)}/`,
      };
    });

    /* THE RECORDED CAMPAIGN, IF THE BACKUP HAS ONE. v3 writes them down; v1
     * and v2 did not, and a restore from those still has to invent one. The
     * invention is now explicit and warned about rather than silent. */
    const recorded = recordedFor(backup, key);

    campaigns.push({
      /* THE KEY TRAVELS WITH THE CAMPAIGN, and it is not the name.
       *
       * The writer first recovered it by stripping "Restored " off the
       * display name — which meant the link between a campaign and its
       * articles depended on a string meant for a human to read. Rename
       * the campaign and every post is assigned `campaign: undefined`,
       * which is `required: true`, so the restore dies partway with the
       * blog and its campaigns written and not one article. */
      key,

      user: text(user),
      name: (recorded && text(recorded.name)) || `Restored ${key}`,
      status: 'active',
      slots,

      /* isPillar DECIDES WHETHER targetPage IS REQUIRED AT ALL, which is
       * why guessing it was fatal. The model refuses a non-pillar campaign
       * with no money page and accepts a pillar one, so a wrong guess
       * either kills the restore or silently changes what the campaign is.
       *
       * UNRECORDED DEFAULTS TO PILLAR — the only value that can be SAVED
       * when the money page is unknown, which it always is on a v1 or v2
       * backup. Warned about below rather than passed off as fact. */
      isPillar: recorded ? !!recorded.isPillar : true,

      linkMode: (recorded && 'extend' === recorded.linkMode) ? 'extend' : 'standalone',
      schedule: recorded ? recorded.schedule : undefined,
      slots,

      /* NULL WHEN THERE IS GENUINELY NOTHING, which is what a pillar has
       * and what an unrecorded campaign leaves us with. Never invented: a
       * plausible guess would point the next campaign's money links at a
       * URL nobody chose, on a live site. */
      targetPage: (recorded && recorded.targetPage && recorded.targetPage.url)
        ? recorded.targetPage
        : null,
    });

    for (const article of ordered) {
      posts.push({
        campaignKey: key,
        slotIndex: Number.isInteger(article.slotIndex)
          ? article.slotIndex
          : ordered.indexOf(article),
        slug: text(article.slug),
        title: text(article.title),
        metaDescription: text(article.metaDescription),
        words: Number(article.words) || 0,
        sections: Array.isArray(article.sections) ? article.sections : [],
        targets: article.targets && 'object' === typeof article.targets ? article.targets : {},
        targetUrl: text(article.targetUrl),
        extraUrl: text(article.extraUrl),
      });
    }
  }

  /* COUNTED FROM THE FILE, NOT FROM THE PLAN — and this is a CLARITY fix,
   * not a bug fix, which is worth being exact about.
   *
   * This line first read `posts.filter((_, i) => !articles[i].publishAt)`,
   * pairing one array's positions with another's contents. That looked
   * wrong, because `posts` is regrouped by campaign and reordered by slot
   * while `articles` is file order. Mutation testing put the old form back
   * and no test noticed, so it was checked properly: the two arrays always
   * hold the same NUMBER of items — posts is every article, rearranged —
   * and both expressions therefore count the same thing, always.
   *
   * EQUIVALENT, THEN, AND DOCUMENTED RATHER THAN TESTED AROUND. The reason
   * for the current form is that it says what it means: how many articles
   * in this file have no date. The old one only worked by a coincidence of
   * lengths, and the next person to add a filter to `posts` would have
   * turned that coincidence into a real bug with nothing to catch it. */
  const undated = articles.filter(a => !a || !a.publishAt).length;

  if (undated) {
    warnings.push(`${undated} of ${articles.length} articles have no publication date.`);
  }

  /* THE APOLOGY IS CONDITIONAL NOW, because v3 records the schedule and the
   * money page. Repeating it on a backup that HAS them is the same failure
   * in the other direction: a warning nobody needs teaches people to skip
   * the warnings. */
  const guessed = campaigns.filter(c => !recordedFor(backup, c.key));

  if (guessed.length) {
    warnings.push(
      `${guessed.length} campaign(s) are not described in this backup, so their kind, `
      + 'money page and cadence were assumed. Check them before extending a campaign.'
    );
  }

  warnings.push('Slot topics were restored from article titles, which is close but is not the original brief.');

  return { ok: true, site, campaigns, posts, warnings };
}

/**
 * Save what planRestore() worked out.
 *
 * THE MODELS ARE INJECTED, so the whole of this — the order things are
 * created in, the campaign-to-article mapping, which fields reach the
 * documents — is testable without a database. It was inline in
 * scripts/restore-blog.js and therefore untested, which for the one piece
 * of code that exists to run on the worst day is the wrong way round.
 *
 * ORDER IS FORCED: a campaign needs the site's id, an article needs both.
 *
 * NOT A TRANSACTION, and it cannot be one without a replica set. A failure
 * partway leaves a blog and some of its articles — so the caller is told
 * what was written rather than left to guess.
 */
async function writeRestore({ plan, Site, Campaign, Post } = {}) {
  if (!plan || !plan.ok) return { ok: false, error: 'There is no plan to write.' };

  const site = await Site.create(plan.site);

  /* KEYED BY THE PLAN'S OWN KEY, not by anything displayed. */
  const ids = new Map();

  for (const campaign of plan.campaigns) {
    const { key, ...fields } = campaign;
    const saved = await Campaign.create(Object.assign({}, fields, { site: site._id }));
    ids.set(key, saved._id);
  }

  let written = 0;
  const orphans = [];

  for (const post of plan.posts) {
    const { campaignKey, ...fields } = post;
    const campaign = ids.get(campaignKey);

    /* AN ARTICLE WITH NO CAMPAIGN IS NOT WRITTEN AT ALL. `campaign` is
     * required on BlogPost, so passing undefined throws and takes the rest
     * of the restore down with it — losing the articles that would have
     * saved cleanly. Collected and reported instead. */
    if (!campaign) {
      orphans.push(fields.slug || '(no slug)');
      continue;
    }

    await Post.create(Object.assign({}, fields, { site: site._id, campaign }));
    written += 1;
  }

  return {
    ok: true,
    siteId: site._id,
    campaigns: ids.size,
    posts: written,
    orphans,
  };
}

module.exports = { planRestore, byCampaign, writeRestore, EXPECTED_VERSION };
