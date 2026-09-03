// === Required Modules and Setup ===
const fs = require('fs');
require('dotenv').config();
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const distDir = path.join(__dirname, 'dist');



// === Route Imports ===
const formRoute = require('./routes/formRoute');
const authRoute = require('./routes/authRoute');
const adminRoute = require('./routes/adminRoute');
const creditsRoute = require('./routes/creditsRoute');
const requireAuth = require('./middleware/requireAuth');
const { requireOwnDist } = require('./middleware/requireOwnDist');
const helmet = require('helmet');
const { log } = require('./utils/logger');
const { requestId } = require('./middleware/requestId');
const { csrfToken, csrfProtect } = require('./middleware/csrf');
const mongoSanitize = require('express-mongo-sanitize');
const {
  authLimiter,
  emailLimiter,
  generateLimiter,
  generalLimiter,
} = require('./middleware/rateLimits');
const generateRoute = require('./routes/generateRoute');
const productionRoute = require('./routes/productionRoute');
const downloadZipRoute = require('./routes/downloadZipRoute');
const exportWpThemeRoute = require('./routes/exportWpThemeRoute');

// Blog automation.
//
// Three routers, and the split matters:
//
//   blogApiRoute + blogTopicsRoute  called by the WordPress plugin. No session,
//                                   no CSRF token, no browser — authenticated
//                                   by an HMAC signature instead. Mounted
//                                   BELOW, before the requireAuth block.
//
//   blogSitesRoute                  a normal admin page for the logged-in
//                                   customer. Mounted WITH requireAuth.
const blogApiRoute = require('./routes/blogApiRoute');
const blogTopicsRoute = require('./routes/blogTopicsRoute');
const blogSitesRoute = require('./routes/blogSitesRoute');




// Connecting to Mongo
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('✅ Connected to MongoDB');
}).catch((err) => {
    console.error('❌ MongoDB connection error:', err);
});
  


const app = express();
const PORT = 3000;



// ===== STATIC FILES =====
app.use(express.static('public'));


// ===== BODY PARSERS =====
// The Stripe webhook needs the RAW body: Stripe signs the exact bytes, and
// once express.json() has parsed them the signature can never be verified —
// every webhook would fail and nobody who paid would get their credits.
//
// Only the body parsing goes here. The billing ROUTER is mounted further
// down, after the session middleware, because its other routes use
// requireAuth and req.session does not exist yet at this point.
app.use('/api/stripe-webhook', express.raw({ type: 'application/json' }));

app.use(express.urlencoded({ extended: true }));

// The Interlink Engine plugin signs the EXACT BYTES of its request body, so
// the raw buffer has to be kept for those paths. A re-serialised object does
// not reproduce it — key order and whitespace both differ — and every
// signature would fail with no useful error.
//
// Same problem as the Stripe webhook above, different solution: Stripe needs
// the raw body INSTEAD of a parsed one, this needs it AS WELL AS.
app.use(express.json({
  verify: (req, res, buf) => {
    if (req.path.startsWith('/api/blog/')) {
      req.rawBody = buf;
    }
  },
}));


// ===== Express Session Middleware
// A predictable session secret means anyone can forge a session cookie and
// log in as any user. Failing to boot is far better than running insecurely
// because an environment variable was forgotten.
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET is not set. Refusing to start in production.');
  process.exit(1);
}

// Behind Hostinger, nginx or any proxy, req.ip is the proxy without this —
// so every visitor would share one rate-limit bucket, and `secure` cookies
// would never be sent.
app.set('trust proxy', 1);

// Before anything that might log, so every entry can be correlated.
app.use(requestId);

app.use(session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGO_URI
}),
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
        httpOnly: true,                  // JavaScript cannot read it
        // HTTPS only in production. Left off in development so the cookie
        // still works over plain http on localhost.
        secure: process.env.NODE_ENV === 'production',
        // Blocks the cookie on cross-site POSTs, which stops the most common
        // form of CSRF. 'lax' rather than 'strict' so following a link into
        // the app keeps the user logged in.
        sameSite: 'lax'
    }
}));


// ===== SECURITY HEADERS =====
//
// helmet sets the standard set: X-Frame-Options, X-Content-Type-Options,
// Referrer-Policy, HSTS and so on.
//
// The Content-Security-Policy is written explicitly rather than taking the
// default, because the default blocks inline styles and scripts — which this
// app uses on its own generated pages — and the jsDelivr CDN that serves
// Bootstrap. A CSP that breaks the app gets switched off, so it is better to
// state exactly what is allowed.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],

      // 'unsafe-inline' is needed for the inline <script> on the generation
      // success page and the wizard's inline handlers. Worth removing later
      // by moving those to files and adding a nonce; noted, not urgent.
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://js.stripe.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],

      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      fontSrc: ["'self'", 'data:', 'https://cdn.jsdelivr.net'],
      // jsdelivr is here only so DevTools can fetch Bootstrap's source maps.
      // Without it the console fills with CSP errors that look alarming and
      // mean nothing — which makes real errors easy to miss.
      connectSrc: ["'self'", 'https://api.stripe.com', 'https://cdn.jsdelivr.net'],

      // Generated previews embed YouTube and Google Maps
      frameSrc: [
        "'self'",
        'https://www.youtube.com',
        'https://www.google.com',
        'https://maps.google.com',
        // 3-D Secure challenges are shown in a Stripe-hosted iframe
        'https://checkout.stripe.com',
        'https://js.stripe.com',
        'https://hooks.stripe.com',
      ],

      objectSrc: ["'none'"],          // no Flash/Java applets
      baseUri: ["'self'"],            // stop <base> hijacking relative URLs
      // Stripe Checkout is a redirect to Stripe's own domain, so it must be
      // allowed here. With 'self' alone the browser silently refuses the
      // redirect and the user just stays on the page — no error, no payment.
      formAction: ["'self'", 'https://checkout.stripe.com'],
      frameAncestors: ["'self'"],     // clickjacking protection
    },
  },

  // Generated site previews load images and iframes from other origins;
  // the strict default would block them.
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },

  // Tell browsers to use HTTPS for a year. Only meaningful over HTTPS, and
  // only enabled in production so local development still works.
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true, preload: false }
    : false,
}));


// /dist holds every user's generated site. Without a guard, anyone who knew
// a user id could read another customer's work before it was published.
//
// MUST come after app.use(session(...)): mounted earlier, req.session is
// undefined and the guard rejects everyone, including the owner.
app.use('/dist', requireOwnDist, express.static(distDir));


// Strip Mongo operators from anything the user sends. The individual routes
// already cast their inputs, but this catches any field added later that
// someone forgets to cast — defence in depth rather than the only defence.
app.use(mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ key }) => {
    console.warn(`⚠️ Stripped a Mongo operator from request field: ${key}`);
  },
}));


// ===== RATE LIMITS =====
// Auth is limited by IP (no user yet); generation by user, so an office
// behind a single IP is not throttled collectively.
app.use(generalLimiter);
app.use(['/login', '/signup'], authLimiter);
app.use(['/verify', '/resend-verification', '/forgot-password', '/reset-password'], emailLimiter);
app.use(['/generate'], generateLimiter);


// ===== CSRF =====
//
// After the session middleware, because the token lives in the session.
// Before every route, so nothing is left unguarded by accident.
//
// The Stripe webhook is exempt: it is a server-to-server POST with no
// session, authenticated by its signature instead.
app.use(csrfToken);
app.use(csrfProtect);


// Password reset and resend verification.
// The emailLimiter above already covers these paths — it was added for
// routes that did not exist yet.
const passwordRoute = require('./routes/passwordRoute');
app.use('/', passwordRoute);


// Job progress: /jobs/:id and /api/jobs/:id
const jobRoute = require('./routes/jobRoute');
app.use('/', jobRoute);


// Billing: /buy-credits, /api/checkout, /api/stripe-webhook.
// After the session middleware — requireAuth needs req.session.
const billingRoute = require('./routes/billingRoute');
app.use('/', billingRoute);


// Blog automation, called by the plugin on a customer's WordPress.
//
// Above requireAuth deliberately: these requests carry no session cookie and
// would be redirected to /login by it. They are authenticated by requireSite,
// which verifies an HMAC signature over the method, path and body — a stronger
// check than a session, and the reason '/api/blog/' is listed in the CSRF
// exemptions alongside the Stripe webhook.
app.use('/', blogApiRoute);      // /api/blog/activate|plan|write|collect|complete|published
app.use('/', blogTopicsRoute);   // /api/blog/suggest|enrich


// ===== AUTH UNPROTECTED ROUTES FIRST =====
app.use('/', authRoute);
// login, signup, logout
// these must come before requireAuth middleware
  

// ===== PROTECTED ROUTES (requireAuth) =====
app.use('/', requireAuth, creditsRoute);      // /api/check-credits
app.use('/', requireAuth, adminRoute);        // /admin section
app.use('/', requireAuth, formRoute);         // /
app.use('/', requireAuth, generateRoute);     // /generate
app.use('/', requireAuth, productionRoute);   // /production
app.use('/', requireAuth, downloadZipRoute);
app.use('/', requireAuth, exportWpThemeRoute);
app.use('/', requireAuth, blogSitesRoute);    // /blog-sites — licence keys




// ===== ERROR HANDLING =====
//
// Must come after the routes. Two jobs: turn upload rejections into a message
// the user can act on, and make sure nothing else leaks a stack trace to the
// browser — stack traces disclose file paths, dependency versions and code
// structure, all useful to an attacker.
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  // Multer rejections: the user picked a file that is too large or the wrong
  // type, and telling them exactly that is helpful, not a disclosure.
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: 'That image is too large. Please upload a file under 5 MB.',
      fields: [],
    });
  }

  if (err && (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_FIELD_COUNT')) {
    return res.status(413).json({ error: 'Too many files or fields in that request.', fields: [] });
  }

  if (err && /Unsupported file (type|extension)/.test(err.message || '')) {
    return res.status(400).json({ error: err.message, fields: [] });
  }

  // Everything else: record the detail, tell the user nothing useful to
  // attack. The request id is shown to the user so a support conversation can
  // start from "what was the reference?" rather than a guessed timestamp.
  log.error('request.unhandled', err, {
    requestId: req.id,
    method: req.method,
    path: req.path,
    userId: req.session?.userId,
  });

  const wantsJson = req.accepts(['html', 'json']) === 'json'
                 || req.xhr
                 || (req.headers['content-type'] || '').includes('multipart/form-data');

  if (wantsJson) {
    return res.status(500).json({
      error: 'Something went wrong. Please try again.',
      reference: req.id,
      fields: [],
    });
  }

  res.status(500).send(
    `Something went wrong. Please try again. (Reference: ${req.id})`
  );
});


// The background job runner.
//
// Started after the routes so nothing picks up a job before the app is ready
// to report on it. Registering the generator here rather than inside the
// runner keeps that module free of any dependency on site building.
const jobRunner = require('./utils/jobRunner');
const { generateForJob } = require('./utils/jobGenerator');
const { writeCampaign } = require('./utils/blogGenerator');
const { buildForJob } = require('./utils/buildGenerator');

// One runner, two kinds of work. The kind is stored on the Job, and
// claimNextJob only claims kinds this process has a generator for — which
// matters during a rolling deploy, when an older instance would otherwise
// claim a blog job it cannot run and leave it stuck.
jobRunner.registerGenerator('site', generateForJob);
// 'blog' is one job per CAMPAIGN now, not one per post — every post is written
// when the campaign is approved. The kind name is unchanged so a job queued by
// an older instance during a deploy is still claimable.
jobRunner.registerGenerator('blog', writeCampaign);
jobRunner.registerGenerator('build', buildForJob);

// Wakes each customer's WordPress when a post is due. The schedule lives here
// rather than in WP-Cron because WP-Cron fires on a visit, and a brand new
// blog has no visitors — which is the entire reason someone is buying posts.
const blogScheduler = require('./utils/blogScheduler');

app.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);

  // Only after Mongo is connected — both query it immediately, and requeueing
  // stale jobs on a dead connection would just log errors.
  const startWorkers = () => {
    jobRunner.start();
    blogScheduler.start();
  };

  mongoose.connection.once('open', startWorkers);
  if (mongoose.connection.readyState === 1) startWorkers();

  log.info('server.started', { port: PORT, env: process.env.NODE_ENV || 'development' });
});

// A rejected promise nobody caught would otherwise vanish silently and, in
// newer Node versions, can terminate the process.
process.on('unhandledRejection', (reason) => {
  log.error('process.unhandledRejection', reason);
});

process.on('uncaughtException', (err) => {
  log.error('process.uncaughtException', err);
});