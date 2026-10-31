// utils/localOptions/generate.js
//
// A business -> a Local Website Options site, as files.
//
// THE PIECE THAT JOINS THE OTHER TWO. prompt.js knows how to ask; render/
// knows how to build. Until this existed they were connected only inside
// tools/try-local-options-page.js, which is a thing to read output with, not
// a thing to ship.
//
//   suggestServices   six service names, one cheap call
//   homePagePrompt    the front page's own words
//   servicePagePrompt six calls, one per service, stance rotated
//   renderSite        the eleven pages plus css, sitemap, robots, 404
//   heroFiles         the four photographs, as bytes
//
// EVERY CALL IS INJECTABLE. `ask` and `suggest` are arguments with real
// defaults, the same pattern deployBlog uses with `run = runWrangler`. A
// suite that forgot to stub them would not fail loudly — it would make seven
// live HTTPS calls and charge for them, inside ./deploy.sh.
//
// IT RETURNS FILES. It does not write them, deploy them, charge anybody or
// touch Mongo. Whoever calls this knows why they called it; a generator that
// quietly advanced job state would make a dry run impossible.

'use strict';

const { parseModelJson } = require('../parseModelJson');
const { withRetry } = require('../withRetry');
const { slugify } = require('../slugify');
const { log } = require('../logger');

/* SECTIONS COMES FROM LEDGER'S PROMPT AND IS THE SAME LIST IN BOTH — Edwin,
 * 30 October, asking for Beacon: "Keep the same sections." prompt-beacon.js
 * re-exports this very array rather than declaring one of its own, so the
 * check below cannot start meaning different things for different layouts.
 *
 * THE PROMPT BUILDERS, THOUGH, COME FROM THE STRUCTURE. They are chosen per
 * build in writeSite() below, because Beacon writes shorter. */
const { SECTIONS } = require('./prompt');

const { structureFor } = require('./render/structures');
const { renderSite } = require('./render/renderSite');
const { heroSet, completeSets } = require('./render/heroes');
const { SERVICE_COUNT } = require('./render/shape');

const MODEL = process.env.LOCAL_OPTIONS_MODEL
  || process.env.BLOG_MODEL
  || 'gpt-5.6-terra';

/**
 * One model call, returning parsed JSON.
 *
 * THE DEFAULT, AND THE ONLY PLACE IN THIS FILE THAT TOUCHES THE NETWORK.
 * Replaced wholesale by the suite, which is why it is a plain function taking
 * { system, user } rather than something that reaches for a client itself.
 */
async function askModel({ system, user, label = 'local options page' } = {}) {
  const { getOpenAI } = require('../openaiClient');

  const answer = await getOpenAI().chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const raw = answer.choices[0].message.content;

  /* parseModelJson RETURNS { ok, data, repaired, error }, NOT THE OBJECT.
   *
   * suggestServices.js carries the same note, because the first version of
   * THAT read `parsed.services` off the wrapper. The first version of
   * tools/try-local-options-page.js made it a third time, and reported "0
   * words — SHORT" about a page the model had written correctly.
   *
   * Three times in one codebase is not three mistakes, it is a shape that
   * invites one. Hence the check below rather than a hopeful destructure. */
  const parsed = parseModelJson(raw, { label });

  if (!parsed.ok) {
    const err = new Error(`${label}: the model did not return JSON — ${
      parsed.error && parsed.error.message}`);

    /* AND IT IS WORTH ASKING AGAIN — 28 October.
     *
     * parseModelJson already repairs the mechanical damage that is safe to
     * repair: code fences, smart quotes, trailing commas, a stray quote
     * inside a string value. What reached here was a reply that lost the
     * "]" closing its last array, which is NOT in that set on purpose — a
     * parser that balances brackets by itself cannot tell a slip from a
     * response that was cut off halfway, and would turn a loud failure
     * into a page quietly missing a section.
     *
     * So it is not repaired, it is re-asked. A model that drops a bracket
     * on one attempt almost never drops it on the next, and the three
     * attempts withRetry already allows were sitting unused: an error with
     * no status and no network wording fell through every test in
     * isRetryable() and was treated as a malformed request.
     *
     *     ONE PAGE'S BAD BRACKET ENDED A SEVEN-CALL BUILD,
     *     WITH THE SIX GOOD CALLS ALREADY PAID FOR.
     *
     * THE FLAG IS SET HERE RATHER THAN MATCHED THERE, so the rule lives
     * with the thrower that knows why it is true. */
    err.retryable = true;

    throw err;
  }

  return { data: parsed.data, usage: answer.usage || {} };
}

/** Every key the renderer will read off a service page. */
const SERVICE_KEYS = ['h1', 'title', 'meta', 'blurb', 'sections'];

/**
 * Refuse a page that is the wrong shape, at the point it arrives.
 *
 * NOT LATER, IN THE RENDERER. A page missing `sections` renders as a service
 * page with a hero, a heading and no words — which is a 200, looks almost
 * right, and is the hardest kind of broken to notice. `undefined` in a
 * template prints nothing; it does not throw.
 */
function checkServicePage(page, name) {
  const missing = SERVICE_KEYS.filter(key => undefined === page[key]);

  if (missing.length) {
    throw new Error(`${name}: the model left out ${missing.join(', ')}`);
  }

  if (!Array.isArray(page.sections) || page.sections.length !== SECTIONS.length) {
    throw new Error(`${name}: expected ${SECTIONS.length} sections, got ${
      Array.isArray(page.sections) ? page.sections.length : typeof page.sections}`);
  }

  /* AND THE HEADINGS, SINCE 28 OCTOBER, BECAUSE NOBODY ELSE WILL NOTICE.
   *
   * The four headings used to be written into prompt.js and demanded back
   * verbatim, so there was nothing to check: whatever came back either
   * matched or the page was wrong in a dozen other ways too. They are the
   * model's words now, and a model that returns `"heading": ""` for all five
   * does not fail anywhere — prose() in render/pages.js SKIPS an empty
   * heading, by design, because the opening needs that. The page renders 200
   * as nine hundred words of unbroken prose with no h2 anywhere in it.
   *
   *     A FIELD THAT IS ALLOWED TO BE EMPTY IN ONE POSITION
   *     IS NOT CHECKED IN ANY OF THE OTHERS.
   *
   * So the positions that must have one are named from SECTIONS itself —
   * `headingJob` is the flag — rather than from a second list that would have
   * to be kept in step. */
  const seen = new Map();

  SECTIONS.forEach((spec, i) => {
    const heading = String((page.sections[i] || {}).heading || '').trim();

    if (!spec.headingJob) {
      /* The opening. A heading here is the "says the same thing twice" shape
       * the whole section exists to avoid, and it is worth refusing rather
       * than rendering. */
      if (heading) {
        throw new Error(
          `${name}: section ${i + 1} is the opening and must have no heading, `
          + `but the model sent "${heading}"`);
      }

      return;
    }

    if (!heading) {
      throw new Error(`${name}: section ${i + 1} came back with no heading`);
    }

    const key = heading.toLowerCase();

    if (seen.has(key)) {
      throw new Error(
        `${name}: sections ${seen.get(key)} and ${i + 1} both use the heading `
        + `"${heading}"`);
    }

    seen.set(key, i + 1);
  });
}

/**
 * Six service names for a trade, as the renderer wants them.
 *
 * SLUGIFIED HERE, ONCE. The slug is the directory, the URL, the ring
 * position and the canonical. Deriving it in more than one place is how two
 * of them disagree.
 */
function servicesFrom(names) {
  return names.slice(0, SERVICE_COUNT).map(name => ({
    slug: slugify(String(name)),
    name: String(name),
  }));
}

/**
 * Build the whole site.
 *
 * @param {object}   opts
 * @param {object}   opts.business        name, trade, city, state, street, phone
 * @param {string}   opts.url             https://domain
 * @param {string[]} [opts.serviceNames]  skip suggestServices and use these
 * @param {string[]} [opts.areas]
 * @param {Array}    [opts.hours]         [{ day, open }]
 * @param {string}   [opts.structure]     'ledger'
 * @param {string}   [opts.logo]
 * @param {Date}     [opts.now]
 * @param {Function} [opts.ask]           injected model call
 * @param {Function} [opts.suggest]       injected suggestServices
 * @param {Function} [opts.onPage]        called as each page's copy arrives
 * @param {string}   [opts.imagesRoot]    injected, for the suite
 * @param {string}   [opts.requestId]
 * @returns {Promise<{files, services, usage, pages}>}
 */
/**
 * A requested set, if that trade really has it; otherwise '' for automatic.
 *
 * THE DROPDOWN IS THE SAME FOR EVERY TRADE and the folders are not — only
 * plumbing has a second set today. So "Design 2" chosen alongside roofing
 * names a folder that does not exist, and honouring it would publish a site
 * with four empty bands where the photographs go.
 */
function available(trade, set, root) {
  if (!set) return '';

  const sets = root ? completeSets(trade, root) : completeSets(trade);

  return sets.includes(set) ? set : '';
}

async function generateLocalOptionsSite({
  business = {},
  url = '',
  serviceNames = null,
  areas = [],
  hours = [],
  structure = 'ledger',
  logo = '',

  /**
   * Which set of photographs this site gets — 'set-2', or '' for automatic.
   *
   * ASKED FOR RATHER THAN DERIVED — Edwin, 30 October: "how the user will be
   * able to pick what set?"
   *
   * The automatic pick hashes the business name, which guarantees that one
   * business rebuilt keeps its pictures. It does NOT guarantee that two
   * DIFFERENT businesses differ: with two sets, two sites have an even
   * chance of landing on the same one — which is exactly the thing the sets
   * were added to prevent.
   *
   *     A HASH ANSWERS "THE SAME EVERY TIME".
   *     IT DOES NOT ANSWER "DIFFERENT FROM THAT ONE".
   *
   * So whoever is building the second plumbing site says so. Empty still
   * means automatic, which is the right default for somebody who does not
   * care and for every trade that only has one set.
   */
  imageSet = '',

  verification = [],
  now = new Date(),
  ask = askModel,
  suggest = null,
  /* CALLED AS EACH PAGE'S COPY ARRIVES, and the default does nothing.
   *
   * The seven calls take nearly three minutes together. Without this the
   * only thing the job runner could report is "starting" and then
   * "completed", and a customer watching an unmoving bar for 170 seconds
   * assumes it has hung — the single most common moment to refresh, which
   * is also the moment a refresh looks like it lost the build.
   *
   * AWAITED. The runner's handler writes to Mongo, and firing those writes
   * without waiting would let seven of them race to set progress.done. */
  onPage = null,
  imagesRoot,
  requestId,
} = {}) {
  if (!business.trade) throw new Error('generateLocalOptionsSite: business.trade is required');
  if (!url) throw new Error('generateLocalOptionsSite: url is required');

  /* THE STRUCTURE BRINGS ITS OWN PROMPTS — 30 October, Beacon. It already
   * brought its own markup and its own stylesheet; the voice is the third
   * thing it owns, because Beacon's pages are narrower and its services are
   * tiles, and Ledger's 780-1000 words do not sit in either.
   *
   * RESOLVED THROUGH structureFor(), SO A TYPO CANNOT SPLIT THEM. An unknown
   * key falls back to Ledger for all three at once — markup, stylesheet and
   * prompts — rather than writing Beacon-length copy into Ledger's layout. */
  const prompts = structureFor(structure).prompt;

  const usage = { calls: 0, inputTokens: 0, outputTokens: 0 };

  const count = (answer) => {
    usage.calls += 1;
    usage.inputTokens += (answer.usage && answer.usage.prompt_tokens) || 0;
    usage.outputTokens += (answer.usage && answer.usage.completion_tokens) || 0;
  };

  /* ---------------------------------------------------------- the six names */

  let names = serviceNames;

  if (!names) {
    const suggester = suggest || require('../suggestServices').suggestServices;

    const suggested = await suggester(
      { businessType: business.trade, location: [business.city, business.state].filter(Boolean).join(', ') },
      { count: SERVICE_COUNT }
    );

    /* suggestServices RESOLVES TO { services, dropped, usage } — NOT TO THE
     * ARRAY.
     *
     * This read the resolved value as the list and handed it to
     * Array.from(). An object with no length and no iterator yields [], so
     * the build failed with "expected 6 services, got 0" — a true sentence
     * about a call that had worked perfectly and cost real tokens.
     *
     * FOURTH TIME IN THIS CODEBASE. parseModelJson returns { ok, data } and
     * was read as the data in suggestServices itself, in
     * tools/try-local-options-page.js, and in askModel forty lines above
     * this — which carries a long comment calling it "a shape that invites
     * one". It invited another, in the function that comment is in, one
     * caller away.
     *
     * The suite did not catch it because the suite's stub RETURNED AN ARRAY:
     * the fake was written from the same misreading as the code, so the two
     * agreed with each other and not with the real function. A stub is a
     * claim about a contract, and nothing was checking that claim.
     * test-local-options-wiring.js now calls the real suggestServices with
     * { stub: true }, which returns the real shape without an API call.
     *
     * CHECKED RATHER THAN DESTRUCTURED. `suggested.services` on something of
     * the wrong shape is `undefined`, and `Array.from(undefined)` throws a
     * message about an argument nobody passed. */
    if (!suggested || !Array.isArray(suggested.services)) {
      throw new Error(
        'suggestServices did not return { services: [...] } — got '
        + (suggested === null ? 'null' : typeof suggested)
      );
    }

    names = suggested.services;
  }

  const services = servicesFrom(Array.from(names));

  /* SIX, OR NOTHING. The mode is a FIXED eleven-page site and the customer
   * is charged for eleven. Five service pages is a different product sold at
   * the same price, and the ring breaks: page four's "onward" link points at
   * a directory that was never written. */
  if (services.length !== SERVICE_COUNT) {
    throw new Error(`expected ${SERVICE_COUNT} services, got ${services.length}`);
  }

  /* ------------------------------------------------------------- the pages */

  /* ONE AT A TIME, ON PURPOSE.
   *
   * Six calls together would finish in the time of the slowest rather than
   * the sum, and it is tempting. Sequential wins twice: a failure on page
   * two stops before four more are paid for, and six concurrent calls on
   * every build is a rate limit nobody has measured. utils/concurrencyLimiter.js
   * is there when somebody wants to measure it. */
  const pages = [];

  for (let i = 0; i < services.length; i += 1) {
    const service = services[i];
    const siblings = services.filter(s => s.slug !== service.slug).map(s => s.name);

    const { system, user, stance } = prompts.servicePagePrompt({
      business, service, index: i, areas, hours, siblings,
    });

    /* RETRIED, BECAUSE THE FAILURE MODE IS A RATE LIMIT OR A TIMEOUT.
     * withRetry only retries what is worth retrying — a malformed response
     * is not transient, and throwing on it immediately is correct. */
    const answer = await withRetry(
      () => ask({ system, user, label: service.name }),
      { label: `local options: ${service.name}` }
    );

    count(answer);
    checkServicePage(answer.data, service.name);

    pages.push({ ...service, stance, ...answer.data });

    /* AFTER checkServicePage, NOT BEFORE. Reporting a page done and then
     * throwing on its shape would move the bar forwards and then fail the
     * job — the one sequence that makes a failure look like a bug in the
     * progress bar rather than in the page. */
    if (onPage) await onPage({ kind: 'service', name: service.name, slug: service.slug, index: i });
  }

  /* --------------------------------------------------------- the home page */

  const home = prompts.homePagePrompt({ business, services, areas });

  const homeAnswer = await withRetry(
    () => ask({ ...home, label: 'home page' }),
    { label: 'local options: home page' }
  );

  count(homeAnswer);

  if (onPage) await onPage({ kind: 'home', name: 'Home page' });

  /* --------------------------------------------------------- the pictures */

  const trade = business.trade;

  /* ONE CALL, SO THE BYTES, THE ALT TEXT AND THE COVER CANNOT DISAGREE.
   *
   * This was three — heroFiles(), altFor(), coverFor() — which was fine
   * while a trade had one folder of pictures. Sets arrived on 30 October,
   * and three independent lookups is three chances to describe set-2's
   * photographs with set-1's words. Nothing would fail: the site renders,
   * and every picture is described as something it is not, to exactly the
   * people who cannot see it.
   *
   * THE BUSINESS NAME DECIDES THE SET, so the same business rebuilt gets the
   * same photographs and its stored alt text still describes them. */
  const images = heroSet(trade, {
    ...(imagesRoot ? { root: imagesRoot } : {}),
    key: business.name,

    /* WHAT WAS ASKED FOR, IF IT IS REALLY THERE. A design chosen on the
     * form may not exist for the trade that was chosen with it — the
     * dropdown is the same for every trade, and only plumbing has a second
     * set today. Falling back to the automatic pick publishes a site with
     * photographs; honouring a set that is not there publishes one with
     * four empty bands. */
    set: available(trade, imageSet, imagesRoot),

    requestId,
  });

  const { alt, cover, set: chosenSet } = images;

  /* ------------------------------------------------------------- the files */

  /* NAMED, THEN RENDERED, AND RETURNED — one object, three uses.
   *
   * It used to be an object literal written inline into the renderSite()
   * call, which meant the only record of what produced this site was the
   * site. utils/runLocalOptions.js now writes this to
   * _src/localoptions.json, so a template fix re-renders for nothing
   * instead of paying for seven model calls again.
   *
   * THE SAME OBJECT, NOT A COPY OF ITS INTERESTING PARTS. A re-render is
   * renderSite(stored), so a field added here is stored by construction —
   * there is no second list to keep in step. */
  const source = {
    url,
    business,
    services: pages,
    areas,
    hours,
    alt,
    cover,
    logo,
    structure,

    /* WHICH SET OF PHOTOGRAPHS THIS SITE HAS. The renderer never reads it —
     * `alt` and `cover` above already belong to this set, and an edit
     * republishes without touching the images at all. It is stored so a
     * REBUILD from this source can be handed the same set explicitly
     * rather than re-deriving it, which would quietly move a live site's
     * pictures the day a set is added or removed. */
    imageSet: chosenSet,

    /* STORED WITH THE SITE, so a re-render keeps it. This is the field that
     * most often arrives AFTER the build — Google hands the tag over when
     * the property is created, and the client creates the property once
     * their site exists. The stored source is what lets that be a re-render
     * rather than a rebuild. */
    verification,

    home: homeAnswer.data,
    now,
  };

  const files = renderSite(source);

  log.info('localOptions.generated', {
    requestId,
    trade,
    url,
    pages: pages.length,
    files: Object.keys(files).length + Object.keys(images.files).length,
    heroesMissing: images.missing.length,
    calls: usage.calls,
    outputTokens: usage.outputTokens,
  });

  return {
    /* THE IMAGES GO IN THE SAME MAP. writeSite() in cloudflare/deploy.js
     * passes contents to fs.writeFile, which takes a Buffer, so a photograph
     * and a page travel through one pipe to one deploy. */
    files: { ...files, ...images.files },
    services: pages,

    /* THE HOME PAGE'S WORDS, RETURNED RATHER THAN ONLY SPENT.
     *
     * They went into renderSite() and nowhere else, so the only copy of them
     * was inside the finished HTML. utils/runLocalOptions.js writes them to
     * _src/localoptions.json beside the six service pages, which is what
     * makes a template fix re-renderable instead of a second $0.19 and three
     * more minutes of model calls. */
    home: homeAnswer.data,

    /* EVERYTHING renderSite() WAS GIVEN, for whoever wants to do it again. */
    source,

    heroes: { found: images.found, missing: images.missing },
    usage,
  };
}

module.exports = {
  generateLocalOptionsSite,
  askModel,
  checkServicePage,
  servicesFrom,
  SERVICE_KEYS,
  MODEL,
};
