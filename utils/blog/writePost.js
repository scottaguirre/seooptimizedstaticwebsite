// blog-engine-preview/writePost.js
//
// The one part that calls a model. Everything else in this folder is pure.
//
// The prompt is the product. When this moves to your server it moves alone —
// planCampaign.js, anchors.js and links.js go to the plugin, this stays behind
// the API where you can change it without shipping a plugin update.
//
// MATCHES THE REST OF THE APP
//
// responses.create, not chat.completions.create: `input`, `reasoning` and
// `text` belong to the Responses API, and the result is read from
// output_text. Same shape buildPricingTable() and generateFaqAnswers() use.

const path = require('path');

const APP = path.join(__dirname, '..');

/** The app's lazily-built OpenAI client. */
function getClient(opts) {
  if (opts.client) return opts.client;

  let mod;
  try {
    mod = require(path.join(APP, 'openaiClient'));
  } catch (err) {
    throw new Error(
      `Could not load utils/openaiClient (${err.message}).\n` +
      `Run with --stub to exercise the planner and the link machinery without a model.`
    );
  }

  if (typeof mod.getOpenAI !== 'function') {
    throw new Error('utils/openaiClient does not export getOpenAI()');
  }
  return mod.getOpenAI();
}

/**
 * Tolerant JSON parse, reusing the app's repairer when it's there.
 *
 * The model occasionally emits an unescaped quote inside a value, which kills
 * JSON.parse. buildPricingTable already hit this; no reason to hit it twice.
 */
function parseJson(raw, label) {
  const cleaned = String(raw)
    .replace(/```json|```/g, '')
    .replace(/^[^{]*\{/, '{')
    .replace(/\}[^}]*$/, '}')
    .trim();

  try {
    const { parseModelJson } = require(path.join(APP, 'parseModelJson'));
    const res = parseModelJson(cleaned, { expect: 'object', label });
    if (res && res.ok) return res.data;
  } catch (_) {
    // Not available, or it doesn't handle objects — fall through.
  }

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const e = new Error(`${label}: model did not return parseable JSON — ${err.message}`);
    e.raw = raw;
    throw e;
  }
}

const SYSTEM = `You are a working tradesperson writing for your own customers.

WHO IS READING
Someone with a problem, right now, at home, looking at something that is not
working. Not a browser. Not a student. They want to know what is happening and
what it will take to fix it.

WHAT MAKES A POST WORTH PUBLISHING
Concrete detail. A part name, a temperature, a noise, a number of years, a
price range, a thing they can go and check in the next five minutes. A
paragraph that would still be true for a different trade in a different town is
a paragraph that should not exist.

ANSWER FIRST
Say the useful thing in the opening paragraph. Do not build up to it, do not
define the topic, do not explain why the topic matters. They already know why
it matters — that is why they are reading.

FORBIDDEN OPENINGS
Never begin with "In today's world", "When it comes to", "Whether you",
"As a homeowner", "First and foremost", or any definition of the subject.

FORBIDDEN PHRASES anywhere in the post
- it is important to note / it is worth noting / needless to say
- that being said / at the end of the day / in conclusion / to sum up
- rest assured / peace of mind / we have got you covered
- cutting-edge / state-of-the-art / latest advancements / modern techniques
- innovative solutions / top-notch / seamless / unparalleled / game-changer
- experts agree / studies show / industry-leading
- contact us today / give us a call today / do not hesitate to

NEVER CLAIM
- Building codes, permits, regulations, ordinances, inspection requirements.
  You do not know the local rules and the business is the one held to what you
  write. If a permit is genuinely relevant, say "your plumber will tell you
  whether this needs a permit" and nothing more.
- Awards, ratings, years in business, certifications, licences, insurance,
  warranties, guarantees, or number of customers. None. Not one.
- Any price you were not given. Ranges you were given may be quoted as ranges.

NO SUMMARY SECTION
Do not end with a recap, a conclusion, or a paragraph beginning "Ultimately".
Stop when you have said the last useful thing.

VOICE
Plain sentences. Two to four per paragraph. Write the way you would explain it
standing in someone's kitchen — direct, unhurried, no selling.`;

function buildPrompt(slot, ctx) {
  const { business, targetPage } = ctx;
  const links = [];

  links.push(
    `- Use this phrase EXACTLY ONCE, verbatim, wrapped like this: {{money}}${slot.money.anchor}{{/money}}\n` +
    `  It becomes a link to the ${targetPage.title} page. Build a sentence where that phrase belongs.`
  );

  if (slot.prevAnchor) {
    links.push(
      `- Use this phrase EXACTLY ONCE, verbatim, wrapped like this: {{prev}}${slot.prevAnchor}{{/prev}}\n` +
      `  It refers back to an earlier post about "${slot.prevTitle}".`
    );
  }

  if (slot.nextAnchor) {
    links.push(
      `- Use this phrase EXACTLY ONCE, verbatim, wrapped like this: {{next}}${slot.nextAnchor}{{/next}}\n` +
      `  It refers to "${slot.nextTopic}". Mention it as a passing aside. Do NOT tell the reader to go\n` +
      `  and read it, and do not call it an article or a post — that piece may not exist yet.`
    );
  }

  return `${SYSTEM}

Write one blog post.

BUSINESS
  Name:     ${business.name}
  Trade:    ${business.trade}
  Town:     ${business.town}
  Services: ${business.services.join(', ')}

TOPIC
  ${slot.topic}
${slot.targetQuery ? `
THE SEARCH THIS POST MUST SATISFY
  "${slot.targetQuery}"
  Answer that question directly and completely. Someone who typed those words
  should not need to open another result. Do not repeat the phrase mechanically
  — say the thing it is asking about.
` : ''}
LENGTH
  700-900 words, in 3-5 sections.

REQUIRED CONCRETENESS
  At least six specific details across the post — part names, temperatures,
  pressures, ages, timescales, measurements or dollar ranges. Count them
  before you finish. A post without them is a failed post.

  At least one detail must be checkable by the reader without tools, in their
  own home, today.

LINKS — mandatory, and the phrases must appear verbatim inside the wrappers shown:
${links.join('\n')}

Add no other links. Never use "click here", "read more" or "learn more" as link text.

Return JSON and nothing else, in this exact shape:
{
  "title": "the post's headline",
  "metaDescription": "under 155 characters, not a restatement of the title",
  "sections": [
    { "heading": null, "paragraphs": ["opening paragraph", "..."] },
    { "heading": "A subheading", "paragraphs": ["...", "..."] }
  ]
}

The first section's heading must be null — it is the opening, before any subheading.
Paragraphs are plain text. The only markup allowed is the {{...}} link wrappers.`;
}

/**
 * @param {object} slot  a plan slot plus prevTitle/prevAnchor/nextTopic/nextAnchor
 * @param {object} ctx   { business, targetPage }
 * @param {object} opts  { stub, client, model, effort, verbosity }
 */
async function writePost(slot, ctx, opts = {}) {
  if (opts.stub) return stubPost(slot, ctx);

  const openai = getClient(opts);

  const response = await openai.responses.create({
    // Same model the rest of the app uses. Override with --model=... when
    // comparing output quality.
    model: opts.model || 'gpt-5.6-terra',
    input: buildPrompt(slot, ctx),

    // These two are the FIRST knobs to turn if the writing disappoints.
    // Reasoning tokens are billed as output, so 'none' is the cheap baseline
    // and 'low' is usually the better trade for prose. --effort and
    // --verbosity change them without editing this file.
    reasoning: { effort: opts.effort || 'low' },
    text: { verbosity: opts.verbosity || 'high' },
  });

  if (response.usage) {
    console.log(`  usage ${slot.id}:`, JSON.stringify(response.usage));
  }

  const post = parseJson(response.output_text, `post ${slot.id}`);

  if (!post || !Array.isArray(post.sections) || !post.sections.length) {
    const e = new Error(`post ${slot.id}: model returned no sections`);
    e.raw = response.output_text;
    throw e;
  }

  return post;
}

/**
 * A believable shape with every token present, so the planner, the token
 * substitution and the pending-link swap can be exercised offline.
 * Deliberately dull — this proves the PLUMBING, not the writing.
 */
function stubPost(slot, ctx) {
  const sections = [
    {
      heading: null,
      paragraphs: [
        `${slot.topic}. This opening stands in for real writing so the link machinery can be tested without spending a model call.`,
        `Most homeowners in ${ctx.business.town} only think about this once something has already gone wrong, which is usually the most expensive moment to start thinking about it.`,
      ],
    },
    {
      heading: 'What usually goes wrong',
      paragraphs: [
        `Sediment, pressure and age account for most of it. Past a certain point a {{money}}${slot.money.anchor}{{/money}} is the practical next step.`,
      ],
    },
  ];

  if (slot.prevAnchor) {
    sections.push({
      heading: 'Before you call anyone',
      paragraphs: [
        `We went through {{prev}}${slot.prevAnchor}{{/prev}} previously, and the same checks apply here.`,
      ],
    });
  }

  if (slot.nextAnchor) {
    sections.push({
      heading: 'Worth knowing',
      paragraphs: [
        `This is often the point where people start weighing up {{next}}${slot.nextAnchor}{{/next}} instead of another repair.`,
      ],
    });
  }

  return {
    title: slot.title || slot.topic,
    metaDescription: `${slot.topic} — practical guidance from ${ctx.business.name} in ${ctx.business.town}.`,
    sections,
  };
}

module.exports = { writePost, buildPrompt, parseJson, SYSTEM };