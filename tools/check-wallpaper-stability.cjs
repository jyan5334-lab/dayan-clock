const workspacePaths = require('./workspace-paths.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { _electron } = require(process.env.DAYAN_PLAYWRIGHT_MODULE || 'playwright');
const { createRenderDiagnostics } = require('../desktop/render-diagnostics.cjs');

const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const output = fs.mkdtempSync(workspacePaths.temp('dayan-wallpaper-stability-'));
const data = path.join(output, 'profile');
fs.mkdirSync(data);
fs.writeFileSync(path.join(data, 'preferences.json'), JSON.stringify({
  settingsGuideVersion: 1, autoStart: true, style: 13,
  windowLayers: { unlocked: 'bottom', locked: 'top', displayScope: 'all' },
  widget: { privateContent: { version: 2, simpleTimers: Array.from({ length: 14 }, () => ({ clock: true, mode: 'watch', background: 'pelican-seaside', target: 300000, elapsed: 0 })) } }
}));

// Bounded logging and disk failures must not compromise the running desktop.
const log = createRenderDiagnostics(path.join(output, 'rotation'), { version: 'test', maxBytes: 256 });
for (let i = 0; i < 30; i++) log.record('test-event', { index: i });
assert.ok(fs.existsSync(log.file + '.1'));
for (const file of [log.file, log.file + '.1']) {
  assert.ok(fs.statSync(file).size < 512);
  for (const line of fs.readFileSync(file, 'utf8').trim().split('\n')) JSON.parse(line);
}
fs.writeFileSync(path.join(output, 'not-a-directory'), 'fixture');
assert.doesNotThrow(() => createRenderDiagnostics(path.join(output, 'not-a-directory', 'logs')).record('disk-error'));

let desktop;
const checks = [], errors = [], navigations = [];
const readLog = () => fs.readFileSync(path.join(data, 'diagnostics/render-events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
(async () => {
  const env = { ...process.env, DAYAN_TEST: '1', DAYAN_TEST_DATA: data };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await _electron.launch({ executablePath: packaged ? path.join(process.env.DAYAN_RELEASE_DIR, 'win-unpacked/DAYANClock.exe') : require(path.join(root, 'node_modules/electron')), args: [...(packaged ? [] : [root]), '--dayan-login-start'], env });
  const page = await desktop.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('html[data-desktop-hosted=true]');
  await page.waitForFunction(() => {
    const frames = [...document.querySelectorAll('section:not([hidden]) .wallpaper-media > iframe')];
    return frames.length > 0 && frames.every(frame => frame.contentDocument?.documentElement.dataset.ready === 'true');
  });
  page.on('framenavigated', frame => navigations.push(frame.url()));
  const actual = await page.evaluate(async () => (await window.dayan.load()).presentationLayout);
  const setLayout = async layout => {
    await page.evaluate(layout => {
      const root = document.getElementById('simple-timers');
      root.dispatchEvent(new CustomEvent('dayan:presentation-layout', { detail: layout }));
      root.dispatchEvent(new Event('dayan:refresh'));
    }, layout);
  };
  const layout = { scope: 'all', area: { x: -800, y: 0, width: 1600, height: 900 }, content: { x: 0, y: 0, width: 800, height: 600 }, primaryDisplayId: 1, displays: [
    { id: 1, bounds: { x: 0, y: 0, width: 800, height: 600 } },
    { id: 2, bounds: { x: -800, y: 0, width: 800, height: 900 } }
  ] };
  const catalog = await page.evaluate(() => window.timerBackgrounds.filter(item => item.kind === 'html').map(item => item.id));
  for (const id of catalog) {
    await page.locator(`section:not([hidden]) [data-background="${id}"]`).evaluate(button => button.click());
    await setLayout(layout);
    await page.waitForFunction(() => {
      const frames = [...document.querySelector('section:not([hidden]) .wallpaper-media').children];
      return frames.length === 2 && frames.every(frame => frame.contentDocument?.URL === frame.src && frame.contentDocument.readyState === 'complete' && (!frame.src.includes('/dynamic/') || frame.contentDocument.documentElement.dataset.ready === 'true'));
    });
    await page.evaluate(() => {
      window.__stableMedia = [...document.querySelector('section:not([hidden]) .wallpaper-media').children];
      window.__stableDocuments = window.__stableMedia.map(frame => frame.contentDocument);
    });
    const before = navigations.length;
    for (let cycle = 0; cycle < 10; cycle++) {
      const changed = structuredClone(layout);
      changed.displays.reverse();
      changed.displays[0].bounds.height += cycle * 10;
      changed.area.height += cycle * 10;
      await setLayout(changed);
      assert.equal(await page.evaluate(() => window.__stableMedia.every((frame, index) => frame.isConnected && frame.contentDocument === window.__stableDocuments[index])), true, id + ': geometry/order changes must retain live iframe documents');
      await setLayout(layout);
    }
    if(id==='pelican-island'){
      const swapped=structuredClone(layout);swapped.primaryDisplayId=2;swapped.content={...layout.displays[1].bounds};
      await setLayout(swapped);
      await page.waitForFunction(()=>[...document.querySelectorAll('section:not([hidden]) .wallpaper-media > iframe')].every(frame=>frame.contentWindow.__pelican.getState().greetingsAllowed===(frame.dataset.display==='2')));
      assert.equal(await page.evaluate(()=>window.__stableMedia.every((frame,index)=>frame.contentDocument===window.__stableDocuments[index])),true,'Changing primary display must retain the 3D scene');
      await setLayout(layout);
      await page.waitForFunction(()=>[...document.querySelectorAll('section:not([hidden]) .wallpaper-media > iframe')].every(frame=>frame.contentWindow.__pelican.getState().greetingsAllowed===(frame.dataset.display==='1')));
    }
    await page.waitForTimeout(300);
    assert.equal(navigations.length, before, id + ': layout refresh must not navigate background pages');
    const removed = structuredClone(layout);
    removed.displays = [layout.displays[0]];
    await setLayout(removed);
    assert.equal(await page.evaluate(() => window.__stableMedia[0].isConnected && !window.__stableMedia[1].isConnected), true, id + ': unplug removes only that monitor');
    await setLayout(layout);
    assert.equal(await page.evaluate(() => window.__stableMedia[0].isConnected && document.querySelector('section:not([hidden]) .wallpaper-media').children.length === 2), true, id + ': reconnect retains the unaffected monitor');
    checks.push({ background: id, geometryAndReorderCycles: 10, iframeOwnershipPreserved: true, unplugAndReconnect: true });
  }
  await setLayout(actual);
  await page.locator('section:not([hidden]) [data-background="pelican-seaside"]').evaluate(button => button.click());
  await page.waitForTimeout(800);
  const attachments = () => readLog().filter(event => event.event === 'desktop-attach').length;
  const before = attachments();
  await desktop.evaluate(({ screen }) => { for (let i = 0; i < 30; i++) screen.emit('display-metrics-changed', {}, screen.getPrimaryDisplay(), ['workArea']); });
  await page.waitForTimeout(1000);
  assert.equal(attachments(), before, 'Taskbar work-area events must not resize/reparent the fullscreen desktop');
  await desktop.evaluate(({ screen }) => screen.emit('display-metrics-changed', {}, screen.getPrimaryDisplay(), ['scaleFactor']));
  await page.waitForTimeout(1200);
  assert.ok(attachments() > before, 'Display scale changes must still refresh native fullscreen geometry');

  const handle = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString());
  const nativeGeometry = () => {
    const probe = spawnSync(path.join(root, 'assets/DAYANDesktopHost.exe'), ['inspect'], { encoding: 'utf8', windowsHide: true });
    assert.equal(probe.status, 0, probe.stderr);
    const windows = JSON.parse(probe.stdout).windows;
    const target = windows.find(item => item.handle === handle);
    assert.ok(target, 'Wallpaper remains attached to Explorer');
    assert.deepEqual(target.client, { x: target.x, y: target.y, width: target.width, height: target.height }, 'Wallpaper client must fill the native bounds');
    const siblings = windows.filter(item => item.parent === target.parent);
    const icons = siblings.find(item => item.cls === 'SHELLDLL_DefView');
    if (icons) assert.ok(siblings.indexOf(icons) < siblings.indexOf(target), 'Desktop icons remain above wallpaper');
    return target.client;
  };
  const initialGeometry = nativeGeometry();
  for (let i = 0; i < 3; i++) {
    const attachesBeforeMenu = attachments();
    await desktop.evaluate(() => globalThis.__dayanTray.popUpContextMenu());
    await page.waitForTimeout(350);
    assert.deepEqual(nativeGeometry(), initialGeometry, 'Opening real tray menu must not clip native wallpaper geometry');
    assert.equal(attachments(), attachesBeforeMenu, 'An open tray menu must not repeatedly reattach the desktop layer');
    await desktop.evaluate(() => globalThis.__dayanTray.closeContextMenu());
    await page.waitForTimeout(350);
    assert.deepEqual(nativeGeometry(), initialGeometry, 'Closing real tray menu must preserve native wallpaper geometry');
    assert.ok(attachments() <= attachesBeforeMenu + 1, 'Closing the tray menu may reconcile once but must not churn native attachments');
  }

  // Real elapsed soak, not a claim of day-long or every-frame acceptance.
  await page.waitForTimeout(500);
  const initialNavigations = navigations.length;
  const duration = Number(process.env.DAYAN_SOAK_SECONDS || 120) * 1000;
  const start = Date.now(), metrics = [], pixels = [];
  const snapshot = () => desktop.evaluate(async ({ app, BrowserWindow, screen }) => {
    const displays = screen.getAllDisplays();
    const left = Math.min(...displays.map(display => display.bounds.x)), top = Math.min(...displays.map(display => display.bounds.y));
    const ratios = [];
    for (const display of displays) {
      const clip = { ...display.bounds, x: display.bounds.x - left, y: display.bounds.y - top };
      const image = (await BrowserWindow.getAllWindows()[0].webContents.capturePage(clip)).resize({ width: 320 });
      const buffer = image.toBitmap();
      if (!buffer.length) throw Error('Empty monitor capture');
      let white = 0;
      for (let i = 0; i < buffer.length; i += 4) if (buffer[i] > 245 && buffer[i + 1] > 245 && buffer[i + 2] > 245) white++;
      ratios.push({ id: display.id, whiteRatio: white / (buffer.length / 4) });
    }
    return { ratios, memory: app.getAppMetrics().map(item => ({ type: item.type, privateKB: item.memory.privateBytes })) };
  });
  while (Date.now() - start < duration) {
    const sample = await snapshot();
    pixels.push(...sample.ratios.map(display => display.whiteRatio));
    assert.ok(sample.ratios.every(display => display.whiteRatio < .65), 'Unexpected mostly-white wallpaper frame on a monitor');
    if (metrics.length === 0 || Date.now() - metrics.at(-1).at > 15000) metrics.push({ at: Date.now(), memory: sample.memory });
    await page.waitForTimeout(750);
  }
  assert.equal(navigations.length, initialNavigations, 'Steady desktop must not recreate background documents');
  assert.deepEqual(errors, []);
  const faults = readLog().filter(event => ['renderer-gone', 'child-process-gone', 'renderer-unresponsive'].includes(event.event));
  assert.deepEqual(faults, []);
  await page.screenshot({ path: path.join(output, 'soak-end.png') });
  // Crash only this isolated test renderer to verify real failure telemetry.
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
  const faultDeadline = Date.now() + 5000;
  while (!readLog().some(event => event.event === 'renderer-gone') && Date.now() < faultDeadline) await new Promise(resolve => setTimeout(resolve, 100));
  const injectedFault = readLog().find(event => event.event === 'renderer-gone');
  assert.ok(injectedFault?.reason, 'A real isolated renderer crash must produce a persisted diagnostic');
  await desktop.close(); desktop = null;
  const report = { result: 'passed', packaged, checks, workAreaNotifications: 30, nativeScaleRefreshPreserved: true, realTrayNativeGeometryCycles: 3, nativeGeometry: initialGeometry, soakMs: Date.now() - start, samples: pixels.length, maxWhiteRatio: Math.max(...pixels), metrics, errors, faults, injectedRendererCrashLogged: injectedFault, limitation: 'Sampled capturePage pixels and short real elapsed soak do not prove absence of transient compositor flashes during multi-hour use or every physical monitor/DPI combination.', output };
  fs.writeFileSync(path.join(output, 'validation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => { if (desktop) await desktop.close(); });
