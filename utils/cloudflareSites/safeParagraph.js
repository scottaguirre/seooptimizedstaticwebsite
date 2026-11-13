// utils/cloudflareSites/safeParagraph.js
//
// A paragraph an owner typed, made safe to drop into a page.
//
//   safeParagraph('Call us <a href="/contact">today</a>.')
//     -> 'Call us <a href="/contact">today</a>.'
//
//   safeParagraph('<img src=x onerror=alert(1)>')
//     -> '&lt;img src=x onerror=alert(1)&gt;'
//
//
// WHY THIS HAS TO EXIST BEFORE THE EDIT SCREEN DOES
//
// runGeneration writes section paragraphs into the template with a plain
// `.replace()` and no escaping — `{{SECTION1_P1}}` becomes whatever the
// string is. That is correct today because the only writer is the content
// generator and the only HTML in there is the <a> tags the interlink
// injector put in.
//
// An edit screen changes that. The moment a person can type into a paragraph,
// an unescaped `.replace()` is a script tag on a published page, served from
// the customer's own domain, to the customer's own visitors.
//
//     THE FIELD DID NOT BECOME DANGEROUS. IT BECAME REACHABLE.
//
//
// ESCAPE EVERYTHING, THEN RE-ADMIT ONE THING
//
// The order matters and it is the whole design. A "strip the bad tags"
// sanitiser is a list of what somebody thought of, and the attacks are a list
// of what they did not: `<scr<script>ipt>`, `<svg/onload=>`, an attribute
// nobody remembered. This escapes the entire string first — so the default
// outcome of anything unexpected is inert text — and then converts back ONLY
// the exact shape of an anchor whose URL passes.
//
// Nothing can survive that it was not explicitly let through.
//
//
// WHY ANCHORS AT ALL
//
// Edwin, 7 November, on the scope of the edit screen: *"just paragraphs with
// the ability to insert a link"*. The stored paragraphs already contain <a>
// tags — the interlink injector put them there and the model records the text
// after injection — so an editor that escaped them would turn every existing
// link into visible angle brackets on the first save.

'use strict';

/** Everything that could begin a tag, an entity, or an attribute break. */
function escapeAll(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Schemes an owner may link to.
 *
 * A RELATIVE URL IS THE COMMON CASE and has no scheme at all — `/contact`,
 * `./`, `water-heater-repair.html`, `#pricing`. Those are allowed by having
 * no colon before the first slash, which is the rule the browser uses too.
 *
 * `javascript:` IS THE ONE THIS LIST EXISTS FOR, and `data:` is the one
 * people forget — `data:text/html,<script>…</script>` is a working XSS in a
 * link. Neither is reachable by an owner who wants to link to a page.
 */
const ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];

/**
 * @param {string} raw  an href, already un-escaped
 * @returns {string|null} the href to use, or null to refuse the whole anchor
 *
 * REFUSES RATHER THAN REWRITES. A URL that is not allowed is not a URL with a
 * typo in it — something tried something — and rewriting it to '#' would
 * leave a link that looks deliberate. The caller drops the anchor and keeps
 * the words.
 */
function safeHref(raw) {
  const href = String(raw == null ? '' : raw).trim();

  if (!href) return null;

  /* CONTROL CHARACTERS ARE DELIBERATELY NOT STRIPPED, AND THAT IS THE
   * OPPOSITE OF WHAT THIS FUNCTION FIRST DID.
   *
   * It began with `href.replace(/[\u0000- \u007f]/g, '')` and a comment
   * saying that `java\tscript:` is a scheme browsers have historically
   * accepted, so the characters had to go before the test could mean
   * anything. That reasoning is correct for a BLOCKLIST and backwards for
   * this one.
   *
   * Nothing here asks "is this javascript:". It asks "is this exactly one of
   * four". A control character can only turn a scheme into one that is not
   * on the list, which refuses it — while NORMALISING first turns
   * `ht\u0000tp:` into `http:` and lets it through.
   *
   *     WITH AN ALLOWLIST, CLEANING THE INPUT BEFORE COMPARING IT
   *     CAN ONLY EVER ADMIT MORE THAN THE LIST SAYS.
   *
   * Mutation testing found it: deleting the strip changed no test, because
   * `java\tscript:` was never refused BY the strip — it was refused by not
   * being one of four strings. The strip was doing nothing except widening
   * what could match.
   *
   * `trim()` above stays. A space around a pasted URL is ordinary, and it
   * cannot bridge two halves of a scheme the way an inner character can. */
  const clean = href;

  if (!clean) return null;

  /* A SCHEME IS EVERYTHING BEFORE THE FIRST COLON, IF THAT COMES BEFORE THE
   * FIRST SLASH. `/a:b` is a path containing a colon, not a scheme; so is
   * `./x:y`. Reading the colon alone would refuse both. */
  const slash = clean.indexOf('/');
  const colon = clean.indexOf(':');

  const hasScheme = colon > -1 && (slash === -1 || colon < slash);

  if (!hasScheme) {
    /* RELATIVE, AND IT MUST NOT CLIMB OUT. `../../` in a published static
     * site resolves at the edge, not here, so this is about the link being
     * meaningful rather than about reading a file — but a link nobody
     * intended is still a link nobody intended. */
    return clean.includes('..') ? null : clean;
  }

  const scheme = clean.slice(0, colon + 1).toLowerCase();

  return ALLOWED_SCHEMES.includes(scheme) ? clean : null;
}

/**
 * The escaped form of an anchor, as escapeAll() leaves one.
 *
 * THE OPENING TAG IS MATCHED LOOSELY AND RE-EMITTED STRICTLY, which is the
 * safe way round and took a failing test to arrive at.
 *
 * The first version matched `&lt;a href=&quot;…&quot;&gt;` and nothing else.
 * It was safe, and it was also unusable: an owner who pasted a link with a
 * `target` — which is what copying a link out of anywhere gives you — got
 * the raw markup printed on their page as visible angle brackets. The module
 * claimed in its own comment to drop the attribute and keep the link, and it
 * did neither.
 *
 *     MATCHING LOOSELY IS ONLY DANGEROUS IF YOU EMIT WHAT YOU MATCHED.
 *
 * So the attribute blob is anything up to the first `&gt;` — and NOTHING
 * from it is carried through. safeParagraph() rebuilds the tag from the one
 * href it extracted and a validated URL. A `target`, a `class`, an `onclick`:
 * all matched, none emitted.
 *
 * `(?:(?!&gt;)[\s\S])*?` RATHER THAN `[^&]*`, and that took a second failing
 * run to get right. After escapeAll() an href reads `href=&quot;/x&quot;` —
 * which is full of ampersands, so a class excluding `&` could not span the
 * one attribute the pattern exists to find. Every link in the suite came
 * back as visible angle brackets.
 *
 * `(?=\s|&gt;)` AFTER THE `a`, because without it `&lt;abbr&gt;` matches as
 * an anchor whose attribute blob is "bbr".
 */
const ESCAPED_ANCHOR = /&lt;a(?=\s|&gt;)((?:(?!&gt;)[\s\S])*?)&gt;([\s\S]*?)&lt;\/a&gt;/g;

/** The href out of a matched attribute blob, or '' when there is none. */
const HREF_IN_BLOB = /\bhref=&quot;([^&]*)&quot;/;

/**
 * @param {string} text  what the owner typed
 * @returns {string}     safe to write into a template with .replace()
 *
 * THE WORDS ALWAYS SURVIVE. A refused anchor loses its link, not its text —
 * an owner who pastes something odd gets a sentence that reads correctly and
 * does not go anywhere, rather than a hole in their page.
 */
function safeParagraph(text) {
  const escaped = escapeAll(text);

  return escaped.replace(ESCAPED_ANCHOR, (whole, blob, inner) => {
    /* THE BLOB IS READ FOR ONE THING AND THEN DISCARDED. Whatever else was
     * in the opening tag — target, class, onclick, style — is matched so it
     * cannot be left behind as text, and is never emitted. */
    const found = HREF_IN_BLOB.exec(blob || '');
    const url = found ? safeHref(unescapeEntities(found[1])) : null;

    /* THE INNER TEXT IS LEFT EXACTLY AS ESCAPED.
     *
     * A second pass over it, flattening nested anchors, used to live here.
     * Mutation testing killed it: no test changed when it was deleted, and
     * no input reaches it. The match is non-greedy, so an `<a>` inside an
     * `<a>` ends at the FIRST `</a>` — the nested opening tag lands in
     * `inner` as escaped text and never as a complete anchor for a second
     * pass to find.
     *
     * Nesting is still handled, just not here: the leftovers print as
     * visible text and exactly one anchor is emitted, which is what the
     * nesting test asserts. Same reasoning as the existsSync removed from
     * wranglerEntry() — a line no test can protect reads as safety and is
     * not. */
    return url ? `<a href="${escapeAll(url)}">${inner}</a>` : inner;
  });
}

/**
 * The five entities escapeAll() produces, turned back.
 *
 * ONLY THOSE FIVE. A general entity decoder would turn `&#106;avascript:`
 * into something safeHref has to catch — this runs BEFORE that check, so the
 * narrower it is, the less there is to catch. Anything else stays as written
 * and fails the scheme test as the literal text it is.
 */
function unescapeEntities(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Every paragraph of a section, in order, each made safe. */
function safeParagraphs(list) {
  return (Array.isArray(list) ? list : [])
    .map(p => safeParagraph(p))
    .filter(p => p.trim().length);
}

/**
 * A heading or subheading an owner typed.
 *
 * ESCAPED, AND NO ANCHOR IS LET BACK IN. Two separate reasons, either of
 * which alone would settle it:
 *
 *   1. The builders write a heading with `.replace()` and no escaping, the
 *      same way they write a paragraph. So escaping is not optional here.
 *
 *   2. buildAboutUsPage and buildLocationPages both render the H2 as
 *      `heading.toUpperCase()`. An anchor that survived into a heading would
 *      come out as `<A HREF="/CONTACT.HTML">` — an uppercase tag name is
 *      harmless, but an uppercased PATH is a 404 on a case-sensitive host,
 *      and Cloudflare Pages is one. The line that renders the heading is the
 *      line that would break the link.
 *
 * So safeParagraph's one concession does not apply here: this is escapeAll
 * with nothing added back.
 *
 * NEWLINES COLLAPSE. A heading is one line and the form posts it from an
 * <input>, which cannot hold one — but a paste can, and a newline landing in
 * the middle of {{SECTION1_H2}} renders as a stray gap in a shouted heading
 * rather than as anything anybody intended.
 */
function safeHeading(text) {
  return escapeAll(String(text == null ? '' : text).replace(/\s+/g, ' ').trim());
}

/**
 * One line of the ticked trust list.
 *
 * NOT ESCAPED, AND THAT IS THE ENTIRE REASON IT IS A SEPARATE FUNCTION.
 *
 * Every other field in this module is escaped on the way IN, because its
 * template writes it out raw. A trust point is the opposite: BOTH of its
 * renderers escape it on the way OUT —
 *
 *     buildTrustList()                  .replace(/&/g, '&amp;') and friends
 *     <prefix>_render_trust_points()    esc_html( $point )
 *
 * — so escaping here as well would double-escape it, and an owner who typed
 * "Visa & Mastercard accepted" would read "Visa &amp; Mastercard accepted"
 * on their own published page.
 *
 *     ESCAPE AT EXACTLY ONE END. Which end is a fact about the consumer, not
 *     a house style, and this list's two consumers have already chosen.
 *
 * Nothing is stripped either: a `<script>` typed here is stored as those
 * characters and shown as those characters, visibly and inertly, by both
 * renderers.
 *
 * AN EMPTY RESULT IS MEANINGFUL HERE and is not a mistake — it is how a
 * bullet is removed. buildTrustList filters falsy entries and reflows, which
 * a paragraph slot cannot do. editableText.apply() relies on that.
 */
function safeTrustPoint(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
}

/**
 * A review's body, or the name above it.
 *
 * THE SAME RULE AS A TRUST POINT, AND ITS OWN FUNCTION FOR THE SAME REASON:
 * which end escapes is a fact about THIS field's renderers, so the answer is
 * recorded beside the field rather than borrowed from a neighbour that
 * happens to agree today.
 *
 * Both of this one's renderers escape on the way OUT —
 *
 *     buildReviewsSection()     escapeHtml(r.text) and escapeHtml(r.name)
 *     the exported PHP theme    esc_html( $row['text'] )
 *
 * — so escaping here would double it, and an owner pasting a real review
 * that says "Fitted a new heater & cleaned up after" would read
 * "&amp; cleaned up" on their own published page.
 *
 * WHITESPACE COLLAPSED, NEWLINES INCLUDED, because the card renders one <p>.
 * A review pasted out of Google with a blank line in the middle would
 * otherwise keep a break the markup has nowhere to put.
 *
 * AN EMPTY RESULT IS MEANINGFUL FOR THE BODY and is how a review is removed:
 * contentModel.reviewsSection() and buildReviewsSection both drop a row with
 * no text. It is NOT meaningful for the name — see applyReviews().
 */
function safeReview(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
}

/**
 * The five entities escapeAll() produces, turned back — IN ONE PASS.
 *
 * WHY NOT unescapeEntities(), WHICH IS RIGHT ABOVE AND LOOKS IDENTICAL. That
 * one runs five replacements in sequence, so the output of an earlier one is
 * fed to a later one: `&amp;lt;` becomes `&lt;` on the first pass and then
 * `<` on the second. For safeHref that is harmless — it only has to refuse —
 * but here it would quietly rewrite what somebody wrote.
 *
 * One regex, one decision per match, nothing decoded twice.
 */
const ENTITY = /&(amp|lt|gt|quot|#39);/g;
const ENTITY_TEXT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };

/**
 * A stored paragraph or heading, turned back into what the person typed.
 *
 * THE BUG THIS EXISTS FOR, AND IT COMPOUNDED. Text is escaped on the way in,
 * because the templates write it out raw. The edit screen then put the
 * STORED value back in the box — so somebody who typed
 *
 *     Hi! I'm John
 *
 * got `Hi! I&#39;m John` in the textarea, posted that back, and had it
 * escaped a second time. Three saves of the same untouched paragraph:
 *
 *     save 1   Hi! I&#39;m John
 *     save 2   Hi! I&amp;#39;m John
 *     save 3   Hi! I&amp;amp;#39;m John
 *
 * and by then the published page was showing the entity to visitors. Nothing
 * failed. Each individual save was correct; it was the LOOP that was wrong.
 *
 *     ESCAPING IS NOT IDEMPOTENT, SO THE ROUND TRIP HAS TO UNDO IT. A screen
 *     that edits stored text must show what the page shows, not what the
 *     file holds.
 *
 * Only for filling the form. Nothing stored or published goes through here.
 *
 *
 * IT DECODES TO A FIXED POINT, NOT ONCE, AND THAT NEEDS JUSTIFYING.
 *
 * Undoing one layer is right for text with one layer. The sites that were
 * edited while the bug was live have two and three, and a decoder that
 * removes one per save would need the owner to press Save three times — on
 * every one of the ninety-odd fields that contains an apostrophe — to get
 * back to what they typed.
 *
 * The usual objection is that looping could eat something an author meant
 * literally: somebody who typed `&amp;` to make the page show "&amp;".
 * That cannot have happened here, and the reason is specific rather than
 * hopeful:
 *
 *     AN ENTITY IN A STORED PARAGRAPH CAN ONLY HAVE COME FROM OUR OWN
 *     ESCAPER. Generated content is stored raw — checked against a real
 *     content.json: zero entities in it, and zero apostrophes, because the
 *     model writes plain prose and contentModel keeps it unchanged. The
 *     only thing that has ever put an `&amp;` into one of these fields is
 *     safeParagraph, on its way in from this form.
 *
 * So decoding to a fixed point recovers exactly what the author typed, and
 * the invariant it restores is the one the data should always have had:
 * STORED TEXT IS THE AUTHOR'S TEXT, ESCAPED EXACTLY ONCE.
 *
 * IT TERMINATES, AND THERE IS NO ROUND LIMIT, WHICH IS DELIBERATE.
 *
 * A round either changes nothing — and returns — or replaces at least one
 * entity of four or more characters with exactly one, so the string is
 * strictly shorter. A strictly decreasing length bounded below by zero
 * cannot go on for ever. The loop ends because of what it does, not because
 * somebody counted.
 *
 * There WAS a `MAX_ROUNDS = 8` here. Mutation testing killed it: removing it
 * changed no test, and no test could be written, because no input exists
 * that would reach it. The same reasoning took the existsSync out of
 * wranglerEntry() and the control-character stripper out of safeHref.
 *
 *     A LINE NO TEST CAN PROTECT READS AS SAFETY AND IS NOT. Worse here
 *     than usual: a cap of 8 would silently stop halfway through repairing
 *     a field that had been saved nine times, and leave an entity on the
 *     page with nothing to say why.
 */
function forEditing(text) {
  let out = String(text == null ? '' : text);

  for (;;) {
    const next = out.replace(ENTITY, (m, name) => ENTITY_TEXT[name]);
    if (next === out) return out;
    out = next;
  }
}

module.exports = {
  safeParagraph, safeParagraphs, safeHeading, safeTrustPoint, safeReview, forEditing,
  safeHref, escapeAll, unescapeEntities,
  ALLOWED_SCHEMES, ESCAPED_ANCHOR,
};
