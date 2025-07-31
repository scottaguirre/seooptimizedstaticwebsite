const { formatCityForSchema } = require('./formatCityForSchema');
const { normalizeDomain } = require('./normalizeDomain');
const { getFullStateName } = require('./getFullStateName');


const buildSchema = function (globalValues, uploadedImages, index, page, coordinates, reviews){

    
  function getOpeningHours(globalValues) {
    if (globalValues.is24Hours === 'on') {
      return ["Mo-Su 00:00-23:59"];
    }

    const daysMap = {
      monday: 'Mo',
      tuesday: 'Tu',
      wednesday: 'We',
      thursday: 'Th',
      friday: 'Fr',
      saturday: 'Sa',
      sunday: 'Su'
    };

    const openingHours = [];

    for (const day in daysMap) {
      const open = globalValues.hours?.[day]?.open;
      const close = globalValues.hours?.[day]?.close;

      if (open && close) {
        openingHours.push(`${daysMap[day]} ${open}-${close}`);
      }
    }

    return openingHours;
  }

  
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
        openingHours: getOpeningHours(globalValues),

        review: reviews
      });

      return jsonLdString;
    
}

module.exports = { buildSchema };