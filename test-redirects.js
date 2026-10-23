// test-redirects.js
//
// One address per article, not two.
//
// WHAT IS BEING GUARDED. This writes to an ACCOUNT-LEVEL list that every
// blog shares. A bug here does not break one blog — it redirects somebody
// else's live site, or deletes the redirect keeping somebody else's site
// off a duplicate address. So most of this file is about the cases where
// it must NOT act.
//
// NO NETWORK. fetch is injected and routes are matched by URL, the same
// shape test-cloudflare-deploy.js uses for the DNS work.

'use strict';

const assert = require('assert');

let passed = 0;
let failed = 0;

const queue = [];
function test(name, fn) {
  queue.push(() => Promise.resolve().then(fn)
    .then(() => { console.log(`  ok    ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }));
}
function section(n) { queue.push(async () => console.log(`\n${n}\n`)); }

process.env.CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || 'acc123';
process.env.CF_API_TOKEN = process.env.CF_API_TOKEN || 'tok123';

const {
  findRedirectList, addRedirect, removeRedirect, waitForOperation,
  redirectPagesDev, releasePagesDev,
} = require('./utils/blog/cloudflare/redirects');

/* ------------------------------------------------------------------ fakes */

/**
 * A fetch that answers by route.
 *
 * Each route is [method, substring, answer]. The answer is the `result`
 * Cloudflare would return, or a function of the parsed body.
 */
function cfFetch(routes) {
  const calls = [];

  const impl = async (url, options = {}) => {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;

    /* THE AUTHORIZATION HEADER IS RECORDED, AND MUTATION IS WHY — 22
     * October. The pool tests below asserted only on URLs, so dropping
     * `creds` from findRedirectList's cfApi options SURVIVED: the path was
     * built from account(creds) and was perfectly right, while the request
     * went out with the SERVER'S token.
     *
     * Right path, wrong token, is the worst shape this can take — it
     * authenticates as us against the customer's account, and Cloudflare
     * answers with a permissions error that reads like a misconfigured
     * token rather than a mixed-up credential. A URL assertion cannot see
     * it. */
    calls.push({ url, method, body, headers: options.headers || {} });

    for (const [m, part, answer] of routes) {
      if (m === method && String(url).includes(part)) {
        const result = typeof answer === 'function' ? answer(body) : answer;

        if (result && result.__status) {
          return { ok: false, status: result.__status,
            json: async () => ({ success: false, errors: [{ message: result.__message, code: result.__code }] }) };
        }

        return { ok: true, status: 200, json: async () => ({ success: true, result }) };
      }
    }

    throw new Error(`no fake route for ${method} ${url}`);
  };

  impl.calls = calls;
  return impl;
}

const LIST = { id: 'list1', name: 'blog_pages_dev', kind: 'redirect' };

/** Routes for a healthy account with one list and the given items. */
function healthy(items = [], over = {}) {
  return cfFetch([
    ['GET', '/rules/lists?', over.lists || [LIST]],
    ['GET', '/rules/lists\u0000', over.lists || [LIST]],
    ['GET', '/bulk_operations/', { status: 'completed' }],
    ['GET', `/rules/lists/${LIST.id}/items`, items],
    ['POST', `/rules/lists/${LIST.id}/items`, { operation_id: 'op1' }],
    ['DELETE', `/rules/lists/${LIST.id}/items`, { operation_id: 'op2' }],
    ['GET', '/rules/lists', over.lists || [LIST]],
  ]);
}

const instant = { sleep: async () => {} };

/* ======================================================================= */

section('FINDING THE LIST');

test('THE LIST IS FOUND BY NAME', async () => {
  const fetchImpl = healthy();
  const out = await findRedirectList({ name: 'blog_pages_dev', fetchImpl });

  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.id, 'list1');
});

test('AND A LIST OF THE WRONG KIND IS NOT IT', async () => {
  /* An account can hold IP lists and ASN lists beside redirect lists. A
   * name collision across kinds would write a redirect into a list that
   * cannot hold one — and the error would arrive later, about a list,
   * a long way from here. */
  const fetchImpl = healthy([], { lists: [{ id: 'x', name: 'blog_pages_dev', kind: 'ip' }] });

  const out = await findRedirectList({ name: 'blog_pages_dev', fetchImpl });

  assert.strictEqual(out.ok, false);
  assert.ok(/No redirect list/.test(out.error));
});

test('AND A MISSING LIST SAYS HOW TO MAKE ONE', async () => {
  /* The rule and the list are created by hand, once. Somebody hitting this
   * has not done that yet, and "not found" would send them to read code. */
  const fetchImpl = healthy([], { lists: [] });

  const out = await findRedirectList({ name: 'blog_pages_dev', fetchImpl });

  assert.strictEqual(out.ok, false);
  assert.ok(/dashboard/i.test(out.error), 'it does not say where to create it');
  assert.ok(/Bulk Redirects/i.test(out.error));
});

test('THE DEFAULT NAME IS ONE CLOUDFLARE WILL ACCEPT', async () => {
  /* IT WAS NOT, AND NOTHING CAUGHT IT. The default was `blog-pages-dev`
   * until Edwin went to create the list and the dashboard refused the
   * hyphens: a list name may hold only lowercase letters, digits and
   * underscores.
   *
   * Every test in this file passed throughout, because they all pass the
   * name in. The one value nobody passes is the default — which is the
   * only one a real install uses. */
  const { LIST_NAME } = require('./utils/blog/cloudflare/redirects');

  assert.ok(/^[a-z0-9_]+$/.test(LIST_NAME),
    `"${LIST_NAME}" is not a name Cloudflare will accept for a list`);
});

section('ADDING THE REDIRECT');

test('THE PARAMETERS ARE SET, NOT LEFT TO THEIR DEFAULTS', async () => {
  /* THE TWO THAT WOULD HAVE FAILED SILENTLY.
   *
   * subpath_matching defaults to FALSE: without it only the home page
   * redirects and every article still serves at two addresses — the exact
   * problem, unsolved, while the log says it was fixed.
   *
   * preserve_query_string defaults to FALSE, so every ?utm_source= would
   * be thrown away on the way through. */
  const fetchImpl = healthy();

  await addRedirect({
    listId: 'list1',
    source: 'a-blog.pages.dev',
    target: 'https://a-blog.example.com',
    fetchImpl,
  });

  const post = fetchImpl.calls.find(c => 'POST' === c.method);
  const redirect = post.body[0].redirect;

  assert.strictEqual(redirect.source_url, 'a-blog.pages.dev');
  assert.strictEqual(redirect.target_url, 'https://a-blog.example.com');
  assert.strictEqual(redirect.status_code, 301, 'a 302 keeps pages.dev in the index');
  assert.strictEqual(redirect.subpath_matching, true, 'only the home page would redirect');
  assert.strictEqual(redirect.preserve_path_suffix, true);
  assert.strictEqual(redirect.preserve_query_string, true);
  assert.strictEqual(redirect.include_subdomains, true, 'the hash addresses still serve the site');
});

test('AND IT WAITS FOR CLOUDFLARE TO APPLY IT', async () => {
  /* Adding an item is ASYNCHRONOUS: the POST returns an operation id and a
   * 200, and the redirect is not live. Returning there would report a
   * success that had not happened — the same shape as `domainAttached:
   * true` beside a DNS record that did not exist. */
  const fetchImpl = healthy();

  const out = await addRedirect({
    listId: 'list1', source: 'a.pages.dev', target: 'https://a.example.com', fetchImpl,
  });

  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.completed, true);
  assert.ok(fetchImpl.calls.some(c => c.url.includes('/bulk_operations/op1')),
    'it never asked whether the change had landed');
});

test('AND A FAILED OPERATION IS A FAILURE, NOT A SUCCESS', async () => {
  const fetchImpl = cfFetch([
    ['POST', '/items', { operation_id: 'op1' }],
    ['GET', '/bulk_operations/', { status: 'failed', error: 'the list is full' }],
  ]);

  const out = await addRedirect({
    listId: 'list1', source: 'a.pages.dev', target: 'https://a.example.com', fetchImpl,
  });

  assert.strictEqual(out.ok, false);
  assert.ok(/list is full/.test(out.error));
});

test('AND A SLOW OPERATION IS NOT A FAILURE', async () => {
  /* It is still running at Cloudflare and will almost certainly finish. We
   * stop watching; we do not call it broken. */
  let t = 0;
  const fetchImpl = cfFetch([
    ['POST', '/items', { operation_id: 'op1' }],
    ['GET', '/bulk_operations/', { status: 'pending' }],
  ]);

  const out = await waitForOperation({
    id: 'op1', fetchImpl, now: () => (t += 10000), ...instant,
  });

  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.completed, false);
  assert.ok(/still applying/i.test(out.note));
});

test('AND NOTHING INCOMPLETE IS SENT', async () => {
  for (const args of [
    { listId: '', source: 'a.pages.dev', target: 'https://a.example.com' },
    { listId: 'list1', source: '', target: 'https://a.example.com' },
    { listId: 'list1', source: 'a.pages.dev', target: '' },
  ]) {
    const fetchImpl = healthy();
    const out = await addRedirect({ ...args, fetchImpl });

    assert.strictEqual(out.ok, false);
    assert.strictEqual(fetchImpl.calls.length, 0, `${JSON.stringify(args)} reached Cloudflare`);
  }
});

section('REMOVING IT, WHICH IS WHERE THE DAMAGE WOULD BE');

test('THE BLOG’S OWN REDIRECT IS REMOVED', async () => {
  const fetchImpl = healthy([
    { id: 'i1', redirect: { source_url: 'a-blog.pages.dev', target_url: 'https://a-blog.example.com' } },
  ]);

  const out = await removeRedirect({
    listId: 'list1', source: 'a-blog.pages.dev', expected: 'https://a-blog.example.com', fetchImpl,
  });

  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.removed, true);

  const del = fetchImpl.calls.find(c => 'DELETE' === c.method);
  assert.deepStrictEqual(del.body, { items: [{ id: 'i1' }] });
});

test('BUT AN ENTRY POINTING SOMEWHERE ELSE IS LEFT ALONE', async () => {
  /* TWO LOCKS, BOTH MUST OPEN — the rule removeDnsRecord() follows. An
   * entry is this blog's only if the SOURCE is this project's pages.dev
   * address AND the TARGET is this blog's domain. Matching the source
   * alone is enough in every case anybody has thought of; the one nobody
   * thought of is the one that deletes a live site's redirect. */
  const fetchImpl = healthy([
    { id: 'i1', redirect: { source_url: 'a-blog.pages.dev', target_url: 'https://somebody-else.com' } },
  ]);

  const out = await removeRedirect({
    listId: 'list1', source: 'a-blog.pages.dev', expected: 'https://a-blog.example.com', fetchImpl,
  });

  assert.strictEqual(out.ok, false);
  assert.ok(/left alone/.test(out.error));
  assert.ok(!fetchImpl.calls.some(c => 'DELETE' === c.method), 'it deleted somebody else’s redirect');
});

test('AND A TRAILING SLASH IS NOT A DIFFERENT DOMAIN', async () => {
  /* The stored target may or may not carry one. Treating those as
   * different would refuse to clean up a blog's own entry, and leave
   * dead redirects accumulating in a shared list for ever. */
  const fetchImpl = healthy([
    { id: 'i1', redirect: { source_url: 'a-blog.pages.dev', target_url: 'https://a-blog.example.com/' } },
  ]);

  const out = await removeRedirect({
    listId: 'list1', source: 'a-blog.pages.dev', expected: 'https://a-blog.example.com', fetchImpl,
  });

  assert.strictEqual(out.ok, true, out.error);
  assert.strictEqual(out.removed, true);
});

test('AND A SOURCE THAT IS NOT THERE IS NOT AN ERROR', async () => {
  /* Deleting a blog whose redirect was never created, or was already
   * tidied, must not report a failure — the end state is the one asked
   * for. */
  const fetchImpl = healthy([
    { id: 'i1', redirect: { source_url: 'other.pages.dev', target_url: 'https://other.com' } },
  ]);

  const out = await removeRedirect({ listId: 'list1', source: 'a-blog.pages.dev', fetchImpl });

  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.removed, false);
  assert.ok(!fetchImpl.calls.some(c => 'DELETE' === c.method));
});

test('AND THE SOURCE MATCHES HOWEVER IT WAS SPELLED', async () => {
  /* FOUND IN PRODUCTION, NOT HERE, AND THAT IS THE POINT OF THE TEST.
   *
   * Deleting all-about-concrete logged `ok: true, removed: false` — the
   * list was read, nothing matched, and the teardown reported success
   * while leaving an entry behind that pointed at a domain with no blog.
   *
   * The entry existed. It was spelled differently: Cloudflare's own docs
   * give source_url as `example.com/blog/` in one example and
   * `https://example.com/blog` in another, and an entry typed into the
   * dashboard carries whatever the person typed. Every case in this file
   * built its own fixtures in the one spelling this code uses, so all of
   * them passed while the real list did not match. */
  for (const stored of [
    'a-blog.pages.dev',
    'https://a-blog.pages.dev',
    'http://a-blog.pages.dev',
    'a-blog.pages.dev/',
    'https://a-blog.pages.dev/',
    '  A-Blog.Pages.Dev/  ',
  ]) {
    const fetchImpl = healthy([
      { id: 'i1', redirect: { source_url: stored, target_url: 'https://a-blog.example.com' } },
    ]);

    const out = await removeRedirect({
      listId: 'list1', source: 'a-blog.pages.dev', expected: 'https://a-blog.example.com', fetchImpl,
    });

    assert.strictEqual(out.removed, true, `a redirect stored as ${JSON.stringify(stored)} was not found`);
  }
});

test('AND THE MATCH IGNORES CASE', async () => {
  const fetchImpl = healthy([
    { id: 'i1', redirect: { source_url: 'A-Blog.Pages.Dev', target_url: 'https://a-blog.example.com' } },
  ]);

  const out = await removeRedirect({
    listId: 'list1', source: 'a-blog.pages.dev', expected: 'https://a-blog.example.com', fetchImpl,
  });

  assert.strictEqual(out.removed, true);
});

section('WHAT THE DEPLOY AND THE DELETE ACTUALLY CALL');

test('THE SOURCE AND TARGET ARE BUILT FROM THE PROJECT AND THE DOMAIN', async () => {
  const fetchImpl = healthy();

  await redirectPagesDev({
    project: 'all-about-concrete-explr-home-com',
    domain: 'all-about-concrete.explr-home.com',
    fetchImpl,
  });

  const post = fetchImpl.calls.find(c => 'POST' === c.method);

  assert.strictEqual(post.body[0].redirect.source_url,
    'all-about-concrete-explr-home-com.pages.dev');
  assert.strictEqual(post.body[0].redirect.target_url,
    'https://all-about-concrete.explr-home.com');
});

test('AND A DOMAIN THAT ALREADY CARRIES A SCHEME IS NOT DOUBLED', async () => {
  const fetchImpl = healthy();

  await redirectPagesDev({ project: 'p', domain: 'https://a.example.com/', fetchImpl });

  const post = fetchImpl.calls.find(c => 'POST' === c.method);
  assert.strictEqual(post.body[0].redirect.target_url, 'https://a.example.com');
});

test('AND A MISSING LIST DOES NOT THROW', async () => {
  /* NEVER FAILS THE DEPLOY. A blog with no redirect is a working blog with
   * a duplicate-content problem; a deploy that died tidying that up is a
   * blog that is not on the internet. */
  const fetchImpl = healthy([], { lists: [] });

  const out = await redirectPagesDev({ project: 'p', domain: 'a.example.com', fetchImpl });

  assert.strictEqual(out.ok, false);
  assert.ok(out.error, 'it failed without saying why');
});

test('AND THE RELEASE GUARDS ON THIS BLOG’S DOMAIN', async () => {
  const fetchImpl = healthy([
    { id: 'i1', redirect: { source_url: 'p.pages.dev', target_url: 'https://not-this-blog.com' } },
  ]);

  const out = await releasePagesDev({ project: 'p', domain: 'a.example.com', fetchImpl });

  assert.strictEqual(out.ok, false);
  assert.ok(!fetchImpl.calls.some(c => 'DELETE' === c.method));
});

section('AND THAT THE DEPLOY AND THE DELETE ACTUALLY CALL IT');

const deploy = require('./utils/blog/cloudflare/deploy');

test('THE FIRST DEPLOY SENDS THE REDIRECT', async () => {
  /* EVERY CASE ABOVE DRIVES THIS MODULE DIRECTLY, so every one of them
   * would still pass with the call missing from deploy.js — and the
   * symptom would be the duplicate-content problem, unfixed, with a full
   * green suite. utils/cleanupScheduler.js is the standing proof that a
   * correct module nobody calls looks exactly like a working one. */
  const calls = [];
  const fetchImpl = cfFetch([
    ['POST', '/domains', { name: 'a.example.com' }],
    ['GET', '/zones?name=', []],
  ]);

  const out = await deploy.pointDomainAtProject({
    project: 'p', domain: 'a.example.com', target: 'p.pages.dev', fetchImpl,
    redirect: async (args) => { calls.push(args); return { ok: true, added: true }; },
  });

  assert.strictEqual(calls.length, 1, 'the first deploy never sends the redirect');
  assert.strictEqual(calls[0].project, 'p');
  assert.strictEqual(calls[0].domain, 'a.example.com');
  assert.ok(out.pagesDev, 'the result does not carry what happened to the redirect');
});

test('AND IT IS SENT EVEN WHEN THE ZONE IS SOMEBODY ELSE\u2019S', async () => {
  /* The redirect is account-level and needs no zone. Ordering it after the
   * zone lookup would skip it for every blog on a domain this account does
   * not host — which still has a pages.dev address serving a copy. */
  const calls = [];
  const fetchImpl = cfFetch([
    ['POST', '/domains', { name: 'a.example.com' }],
    ['GET', '/zones?name=', []],
  ]);

  await deploy.pointDomainAtProject({
    project: 'p', domain: 'a.example.com', target: 'p.pages.dev', fetchImpl,
    redirect: async (args) => { calls.push(args); return { ok: true }; },
  });

  assert.strictEqual(calls.length, 1, 'a blog on an unhosted domain got no redirect');
});

test('AND DELETING A BLOG TAKES THE REDIRECT BACK OUT', async () => {
  const calls = [];
  const fetchImpl = cfFetch([
    ['DELETE', '/domains/', {}],
    ['GET', '/zones?name=', []],
  ]);

  const out = await deploy.releaseDomain({
    project: 'p', domain: 'a.example.com', fetchImpl,
    release: async (args) => { calls.push(args); return { ok: true, removed: true }; },
  });

  assert.strictEqual(calls.length, 1, 'a deleted blog leaves its redirect in the shared list');
  assert.ok(out.pagesDev, 'the teardown result does not say what happened to it');
});

/* ======================================================================= */

section('THE REDIRECT LIST BELONGS TO AN ACCOUNT');

/* STEP FOUR, CONTINUED — redirects.js has its own copy of the account
 * prefix and five call sites of its own.
 *
 * AND A CONSEQUENCE THE REST OF THE POOL WORK DOES NOT HAVE. A Cloudflare
 * rules list lives INSIDE an account. There is no shared `blog_pages_dev`
 * spanning ten accounts — each account needs its own list, created by hand
 * with that name, or the lookup misses.
 *
 * A MISS IS ALREADY SURVIVABLE AND THAT IS WHY THIS IS SAFE. findRedirectList
 * reports rather than throwing: a blog whose account has no list still
 * deploys and still works, it just also answers on pages.dev. So the ten
 * accounts can be set up one at a time rather than all before launch.
 */

const POOL = { token: 'tok-for-client-three', account: 'cccc3333dddd4444eeee5555ffff6666' };

test('THE LIST IS LOOKED UP IN THE ACCOUNT IT IS GIVEN', async () => {
  const fetchImpl = healthy([]);

  await findRedirectList({ fetchImpl, creds: POOL });

  assert.ok(fetchImpl.calls[0].url.includes(POOL.account),
    `it looked in ${fetchImpl.calls[0].url} rather than the client's account`);
  assert.ok(!fetchImpl.calls[0].url.includes('acc123'),
    'the server account id is still in the path');

  /* AND THE TOKEN, NOT ONLY THE PATH. A right path with the server's token
   * authenticates as us against the customer's account. */
  assert.strictEqual(fetchImpl.calls[0].headers.Authorization, `Bearer ${POOL.token}`,
    'the list was looked up with the server token');
});

test('AND IN THE ENVIRONMENT\'S ACCOUNT WHEN IT IS GIVEN NONE', async () => {
  const fetchImpl = healthy([]);

  await findRedirectList({ fetchImpl });

  assert.ok(fetchImpl.calls[0].url.includes('acc123'),
    'the env fallback is gone, so every blog that exists today loses its redirect');
});

test('redirectPagesDev CARRIES THEM THROUGH BOTH OF ITS CALLS', async () => {
  /* Two steps — find the list, then add to it — and forgetting the
   * argument on the second sends the WRITE to the server's account while
   * the lookup went to the client's. The list id would not even exist
   * there, so the failure reads as a missing list rather than as a
   * credential mix-up. */
  const fetchImpl = healthy([]);

  await redirectPagesDev({
    project: 'hvac-acmehvac-com', domain: 'hvac.acmehvac.com', fetchImpl, creds: POOL,
  });

  assert.ok(fetchImpl.calls.length >= 2, 'it did not make the calls it was meant to');

  for (const { url, headers } of fetchImpl.calls) {
    assert.ok(!url.includes('acc123'), `${url} went to the server account`);
    assert.strictEqual(headers.Authorization, `Bearer ${POOL.token}`,
      `${url} was sent with the server token`);
  }
});

test('releasePagesDev DOES TOO', async () => {
  const fetchImpl = healthy([
    { id: 'i1', redirect: { source_url: 'hvac-acmehvac-com.pages.dev',
      target_url: 'https://hvac.acmehvac.com' } },
  ]);

  await releasePagesDev({
    project: 'hvac-acmehvac-com', domain: 'hvac.acmehvac.com', fetchImpl, creds: POOL,
  });

  for (const { url, headers } of fetchImpl.calls) {
    assert.ok(!url.includes('acc123'), `${url} went to the server account`);
    assert.strictEqual(headers.Authorization, `Bearer ${POOL.token}`,
      `${url} was sent with the server token`);
  }
});

test('A POOL ACCOUNT WITH NO LIST IS REPORTED, NOT THROWN', async () => {
  /* THE PROPERTY THAT MAKES TEN ACCOUNTS SET UP ONE AT A TIME POSSIBLE.
   * Each account needs its own blog_pages_dev list, created by hand. Until
   * it exists, the blog must still deploy — it simply also answers on its
   * pages.dev address, which is where every blog started. */
  const fetchImpl = cfFetch([['GET', '/rules/lists', []]]);

  const out = await redirectPagesDev({
    project: 'p', domain: 'hvac.acmehvac.com', fetchImpl, creds: POOL,
  });

  assert.strictEqual(out.ok, false);
  assert.ok(out.error, 'it failed without saying why');
});

/* ======================================================================= */

(async () => {
  for (const run of queue) await run();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
