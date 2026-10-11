// test-ping-detail.js
//
// When a customer's site refuses a ping, record what it SAID.
//
// WHAT THIS IS GUARDING
//
// 10 October. roofingamerica.xyz answered every ping with HTTP 500 for most of
// a day. This is the whole of what the log recorded:
//
//   {"event":"external.wordpress.pingFailed","reason":"HTTP 500", ...}
//
// That is almost no information. It says the site answered and the answer was
// bad. Meanwhile the plugin's own log showed nothing wrong at all — pressing
// "Check now" in wp-admin collected every post perfectly, every time — so the
// fault lived somewhere only the ping path reaches, and neither side would say
// where. Six rounds of screenshots failed to narrow it down. The reason was in
// the reply body on every one of those requests, and the scheduler read the
// status line and threw the rest away.
//
// THE PROPERTY
//
// A refusing site's own words reach the log. That is all it does. It does not
// make a ping succeed and it diagnoses nothing by itself — it is the
// difference between a fault that can be read and one that has to be guessed.
//
// THE OTHER HALF IS THAT THE SITE IS NOT TRUSTED. This string is written into
// our log and shown on our own screens. A site that replies with two megabytes
// of HTML, a script tag, or a stream of control characters must not be able to
// do anything with that beyond occupying 300 harmless characters.
//
// WHY THIS TESTS THE HELPER AND NOT pingSite()
//
// pingSite() resolves the hostname through the SSRF guard before it ever looks
// at a reply, so driving it with a stubbed fetch still needs working DNS — it
// cannot run in a sandbox. A test that silently skips is not a test. So the
// sanitising, which is where the rules are, is checked directly, and the last
// section checks separately that the failure branch still calls it.
//
//   node test-ping-detail.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;

async function test(name, fn) {
  try { await fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}
function section(name) { console.log(`\n${name}\n`); }

const { whatItSaid } = require('./utils/blogScheduler');

/** A reply like the one fetch hands back, with only what is read. */
function reply(body) {
  return { text: async () => body };
}

(async () => {

  section('A refusal carries the site\'s own words');

  await test('a WordPress REST error survives', async () => {
    const out = await whatItSaid(reply(
      '{"code":"ie_bad_signature","message":"Signature did not match."}'
    ));

    assert.match(out, /ie_bad_signature/,
      'the site said why and the reason does not carry it — this is the whole bug');
    assert.match(out, /Signature did not match/);
  });

  await test('a PHP fatal survives', async () => {
    const out = await whatItSaid(reply(
      'Fatal error: Allowed memory size of 134217728 bytes exhausted in /wp-includes/post.php on line 4210'
    ));

    assert.match(out, /Allowed memory size/,
      'a fatal error is still invisible, which is the case this was written for');
    assert.match(out, /post\.php on line 4210/, 'the location was dropped');
  });

  await test('an empty body says so rather than trailing a colon', async () => {
    assert.match(await whatItSaid(reply('')), /empty response/,
      '"HTTP 500: " with nothing after it reads like a truncated log line');
  });

  await test('a body of nothing but whitespace counts as empty', async () => {
    assert.match(await whatItSaid(reply('\n\n   \t  \r\n')), /empty response/);
  });

  await test('a body that cannot be read does not lose the failure', async () => {
    /* The connection drops mid-read. The ping still failed, and that fact must
     * survive an unreadable body: a recorded failure turning into an
     * unrecorded one is worse than the missing detail. */
    const out = await whatItSaid({
      text: async () => { throw new Error('socket hang up'); },
    });

    assert.match(out, /unreadable/, 'a throw escaped and took the whole ping failure with it');
    assert.match(out, /socket hang up/, 'the read error itself is worth keeping');
  });

  /* ===================================================================== */

  section('The site is not trusted');

  await test('a very long body is cut to 300 characters', async () => {
    const out = await whatItSaid(reply('x'.repeat(50000)));

    assert.ok(out.length <= 301,
      `one broken site could fill the log — the result was ${out.length} characters`);
    assert.match(out, /…$/, 'nothing marks the message as cut short');
  });

  await test('a body just under the limit is not marked as cut', async () => {
    const out = await whatItSaid(reply('y'.repeat(300)));

    assert.strictEqual(out.length, 300);
    assert.ok(!out.endsWith('…'), 'a complete message is being reported as truncated');
  });

  await test('tags are stripped, so nothing renders where we print it', async () => {
    const out = await whatItSaid(reply(
      '<html><body><script>alert(1)</script><b>Fatal error</b>: oh dear</body></html>'
    ));

    assert.ok(!out.includes('<'),
      'markup survives into a string printed on an admin screen');
    assert.match(out, /Fatal error/, 'the useful text was thrown away with the tags');
  });

  await test('control characters and newlines collapse to single spaces', async () => {
    /* A multi-line PHP stack trace written raw into a JSON log line is a
     * parsing problem for whatever reads the log next. */
    const out = await whatItSaid(reply(
      'Fatal error:\n\n\tstack frame one\r\n\tstack frame two\u0000'
    ));

    assert.ok(!/[\n\r\t\u0000]/.test(out), 'the result is no longer one line');
    assert.strictEqual(out, 'Fatal error: stack frame one stack frame two');
  });

  await test('runs of ordinary spaces collapse too', async () => {
    /* A SEPARATE TEST BECAUSE THE ONE ABOVE CANNOT FAIL FOR THIS REASON.
     *
     * Removing the \s+ collapse left every test green: newlines and tabs are
     * control characters, so the strip before it had already turned each run
     * into one space. Plain spaces are not control characters and nothing else
     * touches them — stripping tags from indented HTML leaves long gaps, and
     * 300 characters of a truncated message is a budget worth not spending on
     * whitespace. Found by mutation, which is the only way it could be. */
    const out = await whatItSaid(reply('Fatal     error:        oh      dear'));

    assert.strictEqual(out, 'Fatal error: oh dear');
  });

  await test('a body that is only markup does not become a bare colon', async () => {
    /* Stripping can empty a non-empty body. "HTTP 500: " with nothing after it
     * is exactly the uninformative line this file exists to abolish. */
    const out = await whatItSaid(reply('<div><span></span></div>'));

    assert.match(out, /empty response/);
  });

  /* ===================================================================== */

  section('The failure branch still calls it');

  await test('a refused ping reports the status AND the body', async () => {
    /* Read from source, because pingSite() cannot be driven without DNS.
     * Comments are stripped first: the notes in that file quote both "HTTP
     * 500" and the field names, and a raw search would find the explanation of
     * the bug and call it the fix. */
    const src = fs.readFileSync(path.join(__dirname, 'utils', 'blogScheduler.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^[ \t]*\/\/.*$/gm, ' ');

    const at = src.indexOf('if (!response.ok)');
    assert.ok(at > -1, 'the failure branch is gone or renamed');

    const branch = src.slice(at, at + 300);

    assert.match(branch, /whatItSaid\(/,
      'a refusal is recorded as a bare status again — the body is being discarded');
    assert.match(branch, /HTTP \$\{response\.status\}/,
      'the status code itself was dropped');
  });

  await test('the stored error is wide enough to hold the message', async () => {
    /* whatItSaid bounds the body at 300, and the reason adds "HTTP 500: " in
     * front. Storing 300 of the pair would cut the end off every message that
     * mattered — the last thing a stack trace says is usually the point. */
    const src = fs.readFileSync(path.join(__dirname, 'utils', 'blogScheduler.js'), 'utf8');

    /* The one that STORES a reason, not the one that clears it. The success
     * path sets lastPingError to '' and appears first in the file, so a search
     * for the bare field name finds the clear and reports the store missing. */
    const at = src.indexOf('lastPingError: String(');
    assert.ok(at > -1, 'the site no longer records why it was refused');

    const call = src.slice(at, at + 120);
    const limit = /slice\(0,\s*(\d+)\)/.exec(call);

    assert.ok(limit, 'the stored error is no longer bounded at all');
    assert.ok(Number(limit[1]) > 300,
      `lastPingError is cut at ${limit[1]}, which truncates a 300-character body plus its prefix`);
  });

  await test('the happy path does not read the body', async () => {
    /* Reading it would spend time and memory on every ping to every healthy
     * site, to learn nothing. */
    const src = fs.readFileSync(path.join(__dirname, 'utils', 'blogScheduler.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^[ \t]*\/\/.*$/gm, ' ');

    const at = src.indexOf('return { ok: true }');
    assert.ok(at > -1, 'the success path is gone');

    const before = src.slice(src.indexOf('if (!response.ok)'), at);
    const calls = (before.match(/whatItSaid\(/g) || []).length;

    assert.strictEqual(calls, 1,
      'whatItSaid is called more than once before success — the body is being read on healthy pings');
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
