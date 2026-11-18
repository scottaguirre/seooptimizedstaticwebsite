// utils/pageTitle.js
//
// The product's name, and the name in the browser tab.
//
// WHY THIS IS ITS OWN FILE AND NOT PART OF appHeader
//
// It started there — the logo's alt text is the product name, so that looked
// like where the name lived. Then the signed-out pages needed it: the
// password-reset pages have tab titles like everything else, and importing
// the helper meant importing utils/appHeader.
//
// A test in test-app-header.js caught that within the minute:
//
//   signed-out pages do NOT get the header
//   routes/passwordRoute.js renders the logged-in header on a signed-out page
//
// It matches the module NAME rather than the header being rendered, so
// strictly it was a false positive — and splitting the file was still the
// right answer. A signed-out page has no business importing the logged-in
// header for any reason, and a boundary that holds only because nobody has
// had a good excuse to cross it is not a boundary.
//
// So the name lives here, appHeader reads it for the logo, and a page that
// only wants a tab title only takes a tab title.

/**
 * The product's name, in ONE place.
 *
 * Renaming the product should be one edit, not a grep. This app was called
 * SEO Site Generator and then Fast Website Generator before it was called
 * Three Comets, and each rename left strings behind in files nobody thought
 * to search.
 */
const APP_NAME = 'Three Comets';

/**
 * What separates the page from the product.
 *
 * A middle dot rather than a pipe or a dash: it reads as a separator rather
 * than as punctuation belonging to either side, so "Log In · Three Comets"
 * cannot be misread as a page called "Log In -".
 */
const TITLE_SEPARATOR = ' · ';

/**
 * "Dashboard" -> "Dashboard · Three Comets".
 *
 * WHY THE PAGE COMES FIRST. A tab shows maybe twenty characters before it
 * truncates, and brand-first means ten open tabs all read "Three Comets…" —
 * identical, and useless for finding the one you want. Putting the page first
 * means the distinguishing word survives the truncation.
 *
 * THE APP'S OWN FRONT PAGE IS JUST THE NAME. "Three Comets · Three Comets" is
 * what a naive suffix produces for the wizard, so a name that already IS the
 * product comes back unchanged — as does an empty one, which is how a missing
 * title degrades to something correct rather than to " · Three Comets".
 */
function pageTitle(name) {
  const page = String(name == null ? '' : name).trim();

  if (!page || page === APP_NAME) return APP_NAME;

  // Already branded — a caller that passed a whole title, or a double wrap
  // after a refactor. Either way, once is enough.
  if (page.endsWith(`${TITLE_SEPARATOR}${APP_NAME}`)) return page;

  return `${page}${TITLE_SEPARATOR}${APP_NAME}`;
}

/**
 * What the two blog tools are called, in ONE place each.
 *
 * HERE FOR THE REASON APP_NAME IS HERE. These are names that appear on a
 * sidebar, a page title, two <h1>s, a dashboard card, two buttons and a
 * line printed by a script — eight files, and a name in eight files is a
 * name that gets renamed in six of them. That is not a worry, it is this
 * app's own history: it was SEO Site Generator, then Fast Website
 * Generator, and each rename left strings behind in files nobody thought
 * to search.
 *
 * AND IN THIS FILE RATHER THAN IN appHeader, for the boundary that file's
 * own header explains: pluginDownloadRoute and exportWpThemeRoute want a
 * four-word label, not the logged-in header. A page that only wants a name
 * should only have to take a name.
 *
 * RENAMED 21 OCTOBER 2026, on Edwin's instruction. They were "Blog
 * Automation" and "Static Blogs". Neither said what the thing BUILDS, and
 * "Static" was an implementation detail — the blogs are static because
 * Cloudflare Pages serves files, which is true and tells a customer
 * nothing. The new pair also says out loud that they are two halves of one
 * choice: WordPress, or Cloudflare.
 *
 * THE URLS DID NOT MOVE AND MUST NOT. /blog-sites and /static-blogs are
 * bookmarked, linked from the plugin's setup text, and written down in
 * Edwin's own notes. A label is cheap to change; a path is not. Same rule
 * as the plugin's folder name.
 */
/* THE VERB MOVED INTO THE GROUP HEADING — 16 November.
 *
 * Five rows each began with "Build", so the word carried no information and
 * cost a third of every label's width. The sidebar now has a BUILD WEBSITES
 * heading and a BUILD BLOGS heading, and each row says only which one it
 * is. What is left differs in exactly the way the products differ.
 *
 * THE URLS DID NOT MOVE, AND THAT RULE IS OLDER THAN THIS CHANGE — see
 * below. /blog-sites and /static-blogs are bookmarked, linked from the
 * plugin's setup text and written down in Edwin's own notes. */
const TOOL_WP_BLOGS = 'WordPress Blogs';
const TOOL_CF_BLOGS = 'Cloudflare Blogs';

/**
 * The report over both of them.
 *
 * ADDED TO THE SIDEBAR 23 OCTOBER 2026, on Edwin's instruction, and given a
 * constant on the way in rather than a sixth hard-coded label.
 *
 * It had exactly one entry point: a small green button in the top-right
 * corner of the Build WP blogs page. So the report on EVERY blog — WordPress
 * and Cloudflare both — was reachable only from one of the two tools it
 * reports on, and only if you noticed a button that looks like a page
 * action. From Build Cloudflare Blogs there was no way to it at all.
 *
 * That is the failure appSidebar()'s own comment describes, in its milder
 * form: not unreachable, just somewhere nobody looks.
 */
const TOOL_BLOG_REPORT = 'Blog Report';

/**
 * Websites on Cloudflare, as opposed to blogs on Cloudflare.
 *
 * ADDED 7 NOVEMBER 2026, and Edwin named it himself: *"I want to create its
 * own route and add that option in the sidebar of the three comets menu that
 * reads Clouflare Websites, just as we have for the blogs = Clouflare
 * blogs."*
 *
 * THE PAIRING IS THE POINT. "Build Cloudflare Blogs" and "Build Cloudflare
 * Websites" sit next to each other and differ in one word, which is exactly
 * how much they differ: same account pool, same domain pool mechanics, same
 * Pages deploy. What changes is what gets published.
 *
 * SPELT CORRECTLY HERE. Edwin wrote "Clouflare" twice; the sidebar is not
 * the place to reproduce a typo, and the label is one string in one file
 * precisely so a correction is one edit.
 */
const TOOL_CF_SITES = 'Cloudflare Websites';

/**
 * Websites published to GitHub Pages.
 *
 * ADDED 16 November. The mode has existed for weeks under the caption
 * "Local Website Options", as the second of four cards on step 1 of the
 * wizard, and nothing on that card said GitHub. Cloudflare had two named
 * rows in the sidebar, WordPress one, and the third host none — so finding
 * it required knowing which caption meant it.
 *
 * THE ROW NAMES THE HOST, like the two beside it, because the heading
 * above them already says what is being built. The wizard caption can stay
 * as it is: nobody reaches it by that name any more.
 */
const TOOL_GH_SITES = 'GitHub Websites';

/**
 * The websites already published to GitHub Pages.
 *
 * ADDED TO THE SIDEBAR 16 November. The route has existed since the editor
 * was built; it reached the sidebar today. Before that it was one line in
 * the account dropdown in the header — put there on 30 October for the same
 * reason, because until then the only way in was to type the URL.
 *
 *     A TOOL IN A DROPDOWN UNDER AN AVATAR IS A TOOL IN A DRAWER. It is
 *     reachable, which is not the same as findable, and this file has now
 *     written that sentence about four different screens.
 *
 * It LEAVES the dropdown rather than appearing twice — Edwin's call, 16
 * November. Every other tool lives in exactly one place.
 *
 * RENAMED 17 November, FROM "My Websites". It never meant all of them: it
 * is the GitHub Pages list and nothing else. That was survivable while
 * Cloudflare's list had no row of its own — and the moment it got one, the
 * sidebar read "My Websites" and "My Cloudflare Websites" as a whole and a
 * part, when they are two halves.
 *
 *     A LABEL THAT OMITS THE ONE THING DISTINGUISHING IT READS AS THE
 *     GENERAL CASE. The same mistake as "Build a Website" sitting beside
 *     "Build Cloudflare Websites", which is what started all of this.
 */
const TOOL_MY_SITES = 'My GitHub Websites';

/**
 * The websites already published to a Cloudflare subdomain.
 *
 * ADDED TO THE SIDEBAR 17 November, and it is the LIST half of a pair that
 * had been collapsed into one row. `/cloudflare-sites` was serving as both
 * the builder's entrance and the manager, under BUILD WEBSITES — so the row
 * beside GitHub Websites opened a table, while GitHub Websites opened a
 * wizard. Edwin pressed it expecting the wizard:
 *
 *     *"The cloudflare website button takes me to the same old screen
 *     that was before"*
 *
 * TWO PRODUCTS UNDER ONE HEADING, WIRED OPPOSITE WAYS, is a heading that
 * promises something only half its rows do. Now both read the same: a build
 * row under BUILD WEBSITES, a list row under MANAGE.
 */
const TOOL_MY_CF_SITES = 'My Cloudflare Websites';

/* -------------------------------------------------------------------------
 * WHAT THE SIDEBAR SAYS, WHICH IS NOT WHAT A PAGE IS CALLED
 * ---------------------------------------------------------------------- */

/**
 * The five rows that make something, each naming the verb.
 *
 * ASKED FOR 17 November. Edwin: *"all the options on the sidebar should add
 * the word Build"*.
 *
 * AND THE VERB MOVED RATHER THAN DOUBLED. The groups were "Build websites"
 * and "Build blogs" — the 16 November regrouping put the verb in the
 * heading precisely so it was not repeated down the column. Putting it back
 * on every row AND leaving it in the heading says it twice: "Build
 * websites → Build Cloudflare Websites". So the headings became WEBSITES
 * and BLOGS, and the verb now sits on the row you actually click.
 *
 *     A VERB BELONGS WHERE THE CLICK IS. A heading is a filing label;
 *     the row is the thing you do.
 *
 * SEPARATE FROM THE TOOL_ NAMES ABOVE, AND THIS CHANGE IS WHAT PROVED THEY
 * ARE DIFFERENT THINGS. TOOL_CF_BLOGS titles the /static-blogs page and
 * heads it — a LIST of blogs. Renaming that constant to carry "Build" would
 * have titled a list page "Build Cloudflare Blogs", and TOOL_WP_BLOGS is
 * worse: it also labels a button on the blog report and a card on the
 * dashboard.
 *
 *     A NAVIGATION LABEL AND A PAGE TITLE ANSWER DIFFERENT QUESTIONS —
 *     "what will this do" against "where am I" — AND ONE STRING CANNOT
 *     DO BOTH ONCE EITHER OF THEM GROWS A VERB.
 */
/* "Click to Build Websites" — Edwin, 17 November, naming this one himself.
 * The other four read "Build <host> Websites"; this is the open generator
 * and the row that is also the page's primary action, which is the one
 * worth spelling out. */
const NAV_BUILD_SITE = 'Click to Build Websites';
const NAV_GH_SITES = 'Build GitHub Websites';
const NAV_CF_SITES = 'Build Cloudflare Websites';
const NAV_WP_BLOGS = 'Build WordPress Blogs';
const NAV_CF_BLOGS = 'Build Cloudflare Blogs';

/* NAMED BY EDWIN, 17 November, verbatim: "this will be named Cloudflare
 * Local Automation".
 *
 * IT DOES NOT START WITH "Build", and the four rows around it do. That is
 * his name for the product rather than a description of the row, and a
 * house style is not a reason to rename somebody's product. */
const NAV_CF_LOCAL = 'Cloudflare Local Automation';

module.exports = {
  pageTitle, APP_NAME, TITLE_SEPARATOR,
  TOOL_WP_BLOGS, TOOL_CF_BLOGS, TOOL_BLOG_REPORT, TOOL_CF_SITES,
  TOOL_MY_SITES, TOOL_MY_CF_SITES, TOOL_GH_SITES,
  NAV_BUILD_SITE, NAV_GH_SITES, NAV_CF_SITES, NAV_WP_BLOGS, NAV_CF_BLOGS,
  NAV_CF_LOCAL,
};
