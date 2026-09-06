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
define( 'IE_VERSION', '0.3.2' );
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
function get_edit_post_link( $id ) { return 'http://site/wp-admin/post.php?post=' . (int) $id . '&action=edit'; }
function get_transient( $k ) { return $GLOBALS['ie_transient']; }
function set_transient( $k, $v, $t = 0 ) { $GLOBALS['ie_transient'] = $v; return true; }
function delete_transient( $k ) { $GLOBALS['ie_transient'] = false; return true; }
function get_current_user_id() { return 1; }
function current_user_can( $c ) { return true; }
function selected( $a, $b, $echo = true ) { $r = ( (string) $a === (string) $b ) ? ' selected' : ''; if ( $echo ) { echo $r; } return $r; }
function checked( $a, $b = true, $echo = true ) { $r = ( $a == $b ) ? ' checked' : ''; if ( $echo ) { echo $r; } return $r; }
function add_action() {}
function add_filter() {}
function wp_safe_redirect( $u ) { $GLOBALS['ie_redirect'] = $u; }
function get_option( $k, $d = null ) { return $d; }
function update_option() { return true; }
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

class IE_Settings {
	public static function is_connected() { return true; }
	public static function credits_per_post() { return 75; }
	public static function get( $k, $d = null ) { return $d; }
	public static function target_pages() {
		return array( 12 => array( 'title' => 'quality plumbing leander', 'url' => 'http://site/quality-plumbing-leander/' ) );
	}
}

class IE_Campaigns {
	public static function all() { return $GLOBALS['ie_campaigns']; }
	public static function orphans( $c ) { return array(); }
	public static function upcoming( $n = 10, $now = null ) { return $GLOBALS['ie_upcoming']; }
	public static function collisions( $now = null ) { return array(); }
}

class IE_Api {}
class IE_Publisher { public static function get_log() { return array(); } }

require __DIR__ . '/interlink-engine/includes/class-ie-admin.php';

/* ---------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------ */

$GLOBALS['ie_upcoming'] = array();

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
	preg_match_all( '/finished campaign \\d+/', $html, $m );
	return count( $m[0] );
}
function has( $hay, $needle, $msg = null ) { ok( false !== strpos( $hay, $needle ), $msg ? $msg : "expected to find: $needle" ); }
function hasnt( $hay, $needle, $msg = null ) { ok( false === strpos( $hay, $needle ), $msg ? $msg : "did NOT expect: $needle" ); }

function render( $tab = null, $paged = null ) {
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
	ok( preg_match( '/Waiting for you\s*<span class="ie-count ie-count-need">1<\/span>/', $html ), 'drafts count/colour wrong' );
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

echo "\nPagination\n";

$many = array();
for ( $i = 0; $i < 23; $i++ ) {
	$many[] = campaign(
		"done-$i",
		"finished campaign $i",
		array( slot( 0, 'published', -30 ) ),
		true,
		date( 'Y-m-d H:i:s', strtotime( '2026-01-01' ) + $i * 86400 )
	);
}

test( 'page one holds ten of twenty-three', function () use ( $many ) {
	$GLOBALS['ie_campaigns'] = $many;
	$html = render( 'done' );
	ok( 10 === cards( $html ), 'expected 10 cards, got ' . cards( $html ) );
	has( $html, '23 campaigns', 'the total is not stated' );
} );

test( 'newest finished is first', function () use ( $many ) {
	$GLOBALS['ie_campaigns'] = $many;
	$html = render( 'done' );
	has( $html, 'finished campaign 22', 'the most recent one is not on page one' );
	hasnt( $html, 'finished campaign 0<', 'the oldest one is on page one' );
} );

test( 'the last page holds the remaining three', function () use ( $many ) {
	$GLOBALS['ie_campaigns'] = $many;
	$html = render( 'done', 3 );
	ok( 3 === cards( $html ), 'expected 3 cards, got ' . cards( $html ) );
} );

test( 'a page number past the end shows the last page, not an empty screen', function () use ( $many ) {
	$GLOBALS['ie_campaigns'] = $many;
	$html = render( 'done', 999 );
	ok( 3 === cards( $html ), 'expected the last page, got ' . cards( $html ) . ' cards' );
} );

test( 'a page number below one is clamped', function () use ( $many ) {
	$GLOBALS['ie_campaigns'] = $many;
	$html = render( 'done', -4 );
	ok( 10 === cards( $html ), 'expected page one, got ' . cards( $html ) . ' cards' );
} );

test( 'the pager links carry the tab, or they would land on In progress', function () use ( $many ) {
	$GLOBALS['ie_campaigns'] = $many;
	$html = render( 'done' );
	ok( preg_match( '/page-numbers" href="[^"]*tab=done[^"]*paged=2/', $html )
	    || preg_match( '/page-numbers" href="[^"]*paged=2[^"]*tab=done/', $html ),
		'a pager link does not name the tab' );
} );

test( 'no pager when everything fits on one page', function () {
	$GLOBALS['ie_campaigns'] = array( campaign( 'c-done', 'only one', array( slot( 0, 'published', -2 ) ), true ) );
	$html = render( 'done' );
	hasnt( $html, 'page-numbers', 'drew a pager for a single page' );
} );

echo "\nEmpty states\n";

test( 'a brand new install is told what a campaign is', function () {
	$GLOBALS['ie_campaigns'] = array();
	$html = render();
	has( $html, 'No campaigns yet' );
	has( $html, 'Plan your first campaign', 'no way forward from the empty state' );
} );

test( 'each empty tab says something true rather than nothing', function () {
	$GLOBALS['ie_campaigns'] = array();
	has( render( 'drafts' ), 'Nothing waiting' );
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

test( 'a planned campaign lands in Waiting for you', function () {
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

echo "\n$passed passed, $failed failed\n";
exit( $failed ? 1 : 0 );
