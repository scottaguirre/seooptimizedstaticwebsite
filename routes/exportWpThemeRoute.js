// routes/exportWpThemeRoute.js
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const requireAuth = require('../middleware/requireAuth');

// Import the new modular builder
const { buildWordPressTheme } = require('../utils/wpThemeBuilder');

const baseDistDir = path.join(__dirname, '../dist');

/**
 * Helper to zip a directory
 */
function zipDirectory(sourceDir, outPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve());
    archive.on('error', err => reject(err));

    archive.pipe(output);
    
    // Get the theme folder name (last part of the path)
    const themeFolderName = path.basename(sourceDir);
    
    // Add the directory with the theme folder as root
    archive.directory(sourceDir, themeFolderName);
    archive.finalize();
  });
}

/**
 * Get user-specific directories
 */
function getUserDirs(userId) {
  const safeId = String(userId);
  const distDir = path.join(baseDistDir, `user_${safeId}`);
  return { distDir };
}

/**
 * GET /export-wp-theme
 * Build WordPress theme from static site and create ZIP
 */
router.get('/export-wp-theme', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const userDistDir = path.join(baseDistDir, `user_${userId}`);

    // Check if user has a static site generated
    if (!fs.existsSync(userDistDir)) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <title>No Static Site Found</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet" />
        </head>
        <body class="bg-light d-flex align-items-center justify-content-center min-vh-100">
          <div class="container" style="max-width: 700px;">
            <div class="card shadow p-4">
              <h1 class="h4 mb-3 text-danger">❌ No Static Site Found</h1>
              <p>You need to generate a static website first before converting it to WordPress.</p>
              <a href="/" class="btn btn-primary">Go to Generator</a>
            </div>
          </div>
        </body>
        </html>
      `);
    }

    // Check for index.html
    const indexHtmlPath = path.join(userDistDir, 'index.html');
    if (!fs.existsSync(indexHtmlPath)) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <title>Invalid Static Site</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet" />
        </head>
        <body class="bg-light d-flex align-items-center justify-content-center min-vh-100">
          <div class="container" style="max-width: 700px;">
            <div class="card shadow p-4">
              <h1 class="h4 mb-3 text-danger">❌ Invalid Static Site</h1>
              <p>Your static site is missing index.html. Please regenerate your website.</p>
              <a href="/" class="btn btn-primary">Go to Generator</a>
            </div>
          </div>
        </body>
        </html>
      `);
    }

    console.log('🚀 Starting WordPress theme build for user:', userId);

    // Get user info from the request (you might want to pull this from your DB)
    const businessName = req.user.businessName || 'Local Business';
    const location = req.user.location || '';

    // Theme configuration
    const themeOptions = {
      themeSlug: 'local-business-theme',
      themeName: businessName ? `${businessName} Theme` : 'Local Business Theme',
      themeAuthor: 'Static Website Generator',
      themeVersion: '1.0.0',
      
      // Optional: Pass any additional global settings
      globalSettings: {
        business_name: businessName,
        location: location,
        // Add more if you have them available
      },
    };

    // Build the WordPress theme using the modular builder
    const { themeSlug, themeDir, summary } = await buildWordPressTheme(
      userDistDir,
      themeOptions
    );

    console.log('✅ Theme built successfully');
    console.log('   Pages:', summary.pages);
    console.log('   Content fields:', summary.contentFields);
    console.log('   Global settings:', summary.globalSettings);

    // Create ZIP path
    const themeFolderName = path.basename(themeDir);
    const zipPath = path.join(baseDistDir, `user_${userId}_${themeFolderName}.zip`);

    // Remove old ZIP if it exists
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }

    console.log('📦 Creating ZIP file...');

    // Create ZIP
    await zipDirectory(themeDir, zipPath);

    console.log('✅ ZIP created successfully');

    // Send success page with download button
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>WordPress Theme Ready</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet" />
        <style>
          .stat-card {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 15px;
          }
          .stat-number {
            font-size: 2rem;
            font-weight: bold;
            color: #0d6efd;
          }
          .stat-label {
            font-size: 0.875rem;
            color: #6c757d;
            text-transform: uppercase;
          }
        </style>
      </head>
      <body class="bg-light">
        <div class="container py-5" style="max-width: 800px;">
          <div class="card shadow-lg">
            <div class="card-body p-5">
              <div class="text-center mb-4">
                <div class="display-1 mb-3">✅</div>
                <h1 class="h3 mb-2">WordPress Theme Ready!</h1>
                <p class="text-muted">Your static website has been successfully converted</p>
              </div>

              <div class="row mb-4">
                <div class="col-md-4">
                  <div class="stat-card text-center">
                    <div class="stat-number">${summary.pages}</div>
                    <div class="stat-label">Pages Created</div>
                  </div>
                </div>
                <div class="col-md-4">
                  <div class="stat-card text-center">
                    <div class="stat-number">${summary.contentFields}</div>
                    <div class="stat-label">Editable Fields</div>
                  </div>
                </div>
                <div class="col-md-4">
                  <div class="stat-card text-center">
                    <div class="stat-number">${summary.globalSettings}</div>
                    <div class="stat-label">Global Settings</div>
                  </div>
                </div>
              </div>

              <div class="alert alert-info mb-4">
                <strong>📋 What's included:</strong>
                <ul class="mb-0 mt-2">
                  <li>All pages with editable content</li>
                  <li>Navigation menu (automatically created)</li>
                  <li>Admin interface for editing all content</li>
                  <li>Theme settings page for global options</li>
                  <li>All CSS, JavaScript, and images</li>
                </ul>
              </div>

              <div class="d-grid gap-3">
                <a href="/download-wp-theme" class="btn btn-primary btn-lg">
                  📥 Download WordPress Theme (ZIP)
                </a>
                <a href="/" class="btn btn-outline-secondary">
                  ← Back to Generator
                </a>
              </div>

              <hr class="my-4">

              <div class="small text-muted">
                <strong>Installation Instructions:</strong>
                <ol class="mt-2 mb-0">
                  <li>Download the ZIP file above</li>
                  <li>Go to your WordPress admin → Appearance → Themes</li>
                  <li>Click "Add New" → "Upload Theme"</li>
                  <li>Upload the ZIP file and activate</li>
                  <li>Your content will be automatically imported!</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `);

  } catch (err) {
    console.error('❌ Error during /export-wp-theme:', err);
    
    res.status(500).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Error Building Theme</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet" />
      </head>
      <body class="bg-light d-flex align-items-center justify-content-center min-vh-100">
        <div class="container" style="max-width: 700px;">
          <div class="card shadow p-4">
            <h1 class="h4 mb-3 text-danger">❌ Error Building WordPress Theme</h1>
            <p class="text-muted mb-3">Something went wrong during the conversion process.</p>
            <div class="alert alert-danger">
              <strong>Error:</strong> ${err.message}
            </div>
            <a href="/" class="btn btn-primary">Back to Generator</a>
          </div>
        </div>
      </body>
      </html>
    `);
  }
});

/**
 * GET /download-wp-theme
 * Download the generated WordPress theme ZIP
 */
router.get('/download-wp-theme', requireAuth, (req, res) => {
  const userId = req.user._id.toString();
  const themeFolderName = 'local-business-theme';
  const zipPath = path.join(baseDistDir, `user_${userId}_${themeFolderName}.zip`);

  if (!fs.existsSync(zipPath)) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Theme Not Found</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet" />
      </head>
      <body class="bg-light d-flex align-items-center justify-content-center min-vh-100">
        <div class="container" style="max-width: 700px;">
          <div class="card shadow p-4">
            <h1 class="h4 mb-3 text-warning">⚠️ Theme Not Found</h1>
            <p>No WordPress theme ZIP found. Please export the theme again.</p>
            <a href="/export-wp-theme" class="btn btn-primary">Export WordPress Theme</a>
          </div>
        </div>
      </body>
      </html>
    `);
  }

  const zipFileName = 'local-business-theme.zip';

  res.download(zipPath, zipFileName, err => {
    if (err) {
      console.error(`Error sending ${zipFileName}:`, err);
      return;
    }
    
    // Optional: Delete ZIP after successful download to save space
    console.log(`✅ ZIP downloaded by user ${userId}`);
    
    // Uncomment to auto-delete after download:
    // fs.unlink(zipPath, () => {});
  });
});

module.exports = router;