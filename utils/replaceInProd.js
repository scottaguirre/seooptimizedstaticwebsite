const path = require('path');
const fs = require('fs');

const replaceInProd = function(distDir) {
    fs.readdirSync(distDir).forEach(file => {
      if (file.endsWith('.html')) {
        const filePath = path.join(distDir, file);
        const original = fs.readFileSync(filePath, 'utf-8');
        const replaced = original.replace(/dist\//g, ''); // Use global regex just in case
        fs.writeFileSync(filePath, replaced, 'utf-8');
        console.log(`✅ Replaced links in: ${file}`);
      }
    });
  };
  

module.exports = { replaceInProd };