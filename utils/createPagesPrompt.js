// utils/createPagesPrompt.js
//
// WHY THIS WAS REWRITTEN
//
// The previous version gave sections 2, 3 and 4 identical instructions —
// "generate a human first approach heading different from the previous one".
// The model was never told what each section was ABOUT, so it invented topics
// and reached for the safest ones every time: what we do, why choose us, our
// commitment to quality, get in touch. That is where the genericness came
// from, not from the model's ability.
//
// Three changes:
//
//   1. Each section now has a distinct JOB. Problem -> process -> what
//      affects the work -> how to choose. A visitor reading top to bottom
//      gets a real answer rather than four variations on "we're great".
//
//   2. Per-trade VOCABULARY. The model was never given the nouns of the
//      trade, so it wrote about service quality instead of water heaters.
//      TRADE_VOCAB gives it components and symptoms to reach for.
//
//   3. Every paragraph must contain a concrete noun. This one rule is what
//      turns "we provide quality service" into "sediment collects in the
//      tank and the burner runs longer to compensate".
//
// "Short, helpful, professional" is also gone from the instructions — those
// adjectives produce exactly the bland copy they sound like.

const categoryMap = {
  'plumbing': 'plumbing',
  'electrician': 'electrical services',
  'roofing': 'roofing',
  'concrete contractor': 'concrete services',
  'hvac': 'hvac',
  'air conditioning': 'air conditioning',
  'landscaping': 'landscaping',
  'law firm': 'lemon law firm',
  'fencing': 'fencing',
  'junk removal': 'junk removal',
  'tree removal': 'tree removal',
  'paving': 'paving',
  'swimming pool contractor': 'swimming pool contractor',
  'water damage restoration': 'water damage restoration',
  'french drain installation': 'french drain installation',
};

/**
 * The nouns of each trade.
 *
 * Not a script — a vocabulary. The model picks what fits the specific service
 * being written about. Without this it has no concrete language available and
 * falls back to abstractions about quality and dedication.
 */
const TRADE_VOCAB = {
  'plumbing': {
    parts: 'tanks, valves, supply lines, shut-offs, traps, anode rods, thermostats, pressure regulators, cleanouts',
    symptoms: 'low pressure, discoloured water, slow drains, running toilets, damp patches, banging pipes, no hot water',
    work: 'isolating the supply, camera inspection, hydro jetting, soldering, re-seating fixtures, pressure testing',
  },
  'electrical services': {
    parts: 'breakers, panels, GFCI outlets, junction boxes, conduit, grounding, wiring runs, load centres',
    symptoms: 'tripping breakers, flickering lights, warm outlets, buzzing, burning smells, dead circuits',
    work: 'load calculations, panel upgrades, circuit tracing, thermal imaging, code inspection, rewiring',
  },
  'roofing': {
    parts: 'shingles, flashing, decking, underlayment, ridge vents, soffits, valleys, drip edge, gutters',
    symptoms: 'ceiling stains, missing shingles, granules in gutters, sagging, daylight in the attic, ice dams',
    work: 'tear-off, deck repair, felt and underlayment, flashing replacement, ventilation checks',
  },
  'concrete services': {
    parts: 'rebar, mesh, control joints, sub-base, forms, sealer, aggregate, expansion joints',
    symptoms: 'cracking, spalling, settling, pooling water, uneven slabs, surface flaking',
    work: 'excavation, grading, forming, pouring, finishing, curing, cutting control joints',
  },
  'hvac': {
    parts: 'compressors, coils, capacitors, blowers, ductwork, filters, thermostats, refrigerant lines, condensate drains',
    symptoms: 'short cycling, weak airflow, warm air, ice on the coil, high bills, strange noises, uneven rooms',
    work: 'refrigerant checks, coil cleaning, static pressure testing, duct sealing, capacitor replacement',
  },
  'air conditioning': {
    parts: 'compressors, evaporator coils, condensers, capacitors, filters, refrigerant lines, condensate drains, thermostats',
    symptoms: 'warm air, short cycling, ice on the lines, water around the unit, humidity, high bills',
    work: 'refrigerant charge checks, coil cleaning, drain clearing, capacitor testing, airflow measurement',
  },
  'landscaping': {
    parts: 'topsoil, mulch, irrigation heads, drip lines, edging, sod, retaining blocks, drainage',
    symptoms: 'bare patches, pooling water, erosion, overgrowth, compacted soil, dying shrubs',
    work: 'grading, soil preparation, planting, irrigation adjustment, seasonal pruning, mulching',
  },
  'fencing': {
    parts: 'posts, rails, pickets, concrete footings, gate hardware, post caps, panels',
    symptoms: 'leaning posts, rotted timber, sagging gates, loose pickets, rust, storm damage',
    work: 'setting posts, mixing footings, levelling runs, gate alignment, staining and sealing',
  },
  'junk removal': {
    parts: 'trucks, dumpsters, dollies, straps, sorting bins',
    symptoms: 'full garages, post-renovation debris, estate clearances, broken appliances, yard waste',
    work: 'sorting for recycling, safe lifting, disposal at licensed facilities, donating usable items',
  },
  'tree removal': {
    parts: 'cranes, chippers, rigging lines, stump grinders, climbing gear, chainsaws',
    symptoms: 'dead limbs, leaning trunks, root damage, storm breakage, fungus at the base, cracked bark',
    work: 'sectional felling, rigging over structures, stump grinding, canopy thinning, debris chipping',
  },
  'paving': {
    parts: 'base material, asphalt, binder, sealcoat, edging, drainage, jointing sand',
    symptoms: 'potholes, alligator cracking, standing water, faded surface, crumbling edges, rutting',
    work: 'excavation, base compaction, laying and rolling, crack filling, sealcoating, line marking',
  },
  'swimming pool contractor': {
    parts: 'pumps, filters, skimmers, returns, heaters, liners, tile, coping, chlorinators',
    symptoms: 'cloudy water, low flow, leaks, algae, cracked tile, high chemical use, noisy pumps',
    work: 'water testing, filter cleaning, leak detection, resurfacing, equipment replacement',
  },
  'water damage restoration': {
    parts: 'air movers, dehumidifiers, moisture meters, HEPA filtration, antimicrobial treatment',
    symptoms: 'wet carpet, musty smells, bubbling paint, warped flooring, staining, visible mould',
    work: 'water extraction, moisture mapping, controlled drying, containment, sanitising, monitoring',
  },
  'french drain installation': {
    parts: 'perforated pipe, gravel, filter fabric, catch basins, outlets, grading',
    symptoms: 'standing water, damp basements, soggy lawn, foundation seepage, erosion',
    work: 'trenching, sloping to fall, wrapping in fabric, backfilling, connecting outlets',
  },
  'lemon law firm': {
    parts: 'repair orders, warranty terms, manufacturer notices, arbitration filings, mileage records',
    symptoms: 'repeated repairs, extended time out of service, unresolved defects, denied claims',
    work: 'reviewing repair history, calculating eligibility, filing notice, negotiating with the manufacturer',
  },
};

const DEFAULT_VOCAB = {
  parts: 'materials, components, fittings, equipment',
  symptoms: 'wear, damage, faults, performance problems',
  work: 'assessment, preparation, repair or replacement, testing',
};

/**
 * The four sections, each with a job. This is the single biggest change:
 * previously all four said "generate a heading different from the previous
 * one" and nothing else.
 */
function sectionBriefs({ keyword, businessName, location, vocab, keywords }) {
  return [
    {
      n: 1,
      title: 'The problem, and when to call',
      brief: `Open on the situation that brings someone to search for "${keyword}".
    What are they noticing? Name at least two real symptoms — draw from:
    ${vocab.symptoms}. Say plainly when the problem can wait and when it
    cannot. Mention ${businessName} once in the first paragraph.`,
      seo: true,
    },
    {
      n: 2,
      title: 'What the work involves',
      brief: `Walk through what actually happens on the job, in order. Name the
    parts and equipment involved — draw from: ${vocab.parts} — and the steps
    taken: ${vocab.work}. Written so someone who has never had this done knows
    what to expect. Include this exact lowercase phrase: ${keywords[1]}`,
    },
    {
      n: 3,
      title: 'What changes the job',
      brief: `Explain what makes one ${keyword} job different from another: the
    age and type of property, access, what is found once work starts, the
    materials chosen, and the season. Be concrete about the trade-offs — a
    repair that buys two years versus a replacement that lasts fifteen.
    Include this exact lowercase phrase: ${keywords[2]}`,
    },
    {
      n: 4,
      title: 'Choosing who does the work',
      brief: `What a homeowner in ${location} should check before hiring anyone
    for ${keyword} — what to ask, what a proper estimate covers, what a good
    contractor explains before starting. Write it as advice the reader can
    use, NOT as a list of reasons to pick ${businessName}. Earn the trust
    rather than asking for it.`,
    },
  ];
}

function createPagesPrompt({ globalValues, page, keywords }) {
  const { businessName, location, businessType } = globalValues;

  const category = categoryMap[(businessType || '').toLowerCase()] || businessType;
  const typeOfCompany = category === 'lemon law firm' ? '' : 'company';
  const vocab = TRADE_VOCAB[category] || DEFAULT_VOCAB;

  // Make sure we have at least 3 keyword entries
  const safeKeywords = Array.isArray(keywords) ? [...keywords] : [];
  const fallback = page.keyword || category || businessName || 'our services';
  while (safeKeywords.length < 3) {
    safeKeywords.push(fallback);
  }

  const briefs = sectionBriefs({
    keyword: page.keyword,
    businessName,
    location,
    vocab,
    keywords: safeKeywords,
  });

  const sectionText = briefs.map(s => `
${s.n}. ${s.title}
    ${s.brief}${s.seo ? `
    This section leads the page, so write an SEO-first heading built around
    "${page.keyword}". Also write a subheading.` : `
    Human-first heading, clearly different in shape from the previous ones.`}`).join('\n');

  return `
You are writing a service page for a local ${category} ${typeOfCompany} named "${businessName}", serving ${location}.

The page is about: ${page.keyword}

Someone reading this page has this problem right now. Write for them, not for
a search engine — the ranking follows from being genuinely useful.

Write 4 sections. Each needs a heading and two paragraphs of 60 to 90 words.
${sectionText}

DEPTH — this is what separates a useful page from filler
- Every paragraph must contain at least one CONCRETE noun: a component, a
  material, a symptom, a tool, a timeframe, a measurement. A paragraph that
  could apply to any trade has failed.
- Explain WHY, not just what. "Sediment collects in the tank, so the burner
  runs longer to heat the same water" beats "we service water heaters".
- Where a number helps, use a realistic range rather than a precise figure.

ACCURACY
- Do not state prices, guaranteed response times, licence numbers, or years
  in business.
- Do not invent awards, certifications, or named accreditations.
- Do not claim work is guaranteed for a specific number of years.

WRITING
- Do not open any paragraph with "When it comes to", "Whether you need",
  "At ${businessName}, we", "Look no further", or "In today's world".
- Do not describe the company as trusted, reliable, professional, dedicated,
  committed, or top-notch. Show it instead.
- Vary sentence length. Avoid three consecutive sentences of similar shape.
- No markdown, no labels like (H2), no bullet lists.
- Use the anchor phrases in lowercase exactly as given.

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
    "heading": "Heading text",
    "paragraphs": ["Paragraph 1", "Paragraph 2"]
  },
  "section4": {
    "heading": "Heading text",
    "paragraphs": ["Paragraph 1", "Paragraph 2"]
  }
}
`.trim();
}

module.exports = { createPagesPrompt, TRADE_VOCAB, categoryMap };