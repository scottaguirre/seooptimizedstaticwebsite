// utils/createLocationPagesPrompt.js
//
// WHY THIS WAS REWRITTEN
//
// The previous prompt anchored only Section 4 to the location. Sections 1-3
// said, in effect, "write about plumbing" — with no local input at all. Since
// businessName and category are identical across every location page, those
// three sections came back near-identical each time, and Search Console
// flagged the pages as duplicates.
//
// Three changes address that:
//
//   1. EVERY section now requires location-specific substance, not just one.
//   2. Each location gets a different ANGLE, rotated by index. Without this,
//      pages stay structurally identical even when the place names differ —
//      same four topics in the same order, which still reads as templated.
//   3. Local detail is DISTRIBUTED across sections instead of dumped into a
//      single "here are some zip codes" paragraph, which is the pattern
//      Google most readily recognises as filler.
//
// A caveat worth knowing: the model's knowledge of small towns is thin, and
// it will invent neighbourhoods and landmarks if pushed. The prompt therefore
// asks for detail it is more likely to get right (road names, adjacent towns,
// housing stock, climate) and tells it to omit rather than guess.

const { businessShape, categoryFor, entityFor } = require('./businessShape');

/**
 * Six angles, rotated by location index. Each leads with a genuinely
 * different topic, so two location pages for the same business open on
 * different ground rather than paraphrasing each other.
 *
 * These six are the HOME SERVICES set. See LOCATION_ANGLES_BY_SHAPE below.
 */
const LOCATION_ANGLES = [
  {
    focus: 'response times and coverage',
    section2: 'how quickly the team reaches this specific area, and what that means for urgent work',
    section3: 'the most common reason customers in this area call for this service',
  },
  {
    focus: 'the local housing stock and its typical problems',
    section2: 'the age and construction style of properties in this area, and the issues that come with them',
    section3: 'what a first visit involves, and how the work is scoped before anything starts',
  },
  {
    focus: 'seasonal and weather-driven demand',
    section2: 'how the local climate and seasons affect demand for this service',
    section3: 'what customers can do between visits to avoid larger problems later',
  },
  {
    focus: 'the range of properties served in the area',
    section2: 'the mix of residential and commercial work handled locally',
    section3: 'how pricing is approached, and what customers should expect during the quote',
  },
  {
    focus: 'local reputation and repeat customers',
    section2: 'the kind of work most often requested by customers in this area',
    section3: 'the standards, equipment or methods used, explained plainly',
  },
  {
    focus: 'accessibility and getting to the job',
    section2: 'practical details of working in this part of the region — access, parking, permits where relevant',
    section3: 'how the team communicates with customers from booking through to completion',
  },
];

/**
 * The six above are written for a trade: housing stock, arrival windows, site
 * access, parking, permits. A dental practice has none of those and a law firm
 * has none of them twice.
 *
 * Same six slots in the same order, so a town keeps its angle index whatever
 * the business is and generateLocationFaq's question themes stay aligned with
 * the page copy they sit under.
 */
const LOCATION_ANGLES_BY_SHAPE = {
  medical: [
    {
      focus: 'getting seen, and how soon',
      section2: 'how quickly new and existing patients from this area can be seen, and what counts as urgent',
      section3: 'the reason patients in this area most often get in touch',
    },
    {
      focus: 'who lives in the area and what they come in for',
      section2: 'the mix of people served locally — families, older patients, working adults — and what they typically need',
      section3: 'what a first appointment involves, from history to examination to a plan',
    },
    {
      focus: 'seasonal and local health patterns',
      section2: 'what the local seasons and conditions mean for this kind of care through the year',
      section3: 'what patients can do between appointments to hold on to the progress made',
    },
    {
      focus: 'cover, billing and getting started',
      section2: 'how cover and billing are handled for patients from this area, in general terms',
      section3: 'how a treatment plan is explained and agreed before anything begins',
    },
    {
      focus: 'continuity of care locally',
      section2: 'the treatments most often provided to patients from this area',
      section3: 'the equipment, methods or standards used, explained without jargon',
    },
    {
      focus: 'getting to the practice',
      section2: 'practical detail for people travelling from this area — journey, parking, access, appointment times',
      section3: 'how the practice stays in touch with patients between visits',
    },
  ],

  professional: [
    {
      focus: 'how quickly a new enquiry is looked at',
      section2: 'how soon someone from this area can expect a first response and an initial conversation',
      section3: 'the situation clients in this area most often arrive with',
    },
    {
      focus: 'who the firm acts for locally',
      section2: 'the kinds of client and matter handled for people in this area',
      section3: 'what an initial consultation covers, and what to bring to it',
    },
    {
      focus: 'timing and deadlines',
      section2: 'why timing matters in this kind of matter, and what tends to be time-limited',
      section3: 'what someone can do early on to put themselves in a better position',
    },
    {
      focus: 'how the work is scoped and charged',
      section2: 'how matters for clients in this area are usually structured',
      section3: 'how fee arrangements are explained and agreed in writing before work begins',
    },
    {
      focus: 'local knowledge',
      section2: 'the courts, agencies or processes that apply to people in this area',
      section3: 'the approach taken to a matter, described plainly and without predicting an outcome',
    },
    {
      focus: 'working together through a matter',
      section2: 'practical detail for clients from this area — meetings, remote consultations, document handling',
      section3: 'how clients are kept informed as a matter progresses',
    },
  ],

  project: [
    {
      focus: 'how a project starts',
      section2: 'how quickly a business in this area can get from first contact to a written proposal',
      section3: 'the reason businesses in this area most often get in touch',
    },
    {
      focus: 'the local business mix',
      section2: 'the kinds of business served in this area and what they typically need built',
      section3: 'what a discovery conversation covers before any estimate is given',
    },
    {
      focus: 'timelines and what drives them',
      section2: 'what makes one project in this area take longer than another',
      section3: 'what a client can prepare in advance to keep a project moving',
    },
    {
      focus: 'scope and proposals',
      section2: 'how work for clients in this area is scoped and quoted',
      section3: 'what a written proposal covers, and what deliberately sits outside it',
    },
    {
      focus: 'the work itself',
      section2: 'the kind of work most often requested by businesses in this area',
      section3: 'the tools, platforms or methods used, explained without jargon',
    },
    {
      focus: 'after launch',
      section2: 'practical detail for clients from this area — handover, training, who owns the accounts',
      section3: 'how support and maintenance work once a project is live',
    },
  ],
};

// An unrecognised type gets the professional set: it assumes no building, no
// vehicle and no patient, which is the entire point of the generic shape.
LOCATION_ANGLES_BY_SHAPE.generic = LOCATION_ANGLES_BY_SHAPE.professional;
LOCATION_ANGLES_BY_SHAPE.home = LOCATION_ANGLES;

/** The six angles that suit a given business type. */
function anglesFor(businessType) {
  return LOCATION_ANGLES_BY_SHAPE[businessShape(businessType)] || LOCATION_ANGLES;
}

/** Vary the heading style too, so every page's H1 isn't the same formula. */
const HEADING_STYLES = [
  'a direct service-and-place heading',
  'a heading that leads with the benefit to the customer',
  'a heading phrased around the local area first',
  'a heading that names the specific problem being solved',
];

function createLocationPagesPrompt({ globalForLoc, keywords = [], locationIndex = 0 }) {
  const { businessName, businessType, location } = globalForLoc;

  // This copy of the map was missing 'french drain installation' — an entry
  // the other three copies had. See utils/businessShape.js for why there is
  // now one.
  const category = categoryFor(businessType);
  const entityPhrase = entityFor(businessType);

  const angles = anglesFor(businessType);
  const angle = angles[locationIndex % angles.length];
  const headingStyle = HEADING_STYLES[locationIndex % HEADING_STYLES.length];

  console.log(`   Location page: ${location} — angle: ${angle.focus}`);

  return `
You are writing a location page for a local ${entityPhrase} named "${businessName}".

This page is specifically about serving **${location}**. It is one of several
location pages on the same website. Pages for other towns already exist, so
this one must read as though it were written by someone who knows ${location}
in particular — not as a template with the town name swapped in.

THE ANGLE FOR THIS PAGE: ${angle.focus}.
Lead with that angle and let it shape the whole page.

Write 5 sections. Each needs a heading and two paragraphs.

SECTION 1
- Heading: ${headingStyle}, including ${category} and ${location}.
- Also write a short subheading.
- Paragraph 1 must name ${businessName} and ${location}, and open on the angle above.
- Paragraph 2 must mention something concrete about ${location} itself — its
  position in the region, a road or highway that serves it, a neighbouring
  town, or how the area has grown.

SECTION 2
- Human-first heading. Cover: ${angle.section2}.
- Paragraph 1 must include this exact lowercase phrase: ${keywords[1] || category}
- Paragraph 1 must also refer to ${location} or its immediate surroundings.

SECTION 3
- Human-first heading, clearly different in structure from Section 2's.
- Cover: ${angle.section3}.
- Paragraph 1 must include this exact lowercase phrase: ${keywords[2] || category}
- Include at least one detail that would not be true of every town — the
  local property type, terrain, weather pattern, or typical job for the area.

SECTION 4 — what the work actually looks like here
- Human-first heading. This section carries the page's most useful material,
  so make it concrete rather than promotional.
- Paragraph 1: the two or three jobs customers in this area request most
  often, and why those in particular. Tie it to something real about the
  area — the age of the housing, the local climate, the terrain, the soil,
  or the mix of homes and businesses.
- Paragraph 2: what happens when someone calls. Typical arrival window,
  whether the work is usually finished in one visit, and one problem that
  recurs in properties around here along with how it is dealt with.
- Give a realistic time range (for example "same day" or "within two hours"
  for urgent work) but do NOT state guaranteed times, prices, or promises.

SECTION 5 — service area
- Heading focused on the ${location} service area.
- Paragraph 1: which parts of ${location} and which nearby communities are
  covered, and roughly how far the team travels.
- Paragraph 2: name at least 4 real, specific places — neighbourhoods, zip
  codes, major roads or well-known landmarks in or around ${location}.

ACCURACY
- Only state local details you are reasonably confident are real. If you are
  unsure of a neighbourhood or landmark name, use a road, a zip code, or an
  adjacent town instead. Do NOT invent place names.
- Do not state opening hours, prices, license numbers, or years in business.

MAKING THIS PAGE DISTINCT
- Do not open any paragraph with "When it comes to", "Whether you need",
  "At ${businessName}, we", "Look no further", or "In today's world".
- Do not describe the company as trusted, reliable, professional, dedicated,
  or committed. Show the point instead of claiming it.
- Vary sentence length. Avoid three consecutive sentences of similar shape.
- Every paragraph must contain at least one CONCRETE noun — a material, a
  component, a season, a property type, a tool, a specific problem. This is
  what makes the page distinct.
- Do NOT put the place name in every paragraph. Naming ${location} in all ten
  paragraphs reads as keyword stuffing and makes the page look more templated,
  not less. Use it where it belongs: the opening, Section 4's local detail,
  and Section 5's coverage. Roughly five or six mentions across the whole page
  is right.

FORMAT
- No markdown, no labels like (H2), no bullet lists.
- Use the anchor phrases in lowercase exactly as given.
- Weave keywords into natural sentences; do not stuff them.

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
  "section5": {
    "heading": "Heading text",
    "paragraphs": ["Paragraph 1", "Paragraph 2"]
  }
}
`.trim();
}

module.exports = {
  createLocationPagesPrompt,
  LOCATION_ANGLES,
  LOCATION_ANGLES_BY_SHAPE,
  anglesFor,
  HEADING_STYLES,
};