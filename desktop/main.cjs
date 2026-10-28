const { app, BrowserWindow, ipcMain, screen, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { RATIO, MIN_WIDTH, corners, fitBounds, resizeFromCorner } = require('./window-geometry.cjs');

app.setName('DAYAN时钟');
app.setAppUserModelId('com.dayan.clock');
if (process.env.DAYAN_TEST === '1' && process.env.DAYAN_TEST_DATA) app.setPath('userData', process.env.DAYAN_TEST_DATA);
const PASSWORD_ITERATIONS = 210000;
let mainWindow, state = {}, resizeSession, saveTimer, securityLocked = false, quitting = false;
let windowedBounds, presentationRequested = false, restoringBounds = false, restoreBoundsTimer;
const stateFile = () => path.join(app.getPath('userData'), 'preferences.json');
const lockdownScript = () => path.join(__dirname, '../scripts/enable-dayan-lockdown.ps1');

function powershellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runPowerShell(script, timeout = 12000) {
  if (process.platform !== 'win32') return Promise.reject(new Error('Windows only'));
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Windows 检测或授权等待超时，请重新检测')); }, timeout);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() }); });
  });
}

async function windowsLockdownStatus() {
  if (process.platform !== 'win32') return { supported: false, enabled: false, missing: [], error: 'Windows 专属功能' };
  const script = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$os = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$productName = [string]$os.ProductName
$displayVersion = [string]$os.DisplayVersion
$build = [string]$os.CurrentBuild
try { $productName = [string](Get-CimInstance Win32_OperatingSystem -OperationTimeoutSec 3 -ErrorAction Stop).Caption } catch {
  if ($productName -match '^Windows 10\b' -and [int]$build -ge 22000 -and [int]$build -lt 28000) { $productName = $productName -replace '^Windows 10', 'Windows 11' }
}
$architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
$versionSupported = $productName -match '^(Microsoft )?Windows (10|11)\b'
$system = "Registry::HKEY_USERS\$sid\Software\Microsoft\Windows\CurrentVersion\Policies\System"
$explorer = "Registry::HKEY_USERS\$sid\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer"
$required = @(
  @{ Path = $system; Name = 'DisableTaskMgr' },
  @{ Path = $system; Name = 'DisableLockWorkstation' },
  @{ Path = $system; Name = 'DisableChangePassword' },
  @{ Path = $explorer; Name = 'NoWinKeys' },
  @{ Path = $explorer; Name = 'NoLogoff' }
)
$missing = @()
$policies = @()
foreach ($item in $required) {
  try { $value = (Get-ItemProperty -Path $item.Path -Name $item.Name -ErrorAction Stop).($item.Name) } catch [System.Management.Automation.ItemNotFoundException] { $value = $null } catch [System.Management.Automation.PSArgumentException] { $value = $null }
  if ([int]$value -ne 1) { $missing += $item.Name }
  $policies += @{ name = $item.Name; enabled = ([int]$value -eq 1) }
}
[pscustomobject]@{ supported = ($versionSupported -and $architecture -eq 'x64'); versionSupported = $versionSupported; enabled = ($missing.Count -eq 0); missing = @($missing); policies = @($policies); sid = $sid; productName = $productName; displayVersion = $displayVersion; build = $build; architecture = $architecture; osLabel = ("$productName $displayVersion ($architecture)").Trim() } | ConvertTo-Json -Depth 4 -Compress
`;
  try {
    const result = await runPowerShell(script);
    if (result.code !== 0) throw new Error(result.stderr || '无法读取 Windows 策略状态');
    const parsed = JSON.parse(result.stdout);
    if (!parsed.sid || !parsed.productName || !Array.isArray(parsed.policies) || parsed.policies.length !== 5) throw new Error('系统检测返回的数据不完整，请重新检测');
    return { ...parsed, appVersion: app.getVersion(), checkedAt: new Date().toISOString(), canRestore: fs.existsSync(path.join(app.getPath('userData'), 'windows-lockdown-backup.json')), error: '' };
  } catch (error) {
    return { supported: false, enabled: false, missing: [], policies: [], sid: '', appVersion: app.getVersion(), checkedAt: new Date().toISOString(), error: error.message };
  }
}

let policyOperation = false;
async function enableWindowsLockdown(action = 'enable') {
  if (policyOperation) return { ok: false, error: '另一项系统授权正在处理，请稍后再试' };
  policyOperation = true;
  try { return await changeWindowsLockdown(action); }
  finally { policyOperation = false; }
}

async function changeWindowsLockdown(action) {
  const status = await windowsLockdownStatus();
  if (!status.supported && action === 'enable') return { ok: false, status, error: status.error || '当前系统未列入一键授权支持范围' };
  if (!status.sid) return { ok: false, status, error: '无法识别当前 Windows 用户，请重新启动 DAYAN时钟后重试' };
  if (action === 'enable' && status.enabled) return { ok: true, status };
  let temporaryScript = '';
  try {
    const scriptPath = action === 'restore' ? path.join(__dirname, '../scripts/restore-dayan-lockdown.ps1') : lockdownScript();
    const source = fs.readFileSync(scriptPath, 'utf8');
    temporaryScript = path.join(app.getPath('temp'), `dayan-lockdown-${process.pid}-${crypto.randomUUID()}.ps1`);
    fs.writeFileSync(temporaryScript, '\uFEFF' + source.replace(/^\uFEFF/, ''), 'utf8');
    const backupPath = path.join(app.getPath('userData'), 'windows-lockdown-backup.json');
    const elevatedArgs = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', `"${temporaryScript}"`, '-UserSid', status.sid, '-BackupPath', `"${backupPath}"`, action === 'restore' ? '-ConfirmRestore' : '-ConfirmLockdown'].join(' ');
    const wrapper = `
try {
  $child = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe') -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList ${powershellLiteral(elevatedArgs)}
  if ($null -eq $child) { exit 1223 }
  exit $child.ExitCode
} catch {
  Write-Error $_
  exit 1223
}
`;
    const result = await runPowerShell(wrapper, 180000);
    const next = await windowsLockdownStatus();
    const verified = action === 'restore' ? !next.error && !next.canRestore : !next.error && next.enabled;
    if (result.code !== 0 || !verified) return { ok: false, status: next, error: result.code === 1223 ? 'Windows 授权未完成或被取消，可再次点击重试' : '系统操作未完成或复检失败，请重新检测。单位管理策略可能限制此操作。' };
    return { ok: true, status: next };
  } catch (error) {
    return { ok: false, status: await windowsLockdownStatus(), error: error.message };
  } finally {
    if (temporaryScript) { try { fs.rmSync(temporaryScript, { force: true }); } catch {} }
  }
}

function readState() {
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) state = saved;
  } catch {}
}

function flushState() {
  clearTimeout(saveTimer);
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    const temporary = stateFile() + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(state));
    fs.renameSync(temporary, stateFile());
  } catch (error) { console.error('Unable to save preferences:', error.message); }
}

function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(flushState, 150); }
function trusted(event) { return mainWindow && event.sender === mainWindow.webContents; }
function passwordRecord() {
  const security = state.security;
  return security && typeof security.salt === 'string' && typeof security.hash === 'string' ? security : null;
}
function derivePassword(password, salt) {
  return crypto.pbkdf2Sync(password, Buffer.from(salt, 'hex'), PASSWORD_ITERATIONS, 32, 'sha256').toString('hex');
}
function verifyPassword(password) {
  const record = passwordRecord();
  if (!record || typeof password !== 'string') return false;
  const expected = Buffer.from(record.hash, 'hex');
  const actual = Buffer.from(derivePassword(password, record.salt), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
function securitySnapshot() {
  return { locked: securityLocked, passwordConfigured: Boolean(passwordRecord()) };
}
function isPresentationFullscreen() {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && (presentationRequested || mainWindow.isFullScreen() || mainWindow.isKiosk()));
}
function rememberWindowedBounds() {
  if (!mainWindow || mainWindow.isDestroyed() || restoringBounds || securityLocked || isPresentationFullscreen() || mainWindow.isMinimized()) return;
  const bounds = mainWindow.getBounds();
  if (Math.abs(bounds.height - bounds.width / RATIO) > 2) return;
  windowedBounds = bounds;
  state.bounds = bounds;
  scheduleSave();
}
function preparePresentation() {
  rememberWindowedBounds();
  presentationRequested = true;
  restoringBounds = false;
  clearTimeout(restoreBoundsTimer);
  resizeSession = null;
  mainWindow.setAspectRatio(0);
}
function restoreWindowedBounds() {
  if (!mainWindow || mainWindow.isDestroyed() || securityLocked || isPresentationFullscreen() || mainWindow.isMinimized()) return;
  restoringBounds = true;
  const previous = windowedBounds || state.bounds || mainWindow.getNormalBounds();
  const bounds = fitBounds(previous, screen.getDisplayMatching(previous).workArea);
  mainWindow.setAspectRatio(RATIO);
  mainWindow.setBounds(bounds, false);
  windowedBounds = bounds;
  state.bounds = bounds;
  restoringBounds = false;
  scheduleSave();
  restorePinnedState();
  notify();
}
function queueWindowedRestore() {
  restoringBounds = true;
  clearTimeout(restoreBoundsTimer);
  restoreBoundsTimer = setTimeout(restoreWindowedBounds, 100);
}
function leavePresentation() {
  presentationRequested = false;
  restoringBounds = true;
  mainWindow.setKiosk(false);
  mainWindow.setFullScreen(false);
  queueWindowedRestore();
}
function restorePinnedState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (securityLocked) mainWindow.setAlwaysOnTop(true, 'screen-saver');
  else mainWindow.setAlwaysOnTop(state.pinned === true);
}
function notify() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('dayan:window-state', { pinned: state.pinned === true, fullscreen: isPresentationFullscreen(), ...securitySnapshot() });
}

function setupIPC() {
  ipcMain.handle('dayan:load', event => trusted(event) ? { widget: state.widget, style: state.style, appVersion: app.getVersion(), showSettingsOnStartup: state.settingsGuideVersion !== 1, pinned: state.pinned === true, fullscreen: isPresentationFullscreen(), ...securitySnapshot() } : null);
  ipcMain.handle('dayan:security-policy-status', event => trusted(event) ? windowsLockdownStatus() : { supported: false, enabled: false, missing: [], error: '请求无效' });
  ipcMain.handle('dayan:security-policy-enable', event => trusted(event) && !securityLocked ? enableWindowsLockdown() : { ok: false, error: '请先解锁时钟' });
  ipcMain.handle('dayan:security-policy-restore', event => trusted(event) && !securityLocked ? enableWindowsLockdown('restore') : { ok: false, error: '请先解锁时钟' });
  ipcMain.handle('dayan:settings-seen', event => {
    if (!trusted(event) || securityLocked) return false;
    state.settingsGuideVersion = 1;
    flushState();
    return true;
  });
  ipcMain.handle('dayan:save', (event, payload) => {
    if (!trusted(event) || !payload || typeof payload !== 'object') return false;
    const serialized = JSON.stringify(payload);
    if (serialized.length > 16384) return false;
    if (payload.widget?.privateContent?.version === 2) state.widget = payload.widget;
    if (Number.isInteger(payload.style) && payload.style >= 0 && payload.style < 5) state.style = payload.style;
    flushState();
    return true;
  });
  ipcMain.on('dayan:save-sync', (event, payload) => {
    event.returnValue = false;
    if (!trusted(event) || !payload || typeof payload !== 'object' || JSON.stringify(payload).length > 16384) return;
    if (payload.widget?.privateContent?.version === 2) state.widget = payload.widget;
    if (Number.isInteger(payload.style) && payload.style >= 0 && payload.style < 5) state.style = payload.style;
    flushState();event.returnValue = true;
  });
  ipcMain.handle('dayan:window-action', (event, action) => {
    if (!trusted(event) || securityLocked) return false;
    if (action === 'minimize') mainWindow.minimize();
    if (action === 'close') mainWindow.close();
    if (action === 'pin') {
      state.pinned = !(state.pinned === true);
      mainWindow.setAlwaysOnTop(state.pinned);
      scheduleSave();
    }
    if (action === 'fullscreen') {
      if (isPresentationFullscreen()) leavePresentation();
      else { preparePresentation(); mainWindow.setFullScreen(true); }
    }
    notify();
    return true;
  });
  ipcMain.handle('dayan:security-set-password', (event, payload) => {
    if (!trusted(event) || !payload || typeof payload !== 'object') return { ok: false, error: '请求无效' };
    const current = typeof payload.current === 'string' ? payload.current : '';
    const next = typeof payload.next === 'string' ? payload.next : '';
    if (!/^\d{4,16}$/.test(next)) return { ok: false, error: '密码必须是 4 至 16 位数字' };
    if (passwordRecord() && !verifyPassword(current)) return { ok: false, error: '当前密码不正确' };
    const salt = crypto.randomBytes(16).toString('hex');
    state.security = { salt, hash: derivePassword(next, salt), iterations: PASSWORD_ITERATIONS };
    flushState();
    notify();
    return { ok: true, ...securitySnapshot() };
  });
  ipcMain.handle('dayan:security-lock', (event) => {
    if (!trusted(event) || !passwordRecord() || policyOperation) return false;
    // Preserve the ordinary window before kiosk expands its native bounds.
    preparePresentation();
    securityLocked = true;
    resizeSession = null;
    mainWindow.setMinimizable(false);
    mainWindow.setResizable(false);
    mainWindow.setSkipTaskbar(true);
    const forceKiosk = () => {
      if (!mainWindow || mainWindow.isDestroyed() || !securityLocked) return;
      const display = screen.getDisplayMatching(mainWindow.getBounds());
      mainWindow.setBounds(display.bounds, false);
      mainWindow.setKiosk(true);
      mainWindow.setFullScreen(true);
      mainWindow.show();
      mainWindow.focus();
      restorePinnedState();
      notify();
    };
    forceKiosk();
    setTimeout(forceKiosk, 250);
    return true;
  });
  ipcMain.handle('dayan:security-verify', (event, password) => {
    if (!trusted(event) || !securityLocked || !verifyPassword(password)) return false;
    securityLocked = false;
    mainWindow.setMinimizable(true);
    mainWindow.setResizable(true);
    mainWindow.setSkipTaskbar(false);
    leavePresentation();
    notify();
    return true;
  });
  const pointerPosition = pointer => Number.isFinite(pointer?.x) && Number.isFinite(pointer?.y) ? pointer : screen.getCursorScreenPoint();
  ipcMain.on('dayan:resize-start', (event, corner, pointer) => {
    if (!trusted(event) || securityLocked || restoringBounds || !corners.has(corner) || isPresentationFullscreen()) return;
    resizeSession = { corner, pointer: pointerPosition(pointer), bounds: mainWindow.getBounds() };
  });
  ipcMain.on('dayan:resize-move', (event, position) => {
    if (!trusted(event) || securityLocked || restoringBounds || !resizeSession || isPresentationFullscreen()) return;
    const pointer = pointerPosition(position);
    const area = screen.getDisplayMatching(resizeSession.bounds).workArea;
    const bounds = resizeFromCorner(resizeSession.bounds, resizeSession.corner, pointer.x - resizeSession.pointer.x, pointer.y - resizeSession.pointer.y, area);
    mainWindow.setBounds(bounds);
  });
  ipcMain.on('dayan:resize-end', event => { if (trusted(event)) resizeSession = null; });
}

function createWindow() {
  const area = state.bounds ? screen.getDisplayMatching(state.bounds).workArea : screen.getPrimaryDisplay().workArea;
  windowedBounds = fitBounds(state.bounds, area);
  state.bounds = windowedBounds;
  presentationRequested = false;
  restoringBounds = false;
  mainWindow = new BrowserWindow({
    ...windowedBounds,
    minWidth: MIN_WIDTH, minHeight: Math.round(MIN_WIDTH / RATIO),
    title: 'DAYAN时钟', icon: path.join(__dirname, '../assets/icon.png'),
    frame: false, resizable: true, maximizable: false, fullscreenable: true,
    backgroundColor: '#080c10', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false }
  });
  mainWindow.setAspectRatio(RATIO);
  mainWindow.setAlwaysOnTop(state.pinned === true);
  Menu.setApplicationMenu(null);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  mainWindow.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  // Native edge resizing must obey the same ratio as the four visible corner grips.
  mainWindow.on('will-resize', (event, proposed, details) => {
    if (isPresentationFullscreen() || restoringBounds || securityLocked) { event.preventDefault(); return; }
    event.preventDefault();
    const start = mainWindow.getBounds(), edge = details.edge;
    const corner = edge.includes('top') ? (edge.includes('left') ? 'top-left' : 'top-right') : (edge.includes('left') ? 'bottom-left' : 'bottom-right');
    const dx = edge.includes('left') ? proposed.x - start.x : edge === 'top' || edge === 'bottom' ? 0 : proposed.width - start.width;
    const dy = edge.includes('top') ? proposed.y - start.y : edge === 'left' || edge === 'right' ? 0 : proposed.height - start.height;
    mainWindow.setBounds(resizeFromCorner(start, corner, dx, dy, screen.getDisplayMatching(start).workArea));
  });
  mainWindow.on('resize', rememberWindowedBounds);
  mainWindow.on('move', rememberWindowedBounds);
  mainWindow.on('blur', () => { resizeSession = null; });
  mainWindow.on('enter-full-screen', () => { restorePinnedState(); notify(); });
  mainWindow.on('leave-full-screen', () => {
    if (!presentationRequested && !securityLocked) queueWindowedRestore();
    restorePinnedState(); notify();
  });
  mainWindow.on('restore', () => {
    if (presentationRequested || securityLocked) { mainWindow.setFullScreen(true); notify(); }
    else queueWindowedRestore();
  });
  mainWindow.once('ready-to-show', () => { mainWindow.show(); restoreWindowedBounds(); });
  mainWindow.on('close', event => {
    if (securityLocked && !quitting) { event.preventDefault(); return; }
    flushState();
  });
  mainWindow.on('closed', () => { clearTimeout(restoreBoundsTimer); mainWindow = null; });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (securityLocked && (['F11', 'Escape'].includes(input.key) || (input.alt && input.key === 'F4') || (input.control && input.shift && input.key === 'Escape'))) event.preventDefault();
    if (securityLocked) {
      const editingKeys = ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'];
      const digit = /^\d$/.test(input.key) && !input.control && !input.alt && !input.meta;
      if (!digit && !editingKeys.includes(input.key)) event.preventDefault();
    }
    if ((input.control || input.meta) && ['+', '-', '=', '0'].includes(input.key)) event.preventDefault();
  });
  mainWindow.loadFile(path.join(__dirname, '../index.html'));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show(); mainWindow.focus();
  });
  app.whenReady().then(() => {
    readState(); setupIPC(); createWindow();
    screen.on('display-metrics-changed', () => {
      if (mainWindow && !isPresentationFullscreen() && !mainWindow.isMinimized()) queueWindowedRestore();
    });
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => { quitting = true; flushState(); });
}
