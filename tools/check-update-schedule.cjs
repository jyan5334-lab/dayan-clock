const assert = require('node:assert/strict');
const { createUpdateSchedule } = require('../desktop/update-schedule.cjs');
const local = (day, hour, minute = 0, second = 0) => new Date(2026, 10, day, hour, minute, second).getTime();
let clock = local(14, 8, 59, 59), armed, delay;
const checks = [];
const schedule = createUpdateSchedule({ now: () => clock, onCheck: slot => checks.push(slot.key),
  setTimer: (fn, ms) => { armed = fn; delay = ms; return 1; }, clearTimer: () => { armed = null; } });
const advance = time => { clock = time; assert.ok(armed); armed(); };
schedule.start(); schedule.start();
assert.deepEqual(checks, []); assert.equal(delay, 1000);
for (const hour of [9, 14, 17]) {
  advance(local(14, hour));
  schedule.tick();
  assert.equal(checks.length, [9, 14, 17].indexOf(hour) + 1);
}
assert.deepEqual(checks, ['2026-11-14/9', '2026-11-14/14', '2026-11-14/17']);
advance(local(15, 9));
assert.equal(checks.at(-1), '2026-11-15/9');
advance(local(16, 18));
assert.equal(checks.length, 5, 'Missed slots coalesce to one check after sleep');
assert.equal(checks.at(-1), '2026-11-16/17');
advance(local(16, 13)); advance(local(16, 17));
assert.equal(checks.filter(key => key === '2026-11-16/17').length, 1, 'Clock rollback must not duplicate a slot');
schedule.stop(); assert.equal(armed, null);
clock = local(17, 10); schedule.start(); assert.equal(checks.length, 5, 'Startup check is owned by the existing updater');
advance(local(17, 14)); assert.equal(checks.at(-1), '2026-11-17/14');
schedule.stop();
console.log(JSON.stringify({ result: 'passed', checks, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  verified: ['09:00/14:00/17:00 local slots', 'Next day', 'Sleep catch-up coalescing', 'Clock rollback deduplication', 'Start/stop lifecycle', 'No startup duplicate'] }, null, 2));
