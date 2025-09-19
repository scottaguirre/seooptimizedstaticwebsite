const { formatCityForSchema } = require('./formatCityForSchema');
const { normalizeDomain } = require('./normalizeDomain');
const { getFullStateName } = require('./getFullStateName');


const buildSchema = function (globalValues, uploadedImages, index, coordinates, reviews){

  // To build sameAs to add in schema
  function buildSameAs(vals = {}) {
    const pick = v => {
      if (!v) return null;
      const s = String(v).trim();
      if (!s || s === '#' || s.toLowerCase() === 'n/a') return null;
      // ensure absolute URL (schema.org prefers full URLs)
      const url = /^https?:\/\//i.test(s) ? s : `https://${s}`;
      // minimal sanity check: must contain a dot or be clearly a social host
      return /\./.test(url) ? url : null;
    };

    const arr = [
      vals.facebookUrl,
      vals.instagramUrl,
      vals.twitterUrl,
      vals.linkedinUrl,
      vals.youtubeUrl,
      vals.pinterestUrl,
    ]
      .map(pick)
      .filter(Boolean);

    // de-duplicate while preserving order
    return [...new Set(arr)];
  }
    
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
        review: reviews,
        "hasMap": "https://www.google.com/maps?cid=",

        "sameAs": buildSameAs(globalValues)

      });

      return jsonLdString;
    
}

module.exports = { buildSchema };

