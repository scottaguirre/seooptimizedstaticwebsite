// test-nav-dropdown.js
//
// The SERVICES and LOCATIONS dropdowns, and the two ways they have already
// gone wrong without anybody noticing.
//
// WHY THIS FILE EXISTS — 14 November, and both bugs were found by RENDERING
// the real nav with MAX_SERVICES items rather than by reading the CSS.
//
//   1. THE ITEMS WERE INVISIBLE, FOR A DAY, IN PRODUCTION.
//
//      style8's header became a white bar on 13 November, so the nav links
//      went dark. buildNavMenu.js writes dropdown entries with
//      `class="dropdown-item nav-link"`, so they took the dark colour too —
//      while their panel stayed `background: var(--navy)`.
//
//          computed background  rgb(10, 31, 82)
//          computed text        rgb(10, 31, 82)
//
//      The same colour. Twenty services, none of them readable. Nothing
//      threw, nothing logged, the menu opened exactly as before.
//
//   2. EVERY ITEM OVERFLOWED ITS PANEL BY 21px.
//
//      `.nav-link` gets `margin: 0 22px` at 992px and up, which is the air
//      between ABOUT US and SERVICES along the bar. Dropdown entries are
//      .nav-link as well, so they took 44px of margin inside a 250px item.
//      Long names were clipped mid-word. Invisible for as long as bug 1
//      hid it.
//
//   3. AND THE LIST RAN OFF THE BOTTOM OF THE SCREEN.
//
//      MAX_SERVICES is 20; twenty items draw a 926px menu in an 800px
//      window with `overflow-y: visible` and no cap. The items below the
//      fold were not merely off-screen — there was nothing to scroll, and
//      the menu opens on hover, so scrolling the page closes it.
//
// WHAT THIS FILE CAN AND CANNOT DO. It reads the stylesheet as text. That
// is weaker than a browser, and it is what runs in a deploy gate without a
// headless Chrome. The checks are therefore about the RULES being present
// and not contradicting each other, which is exactly what went wrong.
//
//   node test-nav-dropdown.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}
function section(name) { console.log(`\n${name}\n`); }

/* ===================================================================== */

const THEME_DIR = path.join(__dirname, 'src', 'css', 'themes');

/**
 * TWO LISTS, BECAUSE THE THREE BUGS DO NOT HAVE THE SAME BLAST RADIUS.
 *
 * The invisible items were style8's alone: its header went white, so its
 * links went dark onto a panel that stayed dark. style7's header is
 * transparent over a photograph, its links are white, and its panel is
 * navy — measured rgb(15, 23, 51) behind rgb(255, 255, 255), which is fine
 * and must not be "fixed".
 *
 * The overflow and the missing cap are style7's bugs that style8 INHERITED
 * by being a copy of it. Both are checked on both.
 *
 * THE OTHER SIX ARE NOT HERE, AND THAT IS A DECISION RATHER THAN AN
 * OVERSIGHT. Measured at 1435x800 with twenty services, every one of them
 * overflows too — style3 by 593px, style5 and style6 by ~390px, style4 by
 * 279px, style1 by 116px. style2's menu does not open this way at all.
 * style2-style6 are on the DO NOT TOUCH list in CLAUDE.md and style.css is
 * to be treated the same, so fixing them is Edwin's call, not a tidy-up.
 * Adding them to this list before they are fixed would be a suite that
 * fails on purpose, which is a suite nobody runs.
 */
/* style2 IS HERE, AND WAS ALMOST NOT. The sweep that found the others opened
 * each menu with Bootstrap's `.show` class; style2 ignores it and opens only
 * on :hover, so the probe measured a 0px menu and the design was written
 * down as unaffected. A real hover showed 357px below the fold. */
const CAPPED = ['style', 'style2', 'style3', 'style4', 'style5', 'style6', 'style7', 'style8', 'style9'];

/**
 * The designs whose dropdown entries were taking the BAR's side margin.
 *
 * NOT style5 OR style6, AND THAT WAS MEASURED RATHER THAN ASSUMED. Their
 * items came back with 0px of overflow — their bar margin is 10px a side
 * rather than 22px, and their panels are wide enough to hold it. Adding the
 * zeroing rule there would be a fix for a bug they do not have.
 *
 * style4 IS HERE DESPITE ALSO USING 10px, because it additionally pins the
 * anchor to `width: 200px` inside a 200px <li>: 200 + 10 + 10 does not fit
 * in 200, and it overflowed by 9px. Same cause, different arithmetic — which
 * is why each design was measured rather than grouped by its margin value.
 *
 * FOUR DESIGNS, FOUR OVERFLOWS, THREE DIFFERENT BAR MARGINS:
 *
 *     style   15px a side  ->  14px over
 *     style4  10px a side  ->   9px over
 *     style7  22px a side  ->  21px over
 *     style8  22px a side  ->  21px over
 *
 * Always one less than the margin, because the panel shrink-wraps the item
 * and only the right-hand margin escapes it.
 */
const MARGIN_SCOPED = ['style', 'style4', 'style7', 'style8', 'style9'];

/** The designs with a WHITE header, which is what makes the colour a trap. */
const LIGHT_HEADER = ['style8'];

/**
 * The designs with a DARK bar and a LIGHT panel — the same trap, inverted.
 *
 * THIS LIST EXISTS BECAUSE THE BUG HAPPENED TWICE, FROM OPPOSITE SIDES.
 * style8 turned its header white, its bar links went dark to suit, and the
 * panel was still dark: navy on navy. style9 is a copy of style8 with the
 * header turned back to blue, so its bar links went WHITE — onto the white
 * panel it inherited. Measured, in a real render: background
 * rgb(255,255,255), text rgb(255,255,255).
 *
 *     THE DEFECT IS NOT A COLOUR. IT IS THAT ONE SELECTOR DRESSES TWO
 *     SURFACES, AND NOTHING IN CSS OBJECTS WHEN THEY STOP MATCHING.
 *
 * The LIGHT_HEADER test cannot be reused here. It reads the exact
 * `#headerColor .nav-link` rule, which in style9 is correctly `#fff` for the
 * BAR; comparing that to the white panel would fail a design that is right.
 * What makes style9 right is a second, dropdown-scoped rule that overrides
 * it — so that is what this checks for, and checks is not the panel colour.
 */
const DARK_BAR_LIGHT_PANEL = ['style9'];

const css = Object.fromEntries(
  [...new Set([...CAPPED, ...MARGIN_SCOPED, ...LIGHT_HEADER, ...DARK_BAR_LIGHT_PANEL])]
    .map(k => [k, fs.readFileSync(path.join(THEME_DIR, `${k}.css`), 'utf8')]));

/**
 * The declarations of one property inside a rule whose selector matches.
 *
 * DELIBERATELY CRUDE, AND THE COMMENTS GO FIRST. A stylesheet is not a
 * regular language and this is not a parser — but the questions here are
 * "does this rule set this property, and to what", which a block scan can
 * answer. Comments are stripped because this file's subject is full of
 * prose that names the very colours being searched for; a check that reads
 * the explanation of a bug instead of the fix is a check that passes
 * forever. That mistake was made twice yesterday, in another suite.
 */
function declarations(src, selectorPattern, property) {
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];

  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;

  while ((m = re.exec(clean))) {
    const selector = m[1].trim();
    if (!selectorPattern.test(selector)) continue;

    const body = m[2];
    const prop = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'i').exec(body);
    if (prop) out.push({ selector, value: prop[1].trim() });
  }

  return out;
}

/**
 * Everything inside EVERY `@media (min-width: 992px)`, joined.
 *
 * ALL THIRTEEN OF THEM, which is the bug this helper had on its first run.
 * It took the first block, found no dropdown rules in it, and reported that
 * the cap was missing — while also reporting the cap as a stray OUTSIDE the
 * block, because "outside" was the file minus one early section. Two
 * failures, one cause, and the cause was the test.
 */
function desktopBlock(src) {
  const MARK = '@media (min-width: 992px)';
  const parts = [];

  for (let at = src.indexOf(MARK); at !== -1; at = src.indexOf(MARK, at + 1)) {
    /* Brace-matched from the `{` that opens the query, so a nested rule
     * does not end the block early. */
    const open = src.indexOf('{', at);
    let depth = 0;

    for (let i = open; i < src.length; i += 1) {
      if ('{' === src[i]) depth += 1;
      if ('}' === src[i]) {
        depth -= 1;
        if (0 === depth) { parts.push(src.slice(open + 1, i)); break; }
      }
    }
  }

  assert.ok(parts.length, 'the 992px breakpoint has been renamed or removed');
  return parts;
}

/** The same, as one string, for the checks that only ask "is it in here". */
const desktopText = (src) => desktopBlock(src).join('\n');

/* ===================================================================== */
section('THE ITEMS HAVE TO BE READABLE ON THEIR OWN PANEL');

for (const key of LIGHT_HEADER) {
  test(`${key}: the dropdown panel is not the colour of its own text`, () => {
    /* THE BUG, STATED AS A RULE. The panel's background and the nav link's
     * colour were both var(--navy). This does not need to know which
     * colour is correct — only that one cannot be both. */
    const panels = declarations(css[key], /\.dropdown-menu\b/, 'background');
    assert.ok(panels.length, '.dropdown-menu sets no background at all');

    /* THE BASE RULE, FOUND BY ITS EXACT SELECTOR, not by a pattern.
     *
     * A loose `#headerColor ... .nav-link` match also catches
     * `#headerColor .navbar .dropdown:hover > .nav-link`, which colours the
     * word SERVICES on the bar and has nothing to do with the panel. The
     * first version of this test failed on exactly that and would have had
     * me "fixing" a rule that was correct.
     *
     * `#headerColor .nav-link` with no combinator is the one that reaches a
     * dropdown entry, because an entry IS a .nav-link inside #headerColor.
     * That is the rule that went dark on 13 November. */
    const inks = declarations(css[key], /(^|,)\s*#headerColor \.nav-link\s*(,|$)/, 'color');

    assert.ok(inks.length,
      'no rule matches `#headerColor .nav-link` — the selector that reaches '
      + 'a dropdown entry has been renamed, and this check is now blind');

    const norm = (v) => v.replace(/\s+/g, '').replace(/!important/i, '');

    for (const panel of panels) {
      for (const ink of inks) {
        assert.notStrictEqual(norm(panel.value), norm(ink.value),
          `${panel.selector} { background: ${panel.value} } and `
          + `${ink.selector} { color: ${ink.value} } are the same colour — `
          + 'every dropdown item would be invisible');
      }
    }
  });

  test(`${key}: the panel is light, so the dark link colour is right on it`, () => {
    const panels = declarations(css[key], /^\.dropdown-menu,?$|\.dropdown-menu,/, 'background');
    assert.ok(panels.some(p => /#fff\b|#ffffff\b|white/i.test(p.value)),
      'the dropdown panel is not white, but the links in it are dark — '
      + 'one of the two has to change');
  });
}

for (const key of DARK_BAR_LIGHT_PANEL) {
  test(`${key}: a dropdown-scoped rule re-darkens the items the bar whitened`, () => {
    const panels = declarations(css[key], /^\.dropdown-menu,?$|\.dropdown-menu,/, 'background');
    assert.ok(panels.some(p => /#fff\b|#ffffff\b|white/i.test(p.value)),
      'the panel is no longer light, so this check is testing the wrong shape '
      + `— move ${key} out of DARK_BAR_LIGHT_PANEL`);

    /* THE BAR'S RULE, WHICH IS CORRECT AND IS THE PROBLEM. White links on a
     * blue bar; the same selector reaches every entry in the panel. */
    const bar = declarations(css[key], /(^|,)\s*#headerColor \.nav-link\s*(,|$)/, 'color');
    assert.ok(bar.length,
      'no rule matches `#headerColor .nav-link` — the selector that leaks the '
      + 'bar colour into the panel has been renamed, and this check is blind');

    /* THE OVERRIDE. Scoped INSIDE .dropdown-menu, so it dresses the panel
     * only, and !important because the rule it has to beat carries it. */
    const inPanel = declarations(
      css[key], /#headerColor \.dropdown-menu a?\.nav-link\s*(,|$)/, 'color');

    assert.ok(inPanel.length,
      'nothing colours a dropdown entry from inside .dropdown-menu, so every '
      + `item takes the bar's ${bar[0].value} onto a white panel and vanishes`);

    const norm = (v) => v.replace(/\s+/g, '').replace(/!important/i, '');

    for (const ink of inPanel) {
      assert.ok(/!important/i.test(ink.value),
        `${ink.selector} { color: ${ink.value} } has no !important, so the `
        + `bar's ${bar[0].value} wins and the items are invisible again`);

      for (const panel of panels) {
        assert.notStrictEqual(norm(ink.value), norm(panel.value),
          `${ink.selector} paints items the colour of their own panel`);
      }
      for (const b of bar) {
        assert.notStrictEqual(norm(ink.value), norm(b.value),
          `${ink.selector} repeats the bar colour instead of overriding it`);
      }
    }
  });
}

/* ===================================================================== */
section('THE 22px BAR MARGIN IS NOT FOR THE LIST');

for (const key of MARGIN_SCOPED) {
  test(`${key}: dropdown entries have their horizontal margin zeroed`, () => {
    /* buildNavMenu.js writes them as `dropdown-item nav-link`, so the
     * margin that spaces the HORIZONTAL bar lands inside a 250px vertical
     * item and pushes its text out of the panel. */
    const block = desktopText(css[key]);

    const left = declarations(block, /\.dropdown-menu\s[^,]*\.nav-link|\.dropdown-menu\s\.nav-link/, 'margin-left');
    const right = declarations(block, /\.dropdown-menu\s[^,]*\.nav-link|\.dropdown-menu\s\.nav-link/, 'margin-right');

    assert.ok(left.length && /^0/.test(left[0].value),
      'nothing zeroes margin-left on a dropdown entry at 992px and up');
    assert.ok(right.length && /^0/.test(right[0].value),
      'nothing zeroes margin-right on a dropdown entry at 992px and up');
  });
}

/* ===================================================================== */
section('TWENTY SERVICES HAVE TO BE REACHABLE');

for (const key of CAPPED) {
  test(`${key}: the dropdown is capped and scrolls at 992px and up`, () => {
    const block = desktopText(css[key]);

    const caps = declarations(block, /\.dropdown-menu\b/, 'max-height');
    assert.ok(caps.length, 'the dropdown has no max-height, so 20 services run off the screen');

    const flows = declarations(block, /\.dropdown-menu\b/, 'overflow-y');
    assert.ok(flows.some(f => /auto|scroll/.test(f.value)),
      'the dropdown is capped but does not scroll, which HIDES the items instead');
  });

  test(`${key}: the cap is measured against the viewport, not a fixed height`, () => {
    /* AND NOT A SHARED CONSTANT EITHER. style6's header is 70px with its
     * menu starting at y=44; style7 and style8 are 90px starting at 65. The
     * subtrahend is per design, so this checks the SHAPE of the value and
     * not its number. */
    /* A pixel cap tuned on one screen is wrong on the next. The failure is
     * silent either way — items below the cap simply are not there. */
    const block = desktopText(css[key]);
    const caps = declarations(block, /\.dropdown-menu\b/, 'max-height');

    assert.ok(caps.every(c => /vh\b/.test(c.value)),
      `max-height is ${caps.map(c => c.value).join(', ')} — a fixed height `
      + 'is right on one window size and wrong on every other');
  });

  test(`${key}: and the cap does NOT apply to the collapsed menu`, () => {
    /* Below 992px the menu is `position: static` inside the collapsed
     * panel: it is in flow, the page grows, and the page's own scrollbar
     * reaches every item. A cap there puts a small scrolling box inside a
     * scrolling page, which is worse than the problem it solves. */
    const block = desktopText(css[key]);
    const outside = desktopBlock(css[key]).reduce((acc, b) => acc.replace(b, ''), css[key]);

    const strays = declarations(outside, /\.dropdown-menu\b/, 'max-height');
    assert.deepStrictEqual(strays.map(s => s.selector), [],
      'the dropdown is capped outside the 992px block, which hits the phone menu too');
  });
}

/* ===================================================================== */
section('AND THE MARKUP THIS ALL DEPENDS ON STILL LOOKS LIKE THAT');

test('buildNavMenu still gives dropdown entries BOTH classes', () => {
  /* Every rule above is written against `dropdown-item nav-link`. If
   * buildNavMenu stopped emitting nav-link on them, the colour fix and the
   * margin fix would both stop applying and nothing here would notice —
   * so the assumption is read back out of the file that makes it true. */
  const nav = fs.readFileSync(path.join(__dirname, 'utils', 'buildNavMenu.js'), 'utf8');

  assert.ok(/class="dropdown-item nav-link/.test(nav),
    'dropdown entries no longer carry both classes — the dropdown CSS in '
    + 'every theme is written against that pair');
});

test('and MAX_SERVICES is still the number this was sized for', () => {
  /* 20 is where the 926px measurement came from. If it goes up, the cap
   * still holds — it is viewport-relative — but the scroll gets longer and
   * the two-column option in CLAUDE.md becomes worth revisiting. */
  const { MAX_SERVICES } = require('./utils/suggestServices');

  assert.strictEqual(MAX_SERVICES, 20,
    `MAX_SERVICES is ${MAX_SERVICES}, not the 20 the dropdown was measured at`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
