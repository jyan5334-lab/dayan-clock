const path = require('node:path');

function resolveUpdateMode({ env = process.env, argv = process.argv, defaultUserData }) {
  const test = env.DAYAN_TEST === '1';
  const fixtureRequested = argv.includes('--dayan-test-updates');
  if (!test && fixtureRequested) throw Error('Test updates require an isolated test process');
  if (!test) return { test: false, fixtureUrl: '', hideWindow: false };
  const data = env.DAYAN_TEST_DATA || '';
  if (!path.isAbsolute(data)) throw Error('Test processes require an absolute DAYAN_TEST_DATA directory');
  const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  const contains = (parent, child) => {
    const relative = path.relative(normalize(parent), normalize(child));
    return !relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
  };
  if (!defaultUserData || contains(defaultUserData, data) || contains(data, defaultUserData)) throw Error('Test data must be separate from the normal user profile');
  if (!fixtureRequested) return { test: true, fixtureUrl: '', hideWindow: false };
  const url = new URL(env.DAYAN_TEST_UPDATE_URL || '');
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw Error('Fixture updates require a loopback HTTP server');
  return { test: true, fixtureUrl: url.toString(), hideWindow: true };
}

module.exports = { resolveUpdateMode };
