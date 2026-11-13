const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron } = require(process.env.DAYAN_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const output = fs.mkdtempSync('D:/Codex/Temp/dayan-display-settings-');
const preferences = path.join(output, 'preferences.json');
// Existing preferences deliberately omit the new option to test upgrade defaults.
fs.writeFileSync(preferences, JSON.stringify({ settingsGuideVersion: 1, autoStart: false, displaySettings: { showAlmanac: true } }));
let desktop;
async function launch() {
  const env = { ...process.env, DAYAN_TEST: '1', DAYAN_TEST_DATA: output };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await _electron.launch({ executablePath: packaged ? path.join(process.env.DAYAN_RELEASE_DIR, 'win-unpacked/DAYANClock.exe') : require(path.join(root, 'node_modules/electron')), args: packaged ? [] : [root], env });
  const page = await desktop.firstWindow();
  await page.waitForSelector('html[data-ready=true]');
  return page;
}
async function change(page, clock, almanac) {
  await page.evaluate(({ clock, almanac }) => {
    for (const [id, checked] of [['show-clock-date', clock], ['show-almanac', almanac]]) {
      const input = document.getElementById(id);
      if (input.checked !== checked) input.click();
    }
  }, { clock, almanac });
}
(async () => {
  let page = await launch();
  await page.locator('#settings-toggle').click();
  await page.locator('[data-settings-tab=almanac]').click();
  assert.equal(await page.locator('#show-clock-date').isChecked(), true);
  await page.locator('#show-clock-date').uncheck();
  await page.screenshot({ path: path.join(output, 'settings.png') });
  await page.locator('#settings-close').click();
  const checks = [];
  for (const fullscreen of [false, true]) {
    if (fullscreen) {
      await desktop.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.setAspectRatio(0);
        win.setBounds({ x: 0, y: 0, width: 1920, height: 1080 });
        win.webContents.send('dayan:window-state', { fullscreen: true, locked: false, presentationLayout: { scope: 'all', area: { x: -1280, y: -900, width: 3200, height: 1980 }, content: { x: 0, y: 0, width: 1920, height: 1080 } } });
      });
      await page.waitForSelector('html[data-fullscreen=true]');
    }
    const count = await page.locator('#style-menu [data-style]').count();
    for (let style = 0; style < count; style++) {
      await page.evaluate(style => document.querySelector(`#style-menu [data-style="${style}"]`).click(), style);
      for (const [clock, almanac] of [[true, true], [false, true], [true, false], [false, false]]) {
        await change(page, clock, almanac);
        const visibility = await page.evaluate(() => {
          const section = document.querySelector('[data-variant]:not([hidden])');
          const visible = selector => {
            const el = section.querySelector(selector);
            return !!el && el.getClientRects().length > 0 && el.getBoundingClientRect().width > 0;
          };
          return { time: visible('.readout'), date: visible('.date'), almanac: visible('.almanac'), art: visible('.artwork'), ring: visible('.ring'), designed: !!section.querySelector('.artwork') };
        });
        assert.equal(visibility.time, clock, JSON.stringify({ fullscreen, style, clock, almanac, visibility }));
        assert.equal(visibility.date, clock);
        assert.equal(visibility.almanac, almanac);
        if (visibility.designed) assert.equal(visibility.art, clock);
        if (style === 3) assert.equal(visibility.ring, clock);
        checks.push({ fullscreen, style, clock, almanac });
      }
    }
  }
  // Exercise the renderer lock UI without installing a native keyboard hook.
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('dayan:window-state', { fullscreen: true, locked: true, passwordConfigured: true, keyboardGuardActive: true }));
  const unlock = page.locator('[data-variant]:not([hidden]) .unlock-launch');
  await unlock.waitFor({ state: 'visible' });
  await unlock.click();
  await page.locator('#unlock-panel').waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(output, 'hidden-clock-unlock.png') });
  await desktop.close();
  desktop = null;
  assert.equal(JSON.parse(fs.readFileSync(preferences)).displaySettings.showClockDate, false);
  page = await launch();
  assert.equal(await page.locator('#show-clock-date').isChecked(), false);
  assert.equal(await page.locator('#show-almanac').isChecked(), false);
  assert.equal(await page.locator('[data-variant]:not([hidden]) .date').isVisible(), false);
  // Timer tools remain usable even when the wallpaper clock is hidden.
  for (const mode of ['watch', 'down', 'up']) {
    await page.evaluate(mode => document.querySelector(`[data-variant]:not([hidden]) [data-mode="${mode}"]`).click(), mode);
    assert.equal(await page.locator('[data-variant]:not([hidden]) .readout').isVisible(), true);
  }
  await page.evaluate(() => document.querySelector('[data-variant]:not([hidden]) [data-mode=clock]').click());
  await change(page, true, true);
  await page.waitForFunction(() => window.dayanDisplaySettings.showClockDate === true);
  await desktop.close();
  desktop = null;
  page = await launch();
  assert.equal(await page.locator('#show-clock-date').isChecked(), true);
  assert.equal(await page.locator('[data-variant]:not([hidden]) .date').isVisible(), true);
  fs.writeFileSync(path.join(output, 'validation.json'), JSON.stringify({ result: 'passed', packaged, checks, restart: 'both values persisted', unlock: 'visible with clock and almanac hidden', timers: 'all three modes visible' }, null, 2));
  console.log(JSON.stringify({ result: 'passed', packaged, checks: checks.length, output }));
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => { if (desktop) await desktop.close(); });
