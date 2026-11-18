// utils/localOptions/prompt-harbor.js
//
// Harbor's voice.
//
// WHY — Edwin, 16 November: five new layouts, "different from all layouts
// including github layouts". The rule Beacon set on 30 October still holds
// and this is the fourth file to inherit it.
//
// WHAT THIS FILE IS NOT
//
// It is not a copy of prompt.js, prompt-beacon.js, prompt-anvil.js or
// prompt-quarry.js. Everything in prompt.js which is not voice was paid for
// in measured runs: the no-invented-figures rule, the concrete-noun rule,
// the spelling rule that had to be STATED rather than derived after a Texas
// site came back saying "odour" and "grey water", the heading brief that had
// to stop describing the heading it wanted because a description is a slower
// dictation, and the five section jobs.
//
//     A FIFTH PROMPT FILE WOULD COPY ALL OF THAT, AND A COPY DRIFTS.
//     THE NEXT FIX LANDS IN ONE OF THE FIVE, AND NOBODY EVER FINDS OUT
//     FROM THE FOUR THAT MISSED IT.
//
// So this is a VOICE handed to the same builder. The sections are the same
// sections and the rules are the same rules, in one place, for all five.
//
// WHAT HARBOR ACTUALLY CHANGES
//
//   length    580-720 words a page. Ledger runs 780-1000, Beacon 520-700,
//             Anvil 660-840, Quarry 600-760.
//   register  ANSWER FIRST. Every paragraph opens with the answer to the
//             question its section asks, and the explanation follows it.
//             No preamble, no background, no working up to the point.
//   weight    carried by the first clause of each paragraph. Ledger leans
//             on its headings' formality, Beacon on headings carrying the
//             scan, Anvil on verbs, Quarry on the symptom. This leans on
//             the sentence that could stand alone if the rest were cut.
//
// WHY THE LENGTH IS WHAT IT IS. The content column is 42rem of prose beside
// a 17rem rail, so a paragraph is narrower than Ledger's or Anvil's and the
// page is taller for the same words. And the rail has already answered
// where, when and how to call — so the page does not have to, and four of
// the five sections are shorter for it.
//
//   node test-local-options-harbor.js

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
 * Harbor's length.
 *
 * NOT A GATE, AN INSTRUCTION. Nothing in Local Website Options rejects a
 * page for being long — see the note on WORDS in prompt.js about the
 * runner's LONG flag meaning "longer than this trade has produced before",
 * not "wrong". These numbers steer; they do not refuse.
 */
const WORDS = { min: 580, max: 720 };

/**
 * The lines added to the system prompt, and nothing else is touched.
 *
 * WRITTEN AS RULES ABOUT SENTENCES, NOT AS AN ADJECTIVE. "Be direct" is the
 * kind of instruction that competes with twenty others and loses — the same
 * failure the spelling line had before it was made explicit. A rule about
 * what the first sentence of a paragraph must contain is checkable by the
 * thing reading it.
 *
 * NO EXAMPLE SENTENCES IN HERE. An example in a prompt comes back in the
 * output; that is the lesson the heading brief in prompt.js records, and it
 * applies to voice as much as to headings.
 *
 * THE FIRST RULE IS THE ONE THAT MAKES THIS VOICE DIFFERENT FROM THE OTHER
 * FOUR. Ledger and Beacon describe a trade in terms of what it IS, Anvil in
 * terms of what someone DOES, Quarry in terms of what the reader has
 * NOTICED. This one answers the question the heading asked, in the first
 * sentence, and explains afterwards — which is a different paragraph about
 * the same facts rather than a shorter, longer, brisker or gloomier one.
 *
 * AND THE SECOND RULE IS THE GUARD ON THE FIRST. A brief that says "be
 * direct" and nothing else produces a page that opens every paragraph with
 * the same four words. Banning the run-up is what gets a varied first
 * sentence rather than a formula.
 */
const LINES = [
  'HOW THIS PAGE IS WRITTEN — these are in addition to the rules above, '
  + 'and they do not replace any of them:',
  '',
  '- ANSWER FIRST. The first sentence of every paragraph is the answer, the '
  + 'finding or the decision. Everything that explains it comes after.',
  '- No run-up. Do not open a paragraph with background, with how common '
  + 'something is, or with what people often think. Start at the point.',
  '- Do not begin two paragraphs on this page with the same word.',
  '- If a sentence could be cut without losing a fact, cut it.',
  '- Say the number of a thing when it is known and write around it when it '
  + 'is not. Never estimate one.',
  '- Paragraphs of two to four sentences.',
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
 * service-page budget, so its home page came out exactly as long as
 * Ledger's — caught by putting the two built pages side by side, not by any
 * test. A setting read in two places has to be passed to both.
 */
const HOME = { sub: [15, 24], about: [30, 48] };

/**
 * What Harbor's three home-page paragraphs are about.
 *
 * FIVE SETS OF SUBJECTS NOW, AND THEY HAVE TO STAY FIVE.
 *
 *   Ledger   where we are        what we do          how a visit starts
 *   Beacon   what brings you     where it happens    repair or replace
 *   Anvil    the first call      the buildings       what finished looks like
 *   Quarry   what goes wrong     what leaving it does  urgent or not
 *   Harbor   who we work for     how the week runs   what we do not take on
 *
 * WHY SUBJECTS AND NOT WORDINGS — 30 October. Edwin built one site in each
 * of the first two structures and set the home pages beside each other. Same
 * three subjects, same order, and both third paragraphs opened "A visit
 * starts with", because Ledger's brief says "How a visit starts".
 *
 *     A BRIEF THAT DESCRIBES THE PARAGRAPH IN WORDS GETS THOSE WORDS BACK.
 *     THE STYLE RULES COULD NOT MOVE IT: THEY GOVERN HOW A SENTENCE IS
 *     BUILT, NOT WHAT IT IS ABOUT.
 *
 * THE THIRD ONE IS THE ONE NO TRADE SITE HAS. Every one of them says what
 * it does and none says where it stops, so a reader with a job on the edge
 * of it has to ring to find out, and half of those calls waste both
 * people's time. It is also the subject that most suits this voice: the
 * answer is the first sentence and there is nothing to work up to.
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
 * AND NONE OF THEM EXPLAINS A SERVICE. The system prompt already forbids it
 * — each of the six has its own page, and a front page teaching water
 * heaters competes with the page that should rank for them.
 *
 * ONE OF THEM ALLOWS A LIST, AND ONLY ONE. Beacon allows exactly one, for
 * symptoms; Anvil and Quarry allow none. The limits paragraph is the one
 * subject on this page where a reader is scanning for whether their own job
 * is in or out, and prose makes that harder to answer than a short run of
 * named things.
 *
 *     THREE BRIEFS THAT ASK FOR A LIST PRODUCE A LIST OF LISTS.
 *     ONE DOES NOT. The subject was never the problem; the shape was.
 */
const HOME_JOBS = [
  /* WHO, WHICH IS NOT WHERE. Ledger's first brief is the address and the
   * towns; this one is the kind of customer, which the rail has not
   * answered and no other structure asks for. */
  'The kinds of customer this trade works for around here — people in their '
  + 'own homes, landlords, letting agents, shops and small businesses — and '
  + 'what differs about working for each. IN THE GENERAL: never a particular '
  + 'customer, a named company or a job that took place. Do not say which '
  + 'kind there is most of, and do not give a proportion. Name the towns '
  + 'covered once, in the last sentence, without making them the subject.',

  /* HOW THE WEEK RUNS, WHICH IS NOT HOW A VISIT GOES. Ledger's third brief
   * and Anvil's first are both about one call; this is about the shape of
   * the work across a week, which is the thing a customer is actually
   * asking when they ask how soon.
   *
   * THE GUARD IS TIGHT BECAUSE THE SUBJECT INVITES A PROMISE. "How soon can
   * you come" is the question behind it and the one thing a static page
   * must not answer. */
  'How the work is organised across an ordinary week — booked jobs against '
  + 'things that cannot wait, mornings against afternoons, what tends to '
  + 'take a whole day. Do not promise a response time, a callback window, '
  + 'a same-day or next-day service, or an out-of-hours one. Do not say how '
  + 'many jobs are done in a day or a week. Do not give a price.',

  /* WHERE WE STOP, WHICH NOTHING ELSE ON A TRADE SITE SAYS. The one brief
   * of the fifteen that is allowed a list, because a reader is scanning it
   * for their own job rather than reading it.
   *
   * AND THE GUARD IS ABOUT OTHER PEOPLE. A paragraph about what we do not
   * take on is one sentence away from a paragraph about who does it badly,
   * and a trade site that runs down other trades reads as a complaint
   * rather than as a limit. */
  'What this business does NOT take on, and who a customer should look for '
  + 'instead — the work that belongs to another trade, needs a different '
  + 'certification, or is too large for this one. A short run of named '
  + 'things is allowed here and nowhere else on the page. End on being '
  + 'willing to say so on the phone rather than on the visit. Do not '
  + 'criticise any other trade or company, do not say anyone does anything '
  + 'badly, and do not name a certification, licence number or body.',
];

/**
 * The About heading's job.
 *
 * LEDGER SAYS "a heading that says you are a local <trade> company in <city,
 * state>", and gets back "We Are a Local Plumbing Company in Chicago, IL" —
 * the brief, with capitals. Dictation again.
 *
 * THIS ASKS FOR A PROPERTY, NOT A SENTENCE, which is the shape the service
 * pages' heading brief had to be rewritten into after five cost headings
 * came back as five restatements of the brief that asked for them.
 *
 * AND IT IS THE INVERSE OF BEACON'S AND ANVIL'S. Both of those FORBID
 * "Your"; this one requires it. A heading addressed to the reader is the
 * fifth available shape, it suits a voice whose whole rule is to answer
 * rather than announce, and told anything vaguer the five structures
 * produce the same heading with the nouns shuffled.
 */
const ABOUT_HEADING = 'a heading for this section. It MUST address the '
  + 'reader directly, using the word your, and it MUST name the town. It '
  + 'MUST NOT begin with We, Our or About, must not be the business name on '
  + 'its own, and must not be a question';

/** Harbor's voice, as prompt.js takes it. */
const HARBOR_VOICE = {
  key: 'harbor',
  words: WORDS,
  lines: LINES,
  home: HOME,
  homeJobs: HOME_JOBS,
  aboutHeading: ABOUT_HEADING,

  /* HARBOR DOES NOT RECITE THE SIX SERVICES, for Beacon's reason and the
   * strongest version of it.
   *
   * The shared instruction "Name the kinds of work in a sentence" is
   * Ledger's second brief said twice. On Ledger it is harmless. Here the
   * six names are in the RAIL — on screen, down the left, on this page and
   * on every other page of the site, at every scroll position. A sentence
   * listing them in the body is the same list twice on one screen, and it
   * is the one screen where the reader can see both at once.
   *
   * The six are still GIVEN to the model — the list below names them, and a
   * page that contradicted them would be worse. It is just not asked to
   * repeat them in prose. */
  namesServices: false,

  /* THE TWO DIVIDERS.
   *
   * Harbor's break is the sentence first and a rule under it, in a 30ch
   * measure in the content column. At ten words it wraps to three lines
   * above its own rule and stops reading as an ending; six to nine is the
   * sentence doing the work with the rule closing it.
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
   * AND THEY ASK FOR DIFFERENT THINGS FROM THE OTHER THREE. Beacon's both
   * ask for "a short, warm line"; Anvil's ask for a verb and then for
   * nearness; Quarry's for a place and then a time. These ask for a PERSON
   * and then for a THING THAT IS NOT DONE — which is the one pair left and
   * is this voice's own subject matter.
   *
   * NO EXAMPLE LINE IN EITHER. An example in a prompt comes back in the
   * output. */
  extras: [
    {
      key: 'firstBreak',
      brief: 'a short line addressed to the reader, six to nine words, '
        + 'about the person who answers the phone rather than about the '
        + 'work. No exclamation mark, no superlative, and no claim about '
        + 'being best, fastest, cheapest or guaranteed',
    },
    {
      key: 'secondBreak',
      brief: 'a second short line, six to nine words, naming something this '
        + 'business does not charge for or does not do, stated plainly and '
        + 'without comparing it to anyone else. It must not repeat any noun '
        + 'from the line above. No exclamation mark, no superlative, and no '
        + 'claim about being best, fastest, cheapest or guaranteed',
    },
  ],

  /* THE ONE PLACE THE MARKETING-REGISTER RULE IS LIFTED, AND IT HAS TO BE
   * SAID OUT LOUD.
   *
   * The system prompt refuses that register by name, and the dividers are
   * the one thing on the page that is MEANT to be a pleasantry. Without
   * this line the brief and the rules pull opposite ways, and two
   * instructions in opposite directions is how a page ends up with neither
   * — which is a test in Beacon's suite, in Anvil's, in Quarry's and in
   * this one.
   *
   *     AN EXCEPTION THAT IS NOT STATED IS NOT AN EXCEPTION.
   *     IT IS TWO RULES AND A COIN TOSS.
   *
   * THE FLOOR THAT STAYS: no superlative and no guarantee. "We strive to
   * provide quality service" is a pleasantry; "the best plumbers in
   * Chicago" is a claim nobody checked, and the no-invented-facts rule is
   * not about taste.
   *
   * AND ONE MORE FLOOR THAT ONLY THIS VOICE NEEDS. The second divider names
   * something the business does not do, which is one word away from naming
   * somebody who does it badly. */
  extrasNote: 'THE TWO DIVIDER LINES — firstBreak and secondBreak — ARE '
    + 'EXEMPT FROM THE NO-MARKETING-REGISTER RULE. They are meant to be '
    + 'ordinary things a local business says to a customer. Every other '
    + 'rule above still applies to them, in particular inventing nothing: '
    + 'no superlative, no best or fastest or cheapest, no guarantee, no '
    + 'number. Neither line may mention another company or trade, or say '
    + 'that anyone does anything badly.',

  /* THE FIFTH TITLE ANGLE, AND IT HAD TO BE A FIFTH ONE.
   *
   *   Ledger   leads with the business name
   *   Beacon   leads with the kind of work
   *   Anvil    leads with the place
   *   Quarry   leads with the problem
   *   Harbor   leads with the OUTCOME
   *
   * Two structures leading with the same slot produce two titles of the
   * same shape with a different noun in it, which is what prompted the
   * Beacon rule on 30 October. The outcome is the slot left, and it is the
   * one that matches this voice: the answer first, the explanation after.
   *
   * THE NAME IS STILL IN THERE — Edwin, 30 October: "it should always
   * appear in the title and meta description." The name goes last, which is
   * where a title with a pipe in it puts a brand anyway.
   *
   * EXACTLY AS IT WAS GIVEN. "The Austin Plumber" is the case that proves
   * this half is needed: told only to lead with something else, a model
   * will happily write "Austin Plumber" at the end — which is a different
   * company's name.
   *
   * AND NOT A PROMISE. An outcome is "drains running again", not "running
   * again today" and not "guaranteed". This is the one title angle that
   * could become a claim, so it says so. */
  title: 'the <title>, under 60 characters if you can. Lead with the result '
    + 'the customer gets, then the town, then the business name last, '
    + 'exactly as it was given. Do not begin with the business name. Do not '
    + 'put a time, a speed, a price or a guarantee in it',

  /* AND THE DESCRIPTION IS ONE SENTENCE, WHICH IS THE FIFTH SHAPE.
   *
   *   Ledger   lists the services
   *   Beacon   caps it at two kinds of work and writes it for somebody
   *            deciding who to ring
   *   Anvil    says what to do next
   *   Quarry   opens on the symptom and names no service
   *   Harbor   one sentence, the result first
   *
   * Edwin's complaint on 30 October was that both descriptions were the six
   * services comma-listed and then the four towns: 160 characters of
   * keywords, truncated in a result anyway. A single sentence cannot be a
   * list, which is the one shape the other four can each still produce by
   * accident. */
  meta: 'the meta description, 140-160 characters, as ONE sentence. Open '
    + 'with the result the customer gets. Name the town and the state once, '
    + 'and no other town. The business name must appear, exactly as it was '
    + 'given. Do not list services, and do not use a semicolon',
};

/**
 * One service page, in Harbor's voice.
 *
 * THE SAME ARGUMENTS AND THE SAME RETURN as prompt.js — `{ system, user,
 * stance }` — because generate.js calls whichever of the five the structure
 * named and must not know which it got.
 */
function servicePagePrompt(opts = {}) {
  return buildServicePage({ ...opts, voice: HARBOR_VOICE });
}

/** The home page, in Harbor's voice. */
function homePagePrompt(opts = {}) {
  return buildHomePage({ ...opts, voice: HARBOR_VOICE });
}

module.exports = {
  /* RE-EXPORTED UNCHANGED, because they are the same sections and the same
   * stances. generate.js imports SECTIONS from the structure's prompt to
   * count the pages it is about to write; a Harbor that exported a
   * different list would be a different product, not a different layout. */
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
  HARBOR_VOICE,
  servicePagePrompt,
  homePagePrompt,
};
