
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
  - A heading (use ${page.keyword} as a reference to generate the heading)
  - Two short, helpful paragraphs that sound natural and professional realated to the heading.

  Use this keyword to generate the content in order:
1. ${page.keyword} (for this section generate a SEO first approach heading.
    Besides the 2 paragraphs, also create a relevant subheading.
    Do NOT include quotes, labels like (H3), or any formatting.).
    In the first paragraph of this section include this word ${businessName}.
2. ${page.keyword}. for this section generate a human first approach heading.
   In the first paragraph of this section include this word ${keywords[1]}.
3. ${page.keyword}. for this section also generate a human first approach heading different from the previous one.
   In the first paragraph of this section include this word ${keywords[2]}.
4. ${page.keyword}. for this section also generate a human first approach heading different from the previous one.
   

  
  
  Return the result as a JSON object with this exact format:
  
  {
    "section1": {
      "heading": "Heading text",
      "subheading": "Subheading text",
      "paragraphs": ["Paragraph 1", "Paragraph 2"]
    },
    "section2": {
      "heading": "Heading text",
      "paragraphs": ["Paragraph 1", "Paragraph 2"]
    },
    "section3": {
      "heading": "Heading text"",
      "paragraphs": ["Paragraph 1", "Paragraph 2"]
    },
    "section4": {
      "heading": "Heading text"",
      "paragraphs": ["Paragraph 1", "Paragraph 2"]
    },
  }
    `.trim();
  }
  
    
    module.exports = { createPagesPrompt };
    