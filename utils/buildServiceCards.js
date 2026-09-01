// utils/buildServiceCards.js
//
// Six service cards for the home page.
//
// They sit underneath the existing Services paragraphs rather than replacing
// them: the prose stays for search engines and readers who want detail, the
// cards give a scannable summary of the same services. Overlap between the
// two is expected and fine.
//
// Icons are inline SVG — no icon font, no external request, no extra HTTP
// call on the most important page. They are deliberately business-neutral
// shapes (shield, clock, badge...) so the same set suits a plumber, a tree
// service or a law firm without implying the wrong trade.

// getOpenAI() builds the client on first use rather than at module load:
// constructing OpenAI without a key throws, which would stop the server
// booting instead of just skipping the cards.
const { getOpenAI } = require('./openaiClient');
const { parseModelJson } = require('./parseModelJson');

const CARD_COUNT = 6;

/**
 * Neutral icons, cycled in order. 24x24 viewBox, currentColor stroke, so each
 * theme colours them through CSS rather than needing a variant per theme.
 */
const ICONS = [
  // check in a circle — "done properly"
  '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
  // shield — "protected / guaranteed"
  '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"/>',
  // clock — "fast / on time"
  '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  // star — "quality"
  '<path d="M12 4l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 9.7l5.4-.8L12 4z"/>',
  // badge / award — "certified"
  '<circle cx="12" cy="9" r="5"/><path d="M8.5 13.5L7 21l5-2.5L17 21l-1.5-7.5"/>',
  // thumbs up — "satisfaction"
  '<path d="M7 21V10l4.5-7 .8.4a2 2 0 011 2.3L12.5 9H19a2 2 0 012 2.3l-1.2 7A2 2 0 0117.8 20H7z"/><path d="M7 10H4v11h3"/>',
];

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPrompt({ businessType, businessName, location }) {
  return `
List the ${CARD_COUNT} services most commonly offered by a local ${businessType} business.

Context: the business is "${businessName}", serving ${location}.

For each service give:
- "name": the service, 2-4 words, title case (e.g. "Water Heater Repair")
- "line": one short benefit-focused sentence, 8-14 words, no full stop at the end

Rules:
- Real services a customer would search for, not marketing slogans.
- Do not repeat a service under two different names.
- Do not mention the business name or the city.
- Plain text only: no markdown, no emoji, no numbering.

Return ONLY a JSON array of ${CARD_COUNT} objects:

[{ "name": "...", "line": "..." }]
`.trim();
}

/**
 * @returns {Promise<Array<{name: string, line: string}>>}
 *          [] on any failure — cards are an enhancement, never a reason for a
 *          generation to fail.
 */
async function generateServiceCards({ businessType, businessName, location }) {
  if (!businessType) return [];

  try {
    // buildPrompt() has to actually run. `input: prompt` referenced a
    // variable that was never created, so every call threw "prompt is not
    // defined" and the cards were silently skipped.
    const prompt = buildPrompt({ businessType, businessName, location });

    // responses.create, NOT chat.completions.create: `input`, `reasoning` and
    // `text` are Responses API parameters. The chat endpoint ignores them,
    // expects `messages`, and returns a differently shaped object with no
    // output_text — so this would have failed even once the prompt existed.
    const response = await getOpenAI().responses.create({
      model: 'gpt-5.6-terra',
      input: prompt,
      reasoning: { effort: 'none' },
      text: { verbosity: 'medium' },
    });

    console.log('buildServiceCards usage:', response.usage);

    const raw = response.output_text.trim();

    const cleaned = raw
      .replace(/```json|```/g, '')
      .replace(/^[^\[]*\[/, '[')
      .replace(/\][^\]]*$/, ']')
      .trim();

    // Tolerant parse: the model sometimes emits an unescaped quote inside a
    // value, which breaks JSON.parse. These sections fail soft, but a repair
    // means the user gets the content rather than an empty section.
    const parseResult = parseModelJson(cleaned, { expect: 'array', label: 'service cards' });
    if (!parseResult.ok) throw parseResult.error;
    const parsed = parseResult.data;
    if (!Array.isArray(parsed)) throw new Error('Model did not return an array');

    const cards = parsed
      .map(item => ({
        name: String((item && item.name) || '').trim(),
        line: String((item && item.line) || '').trim(),
      }))
      .filter(card => card.name)
      .slice(0, CARD_COUNT);

    console.log(`   Service cards generated: ${cards.length}`);
    return cards;

  } catch (err) {
    console.warn('   ⚠️ Could not generate service cards:', err.message);
    return [];
  }
}

/**
 * The card grid. Returns '' when there are no cards, so the Services section
 * simply keeps its paragraphs and nothing else changes.
 *
 * 3 columns on desktop, 2 on tablet, 1 on mobile.
 */
function buildServiceCards(cards = []) {
  const items = (cards || []).filter(c => c && c.name);
  if (!items.length) return '';

  const cardHtml = items.map((card, i) => {
    const icon = ICONS[i % ICONS.length];

    return `
        <div class="col-md-6 col-lg-4">
          <div class="service-card h-100">
            <span class="service-card-icon" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32"
                   fill="none" stroke="currentColor" stroke-width="1.6"
                   stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
            </span>
            <h3 class="service-card-title">${escapeHtml(card.name)}</h3>
            ${card.line ? `<p class="service-card-text">${escapeHtml(card.line)}</p>` : ''}
          </div>
        </div>`;
  }).join('');

  return `
    <div class="row service-cards">${cardHtml}
    </div>`;
}

module.exports = { generateServiceCards, buildServiceCards, CARD_COUNT, ICONS };