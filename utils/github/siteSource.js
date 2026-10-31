// utils/github/siteSource.js
//
// A published site's own words, read back out of its repository.
//
// WHY THE REPOSITORY AND NOT THE SERVER — Edwin, 29 October, on editing a
// live site: "every owner of the site and only the owner of the site will be
// able to edit the site nobody else."
//
// dist/user_<id> holds ONE site and is wiped by the next build, so the
// server cannot answer "what does the site I made last month say?" for any
// site but the most recent. The repository can, for all of them: every
// publish carries _src/localoptions.json up with the pages.
//
//     THE SERVER REMEMBERS THE LAST BUILD. THE REPOSITORY REMEMBERS THE
//     SITE. EDITING IS A QUESTION ABOUT THE SITE.
//
// THE CONTENTS API, NOT THE GIT DATA API. One call by path, and it is also
// the only one of the two that works on a repository with no commits — see
// bootstrapEmpty() in commit.js. The Git Data API would need the ref, the
// commit, the tree and then the blob: four calls to read one file.

'use strict';

const { installationToken, githubApi } = require('./app');
const { ownerOf } = require('./publishSite');

/** Where every Local Website Options build stores what it was built from. */
const SOURCE_PATH = '_src/localoptions.json';

/**
 * The stored source for one published site.
 *
 * @param {object} opts
 * @param {string|number} opts.installationId
 * @param {string} opts.repo
 * @param {string} [opts.owner]   saved a call when the caller already knows it
 * @param {Function} [opts.api]
 *
 * @returns {Promise<{source: object, owner: string, token: string}>}
 *
 * THE TOKEN COMES BACK WITH IT, because the caller that reads a site is
 * almost always about to write it, and minting a second one a moment later
 * is a second round trip for a credential that lasts an hour.
 */
async function readSiteSource({
  installationId, repo, owner, appId, privateKey, now, api = githubApi,
} = {}) {
  if (!installationId || !repo) {
    throw new Error('readSiteSource needs an installation and a repository.');
  }

  const grant = await installationToken({ installationId, appId, privateKey, now, api });

  const login = owner
    || await ownerOf({ installationId, appId, privateKey, now, api });

  let answer;

  try {
    answer = await api({
      method: 'GET',
      path: `/repos/${login}/${repo}/contents/${SOURCE_PATH}`,
      token: grant.token,
    });

  } catch (err) {
    if (404 === err.status) {
      throw new Error(
        `${login}/${repo} has no ${SOURCE_PATH}. Either it is not a Local `
        + 'Website Options site, or it was built before the source file was '
        + 'published with it — and without those words the pages cannot be '
        + 're-rendered, only rebuilt.');
    }

    throw err;
  }

  if (!answer || !answer.content) {
    throw new Error(`GitHub returned no content for ${SOURCE_PATH}.`);
  }

  /* BASE64, ALWAYS, whatever the file holds. The contents API encodes it
   * that way even for text, which is why this cannot just read `content`. */
  const raw = Buffer.from(answer.content, answer.encoding || 'base64').toString('utf8');

  let source;

  try {
    source = JSON.parse(raw);
  } catch (_) {
    throw new Error(
      `${SOURCE_PATH} in ${login}/${repo} is not readable JSON. It has been `
      + 'edited by hand, or something other than this app wrote it.');
  }

  if (1 !== source.version) {
    throw new Error(
      `${SOURCE_PATH} is version ${source.version}; this app understands 1. `
      + 'Re-rendering it would produce a site that differs from the one that '
      + 'was paid for, in ways nothing here can predict.');
  }

  /* JSON HAS NO Date, AND renderSite READS `now` AS ONE — it sets the footer
   * year and the sitemap's lastmod. Left as a string both come out as
   * "Invalid Date", on every page, with nothing thrown. */
  source.now = new Date(source.now);

  return { source, owner: login, token: grant.token };
}

module.exports = { readSiteSource, SOURCE_PATH };
