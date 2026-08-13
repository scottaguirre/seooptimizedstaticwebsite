const { getOpenAI } = require('./openaiClient');


// === Generate Review for Schema ===
async function generateReview(businessName) {
    const prompt = `Write a natural-sounding, 5-star review for a local business called "${businessName}". 
  Keep it under 30 words. Include a realistic reviewer name (first and last).
  Format as: Reviewer Name: "Review text here".`;
  
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
      
      console.log("generateReview usage:", response.usage);
      
      const raw = response.output_text.trim();

      const [name, reviewText] = raw.split(/:(.+)/);
  
    return [{
      "@type": "Review",
      author: { "@type": "Person", name: name.trim() },
      reviewBody: reviewText.replace(/["']/g, '').trim(),
      reviewRating: {
        "@type": "Rating",
        ratingValue: "5",
        bestRating: "5"
      }
    }];
  }

  module.exports = { generateReview };
