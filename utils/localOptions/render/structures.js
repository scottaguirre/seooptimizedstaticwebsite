// utils/localOptions/render/structures.js
//
// Which markup, which stylesheet and which prompts go together.
//
// THE ONLY FILE THAT KNOWS ABOUT BOTH HALVES. theme.js holds the
// stylesheets; ledger's pages.js and beacon/pages.js hold the markup. They
// cannot be joined in theme.js, because chrome.js imports CSS_PATH from it —
// theme -> pages -> chrome -> theme is a require cycle, and Node resolves
// one by handing somebody a half-built module rather than by failing.
//
//     A CYCLE DOES NOT THROW. IT HANDS YOU AN EMPTY OBJECT
//     AND LETS YOU FIND OUT AT RENDER TIME.
//
// So the seam is here, and renderSite.js asks this file rather than knowing
// any structure's name.
//
// WHAT A STRUCTURE OWNS, AND WHAT IT DOES NOT
//
//   owns      the stylesheet, every class and id, the page builders, the
//             prompts the model is given
//   does not  the ring, the three-link body cap, the hero rotation, the
//             schema, the canonical, the Search Console tags, the legal
//             copy, which services exist, what a page is called
//
// Everything in the second column is a rule about the SITE. A structure that
// re-decided any of them would not be a second layout; it would be a second
// product wearing the first one's wizard.

'use strict';

const { STRUCTURES, DEFAULT_STRUCTURE, CSS_PATH } = require('./theme');

const ledgerPages = require('./pages');
const beaconPages = require('./beacon/pages');

const ledgerPrompt = require('../prompt');
const beaconPrompt = require('../prompt-beacon');

/** key -> the page builders and the prompts that belong to that stylesheet. */
const PARTS = {
  ledger: { pages: ledgerPages, prompt: ledgerPrompt },
  beacon: { pages: beaconPages, prompt: beaconPrompt },
};

/**
 * Everything one structure is, never undefined.
 *
 * FALLS BACK RATHER THAN THROWS, which is the opposite of what
 * normalizeSiteMode() does with a bad mode, on purpose. An unknown MODE must
 * not quietly build a different product; an unknown STRUCTURE is a cosmetic
 * choice, and refusing to build a paid-for site over a typo in a layout name
 * would be the worse failure.
 *
 * THE PARTS ARE LOOKED UP BY THE RESOLVED KEY, not by the string that came
 * in. `structureFor('beocn')` returns Ledger, and this has to return
 * LEDGER's pages with it — a stylesheet from one structure and markup from
 * another renders a page where every selector misses and nothing throws.
 */
function structureFor(key) {
  const theme = STRUCTURES[String(key || '').trim().toLowerCase()]
    || STRUCTURES[DEFAULT_STRUCTURE];

  const parts = PARTS[theme.key] || PARTS[DEFAULT_STRUCTURE];

  return { ...theme, ...parts };
}

/** The keys a wizard may offer, in the order they were built. */
function structureKeys() {
  return Object.keys(STRUCTURES).filter(key => PARTS[key]);
}

module.exports = { structureFor, structureKeys, PARTS, CSS_PATH, DEFAULT_STRUCTURE };
