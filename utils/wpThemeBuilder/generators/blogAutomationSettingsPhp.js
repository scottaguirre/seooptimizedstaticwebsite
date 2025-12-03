const { makePhpIdentifier } = require('../wpHelpers/phpHelpers');

function generateBlogAutomationSettingsPhp(options = {}) {
  const { themeSlug = 'local-business-theme' } = options;
  const funcPrefix = makePhpIdentifier(themeSlug);

  return `<?php
/**
 * Blog Automation Settings Page
 * 
 * @package ${themeSlug}
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * Add Blog Automation menu page
 */
function ${funcPrefix}_blog_automation_menu() {
    add_menu_page(
        'Blog Automation',
        'Blog Automation',
        'manage_options',
        '${themeSlug}-blog-automation',
        '${funcPrefix}_blog_automation_page',
        'dashicons-edit',
        30
    );
}
add_action( 'admin_menu', '${funcPrefix}_blog_automation_menu' );

/**
 * Render Blog Automation settings page
 */
function ${funcPrefix}_blog_automation_page() {
    // Save settings
    if ( isset( $_POST['${funcPrefix}_save_blog_automation'] ) ) {
        check_admin_referer( '${funcPrefix}_blog_automation_nonce' );
        
        $settings = array(
            'enabled' => isset( $_POST['automation_enabled'] ) ? 1 : 0,
            'api_key' => sanitize_text_field( $_POST['api_key'] ),
            'api_provider' => sanitize_text_field( $_POST['api_provider'] ),
            'frequency' => sanitize_text_field( $_POST['frequency'] ),
            'start_date' => sanitize_text_field( $_POST['start_date'] ),
            'end_date' => sanitize_text_field( $_POST['end_date'] ),
            'topics' => array_map( 'sanitize_text_field', $_POST['topics'] ),
            'linked_pages' => array_map( 'absint', $_POST['linked_pages'] ),
            'post_length' => absint( $_POST['post_length'] ),
            'publish_time' => sanitize_text_field( $_POST['publish_time'] ),
        );
        
        update_option( '${funcPrefix}_blog_automation', $settings );
        
        // Reschedule automation
        ${funcPrefix}_schedule_blog_automation();
        
        echo '<div class="notice notice-success"><p>Settings saved!</p></div>';
    }
    
    // Get current settings
    $settings = get_option( '${funcPrefix}_blog_automation', array(
        'enabled' => 0,
        'api_key' => '',
        'api_provider' => 'openai',
        'frequency' => 'weekly',
        'start_date' => date('Y-m-d'),
        'end_date' => '',
        'topics' => array(),
        'linked_pages' => array(),
        'post_length' => 500,
        'publish_time' => '10:00',
    ));
    
    // Get all pages for linking
    $pages = get_pages();
    
    // Get automation status
    $next_scheduled = wp_next_scheduled( '${funcPrefix}_generate_blog_post' );
    $next_run = $next_scheduled ? date( 'F j, Y g:i a', $next_scheduled ) : 'Not scheduled';
    
    ?>
    <div class="wrap">
        <h1>Blog Post Automation</h1>
        
        <div class="card" style="max-width: 100%; padding: 20px; margin: 20px 0;">
            <h2>Status</h2>
            <p><strong>Automation:</strong> <?php echo $settings['enabled'] ? '✅ Active' : '⏸️ Paused'; ?></p>
            <p><strong>Next Post:</strong> <?php echo $next_run; ?></p>
            <p><strong>Total Posts Generated:</strong> <?php echo get_option( '${funcPrefix}_generated_posts_count', 0 ); ?></p>
        </div>
        
        <form method="post" action="">
            <?php wp_nonce_field( '${funcPrefix}_blog_automation_nonce' ); ?>
            
            <table class="form-table">
                <!-- Enable/Disable -->
                <tr>
                    <th scope="row">Enable Automation</th>
                    <td>
                        <label>
                            <input type="checkbox" name="automation_enabled" value="1" 
                                <?php checked( $settings['enabled'], 1 ); ?>>
                            Automatically generate and publish blog posts
                        </label>
                    </td>
                </tr>
                
                <!-- API Provider -->
                <tr>
                    <th scope="row">AI Provider</th>
                    <td>
                        <select name="api_provider" required>
                            <option value="openai" <?php selected( $settings['api_provider'], 'openai' ); ?>>OpenAI (GPT-4)</option>
                            <option value="anthropic" <?php selected( $settings['api_provider'], 'anthropic' ); ?>>Anthropic (Claude)</option>
                        </select>
                    </td>
                </tr>
                
                <!-- API Key -->
                <tr>
                    <th scope="row">API Key</th>
                    <td>
                        <input type="password" name="api_key" value="<?php echo esc_attr( $settings['api_key'] ); ?>" 
                               class="regular-text" required>
                        <p class="description">
                            Get your API key from: 
                            <a href="https://platform.openai.com/api-keys" target="_blank">OpenAI</a> | 
                            <a href="https://console.anthropic.com/" target="_blank">Anthropic</a>
                        </p>
                    </td>
                </tr>
                
                <!-- Publishing Frequency -->
                <tr>
                    <th scope="row">Publishing Frequency</th>
                    <td>
                        <select name="frequency" required>
                            <option value="daily" <?php selected( $settings['frequency'], 'daily' ); ?>>Daily</option>
                            <option value="weekly" <?php selected( $settings['frequency'], 'weekly' ); ?>>Weekly</option>
                            <option value="biweekly" <?php selected( $settings['frequency'], 'biweekly' ); ?>>Bi-weekly</option>
                            <option value="monthly" <?php selected( $settings['frequency'], 'monthly' ); ?>>Monthly</option>
                        </select>
                    </td>
                </tr>
                
                <!-- Publish Time -->
                <tr>
                    <th scope="row">Publish Time</th>
                    <td>
                        <input type="time" name="publish_time" value="<?php echo esc_attr( $settings['publish_time'] ); ?>" required>
                        <p class="description">What time should posts be published?</p>
                    </td>
                </tr>
                
                <!-- Start Date -->
                <tr>
                    <th scope="row">Start Date</th>
                    <td>
                        <input type="date" name="start_date" value="<?php echo esc_attr( $settings['start_date'] ); ?>" required>
                        <p class="description">When should automation begin?</p>
                    </td>
                </tr>
                
                <!-- End Date -->
                <tr>
                    <th scope="row">End Date (Optional)</th>
                    <td>
                        <input type="date" name="end_date" value="<?php echo esc_attr( $settings['end_date'] ); ?>">
                        <p class="description">Leave empty for continuous automation</p>
                    </td>
                </tr>
                
                <!-- Post Length -->
                <tr>
                    <th scope="row">Post Length</th>
                    <td>
                        <input type="number" name="post_length" value="<?php echo esc_attr( $settings['post_length'] ); ?>" 
                               min="300" max="2000" step="100" required> words
                    </td>
                </tr>
                
                <!-- Topics/Keywords -->
                <tr>
                    <th scope="row">Topics & Keywords</th>
                    <td>
                        <div id="topics-container">
                            <?php
                            if ( ! empty( $settings['topics'] ) ) {
                                foreach ( $settings['topics'] as $index => $topic ) {
                                    ?>
                                    <div class="topic-row" style="margin-bottom: 10px;">
                                        <input type="text" name="topics[]" value="<?php echo esc_attr( $topic ); ?>" 
                                               class="regular-text" placeholder="e.g., water heater repair tips">
                                        <button type="button" class="button remove-topic">Remove</button>
                                    </div>
                                    <?php
                                }
                            } else {
                                ?>
                                <div class="topic-row" style="margin-bottom: 10px;">
                                    <input type="text" name="topics[]" class="regular-text" 
                                           placeholder="e.g., water heater repair tips">
                                    <button type="button" class="button remove-topic">Remove</button>
                                </div>
                                <?php
                            }
                            ?>
                        </div>
                        <button type="button" id="add-topic" class="button">+ Add Topic</button>
                        <p class="description">AI will rotate through these topics when generating posts</p>
                    </td>
                </tr>
                
                <!-- Linked Pages -->
                <tr>
                    <th scope="row">Link to Service Pages</th>
                    <td>
                        <select name="linked_pages[]" multiple size="10" style="width: 100%; max-width: 500px;">
                            <?php foreach ( $pages as $page ) : ?>
                                <option value="<?php echo $page->ID; ?>" 
                                    <?php echo in_array( $page->ID, $settings['linked_pages'] ) ? 'selected' : ''; ?>>
                                    <?php echo esc_html( $page->post_title ); ?>
                                </option>
                            <?php endforeach; ?>
                        </select>
                        <p class="description">Hold Ctrl (Cmd on Mac) to select multiple pages. Posts will include links to these pages.</p>
                    </td>
                </tr>
            </table>
            
            <p class="submit">
                <input type="submit" name="${funcPrefix}_save_blog_automation" class="button button-primary" value="Save Settings">
            </p>
        </form>
        
        <hr>
        
        <h2>Manual Actions</h2>
        <p>
            <a href="<?php echo admin_url( 'admin.php?page=${themeSlug}-blog-automation&action=generate_now' ); ?>" 
               class="button">Generate Post Now</a>
            <a href="<?php echo admin_url( 'admin.php?page=${themeSlug}-blog-automation&action=clear_schedule' ); ?>" 
               class="button">Clear Schedule</a>
        </p>
    </div>
    
    <script>
    jQuery(document).ready(function($) {
        // Add topic row
        $('#add-topic').on('click', function() {
            var row = '<div class="topic-row" style="margin-bottom: 10px;">' +
                '<input type="text" name="topics[]" class="regular-text" placeholder="e.g., plumbing maintenance tips">' +
                '<button type="button" class="button remove-topic">Remove</button>' +
                '</div>';
            $('#topics-container').append(row);
        });
        
        // Remove topic row
        $(document).on('click', '.remove-topic', function() {
            $(this).parent('.topic-row').remove();
        });
    });
    </script>
    <?php
}

// Handle manual actions
add_action( 'admin_init', function() {
    if ( ! isset( $_GET['page'] ) || $_GET['page'] !== '${themeSlug}-blog-automation' ) {
        return;
    }
    
    if ( isset( $_GET['action'] ) && $_GET['action'] === 'generate_now' ) {
        ${funcPrefix}_generate_blog_post();
        wp_redirect( admin_url( 'admin.php?page=${themeSlug}-blog-automation&generated=1' ) );
        exit;
    }
    
    if ( isset( $_GET['action'] ) && $_GET['action'] === 'clear_schedule' ) {
        wp_clear_scheduled_hook( '${funcPrefix}_generate_blog_post' );
        wp_redirect( admin_url( 'admin.php?page=${themeSlug}-blog-automation&cleared=1' ) );
        exit;
    }
});
`;
}

module.exports = {
  generateBlogAutomationSettingsPhp,
};