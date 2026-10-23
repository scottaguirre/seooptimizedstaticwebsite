// utils/blog/verificationTags.js
//
// What a customer pastes into the Search Console field, turned into values
// we are willing to render into every page of their live blog.
//
// WHY THIS PARSES RATHER THAN STORING WHAT THEY TYPED
//
// Google shows them a whole tag:
//
//     <meta name="google-site-verification" content="dK3xP9mQ2vR7nL4tY8wZ" />
//
// That is what is on the clipboard, so that is what arrives in the field. A
// field that demanded the bare value would produce an error about a word the
// customer has never heard, on a screen they cannot debug.
//
// But the tag cannot go onto the page as it arrived. It is customer-supplied
// text heading for an HTML attribute on every article of a site published to
// the internet — so a value that closes the attribute and opens an element is
// an injection into their readers' browsers, not into our server. The reach
// is longer than the usual case and the blast lands on somebody else.
//
// So: pull the value out, check it is the shape of a token, and let the
// renderer build the tag itself. What goes on the page is a tag WE wrote,
// around a value they chose.
//
// TWO DEFENCES, ON PURPOSE. This file refuses a dangerous value and the
// renderer escapes whatever it is given. Either alone would do today;
// escaping is one esc() somebody deletes while tidying, and this file is the
// only place that says what a verification token actually is.
//
// WHY A LIST
//
// Google matches ANY of the verification meta tags on a page, so two Search
// Console properties can own one site. Edwin wants his own property on a
// customer's blog — to see an indexing problem before they report it —
// alongside theirs. One per line in the field.

/** More than this is a mistake or a paste gone wrong, not a configuration. */
const MAX_TAGS = 5;

/* Google's tokens are in the forties; the ceiling is loose on purpose,
 * because the format is theirs to change and a length nobody documented is
 * a bad thing to be strict about. */
const MAX_TOKEN = 120;
const MIN_TOKEN = 8;

/* WHAT A TOKEN MAY CONTAIN, as a whitelist rather than a list of things to
 * strip. A blacklist is a guess about every character that could matter in
 * every context this value will ever reach; a whitelist is a statement about
 * what Google issues. Letters, digits, dash and underscore cover their
 * base64url-ish tokens and nothing that can end an attribute. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]+$/;

/**
 * The content attribute of a google-site-verification meta tag.
 *
 * BOTH ATTRIBUTES ARE CHECKED, and the name is checked for being Google's.
 * Parsing any <meta> for its content would read
 * `<meta name="description" content="A blog about plumbing">` as a
 * verification token and put a sentence of prose on every page — the shape
 * of the tag being the only reason it got that far.
 *
 * Attribute ORDER is not assumed. Nothing guarantees Google keeps writing
 * them name-first, and a parser that depends on it fails on a string the
 * customer copied perfectly.
 */
function contentOfMetaTag(line) {
  if (!/^<meta\b/i.test(line)) return null;

  const name = /\bname\s*=\s*["']?google-site-verification["']?/i.test(line);
  if (!name) return null;

  const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(line);
  if (!content) return null;

  return content[1] !== undefined ? content[1]
    : content[2] !== undefined ? content[2]
      : content[3];
}

/**
 * The input, cut into things that might each be one entry.
 *
 * A META TAG FIRST, AND IT MAY SPAN LINES. Splitting the field on newlines
 * and then looking for tags was the first version, and it failed on a tag
 * that had wrapped — which is what a paste out of an email or a formatted
 * document looks like. `[^>]*` crosses newlines happily, so the tag is one
 * piece however it was laid out.
 *
 * ANYTHING ELSE IS ONE LINE, for the bare-token case. Alternation order
 * matters: a line that IS a tag matches the first branch, so it is never
 * read as a token with angle brackets in it.
 */
const PIECES = /<meta\b[^>]*>|[^\s][^\n]*/g;

/**
 * Everything a customer pasted, as tokens safe to render.
 *
 * ONE BAD LINE DOES NOT DISCARD THE GOOD ONES. Somebody pasting two tags and
 * fumbling one should end up with the other, not with an empty field and
 * nothing to tell them why.
 *
 * @param {string} raw  the field's contents, one entry per line
 * @returns {string[]}  distinct tokens, in the order they were given
 */
function parseVerificationTags(raw) {
  const out = [];

  for (const piece of String(raw == null ? '' : raw).match(PIECES) || []) {
    const trimmed = piece.trim();
    if (!trimmed) continue;

    /* A TAG IF IT LOOKS LIKE ONE, OTHERWISE THE PIECE IS THE VALUE. Not two
     * modes — one path with a fallback, so somebody who kept only the token
     * in their notes is not told they are wrong. */
    const value = /^<meta\b/i.test(trimmed)
      ? contentOfMetaTag(trimmed)
      : trimmed;

    if (!value) continue;

    const token = value.trim();

    if (token.length < MIN_TOKEN || token.length > MAX_TOKEN) continue;
    if (!TOKEN_SHAPE.test(token)) continue;
    if (out.includes(token)) continue;

    out.push(token);
    if (out.length === MAX_TAGS) break;
  }

  return out;
}

module.exports = {
  parseVerificationTags, contentOfMetaTag,
  MAX_TAGS, MAX_TOKEN, MIN_TOKEN, TOKEN_SHAPE,
};
