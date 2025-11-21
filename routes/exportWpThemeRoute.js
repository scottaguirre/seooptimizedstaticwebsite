// routes/exportWpThemeRoute.js
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const requireAuth = require('../middleware/requireAuth');
const { buildWordPressTheme } = require('../utils/wpThemeBuilder');

const baseDistDir = path.join(__dirname, '../dist');


// Helper to zip a directory into a .zip file
function zipDirectory(sourceDir, outPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve());
    archive.on('error', err => reject(err));

    archive.pipe(output);
    const themeFolderName = path.basename(sourceDir);
    archive.directory(sourceDir, themeFolderName);
    // put folder contents at root of zip
    archive.finalize();
  });
}


function getUserDirs(userId) {
  const safeId = String(userId);
  const distDir = path.join(baseDistDir, `user_${safeId}`);
  return { distDir };
}

// GET /export-wp-theme
// GET /export-wp-theme – build WP theme and create ZIP for this user
router.get('/export-wp-theme', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();

    // 1) User’s dist folder where static site lives
    const userDistDir = path.join(__dirname, '..', 'dist', `user_${userId}`);

    // 2) Build WP theme into: dist/user_<id>/wp-theme/<themeSlug>/
    const themeOptions = {
      themeSlug:  'local-business-theme',
      themeName:  'Local Business Static Theme',
      themeAuthor:'Static Website Generator'
    };

    const { themeSlug, themeDir } = await buildWordPressTheme(userDistDir, themeOptions);
    // themeDir is something like: /.../dist/user_<id>/wp-theme/local-business-theme

    // 3) Create ZIP path (per user)
    const themeFolderName = path.basename(themeDir); // "local-business-theme"

    const zipPath = path.join(
      __dirname,
      '..',
      'dist',
      `user_${userId}_${themeFolderName}.zip`
    );
    

    // If an old zip exists, remove it first (optional)
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }

    // 4) Zip the theme directory
    await zipDirectory(themeDir, zipPath);

    // 5) Respond with a simple page & a download button
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>WordPress Theme Exported</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet" />
      </head>
      <body class="bg-light d-flex align-items-center justify-content-center min-vh-100">
        <div class="container" style="max-width: 700px;">
          <div class="card shadow p-4">
            <h1 class="h4 mb-3">WordPress Theme Ready</h1>
           
            <div class="d-flex justify-content-between">
              <a href="/" class="btn btn-outline-secondary">Back to Generator</a>
              <a href="/download-wp-theme" class="btn btn-primary">
                Download WordPress Theme (ZIP)
              </a>
            </div>
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('Error during /export-wp-theme:', err);
    res.status(500).send('Error building WordPress theme.');
  }
});

// GET /download-wp-theme – send the ZIP for this user's theme
// GET /download-wp-theme – send the ZIP for this user's theme
router.get('/download-wp-theme', requireAuth, (req, res) => {
  const userId = req.user._id.toString();

  // Use the same theme slug / folder name as in /export-wp-theme
  const themeFolderName = 'local-business-theme';

  const zipPath = path.join(
    __dirname,
    '..',
    'dist',
    `user_${userId}_${themeFolderName}.zip`
  );

  if (!fs.existsSync(zipPath)) {
    return res.status(404).send('No theme ZIP found. Please run the WordPress export again.');
  }

  const zipFileName = 'local-business-theme.zip'; // e.g. user_<id>_local-business-theme.zip
  
  res.download(zipPath, zipFileName, err => {
    if (err) {
      console.error(`Error sending ${zipFileName}:`, err);
      return;
    }
    // Optional: delete ZIP after successful download
    fs.unlink(zipPath, () => {});
  });
});


module.exports = router;

