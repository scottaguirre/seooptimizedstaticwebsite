  function formatCityState(input) {
    if (!input || typeof input !== 'string') return '';
  
    const parts = input.trim().split(/[\s,]+/); // split on space or comma
  
    // Handle short or bad input
    if (parts.length < 2) return input.trim();
  
    // Assume all but the last part is city, and last part is state
    const state = parts[parts.length - 1].toUpperCase();
    const cityParts = parts.slice(0, -1);
  
    const city = cityParts
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  
    return `${city}, ${state}`;
  }


  module.exports = { formatCityState };