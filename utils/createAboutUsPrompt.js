

function createAboutUsPrompt({ globalValues, keywords}) {
  const { useNearMe, businessName, location, businessType } = globalValues;

  const categoryMap = {
    'plumbing':        'Plumber',
    'electrician':     'Electrician',
    'roofing':         'Roofing Contractor',
    'concrete contractor': 'Concrete Contractor',
    'hvac':            'HVAC Technician',
    'landscaping':     'Landscaper',
    'law firm':        'Lawyer',
    'fencing':         'Fencing'
  };

  const category = categoryMap[businessType.toLowerCase()] || businessType;
  const typeOfCompany = category === 'Lawyer' ? '' : 'company';

  const includeNearMe = String(useNearMe) === 'true';

  return `
You are writing the "About Us" page for a local ${businessType.toLowerCase()} ${typeOfCompany} named "${businessName}", located in ${location}.

Write ${includeNearMe ? 5 : 4} sections. Each section must include:
- The given heading (use exactly as provided)
- Two short, helpful paragraphs that sound natural and professional.

Use these section headings in order:
1. 'Who We Are' (besides the 2 paragraphs, also create a subheading related to 'Who We Are').
    In the second paragraph of this section include this word ${keywords[0]}.
2. 'Our Story'. In the second paragraph of this section  include this word ${keywords[1]}.
3. 'What Makes Us Stand Out?'. In the second paragraph of this section include this word ${keywords[2]}.
4. 'Services We Offer'. In the second paragraph of this section include this word ${keywords[3]}.

${includeNearMe ? `
5. '${category} Near Me' (this phrase must also be included naturally in the  first paragraph text).
    Please include some zip codes and landmarks of ${location}.
    In the second paragraph of this section include this word ${keywords[4]}.
` : ''}

Return the result as a JSON object with this exact format:

{
  "section1": {
    "heading": "Who We Are",
    "subheading": "Subheading text",
    "paragraphs": ["Paragraph 1", "Paragraph 2"]
  },
  "section2": {
    "heading": "Our Story",
    "paragraphs": ["Paragraph 1", "Paragraph 2"]
  },
  "section3": {
    "heading": "What Makes Us Stand Out?",
    "paragraphs": ["Paragraph 1", "Paragraph 2"]
  },
  "section4": {
    "heading": "Services We Offer",
    "paragraphs": ["Paragraph 1", "Paragraph 2"]
  },
  "section5": {
    "heading": "${businessType} Near Me",
    "paragraphs": ["Paragraph 1", "Paragraph 2"]
  }
}
  `.trim();
}

  
  module.exports = { createAboutUsPrompt };
  