// test-github-setup.js
//
// Getting a client's GitHub account ready to serve a domain.
//
// WHAT THIS IS GUARDING. The four steps were done by hand on github.com,
// once per client, and on 29 October one of them went wrong in the worst
// available way: the repository deleted was `<login>.github.io` — the root
// site, which holds the custom domain — rather than the test project beneath
// it. Every site on 7-y.xyz went down at once.
//
//     A STEP DONE BY HAND ONCE PER CLIENT IS A STEP DONE WRONG
//     ONCE PER HOWEVER MANY CLIENTS IT TAKES.
//
// NOTHING HERE TOUCHES THE NETWORK. `api` is injected and the JWT is signed
// with a key pair this file generates.
//
//   node test-github-setup.js

'use strict';

const assert = require('assert');
const crypto = require('crypto');

const {
  setupDomain, rootRepoFor, holdingPage, APEX_A, APEX_AAAA,
} = require('./utils/github/setupDomain');

let passed = 0, failed = 0;

const queue = [];
function test(name, fn) {
  queue.push(() => Promise.resolve()
    .then(fn)
    .then(() => { console.log(`  ok    ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }));
}
function section(n) { queue.push(async () => console.log(`\n${n}\n`)); }

const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const APP = { appId: '5520255', privateKey, now: new Date('2026-10-30T04:00:00Z') };

const ALL = { contents: 'write', administration: 'write', pages: 'write' };

/**
 * A GitHub account, as far as a setup can tell.
 *
 * `repoExists` AND `hasCommits` ARE SEPARATE KNOBS, because the interesting
 * case is a repository that is there and empty — which is what a root site
 * created and never pushed to looks like, and what answers 409 rather than
 * 404 to every Git Data endpoint.
 */
function hub({
  account = 'acme', permissions = ALL, repoExists = false, hasCommits = false,
  pagesStatus = 201, cnameStatus = 204,

  /* THE CERTIFICATE, WHICH IS NOT READY WHEN A DOMAIN IS FIRST ATTACHED.
   * `certState` is whatever GitHub is calling it today; `httpsEnforced` is
   * the box already being ticked, which is the second-run case. `pagesGet`
   * lets the GET fail, because a repository with Pages off answers 404 to
   * it and that must not look like a refusal to enforce. */
  certState = '', httpsEnforced = false, pagesGet = 200,
} = {}) {
  const calls = [];
  const state = {
    created: null, wrote: null, pages: null, cname: null, enforced: null,
  };

  const api = async (req) => {
    calls.push(req);

    const { method, path, body } = req;

    if (path.startsWith('/app/installations/') && 'GET' === method && !path.includes('access_tokens')) {
      return { id: 176399104, account: { login: account } };
    }

    if (path.includes('/access_tokens')) {
      return { token: 'ghs_x', expires_at: '2026-10-30T05:00:00Z', permissions };
    }

    if ('GET' === method && /^\/repos\/[^/]+\/[^/]+$/.test(path)) {
      if (repoExists) return { name: path.split('/')[3], html_url: `https://github.com${path.slice(6)}` };

      const err = new Error('GitHub: Not Found');
      err.status = 404;
      throw err;
    }

    if ('POST' === method && '/user/repos' === path) {
      state.created = body;
      return { name: body.name, html_url: `https://github.com/${account}/${body.name}` };
    }

    if ('GET' === method && path.includes('/git/ref/heads/')) {
      if (state.wrote || hasCommits) return { object: { sha: 'commit-1' } };

      /* 409, WHICH IS WHAT A REPOSITORY WITH NO COMMITS ANSWERS — not 404.
       * Getting this wrong in a fake is what made the first real publish
       * fail. */
      const err = new Error('GitHub: Git Repository is empty.');
      err.status = 409;
      throw err;
    }

    if ('GET' === method && path.includes('/git/commits/')) {
      return { sha: 'commit-1', tree: { sha: 'tree-1' } };
    }

    if ('PUT' === method && path.includes('/contents/')) {
      state.wrote = { path: path.split('/contents/')[1], body };
      return { commit: { sha: 'commit-1' } };
    }

    if ('POST' === method && path.endsWith('/pages')) {
      state.pages = body;

      if (201 === pagesStatus) return { html_url: `https://${account}.github.io/` };

      const err = new Error(409 === pagesStatus
        ? 'GitHub: Pages is already enabled'
        : 'GitHub: Resource not accessible by integration');

      err.status = pagesStatus;
      throw err;
    }

    if ('GET' === method && path.endsWith('/pages')) {
      if (200 !== pagesGet) {
        const err = new Error('GitHub: Not Found');
        err.status = pagesGet;
        throw err;
      }

      return {
        html_url: `https://${account}.github.io/`,
        cname: state.cname,
        https_enforced: null === state.enforced ? httpsEnforced : state.enforced,
        https_certificate: certState ? { state: certState } : undefined,
      };
    }

    if ('PUT' === method && path.endsWith('/pages')) {
      if (204 === cnameStatus) {
        if (undefined !== body.cname) state.cname = body.cname;
        if (undefined !== body.https_enforced) state.enforced = body.https_enforced;
        return {};
      }

      const err = new Error('GitHub: Custom domain is not properly configured');
      err.status = cnameStatus;
      err.path = path;
      throw err;
    }

    throw new Error(`the fake was asked something it does not know: ${method} ${path}`);
  };

  return { api, calls, state };
}

const run = (h, over = {}) => setupDomain({
  installationId: 176399104,
  domain: '7-y.xyz',
  api: h.api,
  ...APP,
  ...over,
});

/* ======================================================================= */

section('THE FOUR STEPS, IN ORDER');

test('IT CREATES THE ROOT SITE, NAMED FOR THE ACCOUNT', () => {
  /* `<login>.github.io` is GitHub's own name for a user's root Pages site.
   * It is not a choice — a repository called anything else is a project
   * site and cannot hold the custom domain. */
  assert.strictEqual(rootRepoFor('acme'), 'acme.github.io');
  assert.strictEqual(rootRepoFor('  ACME  '), 'acme.github.io');
});

test('and it is public, because Pages on a free account serves nothing else', async () => {
  const h = hub();

  await run(h);

  assert.strictEqual(h.state.created.name, 'acme.github.io');
  assert.strictEqual(h.state.created.private, false);
});

test('THE PAGE COMES BEFORE PAGES IS TURNED ON', async () => {
  /* Switching Pages on for an empty repository asks GitHub to serve a
   * branch that does not exist, which it refuses. The same ordering
   * publishSite() had to learn. */
  const h = hub();

  await run(h);

  const wrote = h.calls.findIndex(c => 'PUT' === c.method && c.path.includes('/contents/'));
  const pages = h.calls.findIndex(c => 'POST' === c.method && c.path.endsWith('/pages'));

  assert.ok(wrote >= 0 && pages >= 0);
  assert.ok(wrote < pages, 'Pages was switched on before there was anything to serve');
});

test('and the custom domain is attached last', async () => {
  const h = hub();

  const out = await run(h);

  assert.strictEqual(h.state.cname, '7-y.xyz');
  assert.strictEqual(out.custom.ok, true);
});

/* ======================================================================= */

section('WHAT IT MUST NOT OVERWRITE');

test('A ROOT SITE THAT ALREADY HAS A PAGE KEEPS IT', async () => {
  /* 7-y.xyz has one, put there by hand. A button that quietly replaced it
   * would be worse than a button that did nothing — and a setup meant to be
   * safe to press twice has to be safe the second time. */
  const h = hub({ repoExists: true, hasCommits: true });

  const out = await run(h);

  assert.strictEqual(out.page, 'kept');
  assert.strictEqual(h.state.wrote, null, 'it wrote over an existing root page');
});

test('and a repository that exists but is EMPTY does get one', async () => {
  /* The case a 404-versus-409 confusion hides: the repository is there, so
   * ensureRepo finds it, and every Git Data endpoint answers 409 rather
   * than 404. Treating that as an error leaves a root site serving nothing
   * for ever. */
  const h = hub({ repoExists: true, hasCommits: false });

  const out = await run(h);

  assert.strictEqual(out.created, false);
  assert.strictEqual(out.page, 'created');
  assert.strictEqual(h.state.wrote.path, 'index.html');
});

test('THE HOLDING PAGE NEVER LISTS THE SITES BENEATH IT', () => {
  /* Every client on a domain would otherwise be able to read off the
   * others — a competitor list published by the person they are paying.
   * The apex was never asked to be a directory. */
  const html = holdingPage('7-y.xyz');

  assert.ok(html.includes('7-y.xyz'));
  assert.ok(/<meta name="robots" content="noindex">/.test(html));
  assert.ok(!/<a /.test(html), 'the holding page links somewhere');
});

/* ======================================================================= */

section('PRESSING IT TWICE');

test('PAGES ALREADY ON IS A SUCCESS, NOT AN ERROR', async () => {
  const h = hub({ repoExists: true, hasCommits: true, pagesStatus: 409 });

  const out = await run(h);

  assert.strictEqual(out.pages.ok, true);
  assert.strictEqual(out.pages.already, true);
});

test('and a second run creates nothing and changes nothing', async () => {
  const h = hub({ repoExists: true, hasCommits: true, pagesStatus: 409 });

  const out = await run(h);

  assert.strictEqual(out.created, false);
  assert.strictEqual(out.page, 'kept');
  assert.strictEqual(h.state.created, null);
  assert.strictEqual(out.custom.ok, true);
});

/* ======================================================================= */

section('ENFORCE HTTPS, WHICH CANNOT BE DONE IN ONE RUN');

test('A CERTIFICATE THAT IS NOT READY IS "NOT YET", NOT A FAILURE', async () => {
  /* This is the FIRST run on every domain there will ever be. GitHub only
   * begins issuing once the DNS answers, so at the moment the domain is
   * attached there is nothing to enforce with — and a setup that reported
   * that as a failure would report a failure on every correct setup. */
  const h = hub({ repoExists: true, hasCommits: true, certState: 'authorization_pending' });

  const out = await run(h);

  assert.strictEqual(out.https.ok, false);
  assert.strictEqual(out.https.state, 'authorization_pending');
  assert.strictEqual(h.state.enforced, null, 'it tried to enforce without a certificate');
  assert.ok(/press this again/i.test(out.https.note), 'it does not say what to do next');
});

test('and GitHub\'s own word for the state is passed through, not translated', async () => {
  /* GitHub publishes a dozen certificate states and documents none of them.
   * Mapping them to friendly sentences here means the thirteenth arrives as
   * a blank — so whatever came back is quoted verbatim. */
  const h = hub({ repoExists: true, hasCommits: true, certState: 'bad_authz' });

  const out = await run(h);

  assert.ok(out.https.note.includes('bad_authz'), 'the state GitHub gave was swallowed');
});

test('NOTHING AT ALL FROM GITHUB IS ALSO "NOT YET"', async () => {
  /* A domain whose DNS has never resolved has no certificate record at all,
   * so `https_certificate` is simply absent. Reading a missing object as an
   * error would turn "you have not set your A records" into "something went
   * wrong". */
  const h = hub({ repoExists: true, hasCommits: true, certState: '' });

  const out = await run(h);

  assert.strictEqual(out.https.ok, false);
  assert.strictEqual(out.https.state, '');
  assert.ok(/DNS/.test(out.https.note), 'the actual cause is not named');
});

test('AN APPROVED CERTIFICATE GETS THE BOX TICKED', async () => {
  const h = hub({ repoExists: true, hasCommits: true, certState: 'approved' });

  const out = await run(h);

  assert.strictEqual(out.https.ok, true);
  assert.strictEqual(out.https.already, false);
  assert.strictEqual(h.state.enforced, true);
});

test('and the cname goes back with it, because losing it takes the domain down', async () => {
  /* The endpoint is a partial update and an omitted field is meant to be
   * left alone. The field omitted here would be the one whose loss takes
   * every site on the domain down at once, so it is sent again rather than
   * trusted to survive. */
  const h = hub({ repoExists: true, hasCommits: true, certState: 'approved' });

  await run(h);

  const put = h.calls.filter(c => 'PUT' === c.method && c.path.endsWith('/pages'));
  const last = put[put.length - 1];

  assert.strictEqual(last.body.https_enforced, true);
  assert.strictEqual(last.body.cname, '7-y.xyz', 'the custom domain was left out of the update');
  assert.strictEqual(h.state.cname, '7-y.xyz');
});

test('ALREADY ENFORCED IS LEFT ALONE', async () => {
  /* The third and fourth press. Writing a setting that is already set is
   * harmless here, but reporting "turned on" when nothing was touched is a
   * small lie that makes the screen untrustworthy. */
  const h = hub({
    repoExists: true, hasCommits: true, certState: 'approved', httpsEnforced: true,
  });

  const out = await run(h);

  assert.strictEqual(out.https.ok, true);
  assert.strictEqual(out.https.already, true);
  assert.strictEqual(h.state.enforced, null, 'it wrote a setting that was already set');
});

test('A CNAME THAT DID NOT TAKE SKIPS HTTPS RATHER THAN BLAMING IT', async () => {
  /* With no custom domain the site is still on <login>.github.io, which
   * GitHub already serves over HTTPS with its own certificate. There is no
   * certificate being waited for, so saying "not yet" would describe a wait
   * that is not happening. */
  const h = hub({ repoExists: true, hasCommits: true, cnameStatus: 422 });

  const out = await run(h);

  assert.strictEqual(out.custom.ok, false);
  assert.strictEqual(out.https.ok, false);
  assert.ok(/Skipped/.test(out.https.note));
  assert.ok(!/certificate is not ready/.test(out.https.note), 'it blamed a certificate nobody is waiting for');
});

test('and an unreadable Pages setting is reported rather than thrown', async () => {
  /* By this point the repository exists, the page is in it and the domain
   * is attached. A 404 on the settings read is a thing to show, not a
   * reason to call the whole setup failed. */
  const h = hub({ repoExists: true, hasCommits: true, pagesGet: 404 });

  const out = await run(h);

  assert.strictEqual(out.https.ok, false);
  assert.strictEqual(out.custom.ok, true, 'the rest of the setup was thrown away');
  assert.ok(/Could not read/.test(out.https.note));
});

/* ======================================================================= */

section('WHAT IT CANNOT DO');

test('A REFUSED CUSTOM DOMAIN IS REPORTED, NOT THROWN', async () => {
  /* By the time this runs the repository exists and Pages is on. The domain
   * not attaching is a thing to fix and show, not a reason to call the
   * whole setup failed and leave somebody wondering what did happen. */
  const h = hub({ repoExists: true, hasCommits: true, cnameStatus: 422 });

  const out = await run(h);

  assert.strictEqual(out.custom.ok, false);
  assert.ok(/DNS/.test(out.custom.error), 'the commonest cause is not named');
  assert.strictEqual(out.pages.ok, true, 'the rest of the setup was thrown away');
});

test('AND THE DNS RECORDS COME BACK, BECAUSE NOTHING HERE CAN SET THEM', async () => {
  /* Half this job is at a registrar this app has never heard of. An answer
   * that said "done" would be a lie about the half that was not done. */
  const h = hub();

  const { dns } = await run(h);

  assert.deepStrictEqual(dns.apex.values, APEX_A);
  assert.deepStrictEqual(dns.apexIpv6.values, APEX_AAAA);
  assert.strictEqual(dns.www.value, 'acme.github.io');
  assert.strictEqual(dns.www.type, 'CNAME');
});

test('the A records are the four GitHub publishes, exactly', () => {
  /* Checked against docs.github.com, "Managing a custom domain for your
   * GitHub Pages site", on 30 October. Written down rather than linked
   * because somebody sets these at a registrar while reading a screen in
   * this app, and a list one click away is a list half of them guess at. */
  assert.deepStrictEqual(APEX_A, [
    '185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153',
  ]);
});

/* ======================================================================= */

section('WHAT IT REFUSES BEFORE TOUCHING ANYTHING');

test('A NARROWED INSTALLATION IS NAMED, PERMISSION BY PERMISSION', async () => {
  /* An installer can narrow what the App asked for. Without this the first
   * sign is a 403 three calls in, on an endpoint whose name does not
   * mention the permission that was missing. */
  const h = hub({ permissions: { contents: 'write' } });

  await assert.rejects(run(h), /administration, pages/);

  assert.strictEqual(h.state.created, null, 'it created something anyway');
});

test('and an installation or domain that was not given is refused outright', async () => {
  const h = hub();

  await assert.rejects(run(h, { installationId: '' }), /needs an installation/);
  await assert.rejects(run(h, { domain: '  ' }), /needs an installation/);
});

/* ---------------------------------------------------------------------- */

(async () => {
  for (const run of queue) await run();

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
