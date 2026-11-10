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
   */
  status: {
    type: String,
    enum: ['draft', 'live', 'removed'],
    default: 'draft',
    index: true,
  },

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
  domainAttached: { type: Boolean, default: false },
  dnsCreated: { type: Boolean, default: false },

}, { timestamps: true });

module.exports = mongoose.models.CloudflareSite
  || mongoose.model('CloudflareSite', cloudflareSiteSchema);
