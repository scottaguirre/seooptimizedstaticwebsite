<?php
/**
 * "4 of 11 written" — the progress the plugin was already being told.
 *
 *   php wp-plugin/test-writing-progress.php
 *
 * WHY THIS EXISTS
 *
 * Edwin remembered the campaigns screen filling in article by article while a
 * campaign ran, and asked what had changed. Nothing about the screen. Posts
 * used to be written one per publication day; they are now written as a batch
 * when the campaign is approved and collected after it finishes. So for about
 * eight minutes the card had a spinner and nothing else, while being charged
 * per post — and minute one looked exactly like minute eight.
 *
 * The progress was never missing. /api/blog/collect answers a campaign that is
 * still writing with `done` and `total`, IE_Publisher::run_campaign() received
 * both on every poll, returned them to its caller, and the caller logged them
 * and dropped them. This keeps them.
 *
 * WHAT IS WORTH GUARDING, which is not "a number appears"
 *
 *   1. The count is stored on EVERY poll. writing_since is deliberately
 *      stamped once, on the transition, and the obvious way to add the counts
 *      is beside it — inside that same guard. Then the card reads "0 of 11"
 *      from the first post to the last, which is worse than no count: it
 *      looks like a batch that has stalled.
 *
 *   2. The count is CLEARED when writing stops, by both routes. One is the
 *      next poll; the other is pause(), which clears the spinner early and on
 *      purpose. "3 of 11 written" beside a paused campaign reads as a promise
 *      that the other eight are coming. They are not.
 *
 *   3. An impossible fraction is not printed. "0 of 0" and "7 of 4" are both
 *      reachable from a version skew, and a nonsense number beside a charge
 *      costs more trust than the bare spinner it replaced.
 *
 * TWO KINDS OF TEST, and the first kind is the one that can lie. Reading the
 * source for a phrase proves a phrase is present. Where the behaviour can be
 * driven it is driven: run_campaign() is called against a stubbed API, and the
 * stored record is read back. Source reading is kept only for the two facts no
 * stub can reach — what the admin template renders, and where pause() writes.
 *
 * COMMENTS ARE STRIPPED BEFORE ANY SOURCE IS SEARCHED. The notes in these
 * files quote the field names and the bad outputs ("0 of 11") verbatim, so a
 * raw search would find the explanation of the bug and call it the fix.
 * test-server-url.php and test-job-uploads.js both carry this warning after
 * both made the mistake.
 */

define( 'ABSPATH', __DIR__ );

/* ---------------------------------------------------------------- *
 * WordPress, as far as this file needs it
 * ---------------------------------------------------------------- */

$GLOBALS['options'] = array();

function get_option( $name, $default = false ) {
	return array_key_exists( $name, $GLOBALS['options'] ) ? $GLOBALS['options'][ $name ] : $default;
}

function update_option( $name, $value, $autoload = null ) {
	$GLOBALS['options'][ $name ] = $value;
	return true;
}

function current_time( $type = 'mysql' ) {
	return gmdate( 'Y-m-d H:i:s' );
}

function sanitize_text_field( $s ) {
	return trim( strip_tags( (string) $s ) );
}

function esc_html( $s ) {
	return htmlspecialchars( (string) $s, ENT_QUOTES );
}

function number_format_i18n( $n ) {
	return number_format( (float) $n );
}

function __( $s, $domain = '' ) {
	return $s;
}

function apply_filters( $hook, $value ) {
	return $value;
}

class WP_Error {
	public $code;
	public $message;
	public function __construct( $code = '', $message = '' ) {
		$this->code    = $code;
		$this->message = $message;
	}
	public function get_error_message() {
		return $this->message;
	}
	public function get_error_data() {
		return array();
	}
}

function is_wp_error( $thing ) {
	return $thing instanceof WP_Error;
}

/* ---------------------------------------------------------------- *
 * The server, as far as run_campaign() needs it
 *
 * Declared BEFORE the publisher so the real IE_Api is never loaded. The
 * writing path returns before collect() or complete() is reached, so one
 * method is the whole surface — and leaving the others out means a change
 * that makes the writing path collect would fail here loudly rather than
 * quietly pass against a permissive stub.
 * ---------------------------------------------------------------- */

class IE_Api {
	/** @var array the next reply from /api/blog/write */
	public static $reply = array();

	/** @var array every call made, so a test can prove one did not happen */
	public static $calls = array();

	public static function write( $campaign_id, $payload = array(), $cancel = false ) {
		self::$calls[] = array( 'id' => $campaign_id, 'cancel' => $cancel );
		return self::$reply;
	}
}

class IE_Settings {
	public static function is_connected() {
		return true;
	}
}

require_once __DIR__ . '/interlink-engine/includes/class-ie-campaigns.php';
require_once __DIR__ . '/interlink-engine/includes/class-ie-publisher.php';

/* ---------------------------------------------------------------- */

$passed = 0;
$failed = 0;

function test( $name, $fn ) {
	global $passed, $failed;
	$GLOBALS['options'] = array();
	IE_Api::$reply = array();
	IE_Api::$calls = array();
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
 * A campaign mid-flight: approved, active, nothing published yet.
 *
 * `pending` on the card is counted from the slots, and $watching needs it
 * above zero — so eleven slots, matching the campaign Edwin was running.
 */
function seed( $extra = array() ) {
	$slots = array();
	for ( $i = 0; $i < 11; $i++ ) {
		$slots[] = array( 'index' => $i, 'topic' => 'Topic ' . $i, 'status' => 'pending' );
	}

	return IE_Campaigns::save( array_merge( array(
		'id'                 => 'camp-1',
		'server_campaign_id' => 'srv-1',
		'status'             => 'active',
		'approved_at'        => '2026-10-10 09:00:00',
		'batch_started'      => '2026-10-10 09:00:00',
		'slots'              => $slots,
	), $extra ) );
}

/** The record as it stands after run_campaign() has been and gone. */
function stored_campaign() {
	return IE_Campaigns::get( 'camp-1' );
}

/** The source of a plugin file with every comment removed. */
function code( $file ) {
	$src = file_get_contents( __DIR__ . '/interlink-engine/includes/' . $file );

	ok( false !== $src && '' !== $src, "could not read $file" );

	$out = '';

	// token_get_all() rather than a regex, because the regex version of this
	// strips the inside of any string that happens to contain /* — and these
	// files are full of prose in strings.
	foreach ( token_get_all( $src ) as $token ) {
		if ( is_array( $token ) && in_array( $token[0], array( T_COMMENT, T_DOC_COMMENT ), true ) ) {
			$out .= "\n";
			continue;
		}
		$out .= is_array( $token ) ? $token[1] : $token;
	}

	return $out;
}

/* ===================================================================== */

echo "\nThe count is kept while the batch runs\n";

test( 'A FIRST POLL STORES THE PROGRESS AND STARTS THE CLOCK', function () {
	seed();
	IE_Api::$reply = array( 'status' => 'writing', 'done' => 1, 'total' => 11 );

	$out = IE_Publisher::run_campaign( 'camp-1' );

	same( true, $out['writing'], 'the writing reply is no longer recognised' );

	$c = stored_campaign();
	same( 1, (int) $c['writing_done'] );
	same( 11, (int) $c['writing_total'] );
	ok( ! empty( $c['writing_since'] ), 'the spinner clock was not started' );
} );

test( 'A LATER POLL MOVES THE COUNT ON — THE WHOLE POINT', function () {
	/* The failure this is for: writing_done added beside writing_since, inside
	 * the `! $was_writing` guard. The first poll stores 1 of 11 and every poll
	 * after it is ignored, so the card says "1 of 11" for eight minutes. */
	seed();

	IE_Api::$reply = array( 'status' => 'writing', 'done' => 1, 'total' => 11 );
	IE_Publisher::run_campaign( 'camp-1' );

	IE_Api::$reply = array( 'status' => 'writing', 'done' => 7, 'total' => 11 );
	IE_Publisher::run_campaign( 'camp-1' );

	same( 7, (int) stored_campaign()['writing_done'],
		'the count is frozen at its first value — it is being written only on the transition' );
} );

test( 'THE SPINNER CLOCK IS NOT RESTARTED BY A LATER POLL', function () {
	/* The opposite mistake, and it is why the two fields cannot simply be
	 * written together. writing_since caps how long the page keeps reloading
	 * itself; re-stamped on every poll, a job that dies silently leaves a tab
	 * spinning overnight. */
	seed();

	IE_Api::$reply = array( 'status' => 'writing', 'done' => 1, 'total' => 11 );
	IE_Publisher::run_campaign( 'camp-1' );

	$first = stored_campaign()['writing_since'];

	// Back-date it well past the ten-minute window, then poll again.
	$c                  = stored_campaign();
	$c['writing_since'] = '2001-01-01 00:00:00';
	IE_Campaigns::save( $c );

	IE_Api::$reply = array( 'status' => 'writing', 'done' => 2, 'total' => 11 );
	IE_Publisher::run_campaign( 'camp-1' );

	same( '2001-01-01 00:00:00', stored_campaign()['writing_since'],
		'writing_since was re-stamped on a later poll — the ten-minute cap now means nothing' );
	ok( '' !== $first, 'the first poll did not stamp it at all' );
} );

test( 'A MISSING TOTAL FALLS BACK TO THE SLOTS THIS SITE HOLDS', function () {
	/* An older server, or a job record that has not written its progress yet.
	 * total 0 is indistinguishable on screen from "nothing to do". */
	seed();
	IE_Api::$reply = array( 'status' => 'writing', 'done' => 0 );

	IE_Publisher::run_campaign( 'camp-1' );

	same( 11, (int) stored_campaign()['writing_total'],
		'no total arrived and none was worked out from the plan' );
} );

test( 'A NEGATIVE DONE IS FLOORED, NOT STORED', function () {
	seed();
	IE_Api::$reply = array( 'status' => 'writing', 'done' => -3, 'total' => 11 );

	IE_Publisher::run_campaign( 'camp-1' );

	same( 0, (int) stored_campaign()['writing_done'] );
} );

/* ===================================================================== */

echo "\nThe count goes away when the batch does\n";

test( 'A FINISHED BATCH CLEARS BOTH NUMBERS', function () {
	/* "11 of 11 written" would be true and still wrong. The card below it
	 * already reports what was written, and a progress line that never clears
	 * reads as a batch still running. */
	seed();

	IE_Api::$reply = array( 'status' => 'writing', 'done' => 11, 'total' => 11 );
	IE_Publisher::run_campaign( 'camp-1' );

	// 'written' is what the server says once the job is done. collect() is
	// not stubbed, so the run will fail after this point — the clearing has
	// to have happened before it, which is the ordering being asserted.
	IE_Api::$reply = array( 'status' => 'written' );
	try {
		IE_Publisher::run_campaign( 'camp-1' );
	} catch ( Throwable $e ) {
		// Expected: the collect path is deliberately not stubbed.
	}

	$c = stored_campaign();
	same( 0, (int) $c['writing_done'] );
	same( 0, (int) $c['writing_total'] );
	same( '', (string) $c['writing_since'] );
} );

test( 'A FAILED BATCH CLEARS THEM TOO', function () {
	seed();

	IE_Api::$reply = array( 'status' => 'writing', 'done' => 4, 'total' => 11 );
	IE_Publisher::run_campaign( 'camp-1' );

	IE_Api::$reply = array( 'status' => 'failed', 'error' => 'the model refused' );
	$out = IE_Publisher::run_campaign( 'camp-1' );

	ok( is_wp_error( $out ), 'a failed batch no longer reports an error' );

	$c = stored_campaign();
	same( 0, (int) $c['writing_done'], 'a failed batch leaves a count behind' );
	same( 0, (int) $c['writing_total'] );
} );

test( 'PAUSE CLEARS THE COUNT WHERE IT CLEARS THE SPINNER', function () {
	/* NOT a behavioural test, and the reason is worth stating: pause() sends
	 * a cancel, writes a status, and touches the posts — driving it here would
	 * need most of WordPress. What it has to be checked for is narrow: the two
	 * fields are zeroed in the SAME set_status() call that clears
	 * writing_since, because that call is the early clear, and anything
	 * written later would arrive up to an hour after the owner pressed Pause.
	 *
	 * Three posts written, Pause pressed, and the card saying "3 of 11
	 * written" is a promise that the other eight are coming. The 825-credit
	 * incident is what the screen and the batch disagreeing costs. */
	$src = code( 'class-ie-publisher.php' );

	$at = strpos( $src, "set_status( \$campaign_id, 'paused'" );
	ok( false !== $at, 'pause() no longer sets the status through set_status()' );

	$end = strpos( $src, ');', $at );
	ok( false !== $end, 'the set_status() call is unreadable' );

	$call = substr( $src, $at, $end - $at );

	ok( false !== strpos( $call, 'writing_since' ),
		'pause() no longer clears the spinner early' );
	ok( false !== strpos( $call, 'writing_done' ),
		'pause() clears the spinner but leaves the count — "3 of 11" beside a paused campaign' );
	ok( false !== strpos( $call, 'writing_total' ),
		'pause() leaves writing_total behind' );
} );

/* ===================================================================== */

echo "\nWhat is fit to print\n";

test( 'A SENSIBLE FRACTION IS SHOWN', function () {
	$p = IE_Campaigns::writing_progress( array( 'writing_done' => 4, 'writing_total' => 11 ) );
	same( true, $p['show'] );
	same( 4, $p['done'] );
	same( 11, $p['total'] );
} );

test( 'NOTHING HEARD YET IS NOT "0 OF 0"', function () {
	same( false, IE_Campaigns::writing_progress( array() )['show'],
		'a campaign with no numbers would render a fraction' );
	same( false, IE_Campaigns::writing_progress( array( 'writing_done' => 0, 'writing_total' => 0 ) )['show'] );
} );

test( 'A DONE ABOVE THE TOTAL IS NOT PRINTED', function () {
	/* Reachable from a version skew: a total from the campaign's slots and a
	 * done from a job that was given more. "7 of 4" beside a charge tells the
	 * owner the two sides disagree about their money. */
	same( false, IE_Campaigns::writing_progress( array( 'writing_done' => 7, 'writing_total' => 4 ) )['show'] );
} );

test( 'THE FIRST POST IS "0 OF 11", WHICH IS FINE', function () {
	/* Zero done is not the same as zero total. The batch has started, the
	 * owner has been charged for nothing yet, and the denominator is the
	 * answer to the question they are actually asking. */
	same( true, IE_Campaigns::writing_progress( array( 'writing_done' => 0, 'writing_total' => 11 ) )['show'] );
} );

test( 'STRINGS FROM THE OPTION TABLE ARE STILL NUMBERS', function () {
	/* Options come back from the database as whatever was put in, and a
	 * serialised round trip through an older version of this plugin can turn
	 * an int into a string. */
	$p = IE_Campaigns::writing_progress( array( 'writing_done' => '4', 'writing_total' => '11' ) );
	same( true, $p['show'] );
	same( 4, $p['done'], 'done is not an integer, so number_format_i18n would be fed a string' );
} );

test( 'A CAMPAIGN THAT IS NOT AN ARRAY DOES NOT FATAL', function () {
	same( false, IE_Campaigns::writing_progress( null )['show'] );
	same( false, IE_Campaigns::writing_progress( 'nonsense' )['show'] );
} );

/* ===================================================================== */

echo "\nThe card asks the one definition\n";

test( 'THE SPINNER LINE CALLS writing_progress()', function () {
	$src = code( 'class-ie-admin.php' );

	ok( false !== strpos( $src, 'IE_Campaigns::writing_progress(' ),
		'the card no longer asks for the progress at all' );
} );

test( 'THE CARD DOES NOT READ THE RAW FIELDS ITSELF', function () {
	/* The rule about what is fit to print lives in one place. A template that
	 * reads writing_done directly is a second copy of that rule, and the
	 * second copy is the one that will print "7 of 4". */
	$src = code( 'class-ie-admin.php' );

	ok( false === strpos( $src, "'writing_done'" ),
		'the template reads writing_done directly — the showable rule is now in two places' );
	ok( false === strpos( $src, "'writing_total'" ),
		'the template reads writing_total directly' );
} );

test( 'THE COUNT IS INSIDE THE BLOCK THAT ONLY RUNS WHILE WATCHING', function () {
	/* $watching is already false for a paused campaign, a finished one, and a
	 * batch older than ten minutes. Printing the count outside it would undo
	 * all three of those checks at once. */
	$src = code( 'class-ie-admin.php' );

	$at = strpos( $src, '$watching = $pending' );
	ok( false !== $at, 'the $watching test is gone or renamed' );

	$call = strpos( $src, 'IE_Campaigns::writing_progress(' );
	ok( false !== $call && $call > $at,
		'the progress is read before $watching is even worked out' );

	$reload = strpos( $src, 'window.location.reload' );
	ok( false !== $reload && $call < $reload,
		'the progress is read after the self-reload — it is outside the watching block' );
} );

echo "\n$passed passed, $failed failed\n";
exit( $failed ? 1 : 0 );
