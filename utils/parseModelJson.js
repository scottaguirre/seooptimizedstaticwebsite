// utils/parseModelJson.js
//
// Parsing JSON that a language model wrote.
//
// The model is asked for JSON and usually obliges, but not always. The
// failures seen in practice:
//
//   - an unescaped double quote inside a value:
//       "answer": "we are the "go-to" plumber"
//     which ends the string early and makes the parser expect a colon
//     where it finds a word. This is the error that killed a build.
//
//   - literal newlines inside a string, which JSON does not allow
//   - trailing commas before } or ]
//   - smart quotes where straight ones belong
//   - the JSON wrapped in prose or a ```json fence
//
// Rather than each generator inventing its own cleanup, this does the same
// repairs everywhere and reports whether it had to.

/** Strip code fences and any prose either side of the JSON. */
function extractJsonBlock(raw, expect = 'object') {
    let text = String(raw || '').trim();
  
    text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  
    const open = expect === 'array' ? '[' : '{';
    const close = expect === 'array' ? ']' : '}';
  
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
  
    if (start === -1 || end === -1 || end < start) return text;
  
    return text.slice(start, end + 1);
  }
  
  /**
   * Escape stray double quotes that appear INSIDE a JSON string value.
   *
   * Walks the text tracking whether we are inside a string. A quote found
   * inside one is only a terminator if the next meaningful character is a
   * delimiter — otherwise the model meant it literally and it needs escaping.
   *
   * This is the repair that matters: it is the difference between a usable
   * page and a failed generation.
   */
  function escapeStrayQuotes(text) {
    let out = '';
    let inString = false;
    let escaped = false;
  
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
  
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
  
      if (ch === '\\') {
        out += ch;
        escaped = true;
        continue;
      }
  
      if (ch === '"') {
        if (!inString) {
          inString = true;
          out += ch;
          continue;
        }
  
        // Inside a string: is this the real end, or a quote the model meant
        // literally? Look ahead past whitespace for a structural character.
        let j = i + 1;
        while (j < text.length && /\s/.test(text[j])) j++;
        const next = text[j];
  
        if (next === undefined || next === ':' || next === ',' || next === '}' || next === ']') {
          inString = false;
          out += ch;
        } else {
          out += '\\"';          // literal quote inside the value
        }
        continue;
      }
  
      // Raw newlines and tabs are illegal inside a JSON string
      if (inString && (ch === '\n' || ch === '\r' || ch === '\t')) {
        out += ch === '\t' ? '\\t' : '\\n';
        continue;
      }
  
      out += ch;
    }
  
    return out;
  }
  
  function repairJson(text) {
    return escapeStrayQuotes(
      text
        // Smart quotes the model sometimes uses as delimiters
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2018\u2019]/g, "'")
        // Trailing commas before a closing brace or bracket
        .replace(/,(\s*[}\]])/g, '$1')
    );
  }
  
  /**
   * @param {string} raw               the model's text
   * @param {object} [opts]
   * @param {'object'|'array'} [opts.expect]
   * @param {string} [opts.label]      for the log line
   * @returns {{ok: boolean, data: any, repaired: boolean, error?: Error}}
   *
   * Never throws. The caller decides what a failure means — for an optional
   * section that is an empty result, for a whole page it may mean skipping it.
   */
  function parseModelJson(raw, { expect = 'object', label = 'model output' } = {}) {
    const block = extractJsonBlock(raw, expect);
  
    // Straightforward case first: most responses parse as-is.
    try {
      return { ok: true, data: JSON.parse(block), repaired: false };
    } catch (firstError) {
      try {
        const data = JSON.parse(repairJson(block));
        console.warn(`   ⚠️ Repaired malformed JSON from ${label}`);
        return { ok: true, data, repaired: true };
      } catch (secondError) {
        return { ok: false, data: null, repaired: false, error: secondError };
      }
    }
  }
  
  module.exports = { parseModelJson, repairJson, extractJsonBlock };