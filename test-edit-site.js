// test-edit-site.js
//
// The Rank Fast edit screen: changing the words of the build in
// dist/user_<id>, and the Google Search Console tag that goes with it.
//
//   node test-edit-site.js
//
//
// WHAT IS REAL HERE AND WHAT IS NOT
//
// REAL FILES ON REAL DISK. The whole feature is about a folder — reading
// content.json out of it, writing pages back into it, noticing when it has
// gone. A stubbed fs would make every test below a test of the stub, and
// the two things actually worth proving — that _src/ is left alone and that
// a changed token REPLACES rather than stacks — are both properties of what
// ends up on disk.
//
// STUBBED: Job.create, so nothing needs mongo, and runGeneration, because a
// re-render calls OpenAI. Both are replaced on their cached module objects,
// which is how the route and the job reach them — see the note at the top of
// test-cloudflare-sites.js about what that costs.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Job = require('./models/Job');
/* STUBBED THROUGH ITS MODULE, which is the whole reason utils/buildDir.js
 * exists — see the note at the top of that file. Six tests here first
 * assigned `editSite.distDirFor`, which replaced the EXPORT while the route
 * went on calling its own module-local copy, so they arranged a temporary
 * folder and then asserted against the real dist/. */
const buildDir = require('./utils/buildDir');
const runGen = require('./utils/runGeneration');
const verificationHead = require('./utils/cloudflareSites/verificationHead');
const editSite = require('./routes/editSiteRoute');

let passed = 0, failed = 0;

async function test(name, fn) {
  try { await fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

function section(name) { console.log(`\n${name}\n`); }

/** The last handler on a route, past requireAuth. */
function handler(method, routePath, r = editSite) {
  const layer = r.stack.find(l => l.route && l.route.path === routePath && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${routePath} is not on the router`);

  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

const temps = [];

function tempRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'editsite-'));
  temps.push(dir);
  return dir;
}

function cleanup() {
  for (const dir of temps) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

/* ------------------------------------------------------------- a build */

/**
 * A folder shaped like one runGeneration leaves behind.
 *
 * THE MODEL IS THE REAL SHAPE, not a hand-written object: editableText
 * reads pages, sections, paragraphs and headings off it, and a fixture that
 * guessed at that shape would test the guess.
 */
function makeBuild({ model = true, recipe = true, pages = ['index.html'] } = {}) {
  const dir = tempRoot();
  fs.mkdirSync(path.join(dir, '_src'), { recursive: true });

  for (const name of pages) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full,
      '<html><head><meta charset="utf-8">\n<link rel="canonical" href="/"></head>'
      + '<body><p>hi</p></body></html>', 'utf8');
  }

  if (model) {
    fs.writeFileSync(path.join(dir, '_src', 'content.json'), JSON.stringify({
      version: 1,
      global: { businessName: 'Quality Plumbing', location: 'Leander, TX' },
      pages: [{
        slug: 'index',
        title: 'Home',
        type: 'home',
        sections: [{
          key: 'section2',
          type: 'text',
          heading: 'What we do',
          paragraphs: ['We fix pipes.', 'We do it quickly.'],
        }],
      }],
    }), 'utf8');
  }

  if (recipe) {
    fs.writeFileSync(path.join(dir, '_src', 'build.json'), JSON.stringify({
      version: 1,
      body: { global: { businessName: 'Quality Plumbing' }, pages: {} },
    }), 'utf8');
  }

  return dir;
}

function req(over = {}) {
  return Object.assign({
    user: { _id: 'user-1' },
    body: {},
    query: {},
    id: 'req-1',
  }, over);
}

async function call(h, r = req()) {
  let status = 200, html = '', redirect = '';

  const res = {
    locals: { csrfField: '<input name="_csrf">' },
    status(code) { status = code; return this; },
    send(body) { html = String(body); return this; },
    redirect(to) { redirect = String(to); return this; },
  };

  await h(r, res);

  return { status, html, redirect };
}

const TOKEN_A = 'abcdefghijklmnopqrstuvwxyz012345678901234567';
const TOKEN_B = 'zyxwvutsrqponmlkjihgfedcba987654321098765432';

(async () => {

/* ===================================================================== */
section('THE TAG, WRITTEN INTO A FOLDER OF BUILT PAGES');

await test('IT GOES INTO EVERY PAGE, AT ANY DEPTH', () => {
  /* The Cloudflare half of this already had the rule — see the note in
   * verificationHead.js about Google re-checking and about properties
   * registered on sub-paths. A build folder has the same shape of answer
   * and a different shape of input: a directory rather than a file map. */
  const dir = makeBuild({ pages: ['index.html', 'about.html', 'services/pipes.html'] });

  const out = verificationHead.injectIntoDir(dir, [TOKEN_A]);

  assert.strictEqual(out.written.length, 3, 'not every page was written');

  for (const p of ['index.html', 'about.html', 'services/pipes.html']) {
    const html = fs.readFileSync(path.join(dir, p), 'utf8');
    assert.ok(html.includes(TOKEN_A), `${p} does not carry the tag`);
  }
});

await test('AND _src/ IS NEVER TOUCHED', () => {
  /* content.json and build.json live there, and so does the token itself.
   * siteFiles.js already refuses to PUBLISH that folder; this is the same
   * rule from the other side — nothing in it is a page, however much a
   * file in it looks like one. */
  const dir = makeBuild();
  fs.writeFileSync(path.join(dir, '_src', 'looks-like-a-page.html'),
    '<html><head></head><body>x</body></html>', 'utf8');

  verificationHead.injectIntoDir(dir, [TOKEN_A]);

  const html = fs.readFileSync(path.join(dir, '_src', 'looks-like-a-page.html'), 'utf8');
  assert.ok(!html.includes('google-site-verification'),
    'a file under _src/ was treated as a page');
});

await test('A CHANGED TOKEN REPLACES THE OLD ONE RATHER THAN STACKING', () => {
  /* THE BUG THIS EXISTS TO PREVENT, and it is not a cosmetic one. Two
   * google-site-verification tags on a page is a property verified by two
   * codes — one of them somebody else's, if the first was pasted from the
   * wrong Search Console account. The folder is written into and read back,
   * so unlike the Cloudflare path it cannot assume the pages are clean. */
  const dir = makeBuild();

  verificationHead.injectIntoDir(dir, [TOKEN_A]);
  verificationHead.injectIntoDir(dir, [TOKEN_B]);

  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const count = (html.match(/google-site-verification/g) || []).length;

  assert.strictEqual(count, 1, `the page carries ${count} verification tags`);
  assert.ok(html.includes(TOKEN_B), 'the new token is not there');
  assert.ok(!html.includes(TOKEN_A), 'the old token survived the change');
});

await test('AND EMPTYING THE BOX TAKES IT BACK OUT', () => {
  const dir = makeBuild();

  verificationHead.injectIntoDir(dir, [TOKEN_A]);
  verificationHead.injectIntoDir(dir, []);

  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

  assert.ok(!html.includes('google-site-verification'),
    'clearing the box left the tag in the pages');
});

await test('AND THE REST OF THE HEAD SURVIVES ALL OF IT', () => {
  /* THE REASON stripVerification IS NARROW. A regex loose enough to catch
   * "our" meta and careless enough to catch the others would quietly strip
   * a site's charset, its viewport and its canonical — on every save, with
   * nothing on screen to say so. */
  const dir = makeBuild();

  verificationHead.injectIntoDir(dir, [TOKEN_A]);
  verificationHead.injectIntoDir(dir, [TOKEN_B]);
  verificationHead.injectIntoDir(dir, []);

  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

  assert.ok(/charset/.test(html), 'the charset was stripped');
  assert.ok(/rel="canonical"/.test(html), 'the canonical was stripped');
  assert.ok(/<p>hi<\/p>/.test(html), 'the page body was damaged');
});

await test('A PAGE WITH NO HEAD IS REPORTED, NOT REPAIRED', () => {
  /* Same rule the file-map version states: growing a head here would hide a
   * generator bug rather than fix one. */
  const dir = makeBuild({ pages: [] });
  fs.writeFileSync(path.join(dir, 'broken.html'), '<html><body>no head</body></html>', 'utf8');

  const out = verificationHead.injectIntoDir(dir, [TOKEN_A]);

  assert.strictEqual(out.headless.length, 1, 'a headless page was not reported');
  assert.strictEqual(out.written.length, 0, 'a headless page was written to anyway');
});

await test('AND NOTHING THAT IS NOT A PAGE IS REWRITTEN', () => {
  const dir = makeBuild();
  const css = path.join(dir, 'style.css');
  fs.writeFileSync(css, 'body{color:red}', 'utf8');

  verificationHead.injectIntoDir(dir, [TOKEN_A]);

  assert.strictEqual(fs.readFileSync(css, 'utf8'), 'body{color:red}',
    'a stylesheet was rewritten');
});

/* ===================================================================== */
section('THE SCREEN');

await test('WITH NO BUILD, IT SAYS SO INSTEAD OF SHOWING EMPTY BOXES', async () => {
  /* A form with no fields reads as a broken page. The honest answer names
   * the missing thing and offers the way to get one. */
  buildDir.distDirFor = () => path.join(os.tmpdir(), 'editsite-does-not-exist');

  const out = await call(handler('get', '/edit-site'));

  assert.strictEqual(out.status, 400);
  assert.match(out.html, /no website to edit yet/i);
  assert.match(out.html, /href="\/"/, 'it does not offer a way to build one');
});

await test('THE JOB KIND IS ONE THE MODEL WILL ACCEPT', () => {
  /* THE TRAP THIS MODEL HAS ALREADY SPRUNG TWICE. 'rankfast' was added to
   * the wizard and not to the enum, so every build threw a ValidationError
   * at Job.create — after the customer had been charged and told it was
   * starting. Checked against the schema rather than a literal, so adding a
   * kind to a route and forgetting the model fails here. */
  const kinds = Job.schema.path('kind').enumValues;

  assert.ok(kinds.includes('siteedit'),
    `Job.kind does not accept 'siteedit' — it allows ${kinds.join(', ')}`);
});

await test('AND THE PROGRESS PAGE KNOWS WHAT TO CALL IT', () => {
  /* routes/jobRoute.js picks its wording and its finish link off `kind`,
   * falling back to the site-build copy. The fallback is not wrong enough
   * to notice — "Your website is ready" over an edit — which is exactly why
   * this is asserted rather than left to be seen. */
  const src = fs.readFileSync(path.join(__dirname, 'routes', 'jobRoute.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

  assert.match(src, /siteedit:\s*\{/, 'the progress page has no wording for a siteedit job');
});

/* ===================================================================== */
section('SAVING');

await test('A TAG ON ITS OWN IS APPLIED AT ONCE, WITH NO REBUILD', async () => {
  /* THE WHOLE REASON THE TAG IS NOT PART OF THE WORDS. A verification
   * element is a line in the <head>; it has nothing to do with a sentence.
   * Queuing a ten-minute re-render to add one would be the two-step shuffle
   * again, in a smaller place. */
  const dir = makeBuild();
  buildDir.distDirFor = () => dir;

  const jobs = [];
  Job.create = async (doc) => { jobs.push(doc); return { _id: 'job-1' }; };

  const out = await call(handler('post', '/edit-site'),
    req({ body: { verification: `<meta name="google-site-verification" content="${TOKEN_A}">` } }));

  assert.strictEqual(jobs.length, 0, 'a rebuild was queued for a tag change');
  assert.match(out.redirect, /\/edit-site\?ok=saved/, 'it did not go back to the screen');

  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.ok(html.includes(TOKEN_A), 'the tag never reached the pages');
});

await test('and the token is kept where a rebuild can find it again', () => {
  /* runGeneration writes every page from scratch, so the tag in the <head>
   * is gone the moment the words change. _src/verification.json is what
   * survives that, and utils/editSiteJob.js reads it back. */
  const dir = makeBuild();

  editSite.writeTags(dir, [TOKEN_A]);

  assert.deepStrictEqual(editSite.readTags(dir), [TOKEN_A]);
  assert.ok(fs.existsSync(path.join(dir, '_src', editSite.TAGS_FILENAME)),
    'the token was not stored under _src/');
});

await test('and a build that has never been verified reads as empty, not as an error', () => {
  assert.deepStrictEqual(editSite.readTags(makeBuild()), [],
    'a build with no token throws or returns something odd');
});

await test('CHANGED WORDS ARE WRITTEN BEFORE THE REBUILD IS QUEUED', async () => {
  /* THE ORDER IS THE ONE THING HERE THAT MUST NOT CHANGE, and the
   * Cloudflare screen carries the same note. A rebuild that fails or is
   * abandoned has to leave the edited words on disk, so pressing Save again
   * retries instead of asking somebody to retype what they typed.
   *
   * ASSERTED BY READING THE FILE BACK, not by watching for a call: "it
   * called writeModel" is satisfied by a write that wrote the OLD model. */
  const dir = makeBuild();
  buildDir.distDirFor = () => dir;

  const jobs = [];
  Job.create = async (doc) => { jobs.push(doc); return { _id: 'job-1' }; };

  const { fieldName } = require('./utils/cloudflareSites/editableText');

  const out = await call(handler('post', '/edit-site'), req({
    body: { [fieldName('index', 'section2', 0)]: 'We fix pipes, fast.' },
  }));

  const saved = JSON.parse(fs.readFileSync(path.join(dir, '_src', 'content.json'), 'utf8'));

  assert.strictEqual(saved.pages[0].sections[0].paragraphs[0], 'We fix pipes, fast.',
    'the edited sentence is not on disk');

  assert.strictEqual(jobs.length, 1, 'no rebuild was queued for changed words');
  assert.strictEqual(jobs[0].kind, 'siteedit');
  assert.match(out.redirect, /^\/jobs\//, 'it did not send them to watch the rebuild');
});

await test('and the payload carries no words, only a pointer', async () => {
  /* Minutes pass between the save and the runner picking it up. A payload
   * holding the words could be overtaken by a second save; a payload
   * holding nothing cannot go stale, and the job reads the folder when it
   * starts. */
  const dir = makeBuild();
  buildDir.distDirFor = () => dir;

  const jobs = [];
  Job.create = async (doc) => { jobs.push(doc); return { _id: 'job-1' }; };

  const { fieldName } = require('./utils/cloudflareSites/editableText');

  await call(handler('post', '/edit-site'), req({
    body: { [fieldName('index', 'section2', 0)]: 'Something else entirely.' },
  }));

  assert.deepStrictEqual(jobs[0].payload, {},
    'the job payload carries a copy of something it should read fresh');
});

await test('A SAVE THAT CHANGED NOTHING DOES NOT SPEND TEN MINUTES PROVING IT', async () => {
  /* Pressing Save without touching anything is a normal thing to do — it is
   * how somebody checks they have not broken anything. Re-rendering the
   * whole site to produce byte-identical pages is the wrong answer to it. */
  const dir = makeBuild();
  buildDir.distDirFor = () => dir;

  const jobs = [];
  Job.create = async (doc) => { jobs.push(doc); return { _id: 'job-1' }; };

  const { fieldName } = require('./utils/cloudflareSites/editableText');

  const out = await call(handler('post', '/edit-site'), req({
    body: { [fieldName('index', 'section2', 0)]: 'We fix pipes.' },   // unchanged
  }));

  assert.strictEqual(jobs.length, 0, 'an unchanged save queued a rebuild');
  assert.match(out.redirect, /ok=saved/);
});

/* ===================================================================== */
section('THE REBUILD');

await test('IT PUTS THE TAG BACK, BECAUSE THE RE-RENDER WIPED IT', async () => {
  /* THE FAILURE THIS CATCHES IS SILENT AND SLOW. Edit a word, the site
   * rebuilds, the pages come out correct — and the Search Console property
   * quietly stops verifying, days later, the next time Google re-checks.
   *
   * runGeneration is stubbed to do what it really does to this folder:
   * write the pages again from nothing. */
  const dir = makeBuild();
  buildDir.distDirFor = () => dir;

  editSite.writeTags(dir, [TOKEN_A]);
  verificationHead.injectIntoDir(dir, [TOKEN_A]);

  const REAL = runGen.runGeneration;

  runGen.runGeneration = async () => {
    fs.writeFileSync(path.join(dir, 'index.html'),
      '<html><head><meta charset="utf-8"></head><body><p>rebuilt</p></body></html>', 'utf8');

    return { distDir: dir, creditsCharged: 0, reused: true };
  };

  try {
    const { rebuildForJob } = require('./utils/editSiteJob');

    const out = await rebuildForJob({ _id: 'job-1', user: 'user-1' }, {});

    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

    assert.ok(/rebuilt/.test(html), 'the stub never ran, so this proves nothing');
    assert.ok(html.includes(TOKEN_A),
      'the rebuild dropped the verification tag and nothing put it back');
    assert.strictEqual(out.creditsCharged, 0, 'an edit was charged for');
  } finally {
    runGen.runGeneration = REAL;
  }
});

await test('AND A BUILD THAT HAS GONE FAILS THE JOB RATHER THAN THE PROCESS', async () => {
  /* One folder per account: a new generation replaces it and the 48-hour
   * sweep clears it, either of which can happen between Save and the runner
   * starting. The message has to say which, because "rebuild failed" sends
   * somebody looking for a bug that is not there. */
  buildDir.distDirFor = () => path.join(os.tmpdir(), 'editsite-gone-' + Date.now());

  const { rebuildForJob } = require('./utils/editSiteJob');

  await assert.rejects(
    () => rebuildForJob({ _id: 'job-1', user: 'user-gone-' + Date.now() }, {}),
    /no longer here|replaces the previous/i,
    'a missing build does not explain itself'
  );
});

/* ===================================================================== */
section('ONE FORM, TWO SCREENS');

await test('THE BOXES COME FROM ONE PLACE', () => {
  /* The renderer was ninety lines inside routes/cloudflareSitesRoute.js
   * until this feature needed the same boxes over a folder. Two copies
   * agree on the day they are made and diverge the first time one is
   * fixed — and the thing they share is not "a form", it is the rule for
   * turning a content model into controls.
   *
   * Comments stripped: both files explain this at length. */
  const bare = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

  for (const p of ['routes/cloudflareSitesRoute.js', 'routes/editSiteRoute.js']) {
    assert.match(bare(p), /renderSections\(/,
      `${p} draws its own boxes instead of using the shared renderer`);
  }

  /* AND THE OLD COPY IS GONE, not merely unused. A second renderer left
   * behind is a second renderer somebody edits. */
  assert.ok(!/editableText\.collect\(site\.contentModel\)/.test(bare('routes/cloudflareSitesRoute.js')),
    'the Cloudflare route still collects its own blocks');
});

cleanup();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

})().catch(err => { cleanup(); console.error(err); process.exit(1); });
