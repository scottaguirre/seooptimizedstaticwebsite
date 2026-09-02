// blog-engine-preview/qualityCheck.js
//
// Makes "does this sound generic?" a measurement instead of a vibe.
//
// WHY THIS EXISTS
//
// A prompt is not a guarantee. You can forbid a phrase and get it anyway, and
// you will not notice on post 40 the way you noticed on post 1. These checks
// run on every generated post, cost nothing, and fail loudly — which is the
// only way prompt quality stays fixed once you stop watching.
//
// Pure: no I/O, no model. Same input, same verdict.

/* -------------------------------------------------------------------------
 * Phrases that mark filler
 * -------------------------------------------------------------------------
 * Every entry here earns its place by being a phrase that carries no
 * information — you can delete it and the sentence loses nothing. That is the
 * test for adding to this list, not "I find it annoying".
 * ---------------------------------------------------------------------- */

const FILLER = [
    // openings that delay the point
    'in today', "in today's world", 'when it comes to', 'in the world of',
    'in this fast-paced', 'as a homeowner', 'whether you', 'look no further',
    'first and foremost',
  
    // padding
    'it is important to note', "it's important to note", 'it is worth noting',
    'needless to say', 'that being said', 'at the end of the day',
    'rest assured', 'peace of mind', "we've got you covered",
    'in conclusion', 'to sum up', 'all in all',
  
    // hype with no content
    'cutting-edge', 'state-of-the-art', 'latest advancements', 'latest advances',
    'modern techniques', 'innovative solutions', 'top-notch', 'unparalleled',
    'seamless', 'game-changer', 'game changer', 'revolutionary',
    'take it to the next level', 'elevate your',
  
    // borrowed authority
    'experts agree', 'studies show', 'research has shown', 'industry-leading',
  
    // marketing exhortation
    'contact us today', 'call us today', 'give us a call today',
    "don't hesitate to", 'do not hesitate to', 'look no further than',
  ];
  
  /* -------------------------------------------------------------------------
   * Claims a generated post has no business making
   * -------------------------------------------------------------------------
   * These are WARNINGS, not failures — sometimes a permit genuinely is the
   * answer. But a model asserting local code, a warranty term or a licence
   * number is inventing something the business will be held to, so every
   * instance wants a human eye.
   * ---------------------------------------------------------------------- */
  
  const RISKY = [
    { pattern: /\bbuilding code\b|\bup to code\b|\bcode requires\b|\bper code\b/i, why: 'states building code' },
    { pattern: /\bpermit\b/i,                                                     why: 'mentions permits' },
    { pattern: /\bregulation[s]?\b|\bordinance\b|\bstatute\b/i,                   why: 'cites regulation' },
    { pattern: /\bwe (guarantee|warrant)\b|\bour warranty\b|\byear warranty\b/i,  why: 'promises a warranty' },
    { pattern: /\blicensed and insured\b|\bcertified by\b|\baccredited\b/i,       why: 'claims a credential' },
    { pattern: /\b(award|award-winning|voted best|rated #?1)\b/i,                 why: 'claims an award' },
    { pattern: /\bsince (19|20)\d\d\b|\b\d+ years? (of experience|in business)\b/i, why: 'claims a company history' },
  ];
  
  /* -------------------------------------------------------------------------
   * Specificity
   * -------------------------------------------------------------------------
   * The difference between a post worth reading and filler is almost always
   * concrete detail. Counting it is crude, but a post with two numbers in nine
   * hundred words is reliably vague, and that is worth catching.
   * ---------------------------------------------------------------------- */
  
  const UNITS = /\b\d+(\.\d+)?\s?(gallons?|gal|psi|°?f\b|degrees?|years?|months?|weeks?|days?|hours?|minutes?|inches?|in\b|feet|ft\b|amps?|volts?|watts?|btu)/gi;
  const MONEY = /\$\s?\d[\d,]*/g;
  const NUMBERS = /\b\d+(\.\d+)?\b/g;
  
  function textOf(post) {
    return (post.sections || [])
      .flatMap(s => [s.heading || '', ...(s.paragraphs || [])])
      .join('\n');
  }
  
  function wordCount(text) {
    return (text.trim().match(/\S+/g) || []).length;
  }
  
  function findFiller(text) {
    const lower = text.toLowerCase();
    return FILLER.filter(p => lower.includes(p));
  }
  
  function findRisky(text) {
    return RISKY.filter(r => r.pattern.test(text)).map(r => r.why);
  }
  
  function specificity(text) {
    const units = (text.match(UNITS) || []).length;
    const money = (text.match(MONEY) || []).length;
    const numbers = (text.match(NUMBERS) || []).length;
    const words = wordCount(text);
  
    // Concrete markers per 100 words. Anything under ~1 reads as vague; a good
    // trade post lands around 2-4.
    const density = words ? ((units + money + numbers) / words) * 100 : 0;
  
    return { units, money, numbers, words, density: Number(density.toFixed(2)) };
  }
  
  /**
   * Check one post.
   *
   * @param {object} post   { title, metaDescription, sections }
   * @param {object} slot   the plan slot, for the tokens that must be present
   * @returns {{ ok:boolean, failures:string[], warnings:string[], stats:object }}
   */
  function checkPost(post, slot = {}) {
    const failures = [];
    const warnings = [];
  
    const text = textOf(post);
    const stats = specificity(text);
  
    // --- structural ---------------------------------------------------------
  
    if (!post.title) failures.push('no title');
    // Anywhere in the title, not just the start: "How to X: The Ultimate Guide"
    // is both a how-to and a guide, and should be caught as both.
    if (/\b(ultimate|complete|definitive) guide\b/i.test(post.title || '')) {
      failures.push('title is a "guide" — competes with the service page');
    }
    if (/^how to\b/i.test(post.title || '')) {
      failures.push('title is a how-to — teaches the reader not to call');
    }
  
    const meta = post.metaDescription || '';
    if (!meta) failures.push('no meta description');
    else if (meta.length > 155) warnings.push(`meta description is ${meta.length} chars (over 155)`);
    else if (post.title && meta.toLowerCase().startsWith(post.title.toLowerCase().slice(0, 30))) {
      warnings.push('meta description restates the title');
    }
  
    if (stats.words < 550) failures.push(`only ${stats.words} words`);
    if (stats.words > 1400) warnings.push(`${stats.words} words — long enough to be padded`);
  
    const headings = (post.sections || []).filter(s => s.heading).length;
    if (headings < 2) warnings.push(`only ${headings} subheading(s)`);
  
    // --- required links -----------------------------------------------------
  
    if (slot.money && !text.includes(`{{money}}${slot.money.anchor}{{/money}}`)) {
      failures.push('money-page anchor missing or altered');
    }
    if (slot.nextAnchor && !text.includes(`{{next}}${slot.nextAnchor}{{/next}}`)) {
      failures.push('forward anchor missing or altered');
    }
    if (slot.prevAnchor && !text.includes(`{{prev}}${slot.prevAnchor}{{/prev}}`)) {
      failures.push('backward anchor missing or altered');
    }
  
    // --- voice --------------------------------------------------------------
  
    const filler = findFiller(text);
    if (filler.length) failures.push(`filler: ${filler.slice(0, 5).join(' · ')}`);
  
    const risky = findRisky(text);
    for (const r of risky) warnings.push(`unverifiable claim — ${r}`);
  
    if (stats.density < 1) {
      failures.push(`vague: ${stats.density} concrete markers per 100 words`);
    } else if (stats.density < 1.6) {
      warnings.push(`thin on specifics: ${stats.density} per 100 words`);
    }
  
    return { ok: failures.length === 0, failures, warnings, stats };
  }
  
  /**
   * Do the posts in a campaign repeat each other?
   *
   * Four posts on one service drift toward the same three paragraphs unless the
   * prompt fights it, and you cannot see that by reading them one at a time.
   * Compares sentences, which catches near-duplicate advice that a title
   * comparison would miss.
   */
  function crossCheck(posts) {
    const sentencesOf = post => textOf(post)
      .split(/(?<=[.!?])\s+/)
      .map(s => s.toLowerCase().replace(/\{\{\/?\w+\}\}/g, '').replace(/[^a-z0-9 ]/g, '').trim())
      .filter(s => s.split(' ').length >= 8);
  
    const seen = new Map();
    const repeats = [];
  
    posts.forEach((post, i) => {
      for (const s of sentencesOf(post)) {
        if (seen.has(s)) {
          repeats.push({ sentence: s.slice(0, 70), first: seen.get(s) + 1, again: i + 1 });
        } else {
          seen.set(s, i);
        }
      }
    });
  
    // Openings are the worst offender: every post starting the same way is the
    // clearest possible signal that nobody wrote them.
    const openings = posts.map(p => {
      const first = ((p.sections || [])[0] || {}).paragraphs || [];
      return (first[0] || '').toLowerCase().split(' ').slice(0, 6).join(' ');
    });
    const dupOpenings = openings.filter((o, i) => o && openings.indexOf(o) !== i);
  
    return { repeats, dupOpenings };
  }
  
  function formatReport(results, cross) {
    const lines = [];
  
    for (const r of results) {
      const mark = r.check.ok ? (r.check.warnings.length ? '~' : '✓') : '✗';
      lines.push(`  ${mark} ${r.id}  ${r.check.stats.words}w  density ${r.check.stats.density}`);
      for (const f of r.check.failures) lines.push(`      FAIL  ${f}`);
      for (const w of r.check.warnings) lines.push(`      warn  ${w}`);
    }
  
    if (cross) {
      if (cross.dupOpenings.length) {
        lines.push(`  ✗ posts share an opening: "${cross.dupOpenings[0]}…"`);
      }
      if (cross.repeats.length) {
        lines.push(`  ✗ ${cross.repeats.length} repeated sentence(s) across posts:`);
        for (const r of cross.repeats.slice(0, 3)) {
          lines.push(`      post ${r.first} & ${r.again}: "${r.sentence}…"`);
        }
      }
      if (!cross.dupOpenings.length && !cross.repeats.length) {
        lines.push('  ✓ no repetition across posts');
      }
    }
  
    return lines.join('\n');
  }
  
  module.exports = {
    checkPost, crossCheck, formatReport,
    findFiller, findRisky, specificity, textOf,
    FILLER, RISKY,
  };
  
  /* -------------------------------------------------------------------------
   * Checking the topic SET, before anything is written
   * -------------------------------------------------------------------------
   * The prompt asks for intent alignment, distinct queries and varied titles.
   * A prompt is not a guarantee, and the topic list is the cheapest possible
   * place to catch a problem — changing a topic costs nothing, rewriting four
   * published posts costs a quarter.
   * ---------------------------------------------------------------------- */
  
  // Words that mean the reader has decided AGAINST the thing a repair page
  // sells. Their presence is not automatically wrong — "what a repair can still
  // fix instead of replacing" is fine — but it needs a human glance.
  const INTENT_DRIFT = {
    repair: /\b(replac\w+|new (unit|tank|heater|system)|upgrade|install\w*)\b/i,
    install: /\b(repair\w*|fix\w*|patch\w*)\b/i,
    installation: /\b(repair\w*|fix\w*|patch\w*)\b/i,
    replacement: /\b(repair\w*|fix\w*|patch\w*)\b/i,
  };
  
  function intentKey(targetPage = {}) {
    const hay = `${targetPage.title || ''} ${targetPage.keyword || ''}`.toLowerCase();
    for (const key of Object.keys(INTENT_DRIFT)) {
      if (hay.includes(key)) return key;
    }
    return null;
  }
  
  /**
   * @param {Array}  topics      [{ topic, targetQuery, linkPhrase, angle }]
   * @param {object} targetPage  { title, keyword, intent }
   */
  function checkTopicSet(topics = [], targetPage = {}, business = {}) {
    const warnings = [];
  
    // --- the same query comparison the plan gets, run here where it is free ---
    //
    // Without this, "water heater repair tips" sails through the topic screen
    // and is only caught after the campaign is built — by which point the owner
    // has moved on.
    const { compareQueries, queryTokens } = require('./planCampaign');
    for (const c of compareQueries(
      topics.map(t => ({ id: `"${t.topic}"`, targetQuery: t.targetQuery })),
      targetPage.keyword,
      0.6,
      queryTokens(business.town)
    )) {
      if (c.kind === 'missing') continue;   // reported separately below
      warnings.push(`${c.kind}: ${c.a}${c.b ? ' + ' + c.b : ''} — ${c.detail}`);
    }
  
    // --- intent drift -------------------------------------------------------
  
    const key = intentKey(targetPage);
    if (key) {
      const drifting = topics.filter(t => INTENT_DRIFT[key].test(`${t.topic} ${t.targetQuery || ''}`));
      if (drifting.length > topics.length / 3) {
        warnings.push(
          `${drifting.length} of ${topics.length} topics point away from "${key}" — ` +
          `these belong to a campaign targeting the other service:`
        );
        for (const t of drifting) warnings.push(`     · ${t.topic}`);
      }
    }
  
    // --- title monotony -----------------------------------------------------
  
    const firstWords = topics.map(t => (t.topic || '').trim().split(/\s+/)[0].toLowerCase());
    const counts = {};
    for (const w of firstWords) counts[w] = (counts[w] || 0) + 1;
    for (const [w, n] of Object.entries(counts)) {
      if (n > 2) warnings.push(`${n} titles begin with "${w}" — vary the construction`);
    }
  
    // Not "are questions" — "What Happens During X" has no question mark and is
    // a statement. The pattern being flagged is the CONSTRUCTION: opening on an
    // interrogative word, which is the shape a model reaches for by default.
    // Repeated phrases ANYWHERE in the title, not just the opening word.
    //
    // The town is the usual culprit: a model told the business is in Leander
    // will cheerfully append "in Leander" to every headline. Each title looks
    // fine alone; twelve of them in a row look generated.
    const titles = topics.map(t => (t.topic || '').toLowerCase());
    const phraseCounts = new Map();
  
    for (const title of titles) {
      const words = title.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
      const seenHere = new Set();
      for (let n = 2; n <= 3; n++) {
        for (let i = 0; i + n <= words.length; i++) {
          const phrase = words.slice(i, i + n).join(' ');
          if (seenHere.has(phrase)) continue;   // count each title once
          seenHere.add(phrase);
          phraseCounts.set(phrase, (phraseCounts.get(phrase) || 0) + 1);
        }
      }
    }
  
    // The subject itself is not a template. Every post in a water heater
    // campaign says "water heater"; flagging that is noise, and noise is how a
    // check gets ignored. Anything contained in the target keyword is expected.
    const subject = String(targetPage.keyword || '').toLowerCase();
  
    const limit = Math.max(2, Math.ceil(topics.length / 2));
    const repeated = [...phraseCounts.entries()]
      .filter(([phrase]) => !subject.includes(phrase))
      .filter(([, n]) => n > limit)
      .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  
    // Keep only the longest form of each repeat: "in leander homes" and
    // "in leander" are the same finding reported twice.
    const shown = [];
    for (const [phrase, n] of repeated) {
      if (shown.some(([p]) => p.includes(phrase))) continue;
      shown.push([phrase, n]);
    }
    for (const [phrase, n] of shown.slice(0, 3)) {
      warnings.push(`"${phrase}" appears in ${n} of ${topics.length} titles — it reads as a template`);
    }
  
    const interrogative = topics.filter(t => /^(why|what|how|when|should|is|are|do|does|can)\b/i.test(t.topic || '')).length;
    if (interrogative > Math.ceil(topics.length / 2)) {
      warnings.push(
        `${interrogative} of ${topics.length} titles open on why/what/how — ` +
        `mix in flat statements, numbers and comparisons`
      );
    }
  
    // --- query shape --------------------------------------------------------
  
    for (const t of topics) {
      const q = (t.targetQuery || '').trim();
      if (!q) { warnings.push(`no target query: "${t.topic}"`); continue; }
  
      const words = q.split(/\s+/).length;
      if (words > 7) warnings.push(`query is ${words} words, probably below search volume: "${q}"`);
      if (words < 3) warnings.push(`query is only ${words} words, likely too competitive: "${q}"`);
      if (/[?.,!]/.test(q)) warnings.push(`query contains punctuation: "${q}"`);
    }
  
    // --- angle spread -------------------------------------------------------
  
    const angles = new Set(topics.map(t => t.angle).filter(Boolean));
    if (angles.size && angles.size < 4) {
      warnings.push(`only ${angles.size} distinct angle(s) across ${topics.length} topics`);
    }
  
    // --- missing link phrases ----------------------------------------------
  
    for (const t of topics) {
      if (!t.linkPhrase) warnings.push(`no linkPhrase: "${t.topic}"`);
      else if (t.linkPhrase.split(/\s+/).length > 8) {
        warnings.push(`linkPhrase is long for mid-sentence use: "${t.linkPhrase}"`);
      }
    }
  
    return { ok: warnings.length === 0, warnings };
  }
  
  module.exports.checkTopicSet = checkTopicSet;