// utils/wpThemeBuilder/generators/pageTemplatePhp.js

const { makePhpIdentifier } = require('../wpHelpers/phpHelpers');

function generatePagePhp(options = {}) {
  const {
    themeSlug = 'local-business-theme',
  } = options;

  return `<?php
/**
 * Default Page Template
 * 
 * Outputs stored HTML sections
 *
 * @package ${themeSlug}
 */

get_header();
?>

<main id="main-content" class="site-main page-template">

    <?php if ( have_posts() ) : while ( have_posts() ) : the_post(); ?>

        <article id="post-<?php the_ID(); ?>" <?php post_class(); ?>>

            <!-- Hero Section -->
            <?php
            $hero_html = get_page_field( 'hero_html' );
            
            if ( $hero_html ) :
                echo $hero_html;
            endif;
            ?>

            <!-- Dynamic Sections -->
            <?php
            $section_count = get_section_count();

            for ( $i = 0; $i < $section_count; $i++ ) :
                $section_html = get_page_field( 'section_' . $i . '_html' );
                
                if ( $section_html ) :
                    echo $section_html;
                endif;
            endfor;
            ?>

            <!-- CTA Section -->
            <?php
            $phone = get_global_setting( 'phone' );
            if ( $phone ) :
            ?>
            <section class="cta-section bg-primary text-white">
                <div class="container text-center">
                    <h2><?php esc_html_e( 'Ready to Get Started?', '${themeSlug}' ); ?></h2>
                    <p><?php esc_html_e( 'Contact us today for a free consultation.', '${themeSlug}' ); ?></p>
                    <a href="tel:<?php echo esc_attr( get_phone_href() ); ?>" class="btn btn-light btn-lg">
                        <?php esc_html_e( 'Call', '${themeSlug}' ); ?> <?php echo esc_html( $phone ); ?>
                    </a>
                </div>
            </section>
            <?php endif; ?>

        </article>

    <?php endwhile; endif; ?>

</main>

<?php
get_footer();
`;
}

function generatePageSlugTemplate(slug, title, options = {}) {
  const { themeSlug = 'local-business-theme' } = options;

  return `<?php
/**
 * Page Template: ${title}
 * 
 * Template for the ${title} page
 *
 * @package ${themeSlug}
 */

get_header();
?>

<main id="main-content" class="site-main page-<?php echo esc_attr( '${slug}' ); ?>">

    <?php if ( have_posts() ) : while ( have_posts() ) : the_post(); ?>

        <article id="post-<?php the_ID(); ?>" <?php post_class(); ?>>

            <!-- Hero Section -->
            <?php
            $hero_html = get_page_field( 'hero_html' );
            
            if ( $hero_html ) :
                echo $hero_html;
            endif;
            ?>

            <!-- Dynamic Sections -->
            <?php
            $section_count = get_section_count();

            for ( $i = 0; $i < $section_count; $i++ ) :
                $section_html = get_page_field( 'section_' . $i . '_html' );
                
                if ( $section_html ) :
                    echo $section_html;
                endif;
            endfor;
            ?>

            <!-- Contact CTA Section -->
            <?php
            $phone = get_global_setting( 'phone' );
            $location = get_global_setting( 'location' );
            ?>
            <section class="cta-section bg-primary text-white">
                <div class="container text-center">
                    <h2>
                        <?php
                        printf(
                            esc_html__( 'Need %s Services%s?', '${themeSlug}' ),
                            esc_html( '${title}' ),
                            $location ? ' in ' . esc_html( $location ) : ''
                        );
                        ?>
                    </h2>
                    <p><?php esc_html_e( 'Contact our team today for fast, reliable service.', '${themeSlug}' ); ?></p>
                    
                    <?php if ( $phone ) : ?>
                        <a href="tel:<?php echo esc_attr( get_phone_href() ); ?>" class="btn btn-light btn-lg">
                            <?php esc_html_e( 'Call', '${themeSlug}' ); ?> <?php echo esc_html( $phone ); ?>
                        </a>
                    <?php endif; ?>
                </div>
            </section>

        </article>

    <?php endwhile; endif; ?>

</main>

<?php
get_footer();
`;
}

function generateIndexPhp(options = {}) {
  const { themeSlug = 'local-business-theme' } = options;

  return `<?php
/**
 * Index Template (Fallback)
 * 
 * WordPress requires this file
 *
 * @package ${themeSlug}
 */

get_header();
?>

<main id="main-content" class="site-main">
    <div class="container">

        <?php if ( have_posts() ) : ?>

            <?php while ( have_posts() ) : the_post(); ?>
                <article id="post-<?php the_ID(); ?>" <?php post_class(); ?>>
                    <header class="entry-header">
                        <h1 class="entry-title">
                            <a href="<?php the_permalink(); ?>"><?php the_title(); ?></a>
                        </h1>
                    </header>

                    <div class="entry-content">
                        <?php the_excerpt(); ?>
                    </div>
                </article>
            <?php endwhile; ?>

            <?php the_posts_pagination(); ?>

        <?php else : ?>

            <article class="no-results">
                <header class="entry-header">
                    <h1 class="entry-title"><?php esc_html_e( 'Nothing Found', '${themeSlug}' ); ?></h1>
                </header>

                <div class="entry-content">
                    <p><?php esc_html_e( 'It seems we can&rsquo;t find what you&rsquo;re looking for.', '${themeSlug}' ); ?></p>
                </div>
            </article>

        <?php endif; ?>

    </div>
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