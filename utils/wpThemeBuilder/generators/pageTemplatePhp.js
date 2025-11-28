// utils/wpThemeBuilder/generators/pageTemplatePhp.js

const { makePhpIdentifier } = require('../wpHelpers/phpHelpers');

/**
 * Replace mailto contact form with WordPress-powered form
 */
function replaceContactForm(htmlContent, funcPrefix) {
  // Find the form section
  const formRegex = /<section class="form-container"[\s\S]*?<\/section>/;
  
  if (!formRegex.test(htmlContent)) {
    return htmlContent; // No form found
  }
  
  const wpForm = `<section class="form-container">
    <div class="bg-secondary-subtle">
        <form class="contact-form" id="contactForm" method="POST" action="<?php echo esc_url( admin_url( 'admin-ajax.php' ) ); ?>">
            <?php wp_nonce_field( 'contact_form', 'contact_nonce' ); ?>
            <input type="hidden" name="action" value="submit_contact_form">
            
            <!-- Honeypot field for spam protection (hidden from users) -->
            <input type="text" name="website" style="display:none;" tabindex="-1" autocomplete="off">
            
            <h2>Get In Touch</h2>
            
            <div class="form-group">
                <label for="name">Full Name</label>
                <input type="text" id="name" name="name" required>
            </div>
            
            <div class="form-group">
                <label for="email">Email Address</label>
                <input type="email" id="email" name="email" required>
            </div>
            
            <div class="form-group">
                <label for="message">Message</label>
                <textarea id="message" name="message" rows="5" required></textarea>
            </div>
            
            <button type="submit" class="submit-btn">
                <span class="btn-text">Send Message</span>
                <svg class="btn-icon" width="20" height="20" viewBox="0 0 24 24" fill="none"
                    xmlns="http://www.w3.org/2000/svg">
                    <path d="M22 2L11 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </button>
        </form>
    </div>
</section>`;

  return htmlContent.replace(formRegex, wpForm);
}

/**
 * Generate page.php - Generic page template
 * Uses the NEW block-based extraction method
 */
function generatePagePhp(options = {}) {
  const {
    themeSlug = 'local-business-theme',
  } = options;

  const funcPrefix = makePhpIdentifier(themeSlug);

  return `<?php
/**
 * Default Page Template
 * 
 * Displays content blocks stored in post meta
 *
 * @package ${themeSlug}
 */

get_header();
?>

<main id="main-content" class="site-main page-template">

    <?php
    while ( have_posts() ) :
        the_post();
        
        // Output all content blocks in order
        $block_index = 0;
        
        while ( true ) {
            $block_html = get_post_meta( get_the_ID(), '${funcPrefix}_block_' . $block_index . '_html', true );
            
            // If no more blocks, break
            if ( empty( $block_html ) ) {
                break;
            }
            
            // Output the block
            echo $block_html;
            
            $block_index++;
        }
        
    endwhile;
    ?>

</main>

<?php
get_footer();
`;
}

/**
 * Generate index.php - Fallback template
 * WordPress requires this file to exist
 */
function generateIndexPhp(options = {}) {
  const { themeSlug = 'local-business-theme' } = options;
  const funcPrefix = makePhpIdentifier(themeSlug);

  return `<?php
/**
 * Index Template (Fallback)
 * 
 * WordPress requires this file
 * Falls back to displaying content blocks like page.php
 *
 * @package ${themeSlug}
 */

get_header();
?>

<main id="main-content" class="site-main">

    <?php if ( have_posts() ) : ?>

        <?php while ( have_posts() ) : the_post(); ?>
        
            <?php
            // Check if this is a page with blocks
            $has_blocks = get_post_meta( get_the_ID(), '${funcPrefix}_block_0_html', true );
            
            if ( $has_blocks ) :
                // Output content blocks
                $block_index = 0;
                
                while ( true ) {
                    $block_html = get_post_meta( get_the_ID(), '${funcPrefix}_block_' . $block_index . '_html', true );
                    
                    if ( empty( $block_html ) ) {
                        break;
                    }
                    
                    echo $block_html;
                    $block_index++;
                }
            else :
                // Fallback for posts or pages without blocks
                ?>
                <div class="container">
                    <article id="post-<?php the_ID(); ?>" <?php post_class(); ?>>
                        <header class="entry-header">
                            <h1 class="entry-title">
                                <?php if ( is_singular() ) : ?>
                                    <?php the_title(); ?>
                                <?php else : ?>
                                    <a href="<?php the_permalink(); ?>"><?php the_title(); ?></a>
                                <?php endif; ?>
                            </h1>
                        </header>

                        <div class="entry-content">
                            <?php
                            if ( is_singular() ) {
                                the_content();
                            } else {
                                the_excerpt();
                            }
                            ?>
                        </div>
                    </article>
                </div>
                <?php
            endif;
            ?>

        <?php endwhile; ?>

        <?php
        // Pagination for archives
        if ( ! is_singular() ) {
            the_posts_pagination( array(
                'mid_size'  => 2,
                'prev_text' => __( '&laquo; Previous', '${themeSlug}' ),
                'next_text' => __( 'Next &raquo;', '${themeSlug}' ),
            ) );
        }
        ?>

    <?php else : ?>

        <div class="container">
            <article class="no-results">
                <header class="entry-header">
                    <h1 class="entry-title"><?php esc_html_e( 'Nothing Found', '${themeSlug}' ); ?></h1>
                </header>

                <div class="entry-content">
                    <p><?php esc_html_e( 'It seems we can&rsquo;t find what you&rsquo;re looking for. Perhaps searching can help.', '${themeSlug}' ); ?></p>
                    <?php get_search_form(); ?>
                </div>
            </article>
        </div>

    <?php endif; ?>

</main>

<?php
get_footer();
`;
}

/**
 * Generate a page template for a specific slug (optional, not needed for basic functionality)
 */
function generatePageSlugTemplate(slug, title, options = {}) {
  const { themeSlug = 'local-business-theme' } = options;
  const funcPrefix = makePhpIdentifier(themeSlug);

  return `<?php
/**
 * Page Template: ${title}
 * Template Name: ${title}
 * 
 * Custom template for ${title}
 *
 * @package ${themeSlug}
 */

get_header();
?>

<main id="main-content" class="site-main page-${slug}">

    <?php
    while ( have_posts() ) :
        the_post();
        
        // Output all content blocks
        $block_index = 0;
        
        while ( true ) {
            $block_html = get_post_meta( get_the_ID(), '${funcPrefix}_block_' . $block_index . '_html', true );
            
            if ( empty( $block_html ) ) {
                break;
            }
            
            echo $block_html;
            $block_index++;
        }
        
    endwhile;
    ?>

</main>

<?php
get_footer();
`;
}

module.exports = {
  generatePagePhp,
  generatePageSlugTemplate,
  generateIndexPhp,
  replaceContactForm,
};