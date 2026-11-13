const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron } = require(process.env.DAYAN_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const output = fs.mkdtempSync('D:/Codex/Temp/dayan-unlock-layout-');
fs.writeFileSync(path.join(output, 'preferences.json'), JSON.stringify({ settingsGuideVersion: 1, autoStart: false }));
let desktop;
(async () => {
  const env = { ...process.env, DAYAN_TEST: '1', DAYAN_TEST_DATA: output };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await _electron.launch({ executablePath: packaged ? path.join(process.env.DAYAN_RELEASE_DIR, 'win-unpacked/DAYANClock.exe') : require(path.join(root, 'node_modules/electron')), args: packaged ? [] : [root], env });
  const page = await desktop.firstWindow();
  await page.waitForSelector('html[data-ready=true]');
  await page.waitForTimeout(500);
  const layouts = [
    { area: { x: 0, y: -900, width: 2560, height: 1980 }, content: { x: 0, y: 0, width: 1920, height: 1080 } },
    { area: { x: -1280, y: 0, width: 3200, height: 1080 }, content: { x: 0, y: 0, width: 1920, height: 1080 } },
    { area: { x: 0, y: 0, width: 1280, height: 720 }, content: { x: 0, y: 0, width: 1280, height: 720 } }
  ];
  const checks = [];
  for (const layout of layouts) {
    await desktop.evaluate(({ BrowserWindow }, bounds) => { const win = BrowserWindow.getAllWindows()[0]; win.setAspectRatio(0); win.setBounds(bounds); }, layout.area);
    // Renderer-only lock state: do not block the user's keyboard for geometry checks.
    await desktop.evaluate(({ BrowserWindow }, layout) => BrowserWindow.getAllWindows()[0].webContents.send('dayan:window-state', { fullscreen: true, locked: true, passwordConfigured: true, keyboardGuardActive: true, presentationLayout: { ...layout, scope: 'all' } }), layout);
    await page.waitForSelector('html.locked[data-fullscreen=true]');
    const count = await page.locator('#style-menu [data-style]').count();
    for (let style = 0; style < count; style++) {
      await page.evaluate(style => {
        document.querySelectorAll('[data-variant]').forEach((section, index) => { section.hidden = index !== style; });
        document.documentElement.dataset.style = String(style);
        document.getElementById('simple-timers').dispatchEvent(new Event('dayan:refresh'));
      }, style);
      const geometry = await page.evaluate(() => {
        const section = document.querySelector('[data-variant]:not([hidden])');
        const rect = selector => { const b = section.querySelector(selector).getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, bottom: b.bottom }; };
        return { button: rect('.unlock-launch'), almanac: rect('.almanac') };
      });
      const x = layout.content.x - layout.area.x, y = layout.content.y - layout.area.y;
      assert.ok(geometry.button.x >= x && geometry.button.x + geometry.button.width <= x + layout.content.width, JSON.stringify({ style, layout, geometry }));
      assert.ok(geometry.button.y >= geometry.almanac.bottom - 1 && geometry.button.bottom <= y + layout.content.height, JSON.stringify({ style, layout, geometry }));
      if (style === 3) {
        const orbit = await page.evaluate(() => {
          const section = document.querySelector('[data-variant]:not([hidden])');
          const ring = section.querySelector('.ring').getBoundingClientRect();
          const readout = section.querySelector('.readout').getBoundingClientRect();
          return { ringCenter: { x: ring.x + ring.width/2, y: ring.y + ring.height/2 }, readoutCenter: { x: readout.x + readout.width/2, y: readout.y + readout.height/2 } };
        });
        assert.ok(Math.abs(orbit.ringCenter.x - orbit.readoutCenter.x) < 2 && Math.abs(orbit.ringCenter.y - orbit.readoutCenter.y) < 2, 'Orbit digits must remain inside the ring');
      }
      if ([2, 3, 5].includes(style)) await page.screenshot({ path: path.join(output, `layout-${checks.length}-style-${style}.png`) });
      await page.locator('[data-variant]:not([hidden]) .unlock-launch').click();
      const panel = await page.locator('#unlock-panel').boundingBox();
      assert.ok(Math.abs(panel.x + panel.width / 2 - (x + layout.content.width / 2)) < 2);
      assert.ok(Math.abs(panel.y + panel.height / 2 - (y + layout.content.height / 2)) < 2);
      if (style === 3) await page.screenshot({ path: path.join(output, `unlock-panel-${checks.length}.png`) });
      await page.evaluate(() => { document.getElementById('unlock-panel').hidden = true; document.getElementById('lock-screen').classList.remove('has-panel'); });
      checks.push({ style, content: layout.content, button: geometry.button });
    }
    await page.screenshot({ path: path.join(output, `layout-${checks.length}.png`) });
  }
  fs.writeFileSync(path.join(output, 'validation.json'), JSON.stringify({ result: 'passed', packaged, checks }, null, 2));
  console.log(JSON.stringify({ result: 'passed', packaged, styleLayoutChecks: checks.length, output }));
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => { if (desktop) await desktop.close(); });
