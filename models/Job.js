// models/Job.js
//
// A generation job.
//
// Generation used to run inside the HTTP request. A one-page site took 59
// seconds; a hundred pages is closer to a hundred minutes. Browsers abandon
// a request after a few minutes and proxies usually cut it at 30-60 seconds,
// so large sites could not work at all — and a failure at page 73 threw away
// the 72 pages already written.
//
// The job record makes the work outlive the request: the route saves one and
// returns immediately, the runner picks it up, and progress is polled.
//
// It also survives a restart. `completedPages` records what has already been
// written, so a worker that dies mid-job resumes rather than starting over.

const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  status: {
    type: String,
    enum: ['queued', 'running', 'completed', 'failed', 'cancelled'],
    default: 'queued',
    index: true,
  },

  /**
   * What kind of work this is. Decides which generator the runner hands it to.
   *
   *   'site'  the wizard's full site build (the original, and the only one
   *           that existed when this model was written)
   *   'blog'  one Interlink Engine post
   *
   * Defaults to 'site' so every row written before this field existed keeps
   * running exactly as it did. Do NOT make this required: a migration that
   * missed a queued job would leave it unclaimable forever.
   */
  kind: {
    type: String,
    enum: ['site', 'blog'],
    default: 'site',
    index: true,
  },

  siteMode: { type: String, enum: ['lead', 'sample'], default: 'lead' },

  // Everything the generator needs, captured at enqueue time.
  //
  // Mixed because the wizard's shape changes as features are added, and a
  // strict schema here would mean a migration every time. The route has
  // already validated it before this point.
  payload: { type: mongoose.Schema.Types.Mixed, required: true },

  // Uploaded logo and favicon, MOVED out of multer's temp directory before
  // the request ends. Multer cleans those up when the response is sent, so
  // a job running afterwards would find nothing there.
  // Keyed by MULTER FIELDNAME, e.g. 'global[logo]' — not by a friendly name.
  //
  // Mixed rather than a declared shape: Mongoose silently drops keys that a
  // strict sub-schema does not list, so declaring { logo, favicon } stored
  // nothing at all and every job failed with "The logo could not be
  // processed". The generator matches these names with a regex, so they have
  // to survive exactly as multer produced them.
  uploads: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },

  progress: {
    total: { type: Number, default: 0 },
    done: { type: Number, default: 0 },
    // What is happening right now, e.g. "Water Heater Repair"
    current: { type: String, default: '' },
    stage: { type: String, default: 'queued' },
  },

  // Pages already written. On resume the runner skips these rather than
  // regenerating them — which would waste both time and API spend.
  completedPages: [{ type: String }],

  // Pages that could not be generated. The job still completes; the user
  // gets a shorter site and a clear list of what is missing.
  skippedPages: [{
    page: String,
    reason: String,
  }],

  creditsCharged: { type: Number, default: 0 },

  /**
   * What the job produced, for kinds whose output is data rather than files.
   *
   * A site build writes HTML to disk and has nothing to put here. A blog post
   * IS the result, and it has to survive the request that asked for it: the
   * WordPress plugin polls, takes the post, publishes it, and confirms. If
   * publishing fails and it polls again, it must get back the SAME post —
   * regenerating would mean a second OpenAI call and a second charge for one
   * slot the customer already paid for.
   */
  result: { type: mongoose.Schema.Types.Mixed },

  error: {
    message: String,
    stack: String,
  },

  // Updated while the job runs. A record whose heartbeat has gone stale was
  // interrupted by a crash or a deploy, and can be requeued — without this a
  // killed worker leaves jobs marked 'running' forever.
  heartbeatAt: { type: Date },

  startedAt: { type: Date },
  finishedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
});

// The runner's main query: oldest queued job first, of a kind it can run.
jobSchema.index({ status: 1, kind: 1, createdAt: 1 });

// "What is this user's latest job" — for the progress page.
jobSchema.index({ user: 1, createdAt: -1 });

/** Seconds since the last heartbeat, or null when never started. */
jobSchema.methods.secondsSinceHeartbeat = function () {
  if (!this.heartbeatAt) return null;
  return Math.round((Date.now() - this.heartbeatAt.getTime()) / 1000);
};

module.exports = mongoose.model('Job', jobSchema);