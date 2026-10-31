// tools/rerender-local-options.js
//
// Rebuild a Local Website Options site from its stored words.
//
//   node tools/rerender-local-options.js dist/user_6ae22d5b53e93fdb7700417f
//   node tools/rerender-local-options.js <dir> --check
//
// WHAT THIS IS FOR
//
// The seven model calls that write a site cost about three minutes, $0.19
// and 800 credits. Everything after them — the HTML, the links, the
// stylesheet reference, the schema — is pure rendering from those words.
//
// So a template fix should cost nothing, and until 28 October it cost a
// full rebuild: the relative-paths change meant regenerating prose that had
// not changed, to alter an href. utils/runLocalOptions.js now stores
// renderSite()'s own argument object beside the build, and this replays it.
//
// WHY A BENCH TOOL AND NOT A ROUTE
//
// tools/ is in .rsync-exclude — "scripts run by hand on a laptop", as that
// file puts it. Re-rendering is a developer action taken after changing a
// template, not something a customer does: for them the site is already
// correct, and a button that silently rewrote their pages would be a
// surprise, not a feature. When a template fix needs to reach live sites
// that is a deploy decision with a list of which sites and when, and it
// belongs in a route built for that, not in this.
//
// --check RENDERS AND COMPARES WITHOUT WRITING, which is the safe thing to
// run first: it says exactly which files a template change would alter.

'use strict';

const fs = require('fs');
const path = require('path');

const { renderSite } = require('../utils/localOptions/render/renderSite');
const { SOURCE_PATH } = require('../utils/runLocalOptions');

/** The stored input, with `now` revived. */
function readSource(dir) {
  const file = path.join(dir, SOURCE_PATH);

  if (!fs.existsSync(file)) {
    throw new Error(
      `${file} is not there.\n\n`
      + '  Either this is not a Local Website Options build, or it was made\n'
      + '  before the source file existed. A site built without it can only\n'
      + '  be rebuilt by generating it again.'
    );
  }

  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));

  if (1 !== stored.version) {
    throw new Error(
      `${file} is version ${stored.version}; this tool understands 1.\n\n`
      + '  Re-rendering it would produce a site that differs from the one\n'
      + '  that was paid for, in ways nothing here can predict.'
    );
  }

  /* JSON HAS NO Date, and renderSite reads `now` as one — it sets the
   * footer year and the sitemap's lastmod. Left as a string, both come out
   * as "Invalid Date" with nothing thrown. */
  return { ...stored, now: new Date(stored.now) };
}

function main() {
  const [dir, flag] = process.argv.slice(2);

  if (!dir) {
    console.error('\n  node tools/rerender-local-options.js <build dir> [--check]\n');
    process.exit(1);
  }

  const check = '--check' === flag;
  const files = renderSite(readSource(dir));

  let changed = 0;
  let same = 0;

  for (const rel of Object.keys(files).sort()) {
    const full = path.join(dir, rel);
    const before = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;

    if (before === files[rel]) {
      same += 1;
      continue;
    }

    changed += 1;
    console.log(`  ${null === before ? 'new    ' : 'changed'}  ${rel}`);

    if (!check) {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, files[rel]);
    }
  }

  /* THE IMAGES AND THE LOGO ARE NOT TOUCHED. renderSite returns the pages,
   * the stylesheet, the sitemap, robots and the 404 — not the photographs,
   * which are bytes copied by heroes.js and are already on disk. Rewriting
   * only what this produces is why a re-render cannot lose them. */
  console.log(
    `\n  ${changed} file${1 === changed ? '' : 's'} ${check ? 'would change' : 'rewritten'}`
    + `, ${same} identical\n`
  );

  if (check && changed) {
    console.log('  Run again without --check to apply.\n');
  }
}

try {
  main();
} catch (err) {
  console.error('\n ', err.message, '\n');
  process.exit(1);
}
