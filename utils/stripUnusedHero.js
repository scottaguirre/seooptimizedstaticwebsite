// utils/stripUnusedHero.js
//
// The templates carry THREE hero blocks and each theme uses one. That means
// every page ships markup it never shows — including duplicate <h1>s, which
// SEO tools flag.
//
// This removes the blocks the chosen design does not use, at build time.
//
// WHY MARKERS RATHER THAN REGEX
// Every block contains nested <div>s, so a non-greedy match up to the first
// </div> would cut in the wrong place and leave an orphaned closing tag. The
// markers make removal a plain string slice with no parsing at all.
//
// WHY NOT MOVE THE MARKUP INTO JS
// The templates get edited. Keeping the markup where it is means those edits
// survive; this only deletes between two fixed comments.

/**
 * Which block each theme actually displays.
 *
 * Derived by reading the theme stylesheets:
 *   style2 hides .hero-container-for-style-and-style3-992px  -> uses standard
 *   style6 wants the two-column layout with the CTA inside   -> uses split
 *   style7 is the only theme with CSS for .hero-spotlight    -> uses spotlight
 *   all others hide .hero-container                          -> use overlay
 *
 * A styleKey that is NOT listed keeps the standard and overlay blocks — see
 * the fallback in stripUnusedHero().
 *
 * EVERY KEY IN THE WIZARD'S STYLES LIST HAS TO APPEAR HERE. Adding a design
 * is editing two files that know nothing about each other —
 * public/js/generateDinamycForm.js offers the tile, this map decides what it
 * renders — and the failure when they disagree is not an error. It is the
 * unmapped fallback below: a page that ships two heroes, two <h1>s, and looks
 * like the stylesheet failed to load. test-hero-layouts.js is the thing that
 * refuses that now.
 */
const HERO_LAYOUT = {
  style:  'overlay',
  style2: 'standard',
  style3: 'overlay',
  style4: 'overlay',
  style5: 'overlay',
  style6: 'split',
  style7: 'spotlight',
};

const MARKERS = {
  standard:  { open: '<!--HERO:standard-->',  close: '<!--/HERO:standard-->' },
  overlay:   { open: '<!--HERO:overlay-->',   close: '<!--/HERO:overlay-->' },
  split:     { open: '<!--HERO:split-->',     close: '<!--/HERO:split-->' },
  spotlight: { open: '<!--HERO:spotlight-->', close: '<!--/HERO:spotlight-->' },

  // Not a hero. The standalone phone CTA that sits below the hero blocks.
  cta:       { open: '<!--HERO:cta-->',       close: '<!--/HERO:cta-->' },
};

const HERO_BLOCKS = ['standard', 'overlay', 'split', 'spotlight'];

/**
 * Layouts that carry the phone CTA INSIDE the hero markup.
 *
 * The split hero puts the button in its left column, so the standalone block
 * below has to go or the page shows two identical phone buttons. The
 * spotlight hero carries two buttons, one of which IS the phone. Every other
 * layout relies on the standalone one and must keep it.
 */
const CTA_INSIDE_HERO = new Set(['split', 'spotlight']);

/**
 * Layouts no pre-existing theme has CSS for.
 *
 * WHY THIS IS A LIST AND NOT A SPECIAL CASE FOR `split`. The unmapped-theme
 * fallback below used to name split by hand, because split was the new one.
 * Spotlight arrived and the hand-written line was still about split — so an
 * unmapped theme would have kept an unstyled spotlight hero, which is the
 * exact failure that line was written to prevent, one layout later.
 *
 *     A SPECIAL CASE FOR "THE NEW ONE" STOPS BEING TRUE THE DAY THERE IS A
 *     NEWER ONE.
 *
 * standard and overlay stay out of this list deliberately: every theme that
 * predates the markers styles one of them, so keeping both is a real fallback
 * rather than a broken page.
 */
const UNSTYLED_WITHOUT_THEME = ['split', 'spotlight'];

/** Remove everything between a marker pair, inclusive. */
function removeBlock(html, marker) {
  const start = html.indexOf(marker.open);
  if (start === -1) return html;

  const end = html.indexOf(marker.close, start);
  if (end === -1) {
    console.warn(`   ⚠️ Marker ${marker.open} has no closing tag — leaving the block in place`);
    return html;
  }

  return html.slice(0, start) + html.slice(end + marker.close.length);
}

/** Strip the marker comments themselves, leaving the markup untouched. */
function removeMarkers(html) {
  /* BUILT FROM THE MARKERS, NOT TYPED OUT. This pattern used to list the
   * names by hand, which means adding a layout and forgetting this line
   * leaves `<!--HERO:spotlight-->` in the shipped HTML — invisible in a
   * browser, so nothing ever complains. */
  const names = Object.keys(MARKERS).join('|');
  return html.replace(new RegExp(`<!--\\/?HERO:(${names})-->\\n?`, 'g'), '');
}

/**
 * @param {string} html      the page, after or before placeholder replacement
 * @param {string} styleKey  e.g. 'style3'
 * @returns {string}
 */
function stripUnusedHero(html, styleKey) {
  const layout = HERO_LAYOUT[String(styleKey || '').trim()];

  // UNKNOWN THEME.
  //
  // The old behaviour was "keep both blocks" — better a duplicate hero than a
  // page with none. That still holds for standard and overlay, which every
  // pre-existing theme styles one of.
  //
  // The later blocks are different: each one is styled by exactly one theme.
  // Leaving them in for an unmapped theme would render an unstyled extra
  // hero, which is not a graceful degradation of anything. So every layout in
  // UNSTYLED_WITHOUT_THEME is removed, and the page falls back to exactly
  // what it did before those layouts existed.
  if (!layout) {
    if (styleKey) {
      console.warn(`   ⚠️ No hero layout mapped for "${styleKey}" — keeping the standard and overlay blocks`);
    }
    return removeMarkers(
      UNSTYLED_WITHOUT_THEME.reduce((out, block) => removeBlock(out, MARKERS[block]), html)
    );
  }

  // Remove every hero block except the chosen one.
  let out = html;
  for (const block of HERO_BLOCKS) {
    if (block !== layout) out = removeBlock(out, MARKERS[block]);
  }

  // And the standalone CTA, when the chosen hero already contains one.
  if (CTA_INSIDE_HERO.has(layout)) {
    out = removeBlock(out, MARKERS.cta);
  }

  return removeMarkers(out);
}

module.exports = {
  stripUnusedHero,
  HERO_LAYOUT,
  MARKERS,
  HERO_BLOCKS,
  CTA_INSIDE_HERO,
  UNSTYLED_WITHOUT_THEME,
};