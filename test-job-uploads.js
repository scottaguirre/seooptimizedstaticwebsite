// test-job-uploads.js
//
// A job must never be claimable before its logo is attached.
//
// WHAT THIS IS GUARDING
//
// 9 October, 19:47:54. Three log lines, in this order:
//
//   .211  jobs.started       the runner claimed the job
//   .259  generation.queued  the route finished setting it up
//   .534  jobs.failed        "The logo could not be processed"
//
// The route created the Job with status 'queued', THEN moved the uploads,
// THEN wrote their paths to it. A queued job is claimable the instant it
// exists, so the runner got there first, read `uploads` as the empty default
// and ran a build with no files. jobGenerator's cleanup then deleted the
// folder the route had just filled — which is why the database held a path
// to a directory that was not there.
//
// THE RISK THIS FILE EXISTS FOR
//
// It is a race, so it fails perhaps one time in twenty, and it blames the
// user's file when it does. Edwin hit it twice and spent both attempts
// re-exporting a logo that was never the problem. A test that waits for the
// race is useless; what can be tested is the property that removes it —
// the uploads are on the document the moment it is created.
//
//   node test-job-uploads.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}
function section(name) { console.log(`\n${name}\n`); }

const route = fs.readFileSync(path.join(__dirname, 'routes', 'generateRoute.js'), 'utf8');

/**
 * The CODE of the POST /generate handler.
 *
 * Comments are stripped first. The first version of this file searched the
 * raw source and found "Job.create" inside the comment explaining the bug —
 * so it reported the bug as still present in the fix that removed it. A test
 * that reads prose as code fails for its own reasons; test-server-url.php
 * carries the same warning after the same mistake.
 */
function handler() {
  const start = route.indexOf("router.post('/generate'");
  assert.ok(start > -1, 'the /generate route is gone');
  const end = route.indexOf('\nmodule.exports', start);
  const src = route.slice(start, end === -1 ? undefined : end);

  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // block comments
    .replace(/^[ \t]*\/\/.*$/gm, ' ');    // whole-line comments
}

/* ===================================================================== */

section('The uploads are on the job before anything can claim it');

test('the uploads are moved before Job.create, not after', () => {
  const h = handler();
  const move   = h.indexOf('moveUploadsForJob');
  const create = h.indexOf('Job.create');
  assert.ok(move > -1,   'nothing moves the uploads any more');
  assert.ok(create > -1, 'nothing creates the job any more');
  assert.ok(move < create,
    'Job.create runs before the uploads are moved — the runner can claim a job with no logo');
});

test('Job.create carries the uploads', () => {
  const h = handler();
  const create = h.indexOf('Job.create');
  const body = h.slice(create, create + 900);
  assert.match(body, /\buploads\b/,
    'Job.create no longer passes uploads, so they must be attached by a later write');
});

test('the id is minted before the job, so the folder can be named', () => {
  const h = handler();
  assert.match(h, /new mongoose\.Types\.ObjectId\(\)/,
    'the job id is no longer created up front');
  const mint = h.indexOf('new mongoose.Types.ObjectId()');
  assert.ok(mint < h.indexOf('moveUploadsForJob'),
    'the uploads are moved before there is an id to name their folder');
});

test('nothing attaches uploads in a second write', () => {
  /* The whole bug was the gap between the two writes. A later
   * updateOne({ $set: { uploads } }) would reopen it. */
  const h = handler();
  assert.ok(!/\$set:\s*\{\s*uploads\s*\}/.test(h),
    'uploads are still being attached by a separate update');
});

test('the temp-file cleanup is disarmed before the job is created', () => {
  /* movedUploads guards the finally. If Job.create throws while it is still
   * false, the finally deletes files that a job may yet be given. */
  const h = handler();
  const moved  = h.indexOf('movedUploads = true');
  const create = h.indexOf('Job.create');
  assert.ok(moved > -1, 'the guard is gone');
  assert.ok(moved < create,
    'movedUploads is set after Job.create — a throw in between deletes the logo');
});

/* ===================================================================== */

section('A build with no files says so');

test('the two failures no longer share one message', () => {
  /* "Please try uploading it again" was shown for both, and it is the wrong
   * advice for the race: the file uploaded perfectly. */
  const gen = fs.readFileSync(path.join(__dirname, 'utils', 'runGeneration.js'), 'utf8');
  const i = gen.indexOf('uploadedImages.global.logo');
  assert.ok(i > -1, 'the logo guard is gone');
  const block = gen.slice(i - 200, i + 900);

  assert.match(block, /!files\.length/,
    'nothing distinguishes "no files at all" from "the logo failed to process"');
  assert.match(block, /before its logo was attached/,
    'the no-files case does not say what actually happened');
});

/* ===================================================================== */

section('A missing file is dropped quietly, which is why it hurt');

test('filesFromJob still skips paths that are not on disk', () => {
  /* Not a regression test for a fix — a record of the behaviour that turned
   * a race into a silent wrong answer. If this ever starts throwing instead,
   * that is an improvement, and this test should be rewritten rather than
   * made to pass. */
  const { filesFromJob } = require('./utils/jobUploads');
  const out = filesFromJob({ 'global[logo]': '/nowhere/at/all/xyz' });
  assert.deepStrictEqual(out, [],
    'filesFromJob no longer drops missing files — check the callers still cope');
});

test('filesFromJob keeps a file that is there, with its field name', () => {
  const { filesFromJob } = require('./utils/jobUploads');
  const self = path.join(__dirname, 'test-job-uploads.js');
  const out = filesFromJob({ 'global[logo]': self });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].fieldname, 'global[logo]',
    'the field name must survive: runGeneration matches it with a regex');
});

/* ===================================================================== */

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
