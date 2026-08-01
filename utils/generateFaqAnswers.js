// utils/generateFaqAnswers.js
//
// Turns the PAA questions into an FAQ.
//
// ValueSERP returns questions only — no answer text — so the answers are ours
// to write. One request covers all six questions rather than six separate
// calls: cheaper, faster, and it lets the model avoid repeating itself across
// answers.

const { OpenAI } = require('openai');
const openai = new OpenAI();

const MIN_WORDS = 40;
const MAX_WORDS = 60;

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
  const list = (questions || []).map(q => String(q || '').trim()).filter(Boolean);
  if (!list.length) return [];

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: buildPrompt({ questions: list, businessName, businessType, location }) }],
      temperature: 0.7,
    });

    const raw = response.choices[0].message.content;

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

    console.log(`   FAQ answers generated: ${faqs.length}/${list.length}`);
    return faqs;

  } catch (err) {
    console.warn('   ⚠️ Could not generate FAQ answers:', err.message);
    return [];
  }
}

module.exports = { generateFaqAnswers };