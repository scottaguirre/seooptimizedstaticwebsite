<?php
/**
 * test-blog-image.php
 *
 * One picture, above the title of every article in a campaign.
 *
 * WHAT THIS IS GUARDING
 *
 * Edwin asked for an image option "like the YouTube Video option", placed
 * "above the title of the article". The video is a shortcode in post_content,
 * and nothing in post_content can sit above a title — WordPress renders the
 * content below it, always. So this is the FEATURED IMAGE, which is an
 * attachment id, which means a remote URL has to be downloaded into the media
 * library before it can be used at all.
 *
 * Three things follow from that, and each is a way to get it wrong:
 *
 *   ONE DOWNLOAD PER URL, not one per post. Twenty-two posts sharing one
 *   picture must not put twenty-two copies in a customer's media library.
 *
 *   A SHARED ATTACHMENT HAS ONE ALT TEXT, because in WordPress alt text
 *   belongs to the library item and not to the post. Twenty-two articles on
 *   twenty-two subjects describing their picture identically is the opposite
 *   of what alt text is for, on a product sold for search visibility. So each
 *   post carries its own, and a filter swaps it in.
 *
 *   A FAILED DOWNLOAD IS NOT A FAILED POST. The article is written and
 *   charged for before any of this runs.
 *
 *   php wp-plugin/test-blog-image.php
 */

error_reporting( E_ALL );

define( 'ABSPATH', '/tmp/' );

/* --------------------------------------------------------------------
 * Just enough WordPress
 * ----------------------------------------------------------------- */

$GLOBALS['ie_options']   = array();
$GLOBALS['ie_post_meta'] = array();
$GLOBALS['ie_post_type'] = array();   // id => 'attachment' | 'post' | absent
$GLOBALS['ie_thumbs']    = array();   // post id => attachment id
$GLOBALS['ie_current']   = 0;         // what get_the_ID() answers

function get_option( $k, $d = null ) {
	return array_key_exists( $k, $GLOBALS['ie_options'] ) ? $GLOBALS['ie_options'][ $k ] : $d;
}
function update_option( $k, $v, $autoload = null ) { $GLOBALS['ie_options'][ $k ] = $v; return true; }

function update_post_meta( $id, $k, $v ) { $GLOBALS['ie_post_meta'][ $id ][ $k ] = $v; return true; }
function delete_post_meta( $id, $k ) { unset( $GLOBALS['ie_post_meta'][ $id ][ $k ] ); return true; }
function get_post_meta( $id, $k, $single = false ) {
	return isset( $GLOBALS['ie_post_meta'][ $id ][ $k ] ) ? $GLOBALS['ie_post_meta'][ $id ][ $k ] : '';
}

/* RETURNS false FOR SOMETHING THAT IS NOT THERE, exactly as WordPress does.
 * A stub answering 'attachment' unconditionally cannot model the case this
 * feature's cache exists to survive: a customer deleting the picture from
 * their media library and leaving the option pointing at a dead id. */
function get_post_type( $id ) {
	return isset( $GLOBALS['ie_post_type'][ $id ] ) ? $GLOBALS['ie_post_type'][ $id ] : false;
}

function get_the_ID() { return $GLOBALS['ie_current'] ? $GLOBALS['ie_current'] : false; }
function get_post_thumbnail_id( $id = null ) {
	$id = $id ? $id : $GLOBALS['ie_current'];
	return isset( $GLOBALS['ie_thumbs'][ $id ] ) ? $GLOBALS['ie_thumbs'][ $id ] : 0;
}

function wp_strip_all_tags( $s ) { return trim( strip_tags( (string) $s ) ); }
function add_filter() {}
function wp_parse_url( $url, $component = -1 ) { return parse_url( $url, $component ); }

$GLOBALS['ie_thumb_set'] = array();   // post id => attachment id, as set_post_thumbnail saw it
$GLOBALS['ie_log']       = array();
$GLOBALS['ie_sideload']  = null;      // what media_handle_sideload will answer
$GLOBALS['ie_download']  = null;      // what download_url will answer
$GLOBALS['ie_deleted']   = array();   // temp files cleaned up
$GLOBALS['ie_fetched']   = array();   // every URL download_url was asked for

function set_post_thumbnail( $post_id, $id ) { $GLOBALS['ie_thumb_set'][ $post_id ] = (int) $id; return true; }
function sanitize_file_name( $n ) { return preg_replace( '/[^A-Za-z0-9._-]/', '', (string) $n ); }
function wp_delete_file( $f ) { $GLOBALS['ie_deleted'][] = $f; return true; }

/* A WP_Error that behaves like the real one where this code touches it. */
class WP_Error {
	private $msg;
	public function __construct( $code = '', $msg = '' ) { $this->msg = $msg; }
	public function get_error_message() { return $this->msg; }
}
function is_wp_error( $t ) { return $t instanceof WP_Error; }

/* IT REALLY CREATES THE FILE, because the code under test guards its cleanup
 * with file_exists(). A stub that returns a path to nothing cannot exercise
 * the branch that stops /tmp filling up, and the test would pass against code
 * that never cleans up at all. */
function download_url( $url, $timeout = 300 ) {
	$GLOBALS['ie_fetched'][] = $url;

	if ( null !== $GLOBALS['ie_download'] ) {
		return $GLOBALS['ie_download'];
	}

	file_put_contents( '/tmp/ie-fixture.jpg', 'not really a jpeg' );

	return '/tmp/ie-fixture.jpg';
}
function media_handle_sideload( $file, $post_id ) {
	return null === $GLOBALS['ie_sideload'] ? 4242 : $GLOBALS['ie_sideload'];
}

/* The plugin logs through IE_Publisher, which is not loaded here. */
class IE_Publisher {
	public static function log( $m ) { $GLOBALS['ie_log'][] = $m; }
}

require_once __DIR__ . '/interlink-engine/includes/class-ie-image.php';

/* --------------------------------------------------------------------
 * Harness
 * ----------------------------------------------------------------- */

$passed = 0; $failed = 0;

function test( $name, $fn ) {
	global $passed, $failed;
	try { $fn(); echo "  ok    $name\n"; $passed++; }
	catch ( Throwable $e ) { echo "  FAIL  $name\n        " . $e->getMessage() . "\n"; $failed++; }
}
function ok( $c, $m ) { if ( ! $c ) { throw new Exception( $m ); } }
function same( $a, $b, $m = 'not equal' ) {
	ok( $a === $b, "$m — expected " . var_export( $a, true ) . ', got ' . var_export( $b, true ) );
}
function section( $n ) { echo "\n$n\n\n"; }

function reset_state() {
	$GLOBALS['ie_thumb_set'] = array();
	$GLOBALS['ie_log']       = array();
	$GLOBALS['ie_sideload']  = null;
	$GLOBALS['ie_download']  = null;
	$GLOBALS['ie_deleted']   = array();
	$GLOBALS['ie_fetched']   = array();
	$GLOBALS['ie_options']   = array();
	$GLOBALS['ie_post_meta'] = array();
	$GLOBALS['ie_post_type'] = array();
	$GLOBALS['ie_thumbs']    = array();
	$GLOBALS['ie_current']   = 0;
}

const PIC = 'https://cdn.example.com/roof.jpg';

/* ================================================================== */

section( 'Which picture an article gets' );

test( 'the campaign picture, when the row has none', function () {
	same( PIC, IE_Image::image_for( array( 'image_url' => PIC ), array( 'topic' => 'x' ) ) );
} );

test( "AND THE ROW'S OWN WHEN IT HAS ONE", function () {
	$own = 'https://cdn.example.com/gutters.png';

	same( $own, IE_Image::image_for(
		array( 'image_url' => PIC ),
		array( 'topic' => 'x', 'image_url' => $own )
	) );
} );

test( 'an empty row means "use the campaign\'s", not "none"', function () {
	/* The same rule video_for() follows, and for the same reason: there is no
	 * control in the UI that says "no picture on this one", so an empty box
	 * cannot be read as somebody asking for that. */
	same( PIC, IE_Image::image_for( array( 'image_url' => PIC ), array( 'topic' => 'x', 'image_url' => '' ) ) );
} );

test( 'and no campaign picture means none at all', function () {
	same( '', IE_Image::image_for( array(), array( 'topic' => 'x' ) ) );
	same( '', IE_Image::image_for( null, null ) );
} );

section( 'What the picture says it shows' );

test( "THE ARTICLE'S MAIN KEYWORD", function () {
	same( 'roof flashing repair', IE_Image::alt_for( array(
		'topic'        => 'Cloudy Glasses and White Scale Usually Mean Hard Water',
		'target_query' => 'roof flashing repair',
	) ) );
} );

test( 'AND NOT THE HEADLINE, when both are there', function () {
	/* A headline is written to be clicked. Alt text written like one
	 * describes the article rather than the picture, and the main keyword is
	 * the plain phrase the post is actually about — closer to what somebody
	 * would say if asked what the picture on this page is for. */
	$alt = IE_Image::alt_for( array(
		'topic'        => 'Seven Signs Your Roof Is About To Fail',
		'target_query' => 'roof replacement signs',
	) );

	same( 'roof replacement signs', $alt );
	ok( false === strpos( $alt, 'Seven Signs' ), 'the headline leaked into the alt text' );
} );

test( 'the headline is the fallback when the keyword column is empty', function () {
	/* The column is filled in by hand, so it can be blank. An imperfect
	 * description beats silence on a picture that is the first thing above
	 * the title. */
	same( 'Roof flashing failures', IE_Image::alt_for( array(
		'topic'        => 'Roof flashing failures',
		'target_query' => '   ',
	) ) );

	same( 'Roof flashing failures', IE_Image::alt_for( array( 'topic' => 'Roof flashing failures' ) ) );
} );

test( 'stripped and trimmed, because it reaches an attribute', function () {
	same( 'roof flashing', IE_Image::alt_for( array( 'target_query' => "  <b>roof</b> flashing\n" ) ) );
	same( 'Roof flashing', IE_Image::alt_for( array( 'topic' => "  <b>Roof</b> flashing\n" ) ) );
} );

test( 'a slot with neither describes nothing rather than guessing', function () {
	/* An empty alt is correct for a decorative image and merely unhelpful for
	 * a meaningful one. An invented description is wrong, and a screen reader
	 * reads it out as though it were true. */
	same( '', IE_Image::alt_for( array() ) );
	same( '', IE_Image::alt_for( null ) );
} );

section( 'Which addresses are worth trying' );

test( 'ordinary image URLs are', function () {
	foreach ( array(
		'https://cdn.example.com/a.jpg',
		'http://example.com/b.PNG',
		'https://example.com/c.webp',
		'https://example.com/d.avif',
	) as $url ) {
		ok( IE_Image::usable( $url ), "refused $url" );
	}
} );

test( 'AND SO IS ONE WITH NO EXTENSION AT ALL', function () {
	/* A CDN route, a signed endpoint, a WordPress attachment page. Refusing
	 * these would turn a guess about the address into a refusal of a good
	 * picture, and the sideload still checks the actual bytes afterwards. */
	ok( IE_Image::usable( 'https://images.example.com/photo/9f3b2a' ), 'a URL with no extension was refused' );
	ok( IE_Image::usable( 'https://cdn.example.com/a.jpg?v=9&token=abc' ), 'a query string broke the check' );
} );

test( 'a wrong extension is not', function () {
	ok( ! IE_Image::usable( 'https://example.com/brochure.pdf' ), 'a PDF was accepted as a picture' );
	ok( ! IE_Image::usable( 'https://example.com/notes.txt' ), 'a text file was accepted' );
} );

test( 'AND NEITHER IS SVG', function () {
	/* A script-bearing format. WordPress refuses it by default, and a
	 * featured image is not worth the hole. */
	ok( ! IE_Image::usable( 'https://example.com/logo.svg' ), 'SVG was accepted' );
} );

test( 'nor is anything that is not http', function () {
	foreach ( array(
		'',
		'   ',
		'ftp://example.com/a.jpg',
		'file:///etc/passwd',
		'data:image/png;base64,AAAA',
		'javascript:alert(1)',
		'//example.com/a.jpg',
	) as $url ) {
		ok( ! IE_Image::usable( $url ), "accepted " . var_export( $url, true ) );
	}
} );

section( 'One download per URL' );

test( 'a remembered attachment is handed back', function () {
	reset_state();
	$GLOBALS['ie_post_type'][ 77 ] = 'attachment';
	IE_Image::remember( PIC, 77 );

	same( 77, IE_Image::remembered( PIC ) );
} );

test( 'the address is matched case- and space-insensitively', function () {
	reset_state();
	$GLOBALS['ie_post_type'][ 77 ] = 'attachment';
	IE_Image::remember( PIC, 77 );

	same( 77, IE_Image::remembered( '  ' . strtoupper( PIC ) . ' ' ) );
} );

test( 'a different picture is a different attachment', function () {
	reset_state();
	$GLOBALS['ie_post_type'][ 77 ] = 'attachment';
	IE_Image::remember( PIC, 77 );

	same( 0, IE_Image::remembered( 'https://cdn.example.com/other.jpg' ) );
} );

test( 'A DELETED ATTACHMENT IS NOT HANDED BACK', function () {
	/* THE CASE THIS CACHE EXISTS TO SURVIVE. A customer tidies their media
	 * library; the option still points at the id. Setting a missing id as a
	 * featured image gives every post in the campaign a broken thumbnail, and
	 * nothing errors — so nothing would ever say so. */
	reset_state();
	$GLOBALS['ie_post_type'][ 77 ] = 'attachment';
	IE_Image::remember( PIC, 77 );

	unset( $GLOBALS['ie_post_type'][ 77 ] );   // somebody emptied the trash

	same( 0, IE_Image::remembered( PIC ), 'a dead attachment id was handed out' );
} );

test( 'AND IT IS FORGOTTEN, so the next post gets a fresh copy', function () {
	/* Returning 0 without clearing the entry would make every later post
	 * re-check, fail, and go without a picture for ever — the cache would
	 * have poisoned itself permanently over one deletion. */
	reset_state();
	$GLOBALS['ie_post_type'][ 77 ] = 'attachment';
	IE_Image::remember( PIC, 77 );
	unset( $GLOBALS['ie_post_type'][ 77 ] );

	IE_Image::remembered( PIC );

	$cache = IE_Image::cache();
	ok( ! array_key_exists( IE_Image::cache_key( PIC ), $cache ),
		'the dead id is still in the cache and will be re-checked for ever' );
} );

section( 'The alt text each post carries' );

test( 'is stored against the post', function () {
	reset_state();
	IE_Image::remember_alt( 12, 'Roof flashing failures' );

	same( 'Roof flashing failures', IE_Image::alt_of( 12 ) );
} );

test( 'and an empty one is removed rather than stored blank', function () {
	reset_state();
	IE_Image::remember_alt( 12, 'something' );
	IE_Image::remember_alt( 12, '   ' );

	same( '', IE_Image::alt_of( 12 ) );
	ok( ! isset( $GLOBALS['ie_post_meta'][12][ IE_Image::ALT_META ] ), 'an empty alt is taking up a meta row' );
} );

section( 'The filter that makes a shared picture describe itself per post' );

/** A post with our image as its thumbnail, and its own alt text. */
function post_with_image( $post_id, $attachment_id, $alt ) {
	$GLOBALS['ie_post_type'][ $attachment_id ]                      = 'attachment';
	$GLOBALS['ie_post_meta'][ $attachment_id ][ IE_Image::OURS_META ] = 1;
	$GLOBALS['ie_thumbs'][ $post_id ]                               = $attachment_id;
	$GLOBALS['ie_current']                                          = $post_id;
	IE_Image::remember_alt( $post_id, $alt );
}

test( "THE POST'S OWN WORDS WIN OVER THE LIBRARY'S", function () {
	reset_state();
	post_with_image( 12, 77, 'Roof flashing failures' );

	$attr = IE_Image::filter_alt( array( 'alt' => 'shared description' ), (object) array( 'ID' => 77 ) );

	same( 'Roof flashing failures', $attr['alt'] );
} );

test( 'and two posts sharing one picture describe it differently', function () {
	/* The entire reason this filter exists. Without it, twenty-two articles
	 * on twenty-two subjects all say the same thing about their picture. */
	reset_state();

	post_with_image( 12, 77, 'Roof flashing failures' );
	$first = IE_Image::filter_alt( array( 'alt' => 'shared' ), (object) array( 'ID' => 77 ) );

	post_with_image( 13, 77, 'Gutter guards compared' );
	$second = IE_Image::filter_alt( array( 'alt' => 'shared' ), (object) array( 'ID' => 77 ) );

	same( 'Roof flashing failures', $first['alt'] );
	same( 'Gutter guards compared', $second['alt'] );
} );

test( "SOMEBODY ELSE'S IMAGES ARE LEFT ALONE", function () {
	/* The customer's logo, their own featured images, every picture in every
	 * post this plugin did not write. Rewriting their alt text would be wrong
	 * and almost impossible to diagnose from outside. */
	reset_state();
	post_with_image( 12, 77, 'Roof flashing failures' );

	$theirs = (object) array( 'ID' => 99 );   // no OURS_META
	$GLOBALS['ie_post_type'][99] = 'attachment';

	$attr = IE_Image::filter_alt( array( 'alt' => 'their own words' ), $theirs );

	same( 'their own words', $attr['alt'] );
} );

test( 'EVEN WHEN THEIR PICTURE IS THE FEATURED IMAGE OF OUR POST', function () {
	/* FOUND BY MUTATION. Deleting the ownership check survived the whole
	 * suite, because the only fixture using somebody else's attachment had it
	 * sitting somewhere that was not the thumbnail — so the thumbnail check
	 * caught it and the ownership check was never the thing being tested.
	 *
	 * The real case is ordinary: the customer opens one of our articles and
	 * swaps the featured image for a photograph of their own. Our alt meta is
	 * still on that post. Without the ownership check we would describe THEIR
	 * photograph with OUR topic — confidently, invisibly, and to a screen
	 * reader as though it were true. */
	reset_state();
	post_with_image( 12, 77, 'Roof flashing failures' );

	$GLOBALS['ie_post_type'][88]  = 'attachment';   // theirs: no OURS_META
	$GLOBALS['ie_thumbs'][12]     = 88;             // and they made it the featured image

	$attr = IE_Image::filter_alt( array( 'alt' => 'a photo of our van' ), (object) array( 'ID' => 88 ) );

	same( 'a photo of our van', $attr['alt'],
		"we relabelled the customer's own photograph with our article's topic" );
} );

test( 'and so is our picture used somewhere it is not the featured image', function () {
	/* The same file dropped inline into a post body. It is ours, but it is
	 * not what the title sits above, and relabelling it would describe the
	 * article rather than the picture's role on the page. */
	reset_state();
	post_with_image( 12, 77, 'Roof flashing failures' );

	$GLOBALS['ie_thumbs'][12] = 5;   // something else is the featured image

	$attr = IE_Image::filter_alt( array( 'alt' => 'shared' ), (object) array( 'ID' => 77 ) );

	same( 'shared', $attr['alt'] );
} );

test( 'outside the loop the shared description stands', function () {
	/* A widget, a REST response, a sitemap image. There is no post in scope
	 * to take a description from, and inventing one would be worse. */
	reset_state();
	post_with_image( 12, 77, 'Roof flashing failures' );
	$GLOBALS['ie_current'] = 0;

	$attr = IE_Image::filter_alt( array( 'alt' => 'shared' ), (object) array( 'ID' => 77 ) );

	same( 'shared', $attr['alt'] );
} );

test( 'a post with no alt of its own keeps the shared one', function () {
	reset_state();
	post_with_image( 12, 77, '' );

	$attr = IE_Image::filter_alt( array( 'alt' => 'shared' ), (object) array( 'ID' => 77 ) );

	same( 'shared', $attr['alt'], 'an empty per-post alt wiped a perfectly good shared one' );
} );

test( 'and junk arguments do not throw', function () {
	/* This runs inside every image WordPress draws, on every page of the
	 * site. A fatal here is the customer's whole site, not one picture. */
	reset_state();

	same( array(), IE_Image::filter_alt( array(), null ) );
	same( 'x', IE_Image::filter_alt( 'x', (object) array( 'ID' => 77 ) ) );
	same( array( 'alt' => 'a' ), IE_Image::filter_alt( array( 'alt' => 'a' ), (object) array() ) );
} );

section( 'Getting the picture into the library' );

test( 'a picture is downloaded once and remembered', function () {
	reset_state();

	same( 4242, IE_Image::fetch( PIC ) );
	same( 4242, IE_Image::cache()[ IE_Image::cache_key( PIC ) ] );
} );

test( 'AND THE SECOND ARTICLE DOWNLOADS NOTHING', function () {
	/* The whole reason the cache exists. Twenty-two articles must not put
	 * twenty-two copies of one picture in a customer's media library, nor
	 * pull the same bytes twenty-two times through a shared host. */
	reset_state();
	IE_Image::fetch( PIC );
	$GLOBALS['ie_post_type'][4242] = 'attachment';

	$GLOBALS['ie_download'] = new WP_Error( 'no', 'this must not be reached' );

	same( 4242, IE_Image::fetch( PIC ), 'the second article downloaded the picture again' );
} );

test( 'it is marked as ours, so the alt filter may touch it', function () {
	reset_state();
	$id = IE_Image::fetch( PIC );

	ok( ! empty( $GLOBALS['ie_post_meta'][ $id ][ IE_Image::OURS_META ] ),
		'the attachment is not marked, so its alt text will never be swapped' );
} );

test( 'A REJECTED ADDRESS IS NEVER FETCHED AT ALL', function () {
	/* FOUND BY MUTATION. Deleting the usable() guard from fetch() survived,
	 * because the fixture made the download fail anyway — so "refused before
	 * trying" and "tried and failed" looked identical, and only one of them
	 * is the behaviour that matters. A PDF or an SVG must never be requested,
	 * not merely discarded after arriving. */
	reset_state();

	same( 0, IE_Image::fetch( 'https://example.com/brochure.pdf' ) );
	same( 0, IE_Image::fetch( 'https://example.com/logo.svg' ) );
	same( 0, IE_Image::fetch( 'file:///etc/passwd' ) );
	same( 0, IE_Image::fetch( '' ) );

	same( array(), $GLOBALS['ie_fetched'],
		'something that is not a picture was requested over the network' );
} );

section( 'When the picture does not arrive' );

test( 'A FAILED DOWNLOAD IS NOT A FAILED POST', function () {
	/* The article is written and charged for before any of this runs. A 404,
	 * a timeout, a host that refuses us — none is a reason to withhold work
	 * somebody paid for. */
	reset_state();
	$GLOBALS['ie_download'] = new WP_Error( 'http_404', 'Not Found' );

	same( 0, IE_Image::fetch( PIC ), 'a failed download did not return 0' );
} );

test( 'and the reason is written down', function () {
	reset_state();
	$GLOBALS['ie_download'] = new WP_Error( 'http_404', 'Not Found' );
	IE_Image::fetch( PIC );

	ok( ! empty( $GLOBALS['ie_log'] ), 'nothing was logged, so nobody can find out why' );
	ok( false !== strpos( $GLOBALS['ie_log'][0], 'Not Found' ), 'the log does not say what went wrong' );
} );

test( 'a failure is NOT remembered as a picture', function () {
	/* Caching a 0 would mean one bad minute on a CDN leaves the campaign
	 * without pictures for ever, with nothing to retry. */
	reset_state();
	$GLOBALS['ie_download'] = new WP_Error( 'http_404', 'Not Found' );
	IE_Image::fetch( PIC );

	same( array(), IE_Image::cache(), 'a failure was cached' );
} );

test( 'A REFUSED SIDELOAD CLEANS UP ITS TEMP FILE', function () {
	/* download_url() creates the file; media_handle_sideload only removes it
	 * when it succeeds. Leaving it behind fills /tmp over a month of a
	 * campaign failing nightly — on shared hosting, that is the whole
	 * account's disk quota. */
	reset_state();
	$GLOBALS['ie_sideload'] = new WP_Error( 'bad_type', 'Sorry, you are not allowed to upload this file type.' );

	same( 0, IE_Image::fetch( PIC ) );
	ok( in_array( '/tmp/ie-fixture.jpg', $GLOBALS['ie_deleted'], true ),
		'the temporary file was left on disk' );
} );

section( 'Giving a post its picture' );

test( 'the featured image and the alt text are both set', function () {
	reset_state();

	$id = IE_Image::apply_to( 12, array( 'image_url' => PIC ), array(
		'topic'        => 'Seven Signs Your Roof Is About To Fail',
		'target_query' => 'roof replacement signs',
	) );

	same( 4242, $id );
	same( 4242, $GLOBALS['ie_thumb_set'][12] );
	same( 'roof replacement signs', IE_Image::alt_of( 12 ) );
} );

test( 'a campaign with no picture does nothing at all', function () {
	reset_state();

	same( 0, IE_Image::apply_to( 12, array(), array( 'topic' => 'x' ) ) );
	same( array(), $GLOBALS['ie_thumb_set'], 'a thumbnail was set for a campaign with no image' );
} );

test( 'AND A FAILED DOWNLOAD LEAVES THE POST ALONE', function () {
	/* No thumbnail, and no alt text either — alt text describing a picture
	 * that is not there would be read out to somebody using a screen reader
	 * as though it were. */
	reset_state();
	$GLOBALS['ie_download'] = new WP_Error( 'http_404', 'Not Found' );

	same( 0, IE_Image::apply_to( 12, array( 'image_url' => PIC ), array( 'target_query' => 'roof' ) ) );
	same( array(), $GLOBALS['ie_thumb_set'] );
	same( '', IE_Image::alt_of( 12 ), 'alt text was stored for a picture that never arrived' );
} );

echo "\n$passed passed, $failed failed\n";
exit( $failed ? 1 : 0 );
