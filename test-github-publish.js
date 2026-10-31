// test-github-publish.js
//
// A built site reaching the internet without anybody pressing anything.
//
// NOTHING HERE TOUCHES THE NETWORK. `api` is injected everywhere, and the
// JWT is signed with a key pair this file generates — so no .env is read and
// no real App, installation or repository is involved.
//
//   node test-github-publish.js

'use strict';

const assert = require('assert');
const crypto = require('crypto');

const {
  publishSite, repoNameFor, ownerOf, ensureRepo, enablePages,
} = require('./utils/github/publishSite');

const { deleteSite, isRootSite } = require('./utils/github/deleteSite');

let passed = 0, failed = 0;

const queue = [];
function test(name, fn) {
  queue.push(() => Promise.resolve()
    .then(fn)
    .then(() => { console.log(`  ok    ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }));
}
function section(n) { queue.push(async () => console.log(`\n${n}\n`)); }

/* A real key, so appJwt() signs rather than throwing. Never read from .env. */
const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const APP = { appId: '5520255', privateKey, now: new Date('2026-10-29T04:00:00Z') };

const SITE = {
  'index.html': '<!doctype html><title>Quality Plumbing</title>',
  'drain-cleaning/index.html': '<!doctype html><title>Drain Cleaning</title>',
  '_src/localoptions.json': '{"version":1}',
};

/**
 * GitHub, as far as a publish can tell.
 *
 * `repoExists` IS THE INTERESTING KNOB. A first publish and every publish
 * after it take different paths through this file, and most of the bugs
 * worth catching live in the first one.
 */
function hub({ repoExists = false, account = 'acme', permissions = { contents: 'write' },
               pagesStatus = 201 } = {}) {
  const calls = [];
  const state = { created: null, pages: null, blobs: 0, bootstrapped: null, tree: [] };

  const api = async (req) => {
    calls.push(req);

    const { method, path, body } = req;

    if (path.startsWith('/app/installations/') && 'GET' === method) {
      return { id: 176399104, account: { login: account } };
    }

    if (path.includes('/access_tokens')) {
      return { token: 'ghs_x', expires_at: '2026-10-29T05:00:00Z', permissions };
    }

    if ('GET' === method && /^\/repos\/[^/]+\/[^/]+$/.test(path)) {
      if (repoExists) return { name: path.split('/')[3], html_url: `https://github.com${path.slice(6)}` };

      const err = new Error('GitHub: Not Found');
      err.status = 404;
      throw err;
    }

    if ('POST' === method && '/user/repos' === path) {
      state.created = body;
      return { name: body.name, html_url: `https://github.com/${account}/${body.name}` };
    }

    if ('DELETE' === method && /^\/repos\/[^/]+\/[^/]+$/.test(path)) {
      /* GONE IS A 404, which is what a repository somebody already removed
       * by hand on github.com answers — the state tonight's testing left
       * behind more than once. */
      if (!repoExists) {
        const err = new Error('GitHub: Not Found');
        err.status = 404;
        err.path = path;
        throw err;
      }

      state.deleted = path;
      return {};
    }

    /* --- the commit path, answered just enough to get through it --- */

    if ('GET' === method && path.includes('/git/ref/heads/')) {
      /* A REPOSITORY THAT EXISTS HAS A BRANCH. The fake used to answer
       * "empty" for every repository until something bootstrapped it, so an
       * edit found nothing to carry forward and the assets silently
       * vanished from the tree — in the test, not in GitHub. A fake that is
       * emptier than the real thing hides exactly the case it was written
       * for. */
      if (state.bootstrapped || repoExists) return { object: { sha: 'commit-bootstrap' } };

      /* 409, which is what a repository with no commits answers — not 404.
       * Getting this wrong in the other suite's fake is why the first real
       * publish failed. */
      const err = new Error('GitHub: Git Repository is empty.');
      err.status = 409;
      throw err;
    }

    if ('GET' === method && path.includes('/git/commits/')) {
      return { sha: 'commit-bootstrap', tree: { sha: 'tree-bootstrap' } };
    }

    if ('GET' === method && path.includes('/git/trees/')) {
      return { sha: 'tree-bootstrap', truncated: false, tree: state.tree || [] };
    }

    /* THE ONLY CALL THAT WORKS ON AN EMPTY REPOSITORY. */
    if ('PUT' === method && path.includes('/contents/')) {
      state.bootstrapped = path.split('/contents/')[1];
      return { commit: { sha: 'commit-bootstrap' } };
    }

    if ('POST' === method && path.endsWith('/git/blobs')) {
      state.blobs += 1;

      const raw = 'base64' === body.encoding
        ? Buffer.from(body.content, 'base64')
        : Buffer.from(String(body.content), 'utf8');

      return {
        sha: crypto.createHash('sha1')
          .update(Buffer.concat([Buffer.from(`blob ${raw.length}\0`), raw]))
          .digest('hex'),
      };
    }

    if ('POST' === method && path.endsWith('/git/trees')) return { sha: 'tree-1' };
    if ('POST' === method && path.endsWith('/git/commits')) return { sha: 'commit-1' };
    if ('POST' === method && path.endsWith('/git/refs')) return { object: { sha: 'commit-1' } };
    if ('PATCH' === method && path.includes('/git/refs/heads/')) return { object: { sha: 'commit-1' } };

    /* --- pages --- */

    if ('POST' === method && path.endsWith('/pages')) {
      state.pages = body;

      if (201 === pagesStatus) {
        return { html_url: `https://${account}.github.io/${path.split('/')[3]}/` };
      }

      const err = new Error(409 === pagesStatus
        ? 'GitHub: Pages is already enabled'
        : 'GitHub: Resource not accessible by integration');

      err.status = pagesStatus;
      throw err;
    }

    throw new Error(`the fake was asked something it does not know: ${method} ${path}`);
  };

  /* `tree` is settable from a test, for the edit cases where what the
   * repository already holds is the thing under test. */
  const handle = { api, calls, state };

  Object.defineProperty(handle, 'tree', {
    set(rows) { state.tree = rows; },
    get() { return state.tree; },
  });

  return handle;
}

const run = (h, over = {}) => publishSite({
  installationId: 176399104,
  businessName: 'Quality Plumbing Leander',
  files: SITE,
  api: h.api,
  ...APP,
  ...over,
});

/* ======================================================================= */

section('THE REPOSITORY NAME IS THE SITE\'S IDENTITY');

test('it comes from the business name, lowercased and hyphenated', () => {
  /* It ends up in the URL — acme.com/quality-plumbing-leander/ — so it is
   * read by customers, not only by git. */
  assert.strictEqual(repoNameFor('Quality Plumbing Leander'), 'quality-plumbing-leander');
  assert.strictEqual(repoNameFor('  A&B  Heating / Cooling  '), 'a-b-heating-cooling');
});

test('accents are folded rather than dropped', () => {
  /* "José's Café" losing its letters entirely would give a repository
   * called "s-caf", which is a URL somebody has to live with. */
  assert.strictEqual(repoNameFor('José Café Plumbing'), 'jose-cafe-plumbing');
});

test('AND THE SAME BUSINESS ALWAYS GIVES THE SAME NAME', () => {
  /* THE WHOLE "no site list to maintain" DESIGN RESTS ON THIS. Building a
   * business twice has to update one site rather than produce a second. */
  assert.strictEqual(
    repoNameFor('Quality Plumbing Leander'),
    repoNameFor('Quality  Plumbing   Leander!')
  );
});

test('a name with nothing usable in it is refused, not silently empty', () => {
  /* An empty slug would be POST /user/repos with name: "" — a 422 naming a
   * field, three calls into a publish. */
  assert.throws(() => repoNameFor('!!!'), /no usable repository name/);
  assert.throws(() => repoNameFor(''), /no usable repository name/);
});

/* ======================================================================= */

section('A FIRST PUBLISH');

test('IT CREATES THE REPOSITORY, PUSHES, AND TURNS PAGES ON — IN THAT ORDER', async () => {
  /* ORDER IS THE POINT. Pages cannot be switched on for a branch that does
   * not exist, so on a first publish doing it before the push is the
   * difference between working and not. */
  const h = hub();

  const out = await run(h);

  const order = h.calls
    .filter(c => '/user/repos' === c.path
      || c.path.includes('/contents/')
      || c.path.includes('/git/refs/heads/')
      || c.path.endsWith('/pages'))
    .map(c => c.path);

  assert.deepStrictEqual(order, [
    '/user/repos',
    '/repos/acme/quality-plumbing-leander/contents/index.html',
    '/repos/acme/quality-plumbing-leander/git/refs/heads/main',
    '/repos/acme/quality-plumbing-leander/pages',
  ]);

  assert.strictEqual(out.created, true);
  assert.strictEqual(out.commitSha, 'commit-1');
});

test('THE REPOSITORY IS PUBLIC, BECAUSE PAGES ON A FREE ACCOUNT NEEDS IT', async () => {
  /* A private repo on a free plan produces a site that deploys perfectly
   * and 404s. Nothing in a generated site is secret — every word is on the
   * public pages. */
  const h = hub();

  await run(h);

  assert.strictEqual(h.state.created.private, false);
});

test('and it is created empty, with no README to delete later', async () => {
  /* auto_init would commit a README, which the no-base_tree rule in
   * commit.js then removes on the next publish — a file that appears and
   * vanishes for no reason anybody could name. */
  const h = hub();

  await run(h);

  assert.strictEqual(h.state.created.auto_init, false);
});

test('the site\'s stored words go up with the pages', async () => {
  /* _src/localoptions.json is what makes a later template fix free. The
   * folder on the server is wiped by the next build; this copy is not. */
  const h = hub();

  await run(h);

  /* The bootstrap goes through the contents API; the three files then go
   * through the blob API, because this fake's tree listing is empty and so
   * nothing is reused. Reuse has its own tests next door in
   * test-github-commit.js, where the fake models the object store. */
  assert.strictEqual(h.state.bootstrapped, 'index.html');
  assert.strictEqual(h.state.blobs, 3);

  const tree = h.calls.find(c => c.path.endsWith('/git/trees'));
  assert.ok(tree.body.tree.some(e => '_src/localoptions.json' === e.path),
    'the site was published without the words it was built from');
});

/* ======================================================================= */

section('A SECOND PUBLISH OF THE SAME SITE');

test('IT FINDS THE REPOSITORY RATHER THAN MAKING ANOTHER', async () => {
  const h = hub({ repoExists: true });

  const out = await run(h);

  assert.strictEqual(out.created, false);
  assert.strictEqual(h.state.created, null, 'it created a second repository');
});

test('and Pages already being on is not an error', async () => {
  /* GitHub answers 409. Without this every publish after the first fails at
   * the last step of a deploy that had already succeeded. */
  const h = hub({ repoExists: true, pagesStatus: 409 });

  const out = await run(h);

  assert.strictEqual(out.pages.ok, true);
  assert.strictEqual(out.pages.already, true);
});

/* ======================================================================= */

section('AN EDIT, WHICH REPLACES THE PAGES AND NOT THE PICTURES');

test('KEEPING WHAT THE PUBLISH DOES NOT MENTION', async () => {
  /* A re-render produces the pages and nothing else. The tree built by
   * commit.js IS the site, so publishing that alone would delete every
   * photograph and the logo — and the logo cannot be regenerated, because
   * the upload is long gone. */
  const h = hub({ repoExists: true });

  /* The repository holds a hero and a logo this edit says nothing about. */
  h.tree = [
    { path: 'index.html', type: 'blob', sha: 'aaa' },
    { path: 'assets/hero-1.webp', type: 'blob', sha: 'bbb' },
    { path: 'assets/logo.png', type: 'blob', sha: 'ccc' },
  ];

  await run(h, {
    files: { 'index.html': '<!doctype html><title>Edited</title>' },
    keepOthers: true,
  });

  const tree = h.calls.find(c => c.path.endsWith('/git/trees')).body.tree;

  const paths = tree.map(e => e.path).sort();

  assert.deepStrictEqual(paths, ['assets/hero-1.webp', 'assets/logo.png', 'index.html']);

  /* AND BY SHA, so nothing is downloaded or uploaded for a file nobody
   * touched. */
  assert.strictEqual(tree.find(e => 'assets/logo.png' === e.path).sha, 'ccc');
});

test('and the edited page is the new one, not the one that was there', async () => {
  const h = hub({ repoExists: true });

  h.tree = [{ path: 'index.html', type: 'blob', sha: 'aaa' }];

  await run(h, {
    files: { 'index.html': '<!doctype html><title>Edited</title>' },
    keepOthers: true,
  });

  const tree = h.calls.find(c => c.path.endsWith('/git/trees')).body.tree;

  assert.notStrictEqual(tree.find(e => 'index.html' === e.path).sha, 'aaa');
});

test('A BUILD STILL DELETES A PAGE IT NO LONGER RENDERS', async () => {
  /* THE HALF THAT MATTERS MORE. keepOthers is off by default: a deploy has
   * to be able to remove a page, or one that stopped being rendered lingers
   * for ever — still reachable, still indexed, invisible on every screen. */
  const h = hub({ repoExists: true });

  h.tree = [
    { path: 'index.html', type: 'blob', sha: 'aaa' },
    { path: 'old-page/index.html', type: 'blob', sha: 'ddd' },
  ];

  await run(h, { files: { 'index.html': '<!doctype html><title>Only me</title>' } });

  const tree = h.calls.find(c => c.path.endsWith('/git/trees')).body.tree;

  assert.deepStrictEqual(tree.map(e => e.path), ['index.html']);
});

/* ======================================================================= */

section('WHAT FAILS, AND WHAT THAT COSTS');

test('PAGES REFUSING DOES NOT THROW — THE SITE IS ALREADY PUSHED', async () => {
  /* By this point the words have been written and paid for and the commit
   * has landed. Throwing would report a failed build to a customer whose
   * site is sitting complete in a repository. */
  const h = hub({ pagesStatus: 403 });

  const out = await run(h);

  assert.strictEqual(out.commitSha, 'commit-1', 'the push was lost');
  assert.strictEqual(out.pages.ok, false);

  /* GITHUB'S OWN WORDS FIRST. This assertion used to accept the sentence
   * this file invented about private repositories and free plans — which
   * was then printed, confidently, on a 403 against a PUBLIC one. */
  assert.match(out.pages.error, /Resource not accessible by integration/);
  assert.match(out.pages.error, /403/);
});

test('A NARROWED INSTALLATION IS CAUGHT BEFORE ANYTHING IS CREATED', async () => {
  /* An installer can grant less than the App asked for. Without this the
   * first sign is a 403 three calls in, on an endpoint whose name does not
   * mention the permission that was missing. */
  const h = hub({ permissions: { contents: 'read' } });

  await assert.rejects(run(h), /did not grant write access/);

  assert.strictEqual(h.state.created, null, 'it made a repository it could not fill');
});

test('and no installation at all is refused with somewhere to go', async () => {
  const h = hub();

  await assert.rejects(
    run(h, { installationId: null }),
    /installs the App on their GitHub once/
  );

  assert.strictEqual(h.calls.length, 0);
});

test('an installation whose account has gone is named, not guessed at', async () => {
  const api = async (req) => {
    if (req.path.startsWith('/app/installations/')) return { id: 1, account: null };
    throw new Error('should not get this far');
  };

  await assert.rejects(
    run({ api, calls: [] }, { api }),
    /uninstalled/
  );
});

/* ======================================================================= */

section('THE PIECES ON THEIR OWN');

test('ownerOf asks with the App\'s own token, not the installation\'s', async () => {
  /* The installation does not know its own owner, and every repository call
   * needs that login in the path. */
  const seen = [];

  const api = async (req) => {
    seen.push(req);
    return { account: { login: 'acme' } };
  };

  assert.strictEqual(await ownerOf({ installationId: 1, ...APP, api }), 'acme');

  /* Three segments means a JWT. An installation token is an opaque string. */
  assert.strictEqual(seen[0].token.split('.').length, 3);
});

test('ensureRepo passes a real error through rather than creating blindly', async () => {
  /* A 500 while looking for the repository is not "it does not exist". */
  const api = async () => {
    const err = new Error('GitHub: Server Error');
    err.status = 500;
    throw err;
  };

  await assert.rejects(
    ensureRepo({ owner: 'acme', name: 'x', token: 't', api }),
    /Server Error/
  );
});

test('enablePages asks for the branch root, which is where the site is', async () => {
  const seen = [];

  const api = async (req) => { seen.push(req); return { html_url: 'https://acme.github.io/x/' }; };

  const out = await enablePages({ owner: 'acme', repo: 'x', token: 't', api });

  assert.deepStrictEqual(seen[0].body, { source: { branch: 'main', path: '/' } });
  assert.strictEqual(out.url, 'https://acme.github.io/x/');
});

/* ======================================================================= */

section('DELETING A SITE, AND THE ONE REPOSITORY THAT MUST SURVIVE IT');

const ADMIN = { contents: 'write', administration: 'write' };

const kill = (h, over = {}) => deleteSite({
  installationId: 176399104,
  repo: 'quality-plumbing-leander',
  owner: 'acme',
  api: h.api,
  ...APP,
  ...over,
});

test('THE ROOT PAGES SITE IS REFUSED, AND THAT IS WHY THIS FILE EXISTS', () => {
  /* 29 October: the repository deleted by hand was `<login>.github.io` and
   * not the test project under it. Every site on the custom domain went
   * down at once and the root had to be recreated and re-pointed.
   *
   * Refused BEFORE any request, so no token is minted and nothing is asked
   * of GitHub — a guard that runs after two round trips is one somebody
   * moves "just past the network bit" one day. */
  const h = hub({ repoExists: true, permissions: ADMIN });

  return assert.rejects(
    kill(h, { repo: 'acme.github.io' }),
    /root Pages site/
  ).then(() => {
    assert.strictEqual(h.calls.length, 0, 'it asked GitHub something first');
  });
});

test('and it is refused however the account was renamed', () => {
  /* Matched on the .github.io SUFFIX rather than against the owner's login:
   * a renamed GitHub account leaves a root repository whose name no longer
   * matches its owner, and the login comparison would wave it through. */
  assert.ok(isRootSite('someone-else.github.io'));
  assert.ok(isRootSite('ACME.GitHub.IO'));
  assert.ok(!isRootSite('quality-plumbing-leander'));
  assert.ok(!isRootSite('github-io-plumbing'));
});

test('a generated site is deleted by name', async () => {
  const h = hub({ repoExists: true, permissions: ADMIN });

  const out = await kill(h);

  assert.strictEqual(h.state.deleted, '/repos/acme/quality-plumbing-leander');
  assert.strictEqual(out.already, false);
  assert.strictEqual(out.ok, true);
});

test('ALREADY GONE IS SUCCESS, NOT AN ERROR', async () => {
  /* The caller's goal is "this site should not exist", and a 404 means it
   * does not. Throwing here would strand the pointer row for every site
   * somebody had already removed on github.com by hand. */
  const h = hub({ repoExists: false, permissions: ADMIN });

  const out = await kill(h);

  assert.strictEqual(out.already, true);
  assert.strictEqual(out.ok, true);
});

test('A MISSING PERMISSION IS NAMED BEFORE THE ATTEMPT, NOT AFTER A 403', async () => {
  /* Deleting needs "Administration: write" — the same permission creating a
   * Pages site needs. GitHub refuses with "Resource not accessible by
   * integration", which names neither the permission nor the endpoint, and
   * cost an evening when Pages hit it. */
  const h = hub({ repoExists: true, permissions: { contents: 'write' } });

  await assert.rejects(kill(h), /Administration: write/);

  assert.strictEqual(h.state.deleted, undefined, 'it tried the delete anyway');
});

test('and an installation or repository that was not given is refused outright', async () => {
  const h = hub({ repoExists: true, permissions: ADMIN });

  await assert.rejects(kill(h, { installationId: '' }), /needs an installation/);
  await assert.rejects(kill(h, { repo: '' }), /needs an installation/);
});

test('the owner is asked for only when the caller does not know it', async () => {
  /* One round trip saved on every delete from the list, which already has
   * the login in the row. */
  const h = hub({ repoExists: true, permissions: ADMIN });

  await kill(h);

  assert.ok(
    !h.calls.some(c => c.path.startsWith('/app/installations/') && 'GET' === c.method),
    'it looked up the owner it was handed'
  );

  const h2 = hub({ repoExists: true, permissions: ADMIN });

  await kill(h2, { owner: undefined });

  assert.ok(h2.calls.some(c => c.path.startsWith('/app/installations/')));
});

/* ---------------------------------------------------------------------- */

(async () => {
  for (const run of queue) await run();

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
