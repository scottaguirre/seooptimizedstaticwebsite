// models/CloudflareSite.js
//
// One generated website published to a subdomain on Cloudflare Pages.
//
//     hvac + acmesites.com   ->   hvac.acmesites.com
//
// WHY THIS IS NOT BlogSite, AND NOT A Site EITHER
//
// A BlogSite is a blog: it owns campaigns, posts, a timezone, a publishing
// schedule and — for the WordPress half — a licence key. None of that exists
// here. This row holds a hostname, the Cloudflare project serving it, and
// when it was last published. Putting it in BlogSite would mean every query
// in staticBlogsRoute.js growing a filter to exclude it, and the first one
// forgotten is a website rendered through the blog planner.
//
// It is not the GitHub Pages `Site` either, for the reason Edwin gave on 5
// November: *"I want to keep github as we have it right now. I don't want to
// replace it."* The two publish to different places by different mechanics —
// a repository per site under one domain, against a Pages project per
// subdomain — and a single row trying to be both would carry one set of
// fields that are null half the time.
//
//
// WHAT IT DELIBERATELY DOES NOT STORE: THE SITE'S FILES
//
// The generator writes to `dist/user_<id>/`, which is ONE FOLDER PER USER,
// wiped and refilled by the next build. There is no archive of past builds —
// `utils/buildRegistry.js` keeps them in a `Map` that is pruned after an hour
// and lost on restart.
//
// So this row cannot mean "the files that were published". It means THE
// ADDRESS AND THE PROJECT. The published files live in Cloudflare, which is
// the only place they need to live: republishing takes whatever is in
// dist/user_<id> now and deploys it over the same project, and the thing
// being kept between publishes is the hostname, not the HTML.
//
// That is the whole difference between this screen and a site picker, and it
// is why there is no site picker.

const mongoose = require('mongoose');

const cloudflareSiteSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  /**
   * The full hostname, lowercase: `hvac.acmesites.com`.
   *
   * NAMED siteUrl, AND THE NAME IS LOAD-BEARING. deployBlog() reads
   * `blog.siteUrl` to decide which domain to attach to the project and
   * `blog.project` to decide where to deploy. Those two fields are the
   * entire contract, so this row satisfies it by spelling them the same
   * way rather than by being adapted at every call site.
   *
   * UNIQUE ACROSS EVERY ACCOUNT, not per user. Two customers taking the
   * same prefix on the same pool domain would deploy over each other, and
   * whichever published second would win with nothing on either screen to
   * say so — the mistake staticBlogsRoute.js found and fixed on 22 October.
   * The index is what makes that impossible rather than merely checked.
   */
  siteUrl: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    unique: true,
  },

  /** What to call it on the list. The business name from the build. */
  name: { type: String, default: '', trim: true },

  /**
   * The Cloudflare Pages project serving it.
   *
   * EMPTY MEANS NEVER PUBLISHED, and deployBlog() relies on exactly that:
   * an empty `project` is its signal to create the project and attach the
   * domain, and a set one is its signal to just deploy. Clearing this field
   * by hand would make the next publish try to create a project that
   * already exists — which ensureProject() tolerates, but the domain
   * attach would run a second time too.
   *
   * WRITTEN FROM THE DEPLOY RESULT, NOT GUESSED FROM THE HOSTNAME.
   * Cloudflare does not always give a project the name asked for;
   * `appliancerepaircedarpark-com` became `appliancerepaircedarpark-com-bx6`
   * because the subdomain has to be unique across all of Cloudflare.
   */
  project: { type: String, default: '', trim: true },

  /**
   * The Cloudflare account this site's domain is on.
   *
   * BOUND AT CREATE, ONCE, AND NEVER LOOKED UP AGAIN — the same rule
   * BlogSite follows and for the same reason. A Domain row can be
   * re-pointed at another account later; resolving live at publish time
   * would silently aim the deploy at an account where this site's Pages
   * project does not exist, and the error would be "project not found"
   * about a project that is right there.
   */
  cloudflareAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CloudflareAccount',
    index: true,
  },

  /**
   * The address Cloudflare last served it at: `<project>.pages.dev`.
   *
   * KEPT FOR TWO JOBS, AND THE SECOND ONE IS WHY IT MATTERS.
   *
   *   1. The link that works immediately. A custom domain can take minutes
   *      and sometimes needs the registrar; until the certificate is issued
   *      this is the only address that answers, and a screen showing only
   *      the hostname looks broken while everything is working.
   *
   *   2. `expected` WHEN THE SITE IS DELETED. removeDnsRecord() refuses to
   *      delete any CNAME that does not point here — and Edwin's zones hold
   *      live sites on the same domain, so one careless delete in there
   *      takes down something nobody was deleting.
   *
   * NOT THE DEPLOYMENT-HASHED ONE. `de7c47e4.<project>.pages.dev` changes
   * every publish and 404s on TLS for a few minutes on a new project,
   * because `*.pages.dev` is a one-level wildcard — the mismatch Edwin hit
   * the night the first blog deploy worked.
   *
   * SPELT lastDeployUrl BECAUSE BlogSite SPELLS IT THAT WAY. Both feed the
   * same `expected` argument to the same function; two names for one value
   * is how a delete path gets written against the wrong field.
   */
  lastDeployUrl: { type: String, default: '', trim: true },

  /**
   * Whether it is on the internet, and whether it still should be.
   *
   *   draft    created, never successfully deployed
   *   live     deployed at least once
   *   removed  deleted by the owner; the row stays
   *
   * 'removed' RATHER THAN A DELETE, because the row is the only record that
   * this hostname was ever used. A hard delete frees the subdomain for
   * somebody else while Cloudflare may still hold the project and the DNS
   * record, and the next publish on that name would collide with a
   * leftover nobody can see. The row is kept and the list hides it.
   *
   * AND `removed` ALONE DOES NOT RESERVE THE HOSTNAME ANY MORE — see
   * `released` below. Edwin, 17 November, having deleted a test site and
   * been refused its name: *"i deleted the previus site and now it wont let
   * me use it withe same business name"*.
   */
  status: {
    type: String,
    enum: ['draft', 'live', 'removed'],
    default: 'draft',
    index: true,
  },

  /**
   * What the delete actually managed to take down at Cloudflare.
   *
   * WHY IT IS THREE FACTS AND NOT ONE FLAG. The reservation above exists
   * for a leftover — a custom domain still attached, a DNS record still
   * pointing, a Pages project still holding the name. Each is removed by a
   * separate call and each can fail on its own, which is why the delete
   * already logs all three. It just never wrote them down, so nothing could
   * tell a clean delete from a half-finished one and both reserved the
   * hostname for ever.
   *
   *     THE ROW REMEMBERED THAT THE NAME HAD BEEN USED AND NOT WHETHER IT
   *     WAS STILL IN USE. Those are different questions and only the
   *     second one should refuse a new site.
   *
   * ALL THREE TRUE MEANS THE HOSTNAME IS FREE, and checkWant() then lets it
   * be taken again. Anything less and it stays reserved, which is the case
   * the rule was written for.
   *
   * A SITE THAT NEVER DEPLOYED SETS ALL THREE TOO. There is no project, no
   * domain and no record to take down, so nothing can be left behind —
   * `project: ''` and a reserved hostname was the strictest possible answer
   * to a question with nothing in it.
   *
   * DEFAULTS ARE false, SO EVERY ROW WRITTEN BEFORE THIS FIELD EXISTED
   * STAYS RESERVED. That is the safe direction: an old removed site may
   * well still have a project behind it, and nothing stored can say
   * otherwise. The names those rows hold can be released by hand.
   */
  released: {
    /** The custom domain was detached from the Pages project. */
    domain: { type: Boolean, default: false },

    /** The DNS record we created was removed from the zone. */
    dns: { type: Boolean, default: false },

    /** The Pages project itself was deleted. */
    project: { type: Boolean, default: false },

    /** When, for anybody reading a row and wondering. */
    at: { type: Date, default: null },
  },

  /**
   * The hostname this row USED to answer on, once it gave the name back.
   *
   * ⚠ THE FIELD ABOVE WAS ONLY HALF THE FIX, AND THE OTHER HALF FAILED IN
   * FRONT OF A CUSTOMER — 20 November, site 4 of a batch of 7.
   *
   * On 17 November checkWant() was taught that a fully released row does not
   * reserve its hostname. `unique: true` on siteUrl was not taught anything,
   * and it is the one that actually refuses:
   *
   *     checkWant  →  "free"              (the row is excluded by $nor)
   *     create()   →  E11000 duplicate    (the index sees every row)
   *
   * The build had already run and the credits were already spent, so the
   * batch reported a site that was written, paid for and nowhere — under
   * the code `raced`, which says two requests collided when nothing had.
   *
   *     A RULE ENFORCED IN TWO PLACES IS A RULE THAT WILL BE CHANGED IN
   *     ONE OF THEM. The query learned the new rule; the index could not,
   *     because an index cannot read a comment.
   *
   * SO THE NAME IS HANDED BACK INSTEAD OF ARGUED ABOUT. When a teardown
   * releases all three, `siteUrl` becomes a marker that is not a hostname
   * and the real one moves here. The index then has nothing to hold, and
   * "the address is free to use again" is true rather than nearly true.
   *
   * THE ROW STILL EXISTS, which is the whole reason for this field rather
   * than a delete. Its name, its publish count and its dates are the only
   * record that the site was ever there, and three result pages print the
   * hostname AFTER the teardown has run — they read this.
   *
   * EMPTY ON EVERY LIVE SITE, and on every removed row that left something
   * behind at Cloudflare. Those still hold their hostname, exactly as
   * `released` above describes, because something is still up there.
   */
  releasedUrl: { type: String, default: '', trim: true, lowercase: true },

  /**
   * What this site is made of, kept so it can be rendered again.
   *
   * TWO FIELDS BECAUSE THEY ANSWER TWO QUESTIONS. `contentModel` is the
   * site's WORDS — the parsed `_src/content.json`, which is what the edit
   * screen shows and writes back. `buildRecipe` is what the WIZARD WAS
   * ASKED FOR — the parsed `_src/build.json`, carrying the service pages,
   * the keywords and, critically, the checkboxes.
   *
   * THE MODEL ALONE CANNOT REBUILD THE SITE. A checkbox is a decision and
   * the model records outcomes: a site whose owner unticked the price table
   * has no pricing section, which is indistinguishable in the model from a
   * trade that is not permitted one. Re-render from the model alone and
   * optional sections flip to whichever way the defaults fall.
   *
   * STORED AS OBJECTS, NOT STRINGS. Mongoose Mixed keeps what it is given
   * and these are read whole and written whole — nothing queries inside
   * them. A 43 KB model and a few KB of recipe sit a long way under the
   * 16 MB document ceiling; measured on a real six-page build.
   *
   * THE IMAGES ARE NOT HERE. They live on disk under builds/sites/<id>/ —
   * see utils/cloudflareSites/siteStore.js for why a 512 MB database is the
   * wrong home for 700 KB a site, and why they are kept at all when the edit
   * never touches them.
   */
  contentModel: { type: mongoose.Schema.Types.Mixed, default: null },

  buildRecipe: { type: mongoose.Schema.Types.Mixed, default: null },

  /**
   * Whether the last capture got everything an edit needs.
   *
   * SAID OUT LOUD RATHER THAN INFERRED. `contentModel` can be present while
   * `buildRecipe` is not — a site published from a build made before
   * build.json existed, most obviously. The edit screen has to tell those
   * apart, because one of them can be edited and the other can only be
   * regenerated, and guessing from two nullable fields is how a screen ends
   * up offering a button that cannot work.
   */
  editable: { type: Boolean, default: false },

  /** When it last went out, and how much went. For the list, and for support. */
  publishedAt: { type: Date, default: null },
  publishCount: { type: Number, default: 0 },
  lastFileCount: { type: Number, default: 0 },

  /**
   * What the custom domain did on the first publish.
   *
   * TWO BOOLEANS, BECAUSE THEY FAIL SEPARATELY. deployBlog()'s own log
   * learned this the hard way: it reported `domainAttached: true` while the
   * browser said NXDOMAIN, and both were true — the domain was registered
   * on the project and the DNS record was never written. One field cannot
   * tell that story, and it is the story somebody asks about.
   *
   * NEITHER CAN FAIL A PUBLISH. The site is up on pages.dev regardless;
   * these say whether the hostname will answer yet.
   */
  /* SEARCH CONSOLE VERIFICATION — added 16 November.
   *
   * SAME FIELD NAME AS BlogSite, and the same type. The two products have
   * separate collections and separate screens, but a customer verifying a
   * website and a customer verifying a blog are doing one thing, and
   * utils/blog/verificationTags.js parses both. A second name for the same
   * value is how two screens drift into disagreeing about what is stored.
   *
   * TOKENS, NOT TAGS, despite the name it inherits. What is kept is what
   * the parser extracted; the <meta> element is built at publish time by
   * utils/cloudflareSites/verificationHead.js and never echoed. */
  verificationTags: { type: [String], default: () => [] },

  domainAttached: { type: Boolean, default: false },
  dnsCreated: { type: Boolean, default: false },

}, { timestamps: true });

module.exports = mongoose.models.CloudflareSite
  || mongoose.model('CloudflareSite', cloudflareSiteSchema);
