// test-keyword-volumes.js
//
// The keyword volume module: the cache key, the brand filter, the call, and
// the metro/city pairing.
//
// WHY THIS SUITE IS MOSTLY ABOUT THE CACHE
//
// The decision not to charge for the wizard's lookup rests on the cache
// working. A key that misses when it should hit turns a free feature into
// $0.18 a customer; a key that hits when it should miss serves last month's
// numbers, or another town's. Both are silent. So most of what follows is
// about which questions are the same question.
//
// The logger is stubbed rather than loaded: utils/logger.js pulls in pino,
// and this suite has no business needing a logging stack to check a hash.
//
//   node test-keyword-volumes.js

const assert = require('assert');

/* Stub the logger before the module under test can reach for it. ---------
 *
 * Intercepted at Module._load rather than seeded into require.cache, which is
 * the same trick test-nearby-places.js uses for express. The difference
 * matters: require.cache needs require.resolve to succeed, so seeding it
 * couples this suite to utils/logger.js existing on disk — and the whole
 * point of the lazy require in keywordVolumes.js is that it should not have
 * to. Intercepting the load works either way.
 */
const Module = require('module');
const logged = [];
const realLoad = Module._load;

Module._load = function (request, parent, isMain) {
  if (request === './logger' || request === '../utils/logger') {
    return {
      log: {
        info: (...a) => logged.push(['info', ...a]),
        error: (...a) => logged.push(['error', ...a]),
        warn: (...a) => logged.push(['warn', ...a]),
      },
    };
  }
  return realLoad.call(this, request, parent, isMain);
};

const {
  volumesFor, volumesForArea, fetchVolumes,
  cacheKey, currentMonth, looksLikeBrand, readResult,
  MAX_KEYWORDS, COST_PER_TASK_USD, CACHE_DAYS, NOISE_FLOOR,
} = require('./utils/keywordVolumes');

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
    async findOne({ key }) {
      const hit = store.get(key);
      return hit ? { lean: () => hit } : null;
    },
    async updateOne(filter, update, options) {
      this.writes.push({ filter, update, options });
      store.set(filter.key, update.$set);
    },
  };
}

// findOne().lean() rather than findOne() — match the real call shape.
function fakeModelLean(seed = null) {
  const m = fakeModel(seed);
  m.findOne = ({ key }) => ({ lean: async () => m.store.get(key) || null });
  return m;
}

/** Replace global fetch for one call, and record what was sent. */
function withFetch(handler, fn) {
  const real = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return handler(calls.length);
  };
  return Promise.resolve(fn(calls)).finally(() => { global.fetch = real; });
}

function reply(tasks) {
  return { ok: true, json: async () => ({ tasks }) };
}

function okTask(results, cost = 0.09) {
  return [{ status_code: 20000, status_message: 'Ok.', cost, result: results }];
}

const CREDS = () => {
  process.env.DATAFORSEO_LOGIN = 'test-login';
  process.env.DATAFORSEO_PASSWORD = 'test-password';
};

async function main() {
  console.log('\nKeyword volumes\n');

  /* ---------------------------------------------------------------- *
   * The cache key — which questions are the same question
   * ---------------------------------------------------------------- */

  const base = { location: 'Austin,Texas,United States', language: 'English', month: '2026-09' };

  await test('the same keywords in a different order are one entry', () => {
    // The wizard sends whatever order the suggestions came back in. If that
    // ordering reached the key, every customer would pay for a fresh call.
    assert.strictEqual(
      cacheKey(['water heater repair', 'drain cleaning'], base),
      cacheKey(['drain cleaning', 'water heater repair'], base)
    );
  });

  await test('case and surrounding space do not make a new entry', () => {
    assert.strictEqual(
      cacheKey(['  Water Heater Repair '], base),
      cacheKey(['water heater repair'], base)
    );
  });

  await test('a different town is a different entry', () => {
    // The whole Cedar-Park-versus-Leander evening was this mistake made by
    // hand. The key must not let it happen in the cache.
    assert.notStrictEqual(
      cacheKey(['plumber'], base),
      cacheKey(['plumber'], { ...base, location: 'Cedar Park,Texas,United States' })
    );
  });

  await test('a different month is a different entry', () => {
    assert.notStrictEqual(
      cacheKey(['plumber'], base),
      cacheKey(['plumber'], { ...base, month: '2026-10' })
    );
  });

  await test('a different language is a different entry', () => {
    assert.notStrictEqual(
      cacheKey(['plumber'], base),
      cacheKey(['plumber'], { ...base, language: 'Spanish' })
    );
  });

  await test('one keyword is not confused with two that join up', () => {
    // Without a separator, ['ab','c'] and ['a','bc'] would hash the same.
    assert.notStrictEqual(cacheKey(['ab', 'c'], base), cacheKey(['a', 'bc'], base));
  });

  await test('the month is UTC and zero padded', () => {
    assert.strictEqual(currentMonth(new Date('2026-09-23T02:00:00Z')), '2026-09');
    assert.strictEqual(currentMonth(new Date('2026-01-01T00:00:00Z')), '2026-01');
    // A late-December evening in Texas is already January in UTC. Whichever
    // it picks, it must pick the same one for everybody.
    assert.strictEqual(currentMonth(new Date('2026-12-31T23:00:00Z')), '2026-12');
  });

  /* ---------------------------------------------------------------- *
   * The brand filter
   * ---------------------------------------------------------------- */

  await test('competitor names are recognised as brands', () => {
    // Every one of these came back above the floor in the real Austin run.
    for (const k of ['goettl plumbing', 'bacon plumbing', 'roto rooter plumbing',
                     'rogers plumbing', "wilson's plumbing", 'pecks plumbing']) {
      assert.strictEqual(looksLikeBrand(k, 'Plumbing'), true, `${k} was not flagged`);
    }
  });

  await test('real services are not flagged as brands', () => {
    // A false positive hides a page the customer should have bought, so this
    // is the assertion that matters more.
    for (const k of ['water heater repair', 'drain cleaning services',
                     'emergency plumber near me', 'plumbing repair',
                     'garbage disposal install', 'tankless water heater repair',
                     'shower drain clogged', '24 hour plumber']) {
      assert.strictEqual(looksLikeBrand(k, 'Plumbing'), false, `${k} was flagged`);
    }
  });

  await test('the bare trade is not a brand', () => {
    assert.strictEqual(looksLikeBrand('plumber', 'Plumbing'), false);
    assert.strictEqual(looksLikeBrand('plumbing', 'Plumbing'), false);
  });

  await test('an empty keyword is not a brand', () => {
    assert.strictEqual(looksLikeBrand('', 'Plumbing'), false);
    assert.strictEqual(looksLikeBrand(null, 'Plumbing'), false);
  });

  await test('punctuation does not hide a service word', () => {
    assert.strictEqual(looksLikeBrand('24-hour plumber', 'Plumbing'), false);
  });

  /* ---------------------------------------------------------------- *
   * Reading one row
   * ---------------------------------------------------------------- */

  await test('a row is read into the app\'s shape', () => {
    const r = readResult({
      keyword: ' Water Heater Repair ',
      search_volume: 390,
      cpc: 14.12,
      competition: 'HIGH',
      low_top_of_page_bid: 3.2,
      high_top_of_page_bid: 40,
    });
    assert.deepStrictEqual(r, {
      keyword: 'Water Heater Repair',
      volume: 390,
      cpc: 14.12,
      competition: 'HIGH',
      low: 3.2,
      high: 40,
    });
  });

  await test('a zero volume survives as zero, and a missing one as null', () => {
    // These mean different things: 0 is Google's answer, null is no answer.
    assert.strictEqual(readResult({ keyword: 'x', search_volume: 0 }).volume, 0);
    assert.strictEqual(readResult({ keyword: 'x' }).volume, null);
    assert.strictEqual(readResult({ keyword: 'x', search_volume: null }).volume, null);
  });

  await test('a missing bid is null, not zero', () => {
    // Most rows have no bid. Reading that as $0.00 would say the keyword is
    // free to advertise on, which is the opposite of unknown.
    const r = readResult({ keyword: 'x', search_volume: 10 });
    assert.strictEqual(r.low, null);
    assert.strictEqual(r.high, null);
    assert.strictEqual(r.cpc, null);
  });

  /* ---------------------------------------------------------------- *
   * The call itself
   * ---------------------------------------------------------------- */

  await test('the request carries the keywords, town and language', async () => {
    CREDS();
    await withFetch(() => reply(okTask([{ keyword: 'plumber', search_volume: 2900 }])),
      async (calls) => {
        await fetchVolumes(['plumber'], { location: 'Austin,Texas,United States' });
        const sent = calls[0].body[0];
        assert.deepStrictEqual(sent.keywords, ['plumber']);
        assert.strictEqual(sent.location_name, 'Austin,Texas,United States');
        assert.strictEqual(sent.language_name, 'English');
        assert.strictEqual(sent.search_partners, false);
      });
  });

  await test('a failed task throws rather than reading as an empty answer', async () => {
    CREDS();
    await withFetch(
      () => reply([{ status_code: 40501, status_message: 'Invalid Field', result: null }]),
      async () => {
        // Their transport answers 200 even when the task failed, so a naive
        // res.ok check would hand the customer an empty list and charge for it.
        await assert.rejects(
          () => fetchVolumes(['plumber'], { location: 'Austin' }),
          /40501/
        );
      });
  });

  await test('an HTTP error throws', async () => {
    CREDS();
    await withFetch(() => ({ ok: false, status: 402, json: async () => ({}) }),
      async () => {
        await assert.rejects(
          () => fetchVolumes(['plumber'], { location: 'Austin' }),
          /402/
        );
      });
  });

  await test('a reply with no task at all throws', async () => {
    CREDS();
    await withFetch(() => reply([]), async () => {
      await assert.rejects(() => fetchVolumes(['plumber'], { location: 'Austin' }), /no task/);
    });
  });

  await test('missing credentials are named, not left as a fetch error', async () => {
    const login = process.env.DATAFORSEO_LOGIN;
    const password = process.env.DATAFORSEO_PASSWORD;
    delete process.env.DATAFORSEO_LOGIN;
    delete process.env.DATAFORSEO_PASSWORD;
    try {
      await assert.rejects(
        () => fetchVolumes(['plumber'], { location: 'Austin' }),
        /DATAFORSEO_LOGIN/
      );
    } finally {
      process.env.DATAFORSEO_LOGIN = login;
      process.env.DATAFORSEO_PASSWORD = password;
    }
  });

  await test('an empty list costs nothing and calls nobody', async () => {
    CREDS();
    let called = false;
    await withFetch(() => { called = true; return reply(okTask([])); }, async () => {
      const out = await fetchVolumes([], { location: 'Austin' });
      assert.strictEqual(called, false, 'it called DataForSEO for an empty list');
      assert.strictEqual(out.costUsd, 0);
    });
  });

  await test('more than a thousand keywords are truncated, not rejected', async () => {
    CREDS();
    const many = Array.from({ length: 1500 }, (_, i) => `keyword ${i}`);
    await withFetch(() => reply(okTask([])), async (calls) => {
      await fetchVolumes(many, { location: 'Austin' });
      assert.strictEqual(calls[0].body[0].keywords.length, MAX_KEYWORDS);
    });
  });

  await test('a task with no cost falls back to the known price', async () => {
    // Never log a silent zero: the cost line exists to answer "what is this
    // costing me?" and a zero that means "they did not say" is a wrong answer.
    CREDS();
    await withFetch(() => reply([{ status_code: 20000, result: [] }]), async () => {
      const out = await fetchVolumes(['plumber'], { location: 'Austin' });
      assert.strictEqual(out.costUsd, COST_PER_TASK_USD);
    });
  });

  await test('rows without a keyword are dropped', async () => {
    CREDS();
    await withFetch(
      () => reply(okTask([{ keyword: 'plumber', search_volume: 10 }, null, { search_volume: 5 }])),
      async () => {
        const out = await fetchVolumes(['plumber'], { location: 'Austin' });
        assert.strictEqual(out.results.length, 1);
      });
  });

  /* ---------------------------------------------------------------- *
   * The cache
   * ---------------------------------------------------------------- */

  await test('a hit costs nothing and never reaches the network', async () => {
    CREDS();
    const now = new Date('2026-09-23T02:00:00Z');
    const key = cacheKey(['plumber'], {
      location: 'Austin', language: 'English', month: '2026-09',
    });
    const Model = fakeModelLean({ key, results: [{ keyword: 'plumber', volume: 2900 }] });

    let called = false;
    await withFetch(() => { called = true; return reply(okTask([])); }, async () => {
      const out = await volumesFor(['plumber'], {
        location: 'Austin', Model, now: () => now,
      });
      assert.strictEqual(called, false, 'a cache hit still called DataForSEO');
      assert.strictEqual(out.cached, true);
      assert.strictEqual(out.costUsd, 0);
      assert.strictEqual(out.results[0].volume, 2900);
    });
  });

  await test('a miss fetches, and writes the answer back', async () => {
    CREDS();
    const now = new Date('2026-09-23T02:00:00Z');
    const Model = fakeModelLean();

    await withFetch(() => reply(okTask([{ keyword: 'plumber', search_volume: 2900 }])),
      async () => {
        const out = await volumesFor(['plumber'], {
          location: 'Austin', Model, now: () => now,
        });
        assert.strictEqual(out.cached, false);
        assert.strictEqual(out.costUsd, 0.09);
        assert.strictEqual(Model.writes.length, 1, 'nothing was written to the cache');

        const written = Model.writes[0].update.$set;
        assert.strictEqual(written.location, 'Austin');
        assert.strictEqual(written.keywordCount, 1);
        assert.strictEqual(written.results[0].volume, 2900);
      });
  });

  await test('the write is an upsert, so two customers racing do not collide', async () => {
    CREDS();
    const Model = fakeModelLean();
    await withFetch(() => reply(okTask([])), async () => {
      await volumesFor(['plumber'], { location: 'Austin', Model });
      // Without upsert, the loser of the race gets a duplicate key error
      // thrown at somebody halfway through a form — and `key` is a unique
      // index, so this is not hypothetical.
      assert.strictEqual(Model.writes.length, 1);
      assert.strictEqual((Model.writes[0].options || {}).upsert, true,
        'the cache write is not an upsert');
    });
  });

  await test('the entry expires thirty days out', async () => {
    CREDS();
    const now = new Date('2026-09-23T02:00:00Z');
    const Model = fakeModelLean();
    await withFetch(() => reply(okTask([])), async () => {
      await volumesFor(['plumber'], { location: 'Austin', Model, now: () => now });
      const { expiresAt } = Model.writes[0].update.$set;
      const days = (expiresAt - now) / (24 * 60 * 60 * 1000);
      // THIRTY, WRITTEN OUT. Asserting against CACHE_DAYS would have compared
      // the constant to itself and passed however it was changed — mutation
      // testing caught exactly that. The number is pinned because it is a
      // claim about Google's data, not a preference: the figure is a
      // twelve-month average that moves when a month rolls off, i.e. monthly.
      assert.strictEqual(days, 30);
      assert.strictEqual(CACHE_DAYS, 30);
    });
  });

  await test('a cache read failure pays for the call rather than failing', async () => {
    // Mongo being slow is a reason to spend nine cents, not a reason to show
    // the customer an error.
    CREDS();
    const Model = fakeModelLean();
    Model.findOne = () => ({ lean: async () => { throw new Error('mongo is down'); } });

    logged.length = 0;
    await withFetch(() => reply(okTask([{ keyword: 'plumber', search_volume: 2900 }])),
      async () => {
        const out = await volumesFor(['plumber'], { location: 'Austin', Model });
        assert.strictEqual(out.results[0].volume, 2900);
        assert.ok(logged.some(l => l[1] === 'keywords.cacheReadFailed'),
          'the read failure was swallowed without a log line');
      });
  });

  await test('a cache write failure still returns the answer', async () => {
    CREDS();
    const Model = fakeModelLean();
    Model.updateOne = async () => { throw new Error('mongo is down'); };

    logged.length = 0;
    await withFetch(() => reply(okTask([{ keyword: 'plumber', search_volume: 2900 }])),
      async () => {
        const out = await volumesFor(['plumber'], { location: 'Austin', Model });
        assert.strictEqual(out.results[0].volume, 2900,
          'a failed cache write lost the answer we had already paid for');
        assert.ok(logged.some(l => l[1] === 'keywords.cacheWriteFailed'));
      });
  });

  await test('duplicate keywords are collapsed before the call', async () => {
    CREDS();
    const Model = fakeModelLean();
    await withFetch(() => reply(okTask([])), async (calls) => {
      await volumesFor(['plumber', 'Plumber ', 'plumber', 'drain'], {
        location: 'Austin', Model,
      });
      // "Plumber " differs only by case and space, and cacheKey() treats it
      // as the same question — so the list sent must too, or the same
      // question lands in two cache entries.
      const sent = calls[0].body[0].keywords;
      assert.deepStrictEqual(sent, ['plumber', 'drain'], `sent ${JSON.stringify(sent)}`);
    });
  });

  await test('an empty list never reaches the cache or the network', async () => {
    CREDS();
    const Model = fakeModelLean();
    let called = false;
    await withFetch(() => { called = true; return reply(okTask([])); }, async () => {
      const out = await volumesFor(['', '   ', null], { location: 'Austin', Model });
      assert.strictEqual(called, false);
      assert.strictEqual(out.results.length, 0);
      assert.strictEqual(out.costUsd, 0);
    });
  });

  await test('a missing location is refused rather than guessed', async () => {
    CREDS();
    await assert.rejects(
      () => volumesFor(['plumber'], { Model: fakeModelLean() }),
      /location is required/
    );
  });

  /* ---------------------------------------------------------------- *
   * The metro / city pairing
   * ---------------------------------------------------------------- */

  await test('rows are ordered by the metro, not the city', async () => {
    // The city's numbers are nearly all under the floor, so they cannot order
    // anything. 930 of 993 Austin keywords proved the point.
    CREDS();
    const Model = fakeModelLean();

    await withFetch(
      n => n === 1
        ? reply(okTask([
            { keyword: 'drain cleaning', search_volume: 70 },
            { keyword: 'water heater repair', search_volume: 390 },
          ]))
        : reply(okTask([
            { keyword: 'drain cleaning', search_volume: 10 },
            { keyword: 'water heater repair', search_volume: 10 },
          ])),
      async () => {
        const out = await volumesForArea(['drain cleaning', 'water heater repair'], {
          metro: 'Austin,Texas,United States',
          city: 'Cedar Park,Texas,United States',
          businessType: 'Plumbing',
          Model,
        });
        assert.strictEqual(out.rows[0].keyword, 'water heater repair');
        assert.strictEqual(out.rows[0].metroVolume, 390);
        assert.strictEqual(out.rows[0].cityVolume, 10);
      });
  });

  await test('a keyword the city has no row for still shows its metro number', async () => {
    CREDS();
    const Model = fakeModelLean();
    await withFetch(
      n => n === 1
        ? reply(okTask([{ keyword: 'repipe specialists', search_volume: 90 }]))
        : reply(okTask([])),
      async () => {
        const out = await volumesForArea(['repipe specialists'], {
          metro: 'Austin', city: 'Cedar Park', Model,
        });
        assert.strictEqual(out.rows[0].metroVolume, 90);
        assert.strictEqual(out.rows[0].cityVolume, null);
      });
  });

  await test('a business already in the metro is not charged twice', async () => {
    CREDS();
    const Model = fakeModelLean();
    let calls = 0;
    await withFetch(() => { calls++; return reply(okTask([{ keyword: 'plumber', search_volume: 2900 }])); },
      async () => {
        const out = await volumesForArea(['plumber'], {
          metro: 'Austin,Texas,United States',
          city: 'Austin,Texas,United States',
          Model,
        });
        assert.strictEqual(calls, 1, 'it asked about the same place twice');
        assert.strictEqual(out.costUsd, 0.09);
      });
  });

  await test('a business in its own metro is not charged twice EVEN IF MONGO IS DOWN', async () => {
    // The guard on `city !== metro` looks redundant, because normally the
    // metro's answer is in the cache by the time the city is asked for and
    // the second call is a hit. Mutation testing showed removing it broke
    // nothing — until the cache is unavailable. Then the two identical
    // questions both reach DataForSEO and the lookup costs $0.18 for one
    // answer, at exactly the moment things are already going wrong.
    CREDS();
    const Model = fakeModelLean();
    Model.updateOne = async () => { throw new Error('mongo is down'); };

    let calls = 0;
    await withFetch(() => { calls++; return reply(okTask([{ keyword: 'plumber', search_volume: 2900 }])); },
      async () => {
        const out = await volumesForArea(['plumber'], {
          metro: 'Austin,Texas,United States',
          city: 'Austin,Texas,United States',
          Model,
        });
        assert.strictEqual(calls, 1, 'it paid twice for the same town');
        assert.strictEqual(out.costUsd, 0.09);
      });
  });

  await test('the cost of both halves is added up', async () => {
    CREDS();
    const Model = fakeModelLean();
    await withFetch(() => reply(okTask([{ keyword: 'plumber', search_volume: 10 }])),
      async () => {
        const out = await volumesForArea(['plumber'], {
          metro: 'Austin', city: 'Cedar Park', Model,
        });
        assert.ok(Math.abs(out.costUsd - 0.18) < 1e-9, `costUsd was ${out.costUsd}`);
      });
  });

  await test('the pair only counts as cached when BOTH halves were', async () => {
    CREDS();
    const now = new Date('2026-09-23T02:00:00Z');
    const metroKey = cacheKey(['plumber'], {
      location: 'Austin', language: 'English', month: '2026-09',
    });
    const Model = fakeModelLean({ key: metroKey, results: [{ keyword: 'plumber', volume: 2900 }] });

    await withFetch(() => reply(okTask([{ keyword: 'plumber', search_volume: 10 }])),
      async () => {
        const out = await volumesForArea(['plumber'], {
          metro: 'Austin', city: 'Cedar Park', Model, now: () => now,
        });
        // The metro hit, the city missed. Charging this to the rate limiter as
        // free would let somebody mine the city half for nothing.
        assert.strictEqual(out.cached, false);
        assert.strictEqual(out.costUsd, 0.09);
      });
  });

  await test('brands are flagged on the rows, not removed from them', async () => {
    // Flagged, so the caller decides. Removing here would hide the decision
    // in a module the customer never sees.
    CREDS();
    const Model = fakeModelLean();
    await withFetch(
      n => n === 1
        ? reply(okTask([
            { keyword: 'goettl plumbing', search_volume: 90 },
            { keyword: 'water heater repair', search_volume: 390 },
          ]))
        : reply(okTask([])),
      async () => {
        const out = await volumesForArea(['goettl plumbing', 'water heater repair'], {
          metro: 'Austin', city: 'Cedar Park', businessType: 'Plumbing', Model,
        });
        assert.strictEqual(out.rows.length, 2, 'a row was removed');
        const byName = Object.fromEntries(out.rows.map(r => [r.keyword, r.brand]));
        assert.strictEqual(byName['goettl plumbing'], true);
        assert.strictEqual(byName['water heater repair'], false);
      });
  });

  await test('a missing metro is refused', async () => {
    CREDS();
    await assert.rejects(
      () => volumesForArea(['plumber'], { city: 'Cedar Park', Model: fakeModelLean() }),
      /metro is required/
    );
  });

  await test('the noise floor is the measured one', () => {
    // Not a taste. 930 of 993 Austin keywords sit at or under it; moving it
    // changes what the customer is shown, so it changes with evidence.
    assert.strictEqual(NOISE_FLOOR, 40);
  });

  /* ---------------------------------------------------------------- *
   * The endpoint
   *
   * Loaded with express, the limiter and the volume module stubbed, so what
   * runs is the ROUTE's own logic: what it validates, how it spells a town,
   * and — the part that matters — when it spends somebody's rate-limit
   * budget. The module underneath has its own tests above.
   * ---------------------------------------------------------------- */

  function loadRoute({ onLog, volumes, cached, limiter } = {}) {
    const path = require('path');
    const routes = [];
    const fakeRouter = { post(p, ...h) { routes.push({ path: p, handlers: h }); } };

    const outerLoad = Module._load;

    Module._load = function (request, parent, isMain) {
      if (request === 'express') return { Router: () => fakeRouter };
      // Checked BEFORE delegating: the suite-wide stub further out collects
      // into `logged`, which is the wrong place for a per-test assertion.
      if (onLog && /logger$/.test(request)) {
        return { log: { info: (e, f) => onLog(e, f), error: (e, f) => onLog(e, f) } };
      }
      if (/rateLimits$/.test(request)) {
        return { keywordVolumesLimiter: limiter || ((req, res, next) => next()) };
      }
      if (/keywordVolumes$/.test(request)) {
        const real = outerLoad.call(this, request, parent, isMain);
        return {
          ...real,
          volumesForArea: volumes || (async () => ({ rows: [], cached: false, costUsd: 0 })),
          cachedVolumesFor: cached || (async () => null),
        };
      }
      return outerLoad.call(this, request, parent, isMain);
    };

    const file = path.join(__dirname, 'routes/keywordVolumesRoute.js');
    let mod;
    try {
      delete require.cache[require.resolve(file)];
      mod = require(file);
    } finally {
      Module._load = outerLoad;
    }

    const route = routes.find(r => r.path === '/api/keyword-volumes');
    assert.ok(route, 'the route does not register /api/keyword-volumes');

    return { mod, route, handler: route.handlers[route.handlers.length - 1] };
  }

  function fakeRes() {
    return {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    };
  }

  await test('a town is spelled the way Google spells it', () => {
    const { mod } = loadRoute();
    assert.strictEqual(mod.toLocationName('Cedar Park, TX'), 'Cedar Park,Texas,United States');
    assert.strictEqual(mod.toLocationName('Austin,TX'), 'Austin,Texas,United States');
    // Already a full name: leave it alone rather than mangling it.
    assert.strictEqual(
      mod.toLocationName('Austin,Texas,United States'),
      'Austin,Texas,United States'
    );
  });

  await test('a town with no usable state is refused, not guessed', () => {
    // DataForSEO matches against Google's own geo names. "Austin,TX,United
    // States" matches nothing, so guessing would spend $0.09 on an error.
    const { mod } = loadRoute();
    assert.strictEqual(mod.toLocationName('Austin'), '');
    assert.strictEqual(mod.toLocationName('Austin, ZZ'), '');
    assert.strictEqual(mod.toLocationName(''), '');
    assert.strictEqual(mod.toLocationName(null), '');
  });

  await test('the request is capped and deduped before anything is spent', () => {
    const { mod } = loadRoute();
    const many = Array.from({ length: 200 }, (_, i) => `keyword ${i}`);
    assert.strictEqual(mod.requestedKeywords(many).length, mod.MAX_REQUESTED);
    assert.deepStrictEqual(mod.requestedKeywords(['a', 'A ', 'b']), ['a', 'b']);
    assert.deepStrictEqual(mod.requestedKeywords('not an array'), []);
  });

  await test('no keywords is a 400 that says what to do', async () => {
    const { handler } = loadRoute();
    const res = fakeRes();
    await handler({ body: { metro: 'Austin, TX' } }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.body.error, /services first/i);
  });

  await test('no usable location is a 400 that names the format', async () => {
    const { handler } = loadRoute();
    const res = fakeRes();
    await handler({ body: { keywords: ['water heater repair'], metro: 'Austin' } }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.body.error, /City, ST/);
  });

  await test('the answer carries the rows, both towns and the floor', async () => {
    const { handler } = loadRoute({
      volumes: async () => ({
        rows: [{ keyword: 'water heater repair', metroVolume: 390, cityVolume: 10, brand: false }],
        cached: false,
        costUsd: 0.18,
      }),
    });
    const res = fakeRes();
    await handler({
      body: { keywords: ['water heater repair'], metro: 'Austin, TX', city: 'Cedar Park, TX' },
    }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.rows[0].metroVolume, 390);
    assert.strictEqual(res.body.metro, 'Austin,Texas,United States');
    assert.strictEqual(res.body.city, 'Cedar Park,Texas,United States');
    // The page must not pick its own threshold: it is a fact about Google's
    // reporting, measured at 930 of 993 Austin keywords.
    assert.strictEqual(res.body.noiseFloor, NOISE_FLOOR);
  });

  await test('the cost and the cache hit are logged, because nothing else records them', async () => {
    const seen = [];
    const { handler } = loadRoute({
      onLog: (event, fields) => seen.push({ event, fields }),
      volumes: async () => ({
        rows: [{ keyword: 'goettl plumbing', metroVolume: 90, brand: true }],
        cached: true,
        costUsd: 0,
      }),
    });
    await handler({ body: { keywords: ['goettl plumbing'], metro: 'Austin, TX' } }, fakeRes());

    const line = seen.find(l => l.event === 'keywords.looked');
    assert.ok(line, 'nothing was logged');
    assert.strictEqual(line.fields.cached, true);
    assert.strictEqual(line.fields.costUsd, 0);
    assert.strictEqual(line.fields.brands, 1);
  });

  await test('a failure says the services are still there', async () => {
    // The customer is mid-form. "It broke" reads as "you lost your work".
    const { handler } = loadRoute({
      volumes: async () => { throw new Error('DataForSEO is down'); },
    });
    const res = fakeRes();
    await handler({ body: { keywords: ['plumber'], metro: 'Austin, TX' } }, res);

    assert.strictEqual(res.statusCode, 502);
    assert.match(res.body.error, /still here/i);
    assert.match(res.body.error, /carry on/i);
  });

  /* The part the whole pricing decision rests on. ------------------- */

  await test('a cache hit never reaches the rate limiter', async () => {
    // A hit costs nothing. Spending an hourly slot on it would lock out the
    // customers the cache was built to serve.
    let limited = false;
    const { route } = loadRoute({
      cached: async () => [{ keyword: 'plumber', volume: 2900 }],
      limiter: (req, res, next) => { limited = true; next(); },
    });

    const gate = route.handlers[0];
    let passedThrough = false;
    const req = { body: { keywords: ['plumber'], metro: 'Austin, TX', city: 'Cedar Park, TX' } };
    await gate(req, fakeRes(), () => { passedThrough = true; });

    assert.strictEqual(limited, false, 'a free answer spent a rate-limit slot');
    assert.strictEqual(passedThrough, true);
    assert.strictEqual(req.keywordsWereCached, true);
  });

  await test('a cache miss does reach the rate limiter', async () => {
    let limited = false;
    const { route } = loadRoute({
      cached: async () => null,
      limiter: (req, res, next) => { limited = true; next(); },
    });

    const gate = route.handlers[0];
    await gate(
      { body: { keywords: ['plumber'], metro: 'Austin, TX' } },
      fakeRes(),
      () => {}
    );

    assert.strictEqual(limited, true, 'a paid call skipped the limiter');
  });

  await test('a peek that throws falls back to the limiter, not to free', async () => {
    // Which way to fail matters: a slot spent on a call that might have been
    // free is recoverable, a free-for-all while Mongo is down is not.
    let limited = false;
    const { route } = loadRoute({
      cached: async () => { throw new Error('mongo is down'); },
      limiter: (req, res, next) => { limited = true; next(); },
    });

    const gate = route.handlers[0];
    await gate(
      { body: { keywords: ['plumber'], metro: 'Austin, TX' } },
      fakeRes(),
      () => {}
    );

    assert.strictEqual(limited, true, 'a broken cache became unlimited free lookups');
  });

  await test('half a cache hit is still a miss', async () => {
    // The metro held, the city did not. That call still costs $0.09.
    let limited = false;
    let asked = 0;
    const { route } = loadRoute({
      cached: async ({ location }) => {
        asked++;
        return /Austin/.test(location) ? [{ keyword: 'plumber', volume: 2900 }] : null;
      },
      limiter: (req, res, next) => { limited = true; next(); },
    });

    const gate = route.handlers[0];
    await gate(
      { body: { keywords: ['plumber'], metro: 'Austin, TX', city: 'Cedar Park, TX' } },
      fakeRes(),
      () => {}
    );

    assert.strictEqual(asked, 2, 'it did not peek at both towns');
    assert.strictEqual(limited, true);
  });

  await test('a request with nothing in it goes to the limiter, not past it', async () => {
    // Otherwise an empty body is a free pass through the gate, forever.
    let limited = false;
    const { route } = loadRoute({
      cached: async () => [{ keyword: 'x', volume: 1 }],
      limiter: (req, res, next) => { limited = true; next(); },
    });

    const gate = route.handlers[0];
    await gate({ body: {} }, fakeRes(), () => {});

    assert.strictEqual(limited, true);
  });

  console.log('');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('');
  process.exit(failed === 0 ? 0 : 1);
}

main();
