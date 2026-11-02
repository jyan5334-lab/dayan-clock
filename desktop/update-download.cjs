const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CHUNK_SIZE = 2 * 1024 * 1024;
const CONNECTIONS = 8;
const FALLBACK_CONNECTIONS = 4;
const SOURCE_POOL_LIMIT = 10;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function hashFile(file) {
  const digest = crypto.createHash('sha256');
  for await (const bytes of fs.createReadStream(file)) digest.update(bytes);
  return digest.digest('hex');
}

function allowedUrl(value) {
  const url = new URL(value);
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw Error('更新地址必须使用 HTTPS');
  return url.toString();
}

function mergeUpdateSources(current, candidate) {
  if (!current || !candidate || current.version !== candidate.version || !/^[a-f0-9]{64}$/i.test(current.sha256 || '') || current.sha256.toLowerCase() !== String(candidate.sha256).toLowerCase() || !current.size || current.size !== candidate.size) return current;
  const assetApiUrl = current.assetApiUrl || candidate.assetApiUrl || '';
  const urls = [...(current.mirrorUrls || []), ...(candidate.mirrorUrls || []), candidate.downloadUrl];
  const mirrorUrls = [...new Set(urls.filter(value => typeof value === 'string' && value !== current.downloadUrl && value !== assetApiUrl).flatMap(value => { try { return [allowedUrl(value)]; } catch { return []; } }))].slice(0, SOURCE_POOL_LIMIT - 2);
  return { ...current, assetApiUrl, mirrorUrls };
}

async function downloadUpdate({ update, installerPath, urls, fetch: request, transports = [{ name: 'default', fetch: request }], onProgress = () => {}, onDiagnostic = () => {}, token, timing = {}, connections = CONNECTIONS }) {
  if (![FALLBACK_CONNECTIONS, CONNECTIONS].includes(connections)) throw Error('更新下载并发数无效');
  let total = Number(update.size) || 0;
  const expectedHash = String(update.sha256 || '').toLowerCase();
  if (!Number.isSafeInteger(total) || total < 0 || total > 512 * 1024 * 1024) throw Error('更新文件大小无效');
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw Error('更新清单缺少 SHA-256 校验值，未下载安装');
  const sources = [...new Set(urls.map(allowedUrl))].slice(0, SOURCE_POOL_LIMIT);
  if (!sources.length) throw Error('没有可用的更新下载地址');
  const idleMs = timing.idleMs || 10000, connectMs = timing.connectMs || 8000;
  const retryMs = timing.retryMs ?? 350;
  const cache = `${installerPath}.parts`;
  const temporary = `${installerPath}.download`;
  fs.mkdirSync(path.dirname(installerPath), { recursive: true });
  if (fs.existsSync(installerPath) && (!total || fs.statSync(installerPath).size === total) && await hashFile(installerPath) === expectedHash) {
    onProgress({ received: total, total, percent: 100, status: '已找到完整安装包并通过校验，准备安装…' });
    return { actualHash: expectedHash, received: total, total, cached: true };
  }
  fs.mkdirSync(cache, { recursive: true });
  const identityPath = path.join(cache, 'identity.json');
  const networkPath = path.join(cache, 'network.json');
  const identity = JSON.stringify({ sha256: expectedHash, size: total, chunkSize: CHUNK_SIZE });
  let same = false;
  try { same = fs.readFileSync(identityPath, 'utf8') === identity; } catch {}
  const clearParts = () => {
    for (const name of fs.readdirSync(cache)) if (/^\d+\.(bin|sha256)$/.test(name)) fs.unlinkSync(path.join(cache, name));
  };
  if (!same) clearParts();
  fs.writeFileSync(identityPath, identity);
  let blockSize = CHUNK_SIZE;
  if (same) { try { const saved = JSON.parse(fs.readFileSync(networkPath, 'utf8')).blockSize; if ([64 * 1024, 256 * 1024].includes(saved)) blockSize = saved; } catch {} }
  const count = total ? Math.ceil(total / CHUNK_SIZE) : 0;
  const completed = new Set();
  let received = 0, wireBytes = 0, lastProgress = 0, lastBytes = 0, rate = 0, transportName = '', streamMode = false;
  let connectionLimit = connections, failures = 0;
  const inflight = new Map();
  const report = (status, force = false) => {
    const now = Date.now();
    if (!force && now - lastProgress < 180) return;
    if (lastProgress && now - lastProgress >= 180) rate = (wireBytes - lastBytes) * 1000 / (now - lastProgress);
    lastProgress = now; lastBytes = wireBytes;
    const visible = streamMode ? (inflight.get('stream') || 0) : received + [...inflight.values()].reduce((a, b) => a + b, 0);
    const speed = rate > 0 ? ` · ${(rate / 1024 / 1024).toFixed(1)} MB/s` : '';
    onProgress({ received: visible, total, percent: total ? Math.min(99, visible / total * 100) : 0, bytesPerSecond: rate, connections: connectionLimit, transport: transportName, status: `${status}${speed}` });
  };

  // Never forward a GitHub credential to mirrors or signed CDN redirects.
  async function headersRequest(initialUrl, range, controller, fetcher = request, timeout = connectMs) {
    let url = initialUrl;
    for (let hop = 0; hop < 6; hop++) {
      const headers = { 'User-Agent': 'DAYANClock-Updater', Accept: 'application/octet-stream', 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache' };
      if (range) headers.Range = range;
      if (token && new URL(url).hostname === 'api.github.com') headers.Authorization = `Bearer ${token}`;
      const timer = setTimeout(() => controller.abort(Error('连接更新服务器超时')), timeout);
      let response;
      try { response = await fetcher(url, { headers, redirect: 'manual', signal: controller.signal }); }
      finally { clearTimeout(timer); }
      if (!REDIRECTS.has(response.status)) return { response, url };
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => {});
      if (!location) throw Error('更新服务器未返回跳转地址');
      url = allowedUrl(new URL(location, url).toString());
    }
    throw Error('更新地址跳转过多');
  }

  async function readBody(response, controller, expected, progress) {
    if (!response.body) throw Error('更新服务器没有返回文件');
    const reader = response.body.getReader();
    const buffers = [];
    let size = 0;
    try {
      while (true) {
        const timer = setTimeout(() => controller.abort(Error('下载数据接收超时')), idleMs);
        let next;
        try { next = await reader.read(); } finally { clearTimeout(timer); }
        if (next.done) break;
        const bytes = Buffer.from(next.value);
        size += bytes.length;
        if (size > expected) throw Error('更新数据长度超出预期');
        buffers.push(bytes);
        progress?.(size, bytes.length);
      }
      if (size !== expected) throw Error('更新数据长度不足，将重试缺失分段');
      return Buffer.concat(buffers, size);
    } finally { await reader.cancel().catch(() => {}); }
  }

  for (let index = 0; index < count; index++) {
    const part = path.join(cache, `${index}.bin`);
    try {
      const bytes = fs.readFileSync(part);
      if (bytes.length === Math.min(CHUNK_SIZE, total - index * CHUNK_SIZE) && hash(bytes) === fs.readFileSync(path.join(cache, `${index}.sha256`), 'utf8')) {
        completed.add(index); received += bytes.length;
      }
    } catch {}
  }
  report(received ? '正在续传已校验的下载进度…' : '正在选择可用下载线路…', true);
  let remaining = sources.flatMap(source => transports.map(transport => ({ source, transport }))), lastError;
  while (completed.size < count || !count) {
    if (!remaining.length) throw lastError || Error('更新线路暂不可用，下载进度已保留，请重试');
    const controllers = remaining.map(() => new AbortController());
    const ready = [];
    const sourcePool = [], distinct = new Set();
    let poolStarted = false;
    const register = candidate => {
      const url = new URL(candidate.url);
      const key = `${candidate.transport.name}:${url.origin}${url.pathname}`;
      if (!candidate.ranged || distinct.has(key)) return;
      distinct.add(key); sourcePool.push(candidate);
      onDiagnostic({ phase: 'source-joined', host: url.hostname, transport: candidate.transport.name, sources: sourcePool.length });
    };
    let selected;
    try {
      const probes = remaining.map(async ({ source, transport }, index) => {
        const controller = controllers[index];
        const started = Date.now();
        try {
          const sampleEnd = total ? Math.min(total - 1, 65535) : 0;
          const result = await headersRequest(source, `bytes=0-${sampleEnd}`, controller, transport.fetch);
          const ranged = result.response.status === 206 && result.response.headers.get('content-range') === `bytes 0-${sampleEnd}/${total}`;
          if (!ranged && result.response.status !== 200) throw Error(`更新连接失败（HTTP ${result.response.status}）`);
          const transferStarted = Date.now();
          if (ranged) await readBody(result.response, controller, sampleEnd + 1);
          else await result.response.body?.cancel().catch(() => {});
          if (controller.signal.aborted) throw controller.signal.reason;
          onDiagnostic({ phase: 'probe-ready', host: new URL(source).hostname, transport: transport.name, milliseconds: Date.now() - started });
          const candidate = { source, transport, url: result.url, ranged, index, active: 0, cooldown: 0, blockSize, speed: (sampleEnd + 1) / Math.max(10, Date.now() - transferStarted) };
          ready.push(candidate);
          if (poolStarted) {
            register(candidate);
            if (candidate.ranged) remaining = remaining.filter(item => item.source !== source || item.transport !== transport);
          }
          return candidate;
        } catch (error) { controller.abort(); onDiagnostic({ phase: 'probe-failed', host: new URL(source).hostname, transport: transport.name, milliseconds: Date.now() - started, error: error.message }); throw error; }
      });
      selected = await Promise.any(probes);
      // Give other fast paths a short chance to join, without waiting for a
      // stalled mirror. Use only validated, already-resolved download URLs.
      await Promise.race([Promise.allSettled(probes), pause(timing.probeWindowMs ?? 100)]);
      selected = ready.find(candidate => candidate.ranged) || selected;
    } catch (error) {
      lastError = error.errors?.[0] || error;
      controllers.forEach(controller => controller.abort());
      throw lastError;
    }
    transportName = selected.transport.name;
    const used = new Set(ready.filter(candidate => candidate.ranged || candidate.index === selected.index).map(candidate => candidate.index));
    remaining = remaining.filter((_, index) => !used.has(index));
    for (const candidate of ready) register(candidate);
    poolStarted = true;
    onDiagnostic({ phase: 'source-pool', sources: sourcePool.length, connections: connectionLimit });
    report(`下载线路已连接，正在${connectionLimit}路并行下载…`, true);
    try {
      if (!selected.ranged || !count) {
        const controller = new AbortController();
        const { response } = await headersRequest(selected.url, null, controller, selected.transport.fetch);
        if (response.status !== 200) { controller.abort(); throw Error(`普通下载失败（HTTP ${response.status}）`); }
        const size = total || Number(response.headers.get('content-length'));
        if (!Number.isSafeInteger(size) || size <= 0 || size > 512 * 1024 * 1024) { controller.abort(); throw Error('更新文件大小无效'); }
        total = size;
        streamMode = true;
        const handle = await fs.promises.open(temporary, 'w');
        const reader = response.body.getReader();
        let position = 0;
        try {
          while (true) {
            const timer = setTimeout(() => controller.abort(Error('下载数据接收超时')), idleMs);
            let next;
            try { next = await reader.read(); } finally { clearTimeout(timer); }
            if (next.done) break;
            const bytes = Buffer.from(next.value);
            if (position + bytes.length > size) throw Error('更新文件长度超出预期');
            await handle.writeFile(bytes);
            position += bytes.length; wireBytes += bytes.length;
            inflight.set('stream', position); report('正在下载更新…');
          }
          if (position !== size) throw Error('更新文件下载不完整');
        } finally { await reader.cancel().catch(() => {}); await handle.close(); inflight.delete('stream'); streamMode = false; }
        break;
      }
      const queue = Array.from({ length: count }, (_, index) => index).filter(index => !completed.has(index));
      let nextIndex = 0, failed;
      const active = new Set();
      async function worker(workerId) {
        while (!failed && nextIndex < queue.length) {
          if (workerId >= connectionLimit) return;
          const index = queue[nextIndex++];
          const start = index * CHUNK_SIZE, end = Math.min(total - 1, start + CHUNK_SIZE - 1);
          for (let attempt = 0; attempt < 3; attempt++) {
            const available = sourcePool.filter(candidate => candidate.cooldown <= Date.now());
            const candidate = (available.length ? available : sourcePool).slice().sort((a, b) => available.length ? (a.active + 1) / a.speed - (b.active + 1) / b.speed : a.cooldown - b.cooldown)[0];
            if (candidate.cooldown > Date.now()) await pause(candidate.cooldown - Date.now());
            while (!failed && active.size >= connectionLimit) await pause(10);
            if (failed) break;
            candidate.active++;
            const attemptedBlockSize = candidate.blockSize;
            const started = Date.now();
            const controller = new AbortController();
            const deadline = setTimeout(() => controller.abort(Error('当前下载线路速度过低或超时，将重试或切换线路')), timing.rangeMs || (attemptedBlockSize === CHUNK_SIZE ? 12000 : 90000));
            active.add(controller);
            try {
              const blocks = [];
              let offset = 0;
              for (let position = start; position <= end;) {
                const blockEnd = Math.min(end, position + candidate.blockSize - 1);
                const { response } = await headersRequest(candidate.url, `bytes=${position}-${blockEnd}`, controller, candidate.transport.fetch);
                if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${position}-${blockEnd}/${total}`) {
                  const error = Error(`更新分段范围不匹配（HTTP ${response.status}）`);
                  error.status = response.status;
                  const retryAfter = response.headers.get('retry-after');
                  error.retryAfter = /^\d+$/.test(retryAfter || '') ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now()) || 0;
                  controller.abort(); throw error;
                }
                const bytes = await readBody(response, controller, blockEnd - position + 1, (size, delta) => { inflight.set(index, offset + size); wireBytes += delta; report(`正在${connectionLimit}路并行下载…`); });
                blocks.push(bytes); offset += bytes.length;
                position = blockEnd + 1;
              }
              const bytes = Buffer.concat(blocks, end - start + 1);
              await fs.promises.writeFile(path.join(cache, `${index}.bin`), bytes);
              await fs.promises.writeFile(path.join(cache, `${index}.sha256`), hash(bytes));
              completed.add(index); received += bytes.length;
              candidate.speed = bytes.length / Math.max(1, Date.now() - started);
              onDiagnostic({ phase: 'range-complete', host: new URL(candidate.url).hostname, transport: candidate.transport.name, index, milliseconds: Date.now() - started });
              break;
            } catch (error) {
              if (failed) break;
              candidate.cooldown = Date.now() + Math.min(60000, Math.max(sourcePool.length > 1 ? 2000 : 0, error.retryAfter || 0, retryMs * 2 ** attempt));
              if ([403, 429].includes(error.status) && error.retryAfter) {
                const origin = new URL(candidate.url).origin;
                for (const peer of sourcePool) if (new URL(peer.url).origin === origin) peer.cooldown = Math.max(peer.cooldown, candidate.cooldown);
              }
              candidate.speed = Math.max(0.001, candidate.speed / 4);
              failures++;
              if (connectionLimit > FALLBACK_CONNECTIONS && (failures >= 2 || [403, 429].includes(error.status))) {
                connectionLimit = FALLBACK_CONNECTIONS;
                onDiagnostic({ phase: 'concurrency-reduced', connections: connectionLimit });
              }
              if (!error.status && candidate.blockSize === attemptedBlockSize && candidate.blockSize > 64 * 1024) {
                candidate.blockSize = candidate.blockSize === CHUNK_SIZE ? 256 * 1024 : 64 * 1024;
                fs.writeFileSync(networkPath, JSON.stringify({ blockSize: candidate.blockSize }));
                onDiagnostic({ phase: 'smaller-blocks', bytes: candidate.blockSize, transport: candidate.transport.name });
              }
              onDiagnostic({ phase: 'range-retry', host: new URL(candidate.url).hostname, transport: candidate.transport.name, index, status: error.status, error: error.message });
              if (attempt === 2) { failed = error; active.forEach(other => other.abort()); }
              else { report('网络波动，正在重试缺失分段…', true); await pause(retryMs * 2 ** attempt); }
            } finally { candidate.active--; clearTimeout(deadline); active.delete(controller); controller.abort(); inflight.delete(index); }
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(connectionLimit, queue.length) }, (_, index) => worker(index)));
      if (failed) throw failed;
      break;
    } catch (error) { lastError = error; onDiagnostic({ phase: 'source-failed', host: new URL(selected.source).hostname, transport: selected.transport.name, error: error.message }); report('正在切换线路，已完成的分段将保留…', true); }
    finally { controllers.forEach(controller => controller.abort()); }
  }
  // A retry after all parts were already saved still needs assembly.
  if (count && completed.size === count) {
    const output = await fs.promises.open(temporary, 'w');
    try { for (let index = 0; index < count; index++) await output.writeFile(await fs.promises.readFile(path.join(cache, `${index}.bin`))); }
    finally { await output.close(); }
  }
  report('下载完成，正在校验安装包…', true);
  const actualHash = await hashFile(temporary);
  if (actualHash !== expectedHash) {
    fs.rmSync(temporary, { force: true }); clearParts();
    throw Error('更新文件 SHA-256 校验失败，未执行安装，请重新下载');
  }
  await fs.promises.rename(temporary, installerPath);
  clearParts();
  onProgress({ received: total, total, percent: 100, status: '安装包校验通过，准备安装…' });
  return { actualHash, received: total, total };
}

module.exports = { downloadUpdate, mergeUpdateSources, CONNECTIONS, FALLBACK_CONNECTIONS, SOURCE_POOL_LIMIT, CHUNK_SIZE };
