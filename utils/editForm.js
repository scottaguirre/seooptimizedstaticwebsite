// utils/editForm.js
//
// The boxes for changing a built site's words.
//
//   renderSections(model, esc)  ->  the <label>s, <input>s and <textarea>s
//
//
// WHY IT LEFT routes/cloudflareSitesRoute.js — 17 November
//
// It was written there, for /cloudflare-sites/:id/edit, and it was the only
// screen that edited anything. Edwin, the same day:
//
//     *"in Rank Fast mode if I want to change something in the content
//     before exporting to wordpress or static sites with webpack at the
//     moment I don't have the option to update the content"*
//
// So there is a second screen now, over a build folder rather than over a
// published site — and the boxes are the same boxes. Ninety lines of markup
// copied into a second route is ninety lines that agree today and diverge
// the first time one of them is fixed.
//
//     THE THING BOTH SCREENS SHARE IS NOT "AN EDIT FORM". IT IS THE RULE
//     FOR TURNING A CONTENT MODEL INTO CONTROLS — which block gets a
//     heading box, where the ticked list sits among the paragraphs,
//     whether a reviews panel is drawn at all. That rule lives in
//     editableText.collect(); this renders what it returns.
//
// NEUTRAL NAME, NEUTRAL FOLDER. It is not a Cloudflare concern any more:
// utils/cloudflareSites/ is where the things that know about publishing
// live, and this knows only about a model.
//
//
// WHAT IT DOES NOT DO
//
// It does not draw the <form>, the heading, the save button or the
// explanation of the link format. Those differ between the two screens —
// one says "Edit <site name>" and saves to a published address, the other
// says "Edit your website" and saves to a folder — and a shared component
// that took eight options to describe those differences would be worse than
// two pages that each say their own thing.
//
// The CSS class `cf-edit` survives on the textareas. It is the hook the
// Cloudflare screen's grow-with-content script uses, and renaming it here
// would be a change to a second file for no gain today.

'use strict';

const editableText = require('./cloudflareSites/editableText');

/**
 * @param {object}   model  a parsed content.json, OR a localoptions source
 * @param {function} esc    the caller's HTML escaper, so the two screens
 *                          cannot escape differently
 * @param {function} [collect]  which reader to ask — editableText.collect by
 *                              default, localOptionsText.collect for a Local
 *                              Website Options site
 * @returns {string} markup for every editable block, grouped by page
 *
 * TWO READERS, ONE FORM, AND THE READER IS AN ARGUMENT RATHER THAN A BRANCH.
 *
 * The blocks are the same shape whichever reader built them — that is the
 * whole contract between this file and the two of them — so nothing below
 * this line needs to know which format it is drawing. A branch in here would
 * be a third place that has to learn about every future format.
 *
 *     A FUNCTION THAT TAKES ITS SOURCE OF DATA AS AN ARGUMENT
 *     DOES NOT NEED TO KNOW HOW MANY SOURCES THERE ARE.
 */
function renderSections(model, esc, collect = editableText.collect) {
  const blocks = collect(model);

  /* GROUPED BY PAGE, in the model's own order, because that is the order
   * the site reads in and the only way somebody finds the sentence they
   * came here to change. */
  const byPage = new Map();

  for (const block of blocks) {
    if (!byPage.has(block.pageSlug)) byPage.set(block.pageSlug, []);
    byPage.get(block.pageSlug).push(block);
  }

  /* ONE COLUMN, AT EVERY WIDTH. The boxes are full-width text; a grid
   * would only put two half-width paragraphs side by side and make both
   * harder to read. Nothing here needs a breakpoint, which is the right
   * amount of responsive layout for a form of stacked fields. */
  const sections = [...byPage.entries()].map(([slug, list]) => `
    <h2 class="h4 mt-5 mb-3">${esc(list[0].pageTitle)}</h2>
    <p class="text-white-50 small mb-3">${esc(slug)}</p>
    ${list.map(block => `
      <div class="mb-4">
        <div class="small text-white-50 mb-1">${esc(block.sectionLabel)}</div>

        ${/* THE LABEL IS THE BLOCK'S IF IT HAS ONE. Every block the
              generator produces is a section with a heading, so "Heading"
              was the only word needed. A Local Website Options site also
              offers the page's SEARCH TITLE, which sits in the same slot
              and is emphatically not a heading — calling it one would
              invite somebody to write their H2 into the <title>. */''}
        ${block.headingField ? `
          <label class="form-label small text-white-50 mb-1"
                 for="${esc(block.headingField)}">${esc(block.headingLabel || 'Heading')}</label>
          <input class="form-control mb-2" type="text"
                 id="${esc(block.headingField)}"
                 name="${esc(block.headingField)}"
                 value="${esc(block.heading)}" spellcheck="true">` : ''}

        ${block.subheadingField ? `
          <label class="form-label small text-white-50 mb-1"
                 for="${esc(block.subheadingField)}">Subheading</label>
          <input class="form-control mb-2" type="text"
                 id="${esc(block.subheadingField)}"
                 name="${esc(block.subheadingField)}"
                 value="${esc(block.subheading)}" spellcheck="true">` : ''}

        ${/* THE LIST GOES WHERE THE PAGE PUTS IT, WHICH IS BETWEEN THE TWO
              PARAGRAPHS — not after them. aboutUsTemplate.html reads
              P1, LIST, P2, and a screen that draws P1, P2, LIST is a screen
              that does not look like the thing it edits. The position comes
              from editableText.trustAfterParagraph; see the note there.

              EIGHT BOXES WHETHER OR NOT EIGHT ARE FILLED. The empty ones
              are how a claim is added and emptying a full one is how a
              claim is removed — no add button and no delete button,
              because the boxes already are both. */''}
        ${(() => {
          /* THE NAME THE READER GAVE IT, OR THE ONE THIS FILE WOULD DERIVE.
           *
           * editableText's paragraphs are always a contiguous array, so
           * `p::page::section::i` can be computed from the index and always
           * was. A localoptions block can be ONE STRING PULLED FROM A NAMED
           * KEY — a divider line, the services lede, a meta description —
           * so it carries its own names.
           *
           * COMPUTING THEM HERE REGARDLESS WOULD NOT LOOK BROKEN. The box
           * would draw, the owner would type, the save would post
           * `p::index::seo::0`, and apply() would reject a name it never
           * offered — one line in `rejected` and nothing on the screen that
           * says the description was not saved.
           *
           *     A FIELD NAME GUESSED BY THE FORM IS A GUESS ABOUT
           *     THE READER'S PRIVATE BUSINESS. */
          const nameAt = (i) => (block.paragraphFields && block.paragraphFields[i])
            || editableText.fieldName(block.pageSlug, block.sectionKey, i);

          const boxes = block.paragraphs.map((text, i) => `
            <textarea class="form-control mb-2 cf-edit"
                      name="${esc(nameAt(i))}"
                      rows="4" spellcheck="true">${esc(text)}</textarea>`);

          if (!block.trustPoints) return boxes.join('');

          const list = `
            <div class="small text-white-50 mt-3 mb-1">
              Ticked list — empty a box to remove that line, type in an empty one to add
            </div>
            ${block.trustPoints.map((text, i) => `
              <input class="form-control form-control-sm mb-1" type="text"
                     name="${esc(editableText.trustName(block.pageSlug, block.sectionKey, i))}"
                     value="${esc(text)}" spellcheck="true"
                     aria-label="Trust point ${i + 1}">`).join('')}
            <div class="mb-3"></div>`;

          const at = block.trustAfterParagraph;

          return [...boxes.slice(0, at), list, ...boxes.slice(at)].join('');
        })()}

        ${/* THE REVIEW CARDS.

              AFTER the paragraphs rather than spliced into them, because
              on the page they ARE after: the reviews section is its own
              block under the case study, not a list threaded between two
              sentences the way the ticked list is.

              FOUR CARDS WHETHER OR NOT FOUR ARE FILLED, the same bargain
              the ticked list makes — emptying the body removes that
              review and typing into an empty card adds one back. No add
              button and no delete button, because the boxes are both.

              NO STARS. There is no sensible control for a rating in a row
              of text boxes, so the stored value rides through untouched;
              see REVIEW_DEFAULT_STARS for what a re-added card gets. */''}
        ${!block.reviews ? '' : `
          <div class="small text-white-50 mt-3 mb-2">
            Reviews — empty the review to remove that card, type in an empty one to add
          </div>
          ${block.reviews.map((row, i) => `
            <div class="border border-secondary rounded p-2 mb-2">
              <textarea class="form-control form-control-sm mb-1 cf-edit"
                        name="${esc(editableText.reviewName(block.pageSlug, block.sectionKey, i))}"
                        rows="3" spellcheck="true"
                        aria-label="Review ${i + 1}">${esc(row.text)}</textarea>
              <input class="form-control form-control-sm" type="text"
                     name="${esc(editableText.reviewerName(block.pageSlug, block.sectionKey, i))}"
                     value="${esc(row.name)}" spellcheck="true"
                     placeholder="Who wrote it"
                     aria-label="Reviewer name ${i + 1}">
            </div>`).join('')}
          <div class="mb-3"></div>` }
      </div>`).join('')}`).join('');
  return sections;
}

module.exports = { renderSections };
