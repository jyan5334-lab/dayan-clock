const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const base = '/repos/jyan5334-lab/dayan-clock';
const version = require(path.join(root, 'package.json')).version;
const tag = `v${version}`;
const statePath = path.join(root, 'release/publication-state.json');
const assets = [`DAYANClock-Setup-${version}-x64.exe`, `DAYANClock-Source-${version}.zip`, `SHA256SUMS-${version}.txt`, 'update.json'];
function git(...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
const credential = spawnSync('git', ['-c', 'credential.interactive=false', 'credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', windowsHide: true, timeout: 20000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } });
const token = credential.stdout?.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
assert.ok(token, 'GitHub credentials unavailable');
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
async function api(endpoint, method = 'GET', body, allow404 = false) {
  const response = await fetch(`https://api.github.com${endpoint}`, { method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000) });
  if (allow404 && response.status === 404) return null;
  const data = response.status === 204 ? null : await response.json();
  assert.ok(response.ok, `GitHub ${method} ${endpoint}: ${response.status} ${data?.message || ''}`);
  return data;
}
function digest(name) { return 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'release', name))).digest('hex'); }
async function main() {
  const command = process.argv[2];
  const repo = await api(base);
  assert.equal(repo.private, false, 'Expected public update repository');
  if (command === 'status') {
    const ref = await api(`${base}/git/ref/heads/main`);
    const commit = await api(`${base}/git/commits/${ref.object.sha}`);
    const latest = await api(`${base}/releases/latest`);
    console.log(JSON.stringify({ remoteCommit: ref.object.sha, remoteTree: commit.tree.sha, localTree: git('rev-parse', 'HEAD^{tree}'), latest: latest.tag_name }));
    return;
  }
  if (command === 'source') {
    assert.equal(git('status', '--porcelain'), '', 'Commit the reviewed source first');
    const ref = await api(`${base}/git/ref/heads/main`);
    const parent = await api(`${base}/git/commits/${ref.object.sha}`);
    assert.equal(parent.tree.sha, git('rev-parse', 'HEAD^1^{tree}'), 'Remote changed since local base: refusing to overwrite');
    const treeEntries = [];
    for (const filename of git('diff', '--name-only', 'HEAD^', 'HEAD').split('\n').filter(Boolean)) {
      const file = path.join(root, filename);
      if (!fs.existsSync(file)) { treeEntries.push({ path: filename, mode: '100644', type: 'blob', sha: null }); continue; }
      const committed = spawnSync('git', ['show', `HEAD:${filename}`], { cwd: root, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
      assert.equal(committed.status, 0, 'Cannot read committed blob');
      const blob = await api(`${base}/git/blobs`, 'POST', { content: committed.stdout.toString('base64'), encoding: 'base64' });
      treeEntries.push({ path: filename, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const tree = await api(`${base}/git/trees`, 'POST', { base_tree: parent.tree.sha, tree: treeEntries });
    assert.equal(tree.sha, git('rev-parse', 'HEAD^{tree}'), 'Published source tree differs from reviewed local source');
    const identity = key => { const values = git('show', '-s', `--format=%${key}n%n%${key}e%n%${key}I`, 'HEAD').split('\n'); return { name: values[0], email: values[1], date: values[2] }; };
    const commit = await api(`${base}/git/commits`, 'POST', { tree: tree.sha, parents: [ref.object.sha], message: git('show', '-s', '--format=%B', 'HEAD'), author: identity('a'), committer: identity('c') });
    await api(`${base}/git/refs/heads/main`, 'PATCH', { sha: commit.sha, force: false });
    fs.writeFileSync(statePath, JSON.stringify({ localCommit: git('rev-parse', 'HEAD'), remoteCommit: commit.sha, tree: tree.sha }, null, 2));
    console.log(JSON.stringify({ source: 'synced', commit: commit.sha, files: treeEntries.length, treeVerified: true }));
    return;
  }
  if (command === 'upload') {
    const state = JSON.parse(fs.readFileSync(statePath));
    const releases = await api(`${base}/releases`);
    let release = releases.find(item => item.tag_name === tag);
    if (!release) release = await api(`${base}/releases`, 'POST', { tag_name: tag, target_commitish: state.remoteCommit, name: `DAYAN桌面 ${version}`, body: fs.readFileSync(path.join(root, 'docs/releases', tag + '.md'), 'utf8'), draft: true, prerelease: false });
    assert.equal(release.draft, true, 'Upload only to a draft release');
    for (const name of assets) {
      const file = path.join(root, 'release', name);
      const size = fs.statSync(file).size;
      const existing = release.assets.find(item => item.name === name);
      if (existing) { assert.equal(existing.digest, digest(name)); continue; }
      const url = new URL(release.upload_url.replace(/\{.*$/, ''));
      url.searchParams.set('name', name);
      console.log(JSON.stringify({ uploading: name, bytes: size }));
      const response = await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) }, body: fs.createReadStream(file), duplex: 'half', signal: AbortSignal.timeout(600000) });
      const asset = await response.json();
      assert.ok(response.ok, `Upload failed ${response.status}: ${asset.message || ''}`);
      assert.equal(asset.size, size);
      assert.equal(asset.digest, digest(name));
      console.log(JSON.stringify({ uploaded: name, digestVerified: true }));
    }
    return;
  }
  if (command === 'publish' || command === 'verify') {
    let release = (await api(`${base}/releases`)).find(item => item.tag_name === tag);
    assert.ok(release);
    for (const name of assets) {
      const asset = release.assets.find(item => item.name === name);
      assert.equal(asset?.state, 'uploaded');
      assert.equal(asset.digest, digest(name));
    }
    if (command === 'publish') release = await api(`${base}/releases/${release.id}`, 'PATCH', { draft: false, make_latest: 'true' });
    assert.equal(release.draft, false);
    const latest = await api(`${base}/releases/latest`);
    assert.equal(latest.tag_name, tag);
    const state = JSON.parse(fs.readFileSync(statePath));
    const ref = await api(`${base}/git/ref/tags/${tag}`);
    assert.equal(ref.object.sha, state.remoteCommit);
    console.log(JSON.stringify({ release: release.html_url, latest: latest.tag_name, assets: release.assets.map(item => ({ name: item.name, bytes: item.size, digest: item.digest })), sourceTreeVerified: state.tree }, null, 2));
    return;
  }
  throw Error('Expected status, source, upload, publish or verify');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
