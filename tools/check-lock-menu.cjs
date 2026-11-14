const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { _electron } = require(process.env.DAYAN_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..'), packaged = process.argv.includes('--packaged');
const data = fs.mkdtempSync('D:/Codex/Temp/dayan-lock-menu-'), errors = [], checks = [];
fs.writeFileSync(path.join(data, 'preferences.json'), JSON.stringify({ settingsGuideVersion: 1, autoStart: false }));
let app;
async function launch() {
  const env = { ...process.env, DAYAN_TEST: '1', DAYAN_TEST_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ executablePath: packaged ? path.join(process.env.DAYAN_RELEASE_DIR, 'win-unpacked/DAYANClock.exe') : require(path.join(root, 'node_modules/electron')), args: packaged ? [] : [root], env });
  app.on('window', page => page.on('pageerror', error => errors.push(error.message)));
  const page = await app.firstWindow(); await page.waitForSelector('html[data-ready=true]'); return page;
}
const native = code => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
};
async function menu(label, existing) {
  const pending = existing ? null : app.waitForEvent('window');
  await app.evaluate((_, label) => globalThis.__dayanTrayMenu.items.find(item => item.label === label).click(), label);
  const page = existing || await pending; await page.waitForSelector('html[data-ready=true]'); return page;
}
async function bounds(page) { return app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).getBounds(), await (await app.browserWindow(page)).evaluate(win => win.id)); }
async function drag(page, selector) {
  const win = await app.browserWindow(page), before = await bounds(page), box = await page.locator(selector).boundingBox();
  const scale = await app.evaluate(({ screen }, area) => screen.getDisplayMatching(area).scaleFactor, before);
  const point = await app.evaluate(({ screen }, point) => screen.dipToScreenPoint(point), { x: Math.round(before.x + box.x + 120), y: Math.round(before.y + box.y + 20) });
  const dx = Math.round(70 * scale), dy = Math.round(35 * scale);
  await win.evaluate(win => { win.show(); win.focus(); });
  native(`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class MenuDrag { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra); }'
[MenuDrag]::SetCursorPos(${point.x},${point.y}) | Out-Null
[MenuDrag]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 80
for ($step=1; $step -le 10; $step++) { [MenuDrag]::SetCursorPos(${point.x}+[int](${dx}*$step/10),${point.y}+[int](${dy}*$step/10)) | Out-Null; Start-Sleep -Milliseconds 15 }
[MenuDrag]::mouse_event(4,0,0,0,[UIntPtr]::Zero)`);
  const after = await bounds(page);
  assert.ok(after.x > before.x + 20 && after.y > before.y + 10, `Native drag failed: ${JSON.stringify({ before, after })}`);
  assert.equal(after.width, before.width); assert.equal(after.height, before.height);
  return after;
}
async function quit() { await app.evaluate(({ app }) => app.quit()); await app.close(); app = null; }
(async () => {
  let page = await launch();
  let editor = await menu('锁屏');
  await editor.waitForSelector('#lock-settings-modal:not([hidden])');
  assert.equal(await editor.locator('#lock-now').isDisabled(), true);
  await editor.locator('#lock-setup').click();
  await editor.waitForSelector('#security-modal:not([hidden])');
  await editor.locator('#new-password').fill('123456'); await editor.locator('#confirm-password').fill('123456');
  await editor.locator('#security-question').selectOption('teacher'); await editor.locator('#security-answer').fill('张老师'); await editor.locator('#security-answer-confirm').fill('张老师');
  await editor.locator('#security-form button[type=submit]').click();
  await editor.waitForSelector('#security-modal[hidden]', { state: 'attached' });
  assert.equal(await editor.locator('#lock-settings-modal').isVisible(), true);
  assert.equal(await editor.locator('#lock-now').isEnabled(), true);
  await drag(editor, '#lock-settings-title');
  checks.push('Tray lock entry, mandatory first password/recovery setup and native title-bar drag');
  await editor.locator('#lock-current-password').fill('wrong'); await editor.locator('#lock-new-password').fill('234567'); await editor.locator('#lock-confirm-password').fill('234567');
  await editor.locator('#lock-password-form button[type=submit]').click();
  await editor.waitForFunction(() => document.getElementById('lock-password-status').textContent.includes('不正确'));
  await editor.locator('#lock-current-password').fill('123456'); await editor.locator('#lock-password-form button[type=submit]').click();
  await editor.waitForFunction(() => document.getElementById('lock-password-status').textContent === '密码已更新。');
  assert.equal(editor.isClosed(), false);
  await editor.locator('[data-password-method=recovery]').click();
  await editor.locator('#lock-recovery-answer').fill('错误答案'); await editor.locator('#lock-new-password').fill('345678'); await editor.locator('#lock-confirm-password').fill('345678');
  await editor.locator('#lock-password-form button[type=submit]').click();
  await editor.waitForFunction(() => document.getElementById('lock-password-status').dataset.error === 'true');
  await editor.locator('#lock-recovery-answer').fill('张老师'); await editor.locator('#lock-password-form button[type=submit]').click();
  await editor.waitForFunction(() => document.getElementById('lock-password-status').textContent === '密码已更新。');
  const grant = await editor.evaluate(() => window.dayan.recoveryVerify({ question: 'teacher', answer: '张老师' }));
  assert.equal(grant.ok, true);
  assert.equal((await page.evaluate(token => window.dayan.recoveryReset({ token, next: '999999' }), grant.token)).ok, false);
  assert.equal((await editor.evaluate(token => window.dayan.recoveryReset({ token, next: '345678' }), grant.token)).ok, true);
  assert.equal((await editor.evaluate(token => window.dayan.recoveryReset({ token, next: '999999' }), grant.token)).ok, false);
  checks.push('Wrong password/answer denied, normal password change, recovery reset, sender binding and one-use grant');
  await editor.locator('#lock-shortcut').focus(); await editor.keyboard.press('Control+Alt+F12');
  await editor.locator('#lock-shortcut-form button[type=submit]').click();
  await editor.waitForFunction(() => document.getElementById('lock-shortcut-status').textContent.includes('下次启动'));
  assert.equal(await app.evaluate(({ globalShortcut }) => globalShortcut.register('Control+Alt+F11', () => {})), true);
  assert.equal((await editor.evaluate(() => window.dayan.setLockShortcut('Control+Alt+F11'))).ok, false);
  assert.equal((await editor.evaluate(() => window.dayan.load())).lockShortcut, 'Control+Alt+F12');
  await app.evaluate(({ globalShortcut }) => globalShortcut.unregister('Control+Alt+F11'));
  await editor.screenshot({ path: path.join(data, 'lock-settings.png') });
  const closed = editor.waitForEvent('close'); await editor.locator('#lock-settings-close').click(); await closed;
  for (const displayScope of ['current', 'all']) {
    await page.evaluate(displayScope => window.dayan.save({ windowLayers: { unlocked: 'bottom', locked: 'top', displayScope } }), displayScope);
    await page.evaluate(() => window.dayan.windowAction('fullscreen'));
    await page.waitForSelector('html[data-fullscreen=true][data-desktop-hosted=true]');
    const wallpaper = await bounds(page);
    editor = await menu('设置');
    const heights = [];
    for (const tab of ['policy', 'almanac', 'autostart', 'about', 'layers']) {
      await editor.locator(`[data-settings-tab=${tab}]`).click();
      const panel = await editor.locator('#settings-modal .settings-panel').boundingBox(); heights.push(panel.height);
      assert.equal(await editor.locator('#settings-modal .settings-body').evaluate(el => getComputedStyle(el).alignContent), 'start');
      await editor.screenshot({ path: path.join(data, `settings-${tab}-${displayScope}.png`) });
    }
    assert.equal(new Set(heights).size, 1);
    const moved = await drag(editor, '#settings-title');
    await menu('切换样式', editor);
    assert.deepEqual(await bounds(editor), moved);
    await drag(editor, '#editor-title');
    for (const style of [2, 3, 6]) {
      await editor.locator(`[data-style="${style}"]`).click(); await page.waitForFunction(style => document.documentElement.dataset.style === String(style), style);
      assert.equal(await editor.locator('#style-menu').isVisible(), true);
    }
    await editor.screenshot({ path: path.join(data, `styles-${displayScope}.png`) });
    await menu('切换背景', editor); await drag(editor, '#editor-title');
    for (const background of ['lunar', 'pelican-bike']) {
      const choice = editor.locator(`[data-variant]:not([hidden]) [data-background="${background}"]`);
      assert.equal(await choice.count(), 1);
      await choice.click(); await page.waitForFunction(background => document.querySelector(`[data-variant]:not([hidden]) [data-background="${background}"]`).getAttribute('aria-pressed') === 'true', background);
      assert.equal(await editor.locator('[data-variant]:not([hidden]) .background-picker').isVisible(), true);
    }
    await editor.screenshot({ path: path.join(data, `backgrounds-${displayScope}.png`) });
    assert.deepEqual(await bounds(page), wallpaper);
    const done = editor.waitForEvent('close'); await editor.locator('#editor-close').click(); await done;
    await app.evaluate(() => globalThis.__dayanTrayMenu.items.find(item => item.label === '最小化（回到窗口）').click()); await page.waitForSelector('html[data-fullscreen=false]');
    checks.push(`Equal settings page heights, native drag for all menu types, repeated live previews and fullscreen wallpaper preserved: ${displayScope}`);
  }
  editor = await menu('锁屏');
  const closing = editor.waitForEvent('close'); await editor.locator('#lock-now').click(); await closing;
  await page.waitForSelector('html.locked');
  assert.equal(await page.evaluate(() => window.dayan.securityVerify('234567')), false);
  assert.equal(await page.evaluate(() => window.dayan.securityVerify('345678')), true);
  await quit(); page = await launch();
  assert.equal((await page.evaluate(() => window.dayan.load())).lockShortcut, 'Control+Alt+F12');
  assert.equal(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Alt+F12')), true);
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.show(); win.focus(); });
  native(`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class LockHotkey { [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra); }'
foreach ($key in @(17,18,123)) { [LockHotkey]::keybd_event([byte]$key,0,0,[UIntPtr]::Zero) }
foreach ($key in @(123,18,17)) { [LockHotkey]::keybd_event([byte]$key,0,2,[UIntPtr]::Zero) }`);
  await page.waitForSelector('html.locked');
  assert.equal(await page.evaluate(() => window.dayan.securityVerify('345678')), true);
  assert.equal((await page.evaluate(() => window.dayan.setLockShortcut(''))).ok, true);
  assert.equal(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Alt+F12')), false);
  checks.push('Immediate lock, new-password unlock, shortcut persistence, native global hotkey lock and clear');
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(data, 'validation.json'), JSON.stringify({ result: 'passed', packaged, checks, errors }, null, 2));
  console.log(JSON.stringify({ result: 'passed', packaged, checks, data }));
})().catch(error => { console.error(error.stack); console.error(data); process.exitCode = 1; }).finally(async () => { if (app) await quit(); });
