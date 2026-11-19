const { chromium } = require('playwright');
const { MARKS, markSvg } = require('./marks');

const TRADES = Object.keys(MARKS);

const cell = (t, fill, bg) => `
  <div style="text-align:center">
    <div style="width:120px;height:120px;background:${bg};border-radius:12px;
                display:flex;align-items:center;justify-content:center">
      ${markSvg(t, { size: 100, fill })}
    </div>
    <div style="font:12px system-ui;color:#55606b;margin-top:6px">${t}</div>
  </div>`;

const row = (fill, bg) =>
  `<div style="display:flex;gap:16px;margin-bottom:22px;flex-wrap:wrap">${TRADES.map(t => cell(t, fill, bg)).join('')}</div>`;

const small = (size) => `<div style="display:flex;gap:10px;align-items:center;margin-bottom:18px;flex-wrap:wrap">
  ${TRADES.map(t => `<div style="width:${size + 20}px;height:${size + 20}px;background:#fff;border-radius:8px;flex:none;
     display:flex;align-items:center;justify-content:center">${markSvg(t, { size, fill: '#20291f' })}</div>`).join('')}
  <span style="font:12px system-ui;color:#55606b">at ${size}px</span>
</div>`;

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1180, height: 1100 }, deviceScaleFactor: 2 });
  await p.setContent(`<body style="margin:0;padding:24px;background:#eef1f4">
    ${row('#20291f', '#ffffff')}
    ${row('#ffffff', '#082d5b')}
    ${small(44)}
    ${small(28)}
  </body>`);
  await p.screenshot({ path: 'sheet.png', fullPage: true });
  await b.close();
})();
