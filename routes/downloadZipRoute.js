const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// DOWNLOAD-ZIP route to download this user's zipped website
router.get('/download-zip', (req, res) => {
  const userId = req.user._id.toString();
  const zipPath = path.join(__dirname, `../dist_user_${userId}.zip`);

  if (fs.existsSync(zipPath)) {
    res.download(zipPath, 'website.zip', err => {
      if (!err) {
        // Optional: delete only THIS user's ZIP after successful download
        fs.unlink(zipPath, () => {});
      }
    });
  } else {
    res.status(404).send('❌ ZIP file not found for this user.');
  }
});

module.exports = router;
