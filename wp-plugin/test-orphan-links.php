<?php
/**
 * test-orphan-links.php
 *
 * THE BUG: removing a campaign silently stopped its links being built.
 *
 * "Remove campaign" deletes the plugin's record and touches no posts. Every
 * post still scheduled therefore publishes anyway — WordPress core does that
 * on the date, and core has never heard of a campaign. on_transition() then
 * woke up, could not find the record, and returned.
 *
 * So for every post that published after a removal:
 *
 *   - the placeholder spans waiting on it stayed spans FOREVER, including
 *     those in posts that had published weeks earlier and were fine until
 *     the removal happened
 *   - the server was never told, so the Blog Report shows it Scheduled
 *     indefinitely
 *
 * And none of it is visible. A dead placeholder renders as ordinary prose in
 * the middle of a sentence. No broken link, no 404, no error, no log line.
 * The only way to see it is to read the HTML source of a post nobody has any
 * reason to read the source of.
 *
 * THE FIX: the record was never the only copy. Every post carries
 * `_ie_campaign` and `_ie_slot`, and deleting an option does not touch post
 * meta — so the siblings can be found from the posts themselves when the
 * record is gone.
 *
 * WHY THESE TESTS RUN THE REAL FUNCTIONS. A grep would have "passed" against
 * the broken code: the source contained activate_for_slot(), a call to
 * IE_Api::published() and the whole ring — all of it correct, all of it
 * unreachable behind one early return. Four bugs in this codebase have now
 * survived source checks. These drive on_transition() with a stub that can be
 * told the record is missing, and assert on the post content that comes out.
 *
 * Run:  php wp-plugin/test-orphan-links.php
 */

error_reporting( E_ALL );

define( 'ABSPATH', '/tmp/' );

/* ---------------------------------------------------------------------
 * Just enough WordPress
 * ------------------------------------------------------------------ */

$GLOBALS['ie_options']   = array();
$GLOBALS['ie_posts']     = array();   // id => array( content, status, slot, campaign )
$GLOBALS['ie_published'] = array();   // what IE_Api::published() was told
$GLOBALS['ie_meta_queries'] = 0;      // how often the fallback was used
$GLOBALS['ie_calls']        = array();   // every call made to the server, in order

function get_option( $k, $default = false ) {
	return array_key_exists( $k, $GLOBALS['ie_options'] ) ? $GLOBALS['ie_options'][ $k ] : $default;
}
function update_option( $k, $v, $autoload = null ) {
	$GLOBALS['ie_options'][ $k ] = $v;
	return true;
}
function absint( $n ) { return abs( (int) $n ); }
function current_time( $t, $gmt = 0 ) { return date( 'Y-m-d H:i:s' ); }
function esc_url( $u ) { return $u; }
function esc_attr( $a ) { return $a; }
function esc_html( $h ) { return $h; }
function sanitize_text_field( $s ) { return $s; }
function add_action() {}
function is_wp_error( $thing ) { return $thing instanceof WP_Error; }
class WP_Error { public $code; public function __construct( $c = '' ) { $this->code = $c; } public function get_error_message() { return 'error'; } }
function wp_list_pluck( $list, $field ) {
	$out = array();
	foreach ( (array) $list as $row ) {
		$out[] = is_array( $row ) && isset( $row[ $field ] ) ? $row[ $field ] : null;
	}
	return $out;
}

function get_post( $id ) {
	$id = (int) $id;
	if ( ! isset( $GLOBALS['ie_posts'][ $id ] ) ) {
		return null;
	}

	$row = $GLOBALS['ie_posts'][ $id ];

	return (object) array(
		'ID'           => $id,
		'post_content' => $row['content'],
		'post_status'  => $row['status'],
	);
}

function get_post_meta( $id, $key, $single = false ) {
	$id = (int) $id;
	if ( ! isset( $GLOBALS['ie_posts'][ $id ] ) ) {
		return '';
	}

	$row = $GLOBALS['ie_posts'][ $id ];

	if ( '_ie_campaign' === $key ) {
		return isset( $row['campaign'] ) ? $row['campaign'] : '';
	}
	if ( '_ie_slot' === $key ) {
		return isset( $row['slot'] ) ? (string) $row['slot'] : '';
	}

	return '';
}

function update_post_meta( $id, $key, $value ) { return true; }
function get_permalink( $id ) { return 'https://example.test/post-' . (int) $id; }
function get_the_title( $id ) {
	$id = (int) $id;
	return isset( $GLOBALS['ie_posts'][ $id ] ) ? 'Post ' . $id : '';
}
function get_post_time( $fmt, $gmt = false, $id = 0 ) { return '2026-09-28T09:00:00+00:00'; }

function wp_trash_post( $id ) {
	$id = (int) $id;
	if ( ! isset( $GLOBALS['ie_posts'][ $id ] ) ) {
		return false;
	}

	/* WordPress fires wp_trash_post BEFORE the post is trashed, and that
	 * ordering is the point: the queue is built while the post is still
	 * findable. Calling the callback directly rather than through a fake hook
	 * system keeps the stub small and the sequence honest. */
	IE_Publisher::on_post_gone( $id );

	$GLOBALS['ie_posts'][ $id ]['status'] = 'trash';
	return true;
}

function wp_update_post( $args ) {
	$id = isset( $args['ID'] ) ? (int) $args['ID'] : 0;
	if ( ! $id || ! isset( $GLOBALS['ie_posts'][ $id ] ) ) {
		return 0;
	}
	if ( isset( $args['post_content'] ) ) {
		$GLOBALS['ie_posts'][ $id ]['content'] = $args['post_content'];
	}
	return $id;
}

/**
 * The stub the whole suite turns on.
 *
 * It honours meta_key/meta_value and post_status, because the fix is a
 * meta-value query and a stub that ignored either could not tell the fix
 * from the bug — the mistake that let a trashed post be reported alive for
 * the entire life of the deleted-post feature.
 */
function get_posts( $args ) {
	$GLOBALS['ie_meta_queries']++;

	$key      = isset( $args['meta_key'] ) ? $args['meta_key'] : '';
	$value    = isset( $args['meta_value'] ) ? (string) $args['meta_value'] : '';
	$statuses = isset( $args['post_status'] ) ? (array) $args['post_status'] : array( 'publish' );
	$limit    = isset( $args['numberposts'] ) ? (int) $args['numberposts'] : -1;

	$out = array();

	$wanted = isset( $args['post__in'] ) ? array_map( 'intval', (array) $args['post__in'] ) : null;

	foreach ( $GLOBALS['ie_posts'] as $id => $row ) {
		// post__in is how the deleted-post sweep asks "which of these still
		// exist?" — a stub that ignored it could not tell the report path
		// working from the report path finding nothing.
		if ( null !== $wanted && ! in_array( (int) $id, $wanted, true ) ) {
			continue;
		}
		if ( '_ie_campaign' === $key ) {
			// meta_key with no meta_value means "has this key at all", which
			// is how the repair pass finds every post the plugin wrote.
			if ( '' === $value ) {
				if ( '' === (string) $row['campaign'] ) {
					continue;
				}
			} elseif ( (string) $row['campaign'] !== $value ) {
				continue;
			}
		}
		if ( ! in_array( $row['status'], $statuses, true ) ) {
			continue;
		}

		$out[] = (int) $id;

		if ( $limit > 0 && count( $out ) >= $limit ) {
			break;
		}
	}

	return $out;
}

/* ---------------------------------------------------------------------
 * The real code
 * ------------------------------------------------------------------ */

require_once __DIR__ . '/interlink-engine/includes/class-ie-links.php';
require_once __DIR__ . '/interlink-engine/includes/class-ie-campaigns.php';

/** Connected, so the report path is exercised rather than skipped. */
class IE_Settings {
	public static function is_connected() { return true; }
}

/**
 * Records what the server was told — AND whether the campaign record still
 * existed at that moment.
 *
 * That second fact is the one worth catching. Every report here is built by
 * looking a post up in the record, so a report sent after the record is
 * deleted finds nothing and silently sends nothing at all.
 */
class IE_Api {
	public static function published( $campaign_id, $slot_index, $at = '' ) {
		$GLOBALS['ie_published'][] = array(
			'campaign' => $campaign_id,
			'slot'     => (int) $slot_index,
		);
		return array( 'ok' => true );
	}
	public static function removed( $id ) {
		$GLOBALS['ie_calls'][] = array(
			'call'          => 'removed',
			'campaign'      => $id,
			'record_existed' => (bool) IE_Campaigns::get( $id ),
		);
		return array( 'ok' => true );
	}
	public static function posts_deleted( $campaign_id = '', $slots = array(), $reconcile = false, $live = array() ) {
		$GLOBALS['ie_calls'][] = array(
			'call'           => 'posts_deleted',
			'campaign'       => $campaign_id,
			'missing'        => (array) $slots,
			'record_existed' => (bool) IE_Campaigns::get( $campaign_id ),
		);
		return array( 'ok' => true );
	}
	public static function campaigns_present() { return array( 'ok' => true ); }
}

require_once __DIR__ . '/interlink-engine/includes/class-ie-publisher.php';

/* ---------------------------------------------------------------------
 * Harness
 * ------------------------------------------------------------------ */

$passed = 0;
$failed = 0;
$DECLARED = 52;

function test( $name, $fn ) {
	global $passed, $failed;
	try {
		$fn();
		echo "  ok    $name\n";
		$passed++;
	} catch ( Throwable $e ) {
		/* Throwable, NOT Exception. A PHP 8 TypeError is an Error, which
		 * Exception does not catch — so one test dereferencing a null killed
		 * the whole run, and the suite exited printing no summary at all.
		 * Read quickly, that looks like a pass: no FAIL lines. A crash is a
		 * failure of that test and nothing more. */
		echo "  FAIL  $name\n        " . $e->getMessage() . "\n";
		$failed++;
	}
}

function ok( $cond, $message ) {
	if ( ! $cond ) {
		throw new Exception( $message );
	}
}

function same( $expected, $actual, $message ) {
	if ( $expected !== $actual ) {
		throw new Exception( $message . ' — expected ' . var_export( $expected, true )
			. ', got ' . var_export( $actual, true ) );
	}
}

/* ---------------------------------------------------------------------
 * Fixtures: a six-post campaign, each post holding a placeholder for the
 * next one, exactly as linkPlan.js lays the ring out.
 * ------------------------------------------------------------------ */

const CAMPAIGN_ID = 'camp-abc';

function build_campaign( $keep_record = true ) {
	$GLOBALS['ie_options']      = array();
	$GLOBALS['ie_posts']        = array();
	$GLOBALS['ie_published']    = array();
	$GLOBALS['ie_meta_queries'] = 0;
	$GLOBALS['ie_calls']        = array();

	$slots = array();

	for ( $i = 0; $i < 6; $i++ ) {
		$post_id = 100 + $i;

		/* Each post holds a placeholder for the NEXT slot, and THE LAST ONE
		 * CLOSES BACK TO SLOT 0 — which is what linkPlan.js actually does.
		 *
		 * It used to point at slot 6, which never existed, so every fixture
		 * carried one permanently dead placeholder. Harmless for the swap
		 * tests, and quietly fatal for the repair tests: "a paused campaign
		 * unwraps nothing" could never be true, because that one was always
		 * unwrappable. A fixture that does not match the thing it stands for
		 * makes a correct implementation look broken. */
		$next = ( $i + 1 ) % 6;

		$GLOBALS['ie_posts'][ $post_id ] = array(
			'content'  => '<p>If the meter keeps moving, that points to '
				. '<span data-il-link="slot-' . $next . '">slab leak detection in Leander</span>'
				. ' rather than a fixture problem.</p>',
			'status'   => $i < 3 ? 'publish' : 'future',
			'slot'     => $i,
			'campaign' => CAMPAIGN_ID,
		);

		$slots[] = array(
			'index'   => $i,
			'post_id' => $post_id,
			'status'  => $i < 3 ? 'published' : 'scheduled',
			'topic'   => 'Topic ' . $i,
		);
	}

	if ( $keep_record ) {
		$GLOBALS['ie_options']['ie_campaigns'] = array(
			CAMPAIGN_ID => array(
				'id'     => CAMPAIGN_ID,
				'status' => 'active',
				'slots'  => $slots,
			),
		);
	}
}

/** Publish slot $index, the way WordPress would. */
function publish_slot( $index ) {
	$post_id = 100 + $index;
	$GLOBALS['ie_posts'][ $post_id ]['status'] = 'publish';

	IE_Publisher::on_transition( 'publish', 'future', get_post( $post_id ) );
}

/** The content of the post holding the placeholder for $index. */
function holder_content( $index ) {
	return $GLOBALS['ie_posts'][ 100 + ( $index - 1 ) ]['content'];
}

echo "\nOrphaned publish — a removed campaign must still build its links\n\n";

/* ---------------------------------------------------------------------
 * The baseline: it has to still work normally
 * ------------------------------------------------------------------ */

test( 'WITH THE RECORD PRESENT, PUBLISHING SWAPS THE PLACEHOLDER', function () {
	build_campaign( true );
	publish_slot( 3 );

	ok( strpos( holder_content( 3 ), '<a href="https://example.test/post-103"' ) !== false,
		'the placeholder in the previous post did not become a link' );
	ok( strpos( holder_content( 3 ), 'data-il-link="slot-3"' ) === false,
		'the span survived the swap' );
} );

test( 'the anchor text is preserved exactly', function () {
	build_campaign( true );
	publish_slot( 3 );

	ok( strpos( holder_content( 3 ), '>slab leak detection in Leander</a>' ) !== false,
		'the anchor text was altered or lost' );
} );

test( 'with the record present the server is told', function () {
	build_campaign( true );
	publish_slot( 3 );

	same( 1, count( $GLOBALS['ie_published'] ), 'the publication was not reported' );
	same( CAMPAIGN_ID, $GLOBALS['ie_published'][0]['campaign'], 'reported under the wrong campaign' );
	same( 3, $GLOBALS['ie_published'][0]['slot'], 'reported the wrong slot' );
} );

test( 'THE RECORD IS THE FAST PATH — no meta query when it exists', function () {
	/* The fallback is a query by meta VALUE. Running it on every publish for
	 * every campaign the site still has would be a real cost for nothing. */
	build_campaign( true );
	publish_slot( 3 );

	same( 0, $GLOBALS['ie_meta_queries'],
		'the meta fallback ran even though the campaign record was right there' );
} );

/* ---------------------------------------------------------------------
 * The bug
 * ------------------------------------------------------------------ */

test( 'A REMOVED CAMPAIGN STILL SWAPS ITS PLACEHOLDERS', function () {
	/* THE WHOLE POINT. Before the fix this returned early and the span stayed
	 * a span forever, on a post that was published and working. */
	build_campaign( false );
	publish_slot( 3 );

	ok( strpos( holder_content( 3 ), '<a href="https://example.test/post-103"' ) !== false,
		'the link was never built — a removed campaign still loses its links' );
} );

test( 'A REMOVED CAMPAIGN STILL REPORTS THE PUBLICATION', function () {
	build_campaign( false );
	publish_slot( 3 );

	same( 1, count( $GLOBALS['ie_published'] ),
		'the server was never told, so the report shows it Scheduled forever' );
	same( CAMPAIGN_ID, $GLOBALS['ie_published'][0]['campaign'],
		'the campaign id from post meta did not reach the server' );
} );

test( 'THE DAMAGE REACHES POSTS THAT PUBLISHED BEFORE THE REMOVAL', function () {
	/* The part that is easy to miss. Post 2 went out weeks ago and was
	 * perfectly fine; its forward link was still waiting on post 3. Removing
	 * the campaign broke a post that was already live. */
	build_campaign( false );

	same( 'publish', $GLOBALS['ie_posts'][102]['status'],
		'the fixture is wrong: the holder should already be live' );

	publish_slot( 3 );

	ok( strpos( $GLOBALS['ie_posts'][102]['content'], '<a href=' ) !== false,
		'an already-published post kept its dead placeholder' );
} );

test( 'every post that publishes after a removal is repaired, not just the first', function () {
	build_campaign( false );

	publish_slot( 3 );
	publish_slot( 4 );
	publish_slot( 5 );

	foreach ( array( 3, 4, 5 ) as $index ) {
		ok( strpos( holder_content( $index ), '<a href="https://example.test/post-' . ( 100 + $index ) . '"' ) !== false,
			"slot $index never became a link" );
	}

	same( 3, count( $GLOBALS['ie_published'] ), 'not every publication was reported' );
} );

/* ---------------------------------------------------------------------
 * The guards that must survive the change
 * ------------------------------------------------------------------ */

test( 'A POST THIS PLUGIN DID NOT CREATE IS NEVER EDITED', function () {
	/* The refusal that was already there, and the one that makes a meta query
	 * safe to act on at all. */
	build_campaign( false );

	$GLOBALS['ie_posts'][999] = array(
		'content'  => '<p>Somebody else\'s page with a <span data-il-link="slot-3">phrase</span>.</p>',
		'status'   => 'publish',
		'slot'     => 3,
		'campaign' => '',          // not ours
	);

	publish_slot( 3 );

	ok( strpos( $GLOBALS['ie_posts'][999]['content'], 'data-il-link' ) !== false,
		'a post the plugin did not create was rewritten' );
} );

test( 'A STALE RECORD POINTING AT SOMEBODY ELSE\'S POST IS REFUSED', function () {
	/* THE RECORD PATH, which the test above does not reach: there the meta
	 * query itself filters foreign posts out, so the refusal never runs and a
	 * mutation removing it passed.
	 *
	 * A slot's post_id is a small integer. If a record goes stale and points
	 * at an unrelated page, rewriting it would be very hard to notice and
	 * impossible to undo — so the guard checks the POST, not the record that
	 * names it. */
	build_campaign( true );

	// The record says slot 2 lives at post 777. The post exists and even
	// carries a matching placeholder — but this plugin never wrote it.
	$GLOBALS['ie_options']['ie_campaigns'][ CAMPAIGN_ID ]['slots'][2]['post_id'] = 777;

	$GLOBALS['ie_posts'][777] = array(
		'content'  => '<p>The owner\'s own page, with a <span data-il-link="slot-3">phrase</span>.</p>',
		'status'   => 'publish',
		'slot'     => 2,
		'campaign' => '',          // not ours
	);

	publish_slot( 3 );

	ok( strpos( $GLOBALS['ie_posts'][777]['content'], 'data-il-link="slot-3"' ) !== false,
		'a stale record was trusted and somebody else\'s page was rewritten' );
} );

test( 'A TRASHED POST IS LEFT ALONE', function () {
	/* Editing it would rewrite content in the owner's bin and bump its
	 * modified date — the one thing that makes a deletion look like an edit. */
	build_campaign( false );
	$GLOBALS['ie_posts'][102]['status'] = 'trash';

	publish_slot( 3 );

	ok( strpos( $GLOBALS['ie_posts'][102]['content'], 'data-il-link="slot-3"' ) !== false,
		'a trashed post was edited' );
} );

test( 'a post cannot activate a placeholder pointing at itself', function () {
	build_campaign( false );

	// Give slot 3's own post a span for slot 3, which the ring never does.
	$GLOBALS['ie_posts'][103]['content'] =
		'<p>A <span data-il-link="slot-3">self reference</span>.</p>';

	publish_slot( 3 );

	ok( strpos( $GLOBALS['ie_posts'][103]['content'], 'data-il-link="slot-3"' ) !== false,
		'a post linked to itself' );
} );

test( 'a post with no placeholder for this slot is not rewritten', function () {
	build_campaign( false );
	$before = $GLOBALS['ie_posts'][100]['content'];

	publish_slot( 3 );   // post 100 holds slot-1, not slot-3

	same( $before, $GLOBALS['ie_posts'][100]['content'],
		'a post with nothing to swap was rewritten anyway' );
} );

test( 'A POST WITH NO CAMPAIGN META IS IGNORED ENTIRELY', function () {
	/* The very first guard. An ordinary post the owner wrote must never send
	 * this code down either path. */
	build_campaign( false );

	$GLOBALS['ie_posts'][500] = array(
		'content'  => '<p>An ordinary post.</p>',
		'status'   => 'publish',
		'slot'     => 0,
		'campaign' => '',
	);

	$GLOBALS['ie_meta_queries'] = 0;
	IE_Publisher::on_transition( 'publish', 'future', get_post( 500 ) );

	same( 0, $GLOBALS['ie_meta_queries'], 'an unrelated post triggered a query' );
	same( 0, count( $GLOBALS['ie_published'] ), 'an unrelated post was reported to the server' );
} );

/* ---------------------------------------------------------------------
 * Removing a campaign, and the safe half of the pair
 *
 * "Remove campaign" used to delete the record and leave every post where it
 * was — so a campaign removed halfway went on publishing on schedule. Nobody
 * presses that button wanting the wrong articles kept and only the management
 * of them forgotten.
 * ------------------------------------------------------------------ */

test( 'THE COUNTS COME FROM THE POSTS, NOT FROM THE SLOT STATUSES', function () {
	/* The dialog has to name the damage before it is done, and a slot says
	 * what the plugin last heard rather than what is on the site now. The two
	 * disagree exactly when somebody has been editing by hand. */
	build_campaign( true );

	// The record still calls slot 4 scheduled; the owner published it.
	$GLOBALS['ie_posts'][104]['status'] = 'publish';

	$counts = IE_Publisher::count_campaign_posts( CAMPAIGN_ID );

	same( 4, $counts['published'], 'a hand-published post was counted as a draft' );
	same( 2, $counts['drafts'], 'the unpublished count is wrong' );
} );

test( 'REMOVING A CAMPAIGN TRASHES EVERY POST IT MADE', function () {
	build_campaign( true );

	$counts = IE_Publisher::remove_campaign_posts( CAMPAIGN_ID );

	same( 3, $counts['published'], 'the published articles were not trashed' );
	same( 3, $counts['drafts'], 'the scheduled posts were not trashed' );

	for ( $i = 0; $i < 6; $i++ ) {
		same( 'trash', $GLOBALS['ie_posts'][ 100 + $i ]['status'], "post $i survived the removal" );
	}
} );

test( 'TRASH, NEVER DELETE', function () {
	/* The reason this action is allowed to exist. Thirty days to discover
	 * that the campaign thrown away was the wrong one. */
	build_campaign( true );
	IE_Publisher::remove_campaign_posts( CAMPAIGN_ID );

	same( 6, count( $GLOBALS['ie_posts'] ), 'a post was destroyed rather than trashed' );
} );

test( 'removal works with no local record', function () {
	// The same fallback the link swap uses: the posts carry the campaign id.
	build_campaign( false );

	$counts = IE_Publisher::remove_campaign_posts( CAMPAIGN_ID );

	same( 3, $counts['published'], 'an orphaned campaign could not be cleaned up' );
	same( 3, $counts['drafts'], 'an orphaned campaign could not be cleaned up' );
} );

test( 'REMOVAL REFUSES A POST THIS PLUGIN DID NOT CREATE', function () {
	/* A slot's post_id is a small integer. A stale record pointing at an
	 * unrelated page would put somebody's About page in the bin. */
	build_campaign( true );
	$GLOBALS['ie_options']['ie_campaigns'][ CAMPAIGN_ID ]['slots'][2]['post_id'] = 777;

	$GLOBALS['ie_posts'][777] = array(
		'content'  => '<p>The owner\'s own page.</p>',
		'status'   => 'publish',
		'slot'     => 2,
		'campaign' => '',          // not ours
	);

	IE_Publisher::remove_campaign_posts( CAMPAIGN_ID );

	same( 'publish', $GLOBALS['ie_posts'][777]['status'],
		'a page the plugin did not create was moved to Trash' );
} );

test( 'an already-trashed post is not counted twice', function () {
	build_campaign( true );
	$GLOBALS['ie_posts'][105]['status'] = 'trash';

	$counts = IE_Publisher::remove_campaign_posts( CAMPAIGN_ID );

	same( 2, $counts['drafts'], 'a post already in the bin was counted again' );
} );

test( 'DELETING THE REMAINING DRAFTS LEAVES PUBLISHED ARTICLES ALONE', function () {
	/* THE LINE THAT MAKES THIS THE SAFE BUTTON, and the whole reason Remove
	 * no longer has to be two things at once. */
	build_campaign( true );

	$gone = IE_Publisher::delete_remaining_drafts( CAMPAIGN_ID );

	same( 3, $gone, 'the unpublished posts were not trashed' );

	foreach ( array( 0, 1, 2 ) as $i ) {
		same( 'publish', $GLOBALS['ie_posts'][ 100 + $i ]['status'],
			"published post $i was trashed by the safe button" );
	}
	foreach ( array( 3, 4, 5 ) as $i ) {
		same( 'trash', $GLOBALS['ie_posts'][ 100 + $i ]['status'],
			"unpublished post $i was left behind" );
	}
} );

test( 'the safe button also refuses a post this plugin did not create', function () {
	build_campaign( true );
	$GLOBALS['ie_options']['ie_campaigns'][ CAMPAIGN_ID ]['slots'][4]['post_id'] = 888;

	$GLOBALS['ie_posts'][888] = array(
		'content'  => '<p>Somebody else\'s draft.</p>',
		'status'   => 'draft',
		'slot'     => 4,
		'campaign' => '',
	);

	IE_Publisher::delete_remaining_drafts( CAMPAIGN_ID );

	same( 'draft', $GLOBALS['ie_posts'][888]['status'],
		'a draft the plugin did not create was moved to Trash' );
} );

test( 'a campaign with nothing left to delete does nothing', function () {
	build_campaign( true );
	foreach ( array( 3, 4, 5 ) as $i ) {
		$GLOBALS['ie_posts'][ 100 + $i ]['status'] = 'publish';
	}

	same( 0, IE_Publisher::delete_remaining_drafts( CAMPAIGN_ID ),
		'a fully published campaign reported posts trashed' );
} );

/* ---------------------------------------------------------------------
 * The order of the four steps in remove_campaign()
 *
 * Every report here is built by looking a post up in the campaign record. Do
 * them in the wrong order and each one finds nothing, sends nothing, and says
 * nothing — and no sweep can ever heal it, because the record it would walk
 * is exactly what was deleted.
 * ------------------------------------------------------------------ */

/** The calls made to the server, in order, by name. */
function call_names() {
	$out = array();
	foreach ( $GLOBALS['ie_calls'] as $call ) {
		$out[] = $call['call'];
	}
	return $out;
}

function first_call( $name ) {
	foreach ( $GLOBALS['ie_calls'] as $call ) {
		if ( $name === $call['call'] ) {
			return $call;
		}
	}
	return null;
}

test( 'REMOVAL REPORTS THE TRASHED POSTS BEFORE DELETING THE RECORD', function () {
	/* THE BUG THIS PINS. The deleted-post report is queued by the trash hook
	 * and normally goes out on shutdown — which is after the record has been
	 * deleted, by which time slot_report_due() finds nothing. Twelve articles
	 * would sit in the bin while the Blog Report went on calling them live. */
	build_campaign( true );

	IE_Publisher::remove_campaign( CAMPAIGN_ID );

	$report = first_call( 'posts_deleted' );

	ok( $report, 'the trashed posts were never reported to the server' );
	ok( $report['record_existed'],
		'the report was sent after the record was deleted, so it carried nothing' );
} );

test( 'THE REPORT NAMES THE POSTS THAT WERE ACTUALLY TRASHED', function () {
	// A report that arrives empty is the same as no report at all, and looks
	// exactly like a healthy campaign from the server's side.
	build_campaign( true );

	IE_Publisher::remove_campaign( CAMPAIGN_ID );

	$report = first_call( 'posts_deleted' );
	ok( $report, 'no report was sent at all' );

	same( 6, count( $report['missing'] ),
		'the report went out empty, which the server reads as "nothing changed"' );
} );

test( 'THE CAMPAIGN IS REPORTED GONE BEFORE ITS RECORD IS', function () {
	/* The server's campaign id lives inside the record. Delete it first and
	 * there is nothing left to name. */
	build_campaign( true );

	IE_Publisher::remove_campaign( CAMPAIGN_ID );

	$removed = first_call( 'removed' );

	ok( $removed, 'the server was never told the campaign was removed' );
	ok( $removed['record_existed'],
		'the removal was reported after the record was deleted' );
} );

test( 'the posts are reported before the campaign is', function () {
	// Reversed, the campaign is gone on the server before it hears which of
	// its posts went with it.
	build_campaign( true );

	IE_Publisher::remove_campaign( CAMPAIGN_ID );

	$names = call_names();
	ok( ! empty( $names ), 'nothing was reported to the server at all' );

	same( 'posts_deleted', $names[0], 'the campaign removal was reported first' );
	ok( in_array( 'removed', $names, true ), 'the campaign removal was never reported' );
} );

test( 'THE RECORD IS ACTUALLY GONE AFTERWARDS', function () {
	// The guard against fixing the ordering by never deleting anything.
	build_campaign( true );

	IE_Publisher::remove_campaign( CAMPAIGN_ID );

	same( null, IE_Campaigns::get( CAMPAIGN_ID ), 'the campaign record survived removal' );
} );

test( 'removing an orphaned campaign still reports its posts', function () {
	/* No record to look them up in — the report path has to reach the same
	 * fallback the link swap does, or a campaign removed twice loses its
	 * second removal entirely. */
	build_campaign( false );

	$trashed = IE_Publisher::remove_campaign( CAMPAIGN_ID );

	same( 3, $trashed['published'], 'the orphaned campaign was not cleaned up' );
} );

/* ---------------------------------------------------------------------
 * The repair pass
 *
 * The 0.8.1 fix works at the moment a post publishes. Every post that
 * published BEFORE it, under a campaign that had been removed, had its swap
 * fail silently and nothing retries it. Those placeholders are frozen, not
 * decaying — they sit there for as long as the posts do.
 * ------------------------------------------------------------------ */

/** A campaign whose posts all published while the swaps were broken. */
function build_broken( $keep_record = false ) {
	build_campaign( $keep_record );

	foreach ( $GLOBALS['ie_posts'] as $id => $row ) {
		$GLOBALS['ie_posts'][ $id ]['status'] = 'publish';
	}
}

test( 'THE REPAIR PASS RESTORES LINKS THAT WERE NEVER SWITCHED ON', function () {
	/* THE POINT OF THE WHOLE EXERCISE. Six published articles, every
	 * placeholder among them dead, and nothing on the site says so. */
	build_broken();

	$stats = IE_Publisher::repair_links();

	// Six posts, six placeholders, the last closing the ring back to slot 0.
	same( 6, $stats['restored'], 'the dead links were not restored' );

	ok( strpos( $GLOBALS['ie_posts'][102]['content'], '<a href="https://example.test/post-103"' ) !== false,
		'a placeholder was left as a span' );
} );

test( 'A PLACEHOLDER FOR A POST THAT WILL NEVER EXIST IS UNWRAPPED', function () {
	/* A campaign cut short leaves its last article waiting on a post that was
	 * deleted or never written. The span waits forever, invisible, and every
	 * later pass has to look at it again. */
	build_broken();

	// The campaign was cut short: slot 0's post is gone, and post 5 has been
	// holding a placeholder for it ever since.
	unset( $GLOBALS['ie_posts'][100] );

	$stats = IE_Publisher::repair_links();

	same( 1, $stats['unwrapped'], 'the placeholder for a missing post was left waiting' );
	ok( strpos( $GLOBALS['ie_posts'][105]['content'], 'data-il-link' ) === false,
		'the dead placeholder survived' );
} );

test( 'unwrapping leaves the words, and only removes the marker', function () {
	// The sentence was written as prose; the wrapper was added afterwards.
	// A reader must not be able to tell the difference.
	build_broken();
	unset( $GLOBALS['ie_posts'][100] );
	IE_Publisher::repair_links();

	ok( strpos( $GLOBALS['ie_posts'][105]['content'], 'slab leak detection in Leander' ) !== false,
		'unwrapping ate the anchor text' );
	ok( strpos( $GLOBALS['ie_posts'][105]['content'], '<a ' ) === false,
		'unwrapping invented a link' );
} );

test( 'A PAUSED CAMPAIGN KEEPS ITS PLACEHOLDERS', function () {
	/* THE JUDGEMENT THAT COULD DESTROY A CAMPAIGN. Pause turns scheduled
	 * posts into drafts. Those posts publish again on resume, so their
	 * placeholders are waiting legitimately — unwrapping them would quietly
	 * dismantle the links of a campaign that is merely paused, and resuming
	 * would not bring them back. */
	build_campaign( true );

	foreach ( array( 3, 4, 5 ) as $i ) {
		$GLOBALS['ie_posts'][ 100 + $i ]['status'] = 'draft';   // held by pause
	}

	$stats = IE_Publisher::repair_links();

	same( 0, $stats['unwrapped'], 'a paused campaign had its links unwrapped' );

	ok( strpos( $GLOBALS['ie_posts'][102]['content'], 'data-il-link="slot-3"' ) !== false,
		'a held post\'s inbound placeholder was destroyed' );

} );

test( 'A POST WHOSE PLACEHOLDERS ARE ALL STILL WAITING IS NOT REWRITTEN', function () {
	/* Saving a post that did not change bumps its modified date, which tells
	 * search engines to re-crawl it — every post, every time somebody presses
	 * the button, for nothing.
	 *
	 * Needs a campaign where NOTHING can be resolved: one published post
	 * holding a placeholder for a draft. The paused fixture above does not
	 * work here, because two of its targets are published and those links are
	 * correctly restored. */
	build_campaign( true );

	// EVERY post a draft. The ring closes, so post 5 points back at post 0 —
	// leave that one published and it resolves, and the fixture stops being
	// the thing it is standing for.
	for ( $i = 0; $i < 6; $i++ ) {
		$GLOBALS['ie_posts'][ 100 + $i ]['status'] = 'draft';
	}

	$stats = IE_Publisher::repair_links();

	same( 0, $stats['restored'], 'the fixture resolved something it should not have' );
	same( 0, $stats['posts'], 'posts were rewritten although nothing in them changed' );
	ok( $stats['waiting'] > 0, 'nothing was reported as still waiting' );
} );

test( 'a still-scheduled post keeps its placeholder too', function () {
	build_campaign( true );   // posts 3..5 are 'future'

	$stats = IE_Publisher::repair_links();

	same( 0, $stats['unwrapped'], 'a campaign still running was unwrapped' );
	ok( $stats['waiting'] > 0, 'nothing was reported as still waiting' );
} );

test( 'A TRASHED TARGET COUNTS AS NEVER COMING', function () {
	// The owner threw it away. No link is arriving.
	build_broken();
	$GLOBALS['ie_posts'][103]['status'] = 'trash';

	$stats = IE_Publisher::repair_links();

	ok( strpos( $GLOBALS['ie_posts'][102]['content'], 'data-il-link="slot-3"' ) === false,
		'a placeholder for a trashed post was left waiting' );
} );

test( 'THE PASS IS SAFE TO RUN TWICE', function () {
	/* It runs from a button. Somebody will press it again. */
	build_broken();

	$first  = IE_Publisher::repair_links();
	$second = IE_Publisher::repair_links();

	ok( $first['restored'] > 0, 'the first pass did nothing' );
	same( 0, $second['restored'], 'the second pass restored links again' );
	same( 0, $second['unwrapped'], 'the second pass unwrapped again' );
	same( 0, $second['posts'], 'the second pass rewrote posts with nothing to change' );
} );

test( 'a post with nothing pending is never rewritten', function () {
	// Bumping the modified date of a post that did not change tells search
	// engines to re-crawl for no reason, on every post, every time.
	build_broken();
	IE_Publisher::repair_links();

	$before = $GLOBALS['ie_posts'][100]['content'];
	$stats  = IE_Publisher::repair_links();

	same( $before, $GLOBALS['ie_posts'][100]['content'], 'an unchanged post was rewritten' );
	same( 0, $stats['posts'], 'posts were counted as repaired with nothing to repair' );
} );

test( 'THE REPAIR PASS IGNORES POSTS THIS PLUGIN DID NOT WRITE', function () {
	build_broken();

	$GLOBALS['ie_posts'][999] = array(
		'content'  => '<p>Somebody else\'s page with a <span data-il-link="slot-3">phrase</span>.</p>',
		'status'   => 'publish',
		'slot'     => 3,
		'campaign' => '',          // no campaign meta
	);

	IE_Publisher::repair_links();

	ok( strpos( $GLOBALS['ie_posts'][999]['content'], 'data-il-link="slot-3"' ) !== false,
		'a page the plugin did not write was rewritten' );
} );

test( 'a token this plugin does not write is left alone', function () {
	// Somebody else's markup, or a hand-edit. Guessing at it is worse than
	// ignoring it.
	build_broken();
	$GLOBALS['ie_posts'][100]['content'] =
		'<p>A <span data-il-link="something-else">phrase</span>.</p>';

	IE_Publisher::repair_links();

	ok( strpos( $GLOBALS['ie_posts'][100]['content'], 'data-il-link="something-else"' ) !== false,
		'an unrecognised token was rewritten' );
} );

test( 'the repair works with no campaign record at all', function () {
	// The case it exists for: six campaigns removed months ago.
	build_broken( false );

	$stats = IE_Publisher::repair_links();

	ok( $stats['restored'] > 0, 'an orphaned campaign could not be repaired' );
} );

/* ---------------------------------------------------------------------
 * Closing out a campaign that has nothing left to do
 * ------------------------------------------------------------------ */

test( 'ABANDONING THE REST MARKS THE CAMPAIGN CANCELLED, NOT COMPLETED', function () {
	/* It produced three posts of six. "Completed" is the small lie this
	 * codebase keeps getting punished for — six months on, nobody could tell
	 * it apart from a campaign that ran its course. 'cancelled' already meant
	 * abandoned, and the server already refuses to write or publish for one. */
	build_campaign( true );

	IE_Publisher::abandon_remaining( CAMPAIGN_ID );

	$after = IE_Campaigns::get( CAMPAIGN_ID );

	same( 'cancelled', $after['status'], 'the campaign was not closed out' );
} );

test( 'the published posts survive being closed out', function () {
	build_campaign( true );

	$gone = IE_Publisher::abandon_remaining( CAMPAIGN_ID );

	same( 3, $gone, 'the unpublished posts were not trashed' );

	foreach ( array( 0, 1, 2 ) as $i ) {
		same( 'publish', $GLOBALS['ie_posts'][ 100 + $i ]['status'],
			"published post $i was trashed" );
	}
} );

test( 'A CAMPAIGN WITH NOTHING TO ABANDON IS NOT MARKED CANCELLED', function () {
	/* The same lie in the other direction. A campaign whose posts have all
	 * published has nothing to throw away and ran its course. */
	build_campaign( true );
	foreach ( array( 3, 4, 5 ) as $i ) {
		$GLOBALS['ie_posts'][ 100 + $i ]['status'] = 'publish';
	}

	same( 0, IE_Publisher::abandon_remaining( CAMPAIGN_ID ), 'something was trashed' );

	$after = IE_Campaigns::get( CAMPAIGN_ID );
	same( 'active', $after['status'], 'a fully published campaign was marked cancelled' );
} );

test( 'closing out clears paused_at', function () {
	/* It is not stopped any more, it is over. A leftover timestamp would have
	 * resume trying to shift dates that no longer exist. */
	build_campaign( true );
	IE_Campaigns::set_status( CAMPAIGN_ID, 'paused', array( 'paused_at' => '2026-09-20T09:00:00+00:00' ) );

	IE_Publisher::abandon_remaining( CAMPAIGN_ID );

	$after = IE_Campaigns::get( CAMPAIGN_ID );
	ok( empty( $after['paused_at'] ), 'the pause timestamp survived the campaign' );
} );

/* ---------------------------------------------------------------------
 * Naming the post left one link lighter
 * ------------------------------------------------------------------ */

test( 'THE REPAIR PASS NAMES THE POST IT LEFT SHORT A LINK', function () {
	/* Unwrapping is correct and still costs a link that was planned. The
	 * plugin cannot write the replacement — the anchor text was chosen to
	 * describe the post that never arrived, so pointing it anywhere else
	 * gives a link whose words promise one article and deliver another. A
	 * person can write that sentence, so say which post needs one. */
	build_broken();
	unset( $GLOBALS['ie_posts'][100] );

	$stats = IE_Publisher::repair_links();

	same( 1, count( $stats['short'] ), 'the post left short a link was not named' );
	ok( isset( $stats['short']['Post 105'] ), 'the wrong post was named' );
} );

test( 'IT NAMES THE POST THAT WOULD CLOSE THE RING', function () {
	/* Naming the problem without naming the fix is half a message. The ring
	 * closes backwards to the first post — linkPlan.js gives the last slot
	 * `next = slots[0]` — so the post left last should point where the real
	 * last post would have. */
	build_broken();

	// Slot 2's post is gone, so post 1 is left holding a dead forward link.
	unset( $GLOBALS['ie_posts'][102] );

	$stats = IE_Publisher::repair_links();

	same( 'Post 100', $stats['short']['Post 101'],
		'the suggested target is not the post the ring closes back to' );
} );

test( 'it does not suggest the post itself', function () {
	build_broken();
	unset( $GLOBALS['ie_posts'][101] );

	$stats = IE_Publisher::repair_links();

	ok( isset( $stats['short']['Post 100'] ), 'the fixture did not leave post 100 short' );
	ok( 'Post 100' !== $stats['short']['Post 100'], 'a post was told to link to itself' );
} );

test( 'a post that is not published is never suggested', function () {
	// Sending a reader to a draft is a 404 for everyone but the owner.
	build_broken();
	unset( $GLOBALS['ie_posts'][102] );
	$GLOBALS['ie_posts'][100]['status'] = 'draft';

	$stats = IE_Publisher::repair_links();

	ok( 'Post 100' !== $stats['short']['Post 101'], 'a draft was suggested as a link target' );
} );

test( 'NO SUGGESTION IS MADE WHEN THERE IS NOWHERE TO POINT', function () {
	/* A campaign down to one surviving post has no ring left to close, and
	 * inventing a target would be worse than admitting there is none. */
	build_broken();

	foreach ( array( 100, 101, 102, 103, 104 ) as $id ) {
		unset( $GLOBALS['ie_posts'][ $id ] );
	}

	$stats = IE_Publisher::repair_links();

	same( '', $stats['short']['Post 105'], 'a target was invented out of nothing' );
} );

test( 'a post is named once however many links it lost', function () {
	build_broken();
	unset( $GLOBALS['ie_posts'][100] );

	// A second dead placeholder in the same post.
	$GLOBALS['ie_posts'][105]['content'] .=
		'<p>And <span data-il-link="slot-9">another phrase</span>.</p>';

	$stats = IE_Publisher::repair_links();

	same( 2, $stats['unwrapped'], 'both placeholders were not unwrapped' );
	same( 1, count( $stats['short'] ), 'the post was named twice' );
} );

test( 'nothing is named when nothing was unwrapped', function () {
	build_broken();

	$stats = IE_Publisher::repair_links();

	same( array(), $stats['short'], 'a post was named although nothing was lost' );
} );

/* ------------------------------------------------------------------ */

echo "\n  $passed passed, $failed failed\n";

if ( $passed + $failed !== $DECLARED ) {
	echo "  MISCOUNT: " . ( $passed + $failed ) . " ran, $DECLARED declared\n";
}

echo "\n";

exit( $failed > 0 ? 1 : 0 );
