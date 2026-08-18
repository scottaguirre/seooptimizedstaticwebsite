const { getOpenAI } = require('./openaiClient');
const { withRetry } = require('./withRetry'); 


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
      }), { label: 'page metadata' });
      
      console.log("generateMetaData usage:", response.usage);
      
      const raw = response.output_text.trim();

    
    const titleMatch = raw.match(/<title>(.*?)<\/title>/i);
    const descMatch = raw.match(/<meta\s+name="description"\s+content="(.*?)"\s*\/>/i);
  
    return {
      title: titleMatch ? titleMatch[1] : `${businessName} – ${keyword}`,
      description: descMatch ? descMatch[1] : `Learn more about ${businessName}, your local ${keyword} in ${formatCityState(location)}.`,
    };
  }

  module.exports = { generateMetadata };