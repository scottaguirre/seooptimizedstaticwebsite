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
/* COUNTED BY THE REMOVAL GUARD, so it is stubbed like the other two. An
 * unstubbed countDocuments() would reach for a Mongo connection that does not
 * exist in this suite. */
const BlogSite = require('./models/BlogSite');

/* STUBBED THE SAME WAY THE MODELS ARE. The add handler calls
 * cloudflare.verifyAccount() — a property read at call time — so replacing it
 * here replaces it for the route.
 *
 * install() sets one on EVERY test, deliberately. The real one makes a live
 * HTTPS call to Cloudflare, and a test that forgot to stub it would not fail
 * loudly: it would hang on the network inside ./deploy.sh. */
const cloudflare = require('./utils/blog/cloudflare/accounts');

/* AND THE SAME FOR findZone, WHICH THE ADD-DOMAIN HANDLER CALLS.
 *
 * The route requires this module and reads `cfDeploy.findZone` at call time,
 * for exactly this reason. Stubbing it here is enough even though the router
 * was required above — and a test that forgot would not fail loudly, it would
 * make a live HTTPS call to Cloudflare and hang inside ./deploy.sh. */
const cfDeploy = require('./utils/blog/cloudflare/deploy');

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

    /* THE ZONE CHECK ON THE ADD-DOMAIN HANDLER — moved here 25 October from
     * the customer's create form. Defaulted to "the zone is on the account",
     * which is the quiet path, so every existing add-domain test above goes
     * on behaving as it did. */
    zone: { ok: true, id: 'z1', name: 'acmehvac.com' },
    zoneCalls: [],

    /* And the credentials the check is made with. `credsError` makes
     * credsForAccountId throw, which is what a disabled account or a token
     * that will not decrypt does. */
    creds: { token: 'cf-token-for-acct-3', account: ACCOUNT_ID },
    credsError: '',
    credsCalls: [],

    /* WHAT POINTS AT THE ACCOUNT BEING REMOVED. Both default to zero —
     * "nothing references it" is the only state in which a removal is
     * allowed, so it is the state every other test wants to be in. */
    blogCount: 0,
    domainCount: 0,
    countCalls: [],
    deleted: null,
  }, over);

  cloudflare.credsForAccountId = async (id) => {
    db.credsCalls.push(String(id));
    if (db.credsError) throw new Error(db.credsError);
    return db.creds;
  };

  cfDeploy.findZone = async (opts) => { db.zoneCalls.push(opts); return db.zone; };

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

  BlogSite.countDocuments = async (where) => {
    db.countCalls.push({ blogs: where });
    return db.blogCount;
  };

  Domain.countDocuments = async (where) => {
    db.countCalls.push({ domains: where });
    return db.domainCount;
  };

  CloudflareAccount.deleteOne = async (where) => {
    db.deleted = where;
    return { deletedCount: 1 };
  };

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

section('REPLACING A TOKEN');

const NEW_TOKEN = 'cf-live-token-Q4wE7rT0yU3iO6pA9sD2fG5hJ8k';

await test('THE NEW TOKEN IS SEALED AND WRITTEN IN PLACE', async () => {
  install({ accounts: [ACCOUNT] });

  const out = await call(handler('post', '/admin/blog-domains/accounts/:id/token'),
    req({ params: { id: 'acct-3' }, body: { token: NEW_TOKEN } }));

  assert.strictEqual(out.redirected, '/admin/blog-domains');
  assert.strictEqual(db.updates.length, 1, 'nothing was written');

  const [{ where, update }] = db.updates;

  /* THE _id IS THE WHOLE POINT. BlogSite.cloudflareAccount and
   * Domain.account hold it; a delete-and-recreate would change it and
   * orphan every reference. */
  assert.strictEqual(String(where._id), 'acct-3', 'it updated the wrong row');
  assert.notStrictEqual(update.$set.token, NEW_TOKEN, 'the token was stored in plaintext');
  assert.strictEqual(open(update.$set.token), NEW_TOKEN,
    'what was stored does not decrypt to the new token');
});

await test('AND THE LAST FOUR MOVE WITH IT', async () => {
  /* The last four are the only thing on the screen that tells one token
   * from another. Left at the old value, the row would say the rotation
   * had not happened. */
  install({ accounts: [ACCOUNT] });

  await call(handler('post', '/admin/blog-domains/accounts/:id/token'),
    req({ params: { id: 'acct-3' }, body: { token: NEW_TOKEN } }));

  assert.strictEqual(db.updates[0].update.$set.tokenLast4, NEW_TOKEN.slice(-4));
});

await test('IT IS CHECKED AGAINST THE ROW\'S OWN ACCOUNT ID, NOT ONE IN THE BODY', async () => {
  /* THE HAZARD THIS EXISTS TO CLOSE. A token that is perfectly valid for a
   * DIFFERENT Cloudflare account authenticates fine. Verified against an id
   * from the request, a rotation could quietly move every blog already
   * pointing at this row into somebody else's account — which is the 23
   * October bug with a worse blast radius.
   *
   * So the id is taken from the stored row and an id in the body is
   * ignored. Moving an account to a different Cloudflare ID is not a
   * rotation; it is a new account, and it goes through the add form where
   * the pair is checked together. */
  install({ accounts: [ACCOUNT] });

  await call(handler('post', '/admin/blog-domains/accounts/:id/token'),
    req({
      params: { id: 'acct-3' },
      body: { token: NEW_TOKEN, accountId: 'aaaa1111bbbb2222cccc3333dddd4444' },
    }));

  assert.strictEqual(db.verified.length, 1, 'Cloudflare was not asked');
  assert.strictEqual(db.verified[0].accountId, ACCOUNT_ID,
    'it verified against an account id from the request body');
});

await test('A TOKEN CLOUDFLARE REFUSES LEAVES THE OLD ONE IN PLACE', async () => {
  /* The dangerous failure is not a refusal. It is a refusal that still
   * wrote — leaving the row holding a credential that authenticates as
   * nothing, found weeks later inside a deploy. */
  install({ accounts: [ACCOUNT], verify: { ok: false, error: 'Invalid API Token' } });

  const out = await call(handler('post', '/admin/blog-domains/accounts/:id/token'),
    req({ params: { id: 'acct-3' }, body: { token: NEW_TOKEN } }));

  assert.strictEqual(out.status, 400);
  assert.strictEqual(db.updates.length, 0, 'it wrote a token Cloudflare refused');
});

await test('AND THE REFUSAL DOES NOT PRINT THE TOKEN', async () => {
  /* This is the line that turns the value into HTML, and it is the only
   * place that holds the new token for certain. */
  install({
    accounts: [ACCOUNT],
    verify: { ok: false, error: `Invalid API Token ${NEW_TOKEN}` },
  });

  const out = await call(handler('post', '/admin/blog-domains/accounts/:id/token'),
    req({ params: { id: 'acct-3' }, body: { token: NEW_TOKEN } }));

  assert.ok(!out.html.includes(NEW_TOKEN), 'the new token was rendered into the page');
});

await test('AN EMPTY TOKEN IS REFUSED BEFORE CLOUDFLARE IS ASKED', async () => {
  install({ accounts: [ACCOUNT] });

  const out = await call(handler('post', '/admin/blog-domains/accounts/:id/token'),
    req({ params: { id: 'acct-3' }, body: { token: '   ' } }));

  assert.strictEqual(out.status, 400);
  assert.strictEqual(db.verified.length, 0, 'it asked Cloudflare about an empty token');
  assert.strictEqual(db.updates.length, 0);
});

await test('A ROW THAT IS NOT THERE IS REFUSED', async () => {
  install({ accounts: [ACCOUNT] });

  const out = await call(handler('post', '/admin/blog-domains/accounts/:id/token'),
    req({ params: { id: 'acct-gone' }, body: { token: NEW_TOKEN } }));

  assert.strictEqual(out.status, 400);
  assert.strictEqual(db.updates.length, 0);
});

await test('THE PROJECT COUNT IS REFRESHED BY THE ROTATION', async () => {
  /* verifyAccount had to list the account's Pages projects to prove the
   * token works on it, so the count is already in hand. Leaving it alone
   * would mean the Projects column kept a number taken with a credential
   * that no longer exists — the "0 / 100 read as current" problem that
   * ago() was written for. */
  install({ accounts: [ACCOUNT], verify: { ok: true, projects: 23 } });

  await call(handler('post', '/admin/blog-domains/accounts/:id/token'),
    req({ params: { id: 'acct-3' }, body: { token: NEW_TOKEN } }));

  const { $set } = db.updates[0].update;

  assert.strictEqual($set.projects, 23);
  assert.ok($set.projectsCountedAt instanceof Date, 'the count was not re-dated');
});

section('REMOVING AN ACCOUNT');

await test('THE CONFIRMATION IS A GET AND IT DELETES NOTHING', async () => {
  install({ accounts: [ACCOUNT] });

  const out = await call(handler('get', '/admin/blog-domains/accounts/:id/delete'),
    req({ params: { id: 'acct-3' } }));

  assert.strictEqual(out.status, 200);
  assert.strictEqual(db.deleted, null, 'a GET deleted the row');
  assert.ok(out.html.includes('Acme HVAC'), 'the confirmation does not name the account');
});

await test('AND IT SAYS THE CLOUDFLARE ACCOUNT ITSELF IS NOT TOUCHED', async () => {
  /* "Remove" on a screen full of Cloudflare accounts invites exactly one
   * wrong reading, and it is the one that cannot be undone from here. */
  install({ accounts: [ACCOUNT] });

  const out = await call(handler('get', '/admin/blog-domains/accounts/:id/delete'),
    req({ params: { id: 'acct-3' } }));

  assert.ok(/Cloudflare account itself is not touched/i.test(out.html),
    'the confirmation does not say what survives');
});

await test('REMOVAL IS REFUSED WHILE A BLOG POINTS AT IT', async () => {
  /* credsForAccountId() throws "a Cloudflare account that no longer
   * exists" for an orphaned blog, and that blog cannot be deployed at all
   * — not even to the address it already answers on. */
  install({ accounts: [ACCOUNT], blogCount: 2 });

  const out = await call(handler('post', '/admin/blog-domains/accounts/:id/delete'),
    req({ params: { id: 'acct-3' } }));

  assert.strictEqual(out.status, 400);
  assert.strictEqual(db.deleted, null, 'it removed an account two blogs are using');
  assert.ok(out.html.includes('2 blogs'), 'the refusal does not say how many');
});

await test('AND WHILE A POOL DOMAIN POINTS AT IT', async () => {
  /* The domain table on this same screen already renders "— account
   * missing —" for this state. That placeholder was written months before
   * there was any way to cause it. */
  install({ accounts: [ACCOUNT], domainCount: 1 });

  const out = await call(handler('post', '/admin/blog-domains/accounts/:id/delete'),
    req({ params: { id: 'acct-3' } }));

  assert.strictEqual(out.status, 400);
  assert.strictEqual(db.deleted, null);
  assert.ok(out.html.includes('1 domain'), 'the refusal does not say how many');
});

await test('THE CONFIRMATION REFUSES TOO, RATHER THAN OFFERING A BUTTON THAT CANNOT WORK', async () => {
  install({ accounts: [ACCOUNT], blogCount: 1 });

  const out = await call(handler('get', '/admin/blog-domains/accounts/:id/delete'),
    req({ params: { id: 'acct-3' } }));

  assert.strictEqual(out.status, 400);
  assert.ok(!out.html.includes('type="submit"'),
    'it offered a Remove button for a row that cannot be removed');
});

await test('THE POST COUNTS AGAIN RATHER THAN TRUSTING THE PAGE THAT OFFERED IT', async () => {
  /* The confirmation was rendered at some earlier moment. A blog created
   * between then and now is exactly the one nobody is thinking about. */
  install({ accounts: [ACCOUNT], blogCount: 1 });

  await call(handler('post', '/admin/blog-domains/accounts/:id/delete'),
    req({ params: { id: 'acct-3' } }));

  assert.ok(db.countCalls.length >= 2,
    'the POST did not re-count both collections');
});

await test('WITH NOTHING POINTING AT IT, THE ROW GOES BY _id', async () => {
  install({ accounts: [ACCOUNT] });

  const out = await call(handler('post', '/admin/blog-domains/accounts/:id/delete'),
    req({ params: { id: 'acct-3' } }));

  assert.strictEqual(out.redirected, '/admin/blog-domains');
  assert.ok(db.deleted, 'nothing was deleted');
  assert.strictEqual(String(db.deleted._id), 'acct-3');
});

await test('A ROW THAT IS NOT THERE IS REFUSED ON BOTH', async () => {
  for (const method of ['get', 'post']) {
    install({ accounts: [ACCOUNT] });

    const out = await call(handler(method, '/admin/blog-domains/accounts/:id/delete'),
      req({ params: { id: 'acct-gone' } }));

    assert.strictEqual(out.status, 400, `${method} accepted a row that is not there`);
    assert.strictEqual(db.deleted, null);
  }
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

/* ───────── IS THE ZONE ACTUALLY ON THAT ACCOUNT? ─────────
 *
 * MOVED HERE FROM test-static-blogs.js ON 25 OCTOBER 2026, with the check.
 *
 * It ran on the customer's create form from 19 October: after every blog
 * anybody created, one Cloudflare round trip, to catch a mistake only an
 * admin can make. Edwin: "an admin mistake, caught on an admin screen,
 * instead of firing on every create forever."
 *
 * AND IT REFUSES NOW, WHERE IT USED TO WARN. On the create form a refusal
 * would have been wrong — a blog on a domain Cloudflare does not host is a
 * legitimate thing to want, the owner points the DNS himself. A POOL domain
 * is not that. The pool exists because the zone is on the same account as
 * the Pages project, which is the thing that makes Cloudflare write the DNS
 * record itself. A pool row where that is untrue turns the automatic half of
 * this product off, silently, for every blog ever created on it.
 */

section('THE ZONE HAS TO BE ON THE ACCOUNT');

await test('A DOMAIN THE ACCOUNT DOES NOT HOLD IS REFUSED, AND NOT STORED', async () => {
  install({ accounts: [ACCOUNT] });
  db.zone = { ok: false, noZone: true, error: 'No zone in this Cloudflare account matches it.' };

  const out = await call(handler('post', '/admin/blog-domains/domains'),
    req({ body: { domain: 'acmehvac.com', account: 'acct-3' } }));

  assert.strictEqual(out.status, 400, 'a domain on the wrong account was accepted');
  assert.strictEqual(db.createdDomain, null, 'it was written to the pool anyway');
  assert.ok(/not on that Cloudflare account/i.test(out.html),
    'the screen does not say what is wrong');
  assert.ok(out.html.includes('acmehvac.com'), 'it does not name the domain');
  assert.ok(out.html.includes(ACCOUNT.label), 'it does not name the account');
});

await test('THE CHECK IS MADE WITH THAT ACCOUNT\'S CREDENTIALS, NOT THE ENVIRONMENT\'S', async () => {
  /* THE BUG THIS EXISTS FOR, AND IT COST EDWIN AN EVENING ON 22 OCTOBER.
   *
   * findZone({ domain }) with no `creds` falls back to the environment. The
   * old caller on the create form forgot to pass them, so it asked his
   * explr-home.com account whether it owned site-book.net — and told him his
   * perfectly good blog was on a domain he did not own.
   *
   * THE ASSERTION IS ON WHAT WENT OVER THE WIRE, not on what came back. The
   * answer is identical whether the right account or the wrong one was
   * asked, which is the only reason this needs saying. */
  install({ accounts: [ACCOUNT] });

  await call(handler('post', '/admin/blog-domains/domains'),
    req({ body: { domain: 'acmehvac.com', account: 'acct-3' } }));

  assert.strictEqual(db.zoneCalls.length, 1, 'the zone was never looked up');
  assert.deepStrictEqual(db.zoneCalls[0].creds, db.creds,
    'the check asked the environment\'s account, not the domain\'s');
  assert.deepStrictEqual(db.credsCalls, ['acct-3'],
    'the credentials came from somewhere other than the account on the form');
});

await test('AND A DOMAIN THE ACCOUNT DOES HOLD GOES STRAIGHT IN', async () => {
  install({ accounts: [ACCOUNT] });

  const out = await call(handler('post', '/admin/blog-domains/domains'),
    req({ body: { domain: 'acmehvac.com', account: 'acct-3' } }));

  assert.strictEqual(out.redirected, '/admin/blog-domains',
    'a correct domain was interrupted');
  assert.ok(db.createdDomain, 'it was not stored');
});

await test('A FAILURE TO ASK IS NOT A FAILURE TO MATCH: IT IS STORED, AND SAID', async () => {
  /* findZone returns ok:false for "this account does not hold it" AND for
   * "the token cannot read zones", and only the first carries `noZone`.
   *
   * Refusing on a permissions problem would block a correct domain on the
   * strength of a check that never ran. Storing it silently would teach
   * nobody anything. So: stored, and the screen says the check could not be
   * made and what to look at. */
  install({ accounts: [ACCOUNT] });
  db.zone = { ok: false, error: 'Zone:Read is missing from this token.' };

  const out = await call(handler('post', '/admin/blog-domains/domains'),
    req({ body: { domain: 'acmehvac.com', account: 'acct-3' } }));

  assert.ok(db.createdDomain, 'a correct domain was refused over a failed lookup');
  assert.ok(!out.redirected, 'it was stored silently');
  assert.ok(/not verified/i.test(out.html), 'the screen does not say the check failed');
  assert.ok(/Zone:Read/.test(out.html), 'it does not say what went wrong');
});

await test('AND SO IS A CREDENTIAL THAT WILL NOT RESOLVE', async () => {
  /* credsForAccountId throws for an account that is disabled or whose token
   * will not decrypt. The domain is still correct as far as anybody knows,
   * and the account's own row on this screen is where that gets fixed — so
   * the domain is stored and the reason is shown. */
  install({ accounts: [ACCOUNT] });
  db.credsError = 'The Cloudflare account for this blog is disabled (Client 3 — Acme HVAC).';

  const out = await call(handler('post', '/admin/blog-domains/domains'),
    req({ body: { domain: 'acmehvac.com', account: 'acct-3' } }));

  assert.ok(db.createdDomain, 'the domain was lost to an account problem');
  assert.strictEqual(db.zoneCalls.length, 0,
    'it asked Cloudflare with credentials it could not resolve');
  assert.ok(/not verified/i.test(out.html));
  assert.ok(/disabled/i.test(out.html), 'it does not say why the check could not run');
});

await test('AND NEITHER THE TOKEN NOR THE ACCOUNT ID REACHES THE PAGE', async () => {
  /* THE ONE THING THIS SCREEN MUST NEVER DO. The unverified page prints an
   * error that came back from Cloudflare, and a Cloudflare error is exactly
   * the kind of string that arrives with the credential embedded in it. */
  install({ accounts: [ACCOUNT] });
  db.zone = {
    ok: false,
    error: `Request to /accounts/${ACCOUNT_ID}/zones failed; `
      + 'token cf-token-for-acct-3 was refused',
  };

  const out = await call(handler('post', '/admin/blog-domains/domains'),
    req({ body: { domain: 'acmehvac.com', account: 'acct-3' } }));

  assert.ok(!out.html.includes('cf-token-for-acct-3'),
    'the API token was rendered into the page');
  assert.ok(!out.html.includes(ACCOUNT_ID),
    'the Cloudflare account id was rendered into the page');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

})();
