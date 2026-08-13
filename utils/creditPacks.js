// utils/creditPacks.js
//
// What a customer can buy.
//
// Prices are in CENTS, integers. Stripe works in the smallest currency unit,
// and money in floating point invites rounding errors — 0.1 + 0.2 is not 0.3
// in JavaScript, and a cent lost per transaction is a reconciliation problem
// nobody enjoys.
//
// Defined here rather than in the Stripe dashboard so a price change is one
// edit in one file. If you later want prices managed in Stripe, add a
// stripePriceId to each pack and pass that to Checkout instead of price_data.

const PACKS = [
    {
      id: 'starter',
      name: '1,000 Credits',
      credits: 1000,
      priceCents: 1000,          // $10.00
      blurb: 'About one website',
    },
    {
      id: 'standard',
      name: '5,000 Credits',
      credits: 5000,
      priceCents: 4500,          // $45.00 — 10% off
      blurb: 'About four or five websites',
      badge: 'Save 10%',
    },
    {
      id: 'bulk',
      name: '20,000 Credits',
      credits: 20000,
      priceCents: 16000,         // $160.00 — 20% off
      blurb: 'About eighteen websites',
      badge: 'Save 20%',
      popular: true,
    },
  ];
  
  /**
   * Look a pack up by id.
   *
   * ALWAYS use this rather than trusting anything from the request. The pack id
   * arrives from the browser; the credits and price must come from here, or a
   * user could post their own numbers and buy 20,000 credits for a dollar.
   */
  function getPack(id) {
    return PACKS.find(p => p.id === String(id || '').trim()) || null;
  }
  
  /** 4500 -> "$45.00" */
  function formatPrice(cents) {
    return '$' + (cents / 100).toFixed(2);
  }
  
  /** What one credit costs in this pack, for showing the saving. */
  function centsPerCredit(pack) {
    return pack.priceCents / pack.credits;
  }
  
  module.exports = { PACKS, getPack, formatPrice, centsPerCredit };