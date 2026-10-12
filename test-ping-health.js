// test-ping-health.js
//
// Turning a stored failure into something a person can act on.
//
// WHAT THIS IS GUARDING
//
// On 12 October Edwin's campaign card sat at "0 of 22" for a whole batch.
// Finding out why took an SSH session, a grep over the production log, a dig
// and a curl — and the answer was in site.lastPingError all along, in full,
// because whatItSaid() had captured the refusing site's own words weeks
// earlier. Nothing displayed it anywhere.
//
// He asked the question that makes this a product problem rather than a bad
// morning: "if a user experiences the same problem and reaches out to me, how
// am I going to be able to diagnose it?"
//
// So pingHealth() reads the stored reason and answers in a sentence, with the
// specific thing to ask the host for.
//
// WHAT IS WORTH ASSERTING, which is not "it returns a string"
//
//   - the three causes this project has actually met are each recognised, and
//     are told APART — they are all "the site refused us" and the fixes are
//     completely different
//   - a site nobody has tried yet does not read as healthy
//   - a site nobody has tried yet does not read as broken either
//   - a revoked licence is not reported as a fault
//   - the site's own words survive to the screen, because the phrase that
//     solved this was thirteen characters into a 400-character body
//   - pingFailures is NOT consulted, because it lies (see below)
//
//   node test-ping-health.js

const assert = require('assert');
const {
  pingHealth, readable, healthBadge, healthDetail, DETAIL_CHARS,
} = require('./utils/blog/pingHealth');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}
function section(name) { console.log(`\n${name}\n`); }

/** The exact body Edwin's host returned, trimmed as the scheduler stores it. */
const CLOUDFLARE =
  'HTTP 403: Just a moment... *{box-sizing:border-box;margin:0;padding:0}html{line-height:1.15;'
  + '-webkit-text-size-adjust:100%;color:#313131;font-family:system-ui,-apple-system,'
  + 'BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif…';

/** The one from the roofing site, the week before. */
const MODSEC = 'HTTP 406: Not Acceptable! An appropriate representation of the requested resource could not be found.';

/** And the subfolder install, which looks like a key problem and is not. */
const SIGNATURE = 'HTTP 401: {"code":"ie_bad_signature","message":"Signature did not match.","data":{"status":401}}';

section('The three we have actually met');

test('a bot challenge is recognised, and named as one', function () {
  const h = pingHealth({ status: 'active', lastPingError: CLOUDFLARE });

  assert.strictEqual(h.state, 'challenged', `read as ${h.state}`);
  assert.strictEqual(h.ok, false);
  assert.match(h.action, /allow our server through|exempting/i,
    'the action does not say what to ask the host for');
});

test('AND IT IS NOT CONFUSED WITH A PLAIN FIREWALL', function () {
  /* Both are a refusal with a 4xx, and the fixes are different: one is a bot
   * challenge the host may not even expose a switch for, the other is a
   * mod_security rule they can whitelist by path. Telling somebody the wrong
   * one costs a support round trip and their patience. */
  const challenge = pingHealth({ status: 'active', lastPingError: CLOUDFLARE });
  const firewall  = pingHealth({ status: 'active', lastPingError: MODSEC });

  assert.notStrictEqual(challenge.state, firewall.state,
    'a Cloudflare challenge and a mod_security refusal read identically');
  assert.strictEqual(firewall.state, 'blocked', `read as ${firewall.state}`);
});

test('a bad signature is NOT reported as a firewall', function () {
  /* This one cost a day. The reply says the signature did not match, which
   * reads as a broken licence key — and the real cause was that the site
   * lives in a subfolder and we were knocking at the root of a shared host,
   * where some OTHER WordPress answered with a different secret. The action
   * has to raise that, or the next person replaces a key that was fine. */
  const h = pingHealth({ status: 'active', lastPingError: SIGNATURE });

  assert.strictEqual(h.state, 'signature', `read as ${h.state}`);
  assert.match(h.action, /subfolder/i,
    'the action does not mention the subfolder case, which is what it actually was');
});

test('a 500 points at the two fixes that have worked', function () {
  const h = pingHealth({ status: 'active', lastPingError: 'HTTP 500: Internal Server Error' });

  assert.strictEqual(h.state, 'erroring', `read as ${h.state}`);
  assert.match(h.action, /permalink/i,
    'does not suggest the Permalinks save, which is what fixed it last time');
});

section('Not everything is a fault');

test('a site nobody has knocked on yet is not called broken', function () {
  const h = pingHealth({ status: 'active' });

  assert.strictEqual(h.state, 'quiet', `read as ${h.state}`);
  assert.strictEqual(h.ok, true);
});

test('AND IT IS NOT CALLED HEALTHY EITHER', function () {
  /* lastPingError is empty on a site contacted successfully a minute ago AND
   * on one we have never contacted at all. Reporting the second as "reaching
   * it" is a reassurance that gets found out the first time it matters. */
  const fresh   = pingHealth({ status: 'active' });
  const working = pingHealth({ status: 'active', lastPingAt: new Date(), lastPingOkAt: new Date() });

  assert.notStrictEqual(fresh.state, working.state,
    'a site we have never reached reads the same as one we just reached');
  assert.strictEqual(working.state, 'ok');
});

test('a revoked licence is not a problem to chase', function () {
  /* Its last error is from before somebody turned it off deliberately.
   * Flagging it would send them to their host about a site they disconnected
   * themselves. */
  const h = pingHealth({ status: 'revoked', lastPingError: CLOUDFLARE });

  assert.strictEqual(h.state, 'revoked', `read as ${h.state}`);
  assert.strictEqual(h.detail, '', 'a revoked site still shows an error to chase');
});

section('What reaches the screen');

test("THE SITE'S OWN WORDS SURVIVE", function () {
  /* "Just a moment" is the entire diagnosis and it sits thirteen characters
   * into the body. A summary that kept only "HTTP 403" would have been the
   * version we had before, which is what cost the morning. */
  const h = pingHealth({ status: 'active', lastPingError: CLOUDFLARE });

  assert.ok(h.detail.includes('Just a moment'),
    'the phrase that identified the cause was dropped on the way to the screen');
});

test('but they are bounded', function () {
  const h = pingHealth({ status: 'active', lastPingError: 'HTTP 403: ' + 'x'.repeat(5000) });

  assert.ok(h.detail.length <= DETAIL_CHARS + 1,
    `a table cell was handed ${h.detail.length} characters`);
});

test('and whitespace is flattened', function () {
  assert.strictEqual(readable('  HTTP 500:\n\n   broken   '), 'HTTP 500: broken');
});

section('The field that lies');

test('pingFailures IS NOT CONSULTED', function () {
  /* requireSite.js resets pingFailures to 0 on every authenticated inbound
   * request — correctly, because a site talking to us is reachable. The
   * consequence is that on any site in use the counter is a sawtooth: Edwin's
   * log shows it climbing 1, 2, 3 and dropping back to 1 all morning, because
   * every "Check now" press reset it. It never approached the give-up
   * threshold, so the server never gave up and never said anything.
   *
   * A health screen keyed on that counter would have called a blocked site
   * healthy — which is worse than no screen, because somebody would trust it. */
  const lying = pingHealth({ status: 'active', pingFailures: 0, lastPingError: CLOUDFLARE });

  assert.strictEqual(lying.ok, false,
    'a zeroed failure counter was enough to call a blocked site healthy');
  assert.strictEqual(lying.state, 'challenged');
});

test('and a high count on a site we are reaching is not a fault either', function () {
  const h = pingHealth({ status: 'active', pingFailures: 99, lastPingAt: new Date(), lastPingOkAt: new Date() });

  assert.strictEqual(h.ok, true, 'a stale counter overrode a successful ping');
});

section('Timestamps');

test('the last SUCCESSFUL ping is carried, not the last attempt', function () {
  /* lastPingAt is written before the request goes out, so it is a scheduling
   * stamp, not an outcome. A screen printing it as "last contacted" shows a
   * timestamp from a minute ago for a site that has refused every ping for a
   * week — which is exactly the reassuring lie this page exists to stop. */
  const tried = new Date('2026-10-12T07:00:00Z');
  const got   = new Date('2026-10-05T07:00:00Z');

  const h = pingHealth({ status: 'active', lastPingError: CLOUDFLARE, lastPingAt: tried, lastPingOkAt: got });

  assert.strictEqual(+h.lastTried, +tried);
  assert.strictEqual(+h.lastOk, +got);
});

test('a site never reached carries no success stamp to print', function () {
  const h = pingHealth({ status: 'active', lastPingError: MODSEC, lastPingAt: new Date() });

  assert.strictEqual(h.lastOk, null, 'something will print "last got through null"');
});

section('An unknown reason');

test('is admitted, not guessed at', function () {
  const h = pingHealth({ status: 'active', lastPingError: 'ECONNRESET' });

  assert.strictEqual(h.state, 'unreachable', `read as ${h.state}`);
  assert.strictEqual(h.ok, false);
  assert.ok(h.detail.includes('ECONNRESET'), 'the raw reason was dropped');
});

section('What the page actually prints');

test('a blocked site gets a row somebody can forward to a host', function () {
  const h = pingHealth({
    status: 'active',
    lastPingError: CLOUDFLARE,
    lastPingAt: new Date('2026-10-12T07:06:56Z'),
  });

  const row = healthDetail(h, 6);

  assert.ok(row.includes('Just a moment'), 'the reply body never reaches the page');
  assert.ok(row.includes('wp-json'), 'the page does not say what to ask the host to allow');
  assert.ok(/Last tried/.test(row), 'no timestamp — the host cannot find it in their log');
  assert.ok(/never got through/.test(row),
    'a site we have never reached does not say so');
});

test('AND A HEALTHY SITE GETS NO ROW AT ALL', function () {
  /* A detail row that always renders is a page of red boxes, and a page of
   * red boxes is a page nobody reads. */
  const ok = pingHealth({ status: 'active', lastPingAt: new Date(), lastPingOkAt: new Date() });

  assert.strictEqual(healthDetail(ok, 6), '', 'a working site is explaining itself');
});

test('a revoked licence gets no row either', function () {
  const h = pingHealth({ status: 'revoked', lastPingError: CLOUDFLARE });

  assert.strictEqual(healthDetail(h, 6), '',
    'a licence somebody turned off is being reported as a fault to chase');
});

test("THE SITE'S WORDS ARE ESCAPED BEFORE THEY ARE PRINTED", function () {
  /* The reason is whatever a stranger's server sent back. whatItSaid() strips
   * tags on the way in; this is the second of the two guards, and the one
   * that has to hold if the first is ever relaxed. The page shows this inside
   * a <code> block on an authenticated admin screen — the account's own
   * screen, so the damage would be self-inflicted, which is not a reason to
   * leave it open. */
  const h = pingHealth({
    status: 'active',
    lastPingError: 'HTTP 403: <script>alert(1)</script>',
  });

  const row = healthDetail(h, 6);

  assert.ok(!row.includes('<script>'), 'a site can put a script tag on the admin page');
  assert.ok(row.includes('&lt;script&gt;'), 'the reason was dropped rather than escaped');
});

test('the badge is not red for a site that has simply never been knocked on', function () {
  const quiet = healthBadge(pingHealth({ status: 'active' }));
  const bad   = healthBadge(pingHealth({ status: 'active', lastPingError: MODSEC }));

  assert.ok(!quiet.includes('bg-danger'),
    'a brand new site is being flagged as broken');
  assert.ok(bad.includes('bg-danger'), 'a blocked site is not flagged at all');
});

test('the detail row spans the table it is in', function () {
  /* Hard-coding the colspan is how a column added later leaves a ragged row
   * halfway across the page. It is passed in, and this is the only thing that
   * would notice it being ignored. */
  const h = pingHealth({ status: 'active', lastPingError: MODSEC });

  assert.ok(healthDetail(h, 6).includes('colspan="6"'));
  assert.ok(healthDetail(h, 9).includes('colspan="9"'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
