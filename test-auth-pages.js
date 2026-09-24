// test-auth-pages.js
//
// The log in, sign up and reset-password pages.
//
// WHAT THESE PAGES ARE, WHICH IS WHY THEY GET THEIR OWN SUITE
//
// They are the only pages in the app somebody sees before they are a
// customer. A broken wizard costs a session; a log-in form that cannot be
// typed into on a phone costs the account.
//
// TWO THINGS FOUND BY LOOKING AT ONE SCREENSHOT
//
//   1. login.html and signup.html had no viewport meta tag. Every other page
//      in the app has one. Without it a phone lays the page out at about
//      980px and scales it down, so the form arrives too small to read and
//      the customer pinch-zooms to type their email. Bootstrap's responsive
//      grid does nothing whatever until that tag is present — the col-md-4
//      on the form was decorative.
//
//   2. There was no way to see the password being typed.
//
//   node test-auth-pages.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ok    ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}\n        ${err.message}`);
    failed++;
  }
}

const read = p => fs.readFileSync(path.join(__dirname, p), 'utf8');

const login = read('src/views/login.html');
const signup = read('src/views/signup.html');
const passwordRoute = read('routes/passwordRoute.js');
const toggle = read('public/js/passwordToggle.js');

/** Every page a password can be typed into, and where its HTML lives. */
const PAGES = [
  ['login.html', login],
  ['signup.html', signup],
  ['passwordRoute.js', passwordRoute],
];

console.log('\nAuth pages\n');

/* ------------------------------------------------------------------ *
 * The phone
 * ------------------------------------------------------------------ */

test('EVERY AUTH PAGE DECLARES THE VIEWPORT', () => {
  // The bug. Without this a phone renders at ~980px and scales down: the
  // form is too small to read and has to be pinch-zoomed before it can be
  // typed into. It is one tag and it is the whole of "is this responsive".
  for (const [name, html] of PAGES) {
    assert.match(
      html,
      /<meta\s+name="viewport"\s+content="width=device-width,\s*initial-scale=1(\.0)?"/,
      `${name} has no viewport tag, so it renders zoomed out on a phone`
    );
  }
});

test('the form is full width on a phone and narrow on a desktop', () => {
  // col-md-* is full width below the md breakpoint and a column above it.
  // Asserted because a bare col-4 here would leave a third-width form on a
  // 390px screen — which is what the viewport tag would then reveal.
  for (const [name, html] of [['login.html', login], ['signup.html', signup]]) {
    assert.match(html, /class="col-md-\d"/, `${name} is not using a md column`);
    assert.ok(!/class="col-\d"/.test(html), `${name} pins a width at every size`);
  }
});

/* ------------------------------------------------------------------ *
 * Seeing what you typed
 * ------------------------------------------------------------------ */

test('the toggle script reaches every page with a password field', () => {
  for (const [name, html] of PAGES) {
    assert.match(html, /src="\/js\/passwordToggle\.js"/,
      `${name} never loads the toggle`);
    assert.match(html, /passwordToggle\.js"\s+defer/,
      `${name} loads the toggle without defer, so it runs before the field exists`);
  }
});

test('THE BUTTON IS type="button", BECAUSE THE DEFAULT IS SUBMIT', () => {
  // A <button> inside a <form> with no type submits the form. The eye would
  // have posted the login form on the first click, before the password was
  // finished — a bug that looks like "the site logged me out".
  assert.match(toggle, /button\.type = 'button';/,
    'the button would submit the form it sits in');
});

test('a field is only wrapped once', () => {
  // Three pages add the script tag separately and the shell adds it for all
  // of them; including it twice must not produce two eyes.
  assert.match(toggle, /data-toggle-wrapped/,
    'nothing stops the same field being wrapped twice');
});

test('the type really changes, in both directions', () => {
  assert.match(toggle, /type: 'password'/);
  assert.match(toggle, /type: 'text'/);
  assert.match(toggle, /input\.setAttribute\('type', state\.type\)/,
    'the field type is never actually changed');
});

test('a screen reader is told which state it is in', () => {
  // aria-pressed is what makes this a toggle rather than a button that does
  // something invisible, and the label has to say what pressing it will do.
  assert.match(toggle, /aria-pressed/);
  assert.match(toggle, /'Show password'/);
  assert.match(toggle, /'Hide password'/);
  assert.match(toggle, /aria-label/);
});

test('the caret stays where it was', () => {
  // Changing an input's type sends the caret to the end. Somebody fixing the
  // third character of eight should not have to find their place again.
  assert.match(toggle, /selectionStart/);
  assert.match(toggle, /setSelectionRange/);
});

test('NO JAVASCRIPT MEANS AN ORDINARY PASSWORD FIELD, NOT A BROKEN FORM', () => {
  // The markup is untouched: the field is a plain input, the form posts to
  // the same place, and the button is the only thing that does not appear.
  // Nobody is locked out of their account because a script failed to load.
  for (const [name, html] of [['login.html', login], ['signup.html', signup]]) {
    assert.match(html, /<input name="password" type="password"/,
      `${name} no longer has a plain password input`);
    assert.ok(!/input-group/.test(html),
      `${name} hard-codes the button markup, so no-JS shows a dead control`);
  }

  assert.match(login, /<form action="\/login" method="POST">/);
  assert.match(signup, /<form action="\/signup" method="POST">/);
});

test('the icon needs no second request from a page somebody is logging in from', () => {
  // Inline SVG rather than an icon font. These pages load Bootstrap's CSS
  // and nothing else; a webfont for one glyph is a round trip on the slowest
  // page in the app.
  assert.match(toggle, /<svg/);
  assert.ok(!/bootstrap-icons|fontawesome|cdn/i.test(toggle),
    'the toggle pulls an icon set off the network');
});

/* ------------------------------------------------------------------ *
 * What must never appear
 * ------------------------------------------------------------------ */

test('no password is ever echoed back into the page', () => {
  // The email is repopulated after a failed login; the password never is.
  // A value attribute on that field would put the password in the HTML, in
  // the browser's cache, and in any proxy's log.
  for (const [name, html] of PAGES) {
    assert.ok(
      !/type="password"[^>]*\bvalue=/.test(html),
      `${name} writes a password back into the markup`
    );
  }
});

test('the reset form keeps both fields and its minimum length', () => {
  // The toggle is additive. It must not have disturbed the confirm field or
  // the eight-character rule, which are the only things standing between a
  // reset link and a one-character password.
  assert.match(passwordRoute, /name="password" type="password"[\s\S]{0,120}minlength="8"/);
  assert.match(passwordRoute, /name="confirm" type="password"[\s\S]{0,120}minlength="8"/);
});

/* ------------------------------------------------------------------ *
 * The script, actually run
 * ------------------------------------------------------------------ *
 *
 * EVERYTHING ABOVE THIS LINE READS SOURCE TEXT, and that kind of test has
 * been wrong in this codebase before: one asserted the word "total" appeared
 * in a function and passed happily after the total was deleted from the
 * output. A regex proves the code SAYS something, not that it DOES it.
 *
 * So the script is run against a document. There is no jsdom here and adding
 * one would put a dependency behind a deploy — the failure deploy.sh opens
 * with a comment about. A hundred lines of stand-in cover what this script
 * touches, which is a dozen DOM calls.
 */

const vm = require('vm');

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.parentNode = null;
    this.innerHTML = '';
    this.className = '';
    this.focused = false;
    this.selectionStart = null;
    this.ranges = [];
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
    // Mirrored, because the real DOM keeps the property and the attribute in
    // step for `type` and the script reads it both ways.
    if (name === 'type') this.type = String(value);
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }

  detach(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.detach(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore(node, ref) {
    const at = this.children.indexOf(ref);
    if (node.parentNode) node.parentNode.detach(node);
    node.parentNode = this;
    this.children.splice(at < 0 ? this.children.length : at, 0, node);
    return node;
  }

  addEventListener(event, fn) {
    (this.listeners[event] = this.listeners[event] || []).push(fn);
  }

  click() {
    for (const fn of (this.listeners.click || [])) fn.call(this, {});
  }

  focus() { this.focused = true; }

  setSelectionRange(a, b) {
    this.ranges.push([a, b]);
    this.selectionStart = a;
  }

  walk(out = []) {
    out.push(this);
    for (const c of this.children) c.walk(out);
    return out;
  }
}

/** A page with one email field and however many password fields are asked for. */
function makePage(passwordCount = 1) {
  const root = new El('body');
  const form = new El('form');
  root.appendChild(form);

  const email = new El('input');
  email.setAttribute('type', 'email');
  form.appendChild(email);

  const fields = [];
  for (let i = 0; i < passwordCount; i++) {
    const wrap = new El('div');
    const input = new El('input');
    input.setAttribute('type', 'password');
    wrap.appendChild(input);
    form.appendChild(wrap);
    fields.push(input);
  }

  const document = {
    readyState: 'complete',
    addEventListener() {},
    createElement: tag => new El(tag),
    querySelectorAll(selector) {
      assert.strictEqual(selector, 'input[type="password"]',
        `the script asked for an unexpected selector: ${selector}`);
      return root.walk().filter(el => el.getAttribute('type') === 'password');
    },
  };

  return { root, form, email, fields, document };
}

/** Run the real script against that document, and hand back the buttons. */
function run(page, times = 1) {
  const source = read('public/js/passwordToggle.js');
  for (let i = 0; i < times; i++) vm.runInNewContext(source, { document: page.document });

  return page.root.walk().filter(el => el.tagName === 'BUTTON');
}

test('RUN FOR REAL: a password field gains a button beside it', () => {
  const page = makePage(1);
  const buttons = run(page);

  assert.strictEqual(buttons.length, 1, 'no button was built');

  const group = page.fields[0].parentNode;
  assert.match(group.className, /input-group/, 'the field was not wrapped');
  assert.deepStrictEqual(
    group.children.map(c => c.tagName),
    ['INPUT', 'BUTTON'],
    'the button is not beside the field'
  );
});

test('RUN FOR REAL: the button does not submit the form', () => {
  // The whole reason this test file runs the script rather than reading it.
  const page = makePage(1);
  const [button] = run(page);

  assert.strictEqual(button.type, 'button',
    'clicking the eye would post the login form');
});

test('RUN FOR REAL: clicking shows the password, clicking again hides it', () => {
  const page = makePage(1);
  const [button] = run(page);
  const input = page.fields[0];

  assert.strictEqual(input.getAttribute('type'), 'password', 'it starts visible');
  assert.strictEqual(button.getAttribute('aria-pressed'), 'false');

  button.click();
  assert.strictEqual(input.getAttribute('type'), 'text', 'the password never showed');
  assert.strictEqual(button.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(button.getAttribute('aria-label'), 'Hide password');

  button.click();
  assert.strictEqual(input.getAttribute('type'), 'password', 'it would not hide again');
  assert.strictEqual(button.getAttribute('aria-pressed'), 'false');
  assert.strictEqual(button.getAttribute('aria-label'), 'Show password');
});

test('RUN FOR REAL: the caret goes back to where it was', () => {
  // Typed eight characters, spotted a typo in the third, pressed the eye.
  const page = makePage(1);
  const [button] = run(page);
  const input = page.fields[0];

  input.selectionStart = 3;
  button.click();

  assert.ok(input.focused, 'focus was never returned to the field');
  assert.deepStrictEqual(input.ranges[input.ranges.length - 1], [3, 3],
    'the caret was left at the end of the password');
});

test('RUN FOR REAL: both reset fields get their own working button', () => {
  // "New password" and "Confirm new password". One shared button, or one
  // that toggles both, would be worse than none.
  const page = makePage(2);
  const buttons = run(page);

  assert.strictEqual(buttons.length, 2);

  buttons[0].click();
  assert.strictEqual(page.fields[0].getAttribute('type'), 'text');
  assert.strictEqual(page.fields[1].getAttribute('type'), 'password',
    'one button toggled both fields');
});

test('RUN FOR REAL: loading the script twice does not make two eyes', () => {
  // The shell adds the tag for every page built from it and the two view
  // files add their own; a page that gets both must not sprout a second
  // button.
  const page = makePage(1);
  const buttons = run(page, 2);

  assert.strictEqual(buttons.length, 1, `${buttons.length} buttons after two loads`);
});

test('RUN FOR REAL: the email field is left alone', () => {
  const page = makePage(1);
  run(page);

  assert.strictEqual(page.email.getAttribute('type'), 'email');
  assert.strictEqual(page.email.parentNode, page.form,
    'the email field was wrapped in an input group');
});

test('RUN FOR REAL: a page with no password field does nothing and throws nothing', () => {
  // Every page built from the reset shell loads this script, including the
  // "check your email" and "link expired" pages.
  const page = makePage(0);
  const buttons = run(page);

  assert.strictEqual(buttons.length, 0);
});

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('');
process.exit(failed === 0 ? 0 : 1);
