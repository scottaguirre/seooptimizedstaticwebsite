// test-business-refresh.js
//
// The business details a site reports about itself, and the rules for
// writing them over what is already stored.
//
// WHY THESE MATTER. `site.business` was written in exactly one place — the
// licence activation handler — and read in exactly one, the planner, where
// branded anchor text is chosen and then frozen into the slots. Nothing ever
// updated it in between, so a site that renamed itself in Theme Settings
// went on planning campaigns under the name it had the day the licence was
// pasted in. Live example: posts on roofingamerica.xyz linking with
// "TK Water Damage Restoration" and "…in Leander" long after it had become
// Emergency Plumber Austin in Austin, TX.
//
// Every branch below is a REFUSAL to write, and the dangerous direction is
// erasure, not staleness — a blank arriving from an older plugin must not
// wipe a name the customer typed.
//
//   node test-business-refresh.js

const assert = require('assert');
const {
  readBusiness, businessChanged, mergeBusiness, LIMITS,
} = require('./utils/blog/businessShape');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ok    ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    failed++;
  }
}

const OLD = { name: 'TK Water Damage Restoration', type: 'Restoration', location: 'Leander, TX', phone: '(512) 555-1234' };
const NEW = { name: 'Emergency Plumber Austin', type: 'Plumbing', location: 'Austin, TX', phone: '(512) 582-5598' };

console.log('\nThe business a site reports\n');

test('A RENAME IS READ AND RECOGNISED AS A CHANGE', () => {
  const reported = readBusiness(NEW);

  assert.deepStrictEqual(reported, NEW, 'a perfectly good report was mangled');
  assert.strictEqual(businessChanged(OLD, reported), true,
    'the rename was not noticed, so nothing would be written');
  assert.strictEqual(mergeBusiness(OLD, reported).name, 'Emergency Plumber Austin');
});

test('the same details reported again are not a change', () => {
  /* The common case by far: a sweep every hour for months reporting exactly
   * what is already stored. It must cost no write at all. */
  assert.strictEqual(businessChanged(OLD, readBusiness(OLD)), false,
    'an unchanged report would write to the database every hour');
});

test('AN OLDER PLUGIN SENDS NOTHING, AND NOTHING IS WIPED', () => {
  /* The dangerous direction. Plugins before 0.14.0 send no business on the
   * sweep at all, and they sweep every hour. If "no business" read as "an
   * empty business", every one of those would erase the stored name — and
   * the planner would then have nothing to build a branded anchor from. */
  for (const nothing of [undefined, null, '', 0, {}, [], 'Emergency Plumber']) {
    assert.strictEqual(readBusiness(nothing), null, `${JSON.stringify(nothing)} was read as a business`);
    assert.strictEqual(businessChanged(OLD, readBusiness(nothing)), false,
      `${JSON.stringify(nothing)} would have triggered a write`);
  }
});

test('a blank field is dropped rather than stored over a real one', () => {
  /* A half-filled Theme Settings page must not erase a name entered
   * elsewhere. Blank is "I have nothing to say about this", not "delete". */
  const reported = readBusiness({ name: '', location: 'Austin, TX' });

  assert.deepStrictEqual(reported, { location: 'Austin, TX' }, 'the blank name survived the read');
  assert.strictEqual(mergeBusiness(OLD, reported).name, OLD.name,
    'a blank wiped the stored business name');
  assert.strictEqual(mergeBusiness(OLD, reported).location, 'Austin, TX',
    'the field that was sent did not land');
});

test('FIELDS THAT WERE NOT SENT ARE LEFT ALONE', () => {
  /* Merged, not replaced. A plugin reporting a name and a town must not
   * silently drop a phone number an older version stored. */
  const merged = mergeBusiness(OLD, readBusiness({ name: 'Emergency Plumber Austin' }));

  assert.strictEqual(merged.name, 'Emergency Plumber Austin');
  assert.strictEqual(merged.phone, OLD.phone, 'the phone number was dropped');
  assert.strictEqual(merged.location, OLD.location, 'the town was dropped');
});

test('a partial report is not mistaken for a change to the fields it omits', () => {
  assert.strictEqual(businessChanged(OLD, readBusiness({ name: OLD.name })), false,
    'reporting one unchanged field read as a change');
  assert.strictEqual(businessChanged(OLD, readBusiness({ name: 'Something Else' })), true,
    'reporting one changed field read as no change');
});

test('a site with nothing stored yet accepts what it is told', () => {
  assert.strictEqual(businessChanged(null, readBusiness(NEW)), true);
  assert.strictEqual(businessChanged(undefined, readBusiness(NEW)), true);
  assert.deepStrictEqual(mergeBusiness(null, readBusiness(NEW)), NEW);
});

test('OVERLONG VALUES ARE CUT, NOT REFUSED', () => {
  /* A 4,000-character business name is somebody's mistake or somebody's
   * probe. Refusing the whole report would take the rest of a legitimate
   * one with it; storing it unbounded puts their input in every anchor. */
  const long = readBusiness({ name: 'x'.repeat(5000), phone: '9'.repeat(500) });

  assert.strictEqual(long.name.length, LIMITS.name, 'the name was not cut to the limit');
  assert.strictEqual(long.phone.length, LIMITS.phone, 'the phone was not cut to the limit');
});

test('whitespace is trimmed, so " Austin " does not read as a change', () => {
  assert.strictEqual(businessChanged({ location: 'Austin, TX' }, readBusiness({ location: '  Austin, TX  ' })), false,
    'a stray space would rewrite the record every hour');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
