<?php
/**
 * Campaign storage.
 *
 * WHO OWNS WHAT
 *
 * The SERVER owns the plan and the money: which slots exist, what they link
 * to, whether one has been generated and charged for. It has to, because it is
 * the side that spends credits, and a truth about billing cannot live on
 * hardware the customer controls.
 *
 * This side owns everything that is a WordPress fact: which slot became which
 * post, the slug WordPress actually assigned, and the placeholder state inside
 * the post content. The server cannot know those.
 *
 * So a campaign here is a MIRROR of the server's plan plus the local facts,
 * and `server_campaign_id` is the join. Where the two disagree about a slot's
 * state, the server wins — it is the one that took the money.
 *
 * SLOTS ARE ADDRESSED BY INDEX
 *
 * An integer, matching the server's `slotIndex`. An earlier version used
 * string ids ('topic-3') generated on this side, which meant two id spaces for
 * one thing and no reliable way to say "the slot the server just charged for".
 * The placeholder token in post content is 'slot-<index>', which is what the
 * server emits and what IE_Links::activate() searches for.
 *
 * Stored as one option rather than a custom post type: a site has a handful of
 * campaigns, not thousands, and keeping the whole plan in one addressable
 * place means the ring can never be half-read.
 *
 * @package interlink-engine
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class IE_Campaigns {

	const OPTION = 'ie_campaigns';

	public static function all() {
		$c = get_option( self::OPTION, array() );
		return is_array( $c ) ? $c : array();
	}

	public static function get( $id ) {
		$all = self::all();
		return isset( $all[ $id ] ) ? $all[ $id ] : null;
	}

	public static function save( $campaign ) {
		$all = self::all();
		$all[ $campaign['id'] ] = $campaign;
		update_option( self::OPTION, $all, false );
		return $campaign;
	}

	public static function delete( $id ) {
		$all = self::all();
		unset( $all[ $id ] );
		update_option( self::OPTION, $all, false );
	}

	/**
	 * Store the plan the server produced.
	 *
	 * Normalised on the way in. The server is ours, but a response that has
	 * been through JSON and a version skew is still outside data, and a missing
	 * key here becomes a fatal on a customer's site.
	 */
	public static function create_from_plan( $plan, $settings ) {
		$server_id = isset( $plan['campaignId'] ) ? sanitize_text_field( $plan['campaignId'] ) : '';

		if ( '' === $server_id ) {
			return new WP_Error( 'ie_no_campaign_id', 'The server did not return a campaign id.' );
		}

		// Keyed by the SERVER's id. One campaign, one identity, on both sides —
		// and re-planning the same campaign updates it rather than creating a
		// duplicate that would fight with the original over the same slots.
		$id = $server_id;

		/**
		 * Per-article videos, matched to slots by TOPIC TEXT.
		 *
		 * The owner typed these against rows on a form; the slots came back
		 * from the server. Matching on row number would look correct and be
		 * wrong the first time the server drops or reorders a topic — each
		 * video would land on its neighbour's article, silently.
		 */
		$slot_videos = isset( $settings['slot_videos'] ) && is_array( $settings['slot_videos'] )
			? $settings['slot_videos']
			: array();

		$slots = array();
		foreach ( (array) ( isset( $plan['slots'] ) ? $plan['slots'] : array() ) as $i => $s ) {
			$index = isset( $s['index'] ) ? (int) $s['index'] : $i;
			$topic = isset( $s['topic'] ) ? $s['topic'] : '';
			$key   = strtolower( sanitize_text_field( $topic ) );

			$slots[] = array(
				'index'        => $index,
				'topic'        => $topic,
				// '' means "use the campaign's video", not "no video".
				'video_url'    => isset( $slot_videos[ $key ] ) ? $slot_videos[ $key ] : '',
				'target_query' => isset( $s['targetQuery'] ) ? $s['targetQuery'] : '',
				'publish_at'   => isset( $s['publishAt'] ) ? $s['publishAt'] : '',

				/**
				 * Local state, and it has three stops rather than two now:
				 *
				 *   pending    the server has written it, this side has not
				 *              made a post from it yet
				 *   scheduled  a WordPress post exists, dated, not yet public
				 *   published  WordPress has made it public
				 *
				 * 'scheduled' is the one that is new, and it is where a post
				 * spends most of its life — eleven weeks of a twelve-week
				 * campaign. It used to be called 'written' and meant both
				 * things at once, which was fine when a post was inserted on
				 * the day it published and is wrong now that it is not.
				 */
				'status'        => 'pending',
				'post_id'       => 0,
				'slug'          => '',
				'url'           => '',
				'scheduled_for' => '',
				'written_at'    => '',
				'published_at'  => '',
				'error'         => '',
			);
		}

		$campaign = array(
			'id'                 => $id,
			'server_campaign_id' => $server_id,
			'created'            => current_time( 'mysql' ),
			'status'             => 'active',
			'label'              => isset( $settings['label'] ) ? $settings['label'] : '',

			/**
			 * A PILLAR CAMPAIGN: hub articles ringed to one another, with no
			 * money page. A later campaign points at one of them.
			 *
			 * READ FROM THE PLAN, NOT FROM $settings. wp-admin posted the
			 * checkbox, so it already "knows" — and that is the trap. Two
			 * copies of one fact, written by two sides, disagree the first
			 * time a form is resubmitted or the server declines the flag for
			 * a reason this side did not model. The campaign the server
			 * actually created is the only authority on what it is, and
			 * /api/blog/plan echoes the flag back for exactly this read.
			 *
			 * IE_Publisher reads this to stamp IE_Settings::PILLAR_META onto
			 * each post, which is what later puts the pillar in the Target
			 * Page dropdown.
			 */
			'is_pillar'          => ! empty( $plan['isPillar'] ),

			/**
			 * The campaign's FIRST post becomes this site's home page.
			 *
			 * "its first post is the home page", not "every post in it is a
			 * page". IE_Publisher tests the flag AND a slot index of 0; the
			 * flag alone would turn all twenty into Pages.
			 *
			 * STORED HERE RATHER THAN SENT TO THE SERVER. Which post type
			 * WordPress uses and which page sits at the root are facts about
			 * this site, not about the campaign the server planned — the
			 * server writes identical content either way. The same reasoning
			 * keeps video_url on this side.
			 */
			'home_page'          => ! empty( $settings['home_page'] ),

			/**
			 * EMPTY FOR A PILLAR CAMPAIGN, and every reader has to cope.
			 *
			 * The `: array()` fallback has been here all along, but nothing
			 * ever produced an absent target page before — so the campaign
			 * screens index straight into ['url'] and ['title']. A default
			 * that was never exercised is not a default; it is a line of code
			 * that has never run.
			 */
			'target_page'        => isset( $settings['target_page'] ) ? $settings['target_page'] : array(),
			'every_days'         => isset( $settings['every_days'] ) ? (int) $settings['every_days'] : 7,
			/**
			 * 'future' or 'draft'.
			 *
			 * It was 'publish' or 'draft', because a post was inserted on the
			 * day it was meant to appear and so publishing it meant publishing
			 * it now. Posts are now created weeks ahead, so the equivalent
			 * choice is "let WordPress publish it on the day" — which is what
			 * post_status 'future' means — against "hold it as a draft for me
			 * to approve".
			 *
			 * A stored 'publish' from before this change reads as 'future',
			 * which is what the owner meant by it.
			 */
			'publish_mode'       => ( isset( $settings['publish_mode'] ) && 'draft' === $settings['publish_mode'] ) ? 'draft' : 'future',
			/**
			 * One optional video, placed into every post in this campaign.
			 *
			 * Stored here rather than on each slot because it is a campaign
			 * decision, not a per-post one — and because a field the owner has
			 * to fill in twelve times is a field that ends up empty.
			 */
			'video_url'          => isset( $settings['video_url'] ) ? $settings['video_url'] : '',
			'slots'              => $slots,
			// Shown on the campaign card so the owner sees what a campaign will
			// cost before its first post is written, not after.
			'quote'              => isset( $plan['quote'] ) ? $plan['quote'] : array(),
		);

		return self::save( $campaign );
	}

	/**
	 * A campaign's status, and what each one stops.
	 *
	 *   active    the normal state. Posts are collected from the server,
	 *             WordPress publishes them on their dates, and the catch-up
	 *             sweep fixes missed schedules.
	 *   paused    the emergency stop. Nothing new is collected and nothing
	 *             publishes. Note that the status alone would NOT stop posts
	 *             going live — WordPress publishes `future` posts itself and
	 *             has never heard of this plugin — so IE_Publisher::pause()
	 *             also holds each scheduled post as a draft. That is the half
	 *             that does the actual stopping.
	 *
	 * There was a third, 'cancelled', read in two places and written in none.
	 * It stays readable so a campaign stored by an older version still behaves,
	 * but the guards below now ask "is this active?" rather than naming one
	 * dead status — otherwise every state added later is silently treated as
	 * running, which is how 'paused' would have leaked into the schedule
	 * screens as a pile of overdue rows.
	 */
	public static function set_status( $id, $status, $extra = array() ) {
		$campaign = self::get( $id );
		if ( ! $campaign ) {
			return null;
		}

		$campaign['status'] = $status;

		// null removes a key rather than storing a null — 'paused_at' should
		// not survive a resume as an empty string that still looks set.
		foreach ( $extra as $key => $value ) {
			if ( null === $value ) {
				unset( $campaign[ $key ] );
			} else {
				$campaign[ $key ] = $value;
			}
		}

		return self::save( $campaign );
	}

	/**
	 * What to call a campaign on screen.
	 *
	 * ONE DEFINITION, because there is no 'name' key. The record carries an
	 * optional 'label' and a target_page title, and the card has always used
	 * one or the other. A second place reaching for $campaign['name'] got an
	 * undefined-key warning and an empty string — in a confirmation dialog, so
	 * it read 'Remove ""?' at the exact moment a reader needs to know which
	 * campaign they are about to destroy.
	 */
	public static function label_of( $campaign ) {
		if ( ! is_array( $campaign ) ) {
			return '';
		}

		if ( ! empty( $campaign['label'] ) ) {
			return (string) $campaign['label'];
		}

		return isset( $campaign['target_page']['title'] )
			? (string) $campaign['target_page']['title']
			: '';
	}

	public static function is_paused( $campaign ) {
		return is_array( $campaign ) && isset( $campaign['status'] ) && 'paused' === $campaign['status'];
	}

	/**
	 * Has this campaign finished? Nothing left to publish, ever.
	 *
	 * ONE DEFINITION, and it was two. The Campaigns screen decided which tab a
	 * campaign belonged on by counting unpublished slots, and every other part
	 * of the screen simply did not ask. So a campaign sitting on the Completed
	 * tab — four of four live, nothing outstanding — was still offered
	 * "Pause campaign", and its heading still said "publishing on schedule".
	 *
	 * The heading was only wrong. The button was worse: pressing it set the
	 * campaign's status to paused, held nothing back because there was nothing
	 * to hold, and announced "0 scheduled posts were held as drafts". The
	 * sweep then reported `paused` to Three Comets, which accepts a site's
	 * word on paused, and a campaign that had genuinely finished was recorded
	 * as paused in the blog report. A no-op button that corrupts a record is
	 * the worst kind: nothing appears to happen, so nobody goes looking.
	 *
	 * A CANCELLED CAMPAIGN IS FINISHED whatever its slots say. Its unpublished
	 * posts were thrown away, so the slots that named them go on reading
	 * 'scheduled' for posts that do not exist — outstanding work that is never
	 * coming.
	 *
	 * A campaign whose batch never started is NOT finished; it has not begun.
	 * That is the Drafts tab, and bucket() splits it off first.
	 */
	public static function is_finished( $campaign ) {
		if ( ! is_array( $campaign ) || empty( $campaign['batch_started'] ) ) {
			return false;
		}

		if ( isset( $campaign['status'] ) && 'cancelled' === $campaign['status'] ) {
			return true;
		}

		foreach ( (array) $campaign['slots'] as $slot ) {
			if ( ! isset( $slot['status'] ) || 'published' !== $slot['status'] ) {
				return false;
			}
		}

		return true;
	}

	/** Find a slot by index. Returns [ position, slot ] or null. */
	public static function find_slot( $campaign, $slot_index ) {
		foreach ( $campaign['slots'] as $i => $slot ) {
			if ( (int) $slot['index'] === (int) $slot_index ) {
				return array( $i, $slot );
			}
		}
		return null;
	}

	public static function update_slot( $campaign_id, $slot_index, $changes ) {
		$campaign = self::get( $campaign_id );
		if ( ! $campaign ) {
			return null;
		}

		foreach ( $campaign['slots'] as $i => $slot ) {
			if ( (int) $slot['index'] === (int) $slot_index ) {
				$campaign['slots'][ $i ] = array_merge( $slot, $changes );
				return self::save( $campaign );
			}
		}

		return $campaign;
	}

	/**
	 * The placeholder token for a slot.
	 *
	 * ONE definition, because it has to match what the server wrote into the
	 * post content — utils/blog/linkPlan.js emits `slot-${index}`. If these
	 * two ever disagree, placeholders are never swapped and no error is
	 * raised: the spans simply sit there as plain text forever.
	 */
	public static function slot_token( $slot_index ) {
		return 'slot-' . (int) $slot_index;
	}

	/**
	 * Campaigns with posts still to collect from the server.
	 *
	 * THIS REPLACES due_slots(), AND THE CHANGE OF MEANING IS THE WHOLE
	 * REDESIGN IN ONE FUNCTION.
	 *
	 * It used to answer "which slot's publish date has arrived?", because the
	 * date was when a post got written. The date no longer has anything to do
	 * with writing — everything is written when the campaign is approved, and
	 * WordPress publishes on the date by itself.
	 *
	 * So the question now is simply "is anything still waiting to come over?",
	 * and the answer has no dates in it at all.
	 *
	 * @return string[] campaign ids, oldest first
	 */
	public static function campaigns_with_work() {
		$ids = array();

		foreach ( self::all() as $campaign ) {
			if ( 'active' !== $campaign['status'] ) {
				continue;
			}

			foreach ( $campaign['slots'] as $slot ) {
				if ( 'pending' === $slot['status'] ) {
					$ids[] = $campaign['id'];
					break;
				}
			}
		}

		return $ids;
	}

	/**
	 * Scheduled posts whose date has passed and which are still not public.
	 *
	 * WordPress publishes future posts through WP-Cron, and WP-Cron fires when
	 * somebody visits the site. These sites have no visitors — that is why the
	 * owner is buying posts — so a missed schedule is the normal case here.
	 * This is what the sweep looks for.
	 *
	 * A grace period, because a post is not late the instant its minute
	 * arrives: cron runs on its own rhythm and the two clocks are not the same.
	 */
	public static function missed_schedule( $now = null, $grace = 900 ) {
		$now    = ( $now ? $now : time() ) - $grace;
		$missed = array();

		foreach ( self::all() as $campaign ) {
			if ( 'active' !== $campaign['status'] ) {
				continue;
			}

			foreach ( $campaign['slots'] as $slot ) {
				if ( 'scheduled' !== $slot['status'] || empty( $slot['post_id'] ) ) {
					continue;
				}

				$at = $slot['publish_at'] ? strtotime( $slot['publish_at'] ) : 0;

				if ( $at && $at <= $now ) {
					$missed[] = array(
						'campaign_id' => $campaign['id'],
						'slot_index'  => (int) $slot['index'],
						'post_id'     => (int) $slot['post_id'],
						'at'          => $at,
					);
				}
			}
		}

		usort( $missed, function ( $a, $b ) {
			return $a['at'] <=> $b['at'];
		} );

		return $missed;
	}

	/**
	 * Every post still to come, across every campaign, in date order.
	 *
	 * WHY THIS HAS TO CROSS CAMPAIGNS
	 *
	 * A campaign knows its own dates and nothing else. Ask a site with four
	 * campaigns "what is publishing this week" and the answer is spread across
	 * four separate tables that each start from their own first post — so the
	 * one question an owner actually asks is the one question the screen
	 * cannot answer.
	 *
	 * Overdue posts are INCLUDED, and sort to the top where they belong. A
	 * post whose date has passed and which is still not public is the most
	 * important row on the page: it means WP-Cron has not run.
	 *
	 * @param int $limit  how many rows to return
	 * @return array [{ at, overdue, deleted, campaign_id, campaign, page, topic, status, post_id }]
	 */
	public static function upcoming( $limit = 10, $now = null ) {
		$now  = $now ? $now : time();
		$rows = array();

		foreach ( self::all() as $campaign ) {
			// "not active" rather than "cancelled". A paused campaign's posts
			// are drafts with dates that keep receding into the past, so
			// naming one dead status here would fill the screen with rows
			// marked overdue — the alarm that means WP-Cron has stopped.
			if ( 'active' !== $campaign['status'] ) {
				continue;
			}

			$label = ! empty( $campaign['label'] )
				? $campaign['label']
				: ( isset( $campaign['target_page']['title'] ) ? $campaign['target_page']['title'] : '' );

			foreach ( $campaign['slots'] as $slot ) {
				// Already out. Nothing to look forward to.
				if ( 'published' === $slot['status'] ) {
					continue;
				}

				$at = ! empty( $slot['publish_at'] ) ? strtotime( $slot['publish_at'] ) : 0;
				if ( ! $at ) {
					continue;
				}

				/* A slot whose post has been deleted is NOT overdue.
				 *
				 * "Overdue" is the alarm for WP-Cron having stopped. A post
				 * that no longer exists is never going to publish no matter
				 * how well the scheduler is running, and letting it raise
				 * that alarm sends whoever reads it to the wrong place — as
				 * it did, for an evening. See post_missing(). */
				$gone = self::post_missing( $slot );

				$rows[] = array(
					'at'          => $at,
					'deleted'     => $gone,
					'overdue'     => ( ! $gone && 'scheduled' === $slot['status'] && $at < $now ),
					'campaign_id' => $campaign['id'],
					'campaign'    => $label,
					'page'        => isset( $campaign['target_page']['title'] ) ? $campaign['target_page']['title'] : '',
					'topic'       => $slot['topic'],
					'status'      => $slot['status'],
					'post_id'     => isset( $slot['post_id'] ) ? (int) $slot['post_id'] : 0,
				);
			}
		}

		usort( $rows, function ( $a, $b ) {
			return $a['at'] <=> $b['at'];
		} );

		return array_slice( $rows, 0, max( 1, (int) $limit ) );
	}

	/**
	 * Days carrying more than one post.
	 *
	 * Two campaigns planned separately, both weekly at 9am, will sooner or
	 * later land on the same morning — and two posts appearing together on a
	 * blog that otherwise publishes once a week is precisely the pattern that
	 * reads as automated. Neither campaign can see this; only the merged view
	 * can.
	 *
	 * Grouped by LOCAL date, because the thing that looks wrong to a reader is
	 * two posts on one day in the site's own timezone.
	 *
	 * @return array [ 'Y-m-d' => count ] for days with two or more
	 */
	public static function collisions( $now = null ) {
		$now = $now ? $now : time();
		$by_day = array();

		foreach ( self::all() as $campaign ) {
			// A paused campaign cannot collide with anything: its posts are
			// drafts and no date they carry will be honoured until it resumes,
			// at which point every one of them moves anyway.
			if ( 'active' !== $campaign['status'] ) {
				continue;
			}

			foreach ( $campaign['slots'] as $slot ) {
				$at = ! empty( $slot['publish_at'] ) ? strtotime( $slot['publish_at'] ) : 0;

				// Only what is still to come. A clash that already happened is
				// history, and nothing on this screen can change it.
				if ( ! $at || $at < $now || 'published' === $slot['status'] ) {
					continue;
				}

				$day = wp_date( 'Y-m-d', $at );
				$by_day[ $day ] = isset( $by_day[ $day ] ) ? $by_day[ $day ] + 1 : 1;
			}
		}

		return array_filter( $by_day, function ( $count ) {
			return $count > 1;
		} );
	}

	/**
	 * Every post this campaign has created, keyed by slot index.
	 *
	 * Any slot that HAS a post, whether or not it is public yet — which is the
	 * change from the old version. A scheduled post is exactly as capable of
	 * holding a placeholder as a published one, and under write-ahead most of
	 * them do.
	 */
	public static function post_ids( $campaign ) {
		$ids = array();
		foreach ( $campaign['slots'] as $slot ) {
			if ( ! empty( $slot['post_id'] ) ) {
				$ids[ (int) $slot['index'] ] = (int) $slot['post_id'];
			}
		}
		return $ids;
	}

	/**
	 * Slot post ids that no longer exist on this site, looked up ONCE.
	 *
	 * null until the first call. See post_missing() for why any of this is
	 * needed at all.
	 */
	private static $live_post_ids = null;

	/**
	 * Has the post this slot points at been deleted?
	 *
	 * WHY THIS EXISTS
	 *
	 * A campaign is stored in wp_options. Its slots remember a topic, a date,
	 * a status and a post_id. Nothing in that record watches the post.
	 *
	 * So an owner who tidies up their blog — deletes a few posts they did not
	 * like — leaves every one of those slots frozen. The screen goes on
	 * reporting "Live" for a post that is gone, and "Overdue" for one that is
	 * never coming, because "Overdue" only means "status says scheduled and
	 * the date has passed".
	 *
	 * That is not a cosmetic problem. "Overdue" is this plugin's alarm for
	 * WP-Cron having stopped, so a deleted post raises an alarm about the
	 * scheduler — and the owner, or whoever they ask, goes looking for a
	 * publishing fault that does not exist. It cost an evening to find on a
	 * test site with five campaigns and a person who knew how the code worked.
	 *
	 * NO POST ID MEANS NOT WRITTEN YET, WHICH IS NOT THE SAME THING. That slot
	 * is "Arriving" and always was. Only a slot that HAS an id and cannot find
	 * it behind that id has lost something.
	 *
	 * TRASHED COUNTS AS GONE. A post in the trash will never publish on its
	 * schedule, so reporting it as still coming would be the same lie in a
	 * smaller hat. The wording says "deleted" and the tooltip mentions the
	 * trash, which is where an owner should look first.
	 *
	 * ONE QUERY, NOT ONE PER SLOT. Five campaigns of six slots is thirty
	 * lookups, and a MISSING post is never in the object cache, so each one
	 * would reach the database on every page load. Every id on the screen is
	 * fetched together the first time anything asks.
	 */
	public static function post_missing( $slot ) {
		$id = isset( $slot['post_id'] ) ? (int) $slot['post_id'] : 0;

		// Never written. "Arriving", not lost.
		if ( ! $id ) {
			return false;
		}

		if ( null === self::$live_post_ids ) {
			self::$live_post_ids = array();

			$wanted = array();
			foreach ( self::all() as $campaign ) {
				$slots = isset( $campaign['slots'] ) ? $campaign['slots'] : array();
				foreach ( $slots as $s ) {
					if ( ! empty( $s['post_id'] ) ) {
						$wanted[] = (int) $s['post_id'];
					}
				}
			}

			if ( $wanted ) {
				/* THE STATUS LIST IS THE DEFINITION OF "STILL THERE", so it is
				 * spelled out rather than left to 'any'.
				 *
				 * TRASH IS DELIBERATELY ABSENT. A post in the trash will never
				 * publish on its schedule and is not on the site, so it is
				 * gone for every purpose this function serves. Leaving it out
				 * is what makes a trashed post report as deleted.
				 *
				 * It was in this list until now, which is the bug this comment
				 * exists to stop coming back. The docblock above said "TRASHED
				 * COUNTS AS GONE" while the code below found trashed posts and
				 * called them alive, and the test that should have caught it
				 * asserted the string 'trash' APPEARED in this file — so it
				 * passed by confirming the fault. Source greps have now missed
				 * four bugs in this codebase. test-deleted-posts.php checks
				 * the behaviour through a status-aware stub instead. */
				$found = get_posts( array(
					'post__in'          => array_values( array_unique( $wanted ) ),
					'post_type'         => 'any',
					'post_status'       => array( 'publish', 'future', 'draft', 'pending', 'private' ),
					'posts_per_page'    => -1,
					'fields'            => 'ids',
					'no_found_rows'     => true,
					'ignore_sticky_posts' => true,
				) );

				self::$live_post_ids = array_map( 'absint', (array) $found );
			}
		}

		return ! in_array( $id, self::$live_post_ids, true );
	}

	/** For tests, and for anything that edits slots mid-request. */
	public static function forget_post_cache() {
		self::$live_post_ids = null;
	}

	/**
	 * How many of this campaign's slots have lost their post.
	 */
	public static function missing_count( $campaign ) {
		$slots = isset( $campaign['slots'] ) ? $campaign['slots'] : array();
		$gone  = 0;

		foreach ( $slots as $slot ) {
			if ( self::post_missing( $slot ) ) {
				$gone++;
			}
		}

		return $gone;
	}

	/**
	 * Which campaign slots point at this post id?
	 *
	 * For the delete hooks, which are handed a post id and nothing else.
	 *
	 * Returns a LIST, not one slot, because nothing enforces that a post id
	 * appears once. Two campaigns targeting the same page could in principle
	 * carry the same id after a restore from backup, and reporting one of them
	 * while silently dropping the other is the sort of thing that would go
	 * unnoticed for months.
	 *
	 * @return array[] each array( 'campaign_id' => string, 'index' => int )
	 */
	public static function slots_for_post( $post_id ) {
		$id  = (int) $post_id;
		$out = array();

		if ( ! $id ) {
			return $out;
		}

		foreach ( self::all() as $key => $campaign ) {
			$slots = isset( $campaign['slots'] ) ? $campaign['slots'] : array();

			foreach ( $slots as $slot ) {
				if ( ! empty( $slot['post_id'] ) && (int) $slot['post_id'] === $id ) {
					$out[] = array(
						'campaign_id' => (string) ( isset( $campaign['id'] ) ? $campaign['id'] : $key ),
						'index'       => (int) $slot['index'],
					);
				}
			}
		}

		return $out;
	}

	/**
	 * Campaigns whose set of missing posts differs from what the server was
	 * last told.
	 *
	 * THE WHOLE SET, NOT THE NEW ARRIVALS, because the server call is a
	 * RECONCILIATION: "these and only these are gone". That is what makes a
	 * post restored from the trash come back to life in the report. An
	 * events-only design cannot do it — there is no "undelete" hook worth
	 * relying on, and a customer who trashes a post by accident and puts it
	 * back would otherwise carry a Deleted mark against a live post forever,
	 * in the document they would use to check a bill.
	 *
	 * COMPARED AGAINST WHAT WAS LAST SENT, so a site with deleted posts does
	 * not make an HTTP call every hour for the rest of its life. Once the sets
	 * agree there is nothing to say, and nothing is said.
	 *
	 * An empty array for a campaign is meaningful and is NOT skipped: it means
	 * everything we previously reported gone has come back.
	 *
	 * IT ALSO CARRIES WHICH SLOTS ARE LIVE, and that half is here for the
	 * same reason the deletions are. "This post went live" is sent once, as
	 * an event, and nothing retries it. One rejected call and the server
	 * believes a published post is still scheduled — for ever. On one real
	 * site a week of rejected calls left twelve live posts recorded as
	 * pending, and no amount of waiting would have corrected it.
	 *
	 * @param string[]|null $only limit to these campaign ids; null means all.
	 *                            The shutdown flush passes the campaigns a
	 *                            deletion actually touched, so a bulk delete
	 *                            does not walk every campaign on the site.
	 * @return array campaign id => array of slot indexes currently missing
	 */
	public static function slot_report_due( $only = null ) {
		$out   = array();
		$limit = ( null === $only ) ? null : array_map( 'strval', (array) $only );

		foreach ( self::all() as $key => $campaign ) {
			$id = (string) ( isset( $campaign['id'] ) ? $campaign['id'] : $key );

			if ( null !== $limit && ! in_array( $id, $limit, true ) ) {
				continue;
			}

			$slots   = isset( $campaign['slots'] ) ? $campaign['slots'] : array();
			$missing = array();
			$live    = array();

			foreach ( $slots as $slot ) {
				$index = (int) $slot['index'];

				if ( self::post_missing( $slot ) ) {
					$missing[] = $index;
					continue;
				}

				/* LIVE MEANS THIS SIDE SAW IT PUBLISH.
				 *
				 * on_transition() writes this status BEFORE telling the
				 * server, so the local record is right even when the call
				 * that follows it fails. That asymmetry is the whole reason
				 * this exists: the site knows, and had no way to say so
				 * twice. */
				if ( isset( $slot['status'] ) && 'published' === $slot['status'] ) {
					$live[] = $index;
				}
			}

			$last_missing = ( isset( $campaign['deleted_reported'] ) && is_array( $campaign['deleted_reported'] ) )
				? array_map( 'intval', $campaign['deleted_reported'] )
				: array();

			$last_live = ( isset( $campaign['live_reported'] ) && is_array( $campaign['live_reported'] ) )
				? array_map( 'intval', $campaign['live_reported'] )
				: array();

			sort( $missing );
			sort( $live );
			sort( $last_missing );
			sort( $last_live );

			if ( $missing !== $last_missing || $live !== $last_live ) {
				$out[ $id ] = array( 'missing' => $missing, 'live' => $live );
			}
		}

		return $out;
	}

	/**
	 * Where the last campaign-list reconciliation is remembered.
	 *
	 * Its own option rather than a field on a campaign, because the thing it
	 * records is about campaigns that are NO LONGER HERE. Storing it inside
	 * the campaigns would mean losing it exactly when it is needed.
	 */
	const PRESENT_OPTION = 'ie_campaigns_reported';

	/**
	 * The campaign ids to send, or null when the server already agrees.
	 *
	 * Distinguishes "nothing to say" (null) from "this site has no campaigns"
	 * (an empty array) on purpose. They read the same and mean opposite
	 * things, and conflating them is how a reconciliation ends up announcing
	 * that everything is gone.
	 */
	public static function campaign_report_due() {
		$now = array();

		foreach ( self::all() as $key => $campaign ) {
			$now[] = array(
				'id'     => (string) ( isset( $campaign['id'] ) ? $campaign['id'] : $key ),
				'status' => isset( $campaign['status'] ) ? (string) $campaign['status'] : '',
			);
		}

		/* THE STATUS IS PART OF WHAT IS BEING REPORTED, so it is part of what
		 * decides whether there is anything to report.
		 *
		 * This compared the LIST OF IDS and nothing else — right when the ids
		 * were the whole message, and wrong the moment the sweep began
		 * carrying each campaign's status. Pausing a campaign does not change
		 * which campaigns exist, so the gate said "nothing has changed" and
		 * the pause was never sent. Two campaigns that had finished sat at
		 * "In progress" on the account page because their site had, by this
		 * measure, nothing to say.
		 *
		 * A gate that guards a payload has to be computed from that payload.
		 * The old option holds bare ids, so the first comparison after an
		 * upgrade never matches and the sweep speaks once — which is exactly
		 * what a site upgrading needs it to do. */
		$mark = self::report_fingerprint( $now );

		$last = get_option( self::PRESENT_OPTION, null );

		if ( ! is_array( $last ) ) {
			// Never reported. Say something, unless there is nothing to say.
			return $now ? $now : null;
		}

		$last = array_map( 'strval', $last );
		sort( $last );

		return ( $mark === $last ) ? null : $now;
	}

	/**
	 * What was sent, as a comparable list.
	 *
	 * One definition, used to write the record and to read it back, so the
	 * two cannot come to disagree about what "unchanged" means.
	 */
	public static function report_fingerprint( $campaigns ) {
		$out = array();

		foreach ( (array) $campaigns as $campaign ) {
			if ( is_array( $campaign ) ) {
				$id     = isset( $campaign['id'] ) ? (string) $campaign['id'] : '';
				$status = isset( $campaign['status'] ) ? (string) $campaign['status'] : '';
			} else {
				// A bare id, from a caller that has not been updated.
				$id     = (string) $campaign;
				$status = '';
			}

			if ( '' === $id ) {
				continue;
			}

			$out[] = $id . ':' . $status;
		}

		$out = array_values( array_unique( $out ) );
		sort( $out );

		return $out;
	}

	/** Remember what was sent, so the sweep stays quiet until it changes. */
	public static function mark_campaigns_reported( $campaigns ) {
		$mark = self::report_fingerprint( $campaigns );

		update_option( self::PRESENT_OPTION, $mark, false );

		return $mark;
	}

	public static function mark_slots_reported( $campaign_id, $missing, $live ) {
		$campaign = self::get( $campaign_id );

		if ( ! $campaign ) {
			return null;
		}

		$tidy = function ( $set ) {
			$out = array_values( array_unique( array_map( 'intval', (array) $set ) ) );
			sort( $out );
			return $out;
		};

		$campaign['deleted_reported'] = $tidy( $missing );
		$campaign['live_reported']    = $tidy( $live );

		return self::save( $campaign );
	}

	/**
	 * Posts nothing links to.
	 *
	 * The ring makes this impossible by construction — which is exactly why it
	 * is worth checking. If it ever reports something, the plan has been edited
	 * into a shape it was never meant to have.
	 *
	 * Computed from the ring's rule rather than from stored prev/next fields,
	 * because those are the server's business now and are no longer mirrored.
	 */
	public static function orphans( $campaign ) {
		$slots = isset( $campaign['slots'] ) ? $campaign['slots'] : array();
		$n     = count( $slots );

		if ( $n < 2 ) {
			return array();
		}

		$inbound = array();
		foreach ( $slots as $slot ) {
			$inbound[ (int) $slot['index'] ] = 0;
		}

		// Each post links to the one before and the one after; the last closes
		// the ring back to the first.
		foreach ( $slots as $i => $slot ) {
			$prev = $i > 0 ? (int) $slots[ $i - 1 ]['index'] : null;
			$next = $i < $n - 1 ? (int) $slots[ $i + 1 ]['index'] : (int) $slots[0]['index'];

			if ( null !== $prev && isset( $inbound[ $prev ] ) ) {
				$inbound[ $prev ]++;
			}
			if ( isset( $inbound[ $next ] ) ) {
				$inbound[ $next ]++;
			}
		}

		return array_keys( array_filter( $inbound, function ( $count ) {
			return 0 === $count;
		} ) );
	}
}
