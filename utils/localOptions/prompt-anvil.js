// utils/localOptions/prompt-anvil.js
//
// Anvil's voice.
//
// WHY — Edwin, 31 October, asking for a third structure: its own prompts,
// same sections. The rule Beacon set still holds.
//
// WHAT THIS FILE IS NOT
//
// It is not a copy of prompt.js and it is not a copy of prompt-beacon.js.
// Everything in prompt.js which is not voice was paid for in measured runs:
// the no-invented-figures rule, the concrete-noun rule, the spelling rule
// that had to be STATED rather than derived after a Texas site came back
// saying "odour" and "grey water", the heading brief that had to stop
// describing the heading it wanted because a description is a slower
// dictation, and the five section jobs.
//
//     A THIRD PROMPT FILE WOULD COPY ALL OF THAT, AND A COPY DRIFTS.
//     THE NEXT FIX LANDS IN ONE OF THE THREE, AND NOBODY EVER FINDS OUT
//     FROM THE TWO THAT MISSED IT.
//
// So this is a VOICE handed to the same builder. The sections are the same
// sections and the rules are the same rules, in one place, for all three.
//
// WHAT ANVIL ACTUALLY CHANGES
//
//   length    660-840 words a page. Ledger runs 780-1000, Beacon 520-700.
//   register  plain and practical. Says what happens, in order, without
//             either Ledger's unhurried measure or Beacon's clipped one.
//   weight    carried by the verbs. Ledger leans on its headings' formality
//             and Beacon on headings carrying the scan; this leans on
//             sentences that describe an action rather than a quality.
//
// WHY THE MIDDLE LENGTH IS NOT A COMPROMISE. Anvil sets prose at a full 46rem
// measure with nothing beside it and the hours band underneath rather than
// alongside — so a paragraph has the width Ledger's has, and the page has no
// sidebar to fill. Beacon's brevity exists because its column is narrower;
// Ledger's length exists because its two-column list needs a page under it.
// Anvil has neither constraint, and 660-840 is what the layout actually wants
// rather than a number picked between the other two.
//
//   node test-local-options-anvil.js

'use strict';

const {
  SECTIONS,
  STANCES,
  stanceFor,
  placeOf,
  spellingFor,
  servicePagePrompt: buildServicePage,
  homePagePrompt: buildHomePage,
} = require('./prompt');

/**
 * Anvil's length.
 *
 * NOT A GATE, AN INSTRUCTION. Nothing in Local Website Options rejects a page
 * for being long — see the note on WORDS in prompt.js about the runner's LONG
 * flag meaning "longer than this trade has produced before", not "wrong".
 * These numbers steer; they do not refuse.
 */
const WORDS = { min: 660, max: 840 };

/**
 * The lines added to the system prompt, and nothing else is touched.
 *
 * WRITTEN AS RULES ABOUT SENTENCES, NOT AS AN ADJECTIVE. "Write plainly" is
 * the kind of instruction that competes with twenty others and loses — the
 * same failure the spelling line had before it was made explicit. A rule
 * about where the verb goes is checkable by the thing reading it.
 *
 * NO EXAMPLE SENTENCES IN HERE. An example in a prompt comes back in the
 * output; that is the lesson the heading brief in prompt.js records, and it
 * applies to voice as much as to headings.
 *
 * THE FIRST RULE IS THE ONE THAT MAKES THIS VOICE DIFFERENT FROM THE OTHER
 * TWO. Ledger and Beacon both describe a trade in terms of what it IS.
 * Anvil describes it in terms of what someone DOES, which is a different
 * paragraph about the same facts rather than a shorter or longer one.
 */
const LINES = [
  'HOW THIS PAGE IS WRITTEN — these are in addition to the rules above, '
  + 'and they do not replace any of them:',
  '',
  '- PREFER A VERB TO AN ADJECTIVE. Describe what is done, in what order, '
  + 'rather than what something is like. A sentence whose main verb is "is" '
  + 'or "are" can almost always be rewritten around the action in it.',
  '- Write in the order the work happens. If two things follow one another, '
  + 'say them in that order rather than explaining the second first.',
  '- No sentence begins with "There is", "There are", "It is important" or '
  + '"When it comes to".',
  '- Name the thing rather than the category. A part, a room, a tool or a '
  + 'material, not "the system", "the issue" or "the solution".',
  '- Paragraphs of three or four sentences. Vary their length; do not write '
  + 'four of the same shape in a row.',
  '',
];

/**
 * The home page's own numbers.
 *
 * SEPARATE FROM `WORDS` BECAUSE THE HOME PAGE IS BUILT DIFFERENTLY. The
 * service page is given a LENGTH line in its system prompt; the home page's
 * lengths live in its JSON template, on the sub line and on the three about
 * paragraphs.
 *
 * THIS WAS THE BUG BEACON SHIPPED. Its first version set only the
 * service-page budget, so its home page came out exactly as long as Ledger's
 * — caught by putting the two built pages side by side, not by any test.
 * A setting read in two places has to be passed to both.
 */
const HOME = { sub: [16, 26], about: [32, 52] };

/**
 * What Anvil's three home-page paragraphs are about.
 *
 * THREE SETS OF SUBJECTS NOW, AND THEY HAVE TO STAY THREE.
 *
 *   Ledger   where we are        what we do         how a visit starts
 *   Beacon   what brings you     where it happens   repair or replace
 *   Anvil    the first call      the buildings      what finished looks like
 *
 * WHY SUBJECTS AND NOT WORDINGS — 30 October. Edwin built one site in each of
 * the first two structures and set the home pages beside each other. Same
 * three subjects, same order, and both third paragraphs opened "A visit
 * starts with", because Ledger's brief says "How a visit starts".
 *
 *     A BRIEF THAT DESCRIBES THE PARAGRAPH IN WORDS GETS THOSE WORDS BACK.
 *     THE STYLE RULES COULD NOT MOVE IT: THEY GOVERN HOW A SENTENCE IS
 *     BUILT, NOT WHAT IT IS ABOUT.
 *
 * WHAT THEY CANNOT DO. The model is given the business name, the trade, the
 * address, the towns and six service names — nothing else. Different briefs
 * change the ANGLE; they cannot invent facts, and three plumbing sites will
 * always share a lot because the input does. Anything needing a team size, a
 * number of vans or a year founded is left out on purpose: the
 * no-invented-figures rule would refuse it, and a brief that asks for
 * something the rules forbid produces a worse paragraph than one that never
 * asked.
 *
 * AND NONE OF THEM EXPLAINS A SERVICE. The system prompt already forbids it —
 * each of the six has its own page, and a front page teaching water heaters
 * competes with the page that should rank for them.
 *
 * NOT ONE OF THE THREE ASKS FOR A LIST. Beacon allows exactly one, for
 * symptoms. Anvil allows none, because all three of these subjects are
 * sequences or judgements, and a list of either reads as a specification.
 * The first draft of Beacon's three asked for enumeration three times and
 * got back three lists in a row:
 *
 *     THREE BRIEFS THAT ASK FOR A LIST PRODUCE A LIST OF LISTS.
 *     THE SUBJECT WAS NEVER THE PROBLEM; THE SHAPE WAS.
 */
const HOME_JOBS = [
  /* A SEQUENCE, WHICH IS THE ONE SHAPE A LIST CANNOT TAKE. It also suits the
   * verb-first rule above better than any other subject on the page: every
   * sentence in it is something somebody does. */
  'What happens when somebody rings. What they are asked, what can usually '
  + 'be worked out over the phone, and what has to be seen. Write it in the '
  + 'order it happens. Do not promise a response time, a callback window or '
  + 'a price.',

  /* PLACE-ANCHORED WITHOUT BEING A TOUR OF THE TOWNS. The towns are given to
   * the model and every structure is tempted to list them; this asks for the
   * BUILDINGS instead, which is a fact about the area that is not a list of
   * its names.
   *
   * AND IT IS THE GENERAL, NOT A JOB THAT HAPPENED. Beacon's second brief
   * said "what was found, and what happened next" — past tense, which is an
   * invitation to invent a visit, a customer and an outcome. Nothing in the
   * rules forbids a story in so many words, because they forbid invented
   * FIGURES; a fabricated case study slips between them and reads as a
   * reference nobody can check.
   *
   *     THE RULE SAYS DO NOT INVENT A NUMBER.
   *     A NARRATED JOB IS AN INVENTED EVENT, WHICH IS WORSE. */
  'The kinds of building this trade works in around here — houses, shops, '
  + 'rentals, older places and newer ones — and what that changes about the '
  + 'work. IN THE GENERAL: never a particular address, a named customer or a '
  + 'job that took place. Do not state the age of the housing stock as a '
  + 'figure or a decade. Name the towns covered once, in the last sentence, '
  + 'without making them the subject.',

  /* A JUDGEMENT, FOLLOWED THROUGH. "What finished looks like" is the one
   * subject on a trade home page that is nearly always missing, and it
   * cannot be enumerated without becoming a checklist of promises.
   *
   * THE GUARD ON THIS ONE IS THE TIGHTEST OF THE THREE. "How we leave a
   * job" is one word away from a warranty, and a static site that implies a
   * guarantee the owner never offered is a worse problem than a dull
   * paragraph. */
  'What a finished job looks like before the van leaves — what gets tested, '
  + 'what gets tidied, and what the customer is shown or told. Do not '
  + 'promise a guarantee, a warranty, a satisfaction policy or a free '
  + 'anything, and do not say the work is guaranteed.',
];

/**
 * The About heading's job.
 *
 * LEDGER SAYS "a heading that says you are a local <trade> company in <city,
 * state>", and gets back "We Are a Local Plumbing Company in Chicago, IL" —
 * the brief, with capitals. Dictation again.
 *
 * THIS ASKS FOR A PROPERTY, NOT A SENTENCE, which is the shape the service
 * pages' heading brief had to be rewritten into after five cost headings came
 * back as five restatements of the brief that asked for them.
 *
 * AND IT ASKS FOR A VERB, which is what keeps it out of Beacon's territory.
 * Beacon forbids We/Your/About and names the trade and the town; told the
 * same thing, Anvil would produce the same headings. A heading built around
 * something being DONE is a different heading about the same two facts.
 */
const ABOUT_HEADING = 'a heading for this section. It MUST contain a verb '
  + 'describing work being done, and it MUST name the town. It MUST NOT '
  + 'begin with We, Your, Our or About, and it must not be the business name '
  + 'on its own';

/** Anvil's voice, as prompt.js takes it. */
const ANVIL_VOICE = {
  key: 'anvil',
  words: WORDS,
  lines: LINES,
  home: HOME,
  homeJobs: HOME_JOBS,
  aboutHeading: ABOUT_HEADING,

  /* ANVIL DOES NOT RECITE THE SIX SERVICES, for Beacon's reason.
   *
   * The shared instruction "Name the kinds of work in a sentence" is
   * Ledger's second brief said twice. On Ledger it is harmless; on a
   * structure whose second paragraph is about buildings rather than about
   * services, it is an extra job nobody asked for. Beacon's built page did
   * both — its own brief, then all six services listed after it, 44 words
   * against a 25-40 budget.
   *
   * The six are still GIVEN to the model — the ladder below names them, and
   * a page that contradicted them would be worse. It is just not asked to
   * repeat them in prose. */
  namesServices: false,

  /* THE TWO DIVIDERS. Anvil's page is dark throughout and its bands differ
   * from one another only by a hairline, so it needs the breathing space
   * more than Beacon did, not less.
   *
   * WRITTEN PER SITE RATHER THAN FIXED. A fixed pair would be identical on
   * every site under one apex domain — and to Google a subdirectory is the
   * same site, so that is one page's worth of boilerplate repeated across
   * all of them, not a coincidence between strangers.
   *
   * THE REGISTER EDWIN ASKED FOR IS THE ONE THE RULES BAN. "We are here for
   * you" is the same family as "peace of mind" and "your trusted partner",
   * which the system prompt refuses by name. So the briefs aim at what he
   * actually wants — a warm line that breaks the page — and get there by
   * demanding a THING rather than a feeling.
   *
   *     A LINE THAT NAMES A PHONE, A VAN OR A STREET IS WARM.
   *     A LINE THAT NAMES A FEELING IS FILLER.
   *
   * ANVIL'S TWO ASK FOR DIFFERENT THINGS FROM BEACON'S, which both ask for
   * "a short, warm line". Identical briefs on two structures produce
   * identical lines, and these appear on the home page where two sites are
   * most likely to be compared.
   *
   * NO EXAMPLE LINE IN EITHER. An example in a prompt comes back in the
   * output. */
  extras: [
    {
      key: 'firstBreak',
      brief: 'a short line addressed to the reader, six to ten words, built '
        + 'around something the business DOES rather than something it is. '
        + 'Plain and ordinary. No exclamation mark, no superlative, and no '
        + 'claim about being best, fastest, cheapest or guaranteed',
    },
    {
      key: 'secondBreak',
      brief: 'a second short line, six to ten words, about being nearby or '
        + 'easy to reach rather than about quality. It must say something '
        + 'different from the line above and must not repeat its main verb. '
        + 'No exclamation mark, no superlative, and no claim about being '
        + 'best, fastest, cheapest or guaranteed',
    },
  ],

  /* THE ONE PLACE THE MARKETING-REGISTER RULE IS LIFTED, AND IT HAS TO BE
   * SAID OUT LOUD.
   *
   * The system prompt refuses that register by name, and the dividers are
   * the one thing on the page that is MEANT to be a pleasantry. Without this
   * line the brief and the rules pull opposite ways, and two instructions in
   * opposite directions is how a page ends up with neither — which is a test
   * in Beacon's suite and is one here too.
   *
   *     AN EXCEPTION THAT IS NOT STATED IS NOT AN EXCEPTION.
   *     IT IS TWO RULES AND A COIN TOSS.
   *
   * THE FLOOR THAT STAYS: no superlative and no guarantee. "We strive to
   * provide quality service" is a pleasantry; "the best plumbers in Chicago"
   * is a claim nobody checked, and the no-invented-facts rule is not about
   * taste. */
  extrasNote: 'THE TWO DIVIDER LINES — firstBreak and secondBreak — ARE '
    + 'EXEMPT FROM THE NO-MARKETING-REGISTER RULE. They are meant to be '
    + 'ordinary things a local business says to a customer. Every other rule '
    + 'above still applies to them, in particular inventing nothing: no '
    + 'superlative, no best or fastest or cheapest, no guarantee, no number.',

  /* THE THIRD TITLE ANGLE, AND IT HAD TO BE A THIRD ONE.
   *
   *   Ledger   leads with the business name
   *   Beacon   leads with the kind of work
   *   Anvil    leads with the place
   *
   * Two structures leading with the same slot produce two titles of the same
   * shape with a different noun in it, which is what prompted the Beacon
   * rule on 30 October. A third doing it again would waste the slot.
   *
   * THE NAME IS STILL IN THERE — Edwin, 30 October: "it should always appear
   * in the title and meta description." The name goes last, which is where a
   * title with a pipe in it puts a brand anyway.
   *
   * EXACTLY AS IT WAS GIVEN. "The Austin Plumber" is the case that proves
   * this half is needed: told only to lead with the place, a model will
   * happily write "Austin Plumber" at the end — which is a different
   * company's name. */
  title: 'the <title>, under 60 characters if you can. Lead with the town '
    + 'and state, then the kind of work, then the business name last, '
    + 'exactly as it was given. Do not begin with the business name',

  /* AND THE DESCRIPTION IS WRITTEN AS AN INSTRUCTION, NOT A SUMMARY.
   *
   *   Ledger   lists the services
   *   Beacon   caps it at two kinds of work and writes it for somebody
   *            deciding who to ring
   *   Anvil    says what to do next
   *
   * Edwin's complaint on 30 October was that both descriptions were the six
   * services comma-listed and then the four towns: 160 characters of
   * keywords, truncated in a result anyway. Beacon's cap fixed the listing.
   * This goes further, because a description that ENDS in an action is the
   * one shape the other two cannot produce by accident. */
  meta: 'the meta description, 140-160 characters. Name the town and the '
    + 'state once, and AT MOST ONE kind of work. The business name must '
    + 'appear, exactly as it was given. End with what to do next — ringing, '
    + 'or sending a message. Do not list services and do not name any other '
    + 'town',
};

/**
 * One service page, in Anvil's voice.
 *
 * THE SAME ARGUMENTS AND THE SAME RETURN as prompt.js — `{ system, user,
 * stance }` — because generate.js calls whichever of the three the structure
 * named and must not know which it got.
 */
function servicePagePrompt(opts = {}) {
  return buildServicePage({ ...opts, voice: ANVIL_VOICE });
}

/** The home page, in Anvil's voice. */
function homePagePrompt(opts = {}) {
  return buildHomePage({ ...opts, voice: ANVIL_VOICE });
}

module.exports = {
  /* RE-EXPORTED UNCHANGED, because they are the same sections and the same
   * stances. generate.js imports SECTIONS from the structure's prompt to
   * count the pages it is about to write; an Anvil that exported a different
   * list would be a different product, not a different layout. */
  SECTIONS,
  STANCES,
  stanceFor,
  placeOf,
  spellingFor,

  WORDS,
  HOME,
  HOME_JOBS,
  ABOUT_HEADING,
  LINES,
  ANVIL_VOICE,
  servicePagePrompt,
  homePagePrompt,
};
