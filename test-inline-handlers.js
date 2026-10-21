// test-inline-handlers.js
//
// Nothing in this app may rely on an inline event handler, because the
// Content-Security-Policy forbids them.
//
// THE BUG THIS FILE EXISTS FOR, 19 October.
//
// helmet's CSP sets `script-src-attr 'none'` BY DEFAULT. server.js overrides
// `script-src` with 'unsafe-inline' and says so in a comment — but
// script-src-attr is a SEPARATE directive, it was never overridden, and
// 'unsafe-inline' on script-src does not cover it. Every onclick= and
// onsubmit= attribute in the app was blocked by the browser.
//
// Four of them existed, and three were the confirmation prompts on
// DESTRUCTIVE actions:
//
//   adminRoute      "Are you sure you want to delete this user?"
//   blogSitesRoute  "Remove this licence from the list?"
//   blogSitesRoute  "Revoke this licence? The plugin will stop working"
//   staticBlogsRoute  Clear topics
//
// None of them ever ran. Delete deleted, Revoke revoked, and no prompt was
// ever shown. The guards were visible in the source, so nobody re-read them.
//
// IT WAS FOUND BY A CUSTOMER PRESSING A BUTTON, not by a suite — and Claude
// made it worse first by reading `scriptSrc` in server.js, seeing
// 'unsafe-inline', and declaring inline handlers allowed. The browser check
// that followed loaded the rendered HTML from a FILE, which carries no
// response headers and therefore no CSP at all, and passed. Testing the
// markup is not testing the page.
//
// So this file does two things that between them cannot miss it again:
// it reads the REAL header out of the REAL middleware, and it refuses to let
// an inline handler back into the source.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

const queue = [];
function test(name, fn) {
  queue.push(() => Promise.resolve().then(fn)
    .then(() => { console.log(`  ok    ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }));
}
function section(n) { queue.push(async () => console.log(`\n${n}\n`)); }

/* ----------------------------------------------------------- the sources */

/* EVERY HANDLER ATTRIBUTE THE HTML SPEC HAS, not the four that happen to be
 * in use today. The next one somebody writes will be onchange or oninput,
 * and a list of exactly what went wrong last time is a list that is already
 * out of date. */
const HANDLER = /\son[a-z]+\s*=\s*["']/gi;

/* GENERATED WORDPRESS THEME CODE IS NOT OURS TO POLICE. Those files are
 * written into a customer's own site and served under THEIR Content-Security
 * -Policy, which is WordPress's, not this one. An inline handler there is a
 * question for whoever runs that site. */
const NOT_OURS = [
  path.join('utils', 'wpThemeBuilder'),
];

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (NOT_OURS.some(skip => full.startsWith(skip))) continue;

    if (entry.isDirectory()) sourceFiles(full, out);
    else if (full.endsWith('.js')) out.push(full);
  }
  return out;
}

section('NO INLINE EVENT HANDLERS, ANYWHERE WE SERVE');

test('NOTHING IN routes/ WRITES AN INLINE HANDLER', () => {
  /* Every page in the app is rendered from here. A handler attribute in one
   * of these files is a handler the browser will refuse to run — silently,
   * with no error on the page and no failure in any other suite. */
  const offenders = [];

  for (const file of sourceFiles('routes')) {
    const text = fs.readFileSync(file, 'utf8');
    const found = text.match(HANDLER);
    if (found) offenders.push(`${file}: ${[...new Set(found.map(s => s.trim()))].join(', ')}`);
  }

  assert.deepStrictEqual(offenders, [],
    `inline handlers the CSP will block:\n    ${offenders.join('\n    ')}`);
});

test('NOR ANYTHING IN utils/ THAT BUILDS OUR OWN PAGES', () => {
  const offenders = [];

  for (const file of sourceFiles('utils')) {
    const text = fs.readFileSync(file, 'utf8');
    const found = text.match(HANDLER);
    if (found) offenders.push(`${file}: ${[...new Set(found.map(s => s.trim()))].join(', ')}`);
  }

  assert.deepStrictEqual(offenders, [],
    `inline handlers the CSP will block:\n    ${offenders.join('\n    ')}`);
});

test('and the rule itself is not looking at nothing', () => {
  /* A regex that matches nothing passes both tests above for ever. This is
   * the line that proves it still bites. */
  const sample = '<form onsubmit="return confirm(\'x\')"><button onclick="go()">';

  assert.strictEqual((sample.match(HANDLER) || []).length, 2,
    'the rule no longer recognises an inline handler');
});

/* ------------------------------------------------------------ the header */

section('THE POLICY THAT MAKES THAT A RULE');

const { securityHeaders } = require('./middleware/securityHeaders');

/** The CSP the middleware actually sets, as a browser would receive it. */
function policy() {
  const middleware = securityHeaders();
  const headers = {};

  const res = {
    setHeader: (name, value) => { headers[name.toLowerCase()] = value; },
    getHeader: (name) => headers[name.toLowerCase()],
    removeHeader: (name) => { delete headers[name.toLowerCase()]; },
  };

  middleware({ secure: true, headers: {} }, res, () => {});

  return String(headers['content-security-policy'] || '');
}

test('THE HEADER IS READ FROM THE MIDDLEWARE, NOT FROM A COMMENT', () => {
  /* THE WHOLE REASON server.js's CSP WAS EXTRACTED. It used to be an options
   * object inlined into an app.use() call, reachable only by booting the
   * server — so the only way to know what it said was to read it, and
   * reading it is exactly what went wrong. */
  const csp = policy();

  assert.ok(csp.length, 'the middleware set no Content-Security-Policy at all');
  assert.ok(csp.includes('default-src'), `that does not look like a CSP: ${csp.slice(0, 120)}`);
});

test('INLINE EVENT HANDLERS ARE FORBIDDEN, AND IT SAYS SO OUT LOUD', () => {
  /* script-src-attr WAS NEVER WRITTEN DOWN. It was helmet's default, which
   * is the whole problem: a rule nobody states is a rule nobody checks
   * against the code they are writing. Now it is in the directives and here
   * in a test, so the next person to reach for an onclick finds out from a
   * red suite instead of from a customer. */
  assert.ok(/script-src-attr\s+'none'/.test(policy()),
    'inline handlers are no longer forbidden — if that is deliberate, the tests above are now wrong too');
});

test('WHILE <script> BLOCKS STAY ALLOWED, WHICH IS THE OTHER HALF', () => {
  /* The fix for a blocked onclick is a <script> that binds it, so that half
   * must keep working. If this ever fails, every deferred binder in the app
   * has gone quiet and the first test above is no longer a safe rule to
   * follow — it would be telling people to move code somewhere it also
   * cannot run. */
  const csp = policy();
  const scriptSrc = (csp.split(';').find(part => part.trim().startsWith('script-src ')) || '');

  assert.ok(scriptSrc.includes("'unsafe-inline'"),
    `script-src no longer allows inline blocks: ${scriptSrc.trim()}`);
});

/* ------------------------------------------------------------ the wiring */

section('AND THE PAGES ACTUALLY USE IT');

/* THE WIRING GAP, FOUND BY MUTATION FOR THE SEVENTH TIME IN THIS PROJECT.
 *
 * The guard below is tested to the hilt and the policy above is asserted
 * against the real header — and with both of those green, deleting the
 * data-confirm from the admin page, or the <script> tag from the header,
 * broke NOTHING. Two correct halves and no wire between them is the exact
 * shape of the bug this whole file exists because of: the prompts were in
 * the source and absent from the browser. */

test('EVERY DESTRUCTIVE FORM CARRIES A QUESTION', () => {
  /* A form that deletes or revokes something must either ask, or be on a
   * page that is itself the asking. Nothing may simply do it. */

  /* THE ONE EXCEPTION, AND IT IS STRONGER RATHER THAN WEAKER. Deleting a
   * blog has its own page: it names the blog, says what goes with it, and
   * makes you TYPE the name. A confirm() box would be a downgrade. */
  const ASKED_ANOTHER_WAY = ['/static-blogs/${blog._id}/delete'];

  const DESTRUCTIVE = /\/(delete|revoke|remove|destroy)\b/;
  const unguarded = [];

  for (const file of sourceFiles('routes')) {
    const text = fs.readFileSync(file, 'utf8');

    for (const tag of text.match(/<form[^>]*>/g) || []) {
      const action = (tag.match(/action="([^"]*)"/) || [])[1];

      if (!action || !DESTRUCTIVE.test(action)) continue;
      if (ASKED_ANOTHER_WAY.includes(action)) continue;
      if (tag.includes('data-confirm')) continue;

      unguarded.push(`${file}: ${action}`);
    }
  }

  assert.deepStrictEqual(unguarded, [],
    `destructive forms that ask nothing:\n    ${unguarded.join('\n    ')}`);
});

test('AND EVERY PAGE LOADS THE THING THAT ASKS IT', () => {
  /* data-confirm is inert markup. Without this script tag it is an
   * attribute nobody reads, which looks exactly as safe in the source as
   * the onsubmit= did. */
  const { appHeaderScripts } = require('./utils/appHeader');

  /* THE TAG, NOT THE PATH. The comment above that tag names the file too,
   * so a substring test passes on a header whose <script> has been deleted
   * and whose explanation of it remains — which is the same failure as a
   * confirm() that is written down and never runs. Checked against the
   * actual element. */
  assert.ok(/<script src="\/js\/confirmSubmit\.js"/.test(appHeaderScripts()),
    'no page loads the confirmation guard, so every data-confirm is decoration');
});

/* ------------------------------------------------- what replaced them all */

section('THE GUARD THAT NOW ASKS THE QUESTION');

const { bindConfirmations } = require('./public/js/confirmSubmit');

/** One form, recording what the guard did to it. */
function form(attributes) {
  const listeners = [];

  return {
    getAttribute: (name) => (name in attributes ? attributes[name] : null),
    addEventListener: (type, fn) => listeners.push({ type, fn }),

    /** Press submit, and report what the page would do next. */
    submit() {
      const did = { prevented: false, stopped: false };
      const event = {
        preventDefault: () => { did.prevented = true; },
        stopPropagation: () => { did.stopped = true; },
      };

      for (const l of listeners) if ('submit' === l.type) l.fn.call(this, event);

      return did;
    },

    listeners,
  };
}

/** A document holding exactly the forms a selector should find. */
function doc(withAttribute, without = []) {
  return {
    querySelectorAll: (selector) => {
      assert.strictEqual(selector, 'form[data-confirm]',
        `the guard went looking for ${selector}, which would catch the wrong forms`);
      return withAttribute;
    },
    _ignored: without,
  };
}

test('CANCELLING STOPS THE SUBMISSION', () => {
  /* THE ENTIRE POINT. The thing this replaced never got here: the browser
   * refused to run it, the form submitted, and the user was deleted. */
  const f = form({ 'data-confirm': 'Are you sure you want to delete this user?' });

  bindConfirmations(doc([f]), () => false);

  const did = f.submit();

  assert.strictEqual(did.prevented, true, 'Cancel did not stop the form');
  assert.strictEqual(did.stopped, true,
    'the busy-spinner handler still ran, so the buttons are greyed out for ever');
});

test('AND CONFIRMING LETS IT THROUGH', () => {
  /* A guard that blocks both answers is a broken button, and it would look
   * exactly like the bug we just fixed from the other side. */
  const f = form({ 'data-confirm': 'Revoke this licence?' });

  bindConfirmations(doc([f]), () => true);

  assert.strictEqual(f.submit().prevented, false, 'OK did not let the form submit');
});

test('THE QUESTION ASKED IS THE ONE ON THE FORM', () => {
  /* Three different forms carry three different warnings, and the one about
   * a plugin that stops working immediately is not interchangeable with the
   * one about a licence with no campaigns. */
  const asked = [];
  const f = form({ 'data-confirm': 'Revoke this licence? The plugin on that site will stop working immediately.' });

  bindConfirmations(doc([f]), (question) => { asked.push(question); return true; });
  f.submit();

  assert.deepStrictEqual(asked,
    ['Revoke this licence? The plugin on that site will stop working immediately.'],
    'the form was guarded by a different question than the one it carries');
});

test('an empty question asks nothing and blocks nothing', () => {
  /* A form carrying data-confirm="" is a mistake in a template. Showing a
   * dialog with no words in it is worse than letting it through. */
  let asked = 0;
  const f = form({ 'data-confirm': '' });

  bindConfirmations(doc([f]), () => { asked += 1; return false; });

  assert.strictEqual(f.submit().prevented, false, 'an empty question blocked the form');
  assert.strictEqual(asked, 0, 'an empty dialog was shown');
});

test('IT BINDS THE submit EVENT, NOT A BUTTON CLICK', () => {
  /* A form can be submitted by pressing Enter in a field. A guard bound to
   * the button is not there when that happens — and the absence is silent,
   * which is the failure mode this whole file exists because of. */
  const f = form({ 'data-confirm': 'Delete?' });

  bindConfirmations(doc([f]), () => false);

  assert.deepStrictEqual(f.listeners.map(l => l.type), ['submit'],
    'the guard is bound to something other than the form submitting');
});

test('and every guarded form on the page gets its own', () => {
  /* The licence screen renders one per row. Binding only the first would
   * leave every other Revoke button unguarded, which is the shape of the
   * original bug with fewer victims. */
  const forms = [
    form({ 'data-confirm': 'One?' }),
    form({ 'data-confirm': 'Two?' }),
    form({ 'data-confirm': 'Three?' }),
  ];

  bindConfirmations(doc(forms), () => false);

  for (const f of forms) {
    assert.strictEqual(f.submit().prevented, true, 'a form on the page was left unguarded');
  }
});

/* ======================================================================= */

(async () => {
  for (const run of queue) await run();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
