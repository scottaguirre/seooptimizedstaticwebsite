// test-email-html.js
//
// The HTML body of the transactional emails.
//
// An email cannot be checked after the fact. There is no console to open in
// someone's inbox, no way to push a fix to a message already sent, and the
// recipient of a broken password reset is by definition someone who is
// already locked out. So the things that would be caught in a browser within
// seconds — a link that does not point where it should, markup that escapes
// its attribute, a button that renders as bare text in Outlook — are caught
// here instead.
//
//   node test-email-html.js

const assert = require('assert');

process.env.BASE_URL = 'https://fastwebsitegenerator.com';

const { verificationEmail, passwordResetEmail } = require('./utils/sendEmail');
const { emailLayout, safeUrl } = require('./utils/emailLayout');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
  }
}

const TOKEN = 'a1b2c3d4e5f6';
const messages = {
  verification: verificationEmail({ to: 'someone@example.com', token: TOKEN }),
  reset: passwordResetEmail({ to: 'someone@example.com', token: TOKEN }),
};

console.log('\nEmail HTML\n');

/* ---------------------------------------------------------------------------
 * Both parts, both saying the same thing
 * ------------------------------------------------------------------------ */

for (const [name, msg] of Object.entries(messages)) {
  test(`${name}: has both a text and an html part`, () => {
    // multipart/alternative is the point. An HTML-only message is the one
    // shape that is worse than the plain text this replaced.
    assert.ok(msg.text && msg.text.trim(), 'text part is empty');
    assert.ok(msg.html && msg.html.trim(), 'html part is empty');
  });

  test(`${name}: the link appears in both parts`, () => {
    assert.ok(msg.text.includes(msg.url), 'url missing from text part');
    assert.ok(msg.html.includes(msg.url), 'url missing from html part');
  });

  test(`${name}: the link is absolute and on BASE_URL`, () => {
    // The bug this file's sibling comment describes — every link pointing at
    // http://localhost:3000 — shipped once and nothing caught it.
    assert.ok(
      msg.url.startsWith('https://fastwebsitegenerator.com/'),
      `link does not start at BASE_URL: ${msg.url}`
    );
  });

  test(`${name}: the token survives into the href`, () => {
    assert.ok(
      msg.html.includes(`href="${msg.url}"`),
      'no href holds the exact url — escaping may have altered it'
    );
  });

  test(`${name}: the link is offered as copyable text as well as a button`, () => {
    // Clients strip or fail to render buttons. Without the text link that
    // leaves a locked-out user with nothing.
    const occurrences = msg.html.split(msg.url).length - 1;
    assert.ok(occurrences >= 2, `url appears ${occurrences} time(s), expected the button and the fallback`);
  });

  test(`${name}: loads nothing from the network`, () => {
    // Remote images are blocked by default in most clients, and a webfont or
    // tracking pixel would make the message depend on something the
    // recipient's client will refuse to fetch.
    assert.ok(!/<img\b/i.test(msg.html), 'contains an <img>');
    assert.ok(!/<link\b/i.test(msg.html), 'contains a <link>');
    assert.ok(!/@import/i.test(msg.html), 'contains an @import');
    assert.ok(!/<script\b/i.test(msg.html), 'contains a <script>');
  });
}

/* ---------------------------------------------------------------------------
 * Rendering quirks that only show up in a real client
 * ------------------------------------------------------------------------ */

test('the button pads the td, not the a', () => {
  // Word — which renders Outlook — ignores padding on inline elements. With
  // the padding on the <a>, Outlook shows a coloured strip exactly as tall as
  // the text, which reads as a rendering fault rather than a button.
  const html = messages.reset.html;
  const buttonCell = html.match(/<td[^>]*bgcolor="[^"]*"[^>]*>\s*<a\b[^>]*>/i);
  assert.ok(buttonCell, 'no <td bgcolor=...><a> button cell found');
  assert.ok(/padding:/i.test(buttonCell[0]), 'the button td has no padding');

  const anchor = buttonCell[0].match(/<a\b[^>]*>/i)[0];
  assert.ok(!/padding:/i.test(anchor), 'padding is on the <a>, where Word ignores it');
});

test('the layout is table-based, not flex or grid', () => {
  const html = messages.reset.html;
  assert.ok(/<table\b/i.test(html), 'no tables at all');
  assert.ok(!/display\s*:\s*(flex|grid)/i.test(html), 'uses flex or grid, which Outlook does not support');
});

test('styles are inline, not in a <style> block', () => {
  // Gmail's handling of <style> differs between its web client and its mobile
  // apps, so anything that matters has to be on the element.
  assert.ok(!/<style\b/i.test(messages.reset.html), 'contains a <style> block');
});

test('colour scheme is pinned to light', () => {
  // Without this Gmail on Android inverts the card and the navy button loses
  // most of its contrast against it.
  assert.ok(/name="color-scheme"/i.test(messages.reset.html), 'no color-scheme meta');
});

test('a preheader is present and is hidden in the body', () => {
  const html = messages.reset.html;
  assert.ok(html.includes('The link expires in 30 minutes.'), 'preheader text missing');
  const block = html.match(/<div style="display:none;[^"]*">([\s\S]*?)<\/div>/i);
  assert.ok(block, 'preheader is not inside a hidden div');
  assert.ok(block[1].includes('The link expires'), 'preheader text is not the hidden content');
});

test('the two messages do not share a heading', () => {
  // They arrive in the same inbox and a reset is security-relevant; they must
  // not be mistakable for each other.
  const h = s => s.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)[1].trim();
  assert.notStrictEqual(h(messages.reset.html), h(messages.verification.html));
});

/* ---------------------------------------------------------------------------
 * Escaping and the href
 * ------------------------------------------------------------------------ */

test('a heading carrying markup is escaped, not rendered', () => {
  const html = emailLayout({
    heading: 'Hi" onload="alert(1)',
    preheader: 'p',
    intro: 'i',
    buttonLabel: 'b',
    url: 'https://example.com/x',
  });
  // The escaped form still contains the letters `onload=`, as text — so the
  // assertion has to be that the raw, unescaped sequence is absent, not that
  // the word never appears.
  assert.ok(!html.includes('Hi" onload'), 'the quote survived unescaped');
  assert.ok(html.includes('Hi&quot; onload=&quot;alert(1)'), 'heading was not escaped as expected');
});

test('a javascript: url is not made into a button', () => {
  // The button is the one thing in the message a recipient is being asked to
  // click, so this is the worst place for an arbitrary scheme to reach.
  const html = emailLayout({
    heading: 'h',
    preheader: 'p',
    intro: 'i',
    buttonLabel: 'b',
    url: 'javascript:alert(1)',
  });
  assert.ok(!/javascript:/i.test(html), 'javascript: url survived into the markup');
  assert.ok(html.includes('href="#"'), 'expected the dead-link fallback');
});

test('safeUrl accepts http and https and nothing else', () => {
  assert.strictEqual(safeUrl('https://a.com/x'), 'https://a.com/x');
  assert.strictEqual(safeUrl('http://a.com/x'), 'http://a.com/x');
  assert.strictEqual(safeUrl('data:text/html,<b>'), '#');
  assert.strictEqual(safeUrl('//a.com/x'), '#');
  assert.strictEqual(safeUrl(''), '#');
  assert.strictEqual(safeUrl(undefined), '#');
});

test('the after-paragraphs are escaped', () => {
  const html = emailLayout({
    heading: 'h',
    preheader: 'p',
    intro: 'i',
    buttonLabel: 'b',
    url: 'https://example.com/x',
    after: ['<b>not bold</b>'],
  });
  assert.ok(html.includes('&lt;b&gt;not bold&lt;/b&gt;'), 'after-paragraph was not escaped');
});

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('');

process.exit(failed === 0 ? 0 : 1);
