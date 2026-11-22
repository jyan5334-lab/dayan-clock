const workspacePaths = require('./workspace-paths.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { _electron } = require(process.env.DAYAN_PLAYWRIGHT_MODULE || 'playwright');
const { saveUpdateSession } = require('../desktop/update-session.cjs');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(workspacePaths.temp(), { recursive:true });
const output = fs.mkdtempSync(workspacePaths.temp('dayan-update-automatic-'));
const bytes = crypto.randomBytes(3 * 1024 * 1024 + 17);
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
let origin, desktop, desktopChild, broken = false, data;
const checks = [];
const server = http.createServer((req, res) => {
  if (req.url === '/manifest') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ version:'9.9.9', sha256:broken ? '0'.repeat(64) : sha256, size:bytes.length, downloadUrl:origin + '/file', notes:'Isolated automatic update test' }));
  }
  const range = req.headers.range?.match(/^bytes=(\d+)-(\d+)$/);
  const start = range ? Number(range[1]) : 0, end = range ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
  const headers = { 'Content-Length':end - start + 1, 'Accept-Ranges':'bytes' };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${bytes.length}`;
  res.writeHead(range ? 206 : 200, headers);
  res.end(bytes.subarray(start, end + 1));
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, label) {
  const end = Date.now() + 20000;
  while (Date.now() < end) { if (predicate()) return; await pause(50); }
  throw Error(label);
}
async function close() {
  if (!desktop) return;
  const running = desktop; desktop = null;
  const child = desktopChild;
  if (child.exitCode !== null) return;
  await running.evaluate(({ app }) => app.quit()).catch(() => {});
  await running.close().catch(() => child.kill());
  if (child.exitCode === null) child.kill();
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  for (const scenario of ['fullscreen', 'locked', 'handoff-lock', 'bad-hash', 'helper-failed']) {
    broken = scenario === 'bad-hash';
    data = path.join(output, scenario); fs.mkdirSync(data);
    fs.writeFileSync(path.join(data, 'preferences.json'), JSON.stringify({ settingsGuideVersion:1, autoStart:false, style:1, windowLayers:{ unlocked:'top', locked:'top', displayScope:'all' } }));
    if (scenario === 'fullscreen') saveUpdateSession(data, { fullscreen:true, displayScope:'all', version:require('../package.json').version });
    const bootstrap = path.join(data, 'bootstrap.cjs');
    // Only this unshipped harness replaces admission and the installer. The real
    // renderer, scheduling, downloader, hashes, session writes and quit path run.
    fs.writeFileSync(bootstrap, `
const fs = require('node:fs'), path = require('node:path');
const {app, powerMonitor} = require('electron');
const root = ${JSON.stringify(root)}, data = ${JSON.stringify(data)};
app.setPath('userData', data);
app.getVersion = () => ${JSON.stringify(require('../package.json').version)};
Object.defineProperty(app, 'isPackaged', {value:true});
require(path.join(root,'desktop/update-mode.cjs')).resolveUpdateMode = () => ({test:false, fixtureUrl:'', hideWindow:false});
require(path.join(root,'desktop/update-install.cjs')).prepareUpdateInstall = async options => {
  fs.writeFileSync(path.join(data,'handoff.json'), JSON.stringify(options));
  if (${JSON.stringify(scenario)} === 'helper-failed') throw Error('Isolated helper failure');
  if (${JSON.stringify(scenario)} === 'handoff-lock' && !fs.existsSync(path.join(data,'cancelled'))) powerMonitor.emit('lock-screen');
  return {cancel:() => fs.writeFileSync(path.join(data,'cancelled'), '')};
};
app.on('browser-window-created', (_,win) => {
  win.on('show', () => fs.appendFileSync(path.join(data,'shows.jsonl'), JSON.stringify({bounds:win.getBounds(), url:win.webContents.getURL()})+'\\n'));
  win.webContents.on('did-finish-load', () => {
    if (win.webContents.getURL().includes('updater=1')) fs.writeFileSync(path.join(data,'unexpected-prompt'), '');
  });
});
if (${JSON.stringify(scenario)} === 'locked') app.on('browser-window-created', () => powerMonitor.emit('lock-screen'));
require(path.join(root,'desktop/main.cjs'));
`);
    const env = { ...process.env, DAYAN_TEST:'1', DAYAN_TEST_DATA:data, DAYAN_UPDATE_MANIFEST_URL:origin + '/manifest' }; delete env.ELECTRON_RUN_AS_NODE;
    desktop = await _electron.launch({ executablePath:require(path.join(root,'node_modules/electron')), args:[bootstrap, ...(scenario === 'fullscreen' ? ['--updated'] : [])], env });
    desktopChild = desktop.process();
    desktopChild.stderr.on('data', chunk => fs.appendFileSync(path.join(data, 'app.log'), chunk));
    if (scenario === 'locked' || scenario === 'handoff-lock') {
      await waitFor(() => scenario === 'handoff-lock' ? fs.existsSync(path.join(data,'cancelled')) : fs.existsSync(path.join(data,'updates/background.log')) && fs.readFileSync(path.join(data,'updates/background.log'),'utf8').includes('deferred'), 'Locked download must defer');
      if (scenario === 'locked') assert.equal(fs.existsSync(path.join(data,'handoff.json')), false);
      else {
        assert.equal(fs.existsSync(path.join(data,'cancelled')), true);
        assert.equal(fs.existsSync(path.join(data,'updates/resume.json')), false);
        assert.equal(desktopChild.exitCode, null);
      }
      await desktop.evaluate(({powerMonitor}) => powerMonitor.emit('unlock-screen'));
    }
    if (scenario === 'bad-hash') {
      await waitFor(() => fs.existsSync(path.join(data,'updates/background.log')) && fs.readFileSync(path.join(data,'updates/background.log'),'utf8').includes('failed'), 'Hash mismatch must fail');
      assert.equal(fs.existsSync(path.join(data,'handoff.json')), false);
      assert.equal(desktopChild.exitCode, null);
    } else {
      await waitFor(() => fs.existsSync(path.join(data,'handoff.json')), 'Automatic check must download and prepare install without a user click');
      const handoff = JSON.parse(fs.readFileSync(path.join(data,'handoff.json')));
      assert.equal(handoff.silent, true); assert.equal(handoff.notifyOnFailure, false);
      if (scenario === 'helper-failed') {
        await waitFor(() => !fs.existsSync(path.join(data,'updates/resume.json')), 'Failed helper clears checkpoint');
        assert.equal(desktopChild.exitCode, null);
      } else {
        await waitFor(() => desktopChild.exitCode !== null, 'Prepared install must quit the old process');
        const session = JSON.parse(fs.readFileSync(path.join(data,'updates/resume.json')));
        assert.equal(session.fullscreen, scenario === 'fullscreen');
        assert.equal(session.displayScope, 'all');
        const persisted = JSON.parse(fs.readFileSync(path.join(data,'preferences.json')));
        assert.equal(persisted.style, 1);
        if (scenario === 'fullscreen') {
          const shows = fs.readFileSync(path.join(data,'shows.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
          assert.ok(shows.length > 0);
          for (const show of shows) assert.ok(show.bounds.width >= 1000 && show.bounds.height >= 1000, 'First shown frame must already be fullscreen');
        }
      }
    }
    assert.equal(fs.existsSync(path.join(data,'unexpected-prompt')), false);
    checks.push(scenario);
    await close();
  }
  const report = {result:'passed', fixtureInstaller:true, output, checks};
  fs.writeFileSync(path.join(output,'validation.json'), JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
})().catch(error => { console.error(error); process.exitCode=1; }).finally(async () => { await close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
