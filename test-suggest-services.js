// test-suggest-services.js
//
// The suggested service list: what the model is allowed to hand a customer.
//
// WHY THIS EXISTS
//
// Every string here becomes a page the customer PAYS 100 credits for, with a
// URL, a title and an <h1>. A bad suggestion is not a crash — it is a page
// that cannot rank, or one that overwrites another, and the customer chose it
// because the app put a tick next to it.
//
// The app is the one proposing the list now, so a duplicate or a junk entry in
// it is our mistake rather than something they typed.
//
//   node test-suggest-services.js

const assert = require('assert');
const {
  suggestServices,
  cleanServices,
  buildPrompt,
  titleCase,
  isTheCategory,
  MAX_SERVICES,
} = require('./utils/suggestServices');
const { affordableServicePages, PRICING } = require('./utils/pricing');

let passed = 0, failed = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

async function runAll() {
  for (const [name, fn] of queue) {
    try { await fn(); console.log(`  ok    ${name}`); passed++; }
    catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
  }
}

const clean = (list, businessType = 'Plumbing') =>
  cleanServices(list, { businessType });

const names = result => result.services;
const reasonFor = (result, name) =>
  (result.dropped.find(d => d.name === name) || {}).why;

console.log('\nSuggested services\n');

/* -------------------------------------------------------------------------
 * The category trap
 *
 * A page for "Plumbing" on a plumber's site competes with the HOME page for
 * the same term. That is the cannibalisation this whole app exists to avoid,
 * and a model offers it constantly.
 * ---------------------------------------------------------------------- */

test('the business category is never a service page', () => {
  for (const junk of [
    'Plumbing',
    'Plumbing Services',
    'Professional Plumbing',
    'Quality Plumbing Services',
    'Expert Plumbing Solutions',
  ]) {
    const out = clean([junk, 'Drain Cleaning']);
    assert.ok(!names(out).includes(junk), `"${junk}" was offered as a service page`);
  }
});

test('marketing with no job in it is dropped', () => {
  // An exact-match ban list cannot do this — the first version banned
  // "Quality Service" and let "Quality Workmanship" straight through.
  for (const fluff of ['Quality Workmanship', 'Superior Craftsmanship', 'Complete Solutions']) {
    const out = clean([fluff, 'Drain Cleaning']);
    assert.ok(!names(out).includes(fluff), `"${fluff}" survived`);
  }
});

test('a real qualifier is NOT mistaken for marketing', () => {
  // The guard above must not eat the good ones. "Emergency Plumbing" is a
  // distinct thing people search for; "Professional Plumbing" is not.
  const out = clean(['Emergency Plumbing', '24 Hour Plumbing', 'Commercial Plumbing']);
  assert.deepStrictEqual(names(out), ['Emergency Plumbing', '24 Hour Plumbing', 'Commercial Plumbing']);
});

test('isTheCategory handles a multi-word business type', () => {
  assert.ok(isTheCategory('Law Firm Services', 'Law Firm'));
  assert.ok(isTheCategory('Professional Law Firm', 'Law Firm'));
  assert.ok(!isTheCategory('Divorce Mediation', 'Law Firm'));
});

test('padding in the BUSINESS TYPE is stripped too, not just in the name', () => {
  // People type "Plumbing Services" and "Professional Law Firm" into the
  // business-type field all the time. If only the suggestion is reduced and
  // the type is compared raw, "Plumbing" sails past a business whose type is
  // "Plumbing Services" — and a page competing with the home page is exactly
  // what this check exists to stop.
  assert.ok(isTheCategory('Plumbing', 'Plumbing Services'));
  assert.ok(isTheCategory('Law Firm', 'Professional Law Firm'));
  assert.ok(!isTheCategory('Drain Cleaning', 'Plumbing Services'));
});

test('no business type means no category filtering, not a crash', () => {
  const out = cleanServices(['Plumbing Services', 'Drain Cleaning'], {});
  assert.ok(names(out).includes('Drain Cleaning'));
});

/* -------------------------------------------------------------------------
 * The two checks the form already runs
 *
 * Reused rather than reimplemented, so the suggestion list cannot contain
 * something the very next screen would warn about.
 * ---------------------------------------------------------------------- */

test('two suggestions that become the same FILE are reduced to one', () => {
  // These overwrite each other on disk. The customer pays twice and gets one
  // page, and nothing anywhere says so.
  //
  // The pair has to be one the PUNCTUATION guard lets through, or this test
  // proves nothing about the collision check — the first version used
  // "Drain, Cleaning", which never reached it, and removing the collision
  // check entirely did not fail a single test.
  //
  // The reason matters too: near-duplicate detection would also catch this
  // pair, so asserting only that one of them is gone cannot tell which check
  // did the work.
  const out = clean(['24 Hour Plumbing', '24-Hour Plumbing', 'Drain Cleaning']);
  assert.deepStrictEqual(names(out), ['24 Hour Plumbing', 'Drain Cleaning']);
  assert.strictEqual(reasonFor(out, '24-Hour Plumbing'),
    'same page as another suggestion');
});

test('the FIRST of a slug-colliding pair survives, not the second', () => {
  const out = clean(['24 Hour Plumbing', '24-Hour Plumbing']);
  assert.deepStrictEqual(names(out), ['24 Hour Plumbing']);
});

test('two suggestions that MEAN the same thing are reduced to one', () => {
  // Both pages get written, both get charged, Google shows one.
  const out = clean(['Water Heater Repair', 'Water Heater Repairs', 'Drain Cleaning']);
  assert.deepStrictEqual(names(out), ['Water Heater Repair', 'Drain Cleaning']);
  assert.strictEqual(reasonFor(out, 'Water Heater Repairs'), 'too similar to another suggestion');
});

test('the FIRST of a near-duplicate pair survives, not the second', () => {
  // The list is ordered by how commonly the service is sold, so earlier is
  // more valuable. Dropping the wrong one silently downgrades the list.
  const out = clean(['Water Heater Repair', 'Water Heater Repairs']);
  assert.deepStrictEqual(names(out), ['Water Heater Repair']);
});

/* -------------------------------------------------------------------------
 * Shape
 * ---------------------------------------------------------------------- */

test('names are title-cased for use as an <h1>', () => {
  const out = clean(['water heater repair', 'DRAIN CLEANING']);
  assert.deepStrictEqual(names(out), ['Water Heater Repair', 'Drain Cleaning']);
});

test('acronyms keep their capitals', () => {
  // "Ac Repair" and "Hvac Installation" look like typos on a live page.
  assert.strictEqual(titleCase('AC Repair'), 'AC Repair');
  assert.strictEqual(titleCase('HVAC Installation'), 'HVAC Installation');
  assert.strictEqual(titleCase('TV Mounting'), 'TV Mounting');
});

test('a SHOUTED name is calmed down, an abbreviation is not', () => {
  // The rule used to be "any capital after the first letter means leave it
  // alone", so a model that returned "DRAIN CLEANING" put DRAIN CLEANING on
  // the page. Length is what separates an abbreviation from shouting.
  assert.strictEqual(titleCase('DRAIN CLEANING'), 'Drain Cleaning');
  assert.strictEqual(titleCase('EMERGENCY PLUMBING'), 'Emergency Plumbing');
  assert.strictEqual(titleCase('HVAC REPAIR'), 'HVAC Repair');
});

test('capitals somebody chose are kept', () => {
  assert.strictEqual(titleCase('McDonald Repairs'), 'McDonald Repairs');
});

test('both halves of a hyphenated name are capitalised', () => {
  assert.strictEqual(titleCase('re-piping'), 'Re-Piping');
  assert.strictEqual(titleCase('trenchless sewer re-lining'), 'Trenchless Sewer Re-Lining');
});

test('small words stay lower case mid-name', () => {
  assert.strictEqual(titleCase('repair of water heaters'), 'Repair of Water Heaters');
});

test('a small word still opens a name in capitals', () => {
  // "in Home Care" as an <h1> reads like a fragment.
  assert.strictEqual(titleCase('in home care'), 'In Home Care');
});

test('punctuation that will not slugify is dropped', () => {
  const out = clean(['Leak Detection!!!', 'Drain Cleaning']);
  assert.ok(!names(out).includes('Leak Detection!!!'));
  assert.strictEqual(reasonFor(out, 'Leak Detection!!!'),
    'contains punctuation that will not slugify');
});

test('hyphens, ampersands and digits are allowed', () => {
  // "24 Hour Plumbing", "Re-Piping", "Heating & Cooling" are all real.
  const out = clean(['24 Hour Plumbing', 'Re-Piping', 'Heating & Cooling']);
  assert.strictEqual(names(out).length, 3, JSON.stringify(out.dropped));
});

test('something too long for a page title is dropped', () => {
  const long = 'Repair of the Subsurface Pipes Beneath a Residential Concrete Foundation';
  const out = clean([long, 'Drain Cleaning']);
  assert.ok(!names(out).includes(long));
});

test('site furniture is dropped', () => {
  for (const page of ['About Us', 'Contact', 'Testimonials', 'FAQ', 'Pricing']) {
    const out = clean([page, 'Drain Cleaning']);
    assert.ok(!names(out).includes(page), `"${page}" was offered as a service`);
  }
});

/* -------------------------------------------------------------------------
 * Nothing crashes on a bad model reply
 * ---------------------------------------------------------------------- */

test('junk from the model produces an empty list, not an exception', () => {
  for (const junk of [null, undefined, 'not an array', 42, {}, [null, '', '   ', 7]]) {
    const out = cleanServices(junk, { businessType: 'Plumbing' });
    assert.ok(Array.isArray(out.services), `threw or returned nothing for ${JSON.stringify(junk)}`);
  }
});

test('objects with a name field are accepted as well as strings', () => {
  // The prompt asks for strings; a model sometimes returns
  // [{ name: "..." }] anyway.
  const out = clean([{ name: 'Drain Cleaning' }, 'Leak Detection']);
  assert.deepStrictEqual(names(out), ['Drain Cleaning', 'Leak Detection']);
});

/* -------------------------------------------------------------------------
 * The cap
 * ---------------------------------------------------------------------- */

test('never more than twenty, however many the model returns', () => {
  // Past twenty a model produces restatements, not services. A longer list is
  // a worse list.
  const many = Array.from({ length: 40 }, (_, i) => `Service Number ${i + 1}`);
  const out = cleanServices(many, { businessType: 'Plumbing' });
  assert.ok(out.services.length <= MAX_SERVICES, `${out.services.length} survived`);
});

test('asking for fewer returns fewer', async () => {
  const out = await suggestServices({ businessType: 'Plumbing', location: 'Round Rock, TX' },
    { stub: true, count: 5 });
  assert.strictEqual(out.services.length, 5);
});

test('asking for more than twenty still returns twenty', async () => {
  const out = await suggestServices({ businessType: 'Plumbing', location: 'Round Rock, TX' },
    { stub: true, count: 50 });
  assert.strictEqual(out.services.length, MAX_SERVICES);
});

test('the MODEL is never asked for more than twenty either', async () => {
  // Capping only the returned list still pays for 50 services' worth of
  // tokens and gets a list whose tail is restatements. The cap belongs on
  // the request.
  let sent = '';
  const fakeClient = {
    responses: {
      create: async ({ input }) => {
        sent = input;
        return { output_text: '{"services": ["Drain Cleaning"]}' };
      },
    },
  };

  await suggestServices({ businessType: 'Plumbing', location: 'Austin, TX' },
    { client: fakeClient, count: 50 });

  assert.ok(/exactly 20 services/.test(sent), sent.slice(0, 200));
});

/* -------------------------------------------------------------------------
 * The prompt
 * ---------------------------------------------------------------------- */

test('the prompt demands an order, because the budget truncates the list', () => {
  // A customer with 300 credits gets ONE ticked box. If the list is not
  // ordered by how commonly the service is sold, that one is arbitrary.
  const prompt = buildPrompt({ businessType: 'Plumbing', location: 'Round Rock, TX' });
  assert.ok(/ORDER THEM BY/.test(prompt), prompt.slice(0, 200));
  assert.ok(/small budget/i.test(prompt), 'the prompt does not explain why order matters');
});

test('the prompt forbids the town in the name', () => {
  // The page titles add "in Round Rock, TX" themselves. A service called
  // "Round Rock Drain Cleaning" gives "Round Rock Drain Cleaning in Round
  // Rock, TX" — the bug fixed on the anchor side in September.
  const prompt = buildPrompt({ businessType: 'Plumbing', location: 'Round Rock, TX' });
  assert.ok(/Do not mention the town/i.test(prompt));
});

test('the prompt suits the kind of business', () => {
  // "Jobs a homeowner calls a tradesperson out to do" is wrong for a dentist.
  const plumber = buildPrompt({ businessType: 'Plumbing', location: 'Austin, TX' });
  const dentist = buildPrompt({ businessType: 'Dentist', location: 'Austin, TX' });
  const lawyer  = buildPrompt({ businessType: 'Law Firm', location: 'Austin, TX' });

  assert.ok(/homeowner/.test(plumber), plumber.slice(0, 200));
  assert.ok(/patient/.test(dentist), dentist.slice(0, 200));
  assert.ok(/client/.test(lawyer), lawyer.slice(0, 200));
});

/* -------------------------------------------------------------------------
 * The call itself
 * ---------------------------------------------------------------------- */

test('a missing business type is refused rather than guessed', async () => {
  await assert.rejects(
    () => suggestServices({ location: 'Round Rock, TX' }, { stub: true }),
    /businessType is required/
  );
});

test('the stub returns a clean, ordered list', async () => {
  const out = await suggestServices({ businessType: 'Plumbing', location: 'Round Rock, TX' },
    { stub: true });

  assert.strictEqual(out.services[0], 'Water Heater Repair');
  assert.strictEqual(out.services.length, MAX_SERVICES);
  assert.strictEqual(out.dropped.length, 0, JSON.stringify(out.dropped));
});

test('a normal model reply comes back as services', async () => {
  // The rejection test below passed for a year of nothing, because the code
  // read the services array off the parser's WRAPPER object and every reply
  // took the error branch. A rejection test needs a companion that proves
  // the non-error path exists.
  const fakeClient = {
    responses: {
      create: async () => ({
        output_text: '{"services": ["water heater repair", "Drain Cleaning"]}',
      }),
    },
  };

  const out = await suggestServices({ businessType: 'Plumbing', location: 'Austin, TX' },
    { client: fakeClient });

  assert.deepStrictEqual(out.services, ['Water Heater Repair', 'Drain Cleaning']);
});

test('a model reply with no services array is an error, not an empty page list', async () => {
  const fakeClient = {
    responses: { create: async () => ({ output_text: '{"topics": []}' }) },
  };
  await assert.rejects(
    () => suggestServices({ businessType: 'Plumbing', location: 'Austin, TX' },
      { client: fakeClient }),
    /no services array/
  );
});

test('the module loads without the openai package installed', () => {
  // suggestServices.js must not require('./openaiClient') at the top: that
  // pulls in the `openai` package, and then cleanServices() and titleCase() —
  // which touch no network at all — cannot be tested without it. This very
  // suite is the proof, since the container has no openai installed.
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, 'utils/suggestServices.js'), 'utf8');
  const top = src.slice(0, src.indexOf('function '));
  assert.ok(!/^const .*require\(['"]\.\/openaiClient['"]\)/m.test(top),
    'openaiClient is required at the top of the file again');
});

/* -------------------------------------------------------------------------
 * What the customer has already typed
 *
 * The form is not empty when the button is pressed. Offering somebody back
 * the rows they have just filled in makes the feature look broken.
 * ---------------------------------------------------------------------- */

test('a service already on the form is not offered again', () => {
  const out = cleanServices(['Drain Cleaning', 'Leak Detection'],
    { businessType: 'Plumbing', exclude: ['Drain Cleaning'] });

  assert.deepStrictEqual(names(out), ['Leak Detection']);
  assert.strictEqual(reasonFor(out, 'Drain Cleaning'), 'already on the form');
});

test('a RESTATEMENT of a row on the form is not offered either', () => {
  // This is the pair the form itself would warn them about two clicks later.
  const out = cleanServices(['Water Heater Repairs', 'Leak Detection'],
    { businessType: 'Plumbing', exclude: ['Water Heater Repair'] });

  assert.deepStrictEqual(names(out), ['Leak Detection']);
  assert.strictEqual(reasonFor(out, 'Water Heater Repairs'), 'already on the form');
});

test('a suggestion that becomes the same FILE as a form row is not offered', () => {
  const out = cleanServices(['24-Hour Plumbing', 'Leak Detection'],
    { businessType: 'Plumbing', exclude: ['24 Hour Plumbing'] });

  assert.deepStrictEqual(names(out), ['Leak Detection']);
});

test("the customer's own rows are never returned as suggestions", () => {
  // They ride along through the checks; they must be sliced back off. If they
  // leaked into the list the page would add a second row for each of them.
  const out = cleanServices(['Leak Detection'],
    { businessType: 'Plumbing', exclude: ['Drain Cleaning', 'Toilet Repair'] });

  assert.deepStrictEqual(names(out), ['Leak Detection']);
});

test('two rows the customer typed themselves are never reported as dropped', () => {
  // Their rows ride through the two checks so the suggestions can be
  // compared against them. They are not under review: if somebody has typed
  // both "Water Heater Repair" and "Water Heater Repairs" that is between
  // them and the form's own warning, and this list must not report their
  // own typing back to them as a rejected suggestion.
  const out = cleanServices(['Leak Detection'], {
    businessType: 'Plumbing',
    exclude: [
      'Water Heater Repair', 'Water Heater Repairs',   // restatements
      '24 Hour Plumbing', '24-Hour Plumbing',          // one file
    ],
  });

  assert.deepStrictEqual(names(out), ['Leak Detection']);
  assert.deepStrictEqual(out.dropped, [], JSON.stringify(out.dropped));
});

test('the limit counts suggestions, not the rows already on the form', () => {
  const out = cleanServices(['Leak Detection', 'Toilet Repair', 'Slab Leak Repair'],
    { businessType: 'Plumbing', exclude: ['Drain Cleaning'], limit: 2 });

  assert.deepStrictEqual(names(out), ['Leak Detection', 'Toilet Repair']);
});

test('the prompt tells the model what they already have', () => {
  // The clean-up is the safety net. Not telling the model means paying for
  // twenty suggestions and being handed six the customer already typed.
  const prompt = buildPrompt({
    businessType: 'Plumbing',
    location: 'Round Rock, TX',
    exclude: ['Drain Cleaning', 'Water Heater Repair'],
  });

  assert.ok(/ALREADY added/.test(prompt), prompt.slice(0, 300));
  assert.ok(/- Drain Cleaning/.test(prompt));
  assert.ok(/- Water Heater Repair/.test(prompt));
});

test('an empty form adds nothing to the prompt', () => {
  const prompt = buildPrompt({ businessType: 'Plumbing', location: 'Round Rock, TX' });
  assert.ok(!/ALREADY added/.test(prompt));
});

test('the exclusions reach the model and the clean-up both', async () => {
  let sent = '';
  const fakeClient = {
    responses: {
      create: async ({ input }) => {
        sent = input;
        // The model ignores the instruction, as models do.
        return { output_text: '{"services": ["Drain Cleaning", "Leak Detection"]}' };
      },
    },
  };

  const out = await suggestServices({ businessType: 'Plumbing', location: 'Austin, TX' },
    { client: fakeClient, exclude: ['Drain Cleaning'] });

  assert.ok(/- Drain Cleaning/.test(sent), 'the exclusions never reached the prompt');
  assert.deepStrictEqual(out.services, ['Leak Detection']);
});

/* -------------------------------------------------------------------------
 * How many boxes get ticked
 *
 * Every ticked box is 100 credits the customer has to have. Tick one too many
 * and the page hands them a rejection modal it could have predicted.
 * ---------------------------------------------------------------------- */

test('300 credits and an empty form ticks exactly one box', () => {
  // Edwin's worked example: 200 for the website, 100 for one page.
  assert.strictEqual(affordableServicePages({ credits: 300 }), 1);
});

test('the website base is only charged once, not per page', () => {
  assert.strictEqual(affordableServicePages({ credits: 1200 }), 10);
});

test('no credits ticks nothing, and never goes negative', () => {
  assert.strictEqual(affordableServicePages({ credits: 0 }), 0);
  assert.strictEqual(affordableServicePages({ credits: 150 }), 0);
  assert.strictEqual(affordableServicePages({}), 0);
});

test('rows already on the form are already spoken for', () => {
  // 1000 credits, three service pages added: 200 + 300 spent, 500 left.
  assert.strictEqual(
    affordableServicePages({ credits: 1000, servicePages: 3 }), 5);
});

test('location pages come out of the same balance', () => {
  // 1000 credits, four locations: 200 + 400 spent, 400 left.
  assert.strictEqual(
    affordableServicePages({ credits: 1000, locationPages: 4 }), 4);
  assert.strictEqual(
    affordableServicePages({ credits: 1000, servicePages: 2, locationPages: 2 }), 4);
});

test('a balance that is already overspent ticks nothing', () => {
  assert.strictEqual(
    affordableServicePages({ credits: 300, servicePages: 5, locationPages: 5 }), 0);
});

test('a design sample ticks nothing, because it generates no service pages', () => {
  // Ticking boxes on a sample would charge for pages that are never written.
  assert.strictEqual(
    affordableServicePages({ credits: 5000, siteMode: 'sample' }), 0);
});

test('a part-page of credit is not a page', () => {
  // 350 credits is 200 for the website and one and a half pages. Rounding up
  // ticks a box the customer cannot pay for, which is precisely the modal
  // this feature exists to spare them.
  assert.strictEqual(affordableServicePages({ credits: 350 }), 1);
  assert.strictEqual(affordableServicePages({ credits: 299 }), 0);
});

test('the arithmetic uses the real prices, not copies of them', () => {
  // If SERVICE_PAGE ever changes, this must follow it rather than staying at
  // a hard-coded hundred.
  const credits = PRICING.LEAD_BASE + PRICING.SERVICE_PAGE * 7;
  assert.strictEqual(affordableServicePages({ credits }), 7);
});

/* -------------------------------------------------------------------------
 * The endpoint
 *
 * Loaded with express and the middleware stubbed out, so the handler itself
 * runs. The container has no node_modules; reading the file and grepping it
 * would test the spelling of the code rather than what it does.
 *
 * utils/pricing.js is deliberately NOT stubbed — the arithmetic under test is
 * the real arithmetic.
 * ---------------------------------------------------------------------- */

function loadRoute({ suggest, onLog }) {
  const Module = require('module');
  const path = require('path');
  const real = Module._load;
  const routes = [];

  const fakeRouter = {
    post(routePath, ...handlers) { routes.push({ path: routePath, handlers }); },
  };

  Module._load = function (request, parent, isMain) {
    if (request === 'express') return { Router: () => fakeRouter };
    if (/rateLimits$/.test(request)) {
      return { suggestServicesLimiter: (req, res, next) => next() };
    }
    if (/suggestServices$/.test(request) && parent && /routes/.test(parent.filename || '')) {
      return { suggestServices: suggest };
    }
    if (/logger$/.test(request)) {
      return {
        log: {
          info: (event, fields) => { if (onLog) onLog(event, fields); },
          error() {},
        },
      };
    }
    return real.apply(this, arguments);
  };

  const file = path.join(__dirname, 'routes/suggestServicesRoute.js');
  try {
    delete require.cache[require.resolve(file)];
    require(file);
  } finally {
    Module._load = real;
  }

  const route = routes.find(r => r.path === '/api/suggest-services');
  assert.ok(route, 'the route does not register /api/suggest-services');
  assert.ok(route.handlers.length > 1, 'the route is not rate limited');

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

const ok = (services = ['Water Heater Repair', 'Drain Cleaning', 'Leak Detection']) =>
  async () => ({ services, dropped: [] });

test('the endpoint refuses a request with no business type', async () => {
  const handler = loadRoute({ suggest: ok() });
  const res = fakeRes();

  await handler({ body: {}, user: { credits: 5000 } }, res);

  assert.strictEqual(res.statusCode, 400);
  assert.ok(/business type/i.test(res.body.error), JSON.stringify(res.body));
});

test('the number of ticked boxes comes from the SERVER\'S copy of the balance', async () => {
  // If it came from the request body, anyone could tick twenty boxes by
  // editing one number in the console and land in /generate owing credits
  // they do not have.
  const handler = loadRoute({ suggest: ok() });
  const res = fakeRes();

  await handler({
    body: { businessType: 'Plumbing', location: 'Round Rock, TX', credits: 999999 },
    user: { credits: 300 },
  }, res);

  assert.strictEqual(res.body.checked, 1, JSON.stringify(res.body));
});

test('ticked boxes never exceed the suggestions actually returned', async () => {
  const handler = loadRoute({ suggest: ok(['Drain Cleaning']) });
  const res = fakeRes();

  await handler({
    body: { businessType: 'Plumbing', location: 'Austin, TX' },
    user: { credits: 100000 },
  }, res);

  assert.strictEqual(res.body.checked, 1);
  assert.ok(res.body.affordable > 1, 'the raw budget should still be reported');
});

test('no balance ticks nothing, and the list is still returned in full', async () => {
  // Edwin: "I want the list to show even if the user don't have the budget."
  const handler = loadRoute({ suggest: ok() });
  const res = fakeRes();

  await handler({
    body: { businessType: 'Plumbing', location: 'Austin, TX' },
    user: { credits: 0 },
  }, res);

  assert.strictEqual(res.body.checked, 0);
  assert.strictEqual(res.body.services.length, 3);
});

test('rows and locations already on the form are counted against the budget', async () => {
  const handler = loadRoute({ suggest: ok() });
  const res = fakeRes();

  // 1000 credits: 200 website + 200 for the two rows + 200 for two locations
  // leaves 400, so four more.
  await handler({
    body: {
      businessType: 'Plumbing',
      location: 'Austin, TX',
      existing: ['Drain Cleaning', 'Leak Detection'],
      locationPages: 2,
    },
    user: { credits: 1000 },
  }, res);

  assert.strictEqual(res.body.affordable, 4, JSON.stringify(res.body));
});

test("the rows already on the form are passed on, so they are not suggested back", async () => {
  let sawExclude = null;
  const handler = loadRoute({
    suggest: async (ctx, opts) => { sawExclude = opts.exclude; return ok()(); },
  });

  await handler({
    body: {
      businessType: 'Plumbing',
      location: 'Austin, TX',
      existing: ['Drain Cleaning', '  ', { name: 'Toilet Repair' }],
    },
    user: { credits: 1000 },
  }, fakeRes());

  assert.deepStrictEqual(sawExclude, ['Drain Cleaning', 'Toilet Repair']);
});

test('a model failure is a 502 with something the customer can do about it', async () => {
  const handler = loadRoute({
    suggest: async () => { throw new Error('upstream exploded'); },
  });
  const res = fakeRes();

  await handler({
    body: { businessType: 'Plumbing', location: 'Austin, TX' },
    user: { credits: 1000 },
  }, res);

  assert.strictEqual(res.statusCode, 502);
  assert.ok(/type your services/i.test(res.body.error), JSON.stringify(res.body));
  assert.ok(!/exploded/.test(res.body.error), 'the upstream error text reached the customer');
});

test('a design sample ticks nothing even with credits to spare', async () => {
  const handler = loadRoute({ suggest: ok() });
  const res = fakeRes();

  await handler({
    body: { businessType: 'Plumbing', location: 'Austin, TX', siteMode: 'sample' },
    user: { credits: 5000 },
  }, res);

  assert.strictEqual(res.body.checked, 0);
});

/* -------------------------------------------------------------------------
 * Wiring
 * ---------------------------------------------------------------------- */

function sourceOf(file) {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(__dirname, file), 'utf8');
}

/**
 * Source with comments removed.
 *
 * Every existence check in this file runs through here. Five separate
 * mutations have survived in this project because a comment explaining the
 * code matched the grep looking for the code.
 */
function withoutComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !/^\s*\/\//.test(line))
    .join('\n');
}

test('the endpoint is mounted behind requireAuth', () => {
  // It reads req.user.credits. Mounted without requireAuth, req.user is
  // undefined, every balance is zero and nothing is ever ticked — and the
  // model call is free to anyone who finds the URL.
  const server = withoutComments(sourceOf('server.js'));
  assert.ok(/app\.use\('\/',\s*requireAuth,\s*suggestServicesRoute\)/.test(server),
    'suggestServicesRoute is not mounted behind requireAuth');
});

test('the wizard sends the CSRF token, or every request is rejected', () => {
  const js = withoutComments(sourceOf('public/js/generateDinamycForm.js'));
  const call = js.slice(js.indexOf('/api/suggest-services'));
  assert.ok(/X-CSRF-Token/.test(call.slice(0, 600)), call.slice(0, 400));
});

test('the wizard sends what the budget depends on', () => {
  // businessType and location shape the list; existing rows, locations and
  // the site mode decide how many boxes come back ticked. A missing field
  // here does not fail loudly — it just ticks the wrong number.
  const js = withoutComments(sourceOf('public/js/generateDinamycForm.js'));
  const call = js.slice(js.indexOf("fetch('/api/suggest-services'"));
  const body = call.slice(0, 900);

  for (const field of ['businessType', 'location', 'siteMode', 'locationPages', 'existing']) {
    assert.ok(new RegExp(`${field}:`).test(body), `${field} is not sent`);
  }
});

test('bulk-added rows do not steal focus', () => {
  // Eight rows arriving at once, each focusing itself, drags the page down
  // to the last field while the customer is still reading the list.
  const js = withoutComments(sourceOf('public/js/generateDinamycForm.js'));
  assert.ok(/opts\.focus !== false/.test(js), 'addPageRow always focuses');
  assert.ok(/addPageRow\(pagesList, '', \{ focus: false \}\)/.test(js),
    'the suggestion path does not suppress focus');
});

test('unticking a box takes its row away again', () => {
  const js = withoutComments(sourceOf('public/js/generateDinamycForm.js'));
  assert.ok(/if \(!box\.checked\) \{\s*removePageRow/.test(js),
    'unticking does not remove the row');
});

test('deleting a row unticks the box that put it there', () => {
  // Otherwise the tick sits over a row that no longer exists, and the
  // customer cannot get it back — ticking an already-ticked box fires
  // nothing, so they have to untick and re-tick to work out what happened.
  const js = withoutComments(sourceOf('public/js/generateDinamycForm.js'));
  const handler = js.slice(js.indexOf("classList.contains('btn-remove-page')"));
  const body = handler.slice(0, 600);

  assert.ok(/untickSuggestionFor\(row\)/.test(body), 'the delete button leaves the box ticked');
  assert.ok(body.indexOf('untickSuggestionFor') < body.indexOf('row?.remove()'),
    'the box is cleared after the row is gone, so there is nothing left to find it by');
});

test('the box and its row are linked by an id, not by the text in the field', () => {
  // Rename a suggested row — "Drain Cleaning" to "Drain Cleaning and
  // Jetting" — and a text match stops finding it. Unticking would then do
  // nothing, and deleting would leave the box ticked. The id survives an
  // edit; the words in the field do not.
  const js = withoutComments(sourceOf('public/js/generateDinamycForm.js'));

  const create = js.slice(js.indexOf('function addOrFillPageRow'));
  assert.ok(/if \(key\) row\.dataset\.suggested = key;/.test(create.slice(0, 600)),
    'a row created from a suggestion is not tagged with it');

  assert.ok(/data-key="\$\{escapeHtml\(key\)\}"/.test(js),
    'boxes do not carry the id their row is tagged with');

  const remove = js.slice(js.indexOf('function removePageRow'));
  assert.ok(/rowForSuggestion\(pagesList, key\)/.test(remove.slice(0, 400)),
    'removePageRow still hunts for the row by its text');

  const change = js.slice(js.indexOf("box.addEventListener('change'"));
  assert.ok(/addOrFillPageRow\(pagesList, name, key\)/.test(change.slice(0, 1400)),
    'a row added by ticking a box is not tagged, so unticking cannot find it');
});

test('the id ignores case, spacing and punctuation', () => {
  // Pulled out of the browser file and run, rather than grepped: the whole
  // point of the id is that two spellings of one service reach it as one
  // string, and only running it proves that.
  const js = sourceOf('public/js/generateDinamycForm.js');
  const src = js.match(/function suggestionKey\([\s\S]*?\n {2}\}/);
  assert.ok(src, 'suggestionKey has been renamed or reshaped');

  const suggestionKey = new Function(`${src[0]}; return suggestionKey;`)();

  assert.strictEqual(suggestionKey('  water heater REPAIR '),
                     suggestionKey('Water Heater Repair'));
  assert.strictEqual(suggestionKey('Heating & Cooling'), 'heating-cooling');
  assert.strictEqual(suggestionKey(''), '');
  assert.strictEqual(suggestionKey(null), '');
});

test('a suggestion the customer already typed adopts their row', () => {
  // Rather than adding a second row for the same service — which they would
  // pay for twice and get one page from.
  const js = withoutComments(sourceOf('public/js/generateDinamycForm.js'));
  const render = js.slice(js.indexOf('function renderBatch'));
  const body = render.slice(0, render.indexOf('block.querySelectorAll'));

  assert.ok(/suggestionKey\(input\.value\) === key/.test(body),
    'the list does not look for rows the customer has already typed');
  assert.ok(/mine\.closest\('\.page-row'\)\.dataset\.suggested = key/.test(body),
    "their row is not tagged, so unticking the box will not remove it");
  assert.ok(/if \(!already\) addOrFillPageRow/.test(body),
    'a service already on the form gains a second row');
});

/* -------------------------------------------------------------------------
 * A second list, and no third
 * ---------------------------------------------------------------------- */

test('a second batch is ADDED below the first, not swapped for it', () => {
  // The first version replaced the whole panel, so the second press left the
  // rows from the first batch with no box above them — ticked services the
  // customer could no longer untick. That is the bug Edwin reported.
  const js = withoutComments(sourceOf('public/js/generateDinamycForm.js'));
  const render = js.slice(js.indexOf('function renderBatch'));
  const head = render.slice(0, 700);

  assert.ok(/panel\.appendChild\(block\)/.test(head),
    'the batch is not appended to the panel');
  assert.ok(!/panel\.innerHTML\s*=/.test(render.slice(0, render.indexOf('function mountSuggestPanel'))),
    'something still overwrites the whole panel');
});

test('each batch writes into its own block, not over the last one', () => {
  const js = withoutComments(sourceOf('public/js/generateDinamycForm.js'));
  const render = js.slice(js.indexOf('function renderBatch'));
  assert.ok(/block\.innerHTML = /.test(render.slice(0, 3000)));
});

test('two batches cannot give two boxes the same id', () => {
  // A <label for> pointing at a duplicate id ticks the wrong box.
  const js = withoutComments(sourceOf('public/js/generateDinamycForm.js'));
  assert.ok(/id: `suggest-\$\{batchNumber\}-\$\{i\}`/.test(js),
    'checkbox ids do not include the batch they came from');
});

test('the button stops after two batches', () => {
  const js = withoutComments(sourceOf('public/js/generateDinamycForm.js'));

  assert.ok(/const MAX_SUGGESTION_BATCHES = 2;/.test(js), 'the cap is not 2');

  const sync = js.slice(js.indexOf('function syncButton'));
  assert.ok(/used >= MAX_SUGGESTION_BATCHES/.test(sync.slice(0, 500)),
    'the button is never disabled');
  assert.ok(/button\.disabled = true/.test(sync.slice(0, 500)));

  // And the handler refuses too, so a stale enabled button cannot spend a
  // third call.
  //
  // SCOPED TO mountSuggestPanel. The locations panel has a button handler of
  // its own now, and it is the one an unscoped search finds first — these two
  // assertions started reading it and failed the moment it existed.
  const panel = js.slice(js.indexOf('function mountSuggestPanel'));
  const click = panel.slice(panel.indexOf("button.addEventListener('click'"));
  assert.ok(/length >= MAX_SUGGESTION_BATCHES\) return;/.test(click.slice(0, 700)),
    'the click handler does not enforce the cap itself');
});

test('a restored batch does not resurrect a row that was unticked', () => {
  // Stepping away and back rebuilds this step from scratch. Re-running the
  // "tick the first N" logic would put back every row the customer had
  // deliberately removed.
  const js = withoutComments(sourceOf('public/js/generateDinamycForm.js'));
  const render = js.slice(js.indexOf('function renderBatch'));
  const body = render.slice(0, render.indexOf('block.querySelectorAll'));

  assert.ok(/if \(fresh\) \{/.test(body), 'rows are created regardless of how the batch got here');

  const mount = js.slice(js.indexOf('function mountSuggestPanel'));
  assert.ok(/renderBatch\(panel, pagesList, batch, i, false\)/.test(mount),
    'restored batches are rendered as if they were fresh');
});

test('a box is ticked because its row exists, not because of the budget', () => {
  // One rule for a fresh batch and a restored one. The budget decides which
  // rows get CREATED; after that the form is the truth.
  const js = withoutComments(sourceOf('public/js/generateDinamycForm.js'));
  const render = js.slice(js.indexOf('function renderBatch'));
  assert.ok(/\$\{onForm \? 'checked' : ''\}/.test(render.slice(0, 3500)),
    'the ticks are derived from something other than the rows on the form');
});

test('changing the business type clears the lists and their rows', () => {
  // A plumber's services are wrong for a dentist, and so are the rows they
  // created. Rows typed by hand survive, because nothing made them wrong.
  const js = withoutComments(sourceOf('public/js/generateDinamycForm.js'));
  const mount = js.slice(js.indexOf('function mountSuggestPanel'));
  const body = mount.slice(0, 1600);

  assert.ok(/state\.suggestionsFor !== state\.businessType/.test(body),
    'nothing notices that the business type changed');
  assert.ok(/dropSuggestedRows\(pagesList, state\.suggestionBatches\)/.test(body),
    'the rows from the old business type are left behind');
  assert.ok(/state\.suggestionBatches = \[\];/.test(body),
    'the two presses are not given back');
});

test('clearing suggested rows leaves the ones they typed', () => {
  const js = withoutComments(sourceOf('public/js/generateDinamycForm.js'));
  const drop = js.slice(js.indexOf('function dropSuggestedRows'));
  const body = drop.slice(0, 700);

  assert.ok(/if \(!keys\.has\(suggestionKey\(input\.value\)\)\) return;/.test(body),
    'it removes rows it did not put there');
  assert.ok(/length === 1/.test(body),
    'it can empty the list entirely, leaving nothing to type into');
});

test('a new batch is added to the stored ones, not put in their place', () => {
  // Storing only the latest would make the cap unenforceable and would drop
  // the first list on the way back to this step — rows with no box again.
  const js = withoutComments(sourceOf('public/js/generateDinamycForm.js'));
  const panel = js.slice(js.indexOf('function mountSuggestPanel'));
  const click = panel.slice(panel.indexOf("button.addEventListener('click'"));
  const body = click.slice(0, 1200);

  assert.ok(/suggestionBatches = \(state\.suggestionBatches \|\| \[\]\)\.concat\(\[data\]\)/.test(body),
    'a new batch replaces the stored ones instead of joining them');
  assert.ok(/state\.suggestionsFor = state\.businessType;/.test(body),
    'nothing records which business type this list was for, so changing it is never noticed');
  assert.ok(/suggestionBatches: \[\]/.test(js), 'the batches do not start as a list');
});

test("a new site starts with none of the last one's suggestions", () => {
  const js = withoutComments(sourceOf('public/js/generateDinamycForm.js'));
  const reset = js.slice(js.indexOf('state.mainFormSnapshot  = null;'));
  const body = reset.slice(0, 700);

  assert.ok(/state\.suggestionBatches = \[\];/.test(body),
    "the last site's suggestion lists survive into the next one");
  assert.ok(/state\.suggestionsFor\s*=\s*''/.test(body),
    'the business type they were for survives, so the next site never clears them');
});

/* -------------------------------------------------------------------------
 * Hitting the rate limit
 * ---------------------------------------------------------------------- */

test('a rate-limited reply is JSON, so the customer reads the real reason', () => {
  // express-rate-limit sends a string as plain text; the wizard reads the
  // reply with res.json() and falls back to its own generic wording. So
  // somebody who had used this a lot was told the feature was broken.
  const limits = withoutComments(sourceOf('middleware/rateLimits.js'));

  assert.ok(/function retryJson/.test(limits), 'there is no JSON form of the message');
  assert.ok(/return \{ error: retryMessage\(req, res, what\) \};/.test(limits),
    'the JSON does not use the key the wizard reads');

  const suggest = limits.slice(limits.indexOf('const suggestServicesLimiter'));
  assert.ok(/retryJson\(req, res, 'service suggestions'\)/.test(suggest.slice(0, 500)),
    'the suggest limiter still replies in plain text');
});

test("the blog limiters' replies are left alone", () => {
  // The WordPress plugin already handles what they send. Changing it belongs
  // in a pass where the plugin can be tested alongside.
  const limits = withoutComments(sourceOf('middleware/rateLimits.js'));
  const blog = limits.slice(
    limits.indexOf('const blogApiLimiter'),
    limits.indexOf('const suggestServicesLimiter'));

  assert.ok(blog.length > 200, 'the slice missed the blog limiters entirely');
  assert.ok(!/retryJson/.test(blog), 'a blog limiter had its reply shape changed');
});

test('the hourly allowance is still 15, and still overridable', () => {
  // Lowered to 6 at one point, which would have blocked an agency building
  // five sites in an afternoon — the best customer there is. The two-press
  // cap does the job this was aiming at.
  const limits = withoutComments(sourceOf('middleware/rateLimits.js'));
  const suggest = limits.slice(limits.indexOf('const suggestServicesLimiter'));

  assert.ok(/Number\(process\.env\.SUGGEST_SERVICES_RATE_LIMIT\) \|\| 15/.test(suggest.slice(0, 400)),
    'the allowance or its environment variable changed');
});

/* -------------------------------------------------------------------------
 * What it costs to run
 * ---------------------------------------------------------------------- */

test('the token counts come back with the suggestions', async () => {
  const fakeClient = {
    responses: {
      create: async () => ({
        output_text: '{"services": ["Drain Cleaning"]}',
        usage: { input_tokens: 310, output_tokens: 90, total_tokens: 400 },
      }),
    },
  };

  const out = await suggestServices({ businessType: 'Plumbing', location: 'Austin, TX' },
    { client: fakeClient });

  assert.deepStrictEqual(out.usage, { input: 310, output: 90, total: 400 });
});

test('a reply with no usage block is not a failure', async () => {
  const fakeClient = {
    responses: { create: async () => ({ output_text: '{"services": ["Drain Cleaning"]}' }) },
  };

  const out = await suggestServices({ businessType: 'Plumbing', location: 'Austin, TX' },
    { client: fakeClient });

  assert.deepStrictEqual(out.services, ['Drain Cleaning']);
  assert.strictEqual(out.usage, null);
});

test('a total is worked out when the reply only gives the two halves', async () => {
  const fakeClient = {
    responses: {
      create: async () => ({
        output_text: '{"services": ["Drain Cleaning"]}',
        usage: { prompt_tokens: 200, completion_tokens: 50 },
      }),
    },
  };

  const out = await suggestServices({ businessType: 'Plumbing', location: 'Austin, TX' },
    { client: fakeClient });

  assert.deepStrictEqual(out.usage, { input: 200, output: 50, total: 250 });
});

test('the cost of the call reaches the log', async () => {
  // Without this the only answer to "is this costing me money?" is a guess.
  let logged = null;
  const handler = loadRoute({
    suggest: async () => ({
      services: ['Drain Cleaning'],
      dropped: [],
      usage: { input: 310, output: 90, total: 400 },
    }),
    onLog: (event, fields) => { if (event === 'services.suggested') logged = fields; },
  });

  await handler({
    body: { businessType: 'Plumbing', location: 'Austin, TX' },
    user: { credits: 1000 },
  }, fakeRes());

  assert.ok(logged, 'nothing was logged');
  assert.strictEqual(logged.totalTokens, 400, JSON.stringify(logged));
  assert.strictEqual(logged.inputTokens, 310);
  assert.strictEqual(logged.outputTokens, 90);
});

test('a missing usage block does not break the log line', async () => {
  let logged = null;
  const handler = loadRoute({
    suggest: async () => ({ services: ['Drain Cleaning'], dropped: [] }),
    onLog: (event, fields) => { if (event === 'services.suggested') logged = fields; },
  });

  await handler({
    body: { businessType: 'Plumbing', location: 'Austin, TX' },
    user: { credits: 1000 },
  }, fakeRes());

  assert.ok(logged);
  assert.ok(!logged.totalTokens);
});

test('ticking beyond the budget goes through the same gate as Add page', () => {
  // Otherwise the customer adds a page they cannot pay for and hears nothing
  // until the review step.
  const js = withoutComments(sourceOf('public/js/generateDinamycForm.js'));
  const handler = js.slice(js.indexOf("box.addEventListener('change'"));
  const body = handler.slice(0, 1200);

  assert.ok(/fetchQuote\(\{ extraPages: 1 \}\)/.test(body), 'no credit check on tick');
  assert.ok(/showCreditsModal/.test(body), 'no modal when they cannot afford it');
  assert.ok(/box\.checked = false/.test(body), 'the box stays ticked after a refusal');
});

runAll().then(() => {
  console.log('');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('');
  process.exit(failed === 0 ? 0 : 1);
});
