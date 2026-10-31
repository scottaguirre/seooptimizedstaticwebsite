// test-github-commit.js
//
// Putting a built site into a repository, as one commit.
//
// NOTHING HERE TOUCHES THE NETWORK. Every test injects `api`, the same way
// test-cloudflare-deploy.js does and for the same reason: a suite that forgot
// would push to a real repository.
//
// THE BLOB SHAS ARE CHECKED AGAINST GIT'S OWN FORMULA, not against a value
// this file recorded. A fixture sha would only prove the output had not
// changed; the whole reuse path depends on it being the sha GIT would give,
// which is a different claim.
//
//   node test-github-commit.js

'use strict';

const assert = require('assert');
const crypto = require('crypto');

const {
  blobSha, headOf, existingShas, commitSite, FILE_MODE,
} = require('./utils/github/commit');

let passed = 0, failed = 0;

const queue = [];
function test(name, fn) {
  queue.push(() => Promise.resolve()
    .then(fn)
    .then(() => { console.log(`  ok    ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }));
}
function section(n) { queue.push(async () => console.log(`\n${n}\n`)); }

const OWNER = 'gomanzo';
const REPO = 'leander-plumbing';
const TOKEN = 'ghs_installation';

/* ------------------------------------------------------------------ fakes */

/**
 * A repository, as the Git Data API sees one.
 *
 * IT COMPUTES BLOB SHAS THE WAY GITHUB DOES rather than inventing names.
 * A fake that answered 'sha-1', 'sha-2' would let a bug in blobSha() pass
 * every test here and fail on the first real deploy — the reuse check
 * compares our number against theirs.
 */
function repo({ empty: startsEmpty = false, files = {}, truncated = false, emptyStatus = 409 } = {}) {
  let empty = startsEmpty;
  const calls = [];
  const blobs = new Map();

  const shaOf = (content) => {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
    return crypto.createHash('sha1')
      .update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
      .digest('hex');
  };

  const treeEntries = Object.keys(files).map(path => ({
    path, type: 'blob', mode: FILE_MODE, sha: shaOf(files[path]),
  }));

  const state = {
    bootstrapped: null,
    commitSha: 'commit-old',
    treeSha: 'tree-old',
    trees: [],
    commits: [],
    refs: [],
  };

  const api = async (req) => {
    calls.push(req);

    const { method, path, body } = req;

    if ('GET' === method && path.includes('/git/ref/heads/')) {
      if (empty) {
        /* 409 BY DEFAULT, BECAUSE THAT IS WHAT GITHUB ACTUALLY SENDS.
         *
         * This fake answered 404 — "a missing thing is a 404" — and that
         * assumption passed twenty-six tests and broke the first real
         * publish. A repository with no commits is not a missing ref; it
         * is "Git Repository is empty", and GitHub calls that a conflict.
         *
         * The default is the real behaviour and `emptyStatus` lets one
         * test assert the other, so neither can regress. */
        const err = new Error(409 === emptyStatus
          ? 'GitHub: Git Repository is empty.'
          : 'GitHub: Not Found');

        err.status = emptyStatus;
        throw err;
      }
      return { object: { sha: state.commitSha } };
    }

    if ('GET' === method && path.includes('/git/commits/')) {
      return { sha: state.commitSha, tree: { sha: state.treeSha } };
    }

    if ('GET' === method && path.includes('/git/trees/')) {
      return { sha: state.treeSha, truncated, tree: treeEntries };
    }

    /* THE OBJECT STORE IS SHUT UNTIL THE REPOSITORY HAS A COMMIT.
     *
     * THIS IS THE RULE THE FAKE DID NOT KNOW, and the reason twenty-eight
     * tests passed while the first real publish failed. Blobs, trees,
     * commits and refs all answer 409 "Git Repository is empty." on a
     * repository with no commits — only the contents API works there.
     *
     * A fake more permissive than the real thing tests nothing. */
    if (empty && !state.bootstrapped
        && ('POST' === method && /\/git\/(blobs|trees|commits|refs)$/.test(path))) {
      const err = new Error('GitHub: Git Repository is empty.');
      err.status = 409;
      throw err;
    }

    /* The contents API, which is how an empty repository gets its first
     * commit — and the only call that works there. */
    if ('PUT' === method && path.includes('/contents/')) {
      state.bootstrapped = path.split('/contents/')[1];

      const raw = Buffer.from(body.content, 'base64');
      blobs.set(shaOf(raw), raw);

      /* From here the repository is ordinary: it has a commit, a tree
       * holding that one file, and a branch. */
      state.commitSha = 'commit-bootstrap';
      state.treeSha = 'tree-bootstrap';

      treeEntries.length = 0;
      treeEntries.push({
        path: state.bootstrapped, type: 'blob', mode: FILE_MODE, sha: shaOf(raw),
      });

      empty = false;

      return { commit: { sha: state.commitSha } };
    }

    if ('POST' === method && path.endsWith('/git/blobs')) {
      const raw = 'base64' === body.encoding
        ? Buffer.from(body.content, 'base64')
        : body.content;

      const sha = shaOf(raw);
      blobs.set(sha, raw);
      return { sha };
    }

    if ('POST' === method && path.endsWith('/git/trees')) {
      state.trees.push(body);

      /* A TREE IS NAMED BY WHAT IS IN IT, so an identical set of files gives
       * an identical sha — which is what the "nothing changed" path turns
       * on. A fake handing out a fresh id each time would make that path
       * untestable. */
      const name = crypto.createHash('sha1')
        .update(JSON.stringify(body.tree.map(e => [e.path, e.sha]).sort()))
        .digest('hex');

      return { sha: `tree-${name.slice(0, 8)}` };
    }

    if ('POST' === method && path.endsWith('/git/commits')) {
      state.commits.push(body);
      return { sha: 'commit-new' };
    }

    if ('PATCH' === method && path.includes('/git/refs/heads/')) {
      state.refs.push({ method, path, body });
      return { object: { sha: body.sha } };
    }

    if ('POST' === method && path.endsWith('/git/refs')) {
      state.refs.push({ method, path, body });
      return { object: { sha: body.sha } };
    }

    throw new Error(`the fake repository was asked something it does not know: ${method} ${path}`);
  };

  return { api, calls, state, blobs, shaOf };
}

const SITE = {
  'index.html': '<!doctype html><title>Leander Plumbing</title>',
  'drain-cleaning/index.html': '<!doctype html><title>Drain Cleaning</title>',
  'assets/site.css': 'body{margin:0}',
};

const push = (r, over = {}) => commitSite({
  owner: OWNER, repo: REPO, token: TOKEN, files: SITE, api: r.api, ...over,
});

/* ======================================================================= */

section('THE SHA GIT WOULD GIVE');

test('blobSha matches git\'s own formula, for text', () => {
  /* `blob <bytes>\0<content>`, sha1. Computed here independently rather
   * than copied from the implementation — two copies of the same mistake
   * agree with each other. */
  const content = 'hello\n';

  const expected = crypto.createHash('sha1')
    .update(Buffer.from(`blob ${Buffer.byteLength(content)}\0${content}`))
    .digest('hex');

  assert.strictEqual(blobSha(content), expected);
});

test('AND THE LENGTH IS IN BYTES, NOT CHARACTERS', () => {
  /* 'é'.length is 1 and its utf-8 encoding is two bytes. A header built
   * from String.length produces a hash git has never heard of, which fails
   * as "every file changed" — silently, for ever, on any site with an
   * accent in it. And these sites carry em dashes in every paragraph. */
  const accented = 'Leander — é';

  assert.notStrictEqual(accented.length, Buffer.byteLength(accented));

  const expected = crypto.createHash('sha1')
    .update(Buffer.concat([
      Buffer.from(`blob ${Buffer.byteLength(accented)}\0`),
      Buffer.from(accented, 'utf8'),
    ]))
    .digest('hex');

  assert.strictEqual(blobSha(accented), expected);
});

test('and a Buffer hashes as its bytes, not as its toString', () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);

  assert.strictEqual(blobSha(bytes), crypto.createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
    .digest('hex'));
});

/* ======================================================================= */

section('A FIRST PUBLISH, INTO AN EMPTY REPOSITORY');

test('IT GIVES AN EMPTY REPOSITORY ITS FIRST COMMIT BEFORE ANYTHING ELSE', async () => {
  /* THE BUG THE FAKE HID UNTIL 29 OCTOBER. GitHub will not let a blob, a
   * tree, a commit or a ref into a repository that has no commits — every
   * one of them answers 409 "Git Repository is empty." Only the contents
   * API works there, so that is how the first commit is made. */
  const r = repo({ empty: true });

  const out = await push(r);

  assert.strictEqual(r.state.bootstrapped, 'index.html',
    'it did not bootstrap, or bootstrapped with something other than the page');

  assert.strictEqual(out.commitSha, 'commit-new', 'the real push never happened');
  assert.strictEqual(out.unchanged, false);
});

test('and then moves the branch it was just given', async () => {
  /* After the bootstrap the repository is ordinary: the branch exists, so
   * the push updates it rather than creating it. */
  const r = repo({ empty: true });

  await push(r);

  const ref = r.state.refs[0];

  assert.strictEqual(ref.method, 'PATCH');
  assert.ok(ref.path.endsWith('/git/refs/heads/main'));
  assert.strictEqual(ref.body.sha, 'commit-new');
});

test('and the push descends from the bootstrap commit', async () => {
  /* `parents: []` on a repository that now has history would be a second
   * root commit — an orphan branch, not a deploy. */
  const r = repo({ empty: true });

  await push(r);

  assert.deepStrictEqual(r.state.commits[0].parents, ['commit-bootstrap']);
});

test('and the bootstrapped page is not uploaded a second time', async () => {
  /* The contents API already put index.html in the object store under the
   * sha git gives it, so the push names it instead of sending it again. */
  const r = repo({ empty: true });

  const out = await push(r);

  assert.strictEqual(out.uploaded, 2);
  assert.strictEqual(out.reused, 1);
});

/* ======================================================================= */

section('THE TREE IS THE SITE, NOT A PATCH ON IT');

test('NO base_tree — A PAGE THAT IS GONE IS GONE', async () => {
  /* THE MOST IMPORTANT ASSERTION IN THIS FILE. With base_tree the commit
   * means "start from what is there and apply these", so a page that is no
   * longer rendered stays in the repository for ever — still reachable,
   * still indexed, and nothing on any screen says it exists.
   *
   * staticBlogsRoute.js says the same thing about Cloudflare Pages in its
   * own words: a deployment IS the site. */
  const r = repo({ files: { 'old-page/index.html': 'gone', ...SITE } });

  await push(r);

  const sent = r.state.trees[0];

  assert.ok(!('base_tree' in sent), 'the tree was built as a patch');
  assert.strictEqual(sent.tree.length, 3);
  assert.ok(!sent.tree.some(e => e.path.startsWith('old-page/')),
    'a page nobody renders any more is still in the tree');
});

test('and every entry is a plain file', async () => {
  const r = repo({ empty: true });

  await push(r);

  for (const entry of r.state.trees[0].tree) {
    assert.strictEqual(entry.mode, '100644');
    assert.strictEqual(entry.type, 'blob');
  }
});

/* ======================================================================= */

section('AN UNCHANGED FILE COSTS NOTHING');

test('A FILE ALREADY IN THE REPOSITORY IS NAMED, NOT UPLOADED', async () => {
  /* On a re-deploy where one page changed this is one upload instead of
   * fifteen; on a 171-article blog it is the difference between a deploy
   * and an afternoon. */
  const r = repo({ files: { ...SITE } });

  const changed = { ...SITE, 'index.html': '<!doctype html><title>New</title>' };

  const out = await commitSite({
    owner: OWNER, repo: REPO, token: TOKEN, files: changed, api: r.api,
  });

  assert.strictEqual(out.uploaded, 1, 'it uploaded more than the file that changed');
  assert.strictEqual(out.reused, 2);

  const posted = r.calls.filter(c => c.path.endsWith('/git/blobs'));
  assert.strictEqual(posted.length, 1);
});

test('AND A SITE THAT DID NOT CHANGE IS NOT COMMITTED AT ALL', async () => {
  /* An identical tree means an identical site. Committing it anyway is a
   * line in the history saying a deploy happened and nothing came of it —
   * and on GitHub Pages it rebuilds a site that did not change. */
  const r = repo({ files: { ...SITE } });

  /* The fake names a tree after its contents, so an identical set of files
   * produces the sha the repository already has. */
  r.state.treeSha = `tree-${crypto.createHash('sha1')
    .update(JSON.stringify(Object.keys(SITE)
      .map(p => [p, r.shaOf(SITE[p])]).sort()))
    .digest('hex').slice(0, 8)}`;

  const out = await push(r);

  assert.strictEqual(out.unchanged, true);
  assert.strictEqual(out.commitSha, 'commit-old', 'it moved the branch anyway');
  assert.strictEqual(r.state.commits.length, 0);
  assert.strictEqual(r.state.refs.length, 0);
});

test('A FILE GIVEN AS A SHA IS NAMED, NOT UPLOADED', async () => {
  /* THE EDITOR'S CASE. An edit re-renders the pages and cannot re-render
   * the logo — that upload is long gone by the time somebody fixes a
   * sentence six weeks later. The repository still has it, so the caller
   * carries it forward by sha and no bytes cross the wire. */
  const r = repo({ files: { ...SITE } });

  const out = await commitSite({
    owner: OWNER, repo: REPO, token: TOKEN, api: r.api,
    files: {
      'index.html': '<!doctype html><title>Edited</title>',
      'assets/hero-1.webp': { sha: 'cafebabe00000000000000000000000000000000' },
    },
  });

  assert.strictEqual(out.uploaded, 1, 'it uploaded a file it was given by sha');
  assert.strictEqual(out.reused, 1);

  const tree = r.state.trees[0].tree;
  const hero = tree.find(e => 'assets/hero-1.webp' === e.path);

  assert.strictEqual(hero.sha, 'cafebabe00000000000000000000000000000000');
});

test('a truncated tree listing is treated as no listing', async () => {
  /* GitHub truncates over about 100,000 entries. Half a listing read as a
   * whole one makes every missing path look new — slow but correct — and
   * invites a future reader to use the same map to decide what to DELETE,
   * where half a listing is a disaster. */
  const r = repo({ files: { ...SITE }, truncated: true });

  const out = await push(r);

  assert.strictEqual(out.reused, 0, 'it trusted a truncated listing');
  assert.strictEqual(out.uploaded, 3);
});

/* ======================================================================= */

section('BYTES STAY BYTES');

test('A PICTURE IS SENT AS base64, NOT AS A STRING', async () => {
  /* A hero photograph sent as utf-8 comes back a valid file that is no
   * longer an image — a corruption that shows up as a broken picture on a
   * page which otherwise deploys perfectly. */
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe]);

  const r = repo({ empty: true });

  await commitSite({
    owner: OWNER, repo: REPO, token: TOKEN, api: r.api,
    /* index.html is bootstrapped through the contents API, so a SECOND
     * text file is needed for a utf-8 blob to exist at all. */
    files: { 'assets/hero-1.webp': png, 'index.html': 'text', 'contact/index.html': 'more text' },
  });

  const sent = r.calls.filter(c => c.path.endsWith('/git/blobs'));

  const picture = sent.find(c => 'base64' === c.body.encoding);
  const page = sent.find(c => 'utf-8' === c.body.encoding);

  assert.ok(picture, 'the picture was not base64');
  assert.ok(page, 'the page was not utf-8');

  /* AND IT SURVIVES THE ROUND TRIP. The encoding being right is not the
   * same claim as the bytes arriving. */
  assert.ok(Buffer.from(picture.body.content, 'base64').equals(png),
    'the bytes changed on the way');
});

test('and text with an em dash in it arrives whole', async () => {
  /* Every page these generators write has one. */
  const prose = '<p>We are out from 7 — and we answer the phone.</p>';

  const r = repo({ empty: true });

  await commitSite({
    owner: OWNER, repo: REPO, token: TOKEN, api: r.api,
    /* Not index.html — that one goes up through the contents API as the
     * bootstrap, base64 like everything that call carries. */
    files: { 'index.html': 'home', 'drain-cleaning/index.html': prose },
  });

  const [blob] = r.calls.filter(c => c.path.endsWith('/git/blobs'));

  assert.strictEqual(blob.body.content, prose);
  assert.strictEqual(blob.body.encoding, 'utf-8');
});

/* ======================================================================= */

section('WHAT IT REFUSES');

test('AN EMPTY SET OF FILES IS REFUSED, NOT COMMITTED', async () => {
  /* A tree with no entries is a valid commit that deletes the whole site,
   * and the one way to reach it by accident is a renderer that returned
   * nothing — a bug upstream, not an instruction to empty the repo. */
  const r = repo();

  await assert.rejects(push(r, { files: {} }), /would delete every page/);

  assert.strictEqual(r.calls.length, 0, 'it asked GitHub about an empty site');
});

test('no token is refused before any call is made', async () => {
  /* The App's own JWT cannot touch a repository — only an installation
   * token can, and the error says where to get one. */
  const r = repo();

  await assert.rejects(push(r, { token: '' }), /installation token/);

  assert.strictEqual(r.calls.length, 0);
});

test('and so is a missing owner or repo', async () => {
  const r = repo();

  await assert.rejects(push(r, { owner: '' }), /owner and a repo/);
  await assert.rejects(push(r, { repo: '' }), /owner and a repo/);
});

test('A SHA GITHUB DISAGREES WITH STOPS THE DEPLOY', async () => {
  /* The whole reuse path rests on our number and theirs being the same
   * number. If they ever stop agreeing, this is where it should be noticed
   * — not three deploys later when nothing is being reused and nobody can
   * say when that started. */
  const r = repo({ empty: true });

  const honest = r.api;

  const api = async (req) => {
    if ('POST' === req.method && req.path.endsWith('/git/blobs')) {
      return { sha: 'something-else-entirely' };
    }
    return honest(req);
  };

  await assert.rejects(push(r, { api }), /git's own formula gives/);
});

test('a 500 from GitHub is not swallowed', async () => {
  const r = repo({ empty: true });

  const api = async (req) => {
    if (req.path.endsWith('/git/blobs')) {
      const err = new Error('GitHub: Server Error');
      err.status = 500;
      throw err;
    }
    return r.api(req);
  };

  await assert.rejects(push(r, { api }), /Server Error/);
});

/* ======================================================================= */

section('THE PUSH ITSELF');

test('IT MOVES THE BRANCH WITH NO force', async () => {
  /* Without force, GitHub refuses when the branch has moved since we read
   * it — which is the answer wanted. Somebody else's commit is not
   * something a deploy should quietly discard. */
  const r = repo({ files: { 'index.html': 'old' } });

  await push(r);

  const ref = r.state.refs[0];

  assert.strictEqual(ref.method, 'PATCH');
  assert.ok(ref.path.endsWith('/git/refs/heads/main'));
  assert.ok(!('force' in ref.body), 'it force-pushed over the branch');
});

test('the commit descends from what was there', async () => {
  const r = repo({ files: { 'index.html': 'old' } });

  await push(r);

  assert.deepStrictEqual(r.state.commits[0].parents, ['commit-old']);
});

test('and the message is the one it was given', async () => {
  const r = repo({ empty: true });

  await push(r, { message: 'Publish 11 pages' });

  assert.strictEqual(r.state.commits[0].message, 'Publish 11 pages');
});

test('a branch that is not main is honoured end to end', async () => {
  /* GitHub Pages can serve from gh-pages, and the ref path is built from
   * this in three separate places. */
  const r = repo({ empty: true });

  const out = await push(r, { branch: 'gh-pages' });

  assert.strictEqual(out.branch, 'gh-pages');

  /* The bootstrap names it too — a contents PUT without `branch` creates
   * the repository's default branch instead, and the push would then move
   * a branch Pages is not serving. */
  const boot = r.calls.find(c => 'PUT' === c.method);
  assert.strictEqual(boot.body.branch, 'gh-pages');

  assert.ok(r.state.refs[0].path.endsWith('/git/refs/heads/gh-pages'));
});

/* ======================================================================= */

section('THE PIECES ON THEIR OWN');

test('headOf answers null for an empty repository, not an error', async () => {
  /* 409 — "Git Repository is empty." — which is what GitHub actually sends
   * and what this file originally got wrong. */
  const r = repo({ empty: true });

  assert.strictEqual(
    await headOf({ owner: OWNER, repo: REPO, branch: 'main', token: TOKEN, api: r.api }),
    null
  );
});

test('AND ALSO FOR A 404, because both mean "nothing here yet"', async () => {
  /* A repository that HAS commits but not this branch answers 404. The two
   * cases are different inside GitHub and identical to a publish. */
  const r = repo({ empty: true, emptyStatus: 404 });

  assert.strictEqual(
    await headOf({ owner: OWNER, repo: REPO, branch: 'main', token: TOKEN, api: r.api }),
    null
  );
});

test('A FIRST PUBLISH INTO A REPOSITORY GITHUB CALLS EMPTY STILL LANDS', async () => {
  /* THE ONE THE FAKE HID. Twenty-six tests passed against a fake that
   * answered 404; the first real repository answered 409 and the push never
   * happened — leaving an empty repository that looked like a successful
   * build. This is that run, with the status GitHub really sends. */
  const r = repo({ empty: true });

  const out = await push(r);

  assert.strictEqual(out.commitSha, 'commit-new', 'the push was lost');
  assert.strictEqual(r.state.refs.length, 1, 'the branch was never moved');

  /* Two, not three: index.html went up as the bootstrap and is reused. */
  assert.strictEqual(out.uploaded, 2);
  assert.strictEqual(out.reused, 1);
});

test('and it passes a real failure through', async () => {
  const api = async () => {
    const err = new Error('GitHub: Bad credentials');
    err.status = 401;
    throw err;
  };

  await assert.rejects(
    headOf({ owner: OWNER, repo: REPO, branch: 'main', token: TOKEN, api }),
    /Bad credentials/
  );
});

test('existingShas asks recursively, because a site has directories', async () => {
  /* `drain-cleaning/index.html` is not a top-level entry. A flat listing
   * reports the directory and never the page inside it, so every page
   * would look new on every deploy. */
  const r = repo({ files: { ...SITE } });

  await existingShas({ owner: OWNER, repo: REPO, treeSha: 'tree-old', token: TOKEN, api: r.api });

  assert.ok(r.calls[0].path.includes('recursive=1'));
});

test('and it answers an empty map when there is no tree yet', async () => {
  const r = repo({ empty: true });

  const map = await existingShas({ owner: OWNER, repo: REPO, treeSha: null, token: TOKEN, api: r.api });

  assert.strictEqual(map.size, 0);
  assert.strictEqual(r.calls.length, 0, 'it asked about a tree that does not exist');
});

/* ---------------------------------------------------------------------- */

(async () => {
  for (const run of queue) await run();

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
