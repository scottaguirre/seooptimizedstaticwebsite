// utils/suggestServices.js
//
// Service page ideas the customer ticks instead of typing.
//
// WHY THIS EXISTS
//
// A Rank Fast site wants twenty-odd service pages. Typing twenty service
// names into twenty text boxes is the reason someone abandons the form. The
// list is the same for every plumber in America; making each one type it out
// is work the app should be doing.
//
// WHY A TWENTY-ITEM CAP AND NOT "AS MANY AS THEY WANT"
//
// Past roughly twenty, a model stops producing distinct services and starts
// producing restatements — "Water Heater Repair", "Water Heater Repairs",
// "Water Heater Service". Three pages competing for one search result, three
// lots of credits, and utils/serviceNames.js would warn about all of them.
// A longer list is a worse list, not a bigger one. Same reasoning as the
// twelve-topic cap in routes/blogTopicsRoute.js.
//
// WHAT MAKES A GOOD SERVICE PAGE, WHICH IS NOT THE SAME AS A SERVICE
//
// The prompt below asks for what a CUSTOMER TYPES INTO GOOGLE, not what the
// business calls the job internally. "Slab Leak Repair" is a page; "Plumbing
// Services" is the home page; "Pipe Work" is nothing anyone searches.
//
// ORDER MATTERS MORE THAN USUAL HERE
//
// The caller pre-ticks only as many boxes as the customer's credits allow —
// someone with 300 credits gets one. So the list is asked for in order of how
// commonly the trade actually sells them, which makes the top of the list the
// right default rather than an arbitrary one.

// NOT `require('./openaiClient')` at the top.
//
// That module requires the `openai` package, so a top-level require here means
// this whole file — including cleanServices() and titleCase(), which touch no
// network at all — cannot be loaded unless the package is installed. The test
// suite would then need the API client to check a string-tidying function.
//
// Same reasoning openaiClient.js gives for building its client lazily: a
// dependency should take down the one feature that needs it, not everything
// in the file. Required inside suggestServices(), at the moment it is used.
const { parseModelJson } = require('./parseModelJson');
const { slugCollisions, similarServices } = require('./serviceNames');
const { businessShape } = require('./businessShape');

/** The most the model is ever asked for. See the header. */
const MAX_SERVICES = 20;

/**
 * Site furniture. Exact matches, because these are whole page names.
 */
const BANNED = [
  'about us', 'about', 'contact', 'contact us', 'home', 'services',
  'our services', 'service', 'free estimate', 'free estimates', 'free quote',
  'testimonials', 'reviews', 'gallery', 'blog', 'faq', 'pricing',
];

/**
 * Words that describe no job.
 *
 * AN EXACT-MATCH BAN LIST DOES NOT WORK for these, which is what the first
 * version tried. "Quality Service" was banned and "Quality Workmanship" sailed
 * through; "Plumbing Services" was not on the list at all. A model will always
 * find a variant the list does not have.
 *
 * So the rule is subtractive instead: strip these words out and see whether
 * anything real is left.
 *
 *   Quality Workmanship  -> (nothing)     -> rejected
 *   Professional Plumbing -> Plumbing     -> the category -> rejected
 *   Plumbing Services     -> Plumbing     -> the category -> rejected
 *   Emergency Plumbing    -> Emergency Plumbing           -> KEPT, correctly:
 *                            "emergency" is a real distinction someone
 *                            searches for, not an adjective about quality
 *   Water Heater Repair   -> Water Heater Repair          -> kept
 */
const EMPTY_WORDS = new Set([
  'service', 'services',
  'quality', 'affordable', 'cheap', 'best', 'top', 'premier', 'superior',
  'professional', 'expert', 'experienced', 'reliable', 'trusted', 'licensed',
  'workmanship', 'craftsmanship', 'excellence', 'satisfaction', 'solutions',
  'general', 'complete', 'full', 'total', 'custom', 'our', 'your',
]);

/**
 * Is this the business's own category rather than a job it does?
 *
 * A page for "Plumbing" on a plumber's site competes with the home page for
 * the same term, which is the cannibalisation the whole app is built to avoid.
 */
function isTheCategory(name, businessType) {
  const type = normalise(businessType).toLowerCase();
  if (!type) return false;

  const core = normalise(name)
    .toLowerCase()
    .split(' ')
    .filter(word => !EMPTY_WORDS.has(word))
    .join(' ');

  // Nothing left once the empty words are gone: "Quality Workmanship".
  if (!core) return true;

  // What is left IS the category: "Professional Plumbing Services".
  if (core === type) return true;

  // The category with its own empty words removed, so "Law Firm" matches
  // "Professional Law Firm Services".
  const typeCore = type.split(' ').filter(w => !EMPTY_WORDS.has(w)).join(' ');

  return !!typeCore && core === typeCore;
}

/** How the work is described, by the kind of business. */
const SHAPE_WORDING = {
  home:         'jobs a homeowner calls a tradesperson out to do',
  medical:      'treatments and procedures a patient books an appointment for',
  professional: 'matters a client hires this kind of firm to handle',
  project:      'pieces of work a client commissions',
  generic:      'services a customer pays this business for',
};

function normalise(text) {
  return String(text || '').trim().replace(/\s+/g, ' ');
}

/**
 * Title Case for display, without mangling the small words.
 *
 * The model is asked for title case and mostly obliges, but "water heater
 * repair" comes back often enough that normalising here is cheaper than
 * another round trip. These strings become <h1>s and page titles.
 */
const SMALL_WORDS = new Set(['a', 'an', 'and', 'the', 'for', 'of', 'in', 'on', 'to', 'or']);

/**
 * The longest a run of capitals can be and still be an abbreviation.
 *
 * AC, TV, RO, PEX, HVAC, CCTV all fit. DRAIN, CLEANING, PLUMBING do not, and
 * that is the point: the first version of this kept ANY word carrying a
 * capital after the first letter, so "DRAIN CLEANING" came back from the model
 * shouting and went onto the page shouting. A model that has been told "title
 * case" returns all-caps often enough to matter.
 *
 * Four is where the two groups separate in this domain. A longer real
 * abbreviation would be lowercased — but a whole shouted service name is both
 * likelier and uglier.
 */
const MAX_ABBREVIATION = 4;

function casePart(part, isFirst) {
  // Mixed case already — "McDonald", "iPhone", "Re-Piping". Somebody chose
  // those capitals; leave them.
  if (/[a-z]/.test(part) && /[A-Z]/.test(part.slice(1))) return part;

  // All capitals and short: an abbreviation. "AC Repair", not "Ac Repair".
  if (!/[a-z]/.test(part) && /[A-Z]/.test(part) && part.length <= MAX_ABBREVIATION) {
    return part;
  }

  const lower = part.toLowerCase();
  if (!isFirst && SMALL_WORDS.has(lower)) return lower;

  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function titleCase(text) {
  return normalise(text)
    .split(' ')
    .map((word, i) =>
      // Hyphenated words get each side treated on its own, so "re-piping"
      // becomes "Re-Piping" rather than "Re-piping".
      word.split('-').map((part, j) => casePart(part, i === 0 && j === 0)).join('-')
    )
    .join(' ');
}

/**
 * Strip everything that cannot become a service page.
 *
 * FOUR PASSES, and the last two are the ones that matter — they reuse the
 * checks the form already runs, so the model cannot hand the customer a list
 * that the very next screen would warn about.
 *
 * @param {object}   [opts]
 * @param {number}   [opts.limit]
 * @param {string}   [opts.businessType]
 * @param {string[]} [opts.exclude]  names already on the form. A suggestion
 *   that repeats, collides with or restates one of these is dropped, and the
 *   form's own entry is never touched — the customer typed it.
 *
 * @returns {{ services: string[], dropped: Array<{name: string, why: string}> }}
 */
function cleanServices(raw, { limit = MAX_SERVICES, businessType = '', exclude = [] } = {}) {
  // Already on the form. These ride through the whole function alongside the
  // suggestions so the two checks below compare against them, and are sliced
  // back off at the end. Without this the customer who has already typed
  // "Water Heater Repair" is offered "Water Heater Repairs" — the exact pair
  // the form would then warn them about.
  const existing = (Array.isArray(exclude) ? exclude : [])
    .map(item => titleCase(typeof item === 'string' ? item : (item && item.name) || ''))
    .filter(Boolean);

  // Seeding the duplicate check with the form's rows is BELT AND BRACES, and
  // knowingly so. An exact repeat would be caught a few lines further down by
  // the slug check anyway, with the same reason attached — mutation testing
  // says removing this changes no outcome. It stays because catching a repeat
  // at the cheapest check is where a reader expects to find it, and because
  // the slug check is a filename test that happens to cover this rather than
  // one written to.
  const onForm = new Set(existing.map(name => name.toLowerCase()));

  const dropped = [];
  const seen = new Set(onForm);
  let list = [];

  // 1. Shape: a real string, sane length, no punctuation soup.
  for (const item of Array.isArray(raw) ? raw : []) {
    const name = titleCase(typeof item === 'string' ? item : (item && item.name) || '');

    if (!name) continue;

    if (name.length > 60) {
      dropped.push({ name, why: 'too long for a page title' });
      continue;
    }

    // A service name is words, and occasionally a digit or a hyphen
    // ("24 Hour Plumbing", "Re-Piping"). Anything else is the model
    // editorialising.
    if (!/^[A-Za-z0-9][A-Za-z0-9 &'/-]*$/.test(name)) {
      dropped.push({ name, why: 'contains punctuation that will not slugify' });
      continue;
    }

    // 2. Not site furniture.
    if (BANNED.includes(name.toLowerCase())) {
      dropped.push({ name, why: 'not a service page' });
      continue;
    }

    // 2b. Not the business's own category, and not pure marketing.
    if (isTheCategory(name, businessType)) {
      dropped.push({ name, why: 'the business category, not a service' });
      continue;
    }

    // 3. Not a repeat of one already accepted, case-insensitively — nor of
    //    one the customer has already put on the form.
    const key = name.toLowerCase();
    if (seen.has(key)) {
      dropped.push({ name, why: onForm.has(key) ? 'already on the form' : 'duplicate' });
      continue;
    }
    seen.add(key);

    list.push(name);
  }

  // 4. THE TWO CHECKS THE FORM ALREADY RUNS.
  //
  // slugCollisions catches names that produce the same FILENAME — those
  // overwrite each other and the customer pays for a page that does not
  // exist. similarServices catches names that merely mean the same thing —
  // both pages get written, both get charged, and Google shows one.
  //
  // Doing this here rather than leaving it to the form is the whole point:
  // the suggestion list is generated, so a duplicate in it is OUR mistake,
  // not something the customer chose. First occurrence wins, because the
  // list is ordered by how common the service is.
  //
  // Both run over the form's rows AND the suggestions, with the form's rows
  // first — so the survivor of any pair is whichever the customer already
  // has, and a suggestion never displaces their own typing.
  const all = existing.concat(list);
  const isTheirs = index => index < existing.length;

  for (const collision of slugCollisions(all)) {
    for (const index of collision.indexes.slice(1)) {
      if (isTheirs(index)) continue;
      dropped.push({
        name: all[index],
        why: isTheirs(collision.indexes[0])
          ? 'already on the form'
          : 'same page as another suggestion',
      });
      all[index] = null;
    }
  }

  for (const overlap of similarServices(all)) {
    // Ordered by position, not by which side of the pair the comparator
    // happened to put first — the earlier entry is the one that survives.
    const a = Math.min(overlap.a, overlap.b);
    const b = Math.max(overlap.a, overlap.b);
    if (isTheirs(b) || all[b] === null) continue;
    dropped.push({
      name: all[b],
      why: isTheirs(a) ? 'already on the form' : 'too similar to another suggestion',
    });
    all[b] = null;
  }

  list = all.slice(existing.length).filter(Boolean);

  return { services: list.slice(0, limit), dropped };
}

/**
 * The prompt.
 *
 * @param {object} ctx
 * @param {string} ctx.businessType  "Plumbing", "Law Firm", "Dentist"
 * @param {string} ctx.location      "Round Rock, TX"
 * @param {number} ctx.count
 * @param {string[]} [ctx.exclude]   pages they have already added
 */
function buildPrompt({ businessType, location, count = MAX_SERVICES, exclude = [] }) {
  const shape = businessShape(businessType);
  const wording = SHAPE_WORDING[shape] || SHAPE_WORDING.generic;

  // Telling the model what they already have is cheaper than asking for extra
  // and throwing the repeats away: a customer who has typed their six best
  // services would otherwise get six of their own back and fourteen new ones.
  // cleanServices still drops repeats — a prompt is a request, not a promise.
  const already = exclude.length
    ? `\nThey have ALREADY added pages for these. Do not suggest them, or any\n`
      + `restatement of them:\n${exclude.map(name => `- ${name}`).join('\n')}\n`
    : '';

  return `You are naming the service pages for a ${businessType} business in ${location}.
${already}
Return exactly ${count} services — the ${wording}.

ORDER THEM BY HOW COMMONLY THIS KIND OF BUSINESS IS ACTUALLY HIRED FOR THEM.
The first is the one they are called about most. This matters: a customer on a
small budget will only take the first few, so the top of the list has to be
the part worth having.

Each name must be:
- WHAT A CUSTOMER TYPES INTO GOOGLE, not the internal job name.
  Good: "Slab Leak Repair". Bad: "Subsurface Pipe Remediation".
- Two to four words, in Title Case.
- A specific job. Not the business's whole category, and not a benefit.
  Bad: "Plumbing Services", "Quality Workmanship", "Emergency Service".
- DISTINCT from every other name in the list. Not a restatement.
  If you list "Water Heater Repair", do not also list "Water Heater Repairs",
  "Water Heater Service" or "Hot Water Heater Repair". They are one page.

Do not include: About, Contact, Home, Services, Testimonials, Pricing, FAQ.
Do not mention the town in any name — the pages add it themselves.

Return JSON only:
{"services": ["First Service", "Second Service", ...]}`;
}

/**
 * Suggest service pages for a business.
 *
 * @param {object} ctx                { businessType, location }
 * @param {object} [opts]
 * @param {number} [opts.count]       how many to ask for, capped at 20
 * @param {string[]} [opts.exclude]   names already on the form
 * @param {boolean} [opts.stub]       skip the API call; for tests
 * @returns {Promise<{services: string[], dropped: Array}>}
 */
async function suggestServices(ctx = {}, opts = {}) {
  const businessType = normalise(ctx.businessType);
  const location = normalise(ctx.location);

  if (!businessType) {
    throw new Error('suggestServices: businessType is required');
  }

  const count = Math.min(MAX_SERVICES, Math.max(1, Number(opts.count) || MAX_SERVICES));
  const exclude = Array.isArray(opts.exclude) ? opts.exclude : [];

  if (opts.stub) {
    return cleanServices(stubServices(businessType), { limit: count, businessType, exclude });
  }

  // Required here, not at the top of the file — see the note by the imports.
  const openai = opts.client || require('./openaiClient').getOpenAI();

  const response = await openai.responses.create({
    model: opts.model || process.env.SUGGEST_MODEL || 'gpt-5.6-terra',
    input: buildPrompt({ businessType, location, count, exclude }),
    // Listing services is recall, not reasoning — unlike choosing blog topics,
    // where the model has to find an angle. Low effort is the right price.
    reasoning: { effort: opts.effort || 'low' },
    text: { verbosity: 'low' },
  });

  // parseModelJson never throws; it returns { ok, data }. The first version
  // of this read `parsed.services` — off the WRAPPER, which has no such
  // field — so every reply, valid or not, fell through to the throw below.
  // The test that should have caught it asserted a rejection, and got one,
  // for the wrong reason. It now asserts the happy path as well.
  const parsed = parseModelJson(response.output_text, { label: 'service suggestions' });

  if (!parsed.ok || !parsed.data || !Array.isArray(parsed.data.services)) {
    throw new Error('service suggestions: model returned no services array');
  }

  const result = cleanServices(parsed.data.services, { limit: count, businessType, exclude });

  // What the call actually cost, passed back for the log line.
  //
  // This endpoint is not billed, so the only way to know whether that is
  // affordable is to measure it. A guess about token counts is not a number
  // anyone should set a rate limit from.
  //
  // Optional on purpose: a stubbed or injected client need not provide it,
  // and a missing usage block must not fail a call that otherwise worked.
  result.usage = readUsage(response);

  return result;
}

/** The token counts, whatever shape the SDK puts them in. */
function readUsage(response) {
  const usage = response && response.usage;
  if (!usage) return null;

  const input = Number(usage.input_tokens ?? usage.prompt_tokens);
  const output = Number(usage.output_tokens ?? usage.completion_tokens);
  const total = Number(usage.total_tokens);

  return {
    input: Number.isFinite(input) ? input : null,
    output: Number.isFinite(output) ? output : null,
    total: Number.isFinite(total)
      ? total
      : (Number.isFinite(input) && Number.isFinite(output) ? input + output : null),
  };
}

/**
 * Deterministic output for tests, and a readable example of the shape.
 *
 * Ordered by how commonly a plumber is called for each, which is the property
 * the budget-truncated top slice depends on.
 *
 * It returns the WHOLE list and lets cleanServices() do the truncating. It
 * used to slice to `count` itself, which meant the `limit` handed to
 * cleanServices never actually bit, and a bug that dropped that limit would
 * have gone unnoticed. One place decides how many.
 */
function stubServices() {
  const base = [
    'Water Heater Repair',
    'Drain Cleaning',
    'Leak Detection',
    'Toilet Repair',
    'Burst Pipe Repair',
    'Sewer Line Repair',
    'Garbage Disposal Repair',
    'Faucet Installation',
    'Slab Leak Repair',
    'Water Heater Installation',
    'Repiping',
    'Gas Line Repair',
    'Sump Pump Repair',
    'Shower Installation',
    'Water Softener Installation',
    'Hydro Jetting',
    'Backflow Testing',
    'Septic Tank Pumping',
    'Bathroom Remodeling',
    'Kitchen Plumbing',
  ];

  return base;
}

module.exports = {
  suggestServices,
  cleanServices,
  buildPrompt,
  titleCase,
  isTheCategory,
  MAX_SERVICES,
  BANNED,
  EMPTY_WORDS,
};
