// test-blog-pages.js
//
// Renders the two pages a new customer actually walks through, with the real
// routers and stubbed models, and reads the HTML that comes out.
//
// A template literal that references an undefined variable is a runtime
// error, not a syntax one — `node --check` says nothing about it, and the
// first person to find out would be the customer looking at a 500. So the
// pages are requested, not inspected.
//
// What it proves:
//   1. /blog-sites renders, and leads with installing the plugin
//   2. It names the server address to paste, taken from the request
//   3. The plugin version shown is the real one
//   4. The key page shows the key once and still offers the plugin
//   5. Values that come from a customer's WordPress are escaped
//   6. The dashboard card renders and links to /blog-sites
//
//   node test-blog-pages.js

const assert = require('assert');
const Module = require('module');
const path = require('path');
const http = require('http');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

/* -------------------------------------------------------------------------
 * Stubs
 *
 * Only the things that reach Mongo. Everything the pages are actually being
 * tested for — the templates, the packager, the escaping — is the real code.
 * ---------------------------------------------------------------------- */

const USER = {
  _id: '507f1f77bcf86cd799439011',
  email: 'plumber@example.com',
  role: 'user',
  credits: 6274,
};

// A site URL with markup in it, because siteUrl is reported BY the plugin and
// is therefore attacker-controlled if someone points a hostile install here.
const HOSTILE_URL = 'https://evil.example/"><script>alert(1)</script>';

const state = {
  sites: [],
  campaignCounts: [],
  created: null,
};

const stubs = {
  '../models/BlogSite': {
    find: () => ({ sort: () => ({ lean: async () => state.sites }) }),
    countDocuments: async () => state.sites.filter(s => s.status !== 'revoked').length,
    generateLicenceKey: () => 'IE-TEST-KEY-ABCD-1234-WXYZ',
    hashLicenceKey: () => 'hash',
    generateSecret: () => 'secret',
    create: async (doc) => { state.created = doc; return { ...doc, _id: 'newsiteid' }; },
    findOneAndUpdate: async () => null,
    exists: async () => state.sites.some(s => s.status !== 'revoked'),
  },
  '../models/BlogCampaign': {
    aggregate: async () => state.campaignCounts,
    updateMany: async () => ({}),
  },
  '../models/User': {
    findById: () => ({ lean: async () => USER }),
  },
  '../middleware/requireAuth': (req, res, next) => {
    req.user = USER;
    req.session = { userId: USER._id };
    next();
  },
  '../utils/currentSite': { getCurrentSite: () => null },
  '../utils/wpThemeBuilder/buildFromModel': { buildWordPressThemeFromModel: async () => ({}) },
  '../utils/helpers': { cleanDirectory: () => {} },
  '../utils/sendEmail': { sendEmail: async () => {}, verificationEmail: () => ({}) },
  '../utils/renderAuthPage': { renderAuthPage: () => '' },
  '../utils/authTokens': {
    createVerificationToken: () => ({}), hashToken: () => '', notExpired: () => true,
  },
};

const realResolve = Module._resolveFilename;
const realLoad = Module._load;

Module._load = function (request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)
      && parent && /routes[\\/](blogSitesRoute|authRoute|exportWpThemeRoute)\.js$/.test(parent.filename)) {
    return stubs[request];
  }
  return realLoad.apply(this, arguments);
};

/* -------------------------------------------------------------------------
 * A server
 * ---------------------------------------------------------------------- */

const express = require('express');
const pkg = require('./utils/pluginPackage');

const app = express();
app.use(express.urlencoded({ extended: true }));

// The real middleware sets these; the pages read them defensively already,
// but supplying them is closer to the truth.
app.use((req, res, next) => {
  res.locals.csrfField = '<input type="hidden" name="_csrf" value="tok">';
  res.locals.csrfToken = 'tok';
  req.id = 'test-request';
  next();
});

app.use('/', require('./routes/blogSitesRoute'));
app.use('/', require('./routes/authRoute'));

let server, base;

function get(p, headers = {}) {
  return request('GET', p, headers);
}
function post(p) {
  return request('POST', p, { 'content-type': 'application/x-www-form-urlencoded' }, '');
}
function request(method, p, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${p}`, { method, headers }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

(async () => {
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;

  const version = pkg.readVersion();

  console.log('\n/blog-sites — the empty state a new customer sees');

  let page;

  await test('it renders', async () => {
    page = await get('/blog-sites');
    assert.strictEqual(page.status, 200, page.body.slice(0, 300));
  });

  await test('installing the plugin comes before creating a key', () => {
    const install = page.body.indexOf('Install the plugin');
    const key = page.body.indexOf('Create a licence key');
    assert.ok(install > -1, 'no install step');
    assert.ok(key > -1, 'no key step');
    assert.ok(install < key, 'the key step is offered before the plugin exists');
  });

  await test('the download link is there, with the real version', () => {
    assert.ok(page.body.includes('href="/plugin/download"'), 'no download link');
    assert.ok(page.body.includes(`version ${version}`), `version ${version} not shown`);
  });

  await test('it names the server address to paste into WordPress', () => {
    // Derived from the Host header, so it is right on localhost, on ngrok and
    // in production without anyone configuring anything.
    assert.ok(page.body.includes(`<code class="user-select-all">${base}</code>`),
      `expected the address ${base} on the page`);
  });

  await test('BASE_URL wins when it is set', async () => {
    process.env.BASE_URL = 'https://fastwebsitegenerator.com';
    try {
      const p = await get('/blog-sites');
      assert.ok(p.body.includes('https://fastwebsitegenerator.com</code>'));
    } finally {
      delete process.env.BASE_URL;
    }
  });

  await test('the credit price is stated', () => {
    const { CREDITS_PER_POST } = require('./utils/blogPricing');
    assert.ok(page.body.includes(String(CREDITS_PER_POST)), 'no per-post price');
  });

  console.log('\n/blog-sites — with a site connected');

  await test('a connected site is listed', async () => {
    state.sites = [{
      _id: '507f1f77bcf86cd799439012',
      siteUrl: 'https://qualityplumbing.example',
      licenceKeyLast4: 'WXYZ',
      status: 'active',
      lastSeenAt: new Date(),
    }];
    state.campaignCounts = [{ _id: '507f1f77bcf86cd799439012', campaigns: 2 }];

    const p = await get('/blog-sites');
    assert.ok(p.body.includes('qualityplumbing.example'), 'the site is not listed');
    assert.ok(p.body.includes('key ending WXYZ'), 'the key hint is missing');
  });

  await test('a hostile site URL is escaped, not executed', async () => {
    state.sites = [{
      _id: '507f1f77bcf86cd799439013',
      siteUrl: HOSTILE_URL,
      status: 'active',
      lastSeenAt: new Date(),
    }];

    const p = await get('/blog-sites');
    assert.ok(!p.body.includes('<script>alert(1)</script>'), 'STORED XSS: script tag survived');
    assert.ok(p.body.includes('&lt;script&gt;'), 'expected the tag to be escaped');

    state.sites = [];
    state.campaignCounts = [];
  });

  console.log('\nThe page that shows a new licence key');

  let keyPage;

  await test('it renders and shows the key once', async () => {
    keyPage = await post('/blog-sites');
    assert.strictEqual(keyPage.status, 200, keyPage.body.slice(0, 300));
    assert.ok(keyPage.body.includes('IE-TEST-KEY-ABCD-1234-WXYZ'), 'the key is not shown');
  });

  await test('only the hash reaches the database', () => {
    assert.ok(state.created, 'nothing was created');
    const stored = JSON.stringify(state.created);
    assert.ok(!stored.includes('IE-TEST-KEY-ABCD-1234-WXYZ'),
      'the licence key itself was written to the database');
  });

  await test('it still offers the plugin, for someone who skipped step 1', () => {
    assert.ok(keyPage.body.includes('href="/plugin/download"'),
      'no way to get the plugin from the page that hands out the key');
  });

  await test('it does not offer to create a second key', () => {
    assert.ok(!/action="\/blog-sites" method="POST"/.test(keyPage.body),
      'the key page invites creating another key, which would strand this one');
  });

  console.log('\nThe dashboard');

  await test('the Blog Automation card renders', async () => {
    const p = await get('/dashboard');
    assert.strictEqual(p.status, 200, p.body.slice(0, 300));
    assert.ok(p.body.includes('Blog Automation'), 'no card');
    assert.ok(p.body.includes('href="/blog-sites"'), 'the card does not link anywhere');
    assert.ok(p.body.includes('Set it up'), 'expected the no-sites wording');
  });

  await test('the card counts connected sites once there are some', async () => {
    state.sites = [{ status: 'active' }, { status: 'active' }, { status: 'revoked' }];
    const p = await get('/dashboard');
    assert.ok(p.body.includes('2 WordPress sites connected'),
      'expected 2 connected, with the revoked one excluded');
    assert.ok(p.body.includes('Manage sites'), 'expected the has-sites wording');
    state.sites = [];
  });

  await test('one site is singular', async () => {
    state.sites = [{ status: 'active' }];
    const p = await get('/dashboard');
    assert.ok(p.body.includes('1 WordPress site connected'), 'plural on a single site');
    state.sites = [];
  });

  console.log('\nBase URL');

  const { baseUrl, requireBaseUrlInProduction } = require('./utils/baseUrl');

  await test('BASE_URL wins over the request host', () => {
    process.env.BASE_URL = 'https://fastwebsitegenerator.com';
    try {
      assert.strictEqual(baseUrl({ protocol: 'http', get: () => 'localhost:3000' }),
        'https://fastwebsitegenerator.com');
    } finally { delete process.env.BASE_URL; }
  });

  await test('a trailing slash is trimmed, so links are not built with //', () => {
    process.env.BASE_URL = 'https://fastwebsitegenerator.com/';
    try {
      assert.strictEqual(`${baseUrl()}/verify?token=x`,
        'https://fastwebsitegenerator.com/verify?token=x');
    } finally { delete process.env.BASE_URL; }
  });

  await test('without BASE_URL a request still answers correctly', () => {
    assert.strictEqual(baseUrl({ protocol: 'https', get: () => 'example.com' }),
      'https://example.com');
  });

  await test('sendEmail builds verification links from the shared helper', () => {
    // The bug: this file had its own copy that fell back to localhost, and an
    // email has no request to fall back to. Every verification link sent from
    // production pointed at the recipient's own machine.
    process.env.BASE_URL = 'https://fastwebsitegenerator.com';
    try {
      delete require.cache[require.resolve('./utils/sendEmail')];
      const { verificationEmail } = require('./utils/sendEmail');
      const mail = verificationEmail({ to: 'a@b.com', token: 'TOK' });
      const text = JSON.stringify(mail);
      assert.ok(text.includes('https://fastwebsitegenerator.com/verify?token=TOK'),
        'the link does not use BASE_URL');
      assert.ok(!text.includes('localhost'), 'a localhost link survived');
    } finally { delete process.env.BASE_URL; }
  });

  await test('production refuses to start without BASE_URL', () => {
    const realEnv = process.env.NODE_ENV;
    const realExit = process.exit;
    const realError = console.error;

    let exited = null, said = '';
    process.exit = (code) => { exited = code; throw new Error('__exit__'); };
    console.error = (m) => { said += m; };
    process.env.NODE_ENV = 'production';
    delete process.env.BASE_URL;

    try {
      requireBaseUrlInProduction();
      assert.fail('it started anyway');
    } catch (err) {
      if (err.message !== '__exit__') throw err;
    } finally {
      process.exit = realExit;
      console.error = realError;
      if (realEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = realEnv;
    }

    assert.strictEqual(exited, 1, 'it did not exit non-zero');
    assert.ok(/BASE_URL/.test(said), 'the message does not name the variable');
  });

  await test('production starts fine once BASE_URL is set', () => {
    const realEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.BASE_URL = 'https://fastwebsitegenerator.com';
    try {
      requireBaseUrlInProduction(); // must not throw or exit
    } finally {
      if (realEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = realEnv;
      delete process.env.BASE_URL;
    }
  });

  console.log('\nThe WordPress export success page');

  await test('the route still loads with its new requires', () => {
    // Rendering the real success page needs a built theme on disk, so the
    // checks below read the source. This one does not: it actually loads the
    // module, which is what catches a require that does not resolve — the
    // failure that would take down every WordPress export at once.
    const mod = require('./routes/exportWpThemeRoute');
    assert.strictEqual(typeof mod, 'function', 'not an Express router');
    assert.ok(mod.stack && mod.stack.length, 'the router registered no routes');
  });

  await test('it invites a first-time user to set up Blog Automation', () => {
    // The one moment they have just made a WordPress site, which is the
    // plugin's only prerequisite. Before this the flow ended with
    // "Back to Generator" and no hint the feature existed.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, 'routes', 'exportWpThemeRoute.js'), 'utf8');
    assert.ok(src.includes('href="/blog-sites"'), 'no link to Blog Automation');
    assert.ok(/Set up Blog Automation/.test(src), 'no call to action');
  });

  await test('the invitation is suppressed once a site is connected', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, 'routes', 'exportWpThemeRoute.js'), 'utf8');
    assert.ok(/alreadyConnected \? '' :/.test(src),
      'the prompt is not conditional — it would nag on every re-export');
    assert.ok(/status: \{ \$ne: 'revoked' \}/.test(src),
      'a revoked site would count as connected and hide the prompt for good');
  });

  await test('a failed lookup cannot break the page that just built their theme', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, 'routes', 'exportWpThemeRoute.js'), 'utf8');
    const block = src.slice(src.indexOf('alreadyConnected = await'));
    assert.ok(/catch \(err\)/.test(block.slice(0, 400)),
      'the BlogSite lookup is not wrapped — a Mongo blip would 500 the success page');
  });

  await test('the price comes from the shared constant, not a hardcoded 75', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, 'routes', 'exportWpThemeRoute.js'), 'utf8');
    assert.ok(src.includes("require('../utils/blogPricing')"), 'price not imported');
    assert.ok(src.includes('${CREDITS_PER_POST} credits per post'),
      'the per-post price is hardcoded and will drift');
  });

  server.close();
  Module._load = realLoad;
  Module._resolveFilename = realResolve;

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
