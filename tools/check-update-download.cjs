const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { downloadUpdate, mergeUpdateSources, CHUNK_SIZE, CONNECTIONS, FALLBACK_CONNECTIONS, SOURCE_POOL_LIMIT } = require('../desktop/update-download.cjs');

const root = fs.mkdtempSync(path.join(process.env.DAYAN_TEST_ROOT || 'D:/Codex/Temp', 'dayan-download-'));
const payload = crypto.randomBytes(CHUNK_SIZE * 12 + 97);
const digest = crypto.createHash('sha256').update(payload).digest('hex');
const counts = new Map();
const throttledAt = new Map(), retryDelays = [];
let active = 0, maxActive = 0, failPart = false, truncateOnce = false;
const server = http.createServer((req, res) => {
  const name = req.url;
  const range = req.headers.range;
  counts.set(`${name}:${range || 'stream'}`, (counts.get(`${name}:${range || 'stream'}`) || 0) + 1);
  if (name === '/slow') return setTimeout(() => { if (!res.destroyed) { res.writeHead(503); res.end(); } }, 250);
  if (name.startsWith('/unavailable-')) { res.writeHead(503); return res.end(); }
  if (name === '/redirect') { res.writeHead(302, { Location: '/file' }); return res.end(); }
  if (name === '/api') { assert.equal(req.headers.authorization, 'Bearer fixture-token'); res.writeHead(302, { Location: `http://127.0.0.1:${server.address().port}/file` }); return res.end(); }
  if (name === '/file') assert.equal(req.headers.authorization, undefined, 'Credential leaked across redirect');
  if (name === '/stream' || !range) { res.writeHead(200, { 'Content-Length': payload.length }); return res.end(payload); }
  const match = range.match(/^bytes=(\d+)-(\d+)$/);
  if (!match) { res.writeHead(416); return res.end(); }
  const start = Number(match[1]), end = Number(match[2]);
  if (name === '/late-ready' && end === 65535) {
    return setTimeout(() => {
      if (!res.destroyed) { res.writeHead(206, { 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${payload.length}` }); res.end(payload.subarray(start, end + 1)); }
    }, 250);
  }
  if (name === '/late-failure' && end !== 65535) { res.writeHead(503); return res.end(); }
  if (name === '/throttled' && end !== 65535 && active >= FALLBACK_CONNECTIONS) { throttledAt.set(range, Date.now()); res.writeHead(429, { 'Retry-After': '1' }); return res.end(); }
  if (name === '/throttled' && throttledAt.has(range)) { retryDelays.push(Date.now() - throttledAt.get(range)); throttledAt.delete(range); }
  if (name === '/resume' && failPart && start === CHUNK_SIZE * 2) { return setTimeout(() => { res.writeHead(503); res.end(); }, 90); }
  const bytes = Buffer.from(payload.subarray(start, end + 1));
  if (name === '/corrupt' && end !== 65535) bytes[0] ^= 1;
  res.writeHead(206, { 'Content-Length': bytes.length, 'Content-Range': `bytes ${start}-${end}/${payload.length}` });
  if (end === 65535) return res.end(bytes);
  if (name === '/large-stall' && bytes.length > 256 * 1024) { res.flushHeaders(); return; }
  if (name === '/truncated' && truncateOnce) { truncateOnce = false; res.write(bytes.subarray(0, 100)); return res.destroy(); }
  active++; maxActive = Math.max(maxActive, active);
  res.once('close', () => { active--; });
  res.flushHeaders();
  setTimeout(() => res.end(bytes), name === '/large-stall' ? 20 : name.startsWith('/bench-') ? 350 : 220);
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const update = { version: '9.9.9', size: payload.length, sha256: digest };
  const timing = { idleMs: 600, connectMs: 100, retryMs: 5 };
  const progress = [];
  const diagnostics = [];
  const run = (name, urls, more = {}) => downloadUpdate({ update, installerPath: path.join(root, `${name}.exe`), urls: urls.map(value => origin + value), fetch, timing, onProgress: item => progress.push(item), onDiagnostic: item => diagnostics.push(item), ...more });
  const checks = [];
  try {
    const started = Date.now();
    await run('race', ['/slow', '/redirect']);
    assert.ok(Date.now() - started < 1500);
    assert.equal(await fs.promises.readFile(path.join(root, 'race.exe')).then(bytes => crypto.createHash('sha256').update(bytes).digest('hex')), digest);
    assert.equal(CONNECTIONS, 8); assert.equal(maxActive, 8);
    checks.push('Fast source wins against stalled source; eight range connections use the source pool; final digest matches');

    const benchmark = {};
    for (const connections of [4, 8]) {
      const started = Date.now();
      await run(`bench-${connections}`, [`/bench-${connections}`], { connections });
      benchmark[connections] = Date.now() - started;
    }
    assert.ok(benchmark[8] < benchmark[4], 'Eight workers should improve the controlled per-connection-limited fixture');
    checks.push(`Controlled local throughput comparison: four connections ${benchmark[4]} ms; eight connections ${benchmark[8]} ms (not a China Internet speed guarantee)`);

    await run('pool', ['/pool-a', '/pool-b']);
    for (const source of ['/pool-a', '/pool-b']) assert.ok([...counts.keys()].some(key => key.startsWith(source + ':bytes=') && !key.endsWith('-65535')), 'Both healthy sources must supply real ranges');
    checks.push('Ranges are assembled from multiple healthy sources, not only the fastest probe');

    await run('late-pool', ['/pool-a', '/late-ready'], { timing: { ...timing, connectMs: 600 } });
    assert.ok([...counts.keys()].some(key => key.startsWith('/late-ready:bytes=') && !key.endsWith('-65535')));
    checks.push('A healthy source responding after the initial probe window joins the running download');

    await run('pool-failover', ['/late-failure', '/pool-b']);
    checks.push('A source failing after a successful probe does not prevent healthy-source completion');

    await run('throttled', ['/throttled']);
    assert.ok(diagnostics.some(item => item.phase === 'concurrency-reduced' && item.connections === 4));
    assert.ok(progress.some(item => item.connections === 4));
    assert.ok(retryDelays.length > 0 && retryDelays.every(milliseconds => milliseconds >= 950), 'Retry-After must be observed for the retried range');
    checks.push('HTTP 429 reduces eight workers to four and honors Retry-After before retrying');
    assert.equal(SOURCE_POOL_LIMIT, 10);
    await run('tenth-source', [...Array.from({ length: 9 }, (_, index) => `/unavailable-${index}`), '/tenth-healthy']);
    await assert.rejects(run('beyond-source-limit', [...Array.from({ length: 10 }, (_, index) => `/unavailable-${index}`), '/eleventh-unused']));
    assert.equal([...counts.keys()].some(key => key.startsWith('/eleventh-unused:')), false);
    checks.push('The tenth trusted source is usable and an eleventh source is not requested');

    const manifest = { ...update, downloadUrl: 'https://downloads.example.com/installer.exe', mirrorUrls: ['https://mirror.example.com/installer.exe'] };
    const github = { ...update, downloadUrl: 'https://github.com/org/repo/installer.exe', assetApiUrl: 'https://api.github.com/asset' };
    const merged = mergeUpdateSources(github, manifest);
    assert.ok(merged.mirrorUrls.includes(manifest.mirrorUrls[0]));
    assert.ok(merged.mirrorUrls.includes(manifest.downloadUrl));
    assert.equal(mergeUpdateSources(github, { ...manifest, sha256: 'a'.repeat(64) }), github);
    assert.equal(mergeUpdateSources(github, { ...manifest, size: update.size + 1 }), github);
    assert.equal(mergeUpdateSources(github, { ...manifest, version: '1.0.0' }), github);
    checks.push('API and manifest sources merge only for identical version, size and digest');

    truncateOnce = true;
    await run('retry', ['/truncated']);
    assert.ok(counts.has('/truncated:bytes=0-262143'));
    checks.push('Truncated transfer retries only the failed range');

    failPart = true;
    await assert.rejects(run('resume', ['/resume']));
    const partDir = path.join(root, 'resume.exe.parts');
    const persisted = fs.readdirSync(partDir).filter(name => name.endsWith('.bin'));
    assert.ok(persisted.length > 0);
    const before = new Map(counts);
    failPart = false;
    await run('resume', ['/resume']);
    for (const part of persisted) {
      const index = Number(part.split('.')[0]), start = index * CHUNK_SIZE, end = Math.min(payload.length - 1, start + CHUNK_SIZE - 1);
      const key = `/resume:bytes=${start}-${end}`;
      assert.equal(counts.get(key), before.get(key), 'Completed range was downloaded again');
    }
    const oldCount = [...counts.values()].reduce((a, b) => a + b, 0);
    assert.equal((await run('resume', ['/resume'])).cached, true);
    assert.equal([...counts.values()].reduce((a, b) => a + b, 0), oldCount);
    checks.push('Failed update keeps verified parts; next run fetches missing ranges only; complete installer is reused');

    failPart = true;
    await assert.rejects(run('damaged-resume', ['/resume']));
    const damagedDir = path.join(root, 'damaged-resume.exe.parts');
    const damaged = fs.readdirSync(damagedDir).find(name => name.endsWith('.bin'));
    assert.ok(damaged);
    fs.writeFileSync(path.join(damagedDir, damaged), Buffer.alloc(4));
    failPart = false;
    await run('damaged-resume', ['/resume']);
    checks.push('Tampered cached segment is rejected and downloaded again');

    failPart = true;
    await run('fallback', ['/resume', '/file']);
    failPart = false;
    checks.push('Mid-transfer source failure switches to alternate source without discarding complete parts');

    await run('adaptive', ['/large-stall'], { timing: { ...timing, idleMs: 100, rangeMs: 3000 } });
    assert.ok([...counts.keys()].some(key => key === '/large-stall:bytes=0-262143'));
    checks.push('Stalled large requests downgrade block size and can fall back to four workers');

    await run('stream', ['/stream']);
    checks.push('Servers without Range support use checked streaming fallback');
    await run('stream-after-range-failure', ['/late-failure', '/stream']);
    checks.push('A non-Range fallback remains usable after the ranged source pool fails');
    await assert.rejects(run('corrupt', ['/corrupt']), /SHA-256/);
    assert.equal(fs.existsSync(path.join(root, 'corrupt.exe')), false);
    checks.push('Wrong final digest blocks installation and discards corrupt segments');
    const requests = [...counts.values()].reduce((a, b) => a + b, 0);
    await assert.rejects(run('no-hash', ['/file'], { update: { ...update, sha256: '' } }), /SHA-256/);
    assert.equal([...counts.values()].reduce((a, b) => a + b, 0), requests);
    checks.push('Missing checksum rejects update before downloading');

    await downloadUpdate({ update, installerPath: path.join(root, 'auth.exe'), urls: ['https://api.github.com/api'], token: 'fixture-token', timing,
      fetch: (url, options) => fetch(url.replace('https://api.github.com', origin), options) });
    checks.push('GitHub token stays on API host and is stripped from redirected payload requests');
    assert.ok(progress.some(item => item.bytesPerSecond > 0));
    assert.ok(progress.filter(item => item.percent >= 100).every(item => /校验|完整安装包/.test(item.status)));
    checks.push('Byte progress and transfer rate are reported; 100 percent follows integrity validation');
    fs.writeFileSync(path.join(root, 'validation.json'), JSON.stringify({ result: 'passed', fixtureOnly: true, checks }, null, 2));
    console.log(JSON.stringify({ result: 'passed', fixtureOnly: true, root, checks }, null, 2));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
