// utils/wpThemeBuilder/wpHelpers/htmlHelpers.js

/**
 * Strip HTML tags and normalize whitespace
 */
function stripTagsToText(html) {
    if (!html) return '';
    return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
  
/**
 * Extract all instances of a tag and return array of text content
 */
function extractAllTagContents(html, tag) {
if (!html) return [];
const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
const matches = [...html.matchAll(regex)];
return matches.map(m => stripTagsToText(m[1])).filter(Boolean);
}
  
/**
 * Extract first instance of a tag
 */
function extractFirstTagContent(html, tag) {
const all = extractAllTagContents(html, tag);
return all.length > 0 ? all[0] : '';
}

/**
 * Extract attribute value from first matching tag
 */
function extractAttribute(html, tag, attr) {
if (!html) return '';
const regex = new RegExp(`<${tag}[^>]+${attr}=["']([^"']+)["']`, 'i');
const match = html.match(regex);
return match ? match[1] : '';
}
  
/**
 * Extract all sections from HTML dynamically
 * Returns array of { id, class, content, index }
 */
function extractAllSections(html) {
    if (!html) return [];

    const sections = [];
    const regex = /<section([^>]*)>([\s\S]*?)<\/section>/gi;
    let match;
    let index = 0;

    while ((match = regex.exec(html)) !== null) {
        const attributes = match[1];
        const content = match[2];

        // Extract id if present
        const idMatch = attributes.match(/id=["']([^"']+)["']/i);
        const id = idMatch ? idMatch[1] : null;

        // Extract class if present
        const classMatch = attributes.match(/class=["']([^"']+)["']/i);
        const className = classMatch ? classMatch[1] : null;

        sections.push({
            index,
            id,
            className,
            content,
        });

        index++;
    }

    return sections;
}
  
/**
 * Extract all content from a section
 * Returns { headings: { h1: [], h2: [], ... }, paragraphs: [], lists: [] }
 */
function extractSectionContent(sectionHtml) {
    const content = {
        headings: {},
        paragraphs: [],
        listItems: [],
    };

    if (!sectionHtml) return content;

    // Extract all heading levels
    ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach(tag => {
        const headings = extractAllTagContents(sectionHtml, tag);
        if (headings.length > 0) {
        content.headings[tag] = headings;
        }
    });

    // Extract paragraphs
    content.paragraphs = extractAllTagContents(sectionHtml, 'p');

    // Extract list items
    content.listItems = extractAllTagContents(sectionHtml, 'li');

    return content;
}

// utils/wpThemeBuilder/wpHelpers/htmlHelpers.js

// ADD this new function after extractSectionContent:

/**
 * Extract section content AS HTML (preserving images, not just text)
 * Use this for WordPress where we need the actual HTML structure
 */
function extractSectionHtml(sectionHtml) {
    const content = {
      headings: {},
      paragraphs: [],
      images: [],
      fullHtml: sectionHtml, // Keep the full HTML
    };
  
    if (!sectionHtml) return content;
  
    // Extract headings (text only)
    ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach(tag => {
      const headings = extractAllTagContents(sectionHtml, tag);
      if (headings.length > 0) {
        content.headings[tag] = headings;
      }
    });
  
    // Extract paragraphs WITH inner HTML (keeps images inside <p>)
    const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    const pMatches = [...sectionHtml.matchAll(pRegex)];
    content.paragraphs = pMatches.map(m => m[1]); // Keep inner HTML, not stripped
  
    // Extract image sources for reference
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    const imgMatches = [...sectionHtml.matchAll(imgRegex)];
    content.images = imgMatches.map(m => m[1]);
  
    return content;
  }
  
 
  
  /**
   * Remove inline CSS and JS references
   */
  function cleanInlineAssets(html) {
    if (!html) return html;
    
    html = html.replace(/<link[^>]+href=["']\.?\/?css\/[^"']+["'][^>]*>\s*/gi, '');
    html = html.replace(/<script[^>]+src=["']\.?\/?js\/[^"']+["'][^>]*>\s*<\/script>\s*/gi, '');
    
    return html;
  }
  
  /**
   * Split HTML into header, body content, and footer
   */
  function splitHtmlLayout(html) {
    let footerHtml = '';
    let headerAndBody = html;
  
    const footerMatch = html.match(/<footer[\s\S]*$/i);
    if (footerMatch) {
      footerHtml = footerMatch[0];
      headerAndBody = html.slice(0, footerMatch.index);
    }
  
    let headerHtml = '';
    let bodyContent = headerAndBody;
  
    const headerMatch = headerAndBody.match(/<\/header>\s*/i);
    if (headerMatch) {
      const headerEndIdx = headerMatch.index + headerMatch[0].length;
      headerHtml = headerAndBody.slice(0, headerEndIdx);
      bodyContent = headerAndBody.slice(headerEndIdx);
    } else {
      const bodyTagMatch = headerAndBody.match(/<body[^>]*>/i);
      if (bodyTagMatch) {
        const bodyStartIdx = bodyTagMatch.index + bodyTagMatch[0].length;
        headerHtml = headerAndBody.slice(0, bodyStartIdx);
        bodyContent = headerAndBody.slice(bodyStartIdx);
      }
    }
  
    return { headerHtml, bodyContent, footerHtml };
  }
  
  /**
   * Extract using a pattern (string regex or RegExp)
   */
  function extractByPattern(html, pattern) {
    if (!html) return '';
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
    const match = html.match(regex);
    return match ? (match[1] || match[0]) : '';
  }
  
  /**
   * Try multiple patterns until one matches
   */
  function extractByPatterns(html, patterns) {
    for (const pattern of patterns) {
      const result = extractByPattern(html, pattern);
      if (result) return stripTagsToText(result);
    }
    return '';
  }
  
  module.exports = {
    stripTagsToText,
    extractAllTagContents,
    extractFirstTagContent,
    extractAttribute,
    extractAllSections,
    extractSectionHtml,  // ← ADD THIS
    extractSectionContent,
    cleanInlineAssets,
    splitHtmlLayout,
    extractByPattern,
    extractByPatterns,
  };