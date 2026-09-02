// blog-engine-preview/enrichTopic.js
//
// Fills in the machinery for a topic the owner typed themselves.
//
// A suggestion arrives complete — topic, targetQuery, linkPhrase. A typed
// topic is just a sentence, and the planner needs the other two:
//
//   targetQuery  without it, nothing can check whether this post competes with
//                the service page it is supposed to be promoting
//   linkPhrase   without it, sibling posts have no natural way to refer to
//                this one, and you are back to truncating the title into
//                "signs your water heater is"
//
// So this derives both and hands them back for the owner to edit. Most will
// never look. The ones who know what they are doing can.
//
// ONE CALL FOR THE WHOLE BATCH
//
// Enriching topics one at a time invites the model to give two of them nearly
// identical queries, because it cannot see the others. Doing the batch in one
// call lets it keep them distinct — which is the thing queryConflicts() would
// otherwise reject a minute later.

const path = require('path');

function getClient(opts) {
  if (opts.client) return opts.client;
  const mod = require(path.join(__dirname, '..', 'openaiClient'));
  return mod.getOpenAI();
}

function buildPrompt({ business, targetPage, topics, existing = [] }) {
  const intent = targetPage.intent
    || `use the business's ${targetPage.title} service`;

  const existingBlock = existing.length
    ? `\nALREADY IN THIS CAMPAIGN — your queries must not overlap these:\n` +
      existing.map(e => `  - "${e.targetQuery}"  (${e.topic})`).join('\n') + '\n'
    : '';

  return `A business owner has written these blog topics themselves. Work out the
search each one should target and how other posts should refer to it.

Do NOT rewrite their topics. They chose the words. Your job is the two fields
underneath.

BUSINESS
  Name:     ${business.name}
  Trade:    ${business.trade}
  Town:     ${business.town}
  Services: ${business.services.join(', ')}

THE PAGE THESE POSTS SUPPORT
  ${targetPage.title} — ranking for "${targetPage.keyword}".
  The reader should end up wanting to: ${intent}
${existingBlock}
THEIR TOPICS
${topics.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}

FOR EACH, RETURN
  topic        their words, unchanged
  targetQuery  the one search this post should win — what a person would type.
               Lower case, 3-7 words, no punctuation. Distinct from every other
               query here and from "${targetPage.keyword}" itself.
  linkPhrase   how another post refers to this one mid-sentence. A noun phrase
               of 3-7 words that reads naturally inside someone else's sentence.
               Not the title. For "Water heater leaking from the bottom" it
               might be "a tank leaking from the bottom".
  note         Leave empty unless something is genuinely wrong with the topic —
               it targets the service page's own search, it duplicates another
               topic here, or its natural conclusion points at a different
               service. One short sentence if so. Do not invent concerns.

Return JSON and nothing else:
{ "topics": [ { "topic": "...", "targetQuery": "...", "linkPhrase": "...", "note": "" } ] }`;
}

/**
 * @param {string[]} topics   raw topic lines the owner typed
 * @param {object}   ctx      { business, targetPage }
 * @param {object}   opts     { existing, stub, client, model, effort, verbosity }
 * @returns {Promise<Array<{topic,targetQuery,linkPhrase,note}>>}
 */
async function enrichTopics(topics, ctx, opts = {}) {
  const list = (topics || []).map(t => String(t).trim()).filter(Boolean);
  if (!list.length) return [];

  if (opts.stub) return stubEnrich(list);

  const openai = getClient(opts);

  const response = await openai.responses.create({
    model: opts.model || 'gpt-5.6-terra',
    input: buildPrompt({ ...ctx, topics: list, existing: opts.existing || [] }),
    // Same reasoning as suggestTopics: picking a query is a judgement call,
    // not transcription.
    reasoning: { effort: opts.effort || 'medium' },
    text: { verbosity: opts.verbosity || 'low' },
  });

  const { parseJson } = require('./writePost');
  const parsed = parseJson(response.output_text, 'topic enrichment');

  if (!parsed || !Array.isArray(parsed.topics)) {
    throw new Error('topic enrichment: model returned no topics array');
  }

  // The model occasionally "helps" by improving the wording. It was told not
  // to; put their words back rather than trusting it.
  return parsed.topics.map((t, i) => ({
    ...t,
    topic: list[i] !== undefined ? list[i] : t.topic,
  }));
}

/** Crude but deterministic, for offline runs. */
function stubEnrich(list) {
  const strip = s => s.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w && !['a', 'an', 'the', 'my', 'your', 'is', 'are', 'to', 'for', 'of', 'in', 'on', 'why', 'how', 'what', 'when'].includes(w));

  return list.map(topic => {
    const words = strip(topic);
    return {
      topic,
      targetQuery: words.slice(0, 6).join(' '),
      linkPhrase: words.slice(0, 5).join(' '),
      note: '',
    };
  });
}

module.exports = { enrichTopics, buildPrompt };