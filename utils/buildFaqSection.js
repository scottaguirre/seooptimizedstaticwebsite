// utils/buildFaqSection.js
//
// Renders the FAQ block for the home page, plus its FAQPage JSON-LD.
//
// The markup reuses the same container and spacing classes as the generated
// sections, so the chosen theme styles it without any new CSS. It uses a
// Bootstrap accordion, which is already available.

const { escapeAttr } = require('./helpers');

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * FAQ markup. Returns '' when there are no answers, so the template simply
 * has nothing where the section would be.
 */
function buildFaqSection(faqs = [], heading = 'Frequently Asked Questions') {
  const items = (faqs || []).filter(f => f && f.question && f.answer);
  if (!items.length) return '';

  // Two columns: first half left, second half right. With six questions that
  // is 3/3; an odd count puts the extra one on the left. Below the lg
  // breakpoint the columns stack, so mobile still reads as one list.
  const half = Math.ceil(items.length / 2);
  const columns = [items.slice(0, half), items.slice(half)].filter(col => col.length);

  const renderItem = (faq, id) => `
            <div class="accordion-item">
              <h3 class="accordion-header" id="faqHeading${id}">
                <button class="accordion-button collapsed" type="button"
                        data-bs-toggle="collapse" data-bs-target="#faqCollapse${id}"
                        aria-expanded="false" aria-controls="faqCollapse${id}">
                  ${escapeHtml(faq.question)}
                </button>
              </h3>
              <div id="faqCollapse${id}" class="accordion-collapse collapse"
                   aria-labelledby="faqHeading${id}">
                <div class="accordion-body">
                  <p>${escapeHtml(faq.answer)}</p>
                </div>
              </div>
            </div>`;

  let index = 0;
  const columnHtml = columns.map(col => {
    const rows = col.map(faq => renderItem(faq, index++)).join('');
    return `
        <div class="col-lg-6">
          <div class="accordion faq-accordion">${rows}
          </div>
        </div>`;
  }).join('');

  return `
<section class="faq-section">
  <div class="container section-padding">
    <div class="row">
      <div class="col-12">
        <h2>${escapeHtml(heading)}</h2>
      </div>
    </div>
    <div class="row g-3">${columnHtml}
    </div>
  </div>
</section>`;
}

/**
 * FAQPage JSON-LD. This is what can produce expandable FAQ results in Google,
 * so it is worth emitting whenever there is an FAQ at all.
 */
function buildFaqSchema(faqs = []) {
  const items = (faqs || []).filter(f => f && f.question && f.answer);
  if (!items.length) return '';

  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(faq => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  });
}

/**
 * The <script> tag to drop into <head>. Empty string when there is no FAQ.
 */
function buildFaqSchemaTag(faqs = []) {
  const json = buildFaqSchema(faqs);
  if (!json) return '';
  return `<script type="application/ld+json">${json}</script>`;
}

module.exports = { buildFaqSection, buildFaqSchema, buildFaqSchemaTag, escapeHtml };