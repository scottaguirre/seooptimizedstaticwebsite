// utils/localOptions/designs.js
//
// What "Design 1" and "Design 2" actually mean.
//
// ONE CHOICE, NOT THREE — Edwin, 30 October, having asked what a second
// design would change and been told "the photographs, and nothing else":
// "I want a different html structure, diferent css and different classes and
// prefix and css IDs, Different prompts. Keep the same sections."
//
// So a design is a package. Picking it picks the layout, the stylesheet, the
// class prefix, the ids, the voice the model writes in, and which four
// photographs the site gets — together, under one name, because a customer
// choosing between two sites is choosing between two things that look
// different, not between four independent switches.
//
//     THE WIZARD ASKS ONE QUESTION BECAUSE THERE IS ONE DECISION.
//
// THE COST, WRITTEN DOWN SO IT IS NOT REDISCOVERED. A Ledger site can only
// have photo set 1 and a Beacon site can only have set 2. That is the price
// of bundling and it was chosen deliberately. If a third set of photographs
// is ever added for Ledger, this file is where the knot comes undone — add
// a design, not a second dropdown.
//
// WHY THIS IS NOT IN structures.js. That file is about rendering: which
// markup goes with which stylesheet. This one is about the form: which
// label a human picks and what it resolves to. The renderer never sees a
// design id, and the wizard never sees a structure key.

'use strict';

/**
 * The designs, in the order the dropdown shows them.
 *
 * THE ID IS A STRING AND IT IS NOT THE INDEX. '1' and '2' are what a form
 * posts and what an old job payload may already carry; renumbering them
 * because a design was removed would re-point every stored site.
 */
const DESIGNS = [
  {
    id: '1',
    label: 'Design 1',
    structure: 'ledger',
    imageSet: 'set-1',
    note: 'Serif headings, a hairline between everything, services in a numbered list.',
  },
  {
    id: '2',
    label: 'Design 2',
    structure: 'beacon',
    imageSet: 'set-2',
    note: 'Sans headings on cards, a fact strip under the masthead, services as tiles.',
  },
];

/**
 * The design somebody picked, or null for "choose for me".
 *
 * NULL IS A REAL ANSWER AND THE DEFAULT ONE. It means the build falls back
 * to Ledger and to the automatic photograph pick, which hashes the business
 * name — the right behaviour for the six trades that have one set of
 * pictures and for anybody who does not care.
 *
 * AN UNKNOWN ID IS ALSO NULL, not a throw. A stale form, an old job payload
 * or a typed URL must not fail a build that is otherwise fine; it gets the
 * default, which is a site.
 */
function designFor(id) {
  const want = String(id == null ? '' : id).trim();

  if (!want) return null;

  return DESIGNS.find(d => d.id === want) || null;
}

/**
 * The structure and photo set a design means, ready to hand to the builder.
 *
 * RESOLVED IN ONE PLACE SO THE TWO CANNOT COME APART. Reading `structure`
 * here and `imageSet` somewhere else is how a Beacon site ends up with
 * Ledger's photographs — nothing fails, and the only sign is that the
 * second site looks like the first.
 */
function buildOptionsFor(id) {
  const design = designFor(id);

  return {
    design: design ? design.id : '',

    /* LEDGER WHEN NOBODY CHOSE. renderSite() would fall back to it anyway;
     * saying so here means the stored source records what was actually
     * used rather than an empty string nobody can interpret later. */
    structure: design ? design.structure : 'ledger',

    /* EMPTY MEANS AUTOMATIC — heroSet() then picks from the business name. */
    imageSet: design ? design.imageSet : '',
  };
}

module.exports = { DESIGNS, designFor, buildOptionsFor };
