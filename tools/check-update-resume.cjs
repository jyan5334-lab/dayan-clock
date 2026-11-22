const workspacePaths = require('./workspace-paths.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { _electron } = require(process.env.DAYAN_PLAYWRIGHT_MODULE || 'playwright');
const { saveUpdateSession } = require('../desktop/update-session.cjs');
const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
fs.mkdirSync(workspacePaths.temp(), { recursive: true });
const output = fs.mkdtempSync(workspacePaths.temp('dayan-update-resume-'));
const checks = [], errors = [];
let desktop;
async function close() {
  if (!desktop) return;
  const running = desktop; desktop = null;
  const child = running.process();
  await running.evaluate(({ app }) => app.quit()).catch(() => {});
  await running.close().catch(() => child.kill());
  if (child.exitCode === null) child.kill();
}
(async () => {
  const cases = [
    { name:'current-top', scope:'current', layer:'top', fullscreen:true },
    { name:'all-top', scope:'all', layer:'top', fullscreen:true },
    { name:'current-bottom', scope:'current', layer:'bottom', fullscreen:true },
    { name:'all-bottom-recovery', scope:'all', layer:'bottom', fullscreen:true, recovery:true },
    { name:'windowed', scope:'current', layer:'top', fullscreen:false },
    { name:'windowed-minimized', scope:'current', layer:'top', fullscreen:false, minimized:true },
    { name:'removed-monitor', scope:'current', layer:'top', fullscreen:true, displayId:-999999 },
    { name:'upgrade-from-old-version', scope:'all', layer:'bottom', fullscreen:true, legacy:true },
    { name:'expired-session', scope:'current', layer:'top', fullscreen:false, stale:true }
  ];
  for (const scenario of cases) {
    const data = path.join(output, scenario.name);
    fs.mkdirSync(data);
    const widget = { privateContent:{ version:2, simpleTimers:Array.from({ length:14 }, () => ({ mode:'up', clock:true, background:'fox-quest', target:300000, elapsed:0 })) } };
    const saved = { settingsGuideVersion:1, autoStart:false, style:1, widget, windowLayers:{ unlocked:scenario.layer, locked:'top', displayScope:scenario.scope }, bounds:{ x:80, y:80, width:600, height:400 } };
    fs.writeFileSync(path.join(data, 'preferences.json'), JSON.stringify(saved));
    if (!scenario.legacy) saveUpdateSession(data, { fullscreen:scenario.stale || scenario.fullscreen, displayScope:scenario.scope, displayId:scenario.displayId, minimized:scenario.minimized === true, version:require('../package.json').version });
    if (scenario.stale) {
      const file = path.join(data, 'updates/resume.json');
      const stale = JSON.parse(fs.readFileSync(file)); stale.createdAt -= 2 * 86400000;
      fs.writeFileSync(file, JSON.stringify(stale));
    }
    const env = { ...process.env, DAYAN_TEST:'1', DAYAN_TEST_DATA:data }; delete env.ELECTRON_RUN_AS_NODE;
    const executablePath = packaged ? path.join(process.env.DAYAN_RELEASE_DIR, 'win-unpacked/DAYANClock.exe') : require(path.join(root, 'node_modules/electron'));
    const args = [...(packaged ? [] : [root]), scenario.recovery ? '--dayan-update-recovery' : '--updated'];
    desktop = await _electron.launch({ executablePath, args, env });
    desktop.on('window', page => page.on('pageerror', error => errors.push(error.message)));
    const page = await desktop.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('html[data-ready=true]');
    await page.waitForFunction(() => document.querySelector('#simple-timers > section:not([hidden]) .wallpaper-media iframe')?.getAttribute('src').includes('scene=fox-quest'));
    await page.waitForSelector(`html[data-fullscreen=${scenario.fullscreen}]`);
    if (scenario.layer === 'bottom' && scenario.fullscreen) await page.waitForSelector('html[data-desktop-hosted=true]');
    await page.waitForTimeout(500);
    const geometry = await desktop.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('index.html'));
      return { bounds:win.getBounds(), fullscreen:win.isFullScreen(), minimized:win.isMinimized(), primary:screen.getPrimaryDisplay().bounds, displays:screen.getAllDisplays().map(display => display.bounds), content:win.getContentBounds(), style:process.mainModule.require('node:fs').readFileSync(process.env.DAYAN_TEST_DATA + '/preferences.json', 'utf8') };
    });
    assert.equal(geometry.minimized, scenario.minimized === true);
    if (scenario.fullscreen) {
      const x = Math.min(...geometry.displays.map(bounds => bounds.x));
      const y = Math.min(...geometry.displays.map(bounds => bounds.y));
      const expected = scenario.scope === 'all' ? { x, y, width:Math.max(...geometry.displays.map(bounds => bounds.x + bounds.width)) - x, height:Math.max(...geometry.displays.map(bounds => bounds.y + bounds.height)) - y } : geometry.primary;
      for (const key of ['x','y','width','height']) assert.equal(geometry.bounds[key], expected[key], `${scenario.name}: ${key}`);
      assert.equal(geometry.content.width, geometry.bounds.width);
      assert.equal(geometry.content.height, geometry.bounds.height);
    } else if (!scenario.minimized) assert.ok(geometry.bounds.width < geometry.primary.width, scenario.name + ': keep ordinary window');
    const persisted = JSON.parse(geometry.style);
    assert.equal(persisted.style, saved.style);
    assert.equal(persisted.widget.privateContent.simpleTimers[0].background, 'fox-quest');
    assert.deepEqual(persisted.windowLayers, saved.windowLayers);
    if (!scenario.stale) assert.equal(fs.existsSync(path.join(data, 'updates/resume.json')), false, 'Resume record must be consumed');
    if (scenario.fullscreen) {
      const duplicate = spawn(executablePath, [...(packaged ? [] : [root]), '--updated'], { env, windowsHide:true, stdio:'ignore' });
      await new Promise((resolve, reject) => { duplicate.once('error', reject); duplicate.once('exit', resolve); });
      await page.waitForTimeout(150);
      assert.equal(await page.locator('html').getAttribute('data-fullscreen'), 'true', 'Duplicate installer launch must not detach wallpaper');
    }
    await page.screenshot({ path:path.join(output, scenario.name + '.png') });
    checks.push({ name:scenario.name, bounds:geometry.bounds });
    await close();
  }
  assert.deepEqual(errors, []);
  const report = { result:'passed', packaged, output, checks, errors };
  fs.writeFileSync(path.join(output, 'validation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(close);
