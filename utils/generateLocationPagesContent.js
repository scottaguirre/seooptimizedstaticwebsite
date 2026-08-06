const fs = require('fs');
const path = require('path');
const { createLocationPagesPrompt } = require('./createLocationPagesPrompt');
const { OpenAI } = require('openai');
const openai = new OpenAI();

async function generateLocationPagesContent(globalForLoc, pagesInterlinks, locationIndex = 0, attempt = 1) {

  const prompt = createLocationPagesPrompt({
    globalForLoc,
    keywords: pagesInterlinks,
    locationIndex
  });

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    // Raised from 0.7. Location pages share almost all of their input, so a
    // lower temperature pushed every page towards the same phrasing — which
    // is what Search Console was flagging as duplicate content.
    temperature: 0.9,
    // Penalise reuse of the same words and openings across the response.
    frequency_penalty: 0.3,
    presence_penalty: 0.3
  });

  const raw = response.choices[0].message.content;

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