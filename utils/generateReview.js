const { getOpenAI } = require('./openaiClient');
const { withRetry } = require('./withRetry');


// === Generate Review for Schema ===
async function generateReview(businessName) {
    const prompt = `Write a natural-sounding, 5-star review for a local business called "${businessName}". 
  Keep it under 30 words. Include a realistic reviewer name (first and last).
  Format as: Reviewer Name: "Review text here".`;
  
     // Wrapped: a dropped connection ("terminated") used to lose this call
     // outright. Fires once per service page, so on a 10-page site there are
     // ten chances for a transient network fault.
     const response = await withRetry(() => getOpenAI().responses.create({
          model: "gpt-5.6-terra",
          input: prompt,
          reasoning: {
              effort: "low"
          },
          text: {
              verbosity: "medium"
          }
      }), { label: 'schema review' });
      
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