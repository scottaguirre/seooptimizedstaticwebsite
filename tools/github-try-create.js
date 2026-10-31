#!/usr/bin/env node
//
// tools/github-try-create.js
//
// Find out whether the App can create a repository on a PERSONAL account.
//
//     node tools/github-try-create.js --installation 176399104 --name site-test
//     node tools/github-try-create.js --installation 176399104 --name site-test --delete
//
// THIS ONE WRITES. It creates an empty private repository and nothing else —
// no files, no commit, no Pages. github-check.js stays read-only; this is
// deliberately a separate file so that nothing which writes can be run by
// accident while poking at credentials.
//
// WHY IT EXISTS AT ALL
//
// GitHub's own documentation does not say whether POST /user/repos accepts an
// installation access token. The "Repository creation" permission exists and
// can be granted — it is in the permission list on the registration page —
// but an installation token is not a user, and /user/repos is defined as
// "create a repository for the AUTHENTICATED USER".
//
//     THE DESIGN DEPENDS ON THE ANSWER AND THE DOCS DO NOT GIVE IT.
//
// If it works, a customer presses Generate and the whole thing — repo, pages,
// publish — happens without them touching GitHub. If it does not, the client
// creates an empty repository once per site and the app pushes into it. Both
// are buildable; they are different flows, and guessing would mean building
// the wrong one.
//
// So this asks GitHub, prints exactly what came back, and leaves one empty
// repository behind that --delete will not remove (the App has no delete
// permission — remove it on github.com, which takes a moment).

'use strict';

require('dotenv').config();

const { installationToken, githubApi } = require('../utils/github/app');

function arg(name) {
  const at = process.argv.indexOf(`--${name}`);
  if (at < 0) return null;

  const next = process.argv[at + 1];
  return next && !next.startsWith('--') ? next : true;
}

async function attempt(label, request) {
  process.stdout.write(`  ${label.padEnd(34)}`);

  try {
    const answer = await request();
    console.log('WORKS');
    return answer;
  } catch (err) {
    console.log(`refused — ${err.status || '?'} ${err.message}`);
    return null;
  }
}

async function main() {
  const installationId = arg('installation');
  const name = arg('name');

  if (!installationId || !name) {
    console.error('\n  node tools/github-try-create.js --installation <id> --name <repo>\n');
    process.exit(1);
  }

  console.log('\nCan this App create a repository?\n');

  const grant = await installationToken({ installationId });

  if ('write' !== (grant.permissions || {}).repository_creation) {
    console.log('  The installation did not grant repository creation.');
    console.log('  Nothing was attempted.\n');
    process.exit(1);
  }

  /* THE TWO CANDIDATES, IN THE ORDER THEY ARE LIKELY TO WORK.
   *
   * /user/repos is the documented way a person makes a repository. If an
   * installation token is accepted there, the whole flow is one button.
   *
   * The second is the same call with the owner named explicitly, which is
   * how the organisation endpoint is shaped — worth one request to find out
   * whether a personal account answers to it too. */
  const made = await attempt('POST /user/repos', () => githubApi({
    method: 'POST',
    path: '/user/repos',
    token: grant.token,
    body: {
      name,
      private: true,
      auto_init: false,
      description: 'Created by the Three Comets site builder (test).',
    },
  }));

  if (made) {
    console.log(`\n  Created: ${made.full_name}`);
    console.log(`  ${made.html_url}`);
    console.log('\n  The App can create repositories. A customer never has to touch GitHub.');
    console.log('  Delete this one on github.com when you are done — the App has no');
    console.log('  delete permission, which is deliberate.\n');
    return;
  }

  console.log('\n  The App cannot create a repository for a personal account that way.');
  console.log('  That is not a failure of the credentials — github-check.js already');
  console.log('  proved those. It means the flow needs the client to create an empty');
  console.log('  repository once per site, and the app pushes into it.\n');
}

main().catch((err) => {
  console.error(`\n  ${err.message}\n`);
  process.exit(1);
});
