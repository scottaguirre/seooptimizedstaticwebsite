// utils/cloudflareSites/localOptionsText.js
//
// Which words of a stored Local Website Options site an owner may change,
// and putting their edits back.
//
//   collect(source)        -> [{ pageSlug, sectionKey, heading, paragraphs, ... }]
//   apply(source, edits)   -> { source, changed, rejected, blanked }
//
// THE SIBLING OF editableText.js, NOT A REPLACEMENT FOR IT
//
// That file reads a contentModel: pages with typed sections, written by
// runGeneration.js. This one reads the object generate.js handed to
// renderSite() and runLocalOptions.js wrote to _src/localoptions.json. They
// are different shapes for different builders and neither can read the
// other, which is why capture() keeps whichever it found and the screen
// asks siteStore.isLocalOptions() which one it is holding.
//
//     ONE FORM, TWO READERS. The boxes are the same boxes; what differs
//     is where the text comes from and how it is stored.
//
//
// THE ONE DIFFERENCE THAT WILL BITE SOMEBODY: ESCAPING RUNS THE OTHER WAY
//
// editableText.js decodes on the way to the box and the stored value is
// ESCAPED, because the generator's templates write it out raw. Here it is
// the opposite — nothing is escaped going in, because every renderer in
// utils/localOptions/render/ escapes on the way out:
//
//     <title>${esc(title)}</title>          chrome.js
//     <h2>${esc(copy.aboutHeading)}</h2>    pages.js
//     <p>${richText(p)}</p>                 richText() escapes first
//
// So the stored words are exactly what the model wrote and exactly what the
// owner types. Running them through an escape here would publish `I&#39;m`
// to a visitor, and running them through a DECODE would turn a literal
// ampersand into whatever followed it.
//
//     ESCAPING IS NOT IDEMPOTENT, AND NEITHER IS DECODING.
//     THE SIDE THAT ESCAPES IS THE SIDE THAT MUST NOT BE COPIED.
//
// LINKS ARE MARKDOWN HERE, NOT ANCHORS. richText() turns `[label](url)` into
// an <a>, and leaves a disallowed scheme on the page as the owner typed it.
// safeParagraph() — which rewrites real <a> tags — belongs to the other
// format and is deliberately not used.
//
//
// WHAT IS IN, AND WHY SEO IS IN FROM THE START
//
// Edwin, 19 November, asked whether the edit screen would cover the SEO
// title and meta description, and the answer on the generator side is no:
// rankFastIndexMeta() BUILDS those from the business name and the phone, so
// an edited one would be overwritten by the next render. In this mode they
// are model-written and stored, so an edit sticks. They are a property of
// the PAGE rather than of a section, which is the one shape the existing
// form did not already have.
//
// Out, for the same reasons as the other reader: the business details, the
// images, and every H1. The home H1 is computed by homeHeading(business),
// the service H1 falls back to the service name, and a box for either would
// accept an edit and lose it on the next render.

'use strict';

const { nameFor, SEP, PREFIX, HEADING } = require('./editableText');

/**
 * The two kinds this reader adds, and they are UPPERCASE ON PURPOSE.
 *
 * nameFor() joins kind, page and section with '::', so a kind that collided
 * with one of the existing lower-case letters would produce a field name
 * that both readers would answer to. Only one of them is ever loaded for a
 * given site — but "only one is loaded" is a fact about today's routing, and
 * a name that is unambiguous needs no such fact to stay correct.
 */
const SEO_TITLE = 'T';
const SEO_META = 'M';

/**
 * The section key the two page-level boxes live under.
 *
 * THEY ARE NOT A SECTION AND THIS IS A LIE OF CONVENIENCE, stated so nobody
 * goes looking for the section it names. The field-name format is
 * `kind::page::section`, the form posts a flat map of those names, and
 * giving the page-level boxes a reserved section costs one constant while
 * inventing a second name format would cost a second parser.
 */
const SEO_SECTION = 'seo';

/** Cheap, and it keeps every slot's value a string. */
const text = (value) => String(value == null ? '' : value);

/**
 * The pages of a stored source, in the order they appear on the site.
 *
 * READ OFF THE SOURCE, NOT OFF A LIST OF ELEVEN. The mode builds a fixed
 * eleven pages, but three of those are legal boilerplate with no model
 * copy in them at all and the services are however many the source holds.
 * A hard-coded list would be a second statement of the same fact, wrong the
 * first time a service is dropped.
 *
 * THE THREE LEGAL PAGES ARE ABSENT BY CONSTRUCTION rather than filtered
 * out: they carry no entry in the source because nothing wrote one.
 */
function pagesOf(source) {
  const out = [];

  if (source && source.home) {
    out.push({ slug: 'index', label: 'Home', copy: source.home, kind: 'home' });
  }

  for (const service of (source && source.services) || []) {
    if (!service || !service.slug) continue;

    out.push({
      slug: String(service.slug),
      label: text(service.name) || String(service.slug),
      copy: service,
      kind: 'service',
    });
  }

  if (source && source.contact) {
    out.push({ slug: 'contact', label: 'Contact', copy: source.contact, kind: 'contact' });
  }

  return out;
}

/**
 * The divider lines a structure asked for, by key.
 *
 * EVERY STRUCTURE HAS ITS OWN AND SOME HAVE NONE. Harbor asks for
 * firstBreak and secondBreak, Beacon for two of its own, Anvil for none at
 * all — so this reads whatever string fields the home copy actually holds
 * rather than naming them. `about` is excluded because it is an array and
 * has its own slot; the SEO pair and the fields the renderer computes are
 * excluded by name.
 *
 * WHY IT MATTERS MORE THAN IT LOOKS: two of the faults found on the first
 * live batch are divider lines — Harbor's second one repeating the intro's
 * exclusions, Beacon's two both landing on "unit". With a box, those are a
 * typing correction instead of a rebuild.
 */
const NOT_A_BREAK = new Set([
  'title', 'meta', 'aboutHeading', 'about', 'sub', 'h1',
  'name', 'slug', 'blurb', 'sections', 'ready', 'servicesLede',
]);

function breakKeysOf(copy) {
  return Object.keys(copy || {})
    .filter(key => !NOT_A_BREAK.has(key))
    .filter(key => 'string' === typeof copy[key])
    .sort();
}

/**
 * One slot, in the shape the edit form already draws.
 *
 * THE SAME KEYS AS editableText.collect() RETURNS, because renderSections()
 * in utils/editForm.js takes these and does not care which reader built
 * them. A slot shaped differently would mean a second form.
 */
function slot({ page, sectionKey, sectionLabel, heading, headingField, headingLabel,
  paragraphs, fields }) {
  return {
    pageSlug: page.slug,
    pageTitle: page.label,
    pageType: page.kind,
    sectionKey,
    sectionLabel,

    heading: text(heading),
    headingField: headingField || null,

    /* WHAT THE BOX IS CALLED ON SCREEN. The form says "Heading" when a
     * block does not name one, which is right for every section and wrong
     * for the search title — a box labelled Heading invites an H2. */
    headingLabel: headingLabel || 'Heading',

    subheading: '',
    subheadingField: null,

    paragraphs: (paragraphs || []).map(text),

    /* THE FIELD NAME PER PARAGRAPH, which the other reader derives from the
     * index because its paragraphs are always a contiguous array. Here a
     * slot can be one string pulled out of a named key — a divider line, the
     * services lede — so the names are carried rather than recomputed. */
    paragraphFields: fields || [],

    /* null, NOT [], and the screen tests this to decide whether to draw the
     * block at all. Neither list this mode has — the ticked points and the
     * contact page's "ready" lines — is editable yet, and an empty array
     * would draw eight empty boxes that save nowhere. */
    trustPoints: null,
    reviews: null,
  };
}

/**
 * Every editable slot in a stored source.
 *
 * @param {object} source  a parsed _src/localoptions.json
 * @returns {Array} slots, in page order
 */
function collect(source) {
  const out = [];

  for (const page of pagesOf(source)) {
    const copy = page.copy || {};

    /* THE SEO PAIR FIRST, ON EVERY PAGE, WHETHER OR NOT IT IS SET.
     *
     * The other reader's rule is "a box only where there is text already",
     * because an empty heading there means the template has no slot for one
     * and writing into it would be an edit the page never shows. That
     * reasoning does not carry: every page in this mode HAS a <title> and a
     * description, and pages.js falls back to a computed string when the
     * stored one is empty. So an empty box here is an invitation, not a
     * control that does nothing. */
    out.push(slot({
      page,
      sectionKey: SEO_SECTION,
      sectionLabel: 'Search result',
      heading: copy.title,
      headingLabel: 'Search title',
      headingField: nameFor(SEO_TITLE, page.slug, SEO_SECTION),
      paragraphs: [copy.meta],
      fields: [nameFor(SEO_META, page.slug, SEO_SECTION)],
    }));

    if ('home' === page.kind) {
      const about = Array.isArray(copy.about) ? copy.about : [];

      if (about.length || copy.aboutHeading) {
        out.push(slot({
          page,
          sectionKey: 'about',
          sectionLabel: 'About the business',
          heading: copy.aboutHeading,
          headingField: nameFor(HEADING, page.slug, 'about'),
          paragraphs: about,
          fields: about.map((_, i) => nameFor(PREFIX, page.slug, 'about', i)),
        }));
      }

      /* THE SERVICES LEDE, WHICH IS WHERE "Each opens onto…" LIVES.
       *
       * undefined means the structure never asked for one; an empty string
       * means the owner cleared it and the renderer prints nothing. Both
       * are honoured by pages.js and neither is a reason to hide the box,
       * so the test is on the KEY rather than on the value. */
      if (undefined !== copy.servicesLede) {
        out.push(slot({
          page,
          sectionKey: 'servicesLede',
          sectionLabel: 'Line above the services',
          paragraphs: [copy.servicesLede],
          fields: [nameFor(PREFIX, page.slug, 'servicesLede', 0)],
        }));
      }

      for (const key of breakKeysOf(copy)) {
        out.push(slot({
          page,
          sectionKey: key,
          sectionLabel: 'Divider line',
          paragraphs: [copy[key]],
          fields: [nameFor(PREFIX, page.slug, key, 0)],
        }));
      }
    }

    if ('service' === page.kind) {
      const sections = Array.isArray(copy.sections) ? copy.sections : [];

      for (const [i, section] of sections.entries()) {
        const paragraphs = Array.isArray(section && section.paragraphs)
          ? section.paragraphs
          : [];

        const heading = text(section && section.heading);

        if (!paragraphs.length && !heading) continue;

        const key = `section${i + 1}`;

        out.push(slot({
          page,
          sectionKey: key,
          sectionLabel: `Section ${i + 1}`,
          heading,

          /* A HEADING BOX ONLY WHERE THERE IS A HEADING, and here the other
           * reader's rule DOES carry. prompt.js asks for the first section's
           * heading to be empty — "No heading. Two or three paragraphs that
           * enter the page…" — so that section has no slot in the template
           * and text typed into one would never appear. */
          headingField: heading ? nameFor(HEADING, page.slug, key) : null,

          paragraphs,
          fields: paragraphs.map((_, n) => nameFor(PREFIX, page.slug, key, n)),
        }));
      }
    }
  }

  return out;
}

/**
 * Put an owner's edits back into a stored source.
 *
 * A COPY IS RETURNED AND THE ARGUMENT IS NOT TOUCHED. The caller holds the
 * version it read from Mongo and may need it again — to diff, to log, or
 * because the re-render after this failed and the row must not already be
 * carrying words that were never published.
 *
 * THE RETURN SHAPE IS editableText.apply's, DOWN TO THE KEY NAMES — `model`
 * rather than `source`, and ARRAYS of field names rather than counts. The
 * handler calls one or the other and then treats the answer identically; a
 * second shape would put a branch in every line after the call, and
 * `applied.changed.length` on a number is 0 with no error anywhere.
 *
 *     A NEAR-MISS SHAPE IS WORSE THAN A DIFFERENT ONE.
 *     IT FAILS QUIETLY AND IN THE RIGHT-LOOKING DIRECTION.
 *
 * @param {object} source  a parsed _src/localoptions.json
 * @param {object} edits   { '<field name>': '<new text>' }
 * @returns {{model, changed:string[], rejected:string[], blanked:string[]}}
 */
function apply(source, edits = {}) {
  /* STRUCTURED CLONE RATHER THAN A JSON ROUND TRIP, because the stored `now`
   * is an ISO STRING by the time it reaches here — sourceOf() converted it —
   * and a round trip would be a no-op on it today and a silent Date-to-
   * string conversion the day anything stores one. */
  const next = structuredClone(source);

  const byPage = new Map();
  for (const page of pagesOf(next)) byPage.set(page.slug, page);

  const rejected = [];
  const changed = [];
  const blanked = [];

  for (const [field, raw] of Object.entries(edits || {})) {
    const parts = String(field).split(SEP);
    const [kind, pageSlug, sectionKey, index] = parts;

    const page = byPage.get(pageSlug);

    if (!page) { rejected.push(field); continue; }

    const copy = page.copy;
    const value = text(raw).trim();

    /* THE WRITE IS CHOSEN HERE AND PERFORMED ONCE BELOW, so every branch
     * goes through the same counting. A branch that assigned and returned
     * would be the one that forgot to count, which is how a screen reports
     * "nothing changed" after saving something. */
    let before;
    let write;

    if (SEO_TITLE === kind && SEO_SECTION === sectionKey) {
      before = text(copy.title);
      write = () => { copy.title = value; };

    } else if (SEO_META === kind && SEO_SECTION === sectionKey) {
      before = text(copy.meta);
      write = () => { copy.meta = value; };

    } else if (HEADING === kind && 'about' === sectionKey && 'home' === page.kind) {
      before = text(copy.aboutHeading);
      write = () => { copy.aboutHeading = value; };

    } else if (PREFIX === kind && 'about' === sectionKey && 'home' === page.kind) {
      const at = Number(index);
      const list = Array.isArray(copy.about) ? copy.about : null;

      if (!list || !Number.isInteger(at) || at < 0 || at >= list.length) {
        rejected.push(field);
        continue;
      }

      before = text(list[at]);
      write = () => { list[at] = value; };

    } else if (PREFIX === kind && 'servicesLede' === sectionKey && 'home' === page.kind) {
      if (undefined === copy.servicesLede) { rejected.push(field); continue; }

      before = text(copy.servicesLede);
      write = () => { copy.servicesLede = value; };

    } else if (HEADING === kind && 'service' === page.kind) {
      const section = sectionAt(copy, sectionKey);

      if (!section) { rejected.push(field); continue; }

      before = text(section.heading);
      write = () => { section.heading = value; };

    } else if (PREFIX === kind && 'service' === page.kind) {
      const section = sectionAt(copy, sectionKey);
      const at = Number(index);

      if (!section || !Array.isArray(section.paragraphs)
        || !Number.isInteger(at) || at < 0 || at >= section.paragraphs.length) {
        rejected.push(field);
        continue;
      }

      before = text(section.paragraphs[at]);
      write = () => { section.paragraphs[at] = value; };

    } else if (PREFIX === kind && 'home' === page.kind
      && 'string' === typeof copy[sectionKey] && !NOT_A_BREAK.has(sectionKey)) {
      /* A DIVIDER LINE, matched the same way collect() found it: a string
       * field on the home copy that is not one of the named ones. Asking
       * the data twice rather than keeping a list of which structure has
       * which — the list would be seven entries long and wrong the day an
       * eighth structure lands. */
      before = text(copy[sectionKey]);
      write = () => { copy[sectionKey] = value; };

    } else {
      rejected.push(field);
      continue;
    }

    if (before === value) continue;

    write();
    changed.push(field);

    /* COUNTED, NOT REFUSED. An emptied box is how a divider line or a lede
     * is REMOVED — every one of them has a renderer that prints nothing for
     * an empty string. The caller says how many went blank so the screen can
     * mention it, because clearing a box by accident and clearing it on
     * purpose look identical afterwards. */
    if (!value) blanked.push(field);
  }

  return { model: next, changed, rejected, blanked };
}

/** `section3` -> the third entry of a service's sections, or null. */
function sectionAt(copy, sectionKey) {
  const found = /^section(\d+)$/.exec(String(sectionKey || ''));

  if (!found) return null;

  const at = Number(found[1]) - 1;
  const sections = Array.isArray(copy && copy.sections) ? copy.sections : [];

  return sections[at] || null;
}

/**
 * A stored source made ready for renderSite().
 *
 * `now` COMES BACK FROM JSON AS A STRING, AND THE RENDERER WANTS A DATE.
 * sourceOf() converts the Date on the way to disk, which is right — JSON has
 * no date type. The renderer then does `site.now || new Date()`, so a string
 * passes straight through the fallback and the first thing to touch it —
 * `now.getFullYear()` in the footer — throws.
 *
 *     THE FALLBACK ONLY CATCHES A MISSING VALUE. A PRESENT ONE OF
 *     THE WRONG TYPE SAILS PAST IT AND THROWS LATER, IN ANOTHER
 *     FILE, ON A LINE THAT LOOKS FINE.
 *
 * REVIVED, NOT REPLACED WITH new Date(). The stored stamp is what makes a
 * re-render reproducible — the same footer year, the same sitemap lastmod —
 * and today's date would quietly change both on every save. renderSite's own
 * header says it is deterministic and that `now` is an argument for exactly
 * this reason.
 *
 * AN UNPARSEABLE ONE FALLS BACK RATHER THAN THROWING. A sitemap dated today
 * is worth more than a save that fails, and there is nothing an owner could
 * do about a bad stamp anyway.
 */
function sourceForRender(stored) {
  const stamped = new Date((stored || {}).now);

  return {
    ...stored,
    now: Number.isNaN(stamped.getTime()) ? new Date() : stamped,
  };
}

/** Every field name collect() would offer, for the handler to filter a post by. */
function fieldNames(source) {
  const out = [];

  for (const one of collect(source)) {
    if (one.headingField) out.push(one.headingField);
    out.push(...(one.paragraphFields || []));
  }

  return out;
}

module.exports = {
  collect, apply, fieldNames, pagesOf, breakKeysOf, sectionAt, sourceForRender,
  SEO_TITLE, SEO_META, SEO_SECTION, NOT_A_BREAK,
};
