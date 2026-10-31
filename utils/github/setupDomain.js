// utils/github/setupDomain.js
//
// Getting a client's GitHub account ready to serve a domain.
//
// WHY — Edwin, 30 October: "Automate the per-client GitHub setup — creating
// the root <login>.github.io repo, turning Pages on, setting the custom
// domain. Three manual steps today, and deleting the wrong one took 7-y.xyz
// down."
//
// THE THREE STEPS WERE DONE BY HAND, ON GITHUB.COM, ONCE PER CLIENT. That is
// three chances to miss one and a fourth to do the wrong thing to the right
// repository — which is exactly what happened on 29 October: the repository
// deleted was `<login>.github.io` rather than the test project beneath it,
// and every site on the domain went down at once.
//
//     A STEP DONE BY HAND ONCE PER CLIENT IS A STEP DONE WRONG
//     ONCE PER HOWEVER MANY CLIENTS IT TAKES.
//
// WHAT THIS CAN DO, AND WHAT IT CANNOT
//
//   it can      create the root repository, give it a holding page, turn
//               Pages on, set the custom domain, and tick Enforce HTTPS
//               once GitHub has issued the certificate
//   it cannot   install the App on the client's account — that produces the
//               installation id this is given, so it has already happened
//   it cannot   touch DNS. The A records live at whoever the domain was
//               registered with, and GitHub has no say in them. So the
//               answer carries the records that have to be set, rather than
//               pretending the job is finished.
//
// IT IS SAFE TO PRESS TWICE. A repository that exists is found, Pages that
// is on answers 409, and a custom domain already set is set again to the
// same value. Nothing here deletes anything, and the one repository that
// must never be deleted is the one it creates.
//
//   node test-github-setup.js

'use strict';

const { installationToken, githubApi } = require('./app');
const { ownerOf, ensureRepo, enablePages, BRANCH } = require('./publishSite');
const { headOf } = require('./commit');
const { APP_NAME } = require('../pageTitle');

/**
 * The DNS records a domain needs, which this cannot set.
 *
 * FROM GITHUB'S OWN DOCUMENTATION, checked 30 October against
 * docs.github.com "Managing a custom domain for your GitHub Pages site".
 * Written down here rather than linked, because a client sets these at a
 * registrar while reading a screen in this app, and a list that is one
 * click away is a list half of them will guess at.
 *
 * THE AAAA RECORDS ARE OPTIONAL AND THE A RECORDS ARE NOT. GitHub's own
 * advice is to set the A records whatever else is done, because IPv6-only
 * resolvers are still rare.
 */
const APEX_A = [
  '185.199.108.153',
  '185.199.109.153',
  '185.199.110.153',
  '185.199.111.153',
];

const APEX_AAAA = [
  '2606:50c0:8000::153',
  '2606:50c0:8001::153',
  '2606:50c0:8002::153',
  '2606:50c0:8003::153',
];

/** `<login>.github.io` — the root Pages site, lowercased as GitHub stores it. */
function rootRepoFor(login) {
  return `${String(login || '').trim().toLowerCase()}.github.io`;
}

/**
 * The holding page, for a root repository that has nothing in it.
 *
 * IT NAMES THE DOMAIN AND NOTHING ELSE, AND IT IS noindex.
 *
 * THE ONE THING IT MUST NEVER DO IS LIST THE SITES BENEATH IT. Every client
 * on a domain would then be able to read off the others — a competitor list
 * published by the person they are paying — and nobody asked for the apex to
 * be a directory.
 *
 * WRITTEN ONLY WHEN THE REPOSITORY IS EMPTY. 7-y.xyz already has a page on
 * it, put there by hand, and a setup that overwrote it would be a button
 * that quietly replaces work somebody did.
 */
function holdingPage(domain) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${String(domain || '').trim()}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;
    background:#f3f5f8;color:#5a6675;
    font:16px/1.6 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
</style>
</head>
<body>
<p>${String(domain || '').trim()}</p>
</body>
</html>
`;
}

/**
 * Put a file in a repository through the contents API.
 *
 * THE CONTENTS API, NOT THE GIT DATA API, for the reason bootstrapEmpty() in
 * commit.js records: on a repository with no commits every Git Data endpoint
 * answers 409, and this is the only one that works.
 */
async function putFile({ owner, repo, path, content, message, token, api = githubApi, sha }) {
  return api({
    method: 'PUT',
    path: `/repos/${owner}/${repo}/contents/${path}`,
    token,
    body: {
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    },
  });
}

/**
 * Point the root Pages site at the custom domain.
 *
 * PUT /repos/{owner}/{repo}/pages WITH A cname, which is what GitHub's own
 * settings page does — it writes the CNAME file for us. Setting it again to
 * the same value is not an error, which is what makes the whole of this
 * safe to press twice.
 *
 * A 4xx COMES BACK AS A REPORTED FAILURE, NOT A THROW. By the time this runs
 * the repository exists and Pages is on; the domain not being attached is a
 * thing to fix and show, not a reason to call the setup failed and leave
 * somebody wondering what did happen.
 */
async function setCustomDomain({ owner, repo, domain, token, api = githubApi } = {}) {
  try {
    await api({
      method: 'PUT',
      path: `/repos/${owner}/${repo}/pages`,
      token,
      body: { cname: domain },
    });

    return { ok: true, domain };

  } catch (err) {
    /* THE COMMONEST REAL CAUSE IS DNS, AND IT IS WORTH NAMING. GitHub
     * refuses a domain it cannot verify, and the A records are at a
     * registrar this app has never heard of. */
    const hint = 400 === err.status || 422 === err.status
      ? ' — GitHub usually refuses a domain whose DNS does not point at it '
        + 'yet. Set the records below, wait for them to resolve, and press '
        + 'this again.'
      : '';

    return {
      ok: false,
      domain,
      error: `${err.message} [${err.status || '?'} on ${err.path || 'the Pages endpoint'}]${hint}`,
    };
  }
}

/**
 * Tick "Enforce HTTPS", once there is a certificate to enforce with.
 *
 * WHY THIS IS A SEPARATE CALL AND NOT PART OF setCustomDomain(). GitHub
 * issues the certificate itself, minutes to an hour after the domain's DNS
 * begins answering — so at the moment a domain is first attached there is
 * never a certificate yet, and asking for https_enforced then is asking for
 * a thing that cannot be granted. GitHub's own settings page greys the
 * checkbox out for exactly as long.
 *
 *     A SETTING THAT CANNOT BE SET YET IS NOT A SETTING THAT FAILED.
 *
 * So this reports where the certificate is and changes nothing until the
 * state is `approved` — which is what keeps the whole setup safe to press
 * twice, because pressing it again IS how the certificate gets ticked.
 *
 * ONLY `approved` COUNTS AS READY. GitHub publishes a good dozen other
 * states and documents none of them, so "not approved" is read as "not
 * yet" rather than as a list of known-bad values — the reading that still
 * works when they add a thirteenth. Whatever state came back is passed
 * through word for word rather than translated, so a state nobody here
 * anticipated still reaches the screen instead of being flattened into a
 * guess.
 *
 * THE cname GOES BACK WITH IT. The endpoint is a partial update and an
 * omitted field is meant to be left alone, but the field being omitted here
 * is the one whose loss takes every site on the domain down — so it is sent
 * again, set to what it already is, rather than trusted to survive.
 *
 * Checked against docs.github.com, "REST API endpoints for GitHub Pages",
 * on 31 October: PUT takes `https_enforced`, and GET returns it alongside
 * `https_certificate.state`.
 */
async function enforceHttps({ owner, repo, domain, token, api = githubApi } = {}) {
  let site;

  try {
    site = await api({
      method: 'GET',
      path: `/repos/${owner}/${repo}/pages`,
      token,
    });

  } catch (err) {
    return {
      ok: false,
      already: false,
      state: '',
      note: `Could not read the Pages settings [${err.status || '?'}]: ${err.message}`,
    };
  }

  const cert = (site && site.https_certificate) || {};
  const state = String(cert.state || '').trim();

  if (site && true === site.https_enforced) {
    return { ok: true, already: true, state, note: '' };
  }

  if ('approved' !== state) {
    return {
      ok: false,
      already: false,
      state,
      note: state
        ? `The certificate is not ready — GitHub calls it "${state}". It is `
          + 'usually issued within an hour of the DNS answering. Press this '
          + 'again then.'
        : 'GitHub has not begun issuing a certificate. That starts once the '
          + 'DNS records resolve. Press this again in a few minutes.',
    };
  }

  try {
    await api({
      method: 'PUT',
      path: `/repos/${owner}/${repo}/pages`,
      token,
      body: { cname: domain, https_enforced: true },
    });

    return { ok: true, already: false, state, note: '' };

  } catch (err) {
    return {
      ok: false,
      already: false,
      state,
      note: `GitHub refused it [${err.status || '?'}]: ${err.message}`,
    };
  }
}

/**
 * Everything, in order, for one domain.
 *
 * @param {object} opts
 * @param {string|number} opts.installationId  the client's installation
 * @param {string} opts.domain                 acme.com, no scheme
 * @param {Function} [opts.api]
 *
 * @returns {Promise<object>} what happened at each step, and the DNS records
 *
 * IT THROWS ONLY WHEN IT CANNOT START. A missing installation or a
 * permission the client did not grant is a refusal before anything is
 * created. Everything after the repository exists is reported rather than
 * thrown, because a half-finished account is a thing somebody has to see.
 */
async function setupDomain({
  installationId, domain, appId, privateKey, now, api = githubApi,
} = {}) {
  const want = String(domain || '').trim().toLowerCase();

  if (!installationId || !want) {
    throw new Error('setupDomain needs an installation and a domain.');
  }

  const grant = await installationToken({ installationId, appId, privateKey, now, api });

  /* WHAT THE CLIENT ACTUALLY GRANTED, NAMED BEFORE ANYTHING IS CREATED.
   * An installer can narrow the permissions the App asked for, and without
   * this the first sign is a 403 three calls in, on an endpoint whose name
   * does not mention the permission that was missing. */
  const permissions = grant.permissions || {};

  const missing = ['contents', 'administration', 'pages']
    .filter(key => 'write' !== permissions[key]);

  if (missing.length) {
    throw new Error(
      `Installation ${installationId} does not grant write access to `
      + `${missing.join(', ')}. Creating a repository needs Administration, `
      + 'putting a page in it needs Contents, and turning Pages on needs '
      + 'both Pages and Administration. It is changed on the installation, '
      + 'not on the App.');
  }

  const owner = await ownerOf({ installationId, appId, privateKey, now, api });
  const repo = rootRepoFor(owner);

  const { created } = await ensureRepo({
    owner,
    name: repo,
    token: grant.token,
    api,
    isPrivate: false,
    description: `${want} — served by ${APP_NAME}.`.slice(0, 350),
  });

  /* A HOLDING PAGE ONLY IF THERE IS NOTHING THERE.
   *
   * headOf() treats both 404 and 409 as empty — a repository with no
   * commits answers 409, which is not what anybody guesses. An existing
   * root page is left exactly as it is: 7-y.xyz has one, put there by
   * hand, and a button that quietly replaced it would be worse than a
   * button that does nothing. */
  const head = await headOf({ owner, repo, branch: BRANCH, token: grant.token, api });

  let page = 'kept';

  if (!head) {
    await putFile({
      owner,
      repo,
      path: 'index.html',
      content: holdingPage(want),
      message: `Hold ${want}`,
      token: grant.token,
      api,
    });

    page = 'created';
  }

  /* PAGES AFTER THERE IS SOMETHING TO SERVE. Switching it on for an empty
   * repository asks GitHub to serve a branch that does not exist, which it
   * refuses — the same ordering publishSite() learned. */
  const pages = await enablePages({ owner, repo, branch: BRANCH, token: grant.token, api });

  const custom = await setCustomDomain({ owner, repo, domain: want, token: grant.token, api });

  /* HTTPS LAST, AND ONLY WHEN THERE IS A CUSTOM DOMAIN TO SECURE.
   *
   * A cname that did not take leaves the site on `<login>.github.io`, which
   * GitHub already serves over HTTPS with its own certificate — there is
   * nothing to tick and no certificate to wait for, so saying "not yet"
   * would describe a wait that is not happening. */
  const https = custom.ok
    ? await enforceHttps({ owner, repo, domain: want, token: grant.token, api })
    : {
      ok: false,
      already: false,
      state: '',
      note: 'Skipped — there is no custom domain on the site to secure.',
    };

  return {
    owner,
    repo,
    domain: want,
    created,
    page,
    pages: { ok: pages.ok, already: pages.already, error: pages.error || '' },
    custom,
    https,

    /* THE PART NOBODY HERE CAN DO. Carried back with everything else so the
     * screen can show the whole job rather than the half of it that was
     * automatable. */
    dns: {
      apex: { type: 'A', host: '@', values: APEX_A },
      apexIpv6: { type: 'AAAA', host: '@', values: APEX_AAAA },
      www: { type: 'CNAME', host: 'www', value: `${owner}.github.io` },
    },
  };
}

module.exports = {
  setupDomain,
  rootRepoFor,
  holdingPage,
  setCustomDomain,
  enforceHttps,
  APEX_A,
  APEX_AAAA,
};
