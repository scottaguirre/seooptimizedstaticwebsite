// test-csv-topics.js
//
// A spreadsheet of topics, read in the browser, into the box.
//
// WHY THIS SUITE IS WORTH MORE THAN IT LOOKS. The function it tests is the
// one the PAGE runs: csvTopics.js emits its own source into a <script> tag
// rather than keeping a hand-written copy there. That makes this file the
// only thing standing between a customer's CSV and a parser nobody checked
// — and the last section below is what proves the emitted copy and the
// tested copy are still the same function.
//
// NO DOM. The parser takes text and returns lines; picking the file and
// writing the box are four lines of wiring in the page, asserted by
// test-static-blogs.js.

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

const { csvToTopicLines, browserSource } = require('./utils/blog/csvTopics');

/* ==================================================================== */

section('THE SHAPE PEOPLE ACTUALLY EXPORT');

test('three columns become the line the box already understands', () => {
  const lines = csvToTopicLines(
    'Signs a water heater is failing,water heater failing,failing water heater\n'
  );

  assert.deepStrictEqual(lines, [
    'Signs a water heater is failing | water heater failing | failing water heater',
  ]);
});

test('two columns leave the link phrase off rather than writing an empty one', () => {
  assert.deepStrictEqual(
    csvToTopicLines('What a repair costs,water heater repair cost\n'),
    ['What a repair costs | water heater repair cost']
  );
});

test('one column is a topic on its own, as a typed line would be', () => {
  /* parseTopics falls back to the topic for a missing phrase, so there is
   * nothing to add here and nothing to apologise for. */
  assert.deepStrictEqual(csvToTopicLines('How long a tank lasts\n'), ['How long a tank lasts']);
});

test('a trailing empty column is not written out as a bare pipe', () => {
  /* "Topic |  | " round-trips to the same campaign, but it reads like a
   * mistake and invites somebody to fill in a box that did not need it. */
  assert.deepStrictEqual(csvToTopicLines('How long a tank lasts,,\n'), ['How long a tank lasts']);
});

test('a middle column left empty keeps the link phrase in the third place', () => {
  /* The positions have to hold. Collapsing the gap would slide the link
   * phrase into the search phrase's place and the campaign would chase the
   * wrong query. */
  assert.deepStrictEqual(
    csvToTopicLines('How long a tank lasts,,tank lifespan\n'),
    ['How long a tank lasts |  | tank lifespan']
  );
});

section('THE COMMAS INSIDE THE TOPICS');

test('A QUOTED FIELD KEEPS ITS COMMAS, WHICH IS WHY THIS IS A FILE AND NOT A PASTE', () => {
  /* THE REASON PASTING CSV INTO THE BOX IS NOT OFFERED. Topics contain
   * commas — this is one topic, not three — and a naive split would shred
   * it silently. Every spreadsheet quotes such a field; a real reader is
   * the only thing that can honour it. */
  assert.deepStrictEqual(
    csvToTopicLines('"Water heater repair, costs, and timing",repair cost\n'),
    ['Water heater repair, costs, and timing | repair cost']
  );
});

test('a doubled quote inside a quoted field is one quote, not the end of it', () => {
  /* Reading "" as a closing quote turns the rest of the row into columns
   * nobody asked for, and the topic silently loses its tail. */
  assert.deepStrictEqual(
    csvToTopicLines('"The ""popping"" sound",water heater popping\n'),
    ['The "popping" sound | water heater popping']
  );
});

test('a newline inside a quoted field does not start a new topic', () => {
  assert.deepStrictEqual(
    csvToTopicLines('"Signs a heater\nis failing",failing heater\n'),
    ['Signs a heater is failing | failing heater']
  );
});

test('a quote in the middle of an unquoted field is just a character', () => {
  assert.deepStrictEqual(
    csvToTopicLines('The 12" pipe question,pipe sizing\n'),
    ['The 12" pipe question | pipe sizing']
  );
});

section('WHAT FILES FROM THE REAL WORLD DO');

test('A BYTE ORDER MARK DOES NOT RIDE ALONG INSIDE THE FIRST TOPIC', () => {
  /* Excel writes it and nothing shows it. Left in place, the first post of
   * the campaign gets a title and a slug subtly unlike every other one and
   * nobody can see why. The plugin learned this the same way. */
  const lines = csvToTopicLines('﻿Signs a heater is failing,failing heater\n');

  assert.deepStrictEqual(lines, ['Signs a heater is failing | failing heater']);
  assert.ok(!lines[0].includes('﻿'), 'the mark survived into the topic');
});

test('CRLF is one line break, not two', () => {
  assert.deepStrictEqual(
    csvToTopicLines('First topic here\r\nSecond topic here\r\n'),
    ['First topic here', 'Second topic here']
  );
});

test('THE LAST ROW SURVIVES A FILE THAT DOES NOT END IN A NEWLINE', () => {
  /* Plenty do not, and dropping the final topic of every such file is the
   * kind of bug that gets blamed on the spreadsheet. */
  assert.deepStrictEqual(
    csvToTopicLines('First topic here\nSecond topic here'),
    ['First topic here', 'Second topic here']
  );
});

test('blank lines and whitespace rows are dropped, not turned into topics', () => {
  assert.deepStrictEqual(
    csvToTopicLines('First topic here\n\n   \n,,\nSecond topic here\n'),
    ['First topic here', 'Second topic here']
  );
});

test('whitespace around a cell is trimmed and runs are collapsed', () => {
  assert.deepStrictEqual(
    csvToTopicLines('  Signs   a  heater  is failing  ,  failing heater  \n'),
    ['Signs a heater is failing | failing heater']
  );
});

section('THE TWO THINGS IT REFUSES TO PASS ON');

test('A HEADER ROW IS NOT THE FIRST ARTICLE OF THE CAMPAIGN', () => {
  /* People export with the column names on top. "topic" as a line of its
   * own would otherwise be planned, written and published. */
  assert.deepStrictEqual(
    csvToTopicLines('topic,keyword,link phrase\nSigns a heater is failing,failing heater,x\n'),
    ['Signs a heater is failing | failing heater | x']
  );
});

test('but only the bare word, so a real topic beginning with it is kept', () => {
  /* The guess has to be narrow. A sentence is a topic; the single word is
   * a column name and nothing else. */
  assert.deepStrictEqual(
    csvToTopicLines('Topics every plumber should cover,plumbing topics\n'),
    ['Topics every plumber should cover | plumbing topics']
  );
});

test('and never on a later row, where the word is somebody\'s actual topic', () => {
  const lines = csvToTopicLines('First topic here\ntopic\n');

  assert.deepStrictEqual(lines, ['First topic here', 'topic']);
});

test('DUPLICATE TOPICS ARE DROPPED, CASE AND SPACING ASIDE', () => {
  /* Two rows with the same topic are a copy-paste accident. Planning would
   * give them near-identical slugs and then refuse the whole campaign for
   * chasing the same search — a confusing way to find out you pasted
   * twice. */
  assert.deepStrictEqual(
    csvToTopicLines('Signs a heater is failing,a\nSIGNS A HEATER IS FAILING,b\n  Signs a   heater is failing ,c\n'),
    ['Signs a heater is failing | a']
  );
});

test('a topic called __proto__ is counted like any other', () => {
  /* A plain {} has no own "__proto__" property to set, so one of these
   * would never be seen as a duplicate — and "constructor" would read back
   * truthy on its FIRST sighting and be dropped. */
  assert.deepStrictEqual(
    csvToTopicLines('__proto__\n__proto__\nconstructor\nconstructor\n'),
    ['__proto__', 'constructor']
  );
});

section('THE SEPARATOR THE BOX RESERVES');

test('A PIPE INSIDE A CELL DOES NOT INVENT A COLUMN ON THE WAY BACK IN', () => {
  /* The box splits on pipes. A topic carrying one would arrive at
   * parseTopics as a topic and a search phrase nobody wrote. */
  assert.deepStrictEqual(
    csvToTopicLines('Repair | replace: which one,repair or replace\n'),
    ['Repair replace: which one | repair or replace']
  );
});

section('WHAT IT WILL NOT READ AT ALL');

test('a file that is not a topic list stops at the row ceiling', () => {
  /* NOT A CAP ON TOPICS. createCampaign refuses more than 52 in a sentence
   * that says so, and repeating that number here would be a second place
   * for it to be wrong. This is only a guard against a file that is not a
   * topic list at all. */
  const huge = Array.from({ length: 2500 }, (_, i) => `Topic number ${i}`).join('\n');
  const lines = csvToTopicLines(huge);

  assert.strictEqual(lines.length, 2000, 'the ceiling is not where it says it is');
});

test('AND A WINDOWS FILE GETS THE SAME CEILING AS A UNIX ONE', () => {
  /* THE MUTANT THIS EXISTS FOR. Dropping the CRLF guard changes nothing
   * visible in a small file — \r ends a row, \n ends an empty one, and
   * empty rows are thrown away — so every other test here passed without
   * it. What it does change is the COUNTING: each line costs two rows,
   * and a Windows export hits the ceiling at half the topics a Unix one
   * does. Same file, same content, half the campaign, no message.
   *
   * It is also the only place the guard is observable at all, which is
   * why the test is phrased as a count rather than as a line break. */
  const windows = Array.from({ length: 2500 }, (_, i) => `Topic number ${i}`).join('\r\n');

  assert.strictEqual(csvToTopicLines(windows).length, 2000,
    'a CRLF file was cut off early, because each line was counted twice');
});

test('nothing at all is no lines, not a crash', () => {
  for (const nothing of ['', null, undefined, '\n\n\n']) {
    assert.deepStrictEqual(csvToTopicLines(nothing), [], `${JSON.stringify(nothing)} threw or returned something`);
  }
});

section('THE COPY THE PAGE ACTUALLY RUNS');

test('THE EMITTED SOURCE IS A FUNCTION, AND IT IS THIS ONE', () => {
  /* THE POINT OF THE WHOLE ARRANGEMENT. The page is handed this function's
   * own source rather than a hand-written copy, so there is one parser and
   * this suite tests it. If a build ever instruments or transpiles the
   * module — coverage counters, a bundler, anything — the emitted text
   * stops being self-contained and this is where it is caught, rather than
   * in a customer's browser at the moment they pick a file. */
  const sandboxed = new Function(`return (${browserSource()});`)();

  assert.strictEqual(typeof sandboxed, 'function', 'what was emitted is not a function');

  const cases = [
    'Signs a heater is failing,failing heater,failing water heater\n',
    '"Water heater repair, costs, and timing",repair cost\n',
    '﻿topic,keyword,link\nFirst one,a,b\nFirst one,c,d\n',
    'No trailing newline here',
    '',
  ];

  for (const text of cases) {
    assert.deepStrictEqual(
      sandboxed(text), csvToTopicLines(text),
      `the emitted parser disagreed with the tested one on ${JSON.stringify(text.slice(0, 40))}`
    );
  }
});

test('and it reaches for nothing outside its own body', () => {
  /* In the browser the function stands alone. A require, or a constant
   * declared outside its body, is a ReferenceError at the moment somebody
   * picks a file — and the sandbox above only catches that for the paths
   * its cases happen to walk.
   *
   * THE BAN IS ON THE WORD, COMMENTS INCLUDED, and that is not an accident
   * of the regex. Comments inside the body are emitted into the page too,
   * so a sentence about module scope ships to the browser exactly like a
   * reference to it would. It caught this file's own comment the first
   * time it ran — the same way the banned-phrase test caught an HTML
   * comment quoting the phrase. Reword the comment; do not soften the
   * test. */
  const source = browserSource();

  assert.ok(!/\brequire\s*\(/.test(source), 'the emitted source requires something');
  assert.ok(!/\bmodule\b/.test(source), 'the emitted source mentions module');
  assert.ok(!/\bexports\b/.test(source), 'the emitted source mentions exports');
  assert.ok(!/\bprocess\b/.test(source), 'the emitted source mentions process');
});

test('and it carries no invisible characters of its own', () => {
  /* THIS ONE IS HERE BECAUSE IT HAPPENED. The BOM-stripping regex was
   * written as /^﻿/ and reached the file as /^<a real byte order
   * mark>/ — which WORKS, matches the same character, and passes every
   * behavioural test above. It is still wrong: the character is invisible
   * in the source, so nobody reading the file can see what the regex
   * matches, and any tool that normalises or strips marks on the way to
   * the browser silently removes the only thing that handles them.
   *
   * Escapes survive being copied, re-encoded and inlined into a page.
   * Literal control characters do not. */
  const source = browserSource();

  for (const ch of source) {
    assert.ok(ch.charCodeAt(0) !== 0xFEFF, 'a literal byte order mark is in the source');
  }

  assert.ok(source.includes('\\uFEFF'), 'the mark is no longer matched by an escape');
});

test('AND IT CANNOT BREAK OUT OF THE SCRIPT TAG IT IS WRITTEN INTO', () => {
  /* The source goes inside <script>...</script>. A closing tag anywhere in
   * it — in a string, in a comment — ends the script early and the rest of
   * the function becomes page content. Nothing here writes one today; this
   * is the test that notices the day somebody adds one. */
  assert.ok(!/<\/script/i.test(browserSource()), 'the emitted source closes the script tag');
});

/* ======================================================================= */

(async () => {
  for (const run of queue) await run();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
