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
    assert.deepStrictEqual(attach.calls[0], {
      project: 'leanderwaterheaters-com',
      domain: 'leanderwaterheaters.com',
      target: 'leanderwaterheaters.pages.dev',
    });
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

(async () => {
  for (const run of queue) await run();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
