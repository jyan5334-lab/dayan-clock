const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require(process.env.DAYAN_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');

async function checkBackgroundSwitching(desktop, page, displayScope = 'current') {
  const catalog = await page.evaluate(() => window.timerBackgrounds.map(item => ({ id: item.id, src: item.src, kind: item.kind })));
  const active = '#simple-timers > section:not([hidden])';
  const checks = [];
  async function assertApplied(target, item) {
    await target.waitForFunction(({ active, id }) => document.querySelector(`${active} [data-background="${id}"]`)?.getAttribute('aria-pressed') === 'true', { active, id: item.id }, { timeout: 5000 });
    await target.waitForFunction(async id => (await window.dayan.load()).widget.privateContent.simpleTimers.every(timer => timer.background === id), item.id);
    if (target === page) {
      await target.waitForFunction(({ active, src }) => document.querySelector(`${active} .wallpaper-media > *`)?.getAttribute('src') === src, { active, src: item.src });
    }
  }
  async function select(target, item) {
    await target.locator(`${active} [data-background="${item.id}"]`).click();
    try {
      await assertApplied(target, item);
      await assertApplied(target === page ? editor : page, item);
    } catch (error) { throw new Error(`Background ${item.id} failed from ${target === page ? 'main' : 'editor'}: ${error.message}`); }
  }
  // Save in the main window first, then return to that exact state from the editor.
  // Previously this was mistaken for an echo of the main window's old save.
  const seed = catalog.at(-1);
  await page.locator(`${active} [data-background-toggle]`).click();
  await page.locator(`${active} [data-background="${seed.id}"]`).click();
  await page.evaluate(displayScope => window.dayan.save({ windowLayers: { unlocked: 'bottom', locked: 'top', displayScope } }), displayScope);
  await page.evaluate(() => window.dayan.windowAction('fullscreen'));
  await page.waitForSelector('html[data-fullscreen=true]');
  const geometry = () => desktop.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(win => !win.webContents.getURL().includes('editor=') && win.webContents.getURL().includes('index.html'));
    return { bounds: win.getBounds(), content: win.getContentBounds() };
  });
  const before = await geometry();
  const opened = desktop.waitForEvent('window');
  await desktop.evaluate(() => globalThis.__dayanTrayMenu.items.find(item => item.label === '切换背景').click());
  let editor = await opened;
  await editor.waitForSelector('html[data-ready=true]');
  for (let cycle = 0; cycle < 2; cycle++) {
    for (const item of [...catalog, ...catalog.toReversed()]) {
      await select(editor, item);
      checks.push({ cycle, source: 'editor', id: item.id });
    }
  }
  for (const item of catalog) {
    // Fullscreen uses the separate editor for pointer input. Exercise the main
    // renderer's event path too, without changing the fullscreen window mode.
    await page.locator(`${active} [data-background="${item.id}"]`).evaluate(button => button.click());
    await assertApplied(page, item);
    await assertApplied(editor, item);
    checks.push({ source: 'main', id: item.id });
  }
  await editor.locator('#editor-close').click();
  const reopened = desktop.waitForEvent('window');
  await desktop.evaluate(() => globalThis.__dayanTrayMenu.items.find(item => item.label === '切换背景').click());
  editor = await reopened;
  await editor.waitForSelector('html[data-ready=true]');
  await assertApplied(editor, seed);
  await select(editor, catalog[0]);
  await select(editor, seed);
  await editor.locator('#editor-close').click();
  assert.deepEqual(await geometry(), before, `${displayScope}: background selection must preserve fullscreen geometry`);
  await desktop.evaluate(() => globalThis.__dayanTrayMenu.items.find(item => item.label.startsWith('最小化')).click());
  await page.waitForSelector('html[data-fullscreen=false]');
  return checks.map(check => ({ displayScope, ...check }));
}
module.exports = { checkBackgroundSwitching };

if (require.main === module) {
  let desktop;
  (async () => {
    const data = fs.mkdtempSync('D:/Codex/Temp/dayan-background-switch-');
    fs.writeFileSync(path.join(data, 'preferences.json'), JSON.stringify({ settingsGuideVersion: 1, autoStart: false, style: 1 }));
    const packaged = process.argv.includes('--packaged');
    const env = { ...process.env, DAYAN_TEST: '1', DAYAN_TEST_DATA: data };
    delete env.ELECTRON_RUN_AS_NODE;
    const launchOptions = { executablePath: packaged ? path.join(process.env.DAYAN_RELEASE_DIR, 'win-unpacked/DAYANClock.exe') : require(path.join(root, 'node_modules/electron')), args: packaged ? [] : [root], env };
    desktop = await _electron.launch(launchOptions);
    const page = await desktop.firstWindow();
    await page.waitForSelector('html[data-ready=true]');
    const checks = await checkBackgroundSwitching(desktop, page);
    const saved = await page.evaluate(() => window.dayan.load());
    await desktop.close(); desktop = null;
    desktop = await _electron.launch(launchOptions);
    const restarted = await desktop.firstWindow();
    await restarted.waitForSelector('html[data-ready=true]');
    assert.deepEqual((await restarted.evaluate(() => window.dayan.load())).widget, saved.widget, 'Background selection must survive restarting the app');
    const selected = saved.widget.privateContent.simpleTimers[0].background;
    await restarted.waitForFunction(id => document.querySelector('#simple-timers > section:not([hidden]) .wallpaper-media > iframe')?.src.endsWith('?scene=' + id), selected);
    fs.writeFileSync(path.join(data, 'validation.json'), JSON.stringify({ result: 'passed', packaged, checks }, null, 2));
    console.log(JSON.stringify({ result: 'passed', packaged, checks: checks.length, data }));
  })().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => { if (desktop) await desktop.close(); });
}
