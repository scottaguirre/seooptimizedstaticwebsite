const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');


// DOWNLOAD-ZIP route to download all zipped website pages 
router.get('/download-zip', (req, res) => {

    const zipPath = path.join(__dirname, '../dist.zip');
    if (fs.existsSync(zipPath)) {
      res.download(zipPath, 'website.zip', err => {
        if (!err) {
          fs.unlinkSync(zipPath); // Optional cleanup after download
        }
      });
    } else {
      res.status(404).send('❌ ZIP file not found.');
    }
  });

  module.exports = router;