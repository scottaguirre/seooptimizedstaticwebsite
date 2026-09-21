// test-phone.js
//
// The phone number: whether a site can be generated with a junk one.
//
// WHY THIS EXISTS
//
// `phone` was already in requiredGlobalFields, so a BLANK one was rejected at
// three layers. Nothing checked the FORMAT, and that gap was invisible because
// the input says type="tel" — which looks like validation and is not. Unlike
// type="email", a browser accepts any string in a tel input.
//
// So these all passed every layer and generated a complete site:
//
//     phone "x"         title: Acme Plumbing in Austin, TX | Call x
//     phone "call me"   title: Acme Plumbing in Austin, TX | Call call me
//                       link:  tel:+1
//
// That string goes into every page title, every meta description, the
// LocalBusiness schema and every click-to-call link, and the build charges 500
// credits. The customer finds out when nobody rings.
//
//   node test-phone.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { isDialablePhone, validateGlobalFields } = require('./utils/helpers');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

/** A form body that is valid apart from whatever the test changes. */
const form = (overrides = {}) => ({
  businessName: 'Acme Plumbing',
  businessType: 'Plumbing',
  domain: 'acmeplumbing.com',
  address: '1 Main St',
  location: 'Austin, TX',
  email: 'owner@acmeplumbing.com',
  phone: '(512) 894-6167',
  is24Hours: '1',
  ...overrides,
});

const phoneErrors = result =>
  (result.fields || []).filter(f => f.name === 'global[phone]');

console.log('\nPhone number\n');

/* -------------------------------------------------------------------------
 * What a customer might reasonably type
 * ---------------------------------------------------------------------- */

test('every common way of writing a real number is accepted', () => {
  // Rejecting a customer's preferred punctuation would be a worse bug than
  // the one this fixes, so the digits are all that matter.
  for (const good of [
    '(512) 894-6167',
    '512-894-6167',
    '512.894.6167',
    '512 894 6167',
    '5128946167',
    '+1 512 894 6167',
    '1-512-894-6167',
    '+1 (512) 894-6167',
    '  (512) 894-6167  ',
  ]) {
    assert.ok(isDialablePhone(good), `rejected a real number: ${JSON.stringify(good)}`);
  }
});

test('the strings that actually shipped are rejected', () => {
  for (const bad of ['x', '555', 'call me', 'n/a', 'tbd', '-', '()']) {
    assert.ok(!isDialablePhone(bad), `accepted junk: ${JSON.stringify(bad)}`);
  }
});

test('a number with the wrong digit count is rejected', () => {
  assert.ok(!isDialablePhone('512894616'),   'nine digits');
  assert.ok(!isDialablePhone('51289461670'), 'eleven digits not starting with 1');
  assert.ok(!isDialablePhone('512894616701'),'twelve digits');
  assert.ok(isDialablePhone('15128946167'),  'eleven starting with 1 is fine');
});

test('empty and missing are rejected by the format check too', () => {
  // The Required check reports those, but this must not throw or say yes.
  for (const empty of ['', '   ', null, undefined]) {
    assert.ok(!isDialablePhone(empty), JSON.stringify(empty));
  }
});

/* -------------------------------------------------------------------------
 * Through the validator the route actually calls
 * ---------------------------------------------------------------------- */

test('a good phone passes the whole form', () => {
  const r = validateGlobalFields(form());
  assert.strictEqual(r.ok, true, JSON.stringify(r.fields));
});

test('a junk phone fails the form with a message naming the format', () => {
  const r = validateGlobalFields(form({ phone: 'call me' }));
  assert.strictEqual(r.ok, false);
  const errs = phoneErrors(r);
  assert.strictEqual(errs.length, 1, JSON.stringify(r.fields));
  assert.ok(/10-digit/.test(errs[0].message), errs[0].message);
});

test('a blank phone says Required, not the format message', () => {
  // Two messages on one field is noise, and "Required" is the accurate one.
  const r = validateGlobalFields(form({ phone: '' }));
  assert.strictEqual(r.ok, false);
  const errs = phoneErrors(r);
  assert.strictEqual(errs.length, 1, JSON.stringify(errs));
  assert.strictEqual(errs[0].message, 'Required');
});

/* -------------------------------------------------------------------------
 * The shadowed `fields` array
 * ---------------------------------------------------------------------- */

test('a phone error survives alongside a business-hours error', () => {
  // The hours block used to declare its own `const fields = []`, shadowing the
  // outer one — so when the hours were wrong the early return sent back ONLY
  // the hours problems and discarded everything collected before it. That
  // swallowed this phone check entirely, which is how the shadowing was found.
  const r = validateGlobalFields(form({
    phone: 'call me',
    is24Hours: '',
    hours: { monday: { open: '', close: '' } },
  }));

  assert.strictEqual(r.ok, false);
  assert.strictEqual(phoneErrors(r).length, 1,
    'the phone error was swallowed by the hours block');
  assert.ok(
    r.fields.some(f => /hours/.test(f.name)),
    'the hours errors went missing instead'
  );
});

test('a missing business name survives a business-hours error too', () => {
  // Same shadowing bug, the case a customer hits more often: fix the hours,
  // resubmit, and only then learn the business name was missing.
  const r = validateGlobalFields(form({
    businessName: '',
    is24Hours: '',
    hours: { monday: { open: '', close: '' } },
  }));

  assert.strictEqual(r.ok, false);
  assert.ok(
    r.fields.some(f => f.name === 'global[businessName]'),
    'the business name error was discarded'
  );
});

/* -------------------------------------------------------------------------
 * The browser-side copy must agree with the server
 * ---------------------------------------------------------------------- */

test('the client-side rule matches the server rule', () => {
  // isPhoneLike() in generateDinamycForm.js duplicates isDialablePhone()
  // because that file is served to the browser and helpers.js is not. A
  // duplicate that drifts is worse than no duplicate: the customer would be
  // waved through the wizard and rejected by the server afterwards.
  const src = fs.readFileSync(
    path.join(__dirname, 'public/js/generateDinamycForm.js'), 'utf8'
  );

  const fn = src.match(/const isPhoneLike = \(value\) => \{([\s\S]*?)\};/);
  assert.ok(fn, 'isPhoneLike is gone from the form script');

  const body = fn[1];
  assert.ok(/replace\(\/\\D\/g, ''\)/.test(body), `does not strip non-digits:\n${body}`);
  assert.ok(/length === 10/.test(body), `lost the 10-digit rule:\n${body}`);
  assert.ok(/length === 11/.test(body) && /startsWith\('1'\)/.test(body),
    `lost the 11-digit rule:\n${body}`);
});

test('the phone input still carries an example', () => {
  // type="tel" validates nothing, so the placeholder is the only thing on the
  // page telling a customer what shape is expected.
  const src = fs.readFileSync(
    path.join(__dirname, 'public/js/generateDinamycForm.js'), 'utf8'
  );
  const input = src.match(/<input type="tel" name="global\[phone\]"[^>]*>/);
  assert.ok(input, 'the phone input is gone');
  assert.ok(/placeholder=/.test(input[0]), input[0]);
  assert.ok(/required/.test(input[0]), input[0]);
});

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('');
process.exit(failed === 0 ? 0 : 1);
