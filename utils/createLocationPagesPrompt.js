function createLocationPagesPrompt({ globalForLoc, keywords = [] }) {
  const { businessName, businessType, location } = globalForLoc;

  console.log(`Location Page location: ${location}`);
  console.log(`Next location or service: ${keywords[1]}`);
  console.log(`Next location or service: ${keywords[2]}`);

  const categoryMap = {
    'plumbing': 'plumbing',
    'electrician': 'electrical services',
    'roofing': 'roofing',
    'concrete contractor': 'concrete services',
    'hvac': 'hvac',
    'landscaping': 'landscaping',
    'law firm': 'law firm',
    'fencing':   'fencing'
  };

  const category = categoryMap[(businessType || '').toLowerCase()] || businessType || 'services';
  const typeOfCompany = category === 'law firm' ? '' : 'company';


  return `
You are writing the website content for a local ${category} ${typeOfCompany} named "${businessName}", located in ${location}.

Write 4 sections. Each section must include:
- A heading (use ${businessName} / ${location} / ${category} context to make it natural)
- Two short, helpful paragraphs that sound natural and professional and stay on-topic.

Force the following inclusions (exact phrases, lowercase, no quotes):
1) Section 1:
   - Generate an SEO-first heading including ${category} and ${location}.
    - Create a relevant subheading.
   - Include ${businessName} and ${location} in the FIRST paragraph. 
2) Section 2:
   ${category}. for this section generate a human first approach heading.
   In the first paragraph of this section include this word ${keywords[1]}.
3) Section 3:
  For this section also generate a human first approach heading different from
   the previous one but related to ${category}.
   In the first paragraph of this section include this word ${keywords[2]}.
4) Section 4:
   - Human-first heading focused on ${location}.
   In the first paragraph talk about ${location}
   In the second paragraph include at least 4 zip codes, neighborhoods or landmarks of ${location}.
  

Rules:
- Do NOT output markdown formatting or labels like (H3).
- Keep everything natural; weave keywords into sentences without keyword stuffing.
- Use lowercase for the anchor keywords exactly as provided above.
- Do not include bullet lists in the final content.

Return the result as a JSON object with this exact shape:

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
    "heading": "Heading text",
    "paragraphs": ["Paragraph 1", "Paragraph 2"]
  },
  "section4": {
    "heading": "Heading text",
    "paragraphs": ["Paragraph 1", "Paragraph 2"]
  },
 }`.trim();
}

module.exports = { createLocationPagesPrompt };
