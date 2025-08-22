const axios = require('axios');

// === Get lat/lng from OpenStreetMap (no API key needed) ===
async function getCoordinatesFromAddress(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`;

  try {
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'StaticSiteGenerator/1.0 (your@email.com)' }
    });

    const location = response.data[0];
    if (location) {
      return {
        latitude: location.lat,
        longitude: location.lon
      };
    }
  } catch (err) {
    console.error('OpenStreetMap geocoding error:', err.message);
  }

  return {
    latitude: '',
    longitude: ''
  };
}

module.exports = { getCoordinatesFromAddress };