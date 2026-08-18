// routes/passwordRoute.js
//
// Password reset, and resending a verification link.
//
//   GET  /forgot-password        ask for the email address
//   POST /forgot-password        send a reset link
//   GET  /reset-password?token=  choose a new password
//   POST /reset-password         set it
//   GET  /resend-verification    ask for the email address
//   POST /resend-verification    send a fresh verification link
//
// THREE THINGS THAT MATTER
//
// 1. The response never reveals whether an address has an account.
//    "If that address has an account, we've sent a link" is returned either
//    way. Saying "no such user" turns this form into a way to discover which
//    of a list of addresses are registered.
//
// 2. Tokens are stored hashed and cleared once used.
//    A reset link works once. Clicking it twice, or reusing an old one from
//    an inbox, fails.
//
// 3. A reset ends every existing session.
//    Someone resetting because they think they have been compromised would
//    otherwise leave the attacker logged in — which defeats the point of
//    resetting.

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');

const User = require('../models/User');
const { log } = require('../utils/logger');
const { renderAuthPage } = require('../utils/renderAuthPage');
const {
  createResetToken,
  createVerificationToken,
  hashToken,
  notExpired,
} = require('../utils/authTokens');
const { sendEmail, passwordResetEmail, verificationEmail } = require('../utils/sendEmail');

/** Same shell as the login and signup pages, so these do not look bolted on. */
function page({ title, heading, body, status = 200, csrfField = '' }) {
  return {
    status,
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body class="bg-dark text-white">
  <div class="container mt-5">
    <div class="row justify-content-center">
      <div class="col-md-5">
        <h2 class="mb-4 text-center">${heading}</h2>
        ${body}
      </div>
    </div>
  </div>
</body>
</html>`,
  };
}

function send(res, spec) {
  return res.status(spec.status).send(spec.html);
}

function alert(kind, message) {
  return `<div class="alert alert-${kind}" role="alert">${message}</div>`;
}


/* -------------------------------------------------------------------------
 * Forgot password
 * ---------------------------------------------------------------------- */

router.get('/forgot-password', (req, res) => {
  send(res, page({
    title: 'Reset your password',
    heading: 'Reset your password',
    body: `
      <p class="text-white-50">
        Enter the email address you signed up with and we'll send you a link
        to choose a new password.
      </p>

      <form action="/forgot-password" method="POST">
        ${res.locals.csrfField || ''}
        <div class="mb-3">
          <label class="form-label">Email</label>
          <input name="email" type="email" class="form-control" required autofocus>
        </div>
        <button type="submit" class="btn btn-primary w-100">Send reset link</button>
        <div class="mt-3">
          <a href="/login" class="text-info">Back to log in</a>
        </div>
      </form>`,
  }));
});

router.post('/forgot-password', async (req, res) => {
  // Cast to String: an object here would otherwise reach the query as a
  // Mongo operator.
  const email = String(req.body.email || '').trim().toLowerCase();

  // The SAME response whichever way this goes. Returning "no account with
  // that address" would let anyone test a list of emails for membership.
  const confirmation = page({
    title: 'Check your email',
    heading: 'Check your email',
    body: `
      ${alert('info', `If an account exists for <strong>${email.replace(/[<>&"]/g, '')}</strong>, we've sent a link to reset the password.`)}
      <p class="text-white-50 small">
        The link works for 30 minutes. Check your spam folder if it does not
        arrive shortly.
      </p>
      <a href="/login" class="btn btn-outline-light w-100 mt-2">Back to log in</a>`,
  });

  try {
    const user = await User.findOne({ email });

    if (!user) {
      log.security('auth.reset.unknownEmail', { requestId: req.id, ip: req.ip });
      return send(res, confirmation);
    }

    const { raw, hashed, expiresAt } = createResetToken();

    user.resetTokenHash = hashed;
    user.resetExpiresAt = expiresAt;
    await user.save();

    await sendEmail(passwordResetEmail({ to: user.email, token: raw }));

    log.security('auth.reset.requested', {
      requestId: req.id,
      userId: String(user._id),
      ip: req.ip,
    });

    return send(res, confirmation);

  } catch (err) {
    log.error('auth.reset.requestFailed', err, { requestId: req.id });

    // Still the same message: an error here must not become a way to tell
    // registered addresses from unregistered ones either.
    return send(res, confirmation);
  }
});


/* -------------------------------------------------------------------------
 * Choosing the new password
 * ---------------------------------------------------------------------- */

/** Load the user a raw token belongs to, if it is still valid. */
async function userForResetToken(rawToken) {
  const token = String(rawToken || '').trim();
  if (!/^[a-f0-9]{64}$/i.test(token)) return null;

  const user = await User.findOne({ resetTokenHash: hashToken(token) });
  if (!user) return null;

  // Unlike verification, a missing expiry here is NOT treated as valid —
  // every reset token has always had one, so its absence means something
  // is wrong.
  if (!user.resetExpiresAt || !notExpired(user.resetExpiresAt)) return null;

  return user;
}

function expiredPage(res) {
  return send(res, page({
    status: 400,
    title: 'Link expired',
    heading: 'That link has expired',
    body: `
      ${alert('warning', 'Reset links work for 30 minutes and can only be used once.')}
      <a href="/forgot-password" class="btn btn-primary w-100">Request a new link</a>
      <div class="mt-3 text-center">
        <a href="/login" class="text-info">Back to log in</a>
      </div>`,
  }));
}

router.get('/reset-password', async (req, res) => {
  const user = await userForResetToken(req.query.token);
  if (!user) return expiredPage(res);

  send(res, page({
    title: 'Choose a new password',
    heading: 'Choose a new password',
    body: `
      <form action="/reset-password" method="POST">
        ${res.locals.csrfField || ''}
        <input type="hidden" name="token" value="${String(req.query.token).replace(/[^a-f0-9]/gi, '')}">

        <div class="mb-3">
          <label class="form-label">New password</label>
          <input name="password" type="password" class="form-control"
                 minlength="8" autocomplete="new-password" required autofocus>
          <div class="form-text text-white-50">At least 8 characters.</div>
        </div>

        <div class="mb-3">
          <label class="form-label">Confirm new password</label>
          <input name="confirm" type="password" class="form-control"
                 minlength="8" autocomplete="new-password" required>
        </div>

        <button type="submit" class="btn btn-primary w-100">Set new password</button>
      </form>`,
  }));
});

router.post('/reset-password', async (req, res) => {
  try {
    const user = await userForResetToken(req.body.token);
    if (!user) return expiredPage(res);

    const password = String(req.body.password || '');
    const confirm = String(req.body.confirm || '');

    const problem =
      password.length < 8 ? 'Please choose a password of at least 8 characters.' :
      password !== confirm ? 'Those passwords do not match.' :
      null;

    if (problem) {
      return send(res, page({
        status: 400,
        title: 'Choose a new password',
        heading: 'Choose a new password',
        body: `
          ${alert('danger', problem)}
          <form action="/reset-password" method="POST">
            ${res.locals.csrfField || ''}
            <input type="hidden" name="token" value="${String(req.body.token).replace(/[^a-f0-9]/gi, '')}">
            <div class="mb-3">
              <label class="form-label">New password</label>
              <input name="password" type="password" class="form-control" minlength="8" required autofocus>
            </div>
            <div class="mb-3">
              <label class="form-label">Confirm new password</label>
              <input name="confirm" type="password" class="form-control" minlength="8" required>
            </div>
            <button type="submit" class="btn btn-primary w-100">Set new password</button>
          </form>`,
      }));
    }

    user.passwordHash = await bcrypt.hash(password, 12);

    // Consumed. The link cannot be used again, from this inbox or any other.
    user.resetTokenHash = undefined;
    user.resetExpiresAt = undefined;

    // Every session issued before this moment is now invalid. Someone
    // resetting because they were compromised needs the attacker logged out,
    // not just a new password on a session the attacker still holds.
    user.passwordChangedAt = new Date();

    // Reaching the reset link proves control of the mailbox, which is the
    // same thing verification checks.
    if (!user.verified) {
      user.verified = true;
      user.verificationTokenHash = undefined;
      user.verificationExpiresAt = undefined;
    }

    await user.save();

    log.security('auth.reset.completed', {
      requestId: req.id,
      userId: String(user._id),
      ip: req.ip,
    });

    send(res, page({
      title: 'Password updated',
      heading: 'Password updated',
      body: `
        ${alert('success', 'Your password has been changed.')}
        <p class="text-white-50 small">
          For your security you have been signed out on all devices.
        </p>
        <a href="/login" class="btn btn-primary w-100">Log in</a>`,
    }));

  } catch (err) {
    log.error('auth.reset.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      heading: 'Something went wrong',
      body: `
        ${alert('danger', 'We could not update your password. Please request a new link and try again.')}
        <a href="/forgot-password" class="btn btn-primary w-100">Request a new link</a>`,
    }));
  }
});


/* -------------------------------------------------------------------------
 * Resend verification
 *
 * Verification links now expire after 24 hours, so there has to be a way to
 * get a new one. Without this an expired link is a dead account.
 * ---------------------------------------------------------------------- */

router.get('/resend-verification', (req, res) => {
  send(res, page({
    title: 'Resend verification',
    heading: 'Resend verification',
    body: `
      <p class="text-white-50">
        Enter your email address and we'll send a new confirmation link.
      </p>
      <form action="/resend-verification" method="POST">
        ${res.locals.csrfField || ''}
        <div class="mb-3">
          <label class="form-label">Email</label>
          <input name="email" type="email" class="form-control" required autofocus>
        </div>
        <button type="submit" class="btn btn-primary w-100">Send new link</button>
        <div class="mt-3">
          <a href="/login" class="text-info">Back to log in</a>
        </div>
      </form>`,
  }));
});

router.post('/resend-verification', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();

  const confirmation = page({
    title: 'Check your email',
    heading: 'Check your email',
    body: `
      ${alert('info', 'If that address needs verifying, we\'ve sent a new link.')}
      <p class="text-white-50 small">The link works for 24 hours.</p>
      <a href="/login" class="btn btn-outline-light w-100 mt-2">Back to log in</a>`,
  });

  try {
    const user = await User.findOne({ email });

    // Same response for an unknown address AND an already-verified one:
    // either would otherwise disclose account state.
    if (!user || user.verified) return send(res, confirmation);

    const { raw, hashed, expiresAt } = createVerificationToken();

    user.verificationTokenHash = hashed;
    user.verificationExpiresAt = expiresAt;
    await user.save();

    await sendEmail(verificationEmail({ to: user.email, token: raw }));

    log.info('auth.verification.resent', {
      requestId: req.id,
      userId: String(user._id),
    });

    return send(res, confirmation);

  } catch (err) {
    log.error('auth.verification.resendFailed', err, { requestId: req.id });
    return send(res, confirmation);
  }
});

module.exports = router;