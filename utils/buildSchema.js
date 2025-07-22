const { formatCityForSchema } = require('./formatCityForSchema');
const { normalizeDomain } = require('./normalizeDomain');
const { getFullStateName } = require('./getFullStateName');


const buildSchema = function (globalValues, uploadedImages, index, page, coordinates, reviews){
    
  //console.log(globalValues);
  
  const jsonLdString = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        name: globalValues.businessName,
        url: `https://${normalizeDomain(globalValues.domain)}`,
        telephone: globalValues.phone,
        image: Object.values(uploadedImages[index] || {}),
        address: {
          "@type": "PostalAddress",
          streetAddress: globalValues.address,
          addressLocality: formatCityForSchema(globalValues.location),
          addressRegion: getFullStateName(globalValues.location),
          postalCode: globalValues.address.match(/\b\d{5}\b/)?.[0] || "",
          addressCountry: "United States"
        },
        geo: {
          "@type": "GeoCoordinates",
          latitude: coordinates.latitude,
          longitude: coordinates.longitude
        },
        openingHours: ["Mo 07:30-19:30", "Tu 07:30-19:30", "We 07:30-19:30", "Th 07:30-19:30", "Fr 07:30-19:30", "Sa 07:30-19:30", "Su 07:30-19:30"],
        review: reviews
      });

      return jsonLdString;
    
}

module.exports = { buildSchema };