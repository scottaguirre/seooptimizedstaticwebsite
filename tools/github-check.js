#!/usr/bin/env node
//
// tools/github-check.js
//
// Prove the GitHub App credentials work, and show what they can reach.
//
//     node tools/github-check.js
//     node tools/github-check.js --installation 176399104
//
// READ ONLY. It signs a JWT, asks GitHub who the App is, lists the
// installations, trades the JWT for an installation token and lists the
// repositories that token can see. It creates nothing, writes nothing and
// pushes nothing — so it is safe to run against a live App while the deploy
// path is still being built.
//
// WHY A BENCH TOOL AND NOT A TEST. test-github-app.js proves the JWT is one
// GitHub would accept, by verifying the signature against the matching public
// key — and it does that with a key pair it generates, touching no network
// and reading no .env. That is the right shape for a suite and it cannot
// answer the only question that matters on the day the App is registered:
// whether THIS key, THIS app id and THIS installation actually work together.
//
//     A SUITE PROVES THE CODE. THIS PROVES THE CREDENTIALS.
//
// NOTHING SECRET IS PRINTED. Not the private key, not the JWT, not the
// installation token. The key is reported as "present" and a length, which
// is enough to tell "unset" from "mangled by .env" and nothing more. The JWT
// is a credential for nine minutes and the installation token for an hour;
// neither belongs on a terminal that might be screenshotted.

'use strict';

require('dotenv').config();

const { appJwt, installationToken, githubApi } = require('../utils/github/app');

function arg(name) {
  const at = process.argv.indexOf(`--${name}`);
  if (at < 0) return null;

  const next = process.argv[at + 1];
  return next && !next.startsWith('--') ? next : true;
}

const line = (label, value) => console.log(`  ${String(label).padEnd(16)}${value}`);

async function main() {
  const appId = process.env.GITHUB_APP_ID || '';
  const key = process.env.GITHUB_APP_KEY || '';

  console.log('\nGitHub App credentials\n');

  line('App id', appId || '(not set)');

  /* THE LENGTH, NEVER THE CONTENT. A .pem that lost its newlines is the
   * commonest way this fails, and it produces a crypto error naming an
   * OpenSSL decoder routine. Length plus "looks like a PEM" separates
   * "unset" from "mangled" without quoting a byte of it. */
  line('Private key', key
    ? `present, ${key.length} characters${
        key.includes('BEGIN') ? '' : '  ← no BEGIN line, this is not a .pem'}`
    : '(not set)');

  if (!appId || !key) {
    console.log('\n  Set GITHUB_APP_ID and GITHUB_APP_KEY in .env, then run this again.\n');
    process.exit(1);
  }

  /* ---------------------------------------------------------- the App */

  console.log('');

  let token;

  try {
    token = appJwt();
  } catch (err) {
    console.log(`  Signing a JWT failed: ${err.message}\n`);
    process.exit(1);
  }

  let app;

  try {
    app = await githubApi({ method: 'GET', path: '/app', token });
  } catch (err) {
    console.log(`  GitHub refused the App's own token: ${err.message}`);
    console.log('\n  That is almost always one of three things: the app id is not '
      + 'this key\'s app,\n  the key was regenerated on github.com, or the clock on '
      + 'this machine is out.\n');
    process.exit(1);
  }

  line('Signed in as', `${app.name}  (@${app.owner && app.owner.login})`);

  /* -------------------------------------------------- the installations */

  const installs = await githubApi({ method: 'GET', path: '/app/installations', token });

  console.log('\nInstallations\n');

  if (!installs.length) {
    console.log('  none — install the App on an account before using it.\n');
    process.exit(1);
  }

  for (const install of installs) {
    const who = install.account && (install.account.login || install.account.slug);

    console.log(`  ${String(install.id).padEnd(12)}${String(who).padEnd(32)}`
      + `${install.repository_selection}`);
  }

  /* THE INSTALLATION ID IS WHY THIS TOOL EXISTS AS MUCH AS ANYTHING.
   * GitHub's documentation gives no page in the web interface that shows
   * it; the docs say to ask the API. So this asks. */

  const chosen = arg('installation')
    || (1 === installs.length ? String(installs[0].id) : null);

  if (!chosen) {
    console.log('\n  More than one installation. Re-run with --installation <id>.\n');
    return;
  }

  /* ------------------------------------------------ the installation token */

  console.log('');

  const grant = await installationToken({ installationId: chosen });

  line('Token for', chosen);
  line('Expires', grant.expiresAt.toISOString());

  console.log('\nWhat the client granted\n');

  const granted = Object.entries(grant.permissions || {});

  if (!granted.length) {
    console.log('  nothing — the installation granted no permissions.\n');
  }

  for (const [name, level] of granted.sort()) {
    console.log(`  ${name.padEnd(22)}${level}`);
  }

  /* WHAT THE DEPLOY WILL NEED, CHECKED BY NAME. An installer can narrow
   * what the App asked for, and the failure that produces is a 403 several
   * calls into a deploy, on an endpoint whose name does not mention the
   * permission that was missing. */
  const needed = { contents: 'write', metadata: 'read' };

  const missing = Object.entries(needed)
    .filter(([name, level]) => (grant.permissions || {})[name] !== level);

  if (missing.length) {
    console.log(`\n  MISSING: ${missing.map(([n, l]) => `${n}:${l}`).join(', ')}`);
    console.log('  The deploy will fail. Change it on the installation, not the App.');
  }

  /* -------------------------------------------------- what it can reach */

  const reach = await githubApi({
    method: 'GET',
    path: '/installation/repositories?per_page=100',
    token: grant.token,
  });

  const repos = (reach && reach.repositories) || [];

  console.log(`\nRepositories it can reach (${reach ? reach.total_count : 0})\n`);

  if (!repos.length) {
    console.log('  none yet. With repository-creation granted, the deploy can make one.');
  }

  for (const r of repos.slice(0, 40)) {
    console.log(`  ${r.full_name}${r.private ? '' : '   (public)'}`);
  }

  if (repos.length < (reach.total_count || 0)) {
    console.log(`  … and ${reach.total_count - repos.length} more`);
  }

  console.log('\n  Nothing was created, written or pushed.\n');
}

main().catch((err) => {
  console.error(`\n  ${err.message}\n`);
  process.exit(1);
});
