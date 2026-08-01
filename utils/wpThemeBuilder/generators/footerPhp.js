// utils/wpThemeBuilder/generators/footerPhp.js
//
// Emits the SAME markup as the footer in src/template.html — the two
// .container.py-4 rows, the legal links, the copyright line and the inline
// social SVGs — so the generated stylesheet applies unchanged.

const { makePhpIdentifier } = require('../wpHelpers/phpHelpers');

// Same paths as the static templates, so the icons render identically.
const SOCIAL_SVGS = {
  facebook: {
    label: 'Facebook',
    fill: '#1877F2',
    viewBox: '0 0 24 24',
    path: 'M22.675 0H1.325C.593 0 0 .593 0 1.326v21.348C0 23.407.593 24 1.325 24h11.495v-9.294H9.691v-3.622h3.129V8.413c0-3.1 1.894-4.788 4.659-4.788 1.325 0 2.466.099 2.798.143v3.24l-1.922.001c-1.504 0-1.796.715-1.796 1.763v2.31h3.587l-.467 3.622h-3.12V24h6.116C23.406 24 24 23.407 24 22.674V1.326C24 .593 23.407 0 22.675 0z',
  },
  twitter: {
    label: 'Twitter (X)',
    fill: '#000000',
    viewBox: '0 0 24 24',
    path: 'M2.25 2h5.64l4.61 6.49L17.11 2h4.64l-7.57 9.35L22 22h-5.7l-5.01-7.03L5.61 22H1l8.08-9.97L2.25 2zm6.38 1.49H5.61l12.15 17.02h3.02L8.63 3.49z',
  },
  pinterest: {
    label: 'Pinterest',
    fill: '#E60023',
    viewBox: '0 0 24 24',
    path: 'M12 0C5.37 0 0 5.37 0 12c0 4.87 3.09 9.03 7.44 10.64-.1-.9-.19-2.28.04-3.26.21-.9 1.38-5.71 1.38-5.71s-.35-.7-.35-1.72c0-1.61.94-2.81 2.11-2.81.99 0 1.46.74 1.46 1.63 0 1-.63 2.49-.96 3.87-.27 1.14.57 2.07 1.69 2.07 2.03 0 3.6-2.14 3.6-5.24 0-2.74-1.97-4.66-4.78-4.66-3.26 0-5.17 2.45-5.17 4.98 0 .99.38 2.06.86 2.64.1.12.11.23.08.36-.09.4-.28 1.27-.32 1.45-.05.21-.17.26-.4.16-1.49-.62-2.42-2.56-2.42-4.11 0-3.35 2.44-6.42 7.05-6.42 3.7 0 6.57 2.64 6.57 6.17 0 3.68-2.31 6.64-5.52 6.64-1.08 0-2.09-.56-2.44-1.22l-.66 2.5c-.24.91-.88 2.05-1.3 2.75.98.3 2.02.46 3.1.46 6.63 0 12-5.37 12-12S18.63 0 12 0z',
  },
  youtube: {
    label: 'YouTube',
    fill: '#FF0000',
    viewBox: '0 0 576 512',
    path: 'M549.7 124.1c-6.3-23.7-24.9-42.3-48.6-48.6C456.9 64 288 64 288 64S119.1 64 74.9 75.5c-23.7 6.3-42.3 24.9-48.6 48.6C15.8 168.3 15.8 256 15.8 256s0 87.7 10.5 131.9c6.3 23.7 24.9 42.3 48.6 48.6C119.1 448 288 448 288 448s168.9 0 213.1-11.5c23.7-6.3 42.3-24.9 48.6-48.6C560.2 343.7 560.2 256 560.2 256s0-87.7-10.5-131.9zM232 336V176l142 80-142 80z',
  },
  linkedin: {
    label: 'LinkedIn',
    fill: '#0A66C2',
    viewBox: '0 0 24 24',
    path: 'M20.447 20.452H17.21V14.85c0-1.336-.027-3.058-1.864-3.058-1.865 0-2.15 1.454-2.15 2.957v5.703h-3.24V9h3.111v1.561h.045c.433-.82 1.493-1.683 3.073-1.683 3.287 0 3.893 2.164 3.893 4.978v6.596zM5.337 7.433a1.875 1.875 0 1 1 0-3.751 1.875 1.875 0 0 1 0 3.751zM6.766 20.452H3.91V9h2.856v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z',
  },
  instagram: {
    label: 'Instagram',
    fill: '#E4405F',
    viewBox: '0 0 24 24',
    path: 'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z',
  },
};

function socialPhp(p, themeSlug) {
  return Object.entries(SOCIAL_SVGS).map(([key, s]) => `
        <?php
        $url = ${p}_get_setting( 'social_${key}' );
        if ( $url ) : ?>
          <a href="<?php echo esc_url( $url ); ?>" target="_blank" aria-label="${s.label}" rel="noopener noreferrer">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="${s.fill}" viewBox="${s.viewBox}" aria-label="${s.label}">
              <path d="${s.path}"/>
            </svg>
          </a>
        <?php endif; ?>`).join('');
}

function generateFooterPhp(options = {}) {
  const { themeSlug = 'local-business-theme' } = options;
  const p = makePhpIdentifier(themeSlug);

  return `<?php
/**
 * Footer Template
 *
 * Markup mirrors the generated static site so the chosen stylesheet applies.
 *
 * @package ${themeSlug}
 */
?>

  <footer class="text-center text-lg-start mt-auto border-top">
    <div class="container py-4">
      <div class="row justify-content-between align-items-center">
        <div class="col-md-12 text-md-end d-flex justify-content-center gap-3">
          <?php
          $legal = array(
              'accessibility'  => __( 'Accessibility', '${themeSlug}' ),
              'terms-of-use'   => __( 'Terms of Use', '${themeSlug}' ),
              'privacy-policy' => __( 'Privacy Policy', '${themeSlug}' ),
          );
          foreach ( $legal as $slug => $label ) {
              $pg = get_page_by_path( $slug );
              if ( $pg ) {
                  printf(
                      '<a href="%s">%s</a>',
                      esc_url( get_permalink( $pg->ID ) ),
                      esc_html( $label )
                  );
              }
          }
          ?>
        </div>
      </div>
    </div>

    <div class="container py-4">
      <div class="row justify-content-between align-items-center">
        <div class="col-md-6 text-md-start mb-3 mb-md-0">
          <p class="mb-0">
            &copy; <?php echo esc_html( date( 'Y' ) ); ?>
            <?php
            $business = ${p}_get_setting( 'business_name' );
            echo esc_html( $business ? $business : get_bloginfo( 'name' ) );
            ?>.
            <?php esc_html_e( 'All rights reserved.', '${themeSlug}' ); ?>
          </p>
        </div>
        <div class="col-md-6 text-md-end d-flex justify-content-center justify-content-md-end gap-3">${socialPhp(p, themeSlug)}
        </div>
      </div>
    </div>
  </footer>

</div><!-- #page -->

<?php wp_footer(); ?>

</body>
</html>
`;
}

module.exports = {
  generateFooterPhp,
};