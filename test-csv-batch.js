// test-csv-batch.js
//
// A CSV of businesses plus one filled-in form into the batch
// /api/generate-batch already takes.
//
//   node test-csv-batch.js
//
//
// THE ROW THIS FILE EXISTS TO STOP
//
// Edwin gave the columns as "category/trade, business name, address, phone"
// on 19 November. The first one is why any of this validates.
//
// Only three trades have photographs for this mode. A build for any other
// one DOES NOT FAIL — it logs `localOptions.heroesMissing ... found: 0` and
// publishes a site with four missing heroes, after the credits are spent.
//
//     A ROW THAT WOULD PRODUCE A BROKEN SITE HAS TO BE REFUSED
//     BEFORE IT IS QUEUED, BECAUSE AFTERWARDS NOTHING WILL.
//
// Almost every test below is a way that could fail quietly.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const B = require('./utils/localOptions/csvBatch');

/* THE ROUTE'S OWN READERS, not a copy of what they are believed to read.
 * An entry is only a submission if the functions generateBatchRoute calls
 * can find what they need in it, and the keys are bracket-notation strings
 * — the kind of thing a test asserting `entry['global[siteTarget]']` keeps
 * agreeing with itself about while the route sees nothing. */
const { siteTargetOf, wantedAddress } = require('./utils/cloudflareSites/wanted');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

function section(name) { console.log(`\n${name}\n`); }

const temps = [];

/* A photograph tree with whatever trades a test needs, so none of these
 * depend on what happens to be in src/ on the day they run. */
function imagesRoot(trades = { plumbing: 2, 'air-conditioning': 7 }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csvbatch-'));
  temps.push(root);

  for (const [trade, sets] of Object.entries(trades)) {
    for (let n = 1; n <= sets; n += 1) {
      const dir = path.join(root, trade, `set-${n}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'hero-1.webp'), 'x');
    }
  }

  return root;
}

/* ONE VALID ROW, VARIED ONE CELL AT A TIME. Seven columns is enough that a
 * test writing them all out would be mostly punctuation, and a typo in the
 * sixth cell of a test about the second one is a failure nobody can read. */
function row(over = {}) {
  const cells = {
    trade: 'plumbing',
    city: '"Austin, TX"',
    zip: '78701',
    businessName: 'Leander Plumbing',
    street: '1 Main St',
    phone: '(512) 555-0100',
    email: 'owner@example.com',
    ...over,
  };

  return B.COLUMNS.map(name => cells[name]).join(',');
}

const file = (...rows) => rows.join('\n') + '\n';

const DOMAINS = ['u-sites.com', 'my-sites.net', '3-ro.com', '2-r2.com', '1b-0.com',
  '1-1o.com', '1-1b.com'];

const DESIGNS = ['ledger', 'beacon', 'anvil', 'quarry', 'harbor', 'atlas', 'orchard'];

function run(csv, over = {}) {
  return B.expand({
    csv,
    domains: DOMAINS,
    designs: DESIGNS,
    root: imagesRoot(),
    ...over,
  });
}

const line = (out, n) => out.errors.find(e => e.line === n);

/* ===================================================================== */

section('THE TRADE COLUMN, WHICH IS THE WHOLE REASON FOR THE PREVIEW');

test('A TRADE WITH NO PHOTOGRAPHS IS REFUSED, NOT QUEUED', () => {
  /* THE ONE THAT COSTS MONEY. heroFiles() logs and returns for an unknown
   * trade; nothing downstream refuses the build, because by then it is just
   * a build with some files absent. */
  const out = run(file(row({ trade: 'roofing' })));

  assert.strictEqual(out.rows.length, 0, 'a trade with no images was queued');
  assert.match(out.errors[0].reason, /no photographs for "roofing"/);
});

test('AND THE REFUSAL NAMES THE ONES THAT WOULD WORK', () => {
  /* "Unknown trade" sends somebody looking for a spelling mistake when the
   * real answer is that this mode has photographs for three trades and
   * theirs is not one of them. */
  const out = run(file(row({ trade: 'roofing' })));

  assert.match(out.errors[0].reason, /air-conditioning/);
  assert.match(out.errors[0].reason, /plumbing/);
});

test('AND THE LIST COMES OFF THE DISK, SO ADDING A FOLDER ADDS A TRADE', () => {
  /* A HARD-CODED ARRAY WOULD BE A SECOND PLACE THAT DECIDES WHAT IS
   * BUILDABLE, wrong the first time a folder is added — and adding a folder
   * is exactly how this list is meant to grow. */
  const root = imagesRoot({ plumbing: 1, roofing: 1 });

  assert.deepStrictEqual(B.tradesWithImages(root), ['plumbing', 'roofing']);

  const out = run(file(row({ trade: 'roofing' })), { root });

  assert.strictEqual(out.errors.length, 0, out.errors[0] && out.errors[0].reason);
  assert.strictEqual(out.rows[0].trade, 'roofing');
});

test('AND A FOLDER WITH NO PHOTOGRAPHS IN IT IS NOT A TRADE', () => {
  /* There are empty folders in the real tree — painter, paving, doctor. A
   * name is not an image, and a site built from one is the broken site this
   * file exists to stop. */
  const root = imagesRoot({ plumbing: 1 });
  fs.mkdirSync(path.join(root, 'painter'), { recursive: true });

  assert.deepStrictEqual(B.tradesWithImages(root), ['plumbing'],
    'an empty folder was offered as a buildable trade');
});

/* ===================================================================== */

section('THE HEADER ROW, WHICH NOBODY SHOULD HAVE TO DECLARE');

test('THE HEADINGS EXPLAIN THE CELL, THE FIELD NAMES DO NOT HAVE TO', () => {
  /* Edwin, 20 November: *"should the second column read 'city + St'?"* It
   * should. One list was doing two jobs — the field order the parser reads
   * positionally, and the label printed on the screen and in the template —
   * so the heading over a cell that must hold "Austin, TX" read `city`.
   *
   *     A FIELD NAME IS FOR THE CODE AND A HEADING IS FOR THE
   *     PERSON FILLING IT IN. THEY AGREE UNTIL ONE OF THEM
   *     HAS SOMETHING TO EXPLAIN. */
  assert.strictEqual(B.HEADINGS.length, B.COLUMNS.length,
    'a heading was added without a field, or a field without a heading — '
    + 'every column after it is now shifted');

  assert.match(B.HEADINGS[1], /state/i,
    'the city heading does not say it needs the state');

  /* NO COMMAS. These are joined with commas to make the template's first
   * line, and a heading containing one would need quoting — a heading row
   * that is itself a CSV puzzle. */
  for (const heading of B.HEADINGS) {
    assert.ok(!heading.includes(','), `"${heading}" would break the template line`);
    assert.ok(!heading.includes('"'), `"${heading}" would break the template line`);
  }
});

test('AND A FILE WITH THOSE HEADINGS IS STILL READ AS A HEADER', () => {
  /* THE END-TO-END OF THE SPLIT. The headings changed; the detection must
   * not care, because it works off "cell one is not a trade" and not off a
   * list of words it recognises. */
  const out = run(file(B.HEADINGS.join(','), row()));

  assert.strictEqual(out.header, true, 'the template headings were read as a business');
  assert.strictEqual(out.errors.length, 0, out.errors[0] && out.errors[0].reason);
  assert.strictEqual(out.rows.length, 1);
});

test('A HEADING ROW IS RECOGNISED BY NOT BEING A TRADE', () => {
  /* ASKED OF THE DATA, NOT OF THE USER. "Does your CSV have a header?" is a
   * question with a wrong answer available, and the file already says: a
   * heading names a column, and a column name is not a trade. */
  const out = run(file(B.COLUMNS.join(','), row()));

  assert.strictEqual(out.header, true);
  assert.strictEqual(out.rows.length, 1);
  assert.strictEqual(out.rows[0].businessName, 'Leander Plumbing');
});

test('AND A FILE WITH NO HEADING IS READ FROM THE FIRST LINE', () => {
  const out = run(file(row()));

  assert.strictEqual(out.header, false);
  assert.strictEqual(out.rows.length, 1);
});

test('AND A LONE BAD ROW IS A BAD ROW, NOT A HEADING', () => {
  /* Treating it as a heading would answer "no rows found" for a file that
   * plainly has one, and hide the actual mistake. */
  const out = run(file(row({ trade: 'roofing' })));

  assert.strictEqual(out.header, false);
  assert.match(out.errors[0].reason, /no photographs/);
});

test('AND THE LINE NUMBERS ARE THE ONES THE SPREADSHEET SHOWS', () => {
  /* Somebody fixing a file is looking at row numbers in Excel. An off-by-one
   * sends them to the row above the mistake, which is the one that looks
   * fine. */
  const out = run(file(B.COLUMNS.join(','), row({ businessName: 'A Plumbing' }), row({ trade: 'roofing' })));

  assert.strictEqual(out.rows[0].line, 2, 'the first business is not on line 2');
  assert.strictEqual(out.errors[0].line, 3, 'the bad row is not reported on line 3');
});

/* ===================================================================== */

section('PARSING A FILE A SPREADSHEET WROTE');

test('A QUOTED COMMA STAYS INSIDE ITS CELL', () => {
  const out = run(file(row({ businessName: '"Cool Air, Inc"' })));

  assert.strictEqual(out.rows[0].businessName, 'Cool Air, Inc');
  assert.strictEqual(out.rows[0].street, '1 Main St');
});

test('AND A DOUBLED QUOTE IS ONE QUOTE', () => {
  /* Every spreadsheet writes a literal quote this way. Reading it as the
   * end of the field turns the rest of the row into columns nobody asked
   * for. */
  const out = run(file(row({ businessName: '"The ""Big"" Plumber"' })));

  assert.strictEqual(out.rows[0].businessName, 'The "Big" Plumber');
});

test('AND A BYTE ORDER MARK DOES NOT BREAK THE FIRST TRADE', () => {
  /* Excel writes one and nothing shows it. Left in place it rides along
   * inside the first cell, so the first row's trade stops matching a folder
   * name for no visible reason — which is the worst kind of bad row,
   * because the file looks right. */
  const out = run('\uFEFF' + file(row()));

  assert.strictEqual(out.errors.length, 0, out.errors[0] && out.errors[0].reason);
  assert.strictEqual(out.rows[0].trade, 'plumbing');
});

test('AND \\r\\n IS ONE LINE ENDING, NOT TWO', () => {
  /* Counting it as two gives every row a blank one after it, and the line
   * numbers this reports stop matching the ones the spreadsheet shows. */
  const out = run([row({ businessName: 'A Plumbing' }), row({ businessName: 'B Plumbing' }), ''].join('\r\n'));

  assert.strictEqual(out.rows.length, 2);
  assert.strictEqual(out.rows[1].line, 2);
});

test('AND BLANK LINES ARE NOT ROWS', () => {
  const out = run(file(row({ businessName: 'A Plumbing' }), '', '', row({ businessName: 'B Plumbing' })));

  assert.strictEqual(out.rows.length, 2);
  assert.strictEqual(out.errors.length, 0, out.errors[0] && out.errors[0].reason);
});

/* ===================================================================== */

section('THE PAIRING EDWIN CHOSE: ROW N TAKES DOMAIN N AND LAYOUT N');

test('EACH ROW TAKES THE NEXT DOMAIN AND THE NEXT LAYOUT', () => {
  const out = run(file(row({ businessName: 'A Plumbing' }), row({ businessName: 'B Plumbing' }), row({ businessName: 'C Plumbing' })));

  assert.deepStrictEqual(out.rows.map(r => r.domain), DOMAINS.slice(0, 3));
  assert.deepStrictEqual(out.rows.map(r => r.design), DESIGNS.slice(0, 3));
});

test('AND A REFUSED ROW DOES NOT CONSUME A DOMAIN', () => {
  /* THE SUBTLE ONE. If the counter were the row index rather than the
   * number ACCEPTED, a bad row in the middle would leave a gap — the fourth
   * business would land on the fourth domain while three sites were built,
   * and the pairing shown in the preview would not be the one somebody
   * reading down the file expects. */
  const out = run(file(row({ businessName: 'A Plumbing' }), row({ trade: 'roofing', businessName: 'Skipped' }), row({ businessName: 'C Plumbing' })));

  assert.strictEqual(out.rows.length, 2);
  assert.strictEqual(out.rows[1].domain, DOMAINS[1],
    'a refused row left a hole in the domain list');
  assert.strictEqual(out.rows[1].design, DESIGNS[1]);
});

test('AND RUNNING OUT OF DOMAINS IS SAID, NOT WRAPPED AROUND', () => {
  /* Wrapping would give two sites the same address, and the second would be
   * refused by the route after the first had been accepted — a batch that
   * half exists. */
  const out = run(file(row({ businessName: 'A Plumbing' }), row({ businessName: 'B Plumbing' })), { domains: ['only-one.com'] });

  assert.strictEqual(out.rows.length, 1);
  assert.match(line(out, 2).reason, /no domain left/);
});

test('AND RUNNING OUT OF LAYOUTS IS SAID TOO', () => {
  const out = run(file(row({ businessName: 'A Plumbing' }), row({ businessName: 'B Plumbing' })), { designs: ['ledger'] });

  assert.strictEqual(out.rows.length, 1);
  assert.match(line(out, 2).reason, /no layout left/);
});

/* ===================================================================== */

section('THE ADDRESS, WHICH IS THE ONE THING THAT CANNOT BE FIXED AFTER');

test('THE PREFIX IS WHAT THE WIZARD WOULD HAVE DERIVED', () => {
  /* THE SAME FOUR OPERATIONS IN THE SAME ORDER as the `slug` closure in
   * renderCloudflareFields(). A CSV row and a typed one must produce the
   * same address, or the preview shows a prefix the wizard would not have
   * offered. */
  assert.strictEqual(B.prefixFrom('Cold Air Conditioning Austin'),
    'cold-air-conditioning-austin');
  assert.strictEqual(B.prefixFrom('  A & B  Plumbing!! '), 'a-b-plumbing');
  assert.strictEqual(B.prefixFrom('---'), '');
});

test('AND normalisePrefix IS STILL THE JUDGE, SO www IS REFUSED', () => {
  /* On a pool domain `www` is the one prefix that cannot be had: the apex
   * site is served from it. This file must not learn that rule a second
   * time — it asks the module that owns it. */
  const out = run(file(row({ businessName: 'WWW' })));

  assert.strictEqual(out.rows.length, 0);
  assert.match(out.errors[0].reason, /www/);
});

test('AND A NAME THAT SLUGS TO NOTHING IS REFUSED', () => {
  const out = run(file(row({ businessName: '"!!! ???"' })));

  assert.strictEqual(out.rows.length, 0);
  assert.match(out.errors[0].reason, /usable address/);
});

test('AND TWO ROWS CANNOT CLAIM ONE ADDRESS', () => {
  /* The route would refuse the second after accepting the first, which is a
   * batch that half exists — and the names differ by punctuation the slug
   * throws away, so the file looks fine. */
  const out = run(file(row(), row({ businessName: '"Leander Plumbing!"' })));

  assert.strictEqual(out.rows.length, 1);
  assert.match(line(out, 2).reason, /same address as row 1/);
});

/* ===================================================================== */

section('THE THREE COLUMNS THE SERVER REQUIRES AND EDWIN DID NOT LIST');

test('A CITY CELL IS A TOWN AND A STATE, SPLIT ON THE LAST COMMA', () => {
  /* localAddress() wants them apart and people write them together. The
   * LAST comma, not the first — "Lake Forest Park, WA" is one town. */
  const out = run(file(row({ city: '"Lake Forest Park, WA"' })));

  assert.strictEqual(out.errors.length, 0, out.errors[0] && out.errors[0].reason);
  assert.strictEqual(out.rows[0].city, 'Lake Forest Park');
  assert.strictEqual(out.rows[0].state, 'WA');

  /* THE LAST COMMA, AND A MUTANT MADE ME SAY SO. Splitting on the FIRST
   * one passed every test above, because a town and a state have exactly
   * one comma between them and the two are then the same character.
   *
   * They differ the moment a locality carries its own, and the rule has to
   * be decided rather than inherited from whichever index was typed:
   * EVERYTHING BEFORE THE LAST COMMA IS THE PLACE, the last part is the
   * state. Splitting first would hand "Shoreline, WA" to the state check
   * and refuse a row that is perfectly well formed.
   *
   *     A CHOICE THAT ONLY SHOWS ON INPUT NOBODY HAS TYPED YET
   *     IS STILL A CHOICE. THE TEST IS WHERE IT IS WRITTEN DOWN. */
  assert.deepStrictEqual(B.splitPlace('Lake Forest Park, Shoreline, WA'),
    { city: 'Lake Forest Park, Shoreline', state: 'WA' });
});

test('AND THE STATE IS UPPERCASED, LIKE localAddress DOES', () => {
  /* It uppercases before it checks the code. A preview showing `tx` beside
   * a build that stored `TX` is a difference somebody would try to
   * explain. */
  assert.strictEqual(run(file(row({ city: '"Austin, tx"' }))).rows[0].state, 'TX');
});

test('AND A CITY WITH NO STATE IS REFUSED, WITH THE SHAPE SPELLED OUT', () => {
  const out = run(file(row({ city: 'Austin' })));

  assert.strictEqual(out.rows.length, 0);
  assert.match(out.errors[0].reason, /Austin, TX/);
});

test('AND A STATE THAT IS NOT TWO LETTERS IS REFUSED', () => {
  const out = run(file(row({ city: '"Austin, Texas"' })));

  assert.strictEqual(out.rows.length, 0);
  assert.match(out.errors[0].reason, /two-letter state code/);
});

test('A ZIP IS FIVE DIGITS, AND A SHORT ONE IS CAUGHT HERE NOT BY THE ROUTE', () => {
  /* The route would catch it, against a field name, in a batch of seven
   * with no line numbers on screen. A blank and a four-digit one read the
   * same on purpose: both are "the zip column is wrong on this row". */
  for (const bad of ['787', '', '7870A', '78701-1234']) {
    const out = run(file(row({ zip: bad })));

    assert.strictEqual(out.rows.length, 0, `${bad} was accepted as a ZIP`);
    assert.match(out.errors[0].reason, /5-digit ZIP/);
  }

  assert.strictEqual(run(file(row({ zip: '78701' }))).rows.length, 1);
});

test('AN EMAIL IS REQUIRED, BECAUSE validateGlobalFields REQUIRES ONE', () => {
  /* Edwin's columns did not include it and the server will not build
   * without it. A file that passed this screen and was then refused row by
   * row by the route is the failure this whole preview exists to stop. */
  const out = run(file(row({ email: '' })));

  assert.strictEqual(out.rows.length, 0);
  assert.match(out.errors[0].reason, /contact page/);
});

test('AND A CELL WITH NO @ IN IT IS A SHIFTED COLUMN, CAUGHT EARLY', () => {
  /* DELIBERATELY LOOSE. This is not the place to litigate what an address
   * is — the route and the mail server both have opinions — but a phone
   * number in the email column means somebody dropped a cell, and that is
   * worth catching while the line number is still on screen. */
  const out = run(file(row({ email: '(512) 555-0100' })));

  assert.strictEqual(out.rows.length, 0);
  assert.match(out.errors[0].reason, /not an email address/);
});

test('AND THE MISSING-CELL MESSAGES NAME THE COLUMN, NOT "INVALID ROW"', () => {
  const cases = [
    [{ businessName: '' }, /business name/i],
    [{ street: '' }, /street/i],
    [{ phone: '' }, /phone/i],
  ];

  for (const [over, pattern] of cases) {
    const out = run(file(row(over)));

    assert.strictEqual(out.rows.length, 0, JSON.stringify(over) + ' was accepted');
    assert.match(out.errors[0].reason, pattern);
  }
});

section('WHAT EACH ROW BECOMES');

test('THE ENTRY IS A COMPLETE SUBMISSION, NOT A PATCH OVER A FORM', () => {
  /* THERE IS NO FORM BEHIND THIS DOOR. Edwin, 20 November: a sidebar row,
   * a screen that takes a file, and a button. So every value the build
   * needs is either a column or a default written here. */
  const out = run(file(row()));
  const entry = out.rows[0].entry;

  /* THE DEFAULTS THIS DOOR SETS, which no form asks for. */
  assert.strictEqual(entry['global[siteMode]'], 'localoptions');
  assert.strictEqual(entry['global[is24Hours]'], 'true');
  assert.strictEqual(entry['global[logoSource]'], 'wordmark');

  /* THE SEVEN COLUMNS, AND THE ADDRESS IN FOUR PARTS. generateBatchRoute
   * calls localAddress(global) and composes `address` and `location`
   * itself — doing it here would be a second copy of that formatting. */
  assert.strictEqual(entry['global[businessName]'], 'Leander Plumbing');
  assert.strictEqual(entry['global[businessType]'], 'plumbing');
  assert.strictEqual(entry['global[street]'], '1 Main St');
  assert.strictEqual(entry['global[city]'], 'Austin');
  assert.strictEqual(entry['global[state]'], 'TX');
  assert.strictEqual(entry['global[zip]'], '78701');
  assert.strictEqual(entry['global[phone]'], '(512) 555-0100');
  assert.strictEqual(entry['global[email]'], 'owner@example.com');

  assert.ok(!('global[address]' in entry), 'the composed address was written here too');
  assert.ok(!('global[location]' in entry), 'the composed location was written here too');
});

test('AND IT CARRIES THE ADDRESS AND THE LAYOUT THE PAIRING CHOSE', () => {
  /* THE FLAT `global[...]` SHAPE, which is what FormData produces in the
   * browser and what generateBatchRoute reads. Anything else would be a
   * second format to keep in step with the first. */
  const out = run(file(row()));
  const entry = out.rows[0].entry;

  assert.strictEqual(entry['global[cloudflare][domain]'], DOMAINS[0]);
  assert.strictEqual(entry['global[cloudflare][prefix]'], 'leander-plumbing');
  assert.strictEqual(entry['global[design]'], DESIGNS[0]);
});

test('AND THE ROUTE CAN SEE WHERE IT IS ADDRESSED', () => {
  /* ⚠ THIS IS THE ONE THAT SHIPPED BROKEN, 20 November.
   *
   * Seven rows parsed, seven domains paired, seven layouts assigned, the
   * preview table correct to the last cell — and vetOne() answered
   *
   *     Site 1 is not addressed to Cloudflare.
   *
   * Because CLOUDFLARE IS A DESTINATION, NOT A MODE. The entry said
   * `siteMode: localoptions` and said nothing at all about where the site
   * went, and those are two separate questions that vetOne asks one after
   * the other. Passing the first tells you nothing about the second.
   *
   * Asked through siteTargetOf() rather than by reading the key, because
   * the key is a bracket-notation string and the failure mode is a
   * spelling the route does not share. */
  const entry = run(file(row())).rows[0].entry;

  assert.strictEqual(siteTargetOf(entry), 'cloudflare',
    'the route reads no destination out of this entry');
});

test('AND checkWant() HAS ALL THREE OF THE FIELDS IT REFUSES WITHOUT', () => {
  /* checkWant() is `if (!name || !prefix) return badName` — so an entry
   * carrying the subdomain and the domain but no NAME is refused for a
   * field the CSV never mentions, with a message about a box this screen
   * does not have.
   *
   *     A FIELD WITH NO COLUMN STILL HAS TO BE WRITTEN BY SOMEBODY. */
  const want = wantedAddress(run(file(row())).rows[0].entry);

  assert.strictEqual(want.name, 'Leander Plumbing');
  assert.strictEqual(want.prefix, 'leander-plumbing');
  assert.strictEqual(want.domain, DOMAINS[0]);
});

test('AND NO TWO ROWS SHARE AN ENTRY OBJECT', () => {
  /* Each one is built fresh. An entryFor that returned a shared object, or
   * wrote into one, would give every site in the batch the last row's
   * business name — seven builds of one business on seven domains, each
   * reported as a success. */
  const out = run(file(
    row({ businessName: 'A Plumbing' }),
    row({ businessName: 'B Plumbing' })));

  assert.strictEqual(out.rows.length, 2, out.errors[0] && out.errors[0].reason);

  assert.notStrictEqual(out.rows[0].entry, out.rows[1].entry, 'both rows are one object');

  assert.strictEqual(out.rows[0].entry['global[businessName]'], 'A Plumbing');
  assert.strictEqual(out.rows[1].entry['global[businessName]'], 'B Plumbing');
});

/* ===================================================================== */

section('THE LIMITS');

test('A FILE WITH NO ROWS SAYS SO', () => {
  assert.match(run('').errors[0].reason, /no rows/);
  assert.match(run('\n\n').errors[0].reason, /no rows/);
});

test('AND MORE ROWS THAN THE ROUTE ACCEPTS IS REFUSED HERE', () => {
  /* A CSV that parsed twelve rows cleanly and was then refused by the route
   * would be a file this screen said was fine and the next one did not. */
  const many = Array.from({ length: B.MAX_ROWS + 1 },
    (_, i) => row({ businessName: `Business ${i}` })).join('\n');

  const out = run(many);

  assert.strictEqual(out.rows.length, 0);
  assert.match(out.errors[0].reason, new RegExp(`up to ${B.MAX_ROWS}`));
});

test('AND THAT NUMBER IS THE ROUTE\'S OWN', () => {
  /* NOT IMPORTED FROM IT — that module pulls in Express, the Job model and
   * a Mongo connection, and this suite runs in a tenth of a second. So the
   * two are asserted to agree instead, which is the cheap half of the same
   * guarantee. */
  const route = fs.readFileSync(
    path.join(__dirname, 'routes', 'generateBatchRoute.js'), 'utf8');

  const found = /const MAX_SITES = (\d+);/.exec(route);

  assert.ok(found, 'generateBatchRoute no longer declares MAX_SITES');
  assert.strictEqual(Number(found[1]), B.MAX_ROWS,
    'the CSV screen and the route disagree about how many sites a batch holds');
});

/* ===================================================================== */

for (const dir of temps) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
