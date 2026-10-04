// test-generators-parse.js
//
// Does every theme generator still PARSE?
//
// THE BUG THIS EXISTS TO STOP COMING BACK — 4 October 2026
//
// A comment was added to functionsPhp.js containing `noindex` and `users` in
// backticks. Every generator file is one enormous JavaScript TEMPLATE
// LITERAL, so each backtick ended the string, and the PHP after it became
// JavaScript:
//
//     SyntaxError: Unexpected identifier 'noindex'
//
// The whole file was dead. Not the feature — the file, and with it every
// theme the app can export.
//
// HOW IT GOT PAST A GREEN SUITE, which is the part worth keeping:
//
//   * test-pillar-plugin.php asserted the new filter was present by reading
//     functionsPhp.js with file_get_contents. A STRING SEARCH FINDS TEXT IN A
//     FILE THAT CANNOT BE PARSED. It passed, and would pass on a file of pure
//     gibberish containing the right words.
//
//   * test-wp-canonical.js DOES require() the module and DID catch it — on
//     the machine running deploy.sh, and nowhere else. It requires
//     ./buildSitemap and a chain of other modules, so in any environment
//     missing one of them it dies before reaching the generator and reports a
//     module-not-found that looks like a setup problem rather than a defect.
//
// So the coverage existed and could not be run where the edit was made.
// THIS FILE REQUIRES NOTHING BUT THE GENERATORS, so it runs anywhere node
// does, in about a second, and it is the first thing deploy.sh runs.
//
// The general lesson, and it is cheap: A FILE VERIFIED BY READING IT AS TEXT
// HAS NOT BEEN VERIFIED. `node --check` takes a second and answers the only
// question that matters first.
//
// Run:  node test-generators-parse.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

/* The directories holding files that are one big template literal. A new one
 * added here is covered the day it appears, without anyone remembering to
 * come back to this file. */
/* THE TEMPLATE-LITERAL DIRECTORIES ONLY, and the omission is deliberate.
 * utils/wpThemeBuilder itself holds orchestrators like buildFromModel.js that
 * require a chain of other modules — exactly the dependency chain that stops
 * test-wp-canonical.js running anywhere but one machine, which is the reason
 * this file exists. Including them would reintroduce the fault it is meant to
 * remove, and they are covered by the suites that exercise a real build. */
const DIRS = [
  'utils/wpThemeBuilder/generators',
  'utils/wpThemeBuilder/wpHelpers',
];

function jsFilesIn(dir) {
  const full = path.join(__dirname, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full)
    .filter(f => f.endsWith('.js'))
    .map(f => path.join(dir, f));
}

const FILES = DIRS.flatMap(jsFilesIn);

test('THERE ARE GENERATORS TO CHECK', () => {
  /* A GLOB THAT MATCHES NOTHING PASSES EVERY TEST BELOW IT. Rename the
   * directory, or run this from the wrong place, and a file-by-file loop over
   * an empty list reports success with magnificent confidence. */
  assert.ok(FILES.length >= 5,
    `only found ${FILES.length} generator files — the paths in DIRS are wrong`);
});

for (const file of FILES) {
  test(`${file} parses and loads`, () => {
    /* require(), not just a syntax check: a template literal left open by a
     * stray backtick is a SyntaxError either way, and require() additionally
     * runs the module's top level, so a bad import or a typo'd reference at
     * load time is caught in the same pass. These modules only define and
     * export functions, so there is nothing else to run. */
    const mod = require(path.join(__dirname, file));

    const exported = (mod && typeof mod === 'object') ? Object.keys(mod) : [];
    assert.ok(
      typeof mod === 'function' || exported.length > 0,
      `${file} loaded but exports nothing — was module.exports lost in an edit?`
    );
  });
}

/* THERE WAS A SECOND CHECK HERE AND IT WAS WRONG. DO NOT PUT IT BACK.
 *
 * It flagged any backtick on a line beginning with `*`, reasoning that a
 * backtick in a docblock ends the template literal. That is true of a
 * docblock INSIDE the literal and false of one outside it, and the check
 * could not tell the two apart — every one of these files has ordinary
 * JavaScript docblocks above the literal where a backtick is perfectly legal.
 *
 * It failed immediately on pageTemplatesPhp.js:164, which quotes
 * `post-thumbnails` in a comment at the top of the file and parses fine. A
 * test that fails on correct code is worse than no test: the next person
 * makes it pass, and the only way to make that one pass was to delete a
 * backtick from a comment that was never wrong.
 *
 * I wrote it against the six generator files present in my working copy and
 * it passed. The sixteen on the real machine include the counter-example.
 * ASSERTING OVER FILES YOU CANNOT SEE IS GUESSING — which is also how the bug
 * this file exists to catch was shipped in the first place.
 *
 * Nothing is lost. require() above is the real check: a backtick inside the
 * literal makes the file unparseable, and an unparseable file cannot be
 * required. That is proved by mutation, not by argument — put the original
 * `noindex` backtick back into functionsPhp.js and the require test fails. */

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
