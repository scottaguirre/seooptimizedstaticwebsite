// test-hours.js
//
// Business hours: what is refused, and what the site ends up saying.
//
// WHAT THIS IS GUARDING
//
// Carol filled in opening hours instead of using the 24-hour switch, pressed
// Generate, and got "Missing/invalid business hours" with nothing naming a
// day. She also asked how to pick AM or PM, which has no answer: the boxes are
// <input type="time"> and the clock they display belongs to her computer.
//
// Two separate faults came out of reading it:
//
//  1. CLOSING EARLIER THAN OPENING WAS REFUSED. The rule was `open >= close`,
//     a string compare on "HH:MM". Every business that shuts after midnight —
//     a bar at 1am, a diner at 6am — was told its hours were invalid and could
//     not generate a site at all. There was no way to express what it meant.
//
//  2. THE REFUSAL NAMED NO DAY on screen. It does fill in per-field markers,
//     but by the time Generate is pressed the hours inputs are gone from the
//     page and only hidden mirrors carry their names — so the red outline
//     lands on something invisible.
//
// THE RISK THIS FILE EXISTS FOR
//
// Both failures are silent from the outside: the server stays up, the form
// looks fine, and the person is simply stuck. Nothing here had a single test
// before today, including the compare that caused it.
//
//   node test-hours.js

const assert = require('assert');
const { validateGlobalFields } = require('./utils/helpers');
const {
  getHoursTimeText, getHoursDaysText, formatTime, describeDay, isOvernight,
} = require('./utils/formatDaysAndHoursForDisplay');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}
function section(name) { console.log(`\n${name}\n`); }

const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];

/** Every other field the validator wants, so only the hours are under test. */
function base(extra = {}) {
  return {
    businessName: 'AT Plumbing Austin',
    phone: '512-555-0100',
    email: 'hello@example.com',
    address: '1 Main St',
    city: 'Austin',
    state: 'TX',
    zip: '78701',
    ...extra,
  };
}

/** The same hours every day. */
function week(day) {
  return DAYS.reduce((acc, d) => (acc[d] = { ...day }, acc), {});
}

const hoursError = (result) =>
  (result.fields || []).filter(f => String(f.name).startsWith('global[hours]'));

/* ===================================================================== */

section('A day that ends after midnight');

test('closing earlier than opening is accepted', () => {
  /* The whole point. A bar open 5pm to 1am used to be refused outright. */
  const r = validateGlobalFields(base({ hours: week({ open: '17:00', close: '01:00' }) }));
  assert.deepStrictEqual(hoursError(r), [],
    'an overnight day was rejected: ' + JSON.stringify(r.fields));
});

test('a 10pm to 6am shift is accepted', () => {
  const r = validateGlobalFields(base({ hours: week({ open: '22:00', close: '06:00' }) }));
  assert.deepStrictEqual(hoursError(r), []);
});

test('an ordinary day is still accepted', () => {
  const r = validateGlobalFields(base({ hours: week({ open: '09:00', close: '17:00' }) }));
  assert.deepStrictEqual(hoursError(r), []);
});

/* ===================================================================== */

section('What is still refused');

test('opening and closing at the same time is refused', () => {
  /* Nought hours or twenty-four — and there is a switch for twenty-four. */
  const r = validateGlobalFields(base({ hours: week({ open: '09:00', close: '09:00' }) }));
  assert.strictEqual(r.ok, false);
  assert.ok(hoursError(r).length, 'identical times were accepted');
});

test('the same-time refusal points at the 24-hour switch', () => {
  /* Otherwise the only way out looks like typing a different time, which is
   * not what the person meant. */
  const r = validateGlobalFields(base({ hours: week({ open: '00:00', close: '00:00' }) }));
  assert.match(r.error, /Open 24 Hours/);
});

test('a missing closing time is still refused', () => {
  const hours = week({ open: '09:00', close: '17:00' });
  hours.wednesday = { open: '09:00', close: '' };
  const r = validateGlobalFields(base({ hours }));
  assert.strictEqual(r.ok, false);
  assert.ok(hoursError(r).some(f => f.name === 'global[hours][wednesday][close]'));
});

test('a day marked Closed needs no times', () => {
  const hours = week({ open: '09:00', close: '17:00' });
  hours.sunday = { closed: 'true' };
  const r = validateGlobalFields(base({ hours }));
  assert.deepStrictEqual(hoursError(r), []);
});

test('the 24-hour switch skips the per-day rules entirely', () => {
  const r = validateGlobalFields(base({ is24Hours: 'on', hours: {} }));
  assert.deepStrictEqual(hoursError(r), []);
});

/* ===================================================================== */

section('The refusal says which day');

test('a missing time names the day in the message', () => {
  /* The per-field markers land on hidden inputs, so the sentence is the only
   * thing the person actually reads. */
  const hours = week({ open: '09:00', close: '17:00' });
  hours.saturday = { open: '', close: '' };
  const r = validateGlobalFields(base({ hours }));
  assert.match(r.error, /Saturday/,
    'the message does not name the day: ' + r.error);
});

test('two bad days are both named', () => {
  const hours = week({ open: '09:00', close: '17:00' });
  hours.tuesday = { open: '', close: '17:00' };
  hours.friday  = { open: '09:00', close: '09:00' };
  const r = validateGlobalFields(base({ hours }));
  assert.match(r.error, /Tuesday/);
  assert.match(r.error, /Friday/);
});

test('good days are not named', () => {
  const hours = week({ open: '09:00', close: '17:00' });
  hours.saturday = { open: '', close: '' };
  const r = validateGlobalFields(base({ hours }));
  assert.ok(!/Monday/.test(r.error),
    'a day that was fine was named as a problem: ' + r.error);
});

/* ===================================================================== */

section('What the site says');

test('midnight and noon are not confused', () => {
  /* The classic 12-hour trap: hour 0 and hour 12 both map to "12". */
  assert.strictEqual(formatTime('00:00'), '12:00 AM');
  assert.strictEqual(formatTime('12:00'), '12:00 PM');
  assert.strictEqual(formatTime('00:30'), '12:30 AM');
  assert.strictEqual(formatTime('12:30'), '12:30 PM');
});

test('afternoon times read as PM', () => {
  assert.strictEqual(formatTime('13:00'), '1:00 PM');
  assert.strictEqual(formatTime('17:30'), '5:30 PM');
  assert.strictEqual(formatTime('23:59'), '11:59 PM');
});

test('an empty or impossible time produces nothing, not a wrong time', () => {
  /* The empty case is the one that shipped: Number('') is 0, so a blank box
   * used to render on the published page as "12:00 AM". */
  for (const bad of ['', '   ', null, undefined, 'tea time', '99:00', '-1:00', '12', '12:60']) {
    assert.strictEqual(formatTime(bad), '', `${JSON.stringify(bad)} produced a time`);
  }
});

test('a half-written time is not silently completed', () => {
  /* "9:5" cannot come from a time input, but it can come from a restored
   * draft or a hand-edited record. Reading it as 9:05 invents a closing time
   * nobody chose and prints it on the site. */
  assert.strictEqual(formatTime('9:5'), '');
  assert.strictEqual(formatTime('9:00'), '9:00 AM', 'a single-digit hour is legitimate');
});

test('an overnight day is labelled as such on the page', () => {
  /* Without this, "5:00 PM – 1:00 AM" reads like a mistake to a visitor, and
   * a genuine mistake reads like overnight trading to the owner. */
  const line = describeDay('friday', { open: '17:00', close: '01:00' });
  assert.match(line, /next day/);
});

test('an ordinary day carries no overnight note', () => {
  const line = describeDay('friday', { open: '09:00', close: '17:00' });
  assert.ok(!/next day/.test(line), line);
});

test('isOvernight is about the clock, not about the text', () => {
  assert.strictEqual(isOvernight('17:00', '01:00'), true);
  assert.strictEqual(isOvernight('09:00', '17:00'), false);
  assert.strictEqual(isOvernight('09:00', '09:00'), false);
  assert.strictEqual(isOvernight('', '01:00'), false);
});

test('the long form is used for the form preview, the short form for the site', () => {
  assert.match(describeDay('monday', { open: '09:00', close: '17:00' }, { long: true }), /^Monday:/);
  assert.match(describeDay('monday', { open: '09:00', close: '17:00' }), /^Mon:/);
});

test('a closed day says Closed', () => {
  assert.strictEqual(describeDay('sunday', { closed: true }), 'Sun: Closed');
  assert.strictEqual(describeDay('sunday', { closed: 'true' }), 'Sun: Closed');
});

test('the 24-hour switch overrides every day', () => {
  assert.strictEqual(getHoursTimeText('on', week({ open: '09:00', close: '17:00' })), 'Open 24 Hours');
});

test('the week summary no longer says "Edwin"', () => {
  /* It did, until 8 October — a note to self left inside a return value,
   * one call site away from a customer's homepage. */
  const hours = week({ open: '09:00', close: '17:00' });
  hours.saturday = { closed: true };
  hours.sunday = { closed: true };
  const out = getHoursDaysText(false, hours);
  assert.ok(!/Edwin/.test(out), `the summary still says: ${out}`);
  assert.strictEqual(out, 'Closed: Sat, Sun');
});

/* ===================================================================== */

section('The browser and Node get the same module');

test('it attaches to window when there is one', () => {
  /* The form's preview and the generated page must word a day identically.
   * They do that by being the same file, served at /js/hoursFormat.js. */
  const path = require('path');
  const src = require('fs').readFileSync(
    path.join(__dirname, 'utils', 'formatDaysAndHoursForDisplay.js'), 'utf8');

  const fakeWindow = {};
  // eslint-disable-next-line no-new-func
  new Function('window', 'module', src)(fakeWindow, undefined);

  assert.ok(fakeWindow.HoursFormat, 'nothing was attached to window');
  assert.strictEqual(
    fakeWindow.HoursFormat.describeDay('monday', { open: '17:00', close: '01:00' }),
    describeDay('monday', { open: '17:00', close: '01:00' }),
    'the browser copy and the Node copy word a day differently'
  );
});

/* ===================================================================== */

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
