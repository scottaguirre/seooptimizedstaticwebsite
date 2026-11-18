// utils/localOptions/prompt-quarry.js
//
// Quarry's voice.
//
// WHY — Edwin, 16 November: five more layouts, "different from all layouts
// including github layouts". The rule Beacon set on 30 October still holds
// and this is the third file to inherit it.
//
// WHAT THIS FILE IS NOT
//
// It is not a copy of prompt.js, prompt-beacon.js or prompt-anvil.js.
// Everything in prompt.js which is not voice was paid for in measured runs:
// the no-invented-figures rule, the concrete-noun rule, the spelling rule
// that had to be STATED rather than derived after a Texas site came back
// saying "odour" and "grey water", the heading brief that had to stop
// describing the heading it wanted because a description is a slower
// dictation, and the five section jobs.
//
//     A FOURTH PROMPT FILE WOULD COPY ALL OF THAT, AND A COPY DRIFTS.
//     THE NEXT FIX LANDS IN ONE OF THE FOUR, AND NOBODY EVER FINDS OUT
//     FROM THE THREE THAT MISSED IT.
//
// So this is a VOICE handed to the same builder. The sections are the same
// sections and the rules are the same rules, in one place, for all four.
//
// WHAT QUARRY ACTUALLY CHANGES
//
//   length    600-760 words a page. Ledger runs 780-1000, Beacon 520-700,
//             Anvil 660-840.
//   register  THE SYMPTOM FIRST. Every page opens on what the reader can
//             see, hear or smell, in the words they would use, before the
//             work is named at all. The other three all open by naming the
//             work and then describing it.
//   weight    carried by the opening sentence of each paragraph. Ledger
//             leans on its headings' formality, Beacon on headings carrying
//             the scan, Anvil on verbs; this leans on the first clause.
//
// WHY THE LENGTH IS LOWER THAN ANVIL'S AND NOT PICKED TO BE UNIQUE. Four
// non-overlapping word budgets inside a sane range would be four numbers
// chosen to differ rather than to fit. This one fits a measurable thing: on
// a Quarry service page the prose shares its row with the hours, at
// 1.35fr against 1fr, so the column is narrower than Anvil's full 46rem and
// noticeably narrower than Ledger's. A paragraph in a narrow column is
// taller, and the same word count reads as a longer page.
//
//   node test-local-options-quarry.js

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
 * Quarry's length.
 *
 * NOT A GATE, AN INSTRUCTION. Nothing in Local Website Options rejects a page
 * for being long — see the note on WORDS in prompt.js about the runner's LONG
 * flag meaning "longer than this trade has produced before", not "wrong".
 * These numbers steer; they do not refuse.
 */
const WORDS = { min: 600, max: 760 };

/**
 * The lines added to the system prompt, and nothing else is touched.
 *
 * WRITTEN AS RULES ABOUT SENTENCES, NOT AS AN ADJECTIVE. "Write plainly" is
 * the kind of instruction that competes with twenty others and loses — the
 * same failure the spelling line had before it was made explicit. A rule
 * about where a sentence starts is checkable by the thing reading it.
 *
 * NO EXAMPLE SENTENCES IN HERE. An example in a prompt comes back in the
 * output; that is the lesson the heading brief in prompt.js records, and it
 * applies to voice as much as to headings.
 *
 * THE FIRST RULE IS THE ONE THAT MAKES THIS VOICE DIFFERENT FROM THE OTHER
 * THREE. Ledger and Beacon describe a trade in terms of what it IS, Anvil in
 * terms of what someone DOES. This one describes it in terms of what the
 * reader is already noticing — which is a different paragraph about the same
 * facts rather than a shorter, longer or brisker one.
 *
 * AND THE SECOND RULE IS THE GUARD ON THE FIRST. A brief that says "open on
 * the symptom" and nothing else produces "Is your drain blocked? Look no
 * further." every time: the rhetorical question is the default way to write
 * about a problem, and banning it is the only thing that gets a statement
 * instead. The ban is on the FIRST SENTENCE OF ANY PARAGRAPH rather than on
 * the page, because one question in the middle of a page is fine and a
 * blanket ban would read as a rule about punctuation.
 */
const LINES = [
  'HOW THIS PAGE IS WRITTEN — these are in addition to the rules above, '
  + 'and they do not replace any of them:',
  '',
  '- OPEN ON WHAT THE READER CAN ALREADY NOTICE. The first sentence of the '
  + 'page describes something seen, heard, smelled or felt in the building, '
  + 'not the name of the service. The service is named afterwards.',
  '- No paragraph begins with a question. Write the statement instead.',
  '- Name the thing the way a customer would before naming it the way the '
  + 'trade does, and only use the trade\'s word once.',
  '- The problem is the reader\'s and the work is ours: write "you" and '
  + '"your" about what is wrong, and "we" about what is done.',
  '- Do not begin any sentence with the name of the service this page is '
  + 'about.',
  '- Paragraphs of two to four sentences, and none longer than five.',
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
 *
 * THE SUB IS THE SHORTEST OF THE FOUR, AND THE LAYOUT IS WHY. It sits under
 * an H1 that runs to 4rem and it is also the seam's caption — the same string
 * in both places. A 26-word line is a paragraph under a caption rule.
 */
const HOME = { sub: [12, 20], about: [28, 45] };

/**
 * What Quarry's three home-page paragraphs are about.
 *
 * FOUR SETS OF SUBJECTS NOW, AND THEY HAVE TO STAY FOUR.
 *
 *   Ledger   where we are          what we do          how a visit starts
 *   Beacon   what brings you       where it happens    repair or replace
 *   Anvil    the first call        the buildings       what finished looks like
 *   Quarry   what goes wrong here  what leaving it does  urgent or not
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
 * NOT ONE OF THEM ASKS FOR A LIST. Beacon allows exactly one, for symptoms;
 * Anvil allows none. Quarry allows none either, and for a sharper reason than
 * Anvil's: the first two subjects here are the two on the whole site that
 * most want to be a list of faults, and a home page that lists faults is six
 * service pages' worth of keywords on the one page that should not be
 * competing with them.
 *
 *     THREE BRIEFS THAT ASK FOR A LIST PRODUCE A LIST OF LISTS.
 *     THE SUBJECT WAS NEVER THE PROBLEM; THE SHAPE WAS.
 *
 * AND THE WHOLE SET IS ABOUT TROUBLE, WHICH NEEDS ITS OWN FLOOR. Three
 * paragraphs about what goes wrong is one bad draft away from fear-selling.
 * Every brief below therefore carries the same two refusals — no figure, and
 * nothing the reader is told to do to the fault themselves — rather than a
 * general plea to be reassuring, which is an adjective and would lose.
 */
const HOME_JOBS = [
  /* LOCAL CONDITIONS, IN THE GENERAL. This is the one subject on a trade
   * home page that is genuinely about the place rather than about the
   * company, and it is the reason this voice exists.
   *
   * THE GUARD IS ON THE FACTS, NOT THE TONE. Water hardness, soil, the age
   * of the housing — a model will happily put a number or a decade on any of
   * them, and every such number would be invented. The no-invented-figures
   * rule covers it, and saying so here costs one clause and saves the draft
   * that tests whether the rule reaches this far. */
  'What the buildings and the ground around here do to this kind of '
  + 'installation over time — water, weather, soil, age of the stock, how '
  + 'places were put together. IN THE GENERAL: no particular address, no '
  + 'named customer, no job that took place. Do not state hardness, '
  + 'temperature, depth, age or any other measurement as a figure or a '
  + 'decade. Name the towns covered once, in the last sentence, without '
  + 'making them the subject.',

  /* WHAT LEAVING IT DOES — the paragraph every trade site should have and
   * almost none does, because it is hard to write without either frightening
   * the reader or promising an outcome.
   *
   * THE REFUSALS ARE WHAT MAKE IT WRITEABLE. Without them this comes back as
   * "don't wait — a small leak today is a flooded kitchen tomorrow", which
   * is a prediction, a scare and a sales line in eleven words. */
  'What tends to happen when this kind of fault is left alone — what gets '
  + 'worse, and what starts to cost more than the original job. Plain and '
  + 'unexcited. Do not predict a disaster, do not use the word emergency, '
  + 'do not name a cost, a percentage or a span of time, and do not tell '
  + 'the reader to do anything to the fault themselves.',

  /* A JUDGEMENT, AND THE ONLY ONE OF THE THREE A READER ACTS ON. "Ring now"
   * against "this can wait until Monday" is the most useful paragraph on a
   * trade home page and cannot be enumerated without becoming a triage
   * chart, which is a list of promises about response.
   *
   * THE TIGHTEST GUARD OF THE THREE, for Anvil's reason inverted: that one
   * had to be kept away from a warranty, and this one has to be kept away
   * from advice. A static page telling somebody their gas smell can wait is
   * not a dull paragraph, it is a hazard. */
  'How somebody can tell the difference between something that needs a call '
  + 'straight away and something that can wait for an ordinary appointment, '
  + 'and that we would rather be asked than not. Do not promise a response '
  + 'time, a callback window, an out-of-hours service or a price. Do not '
  + 'tell the reader to isolate, switch off, drain, open or touch anything, '
  + 'and do not say that any situation is safe to leave.',
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
 * AND IT ASKS FOR THE OPPOSITE OF ANVIL'S. Anvil's heading MUST contain a
 * verb; this one must not, and must be five words or fewer. A noun phrase is
 * the fourth available shape, it suits a heading set at 800 weight over a
 * two-column index, and told anything vaguer the four structures produce the
 * same heading with the nouns shuffled.
 */
const ABOUT_HEADING = 'a heading for this section. It MUST name the town and '
  + 'it MUST be five words or fewer. It MUST NOT contain a verb, so it is a '
  + 'phrase rather than a statement. It MUST NOT begin with We, Your, Our or '
  + 'About, and it must not be the business name on its own';

/** Quarry's voice, as prompt.js takes it. */
const QUARRY_VOICE = {
  key: 'quarry',
  words: WORDS,
  lines: LINES,
  home: HOME,
  homeJobs: HOME_JOBS,
  aboutHeading: ABOUT_HEADING,

  /* QUARRY DOES NOT RECITE THE SIX SERVICES, for Beacon's reason and one of
   * its own.
   *
   * The shared instruction "Name the kinds of work in a sentence" is
   * Ledger's second brief said twice. On Ledger it is harmless; here the
   * six names are already set in a sticky column down the side of the
   * services band, in 01..06 order, in the reader's eyeline for the whole
   * of it. A sentence listing them underneath is the same list twice on one
   * screen.
   *
   * The six are still GIVEN to the model — the index below names them, and a
   * page that contradicted them would be worse. It is just not asked to
   * repeat them in prose. */
  namesServices: false,

  /* THE TWO DIVIDERS, AND THEY ARE THE SHORTEST OF THE FOUR.
   *
   * Quarry's divider is a hairline with the line hanging under it in the
   * left column at a 28ch measure — no band, no centring. At ten words it
   * wraps to three lines and stops being a break; at six it is the rule
   * doing the work with a line attached, which is what the layout is for.
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
   * AND THEY ASK FOR DIFFERENT THINGS FROM BEACON'S AND ANVIL'S. Beacon's
   * two both ask for "a short, warm line"; Anvil's ask for a verb and then
   * for nearness. These ask for a PLACE and then for a TIME, which are the
   * two slots left, and they appear on the home page where two sites are
   * most likely to be compared.
   *
   * NO EXAMPLE LINE IN EITHER. An example in a prompt comes back in the
   * output. */
  extras: [
    {
      key: 'firstBreak',
      brief: 'a short line addressed to the reader, four to eight words, '
        + 'naming somewhere in a building or a street rather than naming a '
        + 'feeling or the work. No exclamation mark, no superlative, and no '
        + 'claim about being best, fastest, cheapest or guaranteed',
    },
    {
      key: 'secondBreak',
      brief: 'a second short line, four to eight words, about when we can be '
        + 'reached rather than about how good the work is. It must not repeat '
        + 'any noun from the line above. No exclamation mark, no superlative, '
        + 'and no claim about being best, fastest, cheapest or guaranteed',
    },
  ],

  /* THE ONE PLACE THE MARKETING-REGISTER RULE IS LIFTED, AND IT HAS TO BE
   * SAID OUT LOUD.
   *
   * The system prompt refuses that register by name, and the dividers are
   * the one thing on the page that is MEANT to be a pleasantry. Without this
   * line the brief and the rules pull opposite ways, and two instructions in
   * opposite directions is how a page ends up with neither — which is a test
   * in Beacon's suite, in Anvil's, and in this one.
   *
   *     AN EXCEPTION THAT IS NOT STATED IS NOT AN EXCEPTION.
   *     IT IS TWO RULES AND A COIN TOSS.
   *
   * THE FLOOR THAT STAYS: no superlative and no guarantee. "We strive to
   * provide quality service" is a pleasantry; "the best plumbers in Chicago"
   * is a claim nobody checked, and the no-invented-facts rule is not about
   * taste.
   *
   * AND ONE MORE FLOOR THAT ONLY THIS VOICE NEEDS. Every other brief on a
   * Quarry page is about something going wrong, so a divider is the obvious
   * place for the draft to put the scare line the home-page briefs refused.
   * It is refused here too. */
  extrasNote: 'THE TWO DIVIDER LINES — firstBreak and secondBreak — ARE '
    + 'EXEMPT FROM THE NO-MARKETING-REGISTER RULE. They are meant to be '
    + 'ordinary things a local business says to a customer. Every other rule '
    + 'above still applies to them, in particular inventing nothing: no '
    + 'superlative, no best or fastest or cheapest, no guarantee, no number. '
    + 'Neither line may name a fault, a leak, a breakdown or an emergency.',

  /* THE FOURTH TITLE ANGLE, AND IT HAD TO BE A FOURTH ONE.
   *
   *   Ledger   leads with the business name
   *   Beacon   leads with the kind of work
   *   Anvil    leads with the place
   *   Quarry   leads with the problem
   *
   * Two structures leading with the same slot produce two titles of the same
   * shape with a different noun in it, which is what prompted the Beacon
   * rule on 30 October. A fourth doing it again would waste the slot, and
   * the problem is the only slot left that a customer actually types.
   *
   * THE NAME IS STILL IN THERE — Edwin, 30 October: "it should always appear
   * in the title and meta description." The name goes last, which is where a
   * title with a pipe in it puts a brand anyway.
   *
   * EXACTLY AS IT WAS GIVEN. "The Austin Plumber" is the case that proves
   * this half is needed: told only to lead with something else, a model will
   * happily write "Austin Plumber" at the end — which is a different
   * company's name.
   *
   * AND THE TOWN IS STILL REQUIRED, because a local title without the town
   * is a worse title however well it reads. The problem goes first; the town
   * goes second. */
  title: 'the <title>, under 60 characters if you can. Lead with the problem '
    + 'this page solves, named the way a customer would name it, then the '
    + 'town, then the business name last, exactly as it was given. Do not '
    + 'begin with the business name and do not begin with the formal name of '
    + 'the service',

  /* AND THE DESCRIPTION IS WRITTEN FROM THE SYMPTOM, WHICH IS THE FOURTH
   * SHAPE.
   *
   *   Ledger   lists the services
   *   Beacon   caps it at two kinds of work and writes it for somebody
   *            deciding who to ring
   *   Anvil    says what to do next
   *   Quarry   opens on what is wrong and names no service at all
   *
   * Edwin's complaint on 30 October was that both descriptions were the six
   * services comma-listed and then the four towns: 160 characters of
   * keywords, truncated in a result anyway. Beacon's cap fixed the listing
   * and Anvil's ending fixed the shape. Naming NO service is the one version
   * the other three cannot produce by accident — and on a page whose whole
   * voice opens on the symptom, it is the description that matches the page
   * the reader lands on. */
  meta: 'the meta description, 140-160 characters. Open with what the reader '
    + 'has noticed going wrong. Name the town and the state once, and no '
    + 'other town. The business name must appear, exactly as it was given. '
    + 'Do not name any service and do not list anything',
};

/**
 * One service page, in Quarry's voice.
 *
 * THE SAME ARGUMENTS AND THE SAME RETURN as prompt.js — `{ system, user,
 * stance }` — because generate.js calls whichever of the four the structure
 * named and must not know which it got.
 */
function servicePagePrompt(opts = {}) {
  return buildServicePage({ ...opts, voice: QUARRY_VOICE });
}

/** The home page, in Quarry's voice. */
function homePagePrompt(opts = {}) {
  return buildHomePage({ ...opts, voice: QUARRY_VOICE });
}

module.exports = {
  /* RE-EXPORTED UNCHANGED, because they are the same sections and the same
   * stances. generate.js imports SECTIONS from the structure's prompt to
   * count the pages it is about to write; a Quarry that exported a different
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
  QUARRY_VOICE,
  servicePagePrompt,
  homePagePrompt,
};
