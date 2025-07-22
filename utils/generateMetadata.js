
const openai = require('./openaiClient');


// === Generate <title> and <meta description> tags ===
async function generateMetadata(businessName, keyword, location, formatCityState) {


    const prompt = `Write an SEO-optimized <title> tag (under 60 characters) and <meta name="description"> (under 160 characters) for a business website.
  Include this:
  - Business Name: ${businessName}
  - Keyword: ${keyword}
  - Location: ${formatCityState(location)}
  Format:
  <title>...</title>
  <meta name="description" content="...">`;
  
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
    });
  
    const content = response.choices[0].message.content;
    const titleMatch = content.match(/<title>(.*?)<\/title>/i);
    const descMatch = content.match(/<meta\s+name="description"\s+content="(.*?)"\s*\/>/i);
  
    return {
      title: titleMatch ? titleMatch[1] : `${businessName} – ${keyword}`,
      description: descMatch ? descMatch[1] : `Learn more about ${businessName}, your local ${keyword} in ${formatCityState(location)}.`,
    };
  }

  module.exports = { generateMetadata };
