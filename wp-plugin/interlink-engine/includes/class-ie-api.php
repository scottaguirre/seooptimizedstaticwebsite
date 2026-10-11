<?php
/**
 * Calls out to the server.
 *
 *   activate   licence key -> a site id and a signing secret        (unsigned)
 *   suggest    keyword -> topic ideas                               (free)
 *   enrich     the owner's own topics -> the fields planning needs  (free)
 *   plan       topics -> a saved draft: ring, anchors, dates        (free)
 *   write      approve the draft; write every post   <- costs credits
 *   collect    take the written posts                               (free)
 *   complete   report what WordPress scheduled
 *   published  report what WordPress later made public
 *
 * WRITE AND COLLECT ARE SEPARATE CALLS, AND write() DOES NOT BLOCK
 *
 * A campaign of twelve posts takes minutes to write. There is no HTTP timeout
 * that covers that — not WordPress's, not the host's, not whatever proxy sits
 * in front of either — so write() asks once and returns whatever the server
 * says. If the answer is 'writing', this side comes back later: on the next
 * server ping, or on the catch-up cron. Polling in a loop inside one request
 * is how a plugin ends up killed by a 30-second PHP limit half way through
 * something the customer has already paid for.
 *
 * AUTHENTICATION
 *
 * Only /activate carries the licence key, because until it succeeds there is
 * no secret to sign with. Everything after that is signed — the key is never
 * transmitted again, so it does not sit in this site's logs, any proxy in
 * between, or the server's access log.
 *
 * THE ENCODE-ONCE RULE
 *
 * The signature covers the exact bytes of the body. post() encodes the payload
 * into $body, signs $body, and sends $body. If anything ever re-encodes
 * between those steps — a filter, a "helpful" refactor passing the array
 * instead — the signature describes a body that was never sent and every
 * request fails with no clue why.
 *
 * Everything here fails soft and returns a WP_Error. A generation that cannot
 * reach the server must leave the campaign exactly as it was, so the catch-up
 * run can try again rather than half-writing a slot.
 *
 * @package interlink-engine
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class IE_Api {

	const TIMEOUT_DEFAULT = 20;

	/** Topic calls are model calls: slower than a fetch, faster than writing. */
	const TIMEOUT_TOPICS = 100;

	/**
	 * /write returns immediately — it enqueues a batch and answers 'writing'.
	 * This is the timeout for that one call, not for the writing itself.
	 */
	const TIMEOUT_WRITE = 30;

	/**
	 * /collect returns finished posts, so the body can be large — five posts of
	 * 900 words each. Slower than a status check, nowhere near a model call.
	 */
	const TIMEOUT_COLLECT = 45;

	/**
	 * Send a signed request.
	 *
	 * @param string $path   e.g. '/api/blog/generate'
	 * @param array  $body
	 * @param int    $timeout
	 * @return array|WP_Error
	 */
	private static function post( $path, $body, $timeout = self::TIMEOUT_DEFAULT ) {
		$site_id = IE_Settings::site_id();
		$secret  = IE_Settings::secret();

		if ( '' === $site_id || '' === $secret ) {
			return new WP_Error(
				'ie_not_connected',
				'This site is not connected. Paste your licence key on the Connection screen.'
			);
		}

		// Encoded ONCE. This exact string is signed and sent; see the note above.
		$payload = wp_json_encode( (array) $body );

		if ( false === $payload ) {
			return new WP_Error( 'ie_encode', 'Could not encode the request.' );
		}

		$timestamp = (string) time();
		$signature = IE_Signing::sign( $secret, $timestamp, 'POST', $path, $payload );

		return self::send( IE_Settings::server_url() . $path, $payload, $timeout, array(
			'X-IL-Site'      => $site_id,
			'X-IL-Timestamp' => $timestamp,
			'X-IL-Signature' => $signature,
		) );
	}

	/**
	 * The transport, shared by signed and unsigned calls.
	 */
	private static function send( $url, $payload, $timeout, $extra_headers = array() ) {
		$response = wp_remote_post( $url, array(
			'timeout' => $timeout,
			'headers' => array_merge( array(
				'Content-Type' => 'application/json',
				'Accept'       => 'application/json',
				'X-IE-Version' => IE_VERSION,
				/* WHICH SITE IS SPEAKING.
				 *
				 * Not a credential and not signed — anyone can claim anything
				 * here. Its job is to catch an ACCIDENT, not an attacker: one
				 * licence key pasted into two WordPress sites, or, far more
				 * easily, a site cloned while the plugin was connected, which
				 * copies the id and secret out of wp_options without anyone
				 * typing a thing.
				 *
				 * The server compares it to the domain the licence is
				 * registered to and refuses a mismatch, so the second site is
				 * told plainly instead of the first one dying in silence. */
				'X-IL-Site-Url' => home_url(),
			), $extra_headers ),
			'body'    => $payload,
		) );

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$code = wp_remote_retrieve_response_code( $response );
		$raw  = wp_remote_retrieve_body( $response );
		$data = json_decode( $raw, true );

		if ( $code < 200 || $code >= 300 ) {
			// Prefer the server's own wording: it knows whether this is an
			// expired licence, an exhausted balance or a bad request, and the
			// owner needs to be told which.
			$message = is_array( $data ) && ! empty( $data['error'] )
				? $data['error']
				: sprintf( 'Server returned %d', $code );

			/* "NOT AUTHORISED" IS NOT A MESSAGE, IT IS A SHRUG.
			 *
			 * The server is deliberately vague about WHY a signature failed —
			 * saying whether the site id was unknown, the signature wrong or
			 * the clock skewed would hand an attacker a debugging tool, and
			 * that is the right call. But the owner of this site is not an
			 * attacker, and for them the vagueness is the whole problem.
			 *
			 * On a real site this exact string was all anyone saw while every
			 * call failed for eight days. The cause was ordinary — the
			 * licence key had been used on a second WordPress, which issues a
			 * fresh secret and leaves this one holding a dead key — and the
			 * fix is one paste. Neither was guessable from "Not authorised".
			 *
			 * So the plugin, which knows it is connected and is not a
			 * stranger, says the useful thing. */
			if ( in_array( (int) $code, array( 401, 403 ), true )
				&& ( ! is_array( $data ) || empty( $data['reason'] ) || 'bad-signature' === $data['reason'] ) ) {
				$message = __(
					'This site\'s connection is no longer valid. This usually means the licence key '
					. 'has since been used on another WordPress site, which disconnects this one. '
					. 'Paste your licence key again on the Connection screen to reconnect — or, if the '
					. 'other site should keep working, create a second key on your account page.',
					'interlink-engine'
				);
			}

			// The whole decoded body travels with the error, not just the
			// status. The server sends structured detail alongside its
			// message — creditsError and buyCreditsUrl on a 402, for one —
			// and throwing it away here is what left a customer looking at
			// "you need 900 credits and have 0" with nothing on the screen
			// telling them where credits come from.
			return new WP_Error( 'ie_api', $message, array(
				'status' => $code,
				'body'   => $raw,
				'data'   => is_array( $data ) ? $data : array(),
			) );
		}

		if ( ! is_array( $data ) ) {
			return new WP_Error( 'ie_api', 'Server returned a response this plugin could not read.' );
		}

		return $data;
	}

	/* --------------------------------------------------------------------
	 * Activation
	 * ----------------------------------------------------------------- */

	/**
	 * Exchange the licence key for a site id and a signing secret.
	 *
	 * The only unsigned call, because there is nothing to sign with yet.
	 *
	 * THE SERVER URL IS NOT SAVED UNTIL THIS SUCCEEDS.
	 *
	 * It used to be written to the options table first, before the request was
	 * even sent. So a mistyped address failed to activate AND was kept — the
	 * site ended up disconnected and pointed somewhere that does not answer,
	 * from one press of a button. The address is now used for this attempt and
	 * only persisted once the far end has proved it is really the server.
	 */
	public static function activate( $licence_key, $server_url = '', $moving = false ) {
		$target = $server_url ? untrailingslashit( $server_url ) : IE_Settings::server_url();

		$payload = wp_json_encode( array(
			'licenceKey'  => $licence_key,
			'siteUrl'     => home_url(),
			/* SAYS OUT LOUD THAT THIS WILL DISCONNECT ANOTHER SITE.
			 *
			 * The server refuses a key already registered to a different
			 * domain unless this is true. It is not a security measure —
			 * anyone can set it — it exists so that taking a licence off a
			 * working site is a thing somebody CHOSE rather than a thing that
			 * happened to them. Without it the act is silent, instant and
			 * irreversible, and the site that loses the licence finds out
			 * days later, if at all. */
			'moveSite'    => (bool) $moving,
			'themePrefix' => IE_Settings::active_theme_prefix(),
			'timezone'    => wp_timezone_string(),
			/* THROUGH THE SHARED MAPPER, not translated here.
			 *
			 * This block used to be the only correct translation in the file,
			 * and being correct here is what hid the other two being wrong:
			 * activation set a plausible business on the server, so nothing
			 * downstream ever looked empty. See IE_Settings::business_payload().
			 *
			 * businessFields SAYS WHICH OF THOSE BLANKS ARE REAL, and it earns
			 * its place on this call more than on the other two: activation is
			 * the moment a rebuilt site would otherwise inherit the previous
			 * occupant's trade and town from the record its licence belongs to.
			 * See IE_Settings::business_fields(). */
			'business'       => IE_Settings::business_payload(),
			'businessFields' => IE_Settings::business_fields(),
		) );

		$result = self::send(
			$target . '/api/blog/activate',
			$payload,
			self::TIMEOUT_DEFAULT
		);

		if ( is_wp_error( $result ) ) {
			// Clear whatever was stored. Leaving a rejected key behind makes
			// the Connection screen claim a connection that does not exist.
			//
			// The server URL is deliberately NOT written here — a failed
			// attempt should leave the site exactly as it was, still pointed
			// at the address that used to work.
			IE_Settings::set( array( 'site_id' => '', 'secret' => '' ) );
			return $result;
		}

		if ( empty( $result['siteId'] ) || empty( $result['secret'] ) ) {
			IE_Settings::set( array( 'site_id' => '', 'secret' => '' ) );
			return new WP_Error( 'ie_api', 'The server did not return a site id and secret.' );
		}

		IE_Settings::set( array(
			// Saved now, not before the request: the far end has just proved
			// it is really the server by issuing a working secret.
			'server_url'       => $target,
			'site_id'          => sanitize_text_field( $result['siteId'] ),
			'secret'           => sanitize_text_field( $result['secret'] ),
			'credits'          => isset( $result['credits'] ) ? (int) $result['credits'] : null,
			'credits_per_post' => isset( $result['creditsPerPost'] ) ? (int) $result['creditsPerPost'] : null,
			// NOT stored. It has done its job and the server keeps only a hash;
			// holding it here would be the one copy in plaintext anywhere.
			'licence_key'      => '',
		) );

		return $result;
	}

	/* --------------------------------------------------------------------
	 * Topics — free, rate limited on the server
	 * ----------------------------------------------------------------- */

	public static function suggest( $target_page, $count = 6, $avoid = array() ) {
		return self::post( '/api/blog/suggest', array(
			'targetPage' => $target_page,
			'count'      => (int) $count,
			'avoid'      => array_values( (array) $avoid ),
		), self::TIMEOUT_TOPICS );
	}

	public static function enrich( $target_page, $topics, $existing = array() ) {
		return self::post( '/api/blog/enrich', array(
			'targetPage' => $target_page,
			'topics'     => array_values( (array) $topics ),
			'existing'   => array_values( (array) $existing ),
		), self::TIMEOUT_TOPICS );
	}

	/* --------------------------------------------------------------------
	 * Planning
	 * ----------------------------------------------------------------- */

	/**
	 * Topics in, finished campaign out.
	 *
	 * The server computes the ring, the anchor allocation, the slugs and the
	 * publish dates, and STORES the campaign — it has to, because it is the
	 * side that charges. What comes back is the id to refer to it by.
	 *
	 * @param array $payload targetPage, topics, schedule, linkMode, name
	 */
	public static function plan( $payload ) {
		/* THE BUSINESS RIDES WITH THE PLAN, and it had to start doing so.
		 *
		 * The server stores `site.business` at LICENCE ACTIVATION and never
		 * again — one write, in the activation handler, and one read, here at
		 * planning. So a site that changed its Business Name in Theme
		 * Settings went on planning campaigns under whatever it was called
		 * the day the licence was pasted in, possibly months earlier.
		 *
		 * That is how roofingamerica.xyz ended up with live posts linking
		 * with the anchor "TK Water Damage Restoration" and "…in Leander"
		 * long after it had become Emergency Plumber Austin in Austin.
		 *
		 * Sent on the plan because that is the one moment the value is used:
		 * anchors are chosen here and then frozen into the slots. Sending it
		 * anywhere else would keep a copy current that nothing reads.
		 *
		 * AND IT DID NOT WORK UNTIL 5 OCTOBER, because this line sent
		 * business() — WordPress's own `trade`/`town` names — and the server
		 * only stores `type`/`location`. Three of the four fields were thrown
		 * away on arrival, silently, so the paragraph above described a fix
		 * that had only ever applied to `name`.
		 *
		 * roofingamerica.xyz's "…in Leander" is quoted above as the symptom
		 * this was written to cure. The same anchor turned up on
		 * hilltophomeloans.net months later, for exactly this reason. */
		if ( ! isset( $payload['business'] ) ) {
			$payload['business'] = IE_Settings::business_payload();
		}

		/* SET WHENEVER THE BUSINESS IS, including when a caller supplied the
		 * business itself. The two travel together or the server cannot tell a
		 * deliberate blank from a silence — and a caller that builds its own
		 * business block has no more claim to answer for this site's empty
		 * fields than this function does. */
		if ( ! isset( $payload['businessFields'] ) ) {
			$payload['businessFields'] = IE_Settings::business_fields();
		}

		return self::post( '/api/blog/plan', $payload, 60 );
	}

	/* --------------------------------------------------------------------
	 * Writing
	 * ----------------------------------------------------------------- */

	/**
	 * Approve a campaign and start writing it. Also the status check.
	 *
	 * ONE CALL, NO LOOP. See the note at the top of this file: a batch takes
	 * minutes and this request has seconds. The answer is one of
	 *
	 *   'writing'  the batch is running — { done, total, current }
	 *   'written'  finished — { written, failed[], readyToCollect }
	 *   'failed'   the batch stopped and the campaign is back to draft
	 *
	 * and a 402 when the balance will not cover the whole campaign. That
	 * refusal is deliberate on the server's side: a batch allowed to start
	 * underfunded leaves a ring with a hole in it that the owner paid for.
	 *
	 * Calling it twice never starts two batches — the campaign's status is the
	 * lock — so it is safe to call on every run.
	 *
	 * A CANCEL RIDES ON THIS CALL, and that is the whole transport.
	 *
	 * Pausing used to be WordPress-only. IE_Publisher::pause() held scheduled
	 * posts back as drafts and set the local status; the server heard about it
	 * on the hourly reconciliation, long after a batch that takes minutes had
	 * finished. Edwin approved eleven articles, pressed Pause seconds later,
	 * and all eleven were written and 825 credits charged.
	 *
	 * NO NEW ENDPOINT. This route already exists, already carries the
	 * campaign, and already has a timeout suited to it. The server ignores the
	 * flag unless a batch is actually running, so sending it when nothing is
	 * writing is harmless.
	 *
	 * AN EXPLICIT PARAMETER, NOT A LOOKUP INSIDE THIS METHOD. The first
	 * version of this read the local record and set the flag whenever the
	 * campaign was paused, so that every caller got it without remembering —
	 * which sounded tidy and did not work: run_campaign() returns early for
	 * any campaign that is not 'active', so the one state that needs to send a
	 * cancel is the one state that never reaches here. A hidden condition that
	 * can never be true is worse than no condition, because it reads as
	 * covered.
	 *
	 * @param string $campaign_id  the SERVER's campaign id
	 * @param array  $slot_indexes optional; fills specific gaps rather than all
	 * @param bool   $cancel       stop the running batch after the current post
	 */
	public static function write( $campaign_id, $slot_indexes = array(), $cancel = false ) {
		return self::post(
			'/api/blog/write',
			self::write_body( $campaign_id, $slot_indexes, $cancel ),
			self::TIMEOUT_WRITE
		);
	}

	/**
	 * The body write() sends. Split out SO THAT IT CAN BE TESTED AT ALL.
	 *
	 * self::post() is a static call resolved against this class, so no stub
	 * and no subclass can intercept it: anything calling write() either makes
	 * a real HTTP request or replaces the whole class. test-ie-pause.js does
	 * the latter, which is right for asking what the publisher DOES and
	 * leaves everything between the caller and the wire unexamined.
	 *
	 * That gap was not theoretical. Deleting the cancel line from the old
	 * inline version — so the flag was passed in, accepted, and silently
	 * dropped before the request — was the one mutation out of nine that no
	 * test noticed. Every caller still passed `true`, the server still read
	 * `cancel`, and the two were correct about a value that never travelled
	 * between them.
	 *
	 * Making the untestable thing testable, rather than writing a test that
	 * greps this file for the line: source searches have missed seven real
	 * bugs in this project and produced at least two failures on correct
	 * code.
	 *
	 * @return array
	 */
	public static function write_body( $campaign_id, $slot_indexes = array(), $cancel = false ) {
		$body = array( 'campaignId' => $campaign_id );

		if ( ! empty( $slot_indexes ) ) {
			$body['slotIndexes'] = array_values( array_map( 'intval', $slot_indexes ) );
		}

		/* ABSENT RATHER THAN false WHEN NOT CANCELLING. The server reads it as
		 * `true === cancel || 'true' === cancel`, so either shape works — but
		 * a body that carries `cancel: false` on every ordinary poll invites
		 * the next reader to add an `else` branch to the server for a case
		 * that does not exist. */
		if ( $cancel ) {
			$body['cancel'] = true;
		}

		return $body;
	}

	/**
	 * Take posts that have been written.
	 *
	 * Free, and repeatable. The server charges when a post is WRITTEN, not
	 * when it is handed over, so a site that dies half way through inserting a
	 * batch comes back and collects the rest at no cost — and the ones it
	 * already inserted are still offered, because it never confirmed them.
	 *
	 * A few at a time. A 52-post campaign in one response is most of a
	 * megabyte through a WordPress HTTP call that will probably time out, at
	 * which point the whole thing is retried and nothing ever progresses.
	 */
	public static function collect( $campaign_id, $limit = 5 ) {
		return self::post( '/api/blog/collect', array(
			'campaignId' => $campaign_id,
			'limit'      => (int) $limit,
		), self::TIMEOUT_COLLECT );
	}

	/* --------------------------------------------------------------------
	 * Reporting back
	 * ----------------------------------------------------------------- */

	/**
	 * Tell the server what WordPress scheduled.
	 *
	 * An ARRAY of posts, because this side inserts a whole batch and then
	 * confirms it — twelve round trips became one.
	 *
	 * There is no `activate` list in the response any more. The server used to
	 * work out which earlier post held a placeholder pointing at the one that
	 * just went live and send instructions back. It cannot now and does not
	 * need to: at this point nothing is public — these are future posts — and
	 * by the time one does publish, this side holds every post id and every
	 * token locally. See IE_Publisher::on_transition().
	 *
	 * Failure is logged and swallowed. The posts exist and are scheduled;
	 * refusing to accept that because a reporting call timed out would be
	 * worse than a temporarily stale count on the dashboard.
	 */
	public static function complete( $payload ) {
		$result = self::post( '/api/blog/complete', $payload, self::TIMEOUT_COLLECT );

		if ( is_wp_error( $result ) ) {
			IE_Publisher::log( 'complete callback failed: ' . $result->get_error_message() );
		}

		return $result;
	}

	/**
	 * Tell the server a scheduled post has gone public.
	 *
	 * Bookkeeping only — the id, URL and title were settled when the post was
	 * created. What it buys the server is the ability to tell a post that
	 * published on time from one WP-Cron never got round to, which is the
	 * whole basis of the missed-schedule sweep.
	 *
	 * Swallowed on failure for the same reason as complete(): the post is
	 * live, and a failed report does not make it less live.
	 */
	public static function published( $campaign_id, $slot_index, $published_at = '' ) {
		$result = self::post( '/api/blog/published', array(
			'campaignId'  => $campaign_id,
			'slotIndex'   => (int) $slot_index,
			'publishedAt' => $published_at ? $published_at : gmdate( 'c' ),
		) );

		if ( is_wp_error( $result ) ) {
			IE_Publisher::log( 'published callback failed: ' . $result->get_error_message() );
		}

		return $result;
	}

	/**
	 * Tell the server this campaign has been removed from the site.
	 *
	 * Removing used to be entirely local: the record was wiped here and the
	 * server went on believing the campaign was running. Its history — what
	 * was published, what was charged — is kept over there deliberately, and
	 * a history that cannot tell a finished campaign from a discarded one is
	 * not much of a history.
	 *
	 * SWALLOWED ON FAILURE, and that is the important part. This runs the
	 * moment somebody presses "Remove campaign", and the removal has to happen
	 * whether or not the server answers, whether or not the licence has been
	 * revoked, and whether or not this site is online. A customer unable to
	 * clear something off their own screen because a remote call failed would
	 * be a far worse bug than a missing row in a report they never see.
	 *
	 * So the return value is for the log, not for the caller's decision.
	 */
	public static function removed( $campaign_id, $at = '' ) {
		/* THE TIME THE CUSTOMER PRESSED REMOVE, sent because the server has no
		 * way to know it. It used to stamp its own clock on arrival, which is
		 * the same answer only when the report arrives immediately — and a
		 * report from a site whose licence was being refused arrived eight
		 * days late, so six campaigns were recorded as removed on the day the
		 * server finally heard rather than the day they went.
		 *
		 * ISO 8601 UTC. Omitted rather than guessed when the caller has no
		 * time to offer: the server falls back to its own clock, which is the
		 * old behaviour and still better than a made-up timestamp. */
		$body = array( 'campaignId' => $campaign_id );

		if ( ! empty( $at ) ) {
			$body['removedAt'] = (string) $at;
		}

		$result = self::post( '/api/blog/removed', $body );

		if ( is_wp_error( $result ) ) {
			IE_Publisher::log( 'removal callback failed: ' . $result->get_error_message() );
		}

		return $result;
	}

	/**
	 * Tell the server some of a campaign's posts are no longer on this site.
	 *
	 * A DIFFERENT EVENT FROM removed() ABOVE. That one says the owner threw
	 * the campaign away; this one says the campaign is alive and running and
	 * some of what it produced has been deleted.
	 *
	 * Conflating the two is what let this go unnoticed. The plugin could see a
	 * deleted post from 0.4.3 onward — it greys the row out and says so — but
	 * that knowledge never left wp-admin, and the only deletion the server
	 * ever heard about was a whole campaign being removed. So the blog report
	 * went on listing published posts, with links and a credit charge, for
	 * fourteen posts that answered 404.
	 *
	 * BEST EFFORT, AND THE FAILURE IS SWALLOWED, for the same reason the
	 * removal callback's is: nothing an owner does inside their own WordPress
	 * may depend on our server being reachable. Deleting a post has to work on
	 * a site that is offline, firewalled or revoked — and by the time we are
	 * called it has already happened, so there is nothing to roll back.
	 *
	 * A LOST CALL COSTS NOTHING, which is what makes that acceptable.
	 * IE_Publisher::sweep_deleted() re-reports anything still missing that has
	 * not been acknowledged, so an unreachable server makes the news late
	 * rather than lost. That sweep is also the only thing that can report a
	 * post deleted before this code existed — no hook fires retroactively.
	 *
	 * @param string $campaign_id
	 * @param int[]  $slot_indexes
	 */
	public static function posts_deleted( $campaign_id, $slot_indexes, $reconcile = false, $live = array() ) {
		$slots = array_values( array_unique( array_map( 'intval', (array) $slot_indexes ) ) );
		$alive = array_values( array_unique( array_map( 'intval', (array) $live ) ) );

		/* An empty list means something only when reconciling: "nothing is
		 * missing any more", which is how a post restored from the trash gets
		 * its Deleted mark taken off. From the delete hook it means the caller
		 * found no slot for that post, and there is nothing to say. */
		if ( empty( $slots ) && ! $reconcile ) {
			return null;
		}

		$result = self::post( '/api/blog/posts-deleted', array(
			'campaignId' => $campaign_id,
			'slots'      => $slots,
			'reconcile'  => (bool) $reconcile,
			/* WHICH SLOTS ARE LIVE, in the same breath as which are gone.
			 *
			 * The endpoint's name is now narrower than its job — it is a
			 * reconciliation of slot STATE, not only of deletions — but it
			 * keeps that name because renaming it would 404 on every plugin
			 * older than this one.
			 *
			 * Sent here rather than in a call of its own because the two
			 * answers come from the same walk of the same campaign, and a
			 * second round trip to say the other half would double the cost
			 * of being careful. */
			'live'       => $alive,
		) );

		if ( is_wp_error( $result ) ) {
			IE_Publisher::log( 'deleted-post callback failed: ' . $result->get_error_message() );
		}

		return $result;
	}

	/**
	 * Tell the server which campaigns this site still has.
	 *
	 * THE SAME RECONCILIATION, ONE LEVEL UP. posts_deleted() reconciles the
	 * slots inside a campaign we hold; this reconciles which campaigns we hold
	 * at all — and the second cannot be derived from the first. A campaign
	 * that has been removed from this WordPress is not in our records to
	 * sweep, so its posts stay on the server's books forever, counted as live
	 * work and billed for on the customer's own report.
	 *
	 * removed() covers a removal as it happens, but only since 0.4.4. Every
	 * campaign removed before that was never reported and is invisible to
	 * everything except this call.
	 *
	 * THE EMPTY CASE IS NOT SENT. A site with no campaigns has nothing to say,
	 * and a plugin whose options have been lost would otherwise announce that
	 * every campaign is gone. The server refuses an empty list too — belt and
	 * braces, because this is the one message that can destroy a record.
	 *
	 * @param string[] $campaign_ids
	 */
	public static function campaigns_present( $campaigns ) {
		/* TWO SHAPES IN, ONE SHAPE OUT. The sweep hands over
		 * array( 'id' => …, 'status' => … ) entries; older callers hand over
		 * bare ids. Both are accepted so this can be called from either. */
		$ids    = array();
		$states = array();

		foreach ( (array) $campaigns as $entry ) {
			if ( is_array( $entry ) ) {
				$id     = isset( $entry['id'] ) ? (string) $entry['id'] : '';
				$status = isset( $entry['status'] ) ? (string) $entry['status'] : '';
			} else {
				$id     = (string) $entry;
				$status = '';
			}

			if ( '' === $id || isset( $states[ $id ] ) ) {
				continue;
			}

			$ids[]          = $id;
			$states[ $id ]  = $status;
		}

		if ( empty( $ids ) ) {
			return null;
		}

		/* THE STATUS RIDES WITH THE SWEEP, and that is the whole design.
		 *
		 * Pausing and cancelling happen here, in wp-admin, and used to reach
		 * the server not at all — there was no IE_Api::paused() and no
		 * equivalent. So a campaign the owner stopped weeks ago still read
		 * "In progress" on their account page.
		 *
		 * NOT A NEW EVENT. Four facts have already been lost in this plugin to
		 * one-shot calls with no retry behind them. A status carried by a
		 * reconciliation is re-sent every run: a failed send costs an hour
		 * instead of being wrong for ever, and it repairs campaigns that
		 * drifted before this code existed.
		 *
		 * campaignIds is still sent alongside, so a server that has not been
		 * updated yet goes on working from it. */
		$payload = array();

		foreach ( $ids as $id ) {
			// The status the caller gave, or the record's if it gave none.
			$status = $states[ $id ];

			if ( '' === $status ) {
				$campaign = IE_Campaigns::get( $id );
				$status   = $campaign && isset( $campaign['status'] ) ? (string) $campaign['status'] : '';
			}

			$payload[] = array( 'id' => $id, 'status' => $status );
		}

		/* Carried here too, for the same reason the campaign statuses are: a
		 * reconciliation is re-sent every run, so a rename reaches the server
		 * within the hour rather than waiting for the next campaign to be
		 * planned. The plan call above is what actually needs it; this keeps
		 * the stored copy from being months old when it arrives.
		 *
		 * "A rename reaches the server within the hour" was true of the name
		 * and of nothing else: this sent business() raw until 5 October, so a
		 * site that MOVED TOWN re-sent its new address every hour for as long
		 * as it was connected and the server discarded it every time. See
		 * IE_Settings::business_payload(). */
		$result = self::post( '/api/blog/campaigns-present', array(
			'campaignIds'    => $ids,
			'campaigns'      => $payload,
			'business'       => IE_Settings::business_payload(),
			'businessFields' => IE_Settings::business_fields(),
		) );

		if ( is_wp_error( $result ) ) {
			IE_Publisher::log( 'campaign reconciliation failed: ' . $result->get_error_message() );
		}

		return $result;
	}
}
