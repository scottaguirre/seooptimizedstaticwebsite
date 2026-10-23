// test-cloudflare-accounts.js
//
// Which Cloudflare account a blog belongs to, and how its token is reached.
//
// THE ONE RULE THIS FILE EXISTS FOR
//
//   A BLOG THAT NAMES AN ACCOUNT MUST NEVER FALL BACK TO THE ENVIRONMENT.
//
// Everything in deploy.js and redirects.js falls back when it is handed no
// credentials, and that is correct for them — every blog that exists today
// has no account of its own. But the fallback is a DEFAULT, not a recovery.
//
// If a blog says "I belong to account 7" and account 7 cannot be read —
// deleted, disabled, a token that will not decrypt — the honest answer is to
// stop. The convenient answer is to fall back, and the convenient answer
// deploys a customer's blog into OUR Cloudflare account, creates a project
// there, attaches their domain to it, and reports success. Nothing in the
// result would say anything had gone wrong.
//
//   node test-cloudflare-accounts.js

const assert = require('assert');
const crypto = require('crypto');

process.env.CF_TOKEN_KEY = crypto.randomBytes(32).toString('hex');

const { seal } = require('./utils/blog/cloudflare/secretBox');

const CloudflareAccount = require('./models/CloudflareAccount');
const Domain = require('./models/Domain');
const {
  credsFor, accountCapacity, verifyAccount, recountAccount,
} = require('./utils/blog/cloudflare/accounts');

let passed = 0, failed = 0;

async function test(name, fn) {
  try { await fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

const ACCOUNT_ID = 'cccc3333dddd4444eeee5555ffff6666';
const TOKEN = 'cf-live-token-W3jK9qLmNpR2sT5vX8zB1dF4gH7';

/** Stub the two models with a fixed set of rows. */
function install({ accounts = [], domains = [] } = {}) {
  CloudflareAccount.findById = async (id) =>
    accounts.find(a => String(a._id) === String(id)) || null;

  CloudflareAccount.find = async () => accounts;
  CloudflareAccount.countDocuments = async () => accounts.length;

  Domain.findOne = async (where) =>
    domains.find(d => !where.domain || d.domain === where.domain) || null;
}

function account(over = {}) {
  return Object.assign({
    _id: 'acct-3',
    label: 'Client 3 — Acme HVAC',
    accountId: ACCOUNT_ID,
    token: seal(TOKEN),
    enabled: true,
  }, over);
}

console.log('\nResolving a blog to its account\n');

(async () => {

await test('A BLOG WITH AN ACCOUNT GETS THAT ACCOUNT\'S CREDENTIALS', async () => {
  install({ accounts: [account()] });

  const creds = await credsFor({ _id: 'blog-1', cloudflareAccount: 'acct-3' });

  assert.strictEqual(creds.account, ACCOUNT_ID);
  assert.strictEqual(creds.token, TOKEN, 'the token was not decrypted');
});

await test('A BLOG WITH NO ACCOUNT GETS NOTHING, AND THAT MEANS THE ENVIRONMENT', async () => {
  /* Every blog that exists today. Returning undefined is how the whole
   * fallback chain in deploy.js is reached — see the `given` checks in
   * cfApi() and childEnv(). */
  install({ accounts: [account()] });

  assert.strictEqual(await credsFor({ _id: 'blog-1' }), undefined);
  assert.strictEqual(await credsFor({ _id: 'blog-1', cloudflareAccount: null }), undefined);
  assert.strictEqual(await credsFor(null), undefined);
});

console.log('\nWhen the account cannot be used\n');

await test('AN ACCOUNT THAT IS GONE THROWS, IT DOES NOT FALL BACK', async () => {
  /* THE RULE THIS FILE EXISTS FOR.
   *
   * Falling back here would deploy a customer's blog into OUR Cloudflare
   * account — create the project, attach their domain to it, and report
   * success. There is nothing in the result that would say otherwise, and
   * the first sign would be a customer asking why their blog is not on
   * their domain. */
  install({ accounts: [] });

  await assert.rejects(
    () => credsFor({ _id: 'blog-1', cloudflareAccount: 'acct-3' }),
    /Cloudflare account/i);
});

await test('AND SO DOES ONE THAT HAS BEEN DISABLED', async () => {
  /* Disabling an account is how somebody takes it out of service — a
   * client leaving, a token being rotated, an account at its project
   * limit. If disabling it quietly moved that client's blogs onto the
   * server account, the control would do the opposite of its job. */
  install({ accounts: [account({ enabled: false })] });

  await assert.rejects(
    () => credsFor({ _id: 'blog-1', cloudflareAccount: 'acct-3' }),
    /disabled/i);
});

await test('AND SO DOES A TOKEN THAT WILL NOT DECRYPT', async () => {
  /* CF_TOKEN_KEY rotated without re-entering the tokens, or a row edited
   * by hand. The deploy must stop and say so rather than quietly becoming
   * a deploy into a different account. */
  install({ accounts: [account({ token: 'not-sealed-at-all' })] });

  await assert.rejects(
    () => credsFor({ _id: 'blog-1', cloudflareAccount: 'acct-3' }),
    /could not be read/i);
});

await test('AND SO DOES AN ACCOUNT ROW WITH NO TOKEN IN IT', async () => {
  /* Half a row — saved through a script, or an admin form that validated
   * the account id and not the token. cfApi() and childEnv() already
   * refuse half a credential; this stops it one step earlier, where the
   * error can name the account.
   *
   * THE MESSAGE IS PINNED, NOT JUST THE REJECTION — and mutation is why.
   * Removing this check SURVIVED a test that only asked for /token/i:
   * open('') throws its own message, which also contains the word "token".
   * Both paths rejected, so nothing could tell them apart.
   *
   * They need different actions. "Has no API token stored" means fill in
   * that one row. "Could not be read" means CF_TOKEN_KEY changed and every
   * account needs re-entering. */
  install({ accounts: [account({ token: '' })] });

  await assert.rejects(
    () => credsFor({ _id: 'blog-1', cloudflareAccount: 'acct-3' }),
    /has no API token stored/i);
});

await test('AND SO DOES ONE WITH NO ACCOUNT ID', async () => {
  /* The other half of the same half-row. This one is worse than it looks:
   * without the check, credsFor returns { token, account: undefined } —
   * which cfApi() then refuses as half a credential, with a message that
   * names neither the account nor what is missing from it. The failure
   * surfaces three layers from the row that caused it. */
  install({ accounts: [account({ accountId: '' })] });

  await assert.rejects(
    () => credsFor({ _id: 'blog-1', cloudflareAccount: 'acct-3' }),
    /has no account id stored/i);
});

await test('NO ERROR FROM ANY OF THIS CARRIES THE TOKEN', async () => {
  /* These throw inside the deploy path and are logged. */
  install({ accounts: [account({ enabled: false })] });

  try {
    await credsFor({ _id: 'blog-1', cloudflareAccount: 'acct-3' });
    assert.fail('it did not throw');
  } catch (err) {
    const said = `${err.message}\n${err.stack || ''}`;
    assert.ok(!said.includes(TOKEN), 'the token reached the error');
    assert.ok(!said.includes(process.env.CF_TOKEN_KEY), 'the key reached the error');
  }
});

await test('THE ERROR NAMES THE ACCOUNT, SO IT CAN BE FOUND', async () => {
  /* "No Cloudflare credentials" across ten accounts is a search. The label
   * is what somebody reads on the admin screen. */
  install({ accounts: [account({ enabled: false })] });

  await assert.rejects(
    () => credsFor({ _id: 'blog-1', cloudflareAccount: 'acct-3' }),
    (err) => err.message.includes('Client 3') || err.message.includes('acct-3'));
});

console.log('\nThe models\n');

await test('AN ACCOUNT ID IS STORED AS CLOUDFLARE WRITES IT', async () => {
  const schema = CloudflareAccount.schema.obj;

  assert.ok(schema.accountId, 'there is no accountId field');
  assert.ok(schema.token, 'there is nowhere to put the token');
  assert.ok(schema.label, 'an account cannot be told apart from the others');
  assert.ok('enabled' in schema, 'an account cannot be taken out of service');
});

await test('A DOMAIN BELONGS TO EXACTLY ONE ACCOUNT', async () => {
  /* THE RULE THE WHOLE POOL DESIGN RESTS ON. The Pages project has to sit
   * on the same account as the zone, or Cloudflare will not write the DNS
   * record itself and the customer is back to pasting a CNAME. A domain
   * that could name two accounts is a domain whose blogs disagree. */
  const schema = Domain.schema.obj;

  assert.ok(schema.domain, 'there is no domain field');
  assert.ok(schema.account, 'a domain does not say which account it is on');
});

await test('AND A DOMAIN IS UNIQUE ACROSS THE WHOLE POOL', async () => {
  /* Two rows for one domain, pointing at different accounts, is the
   * ambiguity above made permanent — and whichever row the lookup happened
   * to return would decide where a blog was created. */
  const field = Domain.schema.obj.domain;

  assert.ok(field.unique || (field.index && field.index.unique),
    'two rows could claim the same domain');
});

console.log('\nCapacity\n');

await test('AN ACCOUNT REPORTS HOW MUCH ROOM IT HAS LEFT', async () => {
  /* Cloudflare caps Pages projects at 100 per account and says the limit
   * is not routinely raised. One blog is one project. An account filling
   * up has to be visible BEFORE it refuses, because the refusal lands on a
   * customer pressing Create. */
  const room = accountCapacity({ projects: 86 });

  assert.strictEqual(room.limit, 100);
  assert.strictEqual(room.used, 86);
  assert.strictEqual(room.left, 14);
  assert.strictEqual(room.nearlyFull, true);
});

await test('AND AN EMPTY ONE IS NOT REPORTED AS NEARLY FULL', async () => {
  const room = accountCapacity({ projects: 3 });

  assert.strictEqual(room.left, 97);
  assert.strictEqual(room.nearlyFull, false);
});

await test('A FULL ACCOUNT IS NOT REPORTED AS HAVING NEGATIVE ROOM', async () => {
  /* The count comes from Cloudflare, and an account that was filled by
   * something other than this app can be at or over the limit. "-3 left"
   * on a screen is worse than "0". */
  assert.strictEqual(accountCapacity({ projects: 103 }).left, 0);
  assert.strictEqual(accountCapacity({ projects: 100 }).left, 0);
  assert.strictEqual(accountCapacity({ projects: 100 }).nearlyFull, true);
});

console.log('\nVerifying credentials before they are stored\n');

/* WHY VERIFICATION EXISTS AT ALL
 *
 * The admin form accepted anything. Edwin opened it and his browser, reading
 * "text field followed by password field" as a login, autofilled his EMAIL
 * ADDRESS into the account ID and a SAVED PASSWORD into the token. The
 * handler would have sealed that password, stored it, and said "added".
 *
 * Nothing would have looked wrong until a blog was published onto that
 * account weeks later. */

/** A cfApi stub that records what it was called with. */
function api(answer) {
  const calls = [];
  const fn = async (path, opts) => { calls.push({ path, opts }); return answer; };
  fn.calls = calls;
  return fn;
}

await test('GOOD CREDENTIALS COME BACK OK, WITH THE PROJECT COUNT', async () => {
  const fn = api({ ok: true, result: [{}, {}], info: { total_count: 14 } });

  const out = await verifyAccount({ accountId: ACCOUNT_ID, token: TOKEN }, { api: fn });

  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.projects, 14);
});

await test('THE COUNT IS total_count, NOT THE LENGTH OF ONE PAGE', async () => {
  /* Cloudflare's list endpoints page. An account holding 140 projects
   * answers with 25 of them and total_count: 140.
   *
   * Taking result.length would put "25 / 100" on the admin screen — which
   * reads as 75 free slots that do not exist, right up until a customer
   * presses Create and Cloudflare refuses. An understated count is worse
   * than no count, because it looks like an answer. */
  const fn = api({
    ok: true,
    result: new Array(25).fill({}),
    info: { total_count: 140 },
  });

  const out = await verifyAccount({ accountId: ACCOUNT_ID, token: TOKEN }, { api: fn });

  assert.strictEqual(out.projects, 140, 'it counted the page, not the collection');
});

await test('AND FALLS BACK TO THE PAGE WHEN CLOUDFLARE SENDS NO total_count', async () => {
  const fn = api({ ok: true, result: [{}, {}, {}] });

  assert.strictEqual((await verifyAccount({ accountId: ACCOUNT_ID, token: TOKEN }, { api: fn })).projects, 3);
});

await test('AN EMPTY ACCOUNT IS ZERO, NOT A FAILURE', async () => {
  /* Nine of the ten accounts will be brand new. If "no projects" read as
   * "could not verify", the pool could not be set up at all. */
  const fn = api({ ok: true, result: [], info: { total_count: 0 } });

  const out = await verifyAccount({ accountId: ACCOUNT_ID, token: TOKEN }, { api: fn });

  assert.strictEqual(out.ok, true, 'an empty account was refused');
  assert.strictEqual(out.projects, 0);
});

await test('THE PAIR IS SENT TOGETHER, AND AT THE ACCOUNT BEING CHECKED', async () => {
  /* THE ASSERTION THIS TEST EXISTS FOR, and the reason it looks at the
   * options bag rather than the return value.
   *
   * Forget to pass `creds` and cfApi falls back to the environment — so the
   * request goes out with the SERVER'S token, succeeds against the server's
   * own account, and reports that whatever the admin typed is valid. Every
   * account anybody added would verify. The return value is identical
   * either way; only what went over the wire tells them apart.
   *
   * This is the same shape as the survivor found in redirects.js, where the
   * path was right and the token was the environment's. */
  const fn = api({ ok: true, result: [] });

  await verifyAccount({ accountId: ACCOUNT_ID, token: TOKEN }, { api: fn });

  assert.strictEqual(fn.calls.length, 1, 'Cloudflare was not asked at all');

  const { path, opts } = fn.calls[0];

  assert.ok(path.includes(ACCOUNT_ID), `it asked about the wrong account: ${path}`);
  assert.ok(path.includes('/pages/projects'), `it asked the wrong question: ${path}`);
  assert.ok(opts && opts.creds, 'no credentials were passed — this checked the SERVER account');
  assert.strictEqual(opts.creds.account, ACCOUNT_ID);
  assert.strictEqual(opts.creds.token, TOKEN);
});

await test('A REFUSAL FROM CLOUDFLARE IS NOT OK', async () => {
  const fn = api({ ok: false, error: 'Invalid account identifier [code: 7003]' });

  const out = await verifyAccount({ accountId: 'scott@example.com', token: TOKEN }, { api: fn });

  assert.strictEqual(out.ok, false);
});

await test('AND IT CARRIES CLOUDFLARE\'S OWN REASON', async () => {
  /* "Invalid account identifier", "Invalid API Token" and "Unauthorized"
   * send somebody to three different places. A message of our own would
   * flatten all three into "that did not work", which is the message that
   * makes people retype a correct token. */
  const fn = api({ ok: false, error: 'Invalid API Token [code: 1000]' });

  const out = await verifyAccount({ accountId: ACCOUNT_ID, token: 'nope' }, { api: fn });

  assert.ok(/Invalid API Token/.test(out.error), `the reason was lost: ${out.error}`);
});

await test('A HALF-FILLED PAIR NEVER REACHES CLOUDFLARE', async () => {
  /* Not politeness — safety. cfApi treats a missing half as "use the
   * environment", so verifying { accountId, token: '' } would test the
   * SERVER'S credentials and pass. */
  for (const creds of [
    { accountId: ACCOUNT_ID, token: '' },
    { accountId: '', token: TOKEN },
    { accountId: '   ', token: TOKEN },
    {},
    undefined,
  ]) {
    const fn = api({ ok: true, result: [] });
    const out = await verifyAccount(creds, { api: fn });

    assert.strictEqual(out.ok, false, `it accepted ${JSON.stringify(creds)}`);
    assert.strictEqual(fn.calls.length, 0, `it called Cloudflare for ${JSON.stringify(creds)}`);
  }
});

await test('A VERIFICATION FAILURE CARRIES NO TOKEN', async () => {
  /* The refusal is rendered back onto the admin page. cfApi scrubs its own
   * errors, but nothing stops this function adding the token to one. */
  const fn = api({ ok: false, error: 'Unauthorized' });

  const out = await verifyAccount({ accountId: ACCOUNT_ID, token: TOKEN }, { api: fn });

  assert.ok(!String(out.error).includes(TOKEN), 'the token reached the error');
});

await test('A CLOUDFLARE ANSWER OF NOTHING AT ALL IS A FAILURE', async () => {
  /* cfApi returns an object on every path, but a stub, a mock or a future
   * refactor may not. Reading .ok off undefined would throw inside the add
   * handler and become a 500 — which, to the person at the form, looks like
   * the app being broken rather than a credential being wrong. */
  const out = await verifyAccount({ accountId: ACCOUNT_ID, token: TOKEN },
    { api: async () => undefined });

  assert.strictEqual(out.ok, false);
});

console.log('\nRe-counting a stored account\n');

/* WHY RECOUNTING EXISTS
 *
 * `projects` is written once, when the account is added, and is true for
 * exactly as long as nobody creates a blog. Edwin's Aguirre Negro account
 * read "0 / 100" with a blog already published on it.
 *
 * A number that is right on day one and silently wrong afterwards is worse
 * than no number — it is read as current, and the nearlyFull warning that
 * hangs off it can never fire. */

await test('IT OPENS THE SEALED TOKEN AND COUNTS WITH IT', async () => {
  const fn = api({ ok: true, result: [], info: { total_count: 37 } });

  const out = await recountAccount(account(), { api: fn });

  assert.strictEqual(out.ok, true, `it failed: ${out.error}`);
  assert.strictEqual(out.projects, 37);

  /* THE DECRYPTED token WENT OVER THE WIRE, NOT THE SEALED BLOB. Sending
   * the sealed value would authenticate as nothing and come back as
   * "Invalid API Token" — a credential error for a credential that is
   * perfectly fine. */
  assert.strictEqual(fn.calls[0].opts.creds.token, TOKEN);
  assert.strictEqual(fn.calls[0].opts.creds.account, ACCOUNT_ID);
});

await test('A ROW IT CANNOT READ IS A FAILURE, NOT A THROW', async () => {
  /* THE DIFFERENCE FROM credsFor, AND IT IS DELIBERATE.
   *
   * credsFor is asked "where does THIS BLOG deploy to" — one right answer,
   * so an unreadable account must stop the deploy rather than quietly use
   * another.
   *
   * This is asked "how full is each of these ten accounts". One unreadable
   * row is not a reason to abandon the other nine, so it reports instead of
   * throwing and the caller carries on down the list. */
  for (const broken of [
    account({ token: '' }),
    account({ accountId: '' }),
    account({ token: 'not-sealed-at-all' }),
    null,
    undefined,
  ]) {
    const fn = api({ ok: true, result: [] });
    let out;

    try {
      out = await recountAccount(broken, { api: fn });
    } catch (err) {
      assert.fail(`it threw for ${JSON.stringify(broken)}: ${err.message}`);
    }

    assert.strictEqual(out.ok, false, `it accepted ${JSON.stringify(broken)}`);
    assert.ok(out.error, 'a failure with no reason in it');
  }
});

await test('A HALF-ROW IS TOLD APART FROM A KEY THAT NO LONGER FITS', async () => {
  /* THE MESSAGES ARE PINNED, NOT JUST THE REJECTION — AND MUTATION IS WHY.
   *
   * Removing the `!account.token` guard SURVIVED every test above. Without
   * it, open('') throws its own error, the catch turns that into a failure
   * carrying the label, and nothing could tell the two paths apart: both
   * rejected, both named the account, neither called Cloudflare.
   *
   * They need opposite actions, and a person reading the admin screen has
   * to know which:
   *
   *   "has no API token stored"  -> fill in that ONE row
   *   "could not be read"        -> CF_TOKEN_KEY has changed and EVERY
   *                                 account needs re-entering
   *
   * THIS IS THE SECOND TIME. credsFor had exactly this hole, found exactly
   * this way, and its comment says so. I wrote the same gap into the
   * function next door. */
  const noToken = await recountAccount(account({ token: '' }), { api: api({ ok: true, result: [] }) });
  const badKey = await recountAccount(account({ token: 'not-sealed-at-all' }), { api: api({ ok: true, result: [] }) });
  const noId = await recountAccount(account({ accountId: '' }), { api: api({ ok: true, result: [] }) });

  assert.match(noToken.error, /has no API token stored/i,
    `an empty token does not say so: ${noToken.error}`);

  assert.match(badKey.error, /could not be read/i,
    `an undecryptable token does not say so: ${badKey.error}`);

  assert.match(noId.error, /has no account id stored/i,
    `a missing account id does not say so: ${noId.error}`);

  /* And they are three DIFFERENT messages, which is the whole point. */
  assert.notStrictEqual(noToken.error, badKey.error);
  assert.notStrictEqual(noToken.error, noId.error);
});

await test('AND A HALF-ROW NEVER REACHES CLOUDFLARE', async () => {
  /* A missing token or account id is knowable here. Spending a round trip
   * on it — ten of them, on a screen somebody is waiting on — is waste. */
  for (const broken of [account({ token: '' }), account({ accountId: '' })]) {
    const fn = api({ ok: true, result: [] });

    await recountAccount(broken, { api: fn });

    assert.strictEqual(fn.calls.length, 0, 'it asked Cloudflare about half a row');
  }
});

await test('EVERY FAILURE NAMES THE ACCOUNT', async () => {
  /* THE WHOLE POINT OF A LOOP OVER TEN ACCOUNTS. "Invalid API Token" with
   * nothing naming the row is a search; "Client 3 — Acme HVAC: Invalid API
   * Token" is an instruction. */
  const cases = [
    [account({ token: '' }), { ok: true, result: [] }],
    [account({ accountId: '' }), { ok: true, result: [] }],
    [account({ token: 'not-sealed-at-all' }), { ok: true, result: [] }],
    [account(), { ok: false, error: 'Invalid API Token [code: 1000]' }],
  ];

  for (const [row, answer] of cases) {
    const out = await recountAccount(row, { api: api(answer) });

    assert.ok(out.error.includes('Client 3'),
      `this failure does not say which account: ${out.error}`);
  }
});

await test('AND CLOUDFLARE\'S OWN REASON SURVIVES THE LABEL BEING ADDED', async () => {
  /* Prefixing the label must not replace the reason. "Invalid account
   * identifier" and "Invalid API Token" send somebody to two different
   * screens. */
  const out = await recountAccount(account(),
    { api: api({ ok: false, error: 'Invalid account identifier [code: 7003]' }) });

  assert.ok(/Invalid account identifier/.test(out.error), `the reason was lost: ${out.error}`);
});

await test('NO FAILURE FROM ANY OF THIS CARRIES THE TOKEN', async () => {
  /* These are rendered onto the admin page, one line per account. */
  for (const [row, answer] of [
    [account({ token: 'not-sealed-at-all' }), { ok: true, result: [] }],
    [account(), { ok: false, error: `rejected: ${TOKEN}` }],
  ]) {
    const out = await recountAccount(row, { api: api(answer) });

    assert.ok(!String(out.error).includes(TOKEN), `the token reached the error: ${out.error}`);
    assert.ok(!String(out.error).includes(process.env.CF_TOKEN_KEY), 'the key reached the error');
  }
});

await test('A COUNT OF ZERO IS A SUCCESS, NOT A FAILURE', async () => {
  /* Two of Edwin's three accounts hold no blogs. If an empty account read
   * as "could not count", the column would be wrong for exactly the
   * accounts that have the most room. */
  const out = await recountAccount(account(),
    { api: api({ ok: true, result: [], info: { total_count: 0 } }) });

  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.projects, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

})();
