// utils/blog/render/theme.js
//
// The stylesheet a static blog ships, at /assets/blog.css.
//
// THIS FILE USED TO READ THE PLUGIN'S STYLESHEET. IT NO LONGER DOES.
//
// Until 19 October this was a block of chrome bolted onto
// `wp-plugin/interlink-engine/assets/blog.css`, read off disk, so a
// Cloudflare blog and a WordPress blog were the same pixels out of one
// file. That was the right call while the two products were meant to look
// identical, and the comment here argued for it at length.
//
// They are no longer meant to look identical. Edwin asked for the accent
// headings and the hairline above each h2 gone from the static blogs and
// KEPT on WordPress, and you cannot get two looks out of one file. So the
// look is forked, deliberately, and that fork is the whole point of the
// file you are reading.
//
// WHAT THAT COSTS, SAID PLAINLY
//
// There are two stylesheets now, and the second time somebody adjusts the
// heading spacing they will adjust one of them. That is the mistake this
// project has paid for more than any other, and nothing below prevents it:
// a fork cannot be made safe, only made visible. What IS prevented is the
// silent half of it — test-blog-render.js asserts that this file carries no
// `.ie-` selector and that the plugin's file still carries the two rules
// Edwin kept, so neither sheet can quietly absorb the other's decisions.
//
// WHY THE CLASS NAMES DIFFER TOO
//
// The markup was identical as well: `.ie-post` and `.ie-styled` on both
// sides. Renaming the static blog's to `cloudflare-` is what makes the fork
// real rather than a question of which file loads last — a rule written
// here CANNOT reach a WordPress page, because no WordPress page has an
// element it matches. `data-il-link` is the one shared name left, and
// deliberately: it is link machinery read by links.js and by the plugin's
// activation code, not styling.
//
// NO DISK READ ANY MORE. The stylesheet is a constant.

'use strict';

/**
 * The whole stylesheet a static blog serves.
 *
 * Forked from the plugin's blog.css — Edwin's variant D, one accent, boxes
 * on the lists and quotes — with two deliberate departures, both his call:
 *
 *   - h2 and h3 carry NO colour. They were --ie-accent blue.
 *   - h2 draws NO hairline above it. The 1.6em of padding that spaced the
 *     text off that line STAYS: it is what separates the sections now that
 *     nothing is drawn between them.
 *
 * Everything else — the 78ch measure, the centred column, the heading
 * scale, the margins, the gutter, the lead paragraph, the boxed lists, the
 * quote bar, the accent on LINKS — is exactly as it was. "Except the
 * center, and paddings and font-size."
 */
const CSS = `/*
 * blog.css — the look of a static blog.
 *
 * Forked from the Interlink Engine plugin's stylesheet on 19 October, when
 * the two products stopped being meant to look the same. The plugin's copy
 * styles .ie-post inside somebody else's WordPress theme; this one styles
 * .cloudflare-post on a page with no host theme at all, so it also has to
 * supply the body type, the colours, the masthead and the footer.
 *
 * ONE ACCENT, AND IT IS NOW ONLY ON LINKS AND THE BOX FURNITURE. On
 * WordPress the accent also colours h2 and h3. Here it does not: the
 * headings are the body colour, and nothing is drawn between the sections.
 *
 * BODY TEXT IS NEVER GIVEN A COLOUR inside the article, so it stays
 * whatever the page set. Sizes and spacing are in em, so everything scales
 * together.
 */

:root {
  color-scheme: light;
}

/* --------------------------------------------------------------------
 * The page
 *
 * What a WordPress theme would have supplied, and what a static blog has
 * to supply for itself.
 * ----------------------------------------------------------------- */
body.cloudflare-styled {
  margin: 0;
  background: #ffffff;
  color: #1a1a1a;

  /* The system stack. No web font: a blog whose first paint waits on a
   * font download is a blog that looks broken for 300ms on every visit,
   * and none of these articles need a typeface of their own. */
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
               "Helvetica Neue", Arial, sans-serif;
  font-size: 18px;
  line-height: 1.6;
  -webkit-text-size-adjust: 100%;

  /* THE GUTTER, DECLARED ONCE, so the title and the article inherit the
   * same value and cannot drift apart. Small on a phone, where every pixel
   * of width is reading space; generous on a desktop, where text hard
   * against the browser edge looks unfinished. */
  --cloudflare-gutter: clamp(1rem, 4vw, 3.25rem);
}

/* CENTRED BY THE PAGE, NOT BY THE ARTICLE. .cloudflare-post has its own
 * 78ch measure and its left gutter; adding a margin there too would fight
 * it. This centres the column those rules produce. */
main {
  max-width: 78ch;
  margin: 0 auto;
  padding: 0 1rem 4rem;
}

.cloudflare-masthead {
  border-bottom: 1px solid rgba(127, 127, 127, 0.18);
  margin-bottom: 2.5rem;
  padding: 1.25rem 1rem;
}

.cloudflare-masthead .cloudflare-home,
.cloudflare-footer a {
  color: inherit;
  font-weight: 600;
  text-decoration: none;
}

.cloudflare-masthead .cloudflare-home:hover,
.cloudflare-footer a:hover {
  text-decoration: underline;
}

/* The same gutter the title and the article inherit, so the date lines up
 * with them instead of hanging off the left edge on a wide screen. */
.cloudflare-date {
  padding-left: var(--cloudflare-gutter, 0);
  margin: 0.75em 0 0;
  font-size: 0.95em;
  opacity: 0.65;
}

.cloudflare-footer {
  border-top: 1px solid rgba(127, 127, 127, 0.18);
  margin-top: 4rem;
  padding: 1.5rem 1rem 3rem;
  text-align: center;
  font-size: 0.95em;
}

/* --------------------------------------------------------------------
 * The post title
 *
 * Outside .cloudflare-post, because the title is not part of the article
 * body — it is the page's h1.
 *
 * A HEADLINE NEEDS A MEASURE TOO, and a much tighter one than body text:
 * at display size, 68ch is most of a monitor. 26ch breaks a typical
 * generated headline over two or three lines, which is how a headline is
 * meant to be read.
 * ----------------------------------------------------------------- */
.cloudflare-styled h1 {
  box-sizing: border-box;
  max-width: 26ch;
  padding-left: var(--cloudflare-gutter, 0);
  line-height: 1.15;
}

/* --------------------------------------------------------------------
 * The article wrapper, and the three values everything else is built from.
 *
 * THE rgba FALLBACKS ARE NEUTRAL GREY ON PURPOSE. color-mix has been
 * supported everywhere for years, but a browser without it must still get
 * a box — and a grey at low alpha is the one value that is inoffensive on
 * a light page and on a dark one. It is a fallback, not a colour choice.
 * ----------------------------------------------------------------- */
.cloudflare-post {
  --cloudflare-accent: #1f6fd0;
  --cloudflare-tint: rgba(127, 127, 127, 0.07);
  --cloudflare-edge: rgba(127, 127, 127, 0.18);

  box-sizing: border-box;
  max-width: 78ch;
  line-height: 1.8;

  /* BIGGER THAN THE PAGE, BUT RELATIVE TO IT. em, never px, so everything
   * inside — the headings, the lead paragraph, the step badges — moves
   * with it rather than drifting out of proportion. */
  font-size: 1.1em;

  padding-left: var(--cloudflare-gutter, 0);

  /* SPACE UNDER THE TITLE, set here rather than on the first paragraph, so
   * the first element's spacing stays in step with the rest. */
  margin-top: 1.8em;
}

@supports (color: color-mix(in srgb, currentColor 5%, transparent)) {
  .cloudflare-post {
    --cloudflare-tint: color-mix(in srgb, currentColor 5%, transparent);
    --cloudflare-edge: color-mix(in srgb, currentColor 15%, transparent);
  }
}

/* Nothing above the first thing in the article. The page has already put
 * space between the title and the content. */
.cloudflare-post > :first-child {
  margin-top: 0;
  padding-top: 0;
}

/* --------------------------------------------------------------------
 * Paragraphs
 * ----------------------------------------------------------------- */
.cloudflare-post p {
  margin: 0 0 1.35em;
}

/* THE OPENING PARAGRAPH, SET LARGER.
 *
 * Two selectors because these articles come in two shapes. renderSections
 * emits a heading then its paragraphs, section after section — so a post
 * whose first section has a heading opens with an h2, and one whose first
 * section has none opens with a p. Both are the opening paragraph; neither
 * is matched by the other's selector.
 *
 * :first-child rather than :first-of-type, so this can only ever be the
 * paragraph at the very top. :first-of-type would pick the first paragraph
 * ANYWHERE after a run of headings, which on a long article is a random
 * sentence half way down suddenly rendering bigger than its neighbours. */
.cloudflare-post > p:first-child,
.cloudflare-post > h2:first-child + p {
  font-size: 1.2em;
  line-height: 1.6;
  margin-bottom: 1.7em;
}

/* --------------------------------------------------------------------
 * Headings
 *
 * The space above is larger than the space below: a heading belongs to
 * what follows it, not to what came before. Browsers set them equal, which
 * makes an article read as a flat list of blocks rather than as sections.
 *
 * NO COLOUR, AND NO RULE ABOVE — 19 October, Edwin's call, and the reason
 * this file is forked from the plugin's. On WordPress both are still
 * there. The padding-top OUTLIVES the hairline it was spacing text off:
 * with nothing drawn between the sections, the gap is what separates them.
 * ----------------------------------------------------------------- */
.cloudflare-post h2 {
  font-size: 1.62em;
  line-height: 1.2;
  letter-spacing: -0.012em;
  margin: 2.4em 0 0.55em;
  padding-top: 1.6em;
}

.cloudflare-post h3 {
  font-size: 1.18em;
  line-height: 1.35;
  margin: 2em 0 0.5em;
}

/* --------------------------------------------------------------------
 * Links
 *
 * The posts are written to carry interlinks, so links are the one element
 * guaranteed to appear and worth making legible. Underlined as well as
 * coloured — colour alone is not something every reader can see, and with
 * the headings no longer accented this is the only accent in the prose.
 * ----------------------------------------------------------------- */
.cloudflare-post a {
  color: var(--cloudflare-accent);
  text-decoration: underline;
  text-underline-offset: 0.2em;
  text-decoration-thickness: 0.08em;
}

/* A pending forward link is prose, not a link: the article it points at
 * has not been deployed yet. It must not look clickable. */
.cloudflare-post [data-il-link] {
  text-decoration: none;
  color: inherit;
}

/* --------------------------------------------------------------------
 * Lists, as boxes
 *
 * A default list sits flush with the paragraphs around it and is easy to
 * read straight past. In a tinted box it reads as the aside it usually is.
 *
 * WORTH KNOWING: renderSections only ever emits <h2> and <p>, so an
 * article has no list in it unless the owner added one in the editor.
 * These rules cost nothing while nothing matches them.
 * ----------------------------------------------------------------- */
.cloudflare-post ul,
.cloudflare-post ol {
  background: var(--cloudflare-tint);
  border: 1px solid var(--cloudflare-edge);
  border-radius: 10px;
  padding: 1.25em 1.4em;
  margin: 1.7em 0;
  list-style: none;
}

.cloudflare-post li {
  margin: 0 0 0.7em;
  line-height: 1.65;
}

.cloudflare-post li:last-child {
  margin-bottom: 0;
}

/* A small accent diamond, drawn rather than typed, so it lines up with the
 * first line of text at any font size. */
.cloudflare-post ul li {
  position: relative;
  padding-left: 1.7em;
}

.cloudflare-post ul li::before {
  content: "";
  position: absolute;
  left: 0.15em;
  top: 0.52em;
  width: 0.5em;
  height: 0.5em;
  border-radius: 2px;
  background: var(--cloudflare-accent);
  transform: rotate(45deg);
}

/* Numbered steps in accent circles. The counter is reset on the list
 * rather than relying on the browser's, because list-style is off. */
.cloudflare-post ol {
  counter-reset: cloudflare-step;
}

.cloudflare-post ol li {
  position: relative;
  padding-left: 2.4em;
  counter-increment: cloudflare-step;
}

/* THE ONLY WHITE IN THE FILE, and it sits on the accent — a digit on a
 * coloured disc, not text on the page. */
.cloudflare-post ol li::before {
  content: counter(cloudflare-step);
  position: absolute;
  left: 0;
  top: 0.12em;
  width: 1.6em;
  height: 1.6em;
  border-radius: 50%;
  background: var(--cloudflare-accent);
  color: #fff;
  font-size: 0.76em;
  font-weight: 700;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* --------------------------------------------------------------------
 * Pull quotes
 *
 * The same box as the lists, with an accent bar down the left. Also only
 * ever present on a post the owner has edited — see the note above.
 * ----------------------------------------------------------------- */
.cloudflare-post blockquote {
  margin: 1.9em 0;
  padding: 1.1em 1.3em;
  background: var(--cloudflare-tint);
  border: 1px solid var(--cloudflare-edge);
  border-left: 4px solid var(--cloudflare-accent);
  border-radius: 8px;
}

.cloudflare-post blockquote p {
  margin: 0;
  font-size: 1.03em;
  line-height: 1.6;
}

/* --------------------------------------------------------------------
 * Images
 * ----------------------------------------------------------------- */
.cloudflare-post img {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  margin: 2em 0;
}

/* --------------------------------------------------------------------
 * Narrow screens
 *
 * The measure is already a max-width so it does nothing here, but the
 * heading gap and the box padding are worth tightening: 2.4em of empty
 * space is a lot of a phone screen.
 * ----------------------------------------------------------------- */
@media (max-width: 480px) {
  .cloudflare-post h2 {
    font-size: 1.45em;
    margin-top: 1.9em;
    padding-top: 1.2em;
  }

  .cloudflare-post ul,
  .cloudflare-post ol,
  .cloudflare-post blockquote {
    padding: 1em 1.1em;
  }
}
`;

/**
 * The class names the markup uses, named once here rather than three times.
 *
 * NOT INTERPOLATED INTO THE CSS ABOVE. A stylesheet assembled out of these
 * would be unreadable and ungreppable, which is the one thing a stylesheet
 * has to be. The suite instead asserts that every name here appears both in
 * the CSS and in the rendered HTML, which is what catches a rename that
 * missed one of the two.
 */
const CLASSES = {
  body: 'cloudflare-styled',
  post: 'cloudflare-post',
  masthead: 'cloudflare-masthead',
  home: 'cloudflare-home',
  date: 'cloudflare-date',
  footer: 'cloudflare-footer',
};

/** Where it is served, and what the pages link to. */
const CSS_PATH = 'assets/blog.css';

module.exports = { CSS, CSS_PATH, CLASSES };
