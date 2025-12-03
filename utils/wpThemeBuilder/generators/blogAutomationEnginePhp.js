const { makePhpIdentifier } = require('../wpHelpers/phpHelpers');

function generateBlogAutomationEnginePhp(options = {}) {
  const { themeSlug = 'local-business-theme' } = options;
  const funcPrefix = makePhpIdentifier(themeSlug);

  return `<?php
/**
 * Blog Automation Engine
 * Handles AI content generation
 * 
 * @package ${themeSlug}
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * Generate blog post using AI
 */
function ${funcPrefix}_generate_blog_post() {
    $settings = get_option( '${funcPrefix}_blog_automation', array() );
    
    // Check if automation is enabled
    if ( empty( $settings['enabled'] ) ) {
        error_log( 'Blog automation is disabled' );
        return;
    }
    
    // Check if we should stop (end date reached)
    if ( ! empty( $settings['end_date'] ) && strtotime( $settings['end_date'] ) < time() ) {
        error_log( 'Blog automation end date reached' );
        update_option( '${funcPrefix}_blog_automation', array_merge( $settings, array( 'enabled' => 0 ) ) );
        return;
    }
    
    // Get random topic
    if ( empty( $settings['topics'] ) ) {
        error_log( 'No topics configured for blog automation' );
        return;
    }
    
    $topic = $settings['topics'][ array_rand( $settings['topics'] ) ];
    
    // Generate content using AI
    $content = ${funcPrefix}_call_ai_api( $topic, $settings );
    
    if ( ! $content ) {
        error_log( 'Failed to generate blog post content' );
        return;
    }
    
    // Get linked pages
    $linked_pages = ! empty( $settings['linked_pages'] ) ? $settings['linked_pages'] : array();
    
    // Add links to content
    if ( ! empty( $linked_pages ) ) {
        $random_page = $linked_pages[ array_rand( $linked_pages ) ];
        $page_url = get_permalink( $random_page );
        $page_title = get_the_title( $random_page );
        
        $content .= "\\n\\n<p>For professional help with this, check out our <a href='" . esc_url( $page_url ) . "'>" . esc_html( $page_title ) . "</a> service.</p>";
    }
    
    // Create post
    $post_id = wp_insert_post( array(
        'post_title'   => ${funcPrefix}_generate_title_from_topic( $topic ),
        'post_content' => $content,
        'post_status'  => 'publish',
        'post_type'    => 'post',
        'post_author'  => 1,
    ) );
    
    if ( $post_id ) {
        // Increment counter
        $count = get_option( '${funcPrefix}_generated_posts_count', 0 );
        update_option( '${funcPrefix}_generated_posts_count', $count + 1 );
        
        error_log( 'Blog post generated successfully: ' . $post_id );
    } else {
        error_log( 'Failed to create blog post' );
    }
}

/**
 * Call AI API to generate content
 */
function ${funcPrefix}_call_ai_api( $topic, $settings ) {
    $api_key = $settings['api_key'];
    $provider = $settings['api_provider'];
    $word_count = isset( $settings['post_length'] ) ? $settings['post_length'] : 500;
    
    $business_name = get_bloginfo( 'name' );
    
    $prompt = "Write a {$word_count}-word informative blog post about: {$topic}

Write for a local business website called {$business_name}.
Include:
- An engaging introduction
- 3-5 practical tips or key points
- A helpful conclusion
- Use a friendly, professional tone
- Format with HTML paragraphs (<p> tags) and subheadings (<h2>, <h3> tags)
- Do NOT include a title (we'll add that separately)

Write the content now:";
    
    if ( $provider === 'openai' ) {
        return ${funcPrefix}_call_openai_api( $prompt, $api_key );
    } elseif ( $provider === 'anthropic' ) {
        return ${funcPrefix}_call_anthropic_api( $prompt, $api_key );
    }
    
    return false;
}

/**
 * Call OpenAI API
 */
function ${funcPrefix}_call_openai_api( $prompt, $api_key ) {
    $response = wp_remote_post( 'https://api.openai.com/v1/chat/completions', array(
        'headers' => array(
            'Content-Type' => 'application/json',
            'Authorization' => 'Bearer ' . $api_key,
        ),
        'body' => json_encode( array(
            'model' => 'gpt-4',
            'messages' => array(
                array( 'role' => 'user', 'content' => $prompt )
            ),
            'temperature' => 0.7,
        ) ),
        'timeout' => 60,
    ) );
    
    if ( is_wp_error( $response ) ) {
        error_log( 'OpenAI API error: ' . $response->get_error_message() );
        return false;
    }
    
    $body = json_decode( wp_remote_retrieve_body( $response ), true );
    
    if ( isset( $body['choices'][0]['message']['content'] ) ) {
        return $body['choices'][0]['message']['content'];
    }
    
    error_log( 'OpenAI API response error: ' . print_r( $body, true ) );
    return false;
}

/**
 * Call Anthropic API
 */
function ${funcPrefix}_call_anthropic_api( $prompt, $api_key ) {
    $response = wp_remote_post( 'https://api.anthropic.com/v1/messages', array(
        'headers' => array(
            'Content-Type' => 'application/json',
            'x-api-key' => $api_key,
            'anthropic-version' => '2023-06-01',
        ),
        'body' => json_encode( array(
            'model' => 'claude-3-5-sonnet-20241022',
            'max_tokens' => 2048,
            'messages' => array(
                array( 'role' => 'user', 'content' => $prompt )
            ),
        ) ),
        'timeout' => 60,
    ) );
    
    if ( is_wp_error( $response ) ) {
        error_log( 'Anthropic API error: ' . $response->get_error_message() );
        return false;
    }
    
    $body = json_decode( wp_remote_retrieve_body( $response ), true );
    
    if ( isset( $body['content'][0]['text'] ) ) {
        return $body['content'][0]['text'];
    }
    
    error_log( 'Anthropic API response error: ' . print_r( $body, true ) );
    return false;
}

/**
 * Generate engaging title from topic
 */
function ${funcPrefix}_generate_title_from_topic( $topic ) {
    // Simple title generation - could be improved with AI
    $prefixes = array(
        'The Ultimate Guide to',
        'Everything You Need to Know About',
        'Top Tips for',
        'How to Master',
        'Expert Advice on',
        'The Complete Guide to',
    );
    
    $prefix = $prefixes[ array_rand( $prefixes ) ];
    return $prefix . ' ' . ucfirst( $topic );
}
`;
}

module.exports = {
  generateBlogAutomationEnginePhp,
};