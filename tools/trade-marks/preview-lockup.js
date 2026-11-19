const { chromium } = require('playwright');
const { markSvg } = require('./marks');

// The mark beside a name, in the 250x100 wide box the wizard already uses.
// THE TYPE HERE IS THE BROWSER'S, not the Inter paths the real wordmark
// draws — this is a mock of the arrangement, not of the finished logo.
const box = (trade, name, bg, ink) => `
  <div style="width:250px;height:100px;background:${bg};display:flex;align-items:center;
              gap:11px;padding:0 14px;box-sizing:border-box;border-radius:6px">
    <div style="flex:none">${markSvg(trade, { size: 58, fill: ink })}</div>
    <div style="color:${ink};font:800 19px/1.1 system-ui,sans-serif;letter-spacing:-.02em">${name}</div>
  </div>`;

const tile = (trade, bg, ink) => `
  <div style="width:84px;height:84px;background:${bg};border-radius:15px;display:flex;
              align-items:center;justify-content:center">${markSvg(trade, { size: 56, fill: ink })}</div>`;

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 900, height: 580 }, deviceScaleFactor: 2 });
  await p.setContent(`<body style="margin:0;padding:24px;background:#eef1f4;font-family:system-ui">
    <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:18px">
      ${box('plumbing', 'Austin<br>Drain Pros', '#ffffff', '#20291f')}
      ${box('roofing', 'Hill Country<br>Roofing', '#082d5b', '#ffffff')}
      ${box('electrician', 'Cedar Park<br>Electric', '#ffffff', '#20291f')}
    </div>
    <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:18px">
      ${box('painter', 'Round Rock<br>Painting', '#ffffff', '#20291f')}
      ${box('concrete', 'Lone Star<br>Concrete', '#082d5b', '#ffffff')}
      ${box('hvac', 'Georgetown<br>Air', '#ffffff', '#20291f')}
    </div>
    <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:18px">
      ${box('lawyer', 'Benson &amp; Hale<br>Lemon Law', '#ffffff', '#20291f')}
      ${box('laptop', 'Bluebonnet<br>Web Design', '#082d5b', '#ffffff')}
    </div>
    <div style="display:flex;gap:12px;align-items:center">
      ${['plumbing','roofing','electrician','concrete','hvac','painter','lawyer','laptop']
        .map(t => tile(t, '#082d5b', '#ffffff')).join('')}
      <span style="font:12px system-ui;color:#55606b;margin-left:8px">favicon tiles</span>
    </div>
  </body>`);
  await p.screenshot({ path: 'lockup.png', fullPage: true });
  await b.close();
})();
