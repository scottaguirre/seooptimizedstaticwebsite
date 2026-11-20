// utils/localOptions/prompt-orchard.js
//
// Orchard's voice.
//
// WHY — Edwin, 16 November: five new layouts, "different from all layouts
// including github layouts". The rule Beacon set on 30 October still holds
// and this is the sixth file to inherit it.
//
// WHAT THIS FILE IS NOT
//
// It is not a copy of prompt.js or of the five voices beside it. Everything
// in prompt.js which is not voice was paid for in measured runs: the
// no-invented-figures rule, the concrete-noun rule, the spelling rule that
// had to be STATED rather than derived after a Texas site came back saying
// "odour" and "grey water", the heading brief that had to stop describing
// the heading it wanted because a description is a slower dictation, and
// the five section jobs.
//
//     A SEVENTH PROMPT FILE WOULD COPY ALL OF THAT, AND A COPY DRIFTS.
//     THE NEXT FIX LANDS IN ONE OF THE SEVEN, AND NOBODY EVER FINDS OUT
//     FROM THE SIX THAT MISSED IT.
//
// So this is a VOICE handed to the same builder. The sections are the same
// sections and the rules are the same rules, in one place, for all seven.
//
// WHAT ORCHARD ACTUALLY CHANGES
//
//   length    560-690 words a page. Ledger runs 780-1000, Beacon 520-700,
//             Anvil 660-840, Quarry 600-760, Harbor 580-720, Atlas 700-860.
//   register  SPOKEN. Every paragraph is written the way somebody would say
//             it to a customer on the telephone — contractions, short
//             sentences, no clause that has to be read twice.
//   weight    carried by sounding like a person. Ledger leans on the
//             formality of its headings, Beacon on headings carrying the
//             scan, Anvil on verbs, Quarry on the symptom, Harbor on the
//             first clause, Atlas on each block standing alone. This leans
//             on the page sounding like the person who will turn up.
//
// WHY THE LENGTH IS WHAT IT IS. Every section is a CARD, and a card is a
// box with a visible edge: four hundred words inside one is a wall with a
// border drawn round it, which is worse than a wall. Shorter sections keep
// the cards close to square, which is what makes the zigzag legible.
//
//   node test-local-options-orchard.js

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
 * Orchard's length.
 *
 * NOT A GATE, AN INSTRUCTION. Nothing in Local Website Options rejects a
 * page for being long — see the note on WORDS in prompt.js about the
 * runner's LONG flag meaning "longer than this trade has produced before",
 * not "wrong". These numbers steer; they do not refuse.
 */
const WORDS = { min: 560, max: 690 };

/**
 * The lines added to the system prompt, and nothing else is touched.
 *
 * WRITTEN AS RULES ABOUT SENTENCES, NOT AS AN ADJECTIVE. "Be friendly" is
 * the kind of instruction that competes with twenty others and loses — the
 * same failure the spelling line had before it was made explicit. A rule
 * about sentence length, or about a word that may not appear, is checkable
 * by the thing reading it and by the suite.
 *
 * NO EXAMPLE SENTENCES IN HERE. An example in a prompt comes back in the
 * output; that is the lesson the heading brief in prompt.js records, and it
 * applies to voice as much as to headings.
 *
 * THE FIRST RULE IS THE ONE THAT MAKES THIS VOICE DIFFERENT FROM THE OTHER
 * SIX. Ledger and Beacon describe a trade in terms of what it IS, Anvil in
 * terms of what someone DOES, Quarry in terms of what the reader has
 * NOTICED, Harbor in terms of the answer arriving first, Atlas in terms of
 * each block standing alone. This one is simply SAID OUT LOUD, which is a
 * different page about the same facts rather than a shorter or longer one.
 *
 * THE BANNED WORDS ARE THE TEETH. "Be conversational" produces prose that
 * is merely shorter; naming the register words that may not appear is what
 * actually moves it, because those words are how a model writes a trade
 * page when nobody has said otherwise.
 */
const LINES = [
  'HOW THIS PAGE IS WRITTEN — these are in addition to the rules above, '
  + 'and they do not replace any of them:',
  '',
  '- SAY IT, DO NOT WRITE IT. Every sentence should be one somebody would '
  + 'actually say to a customer on the telephone.',
  '- Use contractions where a person would.',
  '- Do not use these words at all: utilise, leverage, ensure, facilitate, '
  + 'comprehensive, seamless, cutting-edge, state-of-the-art, bespoke, '
  + 'robust, holistic.',
  '- No sentence longer than about twenty-five words, and no sentence with '
  + 'more than one comma-separated clause before its main verb.',
  '- Address the reader as you. Do not write about the customer in the '
  + 'third person.',
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
 *
 * THE SHORTEST PARAGRAPHS OF THE SEVEN, because each of the three is its
 * own card and a card wants to stay close to square.
 */
const HOME = { sub: [14, 22], about: [24, 38] };

/**
 * What Orchard's three home-page paragraphs are about.
 *
 * SEVEN SETS OF SUBJECTS NOW, AND THEY HAVE TO STAY SEVEN.
 *
 *   Ledger   where we are        what we do          how a visit starts
 *   Beacon   what brings you     where it happens    repair or replace
 *   Anvil    the first call      the buildings       what finished looks like
 *   Quarry   what goes wrong     what leaving it does  urgent or not
 *   Harbor   who we work for     how the week runs   what we do not take on
 *   Atlas    what the words mean how the year runs   what to check first
 *   Orchard  living with it      why two jobs differ how to tell it was done well
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
 * ALL THREE ARE THINGS A CUSTOMER WORRIES ABOUT AND NO TRADE SITE SAYS.
 * The other six sets describe the business or the subject; these describe
 * the EXPERIENCE of hiring one — the mess, the price that moved, and the
 * nagging question of whether the job was actually any good. That is the
 * angle left, and it is the one that suits a voice whose whole rule is to
 * sound like the person who will turn up.
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
 * NONE OF THEM ALLOWS A LIST. Beacon allows exactly one, Harbor exactly
 * one, Anvil, Quarry and Atlas none. These three are all about how
 * something FEELS or why something VARIES, and neither is a thing a run of
 * bullets can carry — a list of reasons a price moved reads as a price
 * list, which is the one thing this page must not look like.
 */
const HOME_JOBS = [
  /* WHAT IT IS LIKE WHILE IT IS HAPPENING, which nothing else on a trade
   * site admits. Ledger's third brief and Anvil's first are about the
   * CALL; Anvil's third is about what finished looks like. The middle —
   * the hours in between, with the water off and somebody in the hallway —
   * is the part a customer is actually nervous about and the part every
   * site skips.
   *
   * THE GUARD IS AGAINST A PROMISE. "We will be in and out in an hour" is
   * the obvious sentence and it is one nobody can keep from a static
   * page. */
  'What it is actually like having this work done in your home while it is '
  + 'happening — the mess, the noise, whether the water or the power has to '
  + 'go off, and whether you need to be there. Honest rather than '
  + 'reassuring. Do not promise how long anything takes, do not promise a '
  + 'same-day or next-day visit, and do not give a price. Name the towns '
  + 'covered once, in the last sentence, without making them the subject.',

  /* WHY TWO JOBS THAT SOUND THE SAME ARE NOT THE SAME, which is the
   * question behind every "how much is it" call and the one no trade site
   * answers because answering it looks like quoting.
   *
   * THE FENCE IS THE WHOLE BRIEF. It must explain the VARIABLES and name no
   * figure, no range and no comparison between the six services — a
   * paragraph that said one service costs more than another would be a
   * price list written in words. */
  'Why two jobs that sound identical on the phone turn out to be different '
  + 'jobs — access, what is behind the wall, what was done last time, how '
  + 'old the fittings are. Explain what changes the work, never what it '
  + 'costs: no price, no range, no hourly rate, no minimum, and no saying '
  + 'that one kind of job costs more or less than another. Do not quote, '
  + 'estimate or guess at any figure.',

  /* HOW TO TELL IT WAS DONE PROPERLY — the only brief of the twenty-one
   * that hands the reader something to check the trade WITH.
   *
   * AND IT IS ONE SENTENCE AWAY FROM A BOAST. "You can tell it was done
   * properly because we always..." is the paragraph this must not be. So
   * the brief asks for what the READER should look at, in the general, and
   * forbids the business claiming anything about itself. */
  'What a customer can look at afterwards to tell the work was done '
  + 'properly — what a tidy finish looks like, what should have been '
  + 'explained, what should have been left behind. Written as what to look '
  + 'for, not as what this business does: do not claim this business always '
  + 'does any of it, do not say it is better than anyone else, do not '
  + 'mention a guarantee or a warranty, and do not criticise other trades.',
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
 * AND IT IS THE SEVENTH SHAPE, CHECKED AGAINST THE OTHER SIX RATHER THAN
 * ASSUMED — because Atlas's first version was Quarry's rule with a
 * different cap on it, and the table in that file claimed a new shape for a
 * fortnight before a pairwise test caught it.
 *
 *   Ledger   states what the business is
 *   Beacon   names the trade and the town; forbids We, Your, About
 *   Anvil    MUST contain a verb describing work being done
 *   Quarry   MUST NOT contain a verb; five words or fewer
 *   Harbor   MUST address the reader, using the word your
 *   Atlas    MUST BEGIN with the name of the town
 *   Orchard  MUST SPEAK AS THE BUSINESS — we or us
 *
 * THE EXACT INVERSE OF THREE OF THEM. Beacon, Anvil and Atlas all forbid
 * "We"; Harbor demands "your". Demanding the first person is the one
 * position left, and it is the only one that suits a voice whose rule is to
 * sound like the person answering the phone — a heading in the third person
 * over three paragraphs of "we" is two people talking.
 *
 * AND THE DICTATION IS BANNED BY NAME. Ledger's known-bad output is "We Are
 * a Local Plumbing Company in <town>"; requiring "we" without forbidding
 * that exact opening would reproduce it.
 */
const ABOUT_HEADING = 'a heading for this section. It MUST speak as the '
  + 'business, using the word we or us, and it MUST name the town. It MUST '
  + 'NOT begin with the words We are, must not be the words About us, must '
  + 'not be the business name on its own, and must not be a question';

/** Orchard's voice, as prompt.js takes it. */
const ORCHARD_VOICE = {
  key: 'orchard',
  words: WORDS,
  lines: LINES,
  home: HOME,
  homeJobs: HOME_JOBS,
  aboutHeading: ABOUT_HEADING,

  /* ORCHARD DOES NOT RECITE THE SIX SERVICES, for Beacon's reason.
   *
   * The shared instruction "Name the kinds of work in a sentence" is
   * Ledger's second brief said twice. Here the six are a GRID of cards in
   * the very next block, each with its own number, name and line — so a
   * sentence listing them in the paragraph above is the same list twice on
   * one screen.
   *
   * The six are still GIVEN to the model — the list below names them, and a
   * page that contradicted them would be worse. It is just not asked to
   * repeat them in prose. */
  namesServices: false,

  /* THE TWO DIVIDERS.
   *
   * Orchard's break is centred between two short rules, in a 32ch measure
   * with everything around it leaning to one side or the other. It is the
   * one thing on the page that sits in the middle, so it carries more
   * weight than the other structures' breaks and can take a few more words.
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
   *     A LINE THAT NAMES WHAT IS IN THE VAN IS WARM.
   *     A LINE THAT NAMES A FEELING IS FILLER.
   *
   * AND THEY ASK FOR DIFFERENT THINGS FROM THE OTHER FIVE PAIRS. Beacon's
   * both ask for "a short, warm line"; Anvil's for a verb and then for
   * nearness; Quarry's for a place and then a time; Harbor's for a person
   * and then a thing that is not done; Atlas's for something sensed and
   * then something recorded. These ask for something CARRIED and then
   * something TAKEN AWAY — the two ends of a visit, which is the pair left
   * and the one that matches a voice about what the work is like.
   *
   * NO EXAMPLE LINE IN EITHER. An example in a prompt comes back in the
   * output. */
  extras: [
    {
      key: 'firstBreak',
      brief: 'a short line, five to nine words, naming a particular thing '
        + 'this trade carries in the van that most people do not own. No '
        + 'exclamation mark, no superlative, and no claim about being best, '
        + 'fastest, cheapest or guaranteed',
    },
    {
      key: 'secondBreak',
      brief: 'a second short line, five to nine words, about what gets '
        + 'taken away or cleared up at the end of a job. It must not repeat '
        + 'any noun from the line above. No exclamation mark, no '
        + 'superlative, and no claim about being best, fastest, cheapest or '
        + 'guaranteed',
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
   * Harbor's, in Atlas's and in this one.
   *
   *     AN EXCEPTION THAT IS NOT STATED IS NOT AN EXCEPTION.
   *     IT IS TWO RULES AND A COIN TOSS.
   *
   * THE FLOOR THAT STAYS: no superlative and no guarantee. "We strive to
   * provide quality service" is a pleasantry; "the best plumbers in
   * Chicago" is a claim nobody checked, and the no-invented-facts rule is
   * not about taste.
   *
   * AND ONE MORE FLOOR THAT ONLY THIS VOICE NEEDS. The second line is about
   * clearing up, which is one word away from claiming the business always
   * leaves a place spotless — a promise on behalf of every future visit. */
  extrasNote: 'THE TWO DIVIDER LINES — firstBreak and secondBreak — ARE '
    + 'EXEMPT FROM THE NO-MARKETING-REGISTER RULE. They are meant to be '
    + 'ordinary things a local business says to a customer. Every other '
    + 'rule above still applies to them, in particular inventing nothing: '
    + 'no superlative, no best or fastest or cheapest, no guarantee and no '
    + 'number. Neither line may promise what will happen on a future visit, '
    + 'mention another company or trade, or say that anyone does anything '
    + 'badly.',

  /* THE SEVENTH TITLE ANGLE.
   *
   *   Ledger   leads with the business name
   *   Beacon   leads with the kind of work
   *   Anvil    leads with the place
   *   Quarry   leads with the problem
   *   Harbor   leads with the outcome
   *   Atlas    leads with the thing worked on
   *   Orchard  LEADS WITH THE NEXT STEP
   *
   * Two structures leading with the same slot produce two titles of the
   * same shape with a different noun in it, which is what prompted the
   * Beacon rule on 30 October. The next step is a slot none of the other
   * six occupies: every one of them names a THING, and this one names an
   * ACTION.
   *
   * IT WAS A QUESTION UNTIL 19 NOVEMBER, AND THE BRIEF CONTRADICTED ITSELF.
   * It asked for two things that cannot both be true:
   *
   *     MUST end with a question mark
   *     put the business name last, AFTER the question
   *
   * If the name comes after the question, the title does not end with a
   * question mark. The model resolved it the only way left — a second one,
   * after the name — and every Orchard page on the live site carries it:
   *
   *     Need AC help in Austin, TX? Cold Air Conditioning Austin?
   *                               ok                        wrong ^
   *
   *     TWO INSTRUCTIONS THAT CANNOT BOTH HOLD DO NOT PRODUCE
   *     A COMPROMISE. THEY PRODUCE WHATEVER THE MODEL INVENTS
   *     TO SATISFY BOTH.
   *
   * Edwin saw it on the first batch and ruled on the shape rather than the
   * punctuation — 19 November: *"for Orchard don't make it a question in
   * the seo title."* So the question is gone rather than repaired, and the
   * ban is written into the brief so nothing drifts back to it.
   *
   * THE NAME IS STILL IN THERE — Edwin, 30 October: "it should always
   * appear in the title and meta description." The name goes last, which is
   * where a title with a pipe in it puts a brand.
   *
   * AND THE PRICE FLOOR SURVIVES THE REWRITE. It was carried by the old
   * brief's "the question must NOT be about price" and would have been lost
   * with the question. Price, time and guarantees are the three things this
   * page cannot promise, so they are named here directly. */
  title: 'the <title>, under 60 characters if you can. Lead with the NEXT '
    + 'STEP the reader takes — booking, scheduling or arranging the work — '
    + 'named as a plain action, then the town, then the business name last, '
    + 'exactly as it was given. It must NOT be a question and must NOT end '
    + 'with a question mark. Do not begin with the business name, and do '
    + 'not put a price, a time or a guarantee in it',

  /* AND THE DESCRIPTION ANSWERS IT, WHICH IS THE SEVENTH SHAPE.
   *
   *   Ledger   lists the services
   *   Beacon   caps it at two kinds of work, for somebody deciding who to ring
   *   Anvil    says what to do next
   *   Quarry   opens on the symptom and names no service
   *   Harbor   one sentence, the result first
   *   Atlas    says what is ON the page
   *   Orchard  SAYS WHAT HAPPENS WHEN THEY TAKE THAT STEP
   *
   * Edwin's complaint on 30 October was that both descriptions were the six
   * services comma-listed and then the four towns: 160 characters of
   * keywords, truncated in a result anyway. A description that has to
   * describe one specific sequence cannot be a keyword list, which is the
   * one shape the other six can each still produce by accident.
   *
   * IT ANSWERED THE TITLE'S QUESTION UNTIL 19 NOVEMBER, and this brief had
   * to change the same day the title did. The old wording — "It MUST answer
   * the question asked in the title" — would have gone on pointing at a
   * question that is no longer there, and a brief whose subject does not
   * exist is not a weaker brief, it is an arbitrary one.
   *
   *     A BRIEF THAT REFERS TO ANOTHER BRIEF DIES WHEN THAT ONE CHANGES.
   *     THE TWO ARE ONE EDIT, NOT TWO.
   *
   * SO THE PAIRING IS KEPT, with the step in place of the question: the
   * title says what to do, the description says what follows from doing it.
   * A title that asks for a booking and a description that changes the
   * subject is the same failure the question version was warned about. */
  meta: 'the meta description, 140-160 characters. It MUST say plainly, in '
    + 'the first sentence, what happens when the reader takes the step the '
    + 'title names — who they reach and what gets arranged. Name the town '
    + 'and the state once, and no other town. The business name must '
    + 'appear, exactly as it was given. Do not list services, do not ask a '
    + 'question, and do not mention price',
};

/**
 * One service page, in Orchard's voice.
 *
 * THE SAME ARGUMENTS AND THE SAME RETURN as prompt.js — `{ system, user,
 * stance }` — because generate.js calls whichever of the seven the structure
 * named and must not know which it got.
 */
function servicePagePrompt(opts = {}) {
  return buildServicePage({ ...opts, voice: ORCHARD_VOICE });
}

/** The home page, in Orchard's voice. */
function homePagePrompt(opts = {}) {
  return buildHomePage({ ...opts, voice: ORCHARD_VOICE });
}

module.exports = {
  /* RE-EXPORTED UNCHANGED, because they are the same sections and the same
   * stances. generate.js imports SECTIONS from the structure's prompt to
   * count the pages it is about to write; an Orchard that exported a
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
  ORCHARD_VOICE,
  servicePagePrompt,
  homePagePrompt,
};
