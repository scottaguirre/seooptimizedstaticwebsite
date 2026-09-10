// utils/businessShape.js
//
// ONE registry of business types, and the thing that used to be four.
//
// createPagesPrompt, createLocationPagesPrompt, createAboutUsPrompt and
// buildAboutUsPage each carried their own categoryMap. They had already
// drifted: createLocationPagesPrompt was missing 'french drain installation',
// and buildAboutUsPage keyed its copy on SLUGS while createAboutUsPrompt keyed
// the same data on SPACES — so buildAboutUsPage's slugify() lookup silently
// missed 'swimming pool contractor' and 'water damage restoration' and fell
// through to the raw type. Nothing failed loudly. The pages just came out
// slightly wrong.
//
//
// WHY A "SHAPE" AND NOT JUST A CATEGORY
//
// The generator makes claims. Trust points, a licensed badge, a table of
// prices. For a plumber those are marketing. For a dentist or an attorney they
// are a licensing-board matter, and the board writes to the customer, not to
// us. "Workmanship warranty" on a dental practice, "5-star rated by local
// customers" on a law firm, a published fee schedule for a physician — each of
// those is a real problem and each was being generated unconditionally.
//
// The old businessShape() in fixedFaqQuestions.js had the right idea and one
// fatal default: an unrecognised type fell through to 'home'. That is exactly
// how "dentist" — which was not in the dropdown at all, and could only arrive
// as WordPress free text — ended up with a workmanship warranty and "How do I
// book a job with Smile Dental?".
//
// So there are five shapes and the fallback is GENERIC, which claims nothing,
// gets no badges and gets no pricing table. Wrong-but-bland beats
// wrong-and-regulated.
//
//
// WHAT IS AND IS NOT ASSERTED
//
// createAboutUsPrompt used to tell the model: "Every business on this platform
// is genuinely licensed, insured, bonded and accredited, and holds a 5-star
// rating, so those claims are accurate." That is a factual claim about a
// business nobody here has checked. Claim-bearing trust points are now opt-in:
// the owner ticks them in the wizard and only the ticked ones reach the model.
//
// Home services defaults every historical claim to TICKED, so an existing
// customer's About page comes out exactly as it does today. Every other shape
// defaults to nothing ticked.

/* -------------------------------------------------------------------------
 * Normalisation
 *
 * Callers disagree about spelling: buildAboutUsPage passes slugify() output
 * ('concrete-contractor'), everyone else passes the raw dropdown label
 * ('Concrete Contractor'). Flattening every separator to a single space makes
 * those the same string, which is the whole reason the two maps drifted.
 * ---------------------------------------------------------------------- */

const { slugify } = require('./slugify');

function normaliseType(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const SHAPES = ['home', 'medical', 'professional', 'project', 'generic'];

/* -------------------------------------------------------------------------
 * The registry
 *
 * `label`    what the wizard dropdown shows. Order here IS dropdown order.
 * `shape`    which rule set applies.
 * `category` the lowercase noun phrase prompts write into a sentence
 *            ("a local ${category} company"). Also the TRADE_VOCAB key.
 * `title`    the title-case job title the About Us page uses ("Plumber").
 * `aliases`  other spellings that resolve here, mostly for the WordPress
 *            free-text business_type field, which accepts anything.
 * `entity`   the full noun phrase for "a local ___ named Acme", where the
 *            category alone is not one ("dentistry" is not).
 *
 * `listed: false` keeps a type OUT of the wizard dropdown while still letting
 *            it resolve. Every dropdown type needs a photo set under
 *            src/predefined-images/<imageFolder>, and a type offered without
 *            one produces a site with no images at all — copyPageImage warns
 *            and skips rather than throwing, so the build succeeds and the
 *            pages come out blank. Unlisted types exist so that free text
 *            arriving from WordPress still resolves to the right shape.
 *
 * `imageFolder` overrides the default photo folder, which is slugify(label).
 *
 * `servicesLabel` is the adjective in "___ Services We Offer". Defaults to the
 *            label, which is right for Plumbing, Roofing and Lemon Law and
 *            wrong for Dentist ("Dentist Services We Offer") and Electrician.
 * ---------------------------------------------------------------------- */

const BUSINESS_TYPES = [
  // ---- Home services -----------------------------------------------------
  {
    label: 'Plumbing', shape: 'home',
    category: 'plumbing', title: 'Plumber',
    aliases: ['plumber', 'plumbers'],
  },
  {
    label: 'Fencing', shape: 'home',
    category: 'fencing', title: 'Fence Company',
    aliases: ['fence', 'fence company', 'fence contractor'],
  },
  {
    servicesLabel: 'Painting',
    label: 'Painter', shape: 'home',
    category: 'painting', title: 'Painter',
    aliases: ['painting', 'house painter', 'painting contractor'],
  },
  {
    label: 'Paving', shape: 'home',
    category: 'paving', title: 'Paving Contractor',
    aliases: ['asphalt', 'asphalt paving', 'paving contractor'],
  },
  {
    servicesLabel: 'Swimming Pool',
    label: 'Swimming Pool Contractor', shape: 'home',
    category: 'swimming pool contractor', title: 'Swimming Pool Contractor',
    aliases: ['pool contractor', 'pool service', 'swimming pool'],
  },
  {
    label: 'Junk Removal', shape: 'home',
    category: 'junk removal', title: 'Junk Removal',
    aliases: ['hauling', 'rubbish removal'],
  },
  {
    label: 'Appliance Repair', shape: 'home',
    category: 'appliance repair', title: 'Appliance Repair Technician',
    aliases: ['appliance service'],
  },
  {
    label: 'Water Damage Restoration', shape: 'home',
    category: 'water damage restoration', title: 'Water Damage Restoration',
    aliases: ['water damage', 'flood restoration', 'restoration'],
  },
  {
    label: 'Tree Removal', shape: 'home',
    category: 'tree removal', title: 'Tree Removal',
    aliases: ['tree service', 'arborist', 'tree surgeon'],
  },
  {
    servicesLabel: 'Electrical',
    label: 'Electrician', shape: 'home',
    category: 'electrical services', title: 'Electrician',
    aliases: ['electrical', 'electrical services', 'electricians'],
  },
  {
    servicesLabel: 'Concrete',
    label: 'Concrete Contractor', shape: 'home',
    category: 'concrete services', title: 'Concrete Contractor',
    aliases: ['concrete', 'concrete services'],
  },
  {
    servicesLabel: 'French Drain',
    label: 'French Drain Installation', shape: 'home',
    category: 'french drain installation', title: 'French Drain Installer',
    aliases: ['french drain', 'french drains', 'drainage'],
  },
  {
    label: 'Roofing', shape: 'home',
    category: 'roofing', title: 'Roofing Contractor',
    aliases: ['roofer', 'roofers', 'roof repair'],
  },
  {
    label: 'HVAC', shape: 'home',
    category: 'hvac', title: 'HVAC Technician',
    aliases: ['heating and cooling', 'heating and air', 'hvac repair'],
  },
  {
    label: 'Air Conditioning', shape: 'home',
    category: 'air conditioning', title: 'Air Conditioning Technician',
    aliases: ['ac repair', 'air con', 'ac'],
  },
  {
    label: 'Landscaping', shape: 'home',
    category: 'landscaping', title: 'Landscaper',
    aliases: ['landscaper', 'lawn care', 'lawn'],
  },

  // ---- Medical -----------------------------------------------------------
  //
  // None of these existed anywhere before. A "dentist" typed into the
  // WordPress free-text field resolved to the home shape and was sold a
  // workmanship warranty.
  {
    servicesLabel: 'Dental',
    label: 'Dentist', shape: 'medical',
    category: 'dentistry', title: 'Dentist', entity: 'dental practice',
    aliases: ['dental', 'dental practice', 'dental office', 'dentistry',
              'orthodontist', 'orthodontics', 'periodontist', 'endodontist'],
  },
  {
    servicesLabel: 'Medical',
    label: 'Doctor', shape: 'medical',
    category: 'family medicine', title: 'Doctor', entity: 'family medicine practice',
    aliases: ['physician', 'medical practice', 'family doctor', 'gp',
              'family medicine', 'primary care', 'clinic', 'pediatrician',
              'dermatologist', 'urgent care'],
  },
  {
    servicesLabel: 'Chiropractic',
    label: 'Chiropractor', shape: 'medical',
    category: 'chiropractic care', title: 'Chiropractor', entity: 'chiropractic clinic',
    aliases: ['chiropractic', 'chiro', 'chiropractic care'],
  },
  {
    label: 'Physical Therapy', shape: 'medical',
    category: 'physical therapy', title: 'Physical Therapist', entity: 'physical therapy clinic',
    aliases: ['physiotherapy', 'physiotherapist', 'physical therapist',
              'physio', 'rehab', 'sports therapy'],
  },

  {
    // UNLISTED. Not a dropdown option — a catch-all so the health and wellness
    // types people type into the WordPress free-text field resolve to the
    // medical shape instead of falling through to 'generic'.
    //
    // Before this, "Med Spa", "Optometrist" and "Counseling" all resolved to
    // generic. The case study no longer reaches generic either, so this is the
    // second of two locks rather than the only one — but resolving them
    // correctly also gets them the right trust points, FAQ wording, location
    // angles and accuracy rules, which the lock alone does not.
    listed: false,
    servicesLabel: 'Health',
    label: 'Health Practice', shape: 'medical',
    category: 'health care', title: 'Practitioner', entity: 'health practice',
    aliases: [
      'med spa', 'medical spa', 'wellness', 'wellness center', 'wellness centre',
      'acupuncture', 'acupuncturist', 'veterinarian', 'veterinary', 'vet clinic',
      'optometrist', 'optometry', 'ophthalmologist', 'podiatrist', 'podiatry',
      'nutritionist', 'dietitian', 'massage therapy', 'massage therapist',
      'counseling', 'counselling', 'counselor', 'counsellor', 'therapist',
      'psychologist', 'psychiatrist', 'home health care', 'home health',
      'audiologist', 'hearing aids', 'speech therapy', 'occupational therapy',
      'midwife', 'fertility clinic', 'weight loss clinic', 'iv therapy',
      'plastic surgeon', 'cosmetic surgery', 'hair transplant', 'pharmacy',
      'medical clinic', 'health clinic', 'walk in clinic',
    ],
  },

  // ---- Professional services --------------------------------------------
  //
  // 'Law Firm' used to map to 'lemon law firm' — hardwired, no way round it.
  // A family-law or immigration practice was handed lemon-law vocabulary:
  // repair orders, warranty terms, manufacturer notices, mileage records.
  // Lemon law is now its own dropdown entry, so it is a choice rather than an
  // assumption, and 'Law Firm' means what it says.
  {
    // UNLISTED until general law firm photographs exist.
    //
    // Before the split below, "Law Firm" MEANT lemon law — the category was
    // hardwired to it — so src/predefined-images/law-firm/ and
    // utils/altText/law-firm.js are both full of lemon-car imagery: "a man
    // using his phone to take a picture under the hood of his lemon car".
    // Now that Law Firm means a general practice, offering it in the dropdown
    // would hand a family-law or immigration firm those photographs. It still
    // resolves for free text, so a WordPress site typed as "law office" gets
    // the right shape and the right copy.
    listed: false,
    servicesLabel: 'Legal',
    label: 'Law Firm', shape: 'professional',
    category: 'law firm', title: 'Attorney', entity: 'law firm',
    // 'legal services' is deliberately NOT here: it is the category of the
    // Legal Services catch-all below, and whichever entry registers a key
    // first wins the exact match.
    aliases: ['lawyer', 'attorney', 'law office', 'solicitor'],
  },
  {
    label: 'Lemon Law', shape: 'professional', imageFolder: 'law-firm',
    category: 'lemon law firm', title: 'Lemon Law Attorney', entity: 'lemon law firm',
    aliases: ['lemon law firm', 'lemon law attorney', 'lemon law lawyer'],
  },
  {
    // UNLISTED, same reasoning as Health Practice above: legal-adjacent types
    // typed as free text used to resolve to 'generic', and for anything legal
    // a case study is a past-results claim.
    listed: false,
    servicesLabel: 'Legal',
    label: 'Legal Services', shape: 'professional',
    category: 'legal services', title: 'Legal Professional', entity: 'legal practice',
    aliases: [
      'paralegal', 'bail bonds', 'bail bondsman', 'notary', 'notary public',
      'immigration services', 'immigration consultant', 'process server',
      'mediator', 'mediation', 'arbitration', 'legal aid', 'title company',
      'estate planning', 'tax attorney', 'patent agent',
    ],
  },
  {
    listed: false,
    label: 'Accounting', shape: 'professional',
    category: 'accounting', title: 'Accountant', entity: 'accounting practice',
    aliases: ['accountant', 'cpa', 'bookkeeping', 'tax preparation'],
  },
  {
    listed: false,
    servicesLabel: 'Insurance',
    label: 'Insurance Agency', shape: 'professional',
    category: 'insurance', title: 'Insurance Agent', entity: 'insurance agency',
    aliases: ['insurance', 'insurance agent', 'insurance broker'],
  },
  {
    listed: false,
    label: 'Real Estate', shape: 'professional',
    category: 'real estate', title: 'Real Estate Agent', entity: 'real estate agency',
    aliases: ['realtor', 'real estate agent', 'estate agent', 'realty'],
  },

  // ---- Project based -----------------------------------------------------
  {
    label: 'Web Design', shape: 'project',
    category: 'web design', title: 'Web Designer', entity: 'web design studio',
    aliases: ['web development', 'website design', 'web developer',
              'website designer'],
  },
  {
    servicesLabel: 'Software Development',
    label: 'Coding', shape: 'project',
    category: 'software development', title: 'Software Developer', entity: 'software development studio',
    aliases: ['software development', 'software developer', 'app development',
              'programming'],
  },
  {
    listed: false,
    servicesLabel: 'Marketing',
    label: 'Marketing Agency', shape: 'project',
    category: 'marketing', title: 'Marketing Consultant', entity: 'marketing agency',
    aliases: ['marketing', 'digital marketing', 'advertising agency'],
  },
  {
    listed: false,
    servicesLabel: 'SEO',
    label: 'SEO Agency', shape: 'project',
    category: 'seo', title: 'SEO Consultant', entity: 'SEO agency',
    aliases: ['seo', 'search engine optimization', 'seo services'],
  },
];

/* -------------------------------------------------------------------------
 * Lookup
 *
 * Exact normalised match first, then whole-word containment so free text like
 * "Pediatric Dentist of Cedar Park" still resolves. Longest alias first,
 * because "law" would otherwise win over "lemon law firm".
 *
 * Whole-word, not substring: \blaw\b does not match "lawn care", which a bare
 * indexOf() would have quietly filed as a law firm.
 * ---------------------------------------------------------------------- */

const EXACT = new Map();
for (const entry of BUSINESS_TYPES) {
  for (const key of [entry.label, entry.category, ...(entry.aliases || [])]) {
    const k = normaliseType(key);
    if (k && !EXACT.has(k)) EXACT.set(k, entry);
  }
}

const CONTAINED = [...EXACT.entries()]
  .sort((a, b) => b[0].length - a[0].length)
  .map(([key, entry]) => ({
    entry,
    re: new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
  }));

/** The types the wizard dropdown offers, in order. */
const DROPDOWN_TYPES = BUSINESS_TYPES.filter(t => t.listed !== false);

/** @returns {object|null} the registry entry, or null for an unknown type. */
function findType(businessType) {
  const key = normaliseType(businessType);
  if (!key) return null;

  const exact = EXACT.get(key);
  if (exact) return exact;

  for (const { entry, re } of CONTAINED) {
    if (re.test(key)) return entry;
  }

  return null;
}

/**
 * Which rule set applies.
 *
 * Unknown types get 'generic' — NOT 'home', which is what the old copy of this
 * function in fixedFaqQuestions.js did and is the single change that stops a
 * dentist being offered a workmanship warranty.
 */
function businessShape(businessType) {
  const entry = findType(businessType);
  return entry ? entry.shape : 'generic';
}

/** The lowercase noun phrase prompts drop into a sentence. */
function categoryFor(businessType) {
  const entry = findType(businessType);
  return entry ? entry.category : String(businessType || 'services').trim().toLowerCase();
}

/**
 * The folder under src/predefined-images/ this type's photographs come from.
 *
 * Defaults to the slug of the label, which is what copyAllPredefinedImages
 * already computed for itself. Lemon Law overrides it to reuse the law firm
 * photographs rather than needing a duplicate set.
 */
function imageFolderFor(businessType) {
  const entry = findType(businessType);
  if (entry) return entry.imageFolder || slugify(entry.label);
  return slugify(String(businessType || ''));
}

/**
 * The heading for the services section: "Plumbing Services We Offer",
 * "Lemon Law Services We Offer", "Dental Services We Offer".
 *
 * Not the same word as `title` — that names the PERSON ("Plumber", "Dentist"),
 * and "Dentist Services We Offer" is not a sentence.
 */
function servicesLabelFor(businessType) {
  const entry = findType(businessType);
  return entry
    ? (entry.servicesLabel || entry.label)
    : String(businessType || '').trim();
}

function servicesHeading(businessType) {
  const label = servicesLabelFor(businessType);
  return label ? `${label} Services We Offer` : 'Services We Offer';
}

/** The title-case job title the About Us page prints. */
function titleFor(businessType) {
  const entry = findType(businessType);
  if (entry) return entry.title;

  // Title-case whatever the user typed, so an unknown type still reads as a
  // heading rather than as raw form input.
  return String(businessType || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase()) || 'Local Business';
}

/**
 * The noun phrase that goes in "a local ___ named Acme".
 *
 * The old rule was `category === 'lemon law firm' ? '' : 'company'`, which
 * produced "a local law firm company" for every law firm that was not a lemon
 * law firm, and would now produce "a local dentistry" — grammatical for
 * neither. Types whose category is not itself a usable noun phrase carry an
 * explicit `entity`.
 */
function entityFor(businessType) {
  const entry = findType(businessType);
  if (entry && entry.entity) return entry.entity;

  const category = categoryFor(businessType);
  const suffix = ENTITY_SUFFIX[businessShape(businessType)];
  return suffix ? `${category} ${suffix}` : category;
}

const ENTITY_SUFFIX = {
  home: 'company',
  medical: 'practice',
  professional: '',
  project: 'agency',
  generic: '',
};

/**
 * Kept for the call sites that render `${category}${word ? ' ' + word : ''}`.
 * New code should use entityFor(), which returns the whole phrase.
 */
function companyWord(businessType) {
  const entry = findType(businessType);
  if (entry && entry.entity) {
    const category = entry.category;
    return entry.entity.startsWith(category)
      ? entry.entity.slice(category.length).trim()
      : '';
  }
  return ENTITY_SUFFIX[businessShape(businessType)] || '';
}

/* -------------------------------------------------------------------------
 * What each shape is allowed to render
 * ---------------------------------------------------------------------- */

const HOME_NOTICE =
  'The figures above are typical ranges for this area and are provided for ' +
  'planning purposes only. Final cost varies with the size of the job, the ' +
  'materials selected, access and site conditions, and current supply prices. ' +
  'Contact us for a free, no-obligation quote for your property.';

const PROJECT_NOTICE =
  'The figures above are typical ranges for this kind of work and are provided ' +
  'for planning purposes only. Final cost varies with the size and complexity ' +
  'of the project, the number of pages or features involved, how much content ' +
  'is supplied, and the turnaround required. Contact us for a fixed proposal.';

const CAPABILITIES = {
  home: {
    badges: true,
    pricingTable: true,
    pricingUnits: ['per job', 'per hour', 'per unit', 'per sq ft', 'per linear ft'],
    pricingNotice: HOME_NOTICE,
    // The location FAQ themes are written around arrival windows, site access,
    // parking and permits. True for a roofer, meaningless for a dentist.
    tradesLocationFaq: true,
  },
  project: {
    badges: false,
    pricingTable: true,
    pricingUnits: ['per project', 'per page', 'per month', 'per hour'],
    pricingNotice: PROJECT_NOTICE,
    tradesLocationFaq: false,
  },
  // A published price table for a physician has insurance-billing and
  // state-disclosure implications; for an attorney, fee advertising is
  // governed by bar rules in most states. Neither gets one.
  medical: {
    badges: false,
    pricingTable: false,
    pricingUnits: [],
    pricingNotice: '',
    tradesLocationFaq: false,
  },
  professional: {
    badges: false,
    pricingTable: false,
    pricingUnits: [],
    pricingNotice: '',
    tradesLocationFaq: false,
  },
  generic: {
    badges: false,
    pricingTable: false,
    pricingUnits: [],
    pricingNotice: '',
    tradesLocationFaq: false,
  },
};

/** @returns {{badges,pricingTable,pricingUnits,pricingNotice,tradesLocationFaq}} */
function capabilities(businessType) {
  return CAPABILITIES[businessShape(businessType)] || CAPABILITIES.generic;
}

const wantsBadges = t => capabilities(t).badges;
const wantsPricingTable = t => capabilities(t).pricingTable;

/* -------------------------------------------------------------------------
 * Trust points
 *
 * `always`  makes no factual claim about the business, so the model may use
 *           it whatever the owner ticked.
 * `optIn`   IS a factual claim. Offered to the model only when ticked in the
 *           wizard.
 *
 * `default: true` on the home entries reproduces exactly what the prompt used
 * to hardcode, so no existing customer's About page changes.
 *
 * `pinned` keeps an entry's historical position at the top of the list.
 * ---------------------------------------------------------------------- */

const TRUST_POINTS = {
  home: {
    always: [
      'flexible scheduling',
    ],
    optIn: [
      { id: 'open24',      label: 'Open 24 hours, 7 days a week',                default: false, pinned: true },
      { id: 'cards',       label: 'Visa, Mastercard and most major cards accepted', default: true, pinned: true },
      { id: 'licensed',    label: 'licensed, insured and bonded',                 default: true },
      { id: 'accredited',  label: 'accredited by local authorities',              default: true },
      { id: 'fiveStar',    label: '5-star rated by local customers',              default: true },
      { id: 'sameDay',     label: 'same-day service available',                   default: true },
      { id: 'estimates',   label: 'free onsite estimates',                        default: true },
      { id: 'warranty',    label: 'workmanship warranty',                         default: true },
      { id: 'upfront',     label: 'upfront pricing, no hidden fees',              default: true },
      { id: 'familyOwned', label: 'family owned and operated',                    default: true },
    ],
  },

  // No "5-star rated": patient testimonials run into both HIPAA and the FTC
  // endorsement rules, and an unqualified rating claim on a practice site is
  // the kind of thing a state board writes about. No warranty, no estimates,
  // nothing containing "painless" or "guaranteed" — several state dental
  // boards prohibit those outright.
  medical: {
    always: [
      'new patients welcome',
      'clear treatment plans before you begin',
      'flexible appointment times',
      'questions answered before you decide',
    ],
    optIn: [
      { id: 'insurance', label: 'most insurance plans accepted',         default: false },
      { id: 'evenings',  label: 'evening and Saturday appointments',     default: false },
      { id: 'sameWeek',  label: 'same-week appointments available',      default: false },
      { id: 'emergency', label: 'emergency appointments available',      default: false },
      { id: 'financing', label: 'payment plans and financing available', default: false },
      { id: 'parking',   label: 'free parking and step-free access',     default: false },
      { id: 'licensed',  label: 'licensed and state-registered',         default: false },
      { id: 'family',    label: "family and children's care welcome",    default: false },
      { id: 'cards',     label: 'Visa, Mastercard and most major cards accepted', default: false },
    ],
  },

  // No cards-accepted default: it reads as a retail counter rather than a
  // firm. No same-day service, no warranty, no estimates.
  professional: {
    always: [
      'confidential case review',
      'clear fee agreements in writing',
      'direct access to your attorney',
      'your options explained in plain language',
    ],
    optIn: [
      { id: 'freeConsult',  label: 'free initial consultation',           default: false },
      { id: 'licensed',     label: 'licensed to practice in this state',  default: false },
      { id: 'evenings',     label: 'evening and weekend consultations',   default: false },
      { id: 'plans',        label: 'payment plans available',             default: false },
      { id: 'spanish',      label: 'se habla español',                    default: false },
      // Contingency billing is true only of some practices, and most states
      // require a costs disclaimer printed alongside the claim. Never
      // generated unless it is deliberately ticked.
      {
        id: 'contingency',
        label: 'no fee unless we recover',
        default: false,
        note: 'Most states require a costs disclaimer alongside this claim. Check your bar rules before enabling it.',
      },
    ],
  },

  project: {
    always: [
      'clear milestones and delivery dates',
      'you own your code, content and domains',
      'work directly with the person building it',
      'plain-English updates, no jargon',
    ],
    optIn: [
      { id: 'freeDiscovery', label: 'free discovery call',                     default: false },
      { id: 'fixedPrice',    label: 'fixed-price proposals, no hourly surprises', default: false },
      { id: 'accessible',    label: 'mobile-first, accessible builds',         default: false },
      { id: 'support',       label: 'ongoing support and maintenance available', default: false },
      { id: 'noContract',    label: 'no long-term contracts',                  default: false },
      { id: 'cards',         label: 'Visa, Mastercard and most major cards accepted', default: false },
    ],
  },

  // Nothing licensed, nothing rated, nothing warrantied. This is what an
  // unrecognised business type gets, and it has to be safe without knowing
  // anything at all about the business.
  generic: {
    always: [
      'clear pricing agreed in advance',
      'locally owned and operated',
      'flexible appointment times',
      'questions answered before you commit',
    ],
    optIn: [
      { id: 'freeConsult', label: 'free initial consultation',                    default: false },
      { id: 'cards',       label: 'Visa, Mastercard and most major cards accepted', default: false },
      { id: 'evenings',    label: 'evening and weekend availability',             default: false },
    ],
  },
};

/** The opt-in claims for a type, for rendering the wizard checkboxes. */
function trustClaimOptions(businessType) {
  const set = TRUST_POINTS[businessShape(businessType)] || TRUST_POINTS.generic;
  return set.optIn.map(c => ({ ...c }));
}

/**
 * Parse what the wizard posted.
 *
 * The wizard sends a single comma-separated hidden field rather than a
 * checkbox array: `global[trustClaims][]` arrives nested through one body
 * parser and flat through another, and this route already carries a
 * `ctx.body.global?.x ?? ctx.body['global[x]']` dance because of exactly that.
 * One string has one meaning.
 *
 * `null`/`undefined` means the field was never posted — an older client, or a
 * job replayed from before this existed. Those fall back to the shape's
 * defaults, which for home services is every historical claim.
 */
const NONE_TICKED = '-';

function parseTrustClaims(raw, businessType) {
  if (raw === null || raw === undefined || raw === '') {
    const set = TRUST_POINTS[businessShape(businessType)] || TRUST_POINTS.generic;
    return set.optIn.filter(c => c.default).map(c => c.id);
  }

  // The wizard posts '-' for "I looked at these and none of them are true".
  // An empty string cannot carry that, because an empty string is also what a
  // client that predates this field sends — and those have to fall back to the
  // defaults above. Collapsing the two would silently re-assert every claim an
  // owner had just deliberately removed.
  if (String(raw).trim() === NONE_TICKED) return [];

  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  return list
    .map(s => String(s).trim())
    .filter(s => s && s !== NONE_TICKED);
}

/**
 * The trust points a prompt may offer the model.
 *
 * @param {string} businessType
 * @param {object} [opts]
 * @param {string[]|string} [opts.claims]     ticked claim ids, or the raw posted string
 * @param {boolean} [opts.is24Hours]          the existing wizard toggle; forces the open24 claim
 * @returns {{pinned: string[], pool: string[], count: number}}
 *          `pinned` must appear first, in order. `pool` is what the model
 *          chooses the rest from. `count` is how many to ask for — always
 *          even, because the list renders as a two-column grid, and 0 when
 *          there is not enough to fill one.
 */
function trustPoints(businessType, opts = {}) {
  const shape = businessShape(businessType);
  const set = TRUST_POINTS[shape] || TRUST_POINTS.generic;

  const ticked = new Set(parseTrustClaims(opts.claims, businessType));
  if (opts.is24Hours) ticked.add('open24');
  else ticked.delete('open24');

  const chosen = set.optIn.filter(c => ticked.has(c.id));

  const pinned = chosen.filter(c => c.pinned).map(c => c.label);
  const rest = chosen.filter(c => !c.pinned).map(c => c.label);

  const pool = [...set.always, ...rest];
  const total = pinned.length + pool.length;

  // Even, capped at 8, and nothing at all under 4 — a two-column grid with
  // three items in it looks like a rendering bug.
  //
  // Every shape's `always` list holds at least four entries for this reason:
  // an owner who ticks nothing still gets a balanced 2x2 grid of statements
  // that are true of anyone, rather than an empty section.
  let count = Math.min(8, total);
  if (count % 2) count -= 1;
  if (count < 4) count = 0;

  return { pinned, pool, count };
}

module.exports = {
  BUSINESS_TYPES,
  DROPDOWN_TYPES,
  imageFolderFor,
  SHAPES,
  TRUST_POINTS,
  CAPABILITIES,
  HOME_NOTICE,
  PROJECT_NOTICE,
  normaliseType,
  findType,
  businessShape,
  categoryFor,
  titleFor,
  servicesHeading,
  servicesLabelFor,
  companyWord,
  entityFor,
  ENTITY_SUFFIX,
  capabilities,
  wantsBadges,
  wantsPricingTable,
  trustClaimOptions,
  parseTrustClaims,
  trustPoints,
  NONE_TICKED,
};
