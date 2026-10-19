// utils/blog/render/interlinks.js
//
// Which articles are on the site, and what each one links to.
//
// WHY THIS IS NOT buildLinkPlan(), AND WHY IT REUSES HALF OF IT
//
// linkPlan.js answers the ring question at GENERATION time: when post 3 is
// being written, what should its forward link say? That question is about
// the prose — the anchor phrase has to be baked into the article, because
// the writer is told to emit `{{next}}<phrase>{{/next}}` verbatim and the
// checker verifies it character for character.
//
// This file answers a different question at RENDER time: the prose already
// has its tokens, so where should each one point TODAY? On WordPress that
// question never came up — the plugin wrote a post once and repaired its
// links later, one span at a time, because rewriting a published post is
// expensive. A static blog is re-rendered from scratch on every deploy, so
// there is nothing to repair. The links are simply correct each time.
//
// That is what "replaces repair_links()" means in the plan: not a port, a
// deletion. The pending-span mechanism survives only as the way to render
// a link that cannot exist yet as ordinary prose.
//
// THE RING ITSELF IS NOT REDECIDED HERE. ringNeighbours() in linkPlan.js
// owns it, including the awkward n = 2 case that cost Edwin a campaign
// where the second pillar linked to the first twice. A second
// implementation is a second chance to get it wrong, and the two would
// have to agree for the anchors in the prose to match the links they
// become.
//
// A DEPLOY IS PER BLOG, NOT PER CAMPAIGN, and that shapes this whole file.
//
// It would be simpler to render one campaign at a time, and it would be
// wrong twice over. The deploy uploads a whole site, so a run that knew
// about one campaign would delete the other's pages. And the root belongs
// to the BLOG — `homeSlug` on BlogSite — so deciding it needs every
// article in view at once, not just the ones in the campaign being looked
// at. The ring stays per-campaign, because a campaign is the thing whose
// articles were planned to link to each other.
//
// WHAT "LIVE" MEANS, AND IT IS THE RULING FROM 17 OCTOBER
//
//   scheduled  the article is written, it has a date, and we have not put
//              it on the site yet
//   published  we put it on the site, the upload worked, and its date has
//              arrived
//
// So an article belongs in a deploy once its date has passed AND it has
// been written. Everything else is not on the site, and a link to it would
// be a link to a 404 — worse than no link.
//
// NO CLOCK IN HERE. `now` is a parameter. A renderer that read the time
// itself could not be tested against a date boundary, and two files in one
// deploy could disagree about what day it is.

'use strict';

const { ringNeighbours } = require('../linkPlan');
const { postUrl, postPath } = require('./postPage');

/** A page's identity across campaigns. */
function keyOf(campaignId, slotIndex) {
  return `${String(campaignId)}:${slotIndex}`;
}

/**
 * The slots of a campaign, in ring order.
 *
 * SORTED, ALWAYS. ringNeighbours() works on array position, not on the
 * `index` field — hand it the array as Mongo happened to return it and
 * post 4's neighbour is whatever document came back next.
 */
function orderedSlots(campaign) {
  return ((campaign && campaign.slots) || []).slice().sort((a, b) => a.index - b.index);
}

/**
 * Is this article on the site as of `now`?
 *
 * BOTH CONDITIONS. A date that has passed is not enough — an article that
 * failed to write has nothing to deploy. Having been written is not enough
 * either, because the whole point of a schedule is that the batch is
 * written weeks before it goes out.
 *
 * `includeScheduled` LIFTS THE DATE GATE AND NOTHING ELSE.
 *
 * It exists because a brand-new blog is written and entirely future-dated,
 * so both buttons on the screen refuse and the owner has no way to see a
 * single page of what they have just paid for.
 *
 * IT IS A FLAG RATHER THAN A FAKE `now`, which was the obvious shortcut and
 * is wrong: `now` is handed to postPage and feeds.js as well, so moving it
 * would render the whole site as though it were some other day. Exactly one
 * line in this file reads the flag, and that is the only line that should.
 *
 * THE DATE IS STILL REQUIRED TO BE A REAL DATE — only the comparison is
 * skipped. liveArticles sorts on publishAt, and a slot admitted without one
 * sorts on NaN, whose comparator returns false for every test, so the order
 * falls back to whatever Mongo happened to return. The front page is
 * articles[0], so that would let two deploys of identical content serve
 * different articles at `/`.
 */
function isLive(slot, post, now, includeScheduled = false) {
  if (!post || !post.slug) return false;
  if (!slot || 'failed' === slot.status) return false;

  const at = slot.publishAt ? new Date(slot.publishAt) : null;
  if (!at || Number.isNaN(at.getTime())) return false;

  /* STRICTLY true, not merely truthy. This reaches here from a form field,
   * and a route that one day passes the string 'false' through would
   * otherwise turn every ordinary deploy into a batch dump. */
  if (true === includeScheduled) return true;

  return at.getTime() <= now.getTime();
}

/**
 * Every live article across the blog's campaigns, oldest first.
 *
 * OLDEST FIRST, AND THE TIE BREAKS ON SOMETHING STABLE. Two articles can
 * share a publish date — a gap of 0 days, or two campaigns scheduled the
 * same morning — and if the order of equals came from Mongo's result order
 * the root could change between two deploys of identical content.
 */
function liveArticles({ campaigns = [], posts = [], now, includeScheduled = false }) {
  const byKey = new Map();
  for (const post of posts) {
    if (post && Number.isInteger(post.slotIndex)) {
      byKey.set(keyOf(post.campaign, post.slotIndex), post);
    }
  }

  const out = [];

  for (const campaign of campaigns) {
    for (const slot of orderedSlots(campaign)) {
      const post = byKey.get(keyOf(campaign._id, slot.index));
      if (!isLive(slot, post, now, includeScheduled)) continue;

      out.push({ campaign, slot, post, key: keyOf(campaign._id, slot.index) });
    }
  }

  return out.sort((a, b) => {
    const at = new Date(a.slot.publishAt).getTime();
    const bt = new Date(b.slot.publishAt).getTime();
    if (at !== bt) return at - bt;
    if (a.slot.index !== b.slot.index) return a.slot.index - b.slot.index;
    return a.key < b.key ? -1 : 1;
  });
}

/**
 * Which live article is served at `/`.
 *
 * THE BLOG'S CHOICE FIRST, AND A FALLBACK THAT CANNOT LEAVE / EMPTY.
 *
 * `homeSlug` is what somebody picked. It is ignored — not obeyed and not
 * errored on — when that article is not live: deleted, rescheduled, or
 * simply not written yet. The root is the one page on the site that must
 * always answer, and a stale setting is not a reason to serve a 404 there.
 *
 * The fallback is the OLDEST live article rather than the newest. A blog's
 * front door should stay put: newest-first would move `/` to a different
 * article every time one published, and every old link to the root would
 * then point at something else.
 */
function homeOf({ blog, articles }) {
  if (!articles.length) return null;

  const wanted = String((blog && blog.homeSlug) || '').trim();
  if (wanted) {
    const chosen = articles.find(a => a.post.slug === wanted);
    if (chosen) return chosen;
  }

  return articles[0];
}

/**
 * The three targets for one article, in the shape applyLinks() expects.
 *
 * @param {Map} paths  key -> root-relative path, for every live article
 *
 * RELATIVE FOR THE RING, ABSOLUTE FOR THE MONEY PAGE, AND THE DIFFERENCE
 * IS NOT STYLISTIC.
 *
 * The money page is on somebody else's site — a WordPress install, a
 * client's domain — so it has to carry its host. The ring points at
 * articles on THIS site, and this site does not reliably know its own
 * address: `siteUrl` is the domain somebody typed when they added the
 * blog, while Cloudflare serves it from a pages.dev name of its own until
 * a custom domain is attached. Edwin hit exactly that the morning after
 * the first deploy — every in-article link went to a 404, because the
 * domain in them was not where the blog was.
 *
 * `/some-article/` resolves against whatever address the reader is on, so
 * the ring works on pages.dev, on the real domain, and on anything else
 * the site is ever served from, without re-rendering a single page.
 */
function targetsFor({ campaign, slotIndex, paths, post }) {
  const slots = orderedSlots(campaign);
  const position = slots.findIndex(s => s.index === slotIndex);
  if (position === -1) return {};

  const { prev, next } = ringNeighbours(slots, position);
  const targets = {};

  /* THE MONEY LINK, UNLESS THIS IS A PILLAR CAMPAIGN.
   *
   * Read from the flag, never inferred from an absent targetPage — an
   * ordinary campaign whose target page went missing is a bug, and
   * treating the absence as intent would quietly drop a third of the
   * links. The same reasoning, and the same trap, as linkPlan.js.
   *
   * THE ARTICLE'S OWN URL WINS WHEN IT HAS ONE. post.targetUrl is the
   * override the editor writes, and an empty one means "use the
   * campaign's" — which is what every article nobody has edited holds.
   *
   * THE PILLAR RULE STILL COMES FIRST, deliberately. A pillar campaign's
   * articles link to each other and to nothing else; an override on one
   * of them is a setting from a life it no longer has, most likely left
   * behind when somebody turned an ordinary campaign into a pillar. The
   * flag is the statement of intent and the override is not allowed to
   * quietly undo it for one article out of twelve.
   *
   * TRIMMED BEFORE IT IS CHOSEN, NOT AFTER, and the difference is a link
   * that silently disappears. A field someone cleared by selecting the
   * text and typing a space holds '   ' — truthy, so it wins the choice,
   * and only then trims to nothing. The article ends up with no money
   * link at all and the campaign's URL, which was right, never gets a
   * look in. Found by a test that passed '   ' among the empty values. */
  const override = String((post && post.targetUrl) || '').trim();
  const fallback = String((campaign.targetPage && campaign.targetPage.url) || '').trim();

  const money = campaign.isPillar ? '' : (override || fallback);

  if (money) targets.money = { url: money };

  /* THE ARTICLE'S OWN LINK, WHICH THE CAMPAIGN KNOWS NOTHING ABOUT.
   *
   * Somebody wrote {{link}}some words{{/link}} into a sentence and named
   * a URL on the article. There is no campaign value behind it and no
   * fallback: empty means the token unwraps to plain text and the
   * sentence simply reads as prose.
   *
   * NOT GATED ON isPillar, and that is the point of it. A pillar
   * campaign has no money page, so its articles have no {{money}} token
   * to retarget — this is the slot they have instead, and gating it the
   * same way would leave them with nothing again. */
  const extra = String((post && post.extraUrl) || '').trim();
  if (extra) targets.link = { url: extra };

  for (const [name, neighbour] of [['prev', prev], ['next', next]]) {
    if (!neighbour) continue;

    const href = paths.get(keyOf(campaign._id, neighbour.index)) || null;

    /* A LINK TO A PAGE THAT IS NOT DEPLOYED IS NOT A LINK.
     *
     * It becomes a span, which reads as ordinary prose and is styled as
     * such. The alternative is an anchor to a URL that 404s, which is
     * worse than no link for a reader and for a crawler.
     *
     * The pendingId is kept even though nothing swaps it later — a static
     * blog re-renders instead. It earns its place twice over: the theme
     * styles [data-il-link] as plain text, and the id says which article
     * the sentence is waiting on, which is the first thing you want to
     * know when a link has not appeared. */
    /* STILL CALLED `url`, because that is the key applyLinks() reads and
     * the plugin's own link plan uses the same word for the same slot. A
     * rename here would be a rename in links.js, in linkPlan.js and in the
     * PHP that mirrors them — for a field whose value is now a path. Not
     * worth it; the comment above says what it holds. */
    targets[name] = href ? { url: href } : { pendingId: `slot-${neighbour.index}` };
  }

  return targets;
}

/**
 * Everything this deploy should write, with its links resolved.
 *
 * @param {object}   opts
 * @param {object}   opts.blog       the BlogSite — siteUrl, homeSlug
 * @param {object[]} opts.campaigns  every campaign of this blog
 * @param {object[]} opts.posts      every BlogPost of those campaigns
 * @param {Date}     opts.now
 * @param {boolean} [opts.includeScheduled]  ignore the dates; see isLive
 *
 * @returns {Array<{ key, index, campaign, slot, post, isHome, url, targets }>}
 *
 * TWO PASSES, AND THEY CANNOT BE ONE. Which article is the root decides
 * its URL, and every other article's links have to use that URL rather
 * than the slug. So the root is settled and all the addresses are built
 * before a single `targets` object is made.
 *
 * ONLY THE LIVE ONES. An article whose date has not arrived is written and
 * paid for but is not on the site — that is what `scheduled` means. It
 * appears in no file and is linked from nothing until its own day.
 *
 * Unless `includeScheduled` says otherwise, which is somebody pressing a
 * button that says so.
 */
function renderPlan({ blog, campaigns = [], posts = [], now = new Date(), includeScheduled = false }) {
  const articles = liveArticles({ campaigns, posts, now, includeScheduled });
  const home = homeOf({ blog, articles });

  /* TWO MAPS, AND THEY ARE NOT THE SAME THING.
   *
   *   urls   absolute, for the canonical, og:url and the feeds — anything
   *          telling a machine where this article should be known by.
   *   paths  relative, for the links a reader clicks.
   *
   * See postPath() in postPage.js for why the second exists. */
  const urls = new Map();
  const paths = new Map();

  for (const article of articles) {
    const isHome = home === article;
    urls.set(article.key, postUrl(blog, article.post.slug, isHome));
    paths.set(article.key, postPath(article.post.slug, isHome));
  }

  return articles.map(article => ({
    key: article.key,
    index: article.slot.index,
    campaign: article.campaign,
    slot: article.slot,
    post: article.post,
    isHome: home === article,
    url: urls.get(article.key),
    targets: targetsFor({
      campaign: article.campaign,
      slotIndex: article.slot.index,
      paths,
      post: article.post,
    }),
  }));
}

module.exports = {
  renderPlan, targetsFor, isLive, homeOf, liveArticles, orderedSlots, keyOf,
};
