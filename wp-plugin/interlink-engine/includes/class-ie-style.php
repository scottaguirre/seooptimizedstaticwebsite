<?php
/**
 * How a generated post LOOKS, on a theme that was not built for it.
 *
 * WHAT WAS WRONG
 *
 * IE_Links::render() produces bare HTML — <h2> and <p>, nothing else. No
 * classes, no wrapper, and until now the plugin shipped no CSS at all. So the
 * appearance of every post it writes is entirely whatever the customer's
 * active theme does with unadorned tags.
 *
 * On a theme with good typography that is the right answer and this file
 * should stay out of the way. On a default or badly-set-up one it is a wall
 * of full-width paragraphs at whatever line height the theme forgot to set.
 *
 * WHY THIS IS A FILTER AND NOT A CHANGE TO render()
 *
 * The obvious move is to emit classes from the renderer. It was rejected for
 * two reasons, and the second is the one that matters:
 *
 *   1. It only helps posts written AFTER the upgrade. Every post already
 *      published — which is all of them — keeps the old markup for ever.
 *   2. IT WOULD MEAN REWRITING post_content. That string is a customer's
 *      paid-for article, it has already been published, and they may have
 *      edited it. A bug in a renderer change corrupts it. A bug here shows
 *      the wrong margin.
 *
 * Wrapping at display time costs one div and touches nothing in the database.
 *
 * NOTHING HERE TOUCHES CONTENT THE PLUGIN DID NOT CREATE. Both entry points
 * check `_ie_campaign`, the same key IE_SEO uses and the same key the
 * publisher writes on every insert. A customer's own posts and pages render
 * exactly as their theme renders them, with the stylesheet not even loaded.
 *
 * WHAT THE CSS SETS, AND WHAT IT STILL WILL NOT
 *
 * 0.45.0 shipped spacing only — no colour of any kind — on the argument that
 * colour is the theme's identity. 0.46.0 took that back, deliberately, after
 * the spacing-only version was seen next to the alternatives: it is correct
 * and it looks like nothing. There is now ONE accent colour, on headings,
 * links and bullets, and boxes around lists and quotes.
 *
 * The two rules that survived the change are the ones that matter:
 *
 *   NO TYPEFACE. The font is the theme's, always.
 *   NO COLOUR ON BODY TEXT. Paragraphs inherit, so whatever the theme has
 *   decided is readable on its own background stays readable. The boxes are
 *   the theme's text colour at 5% over transparency, which means a box
 *   cannot come out dark on a light page — there is no dark value in it.
 *
 * The details, and the tests that hold them, are in assets/blog.css.
 *
 * @package interlink-engine
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class IE_Style {

	/** The wrapper every rule in blog.css hangs off. */
	const WRAP_CLASS = 'ie-post';

	/**
	 * Put on <body>, so the stylesheet can reach the POST TITLE.
	 *
	 * THE TITLE IS NOT OURS TO WRAP. WordPress renders it from the theme's
	 * template, above and outside the_content, so no amount of filtering
	 * content can touch it. On a theme with no measure on its header that
	 * means a 60-character headline running the full width of a desktop
	 * monitor on one line, while the article underneath sits at 68ch — the
	 * two do not look like parts of the same page.
	 *
	 * A class on <body> is the narrowest tool that reaches it. It is added
	 * ONLY on a singular view of a post carrying `_ie_campaign`, and only
	 * while the styling is switched on, so the rules behind it are no more
	 * widely scoped than the rest of the file: a customer's own pages never
	 * carry the class and the stylesheet is not even loaded there.
	 */
	const BODY_CLASS = 'ie-styled';

	/** Handle for the stylesheet. */
	const HANDLE = 'ie-blog';

	/**
	 * The key inside ie_settings that switches this off.
	 *
	 * IN IE_Settings RATHER THAN AN OPTION ROW OF ITS OWN, like every other
	 * preference this plugin keeps. One row to read, one row to delete on
	 * uninstall, and the admin screen already has a save path into it.
	 *
	 * Declared here and read by the admin screen, because a key spelled out
	 * in two files gets renamed in one of them — and the failure is silent:
	 * the box saves, the front end reads the old key, nothing changes, and
	 * nothing anywhere says why.
	 */
	const SETTING = 'blog_styles';

	public static function boot() {
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue' ) );

		/* PRIORITY 20, AFTER wpautop (10).
		 *
		 * wpautop turns bare line breaks into paragraphs. Running before it
		 * would hand it a string that starts with a <div>, and it treats a
		 * block-level opener as a reason to leave the first chunk alone —
		 * the opening paragraph would come out unwrapped while every other
		 * one was fine.
		 *
		 * It also means the content this wraps is the content the reader
		 * sees, including whatever other plugins have already added. */
		add_filter( 'the_content', array( __CLASS__, 'wrap' ), 20 );

		/* The only hook here that affects anything outside the article, and
		 * it affects it by adding one class name to <body>. Everything that
		 * class does is in blog.css, which is not loaded unless this is one
		 * of our posts anyway. */
		add_filter( 'body_class', array( __CLASS__, 'body_class' ) );
	}

	/**
	 * Mark the page, so the stylesheet can reach the title.
	 *
	 * @param array $classes
	 * @return array
	 *
	 * THE SAME TWO CONDITIONS AS EVERYTHING ELSE. A page that does not get
	 * the stylesheet must not get the class either — a stray class name is
	 * harmless today and becomes a selector somebody writes against later.
	 */
	public static function body_class( $classes ) {
		if ( self::enabled() && self::ours() ) {
			$classes[] = self::BODY_CLASS;
		}

		return (array) $classes;
	}

	/**
	 * Is the page being viewed an article this plugin wrote?
	 *
	 * @return bool
	 *
	 * THE SAME THREE QUESTIONS AS IE_SEO::post_id(), and deliberately a
	 * separate copy rather than a shared helper: that one is private, and
	 * making it public to save six lines would turn an internal guard into
	 * an interface two classes depend on. Six lines is cheaper.
	 *
	 * IT ANSWERS bool WHERE THAT ONE ANSWERS AN ID, because nothing here
	 * wants the id — both callers only ask whether to act. Returning one
	 * anyway left a value no test could be written against, which is how a
	 * line stops being checked.
	 */
	private static function ours() {
		/* FIRST, because the other two questions are meaningless otherwise.
		 * the_content runs for excerpts, related-post teasers and widgets,
		 * and on an archive the queried object is the TERM — whose id can
		 * perfectly well collide with a post id of ours. */
		if ( ! is_singular() ) {
			return false;
		}

		$id = (int) get_queried_object_id();

		/* 0 ON A 404 and on the handful of singular-ish views with no object
		 * behind them. Not a formality: `get_post_metadata` is a public
		 * filter, and a caching or translation plugin that answers it
		 * without checking the id hands back a value for post 0 — so asking
		 * about post 0 is not a safe way to find out there is no post. */
		if ( ! $id ) {
			return false;
		}

		return '' !== (string) get_post_meta( $id, '_ie_campaign', true );
	}

	/**
	 * Has the owner switched the styling off?
	 *
	 * DEFAULTS TO ON, and off is a real answer rather than a missing one.
	 * Somebody whose theme already handles this perfectly should be able to
	 * say so without deactivating the plugin that writes their posts.
	 *
	 * ONLY THE EXACT STRING '0' MEANS OFF. The admin screen writes '1' or
	 * '0' and nothing else, so anything unrecognised — a half-finished
	 * import, a value from a future version of that form, a row edited by
	 * hand — lands on the behaviour that was already running rather than
	 * silently switching a customer's site.
	 */
	public static function enabled() {
		return '0' !== (string) IE_Settings::get( self::SETTING, '1' );
	}

	/** Load the stylesheet, and only on a post this plugin wrote. */
	public static function enqueue() {
		if ( ! self::enabled() || ! self::ours() ) {
			return;
		}

		wp_enqueue_style(
			self::HANDLE,
			IE_URL . 'assets/blog.css',
			array(),
			IE_VERSION
		);
	}

	/**
	 * Wrap the article so the stylesheet has something to hang off.
	 *
	 * @param string $content
	 * @return string
	 *
	 * RETURNS THE CONTENT UNTOUCHED unless this is one of ours and the
	 * styling is on. `the_content` runs for excerpts, widgets, related-post
	 * blocks and whatever else a theme chooses to pass through it, so the
	 * is_singular() check inside ours() is doing real work here — not
	 * just ownership, but "this is the article itself".
	 */
	public static function wrap( $content ) {
		if ( ! self::enabled() || ! self::ours() ) {
			return $content;
		}

		/* Guarded against running twice. A theme or plugin that calls
		 * the_content() more than once on the same page — a related-posts
		 * block, a print view — would otherwise nest the wrappers, and the
		 * padding would compound. */
		if ( false !== strpos( $content, 'class="' . self::WRAP_CLASS . '"' ) ) {
			return $content;
		}

		return '<div class="' . esc_attr( self::WRAP_CLASS ) . '">' . $content . '</div>';
	}
}
