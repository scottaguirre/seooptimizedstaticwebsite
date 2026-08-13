// models/Purchase.js
//
// A record of every credit purchase.
//
// Two reasons this exists rather than just incrementing user.credits:
//
//   1. IDEMPOTENCY. Stripe retries webhooks — on a timeout, a 500, or a
//      network blip. Without a record of what has already been processed, a
//      retry credits the user twice. The unique index on stripeSessionId is
//      what makes that impossible: the second insert fails rather than
//      granting credits again.
//
//   2. ANSWERING "did this person pay?" without reading the Stripe dashboard.

const mongoose = require('mongoose');

const purchaseSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  // The unique constraint is the idempotency guarantee. Do not remove it.
  stripeSessionId: {
    type: String,
    required: true,
    unique: true,
  },

  stripePaymentIntentId: { type: String },

  packId: { type: String, required: true },
  credits: { type: Number, required: true, min: 0 },

  // Cents, as Stripe reports it. Never a float.
  amountCents: { type: Number, required: true, min: 0 },
  currency: { type: String, default: 'usd' },

  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending',
    index: true,
  },

  // Balance after crediting, so a disputed balance can be traced back
  // through the purchase history.
  creditsAfter: { type: Number },

  completedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
});

// "What has this user bought recently" is the common query.
purchaseSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Purchase', purchaseSchema);