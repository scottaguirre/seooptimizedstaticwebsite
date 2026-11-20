// test-released-hostname.js
//
// Giving a hostname back when the site that held it is deleted.
//
//   node test-released-hostname.js
//
//
// THE NIGHT THIS FILE IS ABOUT — 20 November
//
// Seven sites in one batch. Six live. The seventh:
//
//     "event":"jobs.cloudflarePublish","ok":false,"code":"raced","siteId":""
//
// Nothing raced. A batch builds one site at a time, and the row that
// refused it had been torn down cleanly forty-five minutes earlier:
//
//     6afe9db0ecc9acc86cbbfd46  removed
//     released {"domain":true,"dns":true,"project":true,"at":"…T01:16:18Z"}
//
// checkWant() excludes exactly that row and said the name was free.
// `unique: true` on siteUrl excludes nothing and said it was not. The build
// had already run and the credits were already spent.
//
//     A RULE KEPT IN TWO PLACES GETS CHANGED IN ONE OF THEM. On 17
//     November the query learned that a released row does not reserve its
//     name. The index could not be told, because an index cannot read a
//     comment.
//
//
// WHAT IS WORTH ASSERTING, AND WHAT IS NOT
//
// Not "the field is set" — that is this file agreeing with itself. The
// tests below ask the question the index asks: CAN A HOSTNAME QUERY STILL
// FIND THIS ROW? That is the only thing that was ever wrong.
//
// And two rows that held the same hostname must end up DIFFERENT, because
// a single shared marker would move the duplicate-key error rather than
// remove it — the same bug, one field to the left.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const R = require('./utils/cloudflareSites/releasedHostname');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

async function atest(name, fn) {
  try { await fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

function section(name) { console.log(`\n${name}\n`); }

const HOST = 'pt-air-conditioning-austin.2-r2.com';

/** A row shaped like the one that actually refused the build. */
function row(over = {}) {
  const site = {
    _id: over._id || '6afe9db0ecc9acc86cbbfd46',
    status: 'removed',
    siteUrl: HOST,
    releasedUrl: '',
    released: { domain: true, dns: true, project: true, at: new Date() },
    saved: 0,
    async save() { this.saved += 1; },
  };

  return Object.assign(site, over, {
    released: { ...site.released, ...(over.released || {}) },
  });
}

/* THE QUESTION THE UNIQUE INDEX ASKS, and the only one that mattered.
 * checkWant() can exclude whatever it likes; the index looks at the column.
 * So every test that claims a name is free proves it this way. */
function stillAnswersTo(site, host) {
  return String(site.siteUrl) === String(host);
}

(async () => {

section('WHAT COUNTS AS FINISHED WITH THE NAME');

test('ALL THREE TAKEN DOWN MEANS NOTHING IS LEFT UP THERE', () => {
  assert.strictEqual(R.isFreed(row()), true);
});

test('AND ANY ONE OF THEM LEFT BEHIND STILL HOLDS IT', () => {
  /* ⚠ THE RESERVATION IS ABOUT A LEFTOVER, NOT ABOUT THE NAME HAVING BEEN
   * USED. A Pages project still up there will collide with the next
   * deploy on that hostname, so that row must keep its name — which is
   * the case the 17 November rule was written for and the one this fix
   * must not undo. */
  for (const part of ['domain', 'dns', 'project']) {
    const partial = row({ released: { [part]: false } });

    assert.strictEqual(R.isFreed(partial), false, `${part} left behind was treated as finished`);
    assert.strictEqual(R.freeHostname(partial), false, `${part} left behind gave the name back`);
    assert.strictEqual(stillAnswersTo(partial, HOST), true,
      `${part} is still at Cloudflare and the hostname was released anyway`);
  }
});

test('AND A ROW FROM BEFORE THE FIELD EXISTED KEEPS ITS NAME', () => {
  /* The three default to false, and nothing stored can say whether that
   * site's project is still up. Reserved is the safe direction. */
  const old = row({ released: { domain: false, dns: false, project: false } });

  assert.strictEqual(R.freeHostname(old), false);
  assert.strictEqual(stillAnswersTo(old, HOST), true);
});

/* ===================================================================== */

section('HANDING THE NAME BACK');

test('A HOSTNAME QUERY CAN NO LONGER FIND THE ROW', () => {
  /* ⚠ THIS IS THE WHOLE FIX, AND IT IS NOT "releasedUrl IS SET".
   *
   * The index holds whatever is in the column. The only thing that frees
   * the name is the column no longer holding it. */
  const site = row();

  assert.strictEqual(R.freeHostname(site), true);
  assert.strictEqual(stillAnswersTo(site, HOST), false,
    'the row still answers to the hostname it was supposed to give back');
});

test('AND THE HOSTNAME IS KEPT, NOT THROWN AWAY', () => {
  /* A delete that erased the address would make the three result pages
   * print nothing and the delete log unanswerable. */
  const site = row();
  R.freeHostname(site);

  assert.strictEqual(site.releasedUrl, HOST);
  assert.strictEqual(R.hostnameOf(site), HOST);
});

test('AND WHAT IT LEAVES BEHIND IS NOT A HOSTNAME', () => {
  /* ⚠ THE MARKER SHARES A UNIQUELY-INDEXED COLUMN WITH REAL ADDRESSES.
   * If a posted address could ever equal one, this fix would hand somebody
   * a duplicate-key error for a name nobody had taken. A colon cannot
   * appear in a hostname and normalisePrefix cannot produce one. */
  const site = row();
  R.freeHostname(site);

  assert.ok(site.siteUrl.includes(':'), 'the marker could be mistaken for an address');
  assert.ok(!site.siteUrl.includes('.'), 'the marker looks like a hostname');
  assert.strictEqual(R.isMarker(site.siteUrl), true);
});

test('AND TWO ROWS THAT HELD THE SAME ADDRESS DO NOT COLLIDE', () => {
  /* ⚠ ONE SHARED MARKER WOULD MOVE THE BUG, NOT FIX IT. Edwin deletes and
   * rebuilds the same seven names; the second clean delete of a name would
   * hit E11000 on the marker instead of on the hostname — the same failure,
   * one column to the left, and even harder to read. */
  const first = row({ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' });
  const second = row({ _id: 'bbbbbbbbbbbbbbbbbbbbbbbb' });

  R.freeHostname(first);
  R.freeHostname(second);

  assert.notStrictEqual(first.siteUrl, second.siteUrl,
    'two freed rows share one value in a unique column');
});

test('AND DOING IT TWICE CHANGES NOTHING', () => {
  /* The retry button exists on a row whose first delete may have finished
   * cleanly, and the startup sweep runs on every boot. */
  const site = row();

  assert.strictEqual(R.freeHostname(site), true);
  const after = site.siteUrl;

  assert.strictEqual(R.freeHostname(site), false, 'the second pass claimed it did something');
  assert.strictEqual(site.siteUrl, after);
  assert.strictEqual(site.releasedUrl, HOST, 'the marker was written over the hostname');
});

/* ===================================================================== */

section('WHAT THE SCREENS SHOW');

test('A LIVE ROW SHOWS ITS OWN ADDRESS', () => {
  assert.strictEqual(R.hostnameOf({ siteUrl: 'shop.example.com' }), 'shop.example.com');
});

test('AND A FREED ROW SHOWS THE ADDRESS IT USED TO HAVE', () => {
  /* ⚠ THREE PAGES PRINT THIS AFTER THE TEARDOWN HAS RUN: the delete
   * result, the finish-removing result and the republish refusal. Reading
   * siteUrl there would show the customer a database id. */
  const site = row();
  R.freeHostname(site);

  assert.strictEqual(R.hostnameOf(site), HOST);
  assert.ok(!R.hostnameOf(site).includes(':'), 'a screen would print the marker');
});

test('AND NOTHING AT ALL IS AN EMPTY STRING, NOT A CRASH', () => {
  assert.strictEqual(R.hostnameOf(null), '');
  assert.strictEqual(R.hostnameOf({}), '');
});

/* ===================================================================== */

section('THE ROUTE ACTUALLY CALLS IT');

test('THE TEARDOWN FREES THE NAME WHERE IT DECIDES THE NAME IS FREE', () => {
  /* ⚠ A MODULE NOTHING CALLS IS THE BUG THIS CODEBASE HAS SHIPPED BEFORE —
   * cleanupScheduler exported its starter for six months and server.js
   * never required it.
   *
   * Asserted by position, not just presence: freeHostname has to run AFTER
   * the `!site.project` branch that sets all three true, or a site that
   * never deployed is read as unfinished and keeps its name for ever. */
  const src = fs.readFileSync(
    path.join(__dirname, 'routes', 'cloudflareSitesRoute.js'), 'utf8');

  const neverDeployed = src.indexOf('if (!site.project) {');
  const frees = src.indexOf('releasedHostname.freeHostname(site)');
  const returns = src.indexOf('return { released, project };');

  assert.notStrictEqual(neverDeployed, -1, 'the never-deployed branch has moved');
  assert.notStrictEqual(frees, -1, 'removeFromCloudflare never frees the hostname');
  assert.notStrictEqual(returns, -1, 'removeFromCloudflare has been reshaped');

  assert.ok(frees > neverDeployed,
    'the hostname is freed before the never-deployed branch decides it is free');
  assert.ok(frees < returns,
    'the hostname is freed after removeFromCloudflare has returned');
});

test('AND THE SERVER RUNS THE ONE-OFF PASS', () => {
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

  assert.match(src, /releasedHostname\.sweep\(/,
    'nothing clears the hostnames held by sites deleted before this shipped');
});

/* ===================================================================== */

section('THE ONE-OFF PASS');

await atest('IT FREES THE ROWS THAT ARE FINISHED AND SAVES THEM', async () => {
  const rows = [row({ _id: 'a1' }), row({ _id: 'a2', siteUrl: 'other.example.com' })];
  const out = await R.sweep({ find: async () => rows });

  assert.strictEqual(out.freed, 2);
  assert.strictEqual(out.failed, 0);
  assert.strictEqual(rows[0].saved, 1, 'the row was changed and never written');
  assert.strictEqual(stillAnswersTo(rows[0], HOST), false);
});

await atest('AND IT ASKS ONLY FOR ROWS THAT ARE FINISHED AND NOT ALREADY DONE', async () => {
  /* ⚠ A SWEEP WITH A LOOSE QUERY IS A SWEEP THAT FREES A LIVE SITE'S NAME.
   * Checked on the query itself rather than on the rows handed back,
   * because the fake hands back whatever it is told to. */
  let asked = null;

  await R.sweep({ find: async (q) => { asked = q; return []; } });

  assert.strictEqual(asked['released.domain'], true);
  assert.strictEqual(asked['released.dns'], true);
  assert.strictEqual(asked['released.project'], true);

  const not = asked.siteUrl && asked.siteUrl.$not;

  assert.ok(not instanceof RegExp, 'rows already freed are not excluded');
  assert.ok(not.test('released:6afe9db0ecc9acc86cbbfd46'), 'a freed row would be swept again');
  assert.ok(!not.test('shop.released:x.com'),
    'the exclusion is a substring match, so a real hostname could be skipped');
});

await atest('AND A SECOND RUN FINDS NOTHING LEFT TO DO', async () => {
  /* It runs on every boot, and the app has restarted 53 times. */
  const rows = [row()];
  const first = await R.sweep({ find: async () => rows });

  /* The same rows again — a real find() would not return them, but a sweep
   * that depends on the query for its idempotence is one query edit away
   * from writing on every boot. */
  const second = await R.sweep({ find: async () => rows });

  assert.strictEqual(first.freed, 1);
  assert.strictEqual(second.freed, 0, 'the second pass rewrote a row it had already freed');
  assert.strictEqual(rows[0].saved, 1);
});

await atest('AND ONE ROW THAT WILL NOT SAVE DOES NOT STOP THE REST', async () => {
  const bad = row({ _id: 'bad' });
  bad.save = async () => { throw new Error('write conflict'); };

  const good = row({ _id: 'good' });
  const out = await R.sweep({ find: async () => [bad, good] });

  assert.strictEqual(out.freed, 1);
  assert.strictEqual(out.failed, 1);
  assert.strictEqual(good.saved, 1, 'the row after the failure was skipped');
});

await atest('AND A SWEEP THAT CANNOT RUN DOES NOT TAKE THE SERVER DOWN', async () => {
  /* ⚠ IT IS CALLED FROM startWorkers(), ON BOOT. A throw here is an app
   * that will not start because of a maintenance job. */
  const out = await R.sweep({ find: async () => { throw new Error('no mongo'); } });

  assert.strictEqual(out.error, 'no mongo');
  assert.strictEqual(out.freed, 0);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

})();
