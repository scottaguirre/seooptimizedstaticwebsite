// test-rich-text.js
//
// A paragraph the owner may have put a link in.
//
// WHAT THIS IS GUARDING. These pages are published on the CLIENT'S own
// domain and read by their customers, so owner text that becomes markup
// becomes markup in somebody else's visitors' browsers. Every assertion
// below is something that renders perfectly in a browser when it is wrong.
//
//   node test-rich-text.js

'use strict';

const assert = require('assert');

const { richText } = require('./utils/localOptions/render/richText');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

function section(n) { console.log(`\n${n}\n`); }

/* ======================================================================= */

section('A LINK AN OWNER WROTE');

test('it becomes an anchor, inline, in the middle of a sentence', () => {
  assert.strictEqual(
    richText('Call [our Leander office](https://example.com/leander) before you dig.'),
    'Call <a href="https://example.com/leander">our Leander office</a> before you dig.'
  );
});

test('AND THERE MAY BE SEVERAL, which is the whole reason for this shape', () => {
  /* The blogs keep the URL in a field on the article, so they get one custom
   * link. A service page wants a manufacturer, a permit office and a booking
   * form, and numbered URL fields would be unusable by the third one. */
  const out = richText(
    'See [the permit office](https://city.example.gov/permits) or '
    + '[book a visit](https://example.com/book).'
  );

  assert.strictEqual((out.match(/<a href=/g) || []).length, 2);
});

test('A SPACE BETWEEN THE BRACKETS AND THE URL IS FORGIVEN', () => {
  /* The first link anybody typed into the editor had one, and markdown
   * does not allow it. Being strict bought nothing: the second half still
   * has to look like an http URL, so an ordinary sentence cannot become a
   * link by accident. */
  assert.strictEqual(
    richText('serve homeowners and property [CHECK HERE] (https://google.com) owners'),
    'serve homeowners and property <a href="https://google.com">CHECK HERE</a> owners'
  );
});

test('but a bracket and a parenthesis on different lines are not one link', () => {
  /* Allowing any whitespace would let a match run from a bracket on one
   * line to a parenthesis three paragraphs down. */
  const text = 'A valve [may need replacing]\n\n(https://example.com) is a separate thought.';

  assert.strictEqual(richText(text), text);
});

test('and a sentence with a bracket and a parenthesis is still left alone', () => {
  const text = 'See [the invoice] (attached) for the callout charge.';

  assert.strictEqual(richText(text), text);
});

test('http is allowed as well as https', () => {
  assert.ok(richText('[x](http://example.com)').includes('<a href="http://example.com">'));
});

test('a query string survives, escaped the way an attribute wants it', () => {
  /* `&` inside an href has to be `&amp;` — which is what escaping the
   * paragraph already did, so nothing has to un-escape and re-escape it. */
  const out = richText('[book](https://example.com/b?a=1&b=2)');

  assert.ok(out.includes('href="https://example.com/b?a=1&amp;b=2"'));
});

/* ======================================================================= */

section('WHAT CANNOT BECOME MARKUP');

test('A PARAGRAPH IS ESCAPED BEFORE ANYTHING IS CONVERTED', () => {
  /* The rule the whole file turns on. Not "allow some HTML", not "strip
   * what looks dangerous" — escape everything, then convert one known
   * pattern into a tag this code writes. */
  const out = richText('We fix <script>alert(1)</script> and more.');

  assert.ok(!out.includes('<script'), 'a script tag survived');
  assert.ok(out.includes('&lt;script&gt;'));
});

test('javascript: is refused', () => {
  /* The obvious one. An allow-list of http and https is what keeps the
   * next one out too, without anybody having to think of it. */
  const out = richText('[click me](javascript:alert(1))');

  assert.ok(!out.includes('<a '), 'a javascript: URL became a link');
});

test('and so is data:, vbscript: and anything else invented later', () => {
  for (const url of ['data:text/html,<script>alert(1)</script>', 'vbscript:msgbox', 'file:///etc/passwd']) {
    assert.ok(!richText(`[x](${url})`).includes('<a '), `${url} became a link`);
  }
});

test('A REFUSED LINK IS LEFT AS TYPED, NOT SILENTLY REMOVED', () => {
  /* The owner can see the brackets on their own page and work out that the
   * address is wrong. A link that quietly vanishes is a change they did not
   * ask for and cannot see. */
  const out = richText('[click me](javascript:alert(1))');

  assert.ok(out.includes('[click me]'), 'the text was dropped');
});

test('a quote in the anchor text cannot close the attribute', () => {
  /* The text is escaped before the tag is built around it. */
  const out = richText('[say "hi"](https://example.com)');

  assert.ok(out.includes('&quot;'));
  assert.ok(!/<a href="https:\/\/example\.com">say "hi"<\/a>/.test(out));
});

test('AND A QUOTE IN THE URL CANNOT EITHER', () => {
  /* A URL carrying a quote would otherwise end the href and start an
   * attribute of the attacker's choosing — on a page served from the
   * client's own domain. */
  const out = richText('[x](https://example.com/" onmouseover="alert(1))');

  assert.ok(!out.includes('onmouseover="alert(1)"'), 'a URL broke out of the attribute');
});

/* ======================================================================= */

section('ORDINARY PROSE IS LEFT ALONE');

test('brackets that are not a link stay as brackets', () => {
  const text = 'We charge for the callout (see the invoice) and for parts [not labour].';

  assert.strictEqual(richText(text), text);
});

test('AND A MATCH DOES NOT RUN AWAY ACROSS A PARAGRAPH', () => {
  /* [ ... ] ( ... ) with a sentence in between would otherwise swallow the
   * lot and turn half a paragraph into an anchor. */
  const text = 'A valve [may need replacing] and a long sentence later (about an hour).';

  assert.strictEqual(richText(text), text);
});

test('an empty or missing paragraph is an empty string, not "undefined"', () => {
  /* `undefined` printed into a template is a word on a published page. */
  assert.strictEqual(richText(undefined), '');
  assert.strictEqual(richText(null), '');
  assert.strictEqual(richText(''), '');
});

test('an em dash and an accent survive untouched', () => {
  /* Every page these generators write has an em dash in it. */
  const text = 'We are out from 7 — and José answers the phone.';

  assert.strictEqual(richText(text), text);
});

/* ---------------------------------------------------------------------- */

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('');
process.exit(failed ? 1 : 0);
