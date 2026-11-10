// test-editable-text.js
//
// Which paragraphs of a stored site an owner may change, and putting their
// edits back.
//
//   node test-editable-text.js
//
// THE SCOPE IS THE FEATURE, AND IT GREW ONCE. Edwin, 7 November: *"just
// paragraphs with the ability to insert a link"*. Edwin, 8 November, having
// used it: *"I should be able to update the H2 and h3 as well"* and *"I
// should be able to fix the trust list"*.
//
// So a good deal of this suite is still about what does NOT appear on the
// edit screen — an FAQ answer, a pricing row, the hero — and about an edit
// for a section that is no longer there being refused rather than written
// somewhere approximate.
//
// THE THREE SANITISERS ARE NOT INTERCHANGEABLE and several tests exist only
// to pin that down: a paragraph keeps its links, a heading loses them, and a
// trust point is not escaped here at all because both of ITS renderers
// escape on the way out.

'use strict';

const assert = require('assert');

const {
  collect, apply, fieldName, fieldNames,
  headingName, subheadingName, trustName, TRUST_SLOTS,
} = require('./utils/cloudflareSites/editableText');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

function section(name) { console.log(`\n${name}\n`); }

/**
 * A model with one of every section shape the real builders produce.
 *
 * THE NON-PARAGRAPH SECTIONS ARE THE POINT, and what they prove changed on
 * 8 November. faq, pricing and reviews carry a HEADING and keep their
 * contents in a field of their own: the heading is now editable and the
 * contents still are not. serviceCards, napMap and form have an empty
 * heading and nothing else, so they stay off the screen entirely. hero has
 * a heading that looks like any other and is excluded by name, because no
 * builder ever reads it back.
 */
function model() {
  return {
    version: 1,
    pages: [
      {
        slug: 'about', type: 'about', title: 'About Us',
        sections: [
          { key: 'hero', label: 'Hero', type: 'hero', heading: 'Acme', subheading: 'Leander, TX', paragraphs: [] },
          {
            key: 'section1', label: 'Section 1', type: 'text',
            heading: 'Who we are', subheading: 'A local firm',
            paragraphs: ['One.', 'Two.'],
            trustPoints: ['Licensed and insured', 'Free estimates'],
          },
          {
            /* PARAGRAPHS BUT NO HEADING. The template has no H2 slot for
             * this block, so a heading box would write an edit the page
             * never shows — the hero problem in miniature. */
            key: 'section2', label: 'Section 2', type: 'text',
            heading: '', paragraphs: ['Three.'],
          },
          { key: 'serviceCards', label: 'Service Cards', type: 'service-cards', heading: '', paragraphs: [], cards: [{ name: 'A', line: 'b' }] },
          { key: 'pricing', label: 'Pricing', type: 'pricing', heading: 'Prices', paragraphs: [], pricing: [{ name: 'A', low: 1, high: 2 }] },
          { key: 'reviews', label: 'Reviews', type: 'reviews', heading: 'Reviews', paragraphs: [], reviews: [{ text: 'x', name: 'y', stars: 5 }] },
          { key: 'faq', label: 'FAQ', type: 'faq', heading: 'FAQ', paragraphs: [], faqs: [{ question: 'q', answer: 'a' }] },
          { key: 'napMap', label: 'NAP', type: 'nap-map', heading: '', paragraphs: [] },
          { key: 'form', label: 'Form', type: 'form', heading: '', paragraphs: [] },
        ],
      },
      {
        slug: 'leak-repair-leander-tx', type: 'service', title: 'Leak Repair',
        sections: [
          { key: 'section1', label: 'Section 1', type: 'text', heading: 'Leaks', paragraphs: ['Three.'] },
        ],
      },
      {
        slug: 'privacy-policy', type: 'legal', title: 'Privacy Policy',
        sections: [
          { key: 'content', label: 'Content', type: 'text', heading: 'Privacy', paragraphs: ['Legal words.'] },
        ],
      },
    ],
  };
}

(() => {

/* ===================================================================== */
section('WHAT REACHES THE EDIT SCREEN');

test('A SECTION APPEARS IF IT HAS PARAGRAPHS, A HEADING, OR A TRUST LIST', () => {
  /* READ OFF THE SECTION, NOT OFF A LIST OF TYPES. faq, pricing and reviews
   * keep their contents in a field of their own but they all carry a
   * heading, so all three are here with a heading box and nothing else.
   *
   * serviceCards, napMap and form are NOT here: contentModel stores
   * `heading: ''` for each, so there is no text to change. A box that writes
   * into a slot no renderer fills is a control that silently does nothing. */
  const keys = collect(model()).map(f => `${f.pageSlug}/${f.sectionKey}`);

  assert.deepStrictEqual(keys, [
    'about/section1',
    'about/section2',
    'about/pricing',
    'about/reviews',
    'about/faq',
    'leak-repair-leander-tx/section1',
  ]);
});

test('AND THE HERO NEVER DOES, HOWEVER ORDINARY ITS SHAPE LOOKS', () => {
  /* The hero carries a heading and a subheading exactly like section1, so
   * nothing shape-based could exclude it. It is excluded by name because of
   * something only the BUILDERS know: h1 is `businessName.toUpperCase()`
   * and the tagline is `location`, both recomputed every build, and
   * reuseModel.pageContent() reads back only section1..section9.
   *
   * An edit box for it would save a value that the next build overwrites. */
  const found = collect(model());

  assert.ok(!found.some(f => 'hero' === f.sectionKey), 'the hero reached the edit screen');
  assert.ok(!fieldNames(model()).has(headingName('about', 'hero')),
    'the hero heading was given a field name');
});

test('AND NOT THE LEGAL PAGES', () => {
  /* Generated from a template and saying what they have to say. An owner
   * editing them by hand is a different feature with different advice
   * attached to it. */
  const found = collect(model());

  assert.ok(!found.some(f => 'privacy-policy' === f.pageSlug),
    'a legal page reached the edit screen');
});

test('A HEADING AND A SUBHEADING EACH GET A FIELD, BUT ONLY WHERE ONE EXISTS', () => {
  /* An empty heading means the template has no slot for one on this
   * section. Offering a box would invite an edit the page never shows. */
  const found = collect(model());
  const about = found.find(f => 'about/section1' === `${f.pageSlug}/${f.sectionKey}`);
  const pricing = found.find(f => 'pricing' === f.sectionKey);

  assert.strictEqual(about.heading, 'Who we are');
  assert.strictEqual(about.headingField, 'h::about::section1');
  assert.strictEqual(about.subheading, 'A local firm');
  assert.strictEqual(about.subheadingField, 's::about::section1');

  assert.strictEqual(pricing.headingField, 'h::about::pricing');
  assert.strictEqual(pricing.subheadingField, null, 'a box was offered for a subheading that is not there');
  assert.deepStrictEqual(pricing.paragraphs, []);

  /* THE OTHER DIRECTION, and the one a reader is likelier to get wrong: a
   * section that IS on the screen, for its paragraphs, but has no heading of
   * its own. No slot in the template means no box, and no field name either
   * — otherwise a posted heading would be accepted and then never shown. */
  const noHeading = found.find(f => 'section2' === f.sectionKey);

  assert.strictEqual(noHeading.heading, '');
  assert.strictEqual(noHeading.headingField, null, 'a box was offered for a heading that is not there');
  assert.ok(!fieldNames(model()).has('h::about::section2'),
    'an empty heading was given a field name');
});

test('THE LIST SITS BETWEEN THE PARAGRAPHS, BECAUSE THE PAGE PUTS IT THERE', () => {
  /* aboutUsTemplate.html renders H2, H3, P1, {{SECTION1_LIST}}, P2 — the
   * list is BETWEEN the two paragraphs, not after them. The first version of
   * the edit screen drew both paragraphs and then the list, which reads as a
   * different page from the one it edits, and was reported as "the order is
   * wrong" within a day of shipping.
   *
   * A SCREEN FOR EDITING A PAGE HAS ONE JOB BEYOND SAVING: TO LOOK LIKE THE
   * PAGE. Out of order, every box has to be identified by reading it, which
   * is the work the screen exists to save. */
  const about = collect(model()).find(f => 'section1' === f.sectionKey && 'about' === f.pageSlug);

  assert.strictEqual(about.trustAfterParagraph, 1,
    'the list is not drawn after the first paragraph');
});

test('AND IT LEADS WHEN THE SECTION HAS NO PARAGRAPHS AT ALL', () => {
  /* Nothing produces this today — the About section1 always has two — but
   * "after the first paragraph" has to mean something when there is no first
   * paragraph, and slicing at 1 past the end would silently put it last. */
  const start = model();
  const section1 = start.pages[0].sections.find(s => 'section1' === s.key);
  section1.paragraphs = [];

  const about = collect(start).find(f => 'section1' === f.sectionKey && 'about' === f.pageSlug);

  assert.strictEqual(about.trustAfterParagraph, 0);
});

test('AND A SECTION WITH NO LIST HAS NO POSITION FOR ONE', () => {
  const faq = collect(model()).find(f => 'faq' === f.sectionKey);

  assert.strictEqual(faq.trustAfterParagraph, null);
});

test('THE TRUST LIST IS PADDED TO EIGHT SLOTS, AND ONLY WHERE THERE IS A LIST', () => {
  /* EIGHT WHETHER OR NOT EIGHT ARE USED. The empty boxes are how a claim is
   * added; emptying a full one is how a claim is removed. Eight because
   * buildTrustList slices to eight and the model is stored .slice(0, 8), so
   * a ninth box would offer something the renderer throws away. */
  const found = collect(model());
  const about = found.find(f => 'section1' === f.sectionKey && 'about' === f.pageSlug);

  assert.strictEqual(about.trustPoints.length, TRUST_SLOTS);
  assert.strictEqual(about.trustPoints[0], 'Licensed and insured');
  assert.strictEqual(about.trustPoints[1], 'Free estimates');
  assert.strictEqual(about.trustPoints[7], '');

  assert.strictEqual(found.find(f => 'faq' === f.sectionKey).trustPoints, null,
    'a section with no list was given slots anyway');
});

test('AND PAGE ORDER IS THE MODEL\'S OWN', () => {
  /* The edit screen reads top to bottom like the site does, which is the
   * only way somebody finds the sentence they came to change. */
  const found = collect(model());

  assert.strictEqual(found[0].pageSlug, 'about');
  assert.strictEqual(found[0].sectionKey, 'section1');
  assert.strictEqual(found[found.length - 1].pageSlug, 'leak-repair-leander-tx');
});

test('AN EMPTY OR MISSING MODEL IS AN EMPTY SCREEN, NOT A CRASH', () => {
  assert.deepStrictEqual(collect(null), []);
  assert.deepStrictEqual(collect({}), []);
  assert.deepStrictEqual(collect({ version: 1, pages: [] }), []);
});

/* ===================================================================== */
section('APPLYING AN EDIT');

test('IT CHANGES THE PARAGRAPH IT NAMES AND NOTHING ELSE', () => {
  const edits = {};
  edits[fieldName('about', 'section1', 1)] = 'Replaced.';

  const out = apply(model(), edits);

  assert.strictEqual(out.changed.length, 1);

  const about = out.model.pages.find(p => 'about' === p.slug);
  const sec = about.sections.find(s => 'section1' === s.key);

  assert.deepStrictEqual(sec.paragraphs, ['One.', 'Replaced.']);
});

test('AND IT DOES NOT TOUCH THE MODEL IT WAS GIVEN', () => {
  /* THE CALLER HOLDS THE STORED MODEL and writes the result back only if
   * the whole apply succeeded. Editing in place would mean a half-applied
   * edit on any throw, with the row already carrying it — and the caller
   * would have no copy of what it used to say. */
  const before = model();
  const snapshot = JSON.stringify(before);

  const edits = {};
  edits[fieldName('about', 'section1', 0)] = 'Something else entirely.';

  apply(before, edits);

  assert.strictEqual(JSON.stringify(before), snapshot,
    'apply() mutated the model it was given');
});

test('AN UNCHANGED BOX IS NOT A CHANGE', () => {
  const edits = {};
  edits[fieldName('about', 'section1', 0)] = 'One.';

  const out = apply(model(), edits);

  assert.strictEqual(out.changed.length, 0);
});

test('AN EMPTIED BOX IS REFUSED AND REPORTED, NOT APPLIED', () => {
  /* The templates fill a fixed number of slots — {{SECTION1_P1}} and
   * {{SECTION1_P2}} both exist — so a section whose second paragraph is ''
   * renders an empty <p> rather than reflowing. Deleting copy is a different
   * feature from editing it.
   *
   * REPORTED so the screen can say which box was emptied, rather than
   * appearing to lose the edit. */
  /* `<script>…</script>` IS NOT ON THIS LIST, and putting it there was a
   * mistake this test made once. Escaped, it is visible text — ugly, not
   * empty — so it is applied like any other words. "Blank" means blank. */
  for (const emptied of ['', '   ', '\n\t ']) {
    const edits = {};
    edits[fieldName('about', 'section1', 0)] = emptied;

    const out = apply(model(), edits);

    assert.strictEqual(out.changed.length, 0, `"${emptied}" was applied`);
    assert.strictEqual(out.blanked.length, 1, `"${emptied}" was not reported as blank`);

    const sec = out.model.pages[0].sections.find(s => 'section1' === s.key);
    assert.strictEqual(sec.paragraphs[0], 'One.', 'the original was lost');
  }
});

test('AND A SCRIPT TAG SURVIVES ONLY AS TEXT', () => {
  /* runGeneration writes these into the template with a plain .replace()
   * and no escaping. This is the moment that field becomes reachable by a
   * person. */
  const edits = {};
  edits[fieldName('about', 'section1', 0)] = 'Hello <script>alert(1)</script> and <a href="/x">a link</a>.';

  const out = apply(model(), edits);
  const para = out.model.pages[0].sections.find(s => 'section1' === s.key).paragraphs[0];

  assert.ok(!/<script/i.test(para), para);
  assert.ok(para.includes('<a href="/x">a link</a>'), `the link was lost: ${para}`);
});

/* ===================================================================== */
section('A FIELD THAT DOES NOT BELONG TO THIS MODEL');

test('A PAGE THAT IS NOT THERE IS REFUSED', () => {
  /* A stale tab, posting a form built against a different version of the
   * site. Writing it somewhere approximate is how a town's copy ends up on
   * a service page. */
  const edits = {};
  edits[fieldName('a-page-that-went-away', 'section1', 0)] = 'Words.';

  const out = apply(model(), edits);

  assert.strictEqual(out.changed.length, 0);
  assert.strictEqual(out.rejected.length, 1);
});

test('AND SO IS A SECTION, AN INDEX PAST THE END, AND A SECTION WITH NO PARAGRAPHS', () => {
  const cases = [
    fieldName('about', 'sectionThatWentAway', 0),
    fieldName('about', 'section1', 9),
    fieldName('about', 'pricing', 0),
    fieldName('privacy-policy', 'content', 0),
  ];

  for (const name of cases) {
    const edits = {};
    edits[name] = 'Words.';

    const out = apply(model(), edits);

    assert.strictEqual(out.rejected.length, 1, `${name} was not refused`);
    assert.strictEqual(out.changed.length, 0, `${name} was applied`);
  }
});

test('AND A FIELD THAT IS NOT ONE OF OURS IS IGNORED', () => {
  /* The CSRF token, and anything else on the form. Ignored rather than
   * rejected: it was never claiming to be an edit. */
  const out = apply(model(), { _csrf: 'token', somethingElse: 'x' });

  assert.strictEqual(out.changed.length, 0);
  assert.strictEqual(out.rejected.length, 0);
});

test('THE FIELD NAME IS FLAT, NOT BRACKETED', () => {
  /* `p[slug][key][0]` makes express build nested objects out of a page slug,
   * which is text this file does not control — `__proto__` among the
   * possibilities. A flat name parsed here keeps the shape of the payload
   * under this file's control. */
  const name = fieldName('about', 'section1', 0);

  assert.strictEqual(name, 'p::about::section1::0');
  assert.ok(!name.includes('['), name);
});

test('AND fieldNames LISTS EXACTLY WHAT THE FORM WOULD POST', () => {
  /* Spelled out rather than counted. This set IS the membership test every
   * posted edit is checked against, so a name that quietly stops being
   * generated becomes a box whose edits are refused with no clue why. */
  assert.deepStrictEqual([...fieldNames(model())].sort(), [
    'h::about::faq',
    'h::about::pricing',
    'h::about::reviews',
    'h::about::section1',
    'h::leak-repair-leander-tx::section1',
    'p::about::section1::0',
    'p::about::section1::1',
    'p::about::section2::0',
    'p::leak-repair-leander-tx::section1::0',
    's::about::section1',
    't::about::section1::0',
    't::about::section1::1',
    't::about::section1::2',
    't::about::section1::3',
    't::about::section1::4',
    't::about::section1::5',
    't::about::section1::6',
    't::about::section1::7',
  ]);
});

/* ===================================================================== */
section('SAVING THE SAME WORDS TWICE CHANGES NOTHING');

/**
 * One trip through the screen: fill the boxes from the model, press Save
 * without touching anything, and write the result back.
 *
 * THIS IS THE LOOP THE FEATURE RUNS IN, and it is the one no test covered.
 * Every individual piece was right — escape on input because the template
 * writes raw, show the stored value in the box — and the COMBINATION
 * escaped one more layer every time.
 */
function pressSave(model, edits = {}) {
  const posted = {};

  for (const block of collect(model)) {
    if (block.headingField) posted[block.headingField] = block.heading;
    if (block.subheadingField) posted[block.subheadingField] = block.subheading;

    block.paragraphs.forEach((text, i) => {
      posted[fieldName(block.pageSlug, block.sectionKey, i)] = text;
    });

    if (block.trustPoints) {
      block.trustPoints.forEach((text, i) => {
        posted[trustName(block.pageSlug, block.sectionKey, i)] = text;
      });
    }
  }

  return apply(model, Object.assign(posted, edits));
}

test('AN APOSTROPHE DOES NOT GROW AN ENTITY ON EVERY SAVE', () => {
  /* THE BUG, AS A LOOP. Typed "Hi! I'm John", the stored value went
   *
   *     save 1   Hi! I&#39;m John
   *     save 2   Hi! I&amp;#39;m John
   *     save 3   Hi! I&amp;amp;#39;m John
   *
   * and by the third the published page was showing the entity to visitors.
   * Nothing threw. Each save was correct on its own. */
  const start = model();
  const first = pressSave(start, {
    [fieldName('about', 'section1', 0)]: "Hi! I'm John Delgado.",
  });

  const stored = m => m.pages[0].sections.find(s => 'section1' === s.key).paragraphs[0];

  assert.strictEqual(stored(first.model), 'Hi! I&#39;m John Delgado.');

  const second = pressSave(first.model);
  const third = pressSave(second.model);

  assert.strictEqual(stored(second.model), stored(first.model),
    'a second save escaped the paragraph again');
  assert.strictEqual(stored(third.model), stored(first.model),
    'it compounds');

  assert.strictEqual(second.changed.length, 0,
    'saving untouched words was reported as a change, so the site would rebuild');
});

test('AND NEITHER DOES A HEADING, A QUOTE OR AN AMPERSAND', () => {
  const start = model();
  const first = pressSave(start, {
    [headingName('about', 'section1')]: 'Who we are & why it matters',
    [subheadingName('about', 'section1')]: "Pflugerville's own plumber",
    [fieldName('about', 'section1', 1)]: 'She said "hello" & left.',
  });

  const sub = m => m.pages[0].sections.find(s => 'section1' === s.key).subheading;
  assert.strictEqual(sub(first.model), 'Pflugerville&#39;s own plumber');

  const second = pressSave(first.model);

  assert.deepStrictEqual(
    second.model.pages[0].sections.find(s => 'section1' === s.key),
    first.model.pages[0].sections.find(s => 'section1' === s.key),
    'a second save changed text nobody touched');

  assert.strictEqual(second.changed.length, 0);
});

test('AND A LINK SURVIVES BEING SAVED OVER AND OVER', () => {
  /* The anchors are the reason the paragraph sanitiser re-admits anything at
   * all. A round trip that mangled them would take the interlinks out of the
   * site one save at a time. */
  const start = model();
  const first = pressSave(start, {
    [fieldName('about', 'section1', 0)]: 'Call <a href="/contact.html">us</a> today.',
  });

  const stored = m => m.pages[0].sections.find(s => 'section1' === s.key).paragraphs[0];

  assert.strictEqual(stored(first.model), 'Call <a href="/contact.html">us</a> today.');
  assert.strictEqual(stored(pressSave(first.model).model), stored(first.model));
});

test('AND A SCRIPT TAG STAYS INERT ACROSS SAVES, RATHER THAN UNWINDING', () => {
  /* THE RISK OF THE FIX, PINNED. Undoing the escape to fill the box is only
   * safe if the re-escape on the way out is total. If a round trip ever
   * handed back a live tag, this screen would have become the way to put one
   * on a customer's page. */
  const start = model();
  const once = pressSave(start, {
    [fieldName('about', 'section1', 0)]: '<script>alert(1)</script>',
  });

  const stored = m => m.pages[0].sections.find(s => 'section1' === s.key).paragraphs[0];

  assert.strictEqual(stored(once.model), '&lt;script&gt;alert(1)&lt;/script&gt;');

  for (let i = 0; i < 3; i += 1) {
    const again = pressSave(once.model);
    assert.strictEqual(stored(again.model), stored(once.model),
      'a repeated save changed an escaped tag');
  }
});

test('AND THE TICKED LIST IS NOT DECODED, BECAUSE IT WAS NEVER ENCODED', () => {
  /* The opposite rule, for the opposite reason: both of its renderers escape
   * on the way out, so nothing escapes it here — and running it through the
   * decoder would turn an owner's literal "&amp;" into "&" on the first
   * save. */
  const start = model();
  const first = pressSave(start, {
    [trustName('about', 'section1', 0)]: 'Visa &amp; Mastercard',
  });

  const stored = m => m.pages[0].sections.find(s => 'section1' === s.key).trustPoints[0];

  assert.strictEqual(stored(first.model), 'Visa &amp; Mastercard');
  assert.strictEqual(stored(pressSave(first.model).model), 'Visa &amp; Mastercard');
});

/* ===================================================================== */
section('HEADINGS');

test('A HEADING AND A SUBHEADING ARE WRITTEN WHERE THEY ARE NAMED', () => {
  const out = apply(model(), {
    [headingName('about', 'section1')]: 'Who we really are',
    [subheadingName('about', 'section1')]: 'Still local',
    [headingName('about', 'faq')]: 'Questions',
  });

  const about = out.model.pages[0].sections.find(s => 'section1' === s.key);

  assert.strictEqual(about.heading, 'Who we really are');
  assert.strictEqual(about.subheading, 'Still local');
  assert.strictEqual(out.model.pages[0].sections.find(s => 'faq' === s.key).heading, 'Questions');
  assert.strictEqual(out.changed.length, 3);
  assert.deepStrictEqual(about.paragraphs, ['One.', 'Two.'], 'the paragraphs moved too');
});

test('AN EMPTIED HEADING IS REFUSED, LIKE AN EMPTIED PARAGRAPH', () => {
  /* buildAboutUsPage checks section1.heading and logs an error without it,
   * and both it and buildLocationPages call .toUpperCase() on the value as
   * they write it. An empty heading is an empty <h2> today and a thrown
   * TypeError one refactor away. */
  for (const name of [headingName('about', 'section1'), subheadingName('about', 'section1')]) {
    const out = apply(model(), { [name]: '   ' });

    assert.deepStrictEqual(out.blanked, [name], `${name} was not reported as blanked`);
    assert.strictEqual(out.changed.length, 0, `${name} was applied anyway`);
  }
});

test('A LINK IN A HEADING IS KEPT AS WORDS, NOT AS A LINK', () => {
  /* THE OPPOSITE OF A PARAGRAPH, and not for tidiness. The builders render
   * the H2 as `heading.toUpperCase()`, so an anchor that survived would come
   * out as <A HREF="/CONTACT.HTML"> — an uppercased PATH, which is a 404 on
   * a case-sensitive host, and Cloudflare Pages is one. The line that
   * renders the heading is the line that would break the link. */
  const out = apply(model(), {
    [headingName('about', 'section1')]: 'Call <a href="/contact.html">us</a> now',
  });

  const heading = out.model.pages[0].sections.find(s => 'section1' === s.key).heading;

  assert.ok(!heading.includes('<a '), `an anchor survived into a heading: ${heading}`);
  assert.ok(heading.includes('&lt;a href='), heading);
});

test('AND A NEWLINE PASTED INTO ONE COLLAPSES', () => {
  /* A heading is one line. The form posts it from an <input>, which cannot
   * hold a newline — but a paste can, and one landing inside
   * {{SECTION1_H2}} renders as a stray gap in a shouted heading. */
  const out = apply(model(), {
    [headingName('about', 'section1')]: '  Who\n\n  we   are  ',
  });

  assert.strictEqual(out.model.pages[0].sections.find(s => 'section1' === s.key).heading,
    'Who we are');
});

/* ===================================================================== */
section('THE TRUST LIST');

test('A SLOT IS EDITED WHERE IT IS NAMED', () => {
  const out = apply(model(), {
    [trustName('about', 'section1', 0)]: 'Licensed, insured and bonded',
    [trustName('about', 'section1', 1)]: 'Free estimates',
  });

  const section = out.model.pages[0].sections.find(s => 'section1' === s.key);

  assert.deepStrictEqual(section.trustPoints, ['Licensed, insured and bonded', 'Free estimates']);
  assert.strictEqual(out.changed.length, 1, 'the list reported more than one change');
  assert.strictEqual(out.changed[0].field, 'trustPoints');
});

test('AN EMPTIED SLOT REMOVES THAT BULLET AND THE LIST CLOSES UP', () => {
  /* THE OPPOSITE OF A BLANKED PARAGRAPH, and deliberately so. A paragraph
   * slot renders an empty <p>; buildTrustList filters falsy entries and the
   * list reflows, so emptying a box is the only "remove" this screen has. */
  const out = apply(model(), {
    [trustName('about', 'section1', 0)]: '',
    [trustName('about', 'section1', 1)]: 'Free estimates',
  });

  const section = out.model.pages[0].sections.find(s => 'section1' === s.key);

  assert.deepStrictEqual(section.trustPoints, ['Free estimates'],
    'the model kept a hole where the removed bullet was');
  assert.strictEqual(out.blanked.length, 0, 'removing a bullet was reported as a mistake');
});

test('AND TYPING INTO AN EMPTY SLOT ADDS ONE', () => {
  const posted = {};
  for (let i = 0; i < TRUST_SLOTS; i += 1) posted[trustName('about', 'section1', i)] = '';
  posted[trustName('about', 'section1', 0)] = 'Licensed and insured';
  posted[trustName('about', 'section1', 1)] = 'Free estimates';
  posted[trustName('about', 'section1', 2)] = 'Same-day service available';

  const out = apply(model(), posted);

  assert.deepStrictEqual(
    out.model.pages[0].sections.find(s => 'section1' === s.key).trustPoints,
    ['Licensed and insured', 'Free estimates', 'Same-day service available']);
});

test('A SLOT THAT WAS NOT POSTED KEEPS WHAT IS STORED', () => {
  /* Only a box that actually came back EMPTY removes anything. A truncated
   * or filtered POST must not silently delete the list — which is the exact
   * failure this whole change was written to repair, one layer down. */
  const out = apply(model(), { [trustName('about', 'section1', 0)]: 'Licensed and bonded' });

  assert.deepStrictEqual(
    out.model.pages[0].sections.find(s => 'section1' === s.key).trustPoints,
    ['Licensed and bonded', 'Free estimates']);
});

test('AND A FORM THAT POSTS NO SLOTS AT ALL LEAVES THE LIST EXACTLY AS IT IS', () => {
  /* APPLY TOUCHES ONLY WHAT WAS POSTED. Shown with a stored list that has a
   * hole in it, because that is the only shape where "leave it alone" and
   * "rewrite it from the stored values" tell different stories: rewriting
   * would compact the hole away, which is a change the owner did not ask
   * for and did not make. An old model written before this screen existed
   * is exactly where such a hole would be. */
  const start = model();
  const section1 = start.pages[0].sections.find(s => 'section1' === s.key);
  section1.trustPoints = ['Licensed and insured', '', 'Free estimates'];

  const out = apply(start, { [fieldName('about', 'section1', 0)]: 'Changed.' });

  assert.deepStrictEqual(
    out.model.pages[0].sections.find(s => 'section1' === s.key).trustPoints,
    ['Licensed and insured', '', 'Free estimates'],
    'an edit to a paragraph rewrote the trust list');

  assert.ok(!out.changed.some(c => 'trustPoints' === c.field),
    'the trust list was reported as changed by a paragraph edit');
});

test('A TRUST POINT IS NOT ESCAPED HERE, BECAUSE BOTH RENDERERS ESCAPE IT', () => {
  /* ESCAPE AT EXACTLY ONE END. buildTrustList replaces & < > itself and the
   * WordPress renderer calls esc_html(). Escaping here too would show the
   * owner "Visa &amp; Mastercard" on their own published page. */
  const out = apply(model(), { [trustName('about', 'section1', 0)]: 'Visa & Mastercard accepted' });

  assert.strictEqual(
    out.model.pages[0].sections.find(s => 'section1' === s.key).trustPoints[0],
    'Visa & Mastercard accepted');
});

test('AND A SLOT ON A SECTION THAT HAS NO LIST IS REFUSED', () => {
  const name = trustName('about', 'faq', 0);
  const out = apply(model(), { [name]: 'Open 24 hours' });

  assert.deepStrictEqual(out.rejected, [name]);
  assert.strictEqual(out.changed.length, 0);
});

test('AND A SLOT PAST THE EIGHTH DOES NOT EXIST', () => {
  const name = trustName('about', 'section1', TRUST_SLOTS);
  const out = apply(model(), { [name]: 'A ninth claim' });

  assert.deepStrictEqual(out.rejected, [name]);
});

/* ===================================================================== */

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

})();
