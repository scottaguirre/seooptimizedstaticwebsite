<?php
/**
 * Getting a campaign onto the site, and keeping its links honest.
 *
 * THE WHOLE SEQUENCE, WHICH IS NOW TWO SEPARATE STORIES
 *
 * Story one — the day the campaign is approved:
 *
 *   1. ask the server to write everything            (IE_Api::write)
 *   2. come back until it has                        (one call per run)
 *   3. collect the finished posts, a few at a time   (IE_Api::collect)
 *   4. insert each as a FUTURE post, dated           (wp_insert_post)
 *   5. confirm the batch in one call                 (IE_Api::complete)
 *
 * Story two — every week after that, one post at a time:
 *
 *   6. WordPress publishes a scheduled post
 *   7. this side notices, and turns every placeholder pointing at that post
 *      into a real link                              (on_transition)
 *   8. tell the server it went live                  (IE_Api::published)
 *
 * WHY STEP 4 IS 'future' AND NOT 'publish'
 *
 * Because it is what WordPress is for. A future-dated post publishes itself,
 * with a real permalink from the moment it is created and a real position in
 * the archive. The alternative — hold the post here and insert it on the day —
 * means the schedule depends on this plugin being run at the right moment on a
 * site with no visitors, which is exactly the thing that does not happen.
 *
 * WHY THE PLACEHOLDERS SURVIVE, WHICH IS NOT OBVIOUS
 *
 * A future post has a real permalink immediately. It is tempting to conclude
 * that every link can be real from day one. It cannot: a future-dated post
 * returns 404 to anyone not logged in until its date arrives, so a real <a>
 * written today would be a broken link on a published page for as long as the
 * schedule runs. The spans stay.
 *
 * WHAT DID CHANGE IS WHO SWAPS THEM. The server used to compute an `activate`
 * list and send it back. It no longer needs to: by the time anything
 * publishes, this side holds every post id and every token, so the swap is
 * local, instant, and costs no round trip.
 *
 * @package interlink-engine
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class IE_Publisher {

	const LOG_OPTION = 'ie_log';

	/**
	 * How many posts to insert in one run.
	 *
	 * Each insert is a few database writes plus a permalink lookup. Twelve is
	 * comfortable; fifty-two in one request on shared hosting is how a plugin
	 * gets itself killed half way through, leaving posts inserted that were
	 * never confirmed. The rest are picked up on the next run, and confirming
	 * is what stops them being offered twice.
	 */
	const MAX_INSERTS_PER_RUN = 5;

	public static function init() {
		// Fires when WordPress publishes a scheduled post — and when the owner
		// publishes one by hand, which is the same event as far as the links
		// are concerned.
		//
		// transition_post_status rather than future_to_publish, because a
		// campaign running in draft mode goes draft -> publish and would
		// otherwise never switch its placeholders on.
		add_action( 'transition_post_status', array( __CLASS__, 'on_transition' ), 10, 3 );
	}

	/* ---------------------------------------------------------------------
	 * Story one: writing and scheduling
	 * ------------------------------------------------------------------ */

	/**
	 * Move a campaign forward by one run.
	 *
	 * Safe to call repeatedly and safe to call on a finished campaign. It
	 * works out what stage the campaign is at and does that stage's work,
	 * which is what lets one entry point serve the server's ping, the
	 * catch-up cron and the button in wp-admin.
	 *
	 * @param string $campaign_id local id (which is the server's id)
	 * @return array|WP_Error
	 */
	public static function run_campaign( $campaign_id ) {
		$campaign = IE_Campaigns::get( $campaign_id );
		if ( ! $campaign ) {
			return new WP_Error( 'ie_no_campaign', 'No such campaign: ' . $campaign_id );
		}

		if ( 'active' !== $campaign['status'] ) {
			return array( 'skipped' => true, 'reason' => 'campaign is ' . $campaign['status'] );
		}

		$server_id = isset( $campaign['server_campaign_id'] )
			? $campaign['server_campaign_id']
			: $campaign['id'];

		// --- 1 and 2. is it written yet? --------------------------------------

		$state = IE_Api::write( $server_id );

		if ( is_wp_error( $state ) ) {
			self::log( sprintf( '%s: write failed: %s', $campaign_id, $state->get_error_message() ) );
			return $state;
		}

		$status = isset( $state['status'] ) ? $state['status'] : '';

		/**
		 * Record that the money has been committed.
		 *
		 * 'writing' or 'written' both mean the server has accepted this
		 * campaign and is charging for it. The admin screen reads this to stop
		 * offering a button with a price on it — the price has been paid, and
		 * asking someone to press "Write all 3 posts — 225 credits" a second
		 * time, when all it does now is fetch what they already own, is a
		 * question nobody should have to answer nervously.
		 *
		 * Set once. Re-stamping on every run would lose the moment it began,
		 * which is what the screen uses to decide how long to keep watching.
		 */
		if ( ( 'writing' === $status || 'written' === $status ) && empty( $campaign['batch_started'] ) ) {
			IE_Campaigns::save( array_merge( $campaign, array(
				'batch_started' => current_time( 'mysql' ),
			) ) );
			$campaign = IE_Campaigns::get( $campaign_id );
		}

		if ( 'writing' === $status ) {
			// Not a failure and nothing to do yet. Reported plainly so the
			// scheduler counts this site as healthy — answering with an error
			// would eventually make the server stop contacting it.
			return array(
				'writing' => true,
				'done'    => isset( $state['done'] ) ? (int) $state['done'] : 0,
				'total'   => isset( $state['total'] ) ? (int) $state['total'] : 0,
				'current' => isset( $state['current'] ) ? $state['current'] : '',
			);
		}

		if ( 'failed' === $status ) {
			self::log( sprintf( '%s: the batch stopped: %s', $campaign_id,
				isset( $state['error'] ) ? $state['error'] : 'no reason given' ) );

			return new WP_Error( 'ie_batch_failed',
				isset( $state['error'] ) ? $state['error'] : 'The batch stopped.' );
		}

		// --- 3. collect -------------------------------------------------------

		$collected = IE_Api::collect( $server_id, self::MAX_INSERTS_PER_RUN );

		if ( is_wp_error( $collected ) ) {
			return $collected;
		}

		$posts = isset( $collected['posts'] ) && is_array( $collected['posts'] )
			? $collected['posts']
			: array();

		if ( empty( $posts ) ) {
			return array(
				'inserted'  => 0,
				'remaining' => 0,
				'reason'    => isset( $collected['status'] ) ? $collected['status'] : 'nothing to collect',
			);
		}

		// --- 4. insert each ---------------------------------------------------

		$confirmations = array();
		$inserted      = 0;

		foreach ( $posts as $written ) {
			$index = isset( $written['slotIndex'] ) ? (int) $written['slotIndex'] : -1;
			if ( $index < 0 ) {
				continue;
			}

			$found = IE_Campaigns::find_slot( $campaign, $index );
			if ( ! $found ) {
				self::log( sprintf( '%s/%d: the server sent a slot this site does not have', $campaign_id, $index ) );
				continue;
			}

			list( , $slot ) = $found;

			// Already inserted on this side. The server offers a post until it
			// is confirmed, and confirmation can be lost — without this check
			// one slot could become two posts.
			if ( 'pending' !== $slot['status'] && ! empty( $slot['post_id'] ) ) {
				$confirmations[] = self::confirmation( $slot, $index );
				continue;
			}

			$result = self::insert_post( $campaign, $slot, $written );

			if ( is_wp_error( $result ) ) {
				IE_Campaigns::update_slot( $campaign_id, $index, array(
					'error' => $result->get_error_message(),
				) );

				self::log( sprintf( '%s/%d: insert failed: %s',
					$campaign_id, $index, $result->get_error_message() ) );
				continue;
			}

			$confirmations[] = $result;
			$inserted++;

			// Re-read: update_slot() has changed the campaign under us, and the
			// next iteration's duplicate check reads from it.
			$campaign = IE_Campaigns::get( $campaign_id );
		}

		// --- 5. confirm the batch in one call ---------------------------------

		if ( ! empty( $confirmations ) ) {
			IE_Api::complete( array(
				'campaignId' => $server_id,
				'posts'      => $confirmations,
			) );
		}

		$remaining = isset( $collected['remaining'] ) ? (int) $collected['remaining'] : 0;

		self::log( sprintf( '%s: scheduled %d post(s), %d still to collect',
			$campaign_id, $inserted, $remaining ) );

		return array(
			'inserted'  => $inserted,
			'remaining' => $remaining,
		);
	}

	/**
	 * Create one WordPress post from one written slot.
	 *
	 * @return array|WP_Error the confirmation to send back
	 */
	private static function insert_post( $campaign, $slot, $written ) {
		$index = (int) $slot['index'];

		// --- resolve the link tokens ---
		//
		// The server sends prose with {{money}}…{{/money}} tokens intact and a
		// `targets` map saying where each should point. IE_Links::render()
		// esc_html's the prose FIRST and substitutes afterwards, so the only
		// markup that can reach post_content is markup we put there. That
		// property is why the server does not pre-render.

		$targets = isset( $written['targets'] ) && is_array( $written['targets'] )
			? $written['targets']
			: array();

		$rendered = IE_Links::render(
			isset( $written['sections'] ) ? $written['sections'] : array(),
			$targets
		);

		if ( ! empty( $rendered['missing'] ) ) {
			// Not fatal. A post missing its money link is worth less, but
			// refusing to publish it wastes a credit already spent.
			self::log( sprintf( '%s/%d writer omitted link token(s): %s',
				$campaign['id'], $index, implode( ', ', $rendered['missing'] ) ) );
		}

		// --- the date ---

		$publish_at = isset( $written['publishAt'] ) ? $written['publishAt'] : $slot['publish_at'];
		$timestamp  = $publish_at ? strtotime( $publish_at ) : 0;

		$post = array(
			'post_title'   => isset( $written['title'] ) ? $written['title'] : $slot['topic'],
			'post_name'    => isset( $written['slug'] ) ? $written['slug'] : '',
			'post_content' => self::insert_video( $rendered['content'], self::video_for( $campaign, $slot ) ),
			'post_type'    => 'post',
			'post_author'  => self::author_id(),
		);

		if ( 'draft' === $campaign['publish_mode'] ) {
			// The owner reviews and publishes by hand. The date is still set so
			// the schedule is visible in the post list, but nothing publishes
			// itself.
			$post['post_status'] = 'draft';

		} elseif ( $timestamp && $timestamp > time() ) {
			// The normal case. WordPress holds it and publishes it on the day.
			//
			// Both dates are set explicitly. Passing only post_date makes
			// WordPress derive the GMT one from the site's timezone, which is
			// right until the site's timezone is wrong — and then every post in
			// the campaign is silently hours out with nothing to show why.
			$gmt = gmdate( 'Y-m-d H:i:s', $timestamp );

			$post['post_status']   = 'future';
			$post['post_date_gmt'] = $gmt;
			$post['post_date']     = get_date_from_gmt( $gmt );

		} else {
			// The date has already passed — a campaign approved late, or one
			// whose first slot is today. Published now rather than inserted as
			// 'future' with a past date, which WordPress accepts and then never
			// publishes: the classic missed-schedule post, created deliberately.
			$post['post_status'] = 'publish';
		}

		$post_id = wp_insert_post( $post, true );

		if ( is_wp_error( $post_id ) ) {
			return $post_id;
		}

		if ( ! empty( $written['metaDescription'] ) ) {
			$description = sanitize_text_field( $written['metaDescription'] );

			// Written to BOTH keys on purpose. The generated themes read
			// '<prefix>_page_description' in their wp_head output; the plugin's
			// own key is what survives if the customer later switches theme.
			// One key alone means the description is silently dropped in one of
			// those two situations.
			update_post_meta( $post_id, '_ie_meta_description', $description );
			update_post_meta( $post_id, IE_Settings::active_theme_prefix() . '_page_description', $description );
		}

		// The join between a WordPress post and a campaign slot. on_transition()
		// reads these to work out which placeholders to switch on, and
		// activate_for_slot() refuses to edit any post that lacks them.
		update_post_meta( $post_id, '_ie_campaign', $campaign['id'] );
		update_post_meta( $post_id, '_ie_slot', $index );

		// The slug WordPress settled on, which may not be the one we asked for:
		// it appends -2 when a slug is taken, and every link built from the
		// requested slug would 404.
		$actual_slug = get_post_field( 'post_name', $post_id );
		$permalink   = get_permalink( $post_id );
		$status      = get_post_status( $post_id );

		IE_Campaigns::update_slot( $campaign['id'], $index, array(
			'status'        => ( 'publish' === $status ) ? 'published' : 'scheduled',
			'post_id'       => (int) $post_id,
			'slug'          => $actual_slug,
			'url'           => $permalink,
			'scheduled_for' => get_post_field( 'post_date', $post_id ),
			'written_at'    => current_time( 'mysql' ),
			'error'         => '',
		) );

		return array(
			'slotIndex'    => $index,
			'wpPostId'     => (int) $post_id,
			'url'          => $permalink,
			'title'        => get_the_title( $post_id ),
			'slug'         => $actual_slug,
			'scheduledFor' => get_gmt_from_date( get_post_field( 'post_date', $post_id ), 'c' ),
		);
	}

	/** Rebuild a confirmation for a slot this side has already inserted. */
	private static function confirmation( $slot, $index ) {
		return array(
			'slotIndex' => $index,
			'wpPostId'  => (int) $slot['post_id'],
			'url'       => isset( $slot['url'] ) ? $slot['url'] : '',
			'title'     => get_the_title( (int) $slot['post_id'] ),
			'slug'      => isset( $slot['slug'] ) ? $slot['slug'] : '',
		);
	}

	/* ---------------------------------------------------------------------
	 * Story two: a post goes live
	 * ------------------------------------------------------------------ */

	/**
	 * A post has changed status. If it is one of ours and it just became
	 * public, switch on every placeholder that was waiting for it.
	 *
	 * THIS REPLACES THE SERVER'S `activate` LIST, and the reason it can is
	 * that under write-ahead every post in the campaign already exists here.
	 * When slot 5 publishes, the posts holding a 'slot-5' placeholder are slot
	 * 4 (its forward link) and slot 6 (its backward link) — and both are
	 * already sitting in this database with their ids recorded. There is
	 * nothing to ask anyone.
	 *
	 * Editing a post that is itself still scheduled is fine and intended: slot
	 * 6's link to slot 5 is fixed now, and by the time slot 6 is public its
	 * target has been live for a week.
	 *
	 * @param string  $new
	 * @param string  $old
	 * @param WP_Post $post
	 */
	public static function on_transition( $new, $old, $post ) {
		if ( 'publish' !== $new || 'publish' === $old ) {
			return;
		}

		$campaign_id = get_post_meta( $post->ID, '_ie_campaign', true );
		if ( ! $campaign_id ) {
			return;
		}

		$slot_index = (int) get_post_meta( $post->ID, '_ie_slot', true );

		$campaign = IE_Campaigns::get( $campaign_id );
		if ( ! $campaign ) {
			return;
		}

		IE_Campaigns::update_slot( $campaign_id, $slot_index, array(
			'status'       => 'published',
			'published_at' => current_time( 'mysql' ),
			// Re-read rather than trusted: a post the owner renamed between
			// scheduling and publication has a different permalink now, and
			// every link about to be written points at it.
			'url'          => get_permalink( $post->ID ),
		) );

		$switched = self::activate_for_slot( $campaign_id, $slot_index, get_permalink( $post->ID ) );

		self::log( sprintf( '%s/%d published as post %d, %d link(s) switched on',
			$campaign_id, $slot_index, $post->ID, $switched ) );

		$server_id = isset( $campaign['server_campaign_id'] )
			? $campaign['server_campaign_id']
			: $campaign['id'];

		IE_Api::published( $server_id, $slot_index, get_post_time( 'c', true, $post->ID ) );
	}

	/**
	 * Turn every placeholder pointing at one slot into a live link.
	 *
	 * Only touches posts this plugin created, and only spans carrying the
	 * exact token. The modified date is bumped where something changed, so the
	 * older post gets re-crawled and the new link is found — which is the
	 * entire point of the exercise.
	 *
	 * @return int how many spans became anchors
	 */
	public static function activate_for_slot( $campaign_id, $slot_index, $url ) {
		$campaign = IE_Campaigns::get( $campaign_id );
		if ( ! $campaign || '' === $url ) {
			return 0;
		}

		$token = IE_Campaigns::slot_token( $slot_index );
		$total = 0;

		foreach ( $campaign['slots'] as $slot ) {
			$post_id = isset( $slot['post_id'] ) ? (int) $slot['post_id'] : 0;

			// A post cannot hold a placeholder for itself.
			if ( ! $post_id || (int) $slot['index'] === (int) $slot_index ) {
				continue;
			}

			$post = get_post( $post_id );
			if ( ! $post ) {
				continue;
			}

			// Refuse to edit a post this plugin did not create. The slot record
			// says it did, but a post id is a small integer and a stale record
			// pointing at an unrelated page would be very hard to notice and
			// impossible to undo.
			if ( ! get_post_meta( $post_id, '_ie_campaign', true ) ) {
				self::log( sprintf( 'refused to edit post %d: not created by this plugin', $post_id ) );
				continue;
			}

			$result = IE_Links::activate( $post->post_content, $token, $url );

			if ( 0 === $result['count'] ) {
				// No placeholder for this slot in this post — the usual case,
				// since only two posts in the ring ever hold one. Or the owner
				// deleted the span, which is their right.
				continue;
			}

			wp_update_post( array(
				'ID'                => $post_id,
				'post_content'      => $result['content'],
				// Explicit, so the re-crawl signal is not left to chance.
				'post_modified'     => current_time( 'mysql' ),
				'post_modified_gmt' => current_time( 'mysql', 1 ),
			) );

			$total += $result['count'];
		}

		return $total;
	}

	/* ---------------------------------------------------------------------
	 * The backstop
	 * ------------------------------------------------------------------ */

	/**
	 * Catch up on whatever WordPress or the network failed to do.
	 *
	 * TWO JOBS, AND THE SECOND IS THE ONE THAT MATTERS ON A QUIET SITE.
	 *
	 * First, campaigns with posts still to collect — a batch interrupted by a
	 * timeout, or a site that was down when its campaign finished writing.
	 *
	 * Second, and this is the important one: scheduled posts whose date has
	 * passed and which are still sitting there. WordPress publishes future
	 * posts through WP-Cron, and WP-Cron fires when somebody visits the site.
	 * These sites have no visitors — that is the entire reason the owner is
	 * buying posts — so "missed schedule" is the normal case here, not an edge
	 * one. Left alone, a twelve-week campaign publishes nothing at all.
	 */
	public static function run_catch_up() {
		$rescued = self::publish_missed();

		$pending = IE_Campaigns::campaigns_with_work();
		if ( empty( $pending ) ) {
			return array( 'rescued' => $rescued, 'ran' => 0 );
		}

		// One campaign per run. A site catching up on a month of work should
		// not try to do all of it inside one request.
		$next = $pending[0];
		self::run_campaign( $next );

		return array( 'rescued' => $rescued, 'ran' => 1 );
	}

	/**
	 * Publish one post immediately, and move its date to now.
	 *
	 * THE DATE MATTERS, which is why this is not just wp_publish_post().
	 *
	 * wp_publish_post() flips the status and leaves post_date alone, so a post
	 * scheduled for Thursday and published on Tuesday goes live claiming to be
	 * from Thursday. Readers see a date in the future, the archive sorts it
	 * ahead of posts that came out after it, and feeds carry the wrong date.
	 *
	 * Deliberately NOT used by publish_missed() below: a post whose date has
	 * already passed has the right date already, and rewriting it to "now"
	 * would stamp the campaign with the times WP-Cron happened to be woken up
	 * rather than the schedule the owner chose.
	 *
	 * wp_update_post rather than two calls, so the status change and the date
	 * land together — and so the transition hook fires once, with the final
	 * date already in place for the links it is about to write.
	 */
	public static function publish_now( $post_id ) {
		return wp_update_post( array(
			'ID'            => (int) $post_id,
			'post_status'   => 'publish',
			'post_date'     => current_time( 'mysql' ),
			'post_date_gmt' => current_time( 'mysql', 1 ),
		), true );
	}

	/* ---------------------------------------------------------------------
	 * The campaign's video
	 *
	 * WHY [embed] AND NOT AN <iframe>
	 *
	 * `[embed]` is a WordPress CORE shortcode, not one of ours. That matters
	 * for the same reason post_content holds finished HTML rather than our own
	 * shortcodes: delete this plugin and the posts must survive intact. A core
	 * shortcode keeps working; ours would leave `[interlink id="4"]` litter
	 * across every article.
	 *
	 * It also gets core's oEmbed handling for free — the responsive wrapper,
	 * the provider allow-list, and the `loading="lazy"` WordPress adds to embed
	 * iframes. A hand-written <iframe> gets none of that, and is the kind of
	 * markup security plugins strip.
	 *
	 * WHERE IT GOES
	 *
	 * Before the SECOND <h2>. That is a section boundary, so it never splits a
	 * paragraph; it is past the opening, so the post still starts with prose;
	 * and it is not at the end, where nobody scrolls to.
	 * ------------------------------------------------------------------ */

	/**
	 * Which video this article gets.
	 *
	 * The slot's own, when it has one; otherwise the campaign's. An empty slot
	 * value means "nothing was chosen here", not "no video wanted" — there is
	 * no way in the UI to say the second thing, and inventing one would mean a
	 * checkbox next to every row to express something nobody has asked for.
	 *
	 * @return string possibly empty
	 */
	public static function video_for( $campaign, $slot ) {
		if ( ! empty( $slot['video_url'] ) ) {
			return $slot['video_url'];
		}
		return isset( $campaign['video_url'] ) ? $campaign['video_url'] : '';
	}

	/**
	 * The block to insert, or '' when there is nothing usable.
	 *
	 * The scheme is checked again here even though the admin already ran
	 * esc_url_raw. That validation happened once, to a value that has been
	 * sitting in an option ever since — and options are edited by other
	 * plugins, by WP-CLI, and by hand.
	 */
	private static function video_block( $url ) {
		$url = trim( (string) $url );

		if ( '' === $url || ! preg_match( '#^https?://#i', $url ) ) {
			return '';
		}

		// Blank lines around it: autoembed and wpautop both work on block
		// boundaries, and a shortcode glued to a </p> is not one.
		return "\n\n[embed]" . esc_url_raw( $url ) . "[/embed]\n\n";
	}

	/**
	 * @param string $content  finished post HTML
	 * @param string $url      the campaign's video, possibly empty
	 * @return string
	 */
	public static function insert_video( $content, $url ) {
		$block = self::video_block( $url );

		if ( '' === $block ) {
			return $content;
		}

		// Idempotent. run_campaign() is safe to press repeatedly, and a post
		// carrying the same video twice is the kind of thing nobody notices
		// until a customer does.
		if ( false !== strpos( $content, '[embed]' ) ) {
			return $content;
		}

		$headings = array();
		if ( preg_match_all( '#<h2[\s>]#i', $content, $m, PREG_OFFSET_CAPTURE ) ) {
			$headings = $m[0];
		}

		if ( count( $headings ) >= 2 ) {
			$at = $headings[1][1];
			return substr( $content, 0, $at ) . $block . substr( $content, $at );
		}

		// A post too short to have two sections. Appending beats guessing at a
		// midpoint and landing inside a sentence.
		return rtrim( $content ) . $block;
	}

	/* ---------------------------------------------------------------------
	 * Pause and resume
	 *
	 * THE THING THAT IS NOT OBVIOUS
	 *
	 * Setting a campaign's status to 'paused' stops this plugin. It does not
	 * stop the posts. A post sitting at status 'future' is published by
	 * WordPress core on its date, and core has never heard of a campaign — so
	 * a pause that only wrote a status would leave the owner watching the
	 * content they just stopped appear on schedule anyway.
	 *
	 * So a pause has two halves: the status, which stops new posts being
	 * collected and written, and holding each scheduled post as a draft, which
	 * stops the ones already here.
	 *
	 * WHY RESUME MOVES THE DATES
	 *
	 * Every remaining date moves forward by exactly as long as the campaign
	 * sat still. Restoring the original dates after a three-week pause would
	 * dump three weeks of backdated posts out at once — which is both the
	 * pattern that reads as automated and the opposite of the weekly drip the
	 * campaign was planned as.
	 * ------------------------------------------------------------------ */

	/**
	 * Marks a post THIS plugin moved to draft, and remembers the date it was
	 * holding.
	 *
	 * Resume touches only posts carrying this. Without it there is no way to
	 * tell a post we held from one the owner drafted by hand while the
	 * campaign was stopped, and resume would publish something they had
	 * deliberately pulled.
	 */
	const HELD_META = '_ie_held_until';

	/**
	 * Stop a campaign now.
	 *
	 * @return int|WP_Error how many scheduled posts were held as drafts
	 */
	public static function pause( $campaign_id ) {
		$campaign = IE_Campaigns::get( $campaign_id );

		if ( ! $campaign ) {
			return new WP_Error( 'ie_no_campaign', __( 'That campaign could not be found.', 'interlink-engine' ) );
		}

		if ( IE_Campaigns::is_paused( $campaign ) ) {
			return 0;
		}

		// The status goes first. Everything below can fail on one post without
		// the campaign being left running, and a half-paused campaign that
		// still thinks it is active would collect more posts on the next cron.
		IE_Campaigns::set_status( $campaign_id, 'paused', array(
			// ISO 8601 UTC, not 'mysql'. strtotime() reads a bare
			// 'Y-m-d H:i:s' in whatever timezone PHP is set to, so a stored
			// GMT string comes back shifted on any site not running UTC.
			'paused_at' => gmdate( 'c' ),
		) );

		$held = 0;

		foreach ( $campaign['slots'] as $slot ) {
			$post_id = isset( $slot['post_id'] ) ? (int) $slot['post_id'] : 0;
			if ( ! $post_id ) {
				continue;
			}

			$post = get_post( $post_id );
			if ( ! $post ) {
				continue;
			}

			// The same refusal activate_for_slot() makes, for the same reason:
			// a post id is a small integer and a stale slot record pointing at
			// an unrelated page would be very hard to notice and impossible to
			// undo.
			if ( ! get_post_meta( $post_id, '_ie_campaign', true ) ) {
				self::log( sprintf( 'refused to hold post %d: not created by this plugin', $post_id ) );
				continue;
			}

			// Only posts WordPress is holding for a date. A draft is already
			// stopped, and a published post is public — taking it down is not
			// what anyone means by pause, and doing it silently would be worse
			// than not pausing at all.
			if ( 'future' !== $post->post_status ) {
				continue;
			}

			update_post_meta( $post_id, self::HELD_META, get_post_time( 'c', true, $post_id ) );

			wp_update_post( array(
				'ID'          => $post_id,
				'post_status' => 'draft',
			) );

			$held++;
		}

		self::log( sprintf( '%s paused, %d scheduled post(s) held as drafts', $campaign_id, $held ) );

		return $held;
	}

	/**
	 * Start a paused campaign again.
	 *
	 * @return int|WP_Error how many held posts were released
	 */
	public static function resume( $campaign_id ) {
		$campaign = IE_Campaigns::get( $campaign_id );

		if ( ! $campaign ) {
			return new WP_Error( 'ie_no_campaign', __( 'That campaign could not be found.', 'interlink-engine' ) );
		}

		if ( ! IE_Campaigns::is_paused( $campaign ) ) {
			return 0;
		}

		$paused_at = ! empty( $campaign['paused_at'] ) ? strtotime( $campaign['paused_at'] ) : 0;
		$shift     = $paused_at ? max( 0, time() - $paused_at ) : 0;

		// Active BEFORE the posts move, because publishing one fires
		// on_transition(), which reads and writes this same campaign option.
		// Holding a copy in memory across that and saving it afterwards would
		// overwrite the slot it just marked published.
		IE_Campaigns::set_status( $campaign_id, 'active', array( 'paused_at' => null ) );

		$released = 0;

		foreach ( $campaign['slots'] as $slot ) {
			$post_id = isset( $slot['post_id'] ) ? (int) $slot['post_id'] : 0;
			if ( ! $post_id ) {
				continue;
			}

			$held = get_post_meta( $post_id, self::HELD_META, true );
			if ( ! $held ) {
				continue;
			}

			$post = get_post( $post_id );
			if ( ! $post ) {
				delete_post_meta( $post_id, self::HELD_META );
				continue;
			}

			// The owner published it, rescheduled it, or deleted it to trash
			// while the campaign was stopped. Whatever they did wins — this
			// only undoes its own change.
			if ( 'draft' !== $post->post_status ) {
				delete_post_meta( $post_id, self::HELD_META );
				continue;
			}

			$when = strtotime( $held ) + $shift;

			if ( $when <= time() ) {
				// Its turn came and went while the campaign was stopped, which
				// happens when a post was already overdue at the moment of the
				// pause. Writing it back as 'future' with a past date is the
				// classic missed-schedule post: WordPress accepts it and then
				// never publishes it.
				self::publish_now( $post_id );
			} else {
				$gmt = gmdate( 'Y-m-d H:i:s', $when );

				wp_update_post( array(
					'ID'            => $post_id,
					'post_status'   => 'future',
					'post_date_gmt' => $gmt,
					'post_date'     => get_date_from_gmt( $gmt ),
				) );

				// The schedule screens read the slot, not the post. Leaving
				// these behind would show the owner the old dates for a
				// campaign that is now running to new ones.
				IE_Campaigns::update_slot( $campaign_id, $slot['index'], array(
					'publish_at'    => gmdate( 'c', $when ),
					'scheduled_for' => gmdate( 'c', $when ),
				) );
			}

			delete_post_meta( $post_id, self::HELD_META );
			$released++;
		}

		self::log( sprintf( '%s resumed after %d second(s), %d post(s) released',
			$campaign_id, $shift, $released ) );

		return $released;
	}

	/**
	 * Publish scheduled posts whose time has come and gone.
	 *
	 * wp_publish_post() rather than waiting for cron, because on a site with
	 * no traffic cron may not run for days. Everything downstream — the
	 * placeholder swap, the report to the server — happens through
	 * on_transition() exactly as it would have if cron had fired.
	 */
	public static function publish_missed() {
		$missed = get_posts( array(
			'post_type'      => 'post',
			'post_status'    => 'future',
			'posts_per_page' => 5,
			'date_query'     => array( array( 'before' => current_time( 'mysql' ) ) ),
			'meta_key'       => '_ie_campaign',
			'fields'         => 'ids',
			'orderby'        => 'date',
			'order'          => 'ASC',
		) );

		foreach ( $missed as $post_id ) {
			wp_publish_post( $post_id );
			self::log( sprintf( 'published post %d, which WP-Cron had missed', $post_id ) );
		}

		return count( $missed );
	}

	/** Posts are attributed to an administrator, not to whoever triggered it. */
	private static function author_id() {
		$stored = (int) IE_Settings::get( 'author_id', 0 );
		if ( $stored && get_userdata( $stored ) ) {
			return $stored;
		}

		$admins = get_users( array( 'role' => 'administrator', 'number' => 1, 'fields' => 'ID' ) );
		return ! empty( $admins ) ? (int) $admins[0] : 1;
	}

	/**
	 * A short rolling log, visible on the admin screen.
	 *
	 * Not error_log(): the person who needs to know why last Tuesday's post did
	 * not appear is the site owner, and they will never open a server log.
	 */
	public static function log( $message ) {
		$log = get_option( self::LOG_OPTION, array() );
		if ( ! is_array( $log ) ) {
			$log = array();
		}

		array_unshift( $log, array(
			'at'      => current_time( 'mysql' ),
			'message' => (string) $message,
		) );

		update_option( self::LOG_OPTION, array_slice( $log, 0, 50 ), false );
	}

	public static function get_log() {
		$log = get_option( self::LOG_OPTION, array() );
		return is_array( $log ) ? $log : array();
	}
}
