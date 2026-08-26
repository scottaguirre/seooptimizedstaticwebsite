// utils/generateLocationFaq.js
//
// The FAQ for a LOCATION page. Questions are written, not fetched.
//
// WHY THIS EXISTS — WHAT WENT WRONG WITH PAA
//
// Location pages used to pull their questions from Google's "People Also Ask"
// block, one ValueSERP query per town: "Plumbing Cedar Park, TX". The theory
// was that different towns would produce different questions.
//
// They do not. Google has no question data at the level of a small town, so
// the PAA block for a local query falls back to the STATE. A real build of a
// three-location site produced this:
//
//   Cedar Park page   "How much does a plumber charge per hour in Texas?"
//   Round Rock page   "How much does a plumber charge in Texas?"
//   Georgetown page   "How much does a plumber charge in Texas?"
//   Home page         "What is the average hourly rate for a plumber in Texas?"
//
// One question, four pages, and in Rank GBPs mode four FAQPage JSON-LD blocks
// on one domain all carrying it. That is a stronger duplicate signal than
// having no FAQ at all, and it cost a credit per town to produce.
//
// The answers were worse than the questions: "service call, labor time,
// materials, access, after-hours" appeared in all three, reordered.
//
// WHAT REPLACED IT
//
// Each location page already gets a different angle from LOCATION_ANGLES in
// createLocationPagesPrompt — response times, housing stock, seasonal demand,
// and so on. That angle is the thing that genuinely varies between two towns
// on the same site, so the questions are generated FROM it. Town three asks
// about winter pipe damage because town three's page is about seasonal
// demand; town one asks about arrival windows because town one's page is
// about response times.
//
// The trade, stated plainly: these are plausible questions rather than
// verified search demand. PAA is real demand and stays on the HOME page,
// where it is one query about one place and the duplication problem does not
// arise. On location pages it was returning the same state-level block every
// time.
//
// Cost: 0 ValueSERP credits. Two GPT calls per town — one small one for the
// questions, then the existing generateFaqAnswers for the survivors only, so
// no answer is written for a question the dedupe filter is about to discard.
//
// THE DEDUPE GUARANTEE
//
// The model is TOLD what has already been used, and then the output is
// FILTERED against the same list. Telling it is a courtesy; the filter is the
// guarantee. A model that ignores the instruction cannot put a repeat on the
// page.
//
// The shared store is a MAP, not a Set: the filter needs the normalised key
// ("how much does a plumber charge in texas") and the prompt needs the
// readable question to show the model. A Set of keys can only do the first
// and would hand the model a list of mangled lowercase strings.
//
//     usedQuestions : Map<normalisedKey, originalQuestionText>
//
// TWO KEYS, NOT ONE
//
// Exact-text dedupe alone is not enough, and this was caught in testing rather
// than in production. These three are three different strings:
//
//     "How soon can someone reach me in Cedar Park, TX?"
//     "How soon can someone reach me in Round Rock, TX?"
//     "How soon can someone reach me in Georgetown, TX?"
//
// An exact-match filter passes all three, and the site ends up with the same
// templated question on every page with the town swapped — which is the exact
// failure PAA produced, just harder to spot.
//
// So every question is checked on a SHAPE key as well: the same normalisation
// with every place name on the site stripped out first. All three collapse to
// "how soon can someone reach me in" and only the first survives.
//
// This deliberately costs coverage. A later town may end up with two questions
// instead of four. Two questions that are actually about that town beat four
// that are about nowhere.

const { OpenAI } = require('openai');
const { parseModelJson } = require('./parseModelJson');
const { generateFaqAnswers } = require('./generateFaqAnswers');
const { questionKey } = require('./fetchPeopleAlsoAsk');
const { log } = require('./logger');

// Same lazy construction as generateFaqAnswers: building OpenAI without a key
// throws, and that would take the server down at boot over an optional section.
let openaiClient = null;
function getOpenAI() {
  if (!openaiClient) openaiClient = new OpenAI();
  return openaiClient;
}

const QUESTIONS_WANTED = 4;
// Over-generate. The dedupe filter discards on average one or two per town on
// a multi-location site, and asking for four to keep four leaves nothing in
// reserve — the later towns would end up with two-question FAQs.
const OVERGENERATE_BY = 4;

/**
 * What each angle should make people ask about.
 *
 * Indexed the same way LOCATION_ANGLES is, so a town's FAQ is about the same
 * thing its page copy is about. Without this the model reaches for cost on
 * every page, which is how PAA failed in the first place — one topic, every
 * town.
 */
const ANGLE_QUESTION_THEMES = [
  // 0 — response times and coverage
  'arrival windows, what counts as an emergency, after-hours and weekend availability, how far out the team travels',
  // 1 — housing stock and its typical problems
  'the age and construction of local properties, what tends to fail in them, what to check in an older or a newer home',
  // 2 — seasonal and weather-driven demand
  'what the local seasons do to this kind of system, what to do before a cold snap or a storm, what fails at which time of year',
  // 3 — range of properties served
  'the difference between residential and commercial work, how quotes are put together, what a written estimate should cover',
  // 4 — local reputation and repeat customers
  'the jobs requested most often locally, what a first visit involves, what standards or methods are used and why',
  // 5 — accessibility and getting to the job
  'site access, parking and driveways, whether permits are needed locally, how scheduling and communication work',
];

/**
 * Every string that names a place on this site, longest first.
 *
 * Longest first matters: strip "Cedar Park, TX" before "TX", or "Cedar Park"
 * is left stranded next to a comma. Each display name also contributes its
 * city half and its state half, so a question naming only the city is still
 * caught.
 */
function placeStrings(placeNames = []) {
  const parts = new Set();

  (placeNames || []).forEach(name => {
    const full = String(name || '').trim();
    if (!full) return;
    parts.add(full);
    full.split(',').forEach(piece => {
      const p = piece.trim();
      if (p.length > 1) parts.add(p);
    });
  });

  return Array.from(parts).sort((a, b) => b.length - a.length);
}

/**
 * The question with every place name removed, then normalised.
 *
 * "How soon can someone reach me in Round Rock, TX?"
 *   -> "how soon can someone reach me in"
 *
 * Two questions that differ only by which town they name produce the same
 * shape key, so the second one is refused.
 */
function shapeKey(question, places = []) {
  let text = String(question || '');
  for (const place of places) {
    // Case-insensitive literal replace, no regex — a town name can contain
    // characters that are regex operators.
    let i = text.toLowerCase().indexOf(place.toLowerCase());
    while (i !== -1) {
      text = text.slice(0, i) + ' ' + text.slice(i + place.length);
      i = text.toLowerCase().indexOf(place.toLowerCase());
    }
  }
  return questionKey(text);
}

/**
 * Prompt for the QUESTIONS only. Short output on purpose — this call exists to
 * be cheap, because a good share of what it returns is about to be thrown away.
 */
function buildQuestionsPrompt({ businessName, businessType, location, angleFocus, theme, avoid, want }) {
  const avoidBlock = avoid.length
    ? `
ALREADY USED ON THIS WEBSITE — do not repeat any of these, and do not write a
reworded version of one either. "How much does a plumber charge in Texas?" and
"What does a plumber cost per hour in Texas?" count as the same question.

${avoid.map(q => `- ${q}`).join('\n')}
`
    : '';

  return `
You are writing the FAQ questions for the ${location} page of a local ${businessType} business called "${businessName}".

This website has a separate page for each town it serves. Every one of those
pages has its own FAQ. Yours must not read like the others.

THIS PAGE'S SUBJECT: ${angleFocus}.
Ask about: ${theme}.
${avoidBlock}
Write ${want} questions.

RULES
- Write questions a real person in ${location} would actually type or ask on
  the phone. Not marketing questions, and not questions whose answer is "yes,
  we are great".
- Anchor them in the subject above. At most ONE may be about price.
- Name ${location} in two or three of them, not all — a question naming the
  town in every line reads as keyword stuffing.
- Do not name neighbourhoods, streets or landmarks. A town name or an
  adjacent town is safe; a guessed neighbourhood is not.
- Each must be answerable in about 80 words without inventing prices,
  guarantees, licence numbers, or response-time promises.
- Vary the opening word. Not every question should start with "How".

Return ONLY a JSON array of strings:

["Question one?", "Question two?"]
`.trim();
}

/**
 * The questions for one town. Model-side avoidance only — the caller still
 * filters. Returns [] on any failure.
 */
async function generateLocationQuestions({
  businessName,
  businessType,
  location,
  angleFocus,
  theme,
  avoid = [],
  want = QUESTIONS_WANTED + OVERGENERATE_BY,
}) {
  try {
    const prompt = buildQuestionsPrompt({
      businessName, businessType, location, angleFocus, theme,
      // Cap the avoid list. On a twenty-location site this would otherwise
      // grow past the point where the model reads it, and the hard filter is
      // what actually enforces the rule anyway.
      avoid: avoid.slice(-24),
      want,
    });

    const response = await getOpenAI().responses.create({
      model: 'gpt-5.6-terra',
      input: prompt,
      reasoning: { effort: 'low' },
      text: { verbosity: 'low' },
    });

    console.log('generateLocationQuestions usage:', response.usage);

    const raw = String(response.output_text || '').trim();
    const cleaned = raw
      .replace(/```json|```/g, '')
      .replace(/^[^\[]*\[/, '[')
      .replace(/\][^\]]*$/, ']')
      .trim();

    const parseResult = parseModelJson(cleaned, { expect: 'array', label: 'location FAQ questions' });
    if (!parseResult.ok) throw parseResult.error;

    const parsed = parseResult.data;
    if (!Array.isArray(parsed)) throw new Error('Model did not return an array');

    return parsed
      .map(q => (typeof q === 'string' ? q : (q && q.question) || ''))
      .map(q => String(q).trim())
      .filter(Boolean);

  } catch (err) {
    console.warn(`   ⚠️ Could not generate FAQ questions for ${location}:`, err.message);
    log.external('openai', 'locationFaqQuestionsFailed', {
      location,
      message: err.message,
      status: err.status || err.response?.status || null,
    });
    return [];
  }
}

/**
 * The finished FAQ for one location page.
 *
 * MUTATES `usedQuestions`: every question that survives to the page is added,
 * so the next town sees it in its avoid list and its filter. That set is
 * created once per generation in runGeneration and seeded with the home page's
 * PAA questions, which is what stops a location page repeating the home page.
 *
 * @param {object}  opts
 * @param {Map}     opts.usedQuestions  Map<normalisedKey, questionText>, shared
 *                                      across the whole build
 * @param {string}  opts.angleFocus     LOCATION_ANGLES[i].focus for this town
 * @param {number}  opts.angleIndex     the same index, picks the question theme
 * @returns {Promise<Array<{question:string, answer:string}>>} [] on any failure
 */
async function generateLocationFaq({
  businessName,
  businessType,
  location,
  angleFocus = '',
  angleIndex = 0,
  usedQuestions = new Map(),
  placeNames = [],
  count = QUESTIONS_WANTED,
}) {
  const theme = ANGLE_QUESTION_THEMES[angleIndex % ANGLE_QUESTION_THEMES.length];

  // The readable questions, for the model to steer away from. The keys are
  // what the filter below uses; they would be meaningless to show the model.
  const avoidText = Array.from(usedQuestions.values()).filter(Boolean);

  // Shape keys for everything already used, rebuilt each town rather than
  // stored. The set is small and this keeps the shared map to one simple
  // structure that runGeneration can seed without knowing about shapes.
  const places = placeStrings([...(placeNames || []), location]);
  const usedShapes = new Set(avoidText.map(q => shapeKey(q, places)).filter(Boolean));

  const candidates = await generateLocationQuestions({
    businessName, businessType, location, angleFocus, theme,
    avoid: avoidText,
    want: count + OVERGENERATE_BY,
  });

  if (!candidates.length) return [];

  // === THE GUARANTEE ===
  //
  // Four filters, in order of how much they catch:
  //
  //   1. exact match against earlier pages
  //   2. SHAPE match against earlier pages   (the town-swap case)
  //   3. exact match within this response    (models do repeat themselves)
  //   4. shape match within this response    (two of its own, town swapped)
  const seenKeys = new Set();
  const seenShapes = new Set();
  const fresh = [];
  let droppedExact = 0;
  let droppedShape = 0;

  for (const question of candidates) {
    const key = questionKey(question);
    if (!key) continue;

    if (usedQuestions.has(key) || seenKeys.has(key)) { droppedExact++; continue; }

    const shape = shapeKey(question, places);
    if (shape && (usedShapes.has(shape) || seenShapes.has(shape))) { droppedShape++; continue; }

    seenKeys.add(key);
    if (shape) seenShapes.add(shape);
    fresh.push(question);
    if (fresh.length >= count) break;
  }

  if (droppedExact || droppedShape) {
    console.log(`   ↩︎ ${location}: dropped ${droppedExact} repeat(s) and ${droppedShape} town-swapped variant(s)`);
  }

  if (!fresh.length) {
    console.warn(`   ⚠️ ${location}: every generated question repeated an earlier page — no FAQ on this page`);
    return [];
  }

  if (fresh.length < count) {
    console.warn(`   ⚠️ ${location}: only ${fresh.length} of ${count} questions were distinct enough to keep`);
  }

  // Answers for the survivors only. includeFixed:false keeps the two
  // businessName-and-type questions off location pages (they would be
  // identical on every town), and turns on the location-aware prompt rule.
  const faqs = await generateFaqAnswers({
    questions: fresh,
    businessName,
    businessType,
    location,
    includeFixed: false,
  });

  // Claim them only now. A town whose ANSWERS failed returns nothing and
  // renders without an FAQ — so its questions must stay available to the next
  // town rather than being burnt on a page that never showed them.
  addUsedQuestions(usedQuestions, faqs);

  console.log(`   ✅ ${location}: ${faqs.length} FAQ question(s), none repeated from earlier pages`);
  return faqs;
}

/**
 * Seed or extend the shared map from a list of questions or {question} pairs.
 *
 * Keyed on the NORMALISED form, so a later page cannot repeat an earlier
 * question with different capitalisation or punctuation and slip through.
 * runGeneration calls this with the home page's PAA questions before any
 * location page is built — that is what stops a town repeating the home page.
 *
 * @param {Map} usedQuestions  Map<normalisedKey, questionText>
 */
function addUsedQuestions(usedQuestions, faqsOrQuestions = []) {
  (faqsOrQuestions || []).forEach(entry => {
    const text = typeof entry === 'string' ? entry : (entry && entry.question) || '';
    const key = questionKey(text);
    // First writer wins, so the stored text stays the one actually shown on
    // the earliest page.
    if (key && !usedQuestions.has(key)) usedQuestions.set(key, String(text).trim());
  });
  return usedQuestions;
}

module.exports = {
  generateLocationFaq,
  generateLocationQuestions,
  addUsedQuestions,
  shapeKey,
  placeStrings,
  ANGLE_QUESTION_THEMES,
  QUESTIONS_WANTED,
};