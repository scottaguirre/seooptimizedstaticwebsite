<?php
/**
 * The title tag and the meta description, on any theme.
 *
 * WHAT WAS WRONG, AND IT WAS WRONG FOR EVERY CUSTOMER NOT USING A GENERATED
 * THEME.
 *
 * IE_Publisher has always WRITTEN the SEO title and description into post
 * meta. Nothing in this plugin ever PUT THEM ON THE PAGE. The generated themes
 * do that — they filter pre_get_document_title and print the description in
 * their own wp_head — so on one of those sites everything worked and the gap
 * was invisible.
 *
 * On any other theme the meta sat in the database, unread, while WordPress
 * fell back to its default. Edwin found it on a Kadence site:
 *
 *   a post   <title>What Information Do You Need … — hilltophomeloans.net</title>
 *   the home <title>hilltophomeloans.net</title>
 *   neither  no <meta name="description"> at all
 *
 * The post's hand-written title was in the database the whole time, and the
 * domain was eating the end of a headline written to fit — the same fault
 * 0.12.0 fixed for generated themes, surviving everywhere else.
 *
 * The home page is the worse of the two. WordPress titles the front page with
 * the SITE NAME, so the article's own headline appeared nowhere.
 *
 * NOTHING HERE TOUCHES CONTENT THE PLUGIN DID NOT CREATE. Every entry point
 * checks `_ie_campaign` first. A customer's own pages, their posts, their
 * archives and their home page are left exactly as their theme renders them.
 *
 * IT CANNOT FIGHT A GENERATED THEME EITHER. That theme's filter reads the same
 * meta key and returns the same string, so whichever of the two runs last, the
 * answer is identical. No detection, no priority war.
 *
 * @package interlink-engine
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class IE_SEO {

	public static function boot() {
		add_filter( 'pre_get_document_title', array( __CLASS__, 'title' ), 20 );
		add_action( 'wp_head', array( __CLASS__, 'description' ), 1 );

		/* FEED THE OTHER PLUGIN RATHER THAN RACE IT — added 0.21.0.
		 *
		 * Edwin's requirement: our title and description should win on the
		 * posts this plugin wrote, and change nothing anywhere else.
		 *
		 * The naive way is to print our own tags alongside theirs. That gives
		 * the page TWO <title> tags and TWO descriptions, and which one a
		 * crawler believes depends on plugin activation order — a bug that
		 * surfaces months later when somebody reorders their plugins.
		 *
		 * These four hooks are the plugins' OWN output filters. Returning our
		 * value through them leaves the page with exactly ONE of each tag,
		 * rendered by whatever plugin is installed, containing our text. No
		 * priority war, nothing to suppress.
		 *
		 * HOOK NAMES READ FROM THE VENDORS' DOCUMENTATION, not from memory. A
		 * misspelled filter name does not error — it never fires, and the
		 * feature ships doing nothing at all.
		 *   developer.yoast.com/features/seo-tags/titles/api/
		 *   developer.yoast.com/features/seo-tags/descriptions/api/
		 *   rankmath.com/docs/filters-and-hooks/frontend/meta-data/
		 *   seopress.org/support/hooks/filter-meta-title/
		 *   seopress.org/support/hooks/filter-meta-description/
		 *   aioseo.com/docs/aioseo_title/ · aioseo.com/docs/aioseo_description/
		 *
		 * ALL FOUR PLUGINS, from 0.23.0. SEOPress and AIOSEO were left out of
		 * 0.21.0 for one reason and one only — their hook names had not been
		 * checked — and the note here said so rather than pretending the gap
		 * was a decision. They are checked now.
		 *
		 * AIOSEO ALSO SETTLES AN OLDER WORRY, by making it irrelevant. The
		 * open question was where version 4 stores its data, because it moved
		 * out of post meta into a table of its own and update_post_meta could
		 * not reach it. True, and it stopped mattering the moment this class
		 * fed filters instead of writing fields: THE VALUE IS HANDED OVER AS
		 * THE PLUGIN IS ABOUT TO PRINT IT, so where it keeps its own copy is
		 * not our business. */
		add_filter( 'wpseo_title', array( __CLASS__, 'filter_title' ), 20 );
		add_filter( 'wpseo_metadesc', array( __CLASS__, 'filter_description' ), 20 );
		add_filter( 'rank_math/frontend/title', array( __CLASS__, 'filter_title' ), 20 );
		add_filter( 'rank_math/frontend/description', array( __CLASS__, 'filter_description' ), 20 );
		add_filter( 'seopress_titles_title', array( __CLASS__, 'filter_title' ), 20 );
		add_filter( 'seopress_titles_desc', array( __CLASS__, 'filter_description' ), 20 );
		add_filter( 'aioseo_title', array( __CLASS__, 'filter_title' ), 20 );
		add_filter( 'aioseo_description', array( __CLASS__, 'filter_description' ), 20 );
	}

	/**
	 * Our title, handed to whichever SEO plugin is about to print one.
	 *
	 * NO another_seo_plugin() CHECK HERE, and its absence is deliberate.
	 * These filters only ever run from inside the plugin that defines them,
	 * so asking whether that plugin is active is asking a question already
	 * answered by having been called.
	 *
	 * THE OWNERSHIP CHECK IS STILL THERE, through post_id(). On a customer's
	 * own page this returns their value untouched, which is the whole point:
	 * their forty existing pages keep the titles they wrote in Yoast.
	 *
	 * @param string $value what that plugin was going to output
	 */
	public static function filter_title( $value ) {
		$id = self::post_id();

		if ( ! $id ) {
			return $value;
		}

		$ours = (string) get_post_meta( $id, '_ie_meta_title', true );

		return '' !== $ours ? $ours : $value;
	}

	/** @param string $value */
	public static function filter_description( $value ) {
		$id = self::post_id();

		if ( ! $id ) {
			return $value;
		}

		$ours = (string) get_post_meta( $id, '_ie_meta_description', true );

		return '' !== $ours ? $ours : $value;
	}

	/**
	 * Is another SEO plugin doing this job?
	 *
	 * STAND DOWN FROM PRINTING, NOT FROM WINNING — and the distinction is the
	 * whole of 0.21.0. Yoast, Rank Math, SEOPress and All in One SEO each
	 * print a title and a description of their own. A second pair from this
	 * class means two <title> tags and two descriptions, with the winner
	 * decided by plugin activation order.
	 *
	 * So title() and description() go quiet when one of them is active. OUR
	 * VALUE STILL WINS, through that plugin's own output filters registered
	 * in boot() — one tag each, rendered by them, containing our text.
	 *
	 * THE OLD REASON WRITTEN HERE IS GONE, and leaving it would have been
	 * worse than saying nothing: it said the publisher writes into their meta
	 * keys so standing down loses nothing. It no longer does. 0.21.0 removed
	 * those writes precisely because a copy in their box is a field the owner
	 * can edit to no effect once our filter overrides the output.
	 *
	 * Checked by CONSTANT, not by a plugin file path. A renamed folder, a
	 * premium build, a must-use install — the path moves, the constant does
	 * not. And `defined()` is only true once that plugin has actually loaded,
	 * which is the question being asked.
	 */
	public static function another_seo_plugin() {
		return defined( 'WPSEO_VERSION' )          // Yoast SEO
			|| defined( 'RANK_MATH_VERSION' )      // Rank Math
			|| defined( 'SEOPRESS_VERSION' )       // SEOPress
			|| defined( 'AIOSEO_VERSION' );        // All in One SEO
	}

	/**
	 * Which post this request is about, if the plugin wrote it.
	 *
	 * THE FRONT PAGE IS A SINGULAR VIEW TOO, and it is the case that made this
	 * helper necessary. is_singular() is true for a static front page, but the
	 * post id has to come from get_queried_object_id() either way — on the
	 * front page `in_the_loop` has not started when pre_get_document_title
	 * runs, so get_the_ID() answers false.
	 *
	 * @return int 0 when this is not one of ours
	 */
	private static function post_id() {
		if ( ! is_singular() ) {
			return 0;
		}

		$id = (int) get_queried_object_id();

		if ( ! $id ) {
			return 0;
		}

		/* THE OWNERSHIP CHECK, and every public method goes through it. This
		 * is what keeps the plugin off a customer's own pages. */
		if ( '' === (string) get_post_meta( $id, '_ie_campaign', true ) ) {
			return 0;
		}

		return $id;
	}

	/**
	 * The <title>, from the title the writer actually wrote.
	 *
	 * RETURNS THE META VERBATIM, with no site name appended. That is the whole
	 * point: WordPress's default is "Post Title — Site Name", and on a domain
	 * for a name the suffix is dead weight. It is already shown beneath the
	 * result, and here it eats characters off the end of a headline composed
	 * to fit.
	 *
	 * @param string $title what WordPress was going to use
	 */
	public static function title( $title ) {
		if ( self::another_seo_plugin() ) {
			return $title;
		}

		$id = self::post_id();

		if ( ! $id ) {
			return $title;
		}

		$ours = (string) get_post_meta( $id, '_ie_meta_title', true );

		/* EMPTY MEANS LEAVE IT ALONE. A post written before the plugin stored
		 * a title has none, and returning '' would give it a blank <title>
		 * rather than WordPress's imperfect-but-present default. */
		return '' !== $ours ? $ours : $title;
	}

	/**
	 * <meta name="description">, printed in wp_head.
	 *
	 * AT PRIORITY 1, so it is near the top of the head where a description
	 * conventionally sits, and so a theme printing its own at the default
	 * priority of 10 comes after. Two descriptions would be the theme's fault
	 * rather than this plugin's, but the order at least makes ours the first
	 * one read.
	 */
	public static function description() {
		if ( self::another_seo_plugin() ) {
			return;
		}

		$id = self::post_id();

		if ( ! $id ) {
			return;
		}

		$description = (string) get_post_meta( $id, '_ie_meta_description', true );

		if ( '' === $description ) {
			return;
		}

		/* esc_attr, and the value was already sanitize_text_field'd when it was
		 * stored. Escaped again here because storage outlives validation: this
		 * row can be edited in Custom Fields, by another plugin, or by a
		 * database import, and none of those go through the writer. */
		echo "\n" . '<meta name="description" content="' . esc_attr( $description ) . '">' . "\n";
	}
}
