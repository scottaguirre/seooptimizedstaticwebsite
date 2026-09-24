#!/usr/bin/env node
//
// What the app spent, read from its own log.
//
//   node cost-report.js                      the last 30 days of logs/app.log
//   node cost-report.js --days 7
//   node cost-report.js --days 90 /path/to/app.log
//
// WHY THIS EXISTS
//
// The question is "do I need to charge for this?", and it went a week
// unanswered because answering it meant Edwin pasting fifty log lines into a
// chat and me adding them up by hand. That is not a mechanism; it is a
// mechanism-shaped habit that only works while somebody remembers.
//
// It also reads the WHOLE file rather than the tail. `tail -50` was how the
// first answer was reached, and fifty lines is whatever happened to be last —
// which on a quiet week is one customer and on a busy one is an hour.
//
// WHAT IT CANNOT DO
//
// Recover what is not in the log. These figures live in logs/app.log and
// nowhere else; a rotated or truncated file takes the history with it. If the
// numbers ever start mattering, they belong in a collection, not a file.
//
// WHY THE PER-USER LINE IS HERE AND NOT JUST THE TOTAL
//
// A total of $4 says "do not charge". A total of $4 where one account
// accounts for $3.50 of it says something completely different, and the
// total hides it. The decision this report feeds is about whether ONE
// customer can hurt you, so the busiest one gets a line of its own.

const fs = require('fs');
const path = require('path');
const readline = require('readline');

/* -------------------------------------------------------------------------
 * Prices
 * ---------------------------------------------------------------------- */

/**
 * WHAT THINGS COST, AND THESE GO STALE.
 *
 * OpenAI cut gpt-5.6-terra from $2.50/$15.00 to $2.00/$12.00 on 30 July 2026.
 * A hardcoded price with no date on it is a number nobody knows whether to
 * trust, so the date is part of the constant and the report prints it.
 *
 * Override without editing: MODEL_INPUT_PER_M / MODEL_OUTPUT_PER_M.
 */
const PRICES = {
  checked: '24 September 2026',
  model: {
    name: process.env.SUGGEST_MODEL || 'gpt-5.6-terra',
    inputPerMillion: Number(process.env.MODEL_INPUT_PER_M) || 2.00,
    outputPerMillion: Number(process.env.MODEL_OUTPUT_PER_M) || 12.00,
  },
  // DataForSEO bills per TASK, not per keyword — a task carrying one keyword
  // and a task carrying a thousand cost the same. The routes already work
  // this out and log costUsd, so this is only here to be printed.
  dataForSeoPerTask: 0.09,
};

/* -------------------------------------------------------------------------
 * The events that cost money
 * ---------------------------------------------------------------------- */

/**
 * Model calls, billed by the token.
 *
 * keywords.pairs and keywords.ideas also make a model call — the seed terms —
 * but do not log its tokens, so they cannot be counted here. Stated rather
 * than quietly omitted: this report is an UNDERCOUNT of the model bill, and
 * the fix is to log usage in utils/keywordSeeds the way the suggester does.
 */
const MODEL_EVENTS = new Set(['services.suggested']);

/** DataForSEO calls, billed per task and already costed in the log line. */
const VENDOR_EVENTS = new Set([
  'keywords.ideas',
  'keywords.exact',
  'keywords.pairs',
  'keywords.looked',
]);

/* -------------------------------------------------------------------------
 * Reading
 * ---------------------------------------------------------------------- */

function parseArgs(argv) {
  const args = argv.slice(2);
  let days = 30;
  let file = path.join(__dirname, 'logs', 'app.log');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days') {
      // Number(undefined) is NaN, and NaN days would silently report nothing.
      const value = Number(args[i + 1]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`--days needs a positive number, got "${args[i + 1]}"`);
      }
      days = value;
      i++;
    } else if (args[i] === '--json') {
      file = file; // handled by the caller reading opts.json
    } else if (!args[i].startsWith('--')) {
      file = args[i];
    }
  }

  return { days, file, json: args.includes('--json') };
}

/** A blank tally, so every field exists before anything is added to it. */
function emptyTotals() {
  return {
    model: {
      calls: 0, unmeasured: 0, inputTokens: 0, outputTokens: 0, usd: 0,
      byType: new Map(),
    },
    vendor: { calls: 0, paid: 0, cached: 0, usd: 0, byEvent: new Map() },
    // userId -> day -> { calls, usd }
    users: new Map(),
    firstAt: null,
    lastAt: null,
    lines: 0,
    unparsed: 0,
  };
}

function modelCost(inputTokens, outputTokens) {
  return (inputTokens / 1e6) * PRICES.model.inputPerMillion
    + (outputTokens / 1e6) * PRICES.model.outputPerMillion;
}

function noteUser(totals, userId, at, usd) {
  const who = userId || '(anonymous)';
  const day = at.slice(0, 10);

  if (!totals.users.has(who)) totals.users.set(who, new Map());
  const days = totals.users.get(who);

  const row = days.get(day) || { calls: 0, usd: 0 };
  row.calls++;
  row.usd += usd;
  days.set(day, row);
}

function add(totals, line) {
  totals.lines++;

  let row;
  try {
    row = JSON.parse(line);
  } catch (err) {
    // pino writes one JSON object per line, but a crash mid-write or a
    // half-flushed buffer can leave a partial one. One bad line must not end
    // the report.
    totals.unparsed++;
    return;
  }

  const at = String(row.time || '');
  const event = String(row.event || '');

  if (!at) return;
  if (!MODEL_EVENTS.has(event) && !VENDOR_EVENTS.has(event)) return;

  if (!totals.firstAt || at < totals.firstAt) totals.firstAt = at;
  if (!totals.lastAt || at > totals.lastAt) totals.lastAt = at;

  if (MODEL_EVENTS.has(event)) {
    const input = Number(row.inputTokens) || 0;
    const output = Number(row.outputTokens) || 0;
    const usd = modelCost(input, output);

    totals.model.calls++;
    totals.model.inputTokens += input;
    totals.model.outputTokens += output;
    totals.model.usd += usd;

    // Lines written before the token logging existed. Counted separately
    // rather than as zero, because "we did not measure it" and "it cost
    // nothing" are different facts and averaging them together is a lie.
    if (!row.inputTokens && !row.outputTokens) totals.model.unmeasured++;

    const type = String(row.businessType || '(none)');
    const byType = totals.model.byType.get(type) || { calls: 0, usd: 0, dropped: 0, count: 0 };
    byType.calls++;
    byType.usd += usd;
    byType.dropped += Number(row.dropped) || 0;
    byType.count += Number(row.count) || 0;
    totals.model.byType.set(type, byType);

    noteUser(totals, row.userId, at, usd);
    return;
  }

  const usd = Number(row.costUsd) || 0;

  totals.vendor.calls++;
  totals.vendor.usd += usd;
  if (usd > 0) totals.vendor.paid++; else totals.vendor.cached++;

  const byEvent = totals.vendor.byEvent.get(event) || { calls: 0, paid: 0, usd: 0 };
  byEvent.calls++;
  byEvent.usd += usd;
  if (usd > 0) byEvent.paid++;
  totals.vendor.byEvent.set(event, byEvent);

  noteUser(totals, row.userId, at, usd);
}

/** The one user-day that cost the most, which is the abuse signal. */
function busiestDay(totals) {
  let worst = null;

  for (const [userId, days] of totals.users) {
    for (const [day, row] of days) {
      if (!worst || row.usd > worst.usd || (row.usd === worst.usd && row.calls > worst.calls)) {
        worst = { userId, day, calls: row.calls, usd: row.usd };
      }
    }
  }

  return worst;
}

async function report({ days, file }) {
  const totals = emptyTotals();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  if (!fs.existsSync(file)) {
    const err = new Error(`No log file at ${file}`);
    err.missingLog = true;
    throw err;
  }

  // Streamed, not read whole. app.log has no rotation, so on a long-running
  // server it is the biggest file in the directory.
  const rl = readline.createInterface({
    input: fs.createReadStream(file, 'utf8'),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    // Cheap pre-filter: the time field is first in every pino line, so a line
    // older than the window is skipped without parsing it.
    if (line.indexOf('"time":"') !== -1) {
      const at = line.slice(line.indexOf('"time":"') + 8, line.indexOf('"time":"') + 32);
      if (at < since) continue;
    }
    add(totals, line);
  }

  return { totals, since, days };
}

/* -------------------------------------------------------------------------
 * Printing
 * ---------------------------------------------------------------------- */

const money = n => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
const count = n => Number(n).toLocaleString('en-US');

function format({ totals, days }) {
  const out = [];
  const users = totals.users.size;
  const total = totals.model.usd + totals.vendor.usd;

  out.push('');
  out.push(`Cost report — last ${days} days`);

  if (totals.firstAt) {
    out.push(`${totals.firstAt.slice(0, 10)} to ${totals.lastAt.slice(0, 10)}`
      + `  ·  ${count(totals.lines)} lines in window`);
  }

  // Surfaced rather than swallowed. A handful is a half-flushed write; a
  // steady stream means something is mangling the log and every figure below
  // is short by an unknown amount.
  if (totals.unparsed) {
    out.push(`${count(totals.unparsed)} line(s) could not be parsed and were skipped`);
  }

  out.push('');

  if (!totals.model.calls && !totals.vendor.calls) {
    out.push('  Nothing billable in the window.');
    out.push('');
    return out.join('\n');
  }

  if (totals.model.calls) {
    const m = totals.model;
    const perCall = m.calls ? m.usd / m.calls : 0;

    out.push(`  Model calls (${PRICES.model.name})`);
    out.push(`    ${count(m.calls)} calls`
      + `   ${count(m.inputTokens)} in / ${count(m.outputTokens)} out`
      + `   ${money(m.usd)}`);
    out.push(`    ${money(perCall)} a call on average`);

    if (m.unmeasured) {
      out.push(`    ${count(m.unmeasured)} call(s) logged no tokens and count as $0 —`);
      out.push('      these predate the token logging, so the total is an undercount');
    }

    out.push('');
  }

  if (totals.vendor.calls) {
    const v = totals.vendor;

    out.push(`  Keyword lookups (DataForSEO, ${money(PRICES.dataForSeoPerTask)} a task)`);
    out.push(`    ${count(v.paid)} paid   ${count(v.cached)} free from cache   ${money(v.usd)}`);

    for (const [event, row] of [...v.byEvent].sort((a, b) => b[1].usd - a[1].usd)) {
      out.push(`      ${event.padEnd(18)} ${String(row.paid).padStart(4)} paid`
        + `  ${money(row.usd).padStart(8)}`);
    }

    out.push('');
  }

  const worst = busiestDay(totals);

  if (worst) {
    out.push('  Busiest single user-day');
    out.push(`    ${worst.calls} call(s), ${money(worst.usd)} — ${worst.userId} on ${worst.day}`);
    out.push('');
  }

  out.push(`  ${count(users)} user(s)`);
  out.push(`  TOTAL ${money(total)} over ${days} days`
    + `  ·  about ${money(total / days * 30)} a month at this rate`);
  out.push('');
  out.push(`  Prices last checked ${PRICES.checked}. They change —`);
  out.push('  gpt-5.6-terra was cut from $2.50/$15.00 on 30 July 2026.');
  out.push('');

  return out.join('\n');
}

/* -------------------------------------------------------------------------
 * Running
 * ---------------------------------------------------------------------- */

async function main() {
  let opts;

  try {
    opts = parseArgs(process.argv);
  } catch (err) {
    console.error(`\n  ${err.message}\n`);
    process.exit(2);
  }

  try {
    const result = await report(opts);

    if (opts.json) {
      const { totals } = result;
      console.log(JSON.stringify({
        days: result.days,
        model: { ...totals.model, byType: Object.fromEntries(totals.model.byType) },
        vendor: { ...totals.vendor, byEvent: Object.fromEntries(totals.vendor.byEvent) },
        users: totals.users.size,
        busiest: busiestDay(totals),
        totalUsd: totals.model.usd + totals.vendor.usd,
      }, null, 2));
    } else {
      console.log(format(result));
    }
  } catch (err) {
    if (err.missingLog) {
      // The common mistake: run on a Mac where the app has never run in
      // production, because logs go to files only when NODE_ENV=production.
      console.error(`\n  ${err.message}`);
      console.error('  Logs are written to files only in production. On the server:');
      console.error('    ssh ubuntu@15.204.123.104 "cd /home/ubuntu/app && node cost-report.js"\n');
      process.exit(1);
    }

    console.error(`\n  ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = {
  parseArgs, emptyTotals, add, modelCost, busiestDay, format, report,
  PRICES, MODEL_EVENTS, VENDOR_EVENTS,
};
