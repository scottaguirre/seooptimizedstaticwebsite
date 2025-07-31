
const validateEachPageInputs =  function (pages, res){
    // Validate each page
    for (const [index, page] of Object.entries(pages)) {
        const requiredFields = [
        'filename',
        'keyword'
        ];

        const missing = requiredFields.filter(field => !page[field]?.trim());

        if (missing.length > 0) {
        return res.status(400).send(`❌ Page ${parseInt(index) + 1} is missing required fields: ${missing.join(', ')}`);
        }
    }

}

module.exports = { validateEachPageInputs };

 