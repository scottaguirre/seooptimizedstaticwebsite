<?php
/**
 * test-deleted-posts.php
 *
 * A campaign slot remembers a post_id. Nothing in that record watches the
 * post. Delete the post and the slot goes on reporting "Live" for something
 * that is gone, or "Overdue" for something that is never coming.
 *
 * WHY "OVERDUE" IS THE DANGEROUS ONE
 *
 * It is this plugin's alarm for WP-Cron having stopped — the comments in
 * IE_Campaigns::upcoming() say so. A deleted post raising that alarm points
 * whoever reads it at the scheduler, which is working perfectly. On a real
 * site, with five campaigns and somebody who knew the code, that cost an
 * evening. A customer would have opened a support ticket.
 *
 * These tests use REAL data through the real functions, with a stub that can
 * be told which post ids still exist. Not a grep over the source: the last
 * three bugs in this codebase all passed source checks while the behaviour was
 * broken.
 *
 * Run:  php wp-plugin/test-deleted-posts.php
 */

error_reporting( E_ALL );

define( 'ABSPATH', '/tmp/' );

/* ---------------------------------------------------------------------
 * Just enough WordPress
 * ------------------------------------------------------------------ */

$GLOBALS['ie_options']       = array();
$GLOBALS['ie_existing_posts'] = array();
$GLOBALS['ie_get_posts_calls'] = 0;

function get_option( $k, $default = false ) {
	return array_key_exists( $k, $GLOBALS['ie_options'] ) ? $GLOBALS['ie_options'][ $k ] : $default;
}
function update_option( $k, $v, $autoload = null ) {
	$GLOBALS['ie_options'][ $k ] = $v;
	return true;
}
function absint( $n ) { return abs( (int) $n ); }
function current_time( $t ) { return date( 'Y-m-d H:i:s' ); }
function wp_date( $fmt, $ts = null ) { return date( $fmt, $ts ? $ts : time() ); }

/**
 * The stub that matters.
 *
 * Returns only the ids the test has declared to exist, exactly as WordPress
 * would return only the posts that are really there.
 *
 * IT HONOURS post_status NOW, and that is not decoration. The previous version
 * ignored the argument entirely, so no test could tell a status list that
 * included 'trash' from one that did not — and the test meant to cover exactly
 * that gave up and grepped the source instead. It asserted the string 'trash'
 * was PRESENT, which is the broken behaviour, so it passed by confirming the
 * bug it was named after, and a trashed post was reported alive for the whole
 * life of the feature.
 *
 * Two shapes of declaration, so the tests written before this still read the
 * same way:
 *
 *   array( 11, 12 )           these ids exist, and are published
 *   array( 11 => 'trash' )    this id exists, with this status
 */
function get_posts( $args ) {
	$GLOBALS['ie_get_posts_calls']++;

	$wanted   = isset( $args['post__in'] ) ? array_map( 'intval', $args['post__in'] ) : array();
	$statuses = isset( $args['post_status'] ) ? (array) $args['post_status'] : array( 'publish' );

	$out = array();

	foreach ( $GLOBALS['ie_existing_posts'] as $key => $value ) {
		/* A string value is a status, and the key is the id. Otherwise the
		 * value is the id. NOT is_int( $key ): PHP turns the numeric key of
		 * array( 11 => 'trash' ) into an int as well, so the key alone cannot
		 * tell the two shapes apart. */
		if ( is_string( $value ) ) {
			$id     = (int) $key;
			$status = $value;
		} else {
			$id     = (int) $value;
			$status = 'publish';
		}

		if ( ! in_array( $id, $wanted, true ) ) {
			continue;
		}

		// WordPress returns nothing for a post whose status was not asked
		// for. That filtering IS the behaviour under test.
		if ( ! in_array( $status, $statuses, true ) ) {
			continue;
		}

		$out[] = $id;
	}

	return $out;
}

require_once __DIR__ . '/interlink-engine/includes/class-ie-campaigns.php';

/* ---------------------------------------------------------------------
 * Harness
 * ------------------------------------------------------------------ */

$passed = 0;
$failed = 0;
$DECLARED = 34;

function test( $name, $fn ) {
	global $passed, $failed;
	try {
		$fn();
		echo "  ok    {$name}\n";
		$passed++;
	} catch ( Throwable $e ) {
		echo "  FAIL  {$name}\n        " . $e->getMessage() . "\n";
		$failed++;
	}
}

function ok( $cond, $msg = 'expected true' ) {
	if ( ! $cond ) {
		throw new Exception( $msg );
	}
}

function same( $expected, $actual, $msg = '' ) {
	if ( $expected !== $actual ) {
		throw new Exception( $msg . ' — expected ' . var_export( $expected, true )
			. ', got ' . var_export( $actual, true ) );
	}
}

/** A campaign whose slots point at the given post ids. */
function campaign_with( $slots ) {
	$out = array();
	foreach ( $slots as $i => $s ) {
		$out[] = array(
			'index'        => $i,
			'topic'        => 'Topic ' . $i,
			'target_query' => 'term ' . $i,
			'post_id'      => $s['post_id'],
			'status'       => $s['status'],
			'publish_at'   => $s['publish_at'],
			'error'        => '',
		);
	}

	return array(
		'id'          => 'c-1',
		'label'       => 'Slab Leak Detection',
		'status'      => 'active',
		'every_days'  => 1,
		'publish_mode' => 'publish',
		'target_page' => array( 'title' => 'Slab Leak Detection', 'url' => 'http://site/slab' ),
		'slots'       => $out,
	);
}

/**
 * Put one campaign in storage and clear the lookup cache.
 *
 * KEYED BY CAMPAIGN ID, because that is how IE_Campaigns::save() stores them
 * and how IE_Campaigns::get() looks them up. This fixture used to build a
 * plain list, so the key was 0 and get( 'c-1' ) found nothing — every read
 * that walks all() worked, and every write that goes through get() silently
 * did nothing. No test noticed, because until now no test wrote anything.
 */
function given( $campaign, $existing_ids ) {
	$GLOBALS['ie_options']['ie_campaigns'] = array( $campaign['id'] => $campaign );
	$GLOBALS['ie_existing_posts']          = $existing_ids;
	$GLOBALS['ie_get_posts_calls']         = 0;
	IE_Campaigns::forget_post_cache();
}

$YESTERDAY = date( 'Y-m-d H:i:s', strtotime( '-1 day' ) );
$LAST_WEEK = date( 'Y-m-d H:i:s', strtotime( '-7 days' ) );
$TOMORROW  = date( 'Y-m-d H:i:s', strtotime( '+1 day' ) );

echo "\nDeleted posts\n\n";

/* ------------------------------------------------------------------ *
 * The check itself
 * ------------------------------------------------------------------ */

test( 'a slot whose post still exists is not missing', function () use ( $YESTERDAY ) {
	$c = campaign_with( array( array( 'post_id' => 11, 'status' => 'published', 'publish_at' => $YESTERDAY ) ) );
	given( $c, array( 11 ) );

	same( false, IE_Campaigns::post_missing( $c['slots'][0] ), 'an existing post reported missing' );
} );

test( 'A SLOT WHOSE POST HAS BEEN DELETED IS MISSING', function () use ( $YESTERDAY ) {
	$c = campaign_with( array( array( 'post_id' => 11, 'status' => 'published', 'publish_at' => $YESTERDAY ) ) );
	given( $c, array() ); // nothing exists any more

	same( true, IE_Campaigns::post_missing( $c['slots'][0] ), 'a deleted post was not noticed' );
} );

test( 'NO POST ID MEANS NOT WRITTEN YET, NOT DELETED', function () use ( $TOMORROW ) {
	/* The distinction the whole feature turns on. A slot with no id has
	 * never had a post — it is "Arriving" and always was. Calling that
	 * "deleted" would put a scary label on every campaign still being
	 * written, which is most of them on the day they are approved. */
	$c = campaign_with( array( array( 'post_id' => 0, 'status' => 'pending', 'publish_at' => $TOMORROW ) ) );
	given( $c, array() );

	same( false, IE_Campaigns::post_missing( $c['slots'][0] ), 'an unwritten slot was called deleted' );
} );

test( 'missing_count counts only the lost ones', function () use ( $YESTERDAY, $TOMORROW ) {
	$c = campaign_with( array(
		array( 'post_id' => 11, 'status' => 'published', 'publish_at' => $YESTERDAY ),
		array( 'post_id' => 12, 'status' => 'published', 'publish_at' => $YESTERDAY ),
		array( 'post_id' => 0,  'status' => 'pending',   'publish_at' => $TOMORROW ),
	) );
	given( $c, array( 11 ) ); // 12 deleted, 11 alive, third never written

	same( 1, IE_Campaigns::missing_count( $c ), 'wrong count' );
} );

/* ------------------------------------------------------------------ *
 * The alarm
 * ------------------------------------------------------------------ */

test( 'A DELETED POST IS NOT OVERDUE — IT DOES NOT RAISE THE WP-CRON ALARM', function () use ( $LAST_WEEK ) {
	/* THE BUG THIS WHOLE FILE IS ABOUT. Status 'scheduled', date long past,
	 * post gone. The old code said "Overdue", which means "the scheduler has
	 * stopped" — and sent us after a scheduler that was working. */
	$c = campaign_with( array( array( 'post_id' => 11, 'status' => 'scheduled', 'publish_at' => $LAST_WEEK ) ) );
	given( $c, array() );

	$rows = IE_Campaigns::upcoming( 10 );

	same( 1, count( $rows ), 'the row vanished entirely; it should still be listed' );
	same( true,  $rows[0]['deleted'], 'the row is not marked deleted' );
	same( false, $rows[0]['overdue'], 'a deleted post is still raising the Overdue alarm' );
} );

test( 'a genuinely late post IS still overdue', function () use ( $LAST_WEEK ) {
	/* The alarm must keep working. Breaking it to fix the false one would
	 * trade a confusing screen for a silent one. */
	$c = campaign_with( array( array( 'post_id' => 11, 'status' => 'scheduled', 'publish_at' => $LAST_WEEK ) ) );
	given( $c, array( 11 ) ); // the post is there, just not published

	$rows = IE_Campaigns::upcoming( 10 );

	same( true,  $rows[0]['overdue'], 'a real overdue post stopped raising the alarm' );
	same( false, $rows[0]['deleted'] );
} );

test( 'a future post is neither', function () use ( $TOMORROW ) {
	$c = campaign_with( array( array( 'post_id' => 11, 'status' => 'scheduled', 'publish_at' => $TOMORROW ) ) );
	given( $c, array( 11 ) );

	$rows = IE_Campaigns::upcoming( 10 );

	same( false, $rows[0]['overdue'] );
	same( false, $rows[0]['deleted'] );
} );

/* ------------------------------------------------------------------ *
 * Trash, and the lookup
 * ------------------------------------------------------------------ */

test( 'A TRASHED POST COUNTS AS GONE', function () use ( $YESTERDAY ) {
	/* It is off the site and will never publish on its schedule, so calling
	 * it "Live" is the same lie in a smaller hat.
	 *
	 * THIS TEST USED TO GREP THE SOURCE, and it asserted that the string
	 * 'trash' APPEARED in the status list — which is what made a trashed post
	 * come back from the lookup and count as alive. It passed for weeks by
	 * confirming the exact bug its own name forbids. The stub now models
	 * statuses so the behaviour can be asked about directly. */
	$c = campaign_with( array( array( 'post_id' => 11, 'status' => 'published', 'publish_at' => $YESTERDAY ) ) );
	given( $c, array( 11 => 'trash' ) );

	same( true, IE_Campaigns::post_missing( $c['slots'][0] ),
		'a trashed post is being reported as still on the site' );
} );

test( 'a draft is NOT gone — the status list is not over-trimmed', function () use ( $YESTERDAY ) {
	/* The opposite failure, and the reason trash was added to that list in
	 * the first place. A campaign running in draft mode has real posts that
	 * simply are not public yet. Marking those deleted would put a red
	 * warning on every draft campaign on the site. */
	$c = campaign_with( array( array( 'post_id' => 11, 'status' => 'scheduled', 'publish_at' => $YESTERDAY ) ) );
	given( $c, array( 11 => 'draft' ) );

	same( false, IE_Campaigns::post_missing( $c['slots'][0] ),
		'a draft post is being reported as deleted' );
} );

test( 'a scheduled (future) post is not gone either', function () use ( $TOMORROW ) {
	$c = campaign_with( array( array( 'post_id' => 11, 'status' => 'scheduled', 'publish_at' => $TOMORROW ) ) );
	given( $c, array( 11 => 'future' ) );

	same( false, IE_Campaigns::post_missing( $c['slots'][0] ),
		'a future-dated post is being reported as deleted' );
} );

/* ------------------------------------------------------------------ *
 * Telling the server — the part that did not exist until 0.5.0
 * ------------------------------------------------------------------ */

test( 'slots_for_post finds the campaign and slot behind a post id', function () use ( $YESTERDAY ) {
	$c = campaign_with( array(
		array( 'post_id' => 11, 'status' => 'published', 'publish_at' => $YESTERDAY ),
		array( 'post_id' => 12, 'status' => 'published', 'publish_at' => $YESTERDAY ),
	) );
	given( $c, array( 11, 12 ) );

	$hits = IE_Campaigns::slots_for_post( 12 );

	same( 1, count( $hits ), 'expected exactly one slot' );
	same( 1, $hits[0]['index'], 'wrong slot index' );
	same( 'c-1', $hits[0]['campaign_id'], 'wrong campaign id' );
} );

test( 'slots_for_post says nothing about a post we do not own', function () use ( $YESTERDAY ) {
	/* The delete hook fires for EVERY post on the site — pages, revisions,
	 * attachments, another plugin's custom types. Answering anything but
	 * "not mine" for those would report other people's deletions as ours. */
	$c = campaign_with( array( array( 'post_id' => 11, 'status' => 'published', 'publish_at' => $YESTERDAY ) ) );
	given( $c, array( 11 ) );

	same( array(), IE_Campaigns::slots_for_post( 999 ) );
	same( array(), IE_Campaigns::slots_for_post( 0 ), 'a zero id matched something' );
} );

test( 'THE SWEEP REPORTS A DELETED POST THE HOOKS NEVER SAW', function () use ( $YESTERDAY ) {
	/* The case that matters today. Fourteen posts were deleted before any of
	 * this code existed; no hook fires retroactively, so the sweep comparing
	 * the record against the site is the ONLY thing that can find them. */
	$c = campaign_with( array(
		array( 'post_id' => 11, 'status' => 'published', 'publish_at' => $YESTERDAY ),
		array( 'post_id' => 12, 'status' => 'published', 'publish_at' => $YESTERDAY ),
	) );
	given( $c, array( 11 ) ); // 12 was deleted long ago

	$due = IE_Campaigns::slot_report_due();

	same( array( 1 ), $due['c-1']['missing'], 'the sweep did not find the deleted post' );
	same( array( 0 ), $due['c-1']['live'], 'the surviving published post was not reported live' );
} );

test( 'THE SWEEP GOES QUIET ONCE THE SERVER AGREES', function () use ( $YESTERDAY ) {
	/* Otherwise a site with one deleted post makes an HTTP call every hour
	 * for the rest of its life, for news the server already has. */
	$c = campaign_with( array(
		array( 'post_id' => 11, 'status' => 'published', 'publish_at' => $YESTERDAY ),
		array( 'post_id' => 12, 'status' => 'published', 'publish_at' => $YESTERDAY ),
	) );
	given( $c, array( 11 ) );

	IE_Campaigns::mark_slots_reported( 'c-1', array( 1 ), array( 0 ) );
	IE_Campaigns::forget_post_cache();

	same( array(), IE_Campaigns::slot_report_due(), 'the sweep is still reporting what it already sent' );
} );

test( 'slot_report_due can be scoped to named campaigns', function () use ( $YESTERDAY ) {
	/* The shutdown flush passes only the campaigns a deletion actually
	 * touched. Without the filter, deleting one post on a site running eight
	 * campaigns would reconcile all eight. */
	$c = campaign_with( array(
		array( 'post_id' => 11, 'status' => 'published', 'publish_at' => $YESTERDAY ),
	) );
	given( $c, array() ); // its post is gone

	same( array( 0 ), IE_Campaigns::slot_report_due( array( 'c-1' ) )['c-1']['missing'] );
	same( array(), IE_Campaigns::slot_report_due( array( 'c-other' ) ),
		'the filter let through a campaign that was not named' );
} );

test( 'A RESTORED POST IS REPORTED BACK, AS AN EMPTY SET', function () use ( $YESTERDAY ) {
	/* Deleting must not be a one-way door. Somebody trashes a post by
	 * accident and puts it straight back; without this the report would carry
	 * "Deleted" against a live post for good — in the document a customer
	 * reaches for to check a bill.
	 *
	 * An EMPTY array is the message, and it is why slot_report_due() must
	 * not treat "nothing missing" as "nothing to say". */
	$c = campaign_with( array(
		array( 'post_id' => 11, 'status' => 'published', 'publish_at' => $YESTERDAY ),
		array( 'post_id' => 12, 'status' => 'published', 'publish_at' => $YESTERDAY ),
	) );
	given( $c, array( 11 ) );

	IE_Campaigns::mark_slots_reported( 'c-1', array( 1 ), array( 0 ) );

	// The owner pulls post 12 back out of the trash.
	$GLOBALS['ie_existing_posts'] = array( 11, 12 );
	IE_Campaigns::forget_post_cache();

	$due = IE_Campaigns::slot_report_due();

	ok( array_key_exists( 'c-1', $due ), 'the restore was never reported' );
	same( array(), $due['c-1']['missing'], 'the restore should report an EMPTY missing set' );
} );

test( 'THE LOOKUP IS ONE QUERY, NOT ONE PER SLOT', function () use ( $YESTERDAY ) {
	/* A missing post is never in the object cache, so a per-slot lookup hits
	 * the database on every page load, for every dead row, forever. Six slots
	 * must cost ONE query, not six. */
	$slots = array();
	for ( $i = 0; $i < 6; $i++ ) {
		$slots[] = array( 'post_id' => 100 + $i, 'status' => 'published', 'publish_at' => $YESTERDAY );
	}
	$c = campaign_with( $slots );
	given( $c, array() );

	same( 6, IE_Campaigns::missing_count( $c ), 'all six should read as missing' );
	same( 1, $GLOBALS['ie_get_posts_calls'],
		'the lookup ran once per slot instead of once for the screen' );

	// Asking again must not query again.
	IE_Campaigns::missing_count( $c );
	same( 1, $GLOBALS['ie_get_posts_calls'], 'a second pass queried again' );
} );

test( 'the lookup is cached, and forget_post_cache clears it', function () use ( $YESTERDAY ) {
	$c = campaign_with( array( array( 'post_id' => 11, 'status' => 'published', 'publish_at' => $YESTERDAY ) ) );
	given( $c, array() );

	same( true, IE_Campaigns::post_missing( $c['slots'][0] ) );

	// Restore the post WITHOUT clearing: the cached answer should stand.
	$GLOBALS['ie_existing_posts'] = array( 11 );
	same( true, IE_Campaigns::post_missing( $c['slots'][0] ), 'the lookup is not cached at all' );

	// Now clear it, and the new truth should win.
	IE_Campaigns::forget_post_cache();
	same( false, IE_Campaigns::post_missing( $c['slots'][0] ), 'forget_post_cache did not clear the cache' );
} );

/* ------------------------------------------------------------------ *
 * "Publish early" on a post that is not there — MOVED
 *
 * Two source greps used to sit here, asserting that fragments of PHP appeared
 * in class-ie-admin.php. Their own comment said what they were: they proved
 * the guards EXISTED and not that they fired, and they were waiting for a
 * harness that could render that screen.
 *
 * That harness — wp-plugin/test-admin-tabs.php — was broken, all 23 of its
 * tests dying on one method its hand-written IE_Campaigns stub never gained.
 * It is fixed, it uses the REAL IE_Campaigns now so it cannot fall behind
 * again, and both guards are proved there by rendering the screen and reading
 * the HTML. Mutation-tested: restoring either bug fails a test there.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * One call per request, not one per post
 *
 * These hooks fire once per post. Selecting twelve posts in wp-admin and
 * choosing Delete fires them twelve times inside a SINGLE request — and the
 * first version of this made twelve separate HTTP calls to the server, back
 * to back, each with a twenty-second timeout, while the owner's browser sat
 * waiting on all of them.
 *
 * Bulk delete is how somebody clears out a campaign's posts. It is the common
 * case, not the unlucky one.
 * ------------------------------------------------------------------ */

// Just enough more WordPress to load the publisher.
$GLOBALS['ie_actions'] = array();
function add_action( $hook, $cb, $priority = 10, $args = 1 ) {
	$GLOBALS['ie_actions'][] = $hook;
	return true;
}
function current_user_can( $c ) { return true; }
class WP_Error {
	public $msg;
	public function __construct( $c = '', $m = '' ) { $this->msg = $m; }
	public function get_error_message() { return $this->msg; }
}
function is_wp_error( $t ) { return $t instanceof WP_Error; }

class IE_Settings {
	public static $connected = true;
	public static function is_connected() { return self::$connected; }
	public static function get( $k, $d = null ) { return $d; }
}

/** Counts calls, and remembers exactly what was sent. */
class IE_Api {
	public static $calls   = array();
	public static $present = array();
	public static $fail    = false;
	public static $removed = 0;

	public static function posts_deleted( $campaign_id, $slots, $reconcile = false, $live = array() ) {
		self::$calls[] = array(
			'campaign'  => $campaign_id,
			'slots'     => array_values( array_map( 'intval', (array) $slots ) ),
			'reconcile' => (bool) $reconcile,
			'live'      => array_values( array_map( 'intval', (array) $live ) ),
		);
		return self::$fail ? new WP_Error( 'x', 'offline' ) : array( 'ok' => true );
	}

	public static function campaigns_present( $campaigns ) {
		/* KEPT AS GIVEN. This used to array_map('strval') over the argument,
		 * which was right while the payload was a list of ids and turned every
		 * entry into the word "Array" the moment it became
		 * array( 'id' => …, 'status' => … ). A stub that flattens the message
		 * cannot tell a status that arrived from one that did not. */
		$campaigns = array_values( (array) $campaigns );

		// Mirrors the real one: an empty list is never sent.
		if ( empty( $campaigns ) ) {
			return null;
		}

		self::$present[] = $campaigns;

		return self::$fail
			? new WP_Error( 'x', 'offline' )
			: array( 'ok' => true, 'removed' => self::$removed );
	}
}

class IE_Links {
	public static function render( $s, $t ) { return array( 'content' => '', 'missing' => array() ); }
	public static function activate( $c, $t, $u ) { return array( 'count' => 0, 'content' => $c ); }
}

require_once __DIR__ . '/interlink-engine/includes/class-ie-publisher.php';

/** Reset the call log and the in-request queue between cases. */
function fresh_api() {
	IE_Api::$calls   = array();
	IE_Api::$present = array();
	IE_Api::$fail    = false;
	IE_Api::$removed = 0;
	IE_Settings::$connected = true;
	IE_Publisher::flush_deleted_reports(); // drains anything a previous case left
	IE_Api::$calls   = array();
	IE_Api::$present = array();

	// The campaign-list reconciliation remembers what it sent, in its own
	// option. Left alone, case two inherits case one's idea of the world.
	unset( $GLOBALS['ie_options'][ IE_Campaigns::PRESENT_OPTION ] );
}

test( 'DELETING TWELVE POSTS MAKES ONE CALL, NOT TWELVE', function () use ( $YESTERDAY ) {
	$slots = array();
	for ( $i = 0; $i < 12; $i++ ) {
		$slots[] = array( 'post_id' => 100 + $i, 'status' => 'published', 'publish_at' => $YESTERDAY );
	}

	$c = campaign_with( $slots );
	given( $c, array() ); // the owner bulk-deleted the lot
	fresh_api();

	// WordPress fires the hook once per post.
	for ( $i = 0; $i < 12; $i++ ) {
		IE_Publisher::on_post_gone( 100 + $i );
	}

	same( 0, count( IE_Api::$calls ), 'the hooks called the server directly instead of queueing' );

	IE_Publisher::flush_deleted_reports();

	same( 1, count( IE_Api::$calls ), 'twelve deletions made more than one call' );
	same( range( 0, 11 ), IE_Api::$calls[0]['slots'], 'the one call did not name every deleted slot' );
	same( true, IE_Api::$calls[0]['reconcile'], 'the batched call is not a reconciliation' );
} );

test( 'two campaigns get one call EACH, not one call between them', function () use ( $YESTERDAY ) {
	/* A reconciliation is per campaign — "these and only these are gone" —
	 * so merging two campaigns into one call would tell the server that the
	 * other campaign's slots are all present. */
	$a = campaign_with( array( array( 'post_id' => 11, 'status' => 'published', 'publish_at' => $YESTERDAY ) ) );
	$b = campaign_with( array( array( 'post_id' => 22, 'status' => 'published', 'publish_at' => $YESTERDAY ) ) );
	$b['id'] = 'c-2';

	$GLOBALS['ie_options']['ie_campaigns'] = array( 'c-1' => $a, 'c-2' => $b );
	$GLOBALS['ie_existing_posts']          = array();
	IE_Campaigns::forget_post_cache();
	fresh_api();

	IE_Publisher::on_post_gone( 11 );
	IE_Publisher::on_post_gone( 22 );
	IE_Publisher::flush_deleted_reports();

	same( 2, count( IE_Api::$calls ), 'the two campaigns were merged into one reconciliation' );
} );

test( 'a post belonging to no campaign never reaches the server', function () use ( $YESTERDAY ) {
	/* The hook fires for EVERY post on the site — pages, attachments,
	 * revisions, another plugin's types. Most sites delete far more of those
	 * than campaign posts. */
	$c = campaign_with( array( array( 'post_id' => 11, 'status' => 'published', 'publish_at' => $YESTERDAY ) ) );
	given( $c, array( 11 ) );
	fresh_api();

	IE_Publisher::on_post_gone( 4242 );
	IE_Publisher::flush_deleted_reports();

	same( 0, count( IE_Api::$calls ), 'someone else\'s post was reported to the server' );
} );

test( 'A FAILED REPORT DOES NOT MARK THE CAMPAIGN AS TOLD', function () use ( $YESTERDAY ) {
	/* Otherwise one unreachable minute becomes permanent silence about a post
	 * that really is gone: the sweep compares against the local record, sees
	 * agreement, and never mentions it again. */
	$c = campaign_with( array( array( 'post_id' => 11, 'status' => 'published', 'publish_at' => $YESTERDAY ) ) );
	given( $c, array() );
	fresh_api();
	IE_Api::$fail = true;

	IE_Publisher::on_post_gone( 11 );
	IE_Publisher::flush_deleted_reports();

	same( 1, count( IE_Api::$calls ), 'nothing was even attempted' );

	IE_Campaigns::forget_post_cache();
	same( array( 0 ), IE_Campaigns::slot_report_due()['c-1']['missing'],
		'a failed report was recorded as sent, so the sweep will never retry it' );
} );

/* ------------------------------------------------------------------ *
 * Which posts are LIVE
 *
 * "This post went live" is sent once, as an event, and nothing retries it.
 * One rejected call and the server believes a published post is still
 * waiting — for ever, because the event never comes again.
 *
 * On one real site a licence key was used on a second WordPress, which left
 * the first holding a stale secret. Eight days of refused calls, twelve of
 * them "this post went live". Twelve posts sat on the customer's blog,
 * visible to anyone, recorded on the server as pending. No amount of waiting
 * would have corrected it.
 *
 * on_transition() writes the local status BEFORE telling the server, so this
 * side knew all along and had no way to say so twice. Now it does.
 * ------------------------------------------------------------------ */

test( 'A PUBLISHED SLOT IS REPORTED LIVE, NOT JUST ONCE WHEN IT HAPPENS', function () use ( $YESTERDAY ) {
	$c = campaign_with( array(
		array( 'post_id' => 11, 'status' => 'published', 'publish_at' => $YESTERDAY ),
		array( 'post_id' => 12, 'status' => 'scheduled', 'publish_at' => $YESTERDAY ),
	) );
	given( $c, array( 11, 12 ) );
	fresh_api();

	$due = IE_Campaigns::slot_report_due();

	same( array( 0 ), $due['c-1']['live'], 'the published slot was not reported live' );
	same( array(), $due['c-1']['missing'], 'nothing is deleted, so nothing should be missing' );
} );

test( 'the live set reaches the server in the SAME call as the deletions', function () use ( $YESTERDAY ) {
	/* Both answers come from one walk of one campaign. A second round trip to
	 * say the other half would double the cost of being careful. */
	$c = campaign_with( array(
		array( 'post_id' => 11, 'status' => 'published', 'publish_at' => $YESTERDAY ),
		array( 'post_id' => 12, 'status' => 'published', 'publish_at' => $YESTERDAY ),
	) );
	given( $c, array( 11 ) ); // 12 was deleted
	fresh_api();

	IE_Publisher::sweep_deleted();

	same( 1, count( IE_Api::$calls ), 'the two halves were sent separately' );
	same( array( 1 ), IE_Api::$calls[0]['slots'], 'wrong missing set' );
	same( array( 0 ), IE_Api::$calls[0]['live'], 'wrong live set' );
} );

test( 'A SLOT CANNOT BE BOTH LIVE AND MISSING', function () use ( $YESTERDAY ) {
	/* Its post is gone, so whatever the stored status says, "it published" is
	 * stale news about something that no longer exists. The deletion is the
	 * more recent truth, and the server refuses to resurrect it either way. */
	$c = campaign_with( array( array( 'post_id' => 11, 'status' => 'published', 'publish_at' => $YESTERDAY ) ) );
	given( $c, array() );
	fresh_api();

	$due = IE_Campaigns::slot_report_due();

	same( array( 0 ), $due['c-1']['missing'] );
	same( array(), $due['c-1']['live'], 'a deleted post was also reported as live' );
} );

test( 'a post going live makes the sweep speak again', function () use ( $YESTERDAY ) {
	/* The quiet is per-state, not permanent. Once the sets agree nothing is
	 * sent, and the moment either changes the sweep has something to say. */
	$c = campaign_with( array(
		array( 'post_id' => 11, 'status' => 'scheduled', 'publish_at' => $YESTERDAY ),
	) );
	given( $c, array( 11 ) );
	fresh_api();

	IE_Campaigns::mark_slots_reported( 'c-1', array(), array() );
	IE_Campaigns::forget_post_cache();
	same( array(), IE_Campaigns::slot_report_due(), 'it had something to say before anything changed' );

	// WordPress publishes it; on_transition writes the local status.
	IE_Campaigns::update_slot( 'c-1', 0, array( 'status' => 'published' ) );
	IE_Campaigns::forget_post_cache();

	$due = IE_Campaigns::slot_report_due();
	same( array( 0 ), $due['c-1']['live'], 'the sweep stayed quiet about a post that went live' );
} );

test( 'the sweep says nothing when the site is not connected', function () use ( $YESTERDAY ) {
	$c = campaign_with( array( array( 'post_id' => 11, 'status' => 'published', 'publish_at' => $YESTERDAY ) ) );
	given( $c, array() );
	fresh_api();
	IE_Settings::$connected = false;

	same( array( 'slots' => 0, 'campaigns' => 0 ), IE_Publisher::sweep_deleted() );
	same( 0, count( IE_Api::$calls ), 'an unconnected site called the server anyway' );
	same( 0, count( IE_Api::$present ), 'an unconnected site sent its campaign list anyway' );
} );

/* ------------------------------------------------------------------ *
 * Which campaigns this site still HAS
 *
 * The slot sweep reconciles the campaigns the plugin holds. A campaign
 * REMOVED from the WordPress is not in those records at all, so nothing walks
 * it, and its posts stay on the server's books forever — counted as live work
 * and charged for on the customer's own report.
 *
 * On one real site that was six campaigns and fourteen published posts, none
 * of which any slot sweep could ever reach.
 * ------------------------------------------------------------------ */

/** The ids out of a campaigns_present payload, whichever shape it is in. */
function present_ids( $sent ) {
	$out = array();

	foreach ( (array) $sent as $entry ) {
		$out[] = is_array( $entry ) ? (string) $entry['id'] : (string) $entry;
	}

	sort( $out );

	return $out;
}

test( 'the campaign list is reported the first time', function () use ( $YESTERDAY ) {
	$c = campaign_with( array( array( 'post_id' => 11, 'status' => 'published', 'publish_at' => $YESTERDAY ) ) );
	given( $c, array( 11 ) );
	fresh_api();

	same( array( 'c-1' ), present_ids( IE_Campaigns::campaign_report_due() ) );

	IE_Publisher::sweep_deleted();

	same( 1, count( IE_Api::$present ), 'the campaign list was never sent' );
	same( array( 'c-1' ), present_ids( IE_Api::$present[0] ) );
} );

test( 'and then goes quiet', function () use ( $YESTERDAY ) {
	$c = campaign_with( array( array( 'post_id' => 11, 'status' => 'published', 'publish_at' => $YESTERDAY ) ) );
	given( $c, array( 11 ) );
	fresh_api();

	IE_Publisher::sweep_deleted();
	IE_Api::$present = array();

	IE_Publisher::sweep_deleted();

	same( null, IE_Campaigns::campaign_report_due(), 'still thinks it has something to say' );
	same( 0, count( IE_Api::$present ), 'the campaign list is being resent every sweep' );
} );

test( 'A REMOVED CAMPAIGN CHANGES THE LIST, AND THE LIST IS RESENT', function () use ( $YESTERDAY ) {
	/* THE BUG THIS SECTION IS ABOUT. Remove a campaign in wp-admin on a
	 * plugin older than 0.4.4 and the server is never told. Its posts stay on
	 * the books, published and billed, and no sweep of slots can reach them
	 * because the campaign is not there to sweep. */
	$a = campaign_with( array( array( 'post_id' => 11, 'status' => 'published', 'publish_at' => $YESTERDAY ) ) );
	$b = campaign_with( array( array( 'post_id' => 22, 'status' => 'published', 'publish_at' => $YESTERDAY ) ) );
	$b['id'] = 'c-2';

	$GLOBALS['ie_options']['ie_campaigns'] = array( 'c-1' => $a, 'c-2' => $b );
	$GLOBALS['ie_existing_posts']          = array( 11, 22 );
	IE_Campaigns::forget_post_cache();
	fresh_api();

	IE_Publisher::sweep_deleted();
	same( array( 'c-1', 'c-2' ), present_ids( IE_Api::$present[0] ) );

	// The owner removes one campaign. Its posts stay on the site.
	IE_Campaigns::delete( 'c-2' );
	IE_Campaigns::forget_post_cache();
	IE_Api::$present = array();
	IE_Api::$removed = 1;

	$result = IE_Publisher::sweep_deleted();

	same( 1, count( IE_Api::$present ), 'the shorter list was never sent' );
	same( array( 'c-1' ), present_ids( IE_Api::$present[0] ), 'the removed campaign is still being reported as present' );
	same( 1, $result['campaigns'], 'the count of campaigns the server dropped did not come back' );
} );

test( 'A STATUS CHANGE IS ENOUGH TO MAKE THE SWEEP SPEAK', function () use ( $YESTERDAY ) {
	/* THE BUG. This gate compared the LIST OF IDS and nothing else — correct
	 * when the ids were the whole message, and wrong the moment the sweep
	 * began carrying each campaign's status.
	 *
	 * Pausing a campaign does not change which campaigns exist, so the gate
	 * said "nothing has changed" and the pause was never sent. Two campaigns
	 * that had finished sat at "In progress" on the account page because
	 * their site had, by this measure, nothing to say — and pressing the
	 * button did nothing, every time, with no way to tell why. */
	$c = campaign_with( array( array( 'post_id' => 11, 'status' => 'published', 'publish_at' => $YESTERDAY ) ) );
	given( $c, array( 11 ) );
	fresh_api();

	IE_Publisher::sweep_deleted();
	IE_Api::$present = array();

	// Nothing said twice: the gate is doing its job.
	same( null, IE_Campaigns::campaign_report_due(), 'the sweep repeats itself' );

	// The owner pauses it. Same campaigns, different story.
	IE_Campaigns::set_status( 'c-1', 'paused' );
	IE_Campaigns::forget_post_cache();

	$due = IE_Campaigns::campaign_report_due();

	ok( is_array( $due ) && ! empty( $due ), 'a pause was swallowed by the gate' );
	same( 'paused', $due[0]['status'], 'the status did not reach the payload' );

	IE_Publisher::sweep_deleted();

	same( 1, count( IE_Api::$present ), 'the pause was never sent' );
	same( 'paused', IE_Api::$present[0][0]['status'], 'the server was not told the new status' );
} );

test( 'and it goes quiet again once the status has been sent', function () use ( $YESTERDAY ) {
	// The guard against fixing the gate by removing it.
	$c = campaign_with( array( array( 'post_id' => 11, 'status' => 'published', 'publish_at' => $YESTERDAY ) ) );
	given( $c, array( 11 ) );
	fresh_api();

	IE_Campaigns::set_status( 'c-1', 'paused' );
	IE_Publisher::sweep_deleted();
	IE_Api::$present = array();

	IE_Publisher::sweep_deleted();

	same( 0, count( IE_Api::$present ), 'the same status is being resent every sweep' );
} );

test( 'A SITE WITH NO CAMPAIGNS SAYS NOTHING AT ALL', function () {
	/* THE ONE MESSAGE THAT CAN DESTROY A RECORD. A plugin whose options have
	 * been lost — a partial restore, a botched migration, a fresh install on
	 * an old domain — reports zero campaigns, which is indistinguishable from
	 * a site that has genuinely removed every one.
	 *
	 * The second case is already covered: each of those removals fires the
	 * removal callback as it happens. So the ambiguous message is the one
	 * worth swallowing, and campaign_report_due() returns null rather than an
	 * empty array to say so. */
	$GLOBALS['ie_options']['ie_campaigns'] = array();
	$GLOBALS['ie_existing_posts']          = array();
	IE_Campaigns::forget_post_cache();
	fresh_api();

	same( null, IE_Campaigns::campaign_report_due(),
		'an empty campaign list is being treated as news' );

	IE_Publisher::sweep_deleted();

	same( 0, count( IE_Api::$present ), 'a site with no campaigns told the server everything was gone' );
} );

test( 'a failed campaign report is retried, not forgotten', function () use ( $YESTERDAY ) {
	$c = campaign_with( array( array( 'post_id' => 11, 'status' => 'published', 'publish_at' => $YESTERDAY ) ) );
	given( $c, array( 11 ) );
	fresh_api();
	IE_Api::$fail = true;

	IE_Publisher::sweep_deleted();

	same( 1, count( IE_Api::$present ), 'nothing was even attempted' );
	same( array( 'c-1' ), present_ids( IE_Campaigns::campaign_report_due() ),
		'a failed report was recorded as sent, so it will never be retried' );
} );

echo "\n  {$passed} passed, {$failed} failed\n";

if ( $passed + $failed !== $DECLARED ) {
	echo "  MISCOUNT: " . ( $passed + $failed ) . " ran, {$DECLARED} declared\n";
	exit( 1 );
}

echo "\n";
exit( $failed === 0 ? 0 : 1 );
