// utils/localOptions/industries.js
//
// What kind of business this is, in the words the prompts need.
//
// WHY — Edwin added photographs for `lemon-law` on 31 October, which is the
// first thing Local Website Options has ever been pointed at that is not a
// trade. Until then the assumption was invisible because it was always true.
//
// WHAT WOULD HAVE SHIPPED WITHOUT THIS. A lemon-law site built today would
// have been told, in its own system prompt, that it is "a small local trade
// business"; asked for "what is checked, what is measured, what is replaced";
// asked to name "a shutoff that has seized" among the things that move the
// price; and, on Design 3, asked what a finished job looks like "before the
// van leaves". None of it would have failed. All of it would have been wrong,
// on a law firm's own website.
//
//     AN ASSUMPTION THAT HAS ALWAYS BEEN TRUE IS NOT A DECISION ANYBODY
//     REMEMBERS MAKING. IT IS FOUND THE DAY IT STOPS BEING TRUE.
//
// WHAT A PROFILE IS, AND WHAT IT IS NOT
//
//   is       vocabulary. The words a prompt uses for the work, the visit,
//            the things that move the price, and what to have ready.
//   is       the extra rules a field needs that a trade does not — a law
//            firm may not promise an outcome, and nothing in the shared
//            rules says so, because nothing had to.
//   is NOT   the shape. The five sections, their order, their keys and
//            which of them carry a heading are the ratified shape and are
//            the same for everybody. generate.js counts them.
//   is NOT   a second prompt file. prompt.js keeps every rule it has ever
//            been taught; this only supplies the nouns it uses.
//
// THE TRADE PROFILE IS THE STRINGS THAT WERE ALREADY THERE, MOVED. Byte for
// byte — there is a test that holds them to it. Every site built before today
// re-renders identically, which is the only way a change this wide is safe.
//
// HOW A SITE GETS ITS PROFILE: from `business.trade`, which already reaches
// both prompts and is already the name of the image folder. Nothing new is
// threaded through generate.js or the wizard.
//
//   node test-local-options-industry.js

'use strict';

/**
 * A trade: the plumber, the roofer, the electrician.
 *
 * THESE STRINGS ARE NOT NEW. Each one is lifted unchanged out of prompt.js,
 * where it was written over four measured runs — see the comments there for
 * what each one cost. Moving them here must not reword a single one, and the
 * suite compares them against prompt.js's own copies.
 */
const TRADE = {
  key: 'trade',

  /* No match list. It is the default, and a trade nobody has written a
   * profile for is a trade, which is the right guess six times out of
   * seven. */
  match: [],

  pagesLine: 'You write service pages for small local trade businesses.',
  homeLine: 'You write the front page for a small local trade business.',

  nouns: 'a part, a fixture, a room, a tool, a measurement',
  headingNouns: 'a part, a fixture, a material, a tool, a room, a place',
  homeNouns: 'a room, a fixture, a part, a tool, a measurement',
  notConcrete: '"Needs", "solutions", "services" and "communities" are not '
    + 'concrete nouns.',

  dontTeach: 'a front page that teaches water heaters is competing with the '
    + 'page that should rank for them',

  /* NO EXTRA RULES. Everything a trade needs is already in the shared
   * block, which is where it was written. */
  bans: [],

  stances: {},
  sections: {},

  /* EMPTY MEANS "THE VOICE'S OWN", for both of these. A trade is what every
   * voice was written for, so there is nothing to re-aim. */
  homeJobs: {},
  aboutHeading: {},
};

/**
 * A lemon-law practice.
 *
 * NOT A TRADE, AND THE DIFFERENCES ARE NOT COSMETIC. A plumber is asked what
 * is checked, measured and replaced; a firm is asked what is in the file and
 * what is done with it. A plumber's cost section names a seized shutoff; a
 * firm's names the things that decide whether there is a claim at all.
 *
 * THE BANS ARE THE PART THAT MATTERS MOST, and they are the reason this
 * profile is worth more than a find-and-replace. The shared rules forbid
 * inventing a figure, a guarantee or a review — written for a trade, where
 * that covers it. On a law firm's page the dangerous sentences are different
 * ones: a promised outcome, a stated fee, a limitation period given as a
 * number, a statement of what the reader's rights are.
 *
 *     THE NO-INVENTED-FIGURES RULE DOES NOT CATCH "WE WILL GET YOU A
 *     BUYBACK". IT IS NOT A FIGURE. IT IS WORSE THAN ONE.
 *
 * A DEADLINE IS NEVER GIVEN AS A NUMBER. Limitation and presentment periods
 * differ by state and change; a page that prints one is wrong somewhere and
 * will be wrong everywhere eventually. The pages may say a deadline exists —
 * that is true and useful — and must not say what it is.
 *
 * AND NOTHING HERE TELLS THE READER WHAT THE LAW GIVES THEM. The page
 * describes what the firm does. That is a line a trade never has to think
 * about and a firm cannot be allowed to cross by accident.
 */
const LEMON_LAW = {
  key: 'lemon-law',

  match: ['lemon-law', 'lemon law', 'lemonlaw'],

  pagesLine: 'You write practice-area pages for a lemon law firm.',
  homeLine: 'You write the front page for a lemon law firm.',

  nouns: 'a document, a repair order, a part of the vehicle, a date, a stage '
    + 'of the process',
  headingNouns: 'a document, a repair order, a part of the vehicle, a stage '
    + 'of the process, a place',
  homeNouns: 'a document, a repair order, a part of the vehicle, a date, a '
    + 'stage of the process',
  notConcrete: '"Rights", "justice", "representation", "solutions", "needs" '
    + 'and "communities" are not concrete nouns.',

  dontTeach: 'a front page that walks through the whole statute is competing '
    + 'with the page that should rank for it',

  /* THE RULES A TRADE NEVER NEEDED. Stated in the RULES block, where the
   * model reads rules — see the spelling line in prompt.js for what a buried
   * instruction is worth. */
  bans: [
    '- NEVER promise or predict an outcome. No buyback, no replacement, no '
    + 'refund, no settlement, no sum, no "we will win", no "you are entitled '
    + 'to". You may say what the firm does and what usually happens in '
    + 'general; you may not say what will happen for this reader.',
    '- NEVER state a fee, a percentage, an hourly rate, a retainer, or that '
    + 'anything is free or costs nothing. Not even to say the manufacturer '
    + 'pays: that varies and it is a claim about money.',
    '- NEVER give a deadline as a number of days, months or years. Time '
    + 'limits differ by state and change. Saying a deadline exists and that '
    + 'it is worth ringing early is correct; printing one is not.',
    '- Do not state what the law entitles the reader to. Describe what the '
    + 'firm does and what it looks at. The page is not advice and must not '
    + 'read as advice to a particular person.',
    '- Do not name a manufacturer, a model, a dealership or a past case.',
    '- Do not call the reader a client. They have not instructed anybody.',
  ],

  /* HOW A PAGE ENTERS. The six stances are the same six — their ids are
   * fixed and a rebuild has to assign the same one to the same page — with
   * briefs that describe a vehicle and a file rather than a house and a
   * fitting. */
  stances: {
    noticed:
      'Open on what the owner has actually noticed — the warning light, the '
      + 'noise, the stall, the number of times it has been back. Name it in '
      + 'the first sentence, before any explanation, and before naming the '
      + 'practice area.',

    'two-jobs':
      'Open by separating two situations that get called the same thing and '
      + 'are not the same matter. Say what tells them apart from the '
      + 'driveway, then say that you look at both.',

    timing:
      'Open on when this turns from an annoyance into something with a '
      + 'deadline. Be concrete about what gets harder to prove as time '
      + 'passes — not about how long anybody has.',

    'what-it-costs-to-wait':
      'Open on the thing owners try first, why it is reasonable, and why it '
      + 'usually stops working. Do not be smug about it — going back to the '
      + 'dealer is the sensible first move, it just has a limit.',

    'who-calls':
      'Open on who actually calls about this and what they say when they '
      + 'do. Use the words they use, not the legal words, then translate.',

    'the-house':
      'Open on the kind of vehicle or the kind of purchase where this comes '
      + 'up most, and why. Place it in the area you serve rather than '
      + 'anywhere.',
  },

  /* THE FIVE SECTIONS, BY KEY. Only `job` and `headingJob` may be replaced:
   * the keys, the order and which of the five carries a heading are the
   * ratified shape, and generate.js validates against it. */
  sections: {
    opening: {
      job:
        'No heading. Two or three paragraphs that enter the page in the way '
        + 'the stance above describes, then close by saying whether this is '
        + 'something that can wait or something worth looking at now, AND '
        + 'WHY FOR THIS PARTICULAR SITUATION. Do NOT mention office hours or '
        + 'days of the week — the page shows them elsewhere — and do NOT '
        + 'give a time limit as a number.',
    },

    problem: {
      headingJob:
        'ONE OR TWO OF THE SYMPTOMS THEMSELVES, in the words an owner would '
        + 'use on the phone — the warning light, the noise, the thing that '
        + 'stopped working, the number of trips back. Not the legal category '
        + 'they belong to.',
      job:
        'The complaints somebody actually types or says on the phone. Three '
        + 'or four of them, concrete and distinguishable. Close the section '
        + 'by making the point — IN YOUR OWN WORDS, not a phrase supplied '
        + 'here — that these are separate situations with separate answers '
        + 'even though they sound alike from the driveway. THIS IS THE '
        + 'SECTION THAT MATCHES THE SEARCH, and it does it by using the '
        + 'owner’s words.',
    },

    process: {
      headingJob:
        'what this section is: what happens when somebody brings this to '
        + 'you. Name the thing the firm actually calls it — a case review, a '
        + 'file review, a records request, a demand — rather than "the '
        + 'process".',
      job:
        'What is read, what is gathered, what is checked against what, and '
        + 'in what order. Name the documents: the purchase or lease '
        + 'agreement, the repair orders, the dates in and out of the shop, '
        + 'the correspondence with the dealer. Say what is usually settled '
        + 'at the first conversation and what needs the paperwork in front '
        + 'of you. Do not say how long any of it takes.',
    },

    cost: {
      headingJob:
        'THE TWO OR THREE THINGS THEMSELVES that decide how strong a matter '
        + 'like this is — how many repair attempts there were, how long the '
        + 'vehicle was off the road, whether the fault is written down, '
        + 'whether it was bought or leased, whether it is still under '
        + 'warranty. NAME THEM. A heading that says the section is about '
        + 'what matters, in whatever words, has named nothing. No figure, no '
        + 'currency symbol, no fee, and never "free" or "no win no fee".',
      job:
        'NOT A PRICE AND NOT A PREDICTION. The factors that decide whether '
        + 'there is something here and how strong it is: the number of '
        + 'attempts, the days out of service, whether each visit was written '
        + 'up, whether the fault was reported while the warranty was '
        + 'running, whether it was bought or leased, who has the records. '
        + 'THIS IS THE HIGHEST-VALUE SECTION ON A PAGE LIKE THIS AND ALMOST '
        + 'NOBODY WRITES IT. Be specific enough that a reader can tell '
        + 'whether it is worth the phone call — and never tell them what '
        + 'they would get.',
    },

    ready: {
      headingJob:
        'THE PARTICULAR DOCUMENTS OR DETAILS THEMSELVES that should be in '
        + 'front of the owner when they ring about THIS — the repair orders, '
        + 'the purchase or lease agreement, the VIN, the dates, the mileage '
        + 'at each visit. NAME ONE OR TWO OF THEM. Do not name the act of '
        + 'being ready, and do not use the words "details" or "information".',
      job:
        'What the owner can find or check BEFORE calling about THIS, so the '
        + 'first conversation is useful. Specific to this page and useless '
        + 'on any other: which documents, where they usually are, what is '
        + 'written on them, which dates matter. Three or four things, as '
        + 'prose rather than a list, and KEEP THE WHOLE SECTION TO FIVE OR '
        + 'SIX SENTENCES. Close with the phone number and the particular '
        + 'thing that gets harder if this one waits — not a general urging '
        + 'to call, and not a deadline.',
    },
  },

  /* THE HOME PAGE'S THREE PARAGRAPHS, PER VOICE.
   *
   * WHY PER VOICE AND NOT ONE SET. The three subjects belong to the LAYOUT —
   * that is the whole reason they were moved into the voices on 30 October,
   * after Ledger and Beacon produced the same three paragraphs in the same
   * order. An industry that replaced all three with one set would undo it
   * and give every lemon-law site the same home page whichever design was
   * picked.
   *
   * THE ANGLES ARE THE VOICE'S, THE NOUNS ARE THE INDUSTRY'S. Each one below
   * is the same angle its voice uses for a trade, pointed at a file and a
   * vehicle instead of a house and a fitting.
   *
   * A VOICE WITH NO ENTRY HERE KEEPS ITS OWN. That is wrong for this
   * industry rather than merely untidy, so the suite fails when a registered
   * structure is missing — adding a fourth layout forces the question. */
  homeJobs: {
    ledger: [
      'Where the firm works out of and which parts of the state it hears '
      + 'from.',

      'The kinds of vehicle trouble you look at, as a list inside a '
      + 'sentence, and one line on what you do not take on.',

      'How a first call goes — what gets looked at before anybody talks '
      + 'about what happens next. Be concrete about the documents, and '
      + 'promise nothing.',
    ],

    beacon: [
      'The problems that make somebody ring a firm like this in the first '
      + 'place. Name them concretely — what the vehicle does, where it does '
      + 'it, and how many times it has been back. Do not explain what the '
      + 'law provides.',

      'A typical matter, described as it usually goes rather than as a '
      + 'list: what the owner has usually already tried, what the file '
      + 'usually holds, and what is done with it. IN THE GENERAL — never as '
      + 'a particular case, a named client, a named manufacturer or a result '
      + 'you obtained. Name the areas covered once, in the last sentence, '
      + 'without making them the subject.',

      'Another repair attempt, or something more. Take ONE situation and '
      + 'say what would tip it one way and what would tip it the other. One '
      + 'example, followed through — not several named in a row. End on the '
      + 'fact that the owner is told which before anything is started, and '
      + 'do not say what the outcome would be.',
    ],

    anvil: [
      'What happens when somebody rings. What they are asked, what can '
      + 'usually be worked out on the phone, and what needs the paperwork in '
      + 'front of you. Write it in the order it happens. Do not promise a '
      + 'callback time, a deadline or an outcome.',

      'The kinds of vehicle and the kinds of purchase this comes up with — '
      + 'new and used, bought and leased, driven for work and driven for the '
      + 'school run — and what that changes about the file. IN THE GENERAL: '
      + 'never a particular owner, a named manufacturer or a matter that '
      + 'took place. Name the areas covered once, in the last sentence, '
      + 'without making them the subject.',

      'What the end of a matter looks like from the owner’s side — what '
      + 'they are told, what they are handed back, and what they decide. Do '
      + 'not promise a buyback, a replacement, a refund, a settlement or any '
      + 'sum, and do not say any outcome is guaranteed or likely.',
    ],
  },

  /* THE ABOUT HEADING, ALSO PER VOICE, AND FOR THE SAME REASON AS THE THREE
   * PARAGRAPHS.
   *
   * A SINGLE STRING HERE WOULD HAVE BEEN THE EASY VERSION AND WOULD HAVE
   * FLATTENED THE THREE LAYOUTS INTO ONE. Beacon's heading rule and Anvil's
   * differ on purpose — one demands the trade and the town, the other a verb
   * and the town — and a lemon-law site would have lost that difference
   * while gaining nothing.
   *
   * EACH ONE BELOW IS ITS OWN VOICE'S RULE, RE-AIMED. Ledger's is the
   * exception: its shared version dictates the sentence it wants — "a
   * heading that says you are a local <trade> company in <city, state>" —
   * and gets it back with capitals. That is a known fault recorded in
   * prompt.js and this is not the place to fix it in general, but a firm is
   * not a "<trade> company", so Ledger's had to be rewritten here anyway and
   * is written as a property rather than a sentence.
   *
   * AND ALL THREE CARRY THE SAME FLOOR: no claim about results. A heading is
   * the one line a skimmer reads, which makes it the worst place on the page
   * for a promise. */
  aboutHeading: {
    ledger: 'a heading for this section. It MUST say what kind of law this '
      + 'firm practises and MUST name the town and state. It MUST NOT begin '
      + 'with We, Your, Our or About, must not be the business name on its '
      + 'own, and must not claim anything about an outcome',

    beacon: 'a heading for this section. It MUST name the kind of law '
      + 'practised and the town. It MUST NOT begin with the words We, Your '
      + 'or About, must not be the business name on its own, and must not '
      + 'claim anything about an outcome',

    anvil: 'a heading for this section. It MUST contain a verb describing '
      + 'what the firm does, and it MUST name the town. It MUST NOT begin '
      + 'with We, Your, Our or About, must not be the business name on its '
      + 'own, and must not claim anything about an outcome',
  },
};

const PROFILES = [TRADE, LEMON_LAW];

/** `  Lemon Law  ` -> `lemon law`. The same normalising tradeDir() does. */
function normalise(trade) {
  return String(trade == null ? '' : trade).trim().toLowerCase();
}

/**
 * The profile for a trade string, never undefined.
 *
 * FALLS BACK RATHER THAN THROWS, like structureFor(). An industry nobody has
 * written a profile for is a trade, which is right six times out of seven and
 * is in any case the behaviour every site had before this file existed.
 * Refusing to build a paid-for site over an unrecognised trade name would be
 * the worse failure by a wide margin.
 */
function industryFor(trade) {
  const want = normalise(trade);

  if (!want) return TRADE;

  return PROFILES.find(p => p.match.includes(want)) || TRADE;
}

/**
 * The six stances, with this industry's briefs where it has them.
 *
 * THE IDS ARE INVARIANT AND THE ORDER IS INVARIANT. stanceFor() is a modulo
 * over this list and the id is stored on every built page, so a profile that
 * added, dropped or reordered one would re-point the stance of every page of
 * every site on the next rebuild.
 */
function stancesFor(stances, industry) {
  const over = (industry && industry.stances) || {};

  return stances.map(s => (over[s.id] ? { ...s, brief: over[s.id] } : s));
}

/**
 * The five sections, with this industry's briefs where it has them.
 *
 * ONLY `job` AND `headingJob` MOVE. The key, the position and whether a
 * section carries a heading at all are the ratified shape — generate.js
 * counts the sections it gets back and uses `headingJob` as the flag for
 * which positions must carry one. A profile that turned a headingJob null
 * would quietly change what the validator accepts.
 */
function sectionsFor(sections, industry) {
  const over = (industry && industry.sections) || {};

  return sections.map(s => {
    const mine = over[s.key];

    if (!mine) return s;

    return {
      ...s,
      job: mine.job || s.job,
      /* NULL STAYS NULL. The opening has no heading and may not grow one. */
      headingJob: s.headingJob ? (mine.headingJob || s.headingJob) : null,
    };
  });
}

module.exports = {
  TRADE,
  LEMON_LAW,
  PROFILES,
  industryFor,
  stancesFor,
  sectionsFor,
  normalise,
};
