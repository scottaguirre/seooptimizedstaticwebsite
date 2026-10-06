<?php
/**
 * What the plugin actually puts on the wire.
 *
 *   php wp-plugin/test-api-body.php
 *
 * WHY THIS FILE EXISTS, AND WHAT IT COST
 *
 * The pause fix of 6 October had nine mutations run against it. Eight were
 * caught. The ninth was deleting the two lines that put the cancel flag INTO
 * the request body — so every caller still passed `true`, the server still
 * read `cancel`, and the value simply never travelled between them.
 *
 * Nothing noticed, because nothing could. test-ie-pause.js replaces the whole
 * IE_Api class with a stub, which is the right way to ask what the publisher
 * DOES and leaves everything between the caller and the wire unexamined.
 * self::post() is a static call resolved against IE_Api itself, so no stub
 * and no subclass can intercept it — the only two options were a real HTTP
 * request or replacing the class.
 *
 * So write() was split: write_body() builds the array and write() posts it.
 * This runs write_body() for real.
 *
 * MAKING THE UNTESTABLE THING TESTABLE, rather than writing a test that greps
 * class-ie-api.php for the line. Source searches have missed seven real bugs
 * in this project and have twice failed on correct code.
 *
 * THE CLASS OF BUG THIS GUARDS, which has now appeared four times:
 *
 *   - eight SEO filter names, all present and correctly spelled, one wired to
 *     the wrong method, so the description went into the title tag;
 *   - the business payload: `trade`/`town` sent, `type`/`location` stored,
 *     both sides correct and three fields silently discarded;
 *   - the cancel flag above;
 *
 * every one of them a value that two correct endpoints disagreed about in the
 * gap between them. PRESENCE IS NOT PAIRING.
 */

define( 'ABSPATH', __DIR__ );

/* ---------------------------------------------------------------- *
 * WordPress, as far as loading the class needs it
 * ---------------------------------------------------------------- */

function wp_json_encode( $data ) { return json_encode( $data ); }
function untrailingslashit( $s ) { return rtrim( (string) $s, '/\\' ); }
function home_url() { return 'https://example.test'; }
function wp_timezone_string() { return 'UTC'; }

require_once __DIR__ . '/interlink-engine/includes/class-ie-api.php';

/* ---------------------------------------------------------------- */

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
	if ( ! $cond ) {
		throw new Exception( $msg );
	}
}

echo "\nThe body the plugin sends to /api/blog/write\n";

test( 'AN ORDINARY POLL CARRIES NO CANCEL', function () {
	/* The opposite failure to the one below, and the one that would be
	 * silent: a cancel on every poll stops every batch after its first post,
	 * and every campaign on the system quietly writes one article. */
	$body = IE_Api::write_body( 'c1' );

	same( array( 'campaignId' => 'c1' ), $body );
	ok( ! array_key_exists( 'cancel', $body ), 'a cancel was sent on an ordinary poll' );
} );

test( 'A CANCEL REACHES THE BODY', function () {
	/* THE MUTATION THAT SURVIVED. Passing the flag in, accepting it, and
	 * dropping it before the request is invisible from either end. */
	$body = IE_Api::write_body( 'c1', array(), true );

	ok( isset( $body['cancel'] ), 'the cancel flag never reached the request body' );
	same( true, $body['cancel'], 'the server reads `true === cancel`, not a truthy value' );
	same( 'c1', $body['campaignId'], 'the campaign went missing with it' );
} );

test( 'THE KEY IS SPELLED THE WAY THE SERVER READS IT', function () {
	/* The server's check is `true === cancel || 'true' === cancel` in
	 * routes/blogApiRoute.js. A key spelled `cancelled`, `cancelRequested` or
	 * `stop` would be dropped on arrival with no error, no log line, and a
	 * batch that goes on writing — which is the failure this whole change
	 * exists to end. */
	$keys = array_keys( IE_Api::write_body( 'c1', array(), true ) );
	sort( $keys );

	same( array( 'campaignId', 'cancel' ), $keys,
		'the body keys changed — check routes/blogApiRoute.js reads the same ones' );
} );

test( 'a gap fill still names its slots, cancelling or not', function () {
	/* write() has three jobs — approve, poll, and fill specific gaps — and
	 * the cancel is a fourth thing bolted onto a method that already carried
	 * three. The slot list is the one most likely to be lost in the
	 * rearranging, and losing it means "fill slot 7" quietly becomes "write
	 * the whole campaign", charging for all of it. */
	$gap = IE_Api::write_body( 'c1', array( 3, 7 ) );
	same( array( 3, 7 ), $gap['slotIndexes'] );

	$both = IE_Api::write_body( 'c1', array( 3, 7 ), true );
	same( array( 3, 7 ), $both['slotIndexes'], 'the slot list was lost when cancelling' );
	same( true, $both['cancel'] );
} );

test( 'slot indexes are integers, whatever arrived', function () {
	/* Unchanged behaviour, asserted because the line that does it was moved
	 * into a new method. A string index reaches the server as "3" and matches
	 * no slot, so the gap fill silently does nothing. */
	same( array( 3, 7 ), IE_Api::write_body( 'c1', array( '3', '7' ) )['slotIndexes'] );
} );

test( 'an empty slot list is omitted, not sent as an empty array', function () {
	/* The server treats `slotIndexes: []` as "no scope given" by checking
	 * length, so both shapes happen to work — but an absent key is the honest
	 * one, and this is the behaviour every existing caller already relies on. */
	ok( ! array_key_exists( 'slotIndexes', IE_Api::write_body( 'c1', array() ) ),
		'an empty scope is being sent as a key' );
} );

test( 'WRITE() SENDS WHAT WRITE_BODY() BUILDS', function () {
	/* GUARDING THE SPLIT ITSELF. Everything above tests write_body(), and all
	 * of it is worthless if write() stops calling it — which is a one-line
	 * mistake away, and would restore exactly the invisible gap this file was
	 * created to close.
	 *
	 * Tokenised rather than grepped: this file's own prose names both
	 * functions repeatedly, and a text search would match the explanation as
	 * readily as the call. That mistake has already deleted one rule in this
	 * project for failing on correct code. */
	$src    = file_get_contents( __DIR__ . '/interlink-engine/includes/class-ie-api.php' );
	$tokens = token_get_all( $src );

	$in_write = false;
	$depth    = 0;
	$calls    = array();

	for ( $i = 0; $i < count( $tokens ); $i++ ) {
		$t = $tokens[ $i ];

		if ( is_array( $t ) && T_FUNCTION === $t[0] ) {
			for ( $j = $i + 1; $j < count( $tokens ); $j++ ) {
				if ( is_array( $tokens[ $j ] ) && T_STRING === $tokens[ $j ][0] ) {
					$in_write = ( 'write' === $tokens[ $j ][1] );
					$depth    = 0;
					break;
				}
				if ( '(' === $tokens[ $j ] ) break;
			}
			continue;
		}

		if ( $in_write && '{' === $t ) { $depth++; continue; }
		if ( $in_write && '}' === $t ) { $depth--; if ( $depth <= 0 ) $in_write = false; continue; }

		if ( $in_write && is_array( $t ) && T_STRING === $t[0] ) {
			$calls[] = $t[1];
		}
	}

	ok( in_array( 'write_body', $calls, true ),
		'write() no longer calls write_body() — every assertion in this file is now checking nothing' );
} );

echo "\n$passed passed, $failed failed\n\n";
exit( $failed ? 1 : 0 );
