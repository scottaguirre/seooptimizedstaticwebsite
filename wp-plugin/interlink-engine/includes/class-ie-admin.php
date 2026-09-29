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
	 * How many campaigns before the screen changes shape.
	 *
	 * Below this every campaign gets its own open card, which is the right
	 * screen for somebody with two or three. At and above it they fold into
	 * rows under the page they feed, and a filter box appears — because a
	 * wall of fifty identical cards is not a list, it is a haystack.
	 *
	 * ONE THRESHOLD FOR BOTH TABS. There used to be a second rule for the
	 * Completed tab — ten full cards a page, with a pager — written on the
	 * assumption that finished campaigns are a different kind of list. They
	 * are not. They are the SAME list, and the one that grows: a site running
	 * one campaign a fortnight has twenty-six finished in a year and nothing
	 * ever removes them, because the posts they wrote are the customer's and
	 * the record of what was charged has to survive.
	 */
	const GROUP_FROM = 4;

	/**
	 * How many topics one press of "Suggest topics" asks for.
	 *
	 * Twelve is the server's ceiling per request (routes/blogTopicsRoute.js
	 * clamps to 3..12). Asking for fewer than it will give just means more
	 * presses.
	 */
	const SUGGEST_BATCH = 12;

	/**
	 * The most topics one campaign may carry.
	 *
	 * A weekly post for a year. Every one becomes a post that costs credits
	 * on approval, so this is a spending limit as much as a layout one.
	 */
	const MAX_TOPICS = 52;

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_post_ie_connect', array( __CLASS__, 'handle_connect' ) );
		add_action( 'admin_post_ie_suggest', array( __CLASS__, 'handle_suggest' ) );
		add_action( 'admin_post_ie_review_topics', array( __CLASS__, 'handle_review_topics' ) );
		add_action( 'admin_post_ie_create_campaign', array( __CLASS__, 'handle_create_campaign' ) );
		add_action( 'admin_post_ie_run_now', array( __CLASS__, 'handle_run_now' ) );
		add_action( 'admin_post_ie_publish_now', array( __CLASS__, 'handle_publish_now' ) );
		add_action( 'admin_post_ie_pause_campaign', array( __CLASS__, 'handle_pause_campaign' ) );
		add_action( 'admin_post_ie_resume_campaign', array( __CLASS__, 'handle_resume_campaign' ) );
		add_action( 'admin_post_ie_delete_campaign', array( __CLASS__, 'handle_delete_campaign' ) );
		add_action( 'admin_post_ie_delete_drafts', array( __CLASS__, 'handle_delete_drafts' ) );
		add_action( 'admin_post_ie_repair_links', array( __CLASS__, 'handle_repair_links' ) );
		add_action( 'admin_post_ie_discard_draft', array( __CLASS__, 'handle_discard_draft' ) );
		add_action( 'admin_post_ie_check_deleted', array( __CLASS__, 'handle_check_deleted' ) );
	}

	/**
	 * Run the deleted-post reconciliation now, rather than waiting for cron.
	 *
	 * WHY THIS BUTTON HAS TO EXIST.
	 *
	 * The sweep rides on WP-Cron, and WP-Cron is not a timer — it fires when
	 * somebody loads a page. The server pings sites that have work in flight,
	 * and those pings fire it for free. But a site whose campaigns have all
	 * FINISHED has no work, so the server never knocks, and a finished site
	 * with no visitors may not run cron for weeks.
	 *
	 * That is precisely the site where this matters: posts get tidied up
	 * months after a campaign ends. So the one case the automatic path serves
	 * worst is the one where deletions actually happen, and the owner needs a
	 * way to say "look now" without being told to go and load their own home
	 * page.
	 */
	public static function handle_check_deleted() {
		check_admin_referer( 'ie_check_deleted' );
		self::require_caps();

		$swept  = IE_Publisher::sweep_deleted();
		$slots  = isset( $swept['slots'] ) ? (int) $swept['slots'] : 0;
		$gone   = isset( $swept['campaigns'] ) ? (int) $swept['campaigns'] : 0;
		$sent   = $slots + $gone;

		/* BACK TO THE TAB THEY PRESSED IT ON. Deleted posts turn up most
		 * often under Completed — a campaign that finished months ago whose
		 * posts have since been tidied — and dropping someone onto "In
		 * progress" after they asked a question about a finished campaign
		 * hides the answer they just asked for.
		 *
		 * Whitelisted rather than passed through: this value goes into a
		 * redirect URL. */
		$tab   = isset( $_GET['tab'] ) ? sanitize_key( wp_unslash( $_GET['tab'] ) ) : '';
		$extra = in_array( $tab, array( 'running', 'drafts', 'done', 'new' ), true )
			? array( 'tab' => $tab )
			: array();

		/* TWO DIFFERENT FINDINGS, REPORTED SEPARATELY.
		 *
		 *   $slots  campaigns still here whose posts have been deleted
		 *   $gone   campaigns removed from this site altogether, which the
		 *           server was still counting
		 *
		 * Both are "the record was wrong and is now right", but they are not
		 * the same news and adding them together would name a number that
		 * describes nothing. The counts are of CAMPAIGNS, not posts — "3
		 * updated" against 12 deleted posts would read as though nine had been
		 * missed — and the wording says so. */
		$parts = array();

		if ( $slots ) {
			$parts[] = sprintf(
				/* translators: %d: number of campaigns */
				_n(
					'%d campaign had posts that are no longer on this site',
					'%d campaigns had posts that are no longer on this site',
					$slots,
					'interlink-engine'
				),
				$slots
			);
		}

		if ( $gone ) {
			$parts[] = sprintf(
				/* translators: %d: number of campaigns */
				_n(
					'%d campaign that was removed from this site was still on record',
					'%d campaigns that were removed from this site were still on record',
					$gone,
					'interlink-engine'
				),
				$gone
			);
		}

		if ( $parts ) {
			self::redirect( 'interlink-engine', 'checked', sprintf(
				/* translators: %s: one or two findings, already joined */
				__( 'Checked. %s. Your record has been brought up to date.', 'interlink-engine' ),
				implode( ', and ', $parts )
			), $extra );
		}

		// NOT an error, and not silence either. "Nothing to report" is the
		// healthy answer, and a button that appears to do nothing when pressed
		// is one nobody presses twice.
		self::redirect( 'interlink-engine', 'checked',
			__( 'Checked. Every post these campaigns made is still on the site.', 'interlink-engine' ),
			$extra );
	}

	/**
	 * THE NAME ON SCREEN CHANGED; NOTHING ELSE DID.
	 *
	 * The plugin is "Three Comets Blog Generator" to the person using it. The
	 * menu SLUG is still 'interlink-engine', the folder is still
	 * interlink-engine/, the options are still ie_*, the classes are still
	 * IE_* and the text domain is still 'interlink-engine'.
	 *
	 * Every one of those is deliberate, and the reasons differ:
	 *
	 *   the folder   WordPress identifies a plugin by its directory. Rename it
	 *                and the next upload installs a SECOND plugin beside the
	 *                first, leaving the old one active and the new one
	 *                deactivated. On a customer's site that is silence, not an
	 *                error.
	 *
	 *   the options  ie_campaigns holds every campaign on the site. Rename the
	 *                key and the plugin wakes up believing it has never run.
	 *
	 *   the slug     admin.php?page=interlink-engine is in bookmarks, in this
	 *                file's own redirects, and in every link the server has
	 *                ever emailed.
	 *
	 * A display name is cheap to change. An identifier is not, and the two are
	 * only ever confused once.
	 */
	public static function menu() {
		add_menu_page(
			__( 'Three Comets Blog Generator', 'interlink-engine' ),
			/* THE SIDEBAR GETS THE BRAND, NOT THE FUNCTION.
			 *
			 * This label sits in a customer's wp-admin — often an agency's
			 * client, who never bought anything from us and never will. It is
			 * the one place the product's name is seen daily by someone who
			 * did not install it, so it says who made this rather than what
			 * it does. The page heading underneath carries the full name.
			 *
			 * It is also the practical choice: the sidebar is narrow, and
			 * anything much longer wraps to two lines. */
			__( 'Three Comets', 'interlink-engine' ),
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
							<?php
							/* THE ONE DELIBERATE ACT IN AN OTHERWISE SILENT DISASTER.
							 *
							 * A licence key used on a second WordPress issues that site a
							 * fresh secret and leaves the first holding a dead one. The
							 * first site does not fail loudly — it fails invisibly, every
							 * call refused, for as long as nobody reads a report closely.
							 * Eight days, on the site this was written for.
							 *
							 * The server refuses to do it without this box ticked, and its
							 * refusal names the site that would be disconnected. So the
							 * box is never the first anyone hears of it: it is the second
							 * step, after being told exactly what it costs. */
							?>
							<p style="margin-top:.6rem">
								<label for="ie_move">
									<input type="checkbox" name="move_licence" id="ie_move" value="1">
									<?php esc_html_e( 'This licence is moving from another site', 'interlink-engine' ); ?>
								</label>
							</p>
							<p class="description" style="margin-top:0">
								<?php esc_html_e( 'Only tick this if you want the other site disconnected. Two sites cannot share one licence key — the second one to connect takes it, and the first stops publishing.', 'interlink-engine' ); ?>
							</p>
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

		/* Ticked only when the owner has been told what it costs. The server
		 * refuses a licence already registered elsewhere without it, and says
		 * which site it would disconnect — so the box is never the first time
		 * anyone hears about the other site. */
		$moving = ! empty( $_POST['move_licence'] );

		$result = IE_Api::activate( $key, $server, $moving );

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
			/* WHICH TAB, AND WHICH BUTTONS, NOW ASK THE SAME FUNCTION.
			 *
			 * This rule used to live here and nowhere else, so the card had no
			 * idea it was being rendered on the Completed tab. A finished
			 * campaign was still offered "Pause campaign" — which set its
			 * status to paused, held nothing back because there was nothing to
			 * hold, and left Three Comets recording a finished campaign as
			 * paused. IE_Campaigns::is_finished() carries the rule now,
			 * including why a cancelled campaign counts as finished whatever
			 * its slots still say. */
			if ( empty( $campaign['batch_started'] ) ) {
				$out['drafts'][] = $campaign;
			} elseif ( IE_Campaigns::is_finished( $campaign ) ) {
				$out['done'][] = $campaign;
			} else {
				$out['running'][] = $campaign;
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

			self::render_check_deleted( $tab, $campaigns );
			?>
		</div>
		<?php
	}

	/**
	 * "Check for deleted posts", at the foot of the screen.
	 *
	 * WHY A BUTTON AND NOT JUST THE HOURLY SWEEP.
	 *
	 * The sweep rides on WP-Cron, and WP-Cron fires when somebody loads a
	 * page rather than on a clock. Sites with a campaign in flight get pinged
	 * by the server every few minutes and so run it constantly, for free. A
	 * site whose campaigns have all FINISHED is never pinged — there is no
	 * work — so on a site with no visitors the sweep may not run for weeks.
	 *
	 * That is exactly the site where it matters. Posts get tidied up long
	 * after a campaign ends, which means the automatic path serves its most
	 * important case worst. Rather than tell an owner to go and load their own
	 * home page, there is a button.
	 *
	 * AT THE FOOT, AND QUIET. It answers a question somebody already has —
	 * "does this list still match my site?" — rather than announcing a problem
	 * nobody has. Putting it at the top would imply the screen is not to be
	 * trusted until you press it, which is the opposite of what it is for.
	 *
	 * Hidden on the "New campaign" tab, where there is nothing to check yet.
	 */
	private static function render_check_deleted( $tab, $campaigns ) {
		if ( 'new' === $tab || empty( $campaigns ) ) {
			return;
		}

		$url = wp_nonce_url(
			admin_url( 'admin-post.php?action=ie_check_deleted&tab=' . rawurlencode( $tab ) ),
			'ie_check_deleted'
		);
		?>
		<p style="margin-top:2rem">
			<a href="<?php echo esc_url( $url ); ?>" class="button">
				<?php esc_html_e( 'Check for deleted posts', 'interlink-engine' ); ?>
			</a>
		</p>
		<p class="description" style="margin-top:-.5rem">
			<?php esc_html_e( 'Compares this list against the posts actually on your site. It runs on its own every hour, but a site with no visitors may not get round to it.', 'interlink-engine' ); ?>
		</p>

		<?php
		/* REPAIR LINKS, and it is here rather than on a campaign card because
		 * the campaigns it helps most no longer have cards.
		 *
		 * Until 0.8.1, removing a campaign stopped its links ever being built:
		 * the posts still published, but the placeholders waiting on them
		 * stayed placeholders. That fix works at the moment a post publishes,
		 * so it does nothing for posts that published before it. Those
		 * placeholders are frozen — invisible on the page, and permanent. */
		$repair_url = wp_nonce_url(
			admin_url( 'admin-post.php?action=ie_repair_links&tab=' . rawurlencode( $tab ) ),
			'ie_repair_links'
		);
		?>
		<p style="margin-top:1.5rem">
			<a href="<?php echo esc_url( $repair_url ); ?>" class="button">
				<?php esc_html_e( 'Repair internal links', 'interlink-engine' ); ?>
			</a>
		</p>
		<p class="description" style="margin-top:-.5rem">
			<?php esc_html_e( 'Finds links between your posts that were never switched on, and switches them on. Safe to run more than once.', 'interlink-engine' ); ?>
		</p>
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
			// "Campaigns needing approval", not "Waiting for you". The old
			// label said something was owed but never what — and the thing a
			// person most needs to know before clicking is that approving is
			// the moment credits are spent.
			'drafts'  => __( 'Campaigns needing approval', 'interlink-engine' ),
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

		/* GROUPED BY THE PAGE THEY FEED, AND FOLDED, ONCE THERE ARE ENOUGH.
		 *
		 * Every campaign rendered a full card — heading, schedule table,
		 * buttons — one after another. At three that reads well. At fifty it
		 * is a page nobody can navigate: the campaign you came for is a
		 * thousand pixels down a wall of identical boxes, and the only way to
		 * find it is Cmd-F.
		 *
		 * Campaigns are not an unordered list. Each one feeds ONE page, and
		 * several campaigns feeding the same page are the thing an owner
		 * actually reasons about — "how am I doing on slab leak detection"
		 * rather than "what was campaign number thirty-one". So they group by
		 * the page, and the page's name is the heading.
		 *
		 * Below the threshold none of this appears: a fold and a filter over
		 * two campaigns is furniture, and the screen stays exactly as it was
		 * for anybody who is not drowning. */
		$grouped = count( $running ) >= self::GROUP_FROM;

		if ( ! $grouped ) {
			foreach ( $running as $campaign ) {
				self::render_campaign_card( $campaign, $collapse );
			}

			if ( count( $running ) > 1 ) {
				self::render_upcoming();
			}

			return;
		}

		self::render_folded_groups( $running );

		/* Below the campaigns, not above: it describes them. ONCE — this stood
		 * as an unconditional call followed by an `if ( count > 1 )` call, and
		 * the grouped path only runs at four or more, so "Coming up" was drawn
		 * twice on every screen the fold was built for. */
		self::render_upcoming();
	}

	/**
	 * Campaigns as one flat, numbered list of one-line rows, with a box that
	 * filters them.
	 *
	 * SHARED BY BOTH TABS, and it was not. This was written inside the In
	 * progress tab for the fifty-campaign problem, and the Completed tab —
	 * which is the one that only ever GROWS — was left paging through full
	 * cards ten at a time. So the tab that empties itself got the treatment
	 * and the tab that accumulates did not, which is exactly backwards.
	 *
	 * Pagination went with it. A folded row is one line: fifty of them is a
	 * screen you can scan, and the filter box finds a campaign faster than
	 * remembering it was on page three.
	 *
	 * THE MONEY-PAGE HEADINGS ARE GONE, and the grouping is not.
	 *
	 * Campaigns are usually named after the page they feed, so each heading
	 * read "Toilet Replacement Services — 1 campaign" directly above a row
	 * reading "Toilet Replacement Services — 4 of 4 scheduled, 4 live". At
	 * fifty campaigns that is fifty headings and fifty rows: a hundred lines
	 * to say fifty things, on the screen built to stop exactly that.
	 *
	 * So the heading went and by_money_page() stayed, for ORDER alone —
	 * campaigns feeding one page still sit together, which was the useful
	 * half. The page is named on the row itself only when it differs from the
	 * campaign's own name, so nothing is lost and nothing is said twice.
	 *
	 * NUMBERED 1..N STRAIGHT THROUGH, so a number is a name somebody can say
	 * out loud. That only works while it is stable: it is why there is no
	 * pagination (a number that depends on which page you are on is not a
	 * reference) and why it counts across groups rather than restarting.
	 */
	private static function render_folded_groups( $campaigns ) {
		self::render_campaign_filter( count( $campaigns ) );

		$n = 0;
		?>
		<div class="ie-campaign-list">
		<?php
		foreach ( self::by_money_page( $campaigns ) as $group ) {
			foreach ( $group['campaigns'] as $campaign ) {
				$n++;
				$label    = IE_Campaigns::label_of( $campaign );
				$headline = self::campaign_headline( $campaign );

				/* Only when it adds something. Compared loosely — trimmed and
				 * case-folded — because "Slab Leak Detection" and "slab leak
				 * detection" are the same words, and printing the second after
				 * the first is the duplication this change removed. */
				$page = ( '' !== $group['title']
					&& strtolower( trim( $group['title'] ) ) !== strtolower( trim( $label ) ) )
					? $group['title']
					: '';
				?>
				<details class="ie-campaign-fold"
				         data-ie-search="<?php echo esc_attr( strtolower(
					         $label . ' ' . $group['title']
				         ) ); ?>"
				         style="margin-bottom:.4rem;border:1px solid #dcdcde;background:#fff;border-radius:4px">
					<summary style="padding:.6rem .9rem;cursor:pointer">
						<span class="ie-row-num"><?php echo esc_html( $n ); ?>.</span>
						<strong><?php echo esc_html( $label ); ?></strong>
						<span style="color:#666"> — <?php echo esc_html( $headline ); ?></span>
						<?php if ( $page ) : ?>
							<span style="color:#787c82"> · <?php echo esc_html( sprintf(
								/* translators: %s: the page this campaign's posts link to */
								__( 'feeds %s', 'interlink-engine' ),
								$page
							) ); ?></span>
						<?php endif; ?>
					</summary>
					<?php self::render_campaign_card( $campaign, true, true ); ?>
				</details>
				<?php
			}
		}
		?>
		</div>
		<?php
	}

	/**
	 * Campaigns, gathered under the page each one feeds.
	 *
	 * FOR ORDER, NOT FOR HEADINGS, since the headings went. Campaigns feeding
	 * one page still come out adjacent, which was the half of grouping worth
	 * having; what went was printing the page's name above a row that already
	 * carried it.
	 *
	 * Keyed by the money page's URL rather than its name: two pages can share
	 * a title, and the URL is the thing that makes them the same page. Merging
	 * on title would interleave two different pages' campaigns and the row
	 * numbers would run through both as if they belonged together.
	 *
	 * Insertion order is kept, so the newest campaign's page leads — the list
	 * arrives sorted and this must not undo that.
	 */
	private static function by_money_page( $campaigns ) {
		$groups = array();

		foreach ( $campaigns as $campaign ) {
			$url = isset( $campaign['target_page']['url'] ) ? (string) $campaign['target_page']['url'] : '';

			$title = isset( $campaign['target_page']['title'] ) && $campaign['target_page']['title']
				? (string) $campaign['target_page']['title']
				: ( $url ? $url : __( 'No page', 'interlink-engine' ) );

			if ( ! isset( $groups[ $url ] ) ) {
				$groups[ $url ] = array( 'title' => $title, 'url' => $url, 'campaigns' => array() );
			}

			$groups[ $url ]['campaigns'][] = $campaign;
		}

		return array_values( $groups );
	}

	/**
	 * A box that hides the rows that do not match what is typed.
	 *
	 * IN THE BROWSER, not a form submit. Filtering a list you are looking at
	 * should not cost a page load, lose your scroll position, or fold every
	 * campaign you had opened. There is no server round trip to make: the
	 * rows are already here.
	 *
	 * Degrades to nothing without JavaScript — the box simply does nothing
	 * and every campaign is still on the page, which is the right failure.
	 */
	private static function render_campaign_filter( $total ) {
		?>
		<p style="margin:0 0 .5rem">
			<label>
				<span class="screen-reader-text"><?php esc_html_e( 'Filter campaigns', 'interlink-engine' ); ?></span>
				<input type="search" id="ie-campaign-filter" class="regular-text"
				       placeholder="<?php echo esc_attr( sprintf(
					       /* translators: %d: how many campaigns are running */
					       __( 'Filter %d campaigns by name or page…', 'interlink-engine' ),
					       $total
				       ) ); ?>">
			</label>
		</p>
		<script>
		( function () {
			var box = document.getElementById( 'ie-campaign-filter' );
			if ( ! box ) { return; }

			box.addEventListener( 'input', function () {
				var want = box.value.trim().toLowerCase();

				/* THE NUMBERS DO NOT RENUMBER, and that is the point. Filtering
				 * to three rows leaves them reading 7, 19 and 31, because the
				 * number names the campaign rather than its position — and a
				 * name that changes when you type in a box is not a name. The
				 * rows keep their numbers whatever is hidden. */
				document.querySelectorAll( '.ie-campaign-fold' ).forEach( function ( row ) {
					var hit = ! want || ( row.dataset.ieSearch || '' ).indexOf( want ) !== -1;
					row.style.display = hit ? '' : 'none';
				} );
			} );
		}() );
		</script>
		<?php
	}

	private static function render_drafts_tab( $drafts ) {
		if ( empty( $drafts ) ) {
			?>
			<p><?php esc_html_e( 'Nothing needs approval. A campaign appears here once it is planned, and stays until you approve it.', 'interlink-engine' ); ?></p>
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
	 * Finished campaigns.
	 *
	 * FOLDED AND FILTERED, exactly like In progress, and this tab needs it
	 * more. In progress empties itself as campaigns finish; THIS list only
	 * ever grows, so it is the one that reaches fifty. It spent that whole
	 * time paging through full cards ten at a time, which is how a screen
	 * built for the fifty-campaign problem ended up on the only tab that
	 * never has fifty campaigns on it.
	 *
	 * The pager went with the cards. It was there because "62 finished
	 * campaigns" as 62 full cards is unusable — true, and the answer is to
	 * stop drawing 62 full cards. As one-line rows they fit on a screen you
	 * can scan, and the filter box finds one faster than remembering which
	 * page it was on. Any old ?paged= bookmark now simply shows everything,
	 * which is the right failure.
	 *
	 * Below the fold threshold nothing changes: a handful of finished
	 * campaigns still open as cards, same as a handful of running ones.
	 */
	private static function render_done_tab( $done ) {
		if ( empty( $done ) ) {
			?>
			<p><?php esc_html_e( 'No campaigns have finished yet. One arrives here when its last post goes live.', 'interlink-engine' ); ?></p>
			<?php
			return;
		}

		$total = count( $done );
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
			</div>
		</div>

		<?php
		if ( $total >= self::GROUP_FROM ) {
			self::render_folded_groups( $done );
			return;
		}

		foreach ( $done as $campaign ) {
			self::render_campaign_card( $campaign, true );
		}
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
			/* RIGHT-ALIGNED IN A FIXED WIDTH, so 9 and 10 put their last digit
			   in the same column and the names below them start in one line
			   rather than stepping right at every tenth row. Tabular figures
			   for the same reason. */
			.ie-row-num{display:inline-block;min-width:2.2em;margin-right:.35rem;
				color:#787c82;font-weight:600;text-align:right;
				font-variant-numeric:tabular-nums}
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
			/* GREY, NOT RED. "Post deleted" is usually the owner's own doing
			   and needs no alarm — and it must not look like Overdue, which
			   is the alarm and means something entirely different. */
			.ie-pill-gone{color:#50575e;background:#e9eaec}
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
						<?php
						/* NOT A LINK WHEN THE POST IS GONE.
						 *
						 * get_edit_post_link() returns null for a post that
						 * does not exist, esc_url( null ) is '', and the row
						 * then rendered <a href="">Topic</a> — a link that
						 * looks live, and reloads the same page when clicked.
						 * Somebody clicking it learns nothing at all, which is
						 * worse than it plainly not being clickable. */
						?>
						<?php if ( $row['post_id'] && empty( $row['deleted'] ) ) : ?>
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
						<?php if ( ! empty( $row['deleted'] ) ) : ?>
							<?php /* Checked FIRST. A deleted post must never reach the
							        Overdue branch below, which is the WP-Cron alarm. */ ?>
							<span class="ie-pill ie-pill-gone"
							      title="<?php esc_attr_e( 'The post this row refers to no longer exists on this site. It was deleted, or moved to Trash. Nothing will publish for it.', 'interlink-engine' ); ?>"><?php esc_html_e( 'Post deleted', 'interlink-engine' ); ?></span>
						<?php elseif ( $row['overdue'] ) : ?>
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

	/**
	 * The one line that describes a campaign.
	 *
	 * ONE DEFINITION, because it is now read in two places: the card's own
	 * heading, and the fold summary that stands in for the card when there
	 * are too many to show at once. Two copies of a sentence this loaded —
	 * scheduled, live, deleted, and what the campaign is doing — would come
	 * to disagree, and the summary is the one people read first.
	 */
	private static function campaign_headline( $campaign ) {
		$scheduled = 0;
		$live      = 0;
		$gone      = 0;

		foreach ( $campaign['slots'] as $slot ) {
			if ( IE_Campaigns::post_missing( $slot ) ) {
				$gone++;
				continue;
			}

			if ( 'published' === $slot['status'] ) {
				$live++;
				$scheduled++;
			} elseif ( 'scheduled' === $slot['status'] ) {
				$scheduled++;
			}
		}

		/* ORDER MATTERS, MOST SPECIFIC FIRST.
		 *
		 * A deleted post is the fact that explains a missing link, so it wins
		 * over everything. Then cancelled, then finished — a campaign that has
		 * nothing left to publish is not "publishing on schedule", and saying
		 * so on the Completed tab put a present tense on six campaigns that
		 * had all finished weeks earlier. Only then the present-tense words,
		 * which now only ever describe a campaign that really is still going. */
		if ( $gone ) {
			$state = sprintf(
				/* translators: %d: how many of this campaign's posts no longer exist */
				_n( '%d post deleted', '%d posts deleted', $gone, 'interlink-engine' ),
				$gone
			);
		} elseif ( isset( $campaign['status'] ) && 'cancelled' === $campaign['status'] ) {
			$state = __( 'cancelled — the rest was never written', 'interlink-engine' );
		} elseif ( IE_Campaigns::is_finished( $campaign ) ) {
			$state = __( 'finished', 'interlink-engine' );
		} else {
			$state = 'draft' === $campaign['publish_mode']
				? __( 'saving as drafts', 'interlink-engine' )
				: __( 'publishing on schedule', 'interlink-engine' );
		}

		return sprintf(
			/* translators: 1: posts on the site, 2: total, 3: how many are public, 4: what it is doing */
			__( '%1$d of %2$d scheduled, %3$d live, %4$s', 'interlink-engine' ),
			$scheduled, count( $campaign['slots'] ), $live, $state
		);
	}

	private static function render_campaign_card( $campaign, $collapse = false, $folded = false ) {
		/* The counting that used to live here moved into campaign_headline(),
		 * which the heading now calls. All the card still needs for itself is
		 * whether ANY post has gone missing, because that turns on a warning
		 * the headline has no room to explain. */
		$gone = 0;

		foreach ( $campaign['slots'] as $slot ) {
			if ( IE_Campaigns::post_missing( $slot ) ) {
				$gone++;
			}
		}

		/* FINISHED CAMPAIGNS GET NO RUNNING CONTROLS, and that is not a
		 * cosmetic rule. "Pause campaign" on a campaign with nothing left to
		 * publish held nothing back, said "0 scheduled posts were held as
		 * drafts", and set the status to paused anyway — which the sweep then
		 * reported to Three Comets, turning a completed campaign into a paused
		 * one in the blog report. Same for Resume: releasing nothing, it would
		 * push the campaign back to active for the server to settle again. */
		$finished = IE_Campaigns::is_finished( $campaign );

		$orphans = IE_Campaigns::orphans( $campaign );
		?>
		<div class="card" style="max-width:none;padding:1rem 1.25rem;margin-bottom:1.25rem<?php echo $folded ? ';border:0;box-shadow:none;margin:0' : ''; ?>">
			<?php if ( ! $folded ) : ?>
			<?php /* THE SAME SENTENCE, FROM THE SAME FUNCTION, AND IT WAS NOT.
			        *
			        * The fold summary calls campaign_headline(). This heading
			        * used to build the identical sentence inline from its own
			        * copy of the counting loop — two implementations agreeing
			        * only by luck, and the comment here claimed they were one.
			        * They stopped agreeing the moment campaign_headline()
			        * learned the word "finished": folded campaigns said it and
			        * open ones, which is what the Completed tab renders, went
			        * on saying "publishing on schedule".
			        *
			        * Printing BOTH puts the same sentence on screen twice, half
			        * a centimetre apart, which is why this is behind $folded. */ ?>
			<h2 style="margin-top:0">
				<?php echo esc_html( IE_Campaigns::label_of( $campaign ) ); ?>
				<span style="font-weight:400;color:#666">
					— <?php echo esc_html( self::campaign_headline( $campaign ) ); ?>
				</span>
			</h2>
			<?php endif; ?>

			<?php if ( $gone ) : ?>
				<?php
				/* THE EXPLANATION, ONCE, IN PLAIN WORDS.
				 *
				 * A pill on a row says what is true; this says what to do
				 * about it. Without it the owner knows a post is gone and
				 * still has no idea whether the campaign is broken, whether
				 * they were charged again, or what to press. */
				?>
				<div class="notice notice-warning inline" style="margin:.5rem 0 1rem">
					<p style="margin:.5rem 0">
						<strong><?php esc_html_e( 'Some of this campaign’s posts are no longer on the site.', 'interlink-engine' ); ?></strong>
						<?php esc_html_e( 'They were deleted, or moved to Trash. Nothing further will publish for those rows, and this is not a fault with the schedule — the rest of the campaign is unaffected.', 'interlink-engine' ); ?>
					</p>
					<p style="margin:.5rem 0">
						<?php esc_html_e( 'If you deleted them on purpose, use “Remove campaign” to clear the record. If it was a mistake, check Trash — a restored post keeps its place here.', 'interlink-engine' ); ?>
					</p>
				</div>
			<?php endif; ?>

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
					<?php $slot_gone = IE_Campaigns::post_missing( $slot ); ?>
					<tr>
						<td>
							<?php // Not a link when there is nothing behind it — see the same guard in "Coming up". ?>
							<?php if ( $slot['post_id'] && ! $slot_gone ) : ?>
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
							/* Deleted is checked BEFORE the stored status, because
							 * the stored status is exactly what cannot be trusted
							 * once the post is gone: it still says 'published' or
							 * 'scheduled' and will say so forever. */
							if ( $slot_gone ) :
								?>
								<span class="ie-pill ie-pill-gone"
								      title="<?php esc_attr_e( 'The post this row refers to no longer exists on this site. It was deleted, or moved to Trash. Nothing will publish for it.', 'interlink-engine' ); ?>"><?php esc_html_e( 'Post deleted', 'interlink-engine' ); ?></span>
							<?php elseif ( 'published' === $slot['status'] ) : ?>
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
							<?php
							/* AND NOT WHEN THE POST IS GONE.
							 *
							 * $slot['status'] still says 'scheduled' for a
							 * deleted post — that stored status is exactly what
							 * stops being true — so gating on it alone offered
							 * "Publish early" on six rows with nothing behind
							 * them. Pressing it would have reported success:
							 * wp_update_post() on a missing id returns 0 rather
							 * than a WP_Error, so the handler's is_wp_error()
							 * check waves it straight through. */
							?>
							<?php if ( 'scheduled' === $slot['status'] && ! $slot_gone ) : ?>
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
			 * A paused campaign offers neither button.
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

				<?php if ( $finished ) : ?>
					<?php
					/* NOTHING TO PAUSE AND NOTHING TO RESUME. Said plainly,
					 * because a row of buttons with a gap where two of them
					 * used to be reads as a screen that failed to load. */
					?>
					<span class="description">
						<?php
						echo esc_html( IE_Campaigns::is_paused( $campaign ) || ( isset( $campaign['status'] ) && 'cancelled' === $campaign['status'] )
							? __( 'This campaign is closed out. Nothing further will publish.', 'interlink-engine' )
							: __( 'Every post in this campaign has published. There is nothing left to schedule.', 'interlink-engine' ) );
						?>
					</span>
				<?php elseif ( IE_Campaigns::is_paused( $campaign ) ) : ?>
					<a class="button button-primary"
					   href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=ie_resume_campaign&campaign=' . rawurlencode( $campaign['id'] ) ), 'ie_resume_campaign' ) ); ?>">
						<?php esc_html_e( 'Resume campaign', 'interlink-engine' ); ?>
					</a>
					<span class="description">
						<?php esc_html_e( 'Held posts go back on the schedule, each moved forward by however long the campaign was paused.', 'interlink-engine' ); ?>
					</span>

					<?php
					/* THE BUTTON FOR THE COMMON CASE, and the reason "Remove
					 * campaign" no longer has to be two things at once.
					 *
					 * Pausing a campaign and deciding the rest of it is wrong
					 * is ordinary. Doing it by hand means finding eight drafts
					 * among however many posts the site has, and being sure
					 * none of them is something else. This touches only the
					 * posts that have not published, so the worst it can do is
					 * bin content nobody has ever read — and even that goes to
					 * Trash. */
					$ie_held = IE_Publisher::count_campaign_posts( $campaign['id'] );
					?>
					<?php if ( $ie_held['drafts'] > 0 ) : ?>
						<a class="button"
						   href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=ie_delete_drafts&campaign=' . rawurlencode( $campaign['id'] ) ), 'ie_delete_drafts' ) ); ?>"
						   onclick="return confirm('<?php echo esc_js( sprintf(
								/* translators: %d: number of unpublished posts */
								_n(
									'Send %d post that has not published to Trash? Posts already on your site stay exactly where they are.',
									'Send %d posts that have not published to Trash? Posts already on your site stay exactly where they are.',
									$ie_held['drafts'],
									'interlink-engine'
								),
								$ie_held['drafts']
							) ); ?>')">
							<?php echo esc_html( sprintf(
								/* translators: %d: number of unpublished posts */
								_n( 'Delete the %d remaining draft', 'Delete the %d remaining drafts', $ie_held['drafts'], 'interlink-engine' ),
								$ie_held['drafts']
							) ); ?>
						</a>
						<span class="description">
							<?php esc_html_e( 'The published articles stay on your site.', 'interlink-engine' ); ?>
						</span>
					<?php endif; ?>
				<?php else : ?>
					<a class="button"
					   href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=ie_pause_campaign&campaign=' . rawurlencode( $campaign['id'] ) ), 'ie_pause_campaign' ) ); ?>"
					   onclick="return confirm('<?php echo esc_js( __( 'Pause this campaign? Scheduled posts are held back as drafts and nothing new is written. Posts already published stay up.', 'interlink-engine' ) ); ?>')">
						<?php esc_html_e( 'Pause campaign', 'interlink-engine' ); ?>
					</a>
				<?php endif; ?>

				<?php
				/* REMOVE MEANS REMOVE NOW, AND IT DID NOT USED TO.
				 *
				 * It deleted the plugin's record and left every post where it
				 * was — so a campaign "removed" halfway went on publishing on
				 * schedule, and its old confirmation said so: "Posts already
				 * written stay exactly where they are." That is not what
				 * anybody presses this for. The reason to remove a campaign is
				 * that its articles were wrong; a button that keeps the wrong
				 * articles and only forgets how to manage them is the one
				 * outcome nobody wanted.
				 *
				 * Keeping the published posts is now Pause campaign, plus the
				 * button above for the drafts. This one does the other thing,
				 * properly, and says exactly what it is about to do.
				 *
				 * TWO DIALOGS, NOT A CHECKBOX. A checkbox left unticked is a
				 * destructive action that quietly did not happen — the user
				 * walks away believing the articles are gone. Both dialogs name
				 * the same counts, so the second is a real second look rather
				 * than a formality. Counted at RENDER time for the wording and
				 * again at DELETION time for the work, because the numbers in
				 * a dialog are a claim and the numbers in the bin are a fact. */
				$ie_doomed = IE_Publisher::count_campaign_posts( $campaign['id'] );

				$ie_what = sprintf(
					/* translators: 1: number of published articles, 2: number of unpublished posts */
					__( '%1$s and %2$s', 'interlink-engine' ),
					sprintf(
						/* translators: %d: number of published articles */
						_n( '%d published article', '%d published articles', $ie_doomed['published'], 'interlink-engine' ),
						$ie_doomed['published']
					),
					sprintf(
						/* translators: %d: number of unpublished posts */
						_n( '%d draft', '%d drafts', $ie_doomed['drafts'], 'interlink-engine' ),
						$ie_doomed['drafts']
					)
				);

				$ie_first = sprintf(
					/* translators: 1: campaign name, 2: e.g. "4 published articles and 8 drafts" */
					__( 'Remove "%1$s"? This moves %2$s to Trash. You can restore them from Trash for 30 days.', 'interlink-engine' ),
					/* STRIPPED, because this ends up inside an onclick attribute.
					 * esc_js() escapes quotes and ampersands but leaves < and >
					 * alone — correct for a JS string, and it still puts a raw
					 * "<script>" into the page when a campaign is labelled with
					 * one. Harmless where it lands, and not something to leave
					 * lying around in a page this plugin renders. The label is a
					 * name; it has no business carrying markup. */
					wp_strip_all_tags( IE_Campaigns::label_of( $campaign ) ),
					$ie_what
				);

				$ie_second = sprintf(
					/* translators: %s: e.g. "4 published articles and 8 drafts" */
					__( 'Are you sure you want to send %s to Trash?', 'interlink-engine' ),
					$ie_what
				);
				?>
				<a class="button-link-delete" style="margin-left:auto"
				   href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=ie_delete_campaign&campaign=' . rawurlencode( $campaign['id'] ) ), 'ie_delete_campaign' ) ); ?>"
				   onclick="return confirm('<?php echo esc_js( $ie_first ); ?>') && confirm('<?php echo esc_js( $ie_second ); ?>')">
					<?php esc_html_e( 'Remove campaign and its articles', 'interlink-engine' ); ?>
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

		<form id="ie-campaign-form" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<?php wp_nonce_field( 'ie_campaign_form' ); ?>

			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="ie_target"><?php esc_html_e( 'Page to rank', 'interlink-engine' ); ?></label></th>
					<td>
						<select name="target_page_id" id="ie_target" required>
							<option value=""><?php esc_html_e( 'Choose a page…', 'interlink-engine' ); ?></option>
							<?php $ie_town = IE_Settings::business(); $ie_town = isset( $ie_town['town'] ) ? $ie_town['town'] : ''; ?>
							<?php foreach ( $pages as $id => $page ) : ?>
								<?php // The cleaned term travels with the option so the box can fill itself. ?>
								<option value="<?php echo esc_attr( $id ); ?>"
									data-keyword="<?php echo esc_attr( self::keyword_from_title( $page['title'], $ie_town ) ); ?>"
									<?php selected( (int) $value( 'target_page_id' ), (int) $id ); ?>>
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
						<?php
						/**
						 * NOT `required`, deliberately: empty is a valid answer
						 * and means "use the page title". read_keyword() fills
						 * it in server-side, so the form still works with
						 * JavaScript off or blocked.
						 */
						?>
						<input name="keyword" id="ie_keyword" type="text" class="regular-text"
							value="<?php echo esc_attr( $value( 'keyword' ) ); ?>"
							placeholder="<?php esc_attr_e( 'filled in from the page title — edit if it is wrong', 'interlink-engine' ); ?>">
						<p class="description">
							<?php esc_html_e( 'What someone types to find that page. No post will be allowed to compete with it. Leave the town and state out — those are added back automatically.', 'interlink-engine' ); ?>
						</p>
						<script>
						/**
						 * Fill the box from the chosen page, but never trample
						 * a value someone typed. The `ieTouched` flag is set by
						 * the first real keystroke and is the whole safeguard:
						 * without it, changing the page dropdown after editing
						 * the term would silently discard the edit.
						 */
						(function () {
							var sel = document.getElementById('ie_target');
							var box = document.getElementById('ie_keyword');
							if (!sel || !box) { return; }

							var touched = box.value.trim() !== '';
							box.addEventListener('input', function () { touched = true; });

							sel.addEventListener('change', function () {
								if (touched) { return; }
								var opt = sel.options[sel.selectedIndex];
								box.value = (opt && opt.getAttribute('data-keyword')) || '';
							});
						}());
						</script>
					</td>
				</tr>
				<tr>
					<?php
					/**
					 * A dropdown, not a sentence to write.
					 *
					 * This field has been rewritten twice. First it asked "What the
					 * reader should end up wanting"; then it became a sentence stem
					 * to finish. Both were answered with the page's keyword, by the
					 * person who WROTE the field — which is as clear a verdict as a
					 * form ever gives.
					 *
					 * There were only ever about five real answers, so asking anyone
					 * to compose one was the mistake. The option values ARE the
					 * sentence, so whatever is stored still reads as prose to the
					 * writer downstream and nothing below this file changed.
					 *
					 * The free-text box stays underneath for the case the list misses,
					 * and overrides the dropdown when filled. No JavaScript: the two
					 * inputs are independent and read_form() prefers the text.
					 */
					$intent_options = array(
						'get in touch about this service'
							=> __( 'Just get in touch about this service — no strong preference', 'interlink-engine' ),
						'hire a professional for this rather than attempting it themselves'
							=> __( 'Hire a professional rather than attempt it themselves', 'interlink-engine' ),
						'have what they already own repaired, rather than replaced'
							=> __( 'Repair what they have — not replace it', 'interlink-engine' ),
						'replace or upgrade what they have, rather than keep repairing it'
							=> __( 'Replace or upgrade — not keep repairing', 'interlink-engine' ),
						'have the problem properly diagnosed before committing to any work'
							=> __( 'Get it diagnosed first — before committing to any work', 'interlink-engine' ),
						'book a consultation to talk through their situation'
							=> __( 'Book a consultation to talk it through', 'interlink-engine' ),
					);

					$current = (string) $value( 'intent' );
					$is_listed = isset( $intent_options[ $current ] );
					?>
					<th scope="row"><label for="ie_intent_choice"><?php esc_html_e( 'After reading, the visitor should…', 'interlink-engine' ); ?></label></th>
					<td>
						<select name="intent_choice" id="ie_intent_choice" class="regular-text">
							<?php foreach ( $intent_options as $sentence => $label ) : ?>
								<option value="<?php echo esc_attr( $sentence ); ?>" <?php selected( $is_listed && $current === $sentence ); ?>>
									<?php echo esc_html( $label ); ?>
								</option>
							<?php endforeach; ?>
						</select>
						<p class="description">
							<?php esc_html_e( 'Most trades sell one of two nearby things — repair or replacement, diagnosing a problem or fixing it. This stops half your posts recommending the one you do not sell. If none of them is obviously right, leave the first option.', 'interlink-engine' ); ?>
						</p>

						<p style="margin-top:1rem">
							<label for="ie_intent">
								<?php esc_html_e( 'Or say it in your own words (optional):', 'interlink-engine' ); ?>
							</label><br>
							<input name="intent" id="ie_intent" type="text" class="large-text"
								value="<?php echo esc_attr( $is_listed ? '' : $current ); ?>"
								placeholder="<?php esc_attr_e( 'e.g. find out where the leak is before anyone breaks concrete', 'interlink-engine' ); ?>">
						</p>
						<p class="description">
							<?php esc_html_e( 'Only if the list misses your case. Anything here wins over the dropdown. It finishes the sentence “After reading, the visitor should…”, so write an action, not a keyword.', 'interlink-engine' ); ?>
						</p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="ie_video_url"><?php esc_html_e( 'Video to include (optional)', 'interlink-engine' ); ?></label></th>
					<td>
						<input name="video_url" id="ie_video_url" type="url" class="large-text"
							value="<?php echo esc_attr( $value( 'video_url' ) ); ?>"
							placeholder="https://www.youtube.com/watch?v=...">
						<p class="description">
							<?php esc_html_e( 'One YouTube or Vimeo link, used for any post that has no video of its own. Set a different one per article in the Video column below. Leave both empty for none.', 'interlink-engine' ); ?>
						</p>
					</td>
				</tr>
			</table>

			<?php if ( $topics ) : ?>
				<h3><?php esc_html_e( 'Topics', 'interlink-engine' ); ?></h3>
				<p class="description"><?php esc_html_e( 'Edit anything. Untick one to leave it out. Order is publish order.', 'interlink-engine' ); ?></p>

				<table class="widefat striped" style="margin-bottom:1rem">
					<thead>
						<tr>
							<?php
							/**
							 * Explicit column widths, because the default was
							 * unreadable.
							 *
							 * WordPress's `regular-text` is a FIXED 25em. Three
							 * fixed columns plus one flexible one means the
							 * flexible one absorbs every shortfall — so Topic,
							 * the longest and most important value here, was
							 * squeezed to about forty pixels and showed "Wh".
							 * Adding the Video column took another 25em from it.
							 *
							 * Percentages on the header cells, width:100% on the
							 * inputs, and no fixed-width classes anywhere.
							 */
							?>
							<th style="width:2rem"></th>
							<th style="width:36%"><?php esc_html_e( 'Topic', 'interlink-engine' ); ?></th>
							<th style="width:19%"><?php esc_html_e( 'Search it should win', 'interlink-engine' ); ?></th>
							<th style="width:22%"><?php esc_html_e( 'How other posts refer to it', 'interlink-engine' ); ?></th>
							<th style="width:21%"><?php esc_html_e( 'Video (optional)', 'interlink-engine' ); ?></th>
						</tr>
					</thead>
					<tbody>
					<?php foreach ( $topics as $i => $topic ) : ?>
						<tr>
							<td><input type="checkbox" name="use[<?php echo (int) $i; ?>]" value="1" checked></td>
							<?php $topic_text = isset( $topic['topic'] ) ? $topic['topic'] : ''; ?>
							<td><input type="text" style="width:100%" name="topic[<?php echo (int) $i; ?>]"
								<?php // The full text on hover, for the one that still will not fit. ?>
								title="<?php echo esc_attr( $topic_text ); ?>"
								value="<?php echo esc_attr( $topic_text ); ?>"></td>
							<td><input type="text" style="width:100%" name="target_query[<?php echo (int) $i; ?>]"
								value="<?php echo esc_attr( isset( $topic['targetQuery'] ) ? $topic['targetQuery'] : '' ); ?>"></td>
							<td><input type="text" style="width:100%" name="link_phrase[<?php echo (int) $i; ?>]"
								value="<?php echo esc_attr( isset( $topic['linkPhrase'] ) ? $topic['linkPhrase'] : '' ); ?>"></td>
							<td><input type="url" style="width:100%" name="video[<?php echo (int) $i; ?>]"
								placeholder="<?php esc_attr_e( 'leave empty to use the campaign video', 'interlink-engine' ); ?>"
								value="<?php echo esc_attr( isset( $topic['video'] ) ? $topic['video'] : '' ); ?>"></td>
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
				<button type="submit" name="action" value="ie_suggest" class="button"
					data-busy="<?php esc_attr_e( 'Asking for topics…', 'interlink-engine' ); ?>">
					<?php
					/* "DIFFERENT" SAID REPLACE, AND IT USED TO MEAN IT. The
					 * button adds now, so the label says add — and carries the
					 * running total, because the number of topics IS the size
					 * of the campaign and the price of approving it. */
					echo $topics
						? esc_html( sprintf(
							/* translators: 1: how many more, 2: how many there are now */
							__( 'Add %1$d more topics (%2$d so far)', 'interlink-engine' ),
							self::SUGGEST_BATCH,
							count( $topics )
						) )
						: esc_html__( 'Suggest topics for me', 'interlink-engine' ); ?>
				</button>
				<?php if ( $topics && count( $topics ) < self::MAX_TOPICS ) : ?>
					<span class="description" style="margin-left:.5rem">
						<?php
						echo esc_html( sprintf(
							/* translators: %d: the maximum topics per campaign */
							__( 'Press again for more, up to %d — a weekly post for a year.', 'interlink-engine' ),
							self::MAX_TOPICS
						) );
						?>
					</span>
				<?php endif; ?>

				<?php
				/**
				 * Turns typed lines into the same editable table the suggest
				 * path produces — without calling the server, so it is free
				 * and instant.
				 *
				 * Before this, writing your own topics meant skipping the
				 * table entirely, and the table is the only place the search
				 * query, the link phrase and the per-article video can be set.
				 * A topic typed by hand therefore reached the server bare,
				 * and the video column may as well not have existed.
				 */
				?>
				<button type="submit" name="action" value="ie_review_topics" class="button"
					data-busy="<?php esc_attr_e( 'Building the table…', 'interlink-engine' ); ?>">
					<?php echo $topics
						? esc_html__( 'Save these edits', 'interlink-engine' )
						: esc_html__( 'Review these topics', 'interlink-engine' ); ?>
				</button>

				<button type="submit" name="action" value="ie_create_campaign" class="button button-primary"
					data-busy="<?php esc_attr_e( 'Planning the campaign…', 'interlink-engine' ); ?>">
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

			<?php
			/**
			 * Busy state for the three submit buttons.
			 *
			 * "Suggest topics" goes to the server and then to the model, with a
			 * 90-second timeout at the far end. On a slow call the page sits
			 * there looking untouched, and the natural response is to press it
			 * again — which spends a second API call on a request already in
			 * flight.
			 *
			 * THE TRAP, for whoever edits this next: the clicked button is NOT
			 * disabled. A disabled submit button is omitted from the POST, so
			 * `action=ie_suggest` would never arrive and admin-post.php would
			 * have nothing to dispatch on. Its siblings are disabled; it just
			 * changes its own label.
			 */
			?>
			<script>
			(function () {
				var form = document.getElementById('ie-campaign-form');
				if (!form) { return; }

				var busy = false;
				var clicked = null;

				form.addEventListener('click', function (e) {
					var b = e.target.closest ? e.target.closest('button[type="submit"]') : null;
					if (b) { clicked = b; }
				});

				form.addEventListener('submit', function (e) {
					if (busy) { e.preventDefault(); return; }
					busy = true;

					var b = clicked || form.querySelector('button[type="submit"]');
					if (!b) { return; }

					var label = b.getAttribute('data-busy') || b.textContent.trim();
					var spin = document.createElement('span');
					spin.className = 'spinner is-active';
					spin.style.cssText = 'float:none;margin:0 6px 0 0;vertical-align:middle';

					b.textContent = ' ' + label;
					b.insertBefore(spin, b.firstChild);

					// Everything else goes dead. Not this one — see above.
					var all = form.querySelectorAll('button[type="submit"]');
					for (var i = 0; i < all.length; i++) {
						if (all[i] !== b) { all[i].disabled = true; }
					}
				});
			}());
			</script>
		</form>
		<?php
	}

	/* --------------------------------------------------------------------
	 * Handlers
	 * ----------------------------------------------------------------- */

	/**
	 * A search term derived from the page's own title.
	 *
	 * The two are usually the same phrase, so making someone retype it was
	 * busywork — but not ALWAYS the same, which is why the field survives as
	 * an editable default rather than disappearing. A page titled "Plumbing
	 * You Can Trust" or "Whole-Home Repiping" would give anchors that describe
	 * nothing, and only a human knows the phrase people actually search.
	 *
	 * What this strips, and why each one matters downstream:
	 *
	 *   - a brand suffix after | – — or " - ". "…Services | Acme Plumbing"
	 *     would otherwise put the company name inside every exact-match anchor.
	 *   - the town and state. anchorPool.js ADDS those back from the business
	 *     settings, so leaving them in produces "…services Leander, TX in
	 *     Leander". It also loosens the cannibalisation check, which works by
	 *     substring: a longer term matches fewer topics.
	 *   - capitals. Anchors land mid-sentence and IE_Links only fixes the case
	 *     at the START of one.
	 */
	public static function keyword_from_title( $title, $town = '' ) {
		$text = (string) $title;

		// Brand suffix. " - " with spaces, never a bare hyphen — "Whole-Home"
		// and "24-Hour" are part of the phrase, not a separator.
		$text = preg_split( '/\s+[|–—]\s+|\s+-\s+/u', $text )[0];

		$text = trim( $text );

		// Trailing state, with or without a comma: ", TX" / " Texas".
		$text = preg_replace( '/[,\s]+[A-Z]{2}\s*$/', '', $text );

		// Trailing town, however it is joined on: " in Leander", ", Leander",
		// " Leander". Anchored to the END so a town inside the service name
		// survives.
		$town = trim( (string) $town );
		if ( '' !== $town ) {
			// The town setting may itself carry the state.
			$town_only = trim( preg_replace( '/[,\s]+[A-Z]{2}\s*$/', '', $town ) );
			foreach ( array_unique( array( $town, $town_only ) ) as $needle ) {
				if ( '' === $needle ) {
					continue;
				}
				$text = preg_replace(
					'/\s*(?:,|\bin\b|\bnear\b)?\s*' . preg_quote( $needle, '/' ) . '\s*$/i',
					'',
					$text
				);
			}
		}

		$text = preg_replace( '/[\s,\-–—|]+$/u', '', trim( $text ) );

		// Lower case, because the anchor goes mid-sentence. A keyword with a
		// genuine proper noun in it — "Trane AC repair" — is exactly why this
		// stays editable.
		return trim( preg_replace( '/\s+/', ' ', strtolower( $text ) ) );
	}

	/** The typed search term, or one derived from the page title. */
	private static function read_keyword( $page ) {
		$typed = isset( $_POST['keyword'] ) ? sanitize_text_field( wp_unslash( $_POST['keyword'] ) ) : '';

		if ( '' !== trim( $typed ) ) {
			return trim( $typed );
		}

		$business = IE_Settings::business();
		return self::keyword_from_title(
			get_the_title( $page ),
			isset( $business['town'] ) ? $business['town'] : ''
		);
	}

	/** The shared part of both submit buttons: what the form said about the page. */
	private static function read_form() {
		$page_id = isset( $_POST['target_page_id'] ) ? (int) $_POST['target_page_id'] : 0;
		$page    = $page_id ? get_post( $page_id ) : null;

		if ( ! $page ) {
			return null;
		}

		return array(
			'target_page_id' => $page_id,
			// Empty means "use the page's own title", cleaned. Nobody should
			// have to retype a phrase the plugin can already see.
			'keyword'        => self::read_keyword( $page ),
			// The dropdown carries a full sentence as its value; the text box
			// wins when it has anything in it. Everything downstream still
			// receives one prose string and never learns there was a list.
			'intent'         => self::read_intent(),
			// esc_url_raw, not sanitize_text_field: it drops any scheme that is
			// not on WordPress's allow list, so `javascript:` never survives to
			// reach a post. The publisher checks for http(s) again before using
			// it — this value is stored, and storage outlives validation.
			'video_url'      => isset( $_POST['video_url'] ) ? esc_url_raw( trim( wp_unslash( $_POST['video_url'] ) ) ) : '',
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

	/** The dropdown, unless the free-text box overrides it. */
	private static function read_intent() {
		$typed = isset( $_POST['intent'] ) ? sanitize_text_field( wp_unslash( $_POST['intent'] ) ) : '';
		if ( '' !== trim( $typed ) ) {
			return trim( $typed );
		}
		return isset( $_POST['intent_choice'] ) ? sanitize_text_field( wp_unslash( $_POST['intent_choice'] ) ) : '';
	}

	private static function target_page_payload( $form ) {
		return array(
			'url'     => $form['url'],
			'keyword' => $form['keyword'],
			'title'   => $form['title'],
			'intent'  => $form['intent'],
		);
	}

	/**
	 * Put typed topics into the editable table, without asking the server.
	 *
	 * The suggest path replaces whatever is in the textarea with the server's
	 * own ideas, so someone who arrives with a list of topics has no way to
	 * reach the table — and the table is where the search query, the link
	 * phrase and the per-article video live. This is the missing step: parse,
	 * keep, re-render.
	 *
	 * Costs nothing and calls nothing. It is the same collect_topics() the
	 * planning path uses, so the table and the textarea are read by one piece
	 * of code and cannot drift apart.
	 */
	public static function handle_review_topics() {
		check_admin_referer( 'ie_campaign_form' );
		self::require_caps();

		$form = self::read_form();
		if ( ! $form ) {
			self::redirect( 'interlink-engine', 'error', __( 'Choose a page for the campaign to feed.', 'interlink-engine' ), array( 'tab' => 'new' ) );
		}

		$topics = self::collect_topics();

		if ( ! $topics ) {
			self::redirect( 'interlink-engine', 'error', __( 'Type at least one topic, one per line.', 'interlink-engine' ), array( 'tab' => 'new' ) );
		}

		// Carry the videos back onto the rows, or pressing this twice would
		// clear every URL already typed.
		$videos = self::collect_topic_videos();
		foreach ( $topics as $i => $topic ) {
			$key = strtolower( $topic['topic'] );
			$topics[ $i ]['video'] = isset( $videos[ $key ] ) ? $videos[ $key ] : '';
		}

		$draft = self::draft();

		set_transient(
			self::DRAFT_TRANSIENT . get_current_user_id(),
			array(
				'form'     => $form,
				'topics'   => $topics,
				// Warnings belong to the server's suggestions. These topics
				// were never suggested, so there is nothing to carry unless a
				// previous round produced some.
				'warnings' => ( $draft && ! empty( $draft['warnings'] ) ) ? $draft['warnings'] : array(),
			),
			DAY_IN_SECONDS
		);

		self::redirect( 'interlink-engine', 'reviewing', '' );
	}

	public static function handle_suggest() {
		check_admin_referer( 'ie_campaign_form' );
		self::require_caps();

		$form = self::read_form();
		if ( ! $form ) {
			self::redirect( 'interlink-engine', 'error', __( 'Choose a page for the campaign to feed.', 'interlink-engine' ), array( 'tab' => 'new' ) );
		}

		/* THE BUTTON ADDS. IT USED TO REPLACE.
		 *
		 * Pressing it twice threw away the first six topics and put six new
		 * ones in their place. The only way to reach a year of posts was to
		 * write all fifty-two by hand, which is the work this button exists
		 * to avoid — and nothing on screen said the first set was about to go.
		 *
		 * FROM THE FORM, NOT FROM THE STORED DRAFT. collect_topics() reads
		 * what is actually on screen, so edits and unticked rows survive the
		 * press. Reading the transient instead would quietly restore topics
		 * the owner had just corrected or removed.
		 */
		$existing = self::collect_topics();
		$avoid    = wp_list_pluck( $existing, 'topic' );

		/* TWELVE, WHICH IS ALL THE SERVER WILL GIVE AT ONCE. Asking for six
		 * when twelve are available made a year's plan nine presses instead
		 * of five, for no reason anyone chose. */
		$result = IE_Api::suggest( self::target_page_payload( $form ), self::SUGGEST_BATCH, $avoid );

		if ( is_wp_error( $result ) ) {
			self::redirect( 'interlink-engine', 'error', $result->get_error_message(), array( 'tab' => 'new' ) );
		}

		$merged = self::merge_topics(
			$existing,
			isset( $result['topics'] ) ? $result['topics'] : array()
		);

		$topics = $merged['topics'];
		$added  = $merged['added'];
		$capped = $merged['capped'];

		set_transient(
			self::DRAFT_TRANSIENT . get_current_user_id(),
			array(
				'form'     => $form,
				'topics'   => $topics,
				'warnings' => isset( $result['warnings'] ) ? $result['warnings'] : array(),
			),
			DAY_IN_SECONDS
		);

		if ( $capped ) {
			self::redirect( 'interlink-engine', 'suggested', sprintf(
				/* translators: %d: the maximum number of topics */
				__( 'That is %d topics, which is as many as one campaign takes.', 'interlink-engine' ),
				self::MAX_TOPICS
			), array( 'tab' => 'new' ) );
		}

		self::redirect( 'interlink-engine', 'suggested', sprintf(
			/* translators: 1: topics just added, 2: total now on screen */
			_n( '%1$d topic added — %2$d in this campaign so far.',
				'%1$d topics added — %2$d in this campaign so far.',
				count( $added ), 'interlink-engine' ),
			count( $added ),
			count( $topics )
		), array( 'tab' => 'new' ) );
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
			// Neither of these is sent to the server. A video has nothing to do
			// with planning or writing — it is placed into finished content at
			// publish time — so it stays on the WordPress side, with the posts.
			//
			// The campaign one is the fallback; slot_videos overrides it per
			// article.
			'video_url'    => $form['video_url'],
			'slot_videos'  => self::collect_topic_videos(),
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
	 * Fold newly suggested topics into the ones already on screen.
	 *
	 * PURE, AND SEPARATED FOR THAT REASON. Everything around it needs the
	 * whole of wp-admin to run; this is the part with the decisions in it, so
	 * it is a function that takes two arrays and returns a third and can be
	 * tested by wp-plugin/test-topic-merge.php without WordPress at all.
	 *
	 * THREE RULES:
	 *
	 *   ADD, NEVER REPLACE. The button used to throw away the topics already
	 *   on screen, so the only route to a year of posts was to type all
	 *   fifty-two by hand — the exact work the button exists to avoid.
	 *
	 *   NO DUPLICATES, case-insensitively. The server is ASKED to avoid what
	 *   is on screen, but a request is not a guarantee, and two rows with the
	 *   same topic become two posts competing for one search.
	 *
	 *   A CEILING, BECAUSE THIS SPENDS MONEY. Every topic becomes a post that
	 *   costs credits on approval, and the button is easy to lean on.
	 *
	 * @return array{topics: array, added: array, capped: bool}
	 */
	public static function merge_topics( $existing, $fresh ) {
		$existing = is_array( $existing ) ? array_values( $existing ) : array();
		$fresh    = is_array( $fresh ) ? $fresh : array();

		$seen = array();
		foreach ( $existing as $row ) {
			if ( ! empty( $row['topic'] ) ) {
				$seen[] = strtolower( trim( $row['topic'] ) );
			}
		}

		$added = array();

		foreach ( $fresh as $row ) {
			$topic = isset( $row['topic'] ) ? trim( (string) $row['topic'] ) : '';

			if ( '' === $topic || in_array( strtolower( $topic ), $seen, true ) ) {
				continue;
			}

			$seen[]  = strtolower( $topic );
			$added[] = $row;
		}

		$topics = array_merge( $existing, $added );
		$capped = count( $topics ) > self::MAX_TOPICS;

		if ( $capped ) {
			// Kept from the FRONT. The earlier topics are the ones the owner
			// has already looked at and possibly edited; dropping those and
			// keeping the newest arrivals would discard their work.
			$topics = array_slice( $topics, 0, self::MAX_TOPICS );
			$added  = array_slice( $added, 0, max( 0, self::MAX_TOPICS - count( $existing ) ) );
		}

		return array( 'topics' => $topics, 'added' => $added, 'capped' => $capped );
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

	/**
	 * The per-topic videos, keyed by TOPIC TEXT rather than by row number.
	 *
	 * Collected separately from collect_topics() because that array is the
	 * payload sent to the server, and the video is not the server's business —
	 * it is placed into finished content here, at publish time.
	 *
	 * Keyed by text, not index, because the index is ours and the slots come
	 * back from the server. If it ever drops a topic or returns them in a
	 * different order, an index map would silently attach each video to the
	 * wrong article — the kind of wrong that looks fine until a customer
	 * watches a video about water heaters on a post about slab leaks.
	 *
	 * @return array lowercased topic text => url
	 */
	private static function collect_topic_videos() {
		$map = array();

		if ( empty( $_POST['topic'] ) || ! is_array( $_POST['topic'] ) ) {
			return $map;
		}

		$use = isset( $_POST['use'] ) && is_array( $_POST['use'] ) ? $_POST['use'] : array();

		foreach ( $_POST['topic'] as $i => $raw ) {
			if ( ! isset( $use[ $i ] ) ) {
				continue;
			}

			$topic = sanitize_text_field( wp_unslash( $raw ) );
			$url   = isset( $_POST['video'][ $i ] )
				? esc_url_raw( trim( wp_unslash( $_POST['video'][ $i ] ) ) )
				: '';

			if ( '' !== $topic && '' !== $url ) {
				$map[ strtolower( $topic ) ] = $url;
			}
		}

		return $map;
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

		// A paused campaign. run_campaign() returns a skip rather than an
		// error, and the branches below would report "0 posts added" to
		// somebody who had just asked for posts. The button is hidden while a
		// campaign is paused, so reaching here means a stale tab or a
		// bookmarked URL — which is exactly when a clear sentence matters.
		if ( ! empty( $result['skipped'] ) ) {
			self::redirect( 'interlink-engine', 'error', __( 'That campaign is paused. Resume it first.', 'interlink-engine' ) );
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

		/* THE SLOT HAVING AN ID IS NOT THE SAME AS THE POST EXISTING.
		 *
		 * A deleted post leaves its id behind on the slot, so the check above
		 * passes and publish_now() runs against nothing. wp_update_post()
		 * answers 0 for a missing id — not a WP_Error — so the is_wp_error()
		 * test below lets it through and the owner is told the post was
		 * published. It was not, and there is nothing to publish.
		 *
		 * The link is no longer rendered for these rows, but this URL is
		 * reachable by hand and by an old browser tab. */
		if ( IE_Campaigns::post_missing( $found[1] ) ) {
			self::redirect(
				'interlink-engine',
				'error',
				__( 'That post no longer exists on this site — it was deleted, or moved to Trash.', 'interlink-engine' )
			);
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
				'Campaign paused. %d scheduled post was held as a draft.',
				'Campaign paused. %d scheduled posts were held as drafts.',
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
				'Campaign resumed. %d post is scheduled again, moved forward by the time it was paused.',
				'Campaign resumed. %d posts are scheduled again, moved forward by the time it was paused.',
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

		/* TELL THE SERVER FIRST, THEN DELETE.
		 *
		 * The other way round loses the id: IE_Campaigns::delete() takes the
		 * record with it, and the server's campaign id lives inside that
		 * record. There would be nothing left to report.
		 *
		 * The call cannot fail this handler. IE_Api::removed() swallows its
		 * own errors and logs them — a site that is offline, or whose licence
		 * has been revoked, must still be able to remove a campaign from its
		 * own screen. See the comment on that method. */
		/* The sequence lives in IE_Publisher::remove_campaign(), not here: the
		 * order of those four steps is load-bearing and a handler cannot be
		 * tested — it checks a nonce, checks capabilities and ends in a
		 * redirect. See the note on that function. */
		$trashed = IE_Publisher::remove_campaign( $campaign_id );

		self::redirect( 'interlink-engine', 'removed', sprintf(
			/* translators: 1: number of published articles, 2: number of unpublished posts */
			__( '%1$s and %2$s moved to Trash. You can restore them for 30 days.', 'interlink-engine' ),
			sprintf(
				/* translators: %d: number of published articles */
				_n( '%d published article', '%d published articles', $trashed['published'], 'interlink-engine' ),
				$trashed['published']
			),
			sprintf(
				/* translators: %d: number of unpublished posts */
				_n( '%d draft', '%d drafts', $trashed['drafts'], 'interlink-engine' ),
				$trashed['drafts']
			)
		) );
	}

	/**
	 * Throw away the posts of a paused campaign that never published.
	 *
	 * The safe half of the pair. Everything the public can already read is
	 * left alone, which is what lets this sit on the card behind one dialog
	 * rather than two.
	 */
	/**
	 * Go back and finish the link swaps that never happened.
	 *
	 * The work is IE_Publisher::repair_links(); this only reports it. The
	 * numbers matter, because "it worked" tells nobody whether anything was
	 * actually wrong — and the honest answer is often zero, which is good news
	 * and has to read like it.
	 */
	public static function handle_repair_links() {
		check_admin_referer( 'ie_repair_links' );
		self::require_caps();

		$tab = isset( $_GET['tab'] ) ? sanitize_text_field( wp_unslash( $_GET['tab'] ) ) : 'running';
		if ( ! in_array( $tab, array( 'running', 'drafts', 'done', 'new' ), true ) ) {
			$tab = 'running';
		}

		$stats = IE_Publisher::repair_links();

		if ( ! $stats['restored'] && ! $stats['unwrapped'] ) {
			self::redirect( 'interlink-engine', 'repaired',
				__( 'Nothing to repair — every link between your posts is already in place.', 'interlink-engine' ),
				array( 'tab' => $tab ) );
		}

		$parts = array();

		if ( $stats['restored'] ) {
			$parts[] = sprintf(
				/* translators: 1: number of links, 2: number of posts */
				_n( '%1$d link restored across %2$d post', '%1$d links restored across %2$d posts', $stats['restored'], 'interlink-engine' ),
				$stats['restored'], $stats['posts']
			);
		}

		if ( $stats['unwrapped'] ) {
			$parts[] = sprintf(
				/* translators: %d: number of placeholders removed */
				_n(
					'%d placeholder was waiting for a post that no longer exists, and has been removed',
					'%d placeholders were waiting for posts that no longer exist, and have been removed',
					$stats['unwrapped'],
					'interlink-engine'
				),
				$stats['unwrapped']
			);
		}

		$message = implode( ', and ', $parts ) . '.';

		/* NAME THE POSTS. Unwrapping is correct and still costs a link that
		 * was planned — the article now has one fewer route out of it. The
		 * plugin cannot write the replacement: the anchor text was chosen to
		 * describe the post that never arrived, so pointing it anywhere else
		 * gives a link whose words promise one article and deliver another.
		 * A person can write that sentence. So say which post needs one. */
		if ( ! empty( $stats['short'] ) ) {
			$named = array();

			foreach ( $stats['short'] as $title => $suggestion ) {
				$named[] = $suggestion
					? sprintf(
						/* translators: 1: the post that lost a link, 2: the post to link it to */
						__( '"%1$s" — linking it to "%2$s" would close the ring', 'interlink-engine' ),
						$title, $suggestion
					)
					: sprintf(
						/* translators: %s: the post that lost a link */
						__( '"%s"', 'interlink-engine' ),
						$title
					);
			}

			$message .= ' ' . sprintf(
				/* translators: %s: list of posts, each with a suggested target */
				_n(
					'This post is now one internal link lighter: %s.',
					'These posts are now one internal link lighter: %s.',
					count( $named ),
					'interlink-engine'
				),
				implode( '; ', $named )
			);
		}

		self::redirect( 'interlink-engine', 'repaired', $message, array( 'tab' => $tab ) );
	}

	public static function handle_delete_drafts() {
		check_admin_referer( 'ie_delete_drafts' );
		self::require_caps();

		$campaign_id = isset( $_GET['campaign'] ) ? sanitize_text_field( wp_unslash( $_GET['campaign'] ) ) : '';

		// abandon_remaining(), not delete_remaining_drafts(): throwing away
		// what is left also ends the campaign, and leaving it Paused for ever
		// with nothing to resume was the gap this closes.
		$gone = IE_Publisher::abandon_remaining( $campaign_id );

		// Same reason as above: the report is queued by the trash hook and
		// would otherwise wait for shutdown. Here the record survives, so it
		// would in fact still work — flushed anyway so the two paths cannot
		// come to differ, which is how the first one broke.
		IE_Publisher::flush_deleted_reports();

		if ( ! $gone ) {
			self::redirect( 'interlink-engine', 'drafts-deleted',
				__( 'Nothing left to delete — every post in this campaign has published.', 'interlink-engine' ) );
		}

		self::redirect( 'interlink-engine', 'drafts-deleted', sprintf(
			/* translators: %d: number of posts moved to Trash */
			_n(
				'%d post that had not published moved to Trash. Your published articles are untouched, and the campaign is now closed.',
				'%d posts that had not published moved to Trash. Your published articles are untouched, and the campaign is now closed.',
				$gone,
				'interlink-engine'
			),
			$gone
		) );
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
			case 'reviewing':
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
			'reviewing' => array( 'success', __( 'Your topics, ready to edit. Set the search each should win, how other posts refer to it, and a video if you want one — then plan the campaign.', 'interlink-engine' ) ),
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
			/* The headline is empty on purpose for both of these: the handler
			 * passes the counts it actually trashed, and a fixed sentence above
			 * them would either repeat that or contradict it. The old wording
			 * here — "The posts it wrote are untouched" — is exactly what this
			 * button no longer does. */
			'removed'        => array( 'success', '' ),
			'drafts-deleted' => array( 'success', '' ),
			'repaired'       => array( 'success', '' ),
			'discarded' => array( 'info', __( 'Draft topics discarded.', 'interlink-engine' ) ),
			'error'     => array( 'error', __( 'That did not work.', 'interlink-engine' ) ),
			// Deliberately not phrased as a failure. Nothing broke and nothing
			// was charged — the campaign is still sitting there as a draft,
			// waiting. Saying "that did not work" about a topped-up balance
			// away would read as a bug in the plugin.
			'credits'   => array( 'warning', __( 'Not enough credits to write this campaign.', 'interlink-engine' ) ),
			// EMPTY HEADLINE ON PURPOSE. Every other entry here is a fixed
			// sentence with an optional detail appended, but this one has two
			// entirely different outcomes — "3 campaigns updated" and
			// "everything is still on the site" — and neither is a suffix to
			// a shared opening. The handler sends the whole sentence.
			'checked'   => array( 'success', '' ),
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
