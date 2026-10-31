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
/* ONLY EVER COUNTED, NEVER WRITTEN, by this file. A blog names the account
 * it publishes into, so it is the first thing a removal has to ask about. */
const BlogSite = require('../models/BlogSite');
const { seal } = require('../utils/blog/cloudflare/secretBox');
const { scrub } = require('../utils/blog/cloudflare/deploy');
/* REQUIRED AS A MODULE, NOT DESTRUCTURED, so verifyAccount is looked up when
 * it is called. The suite replaces it with a stub exactly as it replaces the
 * Mongoose model methods; destructuring here would bind the real one at
 * require time and every test that adds an account would make a live call to
 * Cloudflare. */
const cloudflare = require('../utils/blog/cloudflare/accounts');
const { accountCapacity } = require('../utils/blog/cloudflare/accounts');
/* SAME REASON AS `cloudflare` ABOVE — findZone is looked up when it is
 * called, so the suite can stub it. Destructured here it would bind the real
 * one at require time and every test that adds a domain would make a live
 * call to Cloudflare. */
const cfDeploy = require('../utils/blog/cloudflare/deploy');
const { withAppHeader } = require('../utils/appHeader');
const { pageTitle } = require('../utils/pageTitle');
const { log } = require('../utils/logger');

const { setupDomain } = require('../utils/github/setupDomain');

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

      /* TWO ROWS PER ACCOUNT, AND THE SECOND ONE IS WHY.
       *
       * The first draft put the token field in the row itself. With eight
       * accounts whose labels are full email addresses, the field was
       * squeezed to about the width of the word "new", the show/hide eye
       * wrapped underneath it, and "checked 45 minutes ago" broke across
       * four lines. A form nobody can read is not a form.
       *
       * So the data stays on one line and the form gets a row of its own,
       * folded away in a <details>. Collapsed, the table is as narrow as it
       * was before any of this was added; opened, the field has the whole
       * width of the table.
       *
       * <details> AND NOT A SCRIPT, deliberately. It is native HTML with no
       * JavaScript at all, which means no inline handler for
       * test-inline-handlers.js to refuse and nothing for the CSP to block.
       * The one thing this screen must never do is depend on a script that
       * quietly is not running. */
      return `
      ${/* --bs-border-width:0 ON THE DATA ROW, so there is no rule drawn
            between an account and its own token form. The border on the
            SECOND row then reads as the divider between accounts, which is
            where a reader expects one. */ ''}
      <tr style="--bs-border-width:0">
        <td class="rownum">${i + 1}</td>
        <td style="min-width:13rem">${esc(a.label)}</td>
        <td class="text-white-50 small"><code>${esc(a.accountId)}</code></td>
        <td class="text-white-50 small text-nowrap">…${esc(a.tokenLast4 || '')}</td>
        ${/* text-nowrap ON BOTH LINES. "1 / 100" and "checked 45 minutes
              ago" are each one fact, and a column narrow enough to break
              them mid-phrase makes the number harder to read than no
              number. */ ''}
        <td class="text-end text-nowrap ${room.nearlyFull ? 'text-warning' : 'text-white-50'}">
          ${room.used} / ${room.limit}
          <div class="small text-white-50 text-nowrap">${esc(ago(a.projectsCountedAt))}</div>
        </td>
        <td class="text-nowrap">${a.enabled ? '' : '<span class="badge bg-secondary">disabled</span>'}</td>
        ${/* A LINK TO A CONFIRMATION, NOT A DELETE BUTTON.
              The GET is read-only: it names the row, counts what points at
              it, and only then offers the POST. No inline click handler
              calling confirm() either — see test-inline-handlers.js, which
              refuses inline handlers anywhere in this app. */ ''}
        <td class="text-end text-nowrap">
          <a class="btn btn-sm btn-outline-danger"
             href="/admin/blog-domains/accounts/${esc(a._id)}/delete">Remove</a>
        </td>
      </tr>
      <tr>
        <td class="pt-0"></td>
        <td colspan="6" class="pt-0">
          <details>
            ${/* THE SUMMARY IS THE CONTROL, so it has to look like one and
                  take a pointer. list-style:none drops the default triangle,
                  which Safari and Chrome draw differently and neither draws
                  in a way that matches the buttons beside it. */ ''}
            <summary class="small text-white-50 d-inline-block"
                     style="cursor:pointer; list-style:none">
              Replace API token &rsaquo;
            </summary>
            <form method="post" action="/admin/blog-domains/accounts/${esc(a._id)}/token"
                  class="row g-2 mt-1 align-items-end">
              ${res.locals.csrfField || ''}
              <div class="col-md-7">
                ${/* A REAL <label>, BECAUSE THE FIELD IS NOW ONE OF EIGHT ON
                      THE PAGE and a placeholder disappears the moment
                      anything is typed. The id carries the row so no two
                      labels point at the same input. */ ''}
                <label class="form-label small mb-1" for="token-${esc(a._id)}">
                  New API token for ${esc(a.label)}
                </label>
                ${/* type=password and autocomplete="new-password" for the same
                      two reasons as the add form below: it is not read over a
                      shoulder, and Chrome does not offer a saved login for it.
                      public/js/passwordToggle.js adds the show/hide eye. */ ''}
                <input class="form-control form-control-sm" type="password" name="token"
                       id="token-${esc(a._id)}"
                       required maxlength="200" spellcheck="false"
                       autocomplete="new-password" autocorrect="off" autocapitalize="off">
              </div>
              <div class="col-auto">
                <button class="btn btn-sm btn-outline-light" type="submit">Replace</button>
              </div>
              <div class="form-text text-white-50">
                Checked against <strong>this</strong> account before anything is
                stored — a token for a different one is refused, not adopted.
                The old token stays in place if Cloudflare says no.
              </div>
            </form>
          </details>
        </td>
      </tr>`;
    }).join('');

    /* TWO KINDS OF ROW IN ONE TABLE — 29 October, when Local Website
     * Options needed the same "pick one from a list" that blogs have had
     * since this pool was built. The question a customer answers is
     * identical, so the list is one list and the row says what is behind
     * it: a Cloudflare account, or a GitHub installation. */
    const domainRows = domains.map((d, i) => {
      const github = 'github' === d.target;

      const owner = github
        ? `installation ${esc(d.githubInstallationId || '—')}`
        : esc((byId.get(String(d.account)) || {}).label || '— account missing —');

      return `
      <tr>
        <td class="rownum">${i + 1}</td>
        <td><code>${esc(d.domain)}</code></td>
        <td class="text-white-50 col-tight">${esc(d.label || '')}</td>
        <td>${github
          ? '<span class="badge bg-dark">websites</span>'
          : '<span class="badge bg-secondary">blogs</span>'}</td>
        ${/* col-tight — 31 October. An account here is commonly one
              unbroken word: an email address, or
              `Aguirre_Negro:https://southbayhomeinspections.com`. A
              browser will not break a word, so this one cell set a
              minimum width nothing could argue with and shoved the GitHub
              column off the right of the screen. The class lets it wrap
              mid-word when it has to. */''}
        <td class="text-white-50 col-tight">${owner}</td>
        <td>${d.enabled ? '' : '<span class="badge bg-secondary">off the list</span>'}</td>

        <!-- SET UP GITHUB — 30 October. Creating <login>.github.io, giving
             it a page, turning Pages on and attaching the domain were four
             steps done by hand on github.com, once per client. That is
             three chances to miss one and a fourth to do the wrong thing
             to the right repository — which is what happened on the 29th,
             when the repository deleted was the root site rather than the
             test project under it, and every site on the domain went down
             at once.

             A BUTTON RATHER THAN PART OF ADDING THE DOMAIN. Four GitHub
             calls would make the Add form slow, and a failure part-way
             would save the domain with a half-built account behind it and
             report the error on a form you had already left.

             SAFE TO PRESS TWICE, which is the property that makes a retry
             button worth having: a repository that exists is found, Pages
             already on answers 409, and a domain already attached is
             attached again to the same value. -->
        <!-- WHAT THE ROW KNOWS ABOUT ITS OWN SETUP — 31 October. The button
             used to look identical on a domain set up an hour ago and one
             never touched, which is the question Edwin asked of it: "I
             thought I had already done the first one."

             THE DATE IS WHAT THE ROW STORES, NOT WHAT GITHUB SAYS. Asking
             GitHub would be four calls per domain on every page load, to
             grey out a button that is safe to press anyway. -->
        ${/* THE STATUS AND THE BUTTON SHARE ONE CELL — 31 October. They
              were two columns, which is two columns' worth of padding and
              two chances to be squeezed, to say one thing about one
              subject. Stacked rather than side by side, the column is as
              wide as the button and no wider. */''}
        <td class="text-end col-actions">${github ? `
          <div class="small mb-1">${d.githubSetupAt
            ? `${d.githubSetupOk
                ? '<span class="badge bg-success">set up</span>'
                : '<span class="badge bg-warning text-dark">domain pending</span>'}
               <span class="text-white-50 ms-1">${esc(new Date(d.githubSetupAt).toDateString())}</span>`
            : '<span class="badge bg-secondary">not set up</span>'}</div>

          <form method="post" action="/admin/blog-domains/${d._id}/setup-github">
            ${res.locals.csrfField || ''}
            <button class="btn btn-sm btn-outline-light" type="submit">${
              d.githubSetupAt ? 'Run again' : 'Set up GitHub'}</button>
          </form>` : ''}</td>
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
            <th class="text-end text-nowrap">Projects</th><th></th><th></th></tr></thead>
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
        ${/* table-responsive — 31 October, as the floor rather than the
              fix. col-tight is what stops this table overflowing; this is
              what makes an overflow SCROLL instead of being clipped, on
              the day somebody adds a ninth column or opens it on a phone.
              A table that runs off the screen hides the controls at its
              right-hand end, and nothing on the page says they are
              there. */''}
        <div class="table-responsive">
        <table class="table table-navy align-middle">
          <thead><tr><th></th><th>Domain</th><th>Label</th><th>For</th><th>Account</th><th></th><th class="text-end">GitHub</th></tr></thead>
          <tbody>${domainRows}</tbody>
        </table>
        </div>` : '<p class="text-white-50">No domains yet.</p>'}

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
        </form>` : ''}

        <!-- A DOMAIN FOR WEBSITES, WHICH IS A DIFFERENT THING BEHIND THE
             SAME QUESTION.

             A blog domain names a Cloudflare account and the customer adds
             a prefix: hvac.acmehvac.com. A website domain names a GITHUB
             INSTALLATION and the customer adds nothing — the site is served
             at the domain followed by the business name,
             acme.com/quality-plumbing/, because one GitHub account serves
             one domain with many sites beneath it.

             SO IT IS A SECOND FORM RATHER THAN A DROPDOWN ON THE FIRST. The
             two have one field in common and three that differ, and a form
             that changes shape by a select is a form where half the fields
             are wrong at any moment. -->
        <h2 class="h4 mt-5 mb-3">A domain for websites</h2>

        <form method="post" action="/admin/blog-domains/site-domains" class="row g-2">
          ${res.locals.csrfField || ''}
          <div class="col-md-4">
            <label class="form-label" for="siteDomain">Domain</label>
            <input class="form-control" id="siteDomain" name="domain" required maxlength="253"
                   placeholder="acme.com" spellcheck="false">
          </div>
          <div class="col-md-3">
            <label class="form-label" for="siteLabel">Label</label>
            <input class="form-control" id="siteLabel" name="label" maxlength="120"
                   placeholder="Acme">
          </div>
          <div class="col-md-4">
            <label class="form-label" for="installation">GitHub installation</label>
            <input class="form-control" id="installation" name="githubInstallationId"
                   required inputmode="numeric" placeholder="176399104">
          </div>
          <div class="col-md-1 d-flex align-items-end">
            <button class="btn btn-outline-light" type="submit">Add</button>
          </div>
          <div class="form-text text-white-50">
            The installation id is the number at the end of
            <code>github.com/settings/installations/&lt;id&gt;</code> after the
            App is installed on that client's account, or whatever
            <code>tools/github-check.js</code> prints. The account's own
            <code>&lt;login&gt;.github.io</code> repository must carry this
            domain, or the sites will only answer on github.io.
          </div>
        </form>`,
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
 * Replacing an account's token
 *
 * ADDED 28 October 2026, the morning after a token was pasted into a chat
 * window and had to be rolled. There was no way to tell this screen about the
 * new one: the add form refuses a second row for an account that is already
 * here, and nothing else writes to the token field. The only repair available
 * was editing Mongo by hand.
 *
 * ONE ACCOUNT PER CLIENT MAKES THIS ROUTINE, NOT EXCEPTIONAL. Tokens get
 * revoked, leaked, expired and replaced by the client. A pool with no way to
 * rotate a credential is a pool that has to be rebuilt to change one.
 * ---------------------------------------------------------------------- */

router.post('/admin/blog-domains/accounts/:id/token', requireAdmin, async (req, res) => {
  try {
    const token = String(req.body.token || '').trim();

    const found = await CloudflareAccount.findById(req.params.id);

    if (!found) {
      return problem(res, 'That account is not here',
        'It may have been removed in another tab. Reload the screen.');
    }

    if (!token) {
      return problem(res, 'No token was given',
        `Nothing was changed on "${found.label}".`);
    }

    /* CHECKED AGAINST THIS ROW'S OWN accountId, AND THE ID IS NOT RE-TYPED.
     *
     * The add form takes an id and a token together, so all it can prove is
     * that the PAIR works. Here the account is already decided — blogs and
     * domains point at this row by _id — so the only open question is
     * whether the new token works ON THAT ACCOUNT.
     *
     * Offering the id for editing here would reintroduce the hazard the add
     * path warns about, with a worse blast radius: a perfectly valid token
     * for a DIFFERENT account, adopted silently by every blog already
     * pointing at this row. Moving an account to a different Cloudflare ID
     * is not a rotation; it is a new account, and it goes through the add
     * form where the pair is checked together. */
    const checked = await cloudflare.verifyAccount({
      accountId: found.accountId,
      token,
    });

    if (!checked.ok) {
      /* SCRUBBED HERE FOR THE SAME REASON AS THE ADD PATH: this is the line
       * that turns the value into HTML, and it is the only place that holds
       * the new token for certain. */
      return problem(res, 'Cloudflare did not accept that token',
        `${scrub(checked.error, { token, account: found.accountId })} — the old `
        + `token is still in place on "${found.label}" and nothing was changed. `
        + 'Check that the new token is for THAT account, with Pages: Edit, '
        + 'DNS: Edit and Zone: Read.');
    }

    /* UPDATED IN PLACE, AND THAT IS THE WHOLE POINT OF THIS ROUTE.
     *
     * BlogSite.cloudflareAccount and Domain.account both hold this row's
     * _id. Delete-and-recreate would give a new one and orphan every
     * reference — credsForAccountId() throws "a Cloudflare account that no
     * longer exists" and the blog cannot deploy until somebody works out
     * why. An $set keeps the _id and every reference with it.
     *
     * THE COUNT COMES ALONG FOR FREE. verifyAccount had to list the
     * account's Pages projects to prove the token works on it, so the
     * Projects column is refreshed by the rotation rather than going stale
     * against a credential that no longer exists. */
    await CloudflareAccount.updateOne(
      { _id: found._id },
      {
        $set: {
          token: seal(token),
          tokenLast4: token.slice(-4),
          projects: checked.projects,
          projectsCountedAt: new Date(),
        },
      }
    );

    /* NOT THE TOKEN, NOT ITS LENGTH, NOT ITS FIRST CHARACTERS. The last four
     * are on the screen already; the log says which row changed and when. */
    log.info('blogDomains.tokenReplaced', {
      requestId: req.id,
      label: found.label,
      accountId: found.accountId,
    });

    res.redirect('/admin/blog-domains');

  } catch (err) {
    log.error('blogDomains.replaceToken.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: '<h1>We could not replace that token</h1>',
    }));
  }
});

/* -------------------------------------------------------------------------
 * Removing an account
 * ---------------------------------------------------------------------- */

/**
 * What would be orphaned by removing this row.
 *
 * BOTH COLLECTIONS, BECAUSE BOTH REFER TO IT. A blog names the account it
 * deploys into; a pool domain names the account its zone is on. The domain
 * list on this very screen already renders "— account missing —" for a row
 * whose account went away, which is this bug's symptom written down months
 * before there was a way to cause it.
 */
async function referencesTo(account) {
  const [blogs, domains] = await Promise.all([
    BlogSite.countDocuments({ cloudflareAccount: account._id }),
    Domain.countDocuments({ account: account._id }),
  ]);

  return { blogs, domains, total: blogs + domains };
}

/** "2 blogs and 1 domain", or "1 blog", in the order they are counted. */
function saysWhat({ blogs, domains }) {
  const parts = [];

  if (blogs) parts.push(`${blogs} ${1 === blogs ? 'blog' : 'blogs'}`);
  if (domains) parts.push(`${domains} ${1 === domains ? 'domain' : 'domains'}`);

  return parts.join(' and ');
}

function refusesRemoval(res, account, refs) {
  return send(res, page({
    status: 400,
    title: 'That account is still in use',
    body: `<h1 class="h3">"${esc(account.label)}" is still in use</h1>
      <p class="lead">${esc(saysWhat(refs))} still point at it.</p>
      <p class="text-white-50">
        Removing it would leave them naming an account that no longer exists,
        and a blog in that state cannot be deployed at all — not even to the
        address it already answers on. Move them to another account first, or
        leave this row in place and disable it.
      </p>
      <a href="/admin/blog-domains" class="btn btn-primary mt-3">Back</a>`,
  }));
}

/* THE CONFIRMATION IS A GET, AND IT CHANGES NOTHING.
 *
 * It exists to say what is about to be destroyed — which is the credential,
 * not the Cloudflare account — and to show the reference counts before
 * anybody commits. The counts are also the refusal, so this page either
 * offers the button or explains why there is not one. */
router.get('/admin/blog-domains/accounts/:id/delete', requireAdmin, async (req, res) => {
  try {
    const found = await CloudflareAccount.findById(req.params.id);

    if (!found) {
      return problem(res, 'That account is not here',
        'It may have been removed already. Reload the screen.');
    }

    const refs = await referencesTo(found);

    if (refs.total) return refusesRemoval(res, found, refs);

    send(res, page({
      title: 'Remove account',
      body: `<h1 class="h3">Remove "${esc(found.label)}"?</h1>

        <p class="lead">
          This deletes the stored credentials for Cloudflare account
          <code>${esc(found.accountId)}</code> — the API token and the
          project count.
        </p>

        ${/* SAID PLAINLY, BECAUSE THE WORD "REMOVE" ON A SCREEN FULL OF
              CLOUDFLARE ACCOUNTS INVITES EXACTLY ONE WRONG READING. */ ''}
        <div class="alert alert-secondary">
          The Cloudflare account itself is not touched. Neither are its Pages
          projects, its zones, or any site already published from it. What
          goes is this app's ability to publish into it.
        </div>

        <p class="text-white-50">
          Nothing points at it — no blogs, no pool domains. To add it back you
          will need the account ID and a token again; the stored one cannot be
          read back out.
        </p>

        ${/* data-confirm, EVEN THOUGH THIS PAGE IS ITSELF THE QUESTION.
              test-inline-handlers.js allows either — ask, or be on a page
              that does the asking — and /static-blogs/:id/delete takes the
              second route because it makes you TYPE the blog name, which is
              a higher bar than a confirm box rather than a lower one.

              This page does not. It is reached by a link and offers a button,
              so a stray click here destroys a credential that cannot be read
              back out. One more beat is worth more than a shorter exception
              list. */ ''}
        <form method="post" action="/admin/blog-domains/accounts/${esc(found._id)}/delete"
              class="d-inline"
              data-confirm="Remove the stored credentials for ${esc(found.label)}? The token cannot be read back, so adding it again means finding a new one.">
          ${res.locals.csrfField || ''}
          <button class="btn btn-danger" type="submit">Remove</button>
        </form>
        <a href="/admin/blog-domains" class="btn btn-secondary ms-2">Cancel</a>`,
    }));

  } catch (err) {
    log.error('blogDomains.confirmDelete.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: '<h1>We could not load that</h1>',
    }));
  }
});

router.post('/admin/blog-domains/accounts/:id/delete', requireAdmin, async (req, res) => {
  try {
    const found = await CloudflareAccount.findById(req.params.id);

    if (!found) {
      return problem(res, 'That account is not here',
        'It may have been removed already. Reload the screen.');
    }

    /* COUNTED AGAIN, NOT TRUSTED FROM THE PAGE THAT OFFERED THE BUTTON.
     *
     * The confirmation was rendered at some earlier moment, and a blog
     * created between then and now is exactly the one nobody is thinking
     * about. The GET's count is for the reader; this one is the guard. */
    const refs = await referencesTo(found);

    if (refs.total) return refusesRemoval(res, found, refs);

    await CloudflareAccount.deleteOne({ _id: found._id });

    log.info('blogDomains.accountRemoved', {
      requestId: req.id,
      label: found.label,
      accountId: found.accountId,
    });

    res.redirect('/admin/blog-domains');

  } catch (err) {
    log.error('blogDomains.deleteAccount.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: '<h1>We could not remove that account</h1>',
    }));
  }
});

/* -------------------------------------------------------------------------
 * Adding a domain for WEBSITES
 *
 * A separate handler from the blog one below, for the same reason it is a
 * separate form: the two share one field and differ in three. Folding them
 * together would mean a validator whose rules depend on a flag, which is
 * where "required unless" conditions go to rot.
 *
 * THE INSTALLATION IS NOT VERIFIED AGAINST GITHUB HERE, and that is a
 * decision rather than an omission. Checking it means an App JWT and a call
 * to github.com from an admin form — a screen that then fails to load a
 * domain list because GitHub is slow. The number is checked for SHAPE; a
 * wrong one fails at publish with "the App was uninstalled", which names
 * the problem well enough and happens where the work is.
 * ---------------------------------------------------------------------- */

router.post('/admin/blog-domains/site-domains', requireAdmin, async (req, res) => {
  try {
    const domain = normaliseDomain(req.body.domain);
    const installationId = String(req.body.githubInstallationId || '').trim();

    if (!domain) {
      return problem(res, 'That is not a domain we can use',
        'It has to be a registrable domain such as acme.com. Sites are '
        + 'served beneath it — acme.com/quality-plumbing/ — so a subdomain '
        + 'here would put every site two levels down.');
    }

    /* DIGITS ONLY. A pasted URL is the likeliest wrong input, and storing
     * one would fail much later against an endpoint whose path then has a
     * slash in the middle of it. */
    if (!/^\d+$/.test(installationId)) {
      return problem(res, 'That is not an installation id',
        'It is the number at the end of '
        + 'github.com/settings/installations/&lt;id&gt; — digits only.');
    }

    if (await Domain.findOne({ domain })) {
      return problem(res, 'That domain is already in the pool',
        'One row per domain. Two rows pointing at different accounts is an '
        + 'ambiguity made permanent: whichever the lookup returned would '
        + 'decide where a site went, and the two would disagree between '
        + 'builds.');
    }

    await Domain.create({
      domain,
      label: String(req.body.label || '').trim(),
      target: 'github',
      githubInstallationId: installationId,
      enabled: true,
    });

    log.info('blogDomains.siteDomainAdded', {
      requestId: req.id,
      domain,
      installationId,
    });

    return send(res, page({
      title: 'Domain added',
      body: `<h1 class="h3">${esc(domain)} is on the list</h1>
             <p class="lead">
               Local Website Options builds can now be published to it. A
               site called "Quality Plumbing" will be served at
               <code>${esc(domain)}/quality-plumbing/</code>.
             </p>
             <p class="text-white-50">
               For that to answer, the GitHub account's own
               <code>&lt;login&gt;.github.io</code> repository has to carry
               this domain as its custom domain. Until it does, the sites
               are still published and still reachable on github.io.
             </p>
             <a href="/admin/blog-domains" class="btn btn-primary mt-3">Back to the pool</a>`,
    }));

  } catch (err) {
    log.error('blogDomains.addSiteDomain.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: '<h1>We could not add that domain</h1>',
    }));
  }
});

/* -------------------------------------------------------------------------
 * Adding a domain for BLOGS
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

    /* IS THE ZONE ACTUALLY ON THAT ACCOUNT? — MOVED HERE 25 OCTOBER 2026.
     *
     * THIS CHECK USED TO LIVE ON THE CUSTOMER'S CREATE FORM, where it ran
     * after every single blog was created, for the rest of time, to catch a
     * mistake only an admin can make. Edwin: *"It's an admin mistake, caught
     * on an admin screen, instead of firing on every create forever."*
     *
     * It is the same findZone() call. What changed is WHEN: the pool has one
     * row per domain, so this runs once per domain ever, at the moment the
     * row is written — and the person reading the answer is the person who
     * can act on it.
     *
     * AND IT REFUSES, WHERE THE OLD ONE WARNED. On the create form a refusal
     * would have been wrong: a blog on a domain Cloudflare does not host is
     * a legitimate thing to want, the owner points the DNS himself. A POOL
     * domain is not that. The pool exists precisely because the zone is on
     * the same account as the Pages project, which is what makes Cloudflare
     * write the DNS record itself. A pool row where that is untrue is a row
     * that silently turns the automatic half of this product off for every
     * blog ever created on it.
     *
     * A FAILURE TO ASK IS STILL NOT A FAILURE TO MATCH. findZone returns
     * ok:false both for "this account does not hold it" and for "the token
     * cannot read zones", and only the first carries `noZone`. The second
     * adds the domain and says the check could not run — refusing on a
     * permissions problem would block a correct domain, and silently adding
     * it would teach nobody anything. */
    let creds;
    let unchecked = '';

    try {
      creds = await cloudflare.credsForAccountId(account._id);
    } catch (err) {
      /* credsForAccountId throws for an account that is disabled or whose
       * token will not decrypt. That is worth saying, and it is not a
       * reason to refuse the domain — the account's own row on this screen
       * is where that gets fixed. */
      unchecked = scrub(err.message, { account: account.accountId });
    }

    if (creds) {
      const zone = await cfDeploy.findZone({ domain, creds });

      if (!zone.ok && zone.noZone) {
        /* log.info, NOT log.security. This is an admin's own typo on an
         * admin screen, not a denial worth a security line — and the logger
         * has no generic `warn`, which is how the first draft of this found
         * out that log.warn is not a function. */
        log.info('blogDomains.domainNotOnAccount', {
          requestId: req.id,
          domain,
          account: account.label,
        });

        return problem(res, 'That domain is not on that Cloudflare account',
          `${domain} is not a zone on "${account.label}". A blog on it would `
          + 'get no DNS record written for it, so it would answer on nothing '
          + 'until somebody added a CNAME by hand. Pick the account whose '
          + 'zone list has it, or add the zone to Cloudflare first.');
      }

      if (!zone.ok) {
        unchecked = scrub(zone.error || 'Cloudflare did not answer.',
          { token: creds.token, account: creds.account });
      }
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
      zoneChecked: !unchecked,
    });

    if (unchecked) {
      return send(res, page({
        title: 'Domain added',
        body: `<h1 class="h3">${esc(domain)} added \u2014 but not verified</h1>

          <div class="alert alert-warning">
            <p class="mb-0"><strong>We could not check whether
            <code>${esc(domain)}</code> is a zone on
            "${esc(account.label)}".</strong></p>
          </div>

          <p class="lead">${esc(unchecked)}</p>

          <p>
            The domain is in the pool and customers can use it. If the zone is
            not on that account, Cloudflare will not write the DNS record and
            blogs on it will answer on nothing \u2014 so it is worth checking
            the account's token has <strong>Zone:Read</strong> and adding the
            domain again.
          </p>

          <a href="/admin/blog-domains" class="btn btn-primary mt-3">Back</a>`,
      }));
    }

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

/* -------------------------------------------------------------------------
 * Getting a client's GitHub account ready to serve a domain
 * ---------------------------------------------------------------------- */

/**
 * The four steps that were done by hand on github.com.
 *
 * IT REPORTS RATHER THAN REDIRECTS. Half of this job is DNS, which nothing
 * here can touch — the A records are at whichever registrar the domain came
 * from. A flash message saying "done" would be a lie about the half that
 * was not done, so the answer is a page listing what happened and what is
 * still owed.
 */
router.post('/admin/blog-domains/:id/setup-github', requireAdmin, async (req, res) => {
  let domain;

  try {
    domain = await Domain.findById(req.params.id).lean();
  } catch (_) {
    domain = null;
  }

  if (!domain) {
    return problem(res, 'That domain is not here', 'It may have been removed.');
  }

  if ('github' !== domain.target || !domain.githubInstallationId) {
    return problem(res, 'That is not a GitHub domain',
      'This sets up the root <login>.github.io repository on a client\'s '
      + 'GitHub account. A Cloudflare domain has nothing for it to do.');
  }

  try {
    const out = await setupDomain({
      installationId: domain.githubInstallationId,
      domain: domain.domain,
    });

    /* RECORDED SO THE LIST CAN SAY WHAT HAPPENED. Written after the call
     * returns, which is also after everything it could do was done — a
     * setup that threw never reaches here, and one whose custom domain was
     * refused reaches it with ok false.
     *
     * HTTPS IS DELIBERATELY NOT PART OF THIS VERDICT. The certificate is
     * issued by GitHub an hour after the DNS starts answering, so a setup
     * that did everything right is ALWAYS waiting on it on the first run.
     * Folding that into "ok" would mark every correct setup as failed and
     * teach whoever reads the list to ignore the column. */
    await Domain.updateOne(
      { _id: domain._id },
      { $set: { githubSetupAt: new Date(), githubSetupOk: !!(out.pages.ok && out.custom.ok) } }
    ).catch(err => log.error('blogDomains.setupGithub.recordFailed', err, {
      requestId: req.id, domainId: String(domain._id),
    }));

    log.info('blogDomains.setupGithub', {
      requestId: req.id,
      domain: out.domain,
      repo: `${out.owner}/${out.repo}`,
      created: out.created,
      page: out.page,
      pagesOk: out.pages.ok,
      customOk: out.custom.ok,
      httpsOk: out.https.ok,
      certState: out.https.state || '',
    });

    const rows = (label, type, host, values) => `
      <tr><td class="text-white-50">${esc(label)}</td><td><code>${esc(type)}</code></td>
      <td><code>${esc(host)}</code></td>
      <td>${values.map(v => `<code>${esc(v)}</code>`).join('<br>')}</td></tr>`;

    send(res, page({
      title: `Set up ${out.domain}`,
      body: `
        <h1 class="h3 mb-3">${esc(out.domain)}</h1>

        <p class="lead text-white-50">
          <code>${esc(out.owner)}/${esc(out.repo)}</code> is the root site.
          Every site on this domain is served beneath it.
        </p>

        <h2 class="h5 mt-4 mb-2">What happened on GitHub</h2>
        <ul class="text-white-50">
          <li>Repository: ${out.created ? 'created' : 'already there'}</li>
          <li>Holding page: ${'created' === out.page
            ? 'added, because the repository was empty'
            : 'left alone — there was already a page on it'}</li>
          <li>Pages: ${out.pages.ok
            ? (out.pages.already ? 'was already on' : 'turned on')
            : `<span class="text-warning">not on — ${esc(out.pages.error)}</span>`}</li>
          <li>Custom domain: ${out.custom.ok
            ? `set to <code>${esc(out.custom.domain)}</code>`
            : `<span class="text-warning">not set — ${esc(out.custom.error)}</span>`}</li>
          <li>Enforce HTTPS: ${out.https.ok
            ? (out.https.already ? 'was already on' : 'turned on')
            : '<span class="text-warning">not yet</span>'}${out.https.note
              ? `<br><span class="small">${esc(out.https.note)}</span>`
              : ''}</li>
        </ul>

        <h2 class="h5 mt-4 mb-2">What has to be done at the registrar</h2>
        <p class="text-white-50">
          GitHub has no say in DNS, so this is the half nothing here can do.
          The A records are the ones that matter; the AAAA records are
          optional and the <code>www</code> one is only needed if the domain
          should answer with it.
        </p>

        <table class="table table-navy align-middle">
          <thead><tr><th></th><th>Type</th><th>Host</th><th>Value</th></tr></thead>
          <tbody>
            ${rows('Apex', out.dns.apex.type, out.dns.apex.host, out.dns.apex.values)}
            ${rows('Apex, IPv6', out.dns.apexIpv6.type, out.dns.apexIpv6.host, out.dns.apexIpv6.values)}
            ${rows('www', out.dns.www.type, out.dns.www.host, [out.dns.www.value])}
          </tbody>
        </table>

        <p class="text-white-50">
          If the custom domain did not take, GitHub is usually refusing a
          domain whose DNS does not point at it yet. Set the records, give
          them a few minutes, and press the button again — nothing here
          minds being run twice.
        </p>

        <p class="text-white-50">
          HTTPS is the one step that cannot be finished in a single run.
          GitHub issues the certificate itself once the DNS is answering,
          which takes anything up to an hour, and there is nothing to
          enforce until it has. Pressing the button again after that is what
          ticks it — until then the site answers on
          <code>http://</code> and a browser will warn about the certificate.
        </p>

        <a href="/admin/blog-domains" class="btn btn-primary mt-3">Back to domains</a>`,
    }));

  } catch (err) {
    log.error('blogDomains.setupGithub.failed', err, {
      requestId: req.id,
      domainId: req.params.id,
    });

    /* NOTHING IS HALF-CREATED WHEN THIS BRANCH RUNS. setupDomain() throws
     * only before it touches anything — a missing installation, or a
     * permission the client did not grant. Everything after the repository
     * exists is reported rather than thrown. */
    send(res, page({
      status: 500,
      title: 'Could not set it up',
      body: `<h1 class="h3">We could not set up that account</h1>
             <p class="lead text-white-50">${esc(err.message)}</p>
             <p class="text-white-50">Nothing was created.</p>
             <a href="/admin/blog-domains" class="btn btn-primary mt-3">Back to domains</a>`,
    }));
  }
});

module.exports = router;
module.exports.normaliseDomain = normaliseDomain;
