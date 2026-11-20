// test-local-options-text.js
//
// Which words of a stored Local Website Options site an owner may change.
//
//   node test-local-options-text.js
//
// THE BUG THIS READER EXISTS BECAUSE OF
//
// capture() read _src/content.json and nothing else. Local Website Options
// writes _src/localoptions.json and deliberately never writes the other, so
// capture refused every build of that mode, `editable` was false, and the
// "Edit words" button has never drawn on a single one of those sites — on
// the Cloudflare door or the GitHub one — since the edit screen shipped.
// Seven went live on 18 November before anybody noticed.
//
//     THE FAILURE WAS SILENT ON BOTH SIDES: the publish succeeded and
//     reported success, and the list screen simply drew no button.
//
// THE RULE MOST LIKELY TO BE BROKEN BY A LATER EDIT
//
// Escaping runs the opposite way round from editableText.js. Every renderer
// in utils/localOptions/render/ escapes on the way out — `esc(title)`,
// `richText(p)` — so the stored words are raw and must stay raw. Copying
// that file's forEditing()/escape pair into this one would publish `I&#39;m`
// to a visitor. There is a test below that does nothing else.

'use strict';

const assert = require('assert');

const T = require('./utils/cloudflareSites/localOptionsText');
const editableText = require('./utils/cloudflareSites/editableText');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

function section(name) { console.log(`\n${name}\n`); }

/** A stored source shaped the way generate.js hands one to renderSite(). */
function source(over = {}) {
  return {
    mode: 'localoptions',
    version: 1,
    business: { name: 'Acme Plumbing', city: 'Leander', state: 'TX' },
    structure: 'harbor',
    home: {
      sub: 'One sentence under the headline',
      title: 'Book a Plumber in Leander, TX | Acme Plumbing',
      meta: 'Call Acme Plumbing in Leander, TX and we arrange a visit.',
      aboutHeading: 'Who we are',
      about: ['First paragraph.', 'Second paragraph.', 'Third paragraph.'],
      servicesLede: 'Each opens onto what the work involves.',
      firstBreak: 'You speak with a person on the phone',
      secondBreak: 'We do not perform electrical panel work',
      ...(over.home || {}),
    },
    services: over.services || [
      {
        slug: 'leak-repair',
        name: 'Leak Repair',
        blurb: 'blurb',
        title: 'Leak Repair in Leander, TX | Acme Plumbing',
        meta: 'What a leak repair involves.',
        sections: [
          { heading: '', paragraphs: ['Opens the page.', 'And again.'] },
          { heading: 'How a visit goes', paragraphs: ['A paragraph.'] },
        ],
      },
    ],
    contact: {
      title: 'Contact Acme Plumbing | Leander, TX',
      meta: 'Send a message and we come back to you.',
      ...(over.contact || {}),
    },
  };
}

const find = (slots, pageSlug, sectionKey) =>
  slots.find(s => s.pageSlug === pageSlug && s.sectionKey === sectionKey);

/* ===================================================================== */

section('THE SEO PAIR, WHICH IS WHAT EDWIN ASKED FOR');

test('EVERY PAGE OFFERS A SEARCH TITLE AND A DESCRIPTION', () => {
  /* Edwin, 19 November: "will i be able to edit seo title and meta
   * description?" On the generator side the answer is no — rankFastIndexMeta
   * BUILDS those from the business name and the phone, so an edit would be
   * overwritten by the next render. In this mode they are model-written and
   * stored, so an edit sticks. */
  const slots = T.collect(source());

  for (const page of ['index', 'leak-repair', 'contact']) {
    const seo = find(slots, page, T.SEO_SECTION);

    assert.ok(seo, `${page} has no search-result slot`);
    assert.ok(seo.headingField, `${page} offers no box for the title`);
    assert.strictEqual(seo.paragraphFields.length, 1,
      `${page} offers ${seo.paragraphFields.length} boxes for the description`);
  }
});

test('AND THE TITLE AND THE DESCRIPTION ARE THE ONES ON THE PAGE', () => {
  const slots = T.collect(source());
  const seo = find(slots, 'index', T.SEO_SECTION);

  assert.strictEqual(seo.heading, 'Book a Plumber in Leander, TX | Acme Plumbing');
  assert.strictEqual(seo.paragraphs[0],
    'Call Acme Plumbing in Leander, TX and we arrange a visit.');
});

test('AND AN EMPTY ONE STILL DRAWS A BOX, UNLIKE EVERY OTHER SLOT', () => {
  /* THE OTHER READER'S RULE DOES NOT CARRY HERE, and the difference is
   * worth stating. editableText.js draws a box only where there is text
   * already, because an empty heading there means the TEMPLATE HAS NO SLOT
   * and typing into it would be an edit the page never shows.
   *
   * Every page in this mode has a <title> and a description — pages.js
   * falls back to a computed string when the stored one is empty. So an
   * empty box here is an invitation, not a control that does nothing. */
  const slots = T.collect(source({ home: { title: '', meta: '' } }));
  const seo = find(slots, 'index', T.SEO_SECTION);

  assert.ok(seo, 'a page with no stored title offers nothing to type into');
  assert.ok(seo.headingField, 'the title box vanished when the title was empty');
  assert.strictEqual(seo.paragraphFields.length, 1);
});

test('AND AN EDITED TITLE LANDS ON THE PAGE IT WAS TYPED ON', () => {
  /* Three pages carry a `title` key and they are reached by three different
   * routes through pagesOf() — the home object, an entry in the services
   * array, and the contact object. A writer that resolved the page by name
   * and then wrote to `source.home` would pass every test that only ever
   * edited the home page. */
  const src = source();

  const { model: next, changed } = T.apply(src, {
    [`${T.SEO_TITLE}::leak-repair::${T.SEO_SECTION}`]: 'Fixed service title',
    [`${T.SEO_META}::contact::${T.SEO_SECTION}`]: 'Fixed contact description',
  });

  /* THE ARRAY NAMES THE FIELDS, IT IS NOT A COUNTER WEARING AN ARRAY.
   *
   * A MUTANT MADE THIS POINT: `changed.length = changed.length + 1` passes
   * every assertion about how many changed and loses every assertion about
   * WHICH. The route only reads `.length` today — but the names are what a
   * log line would carry, and "two things changed" is not something anybody
   * can act on afterwards. */
  assert.deepStrictEqual(changed.sort(), [
    `${T.SEO_META}::contact::${T.SEO_SECTION}`,
    `${T.SEO_TITLE}::leak-repair::${T.SEO_SECTION}`,
  ].sort());

  assert.strictEqual(next.services[0].title, 'Fixed service title');
  assert.strictEqual(next.contact.meta, 'Fixed contact description');

  assert.strictEqual(next.home.title, src.home.title, 'the home page was written to instead');
});

test('AND THE SEO KINDS CANNOT COLLIDE WITH THE OTHER READER\'S', () => {
  /* nameFor() joins kind, page and section with '::'. A kind that collided
   * with one of editableText's letters would produce a field name both
   * readers answer to. Only one reader is ever loaded for a given site —
   * but that is a fact about today's routing, and a name that is
   * unambiguous needs no such fact to stay correct. */
  const theirs = new Set([
    editableText.PREFIX, editableText.HEADING, editableText.SUBHEADING,
    editableText.TRUST, editableText.REVIEW, editableText.REVIEWER,
  ]);

  assert.ok(!theirs.has(T.SEO_TITLE), `${T.SEO_TITLE} is already a kind in editableText`);
  assert.ok(!theirs.has(T.SEO_META), `${T.SEO_META} is already a kind in editableText`);
});

/* ===================================================================== */

section('THE DIVIDER LINES, WHICH ARE TWO OF THE LIVE FAULTS');

test('THEY ARE FOUND BY SHAPE, NOT BY A LIST OF THEIR NAMES', () => {
  /* Every structure asks for its own and some ask for none — Harbor wants
   * firstBreak and secondBreak, Beacon two of its own, Anvil none at all.
   * A list here would be seven entries long and wrong the day an eighth
   * structure lands, which is the failure shape.js already records for the
   * body-link count. */
  const slots = T.collect(source({
    home: { firstBreak: undefined, secondBreak: undefined, closingNote: 'A line nobody has written yet' },
  }));

  const found = find(slots, 'index', 'closingNote');

  assert.ok(found, 'a divider line this file has never heard of was not offered');
  assert.strictEqual(found.paragraphs[0], 'A line nobody has written yet');
});

test('AND A NAMED FIELD IS NEVER MISTAKEN FOR ONE', () => {
  /* `sub`, `title`, `meta` and `aboutHeading` are all strings on the same
   * object. Offered as divider lines they would each draw a second box
   * writing to a field that already has one — two controls, one value, and
   * whichever was saved last wins. */
  const slots = T.collect(source());

  for (const named of ['sub', 'title', 'meta', 'aboutHeading']) {
    assert.ok(!find(slots, 'index', named),
      `${named} is being offered as a divider line`);
  }
});

test('AND CLEARING ONE IS A REMOVAL, COUNTED RATHER THAN REFUSED', () => {
  /* Every renderer prints nothing for an empty divider. Harbor's second
   * line repeating the intro's exclusions is a live fault on one of the
   * seven sites, and an owner's fix for it may well be to delete the line
   * rather than rewrite it.
   *
   * COUNTED, because clearing a box by accident and clearing it on purpose
   * look identical afterwards. */
  const { model: next, changed, blanked } = T.apply(source(), {
    'p::index::secondBreak::0': '   ',
  });

  assert.strictEqual(changed.length, 1);
  assert.strictEqual(blanked.length, 1);
  assert.strictEqual(next.home.secondBreak, '');
});

test('AND THE SERVICES LEDE IS OFFERED BY ITS KEY, NOT ITS VALUE', () => {
  /* "Each opens onto what the work involves" is the live fault that
   * promises six links where HOME_BODY_LINKS is 2. An empty string means
   * the owner cleared it and the renderer prints nothing; undefined means
   * the structure never asked for one. Both are honoured by pages.js, so
   * the test is on the key. */
  const present = T.collect(source({ home: { servicesLede: '' } }));
  assert.ok(find(present, 'index', 'servicesLede'),
    'a cleared lede can never be typed back in');

  const absent = T.collect(source({ home: { servicesLede: undefined } }));
  assert.ok(!find(absent, 'index', 'servicesLede'),
    'a box was drawn for a lede this structure does not have');
});

/* ===================================================================== */

section('SERVICE PAGES');

test('THE FIRST SECTION GETS NO HEADING BOX, BECAUSE IT HAS NO HEADING', () => {
  /* prompt.js asks for exactly that: "No heading. Two or three paragraphs
   * that enter the page in the way the…". There is no slot in the template,
   * so a box would accept text that never appears. Here the other reader's
   * rule DOES carry, and the two opposite answers on this page are why both
   * are written down. */
  const slots = T.collect(source());

  assert.strictEqual(find(slots, 'leak-repair', 'section1').headingField, null,
    'a heading box was drawn for the section that has no heading slot');
  assert.ok(find(slots, 'leak-repair', 'section2').headingField,
    'the section that does have a heading was given no box');
});

test('AND A PARAGRAPH INDEX OFF THE END IS REFUSED, NOT APPENDED', () => {
  /* An out-of-range write would GROW the array — a fourth paragraph in a
   * template with three slots, stored, never rendered, and carried forward
   * by every re-render after it. */
  const { model: next, changed, rejected } = T.apply(source(), {
    'p::leak-repair::section2::7': 'nowhere',
  });

  assert.strictEqual(changed.length, 0);
  assert.deepStrictEqual(rejected, ['p::leak-repair::section2::7']);
  assert.strictEqual(next.services[0].sections[1].paragraphs.length, 1);
});

test('AND THE HOME PARAGRAPHS ARE BOUNDED THE SAME WAY', () => {
  /* A MUTANT FOUND THIS. The bounds check exists twice — once for a
   * service's sections and once for the home page's `about` array — and
   * only the first had a test. Removing the home one left every test in
   * this file passing.
   *
   *     TWO BRANCHES THAT DO THE SAME JOB NEED TWO TESTS.
   *     A TEST OF ONE IS EVIDENCE ABOUT ONE.
   *
   * The damage is the same on both sides: an out-of-range write GROWS the
   * array, storing a fourth paragraph in a template with three slots —
   * never rendered, and carried forward by every re-render after it. */
  const { model: next, changed, rejected } = T.apply(source(), {
    'p::index::about::9': 'nowhere',
    'p::index::about::-1': 'also nowhere',
    'p::index::about::x': 'not a number',
  });

  assert.strictEqual(changed.length, 0);
  assert.strictEqual(rejected.length, 3, 'one of the bad indexes was accepted');
  assert.strictEqual(next.home.about.length, 3, 'the about array grew');
});

test('AND A SERVICE WITH NO SECTIONS IS NOT A CRASH', () => {
  const slots = T.collect(source({
    services: [{ slug: 'x', name: 'X', title: 'T', meta: 'M' }],
  }));

  assert.ok(find(slots, 'x', T.SEO_SECTION), 'the SEO pair went missing with the sections');
});

/* ===================================================================== */

section('THE RULE A LATER EDIT IS MOST LIKELY TO BREAK');

test('NOTHING IS ESCAPED OR DECODED — THE WORDS ROUND TRIP EXACTLY', () => {
  /* THE OPPOSITE OF editableText.js, AND THE REASON IS IN THE RENDERERS.
   * They escape on the way out: `esc(title)` in chrome.js, `richText(p)`
   * which escapes before it linkifies. The generator's templates write
   * their stored values out RAW, so that reader stores escaped text and
   * decodes it for the box.
   *
   * Copying that pair into this file would escape an already-raw string
   * once per save until the published page showed `I&#39;m` to visitors.
   *
   *     ESCAPING IS NOT IDEMPOTENT, AND NEITHER IS DECODING.
   *     THE SIDE THAT ESCAPES IS THE SIDE THAT MUST NOT BE COPIED. */
  const awkward = `Tom & Jerry's <b>pipes</b> — "quoted" & [a link](https://x.test)`;

  const { model: next } = T.apply(source(), {
    [`${T.SEO_TITLE}::index::${T.SEO_SECTION}`]: awkward,
    'p::index::about::0': awkward,
  });

  assert.strictEqual(next.home.title, awkward, 'the title was escaped or decoded on the way in');
  assert.strictEqual(next.home.about[0], awkward, 'the paragraph was escaped or decoded on the way in');

  const back = T.collect(next);

  assert.strictEqual(find(back, 'index', T.SEO_SECTION).heading, awkward,
    'the title was transformed on the way back to the box');
  assert.strictEqual(find(back, 'index', 'about').paragraphs[0], awkward,
    'the paragraph was transformed on the way back to the box');
});

/* ===================================================================== */

section('WRITING BACK');

test('THE ARGUMENT IS NOT TOUCHED, A COPY IS RETURNED', () => {
  /* The caller holds the version it read from Mongo and may need it again —
   * to diff, to log, or because the re-render after this failed and the row
   * must not already be carrying words that were never published. */
  const src = source();

  T.apply(src, {
    [`${T.SEO_TITLE}::index::${T.SEO_SECTION}`]: 'changed',
    'p::index::about::0': 'changed',
    'h::leak-repair::section2': 'changed',
  });

  assert.strictEqual(src.home.title, 'Book a Plumber in Leander, TX | Acme Plumbing');
  assert.strictEqual(src.home.about[0], 'First paragraph.');
  assert.strictEqual(src.services[0].sections[1].heading, 'How a visit goes');
});

test('AND A VALUE THAT DID NOT CHANGE IS NOT COUNTED AS A CHANGE', () => {
  /* The form posts every box on the page, not only the touched ones. If an
   * untouched box counted, the screen would report "9 changes saved" for a
   * save that altered nothing — and a republish would be triggered for it. */
  const src = source();

  const { changed } = T.apply(src, {
    [`${T.SEO_TITLE}::index::${T.SEO_SECTION}`]: src.home.title,
    'p::index::about::0': src.home.about[0],
  });

  assert.strictEqual(changed.length, 0);
});

test('AND A FIELD FOR A PAGE THAT IS NOT THERE IS REJECTED', () => {
  const { changed, rejected } = T.apply(source(), {
    'p::no-such-page::about::0': 'x',
    'z::index::about::0': 'an unknown kind',
  });

  assert.strictEqual(changed.length, 0);
  assert.strictEqual(rejected.length, 2);
});

test('AND fieldNames() OFFERS EXACTLY WHAT collect() DREW', () => {
  /* The handler filters the posted body by this list. A name collect()
   * draws but fieldNames() omits is a box whose edits are dropped on save,
   * silently — the worst shape this pair can take. */
  const src = source();
  const names = new Set(T.fieldNames(src));

  for (const one of T.collect(src)) {
    if (one.headingField) {
      assert.ok(names.has(one.headingField), `${one.headingField} is drawn but not accepted`);
    }
    for (const field of one.paragraphFields) {
      assert.ok(names.has(field), `${field} is drawn but not accepted`);
    }
  }

  assert.strictEqual(names.size, T.fieldNames(src).length, 'fieldNames repeats itself');
});

/* ===================================================================== */

section('THE FORM, WHICH USED TO NAME THE BOXES ITSELF');

/* The same escaper shape the route passes in. */
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const drawnNames = (html) => [...html.matchAll(/name="([^"]+)"/g)].map(m => m[1]);

test('EVERY BOX IT DRAWS IS A NAME apply() WILL ACCEPT', () => {
  /* THE FAILURE THIS GUARDS IS SILENT AT BOTH ENDS.
   *
   * renderSections() computed every paragraph name itself —
   * `fieldName(pageSlug, sectionKey, i)` — which is right for the other
   * reader, whose paragraphs are always a contiguous array. A localoptions
   * block can be ONE STRING FROM A NAMED KEY: a divider line, the services
   * lede, a meta description.
   *
   * So the description box would have posted as `p::index::seo::0`, apply()
   * would have rejected a name it never offered, and the screen would have
   * said "nothing changed" to somebody who had just rewritten every title
   * on the site.
   *
   *     NEITHER SIDE THROWS. ONE INVENTS A NAME AND THE OTHER
   *     POLITELY IGNORES IT. */
  const { renderSections } = require('./utils/editForm');

  const src = source();
  const html = renderSections(src, esc, T.collect);
  const offered = new Set(T.fieldNames(src));
  const drawn = drawnNames(html);

  assert.ok(drawn.length >= 10, `only ${drawn.length} boxes were drawn`);

  for (const name of drawn) {
    assert.ok(offered.has(name), `the form draws "${name}", which apply() rejects`);
  }
});

test('AND THE SEARCH TITLE IS NOT LABELLED "Heading"', () => {
  /* It sits in the heading slot because that is the shape of the block, and
   * it is emphatically not a heading. A box labelled Heading invites
   * somebody to write their H2 into the <title>. */
  const { renderSections } = require('./utils/editForm');

  assert.ok(renderSections(source(), esc, T.collect).includes('>Search title<'),
    'the search title box has no label of its own');
});

test('AND THE OTHER READER IS STILL THE DEFAULT', () => {
  /* renderSections takes the reader as an argument with editableText.collect
   * as the default, so every existing Rank Fast caller is untouched. A
   * required third argument would have been a change to all of them. */
  const { renderSections } = require('./utils/editForm');

  assert.doesNotThrow(() => renderSections({ pages: [] }, esc),
    'the default reader no longer works without being named');
});

/* ===================================================================== */

section('THE ROUND TRIP: AN EDIT HAS TO REACH THE PAGE');

/* A source complete enough for renderSite() to draw all eleven pages. The
 * suite above only needs the copy; this section needs the furniture too. */
function renderable(over = {}) {
  return {
    ...source(over),
    url: 'https://acme.test',
    structure: 'orchard',
    areas: ['Leander'],
    hours: [{ day: 'Monday', open: '24' }],
    alt: {},
    cover: 1,
    logo: 'assets/logo.png',
    /* DELIBERATELY NOT TODAY. A MUTANT PROVED WHY: with the fixture
     * stamped on the day this was written, replacing the stored date with
     * `new Date()` produced the identical sitemap and the test passed.
     *
     *     A FIXTURE DATED TODAY CANNOT TELL "THE STORED ONE"
     *     FROM "THE CURRENT ONE". IT AGREES WITH BOTH.
     *
     * A date months back fails the moment anything stops being
     * reproducible. */
    now: '2026-03-04T00:00:00.000Z',
  };
}

test('A STRING `now` THROWS, WHICH IS WHY sourceForRender EXISTS', () => {
  /* THE TRAP, PROVED RATHER THAN ASSERTED IN A COMMENT. sourceOf() writes
   * the Date out as an ISO string — correct, JSON has no date type — and
   * contextFor() does `site.now || new Date()`, so the string sails past
   * the fallback. The footer is the first thing to touch it.
   *
   * This test is the guard on the revival: delete sourceForRender and the
   * failure is not a wrong date, it is every save throwing. */
  const { renderSite } = require('./utils/localOptions/render/renderSite');

  assert.throws(() => renderSite(renderable()), /getFullYear|toISOString/,
    'a stored source now renders with a string date — the revival may be dead code');
});

test('AND THE REVIVED ONE RENDERS, KEEPING THE DATE IT WAS BUILT ON', () => {
  /* NOT new Date(). renderSite's header says the build is deterministic and
   * that `now` is an argument for exactly that reason. Today's date would
   * change the footer year and the sitemap lastmod on every save — a diff
   * on every page, for an edit to one line. */
  const { renderSite } = require('./utils/localOptions/render/renderSite');

  const files = renderSite(T.sourceForRender(renderable()));

  assert.ok(files['index.html'], 'the home page was not rendered');
  assert.match(files['sitemap.xml'], /<lastmod>2026-03-04</,
    'the sitemap was stamped with today instead of the build date');
});

test('AND AN UNPARSEABLE DATE FALLS BACK INSTEAD OF FAILING THE SAVE', () => {
  /* A sitemap dated today is worth more than a save that fails, and there
   * is nothing an owner could do about a bad stamp anyway. */
  const { renderSite } = require('./utils/localOptions/render/renderSite');

  const files = renderSite(T.sourceForRender(renderable({ })), 'x');
  assert.ok(files['index.html']);

  const broken = T.sourceForRender({ ...renderable(), now: 'not a date' });
  assert.ok(broken.now instanceof Date && !Number.isNaN(broken.now.getTime()),
    'a bad stamp produced an Invalid Date rather than falling back');
});

test('AN EDITED SEARCH TITLE REACHES THE RENDERED <title>', () => {
  /* THE WHOLE CHAIN IN ONE ASSERTION: collect drew a box, apply wrote the
   * value into the stored source, and the renderer put it on the page.
   *
   * Every piece of this was tested on its own above and none of those
   * tests would have caught a writer that stored the title under a key
   * pages.js does not read. */
  const { renderSite } = require('./utils/localOptions/render/renderSite');

  const wanted = 'Book AC Service in Austin, TX | Acme Plumbing';

  const { model: edited, changed } = T.apply(renderable(), {
    [`${T.SEO_TITLE}::index::${T.SEO_SECTION}`]: wanted,
  });

  assert.strictEqual(changed.length, 1);

  const files = renderSite(T.sourceForRender(edited));

  assert.ok(files['index.html'].includes(`<title>${wanted}</title>`),
    'the edited title never reached the page');
});

test('AND AN EDITED DESCRIPTION REACHES THE META TAG', () => {
  const { renderSite } = require('./utils/localOptions/render/renderSite');

  const wanted = 'We answer the phone and arrange a visit in Austin, TX.';

  const { model: edited } = T.apply(renderable(), {
    [`${T.SEO_META}::index::${T.SEO_SECTION}`]: wanted,
  });

  const files = renderSite(T.sourceForRender(edited));

  assert.ok(files['index.html'].includes(`content="${wanted}"`),
    'the edited description never reached the meta tag');
});

test('AND THE RENDERER ESCAPES IT, SO THE READER MUST NOT', () => {
  /* THE OTHER HALF OF THE ESCAPING RULE, proved at the far end. The reader
   * stores raw because chrome.js writes `esc(title)`. If that ever stopped
   * being true, storing raw would put an owner's ampersand into the markup
   * unescaped — so the test is on the OUTPUT, not on the renderer's source. */
  const { renderSite } = require('./utils/localOptions/render/renderSite');

  const { model: edited } = T.apply(renderable(), {
    [`${T.SEO_TITLE}::index::${T.SEO_SECTION}`]: 'Tom & Jerry <b>Plumbing</b>',
  });

  const html = renderSite(T.sourceForRender(edited))['index.html'];

  assert.ok(html.includes('Tom &amp; Jerry'), 'the ampersand was not escaped on the way out');
  assert.ok(!html.includes('<title>Tom & Jerry <b>'), 'raw markup reached the title');
});

test('AND A SAVE THAT CHANGED NOTHING RENDERS THE SAME BYTES', () => {
  /* The form posts every box, not only the touched ones. A re-render after
   * a no-op save must produce the site that is already live — otherwise
   * every save is a deploy of a diff nobody asked for, and a real change
   * becomes impossible to spot in one. */
  const src = renderable();
  const { renderSite } = require('./utils/localOptions/render/renderSite');

  const before = renderSite(T.sourceForRender(src));

  const { model: after, changed } = T.apply(src, {
    [`${T.SEO_TITLE}::index::${T.SEO_SECTION}`]: src.home.title,
    'p::index::about::0': src.home.about[0],
    'h::leak-repair::section2': src.services[0].sections[1].heading,
  });

  assert.strictEqual(changed.length, 0);

  const again = renderSite(T.sourceForRender(after));

  for (const name of Object.keys(before)) {
    assert.strictEqual(again[name], before[name], `${name} changed on a no-op save`);
  }
});

/* ===================================================================== */

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
