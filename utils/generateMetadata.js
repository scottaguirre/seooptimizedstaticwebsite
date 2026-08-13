const { getOpenAI } = require('./openaiClient'); 


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
