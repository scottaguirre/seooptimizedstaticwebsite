// test-static-blogs.js
//
// The screen where a Cloudflare blog is created and its campaigns planned.
//
// WHAT THIS IS GUARDING
//
// Two things, and they are not the same kind of thing.
//
//   OWNERSHIP. A blog id is in the URL. Every handler has to load it scoped
//   to the signed-in account, so a guessed id returns "not here" rather than
//   somebody else's blog — and so a POST cannot plan a campaign, or later
//   spend credits, against a site that is not yours.
//
//   ONE COPY OF THE RULES. The 200 lines that decide whether a campaign is
//   valid moved out of /api/blog/plan precisely so this screen could call
//   them instead of carrying its own version. If a rule reappears in the
//   route, the plugin and the screen can disagree about what a valid
//   campaign is — which is the whole thing the move was for.
//
// IT DRIVES THE REAL HANDLERS, pulled off the router, with fake requests.
// Reading the file and nodding is how you ship a page that renders a form
// nobody can submit.
//
//   node test-static-blogs.js

const assert = require('assert');

/* STUBBED BEFORE THE ROUTER IS REQUIRED, and the order is load-bearing.
 * The route requires suggestForSite, which destructures suggestTopics and
 * checkTopicSet into consts as it loads. Replace them afterwards and the
 * route still holds the originals — and the first thing a suggestion test
 * would do is call the real model, for real money. */
const suggestTopicsModule = require('./utils/blog/suggestTopics');
const qualityCheckModule = require('./utils/blog/qualityCheck');

const model = { calls: [], topics: [], warnings: [], throws: null };

suggestTopicsModule.suggestTopics = async (ctx, opts) => {
  model.calls.push({ ctx, opts });
  if (model.throws) throw model.throws;
  return model.topics;
};

qualityCheckModule.checkTopicSet = () => ({ warnings: model.warnings });

/* AND publishBlog, FOR THE SAME REASON AND WITH THE SAME TRAP.
 *
 * The route does `const { publishBlog } = require(...)` at load, so a stub
 * installed after the router is required is a stub the route never sees.
 * The first version of these tests did exactly that and every publish
 * assertion failed against correct code. */
const publishModule = require('./utils/blog/render/publishBlog');

const publish = { answer: null, calls: [] };
publishModule.publishBlog = async (opts) => {
  publish.calls.push(opts);
  return publish.answer;
};

/* AND markPublished, BEFORE THE ROUTER, FOR THE FOURTH TIME IN THIS FILE.
 *
 * Same trap, same reason: the route destructures it at load. Stubbed here
 * rather than left to hit a real Mongo, because what these tests are about
 * is WHETHER the route calls it and with WHAT — the writing itself is
 * test-mark-published.js's job, and it owns 16 assertions about it. */
const markModule = require('./utils/blog/markPublished');

const marked = { calls: [], answer: { marked: 0 } };
markModule.markPublished = async (opts) => {
  marked.calls.push(opts);
  return marked.answer;
};

/* AND THE CLOUDFLARE PROJECT DELETE, BEFORE THE ROUTER, FOR THE THIRD
 * TIME IN THIS FILE.
 *
 * staticBlogsRoute destructures deleteProject at load. A stub installed
 * after the require is a stub the route never sees — the trap described
 * above publishBlog, which has now caught two different features. */
const cloudflareModule = require('./utils/blog/cloudflare/deploy');

const cloudflare = {
  answer: { ok: true, output: '' },
  release: { detached: { ok: true }, dns: { ok: true, removed: true } },
  calls: [],
  releaseCalls: [],
};

cloudflareModule.deleteProject = async (opts) => {
  cloudflare.calls.push(opts);
  return cloudflare.answer;
};

/* AND THE TEARDOWN, which has to run BEFORE the project delete —
 * Cloudflare refuses to delete a project still serving an active custom
 * domain, and that refusal is what made a successful blog delete look
 * like a failed one. */
cloudflareModule.releaseDomain = async (opts) => {
  cloudflare.releaseCalls.push(opts);
  return cloudflare.release;
};

/* AND THE ZONE LOOKUP, BEFORE THE ROUTER, FOR THE FIFTH TIME IN THIS FILE.
 *
 * AND BELOW cloudflareModule, OBVIOUSLY — the first draft of this block
 * sat above the require that defines it and the whole file died with
 * "Cannot access 'cloudflareModule' before initialization".
 *
 * Same trap, same reason. These three are what the creation screen uses to
 * notice a typo'd domain before anything is written. Defaulted to "the zone
 * was found", which is the quiet path, so every existing creation test goes
 * on behaving as it did. */
const zones = {
  find: { ok: true, id: 'z1', name: 'explr-home.com' },
  list: { ok: true, names: ['explr-home.com'] },
  findCalls: [],
};

cloudflareModule.findZone = async (opts) => { zones.findCalls.push(opts); return zones.find; };
cloudflareModule.listZones = async () => zones.list;


/* childEnv throws when the credentials are absent, which they are in a
 * test run. The route calls it to hand an environment to a child that
 * these tests never spawn, so what it returns does not matter — only
 * that it does not take the handler down with it. */
cloudflareModule.childEnv = () => ({});

const approveModule = require('./utils/blog/approveCampaign');

const approve = { answer: null, calls: [] };
approveModule.approveCampaign = async (opts) => {
  approve.calls.push(opts);
  return approve.answer;
};

const router = require('./routes/staticBlogsRoute');
const BlogSite = require('./models/BlogSite');
const BlogCampaign = require('./models/BlogCampaign');
const BlogPost = require('./models/BlogPost');
const User = require('./models/User');

let passed = 0, failed = 0;

const queue = [];
function test(name, fn) {
  queue.push(() => fn()
    .then(() => { console.log(`  ok    ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }));
}
function section(n) { queue.push(async () => console.log(`\n${n}\n`)); }

/* ------------------------------------------------------------------ fakes */

const USER_ID = '507f1f77bcf86cd799439001';
const OTHER_USER = '507f1f77bcf86cd799439002';
const BLOG_ID = '507f1f77bcf86cd799439011';

function handler(method, path) {
  const layer = router.stack.find(l => l.route && l.route.path === path && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} is not on the router`);

  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;   // past requireAuth
}

let db;

function install(over = {}) {
  db = Object.assign({
    blogs: [{
      _id: BLOG_ID,
      user: USER_ID,
      target: 'cloudflare',
      status: 'active',
      siteUrl: 'leanderwaterheaters.com',
      business: { name: 'Leander Water Heaters' },
    }],
    campaigns: [],
    credits: 10000,
    created: null,
    created_campaign: null,
    planCalls: [],
    findOneWhere: null,
    /* WITH IDS, because the Articles list builds an edit link from one.
     * Without them the link assertion matched /articles/undefined/edit
     * and passed — a test agreeing with a page that could not work. */
    articles: [
      { _id: '507f1f77bcf86cd799439031', title: 'First one', slug: 'first-one' },
      { _id: '507f1f77bcf86cd799439032', title: 'Second one', slug: 'second-one' },
    ],
    siteUpdates: [],
    postFindWhere: null,
    postExistsWhere: null,
  }, over);

  /* The query shapes matter more than the rows here: the ownership tests
   * assert on WHAT WAS ASKED, because a handler that loads by id and
   * compares afterwards passes a "did it return the right blog" test and
   * still leaks on the next early return somebody adds. */
  BlogSite.findOne = async (where) => {
    db.findOneWhere = where;
    return db.blogs.find(b =>
      (!where._id || String(b._id) === String(where._id))
      && (!where.user || String(b.user) === String(where.user))
      && (!where.target || b.target === where.target)
      && (!where.siteUrl || b.siteUrl === where.siteUrl)) || null;
  };

  BlogSite.find = () => ({ sort: () => ({ lean: async () => db.blogs }) });
  BlogSite.countDocuments = async () => db.blogs.length;
  BlogSite.create = async (doc) => { db.created = doc; return Object.assign({ _id: BLOG_ID }, doc); };

  BlogCampaign.find = (where) => {
    /* TWO SHAPES, ONE METHOD. The blog page asks .sort().select().lean();
     * createCampaign asks .select().lean() for prior anchors. A stub that
     * only knew one of them made the planner throw, and the route turned
     * that into a 500 — which looked exactly like a broken route. */
    const rows = async () => (where && where['targetPage.url'] ? [] : db.campaigns);
    return {
      sort: () => ({ select: () => ({ lean: rows }) }),
      select: () => ({ lean: rows }),
    };
  };

  BlogCampaign.create = async (doc) => {
    db.created_campaign = doc;
    return Object.assign({ _id: { toString: () => '507f1f77bcf86cd799439099' } }, doc);
  };

  User.findById = () => ({ lean: async () => ({ _id: USER_ID, credits: db.credits }) });

  BlogPost.aggregate = async () => [];

  /* The written articles, which the front-page picker lists. */
  BlogPost.find = (where) => {
    db.postFindWhere = where;
    return { select: () => ({ sort: () => ({ lean: async () => db.articles }) }) };
  };

  BlogPost.exists = async (where) => {
    db.postExistsWhere = where;
    return db.articles.some(a =>
      a.slug === where.slug && String(db.blogs[0]._id) === String(where.site)) || null;
  };

  BlogSite.updateOne = async (where, update) => {
    db.siteUpdates.push({ where, update });
    return { modifiedCount: 1 };
  };

  /* THE DELETES, AND THE ORDER THEY HAPPENED IN.
   *
   * The order is recorded as well as the filters because it is a real
   * requirement, not an implementation detail: delete the blog first and
   * a failure part way through leaves campaigns and posts pointing at a
   * site that is gone, which nothing lists and nothing cleans up. */
  db.deletedPosts = null;
  db.deletedCampaigns = null;
  db.deletedSite = null;
  db.deleteOrder = [];

  BlogPost.deleteMany = async (where) => {
    db.deletedPosts = where;
    db.deleteOrder.push('posts');
    return { deletedCount: db.articles.length };
  };

  BlogCampaign.deleteMany = async (where) => {
    db.deletedCampaigns = where;
    db.deleteOrder.push('campaigns');
    return { deletedCount: db.campaigns.length };
  };

  BlogSite.deleteOne = async (where) => {
    db.deletedSite = where;
    db.deleteOrder.push('site');
    return { deletedCount: 1 };
  };

  BlogPost.countDocuments = async () => db.articles.length;
  BlogCampaign.countDocuments = async () => db.campaigns.length;

  cloudflare.answer = { ok: true, output: '' };
  cloudflare.release = { detached: { ok: true }, dns: { ok: true, removed: true } };
  cloudflare.calls.length = 0;
  cloudflare.releaseCalls.length = 0;
}

function req(over = {}) {
  return Object.assign({
    id: 'req-1',
    user: { _id: USER_ID },
    params: { id: BLOG_ID },
    body: {},
  }, over);
}

function res() {
  const out = { status: 200, html: '', redirected: null };
  return {
    out,
    locals: { csrfField: '<input name="_csrf" value="t">' },
    status(code) { out.status = code; return this; },
    send(html) { out.html = String(html); return this; },
    redirect(url) { out.redirected = url; return this; },
  };
}

async function call(h, r = req()) {
  const response = res();
  await h(r, response);
  return response.out;
}

/* ======================================================================= */

section('IT IS REACHABLE WITHOUT TYPING THE URL');

test('THE SIDEBAR LINKS TO IT', async () => {
  /* THE SECOND TIME THIS HAS HAPPENED IN THIS APP, and the first one is
   * written up in utils/appHeader.js: Blog Automation spent weeks reachable
   * only by typing /blog-sites, so for every customer who had not been told
   * about it, the feature did not exist.
   *
   * This screen shipped the same way. Edwin deployed it and asked where the
   * Cloudflare feature was — there was no link to it anywhere.
   *
   * The assertion lives in the FEATURE's suite rather than the header's, so
   * whoever builds the next screen copies it along with everything else
   * here. A route with no entry point is not a feature. */
  const { appSidebar } = require('./utils/appHeader');

  const html = appSidebar('/dashboard')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  assert.ok(/href="\/static-blogs"/.test(html),
    'nothing in the app links to this screen, so nobody will find it');
});

section('A BLOG IN THE URL IS ONLY YOURS IF IT IS YOURS');

test('the blog page loads your own blog', async () => {
  install();
  const out = await call(handler('get', '/static-blogs/:id'));

  assert.strictEqual(out.status, 200);
  assert.ok(out.html.includes('Leander Water Heaters'), 'the blog name is not on the page');
});

test('ANOTHER ACCOUNT\'S BLOG IS NOT FOUND, NOT FORBIDDEN', async () => {
  /* Returning 403 would confirm the id exists. "Not here" says nothing
   * either way. */
  install();
  db.blogs[0].user = OTHER_USER;

  const out = await call(handler('get', '/static-blogs/:id'));

  assert.strictEqual(out.status, 404);
  assert.ok(!out.html.includes('Leander Water Heaters'), 'the other account\'s blog was rendered');
});

test('AND THE OWNER IS IN THE QUERY, NOT CHECKED AFTERWARDS', async () => {
  /* Both are correct today. Only one of them is still correct after somebody
   * adds an early return above the comparison. */
  install();
  await call(handler('get', '/static-blogs/:id'));

  assert.strictEqual(String(db.findOneWhere.user), USER_ID,
    'the blog is loaded by id alone and the owner compared later');
  assert.strictEqual(String(db.findOneWhere._id), BLOG_ID);
});

test('a WordPress site cannot be driven from this screen', async () => {
  /* It has a plugin collecting its posts. Two ways to drive one site is how
   * the server's record and the site's drift apart. */
  install();
  db.blogs[0].target = 'wordpress';

  assert.strictEqual((await call(handler('get', '/static-blogs/:id'))).status, 404);
  assert.strictEqual(db.findOneWhere.target, 'cloudflare',
    'the screen does not filter on the target at all');
});

test('a junk id never reaches the database', async () => {
  install();
  const out = await call(handler('get', '/static-blogs/:id'), req({ params: { id: 'not-an-id' } }));

  assert.strictEqual(out.status, 404);
  assert.strictEqual(db.findOneWhere, null, 'a malformed id was sent to Mongo');
});

test('AND PLANNING IS GUARDED THE SAME WAY', async () => {
  /* The read being safe is not the point. This is the handler that will
   * spend credits once approving exists. */
  install();
  db.blogs[0].user = OTHER_USER;

  const out = await call(handler('post', '/static-blogs/:id/plan'), req({
    body: { targetUrl: 'https://x.com/p/', targetKeyword: 'k', topics: 'One\nTwo' },
  }));

  assert.strictEqual(out.status, 404);
});

section('CREATING ONE');

test('a Cloudflare blog is created with no licence key and no secret', async () => {
  /* The whole difference from /blog-sites. There is no plugin to paste a key
   * into, and requireSite refuses a site that is not WordPress before it
   * looks at a signature — so a key here would be a credential that
   * authenticates nothing. */
  install({ blogs: [] });

  const out = await call(handler('post', '/static-blogs'), req({
    body: { name: 'Leander Water Heaters', domain: 'https://LeanderWaterHeaters.com/' },
  }));

  assert.strictEqual(db.created.target, 'cloudflare');
  assert.strictEqual(db.created.business.name, 'Leander Water Heaters');
  assert.ok(!('licenceKeyHash' in db.created), 'a licence key was issued to a static blog');
  assert.ok(!('secret' in db.created), 'a signing secret was issued to a static blog');
  assert.ok(out.redirected, 'the browser was not sent anywhere afterwards');
});

test('THE DOMAIN IS NORMALISED BEFORE IT IS STORED', async () => {
  /* 'https://LeanderWaterHeaters.com/' and 'leanderwaterheaters.com' are one
   * domain. Stored raw, the duplicate check below would miss, and two blogs
   * would deploy over each other. */
  install({ blogs: [] });

  await call(handler('post', '/static-blogs'), req({
    body: { name: 'X', domain: 'https://LeanderWaterHeaters.com/' },
  }));

  assert.strictEqual(db.created.siteUrl, 'leanderwaterheaters.com');
});

test('and the same domain twice is refused', async () => {
  install();

  const out = await call(handler('post', '/static-blogs'), req({
    body: { name: 'Again', domain: 'https://www.leanderwaterheaters.com' },
  }));

  assert.strictEqual(out.status, 400);
  assert.strictEqual(db.created, null, 'a second blog was created on the same domain');
});

test('A DOMAIN THIS ACCOUNT DOES NOT HOST IS FLAGGED BEFORE ANYTHING IS WRITTEN', async () => {
  /* THE WHOLE POINT, AND IT COST A CAMPAIGN TO LEARN. Edwin typed
   * `all-bout-hvac-explr-home.com` meaning `all-about-hvac.explr-home.com`
   * — one dot became a hyphen, which is a different domain entirely. The
   * app found out only at publish time, after a campaign was approved,
   * three articles were written and charged for, and the site deployed
   * with every canonical naming an address that does not exist. */
  install({ blogs: [] });
  zones.find = { ok: false, noZone: true, error: 'No zone in this Cloudflare account matches it.' };
  zones.list = { ok: true, names: ['explr-home.com'] };

  const out = await call(handler('post', '/static-blogs'), req({
    body: { name: 'All About HVAC', domain: 'all-bout-hvac-explr-home.com' },
  }));

  assert.ok(!out.redirected, 'it redirected past the warning');
  assert.ok(/No domain in your Cloudflare account matches/i.test(out.html),
    'the screen does not say the domain is unreachable');
});

test('AND IT SUGGESTS THE DOMAIN THAT WAS PROBABLY MEANT', async () => {
  install({ blogs: [] });
  zones.find = { ok: false, noZone: true, error: 'no' };
  zones.list = { ok: true, names: ['explr-home.com'] };

  const out = await call(handler('post', '/static-blogs'), req({
    body: { name: 'All About HVAC', domain: 'all-bout-hvac-explr-home.com' },
  }));

  assert.ok(out.html.includes('all-bout-hvac.explr-home.com'),
    'it does not offer the corrected domain');
  assert.ok(/Did you mean/i.test(out.html));
});

test('BUT THE BLOG IS STILL CREATED, BECAUSE IT WARNS RATHER THAN BLOCKS', async () => {
  /* A blog on a domain Cloudflare does not host is a legitimate thing to
   * want — the owner points the DNS himself and everything else works.
   * Refusing would break that to catch a typo. */
  install({ blogs: [] });
  zones.find = { ok: false, noZone: true, error: 'no' };

  const out = await call(handler('post', '/static-blogs'), req({
    body: { name: 'Elsewhere', domain: 'blog.somewhere-else.com' },
  }));

  assert.ok(db.created, 'the blog was refused rather than flagged');
  assert.strictEqual(db.created.siteUrl, 'blog.somewhere-else.com');
  assert.ok(/Carry on with this domain/i.test(out.html), 'there is no way past the warning');

  /* 200, NOT 400. The blog WAS created; this page is a heads-up, not a
   * rejection. Found by mutation: adding a 400 here broke nothing, and a
   * 400 is what a browser, a log and the next developer all read as
   * "this failed". */
  assert.strictEqual(out.status, 200, 'a successful creation answered with an error status');
});

test('AND A MATCHING DOMAIN GOES STRAIGHT THROUGH, AS IT DID BEFORE', async () => {
  install({ blogs: [] });
  zones.find = { ok: true, id: 'z1', name: 'explr-home.com' };

  const out = await call(handler('post', '/static-blogs'), req({
    body: { name: 'All About HVAC', domain: 'all-about-hvac.explr-home.com' },
  }));

  assert.ok(out.redirected, 'a perfectly good domain was interrupted by a warning');
});

test('AND A LOOKUP THAT COULD NOT RUN DOES NOT CLAIM THE DOMAIN IS WRONG', async () => {
  /* THE HALF THAT STOPS THIS BEING WORSE THAN NOTHING. No credentials, or a
   * token without Zone:Read, also comes back ok:false. Telling somebody
   * their domain is not in their account on that basis is a confident lie,
   * and they would go and look for a problem that is not there. Only the
   * noZone branch warns. */
  install({ blogs: [] });
  zones.find = { ok: false, error: 'No Cloudflare credentials.' };

  const out = await call(handler('post', '/static-blogs'), req({
    body: { name: 'X', domain: 'all-about-hvac.explr-home.com' },
  }));

  assert.ok(out.redirected, 'a failed lookup was reported as a bad domain');
  assert.ok(db.created, 'a failed lookup stopped the blog being created');
});

test('AND IT STILL WARNS WHEN THE ZONE LIST CANNOT BE READ', async () => {
  /* The suggestion is a bonus; the warning is the point. A token that can
   * check one zone but not list them all still catches the typo, just
   * without naming the fix. */
  install({ blogs: [] });
  zones.find = { ok: false, noZone: true, error: 'no' };
  zones.list = { ok: false, error: 'nope' };

  const out = await call(handler('post', '/static-blogs'), req({
    body: { name: 'X', domain: 'all-bout-hvac-explr-home.com' },
  }));

  assert.ok(/No domain in your Cloudflare account matches/i.test(out.html));
  assert.ok(!/Did you mean/i.test(out.html), 'it suggested something it could not know');
});

test('a blog with no name or no domain is refused', async () => {
  install({ blogs: [] });

  assert.strictEqual((await call(handler('post', '/static-blogs'), req({ body: { name: '', domain: 'x.com' } }))).status, 400);
  assert.strictEqual((await call(handler('post', '/static-blogs'), req({ body: { name: 'X', domain: '' } }))).status, 400);
  assert.strictEqual(db.created, null);
});

section('THE RULES ARE NOT IN THIS FILE');

test('THE ROUTE CARRIES NO PLANNING RULES OF ITS OWN', async () => {
  /* The reason the 200 lines moved. A rule reappearing here means the plugin
   * and this screen can disagree about what a valid campaign is, and the
   * disagreement would show up as "it worked in wp-admin". */
  const src = require('fs').readFileSync(require.resolve('./routes/staticBlogsRoute'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  assert.match(src, /createCampaign\(/, 'the screen does not call the shared planner');

  for (const forbidden of [/planForCampaign/, /conflictMessage/, /topics\.length > 52/, /quotePosts/]) {
    assert.ok(!forbidden.test(src), `the screen has its own copy of ${forbidden}`);
  }
});

/* THERE IS NO "the body it hands over" TEST, AND THAT IS DELIBERATE.
 *
 * One was half-written here: it stubbed createCampaign and asserted the
 * shape of the argument. It could not work — the route destructures the
 * function at require time, so a stub on the module object is never called
 * — and worse, it ended in assert.ok(true), which is a test that reports
 * success for every possible state of the code.
 *
 * Asserting the argument would have been weaker anyway. The tests below run
 * the form through the REAL planner: if the schedule, the topics or the
 * target page arrive in the wrong shape, planning fails or the dates come
 * out wrong, and they say so. A stub can only prove the shape matched
 * whatever the test author believed the shape was. */

section('Turning a form into topics');

test('ONE TOPIC PER LINE, AND BLANK LINES ARE NOT TOPICS', async () => {
  install();

  /* THE ONE-SHAPE STUB THAT USED TO BE HERE IS GONE. It overrode install()'s
   * and broke the planner's prior-anchor lookup, so this test failed with a
   * 500 — the exact fault the comment in install() describes, written by me
   * two minutes after writing the comment. install() handles both shapes. */

  /* Driven through the handler rather than by exporting the parser, because
   * what matters is what the planner is handed — not what a helper returns
   * in isolation. The planner refuses for its own reasons here; the topics
   * it was given are read off the error page it produced. */
  const out = await call(handler('post', '/static-blogs/:id/plan'), req({
    body: {
      targetUrl: 'https://example.com/water-heater-repair/',
      targetKeyword: 'water heater repair leander',
      topics: '\n  Signs your water heater is failing  \n\n  Repair costs | water heater repair cost \n\n',
      startDate: '2026-11-03', gapDays: '7', hour: '9',
    },
  }));

  assert.strictEqual(out.status, 200, `planning failed: ${out.html.slice(0, 400)}`);
  assert.ok(out.html.includes('Signs your water heater is failing'), 'the first topic is missing');
  assert.ok(out.html.includes('water heater repair cost'), 'the pipe-separated search phrase was dropped');
  assert.ok(!/<td>\s*<\/td>/.test(out.html), 'a blank line became a topic');
});

test('a topic with no phrase after the pipe uses itself', async () => {
  install();

  const out = await call(handler('post', '/static-blogs/:id/plan'), req({
    body: {
      targetUrl: 'https://example.com/water-heater-repair/',
      targetKeyword: 'water heater repair leander',
      topics: 'Why hot water runs out faster\nHow long a water heater lasts',
      startDate: '2026-11-03', gapDays: '7', hour: '9',
    },
  }));

  assert.strictEqual(out.status, 200, out.html.slice(0, 300));
  assert.ok(out.html.includes('Why hot water runs out faster'));
});

section('WHAT THE PLANNED PAGE SAYS');

test('it prints the cost and whether it is affordable', async () => {
  install();

  const out = await call(handler('post', '/static-blogs/:id/plan'), req({
    body: {
      targetUrl: 'https://example.com/water-heater-repair/',
      targetKeyword: 'water heater repair leander',
      topics: 'One good topic about heaters\nAnother separate topic entirely',
      startDate: '2026-11-03', gapDays: '7', hour: '9',
    },
  }));

  /* THE SENTENCE, NOT THE WORD. "credits" on its own matched the site's own
   * navigation, so deleting the cost from the page passed this test. Found
   * by mutation. */
  assert.match(out.html.replace(/\s+/g, ' '), /\d+ posts, \d+ credits/,
    'the campaign cost is not on the page');
  assert.match(out.html.replace(/\s+/g, ' '), /You have \d+/,
    'the credit balance is not on the page');
});

test('AND IT SAYS NOTHING HAS BEEN CHARGED', async () => {
  /* The page lists posts and a credit total, which reads like a receipt. It
   * is a draft — and approving is not even built. Saying so is the
   * difference between "planned" and "spent". */
  install();

  const out = await call(handler('post', '/static-blogs/:id/plan'), req({
    body: {
      targetUrl: 'https://example.com/water-heater-repair/',
      targetKeyword: 'water heater repair leander',
      topics: 'One good topic about heaters\nAnother separate topic entirely',
      startDate: '2026-11-03', gapDays: '7', hour: '9',
    },
  }));

  /* WHITESPACE-TOLERANT. The sentence is wrapped across two lines in the
   * template, so a literal match on the phrase failed while the page said
   * exactly the right thing. A test that depends on where a line breaks is
   * a test that fails the next time somebody reflows the HTML. */
  assert.match(out.html.replace(/\s+/g, ' '), /nothing has been charged/i,
    'the page does not say the campaign is only a draft');
});

test('A REFUSAL NAMES THE TOPICS THAT CLASH', async () => {
  /* wp-admin marks the offending rows. On a plain form the nearest thing is
   * printing them — the alternative is telling somebody that some of their
   * fifty topics compete without saying which. */
  install();

  const out = await call(handler('post', '/static-blogs/:id/plan'), req({
    body: {
      targetUrl: 'https://example.com/water-heater-repair/',
      targetKeyword: 'water heater repair leander',
      topics: 'Water heater repair in Leander | water heater repair leander\n'
            + 'Water heater repair, Leander TX | water heater repair leander',
      startDate: '2026-11-03', gapDays: '7', hour: '9',
    },
  }));

  assert.strictEqual(out.status, 400);
  assert.match(out.html, /contains the service page's own search|overlap/i,
    'the refusal does not say which topics clash');
});

test('and an empty topic list is refused by the shared rules', async () => {
  install();

  const out = await call(handler('post', '/static-blogs/:id/plan'), req({
    body: { targetUrl: 'https://example.com/p/', targetKeyword: 'k', topics: '   \n  \n' },
  }));

  assert.strictEqual(out.status, 400);
  assert.match(out.html, /at least one topic/i);
});

section('Escaping');

test('A BLOG NAME WITH HTML IN IT DOES NOT BECOME HTML', async () => {
  install();
  db.blogs[0].business.name = '<script>alert(1)</script>';

  const out = await call(handler('get', '/static-blogs/:id'));

  assert.ok(!out.html.includes('<script>alert(1)</script>'), 'stored XSS on the owner\'s own dashboard');
  assert.ok(out.html.includes('&lt;script&gt;'), 'the name was dropped rather than escaped');
});

test('and so does a topic', async () => {
  install();

  const out = await call(handler('post', '/static-blogs/:id/plan'), req({
    body: {
      targetUrl: 'https://example.com/water-heater-repair/',
      targetKeyword: 'water heater repair leander',
      topics: '<img src=x onerror=alert(1)> heaters failing early\nAnother separate topic entirely',
      startDate: '2026-11-03', gapDays: '7', hour: '9',
    },
  }));

  assert.ok(!out.html.includes('<img src=x'), 'a topic was rendered as markup');
});

/* ======================================================================= */

section('THE SCHEDULE THE FORM ASKED FOR IS THE SCHEDULE IT GETS');

/* THE BUG THESE EXIST FOR, 17 OCTOBER.
 *
 * This screen sent `schedule: { startDate, gapDays, hour }`.
 * campaignPlan.js reads `{ everyDays, publishTime, timezone, startAt }`.
 * Not one name matched, so every field fell through to its default and
 * every campaign planned here was weekly, at 09:00 UTC, starting now —
 * whatever was typed.
 *
 * NOTHING FAILED. No error, no warning, a confirmation page listing dates
 * nobody had asked for. Edwin set one day between posts, got three
 * articles a week apart, pressed Publish and was told nothing was due,
 * because 09:00 UTC had gone and publishDates shifts a run forward by a
 * whole gap when its first slot is already overdue. He went looking for a
 * broken deploy. The deploy was fine.
 *
 * THE PLUGIN WAS NEVER AFFECTED, which is why it hid: class-ie-admin.php
 * has sent the right names all along, so the shared planner looked
 * healthy. The older caller keeps working and nobody suspects the function
 * both of them share.
 *
 * WHY THESE DRIVE THE REAL PLANNER. A test that stubbed createCampaign and
 * asserted the argument's shape would only prove the shape matched what
 * the test author believed — which is the same belief that produced the
 * bug. These read the DATES OFF THE CONFIRMATION PAGE. If a name on either
 * side is renamed, the dates change and these fail. */

/**
 * The dates the confirmation page lists, in order, as YYYY-MM-DD.
 *
 * THE PAGE PRINTS ISO, AND THAT IS NEW. This helper first parsed
 * M/D/YYYY, because the page used toLocaleDateString() — which reads the
 * locale AND the timezone off the process. The suite passed under UTC and
 * under Chicago and failed under Asia/Tokyo, which is how the bug was
 * found: not a test problem, a page showing customers a day their blog
 * does not publish on. See dayIn() in the route.
 */
function plannedDates(html) {
  const rows = html.match(/<td class="text-white-50">(\d{4}-\d{2}-\d{2})<\/td>/g) || [];

  return rows.map(cell => cell.match(/>(\d{4}-\d{2}-\d{2})</)[1]);
}

function planBody(over = {}) {
  return Object.assign({
    name: 'Autumn heaters',
    targetUrl: 'https://example.com/water-heater-repair/',
    targetKeyword: 'water heater repair leander',
    topics: 'Signs a heater is failing\nWhat a repair costs | water heater repair cost\nHow long a heater lasts',
    startDate: '2099-11-03',
    gapDays: '1',
    publishTime: '09:00',
  }, over);
}

test('DAYS BETWEEN POSTS IS HONOURED', async () => {
  /* The field that did nothing. One day apart means one day apart — not
   * the planner's weekly default. */
  install();
  db.blogs[0].timezone = 'America/Chicago';

  const out = await call(handler('post', '/static-blogs/:id/plan'),
    req({ body: planBody({ gapDays: '1' }) }));

  assert.strictEqual(out.status, 200, out.html.slice(0, 400));
  assert.deepStrictEqual(plannedDates(out.html),
    ['2099-11-03', '2099-11-04', '2099-11-05']);
});

test('AND SO IS A WIDER GAP', async () => {
  /* The pair matters. A mapping that hard-coded 1 would pass the test
   * above and be just as broken as one that hard-coded 7. */
  install();
  db.blogs[0].timezone = 'America/Chicago';

  const out = await call(handler('post', '/static-blogs/:id/plan'),
    req({ body: planBody({ gapDays: '14' }) }));

  assert.deepStrictEqual(plannedDates(out.html),
    ['2099-11-03', '2099-11-17', '2099-12-01']);
});

test('THE FIRST POST LANDS ON THE DAY THAT WAS PICKED, NOT THE DAY BEFORE', async () => {
  /* THE NOON ANCHOR, AND WHY IT IS NOT FUSSINESS.
   *
   * The form sends '2099-11-03'. new Date() on that is MIDNIGHT UTC, and
   * in every American zone midnight UTC on the 3rd is still the evening of
   * the 2nd. publishDates reads the instant back as a calendar date in the
   * blog's zone, so without an anchor the campaign starts a day early —
   * for every customer west of Greenwich, every time.
   *
   * Checked in the zone furthest from UTC of the ones we offer, because an
   * off-by-one that Chicago hides, Honolulu will not. */
  install();
  db.blogs[0].timezone = 'Pacific/Honolulu';

  const out = await call(handler('post', '/static-blogs/:id/plan'),
    req({ body: planBody({ gapDays: '1' }) }));

  assert.strictEqual(plannedDates(out.html)[0], '2099-11-03',
    'the campaign started on the wrong calendar day');
});

test('AND NOON IS THE ANCHOR BECAUSE MIDNIGHT DOES NOT ALWAYS EXIST', async () => {
  /* THE SURVIVING MUTANT THAT TURNED OUT TO BE A REAL BUG.
   *
   * Changing the anchor from noon to midnight killed no test. In the US
   * zones it genuinely makes no difference — the conversion is already
   * zone-aware, so midnight in Chicago reads back as the same Chicago day.
   *
   * It is not true everywhere. Chile and Cuba move their clocks AT
   * midnight, so on the spring-forward day the hour 00:00 does not exist.
   * zonedWallTimeToUtc resolves a nonexistent time to the instant just
   * after the jump — which, read back as a calendar date, is the DAY
   * BEFORE. The campaign would start a day early, once a year, in two
   * countries. Nobody would ever reproduce it.
   *
   * 5 September 2027 is that day in Santiago. Noon survives it; midnight
   * reads back as the 4th.
   *
   * THE DATE HAS TO BE IN THE FUTURE, which cost a run. The first version
   * of this used September 2026 — a real transition day, and already past
   * by the time it was written. publishDates shifts an overdue run forward
   * a gap at a time, so the assertion failed for a reason that had nothing
   * to do with the anchor. A fixed date in a test is a date that expires. */
  install();
  db.blogs[0].timezone = 'America/Santiago';

  const out = await call(handler('post', '/static-blogs/:id/plan'),
    req({ body: planBody({ startDate: '2027-09-05', gapDays: '1' }) }));

  assert.strictEqual(plannedDates(out.html)[0], '2027-09-05',
    'the clocks-change day pushed the campaign back a day');
});

test('THE TIME OF DAY IS THE BLOG\'S CLOCK, NOT UTC', async () => {
  /* The whole reason the timezone field was added. 9am in Chicago is
   * 15:00 UTC in November — if the stored instant is 09:00 UTC instead,
   * the posts go out at three in the morning, which is the single most
   * recognisable sign of an automated blog.
   *
   * ASSERTED ON THE STORED INSTANT, not on the page: the confirmation
   * table prints dates only, so a wrong hour would not show there at all.
   * That is exactly how this stayed invisible. */
  install();
  db.blogs[0].timezone = 'America/Chicago';

  await call(handler('post', '/static-blogs/:id/plan'),
    req({ body: planBody({ publishTime: '09:00' }) }));

  const first = new Date(db.created_campaign.slots[0].publishAt);

  assert.strictEqual(first.getUTCHours(), 15,
    '9am Central was not stored as 15:00 UTC');
  assert.strictEqual(db.created_campaign.schedule.timezone, 'America/Chicago',
    'the campaign did not record the zone it was planned in');
  assert.strictEqual(db.created_campaign.schedule.publishTime, '09:00',
    'the campaign did not record the time it was planned for');
});

test('AND THE SAME TIME IN A DIFFERENT ZONE IS A DIFFERENT INSTANT', async () => {
  /* The guard against a mapping that passes the zone along and then
   * ignores it. Chicago and Phoenix are an hour apart in November. */
  install();
  db.blogs[0].timezone = 'America/Phoenix';

  await call(handler('post', '/static-blogs/:id/plan'),
    req({ body: planBody({ publishTime: '09:00' }) }));

  assert.strictEqual(new Date(db.created_campaign.slots[0].publishAt).getUTCHours(), 16,
    '9am Phoenix was not stored as 16:00 UTC');
});

test('MINUTES SURVIVE, WHICH THE OLD HOUR BOX COULD NOT EXPRESS', async () => {
  install();
  db.blogs[0].timezone = 'UTC';

  await call(handler('post', '/static-blogs/:id/plan'),
    req({ body: planBody({ publishTime: '14:45' }) }));

  const first = new Date(db.created_campaign.slots[0].publishAt);

  assert.strictEqual(first.getUTCHours(), 14);
  assert.strictEqual(first.getUTCMinutes(), 45, 'the minutes were thrown away');
});

test('A BLOG WITH NO TIMEZONE FALLS BACK TO UTC RATHER THAN THROWING', async () => {
  /* Edwin's first two blogs were created before the field existed. Intl
   * throws a RangeError on a zone it does not recognise, and a blog that
   * cannot be planned against is worse than one planned an hour out. */
  install();
  delete db.blogs[0].timezone;

  const out = await call(handler('post', '/static-blogs/:id/plan'),
    req({ body: planBody({ publishTime: '09:00' }) }));

  assert.strictEqual(out.status, 200, 'a blog with no zone could not be planned');
  assert.strictEqual(new Date(db.created_campaign.slots[0].publishAt).getUTCHours(), 9);
});

test('AND SO DOES ONE CARRYING NONSENSE', async () => {
  install();
  db.blogs[0].timezone = 'Mars/Olympus_Mons';

  const out = await call(handler('post', '/static-blogs/:id/plan'),
    req({ body: planBody() }));

  assert.strictEqual(out.status, 200, 'a bad stored zone broke planning');
});

test('A MALFORMED TIME BECOMES 9AM RATHER THAN NaN', async () => {
  install();
  db.blogs[0].timezone = 'UTC';

  /* 9AM SPECIFICALLY, NOT MERELY "A VALID DATE".
   *
   * This asserted only that the result was not NaN, and a mutant changing
   * the fallback to '00:00' survived it. Midnight is a valid date and it
   * is the worst possible answer: a malformed value in a field nobody
   * re-reads would quietly schedule every post for midnight, which is the
   * exact giveaway of an automated blog this product exists to avoid. */
  /* UNREADABLE FALLS BACK; OUT OF RANGE IS CLAMPED. Two different
   * answers, and the line between them is whether the shape parsed at all.
   * parseTimeOfDay in schedule.js draws it in exactly the same place, so
   * a value stored here means the same thing there. */
  const expected = [
    ['',          9,  0],
    ['nonsense',  9,  0],
    ['9',         9,  0],   // no minutes: not a time
    [undefined,   9,  0],
    ['25:00',    23,  0],   // clamped, not rejected
    ['09:99',     9, 59],
    ['23:59',    23, 59],
    ['00:00',     0,  0],   // midnight asked for ON PURPOSE is honoured
  ];

  for (const [given, hour, minute] of expected) {
    db.created_campaign = null;

    await call(handler('post', '/static-blogs/:id/plan'),
      req({ body: planBody({ publishTime: given }) }));

    const first = new Date(db.created_campaign.slots[0].publishAt);

    assert.ok(!Number.isNaN(first.getTime()), `${given} produced an invalid date`);
    assert.strictEqual(first.getUTCHours(), hour, `${given} gave the wrong hour`);
    assert.strictEqual(first.getUTCMinutes(), minute, `${given} gave the wrong minute`);
  }
});

test('AN EMPTY FIRST-POST DATE STILL MEANS "AS SOON AS THE CADENCE ALLOWS"', async () => {
  /* campaignPlan.js tests `schedule.startAt ? new Date(...) : undefined`,
   * so '' has to stay '' — turning it into an Invalid Date here would make
   * every slot NaN, and the confirmation page would list em dashes. */
  install();
  db.blogs[0].timezone = 'America/Chicago';

  const out = await call(handler('post', '/static-blogs/:id/plan'),
    req({ body: planBody({ startDate: '' }) }));

  assert.strictEqual(out.status, 200);

  for (const slot of db.created_campaign.slots) {
    assert.ok(!Number.isNaN(new Date(slot.publishAt).getTime()),
      'an empty start date produced an invalid publish date');
  }
});

section('CHOOSING THE BLOG\'S TIMEZONE');

test('THE DROPDOWN IS ON BOTH SCREENS, AND SHOWS WHAT IS STORED', async () => {
  install();
  db.blogs[0].timezone = 'America/Denver';

  const blogPage = await call(handler('get', '/static-blogs/:id'));
  assert.ok(blogPage.html.includes('name="timezone"'),
    'an existing blog cannot have its timezone changed');
  assert.ok(blogPage.html.includes('value="America/Denver" selected'),
    'the stored zone is not shown as the current one');

  const list = await call(handler('get', '/static-blogs'));
  assert.ok(list.html.includes('name="timezone"'),
    'a new blog cannot be given a timezone');
});

test('A NEW BLOG STORES THE ZONE THAT WAS PICKED', async () => {
  install();
  db.blogs.length = 0;   // so the duplicate check passes

  await call(handler('post', '/static-blogs'), req({
    body: { name: 'Cedar Park Appliance', domain: 'appliancerepaircedarpark.com',
            timezone: 'America/Chicago' },
  }));

  assert.strictEqual(db.created.timezone, 'America/Chicago');
});

test('AND AN UNUSABLE ONE BECOMES UTC RATHER THAN LOSING THE BLOG', async () => {
  /* On the Add form the alternative to a fallback is refusing to create
   * the blog at all, over a dropdown. On the edit screen there is
   * something to go back to, so that one refuses instead — see below. */
  install();
  db.blogs.length = 0;

  await call(handler('post', '/static-blogs'), req({
    body: { name: 'X', domain: 'x.com', timezone: 'Mars/Olympus_Mons' },
  }));

  assert.strictEqual(db.created.timezone, 'UTC');
});

test('CHANGING IT LATER SAVES, AND REFUSES NONSENSE', async () => {
  install();

  const ok = await call(handler('post', '/static-blogs/:id/timezone'),
    req({ body: { timezone: 'America/New_York' } }));

  assert.strictEqual(ok.redirected, `/static-blogs/${BLOG_ID}`);
  assert.deepStrictEqual(db.siteUpdates[0].update, { $set: { timezone: 'America/New_York' } });

  /* REFUSED, NOT QUIETLY DEFAULTED. Falling back to UTC here is the exact
   * failure this field was added to end: somebody picks their zone, the
   * screen says UTC, and nobody looks again. */
  db.siteUpdates.length = 0;
  const bad = await call(handler('post', '/static-blogs/:id/timezone'),
    req({ body: { timezone: 'Mars/Olympus_Mons' } }));

  assert.strictEqual(bad.status, 400);
  assert.strictEqual(db.siteUpdates.length, 0, 'a bad zone was written anyway');
});

test('AND ANOTHER ACCOUNT CANNOT CHANGE IT', async () => {
  install();

  const out = await call(handler('post', '/static-blogs/:id/timezone'),
    req({ user: { _id: OTHER_USER }, body: { timezone: 'America/New_York' } }));

  assert.strictEqual(out.status, 404);
  assert.strictEqual(db.siteUpdates.length, 0, "somebody else's blog was changed");
});

/* ======================================================================= */

section('SUGGESTING TOPICS FROM THE SCREEN');

/**
 * The suggestion rows, as the lines the tick button would write.
 *
 * READ OFF data-line, WHICH IS THE VALUE THAT ACTUALLY MATTERS. The two
 * visible cells are for a person to read; data-line is what the script
 * appends to the topics box, so it is the one that has to be in the
 * format parseTopics understands. A test reading the <td> text would pass
 * while the button wrote something unplannable into the box.
 */
function suggestionLines(html) {
  return [...html.matchAll(/class="form-check-input ie-suggestion"[\s\S]*?data-line="([^"]*)"/g)]
    .map(m => m[1]
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&'));
}

/** The textarea's contents, unescaped, as parseTopics would receive them. */
function topicsBox(html) {
  const m = html.match(/<textarea[^>]*name="topics"[^>]*>([\s\S]*?)<\/textarea>/);
  assert.ok(m, 'the topics box is not on the page any more');

  return m[1]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function suggestReq(over = {}) {
  return req({
    body: Object.assign({
      name: 'Autumn heaters',
      targetUrl: 'https://example.com/water-heater-repair/',
      targetKeyword: 'water heater repair leander',
      topics: '',
      startDate: '2026-11-03', gapDays: '14', publishTime: '07:30',
    }, over.body || {}),
  });
}

function resetModel(over = {}) {
  model.calls = [];
  model.throws = null;
  model.warnings = over.warnings || [];
  model.topics = over.topics || [
    { topic: 'Sediment is what makes a heater pop', targetQuery: 'water heater popping sound' },
    { topic: 'What a repair actually costs', targetQuery: 'water heater repair cost' },
  ];
}

test('THE IDEAS COME BACK AS A LIST TO TICK, IN THE FORMAT THE PLANNER READS', async () => {
  /* THEY USED TO GO STRAIGHT INTO THE BOX, AND THIS TEST USED TO ASSERT
   * THAT. Edwin's screenshot ended it: twelve suggestions in a monospace
   * textarea, every one wrapping onto a second line, and rejecting one
   * meant selecting exactly the right half and pressing delete. "This
   * looks very crowded." He was being asked to EDIT a list he was meant
   * to be CHOOSING from.
   *
   * So the format assertion moved rather than disappeared. Each row still
   * carries `topic | query` — the format parseTopics reads — because that
   * is what the tick button writes into the box, and a row carrying
   * anything else would put something unplannable there. */
  install();
  resetModel();

  const out = await call(handler('post', '/static-blogs/:id/suggest'), suggestReq());

  assert.strictEqual(out.status, 200);

  const lines = suggestionLines(out.html);

  assert.deepStrictEqual(lines, [
    'Sediment is what makes a heater pop | water heater popping sound',
    'What a repair actually costs | water heater repair cost',
  ], `the suggestions are not offered in a plannable form:\n${lines.join('\n')}`);
});

test('AND THE TOPICS BOX IS LEFT ALONE UNTIL SOMEBODY TICKS SOMETHING', async () => {
  /* THE CHANGE IN BEHAVIOUR, PINNED. Pressing Suggest and then Plan
   * without ticking anything plans what you typed and nothing else. The
   * card says so on screen; this is the assertion that keeps it true. */
  install();
  resetModel();

  const out = await call(handler('post', '/static-blogs/:id/suggest'),
    suggestReq({ body: { topics: 'One I wrote myself | my own phrase' } }));

  const lines = topicsBox(out.html).split('\n').map(l => l.trim()).filter(Boolean);

  assert.deepStrictEqual(lines, ['One I wrote myself | my own phrase'],
    'a suggestion wrote itself into the box without being ticked');
});

/* ------------------------------------------------------------------------
 * RUNNING THE SUGGESTION SCRIPT, BECAUSE READING IT IS NOT ENOUGH
 *
 * The first version of that card shipped broken and every assertion in
 * this file passed. The markup was perfect — table, checkboxes, button,
 * data-line, all exactly as asserted — and pressing the button did
 * nothing at all. No error, no console message.
 *
 * The card renders ABOVE the topics box, so the inline <script> ran
 * before the browser had parsed the textarea, getElementById('topics')
 * returned null, and the function returned at its own guard. Edwin found
 * it in half a minute: "I pressed Add ticked to my topics and nothing
 * happened."
 *
 * NO jsdom. It is not a dependency of this project and a UI detail is a
 * poor reason to make it one — deploy.sh would install a browser engine
 * on every deploy. The script only touches a handful of DOM methods, so
 * the handful is what gets faked. What runs is the REAL script, pulled
 * out of the REAL rendered page.
 *
 * It was verified against jsdom once, out of tree, to be sure the fake
 * agrees with a browser: the same four behaviours pass in both, and
 * removing the DOMContentLoaded guard fails both.
 * --------------------------------------------------------------------- */

/** Just enough DOM for the suggestion script, and not one method more. */
function fakeDom(html) {
  const listeners = [];
  const el = (over = {}) => Object.assign({
    checked: false,
    indeterminate: false,
    value: '',
    _on: {},
    addEventListener(type, fn) { this._on[type] = fn; },
    dispatch(type) { if (this._on[type]) this._on[type].call(this); },
    click() { this.dispatch('click'); },
    focus() {},
    getAttribute(name) { return this._attrs[name]; },
    _attrs: {},
  }, over);

  /* The rows, built from the rendered markup rather than invented, so a
   * change to data-line shows up here as it would in a browser. */
  const rows = [...html.matchAll(/class="form-check-input ie-suggestion"([\s\S]*?)>/g)]
    .map(m => {
      const line = /data-line="([^"]*)"/.exec(m[1]);
      const node = el({ checked: /\bchecked\b/.test(m[1]) });
      node._attrs['data-line'] = (line ? line[1] : '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
      return node;
    });

  const byId = {
    ieTickAll: el({ checked: /id="ieTickAll" checked/.test(html) }),
    ieAddTicked: el(),
    topics: el({ value: '', selectionStart: 0, selectionEnd: 0 }),
  };

  const document = {
    /* STARTS AS 'loading', WHICH IS THE WHOLE POINT. A fake that reported
     * 'complete' would let the broken version wire up immediately and
     * pass — which is exactly the hole this test exists to close. */
    readyState: 'loading',
    getElementById: (id) => byId[id] || null,
    querySelectorAll: () => rows,
    addEventListener(type, fn) { listeners.push({ type, fn }); },
  };

  return {
    document,
    rows,
    el: byId,
    /** What the browser does once the page is parsed. */
    finishLoading() {
      document.readyState = 'interactive';
      listeners.filter(l => 'DOMContentLoaded' === l.type).forEach(l => l.fn());
    },
  };
}

/** The suggestion script out of the rendered page, ready to run. */
function suggestionScript(html) {
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const src = blocks.find(s => s.includes('ieAddTicked'));

  assert.ok(src, 'the suggestion script is not on the page');
  return src;
}

test('THE BUTTON ACTUALLY WRITES THE TICKED ROWS INTO THE BOX', async () => {
  install();
  resetModel();

  const out = await call(handler('post', '/static-blogs/:id/suggest'), suggestReq());
  const dom = fakeDom(out.html);

  // eslint-disable-next-line no-new-func
  new Function('document', suggestionScript(out.html))(dom.document);

  /* NOTHING IS BOUND YET, and the broken version bound here. */
  dom.el.ieAddTicked.click();
  assert.strictEqual(dom.el.topics.value, '',
    'the script wired itself up before the page had finished loading');

  dom.finishLoading();

  dom.el.ieAddTicked.click();

  assert.deepStrictEqual(dom.el.topics.value.split('\n'), [
    'Sediment is what makes a heater pop | water heater popping sound',
    'What a repair actually costs | water heater repair cost',
  ], 'the ticked rows did not reach the topics box');
});

test('AND APPENDS, RATHER THAN WELDING ONTO THE LAST LINE', async () => {
  /* A textarea that does not end in a newline would otherwise get the
   * first suggestion stuck onto the end of what was typed — one topic
   * where there were meant to be two, and it would be planned that way. */
  install();
  resetModel();

  const out = await call(handler('post', '/static-blogs/:id/suggest'), suggestReq());
  const dom = fakeDom(out.html);

  // eslint-disable-next-line no-new-func
  new Function('document', suggestionScript(out.html))(dom.document);
  dom.finishLoading();

  dom.el.topics.value = 'One I wrote myself';
  dom.el.ieAddTicked.click();

  const lines = dom.el.topics.value.split('\n');

  assert.strictEqual(lines.length, 3, `expected three lines, got:\n${dom.el.topics.value}`);
  assert.strictEqual(lines[0], 'One I wrote myself', 'the typed line was changed');
  assert.ok(lines[1].startsWith('Sediment'), 'the suggestion did not land on its own line');
});

test('AND UNTICKS WHAT IT ADDED, SO NOTHING GOES IN TWICE', async () => {
  install();
  resetModel();

  const out = await call(handler('post', '/static-blogs/:id/suggest'), suggestReq());
  const dom = fakeDom(out.html);

  // eslint-disable-next-line no-new-func
  new Function('document', suggestionScript(out.html))(dom.document);
  dom.finishLoading();

  dom.el.ieAddTicked.click();
  assert.ok(dom.rows.every(r => !r.checked), 'the rows stayed ticked');

  const after = dom.el.topics.value;
  dom.el.ieAddTicked.click();
  assert.strictEqual(dom.el.topics.value, after, 'a second press added them again');
});

test('THE HEADER BOX TICKS THE LOT, AND FOLLOWS THE ROWS BACK', async () => {
  install();
  resetModel();

  const out = await call(handler('post', '/static-blogs/:id/suggest'), suggestReq());
  const dom = fakeDom(out.html);

  // eslint-disable-next-line no-new-func
  new Function('document', suggestionScript(out.html))(dom.document);
  dom.finishLoading();

  dom.el.ieTickAll.checked = false;
  dom.el.ieTickAll.dispatch('change');
  assert.ok(dom.rows.every(r => !r.checked), 'unticking the header left rows ticked');

  dom.el.ieTickAll.checked = true;
  dom.el.ieTickAll.dispatch('change');
  assert.ok(dom.rows.every(r => r.checked), 'ticking the header left rows unticked');

  /* And back the other way, so the header cannot sit there ticked over a
   * part-ticked list and invite a click that unticks everything. */
  dom.rows[0].checked = false;
  dom.rows[0].dispatch('change');

  assert.strictEqual(dom.el.ieTickAll.checked, false, 'the header stayed ticked');
  assert.strictEqual(dom.el.ieTickAll.indeterminate, true, 'the header is not indeterminate');
});

/* ------------------------------------------------------------------------
 * THE BUSY STATE, WHICH IS ALSO RUN RATHER THAN READ
 * --------------------------------------------------------------------- */

/** The busy script out of the rendered page. */
function busyScript(html) {
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const src = blocks.find(s => s.includes('iePlanForm'));

  assert.ok(src, 'the busy script is not on the page');
  return src;
}

/** A form that can be submitted, and the buttons in it. */
function fakeForm() {
  const button = (over = {}) => Object.assign({
    innerHTML: '',
    disabled: false,
    _attrs: {},
    getAttribute(n) { return this._attrs[n] === undefined ? null : this._attrs[n]; },
  }, over);

  const suggest = button();
  suggest._attrs['data-busy'] = 'Thinking';
  suggest._attrs.name = 'fresh';

  const plan = button();
  plan._attrs['data-busy'] = 'Planning';

  const form = {
    _on: {},
    addEventListener(type, fn) { this._on[type] = fn; },
    querySelectorAll: () => [suggest, plan],
    submit(submitter) { this._on.submit({ submitter }); },
  };

  const timers = [];

  return {
    form, suggest, plan,
    document: {
      readyState: 'loading',
      getElementById: (id) => ('iePlanForm' === id ? form : null),
      addEventListener(type, fn) { if ('DOMContentLoaded' === type) this._ready = fn; },
    },
    /** Run the deferred disable, which is what a browser would do next. */
    tick() { timers.splice(0).forEach(fn => fn()); },
    setTimeout: (fn) => { timers.push(fn); },
  };
}

test('A SUBMIT BUTTON SAYS IT IS WORKING', async () => {
  /* Suggesting is a model call — several seconds of a page that looks
   * exactly as it did before the press. "Nothing happened" is the honest
   * reading of that, and it is what Edwin said about this screen twice. */
  install();
  resetModel();

  const out = await call(handler('post', '/static-blogs/:id/suggest'), suggestReq());
  const dom = fakeForm();

  // eslint-disable-next-line no-new-func
  new Function('document', 'setTimeout', busyScript(out.html))(dom.document, dom.setTimeout);
  dom.document._ready();

  dom.form.submit(dom.suggest);

  assert.ok(/spinner-border/.test(dom.suggest.innerHTML), 'the button shows no spinner');
  assert.ok(/Thinking/.test(dom.suggest.innerHTML), 'the button does not say what it is doing');
});

test('AND IS NOT DISABLED BEFORE ITS VALUE HAS BEEN SENT', async () => {
  /* THE TRAP THIS WHOLE DESIGN IS SHAPED AROUND. A disabled submit
   * button's name and value are left OUT of the submission. Disable it
   * inside the submit handler and `fresh=1` never arrives — so "Suggest
   * different ones" silently becomes "Suggest topics", and the only
   * symptom is the same ideas coming back. Same for mode=publishAll on
   * the publish form, where the cost would be higher.
   *
   * So the disable is deferred by a tick. This asserts the order. */
  install();
  resetModel();

  const out = await call(handler('post', '/static-blogs/:id/suggest'), suggestReq());
  const dom = fakeForm();

  // eslint-disable-next-line no-new-func
  new Function('document', 'setTimeout', busyScript(out.html))(dom.document, dom.setTimeout);
  dom.document._ready();

  dom.form.submit(dom.suggest);

  assert.strictEqual(dom.suggest.disabled, false,
    'the button was disabled during submit, so its value was dropped');

  dom.tick();

  assert.strictEqual(dom.suggest.disabled, true, 'the button never went quiet');
  assert.strictEqual(dom.plan.disabled, true,
    'another action could still be started on top of this one');
});

test('AND A BUTTON WITH NOTHING TO SAY IS LEFT ALONE', async () => {
  /* The handler is on the form, so it sees every submit. A button with
   * no data-busy must come through untouched rather than having its
   * label replaced by an empty spinner. */
  install();
  resetModel();

  const out = await call(handler('post', '/static-blogs/:id/suggest'), suggestReq());
  const dom = fakeForm();

  // eslint-disable-next-line no-new-func
  new Function('document', 'setTimeout', busyScript(out.html))(dom.document, dom.setTimeout);
  dom.document._ready();

  const plain = { innerHTML: 'Something else', disabled: false, getAttribute: () => null };
  dom.form.submit(plain);

  assert.strictEqual(plain.innerHTML, 'Something else', 'a plain button was overwritten');
});

test('THE SUGGEST BUTTONS CARRY A BUSY LABEL AT ALL', async () => {
  /* The script does nothing for a button without one, so a button added
   * later with no data-busy is a button that silently stays dead-looking
   * for the five seconds a model call takes. */
  install();
  const out = await call(handler('get', '/static-blogs/:id'));

  const buttons = out.html.match(/<button[^>]*type="submit"[\s\S]*?<\/button>/g) || [];
  const suggesters = buttons.filter(b => /\/suggest/.test(b));

  assert.strictEqual(suggesters.length, 2, 'the two suggest buttons are not both there');
  for (const b of suggesters) {
    assert.ok(/data-busy=/.test(b), 'a suggest button shows nothing while it waits');
  }
});

test('EVERY ROW IS TICKED TO START WITH, AND ONE BOX CLEARS THEM ALL', async () => {
  /* "I want most of these" and "I want two of these" should both start
   * with one click. Ticked by default serves the first; the header box
   * serves the second. */
  install();
  resetModel();

  const out = await call(handler('post', '/static-blogs/:id/suggest'), suggestReq());

  const rows = out.html.match(/class="form-check-input ie-suggestion"[^>]*>/g) || [];

  assert.strictEqual(rows.length, 2, 'the suggestions are not rows');
  for (const row of rows) {
    assert.ok(/\bchecked\b/.test(row), 'a suggestion came back unticked');
  }

  assert.ok(out.html.includes('id="ieTickAll"'), 'there is no tick-all box');
  assert.ok(out.html.includes('id="ieAddTicked"'), 'there is no way to add the ticked ones');
});

test('everything else the person typed survives the round trip', async () => {
  install();
  resetModel();

  const out = await call(handler('post', '/static-blogs/:id/suggest'), suggestReq());

  assert.ok(out.html.includes('value="Autumn heaters"'), 'the campaign name was lost');
  assert.ok(out.html.includes('value="https://example.com/water-heater-repair/"'),
    'the target page was lost');
  assert.ok(out.html.includes('value="water heater repair leander"'), 'the keyword was lost');
  assert.ok(out.html.includes('value="2026-11-03"'), 'the start date was lost');
  assert.ok(out.html.includes('value="14"'), 'the gap was reset to the default');

  /* THE TIME, AND IT USED TO BE AN HOUR NUMBER. The field was type=number
   * 0–23 whose answer the planner then read as UTC — nine meaning four in
   * the morning in Texas. It is now type=time against the blog's own zone,
   * which is also why this asserts on 07:30 rather than on 7: a time field
   * that lost its minutes would pass the old assertion. */
  assert.ok(out.html.includes('value="07:30"'), 'the posting time was reset to the default');
});

test('THE ROUTE CARRIES NO SUGGESTION RULES OF ITS OWN', async () => {
  /* Same guarantee the planning tests make. The clamp, the avoid list and
   * its cap live in suggestForSite because the plugin uses them too; a copy
   * here is how the screen and wp-admin start suggesting differently. */
  install();
  resetModel();

  await call(handler('post', '/static-blogs/:id/suggest'), suggestReq());

  assert.strictEqual(model.calls.length, 1, 'the shared suggester was not called');

  const { ctx, opts } = model.calls[0];
  assert.strictEqual(opts.count, 6, 'the route chose its own count instead of the shared default');
  assert.ok(Array.isArray(opts.avoid), 'the avoid list never reached the model');
  assert.strictEqual(ctx.targetPage.keyword, 'water heater repair leander');

  /* AND IT IS THIS BLOG THAT WAS PASSED, not some stand-in. `site` does two
   * jobs: it scopes the already-used lookup, and it is where the business
   * comes from. A mutation that handed over an empty object passed every
   * other assertion here — the suggestions would simply have been generic,
   * and the avoid list scoped to nothing, with no error to show for it. */
  assert.strictEqual(ctx.business.name, 'Leander Water Heaters',
    'the blog itself was not the site handed to the suggester');
});

test('a refusal keeps the form and says why', async () => {
  /* No keyword, so suggestForSite refuses before calling anything. The
   * person must not lose the topics they had already written. */
  install();
  resetModel();

  const out = await call(handler('post', '/static-blogs/:id/suggest'),
    suggestReq({ body: { targetKeyword: '', topics: 'Something I typed' } }));

  assert.strictEqual(out.status, 400);
  assert.strictEqual(model.calls.length, 0, 'the model was called with no keyword');
  assert.ok(/target page with a keyword/i.test(out.html), 'the page does not say what went wrong');
  assert.ok(topicsBox(out.html).includes('Something I typed'), 'the typed topics were lost');
});

test('and a model failure does not lose the form either', async () => {
  install();
  resetModel();
  model.throws = new Error('upstream 500 from the provider');

  const out = await call(handler('post', '/static-blogs/:id/suggest'),
    suggestReq({ body: { topics: 'Something I typed' } }));

  assert.strictEqual(out.status, 502);
  assert.ok(topicsBox(out.html).includes('Something I typed'), 'the typed topics were lost');
  assert.ok(!/upstream|provider/i.test(out.html),
    "the provider's own error was printed on the page");
});

test('ANOTHER ACCOUNT CANNOT GET SUGGESTIONS FOR YOUR BLOG', async () => {
  install();
  resetModel();

  const out = await call(handler('post', '/static-blogs/:id/suggest'),
    req({ user: { _id: OTHER_USER }, body: suggestReq().body }));

  assert.strictEqual(out.status, 404);
  assert.strictEqual(model.calls.length, 0, 'a model call was made for somebody else\'s blog');
});

test('and neither can a WordPress site, through this screen', async () => {
  install();
  resetModel();
  db.blogs[0].target = 'wordpress';

  const out = await call(handler('post', '/static-blogs/:id/suggest'), suggestReq());

  assert.strictEqual(out.status, 404);
  assert.strictEqual(model.calls.length, 0);
});

test('A SUGGESTED TOPIC WITH HTML IN IT DOES NOT BECOME HTML', async () => {
  /* The model's output is not ours and lands straight in a textarea. */
  install();
  resetModel({
    topics: [{ topic: '</textarea><img src=x onerror=alert(1)>', targetQuery: 'q' }],
  });

  const out = await call(handler('post', '/static-blogs/:id/suggest'), suggestReq());

  assert.ok(!out.html.includes('<img src=x'), 'a suggested topic was rendered as markup');
  assert.ok(!/<\/textarea><img/.test(out.html), 'a suggestion broke out of the textarea');
});

section('APPROVING A CAMPAIGN');

function stubApprove(answer) {
  approve.answer = answer;
  approve.calls.length = 0;
  return approve.calls;
}

const CAMPAIGN = '507f1f77bcf86cd799439055';

function approveReq(over = {}) {
  return req(Object.assign({ params: { id: BLOG_ID, campaignId: CAMPAIGN } }, over));
}

test('THE SCREEN CARRIES NO APPROVAL RULES OF ITS OWN', async () => {
  /* The credit gate, the conditional claim that stops two approvals
   * starting two batches, the poll, the lost-batch detection — all of it
   * is approveCampaign's, because the plugin uses the same rules through
   * /api/blog/write. A copy here is how wp-admin and this screen start
   * charging differently. */
  install();
  const calls = stubApprove({ ok: true, code: 200, body: {
    status: 'writing', jobId: 'j1', done: 0, total: 3, toWrite: 3,
    stage: 'queued', quote: { total: 225 },
  } });

  const out = await call(handler('post', '/static-blogs/:id/campaigns/:campaignId/approve'), approveReq());

  assert.strictEqual(out.status, 200);
  assert.strictEqual(calls.length, 1, 'the shared approver was not called');
  assert.strictEqual(calls[0].body.campaignId, CAMPAIGN, 'a different campaign was approved');
  assert.strictEqual(String(calls[0].site._id), BLOG_ID, 'a different blog was used as the site');
  assert.ok(calls[0].baseUrl, 'no base url was passed, so a credit refusal would be a dead end');
});

test('it says how many posts and what they cost', async () => {
  install();
  stubApprove({ ok: true, code: 200, body: {
    status: 'writing', done: 0, total: 3, toWrite: 3, quote: { total: 225 },
  } });

  const out = await call(handler('post', '/static-blogs/:id/campaigns/:campaignId/approve'), approveReq());

  assert.ok(out.html.includes('225'), 'the cost is not shown');
  assert.ok(/0 of 3/.test(out.html), 'the progress is not shown');
});

test('A CREDIT REFUSAL SHOWS THE SHORTFALL AND A WAY TO FIX IT', async () => {
  /* The most common wall, and until the plugin learnt otherwise it was a
   * dead end: the shortfall and nothing else. */
  install();
  stubApprove({ ok: false, code: 402, body: {
    error: 'This campaign needs 225 credits and you have 10.',
    creditsError: true,
    quote: { total: 225 },
    creditsAvailable: 10,
    buyCreditsUrl: 'https://threecomets.com/buy-credits',
  } });

  const out = await call(handler('post', '/static-blogs/:id/campaigns/:campaignId/approve'), approveReq());

  assert.strictEqual(out.status, 402);
  assert.ok(out.html.includes('225 credits'), 'the shortfall is not shown');
  assert.ok(out.html.includes('https://threecomets.com/buy-credits'),
    'the refusal is a dead end');
});

test('and a campaign already written says so, rather than offering to charge again', async () => {
  install();
  stubApprove({ ok: true, code: 200, body: {
    status: 'written', written: 3, failed: [], readyToCollect: 3, total: 3,
  } });

  const out = await call(handler('post', '/static-blogs/:id/campaigns/:campaignId/approve'), approveReq());

  assert.ok(/every post is written/i.test(out.html), 'a finished campaign is not reported as finished');
  assert.ok(/publish/i.test(out.html), 'nothing tells you what to do next');
});

test('a lost batch comes back as a failure with its reason', async () => {
  install();
  stubApprove({ ok: false, code: 409, body: {
    status: 'failed',
    error: 'The batch stopped. Approve the campaign again to restart it.',
  } });

  const out = await call(handler('post', '/static-blogs/:id/campaigns/:campaignId/approve'), approveReq());

  assert.strictEqual(out.status, 409);
  assert.ok(/approve the campaign again/i.test(out.html), 'nothing says what to do about it');
});

test('ANOTHER ACCOUNT CANNOT APPROVE — AND CANNOT SPEND', async () => {
  /* The one route here that commits money. */
  install();
  const calls = stubApprove({ ok: true, code: 200, body: { status: 'writing' } });

  const out = await call(handler('post', '/static-blogs/:id/campaigns/:campaignId/approve'),
    approveReq({ user: { _id: OTHER_USER } }));

  assert.strictEqual(out.status, 404);
  assert.strictEqual(calls.length, 0, "another account's approval reached the credit gate");
});

test('nor can a WordPress site be driven through this screen', async () => {
  install();
  db.blogs[0].target = 'wordpress';
  const calls = stubApprove({ ok: true, code: 200, body: { status: 'writing' } });

  const out = await call(handler('post', '/static-blogs/:id/campaigns/:campaignId/approve'), approveReq());

  assert.strictEqual(out.status, 404);
  assert.strictEqual(calls.length, 0);
});

test('THE BUTTON IS ON THE PAGE, AND ONLY WHERE IT MAKES SENSE', async () => {
  /* A draft can be approved. One already writing offers a poll instead.
   * A finished one offers neither — approveCampaign would refuse, but a
   * button nobody should press is a button that will be pressed. */
  install({ campaigns: [
    { _id: 'c-draft', name: 'Draft one', status: 'draft', slots: [{}, {}] },
    { _id: 'c-writing', name: 'In flight', status: 'writing', slots: [{}] },
    { _id: 'c-done', name: 'Finished', status: 'completed', slots: [{}] },
  ] });

  const out = await call(handler('get', '/static-blogs/:id'));

  assert.ok(out.html.includes('/campaigns/c-draft/approve'), 'a draft cannot be approved');
  assert.ok(/Approve &amp; write/.test(out.html), 'the approve button is missing');

  assert.ok(out.html.includes('/campaigns/c-writing/approve'), 'a running batch cannot be polled');
  assert.ok(/Check progress/.test(out.html), 'there is no way to see progress');

  assert.ok(!out.html.includes('/campaigns/c-done/approve'),
    'a finished campaign offers a button that would do nothing');
});

section('PUBLISHING');

/* Nothing here renders, spawns, or reaches Cloudflare. What is being
 * tested is the translation: a button into a call, and an answer into a
 * page. The stub itself is installed at the top of this file, before the
 * router is required — see the note there. */
function stubPublish(answer) {
  publish.answer = answer;
  publish.calls.length = 0;
  return publish.calls;
}

const PUBLISHED = {
  ok: true,
  url: 'https://a1b2.leanderwaterheaters.pages.dev',
  project: 'leanderwaterheaters-com',
  files: 7,
  missing: [],
  pages: [
    { isHome: true, url: 'https://leanderwaterheaters.com/', post: { slug: 'first', title: 'First' } },
    { isHome: false, url: 'https://leanderwaterheaters.com/second/', post: { slug: 'second', title: 'Second' } },
  ],
};

test('PREVIEW IS THE DEFAULT, AND IT SENDS NOTHING', async () => {
  /* A Pages deployment IS the site — whatever is not in it is gone. Seeing
   * the file list before pressing the other button is the difference
   * between publishing a blog and replacing one.
   *
   * Default rather than opt-in: anything that is not the publish button,
   * including a malformed post, previews. */
  install();
  const calls = stubPublish({ ...PUBLISHED, dryRun: true, url: undefined });

  for (const body of [{ mode: 'preview' }, {}, { mode: 'nonsense' }]) {
    calls.length = 0;
    const out = await call(handler('post', '/static-blogs/:id/publish'), req({ body }));

    assert.strictEqual(out.status, 200);
    assert.strictEqual(calls[0].dryRun, true,
      `${JSON.stringify(body)} published for real`);
  }
});

test('and only the publish button publishes', async () => {
  install();
  const calls = stubPublish(PUBLISHED);

  await call(handler('post', '/static-blogs/:id/publish'), req({ body: { mode: 'publish' } }));

  assert.strictEqual(calls[0].dryRun, false, 'the publish button only previewed');
  assert.strictEqual(String(calls[0].blog._id), BLOG_ID, 'a different blog was published');
});

test('A REAL DEPLOY IS RECORDED ON THE BLOG, A PREVIEW IS NOT', async () => {
  /* A preview that stamped lastDeployAt would tell you the blog is live
   * when nothing had moved. */
  install();
  stubPublish(PUBLISHED);
  await call(handler('post', '/static-blogs/:id/publish'), req({ body: { mode: 'publish' } }));

  assert.strictEqual(db.siteUpdates.length, 1, 'the deploy was not recorded');
  const set = db.siteUpdates[0].update.$set;
  assert.strictEqual(set.project, 'leanderwaterheaters-com', 'the project was not stored');
  assert.strictEqual(set.lastDeployUrl, PUBLISHED.url);
  assert.ok(set.lastDeployAt instanceof Date);

  install();
  stubPublish({ ...PUBLISHED, dryRun: true });
  await call(handler('post', '/static-blogs/:id/publish'), req({ body: { mode: 'preview' } }));

  assert.deepStrictEqual(db.siteUpdates, [], 'a preview was recorded as a deploy');
});

test('the result names every article and where it landed', async () => {
  install();
  stubPublish(PUBLISHED);

  const out = await call(handler('post', '/static-blogs/:id/publish'), req({ body: { mode: 'publish' } }));

  assert.ok(out.html.includes('https://leanderwaterheaters.com/second/'), 'an article is not listed');
  assert.ok(out.html.includes('front page'), 'the front page is not marked');
  assert.ok(out.html.includes(PUBLISHED.url), 'there is no link to the live site');
});

test('A FAILED DEPLOY SHOWS WHY, RATHER THAN A BLANK PAGE', async () => {
  install();
  stubPublish({
    ok: false,
    error: 'The deploy to Cloudflare did not finish.',
    output: 'Project not found [code: 8000007]',
    pages: [], missing: [], files: 0,
  });

  const out = await call(handler('post', '/static-blogs/:id/publish'), req({ body: { mode: 'publish' } }));

  assert.strictEqual(out.status, 400);
  assert.ok(out.html.includes('did not finish'), 'the failure has no message');
  assert.ok(out.html.includes('8000007'), "wrangler's reason is not shown, so nobody can act on it");
  assert.deepStrictEqual(db.siteUpdates, [], 'a failed deploy was recorded as a success');
});

test('AND ARTICLES MISSING A LINK ARE NAMED, NOT WITHHELD', async () => {
  install();
  stubPublish({ ...PUBLISHED, missing: [{ slug: 'second', tokens: ['money'] }] });

  const out = await call(handler('post', '/static-blogs/:id/publish'), req({ body: { mode: 'publish' } }));

  assert.strictEqual(out.status, 200, 'a dropped link token stopped the publish');
  assert.ok(/missing a link/i.test(out.html), 'nothing says a link is missing');
  assert.ok(out.html.includes('second'), 'the article is not named');
});

test('A DROPPED WRITER TOKEN BLAMES THE WRITER, AND ONLY THEN', async () => {
  /* money, prev and next are placed by the writer from the plan. If one
   * is absent there is nothing the owner did wrong and nothing he can
   * fix in a field — the sentence has to say so, and it must not appear
   * when the only missing token is his own. */
  install();
  stubPublish({ ...PUBLISHED, missing: [{ slug: 'second', tokens: ['money'] }] });

  const out = await call(handler('post', '/static-blogs/:id/publish'), req({ body: { mode: 'publish' } }));

  assert.ok(/the writer did not use the phrase/i.test(out.html),
    'a dropped money token does not say the writer dropped it');
  assert.ok(!/Your own link/.test(out.html),
    'a dropped money token sent him to fix a field he never filled in');
});

test('BUT A DROPPED link TOKEN IS HIS OWN, AND SAYS SO', async () => {
  /* THE BUG THIS TEST EXISTS FOR. The warning was written when every
   * token was the writer's. Adding the owner's own marker — typed by
   * hand, into a field only he can fill — meant his omission was
   * reported as the writer's, sending him to read prose that is not
   * where the mistake is. The fix is a sentence, so the test is on the
   * sentence. */
  install();
  stubPublish({ ...PUBLISHED, missing: [{ slug: 'second', tokens: ['link'] }] });

  const out = await call(handler('post', '/static-blogs/:id/publish'), req({ body: { mode: 'publish' } }));

  assert.strictEqual(out.status, 200, 'a dropped link token stopped the publish');
  assert.ok(/Your own link/.test(out.html),
    'it does not name the field he actually filled in');
  assert.ok(out.html.includes('{{link}}'),
    'it does not tell him what to wrap the words in');
  assert.ok(!/the writer did not use the phrase/i.test(out.html),
    'it blamed the writer for a marker the owner types by hand');
});

test('AND BOTH AT ONCE GETS BOTH SENTENCES', async () => {
  install();
  stubPublish({ ...PUBLISHED, missing: [
    { slug: 'first', tokens: ['next'] },
    { slug: 'second', tokens: ['link'] },
  ] });

  const out = await call(handler('post', '/static-blogs/:id/publish'), req({ body: { mode: 'publish' } }));

  assert.ok(/the writer did not use the phrase/i.test(out.html), "the writer's half is missing");
  assert.ok(/Your own link/.test(out.html), "the owner's half is missing");
});

test('A REAL PUBLISH MARKS WHAT WENT LIVE', async () => {
  /* THE WHOLE REASON markPublished EXISTS. A Cloudflare slot used to sit
   * at `ready` for ever — the article on the internet, the campaign record
   * none the wiser — so "what still needs publishing" had no answer and a
   * scheduler could not be built on top of it. */
  install();
  stubPublish(PUBLISHED);
  marked.calls.length = 0;

  await call(handler('post', '/static-blogs/:id/publish'), req({ body: { mode: 'publish' } }));

  assert.strictEqual(marked.calls.length, 1, 'a real publish marked nothing');
  assert.strictEqual(marked.calls[0].pages, PUBLISHED.pages,
    'it was handed something other than what actually deployed');
});

test('AND A PREVIEW MARKS NOTHING AT ALL', async () => {
  /* The half that matters more. A dry run that advanced campaign state
   * would make the preview button destructive — and it is the DEFAULT
   * mode, so it is the one most likely to be pressed by accident. */
  install();
  stubPublish({ ...PUBLISHED, dryRun: true, url: undefined });

  for (const mode of ['preview', 'previewAll', 'nonsense', undefined]) {
    marked.calls.length = 0;
    await call(handler('post', '/static-blogs/:id/publish'), req({ body: { mode } }));

    assert.strictEqual(marked.calls.length, 0,
      `${JSON.stringify(mode)} advanced the campaign without deploying`);
  }
});

test('AND A FAILED DEPLOY MARKS NOTHING EITHER', async () => {
  /* Cloudflare refused it, so it is not on the internet, so it is not
   * published. Marking it here would leave the app certain an article is
   * live that nobody can read — and, worse, the filter would then skip it
   * on the retry that would have fixed it. */
  install();
  stubPublish({
    ok: false,
    error: 'The deploy to Cloudflare did not finish.',
    pages: [], missing: [], files: 0,
  });
  marked.calls.length = 0;

  await call(handler('post', '/static-blogs/:id/publish'), req({ body: { mode: 'publish' } }));

  assert.strictEqual(marked.calls.length, 0, 'a failed deploy was recorded as published');
});

test('AND publishAll MARKS TOO, BECAUSE THOSE ARTICLES ARE ALSO LIVE', async () => {
  install();
  stubPublish(PUBLISHED);
  marked.calls.length = 0;

  await call(handler('post', '/static-blogs/:id/publish'), req({ body: { mode: 'publishAll' } }));

  assert.strictEqual(marked.calls.length, 1,
    'the override published articles and left them looking unpublished');
});

test("another account cannot publish this blog", async () => {
  install();
  const calls = stubPublish(PUBLISHED);

  const out = await call(handler('post', '/static-blogs/:id/publish'),
    req({ user: { _id: OTHER_USER }, body: { mode: 'publish' } }));

  assert.strictEqual(out.status, 404);
  assert.strictEqual(calls.length, 0, "somebody else's blog was published");
});

test('nor can a WordPress site be published this way', async () => {
  install();
  db.blogs[0].target = 'wordpress';
  const calls = stubPublish(PUBLISHED);

  const out = await call(handler('post', '/static-blogs/:id/publish'), req({ body: { mode: 'publish' } }));

  assert.strictEqual(out.status, 404);
  assert.strictEqual(calls.length, 0);
});

test('THE BUTTONS ARE ON THE PAGE, OR THE FEATURE DOES NOT EXIST', async () => {
  /* The third time this check has earned its place in this suite. */
  install();
  const out = await call(handler('get', '/static-blogs/:id'));

  assert.ok(out.html.includes(`action="/static-blogs/${BLOG_ID}/publish"`),
    'nothing on the blog page publishes it');
  assert.ok(out.html.includes('value="preview"'), 'there is no way to preview');
  assert.ok(out.html.includes('value="publish"'), 'there is no way to publish');
});

test('and the page says when it was last published', async () => {
  install();
  db.blogs[0].lastDeployAt = new Date('2026-11-09T10:00:00Z');
  db.blogs[0].lastDeployUrl = 'https://x.pages.dev';

  const out = await call(handler('get', '/static-blogs/:id'));

  assert.ok(/last published/i.test(out.html), 'the page does not say when it last went out');
  assert.ok(out.html.includes('https://x.pages.dev'), 'there is no link to the live site');

  install();
  const fresh = await call(handler('get', '/static-blogs/:id'));
  assert.ok(/never been published/i.test(fresh.html),
    'a blog that has never deployed does not say so');
});

section('PUBLISHING EVERYTHING, SCHEDULE IGNORED');

/* WHY THERE IS A SECOND PAIR OF BUTTONS AT ALL.
 *
 * Edwin approved his first campaign, watched three articles get written
 * and charged for, pressed Publish and was told nothing was due. True, and
 * useless: schedule.js deliberately pushes the first post forward so it is
 * never instantly overdue, so a blog set up on a Tuesday has nothing to
 * show until the following week. Finding out a week later whether the
 * Cloudflare token even has the right permission is not a plan.
 *
 * WHAT THESE TESTS ARE FOR. The renderer's half is pinned in
 * test-blog-render.js, down to a mutant that turned the strict `true`
 * check into a truthy one. This half is narrower and is the part a form
 * can get wrong: four buttons, four meanings, and an unrecognised value
 * that must land on the one that sends nothing. */

test('EACH BUTTON MEANS ONE THING, AND THE DEFAULT IS THE SAFE ONE', async () => {
  install();
  const calls = stubPublish(PUBLISHED);

  const expected = [
    ['preview',    { dryRun: true,  includeScheduled: false }],
    ['publish',    { dryRun: false, includeScheduled: false }],
    ['previewAll', { dryRun: true,  includeScheduled: true }],
    ['publishAll', { dryRun: false, includeScheduled: true }],
  ];

  for (const [mode, want] of expected) {
    calls.length = 0;
    await call(handler('post', '/static-blogs/:id/publish'), req({ body: { mode } }));

    assert.strictEqual(calls[0].dryRun, want.dryRun, `${mode}: wrong dryRun`);
    assert.strictEqual(calls[0].includeScheduled, want.includeScheduled,
      `${mode}: wrong scope`);
  }
});

test('AND ANYTHING ELSE PREVIEWS WHAT IS DUE', async () => {
  /* THE ALLOW-LIST, AND WHY IT IS NOT A PAIR OF STRING TESTS. This value
   * is typed by a browser. Written as `'publishAll' === mode` plus
   * `'publish' === mode` the unrecognised case still has to fall somewhere,
   * and the cautious answer — send nothing, and only what is due — has to
   * be the one it falls to. A typo in the HTML then shows a preview
   * instead of replacing a live site with twelve articles. */
  install();
  const calls = stubPublish({ ...PUBLISHED, dryRun: true, url: undefined });

  /* NOT IN THIS LIST: { mode: ['publishAll'] }.
   *
   * A repeated field arrives as an array, and String() on a one-element
   * array is that element — so it selects publishAll. That looked like a
   * hole and is not one: anyone who can send `mode[]=publishAll` can send
   * `mode=publishAll`, and both are a signed-in owner pressing their own
   * button on their own blog. Hardening it would buy nothing, and a test
   * asserting otherwise would be a test of a rule we had invented to have
   * something to assert. Recorded here so the next person reading this
   * list does not have to re-derive it. */
  for (const body of [{}, { mode: '' }, { mode: 'nonsense' }, { mode: 'PUBLISHALL' },
                      { mode: 'publishall' }, { mode: 'publish ' }, { mode: null }]) {
    calls.length = 0;
    await call(handler('post', '/static-blogs/:id/publish'), req({ body }));

    assert.strictEqual(calls[0].dryRun, true,
      `${JSON.stringify(body)} sent a deploy`);
    assert.strictEqual(calls[0].includeScheduled, false,
      `${JSON.stringify(body)} ignored the schedule`);
  }
});

test('THE OVERRIDE IS A REAL BOOLEAN BY THE TIME IT LEAVES THE ROUTE', async () => {
  /* isLive insists on exactly `true`, and this route is the only reason
   * that insistence is not paranoia: it is the one place a form string
   * could walk into the renderer. If this ever starts forwarding
   * req.body directly, the string 'false' becomes the override. */
  install();
  const calls = stubPublish(PUBLISHED);

  await call(handler('post', '/static-blogs/:id/publish'), req({ body: { mode: 'publishAll' } }));

  assert.strictEqual(typeof calls[0].includeScheduled, 'boolean');
  assert.strictEqual(calls[0].includeScheduled, true);
});

test('THE PAGE SAYS SO WHEN THE SCHEDULE WAS IGNORED', async () => {
  /* The override has to announce itself. Replacing a live site with
   * everything ever written is not something to discover afterwards. */
  install();
  stubPublish(PUBLISHED);

  const all = await call(handler('post', '/static-blogs/:id/publish'),
    req({ body: { mode: 'publishAll' } }));
  assert.ok(/schedule ignored/i.test(all.html),
    'the override published without saying it had');

  const due = await call(handler('post', '/static-blogs/:id/publish'),
    req({ body: { mode: 'publish' } }));
  assert.ok(!/schedule ignored/i.test(due.html),
    'an ordinary publish claimed to ignore the schedule');
});

test('AND IT NO LONGER CLAIMS THE DATES ARE LEFT ALONE', async () => {
  /* THE SENTENCE THIS TEST EXISTS TO KILL. Both screens used to promise
   * that an article pushed up early "still reads as next week's — that is
   * what Google will see", because for months that was true.
   *
   * It stopped being true the moment markPublished started pulling a
   * future date back to today, which is what Edwin asked for. Neither
   * screen noticed. A help text that confidently describes the OPPOSITE of
   * what the button does is worse than no help text: it is the thing
   * somebody reads instead of checking.
   *
   * Asserted on both screens, because the claim was written twice. */
  install();
  stubPublish(PUBLISHED);

  const screen = await call(handler('get', '/static-blogs/:id'));
  const after = await call(handler('post', '/static-blogs/:id/publish'),
    req({ body: { mode: 'publishAll' } }));

  /* THE CLAIM, NOT THE PHRASE. A first draft of this test banned "keep
   * the dates they were planned for" outright and failed against the
   * corrected screen — because that phrase is now TRUE of the articles
   * still waiting, which is the other half of the rule and worth saying.
   * What was wrong was never the words; it was the promise about an
   * article pushed up EARLY. So that is what is asserted. */
  for (const [where, html] of [['the blog screen', screen.html], ['the confirmation', after.html]]) {
    assert.ok(!/still carry those dates/i.test(html),
      `${where} still promises a future date survives the publish`);
    assert.ok(!/reads as next week/i.test(html),
      `${where} still says an early article reads as next week's`);
    assert.ok(!/published early still/i.test(html),
      `${where} still describes what an early publish used to do`);
  }
});

test('AND BOTH SCREENS SAY WHAT ACTUALLY HAPPENS TO THE DATE', async () => {
  /* Removing the wrong sentence is half the job. Saying nothing would
   * leave the owner to guess, and the guess most people would make is the
   * one the old text taught them. */
  install();
  stubPublish(PUBLISHED);

  const screen = await call(handler('get', '/static-blogs/:id'));
  const after = await call(handler('post', '/static-blogs/:id/publish'),
    req({ body: { mode: 'publishAll' } }));

  /* WHITESPACE FLATTENED FIRST. The template wraps its prose across
   * source lines, so "redated to today" reaches the page as "redated to\n
   * today" and a plain regex misses it — which it duly did, reporting a
   * sentence as absent while it sat on screen. Any assertion about
   * rendered prose in this file has to do this. */
  const flat = (html) => String(html).replace(/\s+/g, ' ');

  for (const [where, html] of [['the blog screen', screen.html], ['the confirmation', after.html]]) {
    assert.ok(/redated to today|dated today/i.test(flat(html)),
      `${where} does not say an early article is redated`);
  }

  /* And the other half of the rule: a slot still waiting is NOT touched.
   * Only what actually went up is redated, so pressing the button does not
   * flatten the whole campaign onto one day — and an owner who thought it
   * did would never press it. */
  assert.ok(/still waiting keep the dates/i.test(flat(screen.html)),
    'the blog screen does not say the articles still waiting keep their dates');
});

test('ALL FOUR BUTTONS ARE ON THE PAGE', async () => {
  /* The fourth time this check has earned its place. A mode the route
   * understands and no button sends is a feature that does not exist. */
  install();
  const out = await call(handler('get', '/static-blogs/:id'));

  for (const mode of ['preview', 'publish', 'previewAll', 'publishAll']) {
    assert.ok(out.html.includes(`value="${mode}"`), `no button sends ${mode}`);
  }
});

section('PILLAR CAMPAIGNS FROM THIS SCREEN');

/* THE PLANNER HAS SUPPORTED THEM ALL ALONG; THE SCREEN DID NOT OFFER ONE.
 *
 * createCampaign reads `body.isPillar`, skips the target-page check and
 * the URL-scheme check, and refuses fewer than two topics — because the
 * posts link only to each other, so a single one would have no links at
 * all. None of that was reachable from here: the form never sent the
 * flag and marked both target-page fields required.
 *
 * THESE DRIVE THE REAL PLANNER, like the schedule tests above. A stub
 * asserting "isPillar: true was passed" would prove only that the test
 * author and the route agreed — which is exactly the agreement that was
 * missing when the schedule field names did not match. */

function pillarBody(over = {}) {
  return Object.assign({
    name: 'Water heater cluster',
    isPillar: '1',
    targetUrl: '',
    targetKeyword: '',
    topics: 'How a water heater actually works\nWhat the anode rod does\nHow long a tank should last',
    startDate: '2099-11-03',
    gapDays: '7',
    publishTime: '09:00',
  }, over);
}

test('A PILLAR CAMPAIGN PLANS WITH NO TARGET PAGE AT ALL', async () => {
  install();
  db.blogs[0].timezone = 'America/Chicago';

  const out = await call(handler('post', '/static-blogs/:id/plan'), req({ body: pillarBody() }));

  assert.strictEqual(out.status, 200, out.html.slice(0, 500));
  assert.strictEqual(db.created_campaign.isPillar, true, 'it was stored as an ordinary campaign');
  assert.strictEqual(db.created_campaign.slots.length, 3);
});

test('AND ITS POSTS CARRY NO MONEY ANCHOR', async () => {
  /* The whole difference. An ordinary campaign bakes a {{money}} token
   * into every article; a pillar's ring is the only linking it has. A
   * pillar that still carried money anchors would be writing links to a
   * page that was never named. */
  install();

  await call(handler('post', '/static-blogs/:id/plan'), req({ body: pillarBody() }));

  for (const slot of db.created_campaign.slots) {
    assert.ok(!slot.moneyAnchor, `slot ${slot.index} has a money anchor`);
  }
});

test('WITHOUT THE BOX, THE TARGET PAGE IS STILL DEMANDED', async () => {
  /* THE MUTATION GUARD, AND THE REAL RISK IN THIS CHANGE. Removing
   * `required` from the two inputs means the browser no longer stops an
   * empty submit — so if the server rule were ever weakened, an ordinary
   * campaign with no money page would plan silently and twelve articles
   * would link to nothing. The refusal has to hold. */
  install();

  const out = await call(handler('post', '/static-blogs/:id/plan'),
    req({ body: pillarBody({ isPillar: '' }) }));

  assert.strictEqual(out.status, 400, 'an ordinary campaign planned with no target page');
  assert.ok(/target page/i.test(out.html), 'the refusal does not say what is missing');
  assert.strictEqual(db.created_campaign, null, 'it was saved anyway');
});

test('AND THE BOX IS NOT READ LOOSELY', async () => {
  /* It arrives from a form, where every value is a string. A truthy test
   * would make the string 'false' a pillar campaign — and the symptom is
   * silent: a campaign that quietly drops every money link. */
  install();

  for (const value of ['', '0', 'false', 'no', undefined]) {
    db.created_campaign = null;

    await call(handler('post', '/static-blogs/:id/plan'),
      req({ body: pillarBody({ isPillar: value, targetUrl: 'https://example.com/repair/',
                               targetKeyword: 'water heater repair' }) }));

    assert.ok(db.created_campaign, `${value} refused a valid ordinary campaign`);
    assert.strictEqual(db.created_campaign.isPillar, false,
      `${JSON.stringify(value)} was treated as a pillar campaign`);
  }
});

test('A PILLAR OF ONE POST IS REFUSED, BECAUSE IT WOULD HAVE NO LINKS', async () => {
  /* The planner's rule, reached from this screen for the first time. The
   * ring is the only linking a pillar has, so one post links to nothing. */
  install();

  const out = await call(handler('post', '/static-blogs/:id/plan'),
    req({ body: pillarBody({ topics: 'The only topic' }) }));

  assert.strictEqual(out.status, 400);
  assert.ok(/two posts/i.test(out.html), 'the refusal does not explain itself');
});

test('THE CHECKBOX IS ON THE PAGE AND SURVIVES A SUGGESTION', async () => {
  install();

  const fresh = await call(handler('get', '/static-blogs/:id'));
  assert.ok(fresh.html.includes('name="isPillar"'), 'there is no way to plan a pillar');
  assert.ok(!/name="isPillar"[^>]*checked/.test(fresh.html), 'it defaults to ticked');

  /* A suggestion that silently unticked it would hand back a form that
   * looks the same and plans a different campaign. */
  model.topics = [{ topic: 'New', targetQuery: 'new' }];
  const after = await call(handler('post', '/static-blogs/:id/suggest'), req({
    body: { isPillar: '1', targetUrl: 'https://example.com/r/', targetKeyword: 'k', topics: '' },
  }));

  assert.ok(/name="isPillar"[^>]*checked/.test(after.html), 'the pillar box was unticked for you');

  /* AND THE OTHER DIRECTION, WHICH MUTATION FOUND MISSING.
   *
   * This handler has its own copy of the same read. Loosening the one in
   * the plan route kills a test; loosening THIS one killed nothing,
   * because every assertion here passed '1'. A truthy read would tick
   * the box on the way back from a suggestion for anything at all — and
   * the next press of "Plan it" would then plan a pillar campaign the
   * person never asked for, with the money links silently gone. */
  const ordinary = await call(handler('post', '/static-blogs/:id/suggest'), req({
    body: { isPillar: 'false', targetUrl: 'https://example.com/r/', targetKeyword: 'k', topics: '' },
  }));

  assert.ok(!/name="isPillar"[^>]*checked/.test(ordinary.html),
    "'false' ticked the pillar box");
});

test('AND THE TARGET-PAGE FIELDS NO LONGER BLOCK THE BROWSER', async () => {
  /* Marked required, the browser refuses to submit a pillar campaign and
   * says nothing — the button simply does nothing. The server owns this
   * rule instead, which is also the only place it can be owned, since
   * only the server knows what a pillar is. */
  install();
  const out = await call(handler('get', '/static-blogs/:id'));

  const field = out.html.match(/<input[^>]*id="targetUrl"[^>]*>/);
  assert.ok(field, 'the target page field is gone');
  assert.ok(!/\brequired\b/.test(field[0]),
    'the browser will refuse to submit a pillar campaign');
});

section('EDITING AN ARTICLE');

/* WHY THIS IS TWO ROUTES AND NOT A SUBSYSTEM.
 *
 * A WordPress post is written once and repaired in place. A static blog
 * re-renders from scratch on every deploy, so an edit is just a
 * different document in Mongo and the next publish picks it up — no
 * repair step, no sync, nothing to go stale.
 *
 * WHAT IS AT RISK HERE, and it is not the typing:
 *
 *   THE LINK TOKENS. {{money}}…{{/money}} is plain text in a textarea,
 *   so it can be deleted by accident — and a deleted one is SILENT. The
 *   sentence still reads, the page still builds, and a third of the
 *   article's links are gone.
 *
 *   THE SLUG. It is in the canonical, the sitemap, the feed and every
 *   internal link. Leaving it out of the form is a convention; leaving
 *   it out of the update is the rule.
 *
 *   THE PARAGRAPH SPLIT. Get it wrong in one direction and every
 *   sentence becomes its own <p>; wrong in the other and the whole
 *   article is one. */

const POST_ID = '507f1f77bcf86cd799439021';

function installArticle(over = {}) {
  install();

  db.post = Object.assign({
    _id: POST_ID,
    site: BLOG_ID,
    campaign: 'c1',
    slotIndex: 0,
    slug: 'water-heater-popping',
    title: 'Why your heater pops',
    metaDescription: 'Sediment, mostly.',
    targetUrl: '',
    sections: [
      { heading: null, paragraphs: ['It is boiling, not exploding.'] },
      { heading: 'What to do', paragraphs: [
        'Book a {{money}}water heater repair{{/money}} first.',
        'Then read {{next}}the next one{{/next}}.',
      ] },
    ],
  }, over);

  db.postUpdates = [];

  BlogPost.findOne = async (where) => {
    db.postFindOneWhere = where;
    const matches = (!where._id || String(where._id) === String(db.post._id))
      && (!where.site || String(where.site) === String(BLOG_ID));
    return matches ? { ...db.post, lean: undefined } : null;
  };

  /* .lean() on findOne, which the route uses. Mongoose returns a query;
   * the stub returns the document and a lean() that resolves to it. */
  const plain = BlogPost.findOne;
  BlogPost.findOne = (where) => {
    const promise = plain(where);
    promise.lean = () => promise;
    return promise;
  };

  BlogCampaign.findOne = (where) => {
    const answer = Promise.resolve(
      String(where.site) === String(BLOG_ID)
        ? { _id: 'c1', name: 'Autumn', isPillar: false,
            targetPage: { url: 'https://example.com/repair/' } }
        : null
    );
    answer.select = () => answer;
    answer.lean = () => answer;
    return answer;
  };

  BlogPost.updateOne = async (where, update) => {
    db.postUpdates.push({ where, update });
    return { modifiedCount: 1 };
  };
}

function editBody(over = {}) {
  return Object.assign({
    title: 'Why your heater pops',
    metaDescription: 'Sediment, mostly.',
    targetUrl: '',
    heading: ['', 'What to do'],
    body: [
      'It is boiling, not exploding.',
      'Book a {{money}}water heater repair{{/money}} first.\n\nThen read {{next}}the next one{{/next}}.',
    ],
  }, over);
}

test('THE FORM SHOWS THE ARTICLE AS IT STANDS', async () => {
  installArticle();

  const out = await call(handler('get', '/static-blogs/:id/articles/:postId/edit'),
    req({ params: { id: BLOG_ID, postId: POST_ID } }));

  assert.strictEqual(out.status, 200);
  assert.ok(out.html.includes('value="Why your heater pops"'), 'the title is not in the form');
  assert.ok(out.html.includes('Sediment, mostly.'), 'the meta description is not in the form');
  assert.ok(out.html.includes('It is boiling, not exploding.'), 'the prose is not in the form');
  assert.ok(out.html.includes('{{money}}water heater repair{{/money}}'),
    'the link tokens were hidden or stripped');
  assert.ok(out.html.includes('value="What to do"'), 'the H2 is not editable');
});

test('AND SAYS THE ADDRESS IS FIXED, RATHER THAN JUST OMITTING IT', async () => {
  /* Somebody who cannot find the slug field should learn why, not
   * assume it is a missing feature and go looking for it elsewhere. */
  installArticle();

  const out = await call(handler('get', '/static-blogs/:id/articles/:postId/edit'),
    req({ params: { id: BLOG_ID, postId: POST_ID } }));

  assert.ok(out.html.includes('/water-heater-popping/'), 'the address is not shown');
  assert.ok(/address is fixed/i.test(out.html), 'nothing says why the slug cannot be changed');
  assert.ok(!out.html.includes('name="slug"'), 'the slug is editable');
});

test('A SAVE WRITES THE PROSE BACK, PARAGRAPH BY PARAGRAPH', async () => {
  installArticle();

  await call(handler('post', '/static-blogs/:id/articles/:postId/edit'),
    req({ params: { id: BLOG_ID, postId: POST_ID }, body: editBody() }));

  const { update } = db.postUpdates[0];

  assert.deepStrictEqual(update.$set.sections, [
    { heading: '', paragraphs: ['It is boiling, not exploding.'] },
    { heading: 'What to do', paragraphs: [
      'Book a {{money}}water heater repair{{/money}} first.',
      'Then read {{next}}the next one{{/next}}.',
    ] },
  ], 'the sections did not survive the round trip');
});

test('A BLANK LINE SPLITS PARAGRAPHS; A SINGLE NEWLINE DOES NOT', async () => {
  /* THE RULE, AND BOTH WAYS IT CAN GO WRONG. Treat every newline as a
   * break and a textarea that somebody wrapped by hand becomes six <p>
   * tags mid-sentence. Treat none of them as a break and the article is
   * one enormous paragraph. */
  installArticle();

  await call(handler('post', '/static-blogs/:id/articles/:postId/edit'), req({
    params: { id: BLOG_ID, postId: POST_ID },
    body: editBody({
      heading: [''],
      body: ['One sentence\nwrapped by hand.\n\nA second paragraph.'],
    }),
  }));

  assert.deepStrictEqual(db.postUpdates[0].update.$set.sections, [
    { heading: '', paragraphs: ['One sentence wrapped by hand.', 'A second paragraph.'] },
  ]);
});

test('AND CARRIAGE RETURNS DO NOT SURVIVE INTO THE PROSE', async () => {
  /* A textarea posted from Windows sends \r\n. */
  installArticle();

  await call(handler('post', '/static-blogs/:id/articles/:postId/edit'), req({
    params: { id: BLOG_ID, postId: POST_ID },
    body: editBody({ heading: [''], body: ['First.\r\n\r\nSecond.'] }),
  }));

  assert.deepStrictEqual(db.postUpdates[0].update.$set.sections, [
    { heading: '', paragraphs: ['First.', 'Second.'] },
  ]);

  /* AND A LONE \r, WHICH IS THE CASE THAT ACTUALLY NEEDS THE
   * NORMALISATION.
   *
   * Mutation showed the \r\n handling was doing nothing on its own:
   * trim() already strips a trailing carriage return, so deleting the
   * replace changed no behaviour and killed no test. A lone \r between
   * paragraphs is different — it sits in the MIDDLE of the text, where
   * trim cannot reach, so without the replace it survives into the
   * stored prose and from there into the HTML. */
  db.postUpdates = [];

  await call(handler('post', '/static-blogs/:id/articles/:postId/edit'), req({
    params: { id: BLOG_ID, postId: POST_ID },
    body: editBody({ heading: [''], body: ['First.\r\rSecond.'] }),
  }));

  assert.deepStrictEqual(db.postUpdates[0].update.$set.sections, [
    { heading: '', paragraphs: ['First.', 'Second.'] },
  ], 'a lone carriage return was left in the prose');
});

test('A ONE-SECTION ARTICLE IS NOT READ CHARACTER BY CHARACTER', async () => {
  /* Express sends a repeated field as an array and a single occurrence
   * as a STRING. Index into the string and heading[0] is "W" — the
   * article saves with a one-letter heading and nobody notices until
   * they look at the page. */
  installArticle();

  await call(handler('post', '/static-blogs/:id/articles/:postId/edit'), req({
    params: { id: BLOG_ID, postId: POST_ID },
    body: editBody({ heading: 'What to do', body: 'Just the one section.' }),
  }));

  assert.deepStrictEqual(db.postUpdates[0].update.$set.sections, [
    { heading: 'What to do', paragraphs: ['Just the one section.'] },
  ]);
});

test('THE SLUG IS NEVER IN THE UPDATE, WHATEVER IS POSTED', async () => {
  /* Leaving it out of the FORM is a convention. Leaving it out of the
   * UPDATE is the rule — and a hand-crafted POST is exactly the thing a
   * convention does not survive. */
  installArticle();

  await call(handler('post', '/static-blogs/:id/articles/:postId/edit'), req({
    params: { id: BLOG_ID, postId: POST_ID },
    body: editBody({ slug: 'something-else', _id: 'nope', site: 'nope' }),
  }));

  const keys = Object.keys(db.postUpdates[0].update.$set);

  assert.ok(!keys.includes('slug'), 'the slug was writable after all');
  assert.ok(!keys.includes('site'), 'an article could be moved to another blog');
  assert.deepStrictEqual(keys.sort(),
    ['extraUrl', 'metaDescription', 'sections', 'targetUrl', 'title']);
});

test('THE ARTICLE CAN POINT ITS LINK SOMEWHERE OF ITS OWN', async () => {
  installArticle();

  await call(handler('post', '/static-blogs/:id/articles/:postId/edit'), req({
    params: { id: BLOG_ID, postId: POST_ID },
    body: editBody({ targetUrl: 'https://example.com/emergency/' }),
  }));

  assert.strictEqual(db.postUpdates[0].update.$set.targetUrl, 'https://example.com/emergency/');
});

test('AND AN EMPTY ONE MEANS THE CAMPAIGN\'S, NOT A COPY OF IT', async () => {
  /* Copy the campaign's URL in on save and the day somebody fixes a typo
   * on the campaign, every edited article keeps the old one. */
  installArticle();

  await call(handler('post', '/static-blogs/:id/articles/:postId/edit'), req({
    params: { id: BLOG_ID, postId: POST_ID },
    body: editBody({ targetUrl: '   ' }),
  }));

  assert.strictEqual(db.postUpdates[0].update.$set.targetUrl, '',
    'an empty field was stored as the campaign\'s URL');
});

test('AN ARTICLE CAN CARRY A LINK OF ITS OWN', async () => {
  /* THE SLOT A PILLAR ARTICLE HAS INSTEAD OF A MONEY LINK. A pillar
   * campaign has no money page by design, so its articles carry no
   * {{money}} token and there is nothing for targetUrl to retarget.
   * {{link}} is written into a sentence by hand and pointed here. */
  installArticle();

  await call(handler('post', '/static-blogs/:id/articles/:postId/edit'), req({
    params: { id: BLOG_ID, postId: POST_ID },
    body: editBody({ extraUrl: 'https://somewhere.example/guide/' }),
  }));

  assert.strictEqual(db.postUpdates[0].update.$set.extraUrl,
    'https://somewhere.example/guide/');
});

test('AND IT IS OFFERED ON A PILLAR ARTICLE TOO', async () => {
  /* Gate this the way the money URL is gated and a pillar article is
   * back to having no link it can control — which is the entire reason
   * the token exists. */
  installArticle();

  BlogCampaign.findOne = () => {
    const answer = Promise.resolve({ _id: 'c1', name: 'Pillar', isPillar: true, targetPage: null });
    answer.select = () => answer;
    answer.lean = () => answer;
    return answer;
  };

  const out = await call(handler('get', '/static-blogs/:id/articles/:postId/edit'),
    req({ params: { id: BLOG_ID, postId: POST_ID } }));

  assert.ok(out.html.includes('name="extraUrl"'),
    'a pillar article has no link of its own either');
  assert.ok(!out.html.includes('name="targetUrl"'),
    'a pillar article was offered a money link');
  assert.ok(out.html.includes('{{link}}'), 'the marker is not explained');

  /* THE NOTICE USED TO END "There is nothing to point." — directly above
   * the field that points something. A pillar owner reading that stops
   * reading, which is the one thing the field exists to prevent. */
  assert.ok(!/nothing to point/i.test(out.html),
    'the pillar notice still says there is nothing to point at');
  assert.ok(/Your own link/.test(out.html),
    'the pillar notice does not send him to the field below it');
});

test('THE MARKER LEGEND COUNTS ITSELF', async () => {
  /* It read "The three link markers" above a list generated from
   * LINK_TOKENS, so the day a fourth was added the heading was wrong and
   * nothing said so. The count and the list now come from one place, and
   * this test fails if they are ever separated again. */
  installArticle();

  const out = await call(handler('get', '/static-blogs/:id/articles/:postId/edit'),
    req({ params: { id: BLOG_ID, postId: POST_ID } }));

  const names = ['money', 'prev', 'next', 'link'];
  const shown = names.filter(n => out.html.includes(`{{${n}}}the words{{/${n}}}`));

  assert.strictEqual(shown.length, names.length,
    `the legend lists ${shown.length} markers, not ${names.length}`);
  assert.ok(out.html.includes(`The ${['no','one','two','three','four','five','six'][shown.length]} link markers`),
    `the heading does not say there are ${shown.length}`);
});

test('AN EMPTY LINK OF YOUR OWN MEANS NO LINK, NOT A FALLBACK', async () => {
  /* Unlike targetUrl there is nothing behind it. The token unwraps and
   * the sentence reads as ordinary prose. */
  installArticle();

  await call(handler('post', '/static-blogs/:id/articles/:postId/edit'), req({
    params: { id: BLOG_ID, postId: POST_ID },
    body: editBody({ extraUrl: '   ' }),
  }));

  assert.strictEqual(db.postUpdates[0].update.$set.extraUrl, '');
});

test('BOTH URLS ARE CHECKED, NOT JUST THE FIRST', async () => {
  /* They are two fields a day apart, and a copied check is how one of
   * them ends up accepting data: on the afternoon somebody loosens the
   * other. One helper, both fields. */
  installArticle();
  db.postUpdates = [];

  const out = await call(handler('post', '/static-blogs/:id/articles/:postId/edit'), req({
    params: { id: BLOG_ID, postId: POST_ID },
    body: editBody({ extraUrl: 'javascript:alert(1)' }),
  }));

  assert.strictEqual(out.status, 400, 'a javascript: link of your own was accepted');
  assert.strictEqual(db.postUpdates.length, 0, 'it was saved anyway');
  assert.ok(/your own link/i.test(out.html), 'the message does not say which field is wrong');
});

test('A LINK THAT IS NOT A WEB ADDRESS IS REFUSED', async () => {
  /* It becomes the href of a link on a published page. javascript:,
   * data: and file: all parse perfectly well and none of them belong in
   * a link we generate. The same check createCampaign makes. */
  installArticle();

  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd',
                     'example.com/repair', 'not a url']) {
    db.postUpdates = [];

    const out = await call(handler('post', '/static-blogs/:id/articles/:postId/edit'), req({
      params: { id: BLOG_ID, postId: POST_ID },
      body: editBody({ targetUrl: bad }),
    }));

    assert.strictEqual(out.status, 400, `${bad} was accepted`);
    assert.strictEqual(db.postUpdates.length, 0, `${bad} was saved anyway`);
  }
});

test('AN ARTICLE CANNOT BE SAVED EMPTY', async () => {
  installArticle();

  const out = await call(handler('post', '/static-blogs/:id/articles/:postId/edit'), req({
    params: { id: BLOG_ID, postId: POST_ID },
    body: editBody({ heading: [''], body: ['   \n\n  '] }),
  }));

  assert.strictEqual(out.status, 400);
  assert.strictEqual(db.postUpdates.length, 0, 'an empty article was saved over a real one');
});

test('LOSING A LINK TOKEN IS REPORTED, BECAUSE IT IS OTHERWISE SILENT', async () => {
  /* THE WHOLE REASON THE TOKENS ARE VISIBLE RATHER THAN HIDDEN. Delete
   * one while rewriting a sentence and the prose still reads, the page
   * still builds, and the article quietly stops linking anywhere. */
  installArticle();

  const out = await call(handler('post', '/static-blogs/:id/articles/:postId/edit'), req({
    params: { id: BLOG_ID, postId: POST_ID },
    body: editBody({
      heading: ['', 'What to do'],
      body: ['It is boiling.', 'Book a water heater repair first.\n\nThen read {{next}}the next one{{/next}}.'],
    }),
  }));

  assert.strictEqual(out.status, 200, 'the save was refused rather than reported');
  assert.ok(/lost a link/i.test(out.html), 'nothing said a link had gone');
  assert.ok(out.html.includes('{{money}}'), 'it does not say which marker was lost');
  assert.ok(!/\{\{next\}\}/.test(out.html.split('lost a link')[1] || ''),
    'it reported a token that is still there');
});

test('AND A SAVE THAT KEEPS THEM ALL SAYS NOTHING ABOUT LINKS', async () => {
  installArticle();

  const out = await call(handler('post', '/static-blogs/:id/articles/:postId/edit'),
    req({ params: { id: BLOG_ID, postId: POST_ID }, body: editBody() }));

  assert.ok(!/lost/i.test(out.html), 'a clean save was reported as having lost something');
});

test('ANOTHER ACCOUNT CANNOT OPEN OR SAVE THIS ARTICLE', async () => {
  installArticle();

  const form = await call(handler('get', '/static-blogs/:id/articles/:postId/edit'),
    req({ user: { _id: OTHER_USER }, params: { id: BLOG_ID, postId: POST_ID } }));
  assert.strictEqual(form.status, 404);

  const saved = await call(handler('post', '/static-blogs/:id/articles/:postId/edit'),
    req({ user: { _id: OTHER_USER }, params: { id: BLOG_ID, postId: POST_ID }, body: editBody() }));

  assert.strictEqual(saved.status, 404);
  assert.strictEqual(db.postUpdates.length, 0, "somebody else's article was changed");
});

test('AND AN ARTICLE IS LOADED SCOPED TO THE BLOG, NOT CHECKED AFTERWARDS', async () => {
  /* The rule the rest of this file follows: an ownership test written as
   * a separate `if` is one careless early return away from not
   * happening. */
  installArticle();

  await call(handler('get', '/static-blogs/:id/articles/:postId/edit'),
    req({ params: { id: BLOG_ID, postId: POST_ID } }));

  assert.strictEqual(String(db.postFindOneWhere.site), BLOG_ID,
    'the article was loaded without scoping it to the blog');
});

test('THE BLOG PAGE LINKS TO EACH ARTICLE\'S EDITOR', async () => {
  /* An editor nothing links to is an editor nobody finds. Before this
   * list the only thing naming an article was the front-page dropdown,
   * which selects one and opens nothing. */
  install();
  const out = await call(handler('get', '/static-blogs/:id'));

  assert.ok(out.html.includes('/articles/'), 'there is no way to reach an article');

  /* The fixture titles have no characters that escaping would change, so
   * a plain includes() is honest here — and asserting on the raw title
   * is what a reader of this test expects to see. */
  for (const a of db.articles) {
    assert.ok(out.html.includes(a.title), `${a.title} is not listed`);
    assert.ok(out.html.includes(`/articles/${a._id}/edit`),
      `${a.title} has no edit link`);
  }
});

section('DELETING A BLOG');

/* IT CASCADES, AND THE WORDPRESS ONE DOES NOT. Both are right.
 *
 * /blog-sites/:id/delete refuses a licence row that has campaigns,
 * because those campaigns are posts on somebody's live WordPress site
 * that this app does not control. A Cloudflare blog is the opposite — we
 * own the articles and the Pages project — so refusing would mean the
 * only blogs you can delete are the ones you never used.
 *
 * WHAT THESE GUARD. A cascade is the one operation here that destroys
 * work already paid for, and it is reached from a page that also has a
 * Publish button on it. The confirmation, the ownership check and the
 * order of the deletes all have to hold. */

function deleteBody(over = {}) {
  return Object.assign({ confirm: 'leanderwaterheaters.com', dropProject: '1' }, over);
}

test('THE CONFIRMATION PAGE COUNTS WHAT WILL GO', async () => {
  install({
    campaigns: [{ _id: 'c1', name: 'One', status: 'active', slots: [], targetPage: {} }],
  });
  db.blogs[0].project = 'leanderwaterheaters-com';

  const out = await call(handler('get', '/static-blogs/:id/delete'));

  assert.strictEqual(out.status, 200);
  assert.ok(/cannot be undone/i.test(out.html), 'the page does not say it is permanent');
  assert.ok(out.html.includes('leanderwaterheaters-com'), 'the Cloudflare project is not named');
  assert.ok(/not refunded/i.test(out.html), 'nothing says the credits are gone');
  assert.ok(out.html.includes('name="confirm"'), 'there is no confirmation field');
});

test('AND SAYS SO WHEN THERE IS NO PROJECT TO DELETE', async () => {
  install();
  delete db.blogs[0].project;

  const out = await call(handler('get', '/static-blogs/:id/delete'));

  assert.ok(/never published/i.test(out.html), 'it offered to delete a project that does not exist');
  assert.ok(!out.html.includes('name="dropProject"'),
    'it offered a checkbox for a project that does not exist');
});

test('A WRONG CONFIRMATION DELETES NOTHING', async () => {
  /* THE WHOLE POINT OF THE FIELD. This runs from a page that also has a
   * Publish button, and the thing it destroys was paid for. */
  install();

  for (const confirm of ['', 'yes', 'leanderwaterheaters', 'appliancerepaircedarpark.com']) {
    db.deletedPosts = null;
    db.deletedCampaigns = null;
    db.deletedSite = null;

    const out = await call(handler('post', '/static-blogs/:id/delete'),
      req({ body: deleteBody({ confirm }) }));

    assert.strictEqual(out.status, 400, `"${confirm}" was accepted`);
    assert.strictEqual(db.deletedSite, null, `"${confirm}" deleted the blog`);
    assert.strictEqual(db.deletedPosts, null, `"${confirm}" deleted the articles`);
  }
});

test('THE RIGHT ONE DELETES THE ARTICLES, THE CAMPAIGNS AND THE BLOG', async () => {
  install();

  const out = await call(handler('post', '/static-blogs/:id/delete'),
    req({ body: deleteBody() }));

  assert.strictEqual(out.status, 200);
  assert.deepStrictEqual(db.deletedPosts, { site: BLOG_ID });
  assert.deepStrictEqual(db.deletedCampaigns, { site: BLOG_ID });
  assert.deepStrictEqual(db.deletedSite, { _id: BLOG_ID, user: USER_ID });
});

test('CHILDREN BEFORE THE PARENT', async () => {
  /* Delete the blog first and a failure part way through leaves campaigns
   * and posts pointing at a site that is gone — rows nothing lists and
   * nothing will ever clean up. */
  install();

  await call(handler('post', '/static-blogs/:id/delete'), req({ body: deleteBody() }));

  assert.deepStrictEqual(db.deleteOrder, ['posts', 'campaigns', 'site'],
    'the blog was deleted before the things that point at it');
});

test('WHITESPACE AND CASE DO NOT DEFEAT IT', async () => {
  /* A copy-paste brings a space often enough to matter, and refusing a
   * correct answer over whitespace teaches people to stop reading. */
  install();

  const out = await call(handler('post', '/static-blogs/:id/delete'),
    req({ body: deleteBody({ confirm: '  LeanderWaterHeaters.com  ' }) }));

  assert.strictEqual(out.status, 200, 'a correct answer was refused over spacing');
  assert.deepStrictEqual(db.deletedSite, { _id: BLOG_ID, user: USER_ID });
});

test('THE CLOUDFLARE PROJECT GOES WHEN THE BOX IS TICKED', async () => {
  /* A Pages project holds its pages.dev subdomain while it exists, so
   * leaving it behind means re-adding the same domain gets a suffixed
   * name — which is where appliancerepaircedarpark-com-bx6 came from. */
  install();
  db.blogs[0].project = 'leanderwaterheaters-com';
  cloudflare.calls.length = 0;

  await call(handler('post', '/static-blogs/:id/delete'), req({ body: deleteBody() }));

  assert.strictEqual(cloudflare.calls.length, 1, 'the project was left behind');
  assert.strictEqual(cloudflare.calls[0].project, 'leanderwaterheaters-com');
});

test('AND STAYS WHEN IT IS NOT', async () => {
  install();
  db.blogs[0].project = 'leanderwaterheaters-com';
  cloudflare.calls.length = 0;

  await call(handler('post', '/static-blogs/:id/delete'),
    req({ body: deleteBody({ dropProject: '' }) }));

  assert.strictEqual(cloudflare.calls.length, 0, 'a project was deleted without being asked for');
  assert.deepStrictEqual(db.deletedSite, { _id: BLOG_ID, user: USER_ID },
    'keeping the project also kept the blog');
});

test('A PROJECT THAT WILL NOT DELETE DOES NOT TRAP THE BLOG', async () => {
  /* A token short a permission, or a project somebody already removed by
   * hand. Refusing here would leave a blog that can never be deleted. */
  install();
  db.blogs[0].project = 'leanderwaterheaters-com';
  cloudflare.answer = { ok: false, output: 'Authentication error [code: 10000]' };

  const out = await call(handler('post', '/static-blogs/:id/delete'), req({ body: deleteBody() }));

  assert.strictEqual(out.status, 200);
  assert.deepStrictEqual(db.deletedSite, { _id: BLOG_ID, user: USER_ID },
    'our own records were held hostage by Cloudflare');
  assert.ok(out.html.includes('10000'), "Cloudflare's reason was not shown");

  /* THE HEADING SAYS THE BLOG WENT, BEFORE ANY WARNING.
   *
   * This page used to be headed "Deleted" with a warning underneath
   * about the Cloudflare project, and Edwin read the whole thing as "it
   * was not deleted". The blog, its campaign and three articles were
   * already gone. A page that reports several outcomes has to say which
   * one each line is about. */
  assert.ok(/The blog is deleted/.test(out.html), 'the page does not say the blog went');
  assert.ok(/cannot fail and did not/.test(out.html),
    'the page leaves it ambiguous whether the blog survived');

  assert.ok(/Pages project deleted:<\/strong>\s*no/.test(out.html),
    'the project failure is not reported on its own line');
  assert.ok(/never touched/.test(out.html),
    'nothing reassures that the rest of the domain is untouched');
});

test("ANOTHER ACCOUNT CANNOT DELETE THIS BLOG, OR EVEN SEE THE PAGE", async () => {
  install();

  const form = await call(handler('get', '/static-blogs/:id/delete'),
    req({ user: { _id: OTHER_USER } }));
  assert.strictEqual(form.status, 404);

  const posted = await call(handler('post', '/static-blogs/:id/delete'),
    req({ user: { _id: OTHER_USER }, body: deleteBody() }));

  assert.strictEqual(posted.status, 404);
  assert.strictEqual(db.deletedSite, null, "somebody else's blog was deleted");
  assert.strictEqual(cloudflare.calls.length, 0, "somebody else's project was deleted");
});

test('AND THE BLOG PAGE OFFERS THE WAY IN', async () => {
  install();
  const out = await call(handler('get', '/static-blogs/:id'));

  assert.ok(out.html.includes(`/static-blogs/${BLOG_ID}/delete`),
    'there is no way to reach the delete screen');
});

section('WHAT THE FIRST PUBLISH SAYS');

test('A DNS RECORD THAT WAS NOT MADE IS A WARNING, NOT A FOOTNOTE', async () => {
  /* THE 18 OCTOBER BUG, AND WHY THIS TEST CHANGED SHAPE.
   *
   * It used to assert one line: "the domain was attached" or "could not
   * be attached". That was the whole problem. Cloudflare registered the
   * domain on the project and answered success, the DNS record was never
   * created, and the screen reported a working blog at an address that
   * returned NXDOMAIN. One boolean could not tell those apart, so the
   * screen now reports both halves and so does this. */
  install();
  stubPublish({
    ...PUBLISHED,
    setup: {
      created: true,
      attached: { ok: true, status: 'pending' },
      dns: { ok: false, error: 'Unauthorized to access requested resource [code: 9109]' },
    },
  });

  const out = await call(handler('post', '/static-blogs/:id/publish'),
    req({ body: { mode: 'publish' } }));

  assert.ok(/not created/i.test(out.html), 'the DNS failure is not on the page');
  assert.ok(out.html.includes('9109'), "Cloudflare's reason was dropped");
  assert.ok(out.html.includes('alert-warning'), 'a half-finished domain was shown as good news');

  /* AND IT SAYS WHAT TO DO. The last time this failed, working out that
   * a CNAME was missing took an evening. */
  assert.ok(/CNAME/.test(out.html), 'it does not say what record to add');
  assert.ok(/Zone → DNS → Edit/.test(out.html), 'it does not say what the token is missing');
});

test('AND A DOMAIN THAT FULLY WORKED IS SAID PLAINLY', async () => {
  install();
  stubPublish({
    ...PUBLISHED,
    setup: {
      created: true,
      attached: { ok: true, status: 'pending' },
      dns: { ok: true, created: true },
    },
  });

  const out = await call(handler('post', '/static-blogs/:id/publish'),
    req({ body: { mode: 'publish' } }));

  /* THE RENDERED MARKUP, NOT ANY TEXT ON THE PAGE. A looser /first
   * publish/i matched the HTML COMMENT above the banner — comments ship
   * to the browser, so the assertion passed with the banner absent. */
  assert.ok(out.html.includes('<strong>First publish for this blog.</strong>'));
  assert.ok(/should answer within a minute/i.test(out.html));
  assert.ok(!/not created/i.test(out.html), 'a success was reported as a failure');
  assert.ok(!/alert-warning/.test(out.html), 'a working domain was shown as a warning');
});

test('THE PUBLISH SCREEN LINKS TO THE BLOG\'S OWN DOMAIN FIRST', async () => {
  /* It linked only to the pages.dev address, because that is what the
   * deploy reports back. Edwin published to a subdomain, pressed "See
   * it", landed on all-about-roofing-explr-home-com.pages.dev and
   * reasonably asked why the subdomain had not been used. It had been —
   * every canonical on the site names it. Only this link was wrong.
   *
   * BOTH, NOT ONE. The Cloudflare address is the one that still works
   * while DNS is catching up, which is exactly when somebody is most
   * likely to press a link. */
  install();
  stubPublish(PUBLISHED);

  const out = await call(handler('post', '/static-blogs/:id/publish'),
    req({ body: { mode: 'publish' } }));

  const own = out.html.indexOf('https://leanderwaterheaters.com/');
  const cloudflare = out.html.indexOf(PUBLISHED.url);

  assert.ok(own !== -1, "the blog's own domain is not linked at all");
  assert.ok(cloudflare !== -1, 'the Cloudflare address is gone, so a pending domain has no fallback');
  assert.ok(own < cloudflare, 'the Cloudflare address is offered before the real one');
});

test('AND A PREVIEW OFFERS NEITHER, BECAUSE NOTHING MOVED', async () => {
  install();
  stubPublish({ ...PUBLISHED, url: undefined });

  const out = await call(handler('post', '/static-blogs/:id/publish'),
    req({ body: { mode: 'preview' } }));

  assert.ok(!out.html.includes("Cloudflare's address"),
    'a preview claimed the site was live somewhere');

  /* THE `!dryRun` HALF OF THAT GUARD IS AN EQUIVALENT MUTANT, AND IS
   * KEPT ANYWAY.
   *
   * Removing it kills no test, because publishBlog returns no `url` on a
   * dry run — so `result.url` alone already closes the block and the two
   * conditions can never disagree. Mutation found this; it is recorded
   * rather than tested around, because the only way to kill it would be
   * to stub a preview that carries a url, which is a state the real
   * function cannot produce. A test of an impossible state proves
   * nothing and has to be maintained for ever.
   *
   * The condition stays because it says what the rule IS — a preview
   * sends nothing, so it links to nothing — rather than relying on a
   * field happening to be absent two files away. */
});

test('AND A REGISTRATION THAT FAILED IS REPORTED ON ITS OWN LINE', async () => {
  /* The other way round: the DNS record exists but Cloudflare would not
   * take the domain on the project. Different cause, different fix, and
   * it must not be described as a DNS problem. */
  install();
  stubPublish({
    ...PUBLISHED,
    setup: {
      created: true,
      attached: { ok: false, error: 'Domain already in use [code: 8000031]' },
      dns: { ok: true, created: false },
    },
  });

  const out = await call(handler('post', '/static-blogs/:id/publish'),
    req({ body: { mode: 'publish' } }));

  assert.ok(out.html.includes('8000031'), 'the registration failure was dropped');
  assert.ok(/already there/i.test(out.html), 'the existing DNS record was not reported');
  assert.ok(out.html.includes('alert-warning'));
});

test('AND A LATER PUBLISH SAYS NOTHING ABOUT SETUP AT ALL', async () => {
  /* The setup only runs on a blog's first deploy, so `setup` is null
   * afterwards. A screen that showed the banner every time would be
   * telling you about work that did not happen. */
  install();
  stubPublish({ ...PUBLISHED, setup: null });

  const out = await call(handler('post', '/static-blogs/:id/publish'),
    req({ body: { mode: 'publish' } }));

  assert.ok(!out.html.includes('<strong>First publish for this blog.</strong>'),
    'an established blog claimed to be new');
});

section('WHEN THE POSTS ACTUALLY GO OUT');

test('THE CAMPAIGN ROW CARRIES ITS DATES', async () => {
  /* The column that would have saved the afternoon above. A table showing
   * a status and a count, next to a note saying future articles wait,
   * never names the day — so "nothing is due" reads as a broken deploy. */
  install({
    campaigns: [{
      _id: 'c1',
      name: 'Autumn heaters',
      status: 'active',
      targetPage: { keyword: 'water heater repair' },
      slots: [
        { index: 0, publishAt: '2099-11-01T09:00:00Z' },
        { index: 1, publishAt: '2099-11-08T09:00:00Z' },
        { index: 2, publishAt: '2099-11-15T09:00:00Z' },
      ],
    }],
  });

  const out = await call(handler('get', '/static-blogs/:id'));

  assert.ok(out.html.includes('2099-11-01'), 'the first date is not on the row');
  assert.ok(out.html.includes('2099-11-15'), 'the last date is not on the row');
  assert.ok(/next 2099-11-01/.test(out.html), 'the row does not say which is next');
});

test('IN THE BLOG\'S OWN ZONE, NOT THE SERVER\'S', async () => {
  /* THE SURVIVING MUTANT THIS CLOSES. Every date in the test above is at
   * 09:00 UTC against a blog with no zone set, so UTC and the blog's zone
   * give the same answer and a column that had quietly fallen back to UTC
   * passed anyway.
   *
   * An evening post is where they part. 02:00 UTC on 2 November is eight
   * in the evening on 1 November in Texas — so a UTC column tells a Texas
   * business its post goes out on a day its blog will never publish on.
   * Off by one, only after six o'clock, only for customers behind UTC. */
  install({
    campaigns: [{
      _id: 'c1', name: 'Evening', status: 'active', targetPage: { keyword: 'k' },
      slots: [{ index: 0, publishAt: '2099-11-02T02:00:00Z' }],
    }],
  });
  db.blogs[0].timezone = 'America/Chicago';

  const out = await call(handler('get', '/static-blogs/:id'));

  assert.ok(out.html.includes('2099-11-01'),
    'the row showed the server\'s day rather than the blog\'s');
  assert.ok(!out.html.includes('2099-11-02'),
    'the row is still rendering in UTC');
});

test('AND SAYS SO WHEN THEY HAVE ALL PASSED', async () => {
  install({
    campaigns: [{
      _id: 'c1', name: 'Old one', status: 'active', targetPage: { keyword: 'k' },
      slots: [{ index: 0, publishAt: '2020-01-01T09:00:00Z' }],
    }],
  });

  const out = await call(handler('get', '/static-blogs/:id'));

  assert.ok(/all dates have passed/i.test(out.html),
    'a finished campaign still claims something is coming');
});

test('A CAMPAIGN WITH NO DATES DOES NOT BREAK THE TABLE', async () => {
  /* A draft is planned before it is scheduled, and a slot can carry
   * nonsense. Neither is a reason for the page to throw — the row is
   * informational and the rest of the screen still has to work. */
  install({
    campaigns: [{
      _id: 'c1', name: 'Draft', status: 'draft', targetPage: { keyword: 'k' },
      slots: [{ index: 0, publishAt: null }, { index: 1, publishAt: 'nonsense' }],
    }],
  });

  const out = await call(handler('get', '/static-blogs/:id'));

  assert.strictEqual(out.status, 200, 'the page threw on a campaign with no dates');
  assert.ok(out.html.includes('Draft'), 'the campaign vanished from the table');
});

section('STARTING THE TOPIC LIST OVER');

test('NEITHER BUTTON TOUCHES THE TOPICS BOX', async () => {
  /* THIS TEST USED TO BE "SUGGEST ADDS; DIFFERENT ONES REPLACES", and
   * both halves described writing into the textarea. Nothing writes into
   * it any more — suggestions are a tick-list, and the box holds only
   * what was typed. "Replacing" has nothing left to replace.
   *
   * What survives is the distinction the two buttons still draw, and it
   * moved to the avoid list: see the test below. */
  install();
  model.topics = [{ topic: 'Brand new idea', targetQuery: 'brand new' }];

  const body = {
    targetUrl: 'https://example.com/repair/',
    targetKeyword: 'water heater repair',
    topics: 'Old one | old\nOlder still',
  };

  for (const over of [{}, { fresh: '1' }]) {
    const out = await call(handler('post', '/static-blogs/:id/suggest'),
      req({ body: { ...body, ...over } }));

    const typed = topicsBox(out.html).split('\n').map(l => l.trim()).filter(Boolean);

    assert.deepStrictEqual(typed, ['Old one | old', 'Older still'],
      `${JSON.stringify(over)} changed what was typed`);

    assert.deepStrictEqual(suggestionLines(out.html), ['Brand new idea | brand new'],
      `${JSON.stringify(over)} did not offer the new idea`);
  }
});

test('AND "DIFFERENT ONES" AVOIDS WHAT IS ON SCREEN, NOT JUST THE BOX', async () => {
  /* THE HALF THAT WOULD OTHERWISE HAVE BEEN LOST IN THE REDESIGN.
   *
   * When suggestions went into the textarea, avoiding the box avoided
   * everything you had seen. Now they are a tick-list — on screen and
   * nowhere else — so a request that avoided only the box would hand
   * back the identical six and the button would look broken. The card
   * carries them in a hidden field for exactly this. */
  install();
  model.topics = [{ topic: 'Brand new idea', targetQuery: 'brand new' }];
  model.calls.length = 0;

  await call(handler('post', '/static-blogs/:id/suggest'), req({
    body: {
      targetUrl: 'https://example.com/repair/',
      targetKeyword: 'water heater repair',
      topics: 'Typed by hand',
      shown: 'Shown a moment ago | some phrase\nAlso shown',
      fresh: '1',
    },
  }));

  const avoid = model.calls[0].opts.avoid;

  assert.ok(avoid.includes('Typed by hand'), 'the typed topic was not avoided');
  assert.ok(avoid.includes('Shown a moment ago'), 'the displayed suggestion was not avoided');
  assert.ok(avoid.includes('Also shown'), 'a displayed suggestion with no phrase was not avoided');
  assert.ok(!avoid.includes('Shown a moment ago | some phrase'),
    'the whole line was sent, so the avoid list matches nothing');
});

test('AND THE CARD CARRIES THEM BACK FOR IT', async () => {
  /* The other end of the same wire. A card that rendered the rows but
   * not the hidden field would leave the button avoiding nothing, and
   * the only symptom would be the same ideas coming round again. */
  install();
  model.topics = [
    { topic: 'First idea', targetQuery: 'first' },
    { topic: 'Second idea', targetQuery: 'second' },
  ];

  const out = await call(handler('post', '/static-blogs/:id/suggest'), req({
    body: { targetUrl: 'https://example.com/repair/', targetKeyword: 'k', topics: '' },
  }));

  const hidden = out.html.match(/<input type="hidden" name="shown" value="([^"]*)"/);

  assert.ok(hidden, 'the card does not carry what it showed');
  assert.ok(hidden[1].includes('First idea'), 'the first suggestion was not carried');
  assert.ok(hidden[1].includes('Second idea'), 'the second suggestion was not carried');
});

test('AND THE OLD TOPICS ARE WHAT IT AVOIDS', async () => {
  /* THE TOPIC, NOT THE WHOLE LINE. A line is `topic | search phrase`, and
   * sending it whole hands the model a string no topic will ever equal —
   * the avoid list then matches nothing and the button silently does half
   * its job. Nothing on screen would say so. */
  install();
  model.topics = [{ topic: 'New', targetQuery: 'new' }];
  model.calls.length = 0;

  await call(handler('post', '/static-blogs/:id/suggest'), req({
    body: {
      targetUrl: 'https://example.com/repair/',
      targetKeyword: 'water heater repair',
      topics: 'Old one | old search phrase\nOlder still',
      fresh: '1',
    },
  }));

  const avoid = model.calls[0].opts.avoid;
  assert.ok(avoid.includes('Old one'), 'the topic was not avoided');
  assert.ok(avoid.includes('Older still'), 'a topic without a phrase was not avoided');
  assert.ok(!avoid.includes('Old one | old search phrase'),
    'the whole line was sent, so the avoid list matches nothing');
});

test('THE ORDINARY BUTTON STILL AVOIDS NOTHING OF ITS OWN', async () => {
  /* THE MUTATION GUARD. `fresh` read loosely, or the avoid list built
   * unconditionally, turns "add six more" into "replace with six" — and
   * anything typed by hand disappears on a button press. */
  install();
  model.topics = [{ topic: 'New', targetQuery: 'new' }];
  model.calls.length = 0;

  const body = {
    targetUrl: 'https://example.com/repair/',
    targetKeyword: 'water heater repair',
    topics: 'Old one',
  };

  for (const over of [{}, { fresh: '' }, { fresh: '0' }, { fresh: 'false' }]) {
    model.calls.length = 0;
    const out = await call(handler('post', '/static-blogs/:id/suggest'),
      req({ body: { ...body, ...over } }));

    assert.deepStrictEqual(model.calls[0].opts.avoid, [],
      `${JSON.stringify(over)} built an avoid list`);
    assert.ok(out.html.includes('Old one'),
      `${JSON.stringify(over)} threw away what was typed`);
  }
});

test('BOTH BUTTONS, AND A WAY TO EMPTY THE BOX, ARE ON THE PAGE', async () => {
  install();
  const out = await call(handler('get', '/static-blogs/:id'));

  assert.ok(out.html.includes('name="fresh" value="1"'),
    'there is no way to ask for different topics');
  assert.ok(/clear topics/i.test(out.html), 'there is no way to empty the box');

  /* The clear button must not submit. A type="submit" here would post the
   * form to /plan with an empty topics box, which is a refusal page
   * instead of an empty textarea. */
  assert.ok(/<button[^>]*type="button"[^>]*>\s*Clear topics/i.test(out.html),
    'the clear button submits the form');
});

section('CHOOSING THE FRONT PAGE');

test('THE PICKER LISTS THIS BLOG\'S ARTICLES, AND THE CURRENT CHOICE IS SELECTED', async () => {
  /* There is no listing page, so something has to answer for the bare
   * domain. The choice is on the BLOG rather than on a campaign, because a
   * blog can have several campaigns and a per-campaign flag would let two
   * of them claim the root with nothing to decide between them. */
  install();
  db.blogs[0].homeSlug = 'second-one';

  const out = await call(handler('get', '/static-blogs/:id'));

  assert.ok(out.html.includes('name="homeSlug"'), 'there is no way to choose a front page');
  assert.ok(out.html.includes('>\n                  First one\n                </option>')
    || out.html.includes('First one'), 'the articles are not listed');

  /* SCOPED TO THE homeSlug SELECT, and it did not used to be.
   *
   * This read `out.html.match(/<option value="..." selected>/)` — the
   * first selected option ANYWHERE on the page. It passed for months and
   * then broke the day a timezone dropdown was added above it, because
   * that one is also a select with a selected option. The test was not
   * wrong about the front page; it was asking the page a question that
   * only had one possible answer at the time. */
  const picker = out.html.slice(out.html.indexOf('name="homeSlug"'));
  const selected = picker.match(/<option value="([^"]*)" selected>/);

  assert.ok(selected, 'nothing is marked as the current choice');
  assert.strictEqual(selected[1], 'second-one', 'the wrong article is shown as the front page');
});

test('and it is scoped to this blog', async () => {
  install();
  await call(handler('get', '/static-blogs/:id'));

  assert.strictEqual(String(db.postFindWhere.site), BLOG_ID,
    "the picker lists every account's articles");
});

test('with no articles yet, the picker is not shown at all', async () => {
  /* An empty dropdown is a control that cannot be used, next to a label
   * asking a question that has no answers. */
  install({ articles: [] });

  const out = await call(handler('get', '/static-blogs/:id'));
  assert.ok(!out.html.includes('name="homeSlug"'), 'an empty picker was rendered');
});

test('SAVING IT STORES THE SLUG ON THE BLOG', async () => {
  install();

  const out = await call(handler('post', '/static-blogs/:id/home'),
    req({ body: { homeSlug: 'second-one' } }));

  assert.strictEqual(out.redirected, `/static-blogs/${BLOG_ID}`);
  assert.strictEqual(db.siteUpdates.length, 1, 'nothing was saved');
  assert.deepStrictEqual(db.siteUpdates[0].update, { $set: { homeSlug: 'second-one' } });
  assert.strictEqual(String(db.siteUpdates[0].where._id), BLOG_ID);
});

test('and empty is a real choice, meaning whichever is oldest', async () => {
  install();
  db.blogs[0].homeSlug = 'second-one';

  await call(handler('post', '/static-blogs/:id/home'), req({ body: { homeSlug: '' } }));

  assert.deepStrictEqual(db.siteUpdates[0].update, { $set: { homeSlug: '' } },
    'clearing the choice did not save');
});

test('AN ARTICLE THAT IS NOT ON THIS BLOG IS REFUSED', async () => {
  /* The value comes from a <select>, so in a browser it is always one of
   * the options — which is exactly why it cannot be trusted. Without the
   * check the field stores any string, including another blog's slug: not
   * a leak, but a setting that can never come true and shows as selected
   * for ever. */
  install();

  const out = await call(handler('post', '/static-blogs/:id/home'),
    req({ body: { homeSlug: 'from-another-blog' } }));

  assert.strictEqual(out.status, 400);
  assert.deepStrictEqual(db.siteUpdates, [], 'an unknown slug was stored');
  assert.strictEqual(String(db.postExistsWhere.site), BLOG_ID,
    'the check was not scoped to this blog');
});

test("and another account cannot set this blog's front page", async () => {
  install();

  const out = await call(handler('post', '/static-blogs/:id/home'),
    req({ user: { _id: OTHER_USER }, body: { homeSlug: 'second-one' } }));

  assert.strictEqual(out.status, 404);
  assert.deepStrictEqual(db.siteUpdates, []);
});

test('nor can a WordPress site be driven through it', async () => {
  install();
  db.blogs[0].target = 'wordpress';

  const out = await call(handler('post', '/static-blogs/:id/home'),
    req({ body: { homeSlug: 'second-one' } }));

  assert.strictEqual(out.status, 404);
  assert.deepStrictEqual(db.siteUpdates, []);
});

test('AN ARTICLE TITLE WITH HTML IN IT DOES NOT BECOME HTML', async () => {
  install({ articles: [{ title: '<img src=x onerror=alert(1)>', slug: 'x" onmouseover="y' }] });

  const out = await call(handler('get', '/static-blogs/:id'));

  assert.ok(!out.html.includes('<img src=x'), 'an article title was rendered as markup');
  assert.ok(!out.html.includes('onmouseover="y'), 'a slug broke out of the option value');
});

/* ======================================================================= */

(async () => {
  for (const run of queue) await run();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
