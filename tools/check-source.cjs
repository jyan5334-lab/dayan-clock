const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
assert.equal(pkg.version, lock.version, 'Lockfile version differs');
assert.equal(pkg.version, lock.packages[''].version, 'Root lock package version differs');
assert.equal(pkg.private, true, 'Package must remain private');
for (const relative of ['index.html', 'desktop/main.cjs', 'desktop/preload.cjs', 'assets/icon.ico', 'assets/icon.png', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  assert.ok(fs.statSync(path.join(root, relative)).size > 0, `Missing ${relative}`);
}

const context = { window: {}, document: { baseURI: pathToFileURL(path.join(root, 'index.html')).href }, URL };
vm.runInNewContext(read('renderer/backgrounds.js'), context);
const backgrounds = context.window.timerBackgrounds;
assert.equal(backgrounds.length, 20, 'Expected twenty bundled wallpapers');
assert.equal(new Set(backgrounds.map(item => item.id)).size, backgrounds.length);
for (const item of backgrounds) {
  assert.match(item.id, /^[a-z-]+$/);
  const file = fileURLToPath(item.src);
  assert.equal(path.dirname(file), path.join(root, 'assets/backgrounds'), 'Wallpaper escapes asset directory');
  const image = fs.readFileSync(file);
  if (path.extname(file) === '.png') {
    assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  } else {
    assert.equal(image.toString('ascii', 0, 4), 'RIFF');
    assert.equal(image.toString('ascii', 8, 12), 'WEBP');
  }
}
const wallpaperManifest = JSON.parse(read('assets/backgrounds-20261028.json'));
assert.equal(wallpaperManifest.images.length, 10);
for (const item of wallpaperManifest.images) {
  const registered = backgrounds.find(background => background.id === item.id);
  assert.ok(registered, `Unregistered wallpaper: ${item.id}`);
  assert.equal(registered.src, new URL(item.src, context.document.baseURI).href);
  const image = fs.readFileSync(path.join(root, item.src));
  assert.equal(image.readUInt32BE(16), item.width);
  assert.equal(image.readUInt32BE(20), item.height);
  assert.equal(crypto.createHash('sha256').update(image).digest('hex'), item.sha256, `Wallpaper differs from original: ${item.id}`);
}

const files = [];
function walk(relative = '') {
  for (const item of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    if (['node_modules', 'release', 'work', '.git', 'test-results', 'coverage', 'playwright-report'].includes(item.name)) continue;
    const entry = path.join(relative, item.name);
    if (item.isDirectory()) walk(entry);
    else files.push(entry);
  }
}
walk();
let syntax = 0, links = 0;
for (const relative of files) {
  if (/\.(cjs|js)$/.test(relative)) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, relative)], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, `Syntax error in ${relative}: ${result.stderr || result.error || ''}`);
    syntax++;
  }
  if (relative.endsWith('.md')) {
    for (const match of read(relative).matchAll(/!?\[[^\]]*\]\(([^\s)]+)\)/g)) {
      const target = match[1];
      if (/^(https?:|mailto:|#)/i.test(target)) continue;
      const local = decodeURIComponent(target.split('#')[0]);
      const resolved = path.resolve(root, path.dirname(relative), local);
      assert.ok(!path.relative(root, resolved).startsWith('..'), `Link escapes project: ${target}`);
      assert.ok(fs.existsSync(resolved), `Broken link in ${relative}: ${target}`);
      links++;
    }
  }
}
for (const excluded of ['node_modules/', 'release/', 'work/', '.env*', 'preferences.json', 'windows-lockdown-backup.json', '*.pfx', '*.key']) {
  assert.ok(read('.gitignore').split(/\r?\n/).includes(excluded), `Missing exclusion ${excluded}`);
}
console.log(JSON.stringify({ version: pkg.version, syntaxFiles: syntax, localDocLinks: links, wallpapers: backgrounds.length, result: 'passed' }, null, 2));
