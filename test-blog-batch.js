// test-blog-batch.js
//
// The write-ahead batch: one job writing a whole campaign.
//
//   MONGO_URI=... node test-blog-batch.js
//
// NEEDS A DATABASE. Everything here turns on conditional updates — charge
// once, claim once, stop cleanly — and a mock of Mongo would only prove that
// the mock agrees with itself. It creates its own throwaway user, site and
// campaigns, and deletes them at the end.
//
// THE MODEL IS STUBBED, NOTHING ELSE IS.
//
// writePost() is the one function here that calls OpenAI. It is replaced
// through the require cache before blogGenerator loads, which keeps the stub
// out of the shipped code — an env var that silently swaps real posts for fake
// ones is one typo away from charging a customer 900 credits for twelve pages
// of filler.
//
// Everything else is the real thing: the real claim, the real charge, the real
// BlogPost writes, the real quality check, the real link repair.

const assert = require('assert');
const mongoose = require('mongoose');

if (!process.env.MONGO_URI) {
  console.log('\ntest-blog-batch: set MONGO_URI to run this.\n');
  process.exit(0);
}

/* -------------------------------------------------------------------------
 * The stub, installed before anything requires the real one
 * ---------------------------------------------------------------------- */

const writePostPath = require.resolve('./utils/blog/writePost');
const realWritePost = require(writePostPath);

// How the next writes should behave. Set per test.
//
// These are read INSIDE the stub, at call time, and that is deliberate.
// blogGenerator destructures writePost at module load, so it holds a reference
// to whatever function was in the cache at that moment — swapping the cache
// entry later changes nothing. The stub has to be one stable function whose
// behaviour is steered from outside.
let failOn = new Set();          // slot indexes whose write always throws
let failOnce = new Set();        // slot indexes that throw once, then succeed
let identicalOpenings = false;   // make every post start the same way
const writeCalls = [];           // every slot the model was asked for

/**
 * Sentences carrying measurable detail, varied by slot.
 *
 * THE NUMBERS ARE NOT DECORATION. qualityCheck's specificity() counts units,
 * money and bare numbers per hundred words and fails a post under one marker
 * per hundred as `vague`. A fixture of flat prose fails that check, and a
 * fixture that fails a check is a fixture that cannot tell you anything about
 * the code around the check.
 *
 * VARIED BY SEED so crossCheck's repeated-sentence count stays low. The
 * `varied posts produce a clean report` test asserts zero duplicate openings
 * and would be asserting nothing if every post were word-for-word identical.
 */
function detailLines(seed) {
  return [
    `A 40 gallon tank holds roughly ${300 + seed} pounds of water once full, and the floor under it was rated for that load when the house was built.`,
    `Most residential units run between ${40 + seed} and ${80 + seed} psi, and a reading outside that band points at the regulator rather than the tank.`,
    `Sediment settles at about ${1 + (seed % 3)} inch per ${3 + (seed % 4)} years in hard water, which is why the burner works harder each winter.`,
    `A technician will usually drain ${2 + seed} gallons before the water runs clear, and that alone tells you how long it has been since the last service.`,
    `Set the thermostat to 120 degrees rather than ${130 + seed}, and the standby loss drops by a measurable amount over ${12 + seed} months.`,
    `Anode rods are consumed in ${4 + (seed % 5)} to ${7 + (seed % 5)} years depending on the water, and replacing one costs a fraction of replacing a tank.`,
    `A relief valve is rated at 150 psi and ${210 - seed} degrees, and it is the one part on the unit that nobody should test twice in a week.`,
    `Expect ${10 + seed} to ${14 + seed} years from a standard unit in this area, and rather less where the water sits above ${7 + (seed % 3)} grains of hardness.`,
    // RAW SEED, NOT seed % 4. Every line here needs at least one number that
    // moves with the raw seed, or two slots of a five-post campaign produce a
    // word-for-word identical sentence. These two were the last pair.
    `The draw on a 4500 watt element is about ${18 + seed} amps, so a circuit shared with anything else will trip before the tank is at temperature.`,
    `A drip of ${1 + (seed % 2)} gallon an hour is ${24 + seed} gallons a day, which is the point at which a slow leak stops being cosmetic.`,
    `Recovery on a gas unit runs near ${30 + seed} gallons an hour at a ${90 - seed} degree rise, and that number is what sizing actually turns on.`,
    `Flushing takes ${20 + seed} minutes and needs ${5 + (seed % 3)} feet of hose, and skipping it for ${3 + (seed % 3)} years is what turns a service call into a replacement.`,
    `A dip tube that has cracked will cut usable capacity by ${20 + seed} percent, and the symptom is hot water that runs out ${4 + (seed % 4)} minutes early.`,
    `Thermal expansion adds ${2 + seed} to ${5 + seed} percent to the volume in the tank, and a closed system with no outlet puts that straight into the fittings.`,
    `A gas unit needs ${50 + seed} cubic feet of combustion air per 1000 btu, and a sealed closet built in ${1995 + seed} rarely provides it.`,
    `Vent pipe should rise ${1 + (seed % 2)} inch per ${4 + (seed % 3)} feet of run, and a sagging section is where condensate collects and rusts through.`,
    `Hard water above ${10 + (seed % 5)} grains cuts element life by roughly ${30 + seed} percent, which is the single biggest local factor in these numbers.`,
    `A mixing valve set at ${120 + (seed % 5)} degrees lets the tank run at ${140 + (seed % 5)} safely, which buys about ${15 + seed} percent more usable hot water.`,
    `Insulating ${6 + (seed % 4)} feet of exposed pipe saves a few dollars a month and costs about $${20 + seed} in materials.`,
    `A pan under the tank with a ${1 + (seed % 2)} inch drain line is required in ${38 + (seed % 3)} states for an interior installation.`,
    `Expect ${2 + (seed % 2)} to ${4 + (seed % 2)} hours of labour for a straight swap, and rather more where the shutoff has seized after ${12 + seed} years.`,
    `A tankless unit needs ${150 + seed} to ${199 + seed} thousand btu to serve ${3 + (seed % 3)} fixtures at once, which is why a straight swap is rarely straight.`,
    `Water at ${55 + seed} degrees entering in January versus ${75 + seed} in July changes recovery by about ${25 + seed} percent, and sizing done in summer shows it.`,
    `A burner firing for more than ${45 + seed} minutes to recover ${30 + seed} gallons is either undersized or sitting on ${2 + (seed % 3)} inches of sediment.`,
    `Replacing a thermocouple runs about $${90 + seed} fitted, against $${1400 + seed * 10} for a full replacement, and the choice usually turns on the age above.`,
    `Sign off adds $${75 + seed} and ${2 + (seed % 3)} days in most areas here, and a swap done without it is the first thing an inspector finds at sale.`,
    `Earthquake strapping is two bands at ${1 + (seed % 2)} third and ${2 + (seed % 2)} thirds of the tank height, and it takes about ${25 + seed} minutes to fit.`,
    `Flex connectors are rated for ${15 + seed} years but fail sooner within ${6 + (seed % 4)} inches of a hard bend, which is where most of them are installed.`,
    `A drain valve made of plastic will usually seize after ${5 + (seed % 4)} years, and swapping it for brass costs about $${14 + seed}.`,
    `Standby loss on an uninsulated tank runs near ${1 + (seed % 2)} kilowatt hour a day, which is ${350 + seed} kilowatt hours over a year.`,
    `A recirculation pump on a ${20 + seed} minute timer uses far less than one left running ${24 - (seed % 3)} hours, and the comfort difference is small.`,
    `Element resistance should read between ${10 + seed} and ${16 + seed} ohms cold, and anything open means the element rather than the thermostat.`,
    `A thermostat out of calibration by ${8 + (seed % 5)} degrees will short cycle the burner ${3 + (seed % 3)} times an hour and sound exactly like sediment.`,
    `Gas pressure should sit at ${3 + (seed % 2)} point ${5 - (seed % 3)} inches of water column, and a long ${40 + seed} foot run undersized by one pipe size will not hold it.`,
    `Condensate from a high efficiency unit runs about ${1 + (seed % 2)} gallon per ${100 + seed} thousand btu burned, and it is acidic enough to need neutralising.`,
    `Warranty on the tank is typically ${6 + (seed % 4)} years and on labour ${1 + (seed % 2)}, and the difference is where most disputes at year ${7 + (seed % 3)} come from.`,
    `Budget $${1800 + seed * 10} to $${2600 + seed * 10} installed for a like for like unit in this market, and about ${30 + seed} percent more for a vented upgrade.`,
  ];
}

/* THE OPENING IS SIX WORDS LONG, AND THAT IS THE WHOLE KEY.
 *
 * crossCheck() reduces a post's opening to
 *
 *     first[0].toLowerCase().split(' ').slice(0, 6).join(' ')
 *
 * Six words. Nothing after them counts. On 25 October this stub opened every
 * post with "A tank that has run for N years…" — varied by a number in the
 * SEVENTH word — and `varied posts produce a clean report` reported three
 * duplicate openings out of four posts that were, to the eye, all different.
 * The assertion was right and the fixture was wrong.
 *
 * SO THE STEMS DIFFER IN THEIR FIRST WORDS, NOT IN THEIR DIGITS. Seven of
 * them, indexed by slot, which is more than any campaign in either suite.
 */
const OPENINGS = [
  (n) => `Nobody calls about this until the hot water runs out mid-shower, which is usually ${8 + n} years into the tank's life.`,
  (n) => `The noise comes first, weeks before anything else, and by then there are ${1 + (n % 3)} inches of sediment sitting on the burner.`,
  (n) => `Most of these units fail on a Sunday, about ${10 + n} years after installation, and never during a scheduled service visit.`,
  (n) => `Water heaters give warning signs for ${6 + n} months before they leak, and almost nobody is looking for any of them.`,
  (n) => `There is a measurable difference between a tank at ${8 + n} years and one at ${14 + n}, and it is not subtle.`,
  (n) => `By the time a tank is ${12 + n} years old the question has changed from repair to replacement, whatever the symptom was.`,
  (n) => `Sediment, pressure and age explain nearly all of it, and each one leaves a number you can read off a gauge.`,
];

/* The money sentence, varied for the same reason one step down.
 *
 * It is not an opening, so it cannot move dupOpenings — but an identical
 * sentence in every post of a campaign IS a repeat, and a test called
 * `varied posts produce a clean report` should be able to mean the word clean.
 */
const MONEY_LINES = [
  (a) => `Past a certain point a {{money}}${a}{{/money}} is the practical next step, and the numbers above are how you know you have reached it.`,
  (a) => `Once two or three of those readings land badly, a {{money}}${a}{{/money}} stops being the optional answer.`,
  (a) => `The threshold where a {{money}}${a}{{/money}} makes more sense than another part is further down this page.`,
  (a) => `Anyone weighing a {{money}}${a}{{/money}} against another season of patching should start with the pressure reading.`,
  (a) => `A {{money}}${a}{{/money}} booked before the tank fails costs a fraction of the same work booked after.`,
  (a) => `None of this replaces a {{money}}${a}{{/money}} by somebody who can see the unit, but it tells you what to ask for.`,
  (a) => `When the numbers above stack up together, a {{money}}${a}{{/money}} is the cheaper of the two remaining paths.`,
];

/**
 * A post that PASSES the quality gate, carrying every token the slot demands.
 *
 * THE FIXTURE USED TO FAIL THE GATE, AND THAT IS WHAT BROKE THREE TESTS.
 *
 * Until 25 October this stub returned sixty words of flat prose with no
 * keyword and no numbers. qualityCheck() failed it as `short`, `keyword-meta`,
 * `keyword-heading` and `keyword-body` — all four of which are in
 * REWRITE_WORTHY — so blogGenerator did exactly what it is built to do and
 * asked the model a SECOND time for every single post.
 *
 * The three tests that count model calls therefore read double: 4 instead of
 * 2, 6 instead of 4, 2 instead of 1. Nothing was wrong with the code. The
 * fixture was asking the generator to behave abnormally and then asserting it
 * had behaved normally.
 *
 * THE FIX IS THE FIXTURE, NOT THE EXPECTED NUMBERS. Changing 2 to 4 would
 * have made the suite green and thrown away the only assertion standing
 * between a customer and being charged twice — and it would have broken again
 * the next time the quality rules moved.
 *
 * WHAT THE GATE WANTS, and every line below exists to satisfy one of them:
 *
 *   - 850+ words          boundsFor(undefined) → LEGACY.floor
 *   - keyword in title    includes(keyword, title)
 *   - keyword in meta     includes(keyword, metaDescription)
 *   - keyword in a heading
 *   - keyword exactly ONCE in the body, anchors stripped
 *   - every anchor VERBATIM inside its wrapper
 *   - no two link phrases in one paragraph
 *   - at least one concrete marker per hundred words
 *   - a distinct opening, which is SIX WORDS — see OPENINGS below
 *
 * FROM slot.targetQuery, NOT slot.topic. They are the same string in this
 * file's fixture and DIFFERENT in test-blog-routes.js, where the topics carry
 * a separate targetQuery. A stub titling from `topic` passes here and fails
 * there, which is the kind of difference a shared stub should not have.
 */
function qualityPost(slot, opening) {
  const keyword = String(slot.targetQuery || slot.topic || '').trim();
  const lines = detailLines(Number(slot.index) % 7);

  const sections = [
    /* THE MONEY LINK BELONGS IN SECTION 0. linkSpread() warns when it is not
     * in the opening section, and one paragraph per link phrase keeps
     * `links-crowded` — a failure, and rewrite-worthy — off the report. */
    {
      heading: null,
      paragraphs: [
        opening,
        ...lines.slice(0, 3),
        MONEY_LINES[Number(slot.index) % MONEY_LINES.length](
          slot.money ? slot.money.anchor : 'a repair'),
      ],
    },
    {
      // The keyword's heading. Headings are not counted as body, so this does
      // not spend the single body mention the rule allows.
      heading: `What ${keyword} actually tells you`,
      paragraphs: [
        `The short answer to ${keyword} is that it is a symptom with a measurable cause, not a verdict on the appliance.`,
        ...lines.slice(3, 7),
      ],
    },
    { heading: 'What a service call looks for', paragraphs: lines.slice(7, 14) },
    { heading: 'When replacement is the cheaper answer', paragraphs: lines.slice(14) },
  ];

  if (slot.prevAnchor) {
    sections.push({
      heading: 'Covered earlier',
      paragraphs: [`We went through {{prev}}${slot.prevAnchor}{{/prev}} already, and the same thresholds apply there.`],
    });
  }

  if (slot.nextAnchor) {
    sections.push({
      heading: 'Worth reading next',
      paragraphs: [`This is where people start weighing up {{next}}${slot.nextAnchor}{{/next}} instead of another repair.`],
    });
  }

  return {
    title: `${keyword}: what the numbers say`,
    // Does not open on the title's first thirty characters, which would earn
    // a `meta description restates the title` warning.
    metaDescription: `A measured look at ${keyword}, with the pressures, temperatures and service intervals that decide whether to repair or replace.`,
    sections,
  };
}

function fakeWritePost(slot) {
  writeCalls.push(slot.index);

  if (failOn.has(slot.index)) {
    throw new Error(`stub: refusing to write slot ${slot.index}`);
  }

  // Transient: fails the first attempt, succeeds on the retry.
  if (failOnce.has(slot.index)) {
    failOnce.delete(slot.index);
    throw new Error(`stub: transient failure on slot ${slot.index}`);
  }

  const opening = identicalOpenings
    ? 'Every one of these posts opens with exactly the same sentence, which is the thing crossCheck exists to notice.'
    : OPENINGS[Number(slot.index) % OPENINGS.length](Number(slot.index));

  return Promise.resolve(qualityPost(slot, opening));
}

require.cache[writePostPath] = {
  id: writePostPath,
  filename: writePostPath,
  loaded: true,
  exports: { ...realWritePost, writePost: fakeWritePost },
};

/* -------------------------------------------------------------------------
 * Now the real modules, which will pick up the stub
 * ---------------------------------------------------------------------- */

const User = require('./models/User');
const Job = require('./models/Job');
const BlogSite = require('./models/BlogSite');
const BlogCampaign = require('./models/BlogCampaign');
const BlogPost = require('./models/BlogPost');
const { writeCampaign } = require('./utils/blogGenerator');
const { CREDITS_PER_POST } = require('./utils/blogPricing');

let passed = 0, failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { console.log(`  ok    ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}

const TOPICS = [
  'why a water heater rumbles',
  'how long a water heater lasts',
  'what a thermal expansion tank does',
  'when a pilot light keeps going out',
  'signs a tank is about to leak',
];

/** The same progress handler jobRunner gives a generator. */
function progressWriter(job) {
  return async function onProgress({ done, total, current, stage, completedPage, skippedPage }) {
    const set = {};
    if (typeof done === 'number') set['progress.done'] = done;
    if (typeof total === 'number') set['progress.total'] = total;
    if (current !== undefined) set['progress.current'] = current;
    if (stage !== undefined) set['progress.stage'] = stage;

    const update = { $set: set };
    if (completedPage) update.$addToSet = { completedPages: completedPage };
    if (skippedPage) update.$push = { skippedPages: skippedPage };

    await Job.updateOne({ _id: job._id }, update);
  };
}

(async () => {

await mongoose.connect(process.env.MONGO_URI);

const made = { users: [], sites: [], campaigns: [], jobs: [] };

async function seed({ credits = 10000, slots = 5, status = 'draft' } = {}) {
  const user = await User.create({
    email: `batch-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.invalid`,
    // THE FIELD IS passwordHash, AND THIS FIXTURE LEARNED IT THE HARD WAY.
    //
    // Written 3 September with `password`. models/User.js was renamed two days
    // later and this line was not, so every test in the file died inside
    // seed() for seven weeks — unnoticed, because nothing ever ran the file.
    // A test nobody runs is a test that rots silently.
    //
    // The value is a bcrypt-length string. Nothing here checks a password.
    passwordHash: 'x'.repeat(60),
    credits,
  });
  made.users.push(user._id);

  const site = await BlogSite.create({
    user: user._id,
    licenceKeyHash: require('crypto').randomBytes(32).toString('hex'),
    secret: require('crypto').randomBytes(32).toString('hex'),
    siteUrl: 'example.invalid',
    status: 'active',
    business: { name: 'Hill Country Plumbing', type: 'plumber', location: 'Leander, TX' },
  });
  made.sites.push(site._id);

  const campaign = await BlogCampaign.create({
    user: user._id,
    site: site._id,
    name: 'batch test',
    targetPage: {
      url: 'https://example.invalid/water-heater-repair.html',
      keyword: 'water heater repair',
      intent: 'Someone whose water heater has stopped working.',
    },
    status,
    slots: TOPICS.slice(0, slots).map((topic, i) => ({
      index: i,
      topic,
      targetQuery: topic,
      linkPhrase: topic,
      slug: `post-${i}`,
      moneyAnchor: 'water heater repair',
      anchorType: 'semantic',
      status: 'pending',
      publishAt: new Date(Date.now() + (i + 1) * 7 * 86400000),
    })),
  });
  made.campaigns.push(campaign._id);

  const job = await Job.create({
    user: user._id,
    kind: 'blog',
    status: 'running',
    payload: { campaignId: String(campaign._id) },
    progress: { total: slots, done: 0, stage: 'queued', current: '' },
  });
  made.jobs.push(job._id);

  return { user, site, campaign, job };
}

function reset() {
  failOn = new Set();
  failOnce = new Set();
  identicalOpenings = false;
  writeCalls.length = 0;
}

/* ====================================================================== */

console.log('\nThe happy path');

await test('writes every slot and charges exactly once per post', async () => {
  reset();
  const { user, campaign, job } = await seed({ slots: 5, credits: 10000 });

  const out = await writeCampaign(job, { onProgress: progressWriter(job) });

  assert.strictEqual(out.result.written.length, 5, 'not every slot was written');
  assert.strictEqual(out.creditsCharged, 5 * CREDITS_PER_POST);

  const after = await User.findById(user._id);
  assert.strictEqual(after.credits, 10000 - 5 * CREDITS_PER_POST,
    'the balance does not match what was reported as charged');

  const saved = await BlogCampaign.findById(campaign._id);
  assert.ok(saved.slots.every(s => s.status === 'ready'), 'some slot is not ready');
  assert.ok(saved.slots.every(s => s.chargedAt), 'a slot was written without being charged');
  assert.strictEqual(saved.status, 'active');
  assert.strictEqual(saved.batch.written, 5);
});

await test('one BlogPost per slot, with its tokens still intact', async () => {
  reset();
  const { campaign, job } = await seed({ slots: 3 });
  await writeCampaign(job, { onProgress: progressWriter(job) });

  const posts = await BlogPost.forCampaign(campaign._id);
  assert.strictEqual(posts.length, 3);
  assert.deepStrictEqual(posts.map(p => p.slotIndex), [0, 1, 2]);

  const text = posts[0].sections.flatMap(s => s.paragraphs).join('\n');
  assert.ok(/\{\{money\}\}water heater repair\{\{\/money\}\}/.test(text),
    'the money token was rendered away — the plugin can no longer link it, and ' +
    'the server must never ship finished HTML');
  assert.ok(!/<a /.test(text), 'the payload contains markup it should not');
});

await test('forward links are placeholders, because nothing is live yet', async () => {
  reset();
  const { campaign, job } = await seed({ slots: 3 });
  await writeCampaign(job, { onProgress: progressWriter(job) });

  const first = await BlogPost.forSlot(campaign._id, 0);

  assert.ok(first.targets.money.url, 'the money link must always be real');
  assert.ok(first.targets.next.pending_id,
    'slot 0 links forward to a post that is scheduled but not public — that has ' +
    'to be a placeholder, not an <a> to a URL that 404s for a week');
  assert.strictEqual(first.targets.next.pending_id, 'slot-1');
});

console.log('\nCharging, and not charging twice');

await test('a requeued job writes nothing again and charges nothing again', async () => {
  reset();
  const { user, campaign, job } = await seed({ slots: 4, credits: 10000 });

  await writeCampaign(job, { onProgress: progressWriter(job) });
  const midway = await User.findById(user._id);

  writeCalls.length = 0;
  const second = await writeCampaign(job, { onProgress: progressWriter(job) });

  assert.strictEqual(writeCalls.length, 0,
    'the model was called again for slots that were already written');
  assert.strictEqual(second.creditsCharged, 0);

  const after = await User.findById(user._id);
  assert.strictEqual(after.credits, midway.credits, 'the customer was charged twice');

  const saved = await BlogCampaign.findById(campaign._id);
  assert.strictEqual(saved.slots.filter(s => s.chargedAt).length, 4);
});

await test('a batch that runs out of credits stops where it stands', async () => {
  reset();
  // Enough for two posts and change, on a five-post campaign.
  const credits = CREDITS_PER_POST * 2 + 10;
  const { user, campaign, job } = await seed({ slots: 5, credits });

  const out = await writeCampaign(job, { onProgress: progressWriter(job) });

  assert.strictEqual(out.result.written.length, 2, `expected 2 written, got ${out.result.written.length}`);
  assert.strictEqual(out.result.stoppedForCredits, true);

  const after = await User.findById(user._id);
  assert.strictEqual(after.credits, 10, 'the balance went somewhere unexpected');
  assert.ok(after.credits >= 0, 'the balance went negative');

  // It must stop, not grind through the rest failing the same check.
  assert.strictEqual(writeCalls.length, 2,
    `the model was called ${writeCalls.length} times after the credits ran out at 2`);

  const saved = await BlogCampaign.findById(campaign._id);
  assert.strictEqual(saved.status, 'active', 'two paid-for posts must still be publishable');
  assert.strictEqual(saved.slots.filter(s => s.status === 'ready').length, 2);
  assert.strictEqual(saved.slots.filter(s => s.status === 'pending').length, 3);
});

await test('a campaign that could not afford a single post fails the job', async () => {
  reset();
  const { job } = await seed({ slots: 3, credits: 10 });

  await assert.rejects(
    () => writeCampaign(job, { onProgress: progressWriter(job) }),
    /Not enough credits/,
    'a batch that wrote nothing should fail loudly, not report success with zero posts'
  );

  const saved = await BlogCampaign.findById(made.campaigns[made.campaigns.length - 1]);
  assert.strictEqual(saved.status, 'draft',
    'a campaign that wrote nothing must go back to draft, not sit in writing forever');
});

console.log('\nWhen a post fails');

await test('one failed slot does not take the batch with it', async () => {
  reset();
  failOn = new Set([2]);

  const { campaign, job } = await seed({ slots: 5 });
  const out = await writeCampaign(job, { onProgress: progressWriter(job) });

  assert.strictEqual(out.result.written.length, 4);
  assert.deepStrictEqual(out.result.failed, [2]);

  const saved = await BlogCampaign.findById(campaign._id);
  assert.strictEqual(saved.status, 'active');
  assert.strictEqual(saved.batch.failed, 1);
});

await test('a failed slot is left failed, not pending', async () => {
  reset();
  failOn = new Set([1]);

  const { campaign, job } = await seed({ slots: 3 });
  await writeCampaign(job, { onProgress: progressWriter(job) });

  const saved = await BlogCampaign.findById(campaign._id);
  assert.strictEqual(saved.slots[1].status, 'failed',
    'a pending slot after the batch is waiting for a weekly run that no longer exists');
  assert.ok(saved.slots[1].error, 'the reason was not recorded');
});

await test('reopenSlot gives up once a slot has burned through its attempts', async () => {
  reset();
  failOn = new Set([0]);

  const { campaign, job } = await seed({ slots: 2 });
  await writeCampaign(job, { onProgress: progressWriter(job) });

  // One claim so far, so a low cap is already spent.
  assert.strictEqual(await BlogCampaign.reopenSlot(campaign._id, 0, 1), null,
    'a topic the model keeps refusing must stop costing API calls');
  assert.ok(await BlogCampaign.reopenSlot(campaign._id, 0, 3));
});

await test('a failed slot is reported on the job, the way skipped pages are', async () => {
  reset();
  failOn = new Set([1]);

  const { job } = await seed({ slots: 3 });
  await writeCampaign(job, { onProgress: progressWriter(job) });

  const saved = await Job.findById(job._id);
  assert.strictEqual(saved.skippedPages.length, 1,
    'nothing tells the customer which post is missing');
  assert.ok(saved.skippedPages[0].reason, 'the skipped entry carries no reason');
});

await test('a failed slot leaves no dangling placeholder in its neighbour', async () => {
  reset();
  failOn = new Set([2]);

  const { campaign, job } = await seed({ slots: 5 });
  await writeCampaign(job, { onProgress: progressWriter(job) });

  // Slot 1 was written BEFORE slot 2 was attempted, so at the time it was
  // written its forward link pointed at slot 2 as a placeholder.
  const before = await BlogPost.forSlot(campaign._id, 1);
  assert.ok(before, 'slot 1 should have been written');
  assert.strictEqual(before.targets.next, undefined,
    'slot 1 still points forward at a post that will never exist — that becomes ' +
    'a span in a published post that nothing can ever activate');

  assert.ok(!(before.pending || []).some(p => Number(p.slotIndex) === 2),
    'slot 1 is still waiting on slot 2');

  // Slot 3 points BACK at slot 2 and must be cleared too.
  const after = await BlogPost.forSlot(campaign._id, 3);
  assert.strictEqual(after.targets.prev, undefined,
    'slot 3 still points back at the slot that failed');

  // The money link is untouched by any of this.
  assert.ok(before.targets.money.url, 'the repair removed the money link');
});

await test('a transient failure is retried inside the run, not given up on', async () => {
  reset();
  failOnce = new Set([1]);

  const { campaign, job } = await seed({ slots: 3 });
  const out = await writeCampaign(job, { onProgress: progressWriter(job) });

  assert.strictEqual(out.result.failed.length, 0,
    'a failure that would have succeeded on a second try cost the customer a post');
  assert.strictEqual(out.result.written.length, 3);

  // Four calls for three slots: slot 1 was asked for twice.
  assert.strictEqual(writeCalls.length, 4, `expected 4 model calls, got ${writeCalls.length}`);

  const saved = await BlogCampaign.findById(campaign._id);
  assert.strictEqual(saved.slots[1].status, 'ready');
  assert.strictEqual(saved.slots.filter(s => s.chargedAt).length, 3,
    'the retried slot was charged twice');
});

console.log('\nThe set as a whole');

await test('crossCheck runs across the batch and is stored on the campaign', async () => {
  reset();
  identicalOpenings = true;

  const { campaign, job } = await seed({ slots: 4 });
  const out = await writeCampaign(job, { onProgress: progressWriter(job) });

  assert.ok(out.result.crossCheck, 'crossCheck did not run');
  assert.ok(out.result.crossCheck.dupOpenings.length > 0,
    'four posts opening with the same sentence went unnoticed — this is the check ' +
    'that could never run before, and it has to actually fire');

  const saved = await BlogCampaign.findById(campaign._id);
  assert.ok(saved.crossCheck, 'the report was not persisted');
  assert.ok(saved.crossCheck.repeats.length > 0);
});

await test('varied posts produce a clean report', async () => {
  reset();
  const { campaign, job } = await seed({ slots: 4 });
  await writeCampaign(job, { onProgress: progressWriter(job) });

  const saved = await BlogCampaign.findById(campaign._id);
  assert.strictEqual(saved.crossCheck.dupOpenings.length, 0,
    'posts with distinct openings were flagged as duplicates');
});

console.log('\nScope');

await test('a legacy single-slot job writes one slot, not the whole campaign', async () => {
  reset();
  const { user, campaign } = await seed({ slots: 5, credits: 10000 });

  // The payload an older instance would have queued.
  const legacy = await Job.create({
    user: user._id,
    kind: 'blog',
    status: 'running',
    payload: { campaignId: String(campaign._id), slotIndex: 3 },
    progress: { total: 1, done: 0, stage: 'queued', current: '' },
  });
  made.jobs.push(legacy._id);

  const out = await writeCampaign(legacy, { onProgress: progressWriter(legacy) });

  assert.deepStrictEqual(out.result.written, [3],
    'an old one-post job wrote more than one post — and charged for all of them');
  assert.strictEqual(out.creditsCharged, CREDITS_PER_POST);

  const after = await User.findById(user._id);
  assert.strictEqual(after.credits, 10000 - CREDITS_PER_POST);
});

await test('slotIndexes fills a gap without touching written slots', async () => {
  reset();
  failOn = new Set([2]);

  const { user, campaign, job } = await seed({ slots: 5, credits: 10000 });
  await writeCampaign(job, { onProgress: progressWriter(job) });

  const afterFirst = await User.findById(user._id);
  reset();

  // The batch leaves a slot it could not write as 'failed', on purpose —
  // nothing runs weekly any more, so 'pending' would mean waiting for nothing.
  // Reopening it is an explicit act, and it is the gap-fill route's job.
  const reopened = await BlogCampaign.reopenSlot(campaign._id, 2);
  assert.ok(reopened, 'reopenSlot refused a slot that failed once');

  const fill = await Job.create({
    user: user._id,
    kind: 'blog',
    status: 'running',
    payload: { campaignId: String(campaign._id), slotIndexes: [2] },
    progress: { total: 1, done: 0, stage: 'queued', current: '' },
  });
  made.jobs.push(fill._id);

  const out = await writeCampaign(fill, { onProgress: progressWriter(fill) });

  assert.deepStrictEqual(out.result.written, [2]);
  assert.strictEqual(writeCalls.length, 1, 'the fill run rewrote posts that already existed');

  const after = await User.findById(user._id);
  assert.strictEqual(after.credits, afterFirst.credits - CREDITS_PER_POST,
    'the gap fill charged for more than the one post it wrote');
});

/* ------------------------------------------------------------------ tidy */

await BlogPost.deleteMany({ campaign: { $in: made.campaigns } });
await BlogCampaign.deleteMany({ _id: { $in: made.campaigns } });
await Job.deleteMany({ _id: { $in: made.jobs } });
await BlogSite.deleteMany({ _id: { $in: made.sites } });
await User.deleteMany({ _id: { $in: made.users } });
await mongoose.disconnect();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

})();