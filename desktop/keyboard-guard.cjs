const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');

function createKeyboardGuard(userData, { onKey, onStopped }) {
  const bytes = fs.readFileSync(path.join(__dirname, '../assets/DAYANKeyboardGuard.exe'));
  const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const directory = path.join(userData, 'native');
  fs.mkdirSync(directory, { recursive: true });
  const executable = path.join(directory, `keyboard-guard-${hash}.exe`);
  if (!fs.existsSync(executable)) fs.writeFileSync(executable, bytes);
  let session;
  const send = current => {
    if (current?.child.stdin.writable) current.child.stdin.write(JSON.stringify({ command: 'state', input: current.input }) + '\n');
  };
  return {
    isActive: () => Boolean(session?.ready),
    async start(window) {
      if (session) throw Error('Keyboard guard is already running.');
      const handle = window.getNativeWindowHandle();
      const hwnd = handle.length >= 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
      const child = spawn(executable, [hwnd, String(process.pid)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const current = session = { child, input: false, ready: false, stopping: false };
      child.stdin.on('error', () => {});
      child.stderr.resume();
      current.exited = new Promise(resolve => child.once('exit', resolve));
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { child.kill(); reject(Error('Keyboard guard did not become ready.')); }, 5000);
        const lines = createInterface({ input: child.stdout });
        lines.on('line', line => {
          let message;
          try { message = JSON.parse(line); } catch { return; }
          if (message.type === 'ready') { current.ready = true; clearTimeout(timeout); send(current); resolve(); }
          else if (message.type === 'error') reject(Error(message.error));
          else if (message.type === 'key' && current.ready && current.input && !current.stopping && /^(\d|Backspace|Enter)$/.test(message.key)) onKey(message.key);
        });
        child.once('error', error => { clearTimeout(timeout); if (session === current) session = null; reject(error); });
        child.once('exit', () => {
          clearTimeout(timeout);
          clearInterval(current.heartbeat);
          if (session === current) session = null;
          reject(Error('Keyboard guard stopped.'));
          if (current.ready && !current.stopping) onStopped();
        });
      });
      if (session !== current || child.exitCode !== null) throw Error('Keyboard guard stopped before activation.');
      current.heartbeat = setInterval(() => send(current), 750);
      current.heartbeat.unref();
    },
    setInput(enabled) { if (session) { session.input = enabled === true; send(session); } },
    async stop() {
      const current = session;
      if (!current) return;
      current.stopping = true;
      current.input = false;
      clearInterval(current.heartbeat);
      if (current.child.stdin.writable) current.child.stdin.end('{"command":"stop"}\n');
      const timeout = setTimeout(() => current.child.kill(), 1000);
      await current.exited;
      clearTimeout(timeout);
    }
  };
}
module.exports = { createKeyboardGuard };
