const express = require('express');
const router = express.Router();
const path = require('path');
const { exec } = require('child_process');
const { zip } = require('zip-a-folder');


// === Custom Utility Functions ===
const { replaceInProd } = require('../utils/replaceInProd');
const { removeScriptAndLinkTags } = require('../utils/removeScriptAndLinkTags');


const distDir = path.join(__dirname, '../dist'); // ✅ make sure distDir is defined here


// PRODUCTION route to replace 'dist/' with '/' and run webpack
router.get('/production', (req,res) => {
 
    // Replace 'dist/' with '/' in Prod from all html files 
    replaceInProd(distDir);
    
  
    // Remove js scripts and css links from <head> and <body> tags respectively injected in dev from all html files 
    removeScriptAndLinkTags(distDir);
  
    
    // === Run Webpack and zip
    exec('npm run build:webpack', async (err, stdout, stderr) => {
      if (err) {
        console.error('❌ Webpack error:', stderr);
        return res.status(500).send('Webpack build failed.');
      }
  
      console.log('✅ Webpack build complete.');
  
      const zipPath = path.join(__dirname, '../dist.zip');
      await zip(distDir, zipPath);
      console.log('✅ Zipped site.');
  
  
      res.send(`
        <html>
        <head>
          <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"/>
        </head>
        <body>
        <div class="container">
          <h2>✅ Pages generated and optimized successfully!</h2>
          <a href="/download-zip" class="btn btn-success mt-5 ml-5">Download Website ZIP</a>
          <a href="/" class="btn btn-primary mt-5 ml-5">Go Back</a>
        </div>
          
        </body>
        </html>
      `);
    });
  
  });

  module.exports = router;