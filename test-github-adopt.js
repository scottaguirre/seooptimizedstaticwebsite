// test-github-adopt.js
//
// Finding published sites the app has no record of.
//
// WHAT THIS IS GUARDING. Adoption writes ownership rows from whatever it
// finds on a client's GitHub account, so every mistake here is somebody's
// site appearing in the wrong list, or the domain itself appearing in a list
// behind a Delete button.
//
// NOTHING HERE TOUCHES THE NETWORK. `api` is injected and the JWT is signed
// with a key pair this file generates.
//
//   node test-github-adopt.js

'use strict';

const assert = require('assert');
const crypto = require('crypto');

const { findSites, allRepos, sourceIn, PER_PAGE } = require('./utils/github/adoptSites');

let passed = 0, failed = 0;

const queue = [];
function test(name, fn) {
  queue.push(() => Promise.resolve()
    .then(fn)
    .then(() => { console.log(`  ok    ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }));
}
function section(n) { queue.push(async () => console.log(`\n${n}\n`)); }

const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const APP = { appId: '5520255', privateKey, now: new Date('2026-10-30T04:00:00Z') };

/** A stored source as a build writes it. */
const source = (name, trade = 'plumbing', version = 1) => JSON.stringify({
  version,
  business: { name, trade },
  home: { h1: `${name}` },
});

const b64 = s => Buffer.from(s, 'utf8').toString('base64');

/**
 * A GitHub account with some repositories on it.
 *
 * `repos` IS A MAP OF NAME -> what /contents/_src/localoptions.json answers:
 * a string is that file's contents, and null means the file is not there.
 */
function hub({ repos = {}, account = 'acme', pushedAt = '2026-10-29T20:00:00Z' } = {}) {
  const names = Object.keys(repos);
  const calls = [];

  const api = async (req) => {
    calls.push(req);

    const { method, path } = req;

    if (path.startsWith('/app/installations/') && 'GET' === method) {
      return { id: 176399104, account: { login: account } };
    }

    if (path.includes('/access_tokens')) {
      return { token: 'ghs_x', expires_at: '2026-10-30T05:00:00Z', permissions: { contents: 'read' } };
    }

    if ('GET' === method && path.startsWith('/installation/repositories')) {
      const page = Number((path.match(/[?&]page=(\d+)/) || [])[1] || 1);
      const from = (page - 1) * PER_PAGE;

      return {
        total_count: names.length,
        repositories: names.slice(from, from + PER_PAGE)
          .map(name => ({ name, pushed_at: pushedAt })),
      };
    }

    if ('GET' === method && path.includes('/contents/_src/localoptions.json')) {
      const name = path.split('/')[3];
      const content = repos[name];

      if (null == content) {
        const err = new Error('GitHub: Not Found');
        err.status = 404;
        throw err;
      }

      return { content: b64(content), encoding: 'base64' };
    }

    throw new Error(`the fake was asked something it does not know: ${method} ${path}`);
  };

  return { api, calls };
}

const look = (h, over = {}) => findSites({
  installationId: 176399104,
  owner: 'acme',
  api: h.api,
  ...APP,
  ...over,
});

/* ======================================================================= */

section('WHAT COUNTS AS A SITE THIS APP BUILT');

test('a repository carrying the stored source is one', async () => {
  /* _src/localoptions.json IS THE EVIDENCE. Every build carries it up with
   * the pages, and nothing else on a client's account has one. */
  const h = hub({ repos: { 'the-chicago-plumber': source('The Chicago Plumber') } });

  const { sites } = await look(h);

  assert.strictEqual(sites.length, 1);
  assert.strictEqual(sites[0].repo, 'the-chicago-plumber');
  assert.strictEqual(sites[0].businessName, 'The Chicago Plumber');
  assert.strictEqual(sites[0].trade, 'plumbing');
});

test('AND A REPOSITORY WITHOUT ONE IS SOMEBODY ELSE\'S AND IS LEFT ALONE', async () => {
  /* A client's account holds their own work. Adopting a repository because
   * it happens to be reachable would put their private project in a list
   * with a Delete button under it. */
  const h = hub({
    repos: {
      'the-chicago-plumber': source('The Chicago Plumber'),
      'my-dissertation': null,
      'dotfiles': null,
    },
  });

  const { sites, scanned } = await look(h);

  assert.strictEqual(scanned, 3);
  assert.deepStrictEqual(sites.map(s => s.repo), ['the-chicago-plumber']);
});

test('THE ROOT PAGES SITE IS NEVER ADOPTED', async () => {
  /* `<login>.github.io` holds the custom domain and the CNAME. Putting it in
   * somebody's list would put the DOMAIN behind a Delete button — the exact
   * mistake that took 7-y.xyz down by hand on the 29th. */
  const h = hub({
    repos: {
      'acme.github.io': source('Root'),
      'the-chicago-plumber': source('The Chicago Plumber'),
    },
  });

  const { sites } = await look(h);

  assert.deepStrictEqual(sites.map(s => s.repo), ['the-chicago-plumber']);

  assert.ok(
    !h.calls.some(c => c.path.includes('/acme.github.io/contents/')),
    'it read the root repository before deciding'
  );
});

test('a source of a version this app cannot render is not adopted', async () => {
  /* readSiteSource() refuses anything but version 1, so a row for one would
   * be a line in the list whose Edit button throws — a pointer to a site
   * that cannot be edited, which is the problem this file exists to fix. */
  const h = hub({ repos: { 'future-site': source('Future', 'plumbing', 2) } });

  const { sites } = await look(h);

  assert.strictEqual(sites.length, 0);
});

test('and neither is one that has been edited into nonsense', async () => {
  const h = hub({ repos: { 'broken': '{ not json at all' } });

  const { sites } = await look(h);

  assert.strictEqual(sites.length, 0);
});

/* ======================================================================= */

section('WHAT COMES BACK WITH IT');

test('the push date, because the list sorts by it', async () => {
  /* The stored source does not record when it was published, and a row with
   * no date sorts to the bottom for ever. GitHub's pushed_at is the only
   * honest answer available. */
  const h = hub({ repos: { 'x': source('X') }, pushedAt: '2026-10-29T20:00:00Z' });

  const { sites } = await look(h);

  assert.strictEqual(sites[0].publishedAt.toISOString(), '2026-10-29T20:00:00.000Z');
});

test('the owner, which is the other half of a site\'s identity', async () => {
  const h = hub({ repos: { 'x': source('X') } });

  const { owner, sites } = await look(h);

  assert.strictEqual(owner, 'acme');
  assert.strictEqual(sites[0].owner, 'acme');
});

test('and the owner is looked up only when it was not handed over', async () => {
  /* MATCHED ON THE GET, NOT ON THE PREFIX. Minting a token POSTs to
   * /app/installations/<id>/access_tokens, which starts the same way — the
   * first version of this test failed on its own loose assertion and said
   * the code was wrong. */
  const lookup = c => 'GET' === c.method && /^\/app\/installations\/[^/]+$/.test(c.path);

  const h = hub({ repos: { 'x': source('X') } });

  await look(h);

  assert.ok(!h.calls.some(lookup), 'it looked up the owner it was handed');

  const h2 = hub({ repos: { 'x': source('X') } });

  await look(h2, { owner: undefined });

  assert.ok(h2.calls.some(lookup));
});

/* ======================================================================= */

section('AN ACCOUNT WITH A LOT ON IT');

test('IT PAGES TO THE END RATHER THAN TAKING THE FIRST HUNDRED', async () => {
  /* "It found most of them" is a worse answer than finding all or saying it
   * could not — the one it misses is the oldest site, which is exactly the
   * one whose pointer went missing. */
  const repos = {};

  for (let i = 0; i < PER_PAGE + 5; i += 1) repos[`site-${i}`] = source(`Site ${i}`);

  const h = hub({ repos });

  const { sites, scanned } = await look(h);

  assert.strictEqual(scanned, PER_PAGE + 5);
  assert.strictEqual(sites.length, PER_PAGE + 5);
});

test('and a short page ends the walk without a second request', async () => {
  const h = hub({ repos: { 'x': source('X') } });

  await look(h);

  const listings = h.calls.filter(c => c.path.startsWith('/installation/repositories'));

  assert.strictEqual(listings.length, 1);
});

test('a listing that never shrinks cannot loop for ever', async () => {
  /* A wrong answer from GitHub — or a fake one — would otherwise page until
   * the request timed out. */
  let pages = 0;

  const api = async (req) => {
    if (req.path.startsWith('/installation/repositories')) {
      pages += 1;
      return { repositories: Array.from({ length: PER_PAGE }, (_, i) => ({ name: `r${i}` })) };
    }
    throw new Error('unexpected');
  };

  await allRepos({ token: 't', api, maxPages: 3 });

  assert.strictEqual(pages, 3);
});

/* ======================================================================= */

section('WHAT IS REFUSED');

test('no installation is refused rather than guessed at', async () => {
  await assert.rejects(findSites({}), /needs an installation/);
});

test('sourceIn passes a real error through rather than calling it "not ours"', async () => {
  /* A 500 treated as "no source file" would silently skip a site that is
   * there — and adoption would report having found nothing wrong. */
  const api = async () => {
    const err = new Error('GitHub: Server Error');
    err.status = 500;
    throw err;
  };

  await assert.rejects(
    sourceIn({ owner: 'acme', repo: 'x', token: 't', api }),
    /Server Error/
  );
});

/* ---------------------------------------------------------------------- */

(async () => {
  for (const run of queue) await run();

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
