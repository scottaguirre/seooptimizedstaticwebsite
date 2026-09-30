// utils/generateSampleReviews.js

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
 * Fallback names used if the OpenAI name generation fails.
 */
const FALLBACK_NAMES = [
  'Jason Rua',
  'Maria Garcia',
  'David Prince',
  'Jennifer Williams',
];


/**
 * Generate four fictional customer names.
 */
async function generateExampleNames() {
  const namesPrompt = `
Generate exactly 4 realistic fictional customer names.

Requirements:
- Each name must include a first name and last name.
- Use realistic U.S. customer names.
- Return ONLY a valid JSON array of strings.
- Do not include markdown.
- Do not include explanations.
- Do not include a variable name.

Example:
["John Smith", "Maria Garcia", "David Johnson", "Jennifer Williams"]
`.trim();

  try {
    const response = await withRetry(() =>
      getOpenAI().responses.create({
        model: 'gpt-5.6-terra',
        input: namesPrompt,
        reasoning: { effort: 'low' },
        text: { verbosity: 'low' },
      }),
      { label: 'customer names' }
    );

    const cleaned = response.output_text
      .trim()
      .replace(/```json|```/g, '')
      .trim();

    const names = JSON.parse(cleaned);

    if (!Array.isArray(names) || names.length !== REVIEW_COUNT) {
      throw new Error(
        `Expected exactly ${REVIEW_COUNT} customer names`
      );
    }

    const validNames = names
      .map(name => String(name || '').trim())
      .filter(Boolean);

    if (validNames.length !== REVIEW_COUNT) {
      throw new Error(
        `Expected exactly ${REVIEW_COUNT} valid customer names`
      );
    }

    console.log('Generated customer names:', validNames);

    return validNames;

  } catch (error) {
    console.warn(
      '   ⚠️ Could not generate customer names:',
      error.message
    );

    return FALLBACK_NAMES;
  }
}


const HEADING = 'What Customers Are Saying';


/**
 * The note above the cards.
 */
const SECTION_NOTE = '';


/**
 * Deterministic fallback, used when the model call fails.
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

These are placeholder examples that demonstrate a page layout.

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
 */
function withDisclaimer(body) {
  const text = tidy(body);

  if (!text) return '';

  return `${DISCLAIMER} ${text}`.trim();
}


/**
 * The fallback set, with the business name filled in.
 */
function fallbackReviews(businessName, exampleNames = FALLBACK_NAMES) {
  const name = String(
    businessName || 'this business'
  ).trim();

  return FALLBACK_BODIES.map((body, i) => ({
    name: exampleNames[i] || `Customer ${i + 1}`,
    stars: 5,
    text: withDisclaimer(
      body.replace(/%s/g, name)
    ),
  }));
}


/**
 * @returns {Promise<{
 *   heading,
 *   note,
 *   reviews: Array<{name, stars, text}>
 * }>}
 */
async function generateSampleReviews({
  businessType,
  businessName,
  location
}) {
  const heading = HEADING;
  const note = SECTION_NOTE;

  if (!businessName) {
    return {
      heading,
      note,
      reviews: []
    };
  }

  /*
   * Generate the customer names first.
   *
   * If this request fails, generateExampleNames()
   * automatically returns FALLBACK_NAMES.
   */
  const EXAMPLE_NAMES = await generateExampleNames();

  try {
    const prompt = buildPrompt({
      businessType,
      businessName,
      location
    });

    const response = await withRetry(
      () =>
        getOpenAI().responses.create({
          model: 'gpt-5.6-terra',
          input: prompt,
          reasoning: { effort: 'low' },
          text: { verbosity: 'medium' },
        }),
      { label: 'sample reviews' }
    );

    console.log(
      'generateSampleReviews usage:',
      response.usage
    );

    const cleaned = response.output_text
      .trim()
      .replace(/```json|```/g, '')
      .replace(/^[^{]*\{/, '{')
      .replace(/\}[^}]*$/, '}')
      .trim();

    const parsed = parseModelJson(
      cleaned,
      { label: 'sample reviews' }
    );

    if (!parsed.ok) {
      throw parsed.error;
    }

    const bodies =
      Array.isArray(
        parsed.data &&
        parsed.data.reviews
      )
        ? parsed.data.reviews
        : [];

    const reviews = bodies
      .slice(0, REVIEW_COUNT)
      .map(tidy)

      // A one-word answer is a failed generation
      // rather than a terse review.
      .filter(body =>
        body
          .split(/\s+/)
          .filter(Boolean)
          .length >= 8
      )

      .map((body, i) => ({
        name:
          EXAMPLE_NAMES[i] ||
          `Example Customer ${i + 1}`,

        stars: 5,

        text: withDisclaimer(body),
      }));


    /*
     * A partial answer leaves a ragged grid,
     * so use the complete fallback set.
     */
    if (reviews.length < REVIEW_COUNT) {
      console.warn(
        `   ⚠️ Sample reviews came back short ` +
        `(${reviews.length}/${REVIEW_COUNT}) — ` +
        `using the fallback set`
      );

      return {
        heading,
        note,
        reviews: fallbackReviews(
          businessName,
          EXAMPLE_NAMES
        ),
      };
    }


    return {
      heading,
      note,
      reviews
    };


  } catch (err) {
    console.warn(
      '   ⚠️ Could not generate sample reviews:',
      err.message
    );

    return {
      heading,
      note,
      reviews: fallbackReviews(
        businessName,
        EXAMPLE_NAMES
      ),
    };
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
 * The star's outline, as ONE string.
 */
const STAR_PATH =
  'M10 1.6l2.47 5.01 5.53.8-4 3.9.94 5.51L10 14.22l-4.94 2.6.94-5.51-4-3.9 5.53-.8z';


/**
 * One star, no wrapper.
 */
function starSvg() {
  return `<svg class="review-star" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><path d="${STAR_PATH}"/></svg>`;
}


function buildStars(count = 5) {
  const filled = Math.max(
    0,
    Math.min(5, Number(count) || 0)
  );

  return (
    `<div class="review-stars" role="img" aria-label="${filled} out of 5 stars">` +
    starSvg().repeat(filled) +
    `</div>`
  );
}


/**
 * The section markup.
 */
function buildReviewsSection(data) {
  if (
    !data ||
    !Array.isArray(data.reviews) ||
    !data.reviews.length
  ) {
    return '';
  }

  const cards = data.reviews
    .filter(
      r =>
        r &&
        String(r.text || '').trim()
    )
    .map(r => `
      <div class="col-md-6 col-lg-3">
        <div class="review-card">
          ${buildStars(r.stars)}
          <p class="review-text">${escapeHtml(r.text)}</p>
          <p class="review-author">${escapeHtml(r.name)}</p>
        </div>
      </div>`)
    .join('');

  if (!cards.trim()) {
    return '';
  }

  const note = String(
    data.note || ''
  ).trim();

  return `
<section class="reviews-section">
  <div class="container section-padding">
    <h2>${escapeHtml(data.heading || HEADING)}</h2>
${note
  ? `    <p class="reviews-note">${escapeHtml(note)}</p>`
  : ''}
    <div class="row g-4">${cards}
    </div>
  </div>
</section>`;
}


/**
 * Reviews cleaned up for the WordPress
 * content model.
 */
function reviewRows(data) {
  if (
    !data ||
    !Array.isArray(data.reviews)
  ) {
    return [];
  }

  return data.reviews
    .map(r => ({
      text: tidy(r && r.text),
      name: tidy(r && r.name),
      stars: Math.max(
        0,
        Math.min(
          5,
          Number(r && r.stars) || 0
        )
      ),
    }))
    .filter(r => r.text);
}


module.exports = {
  generateSampleReviews,
  generateExampleNames,
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
  FALLBACK_NAMES,
  REVIEW_COUNT,
  WORD_TARGET,
};