const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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

const context = { window: {}, document: { baseURI: 'file:///dayan/index.html' }, URL };
vm.runInNewContext(read('renderer/backgrounds.js'), context);
const backgrounds = context.window.timerBackgrounds;
assert.equal(backgrounds.length, 10, 'Expected ten bundled wallpapers');
assert.equal(new Set(backgrounds.map(item => item.id)).size, 10);
for (const item of backgrounds) {
  assert.match(item.id, /^[a-z-]+$/);
  const image = fs.readFileSync(path.join(root, 'assets/backgrounds', `${item.id}.webp`));
  assert.equal(image.toString('ascii', 0, 4), 'RIFF');
  assert.equal(image.toString('ascii', 8, 12), 'WEBP');
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
