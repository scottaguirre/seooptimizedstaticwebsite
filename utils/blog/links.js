// blog-engine-preview/links.js
//
// Turning the writer's output into real links, and switching on the pending
// ones later.
//
// THE CONTRACT WITH THE WRITER
//
// Asking a model to "insert a link naturally" and then trying to find where it
// put it is a losing game. Instead the writer is given the exact anchor phrase
// and must wrap it in a token:
//
//     ...before you book a {{money}}water heater repair in Leander{{/money}}.
//
// Tokens are trivially findable, so we can verify every required link is
// present and refuse the post if one is missing — rather than publishing a
// post that quietly forgot to link to the money page.
//
// PENDING LINKS
//
// A forward link cannot be a real <a> yet: its target does not exist for
// weeks, and a link to a page that 404s is worse than no link. So it becomes:
//
//     <span data-il-link="topic-3">tankless water heaters</span>
//
// which reads as ordinary prose. When topic-3 publishes, activate() swaps that
// span for an anchor. It only ever touches spans carrying that exact
// attribute, so an owner's own edits elsewhere in the post are untouchable —
// and if they deleted the span, the swap simply finds nothing.

const TOKEN_NAMES = ['money', 'prev', 'next'];

function escapeHtmlAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Does text at this offset begin a sentence?
 *
 * The writer is told to use the anchor phrase VERBATIM, and it obeys — which
 * means the phrase sometimes lands at the start of a sentence in lower case:
 *
 *   ...not fixed by repeatedly relighting it. a pilot light that will not
 *   stay lit can be caused by a weak flame-sensing part.
 *
 * Telling the model "do not start a sentence with it" is a rule it will
 * eventually forget on post 40. Capitalising here cannot be forgotten.
 */
function startsSentence(str, offset) {
  for (let i = offset - 1; i >= 0; i--) {
    const c = str[i];
    if (/\s/.test(c)) continue;
    return c === '.' || c === '!' || c === '?' || c === '>';
  }
  return true;   // start of the string
}

function capitaliseFirst(text) {
  return String(text).replace(/^(\s*)([a-z])/, (_m, space, ch) => space + ch.toUpperCase());
}

function tokenPattern(name) {
  // Non-greedy, and refuses to span a nested token of the same name.
  return new RegExp(`\\{\\{${name}\\}\\}([\\s\\S]*?)\\{\\{\\/${name}\\}\\}`, 'g');
}

/**
 * Replace the writer's tokens with real markup.
 *
 * @param {string} html
 * @param {object} targets
 *        money: { url }                       -> <a href>
 *        prev:  { url }                       -> <a href>
 *        next:  { url } | { pendingId }       -> <a href>, or a pending span
 * @returns {{ html: string, found: string[], missing: string[] }}
 */
function applyLinks(html, targets = {}) {
  let out = String(html || '');
  const found = [];

  for (const name of TOKEN_NAMES) {
    const target = targets[name];
    const re = tokenPattern(name);

    if (!target) {
      // Nothing to link — unwrap so a stray token never reaches a reader,
      // still fixing the case if it opened a sentence.
      out = out.replace(re, (_m, text, offset) =>
        startsSentence(out, offset) ? capitaliseFirst(text) : text);
      continue;
    }

    let hit = false;
    out = out.replace(re, (_m, text, offset) => {
      hit = true;

      // Offsets refer to `out` as it stands at the start of this pass, which
      // is correct: replace() builds a new string rather than mutating.
      const label = startsSentence(out, offset) ? capitaliseFirst(text) : text;

      if (target.pendingId) {
        return `<span data-il-link="${escapeHtmlAttr(target.pendingId)}">${label}</span>`;
      }
      return `<a href="${escapeHtmlAttr(target.url)}">${label}</a>`;
    });

    if (hit) found.push(name);
  }

  const missing = TOKEN_NAMES.filter(n => targets[n] && !found.includes(n));
  return { html: out, found, missing };
}

/**
 * Switch on every pending link that points at `topicId`.
 *
 * Returns the new HTML and a count, so the caller can skip the database write
 * — and skip bumping the post's modified date — when nothing changed.
 */
function activate(html, topicId, url) {
  const id = escapeHtmlAttr(topicId);
  const re = new RegExp(
    `<span([^>]*?)\\sdata-il-link="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"([^>]*)>([\\s\\S]*?)<\\/span>`,
    'g'
  );

  let count = 0;
  const out = String(html || '').replace(re, (_m, before, after, text) => {
    count += 1;
    // Carry through any other attributes the owner may have added.
    const rest = `${before || ''}${after || ''}`.trim();
    return `<a href="${escapeHtmlAttr(url)}"${rest ? ' ' + rest : ''}>${text}</a>`;
  });

  return { html: out, count };
}

/** Which topics this post is still waiting on. */
function pendingIds(html) {
  const re = /<span[^>]*\sdata-il-link="([^"]+)"[^>]*>/g;
  const ids = new Set();
  let m;
  while ((m = re.exec(String(html || '')))) ids.add(m[1]);
  return [...ids];
}

/** Strip any token the writer emitted that we had no target for. */
function stripTokens(html) {
  let out = String(html || '');
  for (const name of TOKEN_NAMES) {
    out = out.replace(tokenPattern(name), (_m, text) => text);
  }
  return out;
}

module.exports = { applyLinks, activate, pendingIds, stripTokens, TOKEN_NAMES };