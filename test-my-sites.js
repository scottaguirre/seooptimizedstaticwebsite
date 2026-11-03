// test-my-sites.js
//
// Editing a site that is already live.
//
// WHAT THIS IS GUARDING. The edit takes the words the site already has and
// replaces the ones somebody typed. Everything it does NOT touch has to
// survive — the stances, the hero rotation, the areas served, the Search
// Console tokens, the logo path. A rebuild-from-the-form would lose all of
// it, quietly, and the site would still render.
//
//   node test-my-sites.js

'use strict';

const assert = require('assert');
const fs = require('fs');

const { applyEdit, asList, typedMatches } = require('./routes/mySitesRoute');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

function section(n) { console.log(`\n${n}\n`); }

/** A stored source, with the things the form never shows. */
const SOURCE = () => ({
  version: 1,
  url: 'https://acme.com/leander-plumbing',
  now: new Date('2026-10-29T00:00:00Z'),
  structure: 'ledger',
  logo: 'assets/logo.png',
  cover: 4,
  alt: { 1: 'a van', 2: 'under a sink' },
  areas: ['Leander', 'Cedar Park'],
  hours: [{ day: 'Monday', open: '7:00 AM – 6:00 PM' }],
  verification: ['dK3xP9mQ2vR7nL4tY8wZ'],

  business: {
    name: 'Leander Plumbing',
    trade: 'plumbing',
    phone: '(512) 555-0164',
    email: 'hello@example.com',
    street: '1804 S Bagdad Rd',
    city: 'Leander',
    state: 'TX',
    zip: '78641',
  },

  home: {
    h1: 'Plumbing in Leander, TX',
    sub: 'Same-week appointments.',
    title: 'Leander Plumbing',
    meta: 'A meta description.',
    aboutHeading: 'A local plumbing company',
    about: ['First.', 'Second.'],
  },

  services: [{
    slug: 'drain-cleaning',
    name: 'Drain Cleaning',
    h1: 'Drain Cleaning in Leander, TX',
    blurb: 'Clearing slow drains.',
    title: 'Drain Cleaning',
    meta: 'A meta description.',
    stance: 'two-jobs',
    sections: [
      { heading: '', paragraphs: ['Opening one.', 'Opening two.'] },
      { heading: 'Gurgling drains', paragraphs: ['Symptoms.'] },
    ],
  }],
});

/* ======================================================================= */

section('WHAT AN EDIT CHANGES');

test('a paragraph is replaced where it sits', () => {
  const out = applyEdit(SOURCE(), {
    page: { 0: { sections: { 1: { paragraphs: { 0: 'New symptoms.' } } } } },
  });

  assert.strictEqual(out.services[0].sections[1].paragraphs[0], 'New symptoms.');
});

test('and the paragraphs around it are untouched', () => {
  const out = applyEdit(SOURCE(), {
    page: { 0: { sections: { 0: { paragraphs: { 1: 'Changed.' } } } } },
  });

  assert.deepStrictEqual(out.services[0].sections[0].paragraphs, ['Opening one.', 'Changed.']);
});

test('a heading can be changed', () => {
  const out = applyEdit(SOURCE(), {
    page: { 0: { sections: { 1: { heading: 'What people ring about' } } } },
  });

  assert.strictEqual(out.services[0].sections[1].heading, 'What people ring about');
});

test('BUSINESS DETAILS ARE EDITABLE, which is what actually goes stale', () => {
  /* A business changes its phone number far more often than it rewrites a
   * paragraph, and before this that needed a full rebuild at 800 credits. */
  const out = applyEdit(SOURCE(), {
    business: { phone: '(512) 555-9999', city: 'Cedar Park' },
  });

  assert.strictEqual(out.business.phone, '(512) 555-9999');
  assert.strictEqual(out.business.city, 'Cedar Park');
});

test('and a state is stored upper-case whatever was typed', () => {
  /* The schema's addressRegion and the title rule both want TX, not tx. */
  const out = applyEdit(SOURCE(), { business: { state: 'tx' } });

  assert.strictEqual(out.business.state, 'TX');
});

/* ======================================================================= */

section('WHAT AN EDIT MUST NOT TOUCH');

test('THE THINGS THE FORM NEVER SHOWED ALL SURVIVE', () => {
  /* THE WHOLE REASON THIS EDITS IN PLACE. Rebuilding the source from the
   * form would drop every one of these, the site would still render, and
   * nobody would notice until the hero rotation went flat or a Search
   * Console property quietly came unverified. */
  const before = SOURCE();
  const out = applyEdit(before, { business: { phone: '(512) 555-9999' } });

  assert.deepStrictEqual(out.verification, before.verification);
  assert.deepStrictEqual(out.areas, before.areas);
  assert.deepStrictEqual(out.hours, before.hours);
  assert.deepStrictEqual(out.alt, before.alt);
  assert.strictEqual(out.cover, before.cover);
  assert.strictEqual(out.logo, before.logo);
  assert.strictEqual(out.structure, before.structure);
  assert.strictEqual(out.url, before.url);
  assert.strictEqual(out.services[0].stance, 'two-jobs');
});

test('the business name and trade are not editable from here', () => {
  /* THE NAME IS THE SITE'S IDENTITY. repoNameFor() turns it into the
   * repository and the path in every canonical — changing it here would
   * publish a second site and orphan the first, with the owner thinking
   * they had renamed one. */
  const out = applyEdit(SOURCE(), {
    business: { name: 'Something Else', trade: 'roofing' },
  });

  assert.strictEqual(out.business.name, 'Leander Plumbing');
  assert.strictEqual(out.business.trade, 'plumbing');
});

test('a field the form did not send is left alone, not blanked', () => {
  /* A form that shows six boxes must not clear a seventh it never had. */
  const out = applyEdit(SOURCE(), { business: { phone: '(512) 555-9999' } });

  assert.strictEqual(out.business.email, 'hello@example.com');
  assert.strictEqual(out.business.zip, '78641');
});

test('AND A PAGE THE FORM DID NOT SEND KEEPS EVERY WORD', () => {
  const out = applyEdit(SOURCE(), { business: { phone: '1' } });

  assert.deepStrictEqual(out.services[0].sections, SOURCE().services[0].sections);
});

/* ======================================================================= */

section('WHAT COMES BACK EMPTY');

test('an emptied paragraph is dropped, not stored as nothing', () => {
  /* Stored as '', the renderer emits <p></p> — a gap on the page that reads
   * as a rendering fault rather than as a deletion somebody meant. */
  const out = applyEdit(SOURCE(), {
    page: { 0: { sections: { 0: { paragraphs: { 0: 'Kept.', 1: '   ' } } } } },
  });

  assert.deepStrictEqual(out.services[0].sections[0].paragraphs, ['Kept.']);
});

test('and so is an emptied About paragraph', () => {
  const out = applyEdit(SOURCE(), { home: { about: { 0: 'Only this.', 1: '' } } });

  assert.deepStrictEqual(out.home.about, ['Only this.']);
});

test('an emptied HEADING is stored, because a section may have none', () => {
  /* The opening section of every service page has an empty heading by
   * design — the H1 is directly above it. Dropping empties here would make
   * that section indistinguishable from one whose heading was lost. */
  const out = applyEdit(SOURCE(), {
    page: { 0: { sections: { 1: { heading: '' } } } },
  });

  assert.strictEqual(out.services[0].sections[1].heading, '');
});

/* ======================================================================= */

section('THE SHAPE A FORM POSTS');

test('asList takes the object Express builds from indexed names', () => {
  /* `page[0][h1]` and `page[1][h1]` arrive as { '0': …, '1': … }, not as an
   * array. */
  assert.deepStrictEqual(asList({ 1: 'b', 0: 'a' }), ['a', 'b']);
});

test('AND IT KEEPS POSITIONS, HOLES AND ALL', () => {
  /* The first version sorted the keys and mapped them, so `{ '1': x }` came
   * back as a ONE-element array and an edit meant for section two landed on
   * section one. Every paragraph after a missing field shifts up by one and
   * the page still renders. */
  const sparse = asList({ 2: 'third' });

  assert.strictEqual(sparse[2], 'third');
  assert.strictEqual(sparse[0], undefined);
});

test('and a key that is not an index is not a position', () => {
  /* `{ length: 5 }` from a crafted body would otherwise become an array of
   * that length. */
  assert.deepStrictEqual(asList({ length: 5, nope: 'x' }), []);
});

test('and an actual array', () => {
  assert.deepStrictEqual(asList(['a', 'b']), ['a', 'b']);
});

test('and nothing at all', () => {
  assert.deepStrictEqual(asList(undefined), []);
  assert.deepStrictEqual(asList(null), []);
  assert.deepStrictEqual(asList('text'), []);
});

/* ======================================================================= */

section('THE LINE ABOVE THE SERVICES');

test('IT CAN BE WRITTEN BY THE OWNER', () => {
  /* It was template text, one copy per structure, and it described the
   * site's own internal linking on a plumbing company's front page. Edwin:
   * "this should be for a customer", then yes to making it a field. */
  const out = applyEdit(SOURCE(), {
    home: { servicesLede: 'Call us and a person answers.' },
  });

  assert.strictEqual(out.home.servicesLede, 'Call us and a person answers.');
});

test('ABSENT STAYS ABSENT, WHICH IS WHAT KEEPS THE DEFAULT', () => {
  /* A site built before the field existed has nothing stored, and the
   * renderer falls back to its structure's default. Writing '' here would
   * silently take that line off every older site the first time anybody
   * edited a phone number. */
  const out = applyEdit(SOURCE(), { business: { phone: '1' } });

  assert.ok(!('servicesLede' in out.home));
});

test('AND AN EMPTIED BOX IS STORED AS EMPTY, NOT DROPPED', () => {
  /* THE DISTINCTION THE WHOLE FIELD RESTS ON.
   *
   *   undefined   never set        -> the structure's default line
   *   ''          cleared on purpose -> no line at all
   *
   * Dropping the empty string would send the renderer back to the default,
   * and the box would be a control that saves and changes nothing — the
   * same lie the old Headline box told before it was removed. */
  const out = applyEdit(SOURCE(), { home: { servicesLede: '   ' } });

  assert.ok('servicesLede' in out.home);
  assert.strictEqual(out.home.servicesLede, '');
});

/* ======================================================================= */

section('THE SEARCH CONSOLE TAG, WHICH ARRIVES AFTER THE SITE DOES');

test('A TAG OFF THE CLIPBOARD BECOMES A TOKEN', () => {
  /* Google hands the tag over when a property is CREATED, and a client
   * creates the property once their site exists. So the usual order is:
   * build, give them the address, they make a property, and only then does
   * anybody have a value to put on the page.
   *
   * The wizard asks at build time, which covers the client who already has
   * one — the minority. Until 30 October everybody else needed a terminal
   * tool, on the one machine whose dist/ folder held that site, which
   * means the LAST build and nothing older. */
  const out = applyEdit(SOURCE(), {
    verification: '<meta name="google-site-verification" content="AbCdEf1234567890hijk" />',
  });

  assert.deepStrictEqual(out.verification, ['AbCdEf1234567890hijk']);
});

test('and a bare token works too, for somebody who kept only that', () => {
  const out = applyEdit(SOURCE(), { verification: 'AbCdEf1234567890hijk' });

  assert.deepStrictEqual(out.verification, ['AbCdEf1234567890hijk']);
});

test('ABSENT IS NOT EMPTY HERE EITHER', () => {
  /* A form that did not show the box must not strip the tokens a site
   * already carries — and a site quietly coming unverified is a thing
   * nobody notices until Search Console stops reporting. */
  const before = SOURCE();
  const out = applyEdit(before, { business: { phone: '1' } });

  assert.deepStrictEqual(out.verification, before.verification);
});

test('but an emptied box REMOVES it, because that is what emptying means', () => {
  /* The opposite of the paragraph rule, and deliberately so. An emptied
   * paragraph is a gap on a page; an emptied verification box is somebody
   * taking a property off a site they own. */
  const out = applyEdit(SOURCE(), { verification: '' });

  assert.deepStrictEqual(out.verification, []);
});

test('AND ANYTHING THAT IS NOT TOKEN-SHAPED IS REFUSED', () => {
  /* The value ends up in an attribute on a public page, on the client's
   * own domain. The blogs' parser already refuses it; this uses that one
   * rather than a second copy that could disagree with it. */
  const out = applyEdit(SOURCE(), { verification: 'not a token!!' });

  assert.deepStrictEqual(out.verification, []);
});

/* ======================================================================= */

section('WHAT HAS TO BE TYPED BEFORE A SITE IS DESTROYED');

const LIVE = { businessName: 'Leander Plumbing', repo: 'leander-plumbing' };

test('THE NAME, BECAUSE A DIALOG IS DISMISSED WITHOUT READING IT', () => {
  /* Deleting takes the repository, and the repository is the ONLY copy of
   * the site's words — _src/localoptions.json is in it and nowhere else,
   * because dist/user_<id> is wiped by the next build. There is no undo. */
  assert.ok(typedMatches('Leander Plumbing', LIVE));
});

test('case and stray space are forgiven', () => {
  /* The point is that somebody read the name and copied it, not that they
   * matched its capitals. */
  assert.ok(typedMatches('  leander plumbing  ', LIVE));
  assert.ok(typedMatches('LEANDER PLUMBING', LIVE));
});

test('the repository name works too, because the list shows it in the URL', () => {
  assert.ok(typedMatches('leander-plumbing', LIVE));
});

test('AND NOTHING ELSE DOES', () => {
  assert.ok(!typedMatches('Leander', LIVE), 'a prefix was accepted');
  assert.ok(!typedMatches('leander plumbing llc', LIVE), 'a longer name was accepted');
  assert.ok(!typedMatches('delete', LIVE));
});

test('AN EMPTY BOX CONFIRMS NOTHING, EVEN FOR A ROW WITH NO NAME', () => {
  /* A row whose businessName is blank would otherwise be deleted by
   * pressing the button with the field untouched — and `required` on the
   * input is a browser's opinion, not a server's. */
  assert.ok(!typedMatches('', LIVE));
  assert.ok(!typedMatches('   ', LIVE));
  assert.ok(!typedMatches(undefined, LIVE));
  assert.ok(!typedMatches('', { businessName: '', repo: '' }));
});

/* ---------------------------------------------------------------------- */

/* ------------------------------------------------------------------------ */

section('WHERE A SITE LIVES');

/* THE BUG THESE EXIST FOR — 1 November. Sites moved from
 * `domain.com/business/` to `business.domain.com`. The builder changed, every
 * page inside every site was correct, and My Sites went on printing the old
 * shape beside a link that no longer resolved. It built the address by hand
 * in SEVEN places and this suite asserted none of them, which is why thirty
 * tests passed while the list was wrong.
 *
 *     A COMMENT THAT SAYS A THING IS IN ONE PLACE IS NOT A TEST.
 *     THE SEVENTH COPY DOES NOT KNOW IT IS A COPY. */
const {
  siteHostFor, siteUrlFor, pageUrlFor, siteLabelFor,
} = require('./utils/localOptions/siteAddress');

const WHERE = { repo: 'expert-lemon-law-houston', domain: '7-y.xyz' };

test('A SITE IS A SUBDOMAIN OF ITS DOMAIN, NOT A FOLDER IN IT', () => {
  assert.strictEqual(siteHostFor(WHERE), 'expert-lemon-law-houston.7-y.xyz');
  assert.strictEqual(siteUrlFor(WHERE), 'https://expert-lemon-law-houston.7-y.xyz/');

  /* The shape that was there before, asserted as ABSENT. A helper that
   * quietly went back to a path would pass every check above. */
  assert.ok(!siteUrlFor(WHERE).includes('7-y.xyz/expert-lemon-law-houston'));
  assert.strictEqual(new URL(siteUrlFor(WHERE)).pathname, '/');
});

test('and a page inside it hangs off that host', () => {
  assert.strictEqual(
    pageUrlFor({ ...WHERE, slug: 'lemon-law-buybacks' }),
    'https://expert-lemon-law-houston.7-y.xyz/lemon-law-buybacks/');

  /* No slug is the site itself, not a trailing double slash. */
  assert.strictEqual(pageUrlFor(WHERE), siteUrlFor(WHERE));
});

test('WHAT IS SHOWN IS THE HOST, WITHOUT THE SCHEME', () => {
  /* A list of sites is read, not clicked through one at a time. `https://`
   * in front of every row is eleven characters of nothing repeated down the
   * page; the link still carries it. */
  assert.strictEqual(siteLabelFor(WHERE), 'expert-lemon-law-houston.7-y.xyz');
  assert.ok(!siteLabelFor(WHERE).startsWith('http'));
});

test('A SITE THAT LOST ITS DOMAIN GETS NOTHING, NOT A BROKEN LINK', () => {
  /* The pool row was removed, or the record predates the field. My Sites
   * already has a branch for a site whose domain has left the pool; this
   * returns empty so that branch is reachable, rather than papering over it
   * with `https://.undefined/`. */
  for (const bad of [
    { repo: 'x', domain: '' },
    { repo: '', domain: 'y.com' },
    { repo: 'x' },
    { domain: 'y.com' },
    {},
    undefined,
  ]) {
    assert.strictEqual(siteUrlFor(bad), '', `${JSON.stringify(bad)} produced a link`);
    assert.strictEqual(siteHostFor(bad), '');
    assert.strictEqual(pageUrlFor(bad), '');
  }
});

test('AND THE ROUTE BUILDS NO ADDRESS OF ITS OWN', () => {
  /* The actual regression guard. Seven hand-built copies is how the list
   * came to disagree with the sites it was listing; one more would do it
   * again. The route may call the helper as often as it likes and may not
   * concatenate a domain and a repo itself. */
  const src = fs.readFileSync(require.resolve('./routes/mySitesRoute.js'), 'utf8');

  assert.ok(
    !/domainName\)}\/\$\{esc\(site\.repo/.test(src),
    'mySitesRoute builds a site address by hand again');

  assert.ok(src.includes('siteUrlFor'), 'mySitesRoute does not use the helper at all');
});

/* ------------------------------------------------------------------------ */

section('THE SOCIAL LINKS');

/* WHY THEY ARE EDITABLE AT ALL — 1 November. The wizard collected these at
 * build time and nothing could change them afterwards, so adding a Facebook
 * page to a live site meant rebuilding it: credits spent and every word
 * rewritten, to add one URL. */
const { socialUrl } = require('./utils/localOptions/socialUrl');
const { SOCIAL } = require('./utils/localOptions/render/common');

const WITH_SOCIAL = () => ({
  business: { phone: '(512) 555-0199', social: { facebook: 'https://facebook.com/old' } },
});

test('A LINK CAN BE ADDED TO A SITE THAT IS ALREADY LIVE', () => {
  const out = applyEdit(WITH_SOCIAL(), { social: { instagram: 'instagram.com/new' } });

  assert.strictEqual(out.business.social.instagram, 'https://instagram.com/new');
  assert.strictEqual(out.business.social.facebook, 'https://facebook.com/old',
    'adding one dropped another');
});

test('A SCHEME IS ADDED, BECAUSE A BARE DOMAIN IS A RELATIVE LINK', () => {
  /* `facebook.com/acme` without https:// resolves relative to the page it
   * is on, so the footer link on a service page would point at
   * /drain-cleaning/facebook.com/acme — a 404 on somebody's own social
   * link, on every page but the home page. */
  assert.strictEqual(socialUrl('facebook.com/acme'), 'https://facebook.com/acme');
  assert.strictEqual(socialUrl('https://facebook.com/acme'), 'https://facebook.com/acme');
  assert.strictEqual(socialUrl('HTTP://facebook.com/acme'), 'HTTP://facebook.com/acme');
});

test('AND A PLACEHOLDER IS NOT A LINK', () => {
  /* What somebody writes in a box they do not want to fill in. An icon
   * linking to '#' looks like a working link until it is clicked. */
  for (const junk of ['#', 'n/a', 'N/A', 'none', '-', '   ', '']) {
    assert.strictEqual(socialUrl(junk), '', `"${junk}" became a link`);
  }
});

test('EMPTYING A BOX TAKES THE ICON OFF THE SITE', () => {
  /* The half of editing nobody tests. A field that could be set and never
   * unset is a link the owner is stuck with. */
  const out = applyEdit(WITH_SOCIAL(), { social: { facebook: '' } });

  assert.ok(!('facebook' in out.business.social), 'the cleared link is still stored');
});

test('AND A FORM THAT SENDS NOTHING CHANGES NOTHING', () => {
  /* ABSENT IS NOT EMPTY — the same rule as servicesLede. `undefined` is a
   * field the form did not send; `''` is a box the owner cleared. Treating
   * them alike would wipe every link the first time an older form posted. */
  assert.strictEqual(
    applyEdit(WITH_SOCIAL(), {}).business.social.facebook,
    'https://facebook.com/old');

  assert.strictEqual(
    applyEdit(WITH_SOCIAL(), { social: { instagram: 'x.com/a' } }).business.social.facebook,
    'https://facebook.com/old');
});

test('THE STORED SOURCE IS NOT MUTATED', () => {
  /* applyEdit returns a new object. A social map edited in place would
   * change the source the caller still holds — and the caller republishes
   * from it. */
  const src = WITH_SOCIAL();

  applyEdit(src, { social: { facebook: '', youtube: 'youtube.com/x' } });

  assert.deepStrictEqual(src.business.social, { facebook: 'https://facebook.com/old' });
});

test('THE FORM OFFERS EVERY NETWORK THE FOOTER CAN RENDER, AND NO OTHER', () => {
  /* A list in two places is a form that offers a box the site will not
   * show, or a site that shows an icon the form cannot edit. The route
   * reads the keys from SOCIAL itself. */
  const src = fs.readFileSync(require.resolve('./routes/mySitesRoute.js'), 'utf8');

  assert.ok(src.includes('Object.keys(SOCIAL)'),
    'mySitesRoute types its own list of networks');

  assert.ok(Object.keys(SOCIAL).length >= 6, 'the renderer lost its networks');

  /* And applyEdit honours whatever that list holds, including a network
   * added to SOCIAL later. */
  const body = { social: {} };

  for (const key of Object.keys(SOCIAL)) body.social[key] = `${key}.example/acme`;

  const out = applyEdit({ business: {} }, body);

  for (const key of Object.keys(SOCIAL)) {
    assert.strictEqual(out.business.social[key], `https://${key}.example/acme`,
      `${key} was not editable`);
  }
});

test('AND THE RULE IS NOT COPIED A THIRD TIME', () => {
  /* It already lived in socialFrom() in runLocalOptions.js, whose comment
   * accepts being a copy of usableUrl() in buildSocialLinks.js. The editor
   * would have been the third, and then the same URL typed in two places in
   * the same app would behave differently.
   *
   *     THE SECOND COPY IS A TRADE. THE THIRD IS A BUG WITH A ROTA. */
  const runner = fs.readFileSync(require.resolve('./utils/runLocalOptions.js'), 'utf8');
  const route = fs.readFileSync(require.resolve('./routes/mySitesRoute.js'), 'utf8');

  for (const [name, src] of [['runLocalOptions', runner], ['mySitesRoute', route]]) {
    assert.ok(src.includes('socialUrl'), `${name} does not use the shared rule`);

    assert.ok(
      !/\^https\?:\\\/\\\//.test(src),
      `${name} tests for a scheme itself instead of calling socialUrl`);
  }
});

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('');
process.exit(failed ? 1 : 0);
