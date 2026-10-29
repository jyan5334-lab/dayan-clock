const { session, net } = require('electron');
const { Readable } = require('node:stream');

// Use Chromium's network stack so Windows proxy, PAC and system network
// settings are respected. Node's built-in fetch bypasses some of them.
function chromiumFetch(url, options = {}) {
  const updaterSession = session.fromPartition('dayan-updater', { cache: false });
  if (options.redirect !== 'manual') return updaterSession.fetch(url, options);
  // Electron fetch rejects manual redirects. ClientRequest exposes the signed
  // CDN Location without downloading a whole installer or leaking credentials.
  return new Promise((resolve, reject) => {
    const request = net.request({ url, session: updaterSession, redirect: 'manual', method: options.method || 'GET' });
    let settled = false, incoming;
    const aborted = () => { request.abort(); incoming?.destroy(options.signal?.reason || Error('更新请求已取消')); if (!settled) { settled = true; reject(options.signal?.reason || Error('更新请求已取消')); } };
    const cleanup = () => options.signal?.removeEventListener('abort', aborted);
    request.on('error', error => { cleanup(); if (!settled) { settled = true; reject(error); } else incoming?.destroy(error); });
    request.on('redirect', (statusCode, _method, redirectUrl) => {
      settled = true; cleanup();
      resolve(new Response(null, { status: statusCode, headers: { location: redirectUrl } }));
      request.abort();
    });
    request.on('response', response => {
      incoming = response;
      response.on('error', () => {});
      response.once('end', cleanup); response.once('close', cleanup);
      const headers = new Headers();
      for (const [name, values] of Object.entries(response.headers)) for (const value of Array.isArray(values) ? values : [values]) headers.append(name, String(value));
      settled = true;
      resolve(new Response(Readable.toWeb(response), { status: response.statusCode, headers }));
    });
    for (const [name, value] of Object.entries(options.headers || {})) request.setHeader(name, value);
    options.signal?.addEventListener('abort', aborted, { once: true });
    if (options.signal?.aborted) aborted(); else request.end();
  });
}

const downloadTransports = [
  { name: 'direct', fetch: (url, options) => fetch(url, options) },
  { name: 'system', fetch: chromiumFetch }
];

async function networkFetch(url, options = {}) {
  const controllers = downloadTransports.map(() => new AbortController());
  try {
    const winner = await Promise.any(downloadTransports.map(async (transport, index) => {
      const signal = options.signal ? AbortSignal.any([options.signal, controllers[index].signal]) : controllers[index].signal;
      const response = await transport.fetch(url, { ...options, signal });
      if (response.status >= 400) { await response.body?.cancel().catch(() => {}); throw Error(`更新连接失败（HTTP ${response.status}）`); }
      return { response, index };
    }));
    controllers.forEach((controller, index) => { if (index !== winner.index) controller.abort(); });
    return winner.response;
  } catch (error) { controllers.forEach(controller => controller.abort()); throw error.errors?.[0] || error; }
}

module.exports = { networkFetch, downloadTransports };
