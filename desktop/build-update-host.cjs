const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function buildUpdateHost() {
  if (process.platform !== 'win32') return null;
  const target = path.join(__dirname, '../assets/DAYANUpdateHost.exe');
  const source = path.join(__dirname, 'update-host.cs');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dayan-host-build-'));
  const output = path.join(folder, 'DAYANUpdateHost.exe');
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const command = `Add-Type -Path ${quote(source)} -OutputAssembly ${quote(output)} -OutputType WindowsApplication`;
  const result = spawnSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0 || !fs.existsSync(output)) throw Error('Update host compilation failed: ' + result.stderr);
  fs.copyFileSync(output, target);
  const desktopSource = path.join(__dirname, 'desktop-host.cs');
  const desktopOutput = path.join(folder, 'DAYANDesktopHost.exe');
  const desktopCommand = `Add-Type -Path ${quote(desktopSource)} -ReferencedAssemblies System.dll,System.Core.dll,System.Web.Extensions.dll -OutputAssembly ${quote(desktopOutput)} -OutputType ConsoleApplication`;
  const desktopResult = spawnSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(desktopCommand, 'utf16le').toString('base64')], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
  if (desktopResult.status !== 0 || !fs.existsSync(desktopOutput)) throw Error('Desktop host compilation failed: ' + desktopResult.stderr);
  fs.copyFileSync(desktopOutput, path.join(__dirname, '../assets/DAYANDesktopHost.exe'));
  return target;
}
module.exports = { buildUpdateHost };
if (require.main === module) console.log(buildUpdateHost());
