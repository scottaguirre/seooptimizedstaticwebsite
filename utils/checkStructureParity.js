// utils/checkStructureParity.js
//
// WHY THIS EXISTS
//
// The generator makes two passes over the same data. Pass one fills the HTML
// templates and writes the downloadable site. Pass two builds content.json,
// which is the ONLY thing the WordPress exporter reads. Neither pass is
// derived from the other, so they can drift apart — and every time they have,
// the symptom was the same: "the WordPress site looks different from the
// static site."
//
// Every one of those bugs was invisible at build time and obvious on a
// rendered page. This makes them visible at build time instead.
//
// WHAT IT COMPARES
//
// The static page is the ground truth: it is what the customer downloads.
// content.json says what WordPress will build. So for every section the model
// declares, this asks whether the static page agrees:
//
//   css_class     the section's wrapper class exists, exactly once
//   row_class     the images row inside it carries that class — and the
//                 static page is not carrying one the model never declared
//   media_layout  'side' means text and media side by side (col-md-7 /
//                 col-md-5); anything else means the stacked layout
//   nest_in       the child really is inside the parent's container in the
//                 static page — and a child WITHOUT nest_in really is not
//   order         sections appear in the same order on both sides
//
// WHAT IT DOES NOT COMPARE
//
// Text, images, and anything whose static markup this cannot locate. A
// section with no css_class and no entry in LOCATORS is reported as
// unchecked, by name, in the summary. Unchecked is not the same as passing
// and the output never says otherwise.
//
// No dependencies, no PHP, no headless browser.
//
// USE
//   const { checkSite } = require('./checkStructureParity');
//   const report = checkSite(distDir);
//   if (!report.ok) console.warn(report.text);
//
// or from a shell:
//   node utils/checkStructureParity.js path/to/dist

const fs = require('fs');
const path = require('path');

/* -------------------------------------------------------------------------
 * A very small HTML reader
 * -------------------------------------------------------------------------
 * Not a spec-compliant parser and does not try to be. It needs to answer two
 * questions about generated markup: which elements carry a class, and which
 * element contains which. That needs a tree, which is why this is here rather
 * than a pile of regexes — "is the cards row inside section-3's container?"
 * is a containment question, and a regex cannot answer it without assuming
 * the markup never nests, which is exactly the assumption that produced the
 * bug this file exists to catch.
 * ---------------------------------------------------------------------- */

// Elements that never have a closing tag. An unlisted element that self-closes
// is handled separately, by the `/>` check in the tokeniser.
const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// Elements whose contents are text, not markup. A '<' inside them is data.
const RAW_TEXT = new Set(['script', 'style']);

function parseHtml(html) {
  const root = { tag: '#root', classes: [], children: [], parent: null, start: 0, end: html.length };
  const stack = [root];
  let i = 0;

  const top = () => stack[stack.length - 1];

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;

    // Comments and doctype carry no structure.
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt);
      i = close === -1 ? html.length : close + 3;
      continue;
    }
    if (html.startsWith('<!', lt)) {
      const close = html.indexOf('>', lt);
      i = close === -1 ? html.length : close + 1;
      continue;
    }

    const gt = html.indexOf('>', lt);
    if (gt === -1) break;

    const rawTag = html.slice(lt + 1, gt);

    // Closing tag.
    if (rawTag[0] === '/') {
      const name = rawTag.slice(1).trim().toLowerCase();
      // Walk back to the matching open. An unmatched closing tag is ignored
      // rather than allowed to unwind the whole stack.
      for (let d = stack.length - 1; d > 0; d--) {
        if (stack[d].tag === name) {
          stack[d].end = gt + 1;
          stack.length = d;
          break;
        }
      }
      i = gt + 1;
      continue;
    }

    const selfClosing = rawTag.trimEnd().endsWith('/');
    const nameMatch = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(rawTag);
    if (!nameMatch) { i = gt + 1; continue; }

    const tag = nameMatch[1].toLowerCase();
    const attrs = rawTag.slice(nameMatch[1].length);
    const classMatch = /\sclass\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
    const classText = classMatch ? (classMatch[2] !== undefined ? classMatch[2] : classMatch[3]) : '';

    const node = {
      tag,
      classes: classText.split(/\s+/).filter(Boolean),
      children: [],
      parent: top(),
      start: lt,
      end: gt + 1,
    };
    top().children.push(node);

    if (RAW_TEXT.has(tag) && !selfClosing) {
      const closeTag = `</${tag}`;
      const close = html.toLowerCase().indexOf(closeTag, gt);
      node.end = close === -1 ? html.length : html.indexOf('>', close) + 1;
      i = node.end;
      continue;
    }

    if (!VOID.has(tag) && !selfClosing) stack.push(node);
    i = gt + 1;
  }

  return root;
}

function walk(node, visit) {
  for (const child of node.children) {
    visit(child);
    walk(child, visit);
  }
}

function findAll(root, predicate) {
  const found = [];
  walk(root, n => { if (predicate(n)) found.push(n); });
  return found;
}

const hasClass = (node, name) => node.classes.includes(name);

function isDescendantOf(node, ancestor) {
  for (let p = node.parent; p; p = p.parent) {
    if (p === ancestor) return true;
  }
  return false;
}

/* -------------------------------------------------------------------------
 * Locating a model section in the static page
 * ---------------------------------------------------------------------- */

// Section types whose static markup is not found by css_class. Each returns
// the elements that represent the section, given the parsed page.
//
// Keep this honest: only add a type once you have confirmed the class in the
// template or builder that emits it. A wrong locator here reports a false
// failure, which is worse than reporting the section as unchecked.
const LOCATORS = {
  'service-cards': root => findAll(root, n => hasClass(n, 'service-cards')),
};

function locate(section, root) {
  if (LOCATORS[section.type]) return LOCATORS[section.type](root);
  if (section.css_class) return findAll(root, n => hasClass(n, section.css_class));
  return null; // not locatable — reported as unchecked, never as a pass
}

/* -------------------------------------------------------------------------
 * The checks
 * ---------------------------------------------------------------------- */

// Row classes the templates use on a two-image row. Used to spot the case
// where the static page carries one and the model declares a different one,
// or none at all.
const ROW_CLASS_PATTERN = /^row-(first|second)-section-2-img$/;

function checkPage(page, html) {
  const root = parseHtml(html);
  const problems = [];
  const unchecked = [];
  const located = new Map(); // section key -> element

  const where = section => `${page.htmlFile || page.slug} / ${section.key}`;

  // --- locate every section first; order and nesting both need the results
  for (const section of page.sections || []) {
    const matches = locate(section, root);

    if (matches === null) {
      unchecked.push(`${where(section)} (${section.type})`);
      continue;
    }

    if (matches.length === 0) {
      problems.push({
        where: where(section),
        what: 'section is in content.json but not in the static page',
        model: section.css_class ? `.${section.css_class}` : section.type,
        static: 'not found',
      });
      continue;
    }

    if (matches.length > 1) {
      problems.push({
        where: where(section),
        what: 'more than one element matches, so the check cannot tell which is the section',
        model: section.css_class ? `.${section.css_class}` : section.type,
        static: `${matches.length} matches`,
      });
      continue;
    }

    located.set(section.key, matches[0]);
  }

  // --- order
  const ordered = (page.sections || [])
    .filter(s => located.has(s.key))
    // A nested section sits inside its parent, so it cannot be compared in
    // the same sequence as its siblings. Nesting is checked separately.
    .filter(s => !s.nest_in);

  for (let i = 1; i < ordered.length; i++) {
    const prev = located.get(ordered[i - 1].key);
    const curr = located.get(ordered[i].key);
    if (curr.start < prev.start) {
      problems.push({
        where: `${page.htmlFile || page.slug} / ${ordered[i].key}`,
        what: 'section order differs',
        model: `after ${ordered[i - 1].key}`,
        static: `before ${ordered[i - 1].key}`,
      });
    }
  }

  // --- per-section presentation
  for (const section of page.sections || []) {
    const el = located.get(section.key);
    if (!el) continue;

    // row_class, both directions.
    const rows = findAll(el, n => n.classes.some(c => ROW_CLASS_PATTERN.test(c)));
    const staticRowClasses = [...new Set(
      rows.flatMap(n => n.classes.filter(c => ROW_CLASS_PATTERN.test(c)))
    )];

    if (section.row_class && !staticRowClasses.includes(section.row_class)) {
      problems.push({
        where: where(section),
        what: 'images row class differs',
        model: section.row_class,
        static: staticRowClasses.length ? staticRowClasses.join(', ') : 'no row class',
      });
    } else if (!section.row_class && staticRowClasses.length) {
      // The model says nothing, so the exporter falls back to its table —
      // which is how section-3 on the About page came out as
      // row-first-section-2-img. Silence in the model is not agreement.
      problems.push({
        where: where(section),
        what: 'the static page sets a row class the model does not declare, so WordPress will guess',
        model: 'not declared',
        static: staticRowClasses.join(', '),
      });
    }

    // media_layout.
    if (section.type === 'text-images') {
      const sideBySide =
        findAll(el, n => hasClass(n, 'col-md-7')).length > 0 &&
        findAll(el, n => hasClass(n, 'col-md-5')).length > 0;
      const declaredSide = section.media_layout === 'side';

      if (sideBySide !== declaredSide) {
        problems.push({
          where: where(section),
          what: 'media layout differs',
          model: declaredSide ? 'side by side' : 'stacked',
          static: sideBySide ? 'side by side' : 'stacked',
        });
      }
    }

    // nest_in, both directions.
    const parentEl = section.nest_in ? located.get(section.nest_in) : null;

    if (section.nest_in) {
      if (!parentEl) {
        problems.push({
          where: where(section),
          what: `nests in "${section.nest_in}", which is not on this page`,
          model: `inside ${section.nest_in}`,
          static: 'parent not found',
        });
      } else if (!isDescendantOf(el, parentEl)) {
        problems.push({
          where: where(section),
          what: 'model nests this section, the static page does not',
          model: `inside ${section.nest_in}`,
          static: 'not inside it',
        });
      }
    } else {
      // The reverse of the service-cards bug: the static page nests it and
      // the model does not, so WordPress emits it as a loose sibling.
      const enclosing = (page.sections || []).find(other => {
        if (other.key === section.key) return false;
        const otherEl = located.get(other.key);
        return otherEl && isDescendantOf(el, otherEl);
      });

      if (enclosing) {
        problems.push({
          where: where(section),
          what: 'the static page nests this section, the model does not',
          model: 'top level',
          static: `inside ${enclosing.key}`,
        });
      }
    }
  }

  return { problems, unchecked };
}

/* -------------------------------------------------------------------------
 * Running it over a generated site
 * ---------------------------------------------------------------------- */

/**
 * @param {string} distDir  the generated site folder — the one holding
 *                          index.html and _src/content.json
 */
function checkSite(distDir) {
  const modelPath = path.join(distDir, '_src', 'content.json');

  if (!fs.existsSync(modelPath)) {
    return {
      ok: true,
      skipped: true,
      problems: [],
      unchecked: [],
      text: `structure check skipped — no ${modelPath}`,
    };
  }

  let model;
  try {
    model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
  } catch (err) {
    return {
      ok: false,
      skipped: false,
      problems: [{ where: 'content.json', what: `could not be read: ${err.message}`, model: '', static: '' }],
      unchecked: [],
      text: `structure check failed — content.json could not be read: ${err.message}`,
    };
  }

  const problems = [];
  const unchecked = [];
  let pagesChecked = 0;

  for (const page of model.pages || []) {
    const file = page.htmlFile || (page.slug ? `${page.slug}.html` : null);
    if (!file) continue;

    const full = path.join(distDir, file);
    if (!fs.existsSync(full)) {
      problems.push({
        where: file,
        what: 'content.json lists this page but the static site has no such file',
        model: file,
        static: 'missing',
      });
      continue;
    }

    const result = checkPage(page, fs.readFileSync(full, 'utf8'));
    problems.push(...result.problems);
    unchecked.push(...result.unchecked);
    pagesChecked++;
  }

  return {
    ok: problems.length === 0,
    skipped: false,
    pagesChecked,
    problems,
    unchecked,
    text: formatReport({ pagesChecked, problems, unchecked }),
  };
}

function formatReport({ pagesChecked, problems, unchecked }) {
  const lines = [];

  if (problems.length === 0) {
    lines.push(`✅ structure check: ${pagesChecked} page${pagesChecked === 1 ? '' : 's'}, static site and content.json agree`);
  } else {
    lines.push(`❌ structure check: ${problems.length} difference${problems.length === 1 ? '' : 's'} between the static site and content.json`);
    lines.push('   (the WordPress export is built from content.json, so these are what will look wrong)');
    lines.push('');
    for (const p of problems) {
      lines.push(`   ${p.where}`);
      lines.push(`      ${p.what}`);
      if (p.model || p.static) {
        lines.push(`      content.json says: ${p.model}`);
        lines.push(`      static page has:   ${p.static}`);
      }
      lines.push('');
    }
  }

  if (unchecked.length) {
    lines.push(`   not checked (no way to locate these in the static page): ${unchecked.length}`);
    for (const u of unchecked) lines.push(`      ${u}`);
  }

  return lines.join('\n');
}

module.exports = { checkSite, checkPage, parseHtml, findAll, hasClass, isDescendantOf };

/* -------------------------------------------------------------------------
 * CLI
 * ---------------------------------------------------------------------- */

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node utils/checkStructureParity.js <generated-site-folder>');
    process.exit(2);
  }
  const report = checkSite(dir);
  console.log(report.text);
  process.exit(report.ok ? 0 : 1);
}