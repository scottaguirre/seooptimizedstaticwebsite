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

		$slots = array();
		foreach ( (array) ( isset( $plan['slots'] ) ? $plan['slots'] : array() ) as $i => $s ) {
			$index = isset( $s['index'] ) ? (int) $s['index'] : $i;

			$slots[] = array(
				'index'        => $index,
				'topic'        => isset( $s['topic'] ) ? $s['topic'] : '',
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

	public static function is_paused( $campaign ) {
		return is_array( $campaign ) && isset( $campaign['status'] ) && 'paused' === $campaign['status'];
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
	 * @return array [{ at, overdue, campaign_id, campaign, page, topic, status, post_id }]
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

				$rows[] = array(
					'at'          => $at,
					'overdue'     => ( 'scheduled' === $slot['status'] && $at < $now ),
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
