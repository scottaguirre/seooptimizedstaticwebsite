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

/* =====================================================================
 *
 * A SITE CAN NOW SAY "THERE IS NOTHING HERE"
 *
 * Every test above is about refusing to write, because erasure was the only
 * dangerous direction anyone had been bitten by. The cost of that was a rule
 * with no opposite: a blank meant "I am not telling you", and there was no way
 * at all to say "I am telling you: it is empty". A value could be changed and
 * never removed.
 *
 * 11 October, roofingamerica.xyz. The site was wiped, rebuilt as a roofing
 * company and reconnected with its old licence. Its theme settings were empty,
 * so the plugin reported blanks, so the server kept what the record held from
 * the domain's previous life: type "Plumbing", location "Austin, TX". Topics
 * for a roofing blog came back about Austin wind and Central Texas heat, and
 * ninety-five articles were written before anyone asked why.
 *
 * So a report may now name the fields it ANSWERS FOR. The plugin sends that
 * list only when it actually found a settings source — see
 * IE_Settings::business_is_known(). Nothing else changes: an unlisted blank
 * behaves exactly as it did above, which is why those nine tests still pass
 * untouched.
 *
 * ===================================================================== */

const ALL = ['name', 'type', 'location', 'phone'];

console.log('\nA site that answers for its own blanks\n');

test('A LISTED BLANK CLEARS THE STORED VALUE', () => {
  /* The whole point. A rebuilt site reports an empty trade and town, says it
   * is answering for them, and stops being the previous occupant. */
  const reported = readBusiness(
    { name: 'Roofing America', type: '', location: '', phone: '' },
    ALL
  );

  assert.strictEqual(reported.location, '', 'the blank was dropped, so Austin survives');
  assert.strictEqual(reported.type, '');

  const merged = mergeBusiness(OLD, reported);

  assert.strictEqual(merged.location, '',
    'the rebuilt site still inherits the previous business\'s town');
  assert.strictEqual(merged.type, '');
  assert.strictEqual(merged.name, 'Roofing America');
});

test('A DELIBERATE CLEAR COUNTS AS A CHANGE, OR IT IS NEVER WRITTEN', () => {
  /* businessChanged() is the gate in front of every write. If a clear does
   * not read as a change, readBusiness can be as correct as it likes and the
   * database never hears about it. */
  const reported = readBusiness({ location: '' }, ['location']);

  assert.strictEqual(businessChanged(OLD, reported), true,
    'clearing the town is not seen as a change, so no write would happen');
});

test('AN UNLISTED BLANK IS STILL IGNORED', () => {
  /* The original guard, unchanged and still load-bearing. A site answering
   * only for its name must not take its own town down with it. */
  const reported = readBusiness({ name: 'Roofing America', location: '' }, ['name']);

  assert.ok(!('location' in reported),
    'a blank outside the list was treated as deliberate');
  assert.strictEqual(mergeBusiness(OLD, reported).location, 'Leander, TX');
});

test('A FIELD THAT IS LISTED BUT NOT SENT IS NOT A CLEAR', () => {
  /* A client that claims to answer for `location` and then omits the key has
   * not answered for anything. That is a bug in the client, and reading it as
   * "erase the location" would turn a bug into data loss. */
  const reported = readBusiness({ name: 'Roofing America' }, ALL);

  assert.ok(!('location' in reported),
    'a missing key was read as a deliberate blank');
  assert.strictEqual(mergeBusiness(OLD, reported).location, 'Leander, TX');
});

test('AN OLDER PLUGIN SENDS NO LIST AND NOTHING IS CLEARED', () => {
  /* Every install in the field today. The list arrives in 0.36.0; until a
   * site updates, its blanks must go on meaning silence. */
  const reported = readBusiness({ name: 'Roofing America', location: '', type: '' });

  assert.deepStrictEqual(reported, { name: 'Roofing America' });
  assert.strictEqual(mergeBusiness(OLD, reported).location, 'Leander, TX',
    'an old plugin just wiped a town it never meant to mention');
});

test('A LIST THAT IS NOT A LIST IS IGNORED RATHER THAN TRUSTED', () => {
  /* It arrives over the wire. Anything that is not an array of field names
   * must fail closed — to the old, safe behaviour. */
  for (const junk of ['location', { location: true }, 7, null]) {
    const reported = readBusiness({ name: 'Roofing America', location: '' }, junk);

    assert.ok(!('location' in reported),
      `a ${typeof junk} was accepted as the authoritative list`);
  }
});

test('A NAME IS STILL NEVER CLEARED BY ACCIDENT', () => {
  /* Not a rule in the code — a consequence of the plugin's own fallback,
   * which uses the WordPress site title when no business name is set, so the
   * name it reports is never blank. Recorded here because the day that
   * fallback goes, this test is the thing that notices. */
  const reported = readBusiness({ name: '', location: 'Austin, TX' }, ALL);

  assert.strictEqual(reported.name, '',
    'the server refuses an explicit empty name — that belongs in the plugin, not here');
});

test('EVERYTHING BLANK AND EVERYTHING LISTED IS STILL A REPORT', () => {
  /* Not null. A site saying "I have none of these" is telling us something,
   * and returning null would make the caller skip the write — which is the
   * old behaviour wearing a new coat. */
  const reported = readBusiness({ name: '', type: '', location: '', phone: '' }, ALL);

  assert.deepStrictEqual(reported, { name: '', type: '', location: '', phone: '' },
    'a site that answers "nothing" is read as a site that said nothing');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
