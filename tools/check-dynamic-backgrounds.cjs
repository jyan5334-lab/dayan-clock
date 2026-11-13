const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium, _electron } = require(process.env.DAYAN_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const output = process.env.DAYAN_DYNAMIC_OUTPUT || 'D:/Codex/Outputs/DAYANDesktop/dynamic-backgrounds';
fs.mkdirSync(output, { recursive: true });
const scenes = [
  { id: 'pelican-bike', file: 'pelican_bike.html' },
  { id: 'pelican-seaside', file: 'pelican_bike_seaside.html' }
];
let browser, desktop;
(async () => {
  browser = await chromium.launch({ headless: true, args: ['--allow-file-access-from-files'], ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const context = await browser.newContext({ viewport: { width: 800, height: 500 } });
  await context.addInitScript(() => {
    let seed = 1;
    Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    let callbacks = [];
    performance.now = () => 0;
    window.requestAnimationFrame = callback => callbacks.push(callback);
    window.stepAnimation = time => { const pending = callbacks; callbacks = []; pending.forEach(callback => callback(time)); };
  });
  const results = [];
  for (const scene of scenes) {
    const source = await context.newPage(), adapted = await context.newPage();
    await source.goto(pathToFileURL(path.join(root, 'assets/backgrounds/dynamic/originals', scene.file)).href);
    await adapted.goto(pathToFileURL(path.join(root, 'assets/backgrounds/dynamic/animation.html')).href + '?scene=' + scene.id);
    await adapted.waitForSelector('html[data-ready=true]');
    const animation = adapted.frames().find(frame => frame.url().endsWith('/originals/' + scene.file));
    assert.ok(animation);
    let previous;
    for (const time of [0, 16.67, 33.34, 1000, 1016.67]) {
      for (const frame of [source, animation]) await frame.evaluate(time => window.stepAnimation(time), time);
      const actual = await animation.locator('body > svg').evaluate(svg => svg.outerHTML);
      assert.equal(actual, await source.locator('body > svg').evaluate(svg => svg.outerHTML), `${scene.id}: SVG changed at ${time}`);
      if (previous && time > 0) assert.notEqual(actual, previous, 'Animation must advance');
      previous = actual;
    }
    assert.equal(await animation.locator('body > h1').isVisible(), false);
    assert.equal(await animation.locator('.ctrl').isVisible(), false);
    await adapted.screenshot({ path: path.join(output, `preview-${scene.id}.png`) });
    if (process.argv.includes('--update-previews')) fs.copyFileSync(path.join(output, `preview-${scene.id}.png`), path.join(root, 'assets/backgrounds/dynamic', `preview-${scene.id}.png`));
    for (const [width, height] of [[1920, 1080], [3440, 1440], [1080, 1920]]) {
      await adapted.setViewportSize({ width, height });
      const box = await animation.locator('body > svg').boundingBox();
      assert.deepEqual(box, { x: 0, y: 0, width, height });
      assert.equal(await animation.locator('svg').getAttribute('viewBox'), '0 0 800 500');
    }
    results.push({ scene: scene.id, originalSvgIdentical: true, animationAdvances: true });
    await source.close(); await adapted.close();
  }
  await browser.close(); browser = null;
  const data = fs.mkdtempSync('D:/Codex/Temp/dayan-dynamic-');
  fs.writeFileSync(path.join(data, 'preferences.json'), JSON.stringify({ settingsGuideVersion: 1, autoStart: false, style: 1 }));
  const env = { ...process.env, DAYAN_TEST: '1', DAYAN_TEST_DATA: data };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await _electron.launch({ executablePath: packaged ? path.join(process.env.DAYAN_RELEASE_DIR, 'win-unpacked/DAYANClock.exe') : require(path.join(root, 'node_modules/electron')), args: packaged ? [] : [root], env });
  const page = await desktop.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  await page.waitForSelector('html[data-ready=true]');
  const active = page.locator('#simple-timers > section:not([hidden])');
  for (const scene of scenes) {
    await active.locator('[data-background-toggle]').click();
    assert.ok(await active.locator('.background-group-heading', { hasText: /^动态背景$/ }).isVisible());
    await active.locator(`[data-background="${scene.id}"]`).click();
    assert.equal(await active.locator('.timer').evaluate(timer => getComputedStyle(timer, '::before').display), 'none', 'Original colors must not be dimmed by wallpaper overlays');
    await active.frameLocator('.wallpaper-media > iframe').locator('html[data-ready=true]').waitFor();
    const wallpaper = await (await active.locator('.wallpaper-media > iframe').elementHandle()).contentFrame();
    assert.ok(wallpaper);
    await wallpaper.waitForSelector('html[data-ready=true]');
    const original = wallpaper.childFrames().find(frame => frame.url().endsWith('/originals/' + scene.file));
    const svgBefore = await original.locator('body > svg').evaluate(svg => svg.outerHTML);
    await original.waitForFunction(before => document.querySelector('body > svg').outerHTML !== before, svgBefore);
    await page.screenshot({ path: path.join(output, `${scene.id}-clock.png`) });
    await page.waitForTimeout(200);
    const state = await page.evaluate(() => window.dayan.load());
    assert.equal(state.widget.privateContent.simpleTimers[0].background, scene.id);
  }
  await page.evaluate(() => {
    const layout = { scope: 'all', area: { x: -1920, y: -1080, width: 5360, height: 2520 }, content: { x: 0, y: 0, width: 3440, height: 1440 }, displays: [{ id: 1, bounds: { x: 0, y: 0, width: 3440, height: 1440 } }, { id: 2, bounds: { x: -1920, y: -1080, width: 1920, height: 1080 } }] };
    document.getElementById('simple-timers').dispatchEvent(new CustomEvent('dayan:presentation-layout', { detail: layout }));
    document.getElementById('simple-timers').dispatchEvent(new Event('dayan:refresh'));
  });
  const tiles = await active.locator('.wallpaper-media > iframe').evaluateAll(frames => frames.map(frame => ({ id: frame.dataset.display, left: frame.style.left, top: frame.style.top, width: frame.style.width, height: frame.style.height })));
  assert.deepEqual(tiles, [{ id: '1', left: '1920px', top: '1080px', width: '3440px', height: '1440px' }, { id: '2', left: '0px', top: '0px', width: '1920px', height: '1080px' }]);
  assert.deepEqual(errors, []);
  const report = { result: 'passed', packaged, results, multiDisplayTiles: tiles, errors, data };
  fs.writeFileSync(path.join(output, 'validation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); if (desktop) await desktop.close(); });
