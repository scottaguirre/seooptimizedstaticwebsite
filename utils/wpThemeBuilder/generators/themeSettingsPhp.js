// utils/wpThemeBuilder/generators/themeSettingsPhp.js

const { makePhpIdentifier } = require('../wpHelpers/phpHelpers');

/**
 * Generate the inc/theme-settings.php file
 * This creates an admin settings page for global options
 *
 * @param {object} options - Configuration options
 * @param {string} options.themeSlug - Theme slug
 * @param {string} options.themeName - Theme display name
 * @returns {string} - Complete PHP code for theme-settings.php
 */
function generateThemeSettingsPhp(options = {}) {
  const {
    themeSlug = 'local-business-theme',
    themeName = 'Local Business Theme',
  } = options;

  const funcPrefix = makePhpIdentifier(themeSlug);
  // Upper-case prefix for the optional wp-config.php constant, so a client
  // can keep the SMTP password out of the database.
  const constPrefix = funcPrefix.toUpperCase();

  return `<?php
/**
 * Theme Settings Page
 * 
 * Admin page for editing global site settings
 * (business info, contact details, social links)
 *
 * @package ${themeSlug}
 */

// Prevent direct access
if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * Add settings page under Appearance menu
 */
function ${funcPrefix}_add_settings_page() {
    add_theme_page(
        __( 'Theme Settings', '${themeSlug}' ),
        __( 'Theme Settings', '${themeSlug}' ),
        'manage_options',
        '${themeSlug}-settings',
        '${funcPrefix}_render_settings_page'
    );
}
add_action( 'admin_menu', '${funcPrefix}_add_settings_page' );

/**
 * Render the settings page
 */
function ${funcPrefix}_render_settings_page() {
    // Check permissions
    if ( ! current_user_can( 'manage_options' ) ) {
        return;
    }

    // Handle form submission
    if ( isset( $_POST['${funcPrefix}_save_settings'] ) ) {
        // Verify nonce
        if ( ! isset( $_POST['${funcPrefix}_settings_nonce'] ) ||
             ! wp_verify_nonce( $_POST['${funcPrefix}_settings_nonce'], '${funcPrefix}_save_settings' ) ) {
            add_settings_error( '${funcPrefix}_messages', '${funcPrefix}_error', __( 'Security check failed.', '${themeSlug}' ), 'error' );
        } else {
            // Save settings
            ${funcPrefix}_save_settings();
            add_settings_error( '${funcPrefix}_messages', '${funcPrefix}_success', __( 'Settings saved successfully.', '${themeSlug}' ), 'updated' );
        }
    }

    // Test send. Separate nonce from the settings form so it cannot be
    // triggered by saving, and reports the real SMTP error rather than a
    // generic failure — that error message is what makes it debuggable.
    if ( isset( $_POST['${funcPrefix}_do_smtp_test'] ) ) {
        if ( ! isset( $_POST['${funcPrefix}_smtp_test_nonce'] ) ||
             ! wp_verify_nonce( $_POST['${funcPrefix}_smtp_test_nonce'], '${funcPrefix}_smtp_test' ) ) {
            add_settings_error( '${funcPrefix}_messages', '${funcPrefix}_error', __( 'Security check failed.', '${themeSlug}' ), 'error' );
        } else {
            $to = isset( $_POST['${funcPrefix}_test_to'] )
                ? sanitize_email( wp_unslash( $_POST['${funcPrefix}_test_to'] ) )
                : get_option( 'admin_email' );

            if ( ! is_email( $to ) ) {
                add_settings_error( '${funcPrefix}_messages', '${funcPrefix}_error', __( 'Enter a valid email address to test.', '${themeSlug}' ), 'error' );
            } else {
                delete_transient( '${funcPrefix}_last_mail_error' );

                $sent = wp_mail(
                    $to,
                    __( 'Test email from your website', '${themeSlug}' ),
                    __( 'If you are reading this, your contact form emails will be delivered correctly.', '${themeSlug}' )
                );

                if ( $sent ) {
                    add_settings_error(
                        '${funcPrefix}_messages', '${funcPrefix}_sent',
                        sprintf( __( 'Test email sent to %s. Check the inbox, and the spam folder.', '${themeSlug}' ), $to ),
                        'updated'
                    );
                } else {
                    $why = get_transient( '${funcPrefix}_last_mail_error' );
                    add_settings_error(
                        '${funcPrefix}_messages', '${funcPrefix}_error',
                        $why
                            ? sprintf( __( 'Could not send: %s', '${themeSlug}' ), $why )
                            : __( 'Could not send the test email. Check the SMTP settings above.', '${themeSlug}' ),
                        'error'
                    );
                }
            }
        }
    }

    // Re-import content from the theme's data file.
    //
    // Activation only fires on after_switch_theme, so uploading a new theme
    // ZIP over an active theme replaces the files but leaves the old content
    // in the database. This button re-runs the import without needing to
    // switch themes away and back.
    if ( isset( $_POST['${funcPrefix}_do_reimport'] ) ) {
        if ( ! isset( $_POST['${funcPrefix}_reimport_nonce'] ) ||
             ! wp_verify_nonce( $_POST['${funcPrefix}_reimport_nonce'], '${funcPrefix}_reimport' ) ) {
            add_settings_error( '${funcPrefix}_messages', '${funcPrefix}_error', __( 'Security check failed.', '${themeSlug}' ), 'error' );
        } elseif ( function_exists( '${funcPrefix}_activate' ) ) {
            ${funcPrefix}_activate();
            add_settings_error( '${funcPrefix}_messages', '${funcPrefix}_reimported', __( 'Content re-imported from the theme.', '${themeSlug}' ), 'updated' );
        } else {
            add_settings_error( '${funcPrefix}_messages', '${funcPrefix}_error', __( 'Import function unavailable.', '${themeSlug}' ), 'error' );
        }
    }

    // Get current settings
    $settings = get_option( '${funcPrefix}_global_settings', array() );

    ?>
    <div class="wrap">
        <h1><?php echo esc_html( get_admin_page_title() ); ?></h1>

        <?php settings_errors( '${funcPrefix}_messages' ); ?>

        <form method="post" action="">
            <?php wp_nonce_field( '${funcPrefix}_save_settings', '${funcPrefix}_settings_nonce' ); ?>

            <style>
                .${funcPrefix}-settings-section {
                    background: #fff;
                    border: 1px solid #ccd0d4;
                    border-radius: 4px;
                    padding: 20px;
                    margin: 20px 0;
                }
                .${funcPrefix}-settings-section h2 {
                    margin-top: 0;
                    padding-bottom: 10px;
                    border-bottom: 1px solid #eee;
                }
                .${funcPrefix}-settings-section table {
                    margin-top: 15px;
                }
            </style>

            <!-- Business Information -->
            <div class="${funcPrefix}-settings-section">
                <h2><?php esc_html_e( 'Business Information', '${themeSlug}' ); ?></h2>
                <table class="form-table">
                    <tr>
                        <th scope="row">
                            <label for="business_name"><?php esc_html_e( 'Business Name', '${themeSlug}' ); ?></label>
                        </th>
                        <td>
                            <input type="text" id="business_name" name="business_name" class="regular-text"
                                value="<?php echo esc_attr( isset( $settings['business_name'] ) ? $settings['business_name'] : '' ); ?>" />
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">
                            <label for="business_type"><?php esc_html_e( 'Business Type', '${themeSlug}' ); ?></label>
                        </th>
                        <td>
                            <input type="text" id="business_type" name="business_type" class="regular-text"
                                value="<?php echo esc_attr( isset( $settings['business_type'] ) ? $settings['business_type'] : '' ); ?>" />
                            <p class="description"><?php esc_html_e( 'e.g., Plumbing Company, Law Firm, Restaurant', '${themeSlug}' ); ?></p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">
                            <label for="location"><?php esc_html_e( 'City, State', '${themeSlug}' ); ?></label>
                        </th>
                        <td>
                            <input type="text" id="location" name="location" class="regular-text"
                                value="<?php echo esc_attr( isset( $settings['location'] ) ? $settings['location'] : '' ); ?>" />
                            <p class="description"><?php esc_html_e( 'e.g., Austin, TX', '${themeSlug}' ); ?></p>
                        </td>
                    </tr>
                </table>
            </div>

            <!-- Contact Information -->
            <div class="${funcPrefix}-settings-section">
                <h2><?php esc_html_e( 'Contact Information', '${themeSlug}' ); ?></h2>
                <table class="form-table">
                    <tr>
                        <th scope="row">
                            <label for="phone"><?php esc_html_e( 'Phone Number', '${themeSlug}' ); ?></label>
                        </th>
                        <td>
                            <input type="text" id="phone" name="phone" class="regular-text"
                                value="<?php echo esc_attr( isset( $settings['phone'] ) ? $settings['phone'] : '' ); ?>" />
                            <p class="description"><?php esc_html_e( 'e.g., (512) 555-1234', '${themeSlug}' ); ?></p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">
                            <label for="email"><?php esc_html_e( 'Email Address', '${themeSlug}' ); ?></label>
                        </th>
                        <td>
                            <input type="email" id="email" name="email" class="regular-text"
                                value="<?php echo esc_attr( isset( $settings['email'] ) ? $settings['email'] : '' ); ?>" />
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">
                            <label for="contact_email"><?php esc_html_e( 'Contact Form Email', '${themeSlug}' ); ?></label>
                        </th>
                        <td>
                            <input type="email" id="contact_email" name="contact_email" class="regular-text"
                                value="<?php echo esc_attr( isset( $settings['contact_email'] ) ? $settings['contact_email'] : '' ); ?>" />
                            <p class="description"><?php esc_html_e( 'Email address where contact form submissions will be sent. If empty, uses WordPress admin email.', '${themeSlug}' ); ?></p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">
                            <label for="address"><?php esc_html_e( 'Business Address', '${themeSlug}' ); ?></label>
                        </th>
                        <td>
                            <textarea id="address" name="address" class="large-text" rows="3"><?php echo esc_textarea( isset( $settings['address'] ) ? $settings['address'] : '' ); ?></textarea>
                        </td>
                    </tr>
                </table>
            </div>

            <!-- Social Media Links -->
            <div class="${funcPrefix}-settings-section">
                <h2><?php esc_html_e( 'Social Media Links', '${themeSlug}' ); ?></h2>
                <p class="description"><?php esc_html_e( 'Leave blank if you don\\'t use a particular platform.', '${themeSlug}' ); ?></p>
                <table class="form-table">
                    <tr>
                        <th scope="row">
                            <label for="social_facebook"><?php esc_html_e( 'Facebook URL', '${themeSlug}' ); ?></label>
                        </th>
                        <td>
                            <input type="url" id="social_facebook" name="social_facebook" class="regular-text"
                                value="<?php echo esc_attr( isset( $settings['social_facebook'] ) ? $settings['social_facebook'] : '' ); ?>" />
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">
                            <label for="social_twitter"><?php esc_html_e( 'Twitter URL', '${themeSlug}' ); ?></label>
                        </th>
                        <td>
                            <input type="url" id="social_twitter" name="social_twitter" class="regular-text"
                                value="<?php echo esc_attr( isset( $settings['social_twitter'] ) ? $settings['social_twitter'] : '' ); ?>" />
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">
                            <label for="social_instagram"><?php esc_html_e( 'Instagram URL', '${themeSlug}' ); ?></label>
                        </th>
                        <td>
                            <input type="url" id="social_instagram" name="social_instagram" class="regular-text"
                                value="<?php echo esc_attr( isset( $settings['social_instagram'] ) ? $settings['social_instagram'] : '' ); ?>" />
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">
                            <label for="social_linkedin"><?php esc_html_e( 'LinkedIn URL', '${themeSlug}' ); ?></label>
                        </th>
                        <td>
                            <input type="url" id="social_linkedin" name="social_linkedin" class="regular-text"
                                value="<?php echo esc_attr( isset( $settings['social_linkedin'] ) ? $settings['social_linkedin'] : '' ); ?>" />
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">
                            <label for="social_youtube"><?php esc_html_e( 'YouTube URL', '${themeSlug}' ); ?></label>
                        </th>
                        <td>
                            <input type="url" id="social_youtube" name="social_youtube" class="regular-text"
                                value="<?php echo esc_attr( isset( $settings['social_youtube'] ) ? $settings['social_youtube'] : '' ); ?>" />
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">
                            <label for="social_pinterest"><?php esc_html_e( 'Pinterest URL', '${themeSlug}' ); ?></label>
                        </th>
                        <td>
                            <input type="url" id="social_pinterest" name="social_pinterest" class="regular-text"
                                value="<?php echo esc_attr( isset( $settings['social_pinterest'] ) ? $settings['social_pinterest'] : '' ); ?>" />
                        </td>
                    </tr>
                </table>
            </div>

            <!-- Additional Settings -->
            <div class="${funcPrefix}-settings-section">
                <h2><?php esc_html_e( 'Additional Settings', '${themeSlug}' ); ?></h2>
                <table class="form-table">
                    <tr>
                        <th scope="row">
                            <label for="google_map_cid"><?php esc_html_e( 'Google Maps CID', '${themeSlug}' ); ?></label>
                        </th>
                        <td>
                            <input type="text" id="google_map_cid" name="google_map_cid" class="regular-text"
                                value="<?php echo esc_attr( isset( $settings['google_map_cid'] ) ? $settings['google_map_cid'] : '' ); ?>" />
                            <p class="description"><?php esc_html_e( 'Your Google Business Profile CID for map embeds.', '${themeSlug}' ); ?></p>
                        </td>
                    </tr>
                </table>
            </div>

            <h2><?php esc_html_e( 'Email Delivery (SMTP)', '${themeSlug}' ); ?></h2>
            <p class="description">
                <?php esc_html_e( 'WordPress sends mail through the server by default, which many hosts block or mark as spam. Entering your mailbox details here sends contact form emails from your own domain, so they arrive reliably.', '${themeSlug}' ); ?>
            </p>
            <p class="description">
                <?php esc_html_e( 'Leave the host blank to keep using the WordPress default.', '${themeSlug}' ); ?>
            </p>

            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row"><label for="smtp_host"><?php esc_html_e( 'SMTP Host', '${themeSlug}' ); ?></label></th>
                    <td>
                        <input type="text" id="smtp_host" name="smtp_host" class="regular-text"
                            placeholder="mail.yourdomain.com"
                            value="<?php echo esc_attr( isset( $settings['smtp_host'] ) ? $settings['smtp_host'] : '' ); ?>" />
                    </td>
                </tr>
                <tr>
                    <th scope="row"><label for="smtp_port"><?php esc_html_e( 'Port', '${themeSlug}' ); ?></label></th>
                    <td>
                        <input type="number" id="smtp_port" name="smtp_port" class="small-text"
                            placeholder="587"
                            value="<?php echo esc_attr( isset( $settings['smtp_port'] ) ? $settings['smtp_port'] : '' ); ?>" />
                        <p class="description"><?php esc_html_e( 'Usually 587 for TLS or 465 for SSL.', '${themeSlug}' ); ?></p>
                    </td>
                </tr>
                <tr>
                    <th scope="row"><label for="smtp_secure"><?php esc_html_e( 'Encryption', '${themeSlug}' ); ?></label></th>
                    <td>
                        <?php $secure = isset( $settings['smtp_secure'] ) ? $settings['smtp_secure'] : 'tls'; ?>
                        <select id="smtp_secure" name="smtp_secure">
                            <option value="tls" <?php selected( $secure, 'tls' ); ?>>TLS</option>
                            <option value="ssl" <?php selected( $secure, 'ssl' ); ?>>SSL</option>
                            <option value="none" <?php selected( $secure, 'none' ); ?>><?php esc_html_e( 'None', '${themeSlug}' ); ?></option>
                        </select>
                    </td>
                </tr>
                <tr>
                    <th scope="row"><label for="smtp_user"><?php esc_html_e( 'Username', '${themeSlug}' ); ?></label></th>
                    <td>
                        <input type="text" id="smtp_user" name="smtp_user" class="regular-text"
                            autocomplete="off"
                            value="<?php echo esc_attr( isset( $settings['smtp_user'] ) ? $settings['smtp_user'] : '' ); ?>" />
                        <p class="description"><?php esc_html_e( 'Usually the full email address.', '${themeSlug}' ); ?></p>
                    </td>
                </tr>
                <tr>
                    <th scope="row"><label for="smtp_pass"><?php esc_html_e( 'Password', '${themeSlug}' ); ?></label></th>
                    <td>
                        <?php if ( defined( '${constPrefix}_SMTP_PASS' ) ) : ?>
                            <p><strong><?php esc_html_e( 'Set in wp-config.php', '${themeSlug}' ); ?></strong></p>
                            <p class="description"><?php esc_html_e( 'The password is read from wp-config.php and is not stored in the database. This is the safer option.', '${themeSlug}' ); ?></p>
                        <?php else : ?>
                            <input type="password" id="smtp_pass" name="smtp_pass" class="regular-text"
                                autocomplete="new-password"
                                value="<?php echo esc_attr( isset( $settings['smtp_pass'] ) ? $settings['smtp_pass'] : '' ); ?>" />
                            <p class="description">
                                <?php esc_html_e( 'Stored in the database. To keep it out of the database instead, add this line to wp-config.php:', '${themeSlug}' ); ?>
                                <code>define( '${constPrefix}_SMTP_PASS', 'your-password' );</code>
                            </p>
                        <?php endif; ?>
                    </td>
                </tr>
                <tr>
                    <th scope="row"><label for="smtp_from"><?php esc_html_e( 'From Address', '${themeSlug}' ); ?></label></th>
                    <td>
                        <input type="email" id="smtp_from" name="smtp_from" class="regular-text"
                            value="<?php echo esc_attr( isset( $settings['smtp_from'] ) ? $settings['smtp_from'] : '' ); ?>" />
                        <p class="description">
                            <?php esc_html_e( 'Must be on the same domain as the SMTP account, or the message will be treated as spam.', '${themeSlug}' ); ?>
                        </p>
                    </td>
                </tr>
                <tr>
                    <th scope="row"><label for="smtp_from_name"><?php esc_html_e( 'From Name', '${themeSlug}' ); ?></label></th>
                    <td>
                        <input type="text" id="smtp_from_name" name="smtp_from_name" class="regular-text"
                            value="<?php echo esc_attr( isset( $settings['smtp_from_name'] ) ? $settings['smtp_from_name'] : '' ); ?>" />
                    </td>
                </tr>
            </table>

            <?php submit_button( __( 'Save Settings', '${themeSlug}' ), 'primary', '${funcPrefix}_save_settings' ); ?>
        </form>

        <!-- Test send, in its own form so it cannot be triggered by saving.
             Without this a client fills in six fields and has no idea whether
             they work until an enquiry goes missing. -->
        <div class="${funcPrefix}-settings-section">
            <h2><?php esc_html_e( 'Test Email Delivery', '${themeSlug}' ); ?></h2>
            <p class="description">
                <?php esc_html_e( 'Save your settings first, then send a test message to check they work.', '${themeSlug}' ); ?>
            </p>
            <form method="post" action="">
                <?php wp_nonce_field( '${funcPrefix}_smtp_test', '${funcPrefix}_smtp_test_nonce' ); ?>
                <input type="email" name="${funcPrefix}_test_to" class="regular-text"
                       placeholder="<?php echo esc_attr( get_option( 'admin_email' ) ); ?>"
                       value="<?php echo esc_attr( get_option( 'admin_email' ) ); ?>" />
                <button type="submit" name="${funcPrefix}_do_smtp_test" class="button button-secondary">
                    <?php esc_html_e( 'Send test email', '${themeSlug}' ); ?>
                </button>
            </form>
        </div>

        <!-- Re-import, kept in its own form so it can't be triggered by
             saving settings -->
        <div class="${funcPrefix}-settings-section">
            <h2><?php esc_html_e( 'Content', '${themeSlug}' ); ?></h2>
            <p class="description">
                <?php esc_html_e( 'Re-import all pages and content from the theme files. Use this after uploading an updated version of the theme.', '${themeSlug}' ); ?>
            </p>
            <p class="description" style="color:#b32d2e;">
                <?php esc_html_e( 'Warning: this overwrites any edits made in the WordPress admin with the content from the theme.', '${themeSlug}' ); ?>
            </p>
            <form method="post" action="" onsubmit="return confirm('<?php echo esc_js( __( 'This will overwrite page content with the version from the theme files. Continue?', '${themeSlug}' ) ); ?>');">
                <?php wp_nonce_field( '${funcPrefix}_reimport', '${funcPrefix}_reimport_nonce' ); ?>
                <button type="submit" name="${funcPrefix}_do_reimport" class="button button-secondary">
                    <?php esc_html_e( 'Re-import content from theme', '${themeSlug}' ); ?>
                </button>
            </form>
        </div>
    </div>
    <?php
}

/**
 * Save settings from form submission
 */
function ${funcPrefix}_save_settings() {
    // The password input is not rendered when the wp-config constant is set,
    // so read what is stored before rebuilding — otherwise saving any other
    // setting would silently wipe it.
    $existing = get_option( '${funcPrefix}_global_settings', array() );
    if ( ! is_array( $existing ) ) {
        $existing = array();
    }

    $settings = array(
        // Business info
        'business_name' => isset( $_POST['business_name'] ) ? sanitize_text_field( $_POST['business_name'] ) : '',
        'business_type' => isset( $_POST['business_type'] ) ? sanitize_text_field( $_POST['business_type'] ) : '',
        'location'      => isset( $_POST['location'] ) ? sanitize_text_field( $_POST['location'] ) : '',

        // Contact info
        'phone'         => isset( $_POST['phone'] ) ? sanitize_text_field( $_POST['phone'] ) : '',
        'email'         => isset( $_POST['email'] ) ? sanitize_email( $_POST['email'] ) : '',
        'contact_email' => isset( $_POST['contact_email'] ) ? sanitize_email( $_POST['contact_email'] ) : '',

        // SMTP. The password field is absent from the form when the
        // wp-config.php constant is set, so keep whatever was there rather
        // than blanking it.
        'smtp_host'      => isset( $_POST['smtp_host'] ) ? sanitize_text_field( $_POST['smtp_host'] ) : '',
        'smtp_port'      => isset( $_POST['smtp_port'] ) ? absint( $_POST['smtp_port'] ) : '',
        'smtp_secure'    => isset( $_POST['smtp_secure'] ) ? sanitize_key( $_POST['smtp_secure'] ) : 'tls',
        'smtp_user'      => isset( $_POST['smtp_user'] ) ? sanitize_text_field( $_POST['smtp_user'] ) : '',
        'smtp_pass'      => isset( $_POST['smtp_pass'] )
                                ? $_POST['smtp_pass'] // phpcs:ignore — a password must not be altered
                                : ( isset( $existing['smtp_pass'] ) ? $existing['smtp_pass'] : '' ),
        'smtp_from'      => isset( $_POST['smtp_from'] ) ? sanitize_email( $_POST['smtp_from'] ) : '',
        'smtp_from_name' => isset( $_POST['smtp_from_name'] ) ? sanitize_text_field( $_POST['smtp_from_name'] ) : '',
        'address'       => isset( $_POST['address'] ) ? sanitize_textarea_field( $_POST['address'] ) : '',

        // Social media
        'social_facebook'  => isset( $_POST['social_facebook'] ) ? esc_url_raw( $_POST['social_facebook'] ) : '',
        'social_twitter'   => isset( $_POST['social_twitter'] ) ? esc_url_raw( $_POST['social_twitter'] ) : '',
        'social_instagram' => isset( $_POST['social_instagram'] ) ? esc_url_raw( $_POST['social_instagram'] ) : '',
        'social_linkedin'  => isset( $_POST['social_linkedin'] ) ? esc_url_raw( $_POST['social_linkedin'] ) : '',
        'social_youtube'   => isset( $_POST['social_youtube'] ) ? esc_url_raw( $_POST['social_youtube'] ) : '',
        'social_pinterest' => isset( $_POST['social_pinterest'] ) ? esc_url_raw( $_POST['social_pinterest'] ) : '',

        // Additional
        'google_map_cid' => isset( $_POST['google_map_cid'] ) ? sanitize_text_field( $_POST['google_map_cid'] ) : '',
    );

    update_option( '${funcPrefix}_global_settings', $settings );
}

/**
 * Helper function to get a global setting
 * Can be used in templates: ${funcPrefix}_get_setting( 'phone' )
 */
function ${funcPrefix}_get_setting( $key, $default = '' ) {
    $settings = get_option( '${funcPrefix}_global_settings', array() );
    return isset( $settings[ $key ] ) ? $settings[ $key ] : $default;
}
`;
}

module.exports = {
  generateThemeSettingsPhp
};