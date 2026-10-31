// utils/pricing.js
//
// What a generation costs, in one place.
//
// The old model charged 1 credit per service page and nothing else. That
// meant:
//
//   - location pages were free, despite costing nearly as much to generate
//     as a service page (one long GPT call each)
//   - everything not-a-service-page was free: About Us, FAQ, pricing table,
//     service cards, contact intro — about five API calls per site
//   - a Design Sample cost NOTHING, because it generates no service pages
//
// The base charge covers the work that happens regardless of page count.
//
// ValueSERP is deliberately NOT a separate line. Two searches cost $0.005 at
// the pay-as-you-go rate — under 2% of a typical site's API bill — and it
// only fires on a cache miss, which the user cannot predict. Charging for it
// would mean the review step could not state an exact total.

const { LOCAL_OPTIONS_SERVICE_PAGES } = require('./seoPresets');

const PRICING = {
    /** A one-page design sample: no service, location or legal pages. */
    SAMPLE: 100,
  
    /**
     * Charged once per Lead Generation site. Covers About Us content, service
     * cards, the pricing table, FAQ answers, the contact intro, the legal
     * pages, sitemap and schema.
     */
    LEAD_BASE: 200,
  
    /** Each service page: content + metadata + reviews, three GPT calls. */
    SERVICE_PAGE: 100,
  
    /**
     * Each location page: one GPT call, but a long one — measured cost is
     * close to a service page, which is why this is not half price.
     */
    LOCATION_PAGE: 100,

    /**
     * How many service pages a Local Website Options site has.
     *
     * RE-EXPORTED FROM seoPresets RATHER THAN DECLARED TWICE. The same six
     * decides what is built and what is charged, and two copies of it is a
     * site that builds eight pages and bills for six.
     */
    LOCAL_OPTIONS_PAGES: LOCAL_OPTIONS_SERVICE_PAGES,
  };
  
  /**
   * @param {object} opts
   * @param {string} opts.siteMode     'lead' | 'sample'
   * @param {number} opts.servicePages
   * @param {number} opts.locationPages
   * @returns {{total: number, lines: Array<{label: string, qty: number, each: number, cost: number}>}}
   *
   * Returns the breakdown as well as the total, so the review step can show
   * the user what they are paying for rather than a bare number.
   */
  function quote({ siteMode = 'lead', servicePages = 0, locationPages = 0 } = {}) {
    const services = Math.max(0, Number(servicePages) || 0);
    const locations = Math.max(0, Number(locationPages) || 0);
  
    if (siteMode === 'sample') {
      return {
        total: PRICING.SAMPLE,
        lines: [
          { label: 'One-page design sample', qty: 1, each: PRICING.SAMPLE, cost: PRICING.SAMPLE },
        ],
      };
    }

    /* LOCAL WEBSITE OPTIONS: THE SAME PRICE AS THE LEAD SITE, AND COMPUTED
     * FROM THE SAME TWO CONSTANTS.
     *
     * Edwin, 27 October: "let's leave it as the same price as the one built
     * with the generator." Then, asked whether to freeze the number or
     * compute it: "derive it."
     *
     *     LEAD_BASE 200 + 6 x SERVICE_PAGE 100 = 800 credits = $8.00
     *
     * NOT A FLAT `LOCAL_OPTIONS: 800`. The rule is PARITY WITH THE LEAD
     * SITE. Reprice the generator and this moves with it, which is what "the
     * same price" means; freeze it and the two diverge the first time
     * SERVICE_PAGE changes — and NOTHING WOULD FAIL, because 800 is still a
     * perfectly valid number. A wrong price does not throw.
     *
     * AN EARLY RETURN, LIKE 'sample', BECAUSE THE PAGE SET IS FIXED. What
     * was posted does not change what is built, so it must not change what
     * is charged either.
     *
     * THE MARGIN CLAIM THAT USED TO BE HERE WAS WRONG, AND THE PRICE IS NOT.
     *
     * It read "about 13 cents of model spend against the lead site's 16.5" —
     * a figure built by SUBTRACTING one estimate from another rather than by
     * measuring anything. Three measured runs on the plumbing fixture:
     *
     *     six service pages   $0.1607   $0.1641
     *     the whole site      $0.1863   (seven calls; the home page is one)
     *
     * So the two products cost very nearly the SAME to generate, not four
     * cents less. A SUBTRACTION IS NOT A MEASUREMENT.
     *
     * None of which moves the price: 800 is parity with the lead site by
     * decision, and parity was never argued from the margin. Only the claim
     * about the margin was wrong, and it is corrected rather than deleted
     * because the next person to price a mode will reach for the same
     * shortcut. */
    if (siteMode === 'localoptions') {
      const services = PRICING.LOCAL_OPTIONS_PAGES;

      return {
        total: PRICING.LEAD_BASE + (services * PRICING.SERVICE_PAGE),
        lines: [
          { label: 'Website', qty: 1, each: PRICING.LEAD_BASE, cost: PRICING.LEAD_BASE },
          {
            label: 'Service pages',
            qty: services,
            each: PRICING.SERVICE_PAGE,
            cost: services * PRICING.SERVICE_PAGE,
          },
        ],
      };
    }
  
    const lines = [
      { label: 'Website', qty: 1, each: PRICING.LEAD_BASE, cost: PRICING.LEAD_BASE },
    ];
  
    if (services > 0) {
      lines.push({
        label: services === 1 ? 'Service page' : 'Service pages',
        qty: services,
        each: PRICING.SERVICE_PAGE,
        cost: services * PRICING.SERVICE_PAGE,
      });
    }
  
    if (locations > 0) {
      lines.push({
        label: locations === 1 ? 'Location page' : 'Location pages',
        qty: locations,
        each: PRICING.LOCATION_PAGE,
        cost: locations * PRICING.LOCATION_PAGE,
      });
    }
  
    return {
      total: lines.reduce((sum, l) => sum + l.cost, 0),
      lines,
    };
  }
  
  /**
   * How many MORE service pages a balance can pay for.
   *
   * The suggestion list pre-ticks this many boxes, so the customer opens it
   * already knowing what their balance buys instead of finding out when they
   * tick the fourth one and a modal appears.
   *
   * It is not simply (credits - 200) / 100: the website base is owed only
   * once, rows already on the form are already spoken for, and location pages
   * cost the same as service pages out of the same balance. Getting any of
   * those wrong pre-ticks boxes the customer cannot afford, which is the
   * exact thing this exists to prevent.
   *
   * @param {object} opts
   * @param {number} opts.credits         the balance
   * @param {string} [opts.siteMode]      'lead' | 'sample'
   * @param {number} [opts.servicePages]  service rows already on the form
   * @param {number} [opts.locationPages] location rows already on the form
   * @returns {number} how many more can be ticked, never below zero
   */
  function affordableServicePages(opts = {}) {
    return affordableExtraPages(PRICING.SERVICE_PAGE, opts);
  }
  
  /**
   * The same, for location pages.
   *
   * A separate function rather than a flag, because SERVICE_PAGE and
   * LOCATION_PAGE are separate constants. They are both 100 today, so the two
   * answers agree — but they are priced separately on purpose (the comment on
   * LOCATION_PAGE explains why it is not half price), and the day one moves
   * this must not quietly keep using the other.
   *
   * SO THIS IS UNTESTABLE UNTIL THE PRICES DIVERGE, and mutation testing says
   * so: swapping LOCATION_PAGE for SERVICE_PAGE here changes no answer and
   * fails no test. That is not a gap to paper over with a contrived fixture —
   * it is the honest state of two constants that happen to be equal. The day
   * one of them moves, the existing tests start telling them apart on their
   * own.
   */
  function affordableLocationPages(opts = {}) {
    return affordableExtraPages(PRICING.LOCATION_PAGE, opts);
  }
  
  function affordableExtraPages(each, {
    credits = 0,
    siteMode = 'lead',
    servicePages = 0,
    locationPages = 0,
  } = {}) {
    // A design sample generates neither kind of page, so ticked boxes would
    // buy nothing and none should be offered.
    if (siteMode === 'sample') return 0;

    /* AND NEITHER DOES LOCAL WEBSITE OPTIONS, for the opposite reason: it
     * builds exactly six service pages whatever the balance allows. Offering
     * a seventh would pre-tick a box against credits already committed, for
     * a page the renderer will never write. Same guard, different cause. */
    if (siteMode === 'localoptions') return 0;

    const committed = quote({ siteMode: 'lead', servicePages, locationPages }).total;
    const spare = Number(credits || 0) - committed;

    if (!(spare > 0)) return 0;

    return Math.floor(spare / each);
  }

  module.exports = { PRICING, quote, affordableServicePages, affordableLocationPages };