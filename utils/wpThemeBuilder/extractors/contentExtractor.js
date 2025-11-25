// utils/wpThemeBuilder/extractors/contentExtractor.js

const { stripTagsToText, extractAllTagContents } = require('../wpHelpers/htmlHelpers');



/**
 * Rewrite asset URLs and internal links in HTML for WordPress
 */
function rewriteAssetsForWordPress(html) {
  if (!html || typeof html !== 'string') return html;

  let processed = html;

  // Rewrite image sources
  processed = processed.replace(
    /src=(["'])(\.?\/?assets\/([^"']+))(["'])/gi,
    (match, quote1, fullPath, filename, quote2) => {
      return `src=${quote1}<?php echo esc_url( get_template_directory_uri() ); ?>/assets/${filename}${quote2}`;
    }
  );

  // Rewrite href to assets
  processed = processed.replace(
    /href=(["'])(\.?\/?assets\/([^"']+))(["'])/gi,
    (match, quote1, fullPath, filename, quote2) => {
      return `href=${quote1}<?php echo esc_url( get_template_directory_uri() ); ?>/assets/${filename}${quote2}`;
    }
  );

  // Rewrite background images
  processed = processed.replace(
    /(background(?:-image)?\s*:\s*url\(\s*)(["']?)(\.?\/?assets\/([^"')]+))(["']?)(\s*\))/gi,
    (match, prefix, quote1, fullPath, filename, quote2, suffix) => {
      return `${prefix}${quote1}<?php echo esc_url( get_template_directory_uri() ); ?>/assets/${filename}${quote2}${suffix}`;
    }
  );

  // Rewrite srcset
  processed = processed.replace(
    /srcset=(["'])([^"']+)(["'])/gi,
    (match, quote1, srcsetContent, quote2) => {
      const processedSrcset = srcsetContent.replace(
        /(^|,\s*)(\.?\/?assets\/([^\s,]+))/g,
        (m, prefix, fullPath, filename) => {
          return `${prefix}<?php echo esc_url( get_template_directory_uri() ); ?>/assets/${filename}`;
        }
      );
      return `srcset=${quote1}${processedSrcset}${quote2}`;
    }
  );

  // CRITICAL: Convert internal .html links to WordPress permalinks
  // Convert index.html to home URL
  processed = processed.replace(
    /href=(["'])\.?\/?index\.html?(["'])/gi,
    'href=$1<?php echo esc_url( home_url( \'/\' ) ); ?>$2'
  );

  // Convert other .html links to WordPress permalinks
  // Example: href="water-heater-repair-leander-tx.html" → href="<?php echo esc_url( home_url( '/water-heater-repair-leander-tx/' ) ); ?>"
  processed = processed.replace(
    /href=(["'])\.?\/?([a-z0-9-]+)\.html?(["'])/gi,
    (match, quote1, slug, quote2) => {
      // Skip if it's index.html (already handled above)
      if (slug === 'index') {
        return match;
      }
      
      // Convert to WordPress permalink
      return `href=${quote1}<?php echo esc_url( home_url( '/${slug}/' ) ); ?>${quote2}`;
    }
  );

  return processed;
}


/**
 * Find matching closing tag for an opening tag
 */
function findMatchingClosingTag(html, startPos, tagName) {
  let depth = 1;
  let pos = startPos;
  const openRegex = new RegExp(`<${tagName}[^>]*>`, 'gi');
  const closeRegex = new RegExp(`<\/${tagName}>`, 'gi');
  
  while (depth > 0 && pos < html.length) {
    openRegex.lastIndex = pos;
    closeRegex.lastIndex = pos;
    
    const nextOpen = openRegex.exec(html);
    const nextClose = closeRegex.exec(html);
    
    if (!nextClose) {
      return -1;
    }
    
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      pos = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      if (depth === 0) {
        return nextClose.index + nextClose[0].length;
      }
      pos = nextClose.index + nextClose[0].length;
    }
  }
  
  return -1;
}


/**
 * Extract complete head metadata including schema
 */
function extractHeadMetadata(html) {
  const metadata = {
    title: '',
    description: '',
    author: '',
    favicon: '',
    schemaJson: '',
  };
  
  // Extract title
  const titleMatch = html.match(/<title>(.*?)<\/title>/i);
  if (titleMatch) {
    metadata.title = titleMatch[1].trim();
  }
  
  // Extract meta description
  const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i);
  if (descMatch) {
    metadata.description = descMatch[1].trim();
  }
  
  // Extract meta author
  const authorMatch = html.match(/<meta\s+name=["']author["']\s+content=["']([^"']*)["']/i);
  if (authorMatch) {
    metadata.author = authorMatch[1].trim();
  }
  
  // Extract favicon
  const faviconMatch = html.match(/<link\s+rel=["']icon["'][^>]*href=["']([^"']*)["']/i);
  if (faviconMatch) {
    let faviconPath = faviconMatch[1];
    // Convert relative path to WordPress path
    if (faviconPath.startsWith('assets/')) {
      faviconPath = faviconPath.replace('assets/', '');
    } else if (faviconPath.startsWith('./assets/')) {
      faviconPath = faviconPath.replace('./assets/', '');
    }
    metadata.favicon = faviconPath;
  }
  
  // Extract JSON-LD schema
  const schemaMatch = html.match(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (schemaMatch) {
    try {
      // Clean up the JSON
      const jsonStr = schemaMatch[1].trim();
      // Validate it's proper JSON
      JSON.parse(jsonStr);
      metadata.schemaJson = jsonStr;
    } catch (e) {
      console.warn('Failed to parse schema JSON:', e);
    }
  }
  
  return metadata;
}


/**
 * Extract intelligent page name from HTML
 * Removes location suffixes, generic words, etc.
 * 
 * @param {string} html - HTML content
 * @param {string} filename - Original filename (e.g., "index.html", "water-heater-repair-leander-tx.html")
 * @returns {string} - Clean page name
 */
function extractPageName(html, filename = '') {
  // CRITICAL: Check filename FIRST before processing title
  // Special case: index.html = "About Us"
  if (filename) {
    const baseFilename = filename.replace(/\.html?$/i, '').toLowerCase();
    
    if (baseFilename === 'index' || baseFilename === 'home' || baseFilename === 'about') {
      return 'About Us';
    }
    
    // SPECIAL CASE: Location pages should use <h2 class="lead"> instead of <h1>
    if (baseFilename.startsWith('location-')) {
      // Try to extract city name from <h2 class="lead">
      const leadMatch = html.match(/<h2[^>]*class=["'][^"']*lead[^"']*["'][^>]*>(.*?)<\/h2>/i);
      if (leadMatch) {
        let cityName = leadMatch[1].trim();
        
        // Remove state abbreviations
        cityName = cityName.replace(/,\s*[A-Z]{2}\s*$/i, '').trim();
        
        // If we got a clean city name, return it
        if (cityName && cityName.length > 0) {
          return cityName;
        }
      }
      
      // Fallback: Try to extract from filename
      // "location-austin-tx" → "Austin"
      const citySlug = baseFilename.replace(/^location-/, '').replace(/-[a-z]{2}$/i, '');
      if (citySlug) {
        return citySlug
          .split('-')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ');
      }
    }
  }
  
  let pageName = '';
  
  // Try to extract from <title> tag
  const titleMatch = html.match(/<title>(.*?)<\/title>/i);
  if (titleMatch) {
    pageName = titleMatch[1].trim();
    
    // Remove common separators and everything after them
    pageName = pageName.split('|')[0].trim();
    pageName = pageName.split('-')[0].trim();
    pageName = pageName.split('–')[0].trim();
    pageName = pageName.split('—')[0].trim();
    
    // Remove " in [City], [State]" patterns
    pageName = pageName.replace(/\s+in\s+[^,]+,\s*[A-Z]{2}$/i, '');
    
    // Remove "[City], [State]" patterns
    pageName = pageName.replace(/[^,]+,\s*[A-Z]{2}$/i, '');
    
    // Remove generic suffixes
    const suffixesToRemove = [
      'location',
      'near me'
    ];
    
    suffixesToRemove.forEach(suffix => {
      const regex = new RegExp(`\\s+${suffix}\\s*$`, 'gi');
      pageName = pageName.replace(regex, '');
    });
    
    pageName = pageName.trim();
  }
  
  // If still empty, derive from filename
  if (!pageName && filename) {
    // Remove .html extension
    pageName = filename.replace(/\.html?$/i, '');
    
    // Remove city and state patterns from filename
    // Examples: "water-heater-repair-leander-tx" → "water-heater-repair"
    pageName = pageName.replace(/-[a-z]+-[a-z]{2}$/i, '');
    
    // Convert hyphens to spaces and title case
    pageName = pageName
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }
  
  // Final cleanup
  pageName = pageName.trim();
  
  // If still empty, return default
  if (!pageName) {
    pageName = 'Untitled Page';
  }
  
  return pageName;
}



/**
 * Extract header content
 */
function extractHeaderContent(html) {
  const headerRegex = /<header[^>]*>/i;
  const match = headerRegex.exec(html);
  
  if (!match) return null;
  
  const startPos = match.index;
  const afterOpenTag = match.index + match[0].length;
  const endPos = findMatchingClosingTag(html, afterOpenTag, 'header');
  
  if (endPos === -1) return null;
  
  const headerHtml = html.substring(startPos, endPos);
  const processedHeaderHtml = rewriteAssetsForWordPress(headerHtml);
  
  return {
    rawHtml: processedHeaderHtml,
  };
}



/**
 * Extract footer content
 */
function extractFooterContent(html) {
  const footerRegex = /<footer[^>]*>/i;
  const match = footerRegex.exec(html);
  
  if (!match) return null;
  
  const startPos = match.index;
  const afterOpenTag = match.index + match[0].length;
  const endPos = findMatchingClosingTag(html, afterOpenTag, 'footer');
  
  if (endPos === -1) return null;
  
  const footerHtml = html.substring(startPos, endPos);
  const processedFooterHtml = rewriteAssetsForWordPress(footerHtml);
  
  return {
    rawHtml: processedFooterHtml,
  };
}



/**
 * Extract global info
 */
function extractGlobalInfo(html) {
  const global = {};
  
  const phoneRegex = /tel:([+\d\s()-]+)/gi;
  const phoneMatches = [...html.matchAll(phoneRegex)];
  if (phoneMatches.length > 0) {
    global.phone = phoneMatches[0][1].trim();
  }
  
  const emailRegex = /mailto:([^\s"'<>]+@[^\s"'<>]+)/i;
  const emailMatch = html.match(emailRegex);
  if (emailMatch) {
    global.email = emailMatch[1];
  }
  
  const socialPlatforms = {
    facebook: /facebook\.com\/([^"'\s?]+)/i,
    twitter: /twitter\.com\/([^"'\s?]+)/i,
    instagram: /instagram\.com\/([^"'\s?]+)/i,
    linkedin: /linkedin\.com\/(company|in)\/([^"'\s?]+)/i,
    youtube: /youtube\.com\/(channel|c|user)\/([^"'\s?]+)/i,
  };
  
  Object.entries(socialPlatforms).forEach(([platform, regex]) => {
    const match = html.match(regex);
    if (match) {
      global[`${platform}_url`] = match[0];
    }
  });
  
  const addressMatch = html.match(/"streetAddress"\s*:\s*"([^"]+)"/);
  if (addressMatch) {
    global.address = addressMatch[1];
  }
  
  const cityMatch = html.match(/"addressLocality"\s*:\s*"([^"]+)"/);
  if (cityMatch) {
    global.location = cityMatch[1];
  }
  
  return global;
}



/**
 * Extract page content from HTML
 */
function extractPageContent(html, filename) {
  return {
    headMetadata: extractHeadMetadata(html),
    pageName: extractPageName(html, filename), 
    header: extractHeaderContent(html),
    contentBlocks: extractAllContentBlocks(html),
    footer: extractFooterContent(html),
    global: extractGlobalInfo(html),
  };
}

/**
 * Extract ALL content blocks between header and footer in order
 * CRITICAL: Only extract top-level blocks, not nested children
 */
function extractAllContentBlocks(html) {
  const blocks = [];
  
  // Find where header ends
  const headerRegex = /<header[^>]*>/i;
  const headerMatch = headerRegex.exec(html);
  
  if (!headerMatch) {
    return blocks;
  }
  
  const headerEnd = findMatchingClosingTag(html, headerMatch.index + headerMatch[0].length, 'header');
  
  if (headerEnd === -1) {
    return blocks;
  }
  
  // Find where footer starts
  const footerRegex = /<footer[^>]*>/i;
  const footerMatch = footerRegex.exec(html);
  
  if (!footerMatch) {
    return blocks;
  }
  
  const footerStart = footerMatch.index;
  
  // Get the content between header and footer
  const bodyContent = html.substring(headerEnd, footerStart);
  
  // Find ALL potential blocks (sections and divs with specific classes)
  const allPotentialBlocks = [];
  
  // 1. Find all <section> tags (these are always top-level)
  const sectionRegex = /<section[^>]*>/gi;
  let sectionMatch;
  while ((sectionMatch = sectionRegex.exec(bodyContent)) !== null) {
    const startPos = sectionMatch.index;
    const afterOpenTag = sectionMatch.index + sectionMatch[0].length;
    const endPos = findMatchingClosingTag(bodyContent, afterOpenTag, 'section');
    
    if (endPos !== -1) {
      allPotentialBlocks.push({
        type: 'section',
        startPos,
        endPos,
        html: bodyContent.substring(startPos, endPos),
      });
    }
  }
  
  // 2. Find all <div> tags with "hero" or "btn" in class
  // But we need to filter out nested ones later
  const divRegex = /<div\s+([^>]*)>/gi;
  let divMatch;
  while ((divMatch = divRegex.exec(bodyContent)) !== null) {
    const attributes = divMatch[1];
    const classMatch = attributes.match(/class=["']([^"']*)["']/i);
    
    if (classMatch) {
      const classes = classMatch[1].toLowerCase();
      
      // Check if this div contains "hero" or "btn" keywords
      if (classes.includes('hero') || classes.includes('btn')) {
        const startPos = divMatch.index;
        const afterOpenTag = divMatch.index + divMatch[0].length;
        const endPos = findMatchingClosingTag(bodyContent, afterOpenTag, 'div');
        
        if (endPos !== -1) {
          const type = classes.includes('hero') ? 'hero' : 'button';
          allPotentialBlocks.push({
            type,
            startPos,
            endPos,
            html: bodyContent.substring(startPos, endPos),
          });
        }
      }
    }
  }
  
  // 3. CRITICAL: Filter out nested blocks
  // A block is nested if its start/end positions are completely inside another block
  const topLevelBlocks = [];
  
  allPotentialBlocks.forEach(block => {
    let isNested = false;
    
    // Check if this block is inside any other block
    for (const otherBlock of allPotentialBlocks) {
      if (block === otherBlock) continue;
      
      // If block starts after otherBlock starts AND ends before otherBlock ends
      // Then block is nested inside otherBlock
      if (block.startPos > otherBlock.startPos && block.endPos < otherBlock.endPos) {
        isNested = true;
        break;
      }
    }
    
    if (!isNested) {
      topLevelBlocks.push(block);
    }
  });
  
  // 4. Sort blocks by position
  topLevelBlocks.sort((a, b) => a.startPos - b.startPos);
  
  // 5. Process each block and extract editable content
  topLevelBlocks.forEach((block, index) => {
    const processedHtml = rewriteAssetsForWordPress(block.html);
    const editableFields = extractEditableFields(block.html, block.type);
    
    blocks.push({
      type: block.type,
      index,
      rawHtml: processedHtml,
      editableFields,
    });
  });
  
  return blocks;
}

/**
 * Extract editable text fields from a block
 */
function extractEditableFields(html, blockType) {
  const fields = {};
  
  // Extract h1 tags
  const h1Tags = extractAllTagContents(html, 'h1');
  h1Tags.forEach((text, i) => {
    fields[`h1_${i}`] = text;
  });
  
  // Extract h2 tags
  const h2Tags = extractAllTagContents(html, 'h2');
  h2Tags.forEach((text, i) => {
    fields[`h2_${i}`] = text;
  });
  
  // Extract h3 tags
  const h3Tags = extractAllTagContents(html, 'h3');
  h3Tags.forEach((text, i) => {
    fields[`h3_${i}`] = text;
  });
  
  // Extract h4 tags
  const h4Tags = extractAllTagContents(html, 'h4');
  h4Tags.forEach((text, i) => {
    fields[`h4_${i}`] = text;
  });
  
  // Extract p tags
  const pTags = extractAllTagContents(html, 'p');
  pTags.forEach((text, i) => {
    fields[`p_${i}`] = text;
  });
  
  // Extract link text from buttons
  if (blockType === 'button') {
    const aRegex = /<a[^>]*>([\s\S]*?)<\/a>/gi;
    const aMatches = [...html.matchAll(aRegex)];
    aMatches.forEach((match, i) => {
      const linkText = stripTagsToText(match[1]);
      if (linkText) {
        fields[`link_text_${i}`] = linkText;
      }
    });
  }
  
  return fields;
}




/**
 * Flatten extracted content for WordPress post meta
 */
function flattenContentForMeta(extracted) {
  const flat = {};

  // Store page name
  if (extracted.pageName) {
    flat.page_name = extracted.pageName;
  }

   // Store head metadata
   if (extracted.headMetadata) {
    if (extracted.headMetadata.title) flat.page_title = extracted.headMetadata.title;
    if (extracted.headMetadata.description) flat.page_description = extracted.headMetadata.description;
    if (extracted.headMetadata.author) flat.page_author = extracted.headMetadata.author;
    if (extracted.headMetadata.favicon) flat.page_favicon = extracted.headMetadata.favicon;
    if (extracted.headMetadata.schemaJson) flat.page_schema_json = extracted.headMetadata.schemaJson;
  }
  
  // Store header HTML
  if (extracted.header && extracted.header.rawHtml) {
    flat.header_html = extracted.header.rawHtml;
  }
  
  // Store content blocks
  if (extracted.contentBlocks && Array.isArray(extracted.contentBlocks)) {
    extracted.contentBlocks.forEach((block, i) => {
      const prefix = `block_${i}`;
      
      // Store block type and HTML
      flat[`${prefix}_type`] = block.type;
      flat[`${prefix}_html`] = block.rawHtml;
      
      // Store editable text fields
      Object.entries(block.editableFields).forEach(([fieldKey, fieldValue]) => {
        flat[`${prefix}_${fieldKey}`] = fieldValue;
      });
    });
  }
  
  // Store footer HTML
  if (extracted.footer && extracted.footer.rawHtml) {
    flat.footer_html = extracted.footer.rawHtml;
  }
  
  return flat;
}

/**
 * Get summary
 */
function getExtractionSummary(extracted) {
  const summary = {
    hasHeader: !!extracted.header,
    hasFooter: !!extracted.footer,
    blockCount: extracted.contentBlocks ? extracted.contentBlocks.length : 0,
    blockTypes: {},
    socialPlatforms: [],
  };
  
  if (extracted.contentBlocks) {
    extracted.contentBlocks.forEach(block => {
      summary.blockTypes[block.type] = (summary.blockTypes[block.type] || 0) + 1;
    });
  }
  
  if (extracted.global) {
    Object.keys(extracted.global).forEach(key => {
      if (key.endsWith('_url')) {
        summary.socialPlatforms.push(key.replace('_url', ''));
      }
    });
  }
  
  return summary;
}

module.exports = {
  extractPageContent,
  flattenContentForMeta,
  extractPageName,
  extractHeadMetadata,
  getExtractionSummary,
  extractHeaderContent,
  extractFooterContent,
  extractAllContentBlocks,
  extractGlobalInfo,
  rewriteAssetsForWordPress,
};