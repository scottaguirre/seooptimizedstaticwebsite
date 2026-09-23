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
const {
  appHeader, appHeaderAssets, appHeaderScripts, appSidebar, appSidebarAssets,
} = require('./utils/appHeader');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
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
  const html = withoutComments(appSidebar('/dashboard'));
  assert.ok(/<a href="\/"[\s\S]*?Build a Website[\s\S]*?<\/a>/.test(html),
    'the "Build a Website" link is gone from the sidebar too');
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

test('the header supplies its own colour, so both headers look the same', () => {
  // .header-background lives in form.html's inline <style>. Without it the
  // header falls back to Bootstrap's bg-dark — nearly black, against the navy
  // the rest of the app uses.
  const css = appHeaderAssets();
  assert.ok(/\.header-background/.test(css), css);
  assert.ok(/#082d5b/i.test(css), css);
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

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('');
process.exit(failed === 0 ? 0 : 1);
