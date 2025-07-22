

const validateEachPageHasFiles =  function (fileMap, pages, res){

    // Validate each page has required files
    for (const [index, page] of Object.entries(pages)) {
        const filesForPage = fileMap[index] || {};
        
    
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
        const invalidFiles = Object.entries(filesForPage)
        .filter(([_, file]) => !allowedTypes.includes(file.mimetype));
    
        if (invalidFiles.length > 0) {
          const badFields = invalidFiles.map(([field]) => field).join(', ');
          return res.status(400).send(`❌ Page ${parseInt(index) + 1} has invalid image types for: ${badFields}`);
        }
    }


}

module.exports = { validateEachPageHasFiles };