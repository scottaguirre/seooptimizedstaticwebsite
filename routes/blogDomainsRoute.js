// routes/blogDomainsRoute.js
//
// The pool: which Cloudflare accounts this app can publish into, and which
// domains customers may put a blog on.
//
// WHY A SCREEN AND NOT CONFIGURATION
//
// So account eleven can be added without a deploy. Ten accounts in .env is
// ten variables, a restart to apply them, and ten live Cloudflare tokens
// sitting in one file on one server.
//
// THE ONE THING THIS SCREEN MUST NEVER DO
//
// Show a token back. It takes one in, seals it, and from then on the only
// thing anybody sees is the last four characters. A field that helpfully
// redisplays what was typed would put ten customers' live Cloudflare
// credentials into the HTML of a page, into the browser cache, and into
// whatever sits between.
//
// WHY ITS OWN FILE RATHER THAN adminRoute.js
//
// adminRoute.js is sixteen kilobytes with no suite of its own. This holds
// credentials, so it gets a file and a suite where every route can be
// asserted to be admin-only — see test-blog-domains.js, which checks the
// guard per route rather than trusting it once.

const express = require('express');

const requireAdmin = require('../middleware/requireAdmin');
const CloudflareAccount = require('../models/CloudflareAccount');
const Domain = require('../models/Domain');
const { seal } = require('../utils/blog/cloudflare/secretBox');
const { scrub } = require('../utils/blog/cloudflare/deploy');
/* REQUIRED AS A MODULE, NOT DESTRUCTURED, so verifyAccount is looked up when
 * it is called. The suite replaces it with a stub exactly as it replaces the
 * Mongoose model methods; destructuring here would bind the real one at
 * require time and every test that adds an account would make a live call to
 * Cloudflare. */
const cloudflare = require('../utils/blog/cloudflare/accounts');
const { accountCapacity } = require('../utils/blog/cloudflare/accounts');
const { withAppHeader } = require('../utils/appHeader');
const { pageTitle } = require('../utils/pageTitle');
const { log } = require('../utils/logger');

const router = express.Router();

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function page({ title, body, status = 200 }) {
  return {
    status,
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${pageTitle(title)}</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
{{HEADER_ASSETS}}
</head>
<body style="background:#082d5b;" class="text-white">
{{HEADER}}
{{SIDEBAR}}
  <div class="container py-5" style="max-width: 1000px;">
    ${body}
  </div>
{{HEADER_SCRIPTS}}
  <!-- THE EYE ON THE TOKEN FIELD. The script finds every input[type=password]
       on the page and wraps it, so this page gets the behaviour by loading it
       and nothing here needs to know how.

       It matters more here than on a login form: a login password is one the
       person knows, and a Cloudflare API token is 40 characters of noise that
       sometimes has to be typed by hand from another screen. With no way to
       read it back, the only way to find a typo is to submit and be refused.

       DEFER, because the script wires itself on DOMContentLoaded and this tag
       sits after the form either way. -->
  <script src="/js/passwordToggle.js" defer></script>
</body>
</html>`,
  };
}

function send(res, spec) {
  return res.status(spec.status).send(withAppHeader(spec.html, res));
}

/**
 * What somebody typed, as a registrable domain.
 *
 * SOMEBODY WILL PASTE A URL. Storing "https://AcmeHVAC.com/" would make the
 * dropdown offer it, the hostname check miss it and the zone lookup fail —
 * three symptoms, one cause, and none of them obviously the paste.
 *
 * Returns '' for anything that is not one, INCLUDING A SUBDOMAIN. The
 * customer supplies the prefix, so a pool entry of "blog.acmehvac.com"
 * would produce "hvac.blog.acmehvac.com" — which is not what anybody meant
 * and which Cloudflare will happily create.
 */
function normaliseDomain(raw) {
  const text = String(raw == null ? '' : raw)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.+$/, '');

  /* TWO LABELS, AND NO MORE. A loose check here is a domain that looks
   * fine on the screen and fails at Cloudflare weeks later. */
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?\.[a-z]{2,}$/.test(text)) return '';

  return text;
}

/**
 * Is this even shaped like an account ID?
 *
 * DELIBERATELY LOOSE, AND THAT IS NOT LAZINESS. Every Cloudflare account ID
 * anybody has seen is 32 hexadecimal characters, but Cloudflare does not
 * publish the format, and a strict regex built on a guess would one day
 * refuse a perfectly good ID with no way around it.
 *
 * So this rejects only what an account ID demonstrably is NOT — anything
 * holding an @, whitespace, a dot or a slash. That is an email address, a
 * pasted dashboard URL, and a copied line with a stray space, which between
 * them are every wrong thing a person actually types here.
 *
 * It is the cheap guard. verifyAccount() is the real one: it asks Cloudflare.
 * This exists so the obvious mistakes are answered instantly and specifically
 * instead of coming back as "Invalid account identifier".
 */
function looksLikeAccountId(raw) {
  const text = String(raw == null ? '' : raw).trim();

  if (!text) return false;

  return !/[@\s./\\:]/.test(text);
}

/**
 * How long ago, in words a person reads rather than parses.
 *
 * THE HALF THAT MAKES THE NUMBER HONEST. "0 / 100" is read as current, and
 * on Edwin's Aguirre Negro account it had been wrong since the hour it was
 * written — the count was taken before the blog existed. "1 / 100 · checked
 * 3 days ago" is read as what it actually is.
 *
 * NEVER-COUNTED IS SAID OUT LOUD, not left blank. An account added before
 * any of this existed has no timestamp, and an empty space beside the number
 * reads as "just checked" — the same lie, told by omission.
 */
function ago(when) {
  const at = when ? new Date(when).getTime() : 0;

  if (!at || Number.isNaN(at)) return 'never checked';

  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));

  if (seconds < 90) return 'checked just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `checked ${minutes} minutes ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `checked ${hours} ${1 === hours ? 'hour' : 'hours'} ago`;

  const days = Math.round(hours / 24);
  return `checked ${days} ${1 === days ? 'day' : 'days'} ago`;
}

function problem(res, title, detail) {
  return send(res, page({
    status: 400,
    title,
    body: `<h1 class="h3">${esc(title)}</h1>
           <p class="lead">${esc(detail)}</p>
           <a href="/admin/blog-domains" class="btn btn-primary mt-3">Back</a>`,
  }));
}

/* -------------------------------------------------------------------------
 * The screen
 * ---------------------------------------------------------------------- */

router.get('/admin/blog-domains', requireAdmin, async (req, res) => {
  try {
    const accounts = await CloudflareAccount.find().sort({ label: 1 }).lean();
    const domains = await Domain.find().sort({ domain: 1 }).lean();

    const byId = new Map(accounts.map(a => [String(a._id), a]));

    /* THE LAST FOUR AND THE CAPACITY. NOT THE TOKEN, SEALED OR OTHERWISE —
     * the stored value never reaches this template at all, which is a
     * stronger guarantee than remembering not to print it. */
    const accountRows = accounts.map((a, i) => {
      const room = accountCapacity(a);

      return `
      <tr>
        <td class="rownum">${i + 1}</td>
        <td>${esc(a.label)}</td>
        <td class="text-white-50 small"><code>${esc(a.accountId)}</code></td>
        <td class="text-white-50 small">…${esc(a.tokenLast4 || '')}</td>
        <td class="text-end ${room.nearlyFull ? 'text-warning' : 'text-white-50'}">
          ${room.used} / ${room.limit}
          <div class="small text-white-50">${esc(ago(a.projectsCountedAt))}</div>
        </td>
        <td>${a.enabled ? '' : '<span class="badge bg-secondary">disabled</span>'}</td>
      </tr>`;
    }).join('');

    const domainRows = domains.map((d, i) => {
      const owner = byId.get(String(d.account));

      return `
      <tr>
        <td class="rownum">${i + 1}</td>
        <td><code>${esc(d.domain)}</code></td>
        <td class="text-white-50">${esc(d.label || '')}</td>
        <td class="text-white-50">${esc(owner ? owner.label : '— account missing —')}</td>
        <td>${d.enabled ? '' : '<span class="badge bg-secondary">off the list</span>'}</td>
      </tr>`;
    }).join('');

    const accountOptions = accounts
      .filter(a => false !== a.enabled)
      .map(a => `<option value="${esc(a._id)}">${esc(a.label)}</option>`)
      .join('');

    send(res, page({
      title: 'Blog domains',
      body: `
        <h1 class="mb-1">Blog domains</h1>
        <p class="text-white-50">
          The Cloudflare accounts blogs are published into, and the domains
          customers can choose from. A customer picks a domain and types a
          prefix; because the zone is on the same account as the Pages
          project, Cloudflare writes the DNS record itself.
        </p>

        <h2 class="h4 mt-5 mb-3">Cloudflare accounts</h2>

        ${accounts.length ? `
        <table class="table table-navy align-middle">
          <thead><tr><th></th><th>Account</th><th>Cloudflare ID</th><th>Token</th>
            <th class="text-end">Projects</th><th></th></tr></thead>
          <tbody>${accountRows}</tbody>
        </table>

        ${/* THE BUTTON, BECAUSE A FEATURE NOTHING LINKS TO IS A FEATURE
              NOBODY USES — a mistake this codebase has now made twice, once
              with the whole of this screen.

              A POST, not a link: it makes one Cloudflare request per
              account and writes to all of them, which is not something a
              crawler, a prefetch or a back button should be able to set
              off. */ ''}
        <form method="post" action="/admin/blog-domains/refresh" class="mb-4">
          ${res.locals.csrfField || ''}
          <button class="btn btn-sm btn-outline-light" type="submit">
            Refresh project counts
          </button>
          <span class="form-text text-white-50 ms-2">
            One call to Cloudflare per account. The counts above are only
            true as of when they were last taken.
          </span>
        </form>` : '<p class="text-white-50">No accounts yet.</p>'}

        <form method="post" action="/admin/blog-domains/accounts" class="row g-2 mb-4">
          ${res.locals.csrfField || ''}
          <div class="col-md-3">
            <label class="form-label" for="label">Name</label>
            <input class="form-control" id="label" name="label" required maxlength="120"
                   placeholder="Client 3 — Acme HVAC">
          </div>
          <div class="col-md-4">
            <label class="form-label" for="accountId">Cloudflare account ID</label>
            ${/* autocomplete=off HERE TOO, and for the same reason as the
                  token below: it is the FIRST half of what a browser reads
                  as a login. Edwin's filled this one with his email
                  address. */ ''}
            <input class="form-control font-monospace" id="accountId" name="accountId"
                   required maxlength="64" spellcheck="false"
                   autocomplete="off" autocorrect="off" autocapitalize="off">
          </div>
          <div class="col-md-4">
            <label class="form-label" for="token">API token</label>
            ${/* type=password SO IT IS NOT READ OVER A SHOULDER OR LEFT ON
                  SCREEN. It is never rendered back, so there is nothing to
                  prefill.

                  autocomplete="new-password", NOT "off". This field was
                  autocomplete="off" and Chrome filled it anyway — browsers
                  ignore "off" on password fields precisely BECAUSE sites
                  used it to defeat password managers, so the one value that
                  is honoured is the one that says "this is a password being
                  SET, do not offer a saved one".

                  Without it the pair above reads as a login form, and what
                  lands in this box is a saved password rather than the
                  token. Sealed and stored, that is a credential that
                  authenticates as nothing, found weeks later inside a
                  deploy. verifyAccount() now refuses it either way; this
                  stops it being typed in the first place.

                  public/js/passwordToggle.js finds every password field on
                  a page it is loaded on and adds a show/hide eye, so a
                  token that has to be typed by hand can be read back. */ ''}
            <input class="form-control" id="token" name="token" type="password"
                   required maxlength="200" spellcheck="false"
                   autocomplete="new-password" autocorrect="off" autocapitalize="off">
          </div>
          <div class="col-md-1 d-flex align-items-end">
            <button class="btn btn-outline-light" type="submit">Add</button>
          </div>
          <div class="form-text text-white-50">
            The token needs Pages: Edit, DNS: Edit and Zone: Read on that
            account. It is encrypted before it is stored and is never shown
            again — only the last four characters. Adding it makes one call
            to Cloudflare to check the pair works; nothing is saved if it
            does not.
          </div>
        </form>

        <h2 class="h4 mt-5 mb-3">Domains</h2>

        ${domains.length ? `
        <table class="table table-navy align-middle">
          <thead><tr><th></th><th>Domain</th><th>Label</th><th>Account</th><th></th></tr></thead>
          <tbody>${domainRows}</tbody>
        </table>` : '<p class="text-white-50">No domains yet.</p>'}

        ${accounts.length ? `
        <form method="post" action="/admin/blog-domains/domains" class="row g-2">
          ${res.locals.csrfField || ''}
          <div class="col-md-4">
            <label class="form-label" for="domain">Domain</label>
            <input class="form-control" id="domain" name="domain" required maxlength="253"
                   placeholder="acmehvac.com" spellcheck="false">
          </div>
          <div class="col-md-3">
            <label class="form-label" for="label2">Label</label>
            <input class="form-control" id="label2" name="label" maxlength="120"
                   placeholder="Acme HVAC">
          </div>
          <div class="col-md-4">
            <label class="form-label" for="account">Cloudflare account</label>
            <select class="form-select" id="account" name="account" required>
              ${accountOptions}
            </select>
          </div>
          <div class="col-md-1 d-flex align-items-end">
            <button class="btn btn-outline-light" type="submit">Add</button>
          </div>
          <div class="form-text text-white-50">
            The registrable domain only — a customer supplies the prefix.
            Its zone must already be on the account chosen, or Cloudflare
            will not write the DNS record and the customer is back to
            pasting a CNAME.
          </div>
        </form>` : ''}`,
    }));

  } catch (err) {
    log.error('blogDomains.show.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: '<h1>We could not load that</h1>',
    }));
  }
});

/* -------------------------------------------------------------------------
 * Re-counting the Pages projects on every account
 * ---------------------------------------------------------------------- */

router.post('/admin/blog-domains/refresh', requireAdmin, async (req, res) => {
  try {
    const accounts = await CloudflareAccount.find().sort({ label: 1 }).lean();

    const failures = [];
    let counted = 0;

    /* ONE AT A TIME, ON PURPOSE. Ten accounts is ten Cloudflare requests;
     * firing them together would be faster and would also be ten
     * simultaneous authenticated calls from one server, which is how an
     * account ends up rate limited for the sake of a screen nobody is
     * watching the clock on. */
    for (const account of accounts) {
      const out = await cloudflare.recountAccount(account);

      if (!out.ok) {
        /* RECORDED AND CARRIED PAST, NOT THROWN. recountAccount reports
         * rather than throwing precisely so one revoked token does not
         * leave the other nine accounts unread — a refresh that gives up
         * halfway is one that quietly does nothing on the day it matters.
         *
         * The message already names the account; see recountAccount. */
        failures.push(out.error);
        continue;
      }

      /* WRITTEN ONLY ON SUCCESS, AND THE TIMESTAMP IS THE SUBTLE HALF.
       * Stamping projectsCountedAt on a failure would make a stale number
       * look freshly checked — the exact lie this whole feature exists to
       * stop, told more convincingly than before. */
      await CloudflareAccount.updateOne(
        { _id: account._id },
        { $set: { projects: out.projects, projectsCountedAt: new Date() } }
      );

      counted += 1;
    }

    /* THE TOKEN IS NOT LOGGED, and neither is anything derived from it.
     * recountAccount has already scrubbed its own messages. */
    log.info('blogDomains.countsRefreshed', {
      requestId: req.id,
      counted,
      failed: failures.length,
    });

    if (failures.length) {
      /* A PAGE, NOT A REDIRECT, because a silent skip is the failure mode
       * that matters here: somebody reads a stale number believing it was
       * just checked. The accounts that DID refresh are already saved, so
       * this reports rather than undoes. */
      return send(res, page({
        title: 'Project counts refreshed',
        body: `
          <h1 class="h3">Refreshed ${counted} of ${accounts.length}</h1>

          <div class="alert alert-warning">
            <p><strong>These accounts could not be counted, and their
            numbers are unchanged:</strong></p>
            <ul class="mb-0">
              ${failures.map(f => `<li>${esc(f)}</li>`).join('')}
            </ul>
          </div>

          <a href="/admin/blog-domains" class="btn btn-primary mt-3">Back</a>`,
      }));
    }

    res.redirect('/admin/blog-domains');

  } catch (err) {
    log.error('blogDomains.refresh.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: '<h1>We could not refresh the counts</h1>',
    }));
  }
});

/* -------------------------------------------------------------------------
 * Adding an account
 * ---------------------------------------------------------------------- */

router.post('/admin/blog-domains/accounts', requireAdmin, async (req, res) => {
  try {
    const label = String(req.body.label || '').trim();
    const accountId = String(req.body.accountId || '').trim();
    const token = String(req.body.token || '').trim();

    /* ALL THREE, REFUSED HERE. cfApi() and childEnv() already refuse half a
     * credential at the point of use — but that error arrives weeks later,
     * inside somebody's deploy, naming nothing a person can act on. */
    if (!label || !accountId || !token) {
      return problem(res, 'That account is not complete',
        'A name, the Cloudflare account ID and an API token are all needed.');
    }

    /* THE CHEAP GUARD, BEFORE THE NETWORK ONE. An email address here is not
     * a Cloudflare error worth a round trip — it is a browser having
     * autofilled a login, and saying so is more use than relaying "Invalid
     * account identifier". */
    if (!looksLikeAccountId(accountId)) {
      return problem(res, 'That is not a Cloudflare account ID',
        'A Cloudflare account ID is a single run of letters and digits — no '
        + '@, no spaces, no dots. If your browser filled this in for you, '
        + 'clear both fields: it has mistaken this form for a login and put '
        + 'a saved password in the token box too. Find the real ID in the '
        + 'Cloudflare dashboard with Cmd-K, "Copy account ID".');
    }

    if (await CloudflareAccount.findOne({ accountId })) {
      /* Two rows for one Cloudflare account hold two tokens for one place,
       * and nothing would say which is current. */
      return problem(res, 'That account is already here',
        `There is already an entry for ${accountId}.`);
    }

    /* USED ONCE BEFORE THEY ARE STORED.
     *
     * Everything above refuses a row that is obviously wrong. This refuses
     * one that is plausibly wrong, which is the dangerous kind: a revoked
     * token, yesterday's token, or — worst — a valid token belonging to a
     * DIFFERENT Cloudflare account, which authenticates perfectly and
     * publishes a client's blog into somebody else's account.
     *
     * The cost of not doing this is not a bad row. It is a bad row that
     * reports success, sits there, and fails inside a deploy weeks later
     * with an error naming neither this form nor the person who filled it. */
    const checked = await cloudflare.verifyAccount({ accountId, token });

    if (!checked.ok) {
      /* SCRUBBED AGAIN HERE, AND NOT BECAUSE cfApi FORGOT TO.
       *
       * cfApi scrubs every error it produces, so in practice this is a
       * second pass over text that is already clean. It is done anyway
       * because THIS is the line that turns the value into HTML, and this
       * is the only place that holds the token for certain.
       *
       * The alternative is a page whose safety depends on a function three
       * modules away continuing to behave — and the cost of being wrong
       * about that is a live Cloudflare token rendered into a page, a
       * browser cache, and whatever sits between. A redundant scrub is the
       * cheapest thing in this file. */
      return problem(res, 'Cloudflare did not accept those credentials',
        `${scrub(checked.error, { token, account: accountId })} — nothing was `
        + 'saved. Check the account ID, and that the token is for THAT '
        + 'account with Pages: Edit, DNS: Edit and Zone: Read.');
    }

    await CloudflareAccount.create({
      label,
      accountId,
      /* SEALED BEFORE IT IS WRITTEN, and the plaintext goes no further than
       * this function. See utils/blog/cloudflare/secretBox.js. */
      token: seal(token),
      tokenLast4: token.slice(-4),
      /* FROM CLOUDFLARE, NOT FROM US. The check above had to list the
       * account's Pages projects to prove the token works on it, so the
       * count is already in hand and the Projects column starts out true
       * rather than at a placeholder 0. It still goes stale from here —
       * nothing refreshes it yet. */
      projects: checked.projects,
      projectsCountedAt: new Date(),
    });

    /* THE TOKEN IS NOT LOGGED. Not its length, not its first characters.
     * The label is what identifies the row everywhere else. */
    log.info('blogDomains.accountAdded', {
      requestId: req.id,
      label,
      accountId,
    });

    res.redirect('/admin/blog-domains');

  } catch (err) {
    log.error('blogDomains.addAccount.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: '<h1>We could not save that account</h1>',
    }));
  }
});

/* -------------------------------------------------------------------------
 * Adding a domain
 * ---------------------------------------------------------------------- */

router.post('/admin/blog-domains/domains', requireAdmin, async (req, res) => {
  try {
    const domain = normaliseDomain(req.body.domain);
    const accountId = String(req.body.account || '').trim();

    if (!domain) {
      return problem(res, 'That is not a domain we can use',
        'It has to be a registrable domain such as acmehvac.com — not a '
        + 'subdomain, since the customer supplies the prefix.');
    }

    if (!accountId) {
      return problem(res, 'That domain has no account',
        'Pick the Cloudflare account its zone is on.');
    }

    /* THE ACCOUNT HAS TO EXIST. A domain pointing at one that does not is a
     * domain whose blogs cannot deploy — and credsFor() would throw at
     * publish time, a long way from the form that caused it. */
    const account = await CloudflareAccount.findById(accountId);

    if (!account) {
      return problem(res, 'That Cloudflare account is not here',
        'Add the account first, then the domain.');
    }

    if (await Domain.findOne({ domain })) {
      /* Two rows for one domain pointing at different accounts is an
       * ambiguity made permanent: whichever the lookup returned would
       * decide where a blog was created. */
      return problem(res, 'That domain is already in the pool',
        `${domain} is already listed.`);
    }

    await Domain.create({
      domain,
      account: account._id,
      label: String(req.body.label || '').trim(),
    });

    log.info('blogDomains.domainAdded', {
      requestId: req.id,
      domain,
      account: account.label,
    });

    res.redirect('/admin/blog-domains');

  } catch (err) {
    log.error('blogDomains.addDomain.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: '<h1>We could not save that domain</h1>',
    }));
  }
});

module.exports = router;
module.exports.normaliseDomain = normaliseDomain;
