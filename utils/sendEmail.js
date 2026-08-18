// utils/sendEmail.js
//
// One place email goes out.
//
// Signup already printed its verification link straight to the console with
// a console.log. That worked, but it meant each new email feature would
// invent its own version, and switching to a real provider would mean
// finding every one of them.
//
// Everything now goes through send(). In development it prints; in
// production it calls a provider. Adding one is a single function below —
// no route or template needs to change.

const { log } = require('./logger');

const isProd = process.env.NODE_ENV === 'production';

function baseUrl() {
  return process.env.BASE_URL || 'http://localhost:3000';
}

/**
 * Print the message instead of sending it.
 *
 * The URL is printed on its own line, unwrapped, so it can be copied out of
 * a terminal in one go.
 */
function sendToConsole({ to, subject, text, url }) {
  console.log('');
  console.log('📧 ─────────────────────────────────────────────────');
  console.log(`   To:      ${to}`);
  console.log(`   Subject: ${subject}`);
  if (url) {
    console.log('');
    console.log(`   ${url}`);
  }
  console.log('📧 ─────────────────────────────────────────────────');
  console.log('');

  return { ok: true, transport: 'console' };
}

/**
 * Where a real provider goes.
 *
 * Deliberately throws rather than silently doing nothing: a production
 * deploy with no provider configured would otherwise tell users to check
 * an inbox that will never receive anything, and nothing in the logs would
 * say why.
 */
async function sendViaProvider({ to, subject, text, html }) {
  throw new Error(
    'No email provider is configured. Set one up in utils/sendEmail.js ' +
    'before running in production.'
  );
}

/**
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} opts.subject
 * @param {string} opts.text
 * @param {string} [opts.html]
 * @param {string} [opts.url]    highlighted in the console output
 * @returns {Promise<{ok: boolean, transport: string}>}
 *
 * Never throws in development, so a mail problem cannot block signup while
 * you are working.
 */
async function sendEmail({ to, subject, text, html, url }) {
  try {
    if (!isProd) {
      return sendToConsole({ to, subject, text, url });
    }

    const result = await sendViaProvider({ to, subject, text, html });

    log.info('email.sent', { to, subject });
    return { ok: true, transport: 'provider', ...result };

  } catch (err) {
    // Logged, not thrown. A failed email should not lose the account the
    // user just created — they can request another link.
    log.error('email.failed', err, { to, subject });
    return { ok: false, transport: 'none', error: err.message };
  }
}

/* -------------------------------------------------------------------------
 * The messages
 *
 * Kept here rather than inline in the routes so the wording is in one place
 * and every message has the same shape.
 * ---------------------------------------------------------------------- */

function verificationEmail({ to, token }) {
  const url = `${baseUrl()}/verify?token=${token}`;

  return {
    to,
    subject: 'Confirm your email address',
    url,
    text: `Welcome.

Confirm your email address to activate your account:

${url}

This link works for 24 hours. If it expires you can request a new one from the login page.

If you did not create an account, you can ignore this message.`,
  };
}

function passwordResetEmail({ to, token }) {
  const url = `${baseUrl()}/reset-password?token=${token}`;

  return {
    to,
    subject: 'Reset your password',
    url,
    text: `Someone asked to reset the password for this account.

Choose a new password:

${url}

This link works for 30 minutes and can only be used once.

If it was not you, you can ignore this message — your password has not changed.`,
  };
}

module.exports = {
  sendEmail,
  verificationEmail,
  passwordResetEmail,
  baseUrl,
};