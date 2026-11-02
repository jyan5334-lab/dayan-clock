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
  for (const filename of BACKUP_FILES) {
    const target = path.join(current, filename);
    if (fs.existsSync(target)) continue;
    const source = sources.find(directory => isJsonFile(path.join(directory, filename)));
    if (!source) continue;
    fs.copyFileSync(path.join(source, filename), target);
    migrated.push(filename);
  }
  return migrated;
}

function hasBackups(userData) {
  return BACKUP_FILES.some(filename => isJsonFile(path.join(userData, filename)));
}

module.exports = { BACKUP_FILES, candidateDirectories, migrateLegacyBackups, hasBackups };
