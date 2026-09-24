// test-keyword-pairs.js
//
// The trade crossed with the town.
//
// WHAT THIS IS GUARDING, AND THE MISTAKE BEHIND IT
//
// The research page's category mode never returned a term with the town in
// it. I explained that as Google's reporting floor — "plumber cedar park is
// probably ten or twenty a month, too small to make a top-thirty list".
//
// It is 170 a month, at $44.64 a click. The explanation was wrong, and wrong
// in the direction that would have had us shrug and move on.
//
// The real reason is that Google treats the city as a TARGETING setting
// rather than as text, so its idea engine never proposes putting the town in
// the query however it is seeded. The volume was always there; nothing was
// ever going to surface it except asking by name.
//
// So most of what follows is about the list being COMPLETE — every shape a
// customer might type — rather than about it being short.
//
//   node test-keyword-pairs.js

const assert = require('assert');

const {
  pairsFor, practitionerForms, sortPairs,
  QUALIFIERS, BUSINESS_WORDS, MAX_PAIRS,
} = require('./utils/keywordPairs');

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ok    ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}\n        ${err.message}`);
    failed++;
  }
}

const SERVICES = [
  'water heater installation', 'drain cleaning', 'sewer line repair',
  'slab leak repair', 'garbage disposal repair', 'leak detection',
];

function plumbing(opts = {}) {
  return pairsFor('plumbing', { city: 'Cedar Park', services: SERVICES, ...opts });
}

console.log('\nKeyword pairs\n');

/* ------------------------------------------------------------------ *
 * The term that started this
 * ------------------------------------------------------------------ */

test('"plumber cedar park" is asked about — the 170-a-month term', () => {
  // The whole reason this module exists. Discovery will never propose it;
  // it has to be named.
  assert.ok(plumbing().includes('plumber cedar park'));
});

test('the terms Edwin listed by name are all there', () => {
  const list = plumbing();

  for (const wanted of [
    'plumber cedar park',
    'emergency plumber cedar park',
    'commercial plumber cedar park',
    'plumbing company cedar park',
  ]) {
    assert.ok(list.includes(wanted), `${wanted} is missing`);
  }
});

test('both word orders are asked about, because they are different queries', () => {
  const list = plumbing();
  assert.ok(list.includes('plumber cedar park'));
  assert.ok(list.includes('cedar park plumber'));
});

test('the question Edwin asked: the plural is asked about too', () => {
  // "if I search for Austin deck builder, will that also show Austin deck
  // builders?" It would not have. pairsFor produced "deck builderer austin"
  // and never named the plural at all.
  const list = pairsFor('deck builder', { city: 'Austin' });

  assert.ok(list.includes('deck builder austin'));
  assert.ok(list.includes('deck builders austin'), 'the plural was never asked about');
  assert.ok(list.includes('austin deck builders'));
  assert.ok(list.includes('emergency deck builder austin'));

  for (const term of list) {
    assert.ok(!/erer/.test(term), `"${term}" has a doubled -er`);
  }
});

test('each service is paired with the town', () => {
  const list = plumbing();

  for (const service of SERVICES) {
    assert.ok(list.includes(`${service} cedar park`), `${service} was not paired`);
  }
});

/* ------------------------------------------------------------------ *
 * The practitioner noun
 * ------------------------------------------------------------------ */

test('the person is derived from the trade', () => {
  assert.deepStrictEqual(practitionerForms('plumbing'), ['plumber', 'plumbers']);
  assert.deepStrictEqual(practitionerForms('roofing'), ['roofer', 'roofers']);
  assert.deepStrictEqual(practitionerForms('landscaping'), ['landscaper', 'landscapers']);
});

test('a multi-word trade keeps its head', () => {
  assert.deepStrictEqual(
    practitionerForms('web design'),
    ['web designer', 'web designers']
  );
});

test('a trade NAMED AFTER THE WORKER is not given a second -er', () => {
  // The bug this branch exists for. The rule assumed every trade was named
  // after the work — plumbing, roofing, landscaping, which is what it was
  // written against. "deck builder" is already the person, so it came back
  // as "deck builderer" and "deck builderers", and the form Edwin actually
  // asked about was never asked about at all.
  assert.deepStrictEqual(
    practitionerForms('deck builder'),
    ['deck builder', 'deck builders']
  );
  assert.deepStrictEqual(practitionerForms('plumber'), ['plumber', 'plumbers']);
  assert.deepStrictEqual(practitionerForms('roofer'), ['roofer', 'roofers']);
});

test('the agent endings cover how trades are actually named', () => {
  // -or, -ist, -ian, -smith, -ney. Each is a real trade in the app's list or
  // one word away from one.
  assert.deepStrictEqual(practitionerForms('chiropractor'), ['chiropractor', 'chiropractors']);
  assert.deepStrictEqual(practitionerForms('eye doctor'), ['eye doctor', 'eye doctors']);
  assert.deepStrictEqual(practitionerForms('dentist'), ['dentist', 'dentists']);
  assert.deepStrictEqual(practitionerForms('electrician'), ['electrician', 'electricians']);
  assert.deepStrictEqual(practitionerForms('locksmith'), ['locksmith', 'locksmiths']);
  // -man does not take an -s. "handymans austin" would be a wasted slot and
  // an embarrassing one if anybody read the table.
  assert.deepStrictEqual(practitionerForms('handyman'), ['handyman', 'handymen']);
  assert.deepStrictEqual(
    practitionerForms('lemon law attorney'),
    ['lemon law attorney', 'lemon law attorneys']
  );
});

test('a trade typed in the plural comes back with its singular too', () => {
  // Somebody types what they would search for. Both forms are worth asking
  // about and the singular is the one the qualifiers get attached to.
  assert.deepStrictEqual(
    practitionerForms('deck builders'),
    ['deck builder', 'deck builders']
  );
  assert.deepStrictEqual(practitionerForms('plumbers'), ['plumber', 'plumbers']);
});

test('a plural that is not a plural is left alone', () => {
  // "glass" ends in s and is not two glasses. Stripping it gives "glas".
  assert.deepStrictEqual(practitionerForms('glass'), ['glasser', 'glassers']);
});

test('an already-plural service is not given an -er', () => {
  // "cleaning serviceser" was the old output. A word that is already plural
  // is a noun, not a verb root.
  assert.deepStrictEqual(
    practitionerForms('cleaning services'),
    ['cleaning service', 'cleaning services']
  );
});

test('the singular comes first, because that is the one that gets qualified', () => {
  // pairsFor reads forms[0] for "emergency <person> <city>". A plural there
  // would spend every qualifier row on "emergency deck builders austin",
  // which is the same page as the singular.
  for (const trade of ['plumbing', 'deck builder', 'deck builders', 'web design']) {
    const [first, second] = practitionerForms(trade);
    assert.ok(second.length > first.length, `${trade}: ${first} is not the singular`);
  }
});

test('a nonsense form is generated ON PURPOSE and is not a bug', () => {
  // "lemon lawer" is gibberish. It is generated anyway, because guessing
  // English morphology for every trade the app will ever sell to is not a
  // solvable problem — and a wrong guess costs one slot in a task with a
  // thousand, then shows as a dash. A hand-maintained map of trade nouns
  // would cover the trades somebody remembered and silently fail the rest.
  //
  // Asserted rather than tolerated, so nobody "fixes" it by adding a list.
  //
  // Note what the -er branch is now FOR: it is the fallback for a word that
  // is neither an -ing activity nor a recognisable agent noun nor a plural.
  // Narrowing it fixed "deck builderer" without touching this.
  assert.deepStrictEqual(
    practitionerForms('lemon law'),
    ['lemon lawer', 'lemon lawers']
  );
});

test('no trade is not a person', () => {
  assert.deepStrictEqual(practitionerForms(''), []);
  assert.deepStrictEqual(practitionerForms(null), []);
});

/* ------------------------------------------------------------------ *
 * The shape of the list
 * ------------------------------------------------------------------ */

test('the bare pairings come first, because they carry the volume', () => {
  // ORDER IS PRIORITY: the list is capped and the table is read from the top.
  // "plumber cedar park" at 170 a month must not be pushed off the end by
  // "cheap plumbing cedar park".
  const list = plumbing();

  assert.ok(
    list.indexOf('plumber cedar park') < list.indexOf('cheap plumber cedar park'),
    'a qualifier outranked the bare pairing'
  );
  assert.ok(
    list.indexOf('plumbing cedar park') < list.indexOf('water heater installation cedar park')
  );
});

test('the qualifiers are ordered by intent, not alphabetically', () => {
  // "emergency" is somebody with water coming through the ceiling. "cheap" is
  // somebody shopping around. They are not worth the same and the cap should
  // bite the second one first.
  assert.ok(QUALIFIERS.indexOf('emergency') < QUALIFIERS.indexOf('cheap'));
  assert.ok(QUALIFIERS.indexOf('commercial') < QUALIFIERS.indexOf('affordable'));
});

test('everything is lower case and single spaced', () => {
  const list = pairsFor('  Plumbing  ', {
    city: '  Cedar   Park ',
    services: ['  Water Heater Repair  '],
  });

  for (const term of list) {
    assert.strictEqual(term, term.toLowerCase(), `${term} is not lower case`);
    assert.ok(!/\s{2,}|^\s|\s$/.test(term), `"${term}" has stray spacing`);
  }

  assert.ok(list.includes('water heater repair cedar park'));
});

test('a repeat takes one slot, not two', () => {
  // A service the model also named as the trade would otherwise appear twice
  // AND hash to the same cache entry — paying for a narrower question.
  const list = pairsFor('plumbing', {
    city: 'Austin',
    services: ['Plumbing', 'plumbing', 'drain cleaning'],
  });

  const seen = new Set();
  for (const term of list) {
    assert.ok(!seen.has(term), `${term} appears twice`);
    seen.add(term);
  }
});

test('the list is capped well under the endpoint limit', () => {
  const many = Array.from({ length: 500 }, (_, i) => `service ${i}`);
  const list = pairsFor('plumbing', { city: 'Austin', services: many });

  assert.strictEqual(list.length, MAX_PAIRS);
  // DataForSEO takes a thousand per task. The cap is here to keep the TABLE
  // readable, so it must stay well clear of the endpoint's own limit.
  assert.ok(MAX_PAIRS <= 200);
});

test('a real trade produces a list somebody would actually read', () => {
  // Not an assertion about a magic number — a guard against the combinations
  // quietly exploding into a table nobody scrolls.
  const list = plumbing();
  assert.ok(list.length >= 25, `only ${list.length} pairings`);
  assert.ok(list.length <= 60, `${list.length} pairings is too many to read`);
});

test('no town and no trade produce nothing, rather than half a phrase', () => {
  assert.deepStrictEqual(pairsFor('plumbing', { city: '' }), []);
  assert.deepStrictEqual(pairsFor('', { city: 'Austin' }), []);
  assert.deepStrictEqual(pairsFor('plumbing', {}), []);
});

test('no services still produces the pairings that matter most', () => {
  // The model call can fail. The trade, the person and the qualifiers need
  // nothing from it.
  const list = pairsFor('plumbing', { city: 'Cedar Park' });

  assert.ok(list.includes('plumber cedar park'));
  assert.ok(list.includes('emergency plumber cedar park'));
  assert.ok(list.length > 10);
});

test('the business words are asked about', () => {
  const list = plumbing();
  for (const word of BUSINESS_WORDS) {
    assert.ok(list.includes(`plumbing ${word} cedar park`), `${word} is missing`);
  }
});

/* ------------------------------------------------------------------ *
 * Sorting, and the rows with no answer
 * ------------------------------------------------------------------ */

test('biggest first, unanswered last', () => {
  const sorted = sortPairs([
    { keyword: 'commercial plumber cedar park', volume: null },
    { keyword: 'plumber cedar park', volume: 170 },
    { keyword: 'cedar park plumber', volume: 30 },
    { keyword: 'cheap plumber cedar park', volume: null },
  ]).map(r => r.keyword);

  // The two unanswered rows tie on volume and fall to the alphabetical
  // tiebreak — "cheap" before "commercial". Not insertion order, which is
  // what I first wrote here: a stable rule is the point, so that re-running
  // the same search does not reshuffle the table under the customer.
  assert.deepStrictEqual(sorted, [
    'plumber cedar park',
    'cedar park plumber',
    'cheap plumber cedar park',
    'commercial plumber cedar park',
  ]);
});

test('an unanswered row is KEPT, never dropped', () => {
  // "Google has no figure for 'commercial plumber cedar park'" is a finding,
  // and the reason to write that page differently or not at all. Dropped, the
  // customer thinks the term was never checked.
  const rows = sortPairs([
    { keyword: 'a plumber cedar park', volume: null },
    { keyword: 'plumber cedar park', volume: 170 },
  ]);

  assert.strictEqual(rows.length, 2);
  assert.ok(rows.some(r => r.volume == null));
});

test('a volume of zero is not the same as no answer', () => {
  // Zero is Google saying "nobody". Null is Google saying "I will not say".
  // Sorting them together would blur a real distinction.
  const rows = sortPairs([
    { keyword: 'no answer', volume: null },
    { keyword: 'measured zero', volume: 0 },
  ]).map(r => r.keyword);

  assert.deepStrictEqual(rows, ['measured zero', 'no answer']);
});

test('ties are broken predictably, so the table does not reshuffle', () => {
  const rows = sortPairs([
    { keyword: 'zebra plumber austin', volume: 50 },
    { keyword: 'alpha plumber austin', volume: 50 },
  ]).map(r => r.keyword);

  assert.deepStrictEqual(rows, ['alpha plumber austin', 'zebra plumber austin']);
});

test('nothing in, nothing out, no exception', () => {
  assert.deepStrictEqual(sortPairs([]), []);
  assert.deepStrictEqual(sortPairs(null), []);
});

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('');
process.exit(failed === 0 ? 0 : 1);
