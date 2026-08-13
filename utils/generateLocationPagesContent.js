const fs = require('fs');
const path = require('path');
const { createLocationPagesPrompt } = require('./createLocationPagesPrompt');
const { getOpenAI } = require('./openaiClient');


async function generateLocationPagesContent(globalForLoc, pagesInterlinks, locationIndex = 0, attempt = 1) {

  const prompt = createLocationPagesPrompt({
    globalForLoc,
    keywords: pagesInterlinks,
    locationIndex
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

console.log("GenerateLocationPages usage:", response.usage);

const raw = response.output_text.trim();

  // Clean formatting
  const cleaned = raw
    .replace(/```json|```/g, '')
    .replace(/^[^{]*{/, '{')
    .replace(/}[^}]*$/, '}')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);

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
    const logPath = path.join(logDir, 'location-page-failed.json');
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
      console.log('🔁 Retrying location page content generation...');
      // Was: generateLocationPagesContent(globalValues, attempt + 1)
      // `globalValues` does not exist here, so the retry threw a
      // ReferenceError instead of retrying.
      return await generateLocationPagesContent(globalForLoc, pagesInterlinks, locationIndex, attempt + 1);
    }

    return {};
  }
}

module.exports = { generateLocationPagesContent };