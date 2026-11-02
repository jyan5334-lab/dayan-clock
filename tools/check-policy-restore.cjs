const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { migrateLegacyBackups, hasBackups } = require('../desktop/policy-backups.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dayan-policy-restore-'));
const appData = path.join(root, 'appdata');
const current = path.join(appData, 'DAYAN桌面');
const legacy = path.join(appData, 'DAYAN时钟');
fs.mkdirSync(legacy, { recursive: true });
fs.writeFileSync(path.join(legacy, 'windows-lockdown-backup.json'), JSON.stringify({ sample: true }));
assert.equal(hasBackups(current), false);
assert.deepEqual(migrateLegacyBackups(current, appData), ['windows-lockdown-backup.json']);
assert.equal(hasBackups(current), true);
assert.deepEqual(migrateLegacyBackups(current, appData), []);

const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
const authorize = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'authorize-dayan.ps1'), 'utf8');
assert.match(main, /migrateLegacyBackups\(userData\)/);
assert.match(main, /canRestore: hasBackups\(userData\)/);
assert.match(authorize, /Restore each owned policy set independently/);
assert.match(authorize, /Windows 策略:/);
console.log(JSON.stringify({ migrated: true, independentRestore: true, result: 'passed' }, null, 2));
