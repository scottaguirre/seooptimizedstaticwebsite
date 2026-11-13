#!/usr/bin/env node
//
// tools/preview-design.js
//
// Look at a theme's home page and watch it change as you edit the CSS.
//
//   node tools/preview-design.js                 # style7, roofing photos
//   node tools/preview-design.js style3          # a different design
//   node tools/preview-design.js style3 plumbing # and different photos
//   PORT=4400 node tools/preview-design.js
//
//
// WHY THIS EXISTS — Edwin, 3 November: "I want to be able to modify the css
// for style7 and see the changes in real time, what do you suggest?"
//
// The app is the wrong loop for that, and not by a little. `npm run dev`
// needs Mongo, and the moment Mongo connects server.js starts jobRunner,
// blogScheduler and the cleanup sweeper — so editing a stylesheet with the
// app running means a laptop polling for real customer work. Nothing in it
// rebuilds on save either: seeing a CSS change would mean running a whole
// generation, which costs an OpenAI call and a minute, per edit.
//
//     THE SHORTEST LOOP THAT IS STILL THE REAL PAGE.
//
// So this serves the actual src/template.html, through the actual pipeline —
// fillLegalLinks, then stripUnusedHero for the chosen design — with the real
// theme stylesheet. What renders here is what a build renders. It is not a
// mock-up of the page, which is the only reason it is worth looking at.
//
// NO DATABASE, NO MODEL, NO WORKERS, NO NEW DEPENDENCIES. Node built-ins and
// about ten lines of injected browser script. Nothing here can touch a
// customer's data because nothing here knows how to.
//
//
// THE CSS SWAP, WHICH IS THE WHOLE POINT
//
// A full page reload on every save loses scroll position, and a hero is at
// the top of a page you are usually scrolled down inside. So a CSS change
// does NOT reload: it re-points the <link> at a new query string, the browser
// fetches the stylesheet again, and the page restyles in place. Scroll
// position stays, an open dropdown stays open.
//
// A TEMPLATE change does reload, because the markup itself is different and
// there is nothing to swap.
//
//
// WHAT IT IS NOT. The home page only, by Edwin's choice — the About, Contact
// and Location templates have their own copies of the hero markup, so a
// change that works here still wants checking against a real build before it
// ships. Said plainly because a preview that quietly covers less than you
// think is worse than no preview.

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const { stripUnusedHero, HERO_LAYOUT } = require('../utils/stripUnusedHero');
const { fillLegalLinks } = require('../utils/legalLinks');

const ROOT = path.join(__dirname, '..');
const STYLE_KEY = (process.argv[2] || 'style7').trim();
const TRADE = (process.argv[3] || 'roofing').trim();
const PORT = Number(process.env.PORT) || 4300;

const TEMPLATE = path.join(ROOT, 'src', 'template.html');
const THEME_CSS = path.join(ROOT, 'src', 'css', 'themes', `${STYLE_KEY}.css`);
const BOOTSTRAP = path.join(ROOT, 'src', 'css', 'bootstrap.min.css');
const HERO_DIR = path.join(ROOT, 'src', 'predefined-images', TRADE, 'aboutUs', 'hero');

/* ===================================================================== */

/* SAY WHAT IS WRONG AND WHAT TO TYPE, rather than throwing a stack trace at
 * somebody who just wanted to look at a page. */
function die(message, hint) {
  console.error(`\n  ${message}\n`);
  if (hint) console.error(`  ${hint}\n`);
  process.exit(1);
}

if (!fs.existsSync(THEME_CSS)) {
  const have = fs.readdirSync(path.join(ROOT, 'src', 'css', 'themes'))
    .filter(f => f.endsWith('.css')).map(f => f.replace(/\.css$/, ''));
  die(`There is no stylesheet for "${STYLE_KEY}".`,
    `Designs with one: ${have.join(', ')}`);
}

if (!HERO_LAYOUT[STYLE_KEY]) {
  /* NOT FATAL, because this is exactly the state somebody is in while adding
   * a design: the stylesheet exists and the mapping has not been written yet.
   * Refusing to render would hide the thing they are about to fix. */
  console.warn(`\n  ⚠ "${STYLE_KEY}" has no HERO_LAYOUT entry in utils/stripUnusedHero.js,`);
  console.warn('    so this page will show the unmapped fallback: two heroes and two <h1>s.\n');
}

/* ===================================================================== */

/**
 * Stand-in content.
 *
 * DELIBERATELY NOT A REAL BUSINESS. These words exist to give the CSS
 * something of a realistic LENGTH to lay out — a headline that wraps, an
 * address long enough to crowd a bar. Anything that reads like a real
 * company's details would end up in a screenshot and then in a document, and
 * a plausible fake business is a thing nobody meant to publish.
 */
const FIELDS = {
  PAGE_TITLE: `Preview — ${STYLE_KEY}`,
  META_DESCRIPTION: 'A local preview. Not a real page.',
  CANONICAL: '',
  FAVICON_PATH: 'data:,',
  JSON_LD_SCHEMA: '{}',

  PAGE_NAME: 'Roofing You Can Trust. Service You Deserve.',
  LOCATION_AREA: 'Expert work. Honest pricing. Results that last.',

  BUSINESS_NAME: 'Example Roofing Co.',
  ADDRESS: '118 Oakmont Rd, Suite 4, Austin, TX 78704',
  PHONE_DISPLAY: '(512) 555-0100',
  PHONE_RAW: 'tel:+15125550100',
  EMAIL: 'hello@example.com',
  HOURS_TIME: 'Mon–Fri 7:00 – 18:00',
  CURRENT_YEAR: String(new Date().getFullYear()),

  LOGO_PATH: '/__logo.svg',
  LOGO_ALT: 'Example Roofing Co.',
  LOGO_TITLE: 'Example Roofing Co.',
  LOGO_WIDTH: '170',
  LOGO_HEIGHT: '44',

  HERO_IMG_LARGE: '/__hero/large',
  HERO_IMG_DESKTOP: '/__hero/desktop',
  HERO_IMG_TABLET: '/__hero/tablet',
  HERO_IMG_MOBILE: '/__hero/mobile',
  HERO_IMG_ALT: 'A roofer on a finished roof',
  HERO_IMG_TITLE: 'A roofer on a finished roof',

  FIRST_PAGE_NAME: 'ROOF REPAIR',
  FIRST_PAGE_NAME_ACTIVE: '',
  LINK_OUTSIDE_NAV_MENU: '#',
  SERVICES_NAV_MENU:
    ['Roof Repair', 'Roof Replacement', 'Storm Damage', 'Gutter Work']
      .map(s => `<li><a class="dropdown-item" href="#">${s}</a></li>`).join('\n'),
  LOCATIONS_NAV_MENU:
    ['Austin', 'Round Rock', 'Cedar Park']
      .map(s => `<li><a class="dropdown-item" href="#">${s}</a></li>`).join('\n'),

  SECTION1_H2: 'Local roofing, done once',
  SECTION1_H3: 'Why owners call us back',
  SECTION1_P1: 'Placeholder body copy, long enough that the paragraph actually wraps and the measure can be judged. It says nothing, on purpose.',
  SECTION1_P2: 'A second paragraph, same purpose, slightly shorter.',
  SECTION2_H2: 'What the work looks like',
  SECTION2_P1: 'More placeholder copy for the two-image section.',
  SECTION2_P2: 'And the paragraph beside it.',
  SECTION3_H2: 'Areas we cover',
  SECTION3_P1: 'Placeholder copy.',
  SECTION3_P2: 'Placeholder copy.',
  SECTION4_H2: 'Before you call',
  SECTION4_P1: 'Placeholder copy.',
  SECTION4_P2: 'Placeholder copy.',

  SECTION2_IMG1: '/__hero/tablet', SECTION2_IMG2: '/__hero/tablet',
  SECTION4_IMG1: '/__hero/tablet', SECTION4_IMG2: '/__hero/tablet',
  SECTION2_IMG_ALT1: '', SECTION2_IMG_ALT2: '',
  SECTION4_IMG_ALT1: '', SECTION4_IMG_ALT2: '',
  SECTION2_IMG_TITLE1: '', SECTION2_IMG_TITLE2: '',
  SECTION4_IMG_TITLE1: '', SECTION4_IMG_TITLE2: '',

  MAP_IFRAME_SRC: 'about:blank',
  MAP_IFRAME_TITLE: 'Map',
  SOCIAL_LINKS: '',
};

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="170" height="44" viewBox="0 0 170 44">
  <path d="M6 34 20 10l14 24z" fill="#8b63ff"/>
  <text x="42" y="22" font-family="system-ui,sans-serif" font-size="15" font-weight="700" fill="#fff">EXAMPLE</text>
  <text x="42" y="36" font-family="system-ui,sans-serif" font-size="10" letter-spacing="2" fill="#b9a7ff">ROOFING CO.</text>
</svg>`;

/* The browser half of the reload. Kept here rather than in a file so the tool
 * is one thing you can copy, read and delete. */
const LIVE_RELOAD = `
<script>
(function () {
  var link = document.getElementById('__theme');
  var es = new EventSource('/__reload');

  es.onmessage = function (e) {
    if (e.data === 'css') {
      /* SWAP, DO NOT RELOAD. A hero sits at the top of a page you are
         usually scrolled down inside, and a reload would throw that away on
         every save. */
      link.href = '/__theme.css?v=' + Date.now();
      return;
    }
    location.reload();
  };

  es.onerror = function () { /* the server went away; the browser retries */ };
})();
</script>`;

/* ===================================================================== */

function renderPage() {
  let html = fs.readFileSync(TEMPLATE, 'utf8');

  /* THE REAL PIPELINE, IN THE REAL ORDER. runGeneration.js calls these two
   * back to back; doing anything else here would make this a preview of a
   * page the generator does not build. */
  html = fillLegalLinks(html, {});
  html = stripUnusedHero(html, STYLE_KEY);

  html = html.replace(/\{\{([A-Z_0-9]+)\}\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(FIELDS, key) ? FIELDS[key] : '');

  /* The build injects the stylesheets with webpack; here they go in by hand,
   * and the theme gets an id so the script above can re-point it. */
  html = html.replace('</head>',
    '  <link rel="stylesheet" href="/__bootstrap.css">\n'
    + '  <link rel="stylesheet" id="__theme" href="/__theme.css">\n'
    + '</head>');

  return html.replace('</body>', `${LIVE_RELOAD}\n</body>`);
}

/* ===================================================================== */

const clients = new Set();

function notify(kind) {
  for (const res of clients) res.write(`data: ${kind}\n\n`);
}

/* ONE EVENT PER BURST. Editors save by writing, truncating and renaming, so
 * one ⌘S can fire fs.watch three or four times; without this the browser
 * refetches the stylesheet several times per keystroke-save. */
function watch(file, kind) {
  if (!fs.existsSync(file)) return;

  let timer = null;
  fs.watch(file, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      console.log(`  ${new Date().toLocaleTimeString()}  ${kind}  ${path.basename(file)}`);
      notify(kind);
    }, 60);
  });
}

function sendFile(res, file, type) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}

/** The widest hero file that exists, for any name the template asks for. */
function heroFile(size) {
  const names = {
    large: 'hero-large', desktop: 'hero-desktop',
    tablet: 'hero-tablet', mobile: 'hero-mobile',
  };
  for (const base of [names[size], 'hero-large', 'hero-desktop']) {
    for (const ext of ['.webp', '.jpg', '.png']) {
      const p = path.join(HERO_DIR, base + ext);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/__reload') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write('\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (url === '/__theme.css')     return sendFile(res, THEME_CSS, 'text/css');
  if (url === '/__bootstrap.css') return sendFile(res, BOOTSTRAP, 'text/css');

  if (url === '/__logo.svg') {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
    return res.end(LOGO_SVG);
  }

  if (url.startsWith('/__hero/')) {
    const file = heroFile(url.slice('/__hero/'.length));
    if (!file) { res.writeHead(404).end('no hero image'); return; }
    const type = file.endsWith('.webp') ? 'image/webp'
      : file.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return sendFile(res, file, type);
  }

  if (url === '/' || url === '/index.html') {
    let html;
    try {
      html = renderPage();
    } catch (err) {
      /* THE ERROR GOES IN THE PAGE, not only the terminal. A blank browser
         tab beside a stack trace in another window is a worse way to find out
         a template is broken. */
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<pre style="padding:24px;font:14px/1.5 ui-monospace,monospace">`
        + `${String(err.stack || err).replace(/[<&]/g, c => (c === '<' ? '&lt;' : '&amp;'))}</pre>`
        + LIVE_RELOAD);
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(html);
  }

  res.writeHead(404).end('not found');
});

server.listen(PORT, () => {
  const layout = HERO_LAYOUT[STYLE_KEY] || 'unmapped (fallback)';
  console.log('');
  console.log(`  ${STYLE_KEY}  ·  hero: ${layout}  ·  photos: ${TRADE}`);
  console.log(`  http://localhost:${PORT}`);
  console.log('');
  console.log(`  watching  src/css/themes/${STYLE_KEY}.css   (restyles in place)`);
  console.log('            src/template.html                (reloads)');
  console.log('');
  console.log('  Home page only. The About, Contact and Location templates carry');
  console.log('  their own copies of the hero — check a real build before shipping.');
  console.log('');

  watch(THEME_CSS, 'css');
  watch(TEMPLATE, 'html');
});
