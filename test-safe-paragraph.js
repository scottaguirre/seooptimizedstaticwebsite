// test-safe-paragraph.js
//
// A paragraph an owner typed, made safe to drop into a page.
//
//   node test-safe-paragraph.js
//
// WHY THIS SUITE IS THE ONE TO BE PARANOID IN
//
// runGeneration writes section paragraphs into the template with a plain
// `.replace()` and no escaping. That was fine while the only writer was the
// content generator. The edit screen makes the field reachable by a person,
// and an unescaped `.replace()` with a person on the other end of it is a
// script tag on a published page, on the customer's own domain, served to
// the customer's own visitors.
//
// The module escapes EVERYTHING and then converts back only the exact shape
// of an anchor whose URL passes — so these tests are mostly "does anything
// other than an anchor survive", asked many ways.

'use strict';

const assert = require('assert');

const {
  safeParagraph, safeParagraphs, safeHeading, safeTrustPoint, forEditing,
  safeHref, escapeAll, unescapeEntities,
} = require('./utils/cloudflareSites/safeParagraph');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

function section(name) { console.log(`\n${name}\n`); }

/** No tag may survive but an anchor. The blunt instrument these all reduce to. */
function hasMarkupOtherThanAnchor(html) {
  const withoutAnchors = html.replace(/<\/?a(?: href="[^"]*")?>/g, '');
  return /<[^>]/.test(withoutAnchors);
}

(() => {

/* ===================================================================== */
section('THE ORDINARY CASE: WORDS AND THE LINKS THE GENERATOR PUT IN');

test('A PARAGRAPH WITH NO MARKUP COMES BACK AS ITSELF', () => {
  const text = 'We service water heaters across Leander and Cedar Park.';
  assert.strictEqual(safeParagraph(text), text);
});

test('AND AN EXISTING INTERLINK SURVIVES', () => {
  /* THE CASE THAT MAKES THIS MODULE NECESSARY RATHER THAN OPTIONAL. The
   * stored paragraphs already contain anchors — the interlink injector put
   * them there, and the model records the text AFTER injection. An editor
   * that escaped them would turn every link on the site into visible angle
   * brackets on the owner's first save. */
  const text = 'Book a <a href="./water-heater-repair.html">water heater repair</a> today.';
  assert.strictEqual(safeParagraph(text), text);
});

test('AND SO DO THE FOUR SCHEMES AN OWNER MIGHT LINK TO', () => {
  for (const href of [
    'https://example.com/page',
    'http://example.com',
    'mailto:owner@example.com',
    'tel:+15125551234',
    '/contact.html',
    './',
    '#pricing',
    'water-heater-repair.html',
  ]) {
    const out = safeParagraph(`Go <a href="${href}">here</a>.`);
    assert.ok(out.includes(`href="${href}"`), `${href} was refused`);
  }
});

test('TEXT AROUND A LINK IS ESCAPED, AND THE LINK IS NOT', () => {
  const out = safeParagraph('5 < 6 & <a href="/x">more</a> > 4');

  assert.ok(out.includes('5 &lt; 6 &amp;'), out);
  assert.ok(out.includes('<a href="/x">more</a>'), out);
  assert.ok(out.includes('&gt; 4'), out);
});

/* ===================================================================== */
section('NOTHING ELSE GETS THROUGH');

test('A SCRIPT TAG BECOMES TEXT', () => {
  const out = safeParagraph('Hello <script>alert(1)</script> there');

  assert.ok(!/<script/i.test(out), out);
  assert.ok(out.includes('&lt;script&gt;'), out);
});

test('AND SO DOES EVERY OTHER TAG SOMEBODY MIGHT REACH FOR', () => {
  const attempts = [
    '<img src=x onerror=alert(1)>',
    '<svg/onload=alert(1)>',
    '<iframe src="https://evil.example"></iframe>',
    '<style>body{display:none}</style>',
    '<form action="/x"><input name="card"></form>',
    '<a href="/x" onclick="alert(1)">click</a>',
    '<A HREF="/x" ONMOUSEOVER="alert(1)">click</A>',
    '<div>plain</div>',
    '<meta http-equiv="refresh" content="0;url=https://evil.example">',
    '<object data="x"></object>',
    '<base href="https://evil.example/">',
  ];

  for (const attempt of attempts) {
    const out = safeParagraph(attempt);

    assert.ok(!hasMarkupOtherThanAnchor(out),
      `markup survived: ${attempt}\n        -> ${out}`);

    /* AN EVENT HANDLER ONLY COUNTS INSIDE SURVIVING MARKUP. The first
     * version of this looked for `onerror=` anywhere in the output and
     * failed on `&lt;img src=x onerror=alert(1)&gt;` — which is the module
     * working: fully escaped text that a browser prints and never runs.
     * Asserting on the characters rather than on what they do would have
     * forced the module to mangle the owner's words to satisfy a test. */
    const markupOnly = (out.match(/<[^>]*>/g) || []).join(' ');

    assert.ok(!/\son\w+\s*=/i.test(markupOnly),
      `an event handler survived in markup: ${attempt}\n        -> ${out}`);
  }
});

test('A TAG HIDDEN INSIDE A TAG DOES NOT REASSEMBLE', () => {
  /* The classic against a strip-based sanitiser: removing `<script>` from
   * `<scr<script>ipt>` leaves `<script>`. Escaping first cannot do that,
   * because nothing is ever removed. */
  const out = safeParagraph('<scr<script>ipt>alert(1)</scr</script>ipt>');

  assert.ok(!/<script/i.test(out), out);
  assert.ok(!hasMarkupOtherThanAnchor(out), out);
});

test('AN ANCHOR WITH EXTRA ATTRIBUTES KEEPS ITS LINK AND LOSES THEM', () => {
  /* COPYING A LINK OUT OF ANYWHERE GIVES YOU A target. The first version of
   * the module matched a bare `<a href="…">` and nothing else — safe, and
   * unusable: this paragraph came back with the raw markup printed on the
   * page as visible angle brackets.
   *
   * The opening tag is now matched loosely and REBUILT from the one href it
   * carried, so nothing from the original attributes is emitted. */
  const out = safeParagraph('Go <a href="/x" target="_blank">here</a>.');

  assert.strictEqual(out, 'Go <a href="/x">here</a>.');
});

test('AND AN onclick IN THE OPENING TAG IS MATCHED AND NOT EMITTED', () => {
  /* The point of matching loosely: an attribute nobody allowed is consumed
   * by the match and dropped on the rebuild, rather than left behind as
   * text beside a link that did survive. */
  const out = safeParagraph('Go <a href="/x" onclick="alert(1)">here</a>.');

  assert.strictEqual(out, 'Go <a href="/x">here</a>.');
  assert.ok(!/onclick/i.test(out), out);
});

test('AND AN ANCHOR WITH NO href AT ALL KEEPS ONLY ITS WORDS', () => {
  const out = safeParagraph('Go <a name="top">here</a>.');

  assert.strictEqual(out, 'Go here.');
});

/* ===================================================================== */
section('THE HREF IS CHECKED, AND A REFUSED LINK KEEPS ITS WORDS');

test('javascript: IS REFUSED', () => {
  const out = safeParagraph('Click <a href="javascript:alert(1)">here</a>.');

  assert.ok(!/javascript:/i.test(out), out);
  assert.ok(out.includes('here'), 'the words were lost with the link');
  assert.ok(!out.includes('<a '), 'a link survived with a refused href');
});

test('AND SO IS data:, WHICH IS THE ONE PEOPLE FORGET', () => {
  /* `data:text/html,<script>…</script>` is a working XSS in a link. */
  const out = safeParagraph('See <a href="data:text/html,<script>alert(1)</script>">this</a>.');

  assert.ok(!/(^|")data:/i.test(out), out);
  assert.ok(!hasMarkupOtherThanAnchor(out), out);
});

test('AND THE SPELLINGS THAT GET PAST A startsWith CHECK', () => {
  /* Control characters inside a scheme are a thing browsers have
   * historically tolerated. They are NOT stripped here, and that is the
   * point: an allowlist refuses anything that is not one of four exact
   * strings, so a smuggled character can only make a scheme fail to match.
   * Normalising first would turn `ht\u0000tp:` into `http:` and admit it —
   * see the note in safeHref(). */
  const attempts = [
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'java\rscript:alert(1)',
    ' javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    '\u0000javascript:alert(1)',
    'vbscript:msgbox(1)',

    /* AND THE ONE THAT PROVES THE DIRECTION. A stripper would turn this
     * into `http:` and allow it; the allowlist sees a scheme that is not on
     * the list and refuses it. */
    'ht\u0000tp://example.com',
  ];

  for (const href of attempts) {
    assert.strictEqual(safeHref(href), null, `safeHref accepted ${JSON.stringify(href)}`);

    const out = safeParagraph(`Go <a href="${href}">here</a>.`);
    assert.ok(!out.includes('<a '), `an anchor survived for ${JSON.stringify(href)}: ${out}`);
  }
});

test('A COLON IN A PATH IS NOT A SCHEME', () => {
  /* `/a:b` is a path containing a colon. Reading the colon alone would
   * refuse a perfectly ordinary relative URL. */
  assert.strictEqual(safeHref('/notes/a:b'), '/notes/a:b');
  assert.strictEqual(safeHref('./x:y'), './x:y');
});

test('AND A RELATIVE LINK MAY NOT CLIMB', () => {
  assert.strictEqual(safeHref('../../secret'), null);
  assert.strictEqual(safeHref('ok/path.html'), 'ok/path.html');
});

test('AN EMPTY OR MISSING href REFUSES THE ANCHOR', () => {
  for (const href of ['', '   ']) {
    assert.strictEqual(safeHref(href), null);
  }

  assert.strictEqual(safeHref(null), null);
  assert.strictEqual(safeHref(undefined), null);
});

/* ===================================================================== */
section('NESTING AND MALFORMED INPUT');

test('AN ANCHOR INSIDE AN ANCHOR YIELDS EXACTLY ONE LINK', () => {
  /* Invalid HTML that browsers resolve by closing the first anchor early,
   * which would put the rest of the paragraph inside a link.
   *
   * THE MATCH IS NON-GREEDY, so the outer anchor ends at the FIRST `</a>`
   * and the nested opening tag lands inside it as escaped text. One link is
   * emitted and the leftovers print as visible angle brackets — not pretty,
   * and not a link anybody did not ask for. */
  const out = safeParagraph('<a href="/x">outer <a href="/y">inner</a> more</a>');

  assert.strictEqual((out.match(/<a /g) || []).length, 1,
    `more than one anchor survived: ${out}`);

  assert.ok(!out.includes('href="/y"'), `the nested href was emitted: ${out}`);
  assert.ok(out.includes('&lt;a'), `the nested tag was not escaped: ${out}`);
});

test('A TAG THAT MERELY STARTS WITH "a" IS NOT AN ANCHOR', () => {
  /* `&lt;abbr&gt;` matched as an anchor whose attribute blob was "bbr" until
   * the pattern required whitespace or the tag's end after the `a`. It was
   * never dangerous — nothing from a blob is emitted — but it ate the
   * element's words and the closing tag of whatever followed. */
  for (const tag of ['<abbr title="x">AC</abbr>', '<article>words</article>', '<aside>x</aside>']) {
    const out = safeParagraph(tag);

    assert.ok(!out.includes('<a '), `${tag} was treated as an anchor: ${out}`);
    assert.ok(out.includes('&lt;'), `${tag} lost its text: ${out}`);
  }

  /* THE INPUT THAT ACTUALLY NEEDS THE LOOKAHEAD, and mutation testing is
   * why it is here: the three above are refused by their CLOSING tags —
   * `&lt;/abbr&gt;` is not `&lt;/a&gt;` — so deleting the guard changed
   * nothing. This one closes with </a>, so without the lookahead it matches
   * as an anchor whose attribute blob is "bbr title=…", finds no href, and
   * silently eats the opening tag. */
  const mixed = safeParagraph('<abbr title="x">AC</a>');

  assert.ok(mixed.includes('&lt;abbr'),
    `the opening tag was swallowed as an anchor: ${mixed}`);
});

test('A STRAY CLOSING TAG IS TEXT, NOT MARKUP', () => {
  const out = safeParagraph('words </a> more');

  assert.ok(!out.includes('</a>'), out);
  assert.ok(out.includes('&lt;/a&gt;'), out);
});

test('AN UNCLOSED ANCHOR DOES NOT OPEN ONE', () => {
  /* A `<a href="/x">` with no `</a>` would otherwise wrap everything after
   * it on the page, to the end of the section. */
  const out = safeParagraph('start <a href="/x">never closed');

  assert.ok(!out.includes('<a '), `an unclosed anchor opened a link: ${out}`);
  assert.ok(out.includes('never closed'), 'the words were lost');
});

test('AND NON-STRINGS DO NOT THROW', () => {
  assert.strictEqual(safeParagraph(null), '');
  assert.strictEqual(safeParagraph(undefined), '');
  assert.strictEqual(safeParagraph(42), '42');
});

/* ===================================================================== */
section('A WHOLE SECTION AT A TIME');

test('safeParagraphs KEEPS ORDER AND DROPS THE BLANKS', () => {
  const out = safeParagraphs([
    'One with a <a href="/x">link</a>.',
    '   ',
    'Two.',
    '',
  ]);

  assert.deepStrictEqual(out, ['One with a <a href="/x">link</a>.', 'Two.']);
});

test('AND A NON-ARRAY IS AN EMPTY SECTION, NOT A CRASH', () => {
  assert.deepStrictEqual(safeParagraphs(null), []);
  assert.deepStrictEqual(safeParagraphs('not an array'), []);
});

/* ===================================================================== */
section('THE ESCAPER ITSELF');

test('IT HANDLES THE AMPERSAND FIRST', () => {
  /* Escaped in any other order, `&lt;` typed by a person becomes `&amp;lt;`
   * or, worse, `<`. The ampersand has to go first and exactly once. */
  assert.strictEqual(escapeAll('&lt;script&gt;'), '&amp;lt;script&amp;gt;');
  assert.strictEqual(escapeAll('a & b'), 'a &amp; b');
});

test('AND IT ESCAPES BOTH QUOTE CHARACTERS', () => {
  /* These land inside an attribute value in the page template. */
  assert.strictEqual(escapeAll('say "hi" and \'bye\''), 'say &quot;hi&quot; and &#39;bye&#39;');
});

/* ===================================================================== */
section('A HEADING IS NOT A PARAGRAPH');

test('IT IS ESCAPED, AND NO ANCHOR IS LET BACK IN', () => {
  /* THE ONE CONCESSION safeParagraph MAKES DOES NOT APPLY HERE, and the
   * reason is in the builder, not in taste: buildAboutUsPage and
   * buildLocationPages both render the H2 as `heading.toUpperCase()`. An
   * anchor that survived would come out as <A HREF="/CONTACT.HTML">, and an
   * uppercased PATH is a 404 on a case-sensitive host. Cloudflare Pages is
   * one. The line that renders the heading would break the link. */
  const out = safeHeading('Call <a href="/contact.html">us</a> today');

  assert.ok(!out.includes('<a '), out);
  assert.strictEqual(out, 'Call &lt;a href=&quot;/contact.html&quot;&gt;us&lt;/a&gt; today');

  /* The same input through the paragraph sanitiser keeps its link. The two
   * are only meaningfully different if this difference holds. */
  assert.ok(safeParagraph('Call <a href="/contact.html">us</a> today').includes('<a href='));
});

test('AND A SCRIPT TAG IS INERT TEXT, AS IT IS IN A PARAGRAPH', () => {
  assert.strictEqual(safeHeading('<script>alert(1)</script>'),
    '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('AND WHITESPACE COLLAPSES TO ONE LINE', () => {
  /* A heading is one line. The form posts it from an <input>, which cannot
   * hold a newline — but a paste can, and one landing inside
   * {{SECTION1_H2}} is a stray gap in a shouted heading. */
  assert.strictEqual(safeHeading('  Who\n\n  we   are  '), 'Who we are');
  assert.strictEqual(safeHeading('   '), '');
  assert.strictEqual(safeHeading(null), '');
  assert.strictEqual(safeHeading(undefined), '');
});

/* ===================================================================== */
section('A TRUST POINT IS ESCAPED BY ITS RENDERERS, NOT BY US');

test('SO IT IS NOT ESCAPED HERE', () => {
  /* ESCAPE AT EXACTLY ONE END, AND THE END IS A FACT ABOUT THE CONSUMER.
   * buildTrustList() replaces & < > itself; the WordPress renderer calls
   * esc_html(). Escaping here as well would double it, and an owner who
   * typed "Visa & Mastercard accepted" would read "Visa &amp; Mastercard
   * accepted" on their own published page. */
  assert.strictEqual(safeTrustPoint('Visa & Mastercard accepted'),
    'Visa & Mastercard accepted');

  assert.strictEqual(safeTrustPoint('<script>alert(1)</script>'),
    '<script>alert(1)</script>',
    'a trust point was escaped here as well as by its renderer');
});

test('AND THE TWO SANITISERS DISAGREE ON PURPOSE', () => {
  /* Stated as a relationship rather than as two separate expectations: if
   * somebody ever makes safeTrustPoint escape, this is the line that says
   * why they should not. */
  const typed = 'Open 24 hours & on call';

  assert.notStrictEqual(safeTrustPoint(typed), safeHeading(typed));
  assert.strictEqual(safeHeading(typed), 'Open 24 hours &amp; on call');
});

test('IT STILL TIDIES WHITESPACE, AND AN EMPTY RESULT IS LEGITIMATE', () => {
  /* Empty is how a bullet is removed — buildTrustList filters falsy entries
   * and the list reflows. The caller, not this function, decides that. */
  assert.strictEqual(safeTrustPoint('  Free   onsite\n estimates '), 'Free onsite estimates');
  assert.strictEqual(safeTrustPoint('   '), '');
  assert.strictEqual(safeTrustPoint(null), '');
});

/* ===================================================================== */
section('FILLING THE BOX AGAIN');

test('forEditing UNDOES THE ESCAPING, HOWEVER MANY LAYERS THERE ARE', () => {
  /* ESCAPING IS NOT IDEMPOTENT, so a screen that puts stored text back in a
   * box has to undo it — otherwise the next save escapes it again, and the
   * layer count grows with the number of times somebody pressed Save.
   *
   * TO A FIXED POINT, NOT ONCE. The sites edited while that bug was live
   * carry two and three layers; one-per-save would mean pressing Save three
   * times on every field with an apostrophe in it.
   *
   * Safe because an entity in one of these fields can only have come from
   * our own escaper — generated content is stored raw, with no entities in
   * it at all. */
  assert.strictEqual(forEditing('Hi! I&#39;m John'), "Hi! I'm John");
  assert.strictEqual(forEditing('Hi! I&amp;#39;m John'), "Hi! I'm John");
  assert.strictEqual(forEditing('Hi! I&amp;amp;#39;m John'), "Hi! I'm John");
  assert.strictEqual(forEditing(''), '');
  assert.strictEqual(forEditing(null), '');
});

test('AND A DAMAGED PARAGRAPH IS REPAIRED BY ONE SAVE, THEN STAYS PUT', () => {
  /* The whole point of the fixed point: the owner opens the screen, the box
   * shows what they typed, they press Save once and the stored value is
   * back to a single layer for good. */
  const damaged = 'Hi! I&amp;amp;#39;m John &amp;amp; Sons.';

  assert.strictEqual(forEditing(damaged), "Hi! I'm John & Sons.");

  const repaired = safeParagraph(forEditing(damaged));
  assert.strictEqual(repaired, 'Hi! I&#39;m John &amp; Sons.');

  assert.strictEqual(safeParagraph(forEditing(repaired)), repaired,
    'the repaired value drifted on the next save');
});

test('AND IT UNWINDS AS DEEP AS THE DAMAGE GOES, NOT A FIXED NUMBER OF ROUNDS', () => {
  /* There was a MAX_ROUNDS = 8 here. Mutation testing killed it — removing
   * it changed no test, and none could be written, because the loop cannot
   * run away: a round either changes nothing and returns, or replaces an
   * entity of four-plus characters with one, so the string strictly
   * shortens.
   *
   * A cap would have been worse than useless: on a field saved nine times it
   * would stop halfway, leave an entity on the published page, and say
   * nothing about why. */
  let deep = "'";
  for (let i = 0; i < 40; i += 1) deep = escapeAll(deep);

  assert.strictEqual(forEditing(deep), "'",
    'it stopped before it had undone all the escaping');
});

test('AND IT IS ITS OWN FIXED POINT, WHICH unescapeEntities IS NOT', () => {
  /* THE PROPERTY THAT MATTERS, now that the decode loops: running it twice
   * is the same as running it once. That is what makes it safe to call every
   * time the form is drawn, however often the owner opens the screen.
   *
   * unescapeEntities has no such property to offer — it is a single sequence
   * of five replacements whose output feeds its own next rule, kept for
   * safeHref, which only has to decide whether to refuse a URL. Two
   * functions, two jobs; the earlier version of this test claimed the
   * difference was the pass count, and the loop made that claim false. */
  for (const text of ['Hi! I&amp;amp;#39;m John', '&amp;lt;', "plain words", '&#39;']) {
    assert.strictEqual(forEditing(forEditing(text)), forEditing(text), text);
  }

  assert.strictEqual(forEditing('&amp;amp;#39;'), "'");
});

test('AND escapeAll UNDOES IT EXACTLY, BOTH WAYS ROUND', () => {
  /* The property the whole round trip rests on: anything escaped on the way
   * in comes back unchanged on the way out, so an untouched box saves to the
   * value it already had. */
  for (const typed of ["I'm", 'a & b', '<script>', 'say "hi"', 'plain words', '']) {
    assert.strictEqual(forEditing(escapeAll(typed)), typed, typed);
  }
});

/* ===================================================================== */

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

})();
