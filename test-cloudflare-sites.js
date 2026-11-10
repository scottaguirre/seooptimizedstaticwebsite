// test-cloudflare-sites.js
//
// Cloudflare Websites: a generated site published to a subdomain on
// Cloudflare Pages.
//
//   node test-cloudflare-sites.js
//
// WHAT THIS SUITE IS ACTUALLY GUARDING
//
// Three things, and only the first is obvious.
//
//   1. THE SEPARATION. Edwin, 5 November: *"these domains will be separate
//      than the ones for blogs. So the dropdown for these domains has to be
//      separate from the dropdown of those for blogs."* Both halves are
//      asserted — this screen offers only website domains, AND /static-blogs
//      offers only blog domains. The second half is a bug fix: that route
//      asked for `{ enabled: true }` and nothing else, so it has been
//      offering GitHub website domains since 29 October.
//
//   2. THE MISSING-FIELD TRAP. `Domain.target` is newer than the oldest rows
//      in the pool, which have no `target` key at all. In MongoDB,
//      `{ target: 'cloudflare' }` does not match a document that lacks the
//      field — so the obvious spelling of the blog filter would have hidden
//      every domain Edwin added in the first week. This is the failure that
//      would have been silent in both directions: nothing errors, a dropdown
//      is just short.
//
//   3. THE FIELD-NAME CONTRACT WITH deployBlog(). That function reads
//      `blog.siteUrl` and `blog.project` and nothing else. A CloudflareSite
//      satisfies it by spelling those two fields the same way, which is a
//      promise no type system here is enforcing — so it is enforced by
//      calling the real deployBlog() with a real-shaped record and checking
//      where the files went.
//
// WHY THE ROUTE'S IMPORTS ARE NAMESPACED, AND WHY THAT MATTERS HERE
//
// Everything this suite stubs is read off its module at call time. A
// destructured import is captured at require() and a stub set afterwards
// replaces the module's copy, not the router's — which does not fail, it
// reaches the live thing. test-blog-domains.js records what that costs: a
// forgotten Cloudflare stub does not go red, it makes a live HTTPS call and
// hangs inside ./deploy.sh.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

/* A KEY THE SUITE NEVER USES, SET BEFORE ANYTHING IS REQUIRED.
 *
 * utils/runGeneration pulls in the OpenAI client, which THROWS AT LOAD with
 * no OPENAI_API_KEY. The route requires it lazily — inside the one handler
 * that rebuilds — so the router loads fine without this; but the stub below
 * has to require the module to replace its export, and that is the moment
 * the client is constructed. No request is ever made: runGeneration itself
 * is replaced before any handler runs. */
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key-never-sent';

const { readSite, walk } = require('./utils/cloudflareSites/siteFiles');
const { blogDomains, siteDomains, githubDomains, targetOf } = require('./utils/domainPool');
const { normalisePrefix } = require('./utils/dnsLabel');
const editableText = require('./utils/cloudflareSites/editableText');
const Job = require('./models/Job');
const { rebuildForJob } = require('./utils/cloudflareSites/rebuildJob');

const router = require('./routes/cloudflareSitesRoute');
const blogRouter = require('./routes/staticBlogsRoute');

const CloudflareSite = require('./models/CloudflareSite');
const BlogSite = require('./models/BlogSite');
const BlogPost = require('./models/BlogPost');
const CloudflareAccount = require('./models/CloudflareAccount');
const Domain = require('./models/Domain');

/* STUBBED THROUGH THEIR MODULES, which is why the route imports them that
 * way. See the note at the top. */
const cfDeploy = require('./utils/blog/cloudflare/deploy');
const cloudflare = require('./utils/blog/cloudflare/accounts');
const siteFiles = require('./utils/cloudflareSites/siteFiles');
const currentSite = require('./utils/currentSite');

/* THE REBUILD AND THE STORE, BOTH REPLACED. The edit handler requires
 * runGeneration lazily, so replacing the export on the cached module is what
 * reaches it — and siteStore writes to disk, which no test here wants. */
const runGen = require('./utils/runGeneration');
const siteStore = require('./utils/cloudflareSites/siteStore');

/* THE REAL deployBlog, HELD BEFORE install() REPLACES IT — and the contract
 * tests at the bottom spent a run proving why this line exists.
 *
 * require() returns the CACHED module object, so `cfDeploy` in this file and
 * `cfDeploy` in the router are the same object. install() setting
 * `cfDeploy.deployBlog` therefore replaces it for everybody, this file
 * included — and a later `require(...).deployBlog` hands back the stub, not
 * the function under test. Both contract tests passed their first three
 * assertions against the stub's canned answer and then failed on "wrangler
 * was never asked to deploy", which is exactly what a stub does not do.
 *
 *     A STUB INSTALLED ON A SHARED MODULE IS INSTALLED EVERYWHERE,
 *     AND "REQUIRE IT AGAIN" DOES NOT GET THE ORIGINAL BACK. */
const REAL_DEPLOY_BLOG = cfDeploy.deployBlog;

let passed = 0, failed = 0;

async function test(name, fn) {
  try { await fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

function section(name) { console.log(`\n${name}\n`); }

/** The last handler on a route, past requireAuth. */
function handler(method, routePath, r = router) {
  const layer = r.stack.find(l => l.route && l.route.path === routePath && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${routePath} is not on the router`);

  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

/* ------------------------------------------------------------ temp builds */

const temps = [];

/**
 * Write a fake build folder and return its path.
 *
 * REAL FILES ON REAL DISK, because that is what readSite() is for. A stubbed
 * fs would make every one of these tests a test of the stub — and the two
 * things actually worth proving here, that `_src` never leaves the box and
 * that bytes survive, are both properties of the real syscalls.
 */
function buildDir(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfsite-test-'));
  temps.push(root);

  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }

  return root;
}

function cleanup() {
  for (const dir of temps) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

/* ------------------------------------------------------------- the stubs */

const ACCOUNT_OID = 'acct-7';
const USER = 'user-1';

/* REAL-SHAPED OBJECT IDS, AND THE SUITE NEEDED TEACHING.
 *
 * ownedSite() refuses anything that is not 24 hex characters BEFORE it
 * queries, so a malformed id is a 404 rather than a Mongoose CastError
 * surfacing as a 500. Written with ids like 's1', eleven tests in this file
 * passed their stubs and then asserted against that 404 — proving the guard
 * works and nothing else. */
const SITE_ID = 'a'.repeat(23) + '1';
const OTHER_ID = 'b'.repeat(23) + '2';

let db;

const JOB_ID = 'c'.repeat(24);

function install(over = {}) {
  db = Object.assign({
    sites: [],
    blogs: [],
    domains: [],
    accounts: [],

    created: null,
    saved: [],
    findFilters: [],
    countFilters: [],

    /* WHAT IS IN dist/user_<id>. Null is "nothing generated yet", which is
     * the state the form must not be rendered in. */
    build: {
      distDir: '/dist/user_1',
      businessName: 'Quality Plumbing',
      location: 'Round Rock, TX',
      generatedAgo: '2 minutes ago',
      pageCount: 8,
      previewUrl: '/dist/user_1',
    },

    /* WHAT readSite() ANSWERS. Defaulted to a usable build so that every
     * test about something else takes the quiet path. */
    read: { ok: true, files: { 'index.html': Buffer.from('<h1>hi</h1>') }, count: 1, bytes: 12 },
    readCalls: [],

    /* WHAT deployBlog() ANSWERS, and what it was asked. Defaulted to a
     * first-time success with both halves of the domain work done. */
    deploy: {
      ok: true,
      url: 'https://hvac-acmesites-com.pages.dev',
      deploymentUrl: 'https://de7c47e4.hvac-acmesites-com.pages.dev',
      project: 'hvac-acmesites-com',
      files: 1,
      setup: { created: true, attached: { ok: true }, dns: { ok: true } },
    },
    deployCalls: [],

    creds: { token: 'cf-token-for-acct-7', account: 'a'.repeat(32) },
    credsError: '',
    credsCalls: [],

    recount: { ok: true, projects: 12 },

    released: { detached: { ok: true }, dns: { ok: true, removed: true } },
    releaseCalls: [],
    deletedProject: { ok: true },
    deleteCalls: [],
  }, over);

  currentSite.getCurrentSite = () => db.build;

  siteFiles.readSite = (dir) => { db.readCalls.push(dir); return db.read; };

  cfDeploy.deployBlog = async (opts) => { db.deployCalls.push(opts); return db.deploy; };

  cfDeploy.releaseDomain = async (opts) => { db.releaseCalls.push(opts); return db.released; };

  cfDeploy.deleteProject = async (opts) => { db.deleteCalls.push(opts); return db.deletedProject; };

  cloudflare.credsFor = async (site) => {
    db.credsCalls.push(site && site.siteUrl);
    if (db.credsError) throw new Error(db.credsError);
    return db.creds;
  };

  cloudflare.recountAccount = async () => db.recount;

  /* THE REBUILD, REPLACED. Unstubbed this calls the real generator — which
   * writes a directory, resizes images and reaches OpenAI — from a unit
   * suite, and would not fail loudly: it would hang. */
  db.builds = [];
  runGen.runGeneration = async (ctx) => {
    db.builds.push(ctx);
    return Object.assign({
      creditsCharged: 0,
      creditsRemaining: null,
      reused: true,
      buildId: 'b1',
      distDir: '/dist/user_1',
    }, db.build_result || {});
  };

  /* THE STORE, REPLACED, so no test here touches builds/sites/. */
  db.captured = [];
  db.restored = [];
  siteStore.capture = async (dir, id) => {
    db.captured.push({ dir, id });
    return db.capture_result || { ok: true, model: { version: 1, pages: [] }, recipe: { version: 1, body: {} }, assets: { files: 0, bytes: 0, skipped: [] } };
  };
  siteStore.restoreAssets = async (id, dir) => {
    db.restored.push({ id, dir });
    return { restored: 0, skipped: 0, had: true };
  };
  siteStore.forget = async () => ({ ok: true });

  /* THE QUEUE, REPLACED. The save handler no longer rebuilds — it writes the
   * words and enqueues. `seq` records the ORDER of the two, because "saved"
   * and "queued" both happening says nothing about the rule that matters. */
  db.jobs = [];
  db.seq = [];
  Job.create = async (doc) => {
    db.seq.push('queued');
    const made = Object.assign({ _id: JOB_ID }, doc);
    db.jobs.push(made);
    return made;
  };

  CloudflareSite.find = (filter) => {
    db.findFilters.push(filter);
    return { sort: () => ({ lean: async () => db.sites }) };
  };

  CloudflareSite.findOne = async (where) => {
    db.findFilters.push(where);

    const found = db.sites.find(s =>
      (!where.siteUrl || s.siteUrl === where.siteUrl)
      && (!where._id || String(s._id) === String(where._id))
      && (!where.user || String(s.user) === String(where.user)));

    if (!found) return null;

    /* A REAL-ENOUGH DOCUMENT: the handlers mutate it and call save(). The
     * saved copy is recorded as a snapshot rather than by reference,
     * because asserting against the live object would pass even if save()
     * were never called at all — which is the bug this records. */
    /* markModified IS WHAT A REAL DOCUMENT HAS and a plain object does not.
     * The edit handler calls it after replacing a Mixed field — mongoose
     * cannot see into one otherwise — so a stub without it throws, and the
     * handler's catch turns that into a 500 that looks like a route bug. */
    found.markModified = () => {};
    found.save = async () => {
      db.seq.push('saved');
      db.saved.push(JSON.parse(JSON.stringify(found)));
      return found;
    };
    return found;
  };

  CloudflareSite.countDocuments = async (where) => {
    db.countFilters.push(where);
    return db.sites.length;
  };

  CloudflareSite.create = async (doc) => {
    db.created = doc;
    const made = Object.assign({ _id: 'new-site' }, doc);
    made.markModified = () => {};
    made.save = async () => { db.saved.push(JSON.parse(JSON.stringify(made))); return made; };
    db.sites.push(made);
    return made;
  };

  BlogSite.findOne = async (where) =>
    db.blogs.find(b => !where.siteUrl || b.siteUrl === where.siteUrl) || null;

  BlogSite.find = () => ({ sort: () => ({ lean: async () => db.blogs }) });
  BlogPost.aggregate = async () => [];

  Domain.find = (filter) => {
    db.findFilters.push(filter);
    return { sort: () => ({ lean: async () => db.domains }) };
  };

  Domain.findOne = async (where) => {
    db.findFilters.push(where);

    return db.domains.find(d => {
      if (where.domain && d.domain !== where.domain) return false;

      /* THE TARGET FILTER, APPLIED RATHER THAN IGNORED — and this stub is
       * the whole reason the POST-handler tests mean anything. A findOne
       * stub that matched on `domain` alone would return a blog domain to
       * the websites handler and the suite would prove nothing about the
       * separation it exists to prove. */
      if (where.target) {
        const want = where.target;
        const have = d.target === undefined ? null : d.target;

        if (want && want.$in) {
          if (!want.$in.some(v => v === have || (null === v && undefined === d.target))) return false;
        } else if (want !== d.target) {
          return false;
        }
      }

      return true;
    }) || null;
  };

  CloudflareAccount.findById = async (id) =>
    db.accounts.find(a => String(a._id) === String(id)) || null;
}

function req(over = {}) {
  return Object.assign(
    { id: 'req-1', user: { _id: USER }, params: {}, body: {} },
    over
  );
}

function res() {
  const out = { status: 200, html: '', redirected: null };
  return {
    out,
    locals: { csrfField: '<input name="_csrf" value="t">' },
    status(code) { out.status = code; return this; },
    send(html) { out.html = String(html); return this; },
    redirect(url) { out.redirected = url; return this; },
  };
}

async function call(h, r = req()) {
  const response = res();
  await h(r, response);
  return response.out;
}

const CF_DOMAIN = { _id: 'dom-cf', domain: 'acmesites.com', target: 'cfsite', account: ACCOUNT_OID, enabled: true };
const BLOG_DOMAIN = { _id: 'dom-blog', domain: 'acmeblogs.com', target: 'cloudflare', account: ACCOUNT_OID, enabled: true };
const GH_DOMAIN = { _id: 'dom-gh', domain: 'acmegh.com', target: 'github', githubInstallationId: '1', enabled: true };
const OLD_DOMAIN = { _id: 'dom-old', domain: 'firstweek.com', account: ACCOUNT_OID, enabled: true };  // no `target` at all
const ACCOUNT = { _id: ACCOUNT_OID, label: 'Client 7', accountId: 'a'.repeat(32), enabled: true, projects: 12 };

(async () => {

/* ===================================================================== */
section('READING A BUILD OFF DISK');

await test('A NESTED BUILD BECOMES POSIX PATHS AND BYTES', async () => {
  const dir = buildDir({
    'index.html': '<h1>home</h1>',
    'css/index.css': 'body{}',
    'faucet-repair/index.html': '<h1>faucet</h1>',
  });

  const read = readSite(dir);

  assert.ok(read.ok, read.error);
  assert.deepStrictEqual(Object.keys(read.files).sort(),
    ['css/index.css', 'faucet-repair/index.html', 'index.html']);

  /* BUFFERS, NOT STRINGS. A generated site is mostly images, and utf8
   * round-tripping corrupts every one of them in a way nothing notices
   * until a browser refuses to draw it. */
  assert.ok(Buffer.isBuffer(read.files['index.html']), 'the contents are not Buffers');
  assert.strictEqual(read.count, 3);
});

await test('AND BINARY CONTENT SURVIVES BYTE FOR BYTE', async () => {
  /* A PNG HEADER AND A BYTE THAT IS NOT VALID UTF-8. Read as text and
   * written back, 0x89 and 0xFF become U+FFFD and the file is ruined. This
   * is the assertion that catches a well-meaning `'utf8'` being added to
   * readFileSync later. */
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0xfe]);

  const dir = buildDir({ 'index.html': 'x', 'assets/logo.png': bytes });
  const read = readSite(dir);

  assert.ok(read.ok, read.error);
  assert.ok(bytes.equals(read.files['assets/logo.png']),
    'the bytes changed on the way through');
});

await test('_src IS NEVER PUBLISHED, AND THAT IS THE WHOLE BUSINESS MODEL', async () => {
  /* `_src/content.json` IS THE GENERATOR'S MODEL: the business name, the
   * address, the phone number, every service, every location and every
   * line of generated copy. Uploaded, it sits at
   * https://<customer-domain>/_src/content.json for anybody who guesses it.
   *
   * utils/contentModel.js already records that _src is stripped before
   * zipping. This is the same rule for the second way out of the folder,
   * and this test is the only thing standing between the two. */
  const dir = buildDir({
    'index.html': 'x',
    '_src/content.json': '{"global":{"businessName":"Quality Plumbing"}}',
    '_src/js/index.js': 'require("../../css/index.css")',
  });

  const read = readSite(dir);

  assert.ok(read.ok, read.error);

  const leaked = Object.keys(read.files).filter(k => k.startsWith('_src'));
  assert.deepStrictEqual(leaked, [], `_src reached the deploy: ${leaked.join(', ')}`);

  /* AND NOT BY SOME OTHER SPELLING EITHER. A test that only checked the
   * `_src/` prefix would pass on an implementation that published the file
   * as `content.json` at the root. */
  const anyModel = Object.keys(read.files).filter(k => k.includes('content.json'));
  assert.deepStrictEqual(anyModel, [], 'the content model reached the deploy');
});

await test('.DS_Store IS LEFT BEHIND', async () => {
  /* Finder writes one into any folder somebody opens, and Edwin's builds
   * live on his Desktop. */
  const dir = buildDir({ 'index.html': 'x', '.DS_Store': 'junk', 'assets/.DS_Store': 'junk' });
  const read = readSite(dir);

  assert.ok(read.ok, read.error);
  assert.deepStrictEqual(Object.keys(read.files), ['index.html']);
  assert.strictEqual(read.skipped.length, 2, 'the skips were not reported');
});

await test('A SYMLINK IS SKIPPED RATHER THAN FOLLOWED', async () => {
  const dir = buildDir({ 'index.html': 'x' });

  const secret = path.join(dir, '..', path.basename(dir) + '-outside.txt');
  fs.writeFileSync(secret, 'not part of the site');
  temps.push(secret);

  try {
    fs.symlinkSync(secret, path.join(dir, 'leak.txt'));
  } catch {
    return;   // no symlink permission on this filesystem; nothing to prove
  }

  const read = readSite(dir);

  assert.ok(read.ok, read.error);
  assert.deepStrictEqual(Object.keys(read.files), ['index.html'],
    'a symlink was followed out of the build folder');
});

await test('A BUILD WITH NO index.html IS REFUSED, AND SAYS SO', async () => {
  /* WITHOUT THIS, the refusal happens at Cloudflare — after a project and a
   * DNS record have been created — and reads as a broken deploy rather than
   * as a build that was never finished. */
  const dir = buildDir({ 'css/index.css': 'body{}' });
  const read = readSite(dir);

  assert.strictEqual(read.ok, false);
  assert.match(read.error, /index\.html/);
});

await test('A FOLDER THAT IS NOT THERE IS REFUSED, AND SAYS WHAT TO DO', async () => {
  const read = readSite(path.join(os.tmpdir(), 'cfsite-does-not-exist-' + Date.now()));

  assert.strictEqual(read.ok, false);
  assert.match(read.error, /Generate a website first/);
});

await test('A FILE OVER CLOUDFLARE\'S 25MB CEILING IS REFUSED BY NAME', async () => {
  /* A SPARSE FILE, so this costs no disk and no time. ftruncate gives a
   * 26MB file whose blocks are never written — which is exactly what the
   * size check reads, and the point is that it is read BEFORE the file is,
   * so a huge file is never loaded into memory to find out it is huge. */
  const dir = buildDir({ 'index.html': 'x' });
  const big = path.join(dir, 'assets', 'huge.mp4');

  fs.mkdirSync(path.dirname(big), { recursive: true });
  const fd = fs.openSync(big, 'w');
  fs.ftruncateSync(fd, 26 * 1024 * 1024);
  fs.closeSync(fd);

  const read = readSite(dir);

  assert.strictEqual(read.ok, false);
  assert.match(read.error, /huge\.mp4/);
  assert.match(read.error, /25MB/);
});

/* ===================================================================== */
section('WHICH DOMAINS BELONG TO WHICH DROPDOWN');

/**
 * The one MongoDB rule these filters turn on, written out once.
 *
 * A TINY MATCHER IN THE TEST RATHER THAN A STRUCTURAL ASSERTION. Checking
 * that blogDomains() "contains null somewhere" would pass on a filter that
 * contained it in the wrong place. This implements the documented rule —
 * equality matches the stored value, and `null` ALSO matches a missing field
 * — and then asserts the partition.
 */
function matches(filter, row) {
  const want = filter.target;
  const have = Object.prototype.hasOwnProperty.call(row, 'target') ? row.target : undefined;

  const hit = (v) => v === have || (null === v && undefined === have);

  return want && want.$in ? want.$in.some(hit) : hit(want);
}

await test('A ROW STORED BEFORE `target` EXISTED IS A BLOG ROW', async () => {
  /* THE SILENT ONE. Mongoose applies `default` on SAVE, not retroactively,
   * so every domain Edwin added before 29 October has no `target` key — and
   * `{ target: 'cloudflare' }` does not match a document that lacks the
   * field. Written the obvious way, the blog filter would have emptied the
   * dropdown that needs these rows most, with nothing to see but a short
   * list. */
  assert.ok(matches(blogDomains(), OLD_DOMAIN),
    'the blog filter drops every domain added before the field existed');
});

await test('AND THE WEBSITES FILTER DOES NOT ADOPT IT', async () => {
  /* THE MIRROR, AND THE REASON siteDomains() IS NOT ALSO SPELLED WITH null.
   * Copying the blog filter's shape here would hand every pre-29-October
   * blog domain to the websites dropdown — the separation Edwin asked for,
   * undone by symmetry. */
  assert.ok(!matches(siteDomains(), OLD_DOMAIN),
    'a legacy blog domain turned up in the websites dropdown');
});

await test('THE THREE FILTERS PARTITION THE POOL: EVERY ROW IN EXACTLY ONE', async () => {
  /* TOTAL AND DISJOINT, asserted together. A row in two dropdowns is two
   * products publishing to one hostname; a row in none is a domain that
   * silently cannot be used. Both are invisible until somebody looks. */
  const rows = [BLOG_DOMAIN, GH_DOMAIN, CF_DOMAIN, OLD_DOMAIN];
  const filters = { blog: blogDomains(), site: siteDomains(), github: githubDomains() };

  for (const row of rows) {
    const hits = Object.entries(filters).filter(([, f]) => matches(f, row)).map(([k]) => k);

    assert.strictEqual(hits.length, 1,
      `${row.domain} (target ${JSON.stringify(row.target)}) matched ${hits.length}: ${hits.join(', ')}`);
  }
});

await test('AND `enabled` IS IN THE FILTER BY DEFAULT, AND DROPPABLE ON PURPOSE', async () => {
  /* The customer-facing dropdowns must leave out a client who has left. The
   * POST handlers pass false so they can load the row and refuse it with a
   * sentence, rather than finding nothing and saying "not a domain we
   * host" about a domain that is in the pool. */
  assert.strictEqual(blogDomains().enabled, true);
  assert.strictEqual(siteDomains().enabled, true);
  assert.ok(!Object.prototype.hasOwnProperty.call(siteDomains(false), 'enabled'));
});

await test('targetOf() READS A MISSING FIELD AS cloudflare', async () => {
  assert.strictEqual(targetOf(OLD_DOMAIN), 'cloudflare');
  assert.strictEqual(targetOf(CF_DOMAIN), 'cfsite');
  assert.strictEqual(targetOf({}), 'cloudflare');
  assert.strictEqual(targetOf(null), 'cloudflare');
});

/* ===================================================================== */
section('THE SEPARATION, ON BOTH SCREENS');

await test('THE WEBSITES DROPDOWN ASKS FOR WEBSITE DOMAINS ONLY', async () => {
  install({ domains: [CF_DOMAIN], accounts: [ACCOUNT] });

  await call(handler('get', '/cloudflare-sites'));

  const filter = db.findFilters.find(f => f && f.target && !f.domain);
  assert.ok(filter, 'the page asked for domains without saying which kind');
  assert.ok(matches(filter, CF_DOMAIN) && !matches(filter, BLOG_DOMAIN),
    'the websites page would offer blog domains');
});

await test('AND THE BLOGS DROPDOWN ASKS FOR BLOG DOMAINS ONLY', async () => {
  /* THE OTHER HALF OF EDWIN'S REQUIREMENT, AND IT WAS ALREADY BROKEN.
   *
   * /static-blogs asked `Domain.find({ enabled: true })` — correct on the
   * day it was written, when every row was a blog row. Since 29 October it
   * has been offering GitHub website domains, which have NO Cloudflare
   * account: a blog created on one passes every check on that page and then
   * throws in credsFor() at publish time, naming an empty account id.
   *
   * Asserted by calling the real handler rather than by reading the source,
   * because the thing that matters is the filter that reaches Mongo. */
  install({ domains: [BLOG_DOMAIN], accounts: [ACCOUNT] });

  await call(handler('get', '/static-blogs', blogRouter));

  const filter = db.findFilters.find(f => f && f.target && !f.domain);
  assert.ok(filter, '/static-blogs still asks for every domain in the pool');

  assert.ok(matches(filter, BLOG_DOMAIN), 'it no longer offers blog domains');
  assert.ok(matches(filter, OLD_DOMAIN), 'it drops the oldest blog domains');
  assert.ok(!matches(filter, CF_DOMAIN), 'it offers Cloudflare website domains');
  assert.ok(!matches(filter, GH_DOMAIN), 'it offers GitHub website domains');
});

await test('A POSTED BLOG DOMAIN IS REFUSED BY THE WEBSITES HANDLER', async () => {
  /* THE DROPDOWN IS NOT THE DOOR. A stale page, or anybody at all, can post
   * a domain that was never offered — and without the `target` in the
   * query, a website would be created on a hostname the blog screen also
   * offers, with whichever published second overwriting the other. */
  install({ domains: [CF_DOMAIN, BLOG_DOMAIN], accounts: [ACCOUNT] });

  const out = await call(handler('post', '/cloudflare-sites'),
    req({ body: { name: 'Quality Plumbing', prefix: 'hvac', domain: 'acmeblogs.com' } }));

  assert.strictEqual(out.status, 400);
  assert.match(out.html, /not available for websites/);
  assert.strictEqual(db.created, null, 'a site was created on a blog domain');
});

await test('AND SO IS A GITHUB DOMAIN', async () => {
  install({ domains: [CF_DOMAIN, GH_DOMAIN], accounts: [ACCOUNT] });

  const out = await call(handler('post', '/cloudflare-sites'),
    req({ body: { name: 'Quality Plumbing', prefix: 'hvac', domain: 'acmegh.com' } }));

  assert.strictEqual(out.status, 400);
  assert.strictEqual(db.created, null);
});

await test('AND A POSTED WEBSITE DOMAIN IS REFUSED BY THE BLOGS HANDLER', async () => {
  install({ domains: [BLOG_DOMAIN, CF_DOMAIN], accounts: [ACCOUNT] });

  const out = await call(handler('post', '/static-blogs', blogRouter),
    req({ body: { name: 'A blog', prefix: 'news', domain: 'acmesites.com' } }));

  assert.strictEqual(out.status, 400);
  assert.match(out.html, /not available/);
});

/* ===================================================================== */
section('PUBLISHING');

await test('A BAD SUBDOMAIN IS REFUSED BEFORE ANYTHING ELSE HAPPENS', async () => {
  for (const prefix of ['', 'www', 'my.site', '-lead', 'lead-', 'a b', 'HVAC!']) {
    install({ domains: [CF_DOMAIN], accounts: [ACCOUNT] });

    const out = await call(handler('post', '/cloudflare-sites'),
      req({ body: { name: 'Quality Plumbing', prefix, domain: 'acmesites.com' } }));

    assert.strictEqual(out.status, 400, `"${prefix}" was accepted`);
    assert.strictEqual(db.created, null, `"${prefix}" created a site`);
  }

  /* AND THE ONES THAT MUST WORK, so this is not a test that passes by
   * refusing everything — the mutation that turns normalisePrefix() into
   * `return ''` would otherwise go unnoticed. */
  assert.strictEqual(normalisePrefix(' HVAC '), 'hvac');
  assert.strictEqual(normalisePrefix('quality-plumbing'), 'quality-plumbing');
  assert.strictEqual(normalisePrefix('a1'), 'a1');
});

await test('A HOSTNAME ANOTHER CUSTOMER ALREADY HAS IS REFUSED', async () => {
  /* UNSCOPED, so the refusal can be about a site this person cannot see.
   * The vague wording is the price of not letting them create something
   * that silently overwrites somebody else's — which is what /static-blogs
   * discovered about its own user-scoped check on 22 October. */
  install({
    domains: [CF_DOMAIN],
    accounts: [ACCOUNT],
    sites: [{ _id: OTHER_ID, user: 'somebody-else', siteUrl: 'hvac.acmesites.com' }],
  });

  const out = await call(handler('post', '/cloudflare-sites'),
    req({ body: { name: 'Quality Plumbing', prefix: 'hvac', domain: 'acmesites.com' } }));

  assert.strictEqual(out.status, 400);
  assert.match(out.html, /already in use/);
  assert.strictEqual(db.created, null);
});

await test('AND SO IS ONE A BLOG ALREADY ANSWERS ON', async () => {
  /* A Domain row is either a blog domain or a website domain and never
   * both, so this cannot happen today. It can on the day somebody edits a
   * row's `target` — at which point every hostname under it becomes
   * reachable from the other screen. One indexed lookup. */
  install({
    domains: [CF_DOMAIN],
    accounts: [ACCOUNT],
    blogs: [{ _id: 'blog-1', siteUrl: 'hvac.acmesites.com' }],
  });

  const out = await call(handler('post', '/cloudflare-sites'),
    req({ body: { name: 'Quality Plumbing', prefix: 'hvac', domain: 'acmesites.com' } }));

  assert.strictEqual(out.status, 400);
  assert.strictEqual(db.created, null);
});

await test('NO BUILD MEANS NO ROW, NOT A ROW WITH NOTHING IN IT', async () => {
  /* THE ORDER OF TWO FAILURES. The row is written AFTER the build is read,
   * because `siteUrl` is unique: a row created for a build that turns out
   * to be unpublishable claims that hostname permanently, and the only way
   * to give it back is to delete the row. */
  install({
    domains: [CF_DOMAIN],
    accounts: [ACCOUNT],
    read: { ok: false, error: 'There is no build to publish. Generate a website first.' },
  });

  const out = await call(handler('post', '/cloudflare-sites'),
    req({ body: { name: 'Quality Plumbing', prefix: 'hvac', domain: 'acmesites.com' } }));

  assert.strictEqual(out.status, 400);
  assert.strictEqual(db.created, null, 'a hostname was claimed for a build that does not exist');
  assert.strictEqual(db.deployCalls.length, 0, 'it tried to deploy nothing');
});

await test('A FULL CLOUDFLARE ACCOUNT IS REFUSED, AND NAMES THE DOMAIN', async () => {
  install({
    domains: [CF_DOMAIN],
    accounts: [ACCOUNT],
    recount: { ok: true, projects: 100 },
  });

  const out = await call(handler('post', '/cloudflare-sites'),
    req({ body: { name: 'Quality Plumbing', prefix: 'hvac', domain: 'acmesites.com' } }));

  assert.strictEqual(out.status, 400);
  assert.match(out.html, /acmesites\.com/);
  assert.strictEqual(db.created, null);
});

await test('AND A CHECK THAT COULD NOT RUN LETS THEM THROUGH', async () => {
  /* A revoked token, an outage, a rate limit — all ok:false. Refusing on
   * that basis turns a transient Cloudflare problem into "you cannot
   * publish", for somebody who has done nothing wrong and can see nothing
   * to fix. A FAILURE TO ASK IS NOT AN ANSWER. */
  install({
    domains: [CF_DOMAIN],
    accounts: [ACCOUNT],
    recount: { ok: false, error: 'Cloudflare said no' },
  });

  await call(handler('post', '/cloudflare-sites'),
    req({ body: { name: 'Quality Plumbing', prefix: 'hvac', domain: 'acmesites.com' } }));

  assert.ok(db.created, 'a Cloudflare outage stopped a publish it had no business stopping');
});

await test('THE SITE IS BOUND TO THE DOMAIN\'S ACCOUNT, ONCE, AT CREATE', async () => {
  /* NOT LOOKED UP AGAIN AT PUBLISH TIME. A Domain row can be re-pointed
   * later, and resolving live would silently move an existing site's
   * deploys to an account where its Pages project does not exist — and the
   * error would be "project not found" about a project that is right
   * there. */
  install({ domains: [CF_DOMAIN], accounts: [ACCOUNT] });

  await call(handler('post', '/cloudflare-sites'),
    req({ body: { name: 'Quality Plumbing', prefix: 'hvac', domain: 'acmesites.com' } }));

  assert.ok(db.created, 'nothing was created');
  assert.strictEqual(db.created.siteUrl, 'hvac.acmesites.com');
  assert.strictEqual(String(db.created.cloudflareAccount), ACCOUNT_OID);
  assert.strictEqual(db.created.status, 'draft', 'a site is live before it has been deployed');
});

await test('A SUCCESSFUL FIRST PUBLISH WRITES DOWN WHAT CAME BACK', async () => {
  install({ domains: [CF_DOMAIN], accounts: [ACCOUNT] });

  const out = await call(handler('post', '/cloudflare-sites'),
    req({ body: { name: 'Quality Plumbing', prefix: 'hvac', domain: 'acmesites.com' } }));

  assert.strictEqual(out.status, 200);

  const saved = db.saved[db.saved.length - 1];
  assert.ok(saved, 'nothing was saved');

  assert.strictEqual(saved.status, 'live');
  assert.strictEqual(saved.project, 'hvac-acmesites-com');
  assert.strictEqual(saved.publishCount, 1);
  assert.strictEqual(saved.lastFileCount, 1);
  assert.strictEqual(saved.domainAttached, true);
  assert.strictEqual(saved.dnsCreated, true);

  /* THE UNHASHED ADDRESS. `de7c47e4.<project>.pages.dev` changes every
   * publish and 404s on TLS for minutes on a new project, because
   * *.pages.dev is a one-level wildcard. */
  assert.strictEqual(saved.lastDeployUrl, 'https://hvac-acmesites-com.pages.dev');
  assert.ok(!/de7c47e4/.test(String(saved.lastDeployUrl)),
    'the deployment-hashed address was stored, which goes stale every publish');
});

await test('A DNS RECORD THAT WAS NOT WRITTEN IS SAID OUT LOUD', async () => {
  /* deployBlog's own log once reported `domainAttached: true` while the
   * browser said NXDOMAIN, and both were true: the domain was registered on
   * the project and the CNAME was never created. One sentence could not
   * have said that, so the page says which half failed. */
  install({
    domains: [CF_DOMAIN],
    accounts: [ACCOUNT],
    deploy: {
      ok: true,
      url: 'https://hvac-acmesites-com.pages.dev',
      project: 'hvac-acmesites-com',
      setup: { created: true, attached: { ok: true }, dns: { ok: false, error: 'no Zone:DNS:Edit' } },
    },
  });

  const out = await call(handler('post', '/cloudflare-sites'),
    req({ body: { name: 'Quality Plumbing', prefix: 'hvac', domain: 'acmesites.com' } }));

  assert.match(out.html, /no DNS record yet/);
  assert.match(out.html, /pages\.dev/, 'it does not offer the address that does work');

  const saved = db.saved[db.saved.length - 1];
  assert.strictEqual(saved.dnsCreated, false);
  assert.strictEqual(saved.domainAttached, true, 'the half that worked was recorded as failed too');
});

await test('A FAILED FIRST PUBLISH KEEPS THE ROW, WITH A WAY OUT', async () => {
  /* DELETING IT HERE WOULD BE TIDIER AND WRONG. By this point deployBlog
   * may already have created the Pages project, and throwing away the only
   * record of it leaves an orphan in Cloudflare that nothing in the app can
   * ever reach again. */
  install({
    domains: [CF_DOMAIN],
    accounts: [ACCOUNT],
    deploy: { ok: false, error: 'The deploy to Cloudflare did not finish.', output: 'wrangler said no' },
  });

  const out = await call(handler('post', '/cloudflare-sites'),
    req({ body: { name: 'Quality Plumbing', prefix: 'hvac', domain: 'acmesites.com' } }));

  assert.strictEqual(out.status, 400);
  assert.ok(db.created, 'the row was thrown away along with the record of the project');
  assert.match(out.html, /did not finish/);
  assert.match(out.html, /wrangler said no/, 'the output was withheld');
  assert.match(out.html, /\/delete/, 'there is no way to clear it and start again');
});

await test('A RETRYABLE FAILURE SAYS SO, AND ONLY WHEN deploy.js SAYS SO', async () => {
  install({
    domains: [CF_DOMAIN],
    accounts: [ACCOUNT],
    deploy: { ok: false, error: 'The deploy did not finish.', projectMissing: true },
  });

  const retry = await call(handler('post', '/cloudflare-sites'),
    req({ body: { name: 'Q', prefix: 'hvac', domain: 'acmesites.com' } }));

  assert.match(retry.html, /try publishing again in a few minutes/i);

  install({
    domains: [CF_DOMAIN],
    accounts: [ACCOUNT],
    deploy: { ok: false, error: 'Your token is missing Pages:Edit.' },
  });

  const permanent = await call(handler('post', '/cloudflare-sites'),
    req({ body: { name: 'Q', prefix: 'hvac', domain: 'acmesites.com' } }));

  assert.ok(!/try publishing again in a few minutes/i.test(permanent.html),
    'a permissions error was presented as something that heals on its own');
});

await test('NO ACCOUNT MEANS NO DEPLOY — NEVER A FALLBACK TO OURS', async () => {
  /* credsFor() RETURNS undefined FOR A SITE THAT NAMES NO ACCOUNT, which
   * reaches the env fallback in childEnv() — the SERVER's own Cloudflare
   * credentials. For a blog that is correct; blogs existed before the pool
   * did. For a website it is not: every one is created with an account
   * bound to it, so a missing one means something is wrong, and publishing
   * a customer's site into our account is the worst available answer. */
  install({
    domains: [CF_DOMAIN],
    accounts: [ACCOUNT],
    sites: [{ _id: OTHER_ID, user: USER, siteUrl: 'hvac.acmesites.com', project: 'p', status: 'live' }],
  });

  cloudflare.credsFor = async () => undefined;

  const out = await call(handler('post', '/cloudflare-sites/:id/publish'),
    req({ params: { id: '0'.repeat(24) } }));

  /* The id is not in the stub's list, so this is the not-found path; the
   * assertion that matters is the one below, on a real row. */
  assert.strictEqual(out.status, 404);

  const real = await call(handler('post', '/cloudflare-sites/:id/publish'),
    req({ params: { id: OTHER_ID } }));

  assert.strictEqual(real.status, 400);
  assert.strictEqual(db.deployCalls.length, 0,
    'it deployed a customer site into whatever account the env points at');
});

await test('A CREDENTIAL THAT WILL NOT RESOLVE IS REPORTED, NOT SWALLOWED', async () => {
  install({
    accounts: [ACCOUNT],
    sites: [{ _id: SITE_ID, user: USER, siteUrl: 'hvac.acmesites.com', project: 'p', status: 'live' }],
    credsError: 'The Cloudflare account for this blog is disabled (Client 7).',
  });

  const out = await call(handler('post', '/cloudflare-sites/:id/publish'),
    req({ params: { id: SITE_ID } }));

  assert.strictEqual(out.status, 400);
  assert.match(out.html, /disabled/);
  assert.strictEqual(db.deployCalls.length, 0);
});

/* ===================================================================== */
section('PUBLISHING AGAIN, WHICH IS WHAT REPLACES AN EDIT');

await test('IT DEPLOYS THE CURRENT BUILD OVER THE SAME PROJECT', async () => {
  install({
    accounts: [ACCOUNT],
    sites: [{
      _id: SITE_ID, user: USER, siteUrl: 'hvac.acmesites.com',
      project: 'hvac-acmesites-com', status: 'live', publishCount: 3,
      domainAttached: true, dnsCreated: true,
      lastDeployUrl: 'https://hvac-acmesites-com.pages.dev',
    }],
    deploy: { ok: true, url: 'https://hvac-acmesites-com.pages.dev', project: 'hvac-acmesites-com', setup: null },
    read: { ok: true, files: { 'index.html': Buffer.from('v2') }, count: 9, bytes: 99 },
  });

  const out = await call(handler('post', '/cloudflare-sites/:id/publish'),
    req({ params: { id: SITE_ID } }));

  assert.strictEqual(out.status, 200);

  const sent = db.deployCalls[0];
  assert.strictEqual(sent.blog.project, 'hvac-acmesites-com', 'it did not reuse the project');
  assert.strictEqual(sent.blog.siteUrl, 'hvac.acmesites.com');

  const saved = db.saved[db.saved.length - 1];
  assert.strictEqual(saved.publishCount, 4);
  assert.strictEqual(saved.lastFileCount, 9);
});

await test('AND IT DOES NOT UNDO A DOMAIN THAT IS ALREADY WORKING', async () => {
  /* THE MUTATION THIS CATCHES. deployBlog returns `setup: null` on every
   * deploy after the first, so an unconditional
   * `Boolean(setup.attached && setup.attached.ok)` writes FALSE over a site
   * whose domain has been resolving for a month — and the row then shows a
   * "DNS pending" badge on a site that is fine. */
  install({
    accounts: [ACCOUNT],
    sites: [{
      _id: SITE_ID, user: USER, siteUrl: 'hvac.acmesites.com',
      project: 'p', status: 'live', domainAttached: true, dnsCreated: true,
    }],
    deploy: { ok: true, url: 'https://p.pages.dev', project: 'p', setup: null },
  });

  await call(handler('post', '/cloudflare-sites/:id/publish'), req({ params: { id: SITE_ID } }));

  const saved = db.saved[db.saved.length - 1];
  assert.strictEqual(saved.domainAttached, true, 'a working domain was marked as not attached');
  assert.strictEqual(saved.dnsCreated, true, 'a working DNS record was marked as missing');
});

await test('A DEPLOY WITH NO ADDRESS IN IT KEEPS THE OLD ONE', async () => {
  /* urlFrom() RETURNS null WHEN WRANGLER'S OUTPUT CARRIES NO ADDRESS, and
   * overwriting with null would lose both the only link that works before
   * the certificate is issued AND the `expected` value the delete path uses
   * to avoid removing somebody else's DNS record. */
  install({
    accounts: [ACCOUNT],
    sites: [{
      _id: SITE_ID, user: USER, siteUrl: 'hvac.acmesites.com', project: 'p', status: 'live',
      lastDeployUrl: 'https://p.pages.dev',
    }],
    deploy: { ok: true, url: null, project: 'p', setup: null },
  });

  await call(handler('post', '/cloudflare-sites/:id/publish'), req({ params: { id: SITE_ID } }));

  const saved = db.saved[db.saved.length - 1];
  assert.strictEqual(saved.lastDeployUrl, 'https://p.pages.dev');
});

await test('A REMOVED SITE IS NOT REPUBLISHED', async () => {
  /* Its project and DNS record are gone from Cloudflare. Deploying would
   * create a new project under the same name and leave the hostname
   * pointing at nothing, because the attach only runs when `project` is
   * empty — and on a removed row it is not. */
  install({
    accounts: [ACCOUNT],
    sites: [{ _id: SITE_ID, user: USER, siteUrl: 'hvac.acmesites.com', project: 'p', status: 'removed' }],
  });

  const out = await call(handler('post', '/cloudflare-sites/:id/publish'),
    req({ params: { id: SITE_ID } }));

  assert.strictEqual(out.status, 400);
  assert.strictEqual(db.deployCalls.length, 0);
});

await test('ANOTHER ACCOUNT CANNOT PUBLISH THIS SITE', async () => {
  install({
    accounts: [ACCOUNT],
    sites: [{ _id: SITE_ID, user: 'somebody-else', siteUrl: 'hvac.acmesites.com', project: 'p', status: 'live' }],
  });

  const out = await call(handler('post', '/cloudflare-sites/:id/publish'),
    req({ params: { id: SITE_ID } }));

  assert.strictEqual(out.status, 404);
  assert.strictEqual(db.deployCalls.length, 0);
});

/* ===================================================================== */
section('THE LIST');

await test('IT SHOWS THIS ACCOUNT\'S SITES AND LEAVES OUT THE REMOVED ONES', async () => {
  install({
    domains: [CF_DOMAIN],
    accounts: [ACCOUNT],
    sites: [
      { _id: SITE_ID, user: USER, siteUrl: 'hvac.acmesites.com', name: 'Quality Plumbing', status: 'live', publishCount: 2 },
    ],
  });

  const out = await call(handler('get', '/cloudflare-sites'));

  assert.strictEqual(out.status, 200);
  assert.match(out.html, /Quality Plumbing/);
  assert.match(out.html, /hvac\.acmesites\.com/);

  const filter = db.findFilters.find(f => f && f.status && f.status.$ne);
  assert.ok(filter, 'the list does not exclude removed sites');
  assert.strictEqual(filter.status.$ne, 'removed');
  assert.strictEqual(String(filter.user), USER, 'the list is not scoped to the signed-in user');
});

await test('AND AN EDITABLE SITE IS LINKED TO ITS EDIT SCREEN', async () => {
  /* THE WIRING GAP THIS PROJECT KEEPS FINDING. The edit screen was written,
   * tested and reachable only by typing its URL. Every test in the editing
   * section above passed with nothing on this page linking to it. */
  install({
    domains: [CF_DOMAIN],
    accounts: [ACCOUNT],
    sites: [{ _id: SITE_ID, user: USER, siteUrl: 'hvac.acmesites.com', name: 'Q', status: 'live', editable: true }],
  });

  const out = await call(handler('get', '/cloudflare-sites'));

  assert.ok(out.html.includes(`/cloudflare-sites/${SITE_ID}/edit`),
    'nothing on the list links to the edit screen');
});

await test('AND A SITE THAT CANNOT BE EDITED IS NOT OFFERED THE BUTTON', async () => {
  /* Published before its words were kept. The handler refuses it with a
   * sentence; a button that explains why it cannot work is worse than no
   * button. */
  install({
    domains: [CF_DOMAIN],
    accounts: [ACCOUNT],
    sites: [{ _id: SITE_ID, user: USER, siteUrl: 'hvac.acmesites.com', name: 'Q', status: 'live', editable: false }],
  });

  const out = await call(handler('get', '/cloudflare-sites'));

  assert.ok(!out.html.includes(`/cloudflare-sites/${SITE_ID}/edit`),
    'a site with nothing stored was offered an edit button');
});

await test('WITH NO BUILD, THE FORM IS NOT THERE AND IT SAYS WHY', async () => {
  /* A publish form over an empty dist is a button that cannot work. The
   * page says what to do instead, which is the only useful thing it can
   * say. */
  install({ domains: [CF_DOMAIN], accounts: [ACCOUNT], build: null });

  const out = await call(handler('get', '/cloudflare-sites'));

  assert.ok(!/action="\/cloudflare-sites"/.test(out.html), 'it offered a publish form with nothing to publish');
  assert.match(out.html, /no build to publish/i);
});

await test('WITH NO WEBSITE DOMAINS, IT SAYS THAT RATHER THAN SHOWING AN EMPTY SELECT', async () => {
  install({ domains: [], accounts: [ACCOUNT] });

  const out = await call(handler('get', '/cloudflare-sites'));

  assert.ok(!/action="\/cloudflare-sites"/.test(out.html), 'it offered a form with no domain to pick');
  assert.match(out.html, /no domains set up for websites/i);
});

await test('AND THE BUILD CARD NAMES THE ONE BUILD THAT CAN GO OUT', async () => {
  /* THE HONEST VERSION OF A SITE PICKER. dist/user_<id> is one folder,
   * wiped by the next build, and buildRegistry is an in-memory Map pruned
   * after an hour — so there is no archive to pick from. The card says
   * which build this is, instead of a dropdown implying there are others. */
  install({ domains: [CF_DOMAIN], accounts: [ACCOUNT] });

  const out = await call(handler('get', '/cloudflare-sites'));

  assert.match(out.html, /Quality Plumbing/);
  assert.match(out.html, /2 minutes ago/);
  assert.match(out.html, /8 pages/);
});

/* ===================================================================== */
section('EDITING THE WORDS');

const EDITABLE = {
  _id: SITE_ID, user: USER, siteUrl: 'hvac.acmesites.com', name: 'Quality Plumbing',
  project: 'p', status: 'live', editable: true,
  contentModel: {
    version: 1,
    pages: [{
      slug: 'about', type: 'about', title: 'About',
      sections: [{ key: 'section1', label: 'Section 1', type: 'text',
                   heading: 'Who we are', subheading: 'A local firm',
                   paragraphs: ['First.', 'Second.'],
                   trustPoints: ['Licensed and insured', 'Free estimates'] }],
    }],
  },
  buildRecipe: { version: 1, body: { global: { businessName: 'Quality Plumbing' }, pages: {} } },
};

function editableSite(over = {}) {
  return Object.assign({}, EDITABLE, over,
    { contentModel: JSON.parse(JSON.stringify((over.contentModel || EDITABLE.contentModel))) });
}

await test('EVERY EDITABLE FIELD GETS A BOX, AND NOTHING ELSE DOES', async () => {
  install({ accounts: [ACCOUNT], sites: [editableSite()] });

  const out = await call(handler('get', '/cloudflare-sites/:id/edit'), req({ params: { id: SITE_ID } }));

  assert.strictEqual(out.status, 200);
  assert.match(out.html, /First\./);
  assert.match(out.html, /Second\./);

  /* ASKED OF THE MODULE THAT DECIDES, NOT OF THE MARKUP. editableText
   * answers which fields exist; this asserts the screen draws exactly those
   * and invents none. Written this way so that moving a box, renaming a
   * class or swapping an <input> for something else does not fail a test
   * about scope — the failure people learn to fix by editing the test. */
  const expected = [...editableText.fieldNames(EDITABLE.contentModel)];
  assert.ok(expected.length, 'the fixture has nothing editable in it');

  for (const name of expected) {
    assert.ok(out.html.includes(`name="${name}"`), `no box for ${name}`);
  }

  const drawn = (out.html.match(/name="[^"]+"/g) || [])
    .map(m => m.slice(6, -1))
    .filter(n => /^[hpst]::/.test(n));

  assert.deepStrictEqual([...new Set(drawn)].sort(), expected.sort(),
    'the screen draws a box the model did not ask for');

  /* STILL OUT OF SCOPE, and these are the ones somebody would add by
   * accident. Edwin, 7 November: "No business name, no phone number, no
   * email change, no images." */
  assert.ok(!/name="[^"]*businessName/.test(out.html), 'the business name is editable');
  assert.ok(!/name="[^"]*phone/.test(out.html), 'the phone number is editable');
  assert.ok(!/<input[^>]*type="file"/.test(out.html), 'images are editable');

  /* The hero is not in the model's editable set either, and this is the one
   * exclusion a reader is likely to try to undo — see editableText's note. */
  assert.ok(!drawn.some(n => n.includes('::hero')), 'the hero reached the form');
});

await test('THE SCREEN DRAWS THE BLOCKS IN THE PAGE\'S ORDER, LIST INCLUDED', async () => {
  /* THE ONE THING THIS SCREEN MUST DO BESIDES SAVING: look like the page.
   * aboutUsTemplate.html renders H2, H3, P1, {{SECTION1_LIST}}, P2 — the
   * ticked list comes BETWEEN the paragraphs. The first version drew both
   * paragraphs and then the list, and was reported as "the order is wrong"
   * the day it shipped.
   *
   * Asserted on where the markup actually falls, because the position is
   * computed in one file and spliced in another, and either half alone looks
   * correct. */
  install({ accounts: [ACCOUNT], sites: [editableSite()] });

  const out = await call(handler('get', '/cloudflare-sites/:id/edit'), req({ params: { id: SITE_ID } }));

  const heading = out.html.indexOf('name="h::about::section1"');
  const sub = out.html.indexOf('name="s::about::section1"');
  const p1 = out.html.indexOf('name="p::about::section1::0"');
  const list = out.html.indexOf('name="t::about::section1::0"');
  const p2 = out.html.indexOf('name="p::about::section1::1"');

  for (const [name, at] of [['heading', heading], ['subheading', sub],
                            ['first paragraph', p1], ['list', list], ['second paragraph', p2]]) {
    assert.ok(at > -1, `${name} is not on the screen at all`);
  }

  assert.ok(heading < sub, 'the subheading is drawn before the heading');
  assert.ok(sub < p1, 'the first paragraph is drawn before the subheading');
  assert.ok(p1 < list, 'the ticked list is drawn before the first paragraph');
  assert.ok(list < p2, 'the ticked list is drawn after the second paragraph, not between them');
});

await test('AND THE TICKED LIST GETS ALL EIGHT SLOTS, NOT JUST THE USED ONES', async () => {
  /* The empty boxes ARE the add button. Drawing only the two that are
   * filled would make the list editable and removable but never longer. */
  install({ accounts: [ACCOUNT], sites: [editableSite()] });

  const out = await call(handler('get', '/cloudflare-sites/:id/edit'), req({ params: { id: SITE_ID } }));

  const slots = (out.html.match(/name="t::[^"]+"/g) || []).length;

  assert.strictEqual(slots, editableText.TRUST_SLOTS,
    `expected ${editableText.TRUST_SLOTS} trust boxes, got ${slots}`);
  assert.ok(out.html.includes('value="Licensed and insured"'), 'a stored point is not in its box');
});

await test('A SITE WITH NOTHING STORED SAYS SO INSTEAD OF OFFERING A FORM', async () => {
  /* Published before any of this existed. Re-rendering from nothing would
   * generate a different site and charge for it. */
  install({
    accounts: [ACCOUNT],
    sites: [editableSite({ editable: false, contentModel: null, buildRecipe: null })],
  });

  const out = await call(handler('get', '/cloudflare-sites/:id/edit'), req({ params: { id: SITE_ID } }));

  assert.strictEqual(out.status, 400);
  assert.match(out.html, /before its words were kept/);
  assert.ok(!/<textarea/.test(out.html), 'it offered a form it cannot accept');
});

await test('AND SO DOES A SITE THAT HAS NEVER BEEN PUBLISHED', async () => {
  install({ accounts: [ACCOUNT], sites: [editableSite({ status: 'draft', project: '' })] });

  const out = await call(handler('get', '/cloudflare-sites/:id/edit'), req({ params: { id: SITE_ID } }));

  assert.strictEqual(out.status, 400);
  assert.match(out.html, /not been published/);
});

await test('AN EDIT IS SANITISED BEFORE IT IS STORED', async () => {
  /* runGeneration writes these into the template with a plain .replace()
   * and no escaping. The edit screen is the moment that field becomes
   * reachable by a person. */
  install({ accounts: [ACCOUNT], sites: [editableSite()] });

  const body = {};
  body[`p::about::section1::0`] = 'Safe <a href="/contact.html">link</a> and <script>alert(1)</script>.';

  await call(handler('post', '/cloudflare-sites/:id/edit'), req({ params: { id: SITE_ID }, body }));

  const saved = db.saved.find(s => s.contentModel);
  assert.ok(saved, 'nothing was saved');

  const para = saved.contentModel.pages[0].sections[0].paragraphs[0];

  assert.ok(para.includes('<a href="/contact.html">link</a>'), `the link was lost: ${para}`);
  assert.ok(!/<script/i.test(para), `a script tag was stored: ${para}`);
});

await test('THE WORDS ARE SAVED, THEN THE REBUILD IS QUEUED — IN THAT ORDER', async () => {
  /* A rebuild takes more than ten minutes and can fail. Saved after, an edit
   * that failed to publish is also an edit that was lost, and the person
   * retypes it with no idea which half went wrong.
   *
   * ASSERTED ON THE ORDER, NOT ON BOTH HAPPENING. "The words were saved and
   * a job exists" is true however they are sequenced; only the sequence
   * carries the rule. */
  install({ accounts: [ACCOUNT], sites: [editableSite()] });

  const body = {};
  body['p::about::section1::0'] = 'Edited words.';

  const out = await call(handler('post', '/cloudflare-sites/:id/edit'), req({ params: { id: SITE_ID }, body }));

  assert.strictEqual(out.redirected, `/jobs/${JOB_ID}`,
    'the save did not hand off to a progress page');

  assert.deepStrictEqual(db.seq, ['saved', 'queued']);

  const saved = db.saved.find(s => s.contentModel
    && s.contentModel.pages[0].sections[0].paragraphs[0] === 'Edited words.');

  assert.ok(saved, 'the edit was not stored before the job was queued');
});

await test('AND THE SAVE DOES NOT REBUILD ANYTHING ITSELF', async () => {
  /* THE 504 THIS EXISTS FOR. The handler used to rebuild and deploy on the
   * browser's connection; nginx closes one at sixty seconds and the build
   * takes ten minutes, so every save ended in a gateway timeout while the
   * work carried on unobserved behind it.
   *
   * A request is a promise to answer soon. Work that cannot answer soon does
   * not belong in one, however well it works. */
  install({ accounts: [ACCOUNT], sites: [editableSite()] });

  const body = {};
  body['p::about::section1::0'] = 'Edited words.';

  await call(handler('post', '/cloudflare-sites/:id/edit'), req({ params: { id: SITE_ID }, body }));

  assert.strictEqual(db.builds.length, 0, 'the handler still rebuilds the site itself');
  assert.strictEqual(db.deployCalls.length, 0, 'the handler still deploys to Cloudflare itself');
});

await test('THE JOB CARRIES A POINTER, NOT A COPY OF THE WORDS', async () => {
  /* Minutes pass between the save and the runner claiming the job. A payload
   * holding the model would be a second copy that can disagree with the row
   * — and with a second save that landed in between. The id cannot go
   * stale. */
  install({ accounts: [ACCOUNT], sites: [editableSite()] });

  const body = {};
  body['p::about::section1::0'] = 'Edited words.';

  await call(handler('post', '/cloudflare-sites/:id/edit'), req({ params: { id: SITE_ID }, body }));

  const job = db.jobs[0];

  assert.strictEqual(job.kind, 'cfedit');
  assert.strictEqual(String(job.user), String(USER));
  assert.deepStrictEqual(job.payload, { siteId: String(SITE_ID) });
  assert.ok(!JSON.stringify(job.payload).includes('Edited words.'),
    'the job payload carries a copy of the words');
});

await test('A KIND THE Job MODEL WILL NOT ACCEPT IS A SAVE THAT FAILS SILENTLY', () => {
  /* THE TRAP THIS MODEL HAS ALREADY SPRUNG ONCE. 'rankfast' was added to the
   * wizard, the pricing and the normaliser but not to the enum, so every
   * Rank Fast build threw a ValidationError at Job.create — after the
   * customer had been charged and told it was starting.
   *
   * Checked against the schema rather than against a literal, so adding a
   * kind to the route and forgetting the model fails here instead of in
   * production. */
  const kinds = Job.schema.path('kind').enumValues;

  assert.ok(kinds.includes('cfedit'),
    `the Job model does not accept 'cfedit' — Job.create would throw. Kinds: ${kinds.join(', ')}`);
});

await test('AN UNCHANGED FORM REBUILDS NOTHING', async () => {
  /* Pressing Save with nothing typed must not spend a rebuild, a deploy and
   * a Cloudflare round trip to produce an identical site. */
  install({ accounts: [ACCOUNT], sites: [editableSite()] });

  const body = {};
  body[`p::about::section1::0`] = 'First.';
  body[`p::about::section1::1`] = 'Second.';

  const out = await call(handler('post', '/cloudflare-sites/:id/edit'), req({ params: { id: SITE_ID }, body }));

  assert.match(out.html, /Nothing changed/);
  assert.strictEqual(db.deployCalls.length, 0, 'it redeployed an unchanged site');
});

await test('A FIELD FOR A SECTION THAT IS NOT THERE IS REFUSED, NOT GUESSED AT', async () => {
  /* A stale tab, posting a form built against a different version of the
   * site. Writing it somewhere approximate is how a town's copy ends up on
   * a service page. */
  install({ accounts: [ACCOUNT], sites: [editableSite()] });

  const body = {};
  body[`p::some-other-page::section1::0`] = 'Words for a page that is gone.';

  const out = await call(handler('post', '/cloudflare-sites/:id/edit'), req({ params: { id: SITE_ID }, body }));

  assert.match(out.html, /Nothing changed/);
  assert.strictEqual(db.deployCalls.length, 0);
});

/* ===================================================================== */
section('THE REBUILD, AS THE JOB RUNNER RUNS IT');

/** The Job row the save handler writes, as the runner hands it over. */
function editJob(over = {}) {
  return Object.assign({ _id: JOB_ID, kind: 'cfedit', user: USER, payload: { siteId: SITE_ID } }, over);
}

await test('THE IMAGES GO BACK IN BEFORE ANYTHING IS READ FOR DEPLOY', async () => {
  /* wrangler ships a DIRECTORY as the whole site, so a file absent from
   * dist/ is absent from the deployment. A re-render writes a FRESH
   * dist/user_<id> containing only the images it can regenerate — the
   * uploads are not among them.
   *
   * Get the order wrong and the deploy goes out with every <img> tag
   * correct and every image 404. Nothing errors; the pages render. */
  install({ accounts: [ACCOUNT], sites: [editableSite()] });

  const order = [];

  siteStore.restoreAssets = async (id, dir) => { order.push('restore'); db.restored.push({ id, dir }); return { restored: 3, skipped: 0, had: true }; };
  siteFiles.readSite = (dir) => { order.push('read'); db.readCalls.push(dir); return db.read; };
  cfDeploy.deployBlog = async (opts) => { order.push('deploy'); db.deployCalls.push(opts); return db.deploy; };

  await rebuildForJob(editJob());

  assert.ok(order.includes('restore'), 'the stored images were never restored');
  assert.ok(order.indexOf('restore') < order.indexOf('read'),
    `the deploy folder was read before the images went back: ${order.join(' -> ')}`);
  assert.ok(order.indexOf('read') < order.indexOf('deploy'), order.join(' -> '));

  /* AND INTO THE FOLDER THE REBUILD JUST WROTE, not some other one. */
  assert.strictEqual(db.restored[0].dir, '/dist/user_1');
  assert.strictEqual(String(db.restored[0].id), SITE_ID);
});

await test('THE REBUILD READS THE WORDS OFF THE ROW, NOT OUT OF THE PAYLOAD', async () => {
  /* `reuse` is what makes this free AND what makes it the EDIT. Handed the
   * old model the rebuild would republish the site exactly as it was and
   * report success.
   *
   * It comes off the ROW because minutes pass between the save and the
   * runner claiming the job — long enough for a second save to land. The row
   * is the truth; the payload is only a pointer to it. */
  const site = editableSite();
  site.contentModel.pages[0].sections[0].paragraphs[0] = 'Edited words.';

  install({ accounts: [ACCOUNT], sites: [site] });

  await rebuildForJob(editJob());

  assert.strictEqual(db.builds.length, 1, 'the site was not rebuilt');

  const ctx = db.builds[0];

  assert.strictEqual(ctx.reuse.pages[0].sections[0].paragraphs[0], 'Edited words.',
    'the rebuild was given the words from before the edit');

  assert.deepStrictEqual(ctx.files, [], 'the rebuild was handed uploads it does not have');
  assert.ok(ctx.body, 'the rebuild was given no wizard payload');
});

await test('A SITE DELETED BETWEEN THE SAVE AND THE RUN FAILS THE JOB, NOT THE PROCESS', async () => {
  install({ accounts: [ACCOUNT], sites: [] });

  await assert.rejects(() => rebuildForJob(editJob()), /no longer here/);
  assert.strictEqual(db.builds.length, 0, 'it rebuilt a site that is not there');
});

await test('AND SO DOES ONE THAT STOPPED BEING EDITABLE', async () => {
  /* The screen checked this before the words were saved. This runs
   * afterwards, in another process, possibly after a deploy — so it is
   * checked again rather than assumed. */
  install({ accounts: [ACCOUNT], sites: [editableSite({ status: 'removed' })] });

  await assert.rejects(() => rebuildForJob(editJob()), /deleted/);
  assert.strictEqual(db.builds.length, 0);
});

await test('ANOTHER ACCOUNT\'S JOB CANNOT REBUILD THIS SITE', async () => {
  /* The id in the payload is not a permission. The row is loaded by id AND
   * owner, so a job naming somebody else's site finds nothing. */
  install({ accounts: [ACCOUNT], sites: [editableSite()] });

  await assert.rejects(() => rebuildForJob(editJob({ user: 'somebody-else' })), /no longer here/);
  assert.strictEqual(db.builds.length, 0);
});

await test('A DEPLOY THAT FAILS KEEPS ITS OWN MESSAGE', async () => {
  /* deploy.js writes messages that name the account and say whether the
   * thing is worth retrying. Replacing them with "publish failed" throws
   * away the only useful part — and this message is what the progress page
   * shows, which is now the only place anybody sees it. */
  install({
    accounts: [ACCOUNT],
    sites: [editableSite()],
    deploy: { ok: false, error: 'The deploy to Cloudflare did not finish.' },
  });

  await assert.rejects(() => rebuildForJob(editJob()), /did not finish/);
});

await test('AND THE RUNNER IS TOLD WHAT IT COST', async () => {
  /* Not zero in general: generateReview still costs one model call per
   * service page. The runner copies this onto the job and the progress page
   * shows it, so a rebuild that silently charged would be invisible. */
  install({ accounts: [ACCOUNT], sites: [editableSite()], build_result: { creditsCharged: 4 } });

  const out = await rebuildForJob(editJob());

  assert.strictEqual(out.creditsCharged, 4);
  assert.strictEqual(out.result.siteUrl, 'hvac.acmesites.com');
});

/* ===================================================================== */
section('EDITING, CONTINUED');

await test('ANOTHER ACCOUNT CANNOT EDIT THIS SITE', async () => {
  install({ accounts: [ACCOUNT], sites: [editableSite({ user: 'somebody-else' })] });

  const get = await call(handler('get', '/cloudflare-sites/:id/edit'), req({ params: { id: SITE_ID } }));
  assert.strictEqual(get.status, 404);

  const post = await call(handler('post', '/cloudflare-sites/:id/edit'),
    req({ params: { id: SITE_ID }, body: { 'p::about::section1::0': 'x' } }));
  assert.strictEqual(post.status, 404);
});

/* ===================================================================== */
section('DELETING');

await test('THE WRONG HOSTNAME DELETES NOTHING', async () => {
  install({
    accounts: [ACCOUNT],
    sites: [{ _id: SITE_ID, user: USER, siteUrl: 'hvac.acmesites.com', project: 'p', status: 'live' }],
  });

  const out = await call(handler('post', '/cloudflare-sites/:id/delete'),
    req({ params: { id: SITE_ID }, body: { confirm: 'hvac.acmesite.com', dropProject: '1' } }));

  assert.strictEqual(out.status, 400);
  assert.strictEqual(db.releaseCalls.length, 0);
  assert.strictEqual(db.deleteCalls.length, 0);
  assert.strictEqual(db.saved.length, 0, 'the row was changed anyway');
});

await test('AND WHITESPACE AROUND A CORRECT ONE IS FORGIVEN', async () => {
  install({
    accounts: [ACCOUNT],
    sites: [{ _id: SITE_ID, user: USER, siteUrl: 'hvac.acmesites.com', project: 'p', status: 'live' }],
  });

  const out = await call(handler('post', '/cloudflare-sites/:id/delete'),
    req({ params: { id: SITE_ID }, body: { confirm: '  HVAC.acmesites.com ', dropProject: '1' } }));

  assert.strictEqual(out.status, 200);
});

await test('THE DOMAIN COMES OFF BEFORE THE PROJECT GOES', async () => {
  /* NOT TIDINESS: Cloudflare refuses to delete a Pages project that is
   * still serving an active custom domain. On the blogs screen it showed as
   * three deletes that worked and one that did not — the three had domains
   * still `pending`, the fourth had one that had gone live. Edwin read the
   * warning and thought his blog had not been deleted. It had; the project
   * had not. */
  install({
    accounts: [ACCOUNT],
    sites: [{
      _id: SITE_ID, user: USER, siteUrl: 'hvac.acmesites.com', project: 'p', status: 'live',
      lastDeployUrl: 'https://p.pages.dev',
    }],
  });

  const order = [];
  cfDeploy.releaseDomain = async (o) => { order.push('release'); db.releaseCalls.push(o); return db.released; };
  cfDeploy.deleteProject = async (o) => { order.push('delete'); db.deleteCalls.push(o); return db.deletedProject; };

  await call(handler('post', '/cloudflare-sites/:id/delete'),
    req({ params: { id: SITE_ID }, body: { confirm: 'hvac.acmesites.com', dropProject: '1' } }));

  assert.deepStrictEqual(order, ['release', 'delete']);
});

await test('AND THE DNS RECORD IS ONLY REMOVED IF IT POINTS AT OUR OWN DEPLOY', async () => {
  /* `expected` IS WHAT MAKES THIS SAFE TO RUN. Edwin's zones hold live
   * sites on the same domains, and removeDnsRecord() refuses any record
   * that is not the one we created. Without this argument it would remove
   * whatever it found at that name. */
  install({
    accounts: [ACCOUNT],
    sites: [{
      _id: SITE_ID, user: USER, siteUrl: 'hvac.acmesites.com', project: 'p', status: 'live',
      lastDeployUrl: 'https://p.pages.dev',
    }],
  });

  await call(handler('post', '/cloudflare-sites/:id/delete'),
    req({ params: { id: SITE_ID }, body: { confirm: 'hvac.acmesites.com', dropProject: '1' } }));

  assert.strictEqual(db.releaseCalls[0].expected, 'p.pages.dev');
  assert.strictEqual(db.releaseCalls[0].domain, 'hvac.acmesites.com');
  assert.strictEqual(db.releaseCalls[0].project, 'p');
});

await test('A SITE WHOSE ACCOUNT CANNOT BE READ IS NOT TORN DOWN REMOTELY', async () => {
  /* THE LOCAL ROW STILL GOES — the customer asked for the site to be
   * deleted and the credentials are our problem, not theirs. But nothing is
   * detached or deleted at Cloudflare, because falling back to the env here
   * would aim a delete at the server's own account, where a project of the
   * same name may well exist. */
  install({
    accounts: [ACCOUNT],
    sites: [{ _id: SITE_ID, user: USER, siteUrl: 'hvac.acmesites.com', project: 'p', status: 'live' }],
    credsError: 'The Cloudflare account for this site is disabled (Client 7).',
  });

  const out = await call(handler('post', '/cloudflare-sites/:id/delete'),
    req({ params: { id: SITE_ID }, body: { confirm: 'hvac.acmesites.com', dropProject: '1' } }));

  assert.strictEqual(out.status, 200);
  assert.strictEqual(db.releaseCalls.length, 0, 'it aimed a delete at an account it could not read');
  assert.strictEqual(db.deleteCalls.length, 0);

  assert.strictEqual(db.saved[db.saved.length - 1].status, 'removed');
  assert.match(out.html, /left undone/i, 'the page claimed a clean delete');
});

await test('TIDYING LEFT UNDONE IS SAID OUT LOUD, NOT ONLY LOGGED', async () => {
  /* Each of these leaves something behind in Cloudflare that only somebody
   * with the dashboard open can clear. A page that says "deleted" with no
   * qualification is how a leftover project goes unnoticed until the
   * account is full at 100. */
  install({
    accounts: [ACCOUNT],
    sites: [{ _id: SITE_ID, user: USER, siteUrl: 'hvac.acmesites.com', project: 'p', status: 'live' }],
    released: { detached: { ok: false, error: 'nope' }, dns: { ok: false, error: 'nope' } },
    deletedProject: { ok: false, output: 'nope' },
  });

  const out = await call(handler('post', '/cloudflare-sites/:id/delete'),
    req({ params: { id: SITE_ID }, body: { confirm: 'hvac.acmesites.com', dropProject: '1' } }));

  assert.match(out.html, /left undone/i);
  assert.match(out.html, /custom domain could not be taken off/i);
  assert.match(out.html, /DNS record could not be removed/i);
  assert.match(out.html, /project could not be deleted/i);
});

await test('THE ROW IS MARKED REMOVED, NOT DELETED', async () => {
  /* The row is the only record that this hostname was ever used. A hard
   * delete frees the subdomain for somebody else while Cloudflare may still
   * hold the project and the DNS record, and the next publish on that name
   * would collide with a leftover nobody can see. */
  install({
    accounts: [ACCOUNT],
    sites: [{ _id: SITE_ID, user: USER, siteUrl: 'hvac.acmesites.com', project: 'p', status: 'live' }],
  });

  CloudflareSite.deleteOne = async () => { throw new Error('the row was hard-deleted'); };
  CloudflareSite.findOneAndDelete = async () => { throw new Error('the row was hard-deleted'); };

  await call(handler('post', '/cloudflare-sites/:id/delete'),
    req({ params: { id: SITE_ID }, body: { confirm: 'hvac.acmesites.com', dropProject: '1' } }));

  assert.strictEqual(db.saved[db.saved.length - 1].status, 'removed');
});

await test('LEAVING THE BOX UNCHECKED KEEPS THE CLOUDFLARE SIDE', async () => {
  install({
    accounts: [ACCOUNT],
    sites: [{ _id: SITE_ID, user: USER, siteUrl: 'hvac.acmesites.com', project: 'p', status: 'live' }],
  });

  await call(handler('post', '/cloudflare-sites/:id/delete'),
    req({ params: { id: SITE_ID }, body: { confirm: 'hvac.acmesites.com' } }));

  assert.strictEqual(db.releaseCalls.length, 0);
  assert.strictEqual(db.deleteCalls.length, 0);
  assert.strictEqual(db.saved[db.saved.length - 1].status, 'removed');
});

await test('ANOTHER ACCOUNT CANNOT DELETE THIS SITE', async () => {
  install({
    accounts: [ACCOUNT],
    sites: [{ _id: SITE_ID, user: 'somebody-else', siteUrl: 'hvac.acmesites.com', project: 'p', status: 'live' }],
  });

  const out = await call(handler('post', '/cloudflare-sites/:id/delete'),
    req({ params: { id: SITE_ID }, body: { confirm: 'hvac.acmesites.com', dropProject: '1' } }));

  assert.strictEqual(out.status, 404);
  assert.strictEqual(db.releaseCalls.length, 0);
});

/* ===================================================================== */
section('THE CONTRACT WITH deployBlog(), WHICH NOTHING ELSE ENFORCES');

await test('A CloudflareSite SATISFIES IT BY SPELLING TWO FIELDS THE SAME WAY', async () => {
  /* deployBlog() READS `blog.siteUrl` AND `blog.project` AND NOTHING ELSE.
   * This record is not a BlogSite; it satisfies that function by naming
   * those two fields identically, which is a promise no type system here is
   * checking. So it is checked by calling the REAL deployBlog with a
   * real-shaped record and watching where the files went.
   *
   * A rename of either field — to `hostname`, to `pagesProject` — passes
   * every other test in this file and fails here. */
  const site = {
    _id: 'contract-1',
    siteUrl: 'hvac.acmesites.com',
    project: '',   // never published, so deployBlog does the setup
  };

  const argv = [];
  const run = async (args) => {
    argv.push(args);
    return { code: 0, stdout: 'https://de7c47e4.hvac-acmesites-com.pages.dev\n', stderr: '' };
  };

  let attached = null;
  const attach = async (opts) => { attached = opts; return { attached: { ok: true }, dns: { ok: true } }; };

  const result = await REAL_DEPLOY_BLOG({
    blog: site,
    files: { 'index.html': Buffer.from('<h1>hi</h1>') },
    requestId: 'req-contract',
    run,
    attach,
    creds: { token: 't', account: 'a'.repeat(32) },
  });

  assert.ok(result.ok, result.error);

  /* THE PROJECT NAME CAME OUT OF siteUrl. Rename that field and
   * projectNameFor() throws "Cannot build a Cloudflare project name". */
  assert.strictEqual(result.project, 'hvac-acmesites-com');

  const deploy = argv.find(a => a.includes('deploy'));
  assert.ok(deploy, 'wrangler was never asked to deploy');
  assert.ok(deploy.includes('--project-name=hvac-acmesites-com'));

  /* AND THE DOMAIN ATTACHED IS THE HOSTNAME, pointed at the UNHASHED
   * pages.dev address. */
  assert.ok(attached, 'the custom domain was never attached');
  assert.strictEqual(attached.domain, 'hvac.acmesites.com');
  assert.strictEqual(attached.target, 'hvac-acmesites-com.pages.dev');
});

await test('AND THE FILES DEPLOYED ARE THE ONES READ OFF DISK', async () => {
  /* writeSite() TAKES string | Buffer, which is the other half of the
   * reader's contract. A real round trip: build a folder, read it, deploy
   * it, and check the bytes that landed in the directory wrangler was
   * pointed at. */
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00]);
  const dir = buildDir({ 'index.html': '<h1>home</h1>', 'assets/logo.png': bytes });

  const read = readSite(dir);
  assert.ok(read.ok, read.error);

  let landed = null;

  const run = async (args) => {
    const root = args.find(a => a.startsWith('/') || a.startsWith(os.tmpdir()));

    /* READ INSIDE run(), BECAUSE deployBlog REMOVES THE DIRECTORY IN ITS
     * `finally`. Win or lose — a failed deploy that left its files behind
     * would fill the disk one site at a time, on the box where every
     * generated website lives. */
    landed = {
      index: fs.readFileSync(path.join(root, 'index.html'), 'utf8'),
      logo: fs.readFileSync(path.join(root, 'assets', 'logo.png')),
    };

    return { code: 0, stdout: 'https://a1b2.p.pages.dev\n', stderr: '' };
  };

  await REAL_DEPLOY_BLOG({
    blog: { _id: 'c2', siteUrl: 'hvac.acmesites.com', project: 'p' },
    files: read.files,
    requestId: 'req-contract-2',
    run,
    attach: async () => ({}),
    creds: { token: 't', account: 'a'.repeat(32) },
  });

  assert.ok(landed, 'wrangler was never run');
  assert.strictEqual(landed.index, '<h1>home</h1>');
  assert.ok(bytes.equals(landed.logo), 'the image was corrupted between disk and deploy');
});

/* ===================================================================== */
section('EVERY ROUTE IS BEHIND requireAuth');

await test('AND IT IS CHECKED PER ROUTE, NOT ASSUMED ONCE', async () => {
  /* server.js mounts this router behind requireAuth, which is the outer
   * door. This is the inner one, and it is asserted per route because a
   * handler added later without the guard is obvious in review and
   * invisible afterwards — and every handler in here reads or writes
   * somebody's live website. */
  const routes = router.stack.filter(l => l.route);

  assert.ok(routes.length >= 5, `the router has ${routes.length} routes on it`);

  for (const layer of routes) {
    const names = layer.route.stack.map(s => s.handle.name);

    assert.ok(names.includes('requireAuth'),
      `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path} has no auth guard`);
  }
});

await test('AND EVERY ONE OF THEM IS SCOPED TO THE SIGNED-IN USER', async () => {
  /* requireAuth SAYS SOMEBODY IS SIGNED IN. It does not say the site in the
   * URL is theirs. Every :id route goes through ownedSite(), which puts
   * `user` in the QUERY rather than loading the row and comparing
   * afterwards — both are correct today, only one stays correct when
   * somebody adds an early return above the comparison. */
  const byId = router.stack
    .filter(l => l.route && l.route.path.includes(':id'))
    .map(l => l.route);

  assert.ok(byId.length >= 3, `only ${byId.length} routes take an id`);

  for (const route of byId) {
    const method = Object.keys(route.methods)[0];

    install({
      accounts: [ACCOUNT],
      sites: [{ _id: SITE_ID, user: 'somebody-else', siteUrl: 'hvac.acmesites.com', project: 'p', status: 'live' }],
    });

    const out = await call(handler(method, route.path),
      req({ params: { id: SITE_ID }, body: { confirm: 'hvac.acmesites.com', dropProject: '1' } }));

    assert.strictEqual(out.status, 404,
      `${method.toUpperCase()} ${route.path} served another account's site`);
  }
});

await test('AND A MALFORMED ID IS A 404, NOT A CAST ERROR', async () => {
  install({ accounts: [ACCOUNT] });

  const out = await call(handler('get', '/cloudflare-sites/:id/delete'),
    req({ params: { id: 'not-an-objectid' } }));

  assert.strictEqual(out.status, 404);
});

/* ===================================================================== */
section('THE BODY PARSER THIS SCREEN NEEDS');

await test('THE WIDER LIMIT IS MOUNTED, AND BEFORE THE GLOBAL PARSER', async () => {
  /* THE BUG THIS PINS. The edit form posts the whole site — about 4 KB per
   * page, so 150 KB for a 38-page site — and express.urlencoded defaults to
   * 100 KB. Every save came back as a bare "Something went wrong"
   * (Reference: undefined), thrown by the parser before the request had an
   * id. The feature was finished, tested, deployed and unusable.
   *
   * ORDER IS THE WHOLE RULE. body-parser skips a request another parser has
   * already read, so the scoped one has to come FIRST. Mounted after the
   * global parser it never runs, nothing errors, and the symptom is exactly
   * the same as not having added it at all.
   *
   * Read out of the source because middleware order is not observable from
   * the router object, and because the failure mode is silence. */
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

  const scoped = src.indexOf("app.use('/cloudflare-sites', express.urlencoded(");
  const shared = src.indexOf('app.use(express.urlencoded({ extended: true }));');

  assert.ok(scoped >= 0, 'no wider body parser is mounted for /cloudflare-sites');
  assert.ok(shared >= 0, 'the global urlencoded parser is no longer where this test can find it');
  assert.ok(scoped < shared,
    'the scoped parser is mounted AFTER the global one, so it never runs');

  const opts = src.slice(scoped, scoped + 400);
  const limit = opts.match(/limit:\s*'(\d+)mb'/);

  assert.ok(limit, 'the scoped parser sets no body limit');
  assert.match(opts, /parameterLimit:\s*\d+/,
    'the body limit was raised but the 1000-field default was left alone');
  assert.ok(Number(limit[1]) >= 4,
    `${limit[1]} MB leaves no room: a 1000-page site posts about 4 MB`);
});

await test('AND THE BUILD FORM\'S FIELD CAP IS A PAGE CAP, SET LIKE ONE', () => {
  /* A DIFFERENT WALL, BEHIND A DIFFERENT DOOR. The wizard posts
   * multipart/form-data to /generate, which never reaches the parser above —
   * multer handles it, with limits of its own. One field per service row and
   * one per town means multer's `fields` is really a maximum page count, and
   * at its old 200 any build past roughly 190 rows was refused.
   *
   * Pinned here, beside the other limit, because the two are easy to confuse
   * and were confused once already: raising one does nothing for the other. */
  const src = fs.readFileSync(path.join(__dirname, 'routes', 'generateRoute.js'), 'utf8');
  const fields = src.match(/fields:\s*(\d+)/);

  assert.ok(fields, 'multer sets no field limit on the build form');
  assert.ok(Number(fields[1]) >= 2000,
    `fields: ${fields[1]} caps a build at about ${Math.floor(Number(fields[1]) / 2)} pages`);

  /* The byte cap per field stays where it was. It is the one that actually
   * bounds the request, and a filename does not need 100 KB. */
  assert.match(src, /fieldSize:\s*100 \* 1024/,
    'the per-field size cap was raised too, which nothing here asked for');
});

await test('AND THE PUBLIC PAGES ARE NOT GIVEN IT', async () => {
  /* A body limit is also a cap on how much memory a stranger can make this
   * server hold. Login and signup are reachable without an account, so the
   * wider limit has to stay behind requireAuth — which it does by being
   * bound to one prefix rather than to the app. */
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

  const wide = [...src.matchAll(/app\.use\(\s*(?:'([^']*)',\s*)?express\.urlencoded\(\{[^}]*limit:/g)];

  assert.ok(wide.length, 'no urlencoded parser sets a limit at all');

  for (const m of wide) {
    assert.strictEqual(m[1], '/cloudflare-sites',
      `a raised body limit was mounted on ${m[1] || 'every path'}`);
  }
});

/* ===================================================================== */

cleanup();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

})().catch(err => { cleanup(); console.error(err); process.exit(1); });
