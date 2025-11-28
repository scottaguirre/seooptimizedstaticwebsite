// utils/wpThemeBuilder/generators/contactFormHandlerPhp.js

const { makePhpIdentifier } = require('../wpHelpers/phpHelpers');

function generateContactFormHandlerPhp(options = {}) {
  const {
    themeSlug = 'local-business-theme',
  } = options;

  const funcPrefix = makePhpIdentifier(themeSlug);

  return `<?php
/**
 * Contact Form Handler
 * Processes contact form submissions via Ajax
 *
 * @package ${themeSlug}
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * Handle contact form submission via Ajax
 */
function ${funcPrefix}_handle_contact_form() {
    // Check nonce for security
    if ( ! isset( $_POST['contact_nonce'] ) || ! wp_verify_nonce( $_POST['contact_nonce'], 'contact_form' ) ) {
        wp_send_json_error( array(
            'message' => 'Security verification failed. Please refresh the page and try again.'
        ) );
    }

    // Honeypot spam protection (hidden field that bots fill out)
    if ( ! empty( $_POST['website'] ) ) {
        // This is likely a bot
        wp_send_json_error( array(
            'message' => 'Spam detected.'
        ) );
    }

    // Sanitize and validate form data
    $name = isset( $_POST['name'] ) ? sanitize_text_field( $_POST['name'] ) : '';
    $email = isset( $_POST['email'] ) ? sanitize_email( $_POST['email'] ) : '';
    $message = isset( $_POST['message'] ) ? sanitize_textarea_field( $_POST['message'] ) : '';

    // Validation
    $errors = array();

    if ( empty( $name ) ) {
        $errors[] = 'Name is required.';
    }

    if ( empty( $email ) ) {
        $errors[] = 'Email is required.';
    } elseif ( ! is_email( $email ) ) {
        $errors[] = 'Please enter a valid email address.';
    }

    if ( empty( $message ) ) {
        $errors[] = 'Message is required.';
    }

    // If there are validation errors, return them
    if ( ! empty( $errors ) ) {
        wp_send_json_error( array(
            'message' => implode( ' ', $errors )
        ) );
    }

    // Get recipient email from theme settings
    $settings = get_option( '${funcPrefix}_global_settings', array() );
    $to_email = isset( $settings['contact_email'] ) ? $settings['contact_email'] : get_option( 'admin_email' );

    // Prepare email
    $subject = 'New Contact Form Submission from ' . get_bloginfo( 'name' );
    
    $email_body = "You have received a new message from your website contact form.\\n\\n";
    $email_body .= "Name: " . $name . "\\n";
    $email_body .= "Email: " . $email . "\\n\\n";
    $email_body .= "Message:\\n" . $message . "\\n\\n";
    $email_body .= "---\\n";
    $email_body .= "This email was sent from: " . get_bloginfo( 'url' ) . "\\n";
    $email_body .= "Sent on: " . current_time( 'F j, Y \\a\\t g:i a' );

    // Email headers
    $headers = array(
        'Content-Type: text/plain; charset=UTF-8',
        'From: ' . get_bloginfo( 'name' ) . ' <' . get_option( 'admin_email' ) . '>',
        'Reply-To: ' . $name . ' <' . $email . '>'
    );

    // Send email
    $sent = wp_mail( $to_email, $subject, $email_body, $headers );

    if ( $sent ) {
        wp_send_json_success( array(
            'message' => 'Message sent! We\\'ll get back to you soon.'
        ) );
    } else {
        // Get last error for debugging
        $error_message = 'Email failed to send.';
        
        // Check if we can get more details
        if ( function_exists( 'error_get_last' ) ) {
            $last_error = error_get_last();
            if ( $last_error ) {
                $error_message .= ' Error: ' . $last_error['message'];
            }
        }
        
        // Log for debugging (will appear in wp-content/debug.log if WP_DEBUG_LOG is enabled)
        error_log( 'Contact form email failed. To: ' . $to_email . ' - ' . $error_message );
        
        wp_send_json_error( array(
            'message' => 'Sorry, there was an error sending your message. Please try again or contact us directly.'
        ) );
    }
}

// Register Ajax handlers (for both logged-in and logged-out users)
add_action( 'wp_ajax_submit_contact_form', '${funcPrefix}_handle_contact_form' );
add_action( 'wp_ajax_nopriv_submit_contact_form', '${funcPrefix}_handle_contact_form' );
`;
}

module.exports = {
  generateContactFormHandlerPhp,
};