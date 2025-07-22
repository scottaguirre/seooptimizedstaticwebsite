function normalizeText(str = '') {
    return str
      .trim()                          // Remove leading/trailing whitespace
      .replace(/\s{2,}/g, ' ')         // Collapse multiple spaces
      .replace(/[.,;:!?]*$/, '');      // Remove trailing punctuation (optional)
  }

  module.exports = { normalizeText };