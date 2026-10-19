// test-restore-blog.js
//
// A blog, back from its own backup.
//
// THE POINT OF THIS FILE. `_data/blog.json` shipped inside every deploy for
// months and nothing had ever read one. A backup nothing has restored from
// is a belief, and the way beliefs about backups end is badly and at the
// worst possible moment.
//
// So the cases below are mostly about what the restore REFUSES to invent.
// A restore that quietly guesses a user id, a date or a money page produces
// a blog that looks right and is wrong, which is worse than one that stops
// and says what it is missing.
//
// NO DATABASE. planRestore() is pure: parsed JSON in, documents and
// warnings out.

'use strict';

const assert = require('assert');

let passed = 0;
let failed = 0;

const queue = [];
function test(name, fn) {
  queue.push(() => Promise.resolve().then(fn)
    .then(() => { console.log(`  ok    ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }));
}
function section(n) { queue.push(async () => console.log(`\n${n}\n`)); }

const { planRestore, writeRestore, byCampaign, EXPECTED_VERSION } = require('./utils/blog/restoreBlog');
const { buildBlogJson, SCHEMA_VERSION } = require('./utils/blog/render/blogJson');

const USER = '507f1f77bcf86cd799439011';

/** A current-format backup, built by the real writer rather than by hand. */
function backup(over = {}) {
  const base = buildBlogJson({
    campaigns: [{
      _id: 'c1', name: 'Winter push', isPillar: false,
      targetPage: { url: 'https://money.example/', keyword: 'driveway repair', intent: 'book' },
      linkMode: 'standalone',
      schedule: { everyDays: 7, publishTime: '09:00', timezone: 'America/Chicago',
                  startAt: new Date('2026-10-01T09:00:00Z') },
    }],
    site: {
      _id: 's1', siteUrl: 'all-about-concrete.explr-home.com',
      business: { name: 'All About Concrete' }, timezone: 'America/Chicago',
    },
    posts: [
      { _id: 'p1', campaign: 'c1', slotIndex: 0, slug: 'first', title: 'First',
        metaDescription: 'm1', words: 900, sections: [{ heading: null, paragraphs: ['a'] }],
        targets: { money: { url: 'https://m.example/' } },
        targetUrl: 'https://own.example/', extraUrl: 'https://wiki.example/',
        publishAt: new Date('2026-10-01T09:00:00Z'), createdAt: new Date('2026-10-01') },
      { _id: 'p2', campaign: 'c1', slotIndex: 1, slug: 'second', title: 'Second',
        metaDescription: 'm2', words: 950, sections: [{ heading: 'H', paragraphs: ['b'] }],
        targets: {}, publishAt: new Date('2026-10-08T09:00:00Z'), createdAt: new Date('2026-10-08') },
    ],
  });

  return Object.assign(base, over);
}

/** What version 1 shipped: the prose, and none of the structure. */
function v1Backup() {
  return {
    version: 1,
    blog: { id: 's1', name: 'All About Concrete', domain: 'all-about-concrete.explr-home.com' },
    posts: [
      { id: 'p1', slug: 'first', title: 'First', metaDescription: 'm1', words: 900,
        sections: [{ heading: null, paragraphs: ['a'] }], targets: {} },
      { id: 'p2', slug: 'second', title: 'Second', metaDescription: 'm2', words: 950,
        sections: [], targets: {} },
    ],
  };
}

const said = (out, re) => out.warnings.some(w => re.test(w));

/* ======================================================================= */

section('WHAT IT REFUSES TO INVENT');

test('A RESTORE WITHOUT A USER IS REFUSED, NOT GUESSED', async () => {
  /* `user` is required on both BlogSite and BlogCampaign and is
   * deliberately absent from the backup — that file is served at a public
   * URL. Guessing it attaches somebody's blog to the wrong account, which
   * is worse in every direction than stopping. */
  const out = planRestore(backup(), {});

  assert.strictEqual(out.ok, false);
  assert.ok(/user id is required/i.test(out.error));
  assert.ok(/by design/i.test(out.error), 'it reads as a bug rather than a deliberate omission');
});

test('AND A FILE THAT IS NOT A BACKUP IS REFUSED', async () => {
  for (const junk of [null, undefined, 'a string', 42]) {
    const out = planRestore(junk, { user: USER });
    assert.strictEqual(out.ok, false, `${JSON.stringify(junk)} was accepted as a backup`);
  }
});

test('AND A BACKUP WITH NO DOMAIN IS REFUSED', async () => {
  /* The domain is every canonical, every internal link and the Pages
   * project name. A blog restored without one is not a blog. */
  const out = planRestore(backup({ blog: { name: 'A' } }), { user: USER });

  assert.strictEqual(out.ok, false);
  assert.ok(/names no domain/i.test(out.error));
});

test('AND A NEWER BACKUP IS REFUSED RATHER THAN HALF-READ', async () => {
  /* A version 3 file holds fields this code does not know about. Reading it
   * anyway restores a blog that is quietly missing whatever version 3 was
   * added for — and nobody would ever find out. */
  const out = planRestore(backup({ version: EXPECTED_VERSION + 1 }), { user: USER });

  assert.strictEqual(out.ok, false);
  assert.ok(/newer restore/i.test(out.error));
});

test('THE RECORDED MONEY PAGE COMES BACK', async () => {
  /* v3 writes it down, so there is nothing left to guess. */
  const out = planRestore(backup(), { user: USER });

  assert.strictEqual(out.campaigns[0].targetPage.url, 'https://money.example/');
  assert.strictEqual(out.campaigns[0].targetPage.keyword, 'driveway repair');
  assert.strictEqual(out.campaigns[0].isPillar, false);
});

test('AND AN UNRECORDED ONE IS LEFT EMPTY, NOT MADE UP', async () => {
  /* THE ONE MOST TEMPTING TO GUESS, and still refused. A v1 or v2 backup
   * has no campaign record at all. A plausible invention — the domain's
   * root, say — would point the next campaign's money links at a URL
   * nobody chose, on a live site, silently. */
  const b = backup();
  b.campaigns = [];

  const out = planRestore(b, { user: USER });

  assert.strictEqual(out.campaigns[0].targetPage, null);
  assert.ok(said(out, /money page/i), 'nothing says the money page was assumed');
});

test('AND AN UNRECORDED CAMPAIGN IS RESTORED AS A PILLAR, WHICH IS THE ONLY SAVEABLE GUESS', async () => {
  /* THE BUG THAT STARTED v3. The restore used to hardcode isPillar: false,
   * and Mongoose refuses a non-pillar campaign with no money page:
   *
   *   BlogCampaign validation failed: targetPage.url is required
   *
   * Found by running --write for the first time, against a real backup of
   * a real pillar campaign. A guess that cannot be saved is worse than one
   * that can and is admitted to. */
  const b = backup();
  b.campaigns = [];

  const out = planRestore(b, { user: USER });

  assert.strictEqual(out.campaigns[0].isPillar, true);
});

test('AND A RECORDED PILLAR STAYS A PILLAR', async () => {
  const b = backup();
  b.campaigns[0].isPillar = true;
  b.campaigns[0].targetPage = { url: '', keyword: '', intent: '' };

  const out = planRestore(b, { user: USER });

  assert.strictEqual(out.campaigns[0].isPillar, true);
  assert.strictEqual(out.campaigns[0].targetPage, null, 'a pillar was given a money page');
});

test('AND THE RECORDED SCHEDULE COMES BACK TOO', async () => {
  /* Every restore before v3 ended by apologising for losing the cadence. */
  const out = planRestore(backup(), { user: USER });

  assert.strictEqual(out.campaigns[0].schedule.everyDays, 7);
  assert.strictEqual(out.campaigns[0].schedule.timezone, 'America/Chicago');
});

test('AND THE SIGNING SECRET IS NOT RESTORED', async () => {
  /* It was never in the backup and a Cloudflare blog has no use for one.
   * Restoring a blank or invented `secret` would be a credential nobody
   * chose sitting on a live record. */
  const out = planRestore(backup(), { user: USER });

  assert.ok(!('secret' in out.site), 'the restore writes a signing secret');
  assert.ok(!('licenceKeyHash' in out.site));
});

section('WHAT IT BRINGS BACK');

test('THE BLOG COMES BACK WITH ITS CLOCK', async () => {
  const out = planRestore(backup(), { user: USER });

  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.site.siteUrl, 'all-about-concrete.explr-home.com');
  assert.strictEqual(out.site.timezone, 'America/Chicago');
  assert.strictEqual(out.site.target, 'cloudflare');
  assert.strictEqual(out.site.user, USER);
});

test('AND EVERY ARTICLE, WITH ITS DATE AND ITS LINK FIELDS', async () => {
  const out = planRestore(backup(), { user: USER });

  assert.strictEqual(out.posts.length, 2);

  const first = out.posts.find(p => 'first' === p.slug);
  assert.strictEqual(first.title, 'First');
  assert.strictEqual(first.targetUrl, 'https://own.example/');
  assert.strictEqual(first.extraUrl, 'https://wiki.example/');
  assert.deepStrictEqual(first.sections, [{ heading: null, paragraphs: ['a'] }]);

  const slot = out.campaigns[0].slots.find(s => 'first' === s.slug);
  assert.strictEqual(slot.publishAt.toISOString(), '2026-10-01T09:00:00.000Z');
});

test('AND THE RING IS BACK IN ORDER', async () => {
  const out = planRestore(backup(), { user: USER });

  assert.strictEqual(out.campaigns.length, 1, 'the articles were scattered across campaigns');
  assert.deepStrictEqual(out.campaigns[0].slots.map(s => s.index), [0, 1]);
  assert.deepStrictEqual(out.campaigns[0].slots.map(s => s.slug), ['first', 'second']);
});

test('AND SLOTS COME BACK IN SLOT ORDER, NOT FILE ORDER', async () => {
  /* The file is sorted by createdAt, which is usually slot order and is not
   * guaranteed to be — an article rewritten later carries a newer date. The
   * ring is defined by the slot number, so that is what orders it. */
  const b = backup();
  b.posts.reverse();

  const out = planRestore(b, { user: USER });

  assert.deepStrictEqual(out.campaigns[0].slots.map(s => s.index), [0, 1]);
});

test('AND EVERY ARTICLE IS MARKED published, BECAUSE IT WAS', async () => {
  /* The backup is built from the render plan, which is the live articles
   * and nothing else. Anything in the file was on the site. */
  const out = planRestore(backup(), { user: USER });

  assert.ok(out.campaigns[0].slots.every(s => 'published' === s.status));
  assert.ok(out.campaigns[0].slots.every(s => s.publishedUrl.startsWith('https://all-about-concrete.')));
});

section('A VERSION 1 BACKUP, WHICH IS WHAT THE LIVE BLOGS STILL SHIP');

test('IT IS READ RATHER THAN REFUSED', async () => {
  /* The prose is all there and that is most of the value. Refusing would
   * mean every blog deployed before 19 October has no restore at all. */
  const out = planRestore(v1Backup(), { user: USER });

  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.posts.length, 2);
});

test('BUT ITS LIMITS ARE NAMED IN SO MANY WORDS', async () => {
  const out = planRestore(v1Backup(), { user: USER });

  assert.ok(said(out, /version 1/i), 'nothing says which shape it is');
  assert.ok(said(out, /no publication dates/i), 'nothing says the dates are gone');
});

test('AND ITS ARTICLES LAND IN ONE CAMPAIGN, NOT ONE EACH', async () => {
  /* With no campaign on any article the ring cannot be rebuilt either way.
   * One campaign of twelve is a blog somebody can fix by hand; twelve
   * campaigns of one is not. */
  const out = planRestore(v1Backup(), { user: USER });

  assert.strictEqual(out.campaigns.length, 1);
  assert.deepStrictEqual(out.campaigns[0].slots.map(s => s.index), [0, 1]);
});

test('AND THE UNDATED ONES ARE COUNTED HONESTLY', async () => {
  /* The count is taken from the file. An earlier form indexed the regrouped
   * plan against the file's positions; mutation testing showed the two are
   * EQUIVALENT — both arrays always hold the same number of items — so this
   * test pins the count, not the expression. See the note in restoreBlog.js
   * for why the clearer form was kept anyway. */
  const out = planRestore(v1Backup(), { user: USER });

  assert.ok(said(out, /2 of 2 articles have no publication date/i),
    `the warning does not count correctly: ${JSON.stringify(out.warnings)}`);
});

test('AND A MIXED FILE COUNTS ONLY THE ONES THAT ARE MISSING', async () => {
  const b = backup();
  delete b.posts[1].publishAt;

  const out = planRestore(b, { user: USER });

  assert.ok(said(out, /1 of 2 articles have no publication date/i),
    `wrong count: ${JSON.stringify(out.warnings)}`);
});

section('THE WARNINGS ARE THE DELIVERABLE');

test('A COMPLETE BACKUP NO LONGER APOLOGISES FOR THE SCHEDULE', async () => {
  /* THE OTHER HALF OF GETTING WARNINGS RIGHT. v3 records the cadence and
   * the money page, so repeating the old apology would be a warning nobody
   * needs — and a warning nobody needs teaches people to skip the ones
   * that matter. */
  const out = planRestore(backup(), { user: USER });

  assert.strictEqual(out.ok, true);
  assert.ok(!said(out, /not described in this backup/i),
    'it apologised for campaign data the backup actually contains');
});

test('BUT IT STILL ADMITS THE TOPICS ARE RECONSTRUCTED', async () => {
  /* Genuinely not in any backup of any version: a topic is the brief, a
   * title is what the writer made of it. */
  const out = planRestore(backup(), { user: USER });

  assert.ok(said(out, /topics were restored from article titles/i));
});

test('AND THE CURRENT WRITER AND THIS READER AGREE ON THE VERSION', async () => {
  /* The two halves of the same contract, in different files. If blogJson
   * bumps its version and this does not, every new backup is refused by the
   * restore that exists for it. */
  assert.strictEqual(EXPECTED_VERSION, SCHEMA_VERSION);
});

test('AND byCampaign KEEPS A REAL CAMPAIGN SEPARATE FROM A SYNTHETIC ONE', async () => {
  const groups = byCampaign([
    { campaign: 'c1', slug: 'a' },
    { campaign: 'c2', slug: 'b' },
    { slug: 'c' },
  ]);

  assert.deepStrictEqual([...groups.keys()], ['c1', 'c2', 'restored']);
});

section('AND THEN WRITING IT, WHICH WAS UNTESTED UNTIL NOW');

/* A model that records what it was asked to create. */
function fakeModel(prefix) {
  const created = [];
  return {
    created,
    async create(doc) { created.push(doc); return Object.assign({ _id: `${prefix}${created.length}` }, doc); },
  };
}

function models() {
  return { Site: fakeModel('s'), Campaign: fakeModel('c'), Post: fakeModel('p') };
}

test('IT WRITES THE SITE, THEN ITS CAMPAIGNS, THEN ITS ARTICLES', async () => {
  /* The order is forced: a campaign needs the site's id and an article
   * needs both. */
  const m = models();
  const out = await writeRestore({ plan: planRestore(backup(), { user: USER }), ...m });

  assert.strictEqual(out.ok, true);
  assert.strictEqual(m.Site.created.length, 1);
  assert.strictEqual(m.Campaign.created.length, 1);
  assert.strictEqual(m.Post.created.length, 2);

  assert.strictEqual(m.Campaign.created[0].site, 's1', 'the campaign was not attached to the site');
  assert.ok(m.Post.created.every(p => 's1' === p.site), 'an article was not attached to the site');
});

test('AND EVERY ARTICLE LANDS ON ITS OWN CAMPAIGN', async () => {
  /* THE BUG THIS REPLACED. The writer used to recover the campaign key by
   * stripping "Restored " off the DISPLAY NAME — so the link between a
   * campaign and its articles rode on a string meant for a human. Rename
   * the campaign and every post gets `campaign: undefined`, which is
   * required, so the restore dies with the blog and its campaigns written
   * and not one article. The key now travels on the plan. */
  const m = models();
  await writeRestore({ plan: planRestore(backup(), { user: USER }), ...m });

  assert.ok(m.Post.created.every(p => 'c1' === p.campaign),
    `an article was orphaned: ${JSON.stringify(m.Post.created.map(p => p.campaign))}`);
});

test('AND THE KEY NEVER REACHES THE DOCUMENT', async () => {
  /* It is plumbing, not a field on BlogCampaign. Mongoose would drop it
   * silently, which is exactly how a stray key survives for a year. */
  const m = models();
  await writeRestore({ plan: planRestore(backup(), { user: USER }), ...m });

  assert.ok(!('key' in m.Campaign.created[0]), 'the plan\u2019s internal key was written to the database');
  assert.ok(!('campaignKey' in m.Post.created[0]), 'the plan\u2019s internal key was written to the database');
});

test('AND AN ORPHANED ARTICLE IS REPORTED, NOT THROWN', async () => {
  /* `campaign` is required on BlogPost, so handing it undefined throws and
   * takes down the rest of the restore — losing the articles that would
   * have saved cleanly. */
  const m = models();
  const plan = planRestore(backup(), { user: USER });

  plan.posts.push({ campaignKey: 'nothing-matches-this', slug: 'stray', sections: [] });

  const out = await writeRestore({ plan, ...m });

  assert.strictEqual(out.ok, true, 'one stray article killed the whole restore');
  assert.strictEqual(out.posts, 2, 'the good articles were not written');
  assert.deepStrictEqual(out.orphans, ['stray']);
  assert.ok(m.Post.created.every(p => p.campaign), 'an article was written with no campaign');
});

test('AND A PLAN THAT FAILED IS NOT WRITTEN', async () => {
  const m = models();
  const out = await writeRestore({ plan: planRestore(backup(), {}), ...m });

  assert.strictEqual(out.ok, false);
  assert.strictEqual(m.Site.created.length, 0, 'a refused plan reached the database');
});

test('AND IT REPORTS WHAT IT ACTUALLY WROTE', async () => {
  /* Not a transaction, and cannot be without a replica set. A failure
   * partway leaves a blog and some articles, so the caller is told rather
   * than left to guess. */
  const m = models();
  const out = await writeRestore({ plan: planRestore(backup(), { user: USER }), ...m });

  assert.strictEqual(out.campaigns, 1);
  assert.strictEqual(out.posts, 2);
  assert.strictEqual(out.siteId, 's1');
});

/* ======================================================================= */

(async () => {
  for (const run of queue) await run();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
