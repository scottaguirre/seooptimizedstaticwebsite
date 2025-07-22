// === Helper to Convert to Title Case (smart)
function smartTitleCase(str) {
    const skipWords = ['a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 'to', 'from', 'by', 'with', 'in', 'of'];
    return str
      .toLowerCase()
      .split(' ')
      .map((word, index) => {
        if (index === 0 || !skipWords.includes(word)) {
          return word.charAt(0).toUpperCase() + word.slice(1);
        } else {
          return word;
        }
      })
      .join(' ');
  }

  module.exports = { smartTitleCase };
  