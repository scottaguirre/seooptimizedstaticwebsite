// utils/localOptions/csvBatch.js
//
// Turn one filled-in wizard form plus a CSV of businesses into the batch
// /api/generate-batch already accepts.
//
//   expand({ csv, template, domains, designs })
//     -> { rows: [...], errors: [...] }
//
//
// WHAT THIS IS NOT
//
// It is not a batch builder. routes/generateBatchRoute.js validates and
// enqueues, utils/batchGenerator.js builds them one after another in a
// single job, and both existed before this file. The repetition this
// removes is at the KEYBOARD: today a seven-site batch means filling the
// same form seven times, changing three fields each pass.
//
//     THE SHAPE IT PRODUCES IS THE SHAPE THAT ROUTE ALREADY TAKES —
//     a flat `global[...]` entry per site, exactly as the browser's
//     FormData capture produces. Anything else would be a second
//     format to keep in step with the first.
//
//
// THE REASON THE PREVIEW IS A GUARD AND NOT A COURTESY
//
// Edwin, 19 November, gave the columns as "category/trade, business name,
// address, phone". The first one is why this file validates at all.
//
// Only three trades have photographs for this mode — air-conditioning,
// plumbing and lemon-law. A build for any other one DOES NOT FAIL. It logs
//
//     localOptions.heroesMissing   trade: roofing   found: 0
//
// and carries on, publishing a site with four missing hero images after the
// credits are spent. Nothing downstream refuses it, because by then it is
// just a build with some files absent.
//
//     A ROW THAT WOULD PRODUCE A BROKEN SITE HAS TO BE REFUSED
//     BEFORE IT IS QUEUED, BECAUSE AFTERWARDS NOTHING WILL.
//
// So every row is checked here, the caller shows what it got, and a batch
// is only sent once somebody has seen the pairing.

'use strict';

const fs = require('fs');
const path = require('path');

const { normalisePrefix } = require('../dnsLabel');

/** Where the per-trade photograph folders live. */
const IMAGES_ROOT = path.join(
  __dirname, '..', '..', 'src', 'predefined-images', 'local-website-options');

/**
 * The most rows one CSV may carry.
 *
 * TEN, BECAUSE THAT IS generateBatchRoute's MAX_SITES. A CSV that parsed
 * twelve rows cleanly and was then refused by the route would be a file
 * this screen said was fine and the next one did not.
 *
 * NOT IMPORTED FROM THE ROUTE, deliberately: that module pulls in Express,
 * the Job model and a Mongo connection, and this one is a pure function
 * with a suite that runs in a tenth of a second. test-csv-batch.js asserts
 * the two numbers agree.
 */
const MAX_ROWS = 10;

/**
 * The seven columns, in order.
 *
 * Edwin gave five on 19 November — "category/trade, business name, address,
 * phone" plus a city — and the other two are the server's, not a
 * preference. validateGlobalFields() requires `email`, and localAddress()
 * requires street, city, state AND zip, with the zip checked as five
 * digits. A file without them would be refused row by row by the route
 * after this screen had said it was fine.
 *
 * CITY AND STATE SHARE A CELL because that is how somebody writes a place:
 * `Austin, TX`. The zip does not join them — Edwin's call, 20 November —
 * so there is one split to get wrong rather than two.
 */
const COLUMNS = ['trade', 'city', 'zip', 'businessName', 'street', 'phone', 'email'];

/**
 * What the template and the screen CALL those columns.
 *
 * SPLIT FROM COLUMNS ON 20 NOVEMBER, and Edwin's question is why: *"should
 * the second column read 'city + St'?"*
 *
 * It should, and the reason the heading was wrong is that one list was
 * doing two jobs. COLUMNS is the FIELD ORDER — what cell(1) means — and it
 * was also being printed as the heading, so the label for a cell that must
 * contain "Austin, TX" read `city`. Somebody reading that types `Austin`
 * and has the row refused by a screen that told them what to put there.
 *
 *     A FIELD NAME IS FOR THE CODE AND A HEADING IS FOR THE
 *     PERSON FILLING IT IN. THEY AGREE UNTIL ONE OF THEM
 *     HAS SOMETHING TO EXPLAIN.
 *
 * `businessName` was the same fault, more quietly: nobody types a camelCase
 * heading into a spreadsheet, they just wonder whether it matters.
 *
 * NO COMMAS IN ANY OF THEM. These are joined with commas to make the
 * template's first line, and a heading containing one would need quoting —
 * a heading row that is itself a CSV puzzle. "city and state", not
 * "city, state".
 *
 * test-csv-batch.js asserts the two lists stay the same length, because a
 * heading added without a field, or the reverse, would silently shift every
 * column after it.
 */
const HEADINGS = [
  'trade',
  'city and state',
  'zip',
  'business name',
  'address',
  'phone',
  'email',
];

/** `Austin, TX` -> { city: 'Austin', state: 'TX' }; anything else -> nulls. */
function splitPlace(cell) {
  const text = clean(cell);
  const at = text.lastIndexOf(',');

  if (at < 0) return { city: '', state: '' };

  return {
    city: clean(text.slice(0, at)),
    /* UPPERCASED HERE because localAddress() does the same before it checks
     * the code, and a preview showing `tx` beside a build that stored `TX`
     * is a difference somebody would try to explain. */
    state: clean(text.slice(at + 1)).toUpperCase(),
  };
}

/* FIVE DIGITS, THE SAME SHAPE localAddress() ENFORCES. Checked here so the
 * row is refused beside its line number rather than by the route, which
 * reports against a field name in a batch nobody can see. */
const ZIP = /^\d{5}$/;

/* DELIBERATELY LOOSE. This is not the place to litigate what an address
 * is — the route and the mail server both have opinions — but a cell with
 * no @ in it is a column somebody has shifted, and that is worth catching
 * while the line number is still on screen. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Which trades this mode can actually build.
 *
 * READ FROM DISK, NOT LISTED. A hard-coded array would be a second place
 * that decides what is buildable, wrong the first time a folder is added —
 * and adding a folder is exactly how this list is meant to grow.
 *
 * A FOLDER WITH NO PHOTOGRAPHS IN IT IS NOT A TRADE. There are empty ones
 * in the tree, and a name is not an image.
 */
function tradesWithImages(root = IMAGES_ROOT) {
  let entries;

  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    return [];
  }

  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter((name) => {
      try {
        return fs.readdirSync(path.join(root, name))
          .some(child => /^set-\d+$/.test(child));
      } catch (err) {
        return false;
      }
    })
    .sort();
}

/**
 * A CSV into rows of cells.
 *
 * WRITTEN HERE RATHER THAN SHARED WITH utils/blog/csvTopics.js, and the
 * reason is in that file: csvToTopicLines() returns JOINED STRINGS, not
 * cells, and its own source is emitted verbatim into a page by
 * browserSource(). Splitting a cell parser out of it would change what that
 * page receives, to save a dozen lines here.
 *
 * THE BOM IS STRIPPED. Excel writes one and nothing shows it; left in
 * place it would ride along inside the first cell, so the first row's trade
 * would stop matching a folder name for no visible reason.
 *
 * AND IT IS BELT AND BRACES — A MUTANT PROVED IT. Removing this line
 * changed no test, because U+FEFF IS WHITESPACE TO String.trim(), and every
 * cell reaches the rules through clean(). The strip is kept because it is
 * one call and the alternative is a correctness argument that depends on a
 * trim three functions away, but nothing here is relying on it today.
 *
 *     SAYING A LINE IS DEFENSIVE IS HONEST. CLAIMING A TEST
 *     COVERS IT WHEN AN EQUIVALENT MUTANT SURVIVES IS NOT.
 */
function parseRows(text) {
  const s = String(text == null ? '' : text).replace(/^﻿/, '');

  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < s.length; i += 1) {
    const ch = s.charAt(i);

    if (quoted) {
      /* "" INSIDE A QUOTED FIELD IS ONE QUOTE, which is how every
       * spreadsheet writes a literal one. Reading it as the end of the
       * field turns the rest of the row into columns nobody asked for. */
      if ('"' === ch) {
        if ('"' === s.charAt(i + 1)) { cell += '"'; i += 1; } else { quoted = false; }
      } else {
        cell += ch;           // a newline in here belongs to the field
      }
      continue;
    }

    if ('"' === ch) { quoted = true; continue; }
    if (',' === ch) { row.push(cell); cell = ''; continue; }

    if ('\n' === ch || '\r' === ch) {
      /* \r\n IS ONE LINE ENDING. Counting it as two would give every row a
       * blank one after it, and the line numbers this reports would stop
       * matching the ones the spreadsheet shows.
       *
       * ALSO BELT AND BRACES TODAY, and a mutant said so: the empty rows it
       * would produce are dropped by the filter at the end of this
       * function, so skipping the \n changes nothing observable. Kept for
       * the same reason as the BOM — it is one character of lookahead, and
       * the filter is not where line endings should be decided. */
      if ('\r' === ch && '\n' === s.charAt(i + 1)) i += 1;

      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += ch;
  }

  row.push(cell);
  rows.push(row);

  /* A ROW OF NOTHING IS NOT A ROW. A file ending in a newline produces one,
   * and so does a blank line somebody left in the middle. */
  return rows.filter(cells => cells.some(c => String(c).trim()));
}

/* DECLARED ABOVE ITS FIRST CALLER'S DEFINITION BUT BELOW NOTHING THAT RUNS
 * AT LOAD. splitPlace() is a function declaration and hoists; this is a
 * const and does not, so the order matters only if something called
 * splitPlace() while this module was still being evaluated. Nothing does. */
const clean = (value) => String(value == null ? '' : value).trim();

/**
 * The slug the wizard would have derived from a typed business name.
 *
 * THE SAME FOUR OPERATIONS, IN THE SAME ORDER, as the `slug` closure in
 * renderCloudflareFields(). A CSV row and a typed one must produce the same
 * address, or the preview shows a prefix the wizard would not have offered.
 *
 * normalisePrefix() IS STILL THE JUDGE. This produces a candidate; that
 * function decides whether it is a DNS label — it is the one that refuses
 * `www`, and nothing here should learn that rule a second time.
 */
function prefixFrom(businessName) {
  return clean(businessName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

/**
 * Whether the first parsed row is column headings rather than a business.
 *
 * ASKED OF THE DATA, NOT OF THE USER. "Does your CSV have a header?" is a
 * question with a wrong answer available, and the file already says: a
 * heading row names a column, and a column name is not a trade this app can
 * build. So a first row whose trade cell is not a known trade is a header —
 * and a one-row file whose trade is unknown is a bad row, which the caller
 * reports as such rather than silently swallowing as a heading.
 */
function looksLikeHeader(rows, trades) {
  if (!rows.length) return false;

  const first = clean(rows[0][0]).toLowerCase();

  if (trades.includes(first)) return false;

  /* ONLY WHEN THERE IS SOMETHING UNDERNEATH IT. A single unknown row is a
   * mistake worth reporting, not a header with no body — and treating it as
   * a header would produce "no rows found" for a file that plainly has
   * one. */
  return rows.length > 1;
}

/**
 * One wizard submission, built from the template and this row.
 *
 * THE TEMPLATE IS COPIED AND FOUR KEYS ARE OVERWRITTEN. Everything else —
 * the city, the hours, the service areas, the legal ticks, the logo choice
 * — is whatever was on the form when the CSV was uploaded, which is the
 * whole point: those are the answers that do not change between the seven.
 */
function entryFor(row) {
  return {
    /* THE MODE, FIRST AND EXPLICITLY. This screen has no step 1 and no
     * cards to pick from — it builds Local Website Options sites and
     * nothing else — so the value that every other door gets from a radio
     * button is written here. validateGlobalFields() reads it to decide
     * which address fields to demand. */
    'global[siteMode]': 'localoptions',

    /* THE DESTINATION, AND IT IS NOT IMPLIED BY THE MODE.
     *
     * Cloudflare is a DESTINATION, not a mode. /cloudflare-sites/new locks
     * no mode at all, and a Local Website Options build carrying no
     * siteTarget is a perfectly legal build that stays in the build folder
     * and publishes nowhere. So the mode being right says NOTHING about
     * where the site goes, and vetOne() asks the two questions separately
     * because they are two questions.
     *
     * Leaving this out is what answered
     *
     *     Site 1 is not addressed to Cloudflare.
     *
     * on a batch whose mode check had just passed — the symptom pointing
     * at the line above the one at fault.
     *
     *     THE WIZARD POSTS THIS FROM A HIDDEN INPUT IT WRITES ON STEP 1.
     *     There is no form behind this screen to write it, so it is
     *     written here. */
    'global[siteTarget]': 'cloudflare',

    'global[businessType]': row.trade,
    'global[businessName]': row.businessName,

    /* THE FOUR PARTS, NOT THE COMPOSED STRINGS. generateBatchRoute calls
     * localAddress(global) and writes `address` and `location` back itself
     * — composing them here would be a second copy of that formatting,
     * and the first one is the one the build actually stores. */
    'global[street]': row.street,
    'global[city]': row.city,
    'global[state]': row.state,
    'global[zip]': row.zip,

    'global[phone]': row.phone,
    'global[email]': row.email,

    /* THE DEFAULTS EDWIN SET FOR THIS DOOR, 20 November. There is no form
     * to carry them: a batch screen that asked for a logo style and an
     * opening-hours table would be the wizard again, which is the thing
     * this exists instead of.
     *
     * NO SERVICE AREAS, and that is a decision rather than an omission —
     * "each website is just for one city". renderSite draws no town list
     * and writes no areaServed when the list is empty, which was checked
     * rather than assumed. */
    'global[is24Hours]': 'true',
    'global[logoSource]': 'wordmark',
    'global[logoType]': 'wide',

    'global[design]': row.design,

    /* THE REVIEW STEP'S THREE FIELDS, ALL THREE.
     *
     * checkWant() refuses with `badName` unless it has BOTH a name and a
     * subdomain — `if (!name || !prefix)` — so a batch carrying the prefix
     * alone is refused before anybody is charged, for a field the CSV
     * never mentions.
     *
     * The business name is the name: it is what the wizard's owner types
     * into that box, and it is what the My Websites list shows. */
    'global[cloudflare][name]': row.businessName,
    'global[cloudflare][domain]': row.domain,
    'global[cloudflare][prefix]': row.prefix,
  };
}

/**
 * A CSV into a batch of complete wizard submissions.
 *
 * @param {string} csv         the uploaded file's text
 * @param {string[]} domains   the pool, in the order the picker lists them
 * @param {string[]} designs   the layouts, in the order the picker lists them
 * @returns {{rows: object[], errors: object[], header: boolean}}
 *
 * EVERY BAD ROW IS REPORTED, NOT THE FIRST ONE. Somebody who pasted a
 * spreadsheet wants to fix the file once, and a parser that stops at the
 * first fault makes that seven round trips.
 *
 * AND A BATCH WITH ANY BAD ROW IS NOT BUILT — that is the caller's rule,
 * stated here because it is the reason this returns both lists rather than
 * throwing on the first problem.
 */
function expand({ csv, domains = [], designs = [], root = IMAGES_ROOT } = {}) {
  const trades = tradesWithImages(root);
  const parsed = parseRows(csv);
  const header = looksLikeHeader(parsed, trades);
  const body = header ? parsed.slice(1) : parsed;

  const rows = [];
  const errors = [];
  const taken = new Map();

  if (!body.length) {
    errors.push({ line: 0, reason: 'That file has no rows in it.' });
    return { rows, errors, header };
  }

  if (body.length > MAX_ROWS) {
    errors.push({
      line: 0,
      reason: `A batch can hold up to ${MAX_ROWS} websites. That file has ${body.length}.`,
    });
    return { rows, errors, header };
  }

  for (const [i, cells] of body.entries()) {
    /* THE LINE THE SPREADSHEET SHOWS, not the index in the array. Somebody
     * fixing a file is looking at row numbers in Excel, and an off-by-one
     * here sends them to the row above the mistake. */
    const line = i + 1 + (header ? 1 : 0);

    const cell = (n) => clean(cells[n]);

    const trade = cell(0);
    const place = splitPlace(cell(1));
    const zip = cell(2);
    const businessName = cell(3);
    const street = cell(4);
    const phone = cell(5);
    const email = cell(6);

    const fault = (reason) => errors.push({ line, reason });

    if (!trade) { fault('No trade in the first column.'); continue; }

    if (!trades.includes(trade.toLowerCase())) {
      /* NAMED, AND THE ALTERNATIVES LISTED. "Unknown trade" sends somebody
       * looking for a spelling mistake when the real answer is that this
       * mode has photographs for three trades and theirs is not one. */
      fault(`There are no photographs for "${trade}". `
        + `This builder can make ${trades.join(', ')}.`);
      continue;
    }

    if (!place.city || !place.state) {
      fault(`"${cell(1)}" is not a town and a state. Write it as "Austin, TX".`);
      continue;
    }

    if (2 !== place.state.length) {
      fault(`"${place.state}" is not a two-letter state code, e.g. TX.`);
      continue;
    }

    if (!ZIP.test(zip)) {
      /* THE ROUTE WOULD CATCH THIS, and it would catch it against a field
       * name in a batch of seven with no line numbers on screen. A blank
       * and a four-digit one read the same here on purpose: both are "the
       * zip column is wrong on this row". */
      fault(`"${zip}" is not a 5-digit ZIP code, e.g. 78729.`);
      continue;
    }

    if (!businessName) { fault('No business name.'); continue; }
    if (!street) { fault('No street address.'); continue; }
    if (!phone) { fault('No phone number.'); continue; }

    if (!EMAIL.test(email)) {
      fault(`"${email}" is not an email address. Every website needs one `
        + 'for its contact page.');
      continue;
    }

    const prefix = normalisePrefix(prefixFrom(businessName));

    if (!prefix) {
      fault(`"${businessName}" does not make a usable address. `
        + 'It needs letters or digits in it, and cannot be "www".');
      continue;
    }

    if (taken.has(prefix)) {
      /* TWO ROWS, ONE ADDRESS. The route would refuse the second one after
       * the first had been accepted, which is a batch that half exists. */
      fault(`"${businessName}" makes the same address as row ${taken.get(prefix)}: ${prefix}.`);
      continue;
    }

    const domain = domains[rows.length];

    if (!domain) {
      fault(`There is no domain left for this row — the list has ${domains.length}.`);
      continue;
    }

    const design = designs[rows.length];

    if (!design) {
      fault(`There is no layout left for this row — there are ${designs.length}.`);
      continue;
    }

    taken.set(prefix, line);

    const row = {
      line,
      trade: trade.toLowerCase(),
      businessName,
      street,
      city: place.city,
      state: place.state,
      zip,
      phone,
      email,
      prefix,
      domain,
      design,
      address: `${prefix}.${domain}`,
    };

    row.entry = entryFor(row);

    rows.push(row);
  }

  return { rows, errors, header };
}

module.exports = {
  expand,
  parseRows,
  prefixFrom,
  looksLikeHeader,
  tradesWithImages,
  splitPlace,
  entryFor,
  COLUMNS,
  HEADINGS,
  MAX_ROWS,
  IMAGES_ROOT,
};
