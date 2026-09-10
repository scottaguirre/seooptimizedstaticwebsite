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

## Outstanding

- `utils/altText/dentist.js`, `doctor.js`, `chiropractor.js`,
  `physical-therapy.js` — 11 sets each. The image folders exist; without these
  every image on those sites ships with `alt=""`.
- Re-export and reinstall the WordPress theme on roofingamerica.xyz to pick up
  the archive canonicals. Plugin 0.3.2 too if still pending.
- General law-firm photographs and a rewritten `utils/altText/law-firm.js` (the
  current one is lemon-car copy), then flip `listed` back on for Law Firm in
  `businessShape.js`.
- Dead files still on disk: `utils/buildInterlinkMap.js`,
  `utils/buildservicesNavMenu .js`, `utils/wpThemeBuilderBackUp.js`,
  `utils/wpThemeBuilderOriginal.js`. Nothing requires them.
- `utils/generateFaqAnswers.js:22` — stale comment claiming location pages run
  on PAA questions. They have not since `generateLocationFaq.js` replaced that.
