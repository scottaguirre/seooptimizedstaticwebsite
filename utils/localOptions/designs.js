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
/* EVERY DESIGN NAMES THE MODE IT BELONGS TO — 17 November.
 *
 * Edwin, planning five NEW layouts for the automated Cloudflare mode that
 * share nothing with these: *"can we just show each group of designs mapped
 * out to either github/cloudflare so the user never has to worry about
 * mixing them up?"*
 *
 * The alternative was one list and a careful customer. `structureFor()`
 * FALLS BACK rather than throwing — deliberately, see its note — so picking
 * a Cloudflare layout on the GitHub wizard would not fail. It would quietly
 * build Ledger, and the only sign would be that the site looked like the
 * last one.
 *
 *     A WRONG CHOICE THAT STILL BUILDS SOMETHING IS WORSE THAN ONE THAT
 *     REFUSES. The fix is not a warning; it is not offering it.
 *
 * So the list is filtered on the server, in formRoute.js, and the browser on
 * /github-sites is never told the other designs exist. */
/* THE MODE THE FIVE NEW LAYOUTS BELONG TO, AS A STRING AND NOT YET AS A
 * seoPresets MODE.
 *
 * It is deliberately NOT added to seoPresets.MODES today. normalizeSiteMode()
 * resolves anything it does not know to 'lead'; the moment this string is in
 * that table it becomes a siteMode a job can carry, and it would then be let
 * through pricing.js, contentModel.js and jobGenerator — none of which have a
 * branch for it.
 *
 *     A MODE THAT EXISTS IN THE TABLE AND NOWHERE ELSE IS NOT A
 *     HALF-FINISHED MODE. IT IS A JOB THAT BUILDS THE WRONG PRODUCT.
 *
 * Here it is only a TAG. The day the mode is real, this constant becomes an
 * import of MODES.CLOUDFLARE_SITES and this comment goes with it. */
const CF_MODE = 'cloudflaresites';

/* A DESIGN BELONGS TO A LIST OF DOORS, NOT TO ONE — 18 November.
 *
 * Edwin, having asked whether the Cloudflare door could reuse the layouts
 * and the photographs the GitHub sites already have: *"that way cloudflare
 * sites will have 7 html structure and 7 set of images"*. Then, when asked
 * about the duplication that allows: *"If we do the 7 cloudflare sites
 * structures and images probably I wont use the github option to build
 * sites... right now I dont want you to delete the github options but dont
 * worry about cloudflare duplicating a site from github."*
 *
 * So Ledger, Beacon and Anvil now carry BOTH doors, and the Cloudflare list
 * runs 1 to 7 — Ledger/set-1 through Orchard/set-7 — while the GitHub list
 * is the same three rows it always was.
 *
 * ONE ROW, NOT A COPY OF IT. The alternative was a second Ledger row with a
 * new id for the Cloudflare door. That puts the structure-and-set pairing in
 * two places, which is the exact failure the note at the top of this file
 * is about: the two copies drift and a site gets the other one's
 * photographs. A design is a package, and a package offered at two doors is
 * still one package.
 *
 * THE DUPLICATION IS REAL AND IT IS ALLOWED. A Cloudflare site and a GitHub
 * site can now come out identical — same markup, same photographs, same
 * voice. Edwin took that trade knowingly, because he is moving to
 * Cloudflare and the GitHub door is being left standing rather than used.
 * It is written down here so nobody "fixes" it later.
 *
 * WHAT THIS IS NOT. It is not a second dropdown. The layout and the photo
 * set are still chosen together under one name; see the file header for why
 * that matters. */
const DESIGNS = [
  {
    id: '1',
    modes: ['localoptions', CF_MODE],
    label: 'Design 1',
    structure: 'ledger',
    imageSet: 'set-1',
    note: 'Serif headings, a hairline between everything, services in a numbered list.',
  },
  {
    id: '2',
    modes: ['localoptions', CF_MODE],
    label: 'Design 2',
    structure: 'beacon',
    imageSet: 'set-2',
    note: 'Sans headings on cards, a fact strip under the masthead, services as tiles.',
  },
  {
    id: '3',
    modes: ['localoptions', CF_MODE],
    label: 'Design 3',
    structure: 'anvil',
    imageSet: 'set-3',
    note: 'Dark throughout, the headline over the photograph, services as a stacked ladder.',
  },

  /* QUARRY — the first of the five written for the automated Cloudflare
   * mode, and the first row in this file that no wizard offers.
   *
   * THE id IS '4' AND IT KEEPS COUNTING THROUGH BOTH MODES. The ids are what
   * a form posts and what a stored job payload carries, so they have to be
   * unique across the whole file rather than per mode — '1' meaning Ledger on
   * one wizard and something else on another is a stored source nobody can
   * read back. See the note on the list above.
   *
   * set-4 EXISTS FOR plumbing AND NOWHERE ELSE, which is fine and is not
   * this file's problem. available() in generate.js already refuses a set
   * the chosen trade does not have and falls back to the automatic pick —
   * written on 30 October for "Design 2 chosen alongside roofing", and it
   * covers this for the same reason.
   *
   *     A DESIGN NAMES A SET. WHETHER THAT TRADE HAS IT IS A QUESTION
   *     ABOUT FOLDERS, AND THE BUILD IS WHERE IT GETS ASKED.
   *
   * ⚠ IT WAS LENT TO `localoptions` FOR ONE HOUR ON 17 NOVEMBER so Quarry
   * could be tested through the only wizard that existed, and Edwin took it
   * straight back out: *"but remember I do not want that for github it's for
   * clouldflare"*.
   *
   *     QUARRY IS NOT A GITHUB LAYOUT. A test route that puts it in the
   *     GitHub wizard is not a shortcut to testing it, it is a different
   *     product briefly wearing its markup.
   *
   * It is tested by tools/preview-structure.js until the Cloudflare mode
   * exists, and it goes live through that mode and no other. DO NOT PUT IT
   * BACK IN `localoptions` TO SEE IT WORKING. */
  {
    id: '4',
    modes: [CF_MODE],
    label: 'Design 4',
    structure: 'quarry',
    imageSet: 'set-4',
    note: 'Stone and moss, square corners, the headline above the photograph, '
      + 'services as a sticky index.',
  },

  /* HARBOR — the second of the five. Everything the row above says applies:
   * the id keeps counting through both modes, and set-5 exists for no trade
   * yet, which available() in generate.js already handles by falling back
   * to the automatic pick. */
  {
    id: '5',
    modes: [CF_MODE],
    label: 'Design 5',
    structure: 'harbor',
    imageSet: 'set-5',
    note: 'Navy rail down the side carrying the phone, the hours and the '
      + 'services, on screen the whole way down.',
  },

  /* ATLAS — the third of the five. Everything the Quarry row above says
   * applies: the id keeps counting through both modes, and set-6 exists for
   * no trade yet, which available() in generate.js already handles by
   * falling back to the automatic pick.
   *
   * THE NOTE SAYS WHAT A PERSON WOULD SEE, not what the markup does. The
   * first draft read "each section is a two-column grid with the heading in
   * column one", which is true and tells a buyer nothing. */
  {
    id: '6',
    modes: [CF_MODE],
    label: 'Design 6',
    structure: 'atlas',
    imageSet: 'set-6',
    note: 'A reference page: every heading sits in the left margin beside '
      + 'its own text, services as a numbered table.',
  },

  /* ORCHARD — the fourth of the five. Everything the Quarry row above says
   * applies: the id keeps counting through both modes, and set-7 exists for
   * no trade yet, which available() in generate.js already handles by
   * falling back to the automatic pick.
   *
   * THE NOTE SAYS WHAT A PERSON WOULD SEE. "Sections offset to alternating
   * sides" is what the markup does; "leans left and right down the page" is
   * what a buyer is looking at. */
  {
    id: '7',
    modes: [CF_MODE],
    label: 'Design 7',
    structure: 'orchard',
    imageSet: 'set-7',
    note: 'Soft green cards that lean left and right down the page, '
      + 'services as a numbered grid, opening hours as chips.',
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
function designFor(id, mode) {
  const want = String(id == null ? '' : id).trim();

  if (!want) return null;

  const found = DESIGNS.find(d => d.id === want) || null;

  if (!found) return null;

  /* A DESIGN FROM ANOTHER MODE IS AN UNKNOWN DESIGN — 17 November, found
   * while registering Quarry.
   *
   * designsFor() filters what the DROPDOWN offers, and formRoute.js does
   * that on the server, so the GitHub wizard is never told the Cloudflare
   * layouts exist. That is the whole of the protection, and it is a
   * protection against a confused customer rather than against a posted
   * field. `design=4` typed into the request builds a Quarry site in
   * localoptions mode with a photo set that does not exist — and
   * runLocalOptions.js would not refuse it, because its own guard is about
   * the siteMode, which is perfectly valid.
   *
   *     FILTERING A DROPDOWN IS NOT VALIDATING A FIELD.
   *     THE LIST THE FORM DREW IS NOT THE LIST THE SERVER WAS SENT.
   *
   * `mode` IS OPTIONAL, AND OMITTING IT MEANS "ANY" rather than "none". The
   * logo preview resolves a structure for colouring and has no business
   * knowing about modes; adding a required argument would have made every
   * existing caller say something it does not know. */
  const want_mode = String(mode == null ? '' : mode).trim();

  /* MEMBERSHIP, NOT EQUALITY — 18 November, when Ledger, Beacon and Anvil
   * gained the Cloudflare door as well as their own. `found.mode !==
   * want_mode` was the test before, and against a row carrying a LIST it
   * compares a string to an array: never equal, so every shared design
   * would be refused at both doors and every build would fall back to
   * Ledger. Silently, because that is what the fallback is for. */
  if (want_mode && !modesOf(found).includes(want_mode)) return null;

  return found;
}

/**
 * The doors one design row is offered at.
 *
 * TOLERANT OF THE OLD SHAPE ON PURPOSE. A row written `mode: 'localoptions'`
 * still answers correctly here, so a design added from memory of the old
 * file is offered rather than quietly offered nowhere — which is the failure
 * this whole file exists to prevent.
 *
 * AND IT TAKES A ROW, NOT A MAYBE-ROW. The first version opened with
 * `if (!row) return []`, which no caller can reach — designFor() has already
 * returned on a missing row and designsFor() walks a literal array. A mutant
 * made that branch claim a door and survived every suite, because nothing
 * can call it. An untestable branch is somewhere a mutant lives forever, so
 * it is gone rather than pinned.
 */
function modesOf(row) {
  if (Array.isArray(row.modes)) return row.modes;

  return row.mode ? [row.mode] : [];
}

/**
 * The structure and photo set a design means, ready to hand to the builder.
 *
 * RESOLVED IN ONE PLACE SO THE TWO CANNOT COME APART. Reading `structure`
 * here and `imageSet` somewhere else is how a Beacon site ends up with
 * Ledger's photographs — nothing fails, and the only sign is that the
 * second site looks like the first.
 */
function buildOptionsFor(id, mode) {
  const design = designFor(id, mode);

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

/**
 * The designs one mode offers, in the order the dropdown shows them.
 *
 * A MODE WITH NO DESIGNS GETS AN EMPTY LIST, not every design. The wizard
 * draws no dropdown at all then, which is the honest answer for a mode that
 * has no layouts yet — and the state the new Cloudflare mode will be in on
 * the morning its first layout is being written.
 *
 * AN UNKNOWN MODE ALSO GETS NOTHING, for the same reason designFor()
 * returns null for an unknown id: a stale page or a typed URL must not be
 * handed a list belonging to some other product.
 *
 * @param {string} mode
 * @returns {object[]} the matching rows, never undefined
 */
function designsFor(mode) {
  const want = String(mode == null ? '' : mode).trim();

  if (!want) return [];

  /* IN FILE ORDER, WHICH IS WHY THE CLOUDFLARE LIST READS 1 TO 7. The three
   * shared rows sit at the top of the file where they always have, so both
   * doors show them first and in the same order. Sorting here instead would
   * be a second place that decides what a customer sees. */
  return DESIGNS.filter(d => modesOf(d).includes(want));
}

/**
 * Which list of designs a door offers, and the build resolves against.
 *
 * ⚠ THE BUG THIS EXISTS FOR SHIPPED, AND EDWIN FOUND IT BY LOOKING AT THE
 * SITE — 17 November: *"but this is a copy of design 1. i thoght design 4
 * was different"*.
 *
 * It was. /local-automation offered Design 4 because the ROUTE asked
 * designsFor(CF_MODE). The build then resolved it with
 * buildOptionsFor(design, siteMode) — and that door's siteMode is
 * `localoptions`, so the mode guard refused the row, buildOptionsFor
 * returned the default, and structureFor() fell back to Ledger.
 *
 *     ONE DECISION ASKED WITH TWO DIFFERENT KEYS. The form offered a
 *     layout the build could not look up, and nothing failed: the guard
 *     did exactly what it was written to do, the fallback did exactly what
 *     it was written to do, and the customer got Design 1.
 *
 * THE FALLBACK IS WHY IT WAS SILENT, and it stays. structureFor()'s own
 * note explains it: refusing to build a paid-for site over a typo in a
 * layout name is the worse failure. A fallback can only be safe if nothing
 * reaches it by accident — so the answer is not to remove it, it is to stop
 * asking the question two ways.
 *
 * SO THIS IS THE ONLY PLACE THE KEY IS DERIVED. routes/formRoute.js uses it
 * to decide what to offer and utils/runLocalOptions.js uses it to resolve
 * what was picked. A second copy is how the two come apart again.
 *
 * @param {string} [siteMode]    the builder: 'localoptions', 'lead', …
 * @param {string} [siteTarget]  the destination: 'cloudflare' or ''
 * @returns {string} the mode to pass to designsFor() / buildOptionsFor()
 */
function designsKeyFor({ siteMode = '', siteTarget = '' } = {}) {
  const mode = String(siteMode == null ? '' : siteMode).trim();
  const target = String(siteTarget == null ? '' : siteTarget).trim();

  /* THE ONE PAIRING THAT IS NOT ITS OWN MODE. Cloudflare Local Automation
   * runs the Local Website Options builder and sends it to Cloudflare, and
   * its layouts are the five written for it — never Ledger, Beacon or
   * Anvil, and never offered on /github-sites. */
  if ('localoptions' === mode && 'cloudflare' === target) return CF_MODE;

  return mode;
}

module.exports = {
  DESIGNS, designFor, designsFor, buildOptionsFor, designsKeyFor, CF_MODE,
};
