// utils/github/deleteSite.js
//
// Taking a site off the internet.
//
// WHY — Edwin, 30 October, after a test build: "first, I will delete the
// latest site I built. That was just for testing purposes." A mode that
// publishes automatically produces test sites automatically, and until now
// the only way to remove one was github.com and a form.
//
// AND THAT IS EXACTLY HOW THE DOMAIN WENT DOWN. On 29 October the repository
// deleted by hand was `<login>.github.io` — the ROOT site, the one that owns
// the custom domain — rather than the test project under it. Every site on
// 7-y.xyz went with it, and it had to be recreated and re-pointed.
//
//     THE ROOT REPOSITORY IS NOT A SITE. IT IS THE DOMAIN.
//
// So refuseRoot() below is not defensive tidiness; it is the one mistake this
// file exists to make impossible. Nothing in the app ever has a reason to
// delete `<login>.github.io`, and a delete button that *could* is a delete
// button that eventually will.
//
// WHAT DELETE MEANS HERE. The repository is the site AND the only copy of its
// source — _src/localoptions.json lives in it and nowhere else, because
// dist/user_<id> is wiped by the next build. There is no undo and there is no
// second copy. The route above this one asks the owner to type the business
// name for that reason.
//
//   node test-github-publish.js

'use strict';

const { installationToken, githubApi } = require('./app');
const { ownerOf } = require('./publishSite');

/**
 * A repository this app must never delete.
 *
 * `<login>.github.io` is GitHub's name for a user's ROOT Pages site. It is
 * what the custom domain's CNAME file sits in, and every project site is
 * served as a path beneath it — acme.com/quality-plumbing/ is the project
 * repo `quality-plumbing` served through the root. Delete the root and every
 * path 404s at once, which is not a thing to learn from a customer.
 *
 * MATCHED ON THE SUFFIX, NOT ON `${owner}.github.io`. A renamed GitHub
 * account leaves a root repository whose name no longer matches its owner's
 * login, and the match that used the login would wave it through.
 */
function isRootSite(repo) {
  return /\.github\.io$/i.test(String(repo || '').trim());
}

function refuseRoot(repo) {
  if (!isRootSite(repo)) return;

  throw new Error(
    `${repo} is the account's root Pages site, not a generated site. It holds `
    + 'the custom domain, and every site published under that domain is served '
    + 'through it — deleting it takes all of them down at once. Nothing in this '
    + 'app ever needs to delete it.');
}

/**
 * Delete one generated site's repository.
 *
 * @param {object} opts
 * @param {string|number} opts.installationId
 * @param {string} opts.repo
 * @param {string} [opts.owner]   saved a call when the caller already knows it
 * @param {Function} [opts.api]
 *
 * @returns {Promise<{ok: true, owner: string, repo: string, already: boolean}>}
 *
 * ALREADY GONE IS SUCCESS. GitHub answers 404 for a repository that is not
 * there, and the caller's goal — "this site should not exist" — is met either
 * way. Treating it as an error would strand the pointer row for any site
 * somebody had already deleted by hand on github.com, which is precisely the
 * state tonight's testing produced.
 */
async function deleteSite({
  installationId, repo, owner, appId, privateKey, now, api = githubApi,
} = {}) {
  if (!installationId || !repo) {
    throw new Error('deleteSite needs an installation and a repository.');
  }

  /* CHECKED BEFORE THE TOKEN IS EVEN MINTED. The refusal is about the NAME,
   * so there is no reason for a request to GitHub to happen first — and a
   * guard that runs after two round trips is a guard somebody is tempted to
   * move "just past the network bit" one day. */
  refuseRoot(repo);

  const grant = await installationToken({ installationId, appId, privateKey, now, api });

  /* THE PERMISSION, NAMED, BEFORE THE ATTEMPT. Deleting a repository needs
   * "Administration: write" — the same permission creating a Pages site
   * needs, and the one that produced an unexplained 403 on 29 October.
   * GitHub's refusal is "Resource not accessible by integration", which
   * names neither the permission nor the endpoint. */
  if ('write' !== (grant.permissions || {}).administration) {
    throw new Error(
      `Installation ${installationId} does not grant "Administration: write", `
      + 'which is what deleting a repository needs. It is changed on the '
      + 'installation, not on the App.');
  }

  const login = owner
    || await ownerOf({ installationId, appId, privateKey, now, api });

  try {
    await api({
      method: 'DELETE',
      path: `/repos/${login}/${repo}`,
      token: grant.token,
    });

    return { ok: true, owner: login, repo, already: false };

  } catch (err) {
    if (404 === err.status) {
      return { ok: true, owner: login, repo, already: true };
    }

    if (403 === err.status) {
      throw new Error(
        `${err.message} [403 on ${err.path || `/repos/${login}/${repo}`}] — `
        + 'deleting a repository needs "Administration: write" on the '
        + 'installation.');
    }

    throw err;
  }
}

module.exports = { deleteSite, isRootSite, refuseRoot };
