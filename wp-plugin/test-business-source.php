<?php
/**
 * Does this site know its own business — and can it say so?
 *
 *   php wp-plugin/test-business-source.php
 *
 * WHAT THIS IS GUARDING
 *
 * The server ignores any business field that arrives blank. That guard is
 * right and it is old: a settings page caught half-loaded would otherwise wipe
 * a business name the customer typed months ago.
 *
 * It had no opposite. A blank meant "I am not telling you", and nothing could
 * say "I am telling you: there is nothing here". So a value could be CHANGED
 * and never REMOVED.
 *
 * 11 October. roofingamerica.xyz was wiped, rebuilt as a roofing company and
 * reconnected with its old licence. Its theme settings were empty, so this
 * plugin reported blanks, so the server kept what the record held from the
 * domain's previous life — type "Plumbing", location "Austin, TX". A roofing
 * blog's topics came back about Austin wind and Central Texas heat, and
 * ninety-five articles were written before Edwin asked why.
 *
 * So the payload now carries `businessFields`: the fields this site is
 * ANSWERING FOR. A blank in that list is deliberate and the server clears it.
 *
 * THE DANGEROUS HALF IS WHEN THE LIST IS SENT, not what is in it. Sending it
 * when this site has not actually read anything turns "I could not look" into
 * "there is nothing", and hands the server a licence to erase a business that
 * was perfectly correct. Most of this file is about that one distinction.
 *
 * business() and business_is_known() are a PAIR performing the same two
 * lookups in the same order. Nothing in the language makes them agree, so the
 * last section checks that they do.
 */

define( 'ABSPATH', __DIR__ );

/* ---------------------------------------------------------------- *
 * WordPress, as far as this file needs it
 * ---------------------------------------------------------------- */

$GLOBALS['options']  = array();
$GLOBALS['template'] = 'roofing_theme';

function get_option( $name, $default = false ) {
	return array_key_exists( $name, $GLOBALS['options'] ) ? $GLOBALS['options'][ $name ] : $default;
}

function update_option( $name, $value, $autoload = null ) {
	$GLOBALS['options'][ $name ] = $value;
	return true;
}

function get_template() {
	return $GLOBALS['template'];
}

function get_bloginfo( $what = 'name' ) {
	return 'roofingamerica.xyz';
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

function apply_filters( $hook, $value ) {
	return $value;
}

require_once __DIR__ . '/interlink-engine/includes/class-ie-settings.php';

/* ---------------------------------------------------------------- */

$passed = 0;
$failed = 0;

function test( $name, $fn ) {
	global $passed, $failed;
	$GLOBALS['options']  = array();
	$GLOBALS['template'] = 'roofing_theme';
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

/** The generated theme's settings row, as a real site has it. */
function theme_settings( $values ) {
	update_option( 'roofing_theme_global_settings', $values );
}

/** The plugin's own stored business, which takes precedence when it has a name. */
function stored_business( $values ) {
	update_option( 'ie_settings', array( 'business' => $values ) );
}

/* ===================================================================== */

echo "\nWhen this site may answer for its own blanks\n";

test( 'A THEME SETTINGS ROW MEANS WE LOOKED', function () {
	/* Every field empty except the name. This is Edwin's rebuilt site, and the
	 * whole fix is that it now counts as an answer rather than a silence. */
	theme_settings( array( 'business_name' => 'Roofing America' ) );

	same( true, IE_Settings::business_is_known() );
	same( array( 'name', 'type', 'location', 'phone' ), IE_Settings::business_fields() );
} );

test( 'A STORED BUSINESS WITH A NAME MEANS WE LOOKED', function () {
	stored_business( array( 'name' => 'Roofing America' ) );

	same( true, IE_Settings::business_is_known() );
} );

test( 'NO SOURCE AT ALL MEANS WE SAY NOTHING', function () {
	/* THE CASE THE ORIGINAL GUARD WAS WRITTEN FOR, and the one this must not
	 * break. The theme is gone, or its options row was never created. The name
	 * still comes back — business() falls back to the WordPress site title —
	 * so a payload alone cannot tell this case from the one above. */
	same( false, IE_Settings::business_is_known() );
	same( array(), IE_Settings::business_fields(),
		'a site that knows nothing is claiming to answer for everything' );
} );

test( 'AN EMPTY SETTINGS ROW IS NOT A SOURCE', function () {
	/* An option that exists and holds an empty array is the shape WordPress
	 * returns for a row that was created and then cleared. business() does not
	 * accept it, so this must not either, or the two disagree. */
	theme_settings( array() );

	same( false, IE_Settings::business_is_known() );
} );

test( 'A STORED BUSINESS WITH NO NAME IS NOT A SOURCE', function () {
	/* Same rule as business(): the name is what makes the stored block real.
	 * A half-written row with only a phone in it is setup abandoned part way. */
	stored_business( array( 'phone' => '5125921144' ) );

	same( false, IE_Settings::business_is_known() );
} );

/* ===================================================================== */

echo "\nWhat gets reported\n";

test( 'AN EMPTY LOCATION IS REPORTED AS EMPTY, AND CLAIMED', function () {
	/* Together these two are the fix. The blank is not new — the plugin always
	 * sent it. What is new is the list beside it saying the blank is real. */
	theme_settings( array( 'business_name' => 'Roofing America' ) );

	$payload = IE_Settings::business_payload();

	same( '', $payload['location'] );
	same( '', $payload['type'] );
	ok( in_array( 'location', IE_Settings::business_fields(), true ),
		'the site reports an empty town and does not claim it, so Austin survives' );
} );

test( 'THE SERVER\'S FIELD NAMES, NOT WORDPRESS\'S', function () {
	/* business() answers in trade/town because that is what the generated
	 * themes call them; the server's readBusiness() knows only type/location
	 * and silently drops anything else. The list has to match the payload or it
	 * names fields that are not there. */
	theme_settings( array(
		'business_name' => 'Roofing America',
		'business_type' => 'Roofing',
		'location'      => 'Leander, TX',
	) );

	$payload = IE_Settings::business_payload();

	same( 'Roofing', $payload['type'] );
	same( 'Leander, TX', $payload['location'] );
	same( array_keys( $payload ), IE_Settings::business_fields(),
		'the claimed fields and the sent fields are different sets' );
} );

test( 'A FULLY FILLED SITE CLAIMS EVERYTHING TOO', function () {
	/* The list is not "which fields are filled in" — it is "which fields this
	 * site answered for". All four, either way. */
	theme_settings( array(
		'business_name' => 'Roofing America',
		'business_type' => 'Roofing',
		'location'      => 'Leander, TX',
		'phone'         => '5125921144',
	) );

	same( array( 'name', 'type', 'location', 'phone' ), IE_Settings::business_fields() );
} );

/* ===================================================================== */

echo "\nThe pair cannot drift\n";

test( 'KNOWN IS TRUE EXACTLY WHEN business() READ A SOURCE', function () {
	/* business_is_known() repeats business()'s two lookups rather than sharing
	 * them, because folding them into one function would change a signature
	 * three call sites and two test files depend on. The price of that choice
	 * is this test.
	 *
	 * The tell is the NAME: with no source, business() falls back to the
	 * WordPress site title, so a name equal to the blog title and nothing else
	 * set is exactly the "could not look" case. */
	$cases = array(
		array( 'setup' => function () {}, 'known' => false ),
		array( 'setup' => function () { theme_settings( array() ); }, 'known' => false ),
		array( 'setup' => function () { stored_business( array( 'phone' => '1' ) ); }, 'known' => false ),
		array( 'setup' => function () { theme_settings( array( 'business_name' => 'A' ) ); }, 'known' => true ),
		array( 'setup' => function () { theme_settings( array( 'phone' => '1' ) ); }, 'known' => true ),
		array( 'setup' => function () { stored_business( array( 'name' => 'A' ) ); }, 'known' => true ),
	);

	foreach ( $cases as $i => $case ) {
		$GLOBALS['options'] = array();
		$case['setup']();

		$business = IE_Settings::business();
		$known    = IE_Settings::business_is_known();

		same( $case['known'], $known, "case $i: business_is_known() disagrees" );

		if ( ! $known ) {
			same( get_bloginfo( 'name' ), $business['name'],
				"case $i: not known, yet the name did not come from the fallback" );
		}
	}
} );

test( 'CLAIMING NOTHING AND CLAIMING EVERYTHING ARE THE ONLY ANSWERS', function () {
	/* business() reads all four fields from ONE source. There is no state in
	 * which two of them were answered and two were not, so a partial list
	 * would mean the pair had come apart. */
	foreach ( array( array(), array( 'business_name' => 'A' ), array( 'phone' => '1' ) ) as $row ) {
		$GLOBALS['options'] = array();
		if ( $row ) {
			theme_settings( $row );
		}

		$fields = IE_Settings::business_fields();

		ok( 0 === count( $fields ) || 4 === count( $fields ),
			'a partial claim appeared: ' . implode( ',', $fields ) );
	}
} );

/* ===================================================================== */

echo "\nIt actually reaches the server\n";

test( 'EVERY CALL THAT SENDS A BUSINESS SENDS THE LIST WITH IT', function () {
	/* Read from source: driving IE_Api means stubbing the whole HTTP layer for
	 * a property that is about which keys are in a payload.
	 *
	 * Comments are stripped first. The notes in that file name both keys
	 * repeatedly while explaining this very bug, and a raw count would find
	 * the prose and call the job done — the mistake test-server-url.php and
	 * test-job-uploads.js each carry a warning about. */
	$src = file_get_contents( __DIR__ . '/interlink-engine/includes/class-ie-api.php' );

	$code = '';
	foreach ( token_get_all( $src ) as $token ) {
		if ( is_array( $token ) && in_array( $token[0], array( T_COMMENT, T_DOC_COMMENT ), true ) ) {
			$code .= "\n";
			continue;
		}
		$code .= is_array( $token ) ? $token[1] : $token;
	}

	$business = substr_count( $code, 'business_payload()' );
	$fields   = substr_count( $code, 'business_fields()' );

	ok( $business > 0, 'nothing sends a business any more' );
	same( $business, $fields,
		"$business call(s) send a business and $fields send the list — a payload without it "
		. 'cannot clear anything, and nothing on either side would say so' );
} );

echo "\n$passed passed, $failed failed\n";
exit( $failed ? 1 : 0 );
