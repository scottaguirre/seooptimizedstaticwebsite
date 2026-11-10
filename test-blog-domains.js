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

/* AND SO IS THE WEBSITES COLLECTION, for the same reason: referencesTo()
 * counts it before an account may be removed. See install(). */
const CloudflareSite = require('./models/CloudflareSite');

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
    siteCount: 0,
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
  /* THE FILTER IS APPLIED, NOT IGNORED — and it had to be.
   *
   * This read `find(a => !where.accountId || a.accountId === where.accountId)`,
   * which answered every other query with the FIRST account. Harmless while
   * the only lookup was by accountId; the moment the duplicate-name guard
   * asked by label, every rename came back as a clash with itself.
   *
   *     A STUB THAT IGNORES THE FILTER ANSWERS A QUESTION
   *     NOBODY ASKED, AND DOES IT CONFIDENTLY.
   *
   * It now honours the three shapes this route uses: accountId, a
   * case-insensitive label regex, and `_id: { $ne }` for "anybody but me". */
  CloudflareAccount.findOne = async (where = {}) => db.accounts.find(a => {
    if (where.accountId && a.accountId !== where.accountId) return false;

    if (where._id && where._id.$ne && String(a._id) === String(where._id.$ne)) return false;

    if (where.label && where.label.$regex) {
      const flags = where.label.$options || '';
      if (!new RegExp(where.label.$regex, flags).test(String(a.label || ''))) return false;
    }

    return true;
  }) || null;
  CloudflareAccount.create = async (doc) => { db.created = doc; return { _id: 'new-acct', ...doc }; };

  BlogSite.countDocuments = async (where) => {
    db.countCalls.push({ blogs: where });
    return db.blogCount;
  };

  /* THE THIRD COLLECTION THAT POINTS AT AN ACCOUNT — added 7 November with
   * Cloudflare Websites, and the reason this suite went red six times the
   * moment referencesTo() grew a third count: an unstubbed countDocuments()
   * reaches for a Mongo connection this suite does not have, and the whole
   * removal section answered 500 instead of 400.
   *
   * Which is the suite doing its job. A count added to the guard and not to
   * the harness is indistinguishable, from the handler's point of view,
   * from a count that is always zero. */
  CloudflareSite.countDocuments = async (where) => {
    db.countCalls.push({ sites: where });
    return db.siteCount;
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

/* =======================================================================
 * Domains for WEBSITES
 *
 * The same pool and the same screen, with a GitHub installation behind the
 * row instead of a Cloudflare account. The customer's question is identical
 * — "where does this go?" — so the list is one list.
 * ==================================================================== */

await test('A WEBSITE DOMAIN IS STORED AGAINST AN INSTALLATION, NOT AN ACCOUNT', async () => {
  install();

  const out = await call(handler('post', '/admin/blog-domains/site-domains'),
    req({ body: { domain: 'acme.com', label: 'Acme', githubInstallationId: '176399104' } }));

  assert.strictEqual(out.status, 200);

  assert.strictEqual(db.createdDomain.domain, 'acme.com');
  assert.strictEqual(db.createdDomain.target, 'github');
  assert.strictEqual(db.createdDomain.githubInstallationId, '176399104');

  /* NO CLOUDFLARE ACCOUNT ON IT. A GitHub row has none and must not be made
   * to invent one — the account is required on this model only because
   * Cloudflare writes the DNS record from it. */
  assert.ok(!db.createdDomain.account);
});

await test('and the id has to be digits, not a pasted URL', async () => {
  /* The likeliest wrong input, and storing one would fail much later
   * against an endpoint whose path then has a slash in the middle. */
  install();

  const out = await call(handler('post', '/admin/blog-domains/site-domains'),
    req({ body: {
      domain: 'acme.com',
      githubInstallationId: 'https://github.com/settings/installations/176399104',
    } }));

  assert.ok(out.html.includes('not an installation id'));
  assert.strictEqual(db.createdDomain, null, 'it stored a URL as an id');
});

await test('A DOMAIN ALREADY IN THE POOL IS REFUSED, WHICHEVER KIND IT IS', async () => {
  /* One row per domain. Two rows pointing at different accounts is an
   * ambiguity made permanent: whichever the lookup returned would decide
   * where a site went, and the two would disagree between builds. */
  install({ domains: [{ _id: 'dom-1', domain: 'acme.com', account: 'acct-3' }] });

  const out = await call(handler('post', '/admin/blog-domains/site-domains'),
    req({ body: { domain: 'acme.com', githubInstallationId: '1' } }));

  assert.ok(out.html.includes('already in the pool'));
  assert.strictEqual(db.createdDomain, null);
});

await test('a subdomain is refused, because sites are served BENEATH the domain', async () => {
  /* acme.com/quality-plumbing/ is the shape. A subdomain here would put
   * every site two levels down. */
  install();

  const out = await call(handler('post', '/admin/blog-domains/site-domains'),
    req({ body: { domain: 'sites.acme.com', githubInstallationId: '1' } }));

  assert.ok(out.html.includes('not a domain we can use'));
  assert.strictEqual(db.createdDomain, null);
});

await test('THE SCREEN SAYS WHICH KIND EACH ROW IS', async () => {
  /* Two shapes in one table. Without a column saying which, a GitHub row
   * reads as a Cloudflare row whose account has gone missing. */
  install({
    domains: [
      { _id: 'd1', domain: 'acmehvac.com', account: 'acct-3', enabled: true },
      { _id: 'd2', domain: 'acme.com', target: 'github',
        githubInstallationId: '176399104', enabled: true },
    ],
  });

  const out = await call(handler('get', '/admin/blog-domains'));

  assert.ok(out.html.includes('websites'), 'no marker on the GitHub row');
  assert.ok(out.html.includes('blogs'), 'no marker on the Cloudflare row');
  assert.ok(out.html.includes('installation 176399104'));
});

/* ------------------------------------------------------------------------
 * What the row says about its own GitHub setup
 * --------------------------------------------------------------------- */

section('WHETHER THE SETUP HAS BEEN RUN');

await test('A DOMAIN NOBODY HAS SET UP SAYS SO, AND OFFERS THE BUTTON', async () => {
  /* The button used to look identical on a domain set up an hour ago and
   * one never touched — which is the question Edwin asked of it: "I
   * thought I had already done the first one. Will the set up GitHub
   * button always show up?" It did, on every row, because the row knew
   * nothing. */
  install({
    domains: [{ _id: 'd1', domain: 'acme.com', target: 'github',
      githubInstallationId: '176399104', enabled: true }],
  });

  const out = await call(handler('get', '/admin/blog-domains'));

  assert.ok(out.html.includes('not set up'));
  assert.ok(out.html.includes('Set up GitHub'));
  assert.ok(!out.html.includes('Run again'));
});

await test('and one that finished says when, and offers a re-run instead', async () => {
  install({
    domains: [{ _id: 'd1', domain: 'acme.com', target: 'github',
      githubInstallationId: '176399104', enabled: true,
      githubSetupAt: new Date('2026-10-31T00:00:00Z'), githubSetupOk: true }],
  });

  const out = await call(handler('get', '/admin/blog-domains'));

  assert.ok(out.html.includes('set up'), 'the row does not say it is set up');
  assert.ok(out.html.includes('Run again'));
  assert.ok(!out.html.includes('>Set up GitHub<'));
});

await test('A RUN THAT DID NOT ATTACH THE DOMAIN SAYS PENDING, NOT DONE', async () => {
  /* The job has two halves and only one of them is GitHub's. The custom
   * domain depends on DNS at a registrar this app has never heard of, and
   * commonly fails the first time — so "it ran" and "it finished" are
   * different facts, and a row that said "set up" for both would be the
   * same lie the old button told by saying nothing. */
  install({
    domains: [{ _id: 'd1', domain: 'acme.com', target: 'github',
      githubInstallationId: '176399104', enabled: true,
      githubSetupAt: new Date('2026-10-31T00:00:00Z'), githubSetupOk: false }],
  });

  const out = await call(handler('get', '/admin/blog-domains'));

  assert.ok(out.html.includes('domain pending'));
  assert.ok(out.html.includes('Run again'));
});

await test('and a Cloudflare row has no GitHub column content at all', async () => {
  install({
    domains: [{ _id: 'd1', domain: 'acmehvac.com', account: 'acct-3', enabled: true }],
  });

  const out = await call(handler('get', '/admin/blog-domains'));

  assert.ok(!out.html.includes('not set up'));
  assert.ok(!out.html.includes('setup-github'));
  assert.ok(!out.html.includes('recheck-github'));
});

await test('A GITHUB ROW ALSO OFFERS THE RE-CHECK, WHICH THE OTHER BUTTON CANNOT DO', async () => {
  /* GitHub checks a custom domain's DNS when the domain is SET and never
   * again. A client sets it here and edits their registrar afterwards, so
   * the check runs against records that do not exist, fails, and no
   * certificate is ever requested — 2-r.net sat that way for five hours.
   * "Run again" writes the same cname back, which is not a change, so
   * nothing looks again. Only clearing it first does. */
  install({
    domains: [{ _id: 'd1', domain: 'acme.com', target: 'github',
      githubInstallationId: '176399104', enabled: true }],
  });

  const out = await call(handler('get', '/admin/blog-domains'));

  assert.ok(out.html.includes('/recheck-github'), 'there is no way to re-check DNS');
  assert.ok(out.html.includes('Re-check DNS'));
});

await test('and it warns that every site on the domain goes down for a few seconds', async () => {
  /* The re-check clears the custom domain before setting it back, and the
   * domain serves nothing in between. A disruptive button that looks like
   * the safe one beside it is a button somebody presses on a Tuesday
   * afternoon without knowing. */
  install({
    domains: [{ _id: 'd1', domain: 'acme.com', target: 'github',
      githubInstallationId: '176399104', enabled: true }],
  });

  const out = await call(handler('get', '/admin/blog-domains'));

  const form = out.html.slice(out.html.indexOf('/recheck-github'));
  const ask = /data-confirm="([^"]+)"/.exec(form);

  assert.ok(ask, 'the re-check submits without asking');
  assert.ok(/404|down/i.test(ask[1]), 'the confirmation does not mention the outage');
  assert.ok(ask[1].includes('acme.com'), 'the confirmation does not name the domain');
});

/* ------------------------------------------------------------------------
 * The table fitting on the screen
 * --------------------------------------------------------------------- */

section('THE TABLE HAS TO FIT');

/** The domains table alone — the page draws an accounts table above it. */
function domainsTable(html) {
  const from = html.indexOf('>Domains<');
  assert.ok(from > 0, 'the Domains heading is not on the page');

  const open = html.indexOf('<table', from);
  const shut = html.indexOf('</table>', open);

  assert.ok(open > 0 && shut > open, 'there is no domains table');

  return html.slice(open, shut);
}

await test('AN ACCOUNT NAME WITH NO SPACES IN IT IS ALLOWED TO WRAP', async () => {
  /* 31 October: the GitHub column was pushed off the right of the screen
   * with its button cut in half. The cause was not the number of columns —
   * it was one cell holding
   * "vickishomecarellc.com-aguirreseconds@gmail.com", a string with no
   * space in it, which a browser will not break. That one cell set a
   * minimum width nothing else could argue with.
   *
   *     A TABLE DOES NOT OVERFLOW BECAUSE IT HAS TOO MANY COLUMNS.
   *     IT OVERFLOWS BECAUSE ONE CELL REFUSES TO GET NARROWER.
   *
   * There is no layout engine here to measure against, so what is checked
   * is that the cell carries the class that permits the break. */
  install({
    domains: [{
      _id: 'd1',
      domain: 'vickishomecarellc.com',
      label: 'vickishomecarellc.com',
      account: 'acct-3',
      enabled: true,
    }],
  });

  const out = await call(handler('get', '/admin/blog-domains'));
  const table = domainsTable(out.html);

  assert.ok(/<td[^>]*\bcol-tight\b/.test(table),
    'the account cell cannot wrap, so a long address pushes the row sideways');
});

await test('and the cell holding the button is told never to wrap', async () => {
  /* The opposite instruction, in the same breath: a control broken across
   * two lines reads as broken software. */
  install({
    domains: [{ _id: 'd1', domain: 'acme.com', target: 'github',
      githubInstallationId: '176399104', enabled: true }],
  });

  const out = await call(handler('get', '/admin/blog-domains'));
  const table = domainsTable(out.html);

  assert.ok(/<td[^>]*\bcol-actions\b/.test(table), 'the button cell may wrap');
});

await test('THE HEADER AND THE ROW AGREE ON HOW MANY COLUMNS THERE ARE', async () => {
  /* The status and the button were two columns saying one thing about one
   * subject, and merging them meant deleting a <th> elsewhere in the file.
   * A row with more cells than headings does not throw — it draws a column
   * with no name over it, which is how the GitHub column came to be the
   * nameless one squeezed off the end. */
  install({
    domains: [
      { _id: 'd1', domain: 'acme.com', target: 'github',
        githubInstallationId: '176399104', enabled: true },
      { _id: 'd2', domain: 'acmehvac.com', account: 'acct-3', enabled: false },
    ],
  });

  const out = await call(handler('get', '/admin/blog-domains'));
  const table = domainsTable(out.html);

  const head = table.slice(table.indexOf('<thead'), table.indexOf('</thead>'));
  const heads = (head.match(/<th\b/g) || []).length;

  assert.ok(heads > 0, 'the table has no headings at all');

  const body = table.slice(table.indexOf('<tbody'));
  const rows = body.split('<tr>').slice(1);

  assert.strictEqual(rows.length, 2, 'the two domains did not both draw a row');

  for (const row of rows) {
    const cells = (row.match(/<td\b/g) || []).length;

    assert.strictEqual(cells, heads,
      `a row draws ${cells} cells under ${heads} headings`);
  }
});

await test('and the table is allowed to scroll rather than be clipped', async () => {
  /* The floor, not the fix. col-tight is what keeps it fitting; this is
   * what makes the day somebody adds a ninth column a scroll bar, rather
   * than a button nobody can reach with nothing on the page admitting it
   * is there. */
  install({
    domains: [{ _id: 'd1', domain: 'acme.com', target: 'github',
      githubInstallationId: '176399104', enabled: true }],
  });

  const out = await call(handler('get', '/admin/blog-domains'));

  assert.ok(out.html.includes('table-responsive'), 'an overflow would be clipped');
});

/* ------------------------------------------------------------------------
 * The record without which nothing resolves
 * --------------------------------------------------------------------- */

section('THE WILDCARD IS ON THE SCREEN');

/* THE DETOUR THIS EXISTS TO PREVENT — 1 November. Sites moved to a subdomain
 * each. The registrar table went on printing the apex A records, the AAAA
 * records and www, which was the complete list for the shape before. Edwin
 * built a site onto 7-y.xyz, which had every record the screen named. The
 * build succeeded, the repository was correct, the CNAME file was in it, and
 * the address answered DNS_PROBE_FINISHED_NXDOMAIN.
 *
 *     A SCREEN THAT LISTS THE RECORDS AND OMITS THE ONE THAT MATTERS
 *     IS WORSE THAN A SCREEN THAT LISTS NONE. IT READS AS FINISHED.
 *
 * THE TABLE IS TESTED DIRECTLY because the handler around it requires
 * setupDomain() and that call reaches github.com — the success path of that
 * route has never been reachable from a suite, which is precisely how the
 * table drifted unnoticed. */
const { dnsTable } = require('./routes/blogDomainsRoute');

const DNS = {
  wildcard: { type: 'CNAME', host: '*', value: 'acme.github.io',
    why: 'Every site on this domain. Without it nothing you build here resolves.' },
  apex: { type: 'A', host: '@', values: ['185.199.108.153', '185.199.109.153'],
    why: 'The domain on its own, which serves the holding page.' },
  apexIpv6: { type: 'AAAA', host: '@', values: ['2606:50c0:8000::153'],
    why: 'The same, for IPv6. Optional.' },
  www: { type: 'CNAME', host: 'www', value: 'acme.github.io',
    why: 'Only if the domain should answer with www in front of it.' },
};

await test('THE WILDCARD IS PRINTED, AND IT IS PRINTED FIRST', async () => {
  const html = dnsTable(DNS);

  assert.ok(html.includes('<code>*</code>'), 'the wildcard row is not on the screen');

  /* FIRST IN THE TABLE. Among look-alike rows, the one that cannot be
   * skipped reads as the fourth of four optional things. */
  assert.ok(
    html.indexOf('<code>*</code>') < html.indexOf('<code>@</code>'),
    'the wildcard is printed below the apex records');
});

await test('and it says what happens without it', async () => {
  const html = dnsTable(DNS);

  assert.ok(/nothing you build/i.test(html),
    'the screen does not say what happens without the wildcard');

  /* AND THE APEX SAYS IT IS NOT THE SITES. The two are easy to confuse, and
   * deleting either because it looked redundant is the next version of this
   * failure. */
  assert.ok(/holding page/i.test(html), 'the apex row does not say what it serves');
});

await test('THE ONE THAT CANNOT BE SKIPPED IS MARKED, NOT JUST ORDERED', async () => {
  /* Order alone is a convention a reader has to notice. */
  const html = dnsTable(DNS);
  const first = html.slice(html.indexOf('<tbody'), html.indexOf('<code>@</code>'));

  assert.ok(/text-warning/.test(first), 'the wildcard row is not marked');
});

await test('and a record that is missing renders nothing, not undefined', async () => {
  /* A table built from a `dns` object that predates a field must not print
   * "undefined" into a row a customer is about to copy into a registrar. */
  const html = dnsTable({ apex: DNS.apex });

  assert.ok(!/undefined/.test(html), 'a missing record printed undefined');
  assert.ok(html.includes('<code>@</code>'), 'the record that was there did not print');
  assert.ok(!html.includes('<code>*</code>'));

  assert.ok(!/undefined/.test(dnsTable({})), 'an empty dns object printed undefined');
  assert.ok(!/undefined/.test(dnsTable()), 'no dns object at all printed undefined');
});

await test('AND A SINGLE-VALUE RECORD PRINTS ONE VALUE, NOT A LIST OF ONE', async () => {
  /* `values` for the A records, `value` for the CNAMEs. Reading only one of
   * the two is how half the table would come out blank. */
  const html = dnsTable(DNS);

  assert.ok(html.includes('<code>acme.github.io</code>'));
  assert.ok(html.includes('<code>185.199.108.153</code>'));
  assert.ok(html.includes('<code>185.199.109.153</code>'), 'the second A record is missing');
});

/* ========================================================================
 * RENAMING AN ACCOUNT
 * ===================================================================== */

section('RENAMING AN ACCOUNT');

/* WHY THIS EXISTS — Edwin, 8 November. Eight accounts, most named after a
 * domain or an email, in a dropdown labelled "Cloudflare account": it reads
 * as a list of domains and is a list of accounts. */

await test('THE LABEL CHANGES AND NOTHING ELSE DOES', async () => {
  install({ accounts: [ACCOUNT] });

  await call(handler('post', '/admin/blog-domains/accounts/:id/label'),
    req({ params: { id: 'acct-3' }, body: { label: 'Bryan — u-sites' } }));

  assert.strictEqual(db.updates.length, 1, 'nothing was written');

  const { update } = db.updates[0];

  assert.deepStrictEqual(Object.keys(update.$set), ['label'],
    `a rename wrote more than the label: ${Object.keys(update.$set).join(', ')}`);

  assert.strictEqual(update.$set.label, 'Bryan — u-sites');
});

await test('AND IT IS WRITTEN BY _id, SO NOTHING IS RE-POINTED', async () => {
  /* Domain.account and BlogSite.cloudflareAccount hold this row's _id. A
   * rename that touched it would orphan every reference — credsForAccountId
   * throws "a Cloudflare account that no longer exists" and the blog cannot
   * deploy. The obvious fear about a rename, so it is asserted. */
  install({ accounts: [ACCOUNT] });

  await call(handler('post', '/admin/blog-domains/accounts/:id/label'),
    req({ params: { id: 'acct-3' }, body: { label: 'Renamed' } }));

  assert.deepStrictEqual(db.updates[0].where, { _id: 'acct-3' });
});

await test('AN EMPTY NAME IS REFUSED', async () => {
  /* The label is how every other screen identifies this row — the
   * dropdowns, the removal guard's sentence, the error credsFor() throws.
   * A blank one is a blank option in a list of eight. */
  for (const label of ['', '   ', undefined]) {
    install({ accounts: [ACCOUNT] });

    const out = await call(handler('post', '/admin/blog-domains/accounts/:id/label'),
      req({ params: { id: 'acct-3' }, body: { label } }));

    assert.strictEqual(out.status, 400, `"${label}" was accepted`);
    assert.strictEqual(db.updates.length, 0, `"${label}" was written`);
  }
});

await test('AND THE SAME NAME WRITES NOTHING', async () => {
  install({ accounts: [ACCOUNT] });

  await call(handler('post', '/admin/blog-domains/accounts/:id/label'),
    req({ params: { id: 'acct-3' }, body: { label: ACCOUNT.label } }));

  assert.strictEqual(db.updates.length, 0, 'an unchanged name was written anyway');
});

await test('AN ACCOUNT THAT IS NOT THERE IS REFUSED', async () => {
  install({ accounts: [] });

  const out = await call(handler('post', '/admin/blog-domains/accounts/:id/label'),
    req({ params: { id: 'nope' }, body: { label: 'New name' } }));

  assert.strictEqual(out.status, 400);
  assert.strictEqual(db.updates.length, 0);
});

const SECOND = { _id: 'acct-9', label: 'Bryan — u-sites', accountId: 'd'.repeat(32), tokenLast4: 'xxxx', enabled: true, projects: 2 };

await test('A NAME ANOTHER ACCOUNT ALREADY HAS IS REFUSED', async () => {
  /* The label is the ONLY thing the dropdowns show. Two rows sharing one
   * means an admin picks between them by guesswork — and picking wrong
   * binds a customer's domain to the wrong Cloudflare account, so their
   * site publishes into somebody else's. */
  install({ accounts: [ACCOUNT, SECOND] });

  const out = await call(handler('post', '/admin/blog-domains/accounts/:id/label'),
    req({ params: { id: 'acct-3' }, body: { label: SECOND.label } }));

  assert.strictEqual(out.status, 400);
  assert.strictEqual(db.updates.length, 0, 'a duplicate name was written');
  assert.ok(/already used/i.test(out.html), out.html.slice(0, 200));
});

await test('AND SO IS ONE THAT DIFFERS ONLY IN CASE OR SPACING', async () => {
  /* "Bryan" and "bryan" are the same guess in a dropdown, and a trailing
   * space is invisible in one. */
  for (const label of ['bryan — u-sites', 'BRYAN — U-SITES', '  Bryan — u-sites  ']) {
    install({ accounts: [ACCOUNT, SECOND] });

    const out = await call(handler('post', '/admin/blog-domains/accounts/:id/label'),
      req({ params: { id: 'acct-3' }, body: { label } }));

    assert.strictEqual(out.status, 400, `"${label}" was accepted`);
    assert.strictEqual(db.updates.length, 0, `"${label}" was written`);
  }
});

await test('BUT AN ACCOUNT MAY CORRECT ITS OWN CAPITALISATION', async () => {
  /* Excluded by _id, so a row is never a clash with itself. Without that,
   * fixing your own name is impossible — the only error being your own
   * existence. */
  install({ accounts: [ACCOUNT, SECOND] });

  await call(handler('post', '/admin/blog-domains/accounts/:id/label'),
    req({ params: { id: 'acct-3' }, body: { label: ACCOUNT.label.toUpperCase() } }));

  assert.strictEqual(db.updates.length, 1, 'an account could not re-case its own name');
  assert.strictEqual(db.updates[0].$set ? db.updates[0].$set.label : db.updates[0].update.$set.label,
    ACCOUNT.label.toUpperCase());
});

await test('A NAME WITH REGEX CHARACTERS IS TEXT, NOT A PATTERN', async () => {
  /* `Acme (US)` is an ordinary name and also a regex with a group in it.
   * `.*` as a label would match every account and block every rename. */
  const odd = { _id: 'acct-7', label: 'Acme (US) [prod]', accountId: 'e'.repeat(32), enabled: true, projects: 0 };

  install({ accounts: [ACCOUNT, odd] });

  const out = await call(handler('post', '/admin/blog-domains/accounts/:id/label'),
    req({ params: { id: 'acct-3' }, body: { label: 'Acme (US) [prod]' } }));

  assert.strictEqual(out.status, 400, 'an exact duplicate with regex characters was accepted');

  install({ accounts: [ACCOUNT, odd] });

  await call(handler('post', '/admin/blog-domains/accounts/:id/label'),
    req({ params: { id: 'acct-3' }, body: { label: 'Acme US prod' } }));

  assert.strictEqual(db.updates.length, 1,
    'a name was refused because another account\'s name was read as a pattern');
});

await test('A NAME THAT MERELY OVERLAPS ANOTHER IS ALLOWED', async () => {
  /* THE ANCHORS IN THE PATTERN. Without `^` and `$`, "Bryan" clashes with
   * "Bryan — u-sites" and the admin is told a name is taken that nobody
   * has. They are different names; only an identical one is a duplicate. */
  install({ accounts: [ACCOUNT, SECOND] });

  await call(handler('post', '/admin/blog-domains/accounts/:id/label'),
    req({ params: { id: 'acct-3' }, body: { label: 'Bryan' } }));

  assert.strictEqual(db.updates.length, 1,
    '"Bryan" was refused because "Bryan — u-sites" exists');

  install({ accounts: [ACCOUNT, SECOND] });

  await call(handler('post', '/admin/blog-domains/accounts/:id/label'),
    req({ params: { id: 'acct-3' }, body: { label: 'Bryan — u-sites extra' } }));

  assert.strictEqual(db.updates.length, 1,
    'a longer name containing an existing one was refused');
});

await test('AND THE ADD FORM REFUSES A DUPLICATE NAME TOO', async () => {
  /* Guarding only the rename would be half a rule: the add form is where
   * eight accounts got their names in the first place. */
  install({ accounts: [ACCOUNT] });

  const out = await call(handler('post', '/admin/blog-domains/accounts'),
    req({ body: { label: ACCOUNT.label, accountId: 'f'.repeat(32), token: TOKEN } }));

  assert.strictEqual(out.status, 400);
  assert.strictEqual(db.created, null, 'a second account took an existing name');
  assert.ok(/already used/i.test(out.html));
});

await test('AND THE ADD FORM TRIMS THE NAME BEFORE IT COMPARES OR STORES IT', async () => {
  /* A trailing space is invisible in a dropdown, so " Client 3" and
   * "Client 3" are the same guess — and a label stored with one sorts and
   * reads oddly for ever after. */
  install({ accounts: [ACCOUNT] });

  const padded = await call(handler('post', '/admin/blog-domains/accounts'),
    req({ body: { label: `  ${ACCOUNT.label}  `, accountId: 'f'.repeat(32), token: TOKEN } }));

  assert.strictEqual(padded.status, 400, 'a padded duplicate name was accepted');
  assert.strictEqual(db.created, null);

  install({ accounts: [] });

  await call(handler('post', '/admin/blog-domains/accounts'),
    req({ body: { label: '  Fresh Name  ', accountId: 'f'.repeat(32), token: TOKEN } }));

  assert.ok(db.created, 'nothing was created');
  assert.strictEqual(db.created.label, 'Fresh Name', 'the stored name kept its padding');
});

await test('THE FORM IS ON THE PAGE, AND IT IS NOT THE TOKEN FORM', async () => {
  /* TWO <details>, NOT ONE. A rename needs no Cloudflare call; replacing a
   * token makes one and refuses the whole submission if it fails. Together,
   * a correct new name is rejected by an unrelated token check — and the
   * form asks for a token from somebody who only wanted to fix a name. */
  install({ accounts: [ACCOUNT] });

  const out = await call(handler('get', '/admin/blog-domains'));

  assert.ok(out.html.includes('action="/admin/blog-domains/accounts/acct-3/label"'),
    'nothing on the page posts to the rename handler');

  assert.ok(out.html.includes('action="/admin/blog-domains/accounts/acct-3/token"'),
    'the token form went missing');

  /* AND THE NAME IS PREFILLED, so a rename is an edit rather than a retype.
   * At eight accounts, retyping is how two end up with the same name. */
  assert.ok(new RegExp(`id="label-acct-3"[^>]*value="${ACCOUNT.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(out.html)
         || out.html.includes(`value="${ACCOUNT.label}"`),
    'the rename box does not start from the current name');
});

/* ========================================================================
 * DOMAINS FOR CLOUDFLARE WEBSITES, SEVERAL AT A TIME
 * ===================================================================== */

section('ADDING DOMAINS FOR CLOUDFLARE WEBSITES');

/* WHAT THIS SECTION IS ABOUT. Edwin, 5 November: *"I will add multiple
 * domains at once so I can have different options to choose from."* So the
 * handler is a batch, and a batch has failure modes a single add does not:
 * a line that is not a domain, a line already in the pool, a line whose
 * zone is on another account, and the same line twice. Every one of them
 * must be REPORTED rather than dropped — a batch that quietly adds nine of
 * twelve is one somebody finds out about from a short dropdown.
 *
 * listZones IS STUBBED HERE AND NOT IN install(), because only this handler
 * calls it. Unstubbed it would make a live HTTPS call to Cloudflare and hang
 * inside ./deploy.sh — the same trap the top of this file records. */
function installZones(names, over = {}) {
  install(over);

  db.zonesAnswer = Object.prototype.hasOwnProperty.call(over, 'zonesAnswer')
    ? over.zonesAnswer
    : { ok: true, names };

  db.zoneListCalls = 0;
  cfDeploy.listZones = async () => { db.zoneListCalls += 1; return db.zonesAnswer; };

  /* EVERY CREATE IS KEPT, not just the last one. db.createdDomain holds one
   * row, which is all a single add ever makes; a batch that overwrote it
   * would be asserted against its final line only. */
  db.createdDomains = [];
  Domain.create = async (doc) => {
    db.createdDomain = doc;
    db.createdDomains.push(doc);
    db.domains.push(doc);
    return { _id: `new-${doc.domain}`, ...doc };
  };
}

await test('SEVERAL DOMAINS IN ONE POST, ALL TARGETED AT WEBSITES', async () => {
  installZones(['acmesites.com', 'clientsites.net'], { accounts: [ACCOUNT] });

  const out = await call(handler('post', '/admin/blog-domains/cf-site-domains'),
    req({ body: { domains: 'acmesites.com\nclientsites.net', account: 'acct-3' } }));

  assert.strictEqual(out.status, 200);
  assert.deepStrictEqual(db.createdDomains.map(d => d.domain),
    ['acmesites.com', 'clientsites.net']);

  for (const doc of db.createdDomains) {
    /* 'cfsite', NOT 'cloudflare'. A batch stored with the default target
     * would appear in the BLOG dropdown, which is the one thing Edwin
     * asked this feature not to do. */
    assert.strictEqual(doc.target, 'cfsite', `${doc.domain} went to the wrong dropdown`);
    assert.strictEqual(String(doc.account), 'acct-3');
  }
});

await test('AND THE ZONES ARE CHECKED ONCE FOR THE BATCH, NOT ONCE PER DOMAIN', async () => {
  /* The single-add form calls findZone(), which walks the labels one API
   * request at a time. Twelve domains would be twelve walks. This lists the
   * account's zones once and matches locally — which is what listZones()'
   * own comment asked the next caller to do rather than write a third
   * copy. */
  installZones(['a.com', 'b.com', 'c.com'], { accounts: [ACCOUNT] });

  await call(handler('post', '/admin/blog-domains/cf-site-domains'),
    req({ body: { domains: 'a.com\nb.com\nc.com', account: 'acct-3' } }));

  assert.strictEqual(db.createdDomains.length, 3);
  assert.strictEqual(db.zoneListCalls, 1, `the zone list was fetched ${db.zoneListCalls} times`);
  assert.strictEqual(db.zoneCalls.length, 0, 'it walked the labels per domain as well');
});

await test('A ZONE NOT ON THAT ACCOUNT IS REFUSED AND NAMED, AND THE REST GO IN', async () => {
  /* REFUSED RATHER THAN WARNED, for the reason the blog form gives: the
   * pool exists precisely because the zone is on the same account as the
   * Pages project, which is what makes Cloudflare write the DNS record
   * itself. A row where that is untrue turns the automatic half of the
   * product off for every site ever created on it.
   *
   * AND THE REST STILL GO IN. One bad line in a batch of ten is not a
   * reason to make somebody retype the other nine. */
  installZones(['acmesites.com'], { accounts: [ACCOUNT], zone: { ok: false, noZone: true, error: 'no zone' } });

  const out = await call(handler('post', '/admin/blog-domains/cf-site-domains'),
    req({ body: { domains: 'acmesites.com\nsomebodyelse.com', account: 'acct-3' } }));

  assert.deepStrictEqual(db.createdDomains.map(d => d.domain), ['acmesites.com']);
  assert.ok(/somebodyelse\.com/.test(out.html), 'the refused domain was not named');
  assert.ok(/Not a zone on that Cloudflare account/i.test(out.html));
});

await test('AND A MISS IS CONFIRMED BEFORE IT IS REFUSED, BECAUSE THE LIST MAY BE SHORT', async () => {
  /* listZones() ASKS FOR per_page=50. An account with more zones than that
   * returns a TRUNCATED list — and a domain missing from a truncated list
   * is not a domain that is absent. Refusing on that would reject correct
   * domains on exactly the accounts where the mistake costs most.
   *
   *     A LIST THAT MIGHT BE INCOMPLETE CANNOT BE USED
   *     TO PROVE SOMETHING IS NOT IN IT.
   *
   * Here the list does not have it and findZone does. It must be added. */
  installZones(['something-else.com'], {
    accounts: [ACCOUNT],
    zone: { ok: true, id: 'z9', name: 'acmesites.com' },
  });

  await call(handler('post', '/admin/blog-domains/cf-site-domains'),
    req({ body: { domains: 'acmesites.com', account: 'acct-3' } }));

  assert.strictEqual(db.zoneCalls.length, 1, 'a miss was refused without being confirmed');
  assert.deepStrictEqual(db.createdDomains.map(d => d.domain), ['acmesites.com']);
});

await test('A DOMAIN ALREADY IN THE POOL IS LEFT EXACTLY AS IT WAS', async () => {
  /* ONE ROW PER DOMAIN ACROSS ALL THREE PRODUCTS. The dangerous version of
   * this handler would $set target:'cfsite' on a row that is somebody's
   * blog domain — moving every blog on it into a dropdown that cannot
   * publish blogs, with nothing on screen to say so. */
  const existing = { _id: 'dom-1', domain: 'acmehvac.com', account: 'acct-3', enabled: true };

  installZones(['acmehvac.com', 'acmesites.com'], { accounts: [ACCOUNT], domains: [existing] });

  const out = await call(handler('post', '/admin/blog-domains/cf-site-domains'),
    req({ body: { domains: 'acmehvac.com\nacmesites.com', account: 'acct-3' } }));

  assert.deepStrictEqual(db.createdDomains.map(d => d.domain), ['acmesites.com']);
  assert.strictEqual(existing.target, undefined, 'an existing blog domain was re-targeted');
  assert.ok(/Already in the pool/i.test(out.html), 'the skip was not reported');
  assert.ok(/acmehvac\.com/.test(out.html));
});

await test('LINES THAT ARE NOT DOMAINS ARE NAMED, NOT DROPPED', async () => {
  /* A paste out of a spreadsheet brings commas, quotes and blank lines with
   * it. A batch that silently drops three of twelve rows is a batch
   * somebody finds out about from an empty dropdown. */
  installZones(['acmesites.com'], { accounts: [ACCOUNT] });

  const out = await call(handler('post', '/admin/blog-domains/cf-site-domains'),
    req({ body: { domains: 'acmesites.com\nnot a domain\nhttp://\n\n  ', account: 'acct-3' } }));

  assert.deepStrictEqual(db.createdDomains.map(d => d.domain), ['acmesites.com']);
  assert.ok(/Not usable as a domain/i.test(out.html), 'the bad lines were swallowed');
  assert.ok(/not a domain/.test(out.html), 'the bad line was not quoted back');
});

await test('A URL OR A TRAILING DOT IS NORMALISED RATHER THAN REFUSED', async () => {
  installZones(['acmesites.com'], { accounts: [ACCOUNT] });

  await call(handler('post', '/admin/blog-domains/cf-site-domains'),
    req({ body: { domains: 'https://acmesites.com/\n', account: 'acct-3' } }));

  assert.deepStrictEqual(db.createdDomains.map(d => d.domain), ['acmesites.com']);
});

await test('THE SAME DOMAIN TWICE IN ONE BATCH IS ADDED ONCE, QUIETLY', async () => {
  /* Added once and then reported as "already in the pool" would be
   * technically true and a confusing thing to read about a line you just
   * typed yourself. */
  installZones(['acmesites.com'], { accounts: [ACCOUNT] });

  const out = await call(handler('post', '/admin/blog-domains/cf-site-domains'),
    req({ body: { domains: 'acmesites.com\nACMESITES.COM\n', account: 'acct-3' } }));

  assert.deepStrictEqual(db.createdDomains.map(d => d.domain), ['acmesites.com']);
  assert.ok(!/Already in the pool/i.test(out.html), 'it complained about a line it deduped');
});

await test('A ZONE CHECK THAT COULD NOT RUN ADDS THEM AND SAYS SO', async () => {
  /* A FAILURE TO ASK IS NOT AN ANSWER. If the token cannot read zones,
   * refusing would block correct domains over a permissions problem on the
   * account's own row — which is fixed two sections up this same screen. */
  installZones([], { accounts: [ACCOUNT], zonesAnswer: { ok: false, error: 'Zone:Read missing' } });

  const out = await call(handler('post', '/admin/blog-domains/cf-site-domains'),
    req({ body: { domains: 'acmesites.com\nclientsites.net', account: 'acct-3' } }));

  assert.strictEqual(db.createdDomains.length, 2, 'a permissions problem refused correct domains');
  assert.ok(/could not be completed/i.test(out.html), 'the page claimed the check passed');
  assert.ok(/Zone:Read missing/.test(out.html));
});

await test('AND NEITHER THE TOKEN NOR THE ACCOUNT ID REACHES THAT PAGE', async () => {
  /* THE CREDENTIAL THE HANDLER IS HOLDING, not some other token — which
   * this test learned by failing. The first version injected the add-form's
   * TOKEN constant into Cloudflare's error and asserted it was removed, and
   * of course it was not: scrub() redacts the values it is GIVEN, and the
   * handler gives it the creds it made the call with. A test asserting that
   * an unrelated secret is removed would be asserting that scrub() searches
   * for anything token-shaped, which it does not and should not.
   *
   * What matters is that the pair in hand is redacted, because that is the
   * pair Cloudflare's own error messages echo back. */
  const leaky = { token: 'cf-live-abcdefghijklmnop', account: ACCOUNT_ID };

  installZones([], {
    accounts: [ACCOUNT],
    creds: leaky,
    zonesAnswer: {
      ok: false,
      error: `token ${leaky.token} on account ${leaky.account} cannot read zones`,
    },
  });

  const out = await call(handler('post', '/admin/blog-domains/cf-site-domains'),
    req({ body: { domains: 'acmesites.com', account: 'acct-3' } }));

  assert.ok(!out.html.includes(leaky.token), 'a live Cloudflare token reached the page');
  assert.ok(!out.html.includes(leaky.account), 'the account id reached the page');
  assert.ok(/could not be completed/i.test(out.html), 'it scrubbed the message out of existence');
});

await test('A CREDENTIAL THAT WILL NOT RESOLVE DOES NOT STOP THE BATCH EITHER', async () => {
  installZones([], { accounts: [ACCOUNT], credsError: 'That account is disabled (Client 3).' });

  const out = await call(handler('post', '/admin/blog-domains/cf-site-domains'),
    req({ body: { domains: 'acmesites.com', account: 'acct-3' } }));

  assert.strictEqual(db.createdDomains.length, 1);
  assert.ok(/could not be completed/i.test(out.html));
  assert.strictEqual(db.zoneListCalls, 0, 'it asked Cloudflare with no credentials');
});

await test('AN ACCOUNT THAT IS NOT THERE ADDS NOTHING', async () => {
  installZones([], { accounts: [] });

  const out = await call(handler('post', '/admin/blog-domains/cf-site-domains'),
    req({ body: { domains: 'acmesites.com', account: 'nope' } }));

  assert.strictEqual(out.status, 400);
  assert.strictEqual(db.createdDomains.length, 0);
});

await test('AND NO ACCOUNT AT ALL IS A SENTENCE, NOT A CAST ERROR', async () => {
  /* The field is a required select, so an empty one only arrives on a
   * posted request — which is to say, from anybody.
   *
   * THIS TEST WAS WRONG AND MUTATION TESTING SAID SO. Written against the
   * ordinary findById stub, deleting the `!accountId` guard changed
   * nothing: the stub answers undefined for '' and the next check — "that
   * account is not here" — produced the same 400. The test passed for a
   * reason that does not exist in production.
   *
   * REAL MONGOOSE THROWS A CastError on an id that is not an ObjectId, and
   * an unhandled throw in here is a 500 with "We could not add those
   * domains" — no mention of the account, on a form the admin has already
   * left. So the stub is made to behave like the real thing for the one
   * input this guard exists to catch.
   *
   *     A GUARD WHOSE REMOVAL CHANGES NOTHING IS NOT PROVEN
   *     BY A TEST THAT PASSES EITHER WAY. */
  installZones([], { accounts: [ACCOUNT] });

  CloudflareAccount.findById = async (id) => {
    if (!/^[a-f0-9]{24}$|^acct-/.test(String(id || ''))) {
      const err = new Error(`Cast to ObjectId failed for value "${id}"`);
      err.name = 'CastError';
      throw err;
    }
    return db.accounts.find(a => String(a._id) === String(id)) || null;
  };

  const out = await call(handler('post', '/admin/blog-domains/cf-site-domains'),
    req({ body: { domains: 'acmesites.com' } }));

  assert.strictEqual(out.status, 400, 'an empty account select produced a 500');
  assert.ok(/no account/i.test(out.html), 'the page does not say what is missing');
  assert.strictEqual(db.createdDomains.length, 0);
});

await test('A BATCH LONGER THAN 50 IS CAPPED AND THE CAP IS REPORTED', async () => {
  /* A pasted file must not become a job: 300 lines is 300 Mongo lookups and
   * up to 300 findZone walks, from one button. */
  const many = Array.from({ length: 60 }, (_, i) => `site${i}.com`).join('\n');

  installZones(Array.from({ length: 60 }, (_, i) => `site${i}.com`), { accounts: [ACCOUNT] });

  const out = await call(handler('post', '/admin/blog-domains/cf-site-domains'),
    req({ body: { domains: many, account: 'acct-3' } }));

  assert.strictEqual(db.createdDomains.length, 50);
  assert.ok(/10 further lines/.test(out.html), 'the ignored lines were not mentioned');
});

await test('THE FORM IS ON THE POOL PAGE, AND SAYS WHICH DROPDOWN IT FEEDS', async () => {
  /* THE WIRING, WHICH IS THE GAP THIS PROJECT KEEPS FINDING. A handler with
   * no form posting to it is a feature that exists and cannot be reached —
   * the failure appSidebar()'s own comment describes, and the one Edwin had
   * to ask about the day Static Blogs shipped. */
  install({ accounts: [ACCOUNT] });

  const out = await call(handler('get', '/admin/blog-domains'));

  assert.ok(out.html.includes('action="/admin/blog-domains/cf-site-domains"'),
    'nothing on the pool page posts to the websites-domain handler');
  assert.ok(/name="domains"/.test(out.html), 'the batch field is missing');
  assert.ok(/never in the blogs dropdown/i.test(out.html),
    'the form does not say the two lists are separate');
});

await test('AND A WEBSITES DOMAIN IS BADGED APART FROM BOTH OTHER KINDS', async () => {
  /* Three kinds in one table. "websites" alone is now ambiguous between two
   * products that both publish websites, so both say where they publish. */
  install({
    accounts: [ACCOUNT],
    domains: [
      { _id: 'd1', domain: 'blogs.com', target: 'cloudflare', account: 'acct-3', enabled: true },
      { _id: 'd2', domain: 'gh.com', target: 'github', githubInstallationId: '1', enabled: true },
      { _id: 'd3', domain: 'cf.com', target: 'cfsite', account: 'acct-3', enabled: true },
      { _id: 'd4', domain: 'firstweek.com', account: 'acct-3', enabled: true },
    ],
  });

  const out = await call(handler('get', '/admin/blog-domains'));

  const row = (domain) => {
    const at = out.html.indexOf(`<code>${domain}</code>`);
    assert.ok(at > -1, `${domain} is not on the page`);
    return out.html.slice(at, at + 400);
  };

  assert.ok(/CF websites/.test(row('cf.com')), 'a Cloudflare website domain is not badged as one');
  assert.ok(/GitHub websites/.test(row('gh.com')));
  assert.ok(/>blogs</.test(row('blogs.com')));

  /* AND THE OLDEST ROWS, WHICH HAVE NO `target` AT ALL, STILL READ AS
   * BLOGS. A bare `d.target === 'cloudflare'` would badge them "unknown". */
  assert.ok(/>blogs</.test(row('firstweek.com')),
    'a domain added before the field existed is no longer shown as a blog domain');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

})();
