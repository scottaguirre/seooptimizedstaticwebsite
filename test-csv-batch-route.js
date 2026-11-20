// test-csv-batch-route.js
//
// The screen that takes a CSV and the check behind it.
//
//   node test-csv-batch-route.js
//
// WHAT IS WORTH TESTING HERE AND WHAT IS NOT
//
// The parsing and the refusals belong to utils/localOptions/csvBatch.js and
// are tested there, against a fake photograph tree. What this route adds is
// the three things it HANDS that module — the domain list, the design list,
// and the order of both — plus the two it will not do: queue anything, and
// let a batch through that cannot be paid for.
//
//     THE LIST THIS ROUTE PASSES IN IS THE ONE THING THE PARSER
//     CANNOT CHECK FOR ITSELF. It pairs row N with designs[N] and
//     has no way to know the caller read the wrong field off them.
//
// AND THAT IS NOT HYPOTHETICAL. The first version mapped `design.value`,
// which is not a field on a design. The list came back the right length and
// full of `undefined`, nothing refused it, and every site in the batch would
// have been built from a design nobody chose.

'use strict';

const assert = require('assert');
const Module = require('module');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

async function atest(name, fn) {
  try { await fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

function section(name) { console.log(`\n${name}\n`); }

/* THE MODEL IS STUBBED BEFORE THE ROUTE IS LOADED, because requiring it
 * opens a Mongoose model and these tests have no database. The same move
 * test-cloudflare-sites.js makes, for the same reason. */
const realLoad = Module._load;

let POOL = ['1-1b.com', '1-1o.com', '1b-0.com', '2-r2.com', '3-ro.com',
  'my-sites.net', 'u-sites.com'];

Module._load = function patched(request, parent, isMain) {
  /* requireAuth IS STUBBED THROUGH, because these tests are about what the
   * route SENDS, not about who may ask — the real one answers
   * "Authentication error" to a request with no session and the handler
   * never runs. The mounting test below asserts the REAL middleware is in
   * front of this router in server.js, which is the half that matters. */
  if (request.endsWith('middleware/requireAuth')) {
    return (req, res, next) => next();
  }

  if (request.endsWith('models/Domain')) {
    return {
      find: () => ({
        select: () => ({
          sort: () => ({
            lean: async () => POOL.map(domain => ({ domain })),
          }),
        }),
      }),
    };
  }

  return realLoad(request, parent, isMain);
};

const route = require('./routes/csvBatchRoute');
const designs = require('./utils/localOptions/designs');

Module._load = realLoad;

/* ONE REQUEST THROUGH THE REAL ROUTER, with the two objects express gives a
 * handler. Lighter than starting a server for a route that reads nothing
 * and writes nothing. */
function hit(url, locals = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};

    const res = {
      locals,
      setHeader(name, value) { headers[name.toLowerCase()] = value; },
      status(code) { this.statusCode = code; return this; },
      send(body) { resolve({ status: this.statusCode || 200, headers, body: String(body) }); },
      json(body) { resolve({ status: this.statusCode || 200, headers, body }); },
    };

    route.handle(
      { method: 'GET', url, headers: {}, user: { _id: 'u1', credits: 10000 } },
      res,
      () => reject(new Error(`nothing handled ${url}`))
    );
  });
}

/* WRAPPED IN AN ASYNC IIFE, and node insisted. A file with both require()
 * and a top-level await is ambiguous — "Cannot determine intended module
 * format" — and refuses to load at all. The other async suites in this
 * project do the same. */
(async () => {

/* ===================================================================== */

section('THE LISTS THIS ROUTE HANDS THE PARSER');

await atest('THE DESIGNS ARE ids, NOT A FIELD THAT DOES NOT EXIST', async () => {
  /* THE BUG THIS FILE WAS WRITTEN AFTER. `design.value` is not a field;
   * the map produced seven `undefined`s, which is a list of the right
   * length that pairs every row with nothing.
   *
   *     A FIELD THAT IS NOT THERE READS AS undefined, NOT AS AN ERROR. */
  const { designs: ids } = await route.poolFor();

  assert.strictEqual(ids.length, 7, 'the Cloudflare door no longer offers seven layouts');

  for (const id of ids) {
    assert.strictEqual(typeof id, 'string', `${id} is not a string`);
    assert.ok(id.trim(), 'a design id came back empty');
  }
});

await atest('AND THEY ARE THE ids buildOptionsFor RESOLVES', async () => {
  /* `global[design]` is what the wizard posts and what the build reads. An
   * id that is not in the list for this door resolves to the default — one
   * layout for all seven, silently. */
  const { designs: ids } = await route.poolFor();
  const known = designs.designsFor(route.DESIGN_MODE).map(d => String(d.id));

  assert.deepStrictEqual(ids, known);
});

await atest('AND EACH ONE CARRIES ITS OWN STRUCTURE AND ITS OWN PHOTOGRAPHS', async () => {
  /* THE WHOLE OF WHY ROW N TAKES LAYOUT N. Seven ids that shared a
   * structure, or a set, would be seven near-identical sites in one town —
   * which is the thing Edwin asked about before the first batch ran. */
  const list = designs.designsFor(route.DESIGN_MODE);

  assert.strictEqual(new Set(list.map(d => d.structure)).size, list.length,
    'two layouts share a structure');
  assert.strictEqual(new Set(list.map(d => d.imageSet)).size, list.length,
    'two layouts share an image set');
});

await atest('AND THE DOMAINS COME BACK SORTED, LIKE THE WIZARD LISTS THEM', async () => {
  /* The preview says which row gets which, so the order only has to be
   * STABLE — but it has to be the SAME stable order somebody saw on the
   * other screen, or the two disagree about what "the first domain" is. */
  POOL = ['u-sites.com', '1-1b.com', 'my-sites.net'];

  const { domains } = await route.poolFor();

  assert.deepStrictEqual(domains, ['u-sites.com', '1-1b.com', 'my-sites.net'],
    'the route re-sorted a list the query had already ordered');

  POOL = ['1-1b.com', '1-1o.com', '1b-0.com', '2-r2.com', '3-ro.com',
    'my-sites.net', 'u-sites.com'];
});

await atest('AND A LABEL IS OFFERED FOR EVERY id, FOR THE TABLE', async () => {
  /* "1" is the value the build needs and "Design 1 — ledger" is what
   * somebody reading the preview needs. A column of bare ids would make the
   * layout column meaningless, which is half the reason the table is
   * there. */
  const { designs: ids, labels } = await route.poolFor();

  for (const id of ids) {
    assert.ok(labels[id], `no label for design ${id}`);
    assert.notStrictEqual(labels[id], id, `the label for ${id} is just the id`);
  }
});

/* ===================================================================== */

section('THE TEMPLATE SOMEBODY DOWNLOADS');

await atest('IT IS BUILT FROM THE PARSER\'S OWN COLUMN LIST', async () => {
  /* A template with the headings typed out is a second statement of the
   * column order — correct the day it is written, silently wrong the first
   * time a column moves. Somebody would then fill in a file this screen
   * refuses row by row, and the file came from this screen.
   *
   *     A TEMPLATE THAT CAN DISAGREE WITH THE PARSER IS WORSE
   *     THAN NO TEMPLATE. IT IS A WRONG ANSWER WITH OUR NAME ON IT. */
  const { HEADINGS } = require('./utils/localOptions/csvBatch');
  const out = await hit('/batch-sites/template.csv');

  assert.strictEqual(out.body.replace(/^\uFEFF/, '').trim(), HEADINGS.join(','),
    'the template headings are not the ones the screen shows');

  /* THE HEADINGS, NOT THE FIELD NAMES — split on 20 November so the second
   * column could say it needs a state. The template must print what the
   * person reads, and csvBatch asserts the two lists stay the same length
   * so a heading can never shift a column. */
  assert.match(HEADINGS[1], /state/i, 'the city heading does not mention the state');
});

await atest('AND IT ROUND-TRIPS THROUGH THE PARSER AS A HEADER', async () => {
  /* THE END-TO-END OF THE POINT ABOVE. A file holding only this line, with
   * one real row under it, has to parse as one website — which is what
   * somebody who downloads it, fills it in and uploads it will have. */
  const { expand } = require('./utils/localOptions/csvBatch');
  const out = await hit('/batch-sites/template.csv');

  const filled = out.body
    + 'plumbing,"Austin, TX",78701,Leander Plumbing,1 Main St,(512) 555-0100,a@b.com\n';

  const parsed = expand({
    csv: filled,
    domains: ['u-sites.com'],
    designs: ['1'],
  });

  assert.strictEqual(parsed.header, true, 'the template line was not read as a heading');
  assert.strictEqual(parsed.errors.length, 0, parsed.errors[0] && parsed.errors[0].reason);
  assert.strictEqual(parsed.rows.length, 1);
});

await atest('AND IT ARRIVES AS A DOWNLOAD, NOT AS A PAGE', async () => {
  const out = await hit('/batch-sites/template.csv');

  assert.match(out.headers['content-type'] || '', /text\/csv/);
  assert.match(out.headers['content-disposition'] || '', /attachment/);
  assert.match(out.headers['content-disposition'] || '', /\.csv"/);
});

await atest('AND IT CARRIES A BOM, SO EXCEL DOES NOT MANGLE AN ACCENT', async () => {
  /* Excel on Windows reads a CSV without one as the system codepage, so an
   * accented town name comes back wrong in the very file we handed over.
   * The parser strips it on the way back in — which the test above proves,
   * since it parses this exact body. */
  const out = await hit('/batch-sites/template.csv');

  assert.ok(out.body.startsWith('\uFEFF'), 'the template has no byte order mark');
});

await atest('AND THE SCREEN SHOWS THE SAME HEADINGS THE TEMPLATE HOLDS', async () => {
  /* A MUTANT FOUND THIS GAP. Printing COLUMNS on the page instead of
   * HEADINGS left every test green — the template was checked, the page was
   * not — and the two would have disagreed about what the second column is
   * called, in the one place somebody reads before downloading anything.
   *
   *     THE DOWNLOAD AND THE INSTRUCTIONS BESIDE IT ARE ONE
   *     ANSWER. TESTING ONE OF THEM TESTS HALF OF IT. */
  const { HEADINGS, COLUMNS } = require('./utils/localOptions/csvBatch');
  const out = await hit('/batch-sites');

  assert.ok(out.body.includes(HEADINGS.join(', ')),
    'the screen does not list the headings the template uses');

  assert.ok(!out.body.includes(COLUMNS.join(', ')),
    'the screen lists the internal field names, so `city` reads as a town alone');
});

await atest('AND THE SCREEN USES THE PAGE\'S OWN COLOURS', async () => {
  /* Edwin, 20 November: *"I also don't like that dark screen, could you
   * follow the theme design colors?"*
   *
   * `bg-dark` and `table-dark` are Bootstrap's own near-black. On this
   * navy body they read as a hole cut in the page rather than a panel on
   * it — and /cloudflare-sites already had the answer, `bg-transparent
   * border-light`, which lets the body colour through.
   *
   *     A DEFAULT FROM THE FRAMEWORK IS NOT A NEUTRAL CHOICE ON
   *     A PAGE THAT HAS A COLOUR OF ITS OWN.
   *
   * CHECKED ON THE RENDERED PAGE, not on the source, because the source
   * now mentions `bg-dark` in the note explaining why it is gone. */
  const out = await hit('/batch-sites');

  /* THE PAGE BODY ONLY. The shared app header bar IS `bg-dark`, on every
   * screen in the app and deliberately — a test that looked at the whole
   * document would fail on somebody else's decision and read as this
   * page's fault. withAppHeader() injects it above the container. */
  const at = out.body.indexOf('<div class="container py-5"');

  assert.ok(at > 0, 'the page no longer renders through the shared container');

  const body = out.body.slice(at);

  assert.ok(!/\bbg-dark\b/.test(body),
    'a near-black panel is back on the navy page');
  assert.ok(!/\btable-dark\b/.test(body),
    'the preview table is drawn in near-black');

  assert.match(body, /card bg-transparent border-light/,
    'the panel does not use the house card');

  /* AND THE TABLE USES THE HOUSE CLASS, NOT BOOTSTRAP'S DEFAULT — the
   * second half of the same lesson, and I got it wrong first.
   *
   * Dropping `table-dark` left a plain `table`, which Bootstrap paints
   * WHITE. The business and the address still read, because they carry no
   * colour of their own; the row number and the layout were `text-white-50`
   * and vanished — white-on-white, two empty columns in a table that
   * otherwise looked fine.
   *
   *     REMOVING THE WRONG THING IS NOT THE SAME AS USING THE
   *     RIGHT ONE. THE GAP BETWEEN THEM IS WHERE THE PAGE ENDS
   *     UP LOOKING BROKEN IN A NEW WAY.
   *
   * appHeader.js has `.table-navy` for exactly this — transparent
   * background, white text, a muted uppercase head — and a `.rownum` style
   * for the row-number column, right-aligned and tabular so 9 and 10 line
   * up their last digit. */
  assert.match(body, /table table-navy/,
    'the preview table does not use the house table, so it draws white');
  assert.match(body, /class="rownum"/,
    'the row number does not use the house row-number style');
});

await atest('THE PAGE CARRIES THE CSRF TOKEN, OR IT CANNOT POST AT ALL', async () => {
  /* THE BUG THIS WHOLE TEST EXISTS FOR, found by Edwin uploading a valid
   * file and getting a blank screen.
   *
   * The browser reads meta[name="csrf-token"] and sends it as a header,
   * exactly as spinner.js does — but that meta tag is written by
   * routes/formRoute.js, for the wizard, and this screen is not the
   * wizard. It read a tag no page had put there, sent an empty token, and
   * middleware/csrf.js refused the POST.
   *
   *     THIS SCREEN BORROWED A CONVENTION AND NOT THE LINE
   *     THAT ESTABLISHES IT. */
  const out = await hit('/batch-sites', { csrfToken: 'TOKEN123' });

  assert.match(out.body, /<meta name="csrf-token" content="TOKEN123">/,
    'the page does not carry the token its own script reads');
});

await atest('AND AN ANSWER THE PREVIEW DOES NOT UNDERSTAND IS SAID OUT LOUD', async () => {
  /* THE SECOND HALF OF THE SAME FAILURE, and the worse one. A CSRF refusal
   * replies with an error field and nothing else — no rows, no errors —
   * and draw() rendered an EMPTY STRING for it. No table, no warning, a
   * disabled button and no explanation anywhere on the page.
   *
   *     A RENDERER THAT DRAWS NOTHING FOR A SHAPE IT DID NOT
   *     EXPECT IS INDISTINGUISHABLE FROM A SCREEN THAT IS
   *     STILL THINKING.
   *
   * Asserted on the shipped script, because the branch runs in a browser.
   * What it checks is that the guard comes FIRST — a check after the two
   * length tests would never be reached. */
  const out = await hit('/batch-sites');

  const draw = /function draw\(answer\) \{([\s\S]*?)if \(answer\.errors/.exec(out.body);

  assert.ok(draw, 'draw() no longer starts the way this test reads it');

  assert.match(draw[1], /!answer \|\| \(!answer\.rows && !answer\.errors\)/,
    'an unrecognised answer still renders as nothing');
  /* THE SERVER'S OWN WORDS, KEPT — and a mutant showed the loose version
   * of this check was worthless. `/answer\.error/` also matches
   * `answer.errors` two lines down, so renaming the field read left the
   * test green while the refusal's message was silently dropped.
   *
   *     A FIELD NAME THAT IS A PREFIX OF ANOTHER FIELD NAME
   *     NEEDS A BOUNDARY, OR THE TEST MATCHES THE WRONG ONE. */
  assert.match(draw[1], /answer\.error\b(?!s)/,
    'the server\'s own message is thrown away');
});

await atest('AND THE SCREEN LINKS TO IT', async () => {
  /* The same lesson as the sidebar row: a file nothing offers is a file
   * nobody downloads. */
  const fs = require('fs');
  const path = require('path');

  const src = fs.readFileSync(path.join(__dirname, 'routes', 'csvBatchRoute.js'), 'utf8');

  assert.match(src, /href="\/batch-sites\/template\.csv" download/,
    'the screen does not offer the template');
});

await atest('AND IT HOLDS NO EXAMPLE ROW', async () => {
  /* An example in the file is an example somebody forgets to delete, and a
   * batch that quietly builds a website for "Cold Air Austin" on the first
   * domain in the pool. The screen shows one on the page instead, where it
   * cannot be uploaded by accident. */
  const out = await hit('/batch-sites/template.csv');

  assert.strictEqual(out.body.replace(/^\uFEFF/, '').trim().split('\n').length, 1,
    'the template has more than a heading row in it');
});

/* ===================================================================== */

section('WHAT THE SCREEN REFUSES TO DO');

test('IT MOUNTS AT /batch-sites AND THE SIDEBAR LINKS TO IT', () => {
  /* THIS LIST CARRIES A WARNING ABOUT A SCREEN THAT SHIPPED WITH NOTHING
   * LINKING TO IT, reachable only by typing its URL — and the edit screen
   * then did it again. A door whose whole purpose is saving somebody seven
   * trips through a form is worth nothing if they cannot find it. */
  const fs = require('fs');
  const path = require('path');

  const header = fs.readFileSync(path.join(__dirname, 'utils', 'appHeader.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

  assert.match(header, /href: '\/batch-sites'/, 'the sidebar does not link to the screen');
  assert.match(server, /app\.use\('\/', requireAuth, csvBatchRoute\)/,
    'the route is not mounted');
  assert.match(server, /requireAuth, csvBatchRoute/,
    'the screen is reachable without signing in');
});

test('AND THE PREVIEW NEITHER WRITES NOR QUEUES', () => {
  /* Somebody will upload the wrong file and upload it again. A preview that
   * cost anything, or left a row behind, would make that an expensive way
   * to find a typo.
   *
   * ASSERTED ON THE SOURCE, which is weak on its own — so the thing it
   * looks for is the ABSENCE of the two modules that could do either. */
  const fs = require('fs');
  const path = require('path');

  const src = fs.readFileSync(path.join(__dirname, 'routes', 'csvBatchRoute.js'), 'utf8');

  assert.ok(!/require\('\.\.\/models\/Job'\)/.test(src),
    'the preview route can write a job');
  assert.ok(!/\.create\(|\.save\(|updateOne|insertMany/.test(src),
    'the preview route writes something');
});

test('AND IT POSTS TO THE ENQUEUE ROUTE THAT ALREADY EXISTS', () => {
  /* A second enqueue path would be a second place for the credit check, the
   * address check and the job shape to drift. generateBatchRoute has
   * validated and priced batches since 18 November. */
  const fs = require('fs');
  const path = require('path');

  const src = fs.readFileSync(path.join(__dirname, 'routes', 'csvBatchRoute.js'), 'utf8');

  assert.match(src, /'\/api\/generate-batch'/, 'the screen does not post to the batch route');
});

test('AND THE BUILD BUTTON IS DISABLED WHILE ANY ROW IS BAD', () => {
  /* A batch half built is seven addresses with some taken and some free,
   * and no way to re-run the file without picking out which. */
  const fs = require('fs');
  const path = require('path');

  const src = fs.readFileSync(path.join(__dirname, 'routes', 'csvBatchRoute.js'), 'utf8');

  /* THE WHOLE EXPRESSION, NOT THREE FRAGMENTS — a mutant made the point.
   * Deleting the credit clause from the button left this test green,
   * because `answer.needed > answer.available` also appears a few lines
   * above it, in the warning the preview draws. The fragment was found in
   * the file; it was not found in the condition.
   *
   *     A TEST THAT MATCHES A STRING THE FILE HAPPENS TO CONTAIN
   *     TWICE IS A TEST OF THE OTHER ONE. */
  /* THE THREE-CLAUSE ONE, NOT THE FIRST ASSIGNMENT IN THE FILE. draw()
   * now disables the button in two places — once in the guard for an
   * answer it does not understand, which is a plain `true`, and once for
   * the result it does understand. Matching the first `disabled =` found
   * the guard and asserted nothing about the condition.
   *
   *     A REGEX THAT TAKES THE FIRST MATCH IS A REGEX THAT
   *     SILENTLY RE-TARGETS ITSELF WHEN A LINE IS ADDED ABOVE. */
  const found = /buildBtn\.disabled = (!\([\s\S]*?);/.exec(src);

  assert.ok(found, 'the button is never disabled from the preview result');

  const condition = found[1].replace(/\s+/g, ' ');

  assert.match(condition, /!\(answer\.rows && answer\.rows\.length\)/,
    'the button is not disabled on an empty result');
  assert.match(condition, /answer\.errors && answer\.errors\.length > 0/,
    'the button stays enabled when rows are refused');
  assert.match(condition, /answer\.needed > answer\.available/,
    'the button stays enabled when the credits do not cover it');
});

/* ===================================================================== */

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

})();
