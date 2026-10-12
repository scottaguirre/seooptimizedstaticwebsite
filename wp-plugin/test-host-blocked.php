<?php
/**
 * test-host-blocked.php
 *
 * When the site may say "your host is blocking us", and — mostly — when it
 * may not.
 *
 * WHAT THIS IS GUARDING
 *
 * Posts reach a customer's WordPress on an INBOUND request, and a large part
 * of what hosting companies sell is machinery for stopping those. Two in one
 * week: mod_security answering 500 on one site, a host-run Cloudflare
 * challenge answering 403 on another. Both times the card said "0 of 22" and
 * nothing else; both times diagnosis needed an SSH session against the
 * server's logs. A customer cannot do that.
 *
 * So the site works it out itself. The danger is the opposite failure.
 *
 * "NOBODY HAS RUNG IN 30 MINUTES" IS TRUE OF HEALTHY SITES — a new install, a
 * finished campaign, a paused one, an unapproved plan, and most dangerously
 * every site in the world on the morning it upgrades, because the stamp this
 * rule reads does not exist until 0.43.0 creates it. Ship the naive version
 * and every customer is told their host is broken on upgrade day.
 *
 * A warning nobody trusts is worse than no warning: the one time it is real
 * they ignore that too. So most of this file is about SILENCE.
 *
 *   php wp-plugin/test-host-blocked.php
 */

error_reporting( E_ALL );

define( 'ABSPATH', '/tmp/' );

/* --------------------------------------------------------------------
 * Just enough WordPress
 * ----------------------------------------------------------------- */

$GLOBALS['ie_options'] = array();

function get_option( $k, $d = null ) {
	return array_key_exists( $k, $GLOBALS['ie_options'] ) ? $GLOBALS['ie_options'][ $k ] : $d;
}
function update_option( $k, $v, $autoload = null ) { $GLOBALS['ie_options'][ $k ] = $v; return true; }
function delete_option( $k ) { unset( $GLOBALS['ie_options'][ $k ] ); return true; }
function home_url( $p = '' ) { return 'http://site' . $p; }
function __( $s, $d = null ) { return $s; }
function _n( $one, $many, $n, $d = null ) { return 1 === (int) $n ? $one : $many; }

/* The real classes. A stub of a class you own is a copy that must be
 * maintained, and it will be forgotten — this project has paid for that
 * lesson twice. IE_Campaigns is required because IE_Reach asks it whether a
 * campaign is paused, and that one line is the whole of what is used. */
require_once __DIR__ . '/interlink-engine/includes/class-ie-campaigns.php';
require_once __DIR__ . '/interlink-engine/includes/class-ie-reach.php';

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

const NOW  = 1800000000;
const LONG = NOW - 4000;   // well past DEAF_AFTER
const JUST = NOW - 60;     // a minute ago

/** A campaign that SHOULD warn, if the site has also gone quiet. */
function waiting_campaign() {
	return array(
		'id'            => 'c1',
		'status'        => 'active',
		'approved_at'   => '2026-10-12 09:00:00',
		'batch_started' => '2026-10-12 09:00:00',
		'slots'         => array(
			array( 'index' => 0, 'status' => 'pending' ),
			array( 'index' => 1, 'status' => 'scheduled' ),
		),
	);
}

function reset_state() { $GLOBALS['ie_options'] = array(); }

/* ================================================================== */

section( 'It speaks when it should' );

test( 'posts waiting and a long silence', function () {
	reset_state();
	IE_Reach::note_ring( LONG );

	ok( IE_Reach::unreachable( waiting_campaign(), NOW ),
		'a batch stranded for over an hour said nothing' );
} );

test( 'A SITE NEVER ONCE REACHED STILL WORKS IT OUT', function () {
	/* THE CASE THAT MATTERS MOST, and the one a "must have been rung before"
	 * rule would never fire for. Edwin's site has not received a single
	 * successful ping in its life — the Cloudflare challenge has been there
	 * from the start. The clock therefore cannot run only from the last ring;
	 * it runs from whenever this site first noticed it was waiting. */
	reset_state();
	IE_Reach::note_expecting( LONG );

	same( 0, IE_Reach::last_ring(), 'the fixture accidentally recorded a ring' );
	ok( IE_Reach::unreachable( waiting_campaign(), NOW ),
		'a site that has never been reachable can never say so' );
} );

section( 'And stays quiet when it should' );

test( 'a brand new site says nothing', function () {
	/* No campaigns have run, nothing has been rung, nothing has noticed it is
	 * waiting. The server only rings when there is work, so silence here is
	 * the correct and expected state. */
	reset_state();

	ok( ! IE_Reach::unreachable( waiting_campaign(), NOW ),
		'a site with no history at all announced a firewall problem' );
} );

test( 'UPGRADE DAY SAYS NOTHING', function () {
	/* THE ONE THAT WOULD HAVE EMBARRASSED US IN FRONT OF EVERY CUSTOMER AT
	 * ONCE. Both stamps are new in 0.43.0, so on the first page load after an
	 * update every site on earth has neither — which is indistinguishable
	 * from "has never been rung" unless the rule says otherwise.
	 *
	 * The campaign here is deliberately old: approved days ago, posts still
	 * pending. Everything about it looks stranded. It must still say nothing,
	 * because the SITE has not been watching, we have. */
	reset_state();

	$old = waiting_campaign();
	$old['approved_at']   = '2026-10-01 09:00:00';
	$old['batch_started'] = '2026-10-01 09:00:00';

	ok( ! IE_Reach::unreachable( $old, NOW ),
		'every customer is told their host is broken the morning they upgrade' );
} );

test( 'and it starts counting from that first load, not from the campaign', function () {
	/* The other half of upgrade day: having said nothing, the site must then
	 * start a clock of its own — otherwise a genuinely blocked site that
	 * upgraded would stay silent for ever. */
	reset_state();
	IE_Reach::note_expecting( NOW );

	ok( ! IE_Reach::unreachable( waiting_campaign(), NOW + 60 ),
		'it spoke one minute after first noticing' );
	ok( IE_Reach::unreachable( waiting_campaign(), NOW + 2000 ),
		'having waited, it never spoke at all' );
} );

test( 'a recent ring says nothing', function () {
	reset_state();
	IE_Reach::note_ring( JUST );

	ok( ! IE_Reach::unreachable( waiting_campaign(), NOW ),
		'a site rung a minute ago is reporting a blocked host' );
} );

test( 'a finished campaign says nothing', function () {
	/* Everything collected, so there is nothing left to ring about and the
	 * ringing correctly stopped. Warning here would mean every campaign ends
	 * by accusing the customer's host. */
	reset_state();
	IE_Reach::note_ring( LONG );

	$done = waiting_campaign();
	$done['slots'] = array(
		array( 'index' => 0, 'status' => 'published' ),
		array( 'index' => 1, 'status' => 'scheduled' ),
	);

	ok( ! IE_Reach::unreachable( $done, NOW ),
		'a campaign with nothing left to fetch is blaming the host' );
} );

test( 'a paused campaign says nothing', function () {
	reset_state();
	IE_Reach::note_ring( LONG );

	$paused = waiting_campaign();
	$paused['status'] = 'paused';

	ok( ! IE_Reach::unreachable( $paused, NOW ),
		'the owner stopped it themselves and is being told their host did' );
} );

test( 'a campaign nobody approved says nothing', function () {
	reset_state();
	IE_Reach::note_ring( LONG );

	$draft = waiting_campaign();
	$draft['approved_at']   = '';
	$draft['batch_started'] = '';

	ok( ! IE_Reach::unreachable( $draft, NOW ),
		'a plan nobody paid for is reporting undelivered posts' );
} );

test( 'junk is not a campaign', function () {
	reset_state();
	IE_Reach::note_ring( LONG );

	ok( ! IE_Reach::unreachable( null, NOW ), 'null warned' );
	ok( ! IE_Reach::unreachable( array(), NOW ), 'an empty array warned' );
} );

section( 'The stamps' );

test( 'A RING CLEARS THE WAITING STAMP', function () {
	/* Without this the two clocks race and the older one wins for ever: the
	 * site would start waiting, be rung perfectly well every two minutes, and
	 * still announce a blocked host thirty minutes later — permanently, since
	 * nothing would ever reset it. */
	reset_state();
	IE_Reach::note_expecting( LONG );
	IE_Reach::note_ring( JUST );

	same( 0, IE_Reach::expecting_since(), 'the waiting stamp survived a real ring' );
	ok( ! IE_Reach::unreachable( waiting_campaign(), NOW ),
		'a site being rung every two minutes still says it is being blocked' );
} );

test( 'the waiting stamp does not move once set', function () {
	/* Re-stamping on every page load would push the deadline forward for ever
	 * and the warning could never appear on a site somebody is watching —
	 * which is precisely the site they are watching BECAUSE it is stuck. */
	reset_state();
	IE_Reach::note_expecting( LONG );
	IE_Reach::note_expecting( NOW );

	same( LONG, IE_Reach::expecting_since(), 'the clock restarted on the second page load' );
} );

section( 'What it prints' );

test( 'the silence is counted in whole minutes', function () {
	reset_state();
	IE_Reach::note_ring( NOW - 3600 );

	same( 60, IE_Reach::silent_minutes( NOW ) );
} );

test( 'and never goes negative', function () {
	/* A clock that moved backwards — a host correcting NTP, a timezone change
	 * written into an option — must not put "silent for -4 minutes" in front
	 * of a customer. */
	reset_state();
	IE_Reach::note_ring( NOW + 500 );

	same( 0, IE_Reach::silent_minutes( NOW ) );
} );

test( 'THE TICKET NAMES THE PATH AND NOT AN IP', function () {
	/* The plugin does not know the server's address and must not pretend to.
	 * A hard-coded IP goes stale the day the server moves, and a stale IP in
	 * a support ticket is worse than none: the host whitelists it, nothing
	 * improves, and everyone concludes the software is at fault. */
	$text = IE_Reach::ticket_text();

	ok( false !== strpos( $text, '/wp-json/interlink/v1/' ),
		'the ticket does not say which path to allow' );
	ok( ! preg_match( '/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/', $text ),
		'an IP address is baked into the ticket text' );
	ok( false !== strpos( $text, 'http://site' ),
		'the ticket does not say which site it is about' );
} );

echo "\n$passed passed, $failed failed\n";
exit( $failed ? 1 : 0 );
