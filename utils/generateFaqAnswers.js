// utils/generateFaqAnswers.js
//
// Turns the PAA questions into an FAQ.
//
// ValueSERP returns questions only — no answer text — so the answers are ours
// to write. One request covers all six questions rather than six separate
// calls: cheaper, faster, and it lets the model avoid repeating itself across
// answers.
//
// THE FIXED PAIR IS OPTIONAL (added for location pages)
//
// Two questions normally lead the FAQ — "how do I book" and "how fast can you
// respond". They are the right opener on the HOME page, where the FAQ appears
// once. On location pages the FAQ appears on every town's page, and the fixed
// pair is worded from businessName and businessType alone: no location input
// at all. Ten location pages would therefore carry the same two questions,
// word for word, ten times — the clearest possible signal that the pages come
// off a template.
//
// Location pages pass includeFixed:false and run on PAA questions only, which
// differ per town because the SERP is queried per town.

const { OpenAI } = require('openai');
const { parseModelJson } = require('./parseModelJson');
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

function buildPrompt({ questions, businessName, businessType, location, localFocus = false }) {
  const list = questions.map((q, i) => `${i + 1}. ${q}`).join('\n');

  // On a location page the FAQ is one of several on the site — one per town.
  // Without this, the model answers from businessType alone and the blocks
  // come back near-identical across towns even though the QUESTIONS differ.
  const localRule = localFocus ? `
- This FAQ sits on a page about ${location} specifically, alongside pages for
  other towns. Where an answer can honestly be made specific to ${location} —
  travel and arrival times, the kind of properties there, local conditions or
  seasons — make it specific. Where it cannot, answer plainly rather than
  inventing a local detail.
- Do not name neighbourhoods, streets or landmarks you are not confident are
  real. An adjacent town or a road is safer than a guessed neighbourhood.` : '';

  return `
You are writing the FAQ section for a local ${businessType} business called "${businessName}", serving ${location}.

Answer each question below in ${MIN_WORDS}-${MAX_WORDS} words.

Rules:
- Write as the business ("we", "our team"), not as a general article.
- Be specific and practical. No filler like "it depends on many factors".
- Mention ${location} only where it genuinely helps; do not force it into every answer.
- Do not repeat the question inside the answer.
- Do not invent exact prices, license numbers, or guarantees.
- Plain text only: no markdown, no bullet points, no headings.${localRule}

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
async function generateFaqAnswers({
  questions,
  businessName,
  businessType,
  location,
  includeFixed = true,
}) {
  // Two fixed questions always lead: how do I start, and how fast can you
  // move. Their wording is chosen by business type — "respond to an urgent
  // issue" suits a plumber and not a law firm.
  //
  // Skipped on location pages: identical on every one of them, see the header.
  const fixed = includeFixed ? getFixedFaqQuestions({ businessName, businessType }) : [];

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
      // The fixed pair is dropped only on per-location pages, so its absence
      // is exactly the signal that this FAQ belongs to one town.
      localFocus: !includeFixed,
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

    // Tolerant parse: the model sometimes emits an unescaped quote inside a
    // value, which breaks JSON.parse. These sections fail soft, but a repair
    // means the user gets the content rather than an empty section.
    const parseResult = parseModelJson(cleaned, { expect: 'array', label: 'FAQ answers' });
    if (!parseResult.ok) throw parseResult.error;
    const parsed = parseResult.data;
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

    // "supplied" rather than "from PAA": the home page's questions come from
    // People Also Ask, but a location page's are written by
    // generateLocationFaq. The log said PAA for both, which was misleading in
    // exactly the place someone would look to check.
    console.log(`   FAQ answers generated: ${ordered.length} (${fixed.length} fixed + ${ordered.length - fixed.length} supplied)`);
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
    //
    // With includeFixed:false there is nothing to fall back TO — the written
    // fallbacks are the fixed pair. A location page whose answers fail simply
    // renders without an FAQ, which is the correct outcome: the alternative
    // would be pasting the same two answers onto every town's page.
    if (!includeFixed) return [];

    const fallbacks = getFixedFaqFallbacks({ businessName, businessType, location });
    return fixed.map((question, i) => ({ question, answer: fallbacks[i] }));
  }
}

module.exports = { generateFaqAnswers };