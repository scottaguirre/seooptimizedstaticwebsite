// test-probe-log.js
//
// How often a blocked request gets a log line.
//
// WHAT THIS IS GUARDING
//
// On 16 October Edwin pasted the last thirty lines of webgen-error.log.
// Twenty of them were this:
//
//     ⚠️ Stripped a Mongo operator from the query of GET /index.php
//        (ip 103.46.186.85) — keys after sanitising: lang, config-create /
//
// and two of them were real faults — a page-content JSON parse failure and a
// ValueSERP timeout — sitting half-buried among the probes. The guard that
// produced those twenty lines was working perfectly. Its logging was the
// problem, in two separate ways: console.warn put a blocked scanner probe in
// the ERROR log, and one line per request is the wrong rate for traffic
// nobody controls.
//
// WHAT IS WORTH ASSERTING, which is not "does it log"
//
//   - the FIRST request of a shape is still reported, at once and in full,
//     because that is the one that answers "scanner, or our own front end?"
//   - the second and the two hundredth are not
//   - the counts come out once an hour, not never
//   - a scanner cannot make this module remember an unbounded amount, which
//     is the memory leak someone else gets to trigger
//
//   node test-probe-log.js

const fs = require('fs');
const assert = require('assert');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}
function section(n) { console.log(`\n${n}\n`); }

/* A FRESH MODULE PER TEST.
 *
 * probeLog keeps its counters in module scope — one per process, which is
 * what makes an hourly summary possible at all. That also means every test
 * would inherit the last one's state, and the order of the tests would
 * decide whether they passed. */
function fresh() {
  delete require.cache[require.resolve('./utils/probeLog')];
  return require('./utils/probeLog');
}

const SCANNER = { where: 'GET /index.php', who: '103.46.186.85', keys: 'lang, config-create /' };
const T0 = 1_760_000_000_000;
const HOUR = 60 * 60 * 1000;

const events = out => out.map(e => e.event);

// ---------------------------------------------------------------------------
section('The first of a shape is reported in full');
// ---------------------------------------------------------------------------

test('a shape never seen before produces one event', function () {
  const probeLog = fresh();
  const out = probeLog.note(SCANNER, T0);

  assert.deepStrictEqual(events(out), ['request.operatorStripped']);
  assert.strictEqual(out[0].context.where, 'GET /index.php');
  assert.strictEqual(out[0].context.ip, '103.46.186.85');
  assert.strictEqual(out[0].context.keys, 'lang, config-create /');
});

test('AND THE SECOND ONE PRODUCES NOTHING', function () {
  /* The whole point. Twenty identical lines said nothing the first did not. */
  const probeLog = fresh();

  probeLog.note(SCANNER, T0);

  assert.deepStrictEqual(probeLog.note(SCANNER, T0 + 1000), []);
  assert.deepStrictEqual(probeLog.note(SCANNER, T0 + 2000), []);
});

test('two hundred of them produce one event, not two hundred', function () {
  const probeLog = fresh();

  let lines = 0;
  for (let i = 0; i < 200; i++) {
    lines += probeLog.note({ ...SCANNER, who: `10.0.0.${i % 50}` }, T0 + i * 100).length;
  }

  assert.strictEqual(lines, 1, `${lines} lines for two hundred identical probes`);
});

test('a DIFFERENT shape is reported, even from the same address', function () {
  /* The route and the key names together. A probe looking for a PHP shell
   * and one looking for a Mongo operator are different events, and the key
   * names are what tell them apart. */
  const probeLog = fresh();

  probeLog.note(SCANNER, T0);

  assert.deepStrictEqual(
    events(probeLog.note({ ...SCANNER, where: 'GET /wp-login.php' }, T0 + 10)),
    ['request.operatorStripped']
  );
  assert.deepStrictEqual(
    events(probeLog.note({ ...SCANNER, keys: 'user.$ne' }, T0 + 20)),
    ['request.operatorStripped']
  );
});

test('AND THE SAME SHAPE FROM A THOUSAND ADDRESSES IS STILL ONE SHAPE', function () {
  /* The IP is deliberately NOT part of the shape. A distributed scan is one
   * event; treating each source as new would reproduce exactly the flood
   * this module removes. */
  const probeLog = fresh();

  let lines = 0;
  for (let i = 0; i < 1000; i++) {
    lines += probeLog.note({ ...SCANNER, who: `198.51.100.${i % 256}` }, T0 + i).length;
  }

  assert.strictEqual(lines, 1, `${lines} lines for one shape from a thousand addresses`);
});

test('OUR OWN FRONT END SENDING A DOTTED KEY IS STILL REPORTED', function () {
  /* The reason silence is not an option. The guard catches `$`-prefixed AND
   * dotted keys, and the dotted case will fire innocently one day on a real
   * route. If that line were swallowed because a scanner had been busy, the
   * bug would be invisible. A new shape is always announced. */
  const probeLog = fresh();

  for (let i = 0; i < 500; i++) probeLog.note(SCANNER, T0 + i);

  const ours = { where: 'POST /generate', who: '203.0.113.9', keys: 'global.location' };

  assert.deepStrictEqual(events(probeLog.note(ours, T0 + 600)), ['request.operatorStripped']);
});

// ---------------------------------------------------------------------------
section('The counts come out once an hour');
// ---------------------------------------------------------------------------

test('nothing is summarised before the window closes', function () {
  const probeLog = fresh();

  probeLog.note(SCANNER, T0);
  const out = probeLog.note(SCANNER, T0 + HOUR - 1000);

  assert.deepStrictEqual(events(out), []);
});

test('AND A SUMMARY ARRIVES ONCE IT DOES', function () {
  const probeLog = fresh();

  for (let i = 0; i < 231; i++) probeLog.note(SCANNER, T0 + i * 100);

  const out = probeLog.note(SCANNER, T0 + HOUR + 1);

  assert.ok(events(out).includes('request.operatorStripped.summary'),
    `the window closed and nothing was reported: ${JSON.stringify(events(out))}`);

  const sum = out.find(e => e.event === 'request.operatorStripped.summary').context;

  assert.strictEqual(sum.requests, 231, 'the total is wrong');
  assert.strictEqual(sum.shapes, 1);
  assert.match(sum.busiest[0], /GET \/index\.php .* ×231/);
});

test('the summary reports the window it covers, not the one it starts', function () {
  /* Counted before the reset. The first version added the triggering request
   * to the total first, so the summary claimed 232 probes in an hour that
   * saw 231 — and the next window started at zero having already had one. */
  const probeLog = fresh();

  for (let i = 0; i < 10; i++) probeLog.note(SCANNER, T0 + i);

  const out = probeLog.note(SCANNER, T0 + HOUR + 1);
  const sum = out.find(e => e.event === 'request.operatorStripped.summary').context;

  assert.strictEqual(sum.requests, 10, 'the triggering request was counted into the old window');
});

test('and the window starts again, so the next shape is announced', function () {
  const probeLog = fresh();

  probeLog.note(SCANNER, T0);
  probeLog.note(SCANNER, T0 + HOUR + 1);

  /* Same shape, new window. Announced again — an hour later, "this is still
   * happening" is worth one line. */
  assert.deepStrictEqual(
    events(probeLog.note(SCANNER, T0 + 2 * HOUR + 2)),
    ['request.operatorStripped.summary', 'request.operatorStripped']
  );
});

test('A QUIET HOUR REPORTS NOTHING AT ALL', function () {
  /* No probes, no summary. "0 requests" every hour for ever would be the same
   * mistake in a different place. */
  const probeLog = fresh();

  assert.deepStrictEqual(probeLog.flush(T0 + HOUR), []);
});

test('flush reports what is pending without waiting for the next probe', function () {
  const probeLog = fresh();

  for (let i = 0; i < 5; i++) probeLog.note(SCANNER, T0 + i);

  const out = probeLog.flush(T0 + 60_000);

  assert.deepStrictEqual(events(out), ['request.operatorStripped.summary']);
  assert.strictEqual(out[0].context.requests, 5);
  assert.strictEqual(out[0].context.minutes, 1);

  // And it emptied the counters rather than reporting them twice.
  assert.deepStrictEqual(probeLog.flush(T0 + 120_000), []);
});

// ---------------------------------------------------------------------------
section('A SCANNER CANNOT MAKE IT REMEMBER AN UNBOUNDED AMOUNT');
// ---------------------------------------------------------------------------

test('the number of remembered shapes is capped', function () {
  /* They choose the route and the key names, which means without a cap they
   * choose how much this module remembers. An unbounded Map fed by
   * unauthenticated traffic is a memory leak someone else triggers. */
  const probeLog = fresh();

  for (let i = 0; i < 5000; i++) {
    probeLog.note({ ...SCANNER, where: `GET /probe-${i}` }, T0 + i);
  }

  const sum = probeLog.flush(T0 + 10_000)[0].context;

  assert.strictEqual(sum.shapes, probeLog.MAX_SHAPES,
    `${sum.shapes} shapes remembered, cap is ${probeLog.MAX_SHAPES}`);
  assert.strictEqual(sum.requests, 5000, 'the total stopped counting at the cap');
});

test('AND A ROTATING KEY NAME STOPS EARNING LINES ONCE IT IS FULL', function () {
  /* Found by asking what the cap does on its own. Remembering only fifty
   * shapes but ANNOUNCING every unseen one would leave a scanner rotating
   * key names with a fresh log line per request — the exact flood this
   * module exists to remove, reached by a different route. */
  const probeLog = fresh();

  let lines = 0;
  for (let i = 0; i < 2000; i++) {
    lines += probeLog.note({ ...SCANNER, keys: `rotating-${i}` }, T0 + i).length;
  }

  assert.strictEqual(lines, probeLog.MAX_SHAPES,
    `${lines} lines from two thousand rotating key names`);
});

test('the number of remembered addresses is capped too', function () {
  const probeLog = fresh();

  for (let i = 0; i < 1000; i++) {
    probeLog.note({ ...SCANNER, who: `198.51.100.${i}` }, T0 + i);
  }

  const sum = probeLog.flush(T0 + 2000)[0].context;

  assert.strictEqual(sum.addresses, `${probeLog.MAX_IPS}+`,
    'the address count is neither capped nor marked as capped');
});

test('and a capped count says so rather than reading as exact', function () {
  /* "100" and "100+" are different facts. A distributed scan from four
   * hundred addresses reported as exactly 100 is a number somebody would
   * later act on. */
  const probeLog = fresh();

  for (let i = 0; i < 3; i++) probeLog.note({ ...SCANNER, who: `10.0.0.${i}` }, T0 + i);

  assert.strictEqual(probeLog.flush(T0 + 1000)[0].context.addresses, 3);
});

// ---------------------------------------------------------------------------
section('Junk does not throw');
// ---------------------------------------------------------------------------

test('a probe with nothing in it is still counted', function () {
  /* This runs inside middleware on every request the sanitiser touches. A
   * fatal here turns a blocked probe into a 500 and makes the guard itself
   * the outage — which is the reason the code around it is already
   * defensive about `req`. */
  const probeLog = fresh();

  for (const junk of [undefined, null, {}, 'GET /x', 7, []]) {
    assert.doesNotThrow(() => probeLog.note(junk, T0));
  }

  assert.strictEqual(probeLog.flush(T0 + 1000)[0].context.requests, 6);
});

test('a missing clock does not produce a nonsense window', function () {
  const probeLog = fresh();

  probeLog.note(SCANNER);
  const out = probeLog.flush();

  assert.strictEqual(out.length, 1);
  assert.ok(out[0].context.minutes >= 0, `minutes was ${out[0].context.minutes}`);
});

// ---------------------------------------------------------------------------
section('server.js uses it, and no longer writes to stderr');
// ---------------------------------------------------------------------------

/* Comments stripped. server.js explains at length what the old line did and
 * quotes it; six times now this project has had a source check match the
 * comment describing the thing it forbids. */
const server = fs.readFileSync(require.resolve('./server.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/* The onSanitize handler, bounded by CODE on both sides.
 *
 * The first version of this ended the slice at `// ===== RATE LIMITS =====`,
 * which is a COMMENT — and the source it searches has had its comments
 * stripped two lines above. indexOf returned -1, slice(start, -1) handed back
 * most of the file, and the console.* check failed on every unrelated
 * console.log in server.js.
 *
 * Seventh time this project has been bitten by the comment-stripping pass,
 * and the second today. An anchor in stripped source has to be code. */
function sanitiseBlock() {
  const from = server.indexOf('onSanitize:');
  const to = server.indexOf('app.use(generalLimiter)');

  assert.ok(from > -1, 'the onSanitize handler could not be found');
  assert.ok(to > from, 'the end anchor is missing or moved above the handler');

  return server.slice(from, to);
}

test('THE SANITISER NO LONGER CALLS console.warn', function () {
  /* The half of the fix that gets it out of webgen-error.log. Summarising
   * while still writing to stderr would put one line an hour in the wrong
   * file instead of two hundred. */
  const block = sanitiseBlock();

  assert.ok(!/console\.(warn|error|log)/.test(block),
    'the sanitiser still writes to stdout or stderr, which pm2 files as an error');
});

test('it logs what probeLog hands back, through the structured logger', function () {
  const block = sanitiseBlock();

  assert.match(block, /probeLog\.note\(/, 'the sanitiser does not consult probeLog');
  assert.match(block, /log\.security\(/, 'nothing is logged through the structured logger');
});

test('and probeLog is actually required', function () {
  assert.match(server, /require\('\.\/utils\/probeLog'\)/,
    'probeLog is used and never imported');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
