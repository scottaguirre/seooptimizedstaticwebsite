function createAboutUsPrompt({ globalValues, keywords}) {
  const { useNearMe, businessName, location, businessType } = globalValues;

  const categoryMap = {
    'plumbing':         'Plumber',
    'electrician':      'Electrician',
    'roofing':          'Roofing Contractor',
    'concrete contractor': 'Concrete Contractor',
    'hvac':             'Hvac Repair',
    'air conditioning': 'Air Conditioning',
    'landscaping':      'Landscaper',
    'law firm':         'Lemon Law Lawyer',
    'fencing':          'Fence Company',
    'junk removal':     'Junk Removal',
    'tree removal':     'Tree Removal',
    'paving':          'Paving',
    'swimming pool contractor': 'Swimming Pool Contractor',
    'water damage restoration': 'Water Damage Restoration'
  };

  const category = categoryMap[businessType.toLowerCase()] || businessType;

  // "Over 10 years" is deliberately conservative: the businesses on the
  // platform are vetted at 15-20 years, so this understates rather than
  // overstates. Computed from the current year so it never goes stale.
  const currentYear = new Date().getFullYear();
  const establishedYear = currentYear - 10;
  const typeOfCompany = category === 'Lemon Law Lawyer' ? '' : 'company';

  const includeNearMe = String(useNearMe) === 'true';

  // 🔹 NEW: normalize and pad keywords so we never hit undefined
  const requiredCount = includeNearMe ? 5 : 4;
  const rawKeywords = Array.isArray(keywords) ? [...keywords] : [];

  const fallbackPool = [
    businessName,
    location,
    category,
    `${category} in ${location}`,
    `${businessName} ${category}`
  ].filter(Boolean);

  while (rawKeywords.length < requiredCount) {
    const idx = rawKeywords.length % fallbackPool.length;
    rawKeywords.push(
      fallbackPool[idx] ||
      businessName ||
      location ||
      'our services'
    );
  }


  return `
You are writing the "About Us" page for a local ${businessType.toLowerCase()} ${typeOfCompany} named "${businessName}", located in ${location}.

Write ${includeNearMe ? 5 : 4} sections. Each section must include:
- The given heading (use exactly as provided)
- Two short, helpful paragraphs that sound natural and professional.

Use these section headings in order:
1. 'Who is ${businessName}?' (besides the paragraphs, also create a subheading related to 'Who We Are' but including ${category}).

    PARAGRAPH 1 — keep it to two or three sentences. Start with exactly this phrase:
    ${businessName} is a local ${category} company serving ${location}.
    Then introduce the owner by name and say the company has served the area
    since ${establishedYear}. Invent a natural-sounding owner name that suits
    ${location} — first and last name, nothing unusual.

    TRUST POINTS — also return a "trustPoints" array for this section with
    exactly 6 short entries, 3 to 6 words each, no full stops. Draw them from:
      licensed, insured and bonded
      accredited
      5-star rated by local customers
      same-day service available
      free onsite estimates
      workmanship warranty
      flexible scheduling
    Write them as benefits, not a bare copy of the list above.

    PARAGRAPH 2 — must naturally cover ALL of the following:
      that the business is family owned and operated
      upfront pricing with no hidden fees
      over 10 years serving ${location}
      follow-up support after the work is finished
    Include this word: ${rawKeywords[0]}
    Do not write it as a list. Three  to four flowing sentences.

2. 'Why you should hire ${businessName}?'. In the second paragraph of this section include this word ${rawKeywords[1]}.

3. '${businessType} Services We Offer'. The first paragraph should list at least 10 services a local ${category} business offers.
In the second paragraph of this section include this word ${rawKeywords[2]}.

4. Talk about ${location}.
Please include the 7 closest zip codes to the main location ${location} and 5 landmarks of ${location}.
In the second paragraph of this section  include this word ${rawKeywords[3]}.

${includeNearMe ? `
5. '${category} Near Me' (this phrase must also be included naturally in the  first paragraph text).
    In the second paragraph of this section include this word ${rawKeywords[4]}.
` : ''}



ACCURACY
- Every business on this platform is genuinely licensed, insured, bonded and
  accredited, and holds a 5-star rating, so those claims are accurate. Do not
  invent any OTHER credential — no awards, no certifications by name, no
  membership bodies, no specific license numbers.
- Do not state exact prices or guarantee response times.

TONE
- Never list more than two trust claims in a single sentence. Spread them
  through the prose so the page reads as writing rather than a brochure.
- Avoid: "When it comes to", "Whether you need", "Look no further",
  "In today's world", and describing the company as dedicated or committed.

Return the result as a JSON object with this exact format:

{
  "section1": {
    "heading": "Who is ${businessName}",
    "subheading": "Subheading text",
    "trustPoints": ["Point 1", "Point 2", "Point 3", "Point 4", "Point 5", "Point 6"],
    "paragraphs": ["Paragraph 1", "Paragraph 2"]
  },
  "section2": {
    "heading": "Services We Offer",
    "paragraphs": ["Paragraph 1", "Paragraph 2"]
  },
  "section3": {
    "heading": "What Makes Us Stand Out?",
    "paragraphs": ["Paragraph 1", "Paragraph 2"]
  },
  "section4": {
    "heading": "${location}",
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