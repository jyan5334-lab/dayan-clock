const fs = require('node:fs');
const path = require('node:path');

function createRenderDiagnostics(directory, { version, maxBytes = 131072 } = {}) {
  const file = path.join(directory, 'render-events.jsonl');
  const started = Date.now();
  const record = (event, details = {}) => {
    try {
      fs.mkdirSync(directory, { recursive: true });
      if (fs.existsSync(file) && fs.statSync(file).size >= maxBytes) {
        fs.rmSync(file + '.1', { force: true });
        fs.renameSync(file, file + '.1');
      }
      fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), elapsedMs: Date.now() - started, pid: process.pid, version, event, ...details }) + '\n');
    } catch {} // A full or unavailable log directory must never interrupt wallpaper rendering.
  };
  record('session-start');
  return { record, file };
}

module.exports = { createRenderDiagnostics };
