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
    if ( isset( \$_POST['${funcPrefix}_save_settings'] ) ) {
        // Verify nonce
        if ( ! isset( \$_POST['${funcPrefix}_settings_nonce'] ) ||
             ! wp_verify_nonce( \$_POST['${funcPrefix}_settings_nonce'], '${funcPrefix}_save_settings' ) ) {
            add_settings_error( '${funcPrefix}_messages', '${funcPrefix}_error', __( 'Security check failed.', '${themeSlug}' ), 'error' );
        } else {
            // Save settings
            ${funcPrefix}_save_settings();
            add_settings_error( '${funcPrefix}_messages', '${funcPrefix}_success', __( 'Settings saved successfully.', '${themeSlug}' ), 'updated' );
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

            <?php submit_button( __( 'Save Settings', '${themeSlug}' ), 'primary', '${funcPrefix}_save_settings' ); ?>
        </form>
    </div>
    <?php
}

/**
 * Save settings from form submission
 */
function ${funcPrefix}_save_settings() {
    $settings = array(
        // Business info
        'business_name' => isset( \$_POST['business_name'] ) ? sanitize_text_field( \$_POST['business_name'] ) : '',
        'business_type' => isset( \$_POST['business_type'] ) ? sanitize_text_field( \$_POST['business_type'] ) : '',
        'location'      => isset( \$_POST['location'] ) ? sanitize_text_field( \$_POST['location'] ) : '',

        // Contact info
        'phone'   => isset( \$_POST['phone'] ) ? sanitize_text_field( \$_POST['phone'] ) : '',
        'email'   => isset( \$_POST['email'] ) ? sanitize_email( \$_POST['email'] ) : '',
        'address' => isset( \$_POST['address'] ) ? sanitize_textarea_field( \$_POST['address'] ) : '',

        // Social media
        'social_facebook'  => isset( \$_POST['social_facebook'] ) ? esc_url_raw( \$_POST['social_facebook'] ) : '',
        'social_twitter'   => isset( \$_POST['social_twitter'] ) ? esc_url_raw( \$_POST['social_twitter'] ) : '',
        'social_instagram' => isset( \$_POST['social_instagram'] ) ? esc_url_raw( \$_POST['social_instagram'] ) : '',
        'social_linkedin'  => isset( \$_POST['social_linkedin'] ) ? esc_url_raw( \$_POST['social_linkedin'] ) : '',
        'social_youtube'   => isset( \$_POST['social_youtube'] ) ? esc_url_raw( \$_POST['social_youtube'] ) : '',
        'social_pinterest' => isset( \$_POST['social_pinterest'] ) ? esc_url_raw( \$_POST['social_pinterest'] ) : '',

        // Additional
        'google_map_cid' => isset( \$_POST['google_map_cid'] ) ? sanitize_text_field( \$_POST['google_map_cid'] ) : '',
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