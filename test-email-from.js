// test-email-from.js
//
// The From header, and only the From header.
//
// It is one string, so it looks too small to test. It is also the one part of
// an email nobody sees until it is already in someone's inbox: a malformed
// display name is either rejected by the provider or shown to a customer, and
// both happen after the send.
//
//   node test-email-from.js

const assert = require('assert');

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

/**
 * Load sendEmail.js with a given environment.
 *
 * fromAddress() reads process.env at call time, so setting the variables
 * would be enough — but deleting the module from the require cache keeps each
 * case independent of the ones before it, whatever the module does at load.
 */
function fromWith(env) {
  const saved = {};
  const keys = ['EMAIL_FROM', 'EMAIL_FROM_NAME'];

  for (const k of keys) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }

  delete require.cache[require.resolve('./utils/sendEmail')];
  const { fromAddress } = require('./utils/sendEmail');

  try {
    return fromAddress();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

console.log('\nFrom header\n');

test('a bare address gets the default display name', () => {
  assert.strictEqual(
    fromWith({ EMAIL_FROM: 'hello@fastwebsitegenerator.com' }),
    'Fast Website Generator <hello@fastwebsitegenerator.com>'
  );
});

test('the address itself is never altered', () => {
  const out = fromWith({ EMAIL_FROM: 'hello@fastwebsitegenerator.com' });
  assert.ok(
    out.endsWith('<hello@fastwebsitegenerator.com>'),
    `address changed: ${out}`
  );
});

test('EMAIL_FROM_NAME overrides the default', () => {
  assert.strictEqual(
    fromWith({ EMAIL_FROM: 'hello@x.com', EMAIL_FROM_NAME: 'Support' }),
    'Support <hello@x.com>'
  );
});

test('an explicitly empty EMAIL_FROM_NAME means a bare address', () => {
  // The pre-change behaviour has to stay reachable, or this is a change with
  // no way back short of editing code.
  assert.strictEqual(
    fromWith({ EMAIL_FROM: 'hello@x.com', EMAIL_FROM_NAME: '' }),
    'hello@x.com'
  );
});

test('whitespace-only EMAIL_FROM_NAME also means a bare address', () => {
  assert.strictEqual(
    fromWith({ EMAIL_FROM: 'hello@x.com', EMAIL_FROM_NAME: '   ' }),
    'hello@x.com'
  );
});

test('EMAIL_FROM already written as Name <addr> is left alone', () => {
  // Wrapping it again gives `Fast Website Generator <Acme <a@b.c>>`, which is
  // not a valid header.
  assert.strictEqual(
    fromWith({ EMAIL_FROM: 'Acme <hello@x.com>' }),
    'Acme <hello@x.com>'
  );
});

test('a name with a comma is quoted', () => {
  // Unquoted, `Smith, John <a@b.c>` parses as two addresses.
  assert.strictEqual(
    fromWith({ EMAIL_FROM: 'a@b.c', EMAIL_FROM_NAME: 'Smith, John' }),
    '"Smith, John" <a@b.c>'
  );
});

test('a name with parentheses is quoted', () => {
  // Parentheses are comment syntax in RFC 5322 — unquoted, the text inside
  // them disappears from what the recipient sees.
  assert.strictEqual(
    fromWith({ EMAIL_FROM: 'a@b.c', EMAIL_FROM_NAME: 'Support (US)' }),
    '"Support (US)" <a@b.c>'
  );
});

test('a plain name is not quoted', () => {
  assert.strictEqual(
    fromWith({ EMAIL_FROM: 'a@b.c', EMAIL_FROM_NAME: 'Fast Website Generator' }),
    'Fast Website Generator <a@b.c>'
  );
});

test('a newline in the name cannot inject a header', () => {
  // The injection needs the line break. Without one the rest is just text,
  // and the colon and @ it contains force it into quotes, where it stays
  // text — so the assertion is about the break, not about the word "Bcc".
  const out = fromWith({
    EMAIL_FROM: 'a@b.c',
    EMAIL_FROM_NAME: 'Evil\r\nBcc: victim@example.com',
  });
  assert.ok(!/[\r\n]/.test(out), `From header contains a line break: ${JSON.stringify(out)}`);
  assert.strictEqual(out, '"EvilBcc: victim@example.com" <a@b.c>');
});

test('a quote in the name cannot break out of the quoting', () => {
  // The stray quote is stripped, then the comma forces quoting of what is
  // left — so the result has exactly one pair of quotes, around the name.
  const out = fromWith({ EMAIL_FROM: 'a@b.c', EMAIL_FROM_NAME: 'Ev"il, Co' });
  assert.strictEqual(out, '"Evil, Co" <a@b.c>');
});

test('no EMAIL_FROM at all still falls back to the Resend sandbox address', () => {
  // Development and a fresh checkout both hit this. It must not throw.
  assert.strictEqual(
    fromWith({}),
    'Fast Website Generator <onboarding@resend.dev>'
  );
});

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('');

process.exit(failed === 0 ? 0 : 1);
