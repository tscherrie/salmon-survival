const path = require('path');
const { zoomSheet } = require('./zoomsheet');
const { close } = require('./render');
const R = (f) => path.join(__dirname, f);
const icns = [['ic04', 16], ['ic05', 32], ['ic11', 32], ['ic12', 64]].map(([k, n]) => ({ file: R(`icns-out/${k}.png`), size: n, label: `icns ${k}` }));
const ico = [16, 20, 24, 30, 32, 36, 40, 48, 64].map((n) => ({ file: R(`readback/ico-${n}.png`), size: n, label: `ico ${n}` }));
(async () => {
  await zoomSheet([...icns, ...ico], R('readback/readback-sheet.png'), { cell: 128, title: 'Read back from icon.icns and icon.ico (decoded entries)' });
  await close();
})();
