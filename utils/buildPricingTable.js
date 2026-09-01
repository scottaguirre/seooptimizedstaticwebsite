// utils/buildPricingTable.js
//
// A "typical pricing" table for the home page.
//
// IMPORTANT FRAMING: these figures are generated, not supplied by the
// business. So the section is deliberately worded as typical ranges for the
// area rather than as the company's own price list, and it carries a clear
// estimate notice. A visitor who turns up expecting the low figure and is
// quoted three times that is the business owner's problem — and it came from
// here, so the wording has to be honest about what the numbers are.
//
// In WordPress every row is editable, so an owner can replace the estimates
// with their real figures.

// The shared lazy client, rather than a fourth private copy of the same
// helper. Created on first use: constructing OpenAI without a key throws,
// which would stop the server booting instead of skipping one section.
const { getOpenAI } = require('./openaiClient');
const { parseModelJson } = require('./parseModelJson');

const ROW_COUNT = 6;

// The notice deliberately avoids the word "depend" and names the actual
// drivers of price instead, which reads as more concrete anyway.
const DEFAULT_NOTICE =
  'The figures above are typical ranges for this area and are provided for ' +
  'planning purposes only. Final cost varies with the size of the job, the ' +
  'materials selected, access and site conditions, and current supply prices. ' +
  'Contact us for a free, no-obligation quote for your property.';

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 1250 -> "$1,250" */
function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  return '$' + Math.round(n).toLocaleString('en-US');
}


/* -------------------------------------------------------------------------
 * The prompt
 * ---------------------------------------------------------------------- */

function buildPrompt({ businessType, location }) {
  return `
You are producing a typical price guide for a local ${businessType} business serving ${location}.

List the ${ROW_COUNT} services customers most often ask about pricing for.

For each service give:
- "name": the service, 2-5 words, title case (e.g. "Water Heater Installation")
- "low":  the low end of a typical price, a whole number in US dollars, no symbols or commas
- "high": the high end of a typical price, a whole number in US dollars, no symbols or commas
- "unit": how the price is charged — one of "per job", "per hour", "per unit", "per sq ft", "per linear ft"
- "note": one short clause, 4-9 words, naming what moves the price within that range
          (e.g. "tank size and venting requirements")

Rules:
- Use realistic mid-2020s US market rates for ${location}. Do not lowball to look attractive.
- "high" must be meaningfully greater than "low" — a real range, not a token spread.
- Pick services with genuinely different price points, not six variations of one job.
- Do NOT use the word "depend" or "depends" anywhere.
- No sentences in "note" — a clause only, no leading capital, no full stop.
- Plain text only: no markdown, no currency symbols, no ranges inside a single field.

Return ONLY a JSON array of ${ROW_COUNT} objects:

[{ "name": "...", "low": 0, "high": 0, "unit": "per job", "note": "..." }]
`.trim();
}


/* -------------------------------------------------------------------------
 * Generation
 * ---------------------------------------------------------------------- */

const VALID_UNITS = ['per job', 'per hour', 'per unit', 'per sq ft', 'per linear ft'];

/**
 * @returns {Promise<Array<{name,low,high,unit,note}>>}
 *          [] on any failure — pricing is an enhancement, never a reason for
 *          a generation to fail.
 */
async function generatePricing({ businessType, location }) {
  if (!businessType) return [];

  try {
    // buildPrompt() has to actually run and be assigned. Passing
    // `input: prompt` without this line throws "prompt is not defined" and
    // the pricing table is silently skipped.
    const prompt = buildPrompt({ businessType, location });

    // responses.create, NOT chat.completions.create: `input`, `reasoning` and
    // `text` belong to the Responses API. The chat endpoint expects
    // `messages` and returns choices[] with no output_text.
    const response = await getOpenAI().responses.create({
      model: 'gpt-5.6-terra',
      input: prompt,
      // 'none' rather than 'low': these are plausible price ranges, not
      // reasoning problems, and reasoning tokens are billed as output.
      reasoning: { effort: 'none' },
      text: { verbosity: 'medium' },
    });

    console.log('buildPricingTable usage:', response.usage);

    const raw = response.output_text.trim();

    const cleaned = raw
      .replace(/```json|```/g, '')
      .replace(/^[^\[]*\[/, '[')
      .replace(/\][^\]]*$/, ']')
      .trim();

    // Tolerant parse: the model sometimes emits an unescaped quote inside a
    // value, which breaks JSON.parse. These sections fail soft, but a repair
    // means the user gets the content rather than an empty section.
    const parseResult = parseModelJson(cleaned, { expect: 'array', label: 'pricing table' });
    if (!parseResult.ok) throw parseResult.error;
    const parsed = parseResult.data;
    if (!Array.isArray(parsed)) throw new Error('Model did not return an array');

    const rows = parsed
      .map(item => {
        const low = Number(item && item.low);
        const high = Number(item && item.high);
        const unit = String((item && item.unit) || '').trim().toLowerCase();

        return {
          name: String((item && item.name) || '').trim(),
          low,
          high,
          unit: VALID_UNITS.includes(unit) ? unit : 'per job',
          // belt and braces: the prompt forbids "depend", strip it if it slips through
          note: String((item && item.note) || '').trim().replace(/\bdepends?\b/gi, 'varies'),
        };
      })
      // Drop anything unusable rather than rendering "$NaN" or an inverted range
      .filter(r => r.name && Number.isFinite(r.low) && Number.isFinite(r.high) && r.high > r.low && r.low > 0)
      .slice(0, ROW_COUNT);

    console.log(`   Pricing rows generated: ${rows.length}`);
    return rows;

  } catch (err) {
    console.warn('   ⚠️ Could not generate pricing table:', err.message);
    return [];
  }
}


/* -------------------------------------------------------------------------
 * Markup
 * ---------------------------------------------------------------------- */

/**
 * The pricing section. Returns '' when there are no rows, so the page simply
 * has nothing where the section would be.
 *
 * A real <table> is used rather than a grid of divs: this is tabular data,
 * screen readers announce the column headers with each cell, and it degrades
 * sensibly without CSS.
 */
function buildPricingTable(rows = [], options = {}) {
  const items = (rows || []).filter(r => r && r.name && r.low && r.high);
  if (!items.length) return '';

  const heading = options.heading || 'Typical Service Pricing';
  const notice = options.notice || DEFAULT_NOTICE;

  const body = items.map(row => {
    return `
              <tr>
                <th scope="row" class="pricing-service">
                  ${escapeHtml(row.name)}
                  ${row.note ? `<span class="pricing-note">${escapeHtml(row.note)}</span>` : ''}
                </th>
                <td class="pricing-range">
                  <span class="pricing-amount">${money(row.low)} &ndash; ${money(row.high)}</span>
                  ${row.unit ? `<span class="pricing-unit">${escapeHtml(row.unit)}</span>` : ''}
                </td>
              </tr>`;
  }).join('');

  return `
<section class="pricing-section">
  <div class="container section-padding">
    <div class="row">
      <!-- Narrower than the prose sections and centred: the table has only
           two columns, so at col-lg-10 the price sat a long way from the
           service name. mx-auto gives it equal margins either side. -->
      <div class="col-lg-8 mx-auto">
        <h2>${escapeHtml(heading)}</h2>

        <div class="table-responsive">
          <table class="pricing-table">
            <caption class="visually-hidden">
              Typical price ranges for commonly requested services
            </caption>
            <thead>
              <tr>
                <th scope="col">Service</th>
                <th scope="col">Typical Range</th>
              </tr>
            </thead>
            <tbody>${body}
            </tbody>
          </table>
        </div>

        <p class="pricing-disclaimer">
          <strong>Estimates only.</strong> ${escapeHtml(notice)}
        </p>
      </div>
    </div>
  </div>
</section>`;
}

module.exports = {
  generatePricing,
  buildPricingTable,
  buildPrompt,
  DEFAULT_NOTICE,
  ROW_COUNT,
};