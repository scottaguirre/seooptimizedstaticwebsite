#!/usr/bin/env node
//
// tools/preview-structure.js
//
// Look at a whole Local Website Options site and watch it change as you edit
// the stylesheet.
//
//   node tools/preview-structure.js                       # quarry, plumbing, set-4
//   node tools/preview-structure.js quarry plumbing set-4
//   node tools/preview-structure.js anvil plumbing set-2
//   node tools/preview-structure.js quarry lemon-law set-4
//   PORT=4500 node tools/preview-structure.js
//
//
// WHY THIS EXISTS, AND WHY IT IS NOT tools/preview-design.js
//
// That one previews a THEME — one stylesheet against src/template.html, for
// the lead and rankfast modes. This previews a STRUCTURE: eleven pages built
// by renderSite(), with the real photographs, in the mode that has no
// template file at all because its markup is JavaScript.
//
//     THE SHORTEST LOOP THAT IS STILL THE REAL PAGES.
//
// Every byte served here comes from renderSite() — the same function the
// build calls, through the same chrome.js, pages.js and theme.js. What
// renders here is what a build renders. That is the only reason it is worth
// looking at.
//
// NO DATABASE, NO MODEL CALL, NO CREDITS, NO PUBLISH. Node built-ins and the
// renderer. Nothing here can touch a customer's data because nothing here
// knows how to.
//
//
// WHAT IT CANNOT TELL YOU
//
// THE WORDS ARE FIXTURES. A structure is a layout and a VOICE, and this
// exercises only the layout. The fixture copy below is written to the right
// LENGTH for a trade page so the measure, the wrapping and the rhythm are
// honest — but it is not what the model would write, and a layout that looks
// right here can still be given prose that does not suit it. Said plainly,
// because a preview that quietly covers less than you think is worse than no
// preview.
//
// THE PHOTOGRAPHS ARE REAL, THOUGH, which is half the point of it: a set
// that is missing a file, or missing its alt.json, fails here in a second
// instead of on a published site.
//
//
// THE CSS SWAP, WHICH IS THE WHOLE POINT
//
// A full reload on every save loses scroll position, and the thing you are
// usually looking at is two thirds of the way down a long page. So a change
// to a STYLESHEET re-points the <link> at a new query string and the page
// restyles in place. A change to MARKUP — chrome.js or pages.js — reloads,
// because the HTML itself is different and there is nothing to swap.
//
// THE STYLESHEET LIVES IN A .js FILE, which is what makes this different
// from previewing a theme. theme.js is `require`d, so Node caches it; the
// watcher drops it from the cache, and everything that imported it along
// with it. See reload() below — getting that wrong means a preview that
// cheerfully serves the stylesheet you had before you edited it, which is
// the most expensive kind of wrong a tool like this can be.

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const STRUCTURE = (process.argv[2] || 'quarry').trim().toLowerCase();
const TRADE = (process.argv[3] || 'plumbing').trim();
const SET = (process.argv[4] || 'set-4').trim();
const PORT = Number(process.env.PORT) || 4500;

/* ===================================================================== */

/* SAY WHAT IS WRONG AND WHAT TO TYPE, rather than throwing a stack trace at
 * somebody who just wanted to look at a page. */
function die(message, hint) {
  console.error(`\n  ${message}\n`);
  if (hint) console.error(`  ${hint}\n`);
  process.exit(1);
}

const heroes = require('../utils/localOptions/render/heroes');
const { structureKeys } = require('../utils/localOptions/render/structures');

if (!structureKeys().includes(STRUCTURE)) {
  die(`There is no structure called "${STRUCTURE}".`,
    `Registered: ${structureKeys().join(', ')}`);
}

/* THE SET IS CHECKED BEFORE ANYTHING IS SERVED, and checked the way the
 * BUILD checks it — completeSets(), which requires four pictures AND a word
 * for each of them. A set with images and no alt.json is not a set; it is a
 * site whose pictures are undescribed, which no test fails and only the
 * people who cannot see them ever notice. */
const ready = heroes.completeSets(TRADE);
const present = heroes.setsIn(TRADE);

if (!present.filter(Boolean).length) {
  die(`"${TRADE}" has no set folders at all.`,
    `Looked in ${path.relative(ROOT, heroes.tradeDir(TRADE))}`);
}

if (!present.includes(SET)) {
  die(`"${TRADE}" has no ${SET}.`,
    `It has: ${present.filter(Boolean).join(', ')}`);
}

if (!ready.includes(SET)) {
  /* WHICH OF THE TWO HALVES IS MISSING, because "incomplete" is not an
   * instruction. While a set is being filled this is the message that gets
   * read most, so it says what to add rather than what is wrong. */
  const dir = heroes.folderFor(TRADE, heroes.IMAGES_ROOT, SET);
  const missingFiles = heroes.heroNames()
    .filter(name => !fs.existsSync(path.join(dir, name)));

  const alt = heroes.altFor(TRADE, heroes.IMAGES_ROOT, SET);
  const missingAlt = heroes.heroNames()
    .map((_, i) => String(i + 1))
    .filter(n => !alt[n]);

  die(`${TRADE}/${SET} is not complete, so a build would not use it.`,
    [
      missingFiles.length ? `Missing pictures: ${missingFiles.join(', ')}` : '',
      missingAlt.length
        ? `Missing alt text for: ${missingAlt.join(', ')}  (in ${SET}/alt.json)`
        : '',
      `alt.json looks like {"cover": 2, "1": "...", "2": "...", "3": "...", "4": "..."}`,
    ].filter(Boolean).join('\n  '));
}

/* THE BYTES, NOT THE PATHS. heroSet() returns { 'assets/hero-1.webp': Buffer }
 * — it reads the files, because a build copies them. Serving the buffer is
 * the same thing one step shorter, and it means the preview shows exactly
 * the bytes a deploy would upload.
 *
 * RE-READ ON EVERY RELOAD, so replacing a photograph while this is running
 * shows the new one. That is not a luxury here: the whole reason to point
 * this at a set is that you are in the middle of filling it. */
let SHOT = heroes.heroSet(TRADE, { set: SET });

/* ===================================================================== */

/**
 * Stand-in content.
 *
 * DELIBERATELY NOT A REAL BUSINESS, for the reason tools/preview-design.js
 * records: anything that reads like a real company's details ends up in a
 * screenshot and then in a document, and a plausible fake business is a
 * thing nobody meant to publish. "Example Plumbing Co." and a 555 number
 * cannot be mistaken for one.
 *
 * BUT IT IS THE RIGHT LENGTH, which is the whole reason the words are here
 * at all. A paragraph of lorem is not a test of a measure. These are sized
 * to a real service page — six services, three sections, two or three
 * paragraphs each — so the wrapping, the rhythm and the page's height are
 * what a built site would have.
 */
const P = [
  'You notice it first in the evening, when the sink takes a minute to clear '
  + 'and the smell comes back up with it. We open the trap, look at what is '
  + 'actually in there, and clear the line from the nearest access point '
  + 'rather than pushing the problem further down the run.',

  'Most of these are an hour. The ones that are not are usually a joint that '
  + 'has shifted or a length of pipe that has been patched before, and we '
  + 'tell you which of those it is before we start rather than after.',

  'What changes the price is access and what we find. A trap under a cabinet '
  + 'is a different job from one behind a tiled panel, and a line that has '
  + 'been cleared twice already is a different job again.',
];

const SERVICES = [
  ['drain-cleaning', 'Drain cleaning',
    'Slow sinks, gurgling showers, and the smell that comes with them.'],
  ['toilet-repair', 'Toilet repair',
    'Running, rocking, refusing to flush, or leaking at the base.'],
  ['faucet-repair', 'Faucet repair',
    'A drip that will not stop, or a handle that has gone stiff.'],
  ['pipe-leak-repair', 'Pipe leak repair',
    'A damp patch on a ceiling, or a water bill that climbed on its own.'],
  ['water-heater-repair', 'Water heater repair',
    'Lukewarm water, no water, or a tank that has started to rumble.'],
  ['garbage-disposal-repair', 'Garbage disposal repair',
    'A disposal that hums, jams, or backs the sink up when it runs.'],
];

function site() {
  return {
    /* A URL THAT CANNOT BE MISTAKEN FOR A LIVE ONE. It goes into every
     * canonical and into the sitemap, both of which are rendered here, and
     * `example.com` is reserved precisely so it can be written down. */
    url: 'https://example.com',
    structure: STRUCTURE,

    business: {
      name: 'Example Plumbing Co.',
      trade: TRADE,
      phone: '(512) 555-0100',
      street: '118 Oakmont Rd, Suite 4',
      city: 'Austin',
      state: 'TX',
      zip: '78704',
      social: { facebook: 'https://example.com/', instagram: 'https://example.com/' },
    },

    areas: ['Austin', 'Round Rock', 'Cedar Park', 'Pflugerville'],

    hours: [
      { day: 'Monday', open: '7:00 AM – 6:00 PM' },
      { day: 'Tuesday', open: '7:00 AM – 6:00 PM' },
      { day: 'Wednesday', open: '7:00 AM – 6:00 PM' },
      { day: 'Thursday', open: '7:00 AM – 6:00 PM' },
      { day: 'Friday', open: '7:00 AM – 5:00 PM' },
      { day: 'Saturday', open: '9:00 AM – 2:00 PM' },
      { day: 'Sunday', open: null },
    ],

    /* THE REAL ALT TEXT AND THE REAL COVER, out of the set's own alt.json.
     * Half the reason to run this against a set you have just filled: a
     * number in `cover` that points at a picture you reordered shows up
     * here, in the schema, instead of on a client's site. */
    alt: SHOT.alt,
    cover: SHOT.cover,

    logo: 'assets/logo.svg',
    verification: [],

    services: SERVICES.map(([slug, name, blurb]) => ({
      slug,
      name,
      blurb,
      h1: `${name} in Austin`,
      title: `${name} in Austin, TX | Example Plumbing Co.`,
      meta: 'A stand-in description, about as long as the real one would be.',
      sections: [
        { heading: '', paragraphs: [P[0], P[1]] },
        { heading: 'What the job involves', paragraphs: [P[2], P[0]] },
        { heading: 'What moves the price', paragraphs: [P[2]] },
      ],
    })),

    home: {
      sub: 'Same-week appointments across central Austin.',
      title: 'Example Plumbing Co. — Austin, TX',
      meta: 'A stand-in description.',
      aboutHeading: 'Pipework across Austin',
      about: [P[0], P[1], P[2]],
      firstBreak: 'Under the sink, behind the panel.',
      secondBreak: 'We pick up before eight.',
    },

    /* FIXED, SO TWO RUNS RENDER THE SAME BYTES. The footer's copyright year
     * is the only thing on a site that changes without anybody editing it,
     * and a preview that differs from itself between refreshes is a preview
     * you cannot compare against a screenshot. */
    now: new Date('2026-01-01T00:00:00Z'),
  };
}

/* A DRAWN LOGO, NOT AN UPLOAD. Dark ink on transparency is the case Anvil's
 * plate exists for and the case Quarry decided it does not need, so the
 * preview has to carry one that actually has that problem. */
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80" viewBox="0 0 300 80">
  <rect x="2" y="2" width="296" height="76" fill="none" stroke="#1c1e1a" stroke-width="3"/>
  <text x="22" y="36" font-family="system-ui,sans-serif" font-size="19" font-weight="800" fill="#1c1e1a">EXAMPLE</text>
  <text x="22" y="60" font-family="system-ui,sans-serif" font-size="13" letter-spacing="3" fill="#1c1e1a">PLUMBING CO.</text>
</svg>`;

/* The browser half of the reload. Kept here rather than in a file so the
 * tool is one thing you can copy, read and delete. */
const LIVE_RELOAD = `
<script>
(function () {
  var link = document.getElementById('__sheet');
  var es = new EventSource('/__reload');

  es.onmessage = function (e) {
    if (e.data === 'css' && link) {
      /* SWAP, DO NOT RELOAD. The thing you are looking at is usually two
         thirds of the way down a long page, and a reload throws that away
         on every save. */
      link.href = link.href.split('?')[0] + '?v=' + Date.now();
      return;
    }
    location.reload();
  };

  es.onerror = function () { /* the server went away; the browser retries */ };
})();
</script>`;

/* ===================================================================== */

let FILES = {};

/**
 * Re-render everything, with the renderer re-read from disk.
 *
 * THE CACHE IS THE WHOLE DIFFICULTY. `require` caches by resolved path, so
 * editing theme.js and re-calling renderSite() serves the stylesheet you had
 * before you saved — silently, and in a tool whose entire job is to show you
 * what you just changed.
 *
 *     A PREVIEW THAT SERVES A STALE FILE IS WORSE THAN NO PREVIEW,
 *     BECAUSE YOU BELIEVE IT.
 *
 * Dropping theme.js alone is not enough either: structures.js, chrome.js and
 * pages.js all hold their own references to what they imported at load. So
 * everything under utils/localOptions goes, and the next require rebuilds
 * the lot. It costs a few milliseconds and removes the entire class of
 * problem.
 */
function reload() {
  const here = path.join(ROOT, 'utils', 'localOptions');

  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(here)) delete require.cache[key];
  }

  const { renderSite } = require('../utils/localOptions/render/renderSite');

  /* heroes.js came out of the cache with everything else, so this is a fresh
   * read of the folder as it stands right now. */
  SHOT = require('../utils/localOptions/render/heroes').heroSet(TRADE, { set: SET });

  FILES = renderSite(site());
}

/**
 * The stylesheet link gets an id, so the script above can re-point it.
 *
 * REPLACED IN THE SERVED COPY, NOT IN THE RENDERER. chrome.js writes the
 * <link> and has no business knowing a preview exists — the moment a tool
 * needs a change in the thing it is previewing, it has stopped previewing
 * it.
 */
function dress(html) {
  return String(html)
    .replace(/<link rel="stylesheet" href="([^"]+)">/,
      '<link rel="stylesheet" id="__sheet" href="$1">')
    .replace('</body>', `${LIVE_RELOAD}\n</body>`);
}

/* ===================================================================== */

const clients = new Set();

function notify(kind) {
  for (const res of clients) res.write(`data: ${kind}\n\n`);
}

/* ONE EVENT PER BURST. Editors save by writing, truncating and renaming, so
 * one save can fire fs.watch three or four times; without this the browser
 * refetches on every one of them. */
function watch(file, kind) {
  if (!fs.existsSync(file)) return;

  let timer = null;

  fs.watch(file, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      let note = '';

      try {
        reload();
      } catch (err) {
        /* A SYNTAX ERROR MUST NOT KILL THE SERVER. Half-typed JavaScript is
         * the normal state of a file being edited, and a preview that exits
         * on the first broken save is a preview you restart all afternoon.
         * The last good render stays up and the error goes to the terminal
         * AND, via a reload, into the page. */
        note = `  ⚠ ${err.message}`;
        FILES = { __error: String(err.stack || err) };
      }

      console.log(`  ${new Date().toLocaleTimeString()}  ${kind}  ${path.basename(file)}${note}`);
      notify(kind);
    }, 60);
  });
}

function send(res, body, type) {
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0];

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

  if (FILES.__error) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<pre style="padding:24px;font:14px/1.5 ui-monospace,monospace">'
      + FILES.__error.replace(/[<&]/g, c => (c === '<' ? '&lt;' : '&amp;'))
      + '</pre>' + LIVE_RELOAD);
  }

  if (url === '/assets/logo.svg') return send(res, LOGO_SVG, 'image/svg+xml');

  /* THE PHOTOGRAPHS COME OFF DISK, out of the set being previewed. heroes.js
   * copies these into a build; here they are served where the pages ask for
   * them, which is the same thing one step shorter. */
  const hero = url.match(/^\/assets\/hero-\d\.webp$/);

  if (hero) {
    /* KEYED THE WAY heroSet() KEYS IT — 'assets/hero-1.webp', with the
     * folder in the key, which is the path a build writes it to. The first
     * version of this looked up the bare filename and 404'd every
     * photograph while every page around them served perfectly. */
    const buf = SHOT.files[url.replace(/^\//, '')];

    if (!buf) {
      res.writeHead(404).end(`no ${path.basename(url)} in ${TRADE}/${SET}`);
      return;
    }

    return send(res, buf, 'image/webp');
  }

  /* DIRECTORY URLS, because that is what the pages link to. renderSite()
   * writes drain-cleaning/index.html and the markup links to ../toilet-repair/
   * — so a server that only matched exact filenames would 404 every link on
   * the site it is previewing. */
  let key = url.replace(/^\//, '');

  if (key === '' || key.endsWith('/')) key += 'index.html';

  const body = FILES[key];

  if (undefined === body) {
    /* 404.html IS THE REAL ONE, which is the only way to look at it. */
    const four = FILES['404.html'];

    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(four ? dress(four) : 'not found');
  }

  const type = TYPES[path.extname(key)] || 'text/plain; charset=utf-8';

  return send(res, key.endsWith('.html') ? dress(body) : body, type);
});

/* ===================================================================== */

try {
  reload();
} catch (err) {
  die('The renderer threw before anything could be served.', String(err.stack || err));
}

watch(path.join(ROOT, 'utils', 'localOptions', 'render', 'theme.js'), 'css');

/* LEDGER'S MARKUP IS AT THE TOP LEVEL and every other structure has a folder
 * of its own, so both shapes are watched and the one that does not exist is
 * skipped. */
watch(path.join(ROOT, 'utils', 'localOptions', 'render', STRUCTURE, 'chrome.js'), 'html');
watch(path.join(ROOT, 'utils', 'localOptions', 'render', STRUCTURE, 'pages.js'), 'html');
watch(path.join(ROOT, 'utils', 'localOptions', 'render', 'chrome.js'), 'html');
watch(path.join(ROOT, 'utils', 'localOptions', 'render', 'pages.js'), 'html');

/* AND THE PICTURES THEMSELVES. fs.watch on a directory fires for a file
 * added, replaced or removed inside it, which is exactly what filling a set
 * looks like. It reloads rather than swapping, because the alt text and the
 * cover may have moved with them. */
watch(heroes.folderFor(TRADE, heroes.IMAGES_ROOT, SET), 'img');

server.listen(PORT, () => {
  const pages = Object.keys(FILES).filter(p => p.endsWith('.html')).length;

  console.log('');
  console.log(`  ${STRUCTURE}  ·  ${TRADE}/${SET}  ·  ${pages} pages  ·  cover: hero-${SHOT.cover}`);
  console.log(`  http://localhost:${PORT}`);
  console.log('');
  console.log('  theme.js saves restyle in place; chrome.js and pages.js reload.');
  console.log('  The words are fixtures. The photographs are yours.');
  console.log('');
});
