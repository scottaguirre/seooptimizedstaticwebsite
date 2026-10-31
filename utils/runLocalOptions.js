// utils/runLocalOptions.js
//
// A queued job in Local Website Options mode -> eleven pages on disk.
//
// THE SIBLING OF runGeneration.js, NOT A BRANCH INSIDE IT.
//
// runGeneration is 1,200 lines that build a page at a time: it fetches People
// Also Ask questions, writes FAQ answers, builds a pricing table, decides
// which trust badges a business type may claim, injects interlinks, lays out
// location pages and copies Bootstrap. This mode does none of those things.
// Its eleven pages come out of utils/localOptions/render/ as one deterministic
// map of path -> contents, with its own stylesheet and its own schema.
//
// An `if (siteMode === 'localoptions')` at the top of that file would have
// skipped past every step in it — and every future edit to any of those steps
// would have had to ask whether this mode reaches it. Two files that share
// only a contract is the smaller thing to maintain.
//
// WHAT IT DOES SHARE, DELIBERATELY, BECAUSE A SECOND COPY WOULD DRIFT:
//   checkCredits / chargeCredits    one pricing authority, utils/pricing.js
//   getUserDirs / resetUserDirs     one build folder per user, wiped the same way
//   createBuildRecord               so /export-wp can see this build too
//   onProgress                      the same progress the job page already reads
//
// WHAT IT DOES NOT SHARE:
//   copyVendorAssets   this site ships its own CSS; Bootstrap would be 160KB
//                      of dead weight no page links to
//   writePageAssets    nothing here is a template with assets to fill in
//   contentModel       no content.json is written, and therefore
//   checkStructureParity  no parity check runs
//
// THAT LAST PAIR IS A REAL GAP AND IS NAMED RATHER THAN PAPERED OVER.
// content.json is how /export-wp turns a build into a WordPress theme, and
// checkSite() compares a build against it. Both describe the GENERATOR's
// structure — the section order, the page kinds, the template slots — and
// this mode shares none of it: eleven fixed pages, its own stylesheet, its
// own schema. A content.json written from here would either be a lie about
// what is on disk or a second schema for the exporter to learn.
//
// So a Local Website Options site cannot be exported to WordPress today.
// That is the right trade for now — the mode is built to be deployed as
// static files — and it is the thing to fix if anybody asks for the theme.
//
// NO RESUME, AND THAT IS A DECISION.
// runGeneration skips pages listed in job.completedPages, because a
// hundred-page build that died at page ninety must not be paid for twice.
// This build is seven model calls and about nineteen cents, measured; the
// bookkeeping to resume it would cost more to get right than it could ever
// save, and a half-written eleven-page site has no value to hand back. A
// restart starts over, and the job's completedPages are written anyway so
// the progress page reads the same as every other build.

'use strict';

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const {
  truthy,
  checkCredits,
  chargeCredits,
  resetUserDirs,
  moveOrCopyThenDelete,
} = require('./helpers');

const { nearbyPlaces } = require('./nearbyPlaces');

const { getUserDirs } = require('./buildAssets');
const { createBuildRecord } = require('./buildRegistry');
const { imageExtension } = require('./uploadExtension');
const { formatTime, ORDER, LONG } = require('./formatDaysAndHoursForDisplay');
const { normalizeDomain } = require('./normalizeDomain');
const { MODES, normalizeSiteMode, LOCAL_OPTIONS_SERVICE_PAGES, FIXED_PAGES } = require('./seoPresets');
const { generateLocalOptionsSite } = require('./localOptions/generate');
const { buildOptionsFor } = require('./localOptions/designs');
const { publishSite, repoNameFor } = require('./github/publishSite');
const { readSiteDir } = require('./github/readSite');

/* THE SEARCH CONSOLE PARSER, FROM THE BLOG SIDE RATHER THAN A SECOND COPY.
 *
 * It takes what Google puts on the clipboard — the whole <meta> element —
 * pulls the token out, and refuses anything that is not token-shaped. Its
 * header explains at length why that matters: the value ends up in an
 * attribute on a public page, so a string that closes the attribute is an
 * injection into the client's own visitors.
 *
 * ONE PARSER FOR BOTH PRODUCTS. A second copy is a second place for the
 * definition of "a verification token" to drift. */
const { parseVerificationTags } = require('./blog/verificationTags');
const { log } = require('./logger');

// dist/ lives at the project root, one level up from utils/ — the same
// constant runGeneration.js derives, for the same reason.
const baseDistDir = path.join(__dirname, '..', 'dist');
const tempUploadDir = path.join(__dirname, '..', 'public', 'uploads');

/**
 * The pages the progress bar counts: home + six services + the four fixed.
 *
 * READ FROM seoPresets RATHER THAN WRITTEN AS 11. pagesToBuild() already
 * computes exactly this for the Job record, and a second literal here would
 * be a progress bar that disagrees with its own total.
 */
const TOTAL_PAGES = 1 + LOCAL_OPTIONS_SERVICE_PAGES + FIXED_PAGES.length;

/**
 * The business hours, as the renderer wants them.
 *
 * [{ day: 'Monday', open: '7:00 AM – 6:00 PM' }], with `open` NULL for a
 * closed day — render/chrome.js prints "Closed" for null and an empty cell
 * for an empty string, and an empty cell reads as "we forgot".
 *
 * formatTime() IS IMPORTED, NOT REIMPLEMENTED. It is the single place this
 * app turns the browser's "18:00" into "6:00 PM", it is loaded by the form
 * as well so the preview and the page agree, and a second 12-hour clock in
 * this file is how they stop agreeing.
 *
 * TWO THINGS THIS DOES NOT YET HANDLE, both recorded rather than guessed:
 *   - An OVERNIGHT day ("5:00 PM – 1:00 AM") renders correctly but
 *     render/schema.js's parseHours() reads it as a backwards range and
 *     returns null, so that day is absent from openingHours. The page is
 *     right; the schema is short one day.
 *   - "Open 24 hours" is a phrase, not a range, so parseHours() returns null
 *     for every day and openingHours is omitted entirely. The correct schema
 *     for this is openingHoursSpecification, which render/schema.js does not
 *     emit.
 */
function hoursFrom(global = {}) {
  if (truthy(global.is24Hours)) {
    return ORDER.map(day => ({ day: LONG[day], open: 'Open 24 hours' }));
  }

  const hours = global.hours || {};

  return ORDER.map(key => {
    const day = hours[key] || {};

    if (truthy(day.closed)) return { day: LONG[key], open: null };

    const open = formatTime(day.open);
    const close = formatTime(day.close);

    /* A DAY WITH A BLANK OR UNPARSEABLE TIME IS CLOSED, NOT BLANK. The route
     * validates the hours before a job is queued, so reaching this means
     * something unexpected got through — and "Closed" is the answer that
     * cannot mislead a customer into driving over. */
    if (!open || !close) return { day: LONG[key], open: null };

    return { day: LONG[key], open: `${open} – ${close}` };
  });
}

/**
 * How many towns the service area names, counting the business's own.
 *
 * FOUR, BECAUSE THAT IS WHAT THE PROSE WAS MEASURED ON. Both runs of the
 * writing — 28 October, twelve pages — used four, and the openings that came
 * back name them in a sentence: "Across Leander, Cedar Park, Liberty Hill,
 * and north Austin". Eight would read as a list; one would read as a
 * business with no reach.
 */
const AREA_TOWNS = 4;

/**
 * The towns named in the footer, in the prose and in areaServed.
 *
 * FROM A GAZETTEER, NOT FROM THE CUSTOMER AND NOT FROM A MODEL.
 *
 * There is no locations step in this mode — Edwin, 28 October: "also no
 * location pages option" — so nothing is typed. utils/nearbyPlaces.js reads
 * the GeoNames cities1000 export and does trigonometry: no tokens, no
 * network, no rate limit, and the same four towns every time for the same
 * address, which is also what keeps a rebuild byte-identical.
 *
 * ASKING A MODEL WAS NEVER AN OPTION, and that file's header is the argument
 * rather than my opinion: a model asked for the towns near Leander answers
 * confidently and wrongly, and the errors are the plausible kind nobody
 * checks. Edwin's own screenshot of a Dallas page on a Round Rock site —
 * 190 miles — is why that function exists at all.
 *
 * THE OWN TOWN GOES FIRST, and nearbyPlaces() excludes it from `places`
 * already, so there is no duplicate to filter.
 *
 * THE TOWN NAME ONLY, not "Cedar Park, TX": the footer would otherwise
 * repeat the state four times in one sentence, and the state is already on
 * the page in the address.
 *
 * An address the gazetteer cannot place returns no towns, and this falls
 * back to the city alone. An empty areaServed is worse than a one-town one —
 * the footer sentence reads as an unfinished template.
 */
function areasFrom(business = {}) {
  const city = String(business.city || '').trim();
  const state = String(business.state || '').trim();

  if (!city) return [];

  const { places } = nearbyPlaces(`${city}, ${state}`, { limit: AREA_TOWNS - 1 });

  return [city, ...places.map(place => place.name)];
}

/**
 * The six social URLs, as render/chrome.js wants them.
 *
 * THE FORM COLLECTS THEM AND THE SITE WAS DROPPING THEM. The footer reads
 * `business.social` and nothing was passing it, so a customer who filled in
 * all six got a footer with none — no error, no empty link, just six icons
 * that never appeared.
 *
 * TWO THINGS ARE TRANSLATED HERE, AND BOTH BELONG IN AN ADAPTER rather than
 * in the renderer:
 *
 *   the KEY      the form posts `facebookUrl`; chrome.js keys on `facebook`,
 *                because a renderer should not have to know what the form
 *                calls its boxes
 *   the VALUE    '#', 'n/a' and a bare domain are all things customers type.
 *                The same rule as usableUrl() in utils/buildSocialLinks.js,
 *                which is where the generator's own templates handle it: a
 *                placeholder is NOT a link, and a bare "facebook.com/acme"
 *                without a scheme resolves relative to the page.
 *
 * Duplicated rather than imported, deliberately: buildSocialLinks exports
 * rendered HTML for a different markup, not this rule, and exporting one
 * four-line helper from it to be used here would be the smaller half of a
 * refactor nobody asked for. It is four lines and this comment names its
 * twin.
 */
const SOCIAL_FIELDS = [
  'facebookUrl', 'instagramUrl', 'youtubeUrl',
  'twitterUrl', 'pinterestUrl', 'linkedinUrl',
];

function socialFrom(global = {}) {
  const social = {};

  for (const field of SOCIAL_FIELDS) {
    const raw = String(global[field] || '').trim();

    if (!raw || raw === '#' || raw.toLowerCase() === 'n/a') continue;

    const key = field.replace(/Url$/, '');
    social[key] = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  }

  return social;
}

/**
 * Where the words are kept so a template fix is free.
 *
 * NOT content.json, AND THAT IS DELIBERATE. utils/contentModel.js owns that
 * filename: it is the WordPress exporter's format, read by the theme builder
 * and by checkStructureParity(). Writing a different shape to the same path
 * would be exactly what the note at the top of this file warns against — a
 * file that lies about what it describes, or a second schema for the
 * exporter to learn. A different name costs nothing and collides with
 * nothing.
 */
const SOURCE_PATH = '_src/localoptions.json';

/**
 * The model's output, stored so the site can be rebuilt without it.
 *
 * WHY THIS EXISTS. The six service pages and the home page are seven model
 * calls, about three minutes and 800 credits. Once renderSite() had turned
 * them into HTML, the only copy of those words was the HTML itself — so
 * changing a template, fixing a link or adding a section meant paying for
 * the prose a second time. The relative-paths fix on 28 October cost exactly
 * that: a full rebuild to change an href.
 *
 * IT IS renderSite()'s ARGUMENT OBJECT, EXACTLY. Not a summary of it, not a
 * subset chosen by hand — the same object, so re-rendering is
 * `renderSite(JSON.parse(file))` and nothing can be quietly missing. A field
 * added to renderSite and forgotten here would be a re-render that silently
 * differs from the build; test-local-options-render.js asserts the round
 * trip is byte-identical, which is the only check that catches that.
 *
 * `now` IS STORED, so the re-render reproduces the same footer year and the
 * same sitemap lastmod. renderSite takes it as an argument precisely so a
 * build is reproducible, and a stored input that left it out would not be.
 */
function sourceOf(source) {
  return JSON.stringify({
    mode: 'localoptions',

    /* A VERSION, because this file is read by code written later than it.
     * Bumped when the shape changes, so a re-render of an old build can say
     * so instead of half-working. */
    version: 1,

    ...source,
    now: source.now instanceof Date ? source.now.toISOString() : source.now,
  }, null, 2);
}

/**
 * Write the rendered map to disk.
 *
 * Buffers and strings through the same call, because the hero images and the
 * pages arrive in one map from generateLocalOptionsSite() — fsp.writeFile
 * takes either.
 */
async function writeFiles(distDir, files) {
  const paths = Object.keys(files).sort();

  for (const rel of paths) {
    const full = path.join(distDir, rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, files[rel]);
  }

  return paths.length;
}

/** The uploaded logo among the job's files, or undefined. */
function logoUpload(files) {
  return (files || []).find(file => /global\[logo\]/.test(file.fieldname || ''));
}

/**
 * What the header's <img src> will say, before the file is anywhere.
 *
 * SPLIT FROM THE COPY, because the two are now needed at different moments:
 * the renderer wants the path during generation, and the bytes must not land
 * in the build folder until resetUserDirs() has wiped it — otherwise the
 * wipe deletes the logo that was just put there.
 *
 * '' IS A WORKING OUTCOME, not a failure. render/chrome.js's header() falls
 * back to initials() when there is no logo, which is why neither of these
 * throws.
 *
 * imageExtension(), NOT path.extname(). A logo pasted from the clipboard or
 * picked on a phone can arrive with no extension in its name at all, and
 * `assets/logo` is an <img> that silently does not load. That one is written
 * up at length in runGeneration.js.
 */
function logoPathFor(files) {
  const logo = logoUpload(files);
  return logo ? `assets/logo${imageExtension(logo)}` : '';
}

/**
 * Put the uploaded logo where logoPathFor() said it would be.
 *
 * CALLED AFTER resetUserDirs(), and the name is derived the same way rather
 * than passed in — two call sites deriving one filename is how the <img src>
 * and the file on disk come to disagree.
 *
 * NO FAVICON, UNLIKE runGeneration. That file generates a 42x42 PNG from the
 * logo with sharp, and it is right to. This mode's render/chrome.js
 * document() emits no <link rel="icon"> at all, so a favicon would be a file
 * nothing references. One change, in one place, when that link is added.
 */
async function placeLogo(files, assetsDir) {
  const logo = logoUpload(files);
  if (!logo) return '';

  const rel = logoPathFor(files);

  await fsp.mkdir(assetsDir, { recursive: true });
  await moveOrCopyThenDelete(logo.path, path.join(assetsDir, path.basename(rel)));

  return rel;
}

/**
 * Build one Local Website Options site.
 *
 * The same contract as runGeneration(ctx): takes the job's payload, user and
 * files, reports progress, and returns what the runner writes onto the Job.
 *
 * @param {object}   ctx
 * @param {object}   ctx.body        the wizard payload
 * @param {Array}    ctx.files       uploads
 * @param {object}   ctx.user        the User document
 * @param {string}   [ctx.requestId]
 * @param {Function} [ctx.onProgress]
 * @param {Function} [ctx.generate]  injected generateLocalOptionsSite, for the suite
 * @param {string}   [ctx.baseDir]   injected dist/ root, for the suite
 * @param {Date}     [ctx.now]
 * @returns {Promise<{creditsCharged, creditsRemaining, buildId, distDir}>}
 */
/**
 * Where a site is going to live, and what it will therefore call itself.
 *
 * TWO WAYS IN, AND THE OLD ONE IS NOT DEAD YET.
 *
 *   a domain PICKED from the pool   -> acme.com/quality-plumbing/, published
 *                                      to the GitHub account that domain
 *                                      belongs to
 *   a domain TYPED into the form    -> https://whatever-they-typed, and
 *                                      nothing is published
 *
 * The typed path is what every build before 29 October did, and it stays
 * because jobs queued against the old form are still in the queue and
 * because a customer without a GitHub account must still be able to build a
 * site and download it.
 *
 * THE CHOICE IS VALIDATED AGAINST THE POOL, NEVER TRUSTED. It arrives from a
 * <select>, so in a browser it is always one of the options — which is
 * exactly why it has to be checked. A POST is a POST. An unknown id would
 * otherwise publish a customer's site to whatever installation the string
 * happened to name.
 *
 * @returns {Promise<{url, installationId, repo, domain}>}
 */
async function sitePlace({ global = {}, business = {}, ctx = {} }) {
  const chosen = String(global.domainId || '').trim();

  if (!chosen) {
    /* `https://domain`, NO TRAILING SLASH. normalizeDomain() is the app's
     * own rule for what somebody typed — "example.com", "www.example.com/"
     * or a full URL all arrive here as one thing. */
    return {
      url: `https://${normalizeDomain(global.domain || '')}`,
      installationId: '',
      repo: '',
      domain: '',
      domainId: '',
    };
  }

  const Domain = ctx.Domain || require('../models/Domain');

  const row = await Domain.findOne({ _id: chosen, target: 'github', enabled: true })
    .select('domain githubInstallationId')
    .lean();

  if (!row) {
    throw new Error(
      'That domain is not one this account can publish to. It may have been '
      + 'turned off since the form was opened.');
  }

  /* THE SAME NAME THE PUBLISH WILL USE. Imported from the publisher rather
   * than reimplemented, because two copies of a slug rule is how the folder
   * on GitHub and the path in the canonical come to differ by a hyphen. */
  const repo = repoNameFor(business.name);

  return {
    url: `https://${row.domain}/${repo}`,
    installationId: String(row.githubInstallationId || ''),
    repo,
    domain: row.domain,

    /* THE ROW ITSELF, for the ownership record. It keeps a reference
     * rather than the domain's spelling, because the row is what carries
     * the GitHub installation an editor will need to re-publish. */
    domainId: row._id,
  };
}

async function runLocalOptions(ctx) {
  const report = ctx.onProgress || (async () => {});
  const generate = ctx.generate || generateLocalOptionsSite;

  /* INJECTABLE FOR THE SAME REASON generate IS. The real one makes five or
   * six calls to github.com and creates a repository; a suite that could not
   * replace it would either need credentials or would quietly make repos on
   * somebody's account every time it ran. */
  const publish = ctx.publish || publishSite;

  /* INJECTABLE, FOR THE SAME REASON generate.js TAKES `imagesRoot`.
   *
   * resetUserDirs() wipes dist/user_<id> before anything is written. A suite
   * that could not point this somewhere else would either wipe a real user's
   * folder or leave its own behind in the project's dist/ — and a test that
   * deletes build output is a test nobody runs twice. */
  const distRoot = ctx.baseDir || baseDistDir;

  const global = ctx.body.global || {};
  const pages = ctx.body.pages || {};

  const siteMode = normalizeSiteMode(global.siteMode);

  /* REFUSED RATHER THAN BUILT ANYWAY. Nothing routes a job here except
   * jobGenerator's check on the same value, so this means the two disagree —
   * and building an eleven-page site for a customer who paid for a hundred
   * is the kind of wrong that is hard to undo. */
  if (siteMode !== MODES.LOCAL_OPTIONS) {
    throw new Error(`runLocalOptions: siteMode is '${siteMode}', not '${MODES.LOCAL_OPTIONS}'`);
  }

  const userId = ctx.user._id.toString();
  const { distDir, assetsDir, cssDir, jsDir, entryDir } = getUserDirs(distRoot, userId);

  /* THE SERVICE NAMES, OR null TO LET THE MODEL NAME THEM.
   *
   * There is no service-pages step in this wizard — Edwin, 28 October: "the
   * service pages option should not be there as the model will suggest" — so
   * `pages` normally arrives empty and generateLocalOptionsSite() calls
   * utils/suggestServices.js for six.
   *
   * READ ANYWAY, RATHER THAN IGNORED. A job queued before the step was
   * removed still carries its six rows, and so does one built by a caller
   * that supplies them; honouring what is there costs one cheap model call
   * less and means an old queued job finishes as its owner expected. The
   * `filename` field is where the wizard posts a service NAME — slugify()
   * turns it into a directory later, inside generate.js, which is the one
   * place that decides a slug.
   *
   * null, NOT AN EMPTY ARRAY. generate.js tests `if (!names)`, and `[]` is
   * truthy — it would skip the suggester and then throw "expected 6
   * services, got 0", which is a true statement about the wrong thing.
   *
   * THE COUNT IS NOT CHECKED HERE ANY MORE. It was, before the step went,
   * and the reason was to fail before resetUserDirs() wiped the previous
   * site. That reason is gone with the step: there is nothing for a customer
   * to get wrong, and the only remaining way to reach a count other than six
   * is for the suggester to return short — which generate.js catches, and
   * which happens before this function touches the filesystem anyway,
   * because the suggester runs inside the generate call below. */
  const submitted = Object.values(pages)
    .map(page => String((page && page.filename) || '').trim())
    .filter(Boolean);

  const serviceNames = submitted.length ? submitted : null;

  /* Re-checked here rather than trusted from enqueue time: the balance may
   * have changed while the job sat in the queue. quote() returns a flat
   * price for this mode, so the location count is not passed — passing one
   * would imply it is read. */
  const credit = checkCredits(ctx.user, pages, { siteMode });

  if (!credit.ok) {
    throw new Error(
      `Not enough credits: this build needs ${credit.totalCost}, you have ${credit.available}.`
    );
  }

  const startedAt = Date.now();

  await report({ stage: 'Preparing your website', current: '', total: TOTAL_PAGES, done: 0 });

  /* THE LOGO'S NAME NOW, THE LOGO'S BYTES LATER — see the ordering note
   * above resetUserDirs() below. The renderer needs the path to put in an
   * <img src>; it does not need the file to exist yet. */
  const logo = logoPathFor(ctx.files);

  const business = {
    name: String(global.businessName || '').trim(),
    trade: String(global.businessType || '').trim(),

    /* THE FOUR BOXES, AS THE OWNER TYPED THEM. The route composed
     * global.address and global.location out of these for the rest of the
     * pipeline; the renderer wants the parts, and takes them from here
     * rather than splitting the composed string back apart. */
    street: String(global.street || '').trim(),
    city: String(global.city || '').trim(),
    state: String(global.state || '').trim().toUpperCase(),
    zip: String(global.zip || '').trim(),

    phone: String(global.phone || '').trim(),
    email: String(global.email || '').trim(),

    /* The footer's icons. render/chrome.js renders only the keys it has a
     * path for, so an unknown platform is skipped rather than drawn empty. */
    social: socialFrom(global),
  };

  /* WHERE THIS SITE WILL LIVE, DECIDED BEFORE A WORD IS WRITTEN.
   *
   * IT IS NOT JUST A DOMAIN ANY MORE — 29 October. The customer used to
   * type one and the site sat at its root. They now pick one from a list,
   * and one GitHub account serves ONE domain with MANY sites under it:
   * acme.com/quality-plumbing/, acme.com/roof-pros/. Edwin: "only one can
   * serve from the root and then other website will use a subdirectory."
   *
   *     THE SITE'S ADDRESS NOW HAS A PATH IN IT, AND EVERY CANONICAL,
   *     THE SITEMAP AND THE SCHEMA @id ARE BUILT BY APPENDING TO IT.
   *
   * So the repository name has to be known HERE, before generate() runs,
   * rather than inside the publish at the end — the pages carry the address
   * and the pages are written first. Getting this wrong does not fail: it
   * produces eleven pages each claiming to live at an address that serves
   * somebody else's site, which is the fault that made two migrated domains
   * invisible in October.
   *
   * ONE FUNCTION NAMES THE REPOSITORY, used here and by the publish, so the
   * path in the canonical and the folder on GitHub cannot disagree.
   */
  const place = await sitePlace({ global, business, ctx });

  const url = place.url;

  let done = 0;

  /* NOTHING ON DISK HAS BEEN TOUCHED YET, AND THAT IS THE ORDERING THIS
   * FUNCTION IS BUILT AROUND.
   *
   * resetUserDirs() wipes dist/user_<id> — the site the customer currently
   * has — and this mode cannot be resumed to get it back. So the wipe waits
   * until all nineteen files are in hand, below.
   *
   * IT USED TO RUN HERE, BEFORE THE MODEL CALLS, and that was defensible
   * only while the six service names came off the form: the count was
   * checked first, so the one thing that could fail late was a model error.
   * With the names coming from utils/suggestServices.js the suggester itself
   * can come back short, 170 seconds of writing can time out, and a hero
   * folder can be missing — every one of those after the old site was
   * already gone.
   *
   * A FAILURE ANYWHERE IN THE NEXT THREE MINUTES NOW LEAVES THEIR SITE
   * STANDING. It costs one thing, named so nobody has to rediscover it: the
   * build writes into a folder that still holds the previous site, so
   * resetUserDirs() happens between generating and writing rather than
   * before both. */
  const built = await generate({
    business,
    url,
    serviceNames,
    areas: areasFrom(business),
    hours: hoursFrom(global),
    logo,

    /* THE DESIGN IS ONE CHOICE AND IT RESOLVES TO THREE THINGS — 30 October.
     *
     * Design 1 is Ledger with photo set 1; Design 2 is Beacon with set 2.
     * The layout, the stylesheet, the class prefix, the ids and the voice
     * the model writes in all come with it, because a customer choosing
     * between two sites is choosing between two things that look different
     * rather than between four independent switches.
     *
     * RESOLVED IN designs.js, IN ONE CALL. Reading the structure here and
     * the photo set somewhere else is how a Beacon site ends up with
     * Ledger's photographs: nothing fails, and the only sign is that the
     * second site looks like the first.
     *
     * NOTHING CHOSEN MEANS LEDGER AND AN AUTOMATIC PHOTO SET — the pick
     * hashes the business name, so one business rebuilt keeps its pictures.
     * That cannot promise two DIFFERENT businesses differ, which is exactly
     * why the dropdown exists. */
    ...buildOptionsFor(global.design),

    /* EACH SITE IS ITS OWN SEARCH CONSOLE PROPERTY, owned by the business it
     * belongs to. A site at acme.com/quality-plumbing/ is a URL-prefix
     * property that client verifies themselves; a DNS record would verify
     * the whole domain, which holds other people's sites. */
    verification: parseVerificationTags(global.searchConsole || ''),
    now: ctx.now || new Date(),
    requestId: ctx.requestId,

    /* SEVEN OF THE ELEVEN PAGES ARE WRITTEN BY THE MODEL, one call each,
     * about 170 seconds together. The other four — contact and the three
     * legal pages — are templated and appear instantly at the end, which is
     * why the bar jumps from 7 to 11 rather than crawling. */
    async onPage({ kind, name }) {
      done += 1;
      await report({
        done,
        total: TOTAL_PAGES,
        current: name,
        stage: kind === 'home' ? 'Writing the home page' : 'Writing your service pages',
        completedPage: name,
      });
    },
  });

  await report({
    done: TOTAL_PAGES - FIXED_PAGES.length,
    total: TOTAL_PAGES,
    stage: 'Building your pages',
    current: '',
  });

  /* THE WIPE, AND THE LAST MOMENT IT CAN HAPPEN. Everything that could fail
   * has succeeded; what follows is writing bytes. */
  resetUserDirs({ distDir, assetsDir, cssDir, jsDir, entryDir, tempUploadDir });

  await placeLogo(ctx.files, assetsDir);

  /* THE WORDS, BESIDE THE PAGES THEY BECAME.
   *
   * Written with the build rather than before it, so a failed generation
   * leaves no source file describing a site that does not exist. If
   * built.source is missing — an injected generator in a suite, an older
   * caller — the build still succeeds and simply cannot be re-rendered;
   * failing a paid build over a convenience file would be the wrong trade. */
  const files = built.source
    ? { ...built.files, [SOURCE_PATH]: sourceOf(built.source) }
    : built.files;

  const written = await writeFiles(distDir, files);

  /* CHARGED ONLY NOW THAT THE BUILD HAS SUCCEEDED — the same ordering
   * runGeneration uses, and the reason is the same: a customer must not pay
   * for a site that failed to render. */
  const remaining = await chargeCredits(ctx.user, credit.totalCost);

  /* AND THEN IT GOES ON THE INTERNET, IN THIS JOB — Edwin, 29 October:
   *
   *     "is there any way that the sites generated with the mode local
   *     website options get pushed automatically without pressing any
   *     button. That way if the user click generate site he can go away to
   *     do something else and know that his site will be pushed
   *     automatically."
   *
   * So there is no Publish button for this mode and no site sitting in a
   * folder waiting for somebody to remember it. The build publishes.
   *
   * AFTER chargeCredits, DELIBERATELY, AND EDWIN CHOSE THIS. The writing is
   * what costs money — seven model calls, about three minutes — and it has
   * already happened and already succeeded. A push that fails can be retried
   * for nothing, so refusing to charge for completed writing because GitHub
   * was briefly unreachable would be the wrong trade in the customer's
   * favour exactly once and against them every other time.
   *
   * IT DOES NOT THROW. publishSite() refuses before touching anything when
   * there is no installation or the grant is too narrow, and anything else
   * that goes wrong is caught here — because by this point the pages exist,
   * they are on disk, and they are paid for. A build that reported FAILED
   * over a Pages switch would be describing a site the customer could see.
   *
   *     THE JOB SAYS WHAT HAPPENED. IT DOES NOT PRETEND EITHER WAY.
   *
   * The result travels back in `published` so the screen can say "live at
   * …" or "built, but not published — here is why", which is the lesson
   * from the Cloudflare blogs the same evening: a message shown once on a
   * page the customer then leaves is not a state. */
  let published = null;

  /* THE DOMAIN DECIDES WHERE IT GOES, AND THE ACCOUNT IS THE FALLBACK.
   *
   * A picked domain carries its own GitHub installation — they are one
   * choice, not two, because the domain is served by that account's root
   * repository. User.githubInstallationId is what the first version used
   * and is kept for the case where somebody is testing without the pool. */
  const installationId = place.installationId
    || String(ctx.user.githubInstallationId || '').trim();

  if (installationId) {
    await report({
      done: TOTAL_PAGES,
      total: TOTAL_PAGES,
      stage: 'Publishing to GitHub',
      current: business.name || '',
    });

    try {
      published = await publish({
        installationId,
        businessName: business.name,

        /* READ OFF DISK, NOT THE MAP THAT WAS JUST WRITTEN.
         *
         * THE MAP IS NOT THE SITE. placeLogo() copies the customer's logo
         * straight into assetsDir without it ever passing through `files`,
         * so publishing the map sent eleven pages and an <img> pointing at
         * a logo that was never uploaded — found on the first site this job
         * published on its own.
         *
         * The folder is what the customer downloads and what the re-render
         * tool reads. Publishing the same bytes means the three cannot
         * disagree about what the site contains. */
        files: readSiteDir(distDir),
        message: `Publish ${business.name || 'site'}`,
        now: ctx.now || new Date(),
      });

      /* THE ROW THAT SAYS WHOSE SITE THIS IS — 29 October.
       *
       * Written only when the push succeeded, because a row claiming a site
       * that is not on the internet would put a line in somebody's list
       * pointing at a 404. The editor loads a site's words FROM its
       * repository, so a row without a repository behind it is a dead end.
       *
       * UPSERT ON THE PAIR THAT IDENTIFIES A SITE, which is the account and
       * the repository. Building the same business again updates one site —
       * the publisher pushes to the same repository — so this has to follow
       * it rather than leave a second row nothing would ever show.
       *
       * IT DOES NOT FAIL THE BUILD. The site is written, paid for and
       * live by this point; losing the pointer is a thing to fix, not a
       * reason to tell a customer their build failed. */
      try {
        const GeneratedSite = ctx.GeneratedSite || require('../models/GeneratedSite');

        await GeneratedSite.updateOne(
          { owner: published.owner, repo: published.repo },
          {
            $set: {
              user: ctx.user._id,
              domain: place.domainId || undefined,
              domainName: place.domain || '',
              owner: published.owner,
              repo: published.repo,
              businessName: business.name || '',
              trade: business.trade || '',
              publishedAt: new Date(),
              commitSha: published.commitSha || '',
            },
          },
          { upsert: true }
        );
      } catch (err) {
        log.error('localOptions.siteRecordFailed', err, {
          requestId: ctx.requestId,
          userId,
          repo: published.repo,
        });
      }

      log.generation('localOptions.published', {
        requestId: ctx.requestId,
        userId,
        repo: `${published.owner}/${published.repo}`,
        created: published.created,
        commit: published.commitSha,
        unchanged: published.unchanged,
        uploaded: published.uploaded,
        reused: published.reused,
        pagesOk: published.pages.ok,
        url: published.pagesUrl,
      });

    } catch (err) {
      published = { ok: false, error: err.message };

      log.error('localOptions.publishFailed', err, {
        requestId: ctx.requestId,
        userId,
        business: business.name,
      });
    }
  } else {
    /* NOT AN ERROR, AND NOT SILENT EITHER. Every account that existed before
     * this shipped has no installation, and their builds must keep working.
     * The line is here so that "why is my site not online" has an answer in
     * the log rather than an absence. */
    log.info('localOptions.notPublished', {
      requestId: ctx.requestId,
      userId,
      reason: 'no GitHub installation on this account',
    });
  }

  await report({
    done: TOTAL_PAGES,
    total: TOTAL_PAGES,
    stage: 'completed',
    current: '',
  });

  log.generation('generation.completed', {
    requestId: ctx.requestId,
    userId,
    siteMode,
    durationMs: Date.now() - startedAt,
    /* WHAT WAS BUILT, NOT WHAT WAS ASKED FOR. `serviceNames` is null when
     * the model named them, and `null.length` threw right here — inside the
     * log line of a build that had just succeeded. built.services is the
     * six pages that exist. */
    servicePages: built.services.length,
    locationPages: 0,
    filesWritten: written,
    heroesMissing: built.heroes.missing.length,
    modelCalls: built.usage.calls,
    outputTokens: built.usage.outputTokens,
    creditsCharged: credit.totalCost,
    creditsRemaining: remaining,
  });

  /* A TRADE WITH NO PHOTOGRAPHS BUILDS ANYWAY, and says so here rather than
   * failing. heroFiles() warns and skips; the pages still render, with four
   * <img> tags pointing at files that are not there. Visible, logged, and
   * not a reason to throw away eleven written pages. */
  if (built.heroes.missing.length) {
    /* log.info, NOT log.warn. utils/logger.js exposes error, security,
     * generation, external, info and debug — there is no warn on it, and
     * calling one would throw inside a build that had just succeeded. */
    log.info('localOptions.heroesMissing', {
      requestId: ctx.requestId,
      trade: business.trade,
      missing: built.heroes.missing,
    });
  }

  const buildId = createBuildRecord(distDir, {
    businessName: business.name || 'Site',
    location: global.location || '',
  });

  return {
    creditsCharged: credit.totalCost,
    creditsRemaining: remaining,
    buildId,
    distDir,

    /* null when the account has no GitHub installation, an object with
     * `error` when the push failed, and the full result when it worked. The
     * three are deliberately distinguishable: "not set up", "tried and
     * failed" and "live" are three different things to tell a customer. */
    published,
  };
}

module.exports = {
  runLocalOptions,
  hoursFrom,
  areasFrom,
  socialFrom,
  sourceOf,
  SOURCE_PATH,
  SOCIAL_FIELDS,
  AREA_TOWNS,
  logoPathFor,
  writeFiles,
  placeLogo,
  TOTAL_PAGES,
};
