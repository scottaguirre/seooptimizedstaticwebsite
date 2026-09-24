// test-business-type-picker.js
//
// Step 1 of the wizard, since it stopped being a <select>.
//
// WHY THE PICKER IS ITS OWN FILE, AND THIS ITS OWN SUITE
//
// generateDinamycForm.js is 139KB and cannot be loaded outside a browser, so
// nothing inside it has ever been tested directly — test-business-shape.js
// gets at the three constants by extracting them from the source as text.
// Pulling the picker out into public/js/businessTypePicker.js means the part
// a customer actually touches on step 1 can be RUN.
//
// WHAT WOULD ACTUALLY HURT, which is what the tests below are about:
//
//   - a typed string reaching the server as a business type. It matches no
//     registry entry, businessShape() answers 'generic', and the customer
//     pays for a site with none of their trade's pages on it.
//   - Enter submitting the wizard from the search box.
//   - the list going empty and staying empty.
//
//   node test-business-type-picker.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

/* ------------------------------------------------------------------ *
 * A document, hand-written
 * ------------------------------------------------------------------ *
 *
 * No jsdom: a dependency behind a deploy is the failure deploy.sh opens with
 * a warning about. The picker touches about a dozen DOM calls and this covers
 * them.
 */

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.parentNode = null;
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.type = '';
    this.id = '';
    this.focused = false;
    this.scrolled = false;
  }

  set innerHTML(html) {
    // The picker only ever assigns '' — it builds elements rather than
    // markup. Anything else would mean this stub is lying about what ran.
    if (html !== '') throw new Error(`innerHTML was set to markup: ${html}`);
    for (const c of this.children) c.parentNode = null;
    this.children = [];
  }

  get innerHTML() { return ''; }

  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  removeAttribute(name) { delete this.attrs[name]; }

  appendChild(child) {
    if (child.parentNode) child.parentNode.detach(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  detach(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
  }

  addEventListener(event, fn) {
    (this.listeners[event] = this.listeners[event] || []).push(fn);
  }

  fire(event, payload) {
    const e = Object.assign({ preventDefault() { e.defaultPrevented = true; } }, payload || {});
    for (const fn of (this.listeners[event] || [])) fn.call(this, e);
    return e;
  }

  focus() { this.focused = true; }
  scrollIntoView() { this.scrolled = true; }

  walk(out = []) {
    out.push(this);
    for (const c of this.children) c.walk(out);
    return out;
  }

  get text() {
    return this.children.length
      ? this.children.map(c => c.text).join(' ')
      : this.textContent;
  }
}

const document = { createElement: tag => new El(tag) };

const source = fs.readFileSync(path.join(__dirname, 'public', 'js', 'businessTypePicker.js'), 'utf8');
const sandbox = { window: {}, module: { exports: {} } };
vm.runInNewContext(source, sandbox);
const { createBusinessTypePicker } = sandbox.window;

const LABELS = [
  'Plumbing', 'Fencing', 'Painter', 'Paving', 'Swimming Pool Contractor',
  'Junk Removal', 'Appliance Repair', 'Water Damage Restoration',
  'Tree Removal', 'Electrician', 'Concrete Contractor',
  'French Drain Installation', 'Roofing', 'HVAC', 'Air Conditioning',
  'Landscaping', 'Dentist', 'Doctor', 'Chiropractor', 'Physical Therapy',
  'Lemon Law', 'Web Design', 'Coding',
];

function picker(over = {}) {
  return createBusinessTypePicker({ labels: LABELS, document, ...over });
}

const shown = p => p.options().map(o => o.label);

function type(p, text) {
  p.input.value = text;
  p.input.fire('input');
}

function key(p, k) {
  return p.input.fire('keydown', { key: k });
}

console.log('\nBusiness type picker\n');

/* ------------------------------------------------------------------ *
 * Finding one
 * ------------------------------------------------------------------ */

test('everything is listed before anything is typed', () => {
  // Nobody should have to guess a search term to see what is on offer. The
  // list is the page's content, not a dropdown that has to be opened.
  const p = picker();
  assert.deepStrictEqual(shown(p), LABELS);
});

test('typing narrows the list', () => {
  const p = picker();
  type(p, 'plum');

  assert.deepStrictEqual(shown(p), ['Plumbing']);
});

test('the match is anywhere in the name, not just the start', () => {
  // "Swimming Pool Contractor" is what somebody searching "pool" wants, and
  // a starts-with test would miss it.
  const p = picker();
  type(p, 'pool');

  assert.deepStrictEqual(shown(p), ['Swimming Pool Contractor']);
});

test('case and stray spaces do not matter', () => {
  const p = picker();
  type(p, '  ROOF ');

  assert.deepStrictEqual(shown(p), ['Roofing']);
});

test('TYPING A NUMBER JUMPS TO THAT POSITION', () => {
  // Edwin's reason for the numbers: "if I know that plumbing is #20 it's
  // easier to remember." No business type has a digit in it, so without this
  // a numeric query would match nothing and the numbers would be decoration.
  const p = picker();
  type(p, '20');

  assert.deepStrictEqual(shown(p), ['Physical Therapy']);
  assert.strictEqual(LABELS[19], 'Physical Therapy');
});

test('a partial number is a prefix, so 1 does not mean only the first', () => {
  const p = picker();
  type(p, '1');

  // 1, and everything from 10 to 19.
  assert.deepStrictEqual(shown(p).length, 11);
  assert.ok(shown(p).includes('Plumbing'));
  assert.ok(shown(p).includes('Chiropractor'));
});

test('the numbers shown are positions in the WHOLE list, not in the filter', () => {
  // The point of a memorised number is that it does not move. Renumbering
  // the filtered rows 1..n would make "#20" mean something different every
  // time the query changed.
  const p = picker();
  type(p, 'r');

  for (const row of p.options()) {
    assert.strictEqual(row.number, LABELS.indexOf(row.label) + 1, row.label);
  }
});

test('nothing matching says so rather than showing an empty box', () => {
  const p = picker();
  type(p, 'zzzz');

  assert.strictEqual(p.options().length, 0);
  assert.match(p.list.text, /Nothing matches/i);
});

/* ------------------------------------------------------------------ *
 * Choosing one
 * ------------------------------------------------------------------ */

test('clicking a row chooses it', () => {
  const p = picker();
  type(p, 'roof');

  p.list.children[0].fire('mousedown');

  assert.strictEqual(p.value(), 'Roofing');
});

test('THE VALUE IS NEVER WHAT WAS TYPED', () => {
  /* The <select> guaranteed a real type; a text input does not. If "plumbin"
   * reached the server it would match no registry entry, businessShape()
   * would answer 'generic', and the customer would pay for a site with none
   * of their trade's pages on it — silently, because a generic site still
   * builds. */
  const p = picker();
  type(p, 'plumbin');

  assert.strictEqual(p.value(), '', 'typed text became the business type');

  // Even a perfectly typed name is not a choice until it is chosen.
  type(p, 'Plumbing');
  assert.strictEqual(p.value(), '', 'typing the exact name selected it by itself');
});

test('arrow keys move and Enter takes the highlighted row', () => {
  const p = picker();

  key(p, 'ArrowDown');
  key(p, 'ArrowDown');
  key(p, 'Enter');

  assert.strictEqual(p.value(), 'Fencing');
});

test('arrows wrap, because the bottom of a long list is closer from the top', () => {
  const p = picker();

  key(p, 'ArrowUp');
  key(p, 'Enter');

  assert.strictEqual(p.value(), LABELS[LABELS.length - 1]);
});

test('ONE MATCH AND ENTER IS AN ANSWER', () => {
  // Typing "plumb" and pressing Enter should choose Plumbing. There is no
  // which.
  const p = picker();
  type(p, 'plumb');
  key(p, 'Enter');

  assert.strictEqual(p.value(), 'Plumbing');
});

test('Enter with several matches and nothing highlighted chooses nothing', () => {
  // Guessing here would pick a type the customer never looked at, and the
  // wizard would carry on as though they had.
  const p = picker();
  type(p, 'r');

  assert.ok(p.options().length > 1);
  key(p, 'Enter');

  assert.strictEqual(p.value(), '');
});

test('ENTER NEVER SUBMITS THE FORM', () => {
  // The picker sits inside the wizard's <form>. An Enter that reached it
  // would post a half-finished wizard from step one.
  const p = picker();

  assert.ok(key(p, 'Enter').defaultPrevented, 'Enter was left to bubble');
  assert.ok(key(p, 'ArrowDown').defaultPrevented);
  assert.ok(key(p, 'ArrowUp').defaultPrevented);
});

test('Escape clears the search and brings the whole list back', () => {
  const p = picker();
  type(p, 'plumb');
  key(p, 'Escape');

  assert.strictEqual(p.input.value, '');
  assert.deepStrictEqual(shown(p), LABELS);
});

test('a choice survives the search being changed afterwards', () => {
  // Somebody picks Roofing, then idly types again. Their choice must not
  // evaporate because the filter moved.
  const p = picker();
  type(p, 'roof');
  p.list.children[0].fire('mousedown');

  type(p, 'dent');

  assert.strictEqual(p.value(), 'Roofing');
});

/* ------------------------------------------------------------------ *
 * Coming back to it
 * ------------------------------------------------------------------ */

test('a draft reopens with its type already chosen', () => {
  // The wizard saves a draft and the customer comes back. Losing the type
  // would send them round step one again.
  const p = picker({ value: 'Dentist' });

  assert.strictEqual(p.value(), 'Dentist');
  assert.match(p.el.walk().map(e => e.textContent).join(' '), /Dentist/);
});

test('a draft holding a type that no longer exists is ignored, not trusted', () => {
  // Types get removed. A stale draft must not put a dead type back into the
  // wizard, where nothing downstream would recognise it.
  const p = picker({ value: 'Blacksmith' });

  assert.strictEqual(p.value(), '');
});

test('the chosen row is marked for a screen reader as well as for the eye', () => {
  const p = picker({ value: 'Roofing' });

  const chosen = p.list.children.find(c => c.getAttribute('data-label') === 'Roofing');
  assert.strictEqual(chosen.getAttribute('aria-selected'), 'true');
  assert.match(chosen.className, /active/);

  const other = p.list.children.find(c => c.getAttribute('data-label') === 'Dentist');
  assert.strictEqual(other.getAttribute('aria-selected'), 'false');
});

test('it announces itself as a combobox over the list', () => {
  const p = picker();

  assert.strictEqual(p.input.getAttribute('role'), 'combobox');
  assert.strictEqual(p.input.getAttribute('aria-controls'), p.list.id);
  assert.strictEqual(p.list.getAttribute('role'), 'listbox');
  assert.strictEqual(p.list.children[0].getAttribute('role'), 'option');

  key(p, 'ArrowDown');
  assert.strictEqual(p.input.getAttribute('aria-activedescendant'), p.list.children[0].id);
});

test('the invalid mark comes off when they type', () => {
  // Pressing Next with nothing chosen marks the field. It clears as soon as
  // they start looking again.
  const p = picker();
  p.markInvalid();
  assert.match(p.input.className, /is-invalid/);

  type(p, 'plumb');

  assert.ok(!/is-invalid/.test(p.input.className), 'still marked while searching');
});

test('the invalid mark comes off when they CLICK, with nothing typed', () => {
  // A separate path, and the first version of this test missed it: typing
  // clears the mark on its own, so a test that typed first passed even with
  // the clearing removed from the choosing.
  const p = picker();
  p.markInvalid();

  p.list.children[0].fire('mousedown');

  assert.strictEqual(p.value(), LABELS[0]);
  assert.ok(!/is-invalid/.test(p.input.className), 'still marked after choosing');
});

test('an empty list of types does not throw', () => {
  // Defensive: the labels come from a constant in a 139KB file, and an edit
  // that broke it should not take the whole wizard down with it.
  const p = picker({ labels: [] });

  assert.strictEqual(p.value(), '');
  assert.strictEqual(p.options().length, 0);
});

/* ------------------------------------------------------------------ *
 * The wiring
 * ------------------------------------------------------------------ */

test('the wizard uses the picker and no longer builds a <select>', () => {
  const wizard = fs.readFileSync(
    path.join(__dirname, 'public', 'js', 'generateDinamycForm.js'), 'utf8');

  const step = wizard.match(/function renderBusinessTypeStep\(\)[\s\S]*?\n  \}/);
  assert.ok(step, 'the business type step is gone');

  assert.match(step[0], /createBusinessTypePicker/, 'the step does not use the picker');
  assert.match(step[0], /picker\.value\(\)/,
    'the step reads something other than the chosen value');

  // COMMENTS STRIPPED FIRST. The first version of this failed against
  // correct code, because the comment explaining why there is no longer a
  // <select> contains the word <select>. Matching source text catches the
  // explanation as readily as the thing explained.
  const code = step[0]
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  assert.ok(!/<select/.test(code), 'the step still builds a dropdown');
  assert.ok(!/BUSINESS_TYPE_LABELS\s*\n?\s*\.map/.test(code),
    'the step still builds its own options');
});

test('the page loads the picker BEFORE the wizard that calls it', () => {
  // Both are deferred, and deferred scripts run in document order. The wrong
  // order is a ReferenceError on step one.
  const html = fs.readFileSync(path.join(__dirname, 'src', 'views', 'form.html'), 'utf8');

  // THE ORDER OF THE TAGS, not of the mentions. The first version compared
  // indexOf() over the raw file and failed against correct markup, because
  // the comment above the new tag names generateDinamycForm.js — so the
  // wizard appeared to come first. Only <script src> lines count.
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);

  const picker = scripts.indexOf('/js/businessTypePicker.js');
  const wizard = scripts.indexOf('/js/generateDinamycForm.js');

  assert.ok(picker > -1, 'the picker script is not on the page');
  assert.ok(wizard > -1, 'the wizard script is not on the page');
  assert.ok(picker < wizard, 'the picker loads after the wizard that calls it');

  assert.match(html, /businessTypePicker\.js" defer/);
  assert.match(html, /business-type-picker\.css/, 'the stylesheet is not linked');
});

test('THE PICKER USES THE KEYWORD TABLE\'S PALETTE, NOT ONE OF ITS OWN', () => {
  /* The picker and the keyword research results table are the same kind of
   * thing on screen — a long list a customer scans, on the same navy page —
   * and two lists that looked different would read as two different apps.
   *
   * This asserted "the stylesheet sets no colours" while the DO NOT TOUCH
   * rule was in force. Edwin lifted that rule on 24 September and asked for
   * the dark zebra, so the guard changes job: the values must be the TABLE'S
   * values, so the two cannot drift apart when one is retuned. */
  const css = fs.readFileSync(
    path.join(__dirname, 'public', 'business-type-picker.css'), 'utf8');
  const page = fs.readFileSync(
    path.join(__dirname, 'src', 'views', 'keyword-research.html'), 'utf8');

  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const tidy = text => text.replace(/\s+/g, '');

  // What the table declares, read out of the page rather than copied here.
  const tableValue = name => {
    const found = page.match(new RegExp(`--bs-table-${name}\\s*:\\s*([^;]+);`));
    assert.ok(found, `the results table no longer sets --bs-table-${name}`);
    return tidy(found[1]);
  };

  const striped = tableValue('striped-bg');
  const hover = tableValue('hover-bg');
  const border = tableValue('border-color');

  const declared = tidy(body);

  assert.ok(declared.includes(striped), `the zebra stripe is not the table's ${striped}`);
  assert.ok(declared.includes(hover), `the hover is not the table's ${hover}`);
  assert.ok(declared.includes(border), `the border is not the table's ${border}`);

  // Dark, like the table: white text on a transparent row over the page's
  // own navy, rather than Bootstrap's white list-group.
  assert.match(body, /\.list-group-item\s*\{[^}]*background:\s*transparent/);
  assert.match(body, /\.list-group-item\s*\{[^}]*color:\s*#fff/);
  assert.match(body, /nth-child\(even\)/, 'there is no zebra');
});

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('');
process.exit(failed === 0 ? 0 : 1);
