// utils/github/commit.js
//
// Putting a built site into a repository, as one commit.
//
// WHY THE GIT DATA API AND NOT "upload a file"
//
// The contents API (PUT /repos/:o/:r/contents/:path) writes ONE file per
// commit. A fifteen-page site is fifteen commits, each a separate push, and a
// visitor refreshing halfway through gets a site that is half old and half
// new. A blog of 171 articles is 171.
//
// The Git Data API builds the whole thing first and swaps it in at the end:
//
//     blobs    the bytes of each file
//     tree     what the site looks like, as a whole
//     commit   that tree, with a parent and a message
//     ref      the branch, moved to that commit — one atomic step
//
// Nothing is visible until the last call, and the last call either happens or
// does not.
//
// THE TREE IS BUILT WITHOUT base_tree, AND THAT IS THE IMPORTANT LINE IN
// THIS FILE.
//
// `base_tree` means "start from what is there and apply these changes" — so a
// page that no longer exists stays in the repository for ever. A deploy is
// not a patch. staticBlogsRoute.js says the same thing about Cloudflare Pages
// in its own words: "a Pages deployment IS the site: whatever is not in it is
// gone". This builds the tree from the given files alone, so a deleted page
// is deleted.
//
//   node test-github-commit.js

'use strict';

const crypto = require('crypto');

const { githubApi } = require('./app');

/** Ordinary file. Nothing here is executable and nothing is a symlink. */
const FILE_MODE = '100644';

/**
 * The sha1 git would give this content, computed locally.
 *
 * WHY BOTHER: it is what lets an unchanged file cost nothing. Git names a
 * blob by the sha1 of `blob <length>\0<bytes>` — a formula, not a lookup — so
 * the same bytes always produce the same name, and a file whose sha already
 * appears in the repository's tree does not need uploading again.
 *
 * On a re-deploy where one page changed, that is one upload instead of
 * fifteen; on a 171-article blog it is the difference between a deploy and an
 * afternoon.
 *
 * THE LENGTH IS IN BYTES, NOT CHARACTERS. `'é'.length` is 1 and its utf-8
 * encoding is 2, so a header built from String.length produces a hash git has
 * never heard of — which fails as "every file changed", silently and for
 * ever, on any site with an accent in it.
 */
function blobSha(content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');

  return crypto
    .createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
    .digest('hex');
}

/**
 * Where the branch is now, or null for a repository with no commits.
 *
 * AN EMPTY REPOSITORY IS THE NORMAL FIRST CASE, not an error. A repository
 * created a moment ago has no branches at all, so a first deploy is exactly
 * when this happens. Treating it as a failure would mean no site could ever
 * be published to a new repository.
 *
 * AND GITHUB SAYS SO WITH A 409, NOT A 404 — found on the first real run,
 * 29 October, after twenty-six tests had passed.
 *
 * This file was written against a fake that answered 404 for a missing ref,
 * because that is what a missing thing answers. A repository with no commits
 * at all is a different kind of missing, and GitHub calls it a CONFLICT:
 * "Git Repository is empty." So the very first publish — the one case this
 * branch exists for — threw, the push never happened, and the customer was
 * left with an empty repository that looked like a successful build.
 *
 *     THE FAKE AGREED WITH MY ASSUMPTION INSTEAD OF WITH GITHUB.
 *     TWENTY-SIX TESTS PASSED AND THE FIRST REAL CALL FAILED.
 *
 * Both are now treated as "nothing here yet", which is what they both mean.
 */
async function headOf({ owner, repo, branch, token, api }) {
  try {
    const ref = await api({
      method: 'GET',
      path: `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
      token,
    });

    const commitSha = ref && ref.object && ref.object.sha;

    if (!commitSha) return null;

    const commit = await api({
      method: 'GET',
      path: `/repos/${owner}/${repo}/git/commits/${commitSha}`,
      token,
    });

    return { commitSha, treeSha: commit && commit.tree && commit.tree.sha };

  } catch (err) {
    if (404 === err.status || 409 === err.status) return null;

    throw err;
  }
}

/**
 * Every path already in the repository, with the sha of its contents.
 *
 * RECURSIVE, because a site has directories — `drain-cleaning/index.html` is
 * not a top-level entry, and a non-recursive listing would report the
 * directory and never the page inside it, so every page would look new.
 *
 * A TRUNCATED ANSWER IS TREATED AS NO ANSWER. GitHub truncates a tree listing
 * over about 100,000 entries and says so in `truncated`. Half a listing read
 * as a whole one means every missing path looks like a new file — which is
 * correct but slow — and, worse, invites a future reader to use this map for
 * deciding what to DELETE, where half a listing is a disaster. Returning
 * nothing makes the failure "everything uploads" rather than "some things
 * silently do not exist".
 */
async function existingShas({ owner, repo, treeSha, token, api }) {
  if (!treeSha) return new Map();

  const tree = await api({
    method: 'GET',
    path: `/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`,
    token,
  });

  if (!tree || tree.truncated || !Array.isArray(tree.tree)) return new Map();

  const out = new Map();

  for (const entry of tree.tree) {
    if ('blob' === entry.type) out.set(entry.path, entry.sha);
  }

  return out;
}

/**
 * Give a repository with no commits its first one.
 *
 * BECAUSE THE GIT DATA API WILL NOT TOUCH AN EMPTY REPOSITORY. Found on the
 * second attempt at the first real publish, 29 October:
 *
 *     POST /repos/<owner>/<repo>/git/blobs → 409 Git Repository is empty.
 *
 * Not the branch lookup, which is written to expect exactly that condition
 * and had just been patched on a hunch. Blobs, trees, commits and refs all
 * live under the repository's object store, and GitHub will not let anything
 * into that store until the repository has a commit in it. Every one of them
 * refuses with the same six words.
 *
 *     THE API THAT BUILDS A COMMIT CANNOT MAKE THE FIRST ONE.
 *
 * The CONTENTS API can, and it is the only call in this file that works on
 * an empty repository: PUT one file and GitHub creates the blob, the tree,
 * the commit and the branch in a single step.
 *
 * SO IT PUTS A REAL PAGE, NOT A PLACEHOLDER. index.html is going into the
 * next commit anyway, so using it means the repository is never in a state
 * showing a README nobody wrote. And the commit that follows does not
 * re-upload it: the sha is already in the tree, so it is reused — see the
 * note on blobSha above.
 */
async function bootstrapEmpty({ owner, repo, branch, token, api, files }) {
  const first = files['index.html'] !== undefined ? 'index.html' : Object.keys(files)[0];

  const content = files[first];

  const bytes = Buffer.isBuffer(content)
    ? content
    : Buffer.from(String(content), 'utf8');

  await api({
    method: 'PUT',
    path: `/repos/${owner}/${repo}/contents/${first}`,
    token,
    body: {
      message: 'Create the site',
      content: bytes.toString('base64'),
      branch,
    },
  });
}

/** Injected in the suite so a retry costs no wall-clock time. */
const defaultSleep = ms => new Promise(done => setTimeout(done, ms));

/**
 * The head of a branch that was JUST created, waited for.
 *
 * THE ONE-CALL VERSION WAS A RACE, AND IT COST TWO PAID BUILDS ON
 * 11 NOVEMBER. bootstrapEmpty() creates the first commit through the
 * Contents API, and the code then read the branch back with a single
 * headOf(). GitHub does not always have the new ref readable by then, so
 * headOf() answered 409 — which it is written to translate into "nothing
 * here yet" — and everything downstream carried on believing the repository
 * was still empty.
 *
 * THAT BELIEF IS WRONG IN TWO DIFFERENT PLACES, and both were seen:
 *
 *     02:59  Plumbing Solutions Austin   POST /git/refs
 *            → 422 Reference already exists
 *            The branch the bootstrap had just made.
 *
 *     04:54  CT Plumbing Austin          POST /git/blobs
 *            → 409 Git Repository is empty.
 *            The object store was not open yet either.
 *
 * Both jobs logged `jobs.completed` and charged 800 credits, because
 * runLocalOptions will not fail a build over a publish — the pages exist and
 * are paid for by then. So the customer is charged, the job says it worked,
 * and the repository holds one file.
 *
 *     A 409 MEANS "NOT YET". IT DOES NOT SAY WHETHER THAT IS BECAUSE THE
 *     REPOSITORY IS EMPTY OR BECAUSE IT IS STILL BEING MADE. The caller
 *     knows which: it has just written a commit. So it waits rather than
 *     concluding.
 *
 * Six tries over about fifteen seconds. A publish that is going to work at
 * all works on the first or second; the rest is headroom for a slow morning
 * at GitHub, and costs nothing when it is not needed.
 */
async function headAfterBootstrap({
  owner, repo, branch, token, api, tries = 6, waitMs = 700, sleep = defaultSleep,
}) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const head = await headOf({ owner, repo, branch, token, api });
    if (head) return head;

    /* LINEAR, NOT EXPONENTIAL, and not because exponential is wrong — this
     * is a propagation delay of a second or two, not a service under load,
     * and doubling would spend most of the budget on the last two waits. */
    await sleep(waitMs * (attempt + 1));
  }

  /* STILL NOTHING. Falling through rather than throwing: the code below
   * handles a null head, and the ref write there now recovers from the
   * collision this would cause. Throwing here would turn a recoverable
   * publish into a failed one. */
  return null;
}

/**
 * Run an object-store call, waiting out a repository GitHub still calls empty.
 *
 * THE OTHER HALF OF THE RACE headAfterBootstrap() DOCUMENTS, and the half it
 * does not cover. Its own comment names both outcomes of giving up:
 *
 *     POST /git/refs   → 422 Reference already exists
 *     POST /git/blobs  → 409 Git Repository is empty.
 *
 * Falling through with a null head recovers the FIRST — the ref write below
 * catches "already exists" and moves the branch instead. Nothing recovered
 * the second. It walked straight into the blob upload, which is the one API
 * that cannot touch a repository GitHub still considers empty, and the
 * publish died there.
 *
 *     12 NOVEMBER. A repository deleted and immediately recreated under the
 *     same name is the slowest case there is for that propagation. The
 *     bootstrap's index.html was in place — the recovery push found it and
 *     reported "20 uploaded, 1 already there" — so the repository was never
 *     really empty. GitHub had simply not finished saying so.
 *
 * SO IT WAITS RATHER THAN CONCLUDING, which is the same sentence
 * headAfterBootstrap() is written around. We have just put a file in this
 * repository; "empty" is a stale answer, not a fact about it.
 *
 * MATCHED ON THE MESSAGE AS WELL AS THE STATUS. GitHub returns 409 for
 * unrelated conflicts too, and retrying one of those five times would turn a
 * clear refusal into a slow clear refusal.
 */
async function whenRepoIsReady(run, { tries = 5, waitMs = 1200, sleep = defaultSleep } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();

    } catch (err) {
      const notYet = 409 === (err && err.status)
        && /repository is empty/i.test((err && err.message) || '');

      if (!notYet || attempt >= tries) throw err;

      await sleep(waitMs * attempt);
    }
  }
}

/**
 * Commit a whole site to a branch, in one push.
 *
 * @param {object} opts
 * @param {string} opts.owner
 * @param {string} opts.repo
 * @param {string} opts.token      an installation token — see ./app.js
 * @param {object} opts.files      { 'index.html': '<!doctype…', 'assets/x.webp': <Buffer> }
 * @param {string} [opts.branch]   defaults to main
 * @param {string} [opts.message]
 * @param {Function} [opts.api]    injected HTTP, for the suite
 *
 * @returns {Promise<{commitSha, treeSha, branch, uploaded, reused, unchanged}>}
 *   `unchanged` is true when the site is byte-identical to what is already
 *   there and nothing was committed.
 */
async function commitSite({
  owner,
  repo,
  token,
  files = {},
  branch = 'main',
  message = 'Publish site',
  api = githubApi,

  /* INJECTED ONLY SO THE SUITE DOES NOT WAIT. The retry after a bootstrap
   * sleeps between attempts; a test that actually slept would add fifteen
   * seconds to the run and would be deleted by whoever noticed. */
  sleep,
} = {}) {
  if (!owner || !repo) {
    throw new Error('commitSite needs an owner and a repo.');
  }

  if (!token) {
    throw new Error(
      'commitSite needs an installation token. See installationToken() in '
      + 'utils/github/app.js — the App\'s own JWT cannot touch a repository.');
  }

  const paths = Object.keys(files);

  /* AN EMPTY SET IS REFUSED RATHER THAN COMMITTED. A tree with no entries is
   * a valid commit that deletes the entire site, and the one way to produce
   * it by accident is a renderer that returned nothing — which is a bug
   * upstream, not an instruction to empty the repository. */
  if (!paths.length) {
    throw new Error(
      'commitSite was given no files. Refusing: an empty tree would delete '
      + 'every page in the repository.');
  }

  let head = await headOf({ owner, repo, branch, token, api });

  /* AN EMPTY REPOSITORY CANNOT BE PUSHED TO UNTIL IT HAS A COMMIT. See
   * bootstrapEmpty() above for what GitHub answers and why this is not
   * optional. After it, the repository is ordinary and everything below
   * works as it does on any later publish. */
  let bootstrapped = false;

  if (!head) {
    await bootstrapEmpty({ owner, repo, branch, token, api, files });
    bootstrapped = true;

    head = await headAfterBootstrap({ owner, repo, branch, token, api, sleep });
  }

  /* ONLY ARMED ON A REPOSITORY WE JUST BOOTSTRAPPED.
   *
   * Everywhere else a 409 is a real conflict and should fail at once. It is
   * only here — on the one push that follows a first commit by milliseconds
   * — that "empty" can be a stale answer rather than the truth, because this
   * function is what made it untrue. */
  const settle = run => (bootstrapped ? whenRepoIsReady(run, { sleep }) : run());

  const already = await existingShas({
    owner, repo, treeSha: head && head.treeSha, token, api,
  });

  let uploaded = 0;
  let reused = 0;

  const tree = [];

  for (const path of paths) {
    const content = files[path];

    /* A FILE MAY BE GIVEN AS A SHA INSTEAD OF AS BYTES — added 30 October
     * for the editor.
     *
     * An edit re-renders the PAGES. It does not re-render the photographs
     * or the logo, and it cannot: the logo was an upload that is long gone
     * by the time somebody fixes a sentence six weeks later. But the tree
     * built here IS the site, so a publish that left those paths out would
     * delete them.
     *
     *     THE EDITOR KNOWS THE PAGES. THE REPOSITORY KNOWS THE PICTURES.
     *
     * So the caller carries those paths forward by the sha the repository
     * already holds — no download, no upload, no bytes crossing the wire for
     * a file nobody changed. See `keepOthers` in publishSite.js. */
    if (content && 'object' === typeof content && !Buffer.isBuffer(content) && content.sha) {
      reused += 1;
      tree.push({ path, mode: FILE_MODE, type: 'blob', sha: content.sha });
      continue;
    }

    const sha = blobSha(content);

    if (already.get(path) === sha) {
      /* THE SAME BYTES ARE ALREADY IN THE REPOSITORY under this exact sha,
       * so the tree can name it without uploading anything. */
      reused += 1;
      tree.push({ path, mode: FILE_MODE, type: 'blob', sha });
      continue;
    }

    const isBuffer = Buffer.isBuffer(content);

    const blob = await settle(() => api({
      method: 'POST',
      path: `/repos/${owner}/${repo}/git/blobs`,
      token,
      body: {
        /* BASE64 FOR BYTES, utf-8 FOR TEXT, and the distinction is not
         * cosmetic. A hero photograph sent as a utf-8 string is mangled by
         * the encoder into something that is still a valid file and is no
         * longer an image — a corruption that shows up as a broken picture
         * on a page that otherwise deploys perfectly. */
        content: isBuffer ? content.toString('base64') : String(content),
        encoding: isBuffer ? 'base64' : 'utf-8',
      },
    }));

    if (!blob || !blob.sha) {
      throw new Error(`GitHub did not return a blob sha for ${path}.`);
    }

    /* AND IT IS THE SHA GIT COMPUTED, not the one we did. They agree, and
     * the whole reuse path above depends on them agreeing — so if they ever
     * stop, this is where it should be noticed rather than three deploys
     * later when nothing is being reused. */
    if (blob.sha !== sha) {
      throw new Error(
        `GitHub named ${path} ${blob.sha}; git's own formula gives ${sha}. `
        + 'Something is encoding the content differently.');
    }

    uploaded += 1;
    tree.push({ path, mode: FILE_MODE, type: 'blob', sha });
  }

  /* NO base_tree. See the note at the top: this tree IS the site, so a page
   * that is no longer rendered is no longer in the repository. */
  const made = await settle(() => api({
    method: 'POST',
    path: `/repos/${owner}/${repo}/git/trees`,
    token,
    body: { tree },
  }));

  if (!made || !made.sha) {
    throw new Error('GitHub did not return a tree sha.');
  }

  /* NOTHING CHANGED, SO NOTHING IS COMMITTED.
   *
   * An identical tree means an identical site. Committing it anyway produces
   * an empty commit, which is not harmful and is not free: it is a line in
   * the history of every site saying a deploy happened and nothing came of
   * it, and on GitHub Pages it triggers a rebuild of a site that did not
   * change. */
  if (head && made.sha === head.treeSha) {
    return {
      commitSha: head.commitSha,
      treeSha: head.treeSha,
      branch,
      uploaded,
      reused,
      unchanged: true,
    };
  }

  const commit = await settle(() => api({
    method: 'POST',
    path: `/repos/${owner}/${repo}/git/commits`,
    token,
    body: {
      message,
      tree: made.sha,
      /* NO PARENT ON THE FIRST COMMIT. An empty repository has no history to
       * descend from, and sending `parents: [undefined]` is a 422. */
      parents: head ? [head.commitSha] : [],
    },
  }));

  if (!commit || !commit.sha) {
    throw new Error('GitHub did not return a commit sha.');
  }

  /* CREATE THE BRANCH, OR MOVE IT. A repository with no commits has no
   * branch either, so the first publish creates the ref and every one after
   * it updates the ref. The two are different endpoints and different verbs.
   *
   * AND NO force. Without it GitHub refuses when the branch has moved since
   * we read it, which is exactly the answer wanted: somebody else's commit
   * is not something a deploy should quietly discard. */
  if (head) {
    await api({
      method: 'PATCH',
      path: `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
      token,
      body: { sha: commit.sha },
    });
  } else {
    try {
      await api({
        method: 'POST',
        path: `/repos/${owner}/${repo}/git/refs`,
        token,
        body: { ref: `refs/heads/${branch}`, sha: commit.sha },
      });

    } catch (err) {
      /* THE BRANCH APPEARED WHILE WE WERE WORKING, which is the same race
       * headAfterBootstrap() exists to close and this is the second line of
       * defence for. `head` was null, so this took the create path; by the
       * time it ran, the bootstrap's ref had become readable and GitHub
       * refused with 422 "Reference already exists".
       *
       * MOVING IT IS THE RIGHT ANSWER, NOT FAILING. Our commit descends from
       * nothing, and the branch points at the bootstrap commit that holds
       * one file — the first page of the very site being published. There is
       * no work on that branch to lose.
       *
       * Matched on the message because GitHub's status for this is 422,
       * which it also uses for a dozen unrelated validation problems. */
      if (!/already exists/i.test(err && err.message || '')) throw err;

      await api({
        method: 'PATCH',
        path: `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
        token,
        body: { sha: commit.sha, force: true },
      });
    }
  }

  return {
    commitSha: commit.sha,
    treeSha: made.sha,
    branch,
    uploaded,
    reused,
    unchanged: false,
  };
}

module.exports = {
  headAfterBootstrap,
  whenRepoIsReady,
  blobSha,
  headOf,
  existingShas,
  bootstrapEmpty,
  commitSite,
  FILE_MODE,
};
