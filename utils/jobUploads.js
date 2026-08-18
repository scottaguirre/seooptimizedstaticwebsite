// utils/jobUploads.js
//
// Uploaded files have to outlive the request.
//
// Multer writes uploads to public/uploads/ and the route deletes them in its
// `finally` when the response is sent. That was correct when generation
// happened inside the request — but a background job runs long after, and
// would find the logo already gone.
//
// So the files are MOVED to a per-job directory before the response returns,
// and cleaned up when the job finishes.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const JOB_UPLOADS_ROOT = path.join(__dirname, '..', 'builds', 'job-uploads');

/**
 * @param {Array} files      req.files from multer
 * @param {string} jobId
 * @returns {Promise<object>} field name -> absolute path
 *
 * Never throws: a missing logo is a cosmetic problem, not a reason to lose
 * the job the user just paid for.
 */
async function moveUploadsForJob(files = [], jobId) {
  const dir = path.join(JOB_UPLOADS_ROOT, String(jobId));
  const moved = {};

  if (!files.length) return moved;

  try {
    await fsp.mkdir(dir, { recursive: true });
  } catch (err) {
    console.warn('Could not create the job upload directory:', err.message);
    return moved;
  }

  for (const file of files) {
    try {
      const dest = path.join(dir, path.basename(file.path));

      // rename() is atomic on the same filesystem and avoids reading the
      // file into memory. It fails across devices, so fall back to a copy.
      try {
        await fsp.rename(file.path, dest);
      } catch (err) {
        if (err.code !== 'EXDEV') throw err;
        await fsp.copyFile(file.path, dest);
        await fsp.unlink(file.path).catch(() => {});
      }

      moved[file.fieldname] = dest;

    } catch (err) {
      console.warn(`Could not move upload ${file.originalname}:`, err.message);
    }
  }

  return moved;
}

/**
 * Rebuild something shaped like req.files from the stored paths, so the
 * generator does not need to know whether it is running in a request or a
 * job.
 */
function filesFromJob(uploads = {}) {
  return Object.entries(uploads)
    .filter(([, p]) => p && fs.existsSync(p))
    .map(([fieldname, p]) => ({
      fieldname,
      path: p,
      originalname: path.basename(p),
    }));
}

/** Remove a job's uploads once it has finished. */
async function cleanupJobUploads(jobId) {
  const dir = path.join(JOB_UPLOADS_ROOT, String(jobId));
  try {
    await fsp.rm(dir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`Could not clean job uploads for ${jobId}:`, err.message);
  }
}

module.exports = {
  moveUploadsForJob,
  filesFromJob,
  cleanupJobUploads,
  JOB_UPLOADS_ROOT,
};