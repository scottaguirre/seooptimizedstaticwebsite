const { getOpenAI } = require('./openaiClient');


// === Generate Section 5: Service Area Paragraph from location ===
async function generateServiceAreaContent(location, businessName) {
    const prompt = `Write a paragraph for a business website explaining that the company serves all of "${location}". Mention the city/town, landmarks, a few zip codes, and express reliability. Use a friendly, confident tone. No bullets. The name of the business is ${businessName}. Avoid using formatting characters like *, , or #. Just return plain text. Do not labeled the output, just plain text`;
  
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
    
    console.log("generateServiceAreaContent usage:", response.usage);
    
    return response.output_text.trim();
    
    
  }

  module.exports = { generateServiceAreaContent };
  