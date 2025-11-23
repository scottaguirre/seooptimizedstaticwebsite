// utils/wpThemeBuilder/wpHelpers/fileHelpers.js

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

/**
 * Recursively copy a directory and all its contents
 * Example: copyDirRecursive('/src/assets', '/dest/assets')
 */
async function copyDirRecursive(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      await fsp.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Ensure a directory exists, creating it if necessary
 * Example: ensureDir('/path/to/wp-theme/inc')
 */
async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

/**
 * Write content to a file, creating parent directories if needed
 * Example: writeFile('/theme/functions.php', phpContent)
 */
async function writeFile(filePath, content) {
  await ensureDir(path.dirname(filePath));
  await fsp.writeFile(filePath, content, 'utf8');
}

/**
 * Check if a file or directory exists
 * Example: if (fileExists('/theme/style.css')) { ... }
 */
function fileExists(filePath) {
  return fs.existsSync(filePath);
}

/**
 * Read file contents as a string
 * Example: const html = await readFile('/dist/index.html')
 */
async function readFile(filePath) {
  return fsp.readFile(filePath, 'utf8');
}

/**
 * List files in a directory, optionally filtered by extension
 * Example: listFiles('/theme/css', '.css') → ['style.css', 'bootstrap.min.css']
 */
async function listFiles(dirPath, extension = null) {
  if (!fs.existsSync(dirPath)) return [];

  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  let files = entries.filter(e => e.isFile()).map(e => e.name);

  if (extension) {
    const ext = extension.startsWith('.') ? extension : `.${extension}`;
    files = files.filter(f => f.toLowerCase().endsWith(ext.toLowerCase()));
  }

  return files;
}

/**
 * List all HTML files in a directory
 * Example: listHtmlFiles('/dist') → ['index.html', 'about.html', 'contact.html']
 */
async function listHtmlFiles(dirPath) {
  return listFiles(dirPath, '.html');
}

/**
 * Delete a file if it exists
 * Example: deleteFile('/old-theme.zip')
 */
async function deleteFile(filePath) {
  if (fs.existsSync(filePath)) {
    await fsp.unlink(filePath);
  }
}

/**
 * Delete a directory and all its contents
 * Example: deleteDir('/wp-theme/old-theme')
 */
async function deleteDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    await fsp.rm(dirPath, { recursive: true, force: true });
  }
}

module.exports = {
  copyDirRecursive,
  ensureDir,
  writeFile,
  fileExists,
  readFile,
  listFiles,
  listHtmlFiles,
  deleteFile,
  deleteDir,
};