const { app, BrowserWindow, ipcMain, screen, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { RATIO, MIN_WIDTH, corners, fitBounds, resizeFromCorner } = require('./window-geometry.cjs');

const APP_NAME = 'DAYAN桌面';
const DEFAULT_WINDOW_LAYERS = Object.freeze({ unlocked: 'top', locked: 'top' });
app.setName(APP_NAME);
app.setAppUserModelId('com.dayan.clock');
if (process.env.DAYAN_TEST === '1' && process.env.DAYAN_TEST_DATA) app.setPath('userData', process.env.DAYAN_TEST_DATA);
const PASSWORD_ITERATIONS = 210000;
const UPDATE_REPOSITORY_API = 'https://api.github.com/repos/jyan5334-lab/dayan-clock/releases/latest';
const DEFAULT_DISPLAY_SETTINGS = Object.freeze({ showAlmanac: true, modes: Object.freeze({ clock: false, watch: true, down: true, up: true }) });
let mainWindow, state = {}, resizeSession, saveTimer, securityLocked = false, quitting = false;
let windowedBounds, presentationRequested = false, restoringBounds = false, restoreBoundsTimer, desktopWindowHosted = false;
let updateInfo = null, updateBusy = false, updateCheckPromise;
const stateFile = () => path.join(app.getPath('userData'), 'preferences.json');
const lockdownScript = () => path.join(__dirname, '../scripts/enable-dayan-lockdown.ps1');

function normalizeDisplaySettings(value) {
  const modes = value?.modes && typeof value.modes === 'object' ? value.modes : {};
  return { showAlmanac: value?.showAlmanac !== false, modes: { clock: modes.clock === true, watch: modes.watch !== false, down: modes.down !== false, up: modes.up !== false } };
}

function normalizeWindowLayers(value) {
  return {
    unlocked: value?.unlocked === 'bottom' ? 'bottom' : DEFAULT_WINDOW_LAYERS.unlocked,
    locked: value?.locked === 'bottom' ? 'bottom' : DEFAULT_WINDOW_LAYERS.locked
  };
}

function applyAutoStart(enabled) {
  const value = enabled !== false;
  if (process.env.DAYAN_TEST === '1') return value;
  try { app.setLoginItemSettings({ openAtLogin: value, path: process.execPath, args: [] }); }
  catch (error) { console.error('Unable to configure auto-start:', error.message); }
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

function normalizeUpdatePayload(payload) {
  if (payload?.tag_name || payload?.name) {
    const version = String(payload.tag_name || payload.name).replace(/^v/i, '');
    const asset = Array.isArray(payload.assets) ? payload.assets.find(item => item.name === `DAYANClock-Setup-${version}-x64.exe`) : null;
    if (!asset?.browser_download_url) return null;
    return { version, title: payload.name || `DAYAN桌面 ${version}`, notes: String(payload.body || '').trim(), publishedAt: payload.published_at || payload.created_at || '', downloadUrl: asset.browser_download_url, assetApiUrl: asset.url || '', mirrorUrls: [], sha256: typeof asset.digest === 'string' ? asset.digest.replace(/^sha256:/i, '') : '', size: Number(asset.size) || 0, releaseUrl: payload.html_url || '' };
  }
  if (payload?.version && payload?.downloadUrl) {
    const mirrors = Array.isArray(payload.mirrorUrls) ? payload.mirrorUrls.filter(value => typeof value === 'string' && value.trim()) : [];
    return { version: String(payload.version).replace(/^v/i, ''), title: payload.title || `DAYAN桌面 ${payload.version}`, notes: String(payload.notes || '').trim(), publishedAt: payload.publishedAt || '', downloadUrl: String(payload.downloadUrl), assetApiUrl: String(payload.assetApiUrl || ''), mirrorUrls: mirrors, sha256: String(payload.sha256 || '').replace(/^sha256:/i, ''), size: Number(payload.size) || 0, releaseUrl: String(payload.releaseUrl || '') };
  }
  return null;
}

function sendUpdateProgress(progress) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('dayan:update-progress', progress);
}

function describeUpdateError(error) {
  const code = error?.cause?.code || '';
  const message = String(error?.message || '');
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError' || /timed out|timeout/i.test(message)) {
    return '连接更新服务器超时。请检查网络后重试；如果仍然失败，请配置可访问的镜像更新源。';
  }
  if (message === 'fetch failed' || ['ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN', 'ENOTFOUND'].includes(code)) {
    return '无法连接更新下载服务器。中国网络下 GitHub Release 下载可能被限速或中断，请稍后重试，或配置可访问的镜像更新源。';
  }
  return message || '更新下载失败，请稍后重试';
}

function updateDownloadUrls(update) {
  return [...new Set([update.assetApiUrl, ...(update.mirrorUrls || []), update.downloadUrl].filter(value => typeof value === 'string' && value.trim()))];
}

const UPDATE_CHUNK_SIZE = 2 * 1024 * 1024;
const UPDATE_PARALLELISM = 4;
const UPDATE_CHUNK_RETRIES = 2;
const UPDATE_RANGE_PROBE_TIMEOUT = 8000;

function readWithTimeout(reader, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('下载数据接收超时'), { name: 'TimeoutError' })), timeout);
    reader.read().then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

async function hashFile(filename) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

async function streamUpdateResponse(response, update, installerPath) {
  if (!response.ok || !response.body) throw new Error(`更新下载失败（HTTP ${response.status}）`);
  const writer = fs.createWriteStream(installerPath);
  const reader = response.body.getReader();
  let received = 0;
  const total = Number(response.headers.get('content-length')) || update.size || 0;
  try {
    sendUpdateProgress({ received, total, percent: 0, status: '已连接，正在下载更新…' });
    const write = chunk => new Promise((resolve, reject) => {
      if (writer.write(chunk, error => error ? reject(error) : resolve())) return;
      writer.once('drain', resolve);
    });
    while (true) {
      const next = await readWithTimeout(reader);
      if (next.done) break;
      const chunk = Buffer.from(next.value);
      received += chunk.length;
      await write(chunk);
      sendUpdateProgress({ received, total, percent: total ? Math.min(100, received / total * 100) : 0, status: '正在下载更新…' });
    }
    await new Promise((resolve, reject) => writer.end(error => error ? reject(error) : resolve()));
    return { actualHash: await hashFile(installerPath), received, total };
  } catch (error) {
    try { await reader.cancel(); } catch {}
    try { writer.destroy(); } catch {}
    throw error;
  }
}

async function resolveDownloadUrl(url) {
  const response = await fetch(url, { headers: { ...updateHeaders(), Accept: 'application/octet-stream' }, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location');
    try { await response.body?.cancel(); } catch {}
    if (!location) throw new Error('更新下载地址没有返回跳转位置');
    return { url: new URL(location, url).toString() };
  }
  return { response };
}

async function probeRangeSupport(url, total) {
  const response = await fetch(url, { headers: { ...updateHeaders(), Accept: 'application/octet-stream', Range: 'bytes=0-0' }, redirect: 'follow', signal: AbortSignal.timeout(UPDATE_RANGE_PROBE_TIMEOUT) });
  try {
    return response.status === 206 && response.headers.get('content-range') === `bytes 0-0/${total}`;
  } finally {
    try { await response.body?.cancel(); } catch {}
  }
}

async function downloadByRanges(url, update, installerPath) {
  const total = Number(update.size) || 0;
  if (!total) throw new Error('更新文件大小未知，无法启用分段下载');
  if (!await probeRangeSupport(url, total)) throw new Error('下载服务器不支持快速分段下载');
  const count = Math.ceil(total / UPDATE_CHUNK_SIZE);
  const handle = await fs.promises.open(installerPath, 'w');
  let nextIndex = 0;
  let received = 0;
  let failed = null;
  try {
    await handle.truncate(total);
    const worker = async () => {
      while (!failed) {
        const index = nextIndex++;
        if (index >= count) return;
        const start = index * UPDATE_CHUNK_SIZE;
        const end = Math.min(total - 1, start + UPDATE_CHUNK_SIZE - 1);
        let complete = false;
        for (let attempt = 1; attempt <= UPDATE_CHUNK_RETRIES && !failed; attempt++) {
          try {
            const response = await fetch(url, { headers: { ...updateHeaders(), Accept: 'application/octet-stream', Range: `bytes=${start}-${end}` }, redirect: 'follow', signal: AbortSignal.timeout(45000) });
            const expected = end - start + 1;
            if (response.status !== 206) throw new Error(`分段下载不受支持（HTTP ${response.status}）`);
            if (response.headers.get('content-range') !== `bytes ${start}-${end}/${total}`) throw new Error('分段下载范围校验失败');
            const bytes = Buffer.from(await response.arrayBuffer());
            if (bytes.length !== expected) throw new Error('分段下载长度校验失败');
            await handle.write(bytes, 0, bytes.length, start);
            received += bytes.length;
            sendUpdateProgress({ received, total, percent: Math.min(100, received / total * 100), status: `正在并行下载更新… ${Math.round(received / total * 100)}%` });
            complete = true;
            break;
          } catch (error) {
            if (attempt === UPDATE_CHUNK_RETRIES) failed = error;
            else await new Promise(resolve => setTimeout(resolve, 250 * attempt));
          }
        }
        if (!complete) return;
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPDATE_PARALLELISM, count) }, () => worker()));
    if (failed) throw failed;
    return { actualHash: await hashFile(installerPath), received: total, total };
  } finally {
    await handle.close();
  }
}

async function downloadCandidate(url, update, installerPath) {
  const resolved = await resolveDownloadUrl(url);
  if (resolved.response) return streamUpdateResponse(resolved.response, update, installerPath);
  if (update.size) {
    try {
      sendUpdateProgress({ received: 0, total: update.size, percent: 0, status: '已连接，正在并行下载更新…' });
      return await downloadByRanges(resolved.url, update, installerPath);
    } catch (error) {
      console.warn('Parallel update download unavailable, falling back to stream:', error.message);
      try { fs.rmSync(installerPath, { force: true }); } catch {}
      sendUpdateProgress({ received: 0, total: update.size, percent: 0, status: '分段下载不可用，切换普通下载…' });
    }
  }
  const response = await fetch(resolved.url, { headers: { ...updateHeaders(), Accept: 'application/octet-stream' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  return streamUpdateResponse(response, update, installerPath);
}

async function downloadUpdateFile(update, installerPath) {
  let lastError = null;
  const urls = updateDownloadUrls(update);
  for (let index = 0; index < urls.length; index++) {
    const url = urls[index];
    sendUpdateProgress({ received: 0, total: update.size || 0, percent: 0, status: index ? '正在切换备用下载地址…' : '正在连接下载服务器…' });
    try {
      return await downloadCandidate(url, update, installerPath);
    } catch (error) {
      lastError = error;
      console.error('Update download candidate failed:', url, error);
      try { fs.rmSync(installerPath, { force: true }); } catch {}
    }
  }
  throw lastError || new Error('没有可用的更新下载地址');
}

async function checkForUpdates({ notifyRenderer = true } = {}) {
  if (updateCheckPromise) return updateCheckPromise;
  if (process.env.DAYAN_TEST === '1' && !process.env.DAYAN_TEST_UPDATE_URL) return { available: false, skipped: true, currentVersion: app.getVersion() };
  updateCheckPromise = (async () => {
    const endpoint = process.env.DAYAN_TEST_UPDATE_URL || process.env.DAYAN_UPDATE_MANIFEST_URL || UPDATE_REPOSITORY_API;
    const response = await fetch(endpoint, { headers: updateHeaders(), redirect: 'follow', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`更新检查失败（HTTP ${response.status}）。私有仓库需要配置受控的更新清单或认证服务。`);
    const remote = normalizeUpdatePayload(await response.json());
    if (!remote || !isNewerVersion(remote.version, app.getVersion())) { updateInfo = null; return { available: false, currentVersion: app.getVersion(), checkedAt: new Date().toISOString() }; }
    updateInfo = { ...remote, currentVersion: app.getVersion() };
    if (notifyRenderer && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('dayan:update-available', updateInfo);
    return { available: true, ...updateInfo };
  })().catch(error => {
    if (notifyRenderer && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('dayan:update-error', { message: error.message || '更新检查失败' });
    return { available: false, error: error.message || '更新检查失败', currentVersion: app.getVersion() };
  }).finally(() => { updateCheckPromise = null; });
  return updateCheckPromise;
}

async function downloadAndInstallUpdate() {
  if (!updateInfo || updateBusy) return { ok: false, error: '当前没有可安装的更新' };
  updateBusy = true;
  const update = updateInfo;
  const tempDir = path.join(app.getPath('temp'), `dayan-update-${process.pid}`);
  const installerPath = path.join(tempDir, `DAYANClock-Setup-${update.version}-x64.exe`);
  try {
    fs.mkdirSync(tempDir, { recursive: true });
    const { actualHash } = await downloadUpdateFile(update, installerPath);
    if (update.sha256 && actualHash.toLowerCase() !== update.sha256.toLowerCase()) throw new Error('更新文件校验失败，未执行安装');
    if (process.platform !== 'win32') return { ok: false, error: '当前更新安装器仅支持 Windows' };
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const appPath = app.getPath('exe');
    const script = `$installer=${powershellLiteral(installerPath)}; $app=${powershellLiteral(appPath)}; Start-Sleep -Milliseconds 800; $p=Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru; if ($p.ExitCode -eq 0 -and (Test-Path -LiteralPath $app)) { Start-Process -FilePath $app }; Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { detached: true, windowsHide: true, stdio: 'ignore' });
    child.unref();
    quitting = true;
    app.quit();
    return { ok: true };
  } catch (error) {
    try { fs.rmSync(installerPath, { force: true }); } catch {}
    const message = describeUpdateError(error);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('dayan:update-error', { message });
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
  if (!status.sid) return { ok: false, status, error: '无法识别当前 Windows 用户，请重新启动 DAYAN桌面后重试' };
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
  if (desktopWindowHosted) { desktopWindowHosted = false; setDesktopWindowMode(false, screen.getDisplayMatching(mainWindow.getBounds())); }
  mainWindow.setKiosk(false);
  mainWindow.setFullScreen(false);
  queueWindowedRestore();
}

function fullscreenLayer() {
  const layers = normalizeWindowLayers(state.windowLayers);
  return layers[securityLocked ? 'locked' : 'unlocked'];
}

function setDesktopWindowMode(hosted, display) {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return;
  const handle = mainWindow.getNativeWindowHandle();
  const pointer = handle.length >= 8 ? handle.readBigUInt64LE(0).toString() : String(handle.readUInt32LE(0));
  const bounds = display?.bounds || mainWindow.getBounds();
  const source = [
    "Add-Type @'",
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class DayanDesktopWindow {',
    '  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint flags);',
    '  [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);',
    '  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string cls, string title);',
    '  [DllImport("user32.dll")] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);',
    '  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr extra);',
    '  public delegate bool EnumProc(IntPtr hWnd, IntPtr extra);',
    '  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);',
    '  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int index);',
    '  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int index, IntPtr value);',
    '  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }',
    '  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);',
    '}',
    "'@",
    '$hwnd = [IntPtr]' + pointer,
    '$GWL_STYLE = -16; $WS_CHILD = [Int64]0x40000000; $WS_POPUP = [Int64]0x80000000; $SWP_NOACTIVATE = 0x10; $SWP_SHOWWINDOW = 0x40;',
    `if (${hosted ? '$true' : '$false'}) {`,
    '  $progman = [DayanDesktopWindow]::FindWindow("Progman", "Program Manager"); $result = [IntPtr]::Zero;',
    '  if ($progman -ne [IntPtr]::Zero) { [DayanDesktopWindow]::SendMessageTimeout($progman, 0x052C, [IntPtr]::Zero, [IntPtr]::Zero, 0, 1000, [ref]$result) | Out-Null }',
    '  $script:dayanWorker = [IntPtr]::Zero;',
    '  $callback = [DayanDesktopWindow+EnumProc]{ param($window, $extra); $defView = [DayanDesktopWindow]::FindWindowEx($window, [IntPtr]::Zero, "SHELLDLL_DefView", $null); if ($defView -ne [IntPtr]::Zero) { $script:dayanWorker = [DayanDesktopWindow]::FindWindowEx([IntPtr]::Zero, $window, "WorkerW", $null) }; return $true };',
    '[DayanDesktopWindow]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null; $worker = $script:dayanWorker;',
    '  if ($worker -eq [IntPtr]::Zero) { exit 2 }',
    '  $style = [DayanDesktopWindow]::GetWindowLongPtr($hwnd, $GWL_STYLE).ToInt64(); $style = ($style -bor $WS_CHILD) -band (-bnot $WS_POPUP); [DayanDesktopWindow]::SetWindowLongPtr($hwnd, $GWL_STYLE, [IntPtr]$style) | Out-Null;',
    '  [DayanDesktopWindow]::SetParent($hwnd, $worker) | Out-Null;',
    `  $rect = New-Object DayanDesktopWindow+RECT; [DayanDesktopWindow]::GetWindowRect($worker, [ref]$rect) | Out-Null; $x = ${Number(bounds.x)} - $rect.Left; $y = ${Number(bounds.y)} - $rect.Top;`,
    `  [DayanDesktopWindow]::SetWindowPos($hwnd, [IntPtr]::Zero, $x, $y, ${Number(bounds.width)}, ${Number(bounds.height)}, ($SWP_NOACTIVATE -bor $SWP_SHOWWINDOW)) | Out-Null;`,
    '} else {',
    '  [DayanDesktopWindow]::SetParent($hwnd, [IntPtr]::Zero) | Out-Null; $style = [DayanDesktopWindow]::GetWindowLongPtr($hwnd, $GWL_STYLE).ToInt64(); $style = ($style -bor $WS_POPUP) -band (-bnot $WS_CHILD); [DayanDesktopWindow]::SetWindowLongPtr($hwnd, $GWL_STYLE, [IntPtr]$style) | Out-Null;',
    '  [DayanDesktopWindow]::SetWindowPos($hwnd, [IntPtr]::Zero, 0, 0, 0, 0, $SWP_NOACTIVATE) | Out-Null;',
    '}'
  ].join('\n');
  const encoded = Buffer.from(source, 'utf16le').toString('base64');
  try {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { detached: true, windowsHide: true, stdio: 'ignore' });
    child.unref();
  } catch (error) { console.error('Unable to apply desktop window mode:', error.message); }
}

function applyPresentationWindow() {
  if (!mainWindow || mainWindow.isDestroyed() || !isPresentationFullscreen()) return;
  const display = screen.getDisplayMatching(mainWindow.getBounds());
  if (fullscreenLayer() === 'bottom') {
    mainWindow.setKiosk(false);
    mainWindow.setFullScreen(false);
    mainWindow.setBounds(display.bounds, false);
    mainWindow.setAlwaysOnTop(false);
    if (!desktopWindowHosted) { desktopWindowHosted = true; setDesktopWindowMode(true, display); }
  } else {
    if (desktopWindowHosted) { desktopWindowHosted = false; setDesktopWindowMode(false, display); }
    mainWindow.setBounds(display.bounds, false);
    mainWindow.setKiosk(securityLocked);
    mainWindow.setFullScreen(true);
    mainWindow.setAlwaysOnTop(true, securityLocked ? 'screen-saver' : 'floating');
  }
}

function restorePinnedState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (isPresentationFullscreen()) {
    if (fullscreenLayer() === 'bottom') {
      mainWindow.setAlwaysOnTop(false);
      if (!desktopWindowHosted) { desktopWindowHosted = true; setDesktopWindowMode(true, screen.getDisplayMatching(mainWindow.getBounds())); }
    } else {
      mainWindow.setAlwaysOnTop(true, securityLocked ? 'screen-saver' : 'floating');
    }
    return;
  }
  if (desktopWindowHosted) { desktopWindowHosted = false; setDesktopWindowMode(false, screen.getDisplayMatching(mainWindow.getBounds())); }
  if (securityLocked) mainWindow.setAlwaysOnTop(true, 'screen-saver');
  else mainWindow.setAlwaysOnTop(state.pinned === true);
}
function notify() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('dayan:window-state', { pinned: state.pinned === true, fullscreen: isPresentationFullscreen(), windowLayers: normalizeWindowLayers(state.windowLayers), ...securitySnapshot() });
}

function setupIPC() {
  ipcMain.handle('dayan:load', event => trusted(event) ? { widget: state.widget, style: state.style, displaySettings: state.displaySettings, windowLayers: normalizeWindowLayers(state.windowLayers), autoStart: state.autoStart !== false, appVersion: app.getVersion(), showSettingsOnStartup: state.settingsGuideVersion !== 1, pinned: state.pinned === true, fullscreen: isPresentationFullscreen(), ...securitySnapshot() } : null);
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
    flushState();event.returnValue = true;
  });
  ipcMain.handle('dayan:auto-start', (event, enabled) => {
    if (!trusted(event) || securityLocked || typeof enabled !== 'boolean') return { ok: false, enabled: state.autoStart !== false, error: '请求无效' };
    state.autoStart = applyAutoStart(enabled);
    flushState();
    return { ok: true, enabled: state.autoStart };
  });
  ipcMain.handle('dayan:update-check', event => trusted(event) && !securityLocked ? checkForUpdates({ notifyRenderer: true }) : { available: false, error: '请先解锁时钟' });
  ipcMain.handle('dayan:update-install', event => trusted(event) && !securityLocked ? downloadAndInstallUpdate() : { ok: false, error: '请先解锁时钟' });
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
      else { preparePresentation(); applyPresentationWindow(); }
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
      applyPresentationWindow();
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
    title: APP_NAME, icon: path.join(__dirname, '../assets/icon.png'),
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
    if (presentationRequested || securityLocked) { applyPresentationWindow(); notify(); }
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
    readState();
    applyAutoStart(state.autoStart !== false);
    setupIPC(); createWindow();
    setTimeout(() => { checkForUpdates(); }, process.env.DAYAN_TEST_UPDATE_URL ? 250 : 2500);
    screen.on('display-metrics-changed', () => {
      if (mainWindow && !isPresentationFullscreen() && !mainWindow.isMinimized()) queueWindowedRestore();
    });
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => { quitting = true; flushState(); });
}
