const path = require('node:path');
const { spawn } = require('node:child_process');

let queue = Promise.resolve();
function configureWindowsStartup(executable, enabled) {
  queue = queue.catch(() => {}).then(() => new Promise(resolve => {
    const child = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, '../scripts/configure-startup.ps1').replace('app.asar', 'app.asar.unpacked'),
      '-Executable', executable, '-Action', enabled ? 'enable' : 'disable'
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timeout = setTimeout(() => { child.kill(); resolve({ ok: false, error: 'Startup configuration timed out' }); }, 12000);
    child.stdout.on('data', value => { output += value; });
    child.stderr.resume();
    child.once('error', error => { clearTimeout(timeout); resolve({ ok: false, error: error.message }); });
    child.once('exit', () => {
      clearTimeout(timeout);
      try { resolve(JSON.parse(output)); } catch { resolve({ ok: false, error: 'Invalid startup configuration response' }); }
    });
  }));
  return queue;
}
module.exports = { configureWindowsStartup };
