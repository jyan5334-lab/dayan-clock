'use strict';
const fs = require('node:fs');
const path = require('node:path');
const project = path.resolve(__dirname, '..');
const candidate = path.resolve(project, '../..');
const workspace = process.env.DAYAN_WORKSPACE || (fs.existsSync(path.join(candidate, 'Migration', 'summary.json')) ? candidate : project);
function directory(name, entry = '') {
  const base = path.join(workspace, name);
  fs.mkdirSync(base, { recursive: true });
  return path.join(base, entry);
}
module.exports = {
  workspace,
  temp: entry => directory('Temp', entry),
  output: entry => directory('DAYANDesktop', entry)
};
