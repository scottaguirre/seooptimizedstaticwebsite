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

// Created on first use, like the OpenAI client: constructing Resend without
// a key throws, and a missing env var should not stop the server booting.
let resendClient = null;
function getResend() {
  if (!resendClient) {
    const { Resend } = require('resend');
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

/**
 * The name shown in the recipient's inbox.
 *
 * Without it, a From header of `hello@fastwebsitegenerator.com` makes Gmail
 * display the sender as "hello" — the local part, alone, above a password
 * reset link. Overridable with EMAIL_FROM_NAME; the default lives here rather
 * than only in .env so a deploy fixes it without also editing the server's
 * environment.
 */
const DEFAULT_FROM_NAME = 'Fast Website Generator';
const DEFAULT_FROM_ADDRESS = 'onboarding@resend.dev';

// True for a value already written as `Name <addr>`.
function hasDisplayName(value) {
  return /<[^>]+>\s*$/.test(String(value).trim());
}

/**
 * Make a display name safe to put in a From header.
 *
 * Two separate problems:
 *
 * 1. A CR or LF ends the header. Anything after it is read as a new header —
 *    header injection. Hence stripping rather than trusting, even though the
 *    value currently comes from our own .env.
 * 2. RFC 5322 requires quoting around any of ()<>[]:;@,\ in a display name.
 *    Unquoted, `Smith, John <a@b.c>` parses as two addresses and the send is
 *    rejected or silently mangled.
 */
function quoteDisplayName(name) {
  const clean = String(name == null ? '' : name).replace(/[\r\n"\\]/g, '').trim();
  if (!clean) return '';
  return /[(),:;<>@[\]]/.test(clean) ? `"${clean}"` : clean;
}

/**
 * Who the email comes from.
 *
 * The address must be on a domain verified in Resend — they reject anything
 * else, which is what stops their platform being used to spoof senders. The
 * display name is cosmetic and unverified, so it is ours to choose.
 *
 * EMAIL_FROM may itself already be written as `Name <addr>`. That form wins:
 * someone who spelled out a whole From header meant it, and wrapping it again
 * would produce `Name <Other <addr>>`.
 */
function fromAddress() {
  const address = process.env.EMAIL_FROM || DEFAULT_FROM_ADDRESS;
  if (hasDisplayName(address)) return address;

  // An explicitly empty EMAIL_FROM_NAME means "no name" — a bare address,
  // which is what this did before. Only an unset variable takes the default.
  const configured = process.env.EMAIL_FROM_NAME;
  const name = quoteDisplayName(configured === undefined ? DEFAULT_FROM_NAME : configured);

  return name ? `${name} <${address}>` : address;
}

// Re-exported rather than defined here.
//
// This file had its own copy, and because an email has no request to fall
// back to, its copy answered 'http://localhost:3000' whenever BASE_URL was
// unset — which it was. Every verification link sent from the deployed server
// pointed at the recipient's own machine, so nobody who signed up could
// finish signing up, and nothing logged a thing: the mail sent, the link was
// well-formed, it just named the wrong computer.
//
// utils/baseUrl.js now owns the answer, and server.js refuses to boot in
// production without BASE_URL set, so this cannot silently happen again.
const { baseUrl } = require('./baseUrl');

// The HTML half of each message. The text half stays inline below, so the two
// can be read side by side and kept saying the same thing.
const { emailLayout } = require('./emailLayout');

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
  if (!process.env.RESEND_API_KEY) {
    throw new Error(
      'RESEND_API_KEY is not set. Verification and password reset emails ' +
      'cannot be sent.'
    );
  }

  const { data, error } = await getResend().emails.send({
    from: fromAddress(),
    to,
    subject,
    text,
    ...(html ? { html } : {}),
  });

  // Resend reports failures in the response rather than throwing — a
  // rejected send would otherwise look like a success and the user would
  // wait for a message that was never accepted.
  if (error) {
    throw new Error(error.message || 'Resend rejected the message');
  }

  return { id: data?.id };
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
    // EMAIL_TRANSPORT=resend forces real sending in development.
    //
    // Without this the only way to test a real email would be to run the
    // whole app as production — which also turns on secure cookies and HSTS,
    // neither of which works over plain http on localhost. So testing email
    // would mean breaking login.
    const forceProvider = process.env.EMAIL_TRANSPORT === 'resend';

    if (!isProd && !forceProvider) {
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
 *
 * Each carries both `text` and `html`. The text version is not a leftover:
 * it is what plain-text clients, screen readers and some filters read, and
 * it must say everything the HTML says. When one is edited, edit both.
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
    html: emailLayout({
      heading: 'Confirm your email address',
      preheader: 'One click activates your account.',
      intro: 'Welcome. Confirm your email address to activate your account.',
      buttonLabel: 'Confirm my email',
      url,
      after: [
        'This link works for 24 hours. If it expires you can request a new one from the login page.',
        'If you did not create an account, you can ignore this message.',
      ],
    }),
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
    html: emailLayout({
      heading: 'Reset your password',
      preheader: 'The link expires in 30 minutes.',
      intro: 'Someone asked to reset the password for this account. If that was you, choose a new one.',
      buttonLabel: 'Choose a new password',
      url,
      after: [
        'This link works for 30 minutes and can only be used once.',
        'If it was not you, you can ignore this message — your password has not changed.',
      ],
    }),
  };
}

module.exports = {
  sendEmail,
  verificationEmail,
  passwordResetEmail,
  baseUrl,
  // Exported for test-email-from.js. Nothing else should call it — the From
  // header is sendViaProvider's business.
  fromAddress,
};