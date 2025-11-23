// utils/wpThemeBuilder/wpHelpers/phpHelpers.js

/**
 * Convert a slug into a valid PHP function/variable identifier
 * Example: "my-cool-theme" → "my_cool_theme"
 * Example: "123theme" → "_123theme" (can't start with number)
 */
function makePhpIdentifier(slug) {
    return String(slug || 'lb_theme')
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/^[0-9]/, '_$&');
  }
  
  /**
   * Escape a string for use inside single-quoted PHP strings
   * Example: "It's working" → "It\\'s working"
   */
  function phpEscapeSingle(str) {
    return String(str || '')
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'");
  }
  
  /**
   * Convert a flat JavaScript object to PHP associative array syntax
   * Example: { name: "John", age: "30" } →
   *   [
   *     'name' => 'John',
   *     'age' => '30'
   *   ]
   */
  function objectToPhpArray(obj, indent = 0) {
    const pad = '  '.repeat(indent);
    const innerPad = '  '.repeat(indent + 1);
  
    const entries = Object.entries(obj)
      .map(([key, value]) => {
        const escapedKey = phpEscapeSingle(key);
        const escapedVal = phpEscapeSingle(value);
        return `${innerPad}'${escapedKey}' => '${escapedVal}'`;
      })
      .join(",\n");
  
    return `[\n${entries}\n${pad}]`;
  }
  
  /**
   * Convert a nested JavaScript object to PHP array syntax (recursive)
   * Handles objects within objects
   */
  function nestedObjectToPhpArray(obj, indent = 0) {
    const pad = '  '.repeat(indent);
    const innerPad = '  '.repeat(indent + 1);
  
    const entries = Object.entries(obj)
      .map(([key, value]) => {
        const escapedKey = phpEscapeSingle(key);
  
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          // Nested object - recurse
          const nestedArray = nestedObjectToPhpArray(value, indent + 1);
          return `${innerPad}'${escapedKey}' => ${nestedArray}`;
        } else if (Array.isArray(value)) {
          // Array of strings
          const arrayItems = value
            .map(v => `'${phpEscapeSingle(v)}'`)
            .join(', ');
          return `${innerPad}'${escapedKey}' => [${arrayItems}]`;
        } else {
          // Simple string value
          const escapedVal = phpEscapeSingle(value);
          return `${innerPad}'${escapedKey}' => '${escapedVal}'`;
        }
      })
      .join(",\n");
  
    return `[\n${entries}\n${pad}]`;
  }
  
  module.exports = {
    makePhpIdentifier,
    phpEscapeSingle,
    objectToPhpArray,
    nestedObjectToPhpArray,
  };