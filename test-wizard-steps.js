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

/* The same, for a check that has to start a server. Separate rather than
 * making test() async, because every other test in this file is
 * synchronous and awaiting them all would be a change to ninety-odd
 * callers for the sake of two. */
async function asyncTest(name, fn) {
  try { await fn(); console.log(`  ok    ${name}`); passed++; }
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

/**
 * The main form's markup, as a given mode renders it.
 *
 * WHY THE TEMPLATE IS EVALUATED RATHER THAN GREPPED.
 *
 * renderMainForm() builds one template literal with five mode conditionals
 * nested in it, and whether a control reaches the page is the product of all
 * of them. Matching source text answers "is there a conditional", which is
 * not the question — it passes just as happily when a sixth control is added
 * with no conditional at all, and it cannot see a stranded <hr>.
 *
 * So the literal is cut out of the file and evaluated with the handful of
 * things it closes over stubbed. That is a narrow, brittle trick and it is
 * the honest one here: it tests the HTML the customer is served.
 *
 * It depends on renderMainForm containing exactly one `block.innerHTML =`
 * template literal. If that stops being true this throws rather than
 * quietly measuring the wrong string.
 */
/* `target` JOINED THE SIGNATURE ON 17 NOVEMBER, with Cloudflare Local
 * Automation. Step 3's domain control is no longer decided by the mode
 * alone: that door locks `localoptions` AND a Cloudflare destination, and
 * asks for no domain at all — the address is chosen in "Where it goes".
 *
 * DEFAULTS TO NO DESTINATION, so every existing call renders exactly the
 * page it rendered before. */
function mainFormHtml(siteMode, businessType = 'Plumbing', designs = null, target = '') {
  const from = RAW.indexOf('function renderMainForm(');
  assert.notStrictEqual(from, -1, 'renderMainForm() has been renamed or removed');

  const at = RAW.indexOf('block.innerHTML = `', from);
  assert.notStrictEqual(at, -1, 'renderMainForm no longer builds one innerHTML template');

  const open = RAW.indexOf('`', at);

  /* The matching close, counting ${ } so a nested literal does not end it. */
  let i = open + 1;
  let depth = 0;
  let end = -1;

  while (i < RAW.length) {
    const c = RAW[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`' && depth === 0) { end = i; break; }
    if (c === '$' && RAW[i + 1] === '{') { depth += 1; i += 2; continue; }
    if (c === '}' && depth > 0) { depth -= 1; i += 1; continue; }
    i += 1;
  }

  assert.notStrictEqual(end, -1, 'the main form template literal is unterminated');

  /* OFFERED_DESIGNS AND escapeHtml JOINED THE SCOPE ON 17 NOVEMBER, when the
   * design dropdown stopped being three hand-typed <option> elements and
   * became a list built from what the server hands the page. Nine tests in
   * this file failed with "OFFERED_DESIGNS is not defined" — which is this
   * helper working exactly as its note above says: a stub that goes missing
   * THROWS rather than quietly measuring a shorter string.
   *
   * THE REAL LIST BY DEFAULT, read from designs.js rather than invented, so
   * a test about the dropdown is a test about what the wizard offers. */
  /* asksForDomain AND picksPoolDomain JOINED THE SCOPE ON 17 NOVEMBER, when
   * step 3's domain control gained a third answer. Nine tests in this file
   * failed with "asksForDomain is not defined" — which is this helper
   * working exactly as its note above says: a stub that goes missing THROWS
   * rather than quietly measuring a shorter string. */
  const render = new Function(
    'state', 'isLocalOptions', 'canHavePricingTable', 'canHaveBadges',
    'OFFERED_DESIGNS', 'escapeHtml', 'asksForDomain', 'picksPoolDomain',
    `return ${RAW.slice(open, end + 1)};`
  );

  const offered = designs || require('./utils/localOptions/designs')
    .designsFor('localoptions')
    .map(d => ({ id: d.id, label: d.label, note: d.note }));

  const html = render(
    { siteMode, businessType },
    () => siteMode === 'localoptions',
    () => true,
    () => true,
    siteMode === 'localoptions' ? offered : [],
    (v) => String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;'),

    /* THE SAME TWO RULES THE FILE ITSELF DEFINES, not an approximation:
     * neither field when the mode publishes itself AND the destination is
     * Cloudflare, the picker when it publishes itself anywhere else, the
     * text box otherwise. */
    () => !(siteMode === 'localoptions' && target === 'cloudflare'),
    () => siteMode === 'localoptions' && target !== 'cloudflare'
  );

  /* HTML COMMENTS STRIPPED, because they are part of the output string and
   * they are long. A comment EXPLAINING why a control was removed contains
   * that control's name, so `html.includes('trustClaims')` matched the
   * explanation and reported the field still present. Found by running the
   * check and not believing the answer. */
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

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

  /* THE NUMBER IS WHAT THIS TEST IS ABOUT, NOT THE WORDS.
   *
   * It read `stepNumber(STEP.LOCATIONS)}. Location Pages` and failed on 28
   * October, when that heading became conditional: Local Website Options
   * builds no location pages and calls the step "Service Area", because the
   * towns it collects are the area in the footer and the schema rather than
   * pages anybody is charged for.
   *
   * ASSERTING THE TITLE WOULD HAVE BEEN THE WRONG FIX IN EITHER DIRECTION.
   * Pinning both titles makes this a test about captions that fails every
   * time one is reworded; deleting the line gives up the only thing it was
   * ever guarding, which is that the number comes from the constant and not
   * from somebody counting the steps by hand. So it asserts the interpolation
   * and the full stop, and says nothing about what follows them. */
  assert.ok(/stepNumber\(STEP\.LOCATIONS\)\}\. /.test(RAW),
    'the locations heading no longer numbers itself from STEP.LOCATIONS');
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

  /* ⚠ THE RESUMED STEP GAINED A SECOND CASE ON 18 November, and this
   * assertion reported it, which is what it is for.
   *
   * An ordinary restore still goes to the logo step — a browser will not
   * let a page refill a file input, so it is the one answer a draft cannot
   * carry. A BATCH ADD goes to the main form instead: "Add another site"
   * reloads on purpose, a batch cannot contain an uploaded logo at all, and
   * the logo step is three steps away from the two fields that differ
   * between sites.
   *
   *     THE RIGHT PLACE TO COME BACK TO IS THE FIRST THING YOU HAVE TO
   *     CHANGE, AND THAT IS NOT THE SAME PLACE FOR BOTH.
   *
   * Both halves are asserted, so neither can quietly become the other. */
  assert.ok(/resumeAt = justAdded \? STEP\.MAIN : draftResumeStep\(draft\);/.test(boot),
    'the draft never sets where to resume');
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

test('no badge anywhere in the wizard is coloured', () => {
  // Scoped to contextBadges(), the earlier test missed one: the LOGO step
  // built its own "Business Type" badge inline, in blue, and it shipped that
  // way. The badges are a sentence about the site broken into chips, wherever
  // they are drawn — so the check is over the whole file, not one function.
  const badges = JS.match(/text-bg-(primary|success|info|warning|danger|dark)\b/g);
  assert.strictEqual(badges, null,
    `a coloured badge is back: ${badges && badges.join(', ')}`);
});

test('every badge is built from the shared constant', () => {
  // The way the LOGO step drifted was by hard-coding its own class. Counting
  // them keeps a new badge from doing the same thing in the same colour.
  const uses = (JS.match(/class="badge \$\{BADGE_CLASS\}"/g) || []).length
             + (JS.match(/`<span class="badge \$\{BADGE_CLASS\}">/g) || []).length
             + (JS.match(/badge \$\{BADGE_CLASS\}/g) || []).length;
  assert.ok(uses >= 2, `only ${uses} badge(s) use BADGE_CLASS`);
});

test('the one badge class is the light one', () => {
  // Asserted on the constant rather than inside contextBadges, so that
  // moving the value cannot quietly change it.
  assert.ok(/const BADGE_CLASS = 'text-bg-light text-dark';/.test(JS),
    'BADGE_CLASS is not light-background, dark-text');
});

/* -------------------------------------------------------------------------
 * The buttons at the bottom of every step
 * ---------------------------------------------------------------------- */

const FORM_HTML = fs.readFileSync(
  path.join(__dirname, 'src/views/form.html'), 'utf8');

test('NO PAGE RULE FLATTENS THE SPACE ABOVE THE BUTTONS', () => {
  /* form.html carried `.card .mt-4 { margin-top: 0 !important }`. Every
   * element inside that card wearing `mt-4` was a Back/Next row, so the rule
   * had exactly one effect: Back and Generate sat flush against the card
   * above them on every step, and `!important` meant the markup could not
   * ask for the gap back.
   *
   * THE RULE IS CHECKED, not the pixel value. A later designer moving 2rem
   * to 1.5rem is a decision; a blanket override that silently wins against
   * every element asking for spacing is the bug. */
  const stripped = FORM_HTML.replace(/\/\*[\s\S]*?\*\//g, '');

  assert.ok(!/\.card\s+\.mt-4/.test(stripped),
    'the blanket mt-4 override is back — the buttons will sit flush again');

  assert.ok(/\.wizard-nav\s*\{[^}]*margin-top\s*:/.test(stripped),
    'the wizard nav has no top margin rule at all');
});

test('every step\'s button row asks for that spacing by name', () => {
  /* Four rows: the shared renderNav, plus the three steps that build their
   * own footer. One of them left on `mt-4` would look different from the
   * other three and nothing would say so. */
  const rows = JS.match(/class: 'd-flex gap-2 [^']*'/g) || [];

  assert.strictEqual(rows.length, 4,
    `expected 4 button rows, found ${rows.length} — one was added or removed`);

  for (const row of rows) {
    assert.ok(/wizard-nav/.test(row), `a button row still uses the old class: ${row}`);
  }
});

/** One top-level function of the wizard, as source, for evaluating. */
function fnSource(name) {
  const found = JS.match(new RegExp(`\\n  function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}`));
  assert.ok(found, `${name}() has been renamed, reshaped or reindented`);
  return found[0];
}

/** stepNumber(), evaluated for a mode: { MODE: 1, TYPE: 2, ... }. */
function stepNumbers(siteMode, lockedMode = '') {
  const STEP = {
    MODE: 0, TYPE: 1, LOGO: 2, DESIGN: 3,
    MAIN: 4, PAGES: 5, LOCATIONS: 6, REVIEW: 7,
  };

  /* LOCKED_MODE JOINED hiddenSteps()'s SCOPE ON 16 NOVEMBER, and this
   * helper went on handing it two arguments — so every caller failed with
   * "LOCKED_MODE is not defined", which is the honest outcome: the helper
   * builds the function out of the real source, so the source gaining a
   * dependency SHOULD break it until the dependency is supplied. Defaulted
   * to '' so the existing callers mean "the open wizard", which is what
   * they were always testing. */
  const make = new Function('STEP', 'isLocalOptions', 'LOCKED_MODE',
    `${fnSource('hiddenSteps')}\n${fnSource('stepNumber')}\nreturn stepNumber;`);

  const stepNumber = make(STEP, () => siteMode === 'localoptions', lockedMode);

  return Object.fromEntries(Object.entries(STEP).map(([k, v]) => [k, stepNumber(v)]));
}

test('THE STEP NUMBERS ON SCREEN COME FROM THE ORDER, NOT FROM TYPING', () => {
  /* Design reads "4." and Review reads "8." because they are index 3 and 7
   * of an eight-step wizard. Hardcoding either is how "1. Global Information"
   * stayed wrong after a step was inserted in front of it.
   *
   * THIS PINNED THE SOURCE — `return step + 1;` — AND FAILED ON 28 OCTOBER,
   * when a mode started skipping a step and the number had to account for
   * it. Pinning an implementation is how a test fails on a change that was
   * correct, so it now EVALUATES the function instead and checks the numbers
   * the customer reads. That is both stricter and less brittle: the old
   * version would have passed `return step + 1 - 1`. */
  const normal = stepNumbers('rankfast');

  assert.deepStrictEqual(normal, {
    MODE: 1, TYPE: 2, LOGO: 3, DESIGN: 4,
    MAIN: 5, PAGES: 6, LOCATIONS: 7, REVIEW: 8,
  });

  // And no heading types its own number.
  assert.ok(!/<h[34][^>]*>\s*\d+\.\s/.test(JS), 'a step heading hardcodes its number');
});

test('and they close the gaps where steps are skipped', () => {
  /* Local Website Options skips THREE of the eight: Design (one structure,
   * passed as a literal), Service Pages (the model names them) and Location
   * Pages (the gazetteer names the towns).
   *
   * WITH THE STEPS GONE AND THE NUMBERS LEFT ALONE, the customer would walk
   * 1, 2, 3, 5, 8 — gaps exactly where the steps they were never shown would
   * have been, which reads as steps that failed to load. */
  const local = stepNumbers('localoptions');

  assert.strictEqual(local.MODE, 1);
  assert.strictEqual(local.TYPE, 2);
  assert.strictEqual(local.LOGO, 3);
  assert.strictEqual(local.MAIN, 4, 'Global Information still numbers itself 5');
  assert.strictEqual(local.REVIEW, 5, 'Review still numbers itself 8');

  /* Every visible step, once, with no gaps. The assertions above would all
   * pass if two steps shared a number. */
  const shown = Object.entries(local)
    .filter(([name]) => !['DESIGN', 'PAGES', 'LOCATIONS'].includes(name))
    .map(([, n]) => n);

  assert.deepStrictEqual(shown.slice().sort((a, b) => a - b), [1, 2, 3, 4, 5]);
});

test('this mode is five steps: mode, type, logo, details, review', () => {
  /* THE WHOLE SHAPE OF THE PRODUCT, IN ONE ASSERTION. Everything else about
   * this mode's wizard is a detail of one of these five; if a sixth appears
   * or one of them goes, it should be a deliberate edit here. */
  assert.ok(/isLocalOptions\(\) \? \[STEP\.DESIGN, STEP\.PAGES, STEP\.LOCATIONS\] : \[\]/.test(JS),
    'the set of skipped steps has changed');
});

test('a step this mode does not have is stepped past, in both directions', () => {
  /* Handled inside go() rather than at the call sites, because
   * `go(STEP.DESIGN)` appears in the logo step's Next AND the main form's
   * Back, and will appear again the next time somebody links to a step. */
  const body = bodyOf('go');

  assert.ok(/hiddenSteps\(\)\.includes\(index\)/.test(body),
    'go() will render a step this mode does not have');

  /* THE DIRECTION COMES FROM WHERE WE ARE. Without it, Back out of the main
   * form steps up to the main form again and the button looks broken. */
  assert.ok(/index >= current \? index \+ 1 : index - 1/.test(body),
    'go() steps past a hidden step in one direction only');
});

test('the skipped steps are gone from the review too', () => {
  /* The steps themselves stay in the steps array — it is asserted above to
   * match the constants in order, and Beacon will bring Design back for this
   * mode. They are unreachable, not deleted.
   *
   * THE REVIEW CARDS CARRY AN EDIT LINK TO THEIR STEP, and go() steps past a
   * hidden one — so a card for a skipped step is a button that does nothing,
   * beside a row reporting a choice nobody made. */
  const review = bodyOf('renderReviewStep');
  const at = review.indexOf("reviewCard('Design'");

  assert.notStrictEqual(at, -1, 'the Design card is gone for every mode');
  assert.ok(/isLocalOptions\(\)/.test(review.slice(Math.max(0, at - 200), at)),
    'the Design card is shown in the mode that has no Design step');

  /* The service-pages and location-pages cards go the same way, and are
   * REPLACED rather than simply dropped: this screen is the only one that
   * says what is about to be built, and leaving the page count off it
   * because the customer did not choose it is how somebody presses Generate
   * expecting the site they are used to. */
  const pagesAt = review.indexOf('Service pages (');
  assert.notStrictEqual(pagesAt, -1, 'the service pages card is gone for every mode');
  assert.ok(/isLocalOptions\(\)/.test(review.slice(Math.max(0, pagesAt - 900), pagesAt)),
    'the service pages card is shown in the mode that has no such step');

  assert.ok(/Eleven pages/.test(review),
    'this mode no longer says on the review step how many pages it builds');
  assert.ok(/chosen\s+for this trade/.test(review),
    'the review step does not say where the six services come from');
});

test('no submit guard points at a step this mode skips', () => {
  /* THE ONE THAT BROKE THE FIRST REAL BUILD, and it broke twice.
   *
   * The form's submit handler carries four guards that refuse and then call
   * go(STEP.PAGES) or go(STEP.LOCATIONS) so the customer can fix what is
   * wrong. With those steps skipped, go() steps past the target and lands
   * them somewhere else — Edwin got "Please add at least one service page"
   * and was returned to Global Information, a screen with nothing on it to
   * correct, about a step that is not in that wizard.
   *
   * "at least one service page" lived in THREE places: the pages step's own
   * Next, routes/generateRoute.js, and the submit handler. Fixing two of
   * three was worse than fixing none — the two that were right made the
   * third look like a different bug. */
  assert.ok(/hasPagesStep = !hiddenSteps\(\)\.includes\(STEP\.PAGES\)/.test(JS),
    'the service-page guard no longer asks whether that step exists');
  assert.ok(/hasLocationsStep = !hiddenSteps\(\)\.includes\(STEP\.LOCATIONS\)/.test(JS),
    'the locations guard no longer asks whether that step exists');

  assert.ok(/if \(hasPagesStep && pagesVals\.length === 0\)/.test(JS),
    'the submit handler still refuses a build with no service rows in every mode');

  /* state.addLocations DEFAULTS TO TRUE — the toggle ships on — so a mode
   * with no locations step reads as "locations are switched on and there
   * are none" unless this is forced false. That was the next wall, one
   * guard behind the first. */
  assert.ok(/const addLoc = !hasLocationsStep\s*\n?\s*\? false/.test(JS),
    'addLoc still trusts state in a mode that never showed the toggle');
});

test('and no badge reports a choice this mode never offered', () => {
  /* "Design 1" sat above a form that had never asked a design question, for
   * a value runLocalOptions discards in favour of 'ledger'. */
  const body = bodyOf('contextBadges');

  assert.ok(/hiddenSteps\(\)\.includes\(STEP\.DESIGN\)/.test(body),
    'the theme badge is shown in a mode with no Design step');
});

test('the owner name and the intro video are off this form too', () => {
  /* Both describe a page this mode does not build: there is no About page
   * for a founder, and none of the eleven embeds a video. */
  const local = mainFormHtml('localoptions');
  const other = mainFormHtml('rankfast');

  for (const field of ['includeOwner', 'ownerName', 'youtubeVideoUrl']) {
    assert.ok(!local.includes(field), `${field} is still on the Local Website Options form`);
    assert.ok(other.includes(field), `${field} has been removed from every mode`);
  }
});

test('but the social profiles stay, because the footer renders them', () => {
  /* THE OPPOSITE CASE, AND THE REASON IT IS WORTH A TEST BESIDE THE ONES
   * ABOVE. Every control cut from this form was cut for having nowhere to
   * go. These six had somewhere to go and were not getting there — a wiring
   * gap, fixed in socialFrom() rather than by deleting the question. */
  const local = mainFormHtml('localoptions');

  for (const field of ['facebookUrl', 'instagramUrl', 'youtubeUrl',
    'twitterUrl', 'pinterestUrl', 'linkedinUrl']) {
    assert.ok(local.includes(field), `${field} was removed from the form instead of wired up`);
  }
});

/* -------------------------------------------------------------------------
 * The domain
 * ---------------------------------------------------------------------- */

test('THE DOMAIN IS PICKED FROM A LIST HERE, AND TYPED EVERYWHERE ELSE', () => {
  /* Local Website Options publishes the site itself, to a GitHub account
   * that already has a domain pointed at it. Asking the customer to type
   * one would be asking them to name somewhere the app cannot put
   * anything. */
  const local = mainFormHtml('localoptions');
  const other = mainFormHtml('rankfast');

  assert.ok(local.includes('name="global[domainId]"'), 'no picker on this form');
  assert.ok(!local.includes('name="global[domain]"'), 'the typed box is still here');

  assert.ok(other.includes('name="global[domain]"'), 'the typed box went from every mode');
  assert.ok(!other.includes('name="global[domainId]"'), 'the picker leaked into another mode');
});

test('AND NEITHER, WHEN THE ADDRESS IS CHOSEN AT THE END', () => {
  /* CLOUDFLARE LOCAL AUTOMATION — Edwin saw this in the browser on 17
   * November: a GitHub pool dropdown (1r2.net, 8-i.net — Namecheap,
   * Hostinger) in step 3 AND a Cloudflare address at the end. Two
   * destinations, both required, one page.
   *
   * IT CAME FROM LOCKING THE MODE. The picker renders on `localoptions`,
   * which that door locks, so it switched itself on. Nothing was written to
   * turn it on and nothing failed.
   *
   *     A CONTROL THAT APPEARS BECAUSE OF A FLAG SET FOR ANOTHER REASON IS
   *     A CONTROL NOBODY DECIDED TO SHOW.
   *
   * AND THE INVISIBLE HALF WAS WORSE. sitePlace() reads `domainId` first,
   * so with both answered the site would have published to the Cloudflare
   * address while every canonical, og:url, the sitemap and the CNAME named
   * the GitHub host. See test-local-automation.js for that end of it. */
  const auto = mainFormHtml('localoptions', 'Plumbing', null, 'cloudflare');

  assert.ok(!auto.includes('name="global[domainId]"'),
    'the GitHub pool picker is on the Cloudflare door');
  assert.ok(!auto.includes('name="global[domain]"'),
    'step 3 asks for a domain the address step is about to ask for again');

  /* AND THE REST OF STEP 3 IS UNTOUCHED, so this removed a field rather
   * than a section. */
  assert.ok(auto.includes('name="global[businessName]"'), 'step 3 lost the business name');
  assert.ok(auto.includes('name="global[street]"'), 'step 3 lost the address fields');

  /* THE PAIR DOOR IS UNCHANGED, which is the half a one-sided assertion
   * would miss: same mode, no destination, picker still there. */
  const gh = mainFormHtml('localoptions');

  assert.ok(gh.includes('name="global[domainId]"'), '/github-sites lost its picker');
});

test('and the picker is a select, not a text box with a datalist', () => {
  /* A datalist still accepts anything typed, which is the thing being
   * removed. The value has to be one of the rows or none. */
  const local = mainFormHtml('localoptions');

  assert.ok(/<select[^>]*name="global\[domainId\]"/.test(local));
  assert.ok(local.includes('required'), 'a site with nowhere to go can be submitted');
});

test('IT STARTS WITH A PLACEHOLDER THAT HAS NO VALUE', () => {
  /* The list arrives from /api/site-domains a moment after the step is
   * drawn. An option with a value in the meantime is a choice somebody
   * could submit before the real ones exist. */
  const local = mainFormHtml('localoptions');

  const placeholder = local.match(/<option value="">([^<]*)<\/option>/);

  assert.ok(placeholder, 'no empty-valued placeholder');
  assert.match(placeholder[1], /Loading/);
});

/* -------------------------------------------------------------------------
 * The registrar in that picker
 * ---------------------------------------------------------------------- */

/* WHY THESE EXIST — Edwin, 14 November, looking at the Local Website Options
 * domain dropdown: *"it should reflect the registrar but is not"*.
 *
 * The admin screen had been storing a registrar since that morning and this
 * picker was still printing bare domains, because it is fed by its own API
 * and nobody had carried the field through. Three places have to agree: the
 * query must SELECT it, the JSON must SEND it, and the browser must PRINT
 * it. Any one of the three missing looks identical from the screen. */

const WIZARD_SRC = fs.readFileSync(
  path.join(__dirname, 'public', 'js', 'generateDinamycForm.js'), 'utf8');

const AUTH_SRC = fs.readFileSync(
  path.join(__dirname, 'routes', 'authRoute.js'), 'utf8');

/* COMMENTS STRIPPED BEFORE SEARCHING. Both files explain the registrar at
 * length right beside the code that handles it, and a check that matches the
 * explanation passes whether or not the code below it does anything. */
const noComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

/** The body of the /api/site-domains handler, comments removed. */
function siteDomainsHandler() {
  const src = noComments(AUTH_SRC);
  const at = src.indexOf("router.get('/api/site-domains'");
  assert.notStrictEqual(at, -1, '/api/site-domains has been renamed or removed');
  return src.slice(at, at + 1200);
}

test('THE API SELECTS THE REGISTRAR, OR IT IS NEVER READ', () => {
  /* .select() is a whitelist. A field left out of it is absent from the
   * lean row, and `row.registrar || ''` then sends an empty string for
   * every domain — which looks exactly like "no registrar set yet". */
  const body = siteDomainsHandler();

  assert.match(body, /\.select\([^)]*registrar/,
    'the query does not select registrar, so every row comes back without it');
});

test('AND SENDS IT', () => {
  const body = siteDomainsHandler();

  assert.match(body, /registrar:\s*row\.registrar/,
    'the registrar is read from the database and dropped before the response');
});

test('AND THE PICKER PRINTS IT', () => {
  const src = noComments(WIZARD_SRC);
  const at = src.indexOf("'<option value=\"\">Choose a domain");
  assert.notStrictEqual(at, -1, 'the domain picker has been rewritten');

  const block = src.slice(Math.max(0, at - 400), at + 400);

  assert.match(block, /\brow\.registrar\b/,
    'the dropdown builds its options without the registrar');
});

test('BUT STILL NOT THE LABEL, WHICH WAS REMOVED ON PURPOSE', () => {
  /* Edwin, 29 October: "why are we showing the domain name + the label. I
   * should be only the domain name." The registrar is a different fact and
   * does not reopen that decision — but it would be easy to reach for
   * row.label while adding row.registrar beside it, and nothing on screen
   * would say which of the two came back. */
  const src = noComments(WIZARD_SRC);
  const at = src.indexOf("'<option value=\"\">Choose a domain");
  const block = src.slice(Math.max(0, at - 400), at + 400);

  assert.ok(!/\brow\.label\b/.test(block),
    'the label is back in the customer dropdown');
});

test('AND THE API USES githubDomains(), NOT ITS OWN COPY OF THE FILTER', () => {
  /* utils/domainPool.js owns which rows belong to which product, and its
   * header names this very call site. This route had the two conditions
   * written out inline instead — the same drift that once had /static-blogs
   * offering GitHub domains to the blog wizard.
   *
   * It also made the picker unfindable: grepping for githubDomains() to
   * locate every GitHub dropdown returned nothing but a test. */
  const body = siteDomainsHandler();

  assert.match(body, /Domain\.find\(\s*githubDomains\(\)\s*\)/,
    'the GitHub filter is hand-written here instead of coming from domainPool');

  assert.ok(!/target:\s*'github'/.test(body),
    'the inline target filter is still here beside the shared one');
});

/* -------------------------------------------------------------------------
 * The registrar in the CLOUDFLARE picker on step 3
 *
 * THE SECOND PICKER, AND THE CHECKS ABOVE DO NOT COVER IT. Both dropdowns
 * open on the same string — `'<option value="">Choose a domain…'` — and the
 * GitHub one is written first in the file, so every indexOf() above lands
 * on it. The Cloudflare block could be deleted outright and those five
 * tests would still pass. These anchor on the fetch instead.
 *
 * AND THEY RUN THE CODE RATHER THAN READING IT. A regex looking for
 * `d.registrar` near the options is satisfied by the registrar appearing
 * ANYWHERE in that block — including inside the value, which is the one
 * place it must never be. See the note on the code itself: this picker
 * posts the domain, not a row id.
 * ---------------------------------------------------------------------- */

/**
 * The real `.map()` from the Cloudflare picker, lifted out and runnable.
 *
 * Takes the rows the API sends and returns the <option> markup, exactly as
 * the browser would build it.
 */
function cloudflareOptions() {
  const at = JS.indexOf("fetch('/api/cloudflare-domains'");

  assert.notStrictEqual(at, -1,
    'the Cloudflare domain picker no longer fetches /api/cloudflare-domains');

  const block = JS.slice(at, at + 1600);
  const from = block.indexOf('.map(');
  const to = block.indexOf(".join('')");

  assert.ok(from !== -1 && to > from,
    'the Cloudflare picker no longer maps its rows into options');

  /* escapeHtml is a closure in the real file, so it is passed in. The stub
   * escapes the four characters that matter here and nothing else — if the
   * real one ever stops escaping quotes, that is its own suite's problem,
   * not this one's. */
  const make = new Function('escapeHtml',
    `return (rows) => rows${block.slice(from, to)}.join('');`);

  return make(s => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;'));
}

test('THE CLOUDFLARE PICKER PRINTS THE REGISTRAR BESIDE THE DOMAIN', () => {
  /* Edwin, 19 November: "i want to show the registrar in the dropdown in
   * step 3". 1b-0.com and 1-1b.com are both at GoDaddy; 3-ro.com is at
   * Cloudflare. Three identical-looking domains is exactly the case the
   * registrar is for. */
  const build = cloudflareOptions();
  const html = build([{ domain: '1b-0.com', registrar: 'GoDaddy' }]);

  assert.match(html, />1b-0\.com — GoDaddy</,
    'the dropdown still shows the bare domain with no registrar');
});

test('AND THE VALUE STAYS THE BARE DOMAIN', () => {
  /* THE ONE THAT MATTERS. `global[cloudflare][domain]` is read back as a
   * hostname — the zone lookup and the DNS record are both built from it.
   * A value of "1b-0.com — GoDaddy" fails at the zone lookup complaining
   * about a domain the customer never typed.
   *
   * The GitHub picker is free of this because its value is a row id. */
  const build = cloudflareOptions();
  const html = build([{ domain: '1b-0.com', registrar: 'GoDaddy' }]);

  assert.match(html, /value="1b-0\.com"/,
    'the registrar has leaked into the option value, which is the hostname');

  assert.ok(!/value="[^"]*GoDaddy/.test(html),
    'the option value carries the registrar and will not resolve');
});

test('AND A ROW WITH NO REGISTRAR IS UNCHANGED', () => {
  /* Every cfsite row has a blank registrar until somebody fills it in on
   * /admin/blog-domains. If a blank produced "1-1o.com — " or "1-1o.com —
   * undefined", the feature would look broken on the rows that outnumber
   * the ones it was asked for. */
  const build = cloudflareOptions();

  assert.strictEqual(
    build([{ domain: '1-1o.com', registrar: '' }]),
    '<option value="1-1o.com">1-1o.com</option>',
    'a row with no registrar no longer renders as the domain alone');

  assert.strictEqual(
    build([{ domain: '1-1o.com' }]),
    '<option value="1-1o.com">1-1o.com</option>',
    'a row whose registrar key is missing renders a dash or an undefined');
});

test('AND THE REGISTRAR IS ESCAPED, NOT PASTED IN', () => {
  /* The registrar is free text typed into an admin box with maxlength 60
   * and a datalist that accepts anything. It reaches a customer's screen,
   * so it goes through escapeHtml like everything else does. */
  const build = cloudflareOptions();
  const html = build([{ domain: 'x.com', registrar: '<b>&"' }]);

  assert.ok(!/<b>/.test(html),
    'the registrar is written into the option without being escaped');

  assert.match(html, /&lt;b&gt;&amp;&quot;/,
    'the registrar is not escaped the way the rest of the option is');
});

test('AND THE PICKER STILL OPENS ON "CHOOSE A DOMAIN…"', () => {
  /* The guard the whole block exists for. Without a valueless first option
   * the customer is handed whichever domain the pool listed first, and
   * `required` stops meaning anything. Adding a label format is not a
   * reason for it to move. */
  const at = JS.indexOf("fetch('/api/cloudflare-domains'");
  const block = JS.slice(at, at + 1600);

  assert.match(block, /select\.innerHTML\s*=\s*'<option value="">Choose a domain/,
    'the Cloudflare picker no longer opens on a valueless first option');
});

test('AND THE SAVED CHOICE IS STILL MATCHED ON THE BARE DOMAIN', () => {
  /* A <select> cannot hold a value for an option it has not got, so the
   * saved answer is reapplied after the rows land. It is compared against
   * the VALUE, which is the domain — so a label change must not reach it.
   * If `chosen` were ever built from the label, coming back to step 3 would
   * silently clear a domain the customer had already picked. */
  const at = JS.indexOf("fetch('/api/cloudflare-domains'");
  const block = JS.slice(at, at + 2000);

  assert.match(block, /mainFormSnapshot[^;]*global\[cloudflare\]\[domain\]/,
    'the saved domain is no longer restored from the snapshot');

  assert.ok(!/select\.value\s*=\s*[^;]*registrar/.test(block),
    'the saved choice is being matched against the label, not the domain');
});

/* -------------------------------------------------------------------------
 * The price range table checkbox
 * ---------------------------------------------------------------------- */

test('THE CHECKBOX IS HIDDEN, NOT UNTICKED, WHERE A TABLE IS NOT ALLOWED', () => {
  /* An unticked box says "you could turn this on". A dentist cannot: a
   * published price table for a physician has insurance-billing and
   * state-disclosure implications, and the server refuses it whatever the
   * form sends. Offering the control and ignoring it is worse than not
   * offering it. */
  const body = bodyOf('renderMainForm');

  assert.ok(/canHavePricingTable\(state\.businessType\)\s*\?/.test(body),
    'the checkbox is no longer gated on the business shape');
  assert.ok(/name="global\[showPricingTable\]"/.test(body),
    'the checkbox lost its field name, so nothing reaches the server');
});

test('it ships ticked, so the default build is unchanged', () => {
  /* Opt-OUT. Every site built before today has a table; a box that defaulted
   * to off would quietly remove it from the next build of an existing site. */
  const body = bodyOf('renderMainForm');
  const tag = body.match(/<input[^>]*id="showPricingTable"[^>]*>/);

  assert.ok(tag, 'the checkbox is gone');
  assert.ok(/\bchecked\b/.test(tag[0]), 'the checkbox no longer ships ticked');
});

test('ABSENT READS AS INCLUDED ON THE REVIEW STEP', () => {
  /* The server treats a missing value as "on", because an unchecked box sends
   * nothing and so does every caller that predates the field. The review
   * screen has to agree with it, or step 8 promises one thing and the build
   * delivers another.
   *
   * READS includedSummary NOW, not pricingSummary. The two review rows were
   * given one shared helper when the badge checkbox arrived, and this checked
   * the body of what is now a one-line delegate — so it failed for its own
   * reason rather than for a real one. */
  const body = bodyOf('includedSummary');

  assert.ok(/undefined[\s\S]*?return 'Included'/.test(body),
    'a missing value no longer reads as Included');
  assert.ok(/'Not included'/.test(body), 'there is no way to report it as off');
});

test('the review step reports the choice', () => {
  const body = bodyOf('renderReviewStep');

  assert.ok(/pricingSummary\(\)/.test(body),
    'the review step no longer says whether a price table is coming');
  assert.ok(/canHavePricingTable\(state\.businessType\)/.test(body),
    'the row is shown even where no table is possible, which reports a choice nobody made');
});

test('the wizard keeps its own copy of the shape rule, and says so', () => {
  /* It has to have one — it cannot call into Node to ask. The comment
   * naming businessShape.js as the authority is what sends the next reader
   * to the real rule, and test-business-shape.js is what stops the two
   * drifting. */
  assert.ok(/var SHAPES_WITH_PRICING = \[/.test(JS), 'SHAPES_WITH_PRICING is gone');
  assert.ok(/businessShape\.js/.test(RAW.slice(RAW.indexOf('SHAPES_WITH_PRICING') - 1200,
                                               RAW.indexOf('SHAPES_WITH_PRICING'))),
    'the copy no longer points at the file that owns the rule');
});

/* -------------------------------------------------------------------------
 * The trust badges checkbox
 * ---------------------------------------------------------------------- */

test('THE BADGE CHECKBOX IS HIDDEN OUTSIDE HOME SERVICES', () => {
  /* Narrower than the price table on purpose: badges are allowed to `home`
   * only. The two images assert "award winning" and "licensed and insured"
   * about the business, and on a dental or legal site an unverified
   * credential claim is a licensing-board matter. An unticked box would
   * suggest a dentist could turn them on. */
  const body = bodyOf('renderMainForm');

  assert.ok(/canHaveBadges\(state\.businessType\)\s*\?/.test(body),
    'the badge checkbox is no longer gated on the business shape');
  assert.ok(/name="global\[showBadges\]"/.test(body),
    'the checkbox lost its field name, so nothing reaches the server');

  assert.ok(/var SHAPES_WITH_BADGES = \['home'\]/.test(JS),
    'SHAPES_WITH_BADGES is gone or no longer home-only');
});

test('it ships ticked, and its own rule sits inside the conditional', () => {
  const body = bodyOf('renderMainForm');
  const tag = body.match(/<input[^>]*id="showBadges"[^>]*>/);

  assert.ok(tag, 'the checkbox is gone');
  assert.ok(/\bchecked\b/.test(tag[0]), 'the checkbox no longer ships ticked');

  const block = body.slice(body.indexOf('canHaveBadges(state.businessType) ?'));
  const end = block.indexOf('` : \'\'}');

  assert.ok(end > 0, 'the conditional around the badge checkbox has changed shape');
  assert.ok(/<hr>/.test(block.slice(0, end)),
    'the rule above the badge checkbox is outside the conditional, or gone');
});

test('the description names what the two images actually say', () => {
  /* "Include trust badges" alone does not tell anyone what is being claimed
   * on their behalf. The words on the images are the useful part. */
  const body = bodyOf('renderMainForm');
  const block = body.slice(body.indexOf('id="showBadges"'));

  assert.ok(/Award winning/.test(block.slice(0, 600)), 'the award claim is not named');
  assert.ok(/Licensed and insured/.test(block.slice(0, 600)), 'the licensed claim is not named');
});

test('ONE SUMMARY HELPER, READ BY EVERY OPT-OUT ROW', () => {
  /* Every row answers the same question — was an opt-out checkbox left
   * ticked. Two copies would drift the moment one learned about a new truthy
   * value, which is the same fault the server side had with its two
   * coercions. THREE of them now, since the example-reviews box arrived; a
   * count in this name is the thing most likely to go stale, so it no longer
   * has one. */
  assert.ok(/function includedSummary\(field\)/.test(JS), 'the shared helper is gone');

  for (const field of ['showPricingTable', 'showBadges', 'showReviews']) {
    assert.ok(new RegExp(`return includedSummary\\('${field}'\\)`).test(JS),
      `the ${field} summary no longer reads through the shared helper`);
  }

  const body = bodyOf('renderReviewStep');
  assert.ok(/badgesSummary\(\)/.test(body), 'the review step does not report the badge choice');
  assert.ok(/canHaveBadges\(state\.businessType\)/.test(body),
    'the row shows where no badges are possible, reporting a choice nobody made');
});


/* -------------------------------------------------------------------------
 * The example reviews checkbox
 *
 * WHY THIS BLOCK EXISTS — Edwin, 3 November. He built a Rank Fast site, took
 * it to WordPress, and wanted the four example reviews gone. There was no box
 * to untick: the section was generated on every build of every mode, so the
 * only way out was editing wp_postmeta by hand, which is what he ended up
 * doing.
 *
 *     A SECTION NOBODY CAN DECLINE IS ONE THE CUSTOMER DELETES AFTERWARDS.
 *
 * What these guard is the SHAPE of the choice, not its existence: that it
 * ships ticked, so no draft or site built before today changes; that it is
 * offered to every business shape rather than hidden behind a capability
 * nobody wrote; and that it is offered on design samples too — because that
 * is the mode where the section was most deliberately unconditional, and a
 * default is not the same thing as a refusal.
 * ------------------------------------------------------------------------- */

test('THE EXAMPLE REVIEWS BOX IS THERE, AND IT SHIPS TICKED', () => {
  /* Ticked matters more than it looks. This is an opt-OUT field: keptOn() in
   * utils/sectionToggle.js reads absent as on, every site built before today
   * has the section, and the WordPress plugin sends no such field. A box that
   * shipped unticked would silently stop generating a section that every
   * existing draft expects. */
  const body = bodyOf('renderMainForm');
  const tag = body.match(/<input[^>]*id="showReviews"[^>]*>/);

  assert.ok(tag, 'the example-reviews checkbox is gone');
  assert.ok(/\bchecked\b/.test(tag[0]), 'the example-reviews checkbox no longer ships ticked');
  assert.ok(/name="global\[showReviews\]"/.test(body),
    'the checkbox lost its field name, so nothing reaches the server');
});

test('it is offered to every business shape, unlike the other two', () => {
  /* NOT A SHAPE RULE, and the absence is deliberate. The price table and the
   * badges are hidden where capabilities(businessType) forbids them, because
   * an unticked box says "you could turn this on" to somebody who cannot.
   * There is no capabilities().reviews, so gating this on a shape would be a
   * product decision invented inside a wizard template. If one is ever
   * wanted it belongs in businessShape.js beside the others, and this test is
   * what should fail when it is added. */
  const html = mainFormHtml('rankfast');
  const at = html.indexOf('id="showReviews"');

  assert.notStrictEqual(at, -1, 'the box is gone from rankfast');

  for (const shape of ['Plumbing', 'Dentist', 'Lemon Law', 'Web Design']) {
    assert.ok(mainFormHtml('rankfast', shape).includes('id="showReviews"'),
      `the box is missing for ${shape}`);
  }
});

test('ON EVERY MODE THAT BUILDS THE SECTION — SAMPLES INCLUDED', () => {
  /* The section runs on design samples by design: it EXISTS to be looked at,
   * and a sample missing it fails to show the one thing it was built to show.
   * That is a reason to tick the box by default, not a reason to withhold it.
   * Pricing and badges are hidden on samples because they are never built
   * there. This one is. */
  for (const mode of ['rankfast', 'lead', 'sample']) {
    assert.ok(mainFormHtml(mode).includes('id="showReviews"'),
      `the example-reviews box is missing from ${mode}, which builds the section`);
  }

  /* AND NOT IN LOCAL WEBSITE OPTIONS, which has no About page and never calls
   * generateSampleReviews. A box there would change nothing. */
  assert.ok(!mainFormHtml('localoptions').includes('id="showReviews"'),
    'the box is on the Local Website Options form, where it does nothing');
});

test('the review step reports the choice, in every mode that offers it', () => {
  /* The rule on that screen cuts both ways: a choice the customer MADE and
   * the build will not honour has to be shown, and a choice nobody was
   * offered must not be. This box is offered for every shape and every mode
   * but one, so the row carries exactly one condition — anything more would
   * hide a real choice on design samples. */
  const body = bodyOf('renderReviewStep');
  const at = body.indexOf("'Example reviews'");

  assert.notStrictEqual(at, -1, 'the review step does not report the example-reviews choice');

  /* ITS OWN SPREAD, NOT A FIXED WINDOW OF CHARACTERS BEFORE IT. The first
   * version of this read back 260 characters and failed — it had scooped up
   * the trust-badges row's `siteMode === 'sample'` and its explanatory
   * comment from above. Slicing to the last `...(` is the actual boundary of
   * this row's condition, and it stays correct when the comment grows. */
  const spreadAt = body.lastIndexOf('...(', at);
  assert.notStrictEqual(spreadAt, -1, 'the example-reviews row is not a conditional spread');

  const cond = body.slice(spreadAt, at);

  assert.ok(/isLocalOptions\(\)/.test(cond),
    'the row is shown in the mode that has no such control');
  assert.ok(!/siteMode === 'sample'|canHaveBadges\(|canHavePricingTable\(/.test(cond),
    'the row is hidden on a sample or by shape, where the choice is real');
});


/* -------------------------------------------------------------------------
 * The numbers on the location rows
 *
 * The service pages step numbers its rows. This step did not, so the only
 * screen that said how many towns had been added was the review step, one
 * click later — after the customer had already chosen what to pay for.
 *
 * The rows live in public/js/locationPages.js, a second browser IIFE, and
 * BOTH files add and remove them: the Add button and the Delete button in
 * that file, a ticked or unticked suggested town in this one. That split is
 * the whole risk here, so it is what these checks are aimed at.
 * ---------------------------------------------------------------------- */

const LOC_RAW = fs.readFileSync(
  path.join(__dirname, 'public/js/locationPages.js'), 'utf8');

const LOC = withoutComments(LOC_RAW);

/** One function out of locationPages.js, by matching its braces. */
function locFunction(name) {
  const at = LOC.indexOf(`function ${name}(`);
  assert.notStrictEqual(at, -1, `${name}() has been renamed or removed from locationPages.js`);

  const open = LOC.indexOf('{', at);
  let depth = 0;

  for (let i = open; i < LOC.length; i++) {
    if (LOC[i] === '{') depth++;
    else if (LOC[i] === '}' && --depth === 0) return LOC.slice(at, i + 1);
  }

  throw new Error(`${name}() has no closing brace`);
}

/* The smallest DOM the numbering needs: a list whose labels can be asked
 * for in document order. Enough to run the real function rather than read
 * it — and enough to delete a row from the middle, which is the case a
 * source check cannot see. */
function fakeList(count) {
  const labels = [];
  for (let i = 0; i < count; i++) labels.push({ textContent: 'Location' });

  return {
    labels,
    querySelectorAll(selector) {
      assert.strictEqual(selector, '.location-label',
        `the numbering is looking for "${selector}", which the row markup does not use`);
      return labels;
    },
  };
}

/** renumberLocationRows(), lifted out and given a document to work on. */
function numbering(list) {
  const document = {
    getElementById(id) {
      assert.strictEqual(id, 'locationsList', `the numbering reads #${id}, not the locations list`);
      return list;
    },
  };

  return new Function('document',
    `${locFunction('renumberLocationRows')}; return renumberLocationRows;`)(document);
}

test('EVERY LOCATION ROW IS NUMBERED, FROM ONE', () => {
  const list = fakeList(4);
  numbering(list)();

  assert.deepStrictEqual(
    list.labels.map(l => l.textContent),
    ['Location 1', 'Location 2', 'Location 3', 'Location 4']
  );
});

test('AND DELETING THE MIDDLE ROW RENUMBERS THE ONES BELOW IT', () => {
  /* The reason the number is recomputed from position instead of being
   * written once when the row is built. Assign it at birth and deleting row
   * 2 of 4 leaves the list reading "1, 3, 4" — which reads as a row having
   * gone missing, not as one having been deleted. */
  const list = fakeList(4);
  const renumber = numbering(list);
  renumber();

  list.labels.splice(1, 1);   // they pressed Delete on the second row
  renumber();

  assert.deepStrictEqual(
    list.labels.map(l => l.textContent),
    ['Location 1', 'Location 2', 'Location 3']
  );
});

test('an empty list, and a step that is not on screen, are both fine', () => {
  /* The toggle empties the list, and this function is published on `window`
   * where any later caller can reach it from any step. */
  assert.doesNotThrow(() => numbering(fakeList(0))());

  const absent = new Function('document',
    `${locFunction('renumberLocationRows')}; return renumberLocationRows;`)({
      getElementById: () => null,
    });

  assert.doesNotThrow(absent);
});

test('the row carries a label for the number to go in', () => {
  /* The markup and the numbering are in the same file precisely so they
   * cannot disagree — but they are still two separate strings. */
  const body = locFunction('addLocationInput');

  assert.ok(/class="form-label location-label"/.test(body),
    'the location row has no label, so there is nowhere for the number to appear');
  assert.ok(/renumberLocationRows\(\)/.test(body),
    'a newly added row keeps whatever text the markup gave it');
  assert.ok(/align-items-end/.test(body),
    'the row still centres its columns, which floats Delete above the field it deletes');
});

test('THE VALUE IS SET AS A PROPERTY, NOT INTERPOLATED INTO THE TAG', () => {
  /* It used to be `value="${initialValue}"`. These strings come back from a
   * draft in sessionStorage and from the suggestion panel, and one double
   * quote in a town name would close the attribute early and put the rest of
   * the string into the tag. */
  const body = locFunction('addLocationInput');

  assert.ok(!/value="\$\{/.test(body),
    'the row still interpolates a value into its markup');
  assert.ok(/\.value = initialValue/.test(body),
    'the initial value is never applied, so a restored draft comes back blank');
});

test('deleting a row renumbers, and so does unticking a suggested town', () => {
  /* The two paths that remove a row, in two different files. The Delete
   * button is handled in locationPages.js; unticking a suggestion calls
   * removeLocationRow() in the wizard, which never touches that button. */
  const del = LOC.slice(LOC.indexOf("classList.contains('remove-location')"));

  assert.ok(/renumberLocationRows\(\)/.test(del.slice(0, 400)),
    'the Delete button removes a row and leaves the numbers behind it stale');

  const unticked = bodyOf('removeLocationRow');

  assert.ok(/renumberLocationRows/.test(unticked),
    'unticking a suggested town removes a row from the middle and leaves a gap in the numbers');
});

test('and the numbering is published for the other file to call', () => {
  /* Without this the wizard cannot renumber after unticking a town, and the
   * check above would be asserting a call to a function that is not there. */
  assert.ok(/window\.renumberLocationRows = renumberLocationRows/.test(LOC),
    'renumberLocationRows is private, so the wizard cannot call it');
});

/* -------------------------------------------------------------------------
 * "This replaces your current website"
 *
 * There is ONE dist folder per user, not one per site. runGeneration step 2
 * rmSyncs it before writing, so generating a second site deletes the first
 * the moment the build starts — not after the 48-hour window, and until now
 * with no warning anywhere in the app. A customer mid-wizard is not looking
 * at the dashboard.
 * ---------------------------------------------------------------------- */

test('the review step asks whether there is a site to lose', () => {
  const body = bodyOf('renderReviewStep');

  assert.ok(/warnIfReplacing\(/.test(body),
    'the review step never checks for an existing site');
});

test('AND IT ASKS AT REVIEW TIME, NOT AT BOOT', () => {
  /* A wizard left open for two days would otherwise warn about a site the
   * sweeper has since removed. Asked at the moment it matters, the answer is
   * true. */
  const warn = bodyOf('warnIfReplacing');

  assert.ok(/fetch\('\/api\/me'/.test(warn),
    'the warning does not fetch the current site');
  assert.ok(!/state\.currentSite/.test(JS),
    'the site is cached in state, so a stale answer can be shown');
});

test('NOTHING IS SHOWN TO SOMEBODY WITH NOTHING TO REPLACE', () => {
  /* A replacement warning on a first build is noise, and noise is what
   * people learn to click past — including the time it matters. */
  const warn = bodyOf('warnIfReplacing');

  assert.ok(/if \(!site\) return;/.test(warn),
    'the warning renders even when there is no existing site');
});

test('and a failed lookup does not block the customer', () => {
  /* Same rule as the credit check. Worst case they lose a site they could
   * have downloaded — which is exactly today's behaviour, so a swallowed
   * error cannot make things worse than not having the warning at all. */
  const warn = bodyOf('warnIfReplacing');

  assert.ok(/catch/.test(warn), 'a network blip would throw inside the review step');
  assert.ok(/res\.ok/.test(warn), 'a non-200 is parsed as if it were a site');
});

test('THE BUSINESS NAME IS ESCAPED', () => {
  /* It goes into innerHTML and the customer typed it. */
  const warn = bodyOf('warnIfReplacing');

  assert.ok(/escapeHtml\(site\.businessName\)/.test(warn),
    'the business name is interpolated into innerHTML unescaped');
  assert.ok(/escapeHtml\(String\(site\.generatedAgo/.test(warn),
    'generatedAgo is interpolated unescaped');
});

test('it offers a way to save the site, because a warning you cannot act on is just friction', () => {
  const warn = bodyOf('warnIfReplacing');

  assert.ok(/replaces your current website/i.test(warn),
    'the warning does not say what is about to happen');
  assert.ok(/\/dashboard/.test(warn), 'there is no way to save the site first');
});

test('IT SENDS THEM TO THE DASHBOARD, NOT STRAIGHT AT THE ZIP', () => {
  /* Two versions of this were wrong before it was right.
   *
   * The first linked to /download-zip unconditionally. That route serves a
   * ZIP already on disk and answers with a 404 HTML PAGE when there is not
   * one — so for anyone who had never pressed Download HTML Site it would
   * have navigated them out of the wizard and lost the whole form. A warning
   * about losing work that loses their work.
   *
   * The second branched on hasStaticZip to pick between the direct link and
   * the dashboard. Edwin: "what if the user wants to convert it to WordPress
   * instead?" The dashboard carries BOTH buttons and only the customer knows
   * which one they are about to lose. Choosing for them is a guess dressed
   * as a convenience. */
  const warn = bodyOf('warnIfReplacing');

  assert.ok(!/download-zip/.test(warn),
    'the warning links straight at the ZIP, which 404s out of the wizard for anyone who has not built one');
  assert.ok(!/hasStaticZip/.test(warn.replace(/\s+/g, ' ')) || !/site\.hasStaticZip/.test(warn),
    'the warning branches on whether a ZIP exists instead of letting the customer choose');
});

test('and it names both things they could be about to lose', () => {
  /* "Download it first" alone reads as "the static ZIP is the only option".
   * A customer who was going to convert to WordPress needs to know that is
   * on the other end of this link too. */
  const warn = bodyOf('warnIfReplacing');

  assert.ok(/[Dd]ownload/.test(warn), 'the warning does not mention downloading');
  assert.ok(/WordPress/.test(warn), 'the warning does not mention the WordPress conversion');
});

test('THE LINK OPENS A NEW TAB, AND SAYS SO', () => {
  /* The form they have spent ten minutes filling in has to still be there
   * when they come back — and they have to believe that before they will
   * click, which is why the reassurance is in the text and not only in the
   * markup. */
  const warn = bodyOf('warnIfReplacing');
  const links = warn.match(/<a [^>]*>/g) || [];

  assert.strictEqual(links.length, 1, `expected one link, found ${links.length}`);
  assert.ok(/target="_blank"/.test(links[0]), `the link navigates the wizard away: ${links[0]}`);
  assert.ok(/rel="noopener"/.test(links[0]), `the new-tab link has no rel=noopener: ${links[0]}`);

  assert.ok(/new tab/i.test(warn), 'nothing tells them the form survives the click');
});

test('AND IT IS NOT A CONFIRM DIALOG', () => {
  /* One would fire on every generation including the first, and people click
   * through those without reading. Pressing Generate on this screen is the
   * confirmation. */
  const warn = bodyOf('warnIfReplacing');

  assert.ok(!/confirm\(|window\.confirm/.test(warn),
    'the warning blocks on a dialog people will click through');
});

/* -------------------------------------------------------------------------
 * The endpoint behind it
 * ---------------------------------------------------------------------- */

const AUTH = fs.readFileSync(path.join(__dirname, 'routes/authRoute.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter(line => !/^\s*\/\//.test(line))
  .join('\n');

test('/api/me reports the site the next build would destroy', () => {
  const me = AUTH.slice(AUTH.indexOf("router.get('/api/me'"), AUTH.indexOf("router.get('/verify'"));

  assert.ok(me.length > 0, 'the /api/me handler could not be found');
  assert.ok(/getCurrentSite\(req\.session\.userId\)/.test(me),
    '/api/me does not look up the current site');

  /* THE RESPONSE OBJECT, not the handler.
   *
   * Found by mutation: deleting `currentSite` from the res.json() payload
   * left a handler that looks it up, builds it, and throws it away — and a
   * search of the whole handler still matched the local variable. The wizard
   * would read undefined and silently never warn, which is the bug this
   * endpoint change exists to prevent. */
  const sent = me.indexOf('res.json({');
  const payload = me.slice(sent, me.indexOf('}', me.indexOf(')', sent)));

  assert.ok(/currentSite/.test(payload),
    'currentSite is computed and never sent');

  /* AND IT IS THE VARIABLE, NOT A LITERAL. Second mutation on the same
   * line: `currentSite: null` in the payload passes a presence check while
   * throwing away the lookup above it, and the wizard would never warn
   * anybody. Written as a NOT so an explicit `currentSite: currentSite`
   * stays legal. */
  assert.ok(!/currentSite\s*:\s*(null|undefined|false|\{\s*\})/.test(payload),
    'currentSite is sent as a literal, so the lookup above it is discarded');
});

test('AND IT IS NULL WHEN THERE IS NOTHING THERE', () => {
  /* The wizard keys its warning off this being falsy. An object with empty
   * fields would warn every first-time customer about a site that does not
   * exist. */
  const me = AUTH.slice(AUTH.indexOf("router.get('/api/me'"), AUTH.indexOf("router.get('/verify'"));

  assert.ok(/let currentSite = null;/.test(me),
    'currentSite does not default to null');
  assert.ok(/if \(existing\)/.test(me),
    'the response is built without checking a site was found');
});

test('a filesystem error does not take the credits badge down with it', () => {
  /* /api/me exists for the header's credit count. It must not start failing
   * because a directory read did. */
  const me = AUTH.slice(AUTH.indexOf("router.get('/api/me'"), AUTH.indexOf("router.get('/verify'"));
  const lookup = me.slice(me.indexOf('let currentSite'), me.indexOf('res.json'));

  assert.ok(/try \{/.test(lookup) && /catch/.test(lookup),
    'the site lookup is unguarded inside the endpoint the header depends on');
});

test('and the dashboard card says it too', () => {
  /* The wizard warning catches people who reach Review. The card catches
   * people looking at the site they are about to lose. */
  assert.ok(/Generating a new website replaces this one/.test(AUTH),
    'the dashboard card does not mention that a new build replaces it');
});

/* -------------------------------------------------------------------------
 * Local Website Options — the fourth mode
 *
 * It is the first mode whose PAGE COUNT IS NOT THE CUSTOMER'S DECISION, and
 * almost everything below follows from that one fact. utils/pricing.js
 * charges a flat 800 whatever is posted, so every control that could change
 * the count is a control that could sell a page the renderer never writes.
 * ---------------------------------------------------------------------- */

test('the mode is on the list, and the list is still just a list', () => {
  assert.ok(/value: 'localoptions'/.test(JS), 'the mode is not offered');
  assert.ok(/title: 'Local Website Options'/.test(JS));

  /* FOUR ENTRIES AND NOTHING COUNTS THEM. The step renders from SITE_MODES,
   * so a fifth mode is a fifth entry — the comment above the array has
   * promised that since there were two, and this is what keeps the promise
   * true. */
  const list = JS.slice(JS.indexOf('const SITE_MODES'), JS.indexOf('function isLocalOptions'));
  assert.strictEqual((list.match(/value: '/g) || []).length, 4);
});


test('the address is four typed boxes in this mode and one free-text box otherwise', () => {
  const body = bodyOf('renderMainForm');

  for (const field of ['street', 'city', 'state', 'zip']) {
    assert.ok(new RegExp(`name="global\\[${field}\\]"`).test(body),
      `the ${field} box is missing`);
  }

  /* BOTH FORMS ARE PRESENT AND THE CHOICE IS MADE AT RENDER TIME. The single
   * Address box has to survive for the other three modes — deleting it was
   * the easy way to make the new boxes work and it would have taken the
   * address off every other site this app builds. */
  assert.ok(/name="global\[address\]"/.test(body), 'the free-text Address box is gone');
  assert.ok(/isLocalOptions\(\)/.test(body), 'the main form does not know which mode it is in');
});

test('the boxes that are not used are not rendered, rather than hidden', () => {
  /* A hidden input carrying `required` fails checkValidity() in the Next
   * handler, so Next refuses and points at a box nobody can see. That is why
   * these are conditional MARKUP rather than conditional CSS — and the other
   * mode-dependent fields on this step, the owner name and Near Me, ARE done
   * with display:none, which is what makes the distinction worth a test
   * rather than a comment.
   *
   * Asserted on the text BETWEEN the ternary and the input, so it fails if
   * somebody converts these four to the display:none form the fields above
   * them use. */
  const body = bodyOf('renderMainForm');

  const at = body.indexOf('name="global[street]"');
  assert.notStrictEqual(at, -1, 'the street box is gone');

  const before = body.slice(Math.max(0, at - 300), at);

  assert.ok(/isLocalOptions\(\) \?/.test(before),
    'the street box is not inside the mode ternary');
  assert.ok(!/display:none/.test(before),
    'the address boxes are hidden with CSS instead of left unrendered');
  assert.ok(/required/.test(body.slice(at, at + 200)),
    'the street box is no longer required, so an empty one reaches the server');
});

test('Main Location is not asked twice', () => {
  /* City and State already say where the business is. Asking again is how
   * the two answers come back different, and the route composes `location`
   * as "City, ST" from the parts. */
  const body = bodyOf('renderMainForm');
  const at = body.indexOf('name="global[location]"');

  assert.notStrictEqual(at, -1, 'the Main Location box is gone for every mode');

  const before = body.slice(Math.max(0, at - 300), at);
  assert.ok(/isLocalOptions\(\) \? ''/.test(before),
    'Main Location is still shown in the mode whose City and State replace it');
});

test('the required-field list follows the boxes that were actually rendered', () => {
  const body = bodyOf('renderMainForm');
  const list = body.slice(body.indexOf('const requiredFields'), body.indexOf('const inputs'));

  assert.ok(/global\[street\]/.test(list) && /global\[zip\]/.test(list));
  assert.ok(/global\[address\]/.test(list) && /global\[location\]/.test(list));
  assert.ok(/isLocalOptions\(\)/.test(list),
    'one list validates both forms, so one of them is unchecked');
});

test('a filled box of the wrong shape gets its own message', () => {
  /* "Please fill out ZIP code" about a box with 7864 in it reads as a bug in
   * the form. The phone number has had its own message for this reason since
   * 8 October; the state and ZIP now do too. */
  const body = bodyOf('renderMainForm');

  assert.ok(/two-letter state code/.test(body));
  assert.ok(/5-digit ZIP code/.test(body));

  /* KEYED BY FIELD. A single `badFormatMessage` variable holds whatever
   * failed last, which with a bad state AND a bad ZIP points the wrong
   * message at the focused box. */
  assert.ok(/badFormat\[field\]/.test(body) && /badFormat\[name\]/.test(body),
    'the format messages are not keyed by the field they belong to');
});

test('the controls with nowhere to go are not on this form', () => {
  /* Edwin, 28 October: remove the Map CID, the price-range table, the
   * About-page contact form and the Near Me box. The trust badges went with
   * them, for the same reason.
   *
   * FOUR OF THE FIVE DESCRIBE THE ABOUT PAGE, and this mode has no About
   * page — its eleven are home, six services, contact and three legal. The
   * fifth, the Map CID, feeds the LocalBusiness schema runGeneration builds;
   * this mode builds its own in render/schema.js out of the four address
   * boxes and never reads a CID.
   *
   * ASSERTED ON THE MARKUP THE MODE PRODUCES, not on the conditionals.
   * mainFormHtml() renders the template for a given mode, so this fails if
   * somebody adds a sixth control or loosens one of the five — which
   * matching source text would not catch. */
  const html = mainFormHtml('localoptions');

  /* ASKED AS THE ATTRIBUTE, not as a bare word. `name="global[useNearMe]"`
   * cannot match prose; `useNearMe` can, and did. */
  for (const field of [
    'id="googleMapCid"', 'id="showAboutForm"', 'id="showPricingTable"',
    'id="showBadges"', 'id="useNearMe"',
    'name="global[trustClaims]"', 'id="trustClaimsList"',
  ]) {
    assert.ok(!html.includes(field),
      `${field} is still on the Local Website Options form, where it does nothing`);
  }
});

test('and all five are untouched for the modes that use them', () => {
  /* The other half, and the more important one: this was a form cleanup for
   * ONE mode, not a product change. Rank Fast and Rank GBPs sell the price
   * table and the Near Me section. */
  const html = mainFormHtml('rankfast');

  for (const field of [
    'id="googleMapCid"', 'id="showAboutForm"', 'id="showPricingTable"',
    'id="showBadges"', 'id="useNearMe"',
    'name="global[trustClaims]"', 'id="trustClaimsList"',
  ]) {
    assert.ok(html.includes(field), `${field} has been removed from every mode`);
  }

  /* AND THE HORIZONTAL RULES STILL PAIR UP. Five controls came out of the
   * middle of a run of <hr> separators; the leading rule of each block had
   * to come out with it. Two rules together is what a stranded one looks
   * like. */
  assert.ok(!/<hr>\s*<hr>/.test(html), 'rankfast has two rules with nothing between them');
  assert.ok(!/<hr>\s*<hr>/.test(mainFormHtml('localoptions')),
    'Local Website Options has two rules with nothing between them');
});

test('the review step does not report a choice nobody was offered', () => {
  /* The rule on the review step is that a choice the customer MADE and the
   * site will not honour has to be shown. These are the mirror image: not
   * on the form at all, so a row reading "Price range table: included"
   * would be the wizard inventing one. */
  const body = bodyOf('renderReviewStep');
  const rows = body.slice(body.indexOf("reviewCard('Business Details'"), body.indexOf("reviewCard('Hours'"));

  for (const row of ['Price range table', 'Trust badges', 'Map CID']) {
    const at = rows.indexOf(`'${row}'`);
    assert.notStrictEqual(at, -1, `the ${row} row is gone for every mode`);
    assert.ok(/isLocalOptions\(\)/.test(rows.slice(Math.max(0, at - 320), at)),
      `the ${row} row is shown in the mode that has no such control`);
  }
});

test('the review step shows the address the customer actually typed', () => {
  /* snapshotValue('address') is blank in this mode: that box is never
   * rendered, so nothing snapshots it, and the route composes the value
   * after this screen is gone. A row reading "Address: " about an address
   * they typed reads as having lost it. */
  const body = bodyOf('renderReviewStep');

  assert.ok(/isLocalOptions\(\)/.test(body), 'the review step does not know the mode');
  assert.ok(/snapshotValue\('street'\)/.test(body), 'the street is not on the review step');
  assert.ok(/snapshotValue\('zip'\)/.test(body), 'the ZIP is not on the review step');
});

/* -------------------------------------------------------------------------
 * THE FILE HAS TO EVALUATE
 *
 * EVERY OTHER CHECK IN THIS SUITE LIFTS ONE FUNCTION OUT WITH `new Function`
 * AND RUNS IT. That is useful and it is blind to the one failure that takes
 * the whole wizard down: an error while the file is being evaluated.
 *
 * It happened on 16 November. LOCKED_MODE was declared a hundred lines below
 * `state`, which initialises `siteMode: LOCKED_MODE || 'rankfast'` — and a
 * `const` read before its declaration throws rather than reading undefined:
 *
 *     Cannot access 'LOCKED_MODE' before initialization
 *
 * The IIFE died on load. The header and sidebar are server-rendered, so the
 * page looked entirely normal with a blank space where the wizard goes.
 * Ninety-odd tests passed. Edwin found it by pressing the button.
 *
 *     A SUITE THAT ONLY EVER RUNS PIECES OF A FILE CANNOT TELL YOU THE FILE
 *     RUNS.
 *
 * NO jsdom, following this project's rule — a dependency behind a deploy is
 * the failure deploy.sh opens with a comment about. The shim below is a
 * dozen stubs, which is all this file touches while it is evaluating.
 * ---------------------------------------------------------------------- */

const vm = require('vm');

/** Run the whole wizard file the way a browser would. */
function evaluateWizard({ siteMode = null, siteTarget = null } = {}) {
  const noop = () => {};
  const node = () => ({
    style: {}, dataset: {}, innerHTML: '', textContent: '', content: '',
    classList: { add: noop, remove: noop, contains: () => false },
    appendChild: noop, addEventListener: noop, setAttribute: noop,
    getAttribute: () => null, remove: noop,
    querySelector: () => null, querySelectorAll: () => [],
  });

  /* THE TWO queries the file makes while evaluating: the mode meta tag and
   * the destination one. Given a value here, each lock is exercised on the
   * way through.
   *
   * THE SECOND ONE IS WHY THIS SHIM EXISTS AT ALL. LOCKED_TARGET is read by
   * an IIFE at module scope exactly as LOCKED_MODE is, and it sits ABOVE
   * `state` for exactly the same reason — the temporal dead zone that took
   * the whole wizard down on 16 November. A new const in that region is the
   * one change this suite has to keep watching. */
  const document = {
    readyState: 'loading',
    body: node(),
    documentElement: node(),
    createElement: node,
    addEventListener: noop,
    getElementById: () => null,
    querySelectorAll: () => [],
    querySelector: (sel) => {
      if (siteMode !== null && /meta\[name="site-mode"\]/.test(sel)) {
        return { content: siteMode };
      }
      if (siteTarget !== null && /meta\[name="site-target"\]/.test(sel)) {
        return { content: siteTarget };
      }

      return null;
    },
  };

  const ctx = {
    document,
    window: { addEventListener: noop, location: { search: '', href: '' }, document },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    console, fetch: noop, setTimeout, clearTimeout, URLSearchParams,
    FormData: class { append() {} },
  };
  ctx.globalThis = ctx;

  vm.createContext(ctx);
  vm.runInContext(WIZARD_SRC, ctx, { filename: 'generateDinamycForm.js' });

  return ctx;
}

test('THE WIZARD FILE EVALUATES, WHICH IS NOT WHAT ANY OTHER TEST CHECKS', () => {
  assert.doesNotThrow(() => evaluateWizard(),
    'the wizard throws while loading — the page will render with no form on it');
});

test('and it evaluates on a locked page too', () => {
  /* The locked path reads the meta tag during evaluation, so it is a
   * different code path through the same load and deserves its own run. */
  assert.doesNotThrow(() => evaluateWizard({ siteMode: 'localoptions' }),
    '/github-sites throws while loading');
});

test('and it evaluates with a DESTINATION locked', () => {
  /* /cloudflare-sites/new. A second const read at module scope, in the
   * region that already killed this file once. */
  assert.doesNotThrow(() => evaluateWizard({ siteTarget: 'cloudflare' }),
    '/cloudflare-sites/new throws while loading');
});

test('and a nonsense destination is ignored rather than fatal', () => {
  assert.doesNotThrow(() => evaluateWizard({ siteTarget: 'ftp' }),
    'an unknown site-target kills the wizard rather than being ignored');
});

test('and a nonsense lock does not take the page down with it', () => {
  /* The value comes from markup. Validation keeps it out of state; this
   * checks it also cannot throw on the way. */
  assert.doesNotThrow(() => evaluateWizard({ siteMode: 'not-a-mode' }),
    'an unknown site-mode kills the wizard rather than being ignored');
});

/* -------------------------------------------------------------------------
 * ONE PRODUCT, ONE DOOR — /github-sites and the mode it locks
 * ---------------------------------------------------------------------- */

const MODES_FIXTURE = [
  { value: 'rankfast',    title: 'Rank Fast' },
  { value: 'localoptions', title: 'Local Website Options' },
  { value: 'sample',      title: 'One-Page Design' },
  { value: 'lead',        title: 'Rank GBPs' },
];

/**
 * The REAL LOCKED_AWAY, read out of the wizard rather than fixtured.
 *
 * THE FIRST VERSION OF THIS HELPER PASSED `new Set(['localoptions'])` IN,
 * and a mutant emptying the real one passed every test below. Of course it
 * did: the tests were exercising the fixture. The lock is the one value
 * here that decides a product's entire entry point, and it was the one
 * value not being read.
 *
 *     A FIXTURE STANDING IN FOR THE THING UNDER TEST TESTS THE FIXTURE.
 */
const LOCKED_AWAY_REAL = (() => {
  const m = /const LOCKED_AWAY = new Set\(\[([^\]]*)\]\)/.exec(WIZARD_SRC);
  assert.ok(m, 'LOCKED_AWAY has been renamed or reshaped');

  const values = m[1].split(',').map(v => v.trim().replace(/^'|'$/g, '')).filter(Boolean);

  return new Set(values);
})();

/** modesOnOffer(), run with a chosen lock and a chosen current state. */
function offered({ locked = '', siteMode = 'rankfast' } = {}) {
  const fn = extract('modesOnOffer', {
    LOCKED_MODE: locked,
    LOCKED_AWAY: LOCKED_AWAY_REAL,
    SITE_MODES: MODES_FIXTURE,
    state: { siteMode },
  });

  return fn().map(m => m.value);
}

test('LOCALOPTIONS IS THE MODE THAT HAS ITS OWN ROW', () => {
  /* Read from the wizard, so the list below is exercising the real lock.
   * If a second mode ever gets its own page this fails and the expected
   * lists just below have to be rewritten — which is correct: they are a
   * statement about what the open wizard offers. */
  assert.deepStrictEqual([...LOCKED_AWAY_REAL], ['localoptions']);
});

test('A LOCKED PAGE SKIPS STEP 1 ENTIRELY, IT DOES NOT EMPTY IT', () => {
  /* THE BUG THIS REPLACED, found by Edwin pressing the button.
   *
   * modesOnOffer() returning [] stopped the CARDS being drawn and nothing
   * stopped the STEP. /github-sites opened on a heading reading "1. What
   * are we building?", no options beneath it, and a Next button — so the
   * first thing asked of the customer was to answer a blank question, on a
   * screen indistinguishable from one that failed to load.
   *
   *     HIDING THE OPTIONS IS NOT SKIPPING THE STEP.
   *
   * hiddenSteps() is the mechanism that already existed for this: go()
   * steps past anything in it, in whichever direction it was travelling,
   * and stepNumber() renumbers what is left. */
  const hidden = extract('hiddenSteps', {
    STEP: STEP_FIXTURE,
    LOCKED_MODE: 'localoptions',
    isLocalOptions: () => true,
  })();

  assert.ok(hidden.includes(STEP_FIXTURE.MODE),
    'the mode step is still rendered on a locked page, with nothing in it');
});

test('and the open wizard still shows it', () => {
  const hidden = extract('hiddenSteps', {
    STEP: STEP_FIXTURE,
    LOCKED_MODE: '',
    isLocalOptions: () => false,
  })();

  assert.deepStrictEqual(hidden, [],
    'the open wizard is hiding steps it should be offering');
});

test('AND WHAT IS LEFT IS NUMBERED FROM 1, WITH NO GAP', () => {
  /* The gap is the tell. stepNumber() subtracts the hidden steps below a
   * step, so leaving MODE out of hiddenSteps() but not rendering it would
   * have walked the customer 2, 3, 5, 8 — which reads as four steps that
   * failed to load rather than one wizard with four steps. */
  const scope = {
    STEP: STEP_FIXTURE,
    LOCKED_MODE: 'localoptions',
    isLocalOptions: () => true,
  };

  const hidden = extract('hiddenSteps', scope)();
  const stepNumber = extract('stepNumber', { ...scope, hiddenSteps: () => hidden });

  const shown = Object.keys(STEP_FIXTURE)
    .filter(k => !hidden.includes(STEP_FIXTURE[k]))
    .map(k => stepNumber(STEP_FIXTURE[k]));

  assert.deepStrictEqual(shown, [1, 2, 3, 4],
    `the locked wizard numbers its steps ${shown.join(', ')}`);
});

test('A LOCKED PAGE OFFERS NO MODE CARDS AT ALL', () => {
  /* The sidebar row made the choice. Offering it again would mean "GitHub
   * Websites" led to a screen asking which kind of website — the confusion
   * the whole change was meant to remove. */
  assert.deepStrictEqual(offered({ locked: 'localoptions', siteMode: 'localoptions' }), []);
});

test('and the open wizard no longer offers the one that has its own row', () => {
  assert.deepStrictEqual(offered(), ['rankfast', 'sample', 'lead']);
});

test('BUT A DRAFT SAVED BEFORE THAT ROW EXISTED IS NOT ORPHANED', () => {
  /* THE BUG THIS PREVENTS, which costs nothing to describe and would have
   * been very hard to recognise on screen.
   *
   * Drafts live in sessionStorage and hold siteMode. One saved while
   * "Local Website Options" was still a card restores to siteMode
   * 'localoptions' — and `/` no longer lists that value. Without this the
   * wizard would run every localoptions branch (eleven fixed pages, six
   * services, the domain dropdown) while step 1 showed four cards with
   * NONE of them selected.
   *
   *     A VALUE REMOVED FROM A PICKER IS STILL IN EVERY DRAFT THAT HOLDS
   *     IT. Hiding an option must not make the state unrepresentable.
   *
   * So the list is "what you may choose here" plus "what you already are". */
  assert.deepStrictEqual(
    offered({ siteMode: 'localoptions' }),
    ['rankfast', 'sample', 'lead', 'localoptions'],
  );
});

test('and nothing is added twice when the two agree', () => {
  assert.deepStrictEqual(offered({ siteMode: 'sample' }), ['rankfast', 'sample', 'lead']);
});

test('THE LOCK IS CHECKED AGAINST THE LEGAL VALUES, NOT TRUSTED AS TYPED', () => {
  /* The value arrives in markup. A typo would set state.siteMode to
   * something no branch in the wizard tests for: every isLocalOptions()
   * returns false and the thing runs as a fourth mode that does not
   * exist — no error, just a site built by the wrong half of the code. */
  const src = WIZARD_SRC;

  assert.ok(/SITE_MODE_VALUES\.has\(\s*v\s*\)/.test(src),
    'LOCKED_MODE no longer validates the meta tag against the legal values');

  assert.ok(/new Set\(\['rankfast', 'localoptions', 'sample', 'lead'\]\)/.test(src),
    'the legal site modes are no longer named in one place');
});

test('A DRAFT FROM ANOTHER MODE IS REFUSED ON A LOCKED PAGE', () => {
  /* Arriving at /github-sites with a half-finished Rank Fast draft must
   * not take its words and its nine pages and leave the mode locked to
   * the eleven-page one. Half a draft is worse than none — and the words
   * are still in sessionStorage, so going back to / resumes them intact. */
  const src = WIZARD_SRC;
  const fn = /function applyDraft\(draft\) \{([\s\S]*?)\n {2}\}/.exec(src);

  assert.ok(fn, 'applyDraft() has been renamed or reshaped');

  assert.ok(
    /if \(LOCKED_MODE && draft\.siteMode && draft\.siteMode !== LOCKED_MODE\) return;/
      .test(fn[1]),
    'applyDraft no longer refuses a draft whose mode is not this page\'s');

  /* AND THE GUARD IS FIRST. Below the assignments it would already have
   * overwritten half the state before returning. */
  const guard = fn[1].indexOf('!== LOCKED_MODE');
  const first = fn[1].indexOf('state.');

  assert.ok(guard !== -1 && guard < first,
    'the mismatch guard runs after state has already been written');
});

/* -------------------------------------------------------------------------
 * A DESTINATION IS NOT A MODE — /cloudflare-sites/new
 *
 * Edwin, 16 November: *"have you fixed the clouldflare 2 steps? that what i
 * need"*. Building a website for a Cloudflare subdomain took two visits —
 * build here, then go to /cloudflare-sites and publish "whatever was built
 * last" — and the second screen silently depended on the first having been
 * the last thing you did. Build two and publish once and you publish the
 * wrong one.
 *
 * THE FIX IS A SECOND AXIS, NOT A FOURTH MODE. A mode decides WHAT gets
 * built; a destination decides WHERE it lands. Cloudflare takes any mode, so
 * it could never have been a card on step 1 without lying about what it is.
 * ---------------------------------------------------------------------- */

/** The REAL set of destinations, read out of the wizard. Same rule as
 *  LOCKED_AWAY_REAL above: a fixture here would test the fixture. */
const SITE_TARGETS_REAL = (() => {
  const m = /const SITE_TARGETS = new Set\(\[([^\]]*)\]\)/.exec(WIZARD_SRC);
  assert.ok(m, 'SITE_TARGETS has been renamed or reshaped');

  const values = m[1].split(',').map(v => v.trim().replace(/^'|'$/g, '')).filter(Boolean);

  return new Set(values);
})();

test('CLOUDFLARE IS A DESTINATION AND IT IS NOT IN THE MODE LIST', () => {
  /* The whole design in one assertion. A mutant that "simplified" this by
   * adding 'cloudflare' to SITE_MODE_VALUES, or to LOCKED_AWAY, would give
   * step 1 a fifth card for something that is not a kind of website. */
  assert.deepStrictEqual([...SITE_TARGETS_REAL], ['cloudflare']);

  const modes = /const SITE_MODE_VALUES = new Set\(\[([^\]]*)\]\)/.exec(WIZARD_SRC);
  assert.ok(modes, 'SITE_MODE_VALUES has been renamed or reshaped');
  assert.ok(!/cloudflare/.test(modes[1]),
    'a destination has been added to the list of modes');
});

test('A LOCKED DESTINATION HIDES NO STEPS AND LOCKS NO MODE', () => {
  /* /cloudflare-sites/new is the open wizard with an address on the end.
   * The mutant this catches is the obvious wrong turn — reusing
   * /github-sites' lock, which would hide step 1 and silently build Rank
   * Fast for somebody who wanted a one-page sample. */
  const hidden = extract('hiddenSteps', {
    STEP: STEP_FIXTURE,
    LOCKED_MODE: '',
    isLocalOptions: () => false,
  })();

  assert.deepStrictEqual(hidden, [],
    'the Cloudflare door hides a step it has no business hiding');

  assert.deepStrictEqual(offered({ locked: '' }),
    ['rankfast', 'sample', 'lead'],
    'the Cloudflare door changed what step 1 offers');
});

test('THE DESTINATION IS PUT INTO THE FORM, SO THE POST CARRIES IT', () => {
  /* WITHOUT THIS THE WHOLE FEATURE IS A NO-OP THAT LOOKS FINE. The address
   * fields render, the build runs, the credits are spent — and
   * utils/jobGenerator.js reads `global.siteTarget` off a payload that
   * never had it, so the site goes nowhere and nothing says so.
   *
   *     THE SILENT HALF-WORKING VERSION IS THE ONE WORTH A TEST. */
  const made = [];
  const appended = [];

  const form = {
    querySelectorAll: () => [],
    appendChild: (n) => appended.push(n),
  };

  const fn = extract('injectSiteTarget', {
    LOCKED_TARGET: 'cloudflare',
    document: { createElement: () => { const n = { classList: { add: () => {} } }; made.push(n); return n; } },
  });

  fn(form);

  assert.strictEqual(appended.length, 1, 'nothing was added to the form');
  assert.strictEqual(appended[0].name, 'global[siteTarget]');
  assert.strictEqual(appended[0].value, 'cloudflare');
  assert.strictEqual(appended[0].type, 'hidden');
});

test('and an ordinary wizard puts nothing there at all', () => {
  /* Not an empty string. generateRoute.js keeps the whole posted body as
   * the job payload, and `siteTarget: ''` sitting in every job forever is
   * a field that reads as meaningful and is not. */
  const appended = [];

  const fn = extract('injectSiteTarget', {
    LOCKED_TARGET: '',
    document: { createElement: () => ({ classList: { add: () => {} } }) },
  });

  fn({ querySelectorAll: () => [], appendChild: (n) => appended.push(n) });

  assert.strictEqual(appended.length, 0,
    'the open wizard posts a destination');
});

test('and it clears the old one first', () => {
  /* The early pass runs again every time somebody walks back to step 4.
   * Two inputs of the same name post both values, and the stale one can
   * win — which is how picking style5 once generated style.css. */
  const removed = [];

  const fn = extract('injectSiteTarget', {
    LOCKED_TARGET: 'cloudflare',
    document: { createElement: () => ({ classList: { add: () => {} } }) },
  });

  fn({
    querySelectorAll: (sel) => {
      assert.match(sel, /global\[siteTarget\]/);

      return [{ remove: () => removed.push(1) }];
    },
    appendChild: () => {},
  });

  assert.strictEqual(removed.length, 1, 'a stale destination is left in the form');
});

test('AND IT IS A STATE-OWNED FIELD, so the snapshot cannot re-inject a stale one', () => {
  const m = /const STATE_OWNED_FIELDS = \[([\s\S]*?)\];/.exec(WIZARD_SRC);
  assert.ok(m, 'STATE_OWNED_FIELDS has been renamed or reshaped');
  assert.match(m[1], /global\[siteTarget\]/,
    'the destination is not state-owned, so a snapshot can overwrite it');
});

test('BOTH INJECTION PASSES CALL IT, not just the one that happens to run', () => {
  /* There are two: the early pass on the main-form step, so the review
   * screen reflects what will be posted, and the one in the submit
   * handler, which is the safety net for an Enter key. `global[styleKey]`
   * has already been fixed in one of them and not the other once. */
  const calls = (WIZARD_SRC.match(/^\s*injectSiteTarget\(form\);/gm) || []).length;

  assert.strictEqual(calls, 2,
    `injectSiteTarget is called ${calls} time(s); both passes need it`);
});

test('THE ADDRESS CARD CARRIES ITS OWN COLOUR', () => {
  /* EDWIN, 17 November: *"This font should be white"* — "Where it goes"
   * rendered near-black on navy while the labels beside it were white.
   *
   * WHY, AND IT IS WORTH WRITING DOWN. form.html whitens headings BY
   * ELEMENT NAME (`h3, h4, label, p, strong, …`). This heading is
   * `<h4 class="h5">`, and Bootstrap's `h5, .h5` rule sets
   * `color: var(--bs-heading-color)`, which resolves to `inherit`. A class
   * selector outranks an element selector, so the page's rule lost and the
   * heading inherited `.card`'s own near-black `--bs-body-color`.
   *
   *     A STYLESHEET THAT COLOURS BY TAG NAME IS ONE BOOTSTRAP CLASS AWAY
   *     FROM NOT APPLYING, AND NOTHING ANYWHERE SAYS SO.
   *
   * THE CARD, NOT THE HEADING, so anything added inside it later is covered
   * too — the same fix the build card on /cloudflare-sites already carries,
   * for the same reason, which is why this is asserted rather than left to
   * be rediscovered a third time.
   *
   * RUN, NOT GREPPED. The function is lifted and executed against stubs, so
   * what is asserted is the class the card is actually created with. */
  const made = [];

  const fn = extract('renderCloudflareFields', {
    el: (tag, attrs) => {
      const node = {
        tag,
        class: (attrs && attrs.class) || '',
        innerHTML: '',
        appendChild: () => {},
        querySelector: () => ({ innerHTML: '' }),
      };
      made.push(node);

      return node;
    },
    escapeHtml: (v) => String(v == null ? '' : v),
    state: { mainFormSnapshot: { 'global[businessName]': 'Leander Chiropractor' } },
    fetch: () => ({ then: () => ({ then: () => ({ catch: () => {} }) }) }),
  });

  /* THE PARENT ANSWERS querySelector NOW. Since 18 November the card lives
   * on the main form and reads the business-name box out of its parent, so
   * the subdomain can follow it as it is typed. A stub without it throws,
   * which is how this test found out the function's reach had changed. */
  fn({ appendChild: () => {}, querySelector: () => null });

  const card = made[0];
  assert.ok(card, 'renderCloudflareFields created no card');

  assert.match(card.class, /\btext-white\b/,
    'the address card does not set its own colour, so its heading inherits '
    + "Bootstrap's near-black card text on a navy page");

  /* AND THE HEADING IS STILL INSIDE IT, so the assertion above is about
   * something. A card with text-white and no heading would pass. */
  assert.match(card.innerHTML, /<h4[^>]*>\s*Where it goes/,
    'the heading this is about is no longer in the card');
});

test('A DRAFT THAT PUBLISHES ITSELF IS REFUSED ON A PAGE THAT PUBLISHES ELSEWHERE', () => {
  /* THE ONE COLLISION BETWEEN THE TWO AXES.
   *
   * Local Website Options pushes its own eleven pages to GitHub and
   * reports back in `published` — and utils/jobGenerator.js returns on
   * that report BEFORE it looks at the destination. So a localoptions
   * build with a Cloudflare address would go to GitHub, drop the address,
   * and say nothing.
   *
   * It cannot be CHOSEN on this page: modesOnOffer() filters it out of the
   * open wizard. A resumed draft is the only way in. */
  const state = { siteMode: 'rankfast', styleKey: 'style', logoType: 'text' };

  const fn = extract('applyDraft', {
    LOCKED_MODE: '',
    LOCKED_TARGET: 'cloudflare',
    LOCKED_AWAY: LOCKED_AWAY_REAL,
    state,
    businessTypeKey: () => '',
  });

  fn({ siteMode: 'localoptions', styleKey: 'style9' });

  assert.strictEqual(state.siteMode, 'rankfast',
    'a GitHub-publishing draft was restored onto the Cloudflare door');
  assert.strictEqual(state.styleKey, 'style',
    'the draft was half applied, which is worse than not applied');
});

test('and the same draft IS restored on the ordinary wizard', () => {
  /* The guard is about the destination, not about the mode. On / there is
   * nowhere else for the build to go, so the draft is the only thing that
   * decided anything — see the note in modesOnOffer(). */
  const state = { siteMode: 'rankfast', styleKey: 'style', logoType: 'text' };

  const fn = extract('applyDraft', {
    LOCKED_MODE: '',
    LOCKED_TARGET: '',
    LOCKED_AWAY: LOCKED_AWAY_REAL,
    state,
    businessTypeKey: () => '',
  });

  fn({ siteMode: 'localoptions', styleKey: 'style9' });

  assert.strictEqual(state.siteMode, 'localoptions',
    'the open wizard refuses a draft it should restore');
});

/* -------------------------------------------------------------------------
 * A SECOND GENERATE WHILE THE FIRST IS STILL RUNNING
 *
 * Edwin, 17 November: *"How do we fix the problem of a user creating a site
 * and while the site is being built he fills out the generator form again
 * and presses generate for a second site?"*
 *
 * IT WAS ALREADY PREVENTED. routes/generateRoute.js refuses with a 409 when
 * a queued or running job of theirs touches the build folder, so two builds
 * cannot overlap. What was broken was everything after the refusal:
 *
 *   spinner.js followed data.redirect WITHOUT SHOWING THE MESSAGE, so
 *   pressing Generate teleported them to a progress page for a different
 *   website, already part way through. generateRoute.js's own comment
 *   records Edwin hitting this and watching a bar fill for a build he had
 *   not started.
 *
 *   And the review step called clearDraft() BEFORE submitting, so by the
 *   time they landed there, the answers they had just typed were gone from
 *   the screen AND from sessionStorage.
 *
 *     A REFUSAL THAT NAVIGATES INSTEAD OF SPEAKING IS INDISTINGUISHABLE
 *     FROM A SUCCESS THAT WENT WRONG — and this one took the draft with it.
 * ---------------------------------------------------------------------- */

const SPINNER_SRC = fs.readFileSync(
  path.join(__dirname, 'public', 'js', 'spinner.js'), 'utf8');

/** Source with its comments removed, so a note explaining a change cannot
 *  satisfy an assertion about the code that made it. Three mutants in this
 *  project have hit prose instead of code. */
const bare2 = (src) => String(src)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

test('THE WIZARD DOES NOT THROW THE DRAFT AWAY BEFORE THE SUBMIT LANDS', () => {
  /* The Generate button used to call clearDraft() and then fire the submit.
   * Everything it had just saved was gone before the request was sent, so
   * every refusal — 409, out of credits, a server-side validation the
   * wizard does not run — lost the answers.
   *
   * COMMENTS STRIPPED, because the note explaining this change names the
   * function it removed. */
  const generate = /onNext: \(\) => \{[\s\S]*?requestSubmit[\s\S]*?\n      \}/.exec(bare2(WIZARD_SRC));

  assert.ok(generate, 'the Generate button has been reshaped; this test cannot find it');
  assert.ok(!/clearDraft\(\)/.test(generate[0]),
    'the draft is still cleared before the submit is even sent');
});

test('and it hands the clearing to the code that sees the response', () => {
  /* This file fires the submit and never learns what came back. spinner.js
   * does, so it owns the decision — through a hook on window, the same way
   * saveDraft is already shared with it for the credits modal. */
  assert.match(bare2(WIZARD_SRC), /window\.ieClearDraft\s*=\s*clearDraft/,
    'nothing exposes the draft clear, so a successful build never clears it');
});

test('AND spinner.js CLEARS IT ONLY ONCE THE BUILD IS ACCEPTED', () => {
  /* POSITION, NOT PRESENCE. A clear sitting anywhere in that handler is
   * "we cleared the draft"; only one sitting inside the success branch is
   * "we cleared it because the build exists". */
  const src = bare2(SPINNER_SRC);

  const success = src.indexOf('response.ok && data.ok && data.redirect');
  const clear = src.indexOf('ieClearDraft');
  const credits = src.indexOf('data.creditsError');

  assert.ok(success > -1, 'the success branch has moved; this test cannot place the clear');
  assert.ok(clear > -1, 'spinner.js never clears the draft, so it comes back on the next visit');
  assert.ok(clear > success && clear < credits,
    'the draft is cleared outside the branch that knows the build was accepted');
});

test('A 409 IS SAID, NOT ACTED ON', () => {
  /* The refusal used to navigate. Now it shows the message and offers the
   * door, so leaving the page is the customer's decision and the form —
   * with their answers still in it — stays where it is.
   *
   * ONE NAVIGATION IN THE WHOLE HANDLER, and that is the assertion: the
   * success branch. A second one anywhere else is the old behaviour back. */
  const src = bare2(SPINNER_SRC);

  const jumps = (src.match(/window\.location\.href = data\.redirect/g) || []).length;
  assert.strictEqual(jumps, 1,
    `${jumps} places navigate to data.redirect; only the accepted build should`);

  const branch = /if \(response\.status === 409\) \{[\s\S]*?\n          \}/.exec(src);
  assert.ok(branch, 'the 409 branch has been removed or reshaped');

  assert.match(branch[0], /showAlert\(/,
    'a build already running is refused without a word to the customer');
  assert.ok(!/window\.location/.test(branch[0]),
    'the 409 still navigates, so the message it sets is never read');
  assert.match(branch[0], /data\.redirect/,
    'the message does not offer the running build, so it is a dead end');
});

/* -------------------------------------------------------------------------
 * The two doors, served
 * ---------------------------------------------------------------------- */

async function render(routePath) {
  const express = require('express');
  const app = express();

  app.use((req, res, next) => {
    res.locals.csrfToken = 'T';
    res.locals.csrfField = '<input name="_csrf">';
    next();
  });
  app.use(require('./routes/formRoute'));

  const srv = app.listen(0);
  const { port } = srv.address();

  try {
    const res = await fetch(`http://127.0.0.1:${port}${routePath}`);

    return { status: res.status, html: await res.text() };
  } finally {
    srv.close();
  }
}

(async () => {

  await asyncTest('/github-sites SERVES THE WIZARD, LOCKED', async () => {
    /* SERVED, NOT INSPECTED AS SOURCE. The mutant this catches is the
     * route quietly dropping the meta tag: every unit test above still
     * passes, because they hand LOCKED_MODE in directly. The page would
     * render the four cards and the sidebar row would lead to the ordinary
     * wizard, with nothing broken enough to notice. */
    const { status, html } = await render('/github-sites');

    assert.strictEqual(status, 200);
    assert.ok(/<meta name="site-mode" content="localoptions">/.test(html),
      'the page does not tell the wizard which mode it is for');
    assert.ok(/href="\/github-sites"[^>]*app-sidebar-link-active/.test(html),
      'the GitHub row is not marked as the current page');
  });

  await asyncTest('/cloudflare-sites/new SERVES THE WIZARD WITH A DESTINATION', async () => {
    /* THE TWO-STEP FIX, END TO END AT THE DOOR. The mutant this catches is
     * the route dropping the site-target meta tag: every unit test above
     * still passes, because they hand LOCKED_TARGET in directly. The page
     * would render the whole wizard, build the site, spend the credits —
     * and publish nowhere, which is precisely the two-step this replaced,
     * minus the second step. */
    const { status, html } = await render('/cloudflare-sites/new');

    assert.strictEqual(status, 200);
    assert.ok(/<meta name="site-target" content="cloudflare">/.test(html),
      'the page does not tell the wizard where to publish');

    assert.ok(!/name="site-mode"/.test(html),
      'the Cloudflare door locks a mode as well, which it has no business doing');

    /* THE ROW IS THIS URL — CORRECTED 17 November. It was /cloudflare-sites
     * for a day, on the reasoning that a product should be one place in the
     * sidebar. But /cloudflare-sites is the LIST, so the BUILD WEBSITES row
     * opened a table while GitHub's opened a wizard, and Edwin pressed it
     * expecting the wizard. The list has its own MANAGE row now.
     *
     * AND THE LIST'S ROW MUST NOT LIGHT UP HERE, which is the half that
     * would go unnoticed: appSidebar() matches the path exactly, so a
     * careless `startsWith` would mark both rows on this page and neither
     * would mean anything. */
    assert.ok(/href="\/cloudflare-sites\/new"[^>]*app-sidebar-link-active/.test(html),
      'the Cloudflare build row is not marked as the current page');

    assert.ok(!/href="\/cloudflare-sites"[^>]*app-sidebar-link-active/.test(html),
      'the Cloudflare LIST row is lit up on the wizard page as well');
  });

  await asyncTest('EVERY DOOR SAYS WHAT IT IS BUILDING', async () => {
    /* EDWIN, 17 November: *"Please add a heading to the wizard showing the
     * user if they are Building a Website, Building a Cloudflare Website,
     * building a Github Website"*.
     *
     * The page had NO heading at all. All three routes opened on "1. What
     * are we building?", and the only thing on screen that differed was
     * which sidebar row was lit — at the far left, in a column people stop
     * reading once they have clicked in it.
     *
     *     THE LIT ROW IS WHERE YOU CAME FROM. A HEADING IS WHERE YOU ARE,
     *     AND ONLY ONE OF THOSE SURVIVES A BOOKMARK OR A RELOAD.
     *
     * THE THREE ARE ASSERTED TOGETHER AND AGAINST EACH OTHER: a mutant
     * giving every door the same heading is the version of this bug that
     * looks fixed. */
    const seen = {};

    for (const path of ['/', '/github-sites', '/cloudflare-sites/new']) {
      const { status, html } = await render(path);

      assert.strictEqual(status, 200, `${path} did not render`);

      const m = /<h1 class="h3 mb-1">([^<]+)<\/h1>/.exec(html);
      assert.ok(m, `${path} has no heading saying what it builds`);

      seen[path] = m[1].trim();
    }

    assert.deepStrictEqual(seen, {
      '/': 'Build a website',
      '/github-sites': 'Build a GitHub website',
      '/cloudflare-sites/new': 'Build a Cloudflare website',
    });

    const texts = Object.values(seen);
    assert.strictEqual(new Set(texts).size, texts.length,
      'two doors carry the same heading, so it cannot tell them apart');
  });

  await asyncTest('and each one says where the finished site ends up', async () => {
    /* THE BLURB CARRIES WHAT A HEADING CANNOT: what happens when the build
     * finishes. Those three endings — it waits here, it goes to GitHub
     * Pages, it goes to a subdomain — are the actual difference between the
     * doors, and before this nothing said them until the review step. On
     * /github-sites, not even then. */
    const blurb = async (path) => {
      const { html } = await render(path);
      const m = /<p class="text-white-50 mb-4">([\s\S]*?)<\/p>/.exec(html);

      return m ? m[1].replace(/\s+/g, ' ').trim() : '';
    };

    assert.match(await blurb('/'), /waits here/i);
    assert.match(await blurb('/github-sites'), /GitHub Pages/);
    assert.match(await blurb('/cloudflare-sites/new'), /subdomain/i);
  });

  await asyncTest('AND THE HEADING IS VISIBLE, WHICH IS NOT THE SAME AS PRESENT', async () => {
    /* EDWIN, 17 November: *"the headings should be white color"*. The
     * heading shipped near-black on navy — present in the markup, readable
     * by no one.
     *
     * THE SAME BUG TWICE IN TWO DAYS, and I wrote the note about the first
     * one. form.html colours headings BY ELEMENT NAME. Bootstrap 5.3 sets
     * `h1..h6, .h1..h6 { color: var(--bs-heading-color) }` and that token
     * resolves to `inherit`, so a heading carrying a Bootstrap heading
     * CLASS loses the page's rule — a class selector outranks an element
     * one — and inherits `.card`'s near-black instead.
     *
     *   "Where it goes"            <h4 class="h5">   16 November
     *   "Build a Cloudflare..."    <h1 class="h3">   17 November
     *
     *     COLOURING BY TAG NAME IS ONE BOOTSTRAP CLASS AWAY FROM NOT
     *     APPLYING, AND NOTHING ANYWHERE SAYS SO.
     *
     * THE TEST IS THE PAIRING, not the list: whatever heading class the
     * markup uses must be one the stylesheet also names. That is what makes
     * this fail on the next `<h2 class="h4">` somebody writes, rather than
     * on a change to a list of selectors. */
    const { html } = await render('/cloudflare-sites/new');

    const styles = (html.match(/<style>[\s\S]*?<\/style>/g) || []).join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '');

    const whitened = /([^{}]+)\{\s*color:\s*white;?\s*\}/g;

    const named = new Set();
    let rule;
    while ((rule = whitened.exec(styles))) {
      for (const sel of rule[1].split(',')) named.add(sel.trim());
    }

    const heading = /<h([1-6])([^>]*)>/g;
    let tag;
    let checked = 0;

    while ((tag = heading.exec(html))) {
      const level = `h${tag[1]}`;
      const classes = (/class="([^"]*)"/.exec(tag[2]) || ['', ''])[1].split(/\s+/);
      const bootstrap = classes.find(c => /^h[1-6]$/.test(c));

      if (!bootstrap) continue;   // coloured by its own tag, already in the list

      checked += 1;

      assert.ok(named.has(`.${bootstrap}`),
        `<${level} class="${bootstrap}"> is near-black on navy: the page `
        + `whitens "${level}" by tag, and Bootstrap's ".${bootstrap}" rule `
        + 'outranks it. Add the class to the stylesheet.');
    }

    assert.ok(checked > 0,
      'no heading on this page carries a Bootstrap heading class, so this '
      + 'test is asserting nothing — has the wizard heading been removed?');
  });

test('designsFor GIVES A MODE ITS OWN ROWS AND NOBODY ELSE ANYTHING', () => {
  /* ASSERTED ON THE FUNCTION, NOT ONLY THROUGH THE PAGE, and two surviving
   * mutants are why. Every design in the list belongs to `localoptions`
   * today, so `return DESIGNS` — no filtering at all — produces the same
   * answer as the real filter for the only mode that has any. Both mutants
   * passed every test that went through the served page.
   *
   *     WHILE ONE MODE OWNS EVERYTHING, "FILTERED" AND "NOT FILTERED"
   *     ARE THE SAME OUTPUT. The behaviour that distinguishes them is
   *     what happens to every OTHER mode, and that has to be asked
   *     directly.
   *
   * This stops being subtle the day design 4 exists; the point of writing
   * it now is that the filter is proved before anything depends on it. */
  const { DESIGNS, designsFor } = require('./utils/localOptions/designs');

  const mine = DESIGNS.filter(d => d.modes.includes('localoptions'));

  assert.deepStrictEqual(designsFor('localoptions'), mine,
    'a mode is not given exactly its own designs');

  /* A ROW NOW BELONGS TO A LIST OF DOORS — 18 November. `d.mode ===` was
   * the filter here and it compared a string to an array: it matched
   * nothing, so `mine` was empty and so was the assertion. An empty list
   * compared against an empty list passes while proving nothing. */
  assert.ok(mine.length, 'the GitHub door is being checked against nothing');

  /* THE HALF THAT CATCHES AN UNFILTERED LIST. */
  assert.deepStrictEqual(designsFor('cloudflareauto'), [],
    'a mode with no designs of its own was handed somebody else\'s');

  assert.deepStrictEqual(designsFor('nonsense'), [],
    'an unknown mode was handed a list');

  assert.deepStrictEqual(designsFor(''), [],
    'the open wizard, which has no design step, was handed a list');

  assert.deepStrictEqual(designsFor(null), [],
    'a missing mode was handed a list');

  /* AND EVERY ROW CLAIMS AT LEAST ONE DOOR. A design with none is offered
   * nowhere and buildable everywhere — the quiet half of the same bug. */
  for (const d of DESIGNS) {
    assert.ok(Array.isArray(d.modes) && d.modes.length,
      `design ${d.id} names no door, so none will offer it`);
  }
});

  await asyncTest('EACH DOOR OFFERS ONLY ITS OWN DESIGNS', async () => {
    /* EDWIN, 17 November, planning five NEW layouts for the automated
     * Cloudflare mode that share nothing with GitHub's: *"can we just show
     * each group of designs mapped out to either github/cloudflare so the
     * user never has to worry about mixing them up?"*
     *
     * WHY NOT A WARNING. structureFor() FALLS BACK rather than throwing —
     * deliberately, and its own note explains why: refusing to build a
     * paid-for site over a typo in a layout name is the worse failure. So
     * picking a Cloudflare layout on the GitHub wizard would not fail. It
     * would quietly build Ledger, and the only sign would be that the site
     * looked like the last one.
     *
     *     A WRONG CHOICE THAT STILL BUILDS SOMETHING IS WORSE THAN ONE
     *     THAT REFUSES. The fix is not to warn about it; it is not to
     *     offer it.
     *
     * FILTERED ON THE SERVER, so the browser on /github-sites is never told
     * the others exist — which is why this is asserted on the SERVED page
     * and not on the wizard's own filtering. */
    const { html } = await render('/github-sites');

    const tag = /<meta name="site-designs" content="([^"]*)">/.exec(html);
    assert.ok(tag, '/github-sites is not told which designs it offers');

    const offered = JSON.parse(tag[1]
      .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>'));

    const { DESIGNS } = require('./utils/localOptions/designs');

    const mine = DESIGNS.filter(d => d.modes.includes('localoptions')).map(d => d.id);
    const theirs = DESIGNS.filter(d => !d.modes.includes('localoptions')).map(d => d.id);

    assert.ok(mine.length && theirs.length,
      'one of the two halves of this test is empty, so it proves nothing');

    assert.deepStrictEqual(offered.map(d => d.id), mine,
      'the GitHub door does not offer exactly its own designs');

    for (const id of theirs) {
      assert.ok(!offered.some(d => d.id === id),
        `design ${id} belongs to another mode and is offered on /github-sites`);
    }

    /* AND EVERY ROW IN designs.js CLAIMS A MODE. One without is offered
     * nowhere and buildable everywhere — the quiet half of this bug. */
    for (const d of DESIGNS) {
      assert.ok(Array.isArray(d.modes) && d.modes.length,
        `design ${d.id} names no door, so none will offer it`);
    }
  });

  await asyncTest('and a door with no designs of its own draws no dropdown', async () => {
    /* The state the Cloudflare mode is in until its first layout exists,
     * and the state the open wizard is in permanently — it has no design
     * step at all. A control with nothing in it is worse than no control. */
    for (const path of ['/', '/cloudflare-sites/new']) {
      const { html } = await render(path);

      assert.ok(!/name="site-designs"/.test(html),
        `${path} is handed a design list it has no use for`);
    }
  });

  await asyncTest('AND NO DOOR SHIPS AN UNFILLED PLACEHOLDER', async () => {
    /* form.html substitutes with a GLOBAL regex and its own comment records
     * the time a placeholder named inside a comment injected a second copy
     * of the header. A marker that survives to the browser is the other
     * half of that: it renders as literal braces on the page. */
    for (const path of ['/', '/github-sites', '/cloudflare-sites/new']) {
      const { html } = await render(path);

      assert.ok(!/\{\{[A-Z_]+\}\}/.test(html),
        `${path} ships an unfilled placeholder: ${(/\{\{[A-Z_]+\}\}/.exec(html) || [])[0]}`);
    }
  });

  await asyncTest('and / serves the same wizard, deciding nothing', async () => {
    const { status, html } = await render('/');

    assert.strictEqual(status, 200);
    assert.ok(!/name="site-mode"/.test(html),
      'the open wizard is locked to a mode');
    assert.ok(!/name="site-target"/.test(html),
      'the open wizard publishes somewhere without being asked to');
    assert.ok(/href="\/"[^>]*app-sidebar-link-active/.test(html),
      'the Websites row is not marked on /');
  });

  console.log('');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('');
  process.exit(failed === 0 ? 0 : 1);

})();
