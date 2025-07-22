const openai = require('./openaiClient');


// === Generate tagline based on the main heading (H1) ===
async function generateTaglineFromHeading(h1Heading) {
    const prompt = `Write a short, catchy tagline (under 12 words) that supports the following website main heading:
  "${h1Heading}"
  Make it friendly, confident, and relevant to the heading.`;
  
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
    });
  
    return response.choices[0].message.content.trim().replace(/["']/g, '');
  }


  module.exports = { generateTaglineFromHeading };