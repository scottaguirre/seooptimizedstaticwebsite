// test-keyword-intent.js
//
// The buyer-intent filter and the synonym collapse.
//
// THE FIXTURE IS REAL DATA, NOT INVENTED DATA
//
// AUSTIN below is transcribed from the actual Austin plumbing lookup of 23
// September — the run that made this module necessary. Invented rows would
// let me choose examples my own rule already handles; these are the rows that
// beat the previous version, so a regression has to get past them.
//
// Two of the assertions here encode mistakes made while writing the module,
// and both are the same kind: a rule that looked obviously right and quietly
// removed something real.
//
//   - A CPC floor of a FIFTH of the median vetoed "drain cleaning" at $10.42.
//     A real plumbing job, thrown away for being cheap to advertise against.
//   - Picking the SHORTEST spelling in a cluster chose "near me plumber" over
//     "plumbers near me" by one character — a phrase nobody types.
//
//   node test-keyword-intent.js

const assert = require('assert');

const {
  hasBuyerIntent, buyerIntentRows, collapseClusters, medianCpc, priceOf,
  hasGeo, looksInformational, phrasingRank, wordFrequency, commonness,
  CPC_FLOOR_FRACTION, MIN_ROWS_FOR_MEDIAN,
} = require('./utils/keywordIntent');

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

function row(keyword, volume, cpc) {
  return { keyword, volume, cpc };
}

/** The 23 September Austin plumbing lookup, as it appeared on screen. */
const AUSTIN = [
  row('american league detection', 27100, 1.66),
  row('plumbing', 2900, 36.67),
  row('plumbers near me', 2900, 54.33),
  row('near me plumber', 2900, 54.33),
  row('tankless water heater', 880, 8.99),
  row('garbage disposals', 880, 2.03),
  row('instant water heater', 880, 8.99),
  row('waterless tank heater', 880, 8.99),
  row('instantaneous water heater', 880, 8.99),
  row('tankless hot water tank', 880, 8.99),
  row('tankless water', 880, 8.99),
  row('continuous water heater', 880, 8.99),
  row('tankless instant water heater', 880, 8.99),
  row('tankless water boiler', 880, 8.99),
  row('tankless water geyser', 880, 8.99),
  row('drain cleaning', 590, 10.42),
  row('water heater repair', 480, 82.33),
  row('water heater installation', 390, 83.18),
  row('garbage disposal repair', 390, 11.32),
  row('water heater replacement', 390, 24.43),
];

const CTX = { city: 'Austin', industry: 'plumbing' };

function keptFrom(rows, ctx = CTX) {
  return buyerIntentRows(rows, ctx).rows.map(r => r.keyword);
}

console.log('\nKeyword intent\n');

/* ------------------------------------------------------------------ *
 * The real run
 * ------------------------------------------------------------------ */

test('the ten spellings of tankless water heater all go', () => {
  // Ten of the twenty rows on screen were one product term. Somebody reading
  // about tankless heaters is not hiring a plumber.
  const kept = keptFrom(AUSTIN);
  const tankless = kept.filter(k => /tankless|instant|waterless|continuous/.test(k));
  assert.deepStrictEqual(tankless, [], `still present: ${tankless.join(', ')}`);
});

test('the baseball goes, even though it contains a real service word', () => {
  // "american league detection" is Google's fuzzy expansion of "leak
  // detection". It passes ANY word test generous enough to keep leak
  // detection — which is exactly why the price veto exists.
  assert.ok(!keptFrom(AUSTIN).includes('american league detection'));
});

test('and it is the PRICE that removes it, not the words', () => {
  // If the word test were doing this, the veto could be deleted without the
  // suite noticing. Asserting which half did the work keeps both honest.
  assert.strictEqual(
    hasBuyerIntent('american league detection', CTX), true,
    'the word test is now rejecting it, so this test no longer proves anything'
  );

  const out = buyerIntentRows(AUSTIN, CTX);
  assert.ok(out.removedByPrice >= 1, 'the price veto removed nothing');
});

test('every row worth having survives', () => {
  const kept = keptFrom(AUSTIN);

  for (const wanted of [
    'plumbing',
    'water heater repair',
    'water heater installation',
    'water heater replacement',
    'garbage disposal repair',
    'drain cleaning',
  ]) {
    assert.ok(kept.includes(wanted), `${wanted} was thrown away`);
  }
});

test('"drain cleaning" at $10.42 survives the price veto', () => {
  // The cheapest real job in the fixture, and the one the floor comes
  // closest to removing.
  const { floor } = buyerIntentRows(AUSTIN, CTX);
  assert.ok(floor < 10.42, `the floor is $${floor.toFixed(2)}, above drain cleaning`);
  assert.ok(keptFrom(AUSTIN).includes('drain cleaning'));
});

test('the floor keeps a real margin under the cheapest real job', () => {
  // NOT "a fifth would have broken this" — it would not, on these twenty
  // rows. A fifth put the floor at $10.87 only on a working set two rows
  // wider, where the median was $54.33 instead of $36.67.
  //
  // Which is the actual reason for the constant, and what this asserts: the
  // median moves several dollars with a couple of rows either way, so the
  // floor needs margin rather than a near miss. Half the cheapest real job
  // is margin; nine tenths of it is luck.
  const { floor, median } = buyerIntentRows(AUSTIN, CTX);

  assert.ok(floor < 10.42 / 2,
    `the floor is $${floor.toFixed(2)} against a $10.42 job — too close to rely on`);

  assert.ok(CPC_FLOOR_FRACTION <= 0.1, 'the floor fraction has crept back up');
  assert.ok(median > 0);
});

test('"garbage disposals" goes but "garbage disposal repair" stays', () => {
  // The same object, two intentions, one word apart. If the filter cannot
  // tell these apart it is not doing anything.
  const kept = keptFrom(AUSTIN);
  assert.ok(!kept.includes('garbage disposals'));
  assert.ok(kept.includes('garbage disposal repair'));
});

/* ------------------------------------------------------------------ *
 * The word test
 * ------------------------------------------------------------------ */

test('a geo modifier is intent all by itself', () => {
  // THE RULE A VERB-ONLY TEST WOULD HAVE MISSED, and Edwin's own example list
  // is what made it obvious: "plumber cedar park" contains no verb at all and
  // is a hiring query start to finish.
  assert.ok(hasBuyerIntent('plumber cedar park', { city: 'Cedar Park' }));
  assert.ok(hasBuyerIntent('plumbing company near me', {}));
  assert.ok(hasBuyerIntent('water heater cedar park', { city: 'Cedar Park' }));
});

test('"near me" counts without any town being known', () => {
  assert.ok(hasGeo('plumbers near me'));
  assert.ok(hasGeo('plumber nearby'));
  assert.ok(!hasGeo('tankless water heater'));
});

test('the bare category is always kept — it is the home page', () => {
  // "plumbing" has no action word, no geo and no hire word. It is also the
  // one term every site in the trade ranks for.
  assert.ok(hasBuyerIntent('plumbing', { industry: 'plumbing' }));
  assert.ok(hasBuyerIntent('Plumbing ', { industry: 'plumbing' }));
});

test('action, hire, urgency, commerce and segment words each qualify', () => {
  assert.ok(hasBuyerIntent('slab leak repair', {}), 'action');
  assert.ok(hasBuyerIntent('plumbing contractor', {}), 'hire');
  assert.ok(hasBuyerIntent('24 hour plumber', {}), 'urgency');
  assert.ok(hasBuyerIntent('water heater replacement cost', {}), 'commerce');
  assert.ok(hasBuyerIntent('commercial plumbing', {}), 'segment');
});

test('reading about the trade does not qualify', () => {
  assert.ok(!hasBuyerIntent('how to fix a leaky faucet', {}));
  assert.ok(!hasBuyerIntent('what is a p trap', {}));
  assert.ok(!hasBuyerIntent('plumber salary', {}));
  assert.ok(!hasBuyerIntent('plumbing apprenticeship', {}));
  assert.ok(!hasBuyerIntent('pex vs copper', {}));
});

test('the informational list cannot veto a real hiring query', () => {
  // The danger of this list is a false positive, which is invisible. Every
  // entry has to be a phrase that cannot mean anything else.
  assert.ok(!looksInformational('emergency plumber austin'));
  assert.ok(!looksInformational('water heater installation cost'));
  assert.ok(!looksInformational('licensed plumber near me'));
});

test('the SERVICE_WORDS list is NOT reused here, and this is why', () => {
  // keywordVolumes.SERVICE_WORDS contains "water" and "heater", because it
  // answers a different question ("service or company name?"). Borrowed here
  // it would keep all ten tankless rows.
  const { SERVICE_WORDS } = require('./utils/keywordVolumes');
  assert.ok(SERVICE_WORDS.has('water') && SERVICE_WORDS.has('heater'),
    'the fixture for this test has changed; re-check the reasoning');

  assert.ok(!hasBuyerIntent('tankless water heater', CTX));
});

/* ------------------------------------------------------------------ *
 * The price veto
 * ------------------------------------------------------------------ */

test('a term nobody has bid on is kept, not vetoed', () => {
  // Absence of a bid is absence of evidence. In a small town the best page
  // available routinely has no CPC at all.
  const rows = [
    row('water heater repair', 480, 82.33),
    row('water heater installation', 390, 83.18),
    row('drain cleaning', 590, 40.00),
    row('plumbers near me', 900, 54.33),
    row('slab leak repair', 20, null),
  ];
  assert.ok(keptFrom(rows).includes('slab leak repair'));
});

test('no veto at all when too few rows are priced', () => {
  // A median of two numbers is not a description of a market, and a small
  // town easily returns three priced rows.
  const rows = [
    row('plumbing repair', 90, 60),
    row('plumbing service', 70, 55),
    row('cheap plumbing', 40, 0.50),
  ];
  const out = buyerIntentRows(rows, CTX);
  assert.strictEqual(out.removedByPrice, 0);
  assert.strictEqual(out.floor, null);
  assert.ok(keptFrom(rows).includes('cheap plumbing'));
  assert.ok(MIN_ROWS_FOR_MEDIAN > 3, 'the guard no longer covers this case');
});

test('the median comes from the QUALIFYING rows, not from everything', () => {
  // Taken from everything, the junk sets the standard by which junk is
  // judged: the tankless cluster drags the median down until the floor vetoes
  // nothing at all.
  const withJunk = buyerIntentRows(AUSTIN, CTX);
  const allMedian = medianCpc(AUSTIN);

  assert.ok(withJunk.median > allMedian,
    'the median is being computed before the word test, which defeats the veto');
});

test('the counts come back so the filter can be watched', () => {
  const out = buyerIntentRows(AUSTIN, CTX);
  assert.ok(out.removedByWords > 0);
  assert.ok(out.removedByPrice > 0);
  assert.strictEqual(
    out.rows.length + out.removedByWords + out.removedByPrice, AUSTIN.length,
    'the counts do not add up to what went in'
  );
});

/* ------------------------------------------------------------------ *
 * The synonym collapse
 * ------------------------------------------------------------------ */

test('identical volume and identical CPC collapse to one row', () => {
  const cluster = AUSTIN.filter(r => r.volume === 880 && r.cpc === 8.99);
  assert.strictEqual(cluster.length, 10, 'the fixture has changed');

  const out = collapseClusters(cluster);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].variants, 9);
});

test('the natural phrasing survives, not the shortest', () => {
  // "near me plumber" is 15 characters and "plumbers near me" is 16, so
  // shortest-wins picked the one nobody types. A term that OPENS with a
  // locative is ranked last instead.
  const out = collapseClusters([
    row('near me plumber', 2900, 54.33),
    row('plumbers near me', 2900, 54.33),
  ]);

  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].keyword, 'plumbers near me');
  assert.strictEqual(out[0].variants, 1);
});

test('phrasingRank marks an awkward opening and leaves a normal one alone', () => {
  assert.ok(phrasingRank('near me plumber') > phrasingRank('plumbers near me'));
  assert.strictEqual(phrasingRank('water heater repair'), 0);
});

/* ------------------------------------------------------------------ *
 * Which wording survives — three bugs, all the same bug
 * ------------------------------------------------------------------ *
 *
 * Shortest-wins picked "near me plumber", then "garburator repair", then
 * "hot water installation", then "soft water installation". Google's data
 * carries every regional and foreign name for a thing and the foreign one is
 * reliably shorter, so the rule handed an Austin plumber the Canadian word
 * for a garbage disposal.
 */

/** A corpus in the shape of the real answer: the ordinary words recur. */
const CORPUS = [
  ...AUSTIN,
  row('garburator repair', 390, 11.32),
  row('garbage disposal repair', 390, 11.32),
  row('garbage disposal installation', 90, 15),
  row('garbage disposal replacement', 70, 14),
  row('hot water installation', 390, 83.18),
  row('water heater installation', 390, 83.18),
  row('water heater cost', 110, 20),
  row('water heater flush', 60, 18),
  row('soft water installation', 210, 30),
  row('water softener installation', 210, 30),
  row('water softener repair', 70, 28),
];

const SEEDS = [
  'plumbing', 'plumbing austin', 'austin plumbing',
  'garbage disposal repair', 'water softener installation', 'leak detection',
];

function survivor(candidates, opts = {}) {
  const out = collapseClusters(candidates, {
    corpus: opts.corpus || CORPUS,
    seeds: opts.seeds || SEEDS,
  });
  assert.strictEqual(out.length, 1, 'the cluster did not collapse to one row');
  return out[0].keyword;
}

test('"garbage disposal repair" beats "garburator repair"', () => {
  // A garburator is a garbage disposal. In Canada.
  assert.strictEqual(
    survivor([
      row('garburator repair', 390, 11.32),
      row('garbage disposal repair', 390, 11.32),
      row('garbage disposal fix', 390, 11.32),
    ]),
    'garbage disposal repair'
  );
});

test('"water heater installation" beats "hot water installation"', () => {
  assert.strictEqual(
    survivor([
      row('hot water installation', 390, 83.18),
      row('water heater installation', 390, 83.18),
      row('hot water heater installation', 390, 83.18),
    ]),
    'water heater installation'
  );
});

test('"water softener installation" beats "soft water installation"', () => {
  assert.strictEqual(
    survivor([
      row('soft water installation', 210, 30),
      row('water softener installation', 210, 30),
    ]),
    'water softener installation'
  );
});

test('the rare word sinks a phrase even when the rest of it is ordinary', () => {
  // The MINIMUM, not the average: "repair" is common enough to carry
  // "garburator" on any averaging rule.
  const counts = wordFrequency(CORPUS);

  assert.ok(commonness('garburator repair', counts)
    < commonness('garbage disposal repair', counts));
  assert.ok(counts.get('repair') > counts.get('garburator'),
    'the fixture no longer demonstrates the problem');
});

test('the corpus is what decides, so passing the cluster alone is not enough', () => {
  // Inside one cluster "garburator" and "garbage" appear equally often and
  // neither looks odd. The signal only exists against the whole answer.
  const cluster = [
    row('garburator repair', 390, 11.32),
    row('garbage disposal repair', 390, 11.32),
  ];

  const counts = wordFrequency(cluster);
  assert.strictEqual(counts.get('garburator'), counts.get('garbage'),
    'inside the cluster the two words are indistinguishable, which is the point');

  // And with the corpus, they are not.
  const wide = wordFrequency(CORPUS);
  assert.ok(wide.get('garbage') > wide.get('garburator'));
});

test('a seed match outranks mere commonness', () => {
  // The trade's own vocabulary, whether the model wrote it or the customer
  // typed it, beats a word that merely happens to recur.
  assert.strictEqual(
    survivor([
      row('disposal repair', 390, 11.32),
      row('garbage disposal repair', 390, 11.32),
    ]),
    'garbage disposal repair'
  );
});

test('with no corpus and no seeds it still collapses, just less wisely', () => {
  // The old call signature must keep working — keywordIdeasFor is not the
  // only caller, and a missing corpus is a worse answer, not a crash.
  const out = collapseClusters([
    row('near me plumber', 2900, 54.33),
    row('plumbers near me', 2900, 54.33),
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].keyword, 'plumbers near me');
});

/* ------------------------------------------------------------------ *
 * The price veto judges the highest bid, not the average
 * ------------------------------------------------------------------ */

test('the veto reads the highest top-of-page bid when there is one', () => {
  assert.strictEqual(priceOf({ cpc: 1.66, high: 2.14 }), 2.14);
  assert.strictEqual(priceOf({ cpc: 82.33, high: 148.26 }), 148.26);
});

test('it falls back to CPC when no bid range came back', () => {
  assert.strictEqual(priceOf({ cpc: 36.67, high: null }), 36.67);
  assert.strictEqual(priceOf({ cpc: 36.67 }), 36.67);
});

test('a row with neither is not judged at all', () => {
  assert.strictEqual(priceOf({ cpc: null, high: null }), null);
  assert.strictEqual(priceOf(null), null);
});

test('the baseball is removed on the bid where CPC let it through', () => {
  // THE PRODUCTION FAILURE. On CPC the junk sat 6x below the cheapest real
  // job and the live median was low enough that the floor fell under $1.66.
  // On the highest bid it sits 25x below, with every real term $54–$178.
  const withBids = [
    { keyword: 'american league detection', volume: 27100, cpc: 1.66, high: 2.14 },
    { keyword: 'drain cleaning', volume: 590, cpc: 10.42, high: 54.45 },
    { keyword: 'garbage disposal repair', volume: 390, cpc: 11.32, high: 89.69 },
    { keyword: 'water heater repair', volume: 480, cpc: 82.33, high: 148.26 },
    { keyword: 'emergency plumber near me', volume: 320, cpc: 103.61, high: 177.93 },
    { keyword: 'plumbing', volume: 2900, cpc: 36.67, high: 97.98 },
  ];

  const kept = keptFrom(withBids);

  assert.ok(!kept.includes('american league detection'), 'the baseball survived again');
  assert.ok(kept.includes('drain cleaning'), 'the cheapest real job was taken with it');

  // And the margin is wide now, not a near miss: the floor should sit well
  // under the cheapest real term rather than just below it.
  const { floor } = buyerIntentRows(withBids, CTX);
  assert.ok(floor < 54.45 / 4,
    `the floor is $${floor.toFixed(2)} against a $54.45 term — the margin is back to luck`);
});

test('CPC alone would NOT have removed it, which is why this changed', () => {
  // Asserting the counterfactual, so nobody reverts to the average thinking
  // the two are equivalent.
  const cpcOnly = [
    { keyword: 'american league detection', volume: 27100, cpc: 1.66 },
    { keyword: 'drain cleaning', volume: 590, cpc: 10.42 },
    { keyword: 'garbage disposal repair', volume: 390, cpc: 11.32 },
    { keyword: 'water heater cost', volume: 110, cpc: 20 },
    { keyword: 'water softener repair', volume: 70, cpc: 28 },
  ];

  // Median $11.32, floor $1.13 — under the baseball's $1.66.
  assert.ok(keptFrom(cpcOnly).includes('american league detection'),
    'the fixture no longer reproduces the production failure');
});

test('two unrelated terms that collide on both figures are NOT merged', () => {
  // Merging them would be a lie told confidently. Requiring a shared word
  // costs nothing and removes the failure mode.
  const out = collapseClusters([
    row('water heater repair', 390, 24.43),
    row('gutter cleaning', 390, 24.43),
  ]);
  assert.strictEqual(out.length, 2);
});

test('rows with no bid are never clustered', () => {
  // At 10 searches and no CPC half a small town's keywords share both
  // figures by coincidence.
  const out = collapseClusters([
    row('slab leak repair', 10, null),
    row('gas line repair', 10, null),
    row('sump pump repair', 10, null),
  ]);
  assert.strictEqual(out.length, 3);
  assert.ok(out.every(r => !r.variants));
});

test('a lone row keeps its shape and gains no variant count', () => {
  const out = collapseClusters([row('water heater repair', 480, 82.33)]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].variants, undefined);
});

test('collapsing preserves the row, including the bid range', () => {
  // The low and high bids are columns on the page now; a collapse that
  // dropped them would blank two columns for exactly the clustered rows.
  const out = collapseClusters([
    { keyword: 'plumbers near me', volume: 2900, cpc: 54.33, low: 12.5, high: 98.2 },
    { keyword: 'near me plumber', volume: 2900, cpc: 54.33, low: 12.5, high: 98.2 },
  ]);
  assert.strictEqual(out[0].low, 12.5);
  assert.strictEqual(out[0].high, 98.2);
});

test('nothing in, nothing out, no exception', () => {
  assert.deepStrictEqual(collapseClusters([]), []);
  assert.deepStrictEqual(collapseClusters(null), []);
  assert.deepStrictEqual(buyerIntentRows(null, CTX).rows, []);
  assert.strictEqual(medianCpc([]), null);
});

/* ------------------------------------------------------------------ *
 * End to end, on the real run
 * ------------------------------------------------------------------ */

test('the Austin twenty becomes the list Edwin asked for', () => {
  const out = buyerIntentRows(AUSTIN, CTX);
  const final = collapseClusters(out.rows)
    .sort((a, b) => b.volume - a.volume)
    .map(r => r.keyword);

  assert.deepStrictEqual(final, [
    'plumbing',
    'plumbers near me',
    'drain cleaning',
    'water heater repair',
    'water heater installation',
    'garbage disposal repair',
    'water heater replacement',
  ]);
});

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('');
process.exit(failed === 0 ? 0 : 1);
