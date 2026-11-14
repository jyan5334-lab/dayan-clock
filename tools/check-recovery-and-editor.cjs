const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { _electron } = require(process.env.DAYAN_PLAYWRIGHT_MODULE || 'playwright');
const recovery = require('../desktop/password-recovery.cjs');
const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const data = fs.mkdtempSync('D:/Codex/Temp/dayan-recovery-editor-');
const preferences = path.join(data, 'preferences.json');
fs.writeFileSync(preferences, JSON.stringify({ settingsGuideVersion: 1, autoStart: false }));
let desktop;
const errors = [], checks = [];
async function launch() {
  const env = { ...process.env, DAYAN_TEST: '1', DAYAN_TEST_DATA: data };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await _electron.launch({ executablePath: packaged ? path.join(process.env.DAYAN_RELEASE_DIR, 'win-unpacked/DAYANClock.exe') : require(path.join(root, 'node_modules/electron')), args: packaged ? [] : [root], env });
  desktop.on('window', page => page.on('pageerror', error => errors.push(error.message)));
  desktop.process().stderr.on('data', bytes => fs.appendFileSync(path.join(data, 'stderr.log'), bytes));
  const page = await desktop.firstWindow();
  await page.waitForSelector('html[data-ready=true]');
  return page;
}
async function quit() { await desktop.evaluate(({ app }) => app.quit()); await desktop.close(); desktop = null; }
async function tray(label) { await desktop.evaluate((_, label) => globalThis.__dayanTrayMenu.items.find(item => item.label === label).click(), label); }
async function geometry() {
  return desktop.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(win => !win.webContents.getURL().includes('editor='));
    return { bounds: win.getBounds(), content: win.getContentBounds(), hwnd: win.getNativeWindowHandle().readBigUInt64LE().toString() };
  });
}
function native(handle) {
  const result = spawnSync(path.join(root, 'assets/DAYANDesktopHost.exe'), ['inspect'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0);
  const win = JSON.parse(result.stdout).windows.find(win => win.handle === handle);
  return win ? { parent: win.parent, client: win.client } : null;
}
async function editor(label) {
  const opened = desktop.waitForEvent('window');
  await tray(label);
  const page = await opened;
  await page.waitForSelector('html[data-ready=true]');
  return page;
}
(async () => {
  const record = recovery.create('teacher', '张老师');
  assert.ok(!JSON.stringify(record).includes('张老师'));
  assert.equal(recovery.verify(record, ' 张老师 ').ok, true);
  for (let i = 0; i < 5; i++) assert.equal(recovery.verify(record, 'wrong', 100).ok, false);
  assert.equal(recovery.verify(record, '张老师', 101).ok, false);
  assert.equal(recovery.verify(record, '张老师', 30101).ok, true);
  assert.throws(() => recovery.create('unknown', 'answer'));
  checks.push('Salted answer hash, Unicode normalization, question validation and retry cooldown');
  let page = await launch();
  assert.equal((await page.evaluate(() => window.dayan.securitySetPassword({ next: '123456' }))).ok, false);
  await page.locator('#lock').click();
  await page.locator('#new-password').fill('123456');
  await page.locator('#confirm-password').fill('123456');
  await page.locator('#security-question').selectOption('teacher');
  await page.locator('#security-answer').fill('张老师');
  await page.locator('#security-answer-confirm').fill('张老师');
  await page.screenshot({ path: path.join(data, 'password-setup.png') });
  await page.locator('#security-form button[type=submit]').click();
  await page.waitForSelector('#security-modal[hidden]', { state: 'attached' });
  assert.equal((await page.evaluate(() => window.dayan.load())).recoveryConfigured, true);
  assert.ok(!fs.readFileSync(preferences, 'utf8').includes('张老师'));
  await quit(); page = await launch();
  assert.equal((await page.evaluate(() => window.dayan.load())).recoveryConfigured, true);
  await page.locator('#lock').click();
  await page.waitForSelector('html.locked');
  await page.locator('[data-variant]:not([hidden]) .unlock-launch').click();
  await page.locator('#forgot-password').click();
  await page.locator('#recovery-answer').fill('wrong');
  await page.locator('#recovery-form button[type=submit]').click();
  await page.waitForFunction(() => document.getElementById('unlock-error').textContent.includes('不正确'));
  assert.equal((await page.evaluate(() => window.dayan.load())).locked, true);
  assert.equal((await page.evaluate(() => window.dayan.recoveryReset({ token: 'forged', next: '654321' }))).ok, false);
  await page.locator('#recovery-answer').fill('张老师');
  await page.screenshot({ path: path.join(data, 'recovery-verify.png') });
  await page.locator('#recovery-form button[type=submit]').click();
  await page.waitForSelector('#recovery-reset-form:not([hidden])');
  assert.equal((await page.evaluate(() => window.dayan.load())).locked, true);
  await page.locator('#recovery-new-password').fill('654321');
  await page.locator('#recovery-confirm-password').fill('654321');
  await page.locator('#recovery-reset-form button[type=submit]').click();
  await page.waitForSelector('html:not(.locked)');
  await quit(); page = await launch();
  assert.equal(await page.evaluate(() => window.dayan.securityLock()), true);
  assert.equal(await page.evaluate(() => window.dayan.securityVerify('123456')), false);
  assert.equal(await page.evaluate(() => window.dayan.securityVerify('654321')), true);
  checks.push('Mandatory initial recovery setup, actual locked UI validation/reset, old password rejected, new password retained after restart');
  for (const displayScope of ['current', 'all']) {
    await page.evaluate(displayScope => window.dayan.save({ windowLayers: { unlocked: 'bottom', locked: 'top', displayScope } }), displayScope);
    await page.evaluate(() => window.dayan.windowAction('fullscreen'));
    await page.waitForSelector('html[data-desktop-hosted=true][data-fullscreen=true]');
    const before = await geometry(), nativeBefore = native(before.hwnd);
    assert.ok(nativeBefore);
    let menu = await editor('设置');
    await menu.waitForSelector('#settings-modal:not([hidden])');
    await menu.locator('[data-settings-tab=almanac]').click();
    await menu.locator('#show-clock-date').uncheck();
    await page.waitForFunction(() => window.dayanDisplaySettings.showClockDate === false);
    await menu.screenshot({ path: path.join(data, `fullscreen-settings-${displayScope}.png`) });
    assert.deepEqual(await geometry(), before);
    assert.deepEqual(native(before.hwnd), nativeBefore);
    const closed = menu.waitForEvent('close');
    await menu.locator('#settings-close').click();
    await closed;
    menu = await editor('切换样式');
    await menu.waitForSelector('#style-menu:not([hidden])', { timeout: 5000 });
    const styleClosed = menu.waitForEvent('close');
    await menu.locator('#style-menu [data-style="2"]').click();
    await styleClosed;
    await page.waitForFunction(() => document.documentElement.dataset.style === '2');
    assert.deepEqual(await geometry(), before);
    assert.deepEqual(native(before.hwnd), nativeBefore);
    menu = await editor('切换背景');
    await menu.waitForSelector('[data-variant]:not([hidden]) .background-picker:not([hidden])');
    const backgroundClosed = menu.waitForEvent('close');
    await menu.locator('[data-variant]:not([hidden]) [data-background=lunar]').click();
    await backgroundClosed;
    await page.waitForFunction(() => document.querySelector('[data-variant]:not([hidden]) [data-background=lunar]').getAttribute('aria-pressed') === 'true');
    assert.deepEqual(await geometry(), before);
    assert.deepEqual(native(before.hwnd), nativeBefore);
    assert.equal(await page.locator('html').getAttribute('data-fullscreen'), 'true');
    checks.push(`Fullscreen tray settings/style/background preserve native wallpaper bounds and parent: ${displayScope}`);
    await tray('最小化（回到窗口）');
    await page.waitForSelector('html[data-fullscreen=false]');
    await page.evaluate(() => { const box = document.getElementById('show-clock-date'); if (!box.checked) box.click(); });
  }
  await quit();
  // Simulate an existing installation with a password and no recovery record.
  const old = JSON.parse(fs.readFileSync(preferences)), salt = crypto.randomBytes(16).toString('hex');
  old.security = { salt, hash: crypto.pbkdf2Sync('112233', Buffer.from(salt, 'hex'), 210000, 32, 'sha256').toString('hex'), iterations: 210000 };
  fs.writeFileSync(preferences, JSON.stringify(old));
  page = await launch();
  await page.locator('#lock').click();
  await page.waitForSelector('#security-modal:not([hidden])');
  assert.equal((await page.evaluate(() => window.dayan.load())).locked, false);
  assert.equal((await page.evaluate(() => window.dayan.securitySetPassword({ current: 'wrong', next: '112233', recovery: { question: 'phone', answer: '12345678901' } }))).ok, false);
  assert.equal((await page.evaluate(() => window.dayan.securitySetPassword({ current: '112233', next: '112233', recovery: { question: 'phone', answer: '12345678901' } }))).ok, true);
  checks.push('Existing password is preserved; missing recovery requires current password before adding a question');
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(data, 'validation.json'), JSON.stringify({ result: 'passed', packaged, checks, errors }, null, 2));
  console.log(JSON.stringify({ result: 'passed', packaged, checks, data }));
})().catch(async error => { console.error(error.stack); if (desktop) for (const [index, page] of desktop.windows().entries()) { await page.screenshot({ path: path.join(data, `failure-${index}.png`) }).catch(() => {}); console.error(await page.evaluate(() => ({ url: location.href, html: document.documentElement.outerHTML.slice(0, 300), menuHidden: document.getElementById('style-menu').hidden, menuStyle: getComputedStyle(document.getElementById('style-menu')).cssText, menuBox: document.getElementById('style-menu').getBoundingClientRect().toJSON() }))); } console.error(data); process.exitCode = 1; }).finally(async () => { if (desktop) await desktop.close(); });
