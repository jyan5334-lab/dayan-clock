const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require(process.env.DAYAN_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const restoredProfile = process.argv.includes('--restored-profile');
const packaged = process.argv.includes('--packaged');
fs.mkdirSync(path.join(root, 'work'), { recursive: true });
const directory = fs.mkdtempSync(path.join(root, 'work/policy-ui-'));
const data = path.join(directory, 'data');
fs.mkdirSync(data);
fs.writeFileSync(path.join(data, 'preferences.json'), JSON.stringify({ settingsGuideVersion: 1, bounds: { x: 50, y: 50, width: 900, height: 640 } }));
if (restoredProfile) fs.copyFileSync(path.join(process.env.APPDATA, 'DAYAN桌面/policy-restoration.json'), path.join(data, 'policy-restoration.json'));
const env = { ...process.env, DAYAN_TEST: '1', DAYAN_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
let desktop;
(async () => {
  desktop = await _electron.launch({ executablePath: packaged ? path.join(root, 'release/win-unpacked/DAYANClock.exe') : require(path.join(root, 'node_modules/electron')), args: [...(packaged ? [] : [root]), '--dayan-update-recovery'], env });
  const page = await desktop.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('html[data-ready=true]');
  await page.locator('#settings-toggle').click();
  await page.waitForFunction(() => document.querySelector('#policy-status').dataset.state !== 'checking');
  if (restoredProfile) {
    const status = await page.evaluate(() => window.dayan.securityPolicyStatus());
    assert.equal(status.error, '', 'Real Windows status must be readable');
    assert.equal(status.canRestore, false);
    assert.equal(status.restored, true, 'Actual Windows values must match the restoration receipt');
    await page.locator('#policy-refresh').click();
    await page.waitForFunction(() => document.querySelector('#policy-status').dataset.state === 'restored');
    assert.equal(await page.locator('#policy-enable span').innerText(), '重新授权');
    assert.equal(await page.locator('#policy-enable').isEnabled(), true);
    assert.equal(await page.locator('#policy-restore').isDisabled(), true);
    assert.equal(await page.locator('[data-policy]').filter({ hasText: '已恢复（未限制）' }).count(), 5);
    await page.screenshot({ path: path.join(directory, 'actual-restored-settings.png') });
  } else {
    const names = ['DisableTaskMgr', 'DisableLockWorkstation', 'DisableChangePassword', 'NoWinKeys', 'NoLogoff'];
    const configured = { supported: true, enabled: true, canRestore: true, restored: false, error: '', productName: 'Windows 11', architecture: 'x64', appVersion: 'fixture', policies: names.map(name => ({ name, enabled: true, exists: true, value: 1 })) };
    const restored = { ...configured, enabled: false, canRestore: false, restored: true, policies: names.map(name => ({ name, enabled: false, exists: false, value: null })) };
    const setReplies = async (status, restore) => desktop.evaluate(({ ipcMain }, replies) => {
      for (const [name, reply] of Object.entries(replies)) { ipcMain.removeHandler(name); ipcMain.handle(name, () => reply); }
    }, { 'dayan:security-policy-status': status, 'dayan:security-policy-restore': restore });
    await setReplies(configured, { ok: false, status: configured, error: 'Simulated access denied; backup retained' });
    await page.locator('#policy-refresh').click();
    await page.waitForFunction(() => document.querySelector('#policy-status').dataset.state === 'partial');
    assert.equal(await page.locator('#policy-restore').isEnabled(), true);
    await page.locator('#policy-restore').click();
    await page.waitForFunction(() => document.querySelector('#policy-error').textContent.includes('Simulated access denied'));
    assert.equal(await page.locator('#policy-status').innerText(), '基础策略已配置');
    assert.equal(await page.locator('#policy-restore').isEnabled(), true);
    await setReplies(restored, { ok: true, status: restored, notice: '恢复成功：已逐项核对授权前的原始策略。' });
    await page.locator('#policy-restore').click();
    await page.waitForFunction(() => document.querySelector('#policy-status').dataset.state === 'restored');
    assert.equal(await page.locator('#policy-enable span').innerText(), '重新授权');
    assert.equal(await page.locator('#policy-enable').isEnabled(), true);
    assert.equal(await page.locator('#policy-restore').isDisabled(), true);
    assert.match(await page.locator('#policy-operation-notice').innerText(), /恢复成功/);
    assert.equal(await page.locator('[data-policy]').filter({ hasText: '已恢复（未限制）' }).count(), 5);
    await page.locator('#policy-refresh').click();
    await page.waitForFunction(() => document.querySelector('#policy-status').dataset.state === 'restored');
    await page.screenshot({ path: path.join(directory, 'fixture-restored-settings.png') });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'passed', mode: restoredProfile ? 'real Windows registry readback, isolated app profile' : 'fixture UI success and failure', packaged, directory }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await desktop?.close(); });
