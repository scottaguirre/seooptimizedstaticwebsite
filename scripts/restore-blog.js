#!/usr/bin/env node
//
// scripts/restore-blog.js — a blog, back from its own backup.
//
//   node scripts/restore-blog.js <blog.json> --user <id>           # shows the plan
//   node scripts/restore-blog.js <blog.json> --user <id> --write   # writes it
//
// Get the file first, from the blog itself:
//
//   curl -sO https://all-about-concrete.explr-home.com/_data/blog.json
//
// DRY RUN UNLESS --write, and that is the same rule the publish screen
// follows. This creates a BlogSite, its campaigns and every article; running
// it twice by accident gives an account two of a blog, and there is no undo
// but deleting one by hand and hoping you picked the right one.
//
// IT REFUSES TO WRITE TO A PRODUCTION DATABASE unless told twice. The point
// of this script is to PROVE the backup is sufficient, and that proof is run
// against a scratch database. A restore aimed at the live one, by somebody
// checking whether the backup works, would write a duplicate blog into
// production — which is the exact accident this guard is here to prevent.
//
// THE LOGIC IS NOT IN HERE. utils/blog/restoreBlog.js does the planning and
// is tested in memory by test-restore-blog.js. This file reads a path, opens
// a connection and prints — nothing worth testing and nothing worth hiding.

'use strict';

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const { planRestore, writeRestore } = require('../utils/blog/restoreBlog');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : '';
}

const file = process.argv[2];
const user = arg('user');
const write = process.argv.includes('--write');
const force = process.argv.includes('--i-mean-it');

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!file || file.startsWith('--')) {
  die('Usage: node scripts/restore-blog.js <blog.json> --user <id> [--write]');
}

/* ---------------------------------------------------------------- the plan */

let backup;

try {
  backup = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
} catch (err) {
  die(`Could not read ${file}: ${err.message}`);
}

const plan = planRestore(backup, { user });

if (!plan.ok) die(plan.error);

console.log('');
console.log(`  Blog       ${plan.site.siteUrl}`);
console.log(`  Name       ${plan.site.business.name}`);
console.log(`  Timezone   ${plan.site.timezone}`);
console.log(`  Campaigns  ${plan.campaigns.length}`);
console.log(`  Articles   ${plan.posts.length}`);

if (plan.warnings.length) {
  console.log('\n  What this restore CANNOT bring back:\n');
  for (const w of plan.warnings) console.log(`    - ${w}`);
}

if (!write) {
  console.log('\n  Nothing was written. Add --write to do it for real.\n');
  process.exit(0);
}

/* --------------------------------------------------------------- the write */

const uri = process.env.MONGO_URI;

if (!uri) die('MONGO_URI is not set.');

/* A SCRATCH DATABASE, OR AN EXPLICIT SECOND YES.
 *
 * `mongodb+srv://` is Atlas, which for this project means production. The
 * check is crude on purpose: it is easier to add --i-mean-it on the rare
 * legitimate occasion than to notice, afterwards, that a duplicate blog was
 * written into the live database by somebody testing a backup. */
if (/mongodb\+srv:/.test(uri) && !force) {
  die('MONGO_URI looks like Atlas. Restores are meant for a scratch database.\n'
    + '  If you really mean the live one, add --i-mean-it.');
}

(async () => {
  await mongoose.connect(uri);

  const BlogSite = require('../models/BlogSite');
  const BlogCampaign = require('../models/BlogCampaign');
  const BlogPost = require('../models/BlogPost');

  /* REFUSED IF THE BLOG IS ALREADY THERE. Restoring over a live blog would
   * give the account two records on one domain, and siteUrl uniqueness is
   * code-only with no index behind it — so nothing else would stop it. */
  const existing = await BlogSite.findOne({ siteUrl: plan.site.siteUrl }).lean();

  if (existing && !force) {
    await mongoose.disconnect();
    die(`A blog already exists for ${plan.site.siteUrl}. Delete it first, or add --i-mean-it.`);
  }

  /* THE WRITING ITSELF IS IN utils/blog/restoreBlog.js, with the models
   * injected, so it is tested. It was inline here and therefore untested —
   * which for the one piece of code that exists to run on the worst day was
   * the wrong way round. This file reads a path, opens a connection and
   * prints. */
  const out = await writeRestore({
    plan,
    Site: BlogSite,
    Campaign: BlogCampaign,
    Post: BlogPost,
  });

  if (!out.ok) {
    await mongoose.disconnect();
    die(out.error);
  }

  if (out.orphans.length) {
    console.log(`\n  ${out.orphans.length} article(s) belonged to no campaign and were skipped:`);
    for (const slug of out.orphans) console.log(`    - ${slug}`);
  }

  console.log(`\n  Restored ${plan.site.siteUrl}: `
    + `${out.campaigns} campaign(s), ${out.posts} article(s).`);
  console.log('  Publish it from the Static Blogs screen to put it back on Cloudflare.\n');

  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(`\n  The restore failed partway: ${err.message}`);
  console.error('  Check what was written before running it again.\n');
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
