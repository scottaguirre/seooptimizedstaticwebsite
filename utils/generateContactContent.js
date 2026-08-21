// utils/generateContactContent.js
//
// The short intro on the contact page: a heading and two paragraphs telling
// visitors how to get in touch and what happens next.
//
// Kept deliberately small. The rest of the page is the form and the NAP/map
// block, both reused unchanged from the home page — a contact page does not
// need an essay, and padding it out would only dilute the call to action.

const { OpenAI } = require('openai');
const { withRetry } = require('./withRetry');
const { parseModelJson } = require('./parseModelJson');
const { businessNoun } = require('./pageMeta');

// Created on first use: constructing OpenAI without a key throws, which
// would take the server down at boot rather than skipping one section.
let openaiClient = null;
function getOpenAI() {
  if (!openaiClient) openaiClient = new OpenAI();
  return openaiClient;
}

function buildContactPrompt({ businessName, businessType, location, phone }) {
  return `
Write the short introduction for the contact page of "${businessName}", a local
${businessType} business serving ${location}.

Return a heading and exactly two paragraphs.

HEADING
- 3 to 6 words, inviting rather than clever. Something like "Get In Touch"
  or "Talk To Our Team", but not those exact phrases.

PARAGRAPH 1 — 35 to 50 words
- Open by referring to the business as "our ${businessNoun(businessType)}"
  — NOT by its name, and using EXACTLY that phrase. The name belongs on the
  home page; this phrase is what links back there, so it has to match.
- How to reach the business: the form below, or by phone${phone ? ` on ${phone}` : ''}.
- Say what a visitor should include so the reply is useful — the job, the
  property, and roughly when they need it.

PARAGRAPH 2 — 35 to 50 words
- What happens after they get in touch: who responds, roughly how quickly,
  and that an estimate follows a look at the work.
- Mention ${location} once.

RULES
- Do not promise a specific response time in hours, or quote any price.
- Do not open with "When it comes to", "Whether you need", or "Look no further".
- Do not describe the business as trusted, reliable, professional or dedicated.
- Plain text only: no markdown, no bullet points.

Return ONLY a JSON object:

{ "heading": "...", "paragraphs": ["...", "..."] }
`.trim();
}

/**
 * Written fallback, used when the model fails or returns something unusable.
 * A contact page with no intro looks broken in a way an About page would not,
 * so this never returns empty.
 */
function fallbackContent({ businessName, businessType, location, phone }) {
  const name = businessName || 'our team';
  const type = String(businessType || 'service').toLowerCase();
  const place = location || 'your area';

  return {
    heading: 'Get In Touch',
    paragraphs: [
      `Reach our ${businessNoun(businessType)} using the form below${phone ? `, or call ${phone}` : ''}. ` +
      `Tell us what the job involves, the type of property, and when you would like the work done — ` +
      `the more detail you give us, the more useful our reply will be.`,

      `A member of ${name} will get back to you to talk through the ${type} work you need in ${place}. ` +
      `Where a site visit makes sense we will arrange one, and you will have a written estimate ` +
      `before anything goes ahead.`,
    ],
  };
}

/**
 * @returns {Promise<{heading: string, paragraphs: string[]}>}
 *          Always resolves — falls back to written copy rather than failing
 *          the page.
 */
async function generateContactContent({ businessName, businessType, location, phone }) {
  const fallback = fallbackContent({ businessName, businessType, location, phone });

  try {
    // Same two fixes as generateFaqAnswers: build the prompt, and go through
    // getOpenAI() — there is no bare `openai` in this file, because the
    // client is created lazily so a missing API key does not kill the server
    // at boot.
    const prompt = buildContactPrompt({ businessName, businessType, location, phone });

    // Wrapped: a dropped connection used to lose this call outright.


    // Under two concurrent generations the FAQ request was cut off


    // mid-response with "terminated" — a transient fault a retry fixes.


    const response = await withRetry(() => getOpenAI().responses.create({
        model: "gpt-5.6-terra",
        input: prompt,
        reasoning: {
            effort: "low"
        },
        text: {
            verbosity: "medium"
        }
    }), { label: 'contact intro' });
  
  console.log("generateContactContent usage:", response.usage);
  
  const raw = response.output_text.trim();

    const cleaned = raw
      .replace(/```json|```/g, '')
      .replace(/^[^{]*{/, '{')
      .replace(/}[^}]*$/, '}')
      .trim();

    // Tolerant parse: the model sometimes emits an unescaped quote inside a
    // value, which breaks JSON.parse. These sections fail soft, but a repair
    // means the user gets the content rather than an empty section.
    const parseResult = parseModelJson(cleaned, { expect: 'object', label: 'contact intro' });
    if (!parseResult.ok) throw parseResult.error;
    const parsed = parseResult.data;

    const heading = String(parsed.heading || '').trim();
    const paragraphs = Array.isArray(parsed.paragraphs)
      ? parsed.paragraphs.map(p => String(p || '').trim()).filter(Boolean)
      : [];

    if (!heading || paragraphs.length < 2) {
      throw new Error('Model returned an incomplete contact intro');
    }

    console.log('   Contact intro generated');
    return { heading, paragraphs: paragraphs.slice(0, 2) };

  } catch (err) {
    console.warn('   ⚠️ Using the written contact intro:', err.message);
    return fallback;
  }
}

module.exports = { generateContactContent, buildContactPrompt, fallbackContent };