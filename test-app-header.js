// test-app-header.js
//
// The logged-in header, and the fact that there are TWO copies of it.
//
// WHY THIS EXISTS
//
// The app had three navigation patterns, one per page — a real header on the
// generator, three buttons at the bottom of the dashboard, and nothing at all
// on the build progress page. utils/appHeader.js gives /dashboard and
// /jobs/:id the same header the generator has.
//
// The generator form was out of scope, so src/views/form.html keeps its own
// inline copy of that markup. TWO COPIES DRIFT. An item added to one profile
// menu and not the other is exactly the kind of thing nobody notices until a
// customer asks why Logout is missing on one page.
//
// So the test below reads both and asserts they offer the same links and the
// same actions. It deliberately does NOT compare markup character by
// character: classes, indentation and attribute order are allowed to differ.
// What must not differ is what the header DOES.
//
// When form.html is eventually switched over to call appHeader(), the drift
// test has nothing left to compare and should be replaced with a plain
// assertion that form.html contains no inline <header>.
//
//   node test-app-header.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

/* THE SIDEBAR'S OWN LABELS, separate from the page titles since the rows
 * took the verb on 17 November — see the note beside them in
 * utils/pageTitle.js. Read here rather than typed, so a rename moves in one
 * place instead of breaking a dozen assertions.
 *
 * AT THE TOP, NOT BESIDE THE TOOL_ NAMES FURTHER DOWN. This suite runs each
 * test as it reads the file, and the first use of NAV_BUILD_SITE is three
 * hundred lines above that import — a `const` read before its declaration
 * THROWS. The wizard lost its whole IIFE to exactly this on 16 November;
 * here it cost one test, which is the cheap version of the same lesson. */
const {
  NAV_BUILD_SITE, NAV_GH_SITES, NAV_CF_SITES, NAV_WP_BLOGS, NAV_CF_BLOGS,
} = require('./utils/pageTitle');
const {
  appHeader, appHeaderAssets, appHeaderScripts, appSidebar, appSidebarAssets,
} = require('./utils/appHeader');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

/* ASYNC TESTS, which this file had no way to run until the Admin menu needed
 * one. currentUserInfo.js awaits /api/me before it renders anything, so the
 * only way to see what it ACTUALLY puts in the header is to run it and wait.
 *
 * Asserting on the file's source text instead would have been simpler and
 * would have missed the thing that matters: whether a link sits inside the
 * `if (isAdmin)` block is BEHAVIOUR, and a regex over the source cannot tell
 * a link inside that block from one just above it.
 *
 * Collected here and awaited before the summary at the foot of the file, so
 * they report after the synchronous ones. */
const pending = [];
function testAsync(name, fn) {
  pending.push((async () => {
    try { await fn(); console.log(`  ok    ${name}`); passed++; }
    catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
  })());
}

const read = rel => fs.readFileSync(path.join(__dirname, rel), 'utf8');

const CSRF = '<input type="hidden" name="_csrf" value="tok">';

/**
 * The generator page as a browser receives it.
 *
 * Mirrors what routes/formRoute.js does, in the same order. The order matters:
 * appHeader() puts the CSRF token in the logout form itself, so filling
 * {{CSRF}} before {{HEADER}} would leave the logout button posting without one.
 */
function renderFormPage() {
  return read('src/views/form.html')
    .replace(/{{HEADER_ASSETS}}/g, appHeaderAssets() + appSidebarAssets())
    .replace(/{{HEADER_SCRIPTS}}/g, appHeaderScripts())
    .replace(/{{HEADER}}/g, appHeader(CSRF))
    .replace(/{{SIDEBAR}}/g, appSidebar('/'))
    /* The heading each door carries — added 17 November, and this line is
     * here because its absence is what the test below caught. The comment
     * on "the route fills every placeholder the page uses" already said a
     * copy of formRoute's substitution list goes stale; it went stale again
     * on the next placeholder added, which is the second time. THE COPY IS
     * KEPT ANYWAY because this helper renders a page the real route cannot:
     * one with no request behind it. The test that checks the page against
     * the ROUTE is what makes the staleness loud. */
    .replace(/{{WIZARD_TITLE}}/g, '<h1 class="h3 mb-1">Build a website</h1>')
    .replace(/{{CSRF}}/g, CSRF);
}

/** Markup with comments removed, so a comment cannot be mistaken for a tag. */
function withoutComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * The header as a browser sees it, comments stripped.
 *
 * USE THIS, NOT appHeader() DIRECTLY, for anything asserting that a piece of
 * markup EXISTS. The comments in appHeader.js quote the markup they explain —
 * one of them literally reads `KEEP id="user-info"` — so a plain
 * `includes('id="user-info"')` matches the explanation and passes while the
 * element itself is gone. Three mutations survived that way before this
 * existed, in three separate sittings.
 */
function headerMarkup() {
  return withoutComments(appHeader(CSRF));
}

/**
 * JavaScript source with comments removed.
 *
 * Every assertion below that greps a .js file MUST go through this. Two
 * mutations survived without it: formRoute.js's comment explains the ordering
 * and in doing so writes both "appHeader()" and "{{HEADER}}" in prose, so a
 * plain source search found the explanation rather than the code and passed
 * while the code was gone.
 */
function jsWithoutComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

console.log('\nApp header\n');

/* -------------------------------------------------------------------------
 * What the header contains
 * ---------------------------------------------------------------------- */

test('the header offers exactly the destinations it should', () => {
  // "/" ONCE now: the logo. The visible "Build a Website" button moved to the
  // sidebar on 23 September, because with a tools column on the page it was
  // the same action offered twice on one screen.
  //
  // "/my-sites" WAS ADDED 30 OCTOBER AND LEFT AGAIN ON 16 NOVEMBER. It went
  // in because the route had been mounted since the editor was built with
  // nothing linking to it, so the only way in was to type the URL. It came
  // out because it is a sidebar row now, under Manage, and Edwin's call was
  // that it should not be in both places — every other tool lives in one.
  //
  // THE LIST IS EXACT ON PURPOSE. A test that only checked the four it
  // wants would not notice a fifth arriving, and the point of this one is
  // that the header stays small.
  const html = appHeader(CSRF);
  assert.deepStrictEqual(
    [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]),
    ['/', '/dashboard', '/buy-credits']
  );
  assert.deepStrictEqual(
    [...html.matchAll(/action="([^"]+)"/g)].map(m => m[1]),
    ['/logout']
  );
});

/* -------------------------------------------------------------------------
 * The primary action
 * ---------------------------------------------------------------------- */

test('the sidebar shows a visible link to build a website', () => {
  // It used to be in the header. What has NOT changed is that the thing
  // customers came to do must be visible rather than hidden behind the
  // convention that a wordmark links home.
  //
  // THE LABEL HAS BEEN THREE THINGS AND THE TEST IS ABOUT NONE OF THEM.
  // "Build a Website" in the header; "Websites" when the 16 November
  // regrouping moved the verb up into the BUILD WEBSITES heading; "Build
  // Website" on 17 November when Edwin asked for the verb on every row and
  // the headings became WEBSITES and BLOGS. What this test is for is
  // unchanged across all three: the row has to be THERE and VISIBLE.
  //
  // READ FROM pageTitle.js, not typed here, so the next rename moves it in
  // one place rather than breaking this.
  const html = withoutComments(appSidebar('/dashboard'));

  assert.ok(new RegExp(`<a href="/"[\\s\\S]*?>${NAV_BUILD_SITE}<[\\s\\S]*?</a>`).test(html),
    'the link to the wizard is gone from the sidebar');

  // And it says what it does on the row itself, so the heading above is a
  // filing label rather than the only thing supplying the verb.
  //
  // CONTAINS THE VERB, not starts with it. Edwin named this row "Click to
  // Build Websites" on 17 November — the open generator, and the row that
  // is also the page's primary action. An anchored test would have been a
  // test of the word order rather than of the property.
  assert.match(NAV_BUILD_SITE, /\bBuild\b/,
    'the row no longer says what pressing it does');
});

test('the header no longer carries it as well', () => {
  // One action, one place. Two was what Edwin spotted the moment the sidebar
  // appeared beside it.
  assert.ok(!/Build a Website/.test(withoutComments(appHeader(CSRF))),
    'the build button is in the header AND the sidebar again');
});

test('the primary action is not called "Generator"', () => {
  // "Generator" is our internal name for the tool. A customer is thinking
  // about the outcome, and "Build" is the brand's own verb — it is the first
  // word of the logo's strapline.
  //
  // withoutComments, because the comments in appHeader.js explain the naming
  // decision and therefore contain the word. They ship to the browser but no
  // one reads them; this is about what a CUSTOMER sees.
  const visible = withoutComments(appHeader(CSRF));
  assert.ok(!/Generator/i.test(visible), 'the header says "Generator" somewhere');
});

test('the build action still LOOKS like a button after the move', () => {
  // It shipped as a plain text link for about an hour, so that it would not
  // compete with the yellow Buy Credits button. Wrong thing to optimise — it
  // read as a phrase rather than something clickable, and an affordance
  // nobody recognises is worth nothing however tidy the hierarchy.
  //
  // Moving it to the sidebar did not change that. It is the same solid blue;
  // only the file it is drawn in changed.
  const html = withoutComments(appSidebar('/dashboard'));
  assert.ok(/app-sidebar-cta/.test(html),
    'the build link is back to looking like every other sidebar entry');

  const css = appSidebarAssets();
  assert.ok(/\.app-sidebar-cta\s*\{[^}]*background:\s*var\(--bs-primary/.test(css),
    'the build button is no longer the primary blue');
});

test('being the current page does not grey the build button out', () => {
  // The plain active rule sets a translucent white background. Applied to the
  // button it would override the blue and make the page you are ON look like
  // the one action that is unavailable.
  const css = appSidebarAssets();
  assert.ok(/\.app-sidebar-cta\.app-sidebar-link-active\s*\{[^}]*background:\s*var\(--bs-primary/.test(css),
    'the active rule overrides the button colour');
});

test('Build a Website outranks Buy Credits visually', () => {
  // Buying credits is a means to an end; building a website is the end. Buy
  // Credits was a filled yellow button — the loudest thing in the header —
  // which put the hierarchy backwards. It is an OUTLINE button now.
  //
  // The two live in different files: the build button in appSidebar() since
  // 23 September, Buy Credits in public/js/currentUserInfo.js, which renders
  // it at runtime. So this is the only place the pair can be compared.
  const buildCss = appSidebarAssets();
  const script = read('public/js/currentUserInfo.js');
  const buy = script.match(/<a href="\/buy-credits"[^>]*>/)[0];

  assert.ok(/\.app-sidebar-cta\s*\{[^}]*background:\s*var\(--bs-primary/.test(buildCss),
    'the build button is not solid');
  assert.ok(/btn-outline-/.test(buy), `Buy Credits is solid again: ${buy}`);
  assert.ok(!/btn-warning(?!-)/.test(buy.replace('btn-outline-warning', '')),
    `Buy Credits is a filled warning button again: ${buy}`);
});

test('the dashboard has no navigation row of its own', () => {
  // Go to Generator / Buy Credits / Logout were removed on 21 September.
  // All three are in the header now, on every page rather than only this one,
  // and "Go to Generator" became the header's "Build a Website" button.
  // Keeping them would be the same three actions twice on one page.
  const src = read('routes/authRoute.js').replace(/<!--[\s\S]*?-->/g, '');

  assert.ok(!/Go to Generator/.test(src), 'the Go to Generator button is back');
  assert.ok(!/btn-warning">Buy Credits/.test(src), 'the Buy Credits button is back');
  assert.ok(!/btn-danger">Logout/.test(src), 'the Logout button is back');
});

test('the build action is the FIRST thing in the tools column', () => {
  // Navigation belongs on the left, where people look — which is now the
  // sidebar rather than the header's left half. Within it, the primary action
  // goes first: it is the end the other tools are means to.
  const html = withoutComments(appSidebar('/dashboard'));
  const links = [...html.matchAll(/<a href="([^"]+)"/g)].map(m => m[1]);
  assert.strictEqual(links[0], '/', `the tools column starts with ${links[0]}`);
});

/* -------------------------------------------------------------------------
 * The logo
 *
 * It replaced inert <strong>SEO Site Generator</strong> text on 21 September,
 * when the product was renamed to Three Comets.
 * ---------------------------------------------------------------------- */

test('the wordmark is a link to the generator', () => {
  // The name in the top-left going home is the one navigation convention
  // every visitor already knows, and it was previously not a link at all.
  // It also fixes a real dead end: from the build page, starting a second
  // site was finish -> dashboard -> Go to Generator.
  const html = headerMarkup();
  const link = html.match(/<a href="\/"[^>]*>\s*<img[^>]*>\s*<\/a>/s);
  assert.ok(link, 'the logo is not wrapped in a link to "/"');
});

test('the logo file referenced by the header actually exists', () => {
  // A broken <img> in the header is on every page of the app at once.
  const src = appHeader(CSRF).match(/<img[^>]*src="([^"]+)"/)[1];
  const onDisk = path.join(__dirname, 'public', src.replace(/^\//, ''));
  assert.ok(fs.existsSync(onDisk), `${src} is not in public/ (looked for ${onDisk})`);
});

test('the logo carries the brand name as alt text', () => {
  // The alt is the only thing a screen reader, or anyone with images off,
  // gets — the header has no text name any more. "logo" would say nothing.
  const alt = appHeader(CSRF).match(/<img[^>]*alt="([^"]*)"/)[1];
  assert.strictEqual(alt, 'Three Comets');
});

test('the old wordmark text is gone from the header', () => {
  assert.ok(!/SEO Site Generator/.test(appHeader(CSRF)),
    'the header still says "SEO Site Generator"');
});

test('the logo is sized to its real aspect ratio', () => {
  // width and height are set to stop the header jumping while the image
  // loads, which only works if they match the file. A mismatch squashes the
  // logo — and it is on every page, so it would be squashed everywhere.
  const img = appHeader(CSRF).match(/<img[^>]*>/s)[0];
  const w = Number(img.match(/width="(\d+)"/)[1]);
  const h = Number(img.match(/height="(\d+)"/)[1]);

  // The file is 452x162. Read from disk rather than hard-coded here, so
  // replacing the logo with a different shape fails this instead of shipping
  // a distorted one.
  const src = img.match(/src="([^"]+)"/)[1];
  const buf = fs.readFileSync(path.join(__dirname, 'public', src.replace(/^\//, '')));
  // PNG: width and height are big-endian uint32 at bytes 16 and 20.
  const realW = buf.readUInt32BE(16);
  const realH = buf.readUInt32BE(20);

  const drift = Math.abs((w / h) - (realW / realH));
  assert.ok(drift < 0.05,
    `displayed ${w}x${h} (${(w / h).toFixed(2)}:1) but the file is ` +
    `${realW}x${realH} (${(realW / realH).toFixed(2)}:1) — the logo is distorted`);
});

test('the logo is not displayed larger than its own pixels', () => {
  // Upscaling a raster logo makes it blurry on every page. The file is 452px
  // wide and shown at 112, which also covers retina.
  const img = appHeader(CSRF).match(/<img[^>]*>/s)[0];
  const w = Number(img.match(/width="(\d+)"/)[1]);
  const src = img.match(/src="([^"]+)"/)[1];
  const buf = fs.readFileSync(path.join(__dirname, 'public', src.replace(/^\//, '')));
  assert.ok(buf.readUInt32BE(16) >= w * 2,
    `shown at ${w}px from a ${buf.readUInt32BE(16)}px file — too soft on a retina screen`);
});

test('the dynamic slots the credits script fills are present', () => {
  // currentUserInfo.js returns silently unless BOTH exist, so a missing one
  // costs the credits badge, the Buy Credits button and the Admin menu — with
  // no error anywhere.
  const html = headerMarkup();
  for (const id of ['user-info', 'user-actions', 'profileMenuButton']) {
    assert.ok(html.includes(`id="${id}"`), `#${id} is missing`);
  }
});

test('the signed-in email sits inside the profile menu', () => {
  // Moved out of the header's left slot on 21 September. It is identity, not
  // navigation, it was occupying the space "Build a Website" needed, and it
  // was the widest thing in the header.
  const html = headerMarkup();
  const menu = html.match(/<ul class="dropdown-menu[\s\S]*?<\/ul>/)[0];
  assert.ok(menu.includes('id="user-info"'),
    '#user-info is not inside the profile dropdown');
});

test('the email slot keeps the id the credits script looks for', () => {
  // currentUserInfo.js fills #user-info from /api/me and does not care where
  // the element sits — which is why moving it needed no JavaScript change.
  // Renaming the id would silently leave it empty: the script returns early
  // when the id is missing, with no error anywhere.
  const script = read('public/js/currentUserInfo.js');
  const wanted = [...script.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]);
  const html = headerMarkup();

  assert.ok(wanted.includes('user-info'), 'the script no longer looks for #user-info');
  for (const id of wanted) {
    assert.ok(html.includes(`id="${id}"`),
      `currentUserInfo.js fills #${id} but the header has no such element`);
  }
});

test('the email is NOT in the visible part of the header', () => {
  const html = headerMarkup();
  const beforeMenu = html.slice(0, html.indexOf('<ul class="dropdown-menu'));
  assert.ok(!beforeMenu.includes('id="user-info"'),
    'the email slot is back in the always-visible header');
});

test('the logout form carries the CSRF field it is given', () => {
  // The logout form POSTs. Without the token the POST is rejected and Logout
  // silently does nothing.
  assert.ok(appHeader(CSRF).includes('name="_csrf"'));
});

test('a missing CSRF field renders the header rather than throwing', () => {
  // Matches how the dashboard already writes `${res.locals.csrfField || ''}`.
  // A header that throws would take the whole page down over a logout button.
  for (const arg of [undefined, '', null]) {
    const html = appHeader(arg);
    assert.ok(html.includes('<header'), `threw or emptied for ${JSON.stringify(arg)}`);
    assert.ok(!html.includes('undefined'), `"undefined" leaked into the markup`);
    assert.ok(!html.includes('null'), `"null" leaked into the markup`);
  }
});

/* -------------------------------------------------------------------------
 * The assets, which are the easy half to forget
 * ---------------------------------------------------------------------- */

test('the icon font is loaded, or the profile menu is invisible', () => {
  // The profile control is <i class="bi bi-person-circle">. Without the icon
  // font it renders as nothing at all — an invisible control that still opens
  // a menu when clicked.
  assert.ok(/bootstrap-icons/.test(appHeaderAssets()), appHeaderAssets());
});

test('GREEN BUTTONS ARE LEGIBLE ON THE NAVY BACKGROUND', () => {
  /* Bootstrap's btn-outline-success paints #198754 — a dark green chosen to
   * sit on white. On #082d5b it scores 3.0:1, below the 4.5 a reader needs,
   * and the first thing anybody asked about it was whether the button was
   * greyed out. A control that looks unavailable is worse than a plain one,
   * because nobody tries it.
   *
   * CONTRAST IS COMPUTED, not eyeballed. "It looks fine to me" is how the
   * original shipped. */
  const css = appHeaderAssets();

  assert.ok(/\.btn-outline-success/.test(css),
    'the success button is left at Bootstrap\'s light-background green');

  const colour = /--bs-btn-color:\s*#([0-9a-f]{6})/i.exec(css);
  assert.ok(colour, 'no colour is set for the success button');

  const channel = hex => {
    const v = parseInt(hex, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lum = hex => 0.2126 * channel(hex.slice(0, 2))
    + 0.7152 * channel(hex.slice(2, 4))
    + 0.0722 * channel(hex.slice(4, 6));

  const a = lum(colour[1]);
  const b = lum('082d5b');
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

  assert.ok(ratio >= 4.5,
    `the green scores ${ratio.toFixed(2)}:1 on the navy background, below 4.5`);
});

test('the header supplies its own colour, so both headers look the same', () => {
  // .header-background lives in form.html's inline <style>. Without it the
  // header falls back to Bootstrap's bg-dark — nearly black, against the navy
  // the rest of the app uses.
  const css = appHeaderAssets();
  assert.ok(/\.header-background/.test(css), css);
  assert.ok(/#082d5b/i.test(css), css);
});

/* ===================================================================== *
 * WHAT THE TWO BLOG TOOLS ARE CALLED
 *
 * Renamed 21 October on Edwin's instruction: "Blog Automation" -> "Build WP
 * blogs", "Static Blogs" -> "Build Cloudflare Blogs".
 *
 * Neither old label said what the thing BUILDS, and "Static" was an
 * implementation detail — the blogs are static because Cloudflare Pages
 * serves files, which is true and tells a customer nothing. The new pair
 * also says they are two halves of one choice.
 *
 * THE URLS DO NOT MOVE. /blog-sites and /static-blogs are bookmarked, linked
 * from the plugin's setup text and written in Edwin's own notes. A label is
 * cheap to change; a path is not.
 * ===================================================================== */

const {
  TOOL_WP_BLOGS, TOOL_CF_BLOGS, TOOL_BLOG_REPORT, TOOL_MY_SITES, TOOL_GH_SITES,
} = require('./utils/pageTitle');

/**
 * A source file with its comments removed, for scanning the strings a
 * CUSTOMER can see.
 *
 * COMMENTS COME OFF, AND THE REASON IS A SCAR. A ban on the word `onclick`
 * failed earlier this month on the comment explaining why the onclick had
 * been removed, and a CSS rule check passed on a stylesheet it had skipped
 * entirely because every rule was preceded by a comment. The old names are
 * all over this codebase's prose, correctly — they are its history.
 *
 * Only whole-line comments are stripped, never a trailing `//`: a line
 * carrying `https://example.com` would lose everything after the scheme,
 * and a scan that silently shortens its own input reports clean because it
 * never looked.
 */
function codeOnly(file) {
  const src = fs.readFileSync(path.join(__dirname, file), 'utf8');

  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');
}

test('THE SIDEBAR CALLS THEM WHAT EDWIN CALLS THEM', () => {
  const html = appSidebar('/');

  assert.ok(html.includes(TOOL_WP_BLOGS), `the sidebar does not say "${TOOL_WP_BLOGS}"`);
  assert.ok(html.includes(TOOL_CF_BLOGS), `the sidebar does not say "${TOOL_CF_BLOGS}"`);

  assert.ok(!html.includes('Blog Automation'), 'the sidebar still says Blog Automation');
  assert.ok(!html.includes('Static Blogs'), 'the sidebar still says Static Blogs');
});

test('THE BLOG REPORT IS IN THE TOOLS COLUMN', () => {
  /* ADDED 23 OCTOBER, on Edwin's instruction.
   *
   * It had ONE entry point: a small green button in the top-right corner of
   * the Build WP blogs page. So the report covering EVERY blog — WordPress
   * and Cloudflare both — was reachable only from one of the two tools it
   * reports on, and only if you read a button that looks like a page action
   * as navigation. From Build Cloudflare Blogs there was no route to it.
   *
   * The milder form of the failure appSidebar()'s own comment describes:
   * not unreachable, just somewhere nobody looks. */
  const html = appSidebar('/');

  assert.ok(html.includes('href="/blog-report"'), 'the sidebar has no Blog Report');
  assert.ok(html.includes(TOOL_BLOG_REPORT), `the sidebar does not say "${TOOL_BLOG_REPORT}"`);
});

test('THE COLUMN IS GROUPED, AND EVERY ROW IS UNDER A HEADING', () => {
  /* ADDED 16 NOVEMBER with the grouping itself. Edwin: *"the options to
   * build websites or blogs are a little disorganized"*.
   *
   * THE WHOLE MAP, NOT A PROPERTY OF IT — and the first version of this
   * test is why. It asserted that no row appears before the first heading,
   * on the theory that a tool with no `group` would be stranded at the top.
   * A mutant removing `group` from Static Blogs passed it.
   *
   * It passed because an ungrouped row is NOT stranded at the top: it is
   * emitted wherever it falls in the array, which puts it under whichever
   * heading happens to precede it. It looks filed. It is filed under
   * something nobody chose.
   *
   *     THE FAILURE IS NOT A ROW WITHOUT A HEADING. IT IS A ROW UNDER THE
   *     WRONG ONE, AND THAT IS INVISIBLE FROM ANY SINGLE PROPERTY.
   *
   * So this states the organisation outright. It IS a change-detector, on
   * purpose: which row sits under which heading is the request, so moving
   * one should require saying so here.
   *
   * ONE MUTATION SURVIVES THIS, DELIBERATELY. Deleting `group` from a row
   * that already sits directly beneath the heading it would have joined
   * renders BYTE-IDENTICAL HTML — checked, 1789 bytes, same sha256. The
   * ungrouped row is emitted in place and falls under the heading above
   * it, which is the heading it wanted.
   *
   * It is an equivalent mutant: the source differs, the output cannot.
   * Killing it would mean exporting the tools array so a test could read
   * `group` directly — asserting a field nobody can see, to catch a change
   * nobody can see. What it leaves behind is a latent fragility rather
   * than a defect: that row now depends on its POSITION for its heading,
   * so reordering the array would move it silently. The map above is what
   * catches that, the moment the order actually changes. */
  const html = withoutComments(appSidebar('/'));

  // Split on the headings, keeping them, so each chunk is one group.
  const parts = html.split(/<div class="app-sidebar-group">([^<]+)<\/div>/);
  const hrefs = (chunk) => [...chunk.matchAll(/<a href="([^"]+)"/g)].map(m => m[1]);

  assert.deepStrictEqual(hrefs(parts[0]), [],
    'a row is rendered before the first heading, so it is in no group');

  const map = {};
  for (let i = 1; i < parts.length; i += 2) map[parts[i]] = hrefs(parts[i + 1]);

  /* CORRECTED 17 NOVEMBER, and the correction is the point of having the
   * whole map here rather than a property of it.
   *
   * `/cloudflare-sites` sat under BUILD WEBSITES for a day — and that URL
   * is the LIST. So the row beside GitHub Websites opened a table of
   * published sites while GitHub's opened a wizard, beneath a heading
   * reading "Build websites". Edwin pressed it expecting the wizard:
   *
   *     *"The cloudflare website button takes me to the same old screen
   *     that was before"*
   *
   *     A HEADING IS A PROMISE EVERY ROW BENEATH IT HAS TO KEEP, AND THE
   *     ROW THAT BREAKS IT IS INVISIBLE FROM ANY ONE ROW.
   *
   * Both products now read down the column the same way: a BUILD row that
   * opens a wizard, a MANAGE row that opens its list. */
  /* THE HEADINGS LOST THE VERB ON 17 NOVEMBER, when the rows took it.
   * Edwin asked for "Build" on every row; leaving it in the heading too
   * would have read "Build websites -> Build Cloudflare Websites". A verb
   * belongs where the click is. */
  /* AND A FOURTH WEBSITES ROW ON 17 NOVEMBER — Cloudflare Local Automation,
   * the eleven-page build published to Cloudflare. It is the PAIR of
   * /github-sites rather than a second /cloudflare-sites/new: same builder,
   * same eleven pages, a different destination and its own five layouts.
   *
   * NO MANAGE ROW OF ITS OWN, deliberately, and the rule asserted in the
   * test below still holds because of where the sites go: they are
   * Cloudflare sites and they are listed in My Cloudflare Websites with the
   * rest. Edwin, the same afternoon: one list, one place to look. */
  assert.deepStrictEqual(map, {
    'Websites': ['/', '/github-sites', '/cloudflare-sites/new', '/local-automation'],
    'Blogs':    ['/blog-sites', '/static-blogs'],
    'Tools':    ['/keyword-research'],
    'Manage':   ['/blog-report', '/my-sites', '/cloudflare-sites', '/dashboard'],
  });
});

test('EVERY BUILD ROW OPENS A WIZARD AND EVERY LIST HAS A MANAGE ROW', () => {
  /* THE PROPERTY THE MAP ABOVE ONLY STATES BY EXAMPLE.
   *
   * The map is a change-detector: rewrite it and it passes again, which is
   * exactly what somebody repeating the 16 November mistake would do. This
   * states the RULE, so moving a list back under a build heading fails for
   * a reason rather than for a mismatch.
   *
   * THE TEST IS THE PAIRING. Every host that can build has two rows — one
   * to make a website, one to see the ones it made — and they are not the
   * same URL. */
  const html = withoutComments(appSidebar('/'));

  const parts = html.split(/<div class="app-sidebar-group">([^<]+)<\/div>/);
  const hrefs = (chunk) => [...chunk.matchAll(/<a href="([^"]+)"/g)].map(m => m[1]);

  const map = {};
  for (let i = 1; i < parts.length; i += 2) map[parts[i]] = hrefs(parts[i + 1]);

  const building = map['Websites'] || [];
  const managing = map['Manage'] || [];

  for (const list of ['/cloudflare-sites', '/my-sites']) {
    assert.ok(!building.includes(list),
      `${list} is a list of published websites and it is under "Websites"`);
    assert.ok(managing.includes(list),
      `${list} is not under "Manage", so the list it shows has no row of its own`);
  }

  for (const wizard of ['/github-sites', '/cloudflare-sites/new']) {
    assert.ok(building.includes(wizard),
      `${wizard} opens a wizard and is not under "Websites"`);
  }
});

test('EVERY BUILD ROW SAYS "BUILD", AND NO HEADING SAYS IT TWICE', () => {
  /* EDWIN, 17 November: *"all the options on the sidebar should add the
   * word Build"*.
   *
   * AND THE VERB MOVED RATHER THAN DOUBLED. The groups were "Build
   * websites" and "Build blogs" — the 16 November regrouping put the verb
   * in the heading precisely so it was not repeated down the column.
   * Adding it to every row AND leaving it in the heading reads "Build
   * websites -> Build Cloudflare Websites".
   *
   *     A VERB BELONGS WHERE THE CLICK IS. A heading is a filing label;
   *     the row is the thing you do.
   *
   * BOTH HALVES ASSERTED TOGETHER, because either alone is satisfiable by
   * the arrangement this replaced: rows with no verb under a heading that
   * has one, or rows with a verb under a heading that also has one. */
  const html = withoutComments(appSidebar('/dashboard'));

  const parts = html.split(/<div class="app-sidebar-group">([^<]+)<\/div>/);
  const labels = (chunk) => [...chunk.matchAll(/<span>([^<]+)<\/span>/g)].map(m => m[1]);

  const map = {};
  for (let i = 1; i < parts.length; i += 2) map[parts[i]] = labels(parts[i + 1]);

  for (const heading of ['Websites', 'Blogs']) {
    assert.ok(map[heading], `there is no "${heading}" group`);

    assert.ok(!/build/i.test(heading),
      `the "${heading}" heading says the verb the rows beneath it already say`);

    for (const label of map[heading]) {
      /* ⚠ ONE EXEMPTION, AND IT IS A NAME RATHER THAN AN OVERSIGHT.
       *
       * Edwin named this product on 17 November: *"this will be named
       * Cloudflare Local Automation"*. Shown the clash with his own earlier
       * *"all the options on the sidebar should add the word Build"*, and
       * offered "Build Cloudflare Local Automation", he kept the name.
       *
       *     A HOUSE STYLE IS NOT A REASON TO RENAME SOMEBODY'S PRODUCT.
       *     The later, specific instruction wins over the earlier, general
       *     one — and the exemption is written here so the next person to
       *     read this test finds a decision rather than a gap.
       *
       * NAMED EXACTLY, not matched by a pattern. "every row except the ones
       * that look like product names" is not a rule; this is a list of one. */
      if ('Cloudflare Local Automation' === label) continue;

      /* THE VERB IS PRESENT, WHEREVER IT SITS IN THE PHRASE. Four rows read
       * "Build <host> Websites" and one reads "Click to Build Websites";
       * anchoring this to the start would make it a test of word order. */
      assert.match(label, /\bBuild\b/,
        `"${label}" is under ${heading} and does not say what pressing it does`);
    }

    /* AND THE EXEMPTION IS FOR ONE ROW, not a hole. If the name ever
     * changes, or a second row is quietly slipped past the rule by being
     * added to the `continue` above, this fails. */
    const exempt = map[heading].filter(l => !/\bBuild\b/.test(l));

    assert.ok(exempt.length <= 1,
      `${exempt.length} rows under ${heading} skip the verb: ${exempt.join(', ')}`);
  }

  /* AND THE ROWS THAT DO NOT BUILD MUST NOT SAY IT. A rule stated only as
   * "every label starts with Build" is satisfied by putting it on My
   * Cloudflare Websites and the Dashboard too. */
  for (const label of (map['Manage'] || []).concat(map['Tools'] || [])) {
    assert.ok(!/\bBuild\b/.test(label),
      `"${label}" is under a heading that makes nothing and claims to build`);
  }
});

test('and the five labels are the five Edwin named', () => {
  /* The map above proves the SHAPE. This pins the WORDS, because "Build
   * Website" and "Click to Build Websites" are a choice somebody made —
   * Edwin changed the first row to the latter on 17 November — and a silent
   * change to any of them should be a visible change here. */
  assert.deepStrictEqual(
    [NAV_BUILD_SITE, NAV_GH_SITES, NAV_CF_SITES, NAV_WP_BLOGS, NAV_CF_BLOGS],
    ['Click to Build Websites', 'Build GitHub Websites',
     'Build Cloudflare Websites', 'Build WordPress Blogs',
     'Build Cloudflare Blogs']);

  /* AND THEY ARE NOT THE PAGE TITLES. This is the distinction the change
   * turned up: TOOL_CF_BLOGS titles /static-blogs, which is a LIST of
   * blogs, and TOOL_WP_BLOGS also labels a button on the blog report and a
   * card on the dashboard. One string cannot be both once either grows a
   * verb. */
  assert.notStrictEqual(NAV_CF_BLOGS, TOOL_CF_BLOGS,
    'the nav label and the page title are the same string again');
  assert.ok(!/^Build /.test(TOOL_CF_BLOGS),
    'the page that LISTS Cloudflare blogs is titled as if it built them');
  assert.ok(!/^Build /.test(TOOL_WP_BLOGS),
    'a page title grew a verb, and it labels a button on two other screens');
});

test('A CLICKED ROW SAYS SO UNTIL THE NEXT PAGE ARRIVES', () => {
  /* EDWIN, 17 November: *"when I press Website and then go to Cloudflare
   * websites the page refreshes and there is nothing telling the user that
   * request has been sent"*.
   *
   * Every screen here is a full page load. The browser reports it in the
   * tab — at the top of a window nobody is looking at while their eyes are
   * on the row they just clicked. Inside the app nothing changed at all, so
   * a slow response was indistinguishable from a click that missed.
   *
   *     THE PROBLEM IS NOT THE NAVIGATION. IT IS THAT THE PAGE SAYS
   *     NOTHING WHILE IT HAPPENS.
   *
   * Ajax navigation would mean every screen rendering as a fragment and a
   * client router, to buy exactly this. The script is a dozen lines. */
  /* COMMENTS STRIPPED, AND THREE MUTANTS ARE WHY. The first draft of this
   * test matched the raw output: deleting the <script> tag outright left it
   * passing, because the HTML comment above the tag NAMES THE FILE. Same
   * for the busy rules and the note above them.
   *
   *     A TEST THAT SEARCHES A FILE FOR A WORD FINDS THE SENTENCE
   *     EXPLAINING THE CODE AS HAPPILY AS THE CODE.
   *
   * This project has now recorded that failure four times — the badges
   * test, two sidebar mutants, and here. */
  const css = withoutComments(appSidebarAssets());

  assert.match(css, /\.app-sidebar-link-busy\s*\{[^}]*cursor:\s*progress/,
    'the clicked row does not change at all, so it looks unclicked');
  assert.match(css, /@keyframes app-sidebar-spin/,
    'the busy row has no spinner');
  assert.match(css, /prefers-reduced-motion/,
    'the spinner ignores somebody who asked for less motion');

  assert.match(withoutComments(appHeaderScripts()), /src="\/js\/sidebarBusy\.js"/,
    'the busy-row script is not loaded, so the style is never applied');
});

test('AND A SPINNER COVERS THE SCREEN WHILE THE PAGE IS ON ITS WAY', () => {
  /* EDWIN, 17 November, on top of the busy row. The row answers "did my
   * click register"; this answers "the app is working and is not ready for
   * you yet", which on a slow load is the part a single dimmed line in a
   * column does not carry.
   *
   * NO DELAY AND NO TEXT, both his call — *"right now i just want the
   * spinner, don't worry about the flashing"*. A plain navigation has
   * nothing to report beyond "wait", which is what a spinner already
   * means. */
  const css = withoutComments(appSidebarAssets());

  assert.match(css, /\.app-nav-overlay\s*\{[^}]*position:\s*fixed/,
    'the overlay does not cover the page');
  assert.match(css, /\.app-nav-overlay\s*\{[^}]*inset:\s*0/,
    'the overlay does not reach the edges');
  assert.match(css, /\.app-nav-overlay__spinner\s*\{[^}]*animation:/,
    'the overlay has no spinner in it');

  /* UNDER THE WIZARD'S OWN OVERLAY, which sits at 9999 while a site is
   * generating. A navigation curtain on top of "Generating your website"
   * would hide the one message that is actually worth reading. */
  const z = /\.app-nav-overlay\s*\{[^}]*z-index:\s*(\d+)/.exec(css);
  assert.ok(z, 'the overlay has no z-index, so it may sit under the page');
  assert.ok(Number(z[1]) < 9999,
    `the navigation curtain is at ${z[1]}, on top of the wizard's own overlay`);

  /* THE CALL SITES, NOT THE DEFINITIONS — and two mutants are why. The
   * first draft matched `showOverlay()` anywhere in the file, which the
   * line `function showOverlay() {` satisfies on its own: deleting the
   * CALL left both assertions passing over a feature that never fired.
   *
   *     A FUNCTION THAT EXISTS AND IS NEVER CALLED PASSES EVERY TEST
   *     THAT LOOKS FOR ITS NAME.
   *
   * So each is asserted inside the handler that has to make it, which is
   * the thing actually at stake. */
  const script = codeOnly('public/js/sidebarBusy.js');

  const onClick = /function onClick\(event\) \{[\s\S]*?\n  \}/.exec(script);
  assert.ok(onClick, 'onClick has been renamed or reshaped');
  assert.match(onClick[0], /showOverlay\(\);/,
    'clicking a row does not raise the overlay');

  const restored = /addEventListener\('pageshow'[\s\S]*?\n  \}\);/.exec(script);
  assert.ok(restored, 'the pageshow handler has been renamed or reshaped');
  assert.match(restored[0], /hideOverlay\(\);/,
    'a page restored by the back button lands behind the curtain');
});

test('and the script is a FILE, not an inline handler', () => {
  /* The CSP blocks inline handlers and test-inline-handlers.js enforces it.
   * Stated here as well because the temptation on a one-line behaviour is
   * an onclick, and the failure then is a silently dead feature rather than
   * an error. */
  // codeOnly, for the reason given in the test above: this file explains
  // itself at length and every word asserted below appears in that prose.
  const script = codeOnly('public/js/sidebarBusy.js');

  assert.match(script, /addEventListener\('click'/,
    'the busy row is not wired by a listener');

  /* THE BACK BUTTON IS THE ONE THING THAT MUST CLEAR IT. A browser restores
   * a page from the back/forward cache exactly as it was, frozen — so a row
   * left spinning would still be spinning when somebody came back. Nothing
   * else clears it on purpose: the document is replaced when the new page
   * arrives, and a timeout would be a guess about how long a page takes. */
  const restored = /addEventListener\('pageshow'[\s\S]*?\n  \}\);/.exec(script);

  assert.ok(restored, 'there is no pageshow handler, so a restored row spins for ever');
  assert.match(restored[0], /persisted/,
    'the reset fires on every pageshow, so it clears the row it just set');

  /* THE CALL, NOT THE HANDLER'S EXISTENCE. A mutant that emptied the
   * handler passed the first draft of this: `pageshow` and `persisted`
   * were both still there, guarding nothing. */
  assert.match(restored[0], /clearBusy\(\);/,
    'the handler exists and does not actually clear the row');
});

test('and it does not mark a click that leaves this page alone', () => {
  /* Cmd-click and middle-click open a NEW tab: this page stays exactly
   * where it is, so a busy row would spin for ever on a page that never
   * navigated. Same for the row you are already on — a spinner there reads
   * as "something is wrong with this page" rather than "going there". */
  const script = codeOnly('public/js/sidebarBusy.js');

  for (const guard of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey',
                       'event.button', 'app-sidebar-link-active']) {
    assert.ok(script.includes(guard),
      `a ${guard} click still marks the row, which then never clears`);
  }
});

test('and the headings are the four we meant, in order', () => {
  /* THE ORDER IS LOAD-BEARING, not taste: Tools sits above Manage so that
   * Keyword Research remains the row immediately before Blog Report, which
   * is what Edwin asked for on 23 October and what the test below still
   * checks. Swap these two groups and that one fails — which is the point
   * of asserting the sequence here rather than the set. */
  const html = withoutComments(appSidebar('/'));
  const groups = [...html.matchAll(/app-sidebar-group">([^<]+)</g)].map(m => m[1]);

  assert.deepStrictEqual(groups,
    ['Websites', 'Blogs', 'Tools', 'Manage']);
});

test('GITHUB HAS A ROW, AND IT NAMES THE HOST', () => {
  /* ADDED 16 NOVEMBER. Until then the one host with no row was the one
   * whose builder was a CARD — "Local Website Options", second of four on
   * step 1, with the word GitHub nowhere on the screen. Cloudflare had two
   * named rows and WordPress one.
   *
   *     FINDING IT REQUIRED KNOWING WHICH CAPTION MEANT IT. That is not a
   *     discoverability problem about a screen; it is a whole host.
   *
   * The row sits beside Cloudflare Websites because the heading above both
   * already says what is being built, so each row is free to name only
   * where it lands. */
  const html = withoutComments(appSidebar('/'));

  assert.ok(html.includes('href="/github-sites"'), 'there is no GitHub row');
  assert.ok(html.includes(NAV_GH_SITES), `the sidebar does not say "${NAV_GH_SITES}"`);
});

test('and it marks itself when you are on it', () => {
  /* The row is the only thing on the page that says which of the three
   * website builders you are in — the wizard itself looks the same. */
  const html = withoutComments(appSidebar('/github-sites'));

  assert.ok(/href="\/github-sites"[^>]*app-sidebar-link-active/.test(html)
         || /app-sidebar-link-active[^>]*href="\/github-sites"/.test(html),
    'the GitHub row does not mark itself on its own page');

  assert.ok(!/href="\/"[^>]*app-sidebar-link-active/.test(html),
    'Websites is marked as current while you are on /github-sites');
});

test('MY WEBSITES IS IN THE COLUMN AND NOT IN THE HEADER', () => {
  /* BOTH HALVES, because the move is the request. Edwin, 16 November, asked
   * for /my-sites to leave the account dropdown when it joined the sidebar:
   * every other tool lives in exactly one place, and two entry points for
   * one screen is two things to keep in step.
   *
   * Asserting only its arrival would pass with it in both. */
  const side = withoutComments(appSidebar('/'));
  const head = withoutComments(appHeader(CSRF));

  assert.ok(side.includes('href="/my-sites"'),
    'My Websites is not in the sidebar');
  assert.ok(side.includes(TOOL_MY_SITES),
    `the sidebar does not say "${TOOL_MY_SITES}"`);
  assert.ok(!head.includes('/my-sites'),
    'My Websites is in the header dropdown as well, so it is in two places');
});

test('AND IT SITS AFTER KEYWORD RESEARCH, WHERE EDWIN ASKED FOR IT', () => {
  /* THE POSITION IS THE REQUEST, not a detail of it — so it is asserted by
   * ORDER rather than by presence.
   *
   * "The sidebar contains /blog-report" passes with the item last, first, or
   * anywhere else. The reason it belongs here is that the column reads as a
   * sequence: build a site, find the words, build the blogs, read how they
   * are doing. The report is the result of the two tools below it, so it
   * cannot sit above the research that feeds them or below the dashboard
   * that ends the list. */
  const html = withoutComments(appSidebar('/'));
  const links = [...html.matchAll(/<a href="([^"]+)"/g)].map(m => m[1]);

  const research = links.indexOf('/keyword-research');
  const report = links.indexOf('/blog-report');

  assert.notStrictEqual(research, -1, 'Keyword Research left the sidebar');
  assert.notStrictEqual(report, -1, 'Blog Report is not in the sidebar');
  assert.strictEqual(report, research + 1,
    `Blog Report is at ${report}, Keyword Research at ${research} — not immediately after it`);
});

test('AND IT MARKS ITSELF WHEN YOU ARE ON IT', () => {
  /* Every other item does. One that does not leaves the whole column
   * looking unselected on its own page, which reads as "you are nowhere". */
  const html = appSidebar('/blog-report');
  const link = html.match(/<a href="\/blog-report"[\s\S]*?<\/a>/);

  assert.ok(link, 'the Blog Report link is gone');
  assert.ok(/aria-current="page"/.test(link[0]),
    'the Blog Report item is not marked on its own page');
});

test('AND THE URLS UNDERNEATH ARE UNTOUCHED', () => {
  /* THE HALF THAT MAKES THE RENAME SAFE. A rename that also moved the paths
   * would break every bookmark, the plugin's own setup text and Edwin's
   * notes — and would pass every assertion above. */
  const html = appSidebar('/');

  assert.ok(html.includes('href="/blog-sites"'), '/blog-sites moved');
  assert.ok(html.includes('href="/static-blogs"'), '/static-blogs moved');
});

test('NO SCREEN STILL SHOWS A CUSTOMER THE OLD NAMES', () => {
  /* THE WHOLE POINT OF DOING THIS AS ONE JOB. The labels appear in eleven
   * files — a page title, two <h1>s, a dashboard card, two "back to"
   * buttons and a printed line in a script — and a sidebar that says one
   * thing over a heading that says another is worse than either name alone.
   *
   * Comments are excluded: the old names are the codebase's history and
   * belong in its prose. */
  const screens = [
    'utils/appHeader.js',
    'routes/blogSitesRoute.js',
    'routes/blogReportRoute.js',
    'routes/authRoute.js',
    'routes/exportWpThemeRoute.js',
    'routes/pluginDownloadRoute.js',
    'routes/staticBlogsRoute.js',
    'scripts/restore-blog.js',
  ];

  for (const file of screens) {
    const code = codeOnly(file);

    for (const old of ['Blog Automation', 'Static Blogs', 'Static blogs']) {
      assert.ok(!code.includes(old),
        `${file} still shows a customer "${old}"`);
    }
  }
});

test('AND THE NAMES COME FROM ONE PLACE, NOT EIGHT COPIES', () => {
  /* The product has been renamed twice before and each rename left strings
   * behind in files nobody thought to search — the reason APP_NAME lives in
   * pageTitle.js at all. These two are now in the same position: a tool
   * named in eight files is a tool that will be renamed in six of them.
   *
   * ASSERTED BY READING THE SOURCE, because a page that happens to render
   * the right words today is not the same as a page that cannot drift. */
  for (const file of ['utils/appHeader.js', 'routes/blogSitesRoute.js',
                      'routes/authRoute.js', 'routes/exportWpThemeRoute.js',
                      'routes/pluginDownloadRoute.js', 'routes/blogReportRoute.js',
                      'routes/staticBlogsRoute.js']) {
    const code = codeOnly(file);

    /* EITHER CONSTANT COUNTS. utils/appHeader.js stopped importing the
     * TOOL_ names on 17 November — the rows label themselves with NAV_ now
     * — and that is the same property, not a weakening: the strings still
     * live in pageTitle.js and nothing here types them out. */
    assert.ok(/(TOOL|NAV)_(WP|CF)_BLOGS/.test(code),
      `${file} types a tool name out by hand instead of importing it`);
  }
});

test('THE TWO NAMES ARE DIFFERENT, AND NEITHER IS EMPTY', () => {
  /* A guard against the cheapest way to pass everything above: define both
   * constants as '' and every "does not include the old name" assertion is
   * satisfied by a sidebar with no labels at all. */
  assert.ok(TOOL_WP_BLOGS && TOOL_CF_BLOGS, 'a tool name is empty');
  assert.notStrictEqual(TOOL_WP_BLOGS, TOOL_CF_BLOGS,
    'both blog tools are called the same thing');
});

/**
 * The CSS rules in a block of header assets, as { selectors, body }.
 *
 * COMMENTS COME OFF FIRST. Every rule in appHeaderAssets() is introduced by
 * a long comment explaining why it exists, and a brace-splitting parser that
 * does not strip them reads the comment as part of the next selector — which
 * is how the "not a rule on every table" test below once passed on a
 * stylesheet that did exactly that.
 *
 * Crude on purpose: no at-rules or nesting are used here, and a real CSS
 * parser as a test dependency would be a larger thing to trust than the
 * twenty lines it checks.
 */
function rulesIn(css) {
  const style = /<style>([\s\S]*?)<\/style>/.exec(css);
  assert.ok(style, 'the header assets carry no <style> block at all');

  const stripped = style[1].replace(/\/\*[\s\S]*?\*\//g, '');

  return [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({
    selectors: m[1].split(',').map(s => s.trim()).filter(Boolean),
    body: m[2],
  }));
}

test('THE NAVY TABLE PALETTE IS SHARED, NOT COPIED A THIRD TIME', () => {
  /* .table-navy — the look the blog report and the keyword research table
   * already wear, named once so a fourth screen does not get a fourth copy.
   *
   * The blog report's own <style> says it was "lifted from the keyword
   * research table so the two read as one app". That is two copies of the
   * same twelve declarations, and Static Blogs was about to become a third.
   * It lives here because every logged-in page draws this header — the same
   * reasoning written above .btn-outline-success. */
  /* READ AS RULES, NOT SEARCHED AS TEXT — 21 October.
   *
   * This test first asserted /\.table-navy/ against the whole string, and a
   * mutant that renamed the OPENING rule to `.table-nope` SURVIVED it: the
   * two descendant rules below still carry the old name, so the substring
   * was still there while the palette itself had gone. Searching a stylesheet
   * for a word proves the word is present, which is not the claim. */
  const rules = rulesIn(appHeaderAssets());

  const palette = rules.find(r => r.selectors.includes('.table-navy'));
  assert.ok(palette, 'there is no .table-navy rule — the shared palette is gone');

  for (const prop of ['--bs-table-bg', '--bs-table-color',
                      '--bs-table-striped-bg', '--bs-table-hover-bg',
                      '--bs-table-border-color']) {
    assert.ok(palette.body.includes(prop), `.table-navy no longer sets ${prop}`);
  }

  assert.ok(/--bs-table-bg:\s*transparent/.test(palette.body),
    'the table paints its own background again, so it reads as a black box on the navy');

  assert.ok(rules.some(r => r.selectors.includes('.table-navy .rownum')),
    'the row-number column has no styling, so every list numbers itself differently');
});

test('IT IS A CLASS, NOT A RULE ON EVERY TABLE', () => {
  /* THE BUG THIS PREVENTS, and it would have been invisible to me.
   *
   * Blog Automation draws its sites table inside bg-light text-dark — a
   * WHITE card, deliberately. A bare rule on .table here would paint that
   * table's text white on white and delete the page, and nothing in the
   * Static Blogs work would have gone anywhere near it.
   *
   * THIS TEST ALSO SURVIVED ITS OWN MUTANT ONCE. The first version split the
   * stylesheet on braces and skipped any chunk beginning with a comment —
   * and EVERY rule in this file is preceded by one, so it skipped the lot
   * and passed on a stylesheet that styled every table in the app. Comments
   * are stripped before parsing now, in rulesIn(). */
  for (const rule of rulesIn(appHeaderAssets())) {
    for (const selector of rule.selectors) {
      assert.ok(!/^(table|\.table)$/.test(selector),
        `"${selector}" styles every table in the app, including the white card on /blog-sites`);
    }
  }
});

test('Bootstrap CSS is NOT re-included', () => {
  // Both pages that use this already load it; twice is a wasted request.
  assert.ok(!/bootstrap@[\d.]+\/dist\/css/.test(appHeaderAssets()), appHeaderAssets());
});

test('the dropdown JS and the credits script are both loaded', () => {
  const js = appHeaderScripts();
  assert.ok(/bootstrap\.bundle/.test(js), 'the dropdown will not open');
  assert.ok(/currentUserInfo\.js/.test(js), 'credits and Buy Credits will never appear');
});

/* -------------------------------------------------------------------------
 * ONE header, for the whole app
 *
 * There used to be two: this module, and an inline copy in form.html. The
 * test here compared them and failed when they drifted — a warning, not a
 * fix. On 21 September form.html was switched to placeholders, so there is
 * nothing left to compare and nothing left to drift.
 *
 * These tests guard that state: form.html must hold NO header of its own.
 * ---------------------------------------------------------------------- */

test('form.html contains no header markup of its own', () => {
  const src = read('src/views/form.html');
  assert.ok(!/<header[\s>]/.test(src),
    'form.html has an inline <header> again — there are two copies once more');
  assert.ok(src.includes('{{HEADER}}'), 'form.html lost its {{HEADER}} placeholder');
});

test('form.html contains no header styling or scripts of its own', () => {
  // The bare `header` rule is the easy one to miss: it carries the border and
  // drop shadow, and while it lived here the generator's header had them and
  // the other two pages did not.
  const src = withoutComments(read('src/views/form.html'));

  for (const [label, re] of [
    ['the bare header rule',   /(^|\})\s*header\s*\{/m],
    ['.header-background',     /\.header-background\s*\{/],
    ['.padding-right-header',  /\.padding-right-header\s*\{/],
    ['the icon font',          /<link[^>]*bootstrap-icons/],
    ['the dropdown JS',        /<script[^>]*bootstrap\.bundle/],
    ['the credits script',     /<script[^>]*currentUserInfo/],
  ]) {
    assert.ok(!re.test(src), `form.html still declares ${label} itself`);
  }

  assert.ok(src.includes('{{HEADER_ASSETS}}'), 'lost the assets placeholder');
  assert.ok(src.includes('{{HEADER_SCRIPTS}}'), 'lost the scripts placeholder');
});

test('the rendered generator page has exactly one of each header piece', () => {
  // The real check: after substitution, nothing is missing and nothing is
  // doubled. A doubled <style> or a second <header> is invisible in the
  // source and obvious in a browser.
  const html = withoutComments(renderFormPage());
  const count = re => (html.match(re) || []).length;

  for (const [label, re] of [
    ['<header> element',          /<header[\s>]/g],
    ['bootstrap-icons link',      /<link[^>]*bootstrap-icons/g],
    ['bootstrap.bundle script',   /<script[^>]*bootstrap\.bundle/g],
    ['currentUserInfo script',    /<script[^>]*currentUserInfo/g],
    ['.header-background rule',   /\.header-background\s*\{/g],
    ['.padding-right-header rule',/\.padding-right-header\s*\{/g],
    ['bare header rule',          /(^|\})\s*header\s*\{/gm],
    ['logout form',               /action="\/logout"/g],
  ]) {
    assert.strictEqual(count(re), 1, `${label}: found ${count(re)}, expected exactly 1`);
  }
});

test('no placeholder survives into the rendered page', () => {
  assert.deepStrictEqual(renderFormPage().match(/{{[A-Z_]+}}/g), null);
});

test('the route fills every placeholder the page uses', () => {
  // THE HELPER ABOVE IS A COPY of formRoute's substitution list, and a copy
  // goes stale: adding {{SIDEBAR}} to form.html left the page rendering the
  // literal braces in the test while the real route was fine. Checking the
  // page against the ROUTE, rather than against the copy, catches the next
  // one on the day it is added.
  const page = read('src/views/form.html');
  const route = read('routes/formRoute.js');

  const used = new Set((page.match(/{{[A-Z_]+}}/g) || []));

  for (const placeholder of used) {
    const name = placeholder.slice(2, -2);
    assert.ok(
      new RegExp(`\\{\\{${name}\\}\\}`).test(route),
      `form.html uses ${placeholder} and formRoute.js never fills it`
    );
  }

  assert.ok(used.size >= 4, `only ${used.size} placeholders found — did the page change shape?`);
});

test('a placeholder name is never written inside a comment', () => {
  // The substitution is a global regex, so a placeholder MENTIONED in a
  // comment is filled in too. A comment here explaining where the CSS went
  // said "{{HEADER_ASSETS}}" and injected a second copy of the entire header
  // stylesheet into the middle of the <style> block.
  const src = read('src/views/form.html');
  for (const comment of [...src.matchAll(/<!--[\s\S]*?-->/g), ...src.matchAll(/\/\*[\s\S]*?\*\//g)]) {
    assert.ok(
      !/{{[A-Z_]+}}/.test(comment[0]),
      `a comment names a placeholder, which will be substituted:\n        ${comment[0].slice(0, 120)}`
    );
  }
});

test('the logout form on the generator page carries a CSRF token', () => {
  // {{HEADER}} must be filled BEFORE {{CSRF}}: appHeader() puts the token in
  // the logout form itself, so the reverse order leaves the button posting
  // without one and Logout silently fails with "Session expired".
  const html = renderFormPage();
  const form = html.match(/<form action="\/logout"[\s\S]*?<\/form>/);
  assert.ok(form, 'the logout form is gone from the generator page');
  assert.ok(/name="_csrf"/.test(form[0]), `no token in the logout form:\n        ${form[0]}`);
});

test('formRoute fills all three placeholders, header before CSRF', () => {
  const src = jsWithoutComments(read('routes/formRoute.js'));

  for (const placeholder of ['{{HEADER_ASSETS}}', '{{HEADER_SCRIPTS}}', '{{HEADER}}']) {
    assert.ok(
      src.includes(`.replace(/${placeholder}/g`),
      `formRoute.js never fills ${placeholder}`
    );
  }

  // {{HEADER}} must be filled BEFORE {{CSRF}}: appHeader() puts the token into
  // the logout form itself, so the reverse order leaves the button posting
  // without one.
  assert.ok(
    src.indexOf('.replace(/{{HEADER}}/g') < src.indexOf('.replace(/{{CSRF}}/g'),
    '{{CSRF}} is filled before {{HEADER}}, so the logout token is lost'
  );
});

/* -------------------------------------------------------------------------
 * Both pages actually use it
 *
 * appHeader() can be perfect while no page calls it. That is the failure that
 * got through twice this week — anchorType dropped in normaliseTargets, and
 * the service pages dropped at the locationMeta call site.
 * ---------------------------------------------------------------------- */

test('the dashboard renders the header, its assets and its scripts', () => {
  const src = jsWithoutComments(read('routes/authRoute.js'));
  for (const call of ['appHeaderAssets()', 'appHeader(', 'appHeaderScripts()']) {
    assert.ok(src.includes(call), `authRoute.js never calls ${call}`);
  }
  assert.ok(/require\(['"]\.\.\/utils\/appHeader['"]\)/.test(src), 'no require');
});

test('the job progress page renders the header, its assets and its scripts', () => {
  const src = jsWithoutComments(read('routes/jobRoute.js'));
  for (const call of ['appHeaderAssets()', 'appHeader(', 'appHeaderScripts()']) {
    assert.ok(src.includes(call), `jobRoute.js never calls ${call}`);
  }
  assert.ok(/require\(['"]\.\.\/utils\/appHeader['"]\)/.test(src), 'no require');
});

test('the job 404 gets the header too', () => {
  // Reached by an expired or mistyped job id. Without the header its only way
  // out is the single link in the body — the dead end this work exists to fix.
  const src = jsWithoutComments(read('routes/jobRoute.js'));
  const notFound = src.match(/status\(404\)\.send\(`[\s\S]*?`\)/);
  assert.ok(notFound, 'the 404 branch is gone');
  assert.ok(notFound[0].includes('appHeader('), 'the 404 has no header');
});

test('the header is inside <body>, not <head>', () => {
  // A template-literal edit in the wrong place puts markup in <head>, where
  // browsers hoist it and the layout silently breaks.
  for (const file of ['routes/authRoute.js', 'routes/jobRoute.js']) {
    const src = read(file);
    for (const m of src.matchAll(/<head>([\s\S]*?)<\/head>/g)) {
      assert.ok(!/\$\{appHeader\(/.test(m[1]), `${file}: appHeader() is inside <head>`);
    }
  }
});

/* -------------------------------------------------------------------------
 * EVERY logged-in page, and only those
 *
 * The header shows a credit balance and a Logout button, so it belongs on a
 * page only when there is a session. On a signed-out page currentUserInfo.js
 * calls /api/me, gets a 401, and renders "Not logged in" in the chrome —
 * worse than no header at all.
 * ---------------------------------------------------------------------- */

// Behind requireAuth or requireAdmin. Every one of these must have it.
const SIGNED_IN_PAGES = [
  'routes/formRoute.js',            // the generator
  'routes/keywordResearchRoute.js', // /keyword-research
  'routes/authRoute.js',            // /dashboard
  'routes/jobRoute.js',             // /jobs/:id and its 404
  'routes/billingRoute.js',         // /buy-credits, /credits/success, /credits/cancelled
  'routes/adminRoute.js',           // /admin
  'routes/blogSitesRoute.js',       // /blog-sites
  'routes/exportWpThemeRoute.js',   // /download-wp-theme
  'routes/pluginDownloadRoute.js',  // /plugin/download failure page
];

// Reached WITHOUT a session — from a link in an email, or before signing in.
const SIGNED_OUT_PAGES = [
  'routes/passwordRoute.js',        // forgot / reset / resend-verification
  'routes/downloadZipRoute.js',     // no guard on the route
];

test('every signed-in page uses the shared header', () => {
  // If any of these stops requiring appHeader.js, that page has gone back to
  // having no header — or its own — and updating the others leaves it behind.
  for (const file of SIGNED_IN_PAGES) {
    assert.ok(
      /require\(['"]\.\.\/utils\/appHeader['"]\)/.test(jsWithoutComments(read(file))),
      `${file} no longer uses the shared header`
    );
  }
});

test('every signed-in page renders the header, its assets AND its scripts', () => {
  // Forgetting one of the three is the realistic mistake: the markup alone
  // gives an invisible profile icon opening a dead menu with no credits.
  //
  // Two shapes count as rendering them — calling the functions directly, or
  // writing the placeholders that withAppHeader() fills in send().
  for (const file of SIGNED_IN_PAGES) {
    const src = jsWithoutComments(read(file));

    const direct = ['appHeaderAssets()', 'appHeader(', 'appHeaderScripts()']
      .every(call => src.includes(call));

    const viaPlaceholders =
      ['{{HEADER_ASSETS}}', '{{HEADER}}', '{{HEADER_SCRIPTS}}'].every(p => src.includes(p)) &&
      /withAppHeader\(/.test(src);

    assert.ok(direct || viaPlaceholders,
      `${file} is missing one of the three header pieces`);
  }
});

test('signed-out pages do NOT get the header', () => {
  // The header would show a credit balance and a Logout button to someone
  // with no session. currentUserInfo.js would render "Not logged in" into it.
  for (const file of SIGNED_OUT_PAGES) {
    assert.ok(
      !/appHeader/.test(jsWithoutComments(read(file))),
      `${file} renders the logged-in header on a signed-out page`
    );
  }
});

test('login and signup do not get the header', () => {
  // These live in authRoute.js alongside /dashboard, which DOES have it, so
  // the file-level check above cannot tell them apart. renderAuthPage() is
  // the shared shell for signed-out pages and must stay header-free.
  const src = jsWithoutComments(read('utils/renderAuthPage.js'));
  assert.ok(!/appHeader/.test(src),
    'renderAuthPage puts the logged-in header on login/signup');
});

test('no page fills the placeholders without the filler, or vice versa', () => {
  // A page that writes {{HEADER}} but whose send() never calls withAppHeader
  // ships the literal text "{{HEADER}}" to the customer.
  for (const file of SIGNED_IN_PAGES) {
    const src = jsWithoutComments(read(file));
    const writes = src.includes('{{HEADER}}');
    const fills = /withAppHeader\(/.test(src) || /\.replace\(\/\{\{HEADER\}\}/.test(src);

    if (writes) {
      assert.ok(fills, `${file} writes {{HEADER}} but nothing fills it`);
    }
  }
});

test('withAppHeader fills all three and leaves nothing behind', () => {
  const { withAppHeader } = require('./utils/appHeader');
  const res = { locals: { csrfField: CSRF } };
  const page = '<head>{{HEADER_ASSETS}}</head><body>{{HEADER}}<h1>x</h1>{{HEADER_SCRIPTS}}</body>';
  const out = withAppHeader(page, res);

  assert.strictEqual(out.match(/{{[A-Z_]+}}/g), null, 'a placeholder survived');
  assert.strictEqual(withoutComments(out).match(/<header[\s>]/g).length, 1);
  assert.ok(/action="\/logout"[\s\S]*?name="_csrf"/.test(out), 'the logout token is missing');
});

test('withAppHeader survives a missing res rather than throwing', () => {
  // A page that renders before the CSRF middleware, or an error path that
  // hands it something unexpected, must not take the whole page down.
  const { withAppHeader } = require('./utils/appHeader');
  for (const res of [undefined, null, {}, { locals: {} }]) {
    const out = withAppHeader('<body>{{HEADER}}</body>', res);
    assert.ok(out.includes('<header'), `threw or emptied for ${JSON.stringify(res)}`);
    assert.ok(!/undefined|null/.test(out.match(/<form action="\/logout"[\s\S]*?<\/form>/)[0]),
      'undefined or null leaked into the logout form');
  }
});

/* -------------------------------------------------------------------- *
 * The layout the column imposes on the rest of the page
 * -------------------------------------------------------------------- *
 *
 * All of this is CSS, so none of it can be proven correct by a test — only
 * the rules that MUST be present for the layout to hold. Each assertion
 * below stands for something that was visibly wrong on screen.
 */

test('the header is pulled back out of the body padding', () => {
  // The column's space is made with padding-left on the body, and the header
  // lives inside that body — so it was being indented by the same amount,
  // leaving a bite out of the top-left corner where the column met it.
  const { appSidebarAssets } = require('./utils/appHeader');
  const css = appSidebarAssets();

  // NOTE the nested parens: `calc(var(--x) * -1)` closes var() before calc(),
  // so a `[^)]*` between them never reaches the -1. The first version of
  // this test failed against correct CSS for exactly that reason.
  const rule = css.match(/>\s*header\s*\{[^}]*\}/);
  assert.ok(rule, 'there is no rule targeting the header at all');

  assert.ok(/margin-left:\s*calc\(.*-1\s*\)/.test(rule[0]),
    'the header is not pulled back, so the column indents it');
  assert.ok(/width:\s*calc\(100%/.test(rule[0]),
    'the header is pulled left but not widened, so it ends short on the right');
});

test('the column width is named once, not written three times', () => {
  // It is needed by the body padding, the column, and the header's negative
  // margin. Three copies of 232px is three chances to change two of them.
  const { appSidebarAssets } = require('./utils/appHeader');
  const css = appSidebarAssets();

  assert.ok(/--app-sidebar-width:\s*\d/.test(css), 'the width has no name');

  // Comments stripped first. The prose explaining WHY the number is named
  // once mentions the number, which is not a second place it is written —
  // the first version of this test counted those and failed on correct CSS.
  const rules = withoutComments(css);
  const literals = (rules.match(/\b232px\b/g) || []).length;

  assert.strictEqual(literals, 1,
    `232px appears in ${literals} rules; it should be defined once and used by name`);
});

test('the column is fixed, not placed by where its markup sits', () => {
  // ABSOLUTE WAS WRONG TWICE. With no top offset the element keeps its
  // STATIC position — wherever {{SIDEBAR}} happens to fall in that page's
  // markup — so the column started near the top of one wizard step and most
  // of the way down another, and the divider was a floating segment rather
  // than a line down the side of the page.
  const { appSidebarAssets } = require('./utils/appHeader');
  const css = appSidebarAssets();

  const rule = css.match(/\.app-sidebar-shell\s*\{[^}]*\}/);
  assert.ok(rule, 'the column has no rule at all');

  assert.ok(/position:\s*fixed/.test(rule[0]),
    'the column is positioned by its place in the markup again');
  assert.ok(/border-right:/.test(rule[0]), 'the column has no divider');

  // top from the header, bottom to the window: the line runs the full height
  // beside the content and stays there while the page scrolls.
  assert.ok(/top:\s*var\(--app-header-height/.test(rule[0]),
    'the top offset is hard-coded rather than measured');
  assert.ok(/bottom:\s*0/.test(rule[0]));
  assert.ok(/overflow-y:\s*auto/.test(rule[0]),
    'a tools list taller than the window would be cut off with no way to reach it');
});

test('the header height is measured, and the CSS value is only a fallback', () => {
  // Everything about the header is fluid — the logo, Bootstrap's padding,
  // the credits badge arriving after /api/me answers. Any number written
  // into the CSS is right until somebody edits the header.
  const { appSidebarAssets } = require('./utils/appHeader');
  const out = appSidebarAssets();

  assert.ok(/--app-header-height,\s*\d+px/.test(out),
    'there is no fallback for the moment before the script runs');
  assert.ok(/setProperty\(\s*'--app-header-height'/.test(out),
    'nothing ever measures the header');
  assert.ok(/getBoundingClientRect/.test(out));

  // It must survive being in the head, where the header does not exist yet.
  assert.ok(/DOMContentLoaded/.test(out),
    'the script measures before the header exists');

  // And survive a page with no header at all — it ships wherever the sidebar
  // does, and a missing header is not a reason to throw into the page.
  assert.ok(/if\s*\(!header\)\s*return/.test(out),
    'a page without a header would throw');
});

test('the measuring script actually writes the height', () => {
  // RUN, not read. A regex proves the words are present; it proves nothing
  // about whether the thing works, and this suite has already had one test
  // pass against a page that was broken.
  const { appSidebarAssets } = require('./utils/appHeader');
  const script = appSidebarAssets().match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script, 'there is no script');

  const written = {};
  const header = { getBoundingClientRect: () => ({ height: 97.4 }) };

  const doc = {
    readyState: 'complete',
    querySelector: sel => (sel === 'header' ? header : null),
    addEventListener() {},
    documentElement: { style: { setProperty: (k, v) => { written[k] = v; } } },
  };

  new Function('document', 'window', 'ResizeObserver', script[1])(
    doc, { addEventListener() {} }, undefined
  );

  // Rounded, and in px — a fractional value would be written straight into
  // the CSS variable.
  assert.strictEqual(written['--app-header-height'], '97px');
});

test('the measuring script is silent on a page with no header', () => {
  const { appSidebarAssets } = require('./utils/appHeader');
  const script = appSidebarAssets().match(/<script>([\s\S]*?)<\/script>/)[1];

  const doc = {
    readyState: 'complete',
    querySelector: () => null,
    addEventListener() {},
    documentElement: { style: { setProperty() { throw new Error('wrote anyway'); } } },
  };

  // No throw is the whole assertion: this ships on any page that takes the
  // sidebar, and a missing header must not take the page down with it.
  new Function('document', 'window', 'ResizeObserver', script)(
    doc, { addEventListener() {} }, undefined
  );
});

test('a header of zero height is ignored, not written as 0', () => {
  // It measures in the head, before layout on some paths. Writing 0 would
  // pin the column to the top of the window, under the header.
  const { appSidebarAssets } = require('./utils/appHeader');
  const script = appSidebarAssets().match(/<script>([\s\S]*?)<\/script>/)[1];

  const written = {};
  const doc = {
    readyState: 'complete',
    querySelector: () => ({ getBoundingClientRect: () => ({ height: 0 }) }),
    addEventListener() {},
    documentElement: { style: { setProperty: (k, v) => { written[k] = v; } } },
  };

  new Function('document', 'window', 'ResizeObserver', script)(
    doc, { addEventListener() {} }, undefined
  );

  assert.strictEqual(written['--app-header-height'], undefined,
    'a zero height was written, pinning the column under the header');
});

test('it re-measures when the header changes size', () => {
  // The credits badge arrives after /api/me answers, which can make the
  // header taller. A single measurement would be taken before that.
  const { appSidebarAssets } = require('./utils/appHeader');
  const script = appSidebarAssets().match(/<script>([\s\S]*?)<\/script>/)[1];

  let observed = null;
  let height = 84;

  const doc = {
    readyState: 'complete',
    querySelector: () => ({ getBoundingClientRect: () => ({ height }) }),
    addEventListener() {},
    documentElement: { style: { setProperty() {} } },
  };

  function FakeObserver(fn) {
    this.observe = target => { observed = { fn, target }; };
  }

  new Function('document', 'window', 'ResizeObserver', script)(
    doc, { addEventListener() {} }, FakeObserver
  );

  assert.ok(observed, 'the header is measured once and never again');
});

test('the CSS is a template literal and carries no backticks', () => {
  // A backtick in a CSS comment ends the JavaScript string. One did, and the
  // whole module stopped parsing.
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, 'utils/appHeader.js'), 'utf8');

  const sidebar = src.match(/function appSidebarAssets[\s\S]*?\n\}/);
  assert.ok(sidebar, 'appSidebarAssets is gone');

  // Two: the ones opening and closing its own template literal.
  const ticks = (sidebar[0].match(/`/g) || []).length;
  assert.strictEqual(ticks, 2, `${ticks} backticks — a comment has one in it`);
});

/* ───────────────────────────── THE ADMIN MENU ─────────────────────────────
 *
 * /admin/blog-domains shipped with NOTHING linking to it. Edwin found the
 * page by being told the URL, which is the same failure appSidebar()'s own
 * comment warns about, committed by the person who had just read the warning.
 *
 * The fix was a link in the Admin dropdown. The risk the fix carries is the
 * mirror image: a link rendered for EVERY signed-in user, which is a signpost
 * to a 403 for every customer who clicks it.
 *
 * So both directions are tested, and the admin one is scoped to the dropdown
 * rather than searched for across the whole header — a link emitted just
 * outside the <ul> would satisfy "the href is somewhere in there" while
 * appearing nowhere a person could click.
 */

/**
 * Run currentUserInfo.js as a browser would, for a given role, and return
 * what it puts in #user-actions.
 *
 * The script fills two elements from /api/me and returns silently when either
 * is missing, so both are supplied; `fetch` and `console` are stubbed because
 * the script closes over the globals and there is no DOM here.
 */
async function headerActionsFor(role) {
  const script = read('public/js/currentUserInfo.js');

  let ready = null;
  const info = { textContent: '', innerHTML: '' };
  const actions = { innerHTML: '' };
  const errors = [];

  const doc = {
    addEventListener: (name, fn) => { if (name === 'DOMContentLoaded') ready = fn; },
    getElementById: id =>
      id === 'user-info' ? info : id === 'user-actions' ? actions : null,
  };

  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ email: 'someone@example.com', role, credits: 10 }),
  });

  new Function('document', 'fetch', 'console', script)(
    doc, fakeFetch, { error: (...a) => errors.push(a.join(' ')) }
  );

  assert.ok(ready, 'the script no longer runs on DOMContentLoaded');
  await ready();

  // The script swallows its own exceptions, which would otherwise surface
  // here as an empty header and a confusing assertion failure.
  assert.deepStrictEqual(errors, [], `the script threw: ${errors.join('; ')}`);

  return actions.innerHTML;
}

/** The Admin dropdown's item list, or null if there is no Admin menu at all. */
const adminMenu = html => (html.match(/<ul class="dropdown-menu[\s\S]*?<\/ul>/) || [null])[0];

testAsync('AN ADMIN IS OFFERED BLOG DOMAINS, INSIDE THE ADMIN MENU', async () => {
  const menu = adminMenu(await headerActionsFor('admin'));

  assert.ok(menu, 'there is no Admin dropdown');
  assert.ok(menu.includes('href="/admin/blog-domains"'),
    'Blog domains is not an item in the Admin menu');
  assert.ok(menu.includes('href="/admin"'),
    'User management went missing from the Admin menu');
});

testAsync('AND SO IS A SUPERADMIN', async () => {
  // Two roles reach the same branch. A check narrowed to one of them would
  // lock Edwin's own account out of the page it exists for.
  const menu = adminMenu(await headerActionsFor('superadmin'));

  assert.ok(menu && menu.includes('href="/admin/blog-domains"'),
    'a superadmin is not offered Blog domains');
});

testAsync('A CUSTOMER IS OFFERED NONE OF IT', async () => {
  /* THE HALF THAT IS EASY TO GET WRONG. Moving the <li> one line up, out of
   * the `if (isAdmin)` block, still satisfies the test above — the link is
   * there, it is in a <ul>, an admin can click it. It just also renders for
   * every customer, pointing at a page that answers 403.
   *
   * requireAdmin on the route is the real gate and is tested elsewhere. This
   * is about not offering people a door that is locked. */
  const html = await headerActionsFor('user');

  assert.ok(!html.includes('/admin/blog-domains'),
    'a customer is shown the Blog domains link');
  assert.ok(!html.includes('/admin"'),
    'a customer is shown the User management link');
  assert.ok(html.includes('/buy-credits'),
    'the customer header lost Buy Credits — the stub is wrong, not the code');
});

Promise.all(pending).then(() => {
  console.log('');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('');
  process.exit(failed === 0 ? 0 : 1);
});
