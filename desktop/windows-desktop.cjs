const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

function createDesktopHost(userData) {
  const contents = fs.readFileSync(path.join(__dirname, '../assets/DAYANDesktopHost.exe'));
  const hash = crypto.createHash('sha256').update(contents).digest('hex').slice(0, 16);
  const directory = path.join(userData, 'native');
  fs.mkdirSync(directory, { recursive: true });
  const executable = path.join(directory, `desktop-host-${hash}.exe`);
  if (!fs.existsSync(executable)) fs.writeFileSync(executable, contents);
  const run = args => new Promise((resolve, reject) => {
    const child = spawn(executable, args.map(String), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '';
    const timeout = setTimeout(() => { child.kill(); reject(Error('Desktop host did not respond.')); }, 5000);
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('exit', code => {
      clearTimeout(timeout);
      let result;
      try { result = JSON.parse(output); } catch { reject(Error(errors || `Desktop host exited (${code}).`)); return; }
      result.ok && code === 0 ? resolve(result) : reject(Error(result.error || errors));
    });
  });
  let snapshot;
  const identity = window => {
    const handle = window.getNativeWindowHandle();
    return [handle.length >= 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE()), process.pid];
  };
  return {
    run,
    async attach(window, bounds) {
      if (snapshot) return run(['resize', ...identity(window), bounds.x, bounds.y, bounds.width, bounds.height, snapshot.parent]);
      const original = await run(['snapshot', ...identity(window)]);
      window.setIgnoreMouseEvents(true, { forward: true });
      try {
        const attached = await run(['attach', ...identity(window), bounds.x, bounds.y, bounds.width, bounds.height]);
        snapshot = { ...attached, originalStyle: original.originalStyle, originalExtendedStyle: original.originalExtendedStyle };
      }
      catch (error) { window.setIgnoreMouseEvents(false); throw error; }
      return snapshot;
    },
    async detach(window) {
      window.setIgnoreMouseEvents(false);
      if (!snapshot) return;
      const result = await run(['detach', ...identity(window), snapshot.originalStyle, snapshot.originalExtendedStyle]);
      snapshot = null;
      return result;
    }
  };
}
module.exports = { createDesktopHost };
