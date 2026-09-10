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

const {
  businessShape,
  categoryFor,
  entityFor,
} = require('./businessShape');

// categoryMap used to live here. It was one of four copies that had drifted
// apart, and this one hardwired 'law firm' -> 'lemon law firm', so a family-law
// or immigration practice was handed repair orders and mileage records. See
// utils/businessShape.js.

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

  // ---- The types that used to fall through to DEFAULT_VOCAB -------------
  //
  // Painter, Appliance Repair, Coding and Web Design were all in the dropdown
  // already and none of them had an entry, so their service pages were written
  // out of 'materials, components, fittings' and 'wear, damage, faults'. That
  // is the abstract register this whole file exists to avoid.
  'painting': {
    parts: 'primer, caulk, drywall compound, trim, sheen levels, masking, sprayers, rollers',
    symptoms: 'peeling, chalking, hairline cracks, water staining, mildew, uneven sheen, nail pops',
    work: 'washing and scuff sanding, filling and caulking, spot priming, cutting in, two-coat application',
  },
  'appliance repair': {
    parts: 'control boards, thermostats, door seals, drain pumps, igniters, compressors, belts, heating elements',
    symptoms: 'not draining, not heating, tripping mid-cycle, leaking, loud spinning, error codes, ice build-up',
    work: 'reading error codes, continuity testing, seal replacement, clearing drain lines, calibration',
  },

  'dentistry': {
    parts: 'enamel, gum tissue, crowns, fillings, root canals, implants, digital x-rays, retainers, aligners',
    symptoms: 'sensitivity to hot or cold, bleeding gums, a cracked or chipped tooth, jaw pain, persistent bad breath, a loose filling',
    work: 'examination and x-rays, cleaning and scaling, decay removal, impressions, fitting and adjustment, review appointments',
  },
  'family medicine': {
    parts: 'blood pressure readings, blood panels, imaging referrals, vaccination records, prescriptions, care plans',
    symptoms: 'persistent cough, fatigue, unexplained pain, a fever that will not settle, changes in appetite or weight',
    work: 'history taking, examination, ordering tests, explaining results, adjusting treatment, referral where needed',
  },
  'chiropractic care': {
    parts: 'the spine, discs, joints, posture, gait, range of motion, adjustment tables, imaging',
    symptoms: 'lower back pain, neck stiffness, headaches, pain radiating down a leg or arm, reduced range of motion',
    work: 'posture and gait assessment, range of motion testing, spinal adjustment, soft tissue work, exercises between visits',
  },
  'physical therapy': {
    parts: 'range of motion, strength testing, gait analysis, resistance bands, treatment plans, home exercise programmes',
    symptoms: 'stiffness after injury, weakness on one side, pain on movement, difficulty with stairs, loss of balance',
    work: 'initial assessment, goal setting, manual therapy, supervised exercise, progress review, discharge planning',
  },

  'health care': {
    parts: 'assessments, referrals, treatment plans, follow-up appointments, records, aftercare instructions',
    symptoms: 'discomfort that keeps returning, something that has changed recently, a problem that interferes with daily life, a result worth checking',
    work: 'an initial assessment, explaining the options, agreeing a plan, carrying it out, reviewing how it went',
  },
  'legal services': {
    parts: 'documents, deadlines, filings, correspondence, signed agreements, official notices',
    symptoms: 'a letter with a deadline on it, paperwork nobody explained, a process that has stalled, a requirement that is unclear',
    work: 'reviewing what exists, explaining what applies, preparing documents, filing where required, keeping the client informed',
  },
  'law firm': {
    parts: 'filings, deadlines, disclosure, correspondence, evidence, agreements, court dates, retainer terms',
    symptoms: 'a letter with a deadline on it, a dispute that will not resolve, a signed agreement nobody is following, an insurer refusing to engage',
    work: 'an initial consultation, reviewing documents, explaining the options, correspondence, negotiation, filing where required',
  },
  'accounting': {
    parts: 'ledgers, receipts, payroll records, filing deadlines, deductions, depreciation schedules, quarterly estimates',
    symptoms: 'books that no longer reconcile, a missed filing deadline, a notice from the revenue authority, cash flow that is hard to read',
    work: 'reconciling accounts, categorising expenses, preparing returns, reviewing prior filings, planning for the next quarter',
  },
  'insurance': {
    parts: 'policy limits, deductibles, riders, exclusions, premiums, coverage periods, claim forms',
    symptoms: 'cover that no longer matches the risk, a premium that jumped at renewal, a claim that was refused, gaps between two policies',
    work: 'reviewing existing cover, comparing quotes, explaining exclusions, adjusting limits, supporting a claim',
  },
  'real estate': {
    parts: 'listings, comparables, disclosures, inspections, appraisals, closing costs, contingencies',
    symptoms: 'a listing sitting unsold, an offer below expectations, an inspection turning up problems, a financing deadline approaching',
    work: 'pricing from comparables, preparing a property, marketing, handling offers, coordinating inspections and closing',
  },

  'web design': {
    parts: 'page templates, navigation, forms, image sizes, hosting, domains, analytics, content management',
    symptoms: 'a site that loads slowly on a phone, forms nobody fills in, a design that no longer matches the business, no way to edit the copy',
    work: 'discovery, wireframes, design, build, content migration, testing on real devices, launch and handover',
  },
  'software development': {
    parts: 'requirements, data models, APIs, test suites, deployment pipelines, version control, documentation',
    symptoms: 'a manual process that eats hours a week, two systems that do not talk to each other, a spreadsheet doing a database\'s job',
    work: 'scoping, breaking work into milestones, building in increments, testing, deploying, handing over documentation',
  },
  'marketing': {
    parts: 'audiences, channels, messaging, landing pages, tracking, budgets, creative assets',
    symptoms: 'spend with nothing to show for it, enquiries that never convert, a message that does not land, no way to tell which channel worked',
    work: 'auditing what is running, defining the audience, testing messaging, setting up tracking, reporting on what changed',
  },
  'seo': {
    parts: 'site structure, page titles, internal links, page speed, schema markup, backlinks, search console',
    symptoms: 'pages that never get indexed, rankings that slid after a redesign, traffic that does not convert, duplicate pages competing',
    work: 'a technical audit, fixing crawl and indexing issues, restructuring internal links, improving page content, tracking movement',
  },
};

const DEFAULT_VOCAB = {
  parts: 'materials, components, fittings, equipment',
  symptoms: 'wear, damage, faults, performance problems',
  work: 'assessment, preparation, repair or replacement, testing',
};

/* -------------------------------------------------------------------------
 * SECTION TOPICS
 *
 * WHY THIS IS A POOL AND NOT A FIXED LIST
 *
 * Every service page used to get the same four briefs in the same order:
 * the problem, what the work involves, what changes the job, choosing who
 * does it. Ten pages, four topics, one order. Only the trade nouns differed.
 *
 * That is exactly the failure createLocationPagesPrompt already fixed for
 * location pages, and its comment says why: "pages stay structurally
 * identical even when the place names differ — same four topics in the same
 * order, which still reads as templated". Two related services — Water Heater
 * Repair and Water Heater Installation — were being handed near-identical
 * prompts and came back near-identical, which is how Google ends up choosing
 * its own canonical for one of them.
 *
 * So: a pool of topics, rotated by the service's position, exactly like
 * LOCATION_ANGLES. Slot 1 draws from OPENERS, because it carries the
 * SEO-first heading and not every topic can open a page. Slots 2-4 are a
 * sliding window over BODY.
 *
 * WHY THE BRIEFS ARE PARAMETERISED RATHER THAN WRITTEN FIVE TIMES
 *
 * Ten topics multiplied by five shapes is fifty hand-written briefs that all
 * have to stay in step. SHAPE_WORDS supplies the four nouns that actually
 * differ — who the reader is, what the engagement is called, what the
 * provider is called, and what the written thing is — so each topic is
 * written once and reads correctly for a plumber, a dentist and an attorney.
 *
 * These are instructions to the model, not output copy, so the abstraction
 * costs nothing: the concrete language still comes from TRADE_VOCAB.
 * ---------------------------------------------------------------------- */

const SHAPE_WORDS = {
  home: {
    who: 'homeowner', engagement: 'job', provider: 'contractor',
    doc: 'written estimate', visit: 'visit',
  },
  medical: {
    who: 'patient', engagement: 'appointment', provider: 'practitioner',
    doc: 'treatment plan', visit: 'first appointment',
  },
  professional: {
    who: 'client', engagement: 'matter', provider: 'adviser',
    doc: 'written fee agreement', visit: 'initial consultation',
  },
  project: {
    who: 'client', engagement: 'project', provider: 'studio',
    doc: 'written proposal', visit: 'discovery call',
  },
  generic: {
    who: 'customer', engagement: 'job', provider: 'provider',
    doc: 'written quote', visit: 'first conversation',
  },
};

function wordsFor(shape) {
  return SHAPE_WORDS[shape] || SHAPE_WORDS.generic;
}

/**
 * Topics that can LEAD a page.
 *
 * Slot 1 carries the SEO-first heading built around the keyword, so it has to
 * be something a page can plausibly open on. "What happens afterwards" cannot.
 */
const OPENERS = [
  {
    id: 'symptoms',
    title: 'The problem, and when to act',
    brief: ({ keyword, businessName, vocab, w }) =>
      `Open on the situation that brings someone to search for "${keyword}".
    What are they noticing? Name at least two real signs — draw from:
    ${vocab.symptoms}. Say plainly when it can wait and when it cannot.
    Mention ${businessName} once in the first paragraph.`,
  },
  {
    id: 'misconception',
    title: 'What people get wrong about this',
    brief: ({ keyword, businessName, vocab, w }) =>
      `Open on the thing most people believe about ${keyword} that is not
    quite right — the assumption that costs them time or money. Correct it
    with something concrete, drawing on: ${vocab.symptoms}. Then say what is
    actually true. Mention ${businessName} once in the first paragraph. Do not
    be smug about it; the reader had a sensible reason for thinking it.`,
  },
  {
    id: 'options',
    title: 'The choice in front of you',
    brief: ({ keyword, businessName, vocab, w }) =>
      `Open on the decision someone faces when they need ${keyword}: the
    realistic options, and what separates them. Be specific about the
    trade-off — what each option costs in time or disruption, and what it
    buys. Name at least one concrete detail from: ${vocab.parts}. Mention
    ${businessName} once in the first paragraph. Do not tell the reader which
    to choose; give them what they need to choose.`,
  },
  {
    id: 'audience',
    title: 'Who this is actually for',
    brief: ({ keyword, businessName, vocab, w }) =>
      `Open on the kinds of situation where ${keyword} is the right answer —
    and, just as usefully, where it is not and something simpler would do.
    Ground it in specifics from: ${vocab.symptoms}. Mention ${businessName}
    once in the first paragraph. A reader who leaves knowing this is not what
    they need has been served well, and will come back when it is.`,
  },
  {
    id: 'timing',
    title: 'Dealing with it now versus later',
    brief: ({ keyword, businessName, vocab, w }) =>
      `Open on what actually changes if ${keyword} waits — what gets worse,
    what stays the same, and what stops being an option. Name at least two
    concrete consequences drawn from: ${vocab.symptoms}. Mention
    ${businessName} once in the first paragraph. Be straight about it rather
    than alarming: some things genuinely can wait, and saying so is what makes
    the rest credible.`,
  },
];

/**
 * Topics for slots 2-4.
 *
 * `skipShapes` drops a topic where it makes no sense — the cost topic is not
 * offered to a medical or legal page, for the same reason those shapes get no
 * pricing table.
 */
const BODY = [
  {
    id: 'process',
    title: 'What the work involves',
    brief: ({ vocab, w }) =>
      `Walk through what actually happens, in order. Name the parts and
    equipment involved — draw from: ${vocab.parts} — and the steps taken:
    ${vocab.work}. Written so someone who has never had this done knows what
    to expect from the ${w.visit} onwards.`,
  },
  {
    id: 'variables',
    title: 'What changes the job',
    brief: ({ keyword, w }) =>
      `Explain what makes one ${keyword} ${w.engagement} different from
    another: what is already there, what has already been tried, what turns up
    once the work is properly looked at, and the timescale. Be concrete about
    the trade-offs rather than calling everything bespoke.`,
  },
  {
    // NOT skipped for medical and professional.
    //
    // The first version dropped this topic for those two, which left them six
    // body topics instead of seven — and a stride of 3 into 6 has a period of
    // 2, so a dentist's ten service pages cycled through just two topic sets.
    // The rotation only works when every shape has the same coprime count.
    //
    // Dropping it was also the wrong call on its own terms. Suppressing the
    // PRICE TABLE for those shapes is about publishing figures; explaining how
    // fees or cover generally work is what those visitors most want to know,
    // and the ACCURACY rules below already forbid naming a number. The
    // location angles reached the same conclusion — "how the work is scoped
    // and charged" for professional, "cover, billing and getting started" for
    // medical.
    id: 'cost',
    title: 'What it costs, and what moves it',
    brief: ({ keyword, shape, w }) => {
      if (shape === 'medical') {
        return `Explain in GENERAL terms how paying for ${keyword} usually
    works: what a ${w.doc} sets out, how cover is typically handled, what is
    normally agreed before treatment begins, and what to ask about before
    agreeing to anything. Do NOT state any price, fee, reimbursement amount or
    range — not even an approximate one.`;
      }

      if (shape === 'professional') {
        return `Explain in GENERAL terms how this kind of ${w.engagement} is
    usually charged for — the shapes an arrangement can take, what a ${w.doc}
    should set out, which costs sit outside it, and what to ask about at the
    ${w.visit}. Do NOT state any rate, fee, percentage or range, and do not
    suggest what anyone might recover.`;
      }

      return `Explain what drives the cost of ${keyword} up or down — scale,
    access, materials or components, and how much turns out to be needed once
    work starts. Give realistic RANGES and ratios rather than exact figures,
    and say what a ${w.doc} should itemise so the reader can compare two of
    them.`;
    },
  },
  {
    id: 'timeline',
    title: 'How long it takes',
    brief: ({ keyword, w }) =>
      `How long ${keyword} usually takes, and what the ${w.who} experiences
    while it is happening. Be honest about what causes delay. Give a realistic
    range rather than a single number, and say what is happening during the
    parts that look like nothing is happening.`,
  },
  {
    id: 'choosing',
    title: 'Choosing who does the work',
    brief: ({ keyword, location, businessName, w }) =>
      `What a ${w.who} in ${location} should check before hiring anyone for
    ${keyword} — what to ask, what a ${w.doc} should cover, what a good
    ${w.provider} explains before starting. Write it as advice the reader can
    use, NOT as a list of reasons to pick ${businessName}. Earn the trust
    rather than asking for it.`,
  },
  {
    id: 'preparation',
    title: 'What to do before the ' + 'work starts',
    brief: ({ keyword, w }) =>
      `What the reader can usefully do before the ${w.visit} — what to gather,
    what to note down, what to clear or arrange, and what NOT to do because it
    makes things harder or more expensive. Practical and specific; a list of
    things they can actually action today.`,
  },
  {
    id: 'aftercare',
    title: 'Afterwards, and what to watch for',
    brief: ({ keyword, vocab, w }) =>
      `What happens once ${keyword} is finished: what the ${w.who} should
    notice in the following days and weeks, what is normal, and what means
    getting back in touch. Draw on ${vocab.symptoms} for the signs that
    matter. Say what routine attention keeps the result holding.`,
  },
];

/**
 * Which topics this page gets, and in what order.
 *
 * The opener rotates over 3 and the body window slides by 3 over 7, so the
 * combination repeats only every 21 pages — no site has that many services,
 * which means every service page on a site gets a different shape.
 *
 * A stride of 3 rather than 1 matters: with a stride of 1, pages 1 and 2
 * would share two of their three body topics, and adjacent pages are exactly
 * where similar services tend to sit in the list.
 */
function topicsFor(shape, pageIndex = 0) {
  const i = Math.max(0, Number(pageIndex) || 0);

  const opener = OPENERS[i % OPENERS.length];

  const body = BODY.filter(t => !(t.skipShapes || []).includes(shape));
  const start = (i * 3) % body.length;
  const chosen = [0, 1, 2].map(k => body[(start + k) % body.length]);

  return [opener, ...chosen];
}

/**
 * Vary the heading style too, so every page's H2s are not the same formula.
 * Borrowed wholesale from createLocationPagesPrompt, which needed it for the
 * same reason.
 */
const HEADING_STYLES = [
  'a direct heading that names the thing plainly',
  'a heading phrased as the question the reader is actually asking',
  'a heading that leads with the outcome rather than the activity',
  'a heading that names the specific problem being solved',
];

/**
 * The four sections for one page: which topics, in which order, worded for
 * this business.
 */
function sectionBriefs({ keyword, businessName, location, vocab, keywords, shape, pageIndex = 0 }) {
  const w = wordsFor(shape);
  const topics = topicsFor(shape, pageIndex);

  // The anchor phrases go in sections 2 and 3 as they always have. Slot 1
  // carries the SEO heading and slot 4 closes; neither is a natural place to
  // force a phrase.
  const anchors = { 1: keywords[1], 2: keywords[2] };

  return topics.map((topic, slot) => ({
    n: slot + 1,
    title: topic.title,
    seo: slot === 0,
    brief: [
      topic.brief({ keyword, businessName, location, vocab, w, shape }),
      anchors[slot] ? `Include this exact lowercase phrase: ${anchors[slot]}` : '',
    ].filter(Boolean).join('\n    '),
  }));
}

/**
 * What a service page may not assert, by shape.
 *
 * The trades version was applied to everything. It says nothing about
 * promising a medical outcome or predicting a legal result, because it was
 * never written with either in mind.
 */
const ACCURACY_BY_SHAPE = {
  home: `- Do not state prices, guaranteed response times, licence numbers, or years
  in business.
- Do not invent awards, certifications, or named accreditations.
- Do not claim work is guaranteed for a specific number of years.`,

  medical: `- Do not promise a result, a recovery time, or a cure, and do not describe any
  treatment as painless, permanent, risk-free or guaranteed.
- Do not state prices, insurance reimbursement amounts, or what a visit costs.
- Do not invent credentials, board certifications, specialty designations,
  ratings or professional memberships.
- Do not give instructions someone could follow instead of being seen. Where
  something needs assessing in person, say so.`,

  professional: `- Do not predict an outcome, a settlement figure, a timescale for resolution,
  or a success rate, and do not describe any result as likely.
- Do not describe past results, and do not quote or invent a client testimonial.
- Do not state fees, hourly rates or contingency percentages.
- Do not invent credentials, bar admissions, specialisations or memberships.
- Write generally about how this kind of matter works. This page is not advice
  on anyone's particular situation, and it should not read as though it is.`,

  project: `- Do not state prices, guarantee a delivery date, or promise a ranking,
  traffic figure or revenue result.
- Do not invent awards, certifications, partner status, or named clients.`,

  generic: `- Do not state prices, guaranteed response times, licence numbers, or years
  in business.
- Do not invent awards, certifications, accreditations or memberships.
- Do not guarantee a result of any kind.`,
};

function createPagesPrompt({ globalValues, page, keywords, pageIndex = 0 }) {
  const { businessName, location, businessType } = globalValues;

  const category = categoryFor(businessType);
  const entityPhrase = entityFor(businessType);
  const shape = businessShape(businessType);
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
    shape,
    pageIndex,
  });

  // Rotated independently of the topics, so two pages that happen to share a
  // topic still do not share a heading shape.
  const headingStyle = HEADING_STYLES[pageIndex % HEADING_STYLES.length];

  const sectionText = briefs.map(s => `
${s.n}. ${s.title}
    ${s.brief}${s.seo ? `
    This section leads the page, so write an SEO-first heading built around
    "${page.keyword}". Also write a subheading.` : `
    Human-first heading, clearly different in shape from the previous ones.`}`).join('\n');

  return `
You are writing a service page for a local ${entityPhrase} named "${businessName}", serving ${location}.

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
${ACCURACY_BY_SHAPE[shape] || ACCURACY_BY_SHAPE.generic}

WRITING
- HEADINGS on this page: ${headingStyle}. Hold that style across all four so
  the page reads as one voice, and do not reuse the wording of the section
  titles above — those describe the job of each section, they are not headings.
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

module.exports = {
  createPagesPrompt,
  TRADE_VOCAB,
  DEFAULT_VOCAB,
  ACCURACY_BY_SHAPE,
  SHAPE_WORDS,
  OPENERS,
  BODY,
  HEADING_STYLES,
  topicsFor,
  sectionBriefs,
};