// test-batch-cancel.js
//
// Stopping a batch that is already writing.
//
//   node test-batch-cancel.js
//
// THE BUG
//
// Edwin approved eleven articles, pressed "Pause campaign" a few seconds
// later, and watched the spinner carry on. All eleven were written and 825
// credits were charged.
//
// Two halves, and neither side was obviously wrong on its own:
//
//   - IE_Publisher::pause() is WordPress-only. It sets the local status and
//     holds scheduled posts back as drafts. It told the server nothing, and
//     the server only learned the status on the HOURLY reconciliation — long
//     after a batch that takes minutes had finished.
//
//   - writeCampaign()'s loop had no cancel check of any kind. Nothing could
//     have stopped it even if the message had arrived.
//
// And the confirm dialog said "nothing new is written", which was true of the
// publishing schedule and false of the one thing moving fast enough to matter.
//
// WHY THIS SUITE EXISTS SEPARATELY FROM test-ie-pause.js
//
// That file has twenty-six tests about pause and twenty of them could not
// have caught this. They are not wrong: every one asks what pause does to
// WORDPRESS — post statuses, held dates, the schedule screens — and the whole
// failure was that pause said nothing to anybody else. The plugin half is
// tested over there; this is the server half.
//
// blogGenerator.js requires Mongoose, which is why it has never had a test.
// The same module-stubbing harness test-campaign-reconcile.js uses works
// here: fake the models, fake the writer, and ask the loop what it does.

const assert = require('assert');
const Module = require('module');

let passed = 0, failed = 0;

async function atest(name, fn) {
  try { await fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

/* ------------------------------------------------------------------ *
 * The world, as far as writeCampaign() can tell
 * ------------------------------------------------------------------ */

/** Mutable state every stub reads and writes. Reset by `given()`. */
let db;

function given({ slots = 3, cancelAfter = null, writeFails = [] } = {}) {
  db = {
    campaign: {
      _id: 'c1',
      user: 'u1',
      site: { _id: 's1', siteUrl: 'example.test' },
      status: 'draft',
      batch: { cancelRequested: false },
      slots: Array.from({ length: slots }, (_, i) => ({
        index: i,
        topic: `Topic ${i}`,
        slug: `topic-${i}`,
        status: 'pending',
        moneyAnchor: 'anchor',
        anchorType: 'semantic',
      })),
      targetPage: { url: 'https://example.test/p/', keyword: 'kw', title: 'P' },
    },
    updates: [],
    written: [],
    charged: 0,
    /* Set the flag once this many posts have been written, which is how a
     * pause arriving mid-batch actually behaves: the loop is already running
     * and something else flips it underneath. */
    cancelAfter,
    writeFails,
    progress: [],
    logged: [],
  };
}

function applyUpdate($set = {}) {
  for (const [key, value] of Object.entries($set)) {
    if (key.startsWith('batch.')) {
      db.campaign.batch[key.slice('batch.'.length)] = value;
    } else {
      db.campaign[key] = value;
    }
  }
}

const FakeCampaign = {
  findById(id) {
    /* RETURNS A CHAINABLE, because the code under test calls
     * .select().lean() on one path and .populate() on another. A stub that
     * only answered the shape used by the line being tested would pass while
     * the other path threw in production. */
    const doc = db.campaign;
    const chain = {
      select: () => chain,
      lean: async () => JSON.parse(JSON.stringify(doc)),
      populate: async () => doc,
      then: (res, rej) => Promise.resolve(doc).then(res, rej),
    };
    return chain;
  },
  updateOne: async (where, { $set }) => { db.updates.push($set); applyUpdate($set); },
  reopenSlot: async () => {},

  /* THE SLOT STATICS, MODELLED ON THE REAL CONDITIONAL UPDATES.
   *
   * claimSlot only succeeds on a 'pending' slot and markSlotReady only on a
   * 'generating' one — that pair is what stops two workers writing and
   * charging for the same post. A stub that always said yes would make every
   * assertion about counts and credits below meaningless. */
  claimSlot: async (id, index) => {
    const slot = db.campaign.slots.find(s => s.index === index);
    if (!slot || 'pending' !== slot.status) return null;
    slot.status = 'generating';
    return db.campaign;
  },

  markSlotReady: async (id, index) => {
    const slot = db.campaign.slots.find(s => s.index === index);
    if (!slot || 'generating' !== slot.status) return null;
    slot.status = 'ready';
    return db.campaign;
  },

  releaseSlot: async (id, index, { giveUp } = {}) => {
    const slot = db.campaign.slots.find(s => s.index === index);
    if (slot) slot.status = giveUp ? 'failed' : 'pending';
  },
};

const FakeUser = { findById: async () => ({ _id: 'u1', credits: 100000 }) };

const FakePost = {
  forCampaign: async () => [],
  create: async () => ({}),
  storeForSlot: async (campaignId, index, post) => ({ _id: `p-${index}`, ...post }),
};

const realLoad = Module._load;

Module._load = function (request) {
  if (request === 'mongoose') {
    function FakeSchema() {
      this.statics = {}; this.methods = {};
      this.index = () => this; this.pre = () => this;
      this.post = () => this; this.virtual = () => ({ get: () => {}, set: () => {} });
    }
    FakeSchema.Types = { ObjectId: 'ObjectId', Mixed: 'Mixed' };
    return { Schema: FakeSchema, model: (n, s) => s.statics, Types: { ObjectId: String } };
  }

  if (request.endsWith('models/BlogCampaign')) return FakeCampaign;
  if (request.endsWith('models/User')) return FakeUser;
  if (request.endsWith('models/BlogPost')) return FakePost;

  /* REPLACED WHOLE, not spread over the real module.
   *
   * helpers.js is the site generator's toolbox — it pulls in a dozen files
   * that have nothing to do with writing a blog post, and loading it to
   * borrow one function means every one of those has to resolve. Only
   * chargeCredits is reached from here. */
  if (request.endsWith('/helpers')) {
    return {
      /* RETURNS THE REMAINING BALANCE, like the real one. The first version
       * of this stub returned `true`, the writer assigned it to
       * `user.credits`, Number(true) is 1, and the second post reported "out
       * of credits" on an account with 100,000 of them. Every assertion about
       * how many posts a batch writes would have been measuring that instead
       * of the cancel. */
      chargeCredits: async (user, n) => {
        db.charged += n;
        return Number(user.credits || 0) - n;
      },
    };
  }

  /* The real logger opens pino and, in production, a file. A suite has no
   * business writing to the application log, and the lines it emits are
   * asserted here rather than read out of one. */
  if (request.endsWith('utils/logger') || request.endsWith('/logger')) {
    return {
      log: {
        info: (event, fields) => db.logged.push({ event, ...fields }),
        error: (event, err, fields) => db.logged.push({ event, error: true, ...fields }),
        warn: () => {},
        debug: () => {},
        // The failure path logs through this one.
        external: (event, err, fields) => db.logged.push({ event, external: true, ...fields }),
      },
    };
  }

  if (request.endsWith('blog/writePost')) {
    return {
      writePost: async (slot) => {
        if (db.writeFails.includes(slot.index)) throw new Error('model said no');
        return {
          title: slot.topic,
          metaDescription: 'A description long enough to pass.',
          sections: [{ heading: null, paragraphs: ['Body.'] }],
        };
      },
      buildPrompt: () => '',
      parseJson: () => ({}),
      SYSTEM: '', SYSTEM_BLOG: '', systemFor: () => '',
    };
  }

  if (request.endsWith('blog/qualityCheck')) {
    return {
      checkPost: () => ({ ok: true, codes: [] }),
      crossCheck: () => ({ dupOpenings: [], repeats: [] }),
      worthRewriting: () => false,
    };
  }

  return realLoad.apply(this, arguments);
};

const { writeCampaign } = require('./utils/blogGenerator');

Module._load = realLoad;

/* ------------------------------------------------------------------ *
 * The one piece of real plumbing: a slot reaching 'ready'
 *
 * writeOneSlot() marks slots through the model, which is stubbed, so the
 * suite has to do it — otherwise nothing ever counts as written and every
 * assertion below is about an empty batch.
 * ------------------------------------------------------------------ */

const onProgress = async p => {
  db.progress.push(p);

  if (p.completedPage) {
    const index = Number(String(p.completedPage).replace('slot-', ''));
    const slot = db.campaign.slots.find(s => s.index === index);
    if (slot) slot.status = 'ready';
    db.written.push(index);

    // The pause lands here: after N posts, somebody presses the button.
    if (null !== db.cancelAfter && db.written.length >= db.cancelAfter) {
      db.campaign.batch.cancelRequested = true;
    }
  }
};

const job = { _id: 'j1', user: 'u1' };

const run = () => writeCampaign(
  { ...job, payload: { campaignId: 'c1' } },
  { onProgress }
);

(async () => {

console.log('\nStopping a batch that is already writing\n');

await atest('THE LOOP STOPS WHEN THE FLAG IS SET', async () => {
  /* The assertion the whole thing exists for. Three posts planned, the flag
   * set once the first is written — so exactly one is written and the other
   * two are not. */
  given({ slots: 3, cancelAfter: 1 });

  const out = await run();

  assert.strictEqual(out.result.written.length, 1,
    `wrote ${out.result.written.length} posts after being told to stop`);
  assert.strictEqual(out.result.stoppedForPause, true);
});

await atest('ONLY WHAT WAS WRITTEN IS CHARGED', async () => {
  /* The money, stated separately from the count, because they are two
   * different promises and a batch could plausibly get one right and the
   * other wrong — charging up front for twelve and refunding is exactly the
   * design this file's header says was rejected. */
  given({ slots: 11, cancelAfter: 2 });

  const out = await run();

  assert.strictEqual(out.result.written.length, 2);
  assert.strictEqual(out.creditsCharged, 150, `charged ${out.creditsCharged}, not 2 × 75`);
});

await atest('UNWRITTEN SLOTS STAY PENDING, SO A RESUME CAN FINISH THEM', async () => {
  /* A cancelled batch is paused, not abandoned. Anything marked failed would
   * need reopening by hand before it could ever be written. */
  given({ slots: 4, cancelAfter: 1 });

  await run();

  const left = db.campaign.slots.filter(s => s.status === 'pending');
  assert.strictEqual(left.length, 3);
  assert.strictEqual(db.campaign.slots.filter(s => s.status === 'failed').length, 0,
    'stopping marked slots failed — a resume would skip them');
});

await atest('THE CAMPAIGN IS LEFT PAUSED, NOT ACTIVE AND NOT DRAFT', async () => {
  /* 'active' is a lie the report repeats — the campaign is not running.
   * 'draft' is worse: it means "nothing has happened yet", and it would hide
   * however many posts this batch did write and charge for. */
  given({ slots: 3, cancelAfter: 1 });

  await run();

  assert.strictEqual(db.campaign.status, 'paused', `left it ${db.campaign.status}`);
});

await atest('THE FLAG IS CLEARED WHEN THE BATCH ENDS', async () => {
  /* A flag left set cancels the NEXT batch instantly: the campaign would
   * resume, stop before writing anything, and look as though it had failed
   * for no reason anybody could see. */
  given({ slots: 3, cancelAfter: 1 });

  await run();

  assert.strictEqual(db.campaign.batch.cancelRequested, false,
    'the cancel survived the batch — the next run dies on arrival');
  assert.ok(db.campaign.batch.cancelledAt, 'nothing recorded that it was cancelled');
});

await atest('IT IS ALSO CLEARED AS A BATCH STARTS', async () => {
  /* Belt and braces, and not redundant: a worker killed between the loop and
   * the finish leaves the flag behind, and the clear at the end never runs.
   * The clear at the START is what makes a stuck flag self-healing. */
  given({ slots: 2 });
  db.campaign.batch.cancelRequested = true;   // left over from a dead run

  const out = await run();

  assert.strictEqual(out.result.written.length, 2,
    'a stale cancel flag stopped a batch nobody asked to stop');
});

await atest('A PAUSE BEFORE THE FIRST POST IS NOT A FAILURE', async () => {
  /* Pressing Pause quickly enough writes nothing — exactly what was asked
   * for. Without the guard this throws, the job is marked failed, and the
   * owner gets an error about posts that "could not be written". Nothing
   * went wrong; they stopped it. */
  given({ slots: 3 });
  db.campaign.batch.cancelRequested = true;

  // Flag re-set immediately after the start-of-batch clear, which is what a
  // cancel arriving in that window looks like.
  const first = FakeCampaign.updateOne;
  FakeCampaign.updateOne = async (where, update) => {
    await first(where, update);
    if (update.$set && 'writing' === update.$set.status) {
      db.campaign.batch.cancelRequested = true;
    }
  };

  try {
    const out = await run();
    assert.strictEqual(out.result.written.length, 0);
    assert.strictEqual(out.result.stoppedForPause, true);
    assert.strictEqual(db.campaign.status, 'paused');
  } finally {
    FakeCampaign.updateOne = first;
  }
});

await atest('AN UNCANCELLED BATCH IS COMPLETELY UNCHANGED', async () => {
  /* The opposite failure, and the one that would be silent in a different
   * way: a check that is always true stops every batch after one post, and
   * every campaign on the system quietly writes a single article. */
  given({ slots: 5 });

  const out = await run();

  assert.strictEqual(out.result.written.length, 5);
  assert.strictEqual(out.result.stoppedForPause, false);
  assert.strictEqual(out.creditsCharged, 375);
  assert.strictEqual(db.campaign.status, 'active');
  assert.ok(!db.campaign.batch.cancelledAt, 'an ordinary batch was recorded as cancelled');
});

await atest('the cancel is read fresh, not from the campaign loaded at the start', async () => {
  /* THE MISTAKE THIS FILE IS MOST LIKELY TO MAKE.
   *
   * `campaign` is loaded once, before the first post. Reading
   * campaign.batch.cancelRequested off it is a snapshot taken minutes before
   * anybody could have pressed Pause — a check that compiles, runs, and can
   * never be true.
   *
   * The same mistake already cost this file a worse bug: the finish tested
   * the stale in-memory slots, decided nothing had been written, and set the
   * campaign back to 'draft' immediately after charging for every post.
   *
   * Proved by never touching the object the loop started with: the flag is
   * set ONLY on the copy findById() hands out. */
  given({ slots: 4 });

  const loaded = db.campaign;
  let seen = 0;

  const real = FakeCampaign.findById;
  FakeCampaign.findById = id => {
    const chain = real(id);
    const lean = chain.lean;
    chain.lean = async () => {
      const row = await lean();
      // After the first post, every FRESH read says cancelled — while the
      // object the loop holds says nothing of the sort.
      if (db.written.length >= 1) {
        seen++;
        row.batch = { ...(row.batch || {}), cancelRequested: true };
      }
      return row;
    };
    return chain;
  };

  try {
    const out = await run();

    assert.ok(seen > 0, 'the loop never re-read the campaign at all');
    assert.strictEqual(loaded.batch.cancelRequested, false,
      'the fixture is wrong — the in-memory object was mutated, so this proves nothing');
    assert.strictEqual(out.result.written.length, 1,
      'the loop is reading a stale snapshot and cannot ever see a cancel');
  } finally {
    FakeCampaign.findById = real;
  }
});

await atest('a failed post still counts as progress, cancelled or not', async () => {
  /* Guarding the paths beside the new one. A failure is not a cancel and
   * must not become one: the batch carries on, because one bad topic must
   * not take the other ten with it. */
  given({ slots: 4, writeFails: [1] });

  const out = await run();

  assert.deepStrictEqual(out.result.failed, [1]);
  assert.strictEqual(out.result.written.length, 3, 'one failure stopped the batch');
  assert.strictEqual(out.result.stoppedForPause, false);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

})();
