// test-blog-render.js
//
// One article -> one HTML page.
//
// WHAT IS ACTUALLY AT RISK HERE
//
// Not how it looks. Two things, and both are silent:
//
//   THE ESCAPING. The prose is model output — untrusted text — and the only
//   markup allowed on the page is markup we put there. Get the order wrong
//   (substitute links, then escape) and either the <a> tags come out as
//   visible text, or a paragraph containing a < is treated as markup. The
//   first is obvious. The second is an injection on a page we publish.
//
//   THE DETERMINISM. Cloudflare Direct Upload hashes every file and only
//   uploads the ones it does not have. A renderer that puts the current
//   time, or a locale-formatted date, into the page makes every file
//   different on every deploy — so every page uploads every time, and the
//   one property the deploy design rests on is gone. Nothing on screen
//   would ever show that.
//
//   node test-blog-render.js

const assert = require('assert');

const { postPage, postUrl, formatDate, renderSections } = require('./utils/blog/render/postPage');
const theme = require('./utils/blog/render/theme');

let passed = 0, failed = 0;

const queue = [];
function test(name, fn) {
  queue.push(() => Promise.resolve().then(fn)
    .then(() => { console.log(`  ok    ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }));
}
function section(n) { queue.push(async () => console.log(`\n${n}\n`)); }

/* ------------------------------------------------------------------ fakes */

const BLOG = {
  siteUrl: 'leanderwaterheaters.com',
  business: { name: 'Leander Water Heaters' },
};

function post(over = {}) {
  return Object.assign({
    title: 'Sediment is what makes a heater pop',
    metaDescription: 'That popping sound is water boiling under sediment.',
    slug: 'sediment-water-heater-popping',
    sections: [
      { heading: null, paragraphs: ['It is boiling, not exploding.'] },
      { heading: 'What the noise is', paragraphs: ['Book a {{money}}water heater repair{{/money}} first.'] },
    ],
  }, over);
}

function render(over = {}, rest = {}) {
  return postPage(Object.assign({
    blog: BLOG,
    post: post(over),
    targets: { money: { url: 'https://example.com/repair/' } },
    publishAt: '2026-11-03T09:00:00Z',
  }, rest));
}

/* ======================================================================= */

section('THE PROSE IS UNTRUSTED, AND IS ESCAPED BEFORE ANYTHING ELSE');

test('A PARAGRAPH CANNOT BECOME MARKUP', async () => {
  /* The whole reason the order is escape-then-substitute. This is model
   * output on a page we publish under a customer's domain. */
  const { html } = render({
    sections: [{ heading: null, paragraphs: ['<script>alert(1)</script> and <img src=x onerror=alert(1)>'] }],
  });

  assert.ok(!html.includes('<script>alert('), 'a script tag from the prose reached the page');
  assert.ok(!html.includes('<img src=x'), 'an image tag from the prose reached the page');
  assert.ok(html.includes('&lt;script&gt;'), 'the text was dropped rather than escaped');
});

test('and neither can a heading', async () => {
  const { html } = render({
    sections: [{ heading: '</h2><script>alert(1)</script>', paragraphs: ['x'] }],
  });

  assert.ok(!html.includes('<script>'), 'a heading broke out of its element');
  assert.ok(html.includes('&lt;/h2&gt;'));
});

test('nor the title, the description or the blog name', async () => {
  const { html } = postPage({
    blog: { siteUrl: 'x.example', business: { name: '"><script>alert(1)</script>' } },
    post: post({ title: '"><b>t</b>', metaDescription: '"><b>d</b>' }),
    targets: {},
    publishAt: '2026-11-03T09:00:00Z',
  });

  assert.ok(!html.includes('<script>'), 'the blog name broke out of an attribute');
  assert.ok(!html.includes('"><b>'), 'a value broke out of an attribute');
});

test('A BARE QUOTE CANNOT END AN ATTRIBUTE EITHER', async () => {
  /* FOUND BY MUTATION. Dropping the &quot; rule alone left every other
   * assertion green, because they all used a quote next to a `<` and the
   * `<` was still being escaped. A quote on its own is enough: it closes
   * content=" and everything after it is parsed as more attributes. */
  const { html } = postPage({
    blog: { siteUrl: 'x.example', business: { name: 'B' } },
    post: post({
      title: 'Quote " onmouseover=alert(1) x="',
      metaDescription: 'Desc " onmouseover=alert(1) x="',
    }),
    targets: {},
    publishAt: '2026-11-03T09:00:00Z',
  });

  /* THE LITERAL QUOTE IS WHAT MATTERS, not the word. "onmouseover" appears
   * on the page legitimately — it is part of the title, escaped, as text.
   * A first version asserted the word was absent and failed against
   * correct code. What must not appear is a RAW quote followed by an
   * attribute, which is the breakout itself.
   *
   * AND THE JSON-LD IS EXCLUDED, for the same reason. Inside that block
   * `\" onmouseover` is a correctly escaped quote within a JSON string,
   * not an HTML attribute — it matched the check and had nothing to do
   * with it. Markup rules apply to markup. */
  const markup = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, '');

  assert.ok(!markup.includes('" onmouseover'),
    'a bare quote ended an attribute and the rest was parsed as more attributes');
  assert.ok(markup.includes('&quot; onmouseover'), 'quotes are not being escaped at all');
});

test('and an ampersand is escaped, so an entity in the prose stays text', async () => {
  /* ALSO FOUND BY MUTATION. Without it, prose containing `&amp;` renders as
   * a literal ampersand and `&lt;` in an article about HTML turns into a
   * visible `<` — the escaping silently undoing itself one layer down. */
  const { html } = render({
    sections: [{ heading: null, paragraphs: ['Write &lt; for less-than, and &amp; for and.'] }],
  });

  assert.ok(html.includes('&amp;lt;'), 'an entity in the prose was rendered rather than shown');
  assert.ok(html.includes('&amp;amp;'));
});

test('BUT THE LINKS WE INSERT ARE REAL LINKS, NOT ESCAPED TEXT', async () => {
  /* The other half of the order. Escape after substituting and the anchor
   * arrives as visible &lt;a href=…&gt; — which is the tell that the two
   * steps have been swapped. */
  const { html, missing } = render();

  assert.ok(html.includes('<a href="https://example.com/repair/">water heater repair</a>'),
    'the money link is not a link');
  assert.ok(!html.includes('&lt;a href'), 'the anchor was escaped into visible text');
  assert.deepStrictEqual(missing, []);
});

test('a link token with no target is unwrapped, never left on the page', async () => {
  /* A reader must never see {{money}}. */
  const { html } = render({}, { targets: {} });

  assert.ok(!html.includes('{{money}}'), 'a raw token reached the page');
  assert.ok(!html.includes('{{/money}}'));
  assert.ok(html.includes('water heater repair'), 'the anchor text was thrown away with the token');
});

test('AND A FORWARD LINK THAT IS NOT DEPLOYED YET IS PROSE, NOT A LINK', async () => {
  /* On WordPress a forward link is pending because the post is dated in the
   * future. On a static blog it is pending because the page does not exist
   * in this deploy at all — and a link to a 404 is worse than no link. */
  const { html } = render({
    sections: [{ heading: null, paragraphs: ['See {{next}}tankless heaters{{/next}} next week.'] }],
  }, { targets: { next: { pendingId: 'slot-3' } } });

  assert.ok(html.includes('<span data-il-link="slot-3">tankless heaters</span>'),
    'a forward link to an undeployed page was written as an anchor');
  assert.ok(!/<a[^>]*>tankless heaters/.test(html));
});

section('THE SAME ARTICLE RENDERS THE SAME BYTES, EVERY TIME');

test('TWO RENDERS OF ONE ARTICLE ARE IDENTICAL', async () => {
  /* Direct Upload hashes each file and skips the ones it already has. A
   * renderer that varies — a timestamp, a random id, a Set iteration —
   * makes every page upload on every deploy, and nothing on screen would
   * ever show it. */
  const a = render().html;
  await new Promise(r => setTimeout(r, 5));
  const b = render().html;

  assert.strictEqual(a, b, 'the same article rendered differently twice');
});

test('AND NOTHING IN IT COMES FROM THE CLOCK', async () => {
  /* Belt and braces over the test above, which would pass if the clock
   * happened not to tick between the two calls. */
  const { html } = render();
  const thisYear = String(new Date().getUTCFullYear());

  assert.ok(!html.includes(thisYear) || '2026' === thisYear,
    'the current year appears on a page whose date is in 2026');
  assert.ok(!/generated|renderedAt|buildTime/i.test(html), 'the page carries a build timestamp');
});

test('the date is written out, not left to the host locale', async () => {
  /* toLocaleDateString reads the machine's ICU data, so a server and a
   * laptop would produce different bytes from one document. */
  const { html } = render();

  assert.ok(html.includes('>3 November 2026<'), `the date is not formatted as expected`);
  assert.ok(html.includes('datetime="2026-11-03"'), 'there is no machine-readable date');
});

test('AND IT IS UTC EVEN WHEN THE SERVER IS NOT', async () => {
  /* FOUND BY MUTATION. getUTCDate() -> getDate() survived, because this
   * container runs on UTC and the two agree. They do not agree anywhere
   * else, and "it passed on my machine" is exactly the shape of that bug.
   *
   * 23:30 UTC on the 3rd is already the 4th at UTC+14. A renderer reading
   * local time would date the article a day late on one host and not
   * another — and the bytes would differ, so every page would re-upload. */
  const before = process.env.TZ;
  try {
    process.env.TZ = 'Pacific/Kiritimati';           // UTC+14
    const late = render({}, { publishAt: '2026-11-03T23:30:00Z' });
    assert.ok(late.html.includes('>3 November 2026<'),
      'the host timezone moved the publication date');
    assert.ok(late.html.includes('datetime="2026-11-03"'));

    process.env.TZ = 'Pacific/Niue';                 // UTC-11
    const early = render({}, { publishAt: '2026-11-03T00:30:00Z' });
    assert.ok(early.html.includes('>3 November 2026<'),
      'the host timezone moved the publication date the other way');

    /* AND THE BYTES MATCH ACROSS TIMEZONES, which is the deploy's
     * problem rather than the reader's: a page that renders differently
     * on two hosts re-uploads on every deploy. */
    process.env.TZ = 'UTC';
    const utc = render({}, { publishAt: '2026-11-03T23:30:00Z' });
    assert.strictEqual(late.html, utc.html, 'the same article rendered differently in two timezones');
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});

test('an article with no date renders without one, rather than Invalid Date', async () => {
  const { html } = render({}, { publishAt: null });

  assert.ok(!/Invalid Date|NaN/.test(html), 'a missing date became visible nonsense');
  assert.ok(!html.includes('<time'), 'an empty time element was emitted');
});

section('WHAT THE PAGE TELLS A SEARCH ENGINE');

test('the canonical, og:url and JSON-LD all name the SAME url', async () => {
  /* Three places, one address. A canonical that disagrees with the page's
   * own URL points somewhere else, which is worse than having none. */
  const { html, url } = render();

  assert.strictEqual(url, 'https://leanderwaterheaters.com/sediment-water-heater-popping/');
  assert.ok(html.includes(`<link rel="canonical" href="${url}">`), 'no canonical');
  assert.ok(html.includes(`<meta property="og:url" content="${url}">`), 'no og:url');
  assert.ok(html.includes(`"mainEntityOfPage":"${url}"`), 'the JSON-LD names a different page');
});

test('AND IT ENDS IN A SLASH, BECAUSE THAT IS WHERE PAGES SERVES IT', async () => {
  /* Cloudflare Pages serves /my-post/ from my-post/index.html. A canonical
   * without the slash names a URL that redirects. */
  assert.ok(postUrl(BLOG, 'my-post').endsWith('/my-post/'));
  assert.ok(postUrl(BLOG, '/my-post/').endsWith('/my-post/'), 'a slug with slashes doubled them');
  assert.ok(!postUrl({ siteUrl: 'x.example/' }, 'p').includes('x.example//'),
    'a trailing slash on the site url doubled up');
});

section('ONE ARTICLE IS THE ROOT, AND THERE IS NO LISTING PAGE');

test('THE HOME ARTICLE IS AT / AND NOT ALSO AT ITS SLUG', async () => {
  /* Edwin, 17 October: "the same blog format, no blog page". The articles
   * are reached by their own URLs and by the ring between them, as on
   * WordPress — but the bare domain still has to answer, so one article is
   * served at the root, the same choice the plugin offers as a checkbox.
   *
   * At `/` AND NOWHERE ELSE. Two addresses for one article is one article
   * competing with itself, and every link in the ring would have to pick
   * one of them. */
  const { html, url } = render({}, { isHome: true });

  assert.strictEqual(url, 'https://leanderwaterheaters.com/');
  assert.ok(!url.includes('sediment'), 'the home article still carries its slug');

  assert.ok(html.includes('<link rel="canonical" href="https://leanderwaterheaters.com/">'),
    'the canonical does not name the root');
  assert.ok(html.includes('"mainEntityOfPage":"https://leanderwaterheaters.com/"'),
    'the JSON-LD names a different address from the canonical');
  assert.ok(html.includes('<meta property="og:url" content="https://leanderwaterheaters.com/">'));
});

test('and every other article keeps its own address', async () => {
  const { url } = render();
  assert.strictEqual(url, 'https://leanderwaterheaters.com/sediment-water-heater-popping/');
});

test('the home article does not link to itself in the masthead', async () => {
  /* A link from a page to the page you are on is noise, and on the root it
   * is the only link in the header. */
  const home = render({}, { isHome: true });
  const other = render();

  const home_ = theme.CLASSES.home;

  assert.ok(!new RegExp(`<a class="${home_}"`).test(home.html), 'the root links to itself');
  assert.ok(home.html.includes(`<span class="${home_}">`), 'the blog name vanished from the root');

  assert.ok(new RegExp(`<a class="${home_}" href="/">`).test(other.html),
    'an ordinary article has no way back to the root');
});

test('the title tag carries the blog name and the h1 does not', async () => {
  const { html } = render();

  assert.ok(html.includes('<title>Sediment is what makes a heater pop — Leander Water Heaters</title>'));
  assert.ok(html.includes('<h1>Sediment is what makes a heater pop</h1>'),
    'the h1 is not the headline on its own');
});

test('THE JSON-LD CLAIMS NOTHING WE DO NOT KNOW', async () => {
  /* An invented author or publisher logo is structured data that has
   * stopped describing the page. An absent field is honest. */
  const { html } = render({ metaDescription: '' });

  const m = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  assert.ok(m, 'there is no JSON-LD');

  const data = JSON.parse(m[1]);
  assert.strictEqual(data['@type'], 'BlogPosting');
  assert.ok(!('author' in data), 'an author was invented');
  assert.ok(!('image' in data), 'an image was invented');
  assert.ok(!('description' in data), 'an empty description was published as a field');
});

test('and the JSON-LD is valid JSON even when the title has quotes in it', async () => {
  const { html } = render({ title: 'He said "it pops" </script>' });

  const m = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  assert.doesNotThrow(() => JSON.parse(m[1]), 'the JSON-LD block does not parse');
});

test('AND A CLOSING TAG WITH A SPACE IN IT CANNOT END THE BLOCK', async () => {
  /* FOUND BY MUTATION, and it is the exploitable one.
   *
   * Escaping `>` alone looks sufficient: `</script>` becomes
   * `</script>`, and after `</script` comes a backslash, which per the
   * HTML spec does not end a script element.
   *
   * `</script >` does. The spec ends the element at `</script` followed by
   * whitespace, `/` or `>` — so with only `>` escaped, the space gets there
   * first and everything after it is live markup. Escaping `<` as well is
   * what closes that, and without this case a mutation removing it passed. */
  for (const title of ['x </script > y', 'x </script/ y', 'x </SCRIPT> y']) {
    const { html } = render({ title });

    const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
    assert.ok(m, `no JSON-LD block for ${JSON.stringify(title)}`);
    assert.doesNotThrow(() => JSON.parse(m[1]),
      `${JSON.stringify(title)} truncated the JSON-LD block`);
    assert.ok(!/<\/script\s/i.test(m[1]), 'a closing tag survived inside the block');
  }
});

section('THE STYLESHEET');

/* --------------------------------------------- the fork, and its guard rails
 *
 * 19 October. Edwin wanted the accent headings and the hairline above each
 * h2 gone from the Cloudflare blogs and KEPT on WordPress. Two looks cannot
 * come out of one file, so the stylesheet was forked and the class names
 * were forked with it: a static blog is .cloudflare-post, a WordPress post
 * is still .ie-post.
 *
 * A fork cannot be made safe, only made visible. These tests are what make
 * it visible. They come in pairs on purpose — one says the static sheet
 * dropped something, the other says the plugin's still has it. Either alone
 * would pass happily while one sheet quietly absorbed the other's decisions.
 */

/** The declarations the static stylesheet makes for one selector. */
function cssRule(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = theme.CSS.match(new RegExp(`(?:^|\\})[^{}]*?(?:^|[\\s,])${esc}\\s*\\{([^}]*)\\}`, 'm'));
  return m ? m[1] : '';
}

/** What the plugin ships, which this file must never be allowed to change. */
function pluginCss() {
  return require('fs').readFileSync(
    require('path').join(__dirname, 'wp-plugin', 'interlink-engine', 'assets', 'blog.css'), 'utf8');
}

test('THE STATIC SHEET IS ITS OWN — NOT ONE .ie- SELECTOR IN IT', async () => {
  /* The sharpest statement of the fork, and the cheapest to check. A rule
   * written here cannot reach a WordPress page if it names nothing a
   * WordPress page has. The day somebody pastes a block back across from
   * blog.css, this is what says so. */
  /* COMMENTS STRIPPED FIRST. The file's own prose explains the fork by
   * naming what the OTHER product uses — "the plugin's copy styles
   * .ie-post" — and that is the most useful sentence in the file. A check
   * that banned it would punish the explanation rather than the mistake.
   * What matters is selectors and custom properties a browser will act on. */
  const live = theme.CSS.replace(/\/\*[\s\S]*?\*\//g, '');

  const strays = (live.match(/\.ie-[a-z-]+/g) || [])
    .concat(live.match(/--ie-[a-z-]+/g) || []);

  assert.deepStrictEqual(strays, [],
    `the static stylesheet still carries plugin selectors: ${strays.join(', ')}`);
});

test('AND EVERY CLASS IT NAMES REACHES BOTH THE SHEET AND THE PAGE', async () => {
  /* The rename's real failure mode is a PARTIAL one: the body class changed
   * and the footer did not, so the page half-renders and nobody notices
   * until a customer looks at it. Swept rather than spot-checked. */
  const { html } = render();

  for (const [role, name] of Object.entries(theme.CLASSES)) {
    assert.ok(name.startsWith('cloudflare-'), `${role} is not a cloudflare- name: ${name}`);
    assert.ok(theme.CSS.includes(`.${name}`), `${role} (.${name}) is styled by nothing`);
    assert.ok(html.includes(`class="${name}"`), `${role} (.${name}) is on no element`);
  }
});

test('AND NO PAGE STILL CARRIES AN ie- CLASS', async () => {
  const { html } = render();
  const left = html.match(/class="[^"]*\bie-[a-z-]+/g) || [];
  assert.deepStrictEqual(left, [], `the page still emits plugin classes: ${left.join(', ')}`);
});

test('THE HEADINGS LOST THEIR COLOUR AND THEIR HAIRLINE', async () => {
  /* What Edwin actually asked for. */
  const h2 = cssRule('.cloudflare-post h2');
  const h3 = cssRule('.cloudflare-post h3');

  assert.ok(!/(^|;)\s*color\s*:/m.test(h2), 'h2 is still coloured');
  assert.ok(!/(^|;)\s*color\s*:/m.test(h3), 'h3 is still coloured');
  assert.ok(!/border-top/.test(h2), 'the hairline above h2 is still drawn');
});

test('BUT WORDPRESS KEEPS BOTH, BECAUSE blog.css WAS NOT TOUCHED', async () => {
  /* THE HALF THAT PROTECTS THE OTHER PRODUCT. Strip the accent out of the
   * plugin's file instead of forking, and every WordPress customer loses
   * their heading colour without anybody asking them. */
  const plugin = pluginCss();

  assert.ok(/\.ie-post h2 \{[^}]*color:\s*var\(--ie-accent\)/.test(plugin),
    'the accent heading colour was removed from the plugin stylesheet');
  assert.ok(/\.ie-post h2 \{[^}]*border-top:\s*1px solid var\(--ie-edge\)/.test(plugin),
    'the hairline was removed from the plugin stylesheet');
  assert.ok(/\.ie-post h3 \{[^}]*color:\s*var\(--ie-accent\)/.test(plugin),
    'the accent h3 colour was removed from the plugin stylesheet');
});

test('AND NOTHING ELSE MOVED — SIZE, SPACING, MEASURE, GUTTER, LINKS', async () => {
  /* "except the center, and paddings and font-size". A fork is the moment
   * where unrelated drift is easiest to smuggle in, so the values Edwin
   * said to leave alone are pinned to the numbers the plugin uses. */
  const h2 = cssRule('.cloudflare-post h2');
  const post = cssRule('.cloudflare-post');

  assert.ok(/font-size:\s*1\.62em/.test(h2), 'the h2 size changed');
  assert.ok(/padding-top:\s*1\.6em/.test(h2), 'the padding above h2 was dropped with the line');
  assert.ok(/margin:\s*2\.4em 0 0\.55em/.test(h2), 'the h2 margins changed');
  assert.ok(/letter-spacing:\s*-0\.012em/.test(h2), 'the h2 letter-spacing changed');

  assert.ok(/max-width:\s*78ch/.test(post), 'the article measure changed');
  assert.ok(/font-size:\s*1\.1em/.test(post), 'the article font-size changed');
  assert.ok(/clamp\(1rem, 4vw, 3\.25rem\)/.test(theme.CSS), 'the gutter changed');
  assert.ok(/main \{[^}]*margin:\s*0 auto/.test(theme.CSS), 'the centred column went missing');

  /* The accent survives where it still belongs. With the headings plain it
   * is the only accent left in the prose, so losing it here would leave a
   * link indistinguishable from body text but for the underline. */
  assert.ok(/color:\s*var\(--cloudflare-accent\)/.test(cssRule('.cloudflare-post a')),
    'links lost the accent too, which was not asked for');
});

test('THE STYLESHEET IS A CONSTANT, NOT A FILE READ PER PAGE', async () => {
  /* It used to read blog.css off disk. A 52-post deploy re-reading it per
   * page was always wasteful; now there is no file to read, and this is
   * what notices if one creeps back in. */
  assert.strictEqual(typeof theme.CSS, 'string');
  assert.ok(theme.CSS.length > 1000, 'the stylesheet is suspiciously short');
  assert.strictEqual(theme.PLUGIN_CSS, undefined,
    'the theme is reading the plugin stylesheet again — the fork has been undone');
});

test('the page links to the stylesheet at the path the theme is served from', async () => {
  const { html } = render();
  assert.ok(html.includes(`href="/${theme.CSS_PATH}"`),
    `the page does not link to /${theme.CSS_PATH}`);
});

test('THE BODY CLASS AND THE ARTICLE WRAPPER ARE NOT SWAPPED', async () => {
  /* Easy to get backwards, and the symptom is a page that looks almost
   * right. The body class declares the gutter and gives the h1 its
   * measure; the post class wraps the article body ONLY. Put the h1 inside
   * the wrapper and `> :first-child` strips the space under the title
   * instead of under the article's opening element. */
  const { html } = render();

  assert.ok(html.includes(`<body class="${theme.CLASSES.body}">`),
    `the body does not carry .${theme.CLASSES.body}`);

  const h1At = html.indexOf('<h1>');
  const wrapAt = html.indexOf(`<div class="${theme.CLASSES.post}">`);

  assert.ok(wrapAt > -1, `there is no .${theme.CLASSES.post} wrapper`);
  assert.ok(h1At < wrapAt,
    `the h1 is inside .${theme.CLASSES.post} — it must be a sibling, as on WordPress`);
});

section('ODDLY SHAPED ARTICLES');

test('an empty paragraph is dropped rather than printed', async () => {
  const { html } = render({
    sections: [{ heading: null, paragraphs: ['Real.', '', '   ', 'Also real.'] }],
  });

  assert.ok(!html.includes('<p></p>'), 'an empty paragraph was printed');
  assert.ok(!/<p>\s*<\/p>/.test(html), 'a whitespace-only paragraph was printed');
});

test('a section with no heading prints no h2', async () => {
  const { html } = render({ sections: [{ heading: null, paragraphs: ['Only prose.'] }] });
  assert.ok(!html.includes('<h2>'), 'an empty heading element was printed');
});

test('and an article with no sections at all still produces a page', async () => {
  const { html } = render({ sections: [] });

  assert.ok(html.startsWith('<!DOCTYPE html>'), 'the page is not a document');
  assert.ok(html.includes('</html>'), 'the page is truncated');
  assert.ok(html.includes('<h1>'), 'the title is missing');
});

test('renderSections reports a token it could not place', async () => {
  /* Not fatal — a post missing its money link is worth less, and refusing
   * to publish it wastes a credit already spent. The same call the plugin
   * makes. But it has to be reported so it can be logged. */
  const out = renderSections([{ heading: null, paragraphs: ['No tokens here.'] }],
    { money: { url: 'https://example.com/' } });

  assert.deepStrictEqual(out.missing, ['money'], 'a dropped link token was not reported');
});

test('formatDate refuses rubbish instead of printing it', async () => {
  assert.strictEqual(formatDate(null), null);
  assert.strictEqual(formatDate(''), null);
  assert.strictEqual(formatDate('not a date'), null);
  assert.strictEqual(formatDate('2026-11-03T09:00:00Z').human, '3 November 2026');
  assert.strictEqual(formatDate(new Date('2026-01-01T00:00:00Z')).human, '1 January 2026');
});

/* ======================================================================= */

section('WHICH ARTICLES ARE ON THE SITE, AND WHAT THEY LINK TO');

const { renderPlan, isLive, homeOf, liveArticles } = require('./utils/blog/render/interlinks');

const CAMPAIGN_ID = 'c1';

function campaign(over = {}) {
  return Object.assign({
    _id: CAMPAIGN_ID,
    isPillar: false,
    targetPage: { url: 'https://money.example/repair/' },
    slots: [
      { index: 0, status: 'published', publishAt: '2026-11-01T09:00:00Z' },
      { index: 1, status: 'published', publishAt: '2026-11-08T09:00:00Z' },
      { index: 2, status: 'ready', publishAt: '2026-11-15T09:00:00Z' },
    ],
  }, over);
}

const POSTS = [
  { campaign: CAMPAIGN_ID, slotIndex: 0, slug: 'first' },
  { campaign: CAMPAIGN_ID, slotIndex: 1, slug: 'second' },
  { campaign: CAMPAIGN_ID, slotIndex: 2, slug: 'third' },
];

/** One campaign's worth, which is what most of these cases are about. */
function plan(on, over = {}, posts = POSTS, blog = BLOG) {
  return renderPlan({ blog, campaigns: [campaign(over)], posts, now: new Date(on) });
}

test('ONLY ARTICLES WHOSE DATE HAS ARRIVED ARE ON THE SITE', async () => {
  /* The ruling of 17 October: scheduled means written and dated but not
   * yet put on the site. The alternative — deploying all twelve at once
   * and hiding the future ones with script — shows Google twelve pages on
   * day one, which is the opposite of posting weekly. */
  assert.deepStrictEqual(plan('2026-11-01T10:00:00Z').map(p => p.index), [0]);
  assert.deepStrictEqual(plan('2026-11-09T10:00:00Z').map(p => p.index), [0, 1]);
  assert.deepStrictEqual(plan('2026-11-20T10:00:00Z').map(p => p.index), [0, 1, 2]);
});

test('AND BEING WRITTEN IS THE OTHER HALF OF IT', async () => {
  /* A date that has passed is not enough. An article that failed to write
   * has nothing to deploy, and a slot with no post at all is a batch that
   * has not run. Either way there is no page. */
  const noPost = plan('2026-11-20T10:00:00Z', {}, [POSTS[0], POSTS[2]]);
  assert.deepStrictEqual(noPost.map(p => p.index), [0, 2], 'an unwritten slot was deployed');

  const failed = plan('2026-11-20T10:00:00Z', {
    slots: campaign().slots.map(s => (1 === s.index ? { ...s, status: 'failed' } : s)),
  });
  assert.deepStrictEqual(failed.map(p => p.index), [0, 2], 'a failed slot was deployed');
});

test('the boundary is inclusive — an article is live on its own date', async () => {
  assert.deepStrictEqual(plan('2026-11-01T09:00:00Z').map(p => p.index), [0]);
  assert.deepStrictEqual(plan('2026-11-01T08:59:59Z').map(p => p.index), [],
    'an article went out a second early');
});

test('A LINK TO AN ARTICLE THAT IS NOT DEPLOYED IS PROSE, NOT A 404', async () => {
  const [first] = plan('2026-11-01T10:00:00Z');

  assert.deepStrictEqual(first.targets.next, { pendingId: 'slot-1' },
    'the forward link points at a page that does not exist yet');
  assert.ok(!first.targets.next.url, 'an undeployed article was linked by url');
});

test('and it becomes a real link once that article goes out', async () => {
  const [first] = plan('2026-11-09T10:00:00Z');

  assert.deepStrictEqual(first.targets.next, { url: '/second/' },
    'the link did not come good when its target was deployed');
});

test('THE RING CLOSES, AND THE LAST ARTICLE LINKS BACK TO THE FIRST', async () => {
  const all = plan('2026-11-20T10:00:00Z');
  const last = all[all.length - 1];

  assert.strictEqual(last.targets.next.url, '/', 'the ring does not close');
  assert.strictEqual(last.targets.prev.url, '/second/');
});

test('A RING OF TWO IS A PAIR, WITH ONE LINK EACH', async () => {
  /* The case that cost Edwin a campaign: the general rule gives post 1 a
   * prev of post 0 AND a next of post 0 — two links, one destination, both
   * in the same article. ringNeighbours() spells the pair out, and this
   * file must not route around it. */
  const two = plan('2026-11-20T10:00:00Z', {
    slots: campaign().slots.slice(0, 2),
  }, POSTS.slice(0, 2));

  assert.strictEqual(two.length, 2);

  assert.ok(two[0].targets.next, 'the first of a pair has no forward link');
  assert.ok(!two[0].targets.prev, 'the first of a pair was given a backward link');

  assert.ok(two[1].targets.prev, 'the second of a pair has no backward link');
  assert.ok(!two[1].targets.next, 'the second of a pair links back to the first twice');
});

test('a single article has neither neighbour', async () => {
  const one = plan('2026-11-20T10:00:00Z', { slots: campaign().slots.slice(0, 1) }, [POSTS[0]]);

  assert.strictEqual(one.length, 1);
  assert.ok(!one[0].targets.prev && !one[0].targets.next, 'a lone article links to itself');
  assert.ok(one[0].targets.money, 'a lone article lost its money link too');
});

test('THE MONEY LINK IS ON EVERY ARTICLE, AND ABSENT ON A PILLAR CAMPAIGN', async () => {
  /* Read from the flag, never inferred from a missing target page. An
   * ordinary campaign whose targetPage went missing is a bug, and treating
   * the absence as intent drops a third of the links silently. */
  for (const page of plan('2026-11-20T10:00:00Z')) {
    assert.strictEqual(page.targets.money.url, 'https://money.example/repair/',
      `slot ${page.index} has no money link`);
  }

  const pillar = plan('2026-11-20T10:00:00Z', { isPillar: true });
  for (const page of pillar) {
    assert.ok(!page.targets.money, `a pillar article was given a money link`);
    assert.ok(page.targets.prev || page.targets.next, 'a pillar article has no links at all');
  }
});

test('THE HOME ARTICLE IS AT / EVERYWHERE, INCLUDING IN OTHER ARTICLES LINKS', async () => {
  /* One address for one article. If the ring linked to /first/ while the
   * canonical said /, the two would compete and every internal link would
   * point at the loser. */
  const all = plan('2026-11-20T10:00:00Z');

  assert.strictEqual(all[0].url, 'https://leanderwaterheaters.com/');
  assert.ok(all[0].isHome);

  const linksToHome = all[all.length - 1].targets.next.url;
  assert.strictEqual(linksToHome, '/',
    'another article links to the home page by its slug');

  assert.ok(!JSON.stringify(all).includes('/first/'),
    "the home article's slug appears somewhere as a url");
});

test('THE BLOG CHOOSES, NOT THE CAMPAIGN', async () => {
  /* The whole reason homeSlug lives on BlogSite. A blog can have a
   * campaign in November and another in March; a per-campaign flag would
   * let both claim the root with nothing to decide between them — you
   * would tick the box on the second and watch nothing happen. */
  const chosen = plan('2026-11-20T10:00:00Z', {}, POSTS,
    { ...BLOG, homeSlug: 'third' });

  const home = chosen.find(p => p.isHome);
  assert.strictEqual(home.post.slug, 'third', 'the blog\'s choice was ignored');
  assert.strictEqual(home.url, 'https://leanderwaterheaters.com/');

  assert.strictEqual(chosen[0].url, 'https://leanderwaterheaters.com/first/',
    'the article that was not chosen is still at the root');
});

test('AND IT WORKS ACROSS CAMPAIGNS, WHICH IS WHY IT HAD TO MOVE', async () => {
  const november = campaign();
  const march = campaign({
    _id: 'c2',
    targetPage: { url: 'https://money.example/other/' },
    slots: [
      { index: 0, status: 'published', publishAt: '2027-03-01T09:00:00Z' },
      { index: 1, status: 'published', publishAt: '2027-03-08T09:00:00Z' },
    ],
  });

  const posts = POSTS.concat([
    { campaign: 'c2', slotIndex: 0, slug: 'march-one' },
    { campaign: 'c2', slotIndex: 1, slug: 'march-two' },
  ]);

  const all = renderPlan({
    blog: { ...BLOG, homeSlug: 'march-two' },
    campaigns: [november, march],
    posts,
    now: new Date('2027-04-01T00:00:00Z'),
  });

  assert.strictEqual(all.length, 5, 'articles from one of the campaigns went missing');
  assert.strictEqual(all.filter(p => p.isHome).length, 1, 'two articles claim the root');
  assert.strictEqual(all.find(p => p.isHome).post.slug, 'march-two');

  /* THE RINGS STAY SEPARATE. A campaign is the thing whose articles were
   * planned to link to each other; the blog is the thing with a front
   * page. Mixing those up would link November's last article into March. */
  const nov = all.filter(p => p.campaign._id === CAMPAIGN_ID);
  const mar = all.filter(p => p.campaign._id === 'c2');

  assert.ok(!JSON.stringify(nov.map(p => p.targets)).includes('march-'),
    "a November article links into March's ring");
  assert.strictEqual(mar[0].targets.money.url, 'https://money.example/other/',
    'the second campaign got the first campaign\'s money page');
});

test('A SLOT NUMBER MEANS NOTHING WITHOUT ITS CAMPAIGN', async () => {
  /* FOUND BY MUTATION. Every campaign has a slot 0, so an article is
   * identified by the PAIR. A lookup that fell back to the slot number
   * alone survived every other case, because the fixtures always had both
   * campaigns fully written and the fallback never fired.
   *
   * When it does fire, campaign B's unwritten slot 0 renders campaign A's
   * article — at B's address, inside B's ring, with B's money link. The
   * reader gets a page that was never written for it and nothing errors. */
  const a = campaign({ _id: 'c-a', slots: [{ index: 0, status: 'published', publishAt: '2026-11-01T09:00:00Z' }] });
  const b = campaign({ _id: 'c-b', slots: [{ index: 0, status: 'published', publishAt: '2026-11-02T09:00:00Z' }] });

  // Only campaign A was written. B's batch has not run.
  const posts = [{ campaign: 'c-a', slotIndex: 0, slug: 'alpha' }];

  const all = renderPlan({
    blog: BLOG, campaigns: [a, b], posts, now: new Date('2026-12-01T00:00:00Z'),
  });

  assert.strictEqual(all.length, 1, "an unwritten slot borrowed another campaign's article");
  assert.strictEqual(all[0].campaign._id, 'c-a');
  assert.strictEqual(all[0].post.slug, 'alpha');
});

test('TWO ARTICLES ON THE SAME DAY STILL PICK THE SAME ROOT EVERY TIME', async () => {
  /* FOUND BY MUTATION. A tie that broke on nothing stable survived every
   * other case here, because no fixture had two articles sharing a date.
   * Real blogs do: a gap of zero days, or two campaigns scheduled the same
   * morning. If the order of equals came from Mongo's result order, the
   * root would move between two deploys of identical content — and with it
   * the address of the blog's front page. */
  const same = '2026-11-01T09:00:00Z';

  const a = campaign({
    _id: 'c-a',
    slots: [{ index: 0, status: 'published', publishAt: same }],
  });
  const b = campaign({
    _id: 'c-b',
    slots: [{ index: 0, status: 'published', publishAt: same }],
  });

  const posts = [
    { campaign: 'c-a', slotIndex: 0, slug: 'alpha' },
    { campaign: 'c-b', slotIndex: 0, slug: 'beta' },
  ];

  const forwards = renderPlan({
    blog: BLOG, campaigns: [a, b], posts, now: new Date('2026-12-01T00:00:00Z'),
  });

  /* THE CAMPAIGNS ARRIVE THE OTHER WAY ROUND, which is the whole point —
   * Mongo makes no promise about the order of two documents that sort
   * equal, and nor does the caller. */
  const backwards = renderPlan({
    blog: BLOG, campaigns: [b, a], posts, now: new Date('2026-12-01T00:00:00Z'),
  });

  assert.strictEqual(forwards.find(p => p.isHome).post.slug,
    backwards.find(p => p.isHome).post.slug,
    'the root changed when the campaigns came back in a different order');

  assert.deepStrictEqual(forwards.map(p => p.url), backwards.map(p => p.url),
    'the same articles produced different addresses');
});

test('with nothing chosen, the OLDEST live article is the root', async () => {
  /* Oldest rather than newest, so the front door stays put. Newest-first
   * would move `/` to a different article every time one published, and
   * every old link to the root would then point at something else. */
  const all = plan('2026-11-20T10:00:00Z');

  assert.strictEqual(all[0].post.slug, 'first');
  assert.ok(all[0].isHome, 'nothing is serving the root');
  assert.strictEqual(all.filter(p => p.isHome).length, 1);
});

test('AND A STALE CHOICE DOES NOT LEAVE / EMPTY', async () => {
  /* homeSlug naming an article that was deleted, or one whose date has
   * not arrived, must not take the root down with it. The root is the one
   * page that always has to answer. */
  for (const slug of ['deleted-long-ago', 'third']) {
    const all = plan('2026-11-09T10:00:00Z', {}, POSTS, { ...BLOG, homeSlug: slug });

    assert.strictEqual(all.filter(p => p.isHome).length, 1,
      `nothing serves the root when homeSlug is ${JSON.stringify(slug)}`);
    assert.strictEqual(all.find(p => p.isHome).post.slug, 'first',
      'the fallback did not pick the oldest live article');
  }
});

test('exactly one article is ever the root', async () => {
  const all = plan('2026-11-20T10:00:00Z');
  assert.strictEqual(all.filter(p => p.isHome).length, 1, 'more than one article claims the root');
  assert.strictEqual(homeOf({ blog: BLOG, articles: [] }), null, 'an empty blog found a root anyway');
});

test('slots arriving out of order still produce the right ring', async () => {
  /* ringNeighbours works on array POSITION, not on the index field. Hand
   * it the array as Mongo happened to return it and post 4's neighbour is
   * whichever document came back next. */
  const shuffled = plan('2026-11-20T10:00:00Z', {
    slots: [campaign().slots[2], campaign().slots[0], campaign().slots[1]],
  });

  assert.deepStrictEqual(shuffled.map(p => p.index), [0, 1, 2], 'the pages came out unsorted');

  /* THE FIRST ARTICLE IS THE ONE THAT TELLS YOU. Checking the middle of a
   * three-article ring passes either way: with the slots shuffled to
   * [2, 0, 1], index 1 still lands on the same neighbours by coincidence,
   * and a mutation that removed the sort survived this test because of it.
   *
   * Index 0 has no previous article — it opens the ring. Build the ring
   * from Mongo's order and it acquires one. */
  const first = shuffled.find(p => p.index === 0);
  assert.ok(!first.targets.prev, 'the first article was given a backward link');
  assert.strictEqual(first.targets.next.url, '/second/',
    'the ring was built from the order the slots arrived in');

  const last = shuffled.find(p => p.index === 2);
  assert.strictEqual(last.targets.next.url, '/',
    'the ring does not close back to the root');
});

test('the plan is the same twice, so a deploy of unchanged articles is unchanged', async () => {
  const a = JSON.stringify(plan('2026-11-20T10:00:00Z'));
  const b = JSON.stringify(plan('2026-11-20T10:00:00Z'));
  assert.strictEqual(a, b);
});

test('isLive refuses a slot with no date rather than treating it as due', async () => {
  assert.strictEqual(isLive({ index: 0, publishAt: null }, { slug: 's' }, new Date()), false);
  assert.strictEqual(isLive({ index: 0, publishAt: 'nonsense' }, { slug: 's' }, new Date()), false);
  assert.strictEqual(isLive({ index: 0, publishAt: '2026-01-01T00:00:00Z' }, { slug: '' }, new Date()), false);
});

test('AND THE PLAN FEEDS postPage WITHOUT TRANSLATION', async () => {
  /* The two halves have to fit: whatever renderPlan puts in `targets` is
   * what applyLinks consumes, and `isHome` is what postPage takes. If they
   * ever drift, the links silently stop appearing — the tokens unwrap to
   * plain text and nothing errors. */
  const [page] = plan('2026-11-09T10:00:00Z');

  const rendered = postPage({
    blog: BLOG,
    post: post({ sections: [
      { heading: null, paragraphs: ['Try {{money}}a repair{{/money}} or read {{next}}the next one{{/next}}.'] },
    ] }),
    targets: page.targets,
    isHome: page.isHome,
    publishAt: '2026-11-01T09:00:00Z',
  });

  assert.ok(rendered.html.includes('<a href="https://money.example/repair/">a repair</a>'),
    'the money link from the plan did not become a link');
  assert.ok(rendered.html.includes('<a href="/second/">the next one</a>'),
    'the forward link from the plan did not become a link');
  assert.deepStrictEqual(rendered.missing, []);
  assert.strictEqual(rendered.url, 'https://leanderwaterheaters.com/');
});

/* ======================================================================= */

section('THE FEEDS');

const feeds = require('./utils/blog/render/feeds');
const sax = require('sax');

/**
 * Parse it as XML, rather than looking at the string.
 *
 * A feed that does not parse is worse than no feed: a reader shows an
 * error and Search Console calls the sitemap broken rather than empty. A
 * substring check cannot tell the difference between well-formed XML and
 * a string that happens to contain the right characters — and the bug
 * this catches is precisely a stray `&` or an unescaped quote.
 */
function parseXml(text) {
  const parser = sax.parser(true, { trim: false });
  const stack = [];
  const root = { name: '#root', children: [], text: '' };
  let current = root;

  parser.onerror = err => { throw err; };
  parser.onopentag = node => {
    const el = { name: node.name, attrs: node.attributes, children: [], text: '' };
    current.children.push(el);
    stack.push(current);
    current = el;
  };
  parser.onclosetag = () => { current = stack.pop(); };
  parser.ontext = t => { current.text += t; };
  parser.oncdata = t => { current.text += t; };

  parser.write(text).close();
  return root;
}

/** Every element with this name, anywhere. */
function all(node, name) {
  const out = [];
  const walk = n => {
    for (const child of n.children) {
      if (child.name === name) out.push(child);
      walk(child);
    }
  };
  walk(node);
  return out;
}

function feedPages(on = '2026-11-20T10:00:00Z') {
  const posts = [
    { campaign: CAMPAIGN_ID, slotIndex: 0, slug: 'first', title: 'First & best', metaDescription: 'A <summary>' },
    { campaign: CAMPAIGN_ID, slotIndex: 1, slug: 'second', title: "O'Brien said \"go\"", metaDescription: 'Second one' },
    { campaign: CAMPAIGN_ID, slotIndex: 2, slug: 'third', title: 'Third', metaDescription: 'Third one' },
  ];
  return renderPlan({ blog: BLOG, campaigns: [campaign()], posts, now: new Date(on) });
}

test('ALL THREE FILES PARSE', async () => {
  const pages = feedPages();
  const files = feeds.feedFiles({ pages, blog: BLOG });

  assert.deepStrictEqual(Object.keys(files).sort(), ['robots.txt', 'rss.xml', 'sitemap.xml']);
  assert.doesNotThrow(() => parseXml(files['sitemap.xml']), 'the sitemap is not valid XML');
  assert.doesNotThrow(() => parseXml(files['rss.xml']), 'the feed is not valid XML');
});

test('AND THEY STILL PARSE WITH AN AMPERSAND AND A QUOTE IN A TITLE', async () => {
  /* The whole reason this file has its own escaper. A bare & in a title
   * is not a content bug, it is a feed that fails to load. */
  const pages = feedPages();
  const rss = feeds.rssXml({ pages, blog: { ...BLOG, business: { name: 'B & "Co"' } } });

  const doc = parseXml(rss);
  const titles = all(doc, 'title').map(t => t.text);

  assert.ok(titles.includes('B & "Co"'), `the channel title came back as ${JSON.stringify(titles)}`);
  assert.ok(titles.includes('First & best'), 'an ampersand in an article title did not survive');
  assert.ok(titles.includes('O\'Brien said "go"'), 'a quote and an apostrophe did not survive');
});

test('THE ESCAPER HANDLES ALL FIVE XML ENTITIES, NOT JUST THE ONES IN USE', async () => {
  /* &#39; is valid XML and &apos; is the name XML defines. Most of HTML's
   * named entities are NOT XML's, which is why this file does not reuse
   * postPage's escaper even though the two look alike.
   *
   * THE QUOTE IS TESTED HERE RATHER THAN THROUGH A FEED, and that is the
   * point. A bare " is legal in element text, so dropping the &quot; rule
   * changes nothing in today's output and a mutation that removed it
   * survived every feed-level assertion. It bites the first time anyone
   * puts a value in an attribute. The escaper's contract is the five
   * entities, so the five are what is pinned. */
  assert.strictEqual(feeds.xml('a & b'), 'a &amp; b');
  assert.strictEqual(feeds.xml('<b>'), '&lt;b&gt;');
  assert.strictEqual(feeds.xml('say "go"'), 'say &quot;go&quot;');
  assert.strictEqual(feeds.xml(`it's`), 'it&apos;s');
  assert.strictEqual(feeds.xml(`&<>"'`), '&amp;&lt;&gt;&quot;&apos;');
});

test('AND NOTHING IS DOUBLE-ESCAPED', async () => {
  /* The & has to be replaced first. Do it last and the & inside &lt;
   * gets escaped again, giving &amp;lt; — which renders as the literal
   * text "&lt;" and reads as a content bug rather than an escaping one. */
  assert.strictEqual(feeds.xml('<b>'), '&lt;b&gt;');
  assert.strictEqual(feeds.xml('&amp;'), '&amp;amp;');

  const doc = parseXml(feeds.rssXml({ pages: feedPages(), blog: BLOG }));
  const descriptions = all(doc, 'description').map(d => d.text);
  assert.ok(descriptions.includes('A <summary>'),
    `a description came back double-escaped: ${JSON.stringify(descriptions)}`);
});

test('the sitemap lists every live page and nothing else', async () => {
  const doc = parseXml(feeds.sitemapXml({ pages: feedPages('2026-11-09T10:00:00Z'), blog: BLOG }));
  const locs = all(doc, 'loc').map(l => l.text);

  assert.deepStrictEqual(locs.sort(), [
    'https://leanderwaterheaters.com/',
    'https://leanderwaterheaters.com/second/',
  ], 'the sitemap does not match what is deployed');
});

test('AND THE HOME ARTICLE APPEARS ONCE, AS THE ROOT', async () => {
  const doc = parseXml(feeds.sitemapXml({ pages: feedPages(), blog: BLOG }));
  const locs = all(doc, 'loc').map(l => l.text);

  assert.strictEqual(locs.filter(l => l === 'https://leanderwaterheaters.com/').length, 1);
  assert.ok(!locs.some(l => l.includes('/first/')),
    'the home article is also listed under its slug');
});

test('NO BUILD DATE ANYWHERE — THE FILES ONLY CHANGE WHEN THE ARTICLES DO', async () => {
  /* lastBuildDate is conventional in RSS and would make all three files
   * different on every deploy, so Direct Upload would re-upload them for
   * ever to say nothing new. */
  const pages = feedPages();
  const files = feeds.feedFiles({ pages, blog: BLOG });

  for (const [name, body] of Object.entries(files)) {
    assert.ok(!/lastBuildDate|generated|generator/i.test(body),
      `${name} carries a build date`);
    assert.ok(!body.includes(String(new Date().getUTCFullYear())) || '2026' === String(new Date().getUTCFullYear()),
      `${name} mentions the current year`);
  }

  await new Promise(r => setTimeout(r, 5));
  const again = feeds.feedFiles({ pages, blog: BLOG });
  assert.deepStrictEqual(again, files, 'the feeds differ between two runs');
});

test('pubDate is RFC 822 in GMT, and not the host locale', async () => {
  assert.strictEqual(feeds.rfc822('2026-11-01T09:00:00Z'), 'Sun, 01 Nov 2026 09:00:00 GMT');
  assert.strictEqual(feeds.rfc822('2026-01-05T23:05:09Z'), 'Mon, 05 Jan 2026 23:05:09 GMT');

  const before = process.env.TZ;
  try {
    process.env.TZ = 'Pacific/Kiritimati';
    assert.strictEqual(feeds.rfc822('2026-11-01T23:30:00Z'), 'Sun, 01 Nov 2026 23:30:00 GMT',
      'the host timezone moved a feed date');
  } finally {
    if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
  }
});

test('and a missing date leaves the element out rather than printing rubbish', async () => {
  assert.strictEqual(feeds.rfc822(null), null);
  assert.strictEqual(feeds.rfc822('nonsense'), null);
  assert.strictEqual(feeds.isoDate(''), null);

  const pages = feedPages().map(p => ({ ...p, slot: { ...p.slot, publishAt: null } }));
  const rss = feeds.rssXml({ pages, blog: BLOG });

  assert.ok(!/Invalid Date|NaN|null/.test(rss), 'a bad date was printed into the feed');
  assert.doesNotThrow(() => parseXml(rss));
});

test('NEWEST FIRST, AND THE CALLER IS LEFT ALONE', async () => {
  const pages = feedPages();
  const order = pages.map(p => p.index);

  const doc = parseXml(feeds.rssXml({ pages, blog: BLOG }));
  const links = all(doc, 'item').map(i => i.children.find(c => 'link' === c.name).text);

  assert.strictEqual(links[0], 'https://leanderwaterheaters.com/third/', 'the feed is oldest first');

  /* A COPY, NOT A SORT IN PLACE. renderPlan returns slot order and the
   * deploy writes files in that order; sorting the caller's array here
   * would quietly reorder the file list too. */
  assert.deepStrictEqual(pages.map(p => p.index), order, 'the page list was reordered');
});

test('robots.txt names the sitemap and allows everything', async () => {
  const txt = feeds.robotsTxt({ blog: BLOG });

  assert.ok(txt.includes('Sitemap: https://leanderwaterheaters.com/sitemap.xml'),
    'nothing points a crawler at the sitemap');
  assert.ok(/Allow: \//.test(txt));
  assert.ok(!/Disallow: \/\S/.test(txt),
    'a Disallow line advertises the path it is trying to hide');
});

section('THE WHOLE BLOG, ASSEMBLED');

const BlogCampaignModel = require('./models/BlogCampaign');
const BlogPostModel = require('./models/BlogPost');
const { publishBlog, renderSite, fileFor } = require('./utils/blog/render/publishBlog');

const CF_BLOG = {
  _id: 'b1',
  target: 'cloudflare',
  siteUrl: 'leanderwaterheaters.com',
  business: { name: 'Leander Water Heaters' },
  homeSlug: '',
};

function installDb(over = {}) {
  const db = Object.assign({
    campaigns: [campaign()],
    posts: [
      { campaign: CAMPAIGN_ID, slotIndex: 0, slug: 'first', title: 'First', metaDescription: 'One',
        sections: [{ heading: null, paragraphs: ['Book a {{money}}repair{{/money}} today.'] }] },
      { campaign: CAMPAIGN_ID, slotIndex: 1, slug: 'second', title: 'Second', metaDescription: 'Two',
        sections: [{ heading: null, paragraphs: ['See {{prev}}the first{{/prev}}.'] }] },
      { campaign: CAMPAIGN_ID, slotIndex: 2, slug: 'third', title: 'Third', metaDescription: 'Three',
        sections: [{ heading: null, paragraphs: ['Not yet.'] }] },
    ],
  }, over);

  BlogCampaignModel.find = (where) => { db.campaignWhere = where; return { lean: async () => db.campaigns }; };
  BlogPostModel.find = (where) => { db.postWhere = where; return { lean: async () => db.posts }; };

  return db;
}

/** A deploy that records what it was handed and never leaves the process. */
function fakeDeploy(answer = { ok: true, url: 'https://x.pages.dev', project: 'p', files: 0 }) {
  const calls = [];
  const deploy = async (opts) => { calls.push(opts); return Object.assign({}, answer, { files: Object.keys(opts.files).length }); };
  deploy.calls = calls;
  return deploy;
}

const AT = new Date('2026-11-09T10:00:00Z');   // slots 0 and 1 are live, 2 is not

test('EVERY LIVE ARTICLE, PLUS THE FEEDS, THE STYLESHEET AND THE BACKUP', async () => {
  installDb();
  const deploy = fakeDeploy();

  const out = await publishBlog({ blog: CF_BLOG, now: AT, deploy });

  assert.strictEqual(out.ok, true, out.error);

  assert.deepStrictEqual(Object.keys(deploy.calls[0].files).sort(), [
    '_data/blog.json',
    'assets/blog.css',
    'index.html',
    'robots.txt',
    'rss.xml',
    'second/index.html',
    'sitemap.xml',
  ], 'the deployed file set is not what a blog is made of');
});

test('AND AN ARTICLE WHOSE DAY HAS NOT COME IS NOT IN IT', async () => {
  installDb();
  const deploy = fakeDeploy();

  await publishBlog({ blog: CF_BLOG, now: AT, deploy });

  const names = Object.keys(deploy.calls[0].files);
  assert.ok(!names.some(n => n.startsWith('third/')),
    'a scheduled article was published early');
});

test('THE WHOLE SITE GOES EVERY TIME, NOT A DIFF', async () => {
  /* A Pages deployment IS the site — whatever is not in it is gone. A
   * deploy of "just the new article" deletes the other eleven. */
  installDb();
  const deploy = fakeDeploy();

  await publishBlog({ blog: CF_BLOG, now: new Date('2027-02-01T00:00:00Z'), deploy });

  const names = Object.keys(deploy.calls[0].files);
  assert.ok(names.includes('index.html'), 'the home page was left out of a later deploy');
  assert.ok(names.includes('second/index.html'), 'an older article was left out');
  assert.ok(names.includes('third/index.html'), 'the newly due article is missing');
});

test('a page lives at its slug, as index.html inside its own directory', async () => {
  /* Cloudflare Pages serves /my-post/ from my-post/index.html, which is
   * the URL postUrl builds and the canonical the page carries. A file at
   * my-post.html would be served at /my-post.html and every link on the
   * site would point somewhere else. */
  assert.strictEqual(fileFor({ isHome: false, post: { slug: 'my-post' } }), 'my-post/index.html');
  assert.strictEqual(fileFor({ isHome: true, post: { slug: 'my-post' } }), 'index.html');
});

test('THE PAGES ARE REAL HTML WITH THEIR LINKS RESOLVED', async () => {
  /* The join between renderPlan and postPage. If the two drifted the
   * tokens would quietly unwrap to plain text and nothing would error. */
  installDb();
  const deploy = fakeDeploy();

  await publishBlog({ blog: CF_BLOG, now: AT, deploy });

  const home = deploy.calls[0].files['index.html'];
  assert.ok(home.startsWith('<!DOCTYPE html>'), 'the home page is not a document');
  assert.ok(home.includes('<a href="https://money.example/repair/">repair</a>'),
    'the money link did not survive the assembly');

  const second = deploy.calls[0].files['second/index.html'];
  assert.ok(second.includes('<a href="/">the first</a>'),
    'the backward link does not point at the root');

  /* THE WHOLE POINT OF THE RELATIVE LINK, PINNED ON THE RENDERED FILE.
   *
   * Edwin, 18 October: every link inside an article went to a 404. He had
   * typed appliancerepaircedarpark.com; Cloudflare was serving the site
   * from appliancerepaircedarpark-com-bx6.pages.dev. Both correct, neither
   * the same place, and every link built from the first one died.
   *
   * So no link a READER clicks may carry the blog's own host. The money
   * link is somebody else's site and keeps its host — asserted above. */
  assert.ok(!/<a href="https:\/\/leanderwaterheaters\.com/.test(second),
    'an internal link carries the blog\'s domain and will 404 anywhere else');
  assert.ok(!/<a href="https:\/\/leanderwaterheaters\.com/.test(home),
    'an internal link on the home page carries the blog\'s domain');

  /* THE HOME PAGE KNOWS IT IS THE HOME PAGE. Found by mutation: not
   * passing isHome still produced a file at index.html — fileFor decides
   * that — but the page inside it claimed to live at /first/. The file and
   * its own canonical would have disagreed, and the canonical wins. */
  assert.ok(home.includes('<link rel="canonical" href="https://leanderwaterheaters.com/">'),
    'the page served at / says its address is somewhere else');
  assert.ok(!home.includes('/first/'), "the home page still carries its slug");

  /* AND IT CARRIES THE SLOT'S DATE. Also found by mutation: without
   * publishAt, postPage falls back to a field these documents do not have
   * and the page renders with no date at all. */
  assert.ok(home.includes('datetime="2026-11-01"'),
    'the article has no publication date, or the wrong one');
  assert.ok(second.includes('datetime="2026-11-08"'));
});

test('and the sitemap lists exactly what was deployed', async () => {
  installDb();
  const deploy = fakeDeploy();

  await publishBlog({ blog: CF_BLOG, now: AT, deploy });

  const locs = all(parseXml(deploy.calls[0].files['sitemap.xml']), 'loc').map(l => l.text);
  assert.deepStrictEqual(locs.sort(), [
    'https://leanderwaterheaters.com/',
    'https://leanderwaterheaters.com/second/',
  ]);
});

test('THE BACKUP SHIPS WITH IT, AND CARRIES NO SECRETS', async () => {
  /* blogJson is served at a public URL. BlogSite carries `secret` — the
   * HMAC signing key — and `licenceKeyHash` on the same document. */
  installDb();
  const deploy = fakeDeploy();

  await publishBlog({
    blog: { ...CF_BLOG, secret: 'the-signing-key', licenceKeyHash: 'abc123' },
    now: AT, deploy,
  });

  const backup = deploy.calls[0].files['_data/blog.json'];
  assert.ok(backup, 'the backup was not deployed');

  assert.doesNotThrow(() => JSON.parse(backup), 'the backup is not valid JSON');
  assert.ok(!backup.includes('the-signing-key'), 'the signing key was published');
  assert.ok(!backup.includes('abc123'), 'the licence key hash was published');

  /* AND IT HAS THE ARTICLES IN IT, which is the entire point.
   *
   * FOUND BY MUTATION: handing blogJson an empty list still produced a
   * valid, secret-free file that shipped on every deploy — and the blog
   * could not have been rebuilt from it. A backup is only a backup if
   * something checks what is inside. */
  const data = JSON.parse(backup);
  const slugs = JSON.stringify(data);

  assert.ok(slugs.includes('first'), 'the backup does not contain the published articles');
  assert.ok(slugs.includes('second'));
  assert.ok(!slugs.includes('third'),
    'the backup contains an article that is not on the site');
});

test('A DRY RUN RENDERS AND SENDS NOTHING', async () => {
  installDb();
  const deploy = fakeDeploy();

  const out = await publishBlog({ blog: CF_BLOG, now: AT, deploy, dryRun: true });

  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.dryRun, true);
  assert.strictEqual(out.files, 7, 'a dry run does not report what it would send');
  assert.strictEqual(deploy.calls.length, 0, 'a dry run deployed');
});

test('nothing due is a refusal, not an empty site', async () => {
  /* Deploying an empty directory would take the blog down. */
  installDb();
  const deploy = fakeDeploy();

  const out = await publishBlog({ blog: CF_BLOG, now: new Date('2020-01-01T00:00:00Z'), deploy });

  assert.strictEqual(out.ok, false);
  assert.strictEqual(deploy.calls.length, 0, 'an empty site was deployed over a live blog');
});

test('AND A WORDPRESS SITE CANNOT BE PUBLISHED THIS WAY', async () => {
  installDb();
  const deploy = fakeDeploy();

  const out = await publishBlog({ blog: { ...CF_BLOG, target: 'wordpress' }, now: AT, deploy });

  assert.strictEqual(out.ok, false);
  assert.strictEqual(deploy.calls.length, 0, 'a WordPress site was deployed to Cloudflare');
});

test('the documents are read for THIS blog only', async () => {
  const db = installDb();
  await publishBlog({ blog: CF_BLOG, now: AT, deploy: fakeDeploy() });

  assert.strictEqual(String(db.campaignWhere.site), 'b1', "another blog's campaigns were loaded");
  assert.strictEqual(String(db.postWhere.site), 'b1', "another blog's articles were loaded");
});

test('A WRITER THAT DROPPED A LINK TOKEN IS REPORTED, NOT REFUSED', async () => {
  /* The post is worth less without its money link. Refusing to publish it
   * wastes a credit already spent — the same call the plugin makes. */
  installDb();
  const deploy = fakeDeploy();

  const out = await publishBlog({ blog: CF_BLOG, now: AT, deploy });

  assert.strictEqual(out.ok, true, 'a dropped token stopped the deploy');
  assert.ok(out.missing.some(m => 'second' === m.slug),
    'a post with no money token was not reported');
  assert.ok(Object.keys(deploy.calls[0].files).includes('second/index.html'),
    'the post was withheld rather than reported');
});

test('and a failed deploy comes back as a failure, with its reason', async () => {
  installDb();
  const deploy = fakeDeploy({ ok: false, error: 'it did not finish', output: 'code 8000007' });

  const out = await publishBlog({ blog: CF_BLOG, now: AT, deploy });

  assert.strictEqual(out.ok, false);
  assert.ok(out.error);
  assert.ok(out.output.includes('8000007'), 'the reason was thrown away');
});

test('RENDERING IS SEPARATE FROM SENDING', async () => {
  /* renderSite takes documents and returns files, with no database and no
   * network — which is what makes a dry run possible and what made the
   * first real deploy checkable by eye. */
  const db = installDb();
  const out = renderSite({ blog: CF_BLOG, campaigns: db.campaigns, posts: db.posts, now: AT });

  assert.strictEqual(Object.keys(out.files).length, 7);
  assert.strictEqual(out.pages.length, 2);
});

/* ======================================================================= */

section('RELATIVE FOR READERS, ABSOLUTE FOR MACHINES');

/* THE OTHER HALF OF THE 18 OCTOBER FIX, AND THE HALF THAT COULD BE
 * BROKEN SILENTLY.
 *
 * Making the in-article links relative is visible the moment you click
 * one. Making the canonical relative would not be: the page would look
 * perfect, and Google would be told the article's address is `/`, which
 * is not an address at all. A sitemap of relative paths is simply
 * invalid. An RSS feed of them points subscribers nowhere.
 *
 * So the rule has two sides and only one of them announces itself when it
 * breaks. Both are pinned here. */

test('THE CANONICAL STILL NAMES THE REAL ADDRESS', async () => {
  const db = installDb();
  const { files } = renderSite({
    blog: CF_BLOG, campaigns: db.campaigns, posts: db.posts, now: AT,
  });

  const second = files['second/index.html'];

  assert.ok(second.includes('<link rel="canonical" href="https://leanderwaterheaters.com/second/">'),
    'the canonical went relative, which tells Google nothing');
  assert.ok(second.includes('https://leanderwaterheaters.com/second/'),
    'og:url and the JSON-LD lost the host too');
});

test('AND SO DOES THE SITEMAP', async () => {
  const db = installDb();
  const { files } = renderSite({
    blog: CF_BLOG, campaigns: db.campaigns, posts: db.posts, now: AT,
  });

  const locs = [...files['sitemap.xml'].matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);

  assert.ok(locs.length, 'the sitemap has no entries at all');
  for (const loc of locs) {
    assert.ok(loc.startsWith('https://leanderwaterheaters.com/'),
      `${loc} is not an absolute address`);
  }
});

test('AND THE FEED', async () => {
  const db = installDb();
  const { files } = renderSite({
    blog: CF_BLOG, campaigns: db.campaigns, posts: db.posts, now: AT,
  });

  const links = [...files['rss.xml'].matchAll(/<link>([^<]+)<\/link>/g)].map(m => m[1]);

  assert.ok(links.length, 'the feed has no links at all');
  for (const link of links) {
    assert.ok(link.startsWith('https://'),
      `${link} is not an absolute address`);
  }
});

section('AN ARTICLE CAN POINT ITS MONEY LINK SOMEWHERE OF ITS OWN');

/* WHY THE OVERRIDE IS ON THE ARTICLE AND NOT THE CAMPAIGN.
 *
 * A campaign is a dozen articles written weeks apart around one page.
 * Most of them should keep pointing at it; one will suit a different one
 * — a specific service, a seasonal offer, a post on the blog itself.
 * Edwin asked for it in those words: "the url each page will link to", on
 * an individual page.
 *
 * THE ANCHOR TEXT IS NOT PART OF THIS. It lives in the prose between
 * {{money}} and {{/money}} because it is part of a sentence, so editing
 * the paragraph edits the anchor and there is no second copy to drift. */

test('THE ARTICLE\'S OWN URL WINS OVER THE CAMPAIGN\'S', async () => {
  const posts = POSTS.map(p => (
    0 === p.slotIndex ? { ...p, targetUrl: 'https://money.example/emergency/' } : p
  ));

  const all = plan('2026-11-20T10:00:00Z', {}, posts);

  assert.strictEqual(all[0].targets.money.url, 'https://money.example/emergency/',
    'the article\'s own target page was ignored');
  assert.strictEqual(all[1].targets.money.url, 'https://money.example/repair/',
    'one article\'s override leaked onto its neighbours');
});

test('AND AN EMPTY ONE MEANS "USE THE CAMPAIGN\'S"', async () => {
  /* Which is what every article nobody has edited holds for ever. It has
   * to be an absence rather than a copy: copy the campaign's URL in at
   * write time and the day somebody fixes a typo on the campaign, twelve
   * articles keep the old one and no screen says why. */
  for (const value of ['', '   ', null, undefined]) {
    const posts = POSTS.map(p => (0 === p.slotIndex ? { ...p, targetUrl: value } : p));
    const [first] = plan('2026-11-20T10:00:00Z', {}, posts);

    assert.strictEqual(first.targets.money.url, 'https://money.example/repair/',
      `${JSON.stringify(value)} was treated as an override`);
  }
});

test('A PILLAR CAMPAIGN STILL HAS NO MONEY LINK, OVERRIDE OR NOT', async () => {
  /* THE ORDER OF THE TWO RULES, AND IT MATTERS. A pillar's articles link
   * to each other and to nothing else. An override on one of them is a
   * setting from a life it no longer has — most likely left behind when
   * an ordinary campaign was turned into a pillar — and it must not
   * quietly undo that for one article out of twelve. */
  const posts = POSTS.map(p => ({ ...p, targetUrl: 'https://money.example/anything/' }));

  const all = plan('2026-11-20T10:00:00Z', { isPillar: true, targetPage: null }, posts);

  assert.strictEqual(all.length, 3, 'nothing was planned, so nothing was checked');
  for (const page of all) {
    assert.ok(!page.targets.money, `${page.post.slug} grew a money link in a pillar campaign`);
  }
});

test('AND THE OVERRIDE IS TRIMMED, SO A PASTED SPACE IS NOT A URL', async () => {
  const posts = POSTS.map(p => (
    0 === p.slotIndex ? { ...p, targetUrl: '  https://money.example/emergency/  ' } : p
  ));

  const [first] = plan('2026-11-20T10:00:00Z', {}, posts);

  assert.strictEqual(first.targets.money.url, 'https://money.example/emergency/');
});

test('AN ARTICLE\'S OWN LINK BECOMES A LINK', async () => {
  /* The fourth token. The other three are placed by the planner and the
   * writer; this one is written into a sentence by hand and pointed at
   * whatever the article names. */
  const posts = POSTS.map(p => (
    0 === p.slotIndex ? { ...p, extraUrl: 'https://somewhere.example/guide/' } : p
  ));

  const all = plan('2026-11-20T10:00:00Z', {}, posts);

  assert.deepStrictEqual(all[0].targets.link, { url: 'https://somewhere.example/guide/' });
  assert.ok(!all[1].targets.link, 'one article\'s own link leaked onto its neighbour');
});

test('AND A PILLAR ARTICLE GETS ONE, WHICH IS THE POINT OF IT', async () => {
  /* A pillar campaign has no money page by design, so its articles carry
   * no {{money}} token and targetUrl has nothing to retarget. Gate this
   * the same way and a pillar is back to having no link it controls —
   * which is the gap Edwin asked about. */
  const posts = POSTS.map(p => ({ ...p, extraUrl: 'https://somewhere.example/guide/' }));

  const all = plan('2026-11-20T10:00:00Z', { isPillar: true, targetPage: null }, posts);

  assert.strictEqual(all.length, 3, 'nothing was planned, so nothing was checked');
  for (const page of all) {
    assert.ok(!page.targets.money, `${page.post.slug} grew a money link in a pillar campaign`);
    assert.deepStrictEqual(page.targets.link, { url: 'https://somewhere.example/guide/' },
      `${page.post.slug} has no link of its own`);
  }
});

test('AND AN EMPTY ONE IS NO LINK AT ALL, NOT A FALLBACK', async () => {
  for (const value of ['', '   ', null, undefined]) {
    const posts = POSTS.map(p => (0 === p.slotIndex ? { ...p, extraUrl: value } : p));
    const [first] = plan('2026-11-20T10:00:00Z', {}, posts);

    assert.ok(!first.targets.link, `${JSON.stringify(value)} became a link`);
  }
});

test('THE TOKEN REACHES THE PAGE AS AN ANCHOR, AND UNWRAPS WITHOUT A URL', async () => {
  /* THE HALF THAT MATTERS TO A READER. A token with no target must not
   * reach the page as literal {{link}} text — applyLinks unwraps it, and
   * this is the assertion that keeps that true for the new name. */
  const withUrl = render({
    sections: [{ heading: null, paragraphs: ['Read {{link}}the full guide{{/link}} first.'] }],
  }, { targets: { link: { url: 'https://somewhere.example/guide/' } } });

  assert.ok(withUrl.html.includes('<a href="https://somewhere.example/guide/">the full guide</a>'),
    'the token did not become a link');

  const without = render({
    sections: [{ heading: null, paragraphs: ['Read {{link}}the full guide{{/link}} first.'] }],
  }, { targets: {} });

  /* The page has anchors of its own — the brand name in the header and in
   * the footer both point home — so "no <a> anywhere" is the wrong test.
   * What matters is that THESE words came through as prose and nothing
   * wrapped them. */
  assert.ok(without.html.includes('<p>Read the full guide first.</p>'),
    'the words did not survive as plain prose');
  assert.ok(!without.html.includes('{{link}}'), 'a raw token reached the page');
  assert.ok(!without.html.includes('>the full guide</a>'), 'it linked to nothing, yet became a link');
});

test('THE MONEY LINK KEEPS ITS HOST', async () => {
  /* It is on somebody else's site. A relative money link would point at a
   * page on the blog that does not exist — turning the one link the
   * campaign is actually for into a 404. */
  const [first] = plan('2026-11-09T10:00:00Z');

  assert.strictEqual(first.targets.money.url, 'https://money.example/repair/');
});

test('AND A PATH IS WHAT THE RING GETS, FOR EVERY ARTICLE', async () => {
  /* Swept rather than spot-checked: a fix applied to prev and forgotten
   * on next would pass any single assertion above. */
  const all = plan('2026-11-20T10:00:00Z');

  assert.strictEqual(all.length, 3, 'nothing was planned, so nothing was checked');

  for (const page of all) {
    for (const name of ['prev', 'next']) {
      const target = page.targets[name];
      if (!target || !target.url) continue;

      assert.ok(target.url.startsWith('/'),
        `${page.post.slug}: ${name} is ${target.url}, not a path`);
      assert.ok(!target.url.includes('leanderwaterheaters.com'),
        `${page.post.slug}: ${name} still carries the blog's domain`);
    }
  }
});

/* ======================================================================= */

section('PUBLISHING EVERYTHING, DATES IGNORED');

/* WHY THIS EXISTS, AND WHY IT IS NOT A LIE ABOUT `now`.
 *
 * A brand-new blog has three articles written and every one of them dated
 * in the future, so the only two buttons on the screen both refuse. That
 * is correct behaviour and it is a terrible first experience: Edwin
 * approved a campaign, paid for it, and had no way to see a single page.
 *
 * The tempting shortcut is to pass a `now` far in the future. It would
 * work and it would be wrong: `now` reaches postPage and feeds.js as well,
 * so the pages would be rendered as if it were 2099. The override has to
 * be its own flag, read in exactly one place — isLive — and nowhere else.
 *
 * WHAT IT MUST NOT RESCUE. Only the date gate is lifted. An article that
 * failed to write, one with no post, and one with no usable date are still
 * off the site: the first two have nothing to publish, and the third would
 * sort on NaN and make the front page a coin toss between two deploys. */

/** The same one-campaign helper, with the override on. */
function planAll(on, over = {}, posts = POSTS, blog = BLOG) {
  return renderPlan({
    blog, campaigns: [campaign(over)], posts,
    now: new Date(on), includeScheduled: true,
  });
}

test('THE OVERRIDE PUTS EVERY WRITTEN ARTICLE ON THE SITE', async () => {
  /* Before any of the three dates. Without the flag this is empty, which
   * is the exact screen that sent Edwin looking for a bug. */
  assert.deepStrictEqual(plan('2026-10-01T10:00:00Z').map(p => p.index), []);
  assert.deepStrictEqual(planAll('2026-10-01T10:00:00Z').map(p => p.index), [0, 1, 2]);
});

test('AND LEAVES THE DEFAULT ALONE', async () => {
  /* THE MUTATION GUARD. A flag defaulting to true, or read with a loose
   * test instead of a strict one, turns the scheduled drip into a batch
   * dump on every ordinary deploy — and nothing on screen would say so. */
  assert.deepStrictEqual(plan('2026-11-09T10:00:00Z').map(p => p.index), [0, 1]);

  const explicit = renderPlan({
    blog: BLOG, campaigns: [campaign()], posts: POSTS,
    now: new Date('2026-11-09T10:00:00Z'), includeScheduled: false,
  });
  assert.deepStrictEqual(explicit.map(p => p.index), [0, 1]);
});

test('IT DOES NOT RESCUE A SLOT THAT FAILED TO WRITE', async () => {
  /* There is no prose to publish. The override is about dates and about
   * nothing else. */
  const out = planAll('2026-10-01T10:00:00Z', {
    slots: [
      { index: 0, status: 'published', publishAt: '2026-11-01T09:00:00Z' },
      { index: 1, status: 'failed', publishAt: '2026-11-08T09:00:00Z' },
    ],
  });

  assert.deepStrictEqual(out.map(p => p.index), [0]);
});

test('IT DOES NOT RESCUE A SLOT WITH NO ARTICLE', async () => {
  const out = planAll('2026-10-01T10:00:00Z', {}, [POSTS[0], POSTS[2]]);
  assert.deepStrictEqual(out.map(p => p.index), [0, 2]);
});

test('IT DOES NOT RESCUE A SLOT WITH NO USABLE DATE', async () => {
  /* NOT PEDANTRY. liveArticles sorts on publishAt, so a slot admitted
   * without one sorts on NaN — and the comparator then returns false for
   * every test, leaving the order to whatever Mongo happened to hand back.
   * The front page is the oldest article, so two deploys of identical
   * content could serve different pages at `/`. */
  assert.strictEqual(isLive({ index: 0, publishAt: null }, { slug: 's' }, new Date(), true), false);
  assert.strictEqual(isLive({ index: 0, publishAt: 'nonsense' }, { slug: 's' }, new Date(), true), false);
  assert.strictEqual(isLive({ index: 0, publishAt: '2099-01-01T00:00:00Z' }, { slug: '' }, new Date(), true), false);
});

test('isLive TAKES THE FLAG AND ONLY THE DATE CHANGES', async () => {
  const slot = { index: 0, status: 'ready', publishAt: '2099-01-01T00:00:00Z' };
  const post = { slug: 's' };

  assert.strictEqual(isLive(slot, post, new Date('2026-01-01T00:00:00Z')), false);
  assert.strictEqual(isLive(slot, post, new Date('2026-01-01T00:00:00Z'), true), true);

  /* STRICTLY true, AND THIS LINE IS WHY THAT IS NOT FUSSINESS.
   *
   * The flag's journey starts at an HTML form, and every value a form
   * sends is a string. `'false'` is truthy in JavaScript. Written as a
   * plain `if (includeScheduled)` this whole function flips the moment any
   * route passes a form field through without casting it — and the symptom
   * is not an error, it is a customer's twelve-week drip campaign landing
   * on Google in one afternoon.
   *
   * Mutation found this: turning the strict test into a truthy one killed
   * no test at all until this assertion existed. */
  for (const truthy of ['false', 'no', '0', 1, {}, []]) {
    assert.strictEqual(
      isLive(slot, post, new Date('2026-01-01T00:00:00Z'), truthy), false,
      `${JSON.stringify(truthy)} was treated as the override`
    );
  }
});

test('EVERYTHING INCLUDED IS STILL OLDEST FIRST', async () => {
  /* The front page is articles[0]. If the override changed the order, the
   * root of the blog would move. */
  const out = planAll('2026-10-01T10:00:00Z');

  assert.deepStrictEqual(out.map(p => p.post.slug), ['first', 'second', 'third']);
  assert.strictEqual(out[0].isHome, true);
  assert.strictEqual(out[1].isHome, false);
});

test('THE RING RESOLVES PROPERLY WHEN NOTHING IS WAITING', async () => {
  /* The point of the override that is easy to miss: with all three on the
   * site, no neighbour is undeployed, so no link is left as a pending
   * span. Every prev/next is a real URL. */
  const out = planAll('2026-10-01T10:00:00Z');

  /* THE LENGTH FIRST, BECAUSE AN EMPTY LIST PASSES A LOOP. Written without
   * this line the test was green against code that had no override at all
   * — planAll returned nothing and the body never ran once. */
  assert.strictEqual(out.length, 3, 'nothing was planned, so nothing was checked');

  /* NOT "every article has both links" — that was this test's first version
   * and it was wrong about the ring, not about the override. ringNeighbours
   * gives post 0 no prev at all: nothing precedes the first article. What
   * the override promises is narrower and is the thing worth pinning —
   * every link that EXISTS resolves to a URL, because no neighbour is
   * sitting undeployed waiting for its date. */
  for (const p of out) {
    for (const name of ['prev', 'next']) {
      const target = p.targets[name];
      if (!target) continue;

      assert.ok(target.url, `${p.post.slug}: ${name} did not resolve to a URL`);
      assert.ok(!target.pendingId, `${p.post.slug}: ${name} is still a pending span`);
    }
  }

  /* And the shape of the ring itself, so the loop above cannot pass by
   * finding nothing to check. */
  assert.strictEqual(out[0].targets.prev, undefined, 'the first article grew a prev');
  assert.ok(out[0].targets.next.url);
  assert.ok(out[2].targets.prev.url);
  assert.ok(out[2].targets.next.url, 'the last article did not close the ring');
});

test('renderSite PASSES THE FLAG THROUGH', async () => {
  const db = installDb();

  const due = renderSite({
    blog: CF_BLOG, campaigns: db.campaigns, posts: db.posts,
    now: new Date('2026-10-01T10:00:00Z'),
  });
  assert.strictEqual(due.pages.length, 0);

  const all = renderSite({
    blog: CF_BLOG, campaigns: db.campaigns, posts: db.posts,
    now: new Date('2026-10-01T10:00:00Z'), includeScheduled: true,
  });
  assert.strictEqual(all.pages.length, 3);
});

test('publishBlog PASSES THE FLAG THROUGH, AND REFUSES WITHOUT IT', async () => {
  installDb();
  const before = new Date('2026-10-01T10:00:00Z');

  const refused = await publishBlog({ blog: CF_BLOG, now: before, deploy: fakeDeploy() });
  assert.strictEqual(refused.ok, false);
  assert.match(refused.error, /due/);

  const deploy = fakeDeploy();
  const out = await publishBlog({ blog: CF_BLOG, now: before, deploy, includeScheduled: true });

  assert.strictEqual(out.ok, true, out.error);
  assert.strictEqual(out.pages.length, 3);
  assert.ok(deploy.calls[0].files['index.html'], 'the front page was not rendered');
  assert.ok(deploy.calls[0].files['third/index.html'], 'the future-dated article was not rendered');
});

test('WHAT THE FIRST DEPLOY SET UP REACHES THE CALLER', async () => {
  /* THE SURVIVING MUTANT THIS CLOSES. publishBlog returning `setup: null`
   * instead of the deploy's own killed no test: the route's suite stubs
   * publishBlog wholesale, so it never runs this line, and this file was
   * not looking at the field.
   *
   * What falls through the gap is the only signal that a blog's domain
   * failed to attach. The deploy still succeeds — by design — so the
   * screen would say "Published", the site would be live on pages.dev,
   * and every canonical on it would name a domain answering nothing. */
  installDb();

  const setup = { created: true, domain: { ok: false, error: 'Zone not found [code: 1049]' } };
  const deploy = fakeDeploy({ ok: true, url: 'https://x.pages.dev', project: 'p', files: 0, setup });

  const out = await publishBlog({ blog: CF_BLOG, now: AT, deploy });

  assert.deepStrictEqual(out.setup, setup, 'the deploy told us and we dropped it');
});

test('AND IS null WHEN THERE WAS NO SETUP TO DO', async () => {
  installDb();
  const out = await publishBlog({ blog: CF_BLOG, now: AT, deploy: fakeDeploy() });

  assert.strictEqual(out.setup, null, 'an established blog reported setup work');
});

test('THE ARTICLES STILL CARRY THE DATES THEY WERE GIVEN', async () => {
  /* THE CONSEQUENCE, PINNED SO NOBODY IS SURPRISED BY IT. Publishing
   * everything does not rewrite the schedule: an article dated next week
   * goes up today still saying next week, and Google will read that date.
   *
   * That is deliberate — a renderer that quietly moved publish dates would
   * be changing campaign state from inside a dry run. It is also the
   * reason the button is not the ordinary way to publish, and the reason
   * the screen says so next to it. */
  const db = installDb();
  const { files } = renderSite({
    blog: CF_BLOG, campaigns: db.campaigns, posts: db.posts,
    now: new Date('2026-10-01T10:00:00Z'), includeScheduled: true,
  });

  assert.ok(files['third/index.html'].includes('2026-11-15'),
    'the future-dated article lost the date it was planned for');
});

/* ======================================================================= */

(async () => {
  for (const run of queue) await run();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
