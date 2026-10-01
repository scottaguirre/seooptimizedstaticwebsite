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
	 * Returns [ id => array( 'title', 'url', 'keyword', 'type' ) ].
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
				'title'   => get_the_title( $page ),
				'url'     => get_permalink( $page ),
				// A first guess the owner can correct. On a generated service
				// page the title IS the keyword nearly every time.
				'keyword' => strtolower( get_the_title( $page ) ),
				'type'    => $type,
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
