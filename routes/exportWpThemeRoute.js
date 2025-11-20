// routes/exportWpThemeRoute.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const { buildWordPressTheme } = require('../utils/wpThemeBuilder');

const router = express.Router();

const baseDistDir = path.join(__dirname, '../dist');

function getUserDirs(userId) {
  const safeId = String(userId);
  const distDir = path.join(baseDistDir, `user_${safeId}`);
  return { distDir };
}

// GET /export-wp-theme
// 🔐 This router is already wrapped with requireAuth in server.js
router.get('/export-wp-theme', async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const { distDir } = getUserDirs(userId);

    if (!fs.existsSync(distDir)) {
      return res
        .status(400)
        .send('No generated site found for this user. Please run a generation first.');
    }

    const { themeSlug, themeDir } = await buildWordPressTheme(distDir, {
      themeName: 'Local Business Static Theme',
      themeAuthor: 'Static Website Generator'
    });

    return res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>WordPress Theme Generated</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"/>
      </head>
      <body>
        <div class="container mt-5">
          <h2>✅ WordPress Theme Generated</h2>
          <p><strong>Theme slug:</strong> ${themeSlug}</p>
          <p><strong>Theme folder created at:</strong></p>
          <pre>${themeDir}</pre>
          <p class="mt-3">
            You can now zip this folder and upload it in WordPress under
            <strong>Appearance → Themes → Add New → Upload Theme</strong>.
          </p>
          <a href="/" class="btn btn-secondary mt-3">Back to Home</a>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('Error during /export-wp-theme:', err);
    return res.status(500).send('Failed to generate WordPress theme.');
  }
});

module.exports = router;
