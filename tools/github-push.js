// tools/github-push.js
//
// Push a site that is ALREADY BUILT, from the folder it was built into.
//
//   node tools/github-push.js dist/user_6ae22d5b53e93fdb7700417f --installation 176399104
//   node tools/github-push.js <dir> --installation <id> --name quality-plumbing-leander
//
// WHY THIS EXISTS
//
// The publish happens inside the build, which is the whole point of it —
// nobody presses anything. But the build is seven model calls, three minutes
// and about eight hundred credits, and the publish is the last twenty
// seconds of it. When the push is what failed, paying for the writing again
// to retry the pushing is the wrong price.
//
// So this takes the folder the build already wrote, reads it off disk, and
// does the publishing half on its own. It is also how the first real failure
// was recovered: on 29 October the very first publish created the repository
// and then threw, because GitHub answers 409 rather than 404 for a
// repository with no commits. The pages existed; only the push was missing.
//
// THE REPOSITORY NAME COMES FROM THE SITE'S OWN SOURCE FILE unless one is
// given. _src/localoptions.json holds the business name the site was built
// from, which is exactly what the build would have named the repository —
// so a retry lands in the same place rather than beside it.

'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const { publishSite, repoNameFor } = require('../utils/github/publishSite');
const { readSiteDir } = require('../utils/github/readSite');
const { SOURCE_PATH } = require('../utils/runLocalOptions');

function arg(name) {
  const at = process.argv.indexOf(`--${name}`);
  if (at < 0) return null;

  const next = process.argv[at + 1];
  return next && !next.startsWith('--') ? next : true;
}

/** The business name the site was built from. */
function businessFrom(dir) {
  const file = path.join(dir, SOURCE_PATH);

  if (!fs.existsSync(file)) return '';

  try {
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (stored.business && stored.business.name) || '';
  } catch (_) {
    return '';
  }
}

async function main() {
  const dir = process.argv[2];
  const installationId = arg('installation');
  const given = arg('name');

  if (!dir || !installationId) {
    console.error('\n  node tools/github-push.js <build dir> --installation <id> [--name <repo>]\n');
    process.exit(1);
  }

  if (!fs.existsSync(path.join(dir, 'index.html'))) {
    console.error(`\n  ${dir} has no index.html in it — that is not a built site.\n`);
    process.exit(1);
  }

  const businessName = given || businessFrom(dir);

  if (!businessName) {
    console.error('\n  No business name. The folder has no _src/localoptions.json,');
    console.error('  so pass --name <repo> to say where it should go.\n');
    process.exit(1);
  }

  const files = readSiteDir(dir);

  console.log(`\n  ${Object.keys(files).length} files from ${dir}`);
  console.log(`  repository: ${repoNameFor(businessName)}\n`);

  const out = await publishSite({ installationId, businessName, files });

  console.log(`  ${out.created ? 'created' : 'updated'}  ${out.owner}/${out.repo}`);
  console.log(`  ${out.uploaded} uploaded, ${out.reused} already there`);
  console.log(`  commit ${out.commitSha}`);

  if (out.pages.ok) {
    console.log(`\n  ${out.pagesUrl}`);
    console.log('  Pages can take a couple of minutes on a first publish.\n');
  } else {
    console.log(`\n  Pages did not switch on: ${out.pages.error}\n`);
  }
}

main().catch((err) => {
  console.error(`\n  ${err.message}`);

  /* THE CALL THAT FAILED, WHEN GITHUB IS THE ONE REFUSING. Without it the
   * message alone sends you to whichever call you already suspect — which
   * cost one wrong fix on 29 October. */
  if (err.status || err.path) {
    console.error(`  ${err.method || ''} ${err.path || ''} → ${err.status || '?'}`);
  }

  console.error('');
  process.exit(1);
});
