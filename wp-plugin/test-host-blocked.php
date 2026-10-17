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
function wp_parse_url( $url, $component = -1 ) { return parse_url( $url, $component ); }
function untrailingslashit( $s ) { return rtrim( (string) $s, '/' ); }

/* Transients, so the resolved address is not looked up on every page render.
 * Kept in the same array as the options, and reset by reset_state(). */
/* The loopback, under the test's control.
 *
 * $GLOBALS['ie_loopback'] is what wp_remote_get hands back: an array with a
 * code and a body, or a WP_Error stand-in. */
class IE_Test_Error {}

function rest_url( $path = '' ) { return 'http://site/wp-json/' . ltrim( (string) $path, '/' ); }
function admin_url( $p = '' ) { return 'http://site/wp-admin/' . $p; }
function is_wp_error( $thing ) { return $thing instanceof IE_Test_Error; }
function wp_remote_get( $url, $args = array() ) {
	$GLOBALS['ie_loopback_url'] = $url;
	return isset( $GLOBALS['ie_loopback'] ) ? $GLOBALS['ie_loopback'] : array( 'code' => 200, 'body' => '{"namespace":"interlink/v1"}' );
}
function wp_remote_retrieve_response_code( $r ) { return is_array( $r ) ? ( $r['code'] ?? 0 ) : 0; }
function wp_remote_retrieve_body( $r ) { return is_array( $r ) ? ( $r['body'] ?? '' ) : ''; }

function get_transient( $k ) {
	return array_key_exists( 't_' . $k, $GLOBALS['ie_options'] ) ? $GLOBALS['ie_options'][ 't_' . $k ] : false;
}
function set_transient( $k, $v, $ttl = 0 ) { $GLOBALS['ie_options'][ 't_' . $k ] = $v; return true; }

/* DNS, controlled by the test.
 *
 * PHP resolves gethostbyname() in the GLOBAL namespace before this file's,
 * so a plain redefinition here would collide with the real one. IE_Reach
 * calls it through function_exists(), and this file is the only thing in
 * the process, so overriding it is done by letting the real one run against
 * a hostname the test chooses — see the resolution tests below, which assert
 * behaviour rather than a particular address. */
function __( $s, $d = null ) { return $s; }
function _n( $one, $many, $n, $d = null ) { return 1 === (int) $n ? $one : $many; }

/* The real classes. A stub of a class you own is a copy that must be
 * maintained, and it will be forgotten — this project has paid for that
 * lesson twice. IE_Campaigns is required because IE_Reach asks it whether a
 * campaign is paused, and that one line is the whole of what is used. */
require_once __DIR__ . '/interlink-engine/includes/class-ie-campaigns.php';

/* IE_Settings, because the ticket now names where the requests come from and
 * that is read from the configured server URL. A stub of a class you own is a
 * copy that must be maintained, and this project has paid for that twice. */
require_once __DIR__ . '/interlink-engine/includes/class-ie-settings.php';
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

function reset_state() {
	$GLOBALS['ie_options'] = array();
	unset( $GLOBALS['ie_loopback'], $GLOBALS['ie_loopback_url'] );
}

/** What the site gets back when it calls its own REST route. */
function loopback( $code, $body ) { $GLOBALS['ie_loopback'] = array( 'code' => $code, 'body' => $body ); }
function loopback_fails() { $GLOBALS['ie_loopback'] = new IE_Test_Error(); }

/** Apache's own 404, which is what a missing rewrite block produces. */
const APACHE_404 = '<!doctype html><html lang="en"><head><title>404 Error</title></head><body>Not found</body></html>';

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

test( 'THE TICKET NAMES BOTH PATHS, THE METHOD AND THE SITE', function () {
	/* Written to be pasted whole by somebody who does not understand it, to
	 * somebody who will read it in thirty seconds.
	 *
	 * BOTH PATHS, because they are refused separately: /run collects the
	 * posts and /ping says there is work. A rule written for one leaves the
	 * other failing, and the symptom of each is "nothing happens".
	 *
	 * THE METHOD, because several of the products that cause this refuse
	 * POSTs while letting GETs through — so a host who tests the URL in a
	 * browser sees it working and closes the ticket. */
	reset_state();
	$text = IE_Reach::ticket_text();

	ok( false !== strpos( $text, 'POST' ), 'the ticket does not say which method is refused' );
	/* THE OPENING SENTENCE, not just the string anywhere in the ticket. Once
	 * the routes became full URLs they contained the site address too, so a
	 * loose search passed while the first line had lost it — and that line
	 * is the one telling a support agent whose site this is. Found by
	 * mutation. */
	ok( preg_match( '/^My site http:\/\/site\/ uses /m', $text ),
		"the ticket does not open by naming the site:\n$text" );

	/* WHOLE URLS, NOT FRAGMENTS. The person reading this is a support agent
	 * who wants to paste something into a browser. A path makes them go and
	 * find the domain themselves, on one of forty tickets that hour. */
	ok( false !== strpos( $text, 'http://site/wp-json/interlink/v1/run' ),
		"the ticket does not carry the full /run URL:\n$text" );
	ok( false !== strpos( $text, 'http://site/wp-json/interlink/v1/ping' ),
		'the ticket does not carry the full /ping URL' );

	/* AND THE PATH TOO, separately, because that is what a firewall RULE is
	 * written against. Two different questions, two lines. */
	ok( false !== strpos( $text, '(/wp-json/interlink/v1/)' ),
		'the ticket gives URLs but no path to write a rule against' );
} );

test( 'AND THE URLS ARE BUILT, NOT GLUED TOGETHER', function () {
	/* home_url('/') ends in a slash. Concatenating that with a path that
	 * starts with one gives 'http://site//wp-json/…', which plenty of
	 * servers answer with a redirect or a 404 — so the ticket would send a
	 * host chasing a URL that fails for a reason that is ours. */
	reset_state();
	$text = IE_Reach::ticket_text();

	ok( false === strpos( $text, '//wp-json' ),
		"the ticket contains a doubled slash:\n$text" );
} );

test( 'AND THE PATH IT NAMES IS THE ONE THE PLUGIN ACTUALLY REGISTERS', function () {
	/* The expensive kind of wrong. A ticket naming a path that does not
	 * exist gets whitelisted, nothing improves, and everybody concludes the
	 * software is at fault.
	 *
	 * Read from IE_Rest rather than typed again here, so a renamed namespace
	 * fails this instead of quietly making every future ticket useless. */
	$rest = file_get_contents( __DIR__ . '/interlink-engine/includes/class-ie-rest.php' );

	ok( preg_match( "/REST_NAMESPACE\s*=\s*'([^']+)'/", $rest, $m ),
		'the REST namespace could not be read' );

	reset_state();
	ok( false !== strpos( IE_Reach::ticket_text(), '/wp-json/' . $m[1] . '/' ),
		"the ticket names a path the plugin does not register — it registers {$m[1]}" );

	/* THE CONSTANT, NOT JUST THE RENDERED TEXT. REST_BASE is what both the
	 * URLs and the rule-writing path are built from, so it is the single
	 * thing that has to agree with IE_Rest. */
	same( '/wp-json/' . $m[1] . '/', IE_Reach::REST_BASE,
		'IE_Reach::REST_BASE and IE_Rest::REST_NAMESPACE disagree' );
} );

test( 'NO ADDRESS IS BAKED INTO THE SOURCE', function () {
	/* THE OLD RULE, AND IT SURVIVES. The ticket now carries a sending
	 * address because hosts ask for one, but it is RESOLVED at the moment
	 * the ticket is written, from the server URL this site is configured to
	 * talk to. A hard-coded one would go stale the day the server moves, and
	 * a stale IP in a support ticket is worse than none. */
	$src = file_get_contents( __DIR__ . '/interlink-engine/includes/class-ie-reach.php' );
	$src = preg_replace( '/\/\*[\s\S]*?\*\//', '', $src );

	ok( ! preg_match( '/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/', $src ),
		'an IP address is written into the plugin source' );
	/* THE CALL, NOT THE WORD. Searching for 'gethostbyname' matched the
	 * function_exists() guard, so replacing the actual lookup with the
	 * hostname itself passed this test — and every ticket would have gone
	 * out naming no address at all. Found by mutation. */
	ok( preg_match( '/gethostbyname\(\s*\$host\s*\)/', $src ),
		'the address is no longer resolved, so it comes from somewhere that can go stale' );
} );

test( 'A HOST THAT DOES NOT RESOLVE LEAVES THE SENDER LINE OUT', function () {
	/* gethostbyname RETURNS ITS ARGUMENT UNCHANGED when it fails, which is
	 * the trap: without the check, a ticket would tell a hosting company to
	 * whitelist the string "threecomets.com" as though it were an address.
	 *
	 * A ticket that says "they come from" and then nothing is worse than one
	 * that never mentions the sender. */
	reset_state();
	/* THROUGH IE_Settings::set(), NOT by poking an option.
	 *
	 * Every preference this plugin holds lives inside ONE option called
	 * `ie_settings`, as an array. Setting a top-level `server_url` — which
	 * is what the first version of this test did — writes a row nothing ever
	 * reads, so the code under test went on using the default, resolved it
	 * happily, and the assertion failed for a reason that had nothing to do
	 * with what it was testing. */
	IE_Settings::set( array( 'server_url' => 'https://this-host-does-not-exist.invalid' ) );

	same( '', IE_Reach::server_ip(), 'an unresolvable host produced an address' );

	$text = IE_Reach::ticket_text();

	ok( false === strpos( $text, 'resolves to' ),
		'the ticket claims an address it could not resolve' );
	ok( false !== strpos( $text, 'this-host-does-not-exist.invalid' ),
		'the hostname is not named either, so the host is told nothing about the sender' );
	ok( false !== strpos( $text, '/wp-json/interlink/v1/run' ),
		'the paths were lost along with the address' );
} );

test( 'and whatever it resolves IS an address', function () {
	/* The only property worth asserting without a DNS server under test
	 * control: if a value comes back at all, it parses as an IP. */
	reset_state();
	IE_Settings::set( array( 'server_url' => 'https://localhost' ) );

	$ip = IE_Reach::server_ip();

	ok( '' === $ip || false !== filter_var( $ip, FILTER_VALIDATE_IP ),
		"server_ip returned something that is not an address: $ip" );
} );

test( 'THE LOOKUP HAPPENS ONCE, NOT ON EVERY PAGE RENDER', function () {
	/* ticket_text() runs while an admin screen is rendering. A DNS lookup
	 * that hangs would hang the screen with it. */
	reset_state();
	IE_Settings::set( array( 'server_url' => 'https://localhost' ) );

	IE_Reach::server_ip();

	ok( array_key_exists( 't_' . IE_Reach::IP_CACHE, $GLOBALS['ie_options'] ),
		'the resolved address is not cached' );

	$GLOBALS['ie_options'][ 't_' . IE_Reach::IP_CACHE ] = '203.0.113.7';

	same( '203.0.113.7', IE_Reach::server_ip(), 'the cache is written and never read' );
	ok( false !== strpos( IE_Reach::ticket_text(), '203.0.113.7' ),
		'the ticket does not use the resolved address' );
} );

section( 'IS IT THE HOST, OR IS IT THIS SITE?' );

test( 'A SITE THAT CANNOT REACH ITS OWN REST API IS NOT BEING BLOCKED', function () {
	/* THE WHOLE POINT OF THIS SECTION. On 17 October the card said "your
	 * host appears to be blocking us" when the site's own .htaccess had lost
	 * its WordPress rewrite block. The ticket went to a hosting company that
	 * had done nothing wrong, support pasted our REST path into their image
	 * hotlink protection, and the real cause — every pretty URL on the site
	 * broken — went unnoticed for a week.
	 *
	 * Apache's 404 is HTML. WordPress answers JSON. That is the whole
	 * distinction, and the site can make it by itself. */
	reset_state();
	loopback( 404, APACHE_404 );

	same( IE_Reach::REST_BROKEN, IE_Reach::rest_self_test( true ),
		'a site serving Apache HTML on its own REST route was called healthy' );
} );

test( 'A 404 FROM WORDPRESS IS A PASS, NOT A FAILURE', function () {
	/* The trap in writing this check. An unknown route returns
	 * {"code":"rest_no_route"} with a 404 — and that is WordPress ANSWERING,
	 * which is exactly what is being tested. Judge it on the status code and
	 * every healthy site is told its links are broken. */
	reset_state();
	loopback( 404, '{"code":"rest_no_route","message":"No route was found"}' );

	same( IE_Reach::REST_OK, IE_Reach::rest_self_test( true ),
		'a JSON 404 from WordPress was read as a broken site' );
} );

test( 'and a healthy namespace passes', function () {
	reset_state();
	loopback( 200, '{"namespace":"interlink\/v1","routes":{}}' );

	same( IE_Reach::REST_OK, IE_Reach::rest_self_test( true ) );
} );

test( 'A LOOPBACK THAT CANNOT RUN BLAMES NOBODY', function () {
	/* Plenty of hosts block a site from calling itself. That tells us
	 * nothing about whether anyone ELSE can reach it — so folding this into
	 * either other answer would put us straight back to guessing, which is
	 * the thing being fixed. */
	reset_state();
	loopback_fails();

	same( IE_Reach::REST_UNKNOWN, IE_Reach::rest_self_test( true ) );

	reset_state();
	loopback( 0, '' );
	same( IE_Reach::REST_UNKNOWN, IE_Reach::rest_self_test( true ),
		'a request that never connected was read as a verdict' );
} );

test( 'it asks for OUR namespace, not just the REST root', function () {
	/* The root answering proves WordPress is handling /wp-json/. Our
	 * namespace answering proves that AND that the plugin's routes are
	 * registered — which matters on a site where an optimisation plugin has
	 * quietly deactivated us. */
	reset_state();
	IE_Reach::rest_self_test( true );

	ok( false !== strpos( $GLOBALS['ie_loopback_url'], 'interlink/v1' ),
		'the self-test does not ask for the plugin\'s own namespace: ' . $GLOBALS['ie_loopback_url'] );
} );

test( 'THE CHECK IS CACHED, because it is a network call on a page render', function () {
	reset_state();
	loopback( 200, '{"namespace":"interlink/v1"}' );
	IE_Reach::rest_self_test();

	ok( array_key_exists( 't_' . IE_Reach::SELF_CACHE, $GLOBALS['ie_options'] ),
		'the verdict is not cached, so every admin page load calls the site' );

	/* And it is READ, not merely written. */
	$GLOBALS['ie_options'][ 't_' . IE_Reach::SELF_CACHE ] = IE_Reach::REST_BROKEN;
	loopback( 200, '{"namespace":"interlink/v1"}' );

	same( IE_Reach::REST_BROKEN, IE_Reach::rest_self_test(),
		'the cache is written and never read' );

	same( IE_Reach::REST_OK, IE_Reach::rest_self_test( true ),
		'the cache cannot be bypassed, so a fixed site stays accused' );
} );

section( 'AND THE VERDICT ONLY APPEARS WHEN SOMETHING IS WRONG' );

test( 'a healthy campaign gets no verdict at all', function () {
	/* diagnosis() runs the silence rule FIRST. Without that, every site on
	 * earth would do a loopback request on every admin page load to answer a
	 * question nobody asked. */
	reset_state();
	IE_Reach::note_ring( JUST );
	loopback( 404, APACHE_404 );

	same( '', IE_Reach::diagnosis( waiting_campaign(), NOW ),
		'a site that was rung a minute ago is being diagnosed' );
	ok( ! isset( $GLOBALS['ie_loopback_url'] ),
		'the site called itself even though there was nothing wrong' );
} );

test( 'AND A STRANDED ONE GETS THE RIGHT VERDICT', function () {
	reset_state();
	IE_Reach::note_ring( LONG );
	loopback( 404, APACHE_404 );

	same( IE_Reach::REST_BROKEN, IE_Reach::diagnosis( waiting_campaign(), NOW ) );

	reset_state();
	IE_Reach::note_ring( LONG );
	loopback( 200, '{"namespace":"interlink/v1"}' );

	same( IE_Reach::REST_OK, IE_Reach::diagnosis( waiting_campaign(), NOW ) );
} );

section( 'What the screen does with it' );

test( 'THE HOST IS ONLY BLAMED WHEN THE SITE ANSWERS ITSELF', function () {
	/* The sentence that cost a support ticket. It must now be unreachable
	 * unless the self-test passed. */
	$admin = file_get_contents( __DIR__ . '/interlink-engine/includes/class-ie-admin.php' );

	ok( preg_match( '/REST_OK === \$verdict \) \{\s*\n\s*esc_html_e\( \'Your host appears to be blocking us/', $admin ),
		'the host-blocking sentence is not behind the REST_OK branch' );

	/* FOUND BY MUTATION. The check above only pinned the REST_OK branch, so
	 * disabling the REST_BROKEN test above it let a broken site fall through
	 * to "your host appears to be blocking us" — the exact sentence this
	 * whole change exists to stop showing. The broken branch has to come
	 * first and has to say something else. */
	/* THE CODE, NOT THE PROSE — and this is the ninth time this project has
	 * been caught by it. The first match for the blocking sentence was in
	 * the COMMENT above the branch explaining why it moved, which sits
	 * earlier in the file than any of the code. The ordering check then
	 * compared a comment against two statements and failed on a file that
	 * was perfectly correct.
	 *
	 * Anchored on esc_html_e(...) so only the rendered string can match. */
	$guard    = strpos( $admin, 'IE_Reach::REST_BROKEN === $verdict ) {' );
	$rebuild  = strpos( $admin, "esc_html_e( 'This site\\'s links need rebuilding." );
	$blocking = strpos( $admin, "esc_html_e( 'Your host appears to be blocking us." );

	ok( false !== $guard, 'the broken-site branch is gone from the headline' );
	ok( false !== $rebuild, 'a broken site is given no headline of its own' );
	ok( false !== $blocking, 'the host-blocking headline is gone entirely' );
	ok( $guard < $rebuild && $rebuild < $blocking,
		'a broken site falls through to the host-blocking headline' );
} );

test( 'and the ticket is only offered on that branch too', function () {
	/* Offering a support ticket to somebody whose own permalinks are broken
	 * is how the wrong thing gets whitelisted. */
	$admin = file_get_contents( __DIR__ . '/interlink-engine/includes/class-ie-admin.php' );

	$broken = strpos( $admin, 'REST_BROKEN === $verdict ) : ' );
	$ok     = strpos( $admin, 'REST_OK === $verdict ) : ' );
	$ticket = strpos( $admin, 'IE_Reach::ticket_text()' );

	ok( false !== $broken && false !== $ok && false !== $ticket, 'the branches could not be found' );
	ok( $ticket > $ok, 'the support ticket is offered before the host has been shown to be at fault' );
} );

test( 'THE BROKEN BRANCH NAMES THE SCREEN THAT FIXES IT', function () {
	/* "Regenerate your permalinks" is a sentence that means nothing to a
	 * business owner. A link to the page does. */
	$admin = file_get_contents( __DIR__ . '/interlink-engine/includes/class-ie-admin.php' );

	/* BOTH BRANCHES THAT RECOMMEND IT, counted. A presence check passed
	 * while one of the two links had been removed, because the other still
	 * matched — found by mutation. Saving permalinks is the advice in the
	 * broken case AND in the "could not tell" case, so both have to carry
	 * the link. */
	same( 2, substr_count( $admin, "admin_url( 'options-permalink.php' )" ),
		'one of the two Permalinks links is missing, so that branch names a screen it does not link' );
	ok( false !== strpos( $admin, 'not writable' ),
		'nothing tells the owner what it means when that page cannot save' );
} );

echo "\n$passed passed, $failed failed\n";
exit( $failed ? 1 : 0 );
