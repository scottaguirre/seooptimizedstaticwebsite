// utils/cleanupScheduler.js
//
// Generated sites are build artifacts, not user data. Keeping every site
// from every user forever will fill the disk, so anything older than the
// TTL is deleted.
//
// Policy: if a user's build has expired, they generate again and spend
// credits again. Nothing is rebuilt automatically.
//
// Expiry is driven by the filesystem (mtime), not by an in-memory Map,
// so it survives a server restart.
//
// IT NEVER RAN FOR THE FIRST SIX MONTHS OF ITS LIFE — 16 October 2026
//
// This file was written, exported startCleanupScheduler(), and NOTHING IN
// THE APP EVER CALLED IT. The only other mention in the tree was a comment in
// routes/downloadZipRoute.js. So no site was ever swept, and nobody noticed,
// because a sweeper that does nothing looks exactly like a sweeper with
// nothing to do.
//
// MEASURED BEFORE DECIDING, which turned the question around. On 16 October
// the whole of dist/ was 32 MB and builds/ was 41 MB — 73 MB against 33 GB
// free, about 0.2% of the disk. Six months of never running had cost
// nothing, because the folders grow with the CUSTOMER COUNT, not with the
// number of builds: runGeneration's resetUserDirs() wipes a customer's folder
// before each new build, so each one holds one site.
//
// WIRED UP ANYWAY, AT EDWIN'S CALL, AT 48 HOURS. Not for the disk — for the
// policy. His reasoning, 16 October: *"48 hours is enough time for a customer
// to download the site. If they have to spend more credits it's ok."*
//
// WHAT EXPIRY COSTS THE CUSTOMER, so the next person changing this number
// knows what they are trading:
//
//   - Download ZIP stops working. It serves builds/zips/user_<id>.zip.
//   - Convert to WordPress stops working. buildFromModel reads
//     dist/user_<id>/_src/content.json and throws without it.
//   - Preview 404s. express.static has nothing to serve.
//   - The dashboard card shows NOTHING, because getCurrentSite() counts the
//     .html files on disk and finds none. It does not say "expired" — it
//     looks like they never generated at all.
//
// 24 HOURS WAS THE OLD DEFAULT AND IS NOW WRONG. Someone who generates on a
// Friday evening and opens their laptop on Sunday would find it gone. 48 is
// the number that was chosen; the default below is what the server uses,
// because an env var nobody sets is a default nobody can see.

const fs = require('fs');
const path = require('path');

const { log } = require('./logger');
const { clearForUsers, usersFromSwept } = require('./jobPayloads');

const projectRoot = path.join(__dirname, '..');

const DIST_DIR = path.join(projectRoot, 'dist');
const WORK_DIR = path.join(projectRoot, 'builds', 'work');
const ZIP_DIR = path.join(projectRoot, 'builds', 'zips');

// How long a build survives after its last write. See the header for what
// expiring one costs the customer.
const TTL_MS = Number(process.env.BUILD_TTL_HOURS || 48) * 60 * 60 * 1000;

// How often to sweep.
const SWEEP_INTERVAL_MS = Number(process.env.BUILD_SWEEP_MINUTES || 60) * 60 * 1000;


/**
 * mtime of a folder only changes when its direct children change, so a
 * long build could look stale. Walk one level down and take the newest
 * timestamp we find.
 */
function newestMtime(targetPath) {
  let newest = 0;

  try {
    const stat = fs.statSync(targetPath);
    newest = stat.mtimeMs;

    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
        const child = path.join(targetPath, entry.name);
        try {
          const childStat = fs.statSync(child);
          if (childStat.mtimeMs > newest) newest = childStat.mtimeMs;
        } catch (_) { /* vanished mid-sweep; ignore */ }
      }
    }
  } catch (_) {
    return 0;
  }

  return newest;
}


function removePath(targetPath) {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
    return true;
  } catch (err) {
    console.error(`🧹 Failed to remove ${targetPath}:`, err.message);
    return false;
  }
}


/**
 * Delete entries in `dir` matching `pattern` whose newest mtime is older
 * than the TTL.
 */
/**
 * @returns {Array<string>} the names it removed, not a count.
 *
 * CHANGED FROM A COUNT so the payloads can follow the files. Job.payload is
 * the recipe for a particular site; once that site's folder is gone the
 * recipe describes nothing, and the only way to know whose payload to clear
 * is to know which `user_<id>` folders went. A number cannot say that.
 *
 * Callers that only wanted the count read .length.
 */
function sweepDir(dir, pattern, label) {
  if (!fs.existsSync(dir)) return [];

  const cutoff = Date.now() - TTL_MS;
  const removed = [];

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.error(`🧹 Could not read ${dir}:`, err.message);
    return [];
  }

  for (const entry of entries) {
    if (!pattern.test(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const mtime = newestMtime(fullPath);

    if (mtime && mtime < cutoff) {
      if (removePath(fullPath)) {
        removed.push(entry.name);
        console.log(`🧹 Removed expired ${label}: ${entry.name}`);
      }
    }
  }

  return removed;
}


/**
 * Run one sweep across all three artifact locations.
 * Exported so it can be triggered manually or from a test.
 */
async function runCleanup() {
  const started = Date.now();

  const sweptSites = sweepDir(DIST_DIR, /^user_/, 'site');
  const sweptWork = sweepDir(WORK_DIR, /^user_/, 'work folder');
  const sweptZips = sweepDir(ZIP_DIR, /^user_.*\.zip$/, 'zip');

  const sites = sweptSites.length;
  const work = sweptWork.length;
  const zips = sweptZips.length;

  const total = sites + work + zips;

  /* THE RECIPE GOES WITH THE CAKE.
   *
   * Job.payload is the whole wizard submission, kept because generation is a
   * background job that reads it later. Once a user's site folder has been
   * deleted it describes a website nobody can reach, and — since a swept
   * site is gone for good rather than rebuildable — nothing will ever read
   * it again.
   *
   * Only the DIST folders count as "the site went". A swept zip is a lost
   * download, and a swept work folder is build scratch; neither means the
   * site itself has gone, and clearing a payload on either would throw away
   * the form for a site still sitting on disk.
   *
   * Awaited rather than fired and forgotten, so a sweep's log line is the
   * whole truth about what that sweep did. */
  if (sweptSites.length) {
    await clearForUsers(usersFromSwept(sweptSites), { reason: 'site swept' });
  }

  /* LOGGED EVERY RUN, INCLUDING THE ZEROS, and that is the whole lesson of
   * this file's first six months. "0 removed" is the only thing that
   * distinguishes "nothing was due" from "it is not running at all", and from
   * outside the process those are identical. The old version only spoke when
   * it deleted something, which is why nobody could tell it had never spoken.
   *
   * Through the logger rather than console.log: this goes to app.log where it
   * can be grepped months later, not to stdout where pm2 rotates it away. */
  log.info('builds.swept', {
    sites,
    work,
    zips,
    total,
    ttlHours: Math.round(TTL_MS / 3600000),
    ms: Date.now() - started,
  });

  return { sites, work, zips };
}


/**
 * Start the periodic sweep. Call once from server.js.
 */
function startCleanupScheduler() {
  const ttlHours = (TTL_MS / 1000 / 60 / 60).toFixed(1);
  const everyMinutes = (SWEEP_INTERVAL_MS / 1000 / 60).toFixed(0);

  log.info('builds.cleanup.started', {
    ttlHours: Number(ttlHours),
    sweepMinutes: Number(everyMinutes),
  });

  console.log(`🧹 Build cleanup active: TTL ${ttlHours}h, sweeping every ${everyMinutes}m`);

  // Sweep once at boot to clear anything left behind by a crash or restart
  runCleanup();

  /* runCleanup is async now that it clears payloads. setInterval does not
   * await it, and must not: a sweep that hangs on Mongo should not stop the
   * next one being scheduled. Its own try/catch inside clearForUsers is what
   * keeps a rejection from escaping as an unhandled promise. */
  const timer = setInterval(() => { runCleanup(); }, SWEEP_INTERVAL_MS);

  // Don't hold the process open just for the sweeper
  if (typeof timer.unref === 'function') timer.unref();

  return timer;
}


module.exports = {
  runCleanup,
  startCleanupScheduler,
  TTL_MS,
};