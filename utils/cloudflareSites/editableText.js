// utils/cloudflareSites/editableText.js
//
// Which words of a stored site an owner may change, and putting their edits
// back.
//
//   collect(model)         -> [{ pageSlug, sectionKey, heading, paragraphs, ... }]
//   apply(model, edits)    -> { model, changed, rejected, blanked }
//
//
// SCOPE, AND HOW IT GREW
//
// Edwin, 7 November: *"For now, just paragraphs with the ability to insert a
// link. No business name, no phone number, no email change, no images"*.
//
// Edwin, 8 November, having used it: *"I should be able to update the H2 and
// h3 as well"* and *"I should be able to fix the trust list"*. So headings,
// subheadings and the ticked list are in; images, the business details and
// the address still are not.
//
// WHAT IS STILL OUT, AND WHY IT IS NOT AN OVERSIGHT
//
//   The hero H1 and its tagline. They are not stored copy. Every builder
//   computes them fresh — `businessName.toUpperCase()` and `location` — and
//   reuseModel.pageContent() reads back only section1..section9, so the hero
//   is never read at all. A box for it would accept an edit, save it, and be
//   overwritten by the next build. A control that silently does nothing is
//   worse than no control.
//
//   FAQ answers, pricing rows and reviews. Each is a panel of its own with a
//   rule of its own; their HEADINGS are editable here, because a heading is
//   a heading whatever sits underneath it.
//
//
// WHICH SECTIONS APPEAR AT ALL
//
// Read off the section, not off a list of types: a section is on the screen
// if it has paragraphs, OR a heading, OR a trust-point array. That gets the
// FAQ and Pricing blocks right — they carry a heading and nothing else this
// file touches — and it goes on being right on the day a section type is
// added, which a hard-coded list of types would not.
//
// A section with an empty heading and nothing else stays off the screen.
// Service Cards is the real example: contentModel stores `heading: ''` for
// it, so there is no text to change and no box is drawn. An empty box that
// writes into a template slot nobody fills is the hero problem again.
//
//
// THE EDITS ARE KEYED BY WHERE THEY CAME FROM, NOT BY POSITION
//
// A form that posted an array of paragraphs in order would be correct until
// the model changed underneath it — a page added, a section removed — and
// then it would write a town's copy into a service page with no error
// anywhere. Every edit names its page, its section and its index, and
// anything that does not match the model it is applied to is REFUSED and
// reported rather than guessed at.

'use strict';

const {
  safeParagraph,
  safeHeading,
  safeTrustPoint,
  forEditing,
} = require('./safeParagraph');

/**
 * The separator in a form field name.
 *
 * NOT BRACKETS. `p[slug][key][0]` makes express build nested objects, and a
 * page slug is attacker-adjacent text that would then become object keys —
 * `__proto__` among them. A flat name parsed here keeps the shape of the
 * payload under this file's control.
 *
 * `::` because a slug is `[a-z0-9-]` and a section key is `[A-Za-z0-9]`, so
 * neither can contain a colon and the split is unambiguous.
 */
const SEP = '::';

/**
 * The four kinds of box, each with its own prefix and its own sanitiser.
 *
 * ONE LETTER, because the prefix is the first thing parsed out of a posted
 * name and the parse has to be total: anything that is not one of these is
 * not ours and is ignored.
 *
 * PREFIX stays 'p' so that every paragraph field name this app has rendered
 * still means what it meant. A form left open in another tab when this
 * shipped posts paragraph names that still land where they did.
 */
const PREFIX = 'p';
const HEADING = 'h';
const SUBHEADING = 's';
const TRUST = 't';

/**
 * How many trust-point boxes the screen offers, always.
 *
 * EIGHT WHETHER OR NOT EIGHT ARE USED, which is what makes the list
 * addable-to rather than only editable: the empty boxes are the "add", and
 * emptying a full one is the "remove".
 *
 * Eight because buildTrustList() slices to eight and the About page's model
 * is stored `.slice(0, 8)`. A ninth box would offer something the renderer
 * throws away.
 */
const TRUST_SLOTS = 8;

/** `p::about::section1::0`, `h::about::section1`, `t::about::section1::3` */
function nameFor(kind, pageSlug, sectionKey, index) {
  const parts = [kind, pageSlug, sectionKey];
  if (undefined !== index && null !== index) parts.push(index);
  return parts.join(SEP);
}

/** The paragraph namer, kept at its old signature and its old output. */
function fieldName(pageSlug, sectionKey, index) {
  return nameFor(PREFIX, pageSlug, sectionKey, index);
}

function headingName(pageSlug, sectionKey) {
  return nameFor(HEADING, pageSlug, sectionKey);
}

function subheadingName(pageSlug, sectionKey) {
  return nameFor(SUBHEADING, pageSlug, sectionKey);
}

function trustName(pageSlug, sectionKey, index) {
  return nameFor(TRUST, pageSlug, sectionKey, index);
}

/**
 * The stored trust points, padded out to TRUST_SLOTS.
 *
 * PADDED FOR DISPLAY ONLY. The model never holds the blanks — apply() writes
 * back a compacted array — so this is the one place the two shapes differ,
 * and it differs in the direction the screen needs.
 */
function trustSlots(section) {
  if (!Array.isArray(section && section.trustPoints)) return null;

  const stored = section.trustPoints.map(p => String(p == null ? '' : p));
  const out = [];

  for (let i = 0; i < TRUST_SLOTS; i += 1) out.push(stored[i] || '');

  return out;
}

/**
 * @param {object} model  a parsed content.json
 * @returns {Array} one entry per section with something editable, in page order
 *
 * THE PAGE'S OWN ORDER IS KEPT. The edit screen reads top to bottom like the
 * site does, which is the only way somebody can find the sentence they want
 * to change.
 */
function collect(model) {
  const pages = (model && Array.isArray(model.pages)) ? model.pages : [];
  const out = [];

  for (const page of pages) {
    if (!page || !page.slug) continue;

    /* LEGAL PAGES ARE LEFT ALONE. Privacy policy, terms and accessibility
     * are generated from a template and say what they have to say; an owner
     * editing them by hand is a different feature with different advice
     * attached to it. */
    if ('legal' === page.type) continue;

    for (const section of (page.sections || [])) {
      if (!section || !section.key) continue;

      /* THE HERO IS SKIPPED BY NAME, and this is the one place a type is
       * named rather than read off the shape. Its heading and subheading
       * look exactly like every other section's, and they are the only ones
       * no builder reads back — see the note at the top of this file.
       * Nothing about the SHAPE of a hero section says that, so nothing
       * shape-based could have caught it. */
      if ('hero' === String(section.key)) continue;

      const paragraphs = Array.isArray(section.paragraphs) ? section.paragraphs : [];
      const heading = String(section.heading || '');
      const subheading = String(section.subheading || '');
      const trust = trustSlots(section);

      if (!paragraphs.length && !heading && !trust) continue;

      out.push({
        pageSlug: String(page.slug),
        pageTitle: String(page.title || page.slug),
        pageType: String(page.type || ''),
        sectionKey: String(section.key),
        sectionLabel: String(section.label || section.key),

        /* A BOX ONLY WHERE THERE IS TEXT ALREADY. An empty heading means
         * this section's template has no slot for one — writing into it
         * would be an edit the page never shows. */
        /* DECODED FOR THE BOX, AND THIS IS NOT COSMETIC.
         *
         * What is stored is escaped, because the templates write it out raw.
         * Putting the STORED value in the textarea meant somebody who typed
         * "I'm" got `I&#39;m` back, posted it, and had it escaped again —
         * one more layer per save, until the published page was showing the
         * entity to visitors. Escaping is not idempotent, so the round trip
         * has to undo it. See forEditing().
         *
         * The emptiness test above still uses the STORED value: whether a
         * heading exists is a question about the model, not about how it
         * looks in a box. */
        heading: forEditing(heading),
        headingField: heading ? headingName(page.slug, section.key) : null,

        subheading: forEditing(subheading),
        subheadingField: subheading ? subheadingName(page.slug, section.key) : null,

        paragraphs: paragraphs.map(forEditing),

        /* null, NOT [], when the section has no list. The screen tests this
         * to decide whether to draw the block at all, and an empty array is
         * a list of nothing rather than the absence of a list. */
        trustPoints: trust,

        /* The ticked list is NOT decoded: it is never escaped on the way in,
         * because both of its renderers escape on the way out. Running it
         * through forEditing would turn an owner's literal "&amp;" into "&"
         * on the first save. See safeTrustPoint. */
        /* HOW MANY PARAGRAPHS COME BEFORE THE LIST, because on the page the
         * list is not after the paragraphs — it is BETWEEN them:
         *
         *     <h2>{{SECTION1_H2}}</h2>
         *     <h3>{{SECTION1_H3}}</h3>
         *     <p>{{SECTION1_P1}}</p>
         *     {{SECTION1_LIST}}          <-- here
         *     <p>{{SECTION1_P2}}</p>
         *
         * — src/aboutUsTemplate.html, the only template with a list slot.
         *
         * The first version of the edit screen drew both paragraphs and then
         * the list, which reads as a different page from the one it edits.
         * Edwin, 8 November: *"There is a paragraph before the trust list and
         * then after the trust list in the actual front end website. In the
         * edit screen the 2 paragraphs are one after the other one and then
         * the trust list."*
         *
         *     A SCREEN FOR EDITING A PAGE HAS ONE JOB BEYOND SAVING: TO LOOK
         *     LIKE THE PAGE. Out of order, every box has to be identified by
         *     reading it, which is the work the screen was supposed to save.
         *
         * Carried here rather than hard-coded into the route because it is a
         * fact about the template, and this file is where the other facts
         * about the renderers already live. 0 when the section has no
         * paragraphs at all, so the list leads. */
        trustAfterParagraph: trust ? Math.min(1, paragraphs.length) : null,
      });
    }
  }

  return out;
}

/** Every field name this model would produce, for a quick membership test. */
function fieldNames(model) {
  const names = new Set();

  for (const entry of collect(model)) {
    entry.paragraphs.forEach((_, i) => names.add(fieldName(entry.pageSlug, entry.sectionKey, i)));

    if (entry.headingField) names.add(entry.headingField);
    if (entry.subheadingField) names.add(entry.subheadingField);

    if (entry.trustPoints) {
      for (let i = 0; i < TRUST_SLOTS; i += 1) {
        names.add(trustName(entry.pageSlug, entry.sectionKey, i));
      }
    }
  }

  return names;
}

/** The section a posted name points at, or null. */
function locate(model, pageSlug, sectionKey) {
  const page = (model.pages || []).find(p => p && String(p.slug) === pageSlug);
  if (!page) return null;

  return (page.sections || []).find(s => s && String(s.key) === sectionKey) || null;
}

/**
 * Put posted edits back into a model.
 *
 * @param {object} model  parsed content.json — NOT mutated
 * @param {object} posted req.body, as a flat map of fieldName -> text
 *
 * @returns {{model, changed, rejected, blanked}}
 *
 * A COPY, NOT A MUTATION. The caller holds the stored model and writes the
 * result back only if the whole apply succeeded; editing in place would mean
 * a half-applied edit on any throw, with the row already carrying it.
 *
 * EVERY FIELD GOES THROUGH A SANITISER, AND NOT THE SAME ONE. runGeneration
 * writes paragraphs and headings into the template with a plain .replace()
 * and no escaping, so those are escaped here. The trust list is escaped by
 * both of its renderers instead, so escaping it here too would double it —
 * see safeTrustPoint's note.
 */
function apply(model, posted) {
  const next = JSON.parse(JSON.stringify(model || {}));

  const valid = fieldNames(next);

  const changed = [];
  const rejected = [];
  const blanked = [];

  for (const [name, raw] of Object.entries(posted || {})) {
    const [kind, pageSlug, sectionKey, indexText] = String(name).split(SEP);

    if (![PREFIX, HEADING, SUBHEADING, TRUST].includes(kind)) continue;

    /* NAMED, NOT POSITIONAL, AND CHECKED AGAINST THIS MODEL. A field for a
     * page or a section that is not here came from a form built against a
     * different version of the site — a stale tab, most likely. Writing it
     * somewhere approximate is how a town's copy ends up on a service
     * page. */
    if (!valid.has(name)) { rejected.push(name); continue; }

    /* The list is written as a whole, below, because emptying one box
     * renumbers the rest. Its names are checked here so that a stale one is
     * still reported rather than quietly dropped. */
    if (TRUST === kind) continue;

    const section = locate(next, pageSlug, sectionKey);

    if (PREFIX === kind) {
      const index = Number(indexText);
      const before = String(section.paragraphs[index]);
      const after = safeParagraph(raw);

      /* AN EMPTIED PARAGRAPH IS REFUSED, NOT APPLIED.
       *
       * The templates fill a fixed number of slots — {{SECTION1_P1}} and
       * {{SECTION1_P2}} both exist, and a section whose second paragraph is
       * '' renders an empty <p> rather than reflowing. Deleting copy is a
       * different feature from editing it, and this one is not it.
       *
       * Reported rather than silently kept, so the screen can say which box
       * was emptied instead of appearing to lose the edit. */
      if (!after.trim()) { blanked.push(name); continue; }

      if (after !== before) {
        section.paragraphs[index] = after;
        changed.push({ name, pageSlug, sectionKey, index });
      }

      continue;
    }

    /* A HEADING EMPTIED IS REFUSED, FOR A HARDER REASON THAN A PARAGRAPH.
     * buildAboutUsPage checks `section1.heading` and logs an error without
     * it, and both it and buildLocationPages call `.toUpperCase()` on the
     * value as they write it out. An empty heading is an empty <h2> on the
     * page today and a thrown TypeError one refactor away. */
    const key = (HEADING === kind) ? 'heading' : 'subheading';
    const before = String(section[key] || '');
    const after = safeHeading(raw);

    if (!after) { blanked.push(name); continue; }

    if (after !== before) {
      section[key] = after;
      changed.push({ name, pageSlug, sectionKey, field: key });
    }
  }

  applyTrust(next, posted, changed);

  return { model: next, changed, rejected, blanked };
}

/**
 * The ticked list, written as a whole.
 *
 * WHY NOT ONE BOX AT A TIME. Emptying the third of eight removes a bullet
 * and the ones below it move up, so an index-by-index write would either
 * leave a hole in the stored array or renumber it halfway through its own
 * loop. The list is small and bounded; reading all eight slots and writing
 * the result once is both simpler and the only version that is correct.
 *
 * A BLANK SLOT IS AN INSTRUCTION, NOT A MISTAKE — the opposite of a blanked
 * paragraph. buildTrustList filters falsy entries and the list reflows, so
 * emptying a box is how a claim is removed and typing into an empty one is
 * how a claim is added. That is the whole reason the screen draws eight.
 *
 * A SLOT THAT WAS NOT POSTED KEEPS WHAT IS STORED. Only a box that actually
 * came back empty removes anything — otherwise a truncated or filtered POST
 * would silently delete the list, which is the exact failure this change was
 * written to repair.
 */
function applyTrust(model, posted, changed) {
  for (const entry of collect(model)) {
    if (!entry.trustPoints) continue;

    const names = [];
    for (let i = 0; i < TRUST_SLOTS; i += 1) {
      names.push(trustName(entry.pageSlug, entry.sectionKey, i));
    }

    if (!names.some(n => Object.prototype.hasOwnProperty.call(posted || {}, n))) continue;

    const nextList = [];

    names.forEach((n, i) => {
      const value = Object.prototype.hasOwnProperty.call(posted, n)
        ? safeTrustPoint(posted[n])
        : String(entry.trustPoints[i] || '');

      if (value) nextList.push(value);
    });

    const section = locate(model, entry.pageSlug, entry.sectionKey);
    const before = (section.trustPoints || []).map(String);

    if (before.length === nextList.length && before.every((v, i) => v === nextList[i])) continue;

    section.trustPoints = nextList;

    changed.push({
      name: [TRUST, entry.pageSlug, entry.sectionKey].join(SEP),
      pageSlug: entry.pageSlug,
      sectionKey: entry.sectionKey,
      field: 'trustPoints',
      count: nextList.length,
    });
  }
}

module.exports = {
  collect, apply, fieldNames,
  fieldName, headingName, subheadingName, trustName, nameFor,
  SEP, PREFIX, HEADING, SUBHEADING, TRUST, TRUST_SLOTS,
};
