// utils/localOptions/render/heroes.js
//
// The four photographs, from the predefined folder into the site.
//
// THE ONE PART OF THE RENDERER THAT TOUCHES DISK. Everything else under
// render/ is pure — values in, strings out — so it can be asserted without a
// filesystem. This reads bytes, because bytes are what a photograph is, and
// it is kept in its own file for exactly that reason.
//
// IT WARNS AND SKIPS. IT NEVER THROWS.
//
// Only `plumbing` has pictures today. Every other trade points at a folder
// that does not exist yet, and a renderer that threw on that would refuse to
// build a paid-for site over a missing decoration — eleven pages of correct,
// written, billed-for content, not delivered, because a photograph was not
// there.
//
// copyPageImage() in utils/copyAllPredefinedImages.js already does this:
//
//     if (!fs.existsSync(src)) { console.warn(`Missing: ${src}`); return; }
//
// Same rule, said through the logger rather than console, and reported back
// to the caller so a deploy can record which site went out without pictures
// instead of nobody finding out.
//
// THE PAGES STILL REFERENCE /assets/hero-N.webp WHETHER OR NOT IT IS THERE.
// A missing image renders as its alt text in an empty band — which is ugly,
// and is the correct failure: the page works, the text is readable, and the
// gap is obvious to whoever looks at the site.

// SETS, ADDED 30 OCTOBER — Edwin, on building a second plumbing site: "I
// want to add other 4 plumbing images and separate the folders so I can build
// another plumbing website."
//
// Two brochure sites for two different plumbers, in two different towns, with
// byte-identical photographs is the thing a visitor notices first — sooner
// than the shared layout and sooner than the shared voice. So a trade now
// holds SETS:
//
//     plumbing/set-1/hero-1..4.webp + alt.json
//     plumbing/set-2/hero-1..4.webp + alt.json
//
// THE FOUR PICTURES, THEIR ALT TEXT AND THEIR COVER MUST COME FROM ONE SET,
// and heroSet() exists so that they cannot do otherwise. Three separate
// lookups is three chances to read set-1's words over set-2's pictures — and
// nothing would fail: the site renders, and every photograph is described as
// something it is not, to exactly the people who cannot see it.
//
// THE OLD SHAPE STILL WORKS. Pictures sitting directly in the trade folder
// are treated as a single unnamed set, because a deploy that lost its images
// over a folder rename is the worse failure.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { HERO_COUNT } = require('./shape');
const { log } = require('../../logger');

/** Where the predefined pictures live, per trade. */
const IMAGES_ROOT = path.join(
  __dirname, '..', '..', '..', 'src', 'predefined-images', 'local-website-options'
);

/** hero-1.webp .. hero-4.webp, in order. */
function heroNames() {
  return Array.from({ length: HERO_COUNT }, (_, i) => `hero-${i + 1}.webp`);
}

/** The trade's own folder, whatever is inside it. */
function tradeDir(trade, root = IMAGES_ROOT) {
  return path.join(root, String(trade || '').trim().toLowerCase());
}

/**
 * The sets a trade has, in order.
 *
 * NUMBERED, NOT ALPHABETICAL. Sorting the names as strings puts set-10 before
 * set-2, which would silently reshuffle which site gets which pictures the
 * day a tenth set is added — every existing site's photographs changing at
 * once, on the next rebuild, for no reason anybody could see.
 *
 * AN EMPTY STRING MEANS THE TRADE FOLDER ITSELF. That is the shape every
 * trade had until 30 October, and the shape a fixture in the test suite
 * still uses.
 */
function setsIn(trade, root = IMAGES_ROOT) {
  const dir = tradeDir(trade, root);

  let entries = [];

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return [''];
  }

  const sets = entries
    .filter(e => e.isDirectory() && /^set-\d+$/.test(e.name))
    .map(e => e.name)
    .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));

  return sets.length ? sets : [''];
}

/**
 * Which set a particular site gets.
 *
 * FROM THE BUSINESS NAME, NOT AT RANDOM, and that is the whole requirement.
 * A random pick would hand a site different photographs every time it was
 * rebuilt — and the stored alt text, which describes specific pictures,
 * would then be describing the previous set.
 *
 *     THE SAME BUSINESS ALWAYS GETS THE SAME PICTURES.
 *
 * It is the same rule repoNameFor() follows for the repository name, for the
 * same reason: a build has to be able to run twice.
 *
 * HASHED RATHER THAN COUNTED. "However many sites exist already" would need
 * a database here, would differ between the laptop and the server, and would
 * renumber everything the first time a site was deleted.
 */
function pickSet(trade, key, root = IMAGES_ROOT) {
  /* ONLY SETS THAT ARE ACTUALLY COMPLETE ARE IN THE DRAW. A set-3 somebody
   * is halfway through adding would otherwise be handed to a site, which
   * publishes a page with two photographs and two empty bands — and the
   * person adding the pictures has no reason to expect that a folder they
   * are still filling is already live. */
  const ready = completeSets(trade, root);
  const sets = ready.length ? ready : setsIn(trade, root);

  if (sets.length < 2) return sets[0];

  const digest = crypto.createHash('sha1')
    .update(String(key == null ? '' : key).trim().toLowerCase())
    .digest();

  return sets[digest.readUInt32BE(0) % sets.length];
}

/**
 * The folder a trade's pictures are in.
 *
 * @param {string} trade
 * @param {string} [root]
 * @param {string} [set]  'set-2', or '' for the trade folder itself
 *
 * THE SET DEFAULTS TO THE FIRST ONE rather than to nothing, so every caller
 * written before sets existed still finds pictures.
 */
function folderFor(trade, root = IMAGES_ROOT, set) {
  const which = undefined === set ? setsIn(trade, root)[0] : set;

  return which
    ? path.join(tradeDir(trade, root), which)
    : tradeDir(trade, root);
}

/**
 * Everything alt.json says, or {}.
 *
 * SHAPED { "cover": 4, "1": "...", "2": "..." }. Written once per trade by
 * hand, because alt text describing a specific photograph cannot be derived
 * from a business or generated per site — the same four pictures appear on
 * every plumbing site this mode builds.
 *
 * MISSING IS NOT AN ERROR, AND NEITHER IS MALFORMED. An image with no alt
 * text is a worse page; an exception here is no page at all.
 */
function manifestFor(trade, root = IMAGES_ROOT, set) {
  const file = path.join(folderFor(trade, root, set), 'alt.json');

  try {
    if (!fs.existsSync(file)) return {};

    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));

    return parsed && 'object' === typeof parsed ? parsed : {};
  } catch (err) {
    log.info('localOptions.altUnreadable', { trade, error: err.message });
    return {};
  }
}

/** Just the alt text, keyed 1..N. `cover` and anything else is dropped. */
function altFor(trade, root = IMAGES_ROOT, set) {
  const manifest = manifestFor(trade, root, set);
  const alt = {};

  for (const [key, value] of Object.entries(manifest)) {
    if (/^\d+$/.test(key)) alt[key] = value;
  }

  return alt;
}

/**
 * WHICH PICTURE REPRESENTS THE BUSINESS — the establishing shot.
 *
 * DECLARED BY THE TRADE FOLDER, NOT HARDCODED AS 1. This is the image the
 * LocalBusiness schema carries, which is the one a search result may show
 * beside the company.
 *
 * THE REASON IT IS NOT AN INDEX IN THE CODE: on 28 October Edwin reordered
 * the four plumbing pictures, swapping hero-1 and hero-4. schema.js said
 * `hero-1.webp` with a comment explaining that hero-1 was "the only one of
 * the four that is outdoors with the van" — and after the swap it was a
 * close-up of a wrench under a basin. Nothing failed. The business's image
 * was simply wrong, and would have stayed wrong.
 *
 * A number in alt.json moves WITH the pictures, because it is edited by
 * whoever reorders them.
 *
 * Defaults to 1 when unstated, which is right for a folder whose first
 * picture is its best one and is the only safe guess for a folder that has
 * not thought about it.
 */
function coverFor(trade, root = IMAGES_ROOT, set) {
  const raw = manifestFor(trade, root, set).cover;
  const n = Number(raw);

  if (!Number.isInteger(n) || n < 1 || n > HERO_COUNT) return 1;

  return n;
}

/**
 * The hero images for a trade, as files to write.
 *
 * @param {string} trade      'plumbing'
 * @param {object} [opts]
 * @param {string} [opts.root]       where the trade folders live
 * @param {object} [opts.requestId]  carried into the log line
 * @returns {{files: Object<string, Buffer>, found: string[], missing: string[]}}
 *
 * RETURNS A MAP THE SAME SHAPE renderSite() RETURNS, so the caller merges
 * the two and hands one object to the deploy. The deploy's writeSite()
 * passes contents straight to fs.writeFile, which takes a Buffer — so an
 * image and a page travel through the same pipe.
 */
function heroFiles(trade, { root = IMAGES_ROOT, set, requestId } = {}) {
  const dir = folderFor(trade, root, set);
  const files = {};
  const found = [];
  const missing = [];

  for (const name of heroNames()) {
    const src = path.join(dir, name);

    try {
      /* readFileSync RATHER THAN existsSync THEN read. The check-then-act
       * pair is a race on a folder somebody may be adding pictures to, and
       * the catch has to exist anyway for a file that is there and
       * unreadable. */
      files[`assets/${name}`] = fs.readFileSync(src);
      found.push(name);
    } catch (err) {
      missing.push(name);
    }
  }

  if (missing.length) {
    /* log.info, NOT log.error. A trade with no pictures yet is the expected
     * state of this feature on the day it ships — only `plumbing` has any —
     * and an error line per deploy would train everybody to ignore it.
     *
     * The logger has error/security/generation/external/info/debug and no
     * generic `warn`. The first draft of the zone check found that out by
     * calling log.warn and getting "is not a function" at runtime. */
    log.info('localOptions.heroesMissing', {
      requestId,
      trade,
      folder: dir,
      missing,
      found: found.length,
    });
  }

  return { files, found, missing };
}

/**
 * One site's pictures, their words and its cover — from ONE set.
 *
 * THE REASON THIS FUNCTION EXISTS RATHER THAN THREE CALLS. The alt text
 * describes specific photographs and the cover is an index into them, so
 * reading them from a different set than the bytes came from produces a site
 * where nothing fails and everything is wrong: four pictures described as
 * four other pictures, to exactly the people who cannot see them, and a
 * LocalBusiness image pointing at the wrong one.
 *
 *     THE SET IS CHOSEN ONCE, HERE, AND EVERYTHING ELSE FOLLOWS IT.
 *
 * @param {string} trade
 * @param {object} [opts]
 * @param {string} [opts.root]
 * @param {string} [opts.key]   the business name — decides the set
 * @param {string} [opts.set]   an explicit set, which wins over the key
 * @param {string} [opts.requestId]
 *
 * @returns {{set: string, files: object, alt: object, cover: number,
 *            found: string[], missing: string[]}}
 */
function heroSet(trade, { root = IMAGES_ROOT, key, set, requestId } = {}) {
  /* AN EXPLICIT SET WINS, because a re-render of a stored site has to use
   * the pictures that site already has — its alt text describes them. */
  const which = undefined === set || '' === set
    ? pickSet(trade, key, root)
    : set;

  const { files, found, missing } = heroFiles(trade, { root, set: which, requestId });

  return {
    set: which,
    files,
    found,
    missing,
    alt: altFor(trade, root, which),
    cover: coverFor(trade, root, which),
  };
}

/**
 * The sets that are actually ready to be published.
 *
 * FOUR PICTURES *AND* A WORD FOR EACH OF THEM.
 *
 * Requiring alt.json here looks strict until you ask what the alternative
 * is. There is no fallback: set-1's alt text describes set-1's photographs
 * and is simply false about set-2's. So a set with images and no words can
 * only publish a site whose pictures are undescribed — which no test fails,
 * no page breaks over, and only the people who cannot see them ever notice.
 *
 *     IMAGES ARRIVE IN A FOLDER. THE WORDS ARRIVE WHEN SOMEBODY WRITES THEM.
 *     THE GAP BETWEEN IS WHERE A SITE GETS PUBLISHED.
 *
 * 30 October: set-2's four photographs were added with no alt.json, and
 * without this rule the next plumbing build had a one-in-two chance of
 * shipping them bare.
 *
 * A TRADE IS READY IF ANY ONE OF ITS SETS IS. A half-filled set-3 must not
 * make plumbing look unavailable when set-1 and set-2 are fine.
 */
function completeSets(trade, root = IMAGES_ROOT) {
  return setsIn(trade, root).filter((set) => {
    const dir = folderFor(trade, root, set);

    if (!heroNames().every(name => fs.existsSync(path.join(dir, name)))) return false;

    const alt = altFor(trade, root, set);

    return heroNames().every((_, i) => alt[String(i + 1)]);
  });
}

/** Which trades have a full set, for an admin screen or a readiness check. */
function tradesWithImages(root = IMAGES_ROOT) {
  let entries = [];

  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    return [];
  }

  return entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .filter(trade => completeSets(trade, root).length)
    .sort();
}

module.exports = {
  IMAGES_ROOT,
  heroNames,
  tradeDir,
  setsIn,
  pickSet,
  completeSets,
  folderFor,
  manifestFor,
  altFor,
  coverFor,
  heroFiles,
  heroSet,
  tradesWithImages,
};
