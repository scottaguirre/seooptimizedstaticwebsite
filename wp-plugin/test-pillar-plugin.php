<?php
/**
 * test-pillar-plugin.php
 *
 *   php wp-plugin/test-pillar-plugin.php
 *
 * The WordPress half of pillar campaigns.
 *
 * WHAT A PILLAR CAMPAIGN IS. It writes hub articles ringed to one another,
 * with no money page, as ordinary POSTS. Later campaigns point at one of them.
 * Pillars link sideways, children link up, nothing links down — so no post is
 * ever rewritten to add a link.
 *
 * WHY THIS FILE EXISTS, in one sentence: a pillar can be written, published and
 * correctly ringed and still be USELESS, because the Target Page dropdown
 * queried post_type 'page' and a pillar is a post. The server half can be
 * perfect and the feature still not work.
 *
 * `php -l` proves these files parse. It says nothing about a query that finds
 * nothing, a title decorated on its way into the database, or a card rendering
 * `<a href="">`. So the screens are RENDERED and the queries RUN.
 */

error_reporting( E_ALL );

/* ---------------------------------------------------------------------
 * Just enough WordPress
 * ------------------------------------------------------------------ */

define( 'ABSPATH', '/tmp/' );
define( 'IE_VERSION', '0.16.0' );
define( 'IE_FILE', '/tmp/x.php' );
define( 'IE_DIR', '/tmp/' );
define( 'IE_URL', 'http://site/' );

$GLOBALS['ie_options']   = array();
$GLOBALS['ie_campaigns'] = array();
$GLOBALS['ie_posts']     = array();   // id => array( title, type, status, meta )
$GLOBALS['ie_transient'] = false;
$GLOBALS['ie_redirect']  = '';
$GLOBALS['ie_meta']      = array();   // id => array( key => value )

function __( $s, $d = null ) { return $s; }
function _x( $s, $c, $d = null ) { return $s; }
function _n( $one, $many, $n, $d = null ) { return 1 === (int) $n ? $one : $many; }
function esc_html__( $s, $d = null ) { return htmlspecialchars( $s, ENT_QUOTES ); }
function esc_attr__( $s, $d = null ) { return htmlspecialchars( $s, ENT_QUOTES ); }
function esc_html_e( $s, $d = null ) { echo htmlspecialchars( $s, ENT_QUOTES ); }
function esc_attr_e( $s, $d = null ) { echo htmlspecialchars( $s, ENT_QUOTES ); }
function esc_html( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES ); }
function esc_attr( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES ); }
function esc_js( $s ) { return addslashes( (string) $s ); }
function esc_url( $u ) { return htmlspecialchars( (string) $u, ENT_QUOTES ); }
function esc_url_raw( $u ) { return (string) $u; }
function esc_textarea( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES ); }
function wp_kses_post( $s ) { return (string) $s; }
function wp_strip_all_tags( $s ) { return trim( strip_tags( (string) $s ) ); }
function wp_unslash( $s ) { return is_string( $s ) ? stripslashes( $s ) : $s; }
function sanitize_key( $s ) { return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( (string) $s ) ); }
function sanitize_text_field( $s ) { return trim( strip_tags( (string) $s ) ); }
function wp_json_encode( $v ) { return json_encode( $v ); }
function number_format_i18n( $n ) { return number_format( (float) $n ); }
function untrailingslashit( $s ) { return rtrim( (string) $s, '/\\' ); }
function wp_parse_url( $url, $component = -1 ) { return parse_url( (string) $url, $component ); }
function wp_parse_args( $a, $d = array() ) { return array_merge( $d, (array) $a ); }
function admin_url( $p = '' ) { return 'http://site/wp-admin/' . $p; }
function wp_date( $fmt, $ts = null ) { return date( $fmt, $ts ? $ts : time() ); }
function wp_timezone_string() { return 'America/Chicago'; }
function current_time( $t ) { return date( 'Y-m-d H:i:s' ); }
function get_bloginfo( $k = '' ) { return 'A Blog'; }
function get_template() { return 'twentytwentyfour'; }
function wp_nonce_field( $a ) { echo '<input type="hidden" name="_wpnonce" value="n">'; }
function wp_nonce_url( $u, $a ) { return $u . '&_wpnonce=n'; }
function wp_create_nonce( $a ) { return 'n'; }
function get_transient( $k ) { return $GLOBALS['ie_transient']; }
function set_transient( $k, $v, $t = 0 ) { $GLOBALS['ie_transient'] = $v; return true; }
function delete_transient( $k ) { $GLOBALS['ie_transient'] = false; return true; }
function get_current_user_id() { return 1; }
function current_user_can( $c, $id = null ) { return ! isset( $GLOBALS['ie_caps'] ) || (bool) $GLOBALS['ie_caps']; }
function add_action() {}
function add_filter() {}
function absint( $n ) { return abs( (int) $n ); }
function plugin_dir_path( $f ) { return '/tmp/'; }
function plugin_dir_url( $f ) { return 'http://site/'; }
function is_wp_error( $t ) { return $t instanceof WP_Error; }
/* THROWS, BECAUSE CONTROL DOES NOT COME BACK IN PRODUCTION EITHER.
 * IE_Hygiene::redirect_author() ends in exit, so a stub that merely recorded
 * the URL would let a test carry on through code the real request can never
 * reach — and the first redirect in a run would end the whole suite and
 * report everything before it as the result. */
class IE_Redirected extends Exception {}
function wp_safe_redirect( $u, $status = 302 ) {
	$GLOBALS['ie_redirect'] = $u;
	throw new IE_Redirected( (string) $u );
}
function get_edit_post_link( $id ) { return 'http://site/wp-admin/post.php?post=' . (int) $id; }
function wp_list_pluck( $rows, $field ) {
	return array_map( function ( $r ) use ( $field ) {
		return isset( $r[ $field ] ) ? $r[ $field ] : null;
	}, (array) $rows );
}

/* $b DEFAULTS TO true, exactly as WordPress declares both of these.
 *
 * A stub with a NARROWER signature than the thing it stands for does not fail
 * the code under test; it fails the test, and it reads like a bug in the
 * plugin. `selected( $cond )` cost an afternoon that way once already. */
function selected( $a, $b = true, $echo = true ) { $r = ( (string) $a === (string) $b ) ? ' selected' : ''; if ( $echo ) { echo $r; } return $r; }
function checked( $a, $b = true, $echo = true ) { $r = ( $a == $b ) ? ' checked' : ''; if ( $echo ) { echo $r; } return $r; }

function get_option( $k, $d = null ) {
	if ( 'ie_campaigns' === $k ) {
		$out = array();
		foreach ( (array) $GLOBALS['ie_campaigns'] as $c ) {
			$out[ $c['id'] ] = $c;
		}
		return $out;
	}
	return array_key_exists( $k, $GLOBALS['ie_options'] ) ? $GLOBALS['ie_options'][ $k ] : $d;
}

function update_option( $k, $v, $autoload = null ) {
	if ( 'ie_campaigns' === $k ) {
		$GLOBALS['ie_campaigns'] = array_values( (array) $v );
		return true;
	}
	$GLOBALS['ie_options'][ $k ] = $v;
	return true;
}

/* ---------------------------------------------------------------------
 * Posts, with types, statuses and meta — because all three decide whether a
 * pillar reaches the dropdown
 * ------------------------------------------------------------------ */

class IE_Test_Post {
	public $ID;
	public function __construct( $id ) { $this->ID = (int) $id; }
}

function ie_add_post( $id, $title, $type, $status, $meta = array() ) {
	$GLOBALS['ie_posts'][ (int) $id ] = array(
		'title'  => $title,
		'type'   => $type,
		'status' => $status,
	);
	$GLOBALS['ie_meta'][ (int) $id ] = $meta;
}

function get_the_title( $p = 0 ) {
	$id = is_object( $p ) ? $p->ID : (int) $p;
	return isset( $GLOBALS['ie_posts'][ $id ] ) ? $GLOBALS['ie_posts'][ $id ]['title'] : '';
}

function get_post_meta( $id, $key, $single = false ) {
	$id = (int) $id;
	return isset( $GLOBALS['ie_meta'][ $id ][ $key ] ) ? $GLOBALS['ie_meta'][ $id ][ $key ] : '';
}

function update_post_meta( $id, $key, $value ) {
	$GLOBALS['ie_meta'][ (int) $id ][ $key ] = $value;
	return true;
}

/**
 * HONOURS post_type, post_status AND the meta filter.
 *
 * All three matter, and a stub that ignored any one of them could not express
 * the bug this suite exists for:
 *
 *   post_type   ignored -> a pillar post appears in a 'page'-only query, so
 *               the old code would have "passed"
 *   post_status ignored -> a FUTURE pillar looks selectable, and its permalink
 *               404s to the public for weeks
 *   meta        ignored -> every post on the site becomes a target page
 */
function get_posts( $args ) {
	$type     = isset( $args['post_type'] ) ? (array) $args['post_type'] : array( 'post' );
	$statuses = isset( $args['post_status'] ) ? (array) $args['post_status'] : array( 'publish' );
	$mkey     = isset( $args['meta_key'] ) ? $args['meta_key'] : '';
	$mval     = isset( $args['meta_value'] ) ? (string) $args['meta_value'] : null;

	/* AND 'NOT EXISTS', WHICH IS THE ONLY WAY TO ASK THE QUESTION IE_Hygiene
	 * ASKS: is anything published here missing _ie_campaign? A stub that
	 * ignored meta_query would return every post for that call, the answer
	 * would always be "somebody else's site", and every test of the tidy-up
	 * would pass while the feature never ran once. Eighth instance of a stub
	 * that cannot express the failure it is meant to detect. */
	$absent = '';
	if ( isset( $args['meta_query'] ) && is_array( $args['meta_query'] ) ) {
		foreach ( $args['meta_query'] as $clause ) {
			if ( is_array( $clause ) && isset( $clause['compare'] ) && 'NOT EXISTS' === $clause['compare'] ) {
				$absent = isset( $clause['key'] ) ? $clause['key'] : '';
			}
		}
	}

	$out = array();

	foreach ( $GLOBALS['ie_posts'] as $id => $row ) {
		if ( ! in_array( $row['type'], $type, true ) ) { continue; }
		if ( ! in_array( $row['status'], $statuses, true ) ) { continue; }

		if ( '' !== $absent && '' !== (string) get_post_meta( $id, $absent, true ) ) { continue; }

		if ( '' !== $mkey ) {
			$have = get_post_meta( $id, $mkey, true );
			if ( null !== $mval && (string) $have !== $mval ) { continue; }
			if ( null === $mval && '' === $have ) { continue; }
		}

		$out[] = new IE_Test_Post( $id );
	}

	/* The limit, honoured because IE_Hygiene relies on it: the query asks for
	 * one row and stops. A stub returning the lot would let a test pass
	 * against production code that walked every post on a customer's site. */
	if ( isset( $args['posts_per_page'] ) && $args['posts_per_page'] > 0 ) {
		$out = array_slice( $out, 0, (int) $args['posts_per_page'] );
	}

	return $out;
}

class WP_Error {
	private $m, $d;
	public function __construct( $c = '', $m = '', $d = null ) { $this->m = $m; $this->d = $d; }
	public function get_error_message() { return $this->m; }
	public function get_error_data() { return $this->d; }
}

function add_query_arg( $args, $url = '' ) {
	$parts = parse_url( $url );
	$q     = array();
	if ( isset( $parts['query'] ) ) { parse_str( $parts['query'], $q ); }
	$q    = array_merge( $q, $args );
	$base = ( isset( $parts['scheme'] ) ? $parts['scheme'] . '://' . $parts['host'] : '' ) . ( isset( $parts['path'] ) ? $parts['path'] : '' );
	return $base . '?' . http_build_query( $q );
}

/* ---------------------------------------------------------------------
 * Enough more WordPress to run IE_Publisher::on_transition()
 * ------------------------------------------------------------------ */

/**
 * THE PERMALINK OF A FRONT PAGE IS THE SITE ROOT, and this stub has to say so
 * or it cannot express the bug it exists to catch.
 *
 * WordPress resolves get_permalink() for the page named by `page_on_front` to
 * the site root, and 301s that page's own slug there. A stub that always
 * returned /<id>/ would make the ordering question unaskable: the test would
 * pass with the front page claimed before OR after the permalink was read,
 * which is precisely the distinction under test.
 */
function get_permalink( $p = 0 ) {
	$id = is_object( $p ) ? $p->ID : (int) $p;

	if ( 'page' === get_option( 'show_on_front' ) && (int) get_option( 'page_on_front' ) === $id ) {
		return 'http://site/';
	}

	return 'http://site/' . $id . '/';
}

function get_post( $id ) {
	$id = (int) $id;
	return isset( $GLOBALS['ie_posts'][ $id ] ) ? new IE_Test_Post( $id ) : null;
}

function get_post_field( $field, $id ) {
	$id = (int) $id;
	if ( 'post_name' === $field ) { return 'slug-' . $id; }
	if ( 'post_date' === $field ) { return date( 'Y-m-d H:i:s' ); }
	return '';
}

function get_post_status( $id ) {
	$id = (int) $id;
	return isset( $GLOBALS['ie_posts'][ $id ] ) ? $GLOBALS['ie_posts'][ $id ]['status'] : false;
}

function get_post_time( $fmt, $gmt = false, $id = 0 ) { return date( 'c' ); }

/* WHICH PAGE IS BEING RENDERED. IE_SEO asks is_singular() and then
 * get_queried_object_id() — and NOT get_the_ID(), because on a static front
 * page the loop has not started when pre_get_document_title runs and
 * get_the_ID() answers false. A stub that served the id from either would
 * hide that, so only the queried object is modelled. */
$GLOBALS['ie_queried'] = 0;
$GLOBALS['ie_singular'] = true;

function is_singular( $t = '' ) { return (bool) $GLOBALS['ie_singular']; }
function get_queried_object_id() { return (int) $GLOBALS['ie_queried']; }

/** Render one request and return what IE_SEO put in the head. */
function ie_render_head( $post_id, $singular = true ) {
	$GLOBALS['ie_queried']  = (int) $post_id;
	$GLOBALS['ie_singular'] = $singular;

	ob_start();
	IE_SEO::description();
	return trim( ob_get_clean() );
}

/** The <title> IE_SEO would produce, given WordPress's own answer. */
function ie_render_title( $post_id, $default, $singular = true ) {
	$GLOBALS['ie_queried']  = (int) $post_id;
	$GLOBALS['ie_singular'] = $singular;

	return IE_SEO::title( $default );
}
function wp_update_post( $p, $err = false ) { return isset( $p['ID'] ) ? (int) $p['ID'] : 0; }
function wp_publish_post( $id ) { return (int) $id; }
/* RECORDS WHAT IT WAS GIVEN, so a case can drive insert_post() for real
 * instead of reading its source. The id is fixed at 999, which is what the
 * meta assertions key off. */
function wp_insert_post( $p, $err = false ) {
	$GLOBALS['ie_inserted'][] = $p;
	return 999;
}
function get_date_from_gmt( $s, $format = 'Y-m-d H:i:s' ) { return $s; }
function get_gmt_from_date( $s, $format = 'Y-m-d H:i:s' ) {
	return gmdate( $format, $s ? strtotime( $s . ' UTC' ) : time() );
}
function sanitize_title( $t ) { return strtolower( preg_replace( '/[^a-z0-9]+/i', '-', (string) $t ) ); }
function get_users( $a = array() ) { return array( 1 ); }
function get_userdata( $id ) { return (object) array( 'ID' => (int) $id ); }
function remove_action() {}
function home_url( $p = '' ) { return 'http://site' . $p; }

/* Enough WordPress to register and save a meta box. */
$GLOBALS['ie_boxes'] = array();
$GLOBALS['ie_caps']  = true;
$GLOBALS['ie_nonce_ok'] = true;

function add_meta_box( $id, $title, $cb, $screen = null, $ctx = 'advanced', $pri = 'default' ) {
	$GLOBALS['ie_boxes'][ $id ] = array( 'title' => $title, 'screen' => $screen, 'context' => $ctx );
}
function wp_verify_nonce( $n, $a ) { return $GLOBALS['ie_nonce_ok'] ? 1 : false; }
function delete_post_meta( $id, $key ) {
	unset( $GLOBALS['ie_meta'][ (int) $id ][ $key ] );
	return true;
}

/* WHICH ARCHIVE IS BEING RENDERED, for IE_Hygiene.
 *
 * One view at a time, named by a string, rather than a bag of booleans each
 * test has to remember to reset. A forgotten `$GLOBALS['ie_is_author'] =
 * false` at the end of one test is a silent pass in the next. */
$GLOBALS['ie_view'] = '';

function is_author()     { return 'author'   === $GLOBALS['ie_view']; }
function is_category()   { return 'category' === $GLOBALS['ie_view']; }
function is_tag()        { return 'tag'      === $GLOBALS['ie_view']; }
function is_date()       { return 'date'     === $GLOBALS['ie_view']; }
function is_tax()        { return 'tax'      === $GLOBALS['ie_view']; }
function is_front_page() { return 'front'    === $GLOBALS['ie_view']; }
function is_home()       { return 'home'     === $GLOBALS['ie_view']; }

/** Nothing here calls the server; a published report is a no-op. */
class IE_Api {
	public static function published( $c, $i, $when ) { return true; }
	public static function removed( $c ) { return true; }
}

class IE_Links {
	public static function render( $sections, $targets ) {
		return array( 'content' => '', 'missing' => array() );
	}
	public static function activate( $html, $id, $url ) { return array( 'html' => $html, 'count' => 0 ); }
	public static function pending_ids( $html ) { return array(); }
}

$PLUGIN = __DIR__ . '/interlink-engine';

require_once $PLUGIN . '/includes/class-ie-settings.php';
require_once $PLUGIN . '/includes/class-ie-campaigns.php';
require_once $PLUGIN . '/includes/class-ie-publisher.php';
require_once $PLUGIN . '/includes/class-ie-seo.php';
require_once $PLUGIN . '/includes/class-ie-hygiene.php';
require_once $PLUGIN . '/includes/class-ie-metabox.php';

/* ---------------------------------------------------------------------
 * Runner
 * ------------------------------------------------------------------ */

$passed = 0;
$failed = 0;

function test( $name, $fn ) {
	global $passed, $failed;
	try {
		$fn();
		echo "  ok    $name\n";
		$passed++;
	} catch ( Throwable $e ) {
		echo "  FAIL  $name\n        " . $e->getMessage() . "\n";
		$failed++;
	}
}

function same( $expected, $actual, $msg = '' ) {
	if ( $expected !== $actual ) {
		throw new Exception( ( $msg ? $msg . ' — ' : '' )
			. 'expected ' . var_export( $expected, true )
			. ', got ' . var_export( $actual, true ) );
	}
}

function ok( $cond, $msg ) {
	if ( ! $cond ) { throw new Exception( $msg ); }
}

function not_in( $needle, $haystack, $msg ) {
	if ( false !== strpos( $haystack, $needle ) ) {
		throw new Exception( $msg . " — found \"$needle\"" );
	}
}

function has( $needle, $haystack, $msg ) {
	if ( false === strpos( $haystack, $needle ) ) {
		throw new Exception( $msg . " — missing \"$needle\"" );
	}
}

/* ===================================================================== */

echo "\nThe Target Page dropdown, which is what makes a pillar usable\n";

function ie_fixture_posts() {
	$GLOBALS['ie_posts'] = array();
	$GLOBALS['ie_meta']  = array();

	// An ordinary money page.
	ie_add_post( 10, 'Water Heater Repair', 'page', 'publish' );

	// A published pillar — this is the one that has to appear.
	ie_add_post( 20, 'Leash Pulling and Walking Problems', 'post', 'publish',
		array( IE_Settings::PILLAR_META => '1' ) );

	// A pillar still scheduled. Its permalink 404s to the public.
	ie_add_post( 21, 'Barking, Biting and Chewing', 'post', 'future',
		array( IE_Settings::PILLAR_META => '1' ) );

	// An ordinary silo post. Not a hub, must not be offered.
	ie_add_post( 30, 'Why a dog pulls on the lead', 'post', 'publish' );
}

test( 'A PUBLISHED PILLAR POST IS IN THE DROPDOWN', function () {
	/* The whole reason this file exists. target_pages() queried post_type
	 * 'page' only, so a pillar could be written, ringed, published and live
	 * and still be unselectable — campaign 2 would have had nothing to point
	 * at, which is the entire purpose of having written the pillar. */
	ie_fixture_posts();
	$pages = IE_Settings::target_pages();

	ok( isset( $pages[20] ), 'the published pillar is missing' );
	same( true, $pages[20]['is_pillar'] );
	same( 'http://site/20/', $pages[20]['url'] );
} );

test( 'the ordinary money page is still there', function () {
	// The query was widened, not replaced.
	ie_fixture_posts();
	$pages = IE_Settings::target_pages();

	ok( isset( $pages[10] ), 'the page vanished when posts were added' );
	same( false, $pages[10]['is_pillar'] );
} );

test( 'AN ORDINARY POST IS NOT OFFERED', function () {
	/* Without the meta filter every post on the blog becomes a target page,
	 * and the dropdown on a site with two hundred articles is unusable. */
	ie_fixture_posts();
	$pages = IE_Settings::target_pages();
	ok( ! isset( $pages[30] ), 'an unflagged post reached the dropdown' );
} );

test( 'A SCHEDULED PILLAR IS NOT OFFERED, because its URL 404s', function () {
	/* A pillar campaign schedules weeks out, and a `future` post answers 404
	 * to anyone not logged in. Offering one lets the owner aim ten articles at
	 * a URL that does not work yet — and nothing re-checks it, because the
	 * links are written once. */
	ie_fixture_posts();
	$pages = IE_Settings::target_pages();
	ok( ! isset( $pages[21] ), 'a future-dated pillar was selectable' );
} );

test( 'THE STORED TITLE IS NOT DECORATED', function () {
	/* The tempting shortcut is 'title' => $title . ' (pillar)' so the dropdown
	 * reads well. That title does not stay in the dropdown: read_form() keeps
	 * it, it becomes the campaign's label, and it is sent to the server as
	 * targetPage.title — which writePost drops into the sentence "It becomes a
	 * link to the X page". Every post in the silo would refer to "the Leash
	 * Pulling and Walking Problems (pillar) page".
	 *
	 * The marker belongs where it is displayed, and the form test below proves
	 * it is there. */
	ie_fixture_posts();
	$pages = IE_Settings::target_pages();

	same( 'Leash Pulling and Walking Problems', $pages[20]['title'] );
	not_in( 'pillar', $pages[20]['title'], 'the stored title carries the marker' );
	not_in( 'pillar', $pages[20]['keyword'], 'the keyword carries the marker' );
} );

test( 'the publisher and the query agree on ONE meta key', function () {
	/* Spelled out in two files, renamed in one, and the failure is silent: the
	 * post is stamped and the dropdown is simply missing a row. So both sides
	 * read IE_Settings::PILLAR_META, and this proves the publisher's call site
	 * uses the constant rather than a literal that happens to match today. */
	$publisher = file_get_contents( __DIR__ . '/interlink-engine/includes/class-ie-publisher.php' );

	ok( strpos( $publisher, 'IE_Settings::PILLAR_META' ) !== false,
		'the publisher does not use the constant' );
	ok( strpos( $publisher, "update_post_meta( \$post_id, IE_Settings::PILLAR_META, '1' )" ) !== false,
		'the publisher does not stamp the flag' );

	// And the value the query looks for is the value the publisher writes.
	ie_fixture_posts();
	update_post_meta( 30, IE_Settings::PILLAR_META, '1' );
	$pages = IE_Settings::target_pages();
	ok( isset( $pages[30] ), 'a post stamped through the constant was not found by the query' );
} );

/* ===================================================================== */

echo "\nThe stored campaign\n";

function ie_plan( $extra = array() ) {
	return array_merge( array(
		'campaignId' => 'srv-1',
		'slots'      => array(
			array( 'index' => 0, 'topic' => 'Puppy Training', 'targetQuery' => 'puppy training', 'publishAt' => '2026-10-09T09:00:00Z' ),
			array( 'index' => 1, 'topic' => 'Leash Pulling', 'targetQuery' => 'leash pulling', 'publishAt' => '2026-10-16T09:00:00Z' ),
		),
	), $extra );
}

test( 'A PILLAR CAMPAIGN IS STORED AS ONE', function () {
	$GLOBALS['ie_campaigns'] = array();

	$c = IE_Campaigns::create_from_plan(
		ie_plan( array( 'isPillar' => true ) ),
		array( 'label' => 'Pillars: Puppy Training', 'every_days' => 7 )
	);

	ok( ! is_wp_error( $c ), 'create_from_plan refused a pillar campaign' );
	same( true, $c['is_pillar'] );
	same( array(), $c['target_page'], 'a target page was invented' );
} );

test( 'THE FLAG COMES FROM THE PLAN, NOT FROM THE FORM', function () {
	/* wp-admin posted the checkbox, so it already "knows" — and that is the
	 * trap. Two copies of one fact, written by two sides, disagree the first
	 * time a form is resubmitted or the server declines the flag for a reason
	 * this side did not model. The campaign the server actually created is the
	 * only authority on what it is. */
	$GLOBALS['ie_campaigns'] = array();

	$c = IE_Campaigns::create_from_plan(
		ie_plan(),                                   // the server says: not a pillar
		array( 'is_pillar' => true, 'label' => 'x' ) // the form insists it is
	);

	same( false, $c['is_pillar'], 'the form overrode the server' );
} );

test( 'an ordinary campaign keeps its target page and is not a pillar', function () {
	$GLOBALS['ie_campaigns'] = array();

	$c = IE_Campaigns::create_from_plan( ie_plan(), array(
		'label'       => 'Water Heater Repair',
		'target_page' => array( 'id' => 10, 'title' => 'Water Heater Repair', 'url' => 'http://site/10/', 'keyword' => 'water heater repair' ),
	) );

	same( false, $c['is_pillar'] );
	same( 'http://site/10/', $c['target_page']['url'] );
} );

test( 'home_page IS STORED FROM THE FORM, AND IS OFF UNLESS ASKED FOR', function () {
	/* FOUND BY A SURVIVING MUTATION. Every test above builds its campaign
	 * fixture by hand, so `'home_page' => true` hardcoded in create_from_plan
	 * changed nothing any of them could see — the one line that decides
	 * whether a campaign claims the site root was untested.
	 *
	 * A field is not covered by tests of the behaviour it drives if those
	 * tests supply the field themselves. */
	$GLOBALS['ie_campaigns'] = array();

	$off = IE_Campaigns::create_from_plan(
		ie_plan( array( 'isPillar' => true ) ),
		array( 'label' => 'Pillars' )
	);
	same( false, $off['home_page'], 'a campaign claimed the front page without being asked' );

	$GLOBALS['ie_campaigns'] = array();

	$on = IE_Campaigns::create_from_plan(
		ie_plan( array( 'isPillar' => true ) ),
		array( 'label' => 'Pillars', 'home_page' => true )
	);
	same( true, $on['home_page'], 'the form asked for a home page and the campaign did not record it' );
} );

test( 'a campaign stored before this field reads as not claiming the home page', function () {
	/* ABSENT MEANS NO. Every campaign in every customer's database predates
	 * this, and the flag decides whether a post lands at the site root. */
	$GLOBALS['ie_campaigns'] = array(
		array( 'id' => 'old-1', 'slots' => array(), 'target_page' => array( 'url' => 'http://site/10/' ) ),
	);

	ok( empty( IE_Campaigns::get( 'old-1' )['home_page'] ),
		'an old campaign reads as wanting the front page' );
} );

test( 'EVERY CAMPAIGN STORED BEFORE TODAY READS AS NOT A PILLAR', function () {
	/* ABSENT MEANS ORDINARY. Every campaign in every customer's database
	 * predates this field. A flag that defaulted the other way would strip the
	 * money link from all of them at once — and the posts are already
	 * published, so nothing would be fixable afterwards. */
	$GLOBALS['ie_campaigns'] = array(
		array( 'id' => 'old-1', 'slots' => array(), 'target_page' => array( 'url' => 'http://site/10/', 'title' => 'T' ) ),
	);

	$old = IE_Campaigns::get( 'old-1' );
	ok( empty( $old['is_pillar'] ), 'a campaign stored before the flag reads as a pillar' );
} );

/* ===================================================================== */

echo "\nThe first pillar as the site's home page\n";

/** A pillar campaign whose first post becomes the front page. */
function ie_home_campaign( $slots ) {
	return array(
		'id'                 => 'p1',
		'server_campaign_id' => 'srv-1',
		'is_pillar'          => true,
		'home_page'          => true,
		'target_page'        => array(),
		'publish_mode'       => 'future',
		'every_days'         => 7,
		'slots'              => $slots,
	);
}

function ie_slot( $i, $status = 'scheduled' ) {
	return array(
		'index'   => $i,
		'topic'   => "Topic $i",
		'status'  => $status,
		'post_id' => 100 + $i,
		'url'     => '',
		'slug'    => '',
	);
}

/** Put the site back to a bare WordPress between tests. */
function ie_fresh_site() {
	$GLOBALS['ie_options']   = array( 'show_on_front' => 'posts' );
	$GLOBALS['ie_campaigns'] = array();
	$GLOBALS['ie_posts']     = array();
	$GLOBALS['ie_meta']      = array();
}

test( 'THE FRONT PAGE IS CLAIMED, AND THE RECORDED URL IS THE SITE ROOT', function () {
	/* THE BUG THIS EXISTS FOR, and it would pass every other check.
	 *
	 * A page named by page_on_front has a permalink of the SITE ROOT, and
	 * WordPress 301s its own slug there. on_transition() records the slot's
	 * url from get_permalink(). Read it BEFORE claiming the front page and it
	 * stores /slug/ — so the two ring links into the home page, and the URL in
	 * the blog report, all point at a redirect rather than the real address.
	 *
	 * Nothing breaks. Which is why it needs a test. */
	ie_fresh_site();

	ie_add_post( 100, 'Puppy Training', 'page', 'publish' );
	update_post_meta( 100, '_ie_campaign', 'p1' );
	update_post_meta( 100, '_ie_slot', 0 );

	$GLOBALS['ie_campaigns'] = array( ie_home_campaign( array( ie_slot( 0 ) ) ) );

	IE_Publisher::on_transition( 'publish', 'future', new IE_Test_Post( 100 ) );

	same( 'page', get_option( 'show_on_front' ), 'the site is still showing the post archive' );
	same( 100, (int) get_option( 'page_on_front' ), 'the wrong page was set as the front page' );

	$campaign = IE_Campaigns::get( 'p1' );
	$slot     = $campaign['slots'][0];

	same( 'http://site/', $slot['url'],
		'the recorded URL is the slug, not the root — the permalink was read before the front page was claimed' );
} );

test( 'ONLY SLOT 0 — the other pillars do not touch the front page', function () {
	/* `home_page` means "its FIRST post is the home page", not "every post in
	 * it is". Testing the flag without the index would have slot 19 claim the
	 * root on its way out. */
	ie_fresh_site();

	ie_add_post( 103, 'Barking', 'post', 'publish' );
	update_post_meta( 103, '_ie_campaign', 'p1' );
	update_post_meta( 103, '_ie_slot', 3 );

	$GLOBALS['ie_campaigns'] = array( ie_home_campaign( array( ie_slot( 3 ) ) ) );

	IE_Publisher::on_transition( 'publish', 'future', new IE_Test_Post( 103 ) );

	same( 'posts', get_option( 'show_on_front' ), 'slot 3 claimed the front page' );

	$campaign = IE_Campaigns::get( 'p1' );
	same( 'http://site/103/', $campaign['slots'][0]['url'], 'slot 3 got the root URL' );
} );

test( 'AN ORDINARY PILLAR CAMPAIGN IS UNTOUCHED', function () {
	// Same shape, home_page off. Nothing about the front page may change.
	ie_fresh_site();

	ie_add_post( 100, 'Puppy Training', 'post', 'publish' );
	update_post_meta( 100, '_ie_campaign', 'p1' );
	update_post_meta( 100, '_ie_slot', 0 );

	$c = ie_home_campaign( array( ie_slot( 0 ) ) );
	$c['home_page'] = false;
	$GLOBALS['ie_campaigns'] = array( $c );

	IE_Publisher::on_transition( 'publish', 'future', new IE_Test_Post( 100 ) );

	same( 'posts', get_option( 'show_on_front' ), 'a campaign without the flag claimed the front page' );
	same( 'http://site/100/', IE_Campaigns::get( 'p1' )['slots'][0]['url'] );
} );

test( 'A FRONT PAGE SOMEBODY ALREADY CHOSE IS LEFT ALONE', function () {
	/* Edwin's blogs are empty; this is a product. A customer installing the
	 * plugin on an established site must not find their home page swapped out
	 * because a box was ticked on a campaign form. */
	ie_fresh_site();
	$GLOBALS['ie_options'] = array( 'show_on_front' => 'page', 'page_on_front' => 55 );

	ie_add_post( 100, 'Puppy Training', 'page', 'publish' );
	update_post_meta( 100, '_ie_campaign', 'p1' );
	update_post_meta( 100, '_ie_slot', 0 );

	$GLOBALS['ie_campaigns'] = array( ie_home_campaign( array( ie_slot( 0 ) ) ) );

	IE_Publisher::on_transition( 'publish', 'future', new IE_Test_Post( 100 ) );

	same( 55, (int) get_option( 'page_on_front' ), 'the owner\'s front page was taken' );
	same( 'http://site/100/', IE_Campaigns::get( 'p1' )['slots'][0]['url'],
		'the URL should be the slug — this page is not the front page' );
} );

test( 'THE THREE WIDENED QUERIES CAN SEE A PAGE', function () {
	/* Without this, the home page is invisible to the publisher: its forward
	 * ring link never gets activated and stays a dead <span> for ever.
	 *
	 * Asserted by running the query shape those three use, rather than by
	 * grepping for the word 'page' — the queries are bounded by _ie_campaign,
	 * and that bound is the thing that makes widening them safe. */
	ie_fresh_site();

	ie_add_post( 100, 'The home page', 'page', 'publish' );
	update_post_meta( 100, '_ie_campaign', 'p1' );

	ie_add_post( 101, 'A sibling', 'post', 'publish' );
	update_post_meta( 101, '_ie_campaign', 'p1' );

	// Somebody else's page, with no campaign meta. Must NOT be reachable.
	ie_add_post( 500, 'About us', 'page', 'publish' );

	$found = get_posts( array(
		'post_type'   => array( 'post', 'page' ),
		'post_status' => array( 'publish', 'future', 'draft', 'pending', 'private' ),
		'meta_key'    => '_ie_campaign',
		'meta_value'  => 'p1',
	) );

	$ids = array_map( function ( $p ) { return $p->ID; }, $found );
	sort( $ids );

	same( array( 100, 101 ), $ids,
		'the widened query missed the page, or reached a page the plugin did not create' );
} );

test( 'the publisher asks for both types in all three places', function () {
	/* The one source check in this group, and it is deliberately narrow: that
	 * no `'post_type' => 'post'` survives as a bare string in a query. The
	 * behaviour is covered above; this catches one of the three being missed,
	 * which the behaviour test above cannot see because it runs the query
	 * shape rather than the three call sites. */
	$src = php_strip_whitespace( __DIR__ . '/interlink-engine/includes/class-ie-publisher.php' );

	$bare = preg_match_all( "/'post_type'\s*=>\s*'post'/", $src );

	same( 0, $bare, "a query still asks for posts only — a Page slot would be invisible to it" );
} );

echo "\nThe title tag and the meta description, on any theme\n";

/** A post the plugin wrote, with the meta it has always stored. */
function ie_seo_post( $id = 100, $type = 'post' ) {
	ie_fresh_site();
	ie_add_post( $id, 'What Information Do You Need for a Loan Application?', $type, 'publish' );
	update_post_meta( $id, '_ie_campaign', 'p1' );
	update_post_meta( $id, '_ie_meta_title', 'What Information Do You Need for a Loan Application?' );
	update_post_meta( $id, '_ie_meta_description', 'The documents a lender asks for, and the order to gather them in.' );
	return $id;
}

test( 'THE TITLE COMES FROM THE META, WITH NO SITE NAME ON THE END', function () {
	/* The bug, as Edwin found it on a Kadence site:
	 *
	 *   <title>What Information Do You Need … — hilltophomeloans.net</title>
	 *
	 * The hand-written title was in the database the whole time. Nothing in
	 * this plugin ever put it on the page — the generated themes did that, so
	 * on one of those everything worked and the gap was invisible.
	 *
	 * The suffix is not cosmetic. It is already shown beneath the result, and
	 * here it eats characters off the end of a headline written to fit. */
	$id = ie_seo_post();

	same(
		'What Information Do You Need for a Loan Application?',
		ie_render_title( $id, 'What Information Do You Need for a Loan Application? — hilltophomeloans.net' ),
		'WordPress\'s default title survived'
	);
} );

test( 'THE DESCRIPTION IS PRINTED AT ALL', function () {
	// There was no <meta name="description"> on any non-generated theme,
	// because nothing in the plugin ever emitted one.
	$id = ie_seo_post();

	same(
		'<meta name="description" content="The documents a lender asks for, and the order to gather them in.">',
		ie_render_head( $id )
	);
} );

test( 'THE FRONT PAGE GETS ITS OWN TITLE, not the site name', function () {
	/* The worse of the two. WordPress titles a static front page with the SITE
	 * NAME, so the article's own headline appeared nowhere:
	 *
	 *   <title>hilltophomeloans.net</title>
	 *
	 * And it is the case that decides how the post id is found: on the front
	 * page the loop has not started when pre_get_document_title runs, so
	 * get_the_ID() answers false. IE_SEO uses get_queried_object_id(). */
	$id = ie_seo_post( 100, 'page' );

	same(
		'What Information Do You Need for a Loan Application?',
		ie_render_title( $id, 'hilltophomeloans.net' ),
		'the front page is still titled with the site name'
	);

	ok( false !== strpos( ie_render_head( $id ), 'meta name="description"' ),
		'the front page has no description' );
} );

test( 'A POST THE PLUGIN DID NOT WRITE IS LEFT ALONE', function () {
	/* The guard that keeps this off a customer\'s own content. Their About
	 * page, their posts, their home page: whatever their theme renders. */
	ie_fresh_site();
	ie_add_post( 500, 'About us', 'page', 'publish' );
	update_post_meta( 500, '_ie_meta_title', 'A title nobody asked us to use' );
	update_post_meta( 500, '_ie_meta_description', 'Nor this.' );
	// No _ie_campaign.

	same( 'About us — their site', ie_render_title( 500, 'About us — their site' ),
		'the plugin retitled a page it did not write' );
	same( '', ie_render_head( 500 ), 'the plugin added a description to a page it did not write' );
} );

test( 'an archive or a listing is left alone', function () {
	// is_singular() is false there, and a title filter that fired on an
	// archive would put one post\'s headline on a page listing twenty.
	$id = ie_seo_post();

	same( 'Blog — hilltophomeloans.net', ie_render_title( $id, 'Blog — hilltophomeloans.net', false ) );
	same( '', ie_render_head( $id, false ) );
} );

test( 'a post with no stored title keeps WordPress\'s default', function () {
	/* EMPTY MEANS LEAVE IT ALONE. Returning '' would give the post a blank
	 * <title> — worse than an imperfect one — and posts written before the
	 * plugin stored a title have none. */
	ie_fresh_site();
	ie_add_post( 100, 'Old post', 'post', 'publish' );
	update_post_meta( 100, '_ie_campaign', 'p1' );

	same( 'Old post — site', ie_render_title( 100, 'Old post — site' ) );
	same( '', ie_render_head( 100 ), 'an empty description was printed as an empty tag' );
} );

test( 'AN ACTIVE SEO PLUGIN MAKES THIS ONE STAND DOWN', function () {
	/* Two plugins filtering the title is a priority fight that changes with
	 * activation order, and two description tags on one page. Worse, the owner
	 * editing in the box they know would see no effect.
	 *
	 * Nothing is lost by standing down: IE_Publisher writes the same title and
	 * description to Yoast\'s and Rank Math\'s own keys at publish time, so the
	 * value arrives through the other plugin, in the field the owner edits. */
	$id = ie_seo_post();

	define( 'WPSEO_VERSION', '22.0' );

	same( 'Default from WordPress', ie_render_title( $id, 'Default from WordPress' ),
		'the plugin overrode a title while Yoast was active' );
	same( '', ie_render_head( $id ), 'a second description tag was printed while Yoast was active' );
} );

test( 'THE PUBLISHER NO LONGER WRITES THE SEO PLUGINS\' KEYS', function () {
	/* THIS TEST USED TO ASSERT THE OPPOSITE, and the reversal is the point.
	 *
	 * 0.19.0 wrote our title into Yoast's and Rank Math's own fields, because
	 * IE_SEO stood down for them and rendered nothing — without those rows the
	 * hand-written title was simply discarded.
	 *
	 * 0.21.0 makes ours take precedence through their output filters instead.
	 * A copy in their box would now be a second field the owner can edit to no
	 * effect at all. A box that looks like it works and does not is worse than
	 * no box, so the writes are gone and IE_Metabox is the one place to edit.
	 *
	 * php_strip_whitespace removes comments, which matters here more than
	 * usual: the comment replacing those lines NAMES the keys while explaining
	 * why they are not written. A plain text search would find them and pass. */
	$src = php_strip_whitespace( __DIR__ . '/interlink-engine/includes/class-ie-publisher.php' );

	foreach ( array( '_yoast_wpseo_title', '_yoast_wpseo_metadesc', 'rank_math_title', 'rank_math_description' ) as $key ) {
		ok( false === strpos( $src, "'" . $key . "'" ),
			"the publisher still writes $key — the owner would get a field that edits nothing" );
	}
} );

/* =====================================================================
 * IE_SEO takes precedence, through the other plugin's own filters
 * ===================================================================== */

test( 'OUR TITLE WINS ON OUR POST WHILE YOAST IS ACTIVE', function () {
	/* The requirement, in Edwin's words: ours should win on the posts this
	 * plugin wrote and change nothing anywhere else. */
	$id = ie_seo_post();
	$GLOBALS['ie_queried']  = $id;
	$GLOBALS['ie_singular'] = true;

	same( 'What Information Do You Need for a Loan Application?',
		IE_SEO::filter_title( 'Yoast would have said this' ) );
	same( 'The documents a lender asks for, and the order to gather them in.',
		IE_SEO::filter_description( 'Yoast would have said this' ) );
} );

test( "A CUSTOMER'S OWN PAGE KEEPS THE TITLE THEY WROTE IN YOAST", function () {
	/* THE ONE THAT MATTERS COMMERCIALLY. They have forty pages with titles
	 * they wrote themselves. Returning anything but their value here would
	 * overwrite the work of every customer who installs this. */
	ie_add_post( 500, 'About us', 'page', 'publish' );   // no _ie_campaign
	$GLOBALS['ie_queried']  = 500;
	$GLOBALS['ie_singular'] = true;

	same( 'About us — their own title', IE_SEO::filter_title( 'About us — their own title' ) );
	same( 'Their own description.', IE_SEO::filter_description( 'Their own description.' ) );
} );

test( 'an archive is left to the SEO plugin', function () {
	$id = ie_seo_post();
	$GLOBALS['ie_queried']  = $id;
	$GLOBALS['ie_singular'] = false;

	same( 'Blog — their site', IE_SEO::filter_title( 'Blog — their site' ) );
	same( 'Their archive text.', IE_SEO::filter_description( 'Their archive text.' ) );
} );

test( 'a post with no stored title lets the SEO plugin keep its own', function () {
	/* EMPTY MEANS LEAVE IT ALONE, the same rule the direct renderer follows.
	 * Returning '' would hand Yoast a blank title to print. */
	ie_add_post( 600, 'Older post', 'post', 'publish', array( '_ie_campaign' => 'c1' ) );
	$GLOBALS['ie_queried']  = 600;
	$GLOBALS['ie_singular'] = true;

	same( "Yoast's own answer", IE_SEO::filter_title( "Yoast's own answer" ) );
	same( "Yoast's own answer", IE_SEO::filter_description( "Yoast's own answer" ) );
} );

test( 'THE FILTER NAMES ARE THE ONES THE VENDORS DOCUMENT', function () {
	/* A MISSPELLED FILTER NAME DOES NOT ERROR. It never fires, the feature
	 * ships doing nothing, and every test above still passes because they all
	 * call the methods directly rather than through WordPress.
	 *
	 * These four were read from the vendors' own documentation on 4 October,
	 * not recalled. Comments stripped before searching — the docblock beside
	 * them quotes the names while explaining where they came from. */
	$src  = php_strip_whitespace( __DIR__ . '/interlink-engine/includes/class-ie-seo.php' );

	foreach ( array(
		'wpseo_title', 'wpseo_metadesc',                                 // Yoast
		'rank_math/frontend/title', 'rank_math/frontend/description',    // Rank Math
		'seopress_titles_title', 'seopress_titles_desc',                 // SEOPress
		'aioseo_title', 'aioseo_description',                            // All in One SEO
	) as $hook ) {
		ok( false !== strpos( $src, "'" . $hook . "'" ), "the $hook filter is no longer registered" );
	}
} );

test( 'ALL FOUR SEO PLUGINS ARE FED, NOT JUST THE TWO VERIFIED FIRST', function () {
	/* SEOPress and AIOSEO were left out of 0.21.0 for one reason — their hook
	 * names had not been checked — and the comment said so rather than
	 * dressing the gap up as a decision. Checked against their own docs on 5
	 * October and added.
	 *
	 * THE PAIRING, NOT JUST THE PRESENCE. Found by mutation: wiring
	 * `aioseo_title` to filter_description survived every other check here,
	 * and it would put the META DESCRIPTION INSIDE THE <title> TAG on every
	 * post on an AIOSEO site. Nothing errors, nothing is missing, and the
	 * list-of-names test above passes — eight hooks, all spelled right, one
	 * of them answering the wrong question.
	 *
	 * So the map is asserted whole: every hook, and which method each reaches. */
	$src = php_strip_whitespace( __DIR__ . '/interlink-engine/includes/class-ie-seo.php' );

	preg_match_all(
		"/add_filter\\(\\s*'([^']+)',\\s*array\\(\\s*__CLASS__,\\s*'(filter_title|filter_description)'/",
		$src,
		$m
	);

	$wired = array_combine( $m[1], $m[2] );

	same( array(
		'wpseo_title'                    => 'filter_title',
		'wpseo_metadesc'                 => 'filter_description',
		'rank_math/frontend/title'       => 'filter_title',
		'rank_math/frontend/description' => 'filter_description',
		'seopress_titles_title'          => 'filter_title',
		'seopress_titles_desc'           => 'filter_description',
		'aioseo_title'                   => 'filter_title',
		'aioseo_description'             => 'filter_description',
	), $wired, 'a vendor filter is missing, renamed, or wired to the wrong method' );
} );

test( 'A SEOPRESS SITE GETS OUR TITLE ON OUR POST AND THEIRS ELSEWHERE', function () {
	/* Same two methods Yoast and Rank Math already use, so this is not
	 * re-testing the logic — it is proving the new hooks reach it, and that
	 * the ownership check still refuses a customer's own page. */
	$id = ie_seo_post();
	$GLOBALS['ie_queried']  = $id;
	$GLOBALS['ie_singular'] = true;

	same( 'What Information Do You Need for a Loan Application?',
		IE_SEO::filter_title( 'SEOPress would have said this' ) );

	ie_add_post( 900, 'Their own page', 'page', 'publish' );   // no _ie_campaign
	$GLOBALS['ie_queried'] = 900;

	same( 'Their own title', IE_SEO::filter_title( 'Their own title' ),
		"a SEOPress site's own page lost its title" );
	same( 'Their own description.', IE_SEO::filter_description( 'Their own description.' ),
		"a SEOPress site's own page lost its description" );
} );

/* =====================================================================
 * IE_Metabox — the only place these two values can be edited
 * ===================================================================== */

test( 'THE BOX IS NOT OFFERED ON CONTENT THE PLUGIN DID NOT WRITE', function () {
	$GLOBALS['ie_boxes'] = array();
	ie_add_post( 700, 'Their about page', 'page', 'publish' );

	IE_Metabox::register( 'page', new IE_Test_Post( 700 ) );
	same( array(), $GLOBALS['ie_boxes'], "the box was offered on a customer's own page" );
} );

test( 'the box IS offered on a post the plugin wrote', function () {
	$GLOBALS['ie_boxes'] = array();
	$id = ie_seo_post();

	IE_Metabox::register( 'post', new IE_Test_Post( $id ) );
	ok( isset( $GLOBALS['ie_boxes']['ie-seo-meta'] ), 'the box was not registered on our own post' );
} );

test( 'saving writes the plugin key AND the theme key', function () {
	/* BOTH, because a generated theme renders from the prefixed one in its
	 * own wp_head. Writing only the plugin's key would mean editing this box
	 * on a generated site changed nothing on the page. */
	$id = ie_seo_post();
	IE_Metabox::write( $id, 'A shorter title', 'A better description.' );

	$prefix = IE_Settings::active_theme_prefix();
	same( 'A shorter title', get_post_meta( $id, '_ie_meta_title', true ) );
	same( 'A better description.', get_post_meta( $id, '_ie_meta_description', true ) );
	same( 'A shorter title', get_post_meta( $id, $prefix . '_page_title', true ) );
	same( 'A better description.', get_post_meta( $id, $prefix . '_page_description', true ) );
} );

test( 'AN EMPTIED FIELD IS DELETED, NOT STORED AS AN EMPTY STRING', function () {
	/* AN EMPTY VALUE IS A CLAIM THAT THE VALUE EXISTS. IE_SEO reads '' as
	 * "leave the theme's default alone" — the two only agree if the row is
	 * gone. Stored as '' the post would render a blank <title>. */
	$id = ie_seo_post();
	IE_Metabox::write( $id, 'Something', 'Something else.' );
	IE_Metabox::write( $id, '', '' );

	same( '', get_post_meta( $id, '_ie_meta_title', true ) );
	ok( ! isset( $GLOBALS['ie_meta'][ $id ]['_ie_meta_title'] ), 'an empty title was stored rather than deleted' );
	ok( ! isset( $GLOBALS['ie_meta'][ $id ]['_ie_meta_description'] ), 'an empty description was stored rather than deleted' );
} );

test( 'A SAVE WITHOUT A VALID NONCE WRITES NOTHING', function () {
	$id = ie_seo_post();
	$before = get_post_meta( $id, '_ie_meta_title', true );

	$GLOBALS['ie_nonce_ok'] = false;
	$_POST = array( 'ie_meta_box' => 'x', 'ie_meta_title' => 'injected', 'ie_meta_description' => 'injected' );
	IE_Metabox::save( $id );
	$GLOBALS['ie_nonce_ok'] = true;
	$_POST = array();

	same( $before, get_post_meta( $id, '_ie_meta_title', true ), 'a request with a bad nonce changed the title' );
} );

test( 'a user who may not edit the post writes nothing', function () {
	$id = ie_seo_post();
	$before = get_post_meta( $id, '_ie_meta_title', true );

	$GLOBALS['ie_caps'] = false;
	$_POST = array( 'ie_meta_box' => 'x', 'ie_meta_title' => 'injected', 'ie_meta_description' => 'injected' );
	IE_Metabox::save( $id );
	$GLOBALS['ie_caps'] = true;
	$_POST = array();

	same( $before, get_post_meta( $id, '_ie_meta_title', true ), 'a user without rights changed the title' );
} );

test( "A SAVE AIMED AT SOMEBODY ELSE'S POST IS REFUSED", function () {
	/* NOT REDUNDANT WITH register(). A form can be submitted against any post
	 * id; the box not being drawn is not the same as the write being refused. */
	ie_add_post( 800, 'Their page', 'page', 'publish' );

	$_POST = array( 'ie_meta_box' => 'x', 'ie_meta_title' => 'ours', 'ie_meta_description' => 'ours' );
	IE_Metabox::save( 800 );
	$_POST = array();

	same( '', get_post_meta( 800, '_ie_meta_title', true ), "the plugin wrote meta onto a customer's page" );
} );

test( 'an autosave does not blank both fields', function () {
	/* save_post FIRES ON AUTOSAVE WITH AN EMPTY $_POST. Without the guard,
	 * every autosave of one of our posts silently erases both values — and
	 * the owner watches their title vanish while typing the body. */
	$id = ie_seo_post();
	IE_Metabox::write( $id, 'Keep me', 'Keep me too.' );

	/* A VALID NONCE AND EMPTY FIELDS, which is the only shape that tests the
	 * guard. The first version of this passed $_POST = array(), so the NONCE
	 * check refused the write and the test went green with the autosave guard
	 * deleted — mutation testing caught it. A check masked by the check above
	 * it is not being tested at all.
	 *
	 * Runs last of the save tests on purpose: DOING_AUTOSAVE cannot be
	 * undefined once set. */
	define( 'DOING_AUTOSAVE', true );
	$_POST = array( 'ie_meta_box' => 'x', 'ie_meta_title' => '', 'ie_meta_description' => '' );
	IE_Metabox::save( $id );
	$_POST = array();

	same( 'Keep me', get_post_meta( $id, '_ie_meta_title', true ), 'an autosave erased the title' );
	same( 'Keep me too.', get_post_meta( $id, '_ie_meta_description', true ), 'an autosave erased the description' );
} );

echo "\nThe plugin runs on PHP 7.4, whatever this machine has\n";

test( 'NO SYNTAX NEWER THAN THE DECLARED FLOOR', function () {
	/* THE ONE THAT NEARLY SHIPPED A WHITE SCREEN.
	 *
	 * The first version of the plan payload used
	 *
	 *     ...( $is_pillar ? array() : array( 'targetPage' => $target_page ) )
	 *
	 * Unpacking an array with STRING keys arrived in PHP 8.1. The header says
	 * "Requires PHP: 7.4", this runs on customers' hosting, and it is a PARSE
	 * error — so the whole file dies, not one function. Every site on an older
	 * PHP would have gone white on upgrade.
	 *
	 * It passed `php -l`, because this machine runs 8.4. A SYNTAX CHECK PROVES
	 * THE SYNTAX IS VALID FOR THE INTERPRETER RUNNING IT and says nothing
	 * about the one the customer has.
	 *
	 * A GREP, AND THAT IS A KNOWN WEAKNESS — source greps have missed four
	 * real bugs in this project. It is here anyway because the alternative is
	 * no check at all, and because the failure it guards against is total: not
	 * a wrong value on a page, every page gone. It catches the constructs
	 * actually likely to be reached for, not every 8.x feature. */
	$floor = array(
		'string-keyed array unpacking (PHP 8.1)' => '/\.\.\.\s*(\(|\[|array\s*\()/',
		'nullsafe operator (PHP 8.0)'            => '/\?->/',
		'match expression (PHP 8.0)'             => '/(^|[\s=(])match\s*\(/m',
		'readonly property (PHP 8.1)'            => '/\breadonly\s+(public|protected|private|\$)/',
		'enum (PHP 8.1)'                         => '/^\s*enum\s+\w+/m',
		'str_contains (PHP 8.0)'                 => '/\bstr_contains\s*\(/',
		'str_starts_with (PHP 8.0)'              => '/\bstr_starts_with\s*\(/',
		'array_is_list (PHP 8.1)'                => '/\barray_is_list\s*\(/',
	);

	$files = array_merge(
		glob( __DIR__ . '/interlink-engine/*.php' ),
		glob( __DIR__ . '/interlink-engine/includes/*.php' )
	);

	ok( count( $files ) > 5, 'the plugin files were not found — this test checked nothing' );

	$found = array();

	foreach ( $files as $file ) {
		// Comments are prose and mention these on purpose, including the
		// comment explaining this very mistake. Stripping them is what stops
		// the test failing for its own reasons — the same trap that made an
		// earlier test trip over the phrase "register_activation_hook" inside
		// the comment saying why the hook is not used.
		$code = php_strip_whitespace( $file );

		foreach ( $floor as $label => $pattern ) {
			if ( preg_match( $pattern, $code ) ) {
				$found[] = basename( $file ) . ': ' . $label;
			}
		}
	}

	same( array(), $found, 'syntax newer than PHP 7.4 reached the plugin' );
} );

test( 'the plugin still declares the floor this test checks against', function () {
	/* If the header is raised to 8.1 one day, the list above becomes wrong in
	 * the quiet direction — it would keep refusing syntax that had become
	 * legal. Tying the two together means the header cannot move without this
	 * failing and being looked at. */
	$boot = file_get_contents( __DIR__ . '/interlink-engine/interlink-engine.php' );
	ok( preg_match( '/Requires PHP:\s*7\.4/', $boot ),
		'the declared PHP floor changed — revisit the construct list in this test' );
} );

/* =====================================================================
 * IE_Hygiene — the archives WordPress invents
 *
 * The rule under test is not "is there a pillar campaign". Two rules were
 * proposed before this one and both were wrong: "the pillar claimed the home
 * page" skipped a blog whose archive stays the front page, and "a pillar
 * campaign exists" would have edited a customer's sitemap. The rule is
 * whether anything published here lacks _ie_campaign.
 * ===================================================================== */

/** Set the whole site's content in one line, and forget the memo. */
function ie_site( $rows ) {
	$GLOBALS['ie_posts'] = array();
	$GLOBALS['ie_meta']  = array();
	foreach ( $rows as $id => $row ) {
		ie_add_post( $id, $row[0], $row[1], $row[2], isset( $row[3] ) ? $row[3] : array() );
	}
	$GLOBALS['ie_options'] = array();
	$GLOBALS['ie_view']    = '';
	IE_Hygiene::forget();
}

/** Two posts and a page, every one of them written by the plugin. */
function ie_our_blog() {
	ie_site( array(
		10 => array( 'Loan Terms Explained', 'page', 'publish', array( '_ie_campaign' => 'c1' ) ),
		11 => array( 'What Information Do You Need', 'post', 'publish', array( '_ie_campaign' => 'c1' ) ),
		12 => array( 'Fees and Charges', 'post', 'publish', array( '_ie_campaign' => 'c1' ) ),
	) );
}

/** The same blog, plus one page somebody else wrote. */
function ie_their_site() {
	ie_our_blog();
	ie_add_post( 20, 'About us', 'page', 'publish' );
	IE_Hygiene::forget();
}

function ie_hygiene_head( $view ) {
	$GLOBALS['ie_view'] = $view;
	ob_start();
	IE_Hygiene::noindex();
	return trim( ob_get_clean() );
}

/** '' when nothing redirected, otherwise where it went. */
function ie_hygiene_redirect( $view ) {
	$GLOBALS['ie_view'] = $view;
	try {
		IE_Hygiene::redirect_author();
		return '';
	} catch ( IE_Redirected $e ) {
		return $e->getMessage();
	}
}

test( 'a site written entirely by the plugin is recognised as ours', function () {
	ie_our_blog();
	ok( IE_Hygiene::owns_whole_site(), 'a blog with nothing but plugin content was not recognised' );
} );

test( 'ONE PAGE SOMEBODY ELSE WROTE AND THE PLUGIN KEEPS OUT', function () {
	ie_their_site();
	ok( ! IE_Hygiene::owns_whole_site(), 'a site with a page of their own was treated as ours' );
} );

test( "a fresh WordPress's own Hello world! counts as somebody else's", function () {
	/* DELIBERATE, AND THE REASON IS IN THE CLASS. Special-casing it means
	 * matching a title that differs by WordPress version and by language, and
	 * getting that wrong means editing a stranger's sitemap. It stays out
	 * until the post is deleted, and the setting covers anyone who disagrees. */
	ie_our_blog();
	ie_add_post( 1, 'Hello world!', 'post', 'publish' );
	IE_Hygiene::forget();

	ok( ! IE_Hygiene::owns_whole_site(), 'the default WordPress post did not count' );
} );

test( 'a draft of theirs does not keep the blog untidied', function () {
	/* A draft is not in the sitemap and is not indexed. Counting drafts would
	 * let one abandoned draft hold the tidy-up off for ever. */
	ie_our_blog();
	ie_add_post( 30, 'Half-written idea', 'post', 'draft' );
	IE_Hygiene::forget();

	ok( IE_Hygiene::owns_whole_site(), 'an unpublished draft was treated as published content' );
} );

test( 'THE AUTHOR AND TAXONOMY SECTIONS LEAVE THE SITEMAP', function () {
	ie_our_blog();
	same( false, IE_Hygiene::sitemap_provider( 'obj', 'users' ) );
	same( false, IE_Hygiene::sitemap_provider( 'obj', 'taxonomies' ) );
} );

test( 'posts and pages stay in the sitemap', function () {
	/* The whole point of the file. A filter that answered false for every
	 * provider would empty wp-sitemap.xml and nothing else here would notice. */
	ie_our_blog();
	same( 'obj', IE_Hygiene::sitemap_provider( 'obj', 'posts' ) );
	same( 'obj', IE_Hygiene::sitemap_provider( 'obj', 'pages' ) );
} );

test( "a customer's sitemap is not touched", function () {
	ie_their_site();
	same( 'obj', IE_Hygiene::sitemap_provider( 'obj', 'users' ) );
	same( 'obj', IE_Hygiene::sitemap_provider( 'obj', 'taxonomies' ) );
} );

test( 'the thin archives are noindexed on our blog', function () {
	ie_our_blog();
	foreach ( array( 'author', 'category', 'tag', 'date', 'tax' ) as $view ) {
		has( 'content="noindex, follow"', ie_hygiene_head( $view ), "$view was left indexable" );
	}
} );

test( 'THE FRONT PAGE IS NEVER NOINDEXED', function () {
	/* THE ONE THAT WOULD COST A SITE EVERYTHING. On a pillar campaign that
	 * did not claim the home page, the post index IS the front page — the
	 * most important URL on the site. Noindexing it would remove the whole
	 * blog from search while every other test here stayed green. */
	ie_our_blog();
	same( '', ie_hygiene_head( 'front' ), 'the front page was noindexed' );
	same( '', ie_hygiene_head( 'home' ), 'the blog archive was noindexed' );
} );

test( 'a single post is not noindexed', function () {
	ie_our_blog();
	same( '', ie_hygiene_head( '' ), 'an ordinary page was noindexed' );
} );

test( "nothing is noindexed on a customer's site", function () {
	ie_their_site();
	same( '', ie_hygiene_head( 'category' ), "a customer's category archive was noindexed" );
	same( '', ie_hygiene_head( 'author' ), "a customer's author archive was noindexed" );
} );

test( 'the author archive redirects to the home page', function () {
	ie_our_blog();
	same( 'http://site/', ie_hygiene_redirect( 'author' ) );
} );

test( 'A CATEGORY ARCHIVE IS NOINDEXED BUT NOT REDIRECTED', function () {
	/* A category page may be linked from a menu; noindex keeps it out of
	 * search while leaving it usable. An author archive on a one-writer blog
	 * has no such use, which is why only that one is redirected. */
	ie_our_blog();
	same( '', ie_hygiene_redirect( 'category' ), 'a category archive was redirected away' );
	has( 'noindex', ie_hygiene_head( 'category' ), 'the category archive was not noindexed' );
} );

test( "a customer's author archive still answers", function () {
	ie_their_site();
	same( '', ie_hygiene_redirect( 'author' ), "a customer's author archive was redirected" );
} );

test( "'off' beats everything, including a site that is ours", function () {
	ie_our_blog();
	IE_Settings::set( array( IE_Hygiene::SETTING => 'off' ) );

	same( 'obj', IE_Hygiene::sitemap_provider( 'obj', 'users' ) );
	same( '', ie_hygiene_head( 'category' ) );
	same( '', ie_hygiene_redirect( 'author' ) );
} );

test( "'on' beats everything, including a site that is not", function () {
	ie_their_site();
	IE_Settings::set( array( IE_Hygiene::SETTING => 'on' ) );

	same( false, IE_Hygiene::sitemap_provider( 'obj', 'users' ) );
	has( 'noindex', ie_hygiene_head( 'category' ), 'the forced-on setting did not reach the noindex' );
} );

test( 'AN UNRECOGNISED SETTING FALLS BACK TO AUTOMATIC', function () {
	/* A THREE-STATE VALUE IS WHY THIS IS A SELECT AND NOT A CHECKBOX, and a
	 * stray value must land on the branch that decides for itself rather than
	 * on whichever of on/off an unknown string happens to fall through to. */
	ie_their_site();
	IE_Settings::set( array( IE_Hygiene::SETTING => 'maybe' ) );
	same( 'obj', IE_Hygiene::sitemap_provider( 'obj', 'users' ), 'a junk setting turned tidying on' );

	ie_our_blog();
	IE_Settings::set( array( IE_Hygiene::SETTING => 'maybe' ) );
	same( false, IE_Hygiene::sitemap_provider( 'obj', 'users' ), 'a junk setting turned tidying off' );
} );

test( 'the ownership query asks for one row, not the whole site', function () {
	/* On a customer's site with thousands of posts this runs on every front
	 * end request. The query must stop at the first piece of content that is
	 * not ours. Asserted through the stub, which honours posts_per_page. */
	ie_their_site();
	$rows = get_posts( array(
		'post_type'      => array( 'post', 'page' ),
		'post_status'    => 'publish',
		'posts_per_page' => 1,
		'meta_query'     => array( array( 'key' => '_ie_campaign', 'compare' => 'NOT EXISTS' ) ),
	) );
	same( 1, count( $rows ) );
} );

test( 'THE GENERATED THEME TRIMS ITS OWN SITEMAP', function () {
	/* The theme has noindexed the author archive since September and went on
	 * listing it in wp-sitemap.xml — two contradictory signals about one URL,
	 * and the username leak stands either way because the sitemap is public.
	 *
	 * Comments stripped before searching: the fourth check in this project to
	 * be written against prose was found on 3 October, and the docblock above
	 * this filter names wp_sitemaps_add_provider while explaining it. */
	$src = file_get_contents( __DIR__ . '/../utils/wpThemeBuilder/generators/functionsPhp.js' );
	$code = preg_replace( '#/\*[\s\S]*?\*/#', ' ', $src );
	$code = preg_replace( '#(^|[^:])//[^\n]*#', '$1', $code );

	ok( false !== strpos( $code, "add_filter( 'wp_sitemaps_add_provider'" ),
		'the generated theme no longer trims its sitemap' );
	ok( false !== strpos( $code, "( 'users' === \$name ) ? false : \$provider" ),
		'the theme filter no longer drops the users section' );
} );

/* =====================================================================
 * The keyword a pillar was planned to win — 6 October
 *
 * The pillar form asks "Main keyword of this post" for every topic and REFUSES to
 * plan the campaign without it. That answer was stored on the slot, used to
 * write the post, and then dropped: publishing stamped the pillar FLAG and
 * nothing else.
 *
 * So a later campaign aimed at that pillar had nothing to read, and
 * read_keyword() derived a keyword from the post TITLE. A pillar's title is a
 * headline. "Can You Apply for a Loan in the US Without Being a Citizen?" came
 * out as a thirteen-word keyword with the question mark attached, and the
 * anchors built from it read "understanding can you apply for a loan in the us
 * without being a citizen?".
 *
 * THESE CASES DRIVE insert_post() FOR REAL, through reflection, rather than
 * grepping its source. The one test that already covered PILLAR_META is a
 * source grep, and a source grep cannot tell a line that runs from a line
 * inside an if that is never true.
 * ================================================================== */

/** Run the real insert_post() and return the meta it left on post 999. */
function ie_insert( $campaign_extra, $slot_extra ) {
	$GLOBALS['ie_meta']     = array();
	$GLOBALS['ie_inserted'] = array();

	$method = new ReflectionMethod( 'IE_Publisher', 'insert_post' );
	$method->setAccessible( true );

	$campaign = array_merge( array(
		'id'           => 'c1',
		'publish_mode' => 'future',
		'slots'        => array(),
	), $campaign_extra );

	$slot = array_merge( array(
		'index'      => 0,
		'topic'      => 'Applying for a loan without citizenship',
		'publish_at' => gmdate( 'c', time() + 86400 ),
		'post_id'    => 0,
		'status'     => 'pending',
	), $slot_extra );

	$method->invoke( null, $campaign, $slot, array(
		'title'   => 'Can You Apply for a Loan in the US Without Being a Citizen?',
		'slug'    => 'loan-without-citizenship',
		'content' => '<p>body</p>',
	) );

	return isset( $GLOBALS['ie_meta'][999] ) ? $GLOBALS['ie_meta'][999] : array();
}

test( 'A PUBLISHED PILLAR CARRIES THE KEYWORD IT WAS PLANNED TO WIN', function () {
	/* THE FIX. The owner typed this months before the campaign that needs it
	 * exists, and until now it went no further than the campaign record. */
	$meta = ie_insert(
		array( 'is_pillar' => true ),
		array( 'target_query' => 'loan without us citizenship' )
	);

	same( '1', $meta[ IE_Settings::PILLAR_META ], 'the pillar flag was not stamped' );
	same( 'loan without us citizenship', $meta[ IE_Settings::KEYWORD_META ],
		'the keyword was dropped — a later campaign will derive one from the headline' );
} );

test( 'the keyword is stamped through the constant both sides read', function () {
	/* Spelled out in two files, renamed in one, and the failure is silent: the
	 * publisher stamps a key the admin screen never looks for, the owner sees
	 * the headline default again, and nothing anywhere says why. The same
	 * reasoning as the PILLAR_META case above, which this follows. */
	$publisher = file_get_contents( __DIR__ . '/interlink-engine/includes/class-ie-publisher.php' );

	ok( strpos( $publisher, 'IE_Settings::KEYWORD_META' ) !== false,
		'the publisher uses a literal rather than the constant' );

	$meta = ie_insert(
		array( 'is_pillar' => true ),
		array( 'target_query' => 'second mortgage rules' )
	);

	ok( isset( $meta['_ie_target_query'] ),
		'the constant no longer resolves to the key the admin screen reads' );
} );

test( 'AN ORDINARY CAMPAIGN STAMPS NEITHER', function () {
	/* The opposite failure, and it would be quiet. Only pillars appear in the
	 * Target Page dropdown, so a supporting post carrying a keyword is a row
	 * nothing reads and nothing maintains — and it would make every supporting
	 * post look like a pillar to anything that later keys off the keyword
	 * rather than the flag. PILLAR_META's own rule: written only when true. */
	$meta = ie_insert(
		array( 'is_pillar' => false ),
		array( 'target_query' => 'loan without us citizenship' )
	);

	ok( ! isset( $meta[ IE_Settings::PILLAR_META ] ), 'a non-pillar was flagged' );
	ok( ! isset( $meta[ IE_Settings::KEYWORD_META ] ),
		'a supporting post was given a pillar keyword' );
} );

test( 'AN EMPTY KEYWORD WRITES NO ROW AT ALL', function () {
	/* An empty row is worse than no row, and this is the case that decides
	 * whether the title fallback can survive.
	 *
	 * The reader has to tell "this pillar has no keyword" from "this pillar
	 * was published before the field existed". Absence is the only answer that
	 * means the second, and the second is the one that must keep falling back
	 * to the title — otherwise every pillar already live on every site ends up
	 * with no keyword rather than a bad one. */
	$meta = ie_insert(
		array( 'is_pillar' => true ),
		array( 'target_query' => '   ' )
	);

	same( '1', $meta[ IE_Settings::PILLAR_META ], 'the flag should still be stamped' );
	ok( ! isset( $meta[ IE_Settings::KEYWORD_META ] ),
		'an empty keyword was stored, which reads as "answered with nothing"' );
} );

test( 'a slot with no target_query at all does not fatal', function () {
	/* Campaigns planned before the column existed have slots with no such key.
	 * isset() rather than a bare read is the difference between a warning in
	 * every customer's log and nothing at all. */
	$meta = ie_insert( array( 'is_pillar' => true ), array() );

	same( '1', $meta[ IE_Settings::PILLAR_META ], 'the flag was not stamped' );
	ok( ! isset( $meta[ IE_Settings::KEYWORD_META ] ),
		'a keyword appeared from a slot that has no such key' );
} );

echo "\n$passed passed, $failed failed\n";
exit( $failed ? 1 : 0 );
