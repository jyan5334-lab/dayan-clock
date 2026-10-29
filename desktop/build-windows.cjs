const fs = require('node:fs');
const path = require('node:path');
const { build, Platform, Arch } = require('electron-builder');
require('./build-update-host.cjs').buildUpdateHost();
const projectDir = path.resolve(__dirname, '..');
const outputDir = path.join(projectDir, 'release');

if (process.platform === 'win32') {
  const { WineVmManager } = require('app-builder-lib/out/vm/WineVm');
  const { UninstallerReader } = require('app-builder-lib/out/targets/nsis/nsisUtil');
  const originalExec = WineVmManager.prototype.exec;
  WineVmManager.prototype.exec = async function (file, args, options, ...rest) {
    if (path.dirname(path.resolve(file)) === outputDir && /^DAYANClock-Setup-.*\.exe$/i.test(path.basename(file)) && args.length === 0 && options?.env?.__COMPAT_LAYER === 'RunAsInvoker') {
      await UninstallerReader.exec(file, path.join(outputDir, `${path.basename(file, 'exe')}__uninstaller.exe`));
      return '';
    }
    return originalExec.call(this, file, args, options, ...rest);
  };
}
build({ projectDir, targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64) })
  .then(files => {
    const installer = files.find(file => file.endsWith('.exe'));
    if (!installer || fs.statSync(installer).size < 50 * 1024 * 1024) throw new Error('Installer is incomplete');
    console.log(`Windows installer: ${installer}`);
  }).catch(error => { console.error(error);process.exitCode = 1; });
