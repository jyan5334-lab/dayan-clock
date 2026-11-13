const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { _electron } = require(process.env.DAYAN_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const packed = process.argv.includes('--packaged');
const testRoot = process.env.DAYAN_TEST_ROOT || 'D:/Codex/Temp';
fs.mkdirSync(testRoot, { recursive:true });
const testDir = fs.mkdtempSync(path.join(testRoot, 'dayan-update-prompts-'));
const profile = path.join(testDir, 'data');
fs.mkdirSync(profile);
const preferences = path.join(profile, 'preferences.json');
fs.writeFileSync(preferences, JSON.stringify({ settingsGuideVersion:1, autoStart:false, style:1 }));
let origin, desktop, mainPage, requests = 0, unavailable = true;
const errors = [];
const today = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; };
const server = http.createServer((req, res) => {
  requests++;
  if (unavailable) { res.writeHead(503); return res.end('Temporary outage'); }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ version:'9.9.9', sha256:'a'.repeat(64), size:128 * 1024 * 1024, downloadUrl:`${origin}/file`, notes:'本地更新测试；禁止安装。\n启动自动检测、今日暂停提醒与手动检查回归。\n'.repeat(14) }));
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const updaterWindows = () => desktop.windows().filter(page => page.url().includes('updater=1') && !page.isClosed());
async function prompt() {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const page = updaterWindows()[0];
    if (page) { await page.waitForSelector('html[data-update-ready=true]'); return page; }
    await pause(50);
  }
  throw Error('Automatic update prompt did not open');
}
async function launch() {
  const env = { ...process.env, DAYAN_TEST:'1', DAYAN_TEST_DATA:profile, DAYAN_TEST_UPDATE_URL:`${origin}/manifest` };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await _electron.launch({ executablePath:packed ? path.join(process.env.DAYAN_RELEASE_DIR || path.join(root, 'release'), 'win-unpacked/DAYANClock.exe') : require(path.join(root, 'node_modules/electron')), args:[...(packed ? [] : [root]), '--dayan-test-updates'], env });
  desktop.on('window', page => page.on('pageerror', error => errors.push(error.message)));
  mainPage = await desktop.firstWindow();
  await mainPage.waitForSelector('html[data-ready=true]');
}
async function quit() {
  const running = desktop;
  desktop = null;
  if (!running) return;
  const child = running.process();
  await running.evaluate(({ app }) => app.quit()).catch(() => {});
  await running.close().catch(() => child.kill());
  if (child.exitCode === null) child.kill();
}
async function dismiss(page, selector) {
  const closing = page.waitForEvent('close');
  await page.locator(selector).click({ noWaitAfter:true }).catch(error => { if (!page.isClosed()) throw error; });
  await closing;
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  await launch();
  while (!requests) await pause(50);
  await pause(1200);
  assert.equal(updaterWindows().length, 0);
  const failedRequests = requests;
  unavailable = false;
  let page = await prompt();
  assert.ok(requests > failedRequests, 'Startup failure must retry automatically without a user click');
  const mainBounds = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('updater=1')).getBounds());
  assert.equal(await page.locator('#update-remind-tomorrow').innerText(), '今日不再提醒');
  assert.equal(await page.locator('#update-cancel').innerText(), '取消');
  assert.equal(await page.locator('#update-confirm').isDisabled(), true, 'Fixture installer must stay blocked');
  assert.equal((await page.evaluate(() => window.dayan.updateInstall())).ok, false);
  for (const [width, height] of [[320,420], [480,520], [600,660]]) {
    await desktop.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('updater=1')).setBounds(bounds), { width, height });
    await page.locator('.update-actions').scrollIntoViewIfNeeded();
    const layout = await page.evaluate(() => ({ overflow:document.documentElement.scrollWidth > innerWidth, buttons:[...document.querySelectorAll('.update-actions button')].map(button => { const rect = button.getBoundingClientRect(); return { left:rect.left, right:rect.right, top:rect.top, bottom:rect.bottom }; }), width:innerWidth, height:innerHeight }));
    assert.equal(layout.overflow, false);
    for (const button of layout.buttons) assert.ok(button.left >= 0 && button.right <= layout.width && button.top >= 0 && button.bottom <= layout.height, JSON.stringify(layout));
    await desktop.evaluate(async ({ BrowserWindow }, output) => {
      const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('updater=1'));
      const image = await window.webContents.capturePage(undefined, { stayHidden:true, stayAwake:true });
      process.mainModule.require('node:fs').writeFileSync(output, image.toPNG());
    }, path.join(testDir, `update-prompt-${width}.png`));
  }
  await dismiss(page, '#update-cancel');
  const beforeReconnect = requests;
  await mainPage.evaluate(() => dispatchEvent(new Event('online')));
  await pause(1200);
  assert.ok(requests > beforeReconnect, 'Reconnection must check again');
  assert.equal(updaterWindows().length, 0, 'Cancel must prevent repeated prompts in this session');
  assert.deepEqual(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds()), mainBounds, 'Opening and dismissing the prompt must not resize the wallpaper');
  assert.equal(JSON.parse(fs.readFileSync(preferences)).updateReminderDate, undefined);
  await quit();
  await launch(); page = await prompt();
  await dismiss(page, '#update-remind-tomorrow');
  assert.equal(JSON.parse(fs.readFileSync(preferences)).updateReminderDate, today());
  await quit();
  const beforeMuted = requests;
  await launch();
  while (requests === beforeMuted) await pause(50);
  await pause(800);
  assert.equal(updaterWindows().length, 0, 'Today preference must survive restarting the app');
  assert.equal((await mainPage.evaluate(() => window.dayan.updateCheck())).available, true);
  page = await prompt();
  assert.ok(await page.locator('#update-notes').isVisible(), 'Manual checks must bypass today suppression');
  await desktop.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('updater=1')).webContents.send('dayan:update-available', { currentVersion:'1.6.20', version:'1.6.21', notes:'本地验收：仅检查按钮交互，主进程仍禁止模拟安装。', testOnly:false });
  });
  assert.equal(await page.locator('#update-confirm').innerText(), '现在更新');
  await page.locator('#update-confirm').click();
  await page.waitForSelector('#update-error:not([hidden])');
  assert.match(await page.locator('#update-error').innerText(), /测试/);
  assert.equal(await page.locator('#update-cancel').isEnabled(), true, 'Failed install must release dismissal controls');
  await dismiss(page, '#update-cancel');
  await quit();
  const saved = JSON.parse(fs.readFileSync(preferences));
  saved.updateReminderDate = '2000-01-01';
  fs.writeFileSync(preferences, JSON.stringify(saved));
  await launch(); page = await prompt();
  assert.match(await page.locator('#update-title').innerText(), /测试/);
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => !window.isVisible())), true, 'Test windows must never be shown on the real desktop');
  assert.deepEqual(errors, []);
  const report = { result:'passed', packaged:packed, requests, testDir, checks:['Startup checks only after renderer readiness', 'Transient startup failure retries automatically', 'Independent update prompt leaves wallpaper bounds unchanged', 'Three responsive actions at 320, 480 and 600 pixels', 'Cancel only suppresses the current session', 'Today suppression persists across restart while checks continue', 'Manual checks bypass today suppression', 'Installation failure re-enables actions', 'Expired daily preference prompts again', 'Fixture installation is blocked and all test windows remain hidden'], errors };
  fs.writeFileSync(path.join(testDir, 'validation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await quit(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
