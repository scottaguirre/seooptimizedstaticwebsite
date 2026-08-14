// utils/logger.js
//
// Structured logging.
//
// Until now every failure existed only as a console.log in a terminal nobody
// watches. When a customer says "it didn't work an hour ago" there was no way
// to find out what happened.
//
// WHAT IS LOGGED
//   errors            — everything the error handler catches
//   auth events       — failed logins, rate-limit trips, access denials
//   generation        — start, finish, duration, credits, failures
//   external APIs     — OpenAI and ValueSERP failures (you pay for these)
//
// Deliberately NOT every request. That is what an access log is for, and it
// buries the lines that matter.
//
// WHAT IS NEVER LOGGED
// Passwords, session ids, API keys, cookies, tokens and raw request bodies.
// A log file gets copied, emailed and backed up; a logger that captures
// secrets spreads them. The redaction list below is enforced by pino itself
// rather than by remembering to omit fields at each call site.

const fs = require('fs');
const path = require('path');
const pino = require('pino');

const LOG_DIR = path.join(__dirname, '..', 'logs');

try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch (err) {
  console.error('Could not create the logs directory:', err.message);
}

const isProd = process.env.NODE_ENV === 'production';

/**
 * Paths pino will replace with [Redacted] wherever they appear.
 * Listed as paths rather than key names so nested objects are covered too.
 */
const REDACT = [
  'password',
  'passwordHash',
  '*.password',
  '*.passwordHash',
  'req.headers.cookie',
  'req.headers.authorization',
  'apiKey',
  'api_key',
  '*.apiKey',
  '*.api_key',
  'token',
  '*.token',
  'verificationToken',
  '*.verificationToken',
  // The USER's session id, not a Stripe checkout session — those are logged
  // as stripeSessionId, which is not a secret and is exactly what you need
  // to trace a payment.
  'sessionId',
  'smtp_pass',
  '*.smtp_pass',
];

/**
 * In production write JSON to a file — machine-readable, greppable, and
 * survives the terminal closing. In development print readable lines instead,
 * because a wall of JSON while you work is useless.
 */
function buildTransport() {
  if (!isProd) {
    return {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
    };
  }

  return {
    targets: [
      {
        target: 'pino/file',
        level: 'info',
        options: { destination: path.join(LOG_DIR, 'app.log'), mkdir: true },
      },
      {
        // Errors also go to their own file, so "what broke recently" does not
        // mean reading through every informational line.
        target: 'pino/file',
        level: 'error',
        options: { destination: path.join(LOG_DIR, 'error.log'), mkdir: true },
      },
    ],
  };
}

const logger = pino({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  redact: { paths: REDACT, censor: '[Redacted]' },
  base: { env: process.env.NODE_ENV || 'development' },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: buildTransport(),
});

/* -------------------------------------------------------------------------
 * Helpers
 *
 * Named functions rather than raw logger.info() calls, so the shape of each
 * event stays consistent and searchable. Grep for "generation.failed" and you
 * get every failed build, not a variety of hand-written phrasings.
 * ---------------------------------------------------------------------- */

const log = {
  raw: logger,

  /** Anything unexpected. Always include the error object itself. */
  error(event, err, context = {}) {
    logger.error({
      event,
      err: err instanceof Error
        ? { message: err.message, stack: err.stack, name: err.name }
        : err,
      ...context,
    });
  },

  /** Security-relevant: failed logins, denials, rate limits. */
  security(event, context = {}) {
    logger.warn({ event, security: true, ...context });
  },

  /** Site generation lifecycle. */
  generation(event, context = {}) {
    logger.info({ event, ...context });
  },

  /** An external API we pay for failed or degraded. */
  external(service, event, context = {}) {
    logger.warn({ event: `external.${service}.${event}`, service, ...context });
  },

  info(event, context = {}) {
    logger.info({ event, ...context });
  },

  debug(event, context = {}) {
    logger.debug({ event, ...context });
  },
};

module.exports = { log, logger, LOG_DIR, REDACT };