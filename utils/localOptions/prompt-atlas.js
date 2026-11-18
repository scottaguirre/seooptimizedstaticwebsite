// utils/localOptions/prompt-atlas.js
//
// Atlas's voice.
//
// WHY — Edwin, 16 November: five new layouts, "different from all layouts
// including github layouts". The rule Beacon set on 30 October still holds
// and this is the fifth file to inherit it.
//
// WHAT THIS FILE IS NOT
//
// It is not a copy of prompt.js, prompt-beacon.js, prompt-anvil.js,
// prompt-quarry.js or prompt-harbor.js. Everything in prompt.js which is
// not voice was paid for in measured runs: the no-invented-figures rule,
// the concrete-noun rule, the spelling rule that had to be STATED rather
// than derived after a Texas site came back saying "odour" and "grey
// water", the heading brief that had to stop describing the heading it
// wanted because a description is a slower dictation, and the five section
// jobs.
//
//     A SIXTH PROMPT FILE WOULD COPY ALL OF THAT, AND A COPY DRIFTS.
//     THE NEXT FIX LANDS IN ONE OF THE SIX, AND NOBODY EVER FINDS OUT
//     FROM THE FIVE THAT MISSED IT.
//
// So this is a VOICE handed to the same builder. The sections are the same
// sections and the rules are the same rules, in one place, for all six.
//
// WHAT ATLAS ACTUALLY CHANGES
//
//   length    700-860 words a page. Ledger runs 780-1000, Beacon 520-700,
//             Anvil 660-840, Quarry 600-760, Harbor 580-720.
//   register  EVERY SECTION STANDS ALONE. A reader arriving at one label
//             and reading nothing else must still understand it. No "as
//             above", no "this", no pronoun reaching back out of its own
//             section.
//   weight    carried by the sections being readable in any order. Ledger
//             leans on the formality of its headings, Beacon on headings
//             carrying the scan, Anvil on verbs, Quarry on the symptom,
//             Harbor on the first clause of each paragraph. This leans on
//             each block being complete.
//
// WHY THAT IS THE RIGHT RULE FOR THIS STRUCTURE, AND NOT A STYLE.
//
// Atlas puts every heading in the left margin beside its own prose, so the
// page is a column of labels that can be skimmed down one edge. The entire
// point of that shape is that a reader picks a label and starts there.
//
//     A PAGE BUILT TO BE ENTERED IN THE MIDDLE CANNOT BE WRITTEN
//     TO BE READ FROM THE TOP.
//
// On the other five a sentence opening "This is usually caused by" is fine,
// because the paragraph above it is the one the reader just read. Here it is
// a sentence about nothing.
//
// WHY THE LENGTH IS WHAT IT IS. Self-contained sections cost words: a
// section that may not point back has to name its own subject again, in its
// own first sentence, five times a page. The text column is also wider than
// Harbor's and Quarry's — the label takes 11.5rem out of a 64rem page and
// the prose gets the rest — so the same words make a shorter page.
//
//   node test-local-options-atlas.js

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
 * Atlas's length.
 *
 * NOT A GATE, AN INSTRUCTION. Nothing in Local Website Options rejects a
 * page for being long — see the note on WORDS in prompt.js about the
 * runner's LONG flag meaning "longer than this trade has produced before",
 * not "wrong". These numbers steer; they do not refuse.
 */
const WORDS = { min: 700, max: 860 };

/**
 * The lines added to the system prompt, and nothing else is touched.
 *
 * WRITTEN AS RULES ABOUT SENTENCES, NOT AS AN ADJECTIVE. "Be
 * self-contained" is the kind of instruction that competes with twenty
 * others and loses — the same failure the spelling line had before it was
 * made explicit. A rule naming the WORDS a sentence may not open with is
 * checkable by the thing reading it, and by the suite.
 *
 * NO EXAMPLE SENTENCES IN HERE. An example in a prompt comes back in the
 * output; that is the lesson the heading brief in prompt.js records, and it
 * applies to voice as much as to headings.
 *
 * THE FIRST RULE IS THE ONE THAT MAKES THIS VOICE DIFFERENT FROM THE OTHER
 * FIVE. Ledger and Beacon describe a trade in terms of what it IS, Anvil in
 * terms of what someone DOES, Quarry in terms of what the reader has
 * NOTICED, Harbor in terms of the answer arriving first. This one writes
 * five blocks that do not depend on each other — which is a different page
 * about the same facts rather than a shorter, longer, brisker, gloomier or
 * blunter one.
 *
 * THE SECOND AND THIRD RULES ARE THE TEETH OF THE FIRST. A brief that says
 * "each section should stand alone" and nothing else produces a page that
 * still opens its third paragraph with "These problems". Naming the
 * openings that are forbidden is what moves it.
 *
 * AND THE FOURTH IS THE GUARD AGAINST THE OBVIOUS FAILURE OF THE OTHER
 * THREE. Five self-contained sections written carelessly are five sections
 * that each begin by restating the same subject in the same words, which
 * reads worse than a page that pointed backwards.
 */
const LINES = [
  'HOW THIS PAGE IS WRITTEN — these are in addition to the rules above, '
  + 'and they do not replace any of them:',
  '',
  '- EVERY SECTION STANDS ALONE. Each one must make sense to somebody who '
  + 'reads only that section and nothing else on the page.',
  '- Do not refer to another section, and do not refer to anything said '
  + 'earlier or later on the page.',
  '- Do not open a sentence with This, That, These, Those, It, They, Such '
  + 'or Here when the thing it stands for was named in a different section.',
  '- Name the subject of a section inside that section, and find a '
  + 'different way to name it each time. Do not open two sections with the '
  + 'same noun.',
  '- Say the number of a thing when it is known and write around it when it '
  + 'is not. Never estimate one.',
  '- Paragraphs of three to five sentences.',
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
 *
 * THE LONGEST SUB OF THE SIX, AND THE SHORTEST PARAGRAPHS. The sub line
 * sits in a 48ch measure under a title block with a numeral in its margin
 * and has room; the three about paragraphs each sit in their own labelled
 * leaf, where a long block pulls its label far off the top of its own text.
 */
const HOME = { sub: [18, 28], about: [26, 42] };

/**
 * What Atlas's three home-page paragraphs are about.
 *
 * SIX SETS OF SUBJECTS NOW, AND THEY HAVE TO STAY SIX.
 *
 *   Ledger   where we are        what we do          how a visit starts
 *   Beacon   what brings you     where it happens    repair or replace
 *   Anvil    the first call      the buildings       what finished looks like
 *   Quarry   what goes wrong     what leaving it does  urgent or not
 *   Harbor   who we work for     how the week runs   what we do not take on
 *   Atlas    what the words mean how the year runs   what to check first
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
 * ALL THREE ARE REFERENCE SUBJECTS, which is the point. The other five sets
 * are about the business — who it works for, how it works, where it stops.
 * These three are about the SUBJECT, and the business happens to be the one
 * explaining it. That is what a page built like a reference page should be
 * doing with its front matter, and it is the one angle none of the five
 * takes.
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
 * heaters competes with the page that should rank for them. The first brief
 * below is the closest any of the eighteen has come to that line, so it
 * says where the line is twice.
 *
 * NONE OF THEM ALLOWS A LIST, AND THAT IS A DECISION RATHER THAN AN
 * OVERSIGHT. Beacon allows exactly one, for symptoms; Harbor exactly one,
 * for limits; Anvil and Quarry none.
 *
 *     THIS PAGE IS ALREADY A LIST. Six labelled blocks down a margin and a
 *     ruled table of six services. A run of bullets inside one of those
 *     blocks is a list inside a list, and the thing that makes the layout
 *     legible is that only one level of it is doing that job.
 */
const HOME_JOBS = [
  /* WHAT THE WORDS MEAN, WHICH NO TRADE SITE DOES. Every one of them uses
   * the trade's own vocabulary and none of them translates it, so a
   * customer rings up unable to say what they have got.
   *
   * THE GUARD IS THE TIGHTEST OF THE EIGHTEEN, because this brief is one
   * step from the thing the system prompt forbids outright. A meaning is
   * not a method: naming what a word refers to is translation, and saying
   * what is done about it is the service page's job. Both halves are
   * stated, because only forbidding the second produces a paragraph that
   * drifts into it by the third sentence. */
  'The words a customer hears from this trade and what each of them '
  + 'actually refers to, in plain language — the names of the parts, '
  + 'fittings or stages that come up on the phone. TRANSLATION ONLY: say '
  + 'what a word means, never what is done about it, how a job is carried '
  + 'out, or which service covers it. Do not explain or describe any of the '
  + 'six services. Do not give a price, a duration or a measurement.',

  /* HOW THE YEAR RUNS, WHICH IS NOT HOW THE WEEK RUNS. Harbor's second
   * brief is the shape of the work across a week; this is the shape of it
   * across a year, which is a different fact about a different thing and
   * is the one that depends on where the business actually is.
   *
   * THE SEASONS ARE READ OFF THE ADDRESS AND NOTHING ELSE. A model told
   * "the seasons here" will reach for a climate it was not given — frozen
   * standpipes in Phoenix, monsoon drains in Chicago. So the brief says to
   * work from the town and the state it was given and from nothing else,
   * and forbids naming a temperature, which is the form the invention
   * takes. */
  'How this trade\'s year is shaped where the business is — which months '
  + 'are busiest, what the weather does to the kind of work it does, and '
  + 'what tends to get put off until a particular time of year. Work only '
  + 'from the town and state you were given. Do not name a temperature, a '
  + 'rainfall, a month\'s figure or any statistic. Do not promise '
  + 'availability in any season, and do not give a price.',

  /* WHAT TO CHECK FIRST, WHICH IS NOT TRIAGE. Quarry's third brief is
   * whether a thing is urgent; Anvil's first is what the first call is
   * like. This is the handful of things a customer can look at before
   * either — and it is the most useful paragraph on any of the six home
   * pages, because it is the only one that is worth something to a reader
   * who never rings.
   *
   * AND IT IS THE ONLY BRIEF OF THE EIGHTEEN THAT COULD GET SOMEBODY
   * HURT. So the floor is absolute and it is spelled out rather than
   * implied: nothing that needs a tool, nothing electrical, nothing to do
   * with gas, nothing above ground level, nothing taken apart. A brief
   * that said "safe things" and left it there would get a paragraph about
   * resetting a breaker. */
  'The things a customer can usefully check or note down before ringing '
  + 'anybody — what to look at, what to listen for, where the relevant '
  + 'shut-off or switch usually is in a house. SAFE AND TOOL-FREE ONLY: '
  + 'nothing that needs a tool, nothing electrical, nothing involving gas, '
  + 'nothing above ground level, and nothing taken apart or opened up. End '
  + 'on what is worth having ready when the call is made. Do not tell '
  + 'anybody to attempt a repair.',
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
 * AND IT IS THE SIXTH SHAPE.
 *
 *   Ledger   states what the business is
 *   Beacon   names the trade and the town, and forbids We, Your and About
 *   Anvil    MUST contain a verb
 *   Quarry   MUST NOT contain a verb, and five words or fewer
 *   Harbor   MUST address the reader, using the word your
 *   Atlas    MUST BEGIN WITH THE TOWN
 *
 * ⚠ THE FIRST VERSION OF THIS WAS "a noun phrase with no verb in it", WHICH
 * IS QUARRY'S RULE. I wrote the table above claiming a sixth shape before
 * reading the fourth one, and the only differences left were the word cap
 * and a demand for the trade — which is not a different heading, it is
 * Quarry's heading with a smaller cap.
 *
 *     SIX BRIEFS THAT RHYME ARE ONE BRIEF. The whole reason there is a file
 *     per voice is that two of them produced the same heading with the
 *     nouns shuffled on 30 October.
 *
 * SO IT FIXES THE FIRST WORD INSTEAD, and that is the better rule anyway.
 * This heading is set in 11.5px tracked capitals, ranged right, in a
 * margin, beside the text it labels. A label in that position which begins
 * with the place is an index entry; nothing else on the site reads like
 * one, and no other structure's About heading would survive being put
 * there.
 *
 * A HEADING CAN SATISFY BOTH THIS AND QUARRY'S, which is the test that the
 * two are different rules rather than two phrasings of one: Quarry's
 * forbids a verb and caps the length, this one says where the town goes and
 * says nothing about either.
 */
const ABOUT_HEADING = 'a heading for this section. It MUST BEGIN with the '
  + 'name of the town, and it MUST also name the trade. It MUST NOT begin '
  + 'with We, Our, About, You or Your, must not be the business name on its '
  + 'own, and must not be a question';

/** Atlas's voice, as prompt.js takes it. */
const ATLAS_VOICE = {
  key: 'atlas',
  words: WORDS,
  lines: LINES,
  home: HOME,
  homeJobs: HOME_JOBS,
  aboutHeading: ABOUT_HEADING,

  /* ATLAS DOES NOT RECITE THE SIX SERVICES, for Beacon's reason and
   * Harbor's.
   *
   * The shared instruction "Name the kinds of work in a sentence" is
   * Ledger's second brief said twice. On Ledger it is harmless. Here the
   * six names are a RULED TABLE in the very next block, under its own
   * label, numbered, each with its own line — which is the most explicit
   * listing of the six that any of the structures makes. A sentence naming
   * them in the paragraph above it is the same list twice, a screen apart.
   *
   * The six are still GIVEN to the model — the list below names them, and a
   * page that contradicted them would be worse. It is just not asked to
   * repeat them in prose. */
  namesServices: false,

  /* THE TWO DIVIDERS.
   *
   * Atlas's break has no rule at all. The sentence goes where the labels
   * go — ranged right in the margin, in the small tracked sans, with the
   * text column left empty beside it — so the break is a gap in the page's
   * own grid rather than a band across it.
   *
   * WHICH MEANS IT HAS TO BE SHORT. The margin is 11.5rem and the measure
   * is 26 characters; at nine words this is four ragged lines of capitals
   * stacked against an empty column, which reads as a mistake. Four to
   * seven words is one or two lines and looks deliberate. Harbor and Beacon
   * both ask for six to nine because both set their line in the content
   * column.
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
   *     A LINE THAT NAMES A SOUND, A SMELL OR A LABEL ON A VALVE IS WARM.
   *     A LINE THAT NAMES A FEELING IS FILLER.
   *
   * AND THEY ASK FOR DIFFERENT THINGS FROM THE OTHER FOUR PAIRS. Beacon's
   * both ask for "a short, warm line"; Anvil's for a verb and then for
   * nearness; Quarry's for a place and then a time; Harbor's for a person
   * and then a thing that is not done. These ask for something SENSED and
   * then something RECORDED, which is the pair left and the one that
   * belongs on a page shaped like a reference.
   *
   * NO EXAMPLE LINE IN EITHER. An example in a prompt comes back in the
   * output. */
  extras: [
    {
      key: 'firstBreak',
      brief: 'a short line, four to seven words, naming a sound or a smell '
        + 'that tells this trade something. No exclamation mark, no '
        + 'superlative, and no claim about being best, fastest, cheapest or '
        + 'guaranteed',
    },
    {
      key: 'secondBreak',
      brief: 'a second short line, four to seven words, naming something '
        + 'this trade writes down, labels or leaves behind in writing. It '
        + 'must not repeat any noun from the line above. No exclamation '
        + 'mark, no superlative, and no claim about being best, fastest, '
        + 'cheapest or guaranteed',
    },
  ],

  /* THE ONE PLACE THE MARKETING-REGISTER RULE IS LIFTED, AND IT HAS TO BE
   * SAID OUT LOUD.
   *
   * The system prompt refuses that register by name, and the dividers are
   * the one thing on the page that is MEANT to be a pleasantry. Without
   * this line the brief and the rules pull opposite ways, and two
   * instructions in opposite directions is how a page ends up with neither
   * — which is a test in Beacon's suite, in Anvil's, in Quarry's, in
   * Harbor's and in this one.
   *
   *     AN EXCEPTION THAT IS NOT STATED IS NOT AN EXCEPTION.
   *     IT IS TWO RULES AND A COIN TOSS.
   *
   * THE FLOOR THAT STAYS: no superlative and no guarantee. "We strive to
   * provide quality service" is a pleasantry; "the best plumbers in
   * Chicago" is a claim nobody checked, and the no-invented-facts rule is
   * not about taste.
   *
   * AND ONE MORE FLOOR THAT ONLY THIS VOICE NEEDS. Both lines name a
   * concrete thing, and a concrete thing is where an invented measurement
   * hides most easily — a reading, a pressure, a depth. */
  extrasNote: 'THE TWO DIVIDER LINES — firstBreak and secondBreak — ARE '
    + 'EXEMPT FROM THE NO-MARKETING-REGISTER RULE. They are meant to be '
    + 'ordinary things a local business says to a customer. Every other '
    + 'rule above still applies to them, in particular inventing nothing: '
    + 'no superlative, no best or fastest or cheapest, no guarantee, and no '
    + 'number, reading or measurement of any kind. Neither line may mention '
    + 'another company or trade, or say that anyone does anything badly.',

  /* THE SIXTH TITLE ANGLE, AND IT HAD TO BE A SIXTH ONE.
   *
   *   Ledger   leads with the business name
   *   Beacon   leads with the kind of work
   *   Anvil    leads with the place
   *   Quarry   leads with the problem
   *   Harbor   leads with the outcome
   *   Atlas    leads with the THING WORKED ON
   *
   * Two structures leading with the same slot produce two titles of the
   * same shape with a different noun in it, which is what prompted the
   * Beacon rule on 30 October. The object is the slot left: not the name of
   * the service, which is Beacon's, and not what is wrong with it, which is
   * Quarry's, but the fixture, system or item itself. On a page laid out
   * like an index entry, an index entry is the right title.
   *
   * THE NAME IS STILL IN THERE — Edwin, 30 October: "it should always
   * appear in the title and meta description." The name goes last, which is
   * where a title with a pipe in it puts a brand anyway.
   *
   * EXACTLY AS IT WAS GIVEN. "The Austin Plumber" is the case that proves
   * this half is needed: told only to lead with something else, a model
   * will happily write "Austin Plumber" at the end — which is a different
   * company's name. */
  title: 'the <title>, under 60 characters if you can. Lead with the thing '
    + 'the work is done to — the fixture, system, part or item itself — '
    + 'then the town, then the business name last, exactly as it was given. '
    + 'Do not begin with the business name and do not begin with the name '
    + 'of the service. Do not put a price, a time or a guarantee in it',

  /* AND THE DESCRIPTION SAYS WHAT THE PAGE CONTAINS, WHICH IS THE SIXTH
   * SHAPE.
   *
   *   Ledger   lists the services
   *   Beacon   caps it at two kinds of work and writes it for somebody
   *            deciding who to ring
   *   Anvil    says what to do next
   *   Quarry   opens on the symptom and names no service
   *   Harbor   one sentence, the result first
   *   Atlas    says what is ON the page
   *
   * Edwin's complaint on 30 October was that both descriptions were the six
   * services comma-listed and then the four towns: 160 characters of
   * keywords, truncated in a result anyway. A description of the page's own
   * contents is the one remaining shape, it is what a reference entry's
   * abstract does, and it cannot collapse into a keyword list because it
   * has to say what the sections are. */
  meta: 'the meta description, 140-160 characters. Say what this page '
    + 'covers — what the work involves, what changes the cost, and when to '
    + 'call — rather than selling it. Name the town and the state once, and '
    + 'no other town. The business name must appear, exactly as it was '
    + 'given. Do not list services, and do not use a semicolon',
};

/**
 * One service page, in Atlas's voice.
 *
 * THE SAME ARGUMENTS AND THE SAME RETURN as prompt.js — `{ system, user,
 * stance }` — because generate.js calls whichever of the six the structure
 * named and must not know which it got.
 */
function servicePagePrompt(opts = {}) {
  return buildServicePage({ ...opts, voice: ATLAS_VOICE });
}

/** The home page, in Atlas's voice. */
function homePagePrompt(opts = {}) {
  return buildHomePage({ ...opts, voice: ATLAS_VOICE });
}

module.exports = {
  /* RE-EXPORTED UNCHANGED, because they are the same sections and the same
   * stances. generate.js imports SECTIONS from the structure's prompt to
   * count the pages it is about to write; an Atlas that exported a
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
  ATLAS_VOICE,
  servicePagePrompt,
  homePagePrompt,
};
