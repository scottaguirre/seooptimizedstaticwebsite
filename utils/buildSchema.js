// utils/buildSchema.js
const { formatCityForSchema } = require('./formatCityForSchema');
const { normalizeDomain }     = require('./normalizeDomain');
const { getFullStateName }    = require('./getFullStateName');
const { truthy }              = require('./helpers');

const buildSchema = function (globalValues, uploadedImages, index, coordinates, reviews) {

  function buildSameAs(vals = {}) {
    const pick = v => {
      if (!v) return null;
      const s = String(v).trim();
      if (!s || s === '#' || s.toLowerCase() === 'n/a') return null;
      const url = /^https?:\/\//i.test(s) ? s : `https://${s}`;
      return /\./.test(url) ? url : null;     // <-- fixed
    };
    return [...new Set([
      vals.facebookUrl, vals.instagramUrl, vals.twitterUrl,
      vals.linkedinUrl, vals.youtubeUrl,  vals.pinterestUrl
    ].map(pick).filter(Boolean))];
  }

  function getOpeningHours(vals) {
    if (truthy(vals.is24Hours)) return ["Mo-Su 00:00-23:59"];
    const daysMap = { monday:'Mo', tuesday:'Tu', wednesday:'We', thursday:'Th', friday:'Fr', saturday:'Sa', sunday:'Su' };
    const out = [];
    for (const d in daysMap) {
      const open  = vals.hours?.[d]?.open;
      const close = vals.hours?.[d]?.close;
      if (open && close) out.push(`${daysMap[d]} ${open}-${close}`);
    }
    return out;
  }

  // areaServed: main location + any extra location pages (deduped)
  const areaServed = [];
  const push = s => { const v = (s || '').trim(); if (v && !areaServed.includes(v)) areaServed.push(v); };
  push(globalValues.location);
  if (globalValues.wantsLocationPages && Array.isArray(globalValues.locationPages)) {
    for (const lp of globalValues.locationPages) push(lp?.display);
  }

  // images (optional)
  const imgs = Object.values(uploadedImages?.[index] || {}).filter(Boolean);

  const schema = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: globalValues.businessName,
    url: `https://${normalizeDomain(globalValues.domain)}`,
    telephone: globalValues.phone,
    ...(imgs.length ? { image: imgs } : {}),
    address: {
      "@type": "PostalAddress",
      streetAddress: globalValues.address,
      addressLocality: formatCityForSchema(globalValues.location),
      addressRegion: getFullStateName(globalValues.location),
      postalCode: globalValues.address.match(/\b\d{5}\b/)?.[0] || "",
      addressCountry: "United States"
    },
    review: reviews,
    sameAs: buildSameAs(globalValues)
  };

  // geo (optional)
  const lat = Number(coordinates?.latitude);
  const lng = Number(coordinates?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    schema.geo = { "@type": "GeoCoordinates", latitude: lat, longitude: lng };
  }

  // openingHours (optional)
  const opening = getOpeningHours(globalValues);
  if (opening?.length) schema.openingHours = opening;

  // areaServed (optional)
  if (areaServed.length) schema.areaServed = areaServed;

  // hasMap via CID (optional)
  if (globalValues.googleMapCid) {
    schema.hasMap = `https://www.google.com/maps?cid=${encodeURIComponent(globalValues.googleMapCid)}`;
  }

  return JSON.stringify(schema);
};

module.exports = { buildSchema };
