const fs = require('fs');
const path = require('path');
const { createPagesPrompt } = require('./createPagesPrompt');
const { OpenAI } = require('openai');
const openai = new OpenAI();

async function generatePagesContent(globalValues, page, pagesInterlinks, attempt = 1) {
  
  const prompt = createPagesPrompt({
    globalValues,
    page,
    keywords: pagesInterlinks
  });

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7
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
      console.log('🔁 Retrying Pages content generation...: generatePagesContent.js');
      return await generatePagesContent(globalValues, pagesInterlinks, attempt + 1);
    }

    return {};
  }
}

module.exports = { generatePagesContent };
