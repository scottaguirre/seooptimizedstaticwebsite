// test-lead-scout.js
//
//   node test-lead-scout.js
//
// The lead scout's two pure halves: "is there an email on this page" and
// "how bad is this site". Both are pure functions over markup, so all of
// this runs with no network, no API key and no database.
//
// THE TWO THINGS THAT WOULD MAKE THIS TOOL WORTHLESS
//
//   1. It reports an email that is not there. The list then promises a way
//      to contact a business that cannot be contacted that way, and the
//      first ten minutes of using it are spent discovering that.
//
//   2. It scores a site badly for something untrue. The pitch is built on
//      the owner being able to check the claim in ten seconds. One wrong
//      clause and the email reads as a form letter, which it then is.
//
// So the tests are mostly NEGATIVE: the things that look like an email and
// are not, and the sites that look dated and are not.

const assert = require('assert');

const { hasEmail } = require('./utils/leadScout/findEmail');
const { scoreSite, staleCopyrightYear } = require('./utils/leadScout/scoreSite');
const { siteKey, isChain } = require('./utils/leadScout/chains');
const { judgeDesign, RUBRIC } = require('./utils/leadScout/judgeDesign');

let passed = 0;
const failures = [];

/* Some checks are async (the judge returns a promise). Results are queued
   so the output still reads top to bottom in source order. */
const pending = [];
function test(name, fn) {
  const run = async () => {
    try { await fn(); console.log(`  ok    ${name}`); passed++; }
    catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failures.push(name); }
  };
  pending.push({ name, run });
}

function section(name) { pending.push({ section: name }); }

/** A page with the given body, wrapped in enough chrome to be realistic. */
const page = body => `<!doctype html><html><head>
<meta name="viewport" content="width=device-width">
<meta name="description" content="x"><link rel="icon" href="/f.ico">
</head><body>${body}</body></html>`;


/* ===================================================================== */
section('AN EMAIL IS THERE');

test('a mailto link', () => {
  const r = hasEmail(page('<a href="mailto:office@austinspine.com">Email us</a>'));
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.how, 'mailto');
});

test('a mailto with a subject parameter', () => {
  assert.strictEqual(
    hasEmail(page('<a href="mailto:info@clinic.com?subject=Appointment">mail</a>')).found,
    true);
});

test('plain text in the footer', () => {
  const r = hasEmail(page('<footer>Call us or email frontdesk@eyecarepllc.net</footer>'));
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.how, 'text');
});

test('an address with a plus tag and a long TLD', () => {
  assert.strictEqual(
    hasEmail(page('<p>reception+new@my-clinic.physio</p>')).found, true);
});


/* ===================================================================== */
section('IT ONLY LOOKS LIKE AN EMAIL');

/* Retina image filenames are the single most common false positive on a
 * small-business site: "logo@2x.png" matches a naive email pattern exactly,
 * because "2x.png" has the shape of a domain. */
test('a retina image filename', () => {
  assert.strictEqual(
    hasEmail(page('<img src="/img/logo@2x.png"><img src="hero@3x.jpg">')).found, false);
});

test('CSS at-rules in an inline style block', () => {
  assert.strictEqual(
    hasEmail(page('<style>@media (max-width:600px){.a{color:red}} @font-face{src:url(a.woff)}</style>')).found,
    false);
});

test('a placeholder in a form', () => {
  assert.strictEqual(
    hasEmail(page('<input placeholder="you@example.com">')).found, false);
});

test('vendor keys inside a script tag', () => {
  assert.strictEqual(
    hasEmail(page('<script>var dsn="https://abc@sentry.io/42";</script>')).found, false);
});

test('an address sitting in an HTML comment', () => {
  assert.strictEqual(
    hasEmail(page('<!-- old: office@clinic.com -->')).found, false,
    'a commented-out address is not shown to a visitor');
});

test('a page with no email at all', () => {
  assert.strictEqual(
    hasEmail(page('<p>Call (512) 555-0134 or use our contact form.</p>')).found, false);
});


/* ===================================================================== */
section('IT RETURNS NO ADDRESSES');

/* THE WHOLE DESIGN IS IN THIS TEST. The tool answers whether a business can
 * be emailed; it is not allowed to accumulate the addresses. If somebody
 * later adds `address: m[0]` to the return value, this is what says no. */
test('nothing it returns ever contains an address', () => {
  const samples = [
    page('<a href="mailto:office@austinspine.com">Email</a>'),
    page('<footer>frontdesk@eyecarepllc.net</footer>'),
  ];

  for (const html of samples) {
    const r = hasEmail(html);
    const dumped = JSON.stringify(r);
    assert.ok(!dumped.includes('@'),
      `hasEmail returned something containing an address: ${dumped}. This ` +
      `module reports PRESENCE. Returning the address turns a lead list into ` +
      `a mailing list.`);
  }
});


/* ===================================================================== */
section('SCORING — IT MUST FIRE');

const bare = '<html><head><title>x</title></head><body><p>hi</p></body></html>';

test('a 2003-era site scores high', () => {
  const r = scoreSite({
    html: '<html><head><title>Clinic</title></head><body>' +
          '<font size="2">Welcome</font><center>Call us</center>' +
          '<table><tr><td>a</td></tr></table><table><tr><td>b</td></tr></table>' +
          '<table><tr><td>c</td></tr></table>' +
          '<p>&copy; 2009 The Clinic</p></body></html>',
    finalUrl: 'http://clinic.com',
    now: new Date('2026-11-05'),
  });

  for (const id of ['no-viewport', 'not-https', 'table-layout', 'ancient-tags',
                    'stale-copyright', 'no-description', 'no-schema', 'no-favicon']) {
    assert.ok(r.ids.includes(id), `missed ${id}; got ${r.ids.join(', ')}`);
  }
});

test('the copyright reason names the actual year', () => {
  const r = scoreSite({
    html: bare + '<p>Copyright 2014 Clinic</p>',
    finalUrl: 'https://c.com',
    now: new Date('2026-11-05'),
  });

  assert.ok(r.reasons.some(x => x.includes('2014')),
    `the reason must name the year so it can be quoted; got: ${r.reasons.join(' | ')}`);
});

test('phone overflow counts only when a render supplied it', () => {
  const withRender = scoreSite({
    html: bare, finalUrl: 'https://c.com', render: { overflowsAt390: true },
  });
  assert.ok(withRender.ids.includes('overflows-on-phone'));
  assert.strictEqual(withRender.measured, true);
});


/* ===================================================================== */
section('SCORING — IT MUST NOT FIRE');

test('a modern site scores zero', () => {
  const r = scoreSite({
    html: `<!doctype html><html><head>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <meta name="description" content="Chiropractic care in Austin">
      <link rel="icon" href="/favicon.ico">
      <script type="application/ld+json">{"@type":"LocalBusiness"}</script>
      </head><body><p>&copy; 2026 Austin Spine</p></body></html>`,
    finalUrl: 'https://austinspine.com',
    render: { overflowsAt390: false },
    now: new Date('2026-11-05'),
  });

  assert.strictEqual(r.score, 0, `scored ${r.score}: ${r.reasons.join(' | ')}`);
});

/* A maintained site often prints its whole life as a range. Taking the FIRST
 * year found would call "© 2008-2026" eighteen years stale and put a current
 * site at the top of the list. */
test('a copyright range is judged by its newest year', () => {
  assert.strictEqual(
    staleCopyrightYear({ html: '<p>© 2008-2026 Clinic</p>', now: new Date('2026-11-05') }),
    null);

  assert.strictEqual(
    staleCopyrightYear({ html: '<p>© 2008-2015 Clinic</p>', now: new Date('2026-11-05') }),
    2015);
});

test('last year is not stale', () => {
  assert.strictEqual(
    staleCopyrightYear({ html: '<p>© 2025</p>', now: new Date('2026-11-05') }), null,
    'a site updated last year is not a lead');
});

/* An embedded newsletter form brings a <table role="presentation"> with it,
 * and one or two tables is not a table LAYOUT. */
test('a couple of tables is not a 2003 layout', () => {
  const r = scoreSite({
    html: page('<table role="presentation"><tr><td>signup</td></tr></table>' +
               '<table><tr><td>opening hours</td></tr></table>'),
    finalUrl: 'https://c.com',
  });

  assert.ok(!r.ids.includes('table-layout'),
    'a real data table and an email-template wrapper are not a layout');
});

test('modern jQuery is not flagged', () => {
  const r = scoreSite({
    html: page('<script src="/js/jquery-3.7.1.min.js"></script>'),
    finalUrl: 'https://c.com',
  });
  assert.ok(!r.ids.includes('old-jquery'), 'jQuery 3 is current');
});

test('a broken page does not throw', () => {
  for (const html of ['', null, undefined, '<<<>>', '<html']) {
    const r = scoreSite({ html, finalUrl: 'https://c.com' });
    assert.ok(typeof r.score === 'number', `scoreSite died on ${JSON.stringify(html)}`);
  }
});


/* ===================================================================== */
section('A MISSING RENDER IS NOT A PASS');

/* The phone-overflow check needs Playwright, which is NOT a dependency of
 * this project. When it is absent the check cannot run — and a check that
 * did not run must never score the same as one that passed, or a site that
 * was never measured outranks one that was. */
test('without a render the max drops instead of the score', () => {
  const unmeasured = scoreSite({ html: bare, finalUrl: 'https://c.com' });
  const measured = scoreSite({ html: bare, finalUrl: 'https://c.com', render: { overflowsAt390: false } });

  assert.strictEqual(unmeasured.measured, false);
  assert.ok(unmeasured.max < measured.max,
    'an unmeasured site is scored out of the same total as a measured one, ' +
    'so the two are being compared as if the same checks ran');
});


/* =====================================================================
 * ONE ROW PER WEBSITE
 * ---------------------------------------------------------------------
 * The first real run — three trades in Austin, 112 sites — scanned
 * h2health.com three times and reported it as a lead three times. The
 * dedupe key was place_id, which is correct about BUSINESSES and wrong
 * about the thing being sold.
 * ================================================================== */

section('ONE ROW PER WEBSITE');

test('www and a path do not make a second site', () => {
  const keys = [
    'https://www.h2health.com/austin',
    'http://h2health.com',
    'https://h2health.com/locations/austin-tx',
  ].map(siteKey);

  assert.strictEqual(new Set(keys).size, 1, `collapsed to ${JSON.stringify(keys)}`);
});

test('different practices stay different', () => {
  assert.notStrictEqual(siteKey('https://aokpt.com'), siteKey('https://voltexpt.com'));
});

/* A subdomain is NOT folded into its parent. clinic.example.com and
 * example.com can be unrelated, and merging two practices into one lead is
 * worse than listing one twice. */
test('a subdomain is a different site from its parent', () => {
  assert.notStrictEqual(siteKey('https://austin.clinic.com'), siteKey('https://clinic.com'));
});


section('CHAINS ARE DROPPED, LOCAL PRACTICES ARE NOT');

test('the nationals from the Austin run', () => {
  for (const d of ['www.cvs.com', 'www.thejoint.com', 'www.lasikplus.com',
                   'www.americasbest.com', 'www.resultspt.com', 'www.h2health.com']) {
    assert.ok(isChain(d), `${d} should be dropped as a chain`);
  }
});

/* locations.myeyedr.com, local.targetoptical.com, stores.warbyparker.com —
 * a branch page inside a corporate site is never somebody's own website. */
test('store-finder subdomains, whatever the parent', () => {
  for (const d of ['locations.myeyedr.com', 'local.targetoptical.com',
                   'stores.warbyparker.com', 'locations.someregionalgroup.com']) {
    assert.ok(isChain(d), `${d} is a locator subdomain`);
  }
});

/* THE POINT OF THE WHOLE EXERCISE. A local practice with two or three
 * clinics is the customer most able to pay for a rebuild — it must survive
 * both the chain filter and the dedupe, as ONE lead. */
test('a local practice with several locations survives', () => {
  for (const d of ['vipchiropractic.care', 'aokpt.com', 'www.texpts.com',
                   'www.fineeyewear.net', 'theoriginway.com']) {
    assert.ok(!isChain(d), `${d} is a local practice, not a chain`);
  }
});

test('an ordinary practice site is never a chain', () => {
  for (const d of ['www.mcclellandchiro.com', 'austineyestudio.com',
                   'www.chirotexas.org', 'qveyewear.wixsite.com']) {
    assert.ok(!isChain(d), `${d} was dropped and should not have been`);
  }
});

test('junk does not throw', () => {
  for (const d of ['', null, undefined, 'not a url', 'http://']) {
    assert.doesNotThrow(() => { siteKey(d); isChain(d); }, `died on ${JSON.stringify(d)}`);
  }
});


/* =====================================================================
 * THE VISION PASS
 * ---------------------------------------------------------------------
 * A run over 77 Austin practices found NOT ONE site missing a viewport
 * tag, and six of the thirteen "leads" scored numbers only reachable
 * from signals a visitor cannot see. The markup cannot tell generic
 * from good. So the screenshots are graded and that is the sort key.
 *
 * These tests do not call the model. They pin the things that would
 * quietly ruin the ranking: a failure scoring as a zero, a score
 * escaping its range, and the rubric losing the instruction that makes
 * it reproducible.
 * ================================================================== */

section('THE VISION PASS');

test('a missing screenshot is not judged, and does not throw', async () => {
  const r = await judgeDesign({ desktopShot: '/definitely/not/here.png' });
  assert.strictEqual(r, null, 'a missing file must come back null, not a score');
});

/* AN UNJUDGED SITE IS NOT A SITE THAT PASSED. If a failure returned
 * { score: 0 } it would sort to the bottom looking like the best-designed
 * page in the list, which is the exact shape of bug this whole tool keeps
 * producing: a check that did not run reading as a check that passed. */
test('a failure never comes back as a score', async () => {
  const r = await judgeDesign({ desktopShot: '/nope.png' });
  assert.ok(r === null || typeof r.score === 'undefined' || r.error,
    `a failed judgement produced ${JSON.stringify(r)}`);
});

test('the rubric asks for observations, not a vibe', () => {
  assert.ok(/observations/.test(RUBRIC),
    'the rubric no longer asks for concrete notes, so the score cannot be checked');
  assert.ok(/Judge ONLY what you can see/i.test(RUBRIC),
    'the rubric must keep the model off speed, SEO and code quality — it is ' +
    'grading the picture');
  assert.ok(/0-10/.test(RUBRIC), 'the rubric no longer states its range');
});

/* The one thing in the rubric that is a judgement about EDWIN'S PITCH
 * rather than about design: a practice that paid a photographer has
 * something a rebuild cannot sell them. */
test('own photography counts in a site\'s favour', () => {
  assert.ok(/own photographs/i.test(RUBRIC),
    'the rubric has lost the note that real photography is a point in favour');
});


/* ---------------------------------------------------------------------- */

(async () => {
  for (const item of pending) {
    if (item.section) { console.log(`\n${item.section}\n`); continue; }
    await item.run();
  }

  if (failures.length) {
    console.error(`\n  ${failures.length} failed: ${failures.join(', ')}\n`);
    process.exit(1);
  }

  console.log(`\n${passed} passed, 0 failed\n`);
})();
