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
		add_action( 'admin_post_ie_hygiene', array( __CLASS__, 'handle_hygiene' ) );
		add_action( 'admin_post_ie_suggest', array( __CLASS__, 'handle_suggest' ) );
		add_action( 'admin_post_ie_review_topics', array( __CLASS__, 'handle_review_topics' ) );
		add_action( 'admin_post_ie_create_campaign', array( __CLASS__, 'handle_create_campaign' ) );
		add_action( 'admin_post_ie_run_now', array( __CLASS__, 'handle_run_now' ) );
		add_action( 'admin_post_ie_publish_now', array( __CLASS__, 'handle_publish_now' ) );
		add_action( 'admin_post_ie_publish_all', array( __CLASS__, 'handle_publish_all' ) );
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

			<?php self::render_hygiene(); ?>

			<h2><?php esc_html_e( 'Recent activity', 'interlink-engine' ); ?></h2>
			<?php self::render_log(); ?>
		</div>
		<?php
	}

	/**
	 * The archive tidy-up control.
	 *
	 * A SELECT RATHER THAN A CHECKBOX, and that is the only interesting thing
	 * about this screen. The underlying value has three states — decide for
	 * me, always on, always off — and a checkbox can only carry two. Unticked
	 * and never-visited look identical to a checkbox, so the automatic rule
	 * could never tell "the owner turned this off" from "the owner has not
	 * been here yet", and one of those must not be overruled while the other
	 * must.
	 *
	 * THE CURRENT ANSWER IS SHOWN, not just the setting. On automatic, the
	 * line underneath says what the plugin has decided and why — otherwise the
	 * screen reports a preference and the owner has no way to find out what
	 * that preference produced on their site.
	 *
	 * ITS OWN FORM, deliberately. The connection form above has two different
	 * actions behind one button and a documented history of an edit there
	 * disconnecting a working site. This has nothing to do with the licence
	 * and should not share its submit.
	 */
	private static function render_hygiene() {
		$choice = (string) IE_Settings::get( IE_Hygiene::SETTING, '' );
		$owns   = IE_Hygiene::owns_whole_site();

		?>
		<h2><?php esc_html_e( 'Author and category archives', 'interlink-engine' ); ?></h2>

		<p class="description" style="max-width:40em">
			<?php esc_html_e( 'WordPress publishes an author archive and a category archive for every site, and lists both in wp-sitemap.xml. On a site written entirely by this plugin they are thin pages that compete with the articles, and the author archive publishes the login name of an account that can edit the site.', 'interlink-engine' ); ?>
		</p>

		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="ie_hygiene">
			<?php wp_nonce_field( 'ie_hygiene' ); ?>

			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="ie-hygiene"><?php esc_html_e( 'Tidy them up', 'interlink-engine' ); ?></label></th>
					<td>
						<select name="archive_hygiene" id="ie-hygiene">
							<option value=""<?php selected( '', $choice ); ?>>
								<?php esc_html_e( 'Automatic — only on sites this plugin built', 'interlink-engine' ); ?>
							</option>
							<option value="on"<?php selected( 'on', $choice ); ?>>
								<?php esc_html_e( 'Always on', 'interlink-engine' ); ?>
							</option>
							<option value="off"<?php selected( 'off', $choice ); ?>>
								<?php esc_html_e( 'Always off', 'interlink-engine' ); ?>
							</option>
						</select>

						<p class="description">
							<?php
							if ( '' !== $choice ) {
								echo esc_html(
									'on' === $choice
										? __( 'Tidying is on, whatever else is published here.', 'interlink-engine' )
										: __( 'Nothing is changed on this site.', 'interlink-engine' )
								);
							} elseif ( $owns ) {
								esc_html_e( 'On. Everything published here was written by this plugin.', 'interlink-engine' );
							} else {
								esc_html_e( 'Off. There are pages or posts here that this plugin did not write, so nothing is changed. A new WordPress still has its "Hello world!" post and sample page, which count.', 'interlink-engine' );
							}
							?>
						</p>

						<p class="description">
							<?php esc_html_e( 'When on: the author and category sections are removed from wp-sitemap.xml, those archives are marked noindex, and the author archive redirects to the home page. Your posts, pages and the blog archive are untouched.', 'interlink-engine' ); ?>
						</p>
					</td>
				</tr>
			</table>

			<?php submit_button( __( 'Save', 'interlink-engine' ), 'secondary' ); ?>
		</form>
		<?php
	}

	/**
	 * Save the archive tidy-up choice.
	 *
	 * ANYTHING THAT IS NOT 'on' OR 'off' BECOMES '', which is automatic. A
	 * typo in a hand-made request, or a value from a future version of this
	 * form, must land on the behaviour that changes nothing by itself rather
	 * than on whichever branch an unrecognised string happens to fall through
	 * to.
	 */
	public static function handle_hygiene() {
		check_admin_referer( 'ie_hygiene' );
		self::require_caps();

		$choice = isset( $_POST['archive_hygiene'] ) ? sanitize_key( wp_unslash( $_POST['archive_hygiene'] ) ) : '';

		if ( ! in_array( $choice, array( 'on', 'off' ), true ) ) {
			$choice = '';
		}

		IE_Settings::set( array( IE_Hygiene::SETTING => $choice ) );

		self::redirect( 'interlink-connection', 'hygiene_saved', '' );
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
			<?php esc_html_e( 'Finds links between your posts that were never switched on, and switches them on. Also tidies search-result titles on older posts. Safe to run more than once.', 'interlink-engine' ); ?>
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

			/* "No page" READS AS A FAULT, and for a pillar campaign it is the
			 * design. The fallback predates pillar campaigns and meant a
			 * campaign whose stored page had been lost — worth looking at.
			 * Grouping pillars under the same words would send the owner
			 * hunting for a problem that is not there. */
			if ( ! empty( $campaign['is_pillar'] ) ) {
				$title = __( 'Pillars — no target page', 'interlink-engine' );
			} elseif ( isset( $campaign['target_page']['title'] ) && $campaign['target_page']['title'] ) {
				$title = (string) $campaign['target_page']['title'];
			} else {
				$title = $url ? $url : __( 'No page', 'interlink-engine' );
			}

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
				var showing = <?php echo wp_json_encode( __( 'Show main keywords', 'interlink-engine' ) ); ?>;
				var hiding  = <?php echo wp_json_encode( __( 'Hide main keywords', 'interlink-engine' ) ); ?>;

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
								<?php echo esc_html( self::headline( $row['post_id'], $row['topic'] ) ); ?>
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
		} elseif ( IE_Campaigns::is_paused( $campaign ) ) {
			/* PAUSED BELONGS WITH THE OTHER SPECIFIC STATES, and it was
			 * missing from this chain entirely.
			 *
			 * A paused campaign fell through to the `else` and read
			 * "publishing on schedule" — present tense, about a campaign that
			 * is publishing nothing — directly above its own Resume button.
			 *
			 * The paragraph above this chain already made exactly this
			 * argument about finished campaigns: "a campaign that has nothing
			 * left to publish is not publishing on schedule". Paused is the
			 * same sentence and was not covered by it. A rule written for one
			 * case tends to stay written for one case.
			 *
			 * AFTER `is_finished`, deliberately. A campaign with every post
			 * live and nothing outstanding is finished whether or not somebody
			 * paused it on the way, and "finished" is the more useful word. */
			$state = __( 'paused', 'interlink-engine' );
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
				<?php
				/* THE ONE UNGUARDED READ OF target_page, and the one that
				 * would have been seen. Not a crash — PHP 8 warns and renders
				 * `<a href="">` with no text, so the card shows "Feeding:"
				 * followed by nothing at all, which looks exactly like a
				 * campaign whose target page was deleted.
				 *
				 * A pillar campaign is not feeding anything yet. Saying so is
				 * the honest line, and it is also the one that tells the owner
				 * what to do next: these are hubs, point a campaign at one. */
				$ie_tp = isset( $campaign['target_page'] ) && is_array( $campaign['target_page'] )
					? $campaign['target_page']
					: array();
				$ie_tp_url   = isset( $ie_tp['url'] ) ? (string) $ie_tp['url'] : '';
				$ie_tp_title = isset( $ie_tp['title'] ) ? (string) $ie_tp['title'] : '';
				?>
				<?php if ( ! empty( $campaign['is_pillar'] ) ) : ?>
					<?php esc_html_e( 'Pillar posts — they link to each other. Point a later campaign at one of them.', 'interlink-engine' ); ?>
				<?php elseif ( '' !== $ie_tp_url ) : ?>
					<?php esc_html_e( 'Feeding:', 'interlink-engine' ); ?>
					<a href="<?php echo esc_url( $ie_tp_url ); ?>" target="_blank" rel="noreferrer">
						<?php echo esc_html( '' !== $ie_tp_title ? $ie_tp_title : $ie_tp_url ); ?>
					</a>
				<?php else : ?>
					<?php esc_html_e( 'Feeding: the target page for this campaign is no longer recorded.', 'interlink-engine' ); ?>
				<?php endif; ?>
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
						<?php
						/* "POST", NOT "TOPIC" — renamed with the column's
						 * contents, 7 October.
						 *
						 * The cell now shows the published headline once there
						 * is one, so "Topic" would have been right for an
						 * unwritten row and wrong for every written one. The
						 * screen above this already calls the same column
						 * "Post", and this file's own comment forty lines down
						 * records what two names for one thing cost last time. */
						?>
						<th><?php esc_html_e( 'Post', 'interlink-engine' ); ?></th>
						<th class="ie-terms" hidden><?php esc_html_e( 'Main keyword of the post', 'interlink-engine' ); ?></th>
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
								<a href="<?php echo esc_url( get_edit_post_link( $slot['post_id'] ) ); ?>"><?php echo esc_html( self::headline( $slot['post_id'], $slot['topic'] ) ); ?></a>
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
							<?php elseif ( IE_Campaigns::is_paused( $campaign ) ) : ?>
								<?php
								/* "ARRIVING" ON A PAUSED CAMPAIGN IS A PROMISE
								 * NOTHING IS KEEPING.
								 *
								 * Nothing is arriving: the campaign is stopped,
								 * and whatever the server has written is sitting
								 * there until somebody resumes it. Edwin paused a
								 * four-post campaign, three were written and
								 * charged for, and all four rows said "Arriving"
								 * — the same word for posts that exist and are
								 * paid for and posts that do not exist at all.
								 *
								 * ONE WORD FOR BOTH, AND THAT IS DELIBERATE. The
								 * plugin cannot tell them apart: it learns a post
								 * exists only when it collects it, and a paused
								 * campaign collects nothing. The blog report CAN
								 * — it reads the server's own slot statuses and
								 * now says "Written, waiting" — so the honest
								 * thing here is the fact this screen actually
								 * knows, which is that the campaign is held. */
								?>
								<span class="ie-pill ie-pill-wait"
								      title="<?php esc_attr_e( 'The campaign is paused, so nothing is being written or published for it. Posts already written are kept and will arrive when you resume. The blog report on Three Comets shows which have been written.', 'interlink-engine' ); ?>"><?php esc_html_e( 'Held', 'interlink-engine' ); ?></span>
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
			 * The main keywords, behind a toggle.
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
					<?php esc_html_e( 'Show main keywords', 'interlink-engine' ); ?>
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
			/* WHEN THE SERVER LAST SAID IT WAS WRITING — not when the campaign
			 * was approved.
			 *
			 * This read batch_started, which is stamped once, at approval, and
			 * never again. For a single uninterrupted batch the two are the
			 * same moment. For a campaign paused and resumed an hour later
			 * they are not: writing restarts, batch_started still points at
			 * the original approval, `time() - started` is already past the
			 * window, and the spinner can never appear. Edwin resumed a
			 * campaign, three posts were written and charged, and the page
			 * showed nothing at all.
			 *
			 * writing_since is set by run_campaign() when the server first
			 * answers 'writing', and cleared the moment it stops — see the
			 * note there. The screen now asks "is it writing?" rather than
			 * "was it approved recently?", which is the question it was always
			 * trying to answer. */
			$started = empty( $campaign['writing_since'] )
				? 0
				: strtotime( $campaign['writing_since'] );

			/* AND NOT PAUSED, which it did not check until 6 October.
			 *
			 * $paused is worked out a dozen lines above, to decide which
			 * buttons to offer, and was never consulted here. So a paused
			 * campaign kept a spinner and the words "Writing your posts" for
			 * ten minutes after approval, whatever had actually happened.
			 *
			 * THAT IS WORSE THAN COSMETIC, because it made two opposite
			 * outcomes identical on screen. Edwin pressed Pause, the batch
			 * stopped correctly after the post in flight — 1 of 4 written, 75
			 * credits instead of 300 — and the page went on saying it was
			 * writing. He then pressed the write button again, the admin
			 * refused it (a paused campaign cannot be written), and the
			 * spinner carried on through that too. Nothing on the page could
			 * distinguish "stopped as you asked" from "ignoring you".
			 *
			 * A progress indicator that is wrong about whether anything is
			 * happening is not a smaller bug than the thing it was reporting
			 * on. It is the only part the owner can see. */
			$watching = $pending && $approved && $started && ! $paused
				&& ( time() - $started ) < 600;
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
					   <?php
						/* SAYS WHAT HAPPENS TO A BATCH IN FLIGHT, which the
						 * old wording did not.
						 *
						 * It read "nothing new is written". True of the
						 * schedule, false of the one thing moving fast enough
						 * to matter. Edwin approved eleven articles, pressed
						 * Pause seconds later, and all eleven were written
						 * and 825 credits charged — while a dialog he had
						 * just agreed to told him they would not be.
						 *
						 * The server can only stop BETWEEN posts: a model
						 * call in flight is paid for the moment it is sent,
						 * so abandoning it spends the credits and keeps
						 * nothing. One more article is the honest worst case,
						 * and the sentence now says so rather than promising
						 * zero and delivering eleven. */
						?>
					   onclick="return confirm('<?php echo esc_js( __( 'Pause this campaign? If posts are being written right now, the one in progress finishes and is charged — the rest are stopped. Scheduled posts are held back as drafts. Posts already published stay up.', 'interlink-engine' ) ); ?>')">
						<?php esc_html_e( 'Pause campaign', 'interlink-engine' ); ?>
					</a>
				<?php endif; ?>

				<?php
				/**
				 * PUBLISH ALL — pillar campaigns only.
				 *
				 * A pillar is useless until it is live: target_pages() lists
				 * only `publish` posts, because a future-dated one answers 404
				 * and a silo aimed at it would point at nothing. "Publish
				 * early" is per row, so five pillars meant five presses.
				 *
				 * NOT OFFERED ON A SILO CAMPAIGN. There the schedule is what
				 * the customer planned and paid for, and dating twelve posts
				 * today cannot be undone — a post does not go back onto a
				 * schedule. handle_publish_all() refuses it as well, because
				 * this URL is reachable from a stale tab.
				 *
				 * COUNTED BEFORE IT IS OFFERED. A control that says "publish
				 * all" on a campaign with nothing left to publish is a control
				 * that does nothing and says so afterwards; the count is in the
				 * label, so the answer is on screen before the click.
				 */
				$ie_waiting = 0;
				if ( ! empty( $campaign['is_pillar'] ) ) {
					foreach ( (array) $campaign['slots'] as $ie_s ) {
						if ( isset( $ie_s['status'] ) && 'scheduled' === $ie_s['status'] && ! empty( $ie_s['post_id'] ) ) {
							$ie_waiting++;
						}
					}
				}
				?>
				<?php if ( $ie_waiting ) : ?>
					<a class="button button-primary ie-publish-all"
					   href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=ie_publish_all&campaign=' . rawurlencode( $campaign['id'] ) ), 'ie_publish_all' ) ); ?>"
					   onclick="return confirm('<?php echo esc_js( sprintf(
							/* translators: %d: how many posts would go live */
							_n(
								'Publish %d pillar now? It will be dated today instead of its planned day.',
								'Publish all %d pillars now? They will be dated today instead of their planned days.',
								$ie_waiting,
								'interlink-engine'
							),
							$ie_waiting
						) ); ?>')">
						<?php echo esc_html( sprintf(
							/* translators: %d: how many posts would go live */
							_n( 'Publish the %d pillar now', 'Publish all %d pillars now', $ie_waiting, 'interlink-engine' ),
							$ie_waiting
						) ); ?>
					</a>
					<span class="description">
						<?php esc_html_e( 'A later campaign can only point at a pillar once it is live.', 'interlink-engine' ); ?>
					</span>
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
					<th scope="row"><?php esc_html_e( 'Pillar campaign', 'interlink-engine' ); ?></th>
					<td>
						<label>
							<input type="checkbox" name="is_pillar" id="ie_is_pillar" value="1"
								<?php checked( ! empty( $value( 'is_pillar' ) ) ); ?>>
							<?php esc_html_e( 'These posts are pillars — they link to each other, not to a page', 'interlink-engine' ); ?>
						</label>
						<p class="description">
							<?php esc_html_e( 'Write the hub articles first. Later campaigns point at them, and each published pillar becomes a choice in Target Page.', 'interlink-engine' ); ?>
						</p>

						<?php
						/**
						 * NESTED UNDER THE PILLAR BOX, and only meaningful
						 * with it. A silo campaign's first post is one of
						 * twelve on a schedule; making it the home page is not
						 * a thing anyone would want.
						 *
						 * Shown and hidden by the same script that governs
						 * .ie-pillar-only, so there is one mechanism rather
						 * than a second to forget about. read_form() reads
						 * the box regardless, and ignores it when the campaign
						 * is not a pillar campaign — a form posted with
						 * JavaScript off can tick anything.
						 */
						?>
						<p class="ie-pillar-only" style="display:none;margin-top:1rem">
							<label>
								<input type="checkbox" name="home_page" id="ie_home_page" value="1"
									<?php checked( ! empty( $value( 'home_page' ) ) ); ?>>
								<?php esc_html_e( 'Make the first post this site’s home page', 'interlink-engine' ); ?>
							</label>
						</p>
						<p class="description ie-pillar-only" style="display:none">
							<?php esc_html_e( 'For a brand-new site. The first article is created as a page and set as the front page when it publishes. It stays a pillar, and keeps its place in the ring. A site that already has a front page is left alone.', 'interlink-engine' ); ?>
						</p>
					</td>
				</tr>
				<tr class="ie-needs-target">
					<th scope="row"><label for="ie_target"><?php esc_html_e( 'Target Page', 'interlink-engine' ); ?></label></th>
					<td>
						<?php
						/**
						 * `required` IS GONE, and the checkbox above is why.
						 *
						 * `required` on a control the browser cannot see is not
						 * a validation rule, it is a dead end: Chrome refuses
						 * to submit and reports "An invalid form control with
						 * name='target_page_id' is not focusable" to the
						 * console — where no site owner will ever read it. The
						 * button stops working and the page says nothing.
						 *
						 * So the requirement moved server-side into
						 * read_form(), which had to check it anyway: a form
						 * posted with JavaScript off, or from a cached page,
						 * arrives at the same handler.
						 */
						?>
						<select name="target_page_id" id="ie_target">
							<option value=""><?php esc_html_e( 'Choose a page…', 'interlink-engine' ); ?></option>
							<?php $ie_town = IE_Settings::business(); $ie_town = isset( $ie_town['town'] ) ? $ie_town['town'] : ''; ?>
							<?php $ie_n = 0; ?>
							<?php foreach ( $pages as $id => $page ) : ?>
								<?php $ie_n++; ?>
								<?php
								/* The term travels with the option so the box can fill
								 * itself — AND IT ASKS THE SAME QUESTION read_keyword()
								 * ASKS, in the same order.
								 *
								 * It used to derive from the title unconditionally,
								 * which was fine while the server did the same. Now the
								 * server prefers the keyword a pillar was planned to
								 * win, and a dropdown still offering the headline would
								 * put one value on the screen and store another. A
								 * pre-filled box the owner can see and the server then
								 * ignores is a worse bug than the one being fixed: at
								 * least a bad default is honest about what it will do. */
								$ie_stored = self::stored_keyword( $id );
								$ie_kw     = '' !== $ie_stored
									? $ie_stored
									: self::keyword_from_title( $page['title'], $ie_town );
								?>
								<option value="<?php echo esc_attr( $id ); ?>"
									data-keyword="<?php echo esc_attr( $ie_kw ); ?>"
									<?php selected( (int) $value( 'target_page_id' ), (int) $id ); ?>>
									<?php
									/* THE NUMBER AND THE MARKER ARE BOTH ADDED HERE,
									 * WHERE THEY ARE SEEN, AND NEITHER IS EVER STORED.
									 *
									 * target_pages() returns the real title because
									 * read_form() keeps that title: it becomes the
									 * campaign's label AND is sent as targetPage.title,
									 * which writePost drops into "It becomes a link to
									 * the X page". A decorated title would have every
									 * post in the silo referring to "the Leash Pulling
									 * (pillar) page" — or, now, to "the 3. Home Loans
									 * page".
									 *
									 * The number was asked for on 4 October so a long
									 * list can be talked about by position. IT IS A
									 * POSITION IN THIS RENDERING, NOT AN IDENTITY:
									 * target_pages() orders pages by menu_order title
									 * and appends pillars by date, so publishing a page
									 * or adding a pillar shifts everything after it.
									 * Edwin was told and accepted that. It must
									 * therefore never be written into a campaign record
									 * or into a message someone might act on later. */
									echo esc_html(
										sprintf(
											/* translators: 1: position in the list, 2: the page's title */
											__( '%1$d. %2$s', 'interlink-engine' ),
											$ie_n,
											empty( $page['is_pillar'] )
												? $page['title']
												/* translators: %s: the pillar post's title */
												: sprintf( __( '%s — pillar', 'interlink-engine' ), $page['title'] )
										)
									);
									?>
								</option>
							<?php endforeach; ?>
						</select>
						<?php
						/**
						 * SHORTENED ON REQUEST, and what went with it: "Pick
						 * the page that books jobs, not a blog page."
						 *
						 * That sentence was the ONLY thing anywhere guarding
						 * against a campaign aimed at a blog index. The
						 * dropdown does not filter them out, and the warnings
						 * block above this form is filled from the server's
						 * plan response — which arrives AFTER the credits are
						 * spent. Recorded here so whoever next wonders why a
						 * customer pointed thirty posts at /blog/ finds the
						 * answer rather than rediscovering it.
						 */
						?>
						<p class="description"><?php esc_html_e( 'Every post will link to it.', 'interlink-engine' ); ?></p>

						<?php
						/**
						 * THE ESCAPE HATCH, NOT A REPLACEMENT FOR THE LIST.
						 *
						 * The dropdown offers every published page plus every
						 * post this plugin stamped as a pillar. An owner whose
						 * hub is a post they wrote themselves has nothing to
						 * pick, and the campaign cannot be aimed at the one
						 * page on the site that matters.
						 *
						 * Underneath the list rather than beside it, because
						 * for almost everybody the list is right and a second
						 * equal-looking control would only invite a choice
						 * nobody needs to make.
						 */
						?>
						<p style="margin-top:12px">
							<label for="ie_target_url" style="display:block;margin-bottom:4px;">
								<?php esc_html_e( 'Or paste a URL from this site', 'interlink-engine' ); ?>
							</label>
							<?php
							// The draft first, then whatever the failing redirect carried back.
							$ie_typed_url = $value( 'target_url' );
							if ( '' === $ie_typed_url && isset( $_GET['target_url'] ) ) {
								$ie_typed_url = esc_url_raw( wp_unslash( $_GET['target_url'] ) );
							}
							?>
							<input type="url" name="target_url" id="ie_target_url" class="regular-text"
								placeholder="<?php echo esc_attr( home_url( '/some-article/' ) ); ?>"
								value="<?php echo esc_attr( $ie_typed_url ); ?>">
							<span class="description" style="display:block">
								<?php esc_html_e( 'For a post that is not in the list above. Leave blank to use the list. Copy it from the address bar while viewing the page.', 'interlink-engine' ); ?>
							</span>
						</p>
					</td>
				</tr>
				<tr class="ie-needs-target">
					<?php
					/**
					 * NOT "Its search term". "Its" pointed at the dropdown
					 * above, and a pronoun whose antecedent can scroll off the
					 * screen names nothing. The label now says which page it
					 * means, and says "keyword" rather than "search term"
					 * because that is the word used everywhere else this value
					 * is discussed.
					 */
					?>
					<th scope="row"><label for="ie_keyword"><?php esc_html_e( 'Main Keyword of Target Page', 'interlink-engine' ); ?></label></th>
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
							<?php
							/* THE FIRST SENTENCE WENT, and losing it is the point.
							 *
							 * It read "What someone types to find that page" — a
							 * definition of the word "keyword", under a label that
							 * already says Keyword. A help text that explains its own
							 * label teaches nothing and costs a line of attention on
							 * the busiest screen in the plugin.
							 *
							 * What is left is the two things the owner cannot work
							 * out from the label: that this value will be PROTECTED
							 * from the posts, and that the town must be left off.
							 *
							 * "If this is a local business" added, because the town
							 * instruction is nonsense on a blog — the same
							 * trade-machinery-on-a-content-site problem that blog
							 * mode fixed in the anchors and the topic angles. The
							 * sentence now says who it is for. */
							?>
							<?php esc_html_e( 'No post will be allowed to compete with this term. If this is a local business leave the town and state out — those are added back automatically.', 'interlink-engine' ); ?>
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
				<tr class="ie-needs-target">
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
					/* THE FIRST OPTION IS EMPTY, AND THAT IS THE WHOLE FIX.
					 *
					 * It used to submit the sentence "get in touch about this
					 * service". The server has carried a better answer since blog
					 * mode shipped — suggestTopics.js falls back to "read more
					 * about [the page] on this site" when no intent is given, and
					 * only when the site is NOT a local business.
					 *
					 * THAT FALLBACK HAS NEVER ONCE RUN. A <select> always submits
					 * something, the first option was never blank, so
					 * `targetPage.intent` was never empty and the `||` could not
					 * reach its right-hand side. Dead code that reads as a feature,
					 * which is the same shape as the cancel flag that could not be
					 * sent and the keyword that could not travel.
					 *
					 * SO EVERY CAMPAIGN ON A BLOG HAS BEEN TOLD its readers must
					 * end up wanting to "get in touch about this service" — on a
					 * site with no service and no phone number. The prompt calls
					 * that line "the hard constraint" and rejects topics against
					 * it, so it has been steering every topic set Edwin has
					 * generated on hilltophomeloans.net.
					 *
					 * Empty here, and both fallbacks wake up: a trade gets "use the
					 * business's [page] service", a blog gets "read more about
					 * [page] on this site". The label already says "no strong
					 * preference", which is now true rather than a sentence
					 * pretending to be none.
					 */
					$intent_options = array(
						''
							=> __( 'No strong preference — let the page decide', 'interlink-engine' ),
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
					<th scope="row"><label for="ie_intent_choice"><?php esc_html_e( 'Only for local business sites, ignore it for general blogs', 'interlink-engine' ); ?></label></th>
					<td>
						<select name="intent_choice" id="ie_intent_choice" class="regular-text">
							<?php foreach ( $intent_options as $sentence => $label ) : ?>
								<option value="<?php echo esc_attr( $sentence ); ?>" <?php selected( $is_listed && $current === $sentence ); ?>>
									<?php echo esc_html( $label ); ?>
								</option>
							<?php endforeach; ?>
						</select>
						<p class="description">
							<?php
							/* IT SAYS WHO IT IS FOR NOW, which is the whole edit.
							 *
							 * It opened "Most trades sell one of two nearby things"
							 * and explained the MECHANISM — why the setting exists —
							 * to an owner who only needs to know whether to touch it.
							 * On a lending blog the first clause is about somebody
							 * else's business, and the options below it are a trade
							 * list, so the honest answer there is "leave it alone".
							 * The text now says that in as many words.
							 *
							 * Same root cause as the descriptive anchor bucket and
							 * the town-in-titles rule: trade machinery running on a
							 * content blog. Those two were fixed by asking
							 * siteKind.js what kind of site it is. This one is fixed
							 * by telling the owner, which is cheaper and does not
							 * need the answer to be right. */
						?>
						<?php esc_html_e( 'This helps the model tell close intentions apart — “Repair” from “Replacement”, “Hire a professional” from “Get it diagnosed first”. On a general blog, leave the first option.', 'interlink-engine' ); ?>
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
							<?php esc_html_e( 'Only if the list misses your case. Anything here wins over the dropdown. Write what the reader should end up wanting — an action, not a keyword.', 'interlink-engine' ); ?>
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

			<script>
			/**
			 * Hide what a pillar campaign has no answer for.
			 *
			 * Three rows go: the Target Page, its keyword, and what the visitor
			 * should want after reading. All three describe a page being sold,
			 * and a pillar campaign is not selling one — leaving them on screen
			 * asks a question with no true answer, which is how a form teaches
			 * someone to invent one.
			 *
			 * The Suggest button carries the same class and goes with them, for
			 * the reason given where it is wrapped.
			 *
			 * PROGRESSIVE, NOT STRUCTURAL. The rows are rendered either way and
			 * only hidden here, so with JavaScript off the form still posts and
			 * read_form() still decides — the server has to make this judgement
			 * regardless, because a cached page can post anything. Hiding is a
			 * courtesy; the rule lives on the server.
			 *
			 * The hidden select keeps whatever it had, and that is fine:
			 * read_form() ignores target_page_id entirely when the box is
			 * ticked, rather than reading a value the owner cannot see.
			 */
			(function () {
				var box = document.getElementById('ie_is_pillar');
				if (!box) { return; }

				/* WAIT FOR THE REST OF THE FORM, and the first version did not.
				 *
				 * This <script> sits between the first table and everything
				 * below it — the topics box, the Suggest button, the hints.
				 * An inline script runs AS THE PARSER REACHES IT, so
				 * querySelectorAll ran against a document that stopped here:
				 * it found the three rows above and nothing below.
				 *
				 * The symptom was precise and misleading. The rows hid, the
				 * checkbox looked wired up, and the Suggest button sat there
				 * as if its class had been forgotten. Nothing errored, so the
				 * console said nothing either. ONLY THE HALF OF THE PAGE THAT
				 * HAD BEEN PARSED EXISTED, and it was the half that made the
				 * feature look like it worked.
				 *
				 * document.readyState is checked rather than assumed, because
				 * DOMContentLoaded does not fire again for a listener added
				 * after it has already gone off. */
				function wire() {
					var rows = document.querySelectorAll('#ie-campaign-form .ie-needs-target');
					var only = document.querySelectorAll('#ie-campaign-form .ie-pillar-only');
					var topics = document.getElementById('ie_topics');
					var hint = topics ? topics.getAttribute('placeholder') : '';

					function apply() {
						var pillar = box.checked;

						for (var j = 0; j < only.length; j++) {
							only[j].style.display = pillar ? '' : 'none';
						}

						for (var i = 0; i < rows.length; i++) {
							/* '' and not 'table-row' / 'inline'. The class is on
							 * <tr> elements AND on a <span>, so a hardcoded
							 * display value would be wrong for one of them.
							 * Clearing the property lets each go back to
							 * whatever the stylesheet says it is. */
							rows[i].style.display = pillar ? 'none' : '';
						}

						/* The placeholder tells people to press a button that
						 * is no longer on the page. A hint that names a
						 * missing control is worse than no hint. */
						if (topics) {
							topics.setAttribute('placeholder', pillar
								? <?php echo wp_json_encode( __( 'One per line. Four or five hub topics is usual — the Main keyword column is yours to fill in.', 'interlink-engine' ) ); ?>
								: hint);
						}
					}

					box.addEventListener('change', apply);
					apply();
				}

				if (document.readyState === 'loading') {
					document.addEventListener('DOMContentLoaded', wire);
				} else {
					wire();
				}
			}());
			</script>

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
							<?php
							/* TICK OR UNTICK THE LOT.
							 *
							 * Suggest topics returns up to twelve rows and the
							 * common editing move is "none of these except
							 * three" — twelve clicks to clear, then three to
							 * choose. The header box makes it two.
							 *
							 * IT IS NOT A FIELD. No name attribute, so it is
							 * never posted and read_topics() never sees it: the
							 * row boxes remain the only record of what was
							 * chosen. A control that submitted a value of its
							 * own would be a second opinion about the same
							 * fact.
							 *
							 * INDETERMINATE WHEN THE ROWS DISAGREE, rather than
							 * guessing a side. A half-ticked list shown as
							 * "ticked" invites one click that silently unticks
							 * everything the owner just chose. */
							?>
							<th style="width:2rem">
								<input type="checkbox" id="ie_use_all" checked
									title="<?php esc_attr_e( 'Tick or untick every topic', 'interlink-engine' ); ?>">
							</th>
							<th style="width:36%"><?php esc_html_e( 'Topic', 'interlink-engine' ); ?></th>
							<?php
							/* NAMED FOR WHAT THEY ARE, not for what they do.
							 *
							 * "Search it should win" described the purpose and
							 * left the owner to work out that the thing in the
							 * box is a keyword — the same word used on the
							 * Target Page field two screens away, and on every
							 * SEO tool they have ever used. Two names for one
							 * concept is how a form teaches somebody that it
							 * has more ideas in it than it really does.
							 *
							 * "How other posts refer to it" was accurate and
							 * read as a description rather than an
							 * instruction. "Will link to this post" says what
							 * the value becomes: the blue text in a sentence
							 * somewhere else. */
							?>
							<th style="width:19%"><?php esc_html_e( 'Main keyword of this post', 'interlink-engine' ); ?></th>
							<th style="width:22%"><?php esc_html_e( 'How other posts will link to this post', 'interlink-engine' ); ?></th>
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

				<script>
				/**
				 * The header box drives the row boxes, and the row boxes drive
				 * the header box back.
				 *
				 * ONE WAY WOULD BE A LIE. Tick all, untick one row, and a
				 * header still showing ticked claims every topic is in — and
				 * the next click on it would untick the eleven the owner had
				 * just kept. So the rows report upward as well: all ticked,
				 * none ticked, or indeterminate.
				 *
				 * SCOPED TO THIS TABLE by starting from the header box's own
				 * <table>, not by querying the document. The campaign form has
				 * other checkboxes on it — the pillar box, the home-page box —
				 * and a selector loose enough to reach them would turn "untick
				 * every topic" into "untick everything on the screen".
				 *
				 * Progressive enhancement: with script off the header box does
				 * nothing and has no name, so nothing is posted and nothing is
				 * lost. The row boxes still work by hand, as they always did.
				 */
				(function () {
					var all = document.getElementById('ie_use_all');
					if (!all) { return; }

					var table = all.closest('table');
					if (!table) { return; }

					function rows() {
						return table.querySelectorAll('tbody input[type="checkbox"]');
					}

					function sync() {
						var boxes = rows();
						var on = 0;

						for (var i = 0; i < boxes.length; i++) {
							if (boxes[i].checked) { on++; }
						}

						all.checked = boxes.length > 0 && on === boxes.length;
						all.indeterminate = on > 0 && on < boxes.length;
					}

					all.addEventListener('change', function () {
						/* indeterminate is cleared by the browser on click, so
						 * the value read here is already the one the owner
						 * asked for — ticked from a part-ticked list means
						 * "all of them". */
						var boxes = rows();
						for (var i = 0; i < boxes.length; i++) {
							boxes[i].checked = all.checked;
						}
						all.indeterminate = false;
					});

					table.addEventListener('change', function (e) {
						if (e.target && e.target !== all && 'checkbox' === e.target.type) {
							sync();
						}
					});

					sync();
				}());
				</script>
			<?php else : ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="ie_topics"><?php esc_html_e( 'Your own topics', 'interlink-engine' ); ?></label></th>
						<td>
							<textarea name="topics" id="ie_topics" rows="8" class="large-text"
								placeholder="<?php esc_attr_e( 'One per line. Or leave empty and press Suggest topics.', 'interlink-engine' ); ?>"></textarea>
							<?php
							/* Two hints, one shown at a time, rather than one
							 * sentence swapped by script like the placeholder
							 * above it.
							 *
							 * The placeholder is an ATTRIBUTE — there is no
							 * element to hide, so the script has to rewrite the
							 * string, and the original has to be stashed to put
							 * back. This is an element, so the existing
							 * show/hide does it with no new mechanism and no
							 * second copy of the text living in JavaScript.
							 *
							 * "Three to six months worth" is the silo hint: ten
							 * or more articles on a cadence. A pillar campaign
							 * is four or five hubs and is finished. */
							?>
							<p class="description ie-needs-target"><?php esc_html_e( 'Three to six months worth. Order is publish order.', 'interlink-engine' ); ?></p>
							<p class="description ie-pillar-only" style="display:none"><?php esc_html_e( 'Four or five is usual. Order is publish order, and they ring together in that order.', 'interlink-engine' ); ?></p>
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
				<?php
				/* WRAPPED SO THE BUTTON AND ITS HINT GO TOGETHER.
				 *
				 * The server suggests topics FOR a target page. With no page
				 * there is nothing to suggest from and handle_suggest() turns
				 * the press away — so for a pillar campaign this button is a
				 * control that is visible and refuses, which is worse than one
				 * that is not there.
				 *
				 * The same class the hidden rows use, so one line of script
				 * governs everything that assumes a target page. A second
				 * mechanism for the same rule is a second thing to forget. */
				?>
				<span class="ie-needs-target">
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
				</span>

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

			<?php
			/* Goes with the Suggest button, for the same reason the button's
			 * own hint does: it reassures about a control that is not on the
			 * page. The second half — nothing is charged until a post is
			 * written — is true either way, and is repeated below so a pillar
			 * campaign still says it. */
			?>
			<p class="description ie-needs-target">
				<?php esc_html_e( 'Suggesting topics is free. Nothing is charged until a post is actually written.', 'interlink-engine' ); ?>
			</p>

			<?php
			/* HIDDEN IN THE MARKUP, shown by the script. The pre-JavaScript
			 * state of this form is "an ordinary campaign" — every
			 * .ie-needs-target visible, every .ie-pillar-only hidden — which
			 * is the right thing to degrade to: with the script blocked the
			 * form still describes the campaign most people are making. */
			?>
			<p class="description ie-pillar-only" style="display:none">
				<?php esc_html_e( 'Nothing is charged until a post is actually written.', 'interlink-engine' ); ?>
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

	/**
	 * The search term for the target page, in order of who actually knows it.
	 *
	 * THREE SOURCES, AND THE MIDDLE ONE IS NEW. It used to be two: what the
	 * owner typed on this form, or a guess from the page title.
	 *
	 * 1. WHAT THEY TYPED HERE wins, always. They are looking at this campaign
	 *    and this page, and an answer given now beats one given months ago.
	 *
	 * 2. WHAT THEY TYPED WHEN THEY BUILT THE PILLAR. A pillar campaign asks
	 *    "Main keyword of this post" for every post and refuses to plan without it.
	 *    That answer is stamped onto the post at publish, and reading it back
	 *    here is the whole point of stamping it: the owner should not be asked
	 *    the same question twice.
	 *
	 * 3. THE TITLE, derived. Still correct for an ordinary service page —
	 *    "Water Heater Repair | Acme Plumbing" gives "water heater repair", and
	 *    keyword_from_title() strips the brand, the town and the state to get
	 *    there. It is only a bad answer for an ARTICLE, whose title is a
	 *    headline, and source 2 is what now covers those.
	 *
	 * THE FALLBACK STAYS, and that is not tidiness. Every pillar already
	 * published on every site carries no keyword meta, because the field did
	 * not exist when they published. Dropping the fallback would leave each of
	 * them with no keyword at all, which is worse than a bad one — the same
	 * backward-compatibility shape as the approval gate in run_campaign().
	 */
	private static function read_keyword( $page ) {
		$typed = isset( $_POST['keyword'] ) ? sanitize_text_field( wp_unslash( $_POST['keyword'] ) ) : '';

		if ( '' !== trim( $typed ) ) {
			return trim( $typed );
		}

		$stored = self::stored_keyword( $page );

		if ( '' !== $stored ) {
			return $stored;
		}

		$business = IE_Settings::business();
		return self::keyword_from_title(
			get_the_title( $page ),
			isset( $business['town'] ) ? $business['town'] : ''
		);
	}

	/**
	 * What to call a slot on screen: the published headline, or the topic.
	 *
	 * THE TWO ARE NOT THE SAME SENTENCE, and the campaign card showed the
	 * wrong one for its whole life. The topic is what the owner ticked at
	 * planning time; the headline is what the model actually wrote, hours or
	 * days later. Edwin's own campaign, 7 October:
	 *
	 *     topic     Conditional Approval Can Still Leave a Business Loan
	 *               Unfunded
	 *     headline  Conditional Approval for a Business Loan: What the Meaning
	 *               Is Before Funding
	 *
	 * So the card named a post nobody could find on the site, and the link
	 * beside it opened something with a different title.
	 *
	 * THE HEADLINE IS THE H1. IE_Publisher writes post_title from
	 * written.title, the theme renders that as the H1, and IE_SEO writes the
	 * <title> tag from the same value — one string wearing three hats, which
	 * is why asking for "the H1" and asking for the post title are the same
	 * request today. The day a title-tag template arrives they part company,
	 * and this reads post_title, which is the H1 of the two.
	 *
	 * FALLS BACK TO THE TOPIC, and that is not belt-and-braces: every slot is
	 * shown before it is written, when there is no post and no headline. A
	 * blank cell there would be worse than the old wrong one.
	 *
	 * @param int    $post_id  the slot's post, 0 before it is written
	 * @param string $fallback the topic, used when there is no post title
	 */
	public static function headline( $post_id, $fallback = '' ) {
		$post_id = (int) $post_id;

		if ( $post_id ) {
			$title = get_the_title( $post_id );

			if ( '' !== trim( (string) $title ) ) {
				return $title;
			}
		}

		return (string) $fallback;
	}

	/**
	 * The keyword a pillar was planned to win, if this post is one and carries
	 * it.
	 *
	 * Its own method because the FORM needs it as well as the handler: the box
	 * is pre-filled from the dropdown by script, and a default that disagrees
	 * with what the server will store is a screen that lies about what it is
	 * going to do.
	 */
	public static function stored_keyword( $page ) {
		$post_id = is_object( $page ) ? ( isset( $page->ID ) ? (int) $page->ID : 0 ) : (int) $page;

		if ( ! $post_id ) {
			return '';
		}

		return trim( (string) get_post_meta( $post_id, IE_Settings::KEYWORD_META, true ) );
	}

	/**
	 * Why the last read_form() returned null, when "no page chosen" is wrong.
	 *
	 * read_form() answers null for every failure and three handlers turn that
	 * into "Choose a page for the campaign to feed." That is the right
	 * sentence when the dropdown was left alone and a useless one when the
	 * owner pasted a URL that did not resolve — they DID choose, and the
	 * message tells them to do the thing they just did.
	 */
	private static $form_error = '';

	/** The message for the last failure, or '' to use the caller's default. */
	public static function form_error() {
		return self::$form_error;
	}

	/**
	 * Redirect arguments that put the owner back where they were.
	 *
	 * Reads $_POST rather than taking a parameter, because all three callers
	 * are handling the same submission and none of them has the value — it
	 * was read and rejected inside read_form(). esc_url_raw on the way out as
	 * well as on the way in: this lands in a URL the browser will follow, and
	 * the value failed validation moments ago.
	 */
	private static function failed_url_args() {
		$args = array( 'tab' => 'new' );

		$typed = isset( $_POST['target_url'] ) ? esc_url_raw( trim( wp_unslash( $_POST['target_url'] ) ) ) : '';

		if ( '' !== $typed ) {
			$args['target_url'] = $typed;
		}

		return $args;
	}

	/**
	 * A URL typed into the box, turned into a post id.
	 *
	 * WHY THIS BOX EXISTS. IE_Settings::target_pages() offers every published
	 * PAGE plus every published post carrying `_ie_is_pillar`, and only this
	 * plugin ever stamps that. So an owner whose hub is a post they wrote by
	 * hand has nothing to select, and the campaign cannot be aimed at the one
	 * page on the site that matters. Edwin asked for this on 4 October.
	 *
	 * RESOLVED TO A REAL POST, NOT ACCEPTED AS TEXT — and that decision is
	 * the whole design. The first sketch stored the typed string as
	 * targetPage.url and asked the owner for a keyword and a title alongside
	 * it, which meant three new fields, a second shape for everything
	 * downstream to understand, and no way at all to notice a typo. A typo
	 * there is not cosmetic: nothing re-checks a link after it is written, so
	 * every post in the silo would point at a 404 and the first anyone knew
	 * would be weeks later.
	 *
	 * url_to_postid() answers the question properly. What comes back is an
	 * ordinary post id, so the title and the keyword come from the post
	 * itself and NOTHING DOWNSTREAM LEARNS THERE WAS A SECOND WAY IN.
	 *
	 * It also refuses, for free, everything that needed refusing: another
	 * site's URL, a mistyped slug, an archive, a category. There is no
	 * home-URL comparison here because there is nothing to compare — a URL
	 * that is not on this site resolves to nothing.
	 *
	 * @param string $raw what was typed
	 * @return int the post id, or 0 with self::$form_error set
	 */
	private static function resolve_target_url( $raw ) {
		$url = esc_url_raw( trim( $raw ) );

		if ( '' === $url ) {
			return 0;
		}

		$id = (int) url_to_postid( $url );

		/* THE FRONT PAGE RESOLVES TO NOTHING, and on a blog built by this
		 * plugin the front page is a pillar — the likeliest thing anyone
		 * pastes. url_to_postid() answers 0 for the site root because the
		 * root is a setting rather than a permalink. */
		if ( ! $id && untrailingslashit( $url ) === untrailingslashit( home_url( '/' ) ) ) {
			$id = (int) get_option( 'page_on_front' );
		}

		if ( ! $id ) {
			self::$form_error = __( 'That URL does not match a post or page on this site. Copy it from the address bar while viewing the page.', 'interlink-engine' );
			return 0;
		}

		$post = get_post( $id );

		if ( ! $post || ! in_array( $post->post_type, array( 'post', 'page' ), true ) ) {
			self::$form_error = __( 'That URL is not a post or a page.', 'interlink-engine' );
			return 0;
		}

		/* PUBLISHED ONLY, for the same reason target_pages() is.
		 * A scheduled or draft post has a URL that returns 404 to the public,
		 * and a silo aimed at one would spend a quarter linking to nothing. */
		if ( 'publish' !== $post->post_status ) {
			self::$form_error = __( 'That page is not published yet. Publish it first, then point the campaign at it.', 'interlink-engine' );
			return 0;
		}

		return $id;
	}

	/** The shared part of both submit buttons: what the form said about the page. */
	private static function read_form() {
		/* A PILLAR CAMPAIGN HAS NO TARGET PAGE, AND IS NOT MISSING ONE.
		 *
		 * This function returned null without a page and three handlers read
		 * that as "the owner forgot to choose one". For a pillar campaign
		 * there is nothing to choose: the posts link to each other.
		 *
		 * THE FLAG IS THE AUTHORITY, NOT THE ABSENCE. The hidden <select>
		 * still posts whatever it held — the browser submits hidden controls —
		 * so "no page selected" and "pillar campaign" are different states
		 * that can both be true at once, or neither. Reading the checkbox
		 * means a page left over from before the box was ticked is ignored
		 * rather than quietly used, and a genuinely forgotten page is still
		 * refused.
		 */
		$is_pillar = isset( $_POST['is_pillar'] ) && '1' === (string) wp_unslash( $_POST['is_pillar'] );

		if ( $is_pillar ) {
			/* Every page-shaped field is deliberately absent rather than ''.
			 * An empty string would validate, travel to the server as
			 * targetPage.url, and produce posts linking to nothing. The
			 * callers below test is_pillar; a field that is not here cannot
			 * be used by accident. */
			return array(
				'is_pillar'      => true,

				/* ONLY READ INSIDE THIS BRANCH, which is the guard.
				 *
				 * The box is hidden unless the pillar box is ticked, and
				 * hiding is a courtesy — a form posted with JavaScript off, or
				 * from a cached page, can carry home_page on an ordinary
				 * campaign. Reading it only here means a silo campaign cannot
				 * claim the front page however it was submitted. */
				'home_page'      => isset( $_POST['home_page'] ) && '1' === (string) wp_unslash( $_POST['home_page'] ),

				'video_url'      => isset( $_POST['video_url'] ) ? esc_url_raw( trim( wp_unslash( $_POST['video_url'] ) ) ) : '',
				'every_days'     => isset( $_POST['every_days'] ) ? max( 1, min( 90, (int) $_POST['every_days'] ) ) : 14,
				'publish_time'   => isset( $_POST['publish_time'] ) ? sanitize_text_field( wp_unslash( $_POST['publish_time'] ) ) : '09:00',
				'publish_mode'   => ( isset( $_POST['publish_mode'] ) && 'draft' === $_POST['publish_mode'] ) ? 'draft' : 'future',
			);
		}

		self::$form_error = '';

		/* THE TYPED URL WINS WHEN THERE IS ONE, the same way the keyword and
		 * intent text boxes already beat their dropdowns. One rule for all
		 * three: a box someone has typed in is a decision, and a select left
		 * alone is not. */
		$page_id = self::resolve_target_url(
			isset( $_POST['target_url'] ) ? (string) wp_unslash( $_POST['target_url'] ) : ''
		);

		if ( ! $page_id && '' !== self::$form_error ) {
			return null;
		}

		if ( ! $page_id ) {
			$page_id = isset( $_POST['target_page_id'] ) ? (int) $_POST['target_page_id'] : 0;
		}

		$page = $page_id ? get_post( $page_id ) : null;

		if ( ! $page ) {
			return null;
		}

		return array(
			'is_pillar'      => false,
			// Said, not omitted. Every reader of $form can then ask the same
			// question of either shape without an isset() first.
			'home_page'      => false,
			'target_page_id' => $page_id,

			/* KEPT SO THE DRAFT CAN PUT IT BACK, and without it the feature
			 * breaks on its second step rather than its first.
			 *
			 * "Review topics" stores this array and re-renders the form. A
			 * URL-chosen page is BY DEFINITION not in the dropdown, so
			 * nothing would be selected and the box would be empty — and the
			 * next submit would fall through to the dropdown, find nothing,
			 * and refuse a campaign the owner had already set up correctly. */
			'target_url'     => isset( $_POST['target_url'] ) ? esc_url_raw( trim( wp_unslash( $_POST['target_url'] ) ) ) : '',

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
			/* THE TYPED URL TRAVELS BACK WITH THE ERROR. Without it the box
			 * is empty on the page that says the URL was wrong, so the owner
			 * is told to fix something they can no longer see. The draft
			 * transient cannot help here — it is only written once the form
			 * has been accepted, which is exactly what did not happen. */
			self::redirect(
				'interlink-engine',
				'error',
				self::form_error() ? self::form_error() : __( 'Choose a page for the campaign to feed.', 'interlink-engine' ),
				self::failed_url_args()
			);
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
			/* THE TYPED URL TRAVELS BACK WITH THE ERROR. Without it the box
			 * is empty on the page that says the URL was wrong, so the owner
			 * is told to fix something they can no longer see. The draft
			 * transient cannot help here — it is only written once the form
			 * has been accepted, which is exactly what did not happen. */
			self::redirect(
				'interlink-engine',
				'error',
				self::form_error() ? self::form_error() : __( 'Choose a page for the campaign to feed.', 'interlink-engine' ),
				self::failed_url_args()
			);
		}

		/* THERE IS NOTHING TO SUGGEST FROM.
		 *
		 * /api/blog/suggest takes a target page and proposes topics that would
		 * feed it. A pillar campaign has no target page, so the request has no
		 * subject — target_page_payload() below would read four keys that
		 * read_form() deliberately did not set.
		 *
		 * The button is hidden for a pillar campaign, so reaching this means
		 * JavaScript is off, or the page was cached, or the form was posted by
		 * hand. REFUSED HERE RATHER THAN TRUSTED TO THE HIDING: a rule enforced
		 * only in the browser is a rule, and the sentence says what to do
		 * instead rather than just saying no. */
		if ( ! empty( $form['is_pillar'] ) ) {
			self::redirect(
				'interlink-engine',
				'error',
				__( 'Pillar topics are yours to choose — type them in, one per line, then press Review these topics.', 'interlink-engine' ),
				array( 'tab' => 'new' )
			);
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
			/* THE TYPED URL TRAVELS BACK WITH THE ERROR. Without it the box
			 * is empty on the page that says the URL was wrong, so the owner
			 * is told to fix something they can no longer see. The draft
			 * transient cannot help here — it is only written once the form
			 * has been accepted, which is exactly what did not happen. */
			self::redirect(
				'interlink-engine',
				'error',
				self::form_error() ? self::form_error() : __( 'Choose a page for the campaign to feed.', 'interlink-engine' ),
				self::failed_url_args()
			);
		}

		$is_pillar   = ! empty( $form['is_pillar'] );
		$target_page = $is_pillar ? null : self::target_page_payload( $form );
		$topics      = self::collect_topics();

		if ( empty( $topics ) ) {
			self::redirect( 'interlink-engine', 'error', __( 'Add some topics, or press Suggest topics.', 'interlink-engine' ), array( 'tab' => 'new' ) );
		}

		/* TWO POSTS IS THE FLOOR FOR A PILLAR CAMPAIGN.
		 *
		 * The server refuses one too — a single pillar has no sibling and no
		 * money page, so it would publish with NO outbound links at all, and
		 * pass every quality check, because each link assertion is conditional
		 * on the link having been asked for.
		 *
		 * Said here as well, because here is where the owner finds out, in a
		 * sentence that explains itself rather than as a bare 400. */
		if ( $is_pillar && count( $topics ) < 2 ) {
			self::redirect(
				'interlink-engine',
				'error',
				__( 'A pillar campaign needs at least two posts — pillars link to each other, so a single one would have nothing to link to.', 'interlink-engine' ),
				array( 'tab' => 'new' )
			);
		}

		// A topic typed by hand has no target query, and planning refuses one
		// without it. Derived here rather than leaving the owner to meet that
		// refusal cold.
		$missing = array_filter( $topics, function ( $t ) {
			return empty( $t['targetQuery'] );
		} );

		/* ENRICH CANNOT HELP A PILLAR CAMPAIGN, so it is not asked.
		 *
		 * /api/blog/enrich derives a search query for a topic BY REFERENCE TO
		 * THE TARGET PAGE — it is answering "what would someone search that
		 * this post could win, without competing with the page it feeds?".
		 * There is no page here, so the question has no subject.
		 *
		 * The owner fills the Main keyword column instead, and is told so.
		 * Without this the plan would be refused by the server with a
		 * `missing` conflict per topic, which is correct and says nothing
		 * about what to do about it. */
		if ( $missing && $is_pillar ) {
			self::redirect(
				'interlink-engine',
				'error',
				sprintf(
					/* translators: %s: the topics with no main keyword, comma-separated */
					__( 'Fill in the Main keyword column for: %s. A pillar campaign has no target page to work it out from.', 'interlink-engine' ),
					implode( ', ', wp_list_pluck( $missing, 'topic' ) )
				),
				array( 'tab' => 'new' )
			);
		}

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

		/* THE CAMPAIGN'S NAME, which normally comes from the target page.
		 *
		 * A pillar campaign has no page to be named after, so it takes the
		 * first topic — the same rule campaignPlan.js uses for its own
		 * suggestedName, so the two sides agree rather than one inventing
		 * "Pillars" and the other something else.
		 *
		 * A new FIELD was the obvious alternative and is worse: one more thing
		 * to fill in, on a form that already asks enough, to produce a string
		 * that is derivable. */
		/* reset() INTO A VARIABLE, not `reset( $topics )['topic']`. Indexing a
		 * function's return value directly is fine from PHP 5.4, but reset()
		 * takes its argument BY REFERENCE and PHP 7.4 emits "Only variables
		 * should be passed by reference" for it — a notice on every plan, in
		 * a log the owner may be watching. */
		$first = $topics ? reset( $topics ) : array();

		$label = $is_pillar
			? sprintf(
				/* translators: %s: the first pillar's topic */
				__( 'Pillars: %s', 'interlink-engine' ),
				isset( $first['topic'] ) ? $first['topic'] : __( 'hub posts', 'interlink-engine' )
			)
			: $form['title'];

		$payload = array(
			'name'     => $label,

			/* THE FLAG. Always sent, both ways round, so the server is never
			 * left inferring the shape of the campaign from what is missing. */
			'isPillar' => $is_pillar,

			'topics'   => array_values( $topics ),
			'linkMode' => 'standalone',
			'schedule' => array(
				'everyDays'   => $form['every_days'],
				'publishTime' => $form['publish_time'],
				// The server turns cadence plus wall-clock time into real
				// instants, and needs the zone to do it — 09:00 has to mean
				// nine in the morning where the business is.
				'timezone'    => wp_timezone_string(),
			),
		);

		/* NO targetPage KEY AT ALL for a pillar campaign, rather than null.
		 *
		 * BUILT WITH AN `if` AND NOT ARRAY UNPACKING, which is the actual
		 * lesson here. The first version of this used
		 * `...( $is_pillar ? array() : array( 'targetPage' => … ) )` — neat,
		 * and a FATAL PARSE ERROR on PHP 7.4 and 8.0, because unpacking an
		 * array with STRING keys only arrived in 8.1. This plugin's header
		 * says "Requires PHP: 7.4", it runs on customers' hosting, and a parse
		 * error takes down the whole file rather than this one function: every
		 * site on an older PHP would have gone white on upgrade.
		 *
		 * It passed `php -l` on the machine it was written on, which is the
		 * part worth remembering. A SYNTAX CHECK PROVES THE SYNTAX IS VALID
		 * FOR THE INTERPRETER RUNNING IT, and nothing about the one the
		 * customer has. */
		if ( ! $is_pillar ) {
			$payload['targetPage'] = $target_page;
		}

		$plan = IE_Api::plan( $payload );

		if ( is_wp_error( $plan ) ) {
			self::redirect( 'interlink-engine', 'error', $plan->get_error_message(), array( 'tab' => 'new' ) );
		}

		$settings = array(
			'label'        => $label,
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

			/* Also never sent to the server, for the same reason as the video:
			 * which post type WordPress uses and which page sits at the root
			 * are facts about THIS SITE, not about the campaign the server
			 * planned. The server writes identical content either way.
			 *
			 * read_form() only sets this true inside its pillar branch, so a
			 * silo campaign cannot arrive here carrying it. */
			'home_page'    => ! empty( $form['home_page'] ),
		);

		/* target_page OMITTED for a pillar campaign.
		 *
		 * create_from_plan() falls back to array(), which every campaign
		 * screen then has to survive — and the screens were written when an
		 * absent target page was impossible, so they index straight into
		 * ['url'] and ['title']. Those reads are now guarded; this is the
		 * only thing that produces the case they guard against.
		 *
		 * Note is_pillar is NOT passed here. create_from_plan reads it from
		 * the plan response, so the flag has one source — the campaign the
		 * server actually created — rather than two that can disagree. */
		if ( ! $is_pillar ) {
			$settings['target_page'] = array(
				'id'      => $form['target_page_id'],
				'title'   => $form['title'],
				'url'     => $form['url'],
				'keyword' => $form['keyword'],
				'intent'  => $form['intent'],
			);
		}

		$campaign = IE_Campaigns::create_from_plan( $plan, $settings );

		if ( is_wp_error( $campaign ) ) {
			self::redirect( 'interlink-engine', 'error', $campaign->get_error_message(), array( 'tab' => 'new' ) );
		}

		delete_transient( self::DRAFT_TRANSIENT . get_current_user_id() );

		/* "feeding X" is false for a pillar campaign — it feeds nothing yet;
		 * that is what makes it a pillar campaign. A log line that says
		 * `feeding ""` is the kind of thing that gets read six months later as
		 * a bug in the target page rather than as a campaign with no target. */
		IE_Publisher::log( $is_pillar
			? sprintf(
				'pillar campaign %s planned: %d posts, ringed to each other',
				$campaign['id'], count( $campaign['slots'] )
			)
			: sprintf(
				'campaign %s planned: %d posts feeding "%s"',
				$campaign['id'], count( $campaign['slots'] ), $form['title']
			)
		);

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

		/* THE ONE CALLER ALLOWED TO SPEND MONEY, and the only one that passes
		 * true. run_campaign() refuses by default now: a planned campaign is
		 * 'active' with pending slots from the moment it is created, which is
		 * precisely what the hourly cron looks for, so until today the sweep
		 * could write and charge a campaign nobody had approved.
		 *
		 * This is the approval. Both buttons that reach here — the priced
		 * "Write all N posts" and the free "Check now" — are the owner, on
		 * their own screen, behind a nonce and a confirm dialog that states
		 * the cost. Nothing else in the plugin can say that. */
		$result = IE_Publisher::run_campaign( $campaign_id, true );

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
	 * Publish every scheduled post in a pillar campaign, now.
	 *
	 * WHY IT EXISTS. A pillar is a hub a later campaign points at, and
	 * IE_Settings::target_pages() lists only posts with status `publish` — on
	 * purpose, because a `future` post's permalink answers 404 to the public
	 * and aiming ten articles at it would be aiming them at nothing. So a
	 * pillar is useless until it is live, and "Publish early" is per slot:
	 * five pillars meant five presses, each with its own confirmation.
	 *
	 * PILLAR CAMPAIGNS ONLY, which is the whole design decision here.
	 *
	 * On a silo campaign the schedule IS the product — twelve posts spread over
	 * three months is what the customer planned and paid for, and one click
	 * that dates them all today cannot be undone. A post cannot be
	 * un-published back onto a schedule. A pillar campaign has no such plan to
	 * destroy: every one of its posts is meant to be live immediately, which is
	 * exactly why the control is wanted here and nowhere else.
	 *
	 * The guard is repeated here rather than left to the link being hidden.
	 * This URL is reachable by hand and from a stale browser tab, and what it
	 * does is irreversible.
	 */
	public static function handle_publish_all() {
		check_admin_referer( 'ie_publish_all' );
		self::require_caps();

		$campaign_id = isset( $_GET['campaign'] ) ? sanitize_text_field( wp_unslash( $_GET['campaign'] ) ) : '';
		$campaign    = IE_Campaigns::get( $campaign_id );

		if ( ! $campaign ) {
			self::redirect( 'interlink-engine', 'error', __( 'That campaign could not be found.', 'interlink-engine' ) );
		}

		if ( empty( $campaign['is_pillar'] ) ) {
			self::redirect(
				'interlink-engine',
				'error',
				__( 'Publishing everything at once is only offered for pillar campaigns. On a scheduled campaign the dates are the point, and publishing them all today cannot be undone — use Publish early on the rows you want.', 'interlink-engine' )
			);
		}

		$published = 0;
		$skipped   = 0;
		$failed    = array();

		foreach ( (array) $campaign['slots'] as $slot ) {
			/* Only `scheduled`. One already published needs nothing, and one
			 * still `pending` has no post to publish — publish_now() against an
			 * id of 0 is the no-op that would report success. */
			if ( ! isset( $slot['status'] ) || 'scheduled' !== $slot['status'] ) {
				continue;
			}

			if ( empty( $slot['post_id'] ) ) {
				continue;
			}

			/* THE SLOT HAVING AN ID IS NOT THE SAME AS THE POST EXISTING, and
			 * this loop is where it matters most. A deleted post leaves its id
			 * behind; wp_update_post() answers 0 for a missing id rather than a
			 * WP_Error, so without this the owner is told five posts went live
			 * when two of them do not exist. Counted as skipped and said out
			 * loud — a number that quietly includes ghosts is worse than a
			 * smaller number that is true. */
			if ( IE_Campaigns::post_missing( $slot ) ) {
				$skipped++;
				continue;
			}

			$result = IE_Publisher::publish_now( (int) $slot['post_id'] );

			if ( is_wp_error( $result ) ) {
				/* ONE FAILURE DOES NOT STOP THE REST. Stopping would leave the
				 * campaign half published with no way to tell which half
				 * without reading the table, and the owner would press the
				 * button again — re-publishing what already went live. */
				$failed[] = $result->get_error_message();
				continue;
			}

			$published++;
		}

		if ( ! $published && ! $skipped && ! $failed ) {
			self::redirect(
				'interlink-engine',
				'error',
				__( 'Nothing was waiting to publish — every post in this campaign is already live.', 'interlink-engine' )
			);
		}

		$message = sprintf(
			/* translators: %d: how many posts were published */
			_n( '%d post published.', '%d posts published.', $published, 'interlink-engine' ),
			$published
		);

		if ( $skipped ) {
			$message .= ' ' . sprintf(
				/* translators: %d: how many posts no longer exist */
				_n(
					'%d was skipped — that post no longer exists on this site.',
					'%d were skipped — those posts no longer exist on this site.',
					$skipped,
					'interlink-engine'
				),
				$skipped
			);
		}

		if ( $failed ) {
			$message .= ' ' . sprintf(
				/* translators: 1: how many failed, 2: the first error message */
				__( '%1$d could not be published: %2$s', 'interlink-engine' ),
				count( $failed ),
				$failed[0]
			);
		}

		IE_Publisher::log( sprintf(
			'publish all on pillar campaign %s: %d published, %d skipped, %d failed',
			$campaign_id, $published, $skipped, count( $failed )
		) );

		self::redirect( 'interlink-engine', $failed ? 'error' : 'published', $message );
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

		/* THE TITLE COUNT IS PART OF "NOTHING TO REPAIR".
		 *
		 * It was not, at first: the early-exit tested only the two link
		 * counters, so a run that fixed forty search-result titles and no
		 * links announced "Nothing to repair" and looked like a no-op. A
		 * gate in front of a message has to count everything the message is
		 * allowed to mention. */
		if ( ! $stats['restored'] && ! $stats['unwrapped'] && empty( $stats['titles'] ) ) {
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

		if ( ! empty( $stats['titles'] ) ) {
			$parts[] = sprintf(
				/* translators: %d: number of posts whose search-result title was fixed */
				_n(
					"%d post's search-result title no longer has your domain stuck on the end",
					"%d posts' search-result titles no longer have your domain stuck on the end",
					$stats['titles'],
					'interlink-engine'
				),
				$stats['titles']
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
			'hygiene_saved' => array( 'success', __( 'Saved. The line under the dropdown says what it does on this site.', 'interlink-engine' ) ),
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
