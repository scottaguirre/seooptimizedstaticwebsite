<?php
/**
 * One picture, above the title of every article in a campaign.
 *
 * WHY THIS IS NOT THE VIDEO FEATURE WITH A DIFFERENT TAG
 *
 * The video is a `[embed]` shortcode dropped into post_content. Edwin asked
 * for the image to sit "above the title of the article", and nothing written
 * into post_content can do that: WordPress renders the content BELOW the
 * title in every theme there is. The only thing that appears above it is the
 * FEATURED IMAGE, and even that is the theme's decision.
 *
 * A featured image is an attachment id in post meta, not a URL. So a remote
 * address has to be downloaded into the media library before it can be used
 * at all — which is the whole of the difference in difficulty between this
 * and the video.
 *
 * ---------------------------------------------------------------------------
 * ONE DOWNLOAD PER URL, NOT ONE PER POST
 *
 * A twenty-two post campaign with one image would otherwise put twenty-two
 * identical files in the customer's media library and pull the same bytes
 * twenty-two times over a shared host's connection. The attachment id is
 * remembered against a hash of the URL, so the second post through costs
 * nothing.
 *
 * THE PRICE OF THAT IS THE ALT TEXT, and it is worth stating plainly because
 * it is not obvious. Alt text belongs to the LIBRARY ITEM in WordPress, not
 * to the post using it. One shared attachment therefore has one alt text, and
 * twenty-two posts about twenty-two different subjects would all describe
 * their picture the same way — which is the opposite of what alt text is for,
 * on a product sold for search visibility.
 *
 * So each post also stores its OWN alt text in its own meta, and a filter
 * swaps it in when that post's featured image is drawn. Edwin chose this
 * knowing the trade: it is exactly right while the plugin is installed, and
 * if the plugin is ever removed the images stay, the posts stay, and the alt
 * text quietly falls back to the shared one. Nothing breaks; it gets less
 * good. That is the correct direction for a graceful failure.
 *
 * ---------------------------------------------------------------------------
 * A FAILED DOWNLOAD IS NOT A FAILED POST
 *
 * The post has been written and charged for. A 404, a timeout, a host that
 * refuses us, a file too big, a GIF where a JPEG was promised — none of those
 * are reasons to withhold an article somebody paid for. The post goes up
 * without a picture and the reason is recorded, which is the same bargain the
 * video makes and the same one the rest of this plugin makes.
 *
 * @package interlink-engine
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class IE_Image {

	/** url hash => attachment id, for every image this plugin has pulled in. */
	const CACHE_OPTION = 'ie_image_attachments';

	/** Per-post alt text, so a shared picture can still be described per post. */
	const ALT_META = '_ie_image_alt';

	/** Marks an attachment as ours, so the filter does not touch other images. */
	const OURS_META = '_ie_campaign_image';

	/**
	 * What this plugin will accept as a picture.
	 *
	 * NOT just "whatever the URL ends in". The extension is a claim made by
	 * whoever typed the address; WordPress checks the real type on sideload
	 * and this list is what it is checked against. SVG is absent on purpose —
	 * it is a script-bearing format, WordPress refuses it by default, and a
	 * featured image is not worth the hole.
	 */
	const TYPES = array( 'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif' );

	/**
	 * Which image this article gets.
	 *
	 * The slot's own, when it has one; otherwise the campaign's. An empty slot
	 * value means "nothing was chosen here", not "no image wanted" — the same
	 * rule video_for() follows, for the same reason: there is no way in the UI
	 * to say the second thing.
	 *
	 * @return string possibly empty
	 */
	public static function image_for( $campaign, $slot ) {
		if ( is_array( $slot ) && ! empty( $slot['image_url'] ) ) {
			return (string) $slot['image_url'];
		}

		return ( is_array( $campaign ) && isset( $campaign['image_url'] ) )
			? (string) $campaign['image_url']
			: '';
	}

	/**
	 * What this post's picture should say it shows.
	 *
	 * THE ARTICLE'S MAIN KEYWORD, which is the column the owner fills in by
	 * hand for every row. Not a field typed once for the whole campaign: a
	 * line typed once is accurate about the picture and says nothing about
	 * the article, and twenty-two posts sharing one sentence is the thing alt
	 * text exists to prevent.
	 *
	 * NOT THE TOPIC, which is the headline. A headline is written to be
	 * clicked — "Cloudy Glasses and White Faucet Scale Usually Mean Hard
	 * Water" — and alt text written like a headline describes the article
	 * rather than the picture. The main keyword is the plain phrase the post
	 * is about, which is closer to what somebody would say if asked what the
	 * picture on this page is for.
	 *
	 * THE TOPIC IS STILL THE FALLBACK, because the keyword column may be
	 * empty. A post that has one is described by it; a post that has none is
	 * described by its headline, which is imperfect and far better than
	 * silence on a page whose picture is the first thing above the title.
	 *
	 * @return string possibly empty, which is better than wrong
	 */
	public static function alt_for( $slot ) {
		if ( ! is_array( $slot ) ) {
			return '';
		}

		$keyword = isset( $slot['target_query'] ) ? $slot['target_query'] : '';
		$keyword = trim( wp_strip_all_tags( (string) $keyword ) );

		if ( '' !== $keyword ) {
			return $keyword;
		}

		$topic = isset( $slot['topic'] ) ? $slot['topic'] : '';

		return trim( wp_strip_all_tags( (string) $topic ) );
	}

	/**
	 * Is this address worth trying at all?
	 *
	 * Cheap checks only, before anything is downloaded. The real test is what
	 * comes back, and WordPress performs that itself on sideload.
	 *
	 * HTTPS OR HTTP, AND NOTHING ELSE. data: URIs are not addresses; file:
	 * and php: have no business here at all.
	 */
	public static function usable( $url ) {
		$url = trim( (string) $url );

		if ( '' === $url ) {
			return false;
		}

		if ( ! preg_match( '#^https?://#i', $url ) ) {
			return false;
		}

		/* The extension is a hint, not proof — see TYPES. A query string is
		 * stripped first, because a perfectly good image URL may carry a CDN
		 * token after the '?'. */
		$path = (string) wp_parse_url( $url, PHP_URL_PATH );
		$ext  = strtolower( (string) pathinfo( $path, PATHINFO_EXTENSION ) );

		/* NO EXTENSION IS ALLOWED THROUGH. Plenty of real image URLs have
		 * none — a CDN route, a signed endpoint, a WordPress attachment page.
		 * Rejecting them here would refuse good addresses on a guess, and the
		 * sideload still checks the actual bytes. What this rejects is an
		 * extension that is PRESENT and wrong, which is a typo or a PDF. */
		return '' === $ext || in_array( $ext, self::TYPES, true );
	}

	/** The key an attachment is remembered under. */
	public static function cache_key( $url ) {
		return md5( strtolower( trim( (string) $url ) ) );
	}

	/** Every attachment this plugin has pulled in, as hash => id. */
	public static function cache() {
		$cache = get_option( self::CACHE_OPTION, array() );

		return is_array( $cache ) ? $cache : array();
	}

	/**
	 * The attachment id for this URL, if we already have one AND it is still
	 * there.
	 *
	 * THE SECOND HALF IS THE POINT. A customer who tidies their media library
	 * leaves this option pointing at an id that no longer exists, and setting
	 * a missing id as a featured image gives every post in the campaign a
	 * broken thumbnail — silently, because nothing errors.
	 *
	 * @return int 0 when there is nothing usable
	 */
	public static function remembered( $url ) {
		$cache = self::cache();
		$key   = self::cache_key( $url );

		if ( empty( $cache[ $key ] ) ) {
			return 0;
		}

		$id = (int) $cache[ $key ];

		if ( $id > 0 && 'attachment' === get_post_type( $id ) ) {
			return $id;
		}

		// Gone. Forget it, so the next post downloads a fresh copy rather
		// than inheriting the same broken id.
		self::forget( $url );

		return 0;
	}

	/** Remember an attachment against its source address. */
	public static function remember( $url, $attachment_id ) {
		$cache = self::cache();

		$cache[ self::cache_key( $url ) ] = (int) $attachment_id;

		update_option( self::CACHE_OPTION, $cache, false );

		return (int) $attachment_id;
	}

	/** Drop an address from the cache. */
	public static function forget( $url ) {
		$cache = self::cache();
		$key   = self::cache_key( $url );

		if ( array_key_exists( $key, $cache ) ) {
			unset( $cache[ $key ] );
			update_option( self::CACHE_OPTION, $cache, false );
		}

		return true;
	}

	/**
	 * Record this post's own description of the picture.
	 *
	 * Stored whether or not the attachment is shared, because at the moment
	 * of writing we do not know whether the next post will use the same one —
	 * and a post that carries its alt text is a post that can be moved,
	 * exported, or re-themed without losing it.
	 */
	public static function remember_alt( $post_id, $alt ) {
		$alt = trim( wp_strip_all_tags( (string) $alt ) );

		if ( '' === $alt ) {
			delete_post_meta( $post_id, self::ALT_META );
			return '';
		}

		update_post_meta( $post_id, self::ALT_META, $alt );

		return $alt;
	}

	/** What this post says its featured image shows, if anything. */
	public static function alt_of( $post_id ) {
		$alt = get_post_meta( $post_id, self::ALT_META, true );

		return is_string( $alt ) ? $alt : '';
	}

	/**
	 * Swap in the post's own alt text when its featured image is drawn.
	 *
	 * HOW IT KNOWS WHICH POST. The filter is handed the attachment, not the
	 * post using it, so the post comes from the loop. That is correct inside
	 * an archive, a single post, and a related-posts block, because each
	 * iteration sets it — and when there is no post in scope there is nothing
	 * to override and the shared alt stands.
	 *
	 * ONLY OUR OWN ATTACHMENTS. A customer's own featured images, logos and
	 * inline pictures are none of this plugin's business, and rewriting their
	 * alt text would be both wrong and extremely hard to debug from the
	 * outside.
	 *
	 * @param array   $attr
	 * @param WP_Post $attachment
	 * @return array
	 */
	public static function filter_alt( $attr, $attachment ) {
		if ( ! is_array( $attr ) || ! $attachment || empty( $attachment->ID ) ) {
			return $attr;
		}

		if ( ! get_post_meta( $attachment->ID, self::OURS_META, true ) ) {
			return $attr;
		}

		$post_id = get_the_ID();

		if ( ! $post_id ) {
			return $attr;
		}

		// Only when this attachment really is THIS post's featured image.
		// Otherwise an inline copy of the same picture would be relabelled.
		if ( (int) get_post_thumbnail_id( $post_id ) !== (int) $attachment->ID ) {
			return $attr;
		}

		$alt = self::alt_of( $post_id );

		if ( '' !== $alt ) {
			$attr['alt'] = $alt;
		}

		return $attr;
	}

	/**
	 * Get this URL into the media library, once, and hand back its id.
	 *
	 * NOTHING HERE THROWS. It runs inside the loop that inserts a paid-for
	 * article. A 404, a timeout, a host that refuses us, a file too large, a
	 * disk with no room — every one of them must end with a post that has no
	 * picture, never with a post that was not written.
	 *
	 * THE FILES ARE LOADED BY HAND because this runs from a REST request and
	 * from WP-Cron, neither of which has wp-admin's includes. Calling
	 * media_sideload_image() without them is a fatal, and a fatal here takes
	 * the whole batch down.
	 *
	 * @return int attachment id, or 0
	 */
	public static function fetch( $url ) {
		$url = trim( (string) $url );

		if ( ! self::usable( $url ) ) {
			return 0;
		}

		$known = self::remembered( $url );

		if ( $known ) {
			return $known;
		}

		foreach ( array( 'file.php', 'media.php', 'image.php' ) as $file ) {
			$path = ABSPATH . 'wp-admin/includes/' . $file;

			if ( ! function_exists( 'media_handle_sideload' ) && file_exists( $path ) ) {
				require_once $path;
			}
		}

		if ( ! function_exists( 'media_handle_sideload' ) || ! function_exists( 'download_url' ) ) {
			self::note( $url, 'WordPress media functions are unavailable on this site' );
			return 0;
		}

		/* A SHORT TIMEOUT, because this is inside a batch. Fifteen seconds is
		 * generous for a picture and short enough that one unreachable CDN
		 * cannot stall twenty-two articles. */
		$tmp = download_url( $url, 15 );

		if ( is_wp_error( $tmp ) ) {
			self::note( $url, $tmp->get_error_message() );
			return 0;
		}

		/* THE NAME COMES FROM THE URL, and the extension from what actually
		 * arrived. An address ending .jpg that serves a PNG is ordinary on a
		 * CDN, and WordPress rejects the mismatch rather than the file. */
		$name = basename( (string) wp_parse_url( $url, PHP_URL_PATH ) );
		$name = sanitize_file_name( $name );

		if ( '' === $name || false === strpos( $name, '.' ) ) {
			$name = 'campaign-image';
		}

		$id = media_handle_sideload(
			array( 'name' => $name, 'tmp_name' => $tmp ),
			0
		);

		if ( is_wp_error( $id ) ) {
			// download_url() made the temp file; media_handle_sideload only
			// removes it on success. Leaving it behind fills /tmp over a
			// month of failing campaigns.
			if ( file_exists( $tmp ) ) {
				wp_delete_file( $tmp );
			}

			self::note( $url, $id->get_error_message() );
			return 0;
		}

		update_post_meta( $id, self::OURS_META, 1 );

		return self::remember( $url, (int) $id );
	}

	/**
	 * Why a picture did not arrive, in the plugin's own log.
	 *
	 * The owner is told on the campaign card that the post went up without
	 * one; this is the detail behind it, for the same reason the scheduler
	 * keeps a site's own words when a ping is refused.
	 */
	public static function note( $url, $reason ) {
		if ( class_exists( 'IE_Publisher' ) && method_exists( 'IE_Publisher', 'log' ) ) {
			IE_Publisher::log( sprintf(
				'image: %s could not be added — %s',
				$url,
				wp_strip_all_tags( (string) $reason )
			) );
		}

		return false;
	}

	/**
	 * Give this post its picture, if there is one to give.
	 *
	 * Called once per article, after the post exists. Returns the attachment
	 * id so the caller can say whether a picture arrived, and 0 when none
	 * did — which is not an error and must not be treated as one.
	 *
	 * @return int
	 */
	public static function apply_to( $post_id, $campaign, $slot ) {
		$url = self::image_for( $campaign, $slot );

		if ( '' === trim( (string) $url ) ) {
			return 0;
		}

		$id = self::fetch( $url );

		if ( ! $id ) {
			return 0;
		}

		set_post_thumbnail( $post_id, $id );

		/* STORED EVEN WHEN IT MATCHES THE LIBRARY'S. At the moment of writing
		 * we do not know whether the next article will share this attachment,
		 * and a post carrying its own description is one that survives being
		 * exported, moved or re-themed. */
		self::remember_alt( $post_id, self::alt_for( $slot ) );

		return $id;
	}

	/** Registered from the plugin's bootstrap. */
	public static function init() {
		add_filter( 'wp_get_attachment_image_attributes', array( __CLASS__, 'filter_alt' ), 10, 2 );
	}
}
