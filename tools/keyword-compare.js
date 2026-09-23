#!/usr/bin/env node
//
// tools/keyword-compare.js
//
//   Google Keyword Planner  vs  DataForSEO, same keywords, side by side.
//
// WHY THIS EXISTS
//
// The plan is to show customers real search volumes before they choose their
// service pages. Google's own API can serve that, but KeywordPlanIdeaService
// is Restricted Functionality: Basic access cannot call it, and Standard
// access is a manual audit of about ten business days.
//
// DataForSEO's keywords_data/google_ads endpoints are a passthrough to that
// same Google API — they hold the token and the Standard access. If their
// numbers match what Edwin sees in his own Keyword Planner, the feature ships
// this week instead of next month.
//
// THE QUESTION THIS ANSWERS, AND THE ONE IT DOES NOT
//
// Keyword Planner shows exact figures (720) to accounts running a campaign
// with enough spend, and buckets (500-1K) to everyone else. Edwin's account
// spends, so his screen shows exact numbers. DataForSEO calls Google with
// THEIR accounts, not his — so whether the precision survives the trip is an
// empirical question that no documentation on either side answers.
//
// This script answers it with numbers. It does not answer whether either
// source is "right": they are the same upstream data, so a disagreement means
// the granularity differs, not that one is wrong.
//
// WHAT YOU NEED
//
//   1. A CSV from Keyword Planner. The download icon at the top right of the
//      ideas table -> "Plan historical metrics" or the keyword ideas export.
//      Google writes UTF-16, tab-separated, with a title line above the
//      header; this reads that without you converting anything.
//
//   2. A DataForSEO account. Sign up yourself — this script will not do it.
//      Credentials go in the environment, never in a file in this repo:
//
//        export DATAFORSEO_LOGIN='you@example.com'
//        export DATAFORSEO_PASSWORD='...'
//
// USAGE
//
//   node tools/keyword-compare.js planner.csv \
//     --location "Leander,Texas,United States" \
//     --from 2025-09 --to 2026-08
//
//   node tools/keyword-compare.js planner.csv --dry-run   # spends nothing
//   node tools/keyword-compare.js --self-test             # parser only
//
// COST
//
// One call, 9 cents, for up to 1000 keywords — DataForSEO bills per task, not
// per keyword. --limit exists for trial credit, not for the bill.

'use strict';

const fs = require('fs');

const ENDPOINT =
  'https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live';

/** DataForSEO's own cap. Sending more is an error, not a truncation. */
const MAX_KEYWORDS = 1000;

/* ------------------------------------------------------------------ *
 * Reading Google's export
 * ------------------------------------------------------------------ */

/**
 * Keyword Planner's CSV is not a CSV.
 *
 * It is UTF-16 little-endian, tab-separated, and the first line is a title
 * ("Keyword Stats 2026-09-21 at 23_04_11") with the real header below it.
 * Opening it in a spreadsheet hides all three facts, which is why a parser
 * written from what the spreadsheet shows fails on the actual file.
 */
function decode(buffer) {
  // UTF-16 LE byte order mark.
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString('utf16le').slice(1);
  }
  // UTF-8 BOM.
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.toString('utf8').slice(1);
  }
  return buffer.toString('utf8');
}

/** Tab or comma, whichever the header row actually uses. */
function delimiterOf(line) {
  return line.split('\t').length > line.split(',').length ? '\t' : ',';
}

/** Split one row, honouring quotes. Google quotes anything with a comma. */
function splitRow(line, delimiter) {
  const cells = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
      continue;
    }

    if (ch === delimiter && !quoted) { cells.push(cell); cell = ''; continue; }

    cell += ch;
  }

  cells.push(cell);
  return cells.map(c => c.trim());
}

/**
 * "1,300" -> 1300. "1K" -> 1000. "100 – 1K" -> {low: 100, high: 1000}.
 *
 * The range form is what Keyword Planner shows an account that is not
 * spending. Edwin's shows exact numbers, but the parser has to cope with both
 * or it silently reads a range as NaN and reports every row as missing.
 */
function parseVolume(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text || text === '-' || text === '--' || text === '0') {
    return { value: text === '0' ? 0 : null, range: null };
  }

  const dash = text.split(/\s*[–—-]\s*/);

  if (dash.length === 2) {
    const low = parseScaled(dash[0]);
    const high = parseScaled(dash[1]);
    if (low === null || high === null) return { value: null, range: null };
    return { value: null, range: { low, high } };
  }

  return { value: parseScaled(text), range: null };
}

function parseScaled(raw) {
  const text = String(raw).replace(/[,\s]/g, '').toUpperCase();
  const m = text.match(/^([\d.]+)([KM]?)$/);
  if (!m) return null;

  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;

  return m[2] === 'M' ? n * 1e6 : m[2] === 'K' ? n * 1e3 : n;
}

/** Money, as exported: "$29.90", "29.90", "". */
function parseMoney(raw) {
  const text = String(raw == null ? '' : raw).replace(/[$,\s]/g, '');
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * Find the header row by looking for the keyword column, rather than
 * assuming it is line 1 or line 3. Google has moved it before.
 */
function readPlannerCsv(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');

  const headerAt = lines.findIndex(line => {
    const lower = line.toLowerCase();
    return lower.includes('keyword') && lower.includes('searches');
  });

  if (headerAt === -1) {
    throw new Error(
      'No header row found. Expected a line containing both "Keyword" and '
      + '"searches" — is this a Keyword Planner export?'
    );
  }

  const delimiter = delimiterOf(lines[headerAt]);
  const header = splitRow(lines[headerAt], delimiter).map(h => h.toLowerCase());

  const find = (...needles) =>
    header.findIndex(h => needles.every(n => h.includes(n)));

  const col = {
    keyword: find('keyword'),
    volume:  find('avg', 'searches'),
    low:     find('low range'),
    high:    find('high range'),
    comp:    header.findIndex(h => h === 'competition'),
  };

  if (col.keyword === -1) throw new Error('No keyword column in the header.');
  if (col.volume === -1) {
    throw new Error('No "Avg. monthly searches" column in the header.');
  }

  const rows = [];

  for (const line of lines.slice(headerAt + 1)) {
    const cells = splitRow(line, delimiter);
    const keyword = (cells[col.keyword] || '').trim();

    // Google writes section labels ("Keyword ideas", "Keywords you provided")
    // as rows with a label and nothing else. A row with no volume column at
    // all is one of those; a row with an EMPTY volume is a real keyword with
    // no data, and must be kept.
    if (!keyword) continue;
    if (cells.length <= col.volume) continue;

    const volume = parseVolume(cells[col.volume]);

    rows.push({
      keyword,
      volume: volume.value,
      range: volume.range,
      low: col.low === -1 ? null : parseMoney(cells[col.low]),
      high: col.high === -1 ? null : parseMoney(cells[col.high]),
      competition: col.comp === -1 ? '' : (cells[col.comp] || '').trim(),
    });
  }

  // The same keyword can appear under both "Keywords you provided" and
  // "Keyword ideas". Keep the first; they carry the same metrics.
  const seen = new Set();
  return rows.filter(r => {
    const key = r.keyword.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * Asking DataForSEO
 * ------------------------------------------------------------------ */

async function fetchDataForSeo(keywords, opts) {
  // One task, one array of keywords. Billing is per task, so splitting the
  // list would multiply the cost for no benefit.
  const task = {
    keywords,
    language_name: opts.language,
    // date_to cannot reach into the current month; Google has not closed it.
    date_from: `${opts.from}-01`,
    date_to: endOfMonth(opts.to),
    search_partners: false,
  };

  // location_code is exact where a name can be ambiguous, so allow either.
  if (/^\d+$/.test(opts.location)) task.location_code = Number(opts.location);
  else task.location_name = opts.location;

  if (opts.dryRun) {
    console.log('\nWould POST to ' + ENDPOINT + ':\n');
    console.log(JSON.stringify([task], null, 2));
    console.log(`\n(${keywords.length} keywords, one task, nothing spent.)\n`);
    return null;
  }

  // Checked AFTER the dry run, deliberately: the point of --dry-run is to
  // see what would be sent before you have an account, and an earlier check
  // made it refuse for want of credentials it was never going to use.
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;

  if (!login || !password) {
    throw new Error(
      'Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in the environment.\n'
      + '  Get them from https://app.dataforseo.com/api-access\n'
      + '  Do not put them in a file in this repo.'
    );
  }

  const auth = Buffer.from(`${login}:${password}`).toString('base64');

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([task]),
  });

  const body = await res.json();

  if (!res.ok) {
    throw new Error(`DataForSEO returned HTTP ${res.status}: `
      + JSON.stringify(body).slice(0, 400));
  }

  // Their transport is always 200 at the top level; the real status is inside.
  const t = (body.tasks || [])[0];
  if (!t) throw new Error('DataForSEO returned no task: ' + JSON.stringify(body).slice(0, 400));

  if (t.status_code !== 20000) {
    throw new Error(`DataForSEO task failed ${t.status_code}: ${t.status_message}`);
  }

  const out = new Map();
  for (const item of t.result || []) {
    if (item && item.keyword) out.set(String(item.keyword).toLowerCase(), item);
  }

  console.log(`\nDataForSEO: ${out.size} keywords back, cost $${t.cost ?? '?'}.`);
  return out;
}

function endOfMonth(yyyymm) {
  const [y, m] = yyyymm.split('-').map(Number);
  return `${yyyymm}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ *
 * The comparison
 * ------------------------------------------------------------------ */

function pad(text, width, right = false) {
  const s = String(text == null ? '' : text);
  const gap = Math.max(0, width - s.length);
  return right ? ' '.repeat(gap) + s : s + ' '.repeat(gap);
}

/**
 * Below this, Google is rounding to the nearest ten and a 10-vs-0 flip means
 * nothing. The first run over Leander made the point: 722 comparable rows, of
 * which the overwhelming majority were 10 or 0 on both sides, and every flip
 * between them scored as a 100% error. The median came out at 100% while the
 * head terms matched to the unit.
 *
 * So the summary splits them. Anything at or under this is counted, not
 * averaged.
 */
const NOISE_FLOOR = 40;

/**
 * The values Keyword Planner falls back on when it will not give a real
 * number. If the answers cluster on these, that is bucketing — the thing this
 * whole exercise exists to detect — and no amount of "close enough" rescues it.
 */
const BUCKET_VALUES = new Set([100, 500, 1000, 5000, 10000, 50000, 100000]);

function report(rows, found, aboveOnly = false) {
  const cols = [38, 10, 10, 9, 9, 9];
  const head = ['keyword', 'Google', 'DataForSEO', 'diff', 'G $low', 'D $low'];

  console.log('');
  if (aboveOnly) {
    console.log(`  Showing only the rows above ${NOISE_FLOOR}/month. Everything else is`);
    console.log('  still counted in the summary.');
    console.log('');
  }
  console.log(head.map((h, i) => pad(h, cols[i], i > 0)).join('  '));
  console.log(cols.map(w => '-'.repeat(w)).join('  '));

  const diffs = [];            // above the floor only
  let exact = 0, missing = 0, compared = 0;
  let headExact = 0, headCompared = 0, floorRows = 0;
  let bigValues = 0, roundValues = 0;
  let cpcPairs = 0, cpcExact = 0;

  for (const row of rows) {
    const d = found.get(row.keyword.toLowerCase());

    const googleShown = row.range
      ? `${row.range.low}-${row.range.high}`
      : (row.volume == null ? '—' : row.volume);

    const dfsVolume = d && d.search_volume != null ? d.search_volume : null;

    let diff = '';

    if (!d) {
      missing++;
      diff = 'not found';
    } else if (row.volume != null && dfsVolume != null) {
      compared++;

      const atFloor = row.volume <= NOISE_FLOOR && dfsVolume <= NOISE_FLOOR;
      if (atFloor) floorRows++;

      if (row.volume === dfsVolume) {
        exact++;
        if (!atFloor) { headExact++; headCompared++; }
        diff = 'exact';
      } else if (row.volume === 0) {
        diff = '—';
      } else {
        const pct = ((dfsVolume - row.volume) / row.volume) * 100;
        if (!atFloor) { headCompared++; diffs.push(Math.abs(pct)); }
        diff = `${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`;
      }

      // The bucketing check, over values big enough for a bucket to exist.
      if (dfsVolume >= 100) {
        bigValues++;
        if (BUCKET_VALUES.has(dfsVolume)) roundValues++;
      }
    } else {
      diff = '—';
    }

    // CPC agreement is a second, independent witness. Volumes can drift with
    // the date window; a bid that matches to the cent did not come from a
    // different dataset.
    const dLow = d && d.low_top_of_page_bid != null
      ? Number(d.low_top_of_page_bid) : null;

    if (row.low != null && dLow != null) {
      cpcPairs++;
      if (Math.abs(row.low - dLow) < 0.005) cpcExact++;
    }

    // Hide the floor when asked, but only AFTER it has been counted — the
    // summary's whole point is that the floor is most of the file.
    const interesting =
      (row.volume != null && row.volume > NOISE_FLOOR) ||
      (dfsVolume != null && dfsVolume > NOISE_FLOOR);

    if (!aboveOnly || interesting) {
      console.log([
        pad(row.keyword.slice(0, cols[0]), cols[0]),
        pad(googleShown, cols[1], true),
        pad(dfsVolume == null ? '—' : dfsVolume, cols[2], true),
        pad(diff, cols[3], true),
        pad(row.low == null ? '—' : row.low.toFixed(2), cols[4], true),
        pad(dLow == null ? '—' : dLow.toFixed(2), cols[5], true),
      ].join('  '));
    }
  }

  diffs.sort((a, b) => a - b);
  const median = diffs.length
    ? diffs[Math.floor(diffs.length / 2)].toFixed(1) + '%'
    : 'n/a';

  const bucketed = bigValues >= 10 && roundValues / bigValues > 0.6;

  console.log('');
  console.log(`  ${rows.length} keywords from Google, ${found.size} matched by DataForSEO`);
  console.log(`  ${exact} exact of ${compared} comparable`);
  console.log(`  ${floorRows} of those sit at or under ${NOISE_FLOOR}/month, where Google`);
  console.log(`    rounds to tens — a 10-vs-0 flip there is noise, not disagreement`);
  console.log('');
  console.log(`  ABOVE THE FLOOR: ${headExact} exact of ${headCompared}`
    + `, median difference ${median}`);
  console.log(`  BUCKETING: ${roundValues} of ${bigValues} answers over 100 land on a`
    + ` round bucket value`);
  if (cpcPairs) {
    console.log(`  TOP-OF-PAGE BID: ${cpcExact} of ${cpcPairs} match to the cent`);
  }
  if (missing) console.log(`  ${missing} not returned by DataForSEO`);

  // THE ACTUAL QUESTION. Read this, not the median.
  console.log('');
  if (compared === 0) {
    console.log('  VERDICT: nothing comparable. Check the location and date range match.');
  } else if (bucketed) {
    console.log('  VERDICT: BUCKETED. The answers are clustering on round values, so');
    console.log('           the precision did not survive. Wait for Google Standard access.');
  } else if (headCompared === 0) {
    console.log('  VERDICT: no bucketing, but every keyword here is at the reporting');
    console.log('           floor, so there is nothing to judge precision by. Re-run');
    console.log('           with a larger town, or at metro level.');
  } else if (headExact / headCompared >= 0.7) {
    console.log('  VERDICT: DataForSEO is returning the same precision as your Keyword');
    console.log('           Planner, to the unit. Build on it.');
  } else {
    // THE FIRST SUSPECT IS THE LOCATION, and it cost an evening to learn.
    //
    // The export carries no location, so nothing here can check that the
    // --location flag names the same town as the plan the CSV came from. On
    // 22 September a Cedar Park export was compared against Leander: every
    // head term disagreed, every bid disagreed, and both sides were right
    // about different towns. Re-running with the matching location closed it.
    //
    // Date range is the second suspect, and the bid column tells them apart:
    // the same town over different months keeps the bids close, while a
    // different town moves volume and bid together.
    console.log('  VERDICT: not bucketed, but the volumes differ above the floor.');
    console.log('           FIRST check --location names the same town as the plan the');
    console.log('           CSV came from. The export does not carry its own location,');
    console.log('           so nothing here can catch that mismatch for you, and it');
    console.log('           makes every head term disagree exactly like this.');
    console.log('           If the town is right, suspect the date range next — and');
    console.log('           read the bid column: bids that move WITH the volumes point');
    console.log('           at a different place, bids that hold roughly steady point');
    console.log('           at different months.');
  }
  console.log('');
}

/* ------------------------------------------------------------------ *
 * The parser's own tests
 * ------------------------------------------------------------------ *
 *
 * Inline rather than in a test-*.js file, because this tool is not part of
 * the app and has no business being in deploy.sh's suite list. It is still
 * the part most likely to break — Google's export format is theirs to change.
 */
function selfTest() {
  const assert = require('assert');
  let passed = 0, failed = 0;

  const test = (name, fn) => {
    try { fn(); console.log(`  ok    ${name}`); passed++; }
    catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
  };

  console.log('\nkeyword-compare: the Keyword Planner parser\n');

  test('reads the tab-separated export, title line and all', () => {
    const csv = [
      'Keyword Stats 2026-09-21 at 23_04_11',
      'Keyword\tCurrency\tAvg. monthly searches\tCompetition\tTop of page bid (low range)\tTop of page bid (high range)',
      'plumbers near me\tUSD\t720\tMedium\t$29.90\t$123.77',
      'plumber\tUSD\t210\tLow\t$29.04\t$110.45',
    ].join('\n');

    const rows = readPlannerCsv(csv);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].keyword, 'plumbers near me');
    assert.strictEqual(rows[0].volume, 720);
    assert.strictEqual(rows[0].low, 29.90);
    assert.strictEqual(rows[1].volume, 210);
  });

  test('drops the section labels Google writes between blocks', () => {
    const csv = [
      'Keyword\tAvg. monthly searches',
      'Keyword ideas',
      'drain cleaning\t90',
    ].join('\n');

    const rows = readPlannerCsv(csv);
    assert.strictEqual(rows.length, 1, 'a section label came through as a keyword');
    assert.strictEqual(rows[0].keyword, 'drain cleaning');
  });

  test('keeps a real keyword whose volume cell is empty', () => {
    // Not the same thing as a label. Dropping these hides exactly the rows
    // the small-town question is about.
    const csv = [
      'Keyword\tAvg. monthly searches',
      'sewer line replacement\t',
    ].join('\n');

    const rows = readPlannerCsv(csv);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].volume, null);
  });

  test('reads a comma-separated export too', () => {
    const csv = 'Keyword,Avg. monthly searches\n"plumber, emergency",1300';
    const rows = readPlannerCsv(csv);
    assert.strictEqual(rows[0].keyword, 'plumber, emergency');
    assert.strictEqual(rows[0].volume, 1300);
  });

  test('understands the bucketed form a non-spending account gets', () => {
    assert.deepStrictEqual(parseVolume('100 – 1K').range, { low: 100, high: 1000 });
    assert.deepStrictEqual(parseVolume('1K-10K').range, { low: 1000, high: 10000 });
  });

  test('scales K and M, and strips thousands separators', () => {
    assert.strictEqual(parseScaled('1,300'), 1300);
    assert.strictEqual(parseScaled('2.5K'), 2500);
    assert.strictEqual(parseScaled('1M'), 1000000);
  });

  test('a zero volume is zero, not missing', () => {
    // These differ in the report: 0 is an answer, null is no answer.
    assert.strictEqual(parseVolume('0').value, 0);
    assert.strictEqual(parseVolume('').value, null);
    assert.strictEqual(parseVolume('-').value, null);
  });

  test('de-duplicates a keyword listed in two sections', () => {
    const csv = [
      'Keyword\tAvg. monthly searches',
      'plumber\t210',
      'Keyword ideas',
      'plumber\t210',
    ].join('\n');
    assert.strictEqual(readPlannerCsv(csv).length, 1);
  });

  test('says so when handed something that is not an export', () => {
    assert.throws(() => readPlannerCsv('nothing,useful\n1,2'), /header row/);
  });

  test('the last day of the month is right, February included', () => {
    assert.strictEqual(endOfMonth('2026-08'), '2026-08-31');
    assert.strictEqual(endOfMonth('2026-02'), '2026-02-28');
    assert.strictEqual(endOfMonth('2024-02'), '2024-02-29');
  });

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

/* ------------------------------------------------------------------ *
 * Entry
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const opts = {
    file: null,
    location: 'Leander,Texas,United States',
    language: 'English',
    from: '2025-09',
    to: '2026-08',
    limit: MAX_KEYWORDS,
    dryRun: false,
    selfTest: false,
    // Print only the rows worth looking at. The first Leander run put 709 of
    // 722 comparable rows at the floor, so the thirteen that decide the
    // question were buried in a thousand lines of 10-vs-0.
    aboveOnly: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];

    if (arg === '--self-test') opts.selfTest = true;
    else if (arg === '--above') opts.aboveOnly = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--location') opts.location = next();
    else if (arg === '--language') opts.language = next();
    else if (arg === '--from') opts.from = next();
    else if (arg === '--to') opts.to = next();
    else if (arg === '--limit') opts.limit = Number(next());
    else if (arg.startsWith('-')) throw new Error(`Unknown option ${arg}`);
    else opts.file = arg;
  }

  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.selfTest) return selfTest();

  if (!opts.file) {
    console.error(
      '\nusage: node tools/keyword-compare.js <planner-export.csv> [options]\n\n'
      + '  --location "Leander,Texas,United States"   or a numeric location code\n'
      + '  --language English\n'
      + '  --from 2025-09     --to 2026-08\n'
      + '  --limit 50         fewer keywords (for trial credit)\n'
      + '  --above            print only rows above the reporting floor\n'
      + '  --dry-run          print the request, spend nothing\n'
      + '  --self-test        run the parser\'s tests\n'
    );
    process.exit(1);
  }

  const rows = readPlannerCsv(decode(fs.readFileSync(opts.file)));

  if (!rows.length) throw new Error('No keywords found in that file.');

  const use = rows.slice(0, Math.min(opts.limit, MAX_KEYWORDS));

  console.log(`\n${rows.length} keywords in the export`
    + (use.length < rows.length ? `, comparing the first ${use.length}` : '')
    + `\nlocation: ${opts.location} · ${opts.from} to ${opts.to}`);

  const found = await fetchDataForSeo(use.map(r => r.keyword), opts);

  if (found) report(use, found, opts.aboveOnly);
}

main().catch(err => {
  console.error('\n' + err.message + '\n');
  process.exit(1);
});
