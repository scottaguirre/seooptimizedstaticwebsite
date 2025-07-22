const openai = require('./openaiClient');


// === Generate Review for Schema ===
async function generateReview(businessName) {
    const prompt = `Write a natural-sounding, 5-star review for a local business called "${businessName}". 
  Keep it under 30 words. Include a realistic reviewer name (first and last).
  Format as: Reviewer Name: "Review text here".`;
  
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
    });
  
    const line = response.choices[0].message.content.trim();
    const [name, reviewText] = line.split(/:(.+)/);
  
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
