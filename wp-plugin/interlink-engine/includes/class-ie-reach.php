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
	 * What to send the hosting company.
	 *
	 * NO IP ADDRESS, deliberately. The plugin does not know the server's
	 * address and should not pretend to: a hard-coded one goes stale the day
	 * the server moves, and a stale IP in a support ticket is worse than none
	 * — the host whitelists it, nothing improves, and everybody concludes the
	 * software is at fault.
	 *
	 * The path is the durable part, and it is what a host can actually act on.
	 */
	public static function ticket_text() {
		$home = function_exists( 'home_url' ) ? home_url( '/' ) : '';

		return sprintf(
			/* translators: 1: the site's own address */
			__(
				'My site %1$s uses an application that needs to reach it over the REST API. '
				. 'Requests to /wp-json/interlink/v1/ are being refused before WordPress sees them. '
				. 'Please allow them through — whitelisting that path, or the sending server, '
				. 'whichever your firewall supports.',
				'interlink-engine'
			),
			$home
		);
	}
}
