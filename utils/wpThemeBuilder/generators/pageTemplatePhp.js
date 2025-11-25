// utils/wpThemeBuilder/generators/pageTemplatePhp.js

const { makePhpIdentifier } = require('../wpHelpers/phpHelpers');

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
};