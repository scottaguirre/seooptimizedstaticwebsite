// test-wizard-steps.js
//
// The wizard's steps, and the one rule that holds the split together.
//
// WHY THIS EXISTS
//
// Service pages and location pages shared a step until 21 September. With the
// suggestion panel sitting above the rows it had become a wall, so locations
// moved to a step of their own.
//
// Splitting a step is not moving markup. Both lists feed the credit quote,
// the service-suggestion call and the draft saved on the way to buy credits —
// and all three read the DOM first, falling back to `state`. The moment only
// one list is on screen, that fallback is the ONLY source the other has. So
// every path out of a step has to write its values into `state`, in both
// directions. Miss one and the customer is quoted for a site with no service
// pages, or buys credits and comes back to an empty list.
//
// This suite reads the wizard's source, because the file is a browser IIFE
// with no exports and the container has no DOM. Every check runs over a copy
// with the comments stripped: comments in this project have matched the greps
// looking for the code they describe five separate times.
//
//   node test-wizard-steps.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

const RAW = fs.readFileSync(
  path.join(__dirname, 'public/js/generateDinamycForm.js'), 'utf8');

function withoutComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !/^\s*\/\//.test(line))
    .join('\n');
}

const JS = withoutComments(RAW);

/** The body of a top-level function in the wizard, comments stripped. */
function bodyOf(name) {
  const at = JS.indexOf(`function ${name}(`);
  assert.notStrictEqual(at, -1, `${name}() has been renamed or removed`);

  // Up to the next top-level function, which is enough to scope every check
  // here and keeps one step's assertions from passing on another's code.
  const next = JS.indexOf('\n  function ', at + 10);
  return next === -1 ? JS.slice(at) : JS.slice(at, next);
}

console.log('\nWizard steps\n');

/* -------------------------------------------------------------------------
 * The steps
 * ---------------------------------------------------------------------- */

test('locations are a step of their own, after services', () => {
  assert.ok(/LOCATIONS:\s*6/.test(JS), 'there is no locations step');
  assert.ok(/PAGES:\s*5/.test(JS), 'the service pages step moved');
  assert.ok(/REVIEW:\s*7/.test(JS), 'review did not move to make room');
});

test('the steps array matches the constants, in order', () => {
  // A step whose index and renderer disagree sends people to the wrong
  // screen, and nothing throws — it just renders something unexpected.
  const array = JS.slice(JS.indexOf('const steps = ['));
  const order = array.slice(0, array.indexOf(']'))
    .split('\n')
    .map(line => (line.match(/render\w+/) || [])[0])
    .filter(Boolean);

  assert.deepStrictEqual(order, [
    'renderSiteModeStep',
    'renderBusinessTypeStep',
    'renderLogoStep',
    'renderDesignStep',
    'renderMainForm',
    'renderPagesStep',
    'renderLocationsStep',
    'renderReviewStep',
  ]);
});

test('the combined step is gone, not just bypassed', () => {
  assert.ok(!/renderPagesAndLocationsStep/.test(JS),
    'the old combined step is still in the file and can still be reached');
});

test('each step heading numbers itself from its own constant', () => {
  // Hard-coding "6." and "7." is how the numbers drift apart from the order
  // the wizard actually walks.
  assert.ok(/stepNumber\(STEP\.PAGES\)\}\. Service Pages/.test(RAW));
  assert.ok(/stepNumber\(STEP\.LOCATIONS\)\}\. Location Pages/.test(RAW));
});

/* -------------------------------------------------------------------------
 * The rule: every way out of a step saves that step
 *
 * This is the whole reason the split is risky. Both lists feed the credit
 * quote, the suggestion call and the draft, and each reads the DOM first.
 * ---------------------------------------------------------------------- */

test('leaving the service pages step BACKWARDS still saves the rows', () => {
  // Forwards is obvious and was never the bug. Going back to the main form
  // and returning is what loses work, because nothing else writes state.pages.
  const body = bodyOf('renderPagesStep');
  const back = body.slice(body.indexOf("backBtn.addEventListener('click'"));

  assert.ok(/savePages\(\);/.test(back.slice(0, 300)),
    'Back leaves the service rows unsaved');
  assert.ok(/go\(STEP\.MAIN\)/.test(back.slice(0, 300)));
});

test('leaving the service pages step FORWARDS saves the rows', () => {
  const body = bodyOf('renderPagesStep');
  const next = body.slice(body.indexOf("nextBtn.addEventListener('click'"));

  assert.ok(/state\.pages = pagesVals;/.test(next), 'the rows never reach state');
  assert.ok(/go\(STEP\.LOCATIONS\)/.test(next), 'Next does not go to the locations step');
});

test('leaving the locations step BACKWARDS saves the list and the toggle', () => {
  const body = bodyOf('renderLocationsStep');
  const back = body.slice(body.indexOf("backBtn.addEventListener('click'"));

  assert.ok(/saveLocations\(locToggle\);/.test(back.slice(0, 300)),
    'Back leaves the locations unsaved');
  assert.ok(/go\(STEP\.PAGES\)/.test(back.slice(0, 300)));
});

test('leaving the locations step FORWARDS saves the list and the toggle', () => {
  const body = bodyOf('renderLocationsStep');
  const next = body.slice(body.indexOf("nextBtn.addEventListener('click'"));

  assert.ok(/state\.addLocations = addLoc;/.test(next));
  assert.ok(/state\.locations = locVals;/.test(next));
  assert.ok(/go\(STEP\.REVIEW\)/.test(next));
});

test('saving a list that is not on screen does not wipe it', () => {
  // savePages() runs from a step where the rows may not exist. Reading an
  // empty NodeList and writing it to state would erase the customer's work
  // in the one situation the function exists to prevent.
  const body = bodyOf('savePages');
  assert.ok(/if \(!pi\.length\) return;/.test(body),
    'savePages overwrites state.pages with an empty list when the rows are absent');

  const loc = bodyOf('saveLocations');
  assert.ok(/if \(!toggle\) return;/.test(loc),
    'saveLocations runs without the toggle it reads');
});

test('the toggle decides whether locations are saved at all', () => {
  // With the switch off the list must go to empty, or a customer who turned
  // it off is still charged for the cities they typed first.
  const body = bodyOf('saveLocations');
  assert.ok(/state\.addLocations\s*\n?\s*\?/.test(body),
    'the list is saved regardless of the toggle');
  assert.ok(/:\s*\[\];/.test(body), 'turning the toggle off leaves the old cities in state');
});

/* -------------------------------------------------------------------------
 * Errors have to land where the field is
 * ---------------------------------------------------------------------- */

test('a location problem at submit sends them to the locations step', () => {
  // These guards ran when both lists shared a screen. Left alone they now
  // drop someone on the service pages with a complaint about a city, and
  // nothing on that screen to fix.
  const submit = JS.slice(JS.indexOf("form.addEventListener('submit'"));

  const dupes = submit.slice(submit.indexOf('submitLocDupes'));
  assert.ok(/go\(STEP\.LOCATIONS\)/.test(dupes.slice(0, 500)),
    'a duplicate city sends them to the wrong step');

  const empty = submit.slice(submit.indexOf('addLoc && locVals.length === 0'));
  assert.ok(/go\(STEP\.LOCATIONS\)/.test(empty.slice(0, 400)),
    'an empty location list sends them to the wrong step');
});

test('a service-page problem at submit still sends them to the pages step', () => {
  // The other half of the same change: these must NOT have moved.
  const submit = JS.slice(JS.indexOf("form.addEventListener('submit'"));

  const empty = submit.slice(submit.indexOf('pagesVals.length === 0'));
  assert.ok(/go\(STEP\.PAGES\)/.test(empty.slice(0, 400)));

  const dupes = submit.slice(submit.indexOf('submitPageDupes'));
  assert.ok(/go\(STEP\.PAGES\)/.test(dupes.slice(0, 500)));
});

test("the review card's two rows point at their own steps", () => {
  const review = bodyOf('renderReviewStep');

  const services = review.slice(review.indexOf('Service pages ('));
  assert.ok(/STEP\.PAGES\)/.test(services.slice(0, 300)),
    'the service pages row edits the wrong step');

  const locations = review.slice(review.indexOf('Location pages ('));
  assert.ok(/STEP\.LOCATIONS\)/.test(locations.slice(0, 400)),
    'the locations row edits the wrong step');
});

test('Back from the review step lands on the step before it', () => {
  const review = bodyOf('renderReviewStep');
  const nav = review.slice(review.indexOf('renderNav(container'));
  assert.ok(/onBack: \(\) => go\(STEP\.LOCATIONS\)/.test(nav.slice(0, 500)),
    'Back from review skips the locations step');
});

/* -------------------------------------------------------------------------
 * What has to have travelled with each half
 * ---------------------------------------------------------------------- */

test('the credit gate travelled with the Add location button', () => {
  // It intercepts in the CAPTURE phase because the real handler lives in
  // locationPages.js. Left on the other step it would never fire, and
  // someone could add locations past their balance in silence.
  const body = bodyOf('renderLocationsStep');

  assert.ok(/addLocBtn\.addEventListener\('click'/.test(body), 'the button lost its gate');
  assert.ok(/fetchQuote\(\{ extraLocations: 1 \}\)/.test(body), 'the gate no longer prices anything');
  assert.ok(/\}, true\);/.test(body), 'the capture-phase flag was dropped');
  assert.ok(/showCreditsModal\(q\)/.test(body));
});

test('the suggestion panel stayed with the service pages', () => {
  const pages = bodyOf('renderPagesStep');
  assert.ok(/mountSuggestPanel\(suggestWrap, pagesList\)/.test(pages),
    'the suggestion panel did not come with the service pages');

  const locations = bodyOf('renderLocationsStep');
  assert.ok(!/mountSuggestPanel/.test(locations),
    'the suggestion panel is mounted on the locations step too');
});

test('the Add page gate stayed with the service pages', () => {
  const pages = bodyOf('renderPagesStep');
  assert.ok(/fetchQuote\(\{ extraPages: 1 \}\)/.test(pages), 'Add page lost its credit check');
});

test('neither step reads values out of the other one\'s list', () => {
  // A stray read of the other list's DOM returns an empty NodeList and
  // silently behaves as though the customer had entered nothing.
  //
  // The mirror block is the one legitimate exception: it asks whether the
  // service rows are ON SCREEN so it knows whether to mirror them, which is
  // a presence test, not a read. So this checks the handlers that run BEFORE
  // the mirrors are built.
  const pages = bodyOf('renderPagesStep');
  assert.ok(!/#locationsList/.test(pages), 'the pages step still reaches for the locations');

  const locations = bodyOf('renderLocationsStep');
  const beforeMirrors = locations.slice(0, locations.indexOf('js-hidden-mirror'));
  assert.ok(!/#pagesList/.test(beforeMirrors),
    'the locations step reads the service rows out of a DOM that no longer has them');

  const mirrors = locations.slice(locations.indexOf('js-hidden-mirror'));
  mirrors.split('\n')
    .filter(line => line.includes('#pagesList'))
    .forEach(line => {
      assert.ok(/!!form\.querySelector\(/.test(line),
        `the mirror block does more than test for presence: ${line.trim()}`);
    });
});

test('the hidden mirrors are still built on the way to review', () => {
  // The review step and the final submit read these, not the DOM — the
  // inputs are gone by then. They were at the end of the combined step's
  // submit handler and had to travel to the locations step with it.
  const body = bodyOf('renderLocationsStep');

  assert.ok(/js-hidden-mirror/.test(body), 'nothing mirrors the values for review');
  assert.ok(/hiddenLogoInput\.files = dt2\.files;/.test(body), 'the logo is no longer mirrored');

  // Each list is mirrored only when it is NOT on screen, and after the split
  // it never is — so these two branches are now the normal path, not the
  // exception. Asserting the name alone would let the test pass with the
  // check hard-wired to true and nothing mirrored at all.
  assert.ok(/hasPageInputsInDom = !!form\.querySelector\('#pagesList/.test(body),
    'the service pages are mirrored on a guess rather than a look at the DOM');
  assert.ok(/if \(!hasPageInputsInDom\) \{[\s\S]{0,400}?state\.pages\.forEach/.test(body),
    'nothing writes the service pages into the hidden mirror');

  assert.ok(/hasLocationInputsInDom = !!form\.querySelector\('#locationsList/.test(body),
    'the locations are mirrored on a guess rather than a look at the DOM');
  assert.ok(/if \(!hasLocationInputsInDom\) \{[\s\S]{0,600}?state\.locations\.forEach/.test(body),
    'nothing writes the locations into the hidden mirror');
});

/* -------------------------------------------------------------------------
 * The draft left behind by a trip to buy credits
 *
 * Someone runs out of credits mid-form, goes to buy more, and comes back.
 * Everything they typed is in sessionStorage; what matters is what comes back
 * with it and where they land.
 * ---------------------------------------------------------------------- */

/** Pull a function out of the wizard and run it. */
function extract(name, scope = {}) {
  const src = RAW.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n {2}\\}`));
  assert.ok(src, `${name}() has been renamed or reshaped`);

  const keys = Object.keys(scope);
  const make = new Function(...keys, `${src[0]}; return ${name};`);
  return make(...keys.map(k => scope[k]));
}

const STEP_FIXTURE = { MODE: 0, TYPE: 1, LOGO: 2, DESIGN: 3, MAIN: 4, PAGES: 5, LOCATIONS: 6, REVIEW: 7 };

test('a restored draft lands on the logo step, not where they left off', () => {
  // The logo is the one answer a draft cannot carry: browsers do not let
  // JavaScript set a file input's value. Dropping somebody back on the
  // service pages would mean a refusal at submit for a field three steps
  // behind them.
  const resume = extract('draftResumeStep', { STEP: STEP_FIXTURE });

  assert.strictEqual(resume({ step: 6 }), STEP_FIXTURE.LOGO, 'a late step does not come back to the logo');
  assert.strictEqual(resume({ step: 5 }), STEP_FIXTURE.LOGO);
  assert.strictEqual(resume({ step: 7 }), STEP_FIXTURE.LOGO);
});

test('somebody who never reached the logo step is not sent forward to it', () => {
  // They have no logo and no design yet; skipping them past those screens
  // would hand them a wizard with holes behind them.
  const resume = extract('draftResumeStep', { STEP: STEP_FIXTURE });

  assert.strictEqual(resume({ step: 0 }), 0);
  assert.strictEqual(resume({ step: 1 }), 1);
  assert.strictEqual(resume({ step: 2 }), 2);
});

test('a draft with no step, or a nonsense one, still lands somewhere sane', () => {
  // Drafts written before this existed have no step at all, and sessionStorage
  // is editable by anyone who opens the console.
  const resume = extract('draftResumeStep', { STEP: STEP_FIXTURE });

  for (const junk of [undefined, null, {}, { step: -1 }, { step: 99 }, { step: 'six' }, { step: 2.5 }]) {
    assert.strictEqual(resume(junk), STEP_FIXTURE.LOGO, `${JSON.stringify(junk)} did not land on the logo step`);
  }
});

test('the draft carries the suggestion lists, not just the rows', () => {
  // Without them the ticked services came back as rows with no tick boxes —
  // the orphaned-row problem from the Delete button, reached another way —
  // and the two presses were silently handed back.
  const save = bodyOf('saveDraft');

  assert.ok(/suggestionBatches: state\.suggestionBatches/.test(save),
    'the suggestion lists are not saved');
  assert.ok(/suggestionsFor: state\.suggestionsFor/.test(save),
    'the business type they were for is not saved, so they are cleared on arrival');
  assert.ok(/step: current/.test(save), 'the step they were on is not saved');
});

test('the draft restores the suggestion lists, and copes without them', () => {
  const apply = bodyOf('applyDraft');

  assert.ok(/Array\.isArray\(draft\.suggestionBatches\) \? draft\.suggestionBatches : \[\]/.test(apply),
    'an older draft with no suggestion lists would restore undefined');
  assert.ok(/String\(draft\.suggestionsFor \|\| ''\)/.test(apply));
});

test('the wizard opens on the resumed step, and only when there is a draft', () => {
  const boot = JS.slice(JS.indexOf("document.addEventListener('DOMContentLoaded'"));

  assert.ok(/let resumeAt = STEP\.MODE;/.test(boot), 'there is no default for a first visit');
  assert.ok(/resumeAt = draftResumeStep\(draft\);/.test(boot), 'the draft never sets where to resume');
  assert.ok(/go\(resumeAt\);/.test(boot), 'the wizard still opens on step 1 regardless');
});

test('Start Over still goes back to the beginning', () => {
  // It shares the bootstrap's job of choosing a step and must NOT follow it
  // to the logo: starting over means starting over.
  const body = bodyOf('startOver');
  assert.ok(/go\(STEP\.MODE\);/.test(body), 'Start Over no longer returns to the first step');
});

test('Start Over clears the suggestion lists too', () => {
  const body = bodyOf('startOver');
  assert.ok(/state\.suggestionBatches = \[\];/.test(body),
    "a new site inherits the last one's suggestions");
});

test('the restore notice says the logo is the thing to redo', () => {
  // They land on a screen asking for a file they thought they had chosen.
  // Without a sentence saying why, that reads as the form having lost it.
  const notice = bodyOf('showDraftNotice');
  assert.ok(/logo step/.test(notice), 'the notice does not explain where they are');
  assert.ok(/file field/.test(notice), 'the notice does not say why the logo is missing');
});

test('the context badges are all one colour', () => {
  // Four colours read as four kinds of thing, and on the location step they
  // sat in a row with the header buttons, a Delete button and three footer
  // buttons — coloured chips that look pressable and are not. One class,
  // applied in one place, so a fifth badge cannot reintroduce the problem
  // just by being added.
  const body = bodyOf('contextBadges');

  assert.ok(/badge \$\{BADGE_CLASS\}/.test(body),
    'the badges no longer share a single class');

  const colours = body.match(/text-bg-(primary|success|info|warning|danger|dark)\b/g);
  assert.strictEqual(colours, null,
    `a coloured badge is back: ${colours && colours.join(', ')}`);
});

test('the one badge class is the light one', () => {
  // Asserted on the constant rather than inside contextBadges, so that
  // moving the value cannot quietly change it.
  assert.ok(/const BADGE_CLASS = 'text-bg-light text-dark';/.test(JS),
    'BADGE_CLASS is not light-background, dark-text');
});

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('');
process.exit(failed === 0 ? 0 : 1);
