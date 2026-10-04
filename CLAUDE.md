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

## Hand-styled app pages — SAY WHEN YOU CHANGE HOW THEY LOOK

**This was a DO NOT TOUCH rule until 24 September 2026. Edwin lifted it:**
*"the do not touch was a while back, now we can forget about that but let me
know when it's needed."*

So the rule is no longer "ask before touching presentation". It is: **change
what the work needs, and say plainly in the reply that you changed how a page
looks, and what.** The reason for the original rule still stands — these are
deliberate aesthetic choices, not generated output — so the cost of a silent
restyle is that Edwin finds it on screen rather than in a sentence.

Still true, and still worth keeping to:

- Don't reformat or "tidy" markup and CSS that the change did not require.
- Prefer a new stylesheet for a new control over rules pasted into a page's
  `<style>` block — `/logo-shape-picker.css` and `/business-type-picker.css`
  are that pattern.
- Take colours from classes the page already loads rather than inventing
  them, unless the job is a colour.

Edwin also restyled the app's own pages by hand: login, dashboard, blog sites
and others. Those pages have no stylesheet of their own — the markup and its
styling are written INLINE in the route files and the view templates, so the
CSS and the logic sit in the same file:

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

Which means a change to how one of them looks lives in the same file as the
logic, and is easy to make by accident while editing something else. That is
the reason for the reporting rule above: not that these files are off limits,
but that a change to them is invisible until somebody loads the page.

`utils/renderAuthPage.js` fills `{{CSRF}}`, `{{ALERT}}` and `{{EMAIL}}` into the
view files. Its alert markup is presentation too.

**What changed on these pages on 24 September**, while the old rule was still
in force and each was asked for by name:

- `login.html`, `signup.html` and the `page()` shell in `passwordRoute.js`
  gained a viewport meta tag and `/js/passwordToggle.js`, which builds a
  show/hide button beside every password field.
- `form.html` gained `/business-type-picker.css` and
  `/js/businessTypePicker.js`, and wizard step 1 stopped being a `<select>`.

Neither touched a class, colour, spacing, `<style>` block or inline style, and
both build their controls at runtime — so with JavaScript off those pages are
byte for byte what they were.

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

**A new dependency has to be installed here before `./deploy.sh` will run.**
The script runs the test suites first and `set -e` stops it on the first
failure — and a package that is in `package.json` but not in `node_modules`
fails a suite exactly like a broken test does. On 22 September that ate a whole
deploy: `all-the-cities` was declared but not installed, `test-nearby-places.js`
threw *Cannot find module*, the rsync never ran, and the server went on serving
the previous build with no error to explain the missing feature. `deploy.sh`
now checks the declared dependencies before the tests and says which to install;
the fix is always `npm install --legacy-peer-deps`.

**Do not add `--omit=dev` to the install step.** It looks obviously right for a
production server and is wrong for this one: `utils/runProductionBuild.js` runs
webpack at request time to build each customer's site, so webpack, babel-loader,
css-loader, postcss and purgecss are runtime dependencies here despite living in
`devDependencies`. Pruning them put the app into a restart loop on 10 September.

## Tests

    node test-business-shape.js    # business shapes, prompts, case study, wizard parity
    node test-business-type-picker.js  # wizard step 1: search, numbers, keyboard
    node test-page-meta.js         # a GENERATED SITE's <title> and description; no php
    node test-page-titles.js      # the APP's own tab titles and the one APP_NAME
    node test-location-pages.js    # which location pages are allowed; needs no php
    node test-phone.js             # the phone format check, both sides; needs no php
    node test-app-header.js        # the logged-in header and its two copies; needs no php
    node test-auth-pages.js        # log in / sign up / reset: viewport, password eye
    node test-cost-report.js       # the spend report; needs no log file of its own
    node test-suggest-services.js  # suggested service pages + the budget; needs no php
    node test-wizard-steps.js      # the wizard's steps and the draft; needs no php
    node test-nearby-places.js     # suggested location pages, from real geography
    node test-keyword-volumes.js   # the lookup endpoint, the cache, the 402; no network
    node test-keyword-research.js  # the research page and all three of its modes
    node test-keyword-seeds.js     # the model-written seed terms and their cache
    node test-keyword-intent.js    # buyer intent, the CPC veto, cluster collapse
    node test-keyword-pairs.js     # trade x town, and the practitioner noun
    node test-keyword-budget.js    # the daily cap on paid lookups
    node test-wp-canonical.js      # runs the exported theme as real PHP; skips without php
    node test-wp-single.js         # single.php incl. the featured image; skips without php
    node test-ie-pause.js          # campaign pause/resume as real PHP; skips without php
    node test-wp-screenshot.js     # the theme screenshot and its binary-safe copy
    node test-ie-video.js          # the campaign video and where it lands; skips without php
    node test-ie-topics.js         # the campaign form's topic/video readers; skips without php
    node test-blog-plan.js
    node test-anchor-pool.js       # what each anchor bucket may contain, and the mix; 22
    node test-home-anchors.js      # the generated SITE's home-page anchors; needs no php
    node test-blog-states.js
    node test-email-from.js        # the From header, incl. RFC 5322 quoting
    node test-email-html.js        # the HTML email body and its escaping
    node test-blog-report.js       # /blog-report, its two tabs, row numbers, dates and CSV; 103
    node test-removal-time.js      # the removal time a site reports, and its bounds; needs nothing
    node test-business-refresh.js  # the business a site reports, and what may overwrite what; 9
    node test-post-quality.js      # length, the three wrappers, and where they sit
    node test-campaign-reconcile.js # markMissingRemoved: the grace window and the site scope
    node test-blog-sites-delete.js # removing a revoked licence; revoked + no campaigns only
    node test-licence-binding.js   # one licence one site; the URL check and old-plugin safety

    php wp-plugin/test-deleted-posts.php  # deleted/live slot reconciliation, 34 cases
    php wp-plugin/test-topic-merge.php    # the Suggest topics button adds, it does not replace
    php wp-plugin/test-admin-tabs.php     # RENDERS class-ie-admin.php: folds, filter, dialogs, 64
    php wp-plugin/test-orphan-links.php   # placeholder repair, ring close, pause guards, SEO titles, removal queue, 70

177 assertions in all; last run green on 30 September under PHP 8.4.

`test-admin-tabs.php` is the only harness that can actually render
`class-ie-admin.php`. It had drifted to 6 passing / 23 failing while sitting
outside `deploy.sh`. **Do not rework the Campaigns screen without it.**

The PHP suites run in `deploy.sh` behind a `command -v php` check, and when
php is absent it says **"SKIPPED, not passed"** — a check that did not happen
must never read as one that did. `test-deleted-posts.php` spent its whole life
outside that loop because the loop runs `node "$suite"`, so it ran on the days
somebody remembered.

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

**The PHP suites cannot run on Edwin's Mac.** It is on macOS 12, which
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

## Adding a business type — the four places

Done twice in two days (Eye Doctor, 30 September; Moving Company, 1 October)
and it was the same four edits both times. The tests catch three of them; the
fourth is the one that matters.

**Before touching code**, the two assets must exist, named by the IMAGE FOLDER
slug, not the label:

    src/predefined-images/<slug>/     aboutUs + page1..page10,
                                      each with hero/ section2/ section4/
    utils/altText/<slug>.js           an array of exactly 11 sets
                                      (1 About + 10 rotation)

Then:

| # | File | Edit |
|---|---|---|
| 1 | `utils/businessShape.js` | the registry entry — label, shape, category, title, entity, aliases |
| 2 | `public/js/generateDinamycForm.js` | `BUSINESS_TYPE_LABELS` — same position as the registry |
| 3 | `public/js/generateDinamycForm.js` | `BUSINESS_TYPE_SHAPES` — same shape as the registry |
| 4 | `utils/createPagesPrompt.js` | `TRADE_VOCAB[<category>]` — parts, symptoms, work |

**NUMBER 4 IS THE ONE THAT BITES.** It is keyed on the CATEGORY, not the
label, and nothing crashes without it: `createPagesPrompt` falls back to
`DEFAULT_VOCAB` and writes every page out of "materials, components,
fittings". The symptom is a live site that reads like a template.
`no dropdown type falls through to the generic vocabulary` turns that into a
blocked deploy, which is the only reason it gets noticed.

**Things that are decided, not typed:**

- **shape** sets everything downstream. `home` gets the price table, the trust
  badges and the trades location FAQ (arrival windows, access, parking,
  permits). `medical` and `professional` get none of those, for the
  licensing-board reasons in CAPABILITIES.
- **label** feeds `entityFor`, so it has to survive "a local ___". "Moving
  Company" works; "Movers" gives "a local movers". Put the plural in aliases.
- **aliases MOVE, they are not copied.** Whichever entry registers a key first
  wins the exact match, so a key owned by two entries makes the answer depend
  on array order. Eye Doctor took `optometrist` and `ophthalmologist` off the
  Health Practice catch-all rather than duplicating them.
- **a type with no photo folder builds a complete site with no pictures.**
  `copyPageImage` warns and skips; `buildAltText` warns and returns `{}`.
  Neither throws.

**Then run `node test-business-shape.js`** — it checks the wizard's two lists
match the registry in order, that every type finds both its photo folder and
its alt file on disk, and the vocabulary gate. All four edits are covered.

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

## PLANNED — blogs published to Cloudflare Pages

Agreed 1 October, **not started**. Edwin: *"I want to do it but let's start
tomorrow."*

**The goal:** 20 blogs of his own, free hosting, generated and scheduled by
this app and pushed as static HTML. WordPress stays for everything it does
today; this is a second target, not a replacement.

### The facts that make it work

| | |
|---|---|
| Projects per Cloudflare account | **100** (soft cap, raisable by support) — 20 blogs = 20 projects |
| Files per deployment | **20,000**, counting images. ~4,000 posts at 4 images each |
| Max file size | 25 MiB |
| Builds/month | 500 — **Git-connected only.** Direct Upload is exempt |
| Bandwidth | unlimited |

**Direct Upload not counting against the build quota is the whole design.**
Cloudflare staff: *"currently they don't count towards any quota… in the
future, there will likely be a separate 'deployments' quota."* So deploy
**once per blog per scheduler run**, batching whatever came due — same result,
a twentieth of the deploys, and immune if that quota appears.

**Storage cost is nil, and this was checked rather than assumed.** A post is
1,000–1,300 words ≈ 12 KB stored. 20 blogs × 100 posts ≈ 24 MB raw, ~8 MB
after Mongo's compression, against a 512 MB free tier. WordPress hosting for
20 sites renews at $150–350/year. **Images never go in Mongo** — they are
files, and they go to Cloudflare where storage and bandwidth are free.

### Why it lives in THIS app, not a separate one

Edwin asked whether to build it as a separate app so a mistake could not
damage what works. Right instinct, wrong tool, and the reasoning is worth
keeping:

- A separate app needs the same database, so `BlogCampaign` and `BlogSite`
  would be **duplicated schemas writing to one database**. Mongoose will not
  stop the second app writing documents the first cannot read. That is the
  same fault as the two hand-written `keptOn` coercions from 30 September,
  scaled to an entire data model.
- The change list is **eight new files**; the edits to existing ones are
  additive — one enum value, one job kind, one route. Nothing in the WordPress
  path changes behaviour.
- The protection already exists: `deploy.sh` runs the suites plus
  `check-boot.js` and refuses to ship. It stopped a broken build twice on
  30 September.
- **The isolation that is actually wanted is at the JOB level** — a `publish`
  job that throws is one failed job, and site generation, blog writing and the
  scheduler carry on.

Extract later if the blog product gets its own customers or infrastructure.
*Extract once the seams are known.*

### Files

**New**

    utils/blog/cloudflare/deploy.js     Direct Upload: hash, ask what is
                                        missing, send only that. The ONLY
                                        file that talks to Cloudflare.
    utils/blog/cloudflare/token.js      Encrypt/decrypt the API token.
    utils/blog/render/renderBlog.js     blog + posts -> { path: contents }.
                                        A MAP, not files on disk, so every
                                        page is testable in memory.
    utils/blog/render/postPage.js       one article -> HTML
    utils/blog/render/indexPage.js      home page and pagination
    utils/blog/render/feeds.js          sitemap.xml, rss.xml, robots.txt
    utils/blog/render/interlinks.js     which posts link to which, baked at
                                        render time — replaces repair_links()
    utils/blog/staticTarget.js          what a static target can and cannot
                                        do. Sibling of siteUrlGuard.js.

    test-blog-render.js
    test-cloudflare-deploy.js
    test-static-target.js

**Changed**

    models/BlogSite.js          target: 'wordpress'|'cloudflare', project,
                                domain, encrypted token
    models/BlogCampaign.js      slots gain a BODY field — today the schema
                                stores only the plan (topic, slug, anchor,
                                dates, wpPostId, publishedUrl) and the article
                                text lives in WordPress. This is the change
                                that puts articles in our database.
    utils/blogScheduler.js      enqueue one publish job PER BLOG, not per post
    server.js                   jobRunner.registerGenerator('publish', …)
    routes/blogSitesRoute.js    add/edit a Cloudflare blog
    routes/blogReportRoute.js   columns that cannot apply to a static target
    utils/blog/reportFilters.js same
    deploy.sh                   the three new suites
    .env                        CF_ACCOUNT_ID, CF_API_TOKEN,
                                TOKEN_ENCRYPTION_KEY

### Build order — and `staticTarget.js` comes FIRST

1. **`staticTarget.js` and the report semantics.** Decide on paper before any
   rendering.
2. One hardcoded blog: renderer + deploy, end to end.
3. The `target` discriminator through the report.
4. The other 19.

**WHY THE ORDER.** Everything the blog report says today assumes WordPress:
posts trashed on the site, campaigns deleted from a site that then stops
reporting, the removal-timestamp queue, "published, but the campaign was
removed". **On a static target none of it can happen** — every deploy is a
fresh render from Mongo, so the database is the only truth and there is
nothing to repair and nothing to reconcile.

Ship the second target without deciding this and the report grows a column
reading "Deleted" on a site where deletion is impossible. That is precisely
what 30 September was spent removing. **A value that cannot be true is worse
than no value.**

### Open

- Token storage is a **different posture from licence keys.** Licence keys are
  never stored — SHA-256 and last 4 only. An API token must be *usable*, so it
  is stored reversibly, encrypted at rest with a key in `.env`. A database
  dump becomes a credential leak in a way it is not today.
- Whether a customer-facing version later uses their Cloudflare account rather
  than Edwin's. For his own 20 blogs: his account.
- A brand-new Cloudflare account has a lower project cap for the first 48
  hours.

## PLANNED — pillar campaigns (a campaign with no target page)

**NOT STARTED.** Designed with Edwin on 2 October, after I proposed the wrong
shape twice and he corrected it. Every file and line number below was read, not
recalled.

### The design, and why it is his and not mine

For his own 20 content blogs there is no money page to point at — there is no
business, no service, nothing to sell. The articles have to point at each
other.

**My first proposal: the pillar is slot 0 of the campaign, and it links DOWN to
its ten children.** He rejected it, correctly. A pillar that lists its children
has to be **rewritten** every time a later campaign adds more, because the link
list lives inside `post_content` as frozen HTML. That is surgery on text, every
campaign, forever.

**His design, which has none of that problem:**

- **Campaign 1 — the pillars.** Four or five posts, **no target page**. They
  ring-link to one another: 1 → 2 → 3 → 4 → back to 1. That is the existing
  ring, unchanged.
- **Campaigns 2, 3, 4… — the silos.** Ordinary campaigns exactly as today, each
  pointing at one of those pillars as its target page.
- A checkbox at creation: *these posts are pillars (no target page)*.

**PILLARS LINK SIDEWAYS; CHILDREN LINK UP. NOTHING EVER LINKS DOWN.** That one
sentence is the whole reason his version is cheaper: every link is written once,
at the moment its post is written, and is correct forever. There is no growing
list, so there is nothing to maintain, so there is no rewrite step to get wrong.

### What a pillar campaign actually is, mechanically

Each post today gets three links: `prev`, `next`, and `money`. **A pillar
campaign is a campaign that omits `money` and keeps the other two.** That is
the entire feature. The ring in `linkPlan.js` is built from neighbouring slots
and never consults `targetPage` — the money link is a separate, parallel thing
hanging off the same slot.

`linkPhrase` is already the anchor text for ring links (`referTo()`,
`linkPlan.js:72-75`, prefers it over the topic), already chosen at planning
time, already stored per slot. **Pillar-to-pillar anchors need no new code** —
only `linkPhrase` values written for topic relationships ("fixing leash
problems") rather than service ones ("emergency drain cleaning in Austin"), and
that is prompt wording.

### Every place that assumes a target page exists

**`models/BlogCampaign.js:207-208`** — `targetPage.url` and `targetPage.keyword`
are `required: true`. Conditional on the new flag. Add
`isPillar: { type: Boolean, default: false }`.

**`routes/blogApiRoute.js:229`** — `/api/blog/plan` returns 400 without a URL
and keyword. **`:247`** — the `priorCampaigns` lookup keys on
`'targetPage.url'`; meaningless for a pillar campaign, skip it. **`:295-300`** —
`BlogCampaign.create()` writes the `targetPage` sub-document unconditionally.

**`utils/blog/campaignPlan.js:40-41`** — throws without url and keyword.
**`:43`** — calls `buildAnchorPool()`, which itself **throws** at
`anchorPool.js:144` when `targetPage.keyword` is missing. A pillar campaign must
not call it at all: there are no money anchors to balance. **`:101-103`** —
`moneyAnchor: s.money.anchor` reads a sub-object the planner will no longer
produce. **`:122`** — `suggestedName` is built from the keyword.

**`utils/blog/planCampaign.js:76`** — throws without `targetPage.url`.
**`:110`** — builds `money: { url: targetPage.url }` into every slot.

**`utils/blog/linkPlan.js`** — lines 99, 123, 154, 171, 174-179 all read
`campaign.targetPage.*`. Omit `slot.money` and `targets.money`; `ctx.targetPage`
needs a shape that does not pretend.

**`utils/blog/writePost.js:134` — THE ONE THAT ACTUALLY CRASHES.** The money
instruction is pushed **unconditionally**, unlike `prev` and `next` directly
below it which are both behind `if`. With no `slot.money` this is
`TypeError: Cannot read properties of undefined (reading 'anchor')` — not a bad
post, a dead generation. **`:265`** — `stubPost()` has the same unguarded read,
and also interpolates `ctx.business.town`, which is empty on a blog.

**`wp-plugin/.../class-ie-settings.php::target_pages()`** — queries
`post_type => 'page'` only, so a pillar published as a Post never appears in the
Target Page dropdown and campaign 2 could not select it. Widen it to include
posts carrying the pillar flag. The publisher must write that flag as post meta
at publish time.

### What does NOT need changing, and the correction that matters

**`utils/blog/qualityCheck.js` is already right.** I told Edwin the checker
would reject every pillar post because it verifies `{{money}}<anchor>{{/money}}`
verbatim. **It does not.** Both sites are already guarded — `if (slot.money &&
…)` at `:165` and `if (slot.money && slot.money.anchor)` at `:224`. The
placement warning at `:203` is behind `spread.placed.money &&`. Nothing to do.

**The writer is unguarded and the checker is guarded, which is backwards from
what I assumed.** I assumed the checker was the fragile half because its comment
says "verbatim", and the comment in `linkPlan.js:22` repeats the claim. **A
comment describing a strictness is not the same as the code being strict** —
and the file that said nothing about the subject was the one that would have
crashed. This is the second time this session that reading the comment instead
of the condition pointed me at the wrong file.

### The gap nothing would catch

**A one-post pillar campaign would publish an article with zero outbound
links, and pass every check clean.** `ringNeighbours()` returns
`{ prev: null, next: null }` for `n < 2` (`linkPlan.js:40-41`), the money link
is now absent by design, and all three link assertions in `qualityCheck.js` are
conditional — so there is nothing left to assert and the post passes.

So pillar campaigns need a **floor of two posts**, refused at `/api/blog/plan`
beside the existing 52-post ceiling. **Every link assertion being conditional is
correct per link and wrong in aggregate: nothing anywhere asks whether the post
has any links at all.** Worth considering a `no-links` failure in
`qualityCheck` independent of which links were expected.

### Order

1. The flag and the model, with the conditional requirement.
2. `writePost.js` — guard both unconditional reads. This is the crash.
3. `campaignPlan.js` / `planCampaign.js` — skip the anchor pool, omit `money`.
4. `linkPlan.js` — omit `slot.money` and `targets.money`.
5. The two-post floor, and the `no-links` check.
6. The plugin: the pillar flag as post meta, and `target_pages()` widened.

**Pillars as Posts, not Pages.** Edwin's call, and it is right: `post_type =>
'post'` is hardcoded in four places in `class-ie-publisher.php` (534, 799, 949,
1854), and a pillar is content rather than a template. Pages would have bought
tidiness — excluded from the feed, no byline, a cleaner permalink — and cost
four hardcoded lines plus the publisher's test surface. The tidiness is a
permalink setting and a little CSS on each blog instead.

### Open

- Whether the pillar ring should be a ring at all, with four pillars on four
  different subjects. A ring is standard silo practice for top-level hubs and
  costs nothing, since it is the machinery already there. Worth looking at once
  four real pillars exist.
- ~~The pillar prompt itself~~ — **done, 3 October, deployed.** See below.

### The blog voice — 3 October, deployed

`SYSTEM_BLOG` in `writePost.js`, chosen by `systemFor(ctx)` on `ctx.isPillar`,
which `buildLinkPlan` sets from `campaign.isPillar` three lines from where it
sets `ctx.targetPage`. **Not inferred from `targetPage === null`**: "there is
no money page" and "there is no business behind this" coincide today and are
different claims, and the day they stop, every post gets the wrong voice with
nothing to say so. `test-pillar-campaign.js` 31 → 38; a mutation that switched
the hook to the null check is caught.

**A SECOND PROMPT, NOT AN EDIT TO THE FIRST.** The trade prompt is tuned and
every customer's posts come out of it. "You are a tradesperson, unless you are
not" is not an instruction, and softening the one that works to cover a second
case makes it worse at the job it already does.

**What the trade lines did to a blog article**, which is why this was not
cosmetic:

| In the output | The line that caused it |
|---|---|
| "in fifteen years on the job", "every client who walks through the door" | *You are a working tradesperson writing for your own customers* |
| "right now", "in the next five minutes" | *Someone with a problem, right now, at home ... Not a student* |
| "in our area", "around here the parks are busy" | *A paragraph that would still be true for a different trade in a different town should not exist* |

The locality rule is the interesting one: it is correct for a Leander plumber
and **backwards** for a content blog, where a good paragraph SHOULD be true in
every town. Left in, it tells the model to delete its best work or fake a
region.

**The forbidden-claims list is LONGER than the trade one, not shorter.**
Removing the business removed what was keeping the model honest. `SYSTEM_BLOG`
explicitly bans experience of its own ("no clients, no customers, no years in
the field ... there is no 'we' and there is no 'I'"), inventing a place, laws,
statistics, and endorsing a product.

**Checked rather than assumed: `qualityCheck` needed nothing.** The specificity
scorer counts `weeks|days|hours|minutes|feet|inches|years` plus any bare
number, so "two weeks of ten-minute sessions" and "six feet of lead" clear the
bar unaided. The `RISKY` list warns on "permit" and "regulation" — a
**warning**, not a failure, so dog licensing costs no retries.

**Two of my own tests were wrong and the prompt was right.** One matched a
sentence that wraps across a line in the template literal. The other banned the
word "customers" — which is in the prompt *to forbid* customers. **A check that
cannot tell an assertion from its negation would have forced the rule out of
the prompt to keep itself green.**

**A mutation that reports SURVIVED because it never applied is not a result.**
One of the six died on a shell quoting error, printed SURVIVED, and was
re-run properly with an `assert` on the anchor. 6 of 6 caught.

### BUILT AND WORKING — 2 October (plugin 0.16.0)

Both halves shipped and a pillar campaign plans end to end. Server: `isPillar`
on the campaign, conditional `targetPage`, the money link omitted through
`planCampaign` / `campaignPlan` / `linkPlan` / `writePost` /
`blogGenerator.renderPayload`, a two-post floor. Plugin: the checkbox,
`target_pages()` widened to published pillar POSTS, `_ie_is_pillar` stamped at
insert. Tests: `test-pillar-campaign.js` 36, `wp-plugin/test-pillar-plugin.php`
12, `test-admin-tabs.php` 66 → 71. Both in `deploy.sh`.

**Three unguarded reads of the money page, not one.** `writePost.buildPrompt`,
`writePost.stubPost` and `blogGenerator.renderPayload` all pushed or spread
`slot.money` while the `prev` and `next` beside them sat behind an `if`. The
third is the worst placed: it throws AFTER the post is written and the credits
are taken. **`qualityCheck` was already guarded** — I predicted out loud that
it would reject every pillar post, and it would not have. `linkPlan.js`'s
comment says the checker verifies the anchor "verbatim", which made the strict
file look like the fragile one. **A comment describing a strictness is not the
same as the code being strict**, and the files that said nothing on the subject
were the ones that would have crashed.

**A syntax check proves the syntax is valid for the interpreter running it.**
The plan payload first used `...( $is_pillar ? array() : array( 'targetPage' =>
… ) )`. String-keyed array unpacking is **PHP 8.1**; the plugin header says
`Requires PHP: 7.4` and it runs on customers' hosting, where it is a PARSE
error — the whole file, not one function. Every site on an older PHP would
have gone white on upgrade. `php -l` passed it, because this machine runs 8.4.
`test-pillar-plugin.php` now scans every plugin file for 8.x constructs and is
tied to the declared floor, so raising the header fails that test.

**Only the half of the page that had been parsed existed.** The toggle script
sat between the first table and everything below it, and an inline script runs
as the parser reaches it — so `querySelectorAll` found the three `<tr>` rows
above and never saw the Suggest button below. The rows hid, the checkbox looked
wired up, the button sat there as if its class had been forgotten, and nothing
errored. Edwin found it on the real screen; no test here could, because none
rendered the form. Now deferred to `DOMContentLoaded`, and
`test-admin-tabs.php` asserts the ordering invariant.

**The ordering test passed against the bug it was written for.** It searched
for the words `DOMContentLoaded` and `readyState` anywhere on the page, and
deleting the fix left both — in the COMMENT explaining the fix. **Third time a
check in this project has read prose as code.** It now strips comments before
searching and looks for the CALL, not the word. The sibling assertion counted
`ie-needs-target` occurrences with a `>= 5` threshold, and the script's own
selector was one of the matches, so stripping the class off the button left
exactly 5. Both found by mutation testing and by nothing else.

### The first pillar as the site's home page — 3 October, plugin 0.18.0, SHIPPED

**BUILT AND INSTALLED.** Everything below was the design agreed with Edwin
before building, kept because the build did not contradict it — with one
exception, recorded at the end of the section. **It is not pending work.** A
session reading the old "NEXT / Not started" heading would have rebuilt it.

**What it does.** A pillar campaign of N topics. Slot 0 is created as a PAGE and
set as the site's front page; slots 1..N-1 stay Posts. Publish all makes the
lot live together. All N are pillars — later silo campaigns can point at any of
them, including the home page.

**Why.** On a brand-new blog with nothing on it, the front page would otherwise
be the post archive. Edwin wants a stable page at the root that he controls and
links out from, without building anything by hand.

**THE RING DOES NOT CHANGE.** `ringNeighbours()` works on slot indexes and has
never known what post type a slot became. Slot 0 keeps both neighbours: slot 1
links back to it, slot N-1 closes the ring forward to it. **Two inbound links,
exactly as today** — I said "nineteen" twice in conversation, which was wrong
and made the risk sound far bigger than it is.

**The work, after reading the code rather than guessing:**

1. `class-ie-publisher.php:534` — `'post_type'` conditional at creation.
2. **Three queries widened to `array( 'post', 'page' )`** — lines 818, 968 and
   1873. **Unconditionally, with no branching**, because every one of them is
   already bounded by `meta_key => '_ie_campaign'` and so can only ever reach
   content this plugin created. No half-a-rename risk.

   My first estimate called these "deleted-post detection, reconciliation and
   pause/resume". **Wrong.** They are: finding siblings to activate placeholder
   links in (818), `repair_links()` (968), and publishing posts WP-Cron missed
   (1873). The first is the one that matters — without it the home page's
   forward ring link stays a dead `<span>` for ever.
3. After slot 0 publishes: `show_on_front` → `'page'`, `page_on_front` → its
   id, **and only then read the permalink.**
4. A checkbox on the pillar campaign form. Not a convention — claiming the
   front page is not something to infer.
5. NO `page_for_posts`. Edwin's decision: the post index stays unreachable.

**THE ONE SUBTLE FAILURE, and the test that earns its keep.** A page that is
`page_on_front` has `get_permalink()` of the SITE ROOT, and WordPress 301s its
own slug to `/`. The plugin records `publishedUrl` at creation — before the
option is set — so in the wrong order it stores `/first-topic/`, and the two
ring links into the home page hit a redirect. Not broken; wrong, and silently.
The blog report would also list a URL the page does not have, which is the kind
of small wrongness this project has already decided it cares about.

Assert the recorded URL is the site root, and mutate the ordering to prove the
assertion catches it.

**Estimate: half a day.** Note this estimate moved from "a day" to "half a day"
once the three queries were actually read — the first number was guesswork
dressed as analysis. Half a day was about right.

**THE ONE THING THE DESIGN GOT WRONG, found mid-build.** Point 3 above says to
set `show_on_front` after slot 0 publishes, and the first implementation set it
**at insert** instead. On a scheduled pillar campaign slot 0 is a `future`
post for weeks, so the site root would have pointed at a page that returns 404
to the public for as long as the schedule ran. Moved into `on_transition`,
where it fires the moment the page actually goes live. `claim_front_page()`
also **refuses** when `show_on_front` is already `'page'` with a different
`page_on_front` — a customer's existing home page is not ours to take.

**`home_page` survived a mutation because every fixture set it by hand.**
Deleting the default from `read_form()`'s ordinary branch changed nothing: all
the tests of the behaviour supplied the field themselves. **A FIELD IS NOT
COVERED BY TESTS OF THE BEHAVIOUR IT DRIVES IF THOSE TESTS SUPPLY THE FIELD.**
Now there is a test that reads the form with the box unticked and asserts the
key is `false` rather than absent.

### NEXT — number the options in the target-page dropdown, 4 October

**Agreed with Edwin, 4 October. Small, and specified.** He asked, then chose
between the readings himself:

> *"Number the options — '1. Home loans · 2. Refinancing' — so you can refer
> to a page by number instead of a long title."*

**Presentation only.** Not a count of campaigns per page, not a separate list
screen — both were offered and neither is what he meant.

#### THE RULE THIS MUST FOLLOW, AND IT IS ALREADY WRITTEN DOWN ONCE

**THE NUMBER IS ADDED WHERE IT IS DISPLAYED AND NEVER STORED.** The " —
pillar" marker in the same dropdown has a docblock explaining exactly this,
and the reason applies unchanged:

`read_form()` keeps the selected page's title, it becomes the campaign's
label, and it travels to the server as `targetPage.title`, which `writePost`
drops into the sentence *"It becomes a link to the X page"*. A decorated title
means every post in the silo refers to **"the 3. Home Loans page"**.

So the number goes in the `<option>` text in `class-ie-admin.php`, beside
where the pillar marker is added, and nowhere else. `target_pages()` returns
the real title and keeps returning it.

#### RAISED AND ACCEPTED — do not bring it up again

**The number is a position in the list, not an identity.** `target_pages()`
orders pages by `menu_order title` and appends pillars by date. Publish a new
page, rename one, or add a pillar, and the numbering shifts — what was 3
yesterday is 4 today.

That is fine for its stated purpose, reading a long list and saying "the third
one" in the same sitting. It is not a stable reference, so it must not be
written down anywhere as if it were, and it should not appear in the campaign
record or in any message the owner might act on later.

**Edwin was told this and accepted it:** *"fine with this: The number is a
position in the list, not an identity."* It is settled — do not re-raise it as
a concern, and do not build stability it was never meant to have.

### PROMPT AND QUALITY-RULE WORK — Edwin's own day, 4 October

**DO NOT BUILD ANY OF THIS WITHOUT HIM.** His words: *"do not build the
rules-prompt yet. I will have a whole day to go over prompts again. Add it to
the list."* Everything below was found by reading the production log and two
live pages on 4 October. It is evidence for that day, not a work queue.

**1. `howto-title` and `guide-title` are trade-site rules applied to blogs.**
Their stated reasons are *"teaches the reader not to call"* and *"competes
with the service page"*. **A pillar blog has no service page and nobody to
call.** `howto-title` failed posts on 3 and 4 October. For a hub article whose
whole job is answering a question, a how-to title may be the right title.
Likely fix: skip both when `isPillar`.

**2. `guide-title`'s regex has a hole.** `/\b(ultimate|complete|definitive)
guide\b/i` needs the two words adjacent. The live title **"What Information Do
You Need for a Loan Application? A Complete Preparation Guide"** has one word
between them and sails through — and it is exactly the shape the rule exists
to catch. Separate from #1: the hole is real on the trade sites where the rule
does apply.

**3. NOTHING CHECKS HOW LONG A TITLE IS.** That live title is **81
characters**; Google shows about 55–60, so it displays cut mid-word. The
description has a 155-character warning and the title has no rule at all —
**and this is the precise harm 0.19.0 was built to prevent.** The note for
that release says the domain "eats characters off the end of a headline
written to fit". Nothing ever made sure the headline fits.

**4. "whether you" is the model obeying its instructions.** Six occurrences in
the log, the most common failure there is. `SYSTEM_BLOG` forbids it as an
OPENING; `qualityCheck` matches it ANYWHERE. The model does not open with it,
uses it mid-paragraph, and is failed for following the rule it was given.
**The instruction and the check disagree about scope.** One has to move.

**5. AND THAT IS A SYMPTOM.** The prompt's forbidden-phrase list and
`qualityCheck`'s `FILLER` array are **two hand-maintained lists in two files
that must agree, and do not.** The prompt is missing at least: *in the world
of · in this fast-paced · look no further · all in all · latest advances ·
take it to the next level · elevate your · research has shown · call us
today*. Every one is a phrase a post is failed for and the writer was never
told to avoid. The fix that ends the class is to build the prompt's list from
`FILLER` — one source of truth.

**What is NOT a problem, measured rather than assumed:**

- **Vagueness is solved.** Densities were 0.37–0.95 and failing through late
  September; since `SYSTEM_BLOG` shipped on 3 October they read 1.81, 6.84,
  9.81. Leave it alone.
- **The rewrite machinery has never once fired.** No `blog.post.rewriting`
  line exists in the whole log. `links-crowded`, `short`, `money-link`,
  `next-link` and `prev-link` have never failed in production. Link placement
  and post length are solid.

### Watched a campaign reach `active` — 4 October, CLOSED

**The oldest open item in this file, and it had been working the whole time.**
`log.info` goes to pino, and in production pino writes to `logs/app.log` —
**not to stdout**, so none of it appears in `pm2 logs`. I sent Edwin to watch
pm2, where the only blog lines are the `console.log` usage dumps. **The events
this app carefully logs are invisible in the place an operator naturally
looks**, and a batch that had died would have looked exactly the same: nothing.

    grep blog.batch /home/ubuntu/app/logs/app.log | tail -5

Five batches, **42 posts, 0 failed**, 75 credits each, back to 2 October —
including one of 23. `stoppedForCredits: false` every time. The status write
sits immediately above that log line, so the line appearing means `active` was
set.

**Also confirmed live on hilltophomeloans.net, a Kadence site:**

- `wp-sitemap.xml` **4 entries → 2**. `IE_Hygiene` ran, and `owns_whole_site()`
  answered correctly with the setting untouched on Automatic
- **`/author/<username>/` redirects to the home page**
- Home page `<title>` is the pillar's own headline, no domain; description
  present. Same on a post. **0.19.0 confirmed on both a page and a post, on a
  theme that knows nothing about the plugin**

Edwin had already deleted "Hello world!" and "Sample Page" by hand some time
ago, so the ownership check was never tested against them on this site.

**The ring links are real anchors.** Edwin clicked every one of them and each
went where it should. Placeholder activation works end to end: a `{{next}}`
token written weeks before its target existed becomes an `<a>` the moment that
post publishes.

**So every one of the six checks passed, on a Kadence site.** Sitemap trimmed,
author archive redirected, title and description on both a page and a post,
ring links live, and slugs cut at a word boundary. **Nothing in this stack is
unobserved any more.**

### The slug fix dropped a word it did not need to — 4 October, same day it shipped

**Found by reading a slug this morning's fix had just produced on the live
site.** Not by a test, and the test written this morning passes on it.

    title   Benefits of Paying Off a Loan Early—and When It May Not Make Financial Sense
    clean   …-may-not-make-financial-sense     (76)
    cut@70  …-may-not-make-financial           (70, and clean[70] is '-')
    got     …-may-not-make                     (60)

"financial" **fitted exactly**. The character after the cut was the separator,
so nothing was broken — and the trim ran anyway and deleted it. The code could
not tell *"the cut landed mid-word"* from *"the cut landed on the join"*. One
character of lookahead settles it.

**WHY THE MORNING'S TEST MISSED IT, and this is the keeper.** That test asserts
the slug is a MAXIMAL prefix: put the next word back and it must overflow.
This slug satisfied that and was still wrong. **"Could a word be added?" and
"was a word removed that did not need removing?" are not the same question**,
and a maximality test only asks the first.

Two mutations caught: removing the check, and `charAt(SLUG_MAX - 1)`.
`test-blog-plan.js` 30 → **31**.

### A backtick killed every theme, and the fix did not land — 4 October

Two faults an hour apart, both mine, and the second is the more useful one.

#### ONE BACKTICK, AND THE WHOLE GENERATOR WAS DEAD

Every file in `utils/wpThemeBuilder/generators/` is **one enormous JavaScript
template literal**. A comment added to `functionsPhp.js` wrote `` `noindex` ``
and `` `users` `` in backticks, the way one writes Markdown. Each backtick
**closed the string**, and the PHP after it became JavaScript:

    SyntaxError: Unexpected identifier 'noindex'

Not the feature — **the file**, and with it every theme the app can export.
Caught by `deploy.sh`, which refused to push. The gate did its job.

**HOW IT GOT PAST A GREEN SUITE, which is the part worth keeping.**
`test-pillar-plugin.php` asserted the new filter existed by reading
`functionsPhp.js` with `file_get_contents` and searching for a string. **A
STRING SEARCH FINDS TEXT IN A FILE THAT CANNOT BE PARSED.** It passes on
gibberish containing the right words. Fifth time this project has had a check
that reads source as text and believes it has verified behaviour.

`test-wp-canonical.js` *does* `require()` the module and *did* catch it — on
the machine running `deploy.sh` and nowhere else. It pulls in `./buildSitemap`
and a chain of others, so anywhere one of them is missing it dies first and
reports a module-not-found that reads like a setup problem rather than a
defect. **The coverage existed and could not be run where the edit was made.**

New `test-generators-parse.js`: `require()`s every file in `generators/` and
`wpHelpers/` and **nothing else**, so it runs anywhere node does, in about a
second. First in `deploy.sh`'s list. Deliberately excludes `buildFromModel.js`
and the other orchestrators — their dependency chains are the exact fault it
exists to remove. Proved by mutation twice: the original backtick, and a fresh
one dropped into `pageTemplatesPhp.js`.

**A FILE VERIFIED BY READING IT AS TEXT HAS NOT BEEN VERIFIED.**
`node --check` takes a second and answers the only question that matters first.

#### THE SECOND CHECK I WROTE WAS WRONG, AND IT FAILED ON CORRECT CODE

It flagged any backtick on a line starting with `*`. True of a docblock
**inside** the literal, false of one **outside** it — and these files all have
ordinary JavaScript docblocks above the literal where a backtick is fine. It
failed immediately on `pageTemplatesPhp.js:164`, which quotes
`post-thumbnails` in a comment and parses perfectly.

**A TEST THAT FAILS ON CORRECT CODE IS WORSE THAN NO TEST.** The next person
makes it pass, and the only way to pass that one was to delete a backtick from
a comment that was never wrong. Deleted, with a note in the file saying why
and not to re-add it.

And it was the same mistake as the bug: **I wrote the rule against the six
generator files in my working copy and it passed. The real machine has
sixteen, and one of them is the counter-example. ASSERTING OVER FILES YOU
CANNOT SEE IS GUESSING.**

#### A COMMIT THAT REPORTS SUCCESS IS NOT PROOF THE BYTES LANDED

The fix was written, tested, committed — and the tool reported it written
while **the old file was still on the Mac**. Edwin ran `deploy.sh` twice more
against code that had already been fixed here, and asked "what's going on?"
while I was explaining a fix he did not have.

Reading it back settled it in one call: 5,258 bytes on disk against 5,618
staged. Re-committed, re-read, identical, green.

**The galling part: the batch of six files after the power cut WAS verified
this way — every one pulled back and compared byte-for-byte. The single-file
follow-up was not, because it was small.** The verification was treated as
ceremony for a big delivery rather than as the thing that answers the
question.

**So: after committing anything that is about to be run, stage it back and
`cmp` it.** It costs one call. The alternative is debugging a file that does
not exist on the machine reporting the error.

### Editing the title and description, and taking precedence — 4 October, plugin 0.21.0

**INSTALLED AND CONFIRMED LIVE, 4 October.** Edwin opened a published post,
edited the title in the new box, saved, and the change appeared on the live
page. Plugin only; no server change.

**WHAT IS STILL ONLY COVERED BY TESTS: the precedence half.** Edwin runs no
SEO plugin, so the four vendor filters have never fired on a real site. The
hook names were read from the vendors' documentation and are asserted by a
test, but nothing has yet proved that Yoast or Rank Math actually calls them
in a live install. **The first customer with Yoast is the first real run of
that path** — worth checking deliberately rather than discovering.

#### THE GAP: THEY COULD NOT BE EDITED AT ALL

The plugin has written a title and description onto every post since 0.12.0
and 0.19.0 finally put them on the page. Three ways to change them existed and
**none of them covered the sites Edwin is actually building:**

- generated theme — its own metabox. Not Kadence.
- Yoast or Rank Math — their box, which the publisher pre-filled. Not a site
  without an SEO plugin.
- Custom Fields — **no.** `_ie_meta_title` begins with an underscore, so
  WordPress treats it as protected meta and hides it from that panel.

So on every blog he is building, the text went on the page and stayed there.
It mattered within the hour: a live title came in at **81 characters**, Google
shows about 60, and there was no way to shorten it.

#### FEED THE OTHER PLUGIN, DO NOT RACE IT

Edwin's requirement: ours wins on the posts this plugin wrote, and nothing
else changes. The naive version prints our tags alongside Yoast's, which gives
the page **two `<title>` tags and two descriptions**, with the winner decided
by plugin activation order — a bug that surfaces months later when somebody
reorders their plugins.

`IE_SEO` now returns our value through the plugins' **own output filters**, so
the page still has exactly one of each tag, rendered by whatever is installed,
containing our text. No priority war, nothing to suppress.

    wpseo_title · wpseo_metadesc                              (Yoast)
    rank_math/frontend/title · rank_math/frontend/description  (Rank Math)

**ALL FOUR READ FROM THE VENDORS' DOCUMENTATION, NOT FROM MEMORY**, and a test
asserts the spellings. **A misspelled filter name does not error — it never
fires**, the feature ships doing nothing, and every direct-call test still
passes because none of them goes through WordPress.

**SEOPress and AIOSEO are deliberately not fed.** They stay in
`another_seo_plugin()` so the class stands down, and on those two a post falls
back to that plugin's default. Their filter names are unverified, and an
unverified hook name is a feature that silently does nothing.

#### AND SO THE PUBLISHER STOPPED WRITING THEIR KEYS — A REVERSAL FROM THIS MORNING

0.19.0 wrote our title into Yoast's and Rank Math's fields precisely because
`IE_SEO` stood down and rendered nothing there. **That reasoning died the
moment ours took precedence.** A copy in their box is now a second field the
owner can edit to no effect at all, and **a box that looks like it works and
does not is worse than no box.**

The test that asserted those four keys were written now asserts they are not.
It strips comments first, which matters more than usual here: the comment
replacing those lines names the keys while explaining why they are gone.

**Posts published by 0.19.0 and 0.20.0 keep those rows.** Not deleted on
upgrade — removing somebody's stored data to tidy up is the worse trade. On
such a post Yoast's box shows a value that no longer renders.

#### THE BOX

`IE_Metabox`, on posts and pages carrying `_ie_campaign` and nowhere else.
Title and description, each with a live character count against 60 and 155 —
**the cheapest possible version of the check that was missing when an
81-character title went live, placed in front of the person who can fix it.**
Over the guide colours red; it is a warning, not a limit.

- Writes `_ie_meta_*` **and** the theme-prefixed pair, because a generated
  theme renders from the prefixed one — writing only ours would mean editing
  the box on a generated site changed nothing on the page.
- **An emptied field is DELETED, not stored as `''`.** `IE_SEO` reads `''` as
  "leave the theme's default alone"; stored as an empty string the post would
  render a blank `<title>`. *An empty value is a claim that the value exists.*
- Four refusals before any write: autosave, nonce, capability, ownership. The
  ownership check is **not** redundant with `register()` — a form can be
  submitted against any post id, and the box not being drawn is not the same
  as the write being refused.
- The counter script waits for `DOMContentLoaded`. The elements above it
  happen to be parsed already; relying on that is how 3 October's bug gets
  written a second time.

#### 13 MUTATIONS, 12 CAUGHT FIRST TIME — AND THE SURVIVOR WAS A MASKED CHECK

Deleting the autosave guard changed nothing, because the test supplied
`$_POST = array()` — so the **nonce** check refused the write and the test
went green without the guard it was named after.

**A CHECK MASKED BY THE CHECK ABOVE IT IS NOT BEING TESTED AT ALL.** The test
now supplies a valid nonce and empty fields, which is the only shape where
only the autosave guard stands between an autosave and both values being
erased while the owner types the body. Re-mutated: caught.

`test-pillar-plugin.php` 47 → **60**.

### The archives WordPress invents — 4 October, plugin 0.20.0 + the theme

**NOT YET INSTALLED OR DEPLOYED.** Written and tested; the plugin ZIP needs
rebuilding and `functionsPhp.js` needs a server deploy.

**WHO CAUSED THIS: nobody here.** Since WordPress 5.5 every installation
publishes `/wp-sitemap.xml` with four sections — posts, pages, taxonomies,
users — on every theme and with no plugins at all. The `users` section
publishes `/author/<slug>/`, and on a fresh install that slug is the **login
name of an account that can edit the site**.

Found when Edwin opened his own sitemap on 4 October.

**AND THE GENERATED THEME HAD HALF-FIXED IT FOR MONTHS WITHOUT ANYONE
NOTICING.** `functionsPhp.js` has noindexed author, date and attachment
archives since September — its own comment says *"it publishes the login name
of an account that can edit the site"*, the same conclusion reached again from
scratch today — and it never touched the sitemap. So every generated site has
been telling Google **crawl this URL** in `wp-sitemap.xml` and **do not index
this URL** on the page. Contradictory, and **`noindex` never addressed the
real problem anyway: the sitemap is a public file anyone can open and read.**

#### THE RULE, AND THE TWO THAT WERE WRONG BEFORE IT

Edwin's requirement: touch the sites this system built, never somebody's own.
Two rules were proposed and both were wrong.

- **"the first pillar claimed the home page"** — my suggestion. **TOO NARROW.**
  A pillar campaign that leaves the post archive as the front page is just as
  much a blog built from nothing, and it would have been skipped. Edwin found
  this by describing the case.
- **"a pillar campaign exists"** — Edwin's. **TOO BROAD.** Nothing stops a
  customer running a pillar campaign on a business site they already have, and
  it would then noindex category pages they rank for. Edwin found this one too,
  by asking what would happen to that customer's sitemap — after I had already
  agreed to build it.

**BOTH WERE PROXIES FOR A QUESTION THAT CAN BE ASKED DIRECTLY:**

> Is there anything published on this site that this plugin did not write?

Every post and page the publisher creates carries `_ie_campaign`, so one query
with `NOT EXISTS` and a limit of one answers it. No flag to keep in sync with
reality, no guessing, and it is right in all four cases — empty blog with a
home-page pillar, empty blog with the archive as front page, a customer's site
running a pillar campaign, and a customer's site running an ordinary silo.

**A fresh WordPress's "Hello world!" and "Sample Page" count as somebody
else's, deliberately.** Special-casing them means matching titles or ids that
differ by WordPress version and by language, and getting that wrong means
editing a stranger's sitemap. The plugin stays out until they are deleted —
the first thing anyone does setting up a blog — and the setting covers the
rest. **ERRING TOWARDS DOING NOTHING IS THE POINT:** a site that should have
been tidied and was not has an author archive in its sitemap; a site that
should not have been and was has lost pages it ranked for, and the owner has
no idea why.

#### What it does when it is on

- `users` and `taxonomies` leave `wp-sitemap.xml`
- author, category, tag, date and custom taxonomy archives get
  `noindex, follow` — **follow**, because the links on them point at real
  articles and that crawl path is worth keeping
- `/author/<slug>/` 301s to the home page. **Noindex alone leaves the URL
  answering, and the URL is the problem** — it confirms a username to anyone
  who types it whether or not Google shows the page
- categories are noindexed but **not** redirected: an owner may link one from a
  menu, and noindex keeps it out of search while leaving it usable

**THE BLOG ARCHIVE AND THE FRONT PAGE ARE NEVER TOUCHED.** On a pillar campaign
that did not claim the home page, the post index IS the front page.

#### A SETTING WITH THREE STATES, WHICH IS WHY IT IS A SELECT

`'' | 'on' | 'off'`. **A checkbox cannot say "I have not decided"** — unticked
and never-visited look identical — so the automatic rule could never tell "the
owner turned this off" from "the owner has not been here yet". An empty value
is the absence of a decision; `on` and `off` are decisions, and neither is
overruled by what the site looks like. Anything unrecognised falls back to
automatic, not to whichever branch a stray string happens to reach.

The screen also prints **what the plugin has actually decided**, not just the
preference — otherwise the owner can read the setting and still have no way to
find out what it produced on their site.

#### The theme change is separate and smaller

`functionsPhp.js` drops **`users` only**. The rule it follows: *the sitemap
must not advertise a page this theme tells Google to ignore.* The theme does
not noindex categories, so listing taxonomies is consistent. Nothing about the
theme change depends on the plugin being installed.

#### Tests and mutations

`test-pillar-plugin.php` 28 → **47**. The `get_posts` stub now honours
`meta_query` with `NOT EXISTS` and `posts_per_page` — **eighth instance of a
stub that could not express the failure it was meant to detect**: ignoring
`meta_query` would have made every site look like somebody else's, every test
would have passed, and the feature would never have run once.

`wp_safe_redirect` now **throws** in this suite, as it already does in
`test-admin-tabs.php`. Control does not come back in production either.

**19 mutations run, 17 caught.** Including: the ownership check removed and
inverted, drafts counted as published, pages dropped from the query, the wrong
meta key, the sitemap filter emptying every section, `noindex, follow` becoming
`nofollow`, the redirect firing on categories, `on` and `off` each losing to
the automatic rule, a junk setting treated as `on`, the memo never cleared, and
both theme mutations.

#### The two survivors, and the one that earns its keep anyway

`is_front_page() || is_home()` at the top of `noindex()` **guards nothing
reachable**. WordPress serves the site root as either the posts index or a
static page, so none of `is_author()`, `is_category()`, `is_tag()`,
`is_date()` or `is_tax()` can be true there — the archive list alone already
declines. Deleting the guard changes no behaviour and survives, correctly.

**It stays, and this was measured rather than argued.** The tempting future
edit is to add `is_home()` to the archive list — *"the blog archive is a thin
archive too"* — and on a blog whose archive is the front page that one line is
the worst bug this plugin could ship. Run that edit **with** the guard: 47
pass. Run it **without**: `THE FRONT PAGE IS NEVER NOINDEXED` fails. The guard
turns a fatal edit into a harmless one, and the test proves it.

Second survivor, same shape: the comment above it now says it guards nothing
reachable, rather than implying a defence it does not provide. **Second time
today** — the slug fix had the identical pattern with `lastDash > 0`.

### The title tag and the meta description on any theme — 4 October, plugin 0.19.0, SHIPPED

**The 30 September note below already contained the gap, and nobody read it as
one.** It says the title is written to `<prefix>_page_title` so the generated
theme's filter can find it — which is true, and which also says in passing that
on any other theme nothing finds it at all. It was a fact about the fix, not
written down as a defect, so it sat there for four days. Edwin found it from
live HTML on a Kadence site:

    a post   <title>What Information Do You Need … — hilltophomeloans.net</title>
    the home <title>hilltophomeloans.net</title>
    neither  no <meta name="description"> at all

**IE_Publisher had always WRITTEN the SEO meta. Nothing in the plugin ever PUT
IT ON THE PAGE.** The generated themes do that themselves — they filter
`pre_get_document_title` and print the description in their own `wp_head` — so
on a generated site everything worked and the gap was invisible. Everywhere
else the meta sat in the database, unread, while WordPress's default took over.

New file: `includes/class-ie-seo.php`.

- `pre_get_document_title` at priority 20, returning `_ie_meta_title`
  **verbatim with no site-name suffix.** That is the point: the suffix is
  already shown under the search result and here it eats characters off a
  headline written to fit.
- `wp_head` at priority 1 printing `<meta name="description">` from
  `_ie_meta_description`.
- **Every entry point checks `_ie_campaign` first.** A customer's own pages,
  posts, archives and home page are left exactly as their theme renders them.
- **`get_queried_object_id()`, not `get_the_ID()`.** On a static front page
  `in_the_loop` has not started when `pre_get_document_title` runs, so
  `get_the_ID()` answers false — and the front page was the worse of the two
  bugs, since WordPress titles it with the SITE NAME and the article's own
  headline appeared nowhere.
- **Empty means leave it alone.** Returning `''` would give a blank `<title>`
  rather than WordPress's imperfect-but-present default. **An empty value is a
  claim that the value exists.**
- **It cannot fight a generated theme.** That theme's filter reads the same
  meta key and returns the same string, so whichever runs last the answer is
  identical. No detection, no priority war.
- **It stands down for Yoast, Rank Math, SEOPress and AIOSEO** — checked by
  CONSTANT (`WPSEO_VERSION` and friends), not by plugin file path. A renamed
  folder, a premium build or a must-use install moves the path; the constant
  does not. And `defined()` is only true once that plugin has loaded, which is
  the question being asked.

`IE_Publisher` also now writes `_yoast_wpseo_title` / `rank_math_title` and
`_yoast_wpseo_metadesc` / `rank_math_description` beside the existing keys, so
standing down does not mean discarding the hand-written title — it arrives
through the other plugin, in the field the owner can edit. **Four unread rows
when nobody has those plugins, which beats detecting at publish time, because
the owner may install one next week and the posts are already written.**

**RETROACTIVE, and that is worth knowing before anyone offers to re-publish
anything.** The filters read the meta at page-render time, and those rows
already exist on every post ever published. Upload the ZIP and the live pages
change. No re-publishing, no credits.

`test-pillar-plugin.php` 20 → 28, with `ie_render_title()` / `ie_render_head()`
helpers and stubs for `is_singular()` / `get_queried_object_id()`. **8 of 8
mutations caught**, including dropping the ownership check, firing on archives,
reading `get_the_ID()` instead of the queried object, and the publisher no
longer writing the Yoast key.

### A slug cut mid-word, and a mutation harness that lied — 4 October, server

**Found by reading a live pillar post, which is the thing this file has been
saying should happen since 2 October.** Edwin pasted the body of the home page
and the one link in it pointed at:

    /what-information-do-you-need-for-a-loan-application-a-complete-prepara/

"preparation" became "prepara". `slugify()` in `planCampaign.js` ended with
`.slice(0, 70)` — a hard character cut, no word boundary. That slug is
**exactly 70 characters**, so it was that line and nothing else.

Now: under the limit, returned untouched; over it, cut at 70 and backed up to
the last dash. **Future campaigns only** — a published URL is read back from
WordPress, never rebuilt from the plan, so nothing existing moves and no
redirects are needed.

**`planCampaign.slugify` HAD NO TEST OF ANY KIND.** The two `slugify` hits in
the suite belong to `utils/slugify.js`, a different function with a different
body. `test-blog-plan.js` 25 → **30**, and four of the five new tests cover
behaviour the docblock had been *describing* since September — the apostrophe
rule included, which is the fault the comment was written to stop and which
nothing had ever checked.

#### A HARNESS THAT MISREPORTS IS WORSE THAN NO HARNESS

The first mutation run printed **"all 8 caught"**, with the identical count
`10 passed, 20 failed` for every one of them. A change of `70` to `71` cannot
fail twenty tests. Re-run with the output captured properly: **three
survived.**

This is the third harness fault in this project's mutation testing — a shell
quoting error, a `replace(…,1)` that landed 2,100 lines away, and now a
reporting bug — but it is the first that produced a **FALSE ALL-CAUGHT**, and
that is the dangerous direction. A false SURVIVED sends you looking for a gap
that is not there and you find nothing. **A false ALL-CAUGHT closes the
question.** The rule already in this file — assert the anchor matches exactly
once — does not cover this: the anchors were fine and the mutations applied.
What was wrong was the reading of the result.

**So: an identical failure count across unrelated mutations is itself the
signal.** Different changes to different lines do not break the same number of
tests.

#### THE REAL GAP THE HONEST RUN FOUND

`lastIndexOf('-')` → `indexOf('-')` **survived.** It cuts at the FIRST dash, so
the whole slug becomes `what`. And `what` is under 70 characters, ends in no
separator, is not `prepara`, and is a whole word from the title — it satisfied
every assertion in the test.

**A RULE THAT ONLY FORBIDS CUTTING BADLY IS HAPPY WITH CUTTING ALMOST
EVERYTHING.** The missing property was maximality, and it is now asserted
directly: put the next word back and the result must exceed 70.

#### Two mutants that survive on purpose

- `return clean` → `return clean.slice(0, SLUG_MAX)` inside the
  under-the-limit branch. Slicing a string shorter than 70 to 70 returns the
  same string. A no-op, and my own mutation was badly chosen — it was meant to
  restore the old behaviour and instead restated the new one. The real
  pre-fix code *is* caught: replacing the whole body with
  `return clean.slice(0, SLUG_MAX)` fails the word-boundary test.
- `lastDash > 0` → `lastDash >= 0`. Position 0 cannot hold a dash, because
  leading separators are stripped four lines above. **The guard protects
  nothing reachable**, and the comment now says so rather than claiming a
  defence it does not provide — otherwise the next reader writes a test for a
  case that cannot happen. It stays because it costs nothing and would become
  the silent failure if the leading-dash strip were ever removed.

**6 of 8 caught, plus the true pre-fix mutation. 2 equivalent mutants, both
written down.**

### A missing description was never retried — 4 October, server

**Found by reading `REWRITE_WORTHY` to answer a question of Edwin's about an
empty site. Not by a test, and the test that existed went green over it.**

`checkPost` raises `no-meta` when a post comes back with no meta description
and `no-title` when it has no headline. **Neither was in `REWRITE_WORTHY`**, so
neither triggered a re-write: the post broke out of the loop, shipped with the
failure logged, and went live with no `<meta name="description">` at all.

Nothing had decided that. The set was written around the link and length
faults and these two were never weighed. They belong by the rule the set's own
comment states — `title` and `metaDescription` are both named in the JSON shape
the prompt demands, so a post missing one is **the model dropping a key**, which
is exactly "a different roll of the dice away from being right". That is not
the same as `guide-title` or `howto-title`, which stay out: those are the model
answering the question badly and it will answer the same way again.

**Invisible until 0.19.0, and then indistinguishable from the bug 0.19.0
fixes.** Before that release nothing put descriptions on the page, so a post
without one looked like every other post. Afterwards it looks exactly like the
Kadence symptom Edwin photographed.

#### THE RULE MOVED TO `qualityCheck.js`, AND THE MOVE IS THE FIX

`REWRITE_WORTHY` and `worthRewriting()` lived in `blogGenerator.js`, two files
from the `fail()` calls that raise the codes they name. **A code renamed in one
file and not the other leaves a set member that can never match, and nothing
fails when it happens** — the post just ships unretried, which is the state
this change exists to end. They are now defined beside the codes.

**And the rule could not be unit tested where it was.** `blogGenerator.js`
requires `models/User.js`, which requires Mongoose, so a test cannot load it.
`qualityCheck.js` requires nothing at all.

#### FOURTH TIME A CHECK IN THIS PROJECT HAS READ PROSE AS CODE

The only test on the retry rule was:

    assert.ok(generator.includes(`'${code}'`))                 // retried
    assert.ok(!generator.includes(`'${code}'`))                // not retried

A whole-file text search that **cannot tell a member of the set from a word in
a comment.** Two consequences, and both happened:

- **It passed over this gap.** `'no-meta'` was absent from the file in exactly
  the way the test wanted every excluded code to be absent. Nothing in the
  check distinguished *deliberately excluded* from *never considered*.
- **It was one edit from going red for no reason.** The comment now names
  `'guide-title'` as an example of an exclusion — which the negative assertion
  would have read as the code being in the set.

`worthRewriting` is exported now and the tests call it. `test-post-quality.js`
14 → **19**.

#### THE MUTATION THAT SURVIVED EVERYTHING ELSE

Replacing `!worthRewriting(quality)` with `false` in the loop's break
condition **turns the retry off completely** — and eighteen of the nineteen
tests still passed. Every one of them asked what the rule *answers*; not one
asked whether anything *calls* it. **A CONDITION CAN BE WRITTEN CORRECTLY AND
REACHED NEVER** — which this very file's note on the `blogGenerator` exports
already said, about a different function.

The nineteenth test asserts, against comment-stripped source, that
`worthRewriting(` appears **after** `for (let attempt = 1` and that a `break`
follows it. Three further mutations — deleting the call, calling it and
discarding the result, and breaking the loop header — are all caught.

**12 mutations run, 12 caught.** Including: dropping either code, misspelling
`no-meta` as `no_meta`, deciding on failure text instead of codes, returning a
constant, demoting the missing-description failure to a warning, and adding
`guide-title` to the retried set.

Deployed 4 October. **Server only — no plugin change.**

#### Open — the two SEO plugins with no keys written

**SEOPress and AIOSEO are a hole, found while answering a question of Edwin's
on 4 October rather than by a test.** `IE_SEO` stands down for both, and the
publisher writes **no keys** for either — so on a site running one of them the
title and description sit in `_ie_meta_*`, nothing renders them, and that
plugin falls back to "Post Title — Site Name" with no description. **That is
the exact bug this release fixed for Kadence, surviving on those two plugins.**

- SEOPress looks like two more post-meta keys beside the Yoast ones.
- **AIOSEO needs checking before anything is written.** I believe version 4
  moved its data out of post meta into its own database table, which would
  make `update_post_meta` unable to reach it — but that is recalled, not read,
  and nothing should be built on it until it is verified.

Edwin's answer when this was raised: not yet — see the note below on target
pages, which he asked to defer in the same breath.

#### A target page chosen by pasting its URL — plugin 0.22.0, INSTALLED

Asked for and deferred earlier the same day; built that evening when Edwin
came back to it, and uploaded the same night.

**INSTALLED BUT NOT YET EXERCISED.** The ZIP is up; nobody has pasted a URL
into the box on a real site. Everything below is covered by tests and by
nothing else. The cheapest confirmation is one campaign form: paste the URL of
a published post that is NOT in the dropdown and check it is accepted, then
paste a deliberate typo and check it is refused with a message rather than
quietly planning against whatever the dropdown held.

**THE LIMITATION.** `IE_Settings::target_pages()` offers every published PAGE
plus every published post carrying `_ie_is_pillar`, and only this plugin ever
stamps that. An owner whose hub is a post they wrote by hand has nothing to
select, and the campaign cannot be aimed at the one page on the site that
matters.

**RESOLVED TO A POST ID, NOT STORED AS TEXT — and that is the whole design.**
The sketch in the deferred note had the typed string stored as
`targetPage.url` with the owner asked for a keyword and a title beside it:
three new fields, a second shape for everything downstream, and no way to
notice a typo. `url_to_postid()` asks the question properly. What comes back
is an ordinary post id, so the title and keyword come from the post itself and
**nothing downstream learns there was a second way in.**

It also refuses, for free, everything the deferred note worried about:

- another site's URL — resolves to nothing, so there is no home-URL
  comparison to write and none to get wrong
- a mistyped slug — resolves to nothing
- an archive, a category, a search page — not permalinks

Plus two refusals of its own: **not a post or page** (url_to_postid resolves
attachments and custom types too) and **not published** — the same rule
`target_pages()` follows, because a draft's URL 404s to the public and a silo
aimed at one spends a quarter linking to nothing.

The front page is special-cased: `url_to_postid()` answers 0 for the site root
because the root is a setting rather than a permalink, and on a blog built by
this plugin the front page is a pillar — the likeliest thing anyone pastes.

**Two things that only show up on the second step, both fixed before shipping:**

- The rejected URL travels back with the error. Without it the box is empty on
  the page telling the owner their URL was wrong — they are asked to fix
  something they can no longer see. The draft transient cannot help: it is
  written only once the form has been accepted, which is exactly what did not
  happen.
- The resolved URL is kept in the stored form. **A URL-chosen page is by
  definition not in the dropdown**, so after "Review topics" nothing would be
  selected and the box would be empty — and the next submit would fall through
  to the dropdown, find nothing, and refuse a campaign already set up
  correctly. The feature would have broken on its second step, not its first.

##### THE MUTATION THAT FOUND A SILENT WRONG TARGET

Removing the early return after a failed resolve **survived**. Every test had
posted a bad URL with no dropdown value, so the fall-through still ended in
null and they all passed.

The gap only shows when both are present — **which is the ordinary case,
because the dropdown always posts whatever it is showing.** A mistyped URL
would then stop being an error: the code falls through, finds the dropdown's
page, and plans a whole campaign aimed somewhere the owner did not choose. No
message, no sign, and nothing re-checks a link after it is written.

A second survivor, the post-type check, was untestable because the stub only
modelled posts and pages. **8 mutations, 6 caught, both survivors turned into
tests and now caught.**

`test-admin-tabs.php` 82 → **93**.

##### Two harness notes worth keeping

- **`has()` takes its arguments the other way round in `test-admin-tabs.php`**
  — `has( $haystack, $needle )` there, `has( $needle, $haystack )` in
  `test-pillar-plugin.php`. Three tests were written the wrong way first.
- The `url_to_postid` stub answers 0 for anything that is not a permalink on
  the fixture site, deliberately. A stub that resolved anything with a number
  in it would make the off-site refusal untestable and leave the suite green
  on a feature that accepted other people's URLs.

### Publish all — 3 October, plugin 0.17.0, shipped

`handle_publish_all` loops the campaign's `scheduled` slots calling
`IE_Publisher::publish_now`. The guess in the note this replaces was right: it
was a loop and a confirm, not a new mechanism.

**PILLAR CAMPAIGNS ONLY — Edwin's call, and the reason is worth keeping.** On a
silo campaign the schedule IS the product: twelve posts over three months is
what the customer planned and paid for, and dating them all today cannot be
undone, because **a post does not go back onto a schedule**. A pillar campaign
has no plan to destroy — every post in it is meant to be live at once, which is
the only reason the button is wanted.

The refusal is in the HANDLER as well as in the hidden link. That URL is
reachable by hand and from a stale browser tab, and what it does is
irreversible. A mutation removing the handler-side check is caught.

The count is computed before the control is drawn, so a campaign with nothing
waiting never offers the button, and the label says "Publish all 4 pillars
now". A deleted post is **skipped and said out loud** — the slot keeps its id,
`wp_update_post()` answers 0 rather than a WP_Error, and without the check the
owner is told five went live when two do not exist.

**THE FIRST HANDLER THIS PROJECT HAS EVER INVOKED FROM A TEST.**
`IE_Admin::redirect()` ends in `exit`, so calling one would have ended the run
at the first redirect and reported everything before it as the result. The
`wp_safe_redirect` stub now THROWS: control does not come back in production
either, so throwing is the faithful shape, and a stub that merely recorded the
URL would let the test exercise code past an `exit` that production can never
reach. `ie_run_handler()` catches it and returns the parsed query arguments.

**A shared process is not a shared request.** `IE_Campaigns::post_missing()`
caches live post ids in a static — correct in WordPress, where one request is
one page load, and wrong across tests, which share a process. A test reported
one post skipped against a fixture where every post existed, because an earlier
test had filled the cache. `forget_post_cache()` already existed for this and
nothing was calling it; the tests now go through `ie_posts_exist()`.

### A mutation that never applied is not a result — second instance

`str.replace(old, new, 1)` takes the FIRST match. A mutation aimed at
`handle_publish_all`'s `post_missing()` check landed on an identical line 2,100
lines earlier and reported SURVIVED for a change that was never made to the
code under test. Yesterday the same false SURVIVED came from a shell quoting
error. **The mutation script now asserts the anchor matches exactly once**, and
promptly refused a later anchor on those grounds.

**The accident found a real gap, in code that predates all of this.** The line
it hit by mistake was `campaign_headline()`'s deleted-post counter — and the
whole suite passed with it short-circuited. A campaign with three deleted posts
would have read *"3 of 3 scheduled, 3 live, publishing on schedule"*. The
existing deleted-post tests check the ROW and the per-row link; none checked the
summary, which is the line people read first and the one a customer would quote
back when disputing a bill. Now covered, and the mutation is caught.
`test-admin-tabs.php` 71 → 81.

## Outstanding

**Cleared on 29 September** — the blog report headline, filtering the blog
report, fifty campaigns in the plugin, longer posts with spread-out links, and
`test-admin-tabs.php` (52 passing, in `deploy.sh`). All five are written up in
the 29 September entries below; do not re-add them here.

**Cleared on 30 September** — **#27 DMARC**. `_dmarc.threecomets.com` now
reads `v=DMARC1; p=none; rua=mailto:hello@threecomets.com`, added at the DNS
host by Edwin. It had been `p=none` with no `rua=`: a valid record that told
receivers to do nothing and sent the reports nowhere, so it monitored into a
void. With `rua=` the providers send daily aggregate XML — who is sending as
the domain, and whether SPF and DKIM pass — which is both the early warning
for spoofing and the prerequisite for ever moving to `p=quarantine` safely.
Confirm with `dig +short TXT _dmarc.threecomets.com`.

**Still open**

*~~Resend's DKIM~~ — **closed, 30 September. It is there and Verified.**

    TXT   resend._domainkey   p=MIGfMA0GCSqG…l7BMC1wIDAQAB   Verified

SPF is two CNAMEs, `rsend` and `send`, both pointing at `forge.rmta.net`, both
verified. Sending is on; receiving is off.

**THE OLD NOTE SAID NXDOMAIN AT `resend._domainkey`, AND THAT IS THE RIGHT
NAME.** So the earlier finding was not a wrong lookup — it was a lookup run
too early. Resend's own timeline: domain added **23 Sep 21:59**, DNS verified
**24 Sep 00:37**. The check fell in that window, or just before propagation.

Two things were got wrong here, and the second is the instructive one:

1. A negative DNS answer was written down as a defect. **NXDOMAIN is a
   snapshot, not a verdict** — records get added minutes later, and nothing
   goes back to re-check a note.
2. When the dashboard showed Verified, the first explanation offered was
   "the selector name must have been a guess" — a tidy story that fitted the
   new evidence and was **contradicted by the old note, which named the
   selector correctly all along.** Reading the original note would have cost
   nothing. **A neat explanation that requires not re-reading your own
   evidence is a guess wearing a better suit.**

**Next up — Edwin asked for these on 29 September, for the following day**

*Show him a worked example of mutation testing.* He asked for this last thing
before bed, about the check described in "A flat numbered list" below: break
the code on purpose, watch the test fail, put it back. Walk it through on one
small concrete case he can follow end to end — the by_money_page URL-vs-title
swap is the natural one, since it is his own screen and the diff is two words.
The point to land: a test that stays green when you break the thing it tests
is not a test, and running it once against a deliberate break is the only way
to know which kind you have.


*Watch one new campaign reach `active`.* **The generator fix has never been
observed doing the thing it fixes.**

The 29 September fix made `blogGenerator.js` re-read the campaign before
deciding its status, so a campaign that wrote posts ends at `active` instead
of being reset to `draft`. It was confirmed by the report reading
"2 campaigns · 12 posts · 12 confirmed live", both **Completed** — but that
came from `settleFinished()` promoting them at the end. **No campaign has
ever been seen sitting at `active`.**

Every campaign in the 30 September export still reads `campaign_status:
draft`, including campaign 8, which is live and publishing. That one was
created 09-28, a day before the fix deployed, so it is expected — and it
cannot self-correct, because `applyReportedStatuses()` treats `draft` as
PROTECTED and refuses to let a site overwrite it (the guard that stops a site
clobbering a campaign mid-write). It will go straight to `completed` when its
last post publishes.

So: plan one small campaign — two posts is enough — and check the CSV's
`campaign_status`. **`active` means the fix works. `draft` means it does
not**, and the evidence gathered so far cannot tell the two apart.

**Raised 29 September, not yet ruled on by Edwin**

*~~"TK Water Damage Restoration" as a branded anchor~~ — **closed, not a
bug.** The branded bucket is built from `business.name`, which the SITE sends
(`IE_Settings::business()` → `<theme>_global_settings.business_name`, falling
back to the site title), read at PLAN time and baked into `slot.moneyAnchor`.
emergencyplumberaustin.net was TK Water Damage Restoration when those four
campaigns were planned and is "Emergency Plumber Austin" now — its money-page
list no longer even contains Water Cleanup or Mold Mitigation. The anchors
were true when they were written.

**Followed up 30 September, and the real fault was one layer down** — see
"The business nobody ever updated" below. Frozen-at-plan-time was the third
link in a chain whose first two nobody had looked at.

**Keyword volumes in the wizard — next up, 23 September**

Edwin's idea: before the form, the customer enters a city and a business
category and sees real search volumes and CPCs, so the service pages they
choose are the ones people actually search for. Today he does this by hand in
Google Keyword Planner with an ad campaign running, which is why his numbers
are exact rather than bucketed.

*The gate.* `KeywordPlanIdeaService` is **Restricted Functionality** in the
Google Ads API. **Basic access cannot call it.** It needs **Standard access**
with "Researching keywords and recommendations" as the approved permissible
use — a manual audit, about 10 business days, and because external users would
use the tool they will ask for a demo sign-in. A running ad campaign grants
none of this; the developer token needs a manager (MCC) account.

*The way round it.* DataForSEO's **Keywords Data → Google Ads** endpoints
(`search_volume`, "Keywords for Keywords") are a passthrough — their own help
centre says the source is Google Ads, i.e. the same Keyword Planner data. They
hold the token and the Standard access. $0.06 standard queue / $0.09 live per
task, up to 1,000 keywords per task. Two lookups per customer is 18 cents
against a site selling for 200+ credits.

**Their Labs endpoints are a different product** — "DataForSEO's own keyword
database", their estimates, cheaper and not Google's numbers. When anyone says
DataForSEO is less accurate than the Planner, this is almost always what they
are comparing. Do not use Labs for this feature.

*The open question — **ANSWERED, 23 September. DataForSEO returns Google's
numbers unchanged.*** It calls Google with THEIR accounts, not Edwin's, so
whether the precision survived was an empirical question no documentation
answered. Two runs of `tools/keyword-compare.js` against Edwin's own Keyword
Planner exports settled it:

| town | comparable | exact | above the floor | bids to the cent |
|---|---|---|---|---|
| Cedar Park, TX | 780 | **780** | 6 of 6 | 10 of 10 |
| Austin, TX | 993 | **993** | 63 of 63 | 111 of 111 |

Not one disagreement in 1,773 keywords, at volumes from 10 to 2,900 a month,
with every top-of-page bid matching to the cent. No bucketing: 0 of 27 answers
over 100 landed on a round bucket value. **Build the feature on DataForSEO**,
and apply for Google Standard access in parallel so a paid feature is not one
vendor outage from dead.

*The trap that cost an evening: the export does not carry its own location.*
A Cedar Park CSV was first compared against Leander. Every head term
disagreed, every bid disagreed, and both sides were right about different
towns — it looked exactly like a data-quality problem and was not. The
comparison tool's verdict now names the location as the first suspect. For the
feature itself this cannot happen, because the customer picks the location and
it is an input rather than a thing to remember.

*First task, before any code — **written, 22 September**: `tools/keyword-compare.js`.*
It reads a Keyword Planner CSV export, sends the same keywords to DataForSEO's
`keywords_data/google_ads/search_volume/live` at the same location and date
range, and prints the two columns with the delta and a verdict. One task, nine
cents, up to 1000 keywords.

    node tools/keyword-compare.js planner.csv --location "Leander,Texas,United States"
    node tools/keyword-compare.js planner.csv --dry-run    # spends nothing
    node tools/keyword-compare.js --self-test              # 10 parser tests

`DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` come from the environment and are
never written to a file in this repo. `tools/` is in `.rsync-exclude`: it is a
bench tool, not part of the app, and has no business on the server. Its tests
are inline behind `--self-test` for the same reason — `deploy.sh`'s suite list
is for the app.

**Google's export is UTF-16 LE, tab-separated, with a title line above the
header.** A spreadsheet hides all three, so a parser written from what the
spreadsheet shows fails on the real file. That is handled; do not "simplify" it.

*Design notes from the discussion, so they are not re-derived:*

- **The reporting floor is the real design constraint, and it is worse than it
  looks.** Measured, not guessed: **774 of 780** keywords in Cedar Park and
  **930 of 993** in *Austin* sit at or under 40 searches a month. Even a city
  of a million leaves only 63 keywords with usable signal. Below the floor
  Google rounds to tens, so a 10 and a 0 say the same thing — nothing. A
  pre-wizard screen that prints those numbers tells a contractor his site is
  pointless. Query the METRO for ordering and show the city number beside it —
  "Water heater repair — 390/mo in Austin, 10 in Cedar Park" — and widen
  automatically, saying so, when a city comes back empty.
- **~~Filter the brand names.~~ TRIED, MEASURED, DELETED — see the brand
  filter section below.** The observation was real: a third of Austin's
  above-floor keywords are competitors — goettl, fergusons, roto rooter,
  reliance, rogers, wilson's, pecks, crows — and nobody wants a page called
  "Goettl Plumbing". What was wrong was the conclusion that a filter could
  tell them from materials. Three rewrites later the measurement said 92% of
  what it removed was removed by the buyer-intent pass anyway, and the other
  8% was real work. The generic terms it was meant to protect — plumber 2,900
  · water heater replacement 390 · plumbing repair 210 — survive without it.
- **Two placements, one module.** A standalone keyword screen is what Edwin
  asked for, but the higher-value placement is inside step 6: put the volume
  next to each suggested service and sort by it. The customer then does no
  keyword research at all — they read the list already in front of them, in the
  order that matters. Build `utils/keywordVolumes.js` once and wire both.
- **Apply for Google Standard access regardless**, not only as a fallback. A
  paid feature should not sit one vendor outage from dead. DataForSEO is what
  it ships on; Google's API is what it moves to.

*What it costs, and what it charges — **decided 23 September**.*

A lookup costs **$0.09** per task, live mode, up to 1,000 keywords. The
metro-plus-city design is two tasks, so **$0.18** a lookup — about 20 credits
at what credits sell for ($0.010 / $0.009 / $0.008 by pack).

**Free inside the wizard. Charged on the standalone research screen.**

The wizard placement is free for the same reason `/api/suggest-services` is,
and the comment there says it: *someone deciding how big a site to buy should
not be charged to find out*. This one is stronger still — it is what convinces
a customer to buy MORE service pages, at 100 credits each. One extra page is
$0.80–1.00 against an $0.18 lookup, so the feature pays for itself if one
customer in four adds a single page. Putting a toll in front of that taxes the
upsell, and makes the customer hesitate exactly where he should not.

The standalone screen is where someone could use it as a free keyword tool
without ever building a site, so that one charges — **25 credits**, which
covers the cost without reading as a tollbooth next to 100 credits a page.

*Three things do the work that charging would not:*

- **The cache, which is the real lever.** Key is *(keyword set, location,
  month)* and its cardinality is low by nature: the inputs are a trade and a
  town, not a person. Every plumber in Austin gets one answer. Volumes move
  monthly at most, so a 30-day TTL is honest rather than stale. Follow
  `models/PaaCache.js` — same problem, same shape, Mongo TTL index, no cron.
- **A rate limit**, like `suggestServicesLimiter` (15/hour, keyed by user).
  Cache hits must NOT count against it. Worst case uncached is $2.70 per user
  per hour; with the cache it will not come near.
- **Log the cost per call**, the way `services.suggested` logs tokens, so "what
  is this costing me?" has a number in a month rather than a guess.

*Built 23 September:* `models/KeywordCache.js`, `utils/keywordVolumes.js`,
`routes/keywordVolumesRoute.js` (`POST /api/keyword-volumes`, behind
`requireAuth`), `keywordVolumesLimiter` in `middleware/rateLimits.js`, and
`test-keyword-volumes.js` — 55 tests, every one of them mutation-checked.

**The limiter is deliberately BEHIND a cache peek**, in `spendOnlyOnMisses`.
A limiter runs before the handler, so by the time `volumesForArea` could
report `cached: true` the slot is already spent. The gate peeks both towns
first and, on a full hit, calls `next()` without the limiter seeing the
request. A peek that THROWS falls through to the limiter, not past it: a slot
spent on a call that might have been free is recoverable, a free-for-all while
Mongo is down is not.

**Server needs two env vars** — Edwin sets them himself, like the Stripe keys:
`DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD`, from `app.dataforseo.com/api-access`.
`KEYWORD_VOLUMES_RATE_LIMIT` (default 15/hour) and
`KEYWORD_VOLUMES_TIMEOUT_MS` (default 30s) are optional.

**Towns are spelled Google's way or not at all.** DataForSEO matches
`location_name` against Google's own geo targets, where the state is written
out: `Cedar Park,Texas,United States`. `Cedar Park,TX,United States` matches
nothing and comes back an error, so `toLocationName` converts the wizard's
"City, ST" and REFUSES rather than guessing when it cannot — guessing would
spend $0.09 to be told no.

*Built 23 September — the standalone page, NOT the wizard.*

Edwin's call, and the right one: `/keyword-research`, reached from a tools
column on the left of `/`. Three inputs — **City, ST · Industry · Minimum
searches** — and a table of the top 20 terms: **term · searches/month · CPC**.

- `utils/appHeader.js` gained `appSidebar()` / `appSidebarAssets()`. It lives
  beside the header for the header's own reason: **a nav in two files is a nav
  where one copy falls behind.** It fills the empty column next to the wizard
  card and stacks above the content under 992px.
- `routes/keywordResearchRoute.js` — the page and `POST /api/keyword-ideas`.
- `utils/keywordVolumes.js` gained `keywordIdeasFor()` against
  `keywords_for_keywords`. **A different endpoint from the volumes one:**
  search_volume answers "how often is this searched" and needs a list;
  this answers "what else do people search around this" and needs a seed.
  The research page's customer has a trade and a town, never a list.
- `test-keyword-research.js` — 30 tests, mutation-checked.

**The cache key is NAMESPACED (`kind: 'volumes' | 'ideas'`).** "plumbing" as a
volume lookup and "plumbing" as an ideas lookup are different questions with
the same words, same town, same month — without the namespace they shared an
entry and served each other's answers. There are two tests: one that `cacheKey`
*can* tell them apart, and one that `keywordIdeasFor` actually asks it to.
Mutation testing showed the first passed with the bug in place.

**The WHOLE set is cached, the minimum filters after.** Caching the filtered
twenty would charge $0.09 again every time somebody lowered the minimum on
keywords already bought.

**An empty table means three different things** — the minimum is too high, the
town has nothing, the lookup failed — and they are indistinguishable to look
at. So the endpoint returns `total` and `aboveMinimum` alongside the rows, and
the page says which one happened. Most of `public/js/keywordResearch.js` is
that distinction.

**THE BRAND FILTER IS GONE FROM THE RESEARCH PAGE, DELETED 23 SEPTEMBER.**
Do not add it back. It was rewritten three times and measured four, and the
measurements are the reason it went:

| what was measured | on Austin "deck builder" |
|---|---|
| rows it hid | 2,474 of 4,671 — 53% |
| of those, rows the intent pass would have removed anyway | 2,277 — 92% |
| rows it uniquely removed | 197 |
| competitor names in a 25-row sample of those 197 | **0** |

That 197 held `deck installer austin`, `fix rotted wood deck`, `replacing
porch decking`, `screened in porch renovation` — and three queries about
lawnmower decks. Its entire contribution was deleting the best keywords on the
customer's list.

**The rule cannot work, and that is measured too, not argued.** It asked "once
the trade's words and the town are gone, is a leftover word rare?" — a surname
and a material are both a word next to a trade. The corpus-frequency version
was instrumented to print each blamed word's count, and brands ran 1→40
mentions against real describing words 1→44, interleaved the whole way:

    screen porch extension   [extension×2]    real service
    deckscapes stain         [deckscapes×2]   real brand
    floating deck builders   [floating×7]     real service
    sikkens deck stain       [sikkens×15]     real brand, COMMONER

No threshold exists between them. Tuning the number could not have helped.

**Why deleting it is safe:** a brand query is a PRODUCT query — "benjamin
moore deck stain" carries no action word, no hire word, no town, and a bid a
fraction of the real terms'. The buyer-intent pass takes it on its own
evidence, which is what "92% duplicated" means.

**What still calls `looksLikeBrand`:** `volumesForArea`, where the keywords
are a list somebody already chose and the answer is a FLAG on the row rather
than the row being hidden. A wrong flag on a list of twenty is visible and
harmless; a wrong hide in a list of thousands is neither. Its `SERVICE_WORDS`
fixture nouns — the "toilet plumber" fix — still earn their place there.

**The corpus-frequency machinery went with it:** `vocabularyFloor`,
`wordCounts`, and the diagnostics `brandsHidden`, `brandSample`,
`answeredCount`, `brandsIntentWouldKeep`. The log line is back to
`removedByWords`, `removedByPrice`, `collapsed`.

**"Show everything" is gone too, 23 September.** The checkbox turned the
buyer-intent filter off. Edwin asked what it was for and there was no answer:
unticked, a customer got a baseball keyword, ten spellings of "tankless water
heater" and a page of people reading rather than hiring. The route no longer
reads `req.body.showAll` either — an option removed from the page but still
live in the body is worse than one never removed, because nothing on screen
offers it and nothing exercises it.

**UNPRICED ROWS ARE CLUSTERED NOW, and that was a small-town bug.**
`collapseClusters` began `if (row.cpc == null) { out.push(row); continue; }` —
no price, no de-duplication — because volume alone is a weak key. What that
missed is that in a small town almost NOTHING has a price. Leander, Texas,
"plumbing": ten of the thirty rows shown were one keyword —

    garbage disposal repair · fix garbage disposal · sink disposal repair
    garburator repair · sink disposal fix · dish disposal repair
    fix garburator · fix waste disposal · garbage disposal unit repair
    repair waste disposal unit

all 40 a month, all unpriced. The only two rows on that table that DID
collapse were the only two with a CPC. So the de-duplicator was switched off
in exactly the towns that need it.

Unpriced rows now bucket on volume and cluster under a **stricter** rule than
priced ones, in two ways:

- **Only naming words count.** `distinctiveWords()` strikes out the verbs and
  modifiers — repair, fix, near me, emergency, cost — which half the answer
  carries and which therefore prove nothing. Fixture nouns STAY IN: "disposal"
  and "heater" are exactly what identify a keyword.
- **Intersection, not union.** Every member shares a word with every member.
  Union is what makes a priced cluster work — identical CPC to the cent is
  nearly the whole argument — and without a price it would chain
  sink-faucet → faucet-cartridge → cartridge-valve into one row.

**A word in more than a fifth of the answer cannot be the evidence**
(`GENERIC_SHARE`). "water" is in the heater rows, the softener rows, the line
rows and the pressure rows; matching on it merged a softener with a heater —
two appliances, two pages, one row. This is a judgement, and this file has
been wrong about numbers like it: what makes it safer than the brand threshold
that failed is that frequency genuinely answers "is this word everywhere",
and being wrong only groups rows that were already identical in volume, with
"+N wordings" showing it on the page rather than hiding it.

The question is about the WHOLE answer, so it is switched off when
`collapseClusters` is not given a corpus larger than the rows themselves —
counted against ten rows, "disposal" is in eight and looks ubiquitous.

Result on Leander: ten rows became `garbage disposal repair +7 wordings` and
`garburator repair +1 wording`, with eight real keywords in the space.

**"Google never returns a town in the term" is TOO STRONG, and I said it
several times.** Cedar Park and Austin supported it; Leander did not —
`leander plumbing` came back at 320/month from category mode. Rare, not
impossible. Pairs mode is still worth having because you cannot rely on it.

**`practitionerForms` assumed every trade is named after the WORK, and half
are named after the WORKER.** `plumbing → plumber` was the model, so
"deck builder" came back as **"deck builderer"**, "plumber" as "plumberer" and
"lemon law attorney" as "lemon law attorneyer" — while the form Edwin actually
asked about, `deck builders austin`, was never asked about at all. Plumbing,
roofing and landscaping hid it for weeks: all three are named after the work,
so the rule happened to be right for every trade it was written against.

It now branches on the shape of the word — `-ing` strips and makes the person;
an agent ending (`er, or, ist, ian, eer, man, smith, wright, ney`) takes the
word and its plural; an already-plural word takes its singular and itself;
anything else keeps the old `-er` guess. The singular comes first because
`pairsFor` qualifies `forms[0]`.

`practitionerForms('lemon law')` still returns `['lemon lawer', 'lemon
lawers']` and a test still asserts it. That is the module's standing
argument — DO NOT GUESS WHICH FORM IS RIGHT, ASK ABOUT BOTH AND LET GOOGLE
ANSWER — and a wrong form costs one slot in a task with a thousand and shows
as a dash. `physical therapyer` and `hvacer` are live for the same reason.

**`metroFor()` in `utils/nearbyPlaces.js`** finds the city whose volumes
describe a town's market — largest place within 75 miles clearing 250,000. **A
town big enough is its own metro, and that check must come first:** without it
"largest place within reach" sent AUSTIN to San Antonio, 74 miles away. It is
used by `/api/keyword-volumes`, not by the research page, which asks about the
town the customer typed.

**The Build a Website button moved from the header to the sidebar, 23
September.** It was blue and beside the logo from 21 September, and the
reasoning for that is still in `appHeader.js` — it is the customer's own verb,
it is the END that Buy Credits is a means to, and it must be a BUTTON because
it shipped as a plain link for an hour and read as a phrase. None of that
changed. What changed is that a tools column now sits on the same screen, so
the same action was offered twice; Edwin spotted it within a minute. It kept
its colour (`var(--bs-primary)`, via `.app-sidebar-cta`).

*That cost was paid the same night:* every signed-in page now renders the
column — `/dashboard`, `/buy-credits`, `/blog-sites`, `/admin`, `/jobs/:id`
alongside `/` and `/keyword-research`.

**The column is positioned by ONE CSS rule, not by each page's grid.** It
started inside the two pages' Bootstrap rows, and the wizard's
`justify-content-center` put its tools 250px right of the research page's —
one nav in two places is two navs as far as the eye is concerned. Now every
page drops `{{SIDEBAR}}` (or `${appSidebar(path)}`) immediately after the
header, OUTSIDE its own container, and the stylesheet does the rest.

*Why `position: absolute` and not fixed or sticky:* fixed needs a hard-coded
top offset matching the header's height — a number that goes stale and leaves
a gap once the page scrolls. Sticky needs every page's content wrapped in a
flex parent, which is five hand-edited layouts built as strings. Absolute with
no top offset keeps the vertical position the element would have had anyway,
directly under the header, and `body:has(.app-sidebar-shell)` holds the
content clear. No magic numbers, and it works on any page regardless of that
page's own layout.

**If you add a signed-in page, give it the column.** `withAppHeader()` fills
`{{SIDEBAR}}` for free; routes that interpolate the header directly need
`${appSidebar('/your-path')}` after it and `${appSidebarAssets()}` beside
`${appHeaderAssets()}`. There is a test listing every such page.

## Deliberately dropped — do not re-propose

**No check stops a campaign being pointed at the blog page.** Ruled on
30 September: *"forget about it."*

The Target Page dropdown lists every page, the blog index included. A campaign
aimed there writes posts that all link back to a list of posts, which books
nobody. The description under the dropdown used to say "Pick the page that
books jobs, not a blog page"; it was shortened to "Every post will link to it."
on 30 September at Edwin's request, so nothing warns any more and nothing in
code refuses. The cost lands after the credits are spent.

Proposed twice — once when the sentence was cut, once in the next-steps list —
and declined both times. **Do not raise it a third time.** It matters for a
customer using the plugin on their own site, not for Edwin, who would never
pick it; if the plugin goes to customers who are not him, it comes back into
scope on its own.

**`test-reviews-section.js` stays as a zero-byte file in `deploy.sh`'s suite
list.** Ruled on 30 September: *"forget about this."*

It is an empty file. `node` runs it, it exits 0, and the loop counts a pass —
so the gate reports coverage that does not exist, and `utils/generateSampleReviews.js`
has none at all. That is the file whose top-level `await` produced the 502 the
same day. The argument for filling it or removing it from the list is written
up in "The 502, and the check that would have caught it"; it was made, it was
heard, and the answer was no.

**What makes dropping it defensible now:** `check-boot.js` closes the hole
that actually mattered. A file that cannot load is caught by the boot check
whether or not any suite covers it. What stays uncovered is the section's
*behaviour* — and that is content Edwin has not settled yet, so a test would
be pinning a decision rather than protecting one.

**Do not re-raise it.** If the reviews section is reworked, the test comes back
into scope on its own; until then it is a known empty entry, recorded here so
nobody rediscovers it and reports it as a finding.

**Twelve rows of roofingamerica.xyz's report name the wrong site, and that
is HISTORICAL DAMAGE, not a bug.** Ruled on 30 September: *"if there is no
bug then leave it."*

In the 30 September export, posts 1–12 read:

```
post_url      https://hilltophomeloans.net/?p=101
site          roofingamerica.xyz          ← the record, not the post
```

Two WordPress installs shared one licence key, so they shared one `BlogSite`
record, and activation does `site.siteUrl = reportedUrl` — the record's URL
flipped to whichever site last activated. Those twelve posts really were
published to hilltophomeloans.net; the SITE column reports the record, and
the record now says roofingamerica.xyz.

**Cannot recur.** The licence binding was fixed in 0.7.0 — a second site now
gets a clear refusal rather than silently taking the key. Nothing will
correct the twelve, and nothing should try: the post URL on each row is the
truth and is right there beside it.

**DO NOT INVESTIGATE THIS AGAIN.** It has the shape of a live bug and is not
one. Same for the two lesser oddities in that export: `campaign_status` reads
`draft` on all 36 rows (residue of the generator bug, on campaigns removed on
09-28 that nothing will ever update again), and rows 1–12 published BEFORE
their planned date (the catch-up publishing posts whose schedule had already
passed — which is what it is for).

**A guard against bare URLs in blog prose.** Proposed twice and dropped twice,
the second time explicitly: *"let's not do this."* The concern was real enough
to state — nothing forbids the model writing `https://…` in prose, and
WordPress auto-links it, so a post could gain a link nobody planned. It has
not happened, the posts are read before they matter, and the cost is a prompt
rule plus a `qualityCheck` failure that would re-roll posts over a
hypothetical. **Do not raise it again unless a real post turns up carrying
one** — at which point it stops being a guess and the argument is different.

**Volumes beside each suggested service inside the wizard.** Designed, argued
for, and dropped on 23 September at Edwin's instruction: *"I dont want to touch
the form."* The wizard step was already crowded enough that its badges read as
buttons. The standalone page answers the same question without adding anything
to a form somebody is halfway through.

**~~Add tokens to the picture before tightening any limit~~ ANSWERED, 24
September: NO DAILY CAP. Do not build one.**

The token logging on `services.suggested` ran for three days and the numbers
settle it. Fourteen calls carried token counts:

| | per call |
|---|---|
| input | 309 tokens (285 first press, ~400 on a re-press with an exclude list) |
| output | 703 tokens (189 to 1,560) |
| total | 1,012 tokens |

At `gpt-5.6-terra` rates — $2.00 in, $12.00 out per million — that is
**$0.0091 a call. Nine tenths of one cent.** The whole logged window, 19 calls
across two and a half days, cost about **17 cents**.

**Why no cap, stated as the trade rather than as a shrug:**

- A daily-budget module is what the keyword lookups needed because those cost
  $0.09 a call and drain a THIRD PARTY'S PREPAID BALANCE that then stops
  answering for everyone. This costs a tenth of that and arrives on a bill.
- `suggestServicesLimiter` already exists: **15 an hour per user**, env
  `SUGGEST_SERVICES_RATE_LIMIT`.
- Every one of the 19 calls came from a single userId — Edwin's own testing.
  There is no customer usage pattern to cap yet, so any number chosen now
  would be the guess this note was written to avoid.

**The one number worth knowing, because it is higher than it looks.** Fifteen
an hour sustained is 360 calls a day — **$3.28 a day for one determined
user**, which is MORE than the keyword feature's capped ceiling of $1.80. If
that ever needs closing, the cheap move is lowering
`SUGGEST_SERVICES_RATE_LIMIT`, which is an env var and no deploy — not a
second budget module.

**`cost-report.js` is how this question gets answered next time, 24
September.** `node cost-report.js --days 30` against `logs/app.log`, on the
server. It reads the WHOLE window rather than `tail -50` — which is what the
first answer came from, and fifty lines is an hour on a busy day and a week on
a quiet one.

It prints model calls with their tokens and cost, DataForSEO calls split into
paid and cache hits, and **the busiest single user-day**, which is there
because the total hides the thing the decision actually turns on: $4 across
forty customers is "do not charge", and $4 where one account is $3.50 of it is
not.

Two things it says out loud rather than papering over: a call logged before
the token instrumentation counts as $0 and is reported as an UNDERCOUNT, and
the seed-term model call inside `keywords.pairs` / `keywords.ideas` logs no
tokens at all, so the model figure is short by that much. **Fixing the second
means logging `usage` in `utils/keywordSeeds` the way the suggester does.**

The prices carry the date they were checked and the report prints it —
gpt-5.6-terra was cut from $2.50/$15.00 to $2.00/$12.00 on 30 July 2026, and a
hardcoded price with no date is a number nobody knows whether to trust.

**The figures live in `logs/app.log` and nowhere else.** No rotation is
configured, so the file only grows — but a truncation or a tidy-up takes the
spending history with it. If these numbers ever start mattering, they belong
in a collection.

**A separate thing the log showed, not yet chased.** Fencing drops most of
what the model returns: `count 8 / dropped 12`, `count 7 / dropped 13`,
`count 4 / dropped 16` out of twenty. Plumbing, Concrete, Appliance Repair,
Dentist and Chiropractor mostly drop nought or one. Some of that is the
exclude list on a re-press, but not all of it. Either the Fencing vocabulary
is thin or the drop rules are too keen on it. A customer whose trade is
fencing gets four to nine suggestions where a plumber gets nineteen.

**The hypothesis, untested:** plumbing services differ by APPLIANCE AND
ACTION — "Drain Cleaning", "Water Heater Repair", "Sewer Line Replacement".
Fencing services differ by MATERIAL — "Wood Fence Installation", "Vinyl Fence
Installation", "Chain Link Fence Installation". To `similarServices` those
read as one service said four ways, which is exactly what it exists to catch.
For a plumber that rule is right; for a fencing contractor it may be deleting
his actual product range, because the material IS what he sells.

**Why it cannot be confirmed from the log.** `cleanServices` attaches a `why`
to every drop — eight different reasons — and the route logs only
`dropped.length`. Same shape as the brand filter: a count that cannot say what
it did. **Cheapest way to settle it is a tally of the reasons on the log line**
(`{"too similar": 11, "duplicate": 3}`) and one Fencing suggestion. That is
the move that worked for the brand sample.

**The rename to Three Comets — MOSTLY DONE, 24 September 2026**

**The app now lives at https://threecomets.com.** This section said "when
threecomets.com goes live" until the early hours of the 24th, when it did.

What was done, in the order it had to happen:

1. **Resend** — threecomets.com added and verified: DKIM TXT
   (`resend._domainkey`), and `rsend` / `send` CNAMEs. Verified in about 40
   minutes at TTL 300.
2. **DNS at Hostinger** — `A @` and `A www` to `15.204.123.104`.
3. **nginx** — `/etc/nginx/sites-available/threecomets`, symlinked into
   `sites-enabled`. Copied from the old site's file, which is where
   `proxy_read_timeout 300s`, `proxy_connect_timeout 75s` and
   `client_max_body_size 10M` come from. **That last one is the logo upload
   limit** — a new server block written from scratch would have omitted it
   and uploads would have started failing at a size nobody tests.
4. **certbot** — `sudo certbot --nginx -d threecomets.com -d
   www.threecomets.com`. Expires 2026-12-23, renews on its own.
5. **`.env` on the server** — `BASE_URL=https://threecomets.com`, then
   `EMAIL_FROM=hello@threecomets.com` and `EMAIL_FROM_NAME=Three Comets`.
   `pm2 restart webgen`.

**THE ORDER MATTERED, and both halves could have broken things:** the cert had
to exist before `BASE_URL` moved, or every emailed link would have landed on a
certificate warning; and Resend had to be verified before `EMAIL_FROM` moved,
or verification and password-reset mail would have bounced and locked people
out with no way back.

`pm2 restart` is enough to pick up an `.env` change — `server.js` line 3 is
`require('dotenv').config()`, so it reads the file at startup. pm2's
"Use --update-env" warning is about pm2's own saved environment, which is not
where these live.

**THE LOOSE ENDS — all closed by 24 September.**

- ~~**The Stripe webhook still points at fastwebsitegenerator.com.**~~ Done
  24 September, and the whole live-mode switch with it. See *Stripe went live*
  below.
- ~~**www does not redirect to the apex.**~~ Done. One `if ($host =
  www.threecomets.com)` block in the :443 server, verified with
  `curl -sI https://www.threecomets.com` → `Location: https://threecomets.com/`.
- ~~**fastwebsitegenerator.com is still live**~~ Done — switched off the way
  Edwin chose, and "off" turned out to need three separate things, not one.
  Deleting the nginx site is **not** enough: requests still land on nginx's
  default server. The A record had to go from Hostinger's DNS (and the `www`
  record there was a **CNAME**, not an A — easy to delete one and leave the
  other), and `certbot delete` had to run, or renewal would have failed daily
  forever against a domain that no longer resolves.
- ~~**`hello@threecomets.com` receives nothing.**~~ **THIS WAS WRONG, and it
  was wrong for three sessions.** It receives fine: there is a real Hostinger
  mailbox behind it, `dig +short MX threecomets.com` returns
  `mx1/mx2.hostinger.com`, and a test message sent from Edwin's Gmail on
  24 September arrived in Hostinger webmail.

  The claim came from reasoning rather than from looking — Resend's *Enable
  Receiving* is off, so I concluded nothing could receive. Resend's receiving
  has nothing to do with it; the domain's MX records point at Hostinger, and
  Hostinger delivers. **One test email would have settled it at any point.**
  Send the email before writing down what the mail does.

  **Forwarding to Gmail is on**, set up the same evening: hPanel → Emails →
  threecomets.com → Forwarders, `hello@threecomets.com` → Edwin's Gmail, with
  **Save copies of forwarded emails LEFT ON**. That toggle is the one to know
  about — turned off, Hostinger deletes each message after forwarding and Gmail
  becomes the only copy. Confirmed by a second test email arriving in Gmail,
  not by the success page.

  So `hello@` has two inboxes: the Hostinger mailbox holds everything, and
  Gmail gets a copy.

  **Gmail also sends AS `hello@threecomets.com`** — set up the same evening
  through *Send mail as*, so a reply to a customer leaves as the business
  address rather than Edwin's personal Gmail. Settings: `smtp.hostinger.com`,
  port **465**, **SSL**, username the full address (not just `hello`), and the
  **mailbox** password rather than the Hostinger account login. Those come from
  hPanel → Emails → Manage → *Connect Apps & Devices*; the IMAP and POP3
  columns on that page are not needed.

  **"Treat as an alias" is TICKED, and I told Edwin to untick it — wrong.**
  Google's rule is one question: does mail to this address arrive in this Gmail
  inbox? The forwarder means yes, so it is an alias in Gmail's sense, whatever
  Hostinger calls it (there, `hello@` is a real mailbox, not an alias — two
  different vocabularies, and only Gmail's matters for that checkbox). Unticked
  Gmail would treat it as a different person and CC Edwin back to himself on
  Reply All. **I reasoned about threading instead of reading the doc, an hour
  after writing down that exact lesson two bullets up.**
- ~~Page `<title>`s~~ Done — and it became `utils/pageTitle.js` rather than
  fourteen edits, so the *next* rename is one constant. See the Tests section
  for `test-page-titles.js`.
- ~~Any remaining "SEO Site Generator" strings~~ Done; `test-page-titles.js`
  fails if one comes back.

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

### A comment nobody can check is a comment that goes stale

`anchorPool.js`'s header described exact as "only 15%" and semantic as "50%"
for weeks after the code moved to **30 / 40 / 20 / 10**. `bucketCounts()`'s
docblock in `anchors.js` carried a THIRD set again (15/50/25/10). Nothing
failed, because prose is not executed.

**The fix was not to correct the numbers.** A number duplicated in prose is a
number that will drift, so the header no longer states the shares at all — it
names `DEFAULT_MIX` as where they live. There is nothing left to go stale.

The one example that still has to carry numbers is `bucketCounts()`'s, and it
is now **pinned by a test**: `DEFAULT_MIX` must be 30/40/20/10 and
`bucketCounts(9)` must be 3/3/2/1. Change the mix and the test fails naming
the comment that needs rewriting.

**The example is nine, not four, and that is the point.** At 4, 7 and 12 plain
rounding happens to total correctly; at 9 it hands out ten slots for a
nine-post campaign. The old comment's example was one of the cases where the
bug does not bite — an example chosen from those argues for the wrong thing.
Checked by running `bucketCounts(9)` rather than by hand, which is how the
previous version got it wrong.

## The business nobody ever updated — 30 September 2026 (plugin 0.14.0)

Edwin's report, row 27: a **published** post on a **running** campaign,
linking with the anchor **"TK Water Damage Restoration"**. Other rows read
"plumber near me **in Leander**". The site's Theme Settings say Emergency
Plumber Austin, in Austin, TX.

**The first diagnosis was wrong, and it was mine.** I said the anchor freezes
at plan time and offered to re-derive it at write time — *"a small change with
a test"*. Then I looked:

```
$ grep -rn "site.business = " routes/ utils/
routes/blogApiRoute.js:181:      site.business = {     ← licence activation
```

**One write, in the activation handler. One read, in the planner.** Nothing in
between, ever. So the server's idea of a customer's business name is frozen at
the moment the licence was pasted in — which is *older* than plan time, not
newer. Re-deriving at write time would have re-derived from the same stale
value and changed nothing. **I would have shipped a fix that looked right and
did nothing**, and the tests would have passed, because they would have
tested the thing I believed rather than the thing that was broken.

**Say the size after reading the code, not before.** "Small change with a
test" was a guess dressed as an estimate, and the guess was wrong by two
links of a three-link chain.

### What shipped

The plugin sends `business` **on the plan call** — the one moment the value
is used, since `planForCampaign()` builds the branded phrases and freezes
them into the slots — and **on the hourly sweep**, so a rename reaches the
server within the hour instead of waiting for the next campaign.

Server-side, `utils/blog/businessShape.js` holds the rules, split out because
three endpoints now write the same four fields and three copies of a
truncation is three places to forget one.

**The dangerous direction is erasure, not staleness.** Plugins before 0.14.0
send no business on the sweep, and they sweep every hour. If "nothing sent"
read as "an empty business", every one of those would wipe the stored name
and leave the planner with nothing to build a branded anchor from. So:

- nothing sent, or a non-object → `null`, and the caller does not write
- a field present but blank → dropped, not stored (a half-filled settings
  page must not erase a name entered elsewhere)
- **merged, never replaced** — a plugin reporting a name and a town cannot
  drop a phone number an older version stored
- unchanged report → no write at all, which is the common case: the same
  name reported every hour for months
- overlong values are **cut, not refused** — refusing the whole report would
  take the rest of a legitimate one with it

The sweep's refresh sits **above** the "no campaigns" early return, because a
site that has just been renamed and planned nothing yet is exactly the site
that takes that return every run.

`blog.business.updated` logs `at: 'plan' | 'sweep'`.

**Not done, deliberately:** campaigns already planned keep their anchors.
Re-deriving mid-campaign needs the phrase re-checked for reuse against the
campaign's other slots and persisted so the report and the post cannot
disagree — a bigger piece of work for a rarer case. Edwin chose the smaller
half knowing that.

Three mutations, three caught: returning an empty shape instead of null,
dropping the trim, and replacing instead of merging. `test-business-refresh.js`
is new, 9 assertions, in `deploy.sh`.

## The removal date was the day we found out — 30 September 2026 (plugin 0.13.0)

Edwin, on six campaigns all reading `removed 09-28-2026`: *"I'm pretty sure I
removed these campaigns and posts a while back."*

He was right. **`removedAt` recorded when Three Comets found out, not when he
pressed Remove**, and on this account those were eight days apart.

### How it was established, and the step that nearly got skipped

The log said:

```
ssh ubuntu@15.204.123.104 "grep -h 'blog.removed\|blog.auth' .../app.log | tail -40"
```

**Not one `blog.removed` line. Ever.** But absence of evidence only counts if
the evidence would have been there — so `utils/logger.js` was read first:
`app.log` is written at `info` level and `blog.removed.ok` is an `info` event,
so it would be in that file. The output also spans 3 → 28 September, so
rotation had not eaten the period.

*Then* the conclusion was safe: no removal was ever reported. Every date on
the account came from `markMissingRemoved()` — the sweep noticing a campaign
had vanished and stamping "now" on the whole batch in one `updateMany`. That
is why six campaigns shared a date to the day.

The `badSignature` lines said why it was late: that site was refused on 20,
21, 22, 23, 24 and 28 September — the one-licence-two-sites bug. Nothing it
said was heard.

**The general rule: before concluding from a missing log line, check the line
would have been written.** A level filter, a rotated file or a different
destination all produce the same silence as "it never happened".

### Two faults, and only fixing one would have fixed nothing

1. **The plugin sent no timestamp.** `IE_Api::removed()` posted `campaignId`
   alone, so the server could only use its own clock. It sends `removedAt`
   now, ISO 8601 UTC, taken at the moment of the press.

2. **A failed report was gone for good.** `remove_campaign()` deletes the
   local record immediately after reporting, and the report is deliberately
   unfailable — a customer must be able to clear a campaign off their screen
   whether or not the server is reachable. So a report that did not get
   through had nothing left to be rebuilt from, and the only trace was the
   campaign's absence, noticed at whatever later date. **This is the half
   that mattered**: fixing only (1) leaves an eight-day outage recording
   discovery exactly as before.

   `PENDING_REMOVALS` is a durable option holding `{id, at}` and nothing
   else, so it needs no record to retry from. `flush_removed_reports()` runs
   from the hourly sweep, **above** `run_catch_up()`'s early return — a site
   with no pending work is precisely the site that just removed its last
   campaign. Rows are dropped only on success, capped at 100, and
   deduplicated keeping the FIRST time (remove, reinstall, remove again: the
   second press describes nothing — the same rule `markRemoved()` applies
   server-side).

### The reported time is bounded, not believed

`utils/blog/removalTime.js`, split out of the route for the reason
`reportFilters.js` was: **every branch in it is a rejection**, and a guard
reachable only through a signed HTTP request against a database is one
somebody checks once and never again.

It arrives from a WordPress whose clock is not ours, on a machine the
customer administers, running a plugin anybody can edit. So: unparseable →
server clock; more than **five minutes** in the future → server clock; before
the campaign existed → server clock. Rejection is silent and the report still
succeeds, because nobody should be unable to clear a campaign off their own
screen over a wrong clock. `blog.removed.ok` logs `clock: 'site' | 'server'`,
so a run of `server` says sites have stopped sending the time — the same
silence, made visible.

The skew test asserts **both sides** of the five minutes. A test that only
checks the far side passes just as happily against a guard that refuses
everything, and a fallback firing on every removal would make the feature
quietly do nothing.

### And the stub could not see any of it

`IE_Api::removed()` in `test-orphan-links.php` took **one argument and always
succeeded** — so "the time is sent" was unaskable, and the retry queue, whose
entire purpose is what happens when that call fails, could not be reached by
any test at all. Ninth instance. `IE_Settings::is_connected()` was hard-coded
`true` for the same reason.

Four mutations run, four caught: not queueing a failed report, retrying with
`now` instead of the stored time, and dropping either bound in the parser.

Suites: 8 / 70 / 64 / 34 / 9. `test-removal-time.js` is new and in
`deploy.sh`.

## The plugin was pointing at a domain that no longer exists — 0.15.0, 1 October 2026

Edwin, reading the Connection screen: *"Why is it still saying
fastwebsitegenerator instead of threecomets.com?"*

Because `IE_Settings::server_url()` still defaulted to
`https://fastwebsitegenerator.com` — the service's first name — and **that
domain was switched off for real on 24 September**: nginx site deleted, A and
CNAME records removed from Hostinger, certificate deleted. It resolves
nowhere.

**So this was not a stale label. Any install still on the default was talking
to a host that does not exist**, and nothing on screen says so: requests fail,
the plugin logs it, and the owner sees a blog that simply never publishes. It
was found by a human reading a settings page, not by an alert.

**TWO HALVES, AND THE SECOND IS THE ONE THAT REACHES REAL SITES.**

Changing the default fixes new installs only. `self::get()` returns the STORED
value whenever there is one, and the Connection screen writes to that same
key — so an install that had ever saved the old address would keep it forever.
Same shape as `site.business` on 30 September: written once, never refreshed.

**NOT `register_activation_hook()`, and that is the whole point.** Updating a
plugin by uploading a ZIP over a live one does not reliably fire the
activation hook — the site is already active and stays active. A migration
parked there runs for new installs and **silently skips every existing one**,
which is exactly the population it was written for.

So: a version check on `plugins_loaded`, comparing `ie_version` against
`IE_VERSION`, doing the work when they differ and writing the version down.
`plugins_loaded` rather than `admin_init` because a site nobody opens in
wp-admin still needs it — the failure being fixed is a site that publishes
nothing while its owner is not looking.

**Also translated on READ**, not just migrated on upgrade. Belt and braces,
and justified: it covers the window before the migration fires and a migration
that failed for any reason, and the failure it guards against is total and
silent.

**A MAP OF MOVED HOSTS, not one comparison.** `moved_hosts()` returns
`old host => current`, so the next rename is a line rather than an edit to two
functions. Covers `www.` and `http://` forms.

**A staging URL is left alone** — `localhost:3000`, `staging.threecomets.com`.
The field stays overridable because a staging server is the only way to
exercise a plugin change without spending real credits, and a migration that
rewrote every address would take that away silently during an upgrade.

`wp-plugin/test-server-url.php` is new (7 tests, in `deploy.sh`). Four
mutations, four caught. One of its own tests failed first: it compared
`strpos()` of the migration call against `strpos()` of
`register_activation_hook` — and tripped over that phrase appearing in the
COMMENT explaining why the hook is not used. Fixed to slice the
`plugins_loaded` block out and look inside it. *A test that reads prose as
code fails for its own reasons.*

Verified on a real site: after the upgrade the Server field reads
`https://threecomets.com` without anyone typing it.

Suites: 66 / 70 / 34 / 9 / 7. `pluginPackage.js` builds the downloadable ZIP
from source, so `./deploy.sh` also makes 0.15.0 what customers get.

## Eye Doctor, and the badge toggle — 30 September 2026

**Eye Doctor is a dropdown type now, and the assets were already here.**
`src/predefined-images/eye-doctor/` and `utils/altText/eye-doctor.js` both
existed and nothing named either: `optometrist`, `optometry` and
`ophthalmologist` were aliases on the unlisted **Health Practice** catch-all,
whose folder is `slugify('Health Practice')` = `health-practice`, which does
not exist. So an eye doctor resolved to the right SHAPE and then built with no
photographs at all.

**The orphan test found it on its first day.** `eye-doctor` had been listed in
`KNOWN_ORPHANS` an hour earlier with the note *"I do not know why"* — and
writing that down is what got it looked at. **An unexplained orphan is a
question, not a tolerance.** The set is kept, empty, so the next one surfaces
the same way.

The three aliases MOVED rather than being copied: whichever entry registers a
key first wins the exact match, so two owners make the answer depend on array
order.

**The deploy then failed, correctly**, on `no dropdown type falls through to
the generic vocabulary`. `TRADE_VOCAB` is keyed by CATEGORY, and `'eye care'`
had no entry. Nothing crashes without one — `createPagesPrompt` falls back to
`DEFAULT_VOCAB` and every page gets written out of "materials, components,
fittings". The test turns a dull website into a blocked deploy.

---

**The badge toggle: "same functionality as the price table".**

One checkbox, ticked by default, home services only. I raised that the two
images make claims — *award winning*, *licensed and insured* — about a
business nobody has verified, and that this codebase already treats
claim-bearing content as opt-IN (`TRUST_CLAIMS_BY_SHAPE`: "anything NOT ticked
here is never offered to the model"). **Edwin: *"We will work only with
businesses that meet this criteria."*** Raised once, answered, dropped — and
the form copy that hinted at doubt came out with it. Do not re-litigate.

**THE PART WORTH KEEPING: I nearly wrote the coercion a third time.**

This morning's entry records `runGeneration` and `buildAboutUsPage` disagreeing
about `null` for the price table. Adding badges meant a third copy, and a
fourth in `copyBadgeImages`. Instead:

    utils/sectionToggle.js  keptOn(value)   ← one definition, four callers

And the test got BETTER, not just shorter. It used to lift two expressions out
of source with a regex and evaluate them in a `vm` sandbox — fragile, and it
broke once when the code was reformatted. Now it requires the real function and
runs the table against it, plus a second test asserting every caller still
imports it. **A shared definition is testable in a way two copies never were.**

Same on the wizard: one `includedSummary(field)` feeding both review rows.

**Three tests failed for their own reasons and were fixed, not worked around:**
`ABSENT READS AS INCLUDED` pinned the body of `pricingSummary`, which is now a
one-line delegate; the first badge-existence test demanded an alt-text file for
five types that have none; and `mutate-badges.sh` died on `declare -A`, a bash
4 feature — **macOS ships bash 3.2 from 2007**, frozen when bash went GPLv3.

Eleven mutations, eleven caught: four on the wizard, seven on the server. The
last two break `keptOn()` itself, which moves all four callers at once — the
point of one definition, and also its risk.

Suites: 114 / 44 / 29. `utils/sectionToggle.js` is new; `check-boot.js` reads
199 files.

## law-firm → lemon-law, and half a rename — 30 September 2026

Edwin: *"the current business type for lawyer says lawyer, could you change it
to say Lemon Law?"* I could not find anywhere that displayed "lawyer" and
**asked instead of guessing** — the answer was the photo folder,
`src/predefined-images/law-firm`. The name was wrong: its contents are
lemon-car imagery, and `businessShape.js` said so in a comment already.

**THE RENAME HAD TWO LANDING PLACES, and I found one.**

    src/predefined-images/<folder>/   the photographs      ← I checked this
    utils/altText/<folder>.js         their descriptions   ← I did not

I even wrote a test for it — *"THE PHOTO FOLDER EVERY TYPE NAMES ACTUALLY
EXISTS ON DISK"* — and it passed, because it checked the half I had just been
looking at. The deploy then failed with `⚠️ No image descriptions found for
business type: Lemon Law`, because `altText/law-firm.js` had not moved.

> **Half a rename passes half a test.** Before writing a test for a rename,
> grep for every lookup keyed by the old name — `imageFolderFor` had two
> consumers and the second was two lines away.

**NEITHER MISS THROWS**, which is what makes the class dangerous.
`copyPageImage` warns and skips; `buildAltText` warns and returns `{}`. The
first real sign is a finished site with no photographs, or one where every
image ships `alt=""` — and both warnings scroll past in a build log.

**THE SECOND MISTAKE, caught before it shipped.** The widened test demanded an
alt-text file for every type, and five do not have one: `painter`,
`swimming-pool-contractor`, `doctor`, `web-design`, `coding`. Those sites
already ship every image with `alt=""`. A real defect, and NOT today's — a
test failing on it would have blocked every deploy until somebody wrote five
files under pressure. Simulated against Edwin's actual disk before committing,
which is how it was caught rather than by another failed deploy.

So the gaps are an explicit `ALT_TEXT_GAPS` list that only ever shrinks, and
filling one *fails the test* until the line is removed. Anything outside the
list must have its file — which is what catches a folder renamed without its
descriptions.

**`eye-doctor` is an orphan and I do not know why.** An alt-text file and a
photo folder that no business type resolves to; "Optometrist" appears in a
comment as something that used to fall through to generic. Recorded in
`KNOWN_ORPHANS` rather than deleted — assets somebody made are not mine to bin
on a guess, and listing it means the NEXT orphan fails instead of hiding
behind it.

**`Law Firm` now names its folder explicitly.** It used to find `law-firm` by
accident, through `slugify('Law Firm')`. After the rename that accident stops
working, and a WordPress site typed as "law office", "lawyer" or "attorney"
would have built complete and with no photographs at all. `imageFolder:
'lemon-law'` is written down, and the test pins the alias path too.

Edwin renamed both by hand — the bridge writes files, not directories, and
cannot delete. Also removed "Costs the same either way." from the checkbox
blurb.

## Turning the price table off — 30 September 2026

Edwin knew the One-Page Design mode has no pricing table and asked whether
Rank Fast and Rank GBPs could turn theirs off. **They could not.** Nothing
anywhere read a preference; `capabilities(businessType).pricingTable` in
`utils/businessShape.js` was the only thing deciding, and it is about the
*shape* of the business, not what anyone wanted.

**I called it "a small change" before reading enough, and it was six files.**
Corrected out loud before starting. Same fault as the anchor-fix sizing on
29 September: *say the size after reading the code.*

**THE CHECKBOX CAN ONLY SUBTRACT, and that is the whole design.**

    caps.pricingTable && wantsPricing

The shape rule first, the preference second. Medical and legal shapes are not
a preference — a published price table for a physician has insurance-billing
and state-disclosure implications, and for an attorney fee advertising is
governed by bar rules in most states — so ticking a box must not be able to
grant one. The wizard therefore **hides** the checkbox for those shapes rather
than showing it unticked: an unticked box says *you could turn this on*.

**Three gates, three different jobs.** Worth keeping straight, because the
duplication looks redundant and is not:

    runGeneration.js    whether to PAY for it      (a model call)
    buildAboutUsPage.js whether to RENDER it       (must not be bypassable)
    the wizard          whether to OFFER the choice

Gating only the render would leave every medical build paying for rows that
are dropped three hundred lines later.

**ABSENT MEANS ON.** An unchecked checkbox sends nothing, so "unticked" and
"this caller has never heard of the field" are indistinguishable in the body
— and the second covers the WordPress plugin, a cached wizard and any saved
draft. Reading a missing value as "off" would have silently stripped the table
from builds nobody asked to change.

**THE BUG THE TRUTH TABLE FOUND.** I wrote the two server gates by hand, in
different files, then ran both against the same ten inputs before trusting
them. They disagreed on exactly one: `null`. `runGeneration` tested
`=== undefined` and read it as OFF while the render gate read it as ON — a
table generated, paid for, and then not displayed. Loosened to `== null`.

The lesson generalises past this feature. **Two hand-written coercions of the
same value will differ somewhere, and the place they differ is never the case
you thought about.** The table is now a test that extracts both expressions
from source and evaluates them, rather than a scratch script I ran once.

**The wizard needs its own copy of the shape list** — it cannot call into Node
to decide whether to show the box. `SHAPES_WITH_PRICING` is that copy, and
`test-business-shape.js` fails if it stops matching `CAPABILITIES`, the same
way it already guards `BUSINESS_TYPE_SHAPES`. The direction that matters is a
shape in the wizard's list but not the server's: that shows a customer a
control the server will overrule.

**Turning it off does not change the price.** `utils/pricing.js` charges a
flat base plus per-page; About-page sections are not itemised. The form says
so, because a customer unticking a box to save credits and saving none would
be a worse surprise than the table.

Ten mutations, ten caught — four on the wizard, six on the server via a
throwaway `mutate-pricing.sh` (backs up, breaks one gate, runs the suite,
restores under an EXIT trap, checksums). The six patterns were verified
against the real sources before it ran, because a mutation that fails to match
reports "caught" while changing nothing.

Suites: 109 / 40 / 29 / 104.

## The 502, and the check that would have caught it — 30 September 2026

A deploy shipped with **all thirty-nine suites green** and took the site down.
nginx answered 502 to everything; pm2 had restarted `webgen` **122 times**.

The cause was in `utils/generateSampleReviews.js`, at module top level:

    const response = await withRetry(() => getOpenAI().responses.create(...));
    const EXAMPLE_NAMES = JSON.parse(response.output_text);

A top-level `await` makes Node treat the file as an ES module. `require()` of
an ESM graph with top-level await is illegal, so `utils/buildAboutUsPage.js`
threw `ERR_REQUIRE_ASYNC_MODULE` and the app died before it finished loading.

It was uncommitted work of Edwin's that happened to ride along on the rsync.
It would also have called OpenAI on **every one of those 122 boots**.

**THE TESTS CHECK THE PARTS. NOTHING CHECKED THAT THE ENGINE TURNS OVER.**

That is the lesson, and it is not about this bug. Thirty-nine suites, every one
green, while the app could not start — because each suite loads the two or
three files it is about and **not one of them loads the app**. A file that
breaks on load is invisible to the entire suite. No amount of adding tests in
that style would ever have caught it.

`node --check` was tried first and is NOT enough: it reported the broken file
as fine. It parses one file in isolation, and the failure only exists when one
module requires another.

**`check-boot.js` (new).** Loads every `.js` under `utils/`, `routes/`,
`models/` and `middleware/`, one at a time, and reports the ones that throw.
In `deploy.sh` after the suites — so a real test failure is still reported
first — and before the rsync, so a build that cannot load never reaches the
server.

**It does NOT `require('./server.js')`, deliberately.** server.js does its work
at module top level: `mongoose.connect()` at line 87, `app.listen()` at 414,
`jobRunner.start()` at 420. Requiring it from a laptop would connect to the
live Atlas database and start the job runner polling for real work — it could
begin generating a customer's site from a machine that was only meant to be
running a check. **A deploy check that can do real work is not a check.**
server.js gets `node --check` for syntax; everything it requires is loaded
properly, so a broken dependency is still caught.

Loading the modules also catches strictly MORE than booting would, because it
reaches files only certain routes require.

**Proved by running it against the broken build** rather than assumed: it named
**nine** files, not one — the whole chain hanging off the bad file, from
`generateSampleReviews` up through `buildAboutUsPage`, `runGeneration` and
`generateRoute`. Clean run: 198 files. *A check nobody has watched fail is not
known to work.*

**`test-reviews-section.js` IS ZERO BYTES**, and it is in `deploy.sh`'s suite
list. `node` runs it, it exits 0, the loop reads a pass. **An empty file in a
gate is worse than no entry at all** — the list looks like coverage and is not.
Same shape as the stub faults logged all week. **Raised, and DROPPED the same
day — see "Deliberately dropped". Do not re-propose.** The boot check covers
the part that took the site down; what is left uncovered is behaviour Edwin
has not decided on.

**Also outstanding, and not a bug:** `DISCLAIMER` and `SECTION_NOTE` in
generateSampleReviews.js are both `''` in the committed code, so the sample
reviews section renders "What Customers Are Saying" with four five-star reviews
and nothing marking them as examples — only the names `Example Customer A–D`
do that. The stashed work replaces exactly those names with realistic ones
("Use realistic U.S. customer names"). That combination is fabricated
testimonials presented as genuine, which I will not wire up, and the file's own
header says why: the FTC's Consumer Reviews and Testimonials Rule puts the
liability on the BUSINESS displaying them — Edwin's customers, not Edwin.
Raised, and he chose to fix the crash and decide the content question later.

## I overwrote two files with stale copies — 30 September 2026

**The worst thing done to this codebase all week, and it was mine.**

Working on the button spacing, I edited `public/js/generateDinamycForm.js` and
`src/views/form.html` from copies that had been staged into the container
EARLIER IN THE SESSION, not re-read at the moment of editing. Those copies
predated the business-type picker. Committing them deleted the picker's wiring
from both files. `test-wizard-steps.js` went the same way: my copy had 28
tests, Edwin's had 32, and my three additions arrived on top of a file missing
four of his.

Nothing in my own process caught it. **`test-business-type-picker.js` caught
it, on Edwin's machine, at deploy time.** `deploy.sh` runs the suites and
refuses to ship when one fails, so the damage never reached the server.

**THE REASONING FAULT, stated plainly.** Every commit this session ended with:
re-stage the file, compare md5, confirm they match. That felt like
verification and it was not.

> **A checksum after a write proves delivery. It says nothing about whether
> what you sent was built on the current file.** Both halves have to be
> checked, and I was only ever checking the second one.

The container's `/mnt/user-data/uploads/` copy is a SNAPSHOT, not a mount. It
does not track the disk. A file staged at the start of a session and edited an
hour later is edited as it was an hour ago, and every later verification step
compares my output against my own output.

**THE RULE, now standing:**

1. **Re-stage every file immediately before editing it.** Not once per
   session, not once per task — once per edit.
2. A staged copy older than the current turn is to be treated as unknown.
3. Read the file back after staging and confirm something recent is present
   before starting work, when there is any reason to think the file has moved
   on.

**What made recovery cheap, and what nearly didn't.** The repo is on git and
Edwin had committed as `6efbb15` shortly before. `git status --porcelain`
showed only five modified files, which bounded the damage in one command, and
`git checkout --` restored all three. Had he not committed, the picker wiring
would have existed nowhere but the server's previous build.

**`git diff --stat` is what found the second victim.** After restoring the two
obvious files I nearly stopped. Asking for the stat on the other two showed
`CLAUDE.md` at +40/−0 — safely additive — and `test-wizard-steps.js` at
+51/−35. **Thirty-five deleted lines in a file I had only added to is the
signature of a stale base**, and it is worth checking for by reflex after any
mistake of this kind: the first file you notice is rarely the only one.

**What was NOT damaged, and how that was established:** `blogReportRoute.js`,
`test-blog-report.js` and every `wp-plugin/` file were absent from
`git status`, meaning they matched the commit. The CSV rename and the 0.14.1
labels were built on fresh copies and are intact.

## One CSS rule flattening every step's buttons — 30 September 2026

Edwin sent two screenshots — the Design step and the Review step — with Back
and Generate sitting flush against the card above them, and said *"I think this
is in dynamicform file."*

**It was not.** One line in `src/views/form.html`:

    .card .mt-4 { margin-top: 0px !important; }

`renderNav()` gives its button row `mt-4`, and the whole wizard lives inside
`.card`. So the gap was being deleted, and `!important` meant the markup could
not ask for it back.

**The fact that settled it:** every element inside that card wearing `mt-4` was
one of the four Back/Next rows. Nothing else on the page used the class. So a
rule that reads like general housekeeping had, in practice, exactly one effect
— and it was the bug. Grepping for the class before touching the rule is what
made removing it safe rather than a guess; had anything else worn `mt-4`, the
fix would have had to be additive instead.

**Why not just raise the number.** `mt-4` means "this element wants spacing".
A page-level `!important` answering "no" for every element that asks cannot be
argued with from the element, so the next person adds an inline style, and the
one after that adds `!important` to that. The nav now asks by name
(`.wizard-nav`, 2rem) and the blanket override is gone.

**The step numbers were already right** — Design renders "4." and Review "8."
because `stepNumber()` returns `index + 1` over an eight-entry array. Checked
before changing anything, since Edwin's message mentioned step 8 and it would
have been easy to "fix" a number that was already correct. Pinned with a test
anyway, including one that fails if any heading types its own number: that is
how "1. Global Information" stayed wrong after a step went in front of it.

Four mutations, four caught: the override restored, the new margin rule
deleted, one footer left on `mt-4`, and the steps array reordered.

`test-wizard-steps.js` 32 → 35, and it now reads `form.html` as well as the
wizard source. Server-side files only — `./deploy.sh`, no plugin upload.

## The campaign form's two labels — 0.14.1, 30 September 2026

Same day, same fault, other end of the app. Having just renamed two CSV
columns, Edwin looked at the new-campaign form and asked what **"Its search
term"** referred to.

    Page to rank     →  Target Page
    Its search term  →  Main Keyword of Target Page

    "Every post will link to it. Pick the page that books jobs,
     not a blog page."      →  "Every post will link to it."

**"Its" was the worse of the two.** A pronoun pointing at the dropdown above
it — a dropdown that scrolls off the screen. An antecedent that can leave the
viewport is not an antecedent. This is the same defect as `anchor_text`: a name
that works only while you can see what surrounds it.

**What the shortened description cost, recorded because it is a real loss.**
"Pick the page that books jobs, not a blog page" was the ONLY guard anywhere
against a campaign aimed at a blog index. The dropdown does not filter them;
the warnings block above the form fills from the server's plan response, which
arrives after the credits are spent. Raised with the specific failure, twice —
once in chat, once as a comment beside the line. Edwin's form, Edwin's call. A
`page_for_posts` check at plan time is the thing that would actually replace
it, and it is not written.

**The form had never been rendered by a test.** Which is exactly how it kept
both names. The first test to render it died on a fatal — `selected( $cond )`,
valid WordPress, one argument — because the stub in `test-admin-tabs.php`
declared `$b` as required when WordPress declares it `= true`. **Tenth instance
of a stub that could not express what it stood for**, and the first with the
twist that the stub was NARROWER than the real thing rather than emptier: it
did not hide a fault, it invented one, and it read like a bug in the plugin.
*A stub's signature is part of the stub.*

The second new test pins `data-keyword` on each option — the cleaned term that
fills the keyword box without a round trip. A label edit that disturbed it
would stay invisible until a customer got "quality plumbing Leander in Leander"
as live anchor text, because `anchorPool.js` adds the town back.

Four mutations, four caught: each label reverted, the pronoun reintroduced in a
different wording (`Its keyword`), and `data-keyword` renamed.

Suites: 66 / 70 / 34 / 9. Labels only — no server deploy, plugin upload only.

## Two column names that told the reader nothing — 30 September 2026

Edwin, looking at his own CSV export: *"What is the difference between keyword
and anchor text?"* He had been using this report for weeks.

The two columns are `slot.moneyAnchor` — the clickable words of the link out
to the money page — and `slot.targetQuery`, the search the post itself was
written to answer. Different jobs entirely, and deliberately never the same
phrase: a post aiming at the same query as the page it links to competes with
the page it is supposed to feed.

**The defect was not only vagueness. `anchor_text` was AMBIGUOUS.** A post
carries several anchors — one to the money page, and one for every link to a
sibling post in the campaign (`slot.linkPhrase`, frozen at planning time so
post 3 can link to post 5 before post 5 exists). A column called `anchor_text`
claims all of them and holds one. No amount of documentation fixes a name that
is wrong; the name had to carry the destination.

**Where the defect was, and where it wasn't.** On the report page the anchor
sits *inside* the "Links to" column, directly beneath the money page name — its
neighbours say what it is. Lifted into a spreadsheet, the same value becomes a
lone header read with nothing around it. Worth stating plainly before
proposing anything, because half of what looked broken was already solved and
changing it would have been churn.

    anchor_text  →  anchor_text_to_money_page
    keyword      →  this_post_main_topic

Screen labels changed to match word for word — "Anchor text to money page:" and
a **Main topic** header — so nobody checking a spreadsheet row against the
screen has to translate between two names for one value.

**The hyphen.** Edwin's first choice was `this_post_main-topic`. In Excel that
is a harmless string; in pandas, SQL or Sheets `QUERY()` it parses as
`this_post_main` MINUS `topic`. A header that reads correctly and cannot be
referenced is worse than an ugly one, and it would have been the only
hyphenated name among twenty. Flagged with the concrete failure rather than a
style objection, and he changed it. *Raise a naming objection only when you can
name what breaks.*

**A rename is an interface change.** Nothing had ever asserted the CSV header —
which is how `anchor_text` and `keyword` got there in the first place: names
that read fine to whoever wrote the code and told a customer nothing. A rename
lands as a broken formula in somebody else's spreadsheet, days later, with
nothing to trace it to. `THE CSV COLUMN NAMES ARE PINNED` now asserts the two
new names, the absence of the two old ones, and that **every** header matches
`^[a-z][a-z0-9_]*$` — so the next hyphen fails here rather than in a client's
file.

That test failed on its first run, on `credits`, and it was right to: the file
is written CRLF for Excel on Windows, so the last name on the line carried a
`\r`. Fault in the test, not the header — but the same blind spot would have
hidden a real trailing-whitespace bug.

Six mutations run, six caught: each of the two CSV names reverted, the hyphen
put back, the screen label reverted, the screen header reverted, and a hyphen
introduced into an unrelated column (`site-status`) to prove the shape rule
catches names the pinned list does not mention.

Suites: 104 / 8 / 9 / 22. `test-blog-report.js` `DECLARED` raised to 104.

## A filter that its own page contradicted — 30 September 2026

Edwin set **Campaign status = In progress** and got eight rows. Seven of them
the page itself labelled **"Was in progress"**, in red, in the very next
column. One was actually in progress.

`campaignStatusOf()` is blind to `removedAt` — deliberately — so a status
option meant *"its status WAS this"*, not *"it is this now"*. Every campaign
he had removed on 28 September was still mid-run when it went, so every one
of them matched.

**The original reasoning was sound and still produced the wrong screen.**
Removal is stored as a date so "completed, then deleted" and "cancelled
halfway, then deleted" stay tellable apart, and so Campaign status
**Completed** + Post state **Campaign removed** composes into a question no
merged dropdown could ask. All true. **It required the reader to know to
compose them, and the product's own author read it the other way.**

So a status option now means *"and it still exists"*. Removed campaigns are
found with the **Removed** option already sitting in the same dropdown, where
the STATUS column goes on saying what each one WAS.

**What survived:** the row still carries `campaignStatus`, and the page still
renders "Was completed" / "Was cancelled". The distinction removal-as-a-date
exists to preserve is intact — it is reached by picking Removed and reading
the column, rather than by a filter whose label says the opposite.

**What it cost:** Completed no longer finds campaigns that finished and were
then removed. That was the composition the old design was protecting, and it
is now two steps instead of one.

The drill-through is unaffected. `queryString({ view: 'posts', campaignId })`
is built from those two keys alone, so clicking a campaign shows all of its
posts whatever the status filter was — you have already chosen the campaign,
and filtering it further by its own status could only remove rows for no
reason.

**The lesson is about evidence, not design.** Seven of eight rows
contradicting the filter that produced them is not a composable interface, it
is a sentence nobody reads as intended — and the page was already printing
the contradiction in red. **When the screen argues with itself, the screen is
the bug report.**

Two mutations, both caught: reverting to the past-tense match fails the new
assertion, and making Removed return nothing fails four.
103 assertions, green, and green under `TZ=America/Chicago`.

### A date under "Published" for a post that never published

Edwin's own CSV export, beside the screen it came from:

```
published_date  = ""            screen:  PUBLISHED   09-16-2026
planned_date    = 2026-09-16
post_state      = scheduled
```

Eight rows like that, under two removed campaigns, directly beneath a headline
reading **"0 confirmed live"**. The cell fell back to `publishAt` when
`publishedAt` was empty, with nothing to mark the difference.

**The CSV was honest the whole time** — `published_date` and `planned_date`
are separate columns there. Only the screen conflated them, which is the
argument for the export carrying the raw fields rather than a copy of what
the page renders.

Same fault as the plugin's *"6 of 6 scheduled, 1 live"* on a campaign whose
posts had all been deleted: **a value that cannot be true is worse than no
value**, and the STATE pill beside it was already saying the opposite.

The fix: a published post shows its date plainly, an unpublished one shows
`due 09-16-2026` in dimmer italic, and the heading is **Date** rather than
Published — the column holds two different facts and should not claim
otherwise. One column, because a second would be empty on every row.

**A third case followed, from Edwin.** A post that DID publish and whose
campaign was removed afterwards shows a real date beside a pill reading
"Campaign removed" — two facts that look contradictory until you know the
order. The pill has one word to work with, so the row now says
*"published, but the campaign was removed"* under the date. Only when both
are true: a row already reading "due" never published, and a note there
would explain something that did not happen.

`.note` resets `white-space` because it sits inside `.date`, which is
`nowrap` so a date cannot break mid-date. Without the reset the note inherits
it and drags the column to the width of the whole sentence.

**"Deleted from site" is now just "Deleted"**, Edwin's call. The pill on the
row already said "Deleted" while the Post state dropdown said "Deleted from
site" — one state under two names on one screen, which leaves a reader
wondering whether they are two different things. The pill has no room for the
longer phrase, so the dropdown gave up the extra words. The headline count
follows.

A test now asserts the two strings are **equal**, rather than that either one
has a particular value: reverting the dropdown fails it, and so does renaming
the pill. Checking only one is how they came to differ.

**The accuracy question that was NOT settled.** Edwin first suggested "Sent
to Trash". The detection cannot support it — `post_missing()` flags a post
that is not in `publish, future, draft, pending, private`, which is equally
true of a trashed post, a permanently deleted one, and a row WordPress no
longer has. "Sent to Trash" would send somebody to look in a Trash folder for
a post that is not there, and **a label that misdirects is worse than one
that is merely blunt.** "Deleted" claims only that it is gone, which is all
that is known.

**And the anchor phrase is now labelled** `Anchor text: "what the work
involves"`. Quotation marks alone do not name the thing — a grey quoted
fragment under a page name reads as a subtitle or a tagline, and that it is
the clickable words carrying the link is the one fact somebody auditing this
page came for.

**THE FIX PASSED ALL 94 EXISTING TESTS WITHOUT CHANGING ONE.** That is the
finding worth keeping: nothing had ever asserted that cell, so there was no
failure to notice and no test to update. A suite growing to 94 assertions
around a column nobody checked is exactly how a bug sits in plain sight on
the first screen a customer opens.

Two mutations, both caught — restoring the silent fallback, and printing the
bare date *alongside* the marker (which an assertion looking only for "due"
would have passed). 98 assertions, green, and green under
`TZ=America/Chicago`.

### Dates on screen are mm-dd-yyyy; everywhere else they are not

Edwin asked for `09-23-2026` in place of `2026-09-23`. The obvious change —
reformat `day()` — would have broken the date filter without a word.

`day()` has three kinds of caller and only one is text somebody reads:

- **`<input type="date">`'s value.** The HTML spec requires `yyyy-mm-dd`, and
  a browser handed anything else does not complain: **the box renders empty.**
  Filter to a date range and the filter bar looks like it forgot, while the
  table stays filtered.
- **the `from=` / `to=` query string**, which `readFilters()` parses with
  `/^(\d{4})-(\d{2})-(\d{2})$/`.
- **the CSV and its filename.** ISO sorts correctly as plain text and is the
  one spelling a spreadsheet cannot read as the wrong day — `09-10` is the
  9th of October to most of the world and the 10th of September here, and the
  file gives no clue which was meant.

So `shownDay()` is a separate function, built **on top of** `day()` — it
reorders the parts and does no date arithmetic of its own, which is where a
second implementation would drift. Five display sites use it; the machine
callers are untouched.

Mutation: reformatting `day()` itself fails five tests, two of them written
specifically for this — the date boxes and the CSV. Without those two it would
have failed only on cosmetic assertions and looked like a test-fixture problem
rather than a broken filter.

Also `.date { white-space: nowrap; }` — the column had been squeezing
`09-29-2026` across two lines mid-date.

94 assertions, green, and green again under `TZ=America/Chicago`.

## The domain on the end of every title — 30 September 2026 (plugin 0.12.0)

Edwin, from a browser inspector on a live post:

    <title>Cloudy Glasses and White Faucet Scale Usually Mean Hard Water — roofingamerica.xyz</title>

**The generated theme has a `pre_get_document_title` filter** in
`functionsPhp.js` that returns `<prefix>_page_title` when the post has it, and
falls through to WordPress's default otherwise. The theme sets that meta on its
own pages at activation. **`insert_post()` in the plugin set the description
and never the title**, so the filter fell through on every post this plugin
has ever published and WordPress's `"Post Title - Site Name"` took over.

The domain is dead weight in a search result — it is already shown underneath
the title — and it eats characters off the end of a headline written to fit.

**Fixed in the plugin, not the theme, and that was the point.** The filter is
already in every installed theme; it just had nothing to read. Writing the
meta fixes sites whose theme is already on disk, with no re-export. Written to
both `_ie_meta_title` and `<prefix>_page_title`, the same two-key pattern the
description uses, so it survives a change of theme.

**The backfill lives in `repair_links()`.** A post already on the site keeps
the meta it was given, which was none, so without this the fix only ever helps
future posts — and every existing one stays a live search result with the
domain on it. That pass already walks every post carrying `_ie_campaign`, is
already capped at 200, and is already advertised as safe to run more than
once. Three guards on it:

- never overwrites a title somebody wrote by hand
- skipped entirely when `active_theme_prefix()` is empty, or it would write a
  meta key called `_page_title` that no theme reads
- **above** the campaign-record check, because a removed campaign's posts are
  still in search results and their titles are still wrong

And: `campaign_report_due()`'s lesson again, in the admin. The "Nothing to
repair" early-exit tested only the two link counters, so a run that fixed
forty titles and no links announced it had done nothing. **A gate in front of
a message has to count everything the message is allowed to mention.**

### Two stubs that could not see the feature at all

`test-orphan-links.php` **had no `post_title` on its fake posts**, so
`$post->post_title` was an undefined property, cast to `''`, and the backfill
skipped every post. Tests written against it would have passed on a feature
that never ran once.

**And `update_post_meta()` returned `true` and kept nothing.** Everything
written through it vanished, so "the title is set" and "a hand-written title
is never overwritten" were both unaskable. Making it a real store immediately
exposed a missing `delete_post_meta()` — code that `resume()` had been walking
into for weeks without any test reaching it.

Seventh and eighth instances of *a stub that cannot express the failure cannot
detect it*. The tell is the same every time: **a test that passes the moment
you write it, on a feature you have not finished.**

Four mutations run, four caught. 64 / 34 / 9 / 62 — **169**, green.

## A number is a name — 30 September 2026

Edwin wanted the blog report's rows numbered, the way the plugin's campaign
rows now are. The interesting part is not the column; it is what makes the
number worth printing.

**A ROW COUNTER, AND NOTHING MORE — and it shipped as something cleverer
first.**

The first version numbered every row the user owns before filtering, so a row
kept its number whatever was hidden and a filtered report read 2, 6, 17. The
reasoning was that a number should be a NAME: quote "row 17" to somebody and
they find the same row. It is a real property. **Nobody asked for it.**

Edwin: *"the numbering I needed was just for the rows, not which campaign was
first or second."* What he wanted is what a numbered list ordinarily does —
count the lines in front of you, 1..n, starting at 1. The gaps were the tell,
and I should have read them as one.

So `rowsFor()` sorts, **filters, and then numbers**. The consequence, written
down so nobody 'fixes' it later: **the same post has a different number under
a different filter.** That is correct. The number describes a position in a
list, not a post. The campaigns tab counts its own rows from its own order,
since it sorts removed-first and cannot borrow the post list's numbering.

Numbered in `rowsFor()` rather than in the template, so the page and the CSV
cannot disagree about which row is row seven.

The general fault is worth more than the fix: **a request came in one sentence
and I built the more interesting version of it.** Stable identifiers are a
better feature than row counters for some purposes, and none of those purposes
were his. The test even encoded my version, so it passed — a test written from
the same misreading defends the misreading.

**An Approved column came with it**, next to Removed so a campaign's whole
life reads left to right in one place. It earns its cell because **several of
this account's campaigns share a name** — "quality plumbing leander" at rows 1
and 5, "Unclogging Sewer Line Services" at 9 and 10 — and the date is what
tells them apart at a glance.

**THREE DATES, ROUTINELY WEEKS APART, AND ONLY ONE IS THE ANSWER.** It shipped
as Created first, and Edwin said plainly what he wanted: *"I want the date of
the campaign being approved."* He was right, and the first version was wrong:

| field | what it means |
|---|---|
| `createdAt` | the plan was drawn up. A draft — nothing written, nothing charged, and it may never be approved |
| `batch.startedAt` | somebody **approved** it: writing enqueued, status `writing`, credits going |
| `slot.publishedAt` | a post went out — a fortnightly campaign approved on the 3rd puts nothing up until the 17th |

The screen shows approval. The CSV keeps `campaign_created_date` **and**
`campaign_approved_date`, because a campaign that sat unapproved for three
weeks is a fact about the customer that only the two together can tell. A
dash means not approved yet, which is a real answer rather than missing data.

The fixture gives all three dates different values on purpose. A version
showing the planning date or the publication date would also "show a date",
and both would be wrong — asserting that *a* date appears would pass for
every one of them.

### The fixture that could not tell two implementations apart — again

`CAMPAIGN NUMBERS FOLLOW THE CAMPAIGNS TAB` passed a mutation that numbered
campaigns by first appearance among the posts. With no removed campaigns the
two orderings **agree**, so the fixture had nothing to say — the identical
fault as the money-page fixture whose pages had distinct titles AND distinct
urls.

A removed campaign separates them: the tab puts removed first whatever the
dates, the post list does not care. So a campaign that is removed but whose
newest post is not the newest overall comes out **first** on the tab and
**third** among the posts. `AND THE TWO ORDERS ARE NOT THE SAME ORDER` is that
fixture, and both mutations now fail against it.

**Mutations run, all caught:** numbering BEFORE the filter (the old
behaviour), dropping the number on the campaign line, and putting the created
date, the publication date or a plain "some date" in the Approved column.
92 assertions, green.

## A flat numbered list — 29 September 2026 (plugin 0.11.1)

Edwin, on seeing the fold for the first time: *"I want to remove the heading,
i feel is extra as each field has the name of the campaign and it takes up
space."*

He was describing this, three times over on one screen:

    Toilet Replacement Services — 1 campaign
      ▸ Toilet Replacement Services — 4 of 4 scheduled, 4 live, finished

**Campaigns are almost always named after the page they feed**, so the
money-page heading repeated the row under it. At fifty campaigns that is fifty
headings and fifty rows — a hundred lines to say fifty things, on the screen
whose entire purpose was to stop that.

**The heading went; the grouping stayed.** `by_money_page()` now orders rather
than titles: campaigns feeding one page still come out adjacent, which was the
half worth having. The page is named on the row itself — *"· feeds Slab Leak
Detection"* — **only when it differs from the campaign's own name**, compared
trimmed and case-folded, so nothing is lost and nothing is said twice.

**Rows are numbered 1..N straight through**, his request: a number is
something you can say out loud. That only holds while it is stable, which is
why the numbering counts across groups instead of restarting, why **filtering
does not renumber** (filter to three rows and they still read 7, 19, 31 — a
name that changes when you type in a box is not a name), and why he chose no
pagination: a number that depends on which page you are on is not a reference.

`.ie-row-num` is right-aligned in a fixed `2.2em` with `tabular-nums`, so 9 and
10 put their last digit in the same column and the names below them do not step
right at every tenth row.

### Losing the headings cost the tests their assertion

Two suites counted `<h2 class="ie-group-heading">` to prove the grouping
worked. With the headings gone there is nothing left to count, and "the rows
are all there" does not distinguish grouped from unordered.

**They assert the ORDER now.** `many_running(4, 2)` with both pages retitled
"Emergency Plumber" comes out `0, 2, 1, 3` when keyed by URL and `0, 1, 2, 3`
when keyed by title — so the two implementations produce different output and
the test can tell them apart. Verified by mutation: keying `by_money_page()` on
the title fails exactly that test, and removing the grouping outright fails
five.

That is the general repair for this. **When the thing you were counting
disappears, do not reach for a weaker count — find what the change is actually
supposed to produce and assert that.**

64 / 34 / 9 / 57 — **164**, green.

## The fold went on the wrong tab — 29 September 2026 (plugin 0.11.0)

The fifty-campaign rework (#32) was built into `render_running_tab()` and
nowhere else. Edwin never saw it, and said so: *"I thought you were fixing the
long list of cards (50 campaigns) UI"*.

He was right, and his screen was the proof:

- **In progress: 1 campaign.** `GROUP_FROM` is 4, so the fold never switches
  on. He would have had to run four campaigns at once to see it.
- **Completed: 6 campaigns**, rendered as six full open cards — the exact wall
  of identical boxes the rework existed to kill.

**In progress empties itself as campaigns finish. Completed only ever grows.**
So the fold landed on the tab that never reaches fifty, and the tab that
certainly will was left paging through full cards ten at a time. Backwards,
and easy to miss because each tab's code reads sensibly on its own.

`render_folded_groups()` is now shared by both tabs, and `GROUP_FROM` is the
single threshold: under four, open cards; at four or more, one-line rows
grouped by money page with a filter box.

**The pager went with the cards.** It existed because "62 finished campaigns"
as 62 full cards is unusable — true, and the answer is to stop drawing 62 full
cards, not to show ten of them at a time. As folded rows they fit on a screen
you can scan, and the filter box beats remembering which page it was on. An
old `?paged=3` bookmark now shows everything, which is the right failure; a
test asserts that rather than leaving it to chance.

**"Coming up" was being drawn twice.** An unconditional `render_upcoming()`
followed by `if ( count( $running ) > 1 ) render_upcoming()`, inside a branch
that only runs at four or more campaigns — so the entire schedule table
printed twice on the one screen the fold was built for. Nothing caught it: the
suite asserted the section was *present*. **"It is there" and "it is there
once" are different assertions**, and only the second one catches a
duplicate. The new test was checked against the old code and fails on it.

61 / 34 / 9 / 57 — **161**, green.

## Pause on a finished campaign — 29 September 2026 (plugin 0.10.1)

Edwin's Completed tab, six campaigns, four of four live on every one of them.
Each card offered **"Pause campaign"**, and each heading said **"publishing on
schedule"**.

The heading was only wrong. The button was worse:

1. It set the campaign's status to `paused`.
2. It held nothing back, because there was nothing to hold.
3. It announced *"Campaign paused. 0 scheduled posts were held as drafts."*
4. The next sweep reported `paused` to Three Comets — which **accepts a site's
   word on paused** (`applyReportedStatuses`) — so a campaign that had
   genuinely finished weeks earlier was recorded as paused in the blog report.

**A no-op button that corrupts a record is the worst kind.** Nothing appears
to happen, so nobody goes looking, and the damage is in a different system
from the button.

**The cause, in one sentence: `bucket()` knew the campaign had finished and
the card did not.** The test lived in `bucket()` alone — count the unpublished
slots, plus "cancelled counts as finished" — so `render_campaign_card()` had
no idea which tab it was being rendered on.

`IE_Campaigns::is_finished()` is now the one place that decides, and
`bucket()`, `campaign_headline()` and the card's buttons all read it.

**The second copy nobody had noticed.** The card's `<h2>` built the identical
sentence inline from its own counting loop, while the fold summary called
`campaign_headline()` — and the comment above the `<h2>` claimed both came
from that function. They agreed only by luck, and parted company the instant
`campaign_headline()` learned the word "finished": folded campaigns said it,
open ones (which is what the Completed tab renders) went on saying
"publishing on schedule". The heading calls the function now.

**Hiding a button is not refusing an action.** A stale tab still holds the URL
and the nonce, so `IE_Publisher::pause()` and `::resume()` return
`WP_Error('ie_campaign_finished')` for a finished campaign. Resume matters as
much as pause: resuming a **cancelled** campaign would set it back to `active`
with slots naming posts that were binned — off the Completed tab, onto the
running tab for ever, reporting itself active to the server.

Remove is deliberately still offered. It is the one action that still means
something once a campaign is over, and a guard that took it too would leave no
way to clear the record.

### Two harness faults this turned up

**`IE_Campaigns`'s live-post cache leaked between tests.** `$live_post_ids` is
a static, filled on first use and correct for the rest of a request — but a
suite is one process. A fixture introducing post ids the previous test never
mentioned had every one of them reported deleted, so a campaign with four live
posts rendered *"1 of 4 scheduled, 1 live, 3 posts deleted"* and the failure
read exactly like a bug in the code under test. Tests were calling
`forget_post_cache()` by hand, which works right up to the first one that
forgets. `render()` calls it now: **one render is one request.**

**`test-orphan-links.php`'s `WP_Error` stub threw the message away** and
returned the literal string `'error'` for every failure. Two different guards
in the same function are indistinguishable to a stub like that — the sixth
instance of *a stub that cannot express the failure cannot detect it*.

Suites: deleted-posts 34, topic-merge 9, admin-tabs 60, orphan-links 57 —
**160**, all green under PHP 8.4.

## Every campaign was a draft — 29 September 2026

The day's centrepiece, and the shape of it is worth more than the fix.

**The symptom.** Campaign status = Completed on the blog report returned
nothing. Ever. On an account with twelve posts, all twelve live, both
campaigns finished weeks ago.

**The chain, from the bottom.**

`settleFinished()` only promotes a campaign whose status is `active`.
Nothing was ever `active`. Not one row. Because `utils/blogGenerator.js`, at
the end of a successful plan — *after charging the customer* — did this:

```js
// what it was
const anythingLive = (campaign.slots || []).some(s => s.status === 'ready' || …);
```

`campaign` is the document loaded at the top of the function, before any slot
was written. `markSlotReady()` is a **static `findOneAndUpdate` on the
collection** — it updates Mongo and does not touch that in-memory object. So
`anythingLive` read a list of `pending` slots, came back false, and every
campaign in the system was set back to `draft` the moment it was paid for.

The fix is three lines and re-reads the document:

```js
const fresh = await BlogCampaign.findById(campaign._id).select('slots').lean();
const anythingLive = ((fresh && fresh.slots) || []).some(
  s => s.status === 'ready' || s.status === 'scheduled' || s.status === 'published');
```

**A stale in-memory document is not a cache. It is a different answer to the
same question.** If a static writes to the collection, nothing you were
holding before that write knows about it.

**Why one fix was not enough.** The completion check inside
`/api/blog/published` carried the *same* `=== 'active'` condition, so it had
never fired either. Widening `settleFinished()` to
`{ $in: ['active', 'writing', 'draft'] }` fixed both — but only for campaigns
that would be swept in future. The twelve posts already live needed a third
fix (below), and it took all three before the report said
"2 campaigns · 12 posts · 12 confirmed live".

**How it was actually found.** Not by reading code. Two guesses were wrong
before Edwin supplied the server log — `{"statuses":0,"finished":0}` — and the
CSV export, which had `campaign_status: draft` on **every single row**. That
column is what turned a hunt into a diagnosis. The same lesson as the licence
bug the day before: *ask for the data before theorising twice.*

### A gate that guards a payload must be computed from that payload

`campaign_report_due()` in `class-ie-campaigns.php` decided whether the sweep
had anything new to say by comparing a fingerprint of campaign **ids** against
the one last sent. But the payload had grown to carry `{id, status}` pairs.
So a campaign that changed from active to paused produced an identical
fingerprint, the gate said "nothing new", and the pause never reached Three
Comets. Nothing logged, nothing failed.

The fingerprint now builds `'id:status'` strings — unique, sorted — so it is
derived from exactly the bytes it is gating. Shipped as plugin **0.9.2**.

**Whenever a "has anything changed?" check sits in front of a send, check that
it is hashing the thing being sent, not an older, smaller version of it.**

### A truth you can derive from your own data should never wait on someone else's news

Even with the gate fixed, the twelve already-published posts stayed
`draft` — correctly, because the plugin had nothing new to report and the
sweep stayed quiet. The settle only ever ran on the back of an inbound call.

But "every slot in this campaign is published, therefore the campaign is
completed" is a statement about rows Three Comets already owns. It needs
nobody's permission. So the report page now read-repairs on load:

```js
await BlogCampaign.settleFinishedForUser(req.user._id);
```

before `rowsFor()`. Opening the report fixes the report.

**Events need sweeps behind them — this is now the fifth instance** (deleted
posts, removed campaigns, `/api/blog/published`, pause/cancel status, and the
settle). The pattern is settled enough to assume: any state that arrives by
notification needs a second path that derives it.

## Remove means remove — 29 September 2026

Edwin's call, and it changed the feature: *"removing a campaign should remove
even the articles belonging to the campaign that got published. The user will
have to start over."*

Before this, Remove deleted the campaign record and left the posts standing —
which is why the report had to invent a whole vocabulary for "posts whose
campaign is gone". Now `remove_campaign()` trashes the lot, and the order is
load-bearing:

    trash the posts
      → flush_deleted_reports()      (tell the server while the records exist)
        → IE_Api::removed()
          → IE_Campaigns::delete()   (only now destroy the local record)

Reverse any two of those and the server is told about a campaign whose posts
it cannot name, or is never told at all.

**The confirmation is two dialogs, not a checkbox.** Edwin rejected the
opt-in ("also move 4 published articles to Trash") for a specific reason: a
box the user does not tick leaves the articles behind, which is the outcome
the redesign existed to remove. So:

1. *Remove "Water Softener Installation"? This moves 4 published articles and
   8 drafts to Trash. You can restore them from Trash for 30 days.*
2. *Are you sure you want to send 4 published articles and 8 drafts to Trash?*

`onclick="return confirm('…') && confirm('…')"`. Two suites assert there are
**two**, and that the singular reads properly.

Also his: **"paused", not "stopped"**, everywhere in the UI. And a campaign
that is paused and then has its drafts deleted is closed out as
**`cancelled`**, not `completed` — `abandon_remaining()` sets that and clears
`paused_at`, so the report can say *Was cancelled* rather than pretending the
run finished.

`applyReportedStatuses()` accepts `active`, `paused`, `cancelled` from a site.
It will **not** accept `completed` — that is Three Comets' conclusion to draw,
from slots it can count, not a site's claim.

### Removal is a DATE, not a status

`removedAt`, never `status: 'removed'`. This is the reason "completed, then
deleted from WordPress in October" and "cancelled halfway, then deleted in
October" stay tellable apart. `campaignStatusOf()` is therefore deliberately
**blind to `removedAt`**, and the Removed option in the filter is handled as a
separate clause in `keep()`.

The cost is one odd-looking branch. The payoff is that Campaign status
"Completed" + Post state "Campaign removed" composes into a question no single
merged dropdown could ask. Do not "tidy" this by folding removal into the
status list.

### The dead placeholder, and why it never showed up

A post published in March cannot link to one publishing in June, so it carries
`<span data-il-link="slot-3">phrase</span>` and `IE_Links::activate()` swaps it
for an `<a href>` when slot 3 goes live. **If slot 3 never goes live, that span
renders as ordinary prose.** No broken link, no 404, nothing in any log. The
only symptom is a link you were paying for that does not exist.

`on_transition()` used to `return` when the campaign record was missing, so a
removed campaign's later publish orphaned every placeholder pointing at it.
Now it falls back to a `_ie_campaign` meta query (`MAX_ORPHAN_SIBLINGS = 100`).
`repair_links()` (`MAX_REPAIR_POSTS = 200`) is the catch-up pass for posts
already stranded.

**Repair ran clean on Edwin's seven removed campaigns, and that was correct,
not a failure.** All seven were removed on 28 September, after their posts had
published between 3 and 20 September — every swap had already happened. A
"Nothing to repair" result is only meaningful once you can say why.

## The blog report grew a second tab — 29 September 2026

`routes/blogReportRoute.js`, ~83 tests, plus `utils/blog/reportFilters.js` for
the pure parts.

- **Two tabs**, `campaigns` (default) and `posts`, riding in the URL so a
  bookmark opens where it was sent from.
- **Campaigns are grouped by `row.campaignId`, not name+site.** Three of
  Edwin's campaigns share a name on one site — re-planning a money page does
  it — and grouping by name showed "4 removed" beside "6 removed campaigns"
  on the same line. One id, one row, one source for the count.
- **A post state asked from the campaigns tab switches to the posts tab.**
  Choosing "Deleted from site" and pressing Filter used to change the numbers
  in a table of campaigns and nothing else, which looks exactly like a button
  that did nothing. Nobody picks a post state wanting a list of campaigns.
- **Campaign status filter**: Any / In progress / Paused / Completed /
  Cancelled / Removed.
- **Check posts** button per campaign row, linking by `campaignId`.
- LIVE column shows `—`, not `0`, for a removed campaign. *Unknown is not
  zero* — "0" beside "12 posts" is a worse lie than the caution it was
  guarding.

**The empty state twice ate the page.** `if (!rows.length)` served the
brand-new-account message for *any* zero-row result, so a filter matching
nothing removed the filter bar that set it — leaving no way back except the
browser's Back button. Split on `anyFilter(f)`. Then the tabs were added and
it happened again, because they were inside the same branch. **An empty result
and an empty account are different pages.**

Related, same shape: **dropdowns built from the filtered rows** emptied
themselves at exactly the moment they were needed. They are built from all
campaigns and sites now.

**"Links to" was blank on every row this report had ever produced.**
`pageName()` read `targetPage.title` — which is not in the schema. It reads
`title || keyword || ''` now. A field name that is never checked against the
model is a silent blank, not an error.

## Fifty campaigns in the plugin — 29 September 2026

`class-ie-admin.php`, `const GROUP_FROM = 4;`

Below four campaigns, nothing changes — open cards, as before. At or above,
`by_money_page()` groups them **by URL, not title** (two money pages can share
a title), each campaign folds into
`<details class="ie-campaign-fold" data-ie-search="…">`, and
`render_campaign_filter()` adds a client-side box that hides non-matching rows
*and* the group headings that empty out. "Coming up" is untouched — it does
not grow with campaign count.

`test-admin-tabs.php` was brought back from the dead first (it had drifted to
6 passing / 23 failing) because it is the only harness that can actually
RENDER this file. Reworking a screen with no net under it was the thing to
avoid.

## Four test-harness lessons, all paid for on one day — 29 September 2026

**1. A stub that cannot express the failure cannot detect it.** Six times:
`get_posts` ignoring `post_status`; `updateOne` requiring `site`; no `$in`
match on status; `removedAt` dropped in the `_id.$in` branch;
`campaigns_present` `strval`-ing an array into the string `"Array"`;
`settleFinishedForUser` missing from the model stub entirely. Every one of
these made a test pass while the real thing was broken. **When a test passes
first time on a bug you have not fixed yet, suspect the stub.**

**2. Counting a string that appears in more than one place.** Four times:
the card counter counted labels (which then also appeared in the dialog, so it
reported double); `ie-campaign-fold` appears in the JS as well as the markup;
`text-danger` is on the removal date as well as the status; campaign labels
appear in dropdowns as well as rows. Anchor the count on something that
appears exactly once per thing — `action=ie_delete_campaign`, for instance.

**3. "The two counts agree" is not an assertion.** Both can be wrong
together, and were.

**4. PHP 8 `TypeError` is an `Error`, not an `Exception`.** The harness caught
`Exception`, so one crashing test killed the whole run and printed no summary
at all — which on a fast scroll reads exactly like a pass. Catch `Throwable`.

## Small things worth not rediscovering — 29 September 2026

**`esc_js()` does not escape `<` or `>`.** A campaign label containing a
`<script>` tag reached an `onclick` intact. `wp_strip_all_tags()` before
`esc_js()`.

**Contrast is computed, not eyeballed.** Edwin: *"Is this the actual
outline-success color or did you add a different color? It looks like disabled
color."* Bootstrap's `#198754` on the app's `#082d5b` is **3.02:1** — it
genuinely is too dark, and the eye was right. `.btn-outline-success` is
overridden in `utils/appHeader.js` to `#5ddc95`, which every logged-in page
inherits.

**Anchor mixes, because these get confused.** Two different systems:

| | mix |
|---|---|
| Blog campaigns (`utils/blog/anchors.js`) | exact 30 / semantic 40 / descriptive 20 / **branded 10** |
| Site generator (`utils/homeAnchorPool.js`) | exact 40 / semantic 40 / descriptive 20, **naked 0%** |

The naked URL Edwin found on emergencyplumberaustin.net is **old output, not
a live bug**. The rule it came from was deliberate and is documented in the
code it replaced: *1–2 pages → every page uses the naked URL; 3–10 → the first
uses the business name, the rest naked; 11+ → the first two.*
`buildRankFastLinks.js` was rewritten on **19 September**; anything generated
before that keeps its naked URLs, because static HTML does not fix itself.

**Plugin 0.10.0 is live.** All four PHP suites pass in a PHP 8.4 container:
`test-deleted-posts.php` 34, `test-topic-merge.php` 9, `test-admin-tabs.php`
52, `test-orphan-links.php` 52 — 147 in all.

## One licence, two sites — 27–28 September 2026

The most expensive bug in this system so far, and it had been running for
eight days before anyone looked at a log.

**What it did.** A licence key was pasted into a second WordPress. Activation
mints a fresh secret on every call, so the second site worked immediately and
the first one died — every request refused, for ever, with `Not authorised`
and nothing else. The first site did not fail loudly. It failed invisibly:
twelve "this post went live" callbacks rejected, the server's record quietly
drifting from the site's, and a blog report claiming **26 published posts for
a site carrying 12**.

**How it was found.** Not by reasoning. By this:

```
ssh ubuntu@15.204.123.104 "grep -h 'blog.auth' /home/ubuntu/app/logs/app.log | tail -20"
```

`log.security` goes through pino to `logs/app.log`, **not** to pm2's stdout.
`pm2 logs | grep blog.auth` returns nothing and looks like "no failures".

One `badSignature` per day, on the exact days posts published, on
`/api/blog/published`. That is the whole diagnosis, and it was sitting there
the entire time.

**Do not grep for `reason`.** The OpenAI usage logs contain
`reasoning_tokens`, which drowns the signal. Ask for `blog.auth` instead.

### The order of checks in requireSite is evidence

Worth knowing, because it settled a question nothing else could:

1. headers present → 2. site id shape → 3. timestamp → 4. clock skew →
5. site exists → 6. **status is active** → 7. lockout → 8. **signature** →
9. **site URL matches**

A `site-revoked` refusal happens at step 6 and never reaches step 8. So a
`badSignature` in the log **proves the site is active**. That is how the
hilltophomeloans/roofingamerica muddle was untangled: the failing site id had
to be the active row, whatever the label said.

### siteUrl described a guard that did not exist

`models/BlogSite.js` had said, since the day it was written:

> Compared on every subsequent request: a signature valid for site A must not
> authorise work against site B, even with the same licence key.

`middleware/requireSite.js` never compared it. A comment describing a
protection that does not exist is worse than no comment, because everybody who
reads it stops looking.

**`siteUrl` was written ONCE, at activation** (`routes/blogApiRoute.js`), and
never checked again. So the row's label is a snapshot of whichever install
activated last — which is why a row full of plumbing campaigns from
roofingamerica.xyz was titled hilltophomeloans.net.

### Cloning is the easy way to hit this

You do not have to type the key. The site id and signing secret live in
`wp_options`, so **duplicating a WordPress carries them**. Staging copies,
backup restores onto a new domain, "let me clone this site as a template" —
all of them silently produce two installs sharing one identity, and the one
that activates last wins.

### The fix, in plugin 0.7.0

- `X-IL-Site-Url` on every request. The server compares it to the registered
  domain and refuses a mismatch with **409**, naming the other site.
- **Checked AFTER the signature.** That message is information; only a caller
  already holding the secret may have it. Before the signature, it would be a
  way to ask which domain any site id belongs to.
- **A missing header is not a mismatch.** Plugins older than 0.7.0 send none,
  and refusing them would break every existing customer on upgrade day. A fix
  that is worse than the bug is not a fix.
- Activation refuses to move a licence off a live site without an explicit
  `moveSite` flag — the "this licence is moving from another site" tick box.
  The refusal names the site that would be disconnected, so the box is never
  the first anyone hears of it.
- `Not authorised` is replaced, **in the plugin**, with what to do about it.
  The server stays vague on purpose; the plugin knows it is connected and is
  not a stranger.

### Four refusals were writing no log line at all

`site-revoked`, `missing-headers`, `bad-site-id` and `bad-timestamp` logged
nothing. The single likeliest support call — "my licence was revoked and
nothing works" — left no trace anywhere.

The logging now lives inside `deny()` itself, once, rather than at each call
site where it can be and repeatedly was forgotten.

**Reconnecting does NOT orphan campaigns.** I got this wrong and said the
opposite first. `findByLicenceKey()` returns the **existing** row and replaces
only the secret; `site._id` never changes, so every campaign stays attached.
Re-pasting the key is safe, and it also rewrites `siteUrl` from what the
plugin reports, which fixes a wrong label at the same time.

## Events need sweeps behind them — 27–28 September 2026

The pattern that came up three times in one session, each time as a separate
bug with the same shape.

**An event fires once and nothing retries it. One lost call is permanent.**

| The event | What was lost | The sweep that fixes it |
|---|---|---|
| a post is deleted | nothing was ever sent | reconcile which slots are missing |
| a campaign is removed | only since 0.4.4 | reconcile which campaigns the site has |
| `/api/blog/published` | one bad week = 12 posts stuck "scheduled" | reconcile which slots are live |

### A reconciliation is not a retry

The call says **"these and only these"**, not "here is one more". That shape
is what lets a post restored from the trash lose its Deleted mark. An
events-only design makes deletion a one-way door: trash a post by accident,
restore it thirty seconds later, and the billing record carries the mark for
ever.

A record that can only ever get worse is not a record of anything.

### An empty list is the one message that can destroy a record

A plugin whose options have been lost — partial restore, botched migration,
fresh install on an old domain — reports **zero campaigns**, which is
indistinguishable from a site that has genuinely removed every one.

The second case is already covered, because each of those removals fires its
own callback as it happens. **So the ambiguous message is the one to
swallow.** `campaign_report_due()` returns `null` rather than an empty array
to say "nothing to report", and the route refuses an empty list as well.

### The other guards worth keeping

- **A 30-minute grace window** on `markMissingRemoved`. A campaign is created
  on the server during `/plan` and stored by the plugin when it reads the
  response; in between it exists on one side only. A sweep landing in that
  window would mark a campaign removed on the day it was born.
- **A slot cannot be both live and missing.** If the post is gone, "it
  published" is stale news about something that no longer exists.
- **The date comes from what the server already knows** (`scheduledFor`, then
  `publishAt`), never from the plugin. A WordPress site reports local time in
  its own timezone; our own stored value cannot be wrong by a timezone.
- **Report only when the set CHANGES.** Otherwise a site with one deleted post
  makes an HTTP call every hour for the rest of its life about news the server
  already has.
- **Mark as sent only on success.** One unreachable minute must not become
  permanent silence about a post that really is gone.

### One call per request, not one per post

The delete hooks fire once per post. Bulk-deleting twelve posts fired twelve
separate HTTP calls, back to back, each with a twenty-second timeout, while
the owner's browser waited on all of them. Bulk delete is exactly how someone
clears out a campaign's posts — the common case, not the unlucky one.

The hooks now only note which campaigns are affected; one reconciliation per
campaign goes out at `shutdown`.

**Shutdown also makes the answer honest.** `before_delete_post` fires BEFORE
WordPress does the work — the row is still in the database, and at
`wp_trash_post` the status has not changed yet. Asking "is this post missing?"
there gets "no" about a post that is about to vanish. By shutdown the deed is
done and the site can simply be asked.

### WP-Cron does not reach a finished site

The sweep rides on WP-Cron, which fires on page loads, not on a clock. The
server pings sites with work in flight, and those pings run it for free — but
`findWork()` only returns campaigns that are `writing`/`active` with ready or
overdue slots. **A site whose campaigns have all finished is never pinged.**

That is precisely the site where deletions happen: posts get tidied up months
after a campaign ends. Hence the **Check for deleted posts** button.

## Source greps have now missed four real bugs — 28 September 2026

Add this one to the pile, because it is the worst of the four:

```php
test( 'A TRASHED POST COUNTS AS GONE', function () {
    ok( strpos( $source, "'trash'" ) !== false, ... );
} );
```

The docblock above `post_missing()` said **"TRASHED COUNTS AS GONE"**. The code
asked WordPress for trashed posts, found them, and called them alive. And the
test named after the rule asserted that the string `'trash'` **appeared in the
source** — which is the broken behaviour.

**It passed for weeks by confirming the exact bug its own name forbids.**

The stub could not model post statuses, so behaviour could not be asked about,
so somebody grepped instead. The stub now honours `post_status`, and the test
asks the question directly.

**The running total: four bugs have passed source-grep tests in this codebase.**
`php -l`, `node --check` and real-data tests caught all four.

### And a test can break in the other direction

`test-page-titles.js` has a rule that route files must never spell out the
product name — one constant, not fourteen copies. Its comment says why: *"a
route that spells the name out passes every other test in this file and
quietly survives the next rename."*

During a rename, I typed `"Three Comets Blog Generator"` straight into
`routes/blogSitesRoute.js` and the deploy refused. The test was right and I was
wrong. The plugin's display name is now read from its own `Plugin Name:`
header, the way the version already was.

### Mutation testing found three things this session

- A mutation that **silently failed to apply** (a perl regex that did not
  match tabs) looked exactly like a passing test. Now every mutation asserts
  its anchor was found before rewriting. **An unproven test is worse than no
  test.**
- A stub that compared `query.user` unconditionally meant removing the
  ownership guard made the stub match nothing and fail the *wrong* tests. A
  field the query does not mention must not be filtered on — that is how Mongo
  behaves, and the only way a stub can detect a guard being removed.
- Three mutations passed before one failed, on the "older plugins still work"
  case, because it is guarded twice. Both guards had to go before the test
  noticed.

## The plugin, 0.4.2 → 0.8.0 — 27–28 September 2026

| | |
|---|---|
| 0.4.2 | "Waiting for you" → "Campaigns needing approval" |
| 0.4.3 | notices a deleted post, greys the row, stops the false Overdue alarm |
| 0.4.4 | tells the server when a campaign is removed |
| 0.4.5 | no "Publish early" on a deleted row — link **and** handler |
| 0.5.0 | reports deleted posts to the server at all |
| 0.5.1 | one call per request; the Check for deleted posts button |
| 0.6.0 | reports which campaigns the site still has |
| 0.7.0 | one licence, one site — enforced |
| 0.7.1 | reports which posts are live |
| 0.7.2 | renamed to Three Comets Blog Generator |
| 0.7.3 | sidebar says "Three Comets" |
| 0.8.0 | the topic button adds instead of replacing |

### wp_update_post returns 0, not a WP_Error

For a missing post id it answers `0`. So `is_wp_error()` waves it through and
the handler **reports success** for a post that does not exist. 0.4.3 fixed the
state pill and left the action column alone, so six dead rows each kept a
working "Publish early".

### get_edit_post_link returns null for a missing post

`esc_url( null )` is `''`, so the row renders `<a href="">`, which reloads the
same page. Somebody clicking it learns nothing at all — worse than it plainly
not being clickable.

### "Overdue" is the WP-Cron alarm

A deleted post raising it sends people after a scheduler that is working
perfectly. Deleted must be checked **before** the stored status in every
branch, because the stored status is exactly what stops being true.

### What renaming a plugin may and may not touch

Display name, menu label, download filename: free.

**Never rename:**

- **the folder** — WordPress identifies a plugin by its directory. Rename
  `interlink-engine/` and the next upload installs a SECOND plugin beside the
  first: old one active, new one deactivated, no error anywhere. On a
  customer's site that reads as nothing happening.
- **`ie_campaigns` / `ie_settings`** — that is every campaign on the site.
- **the menu slug** — `page=interlink-engine` is in bookmarks and in the
  plugin's own redirects.
- **the text domain** — every `__()` names it.

A display name is cheap. An identifier is not, and the two are only ever
confused once.

### "Suggest different topics" replaced what was on screen

The word "different" was accurate and nobody read it that way. The obvious
move when you want twelve posts is to press it twice, and pressing it twice
left you with six — so the only route to a year of posts was to type all
fifty-two by hand, which is the work the button exists to avoid.

It now **adds**, asks for **12** (the server's ceiling in
`routes/blogTopicsRoute.js`; it was only ever asking for 6), reads topics from
the **form** so edits survive, refuses duplicates case-insensitively, and stops
at **52**. When it caps it keeps the EARLIER topics — those are the ones that
may already have been edited.

`IE_Admin::merge_topics()` is deliberately pure so
`wp-plugin/test-topic-merge.php` can test it without WordPress. The handler
around it needs nonces, transients and redirects, and the harness that could
render those has been broken for weeks.

## The blog report — 27–28 September 2026

`/blog-report` and `/blog-report.csv`, one row per slot across every site.

- **The page and the CSV share `rowsFor()`**, and a test enforces it. A report
  and its export disagreeing is the kind of thing nobody notices until a
  customer quotes one at you. **Any filtering must go inside `rowsFor()`.**
- **CSV injection guard:** a field starting with `= + - @` executes as a
  formula in Excel. These fields come from a customer's WordPress.
- **`EXCEL_BOM` is written as an escape, not the character.** A raw U+FEFF
  inside a string literal is invisible, and any editor or paste could drop it
  with nothing visible in the diff.
- **`deletedAt` is a DATE, not a status.** `status` is the record of what the
  slot DID — written, charged for, published — and all of that stays true
  after the post is deleted. "Published then deleted" and "never published"
  must never collapse into one value: the first was paid for and the second
  was not.
- **Deleted is checked before the stored status** in `slotPill()`, for the same
  reason as in the plugin.
- **The column-count test strips comments first.** It counts commas in source
  text, and prose is full of them — a comment inside the array failed a
  correct change, and could as easily have hidden a real mismatch.

**Still wrong, and known:** the headline counts posts under removed campaigns
as published. On roofingamerica that is 26 of 48 for a site carrying 12. The
split — `12 published · 36 under removed campaigns · 0 scheduled` — is
outstanding.

## Reading the answer back — 28 September 2026

`device_commit_files` returned `"written"` for a change to
`routes/blogReportRoute.js`. The change was not there. Something on the Mac
re-saved the file afterwards — most likely an editor writing a stale buffer.

**The receipt is not the outcome.** Stage the file again and grep it. It costs
one call and it is the difference between "I changed it" and "it is changed".

## Three wrong diagnoses before the data — 27 September 2026

The plugin was showing six overdue posts. In order, I claimed: WP-Cron had
stopped; the licence had been revoked; then finally the truth — **the posts had
been deleted**, which was Edwin's own first guess.

What settled it was not more reasoning. It was:

- Posts → All Posts: **12 items, all Published**, no drafts, no trash
- the campaign screens claiming **19**
- none of the overdue titles existing
- Water Softener's posts, scheduled 13–17 Sep, all published **19 Sep 02:06** —
  five in one minute, which is `publish_missed()` catching up, which means
  **WP-Cron works**

Campaign records live in `wp_options`, separate from the posts, and nothing
watched whether the post still existed.

**When a screen and a database disagree, stop theorising and go and count
something.**

## Server patched and rebooted — 24 September 2026

Twelve days of "needs a quiet moment" turned out to be twenty minutes. Write
down the recipe so the next one is not another twelve days.

**Look before touching.** The single question that matters is whether the app
comes back on its own:

```
ssh ubuntu@15.204.123.104 'apt list --upgradable 2>/dev/null | wc -l; \
  systemctl is-enabled pm2-ubuntu; systemctl is-enabled nginx; \
  systemctl is-enabled mongod 2>&1'
```

`pm2-ubuntu` must say **enabled** — that is the systemd unit that resurrects
pm2 after a reboot. Without it the box comes back and the site stays down
until somebody SSHes in. `mongod` says `not-found`, which is the right answer:
the database is Atlas, so a reboot cannot touch the data.

**The upgrade, with the flags that matter over SSH:**

```
ssh ubuntu@15.204.123.104 'sudo DEBIAN_FRONTEND=noninteractive apt-get update && \
  sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -o Dpkg::Options::="--force-confold"'
```

`keyboard-configuration` and `console-setup` throw a full-screen purple
config dialog when they feel like it, which on a remote box is a good way to
hang the session with the package system half-configured.
`DEBIAN_FRONTEND=noninteractive` suppresses it and `--force-confold` keeps the
existing config files instead of asking.

**Reading the output.** Two lines look alarming and are not:

- *"The following upgrades have been deferred due to phasing: apparmor
  libapparmor1"* — Ubuntu's staged rollout, not a failure. They arrive on
  their own in a few days.
- *"User sessions running outdated binaries: PM2 v7.0.3"* — the Node upgrade.
  The running process holds the old binary in memory until it restarts, which
  is what the reboot is for.

**Then reboot, wait a minute, and check all four things:**

```
curl -s -o /dev/null -w "site: %{http_code}\n" https://threecomets.com && \
  ssh ubuntu@15.204.123.104 'uname -r; node -v; pm2 list'
curl -s -o /dev/null -w "login: %{http_code}\n" https://threecomets.com/login
```

Verified on the night: kernel `6.8.0-142-generic`, node `v22.23.3`, webgen
online with **restart count 0** — a resurrect rather than a crash loop, which
is the difference the count tells you — root `302` to the login page, and
`/login` itself `200`. **Check `/login` and not just `/`.** A root that
redirects proves nginx is up; it does not prove the app is rendering anything.

31 packages, none of them nginx, no kernel package in the list (the pending
kernel had been installed earlier and was only waiting on the boot). Two
orphans, `libfwupd2` and `libgusb2`, are still there for `apt autoremove`
whenever somebody cares.

## Stripe went live — 24 September 2026

**The app takes real money.** Verified end to end: a $10.00 starter pack bought
with Edwin's own card, credited automatically, then refunded.

```
{"event":"billing.webhook.credited","userId":"6a85…","packId":"starter",
 "credits":1000,"amountCents":1000,"creditsAfter":9400,
 "stripeSessionId":"cs_live_…"}
```

**`cs_live_` is the proof, and it is the only proof worth trusting.** A test
and a live purchase look identical on screen — same Thank You page, same
balance going up. The session ID prefix is what separates them.

*The two variables, and only two.* `STRIPE_SECRET_KEY` and
`STRIPE_WEBHOOK_SECRET`. **Edwin sets both on the server himself; a live secret
key is never pasted into a session, committed, or written to a local file.**
`pm2 restart webgen` picks them up — `server.js` line 3 is
`require('dotenv').config()`.

**THE TRAP IS THE SECOND VARIABLE.** `STRIPE_WEBHOOK_SECRET` belongs to one
specific endpoint, and live mode has its own endpoint list — the test endpoint
does not carry over. Copy the test signing secret into live and checkout
succeeds while every webhook fails signature verification: Stripe shows the
payment as fine, the customer is charged, and credits are never granted,
quietly. `grep -c 'sk_test_' .env` returning `0` is the cheap check.

*Where things are in the dashboard now.* Stripe renamed two things and both
cost time:

- **Test mode is now "Sandboxes"**, in the account switcher at the top left —
  not a toggle at the top right.
- **Webhooks are now "event destinations"**, under Workbench → Webhooks. The
  creation flow offers **Select all**, which selects 260 events. Do not. This
  app acts on exactly one, `checkout.session.completed`, and ignores the rest;
  260 means hundreds of deliveries the server throws away, and Stripe can
  disable an endpoint that keeps erroring on things it does not handle.

Live endpoint: `https://threecomets.com/api/stripe-webhook`, one event,
destination `we_1UJJr3ApitC70jDG0RM8zQAx`.

*Two things that are NOT a problem, so nobody goes looking.*
`utils/creditPacks.js` passes inline `price_data` rather than stored price IDs,
so there are no test-mode products to recreate in live; and there is no
publishable key anywhere, because billing is a Checkout redirect and never
touches Stripe.js on the client.

**Checking the endpoint without spending money:**

```
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://threecomets.com/api/stripe-webhook
```

`400` is the right answer — the app rejecting an unsigned request, which proves
the route exists *and* that signature checking is on. `404` means the path is
wrong. This leaves a `billing.webhook.badSignature` line in the log, which is
expected and not an incident.

**`grep` over SSH buffers, and it looks exactly like a dead feature.**

```
ssh ubuntu@… 'tail -f logs/app.log | grep billing.webhook'   # prints nothing
ssh ubuntu@… 'tail -f logs/app.log | grep --line-buffered billing.webhook'
```

Without `--line-buffered`, grep holds its output because it is not writing to a
terminal. During the live test this printed nothing at all while the webhook
was in fact succeeding. When a live tail is silent, read the file directly
before concluding anything:

```
grep billing.webhook /home/ubuntu/app/logs/app.log | tail -20
```

## White text on light cards — 24 September

Both found by Edwin creating a fresh account and looking at it. Neither could
be seen from the admin account, which is the point.

**The blog card's small print was white on a light card.** `routes/authRoute.js`
— `class="text-white-50 small"` inside a `bg-secondary-subtle` card, so
"Works on any WordPress site..." rendered white on near-white. Now
`text-muted`, matching the site card's subtitle.

**IT ONLY RENDERS FOR SOMEBODY WITH NO WORDPRESS SITES.** The admin account has
sites connected, so that paragraph never appeared for it and the fault was
invisible to the only person who ever looked. A whole class of bug lives in
the branches a developer's own account never takes.

**The dashboard's loading curtain was pale with white text on it.** `#overlay`
— the full-screen layer behind "Building your WordPress theme... please wait",
shown by the two download buttons on a site card. It read
`background: rgba(228, 219, 219, 0.8)` with `color: #fff` and a
`.text-light` spinner: everything on it was invisible, so the page looked
frozen for the minute a build takes. Now `rgba(8, 45, 91, 0.9)` — the page's
own navy at 90%, so it reads as the app dimming itself.

**Not to be confused with the wizard's overlay**, `#loading-overlay` built in
`public/js/spinner.js`, which has always been `rgba(0,0,0,0.75)` and was never
the problem. Two overlays, two files, one of them fine.

**A comment that contradicted its own code** sat four lines below the first
fix: "text-white is required" above a line saying `text-dark`. Corrected. The
reason is the mirror image of what it claimed — the card is light on a navy
`<body class="text-white">`, so without an explicit colour the contents
inherit white and vanish.

**A COMMIT THAT REPORTED SUCCESS AND DID NOT HAPPEN.** The overlay fix was
written to Edwin's Mac, the write returned `written` with nothing rejected,
and the file on disk was unchanged — so the deploy that followed carried the
first fix and not the second. It was caught by grepping the SERVER, which
returned 0, and then the Mac, which returned 0 as well. Writing a file is not
evidence that the file changed: check the size or grep the content back,
especially when writing the same file twice in a row.

## The password eye and the phone — 24 September

Found by looking at one screenshot of the log-in page.

**`login.html` and `signup.html` had no viewport meta tag.** Every other page
in the app has one. Without it a phone lays the page out at about 980px and
scales it down, so the form arrives too small to read and has to be
pinch-zoomed before it can be typed into. **Bootstrap's responsive grid does
nothing whatever until that tag is present** — the `col-md-4` on those forms
was decorative. That one tag is the whole of "is this page responsive".

**`public/js/passwordToggle.js` builds the show/hide button rather than the
markup carrying it.** There are six password fields across four pages: log in,
sign up, and the two spellings of the reset form, each with "New password" and
"Confirm new password". Hand-written markup would be the same input-group six
times and a seventh field next year silently without one. The script finds
them instead: a page gets the behaviour by loading the script, a field gets it
by existing. Three `<script>` tags — the two views and the reset shell, which
also covers "check your email" and "link expired" (it does nothing when there
is no password field).

**`type="button"`. NOT OPTIONAL.** A `<button>` inside a `<form>` with no type
attribute defaults to SUBMIT — the eye would have posted the login form on the
first click, before the password was finished. It would have looked like the
site logging you out.

**No JavaScript means an ordinary password field, not a dead control.** The
markup is untouched, so the form submits exactly as before and the button is
the only thing that does not appear. Nobody is locked out of their account
because a script failed to load.

**The caret goes back where it was.** Changing an input's type sends it to the
end in every browser. Somebody who typed eight characters, spotted a typo in
the third and pressed the eye should not then have to find their place again.

**Inline SVG, no icon font.** These pages load Bootstrap's CSS and nothing
else. One glyph is not worth a second network round trip on the page somebody
is trying to log in from.

**`test-auth-pages.js` RUNS the script instead of only reading it.** The first
twelve tests are regexes over source, which is the kind this file has been
burned by — one asserted the word "total" appeared in a function and passed
happily after the total was deleted from the output. So eight more run the
real script against a hand-written DOM stub: click the button, check the type
flipped, check the caret came back, load the script twice and check there is
still one eye. **No jsdom** — a dependency behind a deploy is the failure
`deploy.sh` opens with a warning about. 20 tests, 13 mutations caught.

## Suggested location pages — 22 September

The other half of the suggestion work. Same panel, same budget-driven
pre-ticking, **completely different engine.**

### It asks no model, and that is the whole point

A model asked for the towns near Leander answers confidently and wrongly:
places a hundred miles off, places in the next state, places that do not
exist. The errors are the dangerous kind — plausible names nobody thinks to
check, that become pages for a service area the business does not cover.
Edwin's own screenshot made the case: a location page for Dallas on a site for
a Round Rock business, 190 miles.

So `utils/nearbyPlaces.js` reads a gazetteer and does trigonometry. No tokens,
no rate limit, no network, same answer every time.

**The data is `all-the-cities`** — the GeoNames cities1000 export, every
populated place with 1,000+ people, with coordinates, population and state.
16,677 US places after filtering. **The package is MIT; the DATA is GeoNames
under CC BY 4.0 and wants attribution.**

That credit is **under the suggestion panel on step 7**, appearing with the
first list. Not a footer: a line where the data is used is seen by whoever is
looking at the towns, and a footer credit is the version that satisfies the
licence without satisfying the point of it. It stays hidden until a list
exists, because crediting a dataset on a screen that has not used it is noise.

It goes on the app, NOT on the generated sites. Those come out with a few town
names in them, and a place name is a fact rather than somebody's dataset — the
dataset is what the wizard uses.

### What is and is not a town

Feature codes PPL, PPLA, PPLA2, PPLA3, PPLC. Left out: **PPLX, which is a
district inside a city.** A page for a district of Austin is a different play
from one for a suburb, and mixing them makes the choice harder rather than
richer. The test fixture for this is Bel Air, MD, whose nearest populated
place is *North Bel Air* — with the filter gone it becomes suggestion number
one, a location page for part of the town the home page already covers.

**No population floor beyond the dataset's own 1,000.** Small nearby towns are
often the best targets — low competition, real searches. What makes a place a
bad target is nobody searching for it, which population only roughly predicts.
So the list shows **distance and population on every row** and lets the
customer judge; that call is theirs.

### Ordered by distance, not by size

The nearest town is the one the business most plausibly serves. Sorting by
population would put the big city first and the actual neighbours below the
fold.

`DEFAULT_RADIUS_MILES = 60`, which only ever bites in the country: a suburban
business fills its twenty long before reaching it, and Alpine, Texas has three
towns inside it — which is the honest answer, not a reason to pad the list.

### Pressing again is free, so there is no two-press cap

The service suggester caps at two because each press is a model call. This one
is a sort. The page sends back every town it has already **shown**, so the
next press returns the next nearest ones.

**`shown` and `existing` are different lists and must stay that way.** Rows on
the form (`existing`) are excluded AND counted against the balance, because
each is 100 credits committed. Towns merely displayed (`shown`) are excluded
from the results only — an unticked box has bought nothing.

### The rows belong to another file

`locationPages.js` owns `addLocationInput()` and the delete button, and it
listens on `document`. So the panel tags its rows and listens in the **CAPTURE
phase** — the same trick the location credit gate uses, and for the same
reason: to run before a handler in a file this one does not own, while the row
still exists to be read.

Turning the toggle off empties the list, so that handler unticks everything
too.

### Four things mutation testing found here

- **The Austin–Dallas distance test proved nothing.** Flat trigonometry on
  radians gets a north-south pair right to within a few miles. The cos(lat)
  term only shows up east-west: Seattle to Spokane is 228 miles and comes out
  at 338 without it. The fixture is that pair now.
- **Three guards in `findPlace` were dead.** Stripping full stops, checking
  the state code was two characters, checking it was non-empty — the catch-all
  regex and the state filter already did all of it. Removed rather than
  documented.
- **A test slice found the wrong handler.** Two `button.addEventListener`
  click handlers exist now; the service suite's assertions were reading the
  locations one. They are scoped to their function.
- **`affordableLocationPages` is untestable until the prices diverge.**
  SERVICE_PAGE and LOCATION_PAGE are both 100, so swapping one for the other
  changes no answer. Documented in place rather than papered over.

## The draft after a trip to buy credits — 21 September

Someone runs out of credits mid-form, buys more, and comes back. Two gaps,
both there since the draft was built, both found while checking that the step
split had not broken it.

### It landed them on step 1

The draft saved the answers but not the step, so they clicked Next through
everything to get back.

**It cannot simply return them to where they were, because THE LOGO CANNOT BE
RESTORED.** Browsers do not let JavaScript set a file input's value. Dropping
somebody back on the service pages would mean a refusal at submit for a field
three steps behind them, with no hint of which one.

So `draftResumeStep()` returns the LOGO step, or wherever they were if that is
earlier — everything before it is already filled in, the logo is the one thing
that has to be done again, and it is the last point from which the rest of the
wizard still makes sense. Six clicks becomes three. The restore notice says so
plainly, because landing on a screen asking for a file you thought you had
chosen otherwise reads as the form having lost it.

**`Math.min(was, STEP.LOGO)` is the whole upper bound.** An `was >= steps.length`
check was there too; mutation testing showed it changed no outcome, because the
floor already caps anything past the logo step. Removed rather than documented.

**Start Over still goes to step 1.** It shares the job of choosing a step and
must not follow this to the logo: starting over means starting over.

### The suggestion lists were not saved

`suggestionBatches` was not in the draft, so the ticked services came back as
rows with no tick boxes above them — the orphaned-row problem the Delete button
had, reached by a different route — and the two presses were silently handed
back. Saved now, with `suggestionsFor` beside it: without that, the lists are
cleared on arrival because the business type they were for looks like it
changed.

## Locations are their own step — 21 September

Service pages and locations shared step 6. With the suggestion panel above the
rows it read as a wall, so locations became **step 7**.

**The step numbers do NOT differ by site mode.** An earlier note in this file
said they did; that was wrong. `stepNumber()` is `step + 1`, `go()` skips
nothing, and all three modes walk the same list — which is why the split was
mostly mechanical.

### The rule the whole split rests on

**Every path out of a step writes that step's values into `state`, in both
directions.** `savePages()` and `saveLocations()` exist for that and are called
from Back as well as from Next.

It matters because `currentPageNames()` and `currentLocationNames()` read the
DOM first and fall back to `state`. While both lists shared a screen the
fallback was a safety net. Now that only one is ever on screen, **it is the
only source the other has** — and three things depend on it: the credit quote,
the service-suggestion call, and the draft saved on the way to buy credits.

`savePages()` returns early when the rows are not on screen. Without that it
would read an empty NodeList and write it to `state.pages`, erasing the work in
exactly the situation it exists to protect.

### The parts that had to travel, not just the markup

- **The location credit gate.** It intercepts `#addLocationBtn` in the CAPTURE
  phase because the real handler lives in `locationPages.js`. Left behind it
  would never fire and locations could be added past the balance in silence.
- **The submit-time guards.** A duplicate city or an empty list used to call
  `go(STEP.PAGES)`; they now go to `STEP.LOCATIONS`. Otherwise someone lands on
  the service pages reading a complaint about a city they cannot see.
- **The review card's locations row** and **Back from review**, both repointed.
- **The hidden-mirror block**, which moved with the submit handler. Each list is
  mirrored only when its inputs are NOT in the DOM — after the split that is
  always, so what used to be the exception is now the normal path.

## Suggested service pages — 21 September

**The problem was the typing, not the ideas.** A Rank Fast site wants twenty-odd
service pages and every one of them used to be a row somebody filled in by
hand. Most people stopped at five. The site they paid for came out smaller
than it should have been.

Pressing **Suggest services for me** on step 3 calls `/api/suggest-services`,
which asks the model for twenty names ordered by how commonly the trade is
actually hired for them, and returns them as tick boxes above the rows.
Ticking one calls the existing `addPageRow`, so nothing downstream changed.

**Twenty, and no more.** Past that a model stops naming services and starts
restating the ones it has already given. A longer list is a worse list.

### How many boxes come back ticked

`affordableServicePages()` in `utils/pricing.js`, from the SERVER's copy of the
balance. Edwin's worked example: 300 credits ticks exactly one box — 200 for
the website, 100 for the page.

It is **not** `(credits - 200) / 100`. The website base is owed once, rows
already on the form are already spoken for, and a location page costs the same
as a service page out of the same balance. It lives in `pricing.js` with
`quote()` for the reason that file exists at all: two places computing a price
are two prices, and they only have to disagree once.

**The balance is never read from the request body.** A client-supplied number
would let anyone tick twenty boxes from the console and arrive at `/generate`
owing credits they do not have. There is a test for this.

### What Edwin asked for, in his words

> "I want the list to show even if the user don't have the budget but if the
> user tick a checkbox or manually type service in the input to add services it
> should let the user know he doesn't have enough credit."

So the full list is always shown and every box is tickable. Ticking one past
the budget runs the same gate `+ Add page` runs — the credits modal, the saved
draft, the trip to buy credits and back. Nobody is told what they cannot have
before they have seen it.

### The list is filtered before anyone sees it

Every name becomes a page somebody PAYS 100 credits for, with a URL, a title
and an `<h1>`. `cleanServices()` drops:

- **the business's own category.** "Plumbing Services" on a plumber's site
  competes with the home page for its own term — the cannibalisation this app
  exists to avoid, and a model offers it constantly. An exact-match ban list
  does NOT work here: the first version banned "Quality Service" and let
  "Quality Workmanship" straight through. The rule is subtractive instead —
  strip the empty words and see whether a job is left.
- **names that become the same FILE**, via the form's own `slugCollisions`.
- **names that merely mean the same thing**, via the form's own
  `similarServices`. Reused rather than reimplemented, so the suggestion list
  cannot contain a pair the very next screen would warn about.
- **anything already on the form.** The rows the customer has typed ride
  through both checks alongside the suggestions and are sliced off at the end,
  so a suggestion is never offered back to them and never displaces their own
  typing. They are also named in the prompt, which is cheaper than asking for
  extra and throwing the repeats away.

### The tick box and the row are one thing

Edwin, the day it shipped: unticking removes the row, but pressing **Delete**
on a suggested row left its box ticked over a row that no longer existed — and
there was no way back, because ticking an already-ticked box fires no event.

He offered two fixes: disable Delete on suggested rows, or tie the two
together. **Tied together.** Disabling Delete takes away a control that works,
in the one place everybody looks for it, and it traps anyone who EDITS a
suggested row — rename "Drain Cleaning" to "Drain Cleaning and Jetting" and the
only way to remove it is a box whose label no longer matches.

**They are linked by an id, not by the text in the field.** Each row carries
`data-suggested="<key>"` and each box `data-key="<key>"`, where the key is the
name lowercased and reduced to `[a-z0-9-]`. Matching on the text was the first
version and it breaks the moment somebody edits a row. It is also why the key
is normalised: it goes straight into an attribute selector.

A suggestion the customer has already typed **adopts their row** rather than
adding a second one, so from that point it behaves like any other pair.

### Two lists, and no third — 21 September

Pressing Suggest a second time used to REPLACE the panel, so the rows from the
first batch were left with no box above them: ticked services the customer
could no longer untick. Edwin found it the same day. A second batch is now
**appended below the first**, under "A few more:".

**Two batches, then the button stops.** Forty names is more than any business
has; past that somebody is browsing rather than building, and each press is a
model call that costs money and produces nothing. The rest get typed in, which
is what the form was always for.

**This cap is in the browser, so it is an interface decision, not a spending
control.** Anyone who can press the button can call the endpoint directly and
ignore it. The thing that binds is `suggestServicesLimiter`.

**Changing the business type gives the two presses back** and takes away the
rows those suggestions created, keeping anything typed by hand. Plumbing
services are wrong for an HVAC company and so are the rows they made.
`dropSuggestedRows` works off the STORED BATCHES, not off the rows' own tags:
this step is rebuilt from scratch every time it is shown, so the rows come back
from `state.pages` carrying no tag at all.

### A box is ticked because its row exists

Not because of the budget. The budget decides which rows get CREATED, once,
when a batch first arrives; after that the form is the truth.

That is one rule instead of two, and it fixes a bug the two-rule version had:
stepping away from the step and back re-ran "tick the first N", which put back
every row the customer had deliberately unticked. Only a `fresh` batch creates
rows — a restored one just reads the form.

### Why the hourly limit stayed at 15

It was going to drop to 6. With the two-press cap a site costs 2 calls, so 6 an
hour is three sites — and an agency building five in an afternoon would have
been told "too many requests". That is the best customer there is.

The cost difference between 6 and 15 is pennies; the cost of blocking a paying
customer mid-batch is not. **Asymmetric, so the number errs high.** A daily cap
is the right shape if one is ever needed, because it catches a script without
punishing a busy Tuesday — deferred until the logging below says whether any of
this matters.

### The rate-limit message never reached anyone

`express-rate-limit` sends a string message as plain text. The wizard reads the
reply with `res.json()`, which then throws, so it fell back to its own wording
and a rate-limited customer was told "Could not come up with service ideas just
now" — a broken feature rather than "you have used this a lot today".

`retryJson()` wraps the same sentence in `{ error }`. **Only the suggest
limiter uses it.** The blog ones still send text: the WordPress plugin already
handles what they send, and changing that belongs in a pass where the plugin
can be tested alongside.

### What a suggestion costs, measured rather than guessed

`suggestServices()` returns `usage` alongside the list and the route logs
`inputTokens` / `outputTokens` / `totalTokens`. The endpoint is not billed, so
this is the only record of what it costs to run — and the only honest basis for
deciding whether the limits above need tightening.

It is optional on purpose: a stubbed or injected client need not provide it,
and a missing usage block must never fail a call that otherwise worked.

### Two bugs mutation testing found here

**`parseModelJson` returns `{ok, data}`, not the data.** The code read
`parsed.services` off the wrapper, so every reply — valid or not — fell through
to the error branch. The test that should have caught it asserted a rejection
and got one, for the wrong reason. **A rejection test needs a companion
asserting the non-error path exists.**

**"Leave any word carrying a capital alone"** was meant for AC and HVAC. It
also meant a model returning `DRAIN CLEANING` put DRAIN CLEANING on the page.
Length is what separates an abbreviation from shouting; four letters is where
the two groups separate in this domain.

### Three mutations that survive on purpose

Recorded so nobody hunts them again:

- seeding the duplicate check with the form's rows — the slug check catches an
  exact repeat a few lines later with the same reason attached
- title-casing the exclusions before comparing — every comparison downstream
  is already case- and whitespace-insensitive
- the label passed to `parseModelJson` — it only names the file in a warning

The first two are deliberate belt-and-braces and are commented as such.

## Which pages get the header — 21 September

**Every signed-in page, and only those.** The header shows a credit balance
and a Logout button, so on a page reached WITHOUT a session
`currentUserInfo.js` calls `/api/me`, gets a 401 and renders **"Not logged
in"** into the chrome — worse than no header.

    HAS IT     formRoute          the generator
               authRoute          /dashboard
               jobRoute           /jobs/:id and its 404
               billingRoute       /buy-credits, /credits/success, /credits/cancelled
               adminRoute         /admin
               blogSitesRoute     /blog-sites
               exportWpThemeRoute /download-wp-theme
               pluginDownloadRoute  the "Download failed" page

    MUST NOT   passwordRoute      forgot / reset / resend-verification
               downloadZipRoute   no guard on the route
               renderAuthPage     login / signup
               authRoute /verify  reached from an email link, no session

`/verify` is the subtle one: it lives in authRoute.js next to /dashboard,
which DOES have the header, so a file-level check cannot tell them apart.

**TWO WAYS TO RENDER IT, and both are legitimate.**

Pages built inline call the three functions directly, because `res` is in
scope. Pages built through a `page({ title, body })` helper cannot —
`page()` never receives `res`, and the logout form needs
`res.locals.csrfField`. billingRoute, blogSitesRoute and exportWpThemeRoute
have twenty `page()` call sites between them, so instead:

    page()  writes  {{HEADER_ASSETS}} {{HEADER}} {{HEADER_SCRIPTS}}
    send()  calls   withAppHeader(spec.html, res)

One line changed per route file instead of twenty, and the token comes from
the one function that has it. Same placeholder names as form.html on purpose.

**A page that writes the placeholders but whose send() does not fill them
ships the literal text "{{HEADER}}" to the customer.** `test-app-header.js`
checks both halves are present together.

**Still duplicated, and worth doing next:** billingRoute, blogSitesRoute and
exportWpThemeRoute each carry their own near-identical `page()` and an
IDENTICAL `send()`. They differ only in the container width and in
exportWpThemeRoute's `<body>` lacking `text-white`. Extracting one shared
shell is the same move that was made for the header, and that `text-white`
difference is the one thing to resolve first.

## The header's navigation — 21 September

    [ THREE COMETS ]  Build a Website        [Credits] [Buy Credits] [person icon]
                                                                          |
                                                        scottaguirre@yahoo.com
                                                        ------------------
                                                        My Dashboard
                                                        Buy Credits
                                                        ------------------
                                                        Logout

**Left is navigation, right is account and actions.** Two changes made that
split possible, both Edwin's suggestions and both better than what was
proposed to him.

**"Build a Website", NOT "Generator" and NOT "Website Builder".** Generator is
the internal name for the tool. "Website Builder" is a NOUN that names a tool,
so on a button it reads as a label — and it is the category name, which Wix
and Squarespace also answer to. A button takes a VERB: it says what happens
when you press it. "Build" is also the first word of the logo's own strapline,
so the brand's verb and the app's primary action are the same word.

**A BUTTON, on the LEFT.** It shipped as a plain text link for about an hour,
reasoned as "a second button would compete with the yellow Buy Credits one".
Wrong thing to optimise: Edwin looked at it and said it read as a phrase
rather than something clickable. **An affordance nobody recognises is worth
nothing however tidy the hierarchy — discoverability first.**

**Buy Credits is an OUTLINE button because of that.** It was `btn-warning`,
filled yellow, the loudest thing in the header — hierarchy backwards, since
buying credits is a means and building a website is the end. It lives in
`public/js/currentUserInfo.js`, not appHeader.js, so the two buttons are in
different files and `test-app-header.js` is the only place the pair is
compared.

**The dashboard's bottom button row is GONE.** Go to Generator / Buy Credits /
Logout are all in the header now, on every page rather than only that one. The
row was kept at first on the reasoning that a body CTA does a different job
from a nav link — true while it WAS a link, false once it became a button.
The dashboard keeps its real actions (Preview, Download, Convert, Manage
sites). **Do not add a navigation row back there.**

**The signed-in email moved into the profile menu.** It is identity, not
navigation, and it was occupying the slot navigation belongs in. Behind the
profile icon is where every app puts the account address. It was also the
widest element in the header, so the header no longer overflows on a phone —
which retired a caveat raised earlier about the logo's width.

**`id="user-info"` is unchanged and must stay unchanged.**
`public/js/currentUserInfo.js` fills it from `/api/me` and does not care where
the element sits, so moving it needed no JavaScript at all. Renaming the id
would silently leave it empty: the script returns early when the id is
missing, with no error anywhere. `test-app-header.js` reads the script's
`getElementById` calls and asserts the header provides every id it asks for.

## The logo and the wordmark link — 21 September

The header's top-left was inert `<strong>SEO Site Generator</strong>`. It is
now the Three Comets logo, wrapped in `<a href="/">`.

**The link is the important half.** The name in the top-left going home is the
one navigation convention every visitor already knows, and it was not a link
at all. It also closed a real dead end: from the build progress page, starting
a second site was finish → dashboard → Go to Generator. Three clicks for the
action you most want someone to take right after one succeeds — and nothing
was added to the header to fix it.

**Do the link before the logo, not after.** The `<a>` wraps whatever is inside
it, so swapping text for an image later is one line *inside* a link that
already works. The other order touches the same markup twice.

**THE HEADER USES A CROP, NOT THE FULL LOCKUP.**

    public/img/three-comets-logo.png         452x162  the full artwork
    public/img/three-comets-logo-header.png  452x127  strapline cropped off
    shown at                                 178x50

The artwork has two clean bands — y=4-122 is the comets and the name, y=131-149
is "BUILD - OPTIMIZE - RANK FAST". In a header that strapline is texture (no
one reads a positioning line in app chrome) and it was eating a third of the
height. Cropping it gives the NAME that height instead:

    full logo @ 50px tall  ->  name renders 37px,  header 82px
    cropped   @ 50px tall  ->  name renders 47px,  header 82px
    full logo @ 63px tall  ->  name renders 46px,  header 95px

So the crop produces a bigger name than growing the header by 13px does.
Ordinary brand practice: full lockup for the site and the deck, compact
version for UI. The full file stays in public/img for everything else.

**Sharpness headroom is now 2.54x** (452px file shown at 178px). Above the 2x
retina needs, but the cropped version is wider per unit of height, so it burns
headroom faster — about 56px tall is the practical ceiling for this PNG. Past
that, re-export bigger or go SVG rather than scaling it up.

**width and height are set explicitly** so the header does not jump while the
image loads — which only helps if they match the file. `test-app-header.js`
reads the PNG's real dimensions out of its header bytes and fails on a
distorted ratio or an upscale, so replacing the logo with a different shape is
caught rather than shipped.

**Every size here was chosen by RENDERING it on the navy at true pixel size,
not by guessing.** Do the same before changing it — the numbers alone do not
tell you whether the strapline survives or the header reads as bloated.

**Send the renders to Edwin.** Viewing an image in the workspace shows it to
Claude, not to him. Three previews were referenced as "the render above"
before he pointed out he could not see any of them. Use SendUserFile.

**The alt text is the brand name, not "logo".** The header has no text name any
more, so the alt is all a screen reader gets.

**Three names for one product, and this fixes one of them.** The header said
"SEO Site Generator", the emails say "Fast Website Generator", the domain is
now threecomets.com. The header is done; `EMAIL_FROM_NAME` and the page titles
are not.

## The logged-in header — 21 September

The app had THREE navigation patterns, one per page:

    /            (form.html)  a real <header> with credits and a profile menu
    /dashboard                no header; three buttons at the BOTTOM of the page
    /jobs/:id                 nothing — an <h1> and one CTA when done

`utils/appHeader.js` gives /dashboard and /jobs/:id (including its 404) the
same header the generator has. **Nothing was added or removed** — same three
menu items, same dynamic credits badge, same admin menu, all still filled by
`/js/currentUserInfo.js` from `/api/me`.

**The progress page mattered most.** It is shown immediately after a build
charges 500 credits and it was the one page that never showed the balance —
and it was a dead end, no way to reach the dashboard, buy credits or log out.
Worth knowing: leaving that page does NOT cancel anything. The build runs in
the server-side job queue, so the usual "strip the chrome so they don't wander
off" argument does not apply here.

**THREE EXPORTS, and forgetting one leaves a broken header:**

    appHeaderAssets()   bootstrap-icons + the 3 CSS rules
    appHeader(csrf)     the markup
    appHeaderScripts()  bootstrap.bundle + currentUserInfo.js

No page loaded the icon font, the Bootstrap JS bundle or the credits script on
its own, so pasted markup alone renders an invisible control opening a dead
menu with no credits in it. Bootstrap's own CSS is deliberately NOT
re-included; every page already has it.

**Three CSS rules, and the third is the one that gets missed.** Besides
`.header-background` and `.padding-right-header` there is a bare `header {}`
rule carrying the border and drop shadow. While it lived only in form.html the
generator's header had them and the other two did not.

**ONE COPY, FOR THE WHOLE APP — 21 September.** `src/views/form.html` holds
three placeholders and no header of its own:

    {{HEADER_ASSETS}}   in <head>
    {{HEADER}}          first thing in <body>
    {{HEADER_SCRIPTS}}  first of the script tags, so bootstrap still loads
                        before the page's own deferred scripts

`routes/formRoute.js` fills them beside the existing `{{CSRF}}` replace.
**Order matters: {{HEADER}} is filled BEFORE {{CSRF}}** — `appHeader()` puts
the token into the logout form itself, so the reverse order leaves the logout
button posting without one.

**NEVER WRITE A PLACEHOLDER NAME IN A COMMENT.** The substitution is a global
regex, so a mention inside a comment is filled in too. A comment in form.html
explaining where the CSS had gone said `{{HEADER_ASSETS}}` and injected a
second copy of the whole header stylesheet into the middle of the `<style>`
block. `test-app-header.js` asserts no comment names a placeholder.

**COMMENTS THAT QUOTE THEIR OWN MARKUP ARE THE RECURRING TRAP HERE — it has
now cost five surviving mutations across three sittings.** The comments in
`appHeader.js` and `formRoute.js` explain decisions by quoting the thing they
describe: one literally reads `KEEP id="user-info"`, another writes
`appHeader()` and `{{HEADER}}` in prose. A plain `includes()` then matches the
explanation and passes while the code is gone.

Two helpers exist for this and every assertion must use one:

    headerMarkup()        appHeader() with comments stripped — for anything
                          asserting a piece of MARKUP exists
    jsWithoutComments()   for anything grepping a .js source file

The comments are worth keeping; the tests just must not read them.

**A default parameter fires only for `undefined`.** `appHeader(null)`
interpolated the literal string "null" into the logout form. Both call sites
write `res.locals.csrfField || ''` so it could not happen today, but the guard
is `csrfField == null ? '' : String(csrfField)` now.

## The location-page description — 21 September

It was `description: title` — 42 characters of a ~155 budget, on a page whose
whole job is to rank for a town with no service page of its own. Now:

    title        Emergency Plumber Round Rock in Austin, TX
    description  Plumbing services in Austin, TX — water heater repair, drain
                 cleaning and slab leak repair. Call (512) 894-6167.

**The title leads with the NAME and the description leads with the SERVICE**,
on purpose. They are two lines of one search result, so a brand-led
description spends its opening words on something the searcher has already
read. This way the trade and the town appear twice across the two lines.

**No business name in the description**, for the same reason `serviceMeta`
leaves it out: on these sites the name carries the primary keyword, so
repeating it everywhere aims every page at the home page's term.

`locationMeta(locationDisplay, globalValues, pages)` takes a third argument.
`pages` was ALREADY a parameter of `buildLocationPages` — it is there for the
Services dropdown — so this cost one argument at one call site.

**Degrades by service count**, which is not hypothetical: One-Page Design
sites have no service pages at all.

    3+  … in Austin, TX — a, b and c. Call …
    2   … in Austin, TX — a and b. Call …
    1   … in Austin, TX — a. Call …
    0   … in Austin, TX. Call …          (the dash clause disappears)

**What it does NOT fix:** every location page still says the same thing with a
different town, because the business offers the same services everywhere. That
is expected of location pages. What changed is a description that said nothing.

**The call-site mutation survived at first**, and this is the second time in
two days: `test-page-meta.js` tests `locationMeta` directly, so dropping
`pages` at the call site left every test green while the feature became a
no-op on every real site. Identical to `anchorType` being dropped in
`normaliseTargets`. **When a change adds an argument, one test must read the
CALLER**, not just the function. Both suites now do.

Contact is the last page still reusing its title as its description.

## The phone number is now format-checked — 21 September

**`type="tel"` VALIDATES NOTHING.** Unlike `type="email"`, a browser accepts
any string in a tel input. `phone` was already in `requiredGlobalFields`, so
a blank one was rejected at three layers — and that made the gap invisible,
because the field *looked* validated. These generated complete sites and
charged 500 credits:

    phone "x"         title: Acme Plumbing in Austin, TX | Call x
    phone "call me"   title: Acme Plumbing in Austin, TX | Call call me
                      link:  tel:+1

`isDialablePhone()` in helpers.js: ten digits, or eleven starting with 1, with
all punctuation ignored. **Not an international validator** — this product
sells US local-SEO sites, `formatPhoneForHref()` hard-codes +1 and the state
list is US-only. If that changes, this changes with it.

The rule is DUPLICATED as `isPhoneLike()` in `public/js/generateDinamycForm.js`
because that file is served to the browser and helpers.js is not. The server
is the authority; the client copy only saves a round-trip. `test-phone.js`
reads the form script and asserts the two agree, because a duplicate that
drifts is worse than no duplicate.

**A shadowed `fields` array, found while adding that check.** The business-hours
block in `validateGlobalFields` declared its own `const fields = []`, shadowing
the outer one, so its early return sent back ONLY the hours problems and
silently discarded everything collected before it. A customer with a missing
business name AND a bad closing time was told about the closing time, fixed it,
resubmitted, and only then learned about the name. Renamed to `hourFields`,
merged into the outer array before returning.

**A false alarm I raised and had to retract.** I reported that
`formatPhoneForHref()` produced `tel:tel:+1…` in generated sites. It does not.
The templates write `href="{{PHONE_RAW}}"` with no prefix of their own and the
function returns the complete href. The doubling came from my own test snippet.
The name is the trap — it returns an href, not a formatted phone — and
`phoneHref()` would be the honest name if it is ever worth five call sites.

## A location page for the site's own town is blocked — 21 September

`validateAndNormalizeLocationPages(rawList, toggleValue, mainLocation)` now
takes a third argument and rejects an entry matching the site's own location.

**Why it became worth blocking.** That page always duplicated the home page on
content. The Rank Fast title change of 20 September made the duplication
visible to Google, because the location title became an exact PREFIX of the
home title:

    home      Emergency Plumber Round Rock in Round Rock, TX | Call (512) 894-6167
    location  Emergency Plumber Round Rock in Round Rock, TX

Two pages, near-identical titles and content, no canonical saying which wins —
which is the "Duplicate without user-selected canonical" report, self-inflicted.
The existing dedupe compared entries against EACH OTHER and never against the
site's own town, so a customer typing their own town got the page.

**BOTH call sites pass `global.location`** — `routes/generateRoute.js` and
`utils/runGeneration.js`. The route is the one that reports the problem;
runGeneration only destructures `locations`, so it silently DROPS the page.
If only runGeneration had the argument, a customer would sail through the form
and lose a page with no explanation anywhere. `test-location-pages.js` greps
both files for the argument.

**The state is compared only when both sides have one.** "Round Rock" and
"Round Rock, TX" are the same place typed two ways, and the main-location field
does not force "City, ST". Austin TX and Austin MN stay different towns.

**Three mutations in a row missed their target here**, which is worth
remembering: `parsePlace()` returns null at `if (!text) return null;`, *before*
the `return city ? ... : null` line that looks like the empty-input guard. A
mutation must change the line that actually implements the behaviour. The
"no main location disables the check" test cannot be killed by any SINGLE
mutation — three independent guards protect that path — and only fails when
all three are removed at once. That is over-determination, not a vacuous test,
but do not claim single-mutation coverage for it.

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

**Blog hero image — raised 11 September, done on 12 September**

It needed no custom post type. See "Deliberately dropped" for why the CPT was
abandoned.

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
- ~~The server has 25 pending package updates and a kernel upgrade waiting on a
  reboot.~~ **Done 24 September.** 31 packages upgraded, rebooted onto kernel
  `6.8.0-142-generic`. Recorded below, because the next one should be the same
  twenty minutes rather than another twelve days of putting it off.
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

- **Excluding Design Sample from the service suggester.** Edwin, 21 September:
  "forget about this". The suggester has no mode check, so it appears in all
  three modes; in a sample it returns a list with nothing ticked and a note
  saying the credits are spoken for, and spends a model call doing it. He
  knows, and decided it is not worth the code.
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
