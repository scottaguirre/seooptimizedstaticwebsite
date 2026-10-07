<?php
/**
 * Plugin Name:       Three Comets Blog Generator
 * Plugin URI:        https://threecomets.com
 * Description:       Plans a quarter of blog posts, writes them all at once, schedules them across the weeks, and wires every one into the service page you want to rank.
 * Version:           0.34.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Three Comets
 * License:           GPL-2.0-or-later
 * Text Domain:       interlink-engine
 *
 * ---------------------------------------------------------------------------
 * HOW THE TWO HALVES DIVIDE
 *
 * The plugin owns everything that references WordPress: which pages exist,
 * their real permalinks, the posts, the placeholder state, the campaign plan
 * once it has been made. The server owns the account, the credits, the
 * prompts, the API key, and the timetable of "wake site X on date Y".
 *
 * The plan is COMPUTED on the server and STORED here. That is deliberate: the
 * ring, the anchor allocation and the slug rules are one body of logic, and a
 * second implementation in PHP would drift from the first. So it is computed
 * once, by the code that already exists, and this plugin owns the result.
 *
 * Nothing in the ping from the server carries content. It names some campaigns
 * and this side works out what to do — so a lost ping costs nothing and the
 * catch-up cron can do the same job unaided.
 *
 * WHAT 0.2.0 CHANGED
 *
 * Every post in a campaign is written the day the campaign is approved, in one
 * batch, instead of one post a week. They are added to the site as future-dated
 * posts and WordPress publishes them itself.
 *
 * WHAT 0.2.1 CHANGED
 *
 * The server address can be edited on its own. Saving the Connection screen
 * with an empty licence key now changes only that address; it used to run a
 * full activation, which cleared the site id and secret when it failed — so
 * correcting a URL could disconnect a working site, and the key needed to fix
 * it is not stored anywhere on this side.
 *
 * WHAT 0.2.2 CHANGED
 *
 * "Publish now" moves the post's date to now. It used to flip the status and
 * leave the date, so a post published early went live dated next Thursday —
 * wrong in the archive, wrong in the feed, wrong to a reader. The catch-up
 * sweep deliberately still leaves dates alone: those posts are already late,
 * and their planned date is the right one.
 *
 * WHAT 0.2.3 CHANGED
 *
 * The Campaigns screen tells the truth while a batch runs. Collection was
 * already automatic — the server pings the site and the plugin takes the posts
 * — but the screen never said so, and left a button reading "Write all 3 posts
 * — 225 credits" sitting there after the 225 had been spent. Anyone pressing
 * it was gambling on whether it would charge again. Now an approved campaign
 * shows "Check now" with no price, and the page watches itself for ten minutes
 * so the posts are seen arriving rather than guessed at.
 *
 * WHAT 0.8.0 CHANGED — THE TOPIC BUTTON ADDS INSTEAD OF REPLACING
 *
 * "Suggest different topics" replaced the six topics on screen with six new
 * ones. The word "different" was accurate; nobody read it that way. The
 * obvious move when you want twelve posts is to press it twice, and pressing
 * it twice left you with six — the first set gone, with no warning that it
 * was about to be.
 *
 * So the only route to a year of posts was to type all fifty-two by hand,
 * which is exactly the work the button exists to avoid.
 *
 * It now ADDS, and:
 *
 *   - asks for TWELVE at a time, which is all the server will give in one
 *     request. Asking for six made a year's plan nine presses instead of five
 *     for no reason anyone had chosen.
 *   - reads the topics from the FORM rather than the stored draft, so edits
 *     and unticked rows survive the press.
 *   - refuses duplicates itself, case-insensitively. The server is asked to
 *     avoid what is on screen, but a request is not a guarantee, and two rows
 *     with one topic become two posts competing for one search.
 *   - stops at 52 — a weekly post for a year. Every topic becomes a post that
 *     costs credits on approval, so the ceiling is a spending limit as much
 *     as a layout one, and the topics KEPT are the earlier ones, because
 *     those are the ones that may already have been edited.
 *   - says the running total on the button itself, because the number of
 *     topics is the size of the campaign and the price of approving it.
 *
 * The decision-making part is IE_Admin::merge_topics(), deliberately pure so
 * that wp-plugin/test-topic-merge.php can test it without WordPress — the
 * handler around it needs nonces, transients and redirects, and the harness
 * that could render those has been broken for weeks.
 *
 * WHAT 0.7.3 CHANGED
 *
 * The wp-admin sidebar says "Three Comets" rather than "Blog Generator".
 *
 * That menu item sits in a customer's WordPress — often an agency's client,
 * who never bought anything from us and never will. It is the one place the
 * name is seen daily by somebody who did not install it, so it carries the
 * brand rather than the function. The page heading underneath still gives
 * the full name for anyone who needs to know what it does.
 *
 * WHAT 0.7.2 CHANGED — A NEW NAME ON SCREEN, AND NOTHING ELSE
 *
 * The plugin is now "Three Comets Blog Generator" wherever a person can read
 * it: the Plugins list, the wp-admin menu, the download filename, and the
 * setup steps on the account page.
 *
 * NOT RENAMED, DELIBERATELY, AND EACH FOR ITS OWN REASON:
 *
 *   the folder         WordPress identifies a plugin BY ITS DIRECTORY. Rename
 *                      interlink-engine/ and the next upload installs a
 *                      SECOND plugin beside the first — old one still active,
 *                      new one deactivated, no error anywhere. On a
 *                      customer's site that reads as nothing happening.
 *
 *   the options        ie_campaigns holds every campaign on the site, and
 *                      ie_settings the connection. Rename either key and the
 *                      plugin wakes up believing it has never run.
 *
 *   the menu slug      admin.php?page=interlink-engine is in bookmarks, in
 *                      this plugin's own redirects, and in links the server
 *                      has already sent people.
 *
 *   the text domain    every __() call names it. Changing it silently drops
 *                      every translation.
 *
 *   IE_ class names    internal, and worth nothing to change.
 *
 * A display name is cheap. An identifier is not, and the two are only ever
 * confused once.
 *
 * WHAT 0.7.1 CHANGED
 *
 * The hourly sweep now also reports which posts are LIVE, not only which are
 * gone.
 *
 * "This post went live" was an EVENT: sent once, as the post goes public,
 * with nothing behind it. One rejected call and the server believes a
 * published post is still waiting — permanently, because the event never
 * comes again.
 *
 * That is not hypothetical. On the site this was written for, a licence key
 * used on a second WordPress left this one holding a stale secret; eight days
 * of refused calls included twelve of these. Twelve posts sat on the
 * customer's blog, visible to anyone with a browser, recorded on the server
 * as pending. The report read "26 published of 48" for a site carrying 12,
 * and no amount of waiting would ever have corrected it.
 *
 * on_transition() writes the local slot status BEFORE calling the server, so
 * this side knew all along and simply had no way to say so twice. The sweep
 * sends both halves in one call, because both come from one walk of one
 * campaign, and goes quiet as soon as the two sides agree.
 *
 * The endpoint keeps the name /api/blog/posts-deleted even though it is now a
 * reconciliation of slot STATE rather than of deletions alone. Renaming it
 * would 404 on every older plugin, and a tidier name is not worth a broken
 * customer.
 *
 * WHAT 0.7.0 CHANGED — ONE LICENCE, ONE SITE, ENFORCED AT LAST
 *
 * The rule was always printed on the account page: "Each WordPress site
 * running the plugin needs its own licence key." Nothing
 * enforced it, and a rule stated but not enforced is a trap.
 *
 * WHAT THE TRAP DID. Paste a key into a second WordPress — or, far more
 * easily, CLONE a site, because the site id and signing secret live in
 * wp_options and a duplicate carries them without anyone typing anything —
 * and activation mints a fresh secret. The second site works immediately.
 * The first one dies: every call refused, for ever, and the only thing on
 * screen is "Not authorised".
 *
 * On the site this was written for it ran EIGHT DAYS. Every "this post went
 * live" callback rejected, the server's record drifting from the site's, and
 * the customer's own report claiming 26 published posts for a site carrying
 * 12. Nothing anywhere said why. It was found by reading a log file.
 *
 * THREE CHANGES:
 *
 *   X-IL-Site-Url on every request. The server compares it to the domain the
 *   licence is registered to and refuses a mismatch with a 409 naming the
 *   other site. Checked AFTER the signature, because that message is
 *   information and only a caller holding the secret may have it.
 *
 *   Activation refuses to take a licence off a live site unless the request
 *   says plainly that is the intention — the "this licence is moving from
 *   another site" box on the Connection screen. The refusal names the site
 *   that would be disconnected, so the box is never the first anyone hears
 *   of it. It is not a wall; it is the difference between choosing something
 *   and having it happen to you.
 *
 *   "Not authorised" is replaced with what to do about it. The server stays
 *   deliberately vague — saying which part of the signature failed would
 *   hand an attacker a debugging tool — but the plugin knows it is connected
 *   and is not a stranger, so it says the useful thing.
 *
 * OLDER PLUGINS ARE NOT LOCKED OUT. An install that sends no URL header is
 * allowed through exactly as before. Refusing them would break every existing
 * customer on the day this ships, which would be a worse bug than the one it
 * fixes. The protection arrives for each site as it updates.
 *
 * WHAT 0.6.0 CHANGED — ANOTHER MINOR BUMP, ANOTHER NEW ENDPOINT
 *
 * The site now tells the server which campaigns it still HAS.
 *
 * 0.5.0 reconciles the slots inside campaigns this plugin holds. A campaign
 * REMOVED from the WordPress is not in those records at all, so nothing walks
 * it — and its posts stay on the server's books forever, counted as live work
 * and charged for on the customer's own report, with links that 404.
 *
 * IE_Api::removed() covers a removal as it happens, but only since 0.4.4.
 * Everything removed before that was never reported and is reachable by
 * nothing except this. On the site that prompted all of this it was six
 * campaigns and fourteen published posts, and pressing "Check for deleted
 * posts" correctly answered "every post these campaigns made is still on the
 * site" — because the campaigns holding the missing fourteen were themselves
 * long gone.
 *
 * AN EMPTY LIST IS NEVER SENT, and the server refuses one anyway. This is the
 * only message in the system that can destroy a record rather than correct
 * one, and a plugin whose options have been lost — a partial restore, a
 * botched migration, a fresh install on an old domain — reports zero
 * campaigns, which is indistinguishable from a site that has genuinely
 * removed every one. The second case is already covered, because each of
 * those removals fires the removal callback as it happens. So the ambiguous
 * message is the one worth swallowing.
 *
 * The server adds a grace window of its own: a campaign created in the last
 * half hour is never marked removed. A campaign is created there during
 * planning and stored here only when this plugin reads the response, and in
 * between it exists on one side and not the other.
 *
 * WHAT 0.5.1 CHANGED
 *
 * Two rough edges on the deleted-post reporting 0.5.0 introduced.
 *
 * ONE CALL PER REQUEST, NOT ONE PER POST. The delete hooks fire once per
 * post, so selecting twelve posts in wp-admin and choosing Delete fired them
 * twelve times inside a single request — and 0.5.0 made twelve separate HTTP
 * calls to the server, back to back, each with a twenty-second timeout, while
 * the owner's browser waited on all of them. Bulk delete is how somebody
 * clears out a campaign's posts, so that was the common case, not the unlucky
 * one. The hooks now only note which campaigns are affected and one
 * reconciliation per campaign goes out at 'shutdown'.
 *
 * That also made the answer honest. These hooks run BEFORE WordPress does the
 * work — at before_delete_post the row is still in the database — so 0.5.0
 * had to carry "this one is going" in by hand rather than ask the site. By
 * shutdown the deed is done and the site can simply be asked.
 *
 * AND A BUTTON: "Check for deleted posts", at the foot of the Campaigns
 * screen. The sweep rides on WP-Cron, which fires when somebody loads a page
 * rather than on a clock. Sites with a campaign in flight are pinged by the
 * server every few minutes and run it constantly; a site whose campaigns have
 * all FINISHED is never pinged, because there is no work, so on a site with
 * no visitors the sweep might not run for weeks.
 *
 * That is the site where it matters most — posts get tidied up long after a
 * campaign ends — so the automatic path served its most important case worst.
 * The alternative was telling an owner to go and load their own home page.
 *
 * WHAT 0.5.0 CHANGED — A MINOR BUMP, BECAUSE THE WIRE CHANGED
 *
 * The server is now told when a post is deleted. Until this, it never was.
 *
 * 0.4.3 taught the admin screens to NOTICE a missing post: they query
 * WordPress as they draw, grey the row out and say "Post deleted". That
 * knowledge never left wp-admin. The only deletion the server ever heard
 * about was /api/blog/removed, which is a different event — the whole
 * CAMPAIGN being thrown away, not the posts.
 *
 * So the customer's own blog report went on listing deleted posts as
 * published, each with a working-looking link and a 75-credit charge beside
 * it. On one site that was fourteen rows: it claimed 26 published where the
 * site carried 12. A billing record that only ever overstates is worse than
 * no record, because it is the document someone reaches for to check a bill.
 *
 * THREE WAYS IN, and each covers what the others cannot:
 *
 *   before_delete_post / wp_trash_post   the moment it happens
 *   untrashed_post                       and the moment it comes back
 *   sweep_deleted(), hourly              everything else
 *
 * The sweep is not a duplicate of the hooks. It is the only thing that can
 * report a post deleted while the server was unreachable, removed by a
 * database edit or a restore from backup, or deleted BEFORE THIS CODE
 * EXISTED — no hook fires retroactively, and that last case is the one that
 * matters on the day this ships.
 *
 * THE CALL IS A RECONCILIATION, not an event: "these and only these are
 * gone". That is what lets a post pulled back out of the trash lose its
 * Deleted mark. An events-only design makes deletion a one-way door, and
 * somebody who trashes a post by accident and restores it thirty seconds
 * later would carry the mark for good. The sweep stays silent once the
 * server's picture matches the site's, so this costs one call per change
 * rather than one per hour forever.
 *
 * ALSO FIXED: A TRASHED POST WAS BEING REPORTED AS ALIVE.
 *
 * post_missing() asked WordPress for trashed posts along with live ones, so
 * it found them and called them present — while the docblock directly above
 * it said "TRASHED COUNTS AS GONE". The test named "A TRASHED POST COUNTS AS
 * GONE" asserted that the string 'trash' APPEARED in the source, which is
 * the broken behaviour, so it passed by confirming the bug. It was a grep
 * over the source; the stub could not model statuses, so behaviour could not
 * be asked about. It can now, and the test asks.
 *
 * WHAT 0.4.5 CHANGED
 *
 * "Publish early" is no longer offered for a post that has been deleted, and
 * the handler behind it refuses the request even when the URL is reached by
 * hand or from an old tab.
 *
 * 0.4.3 fixed the state pill and the link on those rows and left the action
 * column alone, so six dead rows each kept a working "Publish early". Pressing
 * one would have reported success: wp_update_post() answers 0 for a missing
 * post id rather than a WP_Error, which is exactly what the handler was
 * checking for.
 *
 * WHAT 0.4.4 CHANGED
 *
 * "Remove campaign" now tells the server before it deletes the local record.
 *
 * It used to be entirely local, so the server went on believing a removed
 * campaign was running — and the history it keeps, which is the only copy
 * that survives a customer tidying their WordPress, could not tell a campaign
 * that finished from one that was thrown away.
 *
 * The call is best-effort and cannot block the removal: a site that is
 * offline, or whose licence has been revoked, must still be able to clear a
 * campaign off its own screen. See IE_Api::removed().
 *
 * WHAT 0.4.3 CHANGED
 *
 * The screen now notices when a post has been deleted.
 *
 * A campaign lives in wp_options and remembers each slot's post_id. Nothing
 * in that record watched the post, so deleting one left the row frozen: it
 * went on saying "Live" for a post that was gone, or "Overdue" for one that
 * was never coming. The topic stayed a link, to <a href="">, which reloaded
 * the same page when clicked.
 *
 * "Overdue" is this plugin's alarm for WP-Cron having stopped, so a deleted
 * post raised an alarm about the scheduler. On a real site that sent two
 * people after a scheduler that was working perfectly, for an evening, while
 * the heading said "6 of 6 scheduled, 1 live, publishing on schedule" about
 * six posts that did not exist.
 *
 * Deleted slots are now excluded from those counts, shown as "Post deleted"
 * in grey rather than Overdue in red, no longer linked, and the campaign
 * carries one plain-English notice saying what happened and what to do. A
 * slot with NO post_id is untouched — that is "Arriving", and always was.
 *
 * WHAT 0.4.2 CHANGED
 *
 * The second tab is now "Campaigns needing approval" rather than "Waiting for
 * you". The old name announced that something was owed without saying what,
 * and the thing worth knowing before clicking is that approving is the moment
 * credits are spent. The empty state moved with it.
 *
 * WHAT 0.3.2 CHANGED
 *
 * The Campaigns screen is now four tabs — In progress, Waiting for you,
 * Completed, New campaign — instead of one page carrying all of it at once.
 * (That second tab is called "Campaigns needing approval" from 0.4.2; the old
 * name is kept here because this paragraph is the record of what 0.3.2 did.)
 *
 * "Waiting for you" is the one that did not exist before, and its absence was
 * the real problem: a campaign that has been planned but not approved has had
 * nothing written and nothing charged, yet it sat in the main list looking
 * exactly like a running one. The only clue it had not started was a price on
 * a button. It now has its own tab, its own count in amber, and a line at the
 * top saying plainly that nothing here has been charged.
 *
 * Completed campaigns are paged rather than folded into a <details>. They only
 * ever accumulate — a fortnightly campaign makes twenty-six a year, and
 * nothing removes them, because the posts belong to the owner and the record
 * of what was charged has to survive.
 *
 * Five words for five states, used in every table: Live, Scheduled, Arriving,
 * Overdue, Failed. The same post used to be "waiting to collect" in one table
 * and "not written yet" in another, on the same screen. Neither described what
 * the owner sees; both described the plumbing.
 *
 * "Publish now" is now "Publish early", and a link rather than a button. Six
 * buttons made the loudest control on the page the one that discards the
 * schedule the owner just paid to plan.
 *
 * The search-term column is behind a toggle. It was the widest column and, in
 * monospace, the most eye-catching, for a value that matters when diagnosing
 * and never when glancing.
 *
 * WHAT 0.3.1 CHANGED
 *
 * Running out of credits is no longer a dead end. It is the most common wall
 * a self-serve customer hits, and the screen used to show them the shortfall
 * and nothing else — no mention that the balance lives on another site, let
 * alone which one. The server now sends the address along with the refusal
 * and the notice carries a Buy credits button.
 *
 * The API layer was throwing that detail away: any non-2xx became a WP_Error
 * holding the message and the status code, so the structured part of the
 * body — which says WHY, and what to do — never reached the screen. It now
 * travels with the error.
 *
 * Also corrected a notice that had gone stale. The plan screen warned that
 * posts would "pause when the balance runs out", which was true when posts
 * were written one a week and stopped being true when writing moved into a
 * single batch. The server refuses the whole run now, and says so.
 *
 * WHAT 0.3.0 CHANGED
 *
 * A site can run several campaigns at once — it always could, since a campaign
 * is keyed on its own target page — but the screen was built as though there
 * would only ever be one. Each card rendered its full slot table, so four
 * campaigns meant forty-eight rows of scrolling, and the question an owner
 * actually opens this page to ask, "what is publishing this week", could not
 * be answered from it at all: every campaign knows only its own dates.
 *
 * So there is now a "Coming up" table across all campaigns, in date order,
 * with overdue posts sorted to the top where they belong. Campaign cards fold
 * their slot table away once there is more than one, finished campaigns move
 * into a collapsed section, and days carrying two posts are flagged — a clash
 * no single campaign can see, and the pattern that most makes a blog read as
 * automated.
 *
 * The version number matters more than usual here: 0.1.0 and 0.2.0 talk to
 * completely different endpoints, so a site running the old one against the new
 * server gets 404s, and the plugin list is the only place anyone can tell them
 * apart. Bump this on every change that alters what is sent or received. It
 * also travels outbound as X-IE-Version, which is what lets the server say
 * "that site is on an old build" rather than guessing at a mystery.
 * ---------------------------------------------------------------------------
 *
 * @package interlink-engine
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'IE_VERSION', '0.34.0' );
define( 'IE_FILE', __FILE__ );
define( 'IE_DIR', plugin_dir_path( __FILE__ ) );
define( 'IE_URL', plugin_dir_url( __FILE__ ) );

require_once IE_DIR . 'includes/class-ie-signing.php';
require_once IE_DIR . 'includes/class-ie-settings.php';
require_once IE_DIR . 'includes/class-ie-api.php';
require_once IE_DIR . 'includes/class-ie-campaigns.php';
require_once IE_DIR . 'includes/class-ie-links.php';
require_once IE_DIR . 'includes/class-ie-publisher.php';
require_once IE_DIR . 'includes/class-ie-rest.php';
require_once IE_DIR . 'includes/class-ie-seo.php';
require_once IE_DIR . 'includes/class-ie-hygiene.php';
require_once IE_DIR . 'includes/class-ie-metabox.php';

/* The <title> and the meta description, for every theme that does not read
 * the plugin's meta itself — which is every theme but the generated ones.
 *
 * NOT behind is_admin(), and the hooks it registers only fire on the front
 * end anyway. Registering it unconditionally keeps the class loaded for
 * anything that wants to ask whether another SEO plugin is present. */
IE_SEO::boot();

/* The author archive and the category archives — out of wp-sitemap.xml, out
 * of the index, and in the author's case out of existence.
 *
 * Decides for itself whether this is a site the plugin built, by asking
 * whether anything published here lacks `_ie_campaign`. On somebody's own
 * site every hook it registers returns without doing anything. */
IE_Hygiene::boot();

/* The box for editing the title tag and the meta description.
 *
 * Registered outside the is_admin() block below on purpose: save_post fires
 * for the REST request the block editor makes, and whether that counts as
 * admin has changed between WordPress versions. Its own hooks only do
 * anything on the editor screen and on a save, so loading it always costs
 * nothing and removes a class of version-dependent silence. */
IE_Metabox::boot();

if ( is_admin() ) {
	require_once IE_DIR . 'includes/class-ie-admin.php';
	IE_Admin::init();
}

IE_Rest::init();

/**
 * Watches for a post going public, so the placeholders pointing at it can
 * become real links.
 *
 * Registered unconditionally, including in wp-admin, because a post can be
 * published by WP-Cron, by the server's ping, or by the owner pressing the
 * button — and all three have to switch the links on.
 */
IE_Publisher::init();

/**
 * The catch-up run.
 *
 * The server's ping is the primary trigger, but a site can be unreachable when
 * it fires — maintenance mode, a firewall, an expired certificate. This does
 * the same two jobs unaided: publish scheduled posts WP-Cron has missed, and
 * collect any writing that has not come over yet.
 *
 * It is a BACKSTOP, not the mechanism, and the reason is worth restating: it
 * runs on WP-Cron, WP-Cron only fires when someone visits the site, and a new
 * plumber's blog has no visitors. A site relying on this alone would publish
 * nothing. That is exactly why the schedule lives on the server.
 */
add_action( 'ie_catch_up', array( 'IE_Publisher', 'run_catch_up' ) );

/**
 * Migrations that have to run after an UPGRADE, not only an activation.
 *
 * NOT register_activation_hook(), and that is the whole point of this block.
 * Updating a plugin by uploading a new ZIP does not reliably fire the
 * activation hook — the site is already active and stays active. A migration
 * parked there runs for new installs and silently skips every existing one,
 * which is the population it was written for.
 *
 * So: compare the stored version with the running one on every request, do the
 * work when they differ, and write the new version down. The early return is
 * one option read on a cached autoloaded option; it costs nothing.
 *
 * `plugins_loaded` rather than `admin_init` because a site nobody visits in
 * wp-admin still needs this — the whole failure being fixed here is a site
 * that publishes nothing while its owner is not looking.
 */
add_action( 'plugins_loaded', function () {
	if ( get_option( 'ie_version', '' ) === IE_VERSION ) {
		return;
	}

	// The 0.15.0 migration: fastwebsitegenerator.com no longer resolves.
	if ( IE_Settings::migrate_server_url() ) {
		IE_Publisher::log( 'server_url migrated to ' . IE_Settings::server_url() );
	}

	update_option( 'ie_version', IE_VERSION );
}, 1 );

register_activation_hook( __FILE__, function () {
	if ( ! wp_next_scheduled( 'ie_catch_up' ) ) {
		wp_schedule_event( time() + HOUR_IN_SECONDS, 'hourly', 'ie_catch_up' );
	}
} );

register_deactivation_hook( __FILE__, function () {
	wp_clear_scheduled_hook( 'ie_catch_up' );
} );

/**
 * Deliberately NO uninstall handler that deletes posts.
 *
 * The posts belong to the site owner. If they remove the plugin, the writing,
 * the links and the structure stay exactly where they are — they simply stop
 * getting new ones. A product that takes the content away when you stop paying
 * is a much harder thing to sell, and a worse thing to have sold.
 */
