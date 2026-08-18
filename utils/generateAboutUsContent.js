const fs = require('fs');
const path = require('path');
const { createAboutUsPrompt } = require('./createAboutUsPrompt');
const { getOpenAI } = require('./openaiClient');
const { withRetry } = require('./withRetry');
const { parseModelJson } = require('./parseModelJson');

async function generateAboutUsContent(globalValues, indexInterlinks, attempt = 1) {
  /* console.log('🧠 Backlink/pages slugs passed for content generation: generateAboutUsContent.js', indexInterlinks);
  console.log('🔗 Synonyms map passed to OpenAI: ====', allSynonymsCombined);
  */

  console.log("====== Generate About Us Content");
  console.log(indexInterlinks.length);
  console.log(indexInterlinks);
  
  const prompt = createAboutUsPrompt({
    globalValues,
    keywords: indexInterlinks
  });

  // Wrapped: a dropped connection ("terminated") used to lose this call
  // outright, and this is the most expensive one to lose — it carries the
  // whole page's content.
  const response = await withRetry(() => getOpenAI().responses.create({
    model: "gpt-5.6-terra",
    input: prompt,
    reasoning: {
        effort: "low"
    },
    text: {
        verbosity: "medium"
    }
  }), { label: 'about us content' });

console.log("generateAboutuscontent usage:", response.usage);

const raw = response.output_text;



  // Clean formatting
  const cleaned = raw
    .replace(/```json|```/g, '')
    .replace(/^[^{]*{/, '{')
    .replace(/}[^}]*$/, '}')
    .trim();

  try {
    // Tolerant parse: the model sometimes writes an unescaped quote inside a
    // value, which ends the string early and breaks JSON.parse. Repairing it
    // is the difference between a usable page and a failed generation.
    const parseResult = parseModelJson(cleaned, { label: 'about us content' });
    if (!parseResult.ok) throw parseResult.error;
    const parsed = parseResult.data;

    // Basic structural check to prevent silent failures
    if (
      !parsed.section1 ||
      !parsed.section1.heading ||
      !parsed.section1.paragraphs
    ) {
      throw new Error('Missing section1 content');
    }

    return parsed;

  } catch (err) {
    console.error(`❌ Failed to parse About Us JSON (Attempt ${attempt})`);
    console.error(err.message);

    // Save failed output for debugging
    const logDir = path.join(__dirname, '../logs');
    const logPath = path.join(logDir, 'about-us-failed.json');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);

    fs.writeFileSync(
      logPath,
      JSON.stringify(
        {
          attempt,
          error: err.message,
          prompt,
          rawResponse: raw
        },
        null,
        2
      )
    );

    // Retry once if first attempt fails
    if (attempt < 2) {
      console.log('🔁 Retrying About Us generation...: generateAboutusContent.js');
      return await generateAboutUsContent(globalValues, indexInterlinks, attempt + 1);
    }

    // null, not {}. An empty object looks like success to the caller, which
    // then reads sections.section1.heading and throws — one unparseable page
    // used to take the whole generation with it.
    return null;
  }
}

module.exports = { generateAboutUsContent };