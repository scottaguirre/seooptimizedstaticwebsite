const { getCoordinatesFromAddress } = require('./getCoordinatesFromAddress');

async function googleMap(address){
    // Google Maps
    const coordinates = await getCoordinatesFromAddress(address);
    // assume it returns { lat, lng } or similar
    const { latitude, longitude } = coordinates || {};

    // Build the embed src without any API key (precise via lat,lng)
    const zoom = 15; // tweak to your taste
    let mapEmbedSrc = '';
    if (latitude && longitude) {
    mapEmbedSrc = `https://www.google.com/maps?q=${latitude},${longitude}&z=${zoom}&output=embed`;
    } else {
    // fallback to the address if geocoding failed
    mapEmbedSrc = `https://www.google.com/maps?q=${encodeURIComponent(globalValues.address)}&output=embed`;
    }

    return mapEmbedSrc;

}

module.exports = { googleMap };
