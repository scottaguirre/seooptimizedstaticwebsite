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
	 * fastwebsitegenerator.com was the service's first name. It was switched
	 * OFF on 24 September — nginx site deleted, A and CNAME records removed,
	 * certificate revoked. It resolves nowhere.
	 *
	 * The default below was never updated with the rename, so every install
	 * that had not set the field by hand was pointing at a domain that had
	 * stopped existing. Nothing says so on screen: requests fail, the plugin
	 * logs it, and the owner sees a site that simply never publishes.
	 *
	 * A MAP RATHER THAN ONE COMPARISON, because this will happen again. The
	 * next rename adds a line here and both halves below keep working.
	 */
	private static function moved_hosts() {
		return array(
			'fastwebsitegenerator.com'     => self::SERVER,
			'www.fastwebsitegenerator.com' => self::SERVER,
		);
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
}
