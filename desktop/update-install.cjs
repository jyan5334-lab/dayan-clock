const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

async function prepareUpdateInstall({ installerPath, appPath, version, userData, parentPid = process.pid, silent = false, notifyOnFailure = true }) {
  const jobDir = path.join(userData, 'updates', crypto.randomUUID());
  fs.mkdirSync(jobDir, { recursive: true });
  const scriptPath = path.join(jobDir, 'install-update.ps1');
  const hostPath = path.join(jobDir, 'DAYANUpdateHost.exe');
  const requestPath = path.join(jobDir, 'request.json');
  const statusPath = path.join(jobDir, 'status.json');
  // Windows PowerShell 5 requires a BOM to read Chinese messages correctly.
  fs.writeFileSync(scriptPath, '\uFEFF' + fs.readFileSync(path.join(__dirname, '../scripts/install-update.ps1'), 'utf8').replace(/^\uFEFF/, ''), 'utf8');
  fs.copyFileSync(path.join(__dirname, '../assets/DAYANUpdateHost.exe'), hostPath);
  fs.writeFileSync(requestPath, JSON.stringify({ installerPath, appPath, version, parentPid, silent, notifyOnFailure }), 'utf8');
  // Run outside the install directory so the installer can replace every app
  // file. The native host keeps PowerShell alive after Electron exits.
  const child = spawn(hostPath, [scriptPath, requestPath], { detached: true, windowsHide: true, stdio: 'ignore' });
  // The running app only quits once the independent helper has validated its inputs.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`安装辅助程序未就绪，应用未退出。日志位置：${jobDir}`)), 15000);
    const poll = setInterval(() => {
      let status;
      try { status = JSON.parse(fs.readFileSync(statusPath, 'utf8').replace(/^\uFEFF/, '')); } catch { return; }
      if (status.stage === 'ready') finish();
      else if (status.stage === 'failed') finish(new Error(status.message));
    }, 80);
    const onError = error => finish(error);
    const onExit = code => finish(new Error(`安装辅助程序提前退出（${code}），应用未退出。日志位置：${jobDir}`));
    function finish(error) {
      clearTimeout(timer);
      clearInterval(poll);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      error ? reject(error) : resolve();
    }
    child.once('error', onError);
    child.once('exit', onExit);
  }).catch(error => { child.kill(); throw error; });
  child.unref();
  return { jobDir, statusPath };
}

module.exports = { prepareUpdateInstall };
