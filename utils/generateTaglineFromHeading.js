const { getOpenAI } = require('./openaiClient');


// === Generate tagline based on the main heading (H1) ===
async function generateTaglineFromHeading(h1Heading) {
    const prompt = `Write a short, catchy tagline (under 12 words) that supports the following website main heading:
  "${h1Heading}"
  Make it friendly, confident, and relevant to the heading.`;
  
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

    console.log("generateTaglineFromHeadings usage:", response.usage);

    return response.output_text.trim().replace(/["']/g, '');
  }


  module.exports = { generateTaglineFromHeading };

  