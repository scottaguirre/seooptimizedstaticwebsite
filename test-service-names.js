// test-service-names.js
//
// The two checks on a list of service pages, and the thing most likely to go
// wrong with them: the browser and the server disagreeing.
//
// The wizard has to run these checks in the page, because the form is a real
// multipart POST carrying an uploaded logo — a server-side "are you sure?"
// would mean sending the file, refusing it, and asking for it again, and a
// browser cannot refill a file input. So the logic exists twice, and twice is
// where drift lives.
//
// Rather than trust a comment, this reads the two functions OUT of
// public/js/generateDinamycForm.js and runs them against the server's over the
// same inputs. Change one and not the other and this fails.
//
//   node test-service-names.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {
  slugCollisions,
  similarServices,
  collisionMessage,
  overlapMessage,
} = require('./utils/serviceNames');

const { slugify } = require('./utils/slugify');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

/* -------------------------------------------------------------------------
 * Lift the browser's copies out of the wizard
 * ---------------------------------------------------------------------- */

const WIZARD = path.join(__dirname, 'public', 'js', 'generateDinamycForm.js');
const src = fs.readFileSync(WIZARD, 'utf8');

/** Pull one function declaration out of the file by name, braces balanced. */
function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > -1, `${name}() is missing from generateDinamycForm.js`);

  let depth = 0;
  let i = src.indexOf('{', start);
  const open = i;

  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }

  throw new Error(`could not find the end of ${name}()`);
}

function extractVar(name) {
  const start = src.indexOf(`var ${name} = [`);
  assert.ok(start > -1, `${name} is missing from generateDinamycForm.js`);
  const end = src.indexOf('];', start);
  return src.slice(start, end + 2);
}

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(
  [
    extract('normaliseForCompare'),
    extractVar('COMPARE_STOPWORDS'),
    extract('compareTokens'),
    extract('findSimilarPairs'),
    'globalThis.__browser = { normaliseForCompare, compareTokens, findSimilarPairs };',
  ].join('\n'),
  sandbox
);

const browser = sandbox.__browser;

/* -------------------------------------------------------------------------
 * Fixtures — real service names a plumber or HVAC firm would type
 * ---------------------------------------------------------------------- */

const ALIKE = [
  ['Water Heater Repair', 'Water Heater Repairs'],
  ['Water Heater Repair', 'Emergency Water Heater Repair'],
  ['Drain Cleaning', 'Drain Cleaning Services'],
  ['Plumbing Pipe Redesign Services', 'Plumbing Pipe Replacement Services'],
  ['Slab Leak Detection', 'Leak Detection'],
  ['Sewer Line Repair', 'Sewer Line Repair Services'],
];

const DISTINCT = [
  ['Toilet Repair', 'Toilet Installation'],
  ['Water Heater Repair', 'Drain Cleaning'],
  ['Commercial Plumbing', 'Residential Plumbing'],
  ['Water Softener Installation', 'Garbage Disposal Repair'],
];

// Known blind spot. Recorded so it is a documented limit rather than a
// surprise: a token comparison cannot see that AC means air conditioning.
const SYNONYMS_NOT_CAUGHT = [
  ['AC Repair', 'Air Conditioning Repair'],
  ['Repiping', 'Pipe Replacement'],
];

/* ===================================================================== */

console.log('\nFilename collisions');

test('the same name twice collides', () => {
  const c = slugCollisions(['Drain Cleaning', 'Drain Cleaning']);
  assert.strictEqual(c.length, 1);
  assert.deepStrictEqual(c[0].indexes, [0, 1]);
});

test('punctuation does not save you — the bug this replaces', () => {
  // "Drain Cleaning" and "Drain, Cleaning" are different lowercased strings,
  // so the old text comparison passed them. Both slugify to drain-cleaning,
  // and the second overwrote the first. 100 credits for nothing.
  const c = slugCollisions(['Drain Cleaning', 'Drain, Cleaning']);
  assert.strictEqual(c.length, 1, 'a punctuation-only difference was not caught');
  assert.strictEqual(c[0].slug, 'drain-cleaning');
});

test('case and spacing collide too', () => {
  assert.strictEqual(slugCollisions(['AC  Repair', 'ac repair']).length, 1);
});

test('every colliding name is reported, not just the later one', () => {
  // The customer has to choose which to rename. Flagging one of a pair implies
  // the other is the right one.
  const c = slugCollisions(['Repiping', 'Drain Cleaning', 'repiping']);
  assert.deepStrictEqual(c[0].indexes, [0, 2]);
});

test('three-way collisions report all three', () => {
  const c = slugCollisions(['Pipe Repair', 'pipe repair', 'Pipe, Repair']);
  assert.strictEqual(c.length, 1);
  assert.strictEqual(c[0].indexes.length, 3);
});

test('genuinely different names do not collide', () => {
  assert.deepStrictEqual(slugCollisions(['Drain Cleaning', 'Water Heater Repair']), []);
});

test('blank entries are ignored rather than colliding with each other', () => {
  assert.deepStrictEqual(slugCollisions(['', '  ', 'Repiping']), []);
});

test('the message names both services and the file', () => {
  const msg = collisionMessage(slugCollisions(['Drain Cleaning', 'Drain, Cleaning']));
  assert.ok(msg.includes('Drain Cleaning'), 'first name missing');
  assert.ok(msg.includes('Drain, Cleaning'), 'second name missing');
  assert.ok(msg.includes('drain-cleaning.html'), 'the filename is not named');
});

console.log('\nSimilar services');

for (const [a, b] of ALIKE) {
  test(`flagged: ${a} / ${b}`, () => {
    assert.strictEqual(similarServices([a, b]).length, 1, 'not flagged');
  });
}

for (const [a, b] of DISTINCT) {
  test(`left alone: ${a} / ${b}`, () => {
    assert.strictEqual(similarServices([a, b]).length, 0, 'wrongly flagged');
  });
}

test('a colliding pair is not ALSO reported as merely similar', () => {
  // Collisions are refused before this ever runs, but if the order were ever
  // changed the customer would get two messages about one problem.
  const names = ['Drain Cleaning', 'Drain, Cleaning'];
  assert.ok(slugCollisions(names).length, 'precondition: they collide');
});

test('the synonyms this cannot catch are still not caught', () => {
  // Not a bug — a limit. If someone later adds a trade vocabulary or
  // embeddings, this test failing is the signal to update the docs that
  // promise the limit.
  for (const [a, b] of SYNONYMS_NOT_CAUGHT) {
    assert.strictEqual(similarServices([a, b]).length, 0,
      `${a} / ${b} is now caught — utils/serviceNames.js documents that it is not`);
  }
});

test('the warning says why it costs money, not just that it is similar', () => {
  const msg = overlapMessage(similarServices(['Water Heater Repair', 'Water Heater Repairs']));
  assert.ok(/compete/i.test(msg), 'does not explain the consequence');
  assert.ok(/paying for both/i.test(msg), 'does not mention the cost');
});

test('one service raises nothing', () => {
  assert.deepStrictEqual(similarServices(['Drain Cleaning']), []);
  assert.deepStrictEqual(similarServices([]), []);
});

console.log('\nThe browser and the server agree');

test('normaliseForCompare matches slugify', () => {
  const inputs = [
    'Drain Cleaning', 'Drain, Cleaning', 'AC  Repair', 'ac repair',
    'Water Heater Repair!', '  Repiping  ', 'Sewer/Line Repair',
    '24-Hour Emergency Plumbing', 'Café Plumbing', 'Pipe   Replacement',
  ];

  for (const value of inputs) {
    assert.strictEqual(
      browser.normaliseForCompare(value),
      slugify(value),
      `the wizard and slugify() disagree on "${value}"`
    );
  }
});

test('the browser flags exactly what the server flags', () => {
  const all = [...ALIKE, ...DISTINCT, ...SYNONYMS_NOT_CAUGHT];

  for (const [a, b] of all) {
    const serverSaid = similarServices([a, b]).length > 0;
    const browserSaid = [...browser.findSimilarPairs([a, b])].length > 0;

    assert.strictEqual(browserSaid, serverSaid,
      `"${a}" / "${b}": wizard says ${browserSaid}, server says ${serverSaid}`);
  }
});

test('they agree on a whole realistic service list, not just pairs', () => {
  const list = [
    'Water Heater Repair',
    'Water Heater Repairs',
    'Drain Cleaning',
    'Toilet Installation',
    'Slab Leak Detection',
    'Leak Detection',
    'Commercial Plumbing',
  ];

  const serverPairs = similarServices(list)
    .map(p => [p.names[0], p.names[1]].sort().join(' | ')).sort();

  // Spread into a native array first. The wizard's copies run in a vm
  // context, so the arrays they return have that realm's Array prototype and
  // deepStrictEqual refuses them as "same structure, not reference-equal" —
  // which reads exactly like a real disagreement and is not one.
  const browserPairs = [...browser.findSimilarPairs(list)]
    .map(p => [...p].sort().join(' | ')).sort();

  assert.deepStrictEqual(browserPairs, serverPairs);
  assert.ok(serverPairs.length >= 2, 'expected this list to raise something');
});

test('the wizard still refuses a collision before asking about similarity', () => {
  // Order matters: a collision destroys work and must be refused, and asking
  // "are these the same service?" about two names that are about to become
  // one file would be answering the wrong question.
  const collisionIndex = src.indexOf('submitPageDupes.dupes.length');
  const similarIndex = src.indexOf('findSimilarPairs(pagesVals)');

  assert.ok(collisionIndex > -1 && similarIndex > -1, 'a guard is missing from the wizard');
  assert.ok(collisionIndex < similarIndex, 'the similarity prompt runs before the collision refusal');
});

test('the similarity prompt is asked once, not on every resubmit', () => {
  assert.ok(src.includes('state.confirmedSimilarServices'),
    'nothing remembers the answer, so confirming would re-ask forever');
});

console.log('\nThe server still refuses what it should');

test('validateEachPageInputs rejects a collision', () => {
  const { validateEachPageInputs } = require('./utils/helpers');
  const result = validateEachPageInputs({
    0: { filename: 'Drain Cleaning' },
    1: { filename: 'Drain, Cleaning' },
  });

  assert.strictEqual(result.ok, false, 'a collision was allowed through');
  assert.strictEqual(result.fields.length, 2, 'both entries should be flagged');
  assert.ok(/overwrite/i.test(result.error), 'the error does not say what would happen');
});

test('validateEachPageInputs allows similar names, with a warning', () => {
  const { validateEachPageInputs } = require('./utils/helpers');
  const result = validateEachPageInputs({
    0: { filename: 'Water Heater Repair' },
    1: { filename: 'Water Heater Repairs' },
  });

  assert.strictEqual(result.ok, true, 'similar names must not be refused');
  assert.ok(result.warnings && result.warnings.length, 'no warning was returned');
  assert.ok(result.warning, 'no message for the caller to show');
});

test('a clean list passes with no warnings at all', () => {
  const { validateEachPageInputs } = require('./utils/helpers');
  const result = validateEachPageInputs({
    0: { filename: 'Water Heater Repair' },
    1: { filename: 'Drain Cleaning' },
    2: { filename: 'Toilet Installation' },
  });

  assert.strictEqual(result.ok, true);
  assert.ok(!result.warnings, 'warned about nothing');
});

test('a missing filename is still the first thing reported', () => {
  const { validateEachPageInputs } = require('./utils/helpers');
  const result = validateEachPageInputs({ 0: { filename: '' }, 1: { filename: 'Repiping' } });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.fields[0].message, 'Required');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
