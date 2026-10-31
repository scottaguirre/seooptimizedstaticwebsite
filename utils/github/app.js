// utils/github/app.js
//
// Proving we are the App, and getting a token for one installation.
//
// THE SHAPE, AND WHY IT IS TWO STEPS
//
// A GitHub App never holds a password. It holds a PRIVATE KEY, and it proves
// itself by signing a short-lived JWT with it. That JWT is only good for
// asking GitHub about the App itself — it cannot touch a repository.
//
// To do anything useful it is exchanged for an INSTALLATION TOKEN: a
// credential scoped to one client's account, valid for an hour, that can only
// reach what that client granted when they pressed Install.
//
//     private key  --sign-->  JWT (10 min, about the App)
//     JWT          --POST-->  installation token (1 hour, about one client)
//
// WHY THIS IS BETTER THAN THE CLOUDFLARE POOL, which is the thing it will sit
// beside: we never hold a client's long-lived credential. CloudflareAccount
// stores a token Edwin pasted, sealed but permanent until someone rotates it.
// Here the only durable secret is OURS, and every client credential expires
// within the hour whether anyone notices or not.
//
// THE PRIVATE KEY IS THE WHOLE ESTATE. One file that can mint a token for
// every client who ever installed the App. It belongs in .env on the server,
// set by Edwin, exactly like CF_TOKEN_KEY — never pasted into a session,
// never committed, never logged. Nothing in this file prints it, and the
// error messages below are deliberately written to describe the key without
// quoting it.
//
//   node test-github-app.js

'use strict';

const crypto = require('crypto');

/** Where the App's own credentials live. */
const APP_ID = process.env.GITHUB_APP_ID || '';
const APP_KEY = process.env.GITHUB_APP_KEY || '';

/**
 * How long the App's own JWT is good for.
 *
 * GitHub rejects anything over ten minutes. NINE is used rather than ten so
 * a clock a little fast on our side does not produce a token GitHub reads as
 * already expired — the failure for which is a 401 that says nothing about
 * clocks.
 */
const JWT_SECONDS = 9 * 60;

/**
 * How far back to date it.
 *
 * SIXTY SECONDS, FOR THE SAME REASON IN THE OTHER DIRECTION. A clock a
 * little SLOW on our side produces an `iat` in GitHub's future, which it
 * also rejects. Both margins are GitHub's own documented advice.
 */
const CLOCK_SKEW_SECONDS = 60;

/** base64url, which is base64 with three substitutions and no padding. */
function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * The App's own JWT, signed RS256 with its private key.
 *
 * BUILT BY HAND RATHER THAN WITH A LIBRARY. It is three base64url segments
 * and one signature; `jsonwebtoken` would be a dependency, a supply-chain
 * surface and a version to track, for about fifteen lines. node's crypto
 * signs RS256 directly.
 *
 * @param {object} [opts]
 * @param {string} [opts.appId]       defaults to GITHUB_APP_ID
 * @param {string} [opts.privateKey]  defaults to GITHUB_APP_KEY
 * @param {Date}   [opts.now]         injected, so the suite is not racing a clock
 */
function appJwt({ appId = APP_ID, privateKey = APP_KEY, now = new Date() } = {}) {
  if (!appId) {
    throw new Error(
      'GITHUB_APP_ID is not set. It is the numeric id shown on the App\'s '
      + 'settings page on github.com, and it is not a secret.');
  }

  if (!privateKey) {
    /* NAMED, NOT QUOTED. This message is written to a log. */
    throw new Error(
      'GITHUB_APP_KEY is not set. It is the contents of the .pem file GitHub '
      + 'gave you when you generated a private key for the App. Set it in '
      + '.env on the server; it must never be committed or pasted anywhere.');
  }

  const issued = Math.floor(now.getTime() / 1000) - CLOCK_SKEW_SECONDS;

  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iat: issued,
    exp: issued + JWT_SECONDS,
    iss: String(appId),
  }));

  const body = `${header}.${payload}`;

  let signature;

  try {
    signature = crypto.sign('RSA-SHA256', Buffer.from(body), normaliseKey(privateKey));
  } catch (err) {
    /* THE ORIGINAL ERROR IS NOT PASSED THROUGH. node's crypto errors for a
     * malformed key are unhelpful ("error:1E08010C:DECODER routines") and
     * some of them echo part of the input. Neither belongs in a log. */
    throw new Error(
      'GITHUB_APP_KEY is not a usable RSA private key. It should be the whole '
      + '.pem file including the BEGIN and END lines. If it is in .env on one '
      + 'line, the newlines must be written as \\n.');
  }

  return `${body}.${b64url(signature)}`;
}

/**
 * A .pem whose newlines survived .env.
 *
 * A PEM IS MULTI-LINE AND .env IS NOT. Every way of getting one into an
 * environment variable mangles it somehow, and the two that actually happen
 * are: the literal two characters `\n` instead of a newline, and the whole
 * thing wrapped in quotes. Both are fixed here rather than in the
 * instructions, because the instructions are read once and this runs every
 * time.
 */
function normaliseKey(key) {
  return String(key)
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\n/g, '\n');
}

/**
 * Exchange the App's JWT for a token scoped to one installation.
 *
 * @param {object}   opts
 * @param {string|number} opts.installationId
 * @param {Function} [opts.api]  injected HTTP, for the suite
 * @returns {Promise<{token: string, expiresAt: Date, permissions: object}>}
 */
async function installationToken({
  installationId,
  appId = APP_ID,
  privateKey = APP_KEY,
  now = new Date(),
  api = githubApi,
} = {}) {
  const id = String(installationId == null ? '' : installationId).trim();

  if (!id) {
    throw new Error(
      'No installation id. It is recorded when the client installs the App, '
      + 'and without it there is no way to know whose account to act on.');
  }

  const answer = await api({
    method: 'POST',
    path: `/app/installations/${encodeURIComponent(id)}/access_tokens`,
    token: appJwt({ appId, privateKey, now }),
  });

  if (!answer || !answer.token) {
    throw new Error(
      `GitHub did not return a token for installation ${id}. `
      + 'The most likely cause is that the client has uninstalled the App.');
  }

  return {
    token: answer.token,
    expiresAt: new Date(answer.expires_at),

    /* WHAT THE CLIENT ACTUALLY GRANTED, which is not necessarily what the
     * App asked for: GitHub lets an installer narrow it. Returned so a
     * deploy can say "Pages permission was not granted" instead of failing
     * with a 403 four calls later. */
    permissions: answer.permissions || {},
  };
}

/**
 * One request to the GitHub API.
 *
 * THE ONLY PLACE IN THIS FILE THAT TOUCHES THE NETWORK, and injectable
 * everywhere it is used — the same pattern cfApi follows in
 * utils/blog/cloudflare/deploy.js, for the same reason: a suite that forgot
 * to stub it would make real calls against a real account.
 */
async function githubApi({ method = 'GET', path = '', token = '', body = null } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',

      /* GitHub REQUIRES a User-Agent and answers 403 without one. Named
       * after the product rather than left as a library default, because an
       * abuse report from GitHub needs to reach somebody. */
      'User-Agent': 'ThreeComets-Sites',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    /* THE MESSAGE, NOT THE BODY. A GitHub error body can echo the request,
     * and a request to the token endpoint carries the JWT. */
    const message = (data && data.message) || `HTTP ${res.status}`;

    const err = new Error(`GitHub: ${message}`);
    err.status = res.status;

    /* WHICH CALL, AND WHAT IT ANSWERED — 29 October.
     *
     * The first real publish failed with "GitHub: Git Repository is empty."
     * and that was the whole of it: no status, no endpoint. The obvious
     * suspect was the branch lookup, which is written to expect exactly
     * that condition — so the fix went in there, and the next run failed
     * with the same six words.
     *
     *     AN ERROR THAT DOES NOT SAY WHICH CALL MADE IT
     *     SENDS YOU STRAIGHT BACK TO THE CALL YOU ALREADY SUSPECT.
     *
     * The method and path are not secret. The TOKEN is, and it travels in a
     * header that nothing here touches. */
    err.method = method;
    err.path = path;

    throw err;
  }

  return data;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

module.exports = {
  appJwt,
  installationToken,
  githubApi,
  normaliseKey,
  JWT_SECONDS,
  CLOCK_SKEW_SECONDS,
};
