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
    node test-page-meta.js         # every page's <title> and description; needs no php
    node test-wp-canonical.js      # runs the exported theme as real PHP; skips without php
    node test-wp-single.js         # single.php incl. the featured image; skips without php
    node test-ie-pause.js          # campaign pause/resume as real PHP; skips without php
    node test-wp-screenshot.js     # the theme screenshot and its binary-safe copy
    node test-ie-video.js          # the campaign video and where it lands; skips without php
    node test-ie-topics.js         # the campaign form's topic/video readers; skips without php
    node test-blog-plan.js
    node test-anchor-pool.js       # what each anchor bucket may contain; needs no php
    node test-home-anchors.js      # the generated SITE's home-page anchors; needs no php
    node test-blog-states.js
    node test-email-from.js        # the From header, incl. RFC 5322 quoting
    node test-email-html.js        # the HTML email body and its escaping

    node test-blog-api.js          # needs NOTHING — no database, no network
    node test-blog-scheduler.js    # runs; only its findWork section needs MONGO_URI

An earlier version of this file said both of those "need `MONGO_URI` and
otherwise exit without running". **That was wrong**, and it kept them from
being run for weeks. `test-blog-api.js` touches no database at all — the
signature scheme and the claim logic are pure functions. `test-blog-scheduler.js`
runs everything except `findWork`, and prints a line saying so.

**If you do set `MONGO_URI` for `findWork`, point it at a scratch database, not
at Atlas.** Those tests `BlogCampaign.create()` and `deleteMany()` real
documents. The cleanup is scoped to a random site id and looks careful, but a
crash mid-run leaves rows behind — in the live collection, if that is what you
pointed it at.

**The two PHP suites cannot run on Edwin's Mac.** It is on macOS 12, which
Homebrew no longer ships bottles for, so `brew install php` tries to compile
from source. Do not suggest it again.

They run on the VPS instead, which has `php-cli` 8.3.6 installed as of
12 September:

    ssh ubuntu@15.204.123.104 'cd ~/app && node test-wp-canonical.js && node test-wp-single.js'

All 40 assertions passed there on 12 September. Note this runs *after* a
deploy, so it reports rather than gates — `deploy.sh` still skips both suites
locally. Do not wire the remote run into `deploy.sh` without solving that:
turning a gate into a report quietly loses the property the script was built
for.

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

## Verified working on 11 September 2026

- transactional mail sends from `hello@fastwebsitegenerator.com` and arrives
- the sender reads "Fast Website Generator", not "hello"
- the HTML body renders — card, navy button, copyable fallback link

## Verified working on 12 September 2026

Theme re-exported and reinstalled on roofingamerica.xyz, which carried both of
these to a live site for the first time:

- a Featured Image set in wp-admin renders on the post, between the title and
  the body
- archive canonicals — `/category/uncategorized/` now declares itself
  canonical, where every archive previously declared nothing. That was the
  "Duplicate without user-selected canonical" report.

Both PHP suites also ran green on the VPS against PHP 8.3 — 27 + 13.

## Outstanding

**Blocking the medical types**

- `utils/altText/dentist.js`, `doctor.js`, `chiropractor.js`,
  `physical-therapy.js` — 11 sets each. The image folders exist; without these
  every image on those sites ships with `alt=""`. Edwin is adding the images
  and alt text on 11 September.

**WordPress**

- Install plugin 0.3.2 on roofingamerica.xyz and review the four Campaigns
  tabs. (The *theme* re-export was done on 12 September — see above.)
- Search Console: hit **Validate Fix** on "Duplicate without user-selected
  canonical" now that the archives declare one. Google recrawls on its own
  schedule, so a flat count a week later means nothing either way.
- Any *other* site running an exported theme still has the old `single.php`
  and the old archive behaviour. The fixes travel inside the theme ZIP, so
  every site needs its own re-export and reinstall.

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

**Article video — built 13 September, plugin 0.3.6, NOT yet tested on a site**

Two fields, and the relationship between them is the feature:

- **"Video to include (optional)"** on the campaign form — the fallback, used
  by any article without one of its own.
- **A "Video" column in the Topics table** — one per article, overriding the
  campaign's.

An empty slot value means "nothing chosen here", not "no video wanted". There
is no way in the UI to say the second thing, and adding one would mean a
checkbox beside every row to express something nobody has asked for.

**Slot videos are matched to slots by TOPIC TEXT, never by row number.** The
rows belong to this form; the slots come back from the server. Index matching
would look correct and be wrong the first time the server drops or reorders a
topic — every video landing on its neighbour's article, silently. There are two
tests for this, one of which feeds the slots back in reverse order.

Neither field is sent to the server. A video has nothing to do with planning or
writing.

Load-bearing decisions, all covered by `test-ie-video.js` (26 cases):

- **Core's `[embed]` shortcode, never a raw `<iframe>`.** `[embed]` belongs to
  WordPress, not to us, so it keeps working after the plugin is deleted — the
  same rule that makes `post_content` finished HTML instead of our shortcodes.
  It also gets core's responsive wrapper, provider allow-list and automatic
  `loading="lazy"` for free, and is not the kind of markup security plugins
  strip.
- **Before the second `<h2>`.** A section boundary, so it never splits a
  paragraph; past the opening, so the post still starts with prose. Fewer than
  two headings and it appends rather than guessing a midpoint.
- **Blank lines around the shortcode.** `autoembed` and `wpautop` both work on
  block boundaries; glued to a `</p>` it never becomes a player.
- **The scheme is re-checked at insert time**, not just by the form.
  `esc_url_raw` ran once, months ago, on a value that has been sitting in an
  option ever since — and options get edited by other plugins, WP-CLI and hand.
- **Idempotent.** `run_campaign()` is meant to be safe to press repeatedly.

Known limitations, both deliberate:

- An embed does **not** produce a video rich result in Google. That needs
  `VideoObject` schema with a thumbnail, duration and upload date, none of
  which a bare URL provides. Its own piece of work, not a bug.
- **Both fields are creation-time only.** A campaign that already exists cannot
  be given a video, because there is no edit screen for a campaign. For posts
  that already exist the answer is simpler than a feature: open the post and
  paste the URL on its own line — core oEmbed has always turned that into a
  player, with no plugin involved.

**"Review these topics" — 13 September, same release**

The Video column went into the topics table, and the topics table only ever
appeared after pressing *Suggest topics*. So anyone who typed their own topics
never saw it, and `handle_suggest()` discards the textarea anyway — it asks the
server for fresh topics. The column was unreachable for that whole path.

It was worse than the video: a typed topic also never got its **search query**
or **link phrase**, because those only exist as table columns. Typed topics
reached the server bare.

The new button parses the textarea into the same table without calling the
server — free, instant, and it routes both paths through `collect_topics()` so
they cannot drift apart again. With rows already on screen it reads "Save these
edits" and keeps what is there, videos included.

`test-ie-topics.js` (15 cases) reaches the private readers by reflection and
covers both input shapes, the tick handling, and the URL scheme check — which
is the last place a `javascript:` URL can be stopped before it is stored in a
WordPress option.

Still open: never run on a real site. Install 0.3.6, create a campaign with a
campaign-level video and a different one on a single topic, write the posts,
and confirm each article got the right one.

**Anchor phrases — 19 September, server-side**

A live post read *"a **plumber near mes** can test the flow…"*. `pluralise()`
appends an s to the last word of a phrase, which is right only when the last
word is the head noun. Three classes of keyword broke it:

    plumber near me      → plumber near mes       (preposition)
    plumber in Leander   → plumber in Leanders    (preposition)
    emergency plumbing   → emergency plumbings    (gerund / mass noun)

It now returns the phrase UNCHANGED for any of those, and every caller passes
the result through `unique()`, so an unchanged value disappears instead of
becoming a second broken anchor.

Chasing that turned up two more, both live:

- **"residential plumbing services services"** — the `${keyword} services`
  template fired on a keyword already ending in it.
- **A search-query keyword breaks every suffix template.** "plumber near me"
  produced "plumber near me services", "booking plumber near me", "plumber
  near me near Leander". A `suffixable` flag now gates the templates that
  append; the ones that prefix ("local plumber near me") still run.

`test-anchor-pool.js` reads the actual phrases. The suites that existed
checked the SHAPE of the pool — four buckets, non-empty, no reuse — and never
looked at a single string, which is why all three shipped.

**If a keyword is really a search query rather than a service name, say so.**
"plumber near me" is a poor target for this field: "near me" is a modifier
Google supplies, not part of the service. The guards stop the output being
embarrassing; they do not make it a good choice.

## Page titles — 20 September

**The Rank Fast home title now names the town twice, on purpose:**

    Emergency Plumber Round Rock in Round Rock, TX | Call (512) 894-6167

It used to detect the city inside the business name and append the state
alone, to avoid "Emergency Plumber Round Rock, Round Rock, TX". **The fault
there was the comma, not the repetition** — with a comma it is a three-item
list, with "in" it is a sentence. And the repetition earns its place: a Rank
Fast name is a SERVICE phrase that happens to contain a town, so "in Round
Rock, TX" is the first part of the title that says where the business is
rather than what it is called. `test-page-meta.js` asserts the town appears
twice, because otherwise it looks like a bug and gets "fixed" back.

Only Rank Fast moved. One-Page Design is `Object.assign({}, LEAD, ...)` and
shares the Rank GBPs format, so there is no third copy to drift.

**Nothing asserted on a page title before this date.** The formats were
centralised into `utils/pageMeta.js` precisely because four copies had drifted
apart — but centralising them stopped the drift between files, not the drift
inside the one file. `test-page-meta.js` covers all five page types.

**An attribute injection, found by writing that suite:**

    <meta name="description" content="... to get plumbing" onload=alert(1) x=" services.">

`serviceNoun()` and `businessNoun()` used `String(businessType)` where every
other field — name, location, phone — goes through `clean()`, which strips
`" < >`. Their unmatched branch returns the business type verbatim, and the
static builder substitutes it raw:

    .replace(/{{META_DESCRIPTION}}/g, () => (meta.description))

**The exported WordPress theme was never affected** — `functionsPhp.js` wraps
it in `esc_attr( wp_strip_all_tags() )`. Only the static HTML path was
unescaped, so `clean()` was the whole defence and one input skipped it.

`businessNoun()` feeds PROSE rather than meta, so the meta invariants in that
suite never reach it — a mutation reverting its `clean()` survived until a
test aimed at it directly was added. **When two functions share a fix, they
need two tests.**

## The generated site's home-page anchors — 20 September

**Two different anchor systems now exist. They are not the same and must not
be merged.**

| | the PLUGIN's articles | the generated SITE |
|---|---|---|
| money page | a service page | the HOME page |
| its keyword | a service phrase | the BUSINESS NAME |
| mix | `DEFAULT_MIX` 30/40/20/10 | `HOME_MIX` 40/40/20 |
| pool | `utils/blog/anchorPool.js` | `utils/homeAnchorPool.js` |

**Why there is no `branded` bucket on the site side.** Rank Fast exists for
businesses named after their keyword — "Emergency Plumber Round Rock" is the
brand AND the target term. `branded` earns its place in the blog pool by being
a DIFFERENT vocabulary from the keyword; here it is the same vocabulary, so it
has no separate job and its 10% is folded into `exact`. That is why exact
reads 40 on one side and 30 on the other. `test-home-anchors.js` asserts
`DEFAULT_MIX` is still 30/40/20/10, so a site change leaking into the plugin
fails the suite.

**Naked URLs are 0%.** They were the Rank Fast default for every page after
the first one or two, chosen by `businessNameAnchorCount()`. That function is
kept and exported — the rule is worth reading and `test-business-shape.js`
asserts on it — but nothing calls it.

**You cannot feed a business name to the service pool.** This was tried first
and every line below is real output, not a hypothetical:

    Emergency Plumber Round Rocks                 pluralised the town
    Emergency Plumber Round Rock in Round Rock    town twice
    Round Rock Emergency Plumber Round Rock       town twice
    Emergency Plumber Round Rock's Emergency Plumber Round Rock

`pluralise()` guards a trailing modifier by looking for a preposition; a name
ending in a place name has none, so the guard never fires. And every town
template fires blind because the town is already inside the keyword.

**The fix is to DECOMPOSE the name.** `serviceCore()` strips the town back out
— "Emergency Plumber Round Rock" → core `"emergency plumber"` + `"Round Rock"`
— and the templates build from the two separately. It returns
`{ core, decomposed }`, and **`decomposed` is the half that matters**: false
means the town was not in the name ("Bob's Plumbing"), the Rank Fast premise
does not hold, and the core must NOT be treated as a service phrase. Decorate
one anyway and you get "local bob's plumbing".

**Two more template bugs, same family as `plumber near mes`:**

- **Person vs job nouns.** "experienced water heater repair", "roof
  replacements serving Austin", "trusted drain cleanings". Those templates
  only work when the core is an agent noun. `isAgentNoun()` gates them on
  the -er/-or/-ist/-ian/-man/-smith/-wright endings.
- **A descriptive phrase has to survive its sentence.** They always land in
  the appended line, because they contain no keyword and are never in the
  copy already. "who we are and what we do" reads fine alone and gives "You
  can also who we are and what we do." **Test the sentence, not the phrase.**

**`normaliseTargets()` rebuilds entries field by field, deliberately.** So
every field the injector reads must be listed there. `anchorType` was added
and dropped there at first, which made the entire plan a no-op while every
other part of it looked correctly wired up.

**My own test harness reported green without asserting anything.** The
synchronous `try { fn() } catch` that every other suite here uses does not
catch an async test: `fn()` returns a Promise, which rejects rather than
throws. Four tests passed while checking nothing. **Mutation testing is what
found it** — two mutations that should have been impossible to miss survived,
and both were covered only by async tests. `test-home-anchors.js` awaits.

All 12 mutations against this feature are caught. One survived at first
through **fixture masking**: "Bob's Plumbing" ends in -ing, so `pluralise()`
declines on the gerund rule and the guard being tested was never what saved
it. The fixture is now "Ace Roofer", which pluralises cleanly.

**The intent field is a DROPDOWN now — 19 September, plugin 0.3.9**

It has been rewritten three times. First it asked "What the reader should end
up wanting". Then it became a sentence stem to finish, with three worked
examples. Both versions were answered with the page's keyword — by Edwin, who
commissioned the field and had had it explained to him twice. When the person
who owns the product fills a field in wrong three times, the field is wrong.

There were only ever about five real answers, so asking anyone to compose one
was the mistake. It is now a `<select>` whose **option values are complete
sentences**, so everything downstream still receives one prose string and never
learns there was a list. `read_intent()` prefers the free-text box underneath
when it has anything in it, and ignores whitespace — a stray space must not
silently wipe the choice.

**If you add an option, make it a sentence that finishes "After reading, the
visitor should…"** — lower case, more than one word. `test-ie-topics.js` reads
the option array out of the source and fails on anything shaped like a keyword.

**Topics table column widths — 19 September, plugin 0.3.8**

The Topic column had collapsed to about forty pixels and showed "Wh". Cause:
WordPress's `regular-text` class is a **fixed 25em**. Three fixed columns and
one flexible one means the flexible one absorbs every shortfall — and Topic,
the longest value in the row, was the flexible one. Adding the Video column
took another 25em from it.

The table now sets percentage widths on the header cells and `width:100%` on
each input, with no fixed-width classes. **If you add a fifth column, adjust
the percentages — do not reach for `regular-text`.**

**Theme screenshot — added 12 September**

Exported themes used to show the grey placeholder tile in Appearance → Themes,
because WordPress looks for `screenshot.png` beside `style.css` and the builder
never wrote one.

`utils/wpThemeBuilder/assets/screenshot.png` — 1200×900, the Fast Website
Generator logo on its own navy, padded rather than cropped (the logo is
1200×630, an Open Graph ratio, so cropping it to 4:3 would cut the sides).
`buildFromModel.js` copies it into every theme root, guarded by `fileExists` so
a missing image can never fail an export.

Two things to keep in mind if this is ever changed:

- **Use `copyFile()`, never `writeFile()`.** `writeFile` is utf8-only. A PNG
  through it still appears, with a plausible size, and is no longer an image.
  `copyFile` was added to `wpHelpers/fileHelpers.js` for exactly this.
- One fixed image for every customer means **the Fast Website Generator logo
  appears in the customer's own Appearance → Themes**, next to Twenty
  Twenty-Four. Edwin chose that knowingly on 12 September. If a site is ever
  sold as wholly the customer's own, this is the one place the vendor name
  shows up uninvited.

`test-wp-screenshot.js` checks the PNG signature, the IHDR dimensions and that
the copied bytes are byte-identical — the last one specifically catches the
utf8 corruption above.

**Campaign pause — built 12 September, plugin 0.3.3, NOT yet tested on a site**

"Stop publishing" / "Resume campaign" on each campaign card.

The thing to keep hold of: **a campaign status alone does not stop anything the
owner can see.** A post at `post_status = 'future'` is published by WordPress
core on its date, and core has never heard of this plugin. So `IE_Publisher::
pause()` has two halves — the status, which stops new posts being collected and
written, and holding each scheduled post as a draft, which stops the ones
already in the site. Remove either half and the feature does nothing useful.

`resume()` moves every remaining date **forward by however long the campaign
sat still**, rather than restoring the original dates. A three-week pause would
otherwise end with three weeks of backdated posts appearing at once — the
pattern that reads as automated, on a product sold for not reading as
automated.

Details that are load-bearing and all covered by `test-ie-pause.js` (20 cases):

- Only posts carrying `_ie_held_until` are released. Without that marker there
  is no way to tell a post *we* held from one the owner drafted by hand while
  the campaign was stopped, and resume would undo their decision.
- Published posts are never touched. Pause does not take live content down.
- The same `_ie_campaign` refusal `activate_for_slot()` makes — a stale slot
  record pointing at the customer's own page must never be edited.
- A post already overdue at the moment of the pause is **published** on resume,
  not written back as `future` with a past date. That is the classic
  missed-schedule post: WordPress accepts it and then never publishes it.
- `resume()` sets the campaign active BEFORE moving posts, because publishing
  one fires `on_transition()`, which reads and writes the same campaign option.
  Holding a copy in memory across that would overwrite the slot it just marked
  published.
- `upcoming()` and `collisions()` now ask `'active' !== status` instead of
  naming `'cancelled'`. They named one dead status, so a paused campaign's
  drafts would have shown as overdue — the alarm that means WP-Cron has died.

Still open: this has never run on a real site. Install 0.3.3 on
roofingamerica.xyz, stop a campaign, confirm the scheduled posts become drafts,
resume, confirm the dates moved.

The other half of the conversation — a softer "the customer stopped paying"
stop that leaves already-scheduled posts to publish — was deliberately left
undecided. Do not build it without asking.

**Next — raised 11 September, for 12 September**

*Stripe live keys.* Only two variables are involved: `STRIPE_SECRET_KEY` and
`STRIPE_WEBHOOK_SECRET`. Edwin sets both on the server himself; a live secret
key is never pasted into a session, committed, or written to a local file.

The trap is the second one. **`STRIPE_WEBHOOK_SECRET` is different in live
mode** — it belongs to a specific endpoint, and the live endpoint has to be
created in the Stripe dashboard and its own signing secret copied out. Swap
only the API key and checkout succeeds while every webhook fails signature
verification, so customers are charged and credits are never granted, quietly.

Two things that are *not* a problem here, worth knowing so nobody goes looking:
`utils/creditPacks.js` passes inline `price_data` rather than stored price IDs,
so there are no test-mode products to recreate in live; and there is no
publishable key anywhere, because billing is a Checkout redirect and never
touches Stripe.js on the client.

*Blog hero image.* **Done on 12 September** — and it needed no custom post
type. See "Deliberately dropped" for why the CPT was abandoned.

The goal was "at least one main image so it doesn't look like plain text".
Everything for that already existed: `functions.php` declares
`post-thumbnails` support and registers four hero sizes, the blog card grid
renders a thumbnail, and the `BlogPosting` schema publishes it as `image`.
Only `single.php` left it out, so a Featured Image showed on the listing and
vanished when you opened the post.

`generateSinglePhp()` in `pageTemplatesPhp.js` now renders it, after the `<h1>`
and before `the_content()`. Notes, all of them load-bearing and all covered by
`test-wp-single.js`:

- `loading="eager"` and `fetchpriority="high"`. WordPress lazy-loads
  thumbnails by default, and this is the LCP element on a post page.
- The theme's own `<prefix>-hero-desktop` size, not `full` — `full` ships the
  customer's original upload, often several megabytes.
- No `alt` is passed, so `the_post_thumbnail()` uses the attachment's own.
  Forcing the post title in would make every hero announce the heading printed
  directly above it.

**Nothing was needed on the plugin side.** WordPress's Featured Image panel is
already in the editor on these sites and is already one image per post. The
customer sets it there.

Still to do: this only reaches a live site on a theme re-export and reinstall,
exactly like the archive canonical fix — see the WordPress section above.

**Cleanup**

- ~~`brew install php`~~ — done differently on 12 September; the two PHP suites
  run on the VPS. See the Tests section.
- ~~`MONGO_URI` for the blog suites~~ — mostly a non-issue; see the Tests
  section. Only `findWork` needs a database, and it must be a scratch one.
- The server has 25 pending package updates, 11 of them security, and a kernel
  upgrade waiting on a reboot. Noticed 12 September. Needs a quiet moment and
  its own plan, not a ride-along with a deploy.
- ~~`test-blog-api.js` and `test-blog-scheduler.js` need `MONGO_URI` set. They
  exit without running, so they have never told anyone anything.~~ **Not true**
  — corrected 13 September. One needs no database at all and the other only
  skips a single section. See the Tests section. Neither is in `deploy.sh`,
  though, which is the thing actually worth fixing.

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
- **A custom post type for generated blogs.** Raised 11 September, dropped on
  the 12th. The goal turned out to be "the posts look like plain text", which
  a featured image solves without moving anything. A CPT would have cost:
  permalinks changing on already-indexed posts, the posts leaving the main
  blog loop and the customer's blog page emptying, feeds and category/tag
  archives needing explicit opt-in, and existing rows not migrating
  themselves. None of that buys anything the product wants. If it is ever
  raised again, note that generated posts already carry `_ie_campaign` post
  meta (`class-ie-publisher.php:336`) — telling them apart in wp-admin is an
  admin column and a filter, not a new post type.
- **Per-service FAQ sections.** Considered for making service pages distinct;
  rejected because adding the same section to every service page makes them
  more alike, not less. The topic rotation was built instead.
