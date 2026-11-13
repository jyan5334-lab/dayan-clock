const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { _electron } = require(process.env.DAYAN_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const output = fs.mkdtempSync('D:/Codex/Temp/dayan-desktop-startup-');
const native = args => {
  const result = spawnSync(path.join(root, 'assets/DAYANDesktopHost.exe'), args.map(String), { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
};
let desktop;
const checks = [];
(async () => {
  for (const scope of ['current', 'all']) {
    const data = path.join(output, scope);
    fs.mkdirSync(data);
    fs.writeFileSync(path.join(data, 'preferences.json'), JSON.stringify({ settingsGuideVersion: 1, autoStart: true, style: 1, windowLayers: { unlocked: 'bottom', locked: 'top', displayScope: scope } }));
    const env = { ...process.env, DAYAN_TEST: '1', DAYAN_TEST_DATA: data };
    delete env.ELECTRON_RUN_AS_NODE;
    desktop = await _electron.launch({ executablePath: packaged ? path.join(process.env.DAYAN_RELEASE_DIR, 'win-unpacked/DAYANClock.exe') : require(path.join(root, 'node_modules/electron')), args: [...(packaged ? [] : [root]), '--dayan-login-start'], env });
    const page = await desktop.firstWindow();
    await page.waitForSelector('html[data-desktop-hosted=true]');
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.textContent = '#simple-timers .timer{background:#732dc1!important;background-image:none!important}#simple-timers .timer::before,#simple-timers .timer::after{display:none!important}#simple-timers .timer>*{visibility:hidden!important}';
      document.head.append(style);
    });
    const hwnd = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString());
    const verify = label => {
      const windows = native(['inspect']).windows;
      const target = windows.find(window => window.handle === hwnd);
      assert.ok(target, label + ': wallpaper remains attached');
      const siblings = windows.filter(window => window.parent === target.parent);
      const icons = siblings.find(window => window.cls === 'SHELLDLL_DefView');
      const parent = windows.find(window => window.handle === target.parent);
      if (icons) {
        assert.ok(siblings.indexOf(icons) < siblings.indexOf(target), label + ': startup wallpaper must stay below desktop icons');
        const worker = siblings.find(window => window.cls === 'WorkerW');
        if (worker) assert.ok(siblings.indexOf(worker) > siblings.indexOf(target), label + ': Explorer wallpaper worker must stay below the app');
        if (Number(parent.extendedStyle) & 0x200000) assert.ok(Number(target.extendedStyle) & 0x80000, label + ': no-redirection desktop requires a layered wallpaper');
      }
      for (const key of ['x', 'y', 'width', 'height']) assert.equal(target.client[key], target[key], label + ': no hidden nonclient inset ' + key);
      if (target.regionType) {
        assert.ok(target.region.width >= target.width && target.region.height >= target.height, label + ': native region must not clip wallpaper');
      }
      return target;
    };
    await page.waitForTimeout(600);
    const before = verify(scope + ' login');
    const capture = async label => {
      const result = await desktop.evaluate(async ({ desktopCapturer, screen }) => {
      const primary = screen.getPrimaryDisplay();
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 960, height: 540 } });
      const source = sources.find(source => source.display_id === String(primary.id));
      if (!source) throw Error('Primary monitor capture is unavailable');
      const image = source.thumbnail, size = image.getSize(), pixels = image.toBitmap();
      let matches = 0;
      for (let y = Math.floor(size.height * .45); y < size.height * .85; y += 4) {
        for (let x = Math.floor(size.width * .2); x < size.width * .8; x += 4) {
          const i = (y * size.width + x) * 4;
          if (Math.abs(pixels[i] - 193) < 12 && Math.abs(pixels[i+1] - 45) < 12 && Math.abs(pixels[i+2] - 115) < 12) matches++;
        }
      }
      return { matches, size, png: image.toPNG().toString('base64') };
      });
      fs.writeFileSync(path.join(output, label + '.png'), Buffer.from(result.png, 'base64'));
      delete result.png;
      return result;
    };
    const visibleBefore = await capture(scope + '-before');
    assert.ok(visibleBefore.matches > 100, 'Wallpaper must actually render in the lower half of the primary screen');
    for (let attempt = 0; attempt < 3; attempt++) {
      // Use the actual NotifyIcon menu path; Menu.popup({window}) uses a different owner.
      await desktop.evaluate(() => globalThis.__dayanTray.popUpContextMenu());
      await page.waitForTimeout(150);
      assert.deepEqual(verify(scope + ' tray open').client, before.client);
      const visible = await capture(scope + '-tray-open-' + attempt);
      assert.ok(visible.matches > visibleBefore.matches * .65, 'Opening tray must preserve actual lower-half wallpaper pixels');
      await desktop.evaluate(() => globalThis.__dayanTray.closeContextMenu());
      await page.waitForTimeout(200);
      assert.deepEqual(verify(scope + ' tray closed').client, before.client);
    }
    checks.push({ scope, startupIconLayerVerified: true, realNotifyIconMenuPath: true, actualLowerHalfPixels: visibleBefore, client: before.client });
    await desktop.close(); desktop = null;
  }
  fs.writeFileSync(path.join(output, 'validation.json'), JSON.stringify({ result: 'passed', packaged, checks }, null, 2));
  console.log(JSON.stringify({ result: 'passed', packaged, checks, output }, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => { if (desktop) await desktop.close(); });
