<?php
/**
 * test-admin-tabs.php
 *
 * Renders the Campaigns screen with a stubbed WordPress underneath it and
 * reads the HTML that comes out.
 *
 * `php -l` proves the file parses. It says nothing about an undefined
 * function, a missing array key, or a campaign landing in the wrong bucket —
 * and the first person to meet any of those would be a customer looking at a
 * fatal error in their own wp-admin. So the screen is rendered, not inspected.
 *
 * Run:  php wp-plugin/test-admin-tabs.php
 */

error_reporting( E_ALL );

/* ---------------------------------------------------------------------
 * Just enough WordPress
 * ------------------------------------------------------------------ */

define( 'ABSPATH', '/tmp/' );
define( 'IE_VERSION', '0.8.0' );   // only used in markup; kept current so nothing reads as stale
define( 'IE_FILE', '/tmp/x.php' );
define( 'IE_DIR', '/tmp/' );
define( 'IE_URL', 'http://site/' );

function __( $s, $d = null ) { return $s; }
function esc_html__( $s, $d = null ) { return htmlspecialchars( $s, ENT_QUOTES ); }
function esc_attr__( $s, $d = null ) { return htmlspecialchars( $s, ENT_QUOTES ); }
function esc_html_e( $s, $d = null ) { echo htmlspecialchars( $s, ENT_QUOTES ); }
function esc_attr_e( $s, $d = null ) { echo htmlspecialchars( $s, ENT_QUOTES ); }
function esc_html( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES ); }
function esc_attr( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES ); }
function esc_js( $s ) { return addslashes( (string) $s ); }
function wp_strip_all_tags( $s ) { return trim( strip_tags( (string) $s ) ); }
function esc_url( $u ) { return htmlspecialchars( (string) $u, ENT_QUOTES ); }
function esc_url_raw( $u ) { return (string) $u; }
function esc_textarea( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES ); }
function wp_kses( $s, $allowed ) { return strip_tags( (string) $s ); }
function wp_kses_post( $s ) { return (string) $s; }
function wp_unslash( $s ) { return is_string( $s ) ? stripslashes( $s ) : $s; }
function sanitize_key( $s ) { return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( (string) $s ) ); }
function sanitize_text_field( $s ) { return trim( strip_tags( (string) $s ) ); }
function wp_json_encode( $v ) { return json_encode( $v ); }
function number_format_i18n( $n ) { return number_format( (float) $n ); }
function _n( $one, $many, $n, $d = null ) { return 1 === (int) $n ? $one : $many; }
function admin_url( $p = '' ) { return 'http://site/wp-admin/' . $p; }
function wp_date( $fmt, $ts = null ) { return date( $fmt, $ts ? $ts : time() ); }
function wp_timezone_string() { return 'America/Chicago'; }
function current_time( $t ) { return date( 'Y-m-d H:i:s' ); }
function wp_nonce_field( $a ) { echo '<input type="hidden" name="_wpnonce" value="n">'; }
function wp_nonce_url( $u, $a ) { return $u . '&_wpnonce=n'; }
function wp_create_nonce( $a ) { return 'n'; }
/* NULL FOR A POST THAT IS NOT THERE, exactly as WordPress answers.
 *
 * A stub that always returns a URL cannot detect the bug this models:
 * esc_url( null ) is '', so a row linked to a missing post renders
 * <a href="">Topic</a> — a link that looks live and reloads the same page.
 * Returning a URL unconditionally made the test for it pass with the guard
 * removed, which is a test that proves nothing. */
function get_edit_post_link( $id ) {
	$id = (int) $id;

	if ( null !== $GLOBALS['ie_existing_posts'] ) {
		$live = array();
		foreach ( $GLOBALS['ie_existing_posts'] as $k => $v ) {
			$live[] = is_string( $v ) ? (int) $k : (int) $v;
		}
		if ( ! in_array( $id, $live, true ) ) {
			return null;
		}
	}

	return 'http://site/wp-admin/post.php?post=' . $id . '&action=edit';
}
function get_transient( $k ) { return $GLOBALS['ie_transient']; }
function set_transient( $k, $v, $t = 0 ) { $GLOBALS['ie_transient'] = $v; return true; }
function delete_transient( $k ) { $GLOBALS['ie_transient'] = false; return true; }
function get_current_user_id() { return 1; }
function current_user_can( $c ) { return true; }
/* $b DEFAULTS TO true, exactly as WordPress declares it.
 *
 * This stub required two arguments when the real function requires one, so
 * `selected( $cond )` — valid WordPress, used in the new-campaign form — was a
 * fatal here and nowhere else. The first test ever to render that form found
 * it. A stub with a NARROWER signature than the thing it stands for does not
 * fail the code under test; it fails the test, and it reads like a bug in the
 * plugin. Tenth instance of a stub that could not express what it stood for. */
function selected( $a, $b = true, $echo = true ) { $r = ( (string) $a === (string) $b ) ? ' selected' : ''; if ( $echo ) { echo $r; } return $r; }
function checked( $a, $b = true, $echo = true ) { $r = ( $a == $b ) ? ' checked' : ''; if ( $echo ) { echo $r; } return $r; }
function add_action() {}
function add_filter() {}
/**
 * THROWS, BECAUSE THE REAL FLOW NEVER COMES BACK EITHER.
 *
 * IE_Admin::redirect() calls wp_safe_redirect() and then `exit`, which is why
 * no suite in this project had ever invoked a handler: doing so would end the
 * test run at the first redirect, reporting whatever had passed so far as the
 * whole result.
 *
 * A stub that merely records the URL is NARROWER than what it stands for —
 * control continues, the handler runs on past its own exit, and the test
 * exercises code that production can never reach. Throwing is the faithful
 * shape: the caller does not get control back, and the test gets the URL.
 */
class IE_Redirected extends Exception {
	public $url;
	public function __construct( $url ) {
		$this->url = (string) $url;
		parent::__construct( 'redirected' );
	}
}

function wp_safe_redirect( $u ) {
	$GLOBALS['ie_redirect'] = $u;
	throw new IE_Redirected( $u );
}

/* The nonce check and the capability gate. Both are real in production and
 * neither is what these tests are about — but they are CALLED, so a missing
 * stub is a fatal rather than a skipped check. */
function check_admin_referer( $action, $arg = '_wpnonce' ) { return true; }
function wp_die( $m = '' ) { throw new Exception( 'wp_die: ' . $m ); }

/** What a handler redirected to, as parsed query arguments. */
function ie_run_handler( $callable ) {
	try {
		call_user_func( $callable );
	} catch ( IE_Redirected $r ) {
		$q = array();
		$parts = parse_url( $r->url );
		if ( isset( $parts['query'] ) ) { parse_str( $parts['query'], $q ); }
		if ( isset( $q['ie_message'] ) ) { $q['ie_message'] = rawurldecode( $q['ie_message'] ); }
		return $q;
	}

	throw new Exception( 'the handler returned without redirecting — it reported nothing to the owner' );
}
/* A REAL OPTION STORE, because IE_Campaigns is no longer stubbed.
 *
 * `ie_campaigns` is served from the fixture global so that every existing
 * test can keep assigning $GLOBALS['ie_campaigns'] = array( ... ) and have the
 * REAL IE_Campaigns read it. Keyed by campaign id, which is how
 * IE_Campaigns::save() stores them and how ::get() looks them up — a plain
 * list means get( 'c1' ) finds nothing and every write silently does nothing.
 * That exact mistake cost an hour in test-deleted-posts.php. */
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

function absint( $n ) { return abs( (int) $n ); }
function wp_list_pluck( $rows, $field ) {
	return array_map( function ( $r ) use ( $field ) {
		return isset( $r[ $field ] ) ? $r[ $field ] : null;
	}, (array) $rows );
}
function get_permalink( $id ) { $id = is_object( $id ) ? $id->ID : $id; return 'http://site/post-' . (int) $id . '/'; }

/* ---------------------------------------------------------------------
 * Enough WordPress to resolve a typed URL to a post
 * ------------------------------------------------------------------ */

/* id => array( type, status, title ). */
$GLOBALS['ie_url_posts'] = array();

function ie_url_post( $id, $type = 'post', $status = 'publish', $title = 'A hand-written hub' ) {
	$GLOBALS['ie_url_posts'][ (int) $id ] = array(
		'type'   => $type,
		'status' => $status,
		'title'  => $title,
	);
}

function home_url( $p = '' ) { return 'http://site' . $p; }
function sanitize_textarea_field( $v ) { return trim( strip_tags( (string) $v ) ); }
if ( ! defined( 'DAY_IN_SECONDS' ) ) { define( 'DAY_IN_SECONDS', 86400 ); }
function untrailingslashit( $s ) { return rtrim( (string) $s, '/\\' ); }

/**
 * THE REAL FUNCTION'S ANSWER FOR THE REAL FUNCTION'S REASONS.
 *
 * url_to_postid() returns 0 for anything that is not a permalink on THIS
 * site — another domain, a mistyped slug, an archive, the front page. Every
 * one of those is a refusal IE_Admin relies on rather than implementing, so a
 * stub that resolved anything with a number in it would make the guard
 * untestable and the test green on a feature that accepted off-site URLs.
 */
function url_to_postid( $url ) {
	if ( ! preg_match( '#^http://site/post-(\d+)/?$#', (string) $url, $m ) ) {
		return 0;
	}
	$id = (int) $m[1];
	return isset( $GLOBALS['ie_url_posts'][ $id ] ) ? $id : 0;
}

function get_post( $id ) {
	$id = (int) $id;
	if ( ! isset( $GLOBALS['ie_url_posts'][ $id ] ) ) { return null; }
	$row = $GLOBALS['ie_url_posts'][ $id ];
	return (object) array(
		'ID'          => $id,
		'post_type'   => $row['type'],
		'post_status' => $row['status'],
		'post_title'  => $row['title'],
	);
}

function get_the_title( $p = 0 ) {
	$id = is_object( $p ) ? $p->ID : (int) $p;
	return isset( $GLOBALS['ie_url_posts'][ $id ] ) ? $GLOBALS['ie_url_posts'][ $id ]['title'] : '';
}

/* WHICH POSTS STILL EXIST.
 *
 * null means "all of them", so every test written before deleted-post
 * detection existed behaves exactly as it did. A test that wants a deleted
 * post sets $GLOBALS['ie_existing_posts'] to the ids that remain.
 *
 * It honours post_status, because without that a trashed post is
 * indistinguishable from a live one — which is the bug that shipped in 0.4.3
 * and passed a source-grep test for weeks. */
function get_posts( $args ) {
	$wanted = isset( $args['post__in'] ) ? array_map( 'intval', $args['post__in'] ) : array();

	if ( null === $GLOBALS['ie_existing_posts'] ) {
		return $wanted;
	}

	$statuses = isset( $args['post_status'] ) ? (array) $args['post_status'] : array( 'publish' );
	$out      = array();

	foreach ( $GLOBALS['ie_existing_posts'] as $key => $value ) {
		if ( is_string( $value ) ) {
			$id     = (int) $key;
			$status = $value;
		} else {
			$id     = (int) $value;
			$status = 'publish';
		}

		if ( in_array( $id, $wanted, true ) && in_array( $status, $statuses, true ) ) {
			$out[] = $id;
		}
	}

	return $out;
}
function plugin_dir_path( $f ) { return '/tmp/'; }
function plugin_dir_url( $f ) { return 'http://site/'; }
function is_wp_error( $t ) { return $t instanceof WP_Error; }

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
	$q = array_merge( $q, $args );
	$base = ( isset( $parts['scheme'] ) ? $parts['scheme'] . '://' . $parts['host'] : '' ) . ( isset( $parts['path'] ) ? $parts['path'] : '' );
	// %#% is paginate_links's placeholder and must survive urlencoding.
	return $base . '?' . str_replace( '%25%23%25', '%#%', http_build_query( $q ) );
}

function paginate_links( $args ) {
	$out = array();
	for ( $i = 1; $i <= $args['total']; $i++ ) {
		$url = str_replace( '%#%', $i, $args['base'] );
		$out[] = ( $i === $args['current'] )
			? '<span class="page-numbers current">' . $i . '</span>'
			: '<a class="page-numbers" href="' . $url . '">' . $i . '</a>';
	}
	return implode( ' ', $out );
}

/* ---------------------------------------------------------------------
 * Stubbed plugin classes
 * ------------------------------------------------------------------ */

$GLOBALS['ie_transient'] = false;
$GLOBALS['ie_campaigns'] = array();
$GLOBALS['ie_options'] = array();
$GLOBALS['ie_existing_posts'] = null;   // null = every post still exists

class IE_Settings {
	public static function is_connected() { return true; }
	public static function credits_per_post() { return 75; }
	public static function get( $k, $d = null ) { return $d; }
	public static function target_pages() {
		return array( 12 => array( 'title' => 'quality plumbing leander', 'url' => 'http://site/quality-plumbing-leander/' ) );
	}
	public static function credits() { return 7000; }
	public static function server_url() { return 'https://threecomets.com'; }
	public static function set( $v ) { return true; }
	public static function business() {
		return array( 'name' => 'Quality Plumbing', 'trade' => 'plumber', 'town' => 'Leander', 'phone' => '' );
	}
	public static function active_theme_prefix() { return 'theme'; }
}

/* THE REAL IE_Campaigns, NOT A COPY OF IT.
 *
 * There used to be a hand-written stub here with four methods on it. The real
 * class grew post_missing() in 0.4.3 and the stub did not, so all 23 render
 * tests below died on one undefined method — and nothing said so, because
 * this suite was not in deploy.sh (that loop runs `node "$suite"` and this is
 * PHP). It sat broken for weeks while class-ie-admin.php was edited daily.
 *
 * A stub of a class you own is a copy that must be maintained, and it will be
 * forgotten. The real class needs nothing but WordPress, and WordPress is
 * already stubbed above. */
require_once __DIR__ . '/interlink-engine/includes/class-ie-campaigns.php';

class IE_Api {}
class IE_Publisher {
	public static function get_log() { return array(); }
	public static function log( $m ) {}
	public static function pause( $id ) { return 0; }
	public static function resume( $id ) { return 0; }
	public static function run_campaign( $id ) { return array(); }
	public static function publish_now( $id ) { return 1; }
	public static function on_transition( $a, $b, $c ) {}
	public static function sweep_deleted() { return array( 'slots' => 0, 'campaigns' => 0 ); }
	public static function flush_deleted_reports() { return 0; }

	/* The card renders these counts into its confirmation dialogs. Served
	 * from a global so a test can set them, rather than returning a fixed
	 * pair — a stub that cannot express the numbers cannot catch a dialog
	 * that names the wrong ones. */
	public static function count_campaign_posts( $id ) {
		return isset( $GLOBALS['ie_post_counts'][ $id ] )
			? $GLOBALS['ie_post_counts'][ $id ]
			: array( 'published' => 0, 'drafts' => 0 );
	}
	public static function remove_campaign( $id ) { return array( 'published' => 0, 'drafts' => 0 ); }
	public static function remove_campaign_posts( $id ) { return array( 'published' => 0, 'drafts' => 0 ); }
	public static function delete_remaining_drafts( $id ) { return 0; }
	public static function repair_links() { return array( 'restored' => 0, 'unwrapped' => 0, 'waiting' => 0, 'posts' => 0, 'short' => array() ); }
	public static function ring_close_target( $c, $p ) { return ''; }
	public static function abandon_remaining( $id ) { return 0; }
	public static function post_for_slot( $c, $i ) { return 0; }
}

require __DIR__ . '/interlink-engine/includes/class-ie-admin.php';

/* ---------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------ */

$GLOBALS['ie_upcoming']    = array();
$GLOBALS['ie_post_counts'] = array();

function slot( $i, $status, $days_from_now = 1, $topic = null ) {
	return array(
		'index'        => $i,
		'topic'        => $topic ? $topic : "Topic $i",
		'target_query' => "search term $i",
		'publish_at'   => date( 'Y-m-d H:i:s', time() + $days_from_now * 86400 ),
		'status'       => $status,
		'post_id'      => 'pending' === $status ? 0 : 100 + $i,
		'error'        => '',
	);
}

function campaign( $id, $label, $slots, $approved, $created = '2026-09-01 09:00:00' ) {
	return array(
		'id'            => $id,
		'label'         => $label,
		'target_page'   => array( 'title' => 'quality plumbing leander', 'url' => 'http://site/p/' ),
		'every_days'    => 1,
		'publish_mode'  => 'future',
		'quote'         => array( 'total' => 75 * count( $slots ), 'creditsPerPost' => 75 ),
		'slots'         => $slots,
		'batch_started' => $approved ? '2026-09-05 09:00:00' : '',
		'created'       => $created,
	);
}

/* ---------------------------------------------------------------------
 * Harness
 * ------------------------------------------------------------------ */

$passed = 0; $failed = 0;

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

function ok( $cond, $msg ) { if ( ! $cond ) { throw new Exception( $msg ); } }

/**
 * How many finished-campaign cards are on the page.
 *
 * Counted by matching the numbered fixture labels, not by counting the
 * phrase "finished campaign" — the Completed tab's own explanatory line
 * contains that phrase, which quietly made every count one too high and
 * looked exactly like an off-by-one in the pagination.
 */
function cards( $html ) {
	/* COUNTS THE REMOVE LINK, one per card, rather than the campaign's label.
	 * The label is printed twice now — once as the heading and once inside
	 * the removal dialog, which names the campaign it is about to destroy —
	 * so counting labels reported exactly double and read as a pagination
	 * bug. A marker that appears once per card cannot drift that way. */
	preg_match_all( '/action=ie_delete_campaign/', $html, $m );
	return count( $m[0] );
}
function same( $expected, $actual, $msg = null ) {
	ok( $expected === $actual, ( $msg ? $msg : 'not equal' )
		. ' — expected ' . var_export( $expected, true )
		. ', got ' . var_export( $actual, true ) );
}
function has( $hay, $needle, $msg = null ) { ok( false !== strpos( $hay, $needle ), $msg ? $msg : "expected to find: $needle" ); }
function hasnt( $hay, $needle, $msg = null ) { ok( false === strpos( $hay, $needle ), $msg ? $msg : "did NOT expect: $needle" ); }

function render( $tab = null, $paged = null ) {
	/* ONE RENDER IS ONE REQUEST, so it starts with the post cache empty.
	 *
	 * IE_Campaigns caches which post ids still exist in a static, filled the
	 * first time anything asks and correct for the rest of that request. In a
	 * suite it survives into the next test, so a fixture introducing post ids
	 * the earlier one never mentioned had every one of them reported deleted:
	 * a campaign with four live posts rendered "1 of 4 scheduled, 1 live,
	 * 3 posts deleted" and the test read like a bug in the code it was
	 * checking. Tests were calling forget_post_cache() by hand, which works
	 * right up to the first one that forgets. */
	IE_Campaigns::forget_post_cache();

	$_GET = array( 'page' => 'interlink-engine' );
	if ( null !== $tab )   { $_GET['tab'] = $tab; }
	if ( null !== $paged ) { $_GET['paged'] = $paged; }
	ob_start();
	IE_Admin::render_campaigns();
	return ob_get_clean();
}

/* ===================================================================== */

echo "\nBucketing\n";

$running = campaign( 'c-run', 'quality plumbing leander',
	array( slot( 0, 'published', -1 ), slot( 1, 'scheduled', 1 ), slot( 2, 'pending', 2 ) ), true );

$draftc  = campaign( 'c-draft', 'emergency plumber leander',
	array( slot( 0, 'pending', 1 ), slot( 1, 'pending', 4 ) ), false );

$donec   = campaign( 'c-done', 'water cleanup leander',
	array( slot( 0, 'published', -5 ), slot( 1, 'published', -3 ) ), true );

$GLOBALS['ie_campaigns'] = array( $running, $draftc, $donec );

test( 'the default tab is In progress', function () {
	$html = render();
	has( $html, 'nav-tab-active', 'no active tab' );
	ok( preg_match( '/nav-tab nav-tab-active[^>]*>\s*In progress/', $html ), 'In progress is not the active tab' );
} );

test( 'an unapproved campaign is a draft, not "in progress"', function () {
	// The whole point of the new tab. Nothing has been written or charged, so
	// it must not sit among the campaigns that are actually publishing.
	$html = render( 'running' );
	has( $html, 'quality plumbing leander' );
	hasnt( $html, 'emergency plumber leander', 'an unapproved campaign appeared under In progress' );
} );

test( 'a fully published campaign is not "in progress" either', function () {
	$html = render( 'running' );
	hasnt( $html, 'water cleanup leander', 'a finished campaign appeared under In progress' );
} );

test( 'the drafts tab holds only the unapproved one', function () {
	$html = render( 'drafts' );
	has( $html, 'emergency plumber leander' );
	hasnt( $html, 'water cleanup leander' );
} );

test( 'the drafts tab says nothing has been charged', function () {
	$html = render( 'drafts' );
	has( $html, 'Nothing here has been charged', 'the reassurance is missing' );
} );

test( 'the completed tab holds only the finished one', function () {
	$html = render( 'done' );
	has( $html, 'water cleanup leander' );
	hasnt( $html, 'emergency plumber leander' );
} );

test( 'the tab counts are right', function () {
	$html = render();
	ok( preg_match( '/In progress\s*<span class="ie-count">1<\/span>/', $html ), 'In progress count wrong' );
	ok( preg_match( '/Campaigns needing approval\s*<span class="ie-count ie-count-need">1<\/span>/', $html ), 'drafts count/colour wrong' );
	ok( preg_match( '/Completed\s*<span class="ie-count">1<\/span>/', $html ), 'Completed count wrong' );
} );

test( 'an unknown tab falls back to In progress rather than a blank screen', function () {
	$html = render( 'wat' );
	ok( preg_match( '/nav-tab nav-tab-active[^>]*>\s*In progress/', $html ), 'did not fall back' );
} );

echo "\nState words\n";

test( 'the five state words are used', function () {
	$html = render( 'running' );
	has( $html, '>Live<' );
	has( $html, '>Scheduled<' );
	has( $html, '>Arriving<' );
} );

test( 'the old two-names-for-one-thing wording is gone', function () {
	$all = render( 'running' ) . render( 'drafts' ) . render( 'done' );
	hasnt( $all, 'waiting to collect', 'old wording survived' );
	hasnt( $all, 'not written yet', 'old wording survived' );
} );

test( 'a scheduled post whose date has passed reads as Overdue', function () {
	// WP-Cron has not fired. Still calling it "Scheduled" is a claim the owner
	// can disprove by looking at a calendar.
	$late = campaign( 'c-late', 'late one', array( slot( 0, 'scheduled', -2 ) ), true );
	$GLOBALS['ie_campaigns'] = array( $late );
	$html = render( 'running' );
	has( $html, '>Overdue<', 'a past-dated scheduled post did not read as Overdue' );
} );

echo "\nControls\n";

test( 'Publish early is a link, not a button', function () {
	$GLOBALS['ie_campaigns'] = array( campaign( 'c1', 'x', array( slot( 0, 'scheduled', 3 ) ), true ) );
	$html = render( 'running' );
	has( $html, 'Publish early' );
	hasnt( $html, 'Publish now', 'the old wording survived' );
	ok( ! preg_match( '/class="button button-small"[^>]*>\s*Publish/', $html ), 'still rendered as a button' );
} );

test( 'publishing early asks first', function () {
	$GLOBALS['ie_campaigns'] = array( campaign( 'c1', 'x', array( slot( 0, 'scheduled', 3 ) ), true ) );
	$html = render( 'running' );
	has( $html, 'onclick="return confirm(', 'no confirmation on a date-discarding action' );
} );

test( 'the search-term column starts hidden', function () {
	$GLOBALS['ie_campaigns'] = array( campaign( 'c1', 'x', array( slot( 0, 'scheduled', 3 ) ), true ) );
	$html = render( 'running' );
	has( $html, 'class="ie-terms" hidden', 'the terms column is not hidden' );
	has( $html, 'Show search terms', 'no toggle to bring it back' );
} );

/* ---------------------------------------------------------------------
 * The Completed tab folds too
 *
 * The fold and the filter box were built for the fifty-campaign problem and
 * wired into the In progress tab alone. In progress EMPTIES ITSELF as
 * campaigns finish; the Completed tab only ever grows. So the tab that never
 * reaches fifty got the fix, and the tab that certainly will was left paging
 * through full cards ten at a time.
 *
 * These replace the pagination tests. The pager is gone: a folded row is one
 * line, fifty of them is a screen you can scan, and the filter box finds a
 * campaign faster than remembering which page it was on.
 * ------------------------------------------------------------------ */

echo "\nThe completed tab folds too\n";

$many = array();
for ( $i = 0; $i < 23; $i++ ) {
	$c = campaign(
		"done-$i",
		"finished campaign $i",
		array( slot( 0, 'published', -30 ) ),
		true,
		date( 'Y-m-d H:i:s', strtotime( '2026-01-01' ) + $i * 86400 )
	);

	// Three money pages, so the grouping has something to group by.
	$page = $i % 3;
	$c['target_page'] = array(
		'title' => 'Money Page ' . $page,
		'url'   => 'http://site/p/' . $page,
	);

	$many[] = $c;
}

test( 'TWENTY-THREE FINISHED CAMPAIGNS ALL FIT ON ONE SCREEN', function () use ( $many ) {
	$GLOBALS['ie_campaigns'] = $many;
	$html = render( 'done' );

	same( 23, cards( $html ), 'the completed tab is still showing a slice' );
	has( $html, '23 campaigns', 'the total is not stated' );
	hasnt( $html, 'page-numbers', 'the pager survived' );
} );

test( 'they fold into rows rather than cards', function () use ( $many ) {
	$GLOBALS['ie_campaigns'] = $many;
	$html = render( 'done' );

	/* Counted on the opening tag: 'ie-campaign-fold' also appears in the
	 * filter's JavaScript, so the bare class name reports one too many. */
	same( 23, substr_count( $html, '<details class="ie-campaign-fold"' ),
		'the finished campaigns did not fold' );
} );

test( 'AND THEY CAN BE FILTERED', function () use ( $many ) {
	$GLOBALS['ie_campaigns'] = $many;
	$html = render( 'done' );

	has( $html, 'id="ie-campaign-filter"', 'there is no way to search the finished list' );
	has( $html, 'Filter 23 campaigns', 'the filter box does not say what it filters' );
	has( $html, 'data-ie-search="finished campaign 7 money page 1"',
		'a finished campaign cannot be matched by its own name or page' );
} );

test( 'numbered 1 through 23, with no headings', function () use ( $many ) {
	$GLOBALS['ie_campaigns'] = $many;
	$html = render( 'done' );

	preg_match_all( '/<span class="ie-row-num">(\d+)\.<\/span>/', $html, $m );

	same( range( 1, 23 ), array_map( 'intval', $m[1] ),
		'the finished campaigns are not numbered straight through' );
	hasnt( $html, 'ie-group-heading', 'the completed tab still draws headings' );
} );

test( 'newest finished is still first', function () use ( $many ) {
	$GLOBALS['ie_campaigns'] = $many;
	$html = render( 'done' );

	$newest = strpos( $html, 'finished campaign 22' );
	$oldest = strpos( $html, 'finished campaign 0<' );

	ok( false !== $newest, 'the most recent one is not on the page at all' );
	ok( false === $oldest || $newest < $oldest, 'the oldest one comes first' );
} );

test( 'an old ?paged bookmark shows everything rather than nothing', function () use ( $many ) {
	/* The pager is gone, so links people saved point at a parameter nothing
	 * reads. Ignoring it is the right failure; an empty screen is not. */
	$GLOBALS['ie_campaigns'] = $many;

	same( 23, cards( render( 'done', 3 ) ), 'a stale ?paged=3 lost the list' );
	same( 23, cards( render( 'done', 999 ) ), 'a stale ?paged=999 lost the list' );
} );

test( 'A HANDFUL OF FINISHED CAMPAIGNS STILL OPEN AS CARDS', function () {
	/* The same threshold as In progress. A fold and a filter box over three
	 * campaigns is furniture. */
	$few = array();
	for ( $i = 0; $i < 3; $i++ ) {
		$few[] = campaign( "d-$i", "only $i", array( slot( 0, 'published', -2 ) ), true );
	}

	$GLOBALS['ie_campaigns'] = $few;
	$html = render( 'done' );

	same( 3, cards( $html ), 'the cards are not all there' );
	hasnt( $html, '<details class="ie-campaign-fold"', 'three campaigns were folded' );
	hasnt( $html, 'id="ie-campaign-filter"', 'a filter box over three campaigns' );
	hasnt( $html, 'page-numbers', 'drew a pager' );
} );

test( 'COMING UP IS DRAWN ONCE, NOT TWICE', function () {
	/* An unconditional call followed by an `if ( count > 1 )` call, in a
	 * branch that only runs at four or more — so the one screen the fold was
	 * built for printed the whole schedule table twice. */
	$GLOBALS['ie_campaigns'] = many_running( 6, 2 );

	$html = render( 'running' );

	/* Six campaigns, each with a post four days out, so upcoming() has rows
	 * and the section really is drawn — a count of 1 on a section that never
	 * renders would pass for the wrong reason. */
	same( 1, substr_count( $html, '>Coming up<' ), 'Coming up was not rendered exactly once' );
} );

echo "\nEmpty states\n";

test( 'a brand new install is told what a campaign is', function () {
	$GLOBALS['ie_campaigns'] = array();
$GLOBALS['ie_options'] = array();
$GLOBALS['ie_existing_posts'] = null;   // null = every post still exists
	$html = render();
	has( $html, 'No campaigns yet' );
	has( $html, 'Plan your first campaign', 'no way forward from the empty state' );
} );

test( 'each empty tab says something true rather than nothing', function () {
	$GLOBALS['ie_campaigns'] = array();
$GLOBALS['ie_options'] = array();
$GLOBALS['ie_existing_posts'] = null;   // null = every post still exists
	has( render( 'drafts' ), 'Nothing needs approval' );
	has( render( 'done' ), 'No campaigns have finished yet' );
} );

echo "\nWhere actions land\n";

test( 'suggesting topics returns to the form that shows them', function () {
	// The nasty one: land this on In progress and the owner gets a success
	// notice about topics that are not on the screen, and suggests again.
	$m = new ReflectionMethod( 'IE_Admin', 'tab_for_status' );
	$m->setAccessible( true );
	ok( 'new' === $m->invoke( null, 'suggested' ), 'suggested does not return to the form' );
	ok( 'new' === $m->invoke( null, 'discarded' ), 'discarding topics leaves the form' );
} );

test( 'a planned campaign lands in Campaigns needing approval', function () {
	$m = new ReflectionMethod( 'IE_Admin', 'tab_for_status' );
	$m->setAccessible( true );
	ok( 'drafts' === $m->invoke( null, 'planned' ), 'a new plan does not land on drafts' );
	ok( 'drafts' === $m->invoke( null, 'credits' ), 'a refused approval does not stay on drafts' );
} );

test( 'writing and publishing land on In progress', function () {
	$m = new ReflectionMethod( 'IE_Admin', 'tab_for_status' );
	$m->setAccessible( true );
	foreach ( array( 'writing', 'scheduled', 'published', 'removed' ) as $s ) {
		ok( 'running' === $m->invoke( null, $s ), "$s landed on the wrong tab" );
	}
} );

test( 'every redirect from the campaigns screen names a tab', function () {
	$src = file_get_contents( __DIR__ . '/interlink-engine/includes/class-ie-admin.php' );
	// tab_for_status supplies one for anything that does not say, so the real
	// check is that the defaulting exists at all.
	has( $src, "if ( 'interlink-engine' === \$page && ! isset( \$extra['tab'] ) )", 'redirect() no longer defaults the tab' );
} );

echo "\nEscaping\n";

test( 'a campaign label carrying markup is escaped', function () {
	$evil = campaign( 'c-x', '<script>alert(1)</script>', array( slot( 0, 'scheduled', 2 ) ), true );
	$GLOBALS['ie_campaigns'] = array( $evil );
	$html = render( 'running' );
	hasnt( $html, '<script>alert(1)</script>', 'a campaign label was printed as markup' );
	has( $html, '&lt;script&gt;', 'expected it escaped' );
} );

test( 'a hostile tab value cannot reach the output', function () {
	$html = render( '"><script>alert(1)</script>' );
	hasnt( $html, '<script>alert(1)</script>', 'the tab parameter reached the page' );
} );

echo "\nDeleted posts on the screen\n";

/* These are RENDER tests, and that is the whole point of them.
 *
 * Until this harness worked, the two guards below were asserted by grepping
 * class-ie-admin.php for a fragment of PHP — in test-deleted-posts.php, with
 * comments saying so and saying why. Source greps have missed four real bugs
 * in this codebase, one of which passed for weeks by asserting the exact bug
 * its own name forbade. A guard proved by a grep is a guard nobody has seen
 * work. */

test( 'A DELETED POST READS "Post deleted", NOT "Overdue"', function () {
	/* "Overdue" is this plugin's alarm for WP-Cron having stopped. A deleted
	 * post raising it sends whoever reads it after a scheduler that is working
	 * perfectly — an evening of it, on a real site. */
	$c = campaign( 'c-gone', 'slab leak detection',
		array( slot( 0, 'scheduled', -5 ) ), true );

	$GLOBALS['ie_campaigns']      = array( $c );
	$GLOBALS['ie_existing_posts'] = array();   // the post is gone
	IE_Campaigns::forget_post_cache();

	$html = render( 'running' );

	has( $html, 'Post deleted', 'a deleted post is not labelled' );
	hasnt( $html, '>Overdue<', 'a deleted post is still raising the WP-Cron alarm' );

	$GLOBALS['ie_existing_posts'] = null;
	IE_Campaigns::forget_post_cache();
} );

test( 'PUBLISH EARLY IS NOT OFFERED FOR A DELETED POST', function () {
	/* The stored slot status still reads 'scheduled' for a deleted post, so
	 * gating on that alone put a working link on six dead rows. Pressing one
	 * reported SUCCESS: wp_update_post() answers 0 for a missing post id
	 * rather than a WP_Error, which is exactly what the handler checked for. */
	$c = campaign( 'c-gone', 'slab leak detection',
		array( slot( 0, 'scheduled', -5 ) ), true );

	$GLOBALS['ie_campaigns']      = array( $c );
	$GLOBALS['ie_existing_posts'] = array();
	IE_Campaigns::forget_post_cache();

	$html = render( 'running' );

	hasnt( $html, 'Publish early', 'Publish early was offered for a post that does not exist' );

	$GLOBALS['ie_existing_posts'] = null;
	IE_Campaigns::forget_post_cache();
} );

test( 'a live post still gets its Publish early link', function () {
	// The guard must not become a blanket removal.
	$c = campaign( 'c-live', 'slab leak detection',
		array( slot( 0, 'scheduled', 3 ) ), true );

	$GLOBALS['ie_campaigns'] = array( $c );
	IE_Campaigns::forget_post_cache();

	has( render( 'running' ), 'Publish early', 'a healthy scheduled post lost its link' );
} );

test( 'a deleted post is not linked to an editor that cannot open it', function () {
	/* get_edit_post_link() returns null for a missing post, esc_url( null ) is
	 * '', and the row then rendered <a href="">Topic</a> — a link that looks
	 * live and reloads the same page. Somebody clicking it learns nothing,
	 * which is worse than it plainly not being clickable. */
	$c = campaign( 'c-gone', 'slab leak detection',
		array( slot( 0, 'scheduled', -5, 'A Warm Floor Spot' ) ), true );

	$GLOBALS['ie_campaigns']      = array( $c );
	$GLOBALS['ie_existing_posts'] = array();
	IE_Campaigns::forget_post_cache();

	$html = render( 'running' );

	has( $html, 'A Warm Floor Spot', 'the topic vanished entirely' );
	hasnt( $html, 'href=""', 'a deleted post is still wrapped in an empty link' );

	$GLOBALS['ie_existing_posts'] = null;
	IE_Campaigns::forget_post_cache();
} );

test( 'THE CHECK FOR DELETED POSTS BUTTON IS ON THE SCREEN', function () {
	/* The sweep rides on WP-Cron, which fires on page loads. A site whose
	 * campaigns have all FINISHED is never pinged by the server, so on a site
	 * with no visitors it may not run for weeks — and that is precisely the
	 * site where posts get tidied up. Without this button the only advice is
	 * "go and load your own home page". */
	$c = campaign( 'c-done2', 'water cleanup leander',
		array( slot( 0, 'published', -5 ) ), true );

	$GLOBALS['ie_campaigns'] = array( $c );
	IE_Campaigns::forget_post_cache();

	$html = render( 'done' );

	has( $html, 'Check for deleted posts', 'the button is gone' );
	has( $html, 'action=ie_check_deleted', 'the button posts nowhere' );
} );

/* ---------------------------------------------------------------------
 * The two dialogs in front of Remove
 * ------------------------------------------------------------------ */

test( 'A CANCELLED CAMPAIGN LEAVES THE RUNNING TAB', function () {
	/* Its unpublished posts were thrown away, so the slots naming them go on
	 * reading 'scheduled' for posts that no longer exist — work that is never
	 * coming. Without this it sat on the running tab for ever with nothing
	 * left to do and no way to close it out. */
	$c = campaign( 'c-over', 'slab leak detection',
		array( slot( 0, 'published', -3 ), slot( 1, 'scheduled', 4 ) ), true );
	$c['status'] = 'cancelled';

	$GLOBALS['ie_campaigns'] = array( $c );

	hasnt( render( 'running' ), 'slab leak detection',
		'a closed-out campaign is still on the running tab' );
	has( render( 'done' ), 'slab leak detection',
		'a closed-out campaign is not on the finished tab either' );
} );

test( 'a campaign still running is not sent to the finished tab', function () {
	// The guard against closing out everything.
	$c = campaign( 'c-live', 'slab leak detection',
		array( slot( 0, 'published', -3 ), slot( 1, 'scheduled', 4 ) ), true );

	$GLOBALS['ie_campaigns'] = array( $c );

	has( render( 'running' ), 'slab leak detection', 'a live campaign vanished' );
} );

/* ---------------------------------------------------------------------
 * Fifty campaigns
 *
 * Every campaign rendered a full card, one after another. At three that
 * reads well. At fifty it is a page nobody can navigate: the campaign you
 * came for is a thousand pixels down a wall of identical boxes.
 * ------------------------------------------------------------------ */

/** $n running campaigns, spread across $pages money pages. */
function many_running( $n, $pages = 1 ) {
	$out = array();

	for ( $i = 0; $i < $n; $i++ ) {
		$c = campaign( 'c-' . $i, 'Campaign ' . $i,
			array( slot( 0, 'published', -3 ), slot( 1, 'scheduled', 4 ) ), true );

		$page = $i % $pages;

		// upcoming() reads this directly; without it every render of these
		// fixtures warns, which buries the failure being looked for.
		$c['status'] = 'active';

		$c['target_page'] = array(
			'title' => 'Money Page ' . $page,
			'url'   => 'http://site/p/' . $page,
		);

		$out[] = $c;
	}

	return $out;
}

test( 'A FEW CAMPAIGNS ARE LEFT EXACTLY AS THEY WERE', function () {
	/* The fold and the filter are furniture over two campaigns. Somebody who
	 * is not drowning should not be made to open things. */
	$GLOBALS['ie_campaigns'] = many_running( 2 );

	$html = render( 'running' );

	hasnt( $html, '<details class="ie-campaign-fold"', 'two campaigns were folded away' );
	hasnt( $html, 'id="ie-campaign-filter"', 'two campaigns got a filter box' );
	has( $html, 'Campaign 0', 'a campaign vanished' );
} );

test( 'FIFTY CAMPAIGNS FOLD INTO ROWS', function () {
	$GLOBALS['ie_campaigns'] = many_running( 50, 5 );

	$html = render( 'running' );

	/* THE OPENING TAG, not the bare class name — which also appears twice in
	 * the filter's JavaScript, so counting it said 52 for fifty campaigns and
	 * read exactly like an off-by-two in the grouping. */
	same( 50, substr_count( $html, '<details class="ie-campaign-fold"' ),
		'not every campaign became a foldable row' );
} );

/** The rows in the order they were rendered, by what the filter searches. */
function row_order( $html ) {
	preg_match_all( '/data-ie-search="([^"]*)"/', $html, $m );
	return $m[1];
}

test( 'THE MONEY-PAGE HEADINGS ARE GONE', function () {
	/* Campaigns are usually named after the page they feed, so every heading
	 * read "Toilet Replacement Services — 1 campaign" directly above a row
	 * reading "Toilet Replacement Services — 4 of 4 scheduled". At fifty that
	 * is a hundred lines to say fifty things, on the screen whose whole job
	 * is to stop that. */
	$GLOBALS['ie_campaigns'] = many_running( 12, 3 );

	$html = render( 'running' );

	hasnt( $html, 'ie-group-heading', 'the headings are still being drawn' );
	hasnt( $html, '4 campaigns', 'a group is still announcing how many it holds' );
} );

test( 'CAMPAIGNS FEEDING ONE PAGE STILL COME OUT TOGETHER', function () {
	/* The grouping stayed; only its heading went. Adjacency was the half
	 * worth having — several campaigns at one page are the thing an owner
	 * reasons about, and a list that scatters them is back to an unordered
	 * pile whatever it is called. */
	$GLOBALS['ie_campaigns'] = many_running( 12, 3 );

	$rows = row_order( render( 'running' ) );

	same( 12, count( $rows ), 'not every campaign became a row' );

	foreach ( array( 0, 1, 2 ) as $page ) {
		for ( $i = 0; $i < 4; $i++ ) {
			$at = $page * 4 + $i;
			ok( false !== strpos( $rows[ $at ], 'money page ' . $page ),
				"row $at belongs to another page — the grouping was lost" );
		}
	}
} );

test( 'TWO PAGES THAT SHARE A TITLE ARE STILL TWO PAGES', function () {
	/* Grouped by URL, not by name. An agency running the same service on two
	 * sites has two "Emergency Plumber" pages, and running their campaigns
	 * together says a thing that is not true about either — and, now that the
	 * rows are numbered straight through, numbers them as one run.
	 *
	 * ASSERTED ON THE ORDER, because with the headings gone there is nothing
	 * else left to count. Grouping by URL gives campaigns 0, 2 then 1, 3;
	 * grouping by title merges all four and leaves them 0, 1, 2, 3. The
	 * fixture's pages share a title but not a url, so the two orders differ —
	 * which is exactly what the old fixture could not do. */
	$GLOBALS['ie_campaigns'] = many_running( 4, 2 );

	foreach ( $GLOBALS['ie_campaigns'] as $i => $c ) {
		$GLOBALS['ie_campaigns'][ $i ]['target_page']['title'] = 'Emergency Plumber';
	}

	$rows = row_order( render( 'running' ) );

	same( array(
		'campaign 0 emergency plumber',
		'campaign 2 emergency plumber',
		'campaign 1 emergency plumber',
		'campaign 3 emergency plumber',
	), $rows, 'two different pages with the same name were merged' );
} );

test( 'EVERY ROW IS NUMBERED, 1 THROUGH N', function () {
	/* A number somebody can say out loud. It only works while it is stable,
	 * which is why it counts across groups instead of restarting, and why
	 * there is no pagination behind it. */
	$GLOBALS['ie_campaigns'] = many_running( 12, 3 );

	$html = render( 'running' );

	preg_match_all( '/<span class="ie-row-num">(\d+)\.<\/span>/', $html, $m );

	same( range( 1, 12 ), array_map( 'intval', $m[1] ),
		'the rows are not numbered 1..12 in order' );
} );

test( 'the page is named on the row only when it is not the row', function () {
	/* The whole reason the headings went. Saying "feeds Toilet Replacement
	 * Services" on a row called "Toilet Replacement Services" is the same
	 * duplication in a smaller font. */
	$same = many_running( 6, 2 );
	foreach ( $same as $i => $c ) {
		$same[ $i ]['label'] = $c['target_page']['title'];
	}

	$GLOBALS['ie_campaigns'] = $same;
	hasnt( render( 'running' ), 'feeds Money Page',
		'the page is repeated on a row that already carries its name' );

	// ...and it IS said when it differs, or the page becomes unfindable.
	$GLOBALS['ie_campaigns'] = many_running( 6, 2 );
	has( render( 'running' ), 'feeds Money Page 0',
		'a campaign named differently from its page does not say which page' );
} );

test( 'a filter box appears once there are enough to need one', function () {
	$GLOBALS['ie_campaigns'] = many_running( 12, 3 );

	$html = render( 'running' );

	has( $html, 'id="ie-campaign-filter"', 'there is no way to search a long list' );
	has( $html, 'Filter 12 campaigns', 'the filter box does not say what it filters' );
} );

test( 'EVERY ROW CARRIES WHAT THE FILTER SEARCHES', function () {
	// The box matches on this attribute. Without it a row can never be found,
	// and typing its exact name would hide it.
	$GLOBALS['ie_campaigns'] = many_running( 6, 2 );

	$html = render( 'running' );

	has( $html, 'data-ie-search="campaign 0 money page 0"',
		'a row cannot be matched by its own name or page' );
} );

test( 'THE HEADLINE IS NOT PRINTED TWICE', function () {
	/* The fold summary and the card both describe the campaign, from the same
	 * function. Printing both puts the same sentence on screen twice, half a
	 * centimetre apart. */
	$GLOBALS['ie_campaigns'] = many_running( 6, 2 );

	$html = render( 'running' );

	same( 6, substr_count( $html, 'scheduled, 1 live' ),
		'the summary and the card are both printing the headline' );
} );

test( 'a folded campaign still carries its buttons', function () {
	// Folding must hide the card, not amputate it.
	$GLOBALS['ie_campaigns'] = many_running( 6, 2 );

	$html = render( 'running' );

	has( $html, 'action=ie_delete_campaign', 'a folded campaign lost its actions' );
	has( $html, 'Show all', 'a folded campaign lost its post list' );
} );

test( 'THE REPAIR LINKS BUTTON IS ON THE SCREEN', function () {
	/* It lives at the foot of the screen rather than on a campaign card,
	 * because the campaigns it helps most no longer have cards — they were
	 * removed, which is what broke their links in the first place. */
	$c = campaign( 'c-1', 'slab leak detection', array( slot( 0, 'scheduled', 2 ) ), true );
	$GLOBALS['ie_campaigns'] = array( $c );

	$html = render( 'running' );

	has( $html, 'Repair internal links', 'the repair button is missing' );
	has( $html, 'action=ie_repair_links', 'the repair button goes nowhere' );
	has( $html, 'Safe to run more than once', 'nothing says it is safe to press twice' );
} );

test( 'the repair button is not offered on an empty screen', function () {
	// Nothing to repair, and a button that cannot do anything is noise on the
	// one screen where a new customer most needs the path to be obvious.
	$GLOBALS['ie_campaigns'] = array();

	hasnt( render( 'running' ), 'action=ie_repair_links', 'a useless button was offered' );
} );

test( 'REMOVE NAMES WHAT IT IS ABOUT TO DESTROY', function () {
	/* The old dialog said "Posts already written stay exactly where they
	 * are" — which was true, and was the problem: a campaign removed halfway
	 * went on publishing on schedule. Remove now removes, so the dialog has
	 * to say so in numbers the reader can check against their own site. */
	$c = campaign( 'c-doomed', 'slab leak detection',
		array( slot( 0, 'published', -3 ), slot( 1, 'scheduled', 4 ) ), true );

	$GLOBALS['ie_campaigns']   = array( $c );
	$GLOBALS['ie_post_counts'] = array( 'c-doomed' => array( 'published' => 4, 'drafts' => 8 ) );

	$html = render( 'running' );

	has( $html, '4 published articles and 8 drafts', 'the dialog does not name the damage' );
	has( $html, 'restore them from Trash for 30 days', 'the dialog does not say it is undoable' );
	hasnt( $html, 'stay exactly where they are',
		'the dialog still promises the posts survive, which is no longer true' );

	$GLOBALS['ie_post_counts'] = array();
} );

test( 'THERE ARE TWO DIALOGS, NOT ONE', function () {
	/* A checkbox left unticked is a destructive action that quietly did not
	 * happen, and the user walks away believing the articles are gone. Two
	 * dialogs naming the same counts make the second a real second look. */
	// Two slots, one still outstanding — bucket() sends a fully published
	// campaign to the Done tab, and this card has to be on the running one.
	$c = campaign( 'c-doomed', 'slab leak detection',
		array( slot( 0, 'published', -3 ), slot( 1, 'scheduled', 4 ) ), true );

	$GLOBALS['ie_campaigns']   = array( $c );
	$GLOBALS['ie_post_counts'] = array( 'c-doomed' => array( 'published' => 4, 'drafts' => 8 ) );

	$html = render( 'running' );

	has( $html, 'Are you sure you want to send 4 published articles and 8 drafts to Trash?',
		'the second confirmation is missing' );
	hasnt( $html, 'type="checkbox"', 'the destructive step was put behind a checkbox' );

	$GLOBALS['ie_post_counts'] = array();
} );

test( 'the singular reads properly', function () {
	// "1 published articles and 1 drafts" is the kind of thing that makes a
	// serious dialog look careless at exactly the wrong moment.
	// Two slots, one still outstanding — bucket() sends a fully published
	// campaign to the Done tab, and this card has to be on the running one.
	$c = campaign( 'c-doomed', 'slab leak detection',
		array( slot( 0, 'published', -3 ), slot( 1, 'scheduled', 4 ) ), true );

	$GLOBALS['ie_campaigns']   = array( $c );
	$GLOBALS['ie_post_counts'] = array( 'c-doomed' => array( 'published' => 1, 'drafts' => 1 ) );

	$html = render( 'running' );

	has( $html, '1 published article and 1 draft', 'the plurals are not guarded' );
	hasnt( $html, '1 published articles', 'the plurals are not guarded' );

	$GLOBALS['ie_post_counts'] = array();
} );

test( 'THE SAFE BUTTON APPEARS ON A PAUSED CAMPAIGN', function () {
	/* The reason Remove no longer has to be two things at once: stopping a
	 * campaign and binning what has not published is the common case, and it
	 * belongs on the card that owns those posts. */
	$c = campaign( 'c-held', 'slab leak detection',
		array( slot( 0, 'published', -3 ), slot( 1, 'scheduled', 4 ) ), true );
	$c['status'] = 'paused';

	$GLOBALS['ie_campaigns']   = array( $c );
	$GLOBALS['ie_post_counts'] = array( 'c-held' => array( 'published' => 4, 'drafts' => 8 ) );

	$html = render( 'running' );

	has( $html, 'Delete the 8 remaining drafts', 'the safe button is missing' );
	has( $html, 'The published articles stay on your site.',
		'the safe button does not say what it protects' );

	$GLOBALS['ie_post_counts'] = array();
} );

test( 'the safe button is not offered when there is nothing left to delete', function () {
	$c = campaign( 'c-held', 'slab leak detection',
		array( slot( 0, 'published', -3 ), slot( 1, 'scheduled', 4 ) ), true );
	$c['status'] = 'paused';

	$GLOBALS['ie_campaigns']   = array( $c );
	$GLOBALS['ie_post_counts'] = array( 'c-held' => array( 'published' => 4, 'drafts' => 0 ) );

	$html = render( 'running' );

	hasnt( $html, 'remaining draft', 'a button that would do nothing was offered' );

	$GLOBALS['ie_post_counts'] = array();
} );

test( 'the second tab asks for approval rather than announcing a debt', function () {
	/* "Waiting for you" said something was owed without saying what, and the
	 * thing worth knowing before clicking is that approving is the moment
	 * credits are spent. */
	$html = render( 'running' );

	has( $html, 'Campaigns needing approval' );
	hasnt( $html, 'Waiting for you', 'the old tab name is back' );
} );

/* ---------------------------------------------------------------------
 * The Completed tab — a finished campaign is not a running one
 *
 * Six completed campaigns on screen, every one of them offering "Pause
 * campaign" and every heading saying "publishing on schedule".
 *
 * The wording was only wrong. The button was worse: it set the status to
 * paused, held nothing back because there was nothing to hold, announced
 * "0 scheduled posts were held as drafts", and the next sweep reported
 * paused to Three Comets — which takes a site's word on paused. A campaign
 * that had finished weeks earlier was then recorded as paused in the blog
 * report, with nothing on the site to say it had happened.
 *
 * The cause: bucket() knew the campaign had finished and the card did not.
 * IE_Campaigns::is_finished() is now the one place that decides, and both
 * read it.
 * ------------------------------------------------------------------ */

echo "\nA finished campaign is not a running one\n";

function finished_campaign( $id = 'c-fin', $label = 'toilet replacement services' ) {
	$c = campaign( $id, $label,
		array( slot( 0, 'published', -9 ), slot( 1, 'published', -6 ),
		       slot( 2, 'published', -3 ), slot( 3, 'published', -1 ) ), true );
	$c['status'] = 'completed';
	return $c;
}

test( 'A FINISHED CAMPAIGN IS NOT OFFERED PAUSE', function () {
	$GLOBALS['ie_campaigns'] = array( finished_campaign() );

	$html = render( 'done' );

	has( $html, 'toilet replacement services', 'the fixture is not on the completed tab at all' );
	hasnt( $html, 'action=ie_pause_campaign',
		'a campaign with nothing left to publish was offered Pause' );
} );

test( 'it says why the button is not there', function () {
	// A row of buttons with a gap in it reads as a screen that failed to load.
	$GLOBALS['ie_campaigns'] = array( finished_campaign() );

	$html = render( 'done' );

	has( $html, 'There is nothing left to schedule',
		'the missing button is not explained' );
} );

test( 'A FINISHED CAMPAIGN STOPS SAYING IT IS PUBLISHING ON SCHEDULE', function () {
	/* Present tense on six campaigns that had all finished. The heading is the
	 * line somebody reads before deciding whether anything is wrong. */
	$GLOBALS['ie_campaigns'] = array( finished_campaign() );

	$html = render( 'done' );

	hasnt( $html, 'publishing on schedule',
		'a finished campaign still claims to be publishing' );
	has( $html, '4 of 4 scheduled, 4 live, finished',
		'the heading does not say the campaign finished' );
} );

test( 'a cancelled campaign says so rather than claiming to have run its course', function () {
	$c = finished_campaign( 'c-can', 'water softener installation' );
	$c['slots'][2]['status'] = 'scheduled';
	$c['slots'][3]['status'] = 'scheduled';
	$c['status'] = 'cancelled';

	$GLOBALS['ie_campaigns'] = array( $c );

	$html = render( 'done' );

	has( $html, 'cancelled', 'a cancelled campaign is described as if it ran to the end' );
	hasnt( $html, 'action=ie_pause_campaign', 'a cancelled campaign was offered Pause' );
	hasnt( $html, 'action=ie_resume_campaign', 'a cancelled campaign was offered Resume' );
} );

test( 'a PAUSED campaign whose posts all published is not offered Resume', function () {
	/* Resume would release nothing and set the status back to active, which
	 * the sweep reports and the server then has to settle all over again. */
	$c = finished_campaign( 'c-pf', 'unclogging sewer line services' );
	$c['status'] = 'paused';

	$GLOBALS['ie_campaigns'] = array( $c );

	$html = render( 'done' );

	hasnt( $html, 'action=ie_resume_campaign',
		'a campaign with nothing held back was offered Resume' );
	has( $html, 'closed out', 'the closed-out campaign is not described' );
} );

test( 'A CAMPAIGN THAT IS STILL RUNNING KEEPS ITS PAUSE BUTTON', function () {
	/* The guard must not be so keen it disarms the tab it was not about. */
	$c = campaign( 'c-live', 'commercial plumbing services',
		array( slot( 0, 'published', -3 ), slot( 1, 'scheduled', 4 ) ), true );
	$c['status'] = 'active';

	$GLOBALS['ie_campaigns'] = array( $c );

	$html = render( 'running' );

	has( $html, 'action=ie_pause_campaign', 'a running campaign lost its Pause button' );
	has( $html, 'publishing on schedule', 'a running campaign stopped saying what it is doing' );
} );

test( 'THE TAB AND THE CARD CANNOT PART COMPANY AGAIN', function () {
	/* The bug in one sentence: bucket() knew and the card did not. Assert the
	 * rule directly, then assert the tab obeys the same rule — so a future
	 * change that moves one has to move the other. */
	$mixed = array(
		finished_campaign( 'c-a', 'alpha' ),
		campaign( 'c-b', 'beta', array( slot( 0, 'published', -3 ), slot( 1, 'scheduled', 4 ) ), true ),
		campaign( 'c-c', 'gamma', array( slot( 0, 'pending', 1 ) ), false ),
	);
	$mixed[1]['status'] = 'active';

	same( true,  IE_Campaigns::is_finished( $mixed[0] ), 'a fully published campaign is not finished' );
	same( false, IE_Campaigns::is_finished( $mixed[1] ), 'a campaign with a scheduled post is finished' );
	same( false, IE_Campaigns::is_finished( $mixed[2] ), 'an unapproved campaign counts as finished' );

	$GLOBALS['ie_campaigns'] = $mixed;

	$done = render( 'done' );
	same( 1, cards( $done ), 'the completed tab is not showing exactly the finished one' );
	has( $done, 'alpha' );
	hasnt( $done, 'beta', 'a running campaign reached the completed tab' );
} );

test( 'REMOVE STILL WORKS ON A FINISHED CAMPAIGN', function () {
	/* Everything else was taken away from this card. Remove is the one action
	 * that still means something once a campaign is over, and a guard that
	 * took it too would leave no way to clear the record at all. */
	$GLOBALS['ie_campaigns']   = array( finished_campaign( 'c-rm', 'removable' ) );
	$GLOBALS['ie_post_counts'] = array( 'c-rm' => array( 'published' => 4, 'drafts' => 0 ) );

	$html = render( 'done' );

	has( $html, 'action=ie_delete_campaign', 'a finished campaign cannot be removed' );
	same( 2, substr_count( $html, 'confirm(' ), 'the two dialogs did not survive' );

	$GLOBALS['ie_post_counts'] = array();
} );

/* ===================================================================== */

echo "\nThe new-campaign form\n";

test( 'THE TWO FIELD LABELS SAY WHICH PAGE THEY MEAN', function () {
	/* NOTHING HAD EVER RENDERED THIS FORM IN A TEST, which is how it kept
	 * "Page to rank" and "Its search term" — names that read fine to whoever
	 * wrote them and left the customer guessing. Edwin had to ask what the
	 * second one referred to, after weeks of using it.
	 *
	 * "Its" was the worse of the two: a pronoun pointing at a dropdown that
	 * can scroll off the screen names nothing at all. Pinned here so the next
	 * edit that reaches for a pronoun fails first. */
	$GLOBALS['ie_campaigns'] = array();

	$html = render( 'new' );

	has( $html, '>Target Page<', 'the page field lost its label' );
	has( $html, '>Main Keyword of Target Page<', 'the keyword field lost its label' );

	hasnt( $html, 'Page to rank', 'the old label is back' );
	hasnt( $html, 'Its search term', 'the pronoun label is back' );
} );

test( 'the keyword box still fills itself from the chosen page', function () {
	/* The labels changed; the machinery must not have. `data-keyword` on each
	 * option is what lets the box fill in without a round trip, and it carries
	 * the CLEANED term — no town, no state, lower case — because anchorPool.js
	 * adds the town back and the anchor lands mid-sentence. A label edit that
	 * disturbed this attribute would stay invisible until a customer got
	 * "quality plumbing Leander in Leander" as live anchor text. */
	$GLOBALS['ie_campaigns'] = array();

	$html = render( 'new' );

	has( $html, 'data-keyword="quality plumbing"',
		'the cleaned search term no longer travels with the option' );
	has( $html, 'id="ie_keyword"', 'the keyword box is gone' );
	has( $html, 'id="ie_target"', 'the page dropdown is gone' );
} );

/* ---------------------------------------------------------------------
 * The pillar checkbox, and the ordering bug nothing else could see
 * ------------------------------------------------------------------ */

test( 'the pillar checkbox is on the form', function () {
	$GLOBALS['ie_campaigns'] = array();
	$html = render( 'new' );

	has( $html, 'id="ie_is_pillar"', 'the pillar checkbox is gone' );
	has( $html, 'name="is_pillar"', 'the checkbox would post nothing' );
	has( $html, 'they link to each other', 'the one-line explanation is gone' );
} );

test( 'EVERYTHING THAT ASSUMES A TARGET PAGE CARRIES THE CLASS', function () {
	/* Three rows and the Suggest button. The class is the only thing tying
	 * them together, and a row that loses it stays on screen asking a question
	 * a pillar campaign cannot answer. */
	$GLOBALS['ie_campaigns'] = array();
	$html = render( 'new' );

	has( $html, 'value="ie_suggest"', 'the Suggest button is gone entirely' );

	/* NAMED, NOT COUNTED. The first version asserted `substr_count >= 5`, and
	 * stripping the class off the Suggest button left exactly 5 — because the
	 * script's own selector is one of the matches. A threshold over a count
	 * that includes the code doing the looking is not a test, it is a
	 * coincidence with a number on it.
	 *
	 * So each thing is checked where it is: the button must sit inside an open
	 * wrapper with no </span> between. */
	$btn = strpos( $html, 'value="ie_suggest"' );
	$open = strrpos( substr( $html, 0, $btn ), '<span class="ie-needs-target">' );

	if ( false === $open ) {
		throw new Exception( 'the Suggest button is not inside an ie-needs-target wrapper' );
	}

	if ( false !== strpos( substr( $html, $open, $btn - $open ), '</span>' ) ) {
		throw new Exception( 'the wrapper closes before the Suggest button — it is not inside it' );
	}

	foreach ( array( 'ie_target', 'ie_keyword', 'ie_intent_choice' ) as $field ) {
		$at  = strpos( $html, 'id="' . $field . '"' );
		$row = strrpos( substr( $html, 0, $at ), '<tr' );

		if ( false === strpos( substr( $html, $row, 60 ), 'ie-needs-target' ) ) {
			throw new Exception( "the row holding $field lost the class — it will stay on screen" );
		}
	}
} );

test( 'THE SCRIPT DOES NOT QUERY MARKUP THAT HAS NOT BEEN PARSED YET', function () {
	/* THE BUG THIS TEST EXISTS FOR, found by Edwin on the real screen and by
	 * nothing here.
	 *
	 * The toggle script sits between the first table and everything below it.
	 * An inline script runs AS THE PARSER REACHES IT, so its querySelectorAll
	 * ran against a half-built document: it found the three <tr> rows above
	 * and missed the Suggest button below. The rows hid, the checkbox looked
	 * wired up, the button sat there as though its class had been forgotten,
	 * and nothing errored — so the console said nothing either.
	 *
	 * ONLY THE HALF OF THE PAGE THAT HAD BEEN PARSED EXISTED, and it was the
	 * half that made the feature look like it worked.
	 *
	 * The invariant: either the script runs after the whole document, or every
	 * element it queries is above it. The first is what the fix does; the
	 * second is what someone might do instead by moving the script. Either is
	 * correct, and this accepts both rather than pinning the implementation.
	 */
	$GLOBALS['ie_campaigns'] = array();
	$html = render( 'new' );

	/* COMMENTS STRIPPED FIRST, AND THAT IS THE WHOLE POINT.
	 *
	 * The first version of this asked whether the page contained the words
	 * 'DOMContentLoaded' and 'readyState'. Deleting the fix left both — in the
	 * COMMENT explaining the fix — so the test passed against the bug it was
	 * written for. Mutation testing found it; nothing else would have.
	 *
	 * Third time in this project that a check has read prose as code. A TEST
	 * THAT SEARCHES THE SOURCE MUST SEARCH THE CODE, and the code is what is
	 * left once the explanations are gone. */
	$code = preg_replace( '#/\*.*?\*/#s', '', $html );
	$code = preg_replace( '#^\s*//.*$#m', '', $code );

	$script = strpos( $code, "querySelectorAll('#ie-campaign-form .ie-needs-target')" );

	if ( false === $script ) {
		throw new Exception( 'the toggle script is gone — the checkbox now does nothing' );
	}

	/* The last element CARRYING the class, not the last mention of it: the
	 * script's own selector is a mention, and comparing against it would make
	 * the script forever "after itself". */
	$last = strrpos( $code, 'class="description ie-needs-target"' );
	$last = max( (int) $last, (int) strrpos( $code, '<span class="ie-needs-target">' ) );

	/* The CALL, not the word. A listener that is registered is the only thing
	 * that makes the ordering safe. */
	$defers = false !== strpos( $code, "addEventListener('DOMContentLoaded'" );

	if ( ! $defers && $last > $script ) {
		throw new Exception(
			'the script queries .ie-needs-target before the last one is parsed, '
			. 'and nothing registers a DOMContentLoaded listener — '
			. 'elements below the script will not be found'
		);
	}
} );

test( 'the pillar-only line is hidden in the markup, not shown by default', function () {
	/* With the script blocked the form must still describe the campaign most
	 * people are making. So the pre-JavaScript state is "ordinary campaign":
	 * every .ie-needs-target visible, every .ie-pillar-only hidden. */
	$GLOBALS['ie_campaigns'] = array();
	$html = render( 'new' );

	/* THE ELEMENT, NOT THE SELECTOR. The first `ie-pillar-only` in this page
	 * is inside the toggle script, where it is a querySelectorAll argument —
	 * so the obvious strpos() found the script and reported the markup
	 * visible. A test that matches the code looking for a thing, rather than
	 * the thing, fails for its own reasons. */
	has( $html, 'class="description ie-pillar-only"', 'the pillar-only hint is gone' );

	$at = strpos( $html, 'class="description ie-pillar-only"' );
	$fragment = substr( $html, $at, 120 );

	if ( false === strpos( $fragment, 'display:none' ) ) {
		throw new Exception( 'the pillar-only hint renders visible for an ordinary campaign' );
	}
} );

test( 'the target page dropdown is no longer `required`', function () {
	/* `required` on a control the browser cannot see is not validation, it is
	 * a dead end: Chrome refuses to submit and reports "An invalid form
	 * control ... is not focusable" to the console, where no site owner will
	 * read it. The rule moved to read_form(), which has to check it anyway. */
	$GLOBALS['ie_campaigns'] = array();
	$html = render( 'new' );

	$at = strpos( $html, 'id="ie_target"' );
	$tag = substr( $html, strrpos( substr( $html, 0, $at ), '<select' ), 200 );

	if ( false !== strpos( $tag, 'required' ) ) {
		throw new Exception( 'the select is still required — ticking the box would break the form silently' );
	}
} );

/* ---------------------------------------------------------------------
 * Publish all — pillar campaigns only
 * ------------------------------------------------------------------ */

/**
 * Set which posts still exist, and FORGET WHAT WAS ASKED BEFORE.
 *
 * IE_Campaigns::post_missing() caches the live ids in a static. That is right
 * in WordPress — one request, one page load, and a cache that stays warm
 * through a loop publishing posts is exactly what you want — and wrong across
 * tests, which share a process. The first of these tests reported one post
 * skipped against a fixture where every post existed, because an earlier test
 * in this file had already filled the cache with a smaller set.
 *
 * forget_post_cache() was written for this and the tests simply were not
 * calling it. A SHARED PROCESS IS NOT A SHARED REQUEST, and anything the
 * product caches per request has to be cleared per test.
 */
function ie_posts_exist( $ids ) {
	$GLOBALS['ie_existing_posts'] = $ids;
	IE_Campaigns::forget_post_cache();
}

/** A pillar campaign: same shape, no target page, the flag set. */
function pillar_campaign( $id, $slots ) {
	$c = campaign( $id, 'Pillars: Puppy Training', $slots, true );
	$c['is_pillar']   = true;
	$c['target_page'] = array();
	return $c;
}

test( 'THE BUTTON IS OFFERED ON A PILLAR CAMPAIGN', function () {
	/* A pillar is useless until it is live: target_pages() lists only
	 * `publish` posts, because a future-dated one answers 404 and a silo
	 * aimed at it would point at nothing. */
	ie_posts_exist( null );
	$GLOBALS['ie_campaigns'] = array(
		pillar_campaign( 'p1', array( slot( 0, 'scheduled' ), slot( 1, 'scheduled' ), slot( 2, 'scheduled' ) ) ),
	);

	$html = render();

	has( $html, 'action=ie_publish_all', 'the Publish all link is missing' );
	has( $html, 'Publish all 3 pillars now', 'the count is not in the label' );
} );

test( 'AND NOT ON A SILO CAMPAIGN — the schedule is the product there', function () {
	/* Twelve posts over three months is what the customer planned and paid
	 * for, and dating them all today cannot be undone. A post does not go
	 * back onto a schedule. */
	ie_posts_exist( null );
	$GLOBALS['ie_campaigns'] = array(
		campaign( 'c1', 'Water heater repair', array( slot( 0, 'scheduled' ), slot( 1, 'scheduled' ) ), true ),
	);

	$html = render();

	hasnt( $html, 'action=ie_publish_all', 'a silo campaign was offered Publish all' );
	has( $html, 'action=ie_publish_now', 'the per-row Publish early link went missing' );
} );

test( 'not offered when there is nothing waiting', function () {
	/* A control that says "publish all" and then reports that there was
	 * nothing to publish is a control that should not have been drawn. The
	 * count is computed before it is offered, so the answer is on screen
	 * before the click. */
	ie_posts_exist( null );
	$GLOBALS['ie_campaigns'] = array(
		pillar_campaign( 'p1', array( slot( 0, 'published' ), slot( 1, 'published' ) ) ),
	);

	hasnt( render(), 'action=ie_publish_all', 'offered on a campaign with everything already live' );
} );

test( 'the label is singular for one pillar', function () {
	ie_posts_exist( null );
	$GLOBALS['ie_campaigns'] = array(
		pillar_campaign( 'p1', array( slot( 0, 'published' ), slot( 1, 'scheduled' ) ) ),
	);

	$html = render();
	has( $html, 'Publish the 1 pillar now', 'the singular label is wrong' );
	hasnt( $html, 'Publish all 1 pillars now', 'it said "all 1 pillars"' );
} );

test( 'PUBLISH ALL PUBLISHES EVERY SCHEDULED SLOT', function () {
	/* The first handler this project has ever invoked from a test. It was
	 * impossible until now because IE_Admin::redirect() ends in `exit`, which
	 * would have ended the whole run at the first redirect and reported
	 * everything before it as the result. */
	ie_posts_exist( null );
	$GLOBALS['ie_campaigns'] = array(
		pillar_campaign( 'p1', array(
			slot( 0, 'scheduled' ), slot( 1, 'scheduled' ), slot( 2, 'scheduled' ), slot( 3, 'published' ),
		) ),
	);

	$_GET = array( 'campaign' => 'p1' );
	$out = ie_run_handler( array( 'IE_Admin', 'handle_publish_all' ) );

	same( 'published', $out['ie_status'], 'the outcome was not a success' );
	has( $out['ie_message'], '3 posts published',
		'the count is wrong — got: ' . $out['ie_message'] );
} );

test( 'A SILO CAMPAIGN IS REFUSED BY THE HANDLER, not only by the hidden link', function () {
	/* This URL is reachable by hand and from a stale browser tab, and what it
	 * does cannot be undone. A rule enforced only in the markup is not a rule. */
	ie_posts_exist( null );
	$GLOBALS['ie_campaigns'] = array(
		campaign( 'c1', 'Water heater repair', array( slot( 0, 'scheduled' ), slot( 1, 'scheduled' ) ), true ),
	);

	$_GET = array( 'campaign' => 'c1' );
	$out = ie_run_handler( array( 'IE_Admin', 'handle_publish_all' ) );

	same( 'error', $out['ie_status'], 'a silo campaign was published wholesale' );
	has( $out['ie_message'], 'only offered for pillar campaigns', 'the refusal does not say why' );
} );

test( 'A DELETED POST IS SKIPPED AND SAID OUT LOUD, not counted as published', function () {
	/* The slot keeps its post_id after the post is gone, and wp_update_post()
	 * answers 0 for a missing id rather than a WP_Error — so without the
	 * post_missing() check the owner is told three posts went live when one
	 * of them does not exist. A number that quietly includes ghosts is worse
	 * than a smaller number that is true. */
	$GLOBALS['ie_campaigns'] = array(
		pillar_campaign( 'p1', array( slot( 0, 'scheduled' ), slot( 1, 'scheduled' ), slot( 2, 'scheduled' ) ) ),
	);

	// Slot 1's post (id 101) has been deleted; the others survive.
	ie_posts_exist( array( 100, 102 ) );

	$_GET = array( 'campaign' => 'p1' );
	$out = ie_run_handler( array( 'IE_Admin', 'handle_publish_all' ) );

	has( $out['ie_message'], '2 posts published', 'got: ' . $out['ie_message'] );
	has( $out['ie_message'], 'skipped', 'the skip was not reported' );

	ie_posts_exist( null );
} );

test( 'nothing waiting is an error, not a silent success', function () {
	ie_posts_exist( null );
	$GLOBALS['ie_campaigns'] = array(
		pillar_campaign( 'p1', array( slot( 0, 'published' ), slot( 1, 'published' ) ) ),
	);

	$_GET = array( 'campaign' => 'p1' );
	$out = ie_run_handler( array( 'IE_Admin', 'handle_publish_all' ) );

	same( 'error', $out['ie_status'] );
	has( $out['ie_message'], 'already live', 'the message does not explain why nothing happened' );
} );

test( 'an unknown campaign is refused rather than treated as empty', function () {
	ie_posts_exist( null );
	$GLOBALS['ie_campaigns'] = array();

	$_GET = array( 'campaign' => 'nope' );
	$out = ie_run_handler( array( 'IE_Admin', 'handle_publish_all' ) );

	same( 'error', $out['ie_status'] );
	has( $out['ie_message'], 'could not be found', 'a missing campaign gave the wrong message' );
} );

test( 'THE HEADLINE COUNTS A DELETED POST AS DELETED, NOT AS LIVE', function () {
	/* FOUND BY ACCIDENT, in code that predates today.
	 *
	 * A mutation meant for handle_publish_all landed here instead — the anchor
	 * matched an earlier occurrence and str.replace takes the first — and the
	 * whole suite still passed with campaign_headline()'s post_missing() check
	 * short-circuited. So a campaign with three deleted posts would have read
	 * "3 of 3 scheduled, 3 live, publishing on schedule", and nothing said
	 * otherwise.
	 *
	 * That is the failure this project already decided it cares most about:
	 * the headline is the line people read first, and a report the customer
	 * cannot trust is the document they would quote back when disputing a
	 * bill. The deleted-post tests above check the ROW and the per-row link;
	 * none of them checked the summary.
	 *
	 * An accidental mutation is still a result. */
	$GLOBALS['ie_campaigns'] = array(
		campaign( 'c1', 'Water heater repair', array(
			slot( 0, 'published' ), slot( 1, 'published' ), slot( 2, 'scheduled' ),
		), true ),
	);

	// Slot 1's post (id 101) is gone.
	ie_posts_exist( array( 100, 102 ) );

	$html = render();

	has( $html, '1 post deleted', 'the headline does not mention the deleted post' );
	hasnt( $html, '2 live', 'the deleted post is still being counted as live' );

	ie_posts_exist( null );
} );

test( 'THE HOME-PAGE CHECKBOX IS ON THE FORM, HIDDEN UNTIL PILLAR IS TICKED', function () {
	/* Nested under the pillar box and meaningless without it: a silo
	 * campaign's first post is one of twelve on a schedule, and making it the
	 * home page is not something anyone would want.
	 *
	 * It carries .ie-pillar-only so the same script governs it — a second
	 * show/hide mechanism is a second thing to forget. */
	$GLOBALS['ie_campaigns'] = array();
	$html = render( 'new' );

	has( $html, 'name="home_page"', 'the checkbox would post nothing' );
	has( $html, 'id="ie_home_page"', 'the home-page checkbox is gone' );

	$at = strpos( $html, 'id="ie_home_page"' );
	$row = strrpos( substr( $html, 0, $at ), '<p ' );

	if ( false === strpos( substr( $html, $row, 80 ), 'ie-pillar-only' ) ) {
		throw new Exception( 'the checkbox is not marked pillar-only — it shows on silo campaigns' );
	}

	if ( false === strpos( substr( $html, $row, 80 ), 'display:none' ) ) {
		throw new Exception( 'the checkbox renders visible before the pillar box is ticked' );
	}
} );

/* =====================================================================
 * A target page chosen by pasting its URL
 *
 * target_pages() offers every published PAGE plus every post stamped
 * `_ie_is_pillar`, and only this plugin stamps that. An owner whose hub is a
 * post they wrote by hand has nothing to select. Edwin asked for a box, 4
 * October.
 *
 * RESOLVED TO A POST ID, NOT STORED AS TEXT. What comes out is an ordinary
 * post id, so the title and keyword come from the post and nothing
 * downstream learns there was a second way in — and a typo is refused here
 * rather than discovered weeks later as a silo pointing at a 404.
 * ===================================================================== */

function ie_submit_campaign( $post ) {
	$_POST = array_merge( array(
		'topics' => "Paying off a loan early\nWhat lenders check",
	), $post );

	$out = ie_run_handler( array( 'IE_Admin', 'handle_review_topics' ) );
	$_POST = array();
	return $out;
}

test( 'A PASTED URL IS ACCEPTED WHERE THE DROPDOWN HAS NOTHING', function () {
	$GLOBALS['ie_url_posts'] = array();
	ie_url_post( 42, 'post', 'publish', 'How Lenders Decide' );

	$out = ie_submit_campaign( array( 'target_url' => 'http://site/post-42/' ) );

	same( 'reviewing', isset( $out['ie_status'] ) ? $out['ie_status'] : '',
		'a valid URL was refused: ' . ( isset( $out['ie_message'] ) ? $out['ie_message'] : '' ) );
} );

test( "ANOTHER SITE'S URL IS REFUSED", function () {
	/* The refusal that needs no code of its own. url_to_postid() answers 0
	 * for anything that is not a permalink here, so there is no home-URL
	 * comparison to write and none to get wrong. */
	$GLOBALS['ie_url_posts'] = array();
	ie_url_post( 42 );

	$out = ie_submit_campaign( array( 'target_url' => 'https://someone-else.com/post-42/' ) );

	same( 'error', $out['ie_status'] );
	has( $out['ie_message'], 'does not match a post or page on this site' );
} );

test( 'A MISTYPED SLUG IS REFUSED RATHER THAN WRITTEN INTO EVERY POST', function () {
	/* THE FAILURE THIS FEATURE COULD HAVE SHIPPED. Nothing re-checks a link
	 * once it is written, so a typo accepted here is a whole silo pointing at
	 * a 404, found weeks later. */
	$GLOBALS['ie_url_posts'] = array();
	ie_url_post( 42 );

	$out = ie_submit_campaign( array( 'target_url' => 'http://site/post-999/' ) );

	same( 'error', $out['ie_status'] );
	has( $out['ie_message'], 'does not match a post or page' );
} );

test( 'an unpublished page is refused, with the reason', function () {
	/* The same rule target_pages() follows: a draft or scheduled post has a
	 * URL that 404s to the public. */
	$GLOBALS['ie_url_posts'] = array();
	ie_url_post( 42, 'post', 'draft' );

	$out = ie_submit_campaign( array( 'target_url' => 'http://site/post-42/' ) );

	same( 'error', $out['ie_status'] );
	has( $out['ie_message'], 'not published yet' );
} );

test( 'THE TYPED URL BEATS THE DROPDOWN', function () {
	/* The same rule the keyword and intent boxes already follow: a box
	 * someone typed in is a decision, a select left alone is not. */
	$GLOBALS['ie_url_posts'] = array();
	ie_url_post( 42, 'post', 'publish', 'The one they typed' );
	ie_url_post( 7, 'page', 'publish', 'The one in the list' );

	$out = ie_submit_campaign( array(
		'target_page_id' => '7',
		'target_url'     => 'http://site/post-42/',
	) );

	same( 'reviewing', $out['ie_status'] );

	$draft = get_transient( 'x' );
	same( 42, (int) $draft['form']['target_page_id'], 'the dropdown won over the typed URL' );
	same( 'The one they typed', $draft['form']['title'] );
} );

test( 'an empty box leaves the dropdown in charge', function () {
	$GLOBALS['ie_url_posts'] = array();
	ie_url_post( 7, 'page', 'publish', 'The one in the list' );

	$out = ie_submit_campaign( array( 'target_page_id' => '7', 'target_url' => '  ' ) );

	same( 'reviewing', $out['ie_status'] );
	$draft = get_transient( 'x' );
	same( 7, (int) $draft['form']['target_page_id'] );
} );

test( 'A BAD URL FAILS — IT DOES NOT QUIETLY FALL BACK TO THE DROPDOWN', function () {
	/* FOUND BY MUTATION, AND IT IS THE WORST FAILURE THIS FEATURE COULD HAVE.
	 *
	 * Drop the early return and a mistyped URL stops being an error: the code
	 * falls through, finds whatever the dropdown happened to hold, and plans
	 * a campaign aimed at a page the owner did not choose. No message, no
	 * sign, and nothing re-checks a link after it is written.
	 *
	 * Every earlier test here posted a bad URL with NO dropdown value, so the
	 * fall-through still ended in null and they all passed. The gap only
	 * shows when both are present — which is the ordinary case, because the
	 * dropdown always posts whatever it is showing. */
	$GLOBALS['ie_url_posts'] = array();
	ie_url_post( 7, 'page', 'publish', 'Not what they asked for' );

	$out = ie_submit_campaign( array(
		'target_page_id' => '7',
		'target_url'     => 'http://site/post-999/',
	) );

	same( 'error', $out['ie_status'], 'a mistyped URL silently planned against the dropdown page' );
	has( $out['ie_message'], 'does not match a post or page' );
} );

test( 'a URL that is not a post or a page is refused', function () {
	/* url_to_postid() resolves attachments and custom types too. Published,
	 * so this is the post_type check and not the status check answering. */
	$GLOBALS['ie_url_posts'] = array();
	ie_url_post( 55, 'product', 'publish', 'A WooCommerce product' );

	$out = ie_submit_campaign( array( 'target_url' => 'http://site/post-55/' ) );

	same( 'error', $out['ie_status'] );
	has( $out['ie_message'], 'not a post or a page' );
} );

test( 'THE REJECTED URL COMES BACK SO IT CAN BE CORRECTED', function () {
	/* Without this the box is empty on the page telling the owner their URL
	 * was wrong — they are asked to fix something they can no longer see. The
	 * draft transient cannot help: it is only written once the form has been
	 * accepted, which is exactly what did not happen. */
	$GLOBALS['ie_url_posts'] = array();

	$out = ie_submit_campaign( array( 'target_url' => 'http://site/post-999/' ) );

	same( 'http://site/post-999/', isset( $out['target_url'] ) ? $out['target_url'] : '',
		'the typed URL was not carried back to the form' );
} );

test( 'THE RESOLVED URL IS KEPT SO THE SECOND STEP STILL HAS IT', function () {
	/* A URL-chosen page is BY DEFINITION not in the dropdown. Review topics
	 * stores the form and re-renders it; without this key nothing would be
	 * selected and the box would be empty, and the next submit would fall
	 * through to the dropdown and refuse a campaign already set up correctly.
	 * The feature would have broken on its second step, not its first. */
	$GLOBALS['ie_url_posts'] = array();
	ie_url_post( 42 );

	ie_submit_campaign( array( 'target_url' => 'http://site/post-42/' ) );

	$draft = get_transient( 'x' );
	same( 'http://site/post-42/', isset( $draft['form']['target_url'] ) ? $draft['form']['target_url'] : '',
		'the typed URL was dropped from the stored form' );
} );

test( 'THE BOX IS ON THE FORM, AND ONLY FOR SILO CAMPAIGNS', function () {
	$GLOBALS['ie_campaigns'] = array();
	$html = render( 'new' );

	has( $html, 'name="target_url"', 'the URL box is missing from the form' );

	/* Inside the Target Page row, which carries ie-needs-target and is hidden
	 * when the pillar box is ticked. A pillar campaign has nothing to aim at,
	 * and a visible box inviting one is an invitation to break it. */
	$row = substr( $html, strpos( $html, 'ie-needs-target' ) );
	ok( strpos( $row, 'name="target_url"' ) !== false && strpos( $row, 'name="target_url"' ) < strpos( $row, '</table>' ),
		'the URL box is outside the target-page row' );
} );

echo "\n$passed passed, $failed failed\n";
exit( $failed ? 1 : 0 );
