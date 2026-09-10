// test-business-shape.js
//
// What a business IS decides what the generator is allowed to say about it.
//
// The bug this exists to prevent had no error message. A dentist typed into
// the WordPress free-text business_type field resolved to the home-services
// shape, and the About page came out offering a workmanship warranty and free
// onsite estimates, the FAQ asked "How do I book a job with Smile Dental?",
// and the home page carried a table of prices. Nothing failed. It just shipped.
//
// So most of what follows is negative: not "does it produce the right words"
// but "is this word absent from a page where it would be a licensing problem".
//
//   node test-business-shape.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const shapeModule = require('./utils/businessShape');
const {
  BUSINESS_TYPES,
  DROPDOWN_TYPES,
  imageFolderFor,
  servicesHeading,
  SHAPES,
  TRUST_POINTS,
  businessShape,
  categoryFor,
  titleFor,
  entityFor,
  capabilities,
  wantsBadges,
  wantsPricingTable,
  parseTrustClaims,
  trustPoints,
  NONE_TICKED,
} = shapeModule;

const { slugify } = require('./utils/slugify');
const { createAboutUsPrompt } = require('./utils/createAboutUsPrompt');
const {
  createPagesPrompt, TRADE_VOCAB, DEFAULT_VOCAB,
  OPENERS, BODY, HEADING_STYLES, topicsFor, SHAPE_WORDS,
} = require('./utils/createPagesPrompt');
const { createLocationPagesPrompt, anglesFor } = require('./utils/createLocationPagesPrompt');
const { getFixedFaqQuestions, getFixedFaqFallbacks } = require('./utils/fixedFaqQuestions');
const { themesFor } = require('./utils/generateLocationFaq');
const { copyBadgeImages } = require('./utils/copyBadgeImages');
const { generatePricing, buildPrompt } = require('./utils/buildPricingTable');
const { injectIndexInterlinks, appendSentence } = require('./utils/injectIndexInterlinks');
const { injectPagesInterlinks } = require('./utils/injectPagesInterlinks');
const { imageExtension } = require('./utils/uploadExtension');
const {
  buildCaseStudySection, caseStudyHeading, wantsCaseStudy,
  buildPrompt: caseStudyPrompt, SHAPES_WITH_CASE_STUDY,
} = require('./utils/generateCaseStudy');

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    const result = fn();

    // A test body that returns a promise would otherwise "pass" here and
    // reject somewhere else entirely — the try/catch above never sees it.
    // Every check in this file is synchronous; asyncTest is the way to write
    // one that is not.
    assert.ok(!result || typeof result.then !== 'function',
      'this test returned a promise — use asyncTest');

    console.log(`  ok    ${name}`); passed++;
  }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

const pending = [];
function asyncTest(name, fn) {
  pending.push(
    Promise.resolve()
      .then(fn)
      .then(() => { console.log(`  ok    ${name}`); passed++; })
      .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; })
  );
}

/* -------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------- */

const GLOBALS = (businessType, extra = {}) => ({
  businessName: 'Acme',
  location: 'Cedar Park, TX',
  businessType,
  ...extra,
});

function aboutPrompt(businessType, extra) {
  return createAboutUsPrompt({
    globalValues: GLOBALS(businessType, extra),
    keywords: ['one', 'two', 'three', 'four', 'five'],
  });
}

function servicePrompt(businessType, pageIndex = 0) {
  return createPagesPrompt({
    globalValues: GLOBALS(businessType),
    page: { keyword: 'a service' },
    keywords: ['one', 'two', 'three'],
    pageIndex,
  });
}

function locationPrompt(businessType, locationIndex = 0) {
  return createLocationPagesPrompt({
    globalForLoc: GLOBALS(businessType),
    keywords: ['one', 'two', 'three', 'four'],
    locationIndex,
  });
}

const byShape = shape => BUSINESS_TYPES.filter(t => t.shape === shape).map(t => t.label);

/* =========================================================================
 * 1. Resolution
 * ====================================================================== */

console.log('\nWhat shape is this business');

test('every dropdown type resolves to a real shape', () => {
  for (const entry of BUSINESS_TYPES) {
    assert.ok(SHAPES.includes(entry.shape), `${entry.label} has shape "${entry.shape}"`);
    assert.strictEqual(businessShape(entry.label), entry.shape, entry.label);
  }
});

test('an unknown type is generic, NOT home', () => {
  // The whole bug. fixedFaqQuestions' old businessShape() returned 'home' for
  // anything it did not recognise, on the reasoning that every supported type
  // except law firm was a trade. That stopped being true the moment anyone
  // typed something else into WordPress.
  // Veterinarian used to be here. It now resolves to medical, which is the
  // point of the health catch-all — an unknown type is one nobody thought of,
  // not one that was later given a home.
  for (const unknown of ['Yoga Studio', 'Wedding Photographer', 'Food Truck', 'Gutter Cleaning', '', null]) {
    assert.strictEqual(businessShape(unknown), 'generic', String(unknown));
  }
});

test('free text from the WordPress field still resolves', () => {
  const cases = {
    'Pediatric Dentist': 'medical',
    'dental office': 'medical',
    'Orthodontist': 'medical',
    'physical therapist': 'medical',
    'chiropractic': 'medical',
    'Personal Injury Attorney': 'professional',
    'law office': 'professional',
    'web development': 'project',
    'Roof Repair': 'home',
  };
  for (const [input, expected] of Object.entries(cases)) {
    assert.strictEqual(businessShape(input), expected, `"${input}"`);
  }
});

test('a word is not matched inside a longer word', () => {
  // 'law' is an alias fragment and 'lawn care' is a landscaper. A bare
  // indexOf() would have filed every lawn service as a law firm.
  assert.strictEqual(businessShape('Lawn Care'), 'home');
  assert.strictEqual(businessShape('lawn maintenance'), 'home');
});

test('the slug spelling and the spaced spelling agree', () => {
  // buildAboutUsPage looks these up through slugify() while every other caller
  // passes the raw label. The two maps disagreed about which form to key on,
  // so 'swimming pool contractor' and 'water damage restoration' — added in
  // spaced form to one copy — never matched the slugified lookup at all.
  for (const entry of BUSINESS_TYPES) {
    const slug = slugify(entry.label);
    assert.strictEqual(businessShape(slug), entry.shape, `${entry.label} -> ${slug}`);
    assert.strictEqual(titleFor(slug), entry.title, `${entry.label} -> ${slug}`);
    assert.strictEqual(categoryFor(slug), entry.category, `${entry.label} -> ${slug}`);
  }
});

test('the types that used to be missing are present', () => {
  for (const label of ['Dentist', 'Doctor', 'Chiropractor', 'Physical Therapy']) {
    assert.strictEqual(businessShape(label), 'medical', label);
  }
});

test('a general law firm is no longer given lemon law vocabulary', () => {
  // 'law firm' was hardwired to 'lemon law firm', so a family-law or
  // immigration practice was written out of repair orders, manufacturer
  // notices and mileage records.
  assert.strictEqual(categoryFor('Law Firm'), 'law firm');
  assert.strictEqual(categoryFor('Lemon Law'), 'lemon law firm');

  const page = servicePrompt('Law Firm');
  assert.ok(!/mileage records|repair orders|manufacturer notices/i.test(page),
    'a general law firm is still being handed lemon law nouns');
});

test('the noun phrase is grammatical for every type', () => {
  for (const entry of BUSINESS_TYPES) {
    const phrase = entityFor(entry.label);
    assert.ok(phrase && !/\s\s/.test(phrase) && !/\s$/.test(phrase), `"${phrase}"`);
    // "a local law firm company" and "a local dentistry" were both produced by
    // the ternary this replaced.
    assert.ok(!/\b(\w+)\s+\1\b/.test(phrase), `"${phrase}" repeats a word`);
  }
  assert.strictEqual(entityFor('Dentist'), 'dental practice');
  assert.strictEqual(entityFor('Law Firm'), 'law firm');
  assert.strictEqual(entityFor('Plumbing'), 'plumbing company');
});

/* =========================================================================
 * 2. Badges
 * ====================================================================== */

console.log('\nBadges are home services only');

test('only the home shape wants badges', () => {
  for (const entry of BUSINESS_TYPES) {
    assert.strictEqual(wantsBadges(entry.label), entry.shape === 'home', entry.label);
  }
  assert.strictEqual(wantsBadges('Yoga Studio'), false);
});

test('copyBadgeImages writes nothing for a dentist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'badge-'));
  const result = copyBadgeImages(dir, GLOBALS('Dentist'));

  assert.strictEqual(result.awardBadge, '', 'an award badge was produced');
  assert.strictEqual(result.licensedBadge, '', 'a licensed badge was produced');
  assert.strictEqual(result.awardBadgeAlt, '');
  assert.strictEqual(result.licensedBadgeAlt, '');
});

test('the guard is in copyBadgeImages, not only in its caller', () => {
  // buildAboutUsPage already decides this before calling. The guard is
  // repeated inside so that a second caller added later cannot reintroduce
  // the problem by forgetting to ask.
  const src = fs.readFileSync(path.join(__dirname, 'utils', 'copyBadgeImages.js'), 'utf8');
  assert.ok(/wantsBadges\s*\(/.test(src), 'copyBadgeImages does not check the shape itself');
});

/* =========================================================================
 * 3. Pricing
 * ====================================================================== */

console.log('\nThe pricing table');

test('home and project get one; medical, professional and generic do not', () => {
  assert.strictEqual(wantsPricingTable('Plumbing'), true);
  assert.strictEqual(wantsPricingTable('Web Design'), true);
  assert.strictEqual(wantsPricingTable('Dentist'), false);
  assert.strictEqual(wantsPricingTable('Law Firm'), false);
  assert.strictEqual(wantsPricingTable('Yoga Studio'), false);
});

asyncTest('generatePricing returns nothing for a doctor, without calling the model', async () => {
  // Also the point of the early return: no API call, no credit spent
  // generating rows that would only be discarded. If the guard were removed
  // this would not merely fail — it would throw, because there is no API key
  // in the test environment.
  for (const label of ['Doctor', 'Dentist', 'Law Firm', 'Yoga Studio']) {
    const rows = await generatePricing({ businessType: label, location: 'Cedar Park, TX' });
    assert.deepStrictEqual(rows, [], label);
  }
});

test('project work gets units that mean something for it', () => {
  const units = capabilities('Web Design').pricingUnits;
  assert.ok(units.includes('per project'), 'no "per project"');
  assert.ok(!units.includes('per sq ft'), '"per sq ft" offered to a web designer');
  assert.ok(!units.includes('per linear ft'), '"per linear ft" offered to a web designer');

  const prompt = buildPrompt({ businessType: 'Web Design', location: 'Cedar Park, TX' });
  assert.ok(prompt.includes('"per project"'), 'the prompt does not offer "per project"');
  assert.ok(!prompt.includes('per linear ft'), 'the prompt still offers "per linear ft"');
});

test('the home units are unchanged', () => {
  assert.deepStrictEqual(
    capabilities('Plumbing').pricingUnits,
    ['per job', 'per hour', 'per unit', 'per sq ft', 'per linear ft']
  );
});

test('the estimate notice does not assume a building for project work', () => {
  // The home wording ends "...a free, no-obligation quote for your property".
  // A web design studio has no property to quote on.
  assert.ok(capabilities('Plumbing').pricingNotice.includes('your property'));
  assert.ok(!capabilities('Web Design').pricingNotice.includes('your property'),
    'the project notice still asks about a property');
});

/* =========================================================================
 * 4. Trust points
 * ====================================================================== */

console.log('\nTrust points');

test('the home list is exactly what it always was', () => {
  // The point of the default-ticked flags. An existing customer regenerating
  // their site must not get a different About page because of this change.
  const t = trustPoints('Plumbing', {});
  assert.strictEqual(t.count, 8, 'the count changed');
  assert.deepStrictEqual(t.pinned, ['Visa, Mastercard and most major cards accepted']);
  assert.deepStrictEqual(t.pool, [
    'flexible scheduling',
    'licensed, insured and bonded',
    'accredited by local authorities',
    '5-star rated by local customers',
    'same-day service available',
    'free onsite estimates',
    'workmanship warranty',
    'upfront pricing, no hidden fees',
    'family owned and operated',
  ]);
});

test('the 24 hour claim is still driven by the wizard toggle', () => {
  assert.ok(!trustPoints('Plumbing', {}).pinned.includes('Open 24 hours, 7 days a week'));
  assert.ok(trustPoints('Plumbing', { is24Hours: true })
    .pinned.includes('Open 24 hours, 7 days a week'));
});

test('a claim is never offered unless it was ticked', () => {
  const t = trustPoints('Dentist', { claims: 'insurance' });
  assert.ok(t.pool.includes('most insurance plans accepted'), 'the ticked claim is missing');
  assert.ok(!t.pool.includes('licensed and state-registered'), 'an unticked claim leaked in');
  assert.ok(!t.pool.includes('emergency appointments available'), 'an unticked claim leaked in');
});

test('every shape can fill a balanced grid with nothing ticked', () => {
  // Except home, whose defaults are all on. The others need four neutral
  // statements each, or an owner who ticks nothing gets an empty section.
  for (const shape of SHAPES) {
    if (shape === 'home') continue;
    assert.ok(TRUST_POINTS[shape].always.length >= 4,
      `${shape} has only ${TRUST_POINTS[shape].always.length} always-safe points`);
  }

  for (const label of ['Dentist', 'Law Firm', 'Web Design', 'Yoga Studio']) {
    const t = trustPoints(label, { claims: NONE_TICKED });
    assert.strictEqual(t.count % 2, 0, `${label}: odd count breaks the two-column grid`);
    assert.ok(t.count >= 4, `${label} renders nothing when nothing is ticked`);
  }
});

test('"none of them are true" is not confused with "never asked"', () => {
  // An empty string is what a client predating this field posts, and those
  // have to keep the historical defaults. '-' is a deliberate answer.
  assert.ok(parseTrustClaims('', 'Plumbing').length > 0, 'an old client lost its claims');
  assert.ok(parseTrustClaims(undefined, 'Plumbing').length > 0);
  assert.deepStrictEqual(parseTrustClaims(NONE_TICKED, 'Plumbing'), [],
    'unticking everything silently restored the defaults');
});

test('unticking a claim also removes it from the prose', () => {
  // "family owned and operated" appears twice — once in the grid and once as
  // something paragraph 2 must cover. Removing it from one and not the other
  // is worse than not having the checkbox at all.
  const on = aboutPrompt('Plumbing');
  assert.ok(/family owned and operated/.test(on), 'precondition failed');

  const off = aboutPrompt('Plumbing', { trustClaims: 'cards,licensed,sameDay,estimates' });
  assert.ok(!/family owned and operated/.test(off),
    'the claim is still asserted in paragraph 2 after being unticked');
});

/* =========================================================================
 * 5. The claims that must never be generated
 * ====================================================================== */

console.log('\nNothing regulated reaches a medical or legal page');

// Phrases that are ordinary marketing for a contractor and a problem for a
// practice: a warranty on a person's body, an estimate for a consultation, an
// unqualified rating claim on a site governed by advertising rules.
const BANNED = {
  medical: [
    /workmanship warranty/i,
    /free onsite estimates?/i,
    /5-star rated/i,
    /same-day service available/i,
    /accredited by local authorities/i,
    /licensed, insured and bonded/i,
    /\bhomeowner\b/i,
    /written estimate/i,
  ],
  professional: [
    /workmanship warranty/i,
    /free onsite estimates?/i,
    /5-star rated/i,
    /same-day service available/i,
    /accredited by local authorities/i,
    /licensed, insured and bonded/i,
    /\bhomeowner\b/i,
    /written estimate/i,
  ],
  project: [
    /workmanship warranty/i,
    /free onsite estimates?/i,
    /5-star rated/i,
    /accredited by local authorities/i,
    /licensed, insured and bonded/i,
    /\bhomeowner\b/i,
  ],
  generic: [
    /workmanship warranty/i,
    /free onsite estimates?/i,
    /5-star rated/i,
    /accredited by local authorities/i,
    /licensed, insured and bonded/i,
    /\bhomeowner\b/i,
  ],
};

for (const shape of ['medical', 'professional', 'project', 'generic']) {
  const labels = shape === 'generic' ? ['Yoga Studio'] : byShape(shape);

  test(`${shape}: no trades claim survives into any prompt`, () => {
    for (const label of labels) {
      // Every claim ticked — the worst case, not the default one.
      const everything = (TRUST_POINTS[shape].optIn || []).map(c => c.id).join(',');
      const prompts = [
        ['about', aboutPrompt(label, { trustClaims: everything, is24Hours: true })],
        ['service', servicePrompt(label)],
        ['location', locationPrompt(label, 5)],
      ];

      for (const [which, text] of prompts) {
        for (const banned of BANNED[shape]) {
          assert.ok(!banned.test(text),
            `${label} ${which} page matched ${banned}`);
        }
      }
    }
  });
}

test('the About prompt no longer asserts credentials as fact', () => {
  // It used to say: "Every business on this platform is genuinely licensed,
  // insured, bonded and accredited, and holds a 5-star rating, so those claims
  // are accurate." Nobody had checked that about the business being written.
  for (const label of ['Plumbing', 'Dentist', 'Law Firm', 'Web Design', 'Yoga Studio']) {
    assert.ok(!/those claims are accurate/i.test(aboutPrompt(label)), label);
    assert.ok(!/genuinely licensed/i.test(aboutPrompt(label)), label);
  }
});

test('a medical page is told not to promise an outcome', () => {
  for (const label of byShape('medical')) {
    const about = aboutPrompt(label);
    const service = servicePrompt(label);
    assert.ok(/painless|guaranteed|promise an outcome|Do not promise a result/i.test(about + service),
      `${label} carries no rule against promising a result`);
  }
});

test('a legal page is told not to predict a result', () => {
  for (const label of byShape('professional')) {
    const text = aboutPrompt(label) + servicePrompt(label);
    assert.ok(/predict/i.test(text), `${label} carries no rule against predicting an outcome`);
    assert.ok(/testimonial/i.test(text), `${label} carries no rule about testimonials`);
  }
});

test('the contingency claim is never on by default', () => {
  // True only of some practices, and most states require a costs disclaimer
  // printed alongside it.
  const entry = TRUST_POINTS.professional.optIn.find(c => c.id === 'contingency');
  assert.ok(entry, 'the contingency claim is missing');
  assert.strictEqual(entry.default, false, 'contingency billing defaults to ON');
  assert.ok(entry.note && /disclaimer/i.test(entry.note), 'no warning is shown to the owner');
  assert.ok(!trustPoints('Law Firm', {}).pool.includes(entry.label));
});

/* =========================================================================
 * 5b. Headings, and where the service cards live
 * ====================================================================== */

console.log('\nThe services section');

test('the heading names the trade', () => {
  assert.strictEqual(servicesHeading('Plumbing'), 'Plumbing Services We Offer');
  assert.strictEqual(servicesHeading('Lemon Law'), 'Lemon Law Services We Offer');
  assert.strictEqual(servicesHeading('Physical Therapy'), 'Physical Therapy Services We Offer');
});

test('the heading uses the trade, not the job title', () => {
  // titleFor('Dentist') is "Dentist", and "Dentist Services We Offer" is not a
  // sentence. Same for "Electrician Services We Offer".
  assert.strictEqual(servicesHeading('Dentist'), 'Dental Services We Offer');
  assert.strictEqual(servicesHeading('Electrician'), 'Electrical Services We Offer');
  assert.strictEqual(servicesHeading('Chiropractor'), 'Chiropractic Services We Offer');
  assert.strictEqual(servicesHeading('Law Firm'), 'Legal Services We Offer');
});

test('every type produces a heading that reads as English', () => {
  for (const entry of BUSINESS_TYPES) {
    const h = servicesHeading(entry.label);
    assert.ok(h.endsWith(' Services We Offer'), entry.label);
    assert.ok(!/\b(\w+)\s+\1\b/i.test(h), `"${h}" repeats a word`);
    // "Services Services We Offer"
    assert.ok(!/Services Services/i.test(h), `"${h}"`);
  }
});

test('an unknown type still gets a usable heading', () => {
  assert.strictEqual(servicesHeading('Yoga Studio'), 'Yoga Studio Services We Offer');
  assert.strictEqual(servicesHeading(''), 'Services We Offer');
});

test('the About prompt asks for that exact heading', () => {
  const prompt = aboutPrompt('Lemon Law');
  assert.ok(prompt.includes("'Lemon Law Services We Offer'"), 'the heading is not requested');
  assert.ok(prompt.includes('"Lemon Law Services We Offer"'), 'the JSON skeleton disagrees');
});

test('the numbered list and the JSON skeleton agree on section order', () => {
  // They did not. The list said 2 = "What Makes Us Stand Out?" and 3 =
  // "Services We Offer", while the JSON skeleton said the opposite. The model
  // followed the skeleton, so the services copy landed in section2 — and the
  // service cards, which the template nests in a fixed section, ended up under
  // the wrong heading. Whichever the model follows, it has to get one answer.
  const prompt = aboutPrompt('Plumbing');

  const listServices = prompt.indexOf("2. 'Plumbing Services We Offer'");
  const listStandOut = prompt.indexOf("3. 'What Makes Us Stand Out?'");
  assert.ok(listServices > -1, 'services is not section 2 in the list');
  assert.ok(listStandOut > -1, 'stand out is not section 3 in the list');

  const skeleton = prompt.slice(prompt.indexOf('"section2"'));
  const jsonServices = skeleton.indexOf('Plumbing Services We Offer');
  const jsonStandOut = skeleton.indexOf('What Makes Us Stand Out?');
  assert.ok(jsonServices > -1 && jsonStandOut > -1, 'a heading is missing from the skeleton');
  assert.ok(jsonServices < jsonStandOut, 'the skeleton still has them the other way round');
});

test('the service cards sit in the services section, once', () => {
  const tpl = fs.readFileSync(path.join(__dirname, 'src', 'aboutUsTemplate.html'), 'utf8');

  assert.strictEqual((tpl.match(/\{\{SERVICE_CARDS\}\}/g) || []).length, 1,
    'the placeholder appears more than once');

  const cards = tpl.indexOf('{{SERVICE_CARDS}}');
  const section2 = tpl.indexOf('class="bg-secondary-subtle text-two-images-section section-2"');
  const section3 = tpl.indexOf('class="bg-secondary-subtle text-two-images-section section-3"');

  assert.ok(section2 > -1 && section3 > section2, 'the template sections moved');
  assert.ok(cards > section2 && cards < section3,
    'the cards are not inside section-2 — they are the services, not "what makes us stand out"');
});

test('the WordPress model nests the cards in the same section as the HTML', () => {
  // The exported theme and the downloaded site have drifted on exactly this
  // before. Moving the placeholder without moving nestIn is how it happens.
  const src = fs.readFileSync(path.join(__dirname, 'utils', 'buildAboutUsPage.js'), 'utf8');
  assert.ok(/serviceCardsSection\(serviceCards,\s*\{\s*nestIn:\s*'section2'\s*\}\)/.test(src),
    'nestIn still points at the old section');
  assert.ok(/findIndex\(sec => sec\.key === 'section2'\)/.test(src),
    'the model inserts the cards after the wrong section');
});

test('the prompt forbids the name-then-trade doubling', () => {
  // "San Jose Lemon Law Lemon Law Attorney services are available" shipped.
  assert.ok(/straight in front of the trade/i.test(aboutPrompt('Lemon Law')));
});

/* =========================================================================
 * 5c. Alt text follows the photographs
 * ====================================================================== */

console.log('\nAlt text');

test('Lemon Law gets the alt text for the images it actually uses', () => {
  const { buildAltText } = require('./utils/buildAltText');

  const lemon = buildAltText(GLOBALS('Lemon Law', { siteMode: 'rankfast' }), 'aboutIndex');
  const law = buildAltText(GLOBALS('Law Firm', { siteMode: 'rankfast' }), 'aboutIndex');

  assert.ok(Object.keys(lemon).length > 0,
    'every image on a Lemon Law site ships with alt="" — altText/lemon-law.js does not exist');
  assert.deepStrictEqual(lemon, law, 'the two disagree despite sharing photographs');
});

test('alt text and photographs come from the same folder', () => {
  const alt = fs.readFileSync(path.join(__dirname, 'utils', 'buildAltText.js'), 'utf8');
  const about = fs.readFileSync(path.join(__dirname, 'utils', 'buildAboutUsPage.js'), 'utf8');

  assert.ok(/imageFolderFor\(/.test(alt),
    'buildAltText still slugifies the type, so a shared folder gets no alt text');
  assert.ok(/const businessType = imageFolderFor\(/.test(about),
    'the About page still builds its image paths from slugify() — Lemon Law finds no hero images');
});

test('Law Firm is unlisted until it has photographs of its own', () => {
  // src/predefined-images/law-firm/ and utils/altText/law-firm.js are both
  // lemon-car imagery, from when "Law Firm" meant lemon law. Offering the
  // split-out general practice in the dropdown would hand it those photos.
  const entry = BUSINESS_TYPES.find(t => t.label === 'Law Firm');
  assert.strictEqual(entry.listed, false, 'Law Firm is selectable but has lemon law photographs');
  assert.strictEqual(businessShape('law office'), 'professional', 'it must still resolve');
});

/* =========================================================================
 * 5d. Wording the model is not allowed to improve
 * ====================================================================== */

console.log('\nTrust point wording');

test('a regulated shape is told to copy the strings verbatim', () => {
  // On a real law firm build the model turned "confidential case review" into
  // "Free confidential case review". It invented the word "free", which on an
  // attorney's site is a fee claim nobody ticked a box for.
  for (const label of ['Dentist', 'Lemon Law', 'Web Design', 'Yoga Studio']) {
    const prompt = aboutPrompt(label, { trustClaims: 'freeConsult,licensed,cards' });
    assert.ok(/EXACTLY as written above, word for word/.test(prompt), label);
    assert.ok(/especially not a\s+price or availability word/.test(prompt), label);
    assert.ok(!/Write those as benefits/.test(prompt),
      `${label} is still told to paraphrase the list`);
  }
});

test('home still writes them as benefits', () => {
  // Unchanged on purpose — this is the copy existing customers already have.
  const prompt = aboutPrompt('Plumbing');
  assert.ok(/Write those as benefits/.test(prompt));
  assert.ok(!/EXACTLY as written above/.test(prompt));
});

/* =========================================================================
 * 5e. Interlinks are sentences, not nested paragraphs
 * ====================================================================== */

console.log('\nInterlink markup');

test('no injector appends a block element into a paragraph', () => {
  // Every consumer wraps these strings — the template writes
  // <p>{{SECTION2_P2}}</p> — so appending "<p>Learn more...</p>" produced
  // <p>text<p>Learn more...</p></p>. Browsers close the outer <p> early, so
  // the markup, the DOM and the tree the WordPress exporter walks were three
  // different shapes.
  for (const file of ['injectIndexInterlinks.js', 'injectPagesInterlinks.js']) {
    const src = fs.readFileSync(path.join(__dirname, 'utils', file), 'utf8');
    assert.ok(!/originalParagraph\}<p>/.test(src),
      `${file} still nests a <p> inside a paragraph`);
  }
});

test('the index fallback link is a sentence', () => {
  const sections = { section2: { paragraphs: ['first', 'Some copy with no matching phrase'] } };
  const out = injectIndexInterlinks(
    { siteMode: 'lead', location: 'Cedar Park, TX' },
    [{ filename: 'water-heater-repair.html' }],
    ['water-heater-repair'],
    sections
  );

  const p = out.section2.paragraphs[1];
  assert.ok(/<a href=/.test(p), 'no link was injected');
  assert.ok(!/<p>/.test(p), `a paragraph tag was appended: ${p}`);
  assert.ok(/no matching phrase\. Learn more/.test(p), `the join is wrong: ${p}`);
});

test('the pages fallback link is a sentence too', () => {
  const sections = { s: { paragraphs: ['Some copy with no matching phrase', 'second'] } };
  const out = injectPagesInterlinks(
    { businessType: 'Plumbing', businessName: 'Acme', location: 'Cedar Park, TX' },
    [], { filename: 'x.html' },
    [{ slug: 'contact', href: 'contact.html' }],
    sections, 'Cedar Park, TX'
  );

  const p = out.s.paragraphs[0];
  assert.ok(/<a href="contact.html">/.test(p), 'no contact link');
  assert.ok(!/<p>/.test(p), `a paragraph tag was appended: ${p}`);
});

test('a paragraph already ending in punctuation does not gain a second full stop', () => {
  assert.strictEqual(appendSentence('It ended here.'), 'It ended here.');
  assert.strictEqual(appendSentence('It ended here'), 'It ended here.');
  assert.strictEqual(appendSentence('Did it?'), 'Did it?');
  assert.strictEqual(appendSentence('  spaced  '), 'spaced.');
  assert.strictEqual(appendSentence(''), '');
});

test('the appended contact line suits the business', () => {
  // "for a free, no-obligation quote" is a trades sentence. On a dental
  // practice it is the wrong verb, and on a law firm "free" is a fee claim.
  const tail = (businessType) => {
    const sections = { s: { paragraphs: ['Some copy with no matching phrase', 'second'] } };
    return injectPagesInterlinks(
      { businessType, businessName: 'Acme', location: 'Cedar Park, TX' },
      [], { filename: 'x.html' },
      [{ slug: 'contact', href: 'contact.html' }],
      sections, 'Cedar Park, TX'
    ).s.paragraphs[0];
  };

  assert.ok(/free, no-obligation quote/.test(tail('Plumbing')), 'home wording changed');
  assert.ok(/book an appointment/.test(tail('Dentist')), tail('Dentist'));
  assert.ok(/initial consultation/.test(tail('Lemon Law')), tail('Lemon Law'));

  for (const label of ['Dentist', 'Lemon Law', 'Yoga Studio']) {
    assert.ok(!/quote/.test(tail(label)), `${label} is still offered a quote`);
  }
});

/* =========================================================================
 * 5f. Uploaded files keep a usable extension
 * ====================================================================== */

console.log('\nUpload extensions');

test('a named upload keeps its own extension', () => {
  assert.strictEqual(imageExtension({ originalname: 'logo.png', mimetype: 'image/png' }), '.png');
  assert.strictEqual(imageExtension({ originalname: 'LOGO.WEBP', mimetype: 'image/webp' }), '.webp');
  // Not normalised to .jpg — renaming a file nobody asked to rename is its own
  // small surprise.
  assert.strictEqual(imageExtension({ originalname: 'a.jpeg', mimetype: 'image/jpeg' }), '.jpeg');
});

test('an upload with no extension falls back to its MIME type', () => {
  // This is the bug: <img src="assets/san-jose-lemon-law-logo">, a file on disk
  // with no extension and a URL with no extension. The build succeeded and the
  // logo did not load.
  assert.strictEqual(imageExtension({ originalname: 'image', mimetype: 'image/png' }), '.png');
  assert.strictEqual(imageExtension({ originalname: 'blob', mimetype: 'image/jpeg' }), '.jpg');
  assert.strictEqual(imageExtension({ originalname: '', mimetype: 'image/webp' }), '.webp');
  assert.strictEqual(imageExtension({ originalname: 'logo.v2', mimetype: 'image/png' }), '.png');
  // Some clients send a charset alongside the type.
  assert.strictEqual(imageExtension({ originalname: 'x', mimetype: 'image/png; charset=binary' }), '.png');
});

test('it never returns an empty string', () => {
  for (const file of [{}, null, undefined, { originalname: 'x', mimetype: 'application/octet-stream' }]) {
    const ext = imageExtension(file);
    assert.ok(ext && ext.startsWith('.'), `got ${JSON.stringify(ext)}`);
  }
});

test('runGeneration uses it rather than path.extname', () => {
  const src = fs.readFileSync(path.join(__dirname, 'utils', 'runGeneration.js'), 'utf8');
  assert.ok(/const ext = imageExtension\(file\)/.test(src),
    'the upload loop still reads the extension straight off originalname');
  assert.ok(!/const ext = path\.extname\(file\.originalname\)/.test(src));
});

/* =========================================================================
 * 5g. Service pages differ from each other
 * ====================================================================== */

console.log('\nService page variety');

test('every service page on a site gets a different set of topics', () => {
  // The bug: all four section briefs were fixed, so ten service pages were
  // the same four topics in the same order and only the trade nouns changed.
  // Two related services — Water Heater Repair and Water Heater Installation
  // — got near-identical prompts and came back near-identical, which is how
  // Google ends up picking its own canonical for one of them.
  //
  // 5 openers and 7 body topics with a stride of 3: the combination repeats
  // only every 35 pages, and no site has that many services.
  for (const shape of SHAPES) {
    const seen = new Set();
    for (let i = 0; i < 12; i++) {
      seen.add(topicsFor(shape, i).map(t => t.id).join('|'));
    }
    assert.strictEqual(seen.size, 12, `${shape} repeats a topic set within 12 pages`);
  }
});

test('adjacent pages share at most one body topic', () => {
  // Adjacent is where it matters: similar services tend to sit next to each
  // other in the list the customer types. A stride of 1 would have every
  // consecutive pair sharing two of three.
  for (const shape of SHAPES) {
    for (let i = 0; i < 12; i++) {
      const a = new Set(topicsFor(shape, i).slice(1).map(t => t.id));
      const b = topicsFor(shape, i + 1).slice(1).map(t => t.id);
      const shared = b.filter(id => a.has(id));
      assert.ok(shared.length <= 1,
        `${shape} pages ${i}/${i + 1} share ${shared.length} body topics: ${shared}`);
    }
  }
});

test('no shape is short of topics', () => {
  // A topic skipped for one shape left it 6 body topics instead of 7, and a
  // stride of 3 into 6 has a period of 2 — a dentist's ten service pages
  // cycled through two topic sets. The rotation only works while every shape
  // has the same coprime count.
  for (const shape of SHAPES) {
    const available = BODY.filter(t => !(t.skipShapes || []).includes(shape));
    assert.strictEqual(available.length, BODY.length,
      `${shape} has ${available.length} body topics, not ${BODY.length}`);
  }
  assert.strictEqual(BODY.length, 7);
  assert.strictEqual(OPENERS.length, 5);
});

test('the opener always leads and always carries the SEO heading', () => {
  for (const shape of SHAPES) {
    for (let i = 0; i < 8; i++) {
      const [first] = topicsFor(shape, i);
      assert.ok(OPENERS.some(o => o.id === first.id),
        `${shape} page ${i} opens on a body topic`);
    }
  }

  const prompt = servicePrompt('Plumbing', 0);
  assert.ok(/This section leads the page, so write an SEO-first heading/.test(prompt));
});

test('two pages for the same business produce different prompts', () => {
  const a = servicePrompt('Plumbing', 0);
  const b = servicePrompt('Plumbing', 1);
  assert.notStrictEqual(a, b, 'page 0 and page 1 get identical prompts');

  // Not merely different — different TOPICS, which is the point.
  const titlesOf = p => [...p.matchAll(/^\d\. (.+)$/gm)].map(m => m[1]);
  assert.notDeepStrictEqual(titlesOf(a), titlesOf(b));
});

test('the heading style rotates independently of the topics', () => {
  // So that two pages which happen to share a topic still do not share a
  // heading shape. 5 openers, 7 body topics, 4 heading styles.
  const styles = new Set();
  for (let i = 0; i < 4; i++) {
    const m = servicePrompt('Plumbing', i).match(/HEADINGS on this page: ([^.]+)\./);
    assert.ok(m, `page ${i} carries no heading style`);
    styles.add(m[1]);
  }
  assert.strictEqual(styles.size, 4, 'the heading style does not vary');
});

test('an out-of-range or missing index still builds a page', () => {
  // pageIndex arrives from Object.entries(), so it is a string, and a resumed
  // job could hand over anything.
  for (const idx of [undefined, null, -1, '3', 999, NaN]) {
    const topics = topicsFor('home', idx);
    assert.strictEqual(topics.length, 4, String(idx));
    assert.ok(topics.every(t => t && t.id), String(idx));
  }
});

console.log('\nService page wording follows the shape');

test('the reader is named correctly for the business', () => {
  // "What a homeowner should check before hiring anyone" was being asked on a
  // dental page.
  assert.strictEqual(SHAPE_WORDS.home.who, 'homeowner');
  assert.strictEqual(SHAPE_WORDS.medical.who, 'patient');
  assert.strictEqual(SHAPE_WORDS.professional.who, 'client');

  for (const shape of ['medical', 'professional', 'project', 'generic']) {
    const label = shape === 'generic'
      ? 'Yoga Studio'
      : BUSINESS_TYPES.find(t => t.shape === shape).label;

    for (let i = 0; i < 8; i++) {
      assert.ok(!/\bhomeowner\b/i.test(servicePrompt(label, i)),
        `${label} page ${i} calls the reader a homeowner`);
    }
  }
});

test('a medical or legal page is never asked for a price', () => {
  // The cost topic is offered to every shape — suppressing the price TABLE is
  // about publishing figures, while explaining how fees or cover work is what
  // those visitors most want. But the brief itself has to forbid the number.
  for (const shape of ['medical', 'professional']) {
    const label = BUSINESS_TYPES.find(t => t.shape === shape).label;

    for (let i = 0; i < 8; i++) {
      const prompt = servicePrompt(label, i);
      if (!/What it costs, and what moves it/.test(prompt)) continue;

      assert.ok(/Do NOT state any (price|rate)/.test(prompt),
        `${label} page ${i} asks for cost detail with no prohibition on figures`);
      assert.ok(!/realistic RANGES/.test(prompt),
        `${label} page ${i} is asked for price ranges`);
    }
  }
});

test('the cost topic does reach a medical page at all', () => {
  // Guards the test above from passing vacuously if the topic were skipped.
  const reached = [...Array(8).keys()]
    .some(i => /What it costs, and what moves it/.test(servicePrompt('Dentist', i)));
  assert.ok(reached, 'the cost topic never appears, so the rule above proves nothing');
});

test('the anchor phrases still land in sections 2 and 3', () => {
  const prompt = servicePrompt('Plumbing', 0);
  assert.strictEqual((prompt.match(/Include this exact lowercase phrase:/g) || []).length, 2);
});

test('runGeneration passes the index', () => {
  const src = fs.readFileSync(path.join(__dirname, 'utils', 'runGeneration.js'), 'utf8');
  assert.ok(/generatePagesContent\(globalValues, page, contentKeywords, Number\(index\)\)/.test(src),
    'every service page still gets pageIndex 0 — the rotation never happens');
});

test('the retry keeps the same index', () => {
  // The retry used to drop an argument and rebuild the prompt for the wrong
  // thing entirely; the same class of bug is one positional argument away here.
  const src = fs.readFileSync(path.join(__dirname, 'utils', 'generatePagesContent.js'), 'utf8');
  assert.ok(/generatePagesContent\(globalValues, page, pagesInterlinks, pageIndex, attempt \+ 1\)/.test(src),
    'a retried page would be built from a different topic set than the first attempt');
});

/* =========================================================================
 * 5h. The home page case study
 * ====================================================================== */

console.log('\nCase study');

test('the heading matches the services heading wording', () => {
  // A site must not say "Electrical Services We Offer" in one section and
  // "Electrician Services" in the next — both read from servicesLabel.
  assert.strictEqual(caseStudyHeading('Plumbing', 'Leander, TX'),
    'Case Study of Our Plumbing Services in Leander, TX');
  assert.strictEqual(caseStudyHeading('Electrician', 'Leander, TX'),
    'Case Study of Our Electrical Services in Leander, TX');
  assert.strictEqual(caseStudyHeading('Web Design', 'Leander, TX'),
    'Case Study of Our Web Design Services in Leander, TX');
});

test('a missing location does not leave a dangling "in"', () => {
  assert.strictEqual(caseStudyHeading('Plumbing', ''), 'Case Study of Our Plumbing Services');
  assert.strictEqual(caseStudyHeading('Plumbing', '   '), 'Case Study of Our Plumbing Services');
});

test('medical and legal practices get no case study', () => {
  // For those it is a past-results claim — the most restricted thing in bar
  // advertising, and a treatment-outcome claim for a practice.
  assert.strictEqual(wantsCaseStudy('Plumbing'), true);
  assert.strictEqual(wantsCaseStudy('Web Design'), true);
  assert.strictEqual(wantsCaseStudy('Dentist'), false);
  assert.strictEqual(wantsCaseStudy('Lemon Law'), false);
  assert.strictEqual(wantsCaseStudy('Law Firm'), false);

  assert.ok(!SHAPES_WITH_CASE_STUDY.includes('medical'));
  assert.ok(!SHAPES_WITH_CASE_STUDY.includes('professional'));
});

test('an unrecognised type gets no case study either', () => {
  // The WordPress business_type field accepts anything. "Med Spa",
  // "Optometrist", "Counseling" and "Bail Bonds" all used to resolve to
  // generic, and generic used to get a case study — a treatment-outcome claim
  // on a health business, from a field nobody validates.
  //
  // The aliases below catch the common ones, but an alias list can never be
  // complete. This is the lock that does not depend on having thought of the
  // word first.
  assert.ok(!SHAPES_WITH_CASE_STUDY.includes('generic'),
    'an unrecognised business type can be given a case study');
  assert.strictEqual(wantsCaseStudy('Gutter Cleaning'), false);
  assert.strictEqual(wantsCaseStudy('Something Nobody Listed'), false);
});

test('health and legal free text resolves away from generic', () => {
  const medical = [
    'Med Spa', 'Optometrist', 'Counseling', 'Veterinarian', 'Massage Therapy',
    'Podiatrist', 'Acupuncture', 'Wellness Center', 'Home Health Care',
    'Speech Therapy', 'Psychologist', 'Nutritionist',
  ];
  for (const t of medical) {
    assert.strictEqual(businessShape(t), 'medical', `"${t}"`);
  }

  const legal = ['Paralegal', 'Bail Bonds', 'Notary Public', 'Immigration Services', 'Estate Planning'];
  for (const t of legal) {
    assert.strictEqual(businessShape(t), 'professional', `"${t}"`);
  }

  // And none of them can reach a case study, by either route.
  for (const t of [...medical, ...legal]) {
    assert.strictEqual(wantsCaseStudy(t), false, `"${t}"`);
  }
});

test('the catch-all types stay out of the dropdown', () => {
  // They have no photographs. They exist to resolve free text, not to be
  // picked.
  for (const label of ['Health Practice', 'Legal Services']) {
    const entry = BUSINESS_TYPES.find(t => t.label === label);
    assert.ok(entry, `${label} is missing`);
    assert.strictEqual(entry.listed, false, `${label} is selectable but has no photos`);
  }
});

test('the case study is anchored in the area but not at a street', () => {
  // A neighbourhood or landmark is a statement about the service AREA; a
  // street and number identifies a household. The line is drawn at the street.
  const prompt = caseStudyPrompt({
    businessType: 'Plumbing', businessName: 'Acme', location: 'Leander, TX',
  });

  assert.ok(/ANCHOR IT AT A NAMED PLACE/.test(prompt),
    'the prompt no longer asks for a named place');
  assert.ok(/Do NOT give a street name, a house number or an address/.test(prompt),
    'the street ban was lost along with the vague-area ban');

  // The kinds of place the customer asked for by name.
  for (const kind of ['school', 'park', 'shopping centre', 'restaurant', 'highway']) {
    assert.ok(new RegExp(kind, 'i').test(prompt), `no "${kind}" among the suggested places`);
  }
});

test('the landmark has to be near the business, not merely famous', () => {
  // One live failure, and one guard added on top of it.
  //
  //   v1  "describe the area in terms needing no local knowledge" if unsure
  //       -> "a home in an older part of Leander, TX". Empty, and it took that
  //          exit every time.
  //   v2  named the kinds of place wanted and ruled out the vague answer
  //       -> "a home a few minutes from the Alamo" for a SAN ANTONIO build,
  //          which is correct. The Alamo is in San Antonio.
  //
  // The distance rule is a guard rather than a fix: "widen the radius" has no
  // natural stopping point, and borrowing a famous landmark from another city
  // reads as true while being false. Not observed, cheap to rule out.
  const prompt = caseStudyPrompt({
    businessType: 'Concrete Contractor', businessName: 'Acme', location: 'Leander, TX',
  });

  assert.ok(/IT MUST BE WITHIN A FEW MINUTES OF Leander, TX/.test(prompt),
    'nothing constrains the landmark to the service area');
  assert.ok(/"An older part of Leander, TX" is NOT good enough/.test(prompt),
    'the vague failure is no longer named as an example');

  // A famous landmark is not the problem — a borrowed one is.
  assert.ok(/A famous landmark IS the right answer when it is genuinely in/.test(prompt),
    'the prompt now discourages famous landmarks even in the right city');

  // The fallback still yields a real place rather than a shrug.
  assert.ok(/use a road or highway\s+that actually runs through it/.test(prompt),
    'the fallback no longer keeps a real place name');

  assert.ok(/Do NOT invent a place/.test(prompt));
  assert.ok(/Do NOT name a place that exists somewhere else/.test(prompt),
    'a real landmark in the wrong city is still allowed');
});

test('the prompt forbids everything that would make it a real record', () => {
  // A case study is a claim about work that was done. Left alone the model
  // writes a named customer on a named street with a dollar figure saved —
  // a fabricated record rather than marketing copy.
  const prompt = caseStudyPrompt({
    businessType: 'Plumbing', businessName: 'Acme', location: 'Leander, TX',
  });

  for (const rule of [
    /Do NOT name a customer/i,
    /Do NOT give a street name/i,
    /Do NOT give a date/i,
    /Do NOT state a price/i,
    /Do NOT quote anybody/i,
    /REPRESENTATIVE\s+job/,
  ]) {
    assert.ok(rule.test(prompt), `the prompt is missing: ${rule}`);
  }
});

test('the section renders nothing rather than an empty heading', () => {
  assert.strictEqual(buildCaseStudySection(null), '');
  assert.strictEqual(buildCaseStudySection(undefined), '');
  assert.strictEqual(buildCaseStudySection({}), '');
  assert.strictEqual(buildCaseStudySection({ heading: 'A heading', paragraphs: [] }), '');
  assert.strictEqual(buildCaseStudySection({ heading: 'A heading', paragraphs: ['  '] }), '');
});

test('the section renders a heading and its paragraph', () => {
  const html = buildCaseStudySection({
    heading: 'Case Study of Our Plumbing Services in Leander, TX',
    paragraphs: ['The first sign was lukewarm water at every tap.'],
  });

  assert.ok(/<h2>Case Study of Our Plumbing Services in Leander, TX<\/h2>/.test(html));
  assert.ok(/<p>The first sign was lukewarm water at every tap\.<\/p>/.test(html));
  assert.ok(/class="case-study-section"/.test(html));
});

test('the heading is escaped but the paragraph is not', () => {
  // The paragraph may carry an <a> from interlink injection, exactly like
  // every other section on this page. The heading is built here, so escaping
  // it costs nothing.
  const html = buildCaseStudySection({
    heading: 'Smith & Sons "Plumbing"',
    paragraphs: ['See our <a href="x.html">water heater repair</a> page.'],
  });

  assert.ok(html.includes('Smith &amp; Sons &quot;Plumbing&quot;'), 'the heading is unescaped');
  assert.ok(html.includes('<a href="x.html">'), 'the paragraph was escaped and the link is broken');
});

test('it sits above the FAQ on the page', () => {
  const tpl = fs.readFileSync(path.join(__dirname, 'src', 'aboutUsTemplate.html'), 'utf8');

  const caseStudy = tpl.indexOf('{{CASE_STUDY}}');
  const faq = tpl.indexOf('{{FAQ_SECTION}}');

  assert.ok(caseStudy > -1, 'the placeholder is missing from the home template');
  assert.ok(faq > -1);
  assert.ok(caseStudy < faq, 'the case study renders below the FAQ');
});

test('it is on the home page only', () => {
  // A service page is already about one service and a location page about one
  // town; a case study on either is a third telling of the same story.
  for (const file of ['template.html', 'locationPagesTemplate.html', 'contactTemplate.html']) {
    const tpl = fs.readFileSync(path.join(__dirname, 'src', file), 'utf8');
    assert.ok(!tpl.includes('{{CASE_STUDY}}'), `${file} carries a case study`);
  }
});

test('the WordPress model carries it, in the same place', () => {
  // As a plain TEXT section: the renderer and the meta boxes already handle
  // TEXT, so the owner can edit the paragraph in wp-admin and nothing on the
  // theme side needed changing.
  const src = fs.readFileSync(path.join(__dirname, 'utils', 'buildAboutUsPage.js'), 'utf8');

  assert.ok(/key: 'caseStudy'/.test(src), 'the case study never reaches the exported theme');
  assert.ok(/type: CM\.SECTION_TYPES\.TEXT/.test(src.slice(src.indexOf("key: 'caseStudy'"))),
    'it is pushed as a section type the renderer does not know');

  const pushIndex = src.indexOf("key: 'caseStudy'");
  const faqIndex = src.indexOf('CM.faqSection(');
  assert.ok(pushIndex < faqIndex,
    'the exported theme puts the case study after the FAQ while the static site puts it before');
});

test('runGeneration generates one and hands it over', () => {
  const src = fs.readFileSync(path.join(__dirname, 'utils', 'runGeneration.js'), 'utf8');
  assert.ok(/await generateCaseStudy\(\{/.test(src), 'nothing generates a case study');
  assert.ok(/pricing,\s*\n\s*caseStudy\s*\n\s*\);/.test(src),
    'the case study is generated and then not passed to buildAboutUsPage');
});

/* =========================================================================
 * 6. FAQs
 * ====================================================================== */

console.log('\nFAQs follow the shape');

test('a dentist is not asked how to book a job', () => {
  const qs = getFixedFaqQuestions({ businessName: 'Smile Dental', businessType: 'Dentist' });
  assert.strictEqual(qs.length, 2);
  assert.ok(!/book a job/i.test(qs.join(' ')), qs.join(' | '));
  assert.ok(/patient/i.test(qs.join(' ')), qs.join(' | '));
});

test('a dentist is not promised a written estimate', () => {
  const answers = getFixedFaqFallbacks({
    businessName: 'Smile Dental', businessType: 'Dentist', location: 'Cedar Park, TX',
  }).join(' ');
  assert.ok(!/written estimate/i.test(answers), answers);
  assert.ok(!/urgent dentist issue/i.test(answers), answers);
});

test('every shape has both a question set and a fallback pair', () => {
  for (const shape of SHAPES) {
    const label = shape === 'generic'
      ? 'Yoga Studio'
      : BUSINESS_TYPES.find(t => t.shape === shape).label;

    const qs = getFixedFaqQuestions({ businessName: 'Acme', businessType: label });
    const fb = getFixedFaqFallbacks({ businessName: 'Acme', businessType: label, location: 'Cedar Park, TX' });

    assert.strictEqual(qs.length, 2, `${shape} questions`);
    assert.strictEqual(fb.length, 2, `${shape} fallbacks`);
    assert.ok(qs.every(Boolean) && fb.every(Boolean), `${shape} has a blank entry`);
  }
});

test('the home questions and answers are unchanged', () => {
  assert.deepStrictEqual(
    getFixedFaqQuestions({ businessName: 'Acme', businessType: 'Plumbing' }),
    ['How do I book a job with Acme?', 'How quickly can you respond to an urgent plumbing issue?']
  );
});

test('a practice is not asked about driveways and permits', () => {
  const trades = themesFor('Plumbing');
  assert.ok(/driveways/.test(trades.join(' ')), 'precondition failed');

  for (const label of ['Dentist', 'Law Firm', 'Web Design', 'Yoga Studio']) {
    const themes = themesFor(label).join(' ');
    assert.ok(!/driveway|permits|housing stock|cold snap/i.test(themes), `${label}: ${themes}`);
  }
});

test('the angles and the question themes stay index-aligned', () => {
  // A town's FAQ has to be about the same thing its page copy is about, so
  // both lists must be the same length for every shape.
  for (const label of ['Plumbing', 'Dentist', 'Law Firm', 'Web Design', 'Yoga Studio']) {
    assert.strictEqual(anglesFor(label).length, themesFor(label).length, label);
  }
});

/* =========================================================================
 * 7. Vocabulary
 * ====================================================================== */

console.log('\nVocabulary');

test('no dropdown type falls through to the generic vocabulary', () => {
  // Painter, Appliance Repair, Coding and Web Design were all in the dropdown
  // with no entry, so their pages were written out of "materials, components,
  // fittings" — the abstract register createPagesPrompt exists to avoid.
  const missing = BUSINESS_TYPES
    .filter(t => !TRADE_VOCAB[t.category])
    .map(t => `${t.label} (${t.category})`);

  assert.deepStrictEqual(missing, [], `no vocabulary for: ${missing.join(', ')}`);
});

test('an unknown type still gets the generic vocabulary rather than crashing', () => {
  const prompt = servicePrompt('Yoga Studio');
  assert.ok(prompt.includes(DEFAULT_VOCAB.parts));
});

test('each vocabulary entry has all three lists filled', () => {
  for (const [category, vocab] of Object.entries(TRADE_VOCAB)) {
    for (const key of ['parts', 'symptoms', 'work']) {
      assert.ok(vocab[key] && vocab[key].length > 20, `${category}.${key} is thin`);
    }
  }
});

/* =========================================================================
 * 8. The wizard and the server agree
 *
 * The table in generateDinamycForm.js is a second copy of this registry. It
 * has to be — the form is a real multipart POST carrying an uploaded logo, so
 * the wizard cannot ask the server what to render without a second round trip.
 * Two copies is where drift lives, so read the wizard's back out and compare.
 * ====================================================================== */

console.log('\nThe wizard and the server agree');

const WIZARD = path.join(__dirname, 'public', 'js', 'generateDinamycForm.js');
const wizardSrc = fs.readFileSync(WIZARD, 'utf8');

function extractVar(name) {
  const start = wizardSrc.indexOf(`var ${name} = `);
  assert.ok(start > -1, `${name} is missing from generateDinamycForm.js`);

  const open = wizardSrc.indexOf(wizardSrc[wizardSrc.indexOf('=', start) + 2] === '[' ? '[' : '{', start);
  const openCh = wizardSrc[open];
  const closeCh = openCh === '[' ? ']' : '}';

  let depth = 0;
  let inStr = null;
  for (let i = open; i < wizardSrc.length; i++) {
    const ch = wizardSrc[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = ch; continue; }
    if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return wizardSrc.slice(open, i + 1);
    }
  }
  throw new Error(`could not find the end of ${name}`);
}

const sandbox = {};
vm.createContext(sandbox);
const wizard = vm.runInContext(`({
  labels: ${extractVar('BUSINESS_TYPE_LABELS')},
  shapes: ${extractVar('BUSINESS_TYPE_SHAPES')},
  claims: ${extractVar('TRUST_CLAIMS_BY_SHAPE')},
})`, sandbox);

test('the dropdown offers exactly the listed types, in order', () => {
  assert.deepStrictEqual([...wizard.labels], DROPDOWN_TYPES.map(t => t.label));
});

test('the unlisted types are resolvable but not selectable', () => {
  // Every dropdown type needs a photo set under src/predefined-images. A type
  // offered without one builds a complete site with no images in it, because
  // copyPageImage warns and skips rather than throwing. These exist so free
  // text arriving from the WordPress business_type field still resolves.
  const unlisted = BUSINESS_TYPES.filter(t => t.listed === false).map(t => t.label);
  assert.ok(unlisted.length, 'nothing is unlisted — has the flag been dropped?');

  for (const label of unlisted) {
    assert.ok(!wizard.labels.includes(label), `${label} is selectable but has no photos`);
    assert.notStrictEqual(businessShape(label), 'generic', `${label} no longer resolves`);
  }
});

test('every selectable type maps to a photo folder', () => {
  for (const entry of DROPDOWN_TYPES) {
    const folder = imageFolderFor(entry.label);
    assert.ok(folder && /^[a-z0-9-]+$/.test(folder), `${entry.label} -> "${folder}"`);
  }
  // Lemon Law reuses the law firm photographs rather than duplicating them.
  assert.strictEqual(imageFolderFor('Lemon Law'), 'law-firm');
});

test('the image folder is read from the registry, not recomputed', () => {
  const src = fs.readFileSync(path.join(__dirname, 'utils', 'copyAllPredefinedImages.js'), 'utf8');
  assert.ok(/imageFolderFor\(/.test(src),
    'copyAllPredefinedImages still slugifies the type itself, so Lemon Law finds no photos');
});

test('the dropdown now includes the medical types', () => {
  for (const label of ['Dentist', 'Doctor', 'Chiropractor', 'Physical Therapy']) {
    assert.ok(wizard.labels.includes(label), `${label} is not selectable`);
  }
});

test('the wizard agrees with the server about every type\'s shape', () => {
  for (const entry of BUSINESS_TYPES) {
    if (entry.listed === false) continue;
    assert.strictEqual(wizard.shapes[entry.label], entry.shape, entry.label);
  }
  assert.strictEqual(Object.keys(wizard.shapes).length, DROPDOWN_TYPES.length);
});

test('the wizard offers exactly the claims the server will accept', () => {
  // A box the server ignores is a promise to the owner that is not kept, and a
  // claim the server would accept but the wizard never shows can only ever be
  // set by hand.
  for (const shape of SHAPES) {
    const serverIds = TRUST_POINTS[shape].optIn
      .map(c => c.id)
      .filter(id => id !== 'open24');       // driven by the Open 24 Hours toggle
    const wizardIds = [...wizard.claims[shape]].map(c => c.id);

    assert.deepStrictEqual(wizardIds, serverIds, `${shape} claim ids`);
  }
});

test('the wizard shows the same wording the page will print', () => {
  for (const shape of SHAPES) {
    for (const claim of wizard.claims[shape]) {
      const server = TRUST_POINTS[shape].optIn.find(c => c.id === claim.id);
      assert.strictEqual(claim.label, server.label, `${shape}.${claim.id}`);
      assert.strictEqual(claim.default, !!server.default, `${shape}.${claim.id} default`);
    }
  }
});

test('the wizard warns about contingency billing where the server says to', () => {
  const claim = [...wizard.claims.professional].find(c => c.id === 'contingency');
  assert.ok(claim && claim.note, 'the costs disclaimer warning is not shown to the owner');
});

test('home is pre-ticked and nothing else is', () => {
  for (const shape of SHAPES) {
    const anyOn = [...wizard.claims[shape]].some(c => c.default);
    assert.strictEqual(anyOn, shape === 'home',
      `${shape}: default-ticked claims should only exist for home services`);
  }
});

test('the posted field is one string, not a checkbox array', () => {
  // `global[trustClaims][]` arrives nested through one body parser and flat
  // through another — this route already carries a
  // `body.global?.x ?? body['global[x]']` dance because of exactly that.
  assert.ok(wizardSrc.includes('name="global[trustClaims]"'), 'the hidden field is missing');
  assert.ok(!wizardSrc.includes('global[trustClaims][]'), 'the claims post as an array');
});

test('the sentinel for "none of them" matches on both sides', () => {
  assert.ok(wizardSrc.includes("hidden.value = on.length ? on.join(',') : '-'"),
    'the wizard no longer posts the none-ticked sentinel');
  assert.strictEqual(NONE_TICKED, '-');
});

test('runGeneration actually reads the field', () => {
  const src = fs.readFileSync(path.join(__dirname, 'utils', 'runGeneration.js'), 'utf8');
  assert.ok(/trustClaims:/.test(src), 'trustClaims never reaches globalValues');
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
