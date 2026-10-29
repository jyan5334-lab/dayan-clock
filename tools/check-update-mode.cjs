const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveUpdateMode } = require('../desktop/update-mode.cjs');
const defaultUserData = path.resolve('work/mode-fixture/normal');
const testData = path.resolve('work/mode-fixture/isolated');
const select = (env = {}, argv = []) => resolveUpdateMode({ env, argv, defaultUserData });
assert.deepEqual(select({ DAYAN_TEST_UPDATE_URL: 'http://127.0.0.1:1234/manifest' }), { test: false, fixtureUrl: '', hideWindow: false });
assert.throws(() => select({}, ['--dayan-test-updates']), /isolated/);
assert.throws(() => select({ DAYAN_TEST: '1' }), /absolute/);
assert.throws(() => select({ DAYAN_TEST: '1', DAYAN_TEST_DATA: defaultUserData }), /normal user/);
assert.throws(() => select({ DAYAN_TEST: '1', DAYAN_TEST_DATA: path.join(defaultUserData, 'child') }), /normal user/);
assert.throws(() => select({ DAYAN_TEST: '1', DAYAN_TEST_DATA: path.dirname(defaultUserData) }), /normal user/);
const env = { DAYAN_TEST: '1', DAYAN_TEST_DATA: testData, DAYAN_TEST_UPDATE_URL: 'http://127.0.0.1:1234/manifest' };
assert.equal(select(env).fixtureUrl, '', 'A test environment alone must not activate fixture updates');
assert.deepEqual(select(env, ['--dayan-test-updates']), { test: true, fixtureUrl: env.DAYAN_TEST_UPDATE_URL, hideWindow: true });
for (const url of ['https://example.com/manifest', 'http://192.168.1.2/manifest', 'http://user:pass@localhost/manifest']) {
  assert.throws(() => select({ ...env, DAYAN_TEST_UPDATE_URL: url }, ['--dayan-test-updates']), /loopback/);
}
console.log(JSON.stringify({ result: 'passed', checks: ['Normal launches ignore fixture update environment variables', 'Explicit switch and isolated absolute test profile are required', 'Test profiles cannot overlap normal user data', 'Only a loopback server enables fixture updates and its window stays hidden'] }, null, 2));
