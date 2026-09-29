// utils/generateSampleReviews.js
//
// The "What Customers Are Saying" section on the home page.
//
//     ★★★★★  "This is an example review, not a real customer review.
//              The work was booked for a Tuesday and finished that morning…"
//
// HOME PAGE ONLY, and below the case study. Same reasoning generateCaseStudy
// gives for its own placement: a service page is already about one service and
// a location page about one town, so a reviews block on either is a third
// telling of the same story on the same site.
//
//
// WHY EVERY REVIEW SAYS IT IS NOT A REVIEW
//
// generateCaseStudy.js already wrote the rule this file has to live under:
//
//     A "case study" is a claim about work that was actually done. Left to
//     itself the model writes one: a named customer, a street, a date, a
//     dollar figure saved. None of it happened. That is a fabricated record
//     rather than marketing copy, AND IT IS THE SAME CATEGORY OF THING AS
//     INVENTING A REVIEW.
//
// Its prompt ends with "Do NOT quote anybody, and do NOT write a testimonial."
// This file is that same boundary approached from the other side: the section
// exists so a customer can SEE the layout, and the content announces what it
// is so it cannot be mistaken for what it is not.
//
// That is not a formality. The FTC's Consumer Reviews and Testimonials Rule
// puts the liability on the BUSINESS whose site displays a fake review, not on
// the tool that generated it — their guidance says a business putting
// testimonials on its own website "is disseminating them and is not merely
// hosting them", and courts can impose civil penalties. A generated five-star
// review naming the business, in an invented customer's voice, is that exact
// thing the moment the site goes live and nobody remembered to replace it.
//
// A review whose first sentence says it is an example cannot be that thing.
//
//
// THE DISCLAIMER IS PREPENDED IN CODE, NOT REQUESTED IN THE PROMPT
//
// The first draft asked the model to open each review with the disclaimer and
// then checked that it had. That is two ways to fail — the model phrases it
// differently and the check rejects a good review, or the model drops it and a
// loose check lets it through.
//
// So the model is asked only for the BODY, and DISCLAIMER is glued on here.
// It is a constant in this file: it cannot be forgotten, reworded, or lost to
// a retry. The model never sees it and has no opportunity to get it wrong.
//
//
// NO JSON-LD. DELIBERATELY.
//
// These do not go into the LocalBusiness schema and there is no Review type
// anywhere in this file. Review structured data can surface star ratings
// directly in Google's results, and star ratings built from example text
// breaks Google's structured-data policies — the penalty is a manual action on
// the whole site, which is a far worse outcome than a missing rich result.
//
// (utils/generateReview.js still puts a fabricated 5-star review with an
// invented reviewer name into the schema on every service page. That predates
// this file and is on the "Deliberately dropped — Edwin knows; he will say
// when" list. It is the same problem with worse consequences, and it is worth
// coming back to.)

const { getOpenAI } = require('./openaiClient');
const { withRetry } = require('./withRetry');
const { parseModelJson } = require('./parseModelJson');
const { categoryFor } = require('./businessShape');

/** How many cards the section shows. Four fits the grid at every width. */
const REVIEW_COUNT = 4;

/** Roughly how long each review body should run, excluding the disclaimer. */
const WORD_TARGET = 40;

/**
 * THE SENTENCE THAT MAKES THIS SAFE.
 *
 * Prepended to every review body, here, in code. Not asked for, not checked
 * for — guaranteed. See the header.
 */
const DISCLAIMER = '';

/**
 * The names on the cards.
 *
 * NOT realistic ones. A plausible first-and-last name is the single detail
 * that makes an example read as a record of a real person, and the layout is
 * demonstrated just as well by a name that admits what it is. Four different
 * ones rather than four copies of the same string, because part of what this
 * section is showing is four distinct cards.
 */
const EXAMPLE_NAMES = [
  'Example Customer A',
  'Example Customer B',
  'Example Customer C',
  'Example Customer D',
];

const HEADING = 'What Customers Are Saying';

/**
 * The note above the cards.
 *
 * Visible, not a comment. Somebody looking at a demo build should be able to
 * tell what they are looking at without reading the source, and the customer
 * who inherits the site should be told what to do about it.
 */
const SECTION_NOTE =
  '';

/**
 * Deterministic fallback, used when the model call fails.
 *
 * The case study returns null on failure and the page reflows without it. This
 * one does not, because the whole point of the section is showing what the
 * layout looks like — a demo that silently drops the section it was meant to
 * demonstrate has failed at its only job. Example content has no accuracy to
 * lose, so a fixed set costs nothing.
 *
 * `%s` is the business name.
 */
const FALLBACK_BODIES = [
  'Booked on a Tuesday morning and the work was finished the same day. ' +
    'The team from %s laid out the options first, cleaned up afterwards, and the price matched the quote.',
  'Called %s about a problem two other companies had looked at without fixing. ' +
    'They found the cause in under an hour and explained what had been missed.',
  'Straightforward from the first phone call. %s arrived inside the window they gave, ' +
    'brought the right parts, and left the place tidier than they found it.',
  'Second time using %s. Same care as the first job — they walked through what they were doing, ' +
    'answered questions without rushing, and followed up a week later.',
];

function buildPrompt({ businessType, businessName, location }) {
  const category = categoryFor(businessType);

  return `
You are writing ${REVIEW_COUNT} EXAMPLE customer reviews for the home page of
${businessName}, a local ${category} business serving ${location}.

These are placeholder examples that demonstrate a page layout. They will be
labelled as examples on the page and replaced with real reviews before the site
is published. 

Each one should be about ${WORD_TARGET} words and should mention
"${businessName}" by name at least once.

WHAT MAKES THESE GOOD
- Write about the WORK. Name what was done, how it went, what the customer
  noticed. A review that only says "great service, highly recommend" shows
  nothing about how the section will look with real content in it.
- Vary them. Different jobs, different lengths, different tone — one brief and
  plain, one longer and more detailed. Four reviews that read identically make
  the section look generated, which is exactly what the customer is evaluating.
- Plain speech. These should sound like ordinary people, not marketing copy.

WHAT YOU MUST NOT WRITE
- Do NOT invent a reviewer name, initials, or any detail that identifies a
  person. The names on the cards are supplied separately.
- Do NOT give a date, a month or a year.
- Do NOT state a price, a cost, a saving, or a percentage.
- Do NOT give a street name, a house number or an address.
- Do NOT claim an award, a certification, or a number of jobs completed.
- Do NOT write the words "example", "sample" or "placeholder" into the text.
  The page says that already, in a sentence added outside your output, and
  saying it twice reads as an error rather than as a label.

WRITING
- First person, past tense, no markdown, no headings, no bullet points.
- Do not open with "I recently", "I called" or "I had" more than once across
  the four.

Return ONLY a JSON object:

{ "reviews": ["...", "...", "...", "..."] }
`.trim();
}

/**
 * Trim, collapse whitespace, and strip a stray wrapping quote.
 *
 * The model returns review text inside a JSON string and sometimes wraps it in
 * quotes as well, which renders as «"Booked on a Tuesday…"» with two sets.
 */
function tidy(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“‘]+/, '')
    .replace(/["'”’]+$/, '')
    .trim();
}

/**
 * Glue the disclaimer to a body.
 *
 * Separate function so the test can assert on it directly, and so there is
 * exactly one place where a review becomes a finished review.
 */
function withDisclaimer(body) {
  const text = tidy(body);
  if (!text) return '';
  return `${DISCLAIMER} ${text}`;
}

/** The fallback set, with the business name filled in. */
function fallbackReviews(businessName) {
  const name = String(businessName || 'this business').trim();

  return FALLBACK_BODIES.map((body, i) => ({
    name: EXAMPLE_NAMES[i] || `Customer ${i + 1}`,
    stars: 5,
    text: withDisclaimer(body.replace(/%s/g, name)),
  }));
}

/**
 * @returns {Promise<{heading, note, reviews: Array<{name, stars, text}>}>}
 *          Always resolves with a usable section — the fallback covers a model
 *          failure. See FALLBACK_BODIES for why this one does not return null.
 */
async function generateSampleReviews({ businessType, businessName, location }) {
  const heading = HEADING;
  const note = SECTION_NOTE;

  if (!businessName) {
    return { heading, note, reviews: [] };
  }

  try {
    const prompt = buildPrompt({ businessType, businessName, location });

    // responses.create, not chat.completions.create — same shape as every
    // other generator in this project. See generateCaseStudy.js.
    const response = await withRetry(() => getOpenAI().responses.create({
      model: 'gpt-5.6-terra',
      input: prompt,
      // 'low': four short paragraphs with a list of things to avoid. Same
      // setting the case study uses for the same reason.
      reasoning: { effort: 'low' },
      text: { verbosity: 'medium' },
    }), { label: 'sample reviews' });

    console.log('generateSampleReviews usage:', response.usage);

    const cleaned = response.output_text
      .trim()
      .replace(/```json|```/g, '')
      .replace(/^[^{]*\{/, '{')
      .replace(/\}[^}]*$/, '}')
      .trim();

    const parsed = parseModelJson(cleaned, { label: 'sample reviews' });
    if (!parsed.ok) throw parsed.error;

    const bodies = Array.isArray(parsed.data && parsed.data.reviews)
      ? parsed.data.reviews
      : [];

    const reviews = bodies
      .slice(0, REVIEW_COUNT)
      .map(tidy)
      // A one-word answer is a failed generation rather than a terse review.
      .filter(body => body.split(/\s+/).filter(Boolean).length >= 8)
      .map((body, i) => ({
        name: EXAMPLE_NAMES[i] || `Example Customer ${i + 1}`,
        stars: 5,
        text: withDisclaimer(body),
      }));

    // A partial answer leaves a ragged grid, and the section is decorative
    // enough that half of it is worse than a clean fallback.
    if (reviews.length < REVIEW_COUNT) {
      console.warn(
        `   ⚠️ Sample reviews came back short (${reviews.length}/${REVIEW_COUNT}) — using the fallback set`
      );
      return { heading, note, reviews: fallbackReviews(businessName) };
    }

    return { heading, note, reviews };

  } catch (err) {
    console.warn('   ⚠️ Could not generate sample reviews:', err.message);
    return { heading, note, reviews: fallbackReviews(businessName) };
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
 * Five stars.
 *
 * INLINE SVG RATHER THAN AN ICON FONT OR AN IMAGE. A font is a network request
 * and a flash of nothing where the rating should be; an image is a second
 * request per card and does not take the page's colour. This is markup, it
 * renders with the first paint, and it scales without blurring.
 *
 * ONE aria-label on the wrapper, and aria-hidden on every star. Without that a
 * screen reader reads "star star star star star", five times, down the page.
 */
/**
 * The star's outline, as ONE string.
 *
 * The WordPress renderer draws the same stars, and it is generated from this
 * constant rather than from a copy of it — see
 * wpThemeBuilder/generators/sectionRendererPhp.js. Two hand-kept copies of an
 * SVG path is how a theme export ends up with a subtly different star, which
 * nobody would ever think to look for.
 */
const STAR_PATH = 'M10 1.6l2.47 5.01 5.53.8-4 3.9.94 5.51L10 14.22l-4.94 2.6.94-5.51-4-3.9 5.53-.8z';

/** One star, no wrapper. Shared by the HTML below and the PHP generator. */
function starSvg() {
  return `<svg class="review-star" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><path d="${STAR_PATH}"/></svg>`;
}

function buildStars(count = 5) {
  const filled = Math.max(0, Math.min(5, Number(count) || 0));

  return `<div class="review-stars" role="img" aria-label="${filled} out of 5 stars">` +
    starSvg().repeat(filled) +
    `</div>`;
}

/**
 * The section markup. Returns '' when there are no reviews, so the page has
 * nothing where the section would be rather than an empty heading — the same
 * contract buildCaseStudySection has.
 *
 * Everything IS escaped here, unlike the case study. Interlink injection does
 * not target this section, so there is no <a> to preserve, and the text came
 * from a model rather than from the registry.
 */
function buildReviewsSection(data) {
  if (!data || !Array.isArray(data.reviews) || !data.reviews.length) return '';

  const cards = data.reviews
    .filter(r => r && String(r.text || '').trim())
    .map(r => `
        <div class="col-md-6 col-lg-3">
          <div class="review-card">
            ${buildStars(r.stars)}
            <p class="review-text">${escapeHtml(r.text)}</p>
            <p class="review-author">${escapeHtml(r.name)}</p>
          </div>
        </div>`)
    .join('');

  if (!cards.trim()) return '';

  const note = String(data.note || '').trim();

  return `
<section class="reviews-section">
  <div class="container section-padding">
    <h2>${escapeHtml(data.heading || HEADING)}</h2>
${note ? `    <p class="reviews-note">${escapeHtml(note)}</p>` : ''}
    <div class="row g-4">${cards}
    </div>
  </div>
</section>`;
}

/**
 * The reviews, cleaned up for the WordPress content model.
 *
 * WHY THIS EXISTS
 *
 * buildAboutUsPage builds the page twice: once as HTML through the {{...}}
 * placeholders, and once as a content model the WordPress exporter walks. A
 * section wired into only one of them exists on the downloaded site and not
 * in the exported theme.
 *
 * THE FIRST VERSION OF THIS FEATURE DID THE HTML HALF ONLY, and the version
 * after that flattened the reviews to plain paragraphs — WordPress got the
 * wording and "5 out of 5" instead of the cards and the stars. Edwin's answer
 * settled it: "the WordPress is an exact mirror of the static site". Not
 * mostly. Not the content without the presentation. A mirror.
 *
 * So this returns STRUCTURE — one row per review, with its own text, name and
 * rating — and contentModel.js carries a real REVIEWS section type that the
 * PHP renderer draws with the same markup, the same classes and the same star
 * as buildReviewsSection above. The owner edits each review in wp-admin the
 * way they edit each pricing row.
 */
function reviewRows(data) {
  if (!data || !Array.isArray(data.reviews)) return [];

  return data.reviews
    .map(r => ({
      text: tidy(r && r.text),
      name: tidy(r && r.name),
      stars: Math.max(0, Math.min(5, Number(r && r.stars) || 0)),
    }))
    .filter(r => r.text);
}

module.exports = {
  generateSampleReviews,
  buildReviewsSection,
  reviewRows,
  buildStars,
  starSvg,
  STAR_PATH,
  withDisclaimer,
  fallbackReviews,
  buildPrompt,
  tidy,
  DISCLAIMER,
  HEADING,
  SECTION_NOTE,
  EXAMPLE_NAMES,
  REVIEW_COUNT,
  WORD_TARGET,
};
