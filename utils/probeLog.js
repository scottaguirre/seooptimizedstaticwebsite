// utils/probeLog.js
//
// How often to say that a request was stripped of a Mongo operator.
//
// WHAT WENT WRONG WITH SAYING IT EVERY TIME
//
// server.js blocks `$`-prefixed and dotted keys and logged one console.warn
// per blocked request. On 16 October the last thirty lines of
// webgen-error.log were twenty probes for `/index.php` and two real faults —
// a page-content JSON parse failure and a ValueSERP timeout — sitting
// half-buried among them. The guard was working perfectly; its logging was
// the problem.
//
// TWO SEPARATE MISTAKES, and fixing one without the other fixes nothing:
//
//   1. console.warn goes to STDERR, which pm2 writes to webgen-error.log.
//      A blocked scanner probe is not an application error. It belongs in
//      app.log with everything else that is merely true.
//
//   2. One line per request is the wrong rate for traffic nobody controls.
//      Internet background radiation arrives in bursts of hundreds; the
//      hundredth line says nothing the first did not.
//
// WHAT IS KEPT, BECAUSE SILENCE WOULD BE WORSE
//
// The first request of each SHAPE is still reported in full, immediately. The
// shape is the route plus the key names that arrived — `GET /index.php` with
// `lang, config-create /` is unmistakably a scanner, and a dotted key from
// our own front end would be equally unmistakable. That distinction is the
// only question this logging exists to answer, and it is answered by the
// first one, not the two hundredth.
//
// Everything after that is counted, and the count is reported once an hour.
//
// THE COUNTERS ARE BOUNDED, and that is not paranoia. An attacker chooses the
// route, the key names and the source address, which means they choose how
// many distinct shapes and addresses this module would otherwise remember.
// An unbounded Map fed by unauthenticated traffic is a memory leak someone
// else gets to trigger.

'use strict';

/** How often the counts are reported. */
const SUMMARY_MS = Number(process.env.PROBE_SUMMARY_MS) || 60 * 60 * 1000;

/**
 * How many distinct shapes to remember inside one window.
 *
 * Past this, requests are still counted in the total but no longer earn a
 * first-of-shape line and no longer grow the map. Fifty is far more variety
 * than a real fault produces and far less than a scanner can generate.
 */
const MAX_SHAPES = 50;

/** How many distinct addresses to remember, for the same reason. */
const MAX_IPS = 100;

let shapes = new Map();   // shape -> how many times it arrived
let addresses = new Set();
let total = 0;
let capped = false;       // did we stop remembering new shapes or addresses?
let windowStartedAt = 0;

/**
 * The route and the key names together.
 *
 * NOT the route alone. Two different probes against `/index.php` are worth
 * telling apart — one looking for a PHP shell and one looking for a Mongo
 * operator are different events — and the key names are what distinguish
 * them. Not the IP either: the same probe from four hundred addresses is one
 * shape, which is the entire point.
 */
function shapeOf(where, keys) {
  return `${where} [${keys}]`;
}

function reset(now) {
  shapes = new Map();
  addresses = new Set();
  total = 0;
  capped = false;
  windowStartedAt = now;
}

/** The three busiest shapes, as "GET /index.php [lang] ×231". */
function busiest() {
  return [...shapes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([shape, n]) => `${shape} ×${n}`);
}

function summary(now) {
  return {
    event: 'request.operatorStripped.summary',
    context: {
      minutes: Math.round((now - windowStartedAt) / 60000),
      requests: total,
      shapes: shapes.size,
      addresses: capped ? `${addresses.size}+` : addresses.size,
      busiest: busiest(),
    },
  };
}

/**
 * Record one blocked request, and say what — if anything — is worth logging.
 *
 * @param {{where: string, who: string, keys: string}} probe
 * @param {number} [now]
 * @returns {Array<{event: string, context: object}>} events for the caller to
 *   log, in order. Usually empty.
 *
 * RETURNS EVENTS RATHER THAN LOGGING THEM ITSELF. This file has the counting
 * rules in it and the counting rules are what can be wrong; a function that
 * logs as a side effect can only be tested by capturing a logger, and what
 * gets captured is formatting rather than behaviour.
 */
function note(probe, now = Date.now()) {
  const where = String((probe && probe.where) || 'unknown route');
  const who = String((probe && probe.who) || '');
  const keys = String((probe && probe.keys) || '(none)');

  const out = [];

  if (!windowStartedAt) reset(now);

  /* The window closed. Report what it held BEFORE counting this request into
   * the next one — otherwise the summary and the request that triggered it
   * disagree about which window they belong to. */
  if (now - windowStartedAt >= SUMMARY_MS) {
    if (total > 0) out.push(summary(now));
    reset(now);
  }

  total += 1;

  if (addresses.size < MAX_IPS) {
    if (who) addresses.add(who);
  } else {
    capped = true;
  }

  const shape = shapeOf(where, keys);
  const seen = shapes.get(shape) || 0;

  if (seen > 0) {
    shapes.set(shape, seen + 1);
    return out;
  }

  if (shapes.size >= MAX_SHAPES) {
    /* Out of room. Counted in the total, which is what the summary reports,
     * but not remembered individually and NOT announced — a scanner rotating
     * key names would otherwise get a fresh log line for every request, which
     * is the behaviour this module exists to remove. */
    capped = true;
    return out;
  }

  shapes.set(shape, 1);

  out.push({
    event: 'request.operatorStripped',
    context: { where, ip: who || 'unknown ip', keys, firstOfShape: true },
  });

  return out;
}

/**
 * Report whatever has been counted so far and start a new window.
 *
 * For tests, and for anything that wants the numbers without waiting for the
 * next probe — a quiet hour otherwise reports nothing at all, which is
 * correct but untestable.
 */
function flush(now = Date.now()) {
  if (!windowStartedAt || total === 0) return [];

  const out = [summary(now)];
  reset(now);
  return out;
}

module.exports = { note, flush, SUMMARY_MS, MAX_SHAPES, MAX_IPS };
