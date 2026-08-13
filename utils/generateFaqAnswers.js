// utils/generateFaqAnswers.js
//
// Turns the PAA questions into an FAQ.
//
// ValueSERP returns questions only — no answer text — so the answers are ours
// to write. One request covers all six questions rather than six separate
// calls: cheaper, faster, and it lets the model avoid repeating itself across
// answers.

const { OpenAI } = require('openai');
const { log } = require('./logger');
const { getFixedFaqQuestions, getFixedFaqFallbacks } = require('./fixedFaqQuestions');

// Created on first use, not at module load. Constructing OpenAI without a key
// throws, which would take the whole server down at boot rather than skipping
// one optional section.
let openaiClient = null;
function getOpenAI() {
  if (!openaiClient) openaiClient = new OpenAI();
  return openaiClient;
}

const MIN_WORDS = 70;
const MAX_WORDS = 90;

function buildPrompt({ questions, businessName, businessType, location }) {
  const list = questions.map((q, i) => `${i + 1}. ${q}`).join('\n');

  return `
You are writing the FAQ section for a local ${businessType} business called "${businessName}", serving ${location}.

Answer each question below in ${MIN_WORDS}-${MAX_WORDS} words.

Rules:
- Write as the business ("we", "our team"), not as a general article.
- Be specific and practical. No filler like "it depends on many factors".
- Mention ${location} only where it genuinely helps; do not force it into every answer.
- Do not repeat the question inside the answer.
- Do not invent exact prices, license numbers, or guarantees.
- Plain text only: no markdown, no bullet points, no headings.

Questions:
${list}

Return ONLY a JSON array, one object per question, in the same order:

[
  { "question": "the question exactly as given", "answer": "your answer" }
]
`.trim();
}

/**
 * @returns {Promise<Array<{question: string, answer: string}>>}
 *          [] when questions are missing or the model output can't be used.
 *          A failed FAQ must never fail a site generation.
 */
async function generateFaqAnswers({ questions, businessName, businessType, location }) {
  // Two fixed questions always lead: how do I start, and how fast can you
  // move. Their wording is chosen by business type — "respond to an urgent
  // issue" suits a plumber and not a law firm.
  const fixed = getFixedFaqQuestions({ businessName, businessType });

  const paa = (questions || []).map(q => String(q || '').trim()).filter(Boolean);

  // Answering all of them in ONE request lets the model see the full set and
  // avoid repeating itself between, say, the fixed response-time question and
  // a PAA question about the same thing.
  const list = [...fixed, ...paa];
  if (!list.length) return [];

  try {
    // buildPrompt() has to run — `input: prompt` referenced a variable that
    // was never created, so every call threw "prompt is not defined" and the
    // FAQ silently fell back to the two fixed questions.
    const prompt = buildPrompt({
      questions: list,
      businessName,
      businessType,
      location,
    });

    const response = await getOpenAI().responses.create({
      model: "gpt-5.6-terra",
      input: prompt,
      reasoning: {
          effort: "low"
      },
      text: {
          verbosity: "medium"
      }
  });
  
  console.log("generateFAQAnswers usage:", response.usage);
  
  const raw = response.output_text.trim();

    const cleaned = raw
      .replace(/```json|```/g, '')
      .replace(/^[^\[]*\[/, '[')
      .replace(/\][^\]]*$/, ']')
      .trim();

    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) throw new Error('Model did not return an array');

    // Pair answers back to the questions we asked, so a reordered or
    // truncated response can't misalign them.
    const byQuestion = new Map();
    parsed.forEach(item => {
      if (!item || !item.question) return;
      byQuestion.set(String(item.question).toLowerCase().trim(), String(item.answer || '').trim());
    });

    const faqs = list
      .map(question => {
        const answer = byQuestion.get(question.toLowerCase().trim())
          // fall back to positional match if the model reworded the question
          || (parsed[list.indexOf(question)] || {}).answer
          || '';
        return { question, answer: String(answer).trim() };
      })
      .filter(item => item.answer);

    // The section promises eight questions, so make sure the fixed two are
    // present even if the model dropped or reworded one of them.
    const fallbacks = getFixedFaqFallbacks({ businessName, businessType, location });

    fixed.forEach((question, i) => {
      const found = faqs.find(f => f.question.toLowerCase().trim() === question.toLowerCase().trim());
      if (!found) {
        faqs.splice(i, 0, { question, answer: fallbacks[i] });
        console.warn(`   ⚠️ Model dropped a fixed FAQ question — using the written fallback`);
      }
    });

    // Keep the fixed pair first regardless of the order the model returned
    const ordered = [
      ...fixed.map(q => faqs.find(f => f.question.toLowerCase().trim() === q.toLowerCase().trim())).filter(Boolean),
      ...faqs.filter(f => !fixed.some(q => q.toLowerCase().trim() === f.question.toLowerCase().trim())),
    ];

    console.log(`   FAQ answers generated: ${ordered.length} (${fixed.length} fixed + ${ordered.length - fixed.length} from PAA)`);
    return ordered;

  } catch (err) {
    console.warn('   ⚠️ Could not generate FAQ answers:', err.message);
    log.external('openai', 'faqAnswersFailed', {
      message: err.message,
      status: err.status || err.response?.status || null,
    });

    // Fall back to the two fixed questions with their written answers. A
    // short FAQ is better than none, and these two are the ones visitors
    // most often want answered.
    const fallbacks = getFixedFaqFallbacks({ businessName, businessType, location });
    return fixed.map((question, i) => ({ question, answer: fallbacks[i] }));
  }
}

module.exports = { generateFaqAnswers };