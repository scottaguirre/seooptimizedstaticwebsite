// test-local-options-industry.js
//
// What kind of business a site is for, and the day that stopped being obvious.
//
// WHAT THIS IS GUARDING. Local Website Options assumed a trade everywhere,
// invisibly, because the assumption had always been true. On 31 October Edwin
// added photographs for `lemon-law` and it stopped being true.
//
// THE TWO FAILURES THIS SUITE EXISTS FOR, AND THEY PULL OPPOSITE WAYS
//
//   1  A lemon-law site told it is "a small local trade business", asked what
//      is "checked, measured and replaced", and asked on Design 3 what a
//      finished job looks like "before the van leaves". None of it fails.
//      All of it is wrong, on a law firm's own website.
//
//   2  A change wide enough to fix that, quietly rewording the trade prompt
//      on the way past. Every plumbing site ever built re-renders from these
//      strings; a stray comma here is a different page on every one of them.
//
// SO THE TRADE STRINGS ARE ASSERTED BYTE FOR BYTE BELOW. They are the
// originals, pasted out of prompt.js before the profiles existed. If a
// refactor reworded one, this suite is the only thing that would say so.
//
//     A REFACTOR THAT IMPROVES A STRING IN PASSING IS NOT A REFACTOR.
//
//   node test-local-options-industry.js

'use strict';

const assert = require('assert');

const prompt = require('./utils/localOptions/prompt');
const beaconPrompt = require('./utils/localOptions/prompt-beacon');
const anvilPrompt = require('./utils/localOptions/prompt-anvil');

const {
  TRADE, LEMON_LAW, PROFILES, industryFor, stancesFor, sectionsFor, normalise,
} = require('./utils/localOptions/industries');

const { STANCES, SECTIONS, LEDGER_VOICE } = prompt;

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

function section(n) { console.log(`\n${n}\n`); }

const PLUMBER = {
  name: 'Round Rock Plumbing', trade: 'plumbing',
  city: 'Round Rock', state: 'TX', phone: '(512) 555-0199',
};

const FIRM = {
  name: 'Hill Country Lemon Law', trade: 'lemon-law',
  city: 'Austin', state: 'TX', phone: '(512) 555-0144',
};

const SERVICE = { slug: 'drain-cleaning', name: 'drain cleaning' };
const MATTER = { slug: 'vehicle-buyback-claims', name: 'vehicle buyback claims' };

const SIX = ['a', 'b', 'c', 'd', 'e', 'f'].map(s => ({ slug: s, name: s }));

const svc = (business, service, over = {}) =>
  prompt.servicePagePrompt({ business, service, index: 0, areas: ['Austin'], ...over });

const home = (business, voice) =>
  prompt.homePagePrompt({ business, services: SIX, areas: ['Austin'], voice });

const whole = out => `${out.system}\n${out.user}`;

/* ======================================================================= */

section('THE TRADE PROMPT DID NOT MOVE');

test('THE OPENING LINE OF BOTH PROMPTS IS WHAT IT WAS', () => {
  /* Pasted from prompt.js as it stood before industries.js existed. Every
   * plumbing site ever built re-renders from these. */
  assert.ok(svc(PLUMBER, SERVICE).system.startsWith(
    'You write service pages for small local trade businesses.'));

  assert.ok(home(PLUMBER, LEDGER_VOICE).system.startsWith(
    'You write the front page for a small local trade business.'));
});

test('and the concrete-noun rule is unchanged, on both, to the character', () => {
  /* The rule that does the work. It was added after the first measured run
   * and the home page did not get it until 30 October; a reworded copy
   * would be a third version nobody asked for. */
  assert.ok(svc(PLUMBER, SERVICE).system.includes(
    '- Every paragraph carries at least one concrete noun — a part, a '
    + 'fixture, a room, a tool, a measurement. A paragraph of adjectives is a '
    + 'paragraph to delete.'));

  assert.ok(home(PLUMBER, LEDGER_VOICE).system.includes(
    '- Every paragraph carries at least one concrete noun — a room, a '
    + 'fixture, a part, a tool, a measurement. A paragraph of adjectives is '
    + 'a paragraph to delete. "Needs", "solutions", "services" and '
    + '"communities" are not concrete nouns.'));
});

test('and so is the heading rule, which is the one that cost five runs', () => {
  assert.ok(svc(PLUMBER, SERVICE).system.includes(
    '- CARRIES AT LEAST ONE CONCRETE NOUN FROM THIS JOB — a part, a fixture, '
    + 'a material, a tool, a room, a place. Every paragraph on this page is '
    + 'held to that rule and the heading is the line most people read.'));
});

test('and the home page still names the example it always named', () => {
  assert.ok(home(PLUMBER, LEDGER_VOICE).system.includes(
    '- DO NOT explain any individual service in detail. Each of them has its '
    + 'own page, and a front page that teaches water heaters is competing '
    + 'with the page that should rank for them.'));
});

test('A TRADE GETS NO EXTRA RULES, SO ITS RULES BLOCK IS THE OLD ONE', () => {
  /* The bans are spliced in with a spread. An industry with none must add
   * nothing at all — not an empty line, not a stray separator. */
  assert.deepStrictEqual(TRADE.bans, []);

  const s = svc(PLUMBER, SERVICE).system;

  /* The line that used to follow the trade-facts bullet still does. */
  assert.ok(s.includes(
    'facts, not claims about this business.\n'
    + '- Every paragraph carries at least one concrete noun'));
});

test('and its stances and sections are the shared ones, not copies', () => {
  /* `===`, not deepStrictEqual. An industry with no overrides must hand
   * back the very same objects — a copy would drift the day somebody edits
   * one of them. */
  assert.strictEqual(stancesFor(STANCES, TRADE)[0], STANCES[0]);
  assert.strictEqual(sectionsFor(SECTIONS, TRADE)[2], SECTIONS[2]);

  for (let i = 0; i < STANCES.length; i += 1) {
    assert.strictEqual(stanceFromTrade(i), STANCES[i % STANCES.length]);
  }

  function stanceFromTrade(i) {
    return prompt.stanceFor(i, TRADE);
  }
});

test('AND AN UNKNOWN TRADE IS A TRADE, NOT A FAILED BUILD', () => {
  /* Six of the seven trade folders have no profile and never will. Refusing
   * to build a paid-for site over an unrecognised trade name would be the
   * worse failure by a wide margin. */
  assert.strictEqual(industryFor('roofing'), TRADE);
  assert.strictEqual(industryFor('tree-service'), TRADE);
  assert.strictEqual(industryFor(''), TRADE);
  assert.strictEqual(industryFor(null), TRADE);
  assert.strictEqual(industryFor(undefined), TRADE);
  assert.strictEqual(industryFor({}), TRADE);
});

/* ======================================================================= */

section('A LEMON-LAW SITE IS NOT A TRADE SITE');

test('IT IS NOT CALLED A TRADE BUSINESS ANYWHERE', () => {
  /* The sentence that would have shipped on a law firm's own website. */
  const pages = whole(svc(FIRM, MATTER));
  const front = whole(home(FIRM, LEDGER_VOICE));

  assert.ok(!/trade business/i.test(pages), 'a practice page calls it a trade business');
  assert.ok(!/trade business/i.test(front), 'the front page calls it a trade business');

  assert.ok(pages.startsWith('You write practice-area pages for a lemon law firm.'));
});

test('and it is not asked what is measured, replaced or seized', () => {
  /* The five section briefs are where the trade assumption was thickest:
   * "what is checked, what is measured, what is replaced", "a shutoff that
   * has seized", "which room and which fixture". */
  const pages = whole(svc(FIRM, MATTER));

  for (const word of ['shutoff', 'fixture', 'which room', 'the depth', 'strip-back']) {
    assert.ok(!pages.includes(word), `a lemon-law page is asked about "${word}"`);
  }

  assert.ok(pages.includes('repair orders'), 'it is not asked for the documents');
  assert.ok(pages.includes('purchase or lease agreement'));
});

test('THE STANCE IS RE-AIMED, AND ITS ID IS NOT', () => {
  /* The id is stored on every built page and the POSITION is what assigns
   * it. A profile that reordered or renamed one would re-point the stance of
   * every page of every site on its next rebuild. */
  for (let i = 0; i < 8; i += 1) {
    assert.strictEqual(
      prompt.stanceFor(i, LEMON_LAW).id,
      prompt.stanceFor(i, TRADE).id,
      `stance ${i} changed id for lemon law`);
  }

  assert.ok(whole(svc(FIRM, MATTER, { index: 0 })).includes('warning light'));
  assert.ok(!whole(svc(FIRM, MATTER, { index: 0 })).includes('the damp patch'));
});

test('and the five sections keep their keys, their order and their headings', () => {
  /* generate.js counts the sections it gets back and uses `headingJob` as
   * the flag for which positions must carry a heading. A profile that
   * dropped one, added one, or grew a heading on the opening would change
   * what the validator accepts without touching the validator. */
  const mine = sectionsFor(SECTIONS, LEMON_LAW);

  assert.strictEqual(mine.length, SECTIONS.length);

  mine.forEach((s, i) => {
    assert.strictEqual(s.key, SECTIONS[i].key, `section ${i} changed key`);
    assert.strictEqual(
      Boolean(s.headingJob), Boolean(SECTIONS[i].headingJob),
      `section ${i} changed whether it carries a heading`);
  });

  assert.strictEqual(mine[0].headingJob, null, 'the opening grew a heading');
});

test('AND EVERY SECTION BRIEF ACTUALLY CHANGED', () => {
  /* A profile that declared an override for a key it spelled wrong would
   * silently keep the trade brief, and nothing else here would notice. */
  const mine = sectionsFor(SECTIONS, LEMON_LAW);

  mine.forEach((s, i) => {
    assert.notStrictEqual(s.job, SECTIONS[i].job, `section ${s.key} kept the trade brief`);

    if (s.headingJob) {
      assert.notStrictEqual(
        s.headingJob, SECTIONS[i].headingJob,
        `section ${s.key} kept the trade heading brief`);
    }
  });
});

/* ======================================================================= */

section('WHAT A LAW FIRM MAY NOT SAY');

test('THE OUTCOME BAN IS ON BOTH PROMPTS, NOT JUST THE SERVICE PAGES', () => {
  /* The home page is where a promise is most likely to land — it is the
   * page that introduces the business — and it had none of these rules
   * until the block was added to both.
   *
   *     THE NO-INVENTED-FIGURES RULE DOES NOT CATCH
   *     "WE WILL GET YOU A BUYBACK". IT IS NOT A FIGURE. */
  for (const out of [svc(FIRM, MATTER), home(FIRM, LEDGER_VOICE)]) {
    const s = out.system;

    assert.ok(/NEVER promise or predict an outcome/.test(s), 'no outcome ban');
    assert.ok(/NEVER state a fee/.test(s), 'no fee ban');
    assert.ok(/NEVER give a deadline as a number/.test(s), 'no deadline ban');
    assert.ok(/not state what the law entitles/.test(s), 'no advice ban');
    assert.ok(/not name a manufacturer/.test(s), 'no manufacturer ban');
  }
});

test('and a deadline may be said to EXIST but never given as a number', () => {
  /* Limitation and presentment periods differ by state and change. A page
   * that prints one is wrong somewhere and will be wrong everywhere
   * eventually. Saying a deadline exists is true and useful. */
  const ban = LEMON_LAW.bans.find(b => /deadline/.test(b));

  assert.ok(ban, 'there is no deadline rule at all');
  assert.ok(/number of days, months or years/.test(ban));
  assert.ok(/Saying a deadline exists/.test(ban), 'it bans the useful half too');
});

test('AND NO BRIEF ANYWHERE IN THE PROFILE PROMISES ANYTHING', () => {
  /* The bans are rules; the briefs are jobs. A brief that asked for "what
   * you can win for them" would pull against its own rules, and two
   * instructions in opposite directions is how a page ends up with
   * neither. */
  const everything = [
    ...Object.values(LEMON_LAW.stances),
    ...Object.values(LEMON_LAW.sections).flatMap(s => [s.job, s.headingJob]),
    ...Object.values(LEMON_LAW.homeJobs).flat(),
    ...Object.values(LEMON_LAW.aboutHeading),
  ].filter(Boolean);

  for (const brief of everything) {
    assert.ok(!/\bwe will win\b|\byou are entitled\b|\bguarantee[sd]?\b(?! is| that any)/i.test(brief)
      || /do not|never|must not|no /i.test(brief),
    `a brief promises something: ${brief.slice(0, 70)}`);
  }
});

test('AND NO BRIEF CARRIES A DOUBLE QUOTE INTO THE JSON TEMPLATE', () => {
  /* The home page prompt builds a JSON template the model fills in. A
   * double quote inside a brief closes a string early and the reply comes
   * back unparseable — which is why the three voices are held to the same
   * rule in their own suites. The about headings and the home jobs land
   * there; the section briefs do not, but are checked anyway because the
   * cost of being wrong is a failed build. */
  const inJson = [
    ...Object.values(LEMON_LAW.homeJobs).flat(),
    ...Object.values(LEMON_LAW.aboutHeading),
  ];

  for (const brief of inJson) {
    assert.ok(!brief.includes('"'), `a brief carries a double quote: ${brief.slice(0, 50)}`);
  }

  const built = home(FIRM, anvilPrompt.ANVIL_VOICE).system;
  const body = built.slice(built.indexOf('{'));

  assert.strictEqual(
    (body.match(/"/g) || []).length % 2, 0,
    'the JSON template has an odd number of quotes');
});

/* ======================================================================= */

section('THE HOME PAGE KEEPS ITS THREE VOICES');

test('EACH LAYOUT STILL GETS DIFFERENT PARAGRAPHS, EVEN WITHIN ONE INDUSTRY', () => {
  /* THE MISTAKE THIS EXISTS TO PREVENT. The easy version of this file was
   * one set of three paragraphs per industry — and it would have undone the
   * thing the voices exist for. Every lemon-law site would have had the same
   * home page whichever design was picked, which is exactly the collision
   * Edwin found on 30 October by setting two built pages side by side. */
  const l = home(FIRM, LEDGER_VOICE).user;
  const b = home(FIRM, beaconPrompt.BEACON_VOICE).user;
  const a = home(FIRM, anvilPrompt.ANVIL_VOICE).user;

  assert.notStrictEqual(l, b, 'Ledger and Beacon write the same lemon-law home page');
  assert.notStrictEqual(b, a, 'Beacon and Anvil write the same lemon-law home page');
  assert.notStrictEqual(l, a, 'Ledger and Anvil write the same lemon-law home page');

  for (const job of LEMON_LAW.homeJobs.ledger) {
    assert.ok(!LEMON_LAW.homeJobs.beacon.includes(job), 'a brief is shared between voices');
    assert.ok(!LEMON_LAW.homeJobs.anvil.includes(job), 'a brief is shared between voices');
  }
});

test('and the about heading differs per layout too', () => {
  /* A single industry-wide heading rule would have flattened Beacon's and
   * Anvil's into one. The heading is the line a skimmer reads. */
  const heads = Object.values(LEMON_LAW.aboutHeading);

  assert.strictEqual(new Set(heads).size, heads.length, 'two voices share a heading rule');

  assert.ok(home(FIRM, anvilPrompt.ANVIL_VOICE).system.includes('MUST contain a verb'));
  assert.ok(!home(FIRM, LEDGER_VOICE).system.includes('MUST contain a verb'));
});

test('AND NO LAYOUT IS LEFT ON ITS TRADE BRIEFS BY ACCIDENT', () => {
  /* A voice with no entry keeps its own, which is right for a trade and
   * wrong for this industry — Anvil's third brief asks what a finished job
   * looks like "before the van leaves". So a registered structure missing
   * from the profile fails HERE, which is what forces the question the day
   * a fourth layout is added. */
  const { structureKeys } = require('./utils/localOptions/render/structures');

  for (const key of structureKeys()) {
    assert.ok(
      Array.isArray(LEMON_LAW.homeJobs[key]) && 3 === LEMON_LAW.homeJobs[key].length,
      `lemon law has no home-page briefs for the ${key} layout`);

    assert.ok(
      LEMON_LAW.aboutHeading[key],
      `lemon law has no about heading for the ${key} layout`);
  }
});

test('and the van is gone from Anvil, which is what started this', () => {
  const a = whole(home(FIRM, anvilPrompt.ANVIL_VOICE));

  assert.ok(!/the van leaves/.test(a), 'a law firm is asked about the van');
  assert.ok(!/kinds of building/.test(a), 'a law firm is asked about buildings');

  /* And the trade still gets them, because they were right all along. */
  const t = whole(home(PLUMBER, anvilPrompt.ANVIL_VOICE));

  assert.ok(/the van leaves/.test(t), 'the trade lost Anvil\'s third brief');
});

/* ======================================================================= */

section('HOW A SITE FINDS ITS PROFILE');

test('FROM business.trade, WHICH ALREADY REACHES BOTH PROMPTS', () => {
  /* Nothing new is threaded through generate.js or the wizard. The trade
   * string is already the name of the image folder, so a site whose
   * pictures come from lemon-law/ gets lemon law's words by the same
   * token. */
  assert.strictEqual(industryFor('lemon-law'), LEMON_LAW);
  assert.strictEqual(industryFor('  Lemon-Law  '), LEMON_LAW);
  assert.strictEqual(industryFor('LEMON LAW'), LEMON_LAW);
  assert.strictEqual(industryFor('lemonlaw'), LEMON_LAW);
});

test('and it normalises exactly as the image folder lookup does', () => {
  /* tradeDir() lowercases and trims. A profile that matched on anything
   * else would be a site with lemon-law photographs and a plumber's
   * prompt. */
  assert.strictEqual(normalise('  Lemon Law '), 'lemon law');
  assert.strictEqual(normalise(null), '');
  assert.strictEqual(normalise(7), '7');
});

test('EVERY PROFILE CARRIES EVERY FIELD THE PROMPTS READ', () => {
  /* A missing field is `undefined` spliced into a prompt — "You write
   * service pages for undefined" — which renders, sends, and costs money. */
  const fields = [
    'key', 'match', 'pagesLine', 'homeLine', 'nouns', 'headingNouns',
    'homeNouns', 'notConcrete', 'dontTeach', 'bans', 'stances', 'sections',
    'homeJobs', 'aboutHeading',
  ];

  for (const p of PROFILES) {
    for (const f of fields) {
      assert.ok(undefined !== p[f], `${p.key} has no ${f}`);
    }

    assert.ok(Array.isArray(p.bans), `${p.key}.bans is not an array`);
    assert.ok(Array.isArray(p.match), `${p.key}.match is not an array`);
  }
});

test('and no two profiles claim the same trade name', () => {
  const seen = new Set();

  for (const p of PROFILES) {
    for (const m of p.match) {
      assert.strictEqual(m, normalise(m), `${p.key} matches on un-normalised "${m}"`);
      assert.ok(!seen.has(m), `two profiles both claim "${m}"`);
      seen.add(m);
    }
  }
});

test('AND NOTHING undefined REACHES A BUILT PROMPT', () => {
  /* The failure a missing field actually produces. Cheap to check, and it
   * would have caught a typo in any of the fourteen names above. */
  for (const business of [PLUMBER, FIRM]) {
    for (const voice of [LEDGER_VOICE, beaconPrompt.BEACON_VOICE, anvilPrompt.ANVIL_VOICE]) {
      const built = whole(home(business, voice));

      assert.ok(!/undefined/.test(built), `undefined in a ${business.trade} home prompt`);
    }

    const page = whole(svc(business, business === FIRM ? MATTER : SERVICE));

    assert.ok(!/undefined/.test(page), `undefined in a ${business.trade} page prompt`);
  }
});

/* ---------------------------------------------------------------------- */

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
