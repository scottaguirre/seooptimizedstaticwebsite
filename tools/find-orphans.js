#!/usr/bin/env node
/**
 * tools/find-orphans.js
 *
 * Finds JavaScript files nothing can reach, so you can delete them safely.
 *
 * How it works:
 *   1. Starts at server.js and follows every relative require() it finds,
 *      recursively. Anything reached this way is live server code.
 *   2. Separately scans your HTML for <script src="..."> so browser-side
 *      files under public/ aren't wrongly reported (they are never required).
 *   3. Anything else is an orphan.
 *
 * Usage:
 *   node tools/find-orphans.js            # report only (safe, default)
 *   node tools/find-orphans.js --delete   # move orphans to .orphans-backup/
 *   node tools/find-orphans.js --delete --hard   # actually delete them
 *
 * --delete moves rather than removes by default, so you can put anything back.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ARGS = process.argv.slice(2);
const DO_DELETE = ARGS.includes('--delete');
const HARD = ARGS.includes('--hard');
const BACKUP_DIR = path.join(ROOT, '.orphans-backup');

// Directories never scanned
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'builds', '.orphans-backup',
  'logs', 'uploads', 'coverage',
]);

// Entry points: files that run even though nothing requires them
const ENTRY_POINTS = [
  'server.js',
  'webpack.config.js',
];


function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);

    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, out);
    } else if (e.isFile()) {
      out.push(full);
    }
  }
  return out;
}


/** Resolve a relative require target to a real file. */
function resolveRequire(fromFile, spec) {
  if (!spec.startsWith('.')) return null; // package, not ours

  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base,
    base + '.js',
    base + '.json',
    path.join(base, 'index.js'),
  ];

  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch { /* keep trying */ }
  }
  return null;
}


/** Every relative require()/import in a file. */
function findRequires(file) {
  let src;
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }

  const specs = [];
  const patterns = [
    /require\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
    /import\s+[^'"`]*from\s*['"`]([^'"`]+)['"`]/g,
    /import\s*['"`]([^'"`]+)['"`]/g,
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(src)) !== null) {
      specs.push(m[1]);
    }
  }

  return specs;
}


/** Walk the require graph from the entry points. */
function reachableFromServer() {
  const seen = new Set();
  const queue = [];

  for (const entry of ENTRY_POINTS) {
    const full = path.join(ROOT, entry);
    if (fs.existsSync(full)) {
      queue.push(full);
      seen.add(full);
    }
  }

  while (queue.length) {
    const file = queue.shift();
    for (const spec of findRequires(file)) {
      const target = resolveRequire(file, spec);
      if (target && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }

  return seen;
}


/** Files referenced by <script src="..."> in any HTML. */
function reachableFromHtml(allFiles) {
  const referenced = new Set();
  const htmlFiles = allFiles.filter(f => f.endsWith('.html'));

  const byBasename = new Map();
  for (const f of allFiles) {
    if (!f.endsWith('.js')) continue;
    const b = path.basename(f);
    if (!byBasename.has(b)) byBasename.set(b, []);
    byBasename.get(b).push(f);
  }

  for (const html of htmlFiles) {
    let src;
    try {
      src = fs.readFileSync(html, 'utf8');
    } catch {
      continue;
    }

    const re = /<script[^>]+src=["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(src)) !== null) {
      const ref = m[1];
      if (/^https?:\/\//i.test(ref)) continue; // CDN
      const base = path.basename(ref);
      for (const cand of byBasename.get(base) || []) {
        referenced.add(cand);
      }
    }
  }

  return referenced;
}


function relative(f) {
  return path.relative(ROOT, f).split(path.sep).join('/');
}


function main() {
  const allFiles = walk(ROOT);
  const allJs = allFiles.filter(f => f.endsWith('.js') && !f.includes(`${path.sep}tools${path.sep}`));

  const live = reachableFromServer();
  const browser = reachableFromHtml(allFiles);

  const orphans = allJs.filter(f => !live.has(f) && !browser.has(f));
  const empty = allJs.filter(f => {
    try { return fs.statSync(f).size === 0; } catch { return false; }
  });

  console.log(`\nScanned ${allJs.length} JavaScript files under ${ROOT}\n`);
  console.log(`  reachable from server.js : ${[...live].filter(f => f.endsWith('.js')).length}`);
  console.log(`  referenced by HTML       : ${browser.size}`);
  console.log(`  orphaned                 : ${orphans.length}\n`);

  if (!orphans.length) {
    console.log('No orphans. Nothing to do.\n');
    return;
  }

  // Group by folder so the output is readable
  const byDir = new Map();
  for (const f of orphans.sort()) {
    const d = path.dirname(relative(f)) || '.';
    if (!byDir.has(d)) byDir.set(d, []);
    byDir.get(d).push(path.basename(f));
  }

  console.log('ORPHANED FILES\n');
  for (const [dir, files] of [...byDir].sort()) {
    console.log(`  ${dir}/`);
    for (const f of files) {
      const full = path.join(ROOT, dir, f);
      const note = empty.includes(full) ? '  (empty file)' : '';
      console.log(`      ${f}${note}`);
    }
    console.log('');
  }

  if (!DO_DELETE) {
    console.log('Report only. Re-run with --delete to move these to .orphans-backup/\n');
    return;
  }

  let moved = 0;
  for (const f of orphans) {
    const rel = relative(f);
    try {
      if (HARD) {
        fs.unlinkSync(f);
      } else {
        const dest = path.join(BACKUP_DIR, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.renameSync(f, dest);
      }
      moved++;
    } catch (err) {
      console.error(`  could not remove ${rel}: ${err.message}`);
    }
  }

  console.log(HARD
    ? `Deleted ${moved} file(s).\n`
    : `Moved ${moved} file(s) to .orphans-backup/ — delete that folder once you're happy.\n`);
}

main();