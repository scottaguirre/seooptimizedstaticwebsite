// test-blog-json.js
//
// The backup file that ships with a Cloudflare blog.
//
// WHAT THIS IS GUARDING
//
// `_data/blog.json` is the only copy of a static blog's articles that is not
// in Mongo. Two things can go wrong with it, and they fail in opposite
// directions:
//
//   IT PUBLISHES SOMETHING IT SHOULD NOT. The file sits at a guessable URL on
//   a public site, and the BlogSite document it is built from carries
//   `secret` — the HMAC signing key every authenticated request is verified
//   against. One spread of that document and the key is on the internet.
//
//   IT LEAVES OUT SOMETHING THE REBUILD NEEDS. Nobody finds that out until
//   the day Mongo is gone, which is the one day it cannot be fixed.
//
// So the tests below come in two halves: what must be in it, and what must
// never be.
//
//   node test-blog-json.js

const assert = require('assert');
const { buildBlogJson, blogJsonFile, SCHEMA_VERSION } = require('./utils/blog/render/blogJson');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}
function section(n) { console.log(`\n${n}\n`); }

/**
 * A site document with everything a real one carries — INCLUDING THE SECRETS.
 *
 * The fixture is hostile on purpose. A test built from a tidy object proves
 * only that tidy objects stay tidy; the failure being guarded against is
 * somebody passing the document Mongo actually returns.
 */
function site(extra = {}) {
  return Object.assign({
    _id: 'site-1',
    user: 'user-1',
    siteUrl: 'https://houstonresource.center',
    business: { name: 'Houston Resource Center', phone: '713-555-0134' },
    target: 'cloudflare',
    status: 'active',

    // The two that must never travel.
    secret: 'c7f1e0a9b3d84f2a9e6b0c5d1a8f3e7b',
    licenceKeyHash: '9f2c1b7e4a6d8035bc11ee22ff334455',

    lastPingError: 'connect ETIMEDOUT 15.204.123.104:443',
    failedAuthCount: 3,
  }, extra);
}

function article(extra = {}) {
  return Object.assign({
    _id: 'post-1',
    campaign: 'campaign-9',
    site: 'site-1',
    slotIndex: 0,
    job: 'job-4',
    slug: 'broken-tooth-no-insurance',
    title: 'Broken Tooth, No Insurance',
    metaDescription: 'What to do when a tooth breaks and there is no cover.',
    words: 912,
    sections: [
      { heading: null, paragraphs: ['A broken tooth can turn into an infection.', 'Tell the front desk.'] },
      { heading: 'When to go now', paragraphs: ['Facial swelling is urgent.'] },
    ],
    targets: { money: { url: 'https://example.com/free-dental' }, next: { pending_id: 'topic-3' } },

    // Internal. None of it belongs on a public URL.
    quality: { ok: true, failures: [], stats: { words: 912 } },
    pending: [{ token: 'next', slotIndex: 1, id: 'topic-3' }],
    missingLinks: [],
    deletableAt: null,
    createdAt: new Date('2026-10-14T09:00:00Z'),
  }, extra);
}

/* ========================================================================= */

section('WHAT A REBUILD ACTUALLY NEEDS');

/* THE BACKUP COULD NOT REBUILD A BLOG, and nothing said so — 19 October.
 *
 * The file carried id, slug, title, metaDescription, words, sections and
 * targets. That restores the WORDS. It does not restore the BLOG:
 *
 *   no date        every page prints one and the sitemap carries one, so a
 *                  restored blog came back with every article undated
 *   no campaign    nor slotIndex, so the ring — which article is slot 3 of
 *                  12 — was gone, and campaigns could not be rebuilt at all
 *   no targetUrl   the per-article money override
 *   no extraUrl    the owner's own {{link}} destination
 *   no timezone    so the dates that were missing would have rendered in
 *                  the server's clock anyway, which is a bug this project
 *                  has already paid for once
 *
 * Every one of these is on the document already or one field away on the
 * slot. None of them was named, and a field nobody names cannot escape —
 * which is the rule that keeps the secret out and quietly kept these out
 * too. */

test('THE PUBLICATION DATE SURVIVES', function () {
  const out = buildBlogJson({
    site: site(),
    posts: [article({ publishAt: new Date('2026-10-19T09:00:00Z') })],
  });

  assert.strictEqual(out.posts[0].publishAt, '2026-10-19T09:00:00.000Z',
    'a restored blog would lose every article date it ever had');
});

test('AND AN ARTICLE WITH NO DATE SAYS SO RATHER THAN INVENTING ONE', function () {
  /* new Date(undefined) is Invalid Date and JSON.stringify turns it into
   * null anyway — but a silent `null` from a crash and a deliberate null
   * read the same, so the empty case is pinned on purpose. */
  const out = buildBlogJson({ site: site(), posts: [article()] });

  assert.strictEqual(out.posts[0].publishAt, null);
});

test('AND THE RING IS REBUILDABLE', function () {
  const out = buildBlogJson({ site: site(), posts: [article()] });

  assert.strictEqual(out.posts[0].campaign, 'campaign-9');
  assert.strictEqual(out.posts[0].slotIndex, 0);
});

test('AND SLOT ZERO IS NOT DROPPED FOR BEING FALSY', function () {
  /* The classic. `doc.slotIndex || ''` loses the front page of every blog —
   * the one article guaranteed to exist. */
  const out = buildBlogJson({ site: site(), posts: [article({ slotIndex: 0 })] });

  assert.strictEqual(out.posts[0].slotIndex, 0);
});

test('AND THE TWO LINK FIELDS THE OWNER TYPED ARE KEPT', function () {
  /* Added on 19 October, hours before this gap was found: targetUrl is the
   * per-article money override and extraUrl is where {{link}} points. Both
   * are typed by hand and exist nowhere else. */
  const out = buildBlogJson({
    site: site(),
    posts: [article({ targetUrl: 'https://own.example/page/', extraUrl: 'https://wiki.example/x' })],
  });

  assert.strictEqual(out.posts[0].targetUrl, 'https://own.example/page/');
  assert.strictEqual(out.posts[0].extraUrl, 'https://wiki.example/x');
});

test('AND THE BLOG CARRIES THE CLOCK ITS DATES ARE IN', function () {
  /* Without it a restore renders every date in whatever zone the server
   * happens to run in — the exact bug toLocaleDateString() caused on the
   * confirmation screen, found only by running the suite under
   * TZ=Asia/Tokyo. */
  const out = buildBlogJson({ site: site({ timezone: 'America/Chicago' }), posts: [] });

  assert.strictEqual(out.blog.timezone, 'America/Chicago');
});

test('AND A BLOG WITH NO TIMEZONE SET IS UTC, NOT EMPTY', function () {
  /* The model defaults it to UTC. A backup saying '' would be a backup that
   * restores into whatever the restoring machine is set to. */
  const out = buildBlogJson({ site: site(), posts: [] });

  assert.strictEqual(out.blog.timezone, 'UTC');
});

/* ========================================================================= */

section('AND THE CAMPAIGNS THEMSELVES, WHICH v2 STILL DID NOT CARRY');

/* FOUND BY RUNNING --write FOR THE FIRST TIME, against a real backup.
 *
 * v2 fixed the articles: dates, campaign ids, slot numbers, link overrides.
 * It recorded nothing about the CAMPAIGNS those ids pointed at, so a restore
 * had to invent one — and inventing it meant guessing `isPillar: false`,
 * which Mongoose refused outright:
 *
 *   BlogCampaign validation failed: targetPage.keyword is required,
 *   targetPage.url is required
 *
 * targetPage is `required: function () { return !this.isPillar; }`. The
 * campaign being restored was a PILLAR, which has no money page by design.
 * So the validator caught a restore that would otherwise have silently
 * turned a pillar campaign into an ordinary one wanting a page it never
 * had.
 *
 * A backup that cannot say which kind of campaign it held is a backup that
 * cannot restore either kind.
 */

const campaign = (over = {}) => Object.assign({
  _id: 'campaign-9',
  name: 'Winter push',
  isPillar: false,
  targetPage: { url: 'https://example.com/free-dental', keyword: 'emergency dentist', intent: 'book now' },
  linkMode: 'standalone',
  schedule: { everyDays: 7, publishTime: '09:00', timezone: 'America/Chicago', startAt: new Date('2026-10-01T09:00:00Z') },
  status: 'active',
  slots: [],
}, over);

test('THE CAMPAIGN IS RECORDED, NOT INFERRED FROM ITS ARTICLES', function () {
  const out = buildBlogJson({ site: site(), posts: [article()], campaigns: [campaign()] });

  assert.strictEqual(out.campaigns.length, 1);
  assert.strictEqual(out.campaigns[0].id, 'campaign-9');
  assert.strictEqual(out.campaigns[0].name, 'Winter push');
});

test('AND IT SAYS WHETHER IT IS A PILLAR, WHICH DECIDES EVERYTHING ELSE', function () {
  /* THE FIELD THE RESTORE HAD TO GUESS. Guess it wrong one way and the
   * document is refused; wrong the other and a campaign silently changes
   * kind. */
  const ordinary = buildBlogJson({ site: site(), posts: [], campaigns: [campaign()] });
  const pillar = buildBlogJson({ site: site(), posts: [], campaigns: [campaign({ isPillar: true })] });

  assert.strictEqual(ordinary.campaigns[0].isPillar, false);
  assert.strictEqual(pillar.campaigns[0].isPillar, true);
});

test('AND THE MONEY PAGE, WITHOUT WHICH AN ORDINARY CAMPAIGN CANNOT BE SAVED', function () {
  const out = buildBlogJson({ site: site(), posts: [], campaigns: [campaign()] });

  assert.deepStrictEqual(out.campaigns[0].targetPage, {
    url: 'https://example.com/free-dental',
    keyword: 'emergency dentist',
    intent: 'book now',
  });
});

test('AND A PILLAR CARRIES AN EMPTY ONE RATHER THAN A MISSING ONE', function () {
  /* An absent key and an empty one read the same to a careless restore.
   * Present-and-empty says "there genuinely is no money page here". */
  const out = buildBlogJson({ site: site(), posts: [], campaigns: [campaign({ isPillar: true, targetPage: null })] });

  assert.deepStrictEqual(out.campaigns[0].targetPage, { url: '', keyword: '', intent: '' });
});

test('AND THE SCHEDULE, SO THE RESTORE STOPS APOLOGISING FOR IT', function () {
  /* Every restore so far has warned that the cadence had to be set again.
   * It is four fields and they were simply never written down. */
  const out = buildBlogJson({ site: site(), posts: [], campaigns: [campaign()] });

  assert.deepStrictEqual(out.campaigns[0].schedule, {
    everyDays: 7,
    publishTime: '09:00',
    timezone: 'America/Chicago',
    startAt: '2026-10-01T09:00:00.000Z',
  });
});

test('AND A CAMPAIGN WITH NO SCHEDULE GETS THE MODEL\u2019S OWN DEFAULTS', function () {
  const out = buildBlogJson({ site: site(), posts: [], campaigns: [campaign({ schedule: null })] });

  assert.strictEqual(out.campaigns[0].schedule.everyDays, 7);
  assert.strictEqual(out.campaigns[0].schedule.publishTime, '09:00');
  assert.strictEqual(out.campaigns[0].schedule.timezone, 'UTC');
  assert.strictEqual(out.campaigns[0].schedule.startAt, null);
});

test('AND NOTHING ELSE OFF THE CAMPAIGN DOCUMENT COMES WITH IT', function () {
  /* The same rule as the articles and the site: every field named, one at a
   * time. A campaign holds slots with wpPostIds, anchor pools and a status
   * machine; none of it belongs on a public URL and none of it helps a
   * rebuild. */
  const out = buildBlogJson({
    site: site(),
    posts: [],
    campaigns: [campaign({ secretish: 'nope', slots: [{ wpPostId: 12 }] })],
  });

  assert.deepStrictEqual(
    Object.keys(out.campaigns[0]).sort(),
    ['id', 'isPillar', 'linkMode', 'name', 'schedule', 'targetPage']);

  assert.ok(!JSON.stringify(out).includes('nope'));
  assert.ok(!JSON.stringify(out).includes('wpPostId'));
});

test('AND NO CAMPAIGNS AT ALL IS AN EMPTY LIST, NOT A MISSING KEY', function () {
  assert.deepStrictEqual(buildBlogJson({ site: site(), posts: [] }).campaigns, []);
});

test('AND THE SHAPE CHANGED AGAIN, SO THE VERSION DID', function () {
  assert.strictEqual(SCHEMA_VERSION, 3);
});

section('WHAT MUST NEVER BE IN IT');

test('THE SIGNING SECRET IS NOT IN THE FILE', function () {
  /* The one that matters most. `secret` is what every inbound request from a
   * customer's site is verified against — publishing it is publishing the
   * ability to impersonate them. It lives on the same document as the blog's
   * name, so the only thing standing between it and a public URL is that
   * nothing here copies a document wholesale. */
  const json = JSON.stringify(blogJsonFile({ site: site(), posts: [article()] }));

  assert.ok(!json.includes('c7f1e0a9b3d84f2a9e6b0c5d1a8f3e7b'),
    'the HMAC signing key is in a file served on the public internet');
  assert.ok(!json.includes('9f2c1b7e4a6d8035bc11ee22ff334455'),
    'the licence key hash is in the published file');
  assert.ok(!/"secret"|"licenceKeyHash"/.test(json),
    'a secret field name appears in the published file');
});

test('AND NEITHER IS ANYTHING ELSE NOBODY NAMED', function () {
  /* The general form of the rule, which is what keeps it true next year. A
   * field added to BlogSite in six months must not appear here because
   * somebody spread the document; it appears only when somebody decides it
   * should. The blog block is four keys and that is the whole contract —
   * four since 19 October, when timezone was added because a restore
   * without it renders every date in the restoring machine's clock. */
  const out = buildBlogJson({ site: site({ invoiceEmail: 'edwin@example.com' }), posts: [] });

  assert.deepStrictEqual(Object.keys(out.blog).sort(), ['domain', 'id', 'name', 'timezone']);
  assert.ok(!JSON.stringify(out).includes('edwin@example.com'),
    'a field added to the site document was published without anyone deciding to');
});

test('the operational noise stays out of the articles too', function () {
  /* quality is an internal report whose shape belongs to qualityCheck.js;
   * `pending` describes placeholder spans that cannot exist on a static site
   * at all, because every deploy is a fresh render. Neither helps a rebuild
   * and both would have to be explained to anyone reading the backup. */
  const out = buildBlogJson({ site: site(), posts: [article()] });

  /* THE LIST GREW ON 19 OCTOBER and every addition was a deliberate one:
   * publishAt, campaign, slotIndex, targetUrl and extraUrl, because without
   * them the file restored the words of a blog and not the blog. Nothing
   * else came with them — quality, pending, missingLinks, deletableAt, job
   * and site are all still absent, which is the property this test is for. */
  assert.deepStrictEqual(
    Object.keys(out.posts[0]).sort(),
    ['campaign', 'extraUrl', 'id', 'metaDescription', 'publishAt', 'sections',
     'slotIndex', 'slug', 'targetUrl', 'targets', 'title', 'words']
  );
});

section('WHAT A REBUILD CANNOT DO WITHOUT');

test('every word of the article is there', function () {
  const out = buildBlogJson({ site: site(), posts: [article()] });
  const p = out.posts[0];

  assert.strictEqual(p.title, 'Broken Tooth, No Insurance');
  assert.strictEqual(p.slug, 'broken-tooth-no-insurance');
  assert.strictEqual(p.metaDescription, 'What to do when a tooth breaks and there is no cover.');
  assert.strictEqual(p.sections.length, 2);
  assert.deepStrictEqual(p.sections[0].paragraphs,
    ['A broken tooth can turn into an infection.', 'Tell the front desk.']);
  assert.strictEqual(p.sections[1].heading, 'When to go now');
});

test('THE OPENING SECTION KEEPS ITS null HEADING', function () {
  /* The writer's prompt says the first section has no heading, and the model
   * file records that an empty string arriving instead is a signal worth
   * being able to see. Collapsing both to '' here would erase that
   * distinction in the only copy that outlives the database. */
  const out = buildBlogJson({ site: site(), posts: [article()] });

  assert.strictEqual(out.posts[0].sections[0].heading, null, 'null became something else');
  assert.strictEqual(
    buildBlogJson({ site: site(), posts: [article({ sections: [{ heading: '', paragraphs: [] }] })] })
      .posts[0].sections[0].heading,
    '',
    'an empty heading was turned into null, which means something different'
  );
});

test('AND THE LINK PLAN SURVIVES', function () {
  /* Without `targets` the backup restores the prose and loses the
   * interlinking, which is most of what the blog was built to do. The
   * paragraphs still carry their {{money}} tokens; this is what says where
   * each one points. Both halves or neither. */
  const out = buildBlogJson({ site: site(), posts: [article()] });

  assert.deepStrictEqual(out.posts[0].targets, {
    money: { url: 'https://example.com/free-dental' },
    next: { pending_id: 'topic-3' },
  });
});

test('a pending_id stays snake_case', function () {
  /* PHP reads that key. Helpfully camelCasing it on the way out would make
   * the backup restore into something IE_Links::render() cannot read. */
  const json = JSON.stringify(buildBlogJson({ site: site(), posts: [article()] }));

  assert.ok(json.includes('pending_id'), 'the key PHP reads was renamed');
});

test('the blog is identified by name and domain', function () {
  const out = buildBlogJson({ site: site(), posts: [] });

  assert.strictEqual(out.blog.name, 'Houston Resource Center');
  assert.strictEqual(out.blog.domain, 'https://houstonresource.center');
});

test('and the file says which shape it is', function () {
  /* The one piece of information that only exists now. Something reading a
   * backup two versions later has no other way to know what it is holding. */
  assert.strictEqual(buildBlogJson({ site: site(), posts: [] }).version, SCHEMA_VERSION);
  assert.ok(SCHEMA_VERSION >= 1);
});

section('THE SAME BLOG PRODUCES THE SAME FILE');

test('POSTS COME OUT IN A FIXED ORDER', function () {
  /* Mongo returns documents in no guaranteed order without a sort. Shuffled
   * input must not produce a shuffled file, or every deploy uploads this
   * again for nothing — see the determinism note in the module. */
  const a = article({ _id: 'a', slotIndex: 0, createdAt: new Date('2026-10-01T00:00:00Z') });
  const b = article({ _id: 'b', slotIndex: 1, createdAt: new Date('2026-10-01T00:00:00Z') });
  const c = article({ _id: 'c', slotIndex: 0, createdAt: new Date('2026-10-09T00:00:00Z') });

  const one = blogJsonFile({ site: site(), posts: [c, a, b] }).contents;
  const two = blogJsonFile({ site: site(), posts: [b, c, a] }).contents;

  assert.strictEqual(one, two, 'the same posts in a different order produced a different file');
  assert.deepStrictEqual(
    JSON.parse(one).posts.map(p => p.id),
    ['a', 'b', 'c'],
    'posts are not in publication order'
  );
});

test('AND TWO POSTS WRITTEN IN THE SAME SECOND STILL HAVE AN ORDER', function () {
  /* FOUND BY MUTATION. The first version of this section only ever compared
   * posts that differed by date or by slot, so breaking the last tiebreak —
   * or deleting the slot comparison entirely — changed nothing any assertion
   * could see.
   *
   * A batch writes twelve posts in one go and their createdAt values are
   * frequently identical to the second; two campaigns on one blog can also
   * put two different posts at slot 0. Without a final tiebreak the engine
   * decides, and the file changes shape for no reason at all. */
  const when = new Date('2026-10-01T00:00:00Z');

  // Same second, same slot: only the id can separate them.
  const z = article({ _id: 'z', slotIndex: 0, createdAt: when });
  const a = article({ _id: 'a', slotIndex: 0, createdAt: when });

  assert.deepStrictEqual(
    buildBlogJson({ site: site(), posts: [z, a] }).posts.map(p => p.id),
    ['a', 'z'],
    'two posts written in the same second came out in whatever order they arrived');

  assert.strictEqual(
    blogJsonFile({ site: site(), posts: [z, a] }).contents,
    blogJsonFile({ site: site(), posts: [a, z] }).contents);

  /* Same second, and the SLOT disagrees with the id. The slot is the order
   * the batch was planned in, so it has to win. */
  const early = article({ _id: 'zz', slotIndex: 0, createdAt: when });
  const late = article({ _id: 'aa', slotIndex: 1, createdAt: when });

  assert.deepStrictEqual(
    buildBlogJson({ site: site(), posts: [late, early] }).posts.map(p => p.id),
    ['zz', 'aa'],
    'the slot order inside a batch was ignored');
});

test('AND THERE IS NO TIMESTAMP IN IT', function () {
  /* A generatedAt would change the file on every deploy even when not one
   * word had changed, so Direct Upload's hashing would skip nothing and the
   * backup would be re-uploaded for ever. The deployment carries the date. */
  const json = blogJsonFile({ site: site(), posts: [article()] }).contents;

  assert.ok(!/generatedAt|deployedAt|"timestamp"/.test(json),
    'the file carries a timestamp, so it changes on every deploy');

  const first = blogJsonFile({ site: site(), posts: [article()] }).contents;
  const second = blogJsonFile({ site: site(), posts: [article()] }).contents;

  assert.strictEqual(first, second, 'two builds of identical content differ');
});

test('it lands at the path the plan named', function () {
  const file = blogJsonFile({ site: site(), posts: [] });

  assert.strictEqual(file.path, '_data/blog.json');
  assert.doesNotThrow(() => JSON.parse(file.contents), 'the contents are not valid JSON');
});

section('Junk does not take the deploy down');

test('no posts is an empty list, not a crash', function () {
  /* A blog with nothing published yet still deploys — the index page, the
   * sitemap and this file. */
  assert.deepStrictEqual(buildBlogJson({ site: site(), posts: [] }).posts, []);
  assert.deepStrictEqual(buildBlogJson({ site: site() }).posts, []);
  assert.deepStrictEqual(buildBlogJson({}).posts, []);
  assert.deepStrictEqual(buildBlogJson().posts, []);
});

test('A HALF-WRITTEN POST DOES NOT POISON THE WHOLE FILE', function () {
  /* One article that failed mid-write must cost one article, not the backup
   * of the other ninety-nine. Every field is defaulted rather than assumed. */
  const broken = { _id: 'broken' };

  const out = buildBlogJson({ site: site(), posts: [broken, article({ _id: 'z' })] });

  assert.strictEqual(out.posts.length, 2);
  /* THE DEFAULTS ARE NOT ALL THE SAME, AND THAT IS DELIBERATE. The strings
   * empty, the number zero, the containers empty — and publishAt and
   * slotIndex NULL rather than '' or 0. A missing date is not the epoch and
   * a missing slot is not the front page; a restore reading 0 would put a
   * half-written article at the top of the blog. */
  assert.deepStrictEqual(out.posts.find(p => 'broken' === p.id), {
    id: 'broken', slug: '', title: '', metaDescription: '', words: 0,
    publishAt: null, campaign: '', slotIndex: null, targetUrl: '', extraUrl: '',
    sections: [], targets: {},
  });
});

test('and nor does a section of the wrong shape', function () {
  const odd = article({
    sections: [
      { heading: 'Fine', paragraphs: 'not an array' },
      { heading: 'Also fine', paragraphs: ['ok', null, undefined, 42] },
      null,
    ],
  });

  const out = buildBlogJson({ site: site(), posts: [odd] });

  assert.deepStrictEqual(out.posts[0].sections[0].paragraphs, []);
  assert.deepStrictEqual(out.posts[0].sections[1].paragraphs, ['ok', '42']);
  assert.deepStrictEqual(out.posts[0].sections[2], { heading: null, paragraphs: [] });
});

test('targets that are not an object become an empty one', function () {
  /* Mixed on the model, so nothing stops a bad write putting a string there.
   * A rebuild reading `targets.money.url` off a string would throw. */
  assert.deepStrictEqual(
    buildBlogJson({ site: site(), posts: [article({ targets: 'money' })] }).posts[0].targets, {});
  assert.deepStrictEqual(
    buildBlogJson({ site: site(), posts: [article({ targets: null })] }).posts[0].targets, {});
});

test('an ObjectId comes out as a string', function () {
  /* Mongo ids are objects. JSON.stringify would render one as
   * {"buffer":{...}} or as a string depending on the driver version, and a
   * backup whose ids change shape between versions is a backup nobody can
   * write a restore for. */
  const oid = { toString: () => '507f1f77bcf86cd799439011' };

  const out = buildBlogJson({ site: site({ _id: oid }), posts: [article({ _id: oid })] });

  assert.strictEqual(out.blog.id, '507f1f77bcf86cd799439011');
  assert.strictEqual(out.posts[0].id, '507f1f77bcf86cd799439011');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
