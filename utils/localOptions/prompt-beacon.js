// utils/localOptions/prompt-beacon.js
//
// Beacon's voice.
//
// WHY — Edwin, 30 October, asking for a second structure: "Different
// prompts. Keep the same sections." And, on what should differ: shorter and
// more direct.
//
// WHAT THIS FILE IS NOT
//
// It is not a copy of prompt.js. Everything in that file which is not voice
// was paid for in measured runs: the no-invented-figures rule, the
// concrete-noun rule, the spelling rule that had to be STATED rather than
// derived after a Texas site came back saying "odour" and "grey water", the
// heading brief that had to stop describing the heading it wanted because a
// description is a slower dictation, and the five section jobs.
//
//     A SECOND PROMPT FILE WOULD COPY ALL OF THAT, AND A COPY DRIFTS.
//     THE NEXT FIX LANDS IN ONE OF THE TWO, AND NOBODY EVER FINDS OUT
//     FROM THE ONE THAT MISSED IT.
//
// So this is a VOICE handed to the same builder. The sections are the same
// sections — which is what was asked for — and the rules are the same rules,
// in one place, for both structures.
//
// WHAT BEACON ACTUALLY CHANGES
//
//   length    520-700 words a page, against Ledger's 780-1000
//   register  short sentences, no subordinate clauses stacked up
//   weight    more of the page carried by the headings, less by the prose
//
// WHY SHORTER SUITS THE LAYOUT RATHER THAN JUST BEING SHORTER. Beacon sets
// the service pages as prose with the hours slate beside them, and lays the
// services out as tiles. A tile with a four-line blurb stops being a tile,
// and a column with a sidebar next to it is narrower than Ledger's full
// measure — the same paragraph runs visibly longer in it.
//
//   node test-local-options-beacon.js

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
 * Beacon's length.
 *
 * NOT A GATE, AN INSTRUCTION. Nothing in Local Website Options rejects a
 * page for being long — see the note on WORDS in prompt.js about the runner's
 * LONG flag meaning "longer than this trade has produced before", not
 * "wrong". These numbers steer; they do not refuse.
 *
 * ABOUT TWO THIRDS OF LEDGER, SPREAD OVER THE SAME FIVE SECTIONS. Cutting a
 * section instead would have been the easy way to get here and would have
 * broken the one thing that was not to change.
 */
const WORDS = { min: 520, max: 700 };

/**
 * The lines added to the system prompt, and nothing else is touched.
 *
 * WRITTEN AS RULES ABOUT SENTENCES, NOT AS AN ADJECTIVE. "Write in a punchy
 * style" is the kind of instruction that competes with twenty others and
 * loses — the same failure the spelling line had before it was made
 * explicit. A cap on sentence length is checkable by the thing reading it.
 *
 * NO EXAMPLE SENTENCES IN HERE. An example in a prompt comes back in the
 * output; that is the lesson the heading brief in prompt.js records, and it
 * applies to voice as much as to headings.
 */
const LINES = [
  'HOW THIS PAGE IS WRITTEN — these are in addition to the rules above, '
  + 'and they do not replace any of them:',
  '',
  '- SHORT SENTENCES. Most under 20 words. Never stack two subordinate '
  + 'clauses in one sentence.',
  '- Two or three sentences a paragraph, not five. A paragraph that needs a '
  + 'fourth is two paragraphs.',
  '- Say the thing first and qualify it after, never the other way round. Do '
  + 'not open a sentence with "While", "Although" or "When it comes to".',
  '- The headings carry more of this page than they would elsewhere. A '
  + 'reader who reads only the headings should still know what the section '
  + 'says.',
  '- Cut every word that is not doing work. "In order to" is "to". "A number '
  + 'of" is a number. "Due to the fact that" is "because".',
  '',
];

/**
 * The home page's own numbers.
 *
 * SEPARATE FROM `WORDS` BECAUSE THE HOME PAGE IS BUILT DIFFERENTLY. The
 * service page is given a LENGTH line in its system prompt; the home page's
 * lengths live in its JSON template, on the sub line and on the three about
 * paragraphs. The first version of this voice set only the service-page
 * budget, so Beacon's home page came out exactly as long as Ledger's —
 * caught by putting the two built pages side by side, not by any test.
 *
 * ABOUT TWO THIRDS AGAIN, matching what WORDS does to the service pages.
 */
const HOME = { sub: [14, 22], about: [25, 40] };

/**
 * What Beacon's three home-page paragraphs are about.
 *
 * WHY THESE AND NOT LEDGER'S — 30 October. Edwin built one site in each
 * structure and set the two home pages beside each other. Same three
 * subjects, same order, and both paragraph threes opened "A visit starts
 * with", because Ledger's brief says "How a visit starts".
 *
 *     A BRIEF THAT DESCRIBES THE PARAGRAPH IN WORDS GETS THOSE WORDS BACK.
 *     THE STYLE RULES COULD NOT MOVE IT: THEY GOVERN HOW A SENTENCE IS
 *     BUILT, NOT WHAT IT IS ABOUT.
 *
 * So these are different SUBJECTS, not different wordings of the same three.
 *
 *   Ledger   where we are      what we do        how a visit starts
 *   Beacon   what brings you   where it happens  repair or replace
 *
 * WHAT THEY CANNOT DO. The model is given the business name, the trade, the
 * address, the towns and six service names — nothing else. Different briefs
 * change the ANGLE; they cannot invent facts, and two plumbing sites will
 * always share a lot because the input does. Anything that needed a team
 * size, a number of vans or a year founded was left out of these on
 * purpose: the no-invented-figures rule would refuse it, and a brief that
 * asks for something the rules forbid produces a worse paragraph than one
 * that never asked.
 *
 * AND THEY DO NOT EXPLAIN A SERVICE. The system prompt already forbids it —
 * each of the six has its own page, and a front page teaching water heaters
 * competes with the page that should rank for them. Naming a SYMPTOM is not
 * explaining a service, which is what makes the first one safe.
 */
const HOME_JOBS = [
  /* THE ONE THAT MAY BE A LIST, AND ONLY THIS ONE.
   *
   * The first draft of these three asked for enumeration three times —
   * "name the symptoms", "the rooms, the fixtures and the runs", "named by
   * the part or the condition" — and got back exactly that: three lists in
   * a row. Different subjects, identical shape, and a page that reads as a
   * specification rather than as a company talking.
   *
   *     THREE BRIEFS THAT ASK FOR A LIST PRODUCE A LIST OF LISTS.
   *     THE SUBJECT WAS NEVER THE PROBLEM; THE SHAPE WAS.
   *
   * Symptoms are the one place a list earns its keep: a reader scanning for
   * their own problem wants to find it, not read a paragraph about problems
   * in general. */
  'The problems that make somebody ring this trade in the first place. Name '
  + 'the symptoms concretely — what is heard, seen or smelt, and where in a '
  + 'building. Do not explain how any of them is fixed.',

  /* NO LIST HERE. The previous version asked for "the rooms, the fixtures
   * and the runs between them", which is a list wearing a sentence, and the
   * page duly produced one. This asks for one job followed through instead,
   * which cannot be enumerated.
   *
   * AND IT IS A TYPICAL JOB, NOT A JOB THAT HAPPENED. The first draft said
   * "where in a building it was, what was found, and what happened next" —
   * past tense, which is an invitation to invent a visit, a customer and an
   * outcome. Nothing in the rules forbids a story in so many words, because
   * they forbid invented FIGURES; a fabricated case study slips between
   * them and reads as a reference nobody can check.
   *
   *     THE RULE SAYS DO NOT INVENT A NUMBER.
   *     A NARRATED JOB IS AN INVENTED EVENT, WHICH IS WORSE. */
  'A typical job of this trade, described as it usually goes rather than as '
  + 'a list: where in a building it happens, what is usually behind it, and '
  + 'what the work involves. IN THE GENERAL — never as a particular visit '
  + 'that took place, a named customer or a job you did. Name the towns '
  + 'covered once, in the last sentence, without making them the subject.',

  /* NOR HERE. "Named by the part or the condition" produced "pipe damage,
   * faucet wear, toilet condition, and the state of a water heater" — a
   * third list. One example carried through is a paragraph; four examples
   * side by side is a table. */
  'Repair or replace. Take ONE thing this trade commonly deals with and say '
  + 'what would tip it one way and what would tip it the other. One example, '
  + 'followed through — not several named in a row. End on the fact that the '
  + 'customer is told which before any price is discussed.',
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
 * came back as five restatements of the brief that asked for them. No
 * example heading here either: an example in a prompt is an example in the
 * output.
 */
const ABOUT_HEADING = 'a heading for this section. It MUST name the trade '
  + 'and the town. It MUST NOT begin with the words We, Your or About, and '
  + 'it must not be the business name on its own';

/** Beacon's voice, as prompt.js takes it. */
const BEACON_VOICE = {
  key: 'beacon',
  words: WORDS,
  lines: LINES,
  home: HOME,
  homeJobs: HOME_JOBS,
  aboutHeading: ABOUT_HEADING,

  /* BEACON DOES NOT RECITE THE SIX SERVICES — 30 October.
   *
   * The shared instruction "Name the kinds of work in a sentence" is
   * Ledger's second brief said twice. On Ledger that is harmless; on
   * Beacon, whose second paragraph is about one job in one building, it was
   * an extra job nobody asked for. The built page did both: its own brief,
   * then all six services listed after it, 44 words against a 25-40 budget.
   *
   * The six are still GIVEN to the model — the tiles below name them, and a
   * page that contradicted them would be worse. It is just not asked to
   * repeat them in prose. */
  namesServices: false,

  /* THE TWO DIVIDERS — Edwin, 30 October: "can we add like a section
   * divider that has a generic heading such as: We are here for you. It's a
   * pleasure to serve you."
   *
   * WRITTEN PER SITE RATHER THAN FIXED, which he chose after the trade-off
   * was put to him. A fixed pair of sentences would be identical on every
   * site under 7-y.xyz — and to Google a subdirectory is the same site, so
   * that is one page's worth of boilerplate repeated across all of them,
   * not a coincidence between strangers.
   *
   * AND THE EXAMPLES HE GAVE ARE THE REGISTER THE RULES BAN. "We are here
   * for you" is the same family as "peace of mind" and "your trusted
   * partner", which the system prompt refuses by name. So the briefs below
   * aim at what he actually wants — a warm line that breaks the page — and
   * get there by demanding a THING rather than a feeling.
   *
   *     A LINE THAT NAMES A PHONE, A VAN OR A STREET IS WARM.
   *     A LINE THAT NAMES A FEELING IS FILLER.
   *
   * NO EXAMPLE LINE IN EITHER BRIEF. An example in a prompt comes back in
   * the output, which is the lesson the headings and the three paragraphs
   * both taught. */
  extras: [
    {
      key: 'firstBreak',
      brief: 'a short, warm line of the kind a local business says to a '
        + 'customer, six to ten words. Plain and ordinary. No exclamation '
        + 'mark, no superlative, and no claim about being best, fastest, '
        + 'cheapest or guaranteed',
    },
    {
      key: 'secondBreak',
      brief: 'a second short, warm line of the same kind, six to ten words, '
        + 'saying something different from the line above. No exclamation '
        + 'mark, no superlative, and no claim about being best, fastest, '
        + 'cheapest or guaranteed',
    },
  ],

  /* THE ONE PLACE THE MARKETING-REGISTER RULE IS LIFTED, AND IT HAS TO BE
   * SAID OUT LOUD.
   *
   * The system prompt refuses that register by name — "peace of mind",
   * "your trusted partner" — and the dividers are the one thing on the page
   * that is MEANT to be a pleasantry. Edwin, 30 October: "forget about
   * trade. Just say something nice coming from a local business to a
   * customer such as: We are here to serve you."
   *
   * Without this line the brief and the rules pull opposite ways, and two
   * instructions in opposite directions is how a page ends up with
   * neither — which is a test in this very suite.
   *
   *     AN EXCEPTION THAT IS NOT STATED IS NOT AN EXCEPTION.
   *     IT IS TWO RULES AND A COIN TOSS.
   *
   * THE FLOOR THAT STAYS: no superlative and no guarantee. "We strive to
   * provide quality service" is a pleasantry; "the best plumbers in
   * Chicago" is a claim nobody checked, and the no-invented-facts rule is
   * not about taste. */
  extrasNote: 'THE TWO DIVIDER LINES — firstBreak and secondBreak — ARE '
    + 'EXEMPT FROM THE NO-MARKETING-REGISTER RULE. They are meant to be '
    + 'ordinary pleasantries a local business says to a customer. Every '
    + 'other rule above still applies to them, in particular inventing '
    + 'nothing: no superlative, no best or fastest or cheapest, no '
    + 'guarantee, no number.',

  /* BEACON'S TITLE LEADS WITH THE WORK, NOT THE NAME.
   *
   * Ledger's leads with the business name, which is right for a page whose
   * job is to be the company's front door. Two sites doing that produced
   * two titles with the same shape and a different noun in the first slot.
   *
   * NOT OPENING WITH "The" IS A SMALL RULE WITH A REASON: the business name
   * most often starts with it, so a title told to lead with the work and
   * beginning "The" has usually just put the name first anyway. */
  /* LEAD WITH THE WORK — AND THE NAME IS STILL IN THERE, after it. Edwin,
   * 30 October: "it should always appear in the title and meta
   * description." The two are not in tension: the name goes at the end,
   * which is where a title with a pipe in it puts a brand anyway.
   *
   * "The Austin Plumber" is the case that proves the rule needs both
   * halves. Told only not to begin with The, a model satisfies it by
   * writing "Austin Plumber" — which is a different company's name. */
  title: 'the <title>, under 60 characters if you can. Lead with the kind '
    + 'of work rather than the business name, and do not begin with the '
    + 'word The. The business name still appears, after the work, exactly '
    + 'as it was given',

  /* AND THE DESCRIPTION IS CAPPED — Edwin, 30 October, on the second site.
   *
   * Both descriptions were the six services comma-listed and then the four
   * towns: 160 characters of keywords, truncated in a result anyway, and
   * reading as a list of what is sold rather than a reason to ring. Ledger
   * keeps its list; this one does not.
   *
   * TWO IS THE CAP BECAUSE ONE READS AS THE ONLY THING THEY DO. */
  meta: 'the meta description, 140-160 characters. Name AT MOST TWO kinds '
    + 'of work — the page itself lists the rest. Name the town and the '
    + 'state once and no other towns. Write it for somebody deciding who to '
    + 'ring, not as a list of what is sold',
};

/**
 * One service page, in Beacon's voice.
 *
 * THE SAME ARGUMENTS AND THE SAME RETURN as prompt.js — `{ system, user,
 * stance }` — because generate.js calls whichever of the two the structure
 * named and must not know which it got.
 */
function servicePagePrompt(opts = {}) {
  return buildServicePage({ ...opts, voice: BEACON_VOICE });
}

/** The home page, in Beacon's voice. */
function homePagePrompt(opts = {}) {
  return buildHomePage({ ...opts, voice: BEACON_VOICE });
}

module.exports = {
  /* RE-EXPORTED UNCHANGED, because they are the same sections and the same
   * stances. generate.js imports SECTIONS from the structure's prompt to
   * count the pages it is about to write; a Beacon that exported a different
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
  BEACON_VOICE,
  servicePagePrompt,
  homePagePrompt,
};
