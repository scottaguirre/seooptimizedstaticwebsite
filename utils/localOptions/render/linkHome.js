// utils/localOptions/render/linkHome.js
//
// The first time a service page says the business's name, make it a link.
//
// WHY — Edwin, 2 November: "can we link back to the home page from the body
// of service pages so it looks more natural and relevant?"
//
// WHAT THIS IS NOT, AND THE DISTINCTION IS THE WHOLE DESIGN. The obvious way
// to get a link into the body is to ask the model for one. This file exists
// because that is the trap this codebase keeps relearning:
//
//     A PROMPT THAT DICTATES A SENTENCE GETS THAT SENTENCE, SIX TIMES.
//
// It cost the closing line of every service page, it cost four identical h2s
// across six pages, it cost five cost-headings that were five restatements
// of the brief that asked for them, and it cost both structures opening
// paragraph three with "A visit starts with". Six pages ending "learn more
// about Acme Plumbing" would be the same failure wearing a link.
//
// SO NOTHING IS WRITTEN. The copy already names the business sometimes, for
// its own reasons, in its own words, in a different place on each page —
// that is what a natural mention IS. This marks one of them up.
//
//   it adds      no words
//   it changes   one existing phrase into an anchor
//   it produces  a different sentence on every page, for free, because the
//                sentences were already different
//
// AND WHEN THE NAME IS NOT THERE, NEITHER IS THE LINK. A page that never
// mentions the business gets nothing, which is right: the alternative is
// forcing a mention, and a forced mention is the dictated sentence again.
// Home is reachable from the masthead and the colophon of every page
// regardless, so nothing is ever stranded.
//
// ON THE SEO CASE, HONESTLY. Home is already linked from the header and the
// footer of all eleven pages, so this is not rescuing an unlinked page.
// Whether a second link to the same URL contributes its anchor text is the
// "first link priority" question, which Google has never confirmed and which
// Mueller answered with "I suspect you're overthinking it". The reason to do
// it is that a page referring to the company by name, as a link, reads like
// a company talking. That was what was actually asked for.
//
//   node test-local-options-render.js

'use strict';

const { esc } = require('./shape');

/**
 * Everything that must not be matched inside.
 *
 * TWO KINDS OF REGION, AND BOTH MATTER:
 *
 *   an anchor   The owner may have put their own link round the business
 *               name from the editor, and a second anchor inside the first
 *               is markup no browser agrees about. richText() also emits
 *               anchors, so this is not hypothetical.
 *   a tag       An attribute could hold the name — a title, an alt. Matching
 *               there would write a tag into the middle of a tag.
 *
 * THE ANCHOR ALTERNATIVE IS FIRST IN THE PATTERN, so an `<a ...>` opens an
 * anchor region rather than matching as a bare tag; alternation is ordered
 * and the longer construct has to win.
 */
const SKIP = /(<a\b[^>]*>[\s\S]*?<\/a>|<[^>]+>)/;

/**
 * Wrap the first mention of `name` in `html` in a link to `href`.
 *
 * @param {string} html  already-escaped page HTML, as prose() returns it
 * @param {string} name  the business name, unescaped
 * @param {string} href  where home is from this page's depth
 * @returns {string}
 *
 * ONCE PER PAGE. A name linked every time it appears is not prose, it is a
 * page that looks spammed — and the second link to the same URL on the same
 * page is the one nobody argues is worth anything.
 *
 * THE NAME IS ESCAPED BEFORE IT IS SOUGHT, because the haystack is escaped
 * already. A business called "Smith & Sons" appears in the HTML as
 * "Smith &amp; Sons", and searching for the raw string would never find it —
 * silently, on exactly the businesses whose names have punctuation in them.
 *
 * THE MATCH IS EXACT, NOT FUZZY. No case-insensitivity, no normalising of
 * spaces: the mention has to be the name as it was given. Linking "the
 * plumber" because it looked close enough is a sentence the owner did not
 * write being turned into a link they did not ask for.
 */
function linkHome(html, name, href) {
  const needle = esc(String(name == null ? '' : name).trim());
  const target = String(href == null ? '' : href).trim();

  if (!needle || !target) return String(html == null ? '' : html);

  const src = String(html);

  /* SPLIT ON THE REGIONS TO SKIP, so the search only ever runs over text.
   * A capture group in the separator keeps the skipped parts in the array,
   * at the odd indices, and they are rejoined untouched. */
  const parts = src.split(new RegExp(SKIP.source, 'g'));

  for (let i = 0; i < parts.length; i += 2) {
    const at = parts[i].indexOf(needle);

    if (at < 0) continue;

    parts[i] = parts[i].slice(0, at)
      + `<a href="${esc(target)}">${needle}</a>`
      + parts[i].slice(at + needle.length);

    return parts.join('');
  }

  return src;
}

module.exports = { linkHome, SKIP };
