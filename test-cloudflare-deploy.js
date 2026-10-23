// test-cloudflare-deploy.js
//
// Putting a rendered blog on Cloudflare Pages.
//
// NOTHING HERE SPAWNS WRANGLER OR TOUCHES CLOUDFLARE. The runner is
// injected. A test that shelled out to a real wrangler would need an
// account and a network to run, which means it would not run — and a suite
// that cannot run is a suite that is not protecting anything.
//
// WHAT IS ACTUALLY AT RISK
//
//   THE TOKEN. It is handed to a child process. It must not reach a log
//   line, an error message, a thrown stack, or the child's wider
//   environment. This app's environment also holds the Mongo URI, the
//   OpenAI key and the Stripe secret, and none of those are wrangler's
//   business either.
//
//   THE PATHS. File names come from article slugs, which come from model
//   output. A slug that climbed out of the deploy directory would be this
//   code's fault, not the model's.
//
//   THE CLEANUP. Every deploy writes a temp directory. One left behind per
//   failure fills the same disk that holds every generated website.
//
//   node test-cloudflare-deploy.js

const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const cf = require('./utils/blog/cloudflare/deploy');

let passed = 0, failed = 0;

const queue = [];
function test(name, fn) {
  queue.push(() => Promise.resolve().then(fn)
    .then(() => { console.log(`  ok    ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }));
}
function section(n) { queue.push(async () => console.log(`\n${n}\n`)); }

/* ------------------------------------------------------------------ fakes */

const TOKEN = 'cf-token-pretend-secret-value';
const ACCOUNT = 'abcdef0123456789abcdef0123456789';

/* A BLOG THAT HAS DEPLOYED BEFORE, WHICH IS THE ORDINARY CASE.
 *
 * `project` being set is what tells deployBlog this is not a first
 * deploy — so it skips creating the Pages project and attaching the
 * domain, and makes exactly one wrangler call. Every test below that
 * reads `run.calls[0]` is relying on that.
 *
 * The first deploy has its own section at the end of this file, with
 * FRESH_BLOG and an injected attach(). It is deliberately not the default
 * here: a fixture that did the setup work on every test would make each
 * one assert past two calls it did not care about. */
const BLOG = {
  _id: '507f1f77bcf86cd799439011',
  siteUrl: 'leanderwaterheaters.com',
  project: 'leanderwaterheaters-com',
  business: { name: 'Leander Water Heaters' },
};

/** The same blog before it has ever been published. */
const FRESH_BLOG = {
  _id: '507f1f77bcf86cd799439011',
  siteUrl: 'leanderwaterheaters.com',
  business: { name: 'Leander Water Heaters' },
};

const FILES = {
  'index.html': '<!DOCTYPE html><html><body>home</body></html>',
  'sediment-water-heater-popping/index.html': '<!DOCTYPE html><html><body>post</body></html>',
  'assets/blog.css': 'body { color: #000 }',
  'sitemap.xml': '<?xml version="1.0"?><urlset/>',
  '_data/blog.json': '{"posts":[]}',
};

/** A runner that records what it was asked and answers how it is told. */
function recorder(answer = { code: 0, stdout: 'https://abc123.leanderwaterheaters.pages.dev\n', stderr: '' }) {
  const calls = [];
  const run = async (args, opts) => {
    // The directory only exists while the deploy is in flight, so anything
    // a test wants to know about it has to be read here.
    const dir = args[2];
    calls.push({
      args,
      opts,
      dir,
      written: fs.existsSync(dir) ? listTree(dir) : null,
    });
    return typeof answer === 'function' ? answer(args, opts) : answer;
  };
  run.calls = calls;
  return run;
}

function listTree(root) {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else out.push(rel);
    }
  };
  walk(root, '');
  return out.sort();
}

function withEnv(fn) {
  const before = { t: process.env.CF_API_TOKEN, a: process.env.CF_ACCOUNT_ID };
  process.env.CF_API_TOKEN = TOKEN;
  process.env.CF_ACCOUNT_ID = ACCOUNT;

  return Promise.resolve().then(fn).finally(() => {
    if (before.t === undefined) delete process.env.CF_API_TOKEN; else process.env.CF_API_TOKEN = before.t;
    if (before.a === undefined) delete process.env.CF_ACCOUNT_ID; else process.env.CF_ACCOUNT_ID = before.a;
  });
}

/* ======================================================================= */

section('REDACTION TAKES ITS SECRETS AS AN ARGUMENT');

/* THE FIRST STEP OF MOVING OFF ONE GLOBAL CLOUDFLARE ACCOUNT, and it goes
 * first because it is the one that fails dangerously.
 *
 * Blogs are moving onto a pool of ten accounts, one per client domain, so
 * the token in play depends on which blog is being deployed. scrub() is
 * what keeps a token out of anything logged or thrown — and it finds the
 * token by reading process.env.
 *
 * Leave it reading the env while the rest of the system passes per-account
 * credentials, and it redacts the WRONG token: a live credential reaches a
 * log file in cleartext, silently, in exactly the path where output gets
 * dumped because something already went wrong.
 *
 * So scrub() is told what to hide. The env stays as the fallback, because
 * every blog that exists today has no account of its own.
 */

const OTHER_TOKEN = 'cf-token-belonging-to-another-account';
const OTHER_ACCOUNT = '99998888777766665555444433332222';

test('A TOKEN PASSED IN IS REDACTED', async () => {
  await withEnv(async () => {
    const out = cf.scrub(`wrangler said: ${OTHER_TOKEN} failed`,
      { token: OTHER_TOKEN, account: OTHER_ACCOUNT });

    assert.ok(!out.includes(OTHER_TOKEN), 'the token passed in reached the output');
    assert.match(out, /redacted/);
  });
});

test('AND SO IS THE ACCOUNT ID PASSED IN', async () => {
  await withEnv(async () => {
    const out = cf.scrub(`project on ${OTHER_ACCOUNT}`,
      { token: OTHER_TOKEN, account: OTHER_ACCOUNT });

    assert.ok(!out.includes(OTHER_ACCOUNT), 'the account id passed in reached the output');
  });
});

test('THE ENV TOKEN IS NOT MISTAKEN FOR THE ONE IN USE', async () => {
  /* THE WHOLE POINT, AND THE FAILURE THIS STEP EXISTS TO PREVENT.
   *
   * A scrub() still reading the env redacts the env's token happily — and
   * leaves the per-account one, which is the one actually in the output,
   * untouched. The result looks redacted. It passes a casual eye. It is
   * the opposite of what happened. */
  await withEnv(async () => {
    const out = cf.scrub(
      `env=${TOKEN} inuse=${OTHER_TOKEN}`,
      { token: OTHER_TOKEN, account: OTHER_ACCOUNT });

    assert.ok(!out.includes(OTHER_TOKEN),
      'the credential actually in use was left in the text');
  });
});

test('AND THE ENV IS STILL USED WHEN NOTHING IS PASSED', async () => {
  /* EVERY BLOG THAT EXISTS TODAY. They have no account of their own and
   * nothing backfills them, so the old behaviour has to survive exactly —
   * this is the test that makes the whole change safe to deploy. */
  await withEnv(async () => {
    const out = cf.scrub(`wrangler said: ${TOKEN} and ${ACCOUNT}`);

    assert.ok(!out.includes(TOKEN), 'the env token is no longer redacted');
    assert.ok(!out.includes(ACCOUNT), 'the env account id is no longer redacted');
  });
});

test('A SHORT OR MISSING SECRET IS NOT TREATED AS ONE', async () => {
  /* The existing guard, kept: redacting a six-character string would
   * replace every occurrence of a common fragment in the output, which
   * destroys the error message this function exists to preserve. */
  await withEnv(async () => {
    const out = cf.scrub('the project named abc could not be found',
      { token: 'abc', account: '' });

    assert.strictEqual(out, 'the project named abc could not be found');
  });
});

test('SCRUB SURVIVES BEING GIVEN NOTHING AT ALL', async () => {
  /* It is called from catch blocks. A scrub() that throws turns a reported
   * Cloudflare failure into an unhandled one, which is a worse day than
   * the failure it was called about. */
  assert.strictEqual(cf.scrub(null), '');
  assert.strictEqual(cf.scrub(undefined, {}), '');
  assert.strictEqual(cf.scrub('plain text', null), 'plain text');
});

/* ======================================================================= */

section('THE API CALL TAKES ITS CREDENTIALS');

/* STEP TWO. Every Cloudflare REST call in this codebase goes through
 * cfApi() — fifteen call sites across deploy.js and redirects.js — so this
 * is the widest single change and the one that makes per-account work
 * possible at all.
 *
 * THE CALLERS ARE NOT TOUCHED YET, DELIBERATELY. They pass no credentials
 * and fall through to the environment, exactly as today. That keeps this
 * step deployable on its own: nothing changes behaviour, and the seam
 * exists for the helpers to start using one at a time.
 */

const CREDS = { token: OTHER_TOKEN, account: OTHER_ACCOUNT };

/** A fetch stub that records what it was asked to do. */
function recordingFetch(answer = { success: true, result: {} }) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => answer };
  };
  impl.calls = calls;
  return impl;
}

test('THE TOKEN IT IS GIVEN IS THE ONE ON THE WIRE', async () => {
  /* The assertion the whole pool design rests on. A cfApi() still reading
   * the env would send the WRONG account's token — and Cloudflare would
   * answer, with the wrong account's data, rather than failing. */
  await withEnv(async () => {
    const fetchImpl = recordingFetch();

    await cf.cfApi('/zones?name=x.example', { fetchImpl, creds: CREDS });

    const sent = fetchImpl.calls[0].init.headers.Authorization;
    assert.strictEqual(sent, `Bearer ${OTHER_TOKEN}`,
      `it sent ${sent} instead of the credentials it was given`);
  });
});

test('AND THE ENV TOKEN IS USED WHEN IT IS GIVEN NONE', async () => {
  /* Every blog that exists today, and every caller not yet converted. */
  await withEnv(async () => {
    const fetchImpl = recordingFetch();

    await cf.cfApi('/zones?name=x.example', { fetchImpl });

    assert.strictEqual(fetchImpl.calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  });
});

test('CREDENTIALS PASSED IN WORK WITH NO ENVIRONMENT AT ALL', async () => {
  /* THE STATE THE SERVER ENDS UP IN once every blog carries an account and
   * the fallback is removed from .env. If cfApi only works when the env
   * happens to be populated, the pool is not actually independent of it —
   * it just looks that way while both are present. */
  const before = { t: process.env.CF_API_TOKEN, a: process.env.CF_ACCOUNT_ID };
  delete process.env.CF_API_TOKEN;
  delete process.env.CF_ACCOUNT_ID;

  try {
    const fetchImpl = recordingFetch();
    const out = await cf.cfApi('/zones', { fetchImpl, creds: CREDS });

    assert.strictEqual(out.ok, true, `it refused: ${out.error}`);
    assert.strictEqual(fetchImpl.calls[0].init.headers.Authorization, `Bearer ${OTHER_TOKEN}`);
  } finally {
    if (before.t === undefined) delete process.env.CF_API_TOKEN; else process.env.CF_API_TOKEN = before.t;
    if (before.a === undefined) delete process.env.CF_ACCOUNT_ID; else process.env.CF_ACCOUNT_ID = before.a;
  }
});

test('HALF A CREDENTIAL IS NO CREDENTIAL', async () => {
  /* A Domain row saved with an account id and no token is the obvious way
   * this goes wrong in production, and a request sent with `Bearer
   * undefined` would come back as an authentication error that reads like
   * a revoked token rather than a missing one. */
  await withEnv(async () => {
    const fetchImpl = recordingFetch();

    const out = await cf.cfApi('/zones', { fetchImpl, creds: { account: OTHER_ACCOUNT } });

    assert.strictEqual(out.ok, false);
    assert.match(out.error, /credential/i);
    assert.strictEqual(fetchImpl.calls.length, 0,
      'it sent a request with no token rather than refusing');
  });
});

test('AN ERROR IS SCRUBBED WITH THE CREDENTIALS THAT WERE USED', async () => {
  /* THE TWO STEPS MEETING, and the reason step one came first.
   *
   * Cloudflare does not echo a token, so this is belt and braces — but it
   * is the belt and braces that matters: cfApi's own error path is where a
   * token would reach a log, and scrubbing it against the ENV's token
   * while the per-account one sits in the message is the exact failure
   * step one was ordered first to prevent. */
  await withEnv(async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 403,
      json: async () => ({
        success: false,
        errors: [{ code: 10000, message: `Bad token ${OTHER_TOKEN}` }],
      }),
    });

    const out = await cf.cfApi('/zones', { fetchImpl, creds: CREDS });

    assert.strictEqual(out.ok, false);
    assert.ok(!out.error.includes(OTHER_TOKEN),
      'the credential actually in use reached the error message');
    assert.match(out.error, /redacted/);
  });
});

test('A LIST ANSWER CARRIES CLOUDFLARE\'S result_info THROUGH', async () => {
  /* Added for verifyAccount(), which reports how full an account is on the
   * admin screen.
   *
   * Cloudflare's list endpoints PAGE. An account holding 140 Pages projects
   * answers with 25 of them and result_info.total_count: 140. Counting
   * `result.length` would put "25 / 100" on that screen — which reads as 75
   * free slots that do not exist, and the refusal would land on a customer
   * pressing Create.
   *
   * The whole of result_info is passed rather than total_count alone: it is
   * Cloudflare's shape, this function's job is to hand it over unchanged,
   * and picking one field here is a second place to edit the day something
   * needs `page` or `per_page`. */
  await withEnv(async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        result: [{ name: 'one' }, { name: 'two' }],
        result_info: { page: 1, per_page: 25, count: 2, total_count: 140 },
      }),
    });

    const out = await cf.cfApi('/accounts/x/pages/projects', { fetchImpl, creds: CREDS });

    assert.strictEqual(out.ok, true);
    assert.ok(out.info, 'result_info was dropped — a count can only be a page size now');
    assert.strictEqual(out.info.total_count, 140);
    assert.strictEqual(out.result.length, 2, 'the result itself changed shape');
  });
});

test('AND AN ANSWER WITHOUT ONE IS UNCHANGED', async () => {
  /* Most endpoints do not page. `info` being undefined there is the point:
   * every existing caller reads `result` and nothing else, so this had to
   * be additive. */
  await withEnv(async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, result: { id: 'zone-1' } }),
    });

    const out = await cf.cfApi('/zones/zone-1', { fetchImpl, creds: CREDS });

    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.info, undefined);
    assert.deepStrictEqual(out.result, { id: 'zone-1' });
  });
});

test('AND A THROWN ERROR IS SCRUBBED THE SAME WAY', async () => {
  /* The other exit. A network failure carries whatever the client put in
   * the message, and node has been known to include request detail. */
  await withEnv(async () => {
    const fetchImpl = async () => { throw new Error(`connect failed using ${OTHER_TOKEN}`); };

    const out = await cf.cfApi('/zones', { fetchImpl, creds: CREDS });

    assert.strictEqual(out.ok, false);
    assert.ok(!out.error.includes(OTHER_TOKEN), 'the token reached the thrown message');
  });
});

/* ======================================================================= */

section('WHAT WRANGLER IS RUN WITH');

/* STEP THREE. cfApi() covers the REST calls; this covers the other half —
 * wrangler is a child process, and it reads its credentials out of the
 * environment it is handed.
 *
 * THE NAMES CHANGE HERE. Our .env calls them CF_*, wrangler reads
 * CLOUDFLARE_*. That mapping is the whole reason this function exists, and
 * it is why a per-account deploy has to go through it rather than setting
 * process.env and hoping.
 */

test('THE CREDENTIALS IT IS GIVEN ARE THE ONES WRANGLER GETS', async () => {
  await withEnv(async () => {
    const env = cf.childEnv({ token: OTHER_TOKEN, account: OTHER_ACCOUNT });

    assert.strictEqual(env.CLOUDFLARE_API_TOKEN, OTHER_TOKEN);
    assert.strictEqual(env.CLOUDFLARE_ACCOUNT_ID, OTHER_ACCOUNT);
  });
});

test('AND THE ENVIRONMENT IS USED WHEN IT IS GIVEN NONE', async () => {
  await withEnv(async () => {
    const env = cf.childEnv();

    assert.strictEqual(env.CLOUDFLARE_API_TOKEN, TOKEN);
    assert.strictEqual(env.CLOUDFLARE_ACCOUNT_ID, ACCOUNT);
  });
});

test('HALF A CREDENTIAL THROWS RATHER THAN RUNNING WRANGLER WITH IT', async () => {
  /* THE SAME PAIRING RULE cfApi() HAS, and for a sharper reason. wrangler
   * handed an account id and the SERVER'S token would authenticate as one
   * account and deploy at another — and unlike a REST call, this one
   * creates projects and uploads files. A deploy landing in the wrong
   * customer's account is not an error message, it is a site in the wrong
   * place with nothing to say so.
   *
   * It throws rather than returning, because every caller is inside the
   * deploy path's try/catch and a thrown credential problem is reported;
   * a silently wrong environment is not. */
  await withEnv(async () => {
    assert.throws(() => cf.childEnv({ account: OTHER_ACCOUNT }), /credential/i);
    assert.throws(() => cf.childEnv({ token: OTHER_TOKEN }), /credential/i);
  });
});

test('IT STILL HANDS THE CHILD NOTHING ELSE', async () => {
  /* The property the existing deploy test asserts, restated against the
   * new argument. This process holds the Mongo URI, the OpenAI key and the
   * Stripe secret; a child that was handed process.env would be a hole
   * that has nothing to do with which Cloudflare account is in play. */
  await withEnv(async () => {
    const env = cf.childEnv({ token: OTHER_TOKEN, account: OTHER_ACCOUNT });

    assert.deepStrictEqual(Object.keys(env).sort(), [
      'CI', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'HOME', 'PATH',
      'WRANGLER_SEND_METRICS',
    ]);
  });
});

test('AND IT STILL REFUSES WHEN THERE ARE NO CREDENTIALS ANYWHERE', async () => {
  /* The existing behaviour, unchanged: a server with no Cloudflare set up
   * at all should say so rather than running wrangler with an empty token
   * and reporting whatever Cloudflare says about it. */
  const before = { t: process.env.CF_API_TOKEN, a: process.env.CF_ACCOUNT_ID };
  delete process.env.CF_API_TOKEN;
  delete process.env.CF_ACCOUNT_ID;

  try {
    assert.throws(() => cf.childEnv(), /not set on this server|credential/i);
  } finally {
    if (before.t === undefined) delete process.env.CF_API_TOKEN; else process.env.CF_API_TOKEN = before.t;
    if (before.a === undefined) delete process.env.CF_ACCOUNT_ID; else process.env.CF_ACCOUNT_ID = before.a;
  }
});

/* ======================================================================= */

section('THE HELPERS CARRY THE CREDENTIALS THROUGH');

/* STEP FOUR. cfApi() and childEnv() take credentials; now the dozen
 * functions between them and the caller have to pass them along.
 *
 * MECHANICAL, AND THAT IS EXACTLY WHY IT IS TESTED ONE BY ONE. Every one
 * of these is a place to forget an argument, and a forgotten argument does
 * not fail — it falls back to the environment and the call succeeds
 * against the WRONG ACCOUNT. There is no error to notice.
 *
 * ASSERTED ON WHAT WENT OVER THE WIRE, because the only visible difference
 * between "passed through" and "silently fell back" is the bearer token on
 * the request. A test that checks the return value sees a success either
 * way.
 */

/** What Authorization headers a fetch stub was handed. */
function tokensSentTo(fetchImpl) {
  return fetchImpl.calls.map(c => c.init.headers.Authorization);
}

/** A fetch stub answering whatever each call needs, and recording all of it. */
function poolFetch() {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });

    if (url.includes('/zones?')) {
      return { ok: true, status: 200,
        json: async () => ({ success: true, result: [{ id: 'zone-1', name: 'acmehvac.com' }] }) };
    }
    if (url.includes('/dns_records')) {
      return { ok: true, status: 200, json: async () => ({ success: true, result: [] }) };
    }
    return { ok: true, status: 200, json: async () => ({ success: true, result: {} }) };
  };
  impl.calls = calls;
  return impl;
}

test('findZone USES THE CREDENTIALS IT IS GIVEN', async () => {
  await withEnv(async () => {
    const fetchImpl = poolFetch();
    await cf.findZone({ domain: 'hvac.acmehvac.com', fetchImpl, creds: CREDS });

    for (const sent of tokensSentTo(fetchImpl)) {
      assert.strictEqual(sent, `Bearer ${OTHER_TOKEN}`,
        'a zone lookup fell back to the server account');
    }
  });
});

test('listZones DOES TOO', async () => {
  await withEnv(async () => {
    const fetchImpl = poolFetch();
    await cf.listZones({ fetchImpl, creds: CREDS });

    assert.deepStrictEqual(tokensSentTo(fetchImpl), [`Bearer ${OTHER_TOKEN}`]);
  });
});

test('attachDomain DOES, AND AIMS AT THE RIGHT ACCOUNT', async () => {
  /* TWO THINGS, AND THE SECOND IS THE ONE THAT BITES. The token says who
   * we are; the ACCOUNT ID IN THE PATH says whose Pages project we are
   * touching. attachDomain built that path from process.env directly, so
   * a converted token with an unconverted path would authenticate as the
   * client and then ask about a project in OUR account. */
  await withEnv(async () => {
    const fetchImpl = poolFetch();
    await cf.attachDomain({ project: 'p', domain: 'hvac.acmehvac.com', fetchImpl, creds: CREDS });

    assert.deepStrictEqual(tokensSentTo(fetchImpl), [`Bearer ${OTHER_TOKEN}`]);
    assert.ok(fetchImpl.calls[0].url.includes(OTHER_ACCOUNT),
      `the request went to ${fetchImpl.calls[0].url} — the wrong account's path`);
    assert.ok(!fetchImpl.calls[0].url.includes(ACCOUNT),
      'the server account id is still in the path');
  });
});

test('detachDomain DOES, AND AIMS AT THE RIGHT ACCOUNT', async () => {
  await withEnv(async () => {
    const fetchImpl = poolFetch();
    await cf.detachDomain({ project: 'p', domain: 'hvac.acmehvac.com', fetchImpl, creds: CREDS });

    assert.deepStrictEqual(tokensSentTo(fetchImpl), [`Bearer ${OTHER_TOKEN}`]);
    assert.ok(fetchImpl.calls[0].url.includes(OTHER_ACCOUNT));
    assert.ok(!fetchImpl.calls[0].url.includes(ACCOUNT));
  });
});

test('ensureDnsRecord DOES', async () => {
  await withEnv(async () => {
    const fetchImpl = poolFetch();
    await cf.ensureDnsRecord({
      zoneId: 'zone-1', name: 'hvac.acmehvac.com', target: 'p.pages.dev',
      fetchImpl, creds: CREDS,
    });

    for (const sent of tokensSentTo(fetchImpl)) {
      assert.strictEqual(sent, `Bearer ${OTHER_TOKEN}`, 'a DNS write fell back to the server account');
    }
  });
});

test('removeDnsRecord DOES', async () => {
  await withEnv(async () => {
    const fetchImpl = poolFetch();
    await cf.removeDnsRecord({
      zoneId: 'zone-1', name: 'hvac.acmehvac.com', expected: 'p.pages.dev',
      fetchImpl, creds: CREDS,
    });

    for (const sent of tokensSentTo(fetchImpl)) {
      assert.strictEqual(sent, `Bearer ${OTHER_TOKEN}`);
    }
  });
});

/* A redirect/release stub that RECORDS WHAT IT WAS HANDED.
 *
 * THE TWO TESTS BELOW USED ONE THAT DID NOT — `async () => ({ ok: true })`,
 * ignoring its arguments — AND THAT IS HOW THE BUG BELOW SURVIVED THEM.
 *
 * The redirect step is stubbed because deploy.js requires redirects.js
 * lazily to break a cycle, and a test should not reach through a module
 * cache to get at it. Stubbing it is right. Stubbing it and then never
 * asking what it was called with is what turned a test named "EVERY STEP IT
 * TAKES" into a test of two steps out of three.
 *
 * Found 23 October 2026, after Edwin's pages.dev address did not redirect.
 */
function recordingStep(answer = { ok: true }) {
  const calls = [];
  const fn = async (args) => { calls.push(args); return answer; };
  fn.calls = calls;
  return fn;
}

test('pointDomainAtProject CARRIES THEM THROUGH EVERY STEP IT TAKES', async () => {
  /* THE COMPOSITE, AND THE ONE MOST LIKELY TO LEAK. It attaches the
   * domain, writes the pages.dev redirect, finds the zone and writes the
   * DNS record — four steps, and forgetting the argument on any one of them
   * sends that step to the server's account while the others go to the
   * client's. The blog half works, which is worse than not working.
   *
   * IT WAS FORGOTTEN ON THE REDIRECT STEP, AND THIS TEST WATCHED IT HAPPEN.
   * Every blog on a pool account had its pages.dev redirect written into
   * the SERVER'S Bulk Redirect list, where it can do nothing: the lists are
   * account-scoped and the .pages.dev hostname belongs to the project's own
   * account. Edwin found it by clicking the address and not being
   * redirected. */
  await withEnv(async () => {
    const fetchImpl = poolFetch();
    const redirect = recordingStep();

    await cf.pointDomainAtProject({
      project: 'p', domain: 'hvac.acmehvac.com', target: 'p.pages.dev',
      fetchImpl, creds: CREDS, redirect,
    });

    assert.ok(fetchImpl.calls.length >= 2, 'it did not make the calls it was meant to');

    for (const sent of tokensSentTo(fetchImpl)) {
      assert.strictEqual(sent, `Bearer ${OTHER_TOKEN}`,
        'one step of pointDomainAtProject used the server account');
    }
    for (const { url } of fetchImpl.calls) {
      assert.ok(!url.includes(ACCOUNT), `${url} carries the server account id`);
    }

    /* THE STEP THAT WAS STUBBED AND NEVER LOOKED AT. */
    assert.strictEqual(redirect.calls.length, 1, 'the pages.dev redirect was not attempted');
    assert.deepStrictEqual(redirect.calls[0].creds, CREDS,
      'the pages.dev redirect was written to the SERVER account');
  });
});

test('releaseDomain DOES TOO', async () => {
  /* The mirror, and it matters as much. releasePagesDev with the wrong
   * credentials removes an entry from the server's list — so the blog's
   * real entry survives its own deletion, on an account nobody will think
   * to look at, pointing at a domain that no longer serves anything. */
  await withEnv(async () => {
    const fetchImpl = poolFetch();
    const release = recordingStep();

    await cf.releaseDomain({
      project: 'p', domain: 'hvac.acmehvac.com', expected: 'p.pages.dev',
      fetchImpl, creds: CREDS, release,
    });

    for (const { init, url } of fetchImpl.calls) {
      assert.strictEqual(init.headers.Authorization, `Bearer ${OTHER_TOKEN}`);
      assert.ok(!url.includes(ACCOUNT), `${url} carries the server account id`);
    }

    assert.strictEqual(release.calls.length, 1, 'the redirect was never released');
    assert.deepStrictEqual(release.calls[0].creds, CREDS,
      'it tried to release the redirect from the SERVER account');
  });
});

test('AND THE REDIRECT STEP IS STILL TOLD WHICH PROJECT AND DOMAIN', async () => {
  /* The credentials are the half that was missing; these two are the half
   * that was already right, and an assertion on `creds` alone would not
   * notice if a fix dropped them. */
  await withEnv(async () => {
    const redirect = recordingStep();

    await cf.pointDomainAtProject({
      project: 'blog-acmehvac-com', domain: 'hvac.acmehvac.com', target: 'p.pages.dev',
      fetchImpl: poolFetch(), creds: CREDS, redirect,
    });

    assert.strictEqual(redirect.calls[0].project, 'blog-acmehvac-com');
    assert.strictEqual(redirect.calls[0].domain, 'hvac.acmehvac.com');
  });
});

test('AND WITH NO CREDENTIALS THE REDIRECT STEP STILL GETS NONE', async () => {
  /* The fallback, here as everywhere else. Every blog that predates the
   * pool has no account of its own, and `creds: undefined` is how
   * redirects.js is told to use the environment. Passing a half-built
   * object instead would make cfApi refuse. */
  await withEnv(async () => {
    const redirect = recordingStep();

    await cf.pointDomainAtProject({
      project: 'p', domain: 'hvac.acmehvac.com', target: 'p.pages.dev',
      fetchImpl: poolFetch(), redirect,
    });

    assert.strictEqual(redirect.calls.length, 1);
    assert.strictEqual(redirect.calls[0].creds, undefined,
      'it invented credentials for a blog that has none');
  });
});

test('AND EVERY ONE OF THEM STILL FALLS BACK TO THE ENVIRONMENT', async () => {
  /* EVERY BLOG THAT EXISTS TODAY AND EVERY CALLER NOT YET CONVERTED.
   * Passing no credentials has to behave exactly as it did before any of
   * this started — this is the assertion that makes step four deployable
   * rather than a flag day. */
  await withEnv(async () => {
    const fetchImpl = poolFetch();

    await cf.findZone({ domain: 'acmehvac.com', fetchImpl });
    await cf.listZones({ fetchImpl });
    await cf.attachDomain({ project: 'p', domain: 'd.example.com', fetchImpl });
    await cf.detachDomain({ project: 'p', domain: 'd.example.com', fetchImpl });

    for (const sent of tokensSentTo(fetchImpl)) {
      assert.strictEqual(sent, `Bearer ${TOKEN}`, 'the env fallback is gone');
    }
    for (const { url } of fetchImpl.calls) {
      if (url.includes('/accounts/')) {
        assert.ok(url.includes(ACCOUNT), `${url} lost the env account id`);
      }
    }
  });
});

/* ======================================================================= */

section('THE DEPLOY ITSELF TAKES THE CREDENTIALS');

/* THE LAST OF THE PLUMBING, and the one that actually puts files
 * somewhere. deployBlog() runs wrangler, creates the project on first
 * publish, and points the domain at it — three things that each need to
 * happen in the SAME account, and nothing downstream can tell if one of
 * them went elsewhere.
 *
 * STILL NO CALLER PASSES ANYTHING. credsFor(blog) is the next step; until
 * then every path falls through to the environment exactly as today.
 */

test('WRANGLER IS RUN IN THE ACCOUNT THE DEPLOY WAS GIVEN', async () => {
  await withEnv(async () => {
    const run = recorder();

    await cf.deployBlog({
      blog: FRESH_BLOG, files: FILES, run, attach: attacher(), creds: CREDS,
    });

    for (const call of run.calls) {
      assert.strictEqual(call.opts.env.CLOUDFLARE_API_TOKEN, OTHER_TOKEN,
        'a wrangler child was handed the server token');
      assert.strictEqual(call.opts.env.CLOUDFLARE_ACCOUNT_ID, OTHER_ACCOUNT,
        'a wrangler child was handed the server account');
    }
  });
});

test('AND THE DOMAIN IS POINTED USING THEM TOO', async () => {
  /* THE HALF THAT WOULD HALF-WORK. The project is created in the client's
   * account by wrangler, and the custom domain is attached through the
   * REST API — forget the credentials on that second call and the project
   * exists in one account while the attach is attempted in another.
   * Cloudflare reports a missing project, about a project that was created
   * thirty seconds earlier. */
  await withEnv(async () => {
    const attach = attacher();

    await cf.deployBlog({
      blog: FRESH_BLOG, files: FILES, run: recorder(), attach, creds: CREDS,
    });

    assert.ok(attach.calls.length, 'the domain was never pointed at the project');
    assert.deepStrictEqual(attach.calls[0].creds, CREDS,
      'the attach was made with the server credentials');
  });
});

test('AND WRANGLER OUTPUT IS SCRUBBED WITH THEM', async () => {
  /* wrangler does not print the token, and this is the belt and braces
   * that matters: the deploy's output is logged and returned to the
   * screen. Scrubbed against the ENV token while the per-account one is in
   * the text is the failure step one was ordered first to prevent — and
   * every wrangler call in this function had a scrub() reading the env
   * until now. */
  await withEnv(async () => {
    const run = async () => ({
      code: 1, stdout: `deploy failed using ${OTHER_TOKEN}`, stderr: '',
    });

    const out = await cf.deployBlog({
      blog: FRESH_BLOG, files: FILES, run, attach: attacher(), creds: CREDS,
    });

    assert.ok(!JSON.stringify(out).includes(OTHER_TOKEN),
      'the credential in use reached the deploy result');
  });
});

test('ensureProject SCRUBS WITH THE CREDENTIALS IT WAS GIVEN', async () => {
  await withEnv(async () => {
    const run = async () => ({ code: 1, stdout: `create failed: ${OTHER_TOKEN}`, stderr: '' });

    const out = await cf.ensureProject({ project: 'p', env: {}, run, creds: CREDS });

    assert.ok(!out.output.includes(OTHER_TOKEN), 'the token reached the create output');
  });
});

test('deleteProject DOES TOO', async () => {
  await withEnv(async () => {
    const run = async () => ({ code: 1, stdout: `delete failed: ${OTHER_TOKEN}`, stderr: '' });

    const out = await cf.deleteProject({ project: 'p', env: {}, run, creds: CREDS });

    assert.ok(!out.output.includes(OTHER_TOKEN), 'the token reached the delete output');
  });
});

test('AND A DEPLOY WITH NO CREDENTIALS STILL USES THE ENVIRONMENT', async () => {
  /* Every blog that exists today, and every caller until credsFor lands.
   * This is the assertion that makes the step deployable on its own. */
  await withEnv(async () => {
    const run = recorder();
    const attach = attacher();

    await cf.deployBlog({ blog: FRESH_BLOG, files: FILES, run, attach });

    for (const call of run.calls) {
      assert.strictEqual(call.opts.env.CLOUDFLARE_API_TOKEN, TOKEN);
      assert.strictEqual(call.opts.env.CLOUDFLARE_ACCOUNT_ID, ACCOUNT);
    }
    assert.strictEqual(attach.calls[0].creds, undefined,
      'an unconverted caller started sending credentials from somewhere');
  });
});

/* ======================================================================= */

section('THE FILES THAT GO UP');

test('every rendered file is written, at its own path', async () => {
  await withEnv(async () => {
    const run = recorder();
    const out = await cf.deployBlog({ blog: BLOG, files: FILES, run });

    assert.strictEqual(out.ok, true, out.error);
    assert.deepStrictEqual(run.calls[0].written, Object.keys(FILES).sort(),
      'the deployed directory does not match the rendered site');
  });
});

test('AND A SLUG CANNOT CLIMB OUT OF THE DIRECTORY', async () => {
  /* File names come from article slugs, which come from model output. The
   * deploy must refuse rather than sanitise: a path that tried to leave is
   * not a typo, it is something upstream producing a slug it should not,
   * and quietly rewriting it would publish a page at an address nobody
   * chose. */
  await withEnv(async () => {
    /* `..` IS THE ATTACK, NOT THE LEADING SLASH.
     *
     * A first version of this list had '/etc/passwd' in it and failed
     * against correct code. In a site manifest a leading slash means "from
     * the top of the site", which is what '/index.html' and
     * '/assets/blog.css' mean too — there is no way to tell those apart,
     * and nor should there be. '/etc/passwd' deploys a page at
     * example.com/etc/passwd, which is odd but harmless.
     *
     * Climbing out of the directory with `..` is the thing that writes
     * somewhere nobody chose, and that is what must be refused. */
    for (const bad of [
      '../escaped.html',
      'a/../../escaped.html',
      'ok/../../../outside.html',
      '/../escaped.html',
      'a/b/../../../escaped.html',
    ]) {
      const run = recorder();
      const files = { 'index.html': 'home', [bad]: 'nope' };

      let threw = null;
      try {
        await cf.deployBlog({ blog: BLOG, files, run });
      } catch (err) {
        threw = err;
      }

      assert.ok(threw, `${JSON.stringify(bad)} was accepted as a file path`);
      assert.ok(/outside the deploy directory/i.test(threw.message),
        `the refusal does not say why: ${threw.message}`);
    }
  });
});

test('a leading slash is a path from the site root, not from the disk root', async () => {
  /* `/index.html` is how a manifest names the home page, and it means the
   * top of the site. It is not an attempt to escape and must not be
   * treated as one. */
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ie-test-'));
  try {
    const full = cf.resolveInside(root, '/assets/blog.css');
    assert.ok(full.startsWith(root + path.sep));
    assert.ok(full.endsWith(path.join('assets', 'blog.css')));
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('AND A SIBLING DIRECTORY IS NOT INSIDE THE DEPLOY DIRECTORY', async () => {
  /* FOUND BY MUTATION, and it is the subtle one.
   *
   * Checking `startsWith(root)` rather than `startsWith(root + '/')` looks
   * identical and is not. With a root of /tmp/site, the path
   * /tmp/siteother/x starts with /tmp/site — so an escape into a SIBLING
   * whose name merely extends the root's would be accepted.
   *
   * mkdtemp names are random, so a deploy-level test cannot produce that
   * collision on purpose. The check is exercised directly instead. */
  const root = path.join(os.tmpdir(), 'ie-site');

  assert.throws(() => cf.resolveInside(root, '../ie-siteother/x'), /outside the deploy directory/i,
    'a sibling directory sharing the prefix was treated as inside');
  assert.throws(() => cf.resolveInside(root, '../ie-site-backup/x'), /outside the deploy directory/i);

  // And the honest cases still work.
  assert.ok(cf.resolveInside(root, 'index.html').startsWith(root + path.sep));
  assert.ok(cf.resolveInside(root, 'a/b/c.html').startsWith(root + path.sep));
});

test('THE DIRECTORY IS ALWAYS REMOVED, WIN OR LOSE', async () => {
  /* One temp directory left behind per failed deploy fills the same disk
   * that holds every generated website. */
  await withEnv(async () => {
    const ok = recorder();
    await cf.deployBlog({ blog: BLOG, files: FILES, run: ok });
    assert.ok(!fs.existsSync(ok.calls[0].dir), 'a successful deploy left its files behind');

    const bad = recorder({ code: 1, stdout: '', stderr: 'it went wrong' });
    await cf.deployBlog({ blog: BLOG, files: FILES, run: bad });
    assert.ok(!fs.existsSync(bad.calls[0].dir), 'a failed deploy left its files behind');

    const threw = recorder(() => { throw new Error('boom'); });
    await cf.deployBlog({ blog: BLOG, files: FILES, run: threw }).catch(() => {});
    assert.ok(!fs.existsSync(threw.calls[0].dir), 'a thrown deploy left its files behind');
  });
});

test('and nothing is deployed when there is nothing to deploy', async () => {
  await withEnv(async () => {
    const run = recorder();
    const out = await cf.deployBlog({ blog: BLOG, files: {}, run });

    assert.strictEqual(out.ok, false);
    assert.strictEqual(run.calls.length, 0, 'an empty site was pushed to Cloudflare');
  });
});

section('THE SECRET');

test('THE CHILD GETS THE TOKEN AND ALMOST NOTHING ELSE', async () => {
  /* This app's environment holds the Mongo URI, the OpenAI key, the Stripe
   * secret and the session secret. None of them are wrangler's business,
   * and `...process.env` plus the token would hand over all of them. */
  const before = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-should-not-travel';

  try {
    await withEnv(async () => {
      const run = recorder();
      await cf.deployBlog({ blog: BLOG, files: FILES, run });

      const env = run.calls[0].opts.env;

      assert.strictEqual(env.CLOUDFLARE_API_TOKEN, TOKEN, 'wrangler was not given the token');
      assert.strictEqual(env.CLOUDFLARE_ACCOUNT_ID, ACCOUNT);
      assert.ok(!('OPENAI_API_KEY' in env), 'the OpenAI key was handed to wrangler');
      assert.ok(!('MONGO_URI' in env), 'the database URI was handed to wrangler');
      assert.ok(!('CF_API_TOKEN' in env), 'the raw CF_ names were passed through as well');

      assert.ok(env.PATH, 'without PATH the child cannot start');
    });
  } finally {
    if (before === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = before;
  }
});

test('AND IT NEVER COMES BACK OUT IN THE OUTPUT', async () => {
  /* wrangler does not print the token today. This is for the version that
   * one day does — in an error, a debug line, a stack. By then nobody will
   * be reading this file. */
  await withEnv(async () => {
    const run = recorder({
      code: 1,
      stdout: `using token ${TOKEN} for account ${ACCOUNT}`,
      stderr: `failed with ${TOKEN}`,
    });

    const out = await cf.deployBlog({ blog: BLOG, files: FILES, run });

    assert.strictEqual(out.ok, false);
    assert.ok(!out.output.includes(TOKEN), 'the token was returned in the failure output');
    assert.ok(!out.output.includes(ACCOUNT), 'the account id was returned in the failure output');
    assert.ok(out.output.includes('[redacted]'), 'nothing was redacted at all');
  });
});

test('and a deploy refuses to start with no credentials set', async () => {
  const before = { t: process.env.CF_API_TOKEN, a: process.env.CF_ACCOUNT_ID };
  delete process.env.CF_API_TOKEN;
  delete process.env.CF_ACCOUNT_ID;

  try {
    const run = recorder();
    let threw = null;
    try {
      await cf.deployBlog({ blog: BLOG, files: FILES, run });
    } catch (err) {
      threw = err;
    }

    assert.ok(threw, 'a deploy was attempted with no token');
    assert.ok(/CF_API_TOKEN/.test(threw.message), 'the error does not say what is missing');
    assert.strictEqual(run.calls.length, 0, 'wrangler was run without credentials');
  } finally {
    if (before.t !== undefined) process.env.CF_API_TOKEN = before.t;
    if (before.a !== undefined) process.env.CF_ACCOUNT_ID = before.a;
  }
});

section('WHAT WRANGLER IS ASKED TO DO');

test('the project name, the branch, and the directory it just wrote', async () => {
  await withEnv(async () => {
    const run = recorder();
    await cf.deployBlog({ blog: BLOG, files: FILES, run });

    const [command, sub, dir, ...flags] = run.calls[0].args;

    assert.strictEqual(command, 'pages');
    assert.strictEqual(sub, 'deploy');
    assert.strictEqual(dir, run.calls[0].dir, 'wrangler was pointed at a different directory');
    assert.ok(flags.includes('--project-name=leanderwaterheaters-com'));
    assert.ok(flags.includes('--branch=main'), 'the deploy has no branch, so it is a preview');
  });
});

test('A PROJECT NAME IS A DOMAIN WITH EVERY SEPARATOR MADE A HYPHEN', async () => {
  /* Cloudflare takes lower-case letters, digits and hyphens, starting and
   * ending alphanumeric. */
  assert.strictEqual(cf.projectNameFor({ siteUrl: 'leanderwaterheaters.com' }), 'leanderwaterheaters-com');
  assert.strictEqual(cf.projectNameFor({ siteUrl: 'blog.example.co.uk' }), 'blog-example-co-uk');
  assert.strictEqual(cf.projectNameFor({ siteUrl: 'https://Blog.Example.com/path' }), 'blog-example-com');
  assert.strictEqual(cf.projectNameFor({ siteUrl: 'under_score.example.com' }), 'under-score-example-com');

  for (const junk of [{}, { siteUrl: '' }, { siteUrl: '...' }, { siteUrl: '-' }]) {
    assert.throws(() => cf.projectNameFor(junk), /project name/i,
      `${JSON.stringify(junk)} produced a project name anyway`);
  }
});

test('and a blog that already has a project keeps it', async () => {
  /* A blog whose domain changes must keep its project rather than quietly
   * start a second one and leave the first serving stale pages. */
  await withEnv(async () => {
    const run = recorder();
    await cf.deployBlog({
      blog: { ...BLOG, siteUrl: 'a-new-domain.com', project: 'the-original-project' },
      files: FILES, run,
    });

    assert.ok(run.calls[0].args.includes('--project-name=the-original-project'),
      'a renamed blog started a second Cloudflare project');
  });
});

section('WHICH WRANGLER GETS RUN');

test('THE INSTALLED COPY, NOT ONE FETCHED AT JOB TIME', async () => {
  /* `npx --yes wrangler` looks tidier and is wrong inside a job: when the
   * dependency is missing it DOWNLOADS it, so a server whose npm install
   * failed deploys a blog anyway — slowly, over the network, with whatever
   * version is current that day. wrangler is a declared dependency so the
   * version is decided at install time, and this is the lookup that holds
   * that line. */
  const resolved = cf.wranglerEntry('nodemon');   // installed, and has a bin

  assert.ok(resolved, 'an installed package with a bin did not resolve');
  assert.ok(path.isAbsolute(resolved), 'the entry point is not an absolute path');
  assert.ok(fs.existsSync(resolved), 'the resolved entry point does not exist');
  assert.ok(resolved.includes('node_modules'),
    'the package was resolved from somewhere other than the installed tree');
});

test('AND IT WORKS ON A PACKAGE WHOSE BIN IS HIDDEN BY ITS exports MAP', async () => {
  /* THE BUG THIS REPLACED, AND IT SHIPPED.
   *
   * The first version asked for the file directly:
   *
   *     require.resolve('wrangler/bin/wrangler.js')
   *     -> ERR_PACKAGE_PATH_NOT_EXPORTED
   *
   * A package that declares an `exports` map is reachable ONLY at the
   * subpaths it lists, and wrangler does not list its own bin — even
   * though `bin` in the same package.json points straight at it. So the
   * lookup returned null on a machine where wrangler was installed, and
   * every deploy would have reported "wrangler is not installed".
   *
   * It passed every test here because this container has no wrangler, so
   * null looked like the correct answer.
   *
   * `glob` has the same restriction and IS installed, so this reproduces
   * the real failure rather than describing it. It fails against the old
   * implementation and passes against the new one. */
  assert.throws(() => require.resolve('glob/dist/esm/bin.mjs'),
    { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' },
    'glob no longer hides its bin, so this test proves nothing — find another package');

  const entry = cf.wranglerEntry('glob');

  assert.ok(entry, "a package whose bin is hidden by exports did not resolve");
  assert.ok(fs.existsSync(entry), 'the resolved path does not exist');
  assert.ok(entry.endsWith('bin.mjs'), `resolved to something unexpected: ${entry}`);
});

test('AND A MISSING WRANGLER IS A FAILURE THAT SAYS SO', async () => {
  /* The container this suite runs in has no wrangler, which makes the
   * failure branch the one that is actually exercised here — and it is the
   * state of a server that has not deployed yet. */
  assert.strictEqual(cf.wranglerEntry('wrangler-that-is-not-installed'), null);

  /* `entry: null` FORCES THE BRANCH. Calling runWrangler and relying on
   * wrangler being absent is what broke this suite the first time it ran
   * on a machine where wrangler was installed: it spawned the real binary
   * with an empty environment. Nothing here starts a process. */
  const out = await cf.runWrangler(['pages', 'deploy'], {
    env: {}, cwd: os.tmpdir(), entry: null,
  });

  assert.notStrictEqual(out.code, 0, 'a missing wrangler was reported as a successful run');
  assert.ok(/not installed/i.test(out.stderr), `the failure does not say what is wrong: ${out.stderr}`);
  assert.ok(/npm install/i.test(out.stderr), 'the failure does not say what to do about it');
});

section('WHAT COMES BACK');

test('the live URL is read out of what wrangler printed', async () => {
  await withEnv(async () => {
    const run = recorder({
      code: 0,
      stdout: '✨ Uploading... done\n✨ Deployment complete! Take a peek over at https://a1b2c3d4.leanderwaterheaters.pages.dev\n',
      stderr: '',
    });

    const out = await cf.deployBlog({ blog: BLOG, files: FILES, run });

    assert.strictEqual(out.ok, true);

    /* TWO ADDRESSES, AND THE SCREEN WANTS THE SECOND.
     *
     *   deploymentUrl  this deploy, for ever
     *   url            the project, so always whatever is newest
     *
     * The hash changes every publish, so a stored deploymentUrl shows an
     * old copy of the site a week later. It is also two subdomain levels
     * deep, which `*.pages.dev` does not cover — on a new project it
     * fails TLS for a few minutes while Cloudflare issues the certificate
     * for that level. Edwin hit exactly that on the first working deploy
     * and thought the site was broken when it was live. */
    assert.strictEqual(out.deploymentUrl, 'https://a1b2c3d4.leanderwaterheaters.pages.dev');
    assert.strictEqual(out.url, 'https://leanderwaterheaters.pages.dev');
    assert.strictEqual(out.files, Object.keys(FILES).length);
  });
});

test('AND A DEPLOY WITH NO URL IN IT IS STILL A SUCCESS', async () => {
  /* The URL is wrangler's wording, and wording changes. Treating its
   * absence as a failure would turn a cosmetic release note into a blog
   * that reports itself broken after publishing correctly. */
  await withEnv(async () => {
    const run = recorder({ code: 0, stdout: 'Deployment complete.\n', stderr: '' });
    const out = await cf.deployBlog({ blog: BLOG, files: FILES, run });

    assert.strictEqual(out.ok, true, 'a successful deploy was reported as a failure');
    assert.strictEqual(out.url, null);
  });
});

test('a non-zero exit is a failure, with the output kept for the log', async () => {
  await withEnv(async () => {
    const run = recorder({ code: 1, stdout: '', stderr: 'Project not found [code: 8000007]' });
    const out = await cf.deployBlog({ blog: BLOG, files: FILES, run });

    assert.strictEqual(out.ok, false);
    assert.ok(out.error, 'the failure has no message');
    assert.ok(out.output.includes('8000007'),
      "wrangler's reason was thrown away, so nobody can tell why it failed");
  });
});

/* ======================================================================= */

section('THE FIRST DEPLOY SETS THE BLOG UP');

/* WHY ANY OF THIS EXISTS, 17–18 OCTOBER.
 *
 * The first real deploy failed with "The Pages project does not exist",
 * because `wrangler pages deploy --project-name=X` does not create X —
 * Cloudflare's own error says to run `pages project create` first. Edwin
 * created it by hand over ssh. That is not a step a customer will do.
 *
 * Then the site was live at a pages.dev address Cloudflare invented,
 * while every absolute URL on it named the domain he had typed. Attaching
 * the domain is what makes those agree, and wrangler has no command for
 * it — so it is a REST call, the only one in this codebase. */

/**
 * A pointDomainAtProject() that records and answers however it is told.
 *
 * TWO HALVES IN THE ANSWER, BECAUSE THEY FAIL SEPARATELY. Registering the
 * domain on the project and creating the CNAME are different calls with
 * different permissions, and the day that mattered the first succeeded
 * and the second never happened: the log said the domain was attached
 * while the browser said NXDOMAIN.
 */
function attacher(answer = { attached: { ok: true, status: 'pending' }, dns: { ok: true, created: true } }) {
  const calls = [];
  const attach = async (opts) => { calls.push(opts); return answer; };
  attach.calls = calls;
  return attach;
}

test('THE PROJECT IS CREATED BEFORE THE DEPLOY, NOT AFTER', async () => {
  await withEnv(async () => {
    const run = recorder();
    const attach = attacher();

    const out = await cf.deployBlog({ blog: FRESH_BLOG, files: FILES, run, attach });

    assert.strictEqual(out.ok, true, out.error);
    assert.strictEqual(run.calls.length, 2, 'the create and the deploy are not both there');

    assert.deepStrictEqual(run.calls[0].args,
      ['pages', 'project', 'create', 'leanderwaterheaters-com', '--production-branch=main']);

    assert.strictEqual(run.calls[1].args[1], 'deploy', 'the deploy did not run second');
  });
});

test('AND ON THE PRODUCTION BRANCH THE DEPLOY ACTUALLY USES', async () => {
  /* NOT A DETAIL. The deploy passes --branch=main. A project whose
   * production branch is anything else treats every one of our deploys as
   * a PREVIEW: each lands on its own hashed address and the project's own
   * <name>.pages.dev serves nothing. The site would be live, reachable,
   * and at an address that changes every publish. */
  await withEnv(async () => {
    const run = recorder();
    await cf.deployBlog({ blog: FRESH_BLOG, files: FILES, run, attach: attacher() });

    const created = run.calls[0].args;
    const deployed = run.calls[1].args;

    const branch = (deployed.find(a => a.startsWith('--branch=')) || '').split('=')[1];
    const production = (created.find(a => a.startsWith('--production-branch=')) || '').split('=')[1];

    assert.ok(branch, 'the deploy names no branch');
    assert.strictEqual(production, branch,
      'the project was created on a different branch than the deploy pushes to');
  });
});

test('THE DOMAIN IS ATTACHED, AND IT IS THE BLOG\'S OWN', async () => {
  await withEnv(async () => {
    const attach = attacher();
    await cf.deployBlog({ blog: FRESH_BLOG, files: FILES, run: recorder(), attach });

    assert.strictEqual(attach.calls.length, 1, 'the domain was never attached');

    /* THE TARGET IS THE PROJECT'S REAL HOSTNAME, stripped of the
     * deployment hash — not a name built from the project. Cloudflare
     * does not always grant the subdomain a project's name asks for, and
     * a CNAME derived from the name would be right until the first
     * collision and then point at somebody else's site. */
    /* THE THREE FIELDS IT MEANS, NOT THE WHOLE OPTION BAG — 22 October.
     * This was a deepStrictEqual and it broke the moment deployBlog gained
     * a `creds` option, reporting a mismatch of `creds: undefined` against
     * entirely correct code. An exact-shape assertion on an options object
     * makes every future argument a false failure. */
    const { project, domain, target } = attach.calls[0];

    assert.strictEqual(project, 'leanderwaterheaters-com');
    assert.strictEqual(domain, 'leanderwaterheaters.com');
    assert.strictEqual(target, 'leanderwaterheaters.pages.dev');
  });
});

test('NONE OF IT HAPPENS AGAIN ON A BLOG THAT HAS PUBLISHED', async () => {
  /* `project` is written after the first successful deploy, so its
   * emptiness already means "never published". Using it as the signal
   * costs nothing: the hundredth deploy of a year-old blog makes one
   * wrangler call and no API call at all. */
  await withEnv(async () => {
    const run = recorder();
    const attach = attacher();

    await cf.deployBlog({ blog: BLOG, files: FILES, run, attach });

    assert.strictEqual(run.calls.length, 1, 'an established blog re-ran the setup');
    assert.strictEqual(run.calls[0].args[1], 'deploy');
    assert.strictEqual(attach.calls.length, 0, 'an established blog re-attached its domain');
  });
});

test('A DOMAIN THAT WILL NOT ATTACH DOES NOT STOP THE PUBLISH', async () => {
  /* The domain may not be in this Cloudflare account, the token may be
   * short a DNS permission on the zone, or it may already be attached.
   * None of those is a reason to refuse to publish articles that are
   * written and paid for — the pages.dev address still serves them. */
  await withEnv(async () => {
    const attach = attacher({
      attached: { ok: true, status: 'pending' },
      dns: { ok: false, error: 'Zone not found [code: 1049]' },
    });
    const out = await cf.deployBlog({ blog: FRESH_BLOG, files: FILES, run: recorder(), attach });

    assert.strictEqual(out.ok, true, 'a failed DNS record killed the deploy');
    assert.strictEqual(out.setup.dns.ok, false);
    assert.match(out.setup.dns.error, /1049/, 'Cloudflare\'s reason was thrown away');

    /* AND THE OTHER HALF STILL REPORTS ITS OWN SUCCESS. Collapsing the
     * two into one boolean is what let "attached: true, resolves: never"
     * look like a working blog. */
    assert.strictEqual(out.setup.attached.ok, true);
  });
});

test('NOR DOES A PROJECT THAT WAS ALREADY THERE', async () => {
  /* The create fails when the project exists, and that is the common case
   * on a retry: the first attempt created it and the deploy then failed,
   * so `project` was never stored. This code does not try to tell "name
   * taken by you" from "name taken by someone else" — the deploy that
   * runs next is the authority. */
  await withEnv(async () => {
    const run = recorder((args) => (
      'create' === args[2]
        ? { code: 1, stdout: '', stderr: 'A project with this name already exists' }
        : { code: 0, stdout: 'https://abc123.leanderwaterheaters.pages.dev\n', stderr: '' }
    ));

    const out = await cf.deployBlog({ blog: FRESH_BLOG, files: FILES, run, attach: attacher() });

    assert.strictEqual(out.ok, true, 'an existing project stopped the deploy');
    assert.strictEqual(out.setup.created, false);
  });
});

test('BUT A FAILED CREATE IS SHOWN WHEN THE DEPLOY FAILS TOO', async () => {
  /* "The Pages project does not exist", with no explanation of why it was
   * not created, is the error Edwin spent an evening on. If the create
   * really did fail, its reason belongs on the same screen. */
  await withEnv(async () => {
    const run = recorder((args) => (
      'create' === args[2]
        ? { code: 1, stdout: '', stderr: 'Authentication error [code: 10000]' }
        : { code: 1, stdout: '', stderr: 'The Pages project does not exist.' }
    ));

    const out = await cf.deployBlog({ blog: FRESH_BLOG, files: FILES, run, attach: attacher() });

    assert.strictEqual(out.ok, false);
    assert.match(out.output, /10000/, 'the create failure was swallowed');
    assert.match(out.output, /does not exist/, 'the deploy failure was lost');
  });
});

/* ---------------------------------------------------------- worth a retry */

test('AND THAT ONE FAILURE IS MARKED AS WORTH RETRYING', async () => {
  /* THE ONLY PUBLISH FAILURE A RETRY ACTUALLY FIXES, and the screen could
   * not tell it from the ones that never fix themselves.
   *
   * 19 October: a 10-article campaign died on `[code: 8000000]` — a
   * Cloudflare internal error with no detail — and the screen showed two
   * raw wrangler errors, the second of them ("the project does not exist")
   * being nothing but a consequence of the first. Edwin could not tell
   * which half had broken, or whether to wait, fix a token or call
   * support. Hours later the identical publish worked untouched.
   *
   * BOTH HALVES ARE REQUIRED, and the tests below are about why. "The
   * create did not succeed" alone is not enough: ensureProject() returns
   * created:false for a refusal AND for a project that was already there,
   * and it refuses on purpose to tell them apart. So the deploy has to
   * ALSO say the project is missing. Together they mean one thing only:
   * the project genuinely is not there, which is genuinely why the deploy
   * failed, and waiting is genuinely the right advice. */
  await withEnv(async () => {
    const run = recorder((args) => (
      'create' === args[2]
        ? { code: 1, stdout: '', stderr: 'An unknown error occurred [code: 8000000]' }
        : { code: 1, stdout: '', stderr: 'The Pages project "leanderwaterheaters-com" does not exist.' }
    ));

    const out = await cf.deployBlog({ blog: FRESH_BLOG, files: FILES, run, attach: attacher() });

    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.projectMissing, true, 'the one retryable failure is not marked');
  });
});

test('BUT NOT WHEN THE CREATE ITSELF WORKED', async () => {
  /* A project that was created and then reported missing is not a wait —
   * it is something stranger, and telling somebody to try again in a few
   * minutes would be a guess dressed up as instruction. This is the test
   * that keeps the flag from collapsing into "the deploy said the project
   * is missing", which is the half anyone would reach for first. */
  await withEnv(async () => {
    const run = recorder((args) => (
      'create' === args[2]
        ? { code: 0, stdout: 'Successfully created the project', stderr: '' }
        : { code: 1, stdout: '', stderr: 'The Pages project "leanderwaterheaters-com" does not exist.' }
    ));

    const out = await cf.deployBlog({ blog: FRESH_BLOG, files: FILES, run, attach: attacher() });

    assert.strictEqual(out.ok, false);
    assert.notStrictEqual(out.projectMissing, true,
      'a created project reported missing was offered a pointless retry');
  });
});

test('NOR WHEN THE DEPLOY FAILED FOR ITS OWN REASON', async () => {
  /* THE OTHER HALF, AND THE ONE THAT MATTERS MOST. A token short a
   * permission never fixes itself, so "try again in a few minutes" sends
   * somebody away to wait for a thing that will never happen. The create
   * failing is not licence to offer a retry; the deploy has to say the
   * project is the problem. */
  await withEnv(async () => {
    const run = recorder((args) => (
      'create' === args[2]
        ? { code: 1, stdout: '', stderr: 'An unknown error occurred [code: 8000000]' }
        : { code: 1, stdout: '', stderr: 'Authentication error [code: 10000]' }
    ));

    const out = await cf.deployBlog({ blog: FRESH_BLOG, files: FILES, run, attach: attacher() });

    assert.strictEqual(out.ok, false);
    assert.notStrictEqual(out.projectMissing, true,
      'a token with the wrong permission was told to wait a few minutes');
  });
});

test('THE DEPLOY IS WHAT IS READ, NOT THE CREATE', async () => {
  /* WHICH OUTPUT THE PHRASE IS LOOKED FOR IN. The combined text is what
   * goes to the screen, and searching THAT would mean a create whose own
   * complaint mentions a missing project decides the verdict — when the
   * step that actually could not find the project is the deploy. Found by
   * mutation: swapping `output` for `full` survived the suite. */
  await withEnv(async () => {
    const run = recorder((args) => (
      'create' === args[2]
        ? { code: 1, stdout: '', stderr: 'The Pages project template does not exist [code: 8000013]' }
        : { code: 1, stdout: '', stderr: 'Authentication error [code: 10000]' }
    ));

    const out = await cf.deployBlog({ blog: FRESH_BLOG, files: FILES, run, attach: attacher() });

    assert.strictEqual(out.ok, false);
    assert.notStrictEqual(out.projectMissing, true,
      "the create's own complaint was allowed to pass for the deploy's");
  });
});

test('AND NEVER ON A BLOG THAT HAS ALREADY PUBLISHED', async () => {
  /* No setup runs on an established blog, so there is no failed create to
   * blame and nothing a wait would mend. A project missing HERE means
   * somebody deleted it in the dashboard — which is a thing to be told
   * about, not a thing to sit out. */
  await withEnv(async () => {
    const run = recorder({
      code: 1, stdout: '', stderr: 'The Pages project "leanderwaterheaters-com" does not exist.',
    });

    const out = await cf.deployBlog({ blog: BLOG, files: FILES, run, attach: attacher() });

    assert.strictEqual(out.ok, false);
    assert.notStrictEqual(out.projectMissing, true,
      'a deleted project on a live blog was reported as a passing Cloudflare mood');
  });
});

test('THE SETUP CALLS CARRY THE SAME SCRUBBED ENVIRONMENT', async () => {
  /* childEnv() hands the child PATH, HOME and the Cloudflare pair and
   * nothing else — this process also holds the Mongo URI, the OpenAI key
   * and the Stripe secret. A create that was handed process.env would be
   * a hole the deploy does not have. */
  await withEnv(async () => {
    const run = recorder();
    await cf.deployBlog({ blog: FRESH_BLOG, files: FILES, run, attach: attacher() });

    for (const call of run.calls) {
      assert.deepStrictEqual(Object.keys(call.opts.env).sort(), [
        'CI', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'HOME', 'PATH',
        'WRANGLER_SEND_METRICS',
      ], 'a child was handed more of the environment than it needs');
    }
  });
});

section('TAKING A PROJECT AWAY');

test('IT ANSWERS THE CONFIRMATION NOBODY IS THERE TO ANSWER', async () => {
  /* THE SURVIVING MUTANT THIS CLOSES. Dropping `--yes` killed no test:
   * the route's suite stubs deleteProject, so it never saw the arguments,
   * and nothing here called it at all.
   *
   * Without the flag wrangler prompts and waits. There is no terminal —
   * this runs inside a web request — so it waits until DEPLOY_TIMEOUT_MS
   * kills it, five minutes later, and the screen reports a timeout for a
   * delete that was one keystroke from working. The confirmation already
   * happened, on a page that made the owner type the domain. */
  await withEnv(async () => {
    const run = recorder({ code: 0, stdout: 'Successfully deleted\n', stderr: '' });

    const out = await cf.deleteProject({ project: 'leanderwaterheaters-com', env: {}, run });

    assert.strictEqual(out.ok, true);
    assert.deepStrictEqual(run.calls[0].args,
      ['pages', 'project', 'delete', 'leanderwaterheaters-com', '--yes']);
  });
});

test('A FAILURE IS A RESULT WITH THE REASON IN IT', async () => {
  /* The caller deletes our own records either way — a blog that cannot be
   * removed because Cloudflare refused is a blog nobody can ever remove.
   * So the reason has to travel rather than throw. */
  await withEnv(async () => {
    const run = recorder({ code: 1, stdout: '', stderr: 'Authentication error [code: 10000]' });

    const out = await cf.deleteProject({ project: 'p', env: {}, run });

    assert.strictEqual(out.ok, false);
    assert.match(out.output, /10000/);
  });
});

test('AND NO PROJECT NAME IS NOT A WRANGLER CALL', async () => {
  await withEnv(async () => {
    const run = recorder();
    const out = await cf.deleteProject({ project: '', env: {}, run });

    assert.strictEqual(out.ok, false);
    assert.strictEqual(run.calls.length, 0, 'wrangler was asked to delete nothing');
  });
});

section('THE DNS RECORD, WHICH IS THE HALF THAT WAS MISSING');

/* 18 OCTOBER, AND THE SHAPE OF THE BUG IS WORTH KEEPING.
 *
 * Edwin published to all-about-plumbing.explr-home.com. Our log said
 * `domainAttached: true`. His browser said DNS_PROBE_FINISHED_NXDOMAIN.
 * Both were telling the truth.
 *
 * Adding a custom domain to a Pages project over the API registers it
 * and stops. Cloudflare answers success, the domain sits at `pending`,
 * and it waits for a DNS record that the API — unlike the dashboard —
 * never creates. The site was live and unreachable for an hour.
 *
 * So the domain work is two calls now, each able to fail on its own, and
 * reported separately for exactly that reason. */

/** A fetch that answers by URL and records what it was asked. */
function cfFetch(routes) {
  const calls = [];

  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts, body: opts && opts.body ? JSON.parse(opts.body) : null });

    for (const [match, answer] of routes) {
      if (url.includes(match)) {
        const value = 'function' === typeof answer ? answer(url, opts) : answer;
        return {
          ok: false !== value.ok,
          status: value.status || 200,
          json: async () => value.json,
        };
      }
    }

    throw new Error(`no stub for ${url}`);
  };

  fetchImpl.calls = calls;
  return fetchImpl;
}

const found = (result) => ({ json: { success: true, result } });
const refused = (code, message, status = 400) =>
  ({ ok: false, status, json: { success: false, errors: [{ code, message }] } });

test('THE ZONE IS FOUND BY WALKING UP THE NAME', async () => {
  /* There is no way to read the zone off the string: `co.uk` is not a
   * zone and `blog.example.com` sometimes is one. Each suffix is offered
   * to Cloudflare and the first it recognises wins. */
  await withEnv(async () => {
    const fetchImpl = cfFetch([
      ['zones?name=all-about-plumbing.explr-home.com', found([])],
      ['zones?name=explr-home.com', found([{ id: 'zone1', name: 'explr-home.com' }])],
    ]);

    const out = await cf.findZone({ domain: 'all-about-plumbing.explr-home.com', fetchImpl });

    assert.strictEqual(out.ok, true, out.error);
    assert.strictEqual(out.id, 'zone1');
    assert.strictEqual(out.name, 'explr-home.com');

    assert.strictEqual(fetchImpl.calls.length, 2,
      'it did not try the most specific name first');
  });
});

test('AND THE MOST SPECIFIC ZONE WINS', async () => {
  /* Somebody who has delegated blog.example.com as its own zone means it.
   * Walking shortest-first would hand them example.com and put the record
   * in the wrong place. */
  await withEnv(async () => {
    const fetchImpl = cfFetch([
      ['zones?name=blog.example.com', found([{ id: 'inner', name: 'blog.example.com' }])],
      ['zones?name=example.com', found([{ id: 'outer', name: 'example.com' }])],
    ]);

    const out = await cf.findZone({ domain: 'blog.example.com', fetchImpl });

    assert.strictEqual(out.id, 'inner', 'it chose the parent zone over the delegated one');
  });
});

test('IT STOPS BEFORE ASKING ABOUT PUBLIC SUFFIXES', async () => {
  /* Nobody owns `com`. Asking is a request per deploy for a guaranteed
   * miss, and the answer would be alarming if it ever came back yes. */
  await withEnv(async () => {
    const fetchImpl = cfFetch([['zones?name=', found([])]]);

    await cf.findZone({ domain: 'a.b.example.com', fetchImpl });

    const asked = fetchImpl.calls.map(c => decodeURIComponent(c.url.split('name=')[1]));

    assert.deepStrictEqual(asked, ['a.b.example.com', 'b.example.com', 'example.com'],
      'it asked about a public suffix, or skipped a candidate');
  });
});

test('A TOKEN WITHOUT ZONE:READ SAYS SO ONCE, NOT THREE TIMES', async () => {
  await withEnv(async () => {
    const fetchImpl = cfFetch([
      ['zones?name=', refused(9109, 'Unauthorized to access requested resource', 403)],
    ]);

    const out = await cf.findZone({ domain: 'a.b.example.com', fetchImpl });

    assert.strictEqual(out.ok, false);
    assert.match(out.error, /9109/);
    assert.strictEqual(fetchImpl.calls.length, 1, 'it kept asking after a permission failure');
  });
});

test('A ZONE IN SOMEBODY ELSE\'S ACCOUNT IS NOT AN ERROR, JUST A MISS', async () => {
  /* A domain at a registrar that is not Cloudflare is a normal way to run
   * a blog. It means the record is somebody else's job, not that the
   * deploy went wrong. */
  await withEnv(async () => {
    const fetchImpl = cfFetch([['zones?name=', found([])]]);
    const out = await cf.findZone({ domain: 'notmine.example', fetchImpl });

    assert.strictEqual(out.ok, false);
    assert.match(out.error, /No zone in this Cloudflare account/);
  });
});

test('THE RECORD IS A PROXIED CNAME AT THE FULL HOSTNAME', async () => {
  /* PROXIED IS NOT A PREFERENCE. An unproxied CNAME to pages.dev reaches
   * Cloudflare's edge without the routing that maps the hostname to this
   * project, and at an apex it cannot exist at all — CNAME flattening is
   * a proxy feature. Orange cloud or nothing. */
  await withEnv(async () => {
    const fetchImpl = cfFetch([
      ['dns_records?name=', found([])],
      ['/dns_records', found({ id: 'rec1' })],
    ]);

    const out = await cf.ensureDnsRecord({
      zoneId: 'zone1',
      name: 'all-about-plumbing.explr-home.com',
      target: 'all-about-plumbing-explr-home-com.pages.dev',
      fetchImpl,
    });

    assert.strictEqual(out.ok, true, out.error);
    assert.strictEqual(out.created, true);

    const post = fetchImpl.calls.find(c => c.opts.method === 'POST');

    assert.ok(post, 'no record was created');
    assert.deepStrictEqual(post.body, {
      type: 'CNAME',
      name: 'all-about-plumbing.explr-home.com',
      content: 'all-about-plumbing-explr-home-com.pages.dev',
      proxied: true,
      ttl: 1,
    });
  });
});

test('AN IDENTICAL RECORD IS LEFT ALONE AND REPORTED AS FINE', async () => {
  /* Every deploy of a blog whose first one failed part way would
   * otherwise try to create it again and report the duplicate as a
   * failure. */
  await withEnv(async () => {
    const fetchImpl = cfFetch([
      ['dns_records?name=', found([{ type: 'CNAME', content: 'x.pages.dev' }])],
    ]);

    const out = await cf.ensureDnsRecord({
      zoneId: 'z', name: 'blog.example.com', target: 'x.pages.dev', fetchImpl,
    });

    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.created, false);
    assert.strictEqual(fetchImpl.calls.length, 1, 'it wrote a record that was already there');
  });
});

test('AND A RECORD POINTING SOMEWHERE ELSE IS NEVER OVERWRITTEN', async () => {
  /* THE WORST BUG THIS FILE COULD HAVE. Something already answers at that
   * name — it could be a live site, a mail host, anything. A deploy that
   * silently repointed it would take down something nobody connected to
   * publishing a blog. It is reported and left exactly as it was. */
  await withEnv(async () => {
    const fetchImpl = cfFetch([
      ['dns_records?name=', found([{ type: 'A', content: '203.0.113.9' }])],
    ]);

    const out = await cf.ensureDnsRecord({
      zoneId: 'z', name: 'blog.example.com', target: 'x.pages.dev', fetchImpl,
    });

    assert.strictEqual(out.ok, false);
    assert.match(out.error, /203\.0\.113\.9/, 'it does not say what is there now');
    assert.match(out.error, /left alone/);

    assert.ok(!fetchImpl.calls.some(c => c.opts.method === 'POST'),
      'IT OVERWROTE SOMEBODY ELSE\'S DNS RECORD');
  });
});

test('BOTH HALVES RUN, AND EITHER CAN FAIL ALONE', async () => {
  /* The exact state Edwin's token was in: Pages permissions but no Zone
   * permissions. The domain registers, the record cannot be made, and the
   * answer has to say both things rather than one. */
  await withEnv(async () => {
    const fetchImpl = cfFetch([
      ['/pages/projects/', found({ status: 'pending' })],
      ['zones?name=', refused(9109, 'Unauthorized to access requested resource', 403)],
    ]);

    const out = await cf.pointDomainAtProject({
      project: 'p', domain: 'blog.example.com', target: 'p.pages.dev', fetchImpl,
    });

    assert.strictEqual(out.attached.ok, true, 'the domain was not registered');
    assert.strictEqual(out.dns.ok, false, 'the DNS failure was not reported');
    assert.match(out.dns.error, /9109/);
  });
});

test('AND ON THE HAPPY PATH BOTH SUCCEED', async () => {
  await withEnv(async () => {
    const fetchImpl = cfFetch([
      ['/pages/projects/', found({ status: 'pending' })],
      ['zones?name=blog.example.com', found([])],
      ['zones?name=example.com', found([{ id: 'z', name: 'example.com' }])],
      ['dns_records?name=', found([])],
      ['/dns_records', found({ id: 'r' })],
    ]);

    const out = await cf.pointDomainAtProject({
      project: 'p', domain: 'blog.example.com', target: 'p.pages.dev', fetchImpl,
    });

    assert.strictEqual(out.attached.ok, true);
    assert.strictEqual(out.dns.ok, true);
    assert.strictEqual(out.dns.created, true);
    assert.strictEqual(out.zone, 'example.com');
    assert.strictEqual(out.url, 'https://blog.example.com/');
  });
});

section('GIVING THE DOMAIN BACK, WHICH IS THE DANGEROUS DIRECTION');

/* THE MIRROR THAT WAS MISSING. The app created a Pages project, a custom
 * domain and a DNS record, and deleting a blog removed none of them —
 * every deleted blog left three things in Cloudflare that nothing could
 * ever reach again.
 *
 * AND IT RUNS AGAINST A LIVE ZONE. Edwin's domain also serves a blog he
 * cares about, and his first question on hearing the plan was whether
 * this would take it down. It cannot, and these are the assertions that
 * keep it that way: the record has to match by NAME and by CONTENT
 * before anything is deleted. */

test('THE DOMAIN COMES OFF THE PROJECT BY NAME', async () => {
  await withEnv(async () => {
    const fetchImpl = cfFetch([['/domains/', found({})]]);

    const out = await cf.detachDomain({
      project: 'all-about-roofing-explr-home-com',
      domain: 'all-about-roofing.explr-home.com',
      fetchImpl,
    });

    assert.strictEqual(out.ok, true, out.error);
    assert.strictEqual(fetchImpl.calls[0].opts.method, 'DELETE');
    assert.ok(fetchImpl.calls[0].url.endsWith(
      '/pages/projects/all-about-roofing-explr-home-com/domains/all-about-roofing.explr-home.com'),
      'it addressed something other than this one hostname');
  });
});

test('THE CNAME IS REMOVED ONLY WHEN THE NAME AND THE TARGET BOTH MATCH', async () => {
  await withEnv(async () => {
    const fetchImpl = cfFetch([
      ['dns_records?name=', found([{ id: 'rec9', type: 'CNAME', content: 'p.pages.dev' }])],
      ['dns_records/rec9', found({})],
    ]);

    const out = await cf.removeDnsRecord({
      zoneId: 'z', name: 'blog.example.com', expected: 'p.pages.dev', fetchImpl,
    });

    assert.strictEqual(out.ok, true, out.error);
    assert.strictEqual(out.removed, true);

    const del = fetchImpl.calls.find(c => c.opts.method === 'DELETE');
    assert.ok(del && del.url.includes('/dns_records/rec9'), 'the wrong record was deleted');
  });
});

test('A CNAME POINTING SOMEWHERE ELSE IS NEVER DELETED', async () => {
  /* Somebody repointed that subdomain at their own thing. The name
   * matches and it is still not ours. */
  await withEnv(async () => {
    const fetchImpl = cfFetch([
      ['dns_records?name=', found([{ id: 'r', type: 'CNAME', content: 'something-else.example' }])],
    ]);

    const out = await cf.removeDnsRecord({
      zoneId: 'z', name: 'blog.example.com', expected: 'p.pages.dev', fetchImpl,
    });

    assert.strictEqual(out.ok, false);
    assert.match(out.error, /something-else\.example/, 'it does not say what it found');
    assert.match(out.error, /left alone/);
    assert.ok(!fetchImpl.calls.some(c => c.opts.method === 'DELETE'),
      'IT DELETED A DNS RECORD THAT WAS NOT OURS');
  });
});

test('AND NEITHER IS AN A RECORD, WHATEVER IT POINTS AT', async () => {
  /* The live site on the same domain. A delete here would take it down,
   * and nobody would connect the outage to having removed a blog. */
  await withEnv(async () => {
    const fetchImpl = cfFetch([
      ['dns_records?name=', found([{ id: 'r', type: 'A', content: '203.0.113.9' }])],
    ]);

    const out = await cf.removeDnsRecord({
      zoneId: 'z', name: 'example.com', expected: 'p.pages.dev', fetchImpl,
    });

    assert.strictEqual(out.ok, false);
    assert.ok(!fetchImpl.calls.some(c => c.opts.method === 'DELETE'),
      'IT DELETED AN A RECORD');
  });
});

test('AND AN A RECORD IS REFUSED EVEN WITH NOTHING TO COMPARE AGAINST', async () => {
  /* THE SURVIVING MUTANT, AND THE MOST DANGEROUS ONE IN THIS FILE.
   *
   * Dropping the `'CNAME' !== record.type` half of the guard killed no
   * test, because every A-record case here also had a mismatched
   * `expected` doing the work. Take away the expected target — a blog
   * deleted before it ever deployed has no stored URL — and the type
   * check is the ONLY thing standing between a tidy-up and deleting the
   * A record of a live site on the same domain.
   *
   * Which is exactly the thing Edwin asked about before agreeing to any
   * of this. */
  await withEnv(async () => {
    const fetchImpl = cfFetch([
      ['dns_records?name=', found([{ id: 'r', type: 'A', content: '203.0.113.9' }])],
    ]);

    const out = await cf.removeDnsRecord({ zoneId: 'z', name: 'example.com', fetchImpl });

    assert.strictEqual(out.ok, false, 'an A record was accepted for deletion');
    assert.ok(!fetchImpl.calls.some(c => c.opts.method === 'DELETE'),
      'IT DELETED THE A RECORD OF A LIVE SITE');
  });
});

test('A RECORD THAT IS ALREADY GONE IS A SUCCESS, NOT A FAILURE', async () => {
  /* Somebody tidied up by hand, or the deploy never got that far.
   * Nothing to do, and nothing broken. */
  await withEnv(async () => {
    const fetchImpl = cfFetch([['dns_records?name=', found([])]]);

    const out = await cf.removeDnsRecord({
      zoneId: 'z', name: 'blog.example.com', expected: 'p.pages.dev', fetchImpl,
    });

    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.removed, false);
  });
});

test('WITH NO EXPECTED TARGET, ANY CNAME AT THAT NAME IS OURS', async () => {
  /* A blog deleted before it ever deployed has no stored URL to compare
   * against. The name check still holds — and it is the name that was
   * typed into this app, for a blog this app created. */
  await withEnv(async () => {
    const fetchImpl = cfFetch([
      ['dns_records?name=', found([{ id: 'r', type: 'CNAME', content: 'anything.pages.dev' }])],
      ['dns_records/r', found({})],
    ]);

    const out = await cf.removeDnsRecord({
      zoneId: 'z', name: 'blog.example.com', fetchImpl,
    });

    assert.strictEqual(out.ok, true, out.error);
    assert.strictEqual(out.removed, true);
  });
});

test('A TRAILING DOT ON THE STORED TARGET DOES NOT DEFEAT THE MATCH', async () => {
  /* Cloudflare returns some record contents fully qualified. Comparing
   * raw strings would refuse to clean up a record that is plainly ours,
   * and leave an orphan behind every single time. */
  await withEnv(async () => {
    const fetchImpl = cfFetch([
      ['dns_records?name=', found([{ id: 'r', type: 'CNAME', content: 'p.pages.dev.' }])],
      ['dns_records/r', found({})],
    ]);

    const out = await cf.removeDnsRecord({
      zoneId: 'z', name: 'blog.example.com', expected: 'p.pages.dev', fetchImpl,
    });

    assert.strictEqual(out.ok, true, out.error);
    assert.strictEqual(out.removed, true);
  });
});

test('THE WHOLE TEARDOWN DETACHES BEFORE IT TOUCHES DNS', async () => {
  await withEnv(async () => {
    const fetchImpl = cfFetch([
      ['/domains/', found({})],
      ['zones?name=blog.example.com', found([])],
      ['zones?name=example.com', found([{ id: 'z', name: 'example.com' }])],
      ['dns_records?name=', found([{ id: 'r', type: 'CNAME', content: 'p.pages.dev' }])],
      ['dns_records/r', found({})],
    ]);

    const out = await cf.releaseDomain({
      project: 'p', domain: 'blog.example.com', expected: 'p.pages.dev', fetchImpl,
    });

    assert.strictEqual(out.detached.ok, true);
    assert.strictEqual(out.dns.ok, true);
    assert.strictEqual(out.dns.removed, true);

    const order = fetchImpl.calls.map(c => c.url);
    assert.ok(order[0].includes('/domains/'),
      'it went for DNS before unlinking the domain from the project');
  });
});

test('AND A ZONE IT CANNOT SEE IS REPORTED, NOT THROWN', async () => {
  /* The domain may be in another Cloudflare account, or the token may
   * lack Zone:Read. Neither is a reason to fail a delete the person has
   * already confirmed by typing their domain. */
  await withEnv(async () => {
    const fetchImpl = cfFetch([
      ['/domains/', found({})],
      ['zones?name=', found([])],
    ]);

    const out = await cf.releaseDomain({ project: 'p', domain: 'blog.example.com', fetchImpl });

    assert.strictEqual(out.detached.ok, true);
    assert.strictEqual(out.dns.ok, false);
    assert.match(out.dns.error, /No zone in this Cloudflare account/);
  });
});

section('ATTACHING THE DOMAIN, WHICH IS A REST CALL');

/* wrangler covers projects, deployments and secrets. Custom domains are
 * dashboard or API only, so this one call is made with fetch — which is
 * why it is tested against an injected fetch rather than the network. */

test('IT POSTS THE DOMAIN TO THE PROJECT, AUTHENTICATED', async () => {
  await withEnv(async () => {
    const seen = [];
    const fetchImpl = async (url, opts) => {
      seen.push({ url, opts });
      return { ok: true, status: 200, json: async () => ({ success: true, result: { status: 'pending' } }) };
    };

    const out = await cf.attachDomain({
      project: 'leanderwaterheaters-com',
      domain: 'blog.leanderwaterheaters.com',
      fetchImpl,
    });

    assert.strictEqual(out.ok, true);
    assert.strictEqual(seen[0].url,
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/pages/projects/leanderwaterheaters-com/domains`);
    assert.strictEqual(seen[0].opts.method, 'POST');
    assert.strictEqual(seen[0].opts.headers.Authorization, `Bearer ${TOKEN}`);
    assert.deepStrictEqual(JSON.parse(seen[0].opts.body), { name: 'blog.leanderwaterheaters.com' });
  });
});

test('AND IT DOES NOT FOLLOW A REDIRECT CARRYING THE TOKEN', async () => {
  /* The same rule blogScheduler.js follows. A redirect from an endpoint
   * we authenticate to would hand the bearer token to the second host. */
  await withEnv(async () => {
    let opts = null;
    const fetchImpl = async (_url, o) => {
      opts = o;
      return { ok: true, status: 200, json: async () => ({ success: true, result: {} }) };
    };

    await cf.attachDomain({ project: 'p', domain: 'd.example.com', fetchImpl });

    assert.strictEqual(opts.redirect, 'manual');
  });
});

test('CLOUDFLARE\'S OWN REASON IS WHAT COMES BACK', async () => {
  /* "Zone not found", "token lacks a permission" and "already attached"
   * are three different things to do next. A message of our own would
   * flatten them into one. */
  await withEnv(async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 404,
      json: async () => ({ success: false, errors: [{ code: 1049, message: 'Zone not found' }] }),
    });

    const out = await cf.attachDomain({ project: 'p', domain: 'd.example.com', fetchImpl });

    assert.strictEqual(out.ok, false);
    assert.match(out.error, /Zone not found/);
    assert.match(out.error, /1049/);
  });
});

test('A SUCCESS FLAG OF false IS A FAILURE, EVEN ON A 200', async () => {
  /* Cloudflare's API answers 200 with `success: false` for some
   * refusals. Reading only response.ok would call those a success and
   * store a domain that was never attached. */
  await withEnv(async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: false, errors: [{ code: 8000031, message: 'Domain already exists' }] }),
    });

    const out = await cf.attachDomain({ project: 'p', domain: 'd.example.com', fetchImpl });

    assert.strictEqual(out.ok, false, 'a refusal with a 200 status was read as success');
    assert.match(out.error, /already exists/);
  });
});

test('A THROWN REQUEST IS A RESULT, NOT AN EXCEPTION', async () => {
  /* It runs inside a deploy that must not fail because of it. */
  await withEnv(async () => {
    const fetchImpl = async () => { throw new Error('getaddrinfo ENOTFOUND'); };

    const out = await cf.attachDomain({ project: 'p', domain: 'd.example.com', fetchImpl });

    assert.strictEqual(out.ok, false);
    assert.match(out.error, /ENOTFOUND/);
  });
});

test('AND NOTHING LEAKS THE TOKEN', async () => {
  /* scrub() replaces the token anywhere it appears. Cloudflare does not
   * echo it, so this is belt and braces — and belt and braces is the
   * right amount for a value that must never reach a log. */
  await withEnv(async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ success: false, errors: [{ code: 10000, message: `Bad token ${TOKEN}` }] }),
    });

    const out = await cf.attachDomain({ project: 'p', domain: 'd.example.com', fetchImpl });

    assert.ok(!out.error.includes(TOKEN), 'the token reached the error message');
    assert.match(out.error, /redacted/);
  });
});

test('NO CREDENTIALS MEANS NO CALL AT ALL', async () => {
  const before = { t: process.env.CF_API_TOKEN, a: process.env.CF_ACCOUNT_ID };
  delete process.env.CF_API_TOKEN;
  delete process.env.CF_ACCOUNT_ID;

  try {
    let called = false;
    const fetchImpl = async () => { called = true; };

    const out = await cf.attachDomain({ project: 'p', domain: 'd.example.com', fetchImpl });

    assert.strictEqual(out.ok, false);
    assert.strictEqual(called, false, 'an unauthenticated request was sent anyway');
  } finally {
    if (before.t !== undefined) process.env.CF_API_TOKEN = before.t;
    if (before.a !== undefined) process.env.CF_ACCOUNT_ID = before.a;
  }
});

/* ======================================================================= */

/* ------------------------------------- telling "not yours" from "cannot ask"
 *
 * Added 19 October, with the domain check at blog creation. The creation
 * screen warns somebody their domain is not in their account — and it must
 * only do that when it KNOWS. No credentials and a token without Zone:Read
 * both come back ok:false too, and warning on those is a confident lie that
 * sends people hunting for a problem they do not have.
 */

test('findZone MARKS THE NO-MATCH BRANCH, SO A CALLER CAN TELL IT APART', async () => {
  await withEnv(async () => {
    const fetchImpl = cfFetch([['zones?name=', found([])]]);

    const out = await cf.findZone({ domain: 'nothing.example.com', fetchImpl });

    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.noZone, true,
      'a caller cannot tell "not in this account" from "could not ask"');
  });
});

test('AND A FAILURE TO ASK CARRIES NO SUCH MARK', async () => {
  await withEnv(async () => {
    const fetchImpl = cfFetch([['zones?name=', refused('9109', 'Unauthorized', 403)]]);

    const out = await cf.findZone({ domain: 'nothing.example.com', fetchImpl });

    assert.strictEqual(out.ok, false);
    assert.ok(!out.noZone, 'a permission failure was reported as a missing domain');
  });
});

test('THE SUGGESTER TURNS A HYPHEN BACK INTO THE DOT IT SHOULD HAVE BEEN', async () => {
  /* The exact mistake: `all-about-hvac.explr-home.com` typed as
   * `all-bout-hvac-explr-home.com`. */
  assert.strictEqual(
    cf.suggestZoneFix({ domain: 'all-bout-hvac-explr-home.com', zones: ['explr-home.com'] }).suggestion,
    'all-bout-hvac.explr-home.com');
});

test('AND SAYS NOTHING WHEN IT HAS NOTHING TO SAY', async () => {
  /* A wrong suggestion is worse than none: it invites somebody to accept
   * it. Only the one mistake it can prove is offered. */
  for (const domain of [
    'all-about-hvac.explr-home.com',
    'somewhere-else.com',
    'explr-home.com',
    '',
  ]) {
    assert.strictEqual(
      cf.suggestZoneFix({ domain, zones: ['explr-home.com'] }).suggestion, '',
      `it invented a suggestion for ${JSON.stringify(domain)}`);
  }
});

test('AND A DOMAIN THAT IS ONLY THE TAIL GETS NO SUGGESTION', async () => {
  /* FOUND BY MUTATION. Without the length guard, `-explr-home.com` leaves
   * an empty label and the suggestion becomes `.explr-home.com` — a string
   * that is not a domain, offered to somebody as the fix. */
  assert.strictEqual(
    cf.suggestZoneFix({ domain: '-explr-home.com', zones: ['explr-home.com'] }).suggestion, '');
});

test('AND IT MATCHES WHATEVER ZONE FITS, NOT JUST THE FIRST', async () => {
  assert.strictEqual(
    cf.suggestZoneFix({ domain: 'blog-second-site.com', zones: ['first-site.com', 'second-site.com'] }).suggestion,
    'blog.second-site.com');
});


(async () => {
  for (const run of queue) await run();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
