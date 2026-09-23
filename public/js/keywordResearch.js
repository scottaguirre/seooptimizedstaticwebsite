// public/js/keywordResearch.js
//
// The keyword research page: two modes, one table.
//
// THE TWO MODES ASK DIFFERENT QUESTIONS OF DIFFERENT ENDPOINTS
//
//   Browse a category — a trade and a town, thousands of terms back, filtered
//     down to the ones somebody about to hire would type.
//   Look up one term — exactly the words given, exactly one number back, and
//     nothing filtered out. If it is 10 a month it says 10 a month.
//
// Only the fields differ on screen; routes/keywordResearchRoute.js decides
// which endpoint to call from the `mode` in the body.
//
// WHY THE EMPTY CASES GET MOST OF THIS FILE
//
// An empty table means five different things and they are not interchangeable:
//
//   - the minimum is set higher than anything this town has, which is a knob
//     the customer can turn;
//   - the buyer-intent filter took everything, which is a different knob;
//   - Google will not report on the exact term asked for;
//   - the town genuinely has nothing, which it cannot;
//   - something broke.
//
// Shown as one blank table they look identical, and the customer concludes
// the tool is broken in all five cases. So each says what it is.

(function () {
  'use strict';

  const form = document.getElementById('keywordForm');
  if (!form) return;

  const locationInput = document.getElementById('kwLocation');
  const categoryInput = document.getElementById('kwCategory');
  const categoryHelp = document.getElementById('kwCategoryHelp');
  const termsInput = document.getElementById('kwTerms');
  const minInput = document.getElementById('kwMinVolume');
  const relatedInput = document.getElementById('kwRelated');
  const showAllInput = document.getElementById('kwShowAll');
  const button = document.getElementById('kwSearch');
  const note = document.getElementById('kwNote');
  const results = document.getElementById('kwResults');

  const modeInputs = Array.from(document.querySelectorAll('input[name="kwMode"]'));

  /**
   * Every block that belongs to only some modes, with the modes it belongs
   * to.
   *
   * A LIST, not a single mode. The first version marked blocks "category" and
   * hid them anywhere else, which worked while the Industry box was shared by
   * every mode. It is not any more: Industry belongs to two modes and the
   * Keywords textarea to one, and a single-value marker cannot say that.
   */
  const modeBlocks = Array.from(document.querySelectorAll('[data-modes]')).map(el => ({
    el,
    modes: (el.getAttribute('data-modes') || '').trim().split(/\s+/).filter(Boolean),
  }));

  function currentMode() {
    const picked = modeInputs.find(i => i.checked);
    const value = picked ? picked.value : '';

    return value === 'exact' || value === 'pairs' ? value : 'category';
  }

  /**
   * Swap the form to match the mode.
   *
   * The one field both modes share changes its MEANING, so it changes its
   * label too: "Industry" asks for a category to expand, "Keyword" asks for
   * the exact words. Leaving it as "Industry" in exact mode would invite
   * somebody to type "plumbing" and then wonder why one row came back.
   */
  function applyMode() {
    const mode = currentMode();

    // The minimum, the related terms and the show-everything box belong to
    // category mode alone; Industry to category and pairs; the Keywords
    // textarea to exact. Pairs mode filters nothing on purpose — an
    // unanswered pairing is one of its most useful rows.
    modeBlocks.forEach(({ el, modes }) => {
      el.hidden = !modes.includes(mode);
    });

    if (categoryHelp) {
      categoryHelp.textContent = mode === 'pairs'
        ? 'We pair every part of the trade with the town'
        : 'plumbing, roofing, web design…';
    }
  }

  modeInputs.forEach(input => input.addEventListener('change', applyMode));
  applyMode();

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /** 2900 -> "2,900". Thousands separators, because 2900 reads as 290. */
  function number(value) {
    return value == null ? '—' : Number(value).toLocaleString('en-US');
  }

  /** 10.42 -> "$10.42". A missing bid is unknown, not free. */
  function money(value) {
    return value == null ? '—' : '$' + Number(value).toFixed(2);
  }

  /** "Austin,Texas,United States" -> "Austin, TX" for the heading. */
  function shortPlace(value) {
    const parts = String(value || '').split(',').map(p => p.trim());
    if (parts.length < 2) return value || '';
    return `${parts[0]}, ${parts[1]}`;
  }

  /**
   * The count beside the heading.
   *
   * BOTH NUMBERS WHEN A MINIMUM IS SET, which is the whole point. The earlier
   * version showed only "3 above 200/month" and hid the total, so a thin
   * table read as a broken tool — when in fact 500 keywords had come back and
   * the customer's own minimum had removed 497 of them. Showing the
   * denominator turns "this is broken" into "my filter is strict", which is
   * the true statement and also the actionable one.
   */
  function countLine(data) {
    const total = number(data.total);

    // ONE TERM ASKED AND ANSWERED has no denominator worth showing. "1 of 1
    // have a figure" is noise dressed as data.
    if (data.mode === 'exact' && data.total === 1 && data.answered === 1) {
      return 'Exact match';
    }

    // Otherwise the ratio that matters: of everything we checked, how much
    // Google will actually report on. A customer seeing "12 of 38 have a
    // figure" understands the dashes instead of mistrusting them.
    if (data.mode === 'exact' || data.mode === 'pairs') {
      return `${number(data.answered)} of ${number(data.total)} have a figure`;
    }

    const parts = [];

    // The narrowing, in the order it happened, so the customer can see which
    // knob to turn. Only the steps that actually removed something are shown
    // — a chain of identical numbers explains nothing.
    if (data.minVolume) {
      parts.push(`${number(data.aboveMinimum)} above ${number(data.minVolume)}/month`);
    }

    if (data.intent && data.buyerIntent != null && data.buyerIntent !== data.total) {
      parts.push(`${number(data.buyerIntent)} with buying intent`);
    }

    parts.push(`${total} keywords found`);

    return parts.join(' · ');
  }

  /** The seeds actually sent, so the width of the net is visible. */
  function seedLine(seeds, mode) {
    // In exact mode the one seed IS the one row, and in pairs mode the seeds
    // ARE the rows. Repeating them above the table says nothing the table
    // does not already say.
    if (mode === 'exact' || mode === 'pairs') return '';

    if (!Array.isArray(seeds) || !seeds.length) return '';

    return `
      <div class="mb-3">
        <div class="form-text mb-1" style="color:rgba(255,255,255,.5);">
          Searched around:
        </div>
        ${seeds.map(s => `<span class="seed-chip">${escapeHtml(s)}</span>`).join('')}
      </div>`;
  }

  function message(text) {
    results.innerHTML =
      `<div class="research-card p-4"><p class="m-0">${escapeHtml(text)}</p></div>`;
  }

  /**
   * The heading over the table.
   *
   * "Top 25" is a claim about a ranking. In exact mode there is no ranking —
   * there is one term and its number — so saying "Top 1" would be quietly
   * absurd.
   */
  function heading(data, shown, place) {
    if (data.mode === 'exact') return `In ${place}`;
    // Not "Top N" either: this list is not ranked, it is exhaustive. Every
    // pairing asked about is on it, including the ones with no answer.
    if (data.mode === 'pairs') return `With the town in the search`;
    return `Top ${shown} for ${place}`;
  }

  function render(data) {
    const rows = Array.isArray(data.rows) ? data.rows : [];
    const place = shortPlace(data.location);
    const exact = data.mode === 'exact';

    // EXACT MODE, NOTHING ANSWERED. Google declines to report on terms below
    // roughly ten searches a month; it is not that the term is unsearched, it
    // is that the number is too small for Google to stand behind. Saying
    // which is the difference between a useful answer and an apparent
    // malfunction.
    //
    // Only when EVERY term came back blank. With several terms, a mix of
    // answers and dashes is the normal result and belongs in the table.
    if (exact && !data.answered) {
      const many = rows.length > 1;

      message(
        (many
          ? `Google has no figure for any of those ${number(rows.length)} terms in ${place}. `
          : `Google has no figure for that term in ${place}. `)
        + 'That means fewer than about ten searches a month — too few for '
        + 'Google to report, not necessarily zero. Check the spelling, or try '
        + 'the words a customer would use rather than the trade would.'
      );
      return;
    }

    // PAIRS MODE, NOTHING ANSWERED. Every pairing came back blank, which in a
    // very small town is the true answer and a useful one.
    if (data.mode === 'pairs' && rows.length && !data.answered) {
      message(
        `We checked ${number(data.total)} ways of putting the town in the search `
        + `and Google reports a figure for none of them. In a town this size that `
        + `usually means people search without naming it — try "Browse a category" `
        + `and look for the "near me" terms instead.`
      );
      return;
    }

    // NOTHING AT ALL. The town is in Google's list but the trade is not
    // searched there, or the trade was misspelled.
    if (!data.total) {
      message(
        `No keywords came back for that industry in ${place}. `
        + 'Try a broader word — "plumbing" rather than "slab leak detection" — '
        + 'or check the spelling.'
      );
      return;
    }

    // THE INTENT FILTER TOOK EVERYTHING. A different knob from the minimum,
    // and it has to name itself or the customer turns the wrong one.
    if (!rows.length && data.intent && !data.buyerIntent) {
      message(
        `${number(data.total)} keywords came back for ${place}, but none of them `
        + 'look like somebody about to hire — they read as people researching. '
        + 'Tick "Show everything" to see them anyway.'
      );
      return;
    }

    // THE MINIMUM IS THE PROBLEM, and saying so turns a dead end into a knob.
    if (!rows.length) {
      message(
        `Nothing above ${number(data.minVolume)} searches a month in ${place}. `
        + `There are ${number(data.total)} keywords here — lower the minimum to see them, `
        + 'or try a bigger city.'
      );
      return;
    }

    const shown = rows.length;

    results.innerHTML = `
      <div class="research-card p-4">
        <div class="d-flex flex-wrap justify-content-between align-items-baseline mb-3 gap-2">
          <h2 class="h5 m-0">${escapeHtml(heading(data, shown, place))}</h2>
          <span class="form-text m-0" style="color:rgba(255,255,255,.6);">
            ${escapeHtml(countLine(data))}
          </span>
        </div>

        ${seedLine(data.seeds, data.mode)}

        <div class="table-responsive">
          <table class="table table-striped table-borderless align-middle m-0">
            <thead>
              <tr>
                <th scope="col">Term</th>
                <th scope="col" class="num">Searches / month</th>
                <th scope="col" class="num">Cost per click</th>
                <th scope="col" class="num">Lowest bid</th>
                <th scope="col" class="num">Highest bid</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td>
                    ${escapeHtml(r.keyword)}
                    ${r.variants
                      ? `<span class="variant-note">+${number(r.variants)} wording${r.variants === 1 ? '' : 's'}</span>`
                      : ''}
                  </td>
                  <td class="num">${number(r.volume)}</td>
                  <td class="num">${money(r.cpc)}</td>
                  <td class="num">${money(r.low)}</td>
                  <td class="num">${money(r.high)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>

        <p class="form-text mt-3 mb-0" style="color:rgba(255,255,255,.5);">
          Lowest and highest bid are what advertisers pay at the top of the
          page &mdash; the range of the market, where cost per click is the
          middle of it.${(data.mode === 'pairs' || data.mode === 'exact')
            && data.answered < data.total
            ? ' A dash in the searches column means Google will not report on'
              + ' that phrase &mdash; under about ten a month, not necessarily zero.'
            : ''}
        </p>
      </div>`;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const mode = currentMode();
    const location = locationInput.value.trim();
    const category = categoryInput.value.trim();
    const terms = termsInput ? termsInput.value.trim() : '';
    const minVolume = Number(minInput.value) || 0;
    const related = relatedInput ? relatedInput.value.trim() : '';
    const showAll = !!(showAllInput && showAllInput.checked);

    // Exact mode reads the textarea; the other two read the Industry box.
    // Checking the wrong one would block a valid search or send an empty one.
    if (!location || (mode === 'exact' ? !terms : !category)) {
      note.textContent = mode === 'exact'
        ? 'Fill in the city and at least one keyword.'
        : 'Fill in the city and the industry.';
      return;
    }

    button.disabled = true;
    const label = button.textContent;
    button.innerHTML =
      '<span class="spinner-border spinner-border-sm me-2"></span>Looking&hellip;';
    note.textContent = '';

    try {
      const csrf = document
        .querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';

      const res = await fetch('/api/keyword-ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        // minVolume, related and showAll are sent in exact mode too and
        // ignored there by the server. Stripping them here would mean the
        // page and the route both had to agree on which fields belong to
        // which mode, and they would drift.
        body: JSON.stringify({
          mode, location, category, terms, minVolume, related, showAll,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // The server's wording, not a generic one: it knows whether the town
        // was unusable, the industry was missing, or the lookup failed.
        message(data.error || 'Could not look up keywords just now.');
        return;
      }

      render(data);

    } catch (err) {
      message('Could not reach the server. Check your connection and try again.');
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  });
})();
