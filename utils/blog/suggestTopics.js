// blog-engine-preview/suggestTopics.js
//
// Topic ideas the owner can accept, edit or ignore.
//
// WHY A THEORY OF TOPICS, NOT JUST A BAN LIST
//
// Ask a model "what should a plumber blog about?" and you get the same nine
// posts every plumber already has: a how-to, a maintenance checklist, a piece
// about modern techniques, something about local codes. They are generic
// because they are answers to the wrong question.
//
// The right question is: WHAT WAS THE CUSTOMER DOING IN THE HOUR BEFORE THEY
// PICKED UP THE PHONE? A blog post for a trade business is only worth writing
// if it meets someone in that hour. That gives topics a natural shape —
// a symptom, a decision, a cost, a surprise — and those are also the things
// people actually type into Google.
//
// TWO KINDS OF TOPIC ARE EXCLUDED ON PURPOSE
//
// 1. How-to and DIY. A post teaching someone to flush their own water heater
//    is a post arguing they should not call the plumber. It is generic AND
//    commercially backwards.
//
// 2. Codes, permits and regulations. It reads as authoritative, a model gets
//    the details subtly wrong, and the business is the one held to it. This is
//    the single highest-liability category and it is banned outright.

const path = require('path');

const ANGLES = [
  {
    key: 'symptom',
    name: 'A symptom they can see, hear or smell right now',
    example: 'Why your water heater makes a popping sound',
    note: 'This is the largest and best category — it matches what people actually search when something is wrong.',
  },
  {
    key: 'decision',
    name: 'A decision they are stuck on',
    example: 'Repair or replace: what changes at the ten-year mark',
    note: 'They have already accepted they need help. The post helps them choose, and choosing usually means calling.',
  },
  {
    key: 'expectation',
    name: 'What actually happens during the job',
    example: 'How long you will be without hot water during a replacement',
    note: 'Nobody else writes these, and they remove the friction that stops people booking.',
  },
  {
    key: 'cost',
    name: 'Where the money goes',
    example: 'Why two water heater quotes can differ by eight hundred dollars',
    note: 'High intent, and it positions the business as the one being straight with them.',
  },
  {
    key: 'local',
    name: 'Something true of this town specifically',
    example: 'What Central Texas hard water does to a tank over five years',
    note: 'Must be a real physical or climatic fact — water chemistry, soil, freeze risk, housing stock. NEVER local law.',
  },
  {
    key: 'mistake',
    name: 'A well-meant mistake that makes things worse',
    example: 'Why turning the thermostat up will not get you more hot water',
    note: 'Useful, memorable, and it demonstrates expertise instead of claiming it.',
  },
];

const BANNED = [
  'how-to and DIY repair guides of any kind',
  'anything about codes, permits, regulations, ordinances or licensing',
  '"ultimate guide" or "complete guide" posts — they compete with the service page',
  '"benefits of hiring a professional" and any variation',
  'seasonal maintenance checklists',
  'anything about "modern", "latest", "advanced" or "innovative" techniques',
  'company news, awards or milestones',
  'listicles whose only structure is a number',
];

function getClient(opts) {
  if (opts.client) return opts.client;
  const mod = require(path.join(__dirname, '..', 'openaiClient'));
  return mod.getOpenAI();
}

function buildPrompt({ business, targetPage, count, avoid = [] }) {
  // Falls back to the page title when no intent sentence is given, which is
  // weaker steering but better than none.
  const intent = targetPage.intent
    || `use the business's ${targetPage.title} service`;
  const angles = ANGLES
    .map(a => `- ${a.name}\n    e.g. "${a.example}"\n    ${a.note}`)
    .join('\n');

  const avoidBlock = avoid.length
    ? `\nALREADY COVERED — propose nothing that overlaps these:\n${avoid.map(t => `  - ${t}`).join('\n')}\n`
    : '';

  return `Propose ${count} blog topics for a local trade business.

BUSINESS
  Name:     ${business.name}
  Trade:    ${business.trade}
  Town:     ${business.town}
  Services: ${business.services.join(', ')}

THESE POSTS EXIST TO SUPPORT ONE PAGE
  ${targetPage.title} — the page the business wants to rank for "${targetPage.keyword}".
  Every topic must be something a person with that problem would plausibly
  search, WITHOUT being the same subject as that page. A topic that covers the
  same ground would compete with it, which is worse than not writing it.

THE READER MUST END UP WANTING THIS
  ${intent}

  This is the hard constraint. A reader who finishes any of these posts should
  be CLOSER to that, never further from it.

  So: reject any topic whose honest conclusion points at a different service.
  If the target is repair, a post arguing that a ten-year-old unit is not worth
  repairing is a good post for a DIFFERENT campaign — it belongs to whichever
  page sells replacement. Writing it here would mean linking to the repair page
  from text that has just talked the reader out of repairing, and the words
  around a link are how a search engine decides what the linked page is about.

  Where a topic naturally touches the other service, keep the weight on this
  one: "what a repair can and cannot fix at ten years" serves repair intent,
  "when to replace instead" does not.
${avoidBlock}
THE TEST FOR A GOOD TOPIC
  What was this customer doing in the hour before they picked up the phone?
  A topic is good if it meets them in that hour.

USE THESE ANGLES — spread the ${count} topics across at least four of them:
${angles}

NEVER PROPOSE
${BANNED.map(b => `  - ${b}`).join('\n')}

FOR EACH TOPIC RETURN
  topic       the working title. Specific enough that it could not sit on a
              competitor's site unchanged. No "how to". No "guide". No colon-
              subtitle constructions.
  targetQuery the ONE search this post is meant to win — the words a person
              would actually type. Lower case, 3-7 words, no punctuation.
              TWO HARD RULES:
                a) No two topics may target the same or a near-identical
                   query. Two posts chasing one search split their strength
                   and one of them was wasted.
                b) No query may be "${targetPage.keyword}" or a close variant.
                   That is the service page's search — a post chasing it
                   competes with the page these posts exist to promote.
              Long-tail is the point: "water heater popping noise at night"
              beats "water heater noise" — but there IS a floor. Do not stack
              qualifiers until nobody could plausibly type it. "water heater
              popping after a long shower in Leander" is not a search, it is a
              sentence. Two qualifiers is usually the limit.

              And word count is not volume. "water heater diagnosis leander"
              is five words that nobody types. Ask yourself whether a real
              person, mid-problem, would enter those exact words — if not, it
              is not a target query however well-formed it looks.
  linkPhrase  how ANOTHER post would refer to this one mid-sentence. A short
              noun phrase, 3-7 words, that reads naturally inside someone
              else's sentence — not the title. For "Repair or replace at the
              ten-year mark" it might be "whether a ten-year-old tank is worth
              repairing".
  angle       which angle above it uses
  why         one sentence: what the reader gets, and why they would be
              searching for it at that moment

VARY THE TITLES
  Across the ${count} topics, no more than two may begin with the same word,
  and no more than two may be questions.

  THE TOWN NAME BELONGS IN AT MOST TWO TITLES. Appending "in ${business.town}"
  to every headline is the clearest tell of generated content there is. The
  location does its work in the body, the meta description and the target
  query — it does not need to be in the headline to rank. Mix the constructions: a symptom
  stated flatly, a number, a comparison, a claim. A year of posts that all
  begin "Why Your..." reads as machine output no matter how good each one is.

Return JSON and nothing else:
{ "topics": [ { "topic": "...", "targetQuery": "...", "linkPhrase": "...", "angle": "...", "why": "..." } ] }`;
}

/**
 * @param {object} ctx   { business, targetPage }
 * @param {object} opts  { count, avoid, stub, client, model, effort, verbosity }
 */
async function suggestTopics(ctx, opts = {}) {
  const count = opts.count || 6;

  if (opts.stub) return stubTopics(ctx, count);

  const openai = getClient(opts);

  const response = await openai.responses.create({
    model: opts.model || 'gpt-5.6-terra',
    input: buildPrompt({ ...ctx, count, avoid: opts.avoid || [] }),
    // Choosing topics IS a reasoning problem — unlike writing prose, where the
    // model is mostly executing. Worth more effort here than in writePost.
    reasoning: { effort: opts.effort || 'medium' },
    text: { verbosity: opts.verbosity || 'low' },
  });

  const { parseJson } = require('./writePost');
  const parsed = parseJson(response.output_text, 'topic suggestions');

  if (!parsed || !Array.isArray(parsed.topics)) {
    throw new Error('topic suggestions: model returned no topics array');
  }

  return parsed.topics;
}

function stubTopics(ctx, count) {
  // These pass checkTopicSet(): six distinct angles, no repeated opening word,
  // only two interrogative titles, every query 3-7 words, every linkPhrase
  // short enough to sit mid-sentence. The stub is an example of the shape as
  // much as it is test data.
  const base = [
    { topic: 'Sediment is what makes a water heater pop',            targetQuery: 'water heater popping sound',            linkPhrase: 'that popping sound from the tank', angle: 'symptom',     why: 'Water boiling under a sediment layer — the noise sends people searching before anything fails.' },
    { topic: 'A ten-year-old tank is often still worth repairing',   targetQuery: 'repairing an old water heater',          linkPhrase: 'what a repair can still fix',     angle: 'decision',    why: 'They assume age rules out repair. Often it does not, and that is the decision they are stuck on.' },
    { topic: 'How long a water heater repair actually takes',        targetQuery: 'how long does water heater repair take', linkPhrase: 'how long a repair actually takes', angle: 'expectation', why: 'The unanswered question that stops people booking the appointment.' },
    { topic: 'Two repair quotes, three hundred dollars apart',       targetQuery: 'why water heater repair quotes differ',  linkPhrase: 'why repair quotes vary so much',  angle: 'cost',        why: 'They have two numbers in front of them and no way to compare them.' },
    { topic: 'What Central Texas hard water does to a tank',         targetQuery: 'hard water damage water heater tank',    linkPhrase: 'what hard water does to a tank',  angle: 'local',       why: 'A real local cause they can check against their own water.' },
    { topic: 'Turning the thermostat up will not get you more hot water', targetQuery: 'turning up water heater thermostat', linkPhrase: 'turning the thermostat up',      angle: 'mistake',     why: 'The first thing everyone tries, and it hides the real fault.' },
  ];

  return base.slice(0, count);
}

module.exports = { suggestTopics, buildPrompt, ANGLES, BANNED };