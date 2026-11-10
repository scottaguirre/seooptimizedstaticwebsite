// utils/leadScout/judgeDesign.js
//
// Does this website LOOK dated? Asked of the rendered page, not the markup.
//
//   const { judgeDesign } = require('./judgeDesign');
//   await judgeDesign({ desktopShot, mobileShot, businessName, trade });
//
// WHY THE MARKUP SCORER WAS NOT ENOUGH, AND THE RUN THAT PROVED IT
//
// Three trades across Austin, 77 distinct sites. NOT ONE scored 30, which is
// the weight of a missing viewport tag — so not one of them was missing it.
// Every practice in the city is already on Squarespace, Wix or a current
// WordPress theme. Flash, table layouts and fixed-width pages are a 2012
// market and that market is gone.
//
// Six of the thirteen "leads" scored 10, 12, 14 or 20 — numbers only
// reachable by adding up signals a visitor CANNOT SEE: a missing meta
// description, a footer copyright year, jQuery 1.x. Edwin looked at the
// report and said the obvious thing: these sites are not ugly.
//
//     THE SITES ARE NOT BROKEN. THEY ARE GENERIC. And "generic" is not in
//     the HTML — it is in the typography, the spacing, the stock photography
//     and the colour. You have to look at the picture.
//
//
// SO THE TWO JOBS ARE SPLIT, AND THAT SPLIT IS THE WHOLE IDEA
//
//   RANKING  — this file. A model looks at the rendered page and says how
//              dated it looks. Subjective, not quotable, and the only thing
//              that can answer the question actually being asked.
//
//   EVIDENCE — scoreSite.js, unchanged. Facts an owner can check in ten
//              seconds, for the body of the email.
//
// An earlier version of this tool refused to use a model here, on the
// grounds that "our AI thinks your site is ugly" is not a sentence you can
// send. That is true and it is an argument about the EMAIL, not about the
// SORT. Nothing from this file goes in the email.
//
//
// WHAT IT IS ASKED, AND WHY IT IS ASKED THAT WAY
//
// Not "is this ugly" — that invites a vibe, and vibes are not reproducible
// between two runs over the same list. It is asked for named, observable
// attributes, and the score has to follow from them. When the observations
// and the number disagree, the observations are the part worth reading.

'use strict';

const fs = require('fs');

const { getOpenAI } = require('../openaiClient');
const { parseModelJson } = require('../parseModelJson');

/* The project's vision-capable model. utils/generateLocationPagesContent.js
 * already calls gpt-4o through chat.completions, which is the documented
 * path for image input on the installed SDK. */
const MODEL = 'gpt-4o';

/* Low, deliberately. This is a sort key; the same site should land in the
 * same place when the list is re-run tomorrow. */
const TEMPERATURE = 0.2;

const RUBRIC = `
You are grading the VISUAL DESIGN of a local healthcare practice's website
from two screenshots: desktop (1280px) and phone (390px).

Score 0-10 for how DATED and GENERIC it looks. Higher = worse.

  0-2   current and considered: deliberate typography, generous spacing,
        a real photograph or illustration of this practice, clear hierarchy
  3-5   a competent current template. Nothing wrong, nothing distinctive.
        Stock photography, default theme fonts, familiar layout
  6-8   visibly behind: cramped or inconsistent spacing, clip-art or dated
        stock imagery, gradients/bevels/drop shadows of the 2010s, small or
        system-default type, busy colour
  9-10  looks a decade or more old: dense text, tiny fonts, clashing colour,
        centred everything, a logo in a serif with a drop shadow

Judge ONLY what you can see. Ignore load speed, SEO and code quality.

A practice's own photographs of its own premises or staff is a point in its
FAVOUR even when the layout is plain — it is the thing a template cannot buy.

Answer with JSON and nothing else:

{
  "score": 0-10,
  "era": "a rough visual era, e.g. '2024 template' or 'c. 2011'",
  "observations": ["three to five short, concrete, visual notes"],
  "verdict": "one sentence, plain, no marketing language"
}
`.trim();

function dataUrl(file) {
  return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
}

/**
 * @param {object} shot
 * @param {string} shot.desktopShot  png path, 1280 wide
 * @param {string} [shot.mobileShot] png path, 390 wide
 * @param {string} [shot.businessName]
 * @param {string} [shot.trade]
 *
 * @returns {{score, era, observations, verdict, usage}|null}
 *
 * NULL ON ANY FAILURE, NEVER A THROW. This is a sort key on a list that was
 * expensive to gather; losing the whole run because one screenshot came back
 * truncated would be the wrong trade. The caller reports how many could not
 * be judged — an unjudged site is listed as unjudged, not as a 0.
 */
async function judgeDesign({ desktopShot, mobileShot, businessName = '', trade = '' }) {
  if (!desktopShot || !fs.existsSync(desktopShot)) return null;

  const images = [desktopShot];
  if (mobileShot && fs.existsSync(mobileShot)) images.push(mobileShot);

  const content = [
    {
      type: 'text',
      text: `${RUBRIC}\n\nThis is ${businessName || 'a practice'}` +
            `${trade ? `, a ${trade}` : ''}. First image: desktop. ` +
            `${images.length > 1 ? 'Second image: the same page on a phone.' : ''}`,
    },
    ...images.map(file => ({
      type: 'image_url',
      // "low" detail is the cheap tier and is enough for an impression of
      // layout, colour and type. This is not reading the small print.
      image_url: { url: dataUrl(file), detail: 'low' },
    })),
  ];

  let response;
  try {
    response = await getOpenAI().chat.completions.create({
      model: MODEL,
      temperature: TEMPERATURE,
      messages: [{ role: 'user', content }],
    });
  } catch (err) {
    return { error: err.message };
  }

  const raw = (response.choices?.[0]?.message?.content || '').trim();

  const cleaned = raw
    .replace(/```json|```/g, '')
    .replace(/^[^{]*\{/, '{')
    .replace(/\}[^}]*$/, '}')
    .trim();

  const parsed = parseModelJson(cleaned, { expect: 'object', label: 'design judgement' });
  if (!parsed.ok) return { error: `unparseable answer: ${parsed.error.message}` };

  const d = parsed.data || {};
  const score = Number(d.score);

  if (!Number.isFinite(score)) return { error: 'no score in the answer' };

  return {
    score: Math.max(0, Math.min(10, score)),
    era: String(d.era || '').slice(0, 60),
    observations: Array.isArray(d.observations)
      ? d.observations.slice(0, 5).map(o => String(o).slice(0, 160))
      : [],
    verdict: String(d.verdict || '').slice(0, 240),
    usage: response.usage || null,
    error: null,
  };
}

module.exports = { judgeDesign, RUBRIC, MODEL };
