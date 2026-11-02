const fs = require('node:fs');
const path = require('node:path');

const BACKUP_FILES = Object.freeze(['windows-lockdown-backup.json', 'keyboard-filter-backup.json']);
const LEGACY_USER_DATA_NAMES = Object.freeze(['DAYAN时钟', 'DAYAN鏃堕挓']);

function candidateDirectories(userData, appData = process.env.APPDATA) {
  const directories = [userData];
  if (appData) {
    for (const name of LEGACY_USER_DATA_NAMES) directories.push(path.join(appData, name));
  }
  return [...new Set(directories.filter(Boolean).map(item => path.resolve(item)))];
}

function isJsonFile(filePath) {
  try {
    if (!fs.statSync(filePath).isFile()) return false;
    JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
    return true;
  } catch {
    return false;
  }
}

function migrateLegacyBackups(userData, appData = process.env.APPDATA) {
  const current = path.resolve(userData);
  const sources = candidateDirectories(current, appData).slice(1);
  const migrated = [];
  fs.mkdirSync(current, { recursive: true });
  const ledgerPath = path.join(current, 'policy-backup-migrations.json');
  // Keep originals for recovery, but never import a consumed backup again.
  const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) : { version: 1, files: {} };
  if (ledger.version !== 1 || !ledger.files || typeof ledger.files !== 'object') throw Error('Invalid policy migration record');
  let changed = false;
  for (const filename of BACKUP_FILES) {
    const target = path.join(current, filename);
    if (ledger.files[filename]) continue;
    const source = sources.find(directory => isJsonFile(path.join(directory, filename)));
    if (!source) continue;
    if (!fs.existsSync(target)) {
      fs.copyFileSync(path.join(source, filename), target, fs.constants.COPYFILE_EXCL);
      migrated.push(filename);
    }
    ledger.files[filename] = { source, importedAt: new Date().toISOString() };
    changed = true;
  }
  if (changed) {
    const temporary = ledgerPath + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(ledger, null, 2));
    fs.renameSync(temporary, ledgerPath);
  }
  return migrated;
}

function hasBackups(userData) {
  return BACKUP_FILES.some(filename => isJsonFile(path.join(userData, filename)));
}

function matchesRestoredPolicies(status, record) {
  if (!record?.at || !Array.isArray(record.policies) || record.policies.length !== 5 || status.error) return false;
  const names = new Set(['DisableTaskMgr', 'DisableLockWorkstation', 'DisableChangePassword', 'NoWinKeys', 'NoLogoff']);
  for (const expected of record.policies) {
    if (!names.delete(expected.Name)) return false;
    const actual = status.policies?.find(item => item.name === expected.Name);
    if (!actual || actual.exists !== expected.Exists || (expected.Exists && Number(actual.value) !== Number(expected.Value))) return false;
  }
  if (record.filter?.stage === 'restored') {
    const expected = record.filter.secureKeys?.find(item => item.Id === 'Ctrl+Alt+Del');
    if (expected && status.keyboardFilterEnabled !== expected.Enabled) return false;
    const setting = record.filter.settings?.find(item => item.Name === 'DisableKeyboardFilterForAdministrators');
    if (setting && status.administratorFiltering !== (String(setting.Value).toLowerCase() === 'false')) return false;
  }
  return true;
}

module.exports = { BACKUP_FILES, candidateDirectories, migrateLegacyBackups, hasBackups, matchesRestoredPolicies };
