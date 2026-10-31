// tools/site-verification.js
//
// Put a client's Search Console tag on a site that is already live, without
// rebuilding it.
//
//   node tools/site-verification.js dist/user_6ae22d5b53e93fdb7700417f
//   node tools/site-verification.js <dir> --tag '<meta name="google-site-verification" content="..." />'
//   node tools/site-verification.js <dir> --clear
//
// WHY THIS IS THE CASE THAT MATTERS
//
// Google hands the tag over when a property is CREATED, and a client creates
// the property once their site exists. So the usual sequence is: build the
// site, give them the address, they make a property, Google shows them a
// tag, and only then does anybody have a value to put on the page.
//
// Asking for it in the wizard covers the client who already has one. This
// covers everybody else, which is most of them.
//
// AND IT COSTS NOTHING. The seven model calls that wrote the site are not
// repeated: utils/runLocalOptions.js stores renderSite()'s own argument
// object beside the build, so changing one field in it and rendering again
// produces the same eleven pages with one line added. Same reason
// tools/rerender-local-options.js exists.
//
//     THE WORDS WERE PAID FOR ONCE. A TAG IN THE HEAD IS NOT NEW WORDS.
//
// IT WRITES THE FOLDER, IT DOES NOT PUBLISH. The push is a separate step on
// purpose — tools/github-push.js does it, and keeping them apart means this
// can be run on a site that has never been published, and a push can be
// retried without touching the source again.

'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const { renderSite } = require('../utils/localOptions/render/renderSite');
const { SOURCE_PATH } = require('../utils/runLocalOptions');
const { parseVerificationTags, MAX_TAGS } = require('../utils/blog/verificationTags');

function arg(name) {
  const at = process.argv.indexOf(`--${name}`);
  if (at < 0) return null;

  const next = process.argv[at + 1];
  return next && !next.startsWith('--') ? next : true;
}

/** The stored input, with `now` revived — JSON has no Date. */
function readSource(dir) {
  const file = path.join(dir, SOURCE_PATH);

  if (!fs.existsSync(file)) {
    throw new Error(
      `${file} is not there.\n\n`
      + '  Either this is not a Local Website Options build, or it was made\n'
      + '  before the source file existed. Without it the pages cannot be\n'
      + '  re-rendered and the tag would need a rebuild.');
  }

  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));

  if (1 !== stored.version) {
    throw new Error(`${file} is version ${stored.version}; this tool understands 1.`);
  }

  return { file, stored };
}

function main() {
  const dir = process.argv[2];
  const tag = arg('tag');
  const clearing = !!arg('clear');

  if (!dir) {
    console.error('\n  node tools/site-verification.js <build dir> [--tag "<meta …>"] [--clear]\n');
    process.exit(1);
  }

  const { file, stored } = readSource(dir);

  /* ----------------------------------------------------------- reading */

  if (!tag && !clearing) {
    const has = stored.verification || [];

    console.log(`\n  ${dir}\n`);

    if (!has.length) {
      console.log('  No Search Console tag on this site.\n');
      console.log('  node tools/site-verification.js ' + dir + ' --tag "<meta …>"\n');
      return;
    }

    for (const token of has) console.log(`  ${token}`);

    console.log('');
    return;
  }

  /* ----------------------------------------------------------- writing */

  /* PARSED, NEVER STORED AS TYPED. The value reaches an attribute on every
   * page of a site on somebody else's domain, so what goes in is a token
   * and nothing else — verificationTags.js is the one place in this app
   * that says what that means. */
  const tokens = clearing ? [] : parseVerificationTags(String(tag));

  if (!clearing && !tokens.length) {
    console.error('\n  That is not a Google verification tag.\n');
    console.error('  Paste the whole thing Google gave you, including the angle');
    console.error('  brackets. A description meta or a bare sentence is refused');
    console.error('  rather than published as a token.\n');
    process.exit(1);
  }

  if (tokens.length === MAX_TAGS) {
    console.log(`\n  (${MAX_TAGS} is the most this will carry.)`);
  }

  const next = { ...stored, verification: tokens, now: new Date(stored.now) };

  const files = renderSite(next);

  let changed = 0;

  for (const rel of Object.keys(files).sort()) {
    const full = path.join(dir, rel);
    const before = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;

    if (before === files[rel]) continue;

    changed += 1;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, files[rel]);
  }

  /* THE SOURCE IS WRITTEN LAST, AND ONLY IF THE PAGES WERE. A stored file
   * claiming a tag the pages do not carry would make the next re-render
   * silently correct and this run silently wrong. */
  fs.writeFileSync(file, JSON.stringify(next, null, 2));

  console.log(`\n  ${clearing ? 'Cleared' : tokens.join(', ')}`);
  console.log(`  ${changed} page${1 === changed ? '' : 's'} rewritten\n`);
  console.log('  Publish it:');
  console.log(`  node tools/github-push.js ${dir} --installation <id>\n`);
}

try {
  main();
} catch (err) {
  console.error(`\n  ${err.message}\n`);
  process.exit(1);
}
