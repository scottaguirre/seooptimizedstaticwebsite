// utils/signupResult.js
//
// What the visitor is told after an account is created.
//
// WHY THIS IS ITS OWN FILE
//
// Between 23 September and 8 October every signup on threecomets.com was shown
// "We sent you a verification link" while Resend was refusing all of them: the
// domain's DKIM record had been removed, so every send failed. sendEmail
// deliberately does not throw — a failed email must not lose the account the
// user just created — and the route ignored its return value, so the page said
// the same thing whether or not anything had been sent. The only trace was
// `email.failed` in error.log, which nobody reads until someone complains.
//
// The sentence shown to the user is therefore a function of the send result,
// not a constant, and it lives here so it can be tested without standing up
// the route.
//
//   node test-signup-result.js

/**
 * @param {{ok: boolean, transport?: string, error?: string}} delivery
 *        exactly what utils/sendEmail.js returned.
 * @returns {{status: number, html: string, sent: boolean}}
 */
function signupResultPage(delivery) {
  // A missing result is a failure. Nothing may reach the "we sent it" branch
  // by default — that default is the bug this file exists for.
  const sent = Boolean(delivery && delivery.ok);

  if (!sent) {
    // 201, not 500: the account is real and the password works. Only the
    // email failed, and the user can ask for another link.
    return {
      sent: false,
      status: 201,
      html: `
      <h2>Account created</h2>
      <p>Your account exists, but we couldn't send the verification email just now.
         Nothing is wrong with your details — this is a problem on our side.</p>
      <p><a href="/resend-verification">Send the link again</a></p>
      <a href="/login">Go to Login</a>
    `,
    };
  }

  // The console transport is a real outcome, not a send: in development the
  // link is printed rather than posted. Say so only when it actually happened.
  // The old page carried a standing "if you're on localhost, check the server
  // console" line, which every production visitor read and none could act on.
  const consoleHint = delivery.transport === 'console'
    ? `<p><strong>Dev only:</strong> this server printed the verification URL to its console instead of emailing it.</p>\n      `
    : '';

  return {
    sent: true,
    status: 200,
    html: `
      <h2>Account created</h2>
      <p>We sent you a verification link. Please check your email and click it to activate your account.</p>
      ${consoleHint}<a href="/login">Go to Login</a>
    `,
  };
}

module.exports = { signupResultPage };
