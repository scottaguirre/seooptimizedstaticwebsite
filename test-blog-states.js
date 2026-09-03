// test-blog-states.js
//
// The slot state machine, after write-ahead split writing from publishing.
//
//   node test-blog-states.js                 # shape checks only, no database
//   MONGO_URI=... node test-blog-states.js   # also runs the real transitions
//
// TWO HALVES, AND THE FIRST ONE IS THE IMPORTANT ONE.
//
// Every transition in BlogCampaign is a conditional update: a filter that
// names the ONLY status the slot may currently be in, and a $set that moves
// it. The entire safety of the design rests on those filters. If
// markSlotScheduled's filter said 'generating' instead of 'ready', or if a
// $set key were written 'slots.status' instead of 'slots.$.status', nothing
// would throw — Mongo would simply match nothing, or write to the wrong place,
// and the failure would show up weeks later as a campaign that silently
// stopped.
//
// So part one calls each static against a captured findOneAndUpdate and asserts
// the exact documents it builds. That needs no database and no network, which
// means it runs in CI and it runs here.
//
// Part two does the same transitions against a real Mongo, including the ones
// that must FAIL, and is skipped when MONGO_URI is not set.

const assert = require('assert');

let passed = 0, failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { console.log(`  ok    ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}

/**
 * Call a schema static without a database.
 *
 * The statics are plain functions on the schema, so they can be borrowed and
 * given a `this` that records rather than queries. What comes back is exactly
 * what would have gone to Mongo.
 */
function capture(statics, name, args) {
  let seen = null;

  const fakeModel = {
    findOneAndUpdate(filter, update, options) {
      seen = { filter, update, options };
      return Promise.resolve(null);
    },
  };

  statics[name].apply(fakeModel, args);

  assert.ok(seen, `${name} did not call findOneAndUpdate`);
  return seen;
}

/** The single $elemMatch every transition filters on. */
function slotFilter(call) {
  assert.ok(call.filter.slots, 'filter has no slots clause');
  assert.ok(call.filter.slots.$elemMatch, 'filter does not use $elemMatch');
  return call.filter.slots.$elemMatch;
}

(async () => {

/* ==========================================================================
 * PART ONE — the update documents, no database
 * ====================================================================== */

console.log('\nTransition filters — which status each one demands');

// Loaded through mongoose, but never connected. Requiring a model compiles the
// schema; it does not open a socket.
const mongoose = require('mongoose');
const BlogCampaign = require('./models/BlogCampaign');
const statics = BlogCampaign.schema.statics;

const CID = new mongoose.Types.ObjectId();
const JID = new mongoose.Types.ObjectId();

await test('claimSlot only takes a pending slot', () => {
  const call = capture(statics, 'claimSlot', [CID, 3, JID]);
  const m = slotFilter(call);

  assert.strictEqual(m.status, 'pending',
    `claimSlot would take a slot in '${m.status}' — two callers could both generate`);
  assert.strictEqual(m.index, 3);
  assert.strictEqual(call.update.$set['slots.$.status'], 'generating');

  // The retry cap depends on this. Without the increment, attempts never
  // rises and MAX_ATTEMPTS never bites.
  assert.strictEqual(call.update.$inc['slots.$.attempts'], 1,
    'claimSlot must increment attempts, or a failing topic retries forever');
});

await test('markSlotReady only completes a generating slot, and charges in the same write', () => {
  const call = capture(statics, 'markSlotReady', [CID, 3, { credits: 75, jobId: JID }]);
  const m = slotFilter(call);

  assert.strictEqual(m.status, 'generating',
    'markSlotReady must require generating — this filter is what makes charge-once atomic');
  assert.strictEqual(call.update.$set['slots.$.status'], 'ready');
  assert.strictEqual(call.update.$set['slots.$.credits'], 75);

  // Status and charge in ONE update. Two updates could be interrupted between
  // them, leaving a slot marked paid that never was, or the reverse.
  assert.ok(call.update.$set['slots.$.chargedAt'] instanceof Date,
    'chargedAt must be written in the same update as the status');
});

await test('markSlotScheduled only accepts a ready slot', () => {
  const call = capture(statics, 'markSlotScheduled', [CID, 3, {
    wpPostId: 412,
    url: 'https://example.com/mold-in-drywall-2/',
    title: 'Mold In Drywall',
    scheduledFor: new Date('2026-10-01T09:00:00Z'),
  }]);
  const m = slotFilter(call);

  assert.strictEqual(m.status, 'ready',
    'a slot may only be handed to WordPress once it has been written and paid for');
  assert.strictEqual(call.update.$set['slots.$.status'], 'scheduled');
  assert.strictEqual(call.update.$set['slots.$.wpPostId'], 412);
});

await test('the permalink is recorded at scheduling, not at publication', () => {
  const call = capture(statics, 'markSlotScheduled', [CID, 3, {
    wpPostId: 412,
    url: 'https://example.com/mold-in-drywall-2/',
    title: 'Mold In Drywall',
  }]);

  // The -2 is the point. WordPress appends it when a slug is taken, and every
  // later link resolves against what it actually assigned.
  assert.strictEqual(
    call.update.$set['slots.$.publishedUrl'],
    'https://example.com/mold-in-drywall-2/',
    'the URL must be stored as WordPress reported it'
  );
  assert.strictEqual(call.update.$set['slots.$.publishedTitle'], 'Mold In Drywall');
});

await test('markSlotLive only accepts a scheduled slot', () => {
  const call = capture(statics, 'markSlotLive', [CID, 3, new Date('2026-10-01T14:00:00Z')]);
  const m = slotFilter(call);

  assert.strictEqual(m.status, 'scheduled',
    'a post cannot go live from ready — it has to exist in WordPress first');
  assert.strictEqual(call.update.$set['slots.$.status'], 'published');
});

await test('markSlotLive does not rewrite the id, url or title', () => {
  const call = capture(statics, 'markSlotLive', [CID, 3, new Date()]);
  const keys = Object.keys(call.update.$set);

  // Those were settled at scheduling. Writing them again from a later, thinner
  // payload is how a correct value gets overwritten with an empty string.
  for (const key of ['slots.$.wpPostId', 'slots.$.publishedUrl', 'slots.$.publishedTitle']) {
    assert.ok(!keys.includes(key), `markSlotLive must not touch ${key}`);
  }
});

await test('releaseSlot returns a slot to pending unless told to give up', () => {
  const soft = capture(statics, 'releaseSlot', [CID, 3, { message: 'timeout', giveUp: false }]);
  assert.strictEqual(slotFilter(soft).status, 'generating');
  assert.strictEqual(soft.update.$set['slots.$.status'], 'pending',
    'a transient failure must not cost the customer a post');

  const hard = capture(statics, 'releaseSlot', [CID, 3, { message: 'refused', giveUp: true }]);
  assert.strictEqual(hard.update.$set['slots.$.status'], 'failed');
});

await test('reopenSlot only revives a failed slot, and only under the attempts cap', () => {
  const call = capture(statics, 'reopenSlot', [CID, 3, 3]);
  const m = slotFilter(call);

  assert.strictEqual(m.status, 'failed',
    'reopenSlot must not touch a slot that is ready, scheduled or published');

  // Without the cap in the FILTER, a topic the model keeps refusing can be
  // reopened forever by anyone pressing the button, and each attempt is an API
  // call. Checking it in the caller instead leaves a race between two presses.
  assert.deepStrictEqual(m.attempts, { $lt: 3 },
    'the attempts cap has to be part of the filter, not a check in the caller');

  assert.strictEqual(call.update.$set['slots.$.status'], 'pending');
  assert.strictEqual(call.update.$set['slots.$.error'], '',
    'the old error should be cleared, or the campaign screen shows a stale reason');
});

await test('every transition writes through the positional operator', () => {
  const calls = [
    capture(statics, 'claimSlot', [CID, 0, JID]),
    capture(statics, 'markSlotReady', [CID, 0, { credits: 75, jobId: JID }]),
    capture(statics, 'markSlotScheduled', [CID, 0, { wpPostId: 1, url: 'u', title: 't' }]),
    capture(statics, 'markSlotLive', [CID, 0, new Date()]),
    capture(statics, 'releaseSlot', [CID, 0, { message: 'x' }]),
  ];

  for (const call of calls) {
    for (const key of Object.keys(call.update.$set || {})) {
      assert.ok(key.startsWith('slots.$.'),
        `'${key}' is not positional — it would write to the campaign, not the slot`);
    }
  }
});

await test('every transition asks for the updated document back', () => {
  const calls = ['claimSlot', 'markSlotReady', 'markSlotScheduled', 'markSlotLive', 'releaseSlot'];

  for (const name of calls) {
    const args = name === 'markSlotScheduled' ? [CID, 0, { wpPostId: 1, url: '', title: '' }]
      : name === 'markSlotLive' ? [CID, 0, new Date()]
      : name === 'markSlotReady' ? [CID, 0, { credits: 75, jobId: JID }]
      : name === 'releaseSlot' ? [CID, 0, { message: '' }]
      : [CID, 0, JID];

    const call = capture(statics, name, args);

    // Callers test the return for null to learn whether they won the race.
    // Without { new: true } they get the PRE-update document, which is
    // non-null on a successful update and reads as "someone else got it".
    assert.strictEqual(call.options && call.options.new, true,
      `${name} must pass { new: true } — callers use the result to detect a lost race`);
  }
});

console.log('\nThe schema itself');

await test('the slot enum carries scheduled, between ready and published', () => {
  const values = BlogCampaign.schema.path('slots').schema.path('status').enumValues;

  assert.ok(values.includes('scheduled'), 'scheduled is missing from the slot enum');
  assert.ok(values.indexOf('scheduled') > values.indexOf('ready'));
  assert.ok(values.indexOf('scheduled') < values.indexOf('published'));
});

await test('the campaign enum carries writing', () => {
  const values = BlogCampaign.schema.path('status').enumValues;
  assert.ok(values.includes('writing'),
    'without writing, a campaign mid-batch is indistinguishable from one ready to publish');
  assert.ok(values.includes('draft'));
});

await test('one post per slot is enforced by a unique index, not by application code', () => {
  const BlogPost = require('./models/BlogPost');

  const unique = BlogPost.schema.indexes().find(([keys, opts]) =>
    keys.campaign === 1 && keys.slotIndex === 1 && opts && opts.unique
  );

  assert.ok(unique,
    'BlogPost needs a unique { campaign, slotIndex } index — it is what stops a ' +
    'retry or a racing worker producing two posts for one slot');
});

/* ==========================================================================
 * PART TWO — the real thing
 * ====================================================================== */

if (!process.env.MONGO_URI) {
  console.log('\n(skipping database tests — set MONGO_URI to run them)');
} else {
  console.log('\nAgainst a real Mongo');

  const BlogPost = require('./models/BlogPost');
  await mongoose.connect(process.env.MONGO_URI);

  const site = new mongoose.Types.ObjectId();
  const user = new mongoose.Types.ObjectId();
  const made = [];

  async function seed(slotStatuses) {
    const campaign = await BlogCampaign.create({
      user,
      site,
      name: 'state machine test',
      targetPage: { url: 'https://example.com/x.html', keyword: 'mold mitigation' },
      status: 'active',
      slots: slotStatuses.map((status, i) => ({
        index: i,
        topic: `topic ${i}`,
        status,
        publishAt: new Date(Date.now() + i * 86400000),
      })),
    });
    made.push(campaign._id);
    return campaign;
  }

  const statusOf = (campaign, i) => campaign.slots.find(s => s.index === i).status;

  await test('the full path: pending -> generating -> ready -> scheduled -> published', async () => {
    const c = await seed(['pending']);

    assert.ok(await BlogCampaign.claimSlot(c._id, 0, JID));
    assert.ok(await BlogCampaign.markSlotReady(c._id, 0, { credits: 75, jobId: JID }));
    assert.ok(await BlogCampaign.markSlotScheduled(c._id, 0, {
      wpPostId: 99, url: 'https://example.com/p/', title: 'P',
    }));

    const done = await BlogCampaign.markSlotLive(c._id, 0, new Date());
    assert.strictEqual(statusOf(done, 0), 'published');
    assert.strictEqual(done.slots[0].wpPostId, 99, 'the id survived the last transition');
  });

  await test('a second claim on the same slot returns null', async () => {
    const c = await seed(['pending']);

    assert.ok(await BlogCampaign.claimSlot(c._id, 0, JID));
    assert.strictEqual(await BlogCampaign.claimSlot(c._id, 0, JID), null,
      'the loser of the race must get null, or both callers generate and both charge');
  });

  await test('a repeated charge changes nothing', async () => {
    const c = await seed(['pending']);
    await BlogCampaign.claimSlot(c._id, 0, JID);

    const first = await BlogCampaign.markSlotReady(c._id, 0, { credits: 75, jobId: JID });
    const chargedAt = first.slots[0].chargedAt;

    assert.strictEqual(await BlogCampaign.markSlotReady(c._id, 0, { credits: 75, jobId: JID }), null);

    const after = await BlogCampaign.findById(c._id);
    assert.strictEqual(after.slots[0].chargedAt.getTime(), chargedAt.getTime(),
      'the charge timestamp moved — the customer would be billed twice');
  });

  await test('a slot cannot skip scheduling and go straight live', async () => {
    const c = await seed(['ready']);

    assert.strictEqual(await BlogCampaign.markSlotLive(c._id, 0, new Date()), null,
      'ready -> published would mean a post nobody ever created in WordPress');
  });

  await test('a duplicate scheduling confirmation is refused, not applied twice', async () => {
    const c = await seed(['ready']);

    assert.ok(await BlogCampaign.markSlotScheduled(c._id, 0, { wpPostId: 7, url: 'https://a/', title: 'A' }));
    assert.strictEqual(
      await BlogCampaign.markSlotScheduled(c._id, 0, { wpPostId: 8, url: 'https://b/', title: 'B' }),
      null,
      'the second confirmation must not overwrite the first post id'
    );

    const after = await BlogCampaign.findById(c._id);
    assert.strictEqual(after.slots[0].wpPostId, 7);
  });

  await test('missedSchedule finds only scheduled posts past their date', async () => {
    const c = await seed(['scheduled', 'scheduled', 'ready', 'published']);

    const hourAgo = new Date(Date.now() - 3600000);
    const nextWeek = new Date(Date.now() + 7 * 86400000);

    c.slots[0].publishAt = hourAgo;    // missed
    c.slots[1].publishAt = nextWeek;   // not due
    c.slots[2].publishAt = hourAgo;    // due but never handed over
    c.slots[3].publishAt = hourAgo;    // already live
    await c.save();

    const missed = c.missedSchedule(new Date());

    assert.strictEqual(missed.length, 1, `expected 1 missed slot, got ${missed.length}`);
    assert.strictEqual(missed[0].index, 0);
  });

  await test('the grace period keeps a just-passed slot out of the sweep', async () => {
    const c = await seed(['scheduled']);
    c.slots[0].publishAt = new Date(Date.now() - 60000);   // one minute ago
    await c.save();

    assert.strictEqual(c.missedSchedule(new Date()).length, 0,
      'a one-minute-old slot must not be treated as missed — WP-Cron has not had a chance');
  });

  await test('uncollectedSlots finds written posts WordPress never took', async () => {
    const c = await seed(['ready', 'scheduled', 'ready', 'pending']);
    const stranded = c.uncollectedSlots();

    assert.strictEqual(stranded.length, 2);
    assert.deepStrictEqual(stranded.map(s => s.index), [0, 2]);
  });

  await test('two posts cannot be stored for one slot', async () => {
    const c = await seed(['ready']);
    await BlogPost.init();   // the unique index has to exist before it can bite

    await BlogPost.storeForSlot(c, 0, {
      title: 'First', sections: [{ heading: null, paragraphs: ['one'] }],
      quality: { stats: { words: 800 } },
    });

    // The same call again is an UPDATE, not a duplicate: a slot released after
    // a failed write is legitimately written a second time.
    await BlogPost.storeForSlot(c, 0, {
      title: 'Second', sections: [{ heading: null, paragraphs: ['two'] }],
      quality: { stats: { words: 850 } },
    });

    const all = await BlogPost.find({ campaign: c._id });
    assert.strictEqual(all.length, 1, 'the upsert produced a duplicate');
    assert.strictEqual(all[0].title, 'Second', 'the retry should replace the wreckage of the first');
    assert.strictEqual(all[0].words, 850, 'words should be lifted out of quality.stats');

    // And a raw insert bypassing the upsert must be rejected by the index.
    await assert.rejects(
      () => BlogPost.create({ campaign: c._id, site, slotIndex: 0, title: 'Third' }),
      /duplicate key/i,
      'the unique index did not fire — application code is not enough here'
    );
  });

  await test('the first section keeps its null heading through a round trip', async () => {
    const c = await seed(['ready']);

    await BlogPost.storeForSlot(c, 0, {
      title: 'T',
      sections: [
        { heading: null, paragraphs: ['the opening'] },
        { heading: 'A subheading', paragraphs: ['more'] },
      ],
      targets: { money: { url: 'https://example.com/x.html' }, next: { pending_id: 'slot-1' } },
    });

    const stored = await BlogPost.forSlot(c._id, 0);

    assert.strictEqual(stored.sections[0].heading, null,
      'a null opening heading became something else — IE_Links::render would emit an empty <h2>');
    assert.strictEqual(stored.sections[1].heading, 'A subheading');

    // snake_case has to survive: PHP reads this key.
    assert.strictEqual(stored.targets.next.pending_id, 'slot-1',
      'pending_id was dropped or renamed — the placeholder span would never be written');
  });

  await BlogPost.deleteMany({ campaign: { $in: made } });
  await BlogCampaign.deleteMany({ _id: { $in: made } });
  await mongoose.disconnect();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

})();