const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { prepareUpdateInstall } = require('../desktop/update-install.cjs');

if (process.platform !== 'win32') throw Error('This handoff regression requires Windows.');
require('../desktop/build-update-host.cjs').buildUpdateHost();
const root = fs.mkdtempSync(path.join(os.tmpdir(), "dayan update ' 中文-"));
const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const source = `using System;
using System.IO;
using System.Diagnostics;
using System.Threading;
using System.Reflection;
[assembly: AssemblyFileVersion("9.9.9.0")]
public static class Fixture {
  public static int Main(string[] args) {
    string exe = Assembly.GetExecutingAssembly().Location;
    string dir = Path.GetDirectoryName(exe);
    if (Environment.GetEnvironmentVariable("ELECTRON_RUN_AS_NODE") == "1") return 8;
    if (Path.GetFileName(exe).StartsWith("Setup")) {
      string line = Environment.CommandLine;
      File.WriteAllText(Path.Combine(dir, "installer-args.txt"), line);
      if (File.Exists(Path.Combine(dir, "fail"))) return 7;
      string target = line.Substring(line.IndexOf("/D=") + 3).Trim();
      File.Copy(Path.Combine(dir, "payload.exe"), Path.Combine(target, "DAYANClock.exe"), true);
      return 0;
    }
    string marker = Array.IndexOf(args, "--dayan-update-recovery") >= 0 ? "recovery.txt" : "restarted.txt";
    File.WriteAllText(Path.Combine(dir, marker), Process.GetCurrentProcess().Id.ToString());
    Thread.Sleep(15000);
    return 0;
  }
}`;
const sourcePath = path.join(root, 'Fixture.cs');
const payload = path.join(root, 'payload.exe');
fs.writeFileSync(sourcePath, source);
const compile = `Add-Type -Path ${quote(sourcePath)} -OutputAssembly ${quote(payload)} -OutputType ConsoleApplication`;
const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(compile, 'utf16le').toString('base64')], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
assert.equal(result.status, 0, result.stderr);

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitFor(predicate, message) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(100);
  }
  throw Error(message);
}
function readStatus(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return {}; }
}
const checks = [];
async function scenario(name, { missing = false, failed = false, version = '9.9.9', ownerExit = false } = {}) {
  const folder = path.join(root, name);
  const installDir = path.join(folder, "installed app ' 中文");
  fs.mkdirSync(installDir, { recursive: true });
  const appPath = path.join(installDir, 'DAYANClock.exe');
  const installerPath = path.join(folder, 'Setup.exe');
  fs.copyFileSync(payload, appPath);
  fs.copyFileSync(payload, path.join(folder, 'payload.exe'));
  if (!missing) fs.copyFileSync(payload, installerPath);
  if (failed) fs.writeFileSync(path.join(folder, 'fail'), '1');
  const baseOptions = { installerPath, appPath, version, userData: folder, silent: true, notifyOnFailure: false };
  const handoffPath = path.join(folder, 'handoff.json');
  const ownerScript = 'const fs = require("fs"); require(process.argv[1]).prepareUpdateInstall(JSON.parse(process.argv[2])).then(job => fs.writeFileSync(process.argv[3], JSON.stringify(job))).catch(() => process.exitCode = 1);';
  const parent = spawn(process.execPath, ownerExit ? ['-e', ownerScript, require.resolve('../desktop/update-install.cjs'), JSON.stringify(baseOptions), handoffPath] : ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' });
  try {
    const options = { ...baseOptions, parentPid: parent.pid };
    if (missing) {
      await assert.rejects(prepareUpdateInstall(options), /missing|提前退出/);
      assert.equal(parent.exitCode, null, 'Failed preparation must not stop the app');
      checks.push('Missing installer rejects before application exit');
      return;
    }
    let job;
    if (ownerExit) {
      await waitFor(() => parent.exitCode !== null, 'The helper kept its owner process running');
      assert.equal(parent.exitCode, 0);
      job = JSON.parse(fs.readFileSync(handoffPath, 'utf8'));
    } else {
      job = await prepareUpdateInstall(options);
      assert.equal(readStatus(job.statusPath).stage, 'ready');
      assert.equal(fs.existsSync(path.join(folder, 'installer-args.txt')), false, 'Installer must wait for parent exit');
      parent.kill();
    }
    await waitFor(() => ['completed', 'failed'].includes(readStatus(job.statusPath).stage), `${name}: handoff did not finish`);
    const status = readStatus(job.statusPath);
    assert.equal(status.stage, failed || version !== '9.9.9' ? 'failed' : 'completed', JSON.stringify(status));
    const args = fs.readFileSync(path.join(folder, 'installer-args.txt'), 'utf8');
    assert.ok(args.includes('--updated /S /D=' + installDir), 'Install directory must survive spaces, apostrophes and Chinese');
    const marker = path.join(installDir, status.stage === 'failed' ? 'recovery.txt' : 'restarted.txt');
    await waitFor(() => fs.existsSync(marker), `${name}: application did not restart`);
    assert.ok(fs.existsSync(installerPath), 'Installer must be retained for recovery');
    assert.ok(fs.statSync(path.join(job.jobDir, 'install.log')).size > 0);
    checks.push(name + ': ' + status.stage + ', restart confirmed, installer retained');
  } finally {
    parent.kill();
    for (const marker of ['restarted.txt', 'recovery.txt']) {
      const file = path.join(installDir, marker);
      if (fs.existsSync(file)) { try { process.kill(Number(fs.readFileSync(file, 'utf8'))); } catch {} }
    }
  }
}
(async () => {
  await scenario('success');
  await scenario('owner-exits-naturally', { ownerExit: true });
  await scenario('installer-failed', { failed: true });
  await scenario('version-mismatch', { version: '9.9.8' });
  await scenario('missing-installer', { missing: true });
  console.log(JSON.stringify({ result: 'passed', fixtureOnly: true, root, checks }, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
