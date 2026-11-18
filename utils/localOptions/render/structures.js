// utils/localOptions/render/structures.js
//
// Which markup, which stylesheet and which prompts go together.
//
// THE ONLY FILE THAT KNOWS ABOUT BOTH HALVES. theme.js holds the
// stylesheets; ledger's pages.js and each structure's own pages.js hold the
// markup. They
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
const anvilPages = require('./anvil/pages');
const quarryPages = require('./quarry/pages');
const harborPages = require('./harbor/pages');
const atlasPages = require('./atlas/pages');
const orchardPages = require('./orchard/pages');

const ledgerPrompt = require('../prompt');
const beaconPrompt = require('../prompt-beacon');
const anvilPrompt = require('../prompt-anvil');
const quarryPrompt = require('../prompt-quarry');
const harborPrompt = require('../prompt-harbor');
const atlasPrompt = require('../prompt-atlas');
const orchardPrompt = require('../prompt-orchard');

/** key -> the page builders and the prompts that belong to that stylesheet. */
const PARTS = {
  ledger: { pages: ledgerPages, prompt: ledgerPrompt },
  beacon: { pages: beaconPages, prompt: beaconPrompt },
  anvil: { pages: anvilPages, prompt: anvilPrompt },
  /* QUARRY IS REGISTERED AND NOT YET OFFERED, and those are two different
   * files on purpose. Being in here means `structure: 'quarry'` builds a
   * Quarry site — which is what makes it testable at all. What a human may
   * PICK is decided in designs.js, where Quarry's row is tagged to a mode
   * that has no wizard behind it yet.
   *
   *     A STRUCTURE NOBODY CAN RENDER IS A STRUCTURE NOBODY CAN TEST.
   *     SO IT IS REGISTERED FIRST AND OFFERED LAST. */
  quarry: { pages: quarryPages, prompt: quarryPrompt },

  /* HARBOR — the second of the five, and the first that is not a stack of
   * bands. Registered the same way and for the same reason: a structure
   * nobody can render is a structure nobody can test. What a human may
   * PICK is decided in designs.js. */
  harbor: { pages: harborPages, prompt: harborPrompt },

  /* ATLAS — the third of the five, and the first whose headings are not
   * above anything. Registered the same way and for the same reason: a
   * structure nobody can render is a structure nobody can test. What a
   * human may PICK is decided in designs.js. */
  atlas: { pages: atlasPages, prompt: atlasPrompt },

  /* ORCHARD — the fourth of the five, and the first that does not run
   * straight down the middle. Registered the same way and for the same
   * reason: a structure nobody can render is a structure nobody can test.
   * What a human may PICK is decided in designs.js. */
  orchard: { pages: orchardPages, prompt: orchardPrompt },
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
