<?php
/**
 * Whether anybody is still ringing this site, and what to say if not.
 *
 * WHAT THIS IS FOR
 *
 * Posts are handed over when the server rings /wp-json/interlink/v1/run. That
 * is an INBOUND request to a customer's WordPress, and a large part of what
 * hosting companies sell is machinery for stopping exactly that. In one week
 * this project met two: mod_security answering 500 on one site, and a
 * Cloudflare challenge answering 403 on another — the second run by the host
 * themselves, on their own IP range, with no switch in cPanel and nothing the
 * site owner could turn off.
 *
 * Both times the symptom was a campaign card stuck on "0 of 22" and posts that
 * never arrived. Both times the cause was invisible from inside WordPress, and
 * diagnosing it took an SSH session against the server's logs.
 *
 * A customer cannot do that. They will email, or they will leave.
 *
 * THE SITE CAN WORK THIS OUT BY ITSELF. It knows when it was last rung,
 * because it is the thing being rung. If posts are waiting and the doorbell
 * has been silent for half an hour, something between us is eating the
 * requests — and the card can say so, in the place the owner is already
 * looking, without asking the server anything.
 *
 * ---------------------------------------------------------------------------
 * WHY THE RULE IS FIVE CONDITIONS AND NOT ONE
 *
 * "Nobody has rung in 30 minutes" is TRUE of a great many perfectly healthy
 * sites, because the server only rings when there is something to do:
 *
 *   a new site          no campaigns, nothing to ring about, silence is normal
 *   a finished campaign everything collected, ringing correctly stopped
 *   a paused campaign   the owner stopped it; we do not ring paused campaigns
 *   an unapproved plan  nothing has been written, nothing is owed
 *   UPGRADE DAY         the stamp below does not exist yet, so EVERY site in
 *                       the world looks like it has never been rung
 *
 * That last one is the dangerous one. Ship the naive rule and every customer
 * sees a firewall warning the morning they update the plugin — about a problem
 * none of them have. A warning nobody trusts is worse than no warning, because
 * the one time it is real they will ignore it too.
 *
 * So the clock runs from whichever is later: the last real ring, or the moment
 * this site first noticed it was waiting for one. On upgrade day the second
 * value is "now", the site is quiet for half an hour, and only then does it
 * speak — which is exactly right, because by then the silence is real.
 *
 * @package interlink-engine
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class IE_Reach {

	/** When the server last rang this site. Unix seconds. */
	const RUNG_OPTION = 'ie_last_rung';

	/**
	 * When this site first noticed it was waiting to be rung.
	 *
	 * NOT a duplicate of RUNG_OPTION. It is what makes upgrade day safe, and
	 * what lets a site that has NEVER been reachable — Edwin's, which has not
	 * received a single successful ping in its life — still work out that
	 * something is wrong. A rule that required a previous ring could never
	 * fire for the sites that need it most.
	 */
	const EXPECTING_OPTION = 'ie_expecting_since';

	/**
	 * How long silence has to last before it means something, in seconds.
	 *
	 * The server rings a site with a batch in flight every two minutes, so
	 * thirty is fifteen missed rings. Generous on purpose: a false alarm sends
	 * somebody to their hosting company about nothing, and spends credibility
	 * that cannot be bought back.
	 */
	const DEAF_AFTER = 1800;

	/**
	 * The server just rang. Called from the REST routes, both of them.
	 *
	 * /ping as well as /run, because they travel the same road: a firewall
	 * that eats one eats the other, and a /ping getting through is proof the
	 * road is open whatever /run happened to be doing.
	 */
	public static function note_ring( $now = null ) {
		$now = $now ? (int) $now : time();

		update_option( self::RUNG_OPTION, $now, false );

		/* CLEARED, so the next silence is measured from this ring rather than
		 * from whenever the site first started waiting. Without this the
		 * warning would appear thirty minutes after a campaign began and stay
		 * for ever, however well the ringing was going. */
		delete_option( self::EXPECTING_OPTION );

		return $now;
	}

	/**
	 * This site is waiting for a ring. Stamped once, not on every page load.
	 *
	 * Called from the Campaigns screen's own outbound poll, which already runs
	 * exactly when this is true: there is approved work with posts still to
	 * come. Re-stamping on every load would push the deadline forward for ever
	 * and the warning could never appear.
	 */
	public static function note_expecting( $now = null ) {
		$now = $now ? (int) $now : time();

		if ( self::expecting_since() ) {
			return self::expecting_since();
		}

		update_option( self::EXPECTING_OPTION, $now, false );

		return $now;
	}

	/** Unix seconds, or 0. */
	public static function last_ring() {
		return max( 0, (int) get_option( self::RUNG_OPTION, 0 ) );
	}

	/** Unix seconds, or 0. */
	public static function expecting_since() {
		return max( 0, (int) get_option( self::EXPECTING_OPTION, 0 ) );
	}

	/**
	 * Is this campaign waiting on a doorbell nobody is answering?
	 *
	 * ALL FIVE have to hold. Each one is a separate way to be wrong about a
	 * site that is perfectly healthy — see the note at the top of this file.
	 *
	 * @param array    $campaign
	 * @param int|null $now
	 * @return bool
	 */
	public static function unreachable( $campaign, $now = null ) {
		$now = $now ? (int) $now : time();

		if ( ! is_array( $campaign ) ) {
			return false;
		}

		// 1. Somebody approved it. An unapproved plan is owed nothing.
		if ( empty( $campaign['approved_at'] ) && empty( $campaign['batch_started'] ) ) {
			return false;
		}

		// 2. Not paused. The owner stopped the ringing themselves.
		if ( IE_Campaigns::is_paused( $campaign ) ) {
			return false;
		}

		// 3. Posts are actually waiting. A finished campaign has nothing to
		//    collect, so silence is the correct state and not a fault.
		$waiting = false;

		foreach ( (array) ( isset( $campaign['slots'] ) ? $campaign['slots'] : array() ) as $slot ) {
			if ( isset( $slot['status'] ) && 'pending' === $slot['status'] ) {
				$waiting = true;
				break;
			}
		}

		if ( ! $waiting ) {
			return false;
		}

		// 4. We know when the silence started. Zero means this site has never
		//    been rung AND has never noticed it was waiting — a brand new
		//    install, or the first page load after an upgrade. Nothing to say.
		//
		//    BELT AND BRACES AS THINGS STAND. The Campaigns screen stamps
		//    EXPECTING_OPTION through poll_now() before any card renders, so
		//    a card asking this question has always set the stamp a moment
		//    earlier. That is a fact about one caller, not about this rule,
		//    and the day something else asks — a dashboard widget, a notice,
		//    the block editor — it will ask without having stamped anything.
		$since = max( self::last_ring(), self::expecting_since() );

		if ( ! $since ) {
			return false;
		}

		// 5. And it has gone on long enough to mean something.
		return ( $now - $since ) >= self::DEAF_AFTER;
	}

	/**
	 * Whole minutes of silence, for the sentence.
	 *
	 * Rounded down, and never negative — a clock that went backwards must not
	 * produce "silent for -4 minutes" on a customer's screen.
	 */
	public static function silent_minutes( $now = null ) {
		$now   = $now ? (int) $now : time();
		$since = max( self::last_ring(), self::expecting_since() );

		if ( ! $since ) {
			return 0;
		}

		return max( 0, (int) floor( ( $now - $since ) / 60 ) );
	}

	/**
	 * Where the plugin's routes live, rooted at the site.
	 *
	 * ONE CONSTANT, because this string is now in the ticket twice — once
	 * inside each full URL and once on its own as the path to match. Written
	 * out three times it would be renamed in two of them, and the failure is
	 * silent: a host whitelists a path that does not exist, nothing improves,
	 * and everybody concludes the software is at fault.
	 *
	 * It mirrors IE_Rest::REST_NAMESPACE, and test-host-blocked.php reads
	 * that constant to prove the two still agree.
	 */
	const REST_BASE = '/wp-json/interlink/v1/';

	/** How long a resolved address is reused before looking it up again. */
	const IP_CACHE = 'ie_server_ip';
	const IP_TTL   = 21600;   // six hours

	/** The self-check's verdict, cached so it is not run on every page load. */
	const SELF_CACHE = 'ie_rest_selftest';
	const SELF_TTL   = 900;   // fifteen minutes

	/* What the site found when it called its own REST route.
	 *
	 *   REST_OK       the route answered. WordPress is handling /wp-json/.
	 *   REST_BROKEN   the route did not reach WordPress at all.
	 *   REST_UNKNOWN  the check itself could not run.
	 */
	const REST_OK      = 'ok';
	const REST_BROKEN  = 'broken';
	const REST_UNKNOWN = 'unknown';

	/**
	 * CAN THIS SITE REACH ITS OWN REST API?
	 *
	 * WHY THIS EXISTS, and it is the most expensive lesson in this file.
	 *
	 * On 17 October a campaign sat at "0 of 23" for hours and the card said
	 * "Your host appears to be blocking us." Edwin sent that to his hosting
	 * company. They had done nothing wrong: the site's own .htaccess had lost
	 * its WordPress rewrite block, so /wp-json/ was never reaching WordPress
	 * — and every pretty URL on that site was broken too, which nobody had
	 * noticed. Support tried to help and pasted our REST path into their
	 * image hotlink protection, where it could not possibly do anything.
	 *
	 * A five-second fix — Settings, Permalinks, Save — cost a support ticket,
	 * a week, and a wrong answer in somebody's config file.
	 *
	 * THE WARNING WAS GUESSING. It knew one fact — nobody has rung in 213
	 * minutes — and from inside WordPress, "a firewall is eating the
	 * requests" and "my own rewrite rules are broken" look identical. So it
	 * named the more dramatic one.
	 *
	 * IT DOES NOT HAVE TO GUESS. The plugin runs inside WordPress, which can
	 * ask itself. This is the same check WordPress core's Site Health does.
	 *
	 * THREE ANSWERS, NOT TWO. "Could not run the check" is its own verdict:
	 * plenty of hosts block loopback requests, and a site that cannot call
	 * itself has told us nothing about whether anyone else can reach it.
	 * Collapsing that into either of the other two would put us straight back
	 * to guessing, which is the thing being fixed.
	 *
	 * @param bool $fresh skip the cache — for a button that re-runs it
	 * @return string one of the REST_* constants
	 */
	public static function rest_self_test( $fresh = false ) {
		if ( ! $fresh && function_exists( 'get_transient' ) ) {
			$cached = get_transient( self::SELF_CACHE );
			if ( is_string( $cached ) && '' !== $cached ) {
				return $cached;
			}
		}

		$verdict = self::run_self_test();

		if ( function_exists( 'set_transient' ) ) {
			set_transient( self::SELF_CACHE, $verdict, self::SELF_TTL );
		}

		return $verdict;
	}

	/**
	 * The check itself, with no caching around it.
	 *
	 * ASKS FOR OUR OWN NAMESPACE, not the REST root. The root answering
	 * proves WordPress is handling /wp-json/; our namespace answering proves
	 * that AND that the plugin's routes are registered. One request, two
	 * facts, and the second one matters on a site where the plugin was
	 * deactivated by a well-meaning optimisation tool.
	 *
	 * A GET, DELIBERATELY. The real traffic is POSTs, and a host that refuses
	 * POSTs from strangers would still let this through — but this check is
	 * not trying to reproduce the block. It is answering one narrower
	 * question: does /wp-json/ reach WordPress at all? A GET answers that,
	 * and a POST here would be a write to our own API from our own site.
	 */
	private static function run_self_test() {
		if ( ! function_exists( 'rest_url' ) || ! function_exists( 'wp_remote_get' ) ) {
			return self::REST_UNKNOWN;
		}

		$url = rest_url( 'interlink/v1' );

		$response = wp_remote_get( $url, array(
			'timeout'   => 8,
			/* The site calling itself. A redirect here is usually http to
			 * https, which is fine and worth following — the question is
			 * whether WordPress answers, not how many hops it took. */
			'redirection' => 3,
			'sslverify' => false,
		) );

		if ( function_exists( 'is_wp_error' ) && is_wp_error( $response ) ) {
			/* The loopback itself failed — DNS, a firewall between the site
			 * and itself, a host that blocks them outright. Says nothing
			 * about whether anyone else can reach this site. */
			return self::REST_UNKNOWN;
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$body = (string) wp_remote_retrieve_body( $response );

		/* JSON IS THE WHOLE TEST, not the status code.
		 *
		 * 404 FROM WORDPRESS IS A PASS. An unknown route returns
		 * {"code":"rest_no_route"} with a 404 — and that is WordPress
		 * answering, which is exactly what is being checked. The failure
		 * looks like HTML: Apache serving its own error page because nothing
		 * rewrote the URL to index.php.
		 *
		 * So: did something that speaks JSON answer, or did something that
		 * speaks HTML? */
		$decoded = json_decode( $body, true );

		if ( is_array( $decoded ) ) {
			return self::REST_OK;
		}

		if ( 0 === $code ) {
			return self::REST_UNKNOWN;
		}

		return self::REST_BROKEN;
	}

	/**
	 * What the owner should be told, given everything the site knows.
	 *
	 * ONE FUNCTION DECIDES, so the card renders a verdict rather than
	 * computing one. The screen had the rule in it once; five conditions
	 * spread through a template is how a warning ends up firing on sites that
	 * are working perfectly.
	 *
	 * @return string '' when there is nothing to say, otherwise a REST_*
	 *                constant naming which message to show
	 */
	public static function diagnosis( $campaign, $now = null ) {
		if ( ! self::unreachable( $campaign, $now ) ) {
			return '';
		}

		return self::rest_self_test();
	}

	/**
	 * The address the server is reached at, RESOLVED NOW RATHER THAN STORED.
	 *
	 * THE OLD RULE WAS "NO IP IN THE TICKET", and the reasoning behind it was
	 * right: a hard-coded address goes stale the day the server moves, and a
	 * stale IP in a support ticket is worse than none — the host whitelists
	 * it, nothing improves, and everybody concludes the software is at fault.
	 *
	 * What changed is not the reasoning, it is the method. Edwin, 17 October,
	 * after a host asked for one: the ticket has to carry a source address,
	 * because "whitelist this path" is a thing many firewalls cannot do and
	 * "whitelist this sender" is a thing all of them can.
	 *
	 * So it is DERIVED, not written down. The host comes out of the server
	 * URL this site is configured to talk to, and it is resolved when the
	 * ticket is generated. Move the server and change the DNS and the next
	 * ticket carries the new address with nobody editing anything. There is
	 * no copy of it anywhere to go out of date.
	 *
	 * HONEST ABOUT WHAT IT IS. This is the address the server ANSWERS on,
	 * which is not guaranteed to be the one it sends from — today they are
	 * the same machine, and tomorrow is not promised. The ticket says
	 * "currently resolves to" rather than asserting it, so a host who finds
	 * it does not match sees a hint rather than a contradiction.
	 *
	 * Cached, because this runs while an admin page is rendering and a DNS
	 * lookup that hangs would hang the screen with it.
	 *
	 * @return string the address, or '' if it cannot be resolved
	 */
	public static function server_ip() {
		$host = self::server_host();
		if ( '' === $host ) {
			return '';
		}

		$cached = function_exists( 'get_transient' ) ? get_transient( self::IP_CACHE ) : false;
		if ( is_string( $cached ) ) {
			return $cached;
		}

		$ip = '';

		if ( function_exists( 'gethostbyname' ) ) {
			$found = gethostbyname( $host );

			/* gethostbyname RETURNS ITS ARGUMENT UNCHANGED ON FAILURE, which
			 * is the trap: without the first check a ticket would cheerfully
			 * tell a hosting company to whitelist the string "threecomets.com"
			 * as though it were an address.
			 *
			 * THE filter_var IS BELT AND BRACES AND NO TEST CAN KILL IT,
			 * which is said here rather than left for somebody to rediscover
			 * by mutation. gethostbyname only ever answers with an address or
			 * with its own argument, so the first check already covers every
			 * case that exists today. It stays because this value is pasted
			 * into a stranger's firewall rule, and "it cannot happen" is a
			 * worse guarantee than one line. */
			if ( $found !== $host && filter_var( $found, FILTER_VALIDATE_IP ) ) {
				$ip = $found;
			}
		}

		if ( function_exists( 'set_transient' ) ) {
			set_transient( self::IP_CACHE, $ip, self::IP_TTL );
		}

		return $ip;
	}

	/** The host this site is configured to talk to, without the scheme. */
	public static function server_host() {
		if ( ! class_exists( 'IE_Settings' ) ) {
			return '';
		}

		$url = (string) IE_Settings::server_url();
		if ( '' === $url ) {
			return '';
		}

		$host = function_exists( 'wp_parse_url' )
			? wp_parse_url( $url, PHP_URL_HOST )
			: parse_url( $url, PHP_URL_HOST );

		return is_string( $host ) ? $host : '';
	}

	/**
	 * What to send the hosting company.
	 *
	 * WRITTEN TO BE PASTED WHOLE. The person sending it is a business owner
	 * forwarding something they do not understand to somebody who will read
	 * it in thirty seconds, so it names every fact that ticket needs and
	 * nothing else: the site, the method, the exact paths, and where the
	 * requests come from.
	 *
	 * BOTH ROUTES, because they are refused separately. /run is how posts are
	 * collected and /ping is how the site is told there is work — a firewall
	 * rule written for one of them leaves the other failing, and the symptom
	 * of each is "nothing happens".
	 *
	 * FULL URLS, NOT PATHS — Edwin, 17 October, and he was right. A path is
	 * what a firewall RULE is written against, but the person reading the
	 * ticket is a support agent who wants to paste something into a browser
	 * and see what happens. Giving them a fragment makes them go and find
	 * the domain themselves, on a ticket that may be one of forty that hour.
	 *
	 * So it carries both: the whole URL to test, and the path to match on.
	 * They cost two lines between them and they answer different questions.
	 *
	 * THE METHOD IS NAMED. Several of the products that cause this refuse
	 * POSTs from strangers while letting GETs through, so a host who tests
	 * the URL in a browser sees it working and closes the ticket.
	 */
	public static function ticket_text() {
		$home = function_exists( 'home_url' ) ? home_url( '/' ) : '';
		$host = self::server_host();
		$ip   = self::server_ip();

		/* BUILT FROM home_url(), not pasted together from $home.
		 *
		 * home_url('/') ends in a slash and home_url('/wp-json/…') does not
		 * double it — concatenating the two by hand gives
		 * 'https://site//wp-json/…', which plenty of servers answer with a
		 * redirect or a 404. The ticket would then send a host chasing a URL
		 * that fails for a reason that is ours. */
		$run  = function_exists( 'home_url' ) ? home_url( self::REST_BASE . 'run' ) : self::REST_BASE . 'run';
		$ping = function_exists( 'home_url' ) ? home_url( self::REST_BASE . 'ping' ) : self::REST_BASE . 'ping';

		$lines = array(
			sprintf(
				/* translators: 1: the site's own address */
				__( 'My site %1$s uses an application that reaches it over the WordPress REST API.', 'interlink-engine' ),
				$home
			),
			'',
			__( 'POST requests to these URLs are being refused before WordPress sees them:', 'interlink-engine' ),
			'',
			'    ' . $run,
			'    ' . $ping,
			'',
		);

		/* THE SENDER LINE IS OMITTED RATHER THAN GUESSED AT. A ticket that
		 * says "they come from" and then nothing is worse than one that does
		 * not mention the sender at all. */
		if ( '' !== $host && '' !== $ip ) {
			$lines[] = sprintf(
				/* translators: 1: hostname, 2: IP address */
				__( 'They come from %1$s, which currently resolves to %2$s.', 'interlink-engine' ),
				$host,
				$ip
			);
			$lines[] = '';
		} elseif ( '' !== $host ) {
			$lines[] = sprintf(
				/* translators: 1: hostname */
				__( 'They come from %1$s.', 'interlink-engine' ),
				$host
			);
			$lines[] = '';
		}

		/* THE PATH AS WELL AS THE URLS. A rule is written against a path; a
		 * test is run against a URL. The ticket gives both rather than
		 * making somebody derive one from the other. */
		$lines[] = sprintf(
			/* translators: 1: the REST path, e.g. /wp-json/interlink/v1/ */
			__(
				'Please allow them through — by URL, by path (%1$s), or by sending address, '
				. 'whichever your firewall supports.',
				'interlink-engine'
			),
			self::REST_BASE
		);

		return implode( "\n", $lines );
	}
}
