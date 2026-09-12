// utils/wpThemeBuilder/generators/pageTemplatesPhp.js
//
// Templates are now thin: they call the section renderer, which rebuilds the
// page from editable meta on every request. Nothing echoes a frozen blob.

const { makePhpIdentifier } = require('../wpHelpers/phpHelpers');

function header(themeSlug, title, extra = '') {
  return `<?php
/**
 * ${title}
 *${extra}
 * @package ${themeSlug}
 */

get_header();
?>
`;
}

function generateFrontPagePhp(options = {}) {
  const { themeSlug = 'local-business-theme' } = options;
  const p = makePhpIdentifier(themeSlug);

  return `${header(themeSlug, 'Front Page Template')}
<main id="main-content" class="site-main front-page">
    <?php
    while ( have_posts() ) :
        the_post();
        ${p}_render_sections( get_the_ID() );
    endwhile;
    ?>
</main>

<?php
get_footer();
`;
}

function generatePagePhp(options = {}) {
  const { themeSlug = 'local-business-theme' } = options;
  const p = makePhpIdentifier(themeSlug);

  return `${header(themeSlug, 'Default Page Template')}
<main id="main-content" class="site-main page-template">
    <?php
    while ( have_posts() ) :
        the_post();
        ${p}_render_page_body( get_the_ID() );
    endwhile;
    ?>
</main>

<?php
get_footer();
`;
}

function generatePageSlugTemplate(slug, title, options = {}) {
  const { themeSlug = 'local-business-theme' } = options;
  const p = makePhpIdentifier(themeSlug);

  return `<?php
/**
 * Page Template: ${title}
 * Template Name: ${title}
 *
 * @package ${themeSlug}
 */

get_header();
?>

<main id="main-content" class="site-main page-${slug}">
    <?php
    while ( have_posts() ) :
        the_post();
        ${p}_render_page_body( get_the_ID() );
    endwhile;
    ?>
</main>

<?php
get_footer();
`;
}

/**
 * WordPress requires index.php. Pages use sections; posts fall back to
 * the_content() — including the ones the Interlink Engine plugin publishes,
 * which write ordinary post_content rather than a section model.
 */
function generateIndexPhp(options = {}) {
  const { themeSlug = 'local-business-theme' } = options;
  const p = makePhpIdentifier(themeSlug);

  return `${header(themeSlug, 'Index Template (fallback)')}
<main id="main-content" class="site-main">

    <?php if ( is_singular() ) : ?>

        <?php while ( have_posts() ) : the_post(); ?>
            <?php if ( is_page() && ${p}_get_sections( get_the_ID() ) ) : ?>
                <?php ${p}_render_page_body( get_the_ID() ); ?>
            <?php else : ?>
                <section class="section-1">
                  <div class="container section-padding">
                    <div class="row">
                      <div class="col-lg-10">
                        <h1><?php the_title(); ?></h1>
                        <?php the_content(); ?>
                      </div>
                    </div>
                  </div>
                </section>
            <?php endif; ?>
        <?php endwhile; ?>

    <?php else : ?>

        <section class="section-1">
          <div class="container section-padding pb-0">
            <div class="row">
              <div class="col-lg-10">
                <h1>
                  <?php
                  if ( is_search() ) {
                      printf( esc_html__( 'Search results for "%s"', '${themeSlug}' ), esc_html( get_search_query() ) );
                  } elseif ( is_archive() ) {
                      the_archive_title();
                  } else {
                      esc_html_e( 'Latest posts', '${themeSlug}' );
                  }
                  ?>
                </h1>
              </div>
            </div>
          </div>
        </section>

        <section class="bg-secondary-subtle">
          <?php ${p}_render_post_grid(); ?>
        </section>

    <?php endif; ?>

</main>

<?php
get_footer();
`;
}

/**
 * single.php — blog posts.
 *
 * Without this, posts fell through to index.php. They now use the same
 * container and spacing classes as the rest of the site, and any extra
 * sections the client appended are rendered after the post body.
 *
 * THE FEATURED IMAGE
 *
 * Every piece of this already existed except the four lines that draw it.
 * functions.php declares `post-thumbnails` support and registers four hero
 * sizes; the blog card grid renders a thumbnail when there is one; the
 * BlogPosting schema publishes it as `image`. Only the post's own page left
 * it out — so a customer could set a Featured Image, watch it appear on the
 * blog listing, open the post, and find the wall of text they started with.
 *
 * Which also means there is nothing to build on the plugin side for this.
 * WordPress's own Featured Image panel is already in the editor on these
 * sites, and it is already one image per post.
 */
function generateSinglePhp(options = {}) {
  const { themeSlug = 'local-business-theme' } = options;
  const p = makePhpIdentifier(themeSlug);

  return `${header(themeSlug, 'Single Post Template')}
<main id="main-content" class="site-main single-post">

    <?php while ( have_posts() ) : the_post(); ?>

        <section class="section-1">
          <div class="container section-padding">
            <div class="row">
              <div class="col-lg-10">
                <h1><?php the_title(); ?></h1>
                <p class="post-meta text-muted">
                  <time datetime="<?php echo esc_attr( get_the_date( 'c' ) ); ?>">
                    <?php echo esc_html( get_the_date() ); ?>
                  </time>
                </p>

                <?php if ( has_post_thumbnail() ) : ?>
                  <figure class="post-hero mb-4">
                    <?php
                    // eager + fetchpriority, NOT lazy. This is the largest
                    // element above the fold, so it is the LCP candidate on
                    // every post page: lazy-loading it means the browser
                    // discovers it late and the metric measures the delay.
                    // WordPress lazy-loads thumbnails by default, so saying
                    // nothing here is the same as opting into the slow path.
                    //
                    // No alt is passed. the_post_thumbnail() uses the
                    // attachment's own alt text, which is what the customer
                    // typed in the media library; overriding it with the post
                    // title would make every hero announce the heading that is
                    // already directly above it. Empty stays empty, which is
                    // the correct reading of a decorative stock photo.
                    the_post_thumbnail( '${p}-hero-desktop', array(
                        'class'         => 'img-fluid w-100 rounded',
                        'loading'       => 'eager',
                        'fetchpriority' => 'high',
                    ) );
                    ?>
                    <?php $hero_caption = get_the_post_thumbnail_caption(); ?>
                    <?php if ( $hero_caption ) : ?>
                      <figcaption class="text-muted small mt-2"><?php echo esc_html( $hero_caption ); ?></figcaption>
                    <?php endif; ?>
                  </figure>
                <?php endif; ?>

                <?php the_content(); ?>
              </div>
            </div>
          </div>
        </section>

        <?php ${p}_render_custom_sections( get_the_ID() ); ?>

    <?php endwhile; ?>

</main>

<?php
get_footer();
`;
}

/**
 * home.php — the blog index.
 *
 * WordPress uses this when a static page is set as the front page, which is
 * exactly the setup activation creates. Without it the listing falls through
 * to index.php.
 */
function generateHomePhp(options = {}) {
  const { themeSlug = 'local-business-theme' } = options;
  const p = makePhpIdentifier(themeSlug);

  return `${header(themeSlug, 'Blog Index Template')}
<main id="main-content" class="site-main blog-index">

    <section class="section-1">
      <div class="container section-padding pb-0">
        <div class="row">
          <div class="col-lg-10">
            <?php
            $blog_page_id = (int) get_option( 'page_for_posts' );
            $blog_title = $blog_page_id ? get_the_title( $blog_page_id ) : __( 'Blog', '${themeSlug}' );
            ?>
            <h1><?php echo esc_html( $blog_title ); ?></h1>
            <?php
            if ( $blog_page_id ) {
                $intro = get_post_field( 'post_content', $blog_page_id );
                if ( trim( wp_strip_all_tags( $intro ) ) !== '' ) {
                    echo wp_kses_post( wpautop( $intro ) );
                }
            }
            ?>
          </div>
        </div>
      </div>
    </section>

    <section class="bg-secondary-subtle">
      <?php ${p}_render_post_grid(); ?>
    </section>

</main>

<?php
get_footer();
`;
}

module.exports = {
  generateFrontPagePhp,
  generateSinglePhp,
  generateHomePhp,
  generatePagePhp,
  generatePageSlugTemplate,
  generateIndexPhp,
};