// utils/localOptions/render/richText.js
//
// A paragraph the owner may have put a link in.
//
// WHY THIS EXISTS — Edwin, 29 October, on editing a site after it is live:
// "The links would be in the prose but the user will enter just the anchor
// text or a new line or update the paragraph but I dont want to redo the
// whole content."
//
// So an owner edits one paragraph and may want a word or two in it to point
// somewhere — a booking page, a supplier, their Google profile.
//
// THE SHAPE, AND WHY IT IS NOT THE BLOG'S
//
// The Cloudflare blogs put the anchor text in the prose as a token —
// {{link}}our Leander office{{/link}} — and keep the URL in a field on the
// article. That is one field, so it is one custom link per article: enough
// for a post pointing at a money page, thin for a service page that wants a
// manufacturer, a permit office and a booking form.
//
// Here the URL sits with the text:
//
//     Call [our Leander office](https://example.com/leander) before you dig.
//
// As many as the owner likes, no extra fields, and the syntax is the one
// they have seen in every editor they have ever used.
//
// THE SAFETY RULE, WHICH IS THE WHOLE REASON THIS IS A FILE AND NOT A REGEX
// INSIDE prose()
//
// These pages are published on the CLIENT'S OWN DOMAIN and read by their
// customers. Text that becomes markup becomes markup in somebody else's
// visitors' browsers, which is a longer reach than the usual case.
//
//     ESCAPE EVERYTHING FIRST. CONVERT ONE PATTERN AFTERWARDS.
//
// Not "allow some HTML". Not "strip what looks dangerous" — a deny-list is a
// guess about every construct that could matter. The paragraph is escaped in
// full, so nothing in it can be markup; then one known pattern is replaced
// with a tag THIS file writes, around a URL it has checked.

'use strict';

const { esc } = require('./shape');

/**
 * `[anchor text](url)` — inside an already-escaped paragraph.
 *
 * THE TEXT MAY NOT CONTAIN ] AND THE URL MAY NOT CONTAIN ) OR A SPACE, which
 * keeps the match from running away across a paragraph that has a stray
 * bracket in it. A sentence like "see the invoice (attached)" is left alone
 * because nothing before it opened a link.
 *
 * A SPACE BETWEEN ] AND ( IS ALLOWED, AND MARKDOWN DOES NOT ALLOW IT — 30
 * October, from the first link anybody typed into the editor:
 *
 *     ... and property [CHECK HERE] (https://google.com) owners ...
 *
 * It rendered as the brackets, which is this file working as designed: an
 * unrecognised link is left as typed rather than dropped, so the owner can
 * see something is wrong. They could. The question is whether they should
 * have had to.
 *
 *     BEING STRICT ABOUT A SPACE BUYS NOTHING HERE.
 *
 * The cost of allowing it is a sentence like "see [the invoice] (attached)"
 * becoming a link — and it cannot, because the second half still has to
 * look like an http URL. Tabs and spaces only, never a newline: \s would
 * let a match run from a bracket on one line to a parenthesis three
 * paragraphs down.
 */
const LINK = /\[([^\]\n]+)\][ \t]*\(([^)\s]+)\)/g;

/**
 * A URL we are willing to put in an href.
 *
 * http AND https ONLY, AS AN ALLOW-LIST. `javascript:` is the obvious one to
 * keep out, but so are `data:`, `vbscript:` and whatever is invented next —
 * and a list of schemes to refuse is a list somebody has to keep adding to.
 * Two schemes cover every link an owner of a plumbing site will ever write.
 *
 * MATCHED ON THE ESCAPED STRING, which is safe: escaping turns `&` into
 * `&amp;` and touches nothing else a URL begins with. A query string arrives
 * as `?a=1&amp;b=2`, which is the correct way to write it in an attribute
 * anyway.
 */
const SAFE_SCHEME = /^https?:\/\/[^\s]+$/i;

/**
 * One paragraph of owner text, as HTML.
 *
 * @param {string} text
 * @returns {string}
 */
function richText(text) {
  const safe = esc(String(text == null ? '' : text));

  return safe.replace(LINK, (whole, label, href) => {
    /* A LINK THAT IS NOT ALLOWED IS LEFT AS THE OWNER TYPED IT, not dropped
     * and not turned into a dead anchor. They can see the brackets on their
     * own page and work out that something is wrong with the address —
     * whereas a silently removed link is a change they did not ask for and
     * cannot see. */
    if (!SAFE_SCHEME.test(href)) return whole;

    return `<a href="${href}">${label}</a>`;
  });
}

module.exports = { richText, LINK, SAFE_SCHEME };
