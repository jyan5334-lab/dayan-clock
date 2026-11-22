const fs = require('node:fs');
const crypto = require('node:crypto');

async function verifyInstaller(file, update) {
  if (!/^[a-f0-9]{64}$/i.test(update.sha256 || '')) throw Error('更新清单缺少 SHA-256 校验值，未执行自动安装');
  const hash = crypto.createHash('sha256');
  let size = 0;
  for await (const chunk of fs.createReadStream(file)) { hash.update(chunk); size += chunk.length; }
  if (hash.digest('hex').toLowerCase() !== update.sha256.toLowerCase() || (update.size > 0 && size !== update.size)) throw Error('更新文件校验失败，未执行安装');
}

function createUpdateController({ download, canInstall, install, verify = verifyInstaller, onStatus = () => {} }) {
  let active, pending, phase = 'idle';
  const status = (value, error) => { phase = value; onStatus(value, error); };
  function request(update) {
    if (active) return active;
    if (phase === 'restarting') return Promise.resolve({ ok: true });
    if (!update && !pending) return Promise.resolve({ ok: false, skipped: true });
    // The microtask ensures synchronous failures also release the active job.
    active = Promise.resolve().then(async () => {
      if (update && (pending?.update.version !== update.version || pending?.update.sha256 !== update.sha256)) pending = null;
      if (!pending) {
        if (!/^[a-f0-9]{64}$/i.test(update.sha256 || '')) throw Error('更新清单缺少 SHA-256 校验值，未执行自动安装');
        status('downloading');
        const installerPath = await download(update);
        pending = { update, installerPath };
      }
      if (!canInstall()) { status('deferred'); return { ok: true, deferred: true }; }
      status('verifying');
      await verify(pending.installerPath, pending.update);
      // Locking may start while hashing a large installer.
      if (!canInstall()) { status('deferred'); return { ok: true, deferred: true }; }
      status('installing');
      const result = await install(pending);
      if (result?.deferred) { status('deferred'); return { ok: true, deferred: true }; }
      pending = null;
      status('restarting');
      return { ok: true };
    }).catch(error => {
      pending = null;
      status('failed', error.message);
      return { ok: false, error: error.message };
    }).finally(() => { active = null; });
    return active;
  }
  return { request, get busy() { return Boolean(active); }, get phase() { return phase; }, get pending() { return Boolean(pending); } };
}

module.exports = { createUpdateController, verifyInstaller };
