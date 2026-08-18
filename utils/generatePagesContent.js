const fs = require('fs');
const path = require('path');
const { createPagesPrompt } = require('./createPagesPrompt');
const { getOpenAI } = require('./openaiClient');
const { withRetry } = require('./withRetry');
const { parseModelJson } = require('./parseModelJson'); 

async function generatePagesContent(globalValues, page, pagesInterlinks, attempt = 1) {
  
  const prompt = createPagesPrompt({
    globalValues,
    page,
    keywords: pagesInterlinks
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
  }), { label: 'service page content' });
    
    console.log("generatePagesContent usage:", response.usage);
    
    const raw = response.output_text.trim();

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
    const parseResult = parseModelJson(cleaned, { label: 'service page content' });
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
    console.error(`❌ Failed to parse page content JSON (Attempt ${attempt})`);
    console.error(err.message);

    // Save failed output for debugging
    const logDir = path.join(__dirname, '../logs');
    const logPath = path.join(logDir, 'pages-content-failed.json');
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
      console.log('🔁 Retrying Pages content generation...: generatePagesContent.js');
      // The `page` argument was missing here: the retry passed
      // pagesInterlinks as `page`, so the second attempt built a prompt for
      // the wrong thing entirely — and any content it produced belonged to
      // no page. The same bug was fixed in generateLocationPagesContent.
      return await generatePagesContent(globalValues, page, pagesInterlinks, attempt + 1);
    }

    // null, not {}. An empty object looks like success to the caller, which
    // then reads sections.section1.heading and throws — one unparseable page
    // used to take the whole generation with it.
    return null;
  }
}

module.exports = { generatePagesContent };