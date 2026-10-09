// test-signup-result.js
//
// Does the signup page tell the truth about the verification email?
//
// WHAT THIS IS GUARDING
//
// On 8 October a new user signed up on threecomets.com, was told "We sent you
// a verification link", and never received one. Resend had been refusing every
// message for a fortnight — the domain's DKIM record was gone — and the route
// never looked at what sendEmail returned, so the page said the same thing
// either way. Three failed sends for that one person sat in error.log while
// she was staring at a confirmation screen.
//
// THE RISK THIS FILE EXISTS FOR
//
// sendEmail is deliberately non-throwing: losing a freshly created account
// because a provider was down would be worse than a missing email. That design
// is right, and it is exactly what makes silent failure easy — the caller has
// to CHOOSE to read the result, and nothing breaks if it doesn't. A regression
// here is invisible from the outside: the server stays up, signups keep
// working, and users are quietly told a lie. So the branch is pinned here.
//
//   node test-signup-result.js

const assert = require('assert');
const { signupResultPage } = require('./utils/signupResult');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}
function section(name) { console.log(`\n${name}\n`); }

const SENT_CLAIM = /We sent you a verification link/;

/* ===================================================================== */

section('A send that failed is never reported as a send');

test('a rejected send does not claim the email went out', () => {
  const r = signupResultPage({ ok: false, transport: 'none', error: 'domain is not verified' });
  assert.strictEqual(r.sent, false);
  assert.doesNotMatch(r.html, SENT_CLAIM,
    'the failure page must not contain the sentence shown on success');
});

test('a rejected send offers a way to try again', () => {
  const r = signupResultPage({ ok: false, transport: 'none', error: 'domain is not verified' });
  assert.match(r.html, /\/resend-verification/,
    'a user who got no email needs the resend link on this page, not buried on /login');
});

test('a rejected send still says the account was created', () => {
  /* The account IS real. Telling the user it failed outright would send them
   * round to sign up again and hit "that email already has an account". */
  const r = signupResultPage({ ok: false, error: 'boom' });
  assert.match(r.html, /Account created/);
});

test('a rejected send is not a server error', () => {
  /* 500 would be wrong: nothing the user did failed, and the account exists.
   * 201 says "created", which is the true part. */
  const r = signupResultPage({ ok: false, error: 'boom' });
  assert.strictEqual(r.status, 201);
});

test('a missing result is treated as a failure, not a success', () => {
  /* If a future refactor forgets to pass the result through, the default must
   * fall to the honest branch. An undefined delivery reaching the success page
   * would reproduce the original bug exactly. */
  for (const bad of [undefined, null, {}, { ok: undefined }, { transport: 'resend' }]) {
    const r = signupResultPage(bad);
    assert.strictEqual(r.sent, false, `${JSON.stringify(bad)} must not count as sent`);
    assert.doesNotMatch(r.html, SENT_CLAIM, `${JSON.stringify(bad)} must not claim a send`);
  }
});

test('ok must be true, not merely truthy-looking', () => {
  /* Resend's own response shape has an `error` key on rejection; a caller that
   * passed the raw provider response through would arrive here without `ok`. */
  const r = signupResultPage({ error: { message: 'The domain is not verified' } });
  assert.strictEqual(r.sent, false);
});

/* ===================================================================== */

section('A send that worked says so');

test('a real send claims the email went out', () => {
  const r = signupResultPage({ ok: true, transport: 'resend' });
  assert.strictEqual(r.sent, true);
  assert.strictEqual(r.status, 200);
  assert.match(r.html, SENT_CLAIM);
});

test('a real send does not offer the resend link', () => {
  /* Not a correctness point but a clarity one: pointing at "send it again"
   * under a successful send invites a second email and a second token. */
  const r = signupResultPage({ ok: true, transport: 'resend' });
  assert.doesNotMatch(r.html, /\/resend-verification/);
});

/* ===================================================================== */

section('The development hint appears only in development');

test('production pages carry no "Dev only" note', () => {
  /* The old page shipped "Dev only: if you're on localhost, check the server
   * console for the verification URL" to every visitor on the live site. The
   * user who reported the missing email read that line. */
  const r = signupResultPage({ ok: true, transport: 'resend' });
  assert.doesNotMatch(r.html, /Dev only/i);
  assert.doesNotMatch(r.html, /localhost/i);
});

test('the console transport does say the link was printed, not sent', () => {
  /* In development sendEmail returns ok:true without sending anything. That
   * is a success for the route's purposes but it is NOT an email, and a
   * developer staring at an empty inbox needs to know which happened. */
  const r = signupResultPage({ ok: true, transport: 'console' });
  assert.strictEqual(r.sent, true);
  assert.match(r.html, /Dev only/);
  assert.match(r.html, /console/i);
});

test('the hint is keyed on the transport, not on NODE_ENV', () => {
  /* EMAIL_TRANSPORT=resend forces a real send in development. That must show
   * the ordinary page, because an email really was sent. */
  const r = signupResultPage({ ok: true, transport: 'resend' });
  assert.doesNotMatch(r.html, /Dev only/);
});

/* ===================================================================== */

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
