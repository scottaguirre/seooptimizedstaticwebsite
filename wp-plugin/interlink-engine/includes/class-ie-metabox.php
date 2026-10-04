<?php
/**
 * The box where the title tag and the meta description can be edited.
 *
 * THE GAP THIS CLOSES. The plugin has written a title and a description onto
 * every post since 0.12.0, and 0.19.0 finally put them on the page. On a
 * generated theme the owner could edit them — that theme ships its own box.
 * With Yoast or Rank Math installed they could edit them — the publisher
 * wrote into those plugins' fields.
 *
 * On any other theme with no SEO plugin — which is every blog Edwin is
 * building — there was NO WAY TO CHANGE THEM AT ALL. No box, and the keys
 * begin with an underscore, so WordPress treats them as protected meta and
 * hides them from the Custom Fields panel too. The text went on the page and
 * stayed there.
 *
 * It mattered within the hour: a live title came in at 81 characters, Google
 * shows about 60, and there was no way to shorten it.
 *
 * ONLY ON CONTENT THIS PLUGIN WROTE. The box is not registered at all unless
 * the post carries `_ie_campaign`, and the save refuses on the same test. A
 * customer's own pages never see it.
 *
 * @package interlink-engine
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class IE_Metabox {

	const NONCE = 'ie_meta_box';

	/** Where search results stop showing the text. Guides, not limits. */
	const TITLE_GUIDE       = 60;
	const DESCRIPTION_GUIDE = 155;

	public static function boot() {
		add_action( 'add_meta_boxes', array( __CLASS__, 'register' ), 10, 2 );
		add_action( 'save_post', array( __CLASS__, 'save' ), 10, 2 );
	}

	/**
	 * Is this a post the plugin created?
	 *
	 * The same question IE_SEO and IE_Hygiene ask, by the same meta key. One
	 * test for "ours", used everywhere, so the three cannot drift into
	 * disagreeing about which content belongs to this plugin.
	 */
	public static function ours( $post_id ) {
		return '' !== (string) get_post_meta( (int) $post_id, '_ie_campaign', true );
	}

	/**
	 * @param string  $post_type
	 * @param WP_Post $post
	 */
	public static function register( $post_type, $post ) {
		if ( ! in_array( $post_type, array( 'post', 'page' ), true ) ) {
			return;
		}

		if ( ! $post || ! self::ours( $post->ID ) ) {
			return;
		}

		add_meta_box(
			'ie-seo-meta',
			__( 'Search result — Interlink Engine', 'interlink-engine' ),
			array( __CLASS__, 'render' ),
			$post_type,
			'normal',
			'high'
		);
	}

	public static function render( $post ) {
		$title       = (string) get_post_meta( $post->ID, '_ie_meta_title', true );
		$description = (string) get_post_meta( $post->ID, '_ie_meta_description', true );

		wp_nonce_field( self::NONCE, self::NONCE );
		?>
		<p class="description" style="margin-top:0">
			<?php esc_html_e( 'What a search engine shows for this page. Leave either blank to fall back to the theme default.', 'interlink-engine' ); ?>
		</p>

		<p>
			<label for="ie_meta_title" style="display:block;font-weight:600;margin-bottom:4px;">
				<?php esc_html_e( 'Title tag', 'interlink-engine' ); ?>
			</label>
			<input type="text" id="ie_meta_title" name="ie_meta_title" style="width:100%;"
				value="<?php echo esc_attr( $title ); ?>">
			<span class="description" id="ie_meta_title_count"></span>
		</p>

		<p>
			<label for="ie_meta_description" style="display:block;font-weight:600;margin-bottom:4px;">
				<?php esc_html_e( 'Meta description', 'interlink-engine' ); ?>
			</label>
			<textarea id="ie_meta_description" name="ie_meta_description" rows="3" style="width:100%;"><?php
				echo esc_textarea( $description );
			?></textarea>
			<span class="description" id="ie_meta_description_count"></span>
		</p>

		<script>
		/* THE COUNTERS ARE THE REASON THIS BOX EXISTS AT ALL.
		 *
		 * An 81-character title went live and nothing anywhere said it was too
		 * long — not the writer, not the quality check, not the admin. A
		 * number that updates as you type is the cheapest possible version of
		 * that missing check, and it is in front of the person who can fix it.
		 *
		 * WAITS FOR THE DOM. An inline script runs as the parser reaches it,
		 * so on 3 October a block like this one ran before the markup it
		 * queried existed and half the feature silently did nothing. The
		 * elements above happen to be parsed already, and relying on that is
		 * how that bug is written a second time. */
		( function () {
			function start() {
				var pairs = [
					[ 'ie_meta_title', 'ie_meta_title_count', <?php echo (int) self::TITLE_GUIDE; ?> ],
					[ 'ie_meta_description', 'ie_meta_description_count', <?php echo (int) self::DESCRIPTION_GUIDE; ?> ]
				];

				pairs.forEach( function ( pair ) {
					var field = document.getElementById( pair[0] );
					var out   = document.getElementById( pair[1] );
					if ( ! field || ! out ) { return; }

					function draw() {
						var n = field.value.length;
						out.textContent = n + ' / ' + pair[2];
						/* Over the guide is a WARNING, not an error. The limit
						 * is Google's rendering width, not a rule, and a long
						 * title is sometimes the right call. */
						out.style.color = n > pair[2] ? '#b32d2e' : '';
					}

					field.addEventListener( 'input', draw );
					draw();
				} );
			}

			if ( 'loading' === document.readyState ) {
				document.addEventListener( 'DOMContentLoaded', start );
			} else {
				start();
			}
		} )();
		</script>
		<?php
	}

	/**
	 * @param int     $post_id
	 * @param WP_Post $post
	 */
	public static function save( $post_id, $post = null ) {
		/* FOUR REFUSALS BEFORE ANYTHING IS WRITTEN, and every one of them has
		 * put data somewhere it did not belong in somebody's plugin.
		 *
		 *   autosave   fires save_post with an empty $_POST, so without this
		 *              every autosave blanks both fields
		 *   nonce      the request came from our form and not from elsewhere
		 *   caps       this user may edit this post
		 *   ownership  the post is one this plugin created
		 *
		 * The ownership check is last and is not redundant with register():
		 * a form can be submitted against any post id, and the box not being
		 * drawn is not the same as the write being refused. */
		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
			return;
		}

		if ( ! isset( $_POST[ self::NONCE ] )
			|| ! wp_verify_nonce( sanitize_key( wp_unslash( $_POST[ self::NONCE ] ) ), self::NONCE ) ) {
			return;
		}

		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}

		if ( ! self::ours( $post_id ) ) {
			return;
		}

		$title = isset( $_POST['ie_meta_title'] )
			? sanitize_text_field( wp_unslash( $_POST['ie_meta_title'] ) )
			: '';

		$description = isset( $_POST['ie_meta_description'] )
			? sanitize_text_field( wp_unslash( $_POST['ie_meta_description'] ) )
			: '';

		self::write( $post_id, $title, $description );
	}

	/**
	 * Store both values everywhere that reads them.
	 *
	 * THE PREFIXED KEYS TOO, and that is not duplication for its own sake.
	 * A generated theme renders from `<prefix>_page_title` in its own
	 * wp_head. Writing only the plugin's key would mean editing this box on a
	 * generated site changed nothing on the page — the silent kind of broken.
	 *
	 * NOT the Yoast or Rank Math keys. From 0.21.0 those plugins are fed
	 * through their own output filters instead, so a value in their box would
	 * be a second copy that no longer renders — exactly the confusion this
	 * box was added to end. One field, one effect.
	 *
	 * AN EMPTY VALUE IS DELETED RATHER THAN STORED. An empty string is a
	 * claim that a title exists and is blank; IE_SEO reads '' as "leave the
	 * theme's default alone", and the two agree only if nothing is there.
	 */
	public static function write( $post_id, $title, $description ) {
		$prefix = IE_Settings::active_theme_prefix();

		$pairs = array(
			'_ie_meta_title'       => $title,
			'_ie_meta_description' => $description,
		);

		if ( $prefix ) {
			$pairs[ $prefix . '_page_title' ]       = $title;
			$pairs[ $prefix . '_page_description' ] = $description;
		}

		foreach ( $pairs as $key => $value ) {
			if ( '' === $value ) {
				delete_post_meta( $post_id, $key );
			} else {
				update_post_meta( $post_id, $key, $value );
			}
		}
	}
}
