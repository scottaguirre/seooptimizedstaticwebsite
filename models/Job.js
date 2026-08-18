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

// The runner's main query: oldest queued job first.
jobSchema.index({ status: 1, createdAt: 1 });

// "What is this user's latest job" — for the progress page.
jobSchema.index({ user: 1, createdAt: -1 });

/** Seconds since the last heartbeat, or null when never started. */
jobSchema.methods.secondsSinceHeartbeat = function () {
  if (!this.heartbeatAt) return null;
  return Math.round((Date.now() - this.heartbeatAt.getTime()) / 1000);
};

module.exports = mongoose.model('Job', jobSchema);