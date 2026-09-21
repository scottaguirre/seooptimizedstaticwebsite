const fs = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();

const { appHeader, appHeaderAssets, appHeaderScripts } = require('../utils/appHeader');

const FORM_PATH = path.join(__dirname, '../src/views/form.html');

// Read once at startup. The file does not change while the server runs, and
// re-reading it on every page load is needless disk work.
let formHtml = null;

router.get('/', (req, res) => {
  try {
    if (formHtml === null) {
      formHtml = fs.readFileSync(FORM_PATH, 'utf8');
    }

    // Rendered rather than sent as a file, so the CSRF token can be injected.
    //
    // It goes in a META TAG rather than a hidden input because the wizard
    // submits through fetch() with FormData. The CSRF check runs before
    // multer parses that multipart body, so a form field would be invisible
    // at the point of checking — spinner.js reads this meta tag and sends it
    // as the X-CSRF-Token header instead.
    const meta = `<meta name="csrf-token" content="${res.locals.csrfToken || ''}">`;

    // The logout form on this page needs a token too — it is a POST like any
    // other, and without this it is rejected with "Session expired".
    const csrfField = res.locals.csrfField || '';

    // The header, from utils/appHeader.js — the same source the dashboard and
    // the build page use. form.html carries three placeholders instead of the
    // markup, so the header exists in exactly ONE file and updating it cannot
    // leave a page behind.
    //
    // {{HEADER}} is filled BEFORE {{CSRF}}, deliberately: appHeader() already
    // puts the token in the logout form itself, so if the order were reversed
    // the {{CSRF}} pass would run before the header existed and the logout
    // button would silently post without a token.
    res.send(
      formHtml
        .replace('</head>', `  ${meta}\n</head>`)
        .replace(/{{HEADER_ASSETS}}/g, appHeaderAssets())
        .replace(/{{HEADER_SCRIPTS}}/g, appHeaderScripts())
        .replace(/{{HEADER}}/g, appHeader(csrfField))
        .replace(/{{CSRF}}/g, csrfField)
    );

  } catch (err) {
    console.error('Could not render the form page:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
});

module.exports = router;