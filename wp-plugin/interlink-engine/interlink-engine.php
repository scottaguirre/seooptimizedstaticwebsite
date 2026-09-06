<?php
/**
 * Plugin Name:       Interlink Engine
 * Plugin URI:        https://example.com/interlink-engine
 * Description:       Plans a quarter of blog posts, writes them all at once, schedules them across the weeks, and wires every one into the service page you want to rank.
 * Version:           0.3.2
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Quality Sites
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
 * WHAT 0.3.2 CHANGED
 *
 * The Campaigns screen is now four tabs — In progress, Waiting for you,
 * Completed, New campaign — instead of one page carrying all of it at once.
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

define( 'IE_VERSION', '0.3.2' );
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
