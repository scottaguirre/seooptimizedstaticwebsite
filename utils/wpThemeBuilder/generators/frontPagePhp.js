// utils/wpThemeBuilder/generators/frontPagePhp.js

const { makePhpIdentifier } = require('../wpHelpers/phpHelpers');

function generateFrontPagePhp(options = {}) {
  const {
    themeSlug = 'local-business-theme',
  } = options;

  const funcPrefix = makePhpIdentifier(themeSlug);

  return `<?php
/**
 * Front Page Template
 * 
 * Displays content blocks in order
 *
 * @package ${themeSlug}
 */

get_header();
?>

<main id="main-content" class="site-main front-page">

    <?php if ( have_posts() ) : while ( have_posts() ) : the_post(); ?>

        <!-- Output all content blocks in order -->
        <?php
        $block_index = 0;
        
        // Loop through content blocks
        while ( true ) :
            $block_html = get_post_meta( get_the_ID(), '${funcPrefix}_block_' . $block_index . '_html', true );
            
            if ( empty( $block_html ) ) :
                break; // No more blocks
            endif;
            
            // Output the block HTML
            echo $block_html;
            
            $block_index++;
        endwhile;
        
        // If no blocks found, show fallback
        if ( $block_index === 0 ) :
        ?>
            <div class="container">
                <div class="alert alert-info">
                    <p><?php esc_html_e( 'No content available. Please re-import your theme.', '${themeSlug}' ); ?></p>
                </div>
            </div>
        <?php
        endif;
        ?>

    <?php endwhile; endif; ?>

</main>

<?php
get_footer();
`;
}

module.exports = {
  generateFrontPagePhp,
};