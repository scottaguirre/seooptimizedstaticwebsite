// test-reuse-generation.js
//
// The rules the re-render path has to keep inside runGeneration.js.
//
//   node test-reuse-generation.js
//
// WHY THESE READ THE SOURCE INSTEAD OF RUNNING THE FUNCTION
//
// runGeneration() is fourteen hundred lines that write a directory, call a
// model eleven ways, resize images and charge a card. Driving it to assert
// "this branch was not taken" would mean standing up most of the app, and the
// suite that did it would be slower than the build.
//
// test-business-shape.js already settled this for the section gates and the
// instrument works — but only when the assertion pins the RULE. Its reviews
// test was pinned to the spelling, and adding the re-render path broke it
// while the rule it cared about still held. That is the trap these are
// written against: every assertion below names a failure mode, and the
// mutation list in the commit shows each one being caught.
//
// WHAT THEY CANNOT PROVE is that the code does the right thing at runtime.
// For that, utils/reuseModel.js has a round-trip suite of its own and the
// placeholder guard stops a build that renders wrong. These pin the three
// things a reader of the diff would have to hold in their head at once.
//
//
// THE THREE RULES, AND WHY EACH ONE BITES
//
//   1. A STORED SECTION STAYS BEHIND ITS GATE. The words are already paid
//      for, so nothing else stops a stored pricing table, case study or
//      reviews block coming back after the customer turned it off.
//
//   2. A RE-RENDER IS NOT CHARGED, AND A REFUSED MODEL IS. `reuse` is the
//      model that was read; `ctx.reuse` is what was offered. Testing the
//      offer would hand out free builds on a corrupt file.
//
//   3. INTERLINKS ARE NOT INJECTED TWICE. Stored paragraphs already carry
//      their <a href> tags, so running the injector again nests anchors —
//      which renders, validates, and looks like nothing happened.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'utils', 'runGeneration.js'), 'utf8');

/**
 * The three builders that generate content of their own.
 *
 * runGeneration is not the only place the model is called. These each write
 * a page and each ask for their own copy in there, which is why the resolver
 * has to travel with them — and why "the seams are seven lines in one
 * function" was wrong when somebody first counted.
 */
const BUILDERS = {
  about:    fs.readFileSync(path.join(__dirname, 'utils', 'buildAboutUsPage.js'), 'utf8'),
  contact:  fs.readFileSync(path.join(__dirname, 'utils', 'buildContactPage.js'), 'utf8'),
  location: fs.readFileSync(path.join(__dirname, 'utils', 'buildLocationPages.js'), 'utf8'),
};

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

function section(name) { console.log(`\n${name}\n`); }

(() => {

/* ===================================================================== */
section('THE SOURCE IS THE ONE THIS SUITE THINKS IT IS');

test('runGeneration READS A STORED MODEL AT ALL', () => {
  /* THE TEST THAT FAILS IF THE FEATURE IS REMOVED rather than every
   * assertion below passing vacuously on a file with no reuse path in it.
   * A regex that matches nothing is satisfied by a mutant that deletes the
   * whole thing. */
  assert.ok(/require\('\.\/reuseModel'\)/.test(SRC),
    'runGeneration no longer imports reuseModel');

  assert.ok(/const reuse = ctx\.reuse \? reuseFrom\(ctx\.reuse\) : null;/.test(SRC),
    'the reuse resolver is gone or built differently');
});

/* ===================================================================== */
section('RULE 1 — A STORED SECTION STAYS BEHIND ITS GATE');

/**
 * Each optional section, the gate that decides whether the site has one, and
 * the reuse lookup that must sit inside it.
 *
 * THE GATES ARE NOT THE SAME QUESTION AS "DO WE HAVE THE WORDS". A stored
 * table from a build made before the customer unticked the box, or before
 * the business shape was corrected, is still the wrong thing to render —
 * and because it costs nothing, nothing downstream would have stopped it.
 */
const GATED = [
  { name: 'pricing',   gate: 'wantPricing',  decl: 'const storedPricing = (wantPricing && reuse)' },
  { name: 'reviews',   gate: 'showReviews',  decl: 'const storedReviews = (showReviews && reuse)' },
  { name: 'caseStudy', gate: '!isSample',    decl: 'const storedCaseStudy = (!isSample && reuse)' },
];

for (const { name, gate, decl } of GATED) {
  test(`the stored ${name} is read only when ${gate} says the site has one`, () => {
    assert.ok(SRC.includes(decl),
      `the re-render path can return ${name} past the ${gate} gate — `
      + `expected to find:\n          ${decl}`);
  });
}

test('AND NO STORED SECTION IS READ WITHOUT ITS GATE', () => {
  /* THE OTHER HALF, AND THE ONE THAT CATCHES A SECTION ADDED LATER. The
   * three assertions above check the three that exist; this checks that a
   * fourth has not appeared beside them with the gate left off. Reading the
   * declarations rather than listing them is what makes it hold for code
   * nobody has written yet. */
  const decls = SRC.match(/const stored[A-Za-z]+ = [^;]+;/g) || [];

  assert.ok(decls.length >= 5, `only ${decls.length} stored lookups found`);

  /* THE TWO THAT ARE DELIBERATELY UNGATED, with the reason, because a bare
   * allow-list would quietly accept the next one too.
   *
   *   storedContent  service-page copy. Every service page has copy; there
   *                  is no box to untick.
   *   storedFaqs     the FAQ section is on the page in every mode. See the
   *                  note above fetchPeopleAlsoAsk.
   *   storedCards    generateServiceCards is called unconditionally — no
   *                  mode check, no checkbox, no business-shape capability.
   *                  There is no gate to sit behind. (This entry is here
   *                  because the test demanded it, which is the check
   *                  working: it made somebody go and look rather than
   *                  assume.) */
  const UNGATED = ['storedContent', 'storedFaqs', 'storedCards'];

  for (const decl of decls) {
    const varName = decl.match(/const (stored[A-Za-z]+)/)[1];
    if (UNGATED.includes(varName)) continue;

    assert.ok(/\(\s*!?[A-Za-z]+ && reuse\s*\)/.test(decl),
      `${varName} reads a stored section with no gate in front of it:\n`
      + `          ${decl}\n`
      + '        Either put its gate in the condition, or add it to UNGATED '
      + 'here with the reason it does not need one.');
  }
});

/* ===================================================================== */
section('RULE 2 — A RE-RENDER IS NOT CHARGED, AND A REFUSED MODEL IS');

/* The phrase appears in the comment above the guard as well as in the guard,
 * so the anchor is the template literal — which only the thrown message has.
 * Anchoring on the prose found the comment and read the wrong `if`, and the
 * test passed for the wrong reason. */
const THROWN = SRC.indexOf('Not enough credits: this build needs ${');

test('THE REFUSAL AND THE CHARGE ASK THE SAME QUESTION', () => {
  /* THE BUG THIS PINS. A re-render charges nothing, but the credit CHECK
   * still demanded the full price, so editing two paragraphs on a published
   * site was refused with
   *
   *     Not enough credits: this build needs 3500, you have 0.
   *
   * for a build that was about to take nothing. It went unnoticed because
   * the logo guard above it failed first, so nothing ever reached this line.
   *
   * A CHECK THAT REFUSES MORE THAN THE CHARGE TAKES IS A CHECK FOR A
   * DIFFERENT FEATURE. Asserted as a relationship between the two lines
   * rather than on either alone: that is the thing that was broken, and
   * either line is defensible by itself. */
  /* Read from the `if` that owns the refusal, not from a fixed window of
   * characters before it — a comment between the two would otherwise be
   * what the test was reading. */
  const at = SRC.lastIndexOf('if (', THROWN);
  const guard = SRC.slice(at, THROWN);

  assert.ok(/reuse/.test(guard),
    `the credit refusal does not know about re-renders, so a free rebuild can be refused: ${guard.trim()}`);

  const charge = SRC.slice(SRC.indexOf('const charged ='), SRC.indexOf('const charged =') + 60);

  assert.ok(/reuse/.test(charge), 'the charge no longer turns on reuse');
});

test('AND THE REFUSAL IS STILL THERE FOR A BUILD THAT DOES COST', () => {
  /* The guard was conditioned, not deleted. A normal generation with an
   * empty balance must still be refused before anything is written. */
  assert.match(SRC, /Not enough credits: this build needs/,
    'the credit refusal was removed rather than narrowed');

  const at = SRC.lastIndexOf('if (', THROWN);
  const guard = SRC.slice(at, THROWN);

  assert.ok(/!credit\.ok/.test(guard),
    `the refusal no longer tests whether there are enough credits at all: ${guard.trim()}`);
});

test('THE AMOUNT IS DECIDED ONCE, FROM `reuse`', () => {
  assert.ok(/const charged = reuse \? 0 : credit\.totalCost;/.test(SRC),
    'the charge decision is gone or no longer computed in one place');
});

test('AND IT IS `reuse`, NOT `ctx.reuse` — A REFUSED MODEL STILL PAYS', () => {
  /* THE EXPENSIVE DIRECTION TO BE WRONG IN. `ctx.reuse` is what the caller
   * offered; `reuse` is what reuseFrom() could actually read. A model from a
   * version this build does not understand generates everything from
   * scratch — which costs what a build costs. Keyed on the offer, a corrupt
   * file would buy a free site. */
  const line = (SRC.match(/const charged = [^;]+;/) || [''])[0];

  assert.ok(!/ctx\.reuse/.test(line),
    `the charge decision reads the offered model rather than the read one:\n          ${line}`);
});

test('chargeCredits IS CALLED ONCE, AND ONLY ON THE GENERATED BRANCH', () => {
  /* ONE CALL. A second one added later "for the reuse case" is how a
   * re-render starts costing money again, and the only symptom is a
   * customer's balance. */
  assert.strictEqual((SRC.match(/await chargeCredits\(/g) || []).length, 1,
    'chargeCredits is called more than once in runGeneration');

  const after = SRC.slice(SRC.indexOf('const charged = reuse ? 0'));
  const call = after.indexOf('await chargeCredits(');
  const elseAt = after.indexOf('} else {');

  assert.ok(elseAt > -1 && call > elseAt,
    'chargeCredits no longer sits on the else branch of the reuse check');
});

test('AND BOTH THE LOG AND THE RETURN REPORT WHAT WAS ACTUALLY TAKEN', () => {
  /* WRITTEN SEPARATELY, these drifted: the log and the return value went on
   * announcing credit.totalCost while a re-render charged nothing. A figure
   * wrong in the customer's favour is the kind nobody reports. */
  assert.strictEqual((SRC.match(/creditsCharged: charged,/g) || []).length, 2,
    'the log and the return value no longer report the same charged amount');

  assert.ok(!/creditsCharged: credit\.totalCost/.test(SRC),
    'something still reports the full price on a re-render');
});

/* ===================================================================== */
section('RULE 3 — INTERLINKS ARE NOT INJECTED TWICE');

test('A RE-RENDER TAKES THE LOGO FROM THE STORED MODEL, NOT FROM AN UPLOAD', () => {
  /* THE BUG THIS EXISTS FOR, AND IT KILLED EVERY SAVE. The edit screen calls
   * runGeneration with `files: []` on purpose — images are restored from the
   * site's own store after the build. But the required-files guard read an
   * empty `files` as a job that had outrun its upload and threw
   *
   *     "This build started before its logo was attached ... please press
   *      Generate again."
   *
   * on a screen with no Generate button, for a file that was in the store
   * the whole time. The words were saved and the site was never rebuilt.
   *
   * THE PATHS MUST COME FROM THE STORED global, not from a fresh upload: a
   * re-uploaded logo lands under a new hashed filename, and restoreAssets
   * would then put back the files that nothing references. */
  const seed = SRC.slice(SRC.indexOf('if (reuse && !uploadedImages.global.logo)'),
                         SRC.indexOf('if (!uploadedImages.global.logo) {'));

  assert.ok(seed, 'nothing seeds the logo for a re-render');
  assert.ok(/stored\.logo/.test(seed) && /stored\.favicon/.test(seed),
    'the favicon is not carried across with the logo');
  assert.ok(/reuse\.global/.test(seed),
    'the paths are not read off the stored model');

  /* BEFORE THE GUARD, NOT INSIDE IT. Seeded first, everything downstream —
   * the <img>, the JSON-LD, the favicon link — goes on reading one field and
   * never learns that two kinds of build exist. */
  assert.ok(SRC.indexOf('if (reuse && !uploadedImages.global.logo)')
          < SRC.indexOf('if (!uploadedImages.global.logo) {'),
    'the seed runs after the guard it exists to satisfy');
});

test('AND A STORED SITE WITH NO LOGO GETS ITS OWN SENTENCE', () => {
  /* Neither old message fits a re-render: there was no upload to outrun and
   * no file to try again. Telling somebody to re-upload a file they were
   * never asked for is the failure the two-message split already fixed
   * once. */
  const guard = SRC.slice(SRC.indexOf('if (!uploadedImages.global.logo) {'),
                          SRC.indexOf('The logo could not be processed'));

  assert.ok(/if \(reuse\)/.test(guard), 'a re-render still gets the upload advice');
  assert.ok(/cannot be re-rendered/.test(guard), 'the message does not say what went wrong');
});

test('STORED PARAGRAPHS SKIP injectPagesInterlinks', () => {
  /* The paragraphs in content.json are POST-injection: the model is built
   * from `sectionsWithLinks`, so the anchors are already in the stored text.
   * Run the injector again and it finds the phrases it means to link already
   * inside <a> tags, and nests them.
   *
   * IT RENDERS. That is what makes this worth pinning — a nested anchor
   * produces no error anywhere, and the page looks almost right. */
  assert.ok(/const sectionsWithLinks = storedContent\s*\r?\n?\s*\? sections\s*\r?\n?\s*: injectPagesInterlinks\(/.test(SRC),
    'stored page content is being sent through the interlink injector again');
});

test('AND THE INJECTOR IS STILL REACHED ON A NORMAL BUILD', () => {
  /* The other half. Its own comment says it is called in EVERY mode,
   * including the ones with no interlinks, because its first act is
   * stripMarkdownLinks() — skip it on a generated page and raw
   * [water heater repair](…) ships in the copy. */
  /* ONE CALL. The import is a bare name in the destructure from
   * pageGenerator, so it carries no parenthesis and is checked separately —
   * which this test learned by asserting two and finding one. */
  assert.strictEqual((SRC.match(/injectPagesInterlinks\(/g) || []).length, 1,
    'injectPagesInterlinks is called more than once — only the gated call may exist');

  assert.ok(/^\s*injectPagesInterlinks,$/m.test(SRC),
    'injectPagesInterlinks is no longer imported — the call above cannot be the real one');
});

/* ===================================================================== */
section('THE THREE BUILDERS THAT GENERATE THEIR OWN COPY');

/**
 * Each builder, its generation call, and the stored value that must stand in
 * front of it.
 *
 * `inject` is the interlink call that must NOT run over stored text — the
 * same rule as the service pages, for the same reason, in three more places.
 */
const SEAMS = [
  { file: 'about',    stored: 'storedAbout',        gen: 'generateAboutUsContent(',      inject: 'injectIndexInterlinks(' },
  { file: 'contact',  stored: 'storedIntro',        gen: 'generateContactContent(',      inject: 'injectPagesInterlinks(' },
  { file: 'location', stored: 'storedLocation',     gen: 'generateLocationPagesContent(', inject: 'injectPagesInterlinks(' },
  { file: 'location', stored: 'storedLocationFaqs', gen: 'generateLocationFaq(' },
];

for (const { file, stored, gen } of SEAMS) {
  test(`${file}: ${gen.replace('(', '')} is reached only when ${stored} is empty`, () => {
    const src = BUILDERS[file];

    /* `\s*` BETWEEN THE NAME AND THE ||, because two of these three wrap the
     * fallback onto the next line and the first version of this test failed
     * on the layout while the rule held. The same mistake test-business-shape
     * made, in a test written to avoid it. */
    assert.ok(new RegExp(`${stored}\\s*\\|\\|`).test(src),
      `${file} does not fall back from ${stored} to ${gen}`);

    assert.strictEqual((src.match(new RegExp(gen.replace(/[(]/g, '\\('), 'g')) || []).length, 1,
      `${gen} appears more than once in ${file} — only the one behind ${stored} may exist`);
  });
}

/**
 * The guard in front of each injector, spelled per file.
 *
 * THE SHAPES DIFFER BECAUSE THE CODE AROUND THEM DOES. About and location
 * assign the result, so a ternary reads best. Contact's injection sits in a
 * try/catch whose whole job is "a failure here never blanks the page", so the
 * guard wraps the try rather than hiding inside it.
 *
 * WRITTEN OUT RATHER THAN SNIFFED FOR. A proximity check — "is the stored
 * variable mentioned somewhere near the call" — passes on a mention in a
 * comment, and these three files have a lot of comment.
 */
const INJECTION_GUARDS = {
  about:    /storedAbout\s*\r?\n?\s*\? sections\s*\r?\n?\s*: injectIndexInterlinks\(/,
  location: /storedLocation \? sections : injectPagesInterlinks\(/,
  contact:  /if \(!storedIntro\) \{\s*\r?\n\s*try \{/,
};

for (const { file, inject } of SEAMS.filter(s => s.inject)) {
  test(`${file}: stored copy skips ${inject.replace('(', '')}`, () => {
    /* Stored paragraphs already carry their anchors — the model is built
     * from the post-injection text in every one of these files. Injecting
     * again nests anchors, which renders and looks almost right. */
    const src = BUILDERS[file];

    assert.ok(src.includes(inject), `${inject} is gone from ${file}`);

    assert.ok(INJECTION_GUARDS[file].test(src),
      `${file} sends stored copy through ${inject} again — the guard this test `
      + `expects is:\n          ${INJECTION_GUARDS[file]}`);
  });
}

test('EVERY BUILDER TAKES THE RESOLVER, AND DEFAULTS TO NOT HAVING ONE', () => {
  /* AN OPTIONS OBJECT, LAST, DEFAULTED. These have eleven, six and eight
   * positional parameters; a required twelfth would break every existing
   * caller and every test that builds a page directly. */
  for (const [name, src] of Object.entries(BUILDERS)) {
    assert.ok(/\{ reuse = null \} = \{\}/.test(src),
      `${name} does not take an optional { reuse } — an absent model must behave as before`);
  }
});

test('AND runGeneration HANDS IT TO ALL THREE', () => {
  /* THE WIRING GAP THIS PROJECT KEEPS FINDING. Three builders that accept a
   * resolver and a caller that passes none is a feature that is fully built
   * and never runs — and every test above would still pass. */
  assert.strictEqual((SRC.match(/\{ reuse \}/g) || []).length, 3,
    'runGeneration no longer passes { reuse } to exactly the three builders');
});

test('A REUSED TOWN STILL DECLARES ITS QUESTIONS', () => {
  /* generateLocationFaq is handed the shared `usedFaqQuestions` map and adds
   * to it as it goes — that is what stops town three asking town one's
   * question. A reused town never calls it.
   *
   * Without the line this pins, a half-reused build — one new town among
   * four stored ones — can generate a duplicate, and the symptom is two
   * pages on one site answering the same question. */
  assert.ok(/if \(storedLocationFaqs\) addUsedQuestions\(usedFaqQuestions, storedLocationFaqs\);/
    .test(BUILDERS.location),
    'a reused town no longer adds its questions to the shared no-repeat map');

  assert.ok(/addUsedQuestions \} = require\('\.\/generateLocationFaq'\)/.test(BUILDERS.location),
    'addUsedQuestions is not imported — the call above cannot work');
});

/* ===================================================================== */
section('WHAT THE RE-RENDER STILL COSTS, SAID IN THE SOURCE');

test('generateReview IS STILL CALLED, AND THE SOURCE SAYS WHY', () => {
  /* It fabricates the JSON-LD review per service page and nothing records it
   * in content.json, so there is nothing to reuse. That makes a re-render
   * CHEAPER, NOT FREE.
   *
   * ASSERTED SO THAT THE DAY SOMEBODY MAKES IT REUSABLE, THEY FIND THIS
   * NOTE — and so that "nothing is charged" never reaches a screen while it
   * is still untrue. */
  assert.ok(/await generateReview\(/.test(SRC),
    'generateReview is gone — if it is now reusable, update reuseModel.js and this test');

  assert.ok(/CHEAPER, NOT FREE/.test(SRC),
    'the note saying a re-render still costs a model call per service page is gone');
});

test('A MODEL THAT WAS OFFERED AND REFUSED IS LOGGED', () => {
  /* Falling through silently charges for a site the customer was told would
   * cost nothing. The log line is the only place that difference is
   * visible. */
  assert.ok(/generation\.reuse_refused/.test(SRC),
    'a refused model no longer leaves a trace');
});

/* ===================================================================== */

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

})();
