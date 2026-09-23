// test-keyword-research.js
//
// The keyword research page: the tools sidebar, the discovery lookup, and the
// endpoint behind them.
//
// WHY THE EMPTY CASES GET SO MUCH ATTENTION HERE
//
// Three different situations produce a table with no rows in it — the minimum
// is above everything this town has, the town has nothing for that trade, and
// the lookup failed. They are indistinguishable to look at and completely
// different to act on. Most of what follows checks that the code can still
// tell them apart by the time the page has to say something.
//
//   node test-keyword-research.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

/* The logger pulls in pino; a hash does not need a logging stack. --------- */
const Module = require('module');
const realLoad = Module._load;

Module._load = function (request, parent, isMain) {
  if (/(^\.\/logger$|\/logger$)/.test(request)) {
    return { log: { info() {}, error() {}, warn() {} } };
  }
  return realLoad.call(this, request, parent, isMain);
};

const { appSidebar, appSidebarAssets } = require('./utils/appHeader');
const {
  keywordIdeasFor, volumesFor, cacheKey, seedsFor, fetchIdeas, isBillingError,
  looksLikeBrand, geoWords, stem, MAX_IDEAS, MAX_SEEDS,
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

function fakeModel(seed = null) {
  const store = new Map();
  if (seed) store.set(seed.key, seed);
  const m = {
    store,
    writes: [],
    findOne: ({ key }) => ({ lean: async () => store.get(key) || null }),
    async updateOne(filter, update, options) {
      this.writes.push({ filter, update, options });
      store.set(filter.key, update.$set);
    },
  };
  return m;
}

function withFetch(handler, fn) {
  const real = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return handler(calls.length);
  };
  return Promise.resolve(fn(calls)).finally(() => { global.fetch = real; });
}

function ideasReply(results, cost = 0.09) {
  return {
    ok: true,
    json: async () => ({ tasks: [{ status_code: 20000, cost, result: results }] }),
  };
}

const CREDS = () => {
  process.env.DATAFORSEO_LOGIN = 'test-login';
  process.env.DATAFORSEO_PASSWORD = 'test-password';
};

/** Shaped like a real Austin plumbing reply: a few big, a long tail, a brand. */
const AUSTIN = [
  { keyword: 'plumber', search_volume: 2900, cpc: 26.51 },
  { keyword: 'plumbers near me', search_volume: 2900, cpc: 31.88 },
  { keyword: 'water heater replacement', search_volume: 390, cpc: 14.12 },
  { keyword: 'emergency plumbing services', search_volume: 260, cpc: 19.36 },
  { keyword: 'plumbing repair', search_volume: 210, cpc: 7.05 },
  { keyword: 'goettl plumbing', search_volume: 90, cpc: 8.32 },
  { keyword: 'drain cleaning companies', search_volume: 70, cpc: null },
  { keyword: 'toilet plumber', search_volume: 10, cpc: null },
  { keyword: 'no volume at all', search_volume: null, cpc: null },
];

async function main() {
  console.log('\nKeyword research\n');

  /* ---------------------------------------------------------------- *
   * The tools sidebar
   * ---------------------------------------------------------------- */

  await test('the sidebar links every tool a customer can reach', () => {
    const html = appSidebar('/');
    for (const href of ['/', '/keyword-research', '/blog-sites', '/dashboard']) {
      assert.ok(html.includes(`href="${href}"`), `${href} is not linked`);
    }
  });

  await test('the page you are on is marked, not offered', () => {
    // Blog Automation spent weeks unreachable because nothing linked to it.
    // The opposite failure — a nav that does not say where you are — is
    // smaller but it is the same kind of carelessness.
    const here = appSidebar('/keyword-research');
    const active = here.match(/app-sidebar-link-active/g) || [];
    assert.strictEqual(active.length, 1, 'more than one entry claims to be current');
    assert.ok(/href="\/keyword-research"[\s\S]{0,120}aria-current="page"/.test(here)
           || /aria-current="page"[\s\S]{0,120}keyword-research/.test(here)
           || here.includes('app-sidebar-link app-sidebar-link-active'),
      'the current page is not marked');
  });

  await test('a trailing slash still counts as the same page', () => {
    assert.strictEqual(
      (appSidebar('/keyword-research/').match(/app-sidebar-link-active/g) || []).length, 1);
  });

  await test('an unknown path marks nothing rather than guessing', () => {
    assert.strictEqual(
      (appSidebar('/buy-credits').match(/app-sidebar-link-active/g) || []).length, 0);
  });

  await test('the sidebar stacks rather than squeezing on a phone', () => {
    // A 2-column nav at phone width is worse than no nav. The column only
    // leaves the flow from the breakpoint up.
    //
    // This asserted `position: absolute` until the column became fixed. The
    // property is not the point — the point is that whatever takes it out of
    // the flow happens INSIDE the breakpoint, so a phone gets it in normal
    // flow. Asserting the property was asserting the implementation.
    const css = appSidebarAssets();
    assert.ok(/@media \(min-width: 992px\)/.test(css), 'there is no breakpoint');

    const breakpoint = css.slice(css.indexOf('@media (min-width: 992px)'));
    assert.ok(/\.app-sidebar-shell\s*\{[^}]*position:\s*(fixed|absolute)/.test(breakpoint),
      'the column leaves the flow outside the breakpoint, so a phone gets a 2-column nav');

    const before = css.slice(0, css.indexOf('@media (min-width: 992px)'));
    assert.ok(!/\.app-sidebar-shell\s*\{[^}]*position:\s*(fixed|absolute)/.test(before),
      'the column is taken out of the flow at every width');
  });

  await test('the column is positioned by CSS, not by each page\'s grid', () => {
    // It WAS in each page's grid, and the wizard's `justify-content-center`
    // put its tools 250px right of the research page's. One nav in two places
    // is two navs as far as the eye is concerned, so the position moved out
    // of the pages and into one rule.
    const css = appSidebarAssets();
    assert.ok(/body:has\(\.app-sidebar-shell\)[^}]*padding-left/.test(css),
      'the content is not held clear of the column');
    assert.ok(/\.app-sidebar-shell\s*\{[^}]*left: 0/.test(css),
      'the column is not pinned to the left edge');
    assert.ok(/app-sidebar-shell/.test(appSidebar('/')), 'the shell is gone');
  });

  /* ---------------------------------------------------------------- *
   * The page carries the placeholders, and the route fills them
   * ---------------------------------------------------------------- */

  const FORM_HTML = fs.readFileSync(path.join(__dirname, 'src/views/form.html'), 'utf8');
  const PAGE_HTML = fs.readFileSync(
    path.join(__dirname, 'src/views/keyword-research.html'), 'utf8');
  const FORM_ROUTE = fs.readFileSync(path.join(__dirname, 'routes/formRoute.js'), 'utf8');
  const RESEARCH_ROUTE = fs.readFileSync(
    path.join(__dirname, 'routes/keywordResearchRoute.js'), 'utf8');

  await test('both pages carry a sidebar placeholder', () => {
    assert.ok(FORM_HTML.includes('{{SIDEBAR}}'), 'the wizard page has no sidebar slot');
    assert.ok(PAGE_HTML.includes('{{SIDEBAR}}'), 'the research page has no sidebar slot');
  });

  await test('both routes fill it, and ship its styles', () => {
    // A placeholder nobody substitutes renders as literal braces on the page.
    for (const [name, src] of [['formRoute', FORM_ROUTE], ['keywordResearchRoute', RESEARCH_ROUTE]]) {
      assert.ok(/\{\{SIDEBAR\}\}\/g, appSidebar\(/.test(src), `${name} does not fill the sidebar`);
      assert.ok(/appSidebarAssets\(\)/.test(src), `${name} ships no sidebar styles`);
    }
  });

  await test('the wizard card keeps its own markup', () => {
    // The brief was explicit: do not touch the form. A column was added
    // beside it; the card, the form and the container id are untouched.
    assert.ok(FORM_HTML.includes('<div id="dynamicFormContainer"></div>'));
    assert.ok(FORM_HTML.includes('id="websiteForm"'));
    assert.ok(FORM_HTML.includes('card border-card outer-card'));
  });

  await test('every page drops the sidebar in the same spot: after the header', () => {
    // The position is CSS now, but only if the shell is OUTSIDE the page's
    // own container. Inside one it inherits that container's max-width and
    // centring, which is the bug this replaced.
    for (const [name, html] of [['form.html', FORM_HTML], ['keyword-research.html', PAGE_HTML]]) {
      const afterHeader = html.slice(html.indexOf('{{HEADER}}') + 10);
      const sidebarAt = afterHeader.indexOf('{{SIDEBAR}}');
      const containerAt = afterHeader.indexOf('<div class="container');

      assert.ok(sidebarAt !== -1, `${name} has no sidebar`);
      assert.ok(sidebarAt < containerAt,
        `${name} puts the sidebar inside its content container`);
    }
  });

  await test('every signed-in page renders the column, not just these two', () => {
    // /dashboard, /buy-credits, /blog-sites, /admin and /jobs had the header
    // but no tools, so from any of them the only way back to the wizard was
    // the logo — an invisible convention. That was the cost of moving the
    // build button off the header, and this is the repayment.
    const pages = {
      'routes/authRoute.js': 'appSidebar(',
      'routes/adminRoute.js': 'appSidebar(',
      'routes/jobRoute.js': 'appSidebar(',
      'routes/billingRoute.js': '{{SIDEBAR}}',
      'routes/blogSitesRoute.js': '{{SIDEBAR}}',
    };

    for (const [file, marker] of Object.entries(pages)) {
      const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
      assert.ok(src.includes(marker), `${file} renders the header but no tools column`);
    }
  });

  await test('the page title is not navy text on a navy page', () => {
    // Bootstrap 5.3 gives headings --bs-heading-color, which beats a plain
    // `h1 { color }` — the title rendered dark on dark and was invisible.
    assert.ok(/--bs-heading-color/.test(PAGE_HTML),
      'headings will take Bootstrap\'s own colour, not the page\'s');
  });

  await test('the research page asks for exactly the three inputs', () => {
    for (const id of ['kwLocation', 'kwCategory', 'kwMinVolume']) {
      assert.ok(PAGE_HTML.includes(`id="${id}"`), `${id} is missing`);
    }
  });

  /* ---------------------------------------------------------------- *
   * Two questions that share words are not the same question
   * ---------------------------------------------------------------- */

  await test('an ideas lookup cannot be served a volumes answer', () => {
    // "plumbing" as a VOLUME lookup means "how often is that word searched".
    // As an IDEAS lookup it means "what else do people search around it".
    // Same word, same town, same month, two different answers — so without a
    // namespace in the key they would share an entry and serve each other's.
    const base = { location: 'Austin,Texas,United States', language: 'English', month: '2026-09' };
    assert.notStrictEqual(
      cacheKey(['plumbing'], { ...base, kind: 'volumes' }),
      cacheKey(['plumbing'], { ...base, kind: 'ideas' })
    );
  });

  await test('and the two really do miss each other in the cache', async () => {
    // The check above proves cacheKey CAN tell them apart. This proves
    // keywordIdeasFor actually asks it to — removing the namespace from the
    // call site left the first test passing and the bug in place.
    CREDS();
    const Model = fakeModel();
    const seen = [];

    await withFetch(
      n => {
        seen.push(n);
        return n === 1
          // A volumes reply for the word "plumbing".
          ? { ok: true, json: async () => ({ tasks: [{ status_code: 20000, cost: 0.09,
              result: [{ keyword: 'plumbing', search_volume: 320 }] }] }) }
          // An ideas reply: different keywords entirely.
          : ideasReply(AUSTIN);
      },
      async () => {
        await volumesFor(['plumbing'], { location: 'Austin,Texas,United States', Model });
        const ideas = await keywordIdeasFor('plumbing', {
          location: 'Austin,Texas,United States', Model,
        });

        assert.strictEqual(seen.length, 2,
          'the ideas lookup was served the volumes answer');
        assert.ok(ideas.rows.length > 1,
          'the ideas lookup came back with the single volumes row');
        assert.strictEqual(ideas.cached, false);
      });
  });

  /* ---------------------------------------------------------------- *
   * The discovery lookup
   * ---------------------------------------------------------------- */

  await test('the request goes to the ideas endpoint, not the volumes one', async () => {
    CREDS();
    await withFetch(() => ideasReply(AUSTIN), async (calls) => {
      await keywordIdeasFor('plumbing', {
        location: 'Austin,Texas,United States', Model: fakeModel(),
      });
      assert.ok(/keywords_for_keywords/.test(calls[0].url),
        `it called ${calls[0].url}`);
      assert.deepStrictEqual(calls[0].body[0].keywords, ['plumbing']);
      assert.strictEqual(calls[0].body[0].location_name, 'Austin,Texas,United States');
    });
  });

  await test('the biggest come first, and only twenty of them', async () => {
    CREDS();
    const many = Array.from({ length: 80 }, (_, i) => ({
      keyword: `service ${i}`, search_volume: i * 10, cpc: 1,
    }));

    await withFetch(() => ideasReply(many), async () => {
      const { rows } = await keywordIdeasFor('plumbing', {
        location: 'Austin,Texas,United States', Model: fakeModel(),
      });
      assert.strictEqual(rows.length, MAX_IDEAS);
      assert.strictEqual(rows[0].volume, 790);
      assert.ok(rows[0].volume > rows[rows.length - 1].volume, 'not sorted by volume');
    });
  });

  await test('competitor names are dropped, not shown as services', async () => {
    CREDS();
    await withFetch(() => ideasReply(AUSTIN), async () => {
      const { rows } = await keywordIdeasFor('plumbing', {
        location: 'Austin,Texas,United States', Model: fakeModel(),
      });
      assert.ok(!rows.some(r => r.keyword === 'goettl plumbing'),
        'a competitor name came back as a keyword idea');
      assert.ok(rows.some(r => r.keyword === 'water heater replacement'),
        'a real service was dropped with them');
    });
  });

  await test('a keyword with no volume at all is left out', async () => {
    CREDS();
    await withFetch(() => ideasReply(AUSTIN), async () => {
      const { rows } = await keywordIdeasFor('plumbing', {
        location: 'Austin,Texas,United States', Model: fakeModel(),
      });
      assert.ok(!rows.some(r => r.keyword === 'no volume at all'));
    });
  });

  await test('the minimum hides the small ones and counts what it hid', async () => {
    CREDS();
    await withFetch(() => ideasReply(AUSTIN), async () => {
      const out = await keywordIdeasFor('plumbing', {
        location: 'Austin,Texas,United States', minVolume: 200, Model: fakeModel(),
      });

      assert.ok(out.rows.every(r => r.volume >= 200), 'something under the minimum got through');
      assert.strictEqual(out.aboveMinimum, 5, 'the count above the minimum is wrong');
      // `total` is everything usable, so the page can say "lower it and there
      // are 7" rather than leaving a dead end.
      assert.strictEqual(out.total, 7);
    });
  });

  await test('a minimum nothing reaches is EMPTY ROWS BUT A REAL TOTAL', async () => {
    // The distinction the page lives on: "your minimum is too high" is a knob
    // the customer can turn, "this town has nothing" is not. An empty table
    // says neither.
    CREDS();
    await withFetch(() => ideasReply(AUSTIN), async () => {
      const out = await keywordIdeasFor('plumbing', {
        location: 'Austin,Texas,United States', minVolume: 100000, Model: fakeModel(),
      });
      assert.strictEqual(out.rows.length, 0);
      assert.strictEqual(out.aboveMinimum, 0);
      assert.ok(out.total > 0, 'the page cannot tell an empty town from a high minimum');
    });
  });

  await test('a town with nothing in it reports a total of zero', async () => {
    CREDS();
    await withFetch(() => ideasReply([]), async () => {
      const out = await keywordIdeasFor('plumbing', {
        location: 'Marfa,Texas,United States', Model: fakeModel(),
      });
      assert.strictEqual(out.total, 0);
      assert.strictEqual(out.rows.length, 0);
    });
  });

  /* ---------------------------------------------------------------- *
   * The cache, which is why this is free
   * ---------------------------------------------------------------- */

  await test('the WHOLE set is cached, not just the rows shown', async () => {
    // This is what makes changing the minimum free. Caching the filtered
    // twenty would mean a customer who lowers it pays another $0.09 for
    // keywords already bought.
    CREDS();
    const Model = fakeModel();

    await withFetch(() => ideasReply(AUSTIN), async () => {
      await keywordIdeasFor('plumbing', {
        location: 'Austin,Texas,United States', minVolume: 1000, Model,
      });
    });

    const written = Model.writes[0].update.$set.results;
    assert.ok(written.length >= AUSTIN.length - 1,
      `only ${written.length} rows were cached out of ${AUSTIN.length}`);
    assert.ok(written.some(r => r.keyword === 'toilet plumber'),
      'a row under the minimum was dropped before caching');
  });

  await test('a second search of the same town and trade costs nothing', async () => {
    CREDS();
    const Model = fakeModel();
    let calls = 0;

    await withFetch(() => { calls++; return ideasReply(AUSTIN); }, async () => {
      await keywordIdeasFor('plumbing', { location: 'Austin,Texas,United States', Model });
      const second = await keywordIdeasFor('plumbing', {
        location: 'Austin,Texas,United States', Model,
      });

      assert.strictEqual(calls, 1, 'it paid twice for the same question');
      assert.strictEqual(second.cached, true);
      assert.strictEqual(second.costUsd, 0);
      assert.ok(second.rows.length > 0, 'the cached answer came back empty');
    });
  });

  await test('lowering the minimum re-reads the cache rather than re-buying', async () => {
    CREDS();
    const Model = fakeModel();
    let calls = 0;

    await withFetch(() => { calls++; return ideasReply(AUSTIN); }, async () => {
      const strict = await keywordIdeasFor('plumbing', {
        location: 'Austin,Texas,United States', minVolume: 1000, Model,
      });
      const loose = await keywordIdeasFor('plumbing', {
        location: 'Austin,Texas,United States', minVolume: 0, Model,
      });

      assert.strictEqual(calls, 1, 'changing the minimum spent another $0.09');
      assert.ok(loose.rows.length > strict.rows.length,
        'the looser search did not return more');
    });
  });

  await test('a different trade in the same town is a different question', async () => {
    CREDS();
    const Model = fakeModel();
    let calls = 0;

    await withFetch(() => { calls++; return ideasReply(AUSTIN); }, async () => {
      await keywordIdeasFor('plumbing', { location: 'Austin,Texas,United States', Model });
      await keywordIdeasFor('roofing', { location: 'Austin,Texas,United States', Model });
      assert.strictEqual(calls, 2, 'roofing was served plumbing keywords');
    });
  });

  await test('a missing seed or town is refused before anything is spent', async () => {
    CREDS();
    await assert.rejects(
      () => keywordIdeasFor('', { location: 'Austin,Texas,United States', Model: fakeModel() }),
      /seed term is required/
    );
    await assert.rejects(
      () => keywordIdeasFor('plumbing', { Model: fakeModel() }),
      /location is required/
    );
  });

  /* ---------------------------------------------------------------- *
   * The endpoint
   * ---------------------------------------------------------------- */

  function loadRoute({ onLog, ideas, exact, seedTerms } = {}) {
    const routes = [];
    const fakeRouter = {
      post(p, ...h) { routes.push({ method: 'post', path: p, handlers: h }); },
      get(p, ...h) { routes.push({ method: 'get', path: p, handlers: h }); },
    };

    const outer = Module._load;

    Module._load = function (request, parent, isMain) {
      if (request === 'express') return { Router: () => fakeRouter };
      if (/rateLimits$/.test(request)) {
        return { keywordVolumesLimiter: (req, res, next) => next() };
      }
      if (onLog && /logger$/.test(request)) {
        // NOTE THE DIFFERENT ARITY. utils/logger's shape is
        // `info(event, fields)` but `error(event, err, fields)` — the error
        // object sits in the middle. The first version of this stub treated
        // both as two-argument, so every assertion about an error line's
        // FIELDS was silently reading the Error instead, and passed only
        // because it never looked at one.
        return {
          log: {
            info: (event, fields) => onLog(event, fields),
            error: (event, err, fields) => onLog(event, fields || {}),
          },
        };
      }
      // STUBBED WHOLE, never partially. keywordSeeds requires openaiClient,
      // which requires the `openai` package — so loading the real one would
      // make this suite unable to check a route handler without an API client
      // installed, and would put a live model call inside `node test-*.js`.
      if (/keywordSeeds$/.test(request)) {
        return {
          seedTermsFor: seedTerms
            || (async () => ({ terms: [], cached: false, usage: null })),
        };
      }
      if (/keywordVolumes$/.test(request)) {
        const real = outer.call(this, request, parent, isMain);
        return {
          ...real,
          keywordIdeasFor: ideas
            || (async () => ({
              rows: [], cached: false, costUsd: 0,
              total: 0, buyerIntent: 0, aboveMinimum: 0, brandsHidden: 0,
              removedByWords: 0, removedByPrice: 0, collapsed: 0,
            })),
          volumesFor: exact
            || (async () => ({ results: [], cached: false, costUsd: 0 })),
        };
      }
      return outer.call(this, request, parent, isMain);
    };

    const file = path.join(__dirname, 'routes/keywordResearchRoute.js');
    let mod;
    try {
      delete require.cache[require.resolve(file)];
      mod = require(file);
    } finally {
      Module._load = outer;
    }

    const api = routes.find(r => r.path === '/api/keyword-ideas');
    const page = routes.find(r => r.path === '/keyword-research');
    assert.ok(api, 'the route does not register /api/keyword-ideas');
    assert.ok(page, 'the route does not register /keyword-research');

    return { mod, api, page, handler: api.handlers[api.handlers.length - 1] };
  }

  function fakeRes() {
    return {
      statusCode: 200,
      body: null,
      sent: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
      send(html) { this.sent = html; return this; },
      locals: {},
    };
  }

  await test('a town is spelled the way Google spells it, or refused', () => {
    const { mod } = loadRoute();
    assert.strictEqual(mod.toLocationName('Austin, TX'), 'Austin,Texas,United States');
    assert.strictEqual(mod.toLocationName('Cedar Park,TX'), 'Cedar Park,Texas,United States');
    // Refused rather than guessed: an unresolvable state matches no geo
    // target and would spend $0.09 to be told no.
    assert.strictEqual(mod.toLocationName('Austin'), '');
    assert.strictEqual(mod.toLocationName('Austin, ZZ'), '');
  });

  await test('no industry is a 400 that names some', async () => {
    const { handler } = loadRoute();
    const res = fakeRes();
    await handler({ body: { location: 'Austin, TX' } }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.body.error, /plumbing/i);
  });

  await test('an unusable town is a 400 that shows the format', async () => {
    const { handler } = loadRoute();
    const res = fakeRes();
    await handler({ body: { category: 'plumbing', location: 'Austin' } }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.body.error, /City, ST/);
  });

  await test('the answer carries the counts the page needs to explain itself', async () => {
    const { handler } = loadRoute({
      ideas: async () => ({
        rows: [{ keyword: 'plumber', volume: 2900, cpc: 26.51 }],
        cached: false, costUsd: 0.09, total: 40, aboveMinimum: 1,
      }),
    });
    const res = fakeRes();
    await handler({
      body: { category: 'plumbing', location: 'Austin, TX', minVolume: 200 },
    }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.rows[0].volume, 2900);
    assert.strictEqual(res.body.location, 'Austin,Texas,United States');
    assert.strictEqual(res.body.total, 40);
    assert.strictEqual(res.body.aboveMinimum, 1);
    assert.strictEqual(res.body.minVolume, 200);
  });

  await test('what it cost and whether it was cached are logged', async () => {
    const seen = [];
    const { handler } = loadRoute({
      onLog: (event, fields) => seen.push({ event, fields }),
      ideas: async () => ({
        rows: [], cached: true, costUsd: 0, total: 12, aboveMinimum: 0,
      }),
    });
    await handler({ body: { category: 'plumbing', location: 'Austin, TX' } }, fakeRes());

    const line = seen.find(l => l.event === 'keywords.ideas');
    assert.ok(line, 'nothing was logged');
    assert.strictEqual(line.fields.cached, true);
    assert.strictEqual(line.fields.costUsd, 0);
    assert.strictEqual(line.fields.seed, 'plumbing');
  });

  await test('a negative minimum cannot be used to break the filter', async () => {
    let sawMin = null;
    const { handler } = loadRoute({
      ideas: async (seed, opts) => {
        sawMin = opts.minVolume;
        return { rows: [], cached: false, costUsd: 0, total: 0, aboveMinimum: 0 };
      },
    });
    await handler({
      body: { category: 'plumbing', location: 'Austin, TX', minVolume: -500 },
    }, fakeRes());
    assert.strictEqual(sawMin, 0);
  });

  await test('a failed lookup is a 502, not an empty table', async () => {
    // An empty table would read as "this town has no keywords", which is a
    // different and much more discouraging claim than "try again".
    const { handler } = loadRoute({
      ideas: async () => { throw new Error('DataForSEO is down'); },
    });
    const res = fakeRes();
    await handler({ body: { category: 'plumbing', location: 'Austin, TX' } }, res);
    assert.strictEqual(res.statusCode, 502);
    assert.match(res.body.error, /try again/i);
  });

  /* ---------------------------------------------------------------- *
   * The seed list — why the page returned three rows
   * ---------------------------------------------------------------- *
   *
   * Cedar Park, plumbing, minimum 200 gave three rows on 23 September while
   * Keyword Planner offered 1,678 ideas. Two causes were possible and they
   * needed separating: a small `total` would mean the endpoint returns little
   * for one seed, a large `total` would mean the filtering ate them.
   *
   * It was the seeds. fetchIdeas sent exactly one; Planner had been given
   * three by hand. What follows guards the fix, because the cheapest way to
   * regress it is for somebody to "tidy" fetchIdeas back to a single string.
   */

  await test('the seed list leads with the trade, then the town pairings', () => {
    // ORDER IS PRIORITY because the list is capped at twenty. The trade is
    // the one seed guaranteed relevant, so it cannot be pushed out by a
    // model suggestion.
    const seeds = seedsFor('plumbing', { city: 'Cedar Park' });

    assert.strictEqual(seeds[0], 'plumbing');
    assert.deepStrictEqual(
      seeds.slice(1),
      ['plumbing Cedar Park', 'Cedar Park plumbing']
    );
  });

  await test("the customer's own terms outrank the model's", async () => {
    // Somebody who types "slab leak detection" knows their trade. A model is
    // guessing at it. When the cap bites, the guess is what gets dropped.
    const seeds = seedsFor('plumbing', {
      city: 'Austin',
      related: ['slab leak detection'],
      extra: ['drain cleaning'],
    });

    assert.ok(
      seeds.indexOf('slab leak detection') < seeds.indexOf('drain cleaning'),
      'the model suggestion was placed above the customer\'s own term'
    );
  });

  await test('the seed list is capped, and the cap keeps the front of the list', async () => {
    const extra = Array.from({ length: 50 }, (_, i) => `filler ${i}`);
    const seeds = seedsFor('plumbing', { city: 'Austin', extra });

    assert.strictEqual(seeds.length, MAX_SEEDS);
    assert.strictEqual(seeds[0], 'plumbing');
    // DataForSEO rejects a task over its own cap rather than truncating it,
    // so an uncapped list is an error, not a longer answer.
    assert.ok(seeds.length <= 20);
  });

  await test('a seed repeated in different case takes one slot, not two', () => {
    // cacheKey lowercases. Two spellings of one seed would spend two of
    // twenty slots AND still hash to the same entry — paying twice for a
    // narrower question.
    const seeds = seedsFor('plumbing', { related: ['Plumbing', 'PLUMBING', 'drains'] });
    assert.deepStrictEqual(seeds, ['plumbing', 'drains']);
  });

  await test('every seed rides in ONE task, because the price is per task', async () => {
    // This is the whole economics of the change. Twenty seeds in twenty
    // tasks would be $1.80; twenty seeds in one task is $0.09.
    await withFetch(() => ideasReply(AUSTIN), async (calls) => {
      await keywordIdeasFor(
        ['plumbing', 'plumbing austin', 'water heater repair'],
        { location: 'Austin,Texas,United States', Model: fakeModel() }
      );

      assert.strictEqual(calls.length, 1, 'it sent more than one task');
      assert.deepStrictEqual(
        calls[0].body[0].keywords,
        ['plumbing', 'plumbing austin', 'water heater repair']
      );
    });
  });

  await test('a term surfaced by two seeds appears once', async () => {
    // "plumbing" and "plumbing austin" both surface "plumbers near me". Left
    // alone it would fill several of the twenty rows the customer sees.
    await withFetch(() => ideasReply([
      { keyword: 'plumbers near me', search_volume: 480, cpc: 56.98 },
      { keyword: 'Plumbers Near Me', search_volume: 480, cpc: 56.98 },
      { keyword: 'drain cleaning', search_volume: 210, cpc: 12.00 },
    ]), async () => {
      const { rows } = await keywordIdeasFor(
        ['plumbing', 'plumbing austin'],
        { location: 'Austin,Texas,United States', Model: fakeModel() }
      );

      const terms = rows.map(r => r.keyword.toLowerCase());
      assert.strictEqual(
        terms.filter(t => t === 'plumbers near me').length, 1,
        'the same term came back twice in different case'
      );
    });
  });

  await test('two different seed lists are two different cache entries', async () => {
    // A wider net is a different question and has to be paid for. If it
    // shared a key with the narrow one, adding Related terms would silently
    // serve the old, thinner answer.
    const Model = fakeModel();
    let calls = 0;

    await withFetch(() => { calls++; return ideasReply(AUSTIN); }, async () => {
      await keywordIdeasFor(['plumbing'], {
        location: 'Austin,Texas,United States', Model,
      });
      await keywordIdeasFor(['plumbing', 'water heater repair'], {
        location: 'Austin,Texas,United States', Model,
      });

      assert.strictEqual(calls, 2, 'the wider question was served the narrow answer');
    });
  });

  await test('the same seeds in a different order are ONE entry', async () => {
    // The model does not return its suggestions in a stable order. If that
    // ordering reached the key, every repeat lookup would be a fresh $0.09 —
    // the cache defeated by the thing put in front of it.
    const Model = fakeModel();
    let calls = 0;

    await withFetch(() => { calls++; return ideasReply(AUSTIN); }, async () => {
      await keywordIdeasFor(['plumbing', 'drain cleaning'], {
        location: 'Austin,Texas,United States', Model,
      });
      const second = await keywordIdeasFor(['drain cleaning', 'plumbing'], {
        location: 'Austin,Texas,United States', Model,
      });

      assert.strictEqual(calls, 1, 'the same question was paid for twice');
      assert.strictEqual(second.cached, true);
    });
  });

  /* ---------------------------------------------------------------- *
   * The brand filter, counted rather than trusted
   * ---------------------------------------------------------------- */

  await test('what the brand filter removed comes back as a number', async () => {
    // A filter whose appetite nobody can see is a filter nobody can tell is
    // broken. This one has been wrong before, on "toilet plumber".
    await withFetch(() => ideasReply([
      { keyword: 'goettl plumbing', search_volume: 900, cpc: 4 },
      { keyword: 'roto rooter', search_volume: 800, cpc: 4 },
      { keyword: 'water heater repair', search_volume: 300, cpc: 40 },
    ]), async () => {
      const out = await keywordIdeasFor(['plumbing'], {
        location: 'Austin,Texas,United States', Model: fakeModel(),
      });

      assert.strictEqual(out.brandsHidden, 2);
      assert.strictEqual(out.total, 1, 'total should count what survived the filter');
    });
  });

  await test('brandsHidden is zero when brands are kept, not merely unreported', async () => {
    await withFetch(() => ideasReply([
      { keyword: 'goettl plumbing', search_volume: 900, cpc: 4 },
    ]), async () => {
      const out = await keywordIdeasFor(['plumbing'], {
        location: 'Austin,Texas,United States',
        includeBrands: true,
        Model: fakeModel(),
      });

      assert.strictEqual(out.brandsHidden, 0);
      assert.strictEqual(out.total, 1);
    });
  });

  /* ---------------------------------------------------------------- *
   * The Related terms box
   * ---------------------------------------------------------------- */

  await test('related terms split on commas and on pasted newlines', () => {
    const { mod } = loadRoute();

    assert.deepStrictEqual(
      mod.relatedTerms('water heater installation, drain cleaning'),
      ['water heater installation', 'drain cleaning']
    );

    // Somebody pasting a column out of Keyword Planner gets newlines. Split
    // on commas alone, that is one 200-character seed matching nothing.
    assert.deepStrictEqual(
      mod.relatedTerms('water heater\ndrain cleaning\n\nsewer line'),
      ['water heater', 'drain cleaning', 'sewer line']
    );

    assert.deepStrictEqual(mod.relatedTerms(''), []);
    assert.deepStrictEqual(mod.relatedTerms(undefined), []);
    assert.deepStrictEqual(mod.relatedTerms('  ,  , '), []);
  });

  await test('the Related box cannot be used to blow past the seed cap', () => {
    const { mod } = loadRoute();
    const many = Array.from({ length: 80 }, (_, i) => `term ${i}`).join(',');

    assert.strictEqual(mod.relatedTerms(many).length, mod.MAX_RELATED);
    assert.ok(mod.MAX_RELATED + 3 <= MAX_SEEDS,
      'the related cap plus the trade and its two town pairings exceeds the seed cap');
  });

  await test('one enormous pasted term is trimmed, not sent whole', () => {
    const { mod } = loadRoute();
    const [only] = mod.relatedTerms('x'.repeat(500));
    assert.strictEqual(only.length, mod.MAX_RELATED_LENGTH);
  });

  await test('the bare town is taken from the Google-spelled location', () => {
    const { mod } = loadRoute();
    assert.strictEqual(mod.cityOf('Cedar Park,Texas,United States'), 'Cedar Park');
    assert.strictEqual(mod.cityOf(''), '');
  });

  /* ---------------------------------------------------------------- *
   * The route, end to end
   * ---------------------------------------------------------------- */

  await test('the route sends a widened seed list, not the bare industry', async () => {
    // The regression this whole section exists to prevent.
    let sawSeeds = null;

    const { handler } = loadRoute({
      seedTerms: async () => ({ terms: ['drain cleaning'], cached: false, usage: null }),
      ideas: async (seeds) => {
        sawSeeds = seeds;
        return {
          rows: [], cached: false, costUsd: 0.09,
          total: 0, aboveMinimum: 0, brandsHidden: 0,
        };
      },
    });

    await handler({
      body: {
        category: 'plumbing',
        location: 'Cedar Park, TX',
        related: 'water heater installation',
      },
    }, fakeRes());

    assert.ok(Array.isArray(sawSeeds), 'the route still sends a single string');
    assert.ok(sawSeeds.length >= 5,
      `only ${sawSeeds.length} seeds were sent: ${JSON.stringify(sawSeeds)}`);
    assert.ok(sawSeeds.includes('plumbing'));
    assert.ok(sawSeeds.includes('plumbing Cedar Park'));
    assert.ok(sawSeeds.includes('water heater installation'));
    assert.ok(sawSeeds.includes('drain cleaning'));
  });

  await test('a model outage narrows the net instead of failing the lookup', async () => {
    // seedTermsFor never throws, but the route must not depend on that
    // politeness: a rejection here has to leave a working, narrower lookup.
    let sawSeeds = null;

    const { handler } = loadRoute({
      seedTerms: async () => ({ terms: [], cached: false, usage: null }),
      ideas: async (seeds) => {
        sawSeeds = seeds;
        return {
          rows: [{ keyword: 'plumbing', volume: 210, cpc: 38.19 }],
          cached: false, costUsd: 0.09, total: 1, aboveMinimum: 1, brandsHidden: 0,
        };
      },
    });

    const res = fakeRes();
    await handler({
      body: { category: 'plumbing', location: 'Cedar Park, TX' },
    }, res);

    assert.strictEqual(res.statusCode, 200, 'a quiet model took the lookup down with it');
    assert.deepStrictEqual(
      sawSeeds,
      ['plumbing', 'plumbing Cedar Park', 'Cedar Park plumbing']
    );
  });

  await test('the seeds used come back to the page', async () => {
    // So a thin result is visibly a narrow net or visibly a small town,
    // without anybody reading a log to find out which.
    const { handler } = loadRoute({
      ideas: async () => ({
        rows: [{ keyword: 'plumbing', volume: 210, cpc: 38.19 }],
        cached: false, costUsd: 0.09, total: 500, aboveMinimum: 3, brandsHidden: 4,
      }),
    });

    const res = fakeRes();
    await handler({
      body: { category: 'plumbing', location: 'Cedar Park, TX', minVolume: 200 },
    }, res);

    assert.ok(Array.isArray(res.body.seeds), 'the page cannot show what was searched');
    assert.ok(res.body.seeds.includes('plumbing'));
    // The denominator, which the page needs to explain a thin table.
    assert.strictEqual(res.body.total, 500);
    assert.strictEqual(res.body.aboveMinimum, 3);
  });

  await test('the log line carries the numbers that explain a thin result', async () => {
    const seen = [];
    const { handler } = loadRoute({
      onLog: (event, fields) => seen.push({ event, fields }),
      seedTerms: async () => ({ terms: ['drain cleaning'], cached: true, usage: null }),
      ideas: async () => ({
        rows: [], cached: false, costUsd: 0.09,
        total: 500, aboveMinimum: 3, brandsHidden: 7,
      }),
    });

    await handler({
      body: { category: 'plumbing', location: 'Cedar Park, TX', related: 'sewer line' },
    }, fakeRes());

    const line = seen.find(l => l.event === 'keywords.ideas');
    assert.ok(line, 'nothing was logged');

    // Each of these answers a question that cost a round trip to ask last
    // time: how wide was the net, how much did the filter eat, and was the
    // model call paid for again.
    assert.strictEqual(line.fields.brandsHidden, 7);
    assert.strictEqual(line.fields.relatedCount, 1);
    assert.strictEqual(line.fields.modelSeeds, 1);
    assert.strictEqual(line.fields.seedsCached, true);
    assert.ok(line.fields.seedCount >= 5, 'the seed count is missing from the log');
  });

  /* ---------------------------------------------------------------- *
   * The page itself
   * ---------------------------------------------------------------- *
   *
   * Scanned as whole files rather than as the functions that were changed.
   *
   * The badge unification taught this the hard way: a test scoped to the one
   * function I had edited passed while a blue badge survived elsewhere on the
   * page. A property the customer asked for is a property of the PAGE.
   */

  const pageJs = fs.readFileSync(path.join(__dirname, 'public/js/keywordResearch.js'), 'utf8');
  const pageHtml = fs.readFileSync(
    path.join(__dirname, 'src/views/keyword-research.html'), 'utf8');

  /**
   * Lift a function out of the page script and RUN it.
   *
   * The file is an IIFE, so it cannot be required. The tempting alternative
   * is to regex the source for the words the function ought to contain — and
   * that is exactly the test that just failed a mutation check: deleting the
   * total from the OUTPUT left the word `total` sitting in a `const` two
   * lines above, and the assertion passed on a card that no longer showed it.
   *
   * A test that reads source for vocabulary checks that I wrote something.
   * Running it checks what the customer sees.
   */
  function liftFromPage(...names) {
    const sources = names.map(name => {
      const found = pageJs.match(
        new RegExp(`\\n  function ${name}\\b[\\s\\S]*?\\n  }`)
      );
      assert.ok(found, `${name} is gone from the page script`);
      return found[0];
    });

    return new Function(`${sources.join('\n')}\nreturn { ${names.join(', ')} };`)();
  }

  await test('the results card shows the total even when a minimum is set', () => {
    // The old card hid the denominator behind the minimum, so 3 of 500 read
    // as a broken tool rather than as a strict filter. This is the exact
    // screenshot Edwin sent on 23 September.
    const { countLine } = liftFromPage('number', 'countLine');

    const text = countLine({ total: 500, aboveMinimum: 3, minVolume: 200 });

    assert.match(text, /\b3\b/, 'the matching count is missing');
    assert.match(text, /200/, 'the minimum is missing');
    assert.match(text, /500/, 'THE DENOMINATOR IS MISSING — a thin table reads as broken');
  });

  await test('with no minimum the card shows one number, not a ratio to itself', () => {
    const { countLine } = liftFromPage('number', 'countLine');
    assert.strictEqual(countLine({ total: 500, aboveMinimum: 500, minVolume: 0 }),
      '500 keywords found');
  });

  await test('the counts are written with thousand separators', () => {
    // 1678 reads as 167.8 at a glance, which is the wrong order of magnitude
    // for the one number on the page that is meant to reassure.
    const { countLine } = liftFromPage('number', 'countLine');
    assert.match(countLine({ total: 1678, aboveMinimum: 12, minVolume: 50 }), /1,678/);
  });

  await test('the table is striped and themed through Bootstrap variables', () => {
    // A plain `table { color }` rule loses to `.table > :not(caption) > * > *`,
    // which is why the table rendered white on a navy page. 5.3 moved table
    // theming into custom properties; the properties are where it is answered.
    assert.match(pageJs, /table-striped/, 'the table is not striped');
    assert.match(pageHtml, /--bs-table-striped-bg/);
    assert.match(pageHtml, /--bs-table-bg:\s*transparent/);

    // A bare `table {` rule reintroduces the bug it looks like it fixes.
    assert.ok(!/^\s*table\s*\{/m.test(pageHtml),
      'a bare `table {` rule is back — it cannot beat Bootstrap\'s cell selector');
  });

  await test('the page asks for related terms and posts them', () => {
    assert.match(pageHtml, /id="kwRelated"/, 'the Related terms field is missing');
    assert.match(pageJs, /kwRelated/, 'the page never reads the Related terms field');
    assert.match(pageJs, /related/, 'the request body has no related terms in it');
  });

  await test('the seeds are rendered escaped, not interpolated raw', () => {
    // They are the customer's own words going back into innerHTML.
    const fn = pageJs.match(/function seedLine[\s\S]*?\n  }/);
    assert.ok(fn, 'seedLine is gone');
    assert.match(fn[0], /escapeHtml\(s\)/,
      'a seed reaches innerHTML unescaped');
  });

  /* ---------------------------------------------------------------- *
   * Exact mode — one term, one answer, nothing removed
   * ---------------------------------------------------------------- *
   *
   * The point of this mode is that the customer already knows the term and
   * wants the number. Every filter the category mode needs is a liability
   * here: silently declining to answer the question asked looks exactly like
   * a lookup that failed.
   */

  await test('exact mode calls the LOOKUP endpoint, not discovery', () => {
    const { mod } = loadRoute();
    assert.strictEqual(mod.modeOf({ mode: 'exact' }), 'exact');
    assert.strictEqual(mod.modeOf({ mode: 'EXACT' }), 'exact');
    assert.strictEqual(mod.modeOf({ mode: 'category' }), 'category');
  });

  await test('a request with no mode is discovery, so old pages keep working', () => {
    // A page cached in somebody's browser from before the switch existed
    // sends no mode at all. Defaulting to `exact` would silently stop
    // expanding anything for them.
    const { mod } = loadRoute();
    assert.strictEqual(mod.modeOf({}), 'category');
    assert.strictEqual(mod.modeOf(undefined), 'category');
    assert.strictEqual(mod.modeOf({ mode: 'nonsense' }), 'category');
  });

  await test('exact mode asks about exactly the words given', async () => {
    let sawKeywords = null;
    let sawIdeas = false;

    const { handler } = loadRoute({
      exact: async (keywords) => {
        sawKeywords = keywords;
        return {
          results: [{ keyword: 'emergency plumber austin', volume: 320, cpc: 96 }],
          cached: false, costUsd: 0.09,
        };
      },
      ideas: async () => { sawIdeas = true; throw new Error('discovery was called'); },
    });

    const res = fakeRes();
    await handler({
      body: { mode: 'exact', category: 'emergency plumber austin', location: 'Austin, TX' },
    }, res);

    assert.strictEqual(sawIdeas, false, 'exact mode went to the discovery endpoint');
    assert.deepStrictEqual(sawKeywords, ['emergency plumber austin']);
    assert.strictEqual(res.body.rows[0].volume, 320);
    assert.strictEqual(res.body.mode, 'exact');
  });

  await test('SEVERAL terms ride in ONE task', async () => {
    /* THE COST OF THE WHOLE FEATURE WAS THIS. From the log of 23 September:
     * five exact lookups in 68 seconds, $0.45, for five wordings of one legal
     * term. That is not misuse, it is the only sensible way to use the tool —
     * and the lookup endpoint takes a thousand keywords per task at the same
     * $0.09, so those five were always meant to be one. */
    let calls = 0;
    let sawKeywords = null;

    const { handler } = loadRoute({
      exact: async (keywords) => {
        calls++;
        sawKeywords = keywords;
        return { results: [], cached: false, costUsd: 0.09 };
      },
    });

    const res = fakeRes();
    await handler({
      body: {
        mode: 'exact',
        location: 'Austin, TX',
        terms: 'lemon law lawyer\nlemon law lawyer austin\nlemon law attorney\n'
             + 'lemon law lawyer near me\nlemon law attorney near me',
      },
    }, res);

    assert.strictEqual(calls, 1, `${calls} tasks — that is $${(calls * 0.09).toFixed(2)}`);
    assert.strictEqual(sawKeywords.length, 5);
    assert.strictEqual(res.body.rows.length, 5);
  });

  await test('terms split on newlines AND on commas', async () => {
    // Newlines because somebody pastes a column out of Keyword Planner;
    // commas because somebody types a list.
    const { mod } = loadRoute();

    assert.deepStrictEqual(
      mod.exactTerms({ terms: 'plumber austin\nwater heater repair' }),
      ['plumber austin', 'water heater repair']
    );
    assert.deepStrictEqual(
      mod.exactTerms({ terms: 'plumber austin, water heater repair' }),
      ['plumber austin', 'water heater repair']
    );
  });

  await test('a repeated term takes one slot and one row', async () => {
    const { mod } = loadRoute();

    assert.deepStrictEqual(
      mod.exactTerms({ terms: 'Plumber Austin\nplumber austin\n  plumber   austin  ' }),
      ['Plumber Austin']
    );
  });

  await test('the list is capped, well under what the endpoint takes', async () => {
    const { mod } = loadRoute();
    const many = Array.from({ length: 200 }, (_, i) => `term ${i}`).join('\n');

    assert.strictEqual(mod.exactTerms({ terms: many }).length, mod.MAX_EXACT_TERMS);
    // DataForSEO takes a thousand. The cap is about what a person can read.
    assert.ok(mod.MAX_EXACT_TERMS <= 50);
  });

  await test('a page cached from before the textarea still works', async () => {
    // It sends its single keyword as `category`, which is where the old
    // exact mode read from.
    const { mod } = loadRoute();
    assert.deepStrictEqual(
      mod.exactTerms({ category: 'plumber cedar park' }),
      ['plumber cedar park']
    );
  });

  await test('a textarea with only whitespace is a 400, not a paid lookup', async () => {
    // An empty task still costs $0.09.
    let called = false;
    const { handler } = loadRoute({
      exact: async () => { called = true; return { results: [], cached: false, costUsd: 0.09 }; },
    });

    const res = fakeRes();
    await handler({ body: { mode: 'exact', location: 'Austin, TX', terms: '  \n , \n ' } }, res);

    assert.strictEqual(called, false, 'an empty lookup was paid for');
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.body.error, /keyword/i);
  });

  await test('a mix of answered and unanswered terms keeps both', async () => {
    const { handler } = loadRoute({
      exact: async () => ({
        results: [
          { keyword: 'plumber cedar park', volume: 170, cpc: 44.64 },
          { keyword: 'water heater repair', volume: 480, cpc: 82.33 },
        ],
        cached: false, costUsd: 0.09,
      }),
    });

    const res = fakeRes();
    await handler({
      body: {
        mode: 'exact',
        location: 'Cedar Park, TX',
        terms: 'plumber cedar park\ncommercial plumber cedar park\nwater heater repair',
      },
    }, res);

    assert.strictEqual(res.body.rows.length, 3, 'the unanswered term was dropped');
    assert.strictEqual(res.body.answered, 2);

    const blank = res.body.rows.find(r => r.keyword === 'commercial plumber cedar park');
    assert.strictEqual(blank.volume, null);
  });

  await test('a term typed in capitals still matches its answer', async () => {
    // NOT COVERED BY THE PAIRS TEST, which looked equivalent and is not:
    // pairsFor lowercases everything it builds, so the asked side is always
    // lower case there and only the reply's casing is in question. Exact mode
    // keeps whatever the customer typed, so BOTH sides need normalising —
    // and dropping it from the asked side went unnoticed until this existed.
    const { handler } = loadRoute({
      exact: async () => ({
        results: [{ keyword: 'plumber cedar park', volume: 170, cpc: 44.64 }],
        cached: false, costUsd: 0.09,
      }),
    });

    const res = fakeRes();
    await handler({
      body: { mode: 'exact', location: 'Cedar Park, TX', terms: 'Plumber Cedar Park' },
    }, res);

    assert.strictEqual(res.body.answered, 1,
      'the answer did not match a term typed in capitals');
    assert.strictEqual(res.body.rows[0].volume, 170);
  });

  await test('the order asked is the order shown', async () => {
    // Exact mode is not a ranking — the customer wrote the list and should
    // be able to read their answers down it. Sorting by volume, as the
    // pairings do, would shuffle it under them.
    const { handler } = loadRoute({
      exact: async () => ({
        results: [
          { keyword: 'water heater repair', volume: 480, cpc: 82.33 },
          { keyword: 'plumber cedar park', volume: 170, cpc: 44.64 },
        ],
        cached: false, costUsd: 0.09,
      }),
    });

    const res = fakeRes();
    await handler({
      body: {
        mode: 'exact',
        location: 'Cedar Park, TX',
        terms: 'plumber cedar park\nwater heater repair',
      },
    }, res);

    assert.deepStrictEqual(
      res.body.rows.map(r => r.keyword),
      ['plumber cedar park', 'water heater repair']
    );
  });

  await test('the log records how many were asked and how many answered', async () => {
    const seen = [];
    const { handler } = loadRoute({
      onLog: (event, fields) => seen.push({ event, fields }),
      exact: async () => ({
        results: [{ keyword: 'plumber cedar park', volume: 170, cpc: 44.64 }],
        cached: false, costUsd: 0.09,
      }),
    });

    await handler({
      body: {
        mode: 'exact',
        location: 'Cedar Park, TX',
        terms: 'plumber cedar park\ncommercial plumber cedar park',
      },
    }, fakeRes());

    const line = seen.find(l => l.event === 'keywords.exact');
    assert.strictEqual(line.fields.asked, 2);
    assert.strictEqual(line.fields.answered, 1);
    // `volume` stays meaningful for the single-term case, which is most of
    // them, so old log lines and new ones read the same way.
    assert.strictEqual(line.fields.volume, null);
  });

  await test('exact mode reports 10 a month as 10 a month', async () => {
    // The explicit ask. A number Google barely stands behind is still the
    // answer to the question, and rounding it away would be the tool
    // deciding the customer cannot handle it.
    const { handler } = loadRoute({
      exact: async () => ({
        results: [{ keyword: 'slab leak repair cedar park', volume: 10, cpc: null }],
        cached: false, costUsd: 0.09,
      }),
    });

    const res = fakeRes();
    await handler({
      body: { mode: 'exact', category: 'slab leak repair cedar park', location: 'Cedar Park, TX' },
    }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.rows.length, 1);
    assert.strictEqual(res.body.rows[0].volume, 10);
  });

  await test('exact mode applies NO minimum, whatever the body says', async () => {
    // The minimum belongs to the other mode. Honoured here it would hide the
    // single row the customer asked for and show an empty table instead.
    const { handler } = loadRoute({
      exact: async () => ({
        results: [{ keyword: 'slab leak repair', volume: 10, cpc: null }],
        cached: false, costUsd: 0.09,
      }),
    });

    const res = fakeRes();
    await handler({
      body: {
        mode: 'exact', category: 'slab leak repair',
        location: 'Austin, TX', minVolume: 500,
      },
    }, res);

    assert.strictEqual(res.body.rows.length, 1, 'the minimum leaked into exact mode');
    assert.strictEqual(res.body.minVolume, 0);
  });

  await test('exact mode does not run the brand or intent filters', async () => {
    // A competitor's name is a legitimate thing to look up on purpose, and
    // "tankless water heater" is a legitimate thing to want the number for.
    const { handler } = loadRoute({
      exact: async () => ({
        results: [{ keyword: 'goettl plumbing', volume: 1900, cpc: 4.10 }],
        cached: false, costUsd: 0.09,
      }),
    });

    const res = fakeRes();
    await handler({
      body: { mode: 'exact', category: 'goettl plumbing', location: 'Austin, TX' },
    }, res);

    assert.strictEqual(res.body.rows.length, 1, 'a filter ran in exact mode');
    assert.strictEqual(res.body.rows[0].keyword, 'goettl plumbing');
  });

  await test('an unanswerable term comes back as a blank row, not a 502', async () => {
    // Google declining to report is an ANSWER — "fewer than about ten a
    // month" — and the page says so. A 502 would claim the lookup broke.
    //
    // The row is KEPT rather than dropped, which changed when exact mode
    // started taking several terms: with a list, some answered and some not,
    // dropping the blanks would quietly shorten the table and leave the
    // customer unsure which of their terms had even been checked.
    const { handler } = loadRoute({
      exact: async () => ({ results: [], cached: false, costUsd: 0.09 }),
    });

    const res = fakeRes();
    await handler({
      body: { mode: 'exact', terms: 'zzzz plumbing zzzz', location: 'Austin, TX' },
    }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.rows.length, 1);
    assert.strictEqual(res.body.rows[0].keyword, 'zzzz plumbing zzzz');
    assert.strictEqual(res.body.rows[0].volume, null);
    assert.strictEqual(res.body.answered, 0);
  });

  await test('a failed exact lookup IS a 502', async () => {
    const { handler } = loadRoute({
      exact: async () => { throw new Error('DataForSEO is down'); },
    });

    const res = fakeRes();
    await handler({
      body: { mode: 'exact', category: 'plumbing', location: 'Austin, TX' },
    }, res);

    assert.strictEqual(res.statusCode, 502);
  });

  await test('exact mode with no keyword says so in its own words', async () => {
    const { handler } = loadRoute();
    const res = fakeRes();
    await handler({ body: { mode: 'exact', location: 'Austin, TX' } }, res);

    assert.strictEqual(res.statusCode, 400);
    assert.match(res.body.error, /keyword/i);
    // Not the category-mode wording, which would tell somebody looking up one
    // term to go and name an industry.
    assert.ok(!/industry/i.test(res.body.error));
  });

  await test('exact mode logs its own event with the volume it found', async () => {
    const seen = [];
    const { handler } = loadRoute({
      onLog: (event, fields) => seen.push({ event, fields }),
      exact: async () => ({
        results: [{ keyword: 'plumbing', volume: 2900, cpc: 36.67 }],
        cached: true, costUsd: 0,
      }),
    });

    await handler({
      body: { mode: 'exact', category: 'plumbing', location: 'Austin, TX' },
    }, fakeRes());

    const line = seen.find(l => l.event === 'keywords.exact');
    assert.ok(line, 'nothing was logged for an exact lookup');
    assert.strictEqual(line.fields.volume, 2900);
    assert.strictEqual(line.fields.cached, true);
  });

  /* ---------------------------------------------------------------- *
   * A place name is not a surname
   * ---------------------------------------------------------------- *
   *
   * FOUND IN THE PRODUCTION LOG, NOT BY READING THE CODE. `brandsHidden`
   * looked implausible — 342 hidden against 76 kept for "lemon law firm" in
   * Dallas — and the cause was that the brand filter asks "once the trade's
   * own words are gone, is there a word about the work?". For "plumber cedar
   * park" the leftover is `cedar park`, which describes no work, so it read
   * as a proper noun plus a trade: the same shape as "Goettl Plumbing".
   *
   * It was deleting the 170-a-month keyword the pairs mode exists to find.
   */

  await test('the town is not evidence of a brand', () => {
    const cedar = geoWords('Cedar Park,Texas,United States');

    assert.ok(!looksLikeBrand('plumber cedar park', 'plumbing', { geo: cedar }));
    assert.ok(!looksLikeBrand('cedar park plumber', 'plumbing', { geo: cedar }));
    assert.ok(!looksLikeBrand('plumbing cedar park', 'plumbing', { geo: cedar }));
  });

  await test('the state counts as the place too', () => {
    // "plumbing texas" is a place query as much as "plumbing austin" is.
    const austin = geoWords('Austin,Texas,United States');
    assert.ok(!looksLikeBrand('plumbing texas', 'plumbing', { geo: austin }));
  });

  await test('and the state survives the trip through keywordIdeasFor', () => {
    // NOT THE SAME TEST AS THE ONE ABOVE, which builds the geography by hand
    // and so proves nothing about what the lookup passes. Narrowing the
    // lookup to opts.city alone — which loses the state — went unnoticed
    // until this existed.
    //
    // The intent filter is off here on purpose: "plumbing texas" carries no
    // action word and would be removed by it for an unrelated reason, hiding
    // whether the brand filter had already eaten it.
    return withFetch(() => ideasReply([
      { keyword: 'plumbing texas', search_volume: 320, cpc: 20.00 },
      { keyword: 'goettl plumbing', search_volume: 900, cpc: 4.10 },
    ]), async () => {
      const out = await keywordIdeasFor(['plumbing'], {
        location: 'Austin,Texas,United States',
        intent: false, city: 'Austin', industry: 'plumbing',
        Model: fakeModel(),
      });

      const terms = out.rows.map(r => r.keyword);

      assert.ok(terms.includes('plumbing texas'),
        `the state was not passed to the filter: ${JSON.stringify(terms)}`);
      assert.ok(!terms.includes('goettl plumbing'));
    });
  });

  await test('the trade whose name says least was hit hardest', () => {
    // "lemon law firm" carries no verb at all, so every geo variant looked
    // like a brand. 342 hidden, 76 kept, in one real lookup.
    const dallas = geoWords('Dallas,Texas,United States');

    assert.ok(!looksLikeBrand('lemon law firm dallas', 'lemon law firm', { geo: dallas }));
    assert.ok(!looksLikeBrand('dallas lemon law firm', 'lemon law firm', { geo: dallas }));
  });

  await test('a real competitor is STILL hidden, town or no town', () => {
    // The filter has to keep doing its job. If the fix let brands through,
    // it would have traded one silent failure for another.
    const austin = geoWords('Austin,Texas,United States');

    assert.ok(looksLikeBrand('goettl plumbing', 'plumbing', { geo: austin }));
    assert.ok(looksLikeBrand('goettl plumbing austin', 'plumbing', { geo: austin }),
      'adding the town to a brand name smuggled it past the filter');
    assert.ok(looksLikeBrand('roto rooter', 'plumbing', { geo: austin }));
  });

  await test('"united states" is never evidence of anything', () => {
    // It arrives on the end of every location_name DataForSEO is given, so
    // leaving it in would exempt any keyword containing "states".
    const geo = geoWords('Austin,Texas,United States');
    assert.ok(!geo.has('united'));
    assert.ok(!geo.has('states'));
    assert.ok(geo.has('austin') && geo.has('texas'));
  });

  /* ---------------------------------------------------------------- *
   * The trade's own words, matched by stem
   * ---------------------------------------------------------------- *
   *
   * ALSO FOUND IN THE LOG, on a lookup Edwin ran after the geo fix:
   *
   *   seed: "deck builder"   total: 1754   brandsHidden: 2917
   *
   * More hidden than kept. The business type has "builder" in it and the
   * keyword said "builders", so the plural was a leftover word describing no
   * work, sitting next to a trade — the shape of a company name.
   *
   * PLUMBING HID IT FOR A WEEK. isTradeish is a hard-coded regex covering
   * plumb/roof/electric/hvac/rooter/drain/sewer, so plumbers and roofers got
   * singular and plural by accident and every other trade lost its head
   * terms in silence.
   */

  await test('the plural of the trade is not a brand', () => {
    const austin = geoWords('austin,Texas,United States');

    // "deck builders" is the single best term a deck builder could rank for
    // and the filter was deleting it.
    assert.ok(!looksLikeBrand('deck builders', 'deck builder', { geo: austin }));
    assert.ok(!looksLikeBrand('deck building', 'deck builder', { geo: austin }));
    assert.ok(!looksLikeBrand('deck builders austin', 'deck builder', { geo: austin }));
  });

  await test('every trade gets what plumbing got by accident', () => {
    const austin = geoWords('austin,Texas,United States');

    assert.ok(!looksLikeBrand('roofers austin', 'roofing', { geo: austin }));
    assert.ok(!looksLikeBrand('lemon law firms', 'lemon law firm', { geo: austin }));
    assert.ok(!looksLikeBrand('lemon law lawyers', 'lemon law lawyer', { geo: austin }));
    assert.ok(!looksLikeBrand('landscapers austin', 'landscaping', { geo: austin }));
  });

  await test('stems reduce the forms of a word to what they share', () => {
    assert.strictEqual(stem('builders'), stem('builder'));
    assert.strictEqual(stem('building'), stem('builder'));
    assert.strictEqual(stem('plumbers'), stem('plumbing'));
    assert.strictEqual(stem('roofer'), stem('roofing'));
    assert.strictEqual(stem('services'), stem('service'));
    assert.strictEqual(stem('companies'), 'company');
  });

  await test('a short word is not eaten by the stemmer', () => {
    // "gas" must not become "ga", or every trade dealing in gas loses the
    // word and starts calling its own keywords brands.
    assert.strictEqual(stem('gas'), 'gas');
    assert.strictEqual(stem('law'), 'law');
    assert.strictEqual(stem('ads'), 'ads');
  });

  await test('stemming does NOT let a competitor through', () => {
    // The whole risk of loosening a filter. If a brand name now survives,
    // the fix traded one silent failure for another.
    const austin = geoWords('austin,Texas,United States');

    assert.ok(looksLikeBrand('archadeck of austin', 'deck builder', { geo: austin }));
    assert.ok(looksLikeBrand('goettl plumbing', 'plumbing', { geo: austin }));
    assert.ok(looksLikeBrand('roto rooter', 'plumbing', { geo: austin }));
    assert.ok(looksLikeBrand('mr rooter plumbing', 'plumbing', { geo: austin }));
  });

  await test('isTradeish still covers words outside the business name', () => {
    // A business calling itself "plumbing" never has "rooter", "sewer" or
    // "drain" in its name, so stemming the name alone would not reach them.
    // The regex is kept for exactly that.
    //
    // "sewer repair" was the first fixture here and proved nothing: "repair"
    // is a service word, so it survives with or without isTradeish, and
    // deleting the regex went unnoticed. These terms carry NO service word,
    // so the regex is the only thing between them and the brand filter.
    const austin = geoWords('austin,Texas,United States');

    for (const term of ['drain rooter', 'sewer drain', 'rooter plumbing']) {
      assert.ok(!looksLikeBrand(term, 'plumbing', { geo: austin }),
        `"${term}" is being called a brand`);
    }

    // And the regex does not rescue an actual brand built around one of
    // those words.
    assert.ok(looksLikeBrand('roto rooter', 'plumbing', { geo: austin }));
  });

  await test('no geography passed leaves the old behaviour intact', () => {
    // The wizard's own callers and any future one must not break by omitting
    // the new argument — they just get the narrower answer.
    assert.ok(looksLikeBrand('plumber cedar park', 'plumbing'));
    assert.ok(!looksLikeBrand('emergency plumber', 'plumbing'));
  });

  await test('the geography reaches the filter through keywordIdeasFor', () => {
    // THE WIRING. The rule above is useless if the lookup forgets to pass the
    // location — which is exactly the mutation that slipped through last time
    // a rule and its caller were tested separately.
    return withFetch(() => ideasReply([
      { keyword: 'plumber cedar park', search_volume: 170, cpc: 44.64,
        high_top_of_page_bid: 177.49 },
      { keyword: 'goettl plumbing', search_volume: 900, cpc: 4.10,
        high_top_of_page_bid: 30.00 },
      { keyword: 'water heater repair', search_volume: 480, cpc: 82.33,
        high_top_of_page_bid: 148.26 },
      { keyword: 'drain cleaning', search_volume: 590, cpc: 10.42,
        high_top_of_page_bid: 54.45 },
      { keyword: 'emergency plumber', search_volume: 320, cpc: 80.46,
        high_top_of_page_bid: 148.45 },
    ]), async () => {
      const out = await keywordIdeasFor(['plumbing'], {
        location: 'Cedar Park,Texas,United States',
        intent: true, city: 'Cedar Park', industry: 'plumbing',
        Model: fakeModel(),
      });

      const terms = out.rows.map(r => r.keyword);

      assert.ok(terms.includes('plumber cedar park'),
        `the town term was filtered out: ${JSON.stringify(terms)}`);
      assert.ok(!terms.includes('goettl plumbing'), 'the brand survived');
      assert.strictEqual(out.brandsHidden, 1);
    });
  });

  /* ---------------------------------------------------------------- *
   * An empty DataForSEO account is not a glitch
   * ---------------------------------------------------------------- *
   *
   * THE PRODUCTION FAILURE THIS EXISTS FOR. The research page went down, the
   * page said "please try again in a moment", and the log line sat in the
   * same bucket as a dropped connection. Retrying was never going to work —
   * the balance was spent — and nothing anywhere said so.
   */

  await test('a 402 becomes a billing error, not a generic one', async () => {
    await withFetch(() => ({ ok: false, status: 402, json: async () => ({}) }), async () => {
      await assert.rejects(
        () => fetchIdeas(['plumbing'], { location: 'Austin,Texas,United States' }),
        err => isBillingError(err) && /balance/i.test(err.message)
      );
    });
  });

  await test('the same verdict inside a 200 is caught too', async () => {
    // DataForSEO's transport is frequently 200 with the real status in the
    // task. Checking only the HTTP code would catch this on some calls and
    // miss it on others, which is worse than not checking — the behaviour
    // would look random.
    for (const code of [40200, 40210]) {
      await withFetch(() => ({
        ok: true,
        status: 200,
        json: async () => ({ tasks: [{ status_code: code, status_message: 'Payment Required.' }] }),
      }), async () => {
        await assert.rejects(
          () => fetchIdeas(['plumbing'], { location: 'Austin,Texas,United States' }),
          err => isBillingError(err),
          `task status ${code} was not recognised as a billing failure`
        );
      });
    }
  });

  await test('an ordinary failure is NOT marked as billing', async () => {
    // Otherwise every outage would tell the operator to top up an account
    // that has money in it.
    await withFetch(() => ({ ok: false, status: 500, json: async () => ({}) }), async () => {
      await assert.rejects(
        () => fetchIdeas(['plumbing'], { location: 'Austin,Texas,United States' }),
        err => !isBillingError(err) && /500/.test(err.message)
      );
    });
  });

  await test('a 402 stops telling the customer to try again in a moment', async () => {
    // The lie that cost a debugging session.
    const { handler } = loadRoute({
      ideas: async () => {
        const err = new Error('keyword ideas: DataForSEO returned 402 — the balance is spent');
        err.dataForSeoBilling = true;
        throw err;
      },
    });

    const res = fakeRes();
    await handler({ body: { category: 'plumbing', location: 'Austin, TX' } }, res);

    assert.ok(!/try again in a moment/i.test(res.body.error),
      'the page still invites a retry that cannot work');
    assert.strictEqual(res.statusCode, 503, 'a billing outage is not a bad gateway');
  });

  await test('the customer is not told whose account it is', async () => {
    // Whose balance it is, and that money is involved, is the operator's
    // problem. A customer can only act on "unavailable".
    const { handler } = loadRoute({
      ideas: async () => {
        const err = new Error('balance spent');
        err.dataForSeoBilling = true;
        throw err;
      },
    });

    const res = fakeRes();
    await handler({ body: { category: 'plumbing', location: 'Austin, TX' } }, res);

    assert.ok(!/dataforseo|balance|billing|account|credit|top up/i.test(res.body.error),
      `the customer-facing message leaks the cause: ${res.body.error}`);
  });

  await test('it gets its own log event, greppable and unambiguous', async () => {
    const seen = [];
    const { handler } = loadRoute({
      onLog: (event, fields) => seen.push({ event, fields }),
      ideas: async () => {
        const err = new Error('balance spent');
        err.dataForSeoBilling = true;
        throw err;
      },
    });

    await handler({ body: { category: 'plumbing', location: 'Austin, TX' } }, fakeRes());

    assert.ok(seen.some(l => l.event === 'keywords.accountEmpty'),
      `the billing failure was logged as: ${seen.map(l => l.event).join(', ')}`);
    assert.ok(!seen.some(l => l.event === 'keywords.ideasFailed'),
      'it is still in the same bucket as a network blip');

    // And the log says what to do, so the fix does not need this file open
    // beside it at 2am.
    const line = seen.find(l => l.event === 'keywords.accountEmpty');
    assert.match(line.fields.action, /dataforseo/i);
  });

  await test('an ordinary failure keeps the old event and the old wording', async () => {
    const seen = [];
    const { handler } = loadRoute({
      onLog: (event, fields) => seen.push({ event, fields }),
      ideas: async () => { throw new Error('DataForSEO is down'); },
    });

    const res = fakeRes();
    await handler({ body: { category: 'plumbing', location: 'Austin, TX' } }, res);

    assert.ok(seen.some(l => l.event === 'keywords.ideasFailed'));
    assert.strictEqual(res.statusCode, 502);
    assert.match(res.body.error, /try again in a moment/i);
  });

  await test('all three modes report a billing failure the same way', async () => {
    // Three catch blocks; one of them silently keeping the old behaviour is
    // exactly the kind of thing a single-mode test would miss.
    const boom = async () => {
      const err = new Error('balance spent');
      err.dataForSeoBilling = true;
      throw err;
    };

    for (const body of [
      { category: 'plumbing', location: 'Austin, TX' },
      { mode: 'exact', category: 'plumbing', location: 'Austin, TX' },
      { mode: 'pairs', category: 'plumbing', location: 'Austin, TX' },
    ]) {
      const seen = [];
      const { handler } = loadRoute({
        onLog: (event, fields) => seen.push({ event, fields }),
        ideas: boom,
        exact: boom,
      });

      const res = fakeRes();
      await handler({ body }, res);

      const mode = body.mode || 'category';
      assert.strictEqual(res.statusCode, 503, `${mode} mode returned ${res.statusCode}`);
      assert.ok(seen.some(l => l.event === 'keywords.accountEmpty'),
        `${mode} mode did not log the billing event`);
      assert.ok(!/try again in a moment/i.test(res.body.error),
        `${mode} mode still invites a pointless retry`);
    }
  });

  /* ---------------------------------------------------------------- *
   * Pairs mode — the trade crossed with the town
   * ---------------------------------------------------------------- *
   *
   * Discovery structurally cannot return these: Google treats the city as a
   * targeting setting rather than as text, so its idea engine proposes
   * "plumbers near me" and never "plumber cedar park" — which is 170 searches
   * a month at $44.64 a click.
   */

  await test('pairs is a mode of its own, and an unknown mode is not', () => {
    const { mod } = loadRoute();
    assert.strictEqual(mod.modeOf({ mode: 'pairs' }), 'pairs');
    assert.strictEqual(mod.modeOf({ mode: 'PAIRS' }), 'pairs');
    assert.strictEqual(mod.modeOf({ mode: 'pair' }), 'category');
  });

  await test('pairs mode uses the LOOKUP endpoint, never discovery', async () => {
    let sawIdeas = false;
    let sawKeywords = null;

    const { handler } = loadRoute({
      seedTerms: async () => ({ terms: ['drain cleaning'], cached: true, usage: null }),
      exact: async (keywords) => {
        sawKeywords = keywords;
        return { results: [], cached: false, costUsd: 0.09 };
      },
      ideas: async () => { sawIdeas = true; throw new Error('discovery was called'); },
    });

    await handler({
      body: { mode: 'pairs', category: 'plumbing', location: 'Cedar Park, TX' },
    }, fakeRes());

    assert.strictEqual(sawIdeas, false);
    assert.ok(Array.isArray(sawKeywords));
    assert.ok(sawKeywords.includes('plumber cedar park'),
      `the term this mode exists for was not asked about: ${JSON.stringify(sawKeywords)}`);
  });

  await test('one task, not one per pairing', async () => {
    // The economics of the whole mode. Forty separate lookups would be
    // $3.60; forty keywords in one task is $0.09.
    let calls = 0;

    const { handler } = loadRoute({
      exact: async () => { calls++; return { results: [], cached: false, costUsd: 0.09 }; },
    });

    await handler({
      body: { mode: 'pairs', category: 'plumbing', location: 'Cedar Park, TX' },
    }, fakeRes());

    assert.strictEqual(calls, 1);
  });

  await test('a pairing Google will not answer is shown, not dropped', async () => {
    // THE POINT OF THE MODE'S EMPTY ROWS. "Google has no figure for
    // 'commercial plumber cedar park'" tells the customer to build that page
    // around different words. Dropped, they think it was never checked.
    const { handler } = loadRoute({
      seedTerms: async () => ({ terms: [], cached: true, usage: null }),
      exact: async () => ({
        results: [{ keyword: 'plumber cedar park', volume: 170, cpc: 44.64 }],
        cached: false, costUsd: 0.09,
      }),
    });

    const res = fakeRes();
    await handler({
      body: { mode: 'pairs', category: 'plumbing', location: 'Cedar Park, TX' },
    }, res);

    const terms = res.body.rows.map(r => r.keyword);

    assert.ok(res.body.rows.length > 1,
      'only the answered row came back — the rest were dropped');
    assert.ok(terms.includes('emergency plumber cedar park'));

    const blank = res.body.rows.find(r => r.keyword === 'emergency plumber cedar park');
    assert.strictEqual(blank.volume, null);

    // And the page needs the ratio to explain the dashes.
    assert.strictEqual(res.body.answered, 1);
    assert.strictEqual(res.body.total, res.body.rows.length);
  });

  await test('the answered row keeps its numbers through the merge', async () => {
    const { handler } = loadRoute({
      exact: async () => ({
        results: [{
          keyword: 'plumber cedar park',
          volume: 170, cpc: 44.64, low: 61.41, high: 177.49,
        }],
        cached: false, costUsd: 0.09,
      }),
    });

    const res = fakeRes();
    await handler({
      body: { mode: 'pairs', category: 'plumbing', location: 'Cedar Park, TX' },
    }, res);

    const row = res.body.rows[0];
    assert.strictEqual(row.keyword, 'plumber cedar park');
    assert.strictEqual(row.volume, 170);
    assert.strictEqual(row.high, 177.49);
  });

  await test('a reply in different case still matches its pairing', async () => {
    // DataForSEO echoes the keyword back and the casing is not guaranteed.
    // Matched case-sensitively, an answered row would appear as a dash.
    const { handler } = loadRoute({
      exact: async () => ({
        results: [{ keyword: 'Plumber Cedar Park', volume: 170, cpc: 44.64 }],
        cached: false, costUsd: 0.09,
      }),
    });

    const res = fakeRes();
    await handler({
      body: { mode: 'pairs', category: 'plumbing', location: 'Cedar Park, TX' },
    }, res);

    assert.strictEqual(res.body.answered, 1, 'the answer did not match its pairing');
  });

  await test('pairs mode filters nothing — not brands, not intent, not a minimum', async () => {
    const { handler } = loadRoute({
      exact: async () => ({
        results: [{ keyword: 'plumber cedar park', volume: 10, cpc: null }],
        cached: false, costUsd: 0.09,
      }),
    });

    const res = fakeRes();
    await handler({
      body: {
        mode: 'pairs', category: 'plumbing',
        location: 'Cedar Park, TX', minVolume: 500,
      },
    }, res);

    const row = res.body.rows.find(r => r.keyword === 'plumber cedar park');
    assert.strictEqual(row.volume, 10, 'a minimum leaked into pairs mode');
    assert.strictEqual(res.body.minVolume, 0);
  });

  await test('the seed vocabulary reaches the pairing builder', async () => {
    let sawKeywords = null;

    const { handler } = loadRoute({
      seedTerms: async () => ({
        terms: ['slab leak repair', 'backflow testing'], cached: true, usage: null,
      }),
      exact: async (keywords) => {
        sawKeywords = keywords;
        return { results: [], cached: false, costUsd: 0.09 };
      },
    });

    await handler({
      body: { mode: 'pairs', category: 'plumbing', location: 'Cedar Park, TX' },
    }, fakeRes());

    assert.ok(sawKeywords.includes('slab leak repair cedar park'));
    assert.ok(sawKeywords.includes('backflow testing cedar park'));
  });

  await test('a model outage still produces the pairings that matter', async () => {
    // The trade, the person and the qualifiers need nothing from the model.
    let sawKeywords = null;

    const { handler } = loadRoute({
      seedTerms: async () => ({ terms: [], cached: false, usage: null }),
      exact: async (keywords) => {
        sawKeywords = keywords;
        return { results: [], cached: false, costUsd: 0.09 };
      },
    });

    const res = fakeRes();
    await handler({
      body: { mode: 'pairs', category: 'plumbing', location: 'Cedar Park, TX' },
    }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.ok(sawKeywords.includes('plumber cedar park'));
    assert.ok(sawKeywords.includes('emergency plumber cedar park'));
  });

  await test('pairs mode logs how many of its questions Google answered', async () => {
    const seen = [];
    const { handler } = loadRoute({
      onLog: (event, fields) => seen.push({ event, fields }),
      exact: async () => ({
        results: [{ keyword: 'plumber cedar park', volume: 170, cpc: 44.64 }],
        cached: false, costUsd: 0.09,
      }),
    });

    await handler({
      body: { mode: 'pairs', category: 'plumbing', location: 'Cedar Park, TX' },
    }, fakeRes());

    const line = seen.find(l => l.event === 'keywords.pairs');
    assert.ok(line, 'nothing was logged for a pairs lookup');
    assert.strictEqual(line.fields.answered, 1);
    // The ratio worth watching: if most towns answer on a handful, the
    // qualifier list is producing phrases nobody types.
    assert.ok(line.fields.asked > 10);
  });

  await test('a failed pairs lookup is a 502', async () => {
    const { handler } = loadRoute({
      exact: async () => { throw new Error('DataForSEO is down'); },
    });

    const res = fakeRes();
    await handler({
      body: { mode: 'pairs', category: 'plumbing', location: 'Cedar Park, TX' },
    }, res);

    assert.strictEqual(res.statusCode, 502);
  });

  /* ---------------------------------------------------------------- *
   * Category mode — the intent filter, wired through
   * ---------------------------------------------------------------- */

  await test('the intent filter is ON unless the customer asks for everything', async () => {
    // Default on, because the UNFILTERED list is the one that made the tool
    // look broken: a baseball keyword first and ten spellings of "tankless
    // water heater" after it.
    let sawIntent = null;

    const { handler } = loadRoute({
      ideas: async (seeds, opts) => {
        sawIntent = opts.intent;
        return {
          rows: [], cached: false, costUsd: 0, total: 0, buyerIntent: 0,
          aboveMinimum: 0, brandsHidden: 0,
          removedByWords: 0, removedByPrice: 0, collapsed: 0,
        };
      },
    });

    await handler({ body: { category: 'plumbing', location: 'Austin, TX' } }, fakeRes());
    assert.strictEqual(sawIntent, true, 'the filter is off by default');

    await handler({
      body: { category: 'plumbing', location: 'Austin, TX', showAll: true },
    }, fakeRes());
    assert.strictEqual(sawIntent, false, 'Show everything did not turn it off');
  });

  await test('the town and the trade reach the intent filter', async () => {
    // Without the town, "plumber cedar park" fails the geo test and is
    // dropped — the single best page a small-town plumber could build.
    let sawOpts = null;

    const { handler } = loadRoute({
      ideas: async (seeds, opts) => {
        sawOpts = opts;
        return {
          rows: [], cached: false, costUsd: 0, total: 0, buyerIntent: 0,
          aboveMinimum: 0, brandsHidden: 0,
          removedByWords: 0, removedByPrice: 0, collapsed: 0,
        };
      },
    });

    await handler({
      body: { category: 'plumbing', location: 'Cedar Park, TX' },
    }, fakeRes());

    assert.strictEqual(sawOpts.city, 'Cedar Park');
    assert.strictEqual(sawOpts.industry, 'plumbing');
  });

  await test('the page is told how far the intent filter narrowed things', async () => {
    const { handler } = loadRoute({
      ideas: async () => ({
        rows: [{ keyword: 'water heater repair', volume: 480, cpc: 82.33 }],
        cached: false, costUsd: 0.09,
        total: 7030, buyerIntent: 214, aboveMinimum: 214, brandsHidden: 12,
        removedByWords: 6700, removedByPrice: 116, collapsed: 9,
      }),
    });

    const res = fakeRes();
    await handler({ body: { category: 'plumbing', location: 'Austin, TX' } }, res);

    assert.strictEqual(res.body.total, 7030);
    assert.strictEqual(res.body.buyerIntent, 214);
    assert.strictEqual(res.body.intent, true);
  });

  await test('each filter is logged separately, so a hungry one can be found', async () => {
    const seen = [];
    const { handler } = loadRoute({
      onLog: (event, fields) => seen.push({ event, fields }),
      ideas: async () => ({
        rows: [], cached: false, costUsd: 0.09,
        total: 7030, buyerIntent: 214, aboveMinimum: 0, brandsHidden: 12,
        removedByWords: 6700, removedByPrice: 116, collapsed: 9,
      }),
    });

    await handler({ body: { category: 'plumbing', location: 'Austin, TX' } }, fakeRes());

    const line = seen.find(l => l.event === 'keywords.ideas');
    assert.strictEqual(line.fields.removedByWords, 6700);
    assert.strictEqual(line.fields.removedByPrice, 116);
    assert.strictEqual(line.fields.collapsed, 9);
    assert.strictEqual(line.fields.brandsHidden, 12);
    assert.strictEqual(line.fields.mode, 'category');
  });

  await test('the module and the route agree on how many rows are shown', async () => {
    // MAX_IDEAS has moved twice — 20 to 25 when the intent filter stopped
    // the list being padded with ten spellings of one product, then to 30.
    // If the route held its own copy of the number they would drift and
    // nobody would notice which was right.
    let sawLimit = null;

    const { handler } = loadRoute({
      ideas: async (seeds, opts) => {
        sawLimit = opts.limit;
        return {
          rows: [], cached: false, costUsd: 0, total: 0, buyerIntent: 0,
          aboveMinimum: 0, brandsHidden: 0,
          removedByWords: 0, removedByPrice: 0, collapsed: 0,
        };
      },
    });

    await handler({ body: { category: 'plumbing', location: 'Austin, TX' } }, fakeRes());

    assert.strictEqual(sawLimit, MAX_IDEAS);
    assert.strictEqual(MAX_IDEAS, 30);
  });

  /* ---------------------------------------------------------------- *
   * The intent filter, through the real module rather than a stub
   * ---------------------------------------------------------------- */

  await test('keywordIdeasFor removes the junk and keeps the jobs', async () => {
    await withFetch(() => ideasReply([
      { keyword: 'american league detection', search_volume: 27100, cpc: 1.66 },
      { keyword: 'tankless water heater', search_volume: 880, cpc: 8.99 },
      { keyword: 'instant water heater', search_volume: 880, cpc: 8.99 },
      { keyword: 'water heater repair', search_volume: 480, cpc: 82.33 },
      { keyword: 'water heater installation', search_volume: 390, cpc: 83.18 },
      { keyword: 'drain cleaning', search_volume: 590, cpc: 40.00 },
      { keyword: 'plumbers near me', search_volume: 2900, cpc: 54.33 },
    ]), async () => {
      const out = await keywordIdeasFor(['plumbing'], {
        location: 'Austin,Texas,United States',
        intent: true, city: 'Austin', industry: 'plumbing',
        Model: fakeModel(),
      });

      const terms = out.rows.map(r => r.keyword);

      assert.ok(!terms.includes('american league detection'));
      assert.ok(!terms.includes('tankless water heater'));
      assert.ok(terms.includes('water heater repair'));
      assert.ok(terms.includes('plumbers near me'));

      assert.strictEqual(out.total, 7, 'total should still count everything answered');
      assert.ok(out.buyerIntent < out.total);
      assert.ok(out.removedByWords > 0);
    });
  });

  await test('the filter runs AFTER the cache, so unticking it is free', async () => {
    // The whole answer is what was paid for. A customer who wants the wider
    // list must not buy the same question twice.
    const Model = fakeModel();
    let calls = 0;

    await withFetch(() => {
      calls++;
      return ideasReply([
        { keyword: 'tankless water heater', search_volume: 880, cpc: 8.99 },
        { keyword: 'water heater repair', search_volume: 480, cpc: 82.33 },
      ]);
    }, async () => {
      const filtered = await keywordIdeasFor(['plumbing'], {
        location: 'Austin,Texas,United States',
        intent: true, city: 'Austin', industry: 'plumbing', Model,
      });

      const everything = await keywordIdeasFor(['plumbing'], {
        location: 'Austin,Texas,United States',
        intent: false, city: 'Austin', industry: 'plumbing', Model,
      });

      assert.strictEqual(calls, 1, 'showing everything cost a second lookup');
      assert.strictEqual(everything.cached, true);
      assert.ok(everything.rows.length > filtered.rows.length);
    });
  });

  await test('keywordIdeasFor hands the WHOLE answer to the collapse as corpus', async () => {
    /* THE WIRING, NOT THE RULE. utils/keywordIntent has its own suite proving
     * that a corpus picks "garbage disposal repair" over "garburator repair".
     * None of it fires if keywordIdeasFor forgets to pass one — and a
     * deliberate break of exactly that line went unnoticed until this test
     * existed.
     *
     * The fixture is built so ONLY the wide corpus can get it right. Inside
     * the two clustered rows, "garburator" and "garbage" appear once each and
     * are indistinguishable; the tiebreak then falls to length, which picks
     * the Canadian word by six characters.
     *
     * The rows that break the tie — "garbage disposals", "garbage disposal
     * parts" — are ones the INTENT FILTER REMOVES, so they exist only in the
     * full answer. That is the whole point: the corpus has to be everything
     * Google said, not the shortlist. */
    await withFetch(() => ideasReply([
      { keyword: 'garburator repair', search_volume: 390, cpc: 11.32,
        high_top_of_page_bid: 89.69 },
      { keyword: 'garbage disposal repair', search_volume: 390, cpc: 11.32,
        high_top_of_page_bid: 89.69 },

      // Removed by the intent filter; present in the corpus.
      { keyword: 'garbage disposals', search_volume: 880, cpc: 2.03,
        high_top_of_page_bid: 40.00 },
      { keyword: 'garbage disposal parts', search_volume: 210, cpc: 3.10,
        high_top_of_page_bid: 45.00 },

      // Enough priced rows for a median to be computed at all.
      { keyword: 'water heater repair', search_volume: 480, cpc: 82.33,
        high_top_of_page_bid: 148.26 },
      { keyword: 'drain cleaning', search_volume: 590, cpc: 10.42,
        high_top_of_page_bid: 54.45 },
      { keyword: 'plumbing repair', search_volume: 300, cpc: 40.00,
        high_top_of_page_bid: 90.00 },
      { keyword: 'emergency plumber', search_volume: 320, cpc: 80.46,
        high_top_of_page_bid: 148.45 },
    ]), async () => {
      const out = await keywordIdeasFor(['plumbing'], {
        location: 'Austin,Texas,United States',
        intent: true, city: 'Austin', industry: 'plumbing',
        Model: fakeModel(),
      });

      const terms = out.rows.map(r => r.keyword);

      assert.ok(terms.includes('garbage disposal repair'),
        `the Canadian word won: ${JSON.stringify(terms)}`);
      assert.ok(!terms.includes('garburator repair'));

      const merged = out.rows.find(r => r.keyword === 'garbage disposal repair');
      assert.strictEqual(merged.variants, 1, 'the two wordings did not collapse');
    });
  });

  await test('keywordIdeasFor hands the seeds over too', async () => {
    // The other half of the same wiring. Here the corpus cannot decide —
    // both wordings are equally ordinary — and only the seed list knows
    // which phrase the trade actually uses.
    await withFetch(() => ideasReply([
      { keyword: 'disposal repair', search_volume: 390, cpc: 11.32,
        high_top_of_page_bid: 89.69 },
      { keyword: 'garbage disposal repair', search_volume: 390, cpc: 11.32,
        high_top_of_page_bid: 89.69 },
      { keyword: 'water heater repair', search_volume: 480, cpc: 82.33,
        high_top_of_page_bid: 148.26 },
      { keyword: 'drain cleaning', search_volume: 590, cpc: 10.42,
        high_top_of_page_bid: 54.45 },
      { keyword: 'plumbing repair', search_volume: 300, cpc: 40.00,
        high_top_of_page_bid: 90.00 },
      { keyword: 'emergency plumber', search_volume: 320, cpc: 80.46,
        high_top_of_page_bid: 148.45 },
    ]), async () => {
      const out = await keywordIdeasFor(['plumbing', 'garbage disposal repair'], {
        location: 'Austin,Texas,United States',
        intent: true, city: 'Austin', industry: 'plumbing',
        Model: fakeModel(),
      });

      const terms = out.rows.map(r => r.keyword);
      assert.ok(terms.includes('garbage disposal repair'),
        `the seed was ignored: ${JSON.stringify(terms)}`);
    });
  });

  await test('the price veto reaches the high bid through the real module', async () => {
    // keywordVolumes.readResult maps high_top_of_page_bid onto `high`. If
    // that mapping ever changed, the veto would silently fall back to CPC
    // and the baseball would return.
    await withFetch(() => ideasReply([
      { keyword: 'american league detection', search_volume: 27100, cpc: 11.00,
        high_top_of_page_bid: 2.14 },
      { keyword: 'water heater repair', search_volume: 480, cpc: 12.00,
        high_top_of_page_bid: 148.26 },
      { keyword: 'drain cleaning', search_volume: 590, cpc: 12.00,
        high_top_of_page_bid: 54.45 },
      { keyword: 'plumbing repair', search_volume: 300, cpc: 12.00,
        high_top_of_page_bid: 90.00 },
      { keyword: 'emergency plumber', search_volume: 320, cpc: 12.00,
        high_top_of_page_bid: 148.45 },
    ]), async () => {
      const out = await keywordIdeasFor(['plumbing'], {
        location: 'Austin,Texas,United States',
        intent: true, city: 'Austin', industry: 'plumbing',
        Model: fakeModel(),
      });

      const terms = out.rows.map(r => r.keyword);

      // Every CPC here is identical, so a veto reading CPC removes nothing
      // and this assertion can only pass on the bid.
      assert.ok(!terms.includes('american league detection'),
        'the veto is reading cost per click, not the highest bid');
      assert.ok(terms.includes('drain cleaning'));
    });
  });

  await test('with the filter off, buyerIntent equals total', async () => {
    // So the page can word itself the same way in both states without a
    // special case — and so a broken filter cannot hide behind the wording.
    await withFetch(() => ideasReply([
      { keyword: 'tankless water heater', search_volume: 880, cpc: 8.99 },
      { keyword: 'water heater repair', search_volume: 480, cpc: 82.33 },
    ]), async () => {
      const out = await keywordIdeasFor(['plumbing'], {
        location: 'Austin,Texas,United States', intent: false, Model: fakeModel(),
      });

      assert.strictEqual(out.buyerIntent, out.total);
      assert.strictEqual(out.removedByWords, 0);
      assert.strictEqual(out.collapsed, 0);
    });
  });

  /* ---------------------------------------------------------------- *
   * The page, in both modes
   * ---------------------------------------------------------------- */

  await test('every field says which modes it belongs to', () => {
    assert.match(pageHtml, /name="kwMode"/, 'there is no mode switch');
    assert.match(pageHtml, /id="kwModeExact"/);

    // A LIST of modes per block, not one. Industry belongs to two modes and
    // the Keywords textarea to one; a single-value marker could not say that,
    // which is why the earlier `data-mode="category"` scheme was replaced.
    assert.match(pageHtml, /data-modes="category pairs"/,
      'the Industry field does not belong to both trade modes');
    assert.match(pageHtml, /data-modes="exact"/,
      'nothing is marked as belonging to exact mode');

    // The minimum, the related terms and the show-all box are meaningless
    // outside category mode and must all be marked.
    const categoryOnly = pageHtml.split('data-modes="category"').length - 1;
    assert.ok(categoryOnly >= 3, `only ${categoryOnly} blocks are category-only`);

    assert.match(pageJs, /applyMode/, 'the page never swaps the fields');
  });

  await test('exact mode gets its own textarea, not the Industry box relabelled', () => {
    // A single-line input cannot take a pasted column from Keyword Planner,
    // and relabelling the shared box meant the two fields could never be
    // validated or sent differently.
    assert.match(pageHtml, /<textarea[^>]*id="kwTerms"/,
      'there is no Keywords textarea');
    assert.match(pageJs, /kwTerms/, 'the page never reads the textarea');

    // And the request carries it separately from the industry.
    assert.match(pageJs, /JSON\.stringify\(\{[\s\S]{0,200}?\bterms\b/,
      'the terms are not sent to the server');
  });

  await test('exact mode validates the textarea, not the Industry box', () => {
    // Checking the wrong field would block a valid search or send an empty
    // one — and an empty one still costs $0.09.
    const fn = pageJs.match(/form\.addEventListener[\s\S]*?\n  \}\);/);
    assert.ok(fn, 'the submit handler is gone');
    assert.match(fn[0], /mode === 'exact' \? !terms : !category/,
      'the wrong field is checked for emptiness');
  });

  await test('the mode is sent with the request', () => {
    assert.match(pageJs, /JSON\.stringify\(\{[^}]*\bmode\b/,
      'the body carries no mode, so the server always runs discovery');
    assert.match(pageJs, /showAll/, 'the show-everything box is never sent');
  });

  await test('the table shows the low and high bids', () => {
    assert.match(pageJs, /Lowest bid/);
    assert.match(pageJs, /Highest bid/);
    assert.match(pageJs, /money\(r\.low\)/);
    assert.match(pageJs, /money\(r\.high\)/);
  });

  await test('a collapsed row says how many wordings it stands for', () => {
    assert.match(pageJs, /r\.variants/, 'the variant count is never shown');
    assert.match(pageHtml, /\.variant-note/, 'the variant note has no styling');
  });

  await test('one term asked and answered needs no ratio', () => {
    // "1 of 1 have a figure" is noise dressed as data.
    const { countLine } = liftFromPage('number', 'countLine');

    assert.strictEqual(
      countLine({ mode: 'exact', total: 1, answered: 1, minVolume: 0 }),
      'Exact match'
    );
  });

  await test('several terms get the ratio, and so does a single blank one', () => {
    const { countLine } = liftFromPage('number', 'countLine');

    assert.strictEqual(
      countLine({ mode: 'exact', total: 6, answered: 4, minVolume: 0 }),
      '4 of 6 have a figure'
    );

    // One term with no figure is NOT "Exact match" — nothing was matched.
    assert.strictEqual(
      countLine({ mode: 'exact', total: 1, answered: 0, minVolume: 0 }),
      '0 of 1 have a figure'
    );
  });

  await test('the count line names the intent filter when it removed something', () => {
    const { countLine } = liftFromPage('number', 'countLine');

    const text = countLine({
      mode: 'category', total: 7030, buyerIntent: 214,
      aboveMinimum: 214, minVolume: 0, intent: true,
    });

    assert.match(text, /214/, 'the buyer-intent count is missing');
    assert.match(text, /7,030/, 'the denominator is missing');
    assert.match(text, /intent/i);
  });

  await test('the count line stays quiet about a filter that removed nothing', () => {
    // A chain of identical numbers explains nothing and reads as clutter.
    const { countLine } = liftFromPage('number', 'countLine');

    assert.strictEqual(
      countLine({
        mode: 'category', total: 214, buyerIntent: 214,
        aboveMinimum: 214, minVolume: 0, intent: true,
      }),
      '214 keywords found'
    );
  });

  await test('the heading does not claim a ranking in exact or pairs mode', () => {
    const { heading } = liftFromPage('heading');

    assert.strictEqual(heading({ mode: 'exact' }, 1, 'Austin, TX'), 'In Austin, TX');

    // Pairs is EXHAUSTIVE, not ranked — every pairing asked about is on it,
    // including the unanswered ones. "Top 38" would be a claim about a
    // ranking that does not exist.
    assert.ok(!/^Top /.test(heading({ mode: 'pairs' }, 38, 'Cedar Park, TX')));

    assert.strictEqual(
      heading({ mode: 'category' }, 25, 'Austin, TX'),
      'Top 25 for Austin, TX'
    );
  });

  await test('the pairs count line gives the ratio that explains the dashes', () => {
    const { countLine } = liftFromPage('number', 'countLine');

    const text = countLine({ mode: 'pairs', total: 38, answered: 12 });

    assert.match(text, /\b12\b/);
    assert.match(text, /\b38\b/);
  });

  await test('the page offers all three modes and sends the right one', () => {
    assert.match(pageHtml, /id="kwModePairs"/, 'there is no pairs mode on the page');
    assert.match(pageHtml, /value="pairs"/);

    const fn = pageJs.match(/function currentMode[\s\S]*?\n  }/);
    assert.ok(fn, 'currentMode is gone');
    assert.match(fn[0], /pairs/,
      'the page cannot report pairs mode, so the server would run discovery');
  });

  await test('a block is shown only in the modes it names', () => {
    // The minimum, the related terms and the show-everything box belong to
    // category mode alone; Industry to category and pairs; the textarea to
    // exact. Checked by running the real function against a fake document,
    // rather than by reading the source for a substring — reading the source
    // is how a test passes while the page is wrong.
    const seen = {};

    const blocks = [
      { el: { set hidden(v) { seen.minimum = v; } }, modes: ['category'] },
      { el: { set hidden(v) { seen.industry = v; } }, modes: ['category', 'pairs'] },
      { el: { set hidden(v) { seen.terms = v; } }, modes: ['exact'] },
    ];

    // applyMode closes over modeBlocks and currentMode, so it is rebuilt here
    // from its own source with those two supplied.
    const src = pageJs.match(/function applyMode[\s\S]*?\n  \}/);
    assert.ok(src, 'applyMode is gone');

    const build = new Function('modeBlocks', 'mode', `
      const currentMode = () => mode;
      const categoryHelp = { textContent: '' };
      ${src[0]}
      applyMode();
    `);

    build(blocks, 'category');
    assert.deepStrictEqual(seen, { minimum: false, industry: false, terms: true });

    build(blocks, 'pairs');
    assert.deepStrictEqual(seen, { minimum: true, industry: false, terms: true },
      'pairs mode is showing a dead minimum box, or hiding the industry');

    build(blocks, 'exact');
    assert.deepStrictEqual(seen, { minimum: true, industry: true, terms: false });
  });

  await test('the page explains what a dash means in pairs mode', () => {
    // "No figure" and "nobody searches this" are different claims and the
    // customer will assume the second one unless told.
    const fn = pageJs.match(/function render[\s\S]*?\n  }\n/);
    assert.ok(fn, 'render is gone');
    assert.match(fn[0], /dash/i, 'nothing on the card explains the empty rows');
  });

  await test('an unanswerable exact term explains the reporting floor', () => {
    // "Google has no figure" and "nobody searches this" are different claims
    // and only one of them is true.
    const fn = pageJs.match(/function render[\s\S]*?\n  }\n/);
    assert.ok(fn, 'render is gone');
    assert.match(fn[0], /ten searches a month|about ten/i,
      'the empty exact answer does not explain itself');
  });

  console.log('');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('');
  process.exit(failed === 0 ? 0 : 1);
}

main();
