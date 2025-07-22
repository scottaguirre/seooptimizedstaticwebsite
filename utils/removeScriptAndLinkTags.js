const fs = require('fs');
const path = require('path');

function removeScriptAndLinkTags(distDir) {
  const files = fs.readdirSync(distDir).filter(f => f.endsWith('.html'));

  files.forEach(file => {
    const filePath = path.join(distDir, file);
    let content = fs.readFileSync(filePath, 'utf8');

    // Match any <link> tags that include ./css/, /css/, or css/
    content = content.replace(/<link\b[^>]*href=["'](?:\.\/)?css\/[^"']+\.css["'][^>]*>/gi, '');

    // Match any <script> tags that include ./js/, /js/, or js/
    content = content.replace(/<script\b[^>]*src=["'](?:\.\/)?js\/[^"']+\.js["'][^>]*><\/script>/gi, '');

    fs.writeFileSync(filePath, content, 'utf8');
    
  });

}

module.exports = { removeScriptAndLinkTags };
