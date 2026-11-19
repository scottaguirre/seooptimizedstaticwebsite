// Writes real .svg files — one per mark, plus a sheet of all of them.
const fs = require('fs');
const path = require('path');
const { MARKS, markSvg } = require('./marks');

const out = process.argv[2] || path.join(__dirname, 'svg');

fs.mkdirSync(out, { recursive: true });

for (const name of Object.keys(MARKS)) {
  fs.writeFileSync(path.join(out, `${name}.svg`), markSvg(name, { size: 120 }) + '\n');
}

// one sheet, so the set can be opened in a single window
const names = Object.keys(MARKS);
const col = 6;
const cell = 130;
const rows = Math.ceil(names.length / col);

const body = names.map((name, i) => {
  const x = (i % col) * cell;
  const y = Math.floor(i / col) * (cell + 22);
  const inner = markSvg(name, { size: 120 })
    .replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');

  return `<g transform="translate(${x} ${y})">`
    + `<rect width="${cell - 10}" height="${cell - 10}" rx="12" fill="#ffffff"/>`
    + `<g transform="translate(0 0) scale(1.2)">${inner}</g>`
    + `<text x="${(cell - 10) / 2}" y="${cell + 6}" text-anchor="middle"`
    + ` font-family="system-ui, sans-serif" font-size="11" fill="#55606b">${name}</text></g>`;
}).join('\n  ');

fs.writeFileSync(path.join(out, 'all-marks.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" width="${col * cell}" height="${rows * (cell + 22)}"`
  + ` viewBox="0 0 ${col * cell} ${rows * (cell + 22)}">\n`
  + `  <rect width="100%" height="100%" fill="#eef1f4"/>\n  ${body}\n</svg>\n`);

console.log('wrote', fs.readdirSync(out).length, 'files to', out);
