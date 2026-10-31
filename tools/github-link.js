// tools/github-link.js
//
// Point a LOCAL account at a GitHub installation, so its builds publish.
//
//   node tools/github-link.js
//   node tools/github-link.js you@example.com 176399104
//   node tools/github-link.js you@example.com --clear
//
// WHY THIS IS A BENCH TOOL AND NOT A SCREEN
//
// Because the screen it is standing in for has not been designed yet, and
// the design is not "a Connect GitHub button". Edwin, 29 October: "none
// customer will add or connect to github. They asked me to create their
// account and do the connection ... similar to the cloudflare feature they
// will only chose their github account per a list."
//
// So the real thing is a POOL of GitHub accounts that Edwin manages and a
// site picks from, the shape CloudflareAccount already has. That is a model,
// a screen and a picker. This is none of those: it is the one line of
// database work that lets a real end-to-end build be tested tonight, and it
// should be deleted the day the pool exists.
//
// IT REFUSES ANYTHING BUT A LOCAL MONGO, the same guard and the same reason
// as tools/local-account.js: local is mongodb://127.0.0.1:27017 and the
// server is an Atlas cluster. Writing a publishing target onto a real
// customer's account from a laptop shell is not a mistake worth leaving
// available.
//
// THE INSTALLATION ID IS NOT A SECRET. It is useless without the App's
// private key, which is why it is safe to type on a command line and to
// print in the listing below — unlike a Cloudflare token, which is why that
// one is sealed.

'use strict';

require('dotenv').config();

const mongoose = require('mongoose');

const URI = process.env.MONGO_URI || '';

/** Is this a local database? Matched on the host, as local-account.js does. */
function isLocal(uri) {
  const host = String(uri).replace(/^mongodb(\+srv)?:\/\//, '').split('/')[0];

  return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host.replace(/^.*@/, ''));
}

async function main() {
  if (!URI) {
    console.error('\n  MONGO_URI is not set.\n');
    process.exit(1);
  }

  if (!isLocal(URI)) {
    console.error('\n  MONGO_URI does not point at a local database.');
    console.error('  This tool only runs against mongodb://127.0.0.1.\n');
    process.exit(1);
  }

  await mongoose.connect(URI);

  const User = require('../models/User');

  const [email, value] = process.argv.slice(2);

  /* ------------------------------------------------------------ listing */

  if (!email) {
    const users = await User.find({})
      .select('email credits githubInstallationId')
      .sort({ email: 1 })
      .lean();

    if (!users.length) {
      console.log('\n  No accounts in the local database. Sign up through the app.\n');
      return;
    }

    console.log('\nLocal accounts\n');

    for (const u of users) {
      console.log(`  ${String(u.email).padEnd(36)}`
        + `${String(u.credits ?? 0).padStart(6)} credits   `
        + `${u.githubInstallationId || '—'}`);
    }

    console.log('\n  node tools/github-link.js <email> <installation id>\n');
    return;
  }

  /* ------------------------------------------------------------ setting */

  const user = await User.findOne({ email: String(email).toLowerCase().trim() });

  if (!user) {
    console.error(`\n  No account for ${email}.\n`);
    process.exit(1);
  }

  const clearing = '--clear' === value;

  if (!value) {
    console.error('\n  Give an installation id, or --clear to remove one.\n');
    process.exit(1);
  }

  /* DIGITS ONLY. A pasted URL — github.com/settings/installations/176399104
   * — is the likeliest wrong input, and storing it would fail much later
   * with a 404 from an endpoint whose path had a slash in the middle. */
  if (!clearing && !/^\d+$/.test(String(value).trim())) {
    console.error(`\n  "${value}" is not an installation id. It is a number —`);
    console.error('  the one at the end of github.com/settings/installations/<id>.\n');
    process.exit(1);
  }

  user.githubInstallationId = clearing ? '' : String(value).trim();
  await user.save();

  console.log(`\n  ${user.email} → ${user.githubInstallationId || '(none)'}\n`);

  if (!clearing) {
    console.log('  Its next Local Website Options build will publish to GitHub');
    console.log('  on its own. Run tools/github-check.js first if you want to');
    console.log('  confirm the credentials before spending credits.\n');
  }
}

main()
  .catch((err) => {
    console.error(`\n  ${err.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
