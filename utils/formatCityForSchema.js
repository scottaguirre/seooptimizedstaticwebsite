function formatCityForSchema(input) {
    const parts = input.trim().split(/[\s,]+/); // split by spaces or commas
  
    // Capitalize each word in the city
    const cityWords = parts.slice(0, -1); // everything except the last word (assumed state)
    const city = cityWords.map(word =>
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
  
    return city; // only the city name (for addressLocality)
  }

  module.exports = { formatCityForSchema };
  