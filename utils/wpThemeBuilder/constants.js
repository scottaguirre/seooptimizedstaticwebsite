// utils/wpThemeBuilder/constants.js

/**
 * Patterns for identifying sections in HTML
 * These help us find sections regardless of how many exist
 */
const SECTION_PATTERNS = {
    // Match sections by ID like: id="section1", id="section-2", id="about-section"
    byId: /<section[^>]*id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/section>/gi,
    
    // Match sections by class
    byClass: /<section[^>]*class=["']([^"']+)["'][^>]*>([\s\S]*?)<\/section>/gi,
    
    // Match any section tag
    any: /<section[^>]*>([\s\S]*?)<\/section>/gi,
  };
  
  /**
   * Content types we extract from each section
   */
  const EXTRACTABLE_CONTENT = {
    headings: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    text: ['p', 'li', 'span.lead', 'div.tagline'],
    links: ['a'],
  };
  
  /**
   * Global/site-wide content patterns
   */
  const GLOBAL_PATTERNS = {
    phone: [
      /href=["']tel:([^"']+)["']/i,
      /<a[^>]*class=["'][^"']*phone[^"']*["'][^>]*>([^<]+)<\/a>/i,
      /(\(\d{3}\)\s*\d{3}[-.]?\d{4})/,
      /(\d{3}[-.]?\d{3}[-.]?\d{4})/,
    ],
    email: [
      /href=["']mailto:([^"']+)["']/i,
      /<a[^>]*class=["'][^"']*email[^"']*["'][^>]*>([^<]+)<\/a>/i,
    ],
    address: [
      /<address[^>]*>([\s\S]*?)<\/address>/i,
      /<[^>]*class=["'][^"']*address[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
    ],
    social: {
      facebook: /href=["']([^"']*facebook\.com[^"']*)["']/i,
      twitter: /href=["']([^"']*twitter\.com[^"']*)["']/i,
      instagram: /href=["']([^"']*instagram\.com[^"']*)["']/i,
      linkedin: /href=["']([^"']*linkedin\.com[^"']*)["']/i,
      youtube: /href=["']([^"']*youtube\.com[^"']*)["']/i,
      pinterest: /href=["']([^"']*pinterest\.com[^"']*)["']/i,
    },
  };
  
  /**
   * Meta tag patterns
   */
  const META_PATTERNS = {
    title: /<title[^>]*>([\s\S]*?)<\/title>/i,
    description: /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    ogTitle: /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    ogDescription: /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
  };
  
  module.exports = {
    SECTION_PATTERNS,
    EXTRACTABLE_CONTENT,
    GLOBAL_PATTERNS,
    META_PATTERNS,
  };