<?php
/**
 * What this site knows about its account.
 *
 * WHAT IS STORED, AND WHAT DELIBERATELY IS NOT
 *
 *   site_id   not secret. It only says who is calling, and it travels in a
 *             header on every request.
 *   secret    the signing key, issued by the server at activation. Never
 *             transmitted after that, in either direction — both sides prove
 *             they hold it by signing, which is the point of the scheme.
 *
 * The LICENCE KEY is not kept. It is typed once, exchanged for the two values
 * above, and dropped. The server stores only its hash, so a key held here in
 * plaintext would be the single most recoverable copy of it anywhere — for no
 * benefit, since nothing after activation uses it.
 *
 * Re-connecting means pasting it again. That is the correct trade: a key is a
 * row in a table and can be reissued, and losing it costs a click.
 *
 * @package interlink-engine
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class IE_Settings {

	const OPTION = 'ie_settings';

	/**
	 * Post meta marking a post as a PILLAR — a hub article a later campaign
	 * can point at.
	 *
	 * ONE CONSTANT, BECAUSE THREE FILES NEED THE SAME STRING. The publisher
	 * writes it, target_pages() below queries it, and the admin screen reads
	 * it to label a dropdown row. A key spelled out in three places is a key
	 * that gets renamed in two of them — and the failure is silent: the post
	 * is stamped, the query finds nothing, and the dropdown is simply missing
	 * a row with no error anywhere to say why.
	 *
	 * Underscore-prefixed, so it stays out of WordPress's Custom Fields box.
	 * The owner has no decision to make here; the campaign already made it.
	 */
	const PILLAR_META = '_ie_is_pillar';

	/**
	 * THE SEARCH PHRASE THIS PILLAR WAS BUILT TO WIN.
	 *
	 * The owner already typed it, in "Main keyword of this post", when they planned
	 * the pillar campaign — and the form REFUSES to plan one without it. It is
	 * stored on the campaign slot, used to write the post, and until now was
	 * dropped on the floor the moment the post published.
	 *
	 * So when a later campaign aimed at that pillar needed its keyword, nothing
	 * could answer. read_keyword() fell back to deriving one from the post
	 * TITLE, and a pillar's title is a headline: "Can You Apply for a Loan in
	 * the US Without Being a Citizen?" became a thirteen-word keyword with the
	 * question mark still attached, and the anchors built from it read
	 * "understanding can you apply for a loan in the us without being a
	 * citizen?".
	 *
	 * The answer existed. It had no way to travel from the campaign that knew
	 * it to the campaign that needed it. This key is that way.
	 *
	 * ONE QUESTION, ASKED ONCE. Being asked for the same fact twice is bad; the
	 * second asking arriving with a wrong default already filled in is worse
	 * than not asking at all, because agreeing with it takes no action.
	 *
	 * Underscore-prefixed for the same reason as PILLAR_META, and declared here
	 * for the same reason: the publisher writes it and the admin screen reads
	 * it, and a key spelled out in two files gets renamed in one of them.
	 */
	const KEYWORD_META = '_ie_target_query';

	private static function all() {
		$s = get_option( self::OPTION, array() );
		return is_array( $s ) ? $s : array();
	}

	public static function get( $key, $default = '' ) {
		$s = self::all();
		return isset( $s[ $key ] ) && '' !== $s[ $key ] ? $s[ $key ] : $default;
	}

	public static function set( $values ) {
		update_option( self::OPTION, array_merge( self::all(), (array) $values ) );
	}

	/** Identifies this site to the server. Not a secret. */
	public static function site_id() {
		return (string) self::get( 'site_id' );
	}

	/** Signs outbound requests and verifies inbound pings. */
	public static function secret() {
		return (string) self::get( 'secret' );
	}

	/**
	 * Where the API lives.
	 *
	 * The default is the real service, so a customer installing this never has
	 * to know the address exists. It stays overridable — the Connection screen
	 * writes to the same key — because a staging server is the only way to
	 * exercise a plugin change without spending a real customer's credits.
	 *
	 * Stored WITHOUT a trailing slash, and untrailingslashit here as well as on
	 * save: every caller appends '/api/blog/...', and a double slash in the
	 * path is a different string from the one the signature covers. That
	 * failure looks like a rejected signature, not like a typo in a URL.
	 */
	const SERVER = 'https://threecomets.com';

	/**
	 * Hosts that no longer answer, and where they went.
	 *
	 * EMPTY ON PURPOSE, AND KEPT ANYWAY.
	 *
	 * It held fastwebsitegenerator.com — the service's first name, switched
	 * off on 24 September and resolving nowhere since. Every install had
	 * migrated, so the entries went on 8 October: a retired name still
	 * surfaces the one time it is not wanted.
	 *
	 * The MECHANISM stays, because the failure it was written for is the
	 * quiet kind. The default was not updated at the rename, so every install
	 * that had never typed an address by hand pointed at a host that had
	 * stopped existing. Nothing said so on screen — requests failed, the
	 * plugin logged it, and the owner saw a blog that simply never published.
	 * The next rename adds one line here and both halves below keep working.
	 *
	 * Filterable so that the translation and the migration stay under test
	 * with the map empty. That is what test-server-url.php uses it for; it is
	 * not an extension point for anybody else.
	 */
	private static function moved_hosts() {
		$moved = array();

		return function_exists( 'apply_filters' )
			? (array) apply_filters( 'ie_moved_hosts', $moved )
			: $moved;
	}

	/** The live address for a URL, which is the URL itself unless it moved. */
	private static function current_server( $url ) {
		$host = strtolower( (string) wp_parse_url( $url, PHP_URL_HOST ) );
		$moved = self::moved_hosts();

		return isset( $moved[ $host ] ) ? $moved[ $host ] : $url;
	}

	public static function server_url() {
		$url = untrailingslashit( self::get( 'server_url', self::SERVER ) );

		/* TRANSLATED ON READ as well as migrated on upgrade, and the belt and
		 * braces are deliberate. The migration needs an admin request to have
		 * fired; this covers the window before that, and covers a site whose
		 * migration failed for any reason. The failure it guards against is
		 * total and silent, which is worth two lines. */
		return self::current_server( $url );
	}

	/**
	 * Rewrite a stored server_url that points at a host which has moved.
	 *
	 * SEPARATE FROM server_url() BECAUSE IT PERSISTS. Reading can translate
	 * for the current request; only this makes the Connection screen stop
	 * showing the dead address, which is the thing the owner would otherwise
	 * copy into a support email.
	 *
	 * Returns true when something was written, so a caller can log it.
	 */
	public static function migrate_server_url() {
		$stored = untrailingslashit( (string) self::get( 'server_url', '' ) );

		// Nothing stored means the default applies, and the default is right.
		if ( '' === $stored ) {
			return false;
		}

		$fixed = self::current_server( $stored );

		if ( $fixed === $stored ) {
			return false;
		}

		self::set( array( 'server_url' => $fixed ) );
		return true;
	}

	/**
	 * Connected means we can SIGN. A licence key alone is not a connection —
	 * it is a thing you type on the way to one.
	 */
	public static function is_connected() {
		return '' !== self::site_id() && '' !== self::secret();
	}

	public static function credits() {
		$value = self::get( 'credits', null );
		return ( null === $value || '' === $value ) ? null : (int) $value;
	}

	public static function credits_per_post() {
		$value = self::get( 'credits_per_post', null );
		return ( null === $value || '' === $value ) ? null : (int) $value;
	}

	/**
	 * The active theme's PHP function prefix, e.g. 'local_business_theme'.
	 *
	 * Sent at activation. The server needs it because the generated themes
	 * read their meta description from '<prefix>_page_description' — a post
	 * whose description is written under any other key is a post that ships
	 * without one.
	 */
	public static function active_theme_prefix() {
		return preg_replace( '/[^a-z0-9_]/', '_', strtolower( get_template() ) );
	}

	/**
	 * Which pages a campaign can point at.
	 *
	 * Reads the generated theme's own page types where present, so a site
	 * built by the generator arrives already knowing which pages sell
	 * something. On any other WordPress it falls back to every published page
	 * and the owner picks.
	 *
	 * PILLAR POSTS ARE IN HERE TOO, and that is the whole reason this function
	 * was touched. A pillar campaign writes hub articles as ordinary POSTS —
	 * a pillar is content, not a template, and 'post_type' => 'post' is
	 * hardcoded in four places in the publisher. This query asked for
	 * post_type 'page' only, so a pillar could be published, ringed and live
	 * and still be unselectable: campaign 2 would have had nothing to point
	 * at, which is the entire point of having written the pillar.
	 *
	 * PUBLISHED ONLY, for pillars more than for pages. A pillar campaign
	 * schedules its posts weeks out, and a `future` post has a permalink that
	 * returns 404 to the public. Offering one would let the owner aim ten
	 * articles at a URL that does not answer yet, and nothing downstream
	 * re-checks it — the links are written once.
	 *
	 * Returns [ id => array( 'title', 'url', 'keyword', 'type', 'is_pillar' ) ].
	 */
	public static function target_pages() {
		$out = array();

		$pages = get_posts( array(
			'post_type'      => 'page',
			'post_status'    => 'publish',
			'posts_per_page' => 200,
			'orderby'        => 'menu_order title',
			'order'          => 'ASC',
		) );

		foreach ( $pages as $page ) {
			$type = '';
			foreach ( array( '_page_type', 'page_type' ) as $suffix ) {
				foreach ( self::theme_prefixes() as $prefix ) {
					$value = get_post_meta( $page->ID, $prefix . $suffix, true );
					if ( $value ) {
						$type = $value;
						break 2;
					}
				}
			}

			$out[ $page->ID ] = array(
				'title'     => get_the_title( $page ),
				'url'       => get_permalink( $page ),
				// A first guess the owner can correct. On a generated service
				// page the title IS the keyword nearly every time.
				'keyword'   => strtolower( get_the_title( $page ) ),
				'type'      => $type,
				'is_pillar' => false,
			);
		}

		$pillars = get_posts( array(
			'post_type'      => 'post',
			'post_status'    => 'publish',
			'posts_per_page' => 200,
			'meta_key'       => self::PILLAR_META,   // phpcs:ignore WordPress.DB.SlowDBQuery
			'meta_value'     => '1',                 // phpcs:ignore WordPress.DB.SlowDBQuery
			'orderby'        => 'date',
			'order'          => 'ASC',
		) );

		foreach ( $pillars as $pillar ) {
			/* A FLAG, NOT A DECORATED TITLE.
			 *
			 * The obvious shortcut is 'title' => get_the_title() . ' (pillar)'
			 * so the dropdown reads well — and that title does not stay in the
			 * dropdown. read_form() stores it, it becomes the campaign's
			 * label, and it is sent to the server as targetPage.title, which
			 * writePost drops into the sentence "It becomes a link to the X
			 * page". Every post in the silo would then refer to "the Leash
			 * Pulling and Walking Problems (pillar) page".
			 *
			 * So the marker belongs where it is displayed, not where it is
			 * stored. The admin screen adds it when drawing the option. */
			$out[ $pillar->ID ] = array(
				'title'     => get_the_title( $pillar ),
				'url'       => get_permalink( $pillar ),
				'keyword'   => strtolower( get_the_title( $pillar ) ),
				// Not a theme page type — a pillar is a post and has none.
				'type'      => '',
				'is_pillar' => true,
			);
		}

		return $out;
	}

	/**
	 * Meta prefixes the generated themes use.
	 *
	 * Derived from the theme slug at export time, so it differs per site.
	 * Rather than guessing, look at what is actually installed — and keep the
	 * historic default as a fallback for sites exported before the slug was
	 * configurable.
	 */
	private static function theme_prefixes() {
		return array_unique( array(
			self::active_theme_prefix() . '_',
			'local_business_theme_',
		) );
	}

	/**
	 * Business details for the writer.
	 *
	 * Taken from the generated theme's settings where available. Retyping the
	 * business name into a second form is exactly the friction that makes
	 * people abandon setup halfway.
	 */
	public static function business() {
		$stored = self::get( 'business', array() );
		if ( is_array( $stored ) && ! empty( $stored['name'] ) ) {
			return wp_parse_args( $stored, array( 'name' => '', 'trade' => '', 'town' => '', 'phone' => '' ) );
		}

		$global = array();
		foreach ( self::theme_prefixes() as $prefix ) {
			$candidate = get_option( $prefix . 'global_settings', array() );
			if ( is_array( $candidate ) && ! empty( $candidate ) ) {
				$global = $candidate;
				break;
			}
		}

		return array(
			'name'  => isset( $global['business_name'] ) ? $global['business_name'] : get_bloginfo( 'name' ),
			'trade' => isset( $global['business_type'] ) ? $global['business_type'] : '',
			'town'  => isset( $global['location'] ) ? $global['location'] : '',
			'phone' => isset( $global['phone'] ) ? $global['phone'] : '',
		);
	}

	/**
	 * The same details under the names the SERVER uses.
	 *
	 * TWO VOCABULARIES FOR ONE THING, and that is the whole reason this
	 * function exists. business() answers in WordPress's words — trade, town —
	 * because that is what the generated themes call them. The server's
	 * readBusiness() (utils/blog/businessShape.js) keeps a LIMITS map of the
	 * only four fields it will store:
	 *
	 *     name · type · location · phone
	 *
	 * and it does not rename anything on arrival. A key it does not recognise
	 * is not an error and is not logged — it is simply dropped.
	 *
	 * THE BUG THIS REPLACES. The translation above was written once, inline,
	 * in activate(). plan() and the hourly sweep sent business() raw, so
	 * `trade` and `town` were discarded by every call except activation. The
	 * server's `location` could therefore never change after the licence was
	 * first pasted in — which is precisely the failure the comment above
	 * plan() describes itself as fixing. It fixed `name`. The other three kept
	 * the original bug for months, invisibly, because a dropped key looks
	 * exactly like a site that has not changed its address.
	 *
	 * Found on hilltophomeloans.net: a deleted theme's leftover
	 * `local_business_theme_global_settings` row still said "Junk Removal
	 * Leander" in "Leander, TX", and a campaign for "small business loans for
	 * women" shipped with the anchors "Junk Removal Leander" and "Leander
	 * small business loans for women".
	 *
	 * SO THERE IS NOW ONE TRANSLATION AND EVERY CALLER USES IT. An inline
	 * mapping at a call site is a copy, and the reason three call sites
	 * disagreed is that two of them never had one.
	 *
	 * @return array{name:string,type:string,location:string,phone:string}
	 */
	public static function business_payload() {
		$business = self::business();

		return array(
			'name'     => isset( $business['name'] ) ? (string) $business['name'] : '',
			'type'     => isset( $business['trade'] ) ? (string) $business['trade'] : '',
			'location' => isset( $business['town'] ) ? (string) $business['town'] : '',
			'phone'    => isset( $business['phone'] ) ? (string) $business['phone'] : '',
		);
	}
}
