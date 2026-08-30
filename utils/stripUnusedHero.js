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
 *   all others hide .hero-container                          -> use overlay
 *
 * A styleKey that is NOT listed keeps the standard and overlay blocks — see
 * the fallback in stripUnusedHero().
 */
const HERO_LAYOUT = {
  style:  'overlay',
  style2: 'standard',
  style3: 'overlay',
  style4: 'overlay',
  style5: 'overlay',
  style6: 'split',
};

const MARKERS = {
  standard: { open: '<!--HERO:standard-->', close: '<!--/HERO:standard-->' },
  overlay:  { open: '<!--HERO:overlay-->',  close: '<!--/HERO:overlay-->' },
  split:    { open: '<!--HERO:split-->',    close: '<!--/HERO:split-->' },

  // Not a hero. The standalone phone CTA that sits below the hero blocks.
  cta:      { open: '<!--HERO:cta-->',      close: '<!--/HERO:cta-->' },
};

const HERO_BLOCKS = ['standard', 'overlay', 'split'];

/**
 * Layouts that carry the phone CTA INSIDE the hero markup.
 *
 * The split hero puts the button in its left column, so the standalone block
 * below has to go or the page shows two identical phone buttons. Every other
 * layout relies on the standalone one and must keep it.
 */
const CTA_INSIDE_HERO = new Set(['split']);

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
  return html.replace(/<!--\/?HERO:(standard|overlay|split|cta)-->\n?/g, '');
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
  // The split block is different: it is new, and no theme except style6 has
  // CSS for it. Leaving it in for an unmapped theme would render an unstyled
  // third hero, which is not a graceful degradation of anything. So it is
  // removed, and the page falls back to exactly what it did before this
  // layout existed.
  if (!layout) {
    if (styleKey) {
      console.warn(`   ⚠️ No hero layout mapped for "${styleKey}" — keeping the standard and overlay blocks`);
    }
    return removeMarkers(removeBlock(html, MARKERS.split));
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

module.exports = { stripUnusedHero, HERO_LAYOUT, MARKERS, CTA_INSIDE_HERO };