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
  { id: 'pelican-bike', file: 'pelican_bike.html', oldBars: [253, 246, 227] },
  { id: 'pelican-seaside', file: 'pelican_bike_seaside.html', oldBars: [43, 29, 58] }
];
let browser, desktop;
(async () => {
  browser = await chromium.launch({ headless: true, args: ['--allow-file-access-from-files'], ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const context = await browser.newContext({ viewport: { width: 800, height: 500 } });
  const pixelReader = await context.newPage();
  const data = fs.mkdtempSync('D:/Codex/Temp/dayan-dynamic-');
  const videoPath = path.join(data, 'test-cover.webm');
  fs.copyFileSync(path.join(__dirname, 'fixtures/wallpaper-cover.webm'), videoPath);
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
    const coverage = [];
    for (const [width, height] of [[800, 600], [1920, 1080], [1920, 1200], [3440, 1440], [5120, 1440], [1080, 1920], [800, 500]]) {
      await adapted.setViewportSize({ width, height });
      await adapted.waitForFunction(() => {
        const box = document.querySelector('iframe').getBoundingClientRect();
        return box.width >= innerWidth - .1 && box.height >= innerHeight - .1 && Math.abs(box.width / box.height - 800 / 500) < .001;
      }, null, { polling: 50 });
      const box = await animation.locator('body > svg > rect').first().boundingBox();
      assert.ok(box.x <= .1 && box.y <= .1 && box.x + box.width >= width - .1 && box.y + box.height >= height - .1, `Actual painted scene does not cover ${width}x${height}: ${JSON.stringify(box)}`);
      const scale = await animation.locator('body > svg').evaluate(svg => { const m = svg.getScreenCTM(); return { x: m.a, y: m.d }; });
      assert.ok(Math.abs(scale.x - scale.y) < .001, 'Artwork must not stretch');
      assert.equal(await animation.locator('svg').getAttribute('viewBox'), '0 0 800 500');
      const screenshot = await adapted.screenshot({ path: path.join(output, `${scene.id}-${width}x${height}.png`) });
      const edges = await pixelReader.evaluate(async ({ png, bars }) => {
        const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
        let oldBarPixels = 0, transparentPixels = 0;
        for (const fraction of [.05, .15, .25, .4, .55, .7, .85, .95]) {
          for (const [x, y] of [[1, Math.floor(image.height * fraction)], [image.width - 2, Math.floor(image.height * fraction)], [Math.floor(image.width * fraction), 1], [Math.floor(image.width * fraction), image.height - 2]]) {
            const pixel = ctx.getImageData(x, y, 1, 1).data;
            if (bars.every((value, index) => value === pixel[index])) oldBarPixels++;
            if (pixel[3] !== 255) transparentPixels++;
          }
        }
        return { samples: 32, oldBarPixels, transparentPixels };
      }, { png: screenshot.toString('base64'), bars: scene.oldBars });
      assert.equal(edges.oldBarPixels, 0, `${scene.id}: original demo background is exposed at the screen edges`);
      assert.equal(edges.transparentPixels, 0);
      coverage.push({ width, height, painted: box, scale, edges });
    }
    assert.equal(await animation.locator('body > svg').evaluate(svg => svg.outerHTML), previous, 'Resize must preserve the running animation document');
    results.push({ scene: scene.id, originalSvgIdentical: true, animationAdvances: true, coverage });
    await source.close(); await adapted.close();
  }
  await browser.close(); browser = null;
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
  await page.evaluate(src => window.timerBackgrounds.push({ id: 'test-video', label: 'Video fixture', kind: 'video', src }), pathToFileURL(videoPath).href);
  const layouts = [
    { scope: 'all', area: { x: -1920, y: -1080, width: 5360, height: 2520 }, content: { x: 0, y: 0, width: 3440, height: 1440 }, displays: [{ id: 1, scaleFactor: 1.5, bounds: { x: 0, y: 0, width: 3440, height: 1440 } }, { id: 2, scaleFactor: 1, bounds: { x: -1920, y: -1080, width: 1920, height: 1080 } }] },
    { scope: 'all', area: { x: -1080, y: -1200, width: 3640, height: 3120 }, content: { x: 0, y: 0, width: 2560, height: 1440 }, displays: [{ id: 1, scaleFactor: 1.5, bounds: { x: 0, y: 0, width: 2560, height: 1440 } }, { id: 2, scaleFactor: 1, bounds: { x: -1080, y: 0, width: 1080, height: 1920 } }, { id: 3, scaleFactor: 2, bounds: { x: 0, y: -1200, width: 1920, height: 1200 } }] },
    null
  ];
  const multiDisplayChecks = [];
  const items = await page.evaluate(() => window.timerBackgrounds.map(item => ({ id: item.id, tag: item.kind === 'html' ? 'IFRAME' : item.kind === 'video' ? 'VIDEO' : 'IMG' })));
  for (const item of items) {
    await page.evaluate(id => document.querySelector('[data-variant]:not([hidden]) [data-background="' + (id === 'test-video' ? 'mountains' : id) + '"]').dataset.background = id, item.id);
    await active.locator(`[data-background="${item.id}"]`).evaluate(button => button.click());
    for (const layout of layouts) {
      await page.evaluate(layout => {
        const root = document.getElementById('simple-timers');
        root.dispatchEvent(new CustomEvent('dayan:presentation-layout', { detail: layout }));
        root.dispatchEvent(new Event('dayan:refresh'));
      }, layout);
      const expected = (layout?.displays || [null]).map(display => ({ tag: item.tag, id: display ? String(display.id) : null, left: display ? `${display.bounds.x - layout.area.x}px` : '', top: display ? `${display.bounds.y - layout.area.y}px` : '', width: display ? `${display.bounds.width}px` : '', height: display ? `${display.bounds.height}px` : '' }));
      const tiles = await active.locator('.wallpaper-media > *').evaluateAll(frames => frames.map(frame => ({ tag: frame.tagName, id: frame.dataset.display || null, left: frame.style.left, top: frame.style.top, width: frame.style.width, height: frame.style.height })));
      assert.deepEqual(tiles, expected, `${item.id}: per-display media geometry`);
      if (item.tag !== 'IFRAME') {
        await page.waitForFunction(() => {
          const media = document.querySelector('[data-variant]:not([hidden]) .wallpaper-media > *');
          if (media.error) throw new Error(media.error.message);
          return media.tagName === 'IMG' ? media.complete && media.naturalWidth > 0 : media.readyState >= 2;
        });
        assert.equal(await active.locator('.wallpaper-media > *').first().evaluate(media => getComputedStyle(media).objectFit), 'cover');
      } else if (scenes.some(scene => scene.id === item.id)) {
        for (const handle of await active.locator('.wallpaper-media > iframe').elementHandles()) {
          const adapter = await handle.contentFrame(); await adapter.waitForSelector('html[data-ready=true]');
          await adapter.waitForFunction(() => { const rect = document.querySelector('iframe').getBoundingClientRect(); return rect.left <= .1 && rect.top <= .1 && rect.right >= innerWidth - .1 && rect.bottom >= innerHeight - .1; });
        }
      }
      multiDisplayChecks.push({ id: item.id, displays: tiles.length, tiles });
    }
  }
  assert.deepEqual(errors, []);
  const report = { result: 'passed', packaged, results, multiDisplayChecks, errors, data };
  fs.writeFileSync(path.join(output, 'validation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ result: report.result, packaged, scenes: results.length, renderedCoverageChecks: results.reduce((sum, result) => sum + result.coverage.length, 0), mediaLayoutChecks: multiDisplayChecks.length, errors, output }, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); if (desktop) await desktop.close(); });
