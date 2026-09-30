// check-boot.js
//
// Can this app actually be loaded?
//
//   node check-boot.js
//
// WHY THIS EXISTS. On 30 September the server went into a restart loop and
// answered 502 for every request, and `deploy.sh` had shipped it with all
// thirty-nine suites green. `utils/generateSampleReviews.js` had picked up a
// top-level `await`, which makes Node treat the file as an ES module, which
// makes `require()` of it from `utils/buildAboutUsPage.js` illegal:
//
//     Error [ERR_REQUIRE_ASYNC_MODULE]: require() cannot be used on an ESM
//     graph with top-level await.
//
// The app died before it finished loading. Not one test noticed, and not one
// of them could have: each suite loads the two or three files it is about,
// and NOTHING in the list loads the app. The suites check the parts. This
// checks that the engine turns over.
//
// `node --check` is NOT enough and was tried first — it reported the broken
// file as fine. It parses one file in isolation; the failure only appears
// when one module actually requires another.
//
//
// WHY IT DOES NOT SIMPLY `require('./server.js')`
//
// Because server.js does its work at module top level:
//
//     line  87   mongoose.connect(process.env.MONGO_URI)
//     line 414   app.listen(PORT, ...)
//     line 420   jobRunner.start(); blogScheduler.start();
//
// Requiring it from a laptop would connect to the LIVE Atlas database, bind
// the port, and start the job runner polling for work — which could begin
// generating a customer's site from a machine that was only meant to be
// running a check. A deploy check that can do real work is not a check.
//
// So: load every first-party module the app is built from, one at a time, and
// report the ones that throw. That catches strictly more than booting would,
// because it reaches files that only certain routes require — and it starts
// nothing.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/* The app's own code. `public/` is deliberately absent: those files run in a
 * browser and reference `document`, so requiring them in Node throws for a
 * reason that has nothing to do with the server. */
const ROOTS = ['utils', 'routes', 'models', 'middleware'];

/* Loaded for their side effects by design, or otherwise not a module the
 * server requires. Add to this list only with a reason written beside it. */
const SKIP = new Set([
  // Nothing yet. An entry here is a file this check cannot see, so it should
  // stay empty if at all possible.
]);

function jsFilesUnder(dir) {
  const out = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      out.push(...jsFilesUnder(full));
    } else if (entry.name.endsWith('.js') && !SKIP.has(full)) {
      out.push(full);
    }
  }

  return out;
}

const failures = [];

/* server.js itself is checked for SYNTAX only, since loading it would start
 * the app. Everything it requires is loaded properly below, so a broken
 * dependency is still caught — this covers the one file that cannot be. */
try {
  execFileSync(process.execPath, ['--check', 'server.js'], { stdio: 'pipe' });
} catch (err) {
  failures.push(['server.js', String(err.stderr || err.message).trim()]);
}

const files = ROOTS
  .filter(dir => fs.existsSync(dir))
  .flatMap(dir => jsFilesUnder(dir))
  .sort();

for (const file of files) {
  try {
    require(path.resolve(file));
  } catch (err) {
    /* THE CODE MATTERS MORE THAN THE MESSAGE for the failure that prompted
     * this, so it is printed when there is one. ERR_REQUIRE_ASYNC_MODULE says
     * "top-level await somewhere in this file's graph" far more precisely
     * than the sentence attached to it. */
    failures.push([file, `${err.code ? err.code + ': ' : ''}${err.message.split('\n')[0]}`]);
  }
}

if (failures.length) {
  console.error(`\n  ${failures.length} file(s) the app cannot load:\n`);
  for (const [file, message] of failures) {
    console.error(`  ${file}`);
    console.error(`      ${message}\n`);
  }
  console.error('  The server would not start with these. Nothing should be deployed.\n');
  process.exit(1);
}

console.log(`  boot check: ${files.length} files load cleanly, server.js parses`);
