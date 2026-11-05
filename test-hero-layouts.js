// test-hero-layouts.js
//
// The templates carry four hero blocks. Each design shows exactly one.
//
// WHY THIS FILE DID NOT EXIST UNTIL DESIGN 7
//
// utils/stripUnusedHero.js has been deciding which <h1> every generated page
// ships since the markers were introduced, across four templates and six
// designs, with no test of any kind. It survived because it was written once
// and barely touched. Adding a seventh design touched all of it.
//
// WHAT GOES WRONG HERE IS NEVER AN EXCEPTION
//
// Every failure mode of this module is a page that renders:
//
//   a key offered by the wizard with no HERO_LAYOUT entry
//        -> the unmapped fallback fires, the page ships the standard AND the
//           overlay hero, two <h1>s, and reads as a broken stylesheet
//   a layout added to HERO_LAYOUT but not to HERO_BLOCKS
//        -> its block is never removed for OTHER designs, so every other
//           design grows a second hero
//   a layout whose markers were not added to removeMarkers()
//        -> `<!--HERO:spotlight-->` ships in the HTML; invisible in a browser
//   a CTA-carrying hero left out of CTA_INSIDE_HERO
//        -> the phone number appears twice, one above the other
//   a block added to one template and not the other three
//        -> the home page is right and the contact page has no hero
//
// Not one of those throws. Not one shows up in a log. They show up on a
// customer's finished site, which is the last place anybody wants to find
// them, so the checks here are mostly counting rather than clever.
//
//   node test-hero-layouts.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  stripUnusedHero, HERO_LAYOUT, MARKERS, HERO_BLOCKS,
  CTA_INSIDE_HERO, UNSTYLED_WITHOUT_THEME,
} = require('./utils/stripUnusedHero');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}
function section(name) { console.log(`\n${name}\n`); }

/* ===================================================================== */

/** Every template that carries the markers. */
const TEMPLATES = [
  'template.html',
  'aboutUsTemplate.html',
  'contactTemplate.html',
  'locationPagesTemplate.html',
];

const HTML = Object.fromEntries(
  TEMPLATES.map(f => [f, fs.readFileSync(path.join(__dirname, 'src', f), 'utf8')])
);

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

/* ===================================================================== */

section('The wizard and the stripper agree on what exists');

test('THE LISTS ARE BOTH NON-EMPTY AND BOTH BEING READ', () => {
  /* Both sides of every comparison below come from parsing. If either parse
   * silently returns nothing, every assertion passes vacuously and this file
   * becomes decoration. */
  assert.ok(OFFERED.length >= 6, `only parsed ${OFFERED.length} design keys from the wizard`);
  assert.ok(Object.keys(HERO_LAYOUT).length >= 6, 'HERO_LAYOUT looks empty');
});

test('EVERY DESIGN THE WIZARD OFFERS HAS A HERO LAYOUT', () => {
  /* THE FAILURE THIS CATCHES IS NOT AN ERROR. An offered key with no mapping
   * falls into the unmapped branch, which keeps the standard AND overlay
   * blocks: two heroes, two <h1>s, on every page of a site somebody paid
   * for. */
  const orphans = OFFERED.filter(k => !HERO_LAYOUT[k]);

  assert.deepStrictEqual(orphans, [],
    `offered in the wizard with no HERO_LAYOUT entry: ${orphans.join(', ')}\n`
    + '        Add it to HERO_LAYOUT in utils/stripUnusedHero.js.');
});

test('and no layout is mapped to a block that does not exist', () => {
  for (const [key, layout] of Object.entries(HERO_LAYOUT)) {
    assert.ok(MARKERS[layout], `${key} maps to "${layout}", which has no markers`);
    assert.ok(HERO_BLOCKS.includes(layout),
      `${key} maps to "${layout}", which is not in HERO_BLOCKS — so it is never `
      + 'removed for the other designs, and every one of them grows a second hero');
  }
});

test('design 7 is the spotlight, and it is offered', () => {
  assert.ok(OFFERED.includes('style7'), 'the wizard does not offer Design 7');
  assert.strictEqual(HERO_LAYOUT.style7, 'spotlight');
});

/* ===================================================================== */

section('Every block exists in every template');

test('ALL FOUR TEMPLATES CARRY ALL FOUR HERO BLOCKS, AND THE CTA', () => {
  /* ASKED PER TEMPLATE, not across the set. A block added to template.html
   * and forgotten in contactTemplate.html gives a site whose home page is
   * right and whose contact page has no hero at all — and the contact page is
   * the one the customer checks last. */
  for (const file of TEMPLATES) {
    for (const name of [...HERO_BLOCKS, 'cta']) {
      const { open, close } = MARKERS[name];
      assert.ok(HTML[file].includes(open), `${file} is missing ${open}`);
      assert.ok(HTML[file].includes(close), `${file} is missing ${close}`);
      assert.ok(HTML[file].indexOf(close) > HTML[file].indexOf(open),
        `${file} has ${name}'s markers in the wrong order`);
    }
  }
});

/* ===================================================================== */

section('One design in, one hero out');

test('EXACTLY ONE HERO BLOCK SURVIVES, FOR EVERY DESIGN AND TEMPLATE', () => {
  for (const file of TEMPLATES) {
    for (const [key, layout] of Object.entries(HERO_LAYOUT)) {
      const out = stripUnusedHero(HTML[file], key);

      for (const name of HERO_BLOCKS) {
        const stillThere = out.includes(MARKERS[name].open)
          || out.includes(MARKERS[name].close);
        assert.ok(!stillThere, `${key}/${file}: ${name}'s markers survived`);
      }

      /* The markers are gone either way, so the surviving block is counted by
       * the <h1> it carries. Every hero block has exactly one. */
      const h1s = (out.match(/<h1\b/g) || []).length;
      assert.strictEqual(h1s, 1,
        `${key}/${file}: ${h1s} <h1> tags survived, expected 1 (layout ${layout})`);
    }
  }
});

test('and not one marker comment ships', () => {
  /* removeMarkers() builds its pattern from MARKERS now. It used to list the
   * names by hand, which means a new layout shipped its comments into the
   * customer's HTML — invisible in a browser, so nothing ever complains. */
  for (const file of TEMPLATES) {
    for (const key of Object.keys(HERO_LAYOUT)) {
      const out = stripUnusedHero(HTML[file], key);
      assert.ok(!/HERO:/.test(out), `${key}/${file} still contains a HERO: marker`);
    }
  }
});

/* ===================================================================== */

section('The phone number appears once');

test('A HERO THAT CARRIES ITS OWN CTA LOSES THE STANDALONE ONE', () => {
  /* The split and spotlight heroes both have a phone button inside them.
   * Leaving the standalone block in would put the same number twice, one
   * directly above the other. */
  for (const file of TEMPLATES) {
    for (const [key, layout] of Object.entries(HERO_LAYOUT)) {
      const out = stripUnusedHero(HTML[file], key);
      const hasStandalone = out.includes('first-button-container');

      if (CTA_INSIDE_HERO.has(layout)) {
        assert.ok(!out.includes(MARKERS.cta.open), `${key}/${file}: the cta markers survived`);
      } else {
        assert.ok(hasStandalone,
          `${key}/${file}: layout ${layout} has no CTA of its own and lost the standalone one`);
      }
    }
  }
});

test('spotlight is in CTA_INSIDE_HERO, because its block has a phone link', () => {
  const block = HTML['template.html'].slice(
    HTML['template.html'].indexOf(MARKERS.spotlight.open),
    HTML['template.html'].indexOf(MARKERS.spotlight.close));

  assert.ok(block.includes('{{PHONE_RAW}}'), 'the spotlight hero no longer has a phone link');
  assert.ok(CTA_INSIDE_HERO.has('spotlight'),
    'spotlight carries a phone link but is not in CTA_INSIDE_HERO, so the page shows it twice');
});

/* ===================================================================== */

section('An unmapped design does not ship an unstyled hero');

test('THE FALLBACK REMOVES EVERY LAYOUT ONLY ONE THEME STYLES', () => {
  /* The fallback used to name `split` by hand because split was the new one.
   * Spotlight arrived and that line was still about split — so an unmapped
   * theme would have kept an unstyled spotlight hero, which is exactly the
   * failure the line was written to prevent, one layout later. */
  for (const file of TEMPLATES) {
    for (const key of ['styleX', 'style99', '', null, undefined]) {
      const out = stripUnusedHero(HTML[file], key);

      for (const name of UNSTYLED_WITHOUT_THEME) {
        assert.ok(!out.includes(MARKERS[name].open),
          `${JSON.stringify(key)}/${file}: the unstyled ${name} block survived`);
      }
    }
  }
});

test('and it keeps the two blocks every old theme styles', () => {
  /* The other half. Removing everything would leave a page with no hero at
   * all, which is worse than the duplicate this branch tolerates. */
  const out = stripUnusedHero(HTML['template.html'], 'styleX');

  assert.strictEqual((out.match(/<h1\b/g) || []).length, 2,
    'the unmapped fallback no longer keeps the standard and overlay blocks');
});

test('UNSTYLED_WITHOUT_THEME names every block but the two originals', () => {
  /* The list has to grow with HERO_BLOCKS. A layout added to HERO_BLOCKS and
   * forgotten here is one an unmapped theme renders with no CSS. */
  const missing = HERO_BLOCKS
    .filter(b => b !== 'standard' && b !== 'overlay')
    .filter(b => !UNSTYLED_WITHOUT_THEME.includes(b));

  assert.deepStrictEqual(missing, [],
    `in HERO_BLOCKS but not UNSTYLED_WITHOUT_THEME: ${missing.join(', ')}`);
});

/* ===================================================================== */

section('The spotlight block itself');

test('IT CARRIES NAME, ADDRESS AND PHONE — NOT TRUST CLAIMS', () => {
  /* The design this came from had "Licensed & Insured" across the bar. That
   * is an unverified credential claim, and it is the reason
   * capabilities().badges is home-services only: on a dental or legal site a
   * claim like that is a licensing-board matter. This hero is offered to
   * every business shape, so the bar carries facts the owner typed. */
  const t = HTML['template.html'];
  const block = t.slice(t.indexOf(MARKERS.spotlight.open), t.indexOf(MARKERS.spotlight.close));

  for (const token of ['{{BUSINESS_NAME}}', '{{ADDRESS}}', '{{PHONE_DISPLAY}}']) {
    assert.ok(block.includes(token), `the NAP bar lost ${token}`);
  }

  /* COMMENTS STRIPPED FIRST, and the first version of this test did not do
   * that and failed. The comment above the block EXPLAINS why "Licensed &
   * insured" was taken out — so it contains the words, and the check matched
   * its own rationale. Exactly the trap test-wizard-steps.js records for
   * trustClaims. What ships is the markup; the comment does not. */
  const markup = block.replace(/<!--[\s\S]*?-->/g, '');

  assert.ok(!/Licensed|Insured|Guaranteed|Award/i.test(markup),
    'a trust claim has been written into the spotlight hero');
});

test('the Book Appointment button resolves through fillLegalLinks', () => {
  /* {{CONTACT_PAGE}} is filled by utils/legalLinks.js, which is also what
   * makes it point back at the page itself on a one-page design sample
   * instead of 404ing on a contact page that was never built. */
  const { fillLegalLinks, LEGAL_SLUGS } = require('./utils/legalLinks');

  assert.strictEqual(LEGAL_SLUGS.CONTACT_PAGE, 'contact.html',
    'CONTACT_PAGE is no longer resolved alongside the legal links');

  for (const file of TEMPLATES) {
    const block = HTML[file].slice(
      HTML[file].indexOf(MARKERS.spotlight.open),
      HTML[file].indexOf(MARKERS.spotlight.close));
    assert.ok(block.includes('{{CONTACT_PAGE}}'), `${file}: the hero lost {{CONTACT_PAGE}}`);
  }

  const full = fillLegalLinks(HTML['template.html'], {});
  assert.ok(full.includes('href="contact.html"'), 'it no longer resolves to contact.html');
  assert.ok(!full.includes('{{CONTACT_PAGE}}'), 'the token survived the fill');

  const sample = fillLegalLinks(HTML['template.html'], { siteMode: 'sample' });
  assert.ok(!sample.includes('href="contact.html"'),
    'a design sample links at a contact page it never builds');
});

test('ONLY STYLE7 HAS CSS FOR IT', () => {
  /* The whole mechanism rests on this. If a second stylesheet started styling
   * .hero-spotlight, the stripper would still remove the block for that
   * design and the CSS would be dead — or worse, somebody would map that
   * design to spotlight and change what an existing customer's site looks
   * like. */
  const dir = path.join(__dirname, 'src', 'css', 'themes');

  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.css'))) {
    const has = fs.readFileSync(path.join(dir, file), 'utf8').includes('.hero-spotlight');
    assert.strictEqual(has, file === 'style7.css',
      `${file} ${has ? 'styles' : 'does not style'} .hero-spotlight`);
  }
});

test('and style7.css exists where resolveThemeCss will look for it', () => {
  const { resolveThemeCss } = require('./utils/helpers');
  const resolved = resolveThemeCss('style7');

  assert.ok(resolved, 'resolveThemeCss cannot find style7');
  assert.ok(fs.existsSync(resolved), `resolveThemeCss returned ${resolved}, which is not there`);
});


/* =====================================================================
 * THE WORDPRESS RENDERER HAS TO KNOW THE SAME LAYOUTS
 * ---------------------------------------------------------------------
 * sectionRendererPhp.js renders the hero for exported themes, and its
 * branches are positive conditions — an unknown layout renders NOTHING.
 * That is the right default and it is also silent: style7 was added to
 * HERO_LAYOUT, the static build began rendering it, and every Design 7
 * site exported to WordPress shipped with no hero at all. No error, no
 * log line. The page simply started at section one.
 *
 * So the test is not "does spotlight work". It is "does every layout
 * this app can choose have somewhere to go in the PHP".
 * ================================================================== */

section('THE WORDPRESS RENDERER');

const { generateSectionRendererPhp } = require('./utils/wpThemeBuilder/generators/sectionRendererPhp');

const phpFor = styleKey =>
  generateSectionRendererPhp({ themeSlug: 'test-theme', styleKey });

test('every HERO_LAYOUT value has a branch in the WordPress renderer', () => {
  const php = phpFor('style7');

  for (const layout of new Set(Object.values(HERO_LAYOUT))) {
    assert.ok(
      php.includes(`$layout === '${layout}'`),
      `sectionRendererPhp.js has no branch for '${layout}'. A theme built for ` +
      `the design that uses it renders no hero, and nothing says so.`
    );
  }
});

/** A PHP function's body, by name. Bounded at the closing brace in column
 *  one — slicing to end-of-file instead let a later part of the file satisfy
 *  an assertion about this function, which is how the CTA check below passed
 *  while the behaviour it describes was broken. */
function phpBody(php, name) {
  const marker = `function ${name}() {`;
  const start = php.indexOf(marker);
  assert.ok(start !== -1, `${name}() is missing from the renderer`);
  const end = php.indexOf('\n}', start);
  return php.slice(start + marker.length, end);
}

test('the exported theme agrees with CTA_INSIDE_HERO', () => {
  const body = phpBody(phpFor('style7'), 'test_theme_hero_has_cta');

  /* THE LIST, NOT THE WHOLE BODY. The generated line reads
   *     return in_array( 'spotlight', array( 'split' ), true );
   * because the theme's own layout is interpolated as the needle — so
   * "does the body mention 'spotlight'" is true even when the haystack has
   * had spotlight removed. It passed that way until a mutation run caught
   * it. The haystack is what this test is about. */
  /* ANCHORED ON in_array's SECOND argument. A bare /array\(/ matches the
   * "array(" inside "in_array(" first, which swept the needle into the
   * haystack and made the comparison pass against itself. */
  const list = body.match(/in_array\(\s*'[^']*'\s*,\s*array\(([^)]*)\)/);
  assert.ok(list, '_hero_has_cta() no longer compares against a list');

  const named = new Set(
    [...list[1].matchAll(/'([^']+)'/g)].map(m => m[1])
  );

  assert.deepStrictEqual(named, new Set(CTA_INSIDE_HERO),
    `_hero_has_cta() names {${[...named]}} but CTA_INSIDE_HERO is ` +
    `{${[...CTA_INSIDE_HERO]}}. A layout missing here shows the phone number ` +
    `twice on the WordPress page; one listed in error hides the CTA entirely.`);
});

/* ---- THE SKELETONS MUST MATCH ----
 *
 * ONE STYLESHEET SERVES BOTH SIDES: style7.css is copied into the exported
 * theme. So the PHP is not merely similar to the static markup — it has to
 * carry the same classes in the same nesting, or the WordPress hero is
 * unstyled, which looks like a CSS bug and is not one.
 *
 * COMPARED AS A TREE, NOT AS TEXT. The PHP has <?php ?> in it and the
 * template has {{PLACEHOLDERS}}, so a string diff could only ever say
 * "different". An earlier version of this check read indentation to decide
 * where the badges were and got the answer wrong twice before the stack
 * walk below settled it. */

function skeleton(html) {
  const out = [];
  const stack = [];
  const VOID = new Set(['img', 'br', 'hr', 'source', 'input', 'meta', 'link', 'path', 'circle', 'use']);
  const tagRe = /<(\/?)([a-zA-Z0-9]+)([^>]*)>/g;

  let m;
  while ((m = tagRe.exec(html))) {
    const [, closing, tag, attrs] = m;
    const name = tag.toLowerCase();

    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i] === name) { stack.length = i; break; }
      }
      continue;
    }

    const cls = (attrs.match(/class="([^"]*)"/) || [, ''])[1]
      .split(/\s+/).filter(Boolean).sort().join('.');

    // Only classed elements matter: those are what the stylesheet can see.
    // Depth is recorded with them, so moving the badges out of the actions
    // block fails even though both shapes contain a .badges.
    if (cls) out.push(`${stack.length}:${name}.${cls}`);

    if (!VOID.has(name)) stack.push(name);
  }

  return out;
}

test('the PHP spotlight hero carries the same classes, at the same depths', () => {
  const template = fs.readFileSync(path.join(__dirname, 'src/template.html'), 'utf8');
  const staticBlock = template.slice(
    template.indexOf('<div class="container-fluid hero-spotlight">'),
    template.indexOf('<!--/HERO:spotlight-->')
  );

  const php = phpFor('style7');
  const open = php.indexOf('<div class="container-fluid hero-spotlight">');

  // To the end of _render_hero(), NOT to the first `<?php endif; ?>`: the
  // phone button and each NAP row are wrapped in their own `if`, so the
  // first endif lands a third of the way in. Slicing there compared twelve
  // elements against twenty-eight and reported a mismatch that was entirely
  // the test's own fault.
  const phpBlock = php.slice(open, php.indexOf('\n}', open));

  // The PHP draws its <picture> from a shared helper, so the template's
  // four <source> lines have no counterpart INSIDE this block. Everything
  // the stylesheet targets does.
  const styled = s => skeleton(s).filter(n => !/\.hero-img|hero-img\./.test(n));

  assert.deepStrictEqual(styled(phpBlock), styled(staticBlock),
    'the WordPress hero and the static hero no longer have the same shape, so ' +
    'one stylesheet cannot style both');
});

test('the PHP hero reaches for the composed address, not the raw one', () => {
  const php = phpFor('style7');

  assert.ok(php.includes('_full_address()'),
    'the NAP bar must use the composed address; the raw `address` setting is ' +
    'often just a street');

  const body = phpBody(php, 'test_theme_full_address');

  // The two rules utils/fullAddress.js documents, in its PHP twin. Running
  // it would be better than reading it; reading it is what works without a
  // PHP binary on the machine running these tests.
  assert.ok(/strpos\(\s*' '\s*\.\s*\$flat\s*\.\s*' '/.test(body),
    'the city test is not space-padded on BOTH sides, so "Leander" would ' +
    'match inside "Leanderville"');

  // BOTH boundaries, checked separately. Asserting the body merely contains
  // a \b passed while the opening one had been deleted — the closing \b in
  // the same pattern satisfied it.
  assert.ok(/'\/\\b'\s*\.\s*preg_quote/.test(body),
    'the state pattern has no OPENING word boundary, so ME would be found at ' +
    'the start of "Maine"');
  assert.ok(/\.\s*'\\b\/i'/.test(body),
    'the state pattern has no CLOSING word boundary');

  assert.ok(!/\d{5}/.test(body),
    'a ZIP code is being fabricated in the PHP');
});

/* ---- WHERE THE BADGES ARE EMITTED ----
 *
 * The skeleton comparison above cannot see this and it took a mutation run
 * to notice: on the static side the badges are {{HERO_BADGES}}, and in the
 * PHP they are a function call. NEITHER contributes a tag, so both skeletons
 * are identical whether the badges sit in the buttons block or in the
 * picture wrapper.
 *
 * It matters because style7.css positions them against the BUTTONS, with a
 * shelf of padding reserved beneath the text. In the picture wrapper they
 * land on the white NAP bar instead — which is a bug that already shipped
 * once on the static side. */
test('the badges are emitted inside the buttons block, on both sides', () => {
  /* The actions block's own extent, found by counting <div> depth rather
     than by guessing at the next </div>. The first version of this looked
     for the close after the last </a> and would have accepted a badges call
     placed anywhere after the buttons, including outside the hero. */
  function actionsBlock(html) {
    const open = html.indexOf('<div class="hero-spotlight__actions">');
    assert.ok(open !== -1, 'no .hero-spotlight__actions here');

    let depth = 0;
    const re = /<(\/?)div\b/g;
    re.lastIndex = open;

    let m;
    while ((m = re.exec(html))) {
      depth += m[1] ? -1 : 1;
      if (depth === 0) return html.slice(open, re.lastIndex);
    }
    throw new Error('.hero-spotlight__actions is never closed');
  }

  /* STATIC: aboutUsTemplate.html, NOT template.html. {{HERO_BADGES}} is in
     that one template only, and buildAboutUsPage.js is the only builder
     that fills it — so on the static site the badges are an About-page
     thing for every design, not just this one. The PHP helper below is
     called from every spotlight hero, which is how the other three layouts
     have always behaved there too. The divergence is older than Design 7
     and is recorded here rather than quietly "fixed" by a test. */
  const about = fs.readFileSync(path.join(__dirname, 'src/aboutUsTemplate.html'), 'utf8');
  const spotlight = about.slice(
    about.indexOf('<!--HERO:spotlight-->'),
    about.indexOf('<!--/HERO:spotlight-->')
  );

  assert.ok(actionsBlock(spotlight).includes('{{HERO_BADGES}}'),
    '{{HERO_BADGES}} is outside .hero-spotlight__actions in aboutUsTemplate.html, ' +
    'so the badges will sit on the white NAP bar instead of under the buttons');

  const php = phpFor('style7');
  const open = php.indexOf('<div class="container-fluid hero-spotlight">');
  const phpHero = php.slice(open, php.indexOf('\n}', open));

  assert.ok(actionsBlock(phpHero).includes('_hero_badges('),
    'the PHP emits the badges outside .hero-spotlight__actions, so on a ' +
    'WordPress site they will land on the white NAP bar');
});

/* ===================================================================== */

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
