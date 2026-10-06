// utils/blog/businessBlock.js
//
// The BUSINESS block both prompt builders put at the top.
//
// WHY IT IS A FUNCTION AND NOT A TEMPLATE IN EACH FILE
//
// writePost.js and suggestTopics.js each had their own copy of
//
//     BUSINESS
//       Name:     ${business.name}
//       Trade:    ${business.trade}
//       Town:     ${business.town}
//       Services: ${business.services.join(', ')}
//
// identical to the character, and both wrong in the same way for the same
// reason. Two copies of a bug are two fixes, and the second one gets
// forgotten. There is one copy now.
//
// AN EMPTY VALUE IS A CLAIM THAT THE VALUE EXISTS
//
// That sentence was already written, in a comment above writePost's own guard
// against this. The guard tested `name || trade || town` and therefore never
// fired, because `IE_Settings::business()` falls back to the WordPress site
// title and a name is always present. So on every site without a trade the
// model was shown:
//
//     Trade:
//     Town:
//
// two labels with nothing after them, which it reads as facts it is supposed
// to know and cannot see — and then invents. That is how a lending blog got a
// post about Central Texas heat.
//
// It was worse than blank in production. buildContext substituted the literal
// strings 'trade' and 'the business' for missing values, so the real prompt
// said `Trade:    trade`. An invented value is harder to spot than a missing
// one, because it looks like data. Those placeholders are gone; this file is
// what makes their removal safe.
//
// THE RULE: a field with nothing in it produces no line. A block with no
// lines produces nothing at all — which is what a pillar campaign, with no
// business behind it, has always needed.

/**
 * @param {object} business  { name, trade, town, services }
 * @returns {string}  '' when there is nothing worth saying
 */
function businessBlock(business = {}) {
  const rows = [
    ['Name', business.name],
    ['Trade', business.trade],
    ['Town', business.town],
    ['Services', Array.isArray(business.services) ? business.services.join(', ') : business.services],
  ].filter(([, v]) => String(v == null ? '' : v).trim());

  if (!rows.length) return '';

  const lines = rows.map(([label, v]) => `  ${(label + ':').padEnd(10)}${String(v).trim()}`);

  return `\nBUSINESS\n${lines.join('\n')}\n`;
}

module.exports = { businessBlock };
