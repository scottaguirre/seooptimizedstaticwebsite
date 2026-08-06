// utils/pageParts.js
//
// Pieces shared by more than one page builder.
//
// Both of these previously lived inside buildAboutUsPage.js: the contact form
// markup as an inline template string, and copyPageImage as a local function.
// The contact page needs both, and copy-pasting them would mean two versions
// of the form drifting apart — change the fields on one page and the other
// silently keeps the old ones.

const fs = require('fs');
const path = require('path');

/**
 * Copy one predefined image into the page's assets folder under an
 * SEO-friendly name. Silently skips a missing source: a page with one fewer
 * image is fine, a crashed build is not.
 */
function copyPageImage(srcDir, seoPrefix, filename, field, distDir) {
  const src = path.join(srcDir, filename);
  if (!fs.existsSync(src)) return false;

  const assetsDir = path.join(distDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  fs.copyFileSync(src, path.join(assetsDir, `${seoPrefix}-${field}.webp`));
  return true;
}

/**
 * The contact form.
 *
 * ONE definition, used by the home page and the contact page. The static
 * build has no backend, so it posts via mailto: — which opens the visitor's
 * mail client with the fields filled in. Not elegant, but it works from a
 * plain zip on any host. The WordPress export replaces this with an Ajax
 * form that posts to admin-ajax.php.
 *
 * Returns '' when there is no email address to send to, so the caller can
 * drop the section entirely rather than render a form that goes nowhere.
 */
function buildContactFormHtml(globalValues = {}, heading = 'Get In Touch') {
  const email = String(globalValues.email || '').trim();
  if (!email || !/\S+@\S+/.test(email)) return '';

  return `
            <section class="form-container">
            <div class="bg-secondary-subtle">
                <form class="contact-form" id="contactForm" action="mailto:${email}" method="POST" enctype="text/plain">
                    <h2>${heading}</h2>
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
            </section>
            `;
}

module.exports = { copyPageImage, buildContactFormHtml };