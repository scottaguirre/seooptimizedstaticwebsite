// utils/github/adoptSites.js
//
// Finding published sites the app has no record of.
//
// WHY — Edwin, 30 October: "the chicago plumber is not showing on local and
// it's still live and I want to keep it."
//
// A build writes its pointer row into WHATEVER DATABASE IT RAN AGAINST. Build
// on a laptop and the row is on the laptop; the live app has never heard of
// the site. Same for a site published before GeneratedSite existed, and for
// one pushed by hand with tools/github-push.js. In every case the site is on
// the internet, correct and serving, and My Sites says "nothing published
// yet".
//
//     THE REPOSITORY IS THE SITE. THE ROW IS ONLY A POINTER.
//     A LOST POINTER IS NOT A LOST SITE, AND MUST NOT BE TREATED AS ONE.
//
// So this walks the client's GitHub account and rebuilds the pointers from
// what is actually there. Every Local Website Options build carries
// _src/localoptions.json up with its pages, which is what makes a generated
// site recognisable: the file is the evidence, and a repository without one
// is somebody else's repository and is left alone.
//
// THIS IS RECOVERY, NOT A FEATURE THE PRODUCT LEANS ON. A publish records its
// own row; nothing should routinely need adopting. It exists because the
// alternative — a live site nobody can edit or delete from the app — is the
// state this screen was built to end.
//
//   node test-github-adopt.js

'use strict';

const { installationToken, githubApi } = require('./app');
const { ownerOf } = require('./publishSite');
const { isRootSite } = require('./deleteSite');
const { SOURCE_PATH } = require('./siteSource');

/** GitHub's maximum, so the common case is one request. */
const PER_PAGE = 100;

/**
 * Every repository this installation can see.
 *
 * PAGED TO EXHAUSTION RATHER THAN ONE REQUEST. A client with more than a
 * hundred repositories is unlikely and is exactly the client whose oldest
 * site would silently never be adopted — and "it found most of them" is a
 * worse answer than either finding them all or saying it could not.
 *
 * THE CAP IS THERE SO A WRONG ANSWER CANNOT LOOP FOR EVER. A `total_count`
 * that never agrees with what comes back would otherwise page until the
 * request timed out.
 */
async function allRepos({ token, api = githubApi, maxPages = 20 } = {}) {
  const out = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const answer = await api({
      method: 'GET',
      path: `/installation/repositories?per_page=${PER_PAGE}&page=${page}`,
      token,
    });

    const batch = (answer && answer.repositories) || [];

    out.push(...batch);

    if (batch.length < PER_PAGE) break;
  }

  return out;
}

/**
 * The stored source in one repository, or null if it is not one of ours.
 *
 * A 404 IS THE ORDINARY ANSWER, not an error. Most repositories on a
 * client's account were not made by this app, and asking is how we find out.
 */
async function sourceIn({ owner, repo, token, api = githubApi } = {}) {
  let answer;

  try {
    answer = await api({
      method: 'GET',
      path: `/repos/${owner}/${repo}/contents/${SOURCE_PATH}`,
      token,
    });
  } catch (err) {
    if (404 === err.status) return null;
    throw err;
  }

  if (!answer || !answer.content) return null;

  try {
    const raw = Buffer.from(answer.content, answer.encoding || 'base64').toString('utf8');
    const parsed = JSON.parse(raw);

    /* VERSION 1 ONLY, THE SAME RULE readSiteSource() APPLIES. Adopting a
     * source this app cannot render would put a row in the list whose Edit
     * button throws — a pointer to a site that cannot be edited is the
     * problem this file exists to fix, not a smaller version of it. */
    if (!parsed || 1 !== parsed.version) return null;

    return parsed;

  } catch (_) {
    /* Edited by hand, or written by something else. Not ours. */
    return null;
  }
}

/**
 * Every generated site on one installation.
 *
 * @param {object} opts
 * @param {string|number} opts.installationId
 * @param {Function} [opts.api]
 *
 * @returns {Promise<{owner: string, sites: Array, scanned: number}>}
 *
 * ONE REQUEST PER REPOSITORY, which is why this is a button and not something
 * that runs on every page load. A client with thirty repositories costs
 * thirty-one calls; an installation token allows 5,000 an hour.
 */
async function findSites({
  installationId, owner, appId, privateKey, now, api = githubApi,
} = {}) {
  if (!installationId) {
    throw new Error('findSites needs an installation.');
  }

  const grant = await installationToken({ installationId, appId, privateKey, now, api });

  const login = owner
    || await ownerOf({ installationId, appId, privateKey, now, api });

  const repos = await allRepos({ token: grant.token, api });

  const sites = [];

  for (const repo of repos) {
    const name = repo && repo.name;
    if (!name) continue;

    /* THE ROOT PAGES SITE IS NOT A GENERATED SITE. It holds the custom
     * domain and the CNAME and nothing else; adopting it would put the
     * domain itself in somebody's list behind a Delete button. */
    if (isRootSite(name)) continue;

    const source = await sourceIn({ owner: login, repo: name, token: grant.token, api });
    if (!source) continue;

    const business = source.business || {};

    sites.push({
      owner: login,
      repo: name,
      businessName: business.name || '',
      trade: business.trade || '',

      /* WHEN GITHUB LAST SAW A PUSH, because the row's own publishedAt is
       * what the list sorts by and this is the only honest value available
       * — the source file does not record when it was published. */
      publishedAt: repo.pushed_at ? new Date(repo.pushed_at) : null,
    });
  }

  return { owner: login, sites, scanned: repos.length };
}

module.exports = { findSites, allRepos, sourceIn, PER_PAGE };
