// test-reuse-model.js
//
// A stored content.json reads back as the shapes the generators return.
//
//   node test-reuse-model.js
//
// WHY THIS IS A ROUND TRIP AND NOT A FIXTURE
//
// contentModel.js turns generator output INTO model sections. reuseModel.js
// turns them back. Those two have to agree exactly, and the cheapest way to
// be sure is to send a value through both and check it comes out the same —
// rather than writing down, twice and by hand, what the shape is supposed to
// be.
//
// A captured content.json would test this file against ONE build from ONE
// day. The round trip tests it against contentModel.js itself, so a field
// added on one side and not the other fails here instead of on a customer's
// re-rendered page, where the symptom is a missing block and no error.
//
// AND IT USES contentModel's OWN FUNCTIONS to build the input. Hand-written
// section literals would drift from what the builders actually emit, and
// then this suite would be testing reuseModel against a fiction.

'use strict';

const assert = require('assert');

const CM = require('./utils/contentModel');
const { reuseFrom, sourceOf } = require('./utils/reuseModel');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

function section(name) { console.log(`\n${name}\n`); }

/* ---------------------------------------------------- what went in */

/** What generatePagesContent / generateAboutUsContent return. */
const CONTENT = {
  section1: { heading: 'AC Inspection for Leander Homes', paragraphs: ['First para with <a href="./">a link</a> in it.', 'Second para.'] },
  section2: { heading: 'What We Check', subheading: 'Every visit', paragraphs: ['Two.'] },
  section3: { heading: 'Why It Matters', paragraphs: ['Three.'] },
  section4: { heading: 'Our Service Area', paragraphs: ['Four.'] },
  section5: { heading: 'AC Inspection Near Me', paragraphs: ['Five.'] },
};

const FAQS = [
  { question: 'How long does it take?', answer: 'About an hour.' },
  { question: 'Do you charge for it?', answer: 'Not on a repair visit.' },
];

const CARDS = [
  { name: 'AC Inspection', line: 'A full system check.' },
  { name: 'Duct Cleaning', line: '' },
];

const PRICING = [
  { name: 'AC Inspection', low: 89, high: 149, unit: 'per visit', note: 'Waived with a repair' },
];

const CASE_STUDY = {
  heading: 'Case Study of Our Air Conditioning Services in Leander, TX',
  paragraphs: ['At a home a few minutes from the library, the homeowner noticed warm air.'],
};

const REVIEWS = {
  heading: 'What Customers Are Saying',
  note: 'These are example reviews. Replace them with your own.',
  reviews: [
    { name: 'Dana R.', stars: 5, text: 'Example review. They arrived when they said they would.' },
    { name: 'Marco T.', stars: 4, text: 'Example review. Clear pricing up front.' },
  ],
};

const CONTACT_INTRO = { heading: 'Contact Us', paragraphs: ['Call or send a message.'] };

/** What generateLocationFaq returns — the same shape, a different generator. */
const LOCATION_FAQS = [
  { question: 'Do you cover Cedar Park?', answer: 'Yes, every day of the week.' },
];

/* ---------------------------------------------------- the model */

/**
 * A model built the way the builders build one.
 *
 * `nearMe` CARRIES section5, which is the rename this whole file exists to
 * catch — see SECTION_ALIASES in reuseModel.js.
 */
function buildModel(over = {}) {
  const model = CM.createModel({
    businessName: 'Air Conditioning Leander',
    businessType: 'air-conditioning',
    siteMode: 'lead',
    location: 'Leander, TX',
  });

  const about = {
    slug: 'about',
    type: CM.PAGE_TYPES.ABOUT,
    sections: [
      CM.section({ key: 'section1', label: 'Section 1', source: CONTENT.section1 }),
      CM.section({ key: 'section2', label: 'Section 2', type: CM.SECTION_TYPES.TEXT_IMAGES, source: CONTENT.section2 }),
      CM.serviceCardsSection(CARDS, { nestIn: 'section2' }),
      CM.section({ key: 'section3', label: 'Section 3', type: CM.SECTION_TYPES.TEXT_IMAGES, source: CONTENT.section3 }),
      CM.section({ key: 'nearMe', label: 'Near Me', source: CONTENT.section5 }),
      CM.pricingSection(PRICING, { notice: 'Estimates only.' }),
      CM.section({ key: 'caseStudy', label: 'Case Study', source: CASE_STUDY }),
      CM.reviewsSection(REVIEWS.reviews, { heading: REVIEWS.heading, note: REVIEWS.note }),
      CM.faqSection(FAQS),
      CM.section({ key: 'section4', label: 'Our Service Area', type: CM.SECTION_TYPES.TEXT_IMAGES, source: CONTENT.section4 }),
    ].filter(Boolean),
  };

  const service = {
    slug: 'ac-inspection-leander-tx',
    type: CM.PAGE_TYPES.SERVICE,
    sections: [
      CM.section({ key: 'section1', label: 'Section 1', source: CONTENT.section1 }),
      CM.section({ key: 'section2', label: 'Section 2', source: CONTENT.section2 }),
      CM.section({ key: 'section3', label: 'Section 3', source: CONTENT.section3 }),
      CM.section({ key: 'section4', label: 'Section 4', source: CONTENT.section4 }),
    ],
  };

  const contact = {
    slug: 'contact',
    type: CM.PAGE_TYPES.CONTACT,
    sections: [
      CM.section({ key: 'contactIntro', label: 'Intro', source: CONTACT_INTRO }),
    ],
  };

  /* SLUGGED THE WAY buildLocationPages SLUGS IT — `location-<slug>`, not the
   * bare town. The loop's own key is the bare one, so the two are easy to
   * confuse and the cost of confusing them is a town that silently
   * regenerates on every edit. */
  const location = {
    slug: 'location-cedar-park-tx',
    type: CM.PAGE_TYPES.LOCATION,
    sections: [
      CM.section({ key: 'section1', label: 'Section 1', source: CONTENT.section1 }),
      CM.section({ key: 'section2', label: 'Section 2', source: CONTENT.section2 }),
      CM.faqSection(LOCATION_FAQS, 'FAQ', 'Frequently Asked Questions — Cedar Park'),
    ],
  };

  CM.addPages(model, [about, service, contact, location]);

  return Object.assign(model, over);
}

(() => {

/* ===================================================================== */
section('PAGE CONTENT COMES BACK AS THE GENERATOR RETURNED IT');

test('A SERVICE PAGE ROUND-TRIPS SECTION FOR SECTION', () => {
  const r = reuseFrom(buildModel());
  const got = r.pageContent('ac-inspection-leander-tx');

  assert.ok(got, 'the service page read back as nothing');

  assert.deepStrictEqual(got.section1, CONTENT.section1);
  assert.deepStrictEqual(got.section3, CONTENT.section3);
  assert.deepStrictEqual(got.section4, CONTENT.section4);
});

test('AND A subheading SURVIVES, WHILE AN ABSENT ONE STAYS ABSENT', () => {
  /* contentModel omits `subheading` rather than storing ''. Read back as an
   * empty string it would render an empty element where the original
   * rendered nothing — so the key must be missing, not falsy. */
  const r = reuseFrom(buildModel());
  const got = r.pageContent('ac-inspection-leander-tx');

  assert.strictEqual(got.section2.subheading, 'Every visit');
  assert.ok(!('subheading' in got.section1),
    'an absent subheading came back as a key');
});

test('AND THE About PAGE\'S TRUST LIST SURVIVES, WHICH ONCE IT DID NOT', () => {
  /* THE BUG THIS TEST WAS WRITTEN FOR. sourceOf() returned heading,
   * subheading and paragraphs, and the ticked list on section1 was simply
   * dropped. buildTrustList() answers '' for an empty list, so
   * {{SECTION1_LIST}} was replaced with nothing and the eight bullets
   * disappeared from the page on the first edit — no throw, no log line.
   *
   * IT GOT THROUGH BECAUSE OF HOW IT IS ATTACHED. Every other field comes
   * from CM.section(), which this suite round-trips. trustPoints is added
   * AFTER, by an Object.assign in buildAboutUsPage, so a round trip built
   * only out of CM.section() could never have seen it. This test builds the
   * section the way the real builder does. */
  const model = buildModel();
  const about = model.pages.find(pg => 'about' === pg.type);
  const section1 = about.sections.find(sec => 'section1' === sec.key);

  Object.assign(section1, { trustPoints: ['Licensed and insured', 'Free onsite estimates'] });

  const got = reuseFrom(model).aboutContent();

  assert.deepStrictEqual(got.section1.trustPoints,
    ['Licensed and insured', 'Free onsite estimates']);
});

test('AND AN ABSENT OR EMPTY LIST STAYS ABSENT, LIKE AN ABSENT subheading', () => {
  /* A generator shape carrying `trustPoints: []` is not one any generator
   * returns, and the key being present-but-empty is a different thing from
   * the section having no list at all. */
  const model = buildModel();
  const about = model.pages.find(pg => 'about' === pg.type);

  assert.ok(!('trustPoints' in reuseFrom(model).aboutContent().section1),
    'a section with no list came back carrying the key');

  about.sections.find(sec => 'section1' === sec.key).trustPoints = [];

  assert.ok(!('trustPoints' in reuseFrom(model).aboutContent().section1),
    'an empty list came back as a key');
});

test('THE About PAGE\'S nearMe COMES BACK AS section5', () => {
  /* THE ONE RENAME, AND THE REASON SECTION_ALIASES EXISTS. The generator
   * calls it section5; the model calls it nearMe, because that is what a
   * WordPress admin panel has to be labelled. Read back literally, section5
   * is undefined and the Near Me block vanishes from an edited page with no
   * error anywhere. */
  const r = reuseFrom(buildModel());
  const got = r.aboutContent();

  assert.ok(got, 'the About page read back as nothing');
  assert.deepStrictEqual(got.section5, CONTENT.section5);
  assert.ok(!('nearMe' in got), 'the model key leaked into the generator shape');
});

test('AND THE NON-TEXT SECTIONS ARE NOT MISTAKEN FOR CONTENT', () => {
  /* serviceCards, pricing, reviews and faq all sit in the same array. A
   * reader that took every section would hand the renderer a `faq` key it
   * has no idea what to do with. */
  const r = reuseFrom(buildModel());
  const got = r.aboutContent();

  for (const key of ['serviceCards', 'pricing', 'reviews', 'faq', 'caseStudy']) {
    assert.ok(!(key in got), `${key} came back as page content`);
  }
});

test('A PAGE WHOSE section1 HAS NO WORDS READS BACK AS NOTHING', () => {
  /* THE SAME GUARD runGeneration APPLIES TO THE LIVE GENERATOR. A page
   * missing section1 is a page whose content did not arrive, and rendering
   * it produces a shell. Better to fall through and generate than to
   * publish an empty page silently. */
  const model = buildModel();
  const service = model.pages.find(p => p.slug === 'ac-inspection-leander-tx');
  service.sections[0].paragraphs = [];

  assert.strictEqual(reuseFrom(model).pageContent('ac-inspection-leander-tx'), null);
});

test('AND A PAGE THAT IS NOT IN THE MODEL READS BACK AS NOTHING', () => {
  const r = reuseFrom(buildModel());
  assert.strictEqual(r.pageContent('not-a-page'), null);
  assert.strictEqual(r.page('not-a-page'), null);
  assert.strictEqual(r.has('not-a-page'), false);
});

/* ===================================================================== */
section('THE ABOUT PAGE\'S FIVE GENERATED BLOCKS');

test('faqs() RETURNS WHAT generateFaqAnswers RETURNED', () => {
  assert.deepStrictEqual(reuseFrom(buildModel()).faqs(), FAQS);
});

test('serviceCards() RETURNS WHAT generateServiceCards RETURNED', () => {
  assert.deepStrictEqual(reuseFrom(buildModel()).serviceCards(), CARDS);
});

test('pricing() RETURNS WHAT generatePricing RETURNED', () => {
  /* NUMBERS AS NUMBERS. contentModel stores low/high through Number(); a
   * reader handing back strings would format as "$NaN" in the table and
   * nowhere would say why. */
  const got = reuseFrom(buildModel()).pricing();

  assert.deepStrictEqual(got, PRICING);
  assert.strictEqual(typeof got[0].low, 'number');
  assert.strictEqual(typeof got[0].high, 'number');
});

test('caseStudy() RETURNS WHAT generateCaseStudy RETURNED', () => {
  assert.deepStrictEqual(reuseFrom(buildModel()).caseStudy(), CASE_STUDY);
});

test('sampleReviews() RETURNS WHAT generateSampleReviews RETURNED', () => {
  assert.deepStrictEqual(reuseFrom(buildModel()).sampleReviews(), REVIEWS);
});

test('AND THE "THESE ARE EXAMPLES" NOTE SURVIVES', () => {
  /* contentModel carries `note` deliberately, and says why: a section that
   * loses it on export is "four unlabelled five-star reviews with a real
   * business's name on them". A re-render that dropped it would do exactly
   * that, on a page that had been correct until somebody edited it. */
  const got = reuseFrom(buildModel()).sampleReviews();

  assert.strictEqual(got.note, REVIEWS.note);
  assert.ok(got.note.length > 0, 'the samples note came back empty');
});

test('contactIntro() RETURNS WHAT generateContactContent RETURNED', () => {
  assert.deepStrictEqual(reuseFrom(buildModel()).contactIntro(), CONTACT_INTRO);
});

test('locationContent() AND locationFaqs() READ ONE TOWN', () => {
  const r = reuseFrom(buildModel());

  assert.deepStrictEqual(r.locationContent('location-cedar-park-tx').section1, CONTENT.section1);
  assert.deepStrictEqual(r.locationFaqs('location-cedar-park-tx'), LOCATION_FAQS);
});

test('AND THEY ARE KEYED ON THE MODEL\'S SLUG, NOT THE TOWN\'S', () => {
  /* buildLocationPages stores `location-<slug>` while its own loop variable
   * is the bare slug. Ask with the wrong one and both return null — which
   * does not fail, it regenerates every town on every edit and charges for
   * it. The expensive kind of quiet, so it is pinned. */
  const r = reuseFrom(buildModel());

  assert.strictEqual(r.locationContent('cedar-park-tx'), null);
  assert.strictEqual(r.locationFaqs('cedar-park-tx'), null);
});

test('AND ONE TOWN\'S FAQ IS NOT THE HOME PAGE\'S', () => {
  /* Both land in a `faq` section and one reader serves both, so the only
   * thing keeping them apart is the page they are asked for. */
  const r = reuseFrom(buildModel());

  assert.deepStrictEqual(r.faqs(), FAQS);
  assert.deepStrictEqual(r.locationFaqs('location-cedar-park-tx'), LOCATION_FAQS);
  assert.notDeepStrictEqual(r.faqs(), r.locationFaqs('location-cedar-park-tx'));
});

test('AND EVERY ONE OF THEM IS null WHEN THE SECTION IS NOT THERE', () => {
  /* null MEANS "GENERATE IT", so this is the difference between a
   * re-rendered page missing its pricing table and one that regenerates it.
   * An empty array would read as "there is no pricing", which is a
   * different and wrong answer. */
  const model = buildModel();
  const about = model.pages.find(p => p.type === 'about');
  about.sections = about.sections.filter(s => ['section1', 'section2'].includes(s.key));

  const r = reuseFrom(model);

  for (const name of ['faqs', 'serviceCards', 'pricing', 'caseStudy', 'sampleReviews']) {
    assert.strictEqual(r[name](), null, `${name}() returned something for a section that is gone`);
  }
});

/* ===================================================================== */
section('A MODEL THIS FILE CANNOT READ IS REFUSED, NOT GUESSED AT');

test('AN UNKNOWN VERSION READS BACK AS NOTHING', () => {
  /* contentModel stamps a version precisely so a reader knows which shape
   * it is holding. Trying anyway means a re-render that quietly drops
   * whatever moved between versions — and the page still builds, so nothing
   * reports it. */
  assert.strictEqual(reuseFrom(buildModel({ version: 2 })), null);
  assert.strictEqual(reuseFrom(buildModel({ version: 0 })), null);
  assert.strictEqual(reuseFrom(buildModel({ version: undefined })), null);
});

test('AND SO DOES A MODEL WITH NO PAGES, OR NO MODEL AT ALL', () => {
  assert.strictEqual(reuseFrom(buildModel({ pages: [] })), null);
  assert.strictEqual(reuseFrom(null), null);
  assert.strictEqual(reuseFrom(undefined), null);
  /* REFUSED BY THE VERSION CHECK, not by a type check — a string has no
   * `.version`, so Number(undefined) is NaN. Worth asserting because the
   * caller reads content.json off disk and forgetting JSON.parse is the
   * likeliest way to get here. */
  assert.strictEqual(reuseFrom('{"version":1}'), null, 'a JSON string was accepted unparsed');
  assert.strictEqual(reuseFrom([]), null);
  assert.strictEqual(reuseFrom(7), null);
});

test('THE CURRENT MODEL_VERSION IS ONE THIS FILE SUPPORTS', () => {
  /* THE TEST THAT FAILS ON THE DAY THE MODEL CHANGES, which is the day
   * somebody has to decide what the new shape means here. Without it,
   * bumping MODEL_VERSION makes every re-render fall back to generating —
   * correct, charged, and silent. */
  const { SUPPORTED_VERSIONS } = require('./utils/reuseModel');

  assert.ok(SUPPORTED_VERSIONS.includes(CM.MODEL_VERSION),
    `contentModel writes version ${CM.MODEL_VERSION} and reuseModel reads `
    + `${SUPPORTED_VERSIONS.join(', ')} — teach reuseModel the new shape, or `
    + 'every edit will quietly regenerate and charge for it');
});

/* ===================================================================== */
section('WHAT IT DOES NOT COVER, SAID OUT LOUD');

test('THERE IS NO READER FOR THE JSON-LD REVIEW, BECAUSE NOTHING STORES ONE', () => {
  /* generateReview fabricates a reviewer and a five-star rating per service
   * page and puts them in the page's structured data. content.json does not
   * record it, so a re-render calls it again.
   *
   * WHICH MEANS A RE-RENDER IS NOT FREE — one model call per service page.
   * Any screen that tells a customer "nothing is charged" is wrong by that
   * much. Asserted here so that adding a reader for it is a deliberate act
   * that fails this test first. */
  const r = reuseFrom(buildModel());

  assert.ok(!('schemaReview' in r), 'a reader appeared — update the note in reuseModel.js');
  assert.ok(!('generateReview' in r));
});

test('sourceOf() IS THE ONE SHAPE EVERY GENERATOR AGREES ON', () => {
  assert.deepStrictEqual(sourceOf({ heading: 'H', paragraphs: ['a', 'b'] }),
    { heading: 'H', paragraphs: ['a', 'b'] });

  assert.deepStrictEqual(sourceOf({}), { heading: '', paragraphs: [] });
  assert.deepStrictEqual(sourceOf(null), { heading: '', paragraphs: [] });

  /* The two optional keys, each present only when the section has one. */
  assert.deepStrictEqual(
    sourceOf({ heading: 'H', paragraphs: [], subheading: 'S', trustPoints: ['x'] }),
    { heading: 'H', paragraphs: [], subheading: 'S', trustPoints: ['x'] });
});

/* ===================================================================== */

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

})();
