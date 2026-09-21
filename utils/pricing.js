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
  function affordableServicePages({
    credits = 0,
    siteMode = 'lead',
    servicePages = 0,
    locationPages = 0,
  } = {}) {
    // A design sample generates no service pages at all, so ticked boxes
    // would buy nothing and none should be offered.
    if (siteMode === 'sample') return 0;

    const committed = quote({ siteMode: 'lead', servicePages, locationPages }).total;
    const spare = Number(credits || 0) - committed;

    if (!(spare > 0)) return 0;

    return Math.floor(spare / PRICING.SERVICE_PAGE);
  }

  module.exports = { PRICING, quote, affordableServicePages };