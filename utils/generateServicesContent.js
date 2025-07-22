const openai = require('./openaiClient');


// === Generate Services Content ===
async function generateServicesContent(businessName, keyword) {
    const prompt = `Write content about the different services a local business offers.
                    This content is for a website page named "services".
                    The name of the local business is "${businessName}".
                    Also here is a keyword you can utilize along with the business name to get an idea of what
                    the local business is about: "${keyword}", but if the keyword includes the phrase "near me",
                    do not include that phrase as a part of the keyword. For instance if the keyword is "plumber near me",
                    you will generate content about differen services plumbing companies might offer such as; water heater installation, slab leak detection and so on.
                    If the keyword and business name is related to roofing you will generate content related to roofing such as: roofing inspection, roofing replacement, 
                    metal roofing installation, et. 
                    Make it informative and natural. You can Return the content in html format so I can inject it to a div tag.
                    Please separates paragrahp on a new line.`;
  
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
    });
  
    return response.choices[0].message.content.trim();
  }


  module.exports = { generateServicesContent };