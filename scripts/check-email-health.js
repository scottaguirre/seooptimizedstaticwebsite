#!/usr/bin/env node
// scripts/check-email-health.js
//
// Nightly: did any email fail to send today? If so, say so out loud.
//
//   cd ~/app && node scripts/check-email-health.js
//
// Cron, 07:00 server time:
//   0 7 * * * cd /home/ubuntu/app && /usr/bin/node scripts/check-email-health.js >> logs/email-health.log 2>&1
//
// WHY
//
// utils/sendEmail.js catches and logs rather than throwing — a provider
// outage must not destroy an account a user just created. The cost is that a
// complete email failure is indistinguishable from a healthy system unless
// something reads error.log. For a fortnight nothing did.
//
// THE CIRCULARITY, STATED PLAINLY
//
// This alert is itself an email. If email is wholly broken the alert cannot
// escape, which is exactly the outage it exists for. That is why it is not
// the only signal: the admin page carries the same count, read by a human who
// is already logged in. This script catches the slow leak — a handful of
// addresses failing while most get through — and the badge catches the flood.
// Neither alone is enough, and pretending otherwise would be worse than
// having nothing, because it would feel like cover.
//
// Exit codes: 0 nothing to report or alert sent, 1 failures found but the
// alert could not be sent (cron mails that to the crontab owner if configured).

require('dotenv').config();

const { recentEmailFailures } = require('../utils/emailHealth');
const { sendEmail } = require('../utils/sendEmail');

// Who hears about it. ALERT_EMAIL_TO, else the from-address, which is at least
// a mailbox we control.
const to = process.env.ALERT_EMAIL_TO || process.env.EMAIL_FROM || '';

function stamp(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

(async () => {
  const health = recentEmailFailures();

  if (!health.count) {
    stamp('ok: no failed sends in the last 24 hours');
    process.exit(0);
  }

  const summary =
    `${health.count} email${health.count === 1 ? '' : 's'} failed to send ` +
    `in the last 24 hours on threecomets.com.\n\n` +
    `Latest: ${health.latest.time}\n` +
    `To:     ${health.latest.to}\n` +
    `Error:  ${health.latest.message}\n\n` +
    `Accounts are still being created. The people affected never received a link, ` +
    `and the signup page now tells them so.\n\n` +
    `Check:  grep email.failed ~/app/logs/error.log | tail -5\n` +
    `        https://resend.com/domains\n`;

  stamp(`ALERT: ${health.count} failed send(s); latest to ${health.latest.to}: ${health.latest.message}`);

  if (!to) {
    stamp('no ALERT_EMAIL_TO or EMAIL_FROM set — nothing to send the alert to');
    process.exit(1);
  }

  const result = await sendEmail({
    to,
    subject: `[Three Comets] ${health.count} email${health.count === 1 ? '' : 's'} failed to send`,
    text: summary,
  });

  if (result && result.ok) {
    stamp(`alert sent to ${to} (${result.transport})`);
    process.exit(0);
  }

  // The expected case during a real outage. Logged so the run leaves a trace
  // even when the message cannot.
  stamp(`alert could NOT be sent: ${(result && result.error) || 'unknown error'}`);
  process.exit(1);
})().catch((err) => {
  stamp(`check failed: ${err && err.stack || err}`);
  process.exit(1);
});
