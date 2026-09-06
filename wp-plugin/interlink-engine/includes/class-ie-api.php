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
	public static function activate( $licence_key, $server_url = '' ) {
		$target = $server_url ? untrailingslashit( $server_url ) : IE_Settings::server_url();

		$business = IE_Settings::business();

		$payload = wp_json_encode( array(
			'licenceKey'  => $licence_key,
			'siteUrl'     => home_url(),
			'themePrefix' => IE_Settings::active_theme_prefix(),
			'timezone'    => wp_timezone_string(),
			'business'    => array(
				'name'     => isset( $business['name'] ) ? $business['name'] : '',
				'type'     => isset( $business['trade'] ) ? $business['trade'] : '',
				'location' => isset( $business['town'] ) ? $business['town'] : '',
				'phone'    => isset( $business['phone'] ) ? $business['phone'] : '',
			),
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
	 * @param string $campaign_id  the SERVER's campaign id
	 * @param array  $slot_indexes optional; fills specific gaps rather than all
	 */
	public static function write( $campaign_id, $slot_indexes = array() ) {
		$body = array( 'campaignId' => $campaign_id );

		if ( ! empty( $slot_indexes ) ) {
			$body['slotIndexes'] = array_values( array_map( 'intval', $slot_indexes ) );
		}

		return self::post( '/api/blog/write', $body, self::TIMEOUT_WRITE );
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
}
