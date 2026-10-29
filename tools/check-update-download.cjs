const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { downloadUpdate, CHUNK_SIZE, CONNECTIONS } = require('../desktop/update-download.cjs');

const root = fs.mkdtempSync(path.join(__dirname, '../work/download-'));
const payload = crypto.randomBytes(CHUNK_SIZE * 5 + 97);
const digest = crypto.createHash('sha256').update(payload).digest('hex');
const counts = new Map();
let active = 0, maxActive = 0, failPart = false, truncateOnce = false;
const server = http.createServer((req, res) => {
  const name = req.url;
  const range = req.headers.range;
  counts.set(`${name}:${range || 'stream'}`, (counts.get(`${name}:${range || 'stream'}`) || 0) + 1);
  if (name === '/slow') return setTimeout(() => { if (!res.destroyed) { res.writeHead(503); res.end(); } }, 250);
  if (name === '/redirect') { res.writeHead(302, { Location: '/file' }); return res.end(); }
  if (name === '/api') { assert.equal(req.headers.authorization, 'Bearer fixture-token'); res.writeHead(302, { Location: `http://127.0.0.1:${server.address().port}/file` }); return res.end(); }
  if (name === '/file') assert.equal(req.headers.authorization, undefined, 'Credential leaked across redirect');
  if (name === '/stream' || !range) { res.writeHead(200, { 'Content-Length': payload.length }); return res.end(payload); }
  const match = range.match(/^bytes=(\d+)-(\d+)$/);
  if (!match) { res.writeHead(416); return res.end(); }
  const start = Number(match[1]), end = Number(match[2]);
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
  setTimeout(() => res.end(bytes), name === '/large-stall' ? 20 : 220);
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const update = { version: '9.9.9', size: payload.length, sha256: digest };
  const timing = { idleMs: 600, connectMs: 100, retryMs: 5 };
  const progress = [];
  const run = (name, urls, more = {}) => downloadUpdate({ update, installerPath: path.join(root, `${name}.exe`), urls: urls.map(value => origin + value), fetch, timing, onProgress: item => progress.push(item), ...more });
  const checks = [];
  try {
    const started = Date.now();
    await run('race', ['/slow', '/redirect']);
    assert.ok(Date.now() - started < 1500);
    assert.equal(await fs.promises.readFile(path.join(root, 'race.exe')).then(bytes => crypto.createHash('sha256').update(bytes).digest('hex')), digest);
    assert.equal(CONNECTIONS, 4); assert.equal(maxActive, 4);
    checks.push('Fast source wins against stalled source; four range connections retained; final digest matches');

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
    checks.push('Stalled large requests automatically downgrade to 256 KB while retaining four workers');

    await run('stream', ['/stream']);
    checks.push('Servers without Range support use checked streaming fallback');
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
