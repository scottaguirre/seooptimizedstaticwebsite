// utils/github/publishSite.js
//
// A built site, on the internet, without anybody pressing anything.
//
// WHAT THIS IS FOR — Edwin, 29 October: "is there any way that the sites
// generated with the mode local website options get pushed automatically
// without pressing any button. That way if the user click generate site he
// can go away to do something else and know that his site will be pushed
// automatically."
//
// So this is called by the job that writes the site, in the same job, right
// after the words are paid for. Four steps:
//
//     token      an installation token for this client's account
//     repo       found, or created — one repository per site
//     commit     the whole site, as one push        (./commit.js)
//     pages      turned on, so the site is actually visible
//
// IT ALSO ENDS THE "ONE SITE PER ACCOUNT" PROBLEM, which is the reason the
// design changed. dist/user_<id> is wiped by every build, so until now a
// customer's second site destroyed their first. Once the site lives in its
// own repository that folder is scratch: the second build can wipe it freely
// because the first site is already somewhere else, under its own name.
//
//     THE REPOSITORY NAME IS THE SITE'S IDENTITY.
//
// It comes from the business name, so building "Quality Plumbing Leander"
// twice updates one site rather than making two. Nothing has to remember a
// list — the client's GitHub account IS the list.
//
//   node test-github-publish.js

'use strict';

const { appJwt, installationToken, githubApi } = require('./app');
const { commitSite, existingShas, headOf } = require('./commit');

/* THE BRAND, FROM THE ONE PLACE THAT HOLDS IT. This file wrote "Three
 * Comets" by hand into the repository description, and test-brand-name.js
 * refused the deploy over it — correctly. The name appears in a description
 * a customer reads on their own GitHub account, which is exactly the kind of
 * place that gets missed when the product is renamed.
 *
 * pageTitle.js TAKES NO DEPENDENCIES, which is why every other corner of the
 * app can import it without dragging anything along. */
const { APP_NAME } = require('../pageTitle');

/** GitHub Pages serves from here unless told otherwise. */
const BRANCH = 'main';

/**
 * A repository name from a business name.
 *
 * LOWERCASE, HYPHENATED, AND IT ENDS UP IN THE URL. On the shape agreed on
 * 29 October the client's own domain covers every site they own and each one
 * is a path under it — acme.com/quality-plumbing/ — so this string is read
 * by customers, not just by git.
 *
 * TRUNCATED AT 90. GitHub allows 100; the margin is for a numeric suffix if
 * one is ever needed, added here rather than discovered at the point a name
 * is rejected.
 */
function repoNameFor(name) {
  const slug = String(name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90)
    .replace(/-+$/, '');

  if (!slug) {
    throw new Error(
      'The business name produced no usable repository name. A site needs a '
      + 'name with at least one letter or digit in it.');
  }

  return slug;
}

/**
 * Whose account this installation is on.
 *
 * ASKED WITH THE APP'S OWN JWT, not the installation token — the installation
 * does not know its own owner, and every repository call needs that login in
 * the path. One extra request per publish, and the alternative is storing the
 * login beside the installation id and watching it go stale the day somebody
 * renames their GitHub account.
 */
async function ownerOf({ installationId, appId, privateKey, now, api = githubApi } = {}) {
  const install = await api({
    method: 'GET',
    path: `/app/installations/${encodeURIComponent(installationId)}`,
    token: appJwt({ appId, privateKey, now }),
  });

  const login = install && install.account
    && (install.account.login || install.account.slug);

  if (!login) {
    throw new Error(
      `Installation ${installationId} named no account. The most likely cause `
      + 'is that the App was uninstalled.');
  }

  return login;
}

/**
 * The repository for this site, made if it is not there yet.
 *
 * PUBLIC BY DEFAULT, AND THAT IS A GITHUB RULE RATHER THAN A PREFERENCE.
 * Pages serves a private repository only on a paid plan; on a free account
 * it serves public repositories only. A private repo on a free account
 * produces a site that deploys perfectly and 404s, which is the worst way to
 * find out. Nothing in a generated site is secret — every word of it is on
 * the public pages — so public is also honest.
 *
 * FOUND BEFORE IT IS CREATED. Creating first and reading the error would
 * work, but "name already exists" and "you cannot create repositories" are
 * both 422s, and telling them apart by message text is the kind of rule that
 * breaks silently when GitHub rewords something.
 */
async function ensureRepo({
  owner, name, token, api = githubApi, isPrivate = false, description = '',
} = {}) {
  try {
    const found = await api({
      method: 'GET',
      path: `/repos/${owner}/${name}`,
      token,
    });

    return { repo: found, created: false };

  } catch (err) {
    if (404 !== err.status) throw err;
  }

  const made = await api({
    method: 'POST',
    path: '/user/repos',
    token,
    body: {
      name,
      private: isPrivate,

      /* NO auto_init. A README commit would be the branch's first commit,
       * and then the site's own first push has a parent it never saw and a
       * file nobody asked for sitting in the tree — which the no-base_tree
       * rule in commit.js would delete on the next publish anyway. An empty
       * repository is the clean start. */
      auto_init: false,
      description,
      has_issues: false,
      has_projects: false,
      has_wiki: false,
    },
  });

  if (!made || !made.name) {
    throw new Error(`GitHub did not create ${owner}/${name}.`);
  }

  return { repo: made, created: true };
}

/**
 * Turn Pages on, or leave it alone if it already is.
 *
 * ALREADY-ON IS NOT AN ERROR. GitHub answers 409 when Pages is already
 * configured, and every publish after the first would otherwise fail at the
 * last step of a deploy that had already succeeded.
 *
 * A FAILURE HERE DOES NOT UNDO THE PUSH, and must not be treated as if it
 * did. The site is committed by this point; Pages being off means it is not
 * yet visible, which is a thing to report and fix, not a reason to call the
 * build failed. The commonest cause is a private repository on a free
 * account, and the message says so rather than passing GitHub's own wording
 * through.
 */
async function enablePages({ owner, repo, branch = BRANCH, token, api = githubApi } = {}) {
  try {
    const pages = await api({
      method: 'POST',
      path: `/repos/${owner}/${repo}/pages`,
      token,
      body: { source: { branch, path: '/' } },
    });

    return { ok: true, url: (pages && pages.html_url) || '', already: false };

  } catch (err) {
    if (409 === err.status) {
      return { ok: true, url: '', already: true };
    }

    /* WHAT GITHUB SAID, THEN WHAT IT USUALLY MEANS — and in that order.
     *
     * This used to REPLACE GitHub's message with "a private repository on a
     * free account needs Pro", because that is the commonest cause. The
     * first real failure was a 403 on a PUBLIC repository, and the message
     * confidently explained a thing that was not happening — the third time
     * in one evening that a guess was printed where an answer belonged.
     *
     *     A GUESSED CAUSE READS EXACTLY LIKE A DIAGNOSED ONE.
     *     IT IS ONLY WRONG LATER, TO SOMEBODY WITH LESS CONTEXT.
     *
     * So the hint is still there — it is useful and it is usually right —
     * but it is marked as a hint and it comes after the facts. */
    /* THE ONE CAUSE WORTH NAMING, BECAUSE IT IS IN GITHUB'S DOCS AND NOT
     * DISCOVERABLE FROM THE MESSAGE. Creating a Pages site needs TWO
     * permissions — "Pages" write AND "Administration" write — and an App
     * holding only the first gets "Resource not accessible by integration",
     * which names neither. Checked against the REST documentation for
     * POST /repos/{owner}/{repo}/pages on 29 October, after three wrong
     * guesses in one evening. */
    const hint = 403 === err.status
      ? ' — creating a Pages site needs BOTH "Pages: write" AND '
        + '"Administration: write" on the installation. Granting only Pages '
        + 'produces exactly this error.'
      : '';

    return {
      ok: false,
      already: false,
      url: '',
      error: `${err.message} [${err.status || '?'} on ${err.path || 'the Pages endpoint'}]${hint}`,
    };
  }
}

/**
 * Everything, in order.
 *
 * @param {object} opts
 * @param {string|number} opts.installationId  the client's installation
 * @param {string} opts.businessName           becomes the repository name
 * @param {object} opts.files                  what renderSite() produced
 * @param {string} [opts.branch]
 * @param {string} [opts.message]              the commit message
 * @param {boolean} [opts.isPrivate]           see ensureRepo — rarely true
 * @param {Function} [opts.api]                injected HTTP, for the suite
 *
 * @returns {Promise<object>} what happened, in enough detail for a job log
 *
 * IT THROWS ONLY WHEN THE SITE DID NOT GET THERE. Pages failing to switch on
 * comes back in the answer rather than as an exception, because by then the
 * push has happened and the words have been paid for — and a job that threw
 * would report a failed build to a customer whose site is sitting complete
 * in a repository.
 */
async function publishSite({
  installationId,
  businessName,
  files,
  branch = BRANCH,
  message = '',
  isPrivate = false,

  /* KEEP WHAT THIS PUBLISH DOES NOT MENTION — for the editor, 30 October.
   *
   * A full build hands over the WHOLE site: pages, stylesheet, photographs,
   * logo, stored words. An EDIT hands over only what a re-render produces,
   * which is the pages and nothing else — and the tree built by commit.js
   * is the site, so publishing that alone would delete every picture.
   *
   * With this set, any path already in the repository that the caller did
   * not mention is carried forward by the sha the repository already holds.
   * Nothing is downloaded and nothing is uploaded for a file nobody
   * changed.
   *
   * OFF BY DEFAULT, AND THAT IS THE IMPORTANT HALF. A build must still be
   * able to DELETE a page it no longer renders — see the note at the top of
   * commit.js about what base_tree costs. This is the narrow exception for
   * a caller that knows it is only replacing part of a site. */
  keepOthers = false,

  appId,
  privateKey,
  now,
  api = githubApi,
} = {}) {
  if (!installationId) {
    throw new Error(
      'No GitHub installation for this account. The customer installs the App '
      + 'on their GitHub once, and the installation id is recorded against '
      + 'them; until then there is nowhere to publish to.');
  }

  const name = repoNameFor(businessName);

  const owner = await ownerOf({ installationId, appId, privateKey, now, api });

  const grant = await installationToken({ installationId, appId, privateKey, now, api });

  /* WHAT THE CLIENT ACTUALLY GRANTED, CHECKED BEFORE ANYTHING IS CREATED.
   * An installer can narrow the permissions the App asked for, and without
   * this the first sign of it is a 403 three calls into a publish — on an
   * endpoint whose name does not mention the permission that was missing. */
  if ('write' !== (grant.permissions || {}).contents) {
    throw new Error(
      `Installation ${installationId} did not grant write access to repository `
      + 'contents, so nothing can be pushed. It is changed on the installation, '
      + 'not on the App.');
  }

  const { repo, created } = await ensureRepo({
    owner,
    name,
    token: grant.token,
    api,
    isPrivate,
    description: `${businessName} — built by ${APP_NAME}.`.slice(0, 350),
  });

  /* THE PATHS THIS PUBLISH IS NOT REPLACING, named by sha. Read AFTER the
   * repository is known to exist and BEFORE the push, so a first publish —
   * where there is nothing to keep — simply finds an empty tree. */
  let sending = files;

  if (keepOthers) {
    const head = await headOf({ owner, repo: name, branch, token: grant.token, api });

    const already = await existingShas({
      owner, repo: name, treeSha: head && head.treeSha, token: grant.token, api,
    });

    const kept = {};

    for (const [path, sha] of already) {
      if (undefined === files[path]) kept[path] = { sha };
    }

    sending = { ...kept, ...files };
  }

  const pushed = await commitSite({
    owner,
    repo: name,
    token: grant.token,
    files: sending,
    branch,
    message: message || `Publish ${businessName}`,
    api,
  });

  /* PAGES AFTER THE PUSH, NEVER BEFORE IT. Switching Pages on for an empty
   * repository asks GitHub to serve a branch that does not exist yet, which
   * it refuses — so on a first publish the order is the difference between
   * working and not. */
  const pages = await enablePages({ owner, repo: name, branch, token: grant.token, api });

  return {
    owner,
    repo: name,
    created,
    repoUrl: repo.html_url || `https://github.com/${owner}/${name}`,

    /* WHERE IT WILL BE SERVED. Built rather than read back, because GitHub
     * returns the Pages URL only on the call that creates it — on every
     * later publish `already` is true and there is nothing to read. */
    pagesUrl: pages.url || `https://${owner}.github.io/${name}/`,

    commitSha: pushed.commitSha,
    unchanged: pushed.unchanged,
    uploaded: pushed.uploaded,
    reused: pushed.reused,

    pages: {
      ok: pages.ok,
      already: pages.already,
      error: pages.error || '',
    },
  };
}

module.exports = {
  publishSite,
  repoNameFor,
  ownerOf,
  ensureRepo,
  enablePages,
  BRANCH,
};
