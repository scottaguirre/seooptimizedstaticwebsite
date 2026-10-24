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

/* AND THE ACCOUNT RESOLVER, BEFORE THE ROUTER, FOR THE SIXTH TIME IN THIS
 * FILE. The route destructures credsFor at load like everything else here.
 *
 * It answers from the blog it is given, so a test can say "this blog is on
 * a pool account" by setting one field on the fixture rather than by
 * standing up two collections. */
const POOL_CREDS = { token: 'tok-client-3', account: 'acct-id-3' };

/* AND THE DOMAIN POOL, BEFORE THE ROUTER, FOR THE SEVENTH TIME IN THIS
 * FILE. The create screen reads it for its dropdown and the create handler
 * reads it to decide whether a posted domain is one of ours. */
const DomainModel = require('./models/Domain');

DomainModel.find = (where = {}) => ({
  sort: () => ({
    lean: async () => (db.pool || []).filter(d =>
      undefined === where.enabled || d.enabled === where.enabled),
  }),
});

DomainModel.findOne = async (where = {}) =>
  (db.pool || []).find(d => d.domain === where.domain) || null;

const accountsModule = require('./utils/blog/cloudflare/accounts');

accountsModule.credsFor = async (blog) => {
  const id = blog && blog.cloudflareAccount;

  if (!id) return undefined;
  if ('acct-broken' === String(id)) {
    throw new Error('The Cloudflare account for this blog is disabled (Client 3).');
  }

  return POOL_CREDS;
};

/* AND THE CAPACITY CHECK, BEFORE THE ROUTER, FOR THE EIGHTH TIME IN THIS
 * FILE.
 *
 * Cloudflare caps Pages projects at 100 per account and one blog is one
 * project. Before this, nothing noticed: the customer filled in the form,
 * pressed Create, and Cloudflare refused — in front of the one person who
 * could do nothing about it, in language they could not read.
 *
 * ASKED LIVE rather than read off the account row, because the stored count
 * is a snapshot and the moment it matters is this one. One request, one
 * account, at the only point where being wrong costs anything.
 *
 * `room` is what recountAccount will answer. Defaulted to "plenty of space",
 * which is the quiet path, so every existing creation test goes on behaving
 * exactly as it did. */
const capacity = { room: { ok: true, projects: 4 }, calls: [] };

accountsModule.recountAccount = async (acct) => {
  capacity.calls.push(acct && String(acct._id));
  return capacity.room;
};

const CloudflareAccountModel = require('./models/CloudflareAccount');

CloudflareAccountModel.findById = async (id) =>
  ('acct-gone' === String(id) ? null : { _id: id, label: 'Client 3', accountId: 'a'.repeat(32) });

const accountWrites = [];
CloudflareAccountModel.updateOne = async (where, update) => {
  accountWrites.push({ where, update });
  return { acknowledged: true };
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
  listCalls: [],
};

cloudflareModule.findZone = async (opts) => { zones.findCalls.push(opts); return zones.find; };
cloudflareModule.listZones = async (opts) => { zones.listCalls.push(opts); return zones.list; };


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
    /* A DEFAULT POOL, so the creation tests have something to pick from.
     * The free-text domain field went on 22 October: a blog is created by
     * typing a prefix and choosing one of these. */
    pool: [
      { _id: 'dom-lwh', domain: 'leanderwaterheaters.com', account: 'acct-3', enabled: true },
      { _id: 'dom-explr', domain: 'explr-home.com', account: 'acct-3', enabled: true },
    ],
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
    const rows = async () => {
      if (where && where['targetPage.url']) return [];

      /* isPillar IS HONOURED, because the front-page handler asks for the
       * pillar campaigns to validate against. A stub that returned every
       * campaign would let a money-page article pass the check. */
      if (where && true === where.isPillar) return db.campaigns.filter(c => c.isPillar);

      return db.campaigns;
    };
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

  /* The written articles, which the front-page picker lists and the
   * Articles screen pages through.
   *
   * THE STUB ACTUALLY SLICES, and that is the whole point of it. An earlier
   * shape ignored .skip() and .limit() and returned every row, which would
   * have let "page one shows fifty of them" pass against a route that asked
   * the database for all 171 and printed the lot. A stub that is more
   * generous than the real thing tests nothing.
   *
   * The calls are recorded as well, because WHAT WAS ASKED FOR matters
   * separately from what came back: a route that fetches everything and
   * slices in JavaScript renders the right page and still drags a whole
   * blog's titles out of Mongo on every view. */
  BlogPost.find = (where) => {
    db.postFindWhere = where;
    db.postFindSkip = null;
    db.postFindLimit = null;

    const chain = {
      select: () => chain,
      sort: () => chain,
      skip: (n) => { db.postFindSkip = n; return chain; },
      limit: (n) => { db.postFindLimit = n; return chain; },
      lean: async () => {
        /* THE CAMPAIGN FILTER IS HONOURED, because the front-page picker
         * asks for pillar articles only and a stub that ignored the filter
         * would let the dropdown "pass" while offering all 171. */
        const ids = where && where.campaign && where.campaign.$in;

        const pool = ids
          ? db.articles.filter(a => ids.some(id => String(id) === String(a.campaign)))
          : db.articles;

        const from = db.postFindSkip || 0;
        const to = null === db.postFindLimit ? undefined : from + db.postFindLimit;
        return pool.slice(from, to);
      },
    };
    return chain;
  };

  /* ONE DOCUMENT, BY CAMPAIGN AND SLOT — the serving-article lookup. The
   * page works out WHICH slot is answering for the domain from the
   * campaigns it already has, then asks for that one post's title. */
  BlogPost.findOne = (where) => {
    db.postFindOneWhere = where;

    const found = db.articles.find(a =>
      (!where.campaign || String(a.campaign) === String(where.campaign))
      && (undefined === where.slotIndex || a.slotIndex === where.slotIndex)) || null;

    const chain = { select: () => chain, lean: async () => found };
    return chain;
  };

  BlogPost.exists = async (where) => {
    db.postExistsWhere = where;

    const ids = where.campaign && where.campaign.$in;

    return db.articles.some(a =>
      a.slug === where.slug
      && String(db.blogs[0]._id) === String(where.site)
      && (!ids || ids.some(id => String(id) === String(a.campaign)))) || null;
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
    body: { name: 'Leander Water Heaters', prefix: 'blog', domain: 'leanderwaterheaters.com' },
  }));

  assert.strictEqual(db.created.target, 'cloudflare');
  assert.strictEqual(db.created.business.name, 'Leander Water Heaters');
  assert.ok(!('licenceKeyHash' in db.created), 'a licence key was issued to a static blog');
  assert.ok(!('secret' in db.created), 'a signing secret was issued to a static blog');
  assert.ok(out.redirected, 'the browser was not sent anywhere afterwards');
});

test('THE HOSTNAME IS NORMALISED BEFORE IT IS STORED', async () => {
  /* Stored raw, the duplicate check below would miss and two blogs would
   * deploy over each other.
   *
   * THE DOMAIN IS NO LONGER TYPED — it comes from the pool already
   * normalised, so the half a customer can get wrong is the prefix. */
  install({ blogs: [] });

  await call(handler('post', '/static-blogs'), req({
    body: { name: 'X', prefix: '  BLOG ', domain: 'leanderwaterheaters.com' },
  }));

  assert.strictEqual(db.created.siteUrl, 'blog.leanderwaterheaters.com');
});

test('and the same hostname twice is refused', async () => {
  /* The fixture blog is on leanderwaterheaters.com itself; a second blog
   * at the same address would publish over it. */
  install({ blogs: [{ _id: BLOG_ID, user: USER_ID, target: 'cloudflare', status: 'active',
                      siteUrl: 'blog.leanderwaterheaters.com',
                      business: { name: 'Leander Water Heaters' } }] });

  const out = await call(handler('post', '/static-blogs'), req({
    body: { name: 'Again', prefix: 'blog', domain: 'leanderwaterheaters.com' },
  }));

  assert.strictEqual(out.status, 400);
  assert.strictEqual(db.created, null, 'a second blog was created on the same hostname');
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
    body: { name: 'All About HVAC', prefix: 'all-about-hvac', domain: 'explr-home.com' },
  }));

  assert.ok(!out.redirected, 'it redirected past the warning');
  assert.ok(/No domain in your Cloudflare account matches/i.test(out.html),
    'the screen does not say the domain is unreachable');
});

test('AND IT NAMES THE DOMAIN THAT WAS LOOKED FOR', async () => {
  /* THE "DID YOU MEAN" SUGGESTION IS ALL BUT DEAD — 22 October. It existed
   * for Edwin typing `all-bout-hvac-explr-home.com`, one dot turned into a
   * hyphen. The domain now comes from a dropdown, so that typo cannot be
   * made; what is left is an ADMIN mistake, a pool domain added against an
   * account whose zone list does not include it.
   *
   * The suggestion machinery is left in place because it is harmless and
   * tested, but it is worth removing deliberately rather than leaving as
   * code nobody can explain. Noted in CLAUDE.md. */
  install({ blogs: [] });
  zones.find = { ok: false, noZone: true, error: 'no' };
  zones.list = { ok: true, names: ['explr-home.com'] };

  const out = await call(handler('post', '/static-blogs'), req({
    body: { name: 'All About HVAC', prefix: 'all-about-hvac', domain: 'explr-home.com' },
  }));

  assert.ok(out.html.includes('all-about-hvac.explr-home.com'),
    'the screen does not say which hostname could not be found');
});

test('BUT THE BLOG IS STILL CREATED, BECAUSE IT WARNS RATHER THAN BLOCKS', async () => {
  /* A blog on a domain Cloudflare does not host is a legitimate thing to
   * want — the owner points the DNS himself and everything else works.
   * Refusing would break that to catch a typo. */
  install({ blogs: [] });
  zones.find = { ok: false, noZone: true, error: 'no' };

  const out = await call(handler('post', '/static-blogs'), req({
    body: { name: 'Elsewhere', prefix: 'elsewhere', domain: 'explr-home.com' },
  }));

  assert.ok(db.created, 'the blog was refused rather than flagged');
  assert.strictEqual(db.created.siteUrl, 'elsewhere.explr-home.com');
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
    body: { name: 'All About HVAC', prefix: 'all-about-hvac', domain: 'explr-home.com' },
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
    body: { name: 'X', prefix: 'all-about-hvac', domain: 'explr-home.com' },
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
    body: { name: 'X', prefix: 'all-about-hvac', domain: 'explr-home.com' },
  }));

  assert.ok(/No domain in your Cloudflare account matches/i.test(out.html));
  assert.ok(!/Did you mean/i.test(out.html), 'it suggested something it could not know');
});

/* ─────────── THE CHECK HAS TO ASK THE ACCOUNT THE BLOG IS ON ───────────
 *
 * EDWIN HIT THIS THE FIRST TIME HE USED THE POOL — 22 October.
 *
 * He added a second Cloudflare account for `site-book.net`, added the domain
 * against it, created `cutting-edge-plumbing-techniques.site-book.net`, and
 * the screen told him no domain in his Cloudflare account matched it.
 *
 * The blog was perfect. The CHECK was wrong: `findZone({ domain })` with no
 * credentials falls back to the environment, so it had asked his OLD
 * explr-home.com account whether it owned site-book.net. Of course it did not.
 *
 * THE SAME WIRING GAP, THREE TIMES IN ONE SESSION. findZone and listZones
 * were both taught about per-account credentials. This caller was not
 * updated, and nothing failed — a function whose credentials argument is
 * optional does not complain when you forget it. It just answers about
 * somewhere else.
 *
 * A false warning is not harmless here. It appears at the one moment the
 * screen exists to make somebody doubt their domain, and it would have fired
 * on EVERY blog created on EVERY pool domain. The lesson taken from it is
 * worse than the warning: "that alarm is always wrong, click past it". */

test('THE ZONE CHECK ASKS THE ACCOUNT THE BLOG IS ACTUALLY ON', async () => {
  install({ blogs: [] });
  zones.findCalls.length = 0;
  zones.find = { ok: true, id: 'z1', name: 'explr-home.com' };

  await call(handler('post', '/static-blogs'), req({
    body: { name: 'All About HVAC', prefix: 'all-about-hvac', domain: 'explr-home.com' },
  }));

  assert.strictEqual(zones.findCalls.length, 1, 'the zone was not looked up at all');

  /* THE ASSERTION IS ON WHAT WENT OVER THE WIRE, not on what came back,
   * and that is the only thing that catches this. The return value is
   * identical whether the right account or the wrong one was asked. */
  assert.deepStrictEqual(zones.findCalls[0].creds, POOL_CREDS,
    'the check asked the environment\'s account, not the blog\'s');
});

test('AND SO DOES THE ZONE LIST BEHIND THE SUGGESTION', async () => {
  /* The other half, and the quieter one. listZones() on the wrong account
   * returns the wrong account's domains — so "Did you mean …?" would offer
   * a domain from somewhere else entirely, which is worse than offering
   * nothing. */
  install({ blogs: [] });
  zones.listCalls.length = 0;
  zones.find = { ok: false, noZone: true, error: 'no' };
  zones.list = { ok: true, names: ['explr-home.com'] };

  await call(handler('post', '/static-blogs'), req({
    body: { name: 'X', prefix: 'all-about-hvac', domain: 'explr-home.com' },
  }));

  assert.strictEqual(zones.listCalls.length, 1, 'the zone list was never read');
  assert.ok(zones.listCalls[0] && zones.listCalls[0].creds,
    'the suggestion would be drawn from the wrong account\'s domains');
  assert.deepStrictEqual(zones.listCalls[0].creds, POOL_CREDS);
});

test('A BLOG ON NO POOL ACCOUNT STILL ASKS WITH NOTHING, WHICH MEANS THE ENVIRONMENT', async () => {
  /* The fallback has to survive. A Domain row with no account is the
   * server's own account, and passing `creds: undefined` is how cfApi is
   * told so. Passing a half-built object instead would make it refuse. */
  install({
    blogs: [],
    pool: [{ _id: 'dom-own', domain: 'explr-home.com', account: null, enabled: true }],
  });
  zones.findCalls.length = 0;
  zones.find = { ok: true, id: 'z1', name: 'explr-home.com' };

  await call(handler('post', '/static-blogs'), req({
    body: { name: 'X', prefix: 'all-about-hvac', domain: 'explr-home.com' },
  }));

  assert.strictEqual(zones.findCalls.length, 1);
  assert.strictEqual(zones.findCalls[0].creds, undefined,
    'it invented credentials for a blog that has none');
});

test('AND A CREDENTIAL THAT CANNOT BE RESOLVED SKIPS THE CHECK RATHER THAN BREAKING', async () => {
  /* credsFor THROWS for an account that is gone, disabled, or whose token
   * will not decrypt — deliberately, because falling back would deploy
   * into the wrong account.
   *
   * But by this point the blog has ALREADY BEEN CREATED. Letting that throw
   * escape turns a created blog into a 500, and the person is left looking
   * at an error page for a blog that exists.
   *
   * So it is caught, and the check is skipped. Which is the rule the
   * comment above the check already states: a failure to ask is not a
   * failure to match. The credential problem surfaces at the first publish,
   * named, from credsFor itself. */
  install({
    blogs: [],
    pool: [{ _id: 'dom-bad', domain: 'explr-home.com', account: 'acct-broken', enabled: true }],
  });
  zones.findCalls.length = 0;
  zones.find = { ok: false, noZone: true, error: 'no' };

  const out = await call(handler('post', '/static-blogs'), req({
    body: { name: 'X', prefix: 'all-about-hvac', domain: 'explr-home.com' },
  }));

  assert.notStrictEqual(out.status, 500, 'an unusable account took the creation down');
  assert.ok(db.created, 'the blog was lost');
  assert.strictEqual(zones.findCalls.length, 0,
    'it asked anyway, with credentials it could not resolve');
  assert.ok(out.redirected, 'it warned on the strength of a check it never ran');
});

/* ──────────── ONE HUNDRED PAGES PROJECTS AND NOT ONE MORE ────────────
 *
 * Cloudflare caps Pages projects at 100 per account and says the limit is
 * not routinely raised. One blog is one project.
 *
 * Before this, the app did not know. A customer on a full account typed a
 * prefix, picked a domain, pressed Create — and Cloudflare refused. What
 * reached the screen was a raw wrangler error: unreadable, unactionable,
 * and landing on the one person who could do nothing about it.
 *
 * The check is LIVE, not read from `CloudflareAccount.projects`. That
 * stored number is a snapshot for the admin screen and can be weeks old;
 * this is the one moment where being wrong has a cost, and it is one
 * request about one account.
 */

function freshCapacity(over = {}) {
  capacity.room = over.room || { ok: true, projects: 4 };
  capacity.calls.length = 0;
  accountWrites.length = 0;
}

test('A FULL ACCOUNT IS REFUSED BEFORE THE BLOG IS CREATED', async () => {
  install({ blogs: [] });
  freshCapacity({ room: { ok: true, projects: 100 } });

  const out = await call(handler('post', '/static-blogs'), req({
    body: { name: 'X', prefix: 'all-about-hvac', domain: 'explr-home.com' },
  }));

  assert.strictEqual(out.status, 400);
  assert.strictEqual(db.created, null, 'a blog was created on a full account');
});

test('AND THE REFUSAL SAYS WHAT TO DO ABOUT IT', async () => {
  /* THE WHOLE POINT. The old behaviour also refused — Cloudflare did it —
   * but what reached the customer was a wrangler stack trace. A refusal
   * nobody can act on is only marginally better than a broken blog. */
  install({ blogs: [] });
  freshCapacity({ room: { ok: true, projects: 100 } });

  const out = await call(handler('post', '/static-blogs'), req({
    body: { name: 'X', prefix: 'all-about-hvac', domain: 'explr-home.com' },
  }));

  assert.ok(out.html.includes('explr-home.com'), 'it does not say which domain is full');
  assert.ok(/full/i.test(out.html), 'it does not say the domain is full');
  assert.ok(/another|different|pick/i.test(out.html), 'it does not say to pick another');
});

test('AND IT IS OVER THE LIMIT, NOT MERELY NEAR IT, THAT REFUSES', async () => {
  /* nearlyFull fires at 85 and is a WARNING for the admin screen. Refusing
   * a customer at 86 would throw away fourteen perfectly good blogs. */
  install({ blogs: [] });
  freshCapacity({ room: { ok: true, projects: 99 } });

  await call(handler('post', '/static-blogs'), req({
    body: { name: 'X', prefix: 'all-about-hvac', domain: 'explr-home.com' },
  }));

  assert.ok(db.created, 'an account with one slot left was refused');
});

test('AND AN ACCOUNT ALREADY OVER THE LIMIT IS REFUSED TOO', async () => {
  /* The count comes from Cloudflare, and an account filled by something
   * other than this app can be past 100. A `=== 100` check would wave
   * those straight through. */
  install({ blogs: [] });
  freshCapacity({ room: { ok: true, projects: 137 } });

  const out = await call(handler('post', '/static-blogs'), req({
    body: { name: 'X', prefix: 'all-about-hvac', domain: 'explr-home.com' },
  }));

  assert.strictEqual(out.status, 400);
  assert.strictEqual(db.created, null);
});

test('A CHECK THAT COULD NOT RUN DOES NOT BLOCK THE CUSTOMER', async () => {
  /* THE HALF THAT STOPS THIS BEING WORSE THAN NOTHING, and it is the same
   * rule the zone check follows: a failure to ask is not an answer.
   *
   * A revoked token, a Cloudflare outage, a rate limit — all come back
   * ok:false. Refusing on that basis would turn a transient Cloudflare
   * problem into "you cannot create a blog", for a customer who has done
   * nothing wrong and can see nothing to fix.
   *
   * Letting it through costs, at worst, the error that happened before
   * this feature existed. */
  install({ blogs: [] });
  freshCapacity({ room: { ok: false, error: 'Invalid API Token [code: 1000]' } });

  const out = await call(handler('post', '/static-blogs'), req({
    body: { name: 'X', prefix: 'all-about-hvac', domain: 'explr-home.com' },
  }));

  assert.ok(db.created, 'a Cloudflare outage stopped a blog being created');
  assert.ok(out.redirected || 200 === out.status, 'it refused on a check it never ran');

  /* AND IT WROTE NOTHING DOWN — the assertion that makes the `room.ok`
   * guard visible at all.
   *
   * MUTATION FOUND THIS. Changing `if (room.ok)` to `if (true)` passed
   * every test above: a failed check has no `projects`, so the capacity
   * arithmetic reads it as 0 used, decides there is room, and lets the
   * customer through — the same outcome, for entirely the wrong reason.
   *
   * What it ALSO does is store `projects: undefined`, clobbering a count
   * that was correct with one that is nothing. The inner try/catch around
   * that write — there so a bookkeeping failure never costs a customer
   * their blog — swallowed the evidence. */
  assert.strictEqual(accountWrites.length, 0,
    'it wrote a count it never managed to obtain');
});

test('AND NEITHER DOES AN ACCOUNT ROW THAT HAS GONE', async () => {
  /* Same rule, one layer earlier: the Domain row names an account that is
   * no longer there. credsFor will refuse this at deploy time, named and
   * explained. It is not this form's job to guess. */
  install({
    blogs: [],
    pool: [{ _id: 'dom-x', domain: 'explr-home.com', account: 'acct-gone', enabled: true }],
  });
  freshCapacity();

  await call(handler('post', '/static-blogs'), req({
    body: { name: 'X', prefix: 'all-about-hvac', domain: 'explr-home.com' },
  }));

  assert.ok(db.created, 'a missing account row stopped the blog being created');
  assert.strictEqual(accountWrites.length, 0, 'it wrote to an account that is not there');
});

test('A DOMAIN ON NO POOL ACCOUNT IS NOT CHECKED AT ALL', async () => {
  /* The server's own account, which is every blog that predates the pool.
   * There is nothing to look up and no row to count. */
  install({
    blogs: [],
    pool: [{ _id: 'dom-own', domain: 'explr-home.com', account: null, enabled: true }],
  });
  freshCapacity();

  await call(handler('post', '/static-blogs'), req({
    body: { name: 'X', prefix: 'all-about-hvac', domain: 'explr-home.com' },
  }));

  assert.strictEqual(capacity.calls.length, 0, 'it counted an account that does not exist');
  assert.ok(db.created);
});

test('THE COUNT IT JUST PAID FOR IS KEPT', async () => {
  /* A round trip to Cloudflare was spent to learn this number. Throwing it
   * away would leave the admin screen stale until somebody presses the
   * button — and every blog created is the moment that number changes, so
   * this is exactly when it is worth writing down. */
  install({ blogs: [] });
  freshCapacity({ room: { ok: true, projects: 12 } });

  await call(handler('post', '/static-blogs'), req({
    body: { name: 'X', prefix: 'all-about-hvac', domain: 'explr-home.com' },
  }));

  assert.strictEqual(accountWrites.length, 1, 'the fresh count was discarded');
  assert.strictEqual(accountWrites[0].update.$set.projects, 12);
  assert.ok(accountWrites[0].update.$set.projectsCountedAt instanceof Date);
});

test('AND A FAILED WRITE NEVER COSTS THE CUSTOMER THEIR BLOG', async () => {
  /* Storing the count is housekeeping. The customer is here to create a
   * blog, and a Mongo hiccup updating a number on an admin screen must not
   * be the thing that stops them. */
  install({ blogs: [] });
  freshCapacity();

  const was = CloudflareAccountModel.updateOne;
  CloudflareAccountModel.updateOne = async () => { throw new Error('mongo is having a day'); };

  try {
    const out = await call(handler('post', '/static-blogs'), req({
      body: { name: 'X', prefix: 'all-about-hvac', domain: 'explr-home.com' },
    }));

    assert.ok(db.created, 'a bookkeeping write took the creation down with it');
    assert.notStrictEqual(out.status, 500);
  } finally {
    CloudflareAccountModel.updateOne = was;
  }
});

/* ─────────── THE FRONT PAGE COMES FROM A PILLAR CAMPAIGN ───────────
 *
 * Edwin, 23 October: *"I want only pillar articles to be eligible to be the
 * front page."* It is how he already works — the pillar campaign is the
 * first thing he builds on a blog and the front page is set from it — and
 * the picker was the only part of the app that did not know.
 *
 * It fixes the unbounded dropdown as a side effect. 171 <option> elements
 * became roughly 30, the page stops fetching every article to draw a
 * select, and the control stops growing with the blog.
 *
 * WHICH FORCES THE ARTICLE COUNT TO MOVE IN THE SAME COMMIT. The button
 * reading "171 articles" was `articles.length`, honest only because the
 * page happened to load every article FOR THE DROPDOWN. Narrow the dropdown
 * and that number silently becomes "how many the dropdown offers" while
 * still reading as "how many exist". The comment above blogPageSpec() has
 * said so since the Articles screen shipped.
 */

const PILLAR = { _id: 'c-pillar', name: 'Main pillar', status: 'completed', slots: [{}], isPillar: true };
const ORDINARY = { _id: 'c-money', name: 'Water heaters', status: 'active', slots: [{}], isPillar: false };

/* The default fixture's two articles, placed in a pillar campaign.
 *
 * THE FRONT-PAGE TESTS BELOW NEEDED THIS once the picker narrowed to
 * pillar campaigns: with the bare default — no campaigns at all — there is
 * nothing eligible, so there is no picker to assert on and nothing to
 * save. The tests were not wrong; their fixture no longer described a blog
 * that can have a front page chosen. */
function installPillarDefaults() {
  install({
    campaigns: [PILLAR],
    articles: [
      { _id: '507f1f77bcf86cd799439031', title: 'First one', slug: 'first-one', campaign: 'c-pillar' },
      { _id: '507f1f77bcf86cd799439032', title: 'Second one', slug: 'second-one', campaign: 'c-pillar' },
    ],
  });
}

function installPillar() {
  install({
    campaigns: [PILLAR, ORDINARY],
    articles: [
      { _id: '507f1f77bcf86cd799439041', title: 'Pillar one', slug: 'pillar-one', campaign: 'c-pillar' },
      { _id: '507f1f77bcf86cd799439042', title: 'Pillar two', slug: 'pillar-two', campaign: 'c-pillar' },
      { _id: '507f1f77bcf86cd799439043', title: 'Money one', slug: 'money-one', campaign: 'c-money' },
    ],
  });
}

test('THE FRONT-PAGE PICKER OFFERS PILLAR ARTICLES ONLY', async () => {
  installPillar();

  const out = await call(handler('get', '/static-blogs/:id'), req({ params: { id: BLOG_ID } }));
  const block = picker(out.html);

  assert.ok(block, 'the front-page picker is gone');
  assert.ok(block.includes('pillar-one'), 'a pillar article is not offered');
  assert.ok(block.includes('pillar-two'), 'a pillar article is not offered');

  /* SCOPED TO THE FRONT PAGE BLOCK, not searched across the page.
   * "money-one" appears wherever else that slug is printed, so a
   * whole-page assertion would pass for the wrong reason — which this file
   * has been caught by three times. */
  assert.ok(!block.includes('money-one'),
    'an article from an ordinary campaign is offered as the front page');
});

test('AND THE ARTICLE COUNT STILL COUNTS EVERY ARTICLE', async () => {
  /* THE HALF THAT MAKES THE NARROWING SAFE, and the whole reason the two
   * changes are one commit.
   *
   * The button was articles.length. With the dropdown narrowed to pillars
   * that is 2, on a blog holding 3 — a plausible number in the right place
   * that nobody would question, one click from an Articles screen saying
   * something else. */
  installPillar();

  const out = await call(handler('get', '/static-blogs/:id'), req({ params: { id: BLOG_ID } }));

  assert.ok(/>\s*3 articles\s*</.test(out.html),
    'the Articles button counts what the dropdown offers, not what exists');
});

test('A BLOG WITH NO PILLAR CAMPAIGN SAYS SO INSTEAD OF OFFERING NOTHING', async () => {
  /* An empty <select> is a control that looks broken. The blog still has a
   * front page — the oldest published article — and saying that is more
   * use than a box with one entry in it. */
  install({
    campaigns: [ORDINARY],
    articles: [{ _id: '507f1f77bcf86cd799439043', title: 'Money one', slug: 'money-one', campaign: 'c-money' }],
  });

  const out = await call(handler('get', '/static-blogs/:id'), req({ params: { id: BLOG_ID } }));

  assert.ok(!/<details/.test(picker(out.html) || ''), 'it offered an empty list');
  assert.ok(!/name="homeSlug"/.test(out.html), 'it offered a control with nothing in it');
  assert.ok(/pillar campaign/i.test(out.html), 'it does not say why there is nothing to pick');
  assert.ok(/oldest/i.test(out.html), 'it does not say what the front page is meanwhile');
});

/* ───────── THE PICKER IS A LIST YOU CAN READ, NOT A DROPDOWN ─────────
 *
 * Edwin, 23 October: *"besides number them I want the article be linked to
 * the actual article so I can click it and check them."*
 *
 * WHICH ENDS THE <select>. Options are plain text — a dropdown cannot hold
 * a link, cannot be numbered without putting digits in the label, and
 * cannot be read without being opened. Choosing a front page from thirty
 * titles you cannot click is choosing blind.
 *
 * FOLDED, because thirty rows above "Plan a campaign" is the crowding the
 * Articles screen was moved out to fix. Shut, it says which article is the
 * front page; open, it is the list.
 */

const DAY = 24 * 60 * 60 * 1000;

const PILLAR_SCHEDULED = {
  _id: 'c-pillar',
  name: 'Main pillar',
  status: 'active',
  isPillar: true,
  slots: [
    { index: 0, publishAt: new Date(Date.now() - DAY), status: 'ready' },
    { index: 1, publishAt: new Date(Date.now() + DAY), status: 'ready' },
  ],
};

function installPicker(over = {}) {
  install({
    campaigns: [PILLAR_SCHEDULED, ORDINARY],
    articles: [
      { _id: '507f1f77bcf86cd799439041', title: 'Already live', slug: 'already-live', campaign: 'c-pillar', slotIndex: 0 },
      { _id: '507f1f77bcf86cd799439042', title: 'Not yet', slug: 'not-yet', campaign: 'c-pillar', slotIndex: 1 },
      { _id: '507f1f77bcf86cd799439043', title: 'Money one', slug: 'money-one', campaign: 'c-money', slotIndex: 0 },
    ],
  });

  db.blogs[0].siteUrl = 'blog.example.com';
  db.blogs[0].lastDeployAt = over.neverPublished ? null : new Date(Date.now() - DAY);
  if ('homeSlug' in over) db.blogs[0].homeSlug = over.homeSlug;
}

/* JUST THE LINE ABOVE THE FOLD, and it has to be just that line.
 *
 * Every article's title appears in the list inside the <details>, so
 * `block.includes('Already live')` is true whatever the summary says.
 * Three of these assertions passed that way on the first run — the fourth
 * time this file has been caught by a match that was true for the wrong
 * reason. */
function frontLine(html) {
  const block = picker(html) || '';
  const at = block.indexOf('<details');

  return at < 0 ? block : block.slice(0, at);
}

/** The folded Front page block. */
function picker(html) {
  const at = html.indexOf('Front page</h2>');
  if (at < 0) return null;

  const rest = html.slice(at);
  const end = rest.indexOf('Plan a campaign');

  return end < 0 ? rest : rest.slice(0, end);
}

test('THE PICKER IS A FOLD, NOT A DROPDOWN', async () => {
  installPicker();

  const out = await call(handler('get', '/static-blogs/:id'), req({ params: { id: BLOG_ID } }));
  const block = picker(out.html);

  assert.ok(block, 'the Front page section is gone');
  assert.ok(!/<select[^>]*homeSlug/.test(block), 'it is still a dropdown');
  assert.ok(/<details/.test(block), 'the list is not folded');
});

test('AND EVERY PILLAR ARTICLE IS NUMBERED', async () => {
  installPicker();

  const out = await call(handler('get', '/static-blogs/:id'), req({ params: { id: BLOG_ID } }));
  const block = picker(out.html);

  assert.ok(/>\s*1\s*</.test(block), 'the first article is not numbered');
  assert.ok(/>\s*2\s*</.test(block), 'the second article is not numbered');
});

test('AND THE NUMBERS SAY WHAT THEY COUNT', async () => {
  /* THE CLASH THIS EXISTS TO AVOID. The Articles screen numbers its rows
   * too, over EVERY article on the blog. These number only the pillar
   * ones. On a blog of 171 with a 30-post pillar, "7." means two different
   * articles on two screens one click apart — both plausible, neither
   * wrong on its own terms, and nothing saying they disagree. */
  installPicker();

  const out = await call(handler('get', '/static-blogs/:id'), req({ params: { id: BLOG_ID } }));
  const block = picker(out.html);

  assert.ok(/not the same numbering|pillar campaign/i.test(block),
    'nothing says what these numbers count');
});

test('A LIVE ARTICLE IS A LINK TO THE LIVE ARTICLE', async () => {
  /* TWO LIVE ARTICLES, DELIBERATELY. With only one, that one is the root
   * and is served at the domain rather than at its slug — so a fixture of
   * one could never show a slug link at all.
   *
   * The first version of this test had exactly that fixture, and passed
   * only because the code was ALSO wrong: it linked the root to its slug.
   * Fixing the code broke the test, which is the test doing its job one
   * step too late. */
  installSlots([
    { publishAt: new Date(Date.now() - 3 * DAY), status: 'ready' },
    { publishAt: new Date(Date.now() - DAY), status: 'ready' },
  ]);

  const out = await call(handler('get', '/static-blogs/:id'), req({ params: { id: BLOG_ID } }));
  const block = picker(out.html);

  /* Slot 0 is the oldest, so it is the root and links to the domain.
   * Slot 1 is an ordinary article and links to its own address. */
  assert.ok(block.includes('"https://blog.example.com/"'),
    'the root article does not link to the domain');
  assert.ok(block.includes('https://blog.example.com/slot-1/'),
    'the live article is not linked to its live page');

  /* A NEW TAB, because leaving this page loses the fold and whatever else
   * was half-filled in on the campaign form below it. */
  const link = block.match(/<a[^>]*slot-1[^>]*>/)[0];
  assert.ok(/target="_blank"/.test(link), `it navigates away: ${link}`);
  assert.ok(/rel="[^"]*noopener/.test(link), `no rel=noopener: ${link}`);
});

test('AND AN ARTICLE THAT IS NOT LIVE YET IS NOT A LINK', async () => {
  /* ITS PAGE DOES NOT EXIST. The article is written and scheduled; the
   * site that was deployed does not contain it. A link would 404, which
   * reads as a broken blog rather than as an article waiting for its
   * day. */
  installPicker();

  const out = await call(handler('get', '/static-blogs/:id'), req({ params: { id: BLOG_ID } }));
  const block = picker(out.html);

  assert.ok(block.includes('Not yet'), 'the scheduled article is missing from the list');
  assert.ok(!block.includes('https://blog.example.com/not-yet/'),
    'it linked to a page that does not exist yet');
});

test('AND THE CURRENT FRONT PAGE LINKS TO THE DOMAIN, NOT TO ITS SLUG', async () => {
  /* The front-page article is served at / and NOT at its own address —
   * two addresses for one article is one article competing with itself.
   * A link to /already-live/ would 404 on the very article being used as
   * the front page. */
  installPicker({ homeSlug: 'already-live' });

  const out = await call(handler('get', '/static-blogs/:id'), req({ params: { id: BLOG_ID } }));
  const block = picker(out.html);

  assert.ok(block.includes('"https://blog.example.com/"'),
    'the front page does not link to the domain root');
  assert.ok(!block.includes('https://blog.example.com/already-live/'),
    'the front page links to an address it is not served at');
});

test('THE ARTICLE SERVING / LINKS TO THE DOMAIN EVEN WITH NOTHING CHOSEN', async () => {
  /* EDWIN FOUND THIS BY CLICKING ARTICLE 1 AND GETTING A 404 — on his own
   * front page.
   *
   * The front-page article is served at the domain and DELIBERATELY NOT at
   * its own slug: two addresses for one article is one article competing
   * with itself. So `/how-ai-legal-research.../` does not exist, and a link
   * to it 404s.
   *
   * The first version only treated an article as the root when `homeSlug`
   * was SET. On the fallback path — nothing chosen, oldest live article
   * serving — every article got a slug link, including the one answering
   * for the domain. Which is the commonest state a new blog is in, and the
   * one every test had set homeSlug to avoid. */
  installPicker();
  db.blogs[0].homeSlug = '';

  const out = await call(handler('get', '/static-blogs/:id'), req({ params: { id: BLOG_ID } }));
  const block = picker(out.html);

  assert.ok(block.includes('"https://blog.example.com/"'),
    'the article serving the domain does not link to it');
  assert.ok(!block.includes('https://blog.example.com/already-live/'),
    'it linked the front page to an address that 404s');
});

test('A BLOG THAT HAS NEVER BEEN PUBLISHED LINKS TO NOTHING', async () => {
  /* Nothing is on the internet yet. Every link would 404, and thirty of
   * them would read as thirty broken articles. */
  installPicker({ neverPublished: true });

  const out = await call(handler('get', '/static-blogs/:id'), req({ params: { id: BLOG_ID } }));
  const block = picker(out.html);

  assert.ok(block.includes('Already live'), 'the articles are missing from the list');
  assert.ok(!/href="https:\/\/blog\.example\.com/.test(block),
    'it linked to a site that has never been deployed');
});

test('CHOOSING ONE IS A BUTTON CARRYING ITS SLUG', async () => {
  /* One click, not pick-then-save. The value rides on the button, so the
   * row you press is the choice you make.
   *
   * A front page IS set here, deliberately. With nothing set, "oldest
   * published article" is already the front page and shows the badge
   * rather than a button — which is right, and which the first draft of
   * this test mistook for the row being missing. */
  installPicker({ homeSlug: 'already-live' });

  const out = await call(handler('get', '/static-blogs/:id'), req({ params: { id: BLOG_ID } }));
  const block = picker(out.html);

  /* A BUTTON FOR EVERY ROW THAT IS NOT ALREADY THE FRONT PAGE... */
  assert.ok(/<button[^>]*name="homeSlug"[^>]*value="not-yet"/.test(block),
    'there is no way to choose that article');
  assert.ok(/<button[^>]*name="homeSlug"[^>]*value=""/.test(block),
    '"oldest published article" can no longer be chosen');

  /* ...AND NONE FOR THE ONE THAT ALREADY IS. A button offering to make
   * the front page the front page is a control that does nothing, sitting
   * in the one row somebody is looking for. It wears a badge instead.
   *
   * THE FIRST TWO DRAFTS OF THIS TEST GOT THAT BACKWARDS, twice — once
   * expecting a button for "oldest" on a blog where oldest WAS the front
   * page, then expecting one for the article it had just made the front
   * page. The code was right both times. */
  assert.ok(!/<button[^>]*value="already-live"/.test(block),
    'the current front page is offered as a choice');
  assert.ok(/badge[^>]*>\s*front page\s*</.test(block),
    'nothing marks which row is the front page');
});

test('AND IT STILL POSTS TO THE SAME PLACE, SO THE PILLAR CHECK STILL RUNS', async () => {
  installPicker();

  const out = await call(handler('post', '/static-blogs/:id/home'),
    req({ params: { id: BLOG_ID }, body: { homeSlug: 'money-one' } }));

  assert.strictEqual(out.status, 400, 'the control changed and took the rule with it');
});

test('WITH NOTHING CHOSEN, THE FOLD NAMES WHAT IS ACTUALLY SERVING THE DOMAIN', async () => {
  /* "Front page: Oldest published article" is true and tells you nothing.
   * It also makes two different states look identical: "I have not chosen"
   * and "I chose the oldest one deliberately".
   *
   * THE ANSWER COMES FROM THE SLOTS, NOT THE PICKER. homeOf() falls back
   * to the oldest live article across EVERY campaign, pillar or not — and
   * the page only loads pillar articles now. So the oldest live slot is
   * worked out from the campaigns already in hand, and that one post is
   * fetched by campaign and slot. */
  installPicker();
  db.blogs[0].homeSlug = '';

  const out = await call(handler('get', '/static-blogs/:id'), req({ params: { id: BLOG_ID } }));
  const block = picker(out.html);

  const line = frontLine(out.html);

  assert.ok(/Oldest published article/.test(line), 'it no longer says the choice is the oldest');
  assert.ok(line.includes('Already live'),
    'it does not name the article actually answering for the domain');
});

test('AND IT ASKS FOR THE OLDEST LIVE SLOT, NOT WHATEVER IS FIRST', async () => {
  /* THE ASSERTION ON WHAT WENT TO THE DATABASE. Naming the wrong article
   * is worse than naming none: it is a confident answer to "what is my
   * front page" that happens to be false. */
  installPicker();
  db.blogs[0].homeSlug = '';

  await call(handler('get', '/static-blogs/:id'), req({ params: { id: BLOG_ID } }));

  assert.ok(db.postFindOneWhere, 'it never asked which article is serving');
  assert.strictEqual(String(db.postFindOneWhere.campaign), 'c-pillar');
  assert.strictEqual(db.postFindOneWhere.slotIndex, 0,
    'it asked for a slot that is not the oldest live one');
});

test('A SCHEDULED SLOT IS NOT THE ONE SERVING THE DOMAIN', async () => {
  /* A slot dated next month has no page on the site yet. Naming it as the
   * front page would be describing the site somebody will have rather than
   * the site they have. */
  install({
    campaigns: [{
      _id: 'c-pillar', name: 'Main pillar', status: 'active', isPillar: true,
      slots: [
        { index: 0, publishAt: new Date(Date.now() + DAY), status: 'ready' },
        { index: 1, publishAt: new Date(Date.now() - DAY), status: 'ready' },
      ],
    }],
    articles: [
      { _id: '507f1f77bcf86cd799439051', title: 'Future one', slug: 'future-one', campaign: 'c-pillar', slotIndex: 0 },
      { _id: '507f1f77bcf86cd799439052', title: 'Past one', slug: 'past-one', campaign: 'c-pillar', slotIndex: 1 },
    ],
  });
  db.blogs[0].siteUrl = 'blog.example.com';
  db.blogs[0].lastDeployAt = new Date(Date.now() - DAY);
  db.blogs[0].homeSlug = '';

  await call(handler('get', '/static-blogs/:id'), req({ params: { id: BLOG_ID } }));

  assert.strictEqual(db.postFindOneWhere.slotIndex, 1,
    'it named an article that is not on the site yet');
});

/** A blog with the given pillar slots, one article per slot. */
function installSlots(slots) {
  install({
    campaigns: [{
      _id: 'c-pillar', name: 'Main pillar', status: 'active', isPillar: true,
      slots: slots.map((sl, i) => ({ index: i, ...sl })),
    }],
    articles: slots.map((sl, i) => ({
      _id: `507f1f77bcf86cd79943906${i}`,
      title: `Slot ${i}`,
      slug: `slot-${i}`,
      campaign: 'c-pillar',
      slotIndex: i,
    })),
  });

  db.blogs[0].siteUrl = 'blog.example.com';
  db.blogs[0].lastDeployAt = new Date(Date.now() - DAY);
  db.blogs[0].homeSlug = '';
}

test('WITH EVERY ARTICLE STILL SCHEDULED, NOTHING IS NAMED', async () => {
  /* MUTATION ADDED THIS. Dropping the `at > now` filter survived every
   * test above, because a future slot can only WIN the oldest-first sort
   * when every slot is future — and no fixture had that shape.
   *
   * It is a real state: a blog deployed on the day it was set up, with
   * everything dated ahead. The site exists and has nothing on it, and
   * naming an article that is not there yet describes the site somebody
   * will have rather than the site they have. */
  installSlots([
    { publishAt: new Date(Date.now() + DAY), status: 'ready' },
    { publishAt: new Date(Date.now() + 2 * DAY), status: 'ready' },
  ]);

  const out = await call(handler('get', '/static-blogs/:id'), req({ params: { id: BLOG_ID } }));

  assert.ok(!/currently/i.test(frontLine(out.html)),
    'it named an article that is not on the site yet');
});

test('AND THE OLDEST OF TWO LIVE SLOTS WINS, WHATEVER ORDER THEY ARE STORED IN', async () => {
  /* MUTATION ADDED THIS TOO. Removing the sort survived, because every
   * fixture happened to store its slots in date order — so "first in the
   * array" and "oldest" were the same article and nothing could tell a
   * sorted list from an unsorted one.
   *
   * The root is the OLDEST live article, deliberately: newest-first would
   * move `/` every time something published, and every old link to the
   * root would then point at a different article. */
  installSlots([
    { publishAt: new Date(Date.now() - DAY), status: 'ready' },
    { publishAt: new Date(Date.now() - 3 * DAY), status: 'ready' },
  ]);

  await call(handler('get', '/static-blogs/:id'), req({ params: { id: BLOG_ID } }));

  assert.strictEqual(db.postFindOneWhere.slotIndex, 1,
    'it named the first slot in the array rather than the oldest one');
});

test('AND A FAILED SLOT IS NOT SERVING ANYTHING, HOWEVER OLD IT IS', async () => {
  /* MUTATION ADDED THIS. A failed slot never produced a page, so it is
   * not on the site — but it is still the oldest by date, and dropping
   * the status check made it the answer. */
  installSlots([
    { publishAt: new Date(Date.now() - 3 * DAY), status: 'failed' },
    { publishAt: new Date(Date.now() - DAY), status: 'ready' },
  ]);

  await call(handler('get', '/static-blogs/:id'), req({ params: { id: BLOG_ID } }));

  assert.strictEqual(db.postFindOneWhere.slotIndex, 1,
    'it named an article whose slot failed and never produced a page');
});

test('A CHOSEN ARTICLE THAT IS NOT LIVE SAYS WHAT IS STANDING IN', async () => {
  /* THE STATE THAT LOOKS FINE AND IS NOT. You pick article twenty, it is
   * scheduled for next month, and the root serves something else until
   * then. The page used to show your choice and nothing else — a true
   * statement about the setting and a false one about the site. */
  installPicker({ homeSlug: 'not-yet' });

  const out = await call(handler('get', '/static-blogs/:id'), req({ params: { id: BLOG_ID } }));
  const block = picker(out.html);

  const line = frontLine(out.html);

  assert.ok(line.includes('Not yet'), 'it does not say what was chosen');
  assert.ok(/not live yet/i.test(line), 'it does not say the choice is not live');
  assert.ok(line.includes('Already live'),
    'it does not name what is serving the domain in the meantime');

  /* AND THE STAND-IN LINKS TO THE DOMAIN, because the stand-in IS the root
   * while the choice waits for its day.
   *
   * MUTATION ADDED THIS. Dropping the liveness check — `chosen` instead of
   * `chosen && liveOf(chosen)` — made the not-yet-live choice the root, so
   * the article actually answering for the domain got a slug link that
   * 404s. The choice itself is not linked either way, being unpublished,
   * so nothing else could see the difference. */
  const fold = picker(out.html);

  assert.ok(fold.includes('"https://blog.example.com/"'),
    'the article standing in as the root does not link to the domain');
  assert.ok(!fold.includes('https://blog.example.com/already-live/'),
    'it linked the root to an address that 404s');
});

test('A BLOG THAT HAS NEVER BEEN PUBLISHED NAMES NOTHING', async () => {
  /* Nothing is serving anything. A name here would be an answer to a
   * question that has none. */
  installPicker({ neverPublished: true });
  db.blogs[0].homeSlug = '';

  const out = await call(handler('get', '/static-blogs/:id'), req({ params: { id: BLOG_ID } }));
  const block = picker(out.html);

  const line = frontLine(out.html);

  assert.ok(/Oldest published article/.test(line));
  assert.ok(!/currently/i.test(line), 'it named a front page on a site that does not exist');
});

test('AND SAVING A NON-PILLAR ARTICLE IS REFUSED', async () => {
  /* THE ENFORCEMENT. The picker is a <select>, so in a browser the value
   * is always one of the options — which is exactly why the handler cannot
   * trust it. A POST is a POST. */
  installPillar();

  const out = await call(handler('post', '/static-blogs/:id/home'),
    req({ params: { id: BLOG_ID }, body: { homeSlug: 'money-one' } }));

  assert.strictEqual(out.status, 400);
  assert.ok(!db.siteUpdates.some(u => u.update && u.update.$set && 'homeSlug' in u.update.$set),
    'a non-pillar article was stored as the front page');
});

test('AND SAVING A PILLAR ONE IS ACCEPTED', async () => {
  installPillar();

  const out = await call(handler('post', '/static-blogs/:id/home'),
    req({ params: { id: BLOG_ID }, body: { homeSlug: 'pillar-two' } }));

  assert.ok(out.redirected, `it refused a pillar article: ${out.status}`);
  assert.ok(db.siteUpdates.some(u => u.update.$set.homeSlug === 'pillar-two'),
    'the choice was not stored');
});

test('AND "OLDEST PUBLISHED ARTICLE" IS STILL A CHOICE', async () => {
  /* Empty means "whichever is oldest", which is also what an unset blog
   * does. Tightening the validation must not make clearing it impossible. */
  installPillar();

  const out = await call(handler('post', '/static-blogs/:id/home'),
    req({ params: { id: BLOG_ID }, body: { homeSlug: '' } }));

  assert.ok(out.redirected, 'it refused to clear the front page');
  assert.ok(db.siteUpdates.some(u => '' === u.update.$set.homeSlug));
});

test('a blog with no name or no domain is refused', async () => {
  install({ blogs: [] });

  assert.strictEqual((await call(handler('post', '/static-blogs'), req({ body: { name: '', prefix: 'blog', domain: 'explr-home.com' } }))).status, 400);
  assert.strictEqual((await call(handler('post', '/static-blogs'), req({ body: { name: 'X', prefix: '', domain: 'explr-home.com' } }))).status, 400);
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

  assert.strictEqual(out.status, 200, `planning failed: ${(/<h1[^>]*>([^<]+)/.exec(out.html)||[])[1]}`);
  assert.ok(out.html.includes('Signs your water heater is failing'), 'the first topic is missing');
  assert.ok(out.html.includes('water heater repair cost'), 'the pipe-separated search phrase was dropped');
  assert.ok(!/<td>\s*<\/td>/.test(out.html), 'a blank line became a topic');
});

section('LOADING A CSV OF TOPICS');

test('THE FORM OFFERS A FILE, AND THE FILE IS NEVER UPLOADED', async () => {
  /* WHY THE FILE IS READ IN THE BROWSER. csrfProtect runs app-wide BEFORE
   * any route and reads its token out of req.body, which for
   * multipart/form-data nothing has parsed yet — so a plain upload form
   * with a hidden _csrf is refused outright. Making one work means posting
   * by script with a header, a multer instance with its own limits, and a
   * local error handler because server.js answers every multipart request
   * with JSON. All of that to put text into a textarea.
   *
   * THE TEST THAT MATTERS IS THE NEGATIVE ONE. A file input is harmless;
   * a form that has quietly become multipart is a form that stops
   * working. */
  install();

  const out = await call(handler('get', '/static-blogs/:id'));

  assert.ok(/<input[^>]+type="file"/.test(out.html), 'there is no way to choose a CSV');
  assert.ok(!/enctype\s*=\s*["']multipart/i.test(out.html),
    'the campaign form became multipart, which csrfProtect refuses');
  assert.ok(!/name="topics_csv"/.test(out.html),
    'the file input is named as if it were posted');
});

test('AND THE PAGE CARRIES THE PARSER THAT IS ACTUALLY TESTED', async () => {
  /* THE WHOLE ARRANGEMENT IN ONE ASSERTION. csvTopics.js emits its own
   * source into the page rather than the page keeping a hand-written copy,
   * so there is one parser and test-csv-topics.js tests it. Drop the
   * emission and the button still renders, the file still opens, and
   * nothing happens — which is why this is asserted here and not left to
   * the sight of a button. */
  install();

  const out = await call(handler('get', '/static-blogs/:id'));
  const { browserSource } = require('./utils/blog/csvTopics');

  assert.ok(out.html.includes(browserSource()),
    'the page does not carry the parser, so choosing a file would do nothing');
});

test('and the topics box is what the loaded lines are written into', async () => {
  /* The lines land where a typed list lands, so everything downstream —
   * Plan, Suggest, Clear — is unchanged and there is nothing new to keep
   * in step. */
  install();

  const out = await call(handler('get', '/static-blogs/:id'));

  assert.ok(/getElementById\('topics'\)/.test(out.html) || /getElementById\("topics"\)/.test(out.html),
    'the loader does not write into the topics box');
});

test('AND WHAT REACHES THE BROWSER IS VALID JAVASCRIPT', async () => {
  /* THE TRAP THIS EXISTS FOR, AND IT IS A QUIET ONE. The loader is written
   * inside a template literal, where an unrecognised escape becomes the
   * letter after it: a hand-written /\s+$/ arrives as /s+$/ and a '\n' as
   * a real line break in the middle of a string. The first is a regex that
   * silently matches the wrong thing; the second is a syntax error that
   * kills every script on the page.
   *
   * Nothing else here would notice. The button renders, the file opens,
   * and nothing happens — on a screen whose other buttons still work. So
   * the rendered script is parsed, which is the only check that can see
   * it. new Function parses without running, which is what we want: the
   * body reaches for document and FileReader and neither exists here. */
  install();

  const out = await call(handler('get', '/static-blogs/:id'));

  /* EACH BLOCK CUT AT ITS OWN CLOSING TAG BEFORE ANYTHING IS SEARCHED.
   *
   * THIS TEST WAS GREEN FOR THE WRONG REASON FIRST, and mutation is what
   * said so: a backslash hand-written into the loader survived a suite
   * that claimed to parse it. The reason is that "topicsCsv" appears on
   * the page TWICE — once as the file input's id, in the markup, and once
   * in the script. Splitting on <script> and taking the first chunk
   * containing the word landed on an EARLIER script's body, which parsed
   * perfectly well and proved nothing about the loader.
   *
   * So each block is searched for something only the loader's body has.
   *
   * SPLIT ON THE CLOSING TAG, THEN TAKE THE FIRST OPENING ONE, and that is
   * how HTML actually works rather than a preference.
   *
   * Only </script> ends a script. The text "<script>" inside one is
   * ordinary content — and the route's comments contain it twice, in the
   * suggestions block and in the loader, both explaining why a script's
   * POSITION should not matter. Splitting on the opening tag cut the loader
   * in half; reaching for the LAST opening tag in a chunk then landed on
   * one of those comments and cut it again. Each chunk holds exactly one
   * real script, and its opening tag is the first one in that chunk. */
  const script = out.html
    .split('</script>')
    .filter(chunk => chunk.includes('<script>'))
    .map(chunk => chunk.slice(chunk.indexOf('<script>') + '<script>'.length))
    .find(block => block.includes('topicsCsv') && block.includes('FileReader'));

  assert.ok(script, 'the loader script is not on the page at all');

  assert.doesNotThrow(() => new Function(script),
    'the rendered loader is not valid JavaScript');

  /* AND NOT A STRAY BACKSLASH IN IT. Valid JavaScript is not the same as
   * CORRECT JavaScript: /s+$/ parses perfectly well. The loader is written
   * with String.fromCharCode and trimEnd precisely so that no backslash
   * needs to survive the template literal — and the parser inlined above
   * it is emitted from source, where its own escapes are safe. This is the
   * line that notices somebody adding one by hand. */
  const handWritten = script.slice(script.indexOf('var NL'));
  assert.ok(!handWritten.includes('\\'),
    'a backslash was hand-written into a template literal, where it does not survive');
});

test('AND CLEAR TOPICS IS BOUND IN IT, NOT BY AN onclick', async () => {
  /* IT WAS AN onclick ATTRIBUTE AND IT NEVER RAN. The app's CSP sets
   * script-src-attr to 'none', so the browser refused it outright: the
   * button was pressed, the box kept its contents, and nothing anywhere
   * said why. Edwin found it by pressing it.
   *
   * BOTH HALVES ARE ASSERTED, because mutation showed that neither alone
   * is enough — deleting the id, or the listener that uses it, left every
   * other test in this file green. */
  install();

  const out = await call(handler('get', '/static-blogs/:id'));

  assert.ok(out.html.includes('id="ieClearTopics"'),
    'the Clear topics button has no id, so nothing can bind it');

  const script = out.html
    .split('</script>')
    .filter(chunk => chunk.includes('<script>'))
    .map(chunk => chunk.slice(chunk.indexOf('<script>') + '<script>'.length))
    .find(block => block.includes('topicsCsv') && block.includes('FileReader'));

  assert.ok(script, 'the loader script is not on the page');

  /* THE SCRIPT IS RUN, NOT PATTERN-MATCHED.
   *
   * Asserting that the text contains "ieClearTopics" and "addEventListener"
   * passed a script in which the button was never bound — both words appear
   * elsewhere in it. Mutation said so. And a pattern test is the wrong
   * instrument anyway: what failed in production was not a missing word, it
   * was a handler that existed and did not run.
   *
   * So the rendered source is executed against a fake document, the button
   * is clicked, and the box is checked. No browser, no network, and it
   * fails for the reason it is named after. */
  const nodes = {};
  const el = (id) => (nodes[id] = {
    id, value: '', textContent: '', files: null, listeners: {},
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    focus() { this.focused = true; },
    click() { for (const fn of this.listeners.click || []) fn.call(this, {}); },
  });

  el('topics');
  el('topicsCsv');
  el('topicsCsvNote');
  el('ieClearTopics');

  const fakeDocument = {
    readyState: 'complete',
    getElementById: (id) => nodes[id] || null,
    addEventListener() {},
  };

  new Function('document', 'FileReader', script)(fakeDocument, function FileReader() {});

  nodes.topics.value = 'Something I typed\nAnd another line';
  nodes.topicsCsvNote.textContent = '2 topics added from topics.csv';

  nodes.ieClearTopics.click();

  assert.strictEqual(nodes.topics.value, '', 'pressing Clear topics did not empty the box');
  assert.strictEqual(nodes.topicsCsvNote.textContent, '',
    'the box was emptied but it still says topics were added from a file');
  assert.strictEqual(nodes.topics.focused, true, 'the cursor was not put back in the box');

  /* THE ATTRIBUTE, NOT THE WORD — and that distinction has now caught this
   * session out four times. The comments explaining why the handler was
   * moved contain "onclick", and HTML comments ship to the browser, so a
   * ban on the word fails on the prose that documents the fix. The source
   * scan in test-inline-handlers.js uses this same shape. */
  assert.ok(!/\son[a-z]+\s*=\s*["']/i.test(out.html),
    'an inline handler attribute is back on this page, and the CSP will refuse it');
});

test('A CSV THAT IS LOADED IS ADDED, NOT SUBSTITUTED FOR WHAT IS THERE', async () => {
  /* The same rule Suggest topics follows: it ADDS to the list. A loader
   * that replaced the box would silently destroy a list somebody had
   * typed, and Clear already exists for people who want it gone. */
  install();

  const out = await call(handler('get', '/static-blogs/:id'));

  assert.ok(!/\.value\s*=\s*lines\.join/.test(out.html),
    'the loader overwrites the box instead of adding to it');
});

test('A THIRD FIELD AFTER A SECOND PIPE IS THE LINK PHRASE', async () => {
  /* WHAT THE CSV LOADER WRITES, and the reason the box grew a third field
   * at all. The plugin's CSV has carried three columns since it was
   * written — topic, search phrase, link phrase — and until now this
   * screen could only read two, so loading a file threw the third away.
   *
   * It stays optional. A typed line with one pipe, or none, behaves
   * exactly as it did: linkPlan falls back to the keyword, which is what
   * it was changed to do on 19 October. */
  install();

  const out = await call(handler('post', '/static-blogs/:id/plan'), req({
    body: {
      targetUrl: 'https://example.com/water-heater-repair/',
      targetKeyword: 'water heater repair leander',
      topics: 'What a repair costs | water heater repair cost | what a repair costs',
      startDate: '2026-11-03', gapDays: '7', hour: '9',
    },
  }));

  assert.strictEqual(out.status, 200, (/<h1[^>]*>([^<]+)/.exec(out.html)||[])[1]);

  /* ASSERTED ON THE SLOT THAT WAS SAVED, NOT ON THE PAGE. The plan screen
   * shows the topic, the search phrase and the date; the link phrase is
   * not one of its columns, and createCampaign's response projection drops
   * it before the page ever sees it. That projection is shared with the
   * plugin's /api/blog/plan, so widening it to make an assertion easier
   * would change an API for the sake of a test. What matters is that the
   * campaign carries the phrase, and the campaign is right here. */
  assert.strictEqual(db.created_campaign.slots[0].linkPhrase, 'what a repair costs',
    'the link phrase after the second pipe was thrown away');
});

test('and a pipe with nothing after it leaves the link phrase unset', async () => {
  /* A trailing separator is a typing accident, not an instruction to use
   * an empty anchor. An empty linkPhrase that reached the planner would
   * render a link with no words in it. */
  install();

  const out = await call(handler('post', '/static-blogs/:id/plan'), req({
    body: {
      targetUrl: 'https://example.com/water-heater-repair/',
      targetKeyword: 'water heater repair leander',
      topics: 'What a repair costs | water heater repair cost |\nHow long a tank lasts',
      startDate: '2026-11-03', gapDays: '7', hour: '9',
    },
  }));

  assert.strictEqual(out.status, 200, (/<h1[^>]*>([^<]+)/.exec(out.html)||[])[1]);
  assert.ok(out.html.includes('water heater repair cost'), 'the search phrase was lost');
  assert.strictEqual(db.created_campaign.slots[0].linkPhrase, '',
    'a trailing pipe was stored as a phrase somebody chose');
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

  assert.strictEqual(out.status, 200, (/<h1[^>]*>([^<]+)/.exec(out.html)||[])[1]);
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
    body: { name: 'Cedar Park Appliance', prefix: 'blog', domain: 'explr-home.com',
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
    body: { name: 'X', prefix: 'blog', domain: 'explr-home.com', timezone: 'Mars/Olympus_Mons' },
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

/**
 * The row numbers on a rendered page, in document order.
 *
 * THREE TESTS BELOW MATCHED `<td class="text-end text-white-50">` EXACTLY,
 * and all three broke on 21 October when those two utility classes were
 * replaced by the shared `.rownum` — a pure rename that changed nothing a
 * reader could see. The tests were right about what they wanted and wrong
 * about how they asked: an exact class attribute is a copy of a styling
 * decision, so every restyle reads as a regression.
 *
 * This matches the ROLE instead, and tolerates other classes beside it.
 */
function rowNumbersIn(html) {
  return [...html.matchAll(
    /<td[^>]*class="[^"]*\brownum\b[^"]*"[^>]*>\s*(\d+)\s*<\/td>/g)].map(m => m[1]);
}

test('AND IT NUMBERS THEM, BECAUSE THIRTY-SEVEN ROWS CANNOT BE COUNTED BY EYE', async () => {
  /* Edwin published 37 articles and the page listed them unnumbered — so
   * "how many went up" and "which one is the twentieth" both meant
   * counting down a screen. The plan table has numbered its slots since it
   * was written; this one and the Articles list had not caught up.
   *
   * THE NUMBERS ARE THE ROW'S POSITION, not the slot index. This list is
   * what was deployed in the order it was deployed, and a campaign's slot
   * numbers would be three different sequences interleaved. */
  install();
  stubPublish(PUBLISHED);

  const out = await call(handler('post', '/static-blogs/:id/publish'), req({ body: { mode: 'publish' } }));

  const numbers = rowNumbersIn(out.html);

  assert.deepStrictEqual(numbers, ['1', '2'], 'the published articles are not numbered from one');
});

test('and the numbering counts rows even when the first article is the front page', async () => {
  /* The front page is an article like any other and holds position one.
   * Numbering that skipped it, or restarted after it, would make every
   * later number disagree with the row it sits beside. */
  install();
  stubPublish({ ...PUBLISHED, pages: [
    { isHome: true, url: 'https://leanderwaterheaters.com/', post: { slug: 'a', title: 'A' } },
    { isHome: false, url: 'https://leanderwaterheaters.com/b/', post: { slug: 'b', title: 'B' } },
    { isHome: false, url: 'https://leanderwaterheaters.com/c/', post: { slug: 'c', title: 'C' } },
  ] });

  const out = await call(handler('post', '/static-blogs/:id/publish'), req({ body: { mode: 'publish' } }));

  const numbers = rowNumbersIn(out.html);

  assert.deepStrictEqual(numbers, ['1', '2', '3'], 'the front page broke the sequence');
});

test('AND THE ARTICLES LIST IS NUMBERED TOO', async () => {
  /* The same list, in the other place it is read. Numbering one and not
   * the other is worse than numbering neither: the two disagree about what
   * "the fourth article" means.
   *
   * Pointed at /articles on 21 October, where the list now lives. */
  install();

  const out = await call(handler('get', '/static-blogs/:id/articles'));

  const numbers = rowNumbersIn(out.html);

  assert.deepStrictEqual(numbers, ['1', '2'], 'the Articles list is not numbered from one');
  assert.ok(out.html.includes('First one'), 'the articles themselves went missing');
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

  /* AND IT DOES NOT TELL HIM TO WAIT. This failure is not the retryable
   * one, and "try again in a few minutes" offered here would be advice to
   * sit out a problem that never mends itself. The sentence has to be
   * absent by default, not present by default — see the two tests
   * below. */
  assert.ok(!/try publishing again/i.test(out.html),
    'an ordinary deploy failure was told to wait a few minutes');
});

test('A PROJECT THAT COULD NOT BE CREATED IS TOLD TO TRY AGAIN', async () => {
  /* 19 October. A 10-article campaign died on Cloudflare's `[code:
   * 8000000]` — an "unknown error" with no detail — and the screen showed
   * two raw wrangler errors, the second of them only a consequence of the
   * first. There was no way to tell from the page whether to wait, fix a
   * token, or call Cloudflare. Hours later the identical publish worked
   * with nothing changed: waiting was the entire fix.
   *
   * THE SENTENCE IS THE FEATURE, so the test is on the sentence. What it
   * must say is that nothing was lost — which is true, because
   * markPublished only runs on a success and nothing is redated on a
   * failure — and that a retry is worth making. */
  install();
  stubPublish({
    ok: false,
    error: 'The deploy to Cloudflare did not finish.',
    output: 'An unknown error occurred [code: 8000000]\nThe Pages project does not exist.',
    projectMissing: true,
    pages: [], missing: [], files: 0,
  });

  const out = await call(handler('post', '/static-blogs/:id/publish'), req({ body: { mode: 'publish' } }));
  const flat = out.html.replace(/\s+/g, ' ');

  assert.strictEqual(out.status, 400);
  assert.ok(/nothing was lost/i.test(flat), 'it does not say the articles survived');
  assert.ok(/still written and still scheduled/i.test(flat),
    'it does not say what state the articles are in');
  assert.ok(/try publishing again in a few minutes/i.test(flat),
    'it does not say what to do, which is the whole point of the sentence');

  /* THE RAW OUTPUT STAYS. The sentence is a hint, not a replacement for
   * what Cloudflare said — and on the night this happened the codes were
   * the only thing worth having. */
  assert.ok(out.html.includes('8000000'), "Cloudflare's own reason was hidden behind the hint");
  assert.deepStrictEqual(db.siteUpdates, [], 'a failed deploy was recorded as a success');
});

test('AND A PREVIEW NEVER CARRIES IT, BECAUSE NOTHING WAS DEPLOYED', async () => {
  /* A dry run does not reach Cloudflare, so it has no project to fail to
   * create. If this sentence ever shows up on a preview, the flag is being
   * read from somewhere it cannot have come from. */
  install();
  stubPublish({
    ok: false,
    error: 'Nothing is due to be published yet.',
    projectMissing: true,
    pages: [], missing: [], files: 0,
  });

  const out = await call(handler('post', '/static-blogs/:id/publish'), req({ body: { mode: 'preview' } }));

  assert.ok(!/try publishing again/i.test(out.html),
    'a preview that deployed nothing blamed Cloudflare for a project');
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

test('THERE IS A WAY TO EACH ARTICLE\'S EDITOR, NOW ONE SCREEN FURTHER OUT', async () => {
  /* An editor nothing links to is an editor nobody finds. Before a list
   * existed the only thing naming an article was the front-page dropdown,
   * which selects one and opens nothing.
   *
   * THE CLAIM IS UNCHANGED; THE SCREEN MOVED — 21 October. This asserted
   * against the blog page, where the list used to be. The list is on
   * /articles now, so the same assertion belongs there: a test that
   * follows a feature is honest, a test deleted because it went red is
   * not. */
  install();
  const out = await call(handler('get', '/static-blogs/:id/articles'));

  /* The fixture titles have no characters that escaping would change, so
   * a plain includes() is honest here — and asserting on the raw title
   * is what a reader of this test expects to see. */
  for (const a of db.articles) {
    assert.ok(out.html.includes(a.title), `${a.title} is not listed`);
    assert.ok(out.html.includes(`/articles/${a._id}/edit`),
      `${a.title} has no edit link`);
  }

  /* AND THE BLOG PAGE STILL REACHES IT. The chain is what matters: the
   * blog page is where somebody starts, so breaking its link to /articles
   * strands every editor again, one level further back than before. */
  const blogPage = await call(handler('get', '/static-blogs/:id'));
  assert.ok(new RegExp(`href="/static-blogs/${BLOG_ID}/articles"`).test(blogPage.html),
    'the blog page no longer reaches the articles screen');
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
  installPillarDefaults();
  db.blogs[0].homeSlug = 'second-one';

  const out = await call(handler('get', '/static-blogs/:id'));

  assert.ok(out.html.includes('name="homeSlug"'), 'there is no way to choose a front page');

  const block = picker(out.html);

  assert.ok(block.includes('First one'), 'the articles are not listed');

  /* THE CURRENT CHOICE IS NAMED, NOT MARKED WITH `selected` — 23 October,
   * when the dropdown became a list you can read and click.
   *
   * It used to read `<option value="..." selected>`. Before THAT it read
   * the first selected option ANYWHERE on the page, which passed for
   * months and broke the day a timezone dropdown was added above it. Both
   * versions were asking about the shape of the control rather than about
   * the front page.
   *
   * What the page has to say is: which article answers for the domain.
   * The fold says it in words, above the list. */
  assert.ok(/Front page:\s*<strong>\s*Second one\s*<\/strong>/.test(block),
    'the page does not say which article is the front page');

  assert.ok(!/<strong>\s*First one\s*<\/strong>/.test(block),
    'the wrong article is shown as the front page');
});

test('and it is scoped to this blog', async () => {
  installPillarDefaults();
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
  installPillarDefaults();

  const out = await call(handler('post', '/static-blogs/:id/home'),
    req({ body: { homeSlug: 'second-one' } }));

  assert.strictEqual(out.redirected, `/static-blogs/${BLOG_ID}`);
  assert.strictEqual(db.siteUpdates.length, 1, 'nothing was saved');
  assert.deepStrictEqual(db.siteUpdates[0].update, { $set: { homeSlug: 'second-one' } });
  assert.strictEqual(String(db.siteUpdates[0].where._id), BLOG_ID);
});

test('and empty is a real choice, meaning whichever is oldest', async () => {
  installPillarDefaults();
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
  installPillarDefaults();

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

section('THE TABLES LOOK LIKE THE REST OF THE APP, AND THEIR ROWS ARE NUMBERED');

/** Every <table> tag in a rendered page. */
function tablesIn(html) {
  return html.match(/<table[^>]*>/g) || [];
}

test('NO TABLE ON THESE SCREENS IS STILL BOOTSTRAP table-dark', async () => {
  /* table-dark paints #212529 — a near-black picked for a white page. On
   * this app's #082d5b it is a black box sitting ON the navy instead of
   * being part of it, and Static Blogs was the last screen wearing it. The
   * blog report and keyword research already use the transparent palette;
   * .table-navy in appHeaderAssets() is now the one copy of it.
   *
   * BOTH SCREENS, because they are one screen to a reader and half-done
   * looks worse than not started. */
  install();

  for (const [name, out] of [
    ['the blog list', await call(handler('get', '/static-blogs'))],
    ['a blog page',   await call(handler('get', '/static-blogs/:id'))],
  ]) {
    for (const tag of tablesIn(out.html)) {
      assert.ok(!/\btable-dark\b/.test(tag),
        `${name} still has a table-dark table: ${tag}`);
    }
  }
});

test('AND THEY CARRY table-navy, SO THEY ARE STYLED AT ALL', async () => {
  /* THE OTHER HALF, AND WITHOUT IT THE TEST ABOVE IS A TRAP. Deleting
   * table-dark and putting nothing in its place passes it perfectly, and
   * leaves a white-on-navy Bootstrap default table — unreadable, and
   * arguably worse than the black box. */
  install({ campaigns: [{ _id: '507f1f77bcf86cd799439051', site: BLOG_ID, user: USER_ID,
                          name: 'A campaign', status: 'draft', slots: [{ index: 0 }] }] });

  /* THE BLOG PAGE NEEDS A CAMPAIGN TO HAVE A TABLE AT ALL — and that is the
   * correction this test needed on 21 October, not a weakening of it. With
   * the article list moved out, a blog with no campaigns renders no table,
   * and "rendered no table at all" fired on a page that was right.
   *
   * The fixture now guarantees one, so the assertion stays strict: a screen
   * with nothing to style is not evidence that styling works. */
  for (const [name, out] of [
    ['the blog list',     await call(handler('get', '/static-blogs'))],
    ['a blog page',       await call(handler('get', '/static-blogs/:id'))],
    ['the articles page', await call(handler('get', '/static-blogs/:id/articles'))],
  ]) {
    const tables = tablesIn(out.html);
    assert.ok(tables.length, `${name} rendered no table at all`);

    for (const tag of tables) {
      assert.ok(/\btable-navy\b/.test(tag),
        `${name} has an unstyled table: ${tag}`);
    }
  }
});

test('THE BLOG LIST NUMBERS ITS BLOGS', async () => {
  /* Asked for by Edwin on 20 October, with the campaigns below. A list you
   * refer to out loud needs a handle — "the fourth one" has to mean
   * something, and it cannot while the rows are only named. */
  install({
    blogs: [
      { _id: BLOG_ID, user: USER_ID, target: 'cloudflare', status: 'active',
        siteUrl: 'leanderwaterheaters.com', business: { name: 'Leander Water Heaters' } },
      { _id: '507f1f77bcf86cd799439044', user: USER_ID, target: 'cloudflare', status: 'active',
        siteUrl: 'allaboutconcrete.example', business: { name: 'All About Concrete' } },
      { _id: '507f1f77bcf86cd799439045', user: USER_ID, target: 'cloudflare', status: 'active',
        siteUrl: 'allaboutroofing.example', business: { name: 'All About Roofing' } },
    ],
  });

  const out = await call(handler('get', '/static-blogs'));

  /* THE NUMBER AGAINST ITS OWN ROW, not "a 1, a 2 and a 3 appear somewhere".
   * Credit balances, post counts and years are all digits, and a test that
   * only counts them passes on a page that numbers nothing. */
  for (const [n, name] of [[1, 'Leander Water Heaters'],
                           [2, 'All About Concrete'],
                           [3, 'All About Roofing']]) {
    const row = new RegExp(
      `<td[^>]*class="[^"]*\\brownum\\b[^"]*"[^>]*>\\s*${n}\\s*</td>[\\s\\S]{0,400}?${name}`);
    assert.ok(row.test(out.html), `blog ${n} (${name}) is not numbered ${n}`);
  }
});

test('AND THE NUMBERS FOLLOW THE ORDER ON SCREEN, THEY ARE NOT THE IDS', async () => {
  /* The obvious wrong fix is to print something the row already has. The
   * list is sorted newest-first, so the number has to come from the
   * position in THAT order — not from the blog, which knows nothing about
   * where it landed. */
  install({
    blogs: [
      { _id: BLOG_ID, user: USER_ID, target: 'cloudflare', status: 'active',
        siteUrl: 'b.example', business: { name: 'Second Alphabetically' } },
      { _id: '507f1f77bcf86cd799439044', user: USER_ID, target: 'cloudflare', status: 'active',
        siteUrl: 'a.example', business: { name: 'First Alphabetically' } },
    ],
  });

  const out = await call(handler('get', '/static-blogs'));
  const numbers = [...out.html.matchAll(
    /<td[^>]*class="[^"]*\brownum\b[^"]*"[^>]*>\s*(\d+)\s*<\/td>/g)].map(m => m[1]);

  assert.deepStrictEqual(numbers, ['1', '2'],
    `the blog list numbered its rows ${numbers.join(', ')}`);
});

test('THE CAMPAIGNS ON A BLOG ARE NUMBERED TOO', async () => {
  install({
    campaigns: [
      { _id: '507f1f77bcf86cd799439051', site: BLOG_ID, user: USER_ID,
        name: 'Autumn water heaters', status: 'draft', slots: [{ index: 0 }] },
      { _id: '507f1f77bcf86cd799439052', site: BLOG_ID, user: USER_ID,
        name: 'Hydro jetting', status: 'draft', slots: [{ index: 0 }, { index: 1 }] },
    ],
  });

  const out = await call(handler('get', '/static-blogs/:id'));

  for (const [n, name] of [[1, 'Autumn water heaters'], [2, 'Hydro jetting']]) {
    const row = new RegExp(
      `<td[^>]*class="[^"]*\\brownum\\b[^"]*"[^>]*>\\s*${n}\\s*</td>[\\s\\S]{0,400}?${name}`);
    assert.ok(row.test(out.html), `campaign ${n} (${name}) is not numbered ${n}`);
  }
});

test('A HEADER CELL IS ADDED FOR THE NUMBER COLUMN', async () => {
  /* A <td> more than there are <th> shifts every heading one column left,
   * so "Domain" ends up over the blog names. It renders without complaint
   * and reads as nonsense, which is exactly the kind of thing nobody
   * notices in a screenshot. */
  install();

  for (const [name, out] of [
    ['the blog list', await call(handler('get', '/static-blogs'))],
    ['a blog page',   await call(handler('get', '/static-blogs/:id'))],
  ]) {
    for (const table of out.html.match(/<table[\s\S]*?<\/table>/g) || []) {
      const head = /<thead[\s\S]*?<\/thead>/.exec(table);
      const body = /<tbody[\s\S]*?<\/tbody>/.exec(table);
      if (!head || !body) continue;

      const firstRow = /<tr>([\s\S]*?)<\/tr>/.exec(body[0]);
      if (!firstRow) continue;   // an empty table has nothing to line up

      const ths = (head[0].match(/<th\b/g) || []).length;
      const tds = (firstRow[1].match(/<td\b/g) || []).length;

      assert.strictEqual(ths, tds,
        `${name}: a table has ${ths} headings over ${tds} cells, so the headings are shifted`);
    }
  }
});

section('A BLOG IS CREATED ON A DOMAIN FROM THE POOL');

/* THE CUSTOMER-FACING END OF THE WHOLE POOL CHANGE. They type a prefix and
 * pick a domain; they never see Cloudflare, a credential or a CNAME.
 *
 * THE FREE-TEXT DOMAIN FIELD IS GONE. Edwin chose one path on 22 October:
 * anything a blog can be created on is in the pool, including his own
 * explr-home.com. The alternative kept a second route through creation —
 * with no account, falling back to the server's credentials, and needing
 * the old zone-check-and-warn flow — for a case the admin screen already
 * covers in one form.
 */

const POOL_DOMAIN = { _id: 'dom-1', domain: 'acmehvac.com', account: 'acct-3', enabled: true };

test('THE FORM OFFERS THE POOL, NOT A TEXT BOX', async () => {
  install({ pool: [POOL_DOMAIN] });

  const out = await call(handler('get', '/static-blogs'));

  assert.ok(out.html.includes('name="prefix"'), 'there is nowhere to type a prefix');
  assert.ok(/<select[^>]+name="domain"/.test(out.html), 'the domain is not a dropdown');
  assert.ok(out.html.includes('acmehvac.com'), 'the pool domain is not offered');
});

test('AND A DOMAIN THAT IS OFF THE LIST IS NOT OFFERED', async () => {
  /* Disabling a domain is how a client leaving is handled — their existing
   * blogs still deploy, but nobody can start a new one there. */
  install({ pool: [POOL_DOMAIN, { _id: 'dom-2', domain: 'gone.com', account: 'acct-3', enabled: false }] });

  const out = await call(handler('get', '/static-blogs'));

  assert.ok(!out.html.includes('gone.com'), 'a disabled domain is still on the dropdown');
});

test('THE PREFIX AND THE DOMAIN BECOME THE HOSTNAME', async () => {
  install({ pool: [POOL_DOMAIN], blogs: [] });

  await call(handler('post', '/static-blogs'),
    req({ body: { name: 'Acme HVAC', prefix: 'hvac', domain: 'acmehvac.com' } }));

  assert.ok(db.created, 'nothing was created');
  assert.strictEqual(db.created.siteUrl, 'hvac.acmehvac.com');
});

test('AND THE BLOG IS BOUND TO THAT DOMAIN\'S ACCOUNT', async () => {
  /* SET ONCE, AT CREATION. A Domain row can be re-pointed at a different
   * account later; resolving through it at deploy time would silently move
   * an existing blog's deploys to an account where its project does not
   * exist. */
  install({ pool: [POOL_DOMAIN], blogs: [] });

  await call(handler('post', '/static-blogs'),
    req({ body: { name: 'Acme HVAC', prefix: 'hvac', domain: 'acmehvac.com' } }));

  assert.strictEqual(String(db.created.cloudflareAccount), 'acct-3',
    'the blog was created with no Cloudflare account, so it would deploy into ours');
});

test('A DOMAIN THAT IS NOT IN THE POOL IS REFUSED', async () => {
  /* The form is a dropdown, so this only happens to a posted request —
   * which is to say, to anybody. Without the check they would get a blog
   * with no account, deploying into the server's. */
  install({ pool: [POOL_DOMAIN], blogs: [] });

  const out = await call(handler('post', '/static-blogs'),
    req({ body: { name: 'X', prefix: 'hvac', domain: 'somewhere-else.com' } }));

  assert.strictEqual(out.status, 400);
  assert.strictEqual(db.created, null, 'it created a blog on a domain we do not host');
});

test('AND SO IS ONE THAT HAS BEEN DISABLED', async () => {
  install({ pool: [{ ...POOL_DOMAIN, enabled: false }], blogs: [] });

  const out = await call(handler('post', '/static-blogs'),
    req({ body: { name: 'X', prefix: 'hvac', domain: 'acmehvac.com' } }));

  assert.strictEqual(out.status, 400);
  assert.strictEqual(db.created, null);
});

test('A HOSTNAME SOMEBODY ELSE ALREADY HAS IS REFUSED', async () => {
  /* THE CHECK THAT HAD TO CHANGE, AND IT WAS WRONG IN BOTH DIRECTIONS.
   *
   * It asked "does THIS customer already have a blog whose domain is
   * acmehvac.com". On a shared pool that both blocks one customer from
   * having two prefixes on a domain — which is the design — and fails to
   * block two customers taking the SAME prefix, because it never looks
   * past their own blogs. Whichever published last would overwrite the
   * other. */
  install({
    pool: [POOL_DOMAIN],
    blogs: [{ _id: 'other-blog', user: 'someone-else', target: 'cloudflare',
              status: 'active', siteUrl: 'hvac.acmehvac.com', business: { name: 'Theirs' } }],
  });

  const out = await call(handler('post', '/static-blogs'),
    req({ body: { name: 'Mine', prefix: 'hvac', domain: 'acmehvac.com' } }));

  assert.strictEqual(out.status, 400);
  assert.strictEqual(db.created, null, 'two blogs now claim one hostname');
});

test('BUT A SECOND PREFIX ON THE SAME DOMAIN IS FINE', async () => {
  /* The other direction, and the whole point of a shared pool. The old
   * check refused this. */
  install({
    pool: [POOL_DOMAIN],
    blogs: [{ _id: 'mine-1', user: USER_ID, target: 'cloudflare', status: 'active',
              siteUrl: 'hvac.acmehvac.com', business: { name: 'First' } }],
  });

  await call(handler('post', '/static-blogs'),
    req({ body: { name: 'Second', prefix: 'news', domain: 'acmehvac.com' } }));

  assert.ok(db.created, 'a second prefix on one domain was refused');
  assert.strictEqual(db.created.siteUrl, 'news.acmehvac.com');
});

test('THE PREFIX IS NORMALISED, AND NONSENSE IS REFUSED', async () => {
  /* It becomes a hostname label and a Pages project name. A space, a dot
   * or a leading hyphen each produce something Cloudflare either rejects
   * or accepts and then serves at an address nobody expected. */
  install({ pool: [POOL_DOMAIN], blogs: [] });

  await call(handler('post', '/static-blogs'),
    req({ body: { name: 'X', prefix: '  HVAC  ', domain: 'acmehvac.com' } }));

  assert.strictEqual(db.created.siteUrl, 'hvac.acmehvac.com', 'the prefix was not normalised');

  for (const bad of ['', '   ', 'a b', 'has.dot', '-leading', 'trailing-', 'x'.repeat(64), 'www']) {
    install({ pool: [POOL_DOMAIN], blogs: [] });

    const out = await call(handler('post', '/static-blogs'),
      req({ body: { name: 'X', prefix: bad, domain: 'acmehvac.com' } }));

    assert.strictEqual(out.status, 400, `accepted prefix ${JSON.stringify(bad)}`);
  }
});

section('DELETING A BLOG USES ITS OWN CLOUDFLARE ACCOUNT');

/* THE TEARDOWN IS THE OTHER PATH THAT TOUCHES CLOUDFLARE, and it is the
 * dangerous one to get wrong in a way the deploy is not.
 *
 * releaseDomain() detaches a hostname and deletes a DNS record. Run against
 * the WRONG account it either does nothing — the project is not there — or,
 * worse, finds something with the same name and removes it. Edwin runs a
 * live blog on a domain in the server account; a teardown that fell back to
 * it while meaning a client's account is the one mistake here that takes
 * down a site nobody was touching.
 */

test('THE TEARDOWN IS HANDED THE BLOG\'S CREDENTIALS', async () => {
  install();
  db.blogs[0].cloudflareAccount = 'acct-3';
  db.blogs[0].project = 'leander-project';

  await call(handler('post', '/static-blogs/:id/delete'), req({ body: { confirm: 'leanderwaterheaters.com', dropProject: '1' } }));

  assert.ok(cloudflare.releaseCalls.length, 'the domain was never released');
  assert.deepStrictEqual(cloudflare.releaseCalls[0].creds, POOL_CREDS,
    'the domain was released using the server account');
  assert.deepStrictEqual(cloudflare.calls[0].creds, POOL_CREDS,
    'the project was deleted from the server account');
});

test('AND A BLOG WITH NO ACCOUNT STILL USES THE ENVIRONMENT', async () => {
  install();
  db.blogs[0].project = 'leander-project';

  await call(handler('post', '/static-blogs/:id/delete'), req({ body: { confirm: 'leanderwaterheaters.com', dropProject: '1' } }));

  assert.strictEqual(cloudflare.releaseCalls[0].creds, undefined,
    'a blog with no account was handed credentials from somewhere');
});

test('A BLOG WHOSE ACCOUNT CANNOT BE READ IS NOT TORN DOWN REMOTELY', async () => {
  /* THE ASSERTION THAT MATTERS IS THE ABSENCE OF A CALL. Falling back here
   * would point a detach and a DNS delete at the server account — where a
   * project of the same name may well exist, because project names are
   * derived from the domain and two accounts can host blogs on domains
   * that look alike. */
  install();
  db.blogs[0].cloudflareAccount = 'acct-broken';
  db.blogs[0].project = 'leander-project';

  const out = await call(handler('post', '/static-blogs/:id/delete'),
    req({ body: { confirm: 'leanderwaterheaters.com', dropProject: '1' } }));

  assert.deepStrictEqual(cloudflare.releaseCalls, [],
    'it released a domain in the wrong account');
  assert.deepStrictEqual(cloudflare.calls, [],
    'it deleted a project in the wrong account');
  assert.ok(out.html || out.status, 'the delete produced no answer at all');
});

section('THE SEARCH CONSOLE FIELD');

/* Each customer monitors their own blog from their own Search Console, so
 * the verification token is theirs and the field belongs on their blog's
 * screen. A Domain property verified on our side would verify the blogs to
 * US and to nobody else, which is the opposite of what this is for. */

const TOKEN = 'dK3xP9mQ2vR7nL4tY8wZ';
const GOOGLE_TAG = `<meta name="google-site-verification" content="${TOKEN}" />`;

test('THE FIELD IS ON THE BLOG SCREEN AND SHOWS WHAT IS STORED', async () => {
  install();
  db.blogs[0].verificationTags = [TOKEN];

  const out = await call(handler('get', '/static-blogs/:id'));

  assert.ok(out.html.includes('name="verificationTags"'),
    'there is nowhere to paste the tag');
  assert.ok(out.html.includes(TOKEN),
    'the stored token is not shown, so there is no way to tell it was saved');
});

test('AND IT SAYS THE TAG ONLY REACHES THE SITE ON PUBLISH', async () => {
  /* THE SUPPORT TICKET THIS PREVENTS. They paste the tag, press Verify in
   * Search Console straight away, and it fails — because the live site has
   * not been rebuilt. Without a line saying so, that is an email.
   *
   * READ INSIDE THE FORM, NOT ON THE PAGE — and the first version got that
   * wrong. It matched /publish/i against the whole document and SURVIVED a
   * mutant that deleted the sentence, because this screen has a Publish
   * button on it and says "the next time you publish" about article edits.
   * The word was always going to be there. Third loose whole-page match to
   * pass for the wrong reason today. */
  install();

  const out = await call(handler('get', '/static-blogs/:id'));

  const form = /<form[^>]+action="[^"]*\/verification"[\s\S]*?<\/form>/.exec(out.html);
  assert.ok(form, 'there is no verification form to read');
  assert.ok(/publish/i.test(form[0]),
    'the field does not say the tag reaches the site only on publish');
});

test('PASTING THE TAG GOOGLE GIVES YOU STORES THE TOKEN', async () => {
  /* The whole point: what is on the clipboard is a <meta> element, and that
   * is what arrives here. What gets stored is the value inside it. */
  install();

  await call(handler('post', '/static-blogs/:id/verification'),
    req({ body: { verificationTags: GOOGLE_TAG } }));

  const update = db.siteUpdates[db.siteUpdates.length - 1];
  assert.deepStrictEqual(update.update.$set.verificationTags, [TOKEN],
    'the whole tag was stored instead of the token inside it');
});

test('AND SO DOES PASTING THE BARE TOKEN', async () => {
  install();

  await call(handler('post', '/static-blogs/:id/verification'),
    req({ body: { verificationTags: TOKEN } }));

  assert.deepStrictEqual(
    db.siteUpdates[db.siteUpdates.length - 1].update.$set.verificationTags, [TOKEN]);
});

test('TWO LINES STORE TWO TOKENS', async () => {
  install();

  await call(handler('post', '/static-blogs/:id/verification'),
    req({ body: { verificationTags: `${GOOGLE_TAG}\naB1cD2eF3gH4iJ5kL6mN` } }));

  assert.deepStrictEqual(
    db.siteUpdates[db.siteUpdates.length - 1].update.$set.verificationTags,
    [TOKEN, 'aB1cD2eF3gH4iJ5kL6mN']);
});

test('CLEARING THE FIELD REMOVES THE VERIFICATION', async () => {
  /* How somebody un-verifies, and the one case where an empty submission
   * must be taken at face value rather than ignored as a mistake. */
  install();
  db.blogs[0].verificationTags = [TOKEN];

  await call(handler('post', '/static-blogs/:id/verification'),
    req({ body: { verificationTags: '   ' } }));

  assert.deepStrictEqual(
    db.siteUpdates[db.siteUpdates.length - 1].update.$set.verificationTags, []);
});

test('A HOSTILE PASTE IS NOT STORED AND NOT RENDERED', async () => {
  /* The route goes through the same parser the module was built for, rather
   * than carrying a second idea of what a token is. Checked at the route
   * because this is the only door the value comes in through. */
  install();

  await call(handler('post', '/static-blogs/:id/verification'),
    req({ body: { verificationTags: '"><script>alert(1)</script>' } }));

  assert.deepStrictEqual(
    db.siteUpdates[db.siteUpdates.length - 1].update.$set.verificationTags, []);
});

test('THE SAVE IS SCOPED TO THE SIGNED-IN ACCOUNT', async () => {
  /* Every handler on this route, every time. A new POST is exactly where it
   * gets forgotten, and this one writes to a document. */
  install();

  await call(handler('post', '/static-blogs/:id/verification'),
    req({ body: { verificationTags: TOKEN } }));

  assert.strictEqual(String(db.findOneWhere.user), String(USER_ID),
    'the blog was loaded without scoping to the account');
  assert.strictEqual(db.findOneWhere.target, 'cloudflare');
});

test('AND SOMEBODY ELSE\'S BLOG CANNOT BE VERIFIED THROUGH IT', async () => {
  install();
  db.blogs.length = 0;

  const out = await call(handler('post', '/static-blogs/:id/verification'),
    req({ body: { verificationTags: TOKEN } }));

  assert.strictEqual(out.status, 404);
  assert.deepStrictEqual(db.siteUpdates, [], 'it wrote to a blog it could not find');
});

test('A STORED TOKEN IS ESCAPED BACK INTO THE FIELD', async () => {
  /* Belt and braces at the other end. Whatever is in the document is
   * rendered into a textarea on a logged-in page, and a stored value that
   * closed the element would be an injection into Edwin's own screen. */
  install();
  db.blogs[0].verificationTags = ['</textarea><script>alert(1)</script>'];

  const out = await call(handler('get', '/static-blogs/:id'));

  assert.ok(!out.html.includes('<script>alert(1)</script>'),
    'a stored token broke out of the textarea');
});

section('THE CAMPAIGNS TABLE FOLDS ONCE THERE ARE TOO MANY TO SCAN');

/** A blog carrying `n` planned campaigns. */
function manyCampaigns(n) {
  return Array.from({ length: n }, (_, i) => ({
    _id: `507f1f77bcf86cd7994${String(500 + i).padStart(5, '0')}`,
    site: BLOG_ID,
    user: USER_ID,
    name: `Campaign ${i + 1}`,
    status: 'draft',
    slots: [{ index: 0 }],
  }));
}

/* ───────── THE FOLDS HAVE TO LOOK PRESSABLE ─────────
 *
 * Edwin, 24 October: *"Could you make the word show and change buttons
 * without removing the arrows. I want the user to understand they can
 * press the buttons."*
 *
 * A <summary> is grey text with a small triangle. It IS a control and it
 * does not look like one — the triangle is the only hint, and it is four
 * pixels of chrome somebody has to already know the meaning of.
 *
 * SO THE VERB WEARS A BUTTON, AND THE TRIANGLE STAYS. Both halves matter:
 * the button says "press me", the triangle says "this opens downwards
 * rather than going somewhere". Hiding the marker to make room for a
 * tidier button is the obvious next tidy-up and is exactly what was asked
 * against.
 */

test('THE FOLDS SAY THEY CAN BE PRESSED', async () => {
  /* ENOUGH CAMPAIGNS FOR THE SECOND FOLD TO EXIST AT ALL. The campaigns
   * table only folds above five, and the first version of this test had
   * three — so it checked one summary, believed it had checked both, and
   * removing the campaigns button survived it untouched. */
  installPicker();
  for (let i = 0; i < 6; i += 1) {
    db.campaigns.push({ _id: `c-x${i}`, name: `Another ${i}`, status: 'active', slots: [{ index: 0 }] });
  }

  const out = await call(handler('get', '/static-blogs/:id'), req({ params: { id: BLOG_ID } }));
  const summaries = out.html.match(/<summary[\s\S]*?<\/summary>/g) || [];

  assert.strictEqual(summaries.length, 2,
    `expected both folds on the page, found ${summaries.length}`);

  for (const summary of summaries) {
    assert.ok(/class="[^"]*\bbtn\b/.test(summary),
      `a fold still reads as grey text: ${summary.replace(/\s+/g, ' ').trim()}`);
  }
});

test('AND THE TRIANGLE IS STILL THERE', async () => {
  /* THE HALF THAT IS EASY TO LOSE. Every CSS recipe for "style a summary"
   * starts by hiding the marker — `list-style: none`, or the WebKit
   * pseudo-element — because the triangle is in the way of a tidy button.
   *
   * It is not in the way. It is the part that says this opens downwards
   * rather than navigating somewhere, and removing it was the one thing
   * the request ruled out. */
  installPicker();

  const out = await call(handler('get', '/static-blogs/:id'), req({ params: { id: BLOG_ID } }));

  assert.ok(!/list-style\s*:\s*none/.test(out.html),
    'something hides the disclosure triangle');
  assert.ok(!/details-marker/.test(out.html),
    'something hides the WebKit disclosure triangle');
  assert.ok(!/summary\s*{[^}]*display\s*:/.test(out.html),
    'summary has had its display changed, which drops the marker');
});

/** The <details> wrapper around the campaigns table, if there is one. */
function campaignsFold(html) {
  return /<details[^>]*>[\s\S]*?<\/details>/.exec(html);
}

test('A FEW CAMPAIGNS ARE SHOWN, NOT HIDDEN BEHIND A CONTROL', async () => {
  /* A control that hides a blog's only campaign is worse than no control:
   * it costs a click to learn there was nothing to see. Edwin asked for a
   * toggle because his blogs have many; a blog with three is the case the
   * toggle must not make worse. */
  install({ campaigns: manyCampaigns(3) });

  const out = await call(handler('get', '/static-blogs/:id'));
  const fold = campaignsFold(out.html);

  assert.ok(out.html.includes('Campaign 1'), 'the campaigns vanished');

  if (fold) {
    assert.ok(/<details[^>]*\bopen\b/.test(fold[0]),
      'a three-campaign blog opens folded shut');
  }
});

test('AND MANY ARE FOLDED AWAY', async () => {
  /* The reason it exists. The table sits between the timezone form and the
   * front-page picker, so a worked blog pushes both off the screen — the
   * same crowding the Articles list caused, one table along. */
  install({ campaigns: manyCampaigns(12) });

  const out = await call(handler('get', '/static-blogs/:id'));
  const fold = campaignsFold(out.html);

  assert.ok(fold, 'twelve campaigns are still printed whole');
  assert.ok(!/<details[^>]*\bopen\b/.test(fold[0]),
    'the fold is open, so it folds nothing');
});

test('THE SUMMARY SAYS HOW MANY ARE INSIDE', async () => {
  /* A closed fold labelled "Campaigns" tells a reader nothing about
   * whether to open it. The count is the whole of its usefulness. */
  install({ campaigns: manyCampaigns(12) });

  const out = await call(handler('get', '/static-blogs/:id'));
  const summary = /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(out.html);

  assert.ok(summary, 'the fold has no summary, so it cannot be opened by label');
  assert.ok(/\b12\b/.test(summary[1]),
    `the summary does not say how many: "${summary[1].trim()}"`);
});

test('THE TABLE IS STILL IN THE PAGE, NOT FETCHED WHEN OPENED', async () => {
  /* <details> hides its contents; it does not withhold them. That is the
   * point of choosing it: no JavaScript, no second request, and it works
   * under the CSP that blocks inline handlers — which is exactly what broke
   * the Clear topics button on 20 October. */
  install({ campaigns: manyCampaigns(12) });

  const out = await call(handler('get', '/static-blogs/:id'));

  assert.ok(out.html.includes('Campaign 12'),
    'the last campaign is not in the page, so the fold is doing more than folding');
});

test('AND IT CARRIES NO INLINE HANDLER', async () => {
  /* THE TRAP THIS DESIGN AVOIDS, asserted rather than assumed. helmet sets
   * script-src-attr to 'none' by default, so an onclick toggle renders,
   * looks right, and does nothing at all — silently, with the failure only
   * visible in the console. */
  install({ campaigns: manyCampaigns(12) });

  const out = await call(handler('get', '/static-blogs/:id'));
  const fold = campaignsFold(out.html);

  assert.ok(!/\son[a-z]+\s*=\s*["']/.test(fold[0]),
    'the fold uses an inline handler, which the CSP blocks');
});

test('A BLOG WITH NO CAMPAIGNS STILL SAYS SO', async () => {
  install({ campaigns: [] });

  const out = await call(handler('get', '/static-blogs/:id'));

  assert.ok(out.html.includes('No campaigns yet'), 'the empty state went missing');
  assert.strictEqual(campaignsFold(out.html), null,
    'an empty blog was given a fold to open');
});

section('THE ARTICLES HAVE THEIR OWN SCREEN, BECAUSE 171 ROWS IS NOT A LIST');

/** A blog with `n` written articles, ids and titles distinct. */
function manyArticles(n) {
  return Array.from({ length: n }, (_, i) => ({
    _id: `507f1f77bcf86cd7994${String(390 + i).padStart(5, '0')}`,
    title: `Article ${i + 1}`,
    slug: `article-${i + 1}`,
  }));
}

test('THE BIG TABLE IS GONE FROM THE BLOG PAGE', async () => {
  /* Edwin's plumbing blog reached 171 articles and the table was rendered
   * whole, above the campaign form and the front-page picker — the two
   * things anybody actually opens that page for. The list had no limit and
   * no paging; it was written as a way INTO the editor, and grew into a
   * report nobody designed. */
  install({ articles: manyArticles(171) });

  const out = await call(handler('get', '/static-blogs/:id'));

  /* ASSERTED ON THE TABLE, NOT ON A TITLE — and the first version got that
   * wrong in a way worth recording.
   *
   * It checked that "Article 60" was absent from the page, and FAILED
   * against a correct implementation: the front-page dropdown lists every
   * article as an <option>, so all 171 titles are still in the HTML and
   * always were. The table is gone; the titles are not, because a second
   * control on the same page legitimately names them.
   *
   * That is also the finding. The dropdown is still unbounded — 171
   * <option> elements — which is a separate job from this one, and is in
   * CLAUDE.md rather than fixed here. */
  const rows = [...out.html.matchAll(/<a[^>]+href="[^"]*\/articles\/[a-f0-9]{24}\/edit"/g)];
  assert.strictEqual(rows.length, 0,
    `the blog page is still printing an article table (${rows.length} edit links)`);
});

test('AND IS REPLACED BY A COUNT AND A WAY THROUGH', async () => {
  /* THE HALF THAT MAKES THE DELETION SAFE. Removing the table and leaving
   * nothing would strand every article: the front-page dropdown names them
   * and opens nothing, which is the exact state this list was built to fix
   * in the first place. */
  install({ articles: manyArticles(171) });

  const out = await call(handler('get', '/static-blogs/:id'));

  /* THE HREF MUST END THERE. This first asserted `.includes('/articles')`
   * and PASSED before the screen existed, because every Edit button on the
   * old table was a link to /articles/<id>/edit. A substring of a URL is
   * not a link to it. */
  assert.ok(new RegExp(`href="/static-blogs/${BLOG_ID}/articles"`).test(out.html),
    'there is no link to the articles screen');

  /* THE COUNT READ OUT OF THE BUTTON, NOT FOUND ON THE PAGE.
   *
   * This asserted /\b171\b/ against the whole document and SURVIVED a
   * mutant that printed 172: the front-page dropdown carries an option
   * reading "Article 171", so the digits were on the page either way. The
   * second time in this session a loose match passed because the page
   * happened to contain the string somewhere else. */
  const button = new RegExp(
    `href="/static-blogs/${BLOG_ID}/articles"[^>]*>\\s*([\\s\\S]*?)</a>`).exec(out.html);
  assert.ok(button, 'there is no articles button to read a count from');
  assert.strictEqual(button[1].trim(), '171 articles',
    `the button reads "${button[1].trim()}"`);
});

test('ONE ARTICLE IS AN ARTICLE, NOT 1 ARTICLES', async () => {
  install({ articles: manyArticles(1) });

  const out = await call(handler('get', '/static-blogs/:id'));
  const button = new RegExp(
    `href="/static-blogs/${BLOG_ID}/articles"[^>]*>\\s*([\\s\\S]*?)</a>`).exec(out.html);

  assert.strictEqual(button[1].trim(), '1 article');
});

test('THE SCREEN LISTS ONE PAGE OF THEM, NOT ALL OF THEM', async () => {
  install({ articles: manyArticles(171) });

  const out = await call(handler('get', '/static-blogs/:id/articles'));

  assert.strictEqual(out.status, 200);
  assert.ok(out.html.includes('Article 1'), 'the first article is missing');
  assert.ok(out.html.includes('Article 50'), 'the page is shorter than one page');
  assert.ok(!/Article 51\b/.test(out.html), 'the page ran past its own size');
});

test('AND IT ASKS THE DATABASE FOR ONE PAGE, NOT FOR THE BLOG', async () => {
  /* Slicing in JavaScript renders an identical screen and still pulls every
   * title out of Mongo on every view — which is the cost the paging exists
   * to avoid, and the one thing a rendered-HTML assertion cannot see. */
  install({ articles: manyArticles(171) });

  await call(handler('get', '/static-blogs/:id/articles'));

  assert.strictEqual(db.postFindLimit, 50, 'the query has no limit on it');
  assert.strictEqual(db.postFindSkip, 0, 'the first page should skip nothing');
});

test('THE NUMBERS CARRY ON ACROSS PAGES, THEY DO NOT RESTART', async () => {
  /* Page two beginning at 1 again would make "the fourth article" mean two
   * different things on two screens of one blog — the same reasoning that
   * put numbers on the publish result and the Articles list together. */
  install({ articles: manyArticles(171) });

  const out = await call(handler('get', '/static-blogs/:id/articles'), req({ query: { page: '2' } }));

  assert.strictEqual(db.postFindSkip, 50, 'page two did not skip the first page');

  const numbers = rowNumbersIn(out.html);
  assert.strictEqual(numbers[0], '51', `page two starts its numbering at ${numbers[0]}`);
  assert.strictEqual(numbers[numbers.length - 1], '100');
});

test('THE PAGE COUNT ROUNDS UP, SO THE LAST FEW ARE NOT LOST', async () => {
  /* 171 articles at 50 a page is 3.42 pages, and the twenty-one on page
   * four are the ones a floor() would strand: reachable only by typing
   * ?page=4 into the address bar, with the screen itself insisting there
   * are three. Mutation found this untested — "Page 1 of 3" and "Page 1 of
   * 4" both satisfied every assertion here. */
  install({ articles: manyArticles(171) });

  const out = await call(handler('get', '/static-blogs/:id/articles'));

  assert.ok(/Page\s+1\s+of\s+4\b/.test(out.html),
    'the article screen miscounts its own pages');
});

test('AND A BLOG THAT FITS ON ONE PAGE IS NOT OFFERED PAGING AT ALL', async () => {
  install({ articles: manyArticles(12) });

  const out = await call(handler('get', '/static-blogs/:id/articles'));

  assert.ok(!/Page\s+\d+\s+of/.test(out.html),
    'a twelve-article blog is being shown page controls');
});

test('NEXT IS DEAD ON THE LAST PAGE, AND PREVIOUS ON THE FIRST', async () => {
  /* A live Next on the last page goes to a page that renders "there is
   * nothing on this page" — a dead end the screen led you into, which is
   * worse than the empty page arrived at by typing a number. Both
   * directions, because the same mistake is one character away at each
   * end. */
  install({ articles: manyArticles(171) });

  const first = await call(handler('get', '/static-blogs/:id/articles'));
  assert.ok(/<span[^>]*\bdisabled\b[^>]*>\s*&larr; Previous/.test(first.html),
    'Previous is live on the first page');
  assert.ok(/<a [^>]*href="[^"]*page=2"/.test(first.html),
    'Next does not go anywhere from the first page');

  const last = await call(handler('get', '/static-blogs/:id/articles'), req({ query: { page: '4' } }));
  assert.ok(/<span[^>]*\bdisabled\b[^>]*>\s*Next/.test(last.html),
    'Next is live on the last page, and leads to an empty one');
  assert.ok(/<a [^>]*href="[^"]*page=3"/.test(last.html),
    'Previous does not go anywhere from the last page');
});

test('A PAGE PAST THE END IS EMPTY, NOT AN ERROR', async () => {
  install({ articles: manyArticles(171) });

  const out = await call(handler('get', '/static-blogs/:id/articles'), req({ query: { page: '99' } }));

  assert.strictEqual(out.status, 200, 'walking off the end broke the screen');
});

test('AND A NONSENSE PAGE NUMBER NEVER REACHES THE QUERY', async () => {
  /* skip(-50) throws in Mongo, and `page=abc` makes NaN, which skips an
   * amount of rows that is neither zero nor a number. Both arrive from the
   * query string, which is to say from anybody. */
  install({ articles: manyArticles(171) });

  for (const page of ['0', '-3', 'abc', '', '1e9999', '2.7']) {
    await call(handler('get', '/static-blogs/:id/articles'), req({ query: { page } }));

    assert.ok(Number.isInteger(db.postFindSkip) && db.postFindSkip >= 0,
      `page=${JSON.stringify(page)} produced skip ${db.postFindSkip}`);
  }
});

test('EVERY ROW STILL OPENS ITS EDITOR', async () => {
  install({ articles: manyArticles(3) });

  const out = await call(handler('get', '/static-blogs/:id/articles'));

  for (const a of db.articles) {
    assert.ok(out.html.includes(`/static-blogs/${BLOG_ID}/articles/${a._id}/edit`),
      `no way into ${a.title}`);
  }
});

test('THE SCREEN IS SCOPED TO THE SIGNED-IN ACCOUNT', async () => {
  /* The rule the whole file is built on, and a new handler is exactly where
   * it gets forgotten. Asserted on WHAT WAS ASKED: a handler that loads by
   * id and compares afterwards passes a "did it 404" test and leaks on the
   * next early return somebody adds. */
  install({ articles: manyArticles(3) });

  const out = await call(handler('get', '/static-blogs/:id/articles'));

  assert.strictEqual(String(db.findOneWhere.user), String(USER_ID),
    'the blog was loaded without scoping to the account');
  assert.strictEqual(db.findOneWhere.target, 'cloudflare',
    'a WordPress site can be driven through the articles screen');
  assert.ok(out.html);
});

test('AND SOMEBODY ELSE\'S BLOG IS NOT HERE', async () => {
  install({ articles: manyArticles(3) });
  db.blogs.length = 0;          // the scoped query finds nothing

  const out = await call(handler('get', '/static-blogs/:id/articles'));

  assert.strictEqual(out.status, 404);
});

test('THE ARTICLES ARE ASKED FOR BY SITE, NOT BY ANYTHING GUESSABLE', async () => {
  install({ articles: manyArticles(3) });

  await call(handler('get', '/static-blogs/:id/articles'));

  assert.strictEqual(String(db.postFindWhere.site), String(BLOG_ID),
    'the article query is not scoped to this blog');
});

test('AN ARTICLE TITLE WITH HTML IN IT DOES NOT BECOME HTML HERE EITHER', async () => {
  /* The same guard the blog page has. A new screen rendering the same rows
   * is a new place for the same hole. */
  install({ articles: [{ _id: '507f1f77bcf86cd799439031',
                         title: '<img src=x onerror=alert(1)>',
                         slug: 'x" onmouseover="y' }] });

  const out = await call(handler('get', '/static-blogs/:id/articles'));

  assert.ok(!out.html.includes('<img src=x'), 'an article title was rendered as markup');
  assert.ok(!out.html.includes('onmouseover="y'), 'a slug broke out of its cell');
});

test('A BLOG WITH NO ARTICLES SAYS SO RATHER THAN SHOWING AN EMPTY TABLE', async () => {
  install({ articles: [] });

  const out = await call(handler('get', '/static-blogs/:id/articles'));

  assert.strictEqual(out.status, 200);
  assert.ok(!/<tbody>\s*<\/tbody>/.test(out.html), 'an empty table was rendered');
});

/* ======================================================================= */

(async () => {
  for (const run of queue) await run();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
