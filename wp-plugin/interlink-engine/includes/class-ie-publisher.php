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
	 * Removals that were reported at the time, and the moment they happened.
	 *
	 * THE REASON THIS EXISTS, in one screenshot: six campaigns on the blog
	 * report all reading "removed 09-28-2026", a date Edwin was sure was
	 * wrong. It was. He removed them earlier; the server could not be told,
	 * because that site's licence was being refused for eight days, and the
	 * hourly sweep eventually noticed they were missing and stamped them all
	 * with the day it noticed.
	 *
	 * IE_Api::removed() is deliberately unfailable — a customer must be able
	 * to clear a campaign off their own screen whether or not the server is
	 * reachable — and remove_campaign() deletes the local record immediately
	 * afterwards. So a report that failed used to be gone for good: the
	 * record it would have been rebuilt from no longer existed, and the only
	 * thing left to notice was the campaign's absence, at whatever later date
	 * somebody noticed it.
	 *
	 * The queue is what survives that. Id and timestamp, nothing else, so it
	 * needs no record to retry from.
	 */
	const PENDING_REMOVALS = 'ie_pending_removals';

	/** Enough for a bad week. Beyond this the oldest are dropped: an
	 *  unbounded option on a site that cannot reach the server is a row in
	 *  wp_options that grows for ever. */
	const MAX_PENDING_REMOVALS = 100;

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

		/* THE POST GOING AWAY IS AN EVENT TOO, and until now nothing listened
		 * for it. 0.4.3 taught the admin screens to NOTICE a deleted post —
		 * they query WordPress as they draw — but that knowledge never left
		 * wp-admin, so the server went on reporting those posts as published,
		 * with a working link and a credit charge, in the customer's own
		 * billing report.
		 *
		 * BOTH HOOKS, because both mean gone. before_delete_post is the
		 * permanent one; wp_trash_post is the common one, and a trashed post
		 * is off the site and will never publish on its schedule.
		 *
		 * untrashed_post is here so the door swings both ways. Somebody
		 * trashes a post by accident and puts it straight back — without this
		 * the mark would stay until the next hourly sweep, and a report that
		 * takes an hour to stop being wrong is one people learn to distrust. */
		add_action( 'before_delete_post', array( __CLASS__, 'on_post_gone' ), 10, 1 );
		add_action( 'wp_trash_post', array( __CLASS__, 'on_post_gone' ), 10, 1 );
		add_action( 'untrashed_post', array( __CLASS__, 'on_post_back' ), 10, 1 );
	}

	/**
	 * Campaigns touched by a deletion in THIS request, and whether the
	 * shutdown handler has been booked yet.
	 */
	private static $touched_campaigns = array();
	private static $flush_hooked      = false;

	/** A post is being deleted or trashed, or has come back out of the trash. */
	public static function on_post_gone( $post_id ) {
		self::note_post_change( $post_id );
	}

	/** Same treatment: what changed is which posts exist. */
	public static function on_post_back( $post_id ) {
		self::note_post_change( $post_id );
	}

	/**
	 * Remember the campaign and report ONCE, at the end of the request.
	 *
	 * NOT A CALL PER POST, and that is the whole point of this indirection.
	 *
	 * These hooks fire once per post. Selecting twelve posts in wp-admin and
	 * choosing Delete fires them twelve times inside a single request, and the
	 * first version of this made twelve separate HTTP calls to our server,
	 * back to back, each with a twenty-second timeout — while the owner's
	 * browser sat waiting on all of them. Bulk delete is exactly how somebody
	 * clears out a campaign's posts, so that was the common case, not the
	 * unlucky one.
	 *
	 * Now the hooks only note which campaigns are affected. One reconciliation
	 * per campaign goes out at 'shutdown', so twelve deletes across one
	 * campaign cost one call instead of twelve.
	 *
	 * SHUTDOWN ALSO MAKES THE ANSWER HONEST. These hooks run BEFORE WordPress
	 * does the work: at before_delete_post the row is still in the database,
	 * and at wp_trash_post the status has not changed yet. Asking "is this
	 * post missing?" there gets "no" for a post that is about to vanish, which
	 * is why the first version had to carry the answer in by hand. By shutdown
	 * the deed is done and the site can simply be asked.
	 *
	 * It does not make the call asynchronous — PHP still runs it before the
	 * process ends — but it takes it off the per-post path and out of the page
	 * render.
	 */
	private static function note_post_change( $post_id ) {
		$hits = IE_Campaigns::slots_for_post( $post_id );

		// The overwhelmingly common case: a post this plugin knows nothing
		// about. One cached option read and an array scan, no network.
		if ( empty( $hits ) ) {
			return;
		}

		foreach ( $hits as $hit ) {
			self::$touched_campaigns[ $hit['campaign_id'] ] = true;
		}

		if ( ! self::$flush_hooked ) {
			self::$flush_hooked = true;
			add_action( 'shutdown', array( __CLASS__, 'flush_deleted_reports' ), 1 );
		}
	}

	/**
	 * Send one reconciliation per campaign touched in this request.
	 *
	 * Public because it is a hook callback. Safe to call twice — the queue is
	 * emptied before anything else happens.
	 */
	public static function flush_deleted_reports() {
		if ( empty( self::$touched_campaigns ) ) {
			return 0;
		}

		$ids = array_keys( self::$touched_campaigns );
		self::$touched_campaigns = array();

		if ( ! IE_Settings::is_connected() ) {
			return 0;
		}

		// The lookup ran earlier in this request, against a site that has
		// since changed.
		IE_Campaigns::forget_post_cache();

		return self::send_slot_reports( IE_Campaigns::slot_report_due( $ids ) );
	}

	/**
	 * The one place a reconciliation is actually sent.
	 *
	 * Shared by the shutdown flush and the hourly sweep so the two can never
	 * come to disagree about what is sent or when the local record is updated.
	 *
	 * @param array $due campaign id => array of slot indexes currently missing
	 */
	private static function send_slot_reports( $due ) {
		$sent = 0;

		foreach ( $due as $campaign_id => $state ) {
			$missing = isset( $state['missing'] ) ? $state['missing'] : array();
			$live    = isset( $state['live'] ) ? $state['live'] : array();

			$result = IE_Api::posts_deleted( $campaign_id, $missing, true, $live );

			// ONLY on success. A failed report must leave the local record
			// alone, or one unreachable minute becomes permanent silence
			// about a post that really is gone. The sweep will retry.
			if ( is_wp_error( $result ) ) {
				continue;
			}

			IE_Campaigns::mark_slots_reported( $campaign_id, $missing, $live );
			$sent++;
		}

		return $sent;
	}

	/**
	 * The hourly reconciliation of what is really on the site.
	 *
	 * THIS IS NOT A BELT-AND-BRACES COPY OF THE HOOKS. It is the only thing
	 * that can report:
	 *
	 *   - a post deleted while the server was unreachable;
	 *   - a post removed by something that does not fire the usual hooks — a
	 *     direct database edit, a migration, a restore from a backup taken
	 *     before the post existed;
	 *   - and a post deleted BEFORE THIS CODE EXISTED, which is the case that
	 *     matters today. No hook fires retroactively, and there are fourteen
	 *     of them sitting in one report right now.
	 *
	 * It goes quiet once the server agrees with the site — deleted_report_due()
	 * compares against what was last sent — so a site with deleted posts does
	 * not make an HTTP call every hour for the rest of its life.
	 */
	public static function sweep_deleted() {
		if ( ! IE_Settings::is_connected() ) {
			return array( 'slots' => 0, 'campaigns' => 0 );
		}

		IE_Campaigns::forget_post_cache();

		$sent    = self::send_slot_reports( IE_Campaigns::slot_report_due() );
		$dropped = self::report_campaigns_present();

		if ( $sent ) {
			self::log( sprintf( 'reported deleted posts for %d campaign(s)', $sent ) );
		}

		if ( $dropped ) {
			self::log( sprintf( '%d campaign(s) no longer on this site were reported', $dropped ) );
		}

		return array( 'slots' => $sent, 'campaigns' => $dropped );
	}

	/**
	 * Tell the server which campaigns this site still has.
	 *
	 * THE QUESTION THE SLOT SWEEP CANNOT ASK. That sweep reconciles the slots
	 * inside campaigns we HOLD. A campaign removed from this WordPress is not
	 * in our records at all, so nothing walks it, and its posts stay on the
	 * server's books forever — counted as live work and charged for on the
	 * customer's own report.
	 *
	 * IE_Api::removed() covers a removal as it happens, but only since 0.4.4.
	 * Anything removed before that was never reported and is reachable by
	 * nothing except this call.
	 *
	 * SILENT WHEN THERE IS NOTHING TO SAY. campaign_report_due() returns null
	 * once the server's list matches ours, so this costs one call when the set
	 * changes rather than one an hour forever. It also returns null rather
	 * than an empty array for a site with no campaigns: an empty list is the
	 * one message that can destroy a record, and a plugin that has lost its
	 * options looks exactly like a site that has removed everything.
	 *
	 * @return int campaigns the server marked removed
	 */
	private static function report_campaigns_present() {
		// Each entry is array( 'id' => …, 'status' => … ). The status is part
		// of the message now, so it is part of what decides there is one.
		$due = IE_Campaigns::campaign_report_due();

		if ( ! is_array( $due ) || empty( $due ) ) {
			return 0;
		}

		$result = IE_Api::campaigns_present( $due );

		// ONLY on success, as everywhere else here: a failed report must leave
		// the local record alone so the next sweep tries again.
		if ( is_wp_error( $result ) || null === $result ) {
			return 0;
		}

		IE_Campaigns::mark_campaigns_reported( $due );

		return isset( $result['removed'] ) ? (int) $result['removed'] : 0;
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
	 * @param bool   $may_start   may this call START work that costs money?
	 *                            FALSE BY DEFAULT, so a caller added later
	 *                            has to say so to spend anything. Only the
	 *                            owner pressing a button passes true.
	 * @return array|WP_Error
	 */
	public static function run_campaign( $campaign_id, $may_start = false ) {
		$campaign = IE_Campaigns::get( $campaign_id );
		if ( ! $campaign ) {
			return new WP_Error( 'ie_no_campaign', 'No such campaign: ' . $campaign_id );
		}

		$server_id = isset( $campaign['server_campaign_id'] )
			? $campaign['server_campaign_id']
			: $campaign['id'];

		/* A PAUSED CAMPAIGN STILL HAS ONE THING TO SAY, and until 6 October it
		 * said nothing at all.
		 *
		 * The early return below is right for everything else: a paused
		 * campaign must not collect, must not publish, must not be touched.
		 * But if the server is still WRITING it, the one message that matters
		 * is "stop" — and returning before sending it is how eleven articles
		 * came to be written and charged after Pause was pressed.
		 *
		 * THIS IS THE RETRY, and it is why the cancel is not left to pause()
		 * alone. pause() sends it once, immediately, which is what makes it
		 * fast. This runs on every sweep for as long as the campaign stays
		 * paused, which is what makes it reliable. Four facts have already
		 * been lost in this plugin to one-shot calls with nothing behind them
		 * — see the note above IE_Api::campaigns_present() — and a lost
		 * cancel is the most expensive of them.
		 *
		 * Cheap: one request per paused campaign per sweep, and the server
		 * ignores it unless a batch is genuinely running. */
		if ( IE_Campaigns::is_paused( $campaign ) ) {
			$stop = IE_Api::write( $server_id, array(), true );

			if ( is_wp_error( $stop ) ) {
				self::log( sprintf( '%s: cancel failed: %s', $campaign_id, $stop->get_error_message() ) );
			}

			return array( 'skipped' => true, 'reason' => 'campaign is paused', 'cancelSent' => true );
		}

		if ( 'active' !== $campaign['status'] ) {
			return array( 'skipped' => true, 'reason' => 'campaign is ' . $campaign['status'] );
		}

		/* --- 0. HAS ANYBODY AGREED TO PAY FOR THIS? --------------------------
		 *
		 * NOTHING ASKED, ANYWHERE, UNTIL NOW. A campaign's status is 'active'
		 * from the moment it is created — the second planning finishes, before
		 * approval — and every slot is 'pending' because nothing is written.
		 * That is exactly the pair IE_Campaigns::campaigns_with_work() looks
		 * for, so a freshly planned campaign is top of the hourly cron's list.
		 * The cron handed it to this function, this function posted to
		 * /api/blog/write, and that endpoint starts a job and charges per post.
		 *
		 * The server cannot refuse on our behalf: BlogCampaign has no
		 * approvedAt field and /api/blog/write rejects only 'cancelled',
		 * because from the server's side CALLING that endpoint IS the
		 * approval. Approval exists in exactly one place in this system, and
		 * it is here. Anything that reaches the server without checking has
		 * already spent the money.
		 *
		 * Measured, not reasoned: a campaign seeded as it exists the instant
		 * planning ends is picked up by campaigns_with_work() and produces one
		 * plain write call. Ten unapproved posts is 750 credits, charged
		 * within the hour, while the campaign's own card still shows the price
		 * as a question on a button nobody pressed.
		 *
		 * AFTER THE PAUSED BRANCH ABOVE, DELIBERATELY, and the asymmetry is
		 * the point. That branch sends a cancel, and a cancel must never be
		 * blocked by a bookkeeping field: if this guard ever wrongly judged a
		 * campaign unapproved, blocking its cancel would mean writing and
		 * charging for a batch the owner had stopped — the 825-credit failure,
		 * again. Blocking a START costs an hour's delay. One of those two
		 * mistakes is recoverable.
		 *
		 * TWO WITNESSES, AND THE SECOND ONE IS WHY THIS IS NOT ONE LINE.
		 *
		 * approved_at is stamped below, by this function, BEFORE the request
		 * goes out — because approval is something the OWNER did, and this
		 * site should record its own owner's decision rather than infer it
		 * from a reply. batch_started cannot do that job: it is stamped from
		 * the server's answer, so a lost response on the approving call would
		 * leave the server writing, this site unapproved, and the sweep
		 * refusing to poll or collect for ever — a paid-for campaign whose
		 * posts never arrive. That is the same confusion that made
		 * batch_started unable to answer the spinner question and forced
		 * writing_since into existence: one field standing for both "the
		 * owner agreed" and "the server confirmed".
		 *
		 * batch_started IS STILL READ, and that is not belt-and-braces. Every
		 * campaign already in flight across the fleet has batch_started and
		 * no approved_at, because approved_at did not exist when they were
		 * approved. Testing approved_at alone would strand all of them. */
		$approved = ! empty( $campaign['approved_at'] ) || ! empty( $campaign['batch_started'] );

		if ( ! $may_start && ! $approved ) {
			return array( 'skipped' => true, 'reason' => 'campaign has not been approved' );
		}

		if ( $may_start && ! $approved ) {
			IE_Campaigns::save( array_merge( $campaign, array(
				'approved_at' => current_time( 'mysql' ),
			) ) );
			$campaign = IE_Campaigns::get( $campaign_id );
		}

		// --- 1 and 2. is it written yet? --------------------------------------

		$state = IE_Api::write( $server_id );

		if ( is_wp_error( $state ) ) {
			self::log( sprintf( '%s: write failed: %s', $campaign_id, $state->get_error_message() ) );

			/* A REFUSAL FOR MONEY IS AN ANSWER, NOT A LOST MESSAGE, and the
			 * difference decides what approved_at should say afterwards.
			 *
			 * Leaving it stamped would mean the sweep carries on trying — and
			 * the moment the owner tops up their balance for something else, a
			 * campaign they never got to start would write itself an hour
			 * later. They pressed the button once, were told no, and are
			 * entitled to press it again themselves.
			 *
			 * Only approved_at is cleared. A part-written campaign that hits
			 * 402 on a gap fill keeps batch_started and stays approved, which
			 * is correct: its money was committed long ago. */
			$data = $state->get_error_data();

			if ( is_array( $data )
				&& ( 402 === (int) ( isset( $data['status'] ) ? $data['status'] : 0 )
					|| ! empty( $data['data']['creditsError'] ) ) ) {
				$campaign = IE_Campaigns::get( $campaign_id );

				if ( $campaign && ! empty( $campaign['approved_at'] ) ) {
					IE_Campaigns::save( array_merge( $campaign, array( 'approved_at' => '' ) ) );
				}
			}

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

		/* A SECOND CLOCK, FOR THE THING batch_started CANNOT ANSWER.
		 *
		 * batch_started is the moment the campaign was APPROVED — set once,
		 * deliberately, because it is also what tells the screen the money has
		 * been committed. The spinner was keyed off it: watch for ten minutes
		 * after approval.
		 *
		 * THAT WORKS FOR EXACTLY ONE BATCH. A campaign paused and resumed an
		 * hour later starts writing again with batch_started still showing the
		 * original approval, so `time() - started` is already past the window
		 * and the spinner can never appear. Edwin resumed a campaign, three
		 * posts were written and charged, and the page showed nothing at all.
		 *
		 * SO THE SPINNER STOPS GUESSING FROM A TIMER AND USES WHAT THE SERVER
		 * JUST SAID. 'writing' is a fact that arrives on every poll and was
		 * being thrown away; stored here, the screen can ask "is it writing?"
		 * instead of "was it approved recently?".
		 *
		 * STAMPED ONLY ON THE TRANSITION, not on every poll, so the ten-minute
		 * cap still means something: a job that dies silently stops the page
		 * reloading itself overnight rather than spinning for ever. */
		$was_writing = ! empty( $campaign['writing_since'] );

		if ( 'writing' === $status && ! $was_writing ) {
			IE_Campaigns::save( array_merge( $campaign, array(
				'writing_since' => current_time( 'mysql' ),
			) ) );
			$campaign = IE_Campaigns::get( $campaign_id );
		} elseif ( 'writing' !== $status && $was_writing ) {
			/* CLEARED THE MOMENT IT STOPS, however it stopped — finished,
			 * failed, or cancelled by a pause. A spinner that outlives the
			 * batch is the bug this replaces, in a smaller window. */
			$campaign = IE_Campaigns::save( array_merge( $campaign, array(
				'writing_since' => '',
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

		/* THE FIRST PILLAR CAN BE THIS SITE'S HOME PAGE, and a home page has to
		 * be a PAGE: Settings → Reading lists only Pages, and nothing in
		 * WordPress will accept a Post as page_on_front.
		 *
		 * BOTH CONDITIONS, and the slot index is the one that matters.
		 * `home_page` on a campaign means "its FIRST post is the home page",
		 * not "every post in it is a page". Testing the flag alone would turn
		 * all twenty into Pages, which is a different feature nobody asked for.
		 *
		 * NOTHING ELSE ABOUT THE SLOT CHANGES. It keeps its place in the ring,
		 * both its neighbours and its pillar flag. ringNeighbours() works on
		 * slot indexes and has never known what post type a slot became. */
		$as_home = ! empty( $campaign['home_page'] ) && 0 === $index;

		$post = array(
			'post_title'   => isset( $written['title'] ) ? $written['title'] : $slot['topic'],
			'post_name'    => isset( $written['slug'] ) ? $written['slug'] : '',
			'post_content' => self::insert_video( $rendered['content'], self::video_for( $campaign, $slot ) ),
			'post_type'    => $as_home ? 'page' : 'post',
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

		/* THE SEO TITLE, WHICH WAS NEVER WRITTEN AT ALL.
		 *
		 * The generated theme filters `pre_get_document_title` and returns
		 * '<prefix>_page_title' when the post has one. Its own pages get that
		 * meta at theme activation; posts published by this plugin never did,
		 * so the filter fell through on every single one and WordPress's
		 * default took over — "Post Title - Site Name".
		 *
		 * That is how a post ended up titled
		 *
		 *   Cloudy Glasses and White Faucet Scale Usually Mean Hard Water — roofingamerica.xyz
		 *
		 * The domain is dead weight in a search result: it is already shown
		 * underneath, and here it eats characters from the end of a headline
		 * that was written to fit. Setting the meta is enough to stop it — no
		 * theme change, so it fixes sites whose theme is already installed.
		 *
		 * The post's own headline, not a second title written separately. One
		 * that drifts from the H1 is a maintenance problem nobody asked for,
		 * and the headline is already written to work as a search result.
		 *
		 * BOTH KEYS, for the same reason as the description below: the theme
		 * reads the prefixed one, and the plugin's own key is what survives a
		 * change of theme. */
		$seo_title = isset( $written['title'] ) ? sanitize_text_field( $written['title'] ) : '';

		if ( '' !== $seo_title ) {
			update_post_meta( $post_id, '_ie_meta_title', $seo_title );
			update_post_meta( $post_id, IE_Settings::active_theme_prefix() . '_page_title', $seo_title );

			/* THE YOAST AND RANK MATH KEYS ARE NO LONGER WRITTEN — 0.21.0.
			 *
			 * 0.19.0 wrote them so the hand-written title was not discarded on
			 * a site running one of those plugins. That reasoning was sound
			 * while IE_SEO stood down and rendered nothing there.
			 *
			 * It stopped being sound the moment ours took precedence. IE_SEO
			 * now returns our value through `wpseo_title` and
			 * `rank_math/frontend/title`, so OUR text is what renders — and a
			 * copy sitting in their box would be a second field the owner can
			 * edit to no effect whatsoever. A box that looks like it works and
			 * does not is worse than no box.
			 *
			 * One field, one effect: IE_Metabox edits `_ie_meta_title`, and
			 * that is the only value any of this reads.
			 *
			 * POSTS PUBLISHED BY 0.19.0 OR 0.20.0 STILL CARRY THOSE ROWS.
			 * They are not deleted on upgrade — removing somebody's stored
			 * data to tidy up is a worse trade than leaving a row nothing
			 * reads. On such a post Yoast's box shows a value that no longer
			 * renders. */
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

			// Their description keys are not written either, for the reason
			// given on the title above.
		}

		// The join between a WordPress post and a campaign slot. on_transition()
		// reads these to work out which placeholders to switch on, and
		// activate_for_slot() refuses to edit any post that lacks them.
		update_post_meta( $post_id, '_ie_campaign', $campaign['id'] );
		update_post_meta( $post_id, '_ie_slot', $index );

		/* THIS POST IS A PILLAR — a hub a later campaign can aim at.
		 *
		 * Stamped here, at insert, because this is the only moment both facts
		 * are in one place: the campaign says what kind of campaign it is, and
		 * $post_id says which post came out of it.
		 *
		 * WRITTEN ONLY WHEN TRUE, never as '0'. target_pages() queries on
		 * meta_value '1', and a post carrying '0' would be a row meaning
		 * "deliberately not a pillar" — a fact nothing asks and nothing
		 * maintains. Absence already says it.
		 *
		 * The string lives on IE_Settings so it exists once. The publisher
		 * writing one spelling and the query reading another fails silently:
		 * the post is stamped, and the dropdown is simply missing a row.
		 */
		if ( ! empty( $campaign['is_pillar'] ) ) {
			update_post_meta( $post_id, IE_Settings::PILLAR_META, '1' );

			/* AND THE KEYWORD IT WAS BUILT TO WIN, which went in the bin here
			 * for as long as pillars have existed.
			 *
			 * Stamping the flag without the keyword says "a later campaign may
			 * aim at this post" while withholding the one fact that campaign
			 * needs. read_keyword() then derived a keyword from the TITLE,
			 * because a title was all it could see — and a pillar's title is a
			 * headline. "Can You Apply for a Loan in the US Without Being a
			 * Citizen?" came out as a thirteen-word keyword, question mark
			 * included, and the anchors built from it read like a headline
			 * glued into the middle of a sentence.
			 *
			 * THE OWNER ALREADY ANSWERED THIS. They typed it into "Search it
			 * should win" when they planned the campaign, and the form refuses
			 * to plan a pillar campaign without it. The value has been sitting
			 * on the slot the whole time.
			 *
			 * SAME MOMENT, SAME CONDITION, SAME BLOCK as the flag above, and
			 * deliberately so. These two facts are only ever true together, and
			 * two separate ifs with the same test is how one of them later
			 * acquires a guard the other does not.
			 *
			 * WRITTEN ONLY WHEN THERE IS SOMETHING TO WRITE, following
			 * PILLAR_META's rule. An empty row would be worse than no row: the
			 * reader could not tell "this pillar has no keyword" from "this
			 * pillar predates the field", and it is the second of those that
			 * has to keep the title fallback alive. */
			$target_query = isset( $slot['target_query'] ) ? trim( (string) $slot['target_query'] ) : '';

			if ( '' !== $target_query ) {
				update_post_meta( $post_id, IE_Settings::KEYWORD_META, $target_query );
			}
		}

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
	/**
	 * Make this page the site's front page.
	 *
	 * REFUSES TO TAKE A FRONT PAGE SOMEBODY ALREADY CHOSE. Edwin's blogs are
	 * empty, and this is a product: a customer installing the plugin on an
	 * established site must not find their home page swapped out because a
	 * campaign was planned with a box ticked. The absence of a choice is the
	 * only thing that makes claiming the root safe.
	 *
	 * `show_on_front` is 'posts' on a fresh WordPress, so the common case
	 * passes. A site that has already set a static front page does not.
	 *
	 * NO page_for_posts. Edwin's decision for these blogs: the post index has
	 * no URL at all. Every post is reachable through the ring and nothing
	 * needs an archive.
	 *
	 * @return bool whether the front page was claimed
	 */
	private static function claim_front_page( $post_id ) {
		$existing = (int) get_option( 'page_on_front' );
		$mode     = get_option( 'show_on_front' );

		if ( 'page' === $mode && $existing && $existing !== (int) $post_id ) {
			self::log( sprintf(
				'post %d was not made the front page: page %d is already set',
				$post_id, $existing
			) );
			return false;
		}

		update_option( 'show_on_front', 'page' );
		update_option( 'page_on_front', (int) $post_id );

		self::log( sprintf( 'post %d is now the front page', $post_id ) );

		return true;
	}

	public static function on_transition( $new, $old, $post ) {
		if ( 'publish' !== $new || 'publish' === $old ) {
			return;
		}

		$campaign_id = get_post_meta( $post->ID, '_ie_campaign', true );
		if ( ! $campaign_id ) {
			return;
		}

		$slot_index = (int) get_post_meta( $post->ID, '_ie_slot', true );

		/* THE CAMPAIGN IS READ BEFORE THE PERMALINK, and the two lines swapped
		 * places for one reason: setting the front page CHANGES the permalink,
		 * and the read below has to happen after.
		 *
		 * WHY THE FRONT PAGE IS SET HERE AND NOT AT INSERT. A pillar campaign
		 * creates its posts future-dated, weeks ahead. Pointing page_on_front
		 * at a post that has not published yet makes the SITE ROOT ANSWER 404
		 * to the public until its date arrives — for a scheduled campaign,
		 * that is the home page gone for a month. Publication is the first
		 * moment the page can actually serve, so it is the moment to claim the
		 * root.
		 *
		 * And it lands exactly where the existing re-read already is. The
		 * comment on `url` below says a post renamed between scheduling and
		 * publication has a different permalink now, and every link about to be
		 * written points at it. Becoming the front page is the same fact
		 * arriving a different way: the permalink stops being /first-topic/ and
		 * becomes the site root. */
		$campaign = IE_Campaigns::get( $campaign_id );

		if ( $campaign && ! empty( $campaign['home_page'] ) && 0 === $slot_index ) {
			self::claim_front_page( $post->ID );
		}

		$url = get_permalink( $post->ID );

		/* A MISSING CAMPAIGN RECORD IS NOT A REASON TO STOP, and treating it
		 * as one was a silent, expensive bug.
		 *
		 * This used to `return` here. Removing a campaign from the Campaigns
		 * screen deletes its record but touches no posts — so every post still
		 * scheduled went on to publish, WordPress core did it on the date as
		 * always, this hook woke up, found no record and gave up. The result:
		 *
		 *   - the placeholders waiting on that post stayed <span> forever,
		 *     INCLUDING those in posts that published weeks earlier and were
		 *     working perfectly until the removal
		 *   - the server was never told it went live, so the report shows it
		 *     Scheduled indefinitely
		 *
		 * None of which is visible. A dead placeholder renders as ordinary
		 * prose in the middle of a sentence: no broken link, no error, no log
		 * line, nothing to see on the page. Only the HTML source shows it.
		 *
		 * Nothing was actually lost when the record went. Every post carries
		 * `_ie_campaign` and `_ie_slot`, and deleting the option does not touch
		 * post meta — so the work below can be done from the posts themselves.
		 * The record is an optimisation now, not a prerequisite. */
		if ( $campaign ) {
			IE_Campaigns::update_slot( $campaign_id, $slot_index, array(
				'status'       => 'published',
				'published_at' => current_time( 'mysql' ),
				// Re-read rather than trusted: a post the owner renamed between
				// scheduling and publication has a different permalink now, and
				// every link about to be written points at it.
				'url'          => $url,
			) );
		} else {
			self::log( sprintf( '%s/%d: no local record, working from post meta',
				$campaign_id, $slot_index ) );
		}

		$switched = self::activate_for_slot( $campaign_id, $slot_index, $url );

		self::log( sprintf( '%s/%d published as post %d, %d link(s) switched on',
			$campaign_id, $slot_index, $post->ID, $switched ) );

		/* The local id IS the server id — create_from_plan() keys the record by
		 * the server's campaign id, and `_ie_campaign` is written from that
		 * same key. So post meta alone is enough to report this. */
		$server_id = ( $campaign && ! empty( $campaign['server_campaign_id'] ) )
			? $campaign['server_campaign_id']
			: $campaign_id;

		IE_Api::published( $server_id, $slot_index, get_post_time( 'c', true, $post->ID ) );
	}

	/**
	 * The most posts one orphaned campaign may be assumed to have.
	 *
	 * A campaign is capped at 52 topics (IE_Admin::MAX_TOPICS), so this is
	 * nearly double the largest legitimate answer. It exists because the
	 * fallback below queries by meta VALUE rather than reading a known list,
	 * and an unbounded query driven by a value out of post meta is not
	 * something to leave open on a customer's site.
	 */
	const MAX_ORPHAN_SIBLINGS = 100;

	/**
	 * The other posts of this campaign — from the record if there is one,
	 * from the posts themselves if there is not.
	 *
	 * THE RECORD IS THE FAST PATH, NOT THE ONLY PATH. One cached option read
	 * answers this for every campaign the site still has, which is nearly all
	 * of them. The query below runs only when that record is gone: removed
	 * from the Campaigns screen, or lost with the option.
	 *
	 * @return int[] post ids, never including the publishing post itself
	 */
	public static function campaign_post_ids( $campaign_id, $except_slot = null ) {
		$campaign = IE_Campaigns::get( $campaign_id );
		$ids      = array();

		if ( $campaign && ! empty( $campaign['slots'] ) ) {
			foreach ( $campaign['slots'] as $slot ) {
				$post_id = isset( $slot['post_id'] ) ? (int) $slot['post_id'] : 0;

				if ( ! $post_id ) {
					continue;
				}

				// A post cannot hold a placeholder for itself. With no slot
				// named, nothing is excluded and this is every post the
				// campaign made.
				if ( null !== $except_slot && (int) $slot['index'] === (int) $except_slot ) {
					continue;
				}

				$ids[] = $post_id;
			}

			return $ids;
		}

		/* NOT 'trash'. A trashed post is one the owner threw away; editing it
		 * would rewrite content sitting in their bin and bump its modified
		 * date, which is the single thing that makes a deletion look like an
		 * edit. 'inherit' and 'auto-draft' are revisions and noise. */
		$found = get_posts( array(
			/* BOTH TYPES, UNCONDITIONALLY — the first pillar of a campaign may
			 * be a PAGE, because it is the site's home page.
			 *
			 * SAFE WITHOUT A BRANCH because this query is already bounded by
			 * meta_key '_ie_campaign': it can only ever reach content this
			 * plugin created. Widening it cannot touch the owner's own pages.
			 *
			 * A conditional here would be worse, not safer. It would need the
			 * campaign flag in a function that does not have it, and the
			 * failure mode of getting it wrong is silent — the page is simply
			 * never found, and nothing says so. */
			'post_type'        => array( 'post', 'page' ),
			'post_status'      => array( 'publish', 'future', 'draft', 'pending', 'private' ),
			'numberposts'      => self::MAX_ORPHAN_SIBLINGS,
			'fields'           => 'ids',
			'meta_key'         => '_ie_campaign',
			'meta_value'       => (string) $campaign_id,
			'suppress_filters' => false,
		) );

		foreach ( (array) $found as $post_id ) {
			$post_id = (int) $post_id;

			// The same exclusion, reached the same way the slot index was:
			// from the post's own meta.
			if ( null !== $except_slot
				&& (int) get_post_meta( $post_id, '_ie_slot', true ) === (int) $except_slot ) {
				continue;
			}

			$ids[] = $post_id;
		}

		return $ids;
	}

	/**
	 * Which post holds one slot of a campaign.
	 *
	 * Record first, post meta second — the same two paths as everything else
	 * here, for the same reason: a removed campaign has no record and its
	 * posts still have to be reachable.
	 *
	 * @return int post id, or 0 if there is none
	 */
	public static function post_for_slot( $campaign_id, $slot_index ) {
		$campaign = IE_Campaigns::get( $campaign_id );

		if ( $campaign && ! empty( $campaign['slots'] ) ) {
			foreach ( $campaign['slots'] as $slot ) {
				if ( (int) $slot['index'] === (int) $slot_index ) {
					return isset( $slot['post_id'] ) ? (int) $slot['post_id'] : 0;
				}
			}

			return 0;
		}

		foreach ( self::campaign_post_ids( $campaign_id ) as $post_id ) {
			if ( (int) get_post_meta( $post_id, '_ie_slot', true ) === (int) $slot_index ) {
				return (int) $post_id;
			}
		}

		return 0;
	}

	/** How many posts one repair pass will look at. */
	const MAX_REPAIR_POSTS = 200;

	/**
	 * Which post would close the ring for one that has lost a forward link.
	 *
	 * THE RING CLOSES BACKWARDS TO THE FIRST POST. linkPlan.js gives the last
	 * slot of a campaign `next = slots[0]` — so when a campaign is cut short,
	 * the post that ends up last should point where the real last post would
	 * have: at the beginning. That is the sentence a person needs to write,
	 * and naming the target is the difference between a notice that reports a
	 * problem and one that hands over the fix.
	 *
	 * WHY THE PLUGIN DOES NOT WRITE IT ITSELF. The anchor text in the dead
	 * placeholder was chosen to describe the post that never arrived. Pointing
	 * those exact words at a different article gives a link that promises one
	 * thing and delivers another — worse for a reader, and worse for search,
	 * than no link at all. A person can write a sentence that genuinely refers
	 * to the first post. This cannot.
	 *
	 * @return string the target's title, or '' if there is no sensible one
	 */
	public static function ring_close_target( $campaign_id, $except_post_id ) {
		$candidates = array();

		foreach ( self::campaign_post_ids( $campaign_id ) as $post_id ) {
			$post_id = (int) $post_id;

			if ( $post_id === (int) $except_post_id ) {
				continue;
			}

			$post = get_post( $post_id );

			// Only somewhere a reader can actually go today.
			if ( ! $post || 'publish' !== $post->post_status ) {
				continue;
			}

			$candidates[ (int) get_post_meta( $post_id, '_ie_slot', true ) ] = $post_id;
		}

		if ( empty( $candidates ) ) {
			return '';
		}

		// The earliest surviving post: where the ring closes back to.
		ksort( $candidates );
		$first = reset( $candidates );

		return (string) get_the_title( $first );
	}

	/**
	 * Go back and finish the link swaps that never happened.
	 *
	 * WHY THIS HAS TO EXIST AT ALL. The fix in 0.8.1 works at the moment a
	 * post publishes — it repairs the swap as it happens. Every post that
	 * published BEFORE that fix, under a campaign that had been removed, had
	 * its swap fail silently and nothing retries it. Those placeholders are
	 * frozen, not decaying: they will sit there for as long as the posts do.
	 *
	 * Nothing was lost when the campaign records went, which is the only
	 * reason this is possible. The campaign id and slot index are stamped on
	 * each post, and deleting an option does not touch post meta.
	 *
	 * THREE OUTCOMES PER PLACEHOLDER, and the middle one is the judgement:
	 *
	 *   the target is published   ->  swap it for a real link. This is the
	 *                                 work that was missed.
	 *   the target is gone        ->  unwrap it. Deleted, trashed, or never
	 *                                 written: no link is ever coming, and a
	 *                                 span that waits forever is just cruft.
	 *   the target is a draft or  ->  LEAVE IT. A paused campaign's posts are
	 *   still scheduled               drafts, and resuming publishes them. To
	 *                                 unwrap those would destroy the links of
	 *                                 a campaign that is merely paused.
	 *
	 * Safe to run twice: a span that has already become an anchor is not
	 * found again, and neither is one already unwrapped.
	 *
	 * @return array{restored:int,unwrapped:int,waiting:int,posts:int}
	 */
	public static function repair_links() {
		// 'short' maps the TITLE of each post left one link lighter to the post
		// that would close its ring. Unwrapping
		// is the right thing to do and still costs a link that was planned, so
		// the owner is told which post to look at rather than left to find it.
		$stats = array( 'restored' => 0, 'unwrapped' => 0, 'waiting' => 0, 'posts' => 0, 'titles' => 0, 'short' => array() );

		/* NOT 'trash'. Editing a post in the owner's bin would rewrite content
		 * they threw away and bump its modified date — the one thing that
		 * makes a deletion look like an edit. */
		$posts = get_posts( array(
			/* BOTH TYPES, UNCONDITIONALLY — the first pillar of a campaign may
			 * be a PAGE, because it is the site's home page.
			 *
			 * SAFE WITHOUT A BRANCH because this query is already bounded by
			 * meta_key '_ie_campaign': it can only ever reach content this
			 * plugin created. Widening it cannot touch the owner's own pages.
			 *
			 * A conditional here would be worse, not safer. It would need the
			 * campaign flag in a function that does not have it, and the
			 * failure mode of getting it wrong is silent — the page is simply
			 * never found, and nothing says so. */
			'post_type'        => array( 'post', 'page' ),
			'post_status'      => array( 'publish', 'future', 'draft', 'pending', 'private' ),
			'numberposts'      => self::MAX_REPAIR_POSTS,
			'fields'           => 'ids',
			'meta_key'         => '_ie_campaign',
			'suppress_filters' => false,
		) );

		foreach ( (array) $posts as $post_id ) {
			$post_id = (int) $post_id;
			$post    = get_post( $post_id );

			if ( ! $post ) {
				continue;
			}

			/* BACKFILL THE SEO TITLE, for posts published before the plugin
			 * started writing it.
			 *
			 * insert_post() sets it now, but a post already on the site keeps
			 * whatever meta it was given — which was none — so its <title>
			 * goes on carrying "- Site Name" for ever. Every one of those is a
			 * live search result with the domain eating the end of a headline.
			 *
			 * DONE HERE rather than on upgrade: this pass already walks every
			 * post carrying _ie_campaign, is already capped, and is already
			 * described as safe to run more than once. A second walk of the
			 * same posts to set one meta key would be a second thing to
			 * remember.
			 *
			 * ABOVE the campaign-record check on purpose. A post whose
			 * campaign was removed still has a title tag, and it is still
			 * wrong. Nothing about this needs the record.
			 *
			 * Never overwrites: a title somebody edited by hand is theirs. */
			$prefix = IE_Settings::active_theme_prefix();

			if ( $prefix && '' === (string) get_post_meta( $post_id, $prefix . '_page_title', true ) ) {
				$headline = (string) $post->post_title;

				if ( '' !== $headline ) {
					update_post_meta( $post_id, '_ie_meta_title', $headline );
					update_post_meta( $post_id, $prefix . '_page_title', $headline );
					$stats['titles']++;
				}
			}

			$campaign_id = get_post_meta( $post_id, '_ie_campaign', true );
			if ( ! $campaign_id ) {
				continue;
			}

			$pending = IE_Links::pending_ids( $post->post_content );
			if ( empty( $pending ) ) {
				continue;
			}

			$content = $post->post_content;
			$changed = false;

			foreach ( $pending as $token ) {
				if ( ! preg_match( '/^slot-(\d+)$/', $token, $m ) ) {
					// Not a token this plugin writes. Leave it alone entirely
					// rather than guessing what somebody else's markup means.
					continue;
				}

				$slot_index = (int) $m[1];
				$target_id  = self::post_for_slot( $campaign_id, $slot_index );
				$target     = $target_id ? get_post( $target_id ) : null;

				if ( $target && 'publish' === $target->post_status ) {
					$result = IE_Links::activate( $content, $token, get_permalink( $target_id ) );

					if ( $result['count'] ) {
						$content             = $result['content'];
						$changed             = true;
						$stats['restored']  += $result['count'];
					}

					continue;
				}

				if ( ! $target || 'trash' === $target->post_status ) {
					$result = IE_Links::unwrap( $content, $token );

					if ( $result['count'] ) {
						$content             = $result['content'];
						$changed             = true;
						$stats['unwrapped'] += $result['count'];

						$title = get_the_title( $post_id );

						if ( $title && ! isset( $stats['short'][ $title ] ) ) {
							// Keyed by title so a post that lost two links is
							// named once, and the lookup below runs once too.
							$stats['short'][ $title ] = self::ring_close_target( $campaign_id, $post_id );
						}
					}

					continue;
				}

				// A draft or a future post. Its day may still come.
				$stats['waiting']++;
			}

			if ( ! $changed ) {
				continue;
			}

			wp_update_post( array(
				'ID'                => $post_id,
				'post_content'      => $content,
				// Explicit, so the re-crawl signal is not left to chance —
				// a restored link nobody crawls is not a restored link.
				'post_modified'     => current_time( 'mysql' ),
				'post_modified_gmt' => current_time( 'mysql', 1 ),
			) );

			$stats['posts']++;
		}

		self::log( sprintf( 'link repair: %d restored, %d unwrapped, %d still waiting, across %d post(s)',
			$stats['restored'], $stats['unwrapped'], $stats['waiting'], $stats['posts'] ) );

		return $stats;
	}

	/**
	 * How many of a campaign's posts are live, and how many are not.
	 *
	 * For the confirmation dialogs, which have to name the damage BEFORE it is
	 * done — "4 published articles and 8 drafts" is the only part of that
	 * sentence a reader can act on.
	 *
	 * Counted from the posts rather than from slot statuses. A slot says what
	 * the plugin last heard; the post says what is on the site now, and the
	 * two disagree exactly when somebody has been editing by hand — which is
	 * the moment a confirmation dialog most needs to be right.
	 *
	 * @return array{published:int,drafts:int}
	 */
	public static function count_campaign_posts( $campaign_id ) {
		$counts = array( 'published' => 0, 'drafts' => 0 );

		foreach ( self::campaign_post_ids( $campaign_id ) as $post_id ) {
			$post = get_post( $post_id );

			if ( ! $post || 'trash' === $post->post_status ) {
				continue;
			}

			if ( 'publish' === $post->post_status ) {
				$counts['published']++;
			} else {
				$counts['drafts']++;
			}
		}

		return $counts;
	}

	/**
	 * Move every post a campaign made to Trash.
	 *
	 * TRASH, NOT DELETE, and that is the whole reason this is allowed to exist
	 * at all. wp_delete_post() is final; wp_trash_post() gives the owner
	 * thirty days to discover that the campaign they threw away was the wrong
	 * one. A destructive action a customer cannot undo has no place behind a
	 * button on a settings screen, however many dialogs sit in front of it.
	 *
	 * Trashing is also how the server finds out: wp_trash_post fires the hook
	 * that queues a deleted-post report. The caller must flush that queue
	 * BEFORE deleting the local record — see handle_delete_campaign().
	 *
	 * @return array{published:int,drafts:int} what was actually trashed
	 */
	public static function remove_campaign_posts( $campaign_id ) {
		$counts = array( 'published' => 0, 'drafts' => 0 );

		foreach ( self::campaign_post_ids( $campaign_id ) as $post_id ) {
			$post = get_post( $post_id );

			if ( ! $post || 'trash' === $post->post_status ) {
				continue;
			}

			/* The same refusal activate_for_slot() makes. A slot's post_id is
			 * a small integer, and a stale record pointing at an unrelated
			 * page would put somebody's About page in the bin. */
			if ( ! get_post_meta( $post_id, '_ie_campaign', true ) ) {
				self::log( sprintf( 'refused to trash post %d: not created by this plugin', $post_id ) );
				continue;
			}

			if ( 'publish' === $post->post_status ) {
				$counts['published']++;
			} else {
				$counts['drafts']++;
			}

			wp_trash_post( $post_id );
		}

		self::log( sprintf( '%s: trashed %d published and %d unpublished post(s)',
			$campaign_id, $counts['published'], $counts['drafts'] ) );

		return $counts;
	}

	/**
	 * Remove a campaign: its posts, its record, and the server's belief in it.
	 *
	 * THE ORDER IS THE WHOLE FUNCTION, and it lives here rather than in the
	 * admin handler because a handler cannot be tested — it checks a nonce,
	 * checks capabilities and ends in a redirect. The sequence below is the
	 * part that breaks silently, so it belongs somewhere a test can drive it.
	 *
	 *   1. Trash the posts. wp_trash_post() fires the hook that queues a
	 *      deleted-post report, and that queue is built by looking each post
	 *      up in the campaign record — which still exists at this point.
	 *
	 *   2. Flush the queue NOW rather than leaving it to shutdown. Shutdown
	 *      runs after step 4, by which time the record is gone and
	 *      slot_report_due() finds nothing to report. The deletions would
	 *      never reach the server and the Blog Report would go on showing a
	 *      dozen live articles that are sitting in the bin.
	 *
	 *   3. Tell the server the campaign itself is gone — before step 4,
	 *      because the server's campaign id lives inside the record.
	 *
	 *   4. Only then delete the record.
	 *
	 * Every step but the first is a report that cannot be retried: once the
	 * record is gone no sweep can reach it. That is the strongest argument
	 * for the two dialogs in front of this, and for Pause campaign being the
	 * button people are pointed at first.
	 *
	 * @return array{published:int,drafts:int} what was moved to Trash
	 */
	public static function remove_campaign( $campaign_id ) {
		$campaign = IE_Campaigns::get( $campaign_id );

		$trashed = self::remove_campaign_posts( $campaign_id );

		self::flush_deleted_reports();

		if ( $campaign ) {
			$server_id = isset( $campaign['server_campaign_id'] ) && $campaign['server_campaign_id']
				? $campaign['server_campaign_id']
				: $campaign['id'];

			/* THE MOMENT IT HAPPENED, taken here and not on the server.
			 *
			 * The server used to stamp its own clock when the report arrived,
			 * which is the same thing only when the report arrives at once.
			 * When it does not — and on this account it did not for eight
			 * days — the date describes when the server found out, which is
			 * not a fact anybody wanted recorded. */
			$at = gmdate( 'c' );

			/* Cannot fail this call. IE_Api::removed() swallows its own errors
			 * and logs them — a site that is offline, or whose licence has
			 * been revoked, must still be able to remove a campaign from its
			 * own screen. */
			$result = IE_Api::removed( $server_id, $at );

			/* QUEUED WHEN IT DID NOT GET THROUGH, because the local record is
			 * deleted three lines below and nothing can rebuild this from it
			 * afterwards. The queue carries the id and the time and needs
			 * neither. */
			if ( is_wp_error( $result ) || ! IE_Settings::is_connected() ) {
				self::queue_removal( $server_id, $at );
			}
		}

		IE_Campaigns::delete( $campaign_id );

		return $trashed;
	}

	/**
	 * Trash the posts of a campaign that have NOT published.
	 *
	 * The other half of the pair, and the one most people want. Pause a
	 * campaign, decide the rest of it is wrong, and throw away what has not
	 * gone out — while everything already on the site stays exactly where it
	 * is, earning its keep.
	 *
	 * Doing this by hand means finding eight drafts among however many posts
	 * the site has and being sure none of them is something else. One button
	 * on the campaign that owns them is both safer and quicker.
	 *
	 * @return int how many were trashed
	 */
	public static function delete_remaining_drafts( $campaign_id ) {
		$gone = 0;

		foreach ( self::campaign_post_ids( $campaign_id ) as $post_id ) {
			$post = get_post( $post_id );

			if ( ! $post || 'trash' === $post->post_status ) {
				continue;
			}

			// THE LINE THAT MAKES THIS THE SAFE BUTTON. Anything the public
			// can already read is somebody's published work.
			if ( 'publish' === $post->post_status ) {
				continue;
			}

			if ( ! get_post_meta( $post_id, '_ie_campaign', true ) ) {
				self::log( sprintf( 'refused to trash post %d: not created by this plugin', $post_id ) );
				continue;
			}

			wp_trash_post( $post_id );
			$gone++;
		}

		self::log( sprintf( '%s: trashed %d unpublished post(s), published posts untouched',
			$campaign_id, $gone ) );

		return $gone;
	}

	/**
	 * Throw away what a paused campaign has left, and close it out.
	 *
	 * WHY 'cancelled' AND NOT 'completed'. The campaign produced four posts of
	 * twelve. Calling that completed is the small lie this codebase keeps
	 * getting punished for — "26 published of 48", "Published" on a post that
	 * was deleted, "Overdue" on a post that no longer exists. Six months on,
	 * nobody could tell it apart from a campaign that ran its course.
	 *
	 * 'cancelled' already meant exactly this — the schema documents it as
	 * "abandoned" — and the server already refuses to write or publish for a
	 * cancelled campaign, which is precisely the behaviour wanted here. It had
	 * never been set because nothing had ever had cause to. This is that
	 * cause.
	 *
	 * ONLY WHEN SOMETHING WAS ACTUALLY ABANDONED. A campaign whose posts had
	 * all published already has nothing to throw away, and marking that one
	 * cancelled would be the same lie in the other direction.
	 *
	 * @return int how many posts were moved to Trash
	 */
	public static function abandon_remaining( $campaign_id ) {
		$gone = self::delete_remaining_drafts( $campaign_id );

		if ( $gone > 0 ) {
			// paused_at goes with it: the campaign is not paused any more,
			// it is over, and a leftover timestamp would have resume trying
			// to shift dates that no longer exist.
			IE_Campaigns::set_status( $campaign_id, 'cancelled', array( 'paused_at' => null ) );
		}

		return $gone;
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
		if ( '' === $campaign_id || '' === $url ) {
			return 0;
		}

		$token = IE_Campaigns::slot_token( $slot_index );
		$total = 0;

		// NOT `$campaign['slots']`. A removed campaign has no record and its
		// posts still need their links — see the long note in on_transition().
		foreach ( self::campaign_post_ids( $campaign_id, $slot_index ) as $post_id ) {
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
	/**
	 * Remember a removal whose report did not get through.
	 *
	 * Deduplicated on the campaign id, keeping the FIRST time recorded: a
	 * customer who removes, reinstalls and removes again should keep the
	 * original date, which is the same rule markRemoved() applies on the
	 * server.
	 */
	public static function queue_removal( $campaign_id, $at ) {
		$queue = get_option( self::PENDING_REMOVALS, array() );
		$queue = is_array( $queue ) ? $queue : array();

		foreach ( $queue as $row ) {
			if ( isset( $row['id'] ) && (string) $row['id'] === (string) $campaign_id ) {
				return false;
			}
		}

		$queue[] = array( 'id' => (string) $campaign_id, 'at' => (string) $at );

		if ( count( $queue ) > self::MAX_PENDING_REMOVALS ) {
			$queue = array_slice( $queue, -self::MAX_PENDING_REMOVALS );
		}

		update_option( self::PENDING_REMOVALS, $queue, false );
		self::log( sprintf( 'removal of %s queued for retry (%s)', $campaign_id, $at ) );

		return true;
	}

	/**
	 * Retry the removals that never reached the server.
	 *
	 * ONLY DROPS A ROW ON SUCCESS, the same rule send_slot_reports() follows
	 * and for the same reason: one unreachable minute must not become
	 * permanent silence about something that really happened.
	 *
	 * @return int how many were finally reported
	 */
	public static function flush_removed_reports() {
		$queue = get_option( self::PENDING_REMOVALS, array() );
		$queue = is_array( $queue ) ? $queue : array();

		if ( empty( $queue ) || ! IE_Settings::is_connected() ) {
			return 0;
		}

		$left = array();
		$sent = 0;

		foreach ( $queue as $row ) {
			$id = isset( $row['id'] ) ? (string) $row['id'] : '';
			$at = isset( $row['at'] ) ? (string) $row['at'] : '';

			if ( '' === $id ) {
				continue;
			}

			$result = IE_Api::removed( $id, $at );

			if ( is_wp_error( $result ) ) {
				$left[] = $row;
				continue;
			}

			$sent++;
		}

		update_option( self::PENDING_REMOVALS, $left, false );

		if ( $sent ) {
			self::log( sprintf( '%d queued removal(s) finally reported', $sent ) );
		}

		return $sent;
	}

	public static function run_catch_up() {
		$rescued = self::publish_missed();

		/* BEFORE the early return below, for the same reason sweep_deleted()
		 * is: a site whose campaigns have all finished takes that return on
		 * every run, and a site that removed a campaign while it could not
		 * reach the server is very often exactly that site. */
		self::flush_removed_reports();

		/* BEFORE THE EARLY RETURN BELOW, deliberately.
		 *
		 * A site whose campaigns have all finished has no work pending, so it
		 * takes that return on every single run — and a finished campaign is
		 * exactly the kind whose posts get tidied up months later. Putting the
		 * sweep after it would mean the sites most likely to have deleted
		 * posts were the ones that never looked. */
		$reported = self::sweep_deleted();

		$pending = IE_Campaigns::campaigns_with_work();
		if ( empty( $pending ) ) {
			return array( 'rescued' => $rescued, 'ran' => 0, 'reported' => $reported );
		}

		// One campaign per run. A site catching up on a month of work should
		// not try to do all of it inside one request.
		$next = $pending[0];
		self::run_campaign( $next );

		return array( 'rescued' => $rescued, 'ran' => 1, 'reported' => $reported );
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
	 * campaign was paused, and resume would publish something they had
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

		/* A FINISHED CAMPAIGN CANNOT BE PAUSED, and hiding the button is not
		 * the same as refusing the action.
		 *
		 * The Completed tab offered "Pause campaign" on campaigns with every
		 * post already live. It held nothing back — there was nothing to hold
		 * — announced "0 scheduled posts were held as drafts", and set the
		 * status to paused regardless. The next sweep reported that status to
		 * Three Comets, which takes a site's word on paused, so a campaign
		 * that had genuinely finished was recorded as paused in the blog
		 * report, with nothing on the site to say it had happened.
		 *
		 * The button is gone now. A stale tab still has the URL and the nonce,
		 * and an instruction with no check behind it is a hope. */
		if ( IE_Campaigns::is_finished( $campaign ) ) {
			return new WP_Error(
				'ie_campaign_finished',
				__( 'That campaign has finished. There is nothing left to pause.', 'interlink-engine' )
			);
		}

		// The status goes first. Everything below can fail on one post without
		// the campaign being left running, and a half-paused campaign that
		// still thinks it is active would collect more posts on the next cron.
		IE_Campaigns::set_status( $campaign_id, 'paused', array(
			// ISO 8601 UTC, not 'mysql'. strtotime() reads a bare
			// 'Y-m-d H:i:s' in whatever timezone PHP is set to, so a stored
			// GMT string comes back shifted on any site not running UTC.
			'paused_at' => gmdate( 'c' ),

			/* CLEARED HERE TOO, not only on the next poll.
			 *
			 * run_campaign() clears it when the server stops saying 'writing',
			 * which is correct and can be an hour away — the sweep is hourly
			 * and a paused campaign is not polled on any other schedule. The
			 * spinner would sit there until then, which is the whole problem
			 * this field exists to end.
			 *
			 * The server may still be finishing the post already in flight.
			 * That is fine: the batch is stopping, and a spinner that says
			 * "writing" for the last thirty seconds of a batch nobody can add
			 * to is more misleading than one that stops a moment early. */
			'writing_since' => '',
		) );

		/* TELL THE SERVER NOW, because the thing most worth stopping is the
		 * thing that is happening this second.
		 *
		 * Everything else pause does is local and reversible. A batch is
		 * neither: it writes at roughly one article a minute and charges 75
		 * credits each, and until this line existed the server did not learn
		 * about a pause until the next hourly reconciliation. Edwin pressed
		 * Pause a few seconds after approving eleven articles; all eleven
		 * were written and 825 credits were charged.
		 *
		 * NOT TRUSTED TO ARRIVE. A failure here is logged and ignored — the
		 * pause itself has already happened locally and must not be rolled
		 * back over a network error — and run_campaign() re-sends it on every
		 * sweep while the campaign stays paused. One fast attempt plus a slow
		 * reliable one; neither alone is good enough.
		 *
		 * SENT BEFORE the posts are held below, because that loop walks every
		 * slot and can take a moment on a 52-post campaign, and every moment
		 * here is potentially another article. */
		$server_id = isset( $campaign['server_campaign_id'] )
			? $campaign['server_campaign_id']
			: $campaign_id;

		$stop = IE_Api::write( $server_id, array(), true );

		if ( is_wp_error( $stop ) ) {
			self::log( sprintf(
				'%s: could not tell the server to stop writing: %s',
				$campaign_id,
				$stop->get_error_message()
			) );
		}

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

		/* The same refusal, for the same reason. Resuming a cancelled campaign
		 * would set it back to active with slots naming posts that were binned
		 * — it would leave the Completed tab, sit on the running tab for ever
		 * with nothing to do, and report itself active to the server. */
		if ( IE_Campaigns::is_finished( $campaign ) ) {
			return new WP_Error(
				'ie_campaign_finished',
				__( 'That campaign has finished. There is nothing left to resume.', 'interlink-engine' )
			);
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
			// while the campaign was paused. Whatever they did wins — this
			// only undoes its own change.
			if ( 'draft' !== $post->post_status ) {
				delete_post_meta( $post_id, self::HELD_META );
				continue;
			}

			$when = strtotime( $held ) + $shift;

			if ( $when <= time() ) {
				// Its turn came and went while the campaign was paused, which
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

		/* AND TELL THE SERVER, which is the half this did not do.
		 *
		 * THE MIRROR OF WHAT pause() ALREADY DOES. Pause stopped being
		 * WordPress-only on 6 October: it sends its cancel immediately and
		 * lets the sweep re-send it, because the thing most worth stopping is
		 * the thing happening this second. Resume was left as the local half
		 * of a pair whose other half had grown a second half — it moved the
		 * post dates, set the status back to active, and redirected.
		 *
		 * So the posts the batch had not written yet waited for the next
		 * server ping or the hourly cron, writing_since stayed empty, and the
		 * card showed nothing at all: no spinner, no progress, no sign that
		 * Resume had done anything beyond changing a word on the screen.
		 * Edwin resumed a campaign with three posts left, saw a dead page,
		 * pressed "Check now" — and THAT is what started the writing. Check
		 * now is a fallback for the automatic collection. It should not be
		 * the only thing that works.
		 *
		 * run_campaign() RATHER THAN IE_Api::write() DIRECTLY, because the
		 * answer has to be recorded as well as asked for. run_campaign() is
		 * what stamps writing_since from the server's reply, and
		 * writing_since is what the spinner watches. Calling the API here
		 * would start the batch and still leave the screen silent, which is
		 * the same bug with one more request in it.
		 *
		 * NOT ALLOWED TO START WHAT NOBODY APPROVED, and this guard no longer
		 * lives here.
		 *
		 * It did, for a day. pause() has no approval check — it refuses a
		 * finished campaign and nothing else — so a campaign that was planned
		 * and never approved can be paused and resumed like any other, and an
		 * unapproved resume reaching run_campaign() would have started and
		 * CHARGED for a batch nobody agreed to. So resume() tested
		 * batch_started before polling.
		 *
		 * THAT WAS THE RIGHT CHECK IN THE WRONG PLACE. run_campaign() has
		 * three callers — this one, the hourly cron, and the server's ping —
		 * and fixing the one in front of me left two unguarded while the
		 * screens read as covered. The same shape as every other bug this
		 * week. The question belongs to run_campaign(), which now asks it of
		 * everybody and defaults to refusing, so this call needs no guard and
		 * no argument: it passes no $may_start, which means "do not start
		 * anything that costs money".
		 *
		 * NOT ALLOWED TO FAIL THE RESUME EITHER. The posts are already back
		 * on the schedule — that happened above, locally, and must not be
		 * rolled back over a network error. A failure is logged and the
		 * release count is returned as if nothing had been asked, which
		 * leaves the campaign active with work pending: exactly the state the
		 * sweep picks up. One fast attempt plus a slow reliable one, the same
		 * arrangement pause() has. */
		$poll = self::run_campaign( $campaign_id );

		if ( is_wp_error( $poll ) ) {
			self::log( sprintf( '%s: resumed, but the server could not be reached: %s',
				$campaign_id, $poll->get_error_message() ) );
		}

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
			// Both types: see the note on the sibling query above. Bounded by
			// _ie_campaign, so it cannot reach the owner's own pages.
			'post_type'      => array( 'post', 'page' ),
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
