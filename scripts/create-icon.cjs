const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const sharp = require('sharp');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage();
    const image = await page.evaluate(() => {
      const canvas = document.createElement('canvas');canvas.width = canvas.height = 512;
      const c = canvas.getContext('2d');
      c.fillStyle = '#0b141a';c.beginPath();c.roundRect(8,8,496,496,96);c.fill();
      c.strokeStyle = '#7fffd4';c.lineWidth = 24;c.beginPath();c.arc(256,250,168,0,Math.PI*2);c.stroke();
      c.strokeStyle = '#bddad5';c.lineWidth = 7;c.lineCap = 'round';
      for (let i=0;i<12;i++) {
        const angle=i*Math.PI/6-Math.PI/2;
        c.beginPath();c.moveTo(256+Math.cos(angle)*140,250+Math.sin(angle)*140);c.lineTo(256+Math.cos(angle)*150,250+Math.sin(angle)*150);c.stroke();
      }
      c.strokeStyle='#f6fffc';c.lineWidth=21;c.beginPath();c.moveTo(256,142);c.lineTo(256,250);c.lineTo(334,294);c.stroke();
      c.strokeStyle='#ff5b79';c.lineWidth=8;c.beginPath();c.moveTo(231,282);c.lineTo(315,174);c.stroke();
      c.fillStyle='#ff5b79';c.beginPath();c.arc(256,250,15,0,Math.PI*2);c.fill();
      c.fillStyle='#0b141a';c.fillRect(191,406,130,35);
      c.fillStyle='#e7fff5';c.font='bold 34px Arial';c.textAlign='center';c.fillText('DAYAN',256,438);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const assets = path.resolve(__dirname, '../assets');
    const png = Buffer.from(image, 'base64');fs.writeFileSync(path.join(assets, 'icon.png'), png);
    const icon = await sharp(png).resize(256,256).png().toBuffer();
    const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(icon.length,14);header.writeUInt32LE(22,18);
    fs.writeFileSync(path.join(assets, 'icon.ico'), Buffer.concat([header, icon]));
  } finally { await browser.close(); }
})().catch(error => { console.error(error);process.exitCode=1; });
