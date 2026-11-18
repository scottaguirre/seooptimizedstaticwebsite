// test-local-options-services.js
//
// Which six of the suggested services a business gets.
//
// WHAT THIS SUITE IS GUARDING — Edwin, 17 November, looking at two finished
// sites: *"the problem i see now is that all websites get the same
// services."*
//
// Nothing was broken. There is no services step in this wizard, so
// generate.js asks suggestServices() for the most commonly hired jobs for a
// trade in a town — and that question has one right answer. Two plumbers
// differ by name, address and town, none of which changes what a plumber
// sells.
//
//     THE INPUT DID NOT VARY, SO THE OUTPUT COULD NOT.
//
// So twelve are asked for and chooseServices() narrows them on the business
// name. The failures this file exists for are the three ways that goes
// wrong:
//
//   it does not vary      the whole point, and the easiest thing to break
//                         by hashing something that is the same on every
//                         site
//   it varies too much    a site that loses "Drain Cleaning" for "Hose Bib
//                         Replacement" is a worse site, not a different
//                         one. The top two are kept for everybody.
//   it is not stable      a rebuild that deals a different six would move
//                         six directories, six canonicals and the ring,
//                         and break every link anybody had to the site
//
// AND ONE THAT IS NOT ABOUT VARIETY AT ALL: a customer who supplied their
// own six must get THEIR six. A choice among suggestions is not a choice
// among instructions.
//
//   node test-local-options-services.js

'use strict';

const assert = require('assert');

const {
  chooseServices, scoreOf, SERVICE_POOL, ANCHORS,
} = require('./utils/localOptions/chooseServices');

const { SERVICE_COUNT } = require('./utils/localOptions/render/shape');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

async function atest(name, fn) {
  try { await fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

function section(n) { console.log(`\n${n}\n`); }

/** Eighteen plumbing services, most commonly hired first — SERVICE_POOL of them. */
const POOL = [
  'Drain Cleaning', 'Water Heater Repair', 'Toilet Repair', 'Faucet Repair',
  'Water Heater Installation', 'Gas Line Repair', 'Pipe Leak Repair',
  'Slab Leak Repair', 'Sewer Line Repair', 'Garbage Disposal Repair',
  'Repiping', 'Sump Pump Repair', 'Shower Valve Repair', 'Backflow Testing',
  'Hydro Jetting', 'Water Softener Installation', 'Sewer Camera Inspection',
  'Tankless Water Heater Installation',
];

/** Business names that would plausibly sit beside each other on his list. */
const BUSINESSES = [
  'Leander Plumbing Co.', 'The Chicago Plumber', 'Austin Drain Masters',
  'Bayou City Plumbing', 'Rapid Rooter of Mesa', 'Hill Country Plumbing',
  'Pflugerville Pipe Works', 'Round Rock Plumbing & Drain',
];

/* ======================================================================= */

section('IT VARIES, WHICH IS THE WHOLE POINT');

test('TWO BUSINESSES DO NOT GET THE SAME SIX', () => {
  const seen = new Map();
  let shared = 0;

  for (const name of BUSINESSES) {
    const six = chooseServices(POOL, { key: name });
    const sig = six.join('|');

    if (seen.has(sig)) shared += 1;
    seen.set(sig, name);
  }

  /* NOT "ALL EIGHT DIFFER", which would be asserting something the hash
   * does not promise: two names CAN draw the same four out of ten, and a
   * test that forbids it is a test that fails one day for no reason. What
   * it must not do is hand everybody the same list, which is what it did
   * before. */
  assert.ok(seen.size >= 5,
    `eight businesses produced only ${seen.size} distinct lists`);
  assert.ok(shared <= 3, `${shared} businesses shared a list with another`);
});

test('AND IT VARIES ENOUGH TO BE SEEN, WHICH IS NOT THE SAME TEST', () => {
  /* ⚠ THE FAILURE THIS EXISTS FOR IS NOT A BUG. It is a setting that was
   * too timid, and every other test in this file passed against it.
   *
   * The first version asked the model for twelve and anchored two. Edwin
   * looked at the first site built with it: *"i thought you fixed the same
   * 6 services always repeating."* Measured, twelve-and-two left 3.4 of 6
   * services shared between any two sites and 2.8 of 6 in the same
   * position — more than half the list, with the first two identical by
   * design, and the start of the list is where the eye goes.
   *
   *     A CHANGE THAT CANNOT BE SEEN IS NOT A CHANGE.
   *     "THEY DIFFER" AND "THEY LOOK DIFFERENT" ARE TWO ASSERTIONS.
   *
   * So this measures the overlap rather than asking whether any exists.
   * The thresholds are set below what eighteen-and-one actually produces
   * (2.4 and 1.6) with room for a different pool to move it, and above
   * what the twelve-and-two version did — so this test fails on that
   * setting, which is the whole point of writing it.
   *
   * ⚠ AND IT DRAWS FROM SERVICE_POOL NAMES, NOT FROM THE WHOLE FIXTURE.
   * A mutant that shrank SERVICE_POOL back to twelve survived the first
   * version of this test, because chooseServices() narrows whatever list
   * it is handed and the constant only decides what generate.js ASKS THE
   * MODEL FOR. Nothing connected the number to the result.
   *
   *     A CONSTANT THAT NO TEST READS THE EFFECT OF
   *     IS A CONSTANT ANYBODY CAN TUNE BACK TO WRONG.
   *
   * Slicing the fixture to SERVICE_POOL ties them together: a smaller pool
   * is a smaller draw, the overlap rises, and this fails. */
  assert.ok(POOL.length >= SERVICE_POOL,
    `the fixture has ${POOL.length} names and the model is asked for ${SERVICE_POOL}`);

  const offered = POOL.slice(0, SERVICE_POOL);
  const lists = BUSINESSES.map(name => chooseServices(offered, { key: name }));

  let shared = 0, samePlace = 0, pairs = 0;

  for (let i = 0; i < lists.length; i += 1) {
    for (let j = i + 1; j < lists.length; j += 1) {
      shared += lists[i].filter(s => lists[j].includes(s)).length;
      samePlace += lists[i].filter((s, k) => lists[j][k] === s).length;
      pairs += 1;
    }
  }

  const avgShared = shared / pairs;
  const avgPlace = samePlace / pairs;

  assert.ok(avgShared <= 3,
    `two sites share ${avgShared.toFixed(2)} of ${SERVICE_COUNT} services, which reads as the same list`);
  assert.ok(avgPlace <= 2.2,
    `${avgPlace.toFixed(2)} of ${SERVICE_COUNT} services sit in the same position on two sites`);

  /* AND THE FLOOR: the anchor is shared by everybody on purpose, so an
   * average below one would mean the anchoring had quietly stopped. */
  assert.ok(avgShared >= ANCHORS,
    'two sites share fewer services than are anchored, so the anchors are not holding');
});

test('AND IT IS THE BUSINESS NAME THAT MOVES IT, NOT THE CALL', () => {
  /* The failure here is hashing something that is the same on every site —
   * the trade, the town, a constant — which produces one list again and
   * passes any test that only looks at one business. */
  const a = chooseServices(POOL, { key: 'Leander Plumbing Co.' });
  const b = chooseServices(POOL, { key: 'The Chicago Plumber' });

  assert.notDeepStrictEqual(a, b, 'two different names drew the same six');

  /* AND AN EMPTY KEY IS STILL A KEY. A business with no name is not an
   * error here; it gets one particular six, the same one every time. */
  const none = chooseServices(POOL, { key: '' });

  assert.strictEqual(none.length, SERVICE_COUNT);
  assert.deepStrictEqual(none, chooseServices(POOL, {}));
});

/* ======================================================================= */

section('BUT NOT TOO MUCH — THE TOP TWO ARE EVERYBODY\'S');

test('EVERY BUSINESS KEEPS THE ONE THE TRADE IS HIRED FOR MOST', () => {
  /* A plumber whose site leads on "Hose Bib Replacement" has a worse site
   * than one that leads on "Drain Cleaning". Variety is not worth the best
   * page on the site. */
  assert.ok(ANCHORS >= 1, 'nothing is guaranteed on every site');

  for (const name of BUSINESSES) {
    const six = chooseServices(POOL, { key: name });

    assert.deepStrictEqual(six.slice(0, ANCHORS), POOL.slice(0, ANCHORS),
      `${name} lost one of the top ${ANCHORS}`);
  }
});

test('AND THE SECOND LINKED ROW IS STILL NEAR THE TOP OF THE LIST', () => {
  /* ⚠ THIS TEST REPLACED ONE THAT ASSERTED ANCHORS === HOME_BODY_LINKS,
   * and that assertion fired the moment the anchors dropped to one — which
   * is what it was for.
   *
   * HOME_BODY_LINKS is two, so the first TWO rows of the home page are the
   * linked ones. With one anchor, only the first is guaranteed. The second
   * is safe for a reason that is easy to break by accident:
   *
   *     THE CHOSEN FOUR KEEP THEIR ORDER, SO ROW TWO IS THE EARLIEST OF
   *     THE FOUR IN THE SUGGESTED LIST — NOT A FREE DRAW.
   *
   * Measured across 320 business names it lands at position 3 on median,
   * 7 at the 90th percentile and 11 at worst. Anything that stops
   * preserving the order turns row two into a coin toss and has to revisit
   * ANCHORS at the same time. This is the test that will say so. */
  const { HOME_BODY_LINKS } = require('./utils/localOptions/render/shape');

  assert.ok(HOME_BODY_LINKS >= ANCHORS,
    'more services are anchored than the home page links, so this is moot');

  let worst = 0;

  for (const name of BUSINESSES) {
    const six = chooseServices(POOL, { key: name });

    for (let row = ANCHORS; row < HOME_BODY_LINKS; row += 1) {
      const at = POOL.indexOf(six[row]) + 1;

      assert.ok(at > 0, `${name}'s row ${row + 1} is not from the suggested list`);
      worst = Math.max(worst, at);

      assert.ok(at <= POOL.length / 2,
        `${name} links "${six[row]}" from position ${at} of ${POOL.length}`);
    }
  }

  /* AND NOT VACUOUSLY: if every linked row were position 2 the assertion
   * above would pass while the choosing did nothing. */
  assert.ok(worst >= 3, 'every second row is the same service, so nothing varied');
});

test('AND THE SIX COME OUT IN THE ORDER THEY WENT IN', () => {
  /* The list still runs roughly most-common-first, which is what the home
   * page numbers 01 to 06 and what the ring walks. A site whose services
   * were left in hash order would read as a list nobody arranged. */
  for (const name of BUSINESSES) {
    const six = chooseServices(POOL, { key: name });
    const at = six.map(s => POOL.indexOf(s));

    assert.ok(at.every(i => i >= 0), `${name} got a service that was not offered`);
    assert.deepStrictEqual(at, [...at].sort((x, y) => x - y),
      `${name}'s six are not in the suggested order`);
  }
});

test('and it returns exactly six, with no repeats', () => {
  for (const name of BUSINESSES) {
    const six = chooseServices(POOL, { key: name });

    assert.strictEqual(six.length, SERVICE_COUNT, `${name} got ${six.length}`);
    assert.strictEqual(new Set(six).size, SERVICE_COUNT, `${name} got a repeat`);
  }
});

/* ======================================================================= */

section('AND IT IS STABLE, OR A REBUILD MOVES SIX DIRECTORIES');

test('THE SAME BUSINESS REBUILT GETS THE SAME SIX', () => {
  /* The slug is the directory, the URL, the ring position and the
   * canonical. A second build that dealt a different six would move all
   * four and break every link anybody had — which is the reason pickSet()
   * in heroes.js hashes the business name for photographs rather than
   * choosing at random. */
  for (const name of BUSINESSES) {
    assert.deepStrictEqual(
      chooseServices(POOL, { key: name }),
      chooseServices(POOL, { key: name }),
      `${name} drew a different six the second time`);
  }
});

test('AND A STRAY SPACE OR A CAPITAL IS THE SAME BUSINESS', () => {
  /* A form that gains a trailing space would otherwise re-deal every
   * service on the site. */
  const want = chooseServices(POOL, { key: 'Leander Plumbing Co.' });

  for (const variant of ['  Leander Plumbing Co.', 'leander plumbing co.',
    'LEANDER PLUMBING CO. ', ' Leander Plumbing Co. ']) {
    assert.deepStrictEqual(chooseServices(POOL, { key: variant }), want,
      `"${variant}" was treated as a different business`);
  }
});

test('THE NAME IS HASHED WITH THE SERVICE, NOT WITH ITS POSITION', () => {
  /* A rebuild asks the model again, and a model handed the same question
   * twice can return the same twelve in a slightly different order.
   * Hashing the position would then deal a different six for no reason
   * anybody could see.
   *
   *     A SERVICE THAT WAS CHOSEN STAYS CHOSEN
   *     AS LONG AS IT IS STILL ON THE LIST.
   *
   * Tested by shuffling only the part that can be shuffled — the eight
   * past the anchors, which is where the choosing happens. */
  const key = 'Bayou City Plumbing';
  const first = chooseServices(POOL, { key });

  const head = POOL.slice(0, ANCHORS);
  const tail = POOL.slice(ANCHORS);
  const moved = head.concat([...tail].reverse());

  const second = chooseServices(moved, { key });

  assert.deepStrictEqual(new Set(second), new Set(first),
    'reordering the suggestions changed which services were chosen');

  /* AND THE ORDER STILL FOLLOWS THE LIST IT WAS GIVEN, so this is not
   * passing because the function sorts its output. */
  const at = second.map(s => moved.indexOf(s));

  assert.deepStrictEqual(at, [...at].sort((x, y) => x - y));
});

test('and the score is a number, spread across the range', () => {
  /* A hash that returns the same value for everything would pass every
   * test above except the first, and would fail it in a way that reads
   * like bad luck. */
  const scores = BUSINESSES.map(n => scoreOf(n, 'Sump Pump Repair'));

  assert.ok(scores.every(Number.isInteger), 'a score is not an integer');
  assert.strictEqual(new Set(scores).size, scores.length, 'two names scored identically');
  assert.strictEqual(scoreOf('a', 'b'), scoreOf('a', 'b'), 'the score is not stable');
  assert.notStrictEqual(scoreOf('a', 'b'), scoreOf('b', 'a'),
    'the key and the service are interchangeable, so the pair is not what is hashed');
});

/* ======================================================================= */

section('A SHORT LIST IS NOT A FAILURE');

test('SIX OR FEWER COME BACK UNTOUCHED', () => {
  /* A trade with exactly six distinct services — which is most of the
   * narrow ones — gets its six, the same six every time, and that is the
   * correct answer rather than a degraded one. */
  assert.deepStrictEqual(chooseServices(POOL.slice(0, 6), { key: 'x' }), POOL.slice(0, 6));
  assert.deepStrictEqual(chooseServices(POOL.slice(0, 4), { key: 'x' }), POOL.slice(0, 4));
  assert.deepStrictEqual(chooseServices([], { key: 'x' }), []);
});

test('AND IT NEVER THROWS, BECAUSE generate.js OWNS THAT DECISION', () => {
  /* generate.js is the one place that decides whether a short list is a
   * failed build, and it already does, with a message naming what
   * survived. Throwing here would move that decision somewhere it cannot
   * explain itself. */
  assert.doesNotThrow(() => chooseServices(null, { key: 'x' }));
  assert.doesNotThrow(() => chooseServices(undefined));
  assert.doesNotThrow(() => chooseServices('not a list', { key: 'x' }));
  assert.doesNotThrow(() => chooseServices([null, undefined, '', '  '], { key: 'x' }));

  assert.deepStrictEqual(chooseServices(null, { key: 'x' }), []);
  assert.deepStrictEqual(chooseServices([null, '', '  ', 'Real One'], { key: 'x' }), ['Real One']);
});

test('seven names still produce six, which is the smallest real choice', () => {
  const seven = POOL.slice(0, 7);
  const lists = new Set(BUSINESSES.map(n => chooseServices(seven, { key: n }).join('|')));

  for (const name of BUSINESSES) {
    const six = chooseServices(seven, { key: name });

    assert.strictEqual(six.length, SERVICE_COUNT);
    assert.deepStrictEqual(six.slice(0, ANCHORS), seven.slice(0, ANCHORS));
  }

  assert.ok(lists.size >= 2, 'seven names produced one list for every business');
});

/* ======================================================================= */

section('WHAT THE CUSTOMER TYPED IS NOT A SUGGESTION');

(async () => {
  const { generateLocalOptionsSite } = require('./utils/localOptions/generate');

  /** The smallest model stub that gets a build through.
   *
   * `{ data, usage }`, NOT `{ text, usage }`. askModel() in generate.js
   * returns the parsed object, and a stub that returns the JSON string
   * instead fails six pages later with "Cannot read properties of
   * undefined (reading 'h1')" — which says nothing about the stub.
   *
   * THE SECTIONS COME FROM SECTIONS, not from a literal, so a page is
   * checked against the same list the real builder uses. */
  const { SECTIONS } = require('./utils/localOptions/prompt');

  const stub = () => {
    const calls = [];

    const ask = async ({ system, user, label }) => {
      calls.push({ system, user, label });

      const data = 'home page' === label
        ? {
          h1: 'Plumbing repair and installation in Leander, TX',
          sub: 'Same-week appointments across Leander.',
          title: 'Leander Plumbing Co. | Plumbing in Leander, TX',
          meta: 'Plumbing repair and installation in Leander, TX, with same-week visits.',
          aboutHeading: 'A local plumbing company in Leander, TX',
          about: ['First.', 'Second.', 'Third.'],
        }
        : {
          h1: `${label} in Leander, TX`,
          title: `${label} | Leander Plumbing Co.`,
          meta: `${label} in Leander, TX. A meta description of a believable length.`,
          blurb: `One line about ${label.toLowerCase()}.`,
          sections: SECTIONS.map((s, i) => ({
            heading: s.headingJob ? `A heading for section ${i + 1}` : '',
            paragraphs: [`Paragraph for ${label} section ${i + 1}, with a trap and a wrench.`],
          })),
        };

      return { data, usage: { prompt_tokens: 10, completion_tokens: 10 } };
    };

    return { ask, calls };
  };

  const base = over => ({
    business: {
      name: 'Leander Plumbing Co.', trade: 'plumbing', phone: '(512) 555-0100',
      street: '1 Main St', city: 'Leander', state: 'TX', zip: '78641',
    },
    url: 'https://leander-plumbing.example.org',
    areas: ['Leander'],
    hours: [{ day: 'Monday', open: '9-5' }],
    now: new Date('2026-11-17T00:00:00Z'),
    ...over,
  });

  await atest('SIX SUPPLIED NAMES ARE BUILT, IN THEIR ORDER, UNHASHED', async () => {
    /* An old queued job from before the services step was removed still
     * carries its six rows, and so does any caller that supplies them.
     *
     *     A CHOICE AMONG SUGGESTIONS IS NOT A CHOICE AMONG INSTRUCTIONS.
     *
     * The chooser sits INSIDE the `if (!names)` block for this reason, and
     * this is the test that keeps it there. */
    const mine = [
      'Backflow Testing', 'Well Pump Service', 'Water Softener Install',
      'Trenchless Sewer Repair', 'Grease Trap Cleaning', 'Hydro Jetting',
    ];

    const { ask } = stub();
    let suggested = 0;

    const { services } = await generateLocalOptionsSite(base({
      ask,
      serviceNames: mine,
      suggest: async () => { suggested += 1; return { services: [], dropped: [] }; },
    }));

    assert.strictEqual(suggested, 0, 'the suggester was called for a list that was supplied');
    assert.deepStrictEqual(services.map(s => s.name), mine,
      'the supplied six were re-ordered or replaced');
  });

  await atest('AND MORE THAN SIX SUPPLIED IS TRIMMED FROM THE TOP, NOT DRAWN FROM', async () => {
    /* ⚠ THE TEST ABOVE DOES NOT CATCH THIS, AND A MUTANT PROVED IT. Moving
     * the chooser OUT of the `if (!names)` block — so it narrows the
     * customer's own list too — changes nothing when exactly six were
     * supplied, because a list of six or fewer comes back untouched. The
     * test passed against the bug.
     *
     *     A GUARD THAT ONLY RUNS ON LONGER LISTS CANNOT BE TESTED
     *     WITH A SHORT ONE.
     *
     * So this supplies EIGHT. servicesFrom() has always trimmed to the
     * first six; what must not happen is a hash choosing which six of the
     * customer's eight get built. */
    const mine = [
      'Backflow Testing', 'Well Pump Service', 'Water Softener Install',
      'Trenchless Sewer Repair', 'Grease Trap Cleaning', 'Hydro Jetting',
      'Pipe Thawing', 'Fixture Replacement',
    ];

    const { ask } = stub();

    const { services } = await generateLocalOptionsSite(base({
      ask,
      serviceNames: mine,
      suggest: async () => { throw new Error('the suggester must not be called'); },
    }));

    assert.deepStrictEqual(services.map(s => s.name), mine.slice(0, SERVICE_COUNT),
      'the customer\'s eight were drawn from rather than trimmed');
  });

  await atest('AND A SUGGESTED TWELVE IS NARROWED ON THE BUSINESS NAME', async () => {
    const { ask } = stub();
    const asked = [];

    const suggest = async (ctx, opts) => {
      asked.push(opts);

      return { services: POOL.slice(0, opts.count), dropped: [] };
    };

    const one = await generateLocalOptionsSite(base({ ask, suggest }));

    const two = await generateLocalOptionsSite(base({
      ask,
      suggest,
      business: { ...base().business, name: 'Pflugerville Pipe Works' },
      url: 'https://pflugerville-pipe.example.org',
    }));

    assert.strictEqual(asked[0].count, SERVICE_POOL,
      `the first call asked for ${asked[0].count}, not the pool`);

    const a = one.services.map(s => s.name);
    const b = two.services.map(s => s.name);

    assert.strictEqual(a.length, SERVICE_COUNT);
    assert.strictEqual(b.length, SERVICE_COUNT);
    assert.notDeepStrictEqual(a, b, 'two businesses built the same six service pages');

    /* AND BOTH KEPT THE ANCHORS, so the variety did not cost either of
     * them its best pages. */
    assert.deepStrictEqual(a.slice(0, ANCHORS), POOL.slice(0, ANCHORS));
    assert.deepStrictEqual(b.slice(0, ANCHORS), POOL.slice(0, ANCHORS));

    /* AND THE SLUGS FOLLOW THE NAMES, since the slug is the directory. */
    assert.deepStrictEqual(one.services.map(s => s.slug),
      a.map(n => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')));
  });

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
