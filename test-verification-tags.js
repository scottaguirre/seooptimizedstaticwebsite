// test-verification-tags.js
//
// What a customer pastes into the Search Console field, and what we are
// willing to put on every page of their live blog.
//
// WHY THIS IS ITS OWN FILE AND GOES FIRST
//
// Two things meet here and both are easy to get quietly wrong.
//
//   WHAT THEY PASTE. Google shows them a whole <meta> tag, so that is what
//   lands on the clipboard and that is what arrives in the field. Anything
//   that demands a bare token produces an error message about a word the
//   customer has never heard, on a screen they cannot debug.
//
//   WHAT WE RENDER. This is customer-supplied text going into an HTML
//   attribute on every article of a site that is published to the internet.
//   Echoing their string back is an injection hole with a long reach — not
//   our server, their readers. So the tag on the page is one WE build, from
//   a value we extracted and validated.
//
//   node test-verification-tags.js

const assert = require('assert');

const {
  parseVerificationTags, MAX_TAGS, MAX_TOKEN,
} = require('./utils/blog/verificationTags');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

const TOKEN = 'dK3xP9mQ2vR7nL4tY8wZ';

console.log('\nWhat the customer pastes\n');

test('THE WHOLE TAG, WHICH IS WHAT GOOGLE PUTS ON THE CLIPBOARD', () => {
  /* The case that has to work without being explained. Search Console shows
   * this exact string and the customer copies the line. */
  assert.deepStrictEqual(
    parseVerificationTags(`<meta name="google-site-verification" content="${TOKEN}" />`),
    [TOKEN]);
});

test('and the same tag closed without a slash', () => {
  assert.deepStrictEqual(
    parseVerificationTags(`<meta name="google-site-verification" content="${TOKEN}">`),
    [TOKEN]);
});

test('and with single quotes', () => {
  assert.deepStrictEqual(
    parseVerificationTags(`<meta name='google-site-verification' content='${TOKEN}'>`),
    [TOKEN]);
});

test('and with the attributes the other way round', () => {
  /* Nothing guarantees Google's attribute order, and a parser that depends
   * on it fails on a string the customer copied correctly. */
  assert.deepStrictEqual(
    parseVerificationTags(`<meta content="${TOKEN}" name="google-site-verification">`),
    [TOKEN]);
});

test('and with whatever whitespace the paste brought with it', () => {
  assert.deepStrictEqual(
    parseVerificationTags(`   <meta   name="google-site-verification"\n  content="${TOKEN}"  />  `),
    [TOKEN]);
});

test('A BARE TOKEN, WHICH IS WHAT SOMEBODY WHO SAVED IT IN THEIR NOTES HAS', () => {
  /* Not a second mode — the same path with a fallback. If it does not look
   * like a tag, the input IS the value. Costs one branch and saves an error
   * nobody could act on. */
  assert.deepStrictEqual(parseVerificationTags(TOKEN), [TOKEN]);
  assert.deepStrictEqual(parseVerificationTags(`  ${TOKEN}  `), [TOKEN]);
});

test('ONE PER LINE, SO A CLIENT AND AN AGENCY CAN BOTH VERIFY', () => {
  /* Google matches ANY of the verification tags on a page, so two
   * properties can own the same site. That is the whole reason this is a
   * list: Edwin wants his own Search Console on a customer's blog, to see
   * an indexing problem before they report it. */
  const second = 'aB1cD2eF3gH4iJ5kL6mN';

  assert.deepStrictEqual(
    parseVerificationTags(
      `<meta name="google-site-verification" content="${TOKEN}" />\n${second}`),
    [TOKEN, second]);
});

test('and blank lines between them are not entries', () => {
  assert.deepStrictEqual(
    parseVerificationTags(`${TOKEN}\n\n   \n${'aB1cD2eF3gH4iJ5kL6mN'}\n`),
    [TOKEN, 'aB1cD2eF3gH4iJ5kL6mN']);
});

test('THE SAME TAG TWICE IS KEPT ONCE', () => {
  /* Pasting over an existing value without clearing it is the ordinary way
   * this happens, and two identical meta tags on a page is a small mess
   * that is entirely avoidable here. */
  assert.deepStrictEqual(
    parseVerificationTags(`${TOKEN}\n<meta name="google-site-verification" content="${TOKEN}">`),
    [TOKEN]);
});

console.log('\nWhat we refuse\n');

test('NOTHING AT ALL IS AN EMPTY LIST, NOT AN ERROR', () => {
  /* Clearing the field is how a customer removes a verification, and it is
   * the state every existing blog is already in. */
  for (const input of [undefined, null, '', '   ', '\n\n']) {
    assert.deepStrictEqual(parseVerificationTags(input), [],
      `${JSON.stringify(input)} did not come back empty`);
  }
});

test('A SCRIPT TAG IS NOT A VERIFICATION TOKEN', () => {
  /* THE ONE THAT MATTERS. This value goes into an attribute on every page
   * of a published site, so a string that closes the attribute and opens an
   * element is an injection into somebody else's readers' browsers.
   *
   * Refused HERE as well as escaped at render time. Two independent
   * defences, because escaping is one `esc()` somebody deletes while
   * tidying, and this file is the one that says what a token even is. */
  const nasty = [
    '"><script>alert(1)</script>',
    `<meta name="google-site-verification" content='"><script>alert(1)</script>'>`,
    '" onload="alert(1)',
    'abc"><img src=x onerror=alert(1)>',
  ];

  for (const input of nasty) {
    assert.deepStrictEqual(parseVerificationTags(input), [],
      `accepted something dangerous: ${input}`);
  }
});

test('AND NEITHER IS A SENTENCE', () => {
  /* Somebody pasting the instructions instead of the tag. An empty list and
   * a field that still looks unset is a better answer than a page carrying
   * a meta tag whose content is a paragraph of English. */
  assert.deepStrictEqual(
    parseVerificationTags('Copy the meta tag below and paste it into your site'), []);
});

test('A TOKEN WITH SPACES IN IT IS NOT A TOKEN', () => {
  assert.deepStrictEqual(parseVerificationTags('abc def'), []);
});

test('AND ONE LONG ENOUGH TO BE A MISTAKE IS REFUSED', () => {
  assert.deepStrictEqual(parseVerificationTags('a'.repeat(MAX_TOKEN + 1)), []);
  assert.deepStrictEqual(parseVerificationTags('a'.repeat(MAX_TOKEN)), ['a'.repeat(MAX_TOKEN)]);
});

test('AND A VERY SHORT ONE, WHICH IS A TYPO RATHER THAN A TOKEN', () => {
  assert.deepStrictEqual(parseVerificationTags('abc'), []);
});

test('THE LIST IS CAPPED', () => {
  /* Nothing good arrives as two hundred verification tags, and every one of
   * them would be rendered into every page of the blog. */
  const many = Array.from({ length: MAX_TAGS + 5 },
    (_, i) => `token${String(i).padStart(14, '0')}`).join('\n');

  assert.strictEqual(parseVerificationTags(many).length, MAX_TAGS);
});

test('ONE BAD LINE DOES NOT THROW AWAY THE GOOD ONES', () => {
  /* A customer pasting two tags and fumbling one should end up with the
   * other, not with an empty field and no explanation.
   *
   * THE SECOND CASE WAS ADDED AFTER MUTATION WALKED THROUGH. Turning the
   * skip into `return []` SURVIVED, because every bad line in the first
   * case is a BARE line — it reaches the length and shape checks further
   * down and is refused there, never touching the skip being tested.
   *
   * Only a <meta> tag that is not Google's comes back empty from the
   * extractor, so only that reaches the line in question. A test that
   * cannot reach the branch it is named after is not testing it. */
  assert.deepStrictEqual(
    parseVerificationTags(`${TOKEN}\n"><script>alert(1)</script>\naB1cD2eF3gH4iJ5kL6mN`),
    [TOKEN, 'aB1cD2eF3gH4iJ5kL6mN']);

  assert.deepStrictEqual(
    parseVerificationTags(
      `${TOKEN}\n<meta name="description" content="A blog about plumbing">\naB1cD2eF3gH4iJ5kL6mN`),
    [TOKEN, 'aB1cD2eF3gH4iJ5kL6mN']);
});

test('A TAG THAT IS NOT GOOGLE\'S IS NOT ACCEPTED AS ONE', () => {
  /* <meta name="description" content="..."> parsed for its content would
   * put a sentence of prose in as a verification token, and the <meta> shape
   * is the only reason it got that far. If it claims to be a meta tag, it
   * has to be the right meta tag. */
  assert.deepStrictEqual(
    parseVerificationTags('<meta name="description" content="A blog about plumbing">'), []);

  assert.deepStrictEqual(
    parseVerificationTags('<meta name="msvalidate.01" content="ABC123DEF456GHI789">'), []);
});

console.log('\nWhat reaches the page\n');

test('THE OUTPUT IS ALWAYS SAFE TO PUT IN AN ATTRIBUTE', () => {
  /* The property the renderer relies on. Whatever went in, what comes out
   * carries none of the five characters that could end an attribute or open
   * an element. */
  const inputs = [
    TOKEN,
    `<meta name="google-site-verification" content="${TOKEN}" />`,
    '"><script>alert(1)</script>',
    'abc def',
    'a'.repeat(200),
  ];

  for (const input of inputs) {
    for (const token of parseVerificationTags(input)) {
      assert.ok(!/[<>"'&]/.test(token),
        `"${token}" could break out of an attribute`);
    }
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
