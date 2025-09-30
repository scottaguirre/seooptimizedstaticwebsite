// buildLocationPagesSchema.js
function absUrlMaybe(s) {
    if (!s) return null;
    const t = String(s).trim();
    if (!t || t === '#' || t.toLowerCase() === 'n/a') return null;
    return /^https?:\/\//i.test(t) ? t : `https://${t}`;
  }
  
  function sameAsFromGlobals(gv = {}) {
    const arr = [
      gv.facebookUrl, gv.instagramUrl, gv.twitterUrl,
      gv.linkedinUrl, gv.youtubeUrl,   gv.pinterestUrl
    ].map(absUrlMaybe).filter(Boolean);
    return [...new Set(arr)];
  }
  
  function buildLocationPagesSchema(globalValues, locationDisplay, pagePath, uploadedImages = {}, mainLocation) {
    // build a unique list of areas: main location + every extra location + current page
    const areas = [];
    const push = (s) => { const v = (s || '').trim(); if (v && !areas.includes(v)) areas.push(v); };
    push(mainLocation); // main site location (e.g., "Austin, TX")
    if (Array.isArray(globalValues.locationPages)) {
      globalValues.locationPages.forEach(lp => push(lp?.display));
    }
    push(locationDisplay); // ensure current page city is included too
      
    
    const domain = String(globalValues.domain || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const baseUrl = `https://${domain}`;
    const pageUrl = `${baseUrl}/${String(pagePath || '').replace(/^\/+/, '')}`;
    const localBusinessId = `${baseUrl}/#localbusiness`;
  
    const imgs = [
      uploadedImages?.heroLarge,
      uploadedImages?.heroDesktop,
      uploadedImages?.heroTablet,
      uploadedImages?.heroMobile
    ].filter(Boolean);
  
    if (!imgs.length && globalValues.logo) {
      imgs.push(`${baseUrl}/${String(globalValues.logo).replace(/^\/+/, '')}`);
    }
  
    const graph = [
      {
        "@type": "LocalBusiness",
        "@id": localBusinessId,
        name: globalValues.businessName,
        url: baseUrl,
        ...(globalValues.phone ? { telephone: globalValues.phone } : {}),
        ...(imgs.length ? { image: imgs } : {}),
        sameAs: sameAsFromGlobals(globalValues),
        ...(areas.length ? { areaServed: areas } : {}),
        ...(globalValues.googleMapCid ? { hasMap: `https://www.google.com/maps?cid=${encodeURIComponent(globalValues.googleMapCid)}` } : {})
        // no "address" on service-area pages
      },
      {
        "@type": "WebPage",
        "@id": `${pageUrl}#webpage`,
        url: pageUrl,
        name: `${globalValues.businessType} in ${locationDisplay}`,
        about: { "@id": localBusinessId },
        ...(locationDisplay ? { spatialCoverage: String(locationDisplay) } : {})
      }
    ];
  
    return JSON.stringify({ "@context": "https://schema.org", "@graph": graph });
  }
  
  module.exports = { buildLocationPagesSchema };
  