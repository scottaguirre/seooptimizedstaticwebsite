#!/usr/bin/env node
// scripts/measure-db.js
//
// How big is the database, actually.
//
//   cd ~/app && node scripts/measure-db.js
//
// WHY THIS EXISTS
//
// The whole Cloudflare storage plan rests on one number that nobody has ever
// checked: "an article is about 12 KB, so a 512 MB Atlas tier holds roughly
// 40,000 of them". That figure was arrived at by thinking about it. Every
// decision underneath it — whether to keep article prose in Mongo at all,
// whether /_data/blog.json is worth the complexity, how urgent the 15-day
// deletion is — is cheaper to make with a real number in hand.
//
// It is also the only honest way to find out whether the pressure is coming
// from where everyone assumes. It might be the articles. It might equally be
// the keyword caches, or Job.payload, or an index nobody remembers adding.
//
// READ-ONLY. It runs stats commands and two aggregations and writes nothing.
// Safe to run against production, which is the only place the answer lives.
//
// IT NEVER PRINTS THE CONNECTION STRING. The URI holds the Atlas password, so
// the only thing said about it out loud is which host and database it reached
// — enough to confirm you measured the right one, and nothing more.

'use strict';

require('dotenv').config();

const mongoose = require('mongoose');

/* The collections worth naming. Anything else in the database is listed too,
 * under "other", so a collection nobody remembered cannot hide. */
const INTERESTING = [
  'blogposts',
  'blogcampaigns',
  'blogsites',
  'jobs',
  'keywordcaches',
  'paacaches',
  'users',
  'purchases',
  'keywordbudgets',
];

/** Bytes as something a person can read. */
function mb(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function pad(text, width) {
  return String(text).padEnd(width);
}

function padLeft(text, width) {
  return String(text).padStart(width);
}

/**
 * Per-collection size, via the collStats command.
 *
 * NOT collection.stats(). That helper was removed in driver 6, and this app
 * is on 6.20 — calling it throws "stats is not a function", which looks like
 * a connection problem rather than a renamed method.
 */
async function collectionStats(db, name) {
  const shape = s => ({
    name,
    count: s.count || 0,
    size: s.size || 0,                   // the documents
    storage: s.storageSize || 0,         // what they occupy on disk
    indexes: s.totalIndexSize || 0,
    avg: s.avgObjSize || 0,
  });

  /* THE $collStats STAGE FIRST, the collStats COMMAND second, and both are
   * here because the command is deprecated from MongoDB 6.2 and the stage
   * does not exist before 4.4. Whichever Atlas is running, one of them
   * answers — and finding out which on the night is worse than nine lines. */
  try {
    const rows = await db.collection(name)
      .aggregate([{ $collStats: { storageStats: {} } }])
      .toArray();

    if (rows.length && rows[0].storageStats) {
      return shape(rows[0].storageStats);
    }
  } catch (err) {
    // fall through
  }

  try {
    return shape(await db.command({ collStats: name }));

  } catch (err) {
    /* A collection that does not exist yet is not an error — it is an
     * answer. Atlas also refuses stats on a few system namespaces. */
    return { name, missing: true, why: err.message };
  }
}

/**
 * What an ARTICLE actually weighs.
 *
 * avgObjSize over the whole collection is the headline number, but it
 * averages a finished article against a row that was created and never
 * written to. This asks the ones with prose in them, which is the number the
 * storage plan is really about.
 */
async function articleWeight(db) {
  /* $type GUARDS, not $ifNull. A field that holds something other than an
   * array makes $size throw, and the whole aggregation fails with it — on a
   * read-only script whose only job is to report a number, one odd document
   * must not take the answer down. */
  const rows = await db.collection('blogposts').aggregate([
    {
      $project: {
        bytes: { $bsonSize: '$$ROOT' },
        written: {
          $gt: [
            { $cond: [{ $eq: [{ $type: '$sections' }, 'array'] }, { $size: '$sections' }, 0] },
            0,
          ],
        },
      },
    },
    {
      $group: {
        _id: '$written',
        n: { $sum: 1 },
        total: { $sum: '$bytes' },
        avg: { $avg: '$bytes' },
        max: { $max: '$bytes' },
      },
    },
  ], { allowDiskUse: true }).toArray();

  return rows;
}

/**
 * What Job.payload weighs, and how much of it is already cleared.
 *
 * utils/jobPayloads.js empties the payload when a site is deleted, which
 * started on 17 October. This says whether that is reclaiming anything worth
 * reclaiming, and how much is still sitting in old completed jobs.
 */
async function payloadWeight(db) {
  const rows = await db.collection('jobs').aggregate([
    {
      $project: {
        status: 1,

        /* $bsonSize wants a document. A payload that is somehow a string or
         * a number would throw, so anything that is not an object is
         * measured as the empty one — which is what it is worth here. */
        bytes: {
          $bsonSize: {
            $cond: [{ $eq: [{ $type: '$payload' }, 'object'] }, '$payload', {}],
          },
        },
      },
    },
    {
      $project: {
        status: 1,
        bytes: 1,

        /* AN EMPTY BSON DOCUMENT IS 5 BYTES — four for the length and the
         * terminator. Comparing sizes rather than calling $objectToArray
         * keeps this working whatever the field turns out to hold. */
        empty: { $lte: ['$bytes', 5] },
      },
    },
    {
      $group: {
        _id: { status: '$status', empty: '$empty' },
        n: { $sum: 1 },
        total: { $sum: '$bytes' },
        avg: { $avg: '$bytes' },
      },
    },
    { $sort: { total: -1 } },
  ], { allowDiskUse: true }).toArray();

  return rows;
}

async function main() {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    console.error('MONGO_URI is not set. Run this from ~/app, where .env is.');
    process.exit(1);
  }

  await mongoose.connect(uri);

  const db = mongoose.connection.db;

  /* Host and database name only. Never the URI. */
  console.log('');
  console.log(`database : ${db.databaseName}`);
  console.log(`host     : ${mongoose.connection.host}`);
  console.log('');

  // ---------------------------------------------------------------- totals
  const stats = await db.stats();

  console.log('WHOLE DATABASE');
  console.log('');
  console.log(`  documents      ${stats.objects.toLocaleString()}`);
  console.log(`  document data  ${mb(stats.dataSize)}`);
  console.log(`  on disk        ${mb(stats.storageSize)}`);
  console.log(`  indexes        ${mb(stats.indexSize)}`);
  console.log(`  TOTAL USED     ${mb((stats.storageSize || 0) + (stats.indexSize || 0))}`);
  console.log('');
  console.log('  (a shared Atlas tier counts storage + indexes against the limit)');
  console.log('');

  // ----------------------------------------------------------- collections
  const names = (await db.listCollections().toArray()).map(c => c.name).sort();
  const ordered = [
    ...INTERESTING.filter(n => names.includes(n)),
    ...names.filter(n => !INTERESTING.includes(n)),
  ];

  const all = [];
  for (const name of ordered) {
    all.push(await collectionStats(db, name));
  }

  console.log('BY COLLECTION  (largest first by storage + indexes)');
  console.log('');
  console.log(`  ${pad('collection', 20)}${padLeft('docs', 10)}${padLeft('data', 12)}${padLeft('on disk', 12)}${padLeft('indexes', 12)}${padLeft('avg doc', 12)}`);
  console.log(`  ${'-'.repeat(78)}`);

  all
    .filter(c => !c.missing)
    .sort((a, b) => (b.storage + b.indexes) - (a.storage + a.indexes))
    .forEach(c => {
      console.log(
        `  ${pad(c.name, 20)}${padLeft(c.count.toLocaleString(), 10)}${padLeft(mb(c.size), 12)}${padLeft(mb(c.storage), 12)}${padLeft(mb(c.indexes), 12)}${padLeft(mb(c.avg), 12)}`
      );
    });

  all.filter(c => c.missing).forEach(c => {
    console.log(`  ${pad(c.name, 20)}  (not readable: ${c.why})`);
  });

  console.log('');

  // -------------------------------------------------------------- articles
  if (names.includes('blogposts')) {
    console.log('WHAT AN ARTICLE WEIGHS');
    console.log('');

    const rows = await articleWeight(db);

    if (!rows.length) {
      console.log('  no blog posts stored');
    } else {
      rows
        .sort((a, b) => Number(b._id) - Number(a._id))
        .forEach(r => {
          const label = r._id ? 'with prose' : 'no sections yet';
          console.log(`  ${pad(label, 20)}${padLeft(r.n.toLocaleString(), 10)} rows${padLeft(mb(r.avg), 12)} avg${padLeft(mb(r.max), 12)} max${padLeft(mb(r.total), 12)} total`);
        });

      const written = rows.find(r => r._id);

      if (written && written.avg) {
        /* The number the plan was built on, restated with the real average.
         * 512 MB is the shared-tier limit; indexes are left out of this
         * division on purpose, so it reads as an upper bound rather than a
         * promise. */
        const fit = Math.floor((512 * 1024 * 1024) / written.avg);
        console.log('');
        console.log(`  at ${mb(written.avg)} each, 512 MB of document data is about ${fit.toLocaleString()} articles`);
        console.log('  (the plan assumed 12 KB and ~40,000 — compare)');
      }
    }

    console.log('');
  }

  // ------------------------------------------------------- wizard payloads
  if (names.includes('jobs')) {
    console.log('WHAT Job.payload WEIGHS');
    console.log('');

    const rows = await payloadWeight(db);

    if (!rows.length) {
      console.log('  no jobs');
    } else {
      rows.forEach(r => {
        const label = `${r._id.status || 'unknown'} ${r._id.empty ? '(cleared)' : '(holding a form)'}`;
        console.log(`  ${pad(label, 30)}${padLeft(r.n.toLocaleString(), 8)} rows${padLeft(mb(r.avg), 12)} avg${padLeft(mb(r.total), 12)} total`);
      });
    }

    console.log('');
  }

  await mongoose.disconnect();
}

main().catch(async err => {
  console.error('');
  console.error('Could not measure the database:', err.message);
  console.error('');

  try { await mongoose.disconnect(); } catch (e) { /* already gone */ }

  process.exit(1);
});
