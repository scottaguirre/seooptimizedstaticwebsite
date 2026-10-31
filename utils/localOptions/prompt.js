// utils/localOptions/prompt.js
//
// The service-page prompt for Local Website Options.
//
// A NEW PROMPT, NOT createPagesPrompt.js, AND THE DIFFERENCE IS THE POINT.
// Edwin's reason for the whole mode: "What I'm looking is these sites look
// and sound different from the ones we already generate." The layout already
// does. This is the other half.
//
// WHAT THE MAIN GENERATOR DOES, AND WHY THIS DOES NOT
//
// createPagesPrompt.js writes ABOUT A KEYWORD. Its briefs open "on the
// situation that brings someone to search for {keyword}", it picks four
// topics from a list of ten, and it carries a vocabulary table per business
// shape to keep the register concrete. It is good at what it is for: a page
// aimed at a search phrase that keyword research produced.
//
// This mode has no keyword research. It makes no DataForSEO call, it has no
// People Also Ask fetch, and the six service names come from suggestServices
// — one cheap model call. There is no keyword to aim at, so aiming at one
// would be borrowing a constraint that no longer applies.
//
// SO THIS WRITES FROM THE BUSINESS'S SIDE INSTEAD.
//
//   first person plural      "We cover repair and replacement across Leander"
//   a real address, real hours, a real phone number, all given
//   six fixed sections with named jobs, one of which is what affects the cost
//   numbers from the trade, not adjectives
//
// That is a different voice because it is a different speaker, not because
// it was told to vary its adjectives.
//
// THE SECTIONS ARE RATIFIED AND FIXED. Six, approved 27 October. One prompt,
// one quality band and four layouts all describe the same page, which is
// only true while the shape does not move.

'use strict';

/**
 * How a page ENTERS, rotating across the six.
 *
 * THE SIX PAGES SHARE ONE SHAPE, so without this they share one opening
 * too. On a blog that is caught by crossCheck's dupOpenings — six articles
 * beginning the same way is the sameness the whole app exists to avoid — and
 * a six-page site has exactly the same problem with none of the machinery.
 *
 * ORDERED SO NEIGHBOURS DIFFER. Services 1 and 2 are the two a visitor is
 * most likely to read in a row.
 *
 * `id` IS STABLE. It is deterministic by page index so that a rebuild of the
 * same site produces the same assignment — the same reason treatmentFor() in
 * utils/blog/angles.js is a modulo rather than a shuffle.
 */
const STANCES = [
  {
    id: 'noticed',
    brief:
      'Open on what the customer has actually noticed — the sound, the smell, '
      + 'the damp patch, the bill. Name it in the first sentence, before any '
      + 'explanation, and before naming the service.',
  },
  {
    id: 'two-jobs',
    brief:
      'Open by separating two situations that get called the same thing and '
      + 'are not the same job. Say what tells them apart from the hallway, '
      + 'then say that you handle both.',
  },
  {
    id: 'timing',
    brief:
      'Open on when this turns from an annoyance into a problem — what '
      + 'changes if it waits a week, a month, a season. Be concrete about '
      + 'what gets worse rather than warning in general.',
  },
  {
    id: 'what-it-costs-to-wait',
    brief:
      'Open on the thing people try first, why it is reasonable, and why it '
      + 'usually stops working. Do not be smug about it — it is the sensible '
      + 'first move, it just has a limit.',
  },
  {
    id: 'who-calls',
    brief:
      'Open on who actually calls about this and what they say when they do. '
      + 'Use the words they use, not the trade words, then translate.',
  },
  {
    id: 'the-house',
    brief:
      'Open on the kind of property or the age of the fittings where this '
      + 'comes up most, and why. Place it in the area you serve rather than '
      + 'anywhere.',
  },
];

/** The stance for a page, by its position. Deterministic, never random. */
function stanceFor(index) {
  const n = Number(index);
  const i = Number.isFinite(n) ? Math.abs(Math.trunc(n)) : 0;

  return STANCES[i % STANCES.length];
}

/**
 * What the MODEL writes: five blocks of prose.
 *
 * THE RATIFIED SHAPE HAS SIX SECTIONS AND THIS LIST HAS FIVE, WHICH IS NOT A
 * DISCREPANCY. Two of the six are rendered rather than written, so asking the
 * model for them would produce them twice:
 *
 *   1  Hero, with the tap-to-call button     chrome.js hero()
 *      — the model supplies only h1 and blurb, which the hero displays
 *   2  The problem in their words            written, heading and all
 *   3  What the job involves                 written, heading and all
 *   4  What affects the cost                 written, heading and all
 *   5  What to have ready before calling     written, heading and all
 *   6  Where to go next, as a sentence       chrome.js onward()
 *
 * plus the unheaded opening, which is where the stance lands.
 *
 * RATIFIED BY EDWIN ON 27 OCTOBER. The headings are the model's to write — it
 * knows the trade's words — but the jobs are not negotiable, and the cost
 * section is the one that makes this shape worth having.
 *
 * AND UNTIL 28 OCTOBER THE CODE SAID THE OPPOSITE OF THE COMMENT ABOVE IT.
 * Four headings were written out here as fixed strings and the contract told
 * the model to return them verbatim, so every service page on every site this
 * mode has ever built carried the same four h2s:
 *
 *     What people call about / What the visit involves /
 *     What affects the cost  / What to have ready when you call
 *
 * Six pages with identical headings is the same footprint problem that cost
 * the fifth section its old job two paragraphs down — and it reads worse,
 * because a heading is the part a skimmer actually reads. A roofer and a
 * plumber do not call it the same thing, and the model knows what each of
 * them calls it.
 *
 *     A FIXED HEADING IS A SENTENCE THE PROMPT DICTATES.
 *     IT COMES BACK VERBATIM, SIX TIMES, FOR THE SAME REASON
 *     THE DICTATED CLOSING SENTENCE DID.
 *
 * So `heading` is null on all five now, and each section carries a
 * `headingJob` instead: what the heading has to DO. The jobs below are
 * unchanged — the shape is still ratified, it is only the words that moved.
 */
const SECTIONS = [
  {
    key: 'opening',
    heading: null,
    headingJob: null,
    /* "AND ROUGHLY HOW SOON" IS GONE, AND IT IS WHY THE HOURS CAME BACK.
     *
     * The 28 October run cut the dedicated hours section, and all six
     * openings promptly ended with a near-identical availability clause —
     * "during our Monday through Saturday hours", "We are available Monday
     * through Saturday", "during scheduled Monday-through-Saturday
     * appointments". The brief had asked for it, so with nowhere else to put
     * the hours the model put them here.
     *
     *     CUT A SECTION THAT REPEATS AND THE REPETITION FINDS ANOTHER
     *     SECTION. IT IS THE BRIEF THAT REPEATS, NOT THE SECTION.
     *
     * Scheduling belongs to the hours table and the footer, which carry it
     * once each. The opening should close on something that differs by
     * service: whether this is a thing that waits. */
    job:
      'No heading. Two or three paragraphs that enter the page in the way the '
      + 'stance above describes, then close by saying whether this is work '
      + 'that can wait or work that should not, AND WHY FOR THIS PARTICULAR '
      + 'SERVICE. Do NOT mention opening hours, days of the week, or how soon '
      + 'an appointment can be had — the page shows the hours in a table and '
      + 'the footer carries them again.',
  },
  {
    key: 'problem',
    heading: null,
    headingJob:
      'ONE OR TWO OF THE SYMPTOMS THEMSELVES, in the words a customer would '
      + 'use on the phone — the sound, the smell, the thing that stopped '
      + 'working, the thing that is in the wrong place. Not the category they '
      + 'belong to.',
    /* THE BRIEF NO LONGER CONTAINS THE SENTENCE IT WANTS.
     *
     * It used to end: "Then one sentence saying that they are different
     * faults with different bills even though they sound alike from the next
     * room." All six pages in the 28 October run carried that sentence,
     * nearly verbatim. The instruction was obeyed exactly — which is the
     * bug.
     *
     *     A PROMPT THAT DICTATES A SENTENCE GETS THAT SENTENCE, SIX TIMES.
     *     IT READS AS A HOUSE STYLE ON ONE PAGE AND AS A TEMPLATE ON SIX.
     *
     * The job is described instead. Anywhere a brief quotes the output it
     * wants, the same thing is available. */
    job:
      'The symptoms somebody actually types or says on the phone. Three or '
      + 'four of them, concrete and distinguishable. Close the section by '
      + 'making the point — IN YOUR OWN WORDS, not a phrase supplied here '
      + '— that these are separate faults with separate costs even though '
      + 'they are hard to tell apart without looking. THIS IS THE SECTION '
      + 'THAT MATCHES THE SEARCH, and it does it by using the customer’s '
      + 'words.',
  },
  {
    key: 'process',
    heading: null,
    headingJob:
      'what this section is: what happens when you turn up and do the work. '
      + 'Name the thing the trade actually calls the visit — a survey, a '
      + 'callout, a test, a strip-back, an inspection — rather than "the '
      + 'process".',
    job:
      'What is checked, what is measured, what is replaced, and how long it '
      + 'takes. Numbers, not adjectives: minutes, pressures, ages, sizes. Say '
      + 'what is usually done on the same visit and what is booked for another.',
  },
  {
    key: 'cost',
    heading: null,
    headingJob:
      'THE TWO OR THREE THINGS THEMSELVES that move the price on THIS job — '
      + 'the age of the part, the access, a shutoff that has seized, a part '
      + 'that has to be ordered, the material, the depth, the route. NAME '
      + 'THEM. A heading that says the section is about cost, in whatever '
      + 'words, has named nothing: the reader already knows there is a cost '
      + 'section, what they want to know is what it turns on. No figure, no '
      + 'currency symbol, and never "cheap", "affordable" or "competitive".',
    job:
      'NOT A PRICE, AND NEVER A FIGURE. The factors: age, access, whether a '
      + 'shutoff has seized, whether a part has to be ordered, whether sign-off '
      + 'is needed. THIS IS THE HIGHEST-VALUE SECTION ON A LOCAL SERVICE PAGE '
      + 'AND ALMOST NOBODY WRITES IT. Be specific enough that a reader can '
      + 'guess which end of a range they are at.',
  },
  {
    /* WAS "Hours, and the area we cover", AND IT WAS THE SAME BLOCK SIX
     * TIMES. Same address, same four towns, same opening hours, reshuffled,
     * with only the last clause differing by service. Six pages of a small
     * site carrying one duplicated paragraph is the footprint problem this
     * app fights everywhere else.
     *
     * THE HOURS DID NOT VANISH WITH IT. pages.js now renders the hours
     * TABLE on service pages, the same component the home page uses — data
     * in a table reads as reference, where the same facts in prose read as
     * copied. The footer already carries the address, the towns and the
     * number on every page.
     *
     * So the slot keeps its position — the second call to action, after the
     * cost section, which is where it belongs — and gets a job that is
     * different on every page. */
    key: 'ready',
    heading: null,
    headingJob:
      'THE PARTICULAR THINGS THEMSELVES that should be in front of the '
      + 'customer when they ring about THIS job — the model number, the age '
      + 'of the fitting, which room, the make on the plate, where the access '
      + 'is. NAME ONE OR TWO OF THEM. Do not name the act of being ready, and '
      + 'do not use the words "details" or "information": they are what the '
      + 'heading is for, not what it should say.',
    job:
      'What the customer can check or find out BEFORE calling about THIS '
      + 'service, so the visit is booked properly and the right parts come '
      + 'along. Specific to this job and useless on any other page: a model '
      + 'number and where it is printed, the age of the fitting, which room '
      + 'and which fixture, whether anything is running now, how the access '
      + 'is. Three or four things, as prose rather than a list, and KEEP THE '
      + 'WHOLE SECTION TO FIVE OR SIX SENTENCES. Close with the phone number '
      + 'and the particular thing that gets worse if THIS job waits — not a '
      + 'general urging to call.',
  },
];

/**
 * How long a page runs. A band, not a target. ADVISORY — SEE BELOW.
 *
 * MOVED TWICE, BOTH TIMES TO MATCH THE OUTPUT RATHER THAN THE OTHER WAY
 * ROUND, AND THE SECOND MOVE IS THE INTERESTING ONE.
 *
 *   550-750   the original guess, made before anything had been written
 *   650-850   after twelve pages came in at 616-892
 *   780-1000  after six more came in at 785-995
 *
 * Run 2 against 550-750 had four pages over, mean 813. I widened the band by
 * 100 words AND capped the fifth section at five or six sentences. Run 3
 * against 650-850 had four pages over, mean 879.
 *
 * SAME OVERSHOOT, HIGHER FLOOR. The band did not constrain the output; the
 * output followed the band upward. A number stated as a whole-page total is
 * spent wherever the model likes, and raising the total raises the spend.
 *
 * So this number is no longer pretending to be a limit. It is the observed
 * range, written down, and the runner's LONG flag means "longer than this
 * trade has ever produced", not "wrong".
 *
 * THE ONLY UNTRIED FIX IS PER-SECTION. Five sections with a count each leaves
 * no total to reallocate. That is a prompt rewrite and a measured run; it is
 * deliberately not being done now, and this comment is the record of why the
 * number is advisory instead.
 */
const WORDS = { min: 780, max: 1000 };

/**
 * How a structure wants its pages written.
 *
 * ADDED 30 OCTOBER, when Beacon arrived — Edwin asked for "Different
 * prompts" and, on what should differ, chose shorter and more direct.
 *
 * A VOICE, NOT A SECOND PROMPT FILE. Everything in this file that is not
 * voice is hard-won: the no-invented-figures rule, the concrete-noun rule,
 * the spelling rule that had to be stated rather than derived, the heading
 * brief that had to stop describing the heading it wanted, the five section
 * jobs. A second file would copy all of it, and a copy drifts — the next fix
 * lands in one of the two and nobody finds out from the one that missed it.
 *
 *     THE RULES ARE THE PRODUCT. THE VOICE IS THE LAYOUT'S.
 *
 * So a voice says only how long and in what register, and the rules stay in
 * one place for both.
 */
const LEDGER_VOICE = {
  key: 'ledger',
  words: WORDS,
  lines: [],

  /* THE HOME PAGE HAS ITS OWN BUDGET, AND IT WAS MISSED.
   *
   * `words` above is the SERVICE page's, stated as a LENGTH line in its
   * system prompt. The home page has no such line — its lengths live in the
   * JSON template, as "20-30 words" on the sub and "35-60 words each" on the
   * three about paragraphs.
   *
   * So the first version of the voice handed Beacon its style rules and left
   * the home page's numbers at Ledger's. Beacon's home page came out exactly
   * as long as Ledger's, which Edwin spotted by putting the two side by
   * side — the voice looked wired up and half of it was not.
   *
   *     A SETTING THAT IS READ IN TWO PLACES HAS TO BE PASSED TO BOTH.
   *     ONE OF THEM GOING QUIET LOOKS EXACTLY LIKE IT WORKING. */
  home: { sub: [20, 30], about: [35, 60] },

  /* WHAT THE THREE PARAGRAPHS ARE ABOUT.
   *
   * MOVED OUT OF THE USER BLOCK ON 30 OCTOBER. Edwin built one site in each
   * structure and set the two home pages side by side: the same three
   * subjects, in the same order, both opening paragraph three with "A visit
   * starts with" — because the brief said "How a visit starts".
   *
   *     A BRIEF THAT DESCRIBES THE PARAGRAPH IN WORDS GETS THOSE WORDS BACK.
   *
   * That is the dictation lesson the headings taught, one level up. The
   * style rules could not move it, because they govern how a sentence is
   * built and not what it is about.
   *
   * SO THE SUBJECTS BELONG TO THE VOICE. The rules, the facts and the JSON
   * shape stay shared; what the page TALKS ABOUT is the layout's. */
  /* "NAME THE KINDS OF WORK IN A SENTENCE" IS LEDGER'S JOB 2, SAID TWICE.
   *
   * It sat above the three briefs, unconditional, applying to whichever
   * voice was in use. Ledger's second paragraph asks for the same thing, so
   * on Ledger it was harmless repetition. On Beacon, whose second paragraph
   * is about the rooms and the towns, it was an EXTRA job nobody asked
   * for — and the built page did both, listing all six services on top of
   * its own brief and running 44 words against a 25-40 budget.
   *
   *     AN INSTRUCTION THAT APPLIES TO EVERY VOICE IS A RULE.
   *     ONE THAT RESTATES A SINGLE VOICE'S BRIEF IS THAT VOICE'S.
   *
   * Empty means the services are not mentioned outside the briefs. */
  namesServices: true,

  /* WHAT THE TITLE AND THE DESCRIPTION ARE FOR.
   *
   * THEY USED TO SAY ONLY A LENGTH AND A REQUIRED WORD — "under 60
   * characters" and "it MUST name Chicago, IL" — and nothing about what the
   * sentence should SAY. Two sites built the same evening came out as:
   *
   *   The Chicago Plumber | Chicago, IL Plumbing
   *   Chicago Plumbing Company | Chicago, IL Plumbers
   *
   * and two descriptions that were both the six services comma-listed
   * followed by the four towns. Same inputs, same formula, because the
   * formula was the only thing the brief left room for.
   *
   *     A BRIEF THAT GIVES A LENGTH AND NO SUBJECT
   *     GETS THE MOST OBVIOUS SUBJECT, EVERY TIME.
   *
   * NO DOUBLE QUOTES IN EITHER. They land inside a JSON string value in the
   * template below — placeRule() once wrapped a town in quotes there and
   * broke the output for every site with a city in its address. */
  /* FIELDS THIS VOICE ADDS TO THE HOME PAGE'S JSON, beyond the six every
   * structure has. Empty for Ledger: its page has nothing Beacon's does not.
   *
   * THEY COST NOTHING. The home page is one model call either way, so an
   * extra field is two more sentences in a reply that was already being
   * paid for — which is why this is a field on the existing call rather
   * than a seventh call.
   *
   * ANYTHING RETURNED LANDS IN source.home UNTOUCHED. generate.js passes
   * the parsed answer straight through, so a renderer that reads
   * `home.firstBreak` gets it with no wiring in between, and a structure
   * that does not read it is unaffected by its being there. */
  extras: [],

  /* A LINE A VOICE MAY ADD BESIDE ITS EXTRA FIELDS, when one of them needs
   * a rule above relaxed or sharpened. Stated in the RULES block rather
   * than inside the field's description, because that is where the model
   * reads rules — see the spelling line for what a buried instruction is
   * worth. Empty for Ledger, which adds no fields. */
  extrasNote: '',

  title: 'the <title>, under 60 characters if you can. Lead with the '
    + 'business name',

  meta: 'the meta description, 140-160 characters. Say what the company '
    + 'does and the places it does it in',

  homeJobs: [
    'Where you work out of and which towns you cover.',

    'The kinds of work you take on, as a list inside a sentence, and one '
    + 'line on where you repair and where you replace.',

    'How a visit starts — what gets looked at before anybody talks about '
    + 'money. Be concrete.',
  ],

  /* THE ABOUT HEADING'S JOB. Both structures produced near-identical
   * headings — "We Are a Local Plumbing Company in Chicago, IL" and "Your
   * Local Plumbing Company in Chicago, IL" — because both were told to say
   * exactly that. */
  aboutHeading: 'a heading that says you are a local <trade> company in '
    + '<city, state>',
};

/** "Leander, TX" — or just the town, or nothing, without stray commas. */
function placeOf(business = {}) {
  return [business.city, business.state].filter(Boolean).join(', ');
}

/**
 * The rule that puts the town and the state in the title and the description.
 *
 * ADDED 28 OCTOBER, after Edwin read the <head> of a built home page:
 *
 *     <title>Quality Plumbing Leander | Plumbing Repairs</title>
 *     <meta name="description" content="... in Leander and nearby towns.">
 *
 * "the seo title should have the location (city + state). The meta
 * description should also include (city + state)."
 *
 * THE TITLE LOOKED RIGHT AND WAS NOT. "Leander" is in it — as part of the
 * business NAME, which is a different thing from the page saying where the
 * work is done. No state anywhere on the page's two most-read lines, and a
 * search engine matching "plumber leander tx" has to infer the state from
 * the address further down.
 *
 * QUOTING THE PLACE IS DELIBERATE, AND IT IS THE OPPOSITE OF THE HEADINGS
 * RULE TWENTY LINES UP. A heading quoted into a prompt comes back verbatim,
 * which is why none are. Here verbatim is exactly what is wanted: "Leander,
 * TX" is a fact about the business, not a phrase for the model to vary.
 *
 * Returns '' for a business with no town, so a prompt never carries a rule
 * about a place that does not exist.
 */
function placeRule(place) {
  /* NO QUOTATION MARKS IN HERE, AND THAT IS NOT A STYLE CHOICE.
   *
   * This string is interpolated INSIDE a JSON string value, in the template
   * the model is told to copy. The first version wrapped the place in double
   * quotes and produced:
   *
   *     "title": "the <title> ... It MUST contain "Leander, TX" ...",
   *
   * which is not JSON. A prompt that demands valid JSON while showing an
   * example that is not is asking the model to decide which half to believe.
   * The rule paragraph outside the braces may quote the place; this may not.
   */
  return place
    ? ` It MUST name ${place}, spelled exactly that way.`
    : '';
}

/**
 * Which dialect to write in, decided here rather than by the model.
 *
 * DEFAULTS TO US, because every business this mode has is American and an
 * unset country must not quietly change the spelling of a whole site.
 */
const UK_COUNTRIES = new Set(['GB', 'UK', 'IE', 'AU', 'NZ', 'ZA', 'CA']);

function spellingFor(business = {}) {
  const country = String(business.country || 'US').trim().toUpperCase();

  return UK_COUNTRIES.has(country)
    ? 'British English — "colour", "odour", "ageing", "metre"'
    : 'American English — "color", "odor", "aging", "meter", never "odour", '
      + '"discoloured", "ageing" or "grey"';
}

/**
 * The prompt for one service page.
 *
 * RETURNS { system, user }, not a single string. The rules that never change
 * live in `system`; the business and the service live in `user`. Mixing them
 * is how a prompt ends up with the business name inside an instruction and
 * nobody notices it is being obeyed as one.
 *
 * @param {object}   opts
 * @param {object}   opts.business   name, trade, city, state, street, phone
 * @param {object}   opts.service    { slug, name }
 * @param {number}   opts.index      0..5, which fixes the stance
 * @param {string[]} [opts.areas]    the towns covered
 * @param {Array}    [opts.hours]    [{ day, open }]
 * @param {string[]} [opts.siblings] the other five service names
 * @returns {{system: string, user: string}}
 */
function servicePagePrompt({
  business = {}, service = {}, index = 0,
  areas = [], hours = [], siblings = [],

  /* WHICH STRUCTURE'S VOICE. Defaults to Ledger's, so every caller written
   * before Beacon existed gets exactly what it got before. */
  voice = LEDGER_VOICE,
} = {}) {
  const words = (voice && voice.words) || WORDS;
  const stance = stanceFor(index);
  const place = placeOf(business);
  const spelling = spellingFor(business);

  /* THE HEADING AND THE BODY ARE TWO BRIEFS, ON TWO LINES.
   *
   * They used to be one line with the heading quoted in it, which is how a
   * dictated heading got dictated. Separating them is also the only way the
   * heading brief can say anything — "a heading" on the end of a sentence
   * about the body gets whatever is left of the model's attention. */
  const sectionSpec = SECTIONS.map((s, i) => {
    const head = s.headingJob
      ? `HEADING — write one yourself. It names ${s.headingJob}`
      : 'NO HEADING. Return "heading" as an empty string.';

    return `${i + 1}. ${head}\n   BODY — ${s.job}`;
  }).join('\n\n');

  const openHours = hours
    .filter(h => h && h.open)
    .map(h => `${h.day} ${h.open}`)
    .join(', ');

  const closed = hours.filter(h => h && !h.open).map(h => h.day);

  const system = [
    'You write service pages for small local trade businesses.',
    '',
    'YOU ARE WRITING AS THE BUSINESS, not about it. First person plural — '
    + '"we check", "we cover", "we are out from" — throughout. Never "the '
    + 'company" or "this provider".',
    '',
    'RULES THAT DO NOT BEND:',
    '',
    '- NEVER invent a price, a figure, a percentage, a guarantee, a '
    + 'certification, a number of years in business, a number of customers, '
    + 'or a review. If you were not given it, it does not go on the page.',
    '- Numbers that describe the WORK are expected and wanted: how many '
    + 'minutes a check takes, what age a part tends to fail at, what pressure '
    + 'something runs at, what size an opening has to be. Those are trade '
    + 'facts, not claims about this business.',
    '- Every paragraph carries at least one concrete noun — a part, a '
    + 'fixture, a room, a tool, a measurement. A paragraph of adjectives is a '
    + 'paragraph to delete.',
    '- No marketing register. No "nestled", "boasts", "state-of-the-art", '
    + '"unparalleled", "peace of mind", "your trusted partner", "look no '
    + 'further", "we pride ourselves".',
    '- Do not open with the service name. Do not open with the business name. '
    + 'Do not open with a question.',
    /* SPELLING IS STATED, NOT INFERRED.
     *
     * This line used to read "British or American spelling: match the
     * address given." The 28 October run, on a Texas address, produced
     * "odour", "discoloured", "ageing" and "grey water". The instruction was
     * one line among twenty and it lost.
     *
     * An instruction that asks the model to DERIVE a rule competes with
     * every other instruction for attention. One that states the rule does
     * not. */
    `- SPELLING: ${spelling}. This is not a preference, it is the dialect of `
    + 'the country in the address. Do not drift.',
    '',
    `LENGTH: ${words.min} to ${words.max} words across the whole page.`,
    '',
    ...((voice && voice.lines) || []),
    /* THE HEADINGS ARE THE MODEL'S, AND THESE ARE THE ONLY CONSTRAINTS ON
     * THEM. Written as properties a heading must have, never as an example:
     * an example heading in a prompt is a heading in the output.
     *
     * THE CONCRETE-NOUN RULE IS THE ONE THAT DOES THE WORK, and it was added
     * after the first measured run. Six pages came back with no two headings
     * alike, which was the thing at risk — but the cost slot produced "What
     * changes the bill", "What the bill depends on", "What affects the repair
     * cost", "What repair cost depends on" and "Fixture repair cost factors".
     * Five restatements of each other, and all five restatements of the brief
     * that asked for them.
     *
     *     A BRIEF THAT DESCRIBES THE HEADING IN WORDS GETS THOSE WORDS BACK.
     *     IT IS THE DICTATED SENTENCE AGAIN, ONE STEP REMOVED: I STOPPED
     *     QUOTING THE HEADING AND STARTED DESCRIBING IT, AND A DESCRIPTION
     *     IS A SLOWER DICTATION.
     *
     * The sixth was "Pipe routes and job cost", which is the only one of the
     * six that names a THING. So the rule the paragraphs already live under
     * — every one carries a concrete noun — is applied to the headings too,
     * where it matters more: the heading is the line a skimmer reads. */
    'THE HEADINGS ARE YOURS TO WRITE. Four of the five sections below have a '
    + 'heading, and each one says what its heading must NAME, not what it must '
    + 'say. Write the words a person in this trade would use. A heading:',
    '',
    '- is two to six words, and reads as a label rather than a sentence;',
    '- is sentence case, with no full stop, no colon and no question mark;',
    '- CARRIES AT LEAST ONE CONCRETE NOUN FROM THIS JOB — a part, a fixture, '
    + 'a material, a tool, a room, a place. Every paragraph on this page is '
    + 'held to that rule and the heading is the line most people read. A '
    + 'heading built only from abstractions — cost, price, the bill, details, '
    + 'information, factors, signs, problems, process — names nothing, and '
    + 'the section under it has to be read before anyone knows what it '
    + 'holds;',
    '- does NOT repeat the service name — the H1 directly above it already '
    + 'carries that, and a heading that repeats it wastes the one line a '
    + 'skimmer reads;',
    '- is about the subject of THIS page. If the same four headings would sit '
    + 'equally well on any other job this business does, they are too general '
    + '— they are a template, and six pages carrying them read as one page '
    + 'duplicated;',
    /* THE SHAPE, NOT THE STRINGS.
     *
     * This bullet listed the eight headings the first run actually produced,
     * which read well and broke the one test that matters here: the suite
     * asserts that no fixed heading appears anywhere in the prompt, and it
     * cannot tell a banned quotation from a dictated one. Weakening the
     * assertion to allow a ban list would have cost it the ability to catch
     * somebody re-adding a real heading later.
     *
     *     A TEST THAT CANNOT TELL THE TWO APART IS RIGHT TO REFUSE BOTH.
     *
     * The pattern describes them without reproducing any of them. */
    '- does NOT begin with "What" followed by an abstraction. The first '
    + 'measured run produced five headings of exactly that shape across six '
    + 'pages — every one a restatement of the brief that asked for it, and '
    + 'every one transplantable to any page of any trade without alteration;',
    '- is plain. No "unveiling", no "demystifying", no "the ultimate", no '
    + '"everything you need to know".',
    '',
    /* WHAT GIVES WAY WHEN 60 CHARACTERS IS NOT ENOUGH, decided here rather
     * than by the model.
     *
     * IT USED TO BE THE BUSINESS NAME. The rule read "shorten the business
     * name or leave it out altogether — never the place", on the reasoning
     * that somebody searching has typed the town and not the company.
     *
     * EDWIN OVERRULED IT, 30 OCTOBER: "it should always appear in the title
     * and meta description." It is the client's own brand on the client's
     * own page, and a title that quietly renames "The Austin Plumber" to
     * "Austin Plumber" is a thing the owner sees and nobody else explains.
     *
     *     THE NAME AND THE PLACE BOTH STAY. THE WORDS AROUND THEM GIVE.
     *
     * The cost, written down rather than rediscovered: a long business name
     * plus a town can push a title past 60 characters, and Google truncates
     * what does not fit. That is now a deliberate trade, not an accident. */
    ...(place ? [
      `THE TITLE AND THE META DESCRIPTION BOTH CARRY "${place}" AND THE `
      + 'BUSINESS NAME. The name is written exactly as it was given — article '
      + 'and all. Never shortened, never reworded, never dropped. If 60 '
      + 'characters is tight, cut the words AROUND them: the service can be '
      + 'named more briefly, the name and the place cannot be touched.',
      '',
    ] : []),
    'OUTPUT: a single JSON object and nothing else. No markdown fence, no '
    + 'commentary before or after.',
    '',
    '{',
    '  "h1":     "the page heading, which names the service and the town",',
    `  "title":  "the <title>, under 60 characters if you can.${placeRule(place)}",`,
    `  "meta":   "the meta description, 140-160 characters.${placeRule(place)}",`,
    '  "blurb":  "one line for the home page list, under 90 characters",',
    '  "sections": [',
    '    { "heading": "", "paragraphs": ["...", "..."] },',
    '    { "heading": "the heading you wrote for section 2", "paragraphs": ["..."] }',
    '  ]',
    '}',
    '',
    'There must be exactly 5 entries in "sections", in the order the sections '
    + 'are briefed. The FIRST has an empty heading — the page already shows an '
    + 'H1 above it, and a heading there would say the same thing twice. The '
    + 'other FOUR must each carry a heading you wrote, and no two of them may '
    + 'be the same.',
  ].join('\n');

  /* BUILT AS BLOCKS, EACH FILTERED, THEN JOINED.
   *
   * The first draft filtered the whole list with a condition that is always
   * true — `'' !== line || true` — a filter written to look like one that
   * filters, which filtered nothing. A business with no street address would
   * have put a bare "ADDRESS:" into the prompt, and the model would have
   * answered it. */
  const facts = [
    `BUSINESS: ${business.name || ''}`,
    business.trade ? `TRADE: ${business.trade}` : null,
    place ? `BASED IN: ${place}` : null,
    business.street ? `ADDRESS: ${business.street}` : null,
    business.phone ? `PHONE: ${business.phone}` : null,
    areas.length ? `AREA COVERED: ${areas.join(', ')}` : null,
    openHours ? `HOURS: ${openHours}` : null,
    closed.length ? `CLOSED: ${closed.join(', ')}` : null,
  ].filter(Boolean).join('\n');

  const subject = [
    `THIS PAGE IS ABOUT: ${service.name || ''}`,
    siblings.length
      ? `THE OTHER PAGES ON THIS SITE: ${siblings.join(', ')} — do not write `
        + 'about these; one mention in passing is fine if it is genuinely the '
        + 'right next step.'
      : null,
  ].filter(Boolean).join('\n');

  const user = [
    facts,
    subject,
    `HOW TO OPEN THIS ONE: ${stance.brief}`,
    `THE FIVE BLOCKS OF PROSE, IN THIS ORDER:\n\n${sectionSpec}`,
  ].join('\n\n');

  return { system, user, stance: stance.id };
}

/**
 * The home page's own words.
 *
 * MUCH LESS THAN A SERVICE PAGE. The home page is mostly RENDERED — the
 * hero, the NAP strip, the six-service list, the map and the hours table all
 * come from data. What the model writes is the headline, the line under it,
 * and the three short paragraphs that say who this is and where.
 *
 * EDWIN ASKED FOR THE "LOCAL [TRADE] COMPANY IN [CITY, ST]" LINE BY NAME,
 * 26 October: "i think we should add something that says we are a local
 * [business type] company locate in [city, st]. and a few more lines." It is
 * the about heading, and it is not optional.
 *
 * NO SERVICE DETAIL HERE. Six pages carry that. A home page that explains
 * water heaters is a home page competing with its own service page.
 */
function homePagePrompt({ business = {}, services = [], areas = [], voice = LEDGER_VOICE } = {}) {
  const home = (voice && voice.home) || LEDGER_VOICE.home;
  const jobs = (voice && voice.homeJobs) || LEDGER_VOICE.homeJobs;
  const headingJob = (voice && voice.aboutHeading) || LEDGER_VOICE.aboutHeading;

  /* UNDEFINED MEANS LEDGER'S ANSWER, NOT FALSE. A voice written before this
   * field existed must keep the behaviour it had. */
  const namesServices = !voice || undefined === voice.namesServices
    ? LEDGER_VOICE.namesServices
    : voice.namesServices;

  const titleJob = (voice && voice.title) || LEDGER_VOICE.title;
  const metaJob = (voice && voice.meta) || LEDGER_VOICE.meta;
  const extras = (voice && voice.extras) || LEDGER_VOICE.extras;
  const extrasNote = (voice && voice.extrasNote) || LEDGER_VOICE.extrasNote;
  const place = placeOf(business);
  const spelling = spellingFor(business);

  const system = [
    'You write the front page for a small local trade business.',
    '',
    'YOU ARE WRITING AS THE BUSINESS. First person plural throughout.',
    '',
    'RULES THAT DO NOT BEND:',
    '',
    '- NEVER invent a price, a figure, a number of years in business, a '
    + 'number of customers, a certification, a guarantee or a review.',
    '- No marketing register. No "nestled", "boasts", "state-of-the-art", '
    + '"unparalleled", "peace of mind", "your trusted partner", "we pride '
    + 'ourselves".',
    '- DO NOT explain any individual service in detail. Each of them has its '
    + 'own page, and a front page that teaches water heaters is competing '
    + 'with the page that should rank for them.',
    '- Do not mention opening hours or days of the week. The page shows the '
    + 'hours in a table.',
    /* THE CONCRETE-NOUN RULE, WHICH THE HOME PAGE DID NOT HAVE — 30
     * October. The service pages have carried it since the first measured
     * run; this prompt never got it, and the drift it exists to stop turned
     * up on the first two built home pages set side by side: "handling
     * calls across these communities and nearby areas for residential and
     * property plumbing needs."
     *
     * Eighteen words, no fixture, no room, no part. A rule in one of two
     * prompts is a rule half the pages do not have. */
    '- Every paragraph carries at least one concrete noun — a room, a '
    + 'fixture, a part, a tool, a measurement. A paragraph of adjectives is '
    + 'a paragraph to delete. "Needs", "solutions", "services" and '
    + '"communities" are not concrete nouns.',
    `- SPELLING: ${spelling}.`,
    ...(extrasNote ? ['', extrasNote] : []),
    ...((voice && voice.lines) || []),
    '',
    /* THE SAME RULE AS THE SERVICE PAGES, AND THE HOME PAGE IS WHERE IT WAS
     * BROKEN. Its title read "Quality Plumbing Leander | Plumbing Repairs":
     * the town only as part of the company's name, and no state at all. */
    /* WHAT GIVES WAY WHEN 60 CHARACTERS IS NOT ENOUGH, decided here rather
     * than by the model.
     *
     * IT USED TO BE THE BUSINESS NAME. The rule read "shorten the business
     * name or leave it out altogether — never the place", on the reasoning
     * that somebody searching has typed the town and not the company.
     *
     * EDWIN OVERRULED IT, 30 OCTOBER: "it should always appear in the title
     * and meta description." It is the client's own brand on the client's
     * own page, and a title that quietly renames "The Austin Plumber" to
     * "Austin Plumber" is a thing the owner sees and nobody else explains.
     *
     *     THE NAME AND THE PLACE BOTH STAY. THE WORDS AROUND THEM GIVE.
     *
     * The cost, written down rather than rediscovered: a long business name
     * plus a town can push a title past 60 characters, and Google truncates
     * what does not fit. That is now a deliberate trade, not an accident. */
    ...(place ? [
      `THE TITLE AND THE META DESCRIPTION BOTH CARRY "${place}" AND THE `
      + 'BUSINESS NAME. The town appearing inside the business name does not '
      + 'count as the place — a company called after a town is not the same '
      + 'as a page that says where the work is done. The name is written '
      + 'exactly as it was given, article and all: never shortened, never '
      + 'reworded, never dropped. If 60 characters is tight, cut the words '
      + 'AROUND them, never the name and never the place.',
      '',
    ] : []),
    'OUTPUT: a single JSON object and nothing else. No markdown fence, no '
    + 'commentary.',
    '',
    '{',
    /* NO "h1" HERE ANY MORE — 30 October. The home page's heading is built
     * from the business and the place now, not written:
     *
     *     Chicago Plumbing Company / Chicago, IL
     *
     * A field the renderer ignores is worse than no field: the model spends
     * tokens on it, the stored source carries it, and the editor grew a
     * Headline box bound to it that changed nothing when saved. The contact
     * page still has its own h1 and is unaffected. */
    `  "sub":          "one sentence under it, ${home.sub[0]}-${home.sub[1]} words",`,
    `  "title":        "${titleJob}.${placeRule(place)}",`,
    `  "meta":         "${metaJob}.${placeRule(place)}",`,
    `  "aboutHeading": "${headingJob}",`,

    /* THE VOICE'S OWN FIELDS GO BEFORE "about", NOT AFTER IT. Every line
     * here ends in a comma and the last one must not; putting them after
     * would mean either a trailing comma in the example the model copies,
     * or a conditional comma on the line above. Before it, each extra is
     * an ordinary comma'd line and "about" stays last. */
    ...extras.map(field => `  "${field.key}": "${field.brief}",`),

    `  "about":        ["three short paragraphs, ${home.about[0]}-${home.about[1]} words each"]`,
    '}',
  ].join('\n');

  const user = [
    [
      `BUSINESS: ${business.name || ''}`,
      business.trade ? `TRADE: ${business.trade}` : null,
      place ? `BASED IN: ${place}` : null,
      business.street ? `ADDRESS: ${business.street}` : null,
      areas.length ? `AREA COVERED: ${areas.join(', ')}` : null,
    ].filter(Boolean).join('\n'),

    /* THE LIST IS ALWAYS GIVEN — the model needs to know what the site
     * sells, or paragraph two of either voice invents a different six.
     * WHAT CHANGES IS WHETHER IT IS ASKED TO RECITE IT. */
    services.length
      ? `THE SIX PAGES THIS SITE HAS: ${services.map(s => s.name || s).join(', ')}`
        + (namesServices
          ? '\n\nName the kinds of work in a sentence. Do not describe any of them.'
          : '\n\nDo not list them. Do not describe any of them. They are here so '
            + 'that nothing on this page contradicts them.')
      : null,

    /* FROM THE VOICE, NOT TYPED HERE — see homeJobs in LEDGER_VOICE. */
    `THE THREE PARAGRAPHS, IN THIS ORDER:\n\n${
      jobs.map((job, i) => `${i + 1}. ${job}`).join('\n\n')}`,
  ].filter(Boolean).join('\n\n');

  return { system, user };
}

module.exports = {
  STANCES,
  LEDGER_VOICE,
  SECTIONS,
  WORDS,
  UK_COUNTRIES,
  stanceFor,
  placeOf,
  spellingFor,
  servicePagePrompt,
  homePagePrompt,
};
