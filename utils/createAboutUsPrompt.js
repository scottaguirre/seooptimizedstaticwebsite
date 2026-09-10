// The registry that replaced this file's private categoryMap — and the three
// other copies of it that had already drifted apart. See utils/businessShape.js.
const {
  businessShape,
  titleFor,
  servicesHeading,
  companyWord,
  entityFor,
  trustPoints,
} = require('./businessShape');

function createAboutUsPrompt({ globalValues, keywords}) {
  const { useNearMe, businessName, location, businessType } = globalValues;

  const category = titleFor(businessType);
  const shape = businessShape(businessType);

  // "Over 10 years" is deliberately conservative: the businesses on the
  // platform are vetted at 15-20 years, so this understates rather than
  // overstates. Computed from the current year so it never goes stale.
  const currentYear = new Date().getFullYear();
  const establishedYear = currentYear - 10;

  // Owner name: off, a real name the user typed, or on with nothing typed
  // (in which case the model invents one).
  const includeOwner = ['true', 'on', '1', true].includes(globalValues.includeOwner);
  const providedOwner = String(globalValues.ownerName || '').trim();

  // The word "owner" is required explicitly: left to itself the model writes
  // "led by Marcus Delgado", which reads as a manager rather than the person
  // who owns the business.
  const ownerRule = `Refer to this person as the OWNER — for example
    "owner Marcus Delgado" or "owned by Marcus Delgado". Do NOT write "led by",
    "headed by", "founded by", or "under the direction of".`;

  const ownerInstruction = !includeOwner
    ? `Do NOT name an owner or founder. Open instead on what the company does
    and who it serves, then say it has served the area since ${establishedYear}.`
    : providedOwner
      ? `Name the owner — ${providedOwner} — and say the company has served the
    area since ${establishedYear}. ${ownerRule}`
      : `Name the owner and say the company has served the area since
    ${establishedYear}. Invent a natural-sounding owner name that suits
    ${location} — first and last name, nothing unusual. ${ownerRule}`;

  // The 24-hour claim comes from the wizard, so it is only asserted when the
  // user ticked it. Every OTHER claim now works the same way — see the trust
  // point block below.
  const is24Hours = ['true', 'on', '1', true].includes(globalValues.is24Hours);

  // "" for a law firm or a medical practice: "a local law firm company" is the
  // sentence the old ternary produced for everything except lemon law.
  const typeOfCompany = companyWord(businessType);

  // The noun phrase in "X is a local ___ in Austin".
  //
  // Home keeps its historical wording — "a local Plumber company" — so no
  // existing customer's opening sentence changes. Everything else takes the
  // registry's noun phrase, because "a local Dentist company" and "a local
  // Web Designer studio" are what the old formula produces.
  const entityPhrase = shape === 'home'
    ? `${category}${typeOfCompany ? ` ${typeOfCompany}` : ''}`
    : entityFor(businessType);

  // Which trust points this business may claim.
  //
  // `pinned` are worded exactly and come first; `pool` is what the model picks
  // the rest from; `count` is how many to ask for — always even, because the
  // list renders as a two-column grid.
  //
  // Nothing claim-bearing is in here unless the owner ticked it in the wizard.
  // A dentist no longer gets "workmanship warranty" and a law firm no longer
  // gets "5-star rated by local customers", because neither is in their shape's
  // list at all.
  const trust = trustPoints(businessType, {
    claims: globalValues.trustClaims,
    is24Hours,
  });

  // How much freedom the model has with the wording.
  //
  // Home keeps "write those as benefits", which is what it has always said and
  // what produces the copy existing customers already have.
  //
  // Every other shape is verbatim, because on a regulated page the list is not
  // a style exercise — it is the record of what the owner ticked. Left to
  // paraphrase, the model turned "confidential case review" into "Free
  // confidential case review" on a real law firm build. It invented the word
  // "free". Nobody ticked a box saying the case review was free, and on an
  // attorney's site that is a fee claim.
  const wordingRule = shape === 'home'
    ? `    Write those as benefits, not a bare copy of the list above.
    Do NOT add anything that is not on this list, however plausible it sounds.`
    : `    Use each one EXACTLY as written above, word for word. Do not reword,
    reorder the words, shorten, expand, or add anything — especially not a
    price or availability word like "free", "same-day", "24/7" or "guaranteed".
    Copy the strings. This list is a record of what this business has confirmed
    is true of it, and a paraphrase is a new claim nobody approved.`;

  const trustBlock = trust.count === 0
    ? `    TRUST POINTS — return an EMPTY "trustPoints" array for this section.
    This business has not confirmed enough claims to fill the list, and an
    invented one is worse than none.`
    : `    TRUST POINTS — also return a "trustPoints" array for this section.

    Return exactly ${trust.count}. The list renders as a two-column grid, so an
    even number keeps it balanced.
${trust.pinned.length ? `
    These must appear FIRST, worded exactly as given:
${trust.pinned.map(p => `      "${p}"`).join('\n')}

    Then add ${trust.count - trust.pinned.length} more, ` : `
    Each is `}3 to 6 words, no full stops, drawn ONLY from:
${trust.pool.map(p => `      ${p}`).join('\n')}
${wordingRule}`;

  // What the model may assert as fact.
  //
  // This used to read: "Every business on this platform is genuinely licensed,
  // insured, bonded and accredited, and holds a 5-star rating, so those claims
  // are accurate." Nobody had checked that about the particular business whose
  // page was being written, and for a medical or legal practice an unverified
  // credential claim is a licensing-board matter rather than a marketing one.
  const accuracyRules = {
    medical: `- Do NOT claim any rating, review score, award, board certification,
  specialty designation, or professional membership.
- Do NOT promise an outcome, a recovery time, or that any treatment is
  painless, permanent or guaranteed.
- Do NOT state prices, insurance reimbursement amounts, or what a visit costs.
- Do NOT name a condition this practice claims to cure.`,

    professional: `- Do NOT claim any rating, review score, award, "best" or "top" ranking,
  specialisation, or bar association membership.
- Do NOT predict or imply an outcome, a settlement figure, or a success rate.
- Do NOT describe past results, and do NOT quote or invent a client testimonial.
- Do NOT state fees, hourly rates, or contingency percentages.`,

    project: `- Do NOT invent awards, certifications, partner status, or named clients.
- Do NOT quote traffic, ranking or revenue results, for this business or anyone.
- Do NOT state prices or guarantee a delivery date.`,

    home: `- Do NOT invent any credential beyond the trust points listed above — no
  awards, no certifications by name, no membership bodies, no license numbers.
- Do NOT state exact prices or guarantee response times.`,

    generic: `- Do NOT claim any credential, licence, rating, award, accreditation or
  membership. Nothing about this business has been verified.
- Do NOT state prices or guarantee response times.`,
  };

  const accuracy = accuracyRules[shape] || accuracyRules.generic;

  // The four things paragraph 2 has to cover.
  //
  // Two of the home ones — family owned, upfront pricing — are claims that
  // also live in the trust point list, so they are dropped here when the owner
  // has not ticked them. Otherwise unticking "family owned and operated" would
  // remove it from the grid and leave it asserted in the prose two lines below,
  // which is worse than not having the checkbox at all.
  const claimed = new Set([...trust.pinned, ...trust.pool]);
  const ifClaimed = (label, text) => (claimed.has(label) ? [text] : []);

  const paragraphTwoByShape = {
    home: [
      ...ifClaimed('family owned and operated', 'that the business is family owned and operated'),
      ...ifClaimed('upfront pricing, no hidden fees', 'upfront pricing with no hidden fees'),
      `over 10 years serving ${location}`,
      'follow-up support after the work is finished',
    ],
    medical: [
      `over 10 years caring for patients in ${location}`,
      'what a first visit involves',
      'how appointments are scheduled and how new patients get started',
      'that patient records and conversations are kept confidential',
    ],
    professional: [
      `over 10 years serving clients in ${location}`,
      'what happens at an initial consultation',
      'how clients are kept informed as a matter progresses',
      'that enquiries are treated confidentially',
    ],
    project: [
      `over 10 years working with businesses in ${location}`,
      'how a project starts and what the first conversation covers',
      'how progress is shared while the work is underway',
      'what happens after launch',
    ],
    generic: [
      `over 10 years serving ${location}`,
      'how a first enquiry is handled',
      'how pricing is agreed before any work begins',
      'what support is available afterwards',
    ],
  };

  const paragraphTwoPoints = paragraphTwoByShape[shape] || paragraphTwoByShape.generic;

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
You are writing the "About Us" page for a local ${entityFor(businessType)} named "${businessName}", located in ${location}.

Write ${includeNearMe ? 5 : 4} sections. Each section must include:
- The given heading (use exactly as provided)
- Two short, helpful paragraphs that sound natural and professional.

Use these section headings in order:
1. 'Who is ${businessName}?'

    SUBHEADING — use exactly this, word for word:
    We Are Your Local ${businessName} in ${location}

    PARAGRAPH 1 — keep it to two or three sentences. Start with exactly this phrase:
    ${businessName} is a local ${entityPhrase} in ${location}.
    ${ownerInstruction}

${trustBlock}

    PARAGRAPH 2 — must naturally cover ALL of the following:
${paragraphTwoPoints.map(p => `      ${p}`).join('\n')}
    Include this word: ${rawKeywords[0]}
    Do not write it as a list. Two or three flowing sentences.

2. '${servicesHeading(businessType)}' — use that heading exactly as written.
The first paragraph should list at least 10 services a local ${entityFor(businessType)} offers.
In the second paragraph of this section include this word ${rawKeywords[1]}.

3. 'What Makes Us Stand Out?'. In the second paragraph of this section include this word ${rawKeywords[2]}.

4. Talk about ${location}.
Please include the 7 closest zip codes to the main location ${location} and 5 landmarks of ${location}.
In the second paragraph of this section  include this word ${rawKeywords[3]}.

${includeNearMe ? `
5. '${category} Near Me' (this phrase must also be included naturally in the  first paragraph text).
    In the second paragraph of this section include this word ${rawKeywords[4]}.
` : ''}



ACCURACY
${accuracy}

TONE
- Never list more than two trust claims in a single sentence. Spread them
  through the prose so the page reads as writing rather than a brochure.
- Do NOT put the business name straight in front of the trade. "San Jose Lemon
  Law Lemon Law Attorney services are available" is the sentence this prevents.
  Write "San Jose Lemon Law" or "our ${category} services", never both touching.
- Avoid: "When it comes to", "Whether you need", "Look no further",
  "In today's world", and describing the company as dedicated or committed.

Return the result as a JSON object with this exact format:

{
  "section1": {
    "heading": "Who is ${businessName}",
    "subheading": "Subheading text",
    "trustPoints": [${trust.count ? Array.from({ length: trust.count }, (_, i) => `"Point ${i + 1}"`).join(', ') : ''}],
    "paragraphs": ["Paragraph 1", "Paragraph 2"]
  },
  "section2": {
    "heading": "${servicesHeading(businessType)}",
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
    "heading": "${category} Near Me",
    "paragraphs": ["Paragraph 1", "Paragraph 2"]
  }
}
  `.trim();
}

  
  module.exports = { createAboutUsPrompt };