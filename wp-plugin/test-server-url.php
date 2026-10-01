<?php
/**
 * Where the plugin thinks the server is.
 *
 *   php wp-plugin/test-server-url.php
 *
 * WHY THIS EXISTS. The service was renamed from fastwebsitegenerator.com to
 * threecomets.com. The default in IE_Settings::server_url() was never updated,
 * and on 24 September the old domain was switched off for real — nginx site
 * deleted, A and CNAME records removed, certificate revoked.
 *
 * So every install that had not typed a server address by hand was pointing at
 * a domain that does not resolve. NOTHING SAYS SO. Requests fail, the plugin
 * logs it, and the owner sees a blog that simply never publishes.
 *
 * Edwin found it by reading the Connection screen, not from an alert.
 *
 * TWO HALVES, AND THE SECOND IS THE ONE THAT MATTERS. Changing the default
 * fixes new installs only: `self::get()` returns the STORED value whenever
 * there is one, so an install that already saved the old address keeps it
 * forever. The migration is what reaches the sites that already exist — the
 * population the fix was written for.
 */

define( 'ABSPATH', __DIR__ );

/* ---------------------------------------------------------------- *
 * WordPress, as far as this file needs it
 * ---------------------------------------------------------------- */

$GLOBALS['options'] = array();

function get_option( $name, $default = false ) {
	return array_key_exists( $name, $GLOBALS['options'] ) ? $GLOBALS['options'][ $name ] : $default;
}

function update_option( $name, $value ) {
	$GLOBALS['options'][ $name ] = $value;
	return true;
}

function untrailingslashit( $s ) {
	return rtrim( (string) $s, '/\\' );
}

/* The real signature, including the PHP_URL_HOST constant, so a test cannot
 * pass against a stub that is more forgiving than WordPress. */
function wp_parse_url( $url, $component = -1 ) {
	return parse_url( (string) $url, $component );
}

require_once __DIR__ . '/interlink-engine/includes/class-ie-settings.php';

/* ---------------------------------------------------------------- */

$passed = 0;
$failed = 0;

function test( $name, $fn ) {
	global $passed, $failed;
	$GLOBALS['options'] = array();
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
	if ( ! $cond ) {
		throw new Exception( $msg );
	}
}

/** Put a value in the stored settings, the way the Connection screen would. */
function stored( $url ) {
	IE_Settings::set( array( 'server_url' => $url ) );
}

echo "\nThe server address\n";

test( 'A FRESH INSTALL POINTS AT THE LIVE SERVICE', function () {
	/* Nothing stored, so the default applies. It was
	 * https://fastwebsitegenerator.com until 1 October, which by then had no
	 * DNS at all. */
	same( 'https://threecomets.com', IE_Settings::server_url() );
} );

test( 'THE DEAD DOMAIN IS TRANSLATED ON READ', function () {
	/* The window before the migration runs, and the safety net if it never
	 * does. A site must not send a single request to a host that is gone. */
	stored( 'https://fastwebsitegenerator.com' );
	same( 'https://threecomets.com', IE_Settings::server_url() );

	stored( 'https://www.fastwebsitegenerator.com' );
	same( 'https://threecomets.com', IE_Settings::server_url(), 'the www form was missed' );

	stored( 'http://fastwebsitegenerator.com' );
	same( 'https://threecomets.com', IE_Settings::server_url(), 'the http form was missed' );
} );

test( 'THE MIGRATION PERSISTS IT, SO THE SCREEN STOPS LYING', function () {
	/* Reading can translate for one request. Only writing makes the
	 * Connection screen stop showing an address the owner would otherwise
	 * copy into a support email. */
	stored( 'https://fastwebsitegenerator.com' );

	same( true, IE_Settings::migrate_server_url(), 'the migration reported no change' );
	same( 'https://threecomets.com', IE_Settings::get( 'server_url' ),
		'the stored value was not rewritten' );
} );

test( 'it reports false when there is nothing to do, so nothing is logged', function () {
	stored( 'https://threecomets.com' );
	same( false, IE_Settings::migrate_server_url() );

	$GLOBALS['options'] = array();
	same( false, IE_Settings::migrate_server_url(), 'an empty setting counted as a migration' );
} );

test( 'A STAGING SERVER IS LEFT ALONE', function () {
	/* The field stays overridable on purpose — a staging server is the only
	 * way to exercise a plugin change without spending real credits. A
	 * migration that rewrote every address would take that away, and would do
	 * it silently during an upgrade. */
	stored( 'http://localhost:3000' );
	same( 'http://localhost:3000', IE_Settings::server_url() );
	same( false, IE_Settings::migrate_server_url(), 'staging was rewritten' );

	stored( 'https://staging.threecomets.com' );
	same( 'https://staging.threecomets.com', IE_Settings::server_url() );
	same( false, IE_Settings::migrate_server_url(), 'a subdomain was rewritten' );
} );

test( 'a trailing slash still goes, because the signature covers the path', function () {
	/* Every caller appends /api/blog/... and a double slash is a different
	 * string from the one the signature was computed over. That failure looks
	 * like a rejected signature rather than a typo in a URL. */
	stored( 'https://threecomets.com/' );
	same( 'https://threecomets.com', IE_Settings::server_url() );
} );

test( 'THE MIGRATION IS WIRED TO AN UPGRADE, NOT ONLY AN ACTIVATION', function () {
	/* The fault this guards against is a migration that runs for new installs
	 * and silently skips every existing one. Uploading a new ZIP over a live
	 * plugin does not reliably fire register_activation_hook() — the site is
	 * already active and stays active. */
	$boot = file_get_contents( __DIR__ . '/interlink-engine/interlink-engine.php' );

	ok( preg_match( '/add_action\(\s*.plugins_loaded./', $boot ),
		'the version check no longer runs on plugins_loaded' );
	ok( strpos( $boot, 'IE_Settings::migrate_server_url()' ) !== false,
		'nothing calls the migration' );
	ok( strpos( $boot, "update_option( 'ie_version', IE_VERSION )" ) !== false,
		'the version is never written, so the migration runs on every request' );

	/* THE CALL IS INSIDE THE plugins_loaded BLOCK, checked by slicing that
	 * block out rather than by comparing positions in the whole file.
	 *
	 * The first version of this compared strpos() of the migration against
	 * strpos() of 'register_activation_hook' — and failed, because the phrase
	 * also appears in the comment above explaining why the hook is NOT used.
	 * A test that reads prose as code fails for its own reasons. */
	$start = strpos( $boot, "add_action( 'plugins_loaded'" );
	$end   = strpos( $boot, 'register_activation_hook( __FILE__' );

	ok( false !== $start && false !== $end && $start < $end,
		'the plugins_loaded block is gone or moved below the activation hook' );

	$block = substr( $boot, $start, $end - $start );

	ok( strpos( $block, 'IE_Settings::migrate_server_url()' ) !== false,
		'the migration is not inside the plugins_loaded block — existing sites would never run it' );
} );

echo "\n$passed passed, $failed failed\n";
exit( $failed ? 1 : 0 );
