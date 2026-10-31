// test-local-options-generate.js
//
// A business in, a whole site out — with the model stubbed.
//
// EVERY MODEL CALL IS INJECTED, AND THAT IS NOT CONVENIENCE. Seven live
// calls per run, at about 19 cents, inside ./deploy.sh, on every deploy, is
// the kind of test nobody runs twice. A suite that forgot to stub them would
// not fail loudly: it would quietly spend money.
//
// WHAT THIS ASSERTS THAT THE OTHER SUITES CANNOT. render/ is tested against
// fixtures that are already correct. This is tested against a model, and a
// model returns whatever it returns:
//
//   five sections instead of six        a page with no words, rendering 200
//   a missing "blurb"                   an empty line on the home page list
//   four service names instead of six   a ring whose fourth link 404s
//   a rate limit on page two            five more calls paid for, then a throw
//
//   node test-local-options-generate.js

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  generateLocalOptionsSite,
  checkServicePage,
  servicesFrom,
} = require('./utils/localOptions/generate');

const { SECTIONS, STANCES, servicePagePrompt } = require('./utils/localOptions/prompt');
const { SERVICE_COUNT, fileFor } = require('./utils/localOptions/render/shape');

let passed = 0, failed = 0;

async function test(name, fn) {
  try { await fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

function section(name) { console.log(`\n${name}\n`); }

/* ------------------------------------------------------------ the fixtures */

const BUSINESS = {
  name: 'Leander Plumbing Gomanzo',
  trade: 'plumbing',
  city: 'Leander',
  state: 'TX',
  street: '1804 S Bagdad Rd',
  zip: '78641',
  phone: '(512) 555-0164',
  tel: '+15125550164',
};

const NAMES = [
  'Water Heater Repair', 'Drain Cleaning', 'Leak Detection',
  'Toilet Repair', 'Sewer Line Repair', 'Whole House Repiping',
];

const SITE = 'https://leander-plumbing.gomanzo.com';

/* A trade folder with all four pictures, so heroFiles has something real. */
const IMAGES = fs.mkdtempSync(path.join(os.tmpdir(), 'localoptions-gen-'));
fs.mkdirSync(path.join(IMAGES, 'plumbing'), { recursive: true });
for (let n = 1; n <= 4; n += 1) {
  fs.writeFileSync(path.join(IMAGES, 'plumbing', `hero-${n}.webp`), Buffer.from(`img${n}`));
}
fs.writeFileSync(path.join(IMAGES, 'plumbing', 'alt.json'),
  JSON.stringify({ cover: 4, 1: 'one', 2: 'two', 3: 'three', 4: 'four' }));

/** A service page the renderer will accept. */
function goodService(label) {
  return {
    h1: `${label} in Leander, TX`,
    title: `${label} | Leander Plumbing`,
    meta: `${label} in Leander, TX. A meta description of a believable length.`,
    blurb: `One line about ${label.toLowerCase()}.`,
    /* THE HEADINGS ARE THE MODEL'S SINCE 28 OCTOBER, so the stub invents
     * them the way a model would, and they must all differ — which is what
     * checkServicePage now enforces. This used to read `s.heading || ''`,
     * off SECTIONS, and the moment those became null the whole stub returned
     * five blank headings. It would still have passed every test in this
     * file: a page with no h2 anywhere in it renders 200. */
    sections: SECTIONS.map((s, i) => ({
      heading: s.headingJob ? `A heading for section ${i + 1}` : '',
      paragraphs: [`Paragraph for ${label} section ${i + 1}, with a trap and a wrench in it.`],
    })),
  };
}

const GOOD_HOME = {
  h1: 'Plumbing repair and installation in Leander, TX',
  sub: 'Same-week appointments across Leander and Cedar Park.',
  title: 'Leander Plumbing Gomanzo | Plumbing in Leander, TX',
  meta: 'Plumbing repair and installation in Leander, TX, with same-week visits.',
  aboutHeading: 'A local plumbing company in Leander, TX',
  about: ['First.', 'Second.', 'Third.'],
};

/**
 * A stubbed model, recording what it was asked.
 *
 * `fail` NAMES A LABEL, NOT A CALL NUMBER.
 *
 * The first version of this threw when `fail === calls.length`, which can
 * only ever match once: a retry of page two is call three, so the condition
 * stops being true the moment it is retried. Both "keeps failing" tests
 * passed a failTimes of 99 and got exactly one failure — the stub was
 * describing a transient error while the test's name said otherwise.
 *
 * Keyed by label, a page fails as many times as it is asked.
 */
function stub({ fail = null, give = {}, failTimes = 1 } = {}) {
  const calls = [];
  let failures = 0;

  const ask = async ({ system, user, label }) => {
    calls.push({ system, user, label });

    if (fail === label && failures < failTimes) {
      failures += 1;
      const err = new Error('429 rate limit');
      err.status = 429;
      throw err;
    }

    if (Object.prototype.hasOwnProperty.call(give, label)) {
      return { data: give[label], usage: { prompt_tokens: 100, completion_tokens: 200 } };
    }

    const data = 'home page' === label ? GOOD_HOME : goodService(label);

    return { data, usage: { prompt_tokens: 100, completion_tokens: 200 } };
  };

  return { ask, calls };
}

const base = (over = {}) => ({
  business: BUSINESS,
  url: SITE,
  serviceNames: NAMES,
  areas: ['Leander', 'Cedar Park'],
  hours: [{ day: 'Monday', open: '7:00 AM – 6:00 PM' }, { day: 'Sunday', open: null }],
  imagesRoot: IMAGES,
  now: new Date('2026-10-28T00:00:00Z'),
  ...over,
});

(async () => {

/* ------------------------------------------------------------------------ */

section('A WHOLE SITE, FROM ONE CALL');

await test('SEVEN MODEL CALLS: six service pages and the home page', async () => {
  const { ask, calls } = stub();

  await generateLocalOptionsSite(base({ ask }));

  assert.strictEqual(calls.length, 7);
  assert.strictEqual(calls.filter(c => 'home page' === c.label).length, 1);
});

/* THE SHAPE suggestServices ACTUALLY RESOLVES TO.
 *
 * { services, dropped, usage } — NOT the array. Every stub below returns
 * this, and that is the whole point: the stubs here USED TO RETURN THE BARE
 * ARRAY, which made the suite agree with a misreading instead of with the
 * real function. The build failed on Edwin's machine with "expected 6
 * services, got 0" while all 21 of these passed.
 *
 * A STUB IS A CLAIM ABOUT A CONTRACT. Nothing was checking the claim, so the
 * test below checks it against the real function. */
const suggestedShape = (services = NAMES) => ({ services, dropped: [] });

await test('and suggestServices is NOT called when the names are given', async () => {
  /* A seventh call nobody asked for, on every build, is a cost nobody sees
   * until the bill. */
  const { ask } = stub();
  let suggested = 0;

  await generateLocalOptionsSite(base({
    ask,
    suggest: async () => { suggested += 1; return suggestedShape(); },
  }));

  assert.strictEqual(suggested, 0);
});

await test('but IS called when they are not', async () => {
  const { ask } = stub();
  let asked = null;

  await generateLocalOptionsSite(base({
    ask,
    serviceNames: null,
    suggest: async (ctx) => { asked = ctx; return suggestedShape(); },
  }));

  assert.strictEqual(asked.businessType, 'plumbing');
  assert.strictEqual(asked.location, 'Leander, TX');
});

await test('THE SUGGESTER CONTRACT, AGAINST THE REAL FUNCTION', async () => {
  /* The test that would have caught it, and the only kind that could: the
   * stubs above cannot disagree with the code, because I wrote both from
   * the same assumption.
   *
   * suggestServices takes { stub: true } — it skips the API call and returns
   * its real shape from a built-in list. No tokens, no network, and the
   * contract is the genuine one. */
  const { suggestServices } = require('./utils/suggestServices');

  const real = await suggestServices(
    { businessType: 'plumbing', location: 'Leander, TX' },
    { count: SERVICE_COUNT, stub: true }
  );

  assert.ok(!Array.isArray(real), 'suggestServices now resolves to an array');
  assert.ok(Array.isArray(real.services), 'it no longer carries a services array');
  assert.strictEqual(real.services.length, SERVICE_COUNT);

  /* WHAT THE OLD CODE DID WITH IT. Array.from on an object with no length
   * and no iterator is [], silently — which is why the failure said "got 0"
   * about a call that had worked. */
  assert.deepStrictEqual(Array.from(real), []);

  /* AND THE GENERATOR USES IT CORRECTLY, driven by the real function rather
   * than by a fake of it. */
  const { ask } = stub();

  const { services } = await generateLocalOptionsSite(base({
    ask,
    serviceNames: null,
    suggest: (ctx, opts) => suggestServices(ctx, { ...opts, stub: true }),
  }));

  assert.strictEqual(services.length, SERVICE_COUNT);
  assert.ok(services.every(s => s.name && s.slug), 'the names did not survive');
});

await test('and a suggester of the wrong shape fails by saying so', async () => {
  /* The bare array the stubs used to return. It must not fall through to
   * "expected 6 services, got 0", which describes the symptom and hides the
   * cause. */
  const { ask } = stub();

  await assert.rejects(
    generateLocalOptionsSite(base({
      ask,
      serviceNames: null,
      suggest: async () => NAMES,
    })),
    /did not return \{ services/
  );
});

await test('FIFTEEN FILES PLUS FOUR PICTURES', async () => {
  const { ask } = stub();

  const { files } = await generateLocalOptionsSite(base({ ask }));

  assert.strictEqual(Object.keys(files).length, 19);

  for (let n = 1; n <= 4; n += 1) {
    assert.ok(Buffer.isBuffer(files[`assets/hero-${n}.webp`]), `hero-${n} is not bytes`);
  }
});

await test('and every service page is at its own slug', async () => {
  const { ask } = stub();

  const { files } = await generateLocalOptionsSite(base({ ask }));

  for (const slug of ['water-heater-repair', 'drain-cleaning', 'leak-detection',
    'toilet-repair', 'sewer-line-repair', 'whole-house-repiping']) {
    assert.ok(files[fileFor(slug)], `${slug} was not written`);
  }
});

/* ------------------------------------------------------------------------ */

section('WHAT EACH CALL IS ASKED');

await test('THE STANCE ROTATES ACROSS THE SIX', async () => {
  /* Six pages sharing one shape is six pages at risk of one opening. */
  const { ask } = stub();

  const { services } = await generateLocalOptionsSite(base({ ask }));

  assert.deepStrictEqual(services.map(s => s.stance),
    STANCES.slice(0, SERVICE_COUNT).map(s => s.id));
});

await test('each page is told about the other five, and not itself', async () => {
  const { ask, calls } = stub();

  await generateLocalOptionsSite(base({ ask }));

  const first = calls.find(c => 'Water Heater Repair' === c.label);

  assert.ok(first.user.includes('Drain Cleaning'));
  assert.ok(!/THE OTHER PAGES ON THIS SITE:[^\n]*Water Heater Repair/.test(first.user));
});

await test('and the home page is told the six without being asked to explain them', async () => {
  const { ask, calls } = stub();

  await generateLocalOptionsSite(base({ ask }));

  const home = calls.find(c => 'home page' === c.label);

  assert.ok(home.user.includes('Drain Cleaning'));
  assert.ok(/Do not describe any of them/.test(home.user));
});

await test('THE PROMPT NO LONGER DICTATES A SINGLE HEADING', async () => {
  /* A PROMPT THAT QUOTES THE OUTPUT IT WANTS GETS THAT OUTPUT, SIX TIMES.
   * The same lesson as the closing sentence that appeared verbatim on all
   * six pages of the 28 October run — this is it applied to the h2s, which
   * is the part a skimmer actually reads.
   *
   * ASSERTED AGAINST THE PROMPT TEXT, not against SECTIONS. Reading the
   * headings back out of the same array the prompt is built from would pass
   * whatever that array said. */
  const { ask, calls } = stub();

  await generateLocalOptionsSite(base({ ask }));

  const page = calls.find(c => 'Drain Cleaning' === c.label);
  const whole = `${page.system}\n${page.user}`;

  for (const dictated of [
    'What people call about',
    'What the visit involves',
    'What affects the cost',
    'What to have ready when you call',
  ]) {
    assert.ok(!whole.includes(dictated),
      `the prompt still hands the model the heading "${dictated}"`);
  }

  /* AND IT ASKS FOR THEM, which is the half that would otherwise go
   * missing: a prompt that merely stopped naming them would get a page with
   * no headings at all. */
  assert.ok(/THE HEADINGS ARE YOURS TO WRITE/.test(page.system));
  assert.strictEqual((page.user.match(/HEADING — write one yourself/g) || []).length, 4);
  assert.ok(page.user.includes('NO HEADING'), 'the opening is not told to go without one');

  /* AND THE RULE THAT MAKES THEM WORTH HAVING. Without the concrete-noun
   * requirement the first run returned five headings that were restatements
   * of their own briefs — different on every page, and saying nothing on
   * any of them. "Not dictated" turned out not to mean "good". */
  assert.ok(/CARRIES AT LEAST ONE CONCRETE NOUN/.test(page.system),
    'the concrete-noun rule is gone');
});

await test('THE TOWN AND THE STATE ARE REQUIRED IN THE TITLE AND THE DESCRIPTION', async () => {
  /* Edwin read the <head> of a built home page on 28 October:
   *
   *     <title>Quality Plumbing Leander | Plumbing Repairs</title>
   *
   * The town is in it — as part of the company's NAME, which is not the
   * same as the page saying where the work happens — and the state is
   * nowhere on either of the page's two most-read lines.
   *
   * BOTH PROMPTS, because the home page is the one that was wrong and the
   * service pages only happened to be right. A rule that holds by habit on
   * six pages and by accident on the seventh is not a rule. */
  const { ask, calls } = stub();

  await generateLocalOptionsSite(base({ ask }));

  for (const label of ['Drain Cleaning', 'home page']) {
    const { system } = calls.find(c => label === c.label);

    assert.ok(system.includes('"Leander, TX"'),
      `the ${label} prompt does not require the place`);

    assert.ok(/THE TITLE AND THE META DESCRIPTION BOTH CARRY/.test(system),
      `the ${label} prompt does not say where it goes`);
  }
});

await test('and a business with no town gets no rule about one', () => {
  /* placeRule() returns '' rather than a sentence with an empty quotation
   * in it. The same bug as the `'' !== line || true` filter further down
   * this file's subject: an instruction about nothing is still an
   * instruction, and the model will try to obey it. */
  const { system } = servicePagePrompt({
    business: { name: 'x', trade: 'plumbing' },
    service: { slug: 'drain-cleaning', name: 'Drain Cleaning' },
    index: 0,
  });

  assert.ok(!/MUST name ,/.test(system), 'an empty place reached the prompt');
  assert.ok(!/BOTH CARRY ""/.test(system));
});

await test('AND THE JSON TEMPLATE IS STILL VALID JSON', () => {
  /* THE RULE IS INTERPOLATED INSIDE A JSON STRING VALUE. The first version
   * put the place in double quotes, which closed the value early and left
   * the model an example that is not JSON while the line above it demands
   * JSON. Nothing would have failed loudly — a model usually recovers — and
   * the recovery is a page that comes back in some other shape. */
  const { system } = servicePagePrompt({
    business: { name: 'x', trade: 'plumbing', city: 'Leander', state: 'TX' },
    service: { slug: 'drain-cleaning', name: 'Drain Cleaning' },
    index: 0,
  });

  const template = system.slice(system.indexOf('{'), system.lastIndexOf('}') + 1);

  assert.doesNotThrow(() => JSON.parse(template),
    'the JSON the model is shown does not parse');
});

await test('and it never quotes a heading, not even to forbid one', () => {
  /* THIS IS WHY THE BAN LIST BECAME A PATTERN. A bullet naming the eight
   * headings the first run produced read perfectly well and tripped the
   * assertion above — the suite cannot tell a banned quotation from a
   * dictated one, and it is right not to try. Anything that needs to
   * describe a bad heading describes its SHAPE. */
  const { system, user } = servicePagePrompt({
    business: { name: 'x', trade: 'plumbing', city: 'Leander', state: 'TX' },
    service: { slug: 'drain-cleaning', name: 'Drain Cleaning' },
    index: 0,
  });

  assert.ok(!/"What [a-z]/.test(`${system}\n${user}`),
    'the prompt quotes a heading somewhere');
});

/* ------------------------------------------------------------------------ */

section('A MODEL THAT ANSWERS BADLY');

await test('A PAGE MISSING A KEY IS REFUSED, NOT RENDERED', async () => {
  /* `undefined` in a template prints nothing. A page with no `sections`
   * renders as a hero, a heading and silence — a 200 that looks almost
   * right, which is the hardest kind of broken to notice. */
  const bad = goodService('Drain Cleaning');
  delete bad.blurb;

  const { ask } = stub({ give: { 'Drain Cleaning': bad } });

  await assert.rejects(
    generateLocalOptionsSite(base({ ask })),
    /left out blurb/
  );
});

await test('AND SO IS THE WRONG NUMBER OF SECTIONS', async () => {
  const short = goodService('Leak Detection');
  short.sections = short.sections.slice(0, 2);

  const { ask } = stub({ give: { 'Leak Detection': short } });

  await assert.rejects(
    generateLocalOptionsSite(base({ ask })),
    /expected 5 sections, got 2/
  );
});

await test('checkServicePage names every missing key at once', async () => {
  /* One error per run of this means four runs to find four problems. */
  assert.throws(
    () => checkServicePage({ h1: 'x' }, 'Some Service'),
    /title, meta, blurb, sections/
  );
});

await test('A SECTION THAT CAME BACK WITH NO HEADING IS REFUSED', async () => {
  /* THE ONE THING THAT BREAKS SILENTLY NOW THAT THE HEADINGS ARE THE
   * MODEL'S. prose() in render/pages.js skips an empty heading on purpose —
   * the opening needs that — so a page whose four headings all came back
   * blank renders as nine hundred words with no h2 anywhere in it. 200, and
   * it looks like a styling bug. */
  const bald = goodService('Toilet Repair');
  bald.sections[2].heading = '   ';

  const { ask } = stub({ give: { 'Toilet Repair': bald } });

  await assert.rejects(
    generateLocalOptionsSite(base({ ask })),
    /section 3 came back with no heading/
  );
});

await test('AND SO ARE TWO SECTIONS WITH THE SAME HEADING', async () => {
  /* Which is what a model does when it runs out of ideas, and it is the
   * sameness the fixed headings produced across pages — this is the same
   * fault down one page. */
  const twice = goodService('Sewer Line Repair');
  twice.sections[3].heading = twice.sections[1].heading;

  const { ask } = stub({ give: { 'Sewer Line Repair': twice } });

  await assert.rejects(
    generateLocalOptionsSite(base({ ask })),
    /sections 2 and 4 both use the heading/
  );
});

await test('and a heading on the OPENING is refused too', async () => {
  /* The H1 is directly above it. A heading there is the "says the same thing
   * twice" shape the unheaded opening exists to avoid, and the renderer
   * would print it without complaint. */
  const extra = goodService('Leak Detection');
  extra.sections[0].heading = 'Leak detection in Leander';

  const { ask } = stub({ give: { 'Leak Detection': extra } });

  await assert.rejects(
    generateLocalOptionsSite(base({ ask })),
    /section 1 is the opening and must have no heading/
  );
});

await test('the four headings reach the page as h2s', async () => {
  /* The other end of it: checking the refusal without checking the success
   * leaves "it never renders a heading at all" passing both. */
  const { files } = await generateLocalOptionsSite(base({ ask: stub().ask }));

  const page = String(files['drain-cleaning/index.html'] || '');

  assert.ok(page, 'the service page was not written');

  const h2s = [...page.matchAll(/<h2>([^<]*)<\/h2>/g)].map(m => m[1]);

  for (let i = 2; i <= 5; i += 1) {
    assert.ok(h2s.includes(`A heading for section ${i}`), `section ${i} lost its heading`);
  }
});

/* ------------------------------------------------------------------------ */

section('SIX, OR NOTHING');

await test('FIVE SERVICE NAMES IS REFUSED BEFORE A SINGLE CALL IS MADE', async () => {
  /* The mode is a FIXED eleven-page site and the customer pays for eleven.
   * Five service pages is a different product at the same price — and the
   * ring breaks, because page four's onward link points at a directory that
   * was never written. */
  const { ask, calls } = stub();

  await assert.rejects(
    generateLocalOptionsSite(base({ ask, serviceNames: NAMES.slice(0, 5) })),
    /expected 6 services, got 5/
  );

  assert.strictEqual(calls.length, 0, 'it paid for pages before counting them');
});

await test('and more than six is trimmed rather than refused', async () => {
  /* suggestServices can return more than asked for. Seven names is not a
   * broken request, it is a list to take six from. */
  const { ask } = stub();

  const { services } = await generateLocalOptionsSite(base({
    ask, serviceNames: [...NAMES, 'Gas Line Repair'],
  }));

  assert.strictEqual(services.length, SERVICE_COUNT);
  assert.ok(!services.some(s => 'Gas Line Repair' === s.name));
});

await test('servicesFrom slugifies once, where the slug is decided', async () => {
  /* The slug is the directory, the URL, the ring position and the
   * canonical. Deriving it twice is how two of them disagree. */
  assert.deepStrictEqual(servicesFrom(['Whole House Repiping']),
    [{ slug: 'whole-house-repiping', name: 'Whole House Repiping' }]);
});

/* ------------------------------------------------------------------------ */

section('A CALL THAT FAILS');

await test('A RATE LIMIT ON PAGE TWO IS RETRIED, NOT FATAL', async () => {
  const { ask, calls } = stub({ fail: 'Drain Cleaning', failTimes: 1 });

  const { files } = await generateLocalOptionsSite(base({ ask }));

  assert.ok(files['index.html'], 'the site was not built');
  assert.strictEqual(calls.length, 8, 'the failed call was not retried');
});

await test('AND SO IS A REPLY THAT IS NOT JSON — 28 October', async () => {
  /* THE ONE THAT WAS NOT RETRIED, AND COST A WHOLE BUILD.
   *
   * A six-page run on 28 October lost a page because the model's JSON was
   * missing the "]" that closed its last array. isRetryable() reads a
   * status code or looks for network wording in the message; a bad REPLY
   * has neither, so it fell through into the bucket for a malformed
   * REQUEST — the one thing it is right never to retry.
   *
   * A bad request cannot succeed on a second attempt. A bad reply usually
   * does. They were in the same bucket. */
  let asked = 0;

  const good = stub().ask;

  const ask = async (args) => {
    asked += 1;

    if (2 === asked) {
      const err = new Error(
        'Drain Cleaning: the model did not return JSON — Expected \',\' or \']\'');

      /* SET BY THE THROWER, which is utils/localOptions/generate.js in the
       * real path. This stub stands in for it exactly. */
      err.retryable = true;

      throw err;
    }

    return good(args);
  };

  const { files } = await generateLocalOptionsSite(base({ ask }));

  assert.ok(files['index.html'], 'one bad bracket still ended the build');
  assert.strictEqual(asked, 8, 'the unparseable reply was not re-asked');
});

await test('but an unflagged failure is still fatal, as it should be', async () => {
  /* THE COMPANION. Without it, "retry everything" would pass the test
   * above — and a genuinely bad request would be sent three times,
   * costing three times as much to fail. */
  let asked = 0;

  const good = stub().ask;

  const ask = async (args) => {
    asked += 1;
    if (2 === asked) throw new Error('something that cannot be fixed by asking again');
    return good(args);
  };

  await assert.rejects(generateLocalOptionsSite(base({ ask })), /cannot be fixed/);

  assert.strictEqual(asked, 2, 'an unretryable error was retried anyway');
});

await test('AND A PAGE THAT KEEPS FAILING STOPS THE WHOLE SITE', async () => {
  /* Ten pages is not a cheaper eleven-page site. It is a ring with a hole
   * in it, sold at the price of a whole one. */
  const { ask } = stub({ fail: 'Drain Cleaning', failTimes: 99 });

  await assert.rejects(generateLocalOptionsSite(base({ ask })), /429/);
});

await test('and it stops BEFORE paying for the pages after it', async () => {
  const { ask, calls } = stub({ fail: 'Drain Cleaning', failTimes: 99 });

  await generateLocalOptionsSite(base({ ask })).catch(() => {});

  /* One success, then the retries of page two, and nothing beyond it. */
  assert.ok(calls.length < 7, `it made ${calls.length} calls past the failure`);
  assert.ok(!calls.some(c => 'Sewer Line Repair' === c.label));
});

/* ------------------------------------------------------------------------ */

section('WHAT COMES BACK');

await test('the token usage is totalled across every call', async () => {
  const { ask } = stub();

  const { usage } = await generateLocalOptionsSite(base({ ask }));

  assert.strictEqual(usage.calls, 7);
  assert.strictEqual(usage.inputTokens, 700);
  assert.strictEqual(usage.outputTokens, 1400);
});

await test('AND A TRADE WITH NO PICTURES STILL PRODUCES A SITE', async () => {
  /* Eleven pages of written, billed-for content must not be withheld
   * because a photograph was absent. */
  const { ask } = stub();

  const { files, heroes } = await generateLocalOptionsSite(base({
    ask, business: { ...BUSINESS, trade: 'roofing' },
  }));

  assert.strictEqual(heroes.found.length, 0);
  assert.strictEqual(heroes.missing.length, 4);
  assert.ok(files['index.html']);
  assert.strictEqual(Object.keys(files).length, 15);
});

await test('a business with no trade is refused before anything is spent', async () => {
  const { ask, calls } = stub();

  await assert.rejects(
    generateLocalOptionsSite(base({ ask, business: { name: 'X' } })),
    /trade is required/
  );
  assert.strictEqual(calls.length, 0);
});

await test('and so is one with no url — the canonical has nothing to name', async () => {
  const { ask } = stub();

  await assert.rejects(
    generateLocalOptionsSite(base({ ask, url: '' })),
    /url is required/
  );
});

/* ------------------------------------------------------------------------ */

fs.rmSync(IMAGES, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

})();
