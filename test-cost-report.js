// test-cost-report.js
//
// The "do I need to charge for this?" report.
//
// WHY THIS IS TESTED AT ALL, FOR A SCRIPT NOBODY DEPLOYS
//
// It is the input to a pricing decision. A report that quietly undercounts
// produces a confident "no, it is cheap" that is wrong — and nobody would
// check, because the whole point of the report is not having to check.
//
// The specific ways it could lie, each of which has a test below:
//
//   - counting an unmeasured call as $0 without saying so
//   - averaging the busiest user away into a total
//   - a malformed line ending the run, so the report covers half the window
//   - reading the tail rather than the window
//
//   node test-cost-report.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseArgs, emptyTotals, add, modelCost, busiestDay, format, report,
  PRICES, MODEL_EVENTS, VENDOR_EVENTS,
} = require('./cost-report');

let passed = 0, failed = 0;

/* AWAITED BY THE CALLER, EVERY TIME.
 *
 * The first version of this file returned the promise and nobody awaited it.
 * Two async tests — the window one and the missing-log one — ran, resolved
 * after process.exit, and printed nothing at all. The suite said "18 passed"
 * with twenty tests in the file.
 *
 * A test that cannot fail is worse than no test: it is a line in the output
 * that says the thing is covered. */
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok    ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}\n        ${err.message}`);
    failed++;
  }
}

const line = obj => JSON.stringify(obj);
const ago = days => new Date(Date.now() - days * 86400000).toISOString();

function suggestion(over = {}) {
  return {
    time: ago(1), event: 'services.suggested', userId: 'u1',
    businessType: 'Plumbing', count: 19, dropped: 1,
    inputTokens: 285, outputTokens: 470, ...over,
  };
}

function lookup(over = {}) {
  return { time: ago(1), event: 'keywords.ideas', userId: 'u2', costUsd: 0.09, ...over };
}

function feed(rows) {
  const totals = emptyTotals();
  for (const row of rows) add(totals, typeof row === 'string' ? row : line(row));
  return totals;
}

async function main() {
console.log('\nCost report\n');

/* ------------------------------------------------------------------ *
 * The arithmetic
 * ------------------------------------------------------------------ */

  await test('a call is priced from its own tokens, in and out separately', () => {
  // Output costs six times input on this model, so a single blended rate
  // would be wrong by a factor of three either way.
  const usd = modelCost(1e6, 1e6);

  assert.strictEqual(usd, PRICES.model.inputPerMillion + PRICES.model.outputPerMillion);
  assert.ok(PRICES.model.outputPerMillion > PRICES.model.inputPerMillion,
    'the fixture no longer reflects output being dearer');
});

  await test('the measured call from the real log comes out at about a cent', () => {
  // 285 in, 470 out — the first line that ever carried token counts.
  const usd = modelCost(285, 470);

  assert.ok(usd > 0.005 && usd < 0.008, `${usd} is not the measured figure`);
});

/* ------------------------------------------------------------------ *
 * Counting
 * ------------------------------------------------------------------ */

  await test('model calls tally their tokens and their cost', () => {
  const totals = feed([suggestion(), suggestion({ inputTokens: 400, outputTokens: 1000 })]);

  assert.strictEqual(totals.model.calls, 2);
  assert.strictEqual(totals.model.inputTokens, 685);
  assert.strictEqual(totals.model.outputTokens, 1470);
  assert.strictEqual(totals.model.usd, modelCost(685, 1470));
});

  await test('A CALL WITH NO TOKEN COUNTS IS NOT A CALL THAT COST NOTHING', () => {
  // Nineteen real log lines predate the token logging. Counting them as $0
  // would drag the average down and answer the pricing question with a
  // number that is wrong in the reassuring direction.
  const totals = feed([suggestion(), suggestion({ inputTokens: undefined, outputTokens: undefined })]);

  assert.strictEqual(totals.model.calls, 2);
  assert.strictEqual(totals.model.unmeasured, 1);

  const text = format({ totals, days: 30 });
  assert.match(text, /undercount/i, 'the report does not admit it is short');
});

  await test('a cache hit is counted as a call and not as a cost', () => {
  // The cache is most of the traffic and none of the bill. Counting hits as
  // spending would make the feature look four times dearer than it is.
  const totals = feed([lookup({ costUsd: 0 }), lookup()]);

  assert.strictEqual(totals.vendor.calls, 2);
  assert.strictEqual(totals.vendor.paid, 1);
  assert.strictEqual(totals.vendor.cached, 1);
  assert.ok(Math.abs(totals.vendor.usd - 0.09) < 1e-9);
});

  await test('each keyword mode is tallied separately', () => {
  // Three modes share one budget and one vendor. "Which mode is spending
  // it?" is the next question after "how much?".
  const totals = feed([
    lookup({ event: 'keywords.ideas' }),
    lookup({ event: 'keywords.exact' }),
    lookup({ event: 'keywords.exact' }),
    lookup({ event: 'keywords.pairs', costUsd: 0 }),
  ]);

  assert.strictEqual(totals.vendor.byEvent.get('keywords.exact').paid, 2);
  assert.strictEqual(totals.vendor.byEvent.get('keywords.pairs').paid, 0);
  assert.strictEqual(totals.vendor.byEvent.get('keywords.pairs').calls, 1);
});

  await test('events that cost nothing are ignored entirely', () => {
  const totals = feed([
    { time: ago(1), event: 'app.started' },
    { time: ago(1), event: 'auth.reset.requested', userId: 'u1' },
    suggestion(),
  ]);

  assert.strictEqual(totals.model.calls, 1);
  assert.strictEqual(totals.vendor.calls, 0);
  assert.strictEqual(totals.users.size, 1, 'a free event put a user on the bill');
});

  await test('a mangled line is skipped, counted, and does not end the run', () => {
  // pino writes one object per line, but a crash mid-write leaves a partial
  // one. A report that stopped there would cover part of the window and say
  // nothing about it.
  const totals = feed([suggestion(), '{not json at all', suggestion()]);

  assert.strictEqual(totals.model.calls, 2, 'the run stopped at the bad line');
  assert.strictEqual(totals.unparsed, 1);

  assert.match(format({ totals, days: 30 }), /could not be parsed/,
    'the report hides that it skipped something');
});

  await test('a line with no timestamp is not counted', () => {
  // It cannot be placed in the window, so including it would inflate
  // whatever window it happened to be read in.
  const totals = feed([{ event: 'services.suggested', inputTokens: 999, outputTokens: 999 }]);

  assert.strictEqual(totals.model.calls, 0);
});

/* ------------------------------------------------------------------ *
 * The user who matters
 * ------------------------------------------------------------------ */

  await test('THE BUSIEST USER-DAY IS REPORTED, BECAUSE THE TOTAL HIDES IT', () => {
  // $4 across forty customers is "do not charge". $4 where one account is
  // $3.50 of it is a different decision entirely, and the total cannot tell
  // them apart. The decision this feeds is whether ONE customer can hurt you.
  const totals = feed([
    lookup({ userId: 'quiet', time: ago(2) }),
    lookup({ userId: 'loud', time: ago(1) }),
    lookup({ userId: 'loud', time: ago(1) }),
    lookup({ userId: 'loud', time: ago(1) }),
  ]);

  const worst = busiestDay(totals);

  assert.strictEqual(worst.userId, 'loud');
  assert.strictEqual(worst.calls, 3);
  assert.ok(Math.abs(worst.usd - 0.27) < 1e-9);

  assert.match(format({ totals, days: 30 }), /loud/,
    'the busiest user never reaches the page');
});

  await test('one user on two days is two days, not one big one', () => {
  // Otherwise a customer who uses the tool steadily for a month reads as an
  // abuser, and the number that is supposed to spot abuse spots everybody.
  const totals = feed([
    lookup({ userId: 'steady', time: ago(1) }),
    lookup({ userId: 'steady', time: ago(2) }),
    lookup({ userId: 'steady', time: ago(3) }),
  ]);

  assert.strictEqual(busiestDay(totals).calls, 1);
});

  await test('a call with no user still appears somewhere', () => {
  // userId is '' for anything hit while logged out. Dropping those would
  // quietly remove a whole class of traffic from the bill.
  const totals = feed([lookup({ userId: '' })]);

  assert.strictEqual(totals.users.size, 1);
  assert.strictEqual(busiestDay(totals).userId, '(anonymous)');
});

/* ------------------------------------------------------------------ *
 * Reading the file
 * ------------------------------------------------------------------ */

  await test('the WINDOW is read, not the tail', async () => {
  // The first answer to this question came from `tail -50`, which is
  // whatever happened to be last — an hour on a busy day, a week on a quiet
  // one. Two old lines and one recent one must report one.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-'));
  const file = path.join(dir, 'app.log');

  fs.writeFileSync(file, [
    line(lookup({ time: ago(90) })),
    line(lookup({ time: ago(60) })),
    line(lookup({ time: ago(1) })),
  ].join('\n') + '\n');

  const recent = await report({ days: 7, file });
  assert.strictEqual(recent.totals.vendor.calls, 1, 'old lines leaked into the window');

  const all = await report({ days: 365, file });
  assert.strictEqual(all.totals.vendor.calls, 3, 'a wider window found fewer lines');
});

  await test('a missing log says where the log actually lives', async () => {
  // The predictable mistake is running this on the Mac, where logs go to
  // stdout because NODE_ENV is not production, so the file is simply absent.
  try {
    await report({ days: 30, file: path.join(os.tmpdir(), 'nope-' + Date.now(), 'app.log') });
    assert.fail('a missing log was not reported');
  } catch (err) {
    assert.ok(err.missingLog, 'the caller cannot tell this apart from a real failure');
  }
});

  await test('an empty window says so instead of printing zeroes', () => {
  // A page of $0.00 rows reads as "the report is broken". One line reads as
  // "nothing happened", which is the finding.
  const text = format({ totals: emptyTotals(), days: 30 });

  assert.match(text, /Nothing billable/i);
  assert.ok(!/TOTAL/.test(text), 'it printed a total of nothing');
});

/* ------------------------------------------------------------------ *
 * Arguments
 * ------------------------------------------------------------------ */

  await test('the defaults are the common case', () => {
  const opts = parseArgs(['node', 'cost-report.js']);

  assert.strictEqual(opts.days, 30);
  assert.match(opts.file, /logs[/\\]app\.log$/);
  assert.strictEqual(opts.json, false);
});

  await test('--days and a path are both accepted, in either order', () => {
  assert.strictEqual(parseArgs(['n', 'c', '--days', '7']).days, 7);
  assert.strictEqual(parseArgs(['n', 'c', '/tmp/x.log', '--days', '90']).days, 90);
  assert.strictEqual(parseArgs(['n', 'c', '--days', '90', '/tmp/x.log']).file, '/tmp/x.log');
});

  await test('A BAD --days IS REFUSED RATHER THAN TREATED AS ZERO', () => {
  // Number('a week') is NaN, and every comparison against NaN is false — so
  // the window would match nothing and the report would say "nothing
  // billable", which is a confident wrong answer to a money question.
  for (const bad of ['a week', '', '-5', '0']) {
    assert.throws(() => parseArgs(['n', 'c', '--days', bad]), /positive number/,
      `--days ${JSON.stringify(bad)} was accepted`);
  }
});

/* ------------------------------------------------------------------ *
 * What the report admits it cannot see
 * ------------------------------------------------------------------ */

  await test('the seed-term model call is a KNOWN gap, stated in the source', () => {
  // keywords.pairs and keywords.ideas each make a model call for the seed
  // terms and log no tokens for it, so the model figure here is short. A gap
  // nobody wrote down is a gap that gets forgotten and then quoted as fact.
  const source = fs.readFileSync(path.join(__dirname, 'cost-report.js'), 'utf8');

  assert.match(source, /UNDERCOUNT of the model bill/,
    'the missing seed-term tokens are no longer admitted');
  assert.ok(!MODEL_EVENTS.has('keywords.ideas'),
    'ideas is being priced as a model call without token counts');
  assert.ok(VENDOR_EVENTS.has('keywords.ideas'));
});

  await test('the price carries the date it was checked', () => {
  // OpenAI cut this model's rate on 30 July 2026. A hardcoded price with no
  // date is a number nobody knows whether to trust.
  assert.ok(PRICES.checked, 'no date on the prices');
  assert.match(format({ totals: feed([suggestion()]), days: 30 }), /last checked/i);
});

  console.log('');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('');

  // Counted, not assumed. A test that never ran cannot fail, and the count
  // going quiet is the only way that shows.
  const declared = fs.readFileSync(__filename, 'utf8').match(/await test\(/g).length;

  if (passed + failed !== declared) {
    console.log(`  ${declared} tests declared but ${passed + failed} ran — one never reported\n`);
    process.exit(1);
  }

  process.exit(failed === 0 ? 0 : 1);
}

main();
