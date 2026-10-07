// utils/blog/keywordCoverage.js
//
// Is a post's own keyword present where it has to be?
//
// WHAT THIS IS FOR
//
// Every post — pillar or silo — has one keyword: the "Main keyword of this
// post" its owner typed. Edwin's rule, 6 October: that keyword must be
// INCLUDED in the title tag, the meta description, the H1 and at least one
// H2, and must appear in the body EXACTLY ONCE.
//
// EXACTLY, NOT AT MOST — Edwin, 7 October. "A post that never mentions it in
// the body fails and gets rewritten." Both readings of "only once" were open
// and he closed this one: a body that never says the phrase is a failure, not
// a clean post that happened to stay under a ceiling.
//
// INCLUDED, NOT VERBATIM, AND THAT IS THE WHOLE DESIGN.
//
// Demanding the exact phrase four times produces copy that reads like 2012.
// So the test is: every CONTENT word of the keyword appears somewhere in that
// element, in any order. "mortgage interest rate change notice" is satisfied
// by "What Your Mortgage Interest Rate Change Notice Must Tell You" and not by
// "What the letter actually means". The words must be there; the sentence
// around them is free.
//
// WHY ONE FILE
//
// writePost.js has to ASK for this and qualityCheck.js has to VERIFY it, and
// a prompt whose rule differs by one word from the check that enforces it is
// the failure this project has hit more than any other — eight SEO filter
// names with one wired wrong, trade/town against type/location, a ring rule
// right for every size but two. One function, two callers, no second opinion.

/* STOPWORDS — the glue. Nobody searches for "the", and demanding it in an H2
 * would fail "Business Loans to Women" for saying "to" where the keyword said
 * "for".
 *
 * WITHOUT, NO and NOT ARE DELIBERATELY ABSENT. They invert meaning: treat
 * "without" as glue and "loans with credit check" satisfies "loans without
 * credit check", which is the opposite page. A stopword list is a list of
 * words that carry no meaning, and those three carry the most. */
const STOPWORDS = new Set([
  'a', 'an', 'the',
  'and', 'or',
  'of', 'for', 'to', 'in', 'on', 'at', 'by', 'from', 'with', 'as',
  'is', 'are', 'be', 'was', 'were',
  'your', 'you', 'my', 'it', 'its', 'that', 'this', 'their',

  /* VS AND VERSUS ARE CONNECTORS, added 7 October from a live refusal.
   *
   *   keyword  "business bankruptcy vs personal bankruptcy"
   *   heading  "Personal and Business Bankruptcies Leave Different Lending
   *            Records"
   *
   * That heading carries business, bankruptcy and personal, and failed on
   * "vs" alone — after a retry that could not fix it either. A comparison
   * whose two sides are both named IS the comparison; demanding the literal
   * token is demanding a typographic choice between "vs", "versus", "and"
   * and a colon.
   *
   * THIS DOES NOT WEAKEN THE CHECK, because the thing being compared is still
   * required on both sides. "Personal Bankruptcy Explained" still fails for
   * missing "business". The word that carries no information is the one
   * between them.
   *
   * NOT THE SAME CASE AS without / no / not, three lines of comment below.
   * Those invert the meaning — drop "without" and the phrase becomes the
   * opposite page. Drop "vs" from a heading that names both sides and the
   * meaning is untouched. */
  'vs', 'versus',

  /* AFTER AND BEFORE — Edwin, 7 October, and this one is a KNOWING TRADE
   * rather than a bug fix. Said plainly because the next reader deserves to
   * know what it cost.
   *
   * WHAT PROMPTED IT. A published post failed twice, retry included, on:
   *
   *     meta description is missing: after
   *
   *   keyword  "ucc lien after bankruptcy"
   *   meta     "A bankruptcy discharge can clear personal liability while a
   *            UCC lien filing remains tied to business collateral."
   *
   * That sentence says the thing. It carries ucc, lien and bankruptcy, and the
   * "after" is in "discharge … remains" rather than in a preposition. Demanding
   * the token costs a retry and, when the retry also declines, ships a post
   * marked failed for a sentence that is right.
   *
   * WHAT IT COSTS, AND IT IS REAL. A title reading "UCC Liens BEFORE
   * Bankruptcy" now satisfies a keyword of "ucc lien after bankruptcy". There
   * is a test below that states exactly that, so it is recorded rather than
   * discovered.
   *
   * WHY THAT IS ACCEPTABLE HERE AND "without" IS NOT. This function asks
   * whether the element CONTAINS the words of a keyword the writer was handed
   * in the same prompt, alongside the topic. A model told to write about UCC
   * liens surviving a discharge does not write "before" by accident. "loans
   * with credit check" against "loans WITHOUT credit check" is a different
   * animal: that is a claim inverted into the opposite offer, and it is a slip
   * a model makes while trying to sound positive.
   *
   * BOTH, NOT JUST "after". Edwin asked for "after". Listing one and not the
   * other means "loan before bankruptcy" still demands its preposition while
   * "loan after bankruptcy" does not — an inconsistency nobody could predict
   * from the outside, and worse than either answer on its own. */
  'after', 'before',
]);

/* IRREGULAR PLURALS, because the suffix rule below cannot reach them.
 *
 * "How a Woman-Owned Business Gets a Loan Approved" covers "business loans for
 * women" by any honest reading, and fails on woman/women alone. A checker that
 * rejects good writing gets switched off, so the ten irregulars that actually
 * occur in service and finance copy are listed rather than argued about. */
const IRREGULAR = new Map([
  ['women', 'woman'], ['men', 'man'], ['children', 'child'],
  ['people', 'person'], ['feet', 'foot'], ['teeth', 'tooth'],
  ['mice', 'mouse'], ['geese', 'goose'], ['wives', 'wife'],
  ['lives', 'life'], ['leaves', 'leaf'], ['knives', 'knife'],
]);

/**
 * Every form one word could be matched by — a SET, not a single stem.
 *
 * A SINGLE STEM WAS THE FIRST DESIGN AND IT WAS WRONG. The smoke test caught
 * it on the first run: "notices" reduced to "notic" while "notice" stayed
 * "notice", so a heading saying "notices" would not satisfy a keyword saying
 * "notice" — the exact inflection the rule promises to allow. The same crack
 * runs through every silent-e verb: "changing" to "chang" against "change",
 * "approved" to "approv" against "approve".
 *
 * The cause is that English drops the e before -ing and -ed and keeps it
 * before -s, so no single truncation can land both on the same string.
 *
 * SO EACH WORD EXPANDS TO EVERY FORM IT MIGHT MEET, and two words match when
 * their sets intersect. "changing" offers {changing, chang, change} and
 * "change" offers {change}, which overlap. It is a few more strings and no
 * cleverness, and cleverness is what produced the bug.
 *
 * COLLISIONS ARE THE RISK, not missed matches. Two DIFFERENT words sharing a
 * form would make a check pass on a word the writer never used, so the -s rule
 * refuses a double s ("business" must not become "busines", "address" must not
 * become "addres") and -es is only stripped whole after a sibilant, where it
 * genuinely is the plural marker: boxes, churches, buses.
 */
function forms(word) {
  const w = String(word || '').toLowerCase();
  const out = new Set([w]);

  if (IRREGULAR.has(w)) out.add(IRREGULAR.get(w));
  for (const [plural, singular] of IRREGULAR) {
    if (singular === w) out.add(plural);
  }

  if (w.length > 4 && w.endsWith('ies')) out.add(w.slice(0, -3) + 'y');

  // -es is the whole plural marker only after a sibilant. Everywhere else the
  // e belongs to the word: notices -> notice, rates -> rate.
  if (w.length > 3 && /(s|x|z|ch|sh)es$/.test(w)) out.add(w.slice(0, -2));

  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) out.add(w.slice(0, -1));

  // Both candidates, because English drops a silent e before these endings and
  // nothing in the string says whether it did.
  if (w.length > 4 && w.endsWith('ing')) {
    out.add(w.slice(0, -3));
    out.add(w.slice(0, -3) + 'e');
  }
  if (w.length > 3 && w.endsWith('ed')) {
    out.add(w.slice(0, -2));
    out.add(w.slice(0, -2) + 'e');
  }

  return out;
}

/** The primary form, for reporting a missing word back in readable shape. */
function stem(word) {
  const w = String(word || '').toLowerCase();
  return IRREGULAR.has(w) ? IRREGULAR.get(w) : w;
}

/**
 * Text to a plain list of lower-case words.
 *
 * Hyphens become spaces, so "rate-change notice" and "rate change notice" are
 * the same three words — which they are to a reader and to Google, and the
 * difference is only ever a typographic choice by whoever wrote the headline.
 */
function words(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[‐-―-]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * The body with its link phrases removed — the words as well as the wrappers.
 *
 * WHY THE ANCHOR TEXT GOES TOO, which looks wrong until you count the ways a
 * post can be made unpassable. writePost demands up to three phrases VERBATIM
 * — the money anchor, the back anchor, the forward anchor — and the anchor
 * pool builds them out of the target page's own words. A silo campaign
 * pointing at "fixed vs variable loan terms" can therefore be handed two
 * mandatory phrases that each contain the post's keyword, and then told to use
 * that keyword at most once. THAT IS A FAILURE NO REWRITE CAN FIX, which is
 * the one kind this codebase has already decided not to raise: qualityCheck's
 * REWRITE_WORTHY comment turns one wasted model call into three.
 *
 * It is also the honest reading of the rule. The mention Edwin is asking for
 * is the writer's own sentence. Link text is chosen by anchorPool, not by the
 * model, and crediting it would let a post satisfy the rule without the
 * keyword ever appearing in a sentence anybody wrote.
 *
 * THE WRAPPERS ALONE WOULD NOT BE ENOUGH EITHER. words() strips punctuation,
 * so a surviving `{{money}}` arrives as the word "money" — harmless against
 * today's keywords and a silent false match the day somebody targets "money
 * transfer fees".
 */
function stripAnchors(text) {
  return String(text || '').replace(/\{\{(\w+)\}\}[\s\S]*?\{\{\/\1\}\}/g, ' ');
}

/** Every form of every word in `text`, as one set to look candidates up in. */
function tokens(text) {
  const all = new Set();
  for (const w of words(text)) {
    for (const f of forms(w)) all.add(f);
  }
  return all;
}

/** The words of a keyword that have to be found, with the glue removed. */
function contentWords(keyword) {
  return [...new Set(
    words(keyword).filter(w => !STOPWORDS.has(w)).map(stem)
  )];
}

/**
 * Does `text` include every content word of `keyword`?
 *
 * @returns {{ ok: boolean, missing: string[] }}
 */
function includes(keyword, text) {
  const need = contentWords(keyword);

  /* AN EMPTY KEYWORD INCLUDES NOTHING, rather than being satisfied by
   * everything. `need.every(...)` over an empty list is true, which would
   * quietly pass every post on a campaign whose keyword went missing — the
   * state this rule exists to catch. */
  if (!need.length) return { ok: false, missing: [] };

  const have = tokens(text);
  const missing = need.filter(w => ![...forms(w)].some(f => have.has(f)));

  return { ok: missing.length === 0, missing };
}

/** How many times the keyword appears as a phrase in some text. */
function phraseCount(keyword, text) {
  const need = contentWords(keyword);
  if (!need.length) return 0;

  const list = words(text);
  let count = 0;

  /* A WINDOW, NOT A SUBSTRING MATCH. The body is allowed one mention of the
   * keyword, and "mortgage interest rate change notice" spread naturally
   * across a sentence is still that mention. Counting raw substrings would
   * miss every inflected or re-ordered one and pass a post that used the
   * phrase five times in five slightly different shapes.
   *
   * THE WINDOW IS SIZED BY THE WHOLE KEYWORD, NOT ITS CONTENT WORDS, and that
   * distinction is a bug this file already had. "business loans for women" has
   * three content words but occupies four, and a prose mention adds articles
   * of its own — "a business loan for a woman" is six. A three-word window
   * could never see all three content words at once, so phraseCount returned
   * ZERO for a body that plainly used the keyword, and the body limit was
   * silently unenforceable for every keyword containing a preposition.
   *
   * SLACK OF TWO, because the writer may insert an article or an adjective and
   * still be making one mention. Wider than that and two separate uses in one
   * long sentence start merging into one, which under-counts in the direction
   * that lets stuffing through. */
  const span = Math.max(need.length, words(keyword).length + 2);

  for (let i = 0; i + need.length <= list.length; i++) {
    const window = new Set();
    for (const w of list.slice(i, i + span)) for (const f of forms(w)) window.add(f);

    if (need.every(w => [...forms(w)].some(f => window.has(f)))) {
      count++;
      i += span - 1;   // do not count overlapping windows twice
    }
  }

  return count;
}

/**
 * The whole rule, for one post.
 *
 * @param {string} keyword   the post's own "Main keyword of this post"
 * @param {object} post      { title, metaDescription, headings[], body }
 * @param {object} options   { bodyMin = 1, bodyMax = 1 }
 *
 * @returns {{ ok, failures: string[], codes: string[], detail: object }}
 */
function keywordCoverage(keyword, post = {}, options = {}) {
  /* A BARE NUMBER USED TO BE bodyMax, AND SILENTLY DESTRUCTURING ONE WOULD
   * RESET bodyMin TO 1 — turning an explicit "two mentions are fine here"
   * into the default rule with no sign that it had been ignored. Nothing in
   * the tree passes a number today. A throw keeps it that way; a default
   * would hide it. */
  if (typeof options === 'number') {
    throw new TypeError(
      'keywordCoverage: the third argument is now { bodyMin, bodyMax } — ' +
      'a bare number was the old bodyMax'
    );
  }

  const { bodyMin = 1, bodyMax = 1 } = options;

  const title = String(post.title || '');
  const meta = String(post.metaDescription || '');
  const headings = (post.headings || []).filter(Boolean).map(String);
  const body = stripAnchors(post.body);

  const inTitle = includes(keyword, title);
  const inMeta = includes(keyword, meta);

  /* THE H1 AND THE TITLE TAG ARE ONE STRING TODAY. IE_Publisher writes the
   * WordPress post_title from `written.title`, and IE_SEO writes the <title>
   * tag from the same value — so a post whose title covers the keyword covers
   * both, and one that does not fails both.
   *
   * REPORTED SEPARATELY ANYWAY. The day a title-tag template arrives — "…|
   * Hilltop Home Loans", or a 60-character trim — these stop being one value,
   * and a check that had quietly conflated them would keep passing while one
   * of the two silently stopped carrying the keyword. */
  const inH1 = inTitle;

  const headingHit = headings.find(h => includes(keyword, h).ok) || null;
  const bodyMentions = phraseCount(keyword, body);

  /* EVERY FAILURE CARRIES A CODE, and the codes live HERE rather than in the
   * caller. qualityCheck decides which faults are worth another model call by
   * matching code names against a set, and a code invented at the call site
   * is a second copy of a decision made in this file — which is the exact
   * shape of the bug REWRITE_WORTHY was moved out of blogGenerator to end. */
  const failures = [];
  const codes = [];
  const fail = (code, message) => { codes.push(code); failures.push(message); };

  if (!inTitle.ok) fail('keyword-title', `title is missing: ${inTitle.missing.join(', ')}`);
  if (!inMeta.ok) fail('keyword-meta', `meta description is missing: ${inMeta.missing.join(', ')}`);
  if (!headingHit) fail('keyword-heading', 'no subheading contains the keyword');

  if (bodyMentions > bodyMax) {
    fail('keyword-body',
      `the keyword appears ${bodyMentions} times in the body, limit is ${bodyMax}`);
  } else if (bodyMentions < bodyMin) {
    /* THE SAME CODE AS TOO MANY, DELIBERATELY. Both are "the body says the
     * phrase the wrong number of times", both are fixed by the same retry,
     * and a caller that wanted to retry one and not the other would be
     * choosing between two halves of one instruction. */
    fail('keyword-body',
      bodyMin === 1
        ? 'the keyword never appears in the body — it must appear exactly once'
        : `the keyword appears ${bodyMentions} times in the body, at least ${bodyMin} needed`);
  }

  return {
    ok: failures.length === 0,
    failures,
    codes,
    detail: {
      title: inTitle.ok,
      metaDescription: inMeta.ok,
      h1: inH1.ok,
      heading: headingHit,
      bodyMentions,
      contentWords: contentWords(keyword),
    },
  };
}

module.exports = {
  keywordCoverage, includes, phraseCount, contentWords,
  forms, stem, words, tokens, stripAnchors, STOPWORDS,
};
