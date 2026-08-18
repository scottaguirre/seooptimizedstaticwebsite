// utils/withRetry.js
//
// Retry for OpenAI calls.
//
// Seen in practice with two generations running at once:
//
//   ⚠️ Could not generate FAQ answers: terminated
//
// "terminated" is undici's error for a socket that died mid-response — not a
// bad reply, just a dropped connection. The FAQ call is the most exposed to
// it because it is the largest single request in the app: eight answers,
// 1,300+ output tokens, well over a minute in flight. Under concurrency
// there are simply more chances for a connection to be cut.
//
// fetchPeopleAlsoAsk already retried and survived the same conditions. This
// gives every other generator the same protection.
//
// WHAT IS AND IS NOT RETRIED
// Network faults, timeouts, 429s and 5xx are transient — trying again is
// likely to work. A 400 or 401 means the request itself is wrong; retrying
// wastes time and money and cannot succeed.

const { log } = require('./logger');

const DEFAULT_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000;

/** Transient errors are worth another attempt; malformed requests are not. */
function isRetryable(err) {
  const status = err?.status || err?.response?.status;

  if (status) {
    // 408 timeout, 409 conflict, 429 rate limited, anything 5xx
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }

  const message = String(err?.message || '').toLowerCase();
  const code = String(err?.code || '').toLowerCase();

  return (
    message.includes('terminated') ||      // undici: socket died mid-response
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('socket') ||
    message.includes('network') ||
    message.includes('fetch failed') ||
    message.includes('aborted') ||
    code.includes('econnreset') ||
    code.includes('econnrefused') ||
    code.includes('etimedout') ||
    code.includes('epipe') ||
    code.includes('und_err')
  );
}

/**
 * Exponential backoff with jitter.
 *
 * The jitter matters under concurrency: without it, several generations that
 * hit a rate limit together would all retry at the same instant and hit it
 * again. Spreading them out is the difference between recovering and
 * thrashing.
 */
function delayFor(attempt) {
  const base = BASE_DELAY_MS * Math.pow(2, attempt - 1);
  return base + Math.floor(Math.random() * 400);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * @param {Function} fn        the call to make, e.g. () => openai.responses.create(...)
 * @param {object}   [opts]
 * @param {string}   [opts.label]     for the log line
 * @param {number}   [opts.attempts]
 * @returns whatever fn returns
 * @throws the last error if every attempt fails
 */
async function withRetry(fn, { label = 'openai call', attempts = DEFAULT_ATTEMPTS } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();

    } catch (err) {
      lastError = err;

      if (!isRetryable(err) || attempt === attempts) {
        throw err;
      }

      const wait = delayFor(attempt);

      console.warn(
        `   ⚠️ ${label} failed (${err.message}) — retrying in ${Math.round(wait / 1000)}s ` +
        `[${attempt}/${attempts - 1}]`
      );

      log.external('openai', 'retrying', {
        label,
        attempt,
        message: err.message,
        status: err?.status || null,
        waitMs: wait,
      });

      await sleep(wait);
    }
  }

  throw lastError;
}

module.exports = { withRetry, isRetryable };