// utils/checkPlaceholders.js
//
// Did the build finish substituting?
//
//   const { checkPlaceholders } = require('./checkPlaceholders');
//   const result = checkPlaceholders(distDir);
//
// WHY THIS EXISTS. On 4 November a generated site went out with
//
//     Address: {{ADDRESS_FULL}}
//
// printed across the hero bar, in the place a customer's street address goes.
// The build reported success. Every suite was green. The page was served and
// looked finished until somebody read it.
//
// The cause was ordinary and will recur in a different costume: the templates
// are read from disk on every build, but the builders are `require`d once
// when the server starts. A running server therefore picks up a NEW template
// and an OLD builder, and a placeholder the old builder has never heard of
// travels straight through to the page.
//
//     A PLACEHOLDER THAT REACHES THE PAGE IS NOT AN ERROR. IT IS A STRING
//     THAT RENDERS. Nothing throws, nothing logs, and the only check that
//     ever runs is somebody's eyes.
//
// So this is the check: after the site is written, read it back and look for
// anything still wearing {{BRACES}}.
//
//
// WHAT IT LOOKS AT, AND THE TWO FALSE POSITIVES THAT DECIDED THAT
//
// .html and .css, and nothing else. Both were established by scanning a real
// build rather than by reasoning about it:
//
//   assets/logo.png, assets/hero-1.webp — contain the bytes "{{" by pure
//       coincidence. Binary files are not searched.
//
//   css/index.css — contains {{LOGO_WIDTH}} and {{LOGO_HEIGHT}} inside a
//       COMMENT in style7.css, where the comment is explaining what the
//       template writes. Documentation quoting a placeholder is not a
//       placeholder, so comments are stripped before the scan.
//
// Stripping comments means a leftover inside one goes unreported. That is the
// right trade: nobody reads it, the browser does not render it, and the
// alternative is a guard that fires on its own documentation and gets turned
// off within a week.

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * UPPER CASE ONLY, and that is deliberate.
 *
 * Every placeholder this app writes is {{SHOUTED_WITH_UNDERSCORES}} —
 * {{BUSINESS_NAME}}, {{ADDRESS_FULL}}, {{SECTION2_P1}}. Matching any {{...}}
 * would also match a customer who typed a brace into their business name and
 * a hand-written template in somebody's pasted content. The shape of this
 * app's own placeholders is the narrowest thing that still catches all of
 * them.
 */
const PLACEHOLDER = /\{\{\s*([A-Z][A-Z0-9_]*)\s*\}\}/g;

/** Only text the browser renders. See the note above. */
const SCANNED = new Set(['.html', '.css']);

const STRIP = {
  '.html': /<!--[\s\S]*?-->/g,
  '.css': /\/\*[\s\S]*?\*\//g,
};

function filesUnder(dir) {
  const out = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      out.push(...filesUnder(full));
    } else if (SCANNED.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }

  return out;
}

/**
 * BLANKED, NOT DELETED, so the line numbers in the report still match the
 * file on disk. Removing the comments outright shifts every line after them
 * and sends whoever is debugging to the wrong place.
 */
function withoutComments(text, ext) {
  const re = STRIP[ext];
  if (!re) return text;

  return text.replace(re, block => block.replace(/[^\n]/g, ' '));
}

/**
 * @param {string} distDir  the folder the finished site was written to
 * @returns {{ok: boolean, problems: Array, text: string, filesScanned: number}}
 *
 * Never throws for an ordinary reason — a missing folder comes back as
 * `ok: true` with nothing scanned, because this is a check on a build, not a
 * second opinion about whether the build happened.
 */
function checkPlaceholders(distDir) {
  if (!distDir || !fs.existsSync(distDir)) {
    return { ok: true, problems: [], filesScanned: 0, text: '' };
  }

  const problems = [];
  const files = filesUnder(distDir);

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const raw = fs.readFileSync(file, 'utf8');
    const text = withoutComments(raw, ext);

    PLACEHOLDER.lastIndex = 0;

    let m;
    while ((m = PLACEHOLDER.exec(text))) {
      const before = text.slice(0, m.index);
      const line = before.split('\n').length;
      const lineStart = before.lastIndexOf('\n') + 1;

      problems.push({
        file: path.relative(distDir, file),
        name: m[1],
        line,
        // The line it sits on, trimmed — enough to recognise the section
        // without printing a whole minified stylesheet into the log.
        excerpt: raw.split('\n')[line - 1].trim().slice(0, 120),
      });
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    filesScanned: files.length,
    text: report(problems, files.length),
  };
}

function report(problems, filesScanned) {
  if (!problems.length) {
    return `   placeholder check: ${filesScanned} file(s), none left unfilled`;
  }

  const names = [...new Set(problems.map(p => p.name))];

  const lines = [
    '',
    `  ${problems.length} unfilled placeholder(s) in the finished site:`,
    '',
  ];

  // Grouped by file: one page usually carries several, and a list of twelve
  // identical-looking lines hides which page is actually broken.
  const byFile = new Map();
  for (const p of problems) {
    if (!byFile.has(p.file)) byFile.set(p.file, []);
    byFile.get(p.file).push(p);
  }

  for (const [file, found] of byFile) {
    lines.push(`  ${file}`);
    for (const p of found.slice(0, 6)) {
      lines.push(`      line ${p.line}  {{${p.name}}}`);
      lines.push(`      ${p.excerpt}`);
    }
    if (found.length > 6) lines.push(`      ... and ${found.length - 6} more`);
    lines.push('');
  }

  lines.push(`  Missing: ${names.map(n => `{{${n}}}`).join(', ')}`);
  lines.push('');
  lines.push('  A builder is not replacing these. The usual cause is a server');
  lines.push('  still running the code it loaded at startup: templates are read');
  lines.push('  from disk every build, but utils/*.js is require()d once.');
  lines.push('  Restart it before looking anywhere else.');
  lines.push('');

  return lines.join('\n');
}

module.exports = { checkPlaceholders, PLACEHOLDER, SCANNED };
