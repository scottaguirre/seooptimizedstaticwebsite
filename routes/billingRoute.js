// routes/billingRoute.js
//
// Buying credits with Stripe.
//
// THE SHAPE
//   GET  /buy-credits          the packs
//   POST /api/checkout         creates a Checkout Session, redirects to Stripe
//   POST /api/stripe-webhook   Stripe tells us it was paid; credits are added HERE
//   GET  /credits/success      after a successful payment
//   GET  /credits/cancelled    if they backed out
//
// TWO RULES THAT MATTER MORE THAN THE REST
//
//   1. Credits are added by the WEBHOOK, never by the success page. The
//      success page is just where the browser lands — a user can open that
//      URL directly, so crediting there means free credits for anyone who
//      guesses it.
//
//   2. The webhook signature is verified. Without that check, anyone who
//      finds the endpoint can POST a fake "payment succeeded" event and grant
//      themselves whatever they like. This is the single most common way a
//      Stripe integration leaks money.
//
// Card details never reach this server: Stripe Checkout collects them on
// Stripe's own page, which keeps you in the simplest PCI compliance tier.

const express = require('express');
const router = express.Router();

const Stripe = require('stripe');
const User = require('../models/User');
const Purchase = require('../models/Purchase');
const requireAuth = require('../middleware/requireAuth');
const { PACKS, getPack, formatPrice } = require('../utils/creditPacks');
const { log } = require('../utils/logger');

// Lazy, like the OpenAI client: constructing Stripe without a key throws, and
// a missing env var should not stop the whole server booting.
let stripeClient = null;
function stripe() {
  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

function baseUrl(req) {
  return process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
}

function page({ title, body, status = 200 }) {
  return {
    status,
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body class="bg-dark text-white">
  <div class="container py-5" style="max-width: 900px;">
    ${body}
  </div>
</body>
</html>`,
  };
}

function send(res, spec) {
  return res.status(spec.status).send(spec.html);
}


/* -------------------------------------------------------------------------
 * The packs
 * ---------------------------------------------------------------------- */

router.get('/buy-credits', requireAuth, async (req, res) => {
  const user = await User.findById(req.session.userId).lean();
  const balance = Number(user?.credits || 0);

  const cards = PACKS.map(pack => `
    <div class="col-md-4">
      <div class="card h-100 ${pack.popular ? 'border-success border-3' : 'border-secondary'} bg-dark text-white">
        <div class="card-body d-flex flex-column">
          ${pack.badge ? `<span class="badge text-bg-success align-self-start mb-2">${pack.badge}</span>` : ''}
          <h4 class="card-title">${pack.name}</h4>
          <p class="text-white-50 mb-3">${pack.blurb}</p>
          <p class="display-6 mb-3">${formatPrice(pack.priceCents)}</p>

          <form action="/api/checkout" method="POST" class="mt-auto">
            <input type="hidden" name="packId" value="${pack.id}">
            <button type="submit" class="btn btn-primary w-100">Buy</button>
          </form>
        </div>
      </div>
    </div>`).join('');

  send(res, page({
    title: 'Buy Credits',
    body: `
      <h1 class="mb-2">Buy Credits</h1>
      <p class="text-white-50">
        You have <strong>${balance.toLocaleString()}</strong> credits.
        A typical website uses about 1,100.
      </p>

      <div class="row g-3 mt-3">${cards}</div>

      <p class="text-white-50 small mt-4">
        Payments are handled by Stripe. Your card details never touch our servers.
      </p>

      <a href="/dashboard" class="btn btn-outline-light mt-3">Back to Dashboard</a>`,
  }));
});


/* -------------------------------------------------------------------------
 * Checkout
 * ---------------------------------------------------------------------- */

router.post('/api/checkout', requireAuth, async (req, res) => {
  try {
    // The pack id comes from the browser; the price and credits come from
    // OUR definition. Trusting posted amounts would let anyone buy 20,000
    // credits for a dollar.
    const pack = getPack(req.body.packId);

    if (!pack) {
      return send(res, page({
        status: 400,
        title: 'Unknown pack',
        body: `<h1>That pack does not exist</h1>
               <a href="/buy-credits" class="btn btn-primary mt-3">Back to packs</a>`,
      }));
    }

    const user = await User.findById(req.session.userId).lean();
    if (!user) return res.redirect('/login');

    const session = await stripe().checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],

      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: pack.priceCents,
          product_data: {
            name: pack.name,
            description: pack.blurb,
          },
        },
      }],

      // Carried through to the webhook, which is where credits are added.
      // The webhook must not have to guess who paid or what for.
      client_reference_id: String(user._id),
      metadata: {
        userId: String(user._id),
        packId: pack.id,
        credits: String(pack.credits),
      },

      customer_email: user.email,

      success_url: `${baseUrl(req)}/credits/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl(req)}/credits/cancelled`,
    });

    log.info('billing.checkout.created', {
      requestId: req.id,
      userId: String(user._id),
      packId: pack.id,
      amountCents: pack.priceCents,
      stripeSessionId: session.id,
      url: session.url
    });

    return res.redirect(303, session.url);

  } catch (err) {
    log.error('billing.checkout.failed', err, {
      requestId: req.id,
      userId: req.session?.userId,
    });

    return send(res, page({
      status: 500,
      title: 'Checkout failed',
      body: `<h1>We could not start the checkout</h1>
             <p class="lead">No payment was taken. Please try again.</p>
             <a href="/buy-credits" class="btn btn-primary mt-3">Back to packs</a>`,
    }));
  }
});


/* -------------------------------------------------------------------------
 * The webhook — where credits are actually granted
 * ---------------------------------------------------------------------- */

/**
 * NOTE ON BODY PARSING
 * The signature is computed over the RAW body, so this route must receive
 * the unparsed bytes. server.js mounts express.raw() for this path before
 * express.json() — if that ordering is lost, every webhook fails verification
 * and no one ever receives their credits.
 */
router.post(
  '/api/stripe-webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe().webhooks.constructEvent(
        req.body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      // Either a misconfigured secret or someone posting a forged event.
      log.security('billing.webhook.badSignature', {
        message: err.message,
        ip: req.ip,
      });
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Acknowledge quickly. Stripe retries on anything slow or non-2xx, and a
    // retry storm while we work is not helpful.
    if (event.type !== 'checkout.session.completed') {
      return res.json({ received: true });
    }

    const session = event.data.object;

    try {
      // 'paid' is the only status that means money moved. A session can be
      // completed while payment is still pending for some methods.
      if (session.payment_status !== 'paid') {
        log.info('billing.webhook.notPaid', {
          stripeSessionId: session.id,
          paymentStatus: session.payment_status,
        });
        return res.json({ received: true });
      }

      const userId = session.metadata?.userId || session.client_reference_id;
      const packId = session.metadata?.packId;
      const pack = getPack(packId);

      if (!userId || !pack) {
        log.error('billing.webhook.missingMetadata', new Error('Cannot identify the purchase'), {
          stripeSessionId: session.id, userId, packId,
        });
        return res.json({ received: true });   // do not make Stripe retry a broken event
      }

      // THE IDEMPOTENCY GUARD.
      //
      // Stripe retries. Without this, a retry credits the user a second time.
      // The unique index on stripeSessionId means the second insert throws
      // rather than duplicating — relying on the database, not on a check
      // that could race with a concurrent retry.
      let purchase;
      try {
        purchase = await Purchase.create({
          user: userId,
          stripeSessionId: session.id,
          stripePaymentIntentId: session.payment_intent,
          packId: pack.id,
          credits: pack.credits,
          amountCents: session.amount_total,
          currency: session.currency,
          status: 'pending',
        });
      } catch (err) {
        if (err.code === 11000) {
          log.info('billing.webhook.duplicate', { stripeSessionId: session.id });
          return res.json({ received: true, duplicate: true });
        }
        throw err;
      }

      // $inc rather than read-modify-write: two credits landing at once would
      // otherwise lose one.
      const updated = await User.findByIdAndUpdate(
        userId,
        { $inc: { credits: pack.credits } },
        { new: true }
      );

      purchase.status = 'completed';
      purchase.completedAt = new Date();
      purchase.creditsAfter = updated?.credits;
      await purchase.save();

      log.info('billing.webhook.credited', {
        userId: String(userId),
        packId: pack.id,
        credits: pack.credits,
        amountCents: session.amount_total,
        creditsAfter: updated?.credits,
        stripeSessionId: session.id,
      });

      return res.json({ received: true });

    } catch (err) {
      log.error('billing.webhook.failed', err, { stripeSessionId: session?.id });

      // 500 asks Stripe to retry — the right response when OUR side failed
      // and the customer has paid but not been credited.
      return res.status(500).json({ error: 'Webhook handler failed' });
    }
  }
);


/* -------------------------------------------------------------------------
 * Landing pages
 * ---------------------------------------------------------------------- */

router.get('/credits/success', requireAuth, async (req, res) => {
  // Deliberately does NOT grant credits — the webhook does that. This page is
  // reachable by anyone who guesses the URL.
  const user = await User.findById(req.session.userId).lean();

  send(res, page({
    title: 'Payment received',
    body: `
      <h1>Thank you</h1>
      <p class="lead">Your payment went through.</p>
      <p class="text-white-50">
        You now have <strong>${Number(user?.credits || 0).toLocaleString()}</strong> credits.
        If the number looks unchanged, give it a few seconds and refresh —
        payment confirmations can take a moment to arrive.
      </p>
      <div class="d-flex gap-2 mt-4">
        <a href="/" class="btn btn-primary">Generate a website</a>
        <a href="/dashboard" class="btn btn-outline-light">Dashboard</a>
      </div>`,
  }));
});

router.get('/credits/cancelled', requireAuth, (req, res) => {
  send(res, page({
    title: 'Payment cancelled',
    body: `
      <h1>Payment cancelled</h1>
      <p class="lead">Nothing was charged.</p>
      <div class="d-flex gap-2 mt-4">
        <a href="/buy-credits" class="btn btn-primary">Back to packs</a>
        <a href="/dashboard" class="btn btn-outline-light">Dashboard</a>
      </div>`,
  }));
});

module.exports = router;