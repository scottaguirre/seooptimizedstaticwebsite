// test-wordmark-logo.js
//
// The wordmark logo: a logo drawn from the business name for customers who
// have no logo file.
//
// WHY THIS FILE IS MOSTLY ABOUT COLOUR AND CLIPPING
//
// Nothing in this feature throws. Every way it can be wrong produces a PNG,
// a successful build and a finished site:
//
//   a theme missing from THEME_INK
//        -> the fallback fires, and on four of the seven designs that means
//           dark letters on a dark header: an invisible logo
//   ink and backdrop both light, or both dark
//        -> same outcome, reached by a typo instead of an omission
//   the baseline computed from the top of the block instead of the baseline
//        -> the first line is clipped off the top edge. This HAPPENED; the
//           contact sheet is the only reason it was caught, and the pixel
//           test below is what stops it coming back
//   a logo step gate that still demands a file
//        -> the customer can select "make one from my name" and then cannot
//           leave the step, or leaves it and is bounced back on submit
//
// None of that shows up in a log. It shows up on a site somebody paid for.
//
//   node test-wordmark-logo.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sharp = require('sharp');

const {
  THEME_INK, STRUCTURE_INK, INK_FALLBACK, MAX_NAME_CHARS, SCALE,
  inkFor, paletteFor, loadFont, sanitizeName, initialsFor,
  measure, lineCandidates, fitSize, planLines,
  wordmarkSvg, faviconSvg,
} = require('./utils/wordmarkLogo');

const { LOGO_SIZES, logoSize } = require('./utils/logoSizes');
const { MARKS, FOR_TRADE, markKeyFor } = require('./utils/localOptions/tradeMarks');
const CM = require('./utils/contentModel');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}
async function atest(name, fn) {
  try { await fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}
function section(name) { console.log(`\n${name}\n`); }

const WIZARD = fs.readFileSync(
  path.join(__dirname, 'public', 'js', 'generateDinamycForm.js'), 'utf8');

/** The design keys the wizard actually offers, read from its THEMES list. */
function offeredKeys() {
  const at = WIZARD.indexOf('const THEMES = [');
  assert.notStrictEqual(at, -1, 'the wizard THEMES list has been renamed or removed');
  const list = WIZARD.slice(at, WIZARD.indexOf('];', at));
  return [...list.matchAll(/key:\s*'([^']+)'/g)].map(m => m[1]);
}

const OFFERED = offeredKeys();

/* --------------------------------------------------------------------- */
/* WCAG relative luminance and contrast, so "is this readable" is a number
 * rather than an opinion. 4.5:1 is the AA threshold for body text; a logo is
 * large text, whose threshold is 3:1, and every pair here should clear the
 * stricter one comfortably. */
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const chan = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* ===================================================================== */
section('Theme coverage — the trap this feature shares with HERO_LAYOUT');

test('every design the wizard offers has a colour entry', () => {
  const missing = OFFERED.filter(k => !THEME_INK[k]);
  assert.deepStrictEqual(missing, [],
    `these designs would fall back to ${INK_FALLBACK.ink}: ${missing.join(', ')}`);
});

test('THEME_INK carries no design the wizard does not offer', () => {
  const extra = Object.keys(THEME_INK).filter(k => !OFFERED.includes(k));
  assert.deepStrictEqual(extra, [], `stale entries: ${extra.join(', ')}`);
});

test('every entry declares all four fields', () => {
  Object.entries(THEME_INK).forEach(([key, v]) => {
    assert.match(v.ink, /^#[0-9a-f]{6}$/, `${key}.ink`);
    assert.match(v.tile, /^#[0-9a-f]{6}$/, `${key}.tile`);
    assert.match(v.backdrop, /^#[0-9a-f]{6}$/, `${key}.backdrop`);
    assert.strictEqual(typeof v.halo, 'boolean', `${key}.halo`);
  });
});

test('ink is readable on the solid header it will sit on', () => {
  Object.entries(THEME_INK).forEach(([key, v]) => {
    if (v.halo) return;  // covered by the two assertions below
    const ratio = contrast(v.ink, v.backdrop);
    assert.ok(ratio >= 4.5,
      `${key}: ${v.ink} on ${v.backdrop} is only ${ratio.toFixed(2)}:1`);
  });
});

test('a theme that cannot clear 4.5:1 is required to carry a halo', () => {
  // style7's header is transparent over a photograph, so its backdrop here
  // is a STAND-IN for an average photo and the real one could be anything.
  // White on that stand-in measures 3.38:1 — enough for large text, not
  // enough for a bright sky. The halo is what carries it, so the rule is not
  // "every pair clears 4.5" but "anything that does not, compensates".
  Object.entries(THEME_INK).forEach(([key, v]) => {
    const ratio = contrast(v.ink, v.backdrop);
    if (ratio < 4.5) {
      assert.strictEqual(v.halo, true,
        `${key} is only ${ratio.toFixed(2)}:1 and draws no halo`);
    }
  });
});

test('even with a halo, the ink clears the large-text threshold', () => {
  Object.entries(THEME_INK).forEach(([key, v]) => {
    const ratio = contrast(v.ink, v.backdrop);
    assert.ok(ratio >= 3,
      `${key}: ${v.ink} on ${v.backdrop} is only ${ratio.toFixed(2)}:1`);
  });
});

test('white favicon letters are readable on every tile', () => {
  Object.entries(THEME_INK).forEach(([key, v]) => {
    const ratio = contrast('#ffffff', v.tile);
    assert.ok(ratio >= 4.5,
      `${key}: white on ${v.tile} is only ${ratio.toFixed(2)}:1`);
  });
});

test('the fallback is DARK ink, which is the safe way to be wrong', () => {
  // An unknown theme is a theme nobody has looked at. A new design is far
  // more likely to have a light header than a near-black one, and dark ink
  // on dark is faintly visible where white on white is nothing at all.
  assert.ok(luminance(INK_FALLBACK.ink) < 0.2,
    `the fallback ink ${INK_FALLBACK.ink} is light`);
});

test('an unrecognised theme takes the fallback rather than throwing', () => {
  assert.deepStrictEqual(inkFor('style99'), INK_FALLBACK);
  assert.deepStrictEqual(inkFor(''), INK_FALLBACK);
  assert.deepStrictEqual(inkFor(undefined), INK_FALLBACK);
  assert.deepStrictEqual(inkFor(null), INK_FALLBACK);
});

test('a known theme is NOT the fallback', () => {
  // Without this, inkFor() could return INK_FALLBACK unconditionally and
  // every assertion above would still pass.
  assert.strictEqual(inkFor('style').ink, '#ffffff');
  assert.strictEqual(inkFor('style2').ink, '#111111');
  assert.notDeepStrictEqual(inkFor('style'), INK_FALLBACK);
});

/* ===================================================================== */
section('Local Website Options — the second table, and the same trap');

const { structureKeys, DEFAULT_STRUCTURE } = require('./utils/localOptions/render/structures');
const { buildOptionsFor } = require('./utils/localOptions/designs');

test('every structure the renderer offers has a colour entry', () => {
  const missing = structureKeys().filter(k => !STRUCTURE_INK[k]);
  assert.deepStrictEqual(missing, [],
    `these structures would fall back to ${INK_FALLBACK.ink}: ${missing.join(', ')}`);
});

test('STRUCTURE_INK carries no structure the renderer does not have', () => {
  const extra = Object.keys(STRUCTURE_INK).filter(k => !structureKeys().includes(k));
  assert.deepStrictEqual(extra, [], `stale entries: ${extra.join(', ')}`);
});

test('ink is readable on each structure header', () => {
  Object.entries(STRUCTURE_INK).forEach(([key, v]) => {
    const ratio = contrast(v.ink, v.backdrop);
    assert.ok(ratio >= 4.5,
      `${key}: ${v.ink} on ${v.backdrop} is only ${ratio.toFixed(2)}:1`);
    assert.ok(contrast('#ffffff', v.tile) >= 4.5, `${key}: white on ${v.tile}`);
  });
});

test('style8 ink is still the colour its nav links are drawn in', () => {
  /* THE DRIFT CHECK A REPALETTE NEEDS, and the one the contrast tests above
   * cannot do.
   *
   * style8's wordmark sits on a white header beside the nav links, so it has
   * to be the SAME dark, not merely A dark. Every assertion above measures
   * ink against the backdrop, and #0f1733, #0a1f52 and plain black all pass
   * that — so when the stylesheet was repaletted from purple to blue the
   * stale value stayed green. Verified by mutation: reverting this entry to
   * the pre-repalette #0f1733 failed nothing at all.
   *
   * --navy is what #headerColor's links use (section 2 of the stylesheet),
   * so it is read back out of the file rather than trusted to a comment.
   * Change the palette, this fails, and whoever changed it is told that a
   * colour in another file depends on what they just did. */
  const css = fs.readFileSync(
    path.join(__dirname, 'src', 'css', 'themes', 'style8.css'), 'utf8');

  const navy = /--navy:\s*(#[0-9a-f]{6})\s*;/i.exec(css);
  assert.ok(navy, '--navy is gone from style8.css — THEME_INK.style8 must be revisited');

  assert.strictEqual(THEME_INK.style8.ink, navy[1].toLowerCase(),
    `the wordmark is drawn ${THEME_INK.style8.ink} but the nav links beside it `
    + `are ${navy[1]} — one of the two was repaletted and the other was not`);

  const brand = /--brand:\s*(#[0-9a-f]{6})\s*;/i.exec(css);
  assert.ok(brand, '--brand is gone from style8.css');
  assert.strictEqual(THEME_INK.style8.tile, brand[1].toLowerCase(),
    'the favicon tile is meant to be the brand colour');
});

test('style9 tile is still the brand colour its header is painted in', () => {
  /* THE SAME DRIFT CHECK AS style8's, POINTED AT WHAT style9 ACTUALLY
   * DEPENDS ON.
   *
   * style8's wordmark sits on a WHITE header, so its ink has to equal
   * --navy, the colour of the nav links beside it. style9's header is a
   * solid --brand bar and its wordmark is plain white, so there is no ink
   * to tie down — but the favicon TILE is that blue, and a repalette of
   * style9.css would leave it stale in exactly the way style8's ink went
   * stale when the purple became blue.
   *
   * Read back out of the stylesheet rather than trusted to a comment. */
  const css = fs.readFileSync(
    path.join(__dirname, 'src', 'css', 'themes', 'style9.css'), 'utf8');

  const brand = /--brand:\s*(#[0-9a-fA-F]{6})\s*;/.exec(css);
  assert.ok(brand, '--brand is gone from style9.css — THEME_INK.style9 must be revisited');

  assert.strictEqual(THEME_INK.style9.tile, brand[1].toLowerCase(),
    `the favicon tile is ${THEME_INK.style9.tile} but style9's --brand is `
    + `${brand[1]} — one was repaletted and the other was not`);

  assert.strictEqual(THEME_INK.style9.backdrop, brand[1].toLowerCase(),
    'the backdrop is what the PREVIEW paints behind the letters; it has to be '
    + "the header's own colour or the preview lies about how the logo will look");
});

test('each logo is drawn on the surface it lands on, and the ink suits it', () => {
  /* IT IS THE SURFACE UNDER THE LETTERS, NOT THE SECTION AROUND IT.
   *
   * Anvil's rail is near-black and this table first recorded that, giving
   * the wordmark near-white ink — which shipped as pale letters on the white
   * plate the logo is actually wrapped in. One element too far out.
   *
   * Ledger and Beacon put the header on a white card; Anvil puts the logo on
   * a white plate over a dark rail. Different reasons, same answer. */
  /* NOT ALL FOUR DRAW ON WHITE ANY MORE, AND THE RULE WAS NEVER "WHITE".
   * Quarry has no plate and its bar is --qy-raise, #f6f5f1, so this table
   * records that — asserting #ffffff for it would have been the same mistake
   * Anvil's row made, one element out, and quieter: near-white letters on a
   * white card are obviously wrong, while ink mixed for white sitting on
   * #f6f5f1 is merely slightly off.
   *
   * SO THE TEST ASSERTS WHAT THE RULE ACTUALLY IS — a LIGHT surface, with
   * ink dark enough for it — and keeps the three white ones named, so a
   * fifth structure has to declare its own rather than inherit one. */
  const WHITE_BACKED = ['ledger', 'beacon', 'anvil'];

  Object.entries(STRUCTURE_INK).forEach(([key, v]) => {
    if (WHITE_BACKED.includes(key)) {
      assert.strictEqual(v.backdrop, '#ffffff', `${key} is not drawing on white`);
    }

    assert.ok(luminance(v.backdrop) > 0.8,
      `${key} draws on ${v.backdrop}, which is not a light surface`);
    assert.ok(luminance(v.ink) < 0.2,
      `${key} ink ${v.ink} is too light for ${v.backdrop}`);
  });
});

test('and the plate Anvil depends on is still in the stylesheet', () => {
  /* THE DRIFT CHECK THAT WOULD HAVE CAUGHT MY MISTAKE.
   *
   * Anvil's ink is dark ONLY because .anvil-brand__plate paints white behind
   * the logo. Remove that rule and the wordmark becomes near-black letters
   * on a near-black rail — invisible, silently, with nothing failing.
   *
   * So the assumption is read back out of the stylesheet rather than trusted
   * to a comment. theme.js changes, this fails, and whoever changed it is
   * told that a colour somewhere else depends on what they just did. */
  const theme = fs.readFileSync(
    path.join(__dirname, 'utils', 'localOptions', 'render', 'theme.js'), 'utf8');

  const at = theme.indexOf('.anvil-brand__plate{');
  assert.notStrictEqual(at, -1,
    'the white plate behind Anvil\'s logo is gone — STRUCTURE_INK.anvil must be revisited');

  const rule = theme.slice(at, theme.indexOf('}', at));
  assert.match(rule, /background:#fff\b/,
    'the plate is no longer white — STRUCTURE_INK.anvil must be revisited');
});

test('a structure wins over a styleKey, and an empty one does not', () => {
  // The other three modes send no structure at all; reading '' as a choice
  // would colour every one of them from the fallback.
  assert.strictEqual(paletteFor({ structure: 'anvil', styleKey: 'style2' }).ink,
    STRUCTURE_INK.anvil.ink);
  assert.strictEqual(paletteFor({ structure: '', styleKey: 'style2' }).ink,
    THEME_INK.style2.ink);
  assert.strictEqual(paletteFor({ styleKey: 'style3' }).ink, THEME_INK.style3.ink);
  assert.deepStrictEqual(paletteFor({ structure: 'nonesuch' }), INK_FALLBACK);
});

test('"Choose for me" resolves to the same structure the build uses', () => {
  // Both sides go through designs.js rather than each having an opinion.
  assert.strictEqual(buildOptionsFor('').structure, DEFAULT_STRUCTURE);
  assert.strictEqual(buildOptionsFor(undefined).structure, DEFAULT_STRUCTURE);
  assert.ok(STRUCTURE_INK[buildOptionsFor('').structure],
    'the default structure has no colour entry');
});

/* ===================================================================== */
section('Local Website Options — its own generator draws it too');

/* REQUIRED, NOT READ AS SOURCE, AND THAT IS CHECKED RATHER THAN ASSUMED.
 *
 * test-local-options-wiring.js explains at length why no suite here requires
 * runGeneration: utils/openaiClient.js builds a client at module load, so it
 * throws "Missing credentials" on any machine without OPENAI_API_KEY and a
 * test that needs a live key is a test that gets skipped.
 *
 * runLocalOptions does NOT pull that tree in at load — verified by running
 * this whole file with the variable unset — so the two functions below can be
 * called for real instead of having their source inspected. If that ever
 * changes, this line is where it will be noticed, loudly, on the next deploy.
 */
const LO = require('./utils/runLocalOptions');

test('no upload and no wordmark is still no logo', () => {
  assert.strictEqual(LO.logoPathFor([], {}), '');
  assert.strictEqual(LO.logoPathFor([]), '');
});

test('no upload but a wordmark names a PNG', () => {
  /* .png rather than the uploaded file's extension: there is no uploaded
   * file, so there is nothing to preserve and nothing to guess at. */
  assert.strictEqual(LO.logoPathFor([], { wordmark: true }), 'assets/logo.png');
});

test('an uploaded file still wins over the option', () => {
  const files = [{ fieldname: 'global[logo]', originalname: 'acme.png', mimetype: 'image/png' }];
  assert.strictEqual(LO.logoPathFor(files, { wordmark: true }), 'assets/logo.png');
  assert.strictEqual(LO.logoPathFor(files, {}), 'assets/logo.png');
});

/* ===================================================================== */
section('Local Website Options — and the two calls actually being wired up');

/* READ AS SOURCE, for the reason test-local-options-wiring.js gives: calling
 * runLocalOptions() for real needs a model key, a database and three minutes.
 * The two functions above ARE called for real; what cannot be is the twenty
 * lines between them, and those are exactly where a mutant survived:
 *
 *   - the structure hard-wired to 'ledger', so an Anvil site gets dark ink
 *     on its near-black rail — an invisible logo, and no test noticed
 *   - the third argument dropped from placeLogo(), so the path is promised
 *     in the <img src> and the bytes are never written: a broken image on
 *     every page of a site somebody paid for
 *
 * Both are one keystroke and neither throws. */
const RUN_LOCAL = fs.readFileSync(path.join(__dirname, 'utils', 'runLocalOptions.js'), 'utf8');

test('the colour comes from the design, not from a hard-wired structure', () => {
  /* THE MODE IS PART OF THE CALL NOW — 17 November. A design belonging to
   * another mode must resolve to the default rather than colour this logo
   * for a layout the build will not use. See designs.js: filtering a
   * dropdown is not validating a field.
   *
   * AND IT IS A KEY RATHER THAN THE siteMode, later the same day. One door
   * runs the `localoptions` builder and offers the Cloudflare layouts, so
   * the siteMode is not the list a picked design lives in — passing it here
   * coloured the logo for Ledger while the pages were built as Quarry.
   * designsKeyFor() is the one place that answers it. */
  assert.match(RUN_LOCAL, /structure: buildOptionsFor\(global\.design, designsKey\)\.structure/,
    'the structure is no longer resolved from the chosen design and its key');
});

test('BOTH logo calls are handed the same options object', () => {
  /* The comment on placeLogo() warns that two call sites deriving one
   * filename is how the <img src> and the file on disk come to disagree.
   * They now also both need to know whether there is a wordmark to draw,
   * which is a second thing to get out of step. */
  assert.match(RUN_LOCAL, /logoPathFor\(ctx\.files, logoOptions\)/,
    'the path is derived without the options');
  assert.match(RUN_LOCAL, /placeLogo\(ctx\.files, assetsDir, logoOptions\)/,
    'the bytes are written without the options — the path would be promised and no file drawn');

  const declared = RUN_LOCAL.match(/const logoOptions = \{/g) || [];
  assert.strictEqual(declared.length, 1,
    'there is more than one logoOptions, so the two calls can disagree');
});

test('and the option is read the same two ways every other global is', () => {
  // The wizard posts a nested body; a replayed job payload posts a flat one.
  assert.match(RUN_LOCAL, /global\.logoSource \?\? ctx\.body\?\.\['global\[logoSource\]'\]/);
});

/* ===================================================================== */
section('Box sizes');

test('each shape has its documented box', () => {
  assert.deepStrictEqual(logoSize('square'), { width: 120, height: 120 });
  assert.deepStrictEqual(logoSize('rect'), { width: 150, height: 100 });
  assert.deepStrictEqual(logoSize('wide'), { width: 250, height: 100 });
});

test('an unknown or absent shape is rectangular, as it always has been', () => {
  assert.deepStrictEqual(logoSize('tall'), LOGO_SIZES.rect);
  assert.deepStrictEqual(logoSize(''), LOGO_SIZES.rect);
  assert.deepStrictEqual(logoSize(undefined), LOGO_SIZES.rect);
});

test('shape matching ignores case and surrounding space', () => {
  assert.deepStrictEqual(logoSize('  WIDE '), LOGO_SIZES.wide);
});

/* ===================================================================== */
section('The name');

test('whitespace is collapsed and trimmed', () => {
  assert.strictEqual(sanitizeName('  Round   Rock  Plumbing '), 'Round Rock Plumbing');
  assert.strictEqual(sanitizeName('A\tB\nC'), 'A B C');
});

test('accented latin survives, because the subset covers it', () => {
  assert.strictEqual(sanitizeName('Peña Café'), 'Peña Café');
});

test('characters the font cannot draw are dropped, not boxed', () => {
  // .notdef renders as a hollow rectangle. "Plumbing □□" is worse than
  // "Plumbing".
  assert.strictEqual(sanitizeName('Plumbing 水道'), 'Plumbing');
  assert.strictEqual(sanitizeName('Acme 🙂 Co'), 'Acme Co');
});

test('an absurd name is cut to the cap', () => {
  const long = 'x'.repeat(MAX_NAME_CHARS + 40);
  assert.strictEqual(sanitizeName(long).length, MAX_NAME_CHARS);
});

test('nothing in gives nothing out', () => {
  ['', '   ', null, undefined].forEach(v => {
    assert.strictEqual(sanitizeName(v), '');
  });
});

/* ===================================================================== */
section('Favicon initials');

test('two significant words give two letters', () => {
  assert.strictEqual(initialsFor('Round Rock Plumbing'), 'RR');
  assert.strictEqual(initialsFor('acme plumbing'), 'AP');
});

test('the legal suffix is skipped', () => {
  assert.strictEqual(initialsFor('Acme Plumbing LLC'), 'AP');
  // Only "Acme" is significant here, so this falls through to the
  // one-word rule and takes its first two letters rather than its first one.
  assert.strictEqual(initialsFor('The Acme Company'), 'AC');
  assert.strictEqual(initialsFor('gomanzo services'), 'GO');
});

test('one word gives its first two letters', () => {
  assert.strictEqual(initialsFor('Gomanzo'), 'GO');
});

test('a name made entirely of filler still gets a favicon', () => {
  // "The Company" has no significant word at all. Returning '' here would
  // throw out of faviconSvg and fail a build over a legal name.
  assert.strictEqual(initialsFor('The Company'), 'TH');
});

test('no name, no initials', () => {
  assert.strictEqual(initialsFor(''), '');
  assert.strictEqual(initialsFor('  '), '');
});

/* ===================================================================== */
section('Line breaking');

test('a single word offers exactly one candidate', () => {
  assert.deepStrictEqual(lineCandidates(['Gomanzo'], 3), [['Gomanzo']]);
});

test('two lines are offered at every break point', () => {
  const got = lineCandidates(['A', 'B', 'C'], 2);
  assert.deepStrictEqual(got, [
    ['A B C'],
    ['A', 'B C'],
    ['A B', 'C'],
  ]);
});

test('three lines are offered only when the box allows them', () => {
  const two = lineCandidates(['A', 'B', 'C'], 2);
  const three = lineCandidates(['A', 'B', 'C'], 3);
  assert.ok(three.length > two.length, 'maxLines 3 added nothing');
  assert.ok(three.some(c => c.length === 3), 'no three-line candidate');
  assert.ok(!two.some(c => c.length === 3), 'maxLines 2 offered three lines');
});

test('every candidate preserves every word, in order', () => {
  const words = ['Round', 'Rock', 'Plumbing', 'Company'];
  lineCandidates(words, 3).forEach(c => {
    assert.strictEqual(c.join(' '), words.join(' '));
  });
});

/* ===================================================================== */
section('Fitting');

const font = loadFont();

test('a wider string fits at a smaller size', () => {
  const short = fitSize(font, ['Hi'], 400, 200);
  const long = fitSize(font, ['Round Rock Plumbing Company'], 400, 200);
  assert.ok(long < short, `${long} is not smaller than ${short}`);
});

test('more lines in the same height fit smaller', () => {
  const one = fitSize(font, ['Acme'], 4000, 200);
  const two = fitSize(font, ['Acme', 'Acme'], 4000, 200);
  assert.ok(two < one, 'two lines fitted no smaller than one');
});

test('the height bound is the one that binds when width is vast', () => {
  // 4000px of width cannot be the constraint for "Hi" in a 200px box, so the
  // answer must come from the height. If fitSize ever stops taking the min,
  // this is the assertion that notices.
  const got = fitSize(font, ['Hi'], 4000, 200);
  assert.ok(got <= 200, `${got} exceeds the box height`);
});

test('a long name is set LARGER by wrapping, which is why wrapping exists', () => {
  const box = { width: 250 * SCALE, height: 100 * SCALE };
  const plan = planLines(font, 'Round Rock Plumbing Company', box);
  const flat = fitSize(font, ['Round Rock Plumbing Company'],
    box.width * 0.9, box.height * 0.84);

  assert.ok(plan.lines.length > 1, 'the long name was left on one line');
  assert.ok(plan.size > flat, `wrapped ${plan.size} is no bigger than flat ${flat}`);
});

test('a short name stays on one line', () => {
  const plan = planLines(font, 'Gomanzo', { width: 500, height: 200 });
  assert.strictEqual(plan.lines.length, 1);
});

test('the square box USES three lines and the wide box never may', () => {
  // "<= 3" was the original assertion here and it passed with maxLines
  // hard-wired to 2, which is the whole behaviour this test exists for.
  const name = 'Round Rock Plumbing Company';
  const square = planLines(font, name, { width: 240, height: 240 });
  const wide = planLines(font, name, { width: 500, height: 200 });

  assert.strictEqual(square.lines.length, 3,
    `the square box used ${square.lines.length} lines`);
  assert.ok(wide.lines.length <= 2, `wide used ${wide.lines.length} lines`);
});

test('a string measures the sum of its advances', () => {
  // There is deliberately NO KERNING — see the comment on measure(). This
  // font carries no kern table, and opentype.js does not surface Inter's
  // GPOS pairs, so every adjustment came back 0 and the call was removed.
  // Asserting the plain sum is what keeps that honest: if kerning is ever
  // put back, this fails and the comment has to be revisited with it.
  const together = measure(font, 'AV').width;
  const apart = measure(font, 'A').width + measure(font, 'V').width;
  assert.ok(Math.abs(together - apart) < 1e-9,
    `AV measured ${together}, A+V measured ${apart}`);
});

test('the font really has nothing to kern with', () => {
  assert.ok(!font.tables.kern,
    'this font now has a kern table — measure() should use it');
});

/* ===================================================================== */
section('The SVG');

test('the canvas is twice the published box', () => {
  // The numbers are written out rather than computed from SCALE. Deriving
  // them from the same constant the code uses made this assertion agree with
  // ANY value of SCALE, so dropping retina rendering altogether passed.
  const svg = wordmarkSvg({ businessName: 'Acme', logoType: 'wide', styleKey: 'style' });
  assert.ok(svg.includes('width="500"'), svg.slice(0, 120));
  assert.ok(svg.includes('height="200"'), svg.slice(0, 120));

  const square = wordmarkSvg({ businessName: 'Acme', logoType: 'square', styleKey: 'style' });
  assert.ok(square.includes('width="240"'), square.slice(0, 120));
  assert.strictEqual(SCALE, 2, 'SCALE changed; the sizes above have to change with it');
});

test('the letters are the theme ink', () => {
  const navy = wordmarkSvg({ businessName: 'Acme', logoType: 'wide', styleKey: 'style' });
  const grey = wordmarkSvg({ businessName: 'Acme', logoType: 'wide', styleKey: 'style2' });
  assert.ok(navy.includes('fill="#ffffff"'), 'style should be white');
  assert.ok(grey.includes('fill="#111111"'), 'style2 should be dark');
  assert.ok(!grey.includes('fill="#ffffff"'), 'style2 drew white letters');
});

test('the site logo has no backdrop; the preview does', () => {
  const plain = wordmarkSvg({ businessName: 'Acme', logoType: 'wide', styleKey: 'style' });
  const preview = wordmarkSvg({ businessName: 'Acme', logoType: 'wide', styleKey: 'style', withBackdrop: true });

  assert.ok(!plain.includes('<rect'), 'the shipped logo is not transparent');
  assert.ok(preview.includes('<rect'), 'the preview has no backdrop');
  assert.ok(preview.includes('fill="#082d5b"'), 'the backdrop is not the header colour');
});

test('only the photo theme draws a halo', () => {
  const photo = wordmarkSvg({ businessName: 'Acme', logoType: 'wide', styleKey: 'style7' });
  const solid = wordmarkSvg({ businessName: 'Acme', logoType: 'wide', styleKey: 'style' });
  assert.ok(photo.includes('opacity="0.38"'), 'style7 has no halo');
  assert.ok(!solid.includes('opacity='), 'style drew a halo it does not need');
});

test('the name never reaches the markup', () => {
  // Glyphs become path coordinates before the string exists, so there is no
  // text node for a quote or a bracket to escape from. This is the reason
  // this module escapes nothing anywhere.
  const svg = wordmarkSvg({
    businessName: 'A" <script>x</script> & B',
    logoType: 'wide',
    styleKey: 'style',
  });
  assert.ok(!svg.includes('<text'), 'a text node was emitted');
  assert.ok(!svg.includes('script'), 'the name leaked into the markup');
  assert.ok(!svg.includes('&'), 'an ampersand reached the output');
});

test('no name is a clear refusal, not a blank picture', () => {
  assert.throws(
    () => wordmarkSvg({ businessName: '  ', logoType: 'wide', styleKey: 'style' }),
    /business name/i
  );
  assert.throws(
    () => faviconSvg({ businessName: '', styleKey: 'style' }),
    /business name/i
  );
});

test('the favicon is initials on a tile, not the wordmark shrunk', () => {
  const svg = faviconSvg({ businessName: 'Round Rock Plumbing', styleKey: 'style2' });
  assert.ok(svg.includes('fill="#333333"'), 'no tile in the theme colour');
  assert.ok(svg.includes('fill="#ffffff"'), 'the letters are not white');
  assert.ok(svg.includes('rx='), 'the tile has no rounded corners');

  // Two letters, not nineteen: the path data for "RR" is far shorter than
  // for the whole name.
  const full = wordmarkSvg({ businessName: 'Round Rock Plumbing', logoType: 'square', styleKey: 'style2' });
  assert.ok(svg.length < full.length / 2, 'the favicon drew the whole name');
});

/* ===================================================================== */
section('The trade mark beside the name');

test('A TRADE WITH A MARK GETS IT, AND A TRADE WITHOUT GETS THE OLD LOGO', () => {
  /* Edwin, 18 November, having had twenty-three marks drawn: *"wire the
   * logo plumbing"*.
   *
   * THE FALLBACK IS THE WHOLE SAFETY OF THIS CHANGE. Every wordmark drawn
   * before today was drawn with no trade at all, and three different kinds
   * of caller still pass none: the GitHub builder for a business type with
   * no mark, a replayed job payload written before the field existed, and a
   * preview URL without the parameter. All three must produce the logo this
   * function has always produced — not a smaller one with a gap where a
   * mark would have gone. */
  const base = { businessName: 'Austin Drain Pros', logoType: 'wide', structure: 'orchard' };

  const plain = wordmarkSvg(base);
  const marked = wordmarkSvg({ ...base, trade: 'Plumbing' });

  assert.notStrictEqual(plain, marked, 'the trade changes nothing, so no mark is drawn');
  assert.ok(marked.length > plain.length, 'the marked logo is not bigger');

  /* AND AN UNKNOWN TRADE IS BYTE-FOR-BYTE THE OLD LOGO. Not "similar": a
   * single different attribute here would mean the no-mark path had
   * silently moved, and every site built before today would redraw
   * differently on its next rebuild. */
  assert.strictEqual(wordmarkSvg({ ...base, trade: 'Llama Grooming' }), plain,
    'an unknown trade does not fall back to exactly the old drawing');
  assert.strictEqual(wordmarkSvg({ ...base, trade: '' }), plain);
  assert.strictEqual(wordmarkSvg({ ...base, trade: '   ' }), plain);
});

test('AND THE MARK IS THE SAME COLOUR AS THE LETTERS, NECESSARILY', () => {
  /* The mark sits INSIDE the group that carries the ink, so the two cannot
   * disagree — which is the whole reason these are paths and not PNG files.
   * A `fill` of its own anywhere in the mark would be a second colour that
   * no table chose, on a header whose colour this file works hard to get
   * right.
   *
   * ASSERTED ON THE RENDERED STRING rather than on the mark source, because
   * the fill could be introduced by either of them. */
  const svg = wordmarkSvg({
    businessName: 'Austin Drain Pros', logoType: 'wide',
    structure: 'orchard', trade: 'Plumbing',
  });

  const fills = [...svg.matchAll(/fill="([^"]+)"/g)].map(m => m[1]);

  assert.deepStrictEqual([...new Set(fills)], [STRUCTURE_INK.orchard.ink],
    'the logo carries a colour that is not the structure ink');

  /* AND THE MARK IS INSIDE THAT GROUP, not beside it. */
  const body = svg.slice(svg.indexOf(`<g fill="${STRUCTURE_INK.orchard.ink}">`));

  assert.ok(body.includes('rotate(-42)'), 'the wrench is not inside the inked group');
});

test('AND THE HALO COPIES THE MARK TOO, OR IT VANISHES OVER A BRIGHT SKY', () => {
  /* style7's header is a photograph and the halo is the only thing keeping
   * white ink off a cloud. A mark left out of it would be the one piece of
   * the logo that disappears — and only on one theme, only over some
   * photographs, which is the kind of fault nobody can reproduce. */
  const svg = wordmarkSvg({
    businessName: 'Austin Drain Pros', logoType: 'wide',
    styleKey: 'style7', trade: 'Plumbing',
  });

  const halo = svg.slice(svg.indexOf('<g fill="#000000"'), svg.indexOf('</g>', svg.indexOf('<g fill="#000000"')));

  assert.ok(halo.includes('rotate(-42)'), 'the halo does not carry the mark');
});

test('THE SHAPE DECIDES THE ARRANGEMENT: beside on wide, above on the others', () => {
  /* Edwin chose this: a 250x100 box has room for a mark and a line of type
   * side by side; a 120x120 box does not, and a name squeezed into what is
   * left wraps a two-word business onto three lines. */
  const of = (shape) => {
    const svg = wordmarkSvg({
      businessName: 'Austin Drain Pros', logoType: shape,
      structure: 'orchard', trade: 'Plumbing',
    });
    const mark = /translate\(([\d.]+) ([\d.]+)\) scale/.exec(svg);
    const text = /<g transform="translate\(([\d.]+) ([\d.]+)\)">/.exec(svg);

    assert.ok(mark, `${shape}: no mark was placed`);
    assert.ok(text, `${shape}: the letters were not offset`);

    return {
      mark: { x: Number(mark[1]), y: Number(mark[2]) },
      text: { x: Number(text[1]), y: Number(text[2]) },
    };
  };

  const wide = of('wide');

  assert.ok(wide.text.x > wide.mark.x, 'on the wide box the letters are not to the right of the mark');
  assert.strictEqual(wide.text.y, 0, 'on the wide box the letters were pushed down as well');

  for (const shape of ['square', 'rect']) {
    const put = of(shape);

    assert.ok(put.text.y > put.mark.y, `on ${shape} the letters are not below the mark`);
    assert.strictEqual(put.text.x, 0, `on ${shape} the letters were pushed sideways as well`);
  }
});

test('AND THE NAME KEEPS MORE OF THE BOX THAN THE MARK DOES', () => {
  /* ⚠ THE MARK WAS 0.78 OF THE HEIGHT FIRST, which left the letters 279 of
   * 500 units on the wide box and set "Hill Country Roofing" on three lines
   * in small type beside a large wrench.
   *
   *     THE NAME IS THE LOGO. THE MARK IS THE ADJECTIVE.
   *
   * Pinned as a ratio rather than a pixel count so it survives SCALE and any
   * box size added later. */
  const { width } = logoSize('wide');
  const svg = wordmarkSvg({
    businessName: 'Hill Country Roofing', logoType: 'wide',
    structure: 'harbor', trade: 'Roofing',
  });

  /* ⚠ THE REGEX MUST NOT MATCH THE MARK'S OWN GROUP. Both are written
   * `<g transform="translate(x y)…`; only the letters' group ends there,
   * because the mark's carries a scale as well. Without the closing `)">`
   * this read the mark's x, measured 96% of the box for the letters and
   * passed while proving nothing. */
  const offset = Number(/<g transform="translate\(([\d.]+) ([\d.]+)\)">/.exec(svg)[1]);
  const forLetters = width * SCALE - offset;

  assert.ok(forLetters / (width * SCALE) > 0.55,
    `the letters get ${Math.round(100 * forLetters / (width * SCALE))}% of the wide box, which is less than the mark`);

  /* AND IT STILL SETS ON TWO LINES, which is what that share buys. */
  assert.strictEqual((svg.match(/<path transform="translate/g) || []).length, 2,
    'the name no longer sets on two lines in the wide box');
});

section('The favicon carries the mark too');

test('THE MARK WINS, AND INITIALS REMAIN THE FALLBACK', () => {
  /* Edwin, 18 November: *"fix the favicon"*, on being told the logo would
   * carry a wrench and the browser tab would carry "AD". Two different
   * marks for one business, eighteen pixels apart. */
  const base = { businessName: 'Austin Drain Pros', structure: 'orchard' };

  const initials = faviconSvg(base);
  const marked = faviconSvg({ ...base, trade: 'Plumbing' });

  assert.ok(marked.includes('rotate(-42)'), 'the favicon does not carry the trade mark');
  assert.ok(!marked.includes('<path transform="translate'), 'the favicon still draws initials as well');

  assert.strictEqual(faviconSvg({ ...base, trade: 'Llama Grooming' }), initials,
    'a trade with no mark does not fall back to initials');

  /* THE TILE IS THE BRAND COLOUR EITHER WAY. It is not the ink: a favicon is
   * a shape in browser chrome and has to read against a light tab and a dark
   * one, which is what the tile is for. */
  assert.ok(marked.includes(STRUCTURE_INK.orchard.tile), 'the marked favicon lost its tile');
  assert.ok(marked.includes('fill="#ffffff"'), 'the mark is not reversed out of the tile');
});

section('The marks themselves');

test('EVERY TRADE THE WIZARD OFFERS HAS A MARK', () => {
  /* ⚠ THIS WILL REPORT THE DAY A BUSINESS TYPE IS ADDED, which is the point
   * of it. A trade with no mark is not broken — it draws the wordmark alone,
   * exactly as before — but it is the only one of the twenty-five that looks
   * different, and nothing else would say so. */
  const src = fs.readFileSync(
    path.join(__dirname, 'public', 'js', 'generateDinamycForm.js'), 'utf8');

  const list = /var BUSINESS_TYPE_LABELS = \[([\s\S]*?)\];/.exec(src);

  assert.ok(list, 'the wizard no longer carries a list of business types');

  const labels = [...list[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);

  assert.ok(labels.length > 20, `only ${labels.length} business types were found`);

  const missing = labels.filter(l => !markKeyFor(l));

  assert.deepStrictEqual(missing, [],
    `these trades have no mark: ${missing.join(', ')}`);
});

test('AND EVERY MAPPED MARK EXISTS, AND EVERY DRAWN MARK RENDERS', () => {
  /* A FOR_TRADE row naming a mark that is not in MARKS resolves to '' and
   * draws nothing — the same outcome as a trade nobody mapped, reached by a
   * typo instead of an omission. */
  for (const [trade, key] of Object.entries(FOR_TRADE)) {
    assert.ok(MARKS[key], `${trade} is mapped to ${key}, which does not exist`);
  }

  /* AND NOTHING HERE IS EMPTY. A mark function that returns no paths is a
   * blank square in a logo, and the fallback cannot catch it because the
   * trade IS mapped. */
  for (const key of Object.keys(MARKS)) {
    const made = MARKS[key]();
    const count = (made.paths || []).length
      + (made.groups || []).reduce((n, g) => n + g.paths.length, 0);

    assert.ok(count > 0, `the ${key} mark draws nothing at all`);
  }
});

test('AND THE MARKS LIVE WHERE THE SERVER CAN SEE THEM', () => {
  /* ⚠ THEY WERE WRITTEN UNDER tools/, WHICH IS IN .rsync-exclude. That was
   * right while they were only being looked at; the moment wordmarkLogo.js
   * imported them it would have been a build that works on the Mac and
   * throws on the VPS — at require time, so every job, not just the ones
   * drawing a logo. */
  const excl = fs.readFileSync(path.join(__dirname, '.rsync-exclude'), 'utf8');

  assert.ok(/^tools\/$/m.test(excl), 'tools/ is no longer excluded, so this test is about nothing');

  const src = fs.readFileSync(path.join(__dirname, 'utils', 'wordmarkLogo.js'), 'utf8');
  const req = /require\('([^']*tradeMarks[^']*)'\)/.exec(src);

  assert.ok(req, 'wordmarkLogo.js no longer imports the marks');
  assert.ok(!req[1].includes('tools/'),
    `wordmarkLogo.js imports the marks from ${req[1]}, which is not deployed`);

  assert.ok(fs.existsSync(path.join(__dirname, 'utils', 'localOptions', 'tradeMarks.js')),
    'the deployed copy of the marks is gone');
});

section('The stored model');

test('logoSource survives createModel, which is a whitelist', () => {
  const drawn = CM.createModel({ businessName: 'Acme', logoSource: 'wordmark' });
  assert.strictEqual(drawn.global.logoSource, 'wordmark');
});

test('anything that is not a wordmark is an upload', () => {
  assert.strictEqual(CM.createModel({ logoSource: 'upload' }).global.logoSource, 'upload');
  assert.strictEqual(CM.createModel({}).global.logoSource, 'upload');
  assert.strictEqual(CM.createModel({ logoSource: 'WORDMARK' }).global.logoSource, 'upload');
});

/* ===================================================================== */
section('The wizard — all three gates');

/** The body of a named function in the wizard source. */
function wizardSlice(from, to) {
  const a = WIZARD.indexOf(from);
  assert.notStrictEqual(a, -1, `not found: ${from}`);
  const b = WIZARD.indexOf(to, a);
  assert.notStrictEqual(b, -1, `not found after ${from}: ${to}`);
  return WIZARD.slice(a, b);
}

test('the logo step lets a wordmark past without a file', () => {
  const slice = wizardSlice("onNext: () => {\n        // Nothing to validate", 'go(STEP.DESIGN)');
  assert.match(slice, /state\.logoSource === 'wordmark'/);
});

test('the locations step does not demand a file for a wordmark', () => {
  const slice = wizardSlice('ensure logo mirrored to backend', 'inject hidden inputs');
  assert.match(slice, /if \(state\.logoSource === 'wordmark'\)/,
    'the locations gate has no wordmark branch');
  assert.match(slice, /hiddenLogoInput\.files = new DataTransfer\(\)\.files/,
    'a stale file could still be posted alongside a wordmark');
});

test('the submit guard reads logoSource, not merely mentions it', () => {
  // The earlier version of this assertion checked that the string appeared
  // somewhere in the branch, and survived the guard being replaced with
  // `if (false)`. Extract the condition itself.
  const at = WIZARD.indexOf('form.addEventListener(\'submit\', (e) => {');
  assert.notStrictEqual(at, -1);
  const guard = WIZARD.slice(at, WIZARD.indexOf('{', WIZARD.indexOf('if (', at)));
  assert.match(guard, /if \(state\.logoSource !== 'wordmark' && !state\.logoFile\)/);
});

test('logoSource is a state-owned field, so no stale mirror can win', () => {
  const slice = wizardSlice('const STATE_OWNED_FIELDS = [', '];');
  assert.match(slice, /'global\[logoSource\]'/);
});

test('both hidden-field injection sites post logoSource', () => {
  const hits = [...WIZARD.matchAll(/name = 'global\[logoSource\]'/g)];
  assert.strictEqual(hits.length, 2,
    `expected the early and the submit-time injection, found ${hits.length}`);
});

test('the preview asks for the design, not the theme, in that mode', () => {
  const slice = wizardSlice('function wordmarkPreviewHtml()', 'function renderReviewStep');
  assert.match(slice, /isLocalOptions\(\)/,
    'the preview sends the same parameters in every mode');
  assert.match(slice, /design: snapshotValue\('design'\)/);
  assert.match(slice, /theme: state\.styleKey/,
    'the other three modes no longer send a theme');
});

test('startOver clears the choice', () => {
  const slice = wizardSlice('state.logoFile = null;', 'Clear visible file inputs');
  assert.match(slice, /state\.logoSource = 'upload'/);
  assert.match(slice, /state\.logoShapeTouched = false/);
});

test('the three shape radios are left exactly as they were', () => {
  /* They were briefly given flex-wrap, which split them across two rows on a
   * wide screen and made the step look broken. The row is the original one
   * again, and this is here so it stays that way. */
  assert.match(WIZARD, /<div class="d-flex gap-3 mb-3">/,
    'the shape row is no longer the plain three-across row');
  assert.ok(!/flex-wrap gap-3 mb-3/.test(WIZARD),
    'the shape row has been given flex-wrap again');
});

test('the wordmark option is BELOW the file box, not in front of it', () => {
  /* The first version put two large cards above the shape radios, so the
   * step opened by asking a question most customers do not have — they
   * arrived with a logo in hand. Position is the whole fix, so position is
   * what this asserts. */
  const shapes = WIZARD.indexOf('name="logoTypeStep"');
  const fileBox = WIZARD.indexOf('id="logoWideWrap"');
  const choice = WIZARD.indexOf('id="logoSourceWordmark"');

  assert.ok(shapes > -1 && fileBox > -1 && choice > -1, 'one of the three is gone');
  assert.ok(choice > shapes, 'the wordmark option is above the shape radios');
  assert.ok(choice > fileBox, 'the wordmark option is above the file inputs');
});

test('it is ONE radio, so choosing a file is what turns it off', () => {
  /* A radio cannot be clicked off, and there is no "upload" radio to click
   * instead — so without this the only way out of the option is a reload. */
  const radios = [...WIZARD.matchAll(/id="logoSourceWordmark"/g)];
  assert.strictEqual(radios.length, 1, `expected one radio, found ${radios.length}`);
  assert.ok(!/logoSourceUpload/.test(WIZARD),
    'the paired upload radio is back; this test is about the single one');

  const slice = wizardSlice('CHOOSING A FILE IS HOW YOU GO BACK', 'restore chosen file');
  assert.match(slice, /\[squareInput, rectInput, wideInput\]/,
    'not every shape input restores the upload branch');
  assert.match(slice, /applyLogoSource\('upload'\)/);
  assert.match(slice, /if \(!e\.target\.files\?\.\[0\]\) return;/,
    'clearing the file box would be read as choosing one');
});

test('NO line copies the logo file without checking there is one', () => {
  /* THE BUG THIS PINS, and it cost a false "Not Enough Credits" on the
   * review step of a customer with 13,100 credits.
   *
   * The three gates were taught about the wordmark. The line that runs AFTER
   * them was not:
   *
   *     const dt = new DataTransfer();
   *     dt.items.add(state.logoFile);     // null for a wordmark
   *
   * which throws TypeError. A listener that throws does not stop the ones
   * after it, so spinner.js ran over a form that had lost every hidden field
   * this handler had not reached — siteMode among them. The credit check
   * defaulted to 'lead', counted no service pages, priced the base fee, and
   * reported a money problem that did not exist.
   *
   * COUNTING RATHER THAN READING ONE PLACE. There were three sites and the
   * missed one was the third; a test naming the two that were fixed would
   * have passed. Every `items.add(state.logoFile)` in the file must sit
   * behind something that establishes there IS a file. */
  const adds = [...WIZARD.matchAll(/items\.add\(state\.logoFile\)/g)];
  assert.ok(adds.length > 0, 'the logo is no longer mirrored anywhere');

  adds.forEach(({ index }) => {
    // The 400 characters in front of it, which is enough to contain either
    // guard and not enough to reach the previous one.
    const before = WIZARD.slice(Math.max(0, index - 400), index);
    assert.ok(
      /if \(state\.logoFile\)/.test(before) || /state\.logoSource === 'wordmark'/.test(before),
      `an unguarded items.add(state.logoFile) at offset ${index}`
    );
  });
});

test('and the file box is NEVER hidden by the choice', () => {
  /* THE DEAD END THIS CLOSES. The option is a single radio, so it cannot be
   * clicked off, and picking a file is the only thing that turns it off. One
   * version hid the file inputs while the option was selected — which took
   * away the only way out of it. Tick it by mistake with no logo to hand and
   * the step could not be undone without reloading and losing the form.
   *
   * So the wrapper's visibility may depend on the SHAPE and on nothing else. */
  /* Bounded by the function's own closing brace, not by whatever text
   * happens to come next: an earlier end anchor ran on into the doc comment
   * of applyLogoSource, found the word "drawing" in a sentence about drawing
   * the name, and failed over prose. */
  const at = WIZARD.indexOf('function applyLogoTypeForStep(container, type) {');
  assert.ok(at > -1, 'applyLogoTypeForStep has been renamed or removed');
  const slice = WIZARD.slice(at, WIZARD.indexOf('\n    }', at));

  assert.match(slice, /wrap\.style\.display = shape === type \? '' : 'none'/,
    'the file box visibility depends on something other than the shape');
  assert.ok(!/logoSource|drawing/.test(slice),
    'applyLogoTypeForStep is consulting the logo source again');
});

test('and the radio is set from code, not only read', () => {
  const slice = wizardSlice('function applyLogoSource(value) {', 'Wide, because');
  assert.match(slice, /sourceRadio\.checked = drawing/,
    'turning the option off in code would leave the radio looking on');
});

/* ===================================================================== */
/* Pixels. Everything above could pass with the letters drawn off the edge. */

(async () => {
  section('Pixels — the clipping bug that shipped once already');

  /** Which rows and columns of the rendered PNG have any ink in them. */
  async function inkMap(svg) {
    const { data, info } = await sharp(Buffer.from(svg))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const rows = new Array(info.height).fill(false);
    const cols = new Array(info.width).fill(false);

    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const alpha = data[(y * info.width + x) * info.channels + 3];
        if (alpha > 8) { rows[y] = true; cols[x] = true; }
      }
    }
    return { rows, cols, info };
  }

  for (const shape of ['square', 'rect', 'wide']) {
    for (const name of ['Gomanzo', 'Round Rock Plumbing', 'CT Plumbing and Air Conditioning of Austin']) {
      await atest(`"${name}" in ${shape}: nothing touches an edge`, async () => {
        const svg = wordmarkSvg({ businessName: name, logoType: shape, styleKey: 'style' });
        const { rows, cols, info } = await inkMap(svg);

        assert.ok(rows.some(Boolean), 'nothing was drawn at all');

        assert.strictEqual(rows[0], false, 'ink on the top row — the name is clipped');
        assert.strictEqual(rows[info.height - 1], false, 'ink on the bottom row');
        assert.strictEqual(cols[0], false, 'ink on the left edge');
        assert.strictEqual(cols[info.width - 1], false, 'ink on the right edge');
      });
    }
  }

  /* ⚠ THE SAME LOOP AGAIN WITH A MARK, AND A MUTANT IS WHY. Fitting the
   * letters to the whole box instead of to what is left of it — one
   * argument, `box` for `textBox` — passed every structural assertion
   * above: the mark was placed, the offset was written, the colours were
   * right. The letters simply ran off the right-hand edge, which only
   * pixels can see.
   *
   *     A LAYOUT ASSERTED IN NUMBERS IS A LAYOUT NOBODY HAS LOOKED AT. */
  for (const shape of ['square', 'rect', 'wide']) {
    for (const [name, trade] of [
      ['Round Rock Plumbing', 'Plumbing'],
      ['CT Plumbing and Air Conditioning of Austin', 'Air Conditioning'],
      ['Benson & Hale', 'Lemon Law'],
    ]) {
      await atest(`"${name}" in ${shape} with its mark: nothing touches an edge`, async () => {
        const svg = wordmarkSvg({ businessName: name, logoType: shape, styleKey: 'style', trade });
        const { rows, cols, info } = await inkMap(svg);

        assert.ok(rows.some(Boolean), 'nothing was drawn at all');

        assert.strictEqual(rows[0], false, 'ink on the top row');
        assert.strictEqual(rows[info.height - 1], false, 'ink on the bottom row');
        assert.strictEqual(cols[0], false, 'ink on the left edge');
        assert.strictEqual(cols[info.width - 1], false,
          'ink on the right edge — the letters were sized for a box the mark is using');
      });
    }
  }

  await atest('and the mark and the letters do not sit on top of each other', async () => {
    /* THE GAP BETWEEN THEM IS EMPTY, asserted where the code says it put
     * it. Counting runs of blank columns would have been fragile — a wide
     * word space looks the same — so this reads the two placements out of
     * the SVG and checks the strip between them. */
    const svg = wordmarkSvg({
      businessName: 'Round Rock Plumbing', logoType: 'wide',
      styleKey: 'style', trade: 'Plumbing',
    });

    const mark = /translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\)/.exec(svg);
    const offset = Number(/<g transform="translate\(([\d.]+) ([\d.]+)\)">/.exec(svg)[1]);
    const right = Number(mark[1]) + 100 * Number(mark[3]);

    const { cols } = await inkMap(svg);

    assert.ok(right < offset, 'the mark box reaches past where the letters begin');

    for (let x = Math.ceil(right) + 1; x < Math.floor(offset) - 1; x += 1) {
      assert.strictEqual(cols[x], false,
        `ink at column ${x}, which is between the mark and the name`);
    }

    assert.ok(cols.slice(0, Math.floor(right)).some(Boolean), 'the mark drew nothing');
    assert.ok(cols.slice(Math.ceil(offset)).some(Boolean), 'the letters drew nothing');
  });

  await atest('the drawing is vertically centred, not merely inside', async () => {
    // The clipping bug sat the whole block one cap-height too high. Inside
    // the box, but visibly wrong. Compare the gap above with the gap below.
    const svg = wordmarkSvg({ businessName: 'Round Rock Plumbing', logoType: 'wide', styleKey: 'style' });
    const { rows } = await inkMap(svg);

    const top = rows.indexOf(true);
    const bottom = rows.length - 1 - [...rows].reverse().indexOf(true);
    const below = rows.length - 1 - bottom;

    assert.ok(Math.abs(top - below) <= rows.length * 0.06,
      `${top}px above, ${below}px below — the block is off centre`);
  });

  await atest('the favicon fills its tile and reaches every corner', async () => {
    const svg = faviconSvg({ businessName: 'Round Rock Plumbing', styleKey: 'style' });
    const { rows, cols } = await inkMap(svg);
    assert.ok(rows[0] && rows[rows.length - 1], 'the tile does not fill the canvas');
    assert.ok(cols[0] && cols[cols.length - 1], 'the tile does not fill the canvas');
  });

  await atest('the favicon letters sit in the middle of the tile', async () => {
    // Counting white pixels says the letters are THERE. It does not say they
    // are not jammed against the bottom edge, which is what happened when
    // the vertical placement was replaced wholesale.
    const svg = faviconSvg({ businessName: 'Acme Plumbing', styleKey: 'style' });
    const { data, info } = await sharp(Buffer.from(svg)).raw()
      .toBuffer({ resolveWithObject: true });

    const rows = new Array(info.height).fill(false);
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const i = (y * info.width + x) * info.channels;
        if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) rows[y] = true;
      }
    }

    const top = rows.indexOf(true);
    const bottom = rows.length - 1 - [...rows].reverse().indexOf(true);
    const below = rows.length - 1 - bottom;

    assert.ok(top > 0, 'the letters touch the top of the tile');
    assert.ok(below > 0, 'the letters touch the bottom of the tile');
    assert.ok(Math.abs(top - below) <= rows.length * 0.06,
      `${top}px above, ${below}px below — the initials are off centre`);
  });

  await atest('the letters are actually visible against the tile', async () => {
    // A white-on-white favicon is a blank square that passes every structural
    // assertion above. Count distinct colours instead.
    const svg = faviconSvg({ businessName: 'Acme Plumbing', styleKey: 'style' });
    const { data, info } = await sharp(Buffer.from(svg)).raw()
      .toBuffer({ resolveWithObject: true });

    let white = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) white += 1;
    }
    const share = white / (info.width * info.height);
    assert.ok(share > 0.03 && share < 0.6,
      `white covers ${(share * 100).toFixed(1)}% of the favicon`);
  });

  section('The preview endpoint');

  /* Pulled straight off the router, so the test exercises the handler that
   * is actually mounted rather than a copy of it. The rate limiter sits in
   * front of it in the same stack and is skipped here: it has nothing to do
   * with what the endpoint answers. */
  const router = require('./routes/logoPreviewRoute');
  const layer = router.stack.find(l => l.route && l.route.path === '/logo-preview');
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;

  function fakeRes() {
    const res = { statusCode: 200, headers: {}, body: null, contentType: '' };
    res.status = c => { res.statusCode = c; return res; };
    res.json = b => { res.body = b; res.done = true; return res; };
    res.set = (k, v) => { res.headers[k] = v; return res; };
    res.type = t => { res.contentType = t; return res; };
    res.send = b => { res.body = b; res.done = true; return res; };
    return res;
  }

  await atest('a name with no drawable characters is refused, not 500', async () => {
    const res = fakeRes();
    await handler({ query: { name: '  ', shape: 'wide', theme: 'style' } }, res);
    assert.strictEqual(res.statusCode, 422);
    assert.match(res.body.error, /business name/i);
  });

  await atest('a missing name is refused the same way', async () => {
    const res = fakeRes();
    await handler({ query: {} }, res);
    assert.strictEqual(res.statusCode, 422);
  });

  await atest('a real name comes back as a PNG', async () => {
    const res = fakeRes();
    await handler({ query: { name: 'Round Rock Plumbing', shape: 'wide', theme: 'style' } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.contentType, 'png');
    assert.ok(Buffer.isBuffer(res.body), 'the body is not a buffer');
    assert.strictEqual(res.body.slice(1, 4).toString(), 'PNG');

    const meta = await sharp(res.body).metadata();
    assert.strictEqual(meta.width, 500, 'the preview is not the wide box at 2x');
  });

  await atest('the preview is drawn ON the header colour, not transparent', async () => {
    // A white wordmark previewed on nothing is a blank rectangle, and the
    // customer concludes the feature is broken. The top-left pixel must be
    // the theme's header colour.
    const res = fakeRes();
    await handler({ query: { name: 'Acme', shape: 'wide', theme: 'style' } }, res);

    const { data } = await sharp(res.body).raw().toBuffer({ resolveWithObject: true });
    assert.deepStrictEqual([data[0], data[1], data[2]], [0x08, 0x2d, 0x5b]);
  });

  await atest('the theme in the query is the theme that gets drawn', async () => {
    // Without this, the endpoint could hard-wire one theme and every
    // assertion above would still pass — the customer would compare all
    // seven designs and be shown the same picture seven times.
    async function corner(theme) {
      const res = fakeRes();
      await handler({ query: { name: 'Acme', shape: 'wide', theme } }, res);
      const { data } = await sharp(res.body).raw().toBuffer({ resolveWithObject: true });
      return [data[0], data[1], data[2]].join(',');
    }

    assert.strictEqual(await corner('style'), '8,45,91');    // navy
    assert.strictEqual(await corner('style3'), '0,0,0');     // black
    assert.strictEqual(await corner('style4'), '255,255,255'); // white
  });

  await atest('an unknown shape or theme still answers', async () => {
    const res = fakeRes();
    await handler({ query: { name: 'Acme', shape: 'octagon', theme: 'style99' } }, res);
    assert.strictEqual(res.statusCode, 200);

    const meta = await sharp(res.body).metadata();
    assert.strictEqual(meta.width, 300, 'an unknown shape should fall back to rect at 2x');
  });

  await atest('the answer is cached privately, never shared', async () => {
    // The business name is in the query string, and this is one customer's
    // unsaved draft. A shared cache would serve it to the next person behind
    // the same proxy.
    const res = fakeRes();
    await handler({ query: { name: 'Acme', shape: 'wide', theme: 'style' } }, res);
    assert.match(res.headers['Cache-Control'], /private/);
    assert.ok(!/public/.test(res.headers['Cache-Control']));
  });

  await atest('the preview follows the DESIGN in Local Website Options', async () => {
    /* That mode hides the theme step, so a styleKey would be an answer to a
     * question nobody was asked. Design 3 is Anvil, whose rail is near-black
     * — if the preview ignored the design it would show dark letters on
     * white for a header that is neither. */
    async function corner(q) {
      const res = fakeRes();
      await handler({ query: Object.assign({ name: 'Leander Plumbing', shape: 'wide' }, q) }, res);
      const { data } = await sharp(res.body).raw().toBuffer({ resolveWithObject: true });
      return [data[0], data[1], data[2]].join(',');
    }

    /* ALL THREE DRAW ON WHITE, so the corner pixel no longer separates them
     * — Ledger and Beacon use a white card and Anvil a white plate. What
     * still differs is the INK, so the comparison is the picture itself. */
    assert.strictEqual(await corner({ design: '1' }), '255,255,255', 'Ledger is not white');
    assert.strictEqual(await corner({ design: '3' }), '255,255,255', 'Anvil is not white');

    const png = async q => {
      const res = fakeRes();
      await handler({ query: Object.assign({ name: 'Leander Plumbing', shape: 'wide' }, q) }, res);
      return res.body.toString('base64');
    };

    assert.notStrictEqual(await png({ design: '1' }), await png({ design: '3' }),
      'the design does not change what is drawn');

    assert.strictEqual(await png({ design: '' }), await png({ design: '1' }),
      '"Choose for me" did not resolve to Ledger');

    // And the design beats a theme sent alongside it, rather than the two
    // fighting over which table to read.
    assert.strictEqual(await png({ design: '3', theme: 'style4' }), await png({ design: '3' }));
  });

  await atest('a wordmark is DRAWN for that mode, and no favicon with it', async () => {
    /* render/chrome.js's document() emits no <link rel="icon">, so a favicon
     * here would be a file nothing references — which is why placeLogo calls
     * wordmarkPng rather than writeWordmark. */
    const os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-lo-'));

    const rel = await LO.placeLogo([], dir, {
      wordmark: true,
      businessName: 'Leander Plumbing Co',
      logoType: 'wide',
      structure: 'anvil',
    });

    assert.strictEqual(rel, 'assets/logo.png');
    assert.deepStrictEqual(fs.readdirSync(dir), ['logo.png'],
      'something other than the logo was written');

    const png = fs.readFileSync(path.join(dir, 'logo.png'));
    const meta = await sharp(png).metadata();
    assert.strictEqual(meta.width, 500, 'not the wide box at 2x');
    assert.ok(meta.hasAlpha, 'the site logo should be transparent');
  });

  await atest('and nothing is drawn when the option was not chosen', async () => {
    const os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-lo-'));

    assert.strictEqual(await LO.placeLogo([], dir, {}), '');
    assert.deepStrictEqual(fs.readdirSync(dir), [],
      'a logo was drawn for a customer who did not ask for one');
  });

  await atest('the route is mounted behind requireAuth', async () => {
    const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    assert.match(server, /app\.use\('\/', requireAuth, logoPreviewRoute\)/,
      'the preview is reachable without signing in');
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
