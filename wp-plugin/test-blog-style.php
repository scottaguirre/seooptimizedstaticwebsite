<?php
/**
 * test-blog-style.php
 *
 * The one piece of CSS this plugin has ever shipped, and the rules about
 * where it is allowed to go.
 *
 * WHAT THIS IS GUARDING
 *
 * Until 0.45.0 the plugin wrote posts and shipped no styling at all. How a
 * generated article looked was entirely whatever the customer's theme did
 * with bare <h2> and <p>. On a well-made theme that is the right answer. On a
 * default one it is a wall of full-window paragraphs.
 *
 * So there is now a stylesheet. A stylesheet is a plugin reaching OUT of its
 * own box and changing how somebody else's site looks, which is the thing
 * customers notice fastest and forgive slowest. Almost every test below is
 * about containment:
 *
 *   - it loads on a post carrying `_ie_campaign` and on nothing else
 *   - the_content runs for excerpts, related-post blocks and widgets, and
 *     must come back byte-identical from all of them
 *   - every rule in the file is scoped under .ie-post
 *   - no font, no colour, no background, no !important — the theme's
 *     identity is the theme's
 *
 * AND IT DOES NOT REWRITE post_content. The wrapper is added at display time.
 * A customer's paid-for, possibly hand-edited article is never touched, so
 * the worst a bug here can do is show the wrong margin.
 *
 *   php wp-plugin/test-blog-style.php
 */

error_reporting( E_ALL );

define( 'ABSPATH', '/tmp/' );
define( 'IE_VERSION', '0.52.0' );
define( 'IE_DIR', __DIR__ . '/interlink-engine/' );
define( 'IE_URL', 'http://site/wp-content/plugins/interlink-engine/' );

/* --------------------------------------------------------------------
 * Just enough WordPress
 *
 * The real class, not a stub of it. Everything below is WordPress.
 * ----------------------------------------------------------------- */

$GLOBALS['ie_hooks']    = array();   // hook name => list of { cb, priority }
$GLOBALS['ie_options']  = array();
$GLOBALS['ie_meta']     = array();   // post id => key => value
$GLOBALS['ie_singular'] = true;
$GLOBALS['ie_queried']  = 0;
$GLOBALS['ie_styles']   = array();   // what wp_enqueue_style was handed

function add_action( $hook, $cb, $priority = 10, $args = 1 ) {
	$GLOBALS['ie_hooks'][ $hook ][] = array( 'cb' => $cb, 'priority' => $priority );
	return true;
}
function add_filter( $hook, $cb, $priority = 10, $args = 1 ) {
	return add_action( $hook, $cb, $priority, $args );
}
function is_singular( $types = '' ) { return (bool) $GLOBALS['ie_singular']; }
function get_queried_object_id() { return (int) $GLOBALS['ie_queried']; }
function get_post_meta( $id, $key, $single = false ) {
	/* `ie_meta_wild` stands in for a site where some other plugin filters
	 * get_post_metadata and answers for any id at all, post 0 included. */
	if ( ! empty( $GLOBALS['ie_meta_wild'] ) ) {
		return 'c1';
	}
	return isset( $GLOBALS['ie_meta'][ $id ][ $key ] ) ? $GLOBALS['ie_meta'][ $id ][ $key ] : '';
}
function get_option( $k, $d = null ) {
	return array_key_exists( $k, $GLOBALS['ie_options'] ) ? $GLOBALS['ie_options'][ $k ] : $d;
}
function update_option( $k, $v, $autoload = null ) { $GLOBALS['ie_options'][ $k ] = $v; return true; }
function wp_enqueue_style( $handle, $src = '', $deps = array(), $ver = null, $media = 'all' ) {
	$GLOBALS['ie_styles'][] = array( 'handle' => $handle, 'src' => $src, 'ver' => $ver );
}
function esc_attr( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES ); }

/* ---- the settings screen ---- */

$GLOBALS['ie_caps']     = true;    // does the current user have manage_options
$GLOBALS['ie_referred'] = array(); // nonce actions check_admin_referer was given

function __( $s, $d = null ) { return $s; }
function esc_html__( $s, $d = null ) { return $s; }
function esc_html_e( $s, $d = null ) { echo htmlspecialchars( $s, ENT_QUOTES ); }
function esc_html( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES ); }
function esc_url( $u ) { return $u; }
function admin_url( $p = '' ) { return 'http://site/wp-admin/' . $p; }
function wp_nonce_field( $action ) { echo '<input type="hidden" name="_wpnonce" data-action="' . esc_attr( $action ) . '">'; }
function checked( $a, $b = true, $echo = true ) {
	$out = ( (string) $a === (string) $b ) ? ' checked' : '';
	if ( $echo ) { echo $out; }
	return $out;
}
function submit_button( $text = '', $type = 'primary' ) { echo '<button type="submit">' . esc_html( $text ) . '</button>'; }
function current_user_can( $cap ) { return (bool) $GLOBALS['ie_caps']; }
function wp_die( $message = '' ) { throw new Exception( 'wp_die: ' . $message ); }
function check_admin_referer( $action = -1, $name = '_wpnonce' ) {
	$GLOBALS['ie_referred'][] = $action;
	return true;
}
function add_query_arg( $args, $url = '' ) { return $url . '?' . http_build_query( $args ); }

/** Stands in for the redirect that ends every admin-post handler. */
class Redirected extends Exception {}
function wp_safe_redirect( $url, $status = 302 ) { throw new Redirected( $url ); }

/* THE REAL CLASSES, all three. IE_Settings because the switch lives in its
 * option and a stub would be a second copy of the merge-and-default rule;
 * IE_Admin because the checkbox and the handler it posts to are the feature,
 * and a source check cannot tell a form that saves from one that looks like
 * it does. */
require_once __DIR__ . '/interlink-engine/includes/class-ie-settings.php';
require_once __DIR__ . '/interlink-engine/includes/class-ie-style.php';
require_once __DIR__ . '/interlink-engine/includes/class-ie-admin.php';

/* --------------------------------------------------------------------
 * Harness
 * ----------------------------------------------------------------- */

$passed = 0; $failed = 0;

function test( $name, $fn ) {
	global $passed, $failed;
	try { $fn(); echo "  ok    $name\n"; $passed++; }
	catch ( Throwable $e ) { echo "  FAIL  $name\n        " . $e->getMessage() . "\n"; $failed++; }
}
function ok( $cond, $msg ) { if ( ! $cond ) { throw new Exception( $msg ); } }
function same( $a, $b, $msg = 'not equal' ) {
	ok( $a === $b, "$msg — expected " . var_export( $a, true ) . ', got ' . var_export( $b, true ) );
}
function section( $n ) { echo "\n$n\n\n"; }

const OURS   = 101;   // a post this plugin wrote
const THEIRS = 202;   // a page the customer wrote

function reset_state() {
	$GLOBALS['ie_meta_wild'] = false;
	$GLOBALS['ie_caps']      = true;
	$GLOBALS['ie_referred']  = array();
	$GLOBALS['ie_options']  = array();
	$GLOBALS['ie_styles']   = array();
	$GLOBALS['ie_singular'] = true;
	$GLOBALS['ie_queried']  = OURS;
	$GLOBALS['ie_meta']     = array(
		OURS   => array( '_ie_campaign' => 'c1' ),
		THEIRS => array(),
	);
}

/** What a published article actually looks like coming out of wpautop. */
const ARTICLE = "<p>An opening paragraph.</p>\n<h2>A heading</h2>\n<p>More, with a <a href=\"/x\">link</a>.</p>";

/* ================================================================== */

section( 'IT LOADS ON OUR POSTS AND NOWHERE ELSE' );

test( 'the stylesheet is enqueued on a post the plugin wrote', function () {
	reset_state();
	IE_Style::enqueue();

	same( 1, count( $GLOBALS['ie_styles'] ), 'the stylesheet did not load on our own post' );
	same( 'ie-blog', $GLOBALS['ie_styles'][0]['handle'] );
} );

test( 'NOT ON A PAGE THE CUSTOMER WROTE', function () {
	/* The whole contract. Forty pages somebody built by hand, and a plugin
	 * they installed to write blog posts must not restyle one of them. */
	reset_state();
	$GLOBALS['ie_queried'] = THEIRS;

	IE_Style::enqueue();

	same( array(), $GLOBALS['ie_styles'],
		'the stylesheet loaded on a page carrying no _ie_campaign' );
} );

test( 'not on an archive, a search page or the blog index', function () {
	/* is_singular() is false for all of them, and the queried object on a
	 * category archive is the TERM — whose id could collide with a post id
	 * carrying our meta. The singular check has to come first. */
	reset_state();
	$GLOBALS['ie_singular'] = false;

	IE_Style::enqueue();

	same( array(), $GLOBALS['ie_styles'], 'the stylesheet loaded on a non-singular view' );
} );

test( 'AND NOT WHEN NOTHING IS BEING QUERIED AT ALL', function () {
	/* get_queried_object_id() answers 0 on a 404 and on a few singular-ish
	 * views that have no object behind them.
	 *
	 * THE FIXTURE IS A HOSTILE ONE. `get_post_metadata` is a public filter,
	 * and a caching or multilingual plugin that answers it without checking
	 * the id first will hand back a value for post 0. Here every meta lookup
	 * says "yes, ours" — so the only thing that can still get this right is
	 * refusing to treat 0 as a post.
	 *
	 * The `if ( ! $id )` line in ours() is the whole of the defence, and it
	 * only became testable once that function started answering a bool: for
	 * as long as it returned an id, 0 fell through the ownership check and
	 * came back falsy by accident, and no mutation of the guard could
	 * change an outcome. */
	reset_state();
	$GLOBALS['ie_queried']   = 0;
	$GLOBALS['ie_meta_wild'] = true;

	IE_Style::enqueue();

	same( array(), $GLOBALS['ie_styles'],
		'the stylesheet loaded on a view with no post behind it' );
	same( ARTICLE, IE_Style::wrap( ARTICLE ),
		'content was wrapped on a view with no post behind it' );
} );

test( 'it is loaded from the plugin folder and versioned with the plugin', function () {
	/* The version is the cache-buster. Without it a customer who upgrades
	 * keeps the old file until their browser feels like asking again, and
	 * "I updated and nothing changed" is the support ticket. */
	reset_state();
	IE_Style::enqueue();

	same( IE_URL . 'assets/blog.css', $GLOBALS['ie_styles'][0]['src'] );
	same( IE_VERSION, $GLOBALS['ie_styles'][0]['ver'],
		'the stylesheet is not versioned, so upgrades will serve a cached copy' );
} );

section( 'THE MARK ON <body>, WHICH IS HOW THE TITLE IS REACHED' );

test( 'our post carries it', function () {
	reset_state();

	ok( in_array( 'ie-styled', IE_Style::body_class( array( 'single', 'post' ) ), true ),
		'the body class is missing, so the title keeps the theme\'s full width' );
} );

test( 'AND IT IS NOT ADDED ANYWHERE ELSE', function () {
	/* The class is the only thing this plugin puts outside the article, so
	 * it gets the same three questions as everything else. A stray class
	 * name is harmless on the day it ships and becomes a selector somebody
	 * writes against a year later. */
	reset_state();
	$GLOBALS['ie_queried'] = THEIRS;
	ok( ! in_array( 'ie-styled', IE_Style::body_class( array() ), true ),
		'a page the customer wrote was marked' );

	reset_state();
	$GLOBALS['ie_singular'] = false;
	ok( ! in_array( 'ie-styled', IE_Style::body_class( array() ), true ),
		'an archive was marked' );

	reset_state();
	IE_Settings::set( array( IE_Style::SETTING => '0' ) );
	ok( ! in_array( 'ie-styled', IE_Style::body_class( array() ), true ),
		'the page was marked with the styling switched off' );
} );

test( 'and the theme\'s own classes survive', function () {
	/* body_class is a filter over a list other plugins and the theme are
	 * also writing to. Returning our own array instead of adding to theirs
	 * would strip every class the theme lays out with. */
	reset_state();

	same( array( 'single', 'single-post', 'logged-in', 'ie-styled' ),
		IE_Style::body_class( array( 'single', 'single-post', 'logged-in' ) ) );
} );

test( 'it is registered as a filter, not just defined', function () {
	reset_state();
	$GLOBALS['ie_hooks'] = array();

	IE_Style::boot();

	ok( isset( $GLOBALS['ie_hooks']['body_class'] ),
		'nothing is hooked to body_class, so the title rules can never match' );
} );

section( 'The wrapper, and what it refuses to wrap' );

test( 'our article gets the class the stylesheet hangs off', function () {
	reset_state();
	$out = IE_Style::wrap( ARTICLE );

	ok( 0 === strpos( $out, '<div class="ie-post">' ), "did not wrap: $out" );
	ok( false !== strpos( $out, ARTICLE ), 'the article itself was altered' );
	same( '</div>', substr( $out, -6 ), 'the wrapper was not closed' );
} );

test( 'A CUSTOMER\'S CONTENT COMES BACK BYTE-IDENTICAL', function () {
	reset_state();
	$GLOBALS['ie_queried'] = THEIRS;

	same( ARTICLE, IE_Style::wrap( ARTICLE ),
		'the filter modified content the plugin did not write' );
} );

test( 'AND SO DOES AN EXCERPT, A WIDGET OR A RELATED-POSTS BLOCK', function () {
	/* the_content does not only run for the article. Themes pass excerpts,
	 * related-post teasers, print views and page-builder blocks through it,
	 * and a wrapper landing in a 200-pixel sidebar card with a 70ch measure
	 * on it looks broken. is_singular() inside ours() is what stops it. */
	reset_state();
	$GLOBALS['ie_singular'] = false;

	same( ARTICLE, IE_Style::wrap( ARTICLE ),
		'content was wrapped outside the single-post view' );
} );

test( 'empty content stays empty', function () {
	reset_state();
	$GLOBALS['ie_queried'] = THEIRS;

	same( '', IE_Style::wrap( '' ) );
} );

test( 'IT NEVER WRAPS TWICE', function () {
	/* A theme or plugin calling the_content() more than once on a page — a
	 * print view, a related-posts block, a page builder re-rendering — would
	 * otherwise nest the divs, and nothing about that is visible until a
	 * customer reports that their article is creeping inwards. */
	reset_state();

	$once  = IE_Style::wrap( ARTICLE );
	$twice = IE_Style::wrap( $once );

	same( $once, $twice, 'the wrapper nested on a second pass' );
	same( 1, substr_count( $twice, 'class="ie-post"' ) );
} );

section( 'The owner can switch it off' );

test( 'it is ON without anybody choosing anything', function () {
	/* No option row exists until somebody sets one, and on upgrade day
	 * nobody has. A feature that defaults to off is a feature that ships
	 * disabled for every existing customer. */
	reset_state();

	ok( IE_Style::enabled(), 'the styling defaults to off' );
	ok( false !== strpos( IE_Style::wrap( ARTICLE ), 'ie-post' ),
		'nothing was wrapped on a site that has never set the option' );
} );

test( 'AND OFF IS A REAL ANSWER', function () {
	/* Somebody whose theme already handles this perfectly, or whose theme
	 * fights it, must be able to say so without deactivating the plugin that
	 * writes their posts. */
	reset_state();
	IE_Settings::set( array( IE_Style::SETTING => '0' ) );

	ok( ! IE_Style::enabled(), 'the off switch does not switch it off' );
	same( ARTICLE, IE_Style::wrap( ARTICLE ), 'it wrapped with the styling switched off' );

	IE_Style::enqueue();
	same( array(), $GLOBALS['ie_styles'], 'it loaded the stylesheet with the styling switched off' );
} );

test( 'and an explicit on is an on', function () {
	reset_state();
	IE_Settings::set( array( IE_Style::SETTING => '1' ) );

	ok( IE_Style::enabled(), "'1' was not read as on" );
	ok( false !== strpos( IE_Style::wrap( ARTICLE ), 'ie-post' ),
		'nothing was wrapped with the styling explicitly on' );
} );

test( 'ANYTHING IT DOES NOT RECOGNISE LEAVES THE SITE AS IT WAS', function () {
	/* The admin screen writes '1' or '0' and nothing else, so a value that is
	 * neither came from somewhere unaccountable — a half-finished import, a
	 * row edited by hand, a future version of the form. Switching a
	 * customer's live site on the strength of a string nobody recognises is
	 * the wrong way to fail. */
	foreach ( array( 'yes', 'no', 'false', '', '2', 'off' ) as $junk ) {
		reset_state();
		IE_Settings::set( array( IE_Style::SETTING => $junk ) );

		ok( IE_Style::enabled(), "'$junk' silently switched the styling off" );
	}
} );

test( 'and the switch lives with the plugin\'s other settings', function () {
	/* One option row for the whole plugin: one thing to read, one thing to
	 * remove on uninstall. A row of its own would be a second place to look
	 * and a second thing to forget. */
	reset_state();
	IE_Settings::set( array( IE_Style::SETTING => '0' ) );

	same( array( IE_Settings::OPTION ), array_keys( $GLOBALS['ie_options'] ),
		'the styling switch wrote an option row of its own' );
} );

section( 'WHERE IT SITS IN THE FILTER CHAIN' );

/* Booted against an empty hook list. Other sections boot too, and a count
 * of "how many things are on the_content" is only meaningful if this is the
 * only registration in it. */
$GLOBALS['ie_hooks'] = array();
IE_Style::boot();

test( 'the content filter runs AFTER wpautop', function () {
	/* wpautop is priority 10 and turns bare line breaks into paragraphs. Run
	 * before it and it is handed a string opening with a <div> — it treats a
	 * block-level opener as a reason to leave the first chunk alone, and the
	 * opening paragraph comes out unwrapped while every other one is fine.
	 *
	 * It also means what gets wrapped is what the reader sees, including
	 * whatever other plugins have already added. */
	$hooks = $GLOBALS['ie_hooks']['the_content'];

	same( 1, count( $hooks ), 'the_content is filtered more than once' );
	ok( $hooks[0]['priority'] > 10,
		'the wrapper runs at priority ' . $hooks[0]['priority'] . ', at or before wpautop' );
	same( 20, $hooks[0]['priority'] );
} );

test( 'and the stylesheet is registered on the front end only', function () {
	/* wp_enqueue_scripts, not admin_enqueue_scripts and not wp_head. The
	 * editor has its own styling and this file has no business in it. */
	ok( isset( $GLOBALS['ie_hooks']['wp_enqueue_scripts'] ),
		'nothing is hooked to wp_enqueue_scripts, so the CSS never loads' );
	ok( ! isset( $GLOBALS['ie_hooks']['admin_enqueue_scripts'] ),
		'the blog stylesheet is being loaded into wp-admin' );
} );

section( 'THE CHECKBOX THE OWNER ACTUALLY SEES' );

/* Driven, not read.
 *
 * A settings control has three separate ways of being broken and only one of
 * them is visible in the markup: the box can render and post to a handler
 * that is not registered; it can post to a registered handler that reads a
 * different field name; and the handler can save to a key the front end does
 * not read. All three look completely fine on screen — the box ticks, the
 * page saves, and nothing changes. So every test below goes in through the
 * form and comes out at IE_Style::enabled(). */

/** Render the control and hand back its HTML. */
function style_form() {
	ob_start();

	$render = new ReflectionMethod( 'IE_Admin', 'render_style' );
	$render->setAccessible( true );
	$render->invoke( null );

	return ob_get_clean();
}

/**
 * The checkbox's field name, READ OUT OF THE RENDERED FORM.
 *
 * Not written out again here, and that is the point: a test that posts a
 * hard-coded 'blog_styles' is testing the handler against itself, and would
 * pass happily while the form on screen sent a field by some other name and
 * every Save silently switched the styling off.
 */
function checkbox_name() {
	ok( preg_match( '/<input[^>]*type="checkbox"[^>]*>/', style_form(), $input ),
		'there is no checkbox in the form to read a name from' );
	ok( preg_match( '/name="([^"]+)"/', $input[0], $name ),
		'the checkbox has no name, so the browser sends nothing at all' );

	return $name[1];
}

/** The $_POST a browser sends when that box is ticked. */
function ticked() {
	return array( checkbox_name() => '1' );
}

/** Submit it. $post is the $_POST a browser would send. */
function submit_style( $post ) {
	$_POST = $post;

	try {
		IE_Admin::handle_style();
	} catch ( Redirected $r ) {
		$_POST = array();
		return $r->getMessage();
	}

	$_POST = array();
	throw new Exception( 'the handler returned without redirecting' );
}

test( 'the box is there, and ticked, on a site that has never touched it', function () {
	reset_state();
	$html = style_form();

	ok( false !== strpos( $html, 'name="blog_styles"' ), 'there is no checkbox' );
	ok( false !== strpos( $html, 'type="checkbox"' ), 'it is not a checkbox' );
	ok( preg_match( '/name="blog_styles"[^>]*checked/', $html ),
		'the box is unticked on a site where the styling is running' );
} );

test( 'and unticked once the owner has switched it off', function () {
	reset_state();
	IE_Settings::set( array( IE_Style::SETTING => '0' ) );

	ok( ! preg_match( '/name="blog_styles"[^>]*checked/', style_form() ),
		'the box shows ticked while the styling is off' );
} );

test( 'IT POSTS TO A HANDLER THAT IS ACTUALLY REGISTERED', function () {
	/* The silent one. A form whose `action` value has no matching
	 * admin_post_ hook does not error — WordPress redirects to a blank
	 * admin page, the setting is not saved, and the owner concludes the
	 * feature is broken rather than the wiring. */
	reset_state();
	$GLOBALS['ie_hooks'] = array();

	IE_Admin::init();

	ok( preg_match( '/name="action"[^>]*value="([^"]+)"/', style_form(), $m ),
		'the form does not name an action, so WordPress has nothing to route it to' );

	ok( isset( $GLOBALS['ie_hooks'][ 'admin_post_' . $m[1] ] ),
		"the form posts action={$m[1]} and nothing is listening for it, so Save goes nowhere" );
} );

test( 'and it carries a nonce the handler checks', function () {
	reset_state();

	ok( false !== strpos( style_form(), 'data-action="ie_style"' ),
		'the form has no nonce field' );

	submit_style( ticked() );

	same( array( 'ie_style' ), $GLOBALS['ie_referred'],
		'the handler saved without checking where the request came from' );
} );

test( 'A READER CANNOT CHANGE IT', function () {
	reset_state();
	$GLOBALS['ie_caps'] = false;

	try {
		submit_style( array( 'blog_styles' => '' ) );
		throw new Exception( 'a user without manage_options saved the setting' );
	} catch ( Exception $e ) {
		ok( 0 === strpos( $e->getMessage(), 'wp_die:' ), $e->getMessage() );
	}

	ok( IE_Style::enabled(), 'the setting changed anyway' );
} );

test( 'TICKING IT AND SAVING TURNS THE STYLING ON, END TO END', function () {
	reset_state();
	IE_Settings::set( array( IE_Style::SETTING => '0' ) );

	submit_style( ticked() );

	ok( IE_Style::enabled(), 'saving a ticked box did not switch the styling on' );
	ok( false !== strpos( IE_Style::wrap( ARTICLE ), 'ie-post' ),
		'the setting says on and the article is still unwrapped' );

	IE_Style::enqueue();
	same( 1, count( $GLOBALS['ie_styles'] ), 'the stylesheet still does not load' );
} );

test( 'UNTICKING IT AND SAVING TURNS IT OFF, END TO END', function () {
	/* AN UNTICKED CHECKBOX SENDS NOTHING AT ALL. The browser omits the field
	 * entirely, so "off" arrives as an absence — and a handler written the
	 * obvious way, reading $_POST['blog_styles'] and saving it when set,
	 * makes the box impossible to untick. It would save on, every time,
	 * and the owner would have no way to tell the difference between a
	 * broken checkbox and a broken feature. */
	reset_state();

	submit_style( array() );   // exactly what an unticked box sends

	ok( ! IE_Style::enabled(), 'the box cannot be unticked' );
	same( ARTICLE, IE_Style::wrap( ARTICLE ), 'the article is still being wrapped' );

	IE_Style::enqueue();
	same( array(), $GLOBALS['ie_styles'], 'the stylesheet is still being loaded' );
} );

test( 'BOTH ANSWERS ARE WRITTEN DOWN, NOT JUST THE OFF ONE', function () {
	/* Saving only the off case works today, because the default is on. It
	 * would quietly become wrong the day that default changed: every owner
	 * who had deliberately ticked the box would flip with it, having
	 * recorded nothing. */
	reset_state();

	submit_style( ticked() );

	$stored = $GLOBALS['ie_options'][ IE_Settings::OPTION ];

	ok( isset( $stored[ IE_Style::SETTING ] ), 'an explicit "on" was not recorded at all' );
	same( '1', $stored[ IE_Style::SETTING ] );
} );

test( 'and the owner is told which way it went', function () {
	/* A checkbox looks identical after being saved either way, and the
	 * change it makes is on the front end, where the owner is not looking. */
	reset_state();

	$on  = submit_style( ticked() );
	$off = submit_style( array() );

	ok( false !== strpos( $on, 'ie_status=style_on' ), "no confirmation on: $on" );
	ok( false !== strpos( $off, 'ie_status=style_off' ), "no confirmation off: $off" );

	$notices = new ReflectionMethod( 'IE_Admin', 'notices' );
	$src     = file_get_contents( __DIR__ . '/interlink-engine/includes/class-ie-admin.php' );

	foreach ( array( 'style_on', 'style_off' ) as $status ) {
		ok( preg_match( "/'$status'\s*=>\s*array\(/", $src ),
			"$status redirects to a notice that does not exist, so Save says nothing" );
	}
} );

test( 'the control is on a screen somebody can reach', function () {
	/* render_style() is private and called from one place. A method nobody
	 * calls is a setting nobody can change — and every test above would
	 * still pass, because they all invoke it directly. */
	$src = file_get_contents( __DIR__ . '/interlink-engine/includes/class-ie-admin.php' );
	$src = preg_replace( '/\/\*[\s\S]*?\*\//', '', $src );
	$src = preg_replace( '/^\s*\/\/.*$/m', '', $src );

	same( 2, substr_count( $src, 'render_style' ),
		'render_style is defined but never called from a screen' );
} );

section( 'The plugin actually loads it' );

/* Source checks, with comments stripped FIRST.
 *
 * Eight times in this project an assertion has been anchored on a phrase that
 * only existed in a comment, passed for ever, and guarded nothing. The
 * anchors below are all code. */
function plugin_src() {
	$src = file_get_contents( __DIR__ . '/interlink-engine/interlink-engine.php' );

	$src = preg_replace( '/\/\*[\s\S]*?\*\//', '', $src );   // block comments
	$src = preg_replace( '/^\s*\/\/.*$/m', '', $src );       // whole-line //
	$src = preg_replace( '/^\s*#.*$/m', '', $src );          // whole-line #

	return $src;
}

test( 'THE CLASS IS REQUIRED, AND BEFORE IT IS BOOTED', function () {
	/* The failure this catches is silent in the worst way: a require that is
	 * missing gives a fatal error on every page of the customer's site. */
	$src = plugin_src();

	$require = strpos( $src, "require_once IE_DIR . 'includes/class-ie-style.php';" );
	$boot    = strpos( $src, 'IE_Style::boot();' );

	ok( false !== $require, 'class-ie-style.php is never required' );
	ok( false !== $boot, 'IE_Style::boot() is never called, so the feature is dead code' );
	ok( $require < $boot, 'the class is booted before the file that defines it is loaded' );
} );

test( 'it boots unconditionally, not inside is_admin()', function () {
	/* The hooks it registers are front-end hooks. Putting the boot call in
	 * the is_admin() block would mean the stylesheet never loads for a
	 * visitor — which is every visitor. */
	$src   = plugin_src();
	$boot  = strpos( $src, 'IE_Style::boot();' );
	$admin = strpos( $src, 'if ( is_admin() ) {' );

	ok( false !== $admin, 'the is_admin block has moved; this check is no longer meaningful' );
	ok( $boot < $admin, 'IE_Style::boot() is inside or after the is_admin() block' );
} );

test( 'and the version was bumped in both places', function () {
	/* The header comment is what WordPress shows on the Plugins screen and
	 * what the update check compares. IE_VERSION is what busts the CSS
	 * cache. They have drifted apart before. */
	$raw = file_get_contents( __DIR__ . '/interlink-engine/interlink-engine.php' );

	ok( preg_match( '/^ \* Version:\s+(\S+)$/m', $raw, $header ), 'no Version: header' );
	ok( preg_match( "/define\( 'IE_VERSION', '([^']+)' \)/", $raw, $constant ), 'no IE_VERSION' );

	same( $header[1], $constant[1], 'the header version and IE_VERSION disagree' );
	ok( version_compare( $header[1], '0.51.0', '>' ),
		"the version is still {$header[1]}; the restyled CSS will sit behind a cached copy of the old one" );
} );

section( 'THE STYLESHEET ITSELF' );

$css_path = __DIR__ . '/interlink-engine/assets/blog.css';

test( 'it exists, inside the plugin folder', function () use ( $css_path ) {
	/* Outside the folder it does not go into the zip, and the enqueue 404s
	 * on every post. */
	ok( file_exists( $css_path ), 'assets/blog.css is missing from the plugin' );
	ok( filesize( $css_path ) > 0, 'assets/blog.css is empty' );
} );

/** The file with its comments removed. */
function css_rules( $path ) {
	return preg_replace( '/\/\*[\s\S]*?\*\//', '', file_get_contents( $path ) );
}

test( 'EVERY RULE IS SCOPED TO THIS PLUGIN\'S OWN POSTS', function () use ( $css_path ) {
	/* The containment guarantee, checked rather than trusted. One selector
	 * that forgot the prefix — `h2 { margin-top: 2em }` — restyles every
	 * heading on the customer's entire site, including pages this plugin has
	 * never touched, and it would be months before anyone connected the two.
	 *
	 * TWO PREFIXES SINCE 0.47.0, not one. The post title is rendered by the
	 * theme outside the_content, so it cannot be wrapped and is reached
	 * through a class on <body> instead. That class is added under exactly
	 * the conditions the stylesheet is loaded under, so it is the same
	 * guarantee by another route — but it is a second route, and the test
	 * has to say so rather than quietly accept anything. */
	$css = css_rules( $css_path );

	ok( preg_match_all( '/([^{}]+)\{/', $css, $m ), 'no rules found at all' );

	$checked = 0;

	foreach ( $m[1] as $block ) {
		$block = trim( $block );

		if ( '' === $block || '@' === $block[0] ) {
			continue;   // @media and friends; their contents are matched too
		}

		foreach ( explode( ',', $block ) as $selector ) {
			$selector = trim( $selector );
			if ( '' === $selector ) {
				continue;
			}

			ok( false !== strpos( $selector, '.ie-post' )
				|| false !== strpos( $selector, '.ie-styled' ),
				"an unscoped selector would restyle the whole site: $selector" );
			$checked++;
		}
	}

	ok( $checked >= 5, "only $checked selectors were checked; the parser is not seeing the file" );
} );

test( 'NO !important ANYWHERE', function () use ( $css_path ) {
	/* A theme specific enough to beat these rules has an opinion about its
	 * own typography, and that opinion should win. An arms race over
	 * specificity is how a plugin ends up fighting the site it is a guest
	 * on — and it is unwinnable from inside a .ie-post div anyway. */
	ok( false === stripos( css_rules( $css_path ), '!important' ),
		'the stylesheet overrides the theme by force' );
} );

test( 'NO TYPEFACE, EVER', function () use ( $css_path ) {
	/* The one part of a theme's identity this file still refuses to touch.
	 * Sizes and colours can be judged on a page; a typeface is the brand,
	 * and a plugin that swaps it is wrong on every site that already looked
	 * right. */
	ok( false === stripos( css_rules( $css_path ), 'font-family' ),
		'the stylesheet sets a typeface' );
} );

test( 'EXACTLY TWO LITERAL COLOURS, AND BOTH ARE ACCOUNTED FOR', function () use ( $css_path ) {
	/* 0.46.0 is where this file started using colour, after holding out
	 * against it since 0.45.0 — so the rule is no longer "none" and has to
	 * be something checkable instead of a habit.
	 *
	 * The accent, declared once as a custom property and referenced
	 * everywhere else, and the white digit that sits on it. A third literal
	 * means somebody has hard-coded a colour into a rule rather than going
	 * through the variable, and that is the change that starts clashing
	 * with people's themes. */
	$css = css_rules( $css_path );

	preg_match_all( '/#[0-9a-f]{3,8}\b/i', $css, $found );

	$unique = array_values( array_unique( array_map( 'strtolower', $found[0] ) ) );
	sort( $unique );

	same( array( '#1f6fd0', '#fff' ), $unique,
		'the set of hard-coded colours has changed' );

	same( 1, substr_count( $css, '#1f6fd0' ),
		'the accent is written out more than once, so changing it means finding every copy' );
} );

test( 'AND THE BOXES HAVE NO COLOUR OF THEIR OWN', function () use ( $css_path ) {
	/* THE RULE THAT KEEPS A BOX FROM GOING DARK ON A LIGHT PAGE. Every fill
	 * and every border is either the accent, or one of the two tints — and
	 * the tints are the theme's own text colour mixed with transparency, so
	 * they resolve against whatever is behind them.
	 *
	 * A literal grey or white as a background is the failure this catches:
	 * it looks right on the theme it was written against and wrong on a
	 * cream, grey or dark one. */
	$css = css_rules( $css_path );

	preg_match_all( '/background(?:-color)?:\s*([^;]+);/i', $css, $fills );

	foreach ( $fills[1] as $value ) {
		ok( false !== strpos( $value, 'var(--ie-' ),
			"a background is set to a fixed colour rather than a tint: $value" );
	}

	ok( $fills[1], 'no backgrounds found at all — the boxes have gone' );
} );

test( 'THE LISTS AND THE QUOTE ARE ACTUALLY BOXES', function () use ( $css_path ) {
	/* The part of the design Edwin chose, asserted rather than assumed. The
	 * mutation that found this gap deleted the fill and the border from the
	 * list rule and every other test still passed — because the quote kept
	 * its box, and "some background exists somewhere" was all anything
	 * checked. A design that silently half-disappears is worse than one that
	 * was never added. */
	$css = css_rules( $css_path );

	preg_match_all( '/([^{}]+)\{([^{}]*)\}/', $css, $rules, PREG_SET_ORDER );

	$boxed = array();

	foreach ( $rules as $rule ) {
		$selector = trim( preg_replace( '/\s+/', ' ', $rule[1] ) );

		if ( ! preg_match( '/background:/i', $rule[2] ) ) {
			continue;
		}
		if ( ! preg_match( '/border:/i', $rule[2] ) || ! preg_match( '/border-radius:/i', $rule[2] ) ) {
			continue;
		}

		$boxed[] = $selector;
	}

	$all = implode( ' | ', $boxed );

	ok( false !== strpos( $all, '.ie-post ul' ), "bulleted lists are not in a box: $all" );
	ok( false !== strpos( $all, '.ie-post ol' ), "numbered lists are not in a box: $all" );
	ok( false !== strpos( $all, 'blockquote' ),  "quotes are not in a box: $all" );
} );

test( 'and the bullets and step numbers are drawn in the accent', function () use ( $css_path ) {
	/* list-style is off, so if these pseudo-elements go, the list loses its
	 * markers entirely and reads as a run-on paragraph in a grey box. */
	$css = css_rules( $css_path );

	ok( preg_match( '/\.ie-post ul li::before\s*\{[^}]*background:\s*var\(--ie-accent\)/', $css ),
		'the bullet is gone, and list-style is off — the list has no markers at all' );

	ok( preg_match( '/\.ie-post ol li::before\s*\{[^}]*content:\s*counter\(/', $css ),
		'the step numbers are gone, and list-style is off — the steps are unnumbered' );
} );

test( 'the rgba fallbacks are neutral grey, not a colour someone picked', function () use ( $css_path ) {
	/* They exist for a browser without color-mix, and a fallback is the
	 * worst place to express taste: it is the version nobody looks at. Equal
	 * channels is the whole requirement. */
	$css = css_rules( $css_path );

	preg_match_all( '/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i', $css, $rgba, PREG_SET_ORDER );

	ok( $rgba, 'the color-mix fallbacks are gone, so an older browser gets no box at all' );

	foreach ( $rgba as $m ) {
		ok( $m[1] === $m[2] && $m[2] === $m[3],
			"an rgba fallback is tinted rather than grey: {$m[0]}" );
	}
} );

test( 'BODY TEXT IS NEVER GIVEN A COLOUR', function () use ( $css_path ) {
	/* The guarantee behind "it cannot end up pale text on a pale page".
	 * Paragraphs and list items inherit from the theme, always — so whatever
	 * the theme has decided is readable on its own background stays in
	 * force. Only headings, links and the digit on the accent disc are
	 * coloured. */
	$css = css_rules( $css_path );

	preg_match_all( '/([^{}]+)\{([^{}]*)\}/', $css, $rules, PREG_SET_ORDER );

	$allowed = array( 'h2', 'h3', 'a', 'li::before', ':root', '.ie-post' );

	/* The title rule must NOT be in that list. It sets a width and a line
	 * height and nothing else: the headline's colour is the theme's. */

	foreach ( $rules as $rule ) {
		if ( ! preg_match( '/(^|[^-])color:/i', $rule[2] ) ) {
			continue;
		}

		$selector = trim( preg_replace( '/\s+/', ' ', $rule[1] ) );

		$ok = false;
		foreach ( $allowed as $tail ) {
			if ( false !== strpos( $selector, $tail ) ) { $ok = true; break; }
		}

		ok( $ok, "body text is being coloured by: $selector" );
	}
} );

test( 'THE TITLE IS GIVEN A MEASURE, AND NOTHING ELSE', function () use ( $css_path ) {
	/* What Edwin was looking at: a 60-character headline on one line across
	 * a desktop monitor, with the article underneath sitting at 68ch. The
	 * two did not look like parts of the same page.
	 *
	 * A measure is the whole of the fix. Colour, weight and typeface on
	 * somebody's post title is the plugin redesigning their site. */
	$css = css_rules( $css_path );

	ok( preg_match( '/\.ie-styled h1\s*\{([^}]*)\}/', $css, $title ),
		'the post title is not constrained, so a long headline runs the full window' );

	ok( preg_match( '/max-width:\s*\d+ch/', $title[1] ),
		'the title rule sets no measure' );

	foreach ( array( 'color', 'font-family', 'font-size', 'font-weight', 'background' ) as $property ) {
		ok( false === stripos( $title[1], $property ),
			"the title rule sets $property, which is the theme's to decide" );
	}
} );

test( 'AND THE TITLE AND THE ARTICLE SHARE ONE GUTTER', function () use ( $css_path ) {
	/* They have to line up, and two copies of the same clamp is how they
	 * stop lining up six months from now. Declared once on the body class
	 * and inherited by both. */
	$css = css_rules( $css_path );

	same( 1, preg_match_all( '/--ie-gutter:/', $css ),
		'the gutter is declared more than once, so the title and the text can drift apart' );

	ok( preg_match( '/\.ie-styled\s*\{[^}]*--ie-gutter:/', $css ),
		'the gutter is not declared on the body class, so the title cannot inherit it' );

	foreach ( array( '.ie-post', '.ie-styled h1' ) as $selector ) {
		ok( preg_match( '/' . preg_quote( $selector, '/' ) . '\s*\{[^}]*padding-left:\s*var\(--ie-gutter/', $css ),
			"$selector does not use the shared gutter" );
	}

	/* THE FALLBACK IS 0, NOT A SECOND COPY OF THE VALUE. A theme that drops
	 * body_class should lose the gutter, which is how this looked before
	 * 0.47.0 — not get a gutter on the text and none on the title. */
	same( 2, preg_match_all( '/var\(--ie-gutter,\s*0\)/', $css ),
		'the gutter fallback is something other than 0' );
} );

test( 'and the article is not jammed against the title', function () use ( $css_path ) {
	/* The first child's top margin is zeroed so the hairline above an
	 * opening h2 does not land under the byline. That is right, and it left
	 * the article touching the title on every theme that adds no gap of its
	 * own. The wrapper carries the gap instead. */
	$css = css_rules( $css_path );

	ok( preg_match( '/(^|\})\s*\.ie-post\s*\{([^}]*)\}/m', $css, $wrapper ),
		'the .ie-post rule could not be found' );

	ok( preg_match( '/margin-top:\s*[\d.]+em/', $wrapper[2] ),
		'there is no space between the post title and the first paragraph' );
} );

test( 'the measure is a maximum, so a narrower theme still wins', function () use ( $css_path ) {
	/* max-width, never width. A theme that already constrains its content
	 * area more tightly than 70ch keeps its own measure, and nothing here
	 * can make a column wider than the theme intended. */
	$css = css_rules( $css_path );

	ok( preg_match( '/max-width:\s*\d+ch/', $css ), 'the reading measure is not set' );

	/* SCOPED TO THE WRAPPER'S OWN RULE. A blanket search for `width:` used
	 * to work and now does not: the bullet and the step badge are drawn
	 * shapes with a width of their own, and they are nobody's column. What
	 * must never have a fixed width is .ie-post itself. */
	ok( preg_match( '/(^|\})\s*\.ie-post\s*\{([^}]*)\}/m', $css, $wrapper ),
		'the .ie-post rule could not be found' );

	ok( ! preg_match( '/(^|[^-])width:/', $wrapper[2] ),
		'the wrapper sets a fixed width, so a narrower theme can no longer win' );
} );

test( 'THE BODY SIZE IS SET, AND SET RELATIVE TO THE THEME', function () use ( $css_path ) {
	/* 0.47.0 read too small next to the title on a real site. The fix is a
	 * multiplier, not a size: em means a theme that already chose large
	 * type keeps it and one that left the browser default gets a nudge. A
	 * px value would flatten all of them to the same number, which is right
	 * for whichever theme it was measured against and wrong for the rest. */
	$css = css_rules( $css_path );

	ok( preg_match( '/(^|\})\s*\.ie-post\s*\{([^}]*)\}/m', $css, $wrapper ),
		'the .ie-post rule could not be found' );

	ok( preg_match( '/font-size:\s*[\d.]+em/', $wrapper[2], $size ),
		'the article is left at the theme\'s own body size' );

	ok( ! preg_match( '/font-size:\s*[\d.]+(px|pt)/', $css ),
		'a font size is set in px, so it ignores whatever the theme chose' );
} );

test( 'and it sizes in em, so it scales with whatever the theme chose', function () use ( $css_path ) {
	/* A margin in px is a margin that ignores the theme's font size, and on
	 * a large-type theme it reads as too tight. */
	$css = css_rules( $css_path );

	ok( ! preg_match( '/margin[^:]*:\s*[^;]*\dpx/', $css ),
		'a margin is set in px rather than em' );
} );

echo "\n$passed passed, $failed failed\n";
exit( $failed ? 1 : 0 );
