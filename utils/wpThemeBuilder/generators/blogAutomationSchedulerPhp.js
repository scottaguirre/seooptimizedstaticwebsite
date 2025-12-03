const { makePhpIdentifier } = require('../wpHelpers/phpHelpers');

function generateBlogAutomationSchedulerPhp(options = {}) {
  const { themeSlug = 'local-business-theme' } = options;
  const funcPrefix = makePhpIdentifier(themeSlug);

  return `<?php
/**
 * Blog Automation Scheduler
 * Handles WordPress cron scheduling
 * 
 * @package ${themeSlug}
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * Schedule blog post generation
 */
function ${funcPrefix}_schedule_blog_automation() {
    $settings = get_option( '${funcPrefix}_blog_automation', array() );
    
    // Clear existing schedule
    wp_clear_scheduled_hook( '${funcPrefix}_generate_blog_post' );
    
    // Don't schedule if disabled
    if ( empty( $settings['enabled'] ) ) {
        return;
    }
    
    // Calculate next run time
    $start_date = isset( $settings['start_date'] ) ? $settings['start_date'] : date( 'Y-m-d' );
    $publish_time = isset( $settings['publish_time'] ) ? $settings['publish_time'] : '10:00';
    $frequency = isset( $settings['frequency'] ) ? $settings['frequency'] : 'weekly';
    
    // Combine date and time
    $next_run = strtotime( $start_date . ' ' . $publish_time );
    
    // If start date is in the past, calculate next occurrence
    if ( $next_run < time() ) {
        $next_run = ${funcPrefix}_calculate_next_run( $frequency, $publish_time );
    }
    
    // Schedule the event
    if ( $frequency === 'daily' ) {
        wp_schedule_event( $next_run, 'daily', '${funcPrefix}_generate_blog_post' );
    } elseif ( $frequency === 'weekly' ) {
        wp_schedule_event( $next_run, 'weekly', '${funcPrefix}_generate_blog_post' );
    } elseif ( $frequency === 'biweekly' ) {
        wp_schedule_event( $next_run, 'twicemonthly', '${funcPrefix}_generate_blog_post' );
    } elseif ( $frequency === 'monthly' ) {
        wp_schedule_event( $next_run, 'monthly', '${funcPrefix}_generate_blog_post' );
    }
    
    error_log( 'Blog automation scheduled for: ' . date( 'Y-m-d H:i:s', $next_run ) );
}

/**
 * Calculate next run time based on frequency
 */
function ${funcPrefix}_calculate_next_run( $frequency, $time ) {
    $hour_minute = explode( ':', $time );
    $hour = isset( $hour_minute[0] ) ? (int) $hour_minute[0] : 10;
    $minute = isset( $hour_minute[1] ) ? (int) $hour_minute[1] : 0;
    
    if ( $frequency === 'daily' ) {
        // Tomorrow at specified time
        return strtotime( 'tomorrow ' . $hour . ':' . $minute );
    } elseif ( $frequency === 'weekly' ) {
        // Next Monday at specified time
        return strtotime( 'next Monday ' . $hour . ':' . $minute );
    } elseif ( $frequency === 'biweekly' ) {
        // 14 days from now
        return strtotime( '+14 days ' . $hour . ':' . $minute );
    } elseif ( $frequency === 'monthly' ) {
        // First day of next month
        return strtotime( 'first day of next month ' . $hour . ':' . $minute );
    }
    
    return strtotime( 'next Monday 10:00' );
}

/**
 * Register custom cron schedules
 */
function ${funcPrefix}_custom_cron_schedules( $schedules ) {
    $schedules['weekly'] = array(
        'interval' => 604800, // 7 days
        'display'  => __( 'Once Weekly', '${themeSlug}' )
    );
    
    $schedules['twicemonthly'] = array(
        'interval' => 1209600, // 14 days
        'display'  => __( 'Twice Monthly', '${themeSlug}' )
    );
    
    $schedules['monthly'] = array(
        'interval' => 2635200, // ~30 days
        'display'  => __( 'Once Monthly', '${themeSlug}' )
    );
    
    return $schedules;
}
add_filter( 'cron_schedules', '${funcPrefix}_custom_cron_schedules' );

/**
 * Hook the generation function to the scheduled event
 */
add_action( '${funcPrefix}_generate_blog_post', '${funcPrefix}_generate_blog_post' );

/**
 * Clear schedule on theme deactivation
 */
function ${funcPrefix}_deactivate_blog_automation() {
    wp_clear_scheduled_hook( '${funcPrefix}_generate_blog_post' );
}
register_deactivation_hook( __FILE__, '${funcPrefix}_deactivate_blog_automation' );
`;
}

module.exports = {
  generateBlogAutomationSchedulerPhp,
};