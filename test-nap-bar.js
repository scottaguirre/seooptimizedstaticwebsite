// test-nap-bar.js
//
//   node test-nap-bar.js
//
// The Design 7 hero's name / address / phone bar.
//
// WHY THIS EXISTS. Two faults in that one row, and both were invisible:
//
//   1. The three labels were ::before content in style7.css, chosen by
//      nth-child. Reordering the three divs would have put the phone number
//      under "Address:" with nothing to show for it — no error, no warning,
//      a page that confidently says the wrong thing.
//
//   2. The address printed {{ADDRESS}}, which in three of the four wizard
//      modes is one free-text box. An owner who typed a street got a street.
//      "Address: 1800 Sequoia Dr" looks finished, so nobody checks it.
//
// Both are the same shape of bug: OUTPUT THAT IS WRONG BUT NOT BROKEN. The
// only way to catch that is to assert on what the page actually says.

const fs = require('fs');
const path = require('path');
const { fullAddress } = require('./utils/fullAddress');

const TEMPLATES = [
  'src/template.html',
  'src/aboutUsTemplate.html',
  'src/contactTemplate.html',
  'src/locationPagesTemplate.html',
];

const LABELS = ['Business Name:', 'Address:', 'Phone:'];

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures.push([name, err.message]);
    console.log(`  FAIL  ${name}`);
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

/* The <!--HERO:spotlight--> NAP block of one template. */
function napBlock(file) {
  const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const m = html.match(/<div class="hero-spotlight__nap">[\s\S]*?\n  <\/div>/);
  assert(m, `${file}: no .hero-spotlight__nap block`);
  return m[0];
}


/* -------------------------------------------------------------------------
 * The labels live in the markup
 * ---------------------------------------------------------------------- */

for (const file of TEMPLATES) {
  check(`${file} — all three labels are real text`, () => {
    const nap = napBlock(file);
    for (const label of LABELS) {
      assert(nap.includes(`>${label}<`),
        `${label} is not in the markup. If it has gone back to a CSS ::before, ` +
        `it is invisible to selection, translation and the WordPress renderer.`);
    }
  });

  check(`${file} — the address uses ADDRESS_FULL`, () => {
    const nap = napBlock(file);
    assert(nap.includes('{{ADDRESS_FULL}}'),
      'the NAP bar must use {{ADDRESS_FULL}}; {{ADDRESS}} is the raw box and ' +
      'is often just a street');
    assert(!/\{\{ADDRESS\}\}/.test(nap),
      'the raw {{ADDRESS}} is back in the NAP bar');
  });
}

/* THE LABEL MUST NOT DEPEND ON ROW ORDER. This is the fault the old CSS had:
 * each label was bound to a position, so the rows and their labels could
 * drift apart. Here the label and its value share a parent, which is what
 * makes that impossible. */
check('each label sits in the same element as the value it labels', () => {
  const nap = napBlock('src/template.html');
  const pairs = [
    ['Business Name:', '{{BUSINESS_NAME}}'],
    ['Address:', '{{ADDRESS_FULL}}'],
    ['Phone:', '{{PHONE_DISPLAY}}'],
  ];
  /* Each wrapper runs from its opening tag to the </span> closed at the
     wrapper's own indentation. Matching on "</span></span>" instead would
     have failed on the phone row for the wrong reason — its value is an
     <a>, not a <span> — which is a test reporting a markup bug that is not
     there. */
  const wrappers = nap.split('<span class="hero-spotlight__nap-text">')
    .slice(1)
    .map(chunk => chunk.split('\n      </span>')[0]);

  assert(wrappers.length === 3, `expected 3 nap-text wrappers, found ${wrappers.length}`);

  for (const [label, value] of pairs) {
    const holder = wrappers.find(w => w.includes(label));
    assert(holder, `no .hero-spotlight__nap-text contains "${label}"`);
    assert(holder.includes(value),
      `"${label}" and ${value} are not in the same .hero-spotlight__nap-text`);
  }
});

/* The stylesheet must not write the words any more. Two sources for one
 * string is how they end up disagreeing. */
check('style7.css no longer generates the label text', () => {
  const css = fs.readFileSync(path.join(__dirname, 'src/css/themes/style7.css'), 'utf8');
  const live = css.replace(/\/\*[\s\S]*?\*\//g, '');   // comments may discuss it
  for (const label of LABELS) {
    assert(!live.includes(`content: "${label}"`),
      `style7.css still has content: "${label}" — the markup has it too, so ` +
      `the page would print it twice`);
  }
});


/* -------------------------------------------------------------------------
 * fullAddress()
 * ---------------------------------------------------------------------- */

const CASES = [
  // [address, location, expected, why]
  ['1800 Sequoia Dr', 'Leander, TX', '1800 Sequoia Dr, Leander, TX',
    'a bare street gets the city and state'],
  ['1800 Sequoia Dr, Leander, TX 78641', 'Leander, TX', '1800 Sequoia Dr, Leander, TX 78641',
    'an address that is already complete is left exactly alone, ZIP included'],
  ['1800 Sequoia Dr, Leander', 'Leander, TX', '1800 Sequoia Dr, Leander, TX',
    'names the town but not the state: only the state is added'],
  ['', 'Leander, TX', 'Leander, TX',
    'no address: the location stands alone rather than printing ", Leander, TX"'],
  ['1800 Sequoia Dr', '', '1800 Sequoia Dr',
    'no location: nothing to add'],
  ['123 Maine Way', 'Portland, ME', '123 Maine Way, Portland, ME',
    'the state code ME must not be found inside the word "Maine"'],
  ['1204 Ranch Road 2243, Suite 120', 'Leander, TX', '1204 Ranch Road 2243, Suite 120, Leander, TX',
    'a suite number is not mistaken for a city'],
];

for (const [address, location, expected, why] of CASES) {
  check(`fullAddress — ${why}`, () => {
    const got = fullAddress(address, location);
    assert(got === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
  });
}

/* NEVER INVENTS A ZIP. Three of the four modes have no field holding one. */
check('fullAddress never invents a ZIP code', () => {
  const got = fullAddress('1800 Sequoia Dr', 'Leander, TX');
  assert(!/\d{5}/.test(got), `a ZIP appeared from nowhere: ${got}`);
});


/* -------------------------------------------------------------------------
 * Every builder that renders a template must fill the new placeholder
 * ---------------------------------------------------------------------- */

const BUILDERS = [
  'utils/runGeneration.js',
  'utils/buildAboutUsPage.js',
  'utils/buildContactPage.js',
  'utils/buildLocationPages.js',
];

for (const file of BUILDERS) {
  check(`${file} fills {{ADDRESS_FULL}}`, () => {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert(/\{\{ADDRESS_FULL\}\}/.test(src),
      'this builder renders a template containing {{ADDRESS_FULL}} and never ' +
      'replaces it, so the placeholder would be printed to the page verbatim');
    assert(/require\(['"]\.\/fullAddress['"]\)/.test(src),
      'uses the placeholder without requiring the composer');
  });
}


/* ---------------------------------------------------------------------- */

if (failures.length) {
  console.error(`\n  ${failures.length} failed:\n`);
  for (const [name, message] of failures) {
    console.error(`  ${name}`);
    console.error(`      ${message}\n`);
  }
  process.exit(1);
}

console.log(`\n${passed} passed, 0 failed`);
