// test-nearby-places.js
//
// The towns suggested for a location page, and the endpoint that serves them.
//
// WHY THIS EXISTS
//
// Every town here becomes a page the customer PAYS 100 credits for, claiming
// the business serves that place. A wrong one is not a crash — it is a page
// about a town a hundred miles away, and the customer ticked it because the
// app put it in front of them.
//
// That is why this reads a gazetteer instead of asking a model. A model
// answers confidently and wrongly, and the wrong answers look exactly like
// the right ones. These assertions are about real distances between real
// places, which is the property that made the whole approach worth the work.
//
//   node test-nearby-places.js

const assert = require('assert');
const {
  nearbyPlaces,
  findPlace,
  milesBetween,
  normalisePlaceName,
  TOWN_FEATURE_CODES,
  DEFAULT_RADIUS_MILES,
  MAX_PLACES,
  ATTRIBUTION,
} = require('./utils/nearbyPlaces');

let passed = 0, failed = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

// An awaiting runner. A plain try/catch around fn() never sees a rejected
// promise, so async tests pass no matter what they assert — that mistake hid
// four broken tests in this project once already.
async function runAll() {
  for (const [name, fn] of queue) {
    try { await fn(); console.log(`  ok    ${name}`); passed++; }
    catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
  }
}

const names = result => result.places.map(p => p.display);

console.log('\nNearby towns\n');

/* -------------------------------------------------------------------------
 * The distances are real
 *
 * The point of the whole exercise. Checked against places whose relative
 * positions are not in dispute.
 * ---------------------------------------------------------------------- */

test('the nearest towns to Leander really are the nearest', () => {
  const out = nearbyPlaces('Leander, TX');

  assert.strictEqual(out.places[0].display, 'Cedar Park, TX',
    `nearest came back as ${out.places[0].display}`);
  assert.ok(names(out).includes('Round Rock, TX'));
  assert.ok(names(out).includes('Georgetown, TX'));
});

test('a town 190 miles away is not suggested', () => {
  // The bug that started this: a location page for Dallas on a site for a
  // business in the Austin suburbs. It is what a model gives you.
  const out = nearbyPlaces('Round Rock, TX');

  assert.ok(!names(out).includes('Dallas, TX'), 'Dallas came back for Round Rock');
  assert.ok(!names(out).includes('Houston, TX'));
});

test('the list is ordered by distance, closest first', () => {
  const out = nearbyPlaces('Leander, TX');
  const miles = out.places.map(p => p.miles);

  assert.deepStrictEqual(miles, [...miles].sort((a, b) => a - b),
    'the towns came back out of order');
});

test('distances are measured over the curve, not as grid squares', () => {
  // The pair has to be mostly EAST-WEST and well away from the equator, or
  // the test proves nothing: Austin to Dallas is mostly north-south, and flat
  // trigonometry gets it right to within a few miles by luck. The cos(lat)
  // term is what shrinks a degree of longitude as you go north, and only an
  // east-west pair exercises it.
  //
  // Seattle to Spokane is 228 miles. Drop the latitude scaling and it comes
  // out around 338 — the error is 48%, and it grows the further north you go.
  const seattle = { lat: 47.6062, lon: -122.3321 };
  const spokane = { lat: 47.6588, lon: -117.4260 };

  const d = milesBetween(seattle, spokane);
  assert.ok(d > 215 && d < 240, `Seattle to Spokane came out at ${d.toFixed(0)} miles`);

  // And a north-south pair of the same span, which flat maths also gets
  // right — so a failure above is about the scaling, not the whole formula.
  const austin = { lat: 30.2672, lon: -97.7431 };
  const dallas = { lat: 32.7767, lon: -96.7970 };
  assert.ok(milesBetween(austin, dallas) > 170, 'Austin to Dallas is under 170 miles');
});

test('a town is zero miles from itself', () => {
  const p = { lat: 30.5, lon: -97.8 };
  assert.strictEqual(milesBetween(p, p), 0);
});

test('the radius is a real limit', () => {
  const tight = nearbyPlaces('Leander, TX', { radiusMiles: 8 });

  assert.ok(tight.places.length > 0, 'nothing at all within 8 miles of Leander');
  tight.places.forEach(p =>
    assert.ok(p.miles <= 8, `${p.display} is ${p.miles} miles away, past the radius`));
});

/* -------------------------------------------------------------------------
 * What counts as a town
 * ---------------------------------------------------------------------- */

test('neighbourhoods are left out', () => {
  // GeoNames marks a district inside a city as PPLX. A location page for a
  // district of Austin is a different play from one for a suburb, and mixing
  // them in one list makes the choice harder, not richer.
  assert.ok(!TOWN_FEATURE_CODES.has('PPLX'), 'neighbourhoods are being treated as towns');
  assert.ok(!TOWN_FEATURE_CODES.has('PPLQ'), 'abandoned places are being treated as towns');

  assert.ok(TOWN_FEATURE_CODES.has('PPL'));
  assert.ok(TOWN_FEATURE_CODES.has('PPLA2'), 'county seats are being left out');
});

test('the nearest thing to Bel Air is a district of Bel Air, and it is not offered', () => {
  // North Bel Air is exactly what the feature filter is for: a district of
  // the town itself, marked PPLX, and the CLOSEST populated place to it.
  // Drop the filter and it becomes the first suggestion in the list — a
  // location page for part of the town the home page already covers.
  //
  // The fixture has to be one where the neighbourhood ranks inside the
  // twenty returned. A denser metro hides it behind twenty real suburbs and
  // the test passes with the filter gone.
  const out = nearbyPlaces('Bel Air, MD');

  assert.ok(out.places.length > 5, 'the Bel Air fixture returned almost nothing');
  assert.ok(!names(out).includes('North Bel Air, MD'),
    'a district of the town itself was offered as a location page');
});

test('every suggestion carries the numbers the customer judges it on', () => {
  // Distance and population are how somebody tells a suburb from a
  // subdivision. Without them the list is twenty names and a guess.
  const out = nearbyPlaces('Leander, TX', { limit: 5 });

  out.places.forEach(p => {
    assert.ok(typeof p.miles === 'number' && p.miles > 0, `${p.display} has no distance`);
    assert.ok(typeof p.population === 'number' && p.population >= 1000,
      `${p.display} has no population`);
    assert.strictEqual(p.display, `${p.name}, ${p.state}`);
  });
});

/* -------------------------------------------------------------------------
 * Finding the business's own town
 * ---------------------------------------------------------------------- */

test('the town is found however the customer abbreviates it', () => {
  // Neither of these is a typo. They are both how people write the name, so
  // the lookup has to meet them rather than refusing.
  assert.strictEqual(findPlace('Ft. Worth', 'TX').name, 'Fort Worth');
  assert.strictEqual(findPlace('Saint Louis', 'MO').name, 'St. Louis');
  assert.strictEqual(findPlace('Mt. Pleasant', 'SC').name, 'Mount Pleasant');
  assert.strictEqual(findPlace('  cedar park  ', 'tx').name, 'Cedar Park');
});

test('normalising collapses the spellings that mean one place', () => {
  assert.strictEqual(normalisePlaceName('Ft. Worth'), normalisePlaceName('Fort Worth'));
  assert.strictEqual(normalisePlaceName('St. Louis'), normalisePlaceName('Saint Louis'));
  assert.strictEqual(normalisePlaceName('Winston-Salem'), 'winston salem');
});

test('two towns of one name in one state: the bigger one wins', () => {
  // Texas has two Fairviews. Somebody naming the town without qualifying it
  // means the one most people mean, and there is no way to ask.
  const both = require('all-the-cities')
    .filter(c => c.country === 'US' && c.adminCode === 'TX'
      && normalisePlaceName(c.name) === 'fairview'
      && TOWN_FEATURE_CODES.has(c.featureCode));

  assert.ok(both.length > 1, 'the fixture no longer has two Fairviews, so this proves nothing');

  const biggest = Math.max(...both.map(c => c.population));
  assert.strictEqual(findPlace('Fairview', 'TX').population, biggest,
    'the smaller of the two was chosen');
});

test('a town without a state is refused rather than guessed', () => {
  // "Springfield" is thirty different towns. Picking one silently would put
  // a business in the wrong half of the country.
  assert.strictEqual(findPlace('Springfield', ''), null);
  assert.strictEqual(findPlace('Springfield', 'Texas'), null, 'a full state name was accepted');
  assert.strictEqual(nearbyPlaces('Leander').home, null);
});

test('a town nobody has heard of gives no home, not an empty list', () => {
  // The caller has to tell these apart: with no coordinates for the centre
  // there was nothing to measure from, which is a different thing from
  // "there is nothing near you".
  const out = nearbyPlaces('Nowheresville, TX');

  assert.strictEqual(out.home, null);
  assert.deepStrictEqual(out.places, []);
});

test('the business own town is never suggested back to it', () => {
  // It would duplicate the home page — the exact thing the location-page
  // block at input already exists to stop.
  const out = nearbyPlaces('Cedar Park, TX');
  assert.ok(!names(out).includes('Cedar Park, TX'));
});

/* -------------------------------------------------------------------------
 * Exclusions and limits
 * ---------------------------------------------------------------------- */

test('towns already on the form are not offered again', () => {
  const plain = nearbyPlaces('Leander, TX', { limit: 3 });
  const out = nearbyPlaces('Leander, TX', { limit: 3, exclude: [plain.places[0].display] });

  assert.ok(!names(out).includes(plain.places[0].display));
  assert.strictEqual(out.places.length, 3, 'excluding one shortened the list instead of shifting it');
});

test('an exclusion matches however it was spelled', () => {
  const out = nearbyPlaces('Leander, TX', { limit: 5, exclude: ['cedar park, tx'] });
  assert.ok(!names(out).includes('Cedar Park, TX'), 'a lower-case exclusion was ignored');
});

test('never more than twenty at a time', () => {
  const out = nearbyPlaces('Leander, TX');

  assert.ok(out.places.length <= MAX_PLACES, `${out.places.length} came back`);
  assert.ok(out.withinRadius > out.places.length,
    'this fixture should have more towns nearby than the limit, or it proves nothing');
});

test('how many exist is reported separately from how many are returned', () => {
  // So the page can say "20 of 86" rather than implying that is all there is.
  const out = nearbyPlaces('Leander, TX');
  assert.ok(out.withinRadius >= out.places.length);
});

test('a remote town returns the few that exist, not filler', () => {
  // Alpine, Texas has two towns within 30 miles and not many more within 60.
  // Padding the list to twenty would mean pages for places nobody drives to.
  const out = nearbyPlaces('Alpine, TX');

  assert.ok(out.home, 'Alpine, TX was not found');
  assert.ok(out.places.length < 10, `${out.places.length} towns came back for Alpine`);
  out.places.forEach(p =>
    assert.ok(p.miles <= DEFAULT_RADIUS_MILES, `${p.display} is past the radius`));
});

test('the default radius is a service area, not the whole state', () => {
  assert.ok(DEFAULT_RADIUS_MILES <= 75,
    'the radius has grown past anything a local business plausibly serves');
});

/* -------------------------------------------------------------------------
 * The data itself
 * ---------------------------------------------------------------------- */

test('the gazetteer credit is there to be used', () => {
  // The package is MIT; the DATA is GeoNames under CC BY 4.0, which wants
  // attribution. Keeping the line in the module is not the same as showing
  // it, but it is where anyone looking will find it.
  assert.ok(/GeoNames/.test(ATTRIBUTION));
  assert.ok(/CC BY/.test(ATTRIBUTION));
});

test('the dataset loads without the wizard, the server or a network', () => {
  // This suite is the proof: it runs in a container with no API key and no
  // outbound access, which is the whole argument for doing it this way.
  const out = nearbyPlaces('Pflugerville, TX', { limit: 1 });
  assert.strictEqual(out.places.length, 1);
});

/* -------------------------------------------------------------------------
 * The endpoint
 *
 * Loaded with express stubbed out so the handler itself runs. utils/pricing.js
 * and utils/nearbyPlaces.js are NOT stubbed — the arithmetic and the geography
 * under test are the real ones.
 * ---------------------------------------------------------------------- */

function loadRoute({ onLog } = {}) {
  const Module = require('module');
  const path = require('path');
  const real = Module._load;
  const routes = [];

  const fakeRouter = {
    post(routePath, ...handlers) { routes.push({ path: routePath, handlers }); },
  };

  Module._load = function (request) {
    if (request === 'express') return { Router: () => fakeRouter };
    if (/logger$/.test(request)) {
      return { log: { info: (e, f) => onLog && onLog(e, f), error() {} } };
    }
    return real.apply(this, arguments);
  };

  const file = path.join(__dirname, 'routes/suggestLocationsRoute.js');
  try {
    delete require.cache[require.resolve(file)];
    require(file);
  } finally {
    Module._load = real;
  }

  const route = routes.find(r => r.path === '/api/suggest-locations');
  assert.ok(route, 'the route does not register /api/suggest-locations');

  return route.handlers[route.handlers.length - 1];
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

const call = async (body, user = { credits: 5000 }) => {
  const res = fakeRes();
  await loadRoute()({ body, user }, res);
  return res;
};

test('the endpoint refuses a request with no location', async () => {
  const res = await call({});
  assert.strictEqual(res.statusCode, 400);
  assert.ok(/business location/i.test(res.body.error));
});

test('a town the gazetteer does not know gives a 404 that says what to do', async () => {
  // Not a 200 with an empty list. "There is nothing near you" and "we could
  // not find you" are different problems with different fixes.
  const res = await call({ location: 'Nowheresville, TX' });

  assert.strictEqual(res.statusCode, 404);
  assert.ok(/could not find/i.test(res.body.error), res.body.error);
  assert.ok(/by hand/i.test(res.body.error), 'the customer is not told what to do instead');
  assert.ok(/City, ST/.test(res.body.error), 'the format that would have worked is not named');
});

test('the number of ticked boxes comes from the SERVER\'S copy of the balance', async () => {
  const res = await call({ location: 'Leander, TX', credits: 999999 }, { credits: 300 });
  assert.strictEqual(res.body.checked, 1, JSON.stringify(res.body.checked));
});

test('service pages already chosen are counted against the balance', async () => {
  // They come out of the same credits. Ignoring them ticks boxes the
  // customer cannot afford — the exact thing the pre-ticking exists to stop.
  const res = await call(
    { location: 'Leander, TX', servicePages: 5 },
    { credits: 1000 });

  // 1000 - 200 website - 500 for five service pages = 300, so three towns.
  assert.strictEqual(res.body.affordable, 3, JSON.stringify(res.body));
});

test('location rows already on the form are counted too', async () => {
  const res = await call(
    { location: 'Leander, TX', existing: ['Hutto, TX', 'Bertram, TX'] },
    { credits: 1000 });

  // 1000 - 200 - 200 for the two rows = 600, so six more.
  assert.strictEqual(res.body.affordable, 6, JSON.stringify(res.body));
});

test('towns already SHOWN are skipped but do not cost anything', async () => {
  // Pressing the button again should give the next nearest towns, not the
  // same ones. But an unticked box has bought nothing, so it must not reduce
  // what the balance covers.
  const first = await call({ location: 'Leander, TX' }, { credits: 1000 });
  const shown = first.body.places.map(p => p.display);

  const second = await call({ location: 'Leander, TX', shown }, { credits: 1000 });

  shown.forEach(town =>
    assert.ok(!second.body.places.some(p => p.display === town),
      `${town} came back a second time`));

  assert.strictEqual(second.body.affordable, first.body.affordable,
    'merely showing a town reduced the budget');
});

test('a design sample ticks nothing even with credits to spare', async () => {
  const res = await call({ location: 'Leander, TX', siteMode: 'sample' }, { credits: 5000 });
  assert.strictEqual(res.body.checked, 0);
});

test('no balance still returns the list in full', async () => {
  const res = await call({ location: 'Leander, TX' }, { credits: 0 });

  assert.strictEqual(res.body.checked, 0);
  assert.ok(res.body.places.length > 5, 'the list was withheld from somebody with no credits');
});

test('ticked boxes never exceed the towns actually found', async () => {
  const res = await call({ location: 'Alpine, TX' }, { credits: 100000 });

  assert.strictEqual(res.body.checked, res.body.places.length);
  assert.ok(res.body.affordable > res.body.places.length,
    'this fixture should have more budget than towns, or it proves nothing');
});

test('the radius is clamped, so nobody asks for the whole country', async () => {
  const res = await call({ location: 'Leander, TX', radiusMiles: 5000 });
  assert.ok(res.body.radiusMiles <= 150, `radius came back as ${res.body.radiusMiles}`);
});

test('the reply says how many exist, not just how many it sent', async () => {
  const res = await call({ location: 'Leander, TX' });

  assert.ok(res.body.withinRadius > res.body.places.length);
  assert.strictEqual(res.body.home, 'Leander, TX');
});

/* -------------------------------------------------------------------------
 * The wizard
 * ---------------------------------------------------------------------- */

const fs = require('fs');
const path = require('path');

const WIZARD = fs.readFileSync(
  path.join(__dirname, 'public/js/generateDinamycForm.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n');

function wizardFn(name) {
  const at = WIZARD.indexOf(`function ${name}(`);
  assert.notStrictEqual(at, -1, `${name}() has been renamed or removed`);
  const next = WIZARD.indexOf('\n  function ', at + 10);
  return next === -1 ? WIZARD.slice(at) : WIZARD.slice(at, next);
}

test('the panel sends what the budget depends on', () => {
  const body = wizardFn('fetchNearbyTowns');

  assert.ok(/location: \(state\.mainFormSnapshot/.test(body), 'the town is not sent');
  assert.ok(/siteMode: state\.siteMode/.test(body));
  assert.ok(/servicePages: \(state\.pages \|\| \[\]\)/.test(body),
    'the service pages are not counted, so the budget will be too generous');
  assert.ok(/existing: locationRows/.test(body));
  assert.ok(/shown,/.test(body), 'pressing again would repeat the same towns');
  assert.ok(/X-CSRF-Token/.test(body), 'every request would be rejected');
});

test('deleting a location row clears its tick box', () => {
  // The delete button belongs to locationPages.js and listens on `document`.
  // Capture is what gets in first, while the row still exists.
  const body = wizardFn('mountLocationSuggestPanel');

  const handler = body.slice(body.indexOf("locList.addEventListener('click'"));
  const scoped = handler.slice(0, handler.indexOf('}, true);') + 10);

  assert.ok(/remove-location/.test(scoped), 'nothing watches the delete button');
  assert.ok(/if \(box\) box\.checked = false;/.test(scoped),
    'the delete button leaves the box ticked');
  assert.ok(/\}, true\);/.test(scoped), 'the listener is not in the capture phase');
});

test('turning the toggle off clears every tick', () => {
  // locationPages.js empties the list when the switch goes off, so every
  // ticked box is left over a row that no longer exists.
  const body = wizardFn('mountLocationSuggestPanel');
  const handler = body.slice(body.indexOf("locToggle.addEventListener('change'"));

  assert.ok(/checked = false/.test(handler.slice(0, 400)),
    'the boxes stay ticked over rows the toggle just deleted');
});

test('ticking a town goes through the same credit gate as the Add button', () => {
  const body = wizardFn('renderTownBatch');
  const handler = body.slice(body.indexOf("box.addEventListener('change'"));

  assert.ok(/fetchQuote\(\{ extraLocations: 1 \}\)/.test(handler), 'no credit check on tick');
  assert.ok(/showCreditsModal\(q\)/.test(handler));
  assert.ok(/box\.checked = false/.test(handler), 'the box stays ticked after a refusal');
});

test('unticking a town takes its row away', () => {
  const body = wizardFn('renderTownBatch');
  assert.ok(/if \(!box\.checked\) \{\s*removeLocationRow/.test(body));
});

test('a town and its row are linked by an id, not by the text in the field', () => {
  const body = wizardFn('addLocationRow');

  // BOTH paths tag. One fills the blank row the toggle leaves behind, the
  // other appends a new one, and a row that misses its tag is a box that can
  // never remove it again.
  assert.ok(/blank\.closest\('\.row'\)\.dataset\.suggested = key;/.test(body),
    'the filled blank row is not tagged');
  assert.ok(/if \(added && added\.dataset\) added\.dataset\.suggested = key;/.test(body),
    'an appended row is not tagged');

  const remove = wizardFn('removeLocationRow');
  assert.ok(/rowForTown\(locList, key\)/.test(remove), 'the row is hunted for by its text');
});

test('a box is ticked because its row exists', () => {
  const body = wizardFn('renderTownBatch');
  assert.ok(/\$\{onForm \? 'checked' : ''\}/.test(body),
    'the ticks come from something other than the rows on the form');
});

test('the miles and the population reach the label', () => {
  // They are the whole reason the customer can tell a suburb from a
  // subdivision. A bare list of names puts that judgement back on them.
  const body = wizardFn('renderTownBatch');

  assert.ok(/place\.miles/.test(body), 'the distance is not shown');
  assert.ok(/place\.population/.test(body), 'the population is not shown');
});

test('the gazetteer is credited on the screen that uses it', () => {
  // GeoNames publishes under CC BY 4.0, which asks for attribution. Keeping
  // the sentence in a module constant is not showing it to anybody.
  const body = wizardFn('mountLocationSuggestPanel');

  assert.ok(/GeoNames/.test(body), 'the credit is nowhere on the page');
  assert.ok(/CC BY 4\.0/.test(body), 'the licence is not named');
  assert.ok(/geonames\.org/.test(body), 'the credit does not link anywhere');
  assert.ok(/rel="noopener noreferrer"/.test(body),
    'the outbound link hands the opener to another site');
});

test('the credit appears with the list, not before it', () => {
  // A dataset credited on a screen that has not used it yet is noise. It
  // shows when the first list does, and it must show for a list restored on
  // the way back to this step too — not only for one just fetched.
  const body = wizardFn('mountLocationSuggestPanel');

  assert.ok(/const showCredit = \(\) => \{ credit\.style\.display = 'block'; \};/.test(body),
    'nothing reveals the credit');
  assert.ok(/if \(\(state\.townBatches \|\| \[\]\)\.length\) showCredit\(\);/.test(body),
    'a restored list shows its towns with no credit under them');

  const click = body.slice(body.indexOf("button.addEventListener('click'"));
  assert.ok(/showCredit\(\);/.test(click), 'a freshly fetched list shows no credit');
});

test('the towns survive a trip to buy credits', () => {
  assert.ok(/townBatches: state\.townBatches/.test(WIZARD), 'the towns are not saved in the draft');
  assert.ok(/Array\.isArray\(draft\.townBatches\) \? draft\.townBatches : \[\]/.test(WIZARD),
    'an older draft without them would restore undefined');
});

test('a new site starts with no towns from the last one', () => {
  const reset = WIZARD.slice(WIZARD.indexOf('state.mainFormSnapshot  = null;'));
  assert.ok(/state\.townBatches\s*=\s*\[\];/.test(reset.slice(0, 800)));
});

runAll().then(() => {
  console.log('');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('');
  process.exit(failed === 0 ? 0 : 1);
});
