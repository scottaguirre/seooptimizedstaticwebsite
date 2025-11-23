// utils/wpThemeBuilder/generators/styleCss.js

/**
 * Generate the style.css file with WordPress theme header
 * This file is required by WordPress to recognize the theme
 *
 * @param {object} options - Configuration options
 * @param {string} options.themeName - Theme display name
 * @param {string} options.themeSlug - Theme slug
 * @param {string} options.themeAuthor - Theme author name
 * @param {string} options.themeVersion - Theme version (default: 1.0.0)
 * @param {string} options.themeDescription - Theme description
 * @param {string} options.themeUri - Theme homepage URL
 * @param {string} options.authorUri - Author homepage URL
 * @returns {string} - Complete CSS content with WordPress header
 */
function generateStyleCss(options = {}) {
    const {
      themeName = 'Local Business Theme',
      themeSlug = 'local-business-theme',
      themeAuthor = 'Static Website Generator',
      themeVersion = '1.0.0',
      themeDescription = 'A custom WordPress theme generated from a static HTML website. Built with Bootstrap and optimized for local businesses.',
      themeUri = 'https://example.com/',
      authorUri = 'https://example.com/',
    } = options;
  
    return `/*
  Theme Name: ${themeName}
  Theme URI: ${themeUri}
  Author: ${themeAuthor}
  Author URI: ${authorUri}
  Description: ${themeDescription}
  Version: ${themeVersion}
  Requires at least: 5.0
  Tested up to: 6.4
  Requires PHP: 7.4
  License: GNU General Public License v2 or later
  License URI: https://www.gnu.org/licenses/gpl-2.0.html
  Text Domain: ${themeSlug}
  Tags: business, local, bootstrap, custom-colors, custom-logo, custom-menu, featured-images, threaded-comments, translation-ready
  
  This theme, like WordPress, is licensed under the GPL.
  Use it to make something cool, have fun, and share what you've learned.
  */
  
  /*--------------------------------------------------------------
  >>> TABLE OF CONTENTS:
  ----------------------------------------------------------------
  # Generic
    - Normalize
    - Box sizing
  # Base
    - Typography
    - Elements
    - Links
  # Layouts
  # Components
    - Navigation
    - Posts and pages
    - Comments
    - Widgets
    - Media
    - Footer
  # Utilities
    - Accessibility
    - Alignments
  --------------------------------------------------------------*/
  
  /*--------------------------------------------------------------
  # Generic
  --------------------------------------------------------------*/
  
  /* Normalize
  --------------------------------------------- */
  /* Handled by Bootstrap */
  
  /* Box sizing
  --------------------------------------------- */
  *,
  *::before,
  *::after {
      box-sizing: border-box;
  }
  
  /*--------------------------------------------------------------
  # Base
  --------------------------------------------------------------*/
  
  /* Typography
  --------------------------------------------- */
  body {
      color: #333;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
      font-size: 1rem;
      line-height: 1.6;
  }
  
  /* Elements
  --------------------------------------------- */
  html {
      scroll-behavior: smooth;
  }
  
  /* Links
  --------------------------------------------- */
  a {
      color: #0073aa;
      text-decoration: none;
  }
  
  a:hover,
  a:focus {
      color: #005177;
      text-decoration: underline;
  }
  
  a:focus {
      outline: thin dotted;
  }
  
  a:hover,
  a:active {
      outline: 0;
  }
  
  /*--------------------------------------------------------------
  # Layouts
  --------------------------------------------------------------*/
  .site {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
  }
  
  .site-main {
      flex: 1;
  }
  
  /*--------------------------------------------------------------
  # Components
  --------------------------------------------------------------*/
  
  /* Navigation
  --------------------------------------------- */
  .site-header {
      background: #fff;
      border-bottom: 1px solid #e0e0e0;
      position: sticky;
      top: 0;
      z-index: 1000;
  }
  
  .navbar-brand {
      display: flex;
      align-items: center;
  }
  
  .site-logo {
      max-height: 60px;
      width: auto;
  }
  
  /* Posts and pages
  --------------------------------------------- */
  .page-hero,
  .hero-section {
      padding: 60px 0;
      text-align: center;
  }
  
  .content-section {
      padding: 60px 0;
  }
  
  .section-title {
      margin-bottom: 1.5rem;
      font-weight: 700;
  }
  
  .section-subtitle {
      margin-bottom: 1rem;
      color: #666;
  }
  
  .section-content {
      margin-top: 1.5rem;
  }
  
  /* Footer
  --------------------------------------------- */
  .site-footer {
      background: #2c3e50;
      color: #ecf0f1;
      margin-top: auto;
  }
  
  .footer-main {
      padding: 40px 0;
  }
  
  .footer-title {
      font-size: 1.25rem;
      margin-bottom: 1rem;
      font-weight: 700;
  }
  
  .footer-contact p {
      margin-bottom: 0.5rem;
  }
  
  .footer-contact a {
      color: #ecf0f1;
  }
  
  .footer-contact a:hover {
      color: #3498db;
  }
  
  .contact-icon {
      margin-right: 8px;
  }
  
  .footer-social .social-links {
      display: flex;
      gap: 15px;
      flex-wrap: wrap;
  }
  
  .social-link {
      display: inline-block;
      padding: 8px 16px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      color: #ecf0f1;
      transition: background 0.3s ease;
  }
  
  .social-link:hover {
      background: rgba(255, 255, 255, 0.2);
      color: #fff;
      text-decoration: none;
  }
  
  .footer-bottom {
      background: rgba(0, 0, 0, 0.2);
      padding: 20px 0;
  }
  
  .footer-bottom p {
      margin: 0;
  }
  
  .footer-legal-nav a {
      color: #ecf0f1;
      margin: 0 10px;
  }
  
  .footer-legal-nav a:hover {
      color: #3498db;
  }
  
  .separator {
      color: #7f8c8d;
  }
  
  /* CTA Section
  --------------------------------------------- */
  .cta-section {
      padding: 60px 0;
      text-align: center;
  }
  
  .cta-section h2 {
      margin-bottom: 1rem;
  }
  
  .cta-section p {
      font-size: 1.125rem;
      margin-bottom: 1.5rem;
  }
  
  /*--------------------------------------------------------------
  # Utilities
  --------------------------------------------------------------*/
  
  /* Accessibility
  --------------------------------------------- */
  .screen-reader-text,
  .skip-link {
      position: absolute;
      left: -9999px;
      top: -9999px;
  }
  
  .skip-link:focus {
      position: fixed;
      top: 0;
      left: 0;
      z-index: 100000;
      padding: 15px 23px 14px;
      background: #f1f1f1;
      color: #21759b;
      font-size: 14px;
      font-weight: 700;
      text-decoration: none;
  }
  
  /* Alignments
  --------------------------------------------- */
  .alignleft {
      float: left;
      margin-right: 1.5em;
      margin-bottom: 1.5em;
  }
  
  .alignright {
      float: right;
      margin-left: 1.5em;
      margin-bottom: 1.5em;
  }
  
  .aligncenter {
      clear: both;
      display: block;
      margin-left: auto;
      margin-right: auto;
      margin-bottom: 1.5em;
  }
  `;
  }
  
  module.exports = {
    generateStyleCss
  };