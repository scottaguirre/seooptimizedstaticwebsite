<?php
/**
 * The archives WordPress makes that nobody asked for.
 *
 * WHAT THIS IS ABOUT, AND WHO CAUSED IT: nobody here. Since WordPress 5.5
 * every installation publishes /wp-sitemap.xml with four sections — posts,
 * pages, taxonomies and users — whatever theme is active and whatever plugins
 * are installed. The users section publishes /author/<slug>/, and on a fresh
 * install that slug is the LOGIN NAME of an account that can edit the site.
 * The taxonomies section publishes category archives, which on a blog written
 * by this plugin are excerpt lists competing with the articles they excerpt.
 *
 * Found on 4 October on Edwin's own blog. The generated themes have noindexed
 * author and date archives for months — and still never trimmed the sitemap,
 * so the site was telling Google "crawl this" and "do not index this" about
 * the same URL. The username leak stands regardless of noindex, because
 * wp-sitemap.xml is a public file that anyone can read directly.
 *
 * ===================================================================
 * WHEN IT RUNS, AND THE TWO RULES THAT WERE WRONG BEFORE THIS ONE
 * ===================================================================
 *
 * Edwin's requirement: touch the sites this system built, never somebody's
 * own site. Two rules were proposed and both were wrong, and the way they
 * were wrong is worth keeping.
 *
 *   "the first pillar claimed the home page"  — TOO NARROW. A pillar campaign
 *   that leaves the post archive as the front page is just as much a blog
 *   built from nothing, and it would have been skipped.
 *
 *   "a pillar campaign exists"  — TOO BROAD. Nothing stops somebody running a
 *   pillar campaign on a business site they already have, and this would then
 *   noindex category pages they rank for. Edwin spotted this one.
 *
 * Both were PROXIES for a question that can be asked directly:
 *
 *   IS THERE ANYTHING PUBLISHED ON THIS SITE THAT THIS PLUGIN DID NOT WRITE?
 *
 * Every post and page the publisher creates carries `_ie_campaign`. So one
 * query answers it, no guessing and no flag to keep in sync with reality.
 *
 * A FRESH WORDPRESS SHIPS "Hello world!" AND "Sample Page", and both count as
 * somebody else's. That is deliberate. Special-casing them means matching
 * titles or ids that differ by WordPress version and by language, and getting
 * that wrong means editing a stranger's sitemap. So the plugin stays out
 * until they are deleted — which is the first thing anyone does setting up a
 * blog — and the setting is there for anyone who wants it anyway.
 *
 * ERRING TOWARDS DOING NOTHING IS THE WHOLE POINT. A site that should have
 * been tidied and was not has an author archive in its sitemap. A site that
 * should not have been tidied and was has lost pages it ranked for, and the
 * owner has no idea why.
 *
 * @package interlink-engine
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class IE_Hygiene {

	/** '' = decide by looking at the site · 'on' / 'off' = the owner decided. */
	const SETTING = 'archive_hygiene';

	/** Per-request memo. Null means "not asked yet". */
	private static $owns = null;

	public static function boot() {
		add_filter( 'wp_sitemaps_add_provider', array( __CLASS__, 'sitemap_provider' ), 10, 2 );
		add_action( 'wp_head', array( __CLASS__, 'noindex' ), 1 );
		add_action( 'template_redirect', array( __CLASS__, 'redirect_author' ) );
	}

	/**
	 * Throw away the memo.
	 *
	 * A SHARED PROCESS IS NOT A SHARED REQUEST — the lesson `post_missing()`
	 * taught this suite in October. One WordPress request is one page load and
	 * the memo is correct for it; a test run is one process holding many
	 * notional sites, and without this a later test reads an earlier one's
	 * answer.
	 */
	public static function forget() {
		self::$owns = null;
	}

	/**
	 * Did this plugin write everything published here?
	 *
	 * ASKS THE DATABASE FOR ONE ROW. `NOT EXISTS` plus a limit of one means the
	 * query stops at the first piece of content that is not ours, which on a
	 * customer's site is almost immediately. Counting would walk the lot to
	 * learn something the first row already settled.
	 *
	 * PUBLISHED ONLY. A draft is not in the sitemap, is not indexed, and is
	 * not evidence of anything. Counting drafts would let one abandoned draft
	 * keep a blog untidied for ever.
	 *
	 * POSTS AND PAGES ONLY. Other post types belong to plugins that manage
	 * their own sitemap entries, and a WooCommerce product is not a statement
	 * about who owns the blog.
	 */
	public static function owns_whole_site() {
		if ( null !== self::$owns ) {
			return self::$owns;
		}

		$foreign = get_posts( array(
			'post_type'        => array( 'post', 'page' ),
			'post_status'      => 'publish',
			'posts_per_page'   => 1,
			'fields'           => 'ids',
			'no_found_rows'    => true,
			'suppress_filters' => false,
			'meta_query'       => array(   // phpcs:ignore WordPress.DB.SlowDBQuery
				array(
					'key'     => '_ie_campaign',
					'compare' => 'NOT EXISTS',
				),
			),
		) );

		self::$owns = empty( $foreign );

		return self::$owns;
	}

	/**
	 * Should the tidying run at all?
	 *
	 * THE SETTING WINS WHEN IT HAS BEEN SET, and that is why it stores three
	 * states rather than a boolean. A checkbox cannot say "I have not decided"
	 * — unticked and never-seen look identical — so the automatic rule could
	 * never tell "the owner turned this off" from "the owner has not been
	 * here". An empty value is the absence of a decision; 'on' and 'off' are
	 * decisions, and neither is overruled by what the site looks like.
	 */
	public static function active() {
		$choice = (string) IE_Settings::get( self::SETTING, '' );

		if ( 'on' === $choice ) {
			return true;
		}

		if ( 'off' === $choice ) {
			return false;
		}

		return self::owns_whole_site();
	}

	/**
	 * Drop the author and taxonomy sections from wp-sitemap.xml.
	 *
	 * @param object $provider the provider WordPress is about to register
	 * @param string $name     'posts' | 'taxonomies' | 'users'
	 * @return object|false
	 */
	public static function sitemap_provider( $provider, $name ) {
		if ( ! in_array( $name, array( 'users', 'taxonomies' ), true ) ) {
			return $provider;
		}

		return self::active() ? false : $provider;
	}

	/**
	 * `noindex, follow` on the archives nobody searches for.
	 *
	 * REMOVING A URL FROM A SITEMAP DOES NOT DE-INDEX IT. A sitemap says what
	 * is worth crawling; it says nothing about what to drop. Anything already
	 * in the index stays until a page says otherwise, and this is the page
	 * saying otherwise.
	 *
	 * `follow`, NOT `nofollow`: the links on these archives point at real
	 * articles and are a crawl path worth keeping. Blocking them discards that
	 * for nothing.
	 *
	 * THE BLOG ARCHIVE ITSELF IS NOT IN THE LIST, and leaving it out is the
	 * point rather than an oversight. On a pillar campaign that did not claim
	 * the home page, the post index IS the front page — the most important URL
	 * on the site, and noindexing it would take the whole blog out of search.
	 *
	 * THE is_front_page() / is_home() GUARD BELOW GUARDS NOTHING REACHABLE
	 * TODAY, and saying so is better than implying otherwise. WordPress serves
	 * the site root as either the posts index or a static page, so none of
	 * is_author(), is_category(), is_tag(), is_date() or is_tax() can be true
	 * there — the list alone already declines. Deleting the guard changes no
	 * behaviour and survives this suite, correctly.
	 *
	 * It stays because the tempting future edit is to add is_home() to the
	 * list — "the blog archive is a thin archive too" — and on a blog whose
	 * archive is the front page that one line would be the worst bug this
	 * plugin could ship. The guard makes that edit harmless instead of fatal.
	 */
	public static function noindex() {
		if ( is_front_page() || is_home() ) {
			return;
		}

		if ( ! is_author() && ! is_category() && ! is_tag() && ! is_date() && ! is_tax() ) {
			return;
		}

		if ( ! self::active() ) {
			return;
		}

		echo "\n" . '<meta name="robots" content="noindex, follow">' . "\n";
	}

	/**
	 * Send the author archive to the home page.
	 *
	 * NOINDEX ALONE LEAVES THE URL ANSWERING, and the URL is the problem: it
	 * confirms a username to anybody who types it, whether or not Google shows
	 * the page. A 301 stops it answering.
	 *
	 * CATEGORIES ARE DELIBERATELY NOT REDIRECTED. A category archive is
	 * something an owner may link from a menu; noindex keeps it out of search
	 * while leaving it usable. An author archive on a blog with one writer has
	 * no such use.
	 *
	 * 301 rather than 302 because the answer is permanent, which also
	 * consolidates any link value onto the home page instead of parking it.
	 */
	public static function redirect_author() {
		if ( ! is_author() ) {
			return;
		}

		if ( ! self::active() ) {
			return;
		}

		wp_safe_redirect( home_url( '/' ), 301 );
		exit;
	}
}
