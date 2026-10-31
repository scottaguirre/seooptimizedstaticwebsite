// test-local-options-wiring.js
//
// THE SEAM BETWEEN THE APP AND THE MODE.
//
// The other six local-options suites test the mode in isolation: the shape,
// the chrome, the renderer, the heroes, the prompt, the generator. Every one
// of them would still pass with the mode unreachable from the wizard, which
// is exactly what it was until 28 October.
//
// This one tests the wiring:
//
//   utils/localOptions/address.js   four typed boxes -> two composed strings
//   utils/helpers.js               checkCredits reaching quote()'s own branch
//   utils/runLocalOptions.js       the build wrapper, with the model injected
//   utils/jobGenerator.js          which builder a queued job gets
//
//   node test-local-options-wiring.js

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { localAddress, knownState } = require('./utils/localOptions/address');
const { checkCredits } = require('./utils/helpers');
const { quote, PRICING } = require('./utils/pricing');
const { pagesToBuild, LOCAL_OPTIONS_SERVICE_PAGES, MODES } = require('./utils/seoPresets');
const {
  runLocalOptions,
  hoursFrom,
  areasFrom,
  socialFrom,
  AREA_TOWNS,
  SOURCE_PATH,
  writeFiles,
  TOTAL_PAGES,
} = require('./utils/runLocalOptions');

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === 'function') {
      throw new Error('this test is async and was run synchronously');
    }
    console.log(`  ok    ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}\n        ${err.message}`);
    failed++;
  }
}

const asyncTests = [];
function asyncTest(name, fn) { asyncTests.push([name, fn]); }

function tmpdir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `localopts-${label}-`));
}

/** Enough of a Mongoose user for checkCredits and chargeCredits. */
function fakeUser(credits = 5000) {
  return {
    _id: { toString: () => '507f1f77bcf86cd799439011' },
    credits,
    saves: 0,
    async save() { this.saves += 1; },
  };
}

/** Six services, as the wizard posts them. */
function sixPages() {
  const names = [
    'Water Heater Repair', 'Drain Cleaning', 'Leak Detection',
    'Toilet Repair', 'Sewer Line Repair', 'Whole House Repiping',
  ];
  const pages = {};
  names.forEach((filename, i) => { pages[i] = { filename }; });
  return pages;
}

function goodGlobal(extra = {}) {
  return Object.assign({
    siteMode: 'localoptions',
    businessName: 'Leander Plumbing Gomanzo',
    businessType: 'plumbing',
    domain: 'leanderplumbing.com',
    street: '1804 S Bagdad Rd, Suite 120',
    city: 'Leander',
    state: 'tx',
    zip: '78641',
    phone: '(512) 555-0164',
    email: 'hello@leanderplumbing.com',
    is24Hours: 'true',
  }, extra);
}

/** A generateLocalOptionsSite that costs nothing and records what it was asked. */
function fakeGenerate(files = { 'index.html': '<p>home</p>' }) {
  const seen = { calls: 0, args: null, pages: [] };

  return {
    seen,
    async generate(args) {
      seen.calls += 1;
      seen.args = args;

      /* THE REAL ONE CALLS onPage SEVEN TIMES — six services then the home
       * page — so the stub does too. A stub that never calls it would let a
       * broken progress bar pass. */
      for (let i = 0; i < LOCAL_OPTIONS_SERVICE_PAGES; i += 1) {
        await args.onPage({ kind: 'service', name: `service ${i + 1}` });
        seen.pages.push(`service ${i + 1}`);
      }
      await args.onPage({ kind: 'home', name: 'Home page' });
      seen.pages.push('Home page');

      return {
        files,
        services: [],
        home: { h1: 'home', sub: 's', title: 't', meta: 'm' },

        /* THE SAME SHAPE THE REAL GENERATOR RETURNS — renderSite()'s own
         * argument object. The first version of this stub left it out, so
         * the test asserting _src/localoptions.json is written failed
         * against code that was correct. A stub that does not match the
         * contract tests the stub; that lesson is one file away, in
         * test-local-options-generate.js, where a stub returning a bare
         * array hid a real bug for a whole afternoon. */
        source: {
          url: args.url,
          business: args.business,
          services: [],
          areas: args.areas,
          hours: args.hours,
          alt: {},
          cover: 1,
          logo: args.logo,
          structure: args.structure,
          home: { h1: 'home', sub: 's', title: 't', meta: 'm' },
          now: args.now,
        },

        heroes: { found: [1, 2, 3, 4], missing: [] },
        usage: { calls: 7, inputTokens: 100, outputTokens: 200 },
      };
    },
  };
}

console.log('\nLocal Website Options — wiring\n');

/* =========================================================================
 * address.js
 * ====================================================================== */

test('the four boxes compose the two strings the pipeline expects', () => {
  const addr = localAddress({
    street: '1804 S Bagdad Rd, Suite 120',
    city: 'Leander',
    state: 'tx',
    zip: '78641',
  });

  assert.ok(addr.ok);
  assert.strictEqual(addr.address, '1804 S Bagdad Rd, Suite 120, Leander, TX 78641');
  assert.strictEqual(addr.location, 'Leander, TX');
});

test('the state is uppercased, because everything downstream compares it', () => {
  /* validateAndNormalizeLocationPages() uppercases the towns it parses and
   * then compares them against `location`. A lowercase "tx" here means the
   * site’s own town stops matching and gets a location page of its own in
   * any mode that builds them. */
  assert.strictEqual(localAddress({ state: 'tx', street: 'a', city: 'b', zip: '78641' }).state, 'TX');
});

test('each missing box is reported on its own name', () => {
  /* Reporting all four as global[address] would highlight a box that is not
   * on the screen in this mode. */
  const addr = localAddress({});

  assert.strictEqual(addr.ok, false);
  assert.deepStrictEqual(
    addr.fields.map(f => f.name),
    ['global[street]', 'global[city]', 'global[state]', 'global[zip]']
  );
});

test('a blank state is reported once, not twice', () => {
  /* Required AND "use the two-letter code" on one empty box reads as two
   * problems. Same rule validateGlobalFields() follows for the phone. */
  const forState = localAddress({ street: 'a', city: 'b', zip: '78641' })
    .fields.filter(f => f.name === 'global[state]');

  assert.strictEqual(forState.length, 1);
  assert.strictEqual(forState[0].message, 'Required');
});

test('a filled state of the wrong shape gets the shape message', () => {
  const addr = localAddress({ street: 'a', city: 'b', state: 'Texas', zip: '78641' });

  assert.strictEqual(addr.ok, false);
  assert.match(addr.fields[0].message, /two-letter state code/);
});

test('DC is a state here, and Puerto Rico is not', () => {
  /* The set in helpers.js has the fifty plus DC and none of the territories.
   * This is not a preference — it is the one set the towns list is already
   * validated against, and the note on its export records where it parts
   * company with getFullStateName()’s table. */
  assert.ok(knownState('DC'));
  assert.ok(!knownState('PR'));
  assert.ok(!knownState('T'));
  assert.ok(!knownState('TEX'));
});

test('a ZIP+4 is accepted and a short ZIP is not', () => {
  assert.ok(localAddress({ street: 'a', city: 'b', state: 'TX', zip: '78641-2203' }).ok);

  const short = localAddress({ street: 'a', city: 'b', state: 'TX', zip: '7864' });
  assert.strictEqual(short.ok, false);
  assert.match(short.fields[0].message, /5-digit ZIP/);
});

/* =========================================================================
 * checkCredits — the flattening that hid quote()'s own branch
 * ====================================================================== */

test('this mode is priced at a flat 800, whatever was posted', () => {
  /* THE BUG THIS REPLACES. checkCredits read
   *     options.siteMode === 'sample' ? 'sample' : 'lead'
   * so the branch quote() carries for this mode could never be reached from
   * here, and the price came from the lead formula — which moves with the
   * number of rows. The totals agree at exactly six, which is why nothing
   * looked wrong, and part company everywhere else. */
  const expected = PRICING.LEAD_BASE + (LOCAL_OPTIONS_SERVICE_PAGES * PRICING.SERVICE_PAGE);

  for (const count of [1, 6, 10]) {
    const pages = {};
    for (let i = 0; i < count; i += 1) pages[i] = { filename: `service ${i}` };

    assert.strictEqual(
      checkCredits(fakeUser(), pages, { siteMode: 'localoptions' }).totalCost,
      expected,
      `${count} rows priced as ${count} rows`
    );
  }
});

test('and the Add page button cannot sell a seventh page', () => {
  /* The gate prices the site "as if one more page existed". For a fixed
   * eleven-page site the honest answer to that question is the same number.
   * This is the assertion that would have failed before the fix. */
  const six = {};
  for (let i = 0; i < 6; i += 1) six[i] = { filename: `service ${i}` };

  const seven = Object.assign({ 6: { filename: 'one more' } }, six);

  assert.strictEqual(
    checkCredits(fakeUser(), seven, { siteMode: 'localoptions' }).totalCost,
    checkCredits(fakeUser(), six, { siteMode: 'localoptions' }).totalCost
  );
});

test('the other three modes are priced exactly as before', () => {
  const three = { 0: { filename: 'a' }, 1: { filename: 'b' }, 2: { filename: 'c' } };

  const lead = checkCredits(fakeUser(), three, { siteMode: 'lead' }).totalCost;

  /* Rank Fast builds the same page set as Rank GBPs and must cost the same.
   * It used to reach quote() AS 'lead'; it now reaches it as itself, and the
   * answer has to be identical or this change repriced a live product. */
  assert.strictEqual(checkCredits(fakeUser(), three, { siteMode: 'rankfast' }).totalCost, lead);
  assert.strictEqual(lead, quote({ siteMode: 'lead', servicePages: 3 }).total);

  assert.strictEqual(
    checkCredits(fakeUser(), three, { siteMode: 'sample' }).totalCost,
    PRICING.SAMPLE
  );

  /* No mode at all is every Job row written before the field existed. */
  assert.strictEqual(checkCredits(fakeUser(), three, {}).totalCost, lead);
  assert.strictEqual(checkCredits(fakeUser(), three, { siteMode: 'nonsense' }).totalCost, lead);
});

/* =========================================================================
 * runLocalOptions — the pure parts
 * ====================================================================== */

test('the page total comes from seoPresets, not from a literal 11', () => {
  assert.strictEqual(TOTAL_PAGES, pagesToBuild(MODES.LOCAL_OPTIONS, {}, 0));
});

test('a closed day is null, not an empty string', () => {
  /* render/chrome.js prints "Closed" for null and an empty cell for an empty
   * string, and an empty cell reads as "we forgot" — about the one day the
   * owner typed deliberately. */
  const hours = hoursFrom({
    hours: {
      monday: { open: '07:00', close: '18:00' },
      sunday: { closed: 'on' },
    },
  });

  assert.strictEqual(hours.length, 7);
  assert.deepStrictEqual(hours[0], { day: 'Monday', open: '7:00 AM – 6:00 PM' });
  assert.strictEqual(hours[6].day, 'Sunday');
  assert.strictEqual(hours[6].open, null);
});

test('a blank or unparseable time is closed, not blank', () => {
  const hours = hoursFrom({ hours: { monday: { open: '', close: '18:00' } } });
  assert.strictEqual(hours[0].open, null);

  const junk = hoursFrom({ hours: { monday: { open: 'morning', close: 'evening' } } });
  assert.strictEqual(junk[0].open, null);
});

test('open 24 hours is all seven days', () => {
  const hours = hoursFrom({ is24Hours: 'true' });

  assert.strictEqual(hours.length, 7);
  assert.ok(hours.every(h => h.open === 'Open 24 hours'));
});

test('the service area comes from the gazetteer, own town first', () => {
  /* NOTHING IS TYPED ANY MORE. There is no locations step in this mode, so
   * the towns come from utils/nearbyPlaces.js — the GeoNames cities1000
   * export and some trigonometry. No tokens, no network, and the same answer
   * every time for the same address, which is also what keeps a rebuild
   * byte-identical. */
  const areas = areasFrom({ city: 'Leander', state: 'TX' });

  assert.strictEqual(areas.length, AREA_TOWNS);
  assert.strictEqual(areas[0], 'Leander', 'the business own town is not first');

  /* nearbyPlaces() excludes the home town from `places`, so there is nothing
   * to de-duplicate. Asserted because relying on that is invisible. */
  assert.strictEqual(areas.filter(town => town === 'Leander').length, 1);

  /* STRINGS, AND THE TOWN NAME ONLY. An earlier version of this function
   * passed its source's objects straight through, and every footer and every
   * areaServed read "[object Object]" — nothing throws, because
   * interpolating an object is valid JavaScript with a useless result.
   *
   * The name alone rather than "Cedar Park, TX": the footer would otherwise
   * repeat the state four times in one sentence, and the state is already on
   * the page in the address. */
  assert.ok(areas.every(town => typeof town === 'string' && !town.includes(',')));

  /* AND THEY ARE ACTUALLY NEARBY, which is the whole reason this is not a
   * model call: Edwin's screenshot of a Dallas location page on a Round Rock
   * site, 190 miles away. */
  assert.ok(areas.includes('Cedar Park'), `got ${areas.join(', ')}`);
});

test('the six social URLs reach the footer', () => {
  /* THE FORM COLLECTED THEM AND THE SITE DROPPED THEM. The footer reads
   * business.social and nothing was passing it, so a customer who filled in
   * all six got a footer with none — no error, no empty link. */
  const social = socialFrom({
    facebookUrl: 'https://facebook.com/acme',
    instagramUrl: 'https://instagram.com/acme',
    youtubeUrl: 'https://youtube.com/@acme',
    twitterUrl: 'https://x.com/acme',
    pinterestUrl: 'https://pinterest.com/acme',
    linkedinUrl: 'https://linkedin.com/company/acme',
  });

  assert.deepStrictEqual(
    Object.keys(social).sort(),
    ['facebook', 'instagram', 'linkedin', 'pinterest', 'twitter', 'youtube']
  );
});

test('the key loses its Url suffix, because the renderer does not speak form', () => {
  const social = socialFrom({ facebookUrl: 'https://facebook.com/acme' });

  assert.strictEqual(social.facebook, 'https://facebook.com/acme');
  assert.strictEqual(social.facebookUrl, undefined);
});

test('a placeholder is not a link', () => {
  /* '#', 'n/a' and a blank are all things customers type into a box they do
   * not want to fill. The same rule as usableUrl() in buildSocialLinks.js —
   * without it the footer carries a visible icon that reloads the page. */
  for (const junk of ['#', 'n/a', 'N/A', '   ', '']) {
    assert.deepStrictEqual(socialFrom({ facebookUrl: junk }), {}, `"${junk}" became a link`);
  }
});

test('a bare domain gets a scheme', () => {
  /* href="facebook.com/acme" resolves RELATIVE to the page, so the icon in
   * the footer of /services/drain-cleaning/ would point at
   * /services/drain-cleaning/facebook.com/acme. */
  assert.strictEqual(
    socialFrom({ facebookUrl: 'facebook.com/acme' }).facebook,
    'https://facebook.com/acme'
  );

  assert.strictEqual(
    socialFrom({ facebookUrl: 'HTTP://facebook.com/acme' }).facebook,
    'HTTP://facebook.com/acme',
    'a scheme already there was replaced'
  );
});

test('and the renderer has a mark for every one of the six', () => {
  /* THIS IS THE HALF THAT WAS MISSING. render/chrome.js renders only the
   * keys it holds a path for, and it held three — facebook, instagram,
   * youtube. Wiring the other three through without this would have moved
   * the silent drop from the adapter into the renderer. */
  const { footer } = require('./utils/localOptions/render/chrome');

  const html = footer({
    business: {
      name: 'Acme',
      social: socialFrom({
        facebookUrl: 'https://facebook.com/a',
        instagramUrl: 'https://instagram.com/a',
        youtubeUrl: 'https://youtube.com/@a',
        twitterUrl: 'https://x.com/a',
        pinterestUrl: 'https://pinterest.com/a',
        linkedinUrl: 'https://linkedin.com/company/a',
      }),
    },
    services: [],
    now: new Date('2026-10-28T00:00:00Z'),
  });

  for (const label of ['Facebook', 'Instagram', 'Youtube', 'Twitter', 'Pinterest', 'Linkedin']) {
    assert.ok(html.includes(`aria-label="${label}"`), `${label} has no mark in the footer`);
  }

  assert.strictEqual((html.match(/<svg/g) || []).length, 6);
});

asyncTest('the whole build passes the social links through', async () => {
  /* The adapter and the renderer are both covered above; this is the wire
   * between them, which is the part that was missing entirely. */
  const stub = fakeGenerate();

  await runLocalOptions({
    body: {
      global: goodGlobal({ facebookUrl: 'https://facebook.com/acme', twitterUrl: '#' }),
      pages: sixPages(),
    },
    user: fakeUser(),
    baseDir: tmpdir('social'),
    generate: stub.generate,
  });

  assert.deepStrictEqual(stub.seen.args.business.social, {
    facebook: 'https://facebook.com/acme',
  });
});

test('an address the gazetteer cannot place falls back to the town', () => {
  /* An empty areaServed makes the footer sentence read as an unfinished
   * template, so a town it has never heard of is still a service area of one
   * rather than none. */
  assert.deepStrictEqual(
    areasFrom({ city: 'Nowhereville', state: 'ZZ' }),
    ['Nowhereville']
  );

  // And no city at all is genuinely nothing to say.
  assert.deepStrictEqual(areasFrom({}), []);
});

/* =========================================================================
 * A blog campaign must not block, or impersonate, a website build
 *
 * NOT A LOCAL-OPTIONS BUG — it has been true of every mode since the
 * Interlink Engine shipped — but it is what stopped Edwin's first real build
 * of this mode from existing, so it is tested beside it.
 *
 * He approved a fifteen-article campaign, started a site build while it ran,
 * was sent to a progress page, and watched a bar fill to 15 of 15. The
 * articles arrived. The website had never been created: the build was
 * refused with a 409 that public/js/spinner.js follows WITHOUT showing its
 * message, so the refusal looked exactly like a build starting.
 * ====================================================================== */

const GENERATE_ROUTE = fs.readFileSync(path.join(__dirname, 'routes/generateRoute.js'), 'utf8');
const AUTH_ROUTE = fs.readFileSync(path.join(__dirname, 'routes/authRoute.js'), 'utf8');

/** The object literal of the Job.findOne that names `status`, from `src`. */
function activeJobQuery(src, label) {
  const at = src.indexOf('status: { $in:');
  assert.notStrictEqual(at, -1, `${label} no longer queries jobs by status`);

  // From the findOne that owns it to the end of that call.
  const from = src.lastIndexOf('Job.findOne({', at);
  assert.notStrictEqual(from, -1, `${label}'s status filter is not inside a findOne`);

  return src.slice(from, src.indexOf('})', at));
}

test('a submission with no service rows at all is accepted', () => {
  /* ABSENT, NOT EMPTY, AND THE DIFFERENCE COST AN ATTEMPT.
   *
   * The first exception written for this mode read
   * `!Object.keys(pages).length` and left the shape check above it alone, on
   * the assumption that an empty `pages` object would arrive. Nothing posts
   * one: the wizard names its service rows `pages[0][filename]`, so with no
   * rows there are no such fields and Express never creates the key.
   * `req.body.pages` is `undefined`, and `!pages` rejected it with "No pages
   * submitted" before the exception was reached — on a review step that had
   * just priced the site at 800 credits.
   *
   * Normalised once in the route rather than guarded at each use, because
   * validateEachPageInputs() refuses `undefined` with the SAME message and
   * would have been the next wall. */
  assert.match(GENERATE_ROUTE, /if \(pages === undefined && siteMode === MODES\.LOCAL_OPTIONS\) \{\s*\n\s*pages = \{\};/,
    'an absent pages object is no longer normalised for this mode');

  /* `let`, not `const` — the normalisation assigns to it. */
  assert.match(GENERATE_ROUTE, /let pages = req\.body\.pages;/,
    'pages is const again, so the normalisation cannot assign');
});

test('and everything downstream accepts the empty object', () => {
  /* The normalisation is only worth anything if the four readers after it
   * agree. This is the half that cannot be read off the source. */
  const { validateEachPageInputs, checkCredits } = require('./utils/helpers');

  assert.strictEqual(validateEachPageInputs({}).ok, true,
    'the page validator refuses a build with no service rows');

  /* AND IT REFUSES undefined WITH THE SAME MESSAGE, which is exactly why
   * normalising beats adding a second mode check here. */
  assert.strictEqual(validateEachPageInputs(undefined).ok, false);

  const credit = checkCredits({ credits: 9999 }, {}, { siteMode: 'localoptions' });

  assert.strictEqual(credit.ok, true, 'no service rows reads as "cannot afford it"');
  assert.strictEqual(credit.totalCost,
    PRICING.LEAD_BASE + (LOCAL_OPTIONS_SERVICE_PAGES * PRICING.SERVICE_PAGE));

  assert.strictEqual(pagesToBuild(MODES.LOCAL_OPTIONS, {}, 0), TOTAL_PAGES);
});

test('the build guard asks about site jobs, not about every job', () => {
  const query = activeJobQuery(GENERATE_ROUTE, 'the generate route');

  assert.ok(/kind/.test(query),
    'a running blog campaign refuses every website build on the account');

  /* 'site' AND 'build', NOT 'blog'. The rule is not "one job at a time", it
   * is "one job at a time that touches dist/user_<id>" — a site build wipes
   * that folder and a production zip reads it, so those two must not
   * overlap. A campaign writes to Mongo and Cloudflare and never opens it.
   *
   * ASSERTED ON THE NAMED CONSTANT, which is outside the query object: the
   * list is the decision and the query is only where it is applied. */
  assert.match(GENERATE_ROUTE, /const DIST_KINDS = \['site', 'build'\]/,
    'the kinds that share a build folder have changed');

  assert.ok(/DIST_KINDS/.test(query), 'the guard no longer applies that list');
  assert.ok(!/'blog'/.test(GENERATE_ROUTE.slice(
    GENERATE_ROUTE.indexOf('const DIST_KINDS'),
    GENERATE_ROUTE.indexOf('}).lean()', GENERATE_ROUTE.indexOf('const DIST_KINDS'))
  )), 'a blog campaign is back in the guard');

  /* Rows written before `kind` existed are site builds, and must still
   * block — utils/jobRunner.js's claimNextJob() treats them the same way. */
  assert.ok(/\$exists: false/.test(query),
    'a job queued before `kind` existed no longer blocks a second build');
});

test('and the dashboard card does the same', () => {
  /* The other end of the same omission. This query's answer goes to
   * siteCardState(), which reads it as "a website is being built right now";
   * unfiltered, the dashboard reported a WEBSITE in progress for as long as
   * a campaign ran. */
  const query = activeJobQuery(AUTH_ROUTE, 'the dashboard');

  assert.ok(/kind: 'site'/.test(query),
    'the dashboard shows the building card while a blog campaign runs');
  assert.ok(!/'blog'/.test(query));
  assert.ok(/\$exists: false/.test(query));
});

test('the two agree about what counts as a site build', () => {
  /* They answer different questions — one refuses, one reports — and they
   * must not disagree about which jobs are site builds, or the dashboard
   * will show a build the form would refuse to start. */
  for (const [src, label] of [[GENERATE_ROUTE, 'generate'], [AUTH_ROUTE, 'dashboard']]) {
    const query = activeJobQuery(src, label);
    assert.ok(/kind/.test(query), `${label} does not filter by kind`);
    assert.ok(/\$exists: false/.test(query), `${label} drops pre-kind rows`);
    assert.ok(!/'blog'/.test(query), `${label} counts a campaign as a site build`);
  }
});

/* =========================================================================
 * jobGenerator — which builder a job gets
 * ====================================================================== */

/* READ AS SOURCE, NOT REQUIRED, AND THAT IS NOT LAZINESS.
 *
 * jobGenerator requires runGeneration, which pulls in the whole generator
 * tree — and utils/openaiClient.js in it constructs an OpenAI client at
 * module load, so `require('./utils/jobGenerator')` THROWS "Missing
 * credentials" on any machine without OPENAI_API_KEY set. That is why no
 * suite in this repo requires runGeneration today.
 *
 * A test that needs a live API key in the environment to answer an
 * eight-line question is a test that gets skipped. test-wizard-steps.js
 * already reads the browser file this way for the same kind of reason.
 *
 * WHAT IS LOST BY NOT REQUIRING IT: this cannot prove the two names resolve
 * to the actual exported functions, only that the branch is written the way
 * it is meant to be. The identity is covered by the fact that both modules
 * are required at the top of that file and node would throw at load if
 * either export were missing. */
const JOB_GENERATOR = fs.readFileSync(path.join(__dirname, 'utils/jobGenerator.js'), 'utf8');

/** builderFor(), isolated from the file around it. */
function builderForSource() {
  const at = JOB_GENERATOR.indexOf('function builderFor(');
  assert.notStrictEqual(at, -1, 'builderFor() has been renamed or removed');
  return JOB_GENERATOR.slice(at, JOB_GENERATOR.indexOf('\n}', at));
}

test('only a localoptions job gets the local builder', () => {
  const body = builderForSource();

  assert.ok(/MODES\.LOCAL_OPTIONS/.test(body), 'the branch does not name the mode');
  assert.ok(/runLocalOptions/.test(body) && /runGeneration/.test(body),
    'one of the two builders is unreachable');

  /* THE FALLBACK IS THE OLD BUILDER, NOT AN ERROR. normalizeSiteMode()
   * returns 'lead' for anything it does not recognise, including a job row
   * written before the field existed — and every one of those is a site
   * build that must keep building the way it always did. */
  assert.ok(/\? \{ siteMode, build: runLocalOptions \}/.test(body)
    && /: \{ siteMode, build: runGeneration \}/.test(body),
    'the default is no longer runGeneration');

  assert.ok(/normalizeSiteMode\(/.test(body),
    'an unrecognised mode is no longer normalised, so it can reach neither builder');
});

test('the mode is read out of the payload, not off the siteMode column', () => {
  /* Both are written by the route and they agree. The payload is what the
   * builders themselves read, and runGeneration resolves it again on its
   * own — so taking the decision from the same place is what keeps the two
   * from disagreeing about one job. The column exists so lists and support
   * queries can filter without opening the payload. */
  const body = builderForSource();

  assert.ok(/job\.payload\?\.global\?\.siteMode/.test(body),
    'the mode is not read out of the payload');
  assert.ok(/job\.payload\?\.\['global\[siteMode\]'\]/.test(body),
    'the flat body-parser spelling is not handled');
  assert.ok(!/job\.siteMode/.test(body),
    'the decision reads the column, which the builders do not');
});

test('both builders are required at the top, so a rename fails at load', () => {
  /* The assertions above are about source text. This is what makes them
   * worth anything: if either export disappeared, requiring this file would
   * throw rather than quietly choosing undefined. */
  assert.ok(/require\('\.\/runGeneration'\)/.test(JOB_GENERATOR));
  assert.ok(/require\('\.\/runLocalOptions'\)/.test(JOB_GENERATOR));
  assert.ok(/const \{ runLocalOptions \} =/.test(JOB_GENERATOR));
});

test('and the chosen builder is the one that is actually called', () => {
  /* builderFor() returning the right function is useless if generateForJob
   * still calls runGeneration by name. That was the shape of this file for
   * its whole life before 28 October, so it is the mistake most likely to
   * come back. */
  assert.ok(/const \{ siteMode, build \} = builderFor\(job\);/.test(JOB_GENERATOR));
  assert.ok(/await build\(\{/.test(JOB_GENERATOR), 'the builder is chosen and not used');
  assert.ok(!/await runGeneration\(\{/.test(JOB_GENERATOR),
    'runGeneration is still called directly, so every job gets it');
});

/* =========================================================================
 * runLocalOptions — the build, with the model injected
 * ====================================================================== */

asyncTest('it refuses a mode that is not its own', async () => {
  /* Nothing routes a job here except jobGenerator’s check on the same
   * value, so reaching this means the two disagree — and building eleven
   * pages for somebody who paid for a hundred is hard to undo. */
  await assert.rejects(
    () => runLocalOptions({
      body: { global: goodGlobal({ siteMode: 'lead' }), pages: sixPages() },
      user: fakeUser(),
      baseDir: tmpdir('wrongmode'),
    }),
    /siteMode is 'lead'/
  );
});

asyncTest('a build that fails leaves the previous site standing', async () => {
  /* THE ORDERING IS THE POINT, AND IT MOVED ON 28 OCTOBER.
   *
   * resetUserDirs() used to run before the model calls. That was defensible
   * while the six service names came off the form — the count was checked
   * first, so the only thing that could fail late was a model error. With
   * the names coming from utils/suggestServices.js, the suggester can come
   * back short, three minutes of writing can time out, and a hero folder can
   * be missing: all after the old site was already gone, and this mode has
   * no resume to get it back.
   *
   * So the wipe waits until all nineteen files are in hand. A failure
   * anywhere in the generate call leaves the customer with the site they
   * had. */
  const baseDir = tmpdir('survives');
  const user = fakeUser();
  const previous = path.join(baseDir, `user_${user._id.toString()}`);

  fs.mkdirSync(previous, { recursive: true });
  fs.writeFileSync(path.join(previous, 'index.html'), 'the site they already had');

  await assert.rejects(
    () => runLocalOptions({
      body: { global: goodGlobal(), pages: {} },
      user,
      baseDir,
      generate: async () => { throw new Error('the model gave up'); },
    }),
    /the model gave up/
  );

  assert.strictEqual(
    fs.readFileSync(path.join(previous, 'index.html'), 'utf8'),
    'the site they already had',
    'a failed build destroyed the site the customer still had'
  );

  assert.strictEqual(user.saves, 0, 'credits were charged for a build that failed');
});

asyncTest('and a build that succeeds wipes it', async () => {
  /* The other half. The folder holds one site per user, so last build wins —
   * leaving stale pages behind would publish a site that is half old. */
  const baseDir = tmpdir('wipes');
  const user = fakeUser();
  const previous = path.join(baseDir, `user_${user._id.toString()}`);

  fs.mkdirSync(previous, { recursive: true });
  fs.writeFileSync(path.join(previous, 'stale.html'), 'from the last build');

  const stub = fakeGenerate();

  await runLocalOptions({
    body: { global: goodGlobal(), pages: {} },
    user,
    baseDir,
    generate: stub.generate,
  });

  assert.ok(!fs.existsSync(path.join(previous, 'stale.html')),
    'the previous build is still there beside the new one');
  assert.ok(fs.existsSync(path.join(previous, 'index.html')));
});

asyncTest('with no services submitted the model names them', async () => {
  /* There is no service-pages step in this wizard. `pages` arrives empty and
   * that is the correct submission, so serviceNames must be null — NOT an
   * empty array, which is truthy and would make generate.js skip the
   * suggester and then throw "expected 6 services, got 0". */
  const stub = fakeGenerate();

  await runLocalOptions({
    body: { global: goodGlobal(), pages: {} },
    user: fakeUser(),
    baseDir: tmpdir('suggest'),
    generate: stub.generate,
  });

  assert.strictEqual(stub.seen.args.serviceNames, null);
});

asyncTest('but a job queued before the step was removed still uses its rows', async () => {
  /* Honoured rather than ignored: an old queued job carries its six, and so
   * does any caller that supplies them. It also saves a model call. */
  const stub = fakeGenerate();

  await runLocalOptions({
    body: { global: goodGlobal(), pages: sixPages() },
    user: fakeUser(),
    baseDir: tmpdir('supplied'),
    generate: stub.generate,
  });

  assert.strictEqual(stub.seen.args.serviceNames.length, LOCAL_OPTIONS_SERVICE_PAGES);
  assert.strictEqual(stub.seen.args.serviceNames[0], 'Water Heater Repair');
});

asyncTest('the logo is named before the build and copied after the wipe', async () => {
  /* The renderer needs the path during generation; the bytes must not land
   * in the build folder until resetUserDirs() has emptied it, or the wipe
   * deletes the logo that was just put there. Two moments, one filename. */
  const baseDir = tmpdir('logo');
  const upload = path.join(tmpdir('upload'), 'acme.png');
  fs.writeFileSync(upload, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const stub = fakeGenerate();

  const out = await runLocalOptions({
    body: { global: goodGlobal(), pages: {} },
    user: fakeUser(),
    baseDir,
    files: [{ fieldname: 'global[logo]', path: upload, originalname: 'acme.png', mimetype: 'image/png' }],
    generate: stub.generate,
  });

  assert.strictEqual(stub.seen.args.logo, 'assets/logo.png',
    'the header was given a different path from the file on disk');

  assert.ok(fs.existsSync(path.join(out.distDir, 'assets', 'logo.png')),
    'the logo was wiped by the reset that followed it');
});

asyncTest('it hands the renderer the address in parts', async () => {
  const baseDir = tmpdir('parts');
  const stub = fakeGenerate();

  await runLocalOptions({
    body: { global: goodGlobal(), pages: sixPages() },
    user: fakeUser(),
    baseDir,
    generate: stub.generate,
  });

  const { business, url } = stub.seen.args;

  assert.strictEqual(business.street, '1804 S Bagdad Rd, Suite 120');
  assert.strictEqual(business.city, 'Leander');
  assert.strictEqual(business.state, 'TX');
  assert.strictEqual(business.zip, '78641');
  assert.strictEqual(business.trade, 'plumbing');

  /* NO TRAILING SLASH. Every canonical, the sitemap and the schema @id are
   * built by appending to this. */
  assert.strictEqual(url, 'https://leanderplumbing.com');
});

asyncTest('the six service names come off the form, in order', async () => {
  const baseDir = tmpdir('names');
  const stub = fakeGenerate();

  await runLocalOptions({
    body: { global: goodGlobal(), pages: sixPages() },
    user: fakeUser(),
    baseDir,
    generate: stub.generate,
  });

  assert.deepStrictEqual(stub.seen.args.serviceNames, [
    'Water Heater Repair', 'Drain Cleaning', 'Leak Detection',
    'Toilet Repair', 'Sewer Line Repair', 'Whole House Repiping',
  ]);

  /* suggestServices IS NOT CALLED when the names are supplied, which is the
   * difference between seven model calls and eight. */
  assert.ok(stub.seen.args.serviceNames.length === LOCAL_OPTIONS_SERVICE_PAGES);
});

asyncTest('the progress bar moves once per written page', async () => {
  /* Seven of the eleven are model calls, about 170 seconds together. Without
   * this the job page shows "starting" and then "completed", and a customer
   * watching an unmoving bar assumes it has hung. */
  const baseDir = tmpdir('progress');
  const stub = fakeGenerate();
  const seen = [];

  await runLocalOptions({
    body: { global: goodGlobal(), pages: sixPages() },
    user: fakeUser(),
    baseDir,
    generate: stub.generate,
    onProgress: async (p) => { seen.push(p); },
  });

  const counted = seen.filter(p => typeof p.done === 'number').map(p => p.done);

  assert.deepStrictEqual(counted.slice(0, 8), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.strictEqual(counted[counted.length - 1], TOTAL_PAGES);

  assert.ok(seen.every(p => p.total === undefined || p.total === TOTAL_PAGES),
    'the bar reports a total that disagrees with the Job record');

  /* The pages are recorded as they complete, the same field runGeneration
   * writes, so the job page lists them. */
  assert.ok(seen.some(p => p.completedPage === 'Home page'));
});

asyncTest('the words are stored beside the pages they became', async () => {
  /* Seven model calls, three minutes and 800 credits. Before this they
   * survived only inside the finished HTML, so a template fix meant buying
   * the prose again — the relative-paths change cost exactly that. */
  const baseDir = tmpdir('source');
  const stub = fakeGenerate();

  const out = await runLocalOptions({
    body: { global: goodGlobal(), pages: {} },
    user: fakeUser(),
    baseDir,
    generate: stub.generate,
  });

  const file = path.join(out.distDir, SOURCE_PATH);
  assert.ok(fs.existsSync(file), `${SOURCE_PATH} was not written`);

  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));

  assert.strictEqual(stored.mode, 'localoptions');
  assert.strictEqual(stored.version, 1);

  /* `now` AS A STRING, because JSON has no Date. Asserted because the
   * re-render has to revive it, and a caller who forgot would get a
   * different footer year and sitemap lastmod rather than an error. */
  assert.strictEqual(typeof stored.now, 'string');
  assert.ok(!Number.isNaN(Date.parse(stored.now)));
});

asyncTest('and NOT to content.json, which belongs to the WordPress exporter', () => {
  /* utils/contentModel.js owns that filename and the theme builder reads
   * it. A second shape at the same path would be a file that lies about
   * what it describes — the note at the top of runLocalOptions says so. */
  assert.strictEqual(SOURCE_PATH, '_src/localoptions.json');
  assert.ok(!SOURCE_PATH.includes('content.json'));
});

asyncTest('a build whose generator returns no source still succeeds', async () => {
  /* An injected generator in a suite, or an older caller. Failing a paid
   * build over a convenience file would be the wrong trade — it simply
   * cannot be re-rendered. */
  const baseDir = tmpdir('nosource');

  const out = await runLocalOptions({
    body: { global: goodGlobal(), pages: {} },
    user: fakeUser(),
    baseDir,
    generate: async (args) => {
      for (let i = 0; i < LOCAL_OPTIONS_SERVICE_PAGES; i += 1) {
        await args.onPage({ kind: 'service', name: `s${i}` });
      }
      await args.onPage({ kind: 'home', name: 'Home page' });

      return {
        files: { 'index.html': '<p>home</p>' },
        services: [], heroes: { found: [], missing: [] }, usage: { calls: 7 },
      };
    },
  });

  assert.ok(fs.existsSync(path.join(out.distDir, 'index.html')));
  assert.ok(!fs.existsSync(path.join(out.distDir, SOURCE_PATH)));
});

asyncTest('every file lands on disk, nested paths and all', async () => {
  const baseDir = tmpdir('write');
  const user = fakeUser();

  const stub = fakeGenerate({
    'index.html': '<p>home</p>',
    'services/drain-cleaning/index.html': '<p>drains</p>',
    'assets/site.css': 'body{}',
    'assets/hero-1.webp': Buffer.from([0x52, 0x49, 0x46, 0x46]),
    'sitemap.xml': '<urlset/>',
  });

  const out = await runLocalOptions({
    body: { global: goodGlobal(), pages: sixPages() },
    user,
    baseDir,
    generate: stub.generate,
  });

  const read = rel => fs.readFileSync(path.join(out.distDir, rel));

  assert.strictEqual(read('index.html').toString(), '<p>home</p>');
  assert.strictEqual(read('services/drain-cleaning/index.html').toString(), '<p>drains</p>');

  /* A Buffer and a string go through the same writeFile, which is why the
   * photographs and the pages can travel in one map to one deploy. */
  assert.deepStrictEqual([...read('assets/hero-1.webp')], [0x52, 0x49, 0x46, 0x46]);
});

asyncTest('credits are charged once, after the build succeeded', async () => {
  const baseDir = tmpdir('charge');
  const user = fakeUser(5000);
  const stub = fakeGenerate();

  const out = await runLocalOptions({
    body: { global: goodGlobal(), pages: sixPages() },
    user,
    baseDir,
    generate: stub.generate,
  });

  const expected = PRICING.LEAD_BASE + (LOCAL_OPTIONS_SERVICE_PAGES * PRICING.SERVICE_PAGE);

  assert.strictEqual(out.creditsCharged, expected);
  assert.strictEqual(out.creditsRemaining, 5000 - expected);
  assert.strictEqual(user.saves, 1, 'the user was saved more than once');
  assert.ok(out.buildId, '/export-wp cannot see this build');
});

asyncTest('a build nobody can afford is refused before anything is written', async () => {
  const baseDir = tmpdir('poor');
  const user = fakeUser(100);
  const stub = fakeGenerate();

  await assert.rejects(
    () => runLocalOptions({
      body: { global: goodGlobal(), pages: sixPages() },
      user,
      baseDir,
      generate: stub.generate,
    }),
    /Not enough credits/
  );

  assert.strictEqual(stub.seen.calls, 0, 'the model was called for a build that was refused');
  assert.strictEqual(user.saves, 0);
});

asyncTest('writeFiles creates the directories it needs', async () => {
  /* Called directly as well as through the build, because the nested-path
   * case is the one that fails on a fresh folder and the one a flat fixture
   * would never reach. */
  const dir = tmpdir('mkdir');

  const count = await writeFiles(dir, {
    'a/b/c/deep.html': 'deep',
    'top.txt': 'top',
  });

  assert.strictEqual(count, 2);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'a/b/c/deep.html'), 'utf8'), 'deep');
});

/* ======================================================================= */

/**
 * A stubbed publish, recording what it was asked to do.
 *
 * THE REAL ONE MAKES SIX CALLS TO github.com AND CREATES A REPOSITORY. A
 * suite that could not replace it would need credentials to run, and would
 * leave repositories behind on somebody's account every time it did.
 */
function fakePublish({ fail = null } = {}) {
  const seen = { calls: 0, args: null };

  const publish = async (args) => {
    seen.calls += 1;
    seen.args = args;

    if (fail) throw new Error(fail);

    return {
      owner: 'acme',
      repo: 'leander-plumbing-gomanzo',
      created: true,
      repoUrl: 'https://github.com/acme/leander-plumbing-gomanzo',
      pagesUrl: 'https://acme.github.io/leander-plumbing-gomanzo/',
      commitSha: 'commit-1',
      unchanged: false,
      uploaded: 19,
      reused: 0,
      pages: { ok: true, already: false, error: '' },
    };
  };

  return { publish, seen };
}

const withGithub = (credits = 5000) =>
  Object.assign(fakeUser(credits), { githubInstallationId: '176399104' });

asyncTest('A BUILD PUBLISHES ITSELF, WITH NOBODY PRESSING ANYTHING', async () => {
  /* Edwin, 29 October: "if the user click generate site he can go away to
   * do something else and know that his site will be pushed automatically."
   * So there is no Publish button for this mode, and no site sitting in a
   * folder waiting for somebody to remember it. */
  const baseDir = tmpdir('publish');
  const stub = fakeGenerate();
  const pub = fakePublish();

  const out = await runLocalOptions({
    body: { global: goodGlobal(), pages: sixPages() },
    user: withGithub(),
    baseDir,
    generate: stub.generate,
    publish: pub.publish,
  });

  assert.strictEqual(pub.seen.calls, 1, 'the site was not published');
  assert.strictEqual(pub.seen.args.installationId, '176399104');
  assert.strictEqual(out.published.pagesUrl, 'https://acme.github.io/leander-plumbing-gomanzo/');
});

asyncTest('and the stored words go up with the pages', async () => {
  /* _src/localoptions.json is what makes a later template fix free. The
   * folder on the server is wiped by the next build; the copy in the
   * repository is not — which is the whole reason a customer can have more
   * than one site now. */
  const baseDir = tmpdir('publish-src');
  const stub = fakeGenerate();
  const pub = fakePublish();

  await runLocalOptions({
    body: { global: goodGlobal(), pages: sixPages() },
    user: withGithub(),
    baseDir,
    generate: stub.generate,
    publish: pub.publish,
  });

  assert.ok(pub.seen.args.files[SOURCE_PATH],
    'the site was published without the words it was built from');
});

asyncTest('AN ACCOUNT WITH NO GITHUB STILL BUILDS AND STILL CHARGES', async () => {
  /* Every account that existed before this shipped has no installation.
   * Treating that as an error would have broken all of them on the day it
   * went out. */
  const baseDir = tmpdir('no-github');
  const stub = fakeGenerate();
  const pub = fakePublish();

  const out = await runLocalOptions({
    body: { global: goodGlobal(), pages: sixPages() },
    user: fakeUser(),
    baseDir,
    generate: stub.generate,
    publish: pub.publish,
  });

  assert.strictEqual(pub.seen.calls, 0, 'it published without an installation');
  assert.strictEqual(out.published, null);

  assert.ok(out.creditsCharged > 0, 'the build was not charged for');
  assert.ok(fs.existsSync(path.join(out.distDir, 'index.html')), 'the site was not written');
});

asyncTest('A PUSH THAT FAILS DOES NOT UNDO A BUILD THAT WORKED', async () => {
  /* By the time this runs the seven model calls have happened, the pages
   * are on disk and the customer has been charged — Edwin chose that
   * ordering. A job reporting FAILED here would be describing a site the
   * customer can open. */
  const baseDir = tmpdir('push-fails');
  const stub = fakeGenerate();
  const pub = fakePublish({ fail: 'GitHub: Server Error' });

  const out = await runLocalOptions({
    body: { global: goodGlobal(), pages: sixPages() },
    user: withGithub(),
    baseDir,
    generate: stub.generate,
    publish: pub.publish,
  });

  assert.ok(out.creditsCharged > 0, 'the writing was not charged for');
  assert.ok(fs.existsSync(path.join(out.distDir, 'index.html')), 'the pages were lost');

  /* AND IT SAYS SO. The three states — never set up, tried and failed, live
   * — have to stay tellable apart, or the screen cannot say which one the
   * customer is looking at. */
  assert.strictEqual(out.published.ok, false);
  assert.match(out.published.error, /Server Error/);
});

asyncTest('THE LOGO GOES UP WITH THE SITE, THOUGH IT NEVER TOUCHES THE FILE MAP', async () => {
  /* THE BUG THE FIRST AUTOMATIC PUBLISH SHIPPED. The job held a `files` map,
   * wrote it to disk and published the MAP — but placeLogo() copies the
   * customer's logo straight into assetsDir without it ever passing through
   * that map. So the repository got eleven pages and an <img> pointing at a
   * logo nobody had uploaded, and the site rendered with alt text where the
   * header should be.
   *
   * The bench tool had been right the whole time: it reads the FOLDER, which
   * is why the manual push carried the logo and the automatic one did not.
   *
   * ASSERTED ON WHAT WAS PUBLISHED, NOT ON WHAT IS ON DISK. The folder was
   * always correct; it is the published set that was short. */
  const baseDir = tmpdir('logo-publish');

  const upload = path.join(tmpdir('logo-upload'), 'acme.png');
  fs.writeFileSync(upload, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));

  const stub = fakeGenerate();
  const pub = fakePublish();

  await runLocalOptions({
    body: { global: goodGlobal(), pages: sixPages() },
    user: withGithub(),
    baseDir,
    files: [{ fieldname: 'global[logo]', path: upload, originalname: 'acme.png', mimetype: 'image/png' }],
    generate: stub.generate,
    publish: pub.publish,
  });

  assert.ok(pub.seen.args.files['assets/logo.png'],
    'the site was published without the logo its pages point at');

  /* AND AS BYTES. A picture read as utf-8 arrives a valid file that is no
   * longer an image — commit.js decides base64 from the Buffer. */
  assert.ok(Buffer.isBuffer(pub.seen.args.files['assets/logo.png']));
});

asyncTest('and everything else on disk goes with it', async () => {
  /* The folder is the one description of the site now: what the customer
   * downloads, what the re-render tool reads, what GitHub gets. */
  const baseDir = tmpdir('whole-folder');
  const pub = fakePublish();

  const out = await runLocalOptions({
    body: { global: goodGlobal(), pages: sixPages() },
    user: withGithub(),
    baseDir,
    generate: fakeGenerate({ 'index.html': '<p>home</p>', 'deep/page/index.html': '<p>deep</p>' }).generate,
    publish: pub.publish,
  });

  assert.ok(pub.seen.args.files['index.html']);
  assert.ok(pub.seen.args.files['deep/page/index.html'], 'a nested page was not published');
  assert.ok(pub.seen.args.files[SOURCE_PATH], 'the stored words were not published');

  assert.ok(fs.existsSync(path.join(out.distDir, 'deep/page/index.html')));
});

asyncTest('THE PASTED SEARCH CONSOLE TAG REACHES THE RENDERER AS A TOKEN', async () => {
  /* What is on the clipboard is a whole <meta> element. What may go into an
   * attribute on a public page is a token and nothing else — see the header
   * of utils/blog/verificationTags.js, which is the one place in the app
   * that says what a verification token is. */
  const baseDir = tmpdir('search-console');
  const stub = fakeGenerate();

  await runLocalOptions({
    body: {
      global: goodGlobal({
        searchConsole: '<meta name="google-site-verification" content="dK3xP9mQ2vR7nL4tY8wZ" />',
      }),
      pages: sixPages(),
    },
    user: fakeUser(),
    baseDir,
    generate: stub.generate,
  });

  assert.deepStrictEqual(stub.seen.args.verification, ['dK3xP9mQ2vR7nL4tY8wZ']);
});

asyncTest('and a blank field is an empty list, not an empty tag', async () => {
  /* Most builds leave it blank — Google hands the tag over when the client
   * creates the property, which is after their site exists. */
  const baseDir = tmpdir('no-console');
  const stub = fakeGenerate();

  await runLocalOptions({
    body: { global: goodGlobal(), pages: sixPages() },
    user: fakeUser(),
    baseDir,
    generate: stub.generate,
  });

  assert.deepStrictEqual(stub.seen.args.verification, []);
});

asyncTest('something that is not a verification tag is dropped, not rendered', async () => {
  /* A description meta pasted into the wrong box would otherwise put a
   * sentence of prose on every page as a verification token. */
  const baseDir = tmpdir('wrong-tag');
  const stub = fakeGenerate();

  await runLocalOptions({
    body: {
      global: goodGlobal({
        searchConsole: '<meta name="description" content="A plumber in Leander">',
      }),
      pages: sixPages(),
    },
    user: fakeUser(),
    baseDir,
    generate: stub.generate,
  });

  assert.deepStrictEqual(stub.seen.args.verification, []);
});

/**
 * The ownership record, stubbed through ctx so no test reaches Mongo.
 */
function fakeSites() {
  const seen = { calls: 0, where: null, update: null, options: null };

  return {
    seen,
    GeneratedSite: {
      updateOne: async (where, update, options) => {
        seen.calls += 1;
        seen.where = where;
        seen.update = update;
        seen.options = options;
        return { upsertedCount: 1 };
      },
    },
  };
}

asyncTest('A PUBLISHED SITE IS RECORDED AGAINST THE LOGIN THAT BUILT IT', async () => {
  /* Edwin, 29 October: "every owner of the site and only the owner of the
   * site will be able to edit the site nobody else." Nothing in the app
   * could answer that — the folder is wiped by the next build and the
   * repository knows a GitHub account, not a login. */
  const baseDir = tmpdir('site-record');
  const pub = fakePublish();
  const sites = fakeSites();
  const pool = fakePool(POOL_ROW);
  const user = withGithub();

  await runLocalOptions({
    body: { global: { ...goodGlobal(), domainId: 'dom-acme' }, pages: sixPages() },
    user,
    baseDir,
    generate: fakeGenerate().generate,
    publish: pub.publish,
    Domain: pool.Domain,
    GeneratedSite: sites.GeneratedSite,
  });

  assert.strictEqual(sites.seen.calls, 1, 'nothing was recorded');

  const set = sites.seen.update.$set;

  assert.strictEqual(String(set.user), String(user._id));
  assert.strictEqual(set.repo, 'leander-plumbing-gomanzo');
  assert.strictEqual(set.owner, 'acme');
  assert.strictEqual(set.domainName, 'acme.com');
  assert.strictEqual(set.businessName, 'Leander Plumbing Gomanzo');
  assert.ok(set.publishedAt instanceof Date);
});

asyncTest('and it follows the site rather than making a second row', async () => {
  /* Building the same business again pushes to the same repository, so the
   * record has to follow it. The pair that identifies a site is the account
   * and the repository — not the user, because two customers can each have
   * a plumbing site of the same name on different accounts. */
  const baseDir = tmpdir('site-record-again');
  const sites = fakeSites();

  await runLocalOptions({
    body: { global: { ...goodGlobal(), domainId: 'dom-acme' }, pages: sixPages() },
    user: withGithub(),
    baseDir,
    generate: fakeGenerate().generate,
    publish: fakePublish().publish,
    Domain: fakePool(POOL_ROW).Domain,
    GeneratedSite: sites.GeneratedSite,
  });

  assert.deepStrictEqual(sites.seen.where, { owner: 'acme', repo: 'leander-plumbing-gomanzo' });
  assert.strictEqual(sites.seen.options.upsert, true);
});

asyncTest('A PUSH THAT FAILED RECORDS NOTHING', async () => {
  /* A row claiming a site that is not on the internet puts a line in
   * somebody's list pointing at a 404 — and the editor loads a site's words
   * FROM its repository, so a row with no repository behind it is a dead
   * end. */
  const baseDir = tmpdir('record-nothing');
  const sites = fakeSites();

  const out = await runLocalOptions({
    body: { global: { ...goodGlobal(), domainId: 'dom-acme' }, pages: sixPages() },
    user: withGithub(),
    baseDir,
    generate: fakeGenerate().generate,
    publish: fakePublish({ fail: 'GitHub: Server Error' }).publish,
    Domain: fakePool(POOL_ROW).Domain,
    GeneratedSite: sites.GeneratedSite,
  });

  assert.strictEqual(sites.seen.calls, 0, 'it recorded a site that is not live');
  assert.strictEqual(out.published.ok, false);
});

asyncTest('and losing the record does not fail a build that is already live', async () => {
  /* The site is written, paid for and on the internet by this point.
   * Losing the pointer is a thing to fix, not a reason to tell a customer
   * their build failed. */
  const baseDir = tmpdir('record-throws');

  const out = await runLocalOptions({
    body: { global: { ...goodGlobal(), domainId: 'dom-acme' }, pages: sixPages() },
    user: withGithub(),
    baseDir,
    generate: fakeGenerate().generate,
    publish: fakePublish().publish,
    Domain: fakePool(POOL_ROW).Domain,
    GeneratedSite: { updateOne: async () => { throw new Error('mongo is down'); } },
  });

  assert.ok(out.published.commitSha, 'the publish was thrown away over a pointer');
  assert.ok(out.creditsCharged > 0);
});

asyncTest('the repository is named from the business, not from the account', async () => {
  /* The repository name IS the site's identity: build the same business
   * twice and it updates one site. Naming it after the account would give a
   * customer one repository and therefore one site, which is the problem
   * this design exists to end. */
  const baseDir = tmpdir('repo-name');
  const stub = fakeGenerate();
  const pub = fakePublish();

  await runLocalOptions({
    body: { global: goodGlobal(), pages: sixPages() },
    user: withGithub(),
    baseDir,
    generate: stub.generate,
    publish: pub.publish,
  });

  assert.strictEqual(pub.seen.args.businessName, 'Leander Plumbing Gomanzo');
});

/* =======================================================================
 * The domain the customer PICKED
 * ==================================================================== */

test('THE REQUIRED-FIELD LIST KNOWS WHICH DOMAIN FIELD THIS MODE USES', () => {
  /* THE BUG THAT STOPPED THE FIRST BUILD THROUGH THE NEW FORM. The picker
   * worked, the choice was stored, and the server refused with "Missing
   * required global fields" — naming no field, because the field it wanted
   * was one this mode no longer renders.
   *
   * A required-field list that does not know the mode asks for a box that
   * is not on the screen. */
  const { validateGlobalFields } = require('./utils/helpers');

  /* THE SUITE'S OWN GOOD GLOBAL, so the only thing under test here is the
   * domain. `address` and `location` are composed by the route out of the
   * four typed boxes before this ever runs, which is why they are added
   * rather than present on the form. */
  const base = goodGlobal({
    address: '1804 S Bagdad Rd, Leander, TX 78641',
    location: 'Leander, TX',
    domain: '',
  });

  const picked = validateGlobalFields({
    ...base,
    domainId: '68f3a1c4b2000000000000aa',
  });

  assert.strictEqual(picked.ok, true,
    'a picked domain was refused: ' + JSON.stringify(picked.fields || []));
});

test('AND THE MODE IS TAKEN FROM THE CALLER WHEN THE BODY DOES NOT CARRY IT', () => {
  /* THE SAME BUG, TWICE, ON ONE LINE. The first fix read `global.siteMode`
   * — and generateRoute.js resolves the mode as
   *
   *     req.body.global?.siteMode ?? req.body['global[siteMode]']
   *
   * because the form arrives in two shapes. In the bracketed shape there is
   * no `global.siteMode` at all, so this read as "not that mode" and the
   * build was refused exactly as before the fix.
   *
   * The route had already worked the answer out. Asking again, somewhere
   * with less information, was the mistake. */
  const { validateGlobalFields } = require('./utils/helpers');

  const noMode = goodGlobal({
    address: '1804 S Bagdad Rd, Leander, TX 78641',
    location: 'Leander, TX',
    domain: '',
    domainId: '68f3a1c4b2000000000000aa',
  });

  delete noMode.siteMode;

  assert.strictEqual(validateGlobalFields(noMode).ok, false,
    'with no mode anywhere it should fall back to requiring a typed domain');

  assert.strictEqual(validateGlobalFields(noMode, { siteMode: 'localoptions' }).ok, true,
    'the mode the caller passed was ignored');
});

test('and a mode that types one still has to type one', () => {
  const { validateGlobalFields } = require('./utils/helpers');

  const typed = validateGlobalFields(goodGlobal({
    address: '1804 S Bagdad Rd, Leander, TX 78641',
    location: 'Leander, TX',
    domain: '',
    siteMode: 'lead',
  }));

  assert.strictEqual(typed.ok, false);
  assert.ok(typed.fields.some(f => 'global[domain]' === f.name),
    'the typed domain stopped being required for every other mode');
});

test('A PICKED MODE WITH NOTHING PICKED IS STILL REFUSED, BY NAME', () => {
  /* The point of the list is the red outline. Refusing without naming the
   * field leaves a customer looking at a form with nothing marked. */
  const { validateGlobalFields } = require('./utils/helpers');

  const out = validateGlobalFields(goodGlobal({
    address: '1804 S Bagdad Rd, Leander, TX 78641',
    location: 'Leander, TX',
    domain: '',
  }));

  assert.strictEqual(out.ok, false);
  assert.ok(out.fields.some(f => 'global[domainId]' === f.name),
    'it refused without saying which field');
});

/* ======================================================================= */

/**
 * The domain pool, as one row of it.
 *
 * STUBBED THROUGH ctx RATHER THAN THE REQUIRE CACHE, so a test that forgot
 * cannot reach Mongo and quietly pass against an empty collection.
 */
function fakePool(row) {
  const seen = { query: null };

  return {
    seen,
    Domain: {
      findOne: (query) => {
        seen.query = query;
        const chain = { select: () => chain, lean: async () => row || null };
        return chain;
      },
    },
  };
}

const POOL_ROW = {
  _id: 'dom-acme',
  domain: 'acme.com',
  githubInstallationId: '176399104',
};

asyncTest('A PICKED DOMAIN PUTS THE SITE IN A SUBDIRECTORY OF IT', async () => {
  /* One GitHub account serves one domain with many sites under it —
   * acme.com/quality-plumbing/, acme.com/roof-pros/. Edwin, 29 October:
   * "only one can serve from the root and then other website will use a
   * subdirectory." */
  const baseDir = tmpdir('picked');
  const stub = fakeGenerate();
  const pub = fakePublish();
  const pool = fakePool(POOL_ROW);

  await runLocalOptions({
    body: { global: { ...goodGlobal(), domainId: 'dom-acme' }, pages: sixPages() },
    user: fakeUser(),
    baseDir,
    generate: stub.generate,
    publish: pub.publish,
    Domain: pool.Domain,
  });

  /* THE ADDRESS THE PAGES WILL CLAIM. Every canonical, the sitemap and the
   * schema @id are built by appending to this — and a canonical naming an
   * address that serves somebody else's site is the fault that made two
   * migrated domains invisible in October. */
  /* The fixture business is "Leander Plumbing Gomanzo", and the path is
   * its name — which is the point: the address and the repository are the
   * same string, produced once. */
  assert.strictEqual(stub.seen.args.url, 'https://acme.com/leander-plumbing-gomanzo');
});

asyncTest('and it publishes to the GitHub account that domain belongs to', async () => {
  /* The domain and the account are ONE choice, not two. The customer never
   * picks an account. */
  const baseDir = tmpdir('picked-install');
  const stub = fakeGenerate();
  const pub = fakePublish();
  const pool = fakePool(POOL_ROW);

  await runLocalOptions({
    body: { global: { ...goodGlobal(), domainId: 'dom-acme' }, pages: sixPages() },

    /* A DIFFERENT INSTALLATION ON THE ACCOUNT, so a pass cannot come from
     * the fallback. */
    user: Object.assign(fakeUser(), { githubInstallationId: '999' }),
    baseDir,
    generate: stub.generate,
    publish: pub.publish,
    Domain: pool.Domain,
  });

  assert.strictEqual(pub.seen.args.installationId, '176399104');
});

asyncTest('THE CHOICE IS CHECKED AGAINST THE POOL, NOT TRUSTED', async () => {
  /* It arrives from a <select>, which is exactly why it has to be checked:
   * a POST is a POST, and an unknown id would publish a customer's site to
   * whatever installation the string happened to name. */
  const baseDir = tmpdir('picked-bad');
  const stub = fakeGenerate();
  const pool = fakePool(null);

  await assert.rejects(
    () => runLocalOptions({
      body: { global: { ...goodGlobal(), domainId: 'dom-nope' }, pages: sixPages() },
      user: fakeUser(),
      baseDir,
      generate: stub.generate,
      Domain: pool.Domain,
    }),
    /not one this account can publish to/
  );

  assert.strictEqual(stub.seen.calls, 0, 'it wrote a site it had nowhere to put');
});

asyncTest('and a disabled or non-GitHub row is not a candidate', async () => {
  /* Turning a domain off is how a client leaving is handled — the sites
   * already on it keep serving, and no new one is pointed at it. */
  const baseDir = tmpdir('picked-filter');
  const pool = fakePool(POOL_ROW);

  await runLocalOptions({
    body: { global: { ...goodGlobal(), domainId: 'dom-acme' }, pages: sixPages() },
    user: fakeUser(),
    baseDir,
    generate: fakeGenerate().generate,
    publish: fakePublish().publish,
    Domain: pool.Domain,
  });

  assert.deepStrictEqual(pool.seen.query, {
    _id: 'dom-acme',
    target: 'github',
    enabled: true,
  });
});

asyncTest('A TYPED DOMAIN STILL BUILDS AT ITS OWN ROOT', async () => {
  /* Every build before 29 October worked this way, jobs queued against the
   * old form are still in the queue, and a customer with no GitHub account
   * must still be able to build a site and download it. */
  const baseDir = tmpdir('typed');
  const stub = fakeGenerate();

  await runLocalOptions({
    body: { global: goodGlobal(), pages: sixPages() },
    user: fakeUser(),
    baseDir,
    generate: stub.generate,
  });

  assert.strictEqual(stub.seen.args.url, 'https://leanderplumbing.com');
});

/* ---------------------------------------------------------------------- */

(async () => {
  for (const [name, fn] of asyncTests) {
    try {
      await fn();
      console.log(`  ok    ${name}`);
      passed++;
    } catch (err) {
      console.log(`  FAIL  ${name}\n        ${err.message}`);
      failed++;
    }
  }

  console.log('');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('');
  process.exit(failed === 0 ? 0 : 1);
})();
