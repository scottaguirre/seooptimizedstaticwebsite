<?php
/**
 * The screens.
 *
 * Two: a connection screen, and a campaigns screen that does everything else.
 * Deliberately plain — this is the shape working, not the visual design. The
 * information architecture is the part worth getting right now, because it is
 * the part that is expensive to change later.
 *
 * THE FLOW THAT MATTERS
 *
 * Planning refuses a topic without a target query, and refuses the whole
 * campaign if any query would compete with the page it is meant to feed. So
 * the owner must not meet that refusal cold. Two paths lead into planning:
 *
 *   "Suggest topics"   the server proposes them, complete, ready to edit
 *   "Use my own"       the server derives the missing fields from what was
 *                      typed, and reports anything it is unhappy about
 *
 * Both are free and rate limited. Someone deciding whether this is worth
 * buying should not be charged to find out.
 *
 * @package interlink-engine
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class IE_Admin {

	/** Where a draft set of topics lives between the two steps. */
	const DRAFT_TRANSIENT = 'ie_draft_topics_';

	/**
	 * The tabs, in the order they appear.
	 *
	 * 'running' is first because checking on campaigns is what people open
	 * this screen to do; starting one is rarer, so 'new' is last. The old
	 * single page put the new-campaign form permanently underneath everything,
	 * which meant the most common visit ended in scrolling past a form.
	 */
	const TABS = array( 'running', 'drafts', 'done', 'new' );

	/**
	 * Finished campaigns per page.
	 *
	 * They never stop accumulating — a site running one campaign a fortnight
	 * has twenty-six a year, and nothing ever removes them, because the posts
	 * they wrote are the customer's and the record of what was charged has to
	 * survive. Ten is roughly a screen.
	 */
	const DONE_PER_PAGE = 10;

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_post_ie_connect', array( __CLASS__, 'handle_connect' ) );
		add_action( 'admin_post_ie_suggest', array( __CLASS__, 'handle_suggest' ) );
		add_action( 'admin_post_ie_create_campaign', array( __CLASS__, 'handle_create_campaign' ) );
		add_action( 'admin_post_ie_run_now', array( __CLASS__, 'handle_run_now' ) );
		add_action( 'admin_post_ie_publish_now', array( __CLASS__, 'handle_publish_now' ) );
		add_action( 'admin_post_ie_pause_campaign', array( __CLASS__, 'handle_pause_campaign' ) );
		add_action( 'admin_post_ie_resume_campaign', array( __CLASS__, 'handle_resume_campaign' ) );
		add_action( 'admin_post_ie_delete_campaign', array( __CLASS__, 'handle_delete_campaign' ) );
		add_action( 'admin_post_ie_discard_draft', array( __CLASS__, 'handle_discard_draft' ) );
	}

	public static function menu() {
		add_menu_page(
			__( 'Interlink Engine', 'interlink-engine' ),
			__( 'Interlink', 'interlink-engine' ),
			'manage_options',
			'interlink-engine',
			array( __CLASS__, 'render_campaigns' ),
			'dashicons-admin-links',
			58
		);

		add_submenu_page(
			'interlink-engine',
			__( 'Campaigns', 'interlink-engine' ),
			__( 'Campaigns', 'interlink-engine' ),
			'manage_options',
			'interlink-engine',
			array( __CLASS__, 'render_campaigns' )
		);

		add_submenu_page(
			'interlink-engine',
			__( 'Connection', 'interlink-engine' ),
			__( 'Connection', 'interlink-engine' ),
			'manage_options',
			'interlink-connection',
			array( __CLASS__, 'render_connection' )
		);
	}

	/* --------------------------------------------------------------------
	 * Connection
	 * ----------------------------------------------------------------- */

	public static function render_connection() {
		$connected = IE_Settings::is_connected();
		$credits   = IE_Settings::credits();
		$per_post  = IE_Settings::credits_per_post();
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Connection', 'interlink-engine' ); ?></h1>

			<?php self::notices(); ?>

			<?php if ( $connected ) : ?>
				<p>
					<strong><?php esc_html_e( 'Connected.', 'interlink-engine' ); ?></strong>
					<?php if ( null !== $credits ) : ?>
						<?php
						printf(
							/* translators: 1: credit balance, 2: cost of one post */
							esc_html__( '%1$s credits available, %2$s per post.', 'interlink-engine' ),
							esc_html( number_format_i18n( $credits ) ),
							esc_html( null === $per_post ? '—' : number_format_i18n( $per_post ) )
						);
						?>
					<?php endif; ?>
					<?php
					// The build, on the screen the owner is already looking at
					// when something is wrong. The plugins list has it too, but
					// nobody thinks to go there — and "which version is this?"
					// is the first question worth answering when a site and a
					// server disagree about what an endpoint is called.
					?>
					<span class="description" style="margin-left:.5rem">
						<?php echo esc_html( sprintf( __( 'Plugin v%s', 'interlink-engine' ), IE_VERSION ) ); ?>
					</span>
				</p>
				<p class="description">
					<?php esc_html_e( 'Your licence key is not stored here — it was exchanged for a signing key at connection. To move this site to another account, paste a new key below.', 'interlink-engine' ); ?>
				</p>
			<?php else : ?>
				<p><?php esc_html_e( 'Paste the licence key from your account. No API keys are needed — the writing happens on our servers.', 'interlink-engine' ); ?></p>
			<?php endif; ?>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="ie_connect">
				<?php wp_nonce_field( 'ie_connect' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="ie_licence"><?php esc_html_e( 'Licence key', 'interlink-engine' ); ?></label></th>
						<td>
							<input name="licence_key" id="ie_licence" type="text" class="regular-text"
								autocomplete="off" placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX">
							<?php if ( $connected ) : ?>
								<p class="description">
									<?php esc_html_e( 'Leave blank unless you are moving this site to another account. Saving with this empty changes only the server address.', 'interlink-engine' ); ?>
								</p>
							<?php endif; ?>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="ie_server"><?php esc_html_e( 'Server', 'interlink-engine' ); ?></label></th>
						<td>
							<input name="server_url" id="ie_server" type="url" class="regular-text"
								value="<?php echo esc_attr( IE_Settings::server_url() ); ?>">
							<p class="description"><?php esc_html_e( 'Leave this alone unless you were told otherwise. Changing it on its own is safe — it will not disconnect the site.', 'interlink-engine' ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'This site reports', 'interlink-engine' ); ?></th>
						<td>
							<p class="description">
								<?php echo esc_html( home_url() ); ?><br>
								<?php echo esc_html( wp_timezone_string() ); ?>
								<?php esc_html_e( '— posts are scheduled in this timezone.', 'interlink-engine' ); ?>
							</p>
						</td>
					</tr>
				</table>
				<?php
				// "Save" rather than "Reconnect" once connected, because with
				// an empty licence key that is what it does. A button labelled
				// Reconnect on a form whose usual use is editing one address
				// promises something alarming and does something ordinary.
				submit_button( $connected ? __( 'Save', 'interlink-engine' ) : __( 'Connect', 'interlink-engine' ) );
				?>
			</form>

			<h2><?php esc_html_e( 'Recent activity', 'interlink-engine' ); ?></h2>
			<?php self::render_log(); ?>
		</div>
		<?php
	}

	/**
	 * Save the connection settings.
	 *
	 * TWO DIFFERENT ACTIONS BEHIND ONE BUTTON, and separating them is the
	 * whole point of this function.
	 *
	 * With a licence key, this is an activation: the key is exchanged for a
	 * site id and a signing secret, and the old ones stop working.
	 *
	 * WITHOUT a licence key, on a site that is already connected, it is just
	 * an address change — and it must not touch the connection. It used to:
	 * the form always called activate(), activate() clears the site id and
	 * secret when it fails, and the key is never stored here, so an owner who
	 * corrected the server address and pressed Save disconnected their site.
	 * A working site should not be one keystroke from being unreachable
	 * because someone edited a URL.
	 */
	public static function handle_connect() {
		check_admin_referer( 'ie_connect' );
		self::require_caps();

		$key    = isset( $_POST['licence_key'] ) ? sanitize_text_field( wp_unslash( $_POST['licence_key'] ) ) : '';
		$server = isset( $_POST['server_url'] ) ? esc_url_raw( wp_unslash( $_POST['server_url'] ) ) : '';

		/* ---- address only ---- */

		if ( '' === $key && IE_Settings::is_connected() ) {
			$host = $server ? wp_parse_url( $server, PHP_URL_HOST ) : '';

			if ( ! $host ) {
				self::redirect( 'interlink-connection', 'error',
					__( 'That does not look like a web address. It should start with https://', 'interlink-engine' ) );
			}

			if ( untrailingslashit( $server ) === IE_Settings::server_url() ) {
				self::redirect( 'interlink-connection', 'unchanged', '' );
			}

			IE_Settings::set( array( 'server_url' => untrailingslashit( $server ) ) );

			IE_Publisher::log( sprintf( 'server address changed to %s', untrailingslashit( $server ) ) );

			self::redirect( 'interlink-connection', 'server_saved', '' );
		}

		/* ---- a real activation ---- */

		if ( '' === $key ) {
			self::redirect( 'interlink-connection', 'error',
				__( 'Paste your licence key to connect this site.', 'interlink-engine' ) );
		}

		$result = IE_Api::activate( $key, $server );

		self::redirect(
			'interlink-connection',
			is_wp_error( $result ) ? 'error' : 'connected',
			is_wp_error( $result ) ? $result->get_error_message() : ''
		);
	}

	/* --------------------------------------------------------------------
	 * Campaigns
	 * ----------------------------------------------------------------- */

	/**
	 * Which tab is showing.
	 *
	 * Whitelisted against TABS rather than sanitised, because the value picks
	 * a branch below and an unexpected string should land somewhere sensible
	 * rather than on a blank screen.
	 */
	private static function current_tab() {
		$tab = isset( $_GET['tab'] ) ? sanitize_key( wp_unslash( $_GET['tab'] ) ) : '';
		return in_array( $tab, self::TABS, true ) ? $tab : 'running';
	}

	/** The admin URL for a tab, keeping the page argument right. */
	private static function tab_url( $tab, $args = array() ) {
		return add_query_arg(
			array_merge( array( 'page' => 'interlink-engine', 'tab' => $tab ), $args ),
			admin_url( 'admin.php' )
		);
	}

	/**
	 * Sort campaigns into the three states a person actually distinguishes.
	 *
	 * The split that matters is NOT how many posts are published. It is
	 * whether money has been spent:
	 *
	 *   drafts  — planned, never approved. Nothing written, nothing charged.
	 *             batch_started is the record of approval, so its absence is
	 *             the test.
	 *   running — approved, with posts still to publish.
	 *   done    — every post public. Needs nothing from anyone.
	 *
	 * The old screen had no place at all for the first of those. A planned
	 * campaign sat in the main list looking exactly like a running one, with
	 * a price on a button as the only clue that it had not started.
	 */
	private static function bucket( $campaigns ) {
		$out = array( 'running' => array(), 'drafts' => array(), 'done' => array() );

		foreach ( $campaigns as $campaign ) {
			$outstanding = 0;
			foreach ( $campaign['slots'] as $slot ) {
				if ( 'published' !== $slot['status'] ) {
					$outstanding++;
				}
			}

			if ( empty( $campaign['batch_started'] ) ) {
				$out['drafts'][] = $campaign;
			} elseif ( $outstanding ) {
				$out['running'][] = $campaign;
			} else {
				$out['done'][] = $campaign;
			}
		}

		// Newest finished first: the one you just completed is the one you are
		// most likely to be looking for, and page one should hold it.
		usort( $out['done'], function ( $a, $b ) {
			$at = isset( $a['created'] ) ? strtotime( $a['created'] ) : 0;
			$bt = isset( $b['created'] ) ? strtotime( $b['created'] ) : 0;
			return $bt <=> $at;
		} );

		return $out;
	}

	public static function render_campaigns() {
		$campaigns = IE_Campaigns::all();
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Campaigns', 'interlink-engine' ); ?></h1>

			<?php self::notices(); ?>

			<?php if ( ! IE_Settings::is_connected() ) : ?>
				<div class="notice notice-warning"><p>
					<?php
					printf(
						wp_kses_post( __( 'Connect your licence key first — <a href="%s">Connection</a>.', 'interlink-engine' ) ),
						esc_url( admin_url( 'admin.php?page=interlink-connection' ) )
					);
					?>
				</p></div>
				</div>
				<?php
				return;
			endif;

			self::styles();

			$buckets = self::bucket( $campaigns );
			$tab     = self::current_tab();

			self::render_tabs( $tab, $buckets );

			switch ( $tab ) {
				case 'drafts':
					self::render_drafts_tab( $buckets['drafts'] );
					break;

				case 'done':
					self::render_done_tab( $buckets['done'] );
					break;

				case 'new':
					self::render_new_campaign_form();
					break;

				case 'running':
				default:
					self::render_running_tab( $buckets['running'], empty( $campaigns ) );
					break;
			}
			?>
		</div>
		<?php
	}

	/**
	 * The tab strip.
	 *
	 * WordPress's own nav-tab markup, so it looks like part of wp-admin rather
	 * than something a plugin drew. The counts are the point: they answer
	 * "is there anything waiting for me" before you have clicked anything.
	 */
	private static function render_tabs( $active, $buckets ) {
		$has_topics = (bool) self::draft();

		$labels = array(
			'running' => __( 'In progress', 'interlink-engine' ),
			'drafts'  => __( 'Waiting for you', 'interlink-engine' ),
			'done'    => __( 'Completed', 'interlink-engine' ),
			'new'     => __( 'New campaign', 'interlink-engine' ),
		);
		?>
		<nav class="nav-tab-wrapper wp-clearfix" style="margin-bottom:1.25rem">
			<?php foreach ( self::TABS as $tab ) : ?>
				<?php
				$count = isset( $buckets[ $tab ] ) ? count( $buckets[ $tab ] ) : 0;

				// The new-campaign tab has no campaigns to count, but it can
				// be holding suggested topics someone walked away from — and
				// those evaporate with the transient, so saying they are there
				// is the difference between finishing that campaign and
				// paying to suggest topics twice.
				$badge = ( 'new' === $tab ) ? ( $has_topics ? '&bull;' : '' ) : (string) $count;

				// Amber only on the tab that means "do something". Every other
				// count is information; this one is a task.
				$badge_class = ( 'drafts' === $tab && $count ) ? 'ie-count ie-count-need' : 'ie-count';
				?>
				<a class="nav-tab <?php echo $active === $tab ? 'nav-tab-active' : ''; ?>"
				   href="<?php echo esc_url( self::tab_url( $tab ) ); ?>">
					<?php echo esc_html( $labels[ $tab ] ); ?>
					<?php if ( '' !== $badge ) : ?>
						<span class="<?php echo esc_attr( $badge_class ); ?>"><?php echo wp_kses( $badge, array() ); ?></span>
					<?php endif; ?>
				</a>
			<?php endforeach; ?>
		</nav>
		<?php
	}

	/* --------------------------------------------------------------------
	 * The tabs
	 * ----------------------------------------------------------------- */

	private static function render_running_tab( $running, $none_at_all ) {
		if ( empty( $running ) ) {
			if ( $none_at_all ) {
				?>
				<p><?php esc_html_e( 'No campaigns yet. A campaign is a batch of posts, all feeding one page you want to rank.', 'interlink-engine' ); ?></p>
				<p>
					<a class="button button-primary" href="<?php echo esc_url( self::tab_url( 'new' ) ); ?>">
						<?php esc_html_e( 'Plan your first campaign', 'interlink-engine' ); ?>
					</a>
				</p>
				<?php
				return;
			}
			?>
			<p><?php esc_html_e( 'Nothing publishing at the moment.', 'interlink-engine' ); ?></p>
			<?php
			return;
		}

		// Collapsed once there is more than one to read. A single campaign has
		// nothing to be buried under, so it opens.
		$collapse = count( $running ) > 1;

		foreach ( $running as $campaign ) {
			self::render_campaign_card( $campaign, $collapse );
		}

		// Below the campaigns, not above: it describes them, and with one
		// campaign it repeats the card it sits under. It earns its place at
		// two or more, where it is the only view that can see a day carrying
		// two posts.
		if ( count( $running ) > 1 ) {
			self::render_upcoming();
		}
	}

	private static function render_drafts_tab( $drafts ) {
		if ( empty( $drafts ) ) {
			?>
			<p><?php esc_html_e( 'Nothing waiting. A campaign appears here once it is planned, and stays until you approve it.', 'interlink-engine' ); ?></p>
			<p>
				<a class="button" href="<?php echo esc_url( self::tab_url( 'new' ) ); ?>">
					<?php esc_html_e( 'Plan a campaign', 'interlink-engine' ); ?>
				</a>
			</p>
			<?php
			return;
		}
		?>
		<div class="notice notice-info inline" style="margin:0 0 1.25rem"><p>
			<strong><?php esc_html_e( 'Nothing here has been charged.', 'interlink-engine' ); ?></strong>
			<?php esc_html_e( 'A campaign is planned as a draft first. Approving it is what writes the posts and spends the credits.', 'interlink-engine' ); ?>
		</p></div>
		<?php
		foreach ( $drafts as $campaign ) {
			self::render_campaign_card( $campaign, count( $drafts ) > 1 );
		}
	}

	/**
	 * Finished campaigns, a page at a time.
	 *
	 * Paged rather than hidden behind a <details>, because the list only grows
	 * and "62 finished campaigns" behind one toggle is not a list anyone can
	 * use. paginate_links() draws WordPress's own pager, so it matches every
	 * other list table in the admin.
	 */
	private static function render_done_tab( $done ) {
		if ( empty( $done ) ) {
			?>
			<p><?php esc_html_e( 'No campaigns have finished yet. One arrives here when its last post goes live.', 'interlink-engine' ); ?></p>
			<?php
			return;
		}

		$total = count( $done );
		$pages = (int) ceil( $total / self::DONE_PER_PAGE );

		// Clamped, not trusted: ?paged=999 on a two-page list should show the
		// last page rather than an empty screen with a pager pointing nowhere.
		$paged = isset( $_GET['paged'] ) ? max( 1, (int) $_GET['paged'] ) : 1;
		$paged = min( $paged, $pages );

		$slice = array_slice( $done, ( $paged - 1 ) * self::DONE_PER_PAGE, self::DONE_PER_PAGE );
		?>
		<p class="description" style="margin:0 0 1rem">
			<?php esc_html_e( 'Every post stays on your site. A finished campaign is the record of what was published and what it feeds.', 'interlink-engine' ); ?>
		</p>

		<div class="tablenav top" style="height:auto;margin:0 0 .75rem">
			<div class="tablenav-pages">
				<span class="displaying-num">
					<?php
					echo esc_html( sprintf(
						/* translators: %s: number of finished campaigns */
						_n( '%s campaign', '%s campaigns', $total, 'interlink-engine' ),
						number_format_i18n( $total )
					) );
					?>
				</span>
				<?php self::done_pager( $paged, $pages ); ?>
			</div>
		</div>

		<?php
		foreach ( $slice as $campaign ) {
			self::render_campaign_card( $campaign, true );
		}

		if ( $pages > 1 ) {
			?>
			<div class="tablenav bottom" style="height:auto">
				<div class="tablenav-pages"><?php self::done_pager( $paged, $pages ); ?></div>
			</div>
			<?php
		}
	}

	private static function done_pager( $paged, $pages ) {
		if ( $pages < 2 ) {
			return;
		}

		echo wp_kses_post( paginate_links( array(
			'base'      => self::tab_url( 'done', array( 'paged' => '%#%' ) ),
			'format'    => '',
			'prev_text' => '&laquo;',
			'next_text' => '&raquo;',
			'total'     => $pages,
			'current'   => $paged,
			'type'      => 'plain',
		) ) );
	}

	/**
	 * The few styles this screen needs that wp-admin does not provide.
	 *
	 * Inline rather than a stylesheet: it is under a kilobyte, it is only ever
	 * used on this one screen, and enqueueing a file means a second thing to
	 * keep in step with the version number.
	 */
	private static function styles() {
		?>
		<style>
			.ie-count{display:inline-block;min-width:18px;padding:0 6px;margin-left:6px;
				border-radius:9px;background:#b8bcc0;color:#fff;font-size:11px;
				font-weight:600;line-height:18px;text-align:center;vertical-align:1px}
			.nav-tab-active .ie-count{background:#2271b1}
			.ie-count-need{background:#b8860b}
			.ie-pill{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;
				border-radius:9px;font-size:11.5px;font-weight:600;white-space:nowrap}
			.ie-pill::before{content:"";width:6px;height:6px;border-radius:50%;
				background:currentColor}
			.ie-pill-live{color:#14622a;background:#e5f5e9}
			.ie-pill-sched{color:#1a5d8a;background:#e4eff7}
			.ie-pill-wait{color:#7a5c00;background:#fbf3d8}
			.ie-pill-late{color:#8a1f1f;background:#fbeaea}
			.ie-pill-done{color:#4b5563;background:#eceef0}
			/* widefat sets display on cells, so the hidden attribute alone
			   is not reliably enough to hide a column here. */
			.ie-terms[hidden]{display:none}
		</style>

		<script>
		( function () {
			// Reveal the toggles only now that we can act on them: without
			// scripting the column simply stays hidden, which is the sane
			// state, rather than leaving a button that does nothing.
			document.addEventListener( 'DOMContentLoaded', function () {
				var showing = <?php echo wp_json_encode( __( 'Show search terms', 'interlink-engine' ) ); ?>;
				var hiding  = <?php echo wp_json_encode( __( 'Hide search terms', 'interlink-engine' ) ); ?>;

				document.querySelectorAll( '.ie-terms-toggle' ).forEach( function ( btn ) {
					btn.hidden = false;

					btn.addEventListener( 'click', function () {
						// Scoped to this campaign's own card, so opening one
						// campaign's terms does not open every campaign's.
						var card = btn.closest( '.card' );
						if ( ! card ) { return; }

						var open = btn.getAttribute( 'aria-expanded' ) === 'true';

						card.querySelectorAll( '.ie-terms' ).forEach( function ( cell ) {
							cell.hidden = open;
						} );

						btn.setAttribute( 'aria-expanded', open ? 'false' : 'true' );
						btn.textContent = open ? showing : hiding;
					} );
				} );
			} );
		} )();
		</script>
		<?php
	}

	/**
	 * What is publishing next, across every campaign.
	 *
	 * The one view a campaign card cannot give you, because a card only knows
	 * its own dates. Put at the top because it answers the question an owner
	 * opens this screen to ask.
	 */
	private static function render_upcoming() {
		$rows       = IE_Campaigns::upcoming( 10 );
		$collisions = IE_Campaigns::collisions();

		if ( empty( $rows ) ) {
			return;
		}

		$today = wp_date( 'Y-m-d' );
		?>
		<h2 style="margin-top:1.5rem"><?php esc_html_e( 'Coming up', 'interlink-engine' ); ?></h2>

		<?php if ( $collisions ) : ?>
			<div class="notice notice-warning inline" style="margin:0 0 1rem"><p>
				<?php
				echo esc_html( sprintf(
					/* translators: 1: number of days, 2: the first such date */
					_n(
						'Two posts land on the same day (%2$s). A blog that publishes once a week and then twice at once reads as automated — consider shifting one campaign\'s time.',
						'Several days carry more than one post (%1$d of them, first on %2$s). A blog that publishes once a week and then twice at once reads as automated — consider shifting one campaign\'s time.',
						count( $collisions ),
						'interlink-engine'
					),
					count( $collisions ),
					wp_date( 'j M', strtotime( array_key_first( $collisions ) ) )
				) );
				?>
			</p></div>
		<?php endif; ?>

		<table class="widefat striped" style="margin-bottom:1.5rem">
			<thead>
				<tr>
					<th style="width:12rem"><?php esc_html_e( 'When', 'interlink-engine' ); ?></th>
					<th><?php esc_html_e( 'Post', 'interlink-engine' ); ?></th>
					<th style="width:16rem"><?php esc_html_e( 'Feeding', 'interlink-engine' ); ?></th>
					<th style="width:10rem"><?php esc_html_e( 'State', 'interlink-engine' ); ?></th>
				</tr>
			</thead>
			<tbody>
			<?php foreach ( $rows as $row ) : ?>
				<?php
				$day     = wp_date( 'Y-m-d', $row['at'] );
				$clashes = isset( $collisions[ $day ] );
				?>
				<tr>
					<td>
						<?php echo esc_html( wp_date( 'j M, H:i', $row['at'] ) ); ?>
						<?php if ( $day === $today ) : ?>
							<strong style="color:#2271b1"><?php esc_html_e( '· today', 'interlink-engine' ); ?></strong>
						<?php endif; ?>
						<?php if ( $clashes ) : ?>
							<span title="<?php esc_attr_e( 'Another post publishes the same day', 'interlink-engine' ); ?>"
							      style="color:#b26200">&#9888;</span>
						<?php endif; ?>
					</td>
					<td>
						<?php if ( $row['post_id'] ) : ?>
							<a href="<?php echo esc_url( get_edit_post_link( $row['post_id'] ) ); ?>">
								<?php echo esc_html( $row['topic'] ); ?>
							</a>
						<?php else : ?>
							<?php echo esc_html( $row['topic'] ); ?>
						<?php endif; ?>
					</td>
					<td class="description"><?php echo esc_html( $row['page'] ); ?></td>
					<td>
						<?php
						// The SAME five words as the campaign tables below.
						// This column used to say "not written yet" for a post
						// the table underneath called "waiting to collect" —
						// one screen, one post, two names.
						?>
						<?php if ( $row['overdue'] ) : ?>
							<?php // Scheduled, date passed, still not public. WP-Cron has not run. ?>
							<span class="ie-pill ie-pill-late"><?php esc_html_e( 'Overdue', 'interlink-engine' ); ?></span>
						<?php elseif ( 'scheduled' === $row['status'] ) : ?>
							<span class="ie-pill ie-pill-sched"><?php esc_html_e( 'Scheduled', 'interlink-engine' ); ?></span>
						<?php elseif ( 'failed' === $row['status'] ) : ?>
							<span class="ie-pill ie-pill-late"><?php esc_html_e( 'Failed', 'interlink-engine' ); ?></span>
						<?php else : ?>
							<span class="ie-pill ie-pill-wait"><?php esc_html_e( 'Arriving', 'interlink-engine' ); ?></span>
						<?php endif; ?>
					</td>
				</tr>
			<?php endforeach; ?>
			</tbody>
		</table>
		<?php
	}

	private static function render_campaign_card( $campaign, $collapse = false ) {
		// Two numbers now, because a post being ON the site and a post being
		// VISIBLE are no longer the same event. "9 of 12 scheduled, 3 live"
		// is the sentence the owner needs; one combined figure hides whichever
		// half they were actually asking about.
		$scheduled = 0;
		$live      = 0;

		foreach ( $campaign['slots'] as $slot ) {
			if ( 'published' === $slot['status'] ) {
				$live++;
				$scheduled++;
			} elseif ( 'scheduled' === $slot['status'] ) {
				$scheduled++;
			}
		}

		$orphans = IE_Campaigns::orphans( $campaign );
		?>
		<div class="card" style="max-width:none;padding:1rem 1.25rem;margin-bottom:1.25rem">
			<h2 style="margin-top:0">
				<?php echo esc_html( $campaign['label'] ? $campaign['label'] : $campaign['target_page']['title'] ); ?>
				<span style="font-weight:400;color:#666">
					— <?php echo esc_html( sprintf(
						/* translators: 1: posts on the site, 2: total, 3: how many are public */
						__( '%1$d of %2$d scheduled, %3$d live', 'interlink-engine' ),
						$scheduled, count( $campaign['slots'] ), $live
					) ); ?>,
					<?php echo esc_html( 'draft' === $campaign['publish_mode'] ? __( 'saving as drafts', 'interlink-engine' ) : __( 'publishing on schedule', 'interlink-engine' ) ); ?>
				</span>
			</h2>

			<p style="margin-top:0">
				<?php esc_html_e( 'Feeding:', 'interlink-engine' ); ?>
				<a href="<?php echo esc_url( $campaign['target_page']['url'] ); ?>" target="_blank" rel="noreferrer">
					<?php echo esc_html( $campaign['target_page']['title'] ); ?>
				</a>
				&middot; <?php echo esc_html( sprintf( __( 'every %d days', 'interlink-engine' ), (int) $campaign['every_days'] ) ); ?>
				<?php if ( ! empty( $campaign['quote']['total'] ) ) : ?>
					&middot; <?php echo esc_html( sprintf( __( '%s credits for the batch', 'interlink-engine' ), number_format_i18n( $campaign['quote']['total'] ) ) ); ?>
				<?php endif; ?>
			</p>

			<?php if ( ! empty( $orphans ) ) : ?>
				<div class="notice notice-warning inline"><p>
					<?php
					printf(
						esc_html__( 'Nothing links to slot(s): %s. The ring has been broken by an edit.', 'interlink-engine' ),
						esc_html( implode( ', ', $orphans ) )
					);
					?>
				</p></div>
			<?php endif; ?>

			<?php
			/**
			 * The slot table folds away once there is more than one campaign.
			 *
			 * Twelve rows per campaign is fine to read when there is one. At
			 * four campaigns it is forty-eight rows of scrolling between an
			 * owner and the button they came to press — and the per-slot
			 * detail is rarely what they came for, because "Coming up" at the
			 * top already answers the usual question.
			 *
			 * <details> rather than JavaScript: it survives a page with no
			 * scripts, keeps its own state, and is searchable by the browser's
			 * find on modern engines.
			 */
			?>
			<details <?php echo $collapse ? '' : 'open'; ?>>
				<summary style="cursor:pointer;margin:.5rem 0;color:#2271b1">
					<?php
					echo esc_html( sprintf(
						/* translators: %d: number of posts in the campaign */
						_n( 'Show the %d post', 'Show all %d posts', count( $campaign['slots'] ), 'interlink-engine' ),
						count( $campaign['slots'] )
					) );
					?>
				</summary>

			<table class="widefat striped">
				<thead>
					<tr>
						<th><?php esc_html_e( 'Topic', 'interlink-engine' ); ?></th>
						<th class="ie-terms" hidden><?php esc_html_e( 'Search term it targets', 'interlink-engine' ); ?></th>
						<th><?php esc_html_e( 'Publishes', 'interlink-engine' ); ?></th>
						<th><?php esc_html_e( 'State', 'interlink-engine' ); ?></th>
						<th></th>
					</tr>
				</thead>
				<tbody>
				<?php foreach ( $campaign['slots'] as $slot ) : ?>
					<tr>
						<td>
							<?php if ( $slot['post_id'] ) : ?>
								<a href="<?php echo esc_url( get_edit_post_link( $slot['post_id'] ) ); ?>"><?php echo esc_html( $slot['topic'] ); ?></a>
							<?php else : ?>
								<?php echo esc_html( $slot['topic'] ); ?>
							<?php endif; ?>
						</td>
						<td class="ie-terms" hidden><code><?php echo esc_html( $slot['target_query'] ); ?></code></td>
						<td>
							<?php
							echo esc_html(
								$slot['publish_at']
									? wp_date( 'j M Y, H:i', strtotime( $slot['publish_at'] ) )
									: '—'
							);
							?>
						</td>
						<td>
							<?php
							/**
							 * ONE WORD PER STATE, and the same word everywhere.
							 *
							 * This table used to say "waiting to collect" for a
							 * post that had not arrived, while "Coming up" called
							 * the same post "not written yet" — two names for one
							 * thing, on one screen. Worse, both describe the
							 * plumbing rather than what the owner sees: they do
							 * not collect anything, the server does.
							 *
							 * So: Live, Scheduled, Arriving, Overdue, Failed.
							 */
							if ( 'published' === $slot['status'] ) :
								?>
								<span class="ie-pill ie-pill-live"><?php esc_html_e( 'Live', 'interlink-engine' ); ?></span>
							<?php elseif ( 'scheduled' === $slot['status'] ) : ?>
								<?php
								// Scheduled with its date already gone means
								// WP-Cron has not fired. Saying "Scheduled" then
								// is a lie the owner can see through by looking
								// at the calendar.
								$late = $slot['publish_at'] && strtotime( $slot['publish_at'] ) < time();
								?>
								<?php if ( $late ) : ?>
									<span class="ie-pill ie-pill-late" title="<?php esc_attr_e( 'Its time has passed and WordPress has not published it yet. The server will push it shortly.', 'interlink-engine' ); ?>"><?php esc_html_e( 'Overdue', 'interlink-engine' ); ?></span>
								<?php else : ?>
									<span class="ie-pill ie-pill-sched"><?php esc_html_e( 'Scheduled', 'interlink-engine' ); ?></span>
								<?php endif; ?>
							<?php elseif ( $slot['error'] ) : ?>
								<span class="ie-pill ie-pill-late" title="<?php echo esc_attr( $slot['error'] ); ?>"><?php esc_html_e( 'Failed', 'interlink-engine' ); ?></span>
							<?php else : ?>
								<span class="ie-pill ie-pill-wait"><?php esc_html_e( 'Arriving', 'interlink-engine' ); ?></span>
							<?php endif; ?>
						</td>
						<td>
							<?php
							// NO per-row write button. There is no such thing as
							// writing one post any more — the batch writes the
							// whole campaign and charges for the whole campaign,
							// so a button on one row saying "now" would spend
							// twelve posts' worth of credits. Approving is a
							// campaign-level act with a price on it, and it lives
							// under the table where the price can be shown.
							?>
							<?php
							/**
							 * A LINK, not a button.
							 *
							 * Six of these as buttons made the loudest thing on
							 * the page a control that DISCARDS the schedule the
							 * owner just paid to plan. "Early" rather than "now"
							 * for the same reason: it says what it does to the
							 * plan, not just when it happens.
							 */
							?>
							<?php if ( 'scheduled' === $slot['status'] ) : ?>
								<a href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=ie_publish_now&campaign=' . rawurlencode( $campaign['id'] ) . '&slot=' . (int) $slot['index'] ), 'ie_publish_now' ) ); ?>"
								   onclick="return confirm('<?php echo esc_js( __( 'Publish this one now? It will be dated today instead of its planned day.', 'interlink-engine' ) ); ?>')">
									<?php esc_html_e( 'Publish early', 'interlink-engine' ); ?>
								</a>
							<?php endif; ?>
						</td>
					</tr>
				<?php endforeach; ?>
				</tbody>
			</table>

			<?php
			/**
			 * The search terms, behind a toggle.
			 *
			 * They were the widest column on the screen and, in monospace, the
			 * most eye-catching — for a value that matters when you are working
			 * out why a post reads oddly, and never when you are glancing at
			 * what publishes tomorrow.
			 *
			 * Progressive enhancement: the button is only drawn if scripting is
			 * available to act on it, so a no-JS admin sees no dead control.
			 */
			?>
			<p style="margin:.5rem 0 0">
				<button type="button" class="button-link ie-terms-toggle" aria-expanded="false" hidden>
					<?php esc_html_e( 'Show search terms', 'interlink-engine' ); ?>
				</button>
			</p>
			</details>

			<?php
			/**
			 * Approving, with the price on the button.
			 *
			 * This is the only control on the page that spends money, and it
			 * spends all of it at once: approving a twelve-post campaign is a
			 * 900-credit decision, not a 75-credit one. So the number is on the
			 * button and in the confirmation, not on a screen the owner saw
			 * five minutes ago.
			 *
			 * `$pending` rather than the whole campaign, because a campaign
			 * that half-wrote and stopped costs only what is left.
			 */
			$pending = 0;
			foreach ( $campaign['slots'] as $slot ) {
				if ( 'pending' === $slot['status'] ) {
					$pending++;
				}
			}

			/**
			 * What a post costs, and what to do when we do not know.
			 *
			 * credits_per_post() returns NULL rather than a guess when the
			 * server has not told us — and the accessor matters here, because
			 * IE_Settings::get( 'credits_per_post', 75 ) hands back the stored
			 * null rather than the 75, which would put "0 credits" on a button
			 * that is about to spend nine hundred.
			 *
			 * A guessed price on a spending button is worse than no price: the
			 * owner would have been told a number, and it would be wrong. So
			 * the fallback is to say nothing about cost and let the server's
			 * own refusal be the check.
			 */
			$per_post = IE_Settings::credits_per_post();
			if ( null === $per_post && ! empty( $campaign['quote']['creditsPerPost'] ) ) {
				$per_post = (int) $campaign['quote']['creditsPerPost'];
			}

			$cost = ( null === $per_post ) ? null : $pending * (int) $per_post;

			/**
			 * Has this campaign already been paid for?
			 *
			 * Once it has, the button stops being a purchase and becomes a
			 * status check — the posts are written and charged, and all that
			 * is left is fetching them. Showing a price at that point asks the
			 * owner to decide whether pressing it will cost them again. It
			 * will not, but they have no way to know that from the screen.
			 */
			$approved = ! empty( $campaign['batch_started'] );

			/**
			 * A stopped campaign offers neither button.
			 *
			 * run_campaign() already refuses one that is not active, so pressing
			 * it would be harmless — but it returns a skip rather than an error,
			 * and the screen would report "0 posts added" to someone who had
			 * just asked for posts. A button that appears to work and does
			 * nothing is worse than no button.
			 */
			$paused = IE_Campaigns::is_paused( $campaign );

			/**
			 * Is the batch recent enough to be worth watching?
			 *
			 * Collection is automatic: the server pings the site and the
			 * plugin takes the posts. So the page has nothing to do but look,
			 * and it only needs to look for as long as a batch plausibly runs
			 * — a minute or so per post. Ten minutes covers a long campaign
			 * with room to spare, and after that a page left open overnight
			 * stops reloading itself forever.
			 */
			$started  = $approved ? strtotime( $campaign['batch_started'] ) : 0;
			$watching = $pending && $approved && $started && ( time() - $started ) < 600;
			?>

			<?php if ( $watching ) : ?>
				<p class="description" style="display:flex;align-items:center;gap:.5rem">
					<span class="spinner is-active" style="float:none;margin:0"></span>
					<?php esc_html_e( 'Writing your posts. They arrive on their own — you can leave this page. This view refreshes itself.', 'interlink-engine' ); ?>
				</p>
				<?php
				// A plain reload, not a re-submitted action. The page is
				// watching, not driving: the server's ping is what actually
				// collects, and re-firing the approve action on a timer would
				// be a very bad way to find that out.
				//
				// Emitted ONCE however many campaigns are mid-batch. Two cards
				// each scheduling a reload gives two timers racing on one
				// document, and the page reloads twice as fast as intended for
				// no reason anyone could see from the screen.
				static $reload_armed = false;

				if ( ! $reload_armed ) {
					$reload_armed = true;
					echo '<script>setTimeout(function () { window.location.reload(); }, 15000);</script>';
				}
				?>
			<?php endif; ?>

			<p style="margin-bottom:0;display:flex;gap:1rem;align-items:center;flex-wrap:wrap">
				<?php if ( $pending && $approved && ! $paused ) : ?>
					<?php
					// Already paid for. No price, no confirmation — this only
					// fetches posts the owner already owns, and it is a
					// fallback for the automatic collection rather than the
					// way the thing is meant to work.
					?>
					<a class="button"
					   href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=ie_run_now&campaign=' . rawurlencode( $campaign['id'] ) ), 'ie_run_now' ) ); ?>">
						<?php esc_html_e( 'Check now', 'interlink-engine' ); ?>
					</a>
					<span class="description">
						<?php esc_html_e( 'Already written and paid for. This only fetches them — it costs nothing.', 'interlink-engine' ); ?>
					</span>

				<?php elseif ( $pending && ! $paused ) : ?>
					<a class="button button-primary"
					   href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=ie_run_now&campaign=' . rawurlencode( $campaign['id'] ) ), 'ie_run_now' ) ); ?>"
					   onclick="return confirm('<?php echo esc_js(
							null === $cost
								? sprintf(
									/* translators: %d: number of posts */
									__( 'Write %d posts now? They are charged as each one is written.', 'interlink-engine' ),
									$pending
								)
								: sprintf(
									/* translators: 1: number of posts, 2: total credits */
									__( 'Write %1$d posts now? This costs %2$s credits, charged as each post is written.', 'interlink-engine' ),
									$pending, number_format_i18n( $cost )
								)
					   ); ?>')">
						<?php echo esc_html(
							null === $cost
								? sprintf(
									/* translators: %d: number of posts */
									_n( 'Write %d post', 'Write all %d posts', $pending, 'interlink-engine' ),
									$pending
								)
								: sprintf(
									/* translators: 1: number of posts, 2: total credits */
									_n( 'Write %1$d post — %2$s credits', 'Write all %1$d posts — %2$s credits', $pending, 'interlink-engine' ),
									$pending, number_format_i18n( $cost )
								)
						); ?>
					</a>
					<span class="description">
						<?php esc_html_e( 'Every post is written now. They are added to your site dated, and publish on their own days.', 'interlink-engine' ); ?>
					</span>
				<?php endif; ?>

				<?php if ( IE_Campaigns::is_paused( $campaign ) ) : ?>
					<a class="button button-primary"
					   href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=ie_resume_campaign&campaign=' . rawurlencode( $campaign['id'] ) ), 'ie_resume_campaign' ) ); ?>">
						<?php esc_html_e( 'Resume campaign', 'interlink-engine' ); ?>
					</a>
					<span class="description">
						<?php esc_html_e( 'Held posts go back on the schedule, each moved forward by however long the campaign was stopped.', 'interlink-engine' ); ?>
					</span>
				<?php else : ?>
					<a class="button"
					   href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=ie_pause_campaign&campaign=' . rawurlencode( $campaign['id'] ) ), 'ie_pause_campaign' ) ); ?>"
					   onclick="return confirm('<?php echo esc_js( __( 'Stop this campaign? Scheduled posts are held back as drafts and nothing new is written. Posts already published stay up.', 'interlink-engine' ) ); ?>')">
						<?php esc_html_e( 'Stop publishing', 'interlink-engine' ); ?>
					</a>
				<?php endif; ?>

				<a class="button-link-delete" style="margin-left:auto"
				   href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=ie_delete_campaign&campaign=' . rawurlencode( $campaign['id'] ) ), 'ie_delete_campaign' ) ); ?>"
				   onclick="return confirm('<?php echo esc_js( __( 'Remove this campaign? Posts already written stay exactly where they are.', 'interlink-engine' ) ); ?>')">
					<?php esc_html_e( 'Remove campaign', 'interlink-engine' ); ?>
				</a>
			</p>
		</div>
		<?php
	}

	/**
	 * Topics proposed but not yet planned, for the current user.
	 *
	 * Held in a transient rather than an option: it is a half-finished form,
	 * not settings, and if it evaporates the owner presses the button again.
	 */
	private static function draft() {
		$draft = get_transient( self::DRAFT_TRANSIENT . get_current_user_id() );
		return is_array( $draft ) ? $draft : null;
	}

	private static function render_new_campaign_form() {
		$pages    = IE_Settings::target_pages();
		$draft    = self::draft();
		$prefill  = $draft ? $draft['form'] : array();
		$topics   = $draft ? $draft['topics'] : array();
		$warnings = $draft && ! empty( $draft['warnings'] ) ? $draft['warnings'] : array();

		$value = function ( $key, $default = '' ) use ( $prefill ) {
			return isset( $prefill[ $key ] ) ? $prefill[ $key ] : $default;
		};
		?>

		<?php if ( $warnings ) : ?>
			<div class="notice notice-warning inline">
				<p><strong><?php esc_html_e( 'Worth a look before you plan this:', 'interlink-engine' ); ?></strong></p>
				<ul style="list-style:disc;margin-left:1.5rem">
					<?php foreach ( $warnings as $warning ) : ?>
						<li><?php echo esc_html( $warning ); ?></li>
					<?php endforeach; ?>
				</ul>
			</div>
		<?php endif; ?>

		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<?php wp_nonce_field( 'ie_campaign_form' ); ?>

			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="ie_target"><?php esc_html_e( 'Page to rank', 'interlink-engine' ); ?></label></th>
					<td>
						<select name="target_page_id" id="ie_target" required>
							<option value=""><?php esc_html_e( 'Choose a page…', 'interlink-engine' ); ?></option>
							<?php foreach ( $pages as $id => $page ) : ?>
								<option value="<?php echo esc_attr( $id ); ?>" <?php selected( (int) $value( 'target_page_id' ), (int) $id ); ?>>
									<?php echo esc_html( $page['title'] ); ?>
								</option>
							<?php endforeach; ?>
						</select>
						<p class="description"><?php esc_html_e( 'Every post will link to it. Pick the page that books jobs, not a blog page.', 'interlink-engine' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="ie_keyword"><?php esc_html_e( 'Its search term', 'interlink-engine' ); ?></label></th>
					<td>
						<input name="keyword" id="ie_keyword" type="text" class="regular-text" required
							value="<?php echo esc_attr( $value( 'keyword' ) ); ?>" placeholder="water heater repair">
						<p class="description"><?php esc_html_e( 'What someone types to find that page. No post will be allowed to compete with it.', 'interlink-engine' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="ie_intent"><?php esc_html_e( 'What the reader should end up wanting', 'interlink-engine' ); ?></label></th>
					<td>
						<input name="intent" id="ie_intent" type="text" class="large-text"
							value="<?php echo esc_attr( $value( 'intent' ) ); ?>"
							placeholder="have an existing water heater repaired, rather than replaced">
						<p class="description"><?php esc_html_e( 'A sentence, not a keyword. This is what stops half the posts arguing for the opposite service.', 'interlink-engine' ); ?></p>
					</td>
				</tr>
			</table>

			<?php if ( $topics ) : ?>
				<h3><?php esc_html_e( 'Topics', 'interlink-engine' ); ?></h3>
				<p class="description"><?php esc_html_e( 'Edit anything. Untick one to leave it out. Order is publish order.', 'interlink-engine' ); ?></p>

				<table class="widefat striped" style="margin-bottom:1rem">
					<thead>
						<tr>
							<th style="width:2rem"></th>
							<th><?php esc_html_e( 'Topic', 'interlink-engine' ); ?></th>
							<th><?php esc_html_e( 'Search it should win', 'interlink-engine' ); ?></th>
							<th><?php esc_html_e( 'How other posts refer to it', 'interlink-engine' ); ?></th>
						</tr>
					</thead>
					<tbody>
					<?php foreach ( $topics as $i => $topic ) : ?>
						<tr>
							<td><input type="checkbox" name="use[<?php echo (int) $i; ?>]" value="1" checked></td>
							<td><input type="text" class="large-text" name="topic[<?php echo (int) $i; ?>]"
								value="<?php echo esc_attr( isset( $topic['topic'] ) ? $topic['topic'] : '' ); ?>"></td>
							<td><input type="text" class="regular-text" name="target_query[<?php echo (int) $i; ?>]"
								value="<?php echo esc_attr( isset( $topic['targetQuery'] ) ? $topic['targetQuery'] : '' ); ?>"></td>
							<td><input type="text" class="regular-text" name="link_phrase[<?php echo (int) $i; ?>]"
								value="<?php echo esc_attr( isset( $topic['linkPhrase'] ) ? $topic['linkPhrase'] : '' ); ?>"></td>
						</tr>
					<?php endforeach; ?>
					</tbody>
				</table>
			<?php else : ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="ie_topics"><?php esc_html_e( 'Your own topics', 'interlink-engine' ); ?></label></th>
						<td>
							<textarea name="topics" id="ie_topics" rows="8" class="large-text"
								placeholder="<?php esc_attr_e( 'One per line. Or leave empty and press Suggest topics.', 'interlink-engine' ); ?>"></textarea>
							<p class="description"><?php esc_html_e( 'Three to six months worth. Order is publish order.', 'interlink-engine' ); ?></p>
						</td>
					</tr>
				</table>
			<?php endif; ?>

			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="ie_cadence"><?php esc_html_e( 'One post every', 'interlink-engine' ); ?></label></th>
					<td>
						<input name="every_days" id="ie_cadence" type="number" min="1" max="90" class="small-text"
							value="<?php echo esc_attr( $value( 'every_days', 14 ) ); ?>">
						<?php esc_html_e( 'days, at', 'interlink-engine' ); ?>
						<input name="publish_time" type="time" value="<?php echo esc_attr( $value( 'publish_time', '09:00' ) ); ?>">
						<p class="description">
							<?php
							printf(
								/* translators: %s: the site's timezone */
								esc_html__( 'Local time (%s). Posts appearing at 3am is the clearest sign a blog is automated.', 'interlink-engine' ),
								esc_html( wp_timezone_string() )
							);
							?>
						</p>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Once the posts are written', 'interlink-engine' ); ?></th>
					<td>
						<label><input type="radio" name="publish_mode" value="future" <?php checked( 'draft' !== $value( 'publish_mode' ) ); ?>>
							<?php esc_html_e( 'Schedule them, and let WordPress publish each one on its day', 'interlink-engine' ); ?></label><br>
						<label><input type="radio" name="publish_mode" value="draft" <?php checked( 'draft' === $value( 'publish_mode' ) ); ?>>
							<?php esc_html_e( 'Save them all as drafts for me to review', 'interlink-engine' ); ?></label>
						<p class="description"><?php esc_html_e( 'Every post is written the day you approve the campaign. Scheduling is what spreads them out. Drafts are safer, but they depend on you showing up.', 'interlink-engine' ); ?></p>
					</td>
				</tr>
			</table>

			<p class="submit">
				<button type="submit" name="action" value="ie_suggest" class="button">
					<?php echo $topics
						? esc_html__( 'Suggest different topics', 'interlink-engine' )
						: esc_html__( 'Suggest topics for me', 'interlink-engine' ); ?>
				</button>

				<button type="submit" name="action" value="ie_create_campaign" class="button button-primary">
					<?php esc_html_e( 'Plan this campaign', 'interlink-engine' ); ?>
				</button>

				<?php if ( $topics ) : ?>
					<a class="button-link-delete" style="margin-left:1rem"
					   href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=ie_discard_draft' ), 'ie_discard_draft' ) ); ?>">
						<?php esc_html_e( 'Start over', 'interlink-engine' ); ?>
					</a>
				<?php endif; ?>
			</p>

			<p class="description">
				<?php esc_html_e( 'Suggesting topics is free. Nothing is charged until a post is actually written.', 'interlink-engine' ); ?>
			</p>
		</form>
		<?php
	}

	/* --------------------------------------------------------------------
	 * Handlers
	 * ----------------------------------------------------------------- */

	/** The shared part of both submit buttons: what the form said about the page. */
	private static function read_form() {
		$page_id = isset( $_POST['target_page_id'] ) ? (int) $_POST['target_page_id'] : 0;
		$page    = $page_id ? get_post( $page_id ) : null;

		if ( ! $page ) {
			return null;
		}

		return array(
			'target_page_id' => $page_id,
			'keyword'        => isset( $_POST['keyword'] ) ? sanitize_text_field( wp_unslash( $_POST['keyword'] ) ) : '',
			'intent'         => isset( $_POST['intent'] ) ? sanitize_text_field( wp_unslash( $_POST['intent'] ) ) : '',
			'every_days'     => isset( $_POST['every_days'] ) ? max( 1, min( 90, (int) $_POST['every_days'] ) ) : 14,
			'publish_time'   => isset( $_POST['publish_time'] ) ? sanitize_text_field( wp_unslash( $_POST['publish_time'] ) ) : '09:00',
			// Anything that is not an explicit 'draft' means schedule them. The
			// old value for that was 'publish'; reading it this way round means
			// a form posted by a cached page still does what the owner meant.
			'publish_mode'   => ( isset( $_POST['publish_mode'] ) && 'draft' === $_POST['publish_mode'] ) ? 'draft' : 'future',
			'title'          => get_the_title( $page ),
			'url'            => get_permalink( $page ),
		);
	}

	private static function target_page_payload( $form ) {
		return array(
			'url'     => $form['url'],
			'keyword' => $form['keyword'],
			'title'   => $form['title'],
			'intent'  => $form['intent'],
		);
	}

	public static function handle_suggest() {
		check_admin_referer( 'ie_campaign_form' );
		self::require_caps();

		$form = self::read_form();
		if ( ! $form ) {
			self::redirect( 'interlink-engine', 'error', __( 'Choose a page for the campaign to feed.', 'interlink-engine' ), array( 'tab' => 'new' ) );
		}

		// Topics already on screen are what NOT to propose again, so pressing
		// the button twice gives a different set rather than the same one.
		$draft = self::draft();
		$avoid = array();
		if ( $draft && ! empty( $draft['topics'] ) ) {
			$avoid = wp_list_pluck( $draft['topics'], 'topic' );
		}

		$result = IE_Api::suggest( self::target_page_payload( $form ), 6, $avoid );

		if ( is_wp_error( $result ) ) {
			self::redirect( 'interlink-engine', 'error', $result->get_error_message(), array( 'tab' => 'new' ) );
		}

		set_transient(
			self::DRAFT_TRANSIENT . get_current_user_id(),
			array(
				'form'     => $form,
				'topics'   => isset( $result['topics'] ) ? $result['topics'] : array(),
				'warnings' => isset( $result['warnings'] ) ? $result['warnings'] : array(),
			),
			DAY_IN_SECONDS
		);

		self::redirect( 'interlink-engine', 'suggested', '' );
	}

	public static function handle_create_campaign() {
		check_admin_referer( 'ie_campaign_form' );
		self::require_caps();

		$form = self::read_form();
		if ( ! $form ) {
			self::redirect( 'interlink-engine', 'error', __( 'Choose a page for the campaign to feed.', 'interlink-engine' ), array( 'tab' => 'new' ) );
		}

		$target_page = self::target_page_payload( $form );
		$topics      = self::collect_topics();

		if ( empty( $topics ) ) {
			self::redirect( 'interlink-engine', 'error', __( 'Add some topics, or press Suggest topics.', 'interlink-engine' ), array( 'tab' => 'new' ) );
		}

		// A topic typed by hand has no target query, and planning refuses one
		// without it. Derived here rather than leaving the owner to meet that
		// refusal cold.
		$missing = array_filter( $topics, function ( $t ) {
			return empty( $t['targetQuery'] );
		} );

		if ( $missing ) {
			$enriched = IE_Api::enrich(
				$target_page,
				wp_list_pluck( $missing, 'topic' ),
				array_values( array_filter( $topics, function ( $t ) {
					return ! empty( $t['targetQuery'] );
				} ) )
			);

			if ( is_wp_error( $enriched ) ) {
				self::redirect( 'interlink-engine', 'error', $enriched->get_error_message(), array( 'tab' => 'new' ) );
			}

			$by_topic = array();
			foreach ( (array) $enriched['topics'] as $t ) {
				$by_topic[ $t['topic'] ] = $t;
			}

			foreach ( $topics as $i => $t ) {
				if ( empty( $t['targetQuery'] ) && isset( $by_topic[ $t['topic'] ] ) ) {
					$topics[ $i ] = $by_topic[ $t['topic'] ];
				}
			}
		}

		$plan = IE_Api::plan( array(
			'name'       => $form['title'],
			'targetPage' => $target_page,
			'topics'     => array_values( $topics ),
			'linkMode'   => 'standalone',
			'schedule'   => array(
				'everyDays'   => $form['every_days'],
				'publishTime' => $form['publish_time'],
				// The server turns cadence plus wall-clock time into real
				// instants, and needs the zone to do it — 09:00 has to mean
				// nine in the morning where the business is.
				'timezone'    => wp_timezone_string(),
			),
		) );

		if ( is_wp_error( $plan ) ) {
			self::redirect( 'interlink-engine', 'error', $plan->get_error_message(), array( 'tab' => 'new' ) );
		}

		$campaign = IE_Campaigns::create_from_plan( $plan, array(
			'label'        => $form['title'],
			'every_days'   => $form['every_days'],
			'publish_mode' => $form['publish_mode'],
			'target_page'  => array(
				'id'      => $form['target_page_id'],
				'title'   => $form['title'],
				'url'     => $form['url'],
				'keyword' => $form['keyword'],
				'intent'  => $form['intent'],
			),
		) );

		if ( is_wp_error( $campaign ) ) {
			self::redirect( 'interlink-engine', 'error', $campaign->get_error_message(), array( 'tab' => 'new' ) );
		}

		delete_transient( self::DRAFT_TRANSIENT . get_current_user_id() );

		IE_Publisher::log( sprintf(
			'campaign %s planned: %d posts feeding "%s"',
			$campaign['id'], count( $campaign['slots'] ), $form['title']
		) );

		$note = '';
		if ( ! empty( $plan['warnings'] ) ) {
			$note = implode( ' · ', array_map( 'strval', (array) $plan['warnings'] ) );
		}
		if ( isset( $plan['enoughCredits'] ) && ! $plan['enoughCredits'] ) {
			// This used to say posts would "pause when the balance runs out",
			// which stopped being true when writing moved into one batch. The
			// server now refuses the whole run rather than writing four posts
			// and leaving a ring with a hole in it. Saying the old thing sets
			// someone up to approve a campaign expecting partial delivery.
			$note = trim( $note . ' ' . __( 'Not enough credits — top up before approving, or the whole batch will be refused.', 'interlink-engine' ) );
		}

		self::redirect( 'interlink-engine', 'planned', $note );
	}

	/**
	 * Topics from whichever form was on screen.
	 *
	 * The edit table when suggestions were shown, the textarea otherwise. The
	 * table carries the queries and link phrases already; the textarea gives
	 * bare lines that enrichment will complete.
	 */
	private static function collect_topics() {
		$topics = array();

		if ( ! empty( $_POST['topic'] ) && is_array( $_POST['topic'] ) ) {
			$use = isset( $_POST['use'] ) && is_array( $_POST['use'] ) ? $_POST['use'] : array();

			foreach ( $_POST['topic'] as $i => $raw ) {
				if ( ! isset( $use[ $i ] ) ) {
					continue;   // unticked
				}

				$topic = sanitize_text_field( wp_unslash( $raw ) );
				if ( '' === $topic ) {
					continue;
				}

				$topics[] = array(
					'topic'       => $topic,
					'targetQuery' => isset( $_POST['target_query'][ $i ] ) ? sanitize_text_field( wp_unslash( $_POST['target_query'][ $i ] ) ) : '',
					'linkPhrase'  => isset( $_POST['link_phrase'][ $i ] ) ? sanitize_text_field( wp_unslash( $_POST['link_phrase'][ $i ] ) ) : '',
				);
			}

			return $topics;
		}

		$raw = isset( $_POST['topics'] ) ? sanitize_textarea_field( wp_unslash( $_POST['topics'] ) ) : '';

		foreach ( array_filter( array_map( 'trim', preg_split( '/\R/', $raw ) ) ) as $line ) {
			$topics[] = array( 'topic' => $line, 'targetQuery' => '', 'linkPhrase' => '' );
		}

		return $topics;
	}

	public static function handle_discard_draft() {
		check_admin_referer( 'ie_discard_draft' );
		self::require_caps();

		delete_transient( self::DRAFT_TRANSIENT . get_current_user_id() );
		self::redirect( 'interlink-engine', 'discarded', '' );
	}

	/**
	 * Approve a campaign, or move it along.
	 *
	 * One button rather than one per slot, because there is no longer such a
	 * thing as writing a single post: the whole campaign is written in one
	 * batch. Pressing this repeatedly is safe — it starts the batch, then
	 * reports on it, then collects.
	 */
	public static function handle_run_now() {
		check_admin_referer( 'ie_run_now' );
		self::require_caps();

		$campaign_id = isset( $_GET['campaign'] ) ? sanitize_text_field( wp_unslash( $_GET['campaign'] ) ) : '';

		$result = IE_Publisher::run_campaign( $campaign_id );

		// Through redirect_error, not redirect: this is the one call that
		// spends money, so it is the one that can fail for want of it, and
		// that failure needs a way out rather than just a sentence.
		if ( is_wp_error( $result ) ) {
			self::redirect_error( 'interlink-engine', $result, 'drafts' );
		}

		// A stopped campaign. run_campaign() returns a skip rather than an
		// error, and the branches below would report "0 posts added" to
		// somebody who had just asked for posts. The button is hidden while a
		// campaign is stopped, so reaching here means a stale tab or a
		// bookmarked URL — which is exactly when a clear sentence matters.
		if ( ! empty( $result['skipped'] ) ) {
			self::redirect( 'interlink-engine', 'error', __( 'That campaign is stopped. Resume it first.', 'interlink-engine' ) );
		}

		// Still writing. Not a failure, and said plainly so nobody presses the
		// button again thinking nothing happened.
		if ( ! empty( $result['writing'] ) ) {
			self::redirect( 'interlink-engine', 'writing', sprintf(
				/* translators: 1: posts written so far, 2: total */
				__( '%1$d of %2$d written so far.', 'interlink-engine' ),
				(int) $result['done'], (int) $result['total']
			) );
		}

		self::redirect( 'interlink-engine', 'scheduled', sprintf(
			/* translators: %d: number of posts added to the site */
			_n( '%d post added.', '%d posts added.', (int) $result['inserted'], 'interlink-engine' ),
			(int) $result['inserted']
		) );
	}

	/**
	 * Publish one scheduled post immediately.
	 *
	 * For the owner who does not want to wait for a date — and, more usefully,
	 * for the site whose WP-Cron is not running. Everything downstream happens
	 * through IE_Publisher::on_transition() exactly as if cron had fired.
	 */
	public static function handle_publish_now() {
		check_admin_referer( 'ie_publish_now' );
		self::require_caps();

		$campaign_id = isset( $_GET['campaign'] ) ? sanitize_text_field( wp_unslash( $_GET['campaign'] ) ) : '';
		$slot_index  = isset( $_GET['slot'] ) ? (int) $_GET['slot'] : -1;

		$campaign = IE_Campaigns::get( $campaign_id );
		$found    = $campaign ? IE_Campaigns::find_slot( $campaign, $slot_index ) : null;

		if ( ! $found || empty( $found[1]['post_id'] ) ) {
			self::redirect( 'interlink-engine', 'error', __( 'That post could not be found.', 'interlink-engine' ) );
		}

		// publish_now(), not wp_publish_post(): this post is dated in the future
		// and the owner is choosing to publish it early, so the date has to move
		// to now — otherwise it goes live claiming to be from next Thursday.
		$result = IE_Publisher::publish_now( (int) $found[1]['post_id'] );

		if ( is_wp_error( $result ) ) {
			self::redirect( 'interlink-engine', 'error', $result->get_error_message() );
		}

		self::redirect( 'interlink-engine', 'published', '' );
	}

	/**
	 * Stop a campaign now.
	 *
	 * The wording on the button and in the confirmation says "stops publishing"
	 * rather than "pauses", because pausing a campaign sounds like it applies
	 * to the next post rather than to the eleven already sitting in the site
	 * with dates on them. Those are what the owner is actually trying to stop.
	 */
	public static function handle_pause_campaign() {
		check_admin_referer( 'ie_pause_campaign' );
		self::require_caps();

		$campaign_id = isset( $_GET['campaign'] ) ? sanitize_text_field( wp_unslash( $_GET['campaign'] ) ) : '';

		$held = IE_Publisher::pause( $campaign_id );

		if ( is_wp_error( $held ) ) {
			self::redirect( 'interlink-engine', 'error', $held->get_error_message() );
		}

		self::redirect( 'interlink-engine', 'paused', sprintf(
			/* translators: %d: number of scheduled posts held back as drafts */
			_n(
				'Campaign stopped. %d scheduled post was held as a draft.',
				'Campaign stopped. %d scheduled posts were held as drafts.',
				(int) $held,
				'interlink-engine'
			),
			(int) $held
		) );
	}

	public static function handle_resume_campaign() {
		check_admin_referer( 'ie_resume_campaign' );
		self::require_caps();

		$campaign_id = isset( $_GET['campaign'] ) ? sanitize_text_field( wp_unslash( $_GET['campaign'] ) ) : '';

		$released = IE_Publisher::resume( $campaign_id );

		if ( is_wp_error( $released ) ) {
			self::redirect( 'interlink-engine', 'error', $released->get_error_message() );
		}

		self::redirect( 'interlink-engine', 'resumed', sprintf(
			/* translators: %d: number of posts put back on the schedule */
			_n(
				'Campaign resumed. %d post is scheduled again, moved forward by the time it was stopped.',
				'Campaign resumed. %d posts are scheduled again, moved forward by the time it was stopped.',
				(int) $released,
				'interlink-engine'
			),
			(int) $released
		) );
	}

	public static function handle_delete_campaign() {
		check_admin_referer( 'ie_delete_campaign' );
		self::require_caps();

		$campaign_id = isset( $_GET['campaign'] ) ? sanitize_text_field( wp_unslash( $_GET['campaign'] ) ) : '';
		IE_Campaigns::delete( $campaign_id );

		self::redirect( 'interlink-engine', 'removed', '' );
	}

	/* --------------------------------------------------------------------
	 * Bits
	 * ----------------------------------------------------------------- */

	private static function require_caps() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You do not have permission to do that.', 'interlink-engine' ) );
		}
	}

	/**
	 * Which tab an outcome belongs on.
	 *
	 * Derived from the status here rather than spelled out at seventeen call
	 * sites, because the failure mode is silent and nasty: land "Suggest
	 * topics" on the wrong tab and the owner sees a success notice about
	 * topics they cannot see, on a screen that does not contain them. They
	 * would press it again, and pressing it again is the one free thing here
	 * that still costs the server an API call.
	 *
	 * A call site can still override by putting 'tab' in $extra — the error
	 * cases need that, because where an error belongs depends on what the
	 * person was doing, not on the word "error".
	 */
	private static function tab_for_status( $status ) {
		switch ( $status ) {
			case 'suggested':
			case 'discarded':
				return 'new';

			case 'planned':   // Planned but not approved: it is a draft.
			case 'credits':   // Approval refused for want of credits: still a draft.
				return 'drafts';

			default:
				return 'running';
		}
	}

	private static function redirect( $page, $status, $message, $extra = array() ) {
		// Only the campaigns screen has tabs. Adding one to the connection
		// page would be a stray argument that means nothing there.
		if ( 'interlink-engine' === $page && ! isset( $extra['tab'] ) ) {
			$extra['tab'] = self::tab_for_status( $status );
		}

		wp_safe_redirect( add_query_arg(
			array_merge(
				array(
					'page'       => $page,
					'ie_status'  => $status,
					'ie_message' => rawurlencode( $message ),
				),
				$extra
			),
			admin_url( 'admin.php' )
		) );
		exit;
	}

	/**
	 * Turn a failed API call into a redirect, with a way out where there is one.
	 *
	 * An out-of-credits failure is not like the others. Every other error here
	 * is something to report; this one is something to FIX, and the fix is on
	 * a different website that the owner is not currently looking at and may
	 * not know exists. The server sends the address; this carries it to the
	 * notice.
	 *
	 * Passed as a separate query argument rather than as markup inside the
	 * message, because notices() escapes the message as text — correctly, it
	 * carries server-supplied wording — and a link smuggled in there would be
	 * printed rather than clicked.
	 */
	private static function redirect_error( $page, $error, $tab = null ) {
		$data = is_wp_error( $error ) ? (array) $error->get_error_data() : array();
		$body = isset( $data['data'] ) && is_array( $data['data'] ) ? $data['data'] : array();

		$message = is_wp_error( $error ) ? $error->get_error_message() : (string) $error;

		$extra = ( null === $tab ) ? array() : array( 'tab' => $tab );

		if ( ! empty( $body['creditsError'] ) ) {
			// esc_url_raw, not esc_url: this is going into a redirect, not
			// into HTML. It is re-escaped at the point it becomes a link.
			if ( ! empty( $body['buyCreditsUrl'] ) ) {
				$extra['ie_buy'] = rawurlencode( esc_url_raw( $body['buyCreditsUrl'] ) );
			}

			self::redirect( $page, 'credits', $message, $extra );
		}

		self::redirect( $page, 'error', $message, $extra );
	}

	private static function notices() {
		if ( empty( $_GET['ie_status'] ) ) {
			return;
		}

		$status  = sanitize_text_field( wp_unslash( $_GET['ie_status'] ) );
		$message = isset( $_GET['ie_message'] ) ? sanitize_text_field( rawurldecode( wp_unslash( $_GET['ie_message'] ) ) ) : '';

		$map = array(
			'connected'    => array( 'success', __( 'Connected.', 'interlink-engine' ) ),
			'server_saved' => array( 'success', __( 'Server address saved. Your connection was left alone.', 'interlink-engine' ) ),
			'unchanged'    => array( 'info', __( 'Nothing to change — that is already the address.', 'interlink-engine' ) ),
			'suggested' => array( 'success', __( 'Here are some topics. Edit anything, untick what you do not want, then plan the campaign.', 'interlink-engine' ) ),
			// Does not name the button. The button carries the post count and
			// the price ("Write all 3 posts — 225 credits"), so any wording
			// here that tries to quote it goes stale the moment either changes
			// — which is exactly how this notice came to say "press Collect
			// now" while the button said something else entirely.
			'planned'   => array( 'success', __( 'Campaign planned and saved as a draft. Nothing has been charged yet — approve it below and every post is written at once.', 'interlink-engine' ) ),
			'scheduled' => array( 'success', __( 'Added to your site, dated. WordPress will publish them on their days, and the links switch on as each one goes live.', 'interlink-engine' ) ),
			'published' => array( 'success', __( 'Published, and every post waiting on it now links to it.', 'interlink-engine' ) ),
			// Says the true thing: there is nothing for the owner to do. The
			// server pings the site when the batch finishes and the posts
			// collect themselves. The old wording left people watching a
			// static page wondering when to press something.
			'writing'   => array( 'info', __( 'Writing your posts now — about a minute each. They will appear on their own; you do not need to do anything, and you can leave this page.', 'interlink-engine' ) ),
			'removed'   => array( 'success', __( 'Campaign removed. The posts it wrote are untouched.', 'interlink-engine' ) ),
			'discarded' => array( 'info', __( 'Draft topics discarded.', 'interlink-engine' ) ),
			'error'     => array( 'error', __( 'That did not work.', 'interlink-engine' ) ),
			// Deliberately not phrased as a failure. Nothing broke and nothing
			// was charged — the campaign is still sitting there as a draft,
			// waiting. Saying "that did not work" about a topped-up balance
			// away would read as a bug in the plugin.
			'credits'   => array( 'warning', __( 'Not enough credits to write this campaign.', 'interlink-engine' ) ),
		);

		if ( ! isset( $map[ $status ] ) ) {
			return;
		}

		list( $type, $text ) = $map[ $status ];

		// The one notice that carries somewhere to go.
		$link = '';
		if ( 'credits' === $status && ! empty( $_GET['ie_buy'] ) ) {
			$url = esc_url_raw( rawurldecode( wp_unslash( $_GET['ie_buy'] ) ) );

			// Only http(s), and only an address WordPress will accept as a
			// URL. This value arrived over the network, and a javascript: or
			// data: href printed into wp-admin would be a stored XSS against
			// an administrator — the highest-value target on the site.
			if ( $url && preg_match( '#^https?://#i', $url ) ) {
				$link = sprintf(
					' <a href="%s" target="_blank" rel="noopener noreferrer" class="button button-primary" style="margin-left:6px;">%s</a>',
					esc_url( $url ),
					esc_html__( 'Buy credits', 'interlink-engine' )
				);
			}
		}

		printf(
			'<div class="notice notice-%s is-dismissible"><p>%s%s%s</p></div>',
			esc_attr( $type ),
			esc_html( $text ),
			$message ? ' ' . esc_html( $message ) : '',
			$link // Built entirely from esc_url/esc_html above.
		);
	}

	private static function render_log() {
		$log = IE_Publisher::get_log();

		if ( empty( $log ) ) {
			echo '<p>' . esc_html__( 'Nothing yet.', 'interlink-engine' ) . '</p>';
			return;
		}

		echo '<table class="widefat striped"><tbody>';
		foreach ( array_slice( $log, 0, 15 ) as $entry ) {
			printf(
				'<tr><td style="width:12rem;color:#666">%s</td><td>%s</td></tr>',
				esc_html( $entry['at'] ),
				esc_html( $entry['message'] )
			);
		}
		echo '</tbody></table>';
	}
}
