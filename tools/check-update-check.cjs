const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { mergeUpdateSources } = require('../desktop/update-download.cjs');
const source = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
const newer = source.slice(source.indexOf('function normalizeVersion('), source.indexOf('function updateHeaders('));
const checking = source.slice(source.indexOf('async function checkForUpdates('), source.indexOf('function localUpdateDate('));
const release = version => ({ version, size:100, sha256:'a'.repeat(64), downloadUrl:'https://example.invalid/installer' });
function create(fetchWithRetry) {
  const context = vm.createContext({ URL, process:{ env:{} }, app:{ getVersion:() => '1.6.20' }, updateMode:{ test:false }, UPDATE_REPOSITORY_API:'https://api.github.com/latest', UPDATE_PUBLIC_MANIFEST:'https://example.invalid/update.json', fetchWithRetry, normalizeUpdatePayload:value => value, mergeUpdateSources, describeUpdateError:error => error.message });
  vm.runInContext(`let updateInfo=null, updateCheckPromise; const updateHeaders=()=>({}); ${newer}\n${checking}\nglobalThis.check=checkForUpdates;`, context);
  return context.check;
}
const response = payload => ({ ok:true, json:async () => payload });
(async () => {
  let finishSlow;
  const slower = new Promise(resolve => { finishSlow = resolve; });
  const check = create(url => url.includes('api.github.com') ? slower : Promise.resolve(response(release('1.6.20'))));
  const pending = check();
  await new Promise(resolve => setImmediate(resolve));
  finishSlow(response(release('1.6.21')));
  assert.equal((await pending).version, '1.6.21', 'A fast stale manifest must not suppress a slower new release');
  let finishUnused;
  const unused = new Promise(resolve => { finishUnused = resolve; });
  const fast = create(url => url.includes('api.github.com') ? unused : Promise.resolve(response(release('1.6.21'))));
  const ready = await Promise.race([fast(), new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('A fresh fast source should not wait for the slow channel')), 1000); timer.unref(); })]);
  assert.equal(ready.version, '1.6.21');
  finishUnused(response(release('1.6.20')));
  const fallback = create(url => url.includes('api.github.com') ? Promise.reject(Error('offline')) : Promise.resolve(response(release('1.6.20'))));
  assert.equal((await fallback()).available, false);
  const offline = create(() => Promise.reject(Error('offline')));
  assert.match((await offline()).error, /offline/);
  console.log(JSON.stringify({ result:'passed', checks:['Fast stale manifest cannot hide slower new release', 'Fast new release does not wait for stalled backup', 'Current version remains usable when backup is offline', 'Both failed sources return a retryable check result'] }, null, 2));
})().catch(error => { console.error(error); process.exitCode=1; });
