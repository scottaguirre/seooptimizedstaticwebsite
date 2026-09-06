<?php
/**
 * The route the server pings.
 *
 * The ping carries no content — just a list of campaign ids with work waiting.
 * Everything meaningful is assembled on this side. That is what makes a lost
 * ping cost nothing: the server pings again, or the catch-up cron does the
 * same job unaided, and neither path can produce a different post.
 *
 * AUTHENTICATION
 *
 * The same HMAC scheme this plugin uses outbound, run in reverse — see
 * class-ie-signing.php, which both directions share so they cannot drift.
 *
 * The signature is keyed with the secret the server issued at activation, NOT
 * the licence key. The licence key authenticates this site TO the server;
 * reusing it here would mean anyone who ever saw an outbound request could
 * forge an inbound one.
 *
 * WHY THE TIMESTAMP CHECK EARNS ITS PLACE
 *
 * A replayed /run costs the owner nothing directly — the slot claim is atomic
 * on the server, so a repeat finds the slot taken and returns the stored post.
 * The window is still worth having: it bounds what a captured request can do
 * at all, and it turns a drifting server clock into a message that says so
 * rather than a mystery.
 *
 * @package interlink-engine
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class IE_Rest {

	const REST_NAMESPACE = 'interlink/v1';

	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'register' ) );
	}

	public static function register() {
		register_rest_route( self::REST_NAMESPACE, '/run', array(
			'methods'             => 'POST',
			'callback'            => array( __CLASS__, 'handle_run' ),
			'permission_callback' => array( __CLASS__, 'verify' ),
		) );

		// Lets the server confirm a site is reachable and correctly paired
		// before it starts scheduling against it.
		register_rest_route( self::REST_NAMESPACE, '/ping', array(
			'methods'             => 'POST',
			'callback'            => array( __CLASS__, 'handle_ping' ),
			'permission_callback' => array( __CLASS__, 'verify' ),
		) );
	}

	/**
	 * Verify the server's signature.
	 *
	 * THE PATH MUST MATCH WHAT THE SERVER SIGNED, EXACTLY.
	 *
	 * The server signs '/wp-json/interlink/v1/run'. WordPress hands the route
	 * back as '/interlink/v1/run' — the namespace and route, without the
	 * rest_route prefix — so it is reassembled here rather than taken from
	 * $_SERVER['REQUEST_URI'], which differs between pretty permalinks
	 * (/wp-json/...) and plain ones (/?rest_route=/interlink/v1/run) and would
	 * make the signature fail on half of all sites for no visible reason.
	 */
	public static function verify( $request ) {
		$path = '/wp-json/' . ltrim( $request->get_route(), '/' );

		return IE_Signing::verify(
			IE_Settings::secret(),
			$request->get_header( 'x_il_signature' ),
			$request->get_header( 'x_il_timestamp' ),
			'POST',
			$path,
			$request->get_body()
		);
	}

	public static function handle_ping() {
		return rest_ensure_response( array(
			'ok'        => true,
			'version'   => IE_VERSION,
			'site'      => home_url(),
			'campaigns' => count( IE_Campaigns::all() ),
			// Still to be collected from the server.
			'pending'   => count( IE_Campaigns::campaigns_with_work() ),
			// Scheduled, past their date, and still not public. A number above
			// zero here means WP-Cron is not running on this site, which is the
			// single most useful thing the server can know about it.
			'missed'    => count( IE_Campaigns::missed_schedule() ),
		) );
	}

	/**
	 * Do whatever this site is behind on.
	 *
	 * TWO JOBS NOW, AND THE FIRST ONE IS THE POINT OF THE PING.
	 *
	 * Publish scheduled posts whose date has passed. WordPress publishes
	 * future posts through WP-Cron, WP-Cron fires when someone visits, and
	 * these sites have no visitors. So the doorbell's real job is no longer
	 * "come and collect a post" — it is "wake up, your cron has not run".
	 * That fits the mechanism far better than what it used to do: the server
	 * has a real timer, this site does not, and publishing on the right day is
	 * a timing problem.
	 *
	 * Then, if there is any, collect writing that has not come over yet.
	 *
	 * BOUNDED, because the caller is a scheduler with a ten-second timeout.
	 * publish_missed() takes five and run_campaign() takes five, so a site
	 * that has been unreachable for a month catches up over several pings
	 * rather than trying to do it all in one — which would also mean a month
	 * of posts appearing in the same minute, looking exactly like what it is.
	 */
	public static function handle_run( $request ) {
		$body = $request->get_json_params();

		$campaign_ids = isset( $body['campaigns'] ) && is_array( $body['campaigns'] )
			? array_map( 'sanitize_text_field', $body['campaigns'] )
			: array();

		// --- 1. the thing WP-Cron did not do ---

		$rescued = IE_Publisher::publish_missed();

		// --- 2. anything still to collect ---

		$pending = IE_Campaigns::campaigns_with_work();

		// Narrow to what the server asked about. An empty list means "anything
		// you have", which is what the catch-up cron wants.
		if ( ! empty( $campaign_ids ) ) {
			$pending = array_values( array_filter( $pending, function ( $id ) use ( $campaign_ids ) {
				$campaign = IE_Campaigns::get( $id );
				$server   = $campaign && isset( $campaign['server_campaign_id'] )
					? $campaign['server_campaign_id']
					: $id;

				return in_array( $server, $campaign_ids, true ) || in_array( $id, $campaign_ids, true );
			} ) );
		}

		if ( empty( $pending ) ) {
			return rest_ensure_response( array(
				'ok'       => true,
				'rescued'  => $rescued,
				'ran'      => 0,
				'remaining'=> 0,
			) );
		}

		$result = IE_Publisher::run_campaign( $pending[0] );

		if ( is_wp_error( $result ) ) {
			return new WP_Error(
				$result->get_error_code(),
				$result->get_error_message(),
				array( 'status' => 500 )
			);
		}

		// A batch still being written is not a failure and must not be
		// reported as one: answering 500 would make the scheduler count this
		// site as broken and eventually stop contacting it — which would
		// strand a campaign the owner has already paid for.
		return rest_ensure_response( array_merge(
			array(
				'ok'        => true,
				'rescued'   => $rescued,
				'ran'       => 1,
				'remaining' => count( $pending ) - 1,
			),
			(array) $result
		) );
	}
}
