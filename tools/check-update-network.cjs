const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { _electron } = require(process.env.DAYAN_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const testDir = process.env.DAYAN_NETWORK_TEST_DIR || fs.mkdtempSync(path.join(root, 'work/network-'));
const packed = process.argv.includes('--packaged');
const live = process.argv.includes('--live');
const payload = crypto.randomBytes(8 * 1024 * 1024 + 17);
let origin, desktop;
const hash = crypto.createHash('sha256').update(payload).digest('hex');
const server = http.createServer((req, res) => {
  if (req.url === '/redirect') { res.writeHead(302, { Location: `${origin}/file` }); return res.end(); }
  if (req.url === '/manifest') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ version: '9.9.9', sha256: hash, size: payload.length, downloadUrl: `${origin}/file` })); }
  const match = req.headers.range?.match(/^bytes=(\d+)-(\d+)$/);
  if (match) {
    const start = Number(match[1]), end = Number(match[2]);
    res.writeHead(206, { 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${payload.length}` });
    return res.end(payload.subarray(start, end + 1));
  }
  res.writeHead(200, { 'Content-Length': payload.length }); res.end(payload);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env, DAYAN_TEST: '1', DAYAN_TEST_DATA: path.join(testDir, 'data'), DAYAN_TEST_UPDATE_URL: `${origin}/manifest` };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await _electron.launch({ executablePath: packed ? path.join(root, 'release/win-unpacked/DAYANClock.exe') : require(path.join(root, 'node_modules/electron')), args: [...(packed ? [] : [root]), '--dayan-test-updates'], env });
  desktop.process().stderr.on('data', chunk => fs.appendFileSync(path.join(testDir, 'app.log'), chunk));
  const page = await desktop.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('#update-modal:not([hidden])');
  assert.match(await page.locator('#update-version').innerText(), /9\.9\.9/);
  assert.match(await page.locator('#update-title').innerText(), /测试/);
  assert.equal(await page.locator('#update-confirm').isDisabled(), true);
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => !window.isVisible())), true, 'Fixture window must remain hidden');
  const install = await page.evaluate(() => window.dayan.updateInstall());
  assert.equal(install.ok, false); assert.match(install.error, /测试/);
  const result = await desktop.evaluate(async ({ app, session }, args) => {
    const path = process.mainModule.require('node:path');
    const fs = process.mainModule.require('node:fs');
    const { downloadUpdate } = process.mainModule.require(path.join(app.getAppPath(), 'desktop/update-download.cjs'));
    const { networkFetch, downloadTransports } = process.mainModule.require(path.join(app.getAppPath(), 'desktop/update-network.cjs'));
    const netSession = session.fromPartition('dayan-updater', { cache: false });
    let update = { version: '9.9.9', sha256: args.hash, size: args.size }, urls = [`${args.origin}/file`];
    if (args.live) {
      const response = await networkFetch('https://api.github.com/repos/jyan5334-lab/dayan-clock/releases/latest', { headers: { 'User-Agent': 'DAYANClock-Updater' }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error(`GitHub live check HTTP ${response.status}`);
      const release = await response.json();
      const asset = release.assets.find(item => /^DAYANClock-Setup-.*-x64\.exe$/.test(item.name));
      update = { version: release.tag_name, sha256: asset.digest.replace(/^sha256:/, ''), size: asset.size };
      urls = [asset.url, asset.browser_download_url];
    }
    const started = Date.now();
    let lastLog = 0;
    const downloaded = await downloadUpdate({ update, installerPath: path.join(args.testDir, 'checked-download.exe'), urls, fetch: networkFetch, transports: downloadTransports,
      onDiagnostic: record => fs.appendFileSync(path.join(args.testDir, 'network-trace.jsonl'), JSON.stringify(record) + '\n'),
      onProgress: progress => { if (Date.now() - lastLog > 5000) { lastLog = Date.now(); fs.appendFileSync(path.join(args.testDir, 'network-trace.jsonl'), JSON.stringify({ phase: 'progress', at: new Date().toISOString(), bytes: progress.received, total: progress.total, transport: progress.transport }) + '\n'); } } });
    let systemTransportHash;
    if (!args.live) {
      const systemTransport = downloadTransports.find(item => item.name === 'system');
      const metadata = await systemTransport.fetch(`${args.origin}/manifest`, { signal: AbortSignal.timeout(8000) });
      if ((await metadata.json()).sha256 !== args.hash) throw Error('Chromium metadata digest mismatch');
      const systemDownload = await downloadUpdate({ update, installerPath: path.join(args.testDir, 'system-download.exe'), urls: [`${args.origin}/redirect`], fetch: systemTransport.fetch, transports: [systemTransport] });
      systemTransportHash = systemDownload.actualHash;
    }
    return { ...downloaded, systemTransportHash, seconds: (Date.now() - started) / 1000, live: args.live, version: update.version };
  }, { origin, hash, size: payload.length, testDir, live });
  assert.equal(result.actualHash.length, 64);
  if (!live) { assert.equal(result.actualHash, hash); assert.equal(result.systemTransportHash, hash); }
  // Inspect compatibility without changing user policies or launching UAC.
  const status = await page.evaluate(() => window.dayan.securityPolicyStatus());
  assert.equal(status.error, ''); assert.equal(status.policies.length, 6);
  assert.equal(typeof status.fullProtectionSupported, 'boolean');
  if (status.editionId === 'Professional') assert.equal(status.fullProtectionSupported, false);
  await page.evaluate(() => { document.getElementById('update-modal').hidden = true; });
  if (await page.locator('#settings-modal').getAttribute('hidden') !== null) await page.locator('#settings-toggle').click();
  await page.waitForFunction(() => document.getElementById('policy-status').dataset.state !== 'checking');
  for (const width of [480, 800]) {
    await desktop.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setBounds({ width, height: Math.round(width * 568 / 800) }), width);
    await page.waitForTimeout(150);
    const body = await page.locator('.settings-body').boundingBox();
    await page.screenshot({ path: path.join(testDir, `settings-${width}.png`) });
    assert.ok(body.height >= 75, `Settings body is too small to inspect authorization status: ${body.height}px at ${width}px`);
  }
  assert.deepEqual(errors, []);
  const report = { result: 'passed', packaged: packed, network: result, system: { productName: status.productName, editionId: status.editionId, fullProtectionSupported: status.fullProtectionSupported, keyboardFilterEnabled: status.keyboardFilterEnabled }, checks: ['Fixture window remains hidden and its update is visibly marked as a test', 'Renderer button and main-process IPC both reject installing a fixture update', 'Update manifest works through isolated Chromium session despite renderer network restrictions', 'Full download passes SHA-256 in real Electron network stack', 'Windows edition and six protection status rows returned without elevation'], errors };
  fs.writeFileSync(path.join(testDir, 'validation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, testDir }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (desktop) {
    const child = desktop.process();
    await desktop.evaluate(({ app }) => app.quit()).catch(() => {});
    await desktop.close().catch(() => { child.kill(); });
    if (child.exitCode === null) child.kill();
  }
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
});
