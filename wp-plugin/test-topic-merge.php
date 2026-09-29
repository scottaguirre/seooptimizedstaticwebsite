<?php
/**
 * test-topic-merge.php
 *
 * IE_Admin::merge_topics() — folding newly suggested topics into the ones
 * already on screen.
 *
 * THE BUG THIS EXISTS TO STOP COMING BACK
 *
 * "Suggest different topics" REPLACED the six topics on screen with six new
 * ones. The word "different" was accurate and nobody read it that way: the
 * obvious thing to do when you want twelve posts is press it twice, and
 * pressing it twice left you with six. The only route to a year of posts was
 * to type all fifty-two by hand — which is the exact work the button exists
 * to avoid — and nothing on screen warned that the first set was about to go.
 *
 * Reported from a real session: "I pressed the suggest different topics twice
 * because I wanted to create a campaign of 12 articles but what it did was
 * replace the first 6."
 *
 * WHY THIS IS A SEPARATE, PURE FUNCTION
 *
 * handle_suggest() needs nonces, transients, redirects and the whole of
 * wp-admin to run, and the harness that could render it
 * (wp-plugin/test-admin-tabs.php) has been broken for weeks. So the part with
 * the decisions in it takes two arrays and returns a third, and is tested
 * here with no WordPress at all.
 *
 * Run:  php wp-plugin/test-topic-merge.php
 */

error_reporting( E_ALL );

define( 'ABSPATH', '/tmp/' );

/* ---------------------------------------------------------------------
 * Just enough WordPress for the class to LOAD. None of it is called by
 * merge_topics(), which is the point of it being pure.
 * ------------------------------------------------------------------ */

function __( $s, $d = '' ) { return $s; }
function _n( $a, $b, $n, $d = '' ) { return 1 === (int) $n ? $a : $b; }
function esc_html( $s ) { return $s; }
function esc_attr( $s ) { return $s; }
function esc_url( $s ) { return $s; }
function esc_html__( $s, $d = '' ) { return $s; }
function esc_attr__( $s, $d = '' ) { return $s; }
function add_action() {}
function sanitize_text_field( $s ) { return $s; }
function wp_unslash( $s ) { return $s; }

require_once __DIR__ . '/interlink-engine/includes/class-ie-admin.php';

/* ---------------------------------------------------------------------
 * Harness
 * ------------------------------------------------------------------ */

$passed = 0;
$failed = 0;
$DECLARED = 9;

function test( $name, $fn ) {
	global $passed, $failed;
	try {
		$fn();
		echo "  ok    {$name}\n";
		$passed++;
	} catch ( Throwable $e ) {
		echo "  FAIL  {$name}\n        " . $e->getMessage() . "\n";
		$failed++;
	}
}

function ok( $cond, $msg = 'expected true' ) {
	if ( ! $cond ) {
		throw new Exception( $msg );
	}
}

function same( $expected, $actual, $msg = '' ) {
	if ( $expected !== $actual ) {
		throw new Exception( $msg . ' — expected ' . var_export( $expected, true )
			. ', got ' . var_export( $actual, true ) );
	}
}

/** N topics named "Topic 1".."Topic N", offset so sets can be made distinct. */
function topics( $n, $from = 1 ) {
	$out = array();
	for ( $i = 0; $i < $n; $i++ ) {
		$out[] = array( 'topic' => 'Topic ' . ( $from + $i ), 'targetQuery' => '', 'linkPhrase' => '' );
	}
	return $out;
}

function names( $rows ) {
	return array_map( function ( $r ) { return $r['topic']; }, $rows );
}

echo "\nTopic merge\n\n";

test( 'PRESSING TWICE GIVES TWELVE, NOT SIX', function () {
	/* THE WHOLE BUG, in one assertion. */
	$first  = topics( 6, 1 );
	$second = topics( 6, 7 );

	$out = IE_Admin::merge_topics( $first, $second );

	same( 12, count( $out['topics'] ), 'the second press replaced the first set' );
	same( 6, count( $out['added'] ) );
} );

test( 'the topics already on screen keep their place and their order', function () {
	/* They may have been edited. Reordering or rewriting them would throw
	 * away work the owner has done. */
	$out = IE_Admin::merge_topics( topics( 3, 1 ), topics( 2, 4 ) );

	same( array( 'Topic 1', 'Topic 2', 'Topic 3', 'Topic 4', 'Topic 5' ), names( $out['topics'] ) );
} );

test( 'A DUPLICATE IS NEVER ADDED TWICE', function () {
	/* The server is ASKED to avoid what is on screen, but a request is not a
	 * guarantee — and two rows with the same topic become two posts competing
	 * for one search. */
	$existing = topics( 3, 1 );
	$fresh    = array_merge( topics( 1, 2 ), topics( 2, 4 ) ); // Topic 2 is already there

	$out = IE_Admin::merge_topics( $existing, $fresh );

	same( array( 'Topic 1', 'Topic 2', 'Topic 3', 'Topic 4', 'Topic 5' ), names( $out['topics'] ) );
	same( 2, count( $out['added'] ), 'the duplicate was counted as added' );
} );

test( 'duplicates are caught regardless of case or stray spaces', function () {
	$existing = array( array( 'topic' => 'Frozen Pipe Leander' ) );
	$fresh    = array( array( 'topic' => '  frozen pipe leander ' ) );

	$out = IE_Admin::merge_topics( $existing, $fresh );

	same( 1, count( $out['topics'] ), 'the same topic was added in a different case' );
} );

test( 'an empty topic is dropped rather than added as a blank row', function () {
	$out = IE_Admin::merge_topics( topics( 2, 1 ), array(
		array( 'topic' => '' ),
		array( 'topic' => '   ' ),
		array( 'topic' => 'Real One' ),
	) );

	same( array( 'Topic 1', 'Topic 2', 'Real One' ), names( $out['topics'] ) );
} );

test( 'the first press works from nothing', function () {
	$out = IE_Admin::merge_topics( array(), topics( 12, 1 ) );

	same( 12, count( $out['topics'] ) );
	same( false, $out['capped'] );
} );

test( 'A YEAR OF WEEKLY POSTS IS REACHABLE', function () {
	/* Five presses of twelve. If this ever stops being true the button has
	 * gone back to being a toy. */
	$topics = array();
	for ( $press = 0; $press < 5; $press++ ) {
		$out    = IE_Admin::merge_topics( $topics, topics( 12, ( $press * 12 ) + 1 ) );
		$topics = $out['topics'];
	}

	same( 52, count( $topics ), 'five presses did not reach the cap' );
} );

test( 'THE CAP HOLDS, AND KEEPS THE EARLIER TOPICS', function () {
	/* Every topic becomes a post that costs credits on approval, so the
	 * ceiling is a spending limit. The topics kept are the ones already on
	 * screen, because those are the ones that may have been edited. */
	$existing = topics( 50, 1 );

	$out = IE_Admin::merge_topics( $existing, topics( 12, 51 ) );

	same( 52, count( $out['topics'] ), 'the cap did not hold' );
	same( true, $out['capped'] );
	same( 'Topic 1', $out['topics'][0]['topic'], 'it dropped the topics the owner had already edited' );
	same( 2, count( $out['added'] ), 'added should report what actually fitted' );
} );

test( 'a full campaign accepts nothing more', function () {
	$out = IE_Admin::merge_topics( topics( 52, 1 ), topics( 12, 53 ) );

	same( 52, count( $out['topics'] ) );
	same( 0, count( $out['added'] ) );
	same( true, $out['capped'] );
} );

echo "\n  {$passed} passed, {$failed} failed\n";

if ( $passed + $failed !== $DECLARED ) {
	echo "  MISCOUNT: " . ( $passed + $failed ) . " ran, {$DECLARED} declared\n";
	exit( 1 );
}

echo "\n";
exit( $failed === 0 ? 0 : 1 );
