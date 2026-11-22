const workspacePaths = require('./workspace-paths.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createUpdateController } = require('../desktop/update-controller.cjs');
const { saveUpdateSession, readUpdateSession, clearUpdateSession } = require('../desktop/update-session.cjs');
fs.mkdirSync(workspacePaths.temp(), { recursive: true });
const output = fs.mkdtempSync(workspacePaths.temp('dayan-update-background-'));
const installer = path.join(output, 'installer.exe');
const bytes = crypto.randomBytes(1024 * 1024);
fs.writeFileSync(installer, bytes);
const update = { version: '9.9.9', size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
const checks = [];
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
(async () => {
  let locked = false, downloads = 0, installs = 0;
  const downloading = gate(), started = gate();
  const controller = createUpdateController({
    download: async () => { downloads++; started.resolve(); await downloading.promise; return installer; },
    canInstall: () => !locked,
    install: async () => { installs++; }
  });
  const first = controller.request(update);
  assert.equal(controller.request(update), first);
  await started.promise;
  locked = true;
  downloading.resolve();
  assert.equal((await first).deferred, true);
  assert.equal(installs, 0);
  locked = false;
  assert.equal((await controller.request()).ok, true);
  assert.equal(downloads, 1);
  assert.equal(installs, 1);
  checks.push('Concurrent requests share one download; locking during download defers installation; unlock reuses verified file');

  const hashing = gate(), hashingStarted = gate();
  locked = false;
  const race = createUpdateController({ download: async () => installer, canInstall: () => !locked, verify: async () => { hashingStarted.resolve(); await hashing.promise; }, install: async () => { throw Error('Must not install after locking during verification'); } });
  const raceResult = race.request(update);
  await hashingStarted.promise;
  locked = true; hashing.resolve();
  assert.equal((await raceResult).deferred, true);
  checks.push('Lock state is checked again after asynchronous hash verification');

  for (const broken of [{ ...update, sha256: '0'.repeat(64) }, { ...update, sha256: '' }, { ...update, size: 3 }]) {
    let called = false;
    const failed = createUpdateController({ download: async () => installer, canInstall: () => true, install: async () => { called = true; } });
    assert.equal((await failed.request(broken)).ok, false);
    assert.equal(called, false);
    assert.equal(failed.busy, false);
  }
  const tampered = createUpdateController({ download: async () => installer, canInstall: () => !locked, install: async () => { throw Error('Must not install a modified file'); } });
  await tampered.request(update);
  fs.appendFileSync(installer, 'changed'); locked = false;
  assert.equal((await tampered.request()).ok, false);
  fs.writeFileSync(installer, bytes);
  checks.push('Wrong hash, absent hash, wrong size and tampered deferred installer never execute');

  let attempts = 0;
  const failing = createUpdateController({ download: async () => installer, canInstall: () => true, install: async () => { if (++attempts === 1) throw Error('Helper unavailable'); } });
  assert.equal((await failing.request(update)).ok, false);
  assert.equal(failing.busy, false);
  assert.equal((await failing.request(update)).ok, true);
  checks.push('Failed helper preparation releases job and allows retry without quitting application');
  let handoffs = 0;
  const deferred = createUpdateController({ download:async () => installer, canInstall:() => true, install:async () => ++handoffs === 1 ? { deferred:true } : undefined });
  assert.equal((await deferred.request(update)).deferred, true);
  assert.equal(deferred.pending, true);
  assert.equal((await deferred.request()).ok, true);
  assert.equal(handoffs, 2);
  await deferred.request(update);
  assert.equal(handoffs, 2, 'A successful handoff cannot install a second time');
  checks.push('Cancelled handoff retains ready installer and resumes once; successful handoff cannot repeat');

  saveUpdateSession(output, { fullscreen: true, displayId: 42, displayScope: 'all', version: '9.9.9' });
  assert.equal(readUpdateSession(output, []), null);
  assert.equal(readUpdateSession(output, ['--updated']).displayScope, 'all');
  assert.equal(readUpdateSession(output, ['--dayan-update-recovery']).displayId, 42);
  assert.equal(readUpdateSession(output, ['--updated'], Date.now() + 86400001), null);
  clearUpdateSession(output);
  assert.equal(readUpdateSession(output, ['--updated']), null);
  fs.writeFileSync(path.join(output, 'updates/resume.json'), '{broken');
  assert.equal(readUpdateSession(output, ['--updated']), null);
  checks.push('Resume is one-time, update/recovery-only, bounded in age, and tolerates corrupt or absent records');
  const report = { result: 'passed', output, checks };
  fs.writeFileSync(path.join(output, 'validation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
