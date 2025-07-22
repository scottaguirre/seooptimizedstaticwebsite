
const { smartTitleCase } = require('./smartTitleCase');
const { normalizeText  } = require('./normalizeText');

function createPagesPrompt({ globalValues, page, keywords}) {
    const { businessName, location, businessType } = globalValues;
    
    const categoryMap = {
      'plumbing' : 'plumbing',
      'electrician' : 'electrical services',
      'roofing': 'roofing',
      'concrete contractor': 'concrete services',
      'hvac': 'hvac',
      'landscaping': 'landscaping',
      'law lirm': 'law firm'
    };
  
    const category = categoryMap[businessType.toLowerCase()] || businessType;
    const typeOfCompany = category === 'law firm' ? '' : 'company';
  
    return `
  You are writing the website content for a local ${category} ${typeOfCompany} named "${businessName}", located in ${location}.
  
  Write 4 sections. Each section must include:
  - The given heading (use exactly as provided)
  - Two short, helpful paragraphs that sound natural and professional.

  Use these section headings in order:
1. ${page.section1H2} (for this section besides the 2 paragraphs, also create a relevant subheading. Do NOT include quotes, labels like (H3), or any formatting.).
    In the first paragraph of this section include this word ${businessName}.
2. ${page.section2H2}. In the first paragraph of this section  include this word ${keywords[1]}.
3. ${page.section3H2}. In the first paragraph of this section include this word ${keywords[2]}.
4. ${page.section4H2}

  
  
  Return the result as a JSON object with this exact format:
  
  {
    "section1": {
      "heading": "${smartTitleCase(normalizeText(page.section1H2))}",
      "subheading": "Subheading text",
      "paragraphs": ["Paragraph 1", "Paragraph 2"]
    },
    "section2": {
      "heading": "${smartTitleCase(normalizeText(page.section2H2))}",
      "paragraphs": ["Paragraph 1", "Paragraph 2"]
    },
    "section3": {
      "heading": "${smartTitleCase(normalizeText(page.section3H2))}",
      "paragraphs": ["Paragraph 1", "Paragraph 2"]
    },
    "section4": {
      "heading": "${smartTitleCase(normalizeText(page.section4H2))}",
      "paragraphs": ["Paragraph 1", "Paragraph 2"]
    },
  }
    `.trim();
  }
  
    
    module.exports = { createPagesPrompt };
    