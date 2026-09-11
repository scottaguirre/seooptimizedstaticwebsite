# Working notes

Read this before changing anything. A new session starts with no memory of the
last one, so what is written down here is all there is.

## DO NOT TOUCH — hand-written CSS

Edwin styled these by hand on 10 September 2026. They are deliberate aesthetic
choices, not generated output, and nothing in an automated change should
rewrite, reformat or "tidy" them:

    src/css/themes/style2.css
    src/css/themes/style3.css
    src/css/themes/style4.css
    src/css/themes/style5.css
    src/css/themes/style6.css

`src/css/themes/style.css` was last changed earlier and is not part of that
batch, but treat it the same way unless asked otherwise.

## DO NOT TOUCH — hand-styled app pages

The same day, Edwin also restyled the app's own pages: login, dashboard, blog
sites and others. Those pages have no stylesheet of their own — the markup and
its styling are written INLINE in the route files and the view templates, so
the CSS and the logic sit in the same file:

    src/views/login.html
    src/views/signup.html
    src/views/form.html

    routes/authRoute.js        login, signup, dashboard
    routes/blogSitesRoute.js
    routes/billingRoute.js
    routes/adminRoute.js
    routes/jobRoute.js
    routes/passwordRoute.js
    routes/downloadZipRoute.js
    routes/exportWpThemeRoute.js
    routes/formRoute.js

Logic in these files is fair game. The presentation is not: leave `<style>`
blocks, `class="..."` attributes, inline `style="..."`, colours, spacing and
markup structure exactly as found. Change behaviour without touching how it
looks.

If a change genuinely requires touching presentation — a new section needing a
class, a button that has to move — say so and ask first rather than editing.

`utils/renderAuthPage.js` fills `{{CSRF}}`, `{{ALERT}}` and `{{EMAIL}}` into the
view files. Its alert markup is presentation too.

## Deploying

    ./deploy.sh --dry-run     # always first: rsync uses --delete
    ./deploy.sh

Target is `ubuntu@15.204.123.104:/home/ubuntu/app`, pm2 app name `webgen`.
Excludes live in `.rsync-exclude`.

If it says `permission denied: ./deploy.sh`, the executable bit is gone —
writing the file from a session creates it fresh with default permissions.
`chmod +x deploy.sh` restores it. **After editing this file from a session,
say so**, or the next deploy stops on a confusing error that has nothing to do
with the change.

**Do not add `--omit=dev` to the install step.** It looks obviously right for a
production server and is wrong for this one: `utils/runProductionBuild.js` runs
webpack at request time to build each customer's site, so webpack, babel-loader,
css-loader, postcss and purgecss are runtime dependencies here despite living in
`devDependencies`. Pruning them put the app into a restart loop on 10 September.

## Tests

    node test-business-shape.js    # business shapes, prompts, case study, wizard parity
    node test-wp-canonical.js      # runs the exported theme as real PHP; skips without php
    node test-blog-plan.js
    node test-blog-states.js
    node test-email-from.js        # the From header, incl. RFC 5322 quoting
    node test-email-html.js        # the HTML email body and its escaping

`test-blog-api.js` and `test-blog-scheduler.js` need `MONGO_URI` and otherwise
exit without running.

`brew install php` makes the canonical suite runnable locally.

## Where things are

| What | Where |
|---|---|
| Business types, shapes, capabilities | `utils/businessShape.js` — the single registry |
| Home page build | `utils/buildAboutUsPage.js` + `src/aboutUsTemplate.html` |
| Service page prompts | `utils/createPagesPrompt.js` — rotating topic pool |
| Login / signup markup | `src/views/login.html`, `signup.html` |
| Login route | `routes/authRoute.js:96` |
| Dashboard route | `routes/authRoute.js:245` |
| Exported WordPress theme | `utils/wpThemeBuilder/generators/` |

`utils/renderAuthPage.js` caches the view files at first read, so edits to
`login.html` need a server restart before they show.

## Verified working on 10 September 2026

A live build confirmed all of these against real model output, so treat them as
settled rather than re-testing:

- service pages get different section topics from each other (the rotating pool
  in `createPagesPrompt.js`)
- the home page heading reads "<Trade> Services We Offer" with the six service
  cards under it
- uploaded logos keep a file extension and render
- interlink fallback sentences no longer nest a `<p>` inside a paragraph
- Lemon Law hero and section images resolve (they were 404s before the
  `imageFolderFor` fix)
- the case study names a real local landmark — a San Antonio build produced
  "a home a few minutes from the Alamo"

## Outstanding

**Blocking the medical types**

- `utils/altText/dentist.js`, `doctor.js`, `chiropractor.js`,
  `physical-therapy.js` — 11 sets each. The image folders exist; without these
  every image on those sites ships with `alt=""`. Edwin is adding the images
  and alt text on 11 September.

**WordPress**

- Re-export and reinstall the theme on roofingamerica.xyz. The archive
  canonical fix only travels inside the theme, so the live site does not have
  it until then.
- Install plugin 0.3.2 there and review the four Campaigns tabs.

**Law firm**

- General law-firm photographs and a rewritten `utils/altText/law-firm.js` (the
  current one is lemon-car copy, from when "Law Firm" meant lemon law), then
  flip `listed` back on for Law Firm in `businessShape.js`.

**Email — migrated to the production domain on 11 September 2026**

Transactional mail (verification, password reset) goes through Resend and now
sends from `hello@fastwebsitegenerator.com`. It used to send from
`noreply@hilltophomeloans.net`, a test domain whose sends landed in spam.

Done:

- DNS is managed at **Hostinger** (`athena.dns-parking.com` /
  `apollo.dns-parking.com`). The domain had no MX, TXT or DMARC at all before
  this.
- Four records added and confirmed with `dig`:

      TXT    resend._domainkey   p=MIGfMA0GCSqG…H2eTein/wIDAQAB   (DKIM)
      CNAME  rsend               rsend.forge.rmta.net.
      CNAME  send                send.forge.rmta.net.
      TXT    _dmarc              "v=DMARC1; p=none;"

  Resend uses CNAMEs to `forge.rmta.net` rather than an SPF TXT on the root,
  so there is no `v=spf1` record to look for. `p=none` is monitor-only.
- `EMAIL_FROM=hello@fastwebsitegenerator.com` set on the server, with `.env.bak`
  taken first, then `pm2 restart webgen`. A plain restart is enough —
  `server.js:3` calls `require('dotenv').config()`, so the file is re-read.
- Live test through `/forgot-password`: Resend's dashboard showed **Delivered**.
- `hilltophomeloans.net` removed from Resend, and its three stale mail records
  (the DKIM TXT, the `send` MX to `feedback-smtp.us-east-1.amazonses.com` and
  the `send` SPF TXT) deleted from its Hostinger zone.
- **Sender display name.** Gmail showed the sender as "hello" — the local part
  of `hello@fastwebsitegenerator.com`, on its own. `fromAddress()` in
  `utils/sendEmail.js` now composes `Name <address>`, defaulting to
  `Fast Website Generator` and overridable with `EMAIL_FROM_NAME`. Covered by
  `test-email-from.js`, including RFC 5322 quoting and CRLF stripping.
- **HTML bodies.** `utils/emailLayout.js` builds the HTML half of both
  messages — a card, a heading, one button, the same link repeated as copyable
  text, and a hidden preheader. The plain text half is unchanged and still
  sent; **when the wording of one changes, change both.** Email HTML is not
  web HTML: tables not flex, inline styles not `<style>`, padding on the `<td>`
  and never on the `<a>` (Outlook renders with Word, which ignores it), and
  nothing loaded from the network. `test-email-html.js` enforces all of that.

Still open:
- `hello@fastwebsitegenerator.com` is send-only. Nothing receives replies yet;
  set up forwarding to a real inbox when that matters. Do **not** enable
  Resend's "Receiving" for this — it is webhook delivery to an endpoint, not a
  mailbox.
- Tighten DMARC to `p=quarantine` once volume is steady, and add
  `rua=mailto:…` if the reports are wanted.

Worth knowing:

- `EMAIL_FROM` must be on a domain verified in Resend or the send is rejected
  outright.
- `noreply@` is more spam-prone than `hello@` or `support@`.
- A brand-new sending domain has no reputation. Spam placement is expected at
  first and improves with consistent volume — do not treat the first few as a
  configuration failure.
- Resend's "Delivered" means the receiving server accepted the message. It does
  not distinguish inbox from spam folder. Check the actual inbox too.
- Resend's dashboard shows per-message status, which distinguishes "rejected at
  the gateway" from "delivered but filtered". Check there before changing
  anything.

**Cleanup**

- `brew install php` so the 27 canonical tests run locally instead of skipping.
- `test-blog-api.js` and `test-blog-scheduler.js` need `MONGO_URI` set. They
  exit without running, so they have never told anyone anything.

The dead files (`buildInterlinkMap.js`, `buildservicesNavMenu .js`,
`wpThemeBuilderBackUp.js`, `wpThemeBuilderOriginal.js`) and the stale PAA
comment in `generateFaqAnswers.js` were removed on 10 September.

## Deliberately dropped — do not re-propose

These were raised, considered and set aside. Do not bring them up again unless
Edwin does.

- **The fabricated 5-star review** in the LocalBusiness JSON-LD
  (`utils/generateReview.js`). Edwin knows; he will say when.
- **Wiring `utils/blog/qualityCheck.js` into service pages.** Its `checkPost()`
  is blog-specific — it fails anything under 550 words, rejects "how to" titles
  and requires blog interlink tokens — so it would fail every service page for
  reasons unrelated to quality.
- **Per-service FAQ sections.** Considered for making service pages distinct;
  rejected because adding the same section to every service page makes them
  more alike, not less. The topic rotation was built instead.
