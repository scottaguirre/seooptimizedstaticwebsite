// test-template-placeholders.js
//
// Every {{PLACEHOLDER}} in a template is one that template's builder fills.
//
//   node test-template-placeholders.js
//
//
// THE BUILD THAT CAUSED THIS, 7 NOVEMBER
//
//     The finished site still contains 2 unfilled placeholder(s):
//     {{PAGE_NAME}}, {{LOCATION_AREA}}.
//
// Design 7, the spotlight hero. The block had been copied into
// contactTemplate.html from template.html and arrived carrying THAT file's
// placeholder names — names runGeneration.js fills and buildContactPage.js
// has never heard of. The contact template's other three heroes use
// {{HERO_H1}} and {{LOCATION}}; only the spotlight said otherwise.
//
// So the bug was invisible unless you chose that one design, and it was
// caught by the build guard at the last possible moment — after six pages had
// been generated and an OpenAI bill had been run up, one step before
// chargeCredits().
//
// WRITING THIS TEST FOUND A SECOND ONE, WHICH IS THE WHOLE ARGUMENT FOR IT.
// locationPagesTemplate.html's STANDARD hero said {{LOCATION}} while the
// overlay, split and spotlight heroes all said {{LOCATION_AREA}} — and
// buildLocationPages.js fills only the latter. Nobody had hit it because
// nobody had built location pages on a design mapped to the standard hero.
// Same slip, opposite direction, sitting in the repository unnoticed.
//
//
// WHY test-hero-layouts.js DID NOT CATCH EITHER
//
// It asserts all four templates CARRY all four hero blocks, and that exactly
// one survives a build. Both true, both still true with the wrong names in
// them. It checks that the blocks are THERE; this checks that what is in them
// can be FILLED.
//
//     FOUR TEMPLATES, FOUR HEROES, FOUR BUILDERS, AND NOTHING
//     PAIRING THE NAMES — so a copy-paste between two templates is
//     correct markup, correct structure, and a placeholder on a
//     customer's page.
//
//
// HOW A TOKEN COUNTS AS "FILLED"
//
// A literal `.replace(/{{TOKEN}}/` in the builder's source. Deliberately
// narrow: a token merely MENTIONED in a comment does not count, which matters
// because runGeneration.js has comments naming {{ADDRESS}} and
// {{ADDRESS_FULL}} in prose. Counting those would mean deleting the real
// replace() left this test green.
//
// A builder that fills tokens some other way needs saying so explicitly.
// There is one today — legalLinks.js builds its names from LEGAL_SLUGS with
// `new RegExp` — and it is handled by importing that object rather than by
// grepping for something that is not there.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

/* THE GUARD'S OWN RULES, IMPORTED, NOT REIMPLEMENTED.
 *
 * PLACEHOLDER is what counts as a placeholder at build time, and
 * withoutComments is what the guard ignores. A second copy of either would be
 * this test and the guard disagreeing about what a leftover is — which is the
 * same class of bug one level up, with the symptom being a suite that passes
 * while a build fails. */
const { PLACEHOLDER, withoutComments } = require('./utils/checkPlaceholders');

/* THE ONE BUILDER THAT DOES NOT WRITE ITS TOKENS DOWN. fillLegalLinks builds
 * `{{LEGAL_PRIVACY}}` and the rest from these keys with new RegExp, so there
 * is no literal to find. Imported rather than hard-coded here: a token added
 * to that map is then filled AND known about, in one edit. */
const { LEGAL_SLUGS } = require('./utils/legalLinks');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

function section(name) { console.log(`\n${name}\n`); }

const ROOT = __dirname;

/**
 * Each template, and the module that turns it into a page.
 *
 * THIS MAP IS THE POINT OF THE FILE. Nothing else in the codebase states the
 * pairing — it is implied by which module happens to read which file — and
 * it is precisely the thing that has to be true for a placeholder to get
 * filled. Written down, a new template with no builder is a failing test
 * rather than a page full of braces.
 */
const PAIRS = {
  'src/template.html':                'utils/runGeneration.js',
  'src/contactTemplate.html':         'utils/buildContactPage.js',
  'src/aboutUsTemplate.html':         'utils/buildAboutUsPage.js',
  'src/locationPagesTemplate.html':   'utils/buildLocationPages.js',

  /* THE THREE LEGAL TEMPLATES, ADDED AFTER THIS SUITE FAILED ON EDWIN'S
   * MACHINE AND PASSED ON MINE — which is the test doing precisely its job
   * on the person who wrote it.
   *
   * It was built against a working copy holding four templates, because four
   * were all that had been looked at. src/ has seven. The three below were
   * never in the map, so their placeholders were never checked, and nothing
   * would have said so if the "every template on disk" assertion had not
   * been there to read the DIRECTORY rather than this list.
   *
   *     A SUITE THAT ONLY CHECKS WHAT IT WAS TOLD ABOUT
   *     IS A SUITE THAT AGREES WITH WHOEVER TOLD IT.
   */
  'src/privacyPolicyTemplate.html':   'utils/buildPrivacyPolicyPage.js',
  'src/termsOfUseTemplate.html':      'utils/buildTermsOfUsePage.js',
  'src/accessibilityTemplate.html':   'utils/buildAccessibilityPage.js',
};

/**
 * Modules that fill tokens in EVERY template, whichever builder owns it.
 *
 * The nav menus and the footer's legal links are the same markup in all four
 * files, so they are filled in one pass over all of them rather than four
 * times over one each.
 */
const SHARED = [
  'utils/buildMenusForTemplate.js',
  'utils/legalLinks.js',
];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/**
 * Every placeholder a template asks for, comments excluded.
 *
 * COMMENTS EXCLUDED BECAUSE THE GUARD EXCLUDES THEM. locationPagesTemplate
 * carries a disabled <img> holding {{MAP_IMAGE}}, {{MAP_ALT}} and
 * {{MAP_TITLE}} — markup somebody turned off rather than deleted. None is
 * filled by anything and none has ever shipped. Counting them would make this
 * test demand three replace() calls for a tag that does not render.
 */
function asksFor(rel) {
  const text = withoutComments(read(rel), '.html');
  const re = new RegExp(PLACEHOLDER.source, 'g');

  const out = new Set();
  let m;
  while ((m = re.exec(text))) out.add(m[1]);
  return out;
}

/**
 * Every placeholder a module actually fills.
 *
 * MATCHED INSIDE A `.replace(/.../)` PATTERN, NOT ANYWHERE IN THE FILE. That
 * distinction is the whole value of this function: runGeneration.js discusses
 * {{ADDRESS}} in a comment two lines below the call that fills it, and
 * buildContactPage.js names tokens in prose too. Matched loosely, deleting a
 * replace() would leave its comment behind and this test green.
 *
 * THE WHOLE PATTERN, NOT JUST ITS OPENING — and the first version of this
 * got that wrong, which cost a false failure on {{FORM}}.
 *
 * buildAboutUsPage.js does not write `.replace(/{{FORM}}/`. It writes
 * `.replace(/<section>\s*{{FORM}}\s*<\/section>/i, ...)`, replacing the whole
 * wrapper so the empty <section> goes with the form when there is none. That
 * is a filled token by any sane reading, and a matcher anchored to the start
 * of the pattern called it unfilled.
 *
 *     "FILLED" MEANS A replace() MENTIONS IT, NOT THAT THE TOKEN
 *     HAPPENS TO SIT AT THE FRONT OF THE REGEX.
 *
 * `(?:[^/\\\n]|\\.)*` walks the regex literal to its closing slash while
 * stepping over escapes, which is what lets `<\/section>` stay inside the
 * pattern rather than ending it.
 */
function fills(rel) {
  const src = read(rel);
  const patterns = /\.replace\(\s*\/((?:[^/\\\n]|\\.)*)\//g;
  const token = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

  const out = new Set();
  let m;

  while ((m = patterns.exec(src))) {
    let t;
    token.lastIndex = 0;
    while ((t = token.exec(m[1]))) out.add(t[1]);
  }

  /* AND THE ONE THAT BUILDS ITS NAMES. See the import at the top. */
  if (rel.endsWith('legalLinks.js')) {
    for (const token of Object.keys(LEGAL_SLUGS)) out.add(token);
  }

  return out;
}

/** The union of a template's own builder and the shared passes. */
function filledFor(template) {
  const out = new Set();

  for (const rel of [PAIRS[template], ...SHARED]) {
    for (const token of fills(rel)) out.add(token);
  }

  return out;
}

(() => {

/* ===================================================================== */
section('THE EXTRACTION ITSELF, BECAUSE A TEST THAT FINDS NOTHING PASSES');

test('EVERY TEMPLATE AND BUILDER NAMED HERE IS ON DISK', () => {
  /* A renamed file would otherwise throw ENOENT inside the real test and
   * read as a placeholder problem, sending somebody to the wrong file. */
  for (const [template, builder] of Object.entries(PAIRS)) {
    assert.ok(fs.existsSync(path.join(ROOT, template)), `${template} is missing`);
    assert.ok(fs.existsSync(path.join(ROOT, builder)), `${builder} is missing`);
  }

  for (const rel of SHARED) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} is missing`);
  }
});

test('AND EVERY TEMPLATE ON DISK IS IN THE MAP', () => {
  /* THE HOLE MUTATION TESTING FOUND IN THIS FILE'S FIRST DRAFT.
   *
   * Deleting a line from PAIRS made the suite pass with nine tests instead
   * of ten — no failure, just one template silently no longer checked. And
   * the same gap swallows the case that matters more: a NEW template added
   * to src/ and never listed here is a file this suite does not read,
   * which is indistinguishable from a file it approves of.
   *
   *     A TEST THAT ONLY CHECKS WHAT IT IS TOLD ABOUT
   *     IS A TEST YOU CAN SWITCH OFF BY FORGETTING.
   *
   * Read off the directory, not from a second list. Page templates live at
   * the top of src/; src/views/ holds the app's own pages, which are served
   * as-is and have no builder. */
  const onDisk = fs.readdirSync(path.join(ROOT, 'src'))
    .filter(f => f.endsWith('.html'))
    .map(f => `src/${f}`)
    .sort();

  assert.ok(onDisk.length >= 4, `only ${onDisk.length} templates found in src/`);

  assert.deepStrictEqual(onDisk, Object.keys(PAIRS).sort(),
    'a template in src/ is not in PAIRS, or PAIRS names one that is gone — '
    + 'every page template needs the builder that fills it written down here');
});

test('AND BOTH SIDES ACTUALLY FIND THINGS', () => {
  /* THE MUTATION THIS EXISTS FOR. Break either regex and every template
   * reports zero placeholders, zero of them unfilled, and the suite goes
   * green on a codebase it is no longer reading.
   *
   * THE FLOOR IS 10 PER TEMPLATE, NOT 30, AND THE THREE LEGAL ONES ARE WHY.
   * Calibrated against the four big templates — which ask for 45 to 75 — a
   * floor of 30 failed the moment privacyPolicyTemplate joined the map with
   * 19. The number was a guess dressed as a threshold.
   *
   * A TOTAL AS WELL AS A FLOOR, because a per-file minimum low enough for
   * the smallest template is not much of a signal on the largest. Together
   * they say "every template parses to something, and the set parses to a
   * lot" — 307 today, so 150 is half of reality and a long way from zero. */
  let total = 0;

  for (const template of Object.keys(PAIRS)) {
    const asked = asksFor(template).size;
    const filled = filledFor(template).size;

    total += asked;

    assert.ok(asked >= 10, `${template} parsed to only ${asked} placeholders`);
    assert.ok(filled >= 10, `${PAIRS[template]} parsed to only ${filled} replacements`);
  }

  assert.ok(total >= 150, `every template together parsed to only ${total} placeholders`);
});

test('AND COMMENTED-OUT MARKUP IS NOT COUNTED', () => {
  /* locationPagesTemplate has a disabled <img> carrying three map tokens.
   * They are in the file and not in the scan — which is the guard's rule,
   * reached through the guard's own function. */
  const raw = read('src/locationPagesTemplate.html');
  const seen = asksFor('src/locationPagesTemplate.html');

  assert.ok(raw.includes('{{MAP_IMAGE}}'), 'the commented-out map img is gone — drop this test');
  assert.ok(!seen.has('MAP_IMAGE'), 'a placeholder inside an HTML comment was counted');
  assert.ok(!seen.has('MAP_ALT'));
  assert.ok(!seen.has('MAP_TITLE'));
});

test('AND A TOKEN ONLY MENTIONED IN A COMMENT IS NOT "FILLED"', () => {
  /* runGeneration.js names {{ADDRESS}} in prose beside the call that fills
   * it. The prose must not be what makes it count — otherwise deleting the
   * replace() leaves the comment and this suite notices nothing. */
  const src = read('utils/runGeneration.js');

  assert.ok(/\{\{ADDRESS\}\} above is left/.test(src),
    'that comment was reworded — pick another prose mention, or drop this test');

  const withoutTheReplace = src.replace(/\.replace\(\s*\/\{\{ADDRESS\}\}[\s\S]*?\n/, '\n');

  const patterns = /\.replace\(\s*\/((?:[^/\\\n]|\\.)*)\//g;
  const token = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

  const still = new Set();
  let m;

  while ((m = patterns.exec(withoutTheReplace))) {
    let t;
    token.lastIndex = 0;
    while ((t = token.exec(m[1]))) still.add(t[1]);
  }

  assert.ok(!still.has('ADDRESS'),
    'a token survives in the "filled" set on the strength of a comment alone');
});

/* ===================================================================== */
section('EVERY PLACEHOLDER IN EVERY TEMPLATE IS ONE ITS BUILDER FILLS');

for (const [template, builder] of Object.entries(PAIRS)) {
  test(`${template} — ${builder}`, () => {
    const asked = asksFor(template);
    const filled = filledFor(template);

    const unfilled = [...asked].filter(t => !filled.has(t)).sort();

    assert.deepStrictEqual(unfilled, [],
      `${template} asks for ${unfilled.length} placeholder(s) that nothing fills:\n`
      + `          ${unfilled.join(', ')}\n`
      + `        Either ${builder} should fill them, or the template is using\n`
      + `        another template's names — which is what happened on 7 November\n`
      + `        in both directions. Check what the OTHER hero blocks in the same\n`
      + `        file use before adding a replace().`);
  });
}

/* ===================================================================== */
section('THE TWO SLIPS THAT CAUSED THIS, NAMED');

test('THE CONTACT SPOTLIGHT HERO USES THE CONTACT TEMPLATE\'S NAMES', () => {
  /* ASSERTED ON THE BLOCK, not on the file. The test above would also fail
   * if these came back — but it would fail saying "{{PAGE_NAME}} is not
   * filled", which is true of the whole file and says nothing about where
   * it came from or why it is wrong. This one names the block. */
  const text = withoutComments(read('src/contactTemplate.html'), '.html');
  const at = text.indexOf('hero-spotlight__title');

  assert.ok(at > -1, 'the spotlight hero is gone from the contact template');

  const block = text.slice(at, at + 400);

  assert.ok(block.includes('{{HERO_H1}}'), 'the spotlight h1 is not {{HERO_H1}}');
  assert.ok(block.includes('{{LOCATION}}'), 'the spotlight subheading is not {{LOCATION}}');
  assert.ok(!block.includes('{{PAGE_NAME}}'),
    'the service template\'s {{PAGE_NAME}} is back in the contact spotlight hero');
});

test('AND THE LOCATION STANDARD HERO USES {{LOCATION_AREA}} LIKE THE OTHER THREE', () => {
  const text = withoutComments(read('src/locationPagesTemplate.html'), '.html');

  /* ONE NAME ACROSS ALL FOUR HEROES, which is the actual invariant — the
   * builder fills exactly one of the two spellings and the file must not
   * contain the other at all. */
  assert.ok(!text.includes('{{LOCATION}}'),
    '{{LOCATION}} is back in locationPagesTemplate — buildLocationPages fills {{LOCATION_AREA}}');

  const count = (text.match(/\{\{LOCATION_AREA\}\}/g) || []).length;
  assert.ok(count >= 4, `only ${count} heroes use {{LOCATION_AREA}}; there are four hero blocks`);
});

/* ===================================================================== */

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

})();
