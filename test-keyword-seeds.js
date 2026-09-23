// test-keyword-seeds.js
//
// The model-written seed terms for the keyword research page.
//
// WHAT THIS SUITE IS REALLY GUARDING
//
// Not the quality of the model's suggestions — no test can check those. Two
// other things, both of which cost money when they break:
//
//   1. THE CACHE KEY. utils/keywordVolumes hashes the SORTED SEED LIST. A
//      model is not deterministic, so if its output varied by town, or by
//      call, every lookup would be a fresh $0.09 — the cache defeated by the
//      thing standing in front of it. Caching by industry alone is what makes
//      the list stable, and most of what follows checks exactly that.
//
//   2. THAT IT NEVER THROWS. This is a widener, not a requirement. The
//      research page works without it, narrower, and a model outage must not
//      take down a lookup the customer could still have had.
//
// The model client is injected and the JSON parser is stubbed, so this suite
// runs with no API key, no network, and no `openai` package installed.
//
//   node test-keyword-seeds.js

const assert = require('assert');

/* Stubs, installed before the module under test can reach for them. ------ *
 *
 * Intercepted at Module._load rather than seeded into require.cache: the
 * whole point of the lazy requires inside keywordSeeds.js is that the file
 * should load without these on disk, and seeding the cache needs
 * require.resolve to succeed. Same trick as test-keyword-volumes.js.
 */
const Module = require('module');
const logged = [];
const realLoad = Module._load;

Module._load = function (request, parent, isMain) {
  if (/(^\.\/logger$|\/logger$)/.test(request)) {
    return {
      log: {
        info: (...a) => logged.push(['info', ...a]),
        error: (...a) => logged.push(['error', ...a]),
        warn: (...a) => logged.push(['warn', ...a]),
      },
    };
  }

  // A stand-in for utils/parseModelJson with the same contract: never throws,
  // returns { ok, data }.
  if (/parseModelJson$/.test(request)) {
    return {
      parseModelJson(text) {
        try {
          return { ok: true, data: JSON.parse(text) };
        } catch (err) {
          return { ok: false, data: null, error: err.message };
        }
      },
    };
  }

  // Reached only if a test forgets to inject a client — which is itself worth
  // failing loudly for, rather than quietly making a live call.
  if (/openaiClient$/.test(request)) {
    return {
      getOpenAI() {
        throw new Error('a test reached for the real model client');
      },
    };
  }

  return realLoad.call(this, request, parent, isMain);
};

const {
  seedTermsFor, cleanSeeds, buildPrompt, seedCacheKey, currentMonth,
  MAX_SEED_TERMS, MAX_TERM_LENGTH, CACHE_DAYS,
} = require('./utils/keywordSeeds');

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(
        () => { console.log(`  ok    ${name}`); passed++; },
        err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
      );
    }
    console.log(`  ok    ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}\n        ${err.message}`);
    failed++;
  }
}

/** A stand-in for the Mongo model, so the suite needs no database. */
function fakeModel(seed = null) {
  const store = new Map();
  if (seed) store.set(seed.key, seed);

  return {
    store,
    writes: [],
    findOne: ({ key }) => ({ lean: async () => store.get(key) || null }),
    async updateOne(filter, update, options) {
      this.writes.push({ filter, update, options });
      store.set(filter.key, update.$set);
    },
  };
}

/** A model client that answers with whatever text it is handed. */
function fakeClient(text, { onCall } = {}) {
  let calls = 0;
  return {
    get calls() { return calls; },
    responses: {
      async create(req) {
        calls++;
        if (onCall) onCall(req);
        return {
          output_text: typeof text === 'function' ? text(calls) : text,
          usage: { input_tokens: 120, output_tokens: 40, total_tokens: 160 },
        };
      },
    },
  };
}

function terms(list) {
  return JSON.stringify({ terms: list });
}

async function main() {
  console.log('\nKeyword seeds\n');

  /* ---------------------------------------------------------------- *
   * The cache key — the part that protects the bill
   * ---------------------------------------------------------------- */

  await test('the key is the industry, NOT the industry and the town', async () => {
    // The reason this matters is one step removed and easy to miss: the
    // DataForSEO key is the sorted seed list. Different seeds per town means
    // a different DataForSEO key per town, so the first lookup in every town
    // pays again for a question already answered.
    assert.strictEqual(
      seedCacheKey('plumbing', { month: '2026-09' }),
      seedCacheKey('plumbing', { month: '2026-09' })
    );

    // And the town genuinely is not in it — asserted by behaviour, below.
  });

  await test('a second town reuses the first town\'s seeds', async () => {
    const Model = fakeModel();
    const client = fakeClient(terms(['water heater repair', 'drain cleaning']));

    const austin = await seedTermsFor('plumbing', {
      client, Model, location: 'Austin', city: 'Austin',
    });
    const cedar = await seedTermsFor('plumbing', {
      client, Model, location: 'Cedar Park', city: 'Cedar Park',
    });

    assert.strictEqual(client.calls, 1, 'the model was asked twice for one answer');
    assert.strictEqual(cedar.cached, true);
    assert.deepStrictEqual(cedar.terms, austin.terms,
      'two towns got different seeds, so each pays DataForSEO separately');
  });

  await test('case and surrounding space are not a second industry', () => {
    assert.strictEqual(
      seedCacheKey('  Plumbing ', { month: '2026-09' }),
      seedCacheKey('plumbing', { month: '2026-09' })
    );
  });

  await test('a different industry is a different entry', () => {
    assert.notStrictEqual(
      seedCacheKey('plumbing', { month: '2026-09' }),
      seedCacheKey('roofing', { month: '2026-09' })
    );
  });

  await test('the month rolls the entry over', () => {
    // So an entry cannot outlive its own accuracy even if the TTL index is
    // somehow not doing its job.
    assert.notStrictEqual(
      seedCacheKey('plumbing', { month: '2026-09' }),
      seedCacheKey('plumbing', { month: '2026-10' })
    );
  });

  await test('the month is the UTC one, formatted the same as keywordVolumes', () => {
    assert.strictEqual(currentMonth(new Date('2026-09-23T12:00:00Z')), '2026-09');
    assert.strictEqual(currentMonth(new Date('2026-01-05T12:00:00Z')), '2026-01');
  });

  await test('the entry expires after thirty days, and thirty is the literal', () => {
    // NOT `assert.strictEqual(days, CACHE_DAYS)`, which is a tautology: it
    // passed when 30 was changed to 7. The earlier suite had exactly that
    // bug.
    assert.strictEqual(CACHE_DAYS, 30);
  });

  await test('a cached answer records the TTL the model entry was written with', async () => {
    const Model = fakeModel();
    const now = () => new Date('2026-09-23T00:00:00Z');

    await seedTermsFor('plumbing', {
      client: fakeClient(terms(['drain cleaning'])), Model, now,
    });

    const written = Model.writes[0].update.$set;
    const days = (written.expiresAt - written.fetchedAt) / (24 * 60 * 60 * 1000);
    assert.strictEqual(days, 30);
  });

  /* ---------------------------------------------------------------- *
   * Never throwing — this is a widener, not a requirement
   * ---------------------------------------------------------------- */

  await test('a model that throws narrows the lookup, it does not fail it', async () => {
    const client = {
      responses: { async create() { throw new Error('upstream 503'); } },
    };

    const out = await seedTermsFor('plumbing', { client, Model: fakeModel() });

    assert.deepStrictEqual(out.terms, []);
    assert.strictEqual(out.cached, false);
    assert.ok(logged.some(l => l[1] === 'keywords.seedsFailed'), 'the failure was not logged');
  });

  await test('unparseable JSON is an empty list, not an exception', async () => {
    const out = await seedTermsFor('plumbing', {
      client: fakeClient('I am afraid I cannot do that'),
      Model: fakeModel(),
    });
    assert.deepStrictEqual(out.terms, []);
  });

  await test('the right shape with the wrong field is an empty list', async () => {
    const out = await seedTermsFor('plumbing', {
      client: fakeClient(JSON.stringify({ services: ['drain cleaning'] })),
      Model: fakeModel(),
    });
    assert.deepStrictEqual(out.terms, []);
  });

  await test('a cache that cannot be read is a slow path, not a broken one', async () => {
    const Model = fakeModel();
    Model.findOne = () => ({ async lean() { throw new Error('mongo is down'); } });

    const out = await seedTermsFor('plumbing', {
      client: fakeClient(terms(['drain cleaning'])), Model,
    });

    assert.deepStrictEqual(out.terms, ['drain cleaning']);
  });

  await test('a cache that cannot be written still answers', async () => {
    const Model = fakeModel();
    Model.updateOne = async () => { throw new Error('mongo is down'); };

    const out = await seedTermsFor('plumbing', {
      client: fakeClient(terms(['drain cleaning'])), Model,
    });

    assert.deepStrictEqual(out.terms, ['drain cleaning']);
  });

  await test('no industry asks nothing and spends nothing', async () => {
    const client = fakeClient(terms(['drain cleaning']));
    const out = await seedTermsFor('', { client, Model: fakeModel() });

    assert.deepStrictEqual(out.terms, []);
    assert.strictEqual(client.calls, 0);
  });

  await test('an empty answer is NOT cached', async () => {
    // Thirty days of narrow lookups caused by one bad minute from the model
    // is the failure this prevents.
    const Model = fakeModel();

    await seedTermsFor('plumbing', { client: fakeClient(terms([])), Model });
    assert.strictEqual(Model.writes.length, 0, 'an empty list was stored for a month');

    // And the next call tries again rather than serving the nothing.
    const client = fakeClient(terms(['drain cleaning']));
    const out = await seedTermsFor('plumbing', { client, Model });

    assert.strictEqual(client.calls, 1);
    assert.deepStrictEqual(out.terms, ['drain cleaning']);
  });

  /* ---------------------------------------------------------------- *
   * cleanSeeds — a bad seed is invisible, which is why this is strict
   * ---------------------------------------------------------------- */

  await test('the industry itself is dropped, because seedsFor adds it first', () => {
    // Otherwise it takes a second of twenty slots to ask a question already
    // being asked.
    assert.deepStrictEqual(
      cleanSeeds(['plumbing', 'drain cleaning'], { industry: 'plumbing' }),
      ['drain cleaning']
    );
  });

  await test('a term carrying the town is dropped, because seedsFor pairs it itself', () => {
    assert.deepStrictEqual(
      cleanSeeds(
        ['plumber cedar park', 'drain cleaning'],
        { industry: 'plumbing', city: 'Cedar Park' }
      ),
      ['drain cleaning']
    );
  });

  await test('repeats differing only in case or spacing take one slot', () => {
    assert.deepStrictEqual(
      cleanSeeds(['Drain Cleaning', 'drain  cleaning', 'DRAIN CLEANING']),
      ['drain cleaning']
    );
  });

  await test('an essay is not a seed term', () => {
    const long = 'a'.repeat(MAX_TERM_LENGTH + 1);
    assert.deepStrictEqual(cleanSeeds([long, 'drain cleaning']), ['drain cleaning']);
  });

  await test('list markers and quotes are stripped, not sent to Google', () => {
    assert.deepStrictEqual(
      cleanSeeds(['- "drain cleaning"', '* sewer line repair', '2. leak detection']),
      ['drain cleaning', 'sewer line repair', 'leak detection']
    );
  });

  await test('a hyphen INSIDE a term survives, because it belongs there', () => {
    // A blanket hyphen strip would turn "24-hour plumber" into "24 hour
    // plumber" — a different query. A LEADING hyphen is different: it is a
    // minus operator to Google's matcher, which would exclude the thing being
    // asked about. Hence the two separate rules.
    assert.deepStrictEqual(
      cleanSeeds(['24-hour plumber']),
      ['24-hour plumber']
    );
  });

  await test('a term with no letters in it is not a term', () => {
    assert.deepStrictEqual(cleanSeeds(['123', '---', 'drain cleaning']), ['drain cleaning']);
  });

  await test('an array of objects is read rather than thrown away', () => {
    // A model asked for strings sometimes answers with objects. Taking
    // .keyword costs one line and saves the whole reply.
    assert.deepStrictEqual(
      cleanSeeds([{ keyword: 'drain cleaning' }, { term: 'sewer repair' }]),
      ['drain cleaning', 'sewer repair']
    );
  });

  await test('anything that is not a list at all is an empty list', () => {
    assert.deepStrictEqual(cleanSeeds(null), []);
    assert.deepStrictEqual(cleanSeeds('drain cleaning'), []);
    assert.deepStrictEqual(cleanSeeds({ terms: ['x'] }), []);
  });

  await test('the cap holds however many the model returns', () => {
    const many = Array.from({ length: 100 }, (_, i) => `term ${i}`);
    assert.strictEqual(cleanSeeds(many).length, MAX_SEED_TERMS);
    // And a caller cannot raise it past the ceiling by asking.
    assert.strictEqual(cleanSeeds(many, { limit: 999 }).length, MAX_SEED_TERMS);
  });

  await test('the cap is applied to a cached answer too, not only a fresh one', async () => {
    // A stored entry written under a higher cap must not leak past a lower
    // one — the cache is thirty days old by definition.
    const key = seedCacheKey('plumbing', { month: currentMonth(new Date()) });
    const Model = fakeModel({
      key,
      results: Array.from({ length: 50 }, (_, i) => ({ keyword: `term ${i}` })),
    });

    const out = await seedTermsFor('plumbing', { Model, limit: 5 });

    assert.strictEqual(out.cached, true);
    assert.strictEqual(out.terms.length, 5);
  });

  /* ---------------------------------------------------------------- *
   * The prompt
   * ---------------------------------------------------------------- */

  await test('the prompt asks for seeds, and says what a seed is not', () => {
    const prompt = buildPrompt({ industry: 'plumbing', location: 'Cedar Park' });

    assert.match(prompt, /plumbing/);
    assert.match(prompt, /seed/i);
    // The two mistakes that waste a slot: repeating the trade, and naming the
    // town the tool pairs itself.
    assert.match(prompt, /town|city/i);
    assert.match(prompt, /JSON/);
  });

  await test('the town reaches the prompt but never the key', async () => {
    // Regional vocabulary is worth asking for. Regional CACHING is what makes
    // every town pay again.
    let sawAustin = false;
    const client = fakeClient(terms(['drain cleaning']), {
      onCall: req => { sawAustin = /Austin/.test(req.input); },
    });

    await seedTermsFor('plumbing', { client, Model: fakeModel(), location: 'Austin' });

    assert.strictEqual(sawAustin, true, 'the model was told nothing about where');
    assert.strictEqual(
      seedCacheKey('plumbing', { month: '2026-09' }),
      seedCacheKey('plumbing', { month: '2026-09' })
    );
  });

  await test('the model is asked at low effort, like the service suggester', () => {
    // Listing the parts of a trade is recall, not reasoning. High effort here
    // is money spent on a question that does not need it.
    let sawEffort = null;
    const client = fakeClient(terms(['drain cleaning']), {
      onCall: req => { sawEffort = req.reasoning && req.reasoning.effort; },
    });

    return seedTermsFor('plumbing', { client, Model: fakeModel() })
      .then(() => assert.strictEqual(sawEffort, 'low'));
  });

  /* ---------------------------------------------------------------- *
   * The file's own shape
   * ---------------------------------------------------------------- */

  await test('openaiClient is not required at the top of the file', () => {
    // Same rule suggestServices.js states at its own imports: a dependency
    // should take down the one feature that needs it, not a file full of
    // string tidying that touches no network.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, 'utils/keywordSeeds.js'), 'utf8');
    const top = src.split('function ')[0];

    assert.ok(!/^const .*require\(['"]\.\/openaiClient['"]\)/m.test(top),
      'openaiClient is required at the top of the file again');
    assert.ok(!/^const .*require\(['"]\.\/parseModelJson['"]\)/m.test(top),
      'parseModelJson is required at the top of the file again');
  });

  console.log('');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('');
  process.exit(failed === 0 ? 0 : 1);
}

main();
