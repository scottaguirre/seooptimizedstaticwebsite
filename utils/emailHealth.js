// utils/emailHealth.js
//
// Has the mail actually been going out?
//
// WHY THIS EXISTS
//
// Between 23 September and 8 October every message Resend was asked to send
// from threecomets.com was refused — the domain's DKIM record had been deleted
// — and nothing said so. sendEmail catches and logs rather than throwing, by
// design: a provider outage must not destroy an account somebody just created.
// The cost of that design is that a total email failure looks exactly like a
// working system from every angle except `error.log`, which nobody reads until
// a customer complains. It took a fortnight and a phone call.
//
// So the log becomes something the system reads about itself: a count on the
// admin page, and a nightly cron that shouts. Two channels on purpose — the
// cron's shout is itself an email, so it cannot be trusted to escape a total
// outage, and the badge is read by a human who is already logged in.
//
//   node test-email-health.js

const fs = require('fs');
const path = require('path');

const DAY_MS = 24 * 60 * 60 * 1000;

// Reading a whole log to count today's lines gets slower every day and is
// unbounded. The tail is enough: these are error-level lines only, so
// error.log grows slowly, and 256 KB holds far more than a day of them.
const TAIL_BYTES = 256 * 1024;

/**
 * Count email.failed events in a window.
 *
 * Takes the log's text rather than its path so the decision can be tested
 * without a filesystem.
 *
 * @param {string} text     pino JSON lines, one per line.
 * @param {object} opts
 * @param {number} opts.now epoch ms to measure the window back from.
 * @param {number} [opts.windowMs]
 * @returns {{count: number, latest: null|{time: string, message: string, to: string}}}
 */
function summariseEmailFailures(text, { now, windowMs = DAY_MS } = {}) {
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    throw new TypeError('summariseEmailFailures: `now` must be an epoch-ms number');
  }

  const since = now - windowMs;
  let count = 0;
  let latest = null;

  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed[0] !== '{') continue;   // a half-written tail line

    let entry;
    try { entry = JSON.parse(trimmed); } catch { continue; }
    if (!entry || entry.event !== 'email.failed') continue;

    // pino writes `time` as epoch ms; the app's own logger writes an ISO
    // string. Accept both — guessing wrong here silently zeroes the count,
    // which is the one failure this module must never have.
    const when = typeof entry.time === 'number' ? entry.time : Date.parse(entry.time);
    if (!Number.isFinite(when) || when < since || when > now + 60000) continue;

    count++;
    if (!latest || when >= latest.at) {
      latest = {
        at: when,
        time: new Date(when).toISOString(),
        message: (entry.err && entry.err.message) || entry.msg || 'no message',
        to: entry.to || 'unknown recipient',
      };
    }
  }

  return { count, latest };
}

/** Read the tail of a file. Returns '' for a file that is not there. */
function tail(file, bytes = TAIL_BYTES) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(Math.min(size, bytes));
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } catch {
    // No log yet (a fresh deploy, or development, where pino prints to stdout)
    // is not an error and must not take a page down with it.
    return '';
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* already gone */ }
  }
}

function logPath() {
  return process.env.ERROR_LOG_PATH || path.join(__dirname, '..', 'logs', 'error.log');
}

/** The same summary, read from the live error log. */
function recentEmailFailures(opts = {}) {
  return summariseEmailFailures(tail(logPath()), { now: Date.now(), ...opts });
}

module.exports = { summariseEmailFailures, recentEmailFailures, logPath, DAY_MS };
