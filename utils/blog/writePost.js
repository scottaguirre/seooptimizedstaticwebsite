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

/**
 * The same brief, for a blog with no business behind it.
 *
 * A SECOND PROMPT, NOT AN EDIT TO THE FIRST. The trade prompt is tuned, it is
 * shipping, and every post on every customer's site comes out of it. Softening
 * it to cover both cases would make it worse at the job it already does well —
 * "you are a tradesperson, unless you are not" is not an instruction.
 *
 * WHAT IS KEPT, because it is why the trade prompt produces publishable work:
 * answer first, concrete detail, the forbidden openings and phrases, no recap
 * ending, and the refusal to claim anything unsupported.
 *
 * WHAT CHANGES, and each line below is here because the trade version does
 * active harm on a content blog:
 *
 *   THE IDENTITY. "You are a working tradesperson writing for your own
 *   customers" makes the model invent a business it does not have — "in
 *   fifteen years on the job", "every client who walks through the door".
 *   None of it is true, and a pillar campaign has no business block to
 *   contradict it, so there is nothing to anchor the invention.
 *
 *   THE READER. "Someone with a problem, right now ... Not a student" is an
 *   emergency. Someone reading a hub article at nine in the evening is
 *   browsing and learning, and urgency in that article reads as panic.
 *
 *   THE LOCALITY RULE. "A paragraph that would still be true for a different
 *   trade in a different town should not exist" is correct for a Leander
 *   plumber and backwards here: a good article about training a dog SHOULD be
 *   true in every town. Left in, it tells the model to delete its best
 *   paragraphs or to fake a region.
 *
 * The forbidden-claims list is LONGER than the trade one, not shorter.
 * Removing the business removed the thing that was keeping the model honest.
 */
const SYSTEM_BLOG = `You are writing one article for a blog about a single subject.

WHO IS READING
Someone who typed a question and wants it answered properly. They have time.
They are learning, not fixing an emergency, and they may well still be doing
this in six months. Write for that person, not for someone standing over a
problem with a phone in their hand.

WHAT MAKES A POST WORTH PUBLISHING
Concrete detail. A timescale, a count, a measurement, a cost, a thing they can
try this evening and see the result of. A paragraph that could open an article
on any subject at all is a paragraph that should not exist.

ANSWER FIRST
Say the useful thing in the opening paragraph. Do not build up to it, do not
define the topic, do not explain why the topic matters. They already know why
it matters — that is why they are reading.

FORBIDDEN OPENINGS
Never begin with "In today's world", "When it comes to", "Whether you",
"As a dog owner" or any equivalent, "First and foremost", or any definition of
the subject.

FORBIDDEN PHRASES anywhere in the post
- it is important to note / it is worth noting / needless to say
- that being said / at the end of the day / in conclusion / to sum up
- rest assured / peace of mind / we have got you covered
- cutting-edge / state-of-the-art / latest advancements / modern techniques
- innovative solutions / top-notch / seamless / unparalleled / game-changer
- experts agree / studies show / industry-leading
- contact us today / give us a call today / do not hesitate to

NEVER CLAIM
- EXPERIENCE OF YOUR OWN. You have no clients, no customers, no years in the
  field, no anecdotes and no practice. Never write "in my experience", "we
  see this all the time", "I have found" or "in fifteen years". There is no
  "we" and there is no "I".
- A PLACE. Do not put the reader anywhere. No town, no region, no country, no
  climate, no "around here". The article is read everywhere.
- Laws, regulations, licensing, permits or official requirements. You do not
  know the reader's country, let alone their county.
- Statistics, studies, surveys, percentages or research findings you were not
  given. If you did not receive a number, you do not have one.
- A business, product, brand, tool or person as recommended, endorsed or
  tested. Nothing here has been tried. A price range may be given as a range
  and nothing more.

NO SUMMARY SECTION
Do not end with a recap, a conclusion, or a paragraph beginning "Ultimately".
Stop when you have said the last useful thing.

VOICE
Plain sentences. Two to four per paragraph. Write the way you would explain it
to someone who asked you properly — direct, unhurried, nothing to sell.`;

/**
 * Which brief this post is written to.
 *
 * READ FROM ctx.isPillar, which buildLinkPlan sets from campaign.isPillar in
 * the same breath as ctx.targetPage — three lines apart, from one value, so
 * they cannot drift. It is deliberately NOT inferred from targetPage being
 * null: "there is no money page" and "this is not a business" are different
 * claims that happen to coincide today, and the day they stop coinciding the
 * inference becomes a silent wrong voice on every post.
 */
function systemFor(ctx) {
  return (ctx && ctx.isPillar) ? SYSTEM_BLOG : SYSTEM;
}

function buildPrompt(slot, ctx) {
  const { business, targetPage } = ctx;
  const links = [];

  /* WHERE EACH LINK GOES, not only that it appears.
   *
   * This used to say "EXACTLY ONCE, verbatim" and nothing about placement, so
   * all three routinely landed in the same paragraph. That is not the model
   * misbehaving — nobody had asked for anything else — and three links stacked
   * in one paragraph is the loudest "this was written by a machine" signal on
   * the page. A reader does not count links; they feel the clump.
   *
   * Spread across the post it reads as a writer referring to things as they
   * come up, which is what it is meant to be. qualityCheck.js verifies this
   * rather than trusting it, because an instruction with no check behind it is
   * a hope.
   *
   * BEHIND AN `if`, LIKE THE TWO BELOW IT, AND IT WAS NOT.
   *
   * This push was unconditional while prev and next were both guarded, which
   * went unnoticed for as long as every campaign had a money page. A pillar
   * campaign has none, and an unguarded `slot.money.anchor` is not a worse
   * post — it is `TypeError: Cannot read properties of undefined`, thrown
   * before the model is called, for every slot.
   *
   * The checker was already guarded (`if (slot.money && …)`, qualityCheck.js)
   * and the WRITER was not, which is the reverse of what the comments suggest:
   * linkPlan.js says the checker verifies the anchor "verbatim", so the strict
   * file looked like the fragile one. A COMMENT DESCRIBING A STRICTNESS IS NOT
   * THE SAME AS THE CODE BEING STRICT, and the file that said nothing on the
   * subject was the one that would have crashed.
   *
   * PLACEMENT IS A POSITION, NOT A TOKEN NAME — and it was a token name.
   *
   * The three instructions below were written when every post carried three
   * links: money opened, prev sat in the middle, next closed. Take the money
   * link away, as a pillar campaign does, and the two that remain still ask for
   * "a middle section" and "the final section". BOTH LAND IN THE BACK HALF.
   * On a four-section post that is sections 3 and 4 — the opening has nothing
   * at all, and a reader who stops two thirds of the way through has been
   * offered nowhere to go.
   *
   * Nothing caught it. The crowding checks ask whether two links SHARE a
   * paragraph or a section; these were in different sections, politely, at the
   * bottom. The only placement assertion was `spread.placed.money.section !==
   * 0`, and a pillar post has no money link for it to look at. A RULE WRITTEN
   * PER LINK CANNOT SEE WHAT THE SET OF LINKS LOOKS LIKE.
   *
   * So for a pillar post the placement is assigned by ORDER: whichever link
   * the post has first opens it, the second sits around the third paragraph.
   * The ordinary three-link path is left byte-for-byte as it was — it is
   * correct, it is shipping, and it is the one every customer's posts use. */
  const isPillar = !!(ctx && ctx.isPillar);

  let positioned = 0;

  /**
   * The placement line for the next link pushed.
   *
   * @param {string} ordinary what a three-link post says, unchanged
   */
  function placement(ordinary) {
    if (!isPillar) return ordinary;

    positioned += 1;

    /* Counted in push order, which is the order the `if`s below run: money
     * (never, here), then prev, then next. A pillar post has at most two, so
     * there is no third case — and if one is ever added it takes the middle
     * instruction, which is the safe end to land on. */
    return positioned === 1
      ? '  PUT IT IN THE OPENING SECTION — inside the first or second paragraph, before any subheading.'
      : '  PUT IT AROUND THE THIRD PARAGRAPH, in a middle section. NOT the final section.';
  }

  if (slot.money) {
    links.push(
      `- Use this phrase EXACTLY ONCE, verbatim, wrapped like this: {{money}}${slot.money.anchor}{{/money}}\n` +
      `  It becomes a link to the ${targetPage.title} page. Build a sentence where that phrase belongs.\n` +
      placement('  PUT IT IN THE OPENING SECTION — the one before any subheading.')
    );
  }

  if (slot.prevAnchor) {
    links.push(
      `- Use this phrase EXACTLY ONCE, verbatim, wrapped like this: {{prev}}${slot.prevAnchor}{{/prev}}\n` +
      `  It refers back to an earlier post about "${slot.prevTitle}".\n` +
      placement('  PUT IT IN A MIDDLE SECTION — not the opening, not the last one.')
    );
  }

  if (slot.nextAnchor) {
    links.push(
      `- Use this phrase EXACTLY ONCE, verbatim, wrapped like this: {{next}}${slot.nextAnchor}{{/next}}\n` +
      `  It refers to "${slot.nextTopic}". Mention it as a passing aside. Do NOT tell the reader to go\n` +
      `  and read it, and do not call it an article or a post — that piece may not exist yet.\n` +
      placement('  PUT IT IN THE FINAL SECTION.')
    );
  }

  /* OMITTED RATHER THAN RENDERED EMPTY.
   *
   * A pillar campaign has no business behind it, and every field here would
   * print as a blank. Four labels with nothing after them is worse than no
   * block at all: the model reads it as a business whose name and town it is
   * supposed to know and cannot see, and invents one. AN EMPTY VALUE IS A
   * CLAIM THAT THE VALUE EXISTS. */
  const hasBusiness = !!(business && (business.name || business.trade || business.town));

  const businessBlock = hasBusiness ? `
BUSINESS
  Name:     ${business.name}
  Trade:    ${business.trade}
  Town:     ${business.town}
  Services: ${(business.services || []).join(', ')}
` : '';

  return `${systemFor(ctx)}

Write one blog post.
${businessBlock}
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
  1000-1300 words, in 4-6 sections.

REQUIRED CONCRETENESS
  At least six specific details across the post — part names, temperatures,
  pressures, ages, timescales, measurements or dollar ranges. Count them
  before you finish. A post without them is a failed post.

  At least one detail must be checkable by the reader without tools, in their
  own home, today.

LINKS — mandatory, and the phrases must appear verbatim inside the wrappers shown:
${links.join('\n')}

Add no other links. Never use "click here", "read more" or "learn more" as link text.

NO TWO OF THOSE PHRASES MAY SHARE A PARAGRAPH, and no two may share a section.
Three links in one paragraph is the clearest sign a post was not written by a
person. Spread them as instructed above.

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
  const business = (ctx && ctx.business) || {};

  /* A pillar campaign has no town, so the sentence that names one has to have
   * a version that does not. Interpolating an empty string reads as a bug in
   * the stub rather than as an absent value, and the whole point of this file
   * is that a failure in it should be unmistakably about the plumbing. */
  const opening = business.town
    ? `Most homeowners in ${business.town} only think about this once something has already gone wrong, which is usually the most expensive moment to start thinking about it.`
    : 'Most people only think about this once something has already gone wrong, which is usually the most expensive moment to start thinking about it.';

  const sections = [
    {
      heading: null,
      paragraphs: [
        `${slot.topic}. This opening stands in for real writing so the link machinery can be tested without spending a model call.`,
        opening,
      ],
    },
  ];

  /* The money section, when there is a money page. Same guard as buildPrompt
   * and for the same reason: the stub is what the offline harness and the
   * tests run, so an unguarded read here fails the suites rather than
   * production — which is a better place to fail, but still a failure that
   * says nothing about the feature under test. */
  if (slot.money) {
    sections.push({
      heading: 'What usually goes wrong',
      paragraphs: [
        `Sediment, pressure and age account for most of it. Past a certain point a {{money}}${slot.money.anchor}{{/money}} is the practical next step.`,
      ],
    });
  } else {
    sections.push({
      heading: 'What usually goes wrong',
      paragraphs: [
        'Sediment, pressure and age account for most of it, and the order you check them in is what saves the afternoon.',
      ],
    });
  }

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

  const credit = (business.name && business.town)
    ? ` — practical guidance from ${business.name} in ${business.town}.`
    : ' — practical guidance, start to finish.';

  return {
    title: slot.title || slot.topic,
    metaDescription: `${slot.topic}${credit}`,
    sections,
  };
}

/* SYSTEM_BLOG and systemFor are exported FOR THE TESTS, and that is the honest
 * reason. Which brief a post was written to is not visible in the finished
 * post — a blog article and a trade article both come back as title, meta and
 * sections — so the only way to assert the right one was chosen is to ask. */
module.exports = { writePost, buildPrompt, parseJson, SYSTEM, SYSTEM_BLOG, systemFor };