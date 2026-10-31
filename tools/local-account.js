// tools/local-account.js
//
// List the accounts in the LOCAL database, and reset one.
//
//   node tools/local-account.js
//   node tools/local-account.js you@example.com 'new-password' 2000
//
// WHY THIS LIVES IN tools/
//
// tools/ is in .rsync-exclude — "scripts run by hand on a laptop to answer a
// question", as that file puts it. A password-reset script does not belong on
// the production box, and this one would be a loaded gun there: it sets a
// password without knowing the old one.
//
// IT REFUSES TO RUN AGAINST ANYTHING BUT A LOCAL MONGO, and that guard is
// the reason this is safe to keep. Local is mongodb://127.0.0.1:27017; the
// server is an Atlas cluster. Pointing this at Atlas by copying the wrong
// .env, or by running it in the wrong shell, would reset a real customer's
// password and invalidate their sessions — so it checks the host rather than
// trusting where it happens to be running.
//
// Two jobs rather than one, because they are asked at different moments:
// with no arguments it tells you which accounts exist, and with arguments it
// changes one. Nothing is changed by the listing.

'use strict';

require('dotenv').config();

const mongoose = require('mongoose');

const URI = process.env.MONGO_URI || '';

/**
 * Is this a local database?
 *
 * MATCHED ON THE HOST, NOT ON THE ABSENCE OF "mongodb.net". A deny-list
 * answers "is this the one host I thought of"; this answers "is this
 * definitely my own machine", which is the question that keeps a customer's
 * password safe when somebody self-hosts Mongo on a VPS.
 */
function isLocal(uri) {
  const host = String(uri).replace(/^mongodb(\+srv)?:\/\//, '').split('/')[0];

  return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host.replace(/^.*@/, ''));
}

async function main() {
  if (!URI) {
    console.error('No MONGO_URI in .env — nothing to connect to.');
    process.exit(1);
  }

  if (!isLocal(URI)) {
    console.error('\nREFUSING TO RUN.\n');
    console.error('  MONGO_URI points at a host that is not this machine:');
    console.error(`    ${URI.replace(/\/\/[^@]*@/, '//***@')}\n`);
    console.error('  This tool sets a password without knowing the old one, so it');
    console.error('  only ever runs against a local database. If you meant to reset');
    console.error('  a live account, use the app\'s own reset flow.\n');
    process.exit(1);
  }

  await mongoose.connect(URI);

  /* Required AFTER connecting, so a bad URI fails with a connection error
   * rather than a model-compilation one. */
  const User = require('../models/User');

  const [email, password, credits] = process.argv.slice(2);

  /* ------------------------------------------------------- just looking */

  if (!email) {
    const users = await User.find({}, 'email credits role verified createdAt')
      .sort({ createdAt: 1 }).lean();

    if (!users.length) {
      console.log('\nNo accounts in the local database. Sign up through the app.\n');
    } else {
      console.log(`\n${users.length} account(s) in ${URI.split('/').pop()}:\n`);

      for (const user of users) {
        console.log(
          `  ${user.email.padEnd(34)} `
          + `${String(user.credits).padStart(6)} credits   `
          + `${(user.role || '').padEnd(11)} `
          + `${user.verified ? 'verified' : 'NOT verified'}`
        );
      }

      console.log('\nTo reset one:\n');
      console.log(`  node tools/local-account.js ${users[0].email} 'a-new-password' 2000\n`);
    }

    await mongoose.disconnect();
    return;
  }

  /* ---------------------------------------------------------- changing it */

  if (!password) {
    console.error('\nGive a password as the second argument.\n');
    process.exit(1);
  }

  const user = await User.findOne({ email: String(email).toLowerCase().trim() });

  if (!user) {
    console.error(`\nNo account with that address. Run with no arguments to list them.\n`);
    process.exit(1);
  }

  await user.setPassword(password);

  /* THE SAME TWO THINGS THE APP'S OWN RESET DOES.
   *
   * passwordChangedAt is what requireAuth compares against a session's issue
   * time — see sessionIsStale() on the model. Without it the old password is
   * gone but every existing session keeps working, which is the opposite of
   * what a reset is for. */
  user.passwordChangedAt = new Date();

  /* VERIFIED, because an unverified local account cannot log in and there is
   * no inbox to click a link in on a laptop. */
  user.verified = true;

  if (credits !== undefined) {
    const amount = Number(credits);

    if (!Number.isFinite(amount) || amount < 0) {
      console.error(`\n"${credits}" is not a credit balance.\n`);
      process.exit(1);
    }

    user.credits = amount;
  }

  await user.save();

  console.log(`\n  ${user.email}`);
  console.log(`  password  set`);
  console.log(`  credits   ${user.credits}`);
  console.log(`  verified  ${user.verified}`);
  console.log('\nSessions signed out. Log in with the new password.\n');

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('\n', err.message, '\n');
  process.exit(1);
});
