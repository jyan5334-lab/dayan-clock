const { app, BrowserWindow, ipcMain, screen, Menu, Tray, dialog, globalShortcut, powerMonitor } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { RATIO, MIN_WIDTH, corners, fitBounds, resizeFromCorner } = require('./window-geometry.cjs');
const { prepareUpdateInstall } = require('./update-install.cjs');
const { createDesktopHost } = require('./windows-desktop.cjs');
const { createWallpaperControls } = require('./wallpaper-controls.cjs');
const { createPresentationEditor } = require('./presentation-editor.cjs');
const recovery = require('./password-recovery.cjs');
const { createKeyboardGuard } = require('./keyboard-guard.cjs');
const { configureWindowsStartup } = require('./windows-startup.cjs');
const { downloadUpdate, mergeUpdateSources, SOURCE_POOL_LIMIT } = require('./update-download.cjs');
const { networkFetch, downloadTransports } = require('./update-network.cjs');
const { resolveUpdateMode } = require('./update-mode.cjs');
const { createUpdateSchedule } = require('./update-schedule.cjs');
const { migrateLegacyBackups, hasBackups, matchesRestoredPolicies } = require('./policy-backups.cjs');

const APP_NAME = 'DAYAN桌面';
const launchedAt = Date.now();
const DEFAULT_WINDOW_LAYERS = Object.freeze({ unlocked: 'top', locked: 'top' });
app.setName(APP_NAME);
app.setAppUserModelId('com.dayan.clock');
const updateMode = resolveUpdateMode({ defaultUserData: app.getPath('userData') });
if (updateMode.test) app.setPath('userData', process.env.DAYAN_TEST_DATA);
const PASSWORD_ITERATIONS = 210000;
const UPDATE_REPOSITORY_API = 'https://api.github.com/repos/jyan5334-lab/dayan-clock/releases/latest';
const UPDATE_PUBLIC_MANIFEST = 'https://github.com/jyan5334-lab/dayan-clock/releases/latest/download/update.json';
const DEFAULT_DISPLAY_SETTINGS = Object.freeze({ showAlmanac: true, showClockDate: true, modes: Object.freeze({ clock: false, watch: true, down: true, up: true }) });
let mainWindow, tray, trayMenu, state = {}, resizeSession, saveTimer, securityLocked = false, quitting = false, openedAtLogin = false, trayActionBusy = false, desktopReconcileTimer, trayReconcileInterval;
let windowedBounds, presentationRequested = false, restoringBounds = false, restoreBoundsTimer, desktopWindowHosted = false;
let presentationDisplayId;
let desktopHost, wallpaperControls, desktopHostDesired = false, desktopHostQueue = Promise.resolve(), desktopHostRequest = 0;
let updateInfo = null, updateBusy = false, updateCheckPromise;
let updateWindow, automaticUpdateTimer, rendererReady = false, updateDismissed = false, automaticUpdateAttempt = 0;
let scheduledUpdatePending = false;
const dailyUpdateSchedule = createUpdateSchedule({ onCheck: () => {
  automaticUpdateAttempt = 0;
  scheduleAutomaticUpdate(0, true);
} });
let keyboardGuard, lockStarting = false, unlockInputEnabled = false;
let fullscreenBeforeLock = false;
let configuredAutoStart;
const presentationEditor = createPresentationEditor();
let recoveryGrant = null, recoveryEditing = false;
let lockDesktop, shortcutError = '';
const stateFile = () => path.join(app.getPath('userData'), 'preferences.json');

function normalizeDisplaySettings(value) {
  const modes = value?.modes && typeof value.modes === 'object' ? value.modes : {};
  return { showAlmanac: value?.showAlmanac !== false, showClockDate: value?.showClockDate !== false, modes: { clock: modes.clock === true, watch: modes.watch !== false, down: modes.down !== false, up: modes.up !== false } };
}

function normalizeWindowLayers(value) {
  return {
    unlocked: value?.unlocked === 'bottom' ? 'bottom' : DEFAULT_WINDOW_LAYERS.unlocked,
    locked: value?.locked === 'bottom' ? 'bottom' : DEFAULT_WINDOW_LAYERS.locked,
    displayScope: value?.displayScope === 'all' ? 'all' : 'current'
  };
}

function applyAutoStart(enabled) {
  const value = enabled !== false;
  if (process.env.DAYAN_TEST === '1') return value;
  if (configuredAutoStart === value) return value;
  configuredAutoStart = value;
  try { app.setLoginItemSettings({ openAtLogin: value, path: process.execPath, args: process.platform === 'win32' ? ['--dayan-login-start'] : [] }); }
  catch (error) { console.error('Unable to configure auto-start:', error.message); }
  if (process.platform === 'win32' && app.isPackaged) {
    configureWindowsStartup(process.execPath, value).then(result => {
      if (result.ok && (state.autoStart !== false) === value) {
        // Keep the Run fallback until the per-user logon task is registered.
        app.setLoginItemSettings({ openAtLogin: false, path: process.execPath, args: ['--dayan-login-start'] });
        state.autoStartMode = value ? 'logon-task' : 'disabled';
      } else if (!result.ok) {
        state.autoStartMode = value ? 'run-fallback' : 'disable-pending';
        console.error('Unable to configure logon task:', result.error);
      }
      scheduleSave();
    }).catch(error => console.error('Unable to configure logon task:', error.message));
  }
  return value;
}

function normalizeVersion(value) {
  const match = String(value || '').trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return match ? [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)] : null;
}

function isNewerVersion(remote, local) {
  const a = normalizeVersion(remote), b = normalizeVersion(local);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}

function updateHeaders() {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'DAYANClock-Updater', 'X-GitHub-Api-Version': '2022-11-28' };
  if (process.env.DAYAN_GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.DAYAN_GITHUB_TOKEN}`;
  return headers;
}


function retryDelay(attempt) {
  return Math.min(5000, 350 * (2 ** Math.max(0, attempt - 1)) + Math.floor(Math.random() * 180));
}

function isRetryableNetworkError(error) {
  const code = error?.cause?.code || '';
  return error?.name === 'TimeoutError' || error?.name === 'AbortError' ||
    ['ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED'].includes(code) ||
    /fetch failed|timeout|timed out|socket|network|net::ERR_/i.test(String(error?.message || ''));
}

async function fetchWithRetry(url, options = {}, { attempts = 3, timeout = 30000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const signal = options.signal || AbortSignal.timeout(timeout);
      const response = await networkFetch(url, { ...options, signal });
      if (response.status >= 500 && attempt < attempts) {
        try { await response.body?.cancel(); } catch {}
        await new Promise(resolve => setTimeout(resolve, retryDelay(attempt)));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryableNetworkError(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, retryDelay(attempt)));
    }
  }
  throw lastError || new Error('网络请求失败');
}

function normalizeUpdatePayload(payload) {
  if (payload?.tag_name || payload?.name) {
    const version = String(payload.tag_name || payload.name).replace(/^v/i, '');
    if (!/^\d+\.\d+\.\d+$/.test(version)) return null;
    const asset = Array.isArray(payload.assets) ? payload.assets.find(item => item.name === `DAYANClock-Setup-${version}-x64.exe`) : null;
    if (!asset?.browser_download_url) return null;
    return { version, title: payload.name || `DAYAN桌面 ${version}`, notes: String(payload.body || '').trim(), publishedAt: payload.published_at || payload.created_at || '', downloadUrl: asset.browser_download_url, assetApiUrl: asset.url || '', mirrorUrls: [], sha256: typeof asset.digest === 'string' ? asset.digest.replace(/^sha256:/i, '') : '', size: Number(asset.size) || 0, releaseUrl: payload.html_url || '' };
  }
  if (payload?.version && payload?.downloadUrl) {
    if (!/^\d+\.\d+\.\d+$/.test(String(payload.version).replace(/^v/i, ''))) return null;
    const mirrors = Array.isArray(payload.mirrorUrls) ? payload.mirrorUrls.filter(value => typeof value === 'string' && value.trim()) : [];
    return { version: String(payload.version).replace(/^v/i, ''), title: payload.title || `DAYAN桌面 ${payload.version}`, notes: String(payload.notes || '').trim(), publishedAt: payload.publishedAt || '', downloadUrl: String(payload.downloadUrl), assetApiUrl: String(payload.assetApiUrl || ''), mirrorUrls: mirrors, sha256: String(payload.sha256 || '').replace(/^sha256:/i, ''), size: Number(payload.size) || 0, releaseUrl: String(payload.releaseUrl || '') };
  }
  return null;
}

function sendUpdateProgress(progress) {
  if (updateWindow && !updateWindow.isDestroyed()) updateWindow.webContents.send('dayan:update-progress', progress);
}

function describeUpdateError(error) {
  const code = error?.cause?.code || '';
  const message = String(error?.message || '');
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError' || /timed out|timeout/i.test(message)) {
    return '连接更新服务器超时。请检查网络后重试；如果仍然失败，请配置可访问的镜像更新源。';
  }
  if (message === 'fetch failed' || /net::ERR_/i.test(message) || ['ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN', 'ENOTFOUND'].includes(code)) {
    return '更新线路暂时不可用，已下载的完整分段已保留。请点击重试，将继续下载；GitHub 线路受限时需要发布方提供可用镜像。';
  }
  return message || '更新下载失败，请稍后重试';
}

function updateDownloadUrls(update) {
  const official = [update.assetApiUrl, update.downloadUrl].filter(value => typeof value === 'string' && value.trim());
  return [...new Set([...(update.mirrorUrls || []).slice(0, SOURCE_POOL_LIMIT - official.length), ...official])];
}


async function downloadUpdateFile(update, installerPath) {
  return downloadUpdate({ update, installerPath, urls: updateDownloadUrls(update), fetch: networkFetch, transports: downloadTransports,
    onProgress: sendUpdateProgress, token: process.env.DAYAN_GITHUB_TOKEN,
    onDiagnostic: record => {
      try { fs.appendFileSync(path.join(path.dirname(installerPath), 'network.log'), JSON.stringify({ at: new Date().toISOString(), version: update.version, ...record, error: record.error?.replace(/https?:\/\/\S+/g, '[url]') }) + '\n'); } catch {}
    } });
}

async function checkForUpdates() {
  if (updateCheckPromise) return updateCheckPromise;
  if (updateMode.test && !updateMode.fixtureUrl) return { available: false, skipped: true, currentVersion: app.getVersion() };
  updateCheckPromise = (async () => {
    const configuredEndpoint = updateMode.fixtureUrl || process.env.DAYAN_UPDATE_MANIFEST_URL;
    const endpoints = configuredEndpoint ? [configuredEndpoint] : [UPDATE_REPOSITORY_API, UPDATE_PUBLIC_MANIFEST];
    let remote;
    const candidates = [];
    try {
      const requests = endpoints.map(async endpoint => {
        const headers = new URL(endpoint).hostname === 'api.github.com' ? updateHeaders() : { 'User-Agent': 'DAYANClock-Updater', Accept: 'application/json' };
        const response = await fetchWithRetry(endpoint, { headers: { ...headers, 'Cache-Control': 'no-cache' }, redirect: 'follow' }, { attempts: 2, timeout: 6000 });
        if (!response.ok) throw Error(`更新检查失败（HTTP ${response.status}）`);
        const candidate = normalizeUpdatePayload(await response.json());
        if (!candidate) throw Error('更新清单格式无效');
        candidates.push(candidate);
        if (updateInfo) updateInfo = mergeUpdateSources(updateInfo, candidate);
        return candidate;
      });
      remote = await Promise.any(requests);
      // A fast cached manifest must not hide a newer release on the other channel.
      if (!isNewerVersion(remote.version, app.getVersion())) await Promise.allSettled(requests);
    } catch (error) { throw Error(describeUpdateError(error.errors?.[0] || error)); }
    for (const candidate of candidates) remote = isNewerVersion(candidate.version, remote.version) ? candidate : mergeUpdateSources(remote, candidate);
    if (!remote || !isNewerVersion(remote.version, app.getVersion())) { updateInfo = null; return { available: false, currentVersion: app.getVersion(), checkedAt: new Date().toISOString() }; }
    updateInfo = { ...remote, currentVersion: app.getVersion(), testOnly: Boolean(updateMode.fixtureUrl) };
    return { available: true, ...updateInfo };
  })().catch(error => {
    return { available: false, error: error.message || '更新检查失败', currentVersion: app.getVersion() };
  }).finally(() => { updateCheckPromise = null; });
  return updateCheckPromise;
}

function localUpdateDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function updateSender(event) {
  return trusted(event) || event.sender === updateWindow?.webContents;
}

function offerUpdate({ manual = false } = {}) {
  if (!updateInfo || !mainWindow || mainWindow.isDestroyed() || securityLocked || lockStarting || quitting) return;
  if (!manual && (updateDismissed || state.updateReminderDate === localUpdateDate())) return;
  if (updateWindow && !updateWindow.isDestroyed()) {
    if (!updateBusy) updateWindow.webContents.send('dayan:update-available', updateInfo);
    if (!updateMode.hideWindow) { updateWindow.show(); updateWindow.focus(); }
    return;
  }
  if (updateBusy) return;
  // Keep the wallpaper attached to Explorer; only this small prompt floats above it.
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(600, area.width - 24), height = Math.min(660, area.height - 24);
  const window = new BrowserWindow({
    x:Math.round(area.x + (area.width - width) / 2), y:Math.round(area.y + (area.height - height) / 2), width, height,
    minWidth:320, minHeight:300, frame:false, show:false, skipTaskbar:true, minimizable:false, maximizable:false,
    title:updateInfo.testOnly ? `${APP_NAME} · 本地更新测试` : `${APP_NAME} · 软件更新`,
    icon:path.join(__dirname, '../assets/icon.ico'), backgroundColor:'#10191e',
    webPreferences:{ preload:path.join(__dirname, 'preload.cjs'), nodeIntegration:false, contextIsolation:true, sandbox:true }
  });
  updateWindow = window;
  window.setAlwaysOnTop(true, 'floating');
  window.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('close', event => {
    if (updateBusy && !quitting) { event.preventDefault(); return; }
    if (!quitting) updateDismissed = true;
  });
  window.on('closed', () => { if (updateWindow === window) updateWindow = null; });
  window.once('ready-to-show', () => { if (!updateMode.hideWindow && !securityLocked && !lockStarting && !quitting) { window.show(); window.focus(); } });
  window.loadFile(path.join(__dirname, '../index.html'), { query:{ updater:'1' } }).catch(error => {
    console.error('Unable to open update prompt:', error.message);
    if (!window.isDestroyed()) window.destroy();
  });
}

function scheduleAutomaticUpdate(delay = 0, scheduled = false) {
  clearTimeout(automaticUpdateTimer);
  if (quitting || !rendererReady || process.argv.includes('--dayan-update-recovery')) return;
  scheduledUpdatePending ||= scheduled;
  automaticUpdateTimer = setTimeout(async () => {
    const result = await checkForUpdates();
    if (quitting) return;
    if (result.error) {
      const delays = [15000, 60000, 300000];
      if (automaticUpdateAttempt < delays.length) scheduleAutomaticUpdate(delays[automaticUpdateAttempt++], scheduled);
    } else {
      automaticUpdateAttempt = 0;
      if (scheduledUpdatePending) { updateDismissed = false; scheduledUpdatePending = false; }
      if (result.available) offerUpdate();
    }
  }, delay);
  automaticUpdateTimer.unref();
}

async function downloadAndInstallUpdate() {
  if (updateMode.fixtureUrl) return { ok: false, error: '本地更新测试使用模拟版本，禁止安装。请关闭测试窗口并打开正式程序。' };
  if (!updateInfo || updateBusy) return { ok: false, error: '当前没有可安装的更新' };
  updateBusy = true;
  const update = updateInfo;
  const tempDir = path.join(app.getPath('userData'), 'updates', 'downloads');
  const installerPath = path.join(tempDir, `DAYANClock-Setup-${update.version}-x64.exe`);
  try {
    fs.mkdirSync(tempDir, { recursive: true });
    const { actualHash } = await downloadUpdateFile(update, installerPath);
    if (update.sha256 && actualHash.toLowerCase() !== update.sha256.toLowerCase()) throw new Error('更新文件校验失败，未执行安装');
    if (process.platform !== 'win32') return { ok: false, error: '当前更新安装器仅支持 Windows' };
    sendUpdateProgress({ received: update.size, total: update.size, percent: 100, status: '下载校验完成，正在准备安装…' });
    await prepareUpdateInstall({ installerPath, appPath: app.getPath('exe'), version: update.version, userData: app.getPath('userData') });
    sendUpdateProgress({ percent: 100, status: '正在打开安装程序，安装完成后将自动重启…' });
    quitting = true;
    setImmediate(() => app.quit());
    return { ok: true };
  } catch (error) {
    const message = describeUpdateError(error);
    if (updateWindow && !updateWindow.isDestroyed()) updateWindow.webContents.send('dayan:update-error', { message });
    return { ok: false, error: message };
  } finally { updateBusy = false; }
}

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
  const userData = app.getPath('userData');
  try { migrateLegacyBackups(userData, updateMode.test ? null : app.getPath('appData')); } catch (error) { console.error('Unable to migrate legacy policy backup:', error.message); }
  const script = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$os = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$productName = [string]$os.ProductName
$displayVersion = [string]$os.DisplayVersion
$build = [string]$os.CurrentBuild
$bootTime = ''
try { $cimOs = Get-CimInstance Win32_OperatingSystem -OperationTimeoutSec 3 -ErrorAction Stop; $productName = [string]$cimOs.Caption; $bootTime = $cimOs.LastBootUpTime.ToUniversalTime().ToString('o') } catch {
  if ($productName -match '^Windows 10\b' -and [int]$build -ge 22000 -and [int]$build -lt 28000) { $productName = $productName -replace '^Windows 10', 'Windows 11' }
}
$architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
$versionSupported = $productName -match '^(Microsoft )?Windows (10|11)\b'
$editionId = [string]$os.EditionID
$editionSupported = $editionId -match '(Enterprise|Education|IoT)'
$keyboardFilterAvailable = $false
$keyboardFilterEnabled = $false
$keyboardFilterError = ''
$administratorFiltering = $false
try {
  $keys = @(Get-CimInstance -Namespace 'root/standardcimv2/embedded' -ClassName WEKF_PredefinedKey -OperationTimeoutSec 3 -ErrorAction Stop)
  $secureKey = $keys | Where-Object { [string]$_.Id -eq 'Ctrl+Alt+Del' } | Select-Object -First 1
  $keyboardFilterAvailable = $null -ne $secureKey
  $keyboardFilterEnabled = $null -ne $secureKey -and [bool]$secureKey.Enabled
  $setting = @(Get-CimInstance -Namespace 'root/standardcimv2/embedded' -ClassName WEKF_Settings -OperationTimeoutSec 3 -ErrorAction Stop) | Where-Object { $_.Name -eq 'DisableKeyboardFilterForAdministrators' } | Select-Object -First 1
  $administratorFiltering = $null -ne $setting -and [string]$setting.Value -ieq 'false'
} catch { $keyboardFilterError = $_.Exception.Message }
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
  $rawValue = if ($null -ne $value) { [uint32]([long]$value -band 0xffffffffL) } else { $null }
  $policies += @{ name = $item.Name; enabled = ($rawValue -eq 1); exists = ($null -ne $value); value = $rawValue }
}
$policies += @{ name = 'KeyboardFilter_CtrlAltDelete'; enabled = $keyboardFilterEnabled }
[pscustomobject]@{ supported = ($versionSupported -and $architecture -eq 'x64'); fullProtectionSupported = ($versionSupported -and $architecture -eq 'x64' -and $editionSupported); versionSupported = $versionSupported; editionSupported = $editionSupported; editionId = $editionId; bootTime = $bootTime; administratorFiltering = $administratorFiltering; enabled = ($missing.Count -eq 0); keyboardFilterAvailable = $keyboardFilterAvailable; keyboardFilterEnabled = $keyboardFilterEnabled; keyboardFilterError = $keyboardFilterError; missing = @($missing); policies = @($policies); sid = $sid; productName = $productName; displayVersion = $displayVersion; build = $build; architecture = $architecture; osLabel = ("$productName $displayVersion ($architecture)").Trim() } | ConvertTo-Json -Depth 4 -Compress
`;
  try {
    const result = await runPowerShell(script);
    if (result.code !== 0) throw new Error(result.stderr || '无法读取 Windows 策略状态');
    const parsed = JSON.parse(result.stdout);
    if (!parsed.sid || !parsed.productName || !Array.isArray(parsed.policies) || parsed.policies.length !== 6) throw new Error('系统检测返回的数据不完整，请重新检测');
    let filterBackup;
    try { filterBackup = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'keyboard-filter-backup.json'), 'utf8').replace(/^\uFEFF/, '')); } catch {}
    const status = { ...parsed, restartRequired: Boolean(filterBackup?.PendingRestart && filterBackup.ChangedOnBoot === parsed.bootTime), appVersion: app.getVersion(), checkedAt: new Date().toISOString(), canRestore: hasBackups(userData), error: '' };
    let restoration = state.policyRestoration;
    try {
      const receipt = JSON.parse(fs.readFileSync(path.join(userData, 'policy-restoration.json'), 'utf8').replace(/^\uFEFF/, ''));
      if (receipt.version === 1) restoration = { at: receipt.at, policies: receipt.policy?.policies, filter: receipt.filter };
    } catch {}
    status.restored = !status.canRestore && matchesRestoredPolicies(status, restoration);
    return status;
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
  if (!status.sid) return { ok: false, status, error: '无法识别当前 Windows 用户，请重新启动后重试' };
  if (action === 'enable' && !status.restored && status.enabled && status.keyboardFilterEnabled && status.administratorFiltering) return { ok: true, status };
  const jobDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'dayan-authorization-'));
  try {
    for (const filename of ['authorize-dayan.ps1', 'enable-dayan-lockdown.ps1', 'restore-dayan-lockdown.ps1', 'enable-dayan-keyboard-filter.ps1', 'restore-dayan-keyboard-filter.ps1']) {
      const source = fs.readFileSync(path.join(__dirname, '../scripts', filename), 'utf8');
      fs.writeFileSync(path.join(jobDir, filename), '\uFEFF' + source.replace(/^\uFEFF/, ''), 'utf8');
    }
    const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', `"${path.join(jobDir, 'authorize-dayan.ps1')}"`, '-Action', action, '-UserSid', status.sid, '-BackupDirectory', `"${app.getPath('userData')}"`].join(' ');
    const result = await runPowerShell(`
try {
  $child = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe') -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList ${powershellLiteral(args)}
  if ($null -eq $child) { exit 1223 }
  exit $child.ExitCode
} catch { exit 1223 }
`, 600000);
    let outcome;
    try { outcome = JSON.parse(fs.readFileSync(path.join(jobDir, 'result.json'), 'utf8').replace(/^\uFEFF/, '')); } catch {}
    const next = await windowsLockdownStatus();
    if (result.code !== 0 || !outcome?.ok) return { ok: false, status: next, error: outcome?.error || (result.code === 1223 ? 'Windows 授权未完成或被取消，可再次点击重试' : '授权辅助程序没有完成，请重新检测') };
    const restoration = { at: new Date().toISOString(), policies: outcome.policy?.policies, filter: outcome.filter };
    const verified = action === 'restore' ? !next.error && !next.canRestore && matchesRestoredPolicies(next, restoration) : !next.error && next.enabled;
    if (!verified) return { ok: false, status: next, error: '系统操作后的复检未通过，请重新检测；未完成项的备份会保留' };
    state.policyRestoration = action === 'restore' ? restoration : null;
    next.restored = action === 'restore';
    flushState();
    const stage = outcome.filter?.stage;
    const notice = stage === 'restart-required' ? 'Windows 组件已开启，请保存工作并重启电脑，随后在此继续配置安全序列规则。当前尚未生效。'
      : stage === 'unsupported' ? '基础策略已配置。当前 Windows 版本不提供 Keyboard Filter，管理员授权也不能增加此组件，Ctrl+Alt+Delete 仍可打开系统安全界面。'
      : outcome.filter?.signInRequired ? '系统安全序列规则已配置。请保存工作、注销并重新登录后，再用实体键盘验收。'
      : action === 'restore' ? '恢复成功：已逐项核对授权前的原始策略。如需再次启用，请点击“重新授权”。部分 Windows 快捷键可能需要注销并重新登录后恢复。' : '系统安全序列规则已配置，请在目标设备使用实体键盘验收。';
    return { ok: true, status: next, notice };
  } catch (error) { return { ok: false, status: await windowsLockdownStatus(), error: error.message }; }
  finally {
    for (const filename of fs.readdirSync(jobDir)) fs.rmSync(path.join(jobDir, filename), { force: true });
    fs.rmdirSync(jobDir);
  }
}

function readState() {
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) state = saved;
  } catch {}
  state.displaySettings = normalizeDisplaySettings(state.displaySettings || DEFAULT_DISPLAY_SETTINGS);
  state.windowLayers = normalizeWindowLayers(state.windowLayers);
  state.autoStart = state.autoStart !== false;
}

function flushState() {
  clearTimeout(saveTimer);
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    const temporary = stateFile() + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(state));
    fs.renameSync(temporary, stateFile());
    return true;
  } catch (error) { console.error('Unable to save preferences:', error.message); return false; }
}

function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(flushState, 150); }
function trusted(event) { return Boolean((mainWindow && event.sender === mainWindow.webContents) || event.sender === presentationEditor.window?.webContents); }
function broadcastPreferences(sender) {
  for (const win of [mainWindow, presentationEditor.window]) if (win && !win.isDestroyed() && win.webContents !== sender) win.webContents.send('dayan:preferences', { widget: state.widget, style: state.style, displaySettings: state.displaySettings, windowLayers: state.windowLayers, autoStart: state.autoStart });
}
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
  return { locked: securityLocked, passwordConfigured: Boolean(passwordRecord()), recoveryConfigured: recovery.valid(state.security?.recovery), recoveryQuestionId: state.security?.recovery?.question || '', recoveryQuestion: recovery.QUESTIONS.find(item => item.id === state.security?.recovery?.question)?.label || '', recoveryQuestions: recovery.QUESTIONS, lockShortcut: state.lockShortcut || '', shortcutError, keyboardGuardActive: process.platform === 'win32' ? Boolean(keyboardGuard?.isActive()) : null };
}
function configureLockShortcut(value) {
  if (typeof value !== 'string' || value.length > 60) return { ok: false, error: '快捷键无效' };
  const parts = value.split('+'), key = parts.pop();
  if (value && (!/^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4]))$/.test(key) || !parts.length || parts.some(mod => !['Control', 'Alt', 'Shift'].includes(mod)) || new Set(parts).size !== parts.length || !parts.some(mod => ['Control', 'Alt'].includes(mod)))) return { ok: false, error: '请使用 Ctrl 或 Alt 搭配字母、数字或功能键' };
  const next = value ? [...['Control', 'Alt', 'Shift'].filter(mod => parts.includes(mod)), key].join('+') : '';
  const previous = state.lockShortcut || '';
  if (next && !(next === previous && globalShortcut.isRegistered(next))) {
    if (globalShortcut.isRegistered(next)) return { ok: false, error: '该快捷键已被系统或其他程序占用，请更换组合' };
    try {
      if (!globalShortcut.register(next, () => {
        if (securityLocked || lockStarting) return;
        if (!passwordRecord() || !recovery.valid(state.security?.recovery)) presentationEditor.open('lock-settings').catch(console.error);
        else lockDesktop().catch(error => console.error('Shortcut lock failed:', error.message));
      })) return { ok: false, error: '该快捷键已被系统或其他程序占用，请更换组合' };
    } catch { return { ok: false, error: '该快捷键无法注册，请更换组合' }; }
  }
  if (previous && previous !== next && globalShortcut.isRegistered(previous)) globalShortcut.unregister(previous);
  state.lockShortcut = next;
  shortcutError = '';
  return { ok: true, shortcut: next };
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
  if (!presentationRequested) presentationDisplayId = screen.getDisplayMatching(mainWindow.getBounds()).id;
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
  mainWindow.setSkipTaskbar(updateMode.hideWindow);
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
async function leavePresentation() {
  presentationRequested = false;
  restoringBounds = true;
  wallpaperControls?.hide();
  if (desktopHostDesired || desktopWindowHosted) await setDesktopWindowMode(false);
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setKiosk(false);
  mainWindow.setFullScreen(false);
  mainWindow.setSkipTaskbar(updateMode.hideWindow);
  queueWindowedRestore();
}

async function runTrayAction(action) {
  if (!mainWindow || mainWindow.isDestroyed() || securityLocked || trayActionBusy) return false;
  clearTimeout(desktopReconcileTimer);
  if (action === 'exit') {
    quitting = true;
    app.quit();
    return true;
  }
  trayActionBusy = true;
  try {
    const command = { settings: 'settings-toggle', style: 'style-toggle', background: 'background', lock: 'lock-settings' }[action];
    if (command && (isPresentationFullscreen() || action === 'lock')) { await presentationEditor.open(command); return true; }
    presentationEditor.close();
    if (isPresentationFullscreen()) await leavePresentation();
    await new Promise(resolve => setTimeout(resolve, 140));
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    if (action === 'settings') mainWindow.webContents.send('dayan:desktop-command', 'settings-toggle');
    if (action === 'style') mainWindow.webContents.send('dayan:desktop-command', 'style-toggle');
    if (action === 'background') mainWindow.webContents.send('dayan:desktop-command', 'background');
    return true;
  } finally {
    trayActionBusy = false;
  }
}

function reconcileDesktopPresentation() {
  clearTimeout(desktopReconcileTimer);
  desktopReconcileTimer = setTimeout(async () => {
    if (trayActionBusy || !mainWindow || mainWindow.isDestroyed() || securityLocked || !isPresentationFullscreen() || fullscreenLayer() !== 'bottom' || !desktopHost) return;
    try {
      await setDesktopWindowMode(true, presentationArea());
      if (!mainWindow || mainWindow.isDestroyed()) return;
      notify();
    } catch (error) {
      console.error('Unable to reconcile desktop presentation after tray menu:', error.message);
    }
  }, 120);
}

function startTrayPresentationReconcile() {
  clearInterval(trayReconcileInterval);
  reconcileDesktopPresentation();
  trayReconcileInterval = setInterval(() => reconcileDesktopPresentation(), 260);
}

function stopTrayPresentationReconcile() {
  clearInterval(trayReconcileInterval);
  trayReconcileInterval = null;
  reconcileDesktopPresentation();
}

function refreshTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const enabled = !securityLocked && Boolean(mainWindow && !mainWindow.isDestroyed());
  if (trayMenu) {
    for (const item of trayMenu.items) if (item.type !== 'separator') item.enabled = enabled;
    return;
  }
  trayMenu = Menu.buildFromTemplate([
    { label: '设置', enabled, click: () => runTrayAction('settings').catch(error => console.error('Tray settings failed:', error.message)) },
    { label: '切换样式', enabled, click: () => runTrayAction('style').catch(error => console.error('Tray style menu failed:', error.message)) },
    { label: '切换背景', enabled, click: () => runTrayAction('background').catch(error => console.error('Tray background menu failed:', error.message)) },
    { label: '锁屏', enabled, click: () => runTrayAction('lock').catch(error => console.error('Tray lock menu failed:', error.message)) },
    { label: '最小化（回到窗口）', enabled, click: () => runTrayAction('minimize').catch(error => console.error('Tray minimize failed:', error.message)) },
    { type: 'separator' },
    { label: '退出', enabled, click: () => runTrayAction('exit').catch(error => console.error('Tray exit failed:', error.message)) }
  ]);
  trayMenu.on('menu-will-show', () => { if (!trayActionBusy) startTrayPresentationReconcile(); });
  trayMenu.on('menu-will-close', () => { if (!trayActionBusy) stopTrayPresentationReconcile(); });
  tray.setContextMenu(trayMenu);
  if (process.env.DAYAN_TEST === '1') globalThis.__dayanTrayMenu = trayMenu;
}

function createTray() {
  if (tray || process.platform === 'linux') return;
  tray = new Tray(path.join(__dirname, '../assets/icon.png'));
  if (process.env.DAYAN_TEST === '1') globalThis.__dayanTray = tray;
  tray.setToolTip(APP_NAME);
  tray.on('double-click', () => runTrayAction('minimize').catch(error => console.error('Tray restore failed:', error.message)));
  refreshTrayMenu();
}

function fullscreenLayer() {
  const layers = normalizeWindowLayers(state.windowLayers);
  return layers[securityLocked ? 'locked' : 'unlocked'];
}

function presentationDisplay() {
  const display = screen.getAllDisplays().find(item => item.id === presentationDisplayId) || screen.getDisplayMatching(mainWindow.getBounds());
  presentationDisplayId = display.id;
  return display;
}

function presentationArea() {
  if (normalizeWindowLayers(state.windowLayers).displayScope !== 'all') return presentationDisplay();
  const displays = screen.getAllDisplays();
  const left = Math.min(...displays.map(item => item.bounds.x));
  const top = Math.min(...displays.map(item => item.bounds.y));
  const right = Math.max(...displays.map(item => item.bounds.x + item.bounds.width));
  const bottom = Math.max(...displays.map(item => item.bounds.y + item.bounds.height));
  return { id: 'all-displays', bounds: { x: left, y: top, width: right - left, height: bottom - top } };
}

function presentationLayout() {
  const layers = normalizeWindowLayers(state.windowLayers);
  const area = presentationArea();
  const contentDisplay = layers.displayScope === 'all' ? screen.getPrimaryDisplay() : presentationDisplay();
  return {
    scope: layers.displayScope,
    area: { ...area.bounds },
    content: { ...contentDisplay.bounds },
    displays: screen.getAllDisplays().map(display => ({ id: display.id, bounds: { ...display.bounds } })),
    primaryDisplayId: screen.getPrimaryDisplay().id
  };
}

function setDesktopWindowMode(hosted, display) {
  if (!desktopHost || !mainWindow || mainWindow.isDestroyed()) return Promise.resolve();
  desktopHostDesired = hosted;
  const request = ++desktopHostRequest;
  const window = mainWindow;
  desktopHostQueue = desktopHostQueue.catch(() => {}).then(async () => {
    if (request !== desktopHostRequest || window.isDestroyed()) return;
    if (hosted) {
      const area = (display || presentationArea()).bounds;
      const attempts = openedAtLogin && !desktopWindowHosted ? 12 : 1;
      for (let attempt = 0; attempt < attempts; attempt++) {
        if (request !== desktopHostRequest || window.isDestroyed()) return;
        try { await desktopHost.attach(window, screen.dipToScreenRect(window, area)); break; }
        catch (error) {
          if (attempt + 1 === attempts || !/icon layer was not found|desktop parenting|desktop parent changed/i.test(error.message)) throw error;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }
    else await desktopHost.detach(window);
    desktopWindowHosted = hosted;
    if (request === desktopHostRequest) notify();
  }).catch(async error => {
    if (request !== desktopHostRequest || window.isDestroyed()) return;
    desktopHostDesired = desktopWindowHosted;
    console.error('Unable to apply desktop window mode:', error.message);
    if (hosted && !window.isDestroyed()) {
      await desktopHost.detach(window).catch(detachError => console.error('Unable to detach desktop window:', detachError.message));
      desktopHostDesired = desktopWindowHosted = false;
      presentationRequested = false;
      window.setIgnoreMouseEvents(false);
      window.setKiosk(false);
      window.setFullScreen(false);
      queueWindowedRestore();
      dialog.showMessageBox(window, { type:'warning', message:'暂时无法启用桌面模式', detail:'已返回普通窗口。请确认 Windows 资源管理器正在运行后重试。', buttons:['确定'] }).catch(() => {});
    }
  });
  return desktopHostQueue;
}

function applyPresentationWindow(refreshBounds = false) {
  if (!mainWindow || mainWindow.isDestroyed() || !isPresentationFullscreen()) return;
  const display = presentationArea();
  if (fullscreenLayer() === 'bottom' && !securityLocked && desktopHost) {
    mainWindow.setSkipTaskbar(true);
    if (!desktopHostDesired && !desktopWindowHosted) {
      // A desktop child must not retain a monitor-scoped native fullscreen state.
      mainWindow.setFullScreen(false);
      mainWindow.setAlwaysOnTop(false);
    }
    if (!desktopHostDesired || refreshBounds) return setDesktopWindowMode(true, display);
    return desktopHostQueue;
  } else {
    const apply = () => {
      if (!mainWindow || mainWindow.isDestroyed() || !isPresentationFullscreen()) return;
      if (desktopWindowHosted) return;
      mainWindow.setIgnoreMouseEvents(false);
      const virtualDesktop = display.id === 'all-displays';
      // Electron kiosk/fullscreen is monitor-scoped on Windows. For an all-display
      // presentation, keep the frameless window borderless and size it to the
      // virtual desktop so the lock surface also covers secondary monitors.
      mainWindow.setKiosk(securityLocked && !virtualDesktop);
      mainWindow.setFullScreen(!virtualDesktop);
      mainWindow.setSkipTaskbar(true);
      mainWindow.setBounds(display.bounds, false);
      mainWindow.setAlwaysOnTop(fullscreenLayer() !== 'bottom', securityLocked ? 'screen-saver' : 'floating');
      if (securityLocked) mainWindow.focus();
    };
    if (desktopHostDesired || desktopWindowHosted) return setDesktopWindowMode(false).then(apply);
    else apply();
  }
}

function restorePinnedState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (isPresentationFullscreen()) {
    if (fullscreenLayer() === 'bottom' && !securityLocked && desktopHost) {
      if (!desktopHostDesired && !desktopWindowHosted) mainWindow.setAlwaysOnTop(false);
      if (!desktopHostDesired) setDesktopWindowMode(true);
    } else {
      mainWindow.setAlwaysOnTop(fullscreenLayer() !== 'bottom', securityLocked ? 'screen-saver' : 'floating');
    }
    return;
  }
  if (desktopHostDesired || desktopWindowHosted) { setDesktopWindowMode(false).then(restorePinnedState); return; }
  if (securityLocked) mainWindow.setAlwaysOnTop(true, 'screen-saver');
  else mainWindow.setAlwaysOnTop(state.pinned === true);
}
function notify() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  refreshTrayMenu();
  mainWindow.webContents.send('dayan:window-state', { pinned: state.pinned === true, fullscreen: isPresentationFullscreen(), desktopHosted: desktopWindowHosted, windowLayers: normalizeWindowLayers(state.windowLayers), presentationLayout: presentationLayout(), ...securitySnapshot() });
  presentationEditor.window?.webContents.send('dayan:window-state', { pinned: false, fullscreen: false, ...securitySnapshot() });
}

function setupIPC() {
  ipcMain.handle('dayan:editor-ready', event => presentationEditor.ready(event.sender));
  ipcMain.handle('dayan:editor-close', event => { if (event.sender === presentationEditor.window?.webContents) presentationEditor.close(); });
  ipcMain.handle('dayan:lock-shortcut', (event, value) => {
    if (!trusted(event) || securityLocked || lockStarting) return { ok: false, error: '请先解锁桌面' };
    const result = configureLockShortcut(value);
    if (result.ok) { flushState(); notify(); }
    return result;
  });
  ipcMain.handle('dayan:load', event => trusted(event) ? { widget: state.widget, style: state.style, displaySettings: state.displaySettings, windowLayers: normalizeWindowLayers(state.windowLayers), presentationLayout: presentationLayout(), autoStart: state.autoStart !== false, appVersion: app.getVersion(), showSettingsOnStartup: state.settingsGuideVersion !== 1, pinned: state.pinned === true, fullscreen: isPresentationFullscreen(), ...securitySnapshot() } : null);
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
    if (Number.isInteger(payload.style) && payload.style >= 0 && payload.style < 14) state.style = payload.style;
    if (payload.displaySettings && typeof payload.displaySettings === 'object') state.displaySettings = normalizeDisplaySettings(payload.displaySettings);
    if (payload.windowLayers && typeof payload.windowLayers === 'object') state.windowLayers = normalizeWindowLayers(payload.windowLayers);
    if (typeof payload.autoStart === 'boolean') state.autoStart = applyAutoStart(payload.autoStart);
    if (isPresentationFullscreen()) applyPresentationWindow(); else restorePinnedState();
    flushState();
    broadcastPreferences(event.sender);
    return true;
  });
  ipcMain.on('dayan:save-sync', (event, payload) => {
    event.returnValue = false;
    if (!trusted(event) || !payload || typeof payload !== 'object' || JSON.stringify(payload).length > 16384) return;
    if (payload.widget?.privateContent?.version === 2) state.widget = payload.widget;
    if (Number.isInteger(payload.style) && payload.style >= 0 && payload.style < 14) state.style = payload.style;
    if (payload.displaySettings && typeof payload.displaySettings === 'object') state.displaySettings = normalizeDisplaySettings(payload.displaySettings);
    if (payload.windowLayers && typeof payload.windowLayers === 'object') state.windowLayers = normalizeWindowLayers(payload.windowLayers);
    if (typeof payload.autoStart === 'boolean') state.autoStart = applyAutoStart(payload.autoStart);
    if (isPresentationFullscreen()) applyPresentationWindow(); else restorePinnedState();
    flushState();broadcastPreferences(event.sender);event.returnValue = true;
  });
  ipcMain.handle('dayan:auto-start', (event, enabled) => {
    if (!trusted(event) || securityLocked || typeof enabled !== 'boolean') return { ok: false, enabled: state.autoStart !== false, error: '请求无效' };
    state.autoStart = applyAutoStart(enabled);
    flushState();
    return { ok: true, enabled: state.autoStart };
  });
  ipcMain.handle('dayan:update-ready', event => {
    if (event.sender === updateWindow?.webContents) return { available:Boolean(updateInfo), ...updateInfo };
    if (!trusted(event)) return null;
    if (!rendererReady) {
      rendererReady = true;
      scheduleAutomaticUpdate();
      if (!process.argv.includes('--dayan-update-recovery')) dailyUpdateSchedule.start();
    }
    return { available:false };
  });
  ipcMain.handle('dayan:update-online', event => {
    if (!trusted(event)) return false;
    automaticUpdateAttempt = 0;
    scheduleAutomaticUpdate(500);
    return true;
  });
  ipcMain.handle('dayan:update-check', async event => {
    if (!trusted(event) || securityLocked) return { available:false, error:'请先解锁时钟' };
    const result = await checkForUpdates();
    if (result.available) offerUpdate({ manual:true });
    return result;
  });
  ipcMain.handle('dayan:update-dismiss', (event, action) => {
    if (!updateSender(event) || !['today', 'cancel'].includes(action) || securityLocked || updateBusy) return { ok:false, error:'更新正在安装或请求无效' };
    if (action === 'today') {
      const previous = state.updateReminderDate;
      state.updateReminderDate = localUpdateDate();
      if (!flushState()) { state.updateReminderDate = previous; return { ok:false, error:'提醒设置保存失败，请重试' }; }
    }
    updateDismissed = true;
    return { ok:true };
  });
  ipcMain.on('dayan:update-close', event => {
    if (event.sender === updateWindow?.webContents && !securityLocked && !updateBusy) updateWindow.close();
  });
  ipcMain.handle('dayan:update-install', event => updateSender(event) && !securityLocked ? downloadAndInstallUpdate() : { ok: false, error: '请先解锁时钟' });
  ipcMain.handle('dayan:window-action', async (event, action) => {
    if (!trusted(event) || securityLocked) return false;
    if (action === 'minimize') mainWindow.minimize();
    if (action === 'close') mainWindow.close();
    if (action === 'pin') {
      state.pinned = !(state.pinned === true);
      mainWindow.setAlwaysOnTop(state.pinned);
      scheduleSave();
    }
    if (action === 'fullscreen') {
      if (isPresentationFullscreen()) await leavePresentation();
      else { preparePresentation(); await applyPresentationWindow(); }
    }
    notify();
    return true;
  });
  ipcMain.handle('dayan:security-set-password', (event, payload) => {
    if (!trusted(event) || securityLocked || lockStarting || !payload || typeof payload !== 'object') return { ok: false, error: '请求无效' };
    const current = typeof payload.current === 'string' ? payload.current : '';
    const next = typeof payload.next === 'string' ? payload.next : '';
    if (!/^\d{4,16}$/.test(next)) return { ok: false, error: '密码必须是 4 至 16 位数字' };
    if (passwordRecord() && !verifyPassword(current)) return { ok: false, error: '当前密码不正确' };
    let question = state.security?.recovery;
    if (!recovery.valid(question) || payload.recovery?.answer) {
      try { question = recovery.create(payload.recovery?.question, payload.recovery?.answer); }
      catch (error) { return { ok: false, error: error.message }; }
    }
    const salt = crypto.randomBytes(16).toString('hex');
    state.security = { salt, hash: derivePassword(next, salt), iterations: PASSWORD_ITERATIONS, recovery: question };
    recoveryGrant = null;
    flushState();
    notify();
    return { ok: true, ...securitySnapshot() };
  });
  ipcMain.handle('dayan:recovery-input', (event, enabled) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || !securityLocked) return false;
    recoveryEditing = enabled === true;
    keyboardGuard?.setTextInput(recoveryEditing);
    return true;
  });
  ipcMain.handle('dayan:recovery-verify', (event, answer) => {
    if (!trusted(event) || lockStarting || (securityLocked && event.sender !== mainWindow?.webContents)) return { ok: false, error: '请求无效' };
    recoveryGrant = null;
    const text = typeof answer === 'string' ? answer : answer?.question === state.security?.recovery?.question ? answer.answer : '';
    const result = recovery.verify(state.security?.recovery, text);
    flushState();
    if (!result.ok) return result;
    recoveryGrant = { token: crypto.randomBytes(32).toString('hex'), sender: event.sender.id, locked: securityLocked, expires: Date.now() + 300000 };
    return { ok: true, token: recoveryGrant.token };
  });
  ipcMain.handle('dayan:recovery-reset', (event, payload) => {
    if (!trusted(event) || lockStarting || !recoveryGrant || recoveryGrant.locked !== securityLocked || recoveryGrant.sender !== event.sender.id || recoveryGrant.expires < Date.now() || payload?.token !== recoveryGrant.token) return { ok: false, error: '验证已失效，请重新回答密保问题' };
    if (!/^\d{4,16}$/.test(payload?.next)) return { ok: false, error: '密码必须是 4 至 16 位数字' };
    const salt = crypto.randomBytes(16).toString('hex');
    state.security = { salt, hash: derivePassword(payload.next, salt), iterations: PASSWORD_ITERATIONS, recovery: state.security.recovery };
    recoveryGrant = null;
    flushState();
    notify();
    return { ok: true };
  });
  ipcMain.handle('dayan:security-unlock-input', (event, enabled) => {
    if (!trusted(event) || !securityLocked || typeof enabled !== 'boolean') return false;
    unlockInputEnabled = enabled;
    keyboardGuard?.setInput(enabled);
    return true;
  });
  ipcMain.handle('dayan:security-keyboard', async event => {
    if (!trusted(event) || !securityLocked || !unlockInputEnabled || process.platform !== 'win32') return { ok: false };
    return new Promise(resolve => {
      const child = spawn(path.join(process.env.SystemRoot, 'System32', 'osk.exe'), [], { detached: true, stdio: 'ignore' });
      child.once('error', () => resolve({ ok: false }));
      child.once('spawn', () => { child.unref(); resolve({ ok: true }); });
    });
  });
  lockDesktop = async () => {
    if (!passwordRecord() || !recovery.valid(state.security?.recovery) || policyOperation || lockStarting || securityLocked) return false;
    lockStarting = true;
    unlockInputEnabled = false;
    try {
      if (process.platform === 'win32') {
        if (!keyboardGuard) throw Error('Keyboard guard unavailable.');
        await keyboardGuard.start(mainWindow);
      }
    } catch (error) {
      lockStarting = false;
      await keyboardGuard?.stop();
      console.error('Unable to start keyboard protection:', error.message);
      dialog.showMessageBox(mainWindow, { type:'warning', message:'无法启用键盘保护，尚未上锁', detail:'请重新安装当前版本后重试。', buttons:['确定'] }).catch(() => {});
      return false;
    }
    lockStarting = false;
    if (!mainWindow || mainWindow.isDestroyed() || quitting) { await keyboardGuard?.stop(); return false; }
    // Preserve the ordinary window before kiosk expands its native bounds.
    fullscreenBeforeLock = isPresentationFullscreen();
    preparePresentation();
    securityLocked = true;
    recoveryGrant = null;
    presentationEditor.close();
    updateWindow?.hide();
    resizeSession = null;
    mainWindow.setMinimizable(false);
    mainWindow.setResizable(false);
    mainWindow.setSkipTaskbar(true);
    const forceKiosk = async () => {
      if (!mainWindow || mainWindow.isDestroyed() || !securityLocked) return;
      await applyPresentationWindow();
      if (!mainWindow || mainWindow.isDestroyed() || !securityLocked) return;
      mainWindow.show();
      mainWindow.focus();
      restorePinnedState();
      notify();
    };
    await forceKiosk();
    return true;
  };
  ipcMain.handle('dayan:security-lock', event => trusted(event) ? lockDesktop() : false);
  ipcMain.handle('dayan:security-verify', async (event, password) => {
    if (!trusted(event) || !securityLocked || !verifyPassword(password)) return false;
    securityLocked = false;
    recoveryGrant = null; recoveryEditing = false;
    unlockInputEnabled = false;
    await keyboardGuard?.stop();
    mainWindow.setMinimizable(true);
    mainWindow.setResizable(true);
    if (fullscreenBeforeLock) {
      // Exit kiosk protection, not the user's pre-existing wallpaper presentation.
      mainWindow.setKiosk(false);
      await applyPresentationWindow(true);
      restorePinnedState();
    } else await leavePresentation();
    fullscreenBeforeLock = false;
    notify();
    offerUpdate();
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
    title: updateMode.fixtureUrl ? `${APP_NAME} · 本地更新测试` : APP_NAME, icon: path.join(__dirname, '../assets/icon.png'),
    skipTaskbar: updateMode.hideWindow,
    frame: false, thickFrame: false, resizable: true, maximizable: false, fullscreenable: true,
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
    if (presentationRequested || securityLocked) { applyPresentationWindow(); notify(); }
    else queueWindowedRestore();
  });
  mainWindow.once('ready-to-show', () => {
    state.lastStartup = { startedAt: new Date(launchedAt).toISOString(), readyMs: Date.now() - launchedAt, login: openedAtLogin };
    if (!updateMode.hideWindow) mainWindow.show();
    restoreWindowedBounds();
    if (openedAtLogin && state.autoStart !== false && !updateMode.fixtureUrl) {
      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed() || securityLocked || isPresentationFullscreen()) return;
        preparePresentation();
        Promise.resolve(applyPresentationWindow()).then(() => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          if (!desktopWindowHosted) { mainWindow.show(); mainWindow.focus(); }
          state.lastStartup.presentationMs = Date.now() - launchedAt;
          scheduleSave();
          notify();
        }).catch(error => console.error('Unable to restore presentation at login:', error.message));
      }, 220);
    }
  });
  mainWindow.on('close', event => {
    if (securityLocked && !quitting) { event.preventDefault(); return; }
    flushState();
  });
  mainWindow.on('closed', () => { clearTimeout(restoreBoundsTimer); keyboardGuard?.stop(); wallpaperControls?.destroy(); wallpaperControls = null; mainWindow = null; updateWindow?.destroy(); });
  mainWindow.on('unresponsive', () => { keyboardGuard?.stop().then(notify); });
  mainWindow.webContents.on('render-process-gone', () => { keyboardGuard?.stop().then(notify); });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (securityLocked && (['F11', 'Escape'].includes(input.key) || (input.alt && input.key === 'F4') || (input.control && input.shift && input.key === 'Escape'))) event.preventDefault();
    if (securityLocked) {
      const allowed = unlockInputEnabled && !input.control && !input.alt && !input.meta && (recoveryEditing ? input.key.length === 1 || ['Backspace', 'Enter', 'Shift', 'Process', 'Unidentified'].includes(input.key) : !input.shift && (/^\d$/.test(input.key) || ['Backspace', 'Enter'].includes(input.key)));
      if (!allowed) event.preventDefault();
    }
    if ((input.control || input.meta) && ['+', '-', '=', '0'].includes(input.key)) event.preventDefault();
  });
  mainWindow.loadFile(path.join(__dirname, '../index.html'));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', async () => {
    if (!mainWindow) return;
    scheduleAutomaticUpdate();
    if (!securityLocked && (desktopHostDesired || desktopWindowHosted)) await leavePresentation();
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show(); mainWindow.focus();
  });
  app.whenReady().then(() => {
    readState();
    applyAutoStart(state.autoStart !== false);
    try {
      openedAtLogin = process.argv.includes('--dayan-login-start') || (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin === true);
    } catch (error) { console.error('Unable to inspect login launch state:', error.message); }
    if (process.platform === 'win32') {
      try { desktopHost = createDesktopHost(app.getPath('userData')); }
      catch (error) { console.error('Desktop host unavailable:', error.message); }
      try {
        keyboardGuard = createKeyboardGuard(app.getPath('userData'), {
          onKey: key => { if (securityLocked && unlockInputEnabled && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('dayan:unlock-key', key); },
          onStopped: () => { if (securityLocked) { unlockInputEnabled = false; notify(); } }
        });
      } catch (error) { console.error('Keyboard guard unavailable:', error.message); }
    }
    setupIPC();
    powerMonitor.on('resume', () => dailyUpdateSchedule.tick());
    if (process.env.DAYAN_TEST === '1') globalThis.__dayanUpdateSchedule = dailyUpdateSchedule;
    if (state.lockShortcut) {
      const result = configureLockShortcut(state.lockShortcut);
      if (!result.ok) shortcutError = result.error;
    }
    createWindow(); createTray();
    if (desktopHost) wallpaperControls = createWallpaperControls({
      host: desktopHost,
      enabled: () => Boolean(mainWindow && !mainWindow.isDestroyed() && desktopWindowHosted && !securityLocked && presentationRequested && !mainWindow.isMinimized()),
      onAction: async action => {
        if (action === 'close') { mainWindow.close(); return; }
        if (['settings-toggle', 'style-toggle', 'background'].includes(action)) { await presentationEditor.open(action); return; }
        if (action === 'lock' && passwordRecord()) { mainWindow.webContents.send('dayan:desktop-command', action); return; }
        await leavePresentation();
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (action === 'minimize') { mainWindow.minimize(); return; }
        mainWindow.show(); mainWindow.focus();
        if (action !== 'fullscreen') mainWindow.webContents.send('dayan:desktop-command', action);
      }
    });
    const updateDisplayBounds = async () => {
      presentationEditor.close();
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
      if (isPresentationFullscreen()) await applyPresentationWindow(true);
      else await queueWindowedRestore();
      notify();
    };
    screen.on('display-metrics-changed', updateDisplayBounds);
    screen.on('display-added', updateDisplayBounds);
    screen.on('display-removed', updateDisplayBounds);
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => {
    quitting = true;
    globalShortcut.unregisterAll();
    presentationEditor.close();
    clearTimeout(desktopReconcileTimer);
    clearTimeout(automaticUpdateTimer);
    dailyUpdateSchedule.stop();
    clearInterval(trayReconcileInterval);
    tray?.destroy();
    tray = null;
    trayMenu = null;
    keyboardGuard?.stop();
    flushState();
  });
}
