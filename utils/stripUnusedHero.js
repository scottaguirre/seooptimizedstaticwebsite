// utils/stripUnusedHero.js
//
// The templates carry TWO hero blocks and each theme hides one with CSS.
// That means every page ships markup it never shows — including a duplicate
// <h1>, which SEO tools flag.
//
// This removes the block the chosen design does not use, at build time.
//
// WHY MARKERS RATHER THAN REGEX
// Both blocks contain nested <div>s, so a non-greedy match up to the first
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
 *   all others hide .hero-container                          -> use overlay
 *
 * A styleKey that is NOT listed keeps BOTH blocks. That matters: a new theme
 * added later behaves exactly as things do today rather than silently losing
 * its hero, which is much worse than a duplicate.
 */
const HERO_LAYOUT = {
    style:  'overlay',
    style2: 'standard',
    style3: 'overlay',
    style4: 'overlay',
    style5: 'overlay',
  };
  
  const MARKERS = {
    standard: { open: '<!--HERO:standard-->', close: '<!--/HERO:standard-->' },
    overlay:  { open: '<!--HERO:overlay-->',  close: '<!--/HERO:overlay-->' },
  };
  
  /** Remove everything between a marker pair, inclusive. */
  function removeBlock(html, marker) {
    const start = html.indexOf(marker.open);
    if (start === -1) return html;
  
    const end = html.indexOf(marker.close, start);
    if (end === -1) {
      console.warn(`   ⚠️ Hero marker ${marker.open} has no closing tag — leaving the block in place`);
      return html;
    }
  
    return html.slice(0, start) + html.slice(end + marker.close.length);
  }
  
  /** Strip the marker comments themselves, leaving the markup untouched. */
  function removeMarkers(html) {
    return html
      .replace(/<!--\/?HERO:(standard|overlay)-->\n?/g, '');
  }
  
  /**
   * @param {string} html      the page, after or before placeholder replacement
   * @param {string} styleKey  e.g. 'style3'
   * @returns {string}
   */
  function stripUnusedHero(html, styleKey) {
    const layout = HERO_LAYOUT[String(styleKey || '').trim()];
  
    // Unknown theme: keep both blocks, exactly as before this existed.
    if (!layout) {
      if (styleKey) {
        console.warn(`   ⚠️ No hero layout mapped for "${styleKey}" — keeping both hero blocks`);
      }
      return removeMarkers(html);
    }
  
    const unused = layout === 'standard' ? 'overlay' : 'standard';
    const stripped = removeBlock(html, MARKERS[unused]);
  
    return removeMarkers(stripped);
  }
  
  module.exports = { stripUnusedHero, HERO_LAYOUT, MARKERS };