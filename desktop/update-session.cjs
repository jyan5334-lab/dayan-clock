const fs = require('node:fs');
const path = require('node:path');

const sessionPath = userData => path.join(userData, 'updates', 'resume.json');

function saveUpdateSession(userData, session) {
  const file = sessionPath(userData);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify({ ...session, createdAt: Date.now(), schema: 1 }));
  fs.renameSync(file + '.tmp', file);
}

function clearUpdateSession(userData) {
  fs.rmSync(sessionPath(userData), { force: true });
}

function readUpdateSession(userData, argv = process.argv, now = Date.now()) {
  if (!argv.some(arg => ['--updated', '--dayan-update-recovery'].includes(arg))) return null;
  try {
    const session = JSON.parse(fs.readFileSync(sessionPath(userData), 'utf8'));
    if (session.schema !== 1 || !Number.isFinite(session.createdAt) || now - session.createdAt > 86400000 || session.createdAt > now + 60000 || typeof session.fullscreen !== 'boolean') return null;
    return session;
  } catch { return null; }
}

module.exports = { saveUpdateSession, readUpdateSession, clearUpdateSession };
