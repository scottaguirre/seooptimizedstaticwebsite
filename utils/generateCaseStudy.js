// utils/generateCaseStudy.js
//
// A short case study for the home page, above the FAQ.
//
//     Case Study of Our Plumbing Services in Leander, TX
//
// HOME PAGE ONLY. A service page is already about one service and a location
// page is already about one town; a case study on either would be a third
// telling of the same story on the same site.
//
//
// WHAT THIS WILL NOT WRITE, AND WHY
//
// A "case study" is a claim about work that was actually done. Left to itself
// the model writes one: a named customer, a street, a date, a dollar figure
// saved. None of it happened. That is a fabricated record rather than
// marketing copy, and it is the same category of thing as inventing a review.
//
// So the prompt is built around a REPRESENTATIVE job — the kind of work this
// business does, told concretely — and forbids the details that would turn it
// into a specific claim: no client name, no street or house number, no date,
// no price or saving, no quoted testimonial. That reads just as well, because
// what makes this section work is the concrete detail of the WORK, and that
// part is true of every job of its kind.
//
// A NEIGHBOURHOOD OR LANDMARK IS FINE, AND WANTED
//
// "near Devine Lake Park" is a statement about the service AREA. "on Oak Ridge
// Drive" identifies a household. The first is local relevance; the second is
// the thing that makes this a record of somebody's job. The line is drawn at
// the street, not at the place name.
//
// The first version of this instruction carried the same escape hatch
// createLocationPagesPrompt uses — "describe the area in terms needing no local
// knowledge rather than guess". It was too generous. The model took the exit
// every time and produced "a home in an older part of Leander, TX", which is
// what someone writes when they have never been there.
//
// The second version replaced that with "widen the radius", named the kinds of
// place wanted — school, park, mall, restaurant, highway — and said outright
// that "an older part of town" is not good enough. That worked: a San Antonio
// build came back with "a home a few minutes from the Alamo", which is a real,
// famous landmark in the right city.
//
// The distance rule below was added anyway, because "widen the radius" has no
// natural stopping point and the failure it invites — borrowing a famous
// landmark from a different city because it is the one you can name — reads as
// true and is not. It has not been observed; it is cheap to rule out.
//
// This is safe here in a way it would not have been a year ago because the
// About Us page has been asking for five landmarks per town all along and
// getting real ones — Leander Station, Devine Lake Park, Benbrook Ranch Park.
// The model knows these towns. It just needed to be told not to hedge.
//
// Still worth checking the first few builds for a town you know.
//
//
// NOT OFFERED TO MEDICAL OR LEGAL PRACTICES
//
// For those, a case study is a past-results claim — the most restricted thing
// in bar advertising rules, and a treatment-outcome claim for a practice. The
// section is suppressed for those shapes the same way the badges and the
// pricing table are, and the page reflows without it.

const { getOpenAI } = require('./openaiClient');
const { withRetry } = require('./withRetry');
const { parseModelJson } = require('./parseModelJson');
const { businessShape, categoryFor, servicesLabelFor } = require('./businessShape');

const WORD_TARGET = 100;

/** Which business types get one at all. */
// 'generic' is deliberately NOT here.
//
// An unrecognised business type is one nobody has checked, and the free-text
// business_type field in WordPress accepts anything — "Med Spa",
// "Optometrist", "Counseling" and "Bail Bonds" all used to land in generic.
// A case study on any of those is a treatment-outcome or past-results claim.
//
// The aliases in businessShape.js catch the common ones and route them to the
// right shape, but an alias list can never be complete. This is the lock that
// does not depend on having thought of the word first — the same reasoning
// that gives generic no badges and no pricing table.
//
// The cost is that a real trade the registry does not know — a gutter company
// typed as free text — gets no case study either. That is the right way round.
const SHAPES_WITH_CASE_STUDY = ['home', 'project'];

function wantsCaseStudy(businessType) {
  return SHAPES_WITH_CASE_STUDY.includes(businessShape(businessType));
}

/**
 * "Case Study of Our Plumbing Services in Leander, TX"
 *
 * Built from the same registry label the services heading uses, so a site does
 * not say "Electrical Services We Offer" in one section and "Electrician
 * Services" in the next.
 */
function caseStudyHeading(businessType, location) {
  const label = servicesLabelFor(businessType);
  const place = String(location || '').trim();

  return place
    ? `Case Study of Our ${label} Services in ${place}`
    : `Case Study of Our ${label} Services`;
}

function buildPrompt({ businessType, businessName, location }) {
  const category = categoryFor(businessType);

  return `
You are writing a short case study for the home page of ${businessName}, a
local ${category} business serving ${location}.

Write ONE paragraph of about ${WORD_TARGET} words describing a REPRESENTATIVE
job — the kind of work this business does regularly, told as a single concrete
example from first call to finished work.

WHAT MAKES THIS GOOD
- Name the actual problem, the actual cause, and what was done about it. The
  specifics of the WORK are what carry this paragraph.
- Include at least three concrete nouns: a component, a material, a tool, a
  measurement, or a timeframe.
- Say what the customer noticed first, and what they would have noticed if it
  had been left.

ANCHOR IT AT A NAMED PLACE
Name a real, well-known place in ${location} and put the job near it. Any of
these work, and you should pick whichever you are most confident about:

  a school or high school        a park or sports field
  a shopping centre or mall      a well-known restaurant or store
  a named neighbourhood          a major road, highway or intersection
  a library, church or civic building

Write it as "a home a few minutes from <place>", "a property backing onto
<place>", "on the <place> side of town" or similar.

IT MUST BE WITHIN A FEW MINUTES OF ${location}
The sentence says the job was minutes away from this place, so the place has to
BE there. It must sit inside ${location} or close enough that a resident would
drive it without thinking about it.

A famous landmark IS the right answer when it is genuinely in ${location} — a
concreter in San Antonio really can be minutes from the Alamo. What is wrong is
borrowing a famous landmark from a DIFFERENT city because it is the one you can
name. That reads as true and is not, which a local catches in a second.

If you cannot name a place inside ${location} itself, use a road or highway
that actually runs through it, or the adjoining town people there commute to.
Those are still a few minutes away. Anything further is not.

"An older part of ${location}" is NOT good enough. That is what you write when
you know nothing about the place, and it reads that way.

WHAT YOU MUST NOT INVENT
This describes a typical job, not a particular one that happened. So:
- Do NOT name a customer, or describe them in a way that identifies anyone.
- Do NOT give a street name, a house number or an address. A named landmark or
  neighbourhood is about the AREA and is wanted; a street and number identifies
  a household and is not. A highway or a major road is a landmark, not an
  address, and is fine.
- Do NOT invent a place. A landmark that does not exist is spotted instantly by
  a local reader, and they stop believing the rest of the page.
- Do NOT name a place that exists somewhere else. A real landmark in the wrong
  city is worse than an invented one, because it proves the page was written
  about nowhere in particular.
- Do NOT give a date, a month, or a year.
- Do NOT state a price, a cost, a saving, or a percentage.
- Do NOT quote anybody, and do NOT write a testimonial.
- Do NOT claim an award, a certification, or a number of jobs completed.

WRITING
- Past tense, plain language, no marketing adjectives.
- Do not open with "When it comes to", "Recently", "One of our", or
  "A customer called".
- Do not describe the company as trusted, reliable, professional or dedicated.
- No markdown, no headings, no bullet points. One flowing paragraph.

Return ONLY a JSON object:

{ "paragraph": "..." }
`.trim();
}

/**
 * @returns {Promise<{heading: string, paragraphs: string[]}|null>}
 *          null when this business type does not get one, or on any failure —
 *          the case study is an enhancement and never a reason for a
 *          generation to fail.
 */
async function generateCaseStudy({ businessType, businessName, location }) {
  if (!businessType || !businessName) return null;

  if (!wantsCaseStudy(businessType)) {
    console.log('   Case study skipped: not offered for this business type');
    return null;
  }

  try {
    const prompt = buildPrompt({ businessType, businessName, location });

    // responses.create, not chat.completions.create — `input`, `reasoning`
    // and `text` belong to the Responses API. Same shape every other
    // generator in this project uses.
    const response = await withRetry(() => getOpenAI().responses.create({
      model: 'gpt-5.6-terra',
      input: prompt,
      // 'low' rather than 'none': this one has constraints to hold in mind
      // while writing, and reasoning tokens are cheaper than a paragraph that
      // names a customer.
      reasoning: { effort: 'low' },
      text: { verbosity: 'medium' },
    }), { label: 'case study' });

    console.log('generateCaseStudy usage:', response.usage);

    const cleaned = response.output_text
      .trim()
      .replace(/```json|```/g, '')
      .replace(/^[^{]*\{/, '{')
      .replace(/\}[^}]*$/, '}')
      .trim();

    const parsed = parseModelJson(cleaned, { label: 'case study' });
    if (!parsed.ok) throw parsed.error;

    const paragraph = String((parsed.data && parsed.data.paragraph) || '').trim();

    // A paragraph this short is a failed generation rather than a terse one,
    // and an almost-empty section looks worse than no section.
    if (paragraph.split(/\s+/).filter(Boolean).length < 40) {
      console.warn('   ⚠️ Case study came back too short — skipping the section');
      return null;
    }

    return {
      heading: caseStudyHeading(businessType, location),
      paragraphs: [paragraph],
    };

  } catch (err) {
    console.warn('   ⚠️ Could not generate the case study:', err.message);
    return null;
  }
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The section markup. Returns '' when there is no case study, so the page has
 * nothing where the section would be rather than an empty heading.
 *
 * The paragraphs are NOT escaped: interlink injection may have put an <a> in
 * them, exactly as it does for every other section on this page. The heading
 * is escaped — it is built here from the registry and the location, and
 * escaping it costs nothing.
 */
function buildCaseStudySection(caseStudy) {
  if (!caseStudy || !caseStudy.heading) return '';

  const paragraphs = (caseStudy.paragraphs || [])
    .map(p => String(p || '').trim())
    .filter(Boolean);

  if (!paragraphs.length) return '';

  return `
<section class="case-study-section">
  <div class="container section-padding">
    <div class="row">
      <div class="col-lg-10">
        <h2>${escapeHtml(caseStudy.heading)}</h2>
${paragraphs.map(p => `        <p>${p}</p>`).join('\n')}
      </div>
    </div>
  </div>
</section>`;
}

module.exports = {
  generateCaseStudy,
  buildCaseStudySection,
  caseStudyHeading,
  wantsCaseStudy,
  buildPrompt,
  WORD_TARGET,
  SHAPES_WITH_CASE_STUDY,
};
