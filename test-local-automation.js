// test-local-automation.js
//
// Cloudflare Local Automation — the eleven-page build, published to
// Cloudflare instead of GitHub.
//
// WHY IT IS ITS OWN SUITE. The feature is not in any one file: it is a door
// in formRoute.js, a conditional in runLocalOptions.js, an order of checks in
// jobGenerator.js, a row in appHeader.js and a relaxed guard in the browser.
// Each of those files has a suite that covers what IT does, and none of them
// can see that the five pieces agree.
//
//     THE BUG THIS EXISTS FOR IS NOT IN A FILE. IT IS BETWEEN FIVE OF THEM,
//     AND EVERY ONE OF THEM PASSES ITS OWN TESTS WHILE IT IS BROKEN.
//
// WHAT THE PRODUCT IS, IN ONE LINE PER HALF
//
//   /github-sites        eleven pages -> GitHub Pages, Designs 1-3
//   /local-automation    eleven pages -> Cloudflare,   Designs 4-8
//
// Same builder, same eleven pages, same voice machinery. A different
// destination, and five layouts that belong to it alone.
//
// THE TWO FAILURES THAT MADE IT IMPOSSIBLE UNTIL 17 NOVEMBER
//
//   the fallback  runLocalOptions took the GitHub installation off the
//                 ACCOUNT when the domain pool had not supplied one. An
//                 account that ever installed the app has that id forever,
//                 so a site addressed to Cloudflare was pushed to GitHub
//                 because of a choice made weeks earlier about something
//                 else.
//   the order     jobGenerator returned on the builder's `published` report
//                 before it read the destination. runLocalOptions always
//                 reports that — `null` when it published nothing — so the
//                 Cloudflare step below it was unreachable. Eleven pages
//                 built, paid for, left on disk, job says `completed`.
//
// Neither threw. Neither failed a test. Both are asserted below.
//
//   node test-local-automation.js

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  designsFor, designsKeyFor, buildOptionsFor, designFor, CF_MODE,
} = require('./utils/localOptions/designs');
const { siteTargetOf, wantedAddress } = require('./utils/cloudflareSites/wanted');
const { appSidebar } = require('./utils/appHeader');
const { NAV_CF_LOCAL, NAV_GH_SITES } = require('./utils/pageTitle');

let passed = 0, failed = 0;
const deferred = [];

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

/* ASYNC TESTS ARE QUEUED AND AWAITED, NOT FIRED AND FORGOTTEN.
 *
 * test-build-progress.js shipped a synchronous runner with two async tests in
 * it on 16 November. Both passed unconditionally — including the one written
 * to catch a bug that was live at the time.
 *
 *     A RUNNER THAT DOES NOT AWAIT TURNS EVERY ASYNC TEST INTO A TEST THAT
 *     CANNOT FAIL. */
function asyncTest(name, fn) {
  deferred.push(async () => {
    try { await fn(); console.log(`  ok    ${name}`); passed++; }
    catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
  });
}

function section(n) { console.log(`\n${n}\n`); }

const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');

/** Source with its comments stripped, so a mutant cannot match an explanation. */
function codeOnly(src) {
  return String(src).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/* ======================================================================= */

section('THE PAIR — TWO DOORS, ONE BUILDER, TWO DESTINATIONS');

test('THE DOOR SETS A MODE AND A DESTINATION, WHICH NO OTHER ROUTE DOES', () => {
  /* The distinction the whole feature rests on, and it was written into
   * renderWizard() before anything used it:
   *
   *   `mode`   decides WHAT gets built
   *   `target` decides WHERE the finished build goes
   *
   * /github-sites locks a mode. /cloudflare-sites/new locks a destination.
   * This is the first route that locks both, and that is the entire
   * difference between it and a new product. */
  const src = codeOnly(read('routes/formRoute.js'));

  const route = /router\.get\('\/local-automation', renderWizard\(\{[\s\S]*?\}\)\);/.exec(src);

  assert.ok(route, 'there is no /local-automation route');

  assert.match(route[0], /mode: 'localoptions'/, 'the door does not lock the builder');
  assert.match(route[0], /target: 'cloudflare'/, 'the door does not lock the destination');
  assert.match(route[0], /row: '\/local-automation'/, 'the door lights another row');

  /* AND IT DOES NOT NAME A DESIGN LIST, which it did for an hour and which
   * is what let the two ends disagree. The layouts follow from the pair;
   * see designsKeyFor(). */
  assert.ok(!/designs:/.test(route[0]),
    'the door names a design list by hand again');
});

test('DESIGN 4 BUILDS QUARRY, WHICH IT DID NOT FOR THE FIRST HOUR', () => {
  /* ⚠ THIS SHIPPED, AND EDWIN FOUND IT BY LOOKING AT THE SITE: *"but this
   * is a copy of design 1. i thoght design 4 was different"*.
   *
   * The route offered Design 4 because it asked designsFor(CF_MODE). The
   * build resolved it with buildOptionsFor(design, siteMode) — and that
   * door's siteMode is `localoptions`, where that row does not live. The
   * mode guard refused it, buildOptionsFor returned the default, and
   * structureFor() fell back to Ledger.
   *
   *     ONE DECISION ASKED WITH TWO DIFFERENT KEYS. Every piece behaved
   *     exactly as written — the guard refused, the fallback fell back,
   *     nothing threw — and the customer got Design 1.
   *
   * THE END-TO-END ASSERTION, deliberately: mode and destination in, a
   * structure out. The pieces each have their own test below and all of
   * them passed while this was broken. */
  const key = designsKeyFor({ siteMode: 'localoptions', siteTarget: 'cloudflare' });

  assert.deepStrictEqual(buildOptionsFor('4', key), {
    design: '4', structure: 'quarry', imageSet: 'set-4',
  }, 'Design 4 does not build Quarry');

  assert.notStrictEqual(buildOptionsFor('4', key).structure,
    buildOptionsFor('1', 'localoptions').structure,
    'Design 4 builds the same structure as Design 1');

  /* AND EVERY LAYOUT THIS DOOR OFFERS RESOLVES, not just the first one.
   * Harbor, Atlas, Orchard and Forge arrive in this list and would each
   * have had the same silent fall-back. */
  for (const d of designsFor(CF_MODE)) {
    assert.strictEqual(buildOptionsFor(d.id, key).structure, d.structure,
      `${d.label} is offered on this door and does not build ${d.structure}`);
  }
});

test('AND BOTH ENDS DERIVE THAT KEY FROM ONE FUNCTION', () => {
  /* A second copy of the rule is how the two came apart in the first place:
   * the route named CF_MODE by hand and the build went on using siteMode.
   * Neither was wrong on its own. */
  const route = codeOnly(read('routes/formRoute.js'));
  const build = codeOnly(read('utils/runLocalOptions.js'));

  assert.match(route, /const designsKey = designsKeyFor\(\{ siteMode: mode, siteTarget: target \}\)/,
    'the wizard decides its own list again');

  assert.match(build, /const designsKey = designsKeyFor\(\{ siteMode, siteTarget \}\)/,
    'the build decides its own list again');

  assert.ok(!/buildOptionsFor\(global\.design, siteMode\)/.test(build),
    'the build still resolves a design against the siteMode');

  assert.ok(!/designs: CF_MODE/.test(route),
    'the route still names a design list by hand');
});

test('and the three older doors are unmoved by it', () => {
  /* designsKeyFor returns the mode unchanged for everything that is not the
   * new pairing, so none of them can have noticed. */
  assert.strictEqual(designsKeyFor({ siteMode: 'localoptions' }), 'localoptions');
  assert.strictEqual(designsKeyFor({ siteMode: 'lead', siteTarget: 'cloudflare' }), 'lead');
  assert.strictEqual(designsKeyFor({ siteMode: 'rankfast' }), 'rankfast');
  assert.strictEqual(designsKeyFor({}), '');

  /* ONLY THE PAIRING, never either half alone. */
  assert.strictEqual(designsKeyFor({ siteMode: 'localoptions', siteTarget: 'cloudflare' }), CF_MODE);
  assert.notStrictEqual(designsKeyFor({ siteTarget: 'cloudflare' }), CF_MODE);
});

test('AND THE TWO DOORS LOCK THE SAME MODE, WHICH IS WHY DESIGNS ARE SEPARATE', () => {
  /* THE ONE THING THE mode/target SHAPE COULD NOT ALREADY EXPRESS. The
   * layouts belong to the DOOR, not the builder: both doors run
   * `localoptions`, so asking the mode which designs to offer gives the same
   * answer on both.
   *
   *     A LAYOUT BELONGS TO A DOOR, NOT TO A BUILDER. Two doors can run the
   *     same builder and have nothing to offer each other. */
  const src = codeOnly(read('routes/formRoute.js'));

  assert.match(src, /const designsKey = designsKeyFor\(\{ siteMode: mode, siteTarget: target \}\)/,
    'the designs list is keyed to the mode again, so both doors offer the same three');

  assert.ok(!/designsFor\(lockedMode\)/.test(src),
    'the meta tag still reads the mode rather than the door');
});

test('AND THE CLOUDFLARE LAYOUTS NEVER REACH THE GITHUB DOOR', () => {
  /* ⚠ THIS TEST USED TO RUN BOTH WAYS AND NOW RUNS ONE WAY. Edwin,
   * 17 November: *"can we just show each group of designs mapped out to
   * either github/cloudflare so the user never has to worry about mixing
   * them up?"*, and when Quarry was briefly put on the GitHub form so it
   * could be tested: *"but remember I do not want that for github it's for
   * clouldflare"*.
   *
   * Then, 18 November, having asked for the GitHub layouts and photographs
   * to be reused on Cloudflare: *"dont worry about cloudflare duplicating a
   * site from github"*. So the overlap now runs in exactly one direction —
   * Ledger, Beacon and Anvil are offered at both doors, and the five
   * Cloudflare layouts are offered at one.
   *
   *     THE RULE WAS NEVER "THE LISTS ARE DISJOINT". It was "nothing is
   *     offered where it cannot be built", and a Cloudflare-only layout on
   *     the GitHub form is still exactly that: designFor() refuses it there
   *     and the build falls back to Ledger without a word. */
  const github = designsFor('localoptions');
  const cloudflare = designsFor(CF_MODE);

  assert.ok(github.length, 'the GitHub wizard offers nothing');
  assert.ok(cloudflare.length, 'the Local Automation wizard offers nothing');

  const ghIds = new Set(github.map(d => d.id));

  for (const d of cloudflare) {
    if (ghIds.has(d.id)) continue;

    assert.ok(!d.modes.includes('localoptions'),
      `${d.label} is a Cloudflare layout offered on the GitHub door`);
    assert.strictEqual(designFor(d.id, 'localoptions'), null,
      `${d.label} resolves in the GitHub mode, where it is not offered`);
  }

  /* AND A SHARED ROW IS THE SAME ROW AT BOTH DOORS, not a copy of it. */
  for (const d of github) {
    assert.ok(cloudflare.includes(d),
      `${d.label} is offered on GitHub but not on Cloudflare`);
  }
});

test('THE SIDEBAR CARRIES IT, UNDER WEBSITES, BESIDE ITS PAIR', () => {
  const html = appSidebar('/local-automation');

  assert.ok(html.includes('href="/local-automation"'), 'there is no row');
  assert.ok(html.includes(NAV_CF_LOCAL), 'the row has no label');

  /* IT IS THE PAIR OF THE GITHUB ROW, so it sits with it rather than at the
   * end of the column. Asserted by order, because "it is in the sidebar"
   * passes with it filed under Tools. */
  assert.ok(html.indexOf(NAV_GH_SITES) < html.indexOf(NAV_CF_LOCAL),
    'the Local Automation row comes before the GitHub one');
});

test('and the row Edwin named is the row that renders', () => {
  /* ⚠ HE NAMED IT AND KEPT THE NAME. 17 November: *"this will be named
   * Cloudflare Local Automation"*, and then, shown that it breaks his own
   * earlier *"all the options on the sidebar should add the word Build"*,
   * he chose the name over the rule.
   *
   *     A HOUSE STYLE IS NOT A REASON TO RENAME SOMEBODY'S PRODUCT.
   *
   * Asserted literally here as well as in test-app-header.js, so a tidy-up
   * that adds the verb fails in the suite named after the product. */
  assert.strictEqual(NAV_CF_LOCAL, 'Cloudflare Local Automation');
});

/* ======================================================================= */

section('THE FALLBACK THAT SENT CLOUDFLARE SITES TO GITHUB');

test('A DESTINATION IS A CHOICE, NOT A FALLBACK', () => {
  /* THE FIRST OF THE TWO FAILURES. runLocalOptions publishes to GitHub when
   * it has an installation id, and took one off the ACCOUNT when the domain
   * pool had not supplied one — a fallback written so somebody testing
   * without the pool still got a published site.
   *
   * It was correct while there was one destination. An account that has ever
   * installed the GitHub App carries that id forever, so a site the customer
   * addressed to Cloudflare was ALSO pushed to GitHub, because of a choice
   * made weeks earlier about something else.
   *
   *     NOTHING HERE WAS WRONG UNTIL THERE WAS A SECOND PLACE TO PUT A
   *     SITE. A fallback is only a fallback while there is one destination. */
  const src = codeOnly(read('utils/runLocalOptions.js'));

  const pick = /const installationId = [\s\S]*?;/.exec(src);

  assert.ok(pick, 'the installation is no longer resolved in one place');

  assert.match(pick[0], /'cloudflare' === siteTarget/,
    'the GitHub installation is chosen without asking where the site is going');

  /* AND THE DESTINATION IS READ THE WAY EVERY OTHER GLOBAL IS READ, ONCE.
   * The wizard posts a nested body and a replayed job payload posts a flat
   * one; a hand-rolled `body.global.siteTarget` here reads one of those
   * two. It is resolved beside the siteMode now, because the design lookup
   * needs it too — see designsKeyFor(). */
  assert.match(src, /const siteTarget = siteTargetOf\(ctx\.body\);\s*\n\s*const designsKey =/,
    'the destination and the design key are no longer resolved together');

  assert.match(src, /require\('\.\/cloudflareSites\/wanted'\)/,
    'runLocalOptions no longer imports the reader that handles both bodies');
});

test('and the GitHub path still has its fallback, so the fix is narrow', () => {
  /* The fallback exists for a reason and only Cloudflare is carved out of
   * it. A fix that removed it outright would break testing without the pool,
   * which is what it was written for. */
  const src = codeOnly(read('utils/runLocalOptions.js'));
  const pick = /const installationId = [\s\S]*?;/.exec(src)[0];

  assert.match(pick, /place\.installationId/, 'the picked domain no longer decides');
  assert.match(pick, /ctx\.user\.githubInstallationId/,
    'the account fallback is gone, so testing without the domain pool publishes nothing');
});

test('BOTH SHAPES OF POSTED BODY NAME THE SAME DESTINATION', () => {
  /* Multipart expands to body.global.siteTarget; urlencoded and a replayed
   * job payload leave body['global[siteTarget]']. The two shapes are why
   * siteTargetOf exists, and a build reading only one of them would publish
   * correctly from the wizard and wrongly from a resumed job. */
  assert.strictEqual(siteTargetOf({ global: { siteTarget: 'cloudflare' } }), 'cloudflare');
  assert.strictEqual(siteTargetOf({ 'global[siteTarget]': 'cloudflare' }), 'cloudflare');

  assert.strictEqual(siteTargetOf({ global: { siteTarget: 'nonesuch' } }), '');
  assert.strictEqual(siteTargetOf({}), '');
  assert.strictEqual(siteTargetOf(null), '');
});

/* ======================================================================= */

section('THE ORDER THAT MADE THE PUBLISH STEP UNREACHABLE');

test('THE DESTINATION IS ASKED BEFORE THE BUILDER IS ASKED WHERE IT HAS BEEN', () => {
  /* THE SECOND FAILURE, and the quieter one. jobGenerator returned as soon
   * as the builder reported `published` — which runLocalOptions always does,
   * `null` included — so a Local Website Options build bound for Cloudflare
   * returned there and never reached the publish step at the bottom of the
   * function.
   *
   *     A FUNCTION THAT CHECKS WHERE IT HAS BEEN BEFORE IT CHECKS WHERE IT
   *     IS GOING ONLY EVER WORKS FOR ONE DESTINATION.
   *
   * ASSERTED BY POSITION, because both lines existed before and after the
   * fix; what changed is which one runs first. */
  const src = codeOnly(read('utils/jobGenerator.js'));

  const target = src.indexOf('const target = siteTargetOf(job.payload)');
  const published = src.indexOf('result.published !== undefined');
  const publish = src.indexOf("if ('cloudflare' === target)");

  assert.ok(target > -1, 'the destination is never read');
  assert.ok(published > -1, 'the GitHub report branch is gone');
  assert.ok(publish > -1, 'the Cloudflare publish step is gone');

  assert.ok(target < published,
    'the destination is still read after the branch that returns');
  assert.ok(published < publish,
    'the two branches have been reordered rather than guarded');
});

test('and the GitHub branch now refuses to answer for a Cloudflare site', () => {
  /* The position above is half of it. The branch also has to decline, or
   * reading the target earlier changes nothing. */
  const src = codeOnly(read('utils/jobGenerator.js'));

  const branch = /if \(result && result\.published !== undefined[^)]*\)/.exec(src);

  assert.ok(branch, 'the GitHub report branch has been reshaped');
  assert.match(branch[0], /'cloudflare' !== target/,
    'the GitHub branch still answers for a site addressed to Cloudflare');
});

test('AND THE PUBLISH REUSES createAndPublish, NOT A SECOND IMPLEMENTATION', () => {
  /* The seven checks that route runs — name, domain in the pool, hostname
   * clash across both products, the per-user guard, Cloudflare's project
   * ceiling, a build on disk, then the deploy — are the ones the form runs.
   * Writing them again here is how two paths start disagreeing about what is
   * allowed, which is what utils/domainPool.js was written after. */
  const src = codeOnly(read('utils/jobGenerator.js'));

  assert.match(src, /require\('\.\.\/routes\/cloudflareSitesRoute'\)/,
    'the job publishes to Cloudflare without the route that knows the rules');
  assert.match(src, /createAndPublish\(\{/, 'createAndPublish is not called');
});

test('and the address is read from the payload the same two ways', () => {
  const nested = { global: { cloudflare: { name: 'A', prefix: 'p', domain: 'd.com' } } };
  const flat = {
    'global[cloudflare][name]': 'A',
    'global[cloudflare][prefix]': 'p',
    'global[cloudflare][domain]': 'd.com',
  };

  assert.deepStrictEqual(wantedAddress(nested), wantedAddress(flat));
  assert.strictEqual(wantedAddress(nested).prefix, 'p');
});

/* ======================================================================= */

section('THE DRAFT GUARD, WHICH HAD TO BECOME A RULE');

test('A SELF-PUBLISHING MODE IS ALLOWED ON THE DOOR THAT CHOSE IT', () => {
  /* The guard refused any draft whose mode publishes itself from landing on
   * a page that locks a destination. It was right: that mode went to GitHub
   * whatever the target said, so the Cloudflare address would have been
   * dropped in silence.
   *
   * Both halves of that are fixed above, and what is left is a question
   * about THIS PAGE rather than about that mode. /cloudflare-sites/new locks
   * a destination and NO mode, so `localoptions` could only arrive there by
   * resumed draft and nobody chose it. /local-automation locks both, on
   * purpose, and is the whole reason the pairing exists.
   *
   *     A GUARD AGAINST A COMBINATION NOBODY ASKED FOR MUST NOT REFUSE THE
   *     COMBINATION SOMEBODY BUILT A DOOR FOR. */
  const src = codeOnly(read('public/js/generateDinamycForm.js'));

  const guard = /if \(LOCKED_TARGET && [^)]*LOCKED_AWAY\.has\(draft\.siteMode\)\) return;/
    .exec(src);

  assert.ok(guard, 'the draft guard is gone entirely');

  assert.match(guard[0], /!LOCKED_MODE/,
    'the guard still refuses a self-publishing mode on the door built for it');
});

test('and it still refuses one on the door that locks no mode', () => {
  /* The failure the guard exists for is unchanged on /cloudflare-sites/new:
   * nobody chose that mode there, it arrived from a draft, and the page
   * would build something other than what is on screen. */
  const src = codeOnly(read('public/js/generateDinamycForm.js'));

  assert.match(src, /LOCKED_AWAY = new Set\(\['localoptions'\]\)/,
    'the list of self-publishing modes has changed shape');

  assert.match(src, /LOCKED_TARGET &&/,
    'the guard no longer depends on a locked destination at all');
});

/* ======================================================================= */

section('TWO DESTINATIONS ON ONE PAGE — THE VISIBLE HALF AND THE OTHER ONE');

test('STEP 3 ASKS FOR NO DOMAIN ON THIS DOOR', () => {
  /* EDWIN SAW IT IN THE BROWSER, 17 November: a GitHub pool dropdown
   * (1r2.net, 8-i.net — Namecheap, Hostinger) in step 3, AND the Cloudflare
   * address at the end. Two destinations, both required, one page.
   *
   * IT CAME FROM LOCKING THE MODE. The picker renders on `localoptions`,
   * which this door locks — so it switched itself on. Nothing was written
   * to turn it on and nothing failed.
   *
   *     A CONTROL THAT APPEARS BECAUSE OF A FLAG SET FOR ANOTHER REASON IS
   *     A CONTROL NOBODY DECIDED TO SHOW. */
  const src = codeOnly(read('public/js/generateDinamycForm.js'));

  assert.match(src, /function asksForDomain\(\) \{[\s\S]*?'cloudflare' === LOCKED_TARGET/,
    'nothing decides whether step 3 asks for a domain at all');

  assert.match(src, /function picksPoolDomain\(\) \{[\s\S]*?'cloudflare' !== LOCKED_TARGET/,
    'the GitHub picker still renders on any localoptions page');

  /* THE MARKUP ASKS THE QUESTION, which is the half that could be forgotten
   * after the helper was written. */
  assert.match(src, /\$\{!asksForDomain\(\) \? '' : \(picksPoolDomain\(\)/,
    'the domain block renders without consulting the door');
});

test('AND THE REQUIRED LIST DOES NOT NAME A BOX THE PAGE DOES NOT RENDER', () => {
  /* The quiet half. The validator maps each required name to an element and
   * SKIPS the ones it cannot find, so a list naming `global[domainId]` on a
   * page that renders no picker passes — and the build fails three minutes
   * later, after the writing is paid for. That exact failure is recorded in
   * the comment above this list. */
  const src = codeOnly(read('public/js/generateDinamycForm.js'));

  assert.match(src, /\.\.\.\(asksForDomain\(\)\s*\?\s*\[picksPoolDomain\(\) \? 'global\[domainId\]' : 'global\[domain\]'\]\s*:\s*\[\]\)/,
    'the required-field list still names a domain field unconditionally');
});

test('WHERE IT GOES IS ASKED ON THE MAIN FORM, NOT AT THE END', () => {
  /* Edwin, 18 November: *"instead of the domain option/form appearing in
   * step 4 i would like to have the select domain option like we have in
   * github. i think it is in step 3"* — and /github-sites does ask for its
   * domain among the phone and the address.
   *
   * THE LINE'S POSITION IS THE BEHAVIOUR, which is why this reads the
   * source and not just the function. `container` is inside #websiteForm,
   * so a card appended BEFORE snapshotFormValues(form) runs travels to the
   * server with everything else and nothing had to learn about it. Appended
   * after the footer it would sit below the Continue button; appended after
   * the snapshot is read it would be empty in it. */
  const src = codeOnly(read('public/js/generateDinamycForm.js'));

  const main = src.slice(src.indexOf('function renderMainForm()'),
    src.indexOf('function renderServicePagesStep'));

  assert.ok(main.length > 500, 'renderMainForm is not where this test thinks');

  assert.match(main, /'cloudflare' === LOCKED_TARGET\) renderCloudflareFields\(container\);/,
    'the main form no longer renders the address card');

  const at = main.indexOf('renderCloudflareFields(container)');

  assert.ok(at > main.indexOf('container.appendChild(block)'),
    'the address card is appended before the form block it belongs under');
  assert.ok(at < main.indexOf('restoreFormValues(form'),
    'the card is built after the values are restored, so a returning '
    + 'customer finds it blank');
  assert.ok(at < main.indexOf('snapshotFormValues(form)'),
    'the card is built after the snapshot is read, so the three fields are '
    + 'empty in it and never reach the server');

  /* AND THE REVIEW STEP NO LONGER RENDERS IT. Two copies of one card means
   * two sets of boxes posting the same three names. */
  const review = src.slice(src.indexOf('function renderReviewStep()'));

  assert.ok(!/renderCloudflareFields\(/.test(review),
    'the review step still renders the address card as well');
});

test('AND THE THREE BOXES ARE REQUIRED ON THE STEP THAT ASKS FOR THEM', () => {
  /* `required` in the markup does nothing here: Continue is a plain button
   * and the form is never natively submitted until the review step. A field
   * missing from this list is one the customer answers at the end, having
   * already walked past it — the same hole the comment above the list
   * describes, one step worse. */
  const src = codeOnly(read('public/js/generateDinamycForm.js'));

  assert.match(src, /\.\.\.\('cloudflare' === LOCKED_TARGET\s*\?\s*\['global\[cloudflare\]\[name\]', 'global\[cloudflare\]\[prefix\]',\s*'global\[cloudflare\]\[domain\]'\]/,
    'the required-field list does not name the three address boxes');

  /* AND EACH HAS A LABEL. A required field with none falls back to "all
   * required fields", which points at nothing on a step with twenty boxes. */
  for (const [field, label] of [['name', 'Name'], ['prefix', 'Subdomain'], ['domain', 'Domain']]) {
    assert.ok(src.includes(`'global[cloudflare][${field}]': '${label}'`),
      `the ${field} box has no label, so its message names no field`);
  }
});

test('AND THE DOMAIN LIST OPENS ON A CHOICE, NOT ON WHICHEVER CAME FIRST', () => {
  /* A <select> with no valueless first option shows its first real row and
   * reports that value, so the customer is handed whichever domain the pool
   * listed first and never has to look at the box. On the review step,
   * where this card used to live, that was a row they could read; here it
   * is one of twenty fields on a long step.
   *
   *     A DEFAULT NOBODY CHOSE IS NOT A DEFAULT. It also makes the
   *     required check above mean something: an untouched box is empty.
   *
   * THE GITHUB PICKER HAS ALWAYS DONE THIS, which is what Edwin was asking
   * for when he said "like we have in github". */
  const src = codeOnly(read('public/js/generateDinamycForm.js'));

  const fn = src.slice(src.indexOf('function renderCloudflareFields'),
    src.indexOf('function renderReviewStep'));

  assert.match(fn, /select\.innerHTML = '<option value="">Choose a domain…<\/option>'/,
    'the Cloudflare domain list has no "choose one" row, so one is preselected');

  /* AND THE CHOICE SURVIVES COMING BACK. The options do not exist until the
   * request resolves, and a select cannot hold a value for an option it has
   * not got — so restoreFormValues() drops it silently and the step reopens
   * on the placeholder. */
  assert.match(fn, /state\.mainFormSnapshot \|\| \{\}\)\['global\[cloudflare\]\[domain\]'\]/,
    'nothing reapplies the chosen domain once the options arrive');

  /* AND THE NAME AND SUBDOMAIN FOLLOW THE BUSINESS NAME UNTIL TOUCHED. The
   * old prefill read the snapshot, which on this step does not exist yet. */
  assert.match(fn, /businessBox\.addEventListener\('input'/,
    'the subdomain no longer follows the business name as it is typed');
  assert.match(fn, /if \(!ownPrefix\) prefixBox\.value = slug\(businessBox\.value\)/,
    'the subdomain is not slugged from the business name');
  assert.match(fn, /prefixBox\.addEventListener\('input', \(\) => \{ ownPrefix = true; \}\)/,
    'an edited subdomain is overwritten by the next keystroke in the name');

  /* ⚠ AND "HAS A VALUE" IS NOT "WAS CHOSEN". "Add another site" reloads
   * with the previous site's draft restored, so both boxes arrive full — of
   * the LAST site's address. Read as chosen, they refuse to follow the new
   * business name, and the one field that MUST differ between two sites is
   * the one field that would not. generateBatchRoute.js refuses two sites
   * at one address, so it would have been caught at the very end, as a
   * rejected batch, after everything else had been typed again. */
  assert.match(fn, /nameBox\.value !== derivedName/,
    'a name box holding what it derived counts as chosen, so a batch add '
    + 'keeps the previous site\'s address');
  assert.match(fn, /prefixBox\.value !== slug\(derivedName\)/,
    'a subdomain holding what it derived counts as chosen, so a batch add '
    + 'keeps the previous site\'s subdomain');
});

test('AND THE REVIEW STEP STILL REPORTS THE ADDRESS IT WILL PUBLISH TO', () => {
  /* A step that collects something the review never mentions is a step the
   * customer cannot check — and the address is the one fact on that page
   * that cannot be fixed afterwards. */
  const src = codeOnly(read('public/js/generateDinamycForm.js'));

  assert.match(src, /reviewCard\('Where it goes'/,
    'the review step no longer mentions where the site goes');
  assert.match(src, /reviewRow\('Address', cloudflareHost\(\)/,
    'the review reports the parts but never the hostname they add up to');
  const card = src.slice(src.indexOf("reviewCard('Where it goes'"));

  assert.match(card.slice(0, 400), /\.join\(''\), STEP\.MAIN\)\]\)/,
    'the edit link on that card goes somewhere other than the step that asks');

  /* HALF AN ADDRESS IS NOT AN ADDRESS. "acme." or ".9-x.org" reads as a
   * value the wizard mangled, where an empty row reads as one not yet
   * filled in — which is what has happened. */
  assert.match(src, /return \(prefix && domain\) \? `\$\{prefix\}\.\$\{domain\}` : '';/,
    'a missing half still renders as a dangling dot');
});

test('THE SERVER REQUIRES NEITHER FIELD FOR THIS PAIRING, AND BOTH DOORS KEEP THEIRS', () => {
  /* The same rule in its second place. validateGlobalFields required
   * `domainId` for every localoptions build, so this door was sent looking
   * for a GitHub pool row — the wrong product's domain entirely.
   *
   * NOTHING IS LEFT UNCHECKED. checkWant() runs straight after and
   * validates the whole address, naming the field it objects to. */
  const { validateGlobalFields } = require('./utils/helpers');

  const base = {
    businessName: 'B', businessType: 'plumbing', phone: '5125550100',
    address: 'A St, Austin, TX', location: 'Austin, TX', email: 'e@x.com',
  };

  const wanted = (global, options) => (validateGlobalFields(global, options).fields || [])
    .map(f => f.name)
    .filter(n => /domain/i.test(n));

  assert.deepStrictEqual(wanted(base, { siteMode: 'localoptions', siteTarget: 'cloudflare' }), [],
    'Cloudflare Local Automation is still asked for a pool domain');

  /* AND NEITHER OTHER DOOR CHANGED, which is what makes this a new case
   * rather than a hole. */
  assert.deepStrictEqual(wanted(base, { siteMode: 'localoptions' }), ['global[domainId]'],
    '/github-sites stopped requiring a picked domain');

  assert.deepStrictEqual(wanted(base, { siteMode: 'lead', siteTarget: 'cloudflare' }), ['global[domain]'],
    '/cloudflare-sites/new stopped requiring a domain');

  assert.deepStrictEqual(wanted(base, { siteMode: 'lead' }), ['global[domain]'],
    'the open wizard stopped requiring a domain');

  /* AND THE DESTINATION REACHES IT. The route resolves the target and hands
   * it over; reading `global.siteTarget` here would be undefined in the
   * bracketed body shape, which is the mistake the siteMode note records. */
  const route = codeOnly(read('routes/generateRoute.js'));

  assert.match(route, /validateGlobalFields\(global, \{\s*siteMode,\s*siteTarget: siteTargetOf\(req\.body\),/,
    'the route validates without telling it where the site is going');
});

test('AND THE BUILD NEVER TAKES A CLOUDFLARE SITE\'S ADDRESS FROM THE GITHUB POOL', () => {
  /* THE HALF NOBODY COULD SEE. sitePlace() reads `domainId` first, so with
   * both answered the site would have been PUBLISHED to the Cloudflare
   * address and BUILT for the GitHub one: every canonical, every og:url,
   * the sitemap and the CNAME naming a host the pages are not served from.
   *
   *     A PAGE WITH THE WRONG CANONICAL SERVES 200, LOOKS PERFECT, AND IS
   *     INVISIBLE.
   *
   * IGNORED RATHER THAN REFUSED, because a job queued before the form
   * changed still carries that field and is otherwise a fine build. */
  const src = codeOnly(read('utils/runLocalOptions.js'));

  const place = /async function sitePlace\(\{[\s\S]*?\n  if \(!chosen\)/.exec(src);

  assert.ok(place, 'sitePlace has been reshaped');

  assert.match(place[0], /const target = siteTargetOf\(ctx\.body\)/,
    'sitePlace never asks where the site is going');

  assert.match(place[0], /'cloudflare' === target \? '' : String\(global\.domainId/,
    'a picked GitHub domain still decides the address of a Cloudflare site');
});

/* ======================================================================= */

section('THE DOORS, SERVED');

async function render(routePath) {
  const express = require('express');
  const app = express();

  app.use((req, res, next) => {
    res.locals.csrfToken = 'T';
    res.locals.csrfField = '<input name="_csrf">';
    next();
  });
  app.use(require('./routes/formRoute'));

  const srv = app.listen(0);
  const { port } = srv.address();

  try {
    const res = await fetch(`http://127.0.0.1:${port}${routePath}`);

    return { status: res.status, html: await res.text() };
  } finally {
    srv.close();
  }
}

asyncTest('/local-automation SERVES THE WIZARD, LOCKED BOTH WAYS', async () => {
  /* SERVED, NOT INSPECTED AS SOURCE. The mutant this catches is the route
   * quietly dropping one of the two meta tags: every assertion above still
   * passes, because they read the route's arguments. The page would render
   * and build the wrong product. */
  const { status, html } = await render('/local-automation');

  assert.strictEqual(status, 200);

  assert.ok(/<meta name="site-mode" content="localoptions">/.test(html),
    'the page does not tell the wizard which builder it is for');
  assert.ok(/<meta name="site-target" content="cloudflare">/.test(html),
    'the page does not tell the wizard where the build is going');

  assert.ok(/href="\/local-automation"[^>]*app-sidebar-link-active/.test(html),
    'the Local Automation row is not marked as the current page');
});

asyncTest('AND IT OFFERS ITS OWN LAYOUTS, NOT THE GITHUB ONES', async () => {
  const { html } = await render('/local-automation');

  const meta = /<meta name="site-designs" content="([^"]*)">/.exec(html);

  assert.ok(meta, 'the page offers no designs at all');

  const offered = JSON.parse(meta[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  const ids = offered.map(d => d.id).sort();

  assert.deepStrictEqual(ids, designsFor(CF_MODE).map(d => d.id).sort(),
    'the door offers a different list from the one designs.js gives its mode');

  /* AND THE GITHUB DOOR IS UNCHANGED, which is the half a one-sided
   * assertion would miss. */
  const gh = /<meta name="site-designs" content="([^"]*)">/
    .exec((await render('/github-sites')).html);

  const ghIds = JSON.parse(gh[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'))
    .map(d => d.id);

  /* THE GITHUB DOOR OFFERS THREE AND ONLY THREE. Since 18 November those
   * three are also on the Cloudflare door, so "no id appears on both" is no
   * longer the check — the check is that the GitHub list did not GROW. */
  assert.deepStrictEqual(ghIds.sort(),
    designsFor('localoptions').map(d => d.id).sort(),
    'the GitHub door offers a different list from the one designs.js gives it');

  for (const id of ids) {
    if (ghIds.includes(id)) continue;

    assert.strictEqual(designFor(id, 'localoptions'), null,
      `design ${id} is a Cloudflare layout that resolves on the GitHub door`);
  }
});

asyncTest('AND THE PAGE SAYS WHICH DOOR IT IS', async () => {
  /* Edwin, 17 November: one wizard served three routes and said so nowhere.
   * All of them opened on "1. What are we building?" and the only thing on
   * screen that differed was which sidebar row was lit.
   *
   *     THE LIT ROW IS WHERE YOU CAME FROM. A HEADING IS WHERE YOU ARE. */
  const { html } = await render('/local-automation');

  assert.match(html, /Build a Cloudflare Local Automation website/,
    'the page does not say what it is building');

  /* AND THE BLURB SAYS THE ENDING, which is the actual difference between
   * this door and /github-sites. */
  const blurb = /<p class="text-white-50 mb-4">([^<]+)<\/p>/.exec(html);

  assert.ok(blurb, 'there is no blurb under the heading');
  assert.match(blurb[1], /Eleven pages/, 'the blurb does not say what gets built');
  assert.match(blurb[1], /subdomain/i, 'the blurb does not say where it ends up');
});

asyncTest('and the three doors that existed before are untouched', async () => {
  /* A FOURTH DOOR MUST NOT CHANGE THE OTHER THREE, and `designsKey`
   * defaulting to `mode` is what guarantees it. Asserted by serving them. */
  const open = await render('/');

  assert.ok(!/site-mode/.test(open.html), 'the open wizard locked a mode');
  assert.ok(!/site-target/.test(open.html), 'the open wizard locked a destination');

  const gh = await render('/github-sites');

  assert.ok(/<meta name="site-mode" content="localoptions">/.test(gh.html));
  assert.ok(!/site-target/.test(gh.html), '/github-sites gained a destination');

  const cf = await render('/cloudflare-sites/new');

  assert.ok(/<meta name="site-target" content="cloudflare">/.test(cf.html));
  assert.ok(!/site-mode/.test(cf.html), '/cloudflare-sites/new gained a mode');
});

/* ---------------------------------------------------------------------- */

(async () => {
  for (const run of deferred) await run();

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
