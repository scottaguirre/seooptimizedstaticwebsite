const openai = require('./openaiClient');


// === Generate Section 5: Service Area Paragraph from location ===
async function generateServiceAreaContent(location, businessName) {
    const prompt = `Write a paragraph for a business website explaining that the company serves all of "${location}". Mention the city/town, landmarks, a few zip codes, and express reliability. Use a friendly, confident tone. No bullets. The name of the business is ${businessName}. Avoid using formatting characters like *, , or #. Just return plain text. Do not labeled the output, just plain text`;
  
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
    });
  
    return response.choices[0].message.content.trim();
  }

  module.exports = { generateServiceAreaContent };
  