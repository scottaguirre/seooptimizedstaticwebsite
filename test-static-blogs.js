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

  BlogSite.updateOne = async () => ({ modifiedCount: 1 });
  User.findById = () => ({ lean: async () => ({ _id: USER_ID, credits: db.credits }) });

  BlogPost.aggregate = async () => [];
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

(async () => {
  for (const run of queue) await run();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
