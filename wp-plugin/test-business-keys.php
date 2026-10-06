<?php
/**
 * The business travels between two vocabularies. This is the joint.
 *
 *   php wp-plugin/test-business-keys.php
 *
 * WHAT BROKE
 *
 * WordPress calls them `trade` and `town`, because that is what the generated
 * themes call them. The server stores `type` and `location`, and its
 * readBusiness() (utils/blog/businessShape.js) keeps a LIMITS map of the only
 * four fields it will accept. It does not rename anything on arrival, and a
 * key it does not recognise is not an error, is not logged, and does not
 * appear anywhere. It is dropped.
 *
 * The translation between the two was written once, inline, inside
 * IE_API::activate(). The other two senders — plan() and the hourly
 * campaigns_present() sweep — passed IE_Settings::business() straight through.
 * So from the day they were added:
 *
 *   - `name` and `phone` happened to match, and updated normally.
 *   - `trade` and `town` were discarded by every call except activation.
 *   - the server's `type` and `location` were therefore FROZEN at whatever
 *     the site reported the day its licence was pasted in, and no later call
 *     could ever change them.
 *
 * WHY NOBODY SAW IT
 *
 * Both sides were correct on their own, and both sides had tests.
 * test-business-shape.js proves readBusiness() stores exactly its four fields.
 * The plugin's suites prove business() returns exactly its four fields. Each
 * suite asserts over one vocabulary and neither ever meets the other, so the
 * mismatch lived in the gap between two green suites.
 *
 * PRESENCE IS NOT PAIRING. The same lesson as the eight SEO filters, where
 * every name was present and correctly spelled and one was wired to the wrong
 * method. A field that is spelled correctly in both files can still be
 * spelled correctly in two DIFFERENT files.
 *
 * THE SYMPTOM
 *
 * hilltophomeloans.net had a leftover `local_business_theme_global_settings`
 * row from an imported theme that had long since been deleted — "Junk Removal
 * Leander", type "Junk Removal", "Leander, TX". A campaign feeding a page for
 * "small business loans for women" shipped with live anchors reading
 *
 *     Junk Removal Leander
 *     Leander small business loans for women
 *
 * The stale row is a data problem on one site. That no later call could
 * correct the server's copy of it is this bug.
 *
 * The comment above IE_API::plan() already claimed to have fixed exactly
 * this, and quotes roofingamerica.xyz shipping "…in Leander" as the symptom.
 * It fixed `name`. The sentence was true of one field out of four, and read
 * as true of all of them for months.
 */

define( 'ABSPATH', __DIR__ );

/* ---------------------------------------------------------------- *
 * WordPress, as far as this file needs it
 * ---------------------------------------------------------------- */

$GLOBALS['options']  = array();
$GLOBALS['template'] = 'kadence';
$GLOBALS['blogname'] = 'hilltophomeloans.net';

function get_option( $name, $default = false ) {
	return array_key_exists( $name, $GLOBALS['options'] ) ? $GLOBALS['options'][ $name ] : $default;
}

function update_option( $name, $value ) {
	$GLOBALS['options'][ $name ] = $value;
	return true;
}

function get_template() {
	return $GLOBALS['template'];
}

function get_bloginfo( $what = 'name' ) {
	return 'name' === $what ? $GLOBALS['blogname'] : '';
}

function wp_parse_args( $args, $defaults = array() ) {
	return array_merge( $defaults, (array) $args );
}

function untrailingslashit( $s ) {
	return rtrim( (string) $s, '/\\' );
}

function wp_parse_url( $url, $component = -1 ) {
	return parse_url( (string) $url, $component );
}

require_once __DIR__ . '/interlink-engine/includes/class-ie-settings.php';

/* ---------------------------------------------------------------- */

$passed = 0;
$failed = 0;

function test( $name, $fn ) {
	global $passed, $failed;
	$GLOBALS['options']  = array();
	$GLOBALS['template'] = 'kadence';
	$GLOBALS['blogname'] = 'hilltophomeloans.net';
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

/**
 * The field names the SERVER will actually store, read from the server's own
 * source rather than copied here.
 *
 * A LIST TYPED INTO THIS FILE WOULD BE A THIRD VOCABULARY, and a third place
 * for the same four words to drift apart — which is the entire bug. So the
 * authority is businessShape.js, and this reads it.
 *
 * IT THROWS RATHER THAN RETURNING AN EMPTY SET when the block cannot be found
 * or looks wrong. An extractor that quietly returns nothing turns every
 * comparison below into a comparison against nothing, and the suite goes
 * green BECAUSE the check stopped working. That failure mode has already cost
 * this project two round trips once (`grep -c` with PHP spacing against a
 * JavaScript file, which returned 0 — indistinguishable from absent).
 */
function server_business_fields() {
	$path = dirname( __DIR__ ) . '/utils/blog/businessShape.js';

	if ( ! is_readable( $path ) ) {
		throw new Exception( "cannot read the server's businessShape.js at $path" );
	}

	$src = file_get_contents( $path );

	if ( ! preg_match( '/const\s+LIMITS\s*=\s*\{(.*?)\}/s', $src, $m ) ) {
		throw new Exception( 'no `const LIMITS = { ... }` in businessShape.js — '
			. 'if it was renamed, update this extractor; do NOT paste the field list in here' );
	}

	preg_match_all( '/(\w+)\s*:/', $m[1], $fields );
	$found = $fields[1];

	if ( count( $found ) < 4 ) {
		throw new Exception( 'LIMITS parsed to only ' . count( $found ) . ' field(s): '
			. implode( ', ', $found ) . ' — the extractor is broken, not the code' );
	}

	sort( $found );
	return $found;
}

/** Put a generated theme's settings row in place, the way an import would. */
function theme_settings( array $values, $prefix = 'local_business_theme_' ) {
	update_option( $prefix . 'global_settings', $values );
}

/** The exact row found in hilltophomeloans.net's wp_options on 5 October. */
function hilltop_row() {
	theme_settings( array(
		'business_name' => 'Junk Removal Leander',
		'business_type' => 'Junk Removal',
		'location'      => 'Leander, TX',
		'phone'         => '5125550147',
	) );
}

/**
 * Every `IE_Settings::business*()` call in a plugin file, by the method that
 * makes it.
 *
 * TOKENISED, NOT GREPPED. The file documents this bug at length in its own
 * comments, and those comments name both functions repeatedly — so a grep for
 * "IE_Settings::business(" matches the prose describing the fix and reports
 * the bug as still present. A test that fails on correct code gets deleted,
 * and then nothing is checking at all.
 *
 * PHP's own tokeniser emits comments as single T_COMMENT/T_DOC_COMMENT tokens,
 * so prose cannot be mistaken for a call. This is the sixth time on this
 * project that reading code as text has gone wrong; the tokeniser is here
 * because the string search is the thing that keeps failing.
 *
 * @return array<string, string[]>  method name => calls made inside it
 */
function business_calls_by_method( $file ) {
	$src = file_get_contents( $file );
	if ( false === $src ) {
		throw new Exception( "cannot read $file" );
	}

	$tokens = token_get_all( $src );
	$calls  = array();
	$method = '(file scope)';
	$depth  = 0;
	$in_fn  = null;

	for ( $i = 0; $i < count( $tokens ); $i++ ) {
		$t = $tokens[ $i ];

		if ( is_array( $t ) && T_FUNCTION === $t[0] ) {
			// The next T_STRING is the name.
			for ( $j = $i + 1; $j < count( $tokens ); $j++ ) {
				if ( is_array( $tokens[ $j ] ) && T_STRING === $tokens[ $j ][0] ) {
					$method = $tokens[ $j ][1];
					$in_fn  = $method;
					$depth  = 0;
					break;
				}
				if ( '(' === $tokens[ $j ] ) break;   // a closure: no name
			}
			continue;
		}

		if ( '{' === $t && null !== $in_fn ) { $depth++; continue; }
		if ( '}' === $t && null !== $in_fn ) {
			$depth--;
			if ( $depth <= 0 ) { $in_fn = null; $method = '(file scope)'; }
			continue;
		}

		/* IE_Settings :: business|business_payload ( */
		if ( is_array( $t ) && T_STRING === $t[0] && 'IE_Settings' === $t[1]
			&& isset( $tokens[ $i + 1 ] ) && is_array( $tokens[ $i + 1 ] )
			&& T_DOUBLE_COLON === $tokens[ $i + 1 ][0]
			&& isset( $tokens[ $i + 2 ] ) && is_array( $tokens[ $i + 2 ] )
			&& T_STRING === $tokens[ $i + 2 ][0]
		) {
			$name = $tokens[ $i + 2 ][1];
			if ( 'business' === $name || 'business_payload' === $name ) {
				$calls[ $method ][] = $name;
			}
		}
	}

	return $calls;
}

$API   = __DIR__ . '/interlink-engine/includes/class-ie-api.php';
$ADMIN = __DIR__ . '/interlink-engine/includes/class-ie-admin.php';

echo "\nThe business, across the WordPress/server boundary\n";

/* ---------------------------------------------------------------- *
 * The joint itself
 * ---------------------------------------------------------------- */

test( 'THE PAYLOAD KEYS ARE EXACTLY THE FIELDS THE SERVER STORES', function () {
	/* The one assertion this whole file exists for. Either side may be
	 * renamed; they may not be renamed independently. */
	$sent   = array_keys( IE_Settings::business_payload() );
	$stored = server_business_fields();

	sort( $sent );

	same( $stored, $sent,
		'the plugin sends fields the server will silently discard, or omits ones it stores' );
} );

test( 'business() still answers in WordPress words', function () {
	/* The other half of the pair. business_payload() is a translation, which
	 * is only meaningful if the thing it translates FROM keeps its own
	 * vocabulary — the generated themes and the admin screens read `town`. */
	$keys = array_keys( IE_Settings::business() );
	sort( $keys );
	same( array( 'name', 'phone', 'town', 'trade' ), $keys );
} );

test( 'EVERY FIELD CROSSES, NOT JUST THE TWO WHOSE NAMES HAPPEN TO MATCH', function () {
	/* `name` and `phone` were never broken, because the two vocabularies
	 * agree on those two words. That is exactly what made the bug survive:
	 * the server's stored business was never empty, it was just two-thirds
	 * stale, which looks like a site that has not changed its details. */
	hilltop_row();

	$sent = IE_Settings::business_payload();

	same( 'Junk Removal Leander', $sent['name'] );
	same( 'Junk Removal',         $sent['type'],     'trade did not become type' );
	same( 'Leander, TX',          $sent['location'], 'town did not become location' );
	same( '5125550147',           $sent['phone'] );
} );

test( 'A MOVED BUSINESS CAN REACH THE SERVER AT ALL', function () {
	/* The failure in the form the owner would experience it. Before the fix
	 * this site could re-send its new address every hour, for months, and the
	 * server would discard it every time — so anchors kept naming the old
	 * town long after the business had left it. roofingamerica.xyz is the
	 * worked example quoted in businessShape.js. */
	theme_settings( array(
		'business_name' => 'Emergency Plumber Austin',
		'business_type' => 'Plumber',
		'location'      => 'Austin, TX',
	) );

	$sent = IE_Settings::business_payload();

	same( 'Austin, TX', $sent['location'],
		'the new town is not in the payload — nothing downstream can correct the old one' );
} );

test( 'a missing field is sent as an empty string, not omitted', function () {
	/* Deliberate, and it depends on the server's behaviour: readBusiness()
	 * DROPS blank fields rather than storing them, so an empty string cannot
	 * wipe a good value the owner entered elsewhere. The shape stays constant
	 * regardless, which is what the key assertion above relies on. */
	theme_settings( array( 'business_name' => 'Hilltop Home Loans' ) );

	$sent = IE_Settings::business_payload();

	same( array( 'name', 'type', 'location', 'phone' ), array_keys( $sent ) );
	same( '', $sent['type'] );
	same( '', $sent['location'] );
} );

test( 'everything is a string, including a number typed into the phone box', function () {
	/* The server slices phone to 50 characters. slice() on a number throws. */
	theme_settings( array( 'business_name' => 'Hilltop', 'phone' => 5125550147 ) );

	$sent = IE_Settings::business_payload();

	foreach ( $sent as $field => $value ) {
		ok( is_string( $value ), "$field is " . gettype( $value ) . ', not a string' );
	}
} );

/* ---------------------------------------------------------------- *
 * The call sites — where the three copies disagreed
 * ---------------------------------------------------------------- */

test( 'NO SENDER TRANSLATES ON ITS OWN', function () use ( $API ) {
	/* The bug was not a wrong mapping. It was THREE call sites, one of which
	 * had a correct mapping written inline, and two of which had none. An
	 * inline translation at a call site is a copy, and copies drift.
	 *
	 * So the rule is absolute: the file that talks to the server never calls
	 * business(). If it needs the business, it asks for the payload. */
	$calls = business_calls_by_method( $API );

	$raw = array();
	foreach ( $calls as $method => $names ) {
		foreach ( $names as $name ) {
			if ( 'business' === $name ) $raw[] = $method;
		}
	}

	same( array(), $raw,
		'class-ie-api.php calls IE_Settings::business() in: ' . implode( ', ', $raw )
			. ' — that shape has trade/town, which the server discards' );
} );

test( 'ALL THREE SENDERS STILL SEND IT', function () use ( $API ) {
	/* The previous test alone would pass if someone removed the business from
	 * the plan payload entirely — zero raw calls, and a campaign planned
	 * against whatever the server last stored.
	 *
	 * Named individually rather than counted, because "at least three" says
	 * nothing about WHICH three, and plan() is the one that matters: it is
	 * the single moment the value is used, as the anchors are chosen and
	 * frozen into the slots. */
	$calls = business_calls_by_method( $API );

	foreach ( array( 'activate', 'plan', 'campaigns_present' ) as $method ) {
		ok( isset( $calls[ $method ] ) && in_array( 'business_payload', $calls[ $method ], true ),
			"IE_API::$method() no longer sends the business" );
	}
} );

test( 'the admin screens are left speaking WordPress', function () use ( $ADMIN ) {
	/* NOT A FAILURE — A BOUNDARY, recorded so the next person does not
	 * "finish the job" by converting these too.
	 *
	 * class-ie-admin.php reads business()['town'] to pre-fill a keyword and a
	 * form field. Those never leave WordPress, so they belong in WordPress's
	 * vocabulary. The payload shape is for the wire, and only for the wire. */
	$calls = business_calls_by_method( $ADMIN );

	$raw = 0;
	foreach ( $calls as $names ) {
		foreach ( $names as $name ) {
			if ( 'business' === $name ) $raw++;
		}
	}

	ok( $raw > 0, 'the admin screens stopped calling business() — if deliberate, delete this test' );
} );

/* ---------------------------------------------------------------- *
 * The extractor, which is code too
 * ---------------------------------------------------------------- */

test( "THE SERVER'S FIELD LIST WAS REALLY READ", function () {
	/* Guarding the guard. Every key assertion above compares against whatever
	 * server_business_fields() returned, so if that silently returned an
	 * empty list the comparisons would be vacuous and the suite would go
	 * green while checking nothing.
	 *
	 * It throws instead of returning empty, and this proves the throw has not
	 * been softened into a `return array()` by someone making the suite pass. */
	$fields = server_business_fields();

	same( array( 'location', 'name', 'phone', 'type' ), $fields,
		"the server's LIMITS changed — the plugin's payload must change with it" );
} );

test( 'THE TOKENISER IGNORES PROSE AND FINDS REAL CALLS', function () {
	/* The extractor is the part most likely to be quietly wrong, and BOTH
	 * call-site tests above pass if it simply finds nothing. So it is
	 * exercised against a fixture whose right answer is written down here,
	 * rather than against the production file — whose prose could change
	 * tomorrow and take the proof with it.
	 *
	 * The fixture contains the two things a text search gets wrong: a comment
	 * naming the banned call (a grep reports it and fails correct code) and a
	 * real call inside a function (which is the only thing that counts). */
	$fixture = <<<'PHP'
<?php
class IE_API {
	/**
	 * This used to call IE_Settings::business() and that was the bug.
	 * See IE_Settings::business() for why.
	 */
	public static function plan( $payload ) {
		// IE_Settings::business() — still only a comment.
		$payload['business'] = IE_Settings::business_payload();
		return $payload;
	}

	public static function untouched() {
		return true;
	}
}
PHP;

	$path = tempnam( sys_get_temp_dir(), 'iebk' );
	file_put_contents( $path, $fixture );

	try {
		$calls = business_calls_by_method( $path );
	} finally {
		unlink( $path );
	}

	same( array( 'plan' => array( 'business_payload' ) ), $calls,
		'three comments naming business() and one real call to business_payload() — '
			. 'anything else means the extractor reads prose, loses calls, or '
			. 'attributes them to the wrong function' );
} );

echo "\n$passed passed, $failed failed\n\n";
exit( $failed ? 1 : 0 );
