// test-home-anchors.js
//
// The anchor text every generated page uses to link to its own home page.
//
// WHY THIS EXISTS
//
// In Rank Fast the home page is the money page and the business name is the
// keyword — "Emergency Plumber Round Rock" is both at once. That makes the set
// of links pointing at './' an inbound anchor profile, planned 40% exact /
// 40% semantic / 20% descriptive.
//
// The first version of the pool was built by handing that business name to
// utils/blog/anchorPool.js, which is written for a SERVICE keyword. It
// produced, among others:
//
//     Emergency Plumber Round Rocks                 pluralised the town
//     Emergency Plumber Round Rock in Round Rock    town twice
//     Round Rock Emergency Plumber Round Rock       town twice
//     getting Emergency Plumber Round Rocks done properly
//
// Every one of those is publishable link text on a customer's live site. None
// of them would be caught by a test that checks the SHAPE of a pool — three
// buckets, non-empty, no reuse. So these tests READ THE PHRASES, which is the
// lesson test-anchor-pool.js was written for after "a plumber near mes" went
// out on a real post.
//
//   node test-home-anchors.js

const assert = require('assert');
const {
  HOME_MIX,
  buildHomeAnchorPool,
  serviceCore,
  splitLocation,
  isAgentNoun,
} = require('./utils/homeAnchorPool');
const { buildRankFastInterlinksMap, planHomeAnchors } = require('./utils/buildRankFastLinks');
const { injectPagesInterlinks } = require('./utils/injectPagesInterlinks');
const { DEFAULT_MIX } = require('./utils/blog/anchors');

let passed = 0, failed = 0;

/**
 * Queued rather than run on the spot, because some of these are async.
 *
 * The first version of this harness was the synchronous one every other suite
 * in this repo uses:
 *
 *     try { fn(); passed++; } catch (err) { failed++; }
 *
 * An async fn() returns a Promise. It does not throw, it REJECTS — so the
 * try/catch never saw a failure and every async test reported ok without
 * asserting anything. Mutation testing is what caught it: two mutations that
 * should have been impossible to miss survived, and both were covered only by
 * async tests.
 *
 * await inside the runner is what makes them real.
 */
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

async function runAll() {
  for (const [name, fn] of queue) {
    try {
      await fn();
      console.log(`  ok    ${name}`);
      passed++;
    } catch (err) {
      console.log(`  FAIL  ${name}\n        ${err.message}`);
      failed++;
    }
  }
}

const NAME = 'Emergency Plumber Round Rock';
const LOCATION = 'Round Rock, TX';

const poolFor = (businessName = NAME, location = LOCATION) =>
  buildHomeAnchorPool({ businessName, location }).pool;

const allPhrases = pool => Object.values(pool).flat();

/** Build a ring and return every link that points at the home page. */
async function homeLinks(serviceCount, locationCount = 0, globalValues = {}) {
  const pages = Array.from({ length: serviceCount }, (_, i) => ({
    filename: `service-${i + 1}.html`,
  }));
  const locations = Array.from({ length: locationCount }, (_, i) => ({
    slug: `town-${i + 1}`,
  }));

  const { interlinkMap } = await buildRankFastInterlinksMap(pages, locations, {
    businessName: NAME,
    location: LOCATION,
    domain: 'emergencyplumberroundrock.com',
    ...globalValues,
  });

  const links = [];
  for (const [from, entries] of Object.entries(interlinkMap)) {
    if (from === 'index') continue;              // home's own outbound links
    for (const entry of entries) {
      if (entry.slug === 'index') links.push({ from, ...entry });
    }
  }
  return links;
}

console.log('\nHome-page anchors\n');

/* -------------------------------------------------------------------------
 * The bugs that prompted the file
 * ---------------------------------------------------------------------- */

test('the town is never pluralised', () => {
  // "Emergency Plumber Round Rocks". pluralise() guards against a trailing
  // MODIFIER by looking for a preposition; a name ending in a place name has
  // none, so the guard never fired and the town took an s.
  for (const [name, location] of [
    [NAME, LOCATION],
    ['Round Rock Emergency Plumber', LOCATION],
    ['Water Heater Repair Leander', 'Leander, TX'],
    ['Austin Roof Replacement', 'Austin, TX'],
  ]) {
    const { town } = splitLocation(location);
    const lastWord = town.split(/\s+/).pop();
    for (const phrase of allPhrases(poolFor(name, location))) {
      assert.ok(
        !new RegExp(`\\b${lastWord}s\\b`, 'i').test(phrase),
        `"${phrase}" pluralised the town in "${name}"`
      );
    }
  }
});

test('the town never appears twice in one anchor', () => {
  // "Emergency Plumber Round Rock in Round Rock" — every town template fired
  // blind, because the town was already inside the keyword.
  for (const phrase of allPhrases(poolFor())) {
    const hits = (phrase.match(/Round Rock/gi) || []).length;
    assert.ok(hits <= 1, `"${phrase}" names the town ${hits} times`);
  }
});

test('no anchor doubles a word', () => {
  // "Emergency Plumber Round Rock's Emergency Plumber Round Rock" came out of
  // the branded bucket's `${name}'s ${keyword}` template.
  for (const name of [NAME, 'Round Rock Emergency Plumber', 'Leander Electrician']) {
    const location = name.includes('Leander') ? 'Leander, TX' : LOCATION;
    for (const phrase of allPhrases(poolFor(name, location))) {
      const words = phrase.toLowerCase().replace(/[.,]/g, '').split(/\s+/);
      for (let i = 1; i < words.length; i++) {
        assert.notStrictEqual(words[i], words[i - 1], `"${phrase}" repeats "${words[i]}"`);
      }
    }
  }
});

/* -------------------------------------------------------------------------
 * Decomposing the name
 * ---------------------------------------------------------------------- */

test('the town is stripped out of the name, wherever it sits', () => {
  for (const name of [
    'Emergency Plumber Round Rock',
    'Round Rock Emergency Plumber',
    'Emergency Plumber of Round Rock',
    'Emergency Plumber Round Rock, TX',
  ]) {
    const { core, decomposed } = serviceCore(name, LOCATION);
    assert.strictEqual(core, 'emergency plumber', `"${name}" gave core "${core}"`);
    assert.ok(decomposed, `"${name}" was not marked decomposed`);
  }
});

test('a name without the town is NOT decomposed', () => {
  // "Bob's Plumbing" is not a Rank Fast name, but it is a name somebody will
  // type. Treating it as a service phrase gives "local bob's plumbing":
  // a lowercased proper noun wearing an adjective that belongs to a trade.
  const { core, decomposed } = serviceCore("Bob's Plumbing", LOCATION);
  assert.strictEqual(decomposed, false);
  assert.strictEqual(core, "Bob's Plumbing", 'casing was not preserved');
});

test('an undecomposed name is never lowercased or decorated', () => {
  for (const phrase of poolFor("Bob's Plumbing").semantic) {
    assert.ok(/Bob's Plumbing/.test(phrase), `"${phrase}" lost the name's casing`);
    assert.ok(
      !/^(local|professional|experienced|trusted)\b/i.test(phrase),
      `"${phrase}" decorated a business name`
    );
  }
});

test('an undecomposed name is never pluralised', () => {
  // "Bob's Plumbing" alone does not test this: it ends in -ing, so pluralise()
  // declines on the gerund rule and the decomposition guard is never what
  // saved it. A mutation removing that guard survived against this fixture.
  //
  // "Ace Roofer" pluralises cleanly, so only the guard stands between it and
  // "Ace Roofers in Round Rock" — a made-up plural of a company's name.
  const { decomposed } = serviceCore('Ace Roofer', LOCATION);
  assert.strictEqual(decomposed, false, 'fixture no longer tests what it should');

  for (const phrase of allPhrases(poolFor('Ace Roofer'))) {
    assert.ok(!/\bRoofers\b/i.test(phrase), `"${phrase}" pluralised a business name`);
  }
});

test('a location with no state still works', () => {
  const { core, decomposed } = serviceCore('Austin Emergency Plumbing', 'Austin');
  assert.strictEqual(core, 'emergency plumbing');
  assert.ok(decomposed);
  assert.deepStrictEqual(splitLocation('Austin'), { town: 'Austin', state: '' });
});

/* -------------------------------------------------------------------------
 * Person nouns vs job nouns
 * ---------------------------------------------------------------------- */

test('agent nouns are recognised', () => {
  for (const yes of ['emergency plumber', 'roofer', 'contractor', 'electrician', 'locksmith']) {
    assert.ok(isAgentNoun(yes), `"${yes}" should be an agent noun`);
  }
  for (const no of ['water heater repair', 'roof replacement', 'drain cleaning', 'emergency plumbing']) {
    assert.ok(!isAgentNoun(no), `"${no}" should NOT be an agent noun`);
  }
});

test('person-only templates never reach a job noun', () => {
  // "experienced water heater repair", "water heater repairs serving Leander",
  // "trusted roof replacements". A repair does not serve a town and is not
  // experienced. Same failure as "plumber near mes": a template that reads
  // correctly for one grammatical shape applied to every shape.
  for (const [name, location] of [
    ['Water Heater Repair Leander', 'Leander, TX'],
    ['Austin Roof Replacement', 'Austin, TX'],
    ['Austin Drain Cleaning', 'Austin, TX'],
  ]) {
    for (const phrase of poolFor(name, location).semantic) {
      assert.ok(!/^experienced /i.test(phrase), `"${phrase}"`);
      assert.ok(!/^trusted /i.test(phrase), `"${phrase}"`);
      assert.ok(!/ serving /i.test(phrase), `"${phrase}"`);
    }
  }
});

test('person-only templates DO reach a person noun', () => {
  // The guard above must not fire on a trade, or it empties the best phrases
  // out of the bucket for exactly the sites this mode is built for.
  const semantic = poolFor('Leander Electrician', 'Leander, TX').semantic;
  assert.ok(semantic.includes('experienced electrician'), semantic.join(' | '));
  assert.ok(semantic.includes('trusted electricians'), semantic.join(' | '));
  assert.ok(semantic.includes('electricians serving Leander'), semantic.join(' | '));
});

/* -------------------------------------------------------------------------
 * Exact means exact
 * ---------------------------------------------------------------------- */

test('the exact bucket is the business name and nothing else', () => {
  assert.deepStrictEqual(poolFor().exact, [NAME]);
});

test('the business name never appears verbatim in another bucket', () => {
  // It would be an exact-match anchor wearing the wrong label, quietly
  // inflating the exact share past its 40%.
  const pool = poolFor();
  for (const type of ['semantic', 'descriptive']) {
    assert.ok(
      !pool[type].some(p => p.toLowerCase() === NAME.toLowerCase()),
      `the name leaked into ${type}`
    );
  }
});

/* -------------------------------------------------------------------------
 * Every descriptive phrase has to survive its sentence
 * ---------------------------------------------------------------------- */

test('every descriptive phrase completes "You can also ..."', () => {
  // A descriptive anchor contains no keyword, so it is never already in the
  // page copy and ALWAYS lands in the appended sentence. "who we are and what
  // we do" reads fine alone and gives "You can also who we are and what we
  // do." Test the sentence, not the phrase.
  for (const phrase of poolFor().descriptive) {
    assert.ok(
      /^(see|find|learn|read|take|get|browse|check|explore|meet|discover)\b/i.test(phrase),
      `"You can also ${phrase}." does not parse — phrase must start with a bare verb`
    );
  }
});

/* -------------------------------------------------------------------------
 * The mix
 * ---------------------------------------------------------------------- */

test('HOME_MIX totals 100 and has no branded bucket', () => {
  assert.strictEqual(Object.values(HOME_MIX).reduce((a, b) => a + b, 0), 100);
  // branded and exact would be the same string when the name IS the keyword,
  // so the bucket is merged into exact rather than double-counted.
  assert.ok(!('branded' in HOME_MIX), 'branded should not be a home bucket');
  assert.strictEqual(HOME_MIX.exact, 40);
});

test('the allocation always totals the number of links', () => {
  // Largest remainder, not rounding. Plain rounding drifts and leaves a link
  // with no planned anchor, which is a crash rather than a cosmetic problem.
  for (let n = 1; n <= 40; n++) {
    const plan = planHomeAnchors(n, { businessName: NAME, location: LOCATION });
    assert.strictEqual(plan.length, n, `n=${n} produced ${plan.length}`);
    assert.ok(plan.every(p => p && p.phrase), `n=${n} has an empty phrase`);
  }
});

test('the shares are respected at a realistic site size', () => {
  const plan = planHomeAnchors(10, { businessName: NAME, location: LOCATION });
  const tally = plan.reduce((a, p) => ((a[p.type] = (a[p.type] || 0) + 1), a), {});
  assert.strictEqual(tally.exact, 4, JSON.stringify(tally));
  assert.strictEqual(tally.semantic, 4, JSON.stringify(tally));
  assert.strictEqual(tally.descriptive, 2, JSON.stringify(tally));
});

test('no bucket clumps', () => {
  // Choosing a bucket per page independently is how a six-page site ends up
  // with six exact anchors. Random is not varied.
  const types = planHomeAnchors(12, { businessName: NAME, location: LOCATION })
    .map(p => p.type);
  let run = 1;
  for (let i = 1; i < types.length; i++) {
    run = types[i] === types[i - 1] ? run + 1 : 1;
    assert.ok(run <= 2, `${types.join(',')} has a run of ${run}`);
  }
});

/* -------------------------------------------------------------------------
 * The ring
 * ---------------------------------------------------------------------- */

test('naked URLs are gone from every home link', async () => {
  // This was the Rank Fast default on every page after the first one or two.
  for (const [svc, loc] of [[1, 0], [3, 0], [5, 2], [8, 2]]) {
    for (const link of await homeLinks(svc, loc)) {
      assert.ok(
        !/^https?:\/\//i.test(link.anchor),
        `${link.from} still links home with a naked URL: "${link.anchor}"`
      );
    }
  }
});

test('contact is in the mix rather than an exception', async () => {
  // It used to be hard-coded to the naked URL regardless of site size.
  const links = await homeLinks(5, 2);
  const contact = links.find(l => l.from === 'contact');
  assert.ok(contact, 'contact has no home link');
  assert.ok(['exact', 'semantic', 'descriptive'].includes(contact.anchorType),
    `contact anchorType was ${contact.anchorType}`);
});

test('every home link carries its anchorType through to the injector', async () => {
  // normaliseTargets in injectPagesInterlinks rebuilds each entry field by
  // field. anchorType was dropped there at first, which made the entire plan a
  // no-op while every other part of it looked correctly wired up.
  for (const link of await homeLinks(5, 2)) {
    assert.ok(link.anchorType, `${link.from} lost its anchorType`);
  }

  const pages = [{ filename: 'service-1.html' }];
  const sections = { s1: { paragraphs: ['We handle burst pipes at any hour.'] } };
  const out = injectPagesInterlinks(
    { businessName: NAME, location: LOCATION, businessType: 'plumber' },
    pages,
    pages[0],
    [{ slug: 'index', href: './', anchor: 'see everything we do', anchorType: 'descriptive' }],
    sections,
    LOCATION
  );
  assert.ok(
    /You can also <a href="\.\/">see everything we do<\/a>\./.test(out.s1.paragraphs[0]),
    out.s1.paragraphs[0]
  );
});

test('every home anchor actually belongs to the bucket it claims', async () => {
  // The plan is only worth having if the phrase matches the type. A ring that
  // labels its links correctly and then writes the same anchor into all of
  // them tallies perfectly and is completely broken — and that mutation
  // survived until this test existed.
  const pool = poolFor();
  for (const link of await homeLinks(8, 2)) {
    assert.ok(
      pool[link.anchorType].includes(link.anchor),
      `${link.from} is labelled ${link.anchorType} but says "${link.anchor}"`
    );
  }
});

test('a multi-page site does not link home the same way every time', async () => {
  const anchors = (await homeLinks(8, 2)).map(l => l.anchor);
  assert.ok(
    new Set(anchors).size >= 4,
    `only ${new Set(anchors).size} distinct anchors across ${anchors.length} links`
  );
});

test('a site with no business name still builds', async () => {
  // buildHomeAnchorPool throws without one, and a throw here would fail the
  // whole generation over anchor text.
  const links = await homeLinks(3, 0, { businessName: '' });
  assert.ok(links.length > 0);
  assert.ok(links.every(l => l.anchor), 'an anchor came back empty');
});

/* -------------------------------------------------------------------------
 * Each bucket gets a sentence that reads correctly
 * ---------------------------------------------------------------------- */

test('each anchor type gets its own appended sentence', () => {
  const pages = [{ filename: 'service-1.html' }];
  const expected = {
    exact:       `Learn more about <a href="./">${NAME}</a>.`,
    semantic:    'Learn more about our <a href="./">emergency plumbers in Round Rock</a>.',
    descriptive: 'You can also <a href="./">see everything we do</a>.',
  };
  const phrases = {
    exact: NAME,
    semantic: 'emergency plumbers in Round Rock',
    descriptive: 'see everything we do',
  };

  for (const [type, sentence] of Object.entries(expected)) {
    const sections = { s1: { paragraphs: ['We work across the area at any hour.'] } };
    const out = injectPagesInterlinks(
      { businessName: NAME, location: LOCATION, businessType: 'plumber' },
      pages,
      pages[0],
      [{ slug: 'index', href: './', anchor: phrases[type], anchorType: type }],
      sections,
      LOCATION
    );
    assert.ok(out.s1.paragraphs[0].endsWith(sentence),
      `${type}:\n        got      ${out.s1.paragraphs[0]}\n        expected ...${sentence}`);
  }
});

test('the classic ring is untouched by any of this', () => {
  // Rank GBPs and One-Page Design pass plain slugs and no anchorType. They
  // must keep the wording they have always had.
  const pages = [{ filename: 'service-1.html' }];
  const sections = { s1: { paragraphs: ['We work across the area at any hour.'] } };
  const out = injectPagesInterlinks(
    { businessName: NAME, location: LOCATION, businessType: 'plumber' },
    pages,
    pages[0],
    ['index'],
    sections,
    LOCATION
  );
  assert.ok(
    out.s1.paragraphs[0].includes(`Learn more about our company <a href="./">${NAME}</a>.`),
    out.s1.paragraphs[0]
  );
});

/* -------------------------------------------------------------------------
 * The plugin must not move
 * ---------------------------------------------------------------------- */

test('the blog campaign mix is still 30/40/20/10', () => {
  // This work was for the generated static site. The plugin's articles keep
  // their four buckets, branded included, because there the business name is
  // a DIFFERENT vocabulary from the keyword. If this assertion ever fails,
  // a static-site change has leaked into the plugin.
  assert.deepStrictEqual(DEFAULT_MIX, {
    exact: 30, semantic: 40, descriptive: 20, branded: 10,
  });
});

runAll().then(() => {
  console.log('');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('');
  process.exit(failed === 0 ? 0 : 1);
});
