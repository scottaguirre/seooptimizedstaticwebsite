// test-blog-domains.js
//
// The admin screen that holds the pool: Cloudflare accounts, and the domains
// customers may put a blog on.
//
// WHY A SCREEN AND NOT CONFIGURATION
//
// So account eleven can be added without a deploy. Ten accounts in .env is
// ten variables, a restart to apply them, and ten live Cloudflare tokens in
// one file on one server.
//
// THE ONE THING THIS SCREEN MUST NEVER DO
//
// Show a token back. It takes one in, seals it, and from then on the only
// thing anybody sees is the last four characters. A field that helpfully
// redisplays what was typed would put ten customers' live Cloudflare
// credentials into the HTML of a page, into the browser cache, and into
// whatever is between.
//
//   node test-blog-domains.js

const assert = require('assert');
const crypto = require('crypto');

process.env.CF_TOKEN_KEY = crypto.randomBytes(32).toString('hex');

const { open } = require('./utils/blog/cloudflare/secretBox');

const router = require('./routes/blogDomainsRoute');
const CloudflareAccount = require('./models/CloudflareAccount');
const Domain = require('./models/Domain');

/* STUBBED THE SAME WAY THE MODELS ARE. The add handler calls
 * cloudflare.verifyAccount() — a property read at call time — so replacing it
 * here replaces it for the route.
 *
 * install() sets one on EVERY test, deliberately. The real one makes a live
 * HTTPS call to Cloudflare, and a test that forgot to stub it would not fail
 * loudly: it would hang on the network inside ./deploy.sh. */
const cloudflare = require('./utils/blog/cloudflare/accounts');

let passed = 0, failed = 0;

async function test(name, fn) {
  try { await fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

function section(name) { console.log(`\n${name}\n`); }

/** The last handler on a route, past requireAdmin. */
function handler(method, path) {
  const layer = router.stack.find(l => l.route && l.route.path === path && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} is not on the router`);

  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

const ACCOUNT_ID = 'cccc3333dddd4444eeee5555ffff6666';
const TOKEN = 'cf-live-token-W3jK9qLmNpR2sT5vX8zB1dF4gH7';

let db;

function install(over = {}) {
  db = Object.assign({
    accounts: [],
    domains: [],
    created: null,
    createdDomain: null,
    /* What verifyAccount will answer, and what it was asked. Default: the
     * credentials are good and the account holds 7 projects. */
    verify: { ok: true, projects: 7 },
    verified: [],

    /* The same for recountAccount, but keyed BY LABEL — so one test can say
     * "account two is broken, the rest are fine", which is the whole case
     * the refresh exists to survive. A label not named here falls back to
     * db.verify. */
    recount: {},
    recounted: [],
    updates: [],
  }, over);

  cloudflare.verifyAccount = async (creds) => {
    db.verified.push(creds);
    return db.verify;
  };

  cloudflare.recountAccount = async (acct) => {
    const label = acct && acct.label;
    db.recounted.push(label);

    return Object.prototype.hasOwnProperty.call(db.recount, label)
      ? db.recount[label]
      : db.verify;
  };

  CloudflareAccount.updateOne = async (where, update) => {
    db.updates.push({ where, update });
    return { acknowledged: true };
  };

  CloudflareAccount.find = () => ({ sort: () => ({ lean: async () => db.accounts }) });
  CloudflareAccount.findById = async (id) =>
    db.accounts.find(a => String(a._id) === String(id)) || null;
  CloudflareAccount.findOne = async (where) =>
    db.accounts.find(a => !where.accountId || a.accountId === where.accountId) || null;
  CloudflareAccount.create = async (doc) => { db.created = doc; return { _id: 'new-acct', ...doc }; };

  Domain.find = () => ({ sort: () => ({ lean: async () => db.domains }) });
  Domain.findOne = async (where) =>
    db.domains.find(d => !where.domain || d.domain === where.domain) || null;
  Domain.create = async (doc) => { db.createdDomain = doc; return { _id: 'new-domain', ...doc }; };
}

function req(over = {}) {
  return Object.assign({ id: 'req-1', user: { _id: 'admin-1' }, params: {}, body: {} }, over);
}

function res() {
  const out = { status: 200, html: '', redirected: null };
  return {
    out,
    locals: { csrfField: '<input name="_csrf" value="t">' },
    status(code) { out.status = code; return this; },
    send(html) { out.html = String(html); return this; },
    redirect(url) { out.redirected = url; return this; },
  };
}

async function call(h, r = req()) {
  const response = res();
  await h(r, response);
  return response.out;
}

const ACCOUNT = {
  _id: 'acct-3',
  label: 'Client 3 — Acme HVAC',
  accountId: ACCOUNT_ID,
  tokenLast4: 'gH7',
  enabled: true,
  projects: 14,
};

(async () => {

section('EVERY ROUTE IS BEHIND requireAdmin');

await test('AND IT IS CHECKED, NOT ASSUMED', async () => {
  /* THIS SCREEN HOLDS TEN LIVE CLOUDFLARE TOKENS. A route added later
   * without the guard is the kind of thing that is obvious in review and
   * invisible afterwards, so it is asserted per route rather than trusted
   * once. requireAuth is not enough: any signed-up customer has that. */
  const routes = router.stack.filter(l => l.route);

  assert.ok(routes.length >= 3, 'the router has almost no routes on it');

  for (const layer of routes) {
    const names = layer.route.stack.map(s => s.handle.name);

    assert.ok(names.includes('requireAdmin'),
      `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path} is not admin-only`);
  }
});

section('ADDING AN ACCOUNT');

await test('THE TOKEN IS SEALED BEFORE IT IS STORED', async () => {
  install();

  await call(handler('post', '/admin/blog-domains/accounts'),
    req({ body: { label: 'Client 3', accountId: ACCOUNT_ID, token: TOKEN } }));

  assert.ok(db.created, 'nothing was created');
  assert.notStrictEqual(db.created.token, TOKEN, 'the token was stored in plaintext');
  assert.strictEqual(open(db.created.token), TOKEN, 'what was stored does not decrypt to the token');
});

await test('AND THE LAST FOUR ARE KEPT SO A ROW CAN BE IDENTIFIED', async () => {
  install();

  await call(handler('post', '/admin/blog-domains/accounts'),
    req({ body: { label: 'Client 3', accountId: ACCOUNT_ID, token: TOKEN } }));

  assert.strictEqual(db.created.tokenLast4, TOKEN.slice(-4));
});

await test('A ROW WITH A MISSING FIELD IS REFUSED', async () => {
  /* cfApi() and childEnv() already refuse half a credential at the point
   * of use. Refusing it here means the error names the form field rather
   * than appearing weeks later inside a deploy. */
  for (const body of [
    { accountId: ACCOUNT_ID, token: TOKEN },
    { label: 'X', token: TOKEN },
    { label: 'X', accountId: ACCOUNT_ID },
    { label: 'X', accountId: ACCOUNT_ID, token: '   ' },
  ]) {
    install();
    const out = await call(handler('post', '/admin/blog-domains/accounts'), req({ body }));

    assert.strictEqual(out.status, 400, `accepted ${JSON.stringify(body)}`);
    assert.strictEqual(db.created, null, 'it created a half row');
  }
});

await test('AND SO IS AN ACCOUNT ID THAT IS ALREADY HERE', async () => {
  /* Two rows for one Cloudflare account hold two tokens for one place, and
   * nothing says which is current. */
  install({ accounts: [ACCOUNT] });

  const out = await call(handler('post', '/admin/blog-domains/accounts'),
    req({ body: { label: 'Again', accountId: ACCOUNT_ID, token: TOKEN } }));

  assert.strictEqual(out.status, 400);
  assert.strictEqual(db.created, null);
});

await test('AN EMAIL ADDRESS IS REFUSED BEFORE CLOUDFLARE IS EVEN ASKED', async () => {
  /* THIS HAPPENED. Edwin opened the form and his browser, reading "text
   * field followed by password field" as a login, autofilled his EMAIL
   * ADDRESS into the account ID and a SAVED PASSWORD into the token box.
   *
   * The handler had no shape check and no verification: it would have
   * sealed that password, stored it, redirected, and shown a tidy new row.
   * The first sign of trouble would have been a deploy failing weeks later
   * with a raw Cloudflare error naming neither the form nor the row.
   *
   * Refused HERE, without a round trip, because "Invalid account
   * identifier" relayed from Cloudflare does not tell somebody that their
   * browser filled the form in for them. */
  install();

  const out = await call(handler('post', '/admin/blog-domains/accounts'),
    req({ body: { label: 'Main', accountId: 'scottaguirre@yahoo.com', token: TOKEN } }));

  assert.strictEqual(out.status, 400);
  assert.strictEqual(db.created, null, 'it stored an email address as an account id');
  assert.strictEqual(db.verified.length, 0, 'it spent a round trip on an email address');
});

await test('AND SO IS A PASTED URL OR A STRAY SPACE', async () => {
  /* The other two things people put in this box: the dashboard URL they
   * found the ID on, and a copied line that brought a space with it. */
  for (const accountId of [
    'https://dash.cloudflare.com/cccc3333dddd4444eeee5555ffff6666',
    'dash.cloudflare.com/cccc3333',
    'cccc3333 dddd4444',
    'cccc3333\tdddd4444',
  ]) {
    install();

    const out = await call(handler('post', '/admin/blog-domains/accounts'),
      req({ body: { label: 'Main', accountId, token: TOKEN } }));

    assert.strictEqual(out.status, 400, `accepted ${JSON.stringify(accountId)}`);
    assert.strictEqual(db.created, null, `stored ${JSON.stringify(accountId)}`);
  }
});

await test('BUT THE SHAPE CHECK IS LOOSE, BECAUSE THE FORMAT IS NOT PUBLISHED', async () => {
  /* Every Cloudflare account ID anybody has seen is 32 hex characters, and
   * Cloudflare's own documentation does not say so. A strict regex built on
   * that guess would one day refuse a real ID with no way around it — and
   * the person it locked out would be an admin with no other route in.
   *
   * So the guard rejects what an account ID demonstrably is NOT, and
   * verifyAccount does the real checking. These all pass the shape check
   * and would be settled by Cloudflare. */
  for (const accountId of [
    'cccc3333dddd4444eeee5555ffff6666',
    'CCCC3333DDDD4444EEEE5555FFFF6666',
    'acct_01HQ8ZXK9',
    'a-perfectly-odd-identifier',
  ]) {
    install();

    await call(handler('post', '/admin/blog-domains/accounts'),
      req({ body: { label: 'Main', accountId, token: TOKEN } }));

    assert.ok(db.created, `the shape check refused ${accountId}`);
  }
});

section('THE CREDENTIALS ARE USED ONCE BEFORE THEY ARE STORED');

await test('CLOUDFLARE IS ASKED, WITH THE PAIR THAT WAS TYPED', async () => {
  /* The dangerous row is not the obviously wrong one — it is a valid token
   * belonging to a DIFFERENT Cloudflare account. It authenticates
   * perfectly, stores cleanly, and publishes a client's blog into somebody
   * else's account. Only Cloudflare can tell us, and only if we ask with
   * the pair rather than with half of it. */
  install();

  await call(handler('post', '/admin/blog-domains/accounts'),
    req({ body: { label: 'Main', accountId: ACCOUNT_ID, token: TOKEN } }));

  assert.strictEqual(db.verified.length, 1, 'the credentials were never checked');
  assert.strictEqual(db.verified[0].accountId, ACCOUNT_ID);
  assert.strictEqual(db.verified[0].token, TOKEN,
    'it verified something other than what was typed');
});

await test('AND IT IS ASKED BEFORE ANYTHING IS WRITTEN', async () => {
  install({ verify: { ok: false, error: 'Invalid API Token [code: 1000]' } });

  const out = await call(handler('post', '/admin/blog-domains/accounts'),
    req({ body: { label: 'Main', accountId: ACCOUNT_ID, token: TOKEN } }));

  assert.strictEqual(out.status, 400);
  assert.strictEqual(db.created, null, 'a credential Cloudflare rejected was stored anyway');
  assert.strictEqual(out.redirected, null, 'it reported success');
});

await test('THE REFUSAL REPEATS CLOUDFLARE\'S REASON', async () => {
  /* "Invalid account identifier" and "Invalid API Token" send somebody to
   * two different screens. Flattening both into "that did not work" is how
   * a person retypes a correct token four times. */
  install({ verify: { ok: false, error: 'Invalid account identifier [code: 7003]' } });

  const out = await call(handler('post', '/admin/blog-domains/accounts'),
    req({ body: { label: 'Main', accountId: ACCOUNT_ID, token: TOKEN } }));

  assert.ok(out.html.includes('Invalid account identifier'),
    'the reason Cloudflare gave is not on the page');
});

await test('AND THE REFUSAL STILL CARRIES NO TOKEN', async () => {
  /* A new page that renders a new error is a new chance to print the
   * credential. */
  install({ verify: { ok: false, error: `Unauthorized for ${TOKEN}` } });

  const out = await call(handler('post', '/admin/blog-domains/accounts'),
    req({ body: { label: 'Main', accountId: ACCOUNT_ID, token: TOKEN } }));

  assert.ok(!out.html.includes(TOKEN), 'the token was rendered into the refusal');
});

await test('THE PROJECT COUNT COMES BACK FROM CLOUDFLARE, NOT FROM A DEFAULT', async () => {
  /* The check had to list the account's Pages projects to prove the token
   * works on it, so the count is already in hand. Storing 0 instead would
   * put "0 / 100" on the screen for an account that is nearly full. */
  install({ verify: { ok: true, projects: 92 } });

  await call(handler('post', '/admin/blog-domains/accounts'),
    req({ body: { label: 'Main', accountId: ACCOUNT_ID, token: TOKEN } }));

  assert.strictEqual(db.created.projects, 92);
  assert.ok(db.created.projectsCountedAt instanceof Date,
    'nothing records WHEN that count was true');
});

section('THE FORM ITSELF');

await test('THE TOKEN FIELD IS autocomplete="new-password", NOT "off"', async () => {
  /* IT WAS "off", AND CHROME FILLED IT ANYWAY. Browsers deliberately ignore
   * "off" on password fields, because sites used it to defeat password
   * managers. "new-password" is the value that is honoured: it says the
   * password is being SET, so do not offer a saved one.
   *
   * Scoped to the token input rather than searched for across the page —
   * three other fields on this screen carry autocomplete attributes, and a
   * whole-page match would pass on any of them. */
  install();

  const out = await call(handler('get', '/admin/blog-domains'));
  const field = out.html.match(/<input[^>]*id="token"[^>]*>/);

  assert.ok(field, 'the token field is gone');
  assert.ok(/autocomplete="new-password"/.test(field[0]),
    `the token field invites autofill again: ${field[0]}`);
  assert.ok(/type="password"/.test(field[0]), 'the token is typed in clear');
});

await test('AND SO IS THE ACCOUNT ID FIELD, WHICH IS THE OTHER HALF OF THE LOGIN', async () => {
  /* A browser fills the pair, not the password alone. Leaving this one open
   * is how an email address lands in it. */
  install();

  const out = await call(handler('get', '/admin/blog-domains'));
  const field = out.html.match(/<input[^>]*id="accountId"[^>]*>/);

  assert.ok(field, 'the account id field is gone');
  assert.ok(/autocomplete="off"/.test(field[0]),
    `the account id field invites autofill: ${field[0]}`);
});

await test('THE PAGE LOADS THE SHOW/HIDE SCRIPT', async () => {
  /* A Cloudflare API token is forty characters of noise that sometimes has
   * to be typed by hand off another screen. With no way to read it back,
   * the only way to find a typo is to submit and be refused.
   *
   * passwordToggle.js finds every input[type=password] on a page it is
   * loaded on, so the field needs nothing of its own — but the page has to
   * ask for the script, and nothing else here would notice if it stopped. */
  install();

  const out = await call(handler('get', '/admin/blog-domains'));

  assert.ok(out.html.includes('/js/passwordToggle.js'),
    'the token field has no way to be read back');
});

await test('THE TOKEN NEVER APPEARS IN AN ERROR EITHER', async () => {
  /* The refusal above re-renders the form, and a form that helpfully
   * redisplays what was typed would put a live Cloudflare credential into
   * the HTML of a page. */
  install({ accounts: [ACCOUNT] });

  const out = await call(handler('post', '/admin/blog-domains/accounts'),
    req({ body: { label: 'Again', accountId: ACCOUNT_ID, token: TOKEN } }));

  assert.ok(!out.html.includes(TOKEN), 'the token was rendered back into the page');
});

section('REFRESHING THE PROJECT COUNTS');

/* WHY THIS EXISTS
 *
 * `projects` was written once, when the account was added, and was true for
 * exactly as long as nobody created a blog. Edwin's Aguirre Negro account
 * read "0 / 100" with a blog already published on it.
 *
 * A number that is right on day one and silently wrong afterwards is worse
 * than no number: it is read as current, and the nearlyFull warning that
 * hangs off it can never fire. */

const TWO = { _id: 'acct-2', label: 'Client 2', accountId: 'b'.repeat(32), enabled: true, projects: 0 };

await test('IT RE-COUNTS EVERY ACCOUNT AND STORES WHAT IT FOUND', async () => {
  install({ accounts: [ACCOUNT, TWO] });
  db.recount = { 'Client 3 — Acme HVAC': { ok: true, projects: 41 }, 'Client 2': { ok: true, projects: 3 } };

  const out = await call(handler('post', '/admin/blog-domains/refresh'));

  assert.deepStrictEqual(db.recounted, ['Client 3 — Acme HVAC', 'Client 2'],
    'it did not ask about every account');

  assert.strictEqual(db.updates.length, 2, 'it counted but did not store');
  assert.strictEqual(db.updates[0].update.$set.projects, 41);
  assert.strictEqual(db.updates[1].update.$set.projects, 3);
  assert.strictEqual(out.redirected, '/admin/blog-domains');
});

await test('AND RECORDS WHEN THE COUNT WAS TAKEN', async () => {
  /* WITHOUT THIS THE SCREEN CANNOT TELL A FRESH COUNT FROM A YEAR-OLD ONE,
   * which is the whole fault being fixed — a number with no age on it is
   * read as current forever. */
  install({ accounts: [ACCOUNT] });

  await call(handler('post', '/admin/blog-domains/refresh'));

  assert.ok(db.updates[0].update.$set.projectsCountedAt instanceof Date,
    'nothing records WHEN the count was true');
});

await test('ONE BROKEN ACCOUNT DOES NOT STOP THE OTHERS', async () => {
  /* THE REASON recountAccount REPORTS INSTEAD OF THROWING. A revoked token
   * on account one must not leave the other nine unread — and a refresh
   * that gives up halfway is one that quietly does nothing the day it is
   * most needed. */
  install({ accounts: [ACCOUNT, TWO] });
  db.recount = {
    'Client 3 — Acme HVAC': { ok: false, error: '"Client 3 — Acme HVAC": Invalid API Token' },
    'Client 2': { ok: true, projects: 5 },
  };

  const out = await call(handler('post', '/admin/blog-domains/refresh'));

  assert.strictEqual(db.recounted.length, 2, 'it stopped at the broken one');
  assert.strictEqual(db.updates.length, 1, 'it stored a count it never obtained');
  assert.strictEqual(db.updates[0].update.$set.projects, 5);
  assert.notStrictEqual(out.status, 500, 'a bad row took the whole page down');
});

await test('A FAILED COUNT WRITES NOTHING AT ALL', async () => {
  /* NOT EVEN THE TIMESTAMP, and this is the subtle one. Stamping
   * projectsCountedAt on a failure would make a stale number look freshly
   * checked — the exact lie this feature exists to stop, told more
   * convincingly than before. */
  install({ accounts: [ACCOUNT] });
  db.recount = { 'Client 3 — Acme HVAC': { ok: false, error: 'nope' } };

  await call(handler('post', '/admin/blog-domains/refresh'));

  assert.strictEqual(db.updates.length, 0, 'it wrote something for an account it could not read');
});

await test('AND THE SCREEN SAYS WHICH ACCOUNT FAILED, AND WHY', async () => {
  /* A refresh that silently skips a row leaves somebody reading a stale
   * number believing it was just checked. */
  install({ accounts: [ACCOUNT] });
  db.recount = { 'Client 3 — Acme HVAC': { ok: false, error: '"Client 3 — Acme HVAC": Invalid API Token [code: 1000]' } };

  const out = await call(handler('post', '/admin/blog-domains/refresh'));

  assert.ok(out.html.includes('Client 3'), 'the failure does not name the account');
  assert.ok(/Invalid API Token/.test(out.html), 'the reason Cloudflare gave is not shown');
});

await test('AND NO STORED TOKEN REACHES THAT PAGE', async () => {
  /* WHERE THE SCRUBBING ACTUALLY LIVES, because this test first asserted
   * the wrong thing and failed against correct code.
   *
   * The plaintext token never reaches this handler — recountAccount opens
   * it, uses it and scrubs its own message before returning, and THAT is
   * where "no error carries the token" is asserted (test-cloudflare-
   * accounts.js). Repeating the assertion here only proved that a stub
   * returning an unscrubbed string produces an unscrubbed page, which is
   * true and tells us nothing.
   *
   * What this handler CAN guarantee is that it never prints the sealed
   * blob sitting in the row it is iterating over — the failure page is a
   * new page rendering new content, and a template that reached for the
   * account document is exactly the kind of thing added later. */
  install({ accounts: [{ ...ACCOUNT, token: 'sealed-blob-here' }] });
  db.recount = { 'Client 3 — Acme HVAC': { ok: false, error: '"Client 3": Invalid API Token' } };

  const out = await call(handler('post', '/admin/blog-domains/refresh'));

  assert.ok(!out.html.includes('sealed-blob-here'),
    'the sealed token was rendered into the failure page');
  assert.ok(!out.html.includes(TOKEN), 'the token was rendered into the failure page');
});

await test('A COUNT OF ZERO IS STORED, NOT SKIPPED', async () => {
  /* Two of Edwin's three accounts hold no blogs. Treating 0 as "nothing to
   * record" would leave exactly the emptiest accounts unstamped, and they
   * are the ones a customer is about to be sent to. */
  install({ accounts: [ACCOUNT] });
  db.recount = { 'Client 3 — Acme HVAC': { ok: true, projects: 0 } };

  await call(handler('post', '/admin/blog-domains/refresh'));

  assert.strictEqual(db.updates.length, 1, 'an empty account was not recorded');
  assert.strictEqual(db.updates[0].update.$set.projects, 0);
});

await test('THE SCREEN OFFERS A WAY TO RUN IT', async () => {
  /* The route went live with nothing linking to it is a mistake this
   * codebase has made twice. */
  install({ accounts: [ACCOUNT] });

  const out = await call(handler('get', '/admin/blog-domains'));

  assert.ok(out.html.includes('/admin/blog-domains/refresh'),
    'there is no way to trigger a refresh from the screen');
});

await test('AND SAYS HOW OLD EACH COUNT IS', async () => {
  /* THE HALF THAT MAKES THE NUMBER HONEST. "2 / 100" is read as current.
   * "2 / 100 · checked 3 days ago" is read as what it is. */
  const long = new Date(Date.now() - 1000 * 60 * 60 * 24 * 3);

  install({ accounts: [{ ...ACCOUNT, projects: 2, projectsCountedAt: long }] });

  const out = await call(handler('get', '/admin/blog-domains'));

  assert.ok(/3 days ago/.test(out.html), 'the age of the count is not shown');
});

await test('AND SAYS SO WHEN IT HAS NEVER BEEN COUNTED', async () => {
  /* Accounts added before any of this exists have no timestamp. Showing
   * nothing would read as "just checked". */
  install({ accounts: [{ ...ACCOUNT, projects: 0, projectsCountedAt: null }] });

  const out = await call(handler('get', '/admin/blog-domains'));

  assert.ok(/never checked/i.test(out.html), 'an uncounted account looks freshly counted');
});

section('THE LIST');

await test('IT SHOWS THE LABEL, THE ACCOUNT AND THE LAST FOUR', async () => {
  install({ accounts: [ACCOUNT] });

  const out = await call(handler('get', '/admin/blog-domains'));

  assert.ok(out.html.includes('Client 3'), 'the label is not shown');
  assert.ok(out.html.includes(ACCOUNT_ID), 'the account id is not shown');
  assert.ok(out.html.includes('gH7'), 'there is no way to tell which token a row holds');
});

await test('AND NEVER THE TOKEN ITSELF', async () => {
  /* THE ASSERTION THIS WHOLE FILE IS FOR. The stored value is encrypted,
   * so showing it would take a deliberate decrypt — which is exactly the
   * kind of helpful feature somebody adds later. */
  install({ accounts: [{ ...ACCOUNT, token: 'sealed-blob-here' }] });

  const out = await call(handler('get', '/admin/blog-domains'));

  assert.ok(!out.html.includes('sealed-blob-here'),
    'the sealed token was rendered into the page');
  assert.ok(!out.html.includes(TOKEN), 'the token was rendered into the page');
});

await test('AND IT SAYS HOW FULL EACH ACCOUNT IS', async () => {
  /* Cloudflare caps Pages projects at 100 per account. An account filling
   * up has to be visible BEFORE it refuses, because the refusal lands on a
   * customer pressing Create. */
  install({ accounts: [{ ...ACCOUNT, projects: 86 }] });

  const out = await call(handler('get', '/admin/blog-domains'));

  assert.ok(/86\s*\/\s*100/.test(out.html), 'the project count is not shown');
});

section('ADDING A DOMAIN');

await test('A DOMAIN IS STORED AGAINST ITS ACCOUNT', async () => {
  install({ accounts: [ACCOUNT] });

  await call(handler('post', '/admin/blog-domains/domains'),
    req({ body: { domain: 'acmehvac.com', account: 'acct-3', label: 'Acme HVAC' } }));

  assert.ok(db.createdDomain, 'nothing was created');
  assert.strictEqual(db.createdDomain.domain, 'acmehvac.com');
  assert.strictEqual(String(db.createdDomain.account), 'acct-3');
});

await test('AND IT IS NORMALISED ON THE WAY IN', async () => {
  /* Somebody will paste a URL. Storing "https://AcmeHVAC.com/" would make
   * the dropdown offer it, the hostname check miss it, and the zone lookup
   * fail — three symptoms, one cause, none of them obviously the paste. */
  for (const typed of ['  AcmeHVAC.com ', 'https://acmehvac.com', 'http://AcmeHVAC.com/', 'acmehvac.com.']) {
    install({ accounts: [ACCOUNT] });

    await call(handler('post', '/admin/blog-domains/domains'),
      req({ body: { domain: typed, account: 'acct-3' } }));

    assert.ok(db.createdDomain, `${typed} was refused outright`);
    assert.strictEqual(db.createdDomain.domain, 'acmehvac.com',
      `${typed} was stored as ${db.createdDomain && db.createdDomain.domain}`);
  }
});

await test('A DOMAIN ALREADY IN THE POOL IS REFUSED', async () => {
  /* Two rows for one domain pointing at different accounts is an
   * ambiguity made permanent: whichever the lookup returned would decide
   * where a blog was created. */
  install({
    accounts: [ACCOUNT],
    domains: [{ _id: 'd1', domain: 'acmehvac.com', account: 'acct-3' }],
  });

  const out = await call(handler('post', '/admin/blog-domains/domains'),
    req({ body: { domain: 'acmehvac.com', account: 'acct-3' } }));

  assert.strictEqual(out.status, 400);
  assert.strictEqual(db.createdDomain, null);
});

await test('AND SO IS ONE POINTED AT AN ACCOUNT THAT IS NOT HERE', async () => {
  /* A domain whose account does not exist is a domain whose blogs cannot
   * deploy — and credsFor() would throw at publish time, which is a long
   * way from the form that caused it. */
  install({ accounts: [ACCOUNT] });

  const out = await call(handler('post', '/admin/blog-domains/domains'),
    req({ body: { domain: 'other.com', account: 'acct-missing' } }));

  assert.strictEqual(out.status, 400);
  assert.strictEqual(db.createdDomain, null);
});

await test('A SUBDOMAIN IS REFUSED, BECAUSE THE POOL HOLDS REGISTRABLE DOMAINS', async () => {
  /* The customer supplies the prefix. A pool entry of "blog.acmehvac.com"
   * would produce "hvac.blog.acmehvac.com", which is not what anybody
   * meant and which Cloudflare will happily create. */
  install({ accounts: [ACCOUNT] });

  const out = await call(handler('post', '/admin/blog-domains/domains'),
    req({ body: { domain: 'blog.acmehvac.com', account: 'acct-3' } }));

  assert.strictEqual(out.status, 400, 'a subdomain was accepted into the pool');
  assert.strictEqual(db.createdDomain, null);
});

await test('AND SO IS SOMETHING THAT IS NOT A DOMAIN AT ALL', async () => {
  for (const junk of ['', '   ', 'not a domain', 'localhost', '..', 'acmehvac']) {
    install({ accounts: [ACCOUNT] });

    const out = await call(handler('post', '/admin/blog-domains/domains'),
      req({ body: { domain: junk, account: 'acct-3' } }));

    assert.strictEqual(out.status, 400, `accepted ${JSON.stringify(junk)}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

})();
